//! Unified lifecycle for the playback metadata layers.
//!
//! Every playback layer (channel hocket, generator spans, track flow, seed
//! trace, parallel conflicts, trigger decisions, plus the MIDI/automation
//! debug logs) shares one lifecycle: record during cycle-local realization,
//! clear when a run (re)starts, prune while the playhead advances, cap in
//! size, copy into the transport snapshot. Before this module each layer
//! hand-implemented that lifecycle and the implementations drifted.
//!
//! The design rule here: **the compiler enumerates the layers, never a
//! human.** Aggregate operations destructure [`PlaybackLayers`] without a
//! `..` rest pattern, so adding a layer field is a compile error until every
//! lifecycle site says what the new layer does. Policy (capacity, retention)
//! is data on the store, declared once in [`PlaybackLayers::default`], not
//! implied by which call sites exist.
//!
//! Two layer families share the one store type:
//! - **Cycle-coherent overlays** (generator, channel hocket, track flow):
//!   the timeline-trust surface. Pruned to a sliding window around the
//!   playhead ([`Retention::CycleWindow`]) so the snapshot only describes
//!   cycles whose queued MIDI is still relevant.
//! - **Rolling logs** (MIDI debug, automation, seed trace, conflicts,
//!   trigger decisions): bounded history ([`Retention::CapOnly`]). The MIDI
//!   debug and automation logs additionally persist across run restarts (see
//!   [`PlaybackLayers::clear_realized`]).

use std::collections::VecDeque;

use crate::{
    AutomationPlaybackEvent, ChannelHocketPlaybackEvent, MidiDebugEvent,
    ParallelConflictDebugEvent, ParallelConflictDecision, PlaybackSeedTraceEvent,
    RealizedRhythmSpanEvent, TrackFlowPlaybackEvent, TriggerDecisionEvent,
};

const MIDI_DEBUG_LOG_CAPACITY: usize = 1000;
const AUTOMATION_EVENT_LOG_CAPACITY: usize = 1000;
const CHANNEL_EVENT_LOG_CAPACITY: usize = 512;
const REALIZED_RHYTHM_EVENT_LOG_CAPACITY: usize = 512;
const TRACK_FLOW_EVENT_LOG_CAPACITY: usize = 512;
const SEED_TRACE_LOG_CAPACITY: usize = 1024;
const PARALLEL_CONFLICT_EVENT_LOG_CAPACITY: usize = 1000;
const TRIGGER_DECISION_EVENT_LOG_CAPACITY: usize = 512;

/// How many cycles behind/ahead of the playhead a `CycleWindow` layer keeps.
/// Matches the lookahead horizon: the scheduler realizes two cycles ahead.
const RETAIN_CYCLES_BEHIND: u64 = 1;
const RETAIN_CYCLES_AHEAD: u64 = 2;

/// How a layer's events are pruned while playback advances.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Retention {
    /// Prune to a sliding window around the current cycle. For overlay
    /// layers whose invariant is "describe exactly the finalized queue for
    /// the cycles in view".
    CycleWindow,
    /// Bounded only by capacity: a rolling log.
    CapOnly,
}

/// Implemented by every layer event so window retention is total — `CapOnly`
/// stores simply never consult it.
pub(crate) trait LayerEvent {
    fn cycle(&self) -> u64;
}

impl LayerEvent for MidiDebugEvent {
    fn cycle(&self) -> u64 {
        self.cycle
    }
}
impl LayerEvent for AutomationPlaybackEvent {
    fn cycle(&self) -> u64 {
        self.cycle
    }
}
impl LayerEvent for ChannelHocketPlaybackEvent {
    fn cycle(&self) -> u64 {
        self.cycle
    }
}
impl LayerEvent for RealizedRhythmSpanEvent {
    fn cycle(&self) -> u64 {
        self.cycle
    }
}
impl LayerEvent for TrackFlowPlaybackEvent {
    fn cycle(&self) -> u64 {
        self.cycle
    }
}
impl LayerEvent for PlaybackSeedTraceEvent {
    fn cycle(&self) -> u64 {
        self.cycle
    }
}
impl LayerEvent for ParallelConflictDebugEvent {
    fn cycle(&self) -> u64 {
        self.cycle
    }
}
impl LayerEvent for TriggerDecisionEvent {
    fn cycle(&self) -> u64 {
        self.source_cycle_index
    }
}

/// One playback layer: events plus the lifecycle policy that governs them.
#[derive(Debug)]
pub(crate) struct LayerStore<T> {
    events: VecDeque<T>,
    cap: usize,
    retention: Retention,
    next_sequence: u64,
    /// Monotonic version, bumped only when the *visible* event contents change
    /// (insert, eviction, clear-of-nonempty, or window pruning that removed
    /// events). The telemetry sampler digests these versions to decide whether
    /// a render payload actually changed, instead of cloning every layer to
    /// diff it. Never reset — a cleared layer still advances the version so the
    /// digest can't alias pre- and post-clear states.
    version: u64,
}

impl<T: LayerEvent> LayerStore<T> {
    fn new(cap: usize, retention: Retention) -> Self {
        Self {
            events: VecDeque::with_capacity(cap),
            cap,
            retention,
            next_sequence: 0,
            version: 0,
        }
    }

    fn bump(&mut self) {
        self.version = self.version.saturating_add(1);
    }

    /// The current visible-contents version. See [`LayerStore::version`].
    pub(crate) fn version(&self) -> u64 {
        self.version
    }

    /// Append events, evicting the oldest past capacity. Bumps the version if
    /// anything was inserted or evicted (visible contents changed).
    pub(crate) fn record(&mut self, events: impl IntoIterator<Item = T>) {
        let before = self.events.len();
        self.events.extend(events);
        let inserted = self.events.len() > before;
        let trimmed = self.trim();
        if inserted || trimmed {
            self.bump();
        }
    }

    pub(crate) fn push(&mut self, event: T) {
        self.events.push_back(event);
        self.trim();
        self.bump();
    }

    /// Evict the oldest events past capacity. Returns whether any were removed,
    /// so callers can tell whether visible contents changed.
    fn trim(&mut self) -> bool {
        let mut removed = false;
        while self.events.len() > self.cap {
            self.events.pop_front();
            removed = true;
        }
        removed
    }

    /// Clear events and restart sequence numbering. Bumps the version only when
    /// the layer was non-empty (clearing an empty layer changes nothing).
    pub(crate) fn clear(&mut self) {
        let was_empty = self.events.is_empty();
        self.events.clear();
        self.next_sequence = 0;
        if !was_empty {
            self.bump();
        }
    }

    /// Hand out the next sequence number for layers that stamp one at
    /// record time (MIDI debug, automation, conflicts).
    pub(crate) fn take_sequence(&mut self) -> u64 {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        sequence
    }

    /// Apply this store's retention policy for the given playhead cycle. Bumps
    /// the version only when pruning actually removed events.
    fn retain_window(&mut self, current_cycle: u64) {
        if self.retention != Retention::CycleWindow {
            return;
        }
        let before = self.events.len();
        self.events.retain(|event| {
            event.cycle().saturating_add(RETAIN_CYCLES_BEHIND) >= current_cycle
                && event.cycle() <= current_cycle.saturating_add(RETAIN_CYCLES_AHEAD)
        });
        if self.events.len() != before {
            self.bump();
        }
    }

    pub(crate) fn to_vec(&self) -> Vec<T>
    where
        T: Clone,
    {
        self.events.iter().cloned().collect()
    }

    // Test-only inspection helpers; production reads go through `to_vec`
    // (snapshot) so the store keeps a single read path.
    #[cfg(test)]
    pub(crate) fn back(&self) -> Option<&T> {
        self.events.back()
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.events.len()
    }

    #[cfg(test)]
    pub(crate) fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    #[cfg(test)]
    pub(crate) fn iter(&self) -> impl Iterator<Item = &T> {
        self.events.iter()
    }
}

/// Every playback metadata layer the transport publishes, with lifecycle
/// implemented exactly once. Adding a layer = adding a field here; the
/// exhaustive destructures below then walk you to every lifecycle decision.
#[derive(Debug)]
pub(crate) struct PlaybackLayers {
    pub(crate) midi_debug: LayerStore<MidiDebugEvent>,
    pub(crate) automation: LayerStore<AutomationPlaybackEvent>,
    pub(crate) channel_hocket: LayerStore<ChannelHocketPlaybackEvent>,
    /// Realized generator spans — the timeline generator-row trust surface.
    pub(crate) realized_rhythm: LayerStore<RealizedRhythmSpanEvent>,
    /// Per-box Track Flow lane selections — the per-box "Box → Track" display
    /// overlay. Cycle-windowed like the other overlays; each event carries its
    /// box's `lane_id` so the UI can group selections per box.
    pub(crate) track_flow: LayerStore<TrackFlowPlaybackEvent>,
    pub(crate) seed_trace: LayerStore<PlaybackSeedTraceEvent>,
    pub(crate) parallel_conflict: LayerStore<ParallelConflictDebugEvent>,
    pub(crate) trigger_decision: LayerStore<TriggerDecisionEvent>,
}

/// Visible-contents versions for the cycle-coherent overlay layers — the
/// timeline render trust surface. Part of [`PlaybackLayerDigest`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OverlayVersions {
    pub channel_hocket: u64,
    pub realized_rhythm: u64,
    pub track_flow: u64,
}

/// Visible-contents versions for the rolling diagnostic/log layers. Part of
/// [`PlaybackLayerDigest`]. Gated separately from overlays so high-frequency
/// MIDI/automation traffic can't force a full timeline re-render.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogVersions {
    pub midi_debug: u64,
    pub automation: u64,
    pub seed_trace: u64,
    pub parallel_conflict: u64,
    pub trigger_decision: u64,
}

/// A cheap, `Copy` fingerprint of every layer's visible contents. Comparing two
/// digests tells the sampler whether overlays and/or logs changed without
/// cloning any event vector.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlaybackLayerDigest {
    pub overlay_versions: OverlayVersions,
    pub log_versions: LogVersions,
}

impl Default for PlaybackLayers {
    /// The policy table. Capacity and retention for every layer, in one place.
    fn default() -> Self {
        Self {
            midi_debug: LayerStore::new(MIDI_DEBUG_LOG_CAPACITY, Retention::CapOnly),
            automation: LayerStore::new(AUTOMATION_EVENT_LOG_CAPACITY, Retention::CapOnly),
            channel_hocket: LayerStore::new(CHANNEL_EVENT_LOG_CAPACITY, Retention::CycleWindow),
            realized_rhythm: LayerStore::new(
                REALIZED_RHYTHM_EVENT_LOG_CAPACITY,
                Retention::CycleWindow,
            ),
            track_flow: LayerStore::new(TRACK_FLOW_EVENT_LOG_CAPACITY, Retention::CycleWindow),
            seed_trace: LayerStore::new(SEED_TRACE_LOG_CAPACITY, Retention::CapOnly),
            parallel_conflict: LayerStore::new(
                PARALLEL_CONFLICT_EVENT_LOG_CAPACITY,
                Retention::CapOnly,
            ),
            trigger_decision: LayerStore::new(
                TRIGGER_DECISION_EVENT_LOG_CAPACITY,
                Retention::CapOnly,
            ),
        }
    }
}

impl PlaybackLayers {
    /// Overlay (timeline) layer versions. See [`OverlayVersions`].
    pub(crate) fn overlay_versions(&self) -> OverlayVersions {
        OverlayVersions {
            channel_hocket: self.channel_hocket.version(),
            realized_rhythm: self.realized_rhythm.version(),
            track_flow: self.track_flow.version(),
        }
    }

    /// Rolling diagnostic/log layer versions. See [`LogVersions`].
    pub(crate) fn log_versions(&self) -> LogVersions {
        LogVersions {
            midi_debug: self.midi_debug.version(),
            automation: self.automation.version(),
            seed_trace: self.seed_trace.version(),
            parallel_conflict: self.parallel_conflict.version(),
            trigger_decision: self.trigger_decision.version(),
        }
    }

    /// Combined digest of every layer's visible contents.
    pub(crate) fn digest(&self) -> PlaybackLayerDigest {
        PlaybackLayerDigest {
            overlay_versions: self.overlay_versions(),
            log_versions: self.log_versions(),
        }
    }

    /// Clear everything a (re)started run must not inherit: all realized
    /// playback metadata. The MIDI debug and automation logs deliberately
    /// survive — they are debug history, not run state.
    ///
    /// The destructure has no `..`: a new layer field fails compilation here
    /// until you decide whether it resets with the run.
    pub(crate) fn clear_realized(&mut self) {
        let Self {
            midi_debug,
            automation,
            channel_hocket,
            realized_rhythm,
            track_flow,
            seed_trace,
            parallel_conflict,
            trigger_decision,
        } = self;
        // Rolling debug logs persist across run restarts by design.
        let _ = midi_debug;
        let _ = automation;
        channel_hocket.clear();
        realized_rhythm.clear();
        track_flow.clear();
        seed_trace.clear();
        parallel_conflict.clear();
        trigger_decision.clear();
    }

    /// Prune every layer per its retention policy for the current playhead
    /// cycle. `CapOnly` layers are untouched.
    pub(crate) fn retain_window(&mut self, current_cycle: u64) {
        let Self {
            midi_debug,
            automation,
            channel_hocket,
            realized_rhythm,
            track_flow,
            seed_trace,
            parallel_conflict,
            trigger_decision,
        } = self;
        midi_debug.retain_window(current_cycle);
        automation.retain_window(current_cycle);
        channel_hocket.retain_window(current_cycle);
        realized_rhythm.retain_window(current_cycle);
        track_flow.retain_window(current_cycle);
        seed_trace.retain_window(current_cycle);
        parallel_conflict.retain_window(current_cycle);
        trigger_decision.retain_window(current_cycle);
    }

    /// Record one realized cycle's playback metadata — the single entry
    /// point all scheduler realize sites share. Conflict decisions are
    /// converted to debug events here (sequence stamp + tick split), exactly
    /// as the per-layer record functions used to do.
    pub(crate) fn record_cycle(
        &mut self,
        events: crate::CyclePlaybackEvents,
        ticks_per_cycle: u64,
    ) {
        let crate::CyclePlaybackEvents {
            channel_hocket,
            seed_trace,
            parallel_conflict,
            trigger_decisions,
            realized_rhythm,
            track_flow,
            resolved_cycle: _,
        } = events;
        self.channel_hocket.record(channel_hocket);
        self.realized_rhythm.record(realized_rhythm);
        self.track_flow.record(track_flow);
        self.seed_trace.record(seed_trace);
        self.trigger_decision.record(trigger_decisions);
        self.record_conflict_decisions(parallel_conflict, ticks_per_cycle);
    }

    fn record_conflict_decisions(
        &mut self,
        decisions: Vec<ParallelConflictDecision>,
        ticks_per_cycle: u64,
    ) {
        for decision in decisions {
            let (cycle, tick_in_cycle) = match ticks_per_cycle {
                0 => (0, decision.absolute_tick),
                ticks => (
                    decision.absolute_tick / ticks,
                    decision.absolute_tick % ticks,
                ),
            };
            let sequence = self.parallel_conflict.take_sequence();
            self.parallel_conflict.push(ParallelConflictDebugEvent {
                sequence,
                absolute_tick: decision.absolute_tick,
                cycle,
                tick_in_cycle,
                output_channel: decision.output_channel,
                pitch: decision.pitch,
                start_tick: decision.start_tick,
                end_tick: decision.end_tick,
                track_id: decision.track_id,
                track_name: decision.track_name,
                track_index: decision.track_index,
                conflict_policy: decision.conflict_policy,
                conflict_action: decision.conflict_action,
                conflict_group_id: decision.conflict_group_id,
                colliding_track_ids: decision.colliding_track_ids,
                active_track_count: decision.active_track_count,
                passed: decision.passed,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hocket_event(cycle: u64) -> ChannelHocketPlaybackEvent {
        ChannelHocketPlaybackEvent {
            cycle,
            start_tick: 0,
            end_tick: 960,
            channel: 1,
            source: cseq_rhythm::RhythmChoiceSource::Initial,
            fallback: false,
            position_rule_id: None,
            position_rule_label: None,
            position_scope: None,
            position_nth: None,
            position_action: None,
            parallel_track_index: None,
            parallel_track_id: None,
            parallel_track_name: None,
            suppressed: false,
        }
    }

    fn seed_trace_event(cycle: u64) -> PlaybackSeedTraceEvent {
        PlaybackSeedTraceEvent {
            cycle,
            domain: "subdivision".to_string(),
            label: "test".to_string(),
            seed: 1,
            base_seed: None,
            source: "locked".to_string(),
            history_before: Vec::new(),
            history_after: Vec::new(),
            parallel_track_index: None,
            track_id: None,
        }
    }

    fn conflict_decision(absolute_tick: u64) -> ParallelConflictDecision {
        ParallelConflictDecision {
            absolute_tick,
            output_channel: 1,
            pitch: 60,
            start_tick: absolute_tick,
            end_tick: absolute_tick + 1,
            track_id: "track-1".to_string(),
            track_name: "Track 1".to_string(),
            track_index: 0,
            conflict_policy: "allowAll".to_string(),
            conflict_action: "priority-winner".to_string(),
            conflict_group_id: "g".to_string(),
            colliding_track_ids: Vec::new(),
            active_track_count: 1,
            passed: true,
        }
    }

    fn trigger_event(cycle: u64) -> TriggerDecisionEvent {
        TriggerDecisionEvent {
            track_index: 0,
            track_id: "track-2".to_string(),
            track_name: "Track 2".to_string(),
            source_cycle_index: cycle,
            matched_beat: 0,
            event_tick: 0,
            candidate_tick: 0,
            start_kind: "atEvent".to_string(),
            outcome: "launched".to_string(),
            suppress_reason: None,
            launch_tick: None,
            run_index: None,
            roll_value: None,
            roll_threshold: None,
            roll_passed: None,
            consecutive_misses: 0,
            last_accept_source_cycle: None,
        }
    }

    fn midi_event(cycle: u64, sequence: u64) -> MidiDebugEvent {
        MidiDebugEvent {
            sequence,
            absolute_tick: 0,
            cycle,
            tick_in_cycle: 0,
            channel: Some(1),
            message_type: "noteOn".to_string(),
            data1: Some(60),
            data2: Some(96),
            bytes: vec![144, 60, 96],
            debug_source: None,
            monitor_bus: None,
            monitor_user_channel: None,
            monitor_mode: None,
            monitor_program: None,
            monitor_drum_note: None,
            monitor_bytes: None,
            parallel_track_id: None,
            parallel_track_name: None,
            parallel_conflict_policy: None,
            parallel_conflict_action: None,
            parallel_conflict_group_id: None,
        }
    }

    fn automation_event(cycle: u64, sequence: u64) -> AutomationPlaybackEvent {
        AutomationPlaybackEvent {
            sequence,
            cycle,
            beat_index: 0,
            tick_in_cycle: 0,
            automation_phase: cseq_model::AutomationTime { numer: 0, denom: 1 },
            values: Vec::new(),
        }
    }

    fn populated_layers() -> PlaybackLayers {
        let mut layers = PlaybackLayers::default();
        let midi_sequence = layers.midi_debug.take_sequence();
        layers.midi_debug.push(midi_event(0, midi_sequence));
        let automation_sequence = layers.automation.take_sequence();
        layers
            .automation
            .push(automation_event(0, automation_sequence));
        layers.channel_hocket.record([hocket_event(0)]);
        layers.seed_trace.record([seed_trace_event(0)]);
        layers.record_conflict_decisions(vec![conflict_decision(0)], 960);
        layers.trigger_decision.record([trigger_event(0)]);
        layers
    }

    /// The clear-on-(re)start contract: every realized layer empties, the
    /// rolling debug logs survive. Written with the exhaustive destructure so
    /// a new layer field fails compilation here until the test says what it
    /// expects of it.
    #[test]
    fn clear_realized_empties_every_realized_layer_and_keeps_debug_logs() {
        let mut layers = populated_layers();
        layers.clear_realized();

        let PlaybackLayers {
            midi_debug,
            automation,
            channel_hocket,
            realized_rhythm,
            track_flow,
            seed_trace,
            parallel_conflict,
            trigger_decision,
        } = &layers;
        assert_eq!(midi_debug.len(), 1, "midi debug log persists across runs");
        assert_eq!(automation.len(), 1, "automation log persists across runs");
        assert!(channel_hocket.is_empty());
        assert!(realized_rhythm.is_empty());
        assert!(track_flow.is_empty());
        assert!(seed_trace.is_empty());
        assert!(parallel_conflict.is_empty());
        assert!(trigger_decision.is_empty());
    }

    /// Cycle-coherent overlay events retain the configured playhead window.
    #[test]
    fn retain_window_prunes_channel_hocket_layer() {
        let mut layers = PlaybackLayers::default();
        for cycle in [0, 4, 5, 6, 7, 20] {
            layers.channel_hocket.record([hocket_event(cycle)]);
        }

        layers.retain_window(5);

        // Window is [current - 1, current + 2] = cycles 4..=7.
        let surviving: Vec<u64> = layers
            .channel_hocket
            .iter()
            .map(|event| event.cycle)
            .collect();
        assert_eq!(
            surviving,
            vec![4, 5, 6, 7],
            "channel hocket must retain the cycle window"
        );
    }

    /// CapOnly layers ignore the playhead entirely: history is bounded by
    /// capacity, never by cycle distance.
    #[test]
    fn retain_window_leaves_rolling_logs_untouched() {
        let mut layers = populated_layers();
        layers.retain_window(1_000);

        assert_eq!(layers.midi_debug.len(), 1);
        assert_eq!(layers.automation.len(), 1);
        assert_eq!(layers.seed_trace.len(), 1);
        assert_eq!(layers.parallel_conflict.len(), 1);
        assert_eq!(layers.trigger_decision.len(), 1);
    }

    #[test]
    fn record_bumps_version_only_when_contents_change() {
        let mut store: LayerStore<ChannelHocketPlaybackEvent> =
            LayerStore::new(3, Retention::CapOnly);
        assert_eq!(store.version(), 0);

        // Empty record: nothing inserted, nothing evicted → no bump.
        store.record(std::iter::empty());
        assert_eq!(store.version(), 0, "empty record must not bump");

        // Non-empty record → bump once.
        store.record([hocket_event(0)]);
        assert_eq!(store.version(), 1);

        // Record that overflows capacity (insert + eviction) still bumps once.
        store.record([hocket_event(1), hocket_event(2), hocket_event(3)]);
        assert_eq!(store.version(), 2);
        assert_eq!(store.len(), 3);
    }

    #[test]
    fn push_bumps_version_every_time() {
        let mut store: LayerStore<MidiDebugEvent> = LayerStore::new(1000, Retention::CapOnly);
        store.push(midi_event(0, 0));
        store.push(midi_event(0, 1));
        assert_eq!(store.version(), 2);
    }

    #[test]
    fn clear_bumps_only_when_nonempty() {
        let mut store: LayerStore<ChannelHocketPlaybackEvent> =
            LayerStore::new(8, Retention::CycleWindow);
        store.clear();
        assert_eq!(store.version(), 0, "clearing an empty layer is a no-op");

        store.record([hocket_event(0)]);
        let after_record = store.version();
        store.clear();
        assert_eq!(store.version(), after_record + 1, "clearing nonempty bumps");
    }

    #[test]
    fn retain_window_bumps_only_when_it_removes() {
        let mut store: LayerStore<ChannelHocketPlaybackEvent> =
            LayerStore::new(16, Retention::CycleWindow);
        for cycle in [4, 5, 6, 7] {
            store.record([hocket_event(cycle)]);
        }
        let before = store.version();

        // Window [current-1, current+2] = [4,7]; nothing removed → no bump.
        store.retain_window(5);
        assert_eq!(store.version(), before, "no removal must not bump");

        // Advancing the playhead drops cycle 4 → bump.
        store.retain_window(6);
        assert_eq!(store.version(), before + 1, "removal bumps");
    }

    /// The split that lets dense MIDI traffic avoid forcing a timeline render:
    /// a `midi_debug` push moves the log digest only, never the overlay digest.
    /// Conversely cycle-coherent overlays move the overlay digest so mid-cycle
    /// changes surface.
    #[test]
    fn digest_keeps_overlay_and_log_versions_independent() {
        let mut layers = PlaybackLayers::default();
        let base = layers.digest();

        // Dense MIDI: pushes only move the log side.
        let seq = layers.midi_debug.take_sequence();
        layers.midi_debug.push(midi_event(0, seq));
        let after_midi = layers.digest();
        assert_eq!(
            after_midi.overlay_versions, base.overlay_versions,
            "MIDI debug traffic must not move the overlay (timeline) digest"
        );
        assert_ne!(
            after_midi.log_versions, base.log_versions,
            "MIDI debug traffic must move the log digest"
        );

        // Mid-cycle overlay realization: moves only the overlay side.
        layers.channel_hocket.record([hocket_event(0)]);
        let after_overlay = layers.digest();
        assert_ne!(
            after_overlay.overlay_versions, after_midi.overlay_versions,
            "overlay realization must move the overlay digest (mid-cycle surfacing)"
        );
        assert_eq!(
            after_overlay.log_versions, after_midi.log_versions,
            "overlay realization must not move the log digest"
        );
    }

    #[test]
    fn record_evicts_oldest_past_capacity() {
        let mut store: LayerStore<ChannelHocketPlaybackEvent> =
            LayerStore::new(3, Retention::CapOnly);
        store.record((0..5).map(hocket_event));
        assert_eq!(store.len(), 3);
        assert_eq!(
            store.iter().map(|event| event.cycle).collect::<Vec<_>>(),
            vec![2, 3, 4]
        );
    }

    /// Conflict decisions get a monotonic sequence stamp that restarts when
    /// the layer clears — matching the historical record/clear behavior.
    #[test]
    fn conflict_sequence_stamps_and_resets_on_clear() {
        let mut layers = PlaybackLayers::default();
        layers.record_conflict_decisions(vec![conflict_decision(0), conflict_decision(960)], 960);
        let sequences: Vec<u64> = layers
            .parallel_conflict
            .iter()
            .map(|event| event.sequence)
            .collect();
        assert_eq!(sequences, vec![0, 1]);
        assert_eq!(
            layers
                .parallel_conflict
                .iter()
                .map(|event| (event.cycle, event.tick_in_cycle))
                .collect::<Vec<_>>(),
            vec![(0, 0), (1, 0)]
        );

        layers.clear_realized();
        layers.record_conflict_decisions(vec![conflict_decision(0)], 960);
        assert_eq!(
            layers
                .parallel_conflict
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            vec![0],
            "sequence numbering restarts after clear"
        );
    }
}
