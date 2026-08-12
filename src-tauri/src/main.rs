// Prevent an extra console window on Windows in release, does nothing on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use cseq_model::{
    automation_target_boundary_gati_weight, automation_target_boundary_jathi_weight,
    automation_target_boundary_probability, automation_target_initial_gati_weight,
    automation_target_initial_jathi_weight, automation_target_section_count_weight,
    automation_time_for_cycle_tick, is_allowed_jathi, AutomationSet, AutomationTime,
    AutomationValueKind, CustomDivision, CustomSubdivisionSpec, DurationKind, GatiAccentSpec,
    JathiAccentMode, PulseSpanKind, Rational, Score, SubdivisionInflection, SubdivisionPolicy,
    SubdivisionSwitchSpec, SwitchSeedMode, TransformKind, VelocityAccentRange,
    WeightedCustomPartCount, WeightedJathiChoice, WeightedSubdivisionChoice, WeightedSwitchCount,
    AUTOMATION_TARGET_BEAT_ACCENT_MAX, AUTOMATION_TARGET_BEAT_ACCENT_MIN,
    AUTOMATION_TARGET_JATHI_ACCENT_MAX, AUTOMATION_TARGET_JATHI_ACCENT_MIN,
    AUTOMATION_TARGET_PITCH, AUTOMATION_TARGET_SECTION_ACCENT_MAX,
    AUTOMATION_TARGET_SECTION_ACCENT_MIN, AUTOMATION_TARGET_TEMPO_BPM, AUTOMATION_TARGET_VELOCITY,
};
use cseq_rhythm::{ChannelHocketSpec, RhythmChoiceSource};
use cseq_transport::{
    ApplyQuantize, AutomationPlaybackEvent, AutomationPlaybackValue, ChannelConflictPolicy,
    ChannelHocketPlaybackEvent, ChannelLogicMatrixEntry, LogDigest, LogLayers, MidiDebugEvent,
    ParallelConflictDebugEvent, ParallelPlaybackConfig, ParallelPlaybackTrackConfig,
    RhythmPlaybackConfig, SeedPathPlaybackConfig, SeedPathPlaybackEntry, SeedPathWildcard,
    SynthChannelMode, SynthChannelProgram, TelemetryLogInterest, TimelineDigest, TimelineLayers,
    TrackFlowBoxConfig, Transport, TransportPositionSample, TransportSnapshot,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, State,
};
use tracing::{debug, error, info, warn};
use tracing_subscriber::EnvFilter;

#[cfg(feature = "e2e-harness")]
mod e2e_harness;
mod machine;

use machine::{
    autosave_path, load_machine_prefs, migrate_legacy_autosave, resolve_machine_dir,
    save_machine_prefs, MachinePrefs, MachinePrefsSource, MidiRouteState,
};

const MENU_ACTION_EVENT: &str = "native_menu_action";
const MENU_NEW_PATCH: &str = "new_patch";
const MENU_SAVE_PATCH: &str = "save_patch";
const MENU_SAVE_PATCH_AS: &str = "save_patch_as";
const MENU_RECALL_PATCH: &str = "recall_patch";
const MENU_RECALL_RECENT_PATCH: &str = "recall_recent_patch";
const MENU_EXPORT_SCORE: &str = "export_score";
const MENU_TOGGLE_AUTOSAVE: &str = "toggle_autosave";
const MENU_AUDIO_MIDI_SETUP: &str = "audio_midi_setup";
const MENU_SEED_STRATEGY: &str = "seed_strategy";
const MENU_TOGGLE_RHYTHM_SHAPER: &str = "toggle_rhythm_shaper";
const MENU_RESET_TRANSPORT_SYNC: &str = "reset_transport_sync";
const MENU_TOGGLE_SYNTH: &str = "toggle_synth";
const MENU_SYNTH_PROPERTIES: &str = "synth_properties";
const MENU_MIDI_PANIC: &str = "midi_panic";
const MENU_ACTION_NEW_PATCH: &str = "newPatch";
const MENU_ACTION_SAVE_PATCH: &str = "savePatch";
const MENU_ACTION_SAVE_PATCH_AS: &str = "savePatchAs";
const MENU_ACTION_RECALL_PATCH: &str = "recallPatch";
const MENU_ACTION_RECALL_RECENT_PATCH: &str = "recallRecentPatch";
const MENU_ACTION_EXPORT_SCORE: &str = "exportScore";
const MENU_ACTION_TOGGLE_AUTOSAVE: &str = "toggleAutosave";
const MENU_ACTION_OPEN_SETUP: &str = "openSetup";
const MENU_ACTION_OPEN_SEEDS: &str = "openSeeds";
const MENU_ACTION_TOGGLE_RHYTHM_SHAPER: &str = "toggleRhythmShaper";
const MENU_ACTION_RESET_TRANSPORT_SYNC: &str = "resetTransportSync";
const MENU_ACTION_TOGGLE_SYNTH: &str = "toggleSynth";
const MENU_ACTION_OPEN_SYNTH_PROPERTIES: &str = "openSynthProperties";
const MENU_ACTION_MIDI_PANIC: &str = "midiPanic";

// ---------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------

/// Shared application state. Held in Tauri's state container.
struct AppState {
    // Commands that wait for a scheduler acknowledgment clone this handle and
    // release the outer option lock first. That lets Stop enqueue while a
    // complex Play is still realizing its initial cycle.
    transport: Mutex<Option<Arc<Transport>>>,
    current_score: Mutex<Option<Score>>,
    /// Telemetry epoch + digest bookkeeping. Shared (via the `Arc<AppState>`)
    /// by the 60Hz emitter thread and `transport_get_snapshot` so streamed and
    /// initial-load epochs live in one monotonic space.
    telemetry: Mutex<TelemetryState>,
    /// Machine-local config directory (`$CAESURA_MACHINE_DIR` override, else
    /// the app config dir). Set once during setup/harness init; the temp
    /// fallback below only covers commands racing an aborted setup.
    machine_dir: std::sync::OnceLock<std::path::PathBuf>,
    machine_prefs: Mutex<MachinePrefs>,
    /// The source returned by the actual startup load. File existence alone
    /// cannot distinguish a valid prefs file from one that fell back after a
    /// parse error.
    machine_prefs_source: Mutex<MachinePrefsSource>,
    midi_route: Mutex<MidiRouteState>,
    /// Serializes the full snapshot -> enumerate/connect -> commit route
    /// transaction. Without this, a slow hot-plug reconcile for destination A
    /// can finish after a user has selected B and restore A physically.
    midi_route_reconcile: Mutex<()>,
}

impl AppState {
    fn new() -> Self {
        Self {
            transport: Mutex::new(None),
            current_score: Mutex::new(None),
            telemetry: Mutex::new(TelemetryState::default()),
            machine_dir: std::sync::OnceLock::new(),
            machine_prefs: Mutex::new(MachinePrefs::default()),
            machine_prefs_source: Mutex::new(MachinePrefsSource::Defaults),
            midi_route: Mutex::new(MidiRouteState::default()),
            midi_route_reconcile: Mutex::new(()),
        }
    }

    fn machine_dir(&self) -> std::path::PathBuf {
        self.machine_dir
            .get_or_init(|| resolve_machine_dir(None))
            .clone()
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        if let Some(transport) = self.transport.get_mut().take() {
            let _ = transport.shutdown_now();
        }
    }
}

/// Epoch counters and last-emitted digests for the telemetry sampler. The
/// emitter and `transport_get_snapshot` both mutate exactly one instance of
/// this behind `AppState::telemetry`.
#[derive(Default)]
struct TelemetryState {
    next_sample_epoch: u64,
    timeline_epoch: u64,
    log_epoch: u64,
    last_timeline_digest: Option<TimelineDigest>,
    last_log_digest: Option<LogDigest>,
    /// Signature of the last *emitted* position, so a stopped, unmoving
    /// transport stops re-emitting identical position events.
    last_position_sig: Option<PositionSig>,
    /// The currently requested rolling-log subset. Seed-only recording ignores
    /// high-rate MIDI/debug versions and payloads.
    log_interest: TelemetryLogInterest,
}

/// Cheap comparable fingerprint of a position, used only to suppress redundant
/// position events while the transport is stopped and unchanged.
#[derive(PartialEq)]
struct PositionSig {
    is_playing: bool,
    current_tick: u64,
    current_cycle: u64,
    ticks_per_cycle: u64,
    tempo_bits: u32,
    current_score_id: Option<String>,
    parallel: Vec<(usize, u64, u64)>,
}

impl PositionSig {
    fn of(position: &TransportPositionSample) -> Self {
        Self {
            is_playing: position.is_playing,
            current_tick: position.current_tick,
            current_cycle: position.current_cycle,
            ticks_per_cycle: position.ticks_per_cycle,
            tempo_bits: position.tempo_bpm.to_bits(),
            current_score_id: position.current_score_id.clone(),
            parallel: position
                .parallel_track_positions
                .iter()
                .map(|p| (p.track_index, p.cycle, p.tick_in_cycle))
                .collect(),
        }
    }
}

// ---------------------------------------------------------------------
// DTOs for the TS bridge
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotDto {
    /// Telemetry epochs, stamped by `transport_get_snapshot` so the initial
    /// hydrate shares the streamed payloads' monotonic epoch space. The
    /// `From<TransportSnapshot>` path leaves these at 0; only the command path
    /// sets them.
    sample_epoch: u64,
    timeline_epoch: u64,
    log_epoch: u64,
    tempo_bpm: f32,
    is_playing: bool,
    current_tick: u64,
    current_cycle: u64,
    ticks_per_cycle: u64,
    current_score_id: Option<String>,
    parallel_track_positions: Vec<ParallelTrackPositionDto>,
    midi_debug_events: Vec<MidiDebugEventDto>,
    automation_events: Vec<AutomationPlaybackEventDto>,
    channel_hocket_events: Vec<ChannelHocketPlaybackEventDto>,
    seed_trace_events: Vec<PlaybackSeedTraceEventDto>,
    parallel_conflict_events: Vec<ParallelConflictDebugEventDto>,
    trigger_decision_events: Vec<TriggerDecisionEventDto>,
    realized_rhythm_events: Vec<RealizedRhythmSpanEventDto>,
    track_flow_events: Vec<TrackFlowPlaybackEventDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParallelTrackPositionDto {
    track_index: usize,
    track_id: String,
    track_name: String,
    cycle: u64,
    tick_in_cycle: u64,
    ticks_per_cycle: u64,
    reference_start_tick: u64,
    reference_end_tick: u64,
}

impl From<cseq_transport::ParallelTrackPosition> for ParallelTrackPositionDto {
    fn from(position: cseq_transport::ParallelTrackPosition) -> Self {
        Self {
            track_index: position.track_index,
            track_id: position.track_id,
            track_name: position.track_name,
            cycle: position.cycle,
            tick_in_cycle: position.tick_in_cycle,
            ticks_per_cycle: position.ticks_per_cycle,
            reference_start_tick: position.reference_start_tick,
            reference_end_tick: position.reference_end_tick,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiDebugEventDto {
    sequence: u64,
    absolute_tick: u64,
    cycle: u64,
    tick_in_cycle: u64,
    channel: Option<u8>,
    message_type: String,
    data1: Option<u8>,
    data2: Option<u8>,
    bytes: Vec<u8>,
    debug_source: Option<String>,
    monitor_bus: Option<String>,
    monitor_user_channel: Option<u8>,
    monitor_mode: Option<String>,
    monitor_program: Option<u8>,
    monitor_drum_note: Option<u8>,
    monitor_bytes: Option<Vec<u8>>,
    parallel_track_id: Option<String>,
    parallel_track_name: Option<String>,
    parallel_conflict_policy: Option<String>,
    parallel_conflict_action: Option<String>,
    parallel_conflict_group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParallelConflictDebugEventDto {
    sequence: u64,
    absolute_tick: u64,
    cycle: u64,
    tick_in_cycle: u64,
    output_channel: u8,
    pitch: u8,
    start_tick: u64,
    end_tick: u64,
    track_id: String,
    track_name: String,
    track_index: usize,
    conflict_policy: String,
    conflict_action: String,
    conflict_group_id: String,
    colliding_track_ids: Vec<String>,
    active_track_count: usize,
    passed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationPlaybackValueDto {
    target: String,
    value: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationPlaybackEventDto {
    sequence: u64,
    cycle: u64,
    beat_index: u32,
    tick_in_cycle: u64,
    automation_phase: AutomationTime,
    values: Vec<AutomationPlaybackValueDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealizedRhythmSpanEventDto {
    cycle: u64,
    parallel_track_index: Option<usize>,
    parallel_track_id: Option<String>,
    span: cseq_rhythm::ResolvedRhythmSpan,
}

impl From<cseq_transport::RealizedRhythmSpanEvent> for RealizedRhythmSpanEventDto {
    fn from(event: cseq_transport::RealizedRhythmSpanEvent) -> Self {
        Self {
            cycle: event.cycle,
            parallel_track_index: event.parallel_track_index,
            parallel_track_id: event.parallel_track_id,
            span: event.span,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackFlowPlaybackEventDto {
    cycle: u64,
    reference_start_tick: u64,
    lane_id: String,
    source_track_id: String,
    source_track_name: String,
}

impl From<cseq_transport::TrackFlowPlaybackEvent> for TrackFlowPlaybackEventDto {
    fn from(event: cseq_transport::TrackFlowPlaybackEvent) -> Self {
        Self {
            cycle: event.cycle,
            reference_start_tick: event.reference_start_tick,
            lane_id: event.lane_id,
            source_track_id: event.source_track_id,
            source_track_name: event.source_track_name,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelHocketPlaybackEventDto {
    cycle: u64,
    start_tick: u64,
    end_tick: u64,
    channel: u8,
    source: RhythmChoiceSource,
    fallback: bool,
    position_rule_id: Option<String>,
    position_rule_label: Option<String>,
    position_scope: Option<cseq_rhythm::ChannelPositionScope>,
    position_nth: Option<u32>,
    position_action: Option<cseq_rhythm::ChannelPositionAction>,
    parallel_track_index: Option<usize>,
    parallel_track_id: Option<String>,
    parallel_track_name: Option<String>,
    suppressed: bool,
}

/// A full-width seed at the JavaScript boundary.
///
/// Rust -> JavaScript always emits an unsigned decimal string because a JSON
/// number cannot represent every `u64` exactly. JavaScript -> Rust accepts the
/// canonical string and legacy non-negative JSON integers so existing saved
/// seed paths remain readable. The wrapper is confined to DTOs; the transport
/// and rhythm engines continue to use `u64` directly.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct LosslessSeed(u64);

impl From<u64> for LosslessSeed {
    fn from(value: u64) -> Self {
        Self(value)
    }
}

impl From<LosslessSeed> for u64 {
    fn from(value: LosslessSeed) -> Self {
        value.0
    }
}

impl Serialize for LosslessSeed {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for LosslessSeed {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct LosslessSeedVisitor;

        impl<'de> serde::de::Visitor<'de> for LosslessSeedVisitor {
            type Value = LosslessSeed;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("an unsigned 64-bit integer or its decimal string")
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(LosslessSeed(value))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                u64::try_from(value)
                    .map(LosslessSeed)
                    .map_err(|_| E::custom("seed must not be negative"))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                value
                    .parse::<u64>()
                    .map(LosslessSeed)
                    .map_err(|_| E::custom("seed string must be a decimal u64"))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                self.visit_str(&value)
            }
        }

        deserializer.deserialize_any(LosslessSeedVisitor)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackSeedTraceEventDto {
    cycle: u64,
    domain: String,
    label: String,
    seed: LosslessSeed,
    base_seed: Option<LosslessSeed>,
    source: String,
    history_before: Vec<LosslessSeed>,
    history_after: Vec<LosslessSeed>,
    parallel_track_index: Option<usize>,
    track_id: Option<String>,
}

impl From<MidiDebugEvent> for MidiDebugEventDto {
    fn from(event: MidiDebugEvent) -> Self {
        Self {
            sequence: event.sequence,
            absolute_tick: event.absolute_tick,
            cycle: event.cycle,
            tick_in_cycle: event.tick_in_cycle,
            channel: event.channel,
            message_type: event.message_type,
            data1: event.data1,
            data2: event.data2,
            bytes: event.bytes,
            debug_source: event.debug_source,
            monitor_bus: event.monitor_bus,
            monitor_user_channel: event.monitor_user_channel,
            monitor_mode: event.monitor_mode,
            monitor_program: event.monitor_program,
            monitor_drum_note: event.monitor_drum_note,
            monitor_bytes: event.monitor_bytes,
            parallel_track_id: event.parallel_track_id,
            parallel_track_name: event.parallel_track_name,
            parallel_conflict_policy: event.parallel_conflict_policy,
            parallel_conflict_action: event.parallel_conflict_action,
            parallel_conflict_group_id: event.parallel_conflict_group_id,
        }
    }
}

impl From<ParallelConflictDebugEvent> for ParallelConflictDebugEventDto {
    fn from(event: ParallelConflictDebugEvent) -> Self {
        Self {
            sequence: event.sequence,
            absolute_tick: event.absolute_tick,
            cycle: event.cycle,
            tick_in_cycle: event.tick_in_cycle,
            output_channel: event.output_channel,
            pitch: event.pitch,
            start_tick: event.start_tick,
            end_tick: event.end_tick,
            track_id: event.track_id,
            track_name: event.track_name,
            track_index: event.track_index,
            conflict_policy: event.conflict_policy,
            conflict_action: event.conflict_action,
            conflict_group_id: event.conflict_group_id,
            colliding_track_ids: event.colliding_track_ids,
            active_track_count: event.active_track_count,
            passed: event.passed,
        }
    }
}

impl From<AutomationPlaybackValue> for AutomationPlaybackValueDto {
    fn from(value: AutomationPlaybackValue) -> Self {
        Self {
            target: value.target,
            value: value.value,
        }
    }
}

impl From<AutomationPlaybackEvent> for AutomationPlaybackEventDto {
    fn from(event: AutomationPlaybackEvent) -> Self {
        Self {
            sequence: event.sequence,
            cycle: event.cycle,
            beat_index: event.beat_index,
            tick_in_cycle: event.tick_in_cycle,
            automation_phase: event.automation_phase,
            values: event
                .values
                .into_iter()
                .map(AutomationPlaybackValueDto::from)
                .collect(),
        }
    }
}

impl From<ChannelHocketPlaybackEvent> for ChannelHocketPlaybackEventDto {
    fn from(event: ChannelHocketPlaybackEvent) -> Self {
        Self {
            cycle: event.cycle,
            start_tick: event.start_tick,
            end_tick: event.end_tick,
            channel: event.channel,
            source: event.source,
            fallback: event.fallback,
            position_rule_id: event.position_rule_id,
            position_rule_label: event.position_rule_label,
            position_scope: event.position_scope,
            position_nth: event.position_nth,
            position_action: event.position_action,
            parallel_track_index: event.parallel_track_index,
            parallel_track_id: event.parallel_track_id,
            parallel_track_name: event.parallel_track_name,
            suppressed: event.suppressed,
        }
    }
}

impl From<cseq_transport::PlaybackSeedTraceEvent> for PlaybackSeedTraceEventDto {
    fn from(event: cseq_transport::PlaybackSeedTraceEvent) -> Self {
        Self {
            cycle: event.cycle,
            domain: event.domain,
            label: event.label,
            seed: event.seed.into(),
            base_seed: event.base_seed.map(LosslessSeed::from),
            source: event.source,
            history_before: event
                .history_before
                .into_iter()
                .map(LosslessSeed::from)
                .collect(),
            history_after: event
                .history_after
                .into_iter()
                .map(LosslessSeed::from)
                .collect(),
            parallel_track_index: event.parallel_track_index,
            track_id: event.track_id,
        }
    }
}

impl From<TransportSnapshot> for SnapshotDto {
    fn from(s: TransportSnapshot) -> Self {
        Self {
            sample_epoch: 0,
            timeline_epoch: 0,
            log_epoch: 0,
            tempo_bpm: s.tempo_bpm,
            is_playing: s.is_playing,
            current_tick: s.current_tick,
            current_cycle: s.current_cycle,
            ticks_per_cycle: s.ticks_per_cycle,
            current_score_id: s.current_score_id,
            parallel_track_positions: s
                .parallel_track_positions
                .into_iter()
                .map(ParallelTrackPositionDto::from)
                .collect(),
            midi_debug_events: s
                .midi_debug_events
                .into_iter()
                .map(MidiDebugEventDto::from)
                .collect(),
            automation_events: s
                .automation_events
                .into_iter()
                .map(AutomationPlaybackEventDto::from)
                .collect(),
            channel_hocket_events: s
                .channel_hocket_events
                .into_iter()
                .map(ChannelHocketPlaybackEventDto::from)
                .collect(),
            seed_trace_events: s
                .seed_trace_events
                .into_iter()
                .map(PlaybackSeedTraceEventDto::from)
                .collect(),
            parallel_conflict_events: s
                .parallel_conflict_events
                .into_iter()
                .map(ParallelConflictDebugEventDto::from)
                .collect(),
            trigger_decision_events: s
                .trigger_decision_events
                .into_iter()
                .map(TriggerDecisionEventDto::from)
                .collect(),
            realized_rhythm_events: s
                .realized_rhythm_events
                .into_iter()
                .map(RealizedRhythmSpanEventDto::from)
                .collect(),
            track_flow_events: s
                .track_flow_events
                .into_iter()
                .map(TrackFlowPlaybackEventDto::from)
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TriggerDecisionEventDto {
    track_index: usize,
    track_id: String,
    track_name: String,
    source_cycle_index: u64,
    matched_beat: u32,
    event_tick: u64,
    candidate_tick: u64,
    start_kind: String,
    outcome: String,
    suppress_reason: Option<String>,
    launch_tick: Option<u64>,
    run_index: Option<u32>,
    roll_value: Option<u16>,
    roll_threshold: Option<u16>,
    roll_passed: Option<bool>,
    consecutive_misses: u32,
    last_accept_source_cycle: Option<u64>,
}

impl From<cseq_transport::TriggerDecisionEvent> for TriggerDecisionEventDto {
    fn from(e: cseq_transport::TriggerDecisionEvent) -> Self {
        Self {
            track_index: e.track_index,
            track_id: e.track_id,
            track_name: e.track_name,
            source_cycle_index: e.source_cycle_index,
            matched_beat: e.matched_beat,
            event_tick: e.event_tick,
            candidate_tick: e.candidate_tick,
            start_kind: e.start_kind,
            outcome: e.outcome,
            suppress_reason: e.suppress_reason,
            launch_tick: e.launch_tick,
            run_index: e.run_index,
            roll_value: e.roll_value,
            roll_threshold: e.roll_threshold,
            roll_passed: e.roll_passed,
            consecutive_misses: e.consecutive_misses,
            last_accept_source_cycle: e.last_accept_source_cycle,
        }
    }
}

// ---------------------------------------------------------------------
// Telemetry payload DTOs (one sampler, three payload classes)
// ---------------------------------------------------------------------

/// High-frequency playhead clock. Tiny, latest-wins.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransportPositionDto {
    sample_epoch: u64,
    timeline_epoch: u64,
    tempo_bpm: f32,
    is_playing: bool,
    current_tick: u64,
    current_cycle: u64,
    ticks_per_cycle: u64,
    current_score_id: Option<String>,
    parallel_track_positions: Vec<ParallelTrackPositionDto>,
}

impl TransportPositionDto {
    fn build(sample_epoch: u64, timeline_epoch: u64, position: &TransportPositionSample) -> Self {
        Self {
            sample_epoch,
            timeline_epoch,
            tempo_bpm: position.tempo_bpm,
            is_playing: position.is_playing,
            current_tick: position.current_tick,
            current_cycle: position.current_cycle,
            ticks_per_cycle: position.ticks_per_cycle,
            current_score_id: position.current_score_id.clone(),
            parallel_track_positions: position
                .parallel_track_positions
                .iter()
                .cloned()
                .map(ParallelTrackPositionDto::from)
                .collect(),
        }
    }
}

/// Render-relevant timeline data (cycle-coherent overlays), no rolling logs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransportTimelineSnapshotDto {
    sample_epoch: u64,
    timeline_epoch: u64,
    tempo_bpm: f32,
    is_playing: bool,
    current_tick: u64,
    current_cycle: u64,
    ticks_per_cycle: u64,
    current_score_id: Option<String>,
    parallel_track_positions: Vec<ParallelTrackPositionDto>,
    channel_hocket_events: Vec<ChannelHocketPlaybackEventDto>,
    realized_rhythm_events: Vec<RealizedRhythmSpanEventDto>,
    track_flow_events: Vec<TrackFlowPlaybackEventDto>,
}

impl TransportTimelineSnapshotDto {
    fn build(
        sample_epoch: u64,
        timeline_epoch: u64,
        position: &TransportPositionSample,
        layers: &TimelineLayers,
    ) -> Self {
        Self {
            sample_epoch,
            timeline_epoch,
            tempo_bpm: position.tempo_bpm,
            is_playing: position.is_playing,
            current_tick: position.current_tick,
            current_cycle: position.current_cycle,
            ticks_per_cycle: position.ticks_per_cycle,
            current_score_id: position.current_score_id.clone(),
            parallel_track_positions: position
                .parallel_track_positions
                .iter()
                .cloned()
                .map(ParallelTrackPositionDto::from)
                .collect(),
            channel_hocket_events: layers
                .channel_hocket_events
                .iter()
                .cloned()
                .map(ChannelHocketPlaybackEventDto::from)
                .collect(),
            realized_rhythm_events: layers
                .realized_rhythm_events
                .iter()
                .cloned()
                .map(RealizedRhythmSpanEventDto::from)
                .collect(),
            track_flow_events: layers
                .track_flow_events
                .iter()
                .cloned()
                .map(TrackFlowPlaybackEventDto::from)
                .collect(),
        }
    }
}

/// Lower-priority diagnostic/trace data, gated on log interest.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransportLogSnapshotDto {
    sample_epoch: u64,
    log_epoch: u64,
    timeline_epoch: u64,
    /// The exact subset represented by the arrays below. Tagging the payload
    /// prevents an in-flight narrower snapshot from being mistaken for a full
    /// snapshot while frontend interest is changing.
    log_interest: String,
    midi_debug_events: Vec<MidiDebugEventDto>,
    automation_events: Vec<AutomationPlaybackEventDto>,
    seed_trace_events: Vec<PlaybackSeedTraceEventDto>,
    parallel_conflict_events: Vec<ParallelConflictDebugEventDto>,
    trigger_decision_events: Vec<TriggerDecisionEventDto>,
}

impl TransportLogSnapshotDto {
    fn build(
        sample_epoch: u64,
        log_epoch: u64,
        timeline_epoch: u64,
        log_interest: TelemetryLogInterest,
        layers: &LogLayers,
    ) -> Self {
        Self {
            sample_epoch,
            log_epoch,
            timeline_epoch,
            log_interest: log_interest.as_str().to_string(),
            midi_debug_events: layers
                .midi_debug_events
                .iter()
                .cloned()
                .map(MidiDebugEventDto::from)
                .collect(),
            automation_events: layers
                .automation_events
                .iter()
                .cloned()
                .map(AutomationPlaybackEventDto::from)
                .collect(),
            seed_trace_events: layers
                .seed_trace_events
                .iter()
                .cloned()
                .map(PlaybackSeedTraceEventDto::from)
                .collect(),
            parallel_conflict_events: layers
                .parallel_conflict_events
                .iter()
                .cloned()
                .map(ParallelConflictDebugEventDto::from)
                .collect(),
            trigger_decision_events: layers
                .trigger_decision_events
                .iter()
                .cloned()
                .map(TriggerDecisionEventDto::from)
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubdivisionWeightDto {
    subdivision: u32,
    weight: f32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct JathiWeightDto {
    jathi: u32,
    weight: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomDivisionDto {
    #[serde(default)]
    gati_weights: Vec<SubdivisionWeightDto>,
}

fn default_equal_parts_weight_dto() -> f32 {
    1.0
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomPartCountDto {
    count: u32,
    weight: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomSubdivisionDto {
    #[serde(default)]
    per_beat_weight: f32,
    #[serde(default = "default_equal_parts_weight_dto")]
    equal_parts_weight: f32,
    #[serde(default)]
    part_count_weights: Vec<CustomPartCountDto>,
    #[serde(default)]
    part_gati_weights: Vec<SubdivisionWeightDto>,
    #[serde(default)]
    divisions: Vec<CustomDivisionDto>,
    // Legacy only. Regular section jathi weights drive jathi for both per-beat
    // and equal-parts modes.
    #[serde(default)]
    jathi_weights: Vec<JathiWeightDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InflectionDto {
    #[serde(default)]
    id: Option<String>,
    position: f64,
    change_probability: f32,
    subdivision_weights: Vec<SubdivisionWeightDto>,
    #[serde(default)]
    jathi_weights: Vec<JathiWeightDto>,
    #[serde(default)]
    custom_subdivision: Option<CustomSubdivisionDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwitchCountWeightDto {
    count: u32,
    weight: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VelocityAccentRangeDto {
    min: u8,
    max: u8,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccentSettingsDto {
    beat_start: VelocityAccentRangeDto,
    section_start_extra: VelocityAccentRangeDto,
    #[serde(default = "default_jathi_start_dto")]
    jathi_start: VelocityAccentRangeDto,
    #[serde(default = "default_jathi_mode_dto")]
    jathi_mode: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubdivisionSwitchRequestDto {
    name: String,
    cycle_beats: u32,
    initial_weights: Vec<SubdivisionWeightDto>,
    #[serde(default)]
    initial_jathi_weights: Vec<JathiWeightDto>,
    #[serde(default)]
    initial_custom_subdivision: Option<CustomSubdivisionDto>,
    #[serde(default)]
    automation: Option<AutomationSet>,
    inflections: Vec<InflectionDto>,
    switch_count_weights: Vec<SwitchCountWeightDto>,
    seed_mode: String,
    seed: u64,
    #[serde(with = "cseq_model::lossless_u64_vec_serde")]
    history_seeds: Vec<u64>,
    history_weight: f32,
    new_seed_weight: f32,
    max_history: usize,
    accent: AccentSettingsDto,
    pitch: u8,
    velocity: u8,
}

#[derive(Debug, Clone)]
struct AutomationPreviewBases {
    tempo_bpm: f32,
    pitch: u8,
    velocity: u8,
    accent: GatiAccentSpec,
}

#[derive(Debug, Clone, Copy)]
struct PreviewFrame {
    node_id: u64,
    start_fraction: Rational,
    duration_fraction: Rational,
    division_index: Option<u32>,
    division_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationBeatValueDto {
    target: String,
    value: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedBeatDto {
    /// One-based beat number in the cycle.
    beat: u32,
    /// Inclusive start (fraction of cycle), in `[0, 1)`.
    start: f64,
    /// Exclusive end (fraction of cycle), in `(0, 1]`.
    end: f64,
    /// The resolved native gati for this beat.
    gati: u32,
    /// Number of actual matras inside the beat.
    effective_gati: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    division_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    division_count: Option<u32>,
    section_index: u32,
    jathi: Option<u32>,
    section_start: bool,
    accent_velocity: u8,
    pitch: u8,
    base_velocity: u8,
    automation_phase: AutomationTime,
    automation_values: Vec<AutomationBeatValueDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubdivisionSwitchPreviewDto {
    cycle: u64,
    beats: Vec<ResolvedBeatDto>,
    pulse_spans: Vec<PulseSpanDto>,
    #[serde(serialize_with = "cseq_model::lossless_u64_vec_serde::serialize")]
    history_seeds: Vec<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PulseSpanDto {
    id: u64,
    kind: String,
    section_index: Option<u32>,
    beat: Option<u32>,
    gati: Option<u32>,
    jathi: Option<u32>,
    index: Option<u32>,
    start: f64,
    duration: f64,
    start_matra: u32,
    matra_len: u32,
    subdivision: Option<u32>,
    protected_cuts: Vec<u32>,
    tags: Vec<String>,
    /// Authored-leaf velocity per span-local matra (accents included), from
    /// `cseq_transport::rhythm_span_matra_velocities` — the realization's own
    /// leaf-inheritance rule. Empty for section spans. The UI forwards these to
    /// `generator_preview` so its per-cell velocities match realized playback.
    matra_velocities: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneratorPreviewRequestDto {
    spans: Vec<cseq_rhythm::GeneratorSpanInput>,
    enabled: bool,
    generator: cseq_rhythm::GeneratorConfig,
    cycle: u64,
    cycle_beats: u32,
    #[serde(default)]
    automation: Option<AutomationSet>,
    #[serde(default)]
    track_id: Option<String>,
    /// Authored per-matra velocities for the request spans, forwarded from the
    /// structure preview's `matraVelocities`. Optional: legacy requests omit it
    /// and simply get cells without velocities. Kept beside `spans` (not inside
    /// `GeneratorSpanInput`) so generator identity never sees display metadata.
    #[serde(default)]
    span_velocities: Vec<GeneratorSpanVelocitiesDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneratorSpanVelocitiesDto {
    span_id: u64,
    velocities: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneratorPreviewDto {
    seed: cseq_rhythm::GeneratorSeedResolution,
    spans: Vec<cseq_rhythm::ResolvedRhythmSpan>,
    /// Authoring-only Dum-Ka evolution observability. Other generators,
    /// disabled resolution, and cycle zero return an empty vector.
    #[serde(default)]
    trace: Vec<cseq_rhythm::DirectiveTraceEntry>,
    /// Cycle-effective rail after automation and the last applicable
    /// directive override. Other generators and legacy responses omit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    density_corridor: Option<cseq_rhythm::DensityCorridorRange>,
    /// Whole-cycle realized perceptual distance (requested cycle vs the
    /// previous cycle's state) for Dum-Ka previews — the calibration
    /// readout. Absent for other generators, disabled resolution, cycle 0,
    /// and grids without published Barlow tables.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cycle_distance: Option<cseq_rhythm::PerceptualCycleDistance>,
}

const MAX_STOPPED_PREVIEW_CYCLE: u64 = 10_000;
const LIVE_PREVIEW_CYCLE_RADIUS: u64 = 2;

fn validate_generator_javascript_number_boundary(
    generator: &cseq_rhythm::GeneratorConfig,
) -> Result<(), String> {
    let cseq_rhythm::GeneratorConfig::Dumka(params) = generator else {
        return Ok(());
    };
    if let Some(directive) = params
        .plan
        .iter()
        .find(|directive| directive.id > JS_MAX_SAFE_INTEGER_U64)
    {
        return Err(format!(
            "dumka plan invalid: directive id {} exceeds JavaScript MAX_SAFE_INTEGER {}",
            directive.id, JS_MAX_SAFE_INTEGER_U64
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackPlaybackRequestDto {
    generator_enabled: bool,
    generator: cseq_rhythm::GeneratorConfig,
    #[serde(default = "default_midi_output_channel")]
    midi_output_channel: u8,
    #[serde(default)]
    automation: Option<AutomationSet>,
    #[serde(default)]
    channel_hocket_enabled: bool,
    #[serde(default)]
    channel_hocket: Option<ChannelHocketSpec>,
    #[serde(default)]
    seed_path: Option<SeedPathPlaybackConfigDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParallelPlaybackRequestDto {
    tracks: Vec<ParallelPlaybackTrackRequestDto>,
    reference_tempo_bpm: f32,
    reference_cycle_beats: u32,
    channel_conflict_policy: ChannelConflictPolicyDto,
    #[serde(default)]
    channel_logic_matrix: Vec<ChannelLogicMatrixEntryDto>,
    #[serde(default)]
    conflict_priority: Vec<String>,
    /// The project's Track Flow boxes. Empty/absent ⇒ pure parallel playback.
    /// Each box is one synthetic sequential lane (`track-flow-<id>`).
    #[serde(default)]
    track_flow_boxes: Vec<TrackFlowBoxRequestDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackFlowBoxRequestDto {
    /// Authored box id; the conflict lane id derives as `track-flow-<id>`.
    id: String,
    /// Display / snapshot label for the box's lane.
    #[serde(default)]
    name: String,
    /// Candidate source tracks (audible members only), realized like ordinary
    /// parallel tracks.
    sources: Vec<ParallelPlaybackTrackRequestDto>,
    /// Explicit Markov chain over the (audible) sources, indexed in `sources`
    /// order. Absent ⇒ the transport builds a uniform first-order chain.
    #[serde(default)]
    spec: Option<TrackFlowSpecDto>,
    /// Per-box chain RNG seed.
    #[serde(default)]
    seed: u64,
}

/// Wire form of `trackflow::TrackFlowSpec`. The transport's Track Flow types do
/// not derive serde (cseq-transport has no serde dependency), so the chain is
/// deserialized here and converted, mirroring `ChannelLogicMatrixEntryDto`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackFlowSpecDto {
    order: cseq_rhythm::MarkovOrder,
    state_count: u32,
    #[serde(default)]
    transitions: Vec<TrackFlowTransitionDto>,
    #[serde(default)]
    fallback: u32,
    #[serde(default)]
    fallback_weights: Vec<TrackFlowFallbackWeightDto>,
    #[serde(default)]
    entry_weights: Vec<TrackFlowEntryWeightDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackFlowTransitionDto {
    from: Vec<u32>,
    to: u32,
    weight: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackFlowEntryWeightDto {
    states: Vec<u32>,
    weight: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackFlowFallbackWeightDto {
    state: u32,
    weight: u32,
}

impl From<TrackFlowSpecDto> for cseq_transport::trackflow::TrackFlowSpec {
    fn from(value: TrackFlowSpecDto) -> Self {
        Self {
            order: value.order,
            state_count: value.state_count,
            transitions: value
                .transitions
                .into_iter()
                .map(|t| cseq_transport::trackflow::TrackFlowTransition {
                    from: t.from,
                    to: t.to,
                    weight: t.weight,
                })
                .collect(),
            fallback: value.fallback,
            fallback_weights: value
                .fallback_weights
                .into_iter()
                .map(|f| cseq_transport::trackflow::TrackFlowFallbackWeight {
                    state: f.state,
                    weight: f.weight,
                })
                .collect(),
            entry_weights: value
                .entry_weights
                .into_iter()
                .map(|e| cseq_transport::trackflow::TrackFlowEntryWeight {
                    states: e.states,
                    weight: e.weight,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParallelPlaybackTrackRequestDto {
    id: String,
    #[serde(default)]
    name: String,
    score: SubdivisionSwitchRequestDto,
    #[serde(alias = "rhythm")]
    playback: TrackPlaybackRequestDto,
    tempo_bpm: f32,
    /// Triggered-track config. Absent/`null` ⇒ continuous. The transport
    /// normalizes the trigger graph (self/dangling/non-continuous-source
    /// rejection) when it builds the runtime, so the DTO passes it through as-is.
    #[serde(default)]
    trigger: Option<cseq_trigger::TriggerConfig>,
    /// Silent source: realize for structure (to drive a follower) but suppress
    /// audible output. The frontend sets this for a muted track that another
    /// audible track triggers on. Default `false`.
    #[serde(default)]
    silent: bool,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ChannelConflictPolicyDto {
    ForceOn,
    ForceOff,
    AllowAll,
    Or,
    RandomOne,
    Alternate,
    PriorityOrder,
    Xor,
    Xnor,
    And,
    Nand,
    Nor,
    Even,
    Odd,
    OneHigh,
    OneLow,
    Majority,
    Minority,
}

impl From<ChannelConflictPolicyDto> for ChannelConflictPolicy {
    fn from(value: ChannelConflictPolicyDto) -> Self {
        match value {
            ChannelConflictPolicyDto::ForceOn => ChannelConflictPolicy::ForceOn,
            ChannelConflictPolicyDto::ForceOff => ChannelConflictPolicy::ForceOff,
            ChannelConflictPolicyDto::AllowAll => ChannelConflictPolicy::AllowAll,
            ChannelConflictPolicyDto::Or => ChannelConflictPolicy::Or,
            ChannelConflictPolicyDto::RandomOne => ChannelConflictPolicy::RandomOne,
            ChannelConflictPolicyDto::Alternate => ChannelConflictPolicy::Alternate,
            ChannelConflictPolicyDto::PriorityOrder => ChannelConflictPolicy::PriorityOrder,
            ChannelConflictPolicyDto::Xor => ChannelConflictPolicy::Xor,
            ChannelConflictPolicyDto::Xnor => ChannelConflictPolicy::Xnor,
            ChannelConflictPolicyDto::And => ChannelConflictPolicy::And,
            ChannelConflictPolicyDto::Nand => ChannelConflictPolicy::Nand,
            ChannelConflictPolicyDto::Nor => ChannelConflictPolicy::Nor,
            ChannelConflictPolicyDto::Even => ChannelConflictPolicy::Even,
            ChannelConflictPolicyDto::Odd => ChannelConflictPolicy::Odd,
            ChannelConflictPolicyDto::OneHigh => ChannelConflictPolicy::OneHigh,
            ChannelConflictPolicyDto::OneLow => ChannelConflictPolicy::OneLow,
            ChannelConflictPolicyDto::Majority => ChannelConflictPolicy::Majority,
            ChannelConflictPolicyDto::Minority => ChannelConflictPolicy::Minority,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelLogicMatrixEntryDto {
    track_a_id: String,
    track_b_id: String,
    #[serde(default)]
    output_channel: Option<u8>,
    policy: ChannelConflictPolicyDto,
}

impl From<ChannelLogicMatrixEntryDto> for ChannelLogicMatrixEntry {
    fn from(value: ChannelLogicMatrixEntryDto) -> Self {
        Self {
            track_a_id: value.track_a_id,
            track_b_id: value.track_b_id,
            output_channel: value.output_channel,
            policy: value.policy.into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedPathPlaybackConfigDto {
    #[serde(default)]
    entries: Vec<SeedPathPlaybackEntryDto>,
    #[serde(default)]
    wildcards: Vec<SeedPathWildcardDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedPathPlaybackEntryDto {
    cycle: u64,
    domain: String,
    label: String,
    seed: LosslessSeed,
    #[serde(default)]
    base_seed: Option<LosslessSeed>,
    source: String,
    #[serde(default)]
    history_before: Vec<LosslessSeed>,
    #[serde(default)]
    history_after: Vec<LosslessSeed>,
    #[serde(default)]
    track_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedPathWildcardDto {
    domain: String,
    #[serde(default)]
    cycle: Option<u64>,
    #[serde(default)]
    track_id: Option<String>,
}

impl From<SeedPathPlaybackConfigDto> for SeedPathPlaybackConfig {
    fn from(value: SeedPathPlaybackConfigDto) -> Self {
        Self {
            entries: value
                .entries
                .into_iter()
                .map(SeedPathPlaybackEntry::from)
                .collect(),
            wildcards: value
                .wildcards
                .into_iter()
                .map(SeedPathWildcard::from)
                .collect(),
        }
    }
}

impl From<SeedPathPlaybackEntryDto> for SeedPathPlaybackEntry {
    fn from(value: SeedPathPlaybackEntryDto) -> Self {
        Self {
            cycle: value.cycle,
            domain: value.domain,
            label: value.label,
            seed: value.seed.into(),
            base_seed: value.base_seed.map(u64::from),
            source: value.source,
            history_before: value.history_before.into_iter().map(u64::from).collect(),
            history_after: value.history_after.into_iter().map(u64::from).collect(),
            track_id: value.track_id,
        }
    }
}

impl From<SeedPathWildcardDto> for SeedPathWildcard {
    fn from(value: SeedPathWildcardDto) -> Self {
        Self {
            domain: value.domain,
            cycle: value.cycle,
            track_id: value.track_id,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SynthChannelProgramDto {
    channel: u8,
    #[serde(default = "default_synth_channel_mode")]
    mode: SynthChannelModeDto,
    program: u8,
    #[serde(default = "default_synth_drum_note")]
    drum_note: u8,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SynthChannelModeDto {
    Melodic,
    Percussion,
}

const PATCH_APP_ID: &str = "Dum-Ka";
/// First fork-owned patch and track schema. No CarnaticSeq migrations exist.
const PATCH_SCHEMA_VERSION: u64 = 1;
/// Largest integer JavaScript can represent exactly. Evolution directive ids
/// cross the authoring bridge as JSON numbers and salt deterministic draws, so
/// accepting a larger Rust `u64` would let the browser silently alias identity.
const JS_MAX_SAFE_INTEGER_U64: u64 = 9_007_199_254_740_991;

fn default_midi_output_channel() -> u8 {
    1
}

fn default_synth_channel_mode() -> SynthChannelModeDto {
    SynthChannelModeDto::Melodic
}

fn default_synth_drum_note() -> u8 {
    36
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

#[tauri::command]
fn transport_play(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let transport = state
        .transport
        .lock()
        .as_ref()
        .cloned()
        .ok_or("transport not initialized")?;
    transport.play().map_err(|e| e.to_string())
}

#[tauri::command]
fn transport_stop(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let transport = state
        .transport
        .lock()
        .as_ref()
        .cloned()
        .ok_or("transport not initialized")?;
    transport.stop().map_err(|e| e.to_string())
}

/// Silence everything (explicit note-offs + CC123 sweep + synth) without
/// stopping the transport — the desktop-sequencer "MIDI panic".
#[tauri::command]
fn transport_panic(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let transport = state
        .transport
        .lock()
        .as_ref()
        .cloned()
        .ok_or("transport not initialized")?;
    transport.panic().map_err(|e| e.to_string())
}

/// Enumerate CoreMIDI destinations. Empty on machines without MIDI.
#[tauri::command]
fn midi_list_destinations() -> Result<Vec<cseq_transport::MidiDestination>, String> {
    Ok(cseq_transport::list_midi_destinations())
}

/// Pick the routed destination (`None` = virtual-only), persist it in the
/// machine prefs, and attempt the connection now.
#[tauri::command]
fn midi_set_destination<R: tauri::Runtime>(
    dest: Option<cseq_transport::MidiDestination>,
    app: AppHandle<R>,
    state: State<'_, Arc<AppState>>,
) -> Result<MidiRouteState, String> {
    // Keep this entire user-selection transaction ordered with hot-plug and
    // rescan reconciliation. In particular, do not let an older reconciliation
    // physically reconnect its stale destination after this one completes.
    let _reconcile_guard = state.midi_route_reconcile.lock();
    persist_machine_prefs_update(&state, |prefs| {
        prefs.midi_destination = dest.clone();
    })?;
    {
        let mut route = state.midi_route.lock();
        route.desired = dest;
        route.connected = false;
        route.last_error = None;
    }
    reconcile_midi_route_locked(&app, &state, false);
    Ok(state.midi_route.lock().clone())
}

/// Current route status; also re-runs the reconcile so opening Setup (or
/// pressing rescan) picks up devices that appeared without a notification.
#[tauri::command]
fn midi_get_route_status<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, Arc<AppState>>,
) -> Result<MidiRouteState, String> {
    reconcile_midi_route(&app, &state);
    Ok(state.midi_route.lock().clone())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MachinePrefsSnapshotDto {
    prefs: MachinePrefs,
    source: MachinePrefsSource,
}

/// The machine-local preferences plus where they came from — `defaults`
/// tells the frontend its one-shot localStorage migration may still apply.
#[tauri::command]
fn machine_prefs_get(state: State<'_, Arc<AppState>>) -> Result<MachinePrefsSnapshotDto, String> {
    let prefs_guard = state.machine_prefs.lock();
    let source = *state.machine_prefs_source.lock();
    Ok(MachinePrefsSnapshotDto {
        prefs: prefs_guard.clone(),
        source,
    })
}

#[tauri::command]
fn machine_prefs_set(prefs: MachinePrefs, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    if prefs.autosave_interval_ms < 1_000 || prefs.autosave_interval_ms > 60_000 {
        return Err("autosaveIntervalMs must be 1000-60000".to_string());
    }
    persist_machine_prefs_update(&state, move |candidate| {
        // The route half is owned by midi_set_destination; keep it
        // authoritative so a stale frontend snapshot cannot silently drop the
        // destination.
        let midi_destination = candidate.midi_destination.clone();
        *candidate = MachinePrefs {
            midi_destination,
            ..prefs
        };
    })?;
    Ok(())
}

/// Durably write a candidate preference snapshot before publishing it to the
/// in-memory state. Holding the prefs lock through the write also orders a MIDI
/// selection against an autosave-setting update, so neither can persist a stale
/// clone over the other.
fn persist_machine_prefs_update(
    state: &AppState,
    update: impl FnOnce(&mut MachinePrefs),
) -> Result<MachinePrefs, String> {
    let mut current = state.machine_prefs.lock();
    let mut candidate = current.clone();
    update(&mut candidate);
    save_machine_prefs(&state.machine_dir(), &candidate)?;
    *current = candidate.clone();
    *state.machine_prefs_source.lock() = MachinePrefsSource::File;
    Ok(candidate)
}

/// Reconcile the desired MIDI destination against what is currently present:
/// connect when it (re)appears, drop to virtual-only when it vanishes, and
/// emit `midi_route_status` on every observable change. Single entry point —
/// the hot-plug watcher, the rescan command, and startup restore all land
/// here.
fn reconcile_midi_route<R: tauri::Runtime>(app: &AppHandle<R>, state: &Arc<AppState>) {
    let _reconcile_guard = state.midi_route_reconcile.lock();
    reconcile_midi_route_locked(app, state, false);
}

/// CoreMIDI may remove and recreate an endpoint with the same stable unique id
/// entirely inside the watcher's debounce window. A topology notification must
/// therefore rebuild the physical connection even when ordinary status
/// reconciliation would treat that id as already connected.
fn reconcile_midi_route_after_notification<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &Arc<AppState>,
) {
    let _reconcile_guard = state.midi_route_reconcile.lock();
    reconcile_midi_route_locked(app, state, true);
}

/// Reconcile while `AppState::midi_route_reconcile` is held. Keeping the lock
/// across enumeration, scheduler acknowledgement, and route-state commit makes
/// destination selection linearizable with hot-plug notifications.
fn reconcile_midi_route_locked<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &Arc<AppState>,
    force_reconnect: bool,
) {
    let desired = { state.midi_route.lock().desired.clone() };
    let transport = { state.transport.lock().as_ref().cloned() };
    let Some(transport) = transport else {
        return;
    };

    let next = match desired {
        None => {
            let _ = transport.connect_midi_destination(None);
            MidiRouteState::default()
        }
        Some(dest) => {
            let destinations = cseq_transport::list_midi_destinations();
            let present = destinations.iter().any(|candidate| candidate.id == dest.id);
            if present {
                let connect_result = if force_reconnect {
                    transport.reconnect_midi_destination(Some(dest.clone()))
                } else {
                    transport.connect_midi_destination(Some(dest.clone()))
                };
                match connect_result {
                    Ok(()) => MidiRouteState {
                        desired: Some(dest),
                        connected: true,
                        last_error: None,
                    },
                    Err(error) => MidiRouteState {
                        desired: Some(dest),
                        connected: false,
                        last_error: Some(error.to_string()),
                    },
                }
            } else {
                let _ = transport.connect_midi_destination(None);
                MidiRouteState {
                    desired: Some(dest),
                    connected: false,
                    last_error: Some("destination not present".to_string()),
                }
            }
        }
    };

    let changed = {
        let mut route = state.midi_route.lock();
        let changed = *route != next;
        *route = next.clone();
        changed
    };
    if changed {
        info!(
            connected = next.connected,
            destination = next
                .desired
                .as_ref()
                .map(|d| d.name.as_str())
                .unwrap_or("(virtual only)"),
            "MIDI route reconciled"
        );
        if let Err(e) = app.emit("midi_route_status", &next) {
            debug!(error = %e, "failed to emit midi_route_status");
        }
    }
}

#[tauri::command]
fn transport_resync(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let transport = state
        .transport
        .lock()
        .as_ref()
        .cloned()
        .ok_or("transport not initialized")?;
    transport.resync().map_err(|e| e.to_string())
}

#[tauri::command]
fn transport_set_tempo(bpm: f32, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let transport = state
        .transport
        .lock()
        .as_ref()
        .cloned()
        .ok_or("transport not initialized")?;
    transport.set_tempo(bpm).map_err(|e| e.to_string())
}

#[tauri::command]
fn transport_get_snapshot(state: State<'_, Arc<AppState>>) -> Result<SnapshotDto, String> {
    // Route the manual/initial read through the shared telemetry state so its
    // epochs live in the same monotonic space as the streamed payloads. The
    // returned snapshot carries fresh epochs the frontend uses to seed its
    // promoted-timeline gate before the stream starts.
    let mut telem = state.telemetry.lock();
    let guard = state.transport.lock();
    let transport = guard.as_ref().ok_or("transport not initialized")?;
    let snapshot = transport.snapshot();
    // log_interest=None: `snapshot()` already returned every layer; we only
    // need the sample's digests to resync the gate. force=false still produces a
    // log digest unconditionally (only the layer clone is gated).
    let sample = transport.sample_telemetry(None, None, TelemetryLogInterest::None, false);
    drop(guard);

    telem.next_sample_epoch = telem.next_sample_epoch.saturating_add(1);
    telem.timeline_epoch = telem.timeline_epoch.saturating_add(1);
    telem.log_epoch = telem.log_epoch.saturating_add(1);
    telem.last_timeline_digest = Some(sample.timeline_digest);
    telem.last_log_digest = Some(sample.log_digest);
    telem.last_position_sig = Some(PositionSig::of(&sample.position));

    let mut dto: SnapshotDto = snapshot.into();
    dto.sample_epoch = telem.next_sample_epoch;
    dto.timeline_epoch = telem.timeline_epoch;
    dto.log_epoch = telem.log_epoch;
    Ok(dto)
}

/// Select the rolling-log subset needed by the frontend. Any mode change forces
/// one hydrating snapshot; widening from either sparse mode must hydrate the
/// newly requested layer even though telemetry was already enabled.
#[tauri::command]
fn transport_set_telemetry_interest(
    interest: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let interest = match interest.as_str() {
        "none" => TelemetryLogInterest::None,
        "seedTrace" => TelemetryLogInterest::SeedTrace,
        "trigger" => TelemetryLogInterest::Trigger,
        "seedTraceAndTrigger" => TelemetryLogInterest::SeedTraceAndTrigger,
        "full" => TelemetryLogInterest::Full,
        value => return Err(format!("unsupported telemetry interest: {value}")),
    };
    let mut telem = state.telemetry.lock();
    if telem.log_interest != interest {
        telem.log_interest = interest;
        // Force a mode-appropriate hydrate on the next poll.
        telem.last_log_digest = None;
    }
    Ok(())
}

/// Save a complete UI-authored sequencer patch document to disk.
#[tauri::command]
fn patch_save_to_path(path: String, patch: serde_json::Value) -> Result<(), String> {
    validate_current_patch_document(&patch)?;
    let contents = serde_json::to_string_pretty(&patch)
        .map_err(|e| format!("failed to serialize patch: {e}"))?;
    std::fs::write(&path, format!("{contents}\n"))
        .map_err(|e| format!("failed to write patch to {path}: {e}"))?;
    info!(path, "saved patch");
    Ok(())
}

/// Load a complete UI-authored sequencer patch document from disk.
#[tauri::command]
fn patch_load_from_path(path: String) -> Result<serde_json::Value, String> {
    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let patch: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| format!("failed to parse patch: {e}"))?;
    validate_patch_document(&patch)?;
    info!(path, "loaded patch");
    Ok(patch)
}

/// Save a single-track export envelope to disk.
///
/// The envelope is a UI-authored `.dumka-track` document containing exactly
/// one `ParallelTrackPatch`. All structural integrity (id uniqueness, channel
/// reconciliation, timing reconciliation) is the importer's responsibility;
/// this command only verifies the envelope shape before persisting it verbatim.
#[tauri::command]
fn track_save_to_path(path: String, document: serde_json::Value) -> Result<(), String> {
    validate_track_document(&document)?;
    let contents = serde_json::to_string_pretty(&document)
        .map_err(|e| format!("failed to serialize track: {e}"))?;
    std::fs::write(&path, format!("{contents}\n"))
        .map_err(|e| format!("failed to write track to {path}: {e}"))?;
    info!(path, "saved track");
    Ok(())
}

/// Load a single-track export envelope from disk.
#[tauri::command]
fn track_load_from_path(path: String) -> Result<serde_json::Value, String> {
    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let document: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| format!("failed to parse track: {e}"))?;
    validate_track_document(&document)?;
    info!(path, "loaded track");
    Ok(document)
}

/// Write the current working patch to a temporary recovery file.
#[tauri::command]
fn patch_autosave(patch: serde_json::Value, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    validate_current_patch_document(&patch)?;
    let path = autosave_patch_path(&state);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create autosave directory: {e}"))?;
    }
    let contents = serde_json::to_string_pretty(&patch)
        .map_err(|e| format!("failed to serialize autosave patch: {e}"))?;
    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, format!("{contents}\n"))
        .map_err(|e| format!("failed to write autosave patch: {e}"))?;
    std::fs::rename(&temp_path, &path)
        .map_err(|e| format!("failed to finalize autosave patch: {e}"))?;
    debug!(path = %path.display(), "autosaved patch");
    Ok(())
}

/// Load the temporary recovery patch, if one exists.
#[tauri::command]
fn patch_load_autosave(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<serde_json::Value>, String> {
    let path = autosave_patch_path(&state);
    if !path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read autosave patch: {e}"))?;
    let patch: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse autosave patch: {e}"))?;
    validate_patch_document(&patch)?;
    info!(path = %path.display(), "loaded autosave patch");
    Ok(Some(patch))
}

/// Clear the temporary recovery patch.
#[tauri::command]
fn patch_clear_autosave(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let path = autosave_patch_path(&state);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("failed to remove autosave patch: {e}"))?;
    }
    Ok(())
}

/// Recovery autosaves live beside the machine prefs (app config dir), NOT in
/// the OS temp dir — temp cleaners must not eat crash recovery.
fn autosave_patch_path(state: &Arc<AppState>) -> std::path::PathBuf {
    autosave_path(&state.machine_dir())
}

/// Load a Score from a JSON file on disk and set it on the transport.
#[tauri::command]
fn score_load_from_path(path: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let score: Score =
        serde_json::from_str(&contents).map_err(|e| format!("failed to parse score: {e}"))?;

    info!(path, score_id = %score.id, "loaded score from file");
    set_score_on_transport(&state, score)
}

/// Save the current Cycle JSON to disk.
#[tauri::command]
fn score_save_to_path(path: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let guard = state.current_score.lock();
    let score = guard
        .as_ref()
        .ok_or_else(|| "no current score to export".to_string())?;
    let contents = serde_json::to_string_pretty(score)
        .map_err(|e| format!("failed to serialize score: {e}"))?;
    std::fs::write(&path, format!("{contents}\n"))
        .map_err(|e| format!("failed to write score to {path}: {e}"))?;
    info!(path, score_id = %score.id, "exported score");
    Ok(())
}

/// Return the current Score as JSON for display in the UI.
fn score_value_for_js(score: &Score) -> Result<serde_json::Value, String> {
    let mut value = serde_json::to_value(score).map_err(|error| error.to_string())?;
    let Some(pipeline) = value
        .get_mut("pipeline")
        .and_then(|value| value.as_array_mut())
    else {
        return Ok(value);
    };

    for transform in pipeline {
        let Some(kind) = transform
            .get_mut("kind")
            .and_then(|value| value.as_object_mut())
        else {
            continue;
        };
        if kind.get("type").and_then(|value| value.as_str()) != Some("subdivisionSwitch") {
            continue;
        }
        let Some(seed_mode) = kind
            .get_mut("seed_mode")
            .and_then(|value| value.as_object_mut())
        else {
            continue;
        };
        if seed_mode.get("type").and_then(|value| value.as_str()) != Some("history") {
            continue;
        }
        let Some(history) = seed_mode
            .get_mut("history")
            .and_then(|value| value.as_array_mut())
        else {
            continue;
        };
        for seed in history {
            if seed.is_string() {
                continue;
            }
            let value = seed
                .as_u64()
                .ok_or_else(|| "score seed history contained a non-u64 value".to_string())?;
            *seed = serde_json::Value::String(value.to_string());
        }
    }

    Ok(value)
}

#[tauri::command]
fn score_get_current(state: State<'_, Arc<AppState>>) -> Result<Option<serde_json::Value>, String> {
    let guard = state.current_score.lock();
    match guard.as_ref() {
        Some(score) => score_value_for_js(score).map(Some),
        None => Ok(None),
    }
}

/// Load a built-in preset score by name.
#[tauri::command]
fn score_load_preset(preset: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let score = match preset.as_str() {
        "tisra" => Score::subdivided("tisra", &[60, 62, 64], 100, SubdivisionPolicy::Equal),
        "chatusra" => {
            Score::subdivided("chatusra", &[60, 62, 64, 65], 100, SubdivisionPolicy::Equal)
        }
        "khanda_chapu" => Score::subdivided(
            "khanda_chapu",
            &[60, 62, 64],
            100,
            SubdivisionPolicy::Weighted(vec![2, 1, 2]),
        ),
        "switch_cycle_demo" => Score::subdivision_switch(
            "switch_cycle_demo",
            SubdivisionSwitchSpec {
                cycle_beats: 8,
                initial_weights: vec![WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: default_fixed_switch_inflections(7),
                switch_count_weights: vec![WeightedSwitchCount {
                    count: 7,
                    weight: 1.0,
                }],
                seed_mode: SwitchSeedMode::Locked { seed: 20260505 },
                accent: GatiAccentSpec::default(),
                pitch: 60,
                velocity: 96,
            },
        ),
        _ => return Err(format!("unknown preset: {preset}")),
    };

    info!(preset, "loaded preset score");
    set_score_on_transport(&state, score)
}

/// Create a subdivided score from parameters.
#[tauri::command]
fn score_create_subdivision(
    name: String,
    pitches: Vec<u8>,
    velocity: u8,
    weights: Option<Vec<u32>>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if pitches.is_empty() || pitches.len() > 16 {
        return Err("pitches must have 1-16 entries".to_string());
    }
    if pitches.iter().any(|&p| p > 127) {
        return Err("pitches must be 0-127".to_string());
    }
    if velocity == 0 || velocity > 127 {
        return Err("velocity must be 1-127".to_string());
    }

    let policy = match weights {
        Some(w) => {
            if w.len() != pitches.len() {
                return Err(format!(
                    "weights length ({}) must match pitches length ({})",
                    w.len(),
                    pitches.len()
                ));
            }
            if w.contains(&0) {
                return Err("weights must all be > 0".to_string());
            }
            SubdivisionPolicy::Weighted(w)
        }
        None => SubdivisionPolicy::Equal,
    };

    let score = Score::subdivided(&name, &pitches, velocity, policy);
    info!(name, pitches = ?pitches, "created subdivision score");
    set_score_on_transport(&state, score)
}

/// Create a deterministic Euclidean score: k hits distributed over n matras.

#[tauri::command]
fn score_create_subdivision_switch(
    request: SubdivisionSwitchRequestDto,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let score = build_subdivision_switch_score(request)?;
    info!(score = %score.id, "created probabilistic gati score");
    set_score_on_transport(&state, score)
}

#[tauri::command]
fn score_preview_subdivision_switch(
    request: SubdivisionSwitchRequestDto,
    cycle: u64,
    tempo_bpm: Option<f32>,
) -> Result<SubdivisionSwitchPreviewDto, String> {
    let preview_automation = request.automation.clone();
    let preview_cycle_beats = request.cycle_beats;
    let preview_bases = AutomationPreviewBases {
        tempo_bpm: tempo_bpm.unwrap_or(80.0).clamp(20.0, 400.0),
        pitch: request.pitch,
        velocity: request.velocity,
        accent: validate_accent_settings(request.accent.clone())?,
    };
    let preview_automation_targets = automation_preview_targets(&request, &preview_bases);
    let mut score = build_subdivision_switch_score(request)?;
    // Preview starts from the authored score on every request. Replay a
    // History seed pool through the requested cycle so this random-access
    // projection matches transport's sequential mutation; stateless modes
    // retain the direct-cycle fast path inside the helper.
    let tree = cseq_transforms::apply_pipeline_through_cycle_mut(&mut score, cycle)
        .map_err(|e| e.to_string())?;
    let root = tree
        .get(tree.root)
        .ok_or_else(|| "preview root missing".to_string())?;

    let beat_ids = match &root.kind {
        DurationKind::Subdivided { children, .. } => children.clone(),
        _ => return Err("preview root did not realize to beats".to_string()),
    };
    let preview_frames = preview_frames_from_root(&tree, &beat_ids)?;

    let total_duration: Rational = beat_ids
        .iter()
        .map(|id| {
            tree.get(*id)
                .map(|n| n.duration)
                .unwrap_or(Rational::new(0, 1))
        })
        .sum();
    let total_f = rational_to_f64(total_duration).unwrap_or(1.0);
    let scale = if total_f > 0.0 { 1.0 / total_f } else { 1.0 };
    // Authored accent velocities on each span's matra grid, computed by the
    // transport with the exact leaf-inheritance rule realization uses. The UI
    // forwards them into `generator_preview` requests.
    let mut span_velocities =
        cseq_transport::rhythm_span_matra_velocities(&tree, score.cycle_length)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|entry| (entry.span_id, entry.velocities))
            .collect::<HashMap<_, _>>();
    let pulse_spans = tree
        .pulse_spans
        .iter()
        .map(|span| {
            let matra_velocities = span_velocities.remove(&span.id).unwrap_or_default();
            pulse_span_to_dto(span, &tree.pulse_spans, matra_velocities)
        })
        .collect::<Vec<_>>();
    let section_jathis = tree
        .pulse_spans
        .iter()
        .filter_map(|span| match span.kind {
            PulseSpanKind::JathiPulse {
                section_index,
                jathi,
                ..
            } => Some((section_index, jathi)),
            _ => None,
        })
        .collect::<HashMap<_, _>>();

    let mut beats = Vec::with_capacity(preview_frames.len());
    for frame in &preview_frames {
        let beat = tree
            .get(frame.node_id)
            .ok_or_else(|| format!("preview frame {} missing", frame.node_id))?;
        let matra_ids = match &beat.kind {
            DurationKind::Subdivided { children, .. } => children,
            _ => {
                return Err(format!(
                    "preview frame {} was not subdivided into matras",
                    frame.node_id
                ))
            }
        };
        let effective_gati = matra_ids.len() as u32;
        let pitch = matra_ids
            .first()
            .and_then(|matra_id| tree.get(*matra_id))
            .and_then(|matra| match &matra.kind {
                DurationKind::Pulse(pulse) => match &pulse.event {
                    cseq_model::PulseEvent::Note { pitch, .. } => pitch.as_fixed().copied(),
                    _ => None,
                },
                _ => None,
            })
            .unwrap_or(preview_bases.pitch);
        let accent_velocity = matra_ids
            .first()
            .and_then(|matra_id| tree.get(*matra_id))
            .and_then(|matra| match &matra.kind {
                DurationKind::Pulse(pulse) => pulse.velocity.as_fixed().copied(),
                _ => None,
            })
            .unwrap_or(0);
        let section_start = beat.metadata.tags.iter().any(|tag| tag == "section-start");
        let start = rational_to_f64(frame.start_fraction).unwrap_or(0.0) * scale;
        let duration = rational_to_f64(frame.duration_fraction).unwrap_or(0.0) * scale;
        let end = (start + duration).min(1.0);
        let frame_start_beat =
            frame.start_fraction * Rational::from_integer(preview_cycle_beats as i64);
        let beat_index = preview_automation_beat_index(frame_start_beat, preview_cycle_beats);
        let beat_number = beat_index + 1;
        let automation_phase = AutomationTime::from_beat(
            cycle,
            beat_index,
            preview_cycle_beats,
            preview_automation
                .as_ref()
                .map(|automation| automation.length_cycles)
                .unwrap_or(1),
        );
        let automation_values = preview_automation
            .as_ref()
            .map(|automation| {
                let mut values = sample_preview_automation_values(
                    automation,
                    cycle,
                    beat_index,
                    preview_cycle_beats,
                    &preview_automation_targets,
                );
                // F2: also expose post-score automation targets (ratchet, pitch,
                // channel, rhythm matrices, etc.) per beat so the stopped
                // timeline can render them. These are a pure additive read of
                // the AutomationSet and do not affect realization or playback.
                append_post_score_preview_values(
                    automation,
                    cycle,
                    beat_index,
                    preview_cycle_beats,
                    &preview_automation_targets,
                    &mut values,
                );
                values
            })
            .unwrap_or_default();
        let base_velocity = preview_automation
            .as_ref()
            .and_then(|automation| {
                sample_preview_automation_number(
                    automation,
                    cycle,
                    beat_index,
                    preview_cycle_beats,
                    &AutomationPreviewTarget {
                        target: AUTOMATION_TARGET_VELOCITY.to_string(),
                        base: f64::from(preview_bases.velocity),
                        min: 1.0,
                        max: 127.0,
                        value_kind: AutomationValueKind::Integer,
                    },
                )
            })
            .map(|value| value.round().clamp(1.0, 127.0) as u8)
            .unwrap_or(preview_bases.velocity);
        let beat_position = frame_start_beat;
        let (section_index, gati) = tree
            .pulse_spans
            .iter()
            .find_map(|span| match span.kind {
                PulseSpanKind::GatiBeat {
                    section_index,
                    gati,
                    ..
                } if beat_position >= span.start && beat_position < span.start + span.duration => {
                    Some((section_index, gati))
                }
                _ => None,
            })
            .unwrap_or((1, effective_gati));
        beats.push(ResolvedBeatDto {
            beat: beat_number,
            start,
            end,
            gati,
            effective_gati,
            division_index: frame.division_index,
            division_count: frame.division_count,
            section_index,
            jathi: section_jathis.get(&section_index).copied(),
            section_start,
            accent_velocity,
            pitch,
            base_velocity,
            automation_phase,
            automation_values,
        });
    }
    if let Some(last) = beats.last_mut() {
        last.end = 1.0;
    }

    let history_seeds = score
        .pipeline
        .iter()
        .find_map(|transform| match &transform.kind {
            TransformKind::SubdivisionSwitch {
                seed_mode: SwitchSeedMode::History { history, .. },
                ..
            } => Some(history.clone()),
            _ => None,
        })
        .unwrap_or_default();

    Ok(SubdivisionSwitchPreviewDto {
        cycle,
        beats,
        pulse_spans,
        history_seeds,
    })
}

fn preview_frames_from_root(
    tree: &cseq_model::DurationTree,
    root_children: &[u64],
) -> Result<Vec<PreviewFrame>, String> {
    let mut frames = Vec::new();
    let mut cursor = Rational::new(0, 1);

    for child_id in root_children {
        let node = tree
            .get(*child_id)
            .ok_or_else(|| format!("preview root child {child_id} missing"))?;
        let children = match &node.kind {
            DurationKind::Subdivided { children, .. } => children,
            _ => return Err(format!("preview root child {child_id} was not subdivided")),
        };
        let is_custom_section = children
            .first()
            .and_then(|grandchild_id| tree.get(*grandchild_id))
            .map(|grandchild| matches!(grandchild.kind, DurationKind::Subdivided { .. }))
            .unwrap_or(false);

        if is_custom_section {
            let division_count = children.len() as u32;
            if division_count == 0 {
                return Err(format!(
                    "preview custom section {child_id} has no divisions"
                ));
            }
            let division_duration = node.duration / Rational::from_integer(division_count as i64);
            for (division_index, division_id) in children.iter().enumerate() {
                frames.push(PreviewFrame {
                    node_id: *division_id,
                    start_fraction: cursor
                        + division_duration * Rational::from_integer(division_index as i64),
                    duration_fraction: division_duration,
                    division_index: Some(division_index as u32 + 1),
                    division_count: Some(division_count),
                });
            }
        } else {
            frames.push(PreviewFrame {
                node_id: *child_id,
                start_fraction: cursor,
                duration_fraction: node.duration,
                division_index: None,
                division_count: None,
            });
        }
        cursor += node.duration;
    }

    Ok(frames)
}

fn preview_automation_beat_index(start_beat: Rational, cycle_beats: u32) -> u32 {
    if cycle_beats == 0 {
        return 0;
    }
    let beat = start_beat.numer().div_euclid(*start_beat.denom());
    beat.clamp(0, cycle_beats.saturating_sub(1) as i64) as u32
}

fn validate_generator_preview_cycle(cycle: u64, live_cycles: &[u64]) -> Result<(), String> {
    if cycle <= MAX_STOPPED_PREVIEW_CYCLE
        || live_cycles
            .iter()
            .any(|live_cycle| cycle.abs_diff(*live_cycle) <= LIVE_PREVIEW_CYCLE_RADIUS)
    {
        return Ok(());
    }

    Err(format!(
        "generator preview cycle {cycle} exceeds the stopped preview limit of {MAX_STOPPED_PREVIEW_CYCLE} and is not within {LIVE_PREVIEW_CYCLE_RADIUS} cycles of live playback"
    ))
}

fn generator_preview_live_cycles<'a>(
    is_playing: bool,
    current_cycle: u64,
    request_track_id: Option<&str>,
    parallel_cycles: impl IntoIterator<Item = (&'a str, u64)>,
) -> Vec<u64> {
    if !is_playing {
        return Vec::new();
    }

    let mut cycles = vec![current_cycle];
    cycles.extend(
        parallel_cycles
            .into_iter()
            .filter(|(track_id, _)| {
                request_track_id.map_or(true, |requested| *track_id == requested)
            })
            .map(|(_, cycle)| cycle),
    );
    cycles
}

/// The authored velocity a generated cell inherits, given the span's per-matra
/// velocity list. Mirrors the overlay's `note_leaf_for_offset` on a dense matra
/// grid: the last authored entry at/before the cell start, first entry as the
/// fallback (an empty list means no authored leaves — no velocity).
fn authored_cell_velocity(velocities: &[u8], cell_start: u32) -> Option<u8> {
    if velocities.is_empty() {
        return None;
    }
    let index = (cell_start as usize).min(velocities.len() - 1);
    Some(velocities[index])
}

/// Stamp per-cell velocities onto resolved preview spans from the authored
/// per-matra velocities the request carried. Spans without an entry (legacy
/// requests, structural drift) keep `velocity: None` cells.
fn stamp_preview_cell_velocities(
    spans: &mut [cseq_rhythm::ResolvedRhythmSpan],
    span_velocities: &[GeneratorSpanVelocitiesDto],
) {
    let by_span = span_velocities
        .iter()
        .map(|entry| (entry.span_id, entry.velocities.as_slice()))
        .collect::<HashMap<_, _>>();
    for span in spans {
        let Some(velocities) = by_span.get(&span.span_id) else {
            continue;
        };
        for cell in &mut span.cells {
            cell.velocity = authored_cell_velocity(velocities, cell.start);
        }
    }
}

fn resolve_generator_preview(
    request: GeneratorPreviewRequestDto,
    live_cycles: &[u64],
) -> Result<GeneratorPreviewDto, String> {
    validate_generator_preview_cycle(request.cycle, live_cycles)?;
    validate_generator_javascript_number_boundary(&request.generator)?;
    request
        .generator
        .validate()
        .map_err(|error| error.to_string())?;
    let seed =
        cseq_rhythm::resolve_generator_seed_at_cycle(request.generator.seed_mode(), request.cycle)
            .map_err(|error| error.to_string())?;
    let (mut spans, trace, density_corridor, cycle_distance) = if request.enabled {
        let automation = |target: &str, sample_cycle: u64, default: f64| {
            let automation = request.automation.as_ref()?;
            // One shared predicate with transport playback: the seam treats
            // "no enabled source" (None) differently from "automated value"
            // (Some), so preview and playback must agree on which it is.
            if !cseq_transport::automation_target_has_enabled_source(automation, target) {
                return None;
            }
            Some(
                automation
                    .sample_typed_number(
                        target,
                        sample_cycle,
                        0,
                        request.cycle_beats.max(1),
                        default,
                        AutomationValueKind::Float,
                        -f64::MAX,
                        f64::MAX,
                    )
                    .unwrap_or(default),
            )
        };
        let resolution = cseq_rhythm::resolve_generator_cycle_with_trace(
            &request.generator,
            &cseq_rhythm::GeneratorCycleContext {
                track_id: request.track_id.as_deref(),
                cycle: request.cycle,
                cycle_beats: request.cycle_beats.max(1),
                spans: &request.spans,
                seed: seed.seed,
                automation: &automation,
            },
        )
        .map_err(|error| error.to_string())?;
        (
            resolution.spans,
            resolution.trace,
            resolution.density_corridor,
            resolution.cycle_distance,
        )
    } else {
        (Vec::new(), Vec::new(), None, None)
    };
    stamp_preview_cell_velocities(&mut spans, &request.span_velocities);
    Ok(GeneratorPreviewDto {
        seed,
        spans,
        trace,
        density_corridor,
        cycle_distance,
    })
}

#[tauri::command]
fn generator_preview(
    request: GeneratorPreviewRequestDto,
    state: State<'_, Arc<AppState>>,
) -> Result<GeneratorPreviewDto, String> {
    let live_cycles = {
        let guard = state.transport.lock();
        guard
            .as_ref()
            .map(|transport| transport.snapshot())
            .map_or_else(Vec::new, |snapshot| {
                generator_preview_live_cycles(
                    snapshot.is_playing,
                    snapshot.current_cycle,
                    request.track_id.as_deref(),
                    snapshot
                        .parallel_track_positions
                        .iter()
                        .map(|position| (position.track_id.as_str(), position.cycle)),
                )
            })
    };

    resolve_generator_preview(request, &live_cycles)
}

#[tauri::command]
fn track_set_playback(
    request: TrackPlaybackRequestDto,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let guard = state.transport.lock();
    let transport = guard.as_ref().ok_or("transport not initialized")?;
    transport
        .set_rhythm_playback(
            track_playback_config_from_request(request)?,
            ApplyQuantize::Immediate,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn parallel_set_playback(
    request: Option<ParallelPlaybackRequestDto>,
    #[allow(non_snake_case)] nextCycle: Option<bool>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    // P1: the FE sends `nextCycle: true` while playing (in-place forward apply)
    // and false/absent otherwise; default to immediate for older callers.
    let apply = if nextCycle.unwrap_or(false) {
        ApplyQuantize::NextCycle
    } else {
        ApplyQuantize::Immediate
    };
    let guard = state.transport.lock();
    let transport = guard.as_ref().ok_or("transport not initialized")?;
    let Some(request) = request else {
        return transport
            .set_parallel_playback(None, apply)
            .map_err(|e| e.to_string());
    };
    let total_box_sources: usize = request
        .track_flow_boxes
        .iter()
        .map(|b| b.sources.len())
        .sum();
    // A Track Flow-only project (every track in a box) is valid; the transport
    // appends one synthetic lane per box. Reject only a truly empty project here;
    // full validation (caps, sources, chain specs, cross-box) runs in the
    // transport, which sees the whole runtime config.
    if request.tracks.is_empty() && total_box_sources == 0 {
        return Err(
            "parallel playback requires at least one track or Track Flow source".to_string(),
        );
    }
    let build_track =
        |track: ParallelPlaybackTrackRequestDto| -> Result<ParallelPlaybackTrackConfig, String> {
            Ok(ParallelPlaybackTrackConfig {
                name: track.name,
                id: track.id,
                score: build_subdivision_switch_score(track.score)?,
                rhythm: track_playback_config_from_request(track.playback)?,
                tempo_bpm: track.tempo_bpm.clamp(20.0, 400.0),
                trigger: track.trigger,
                silent: track.silent,
            })
        };
    let tracks = request
        .tracks
        .into_iter()
        .map(build_track)
        .collect::<Result<Vec<_>, String>>()?;
    let track_flow_boxes = request
        .track_flow_boxes
        .into_iter()
        .map(|the_box| -> Result<TrackFlowBoxConfig, String> {
            Ok(TrackFlowBoxConfig {
                id: the_box.id,
                name: the_box.name,
                sources: the_box
                    .sources
                    .into_iter()
                    .map(build_track)
                    .collect::<Result<Vec<_>, String>>()?,
                spec: the_box.spec.map(Into::into),
                seed: the_box.seed,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    transport
        .set_parallel_playback(
            Some(ParallelPlaybackConfig {
                tracks,
                reference_tempo_bpm: request.reference_tempo_bpm.clamp(20.0, 400.0),
                reference_cycle_beats: request.reference_cycle_beats.clamp(1, 64),
                channel_conflict_policy: request.channel_conflict_policy.into(),
                channel_logic_matrix: request
                    .channel_logic_matrix
                    .into_iter()
                    .map(ChannelLogicMatrixEntry::from)
                    .collect(),
                conflict_priority: request.conflict_priority,
                track_flow_boxes,
            }),
            apply,
        )
        .map_err(|e| e.to_string())
}

fn track_playback_config_from_request(
    request: TrackPlaybackRequestDto,
) -> Result<Option<RhythmPlaybackConfig>, String> {
    validate_generator_javascript_number_boundary(&request.generator)?;
    let midi_output_channel = request.midi_output_channel.clamp(1, 16);
    let automation = request.automation.filter(|set| !set.tracks.is_empty());
    let channel_hocket_enabled = request.channel_hocket_enabled && request.channel_hocket.is_some();
    Ok((request.generator_enabled
        || automation.is_some()
        || channel_hocket_enabled
        || request.seed_path.is_some()
        || midi_output_channel != 1)
        .then_some(RhythmPlaybackConfig {
            generator_enabled: request.generator_enabled,
            generator: request.generator,
            midi_output_channel,
            automation,
            channel_hocket_enabled,
            channel_hocket: request.channel_hocket,
            seed_path: request.seed_path.map(SeedPathPlaybackConfig::from),
        }))
}

fn pulse_span_to_dto(
    span: &cseq_model::PulseSpan,
    all_spans: &[cseq_model::PulseSpan],
    matra_velocities: Vec<u8>,
) -> PulseSpanDto {
    let (kind, section_index, beat, gati, jathi, index) = match span.kind {
        PulseSpanKind::Section { index } => ("section", Some(index), None, None, None, None),
        PulseSpanKind::GatiBeat {
            section_index,
            beat,
            gati,
        } => (
            "gatiBeat",
            Some(section_index),
            Some(beat),
            Some(gati),
            None,
            None,
        ),
        PulseSpanKind::JathiPulse {
            section_index,
            jathi,
            index,
        } => (
            "jathiPulse",
            Some(section_index),
            None,
            None,
            Some(jathi),
            Some(index),
        ),
    };

    PulseSpanDto {
        id: span.id,
        kind: kind.to_string(),
        section_index,
        beat,
        gati,
        jathi,
        index,
        start: rational_to_f64(span.start).unwrap_or(0.0),
        duration: rational_to_f64(span.duration).unwrap_or(0.0),
        start_matra: span.start_matra,
        matra_len: span.matra_len,
        subdivision: cseq_rhythm::generators::pulse_span_subdivision(span),
        protected_cuts: cseq_model::rhythm_protected_cuts_for_span(span, all_spans),
        tags: span.tags.clone(),
        matra_velocities,
    }
}

fn rational_to_f64(r: Rational) -> Option<f64> {
    let denom = *r.denom();
    if denom == 0 {
        return None;
    }
    Some(*r.numer() as f64 / denom as f64)
}

#[derive(Debug, Clone)]
struct AutomationPreviewTarget {
    target: String,
    base: f64,
    min: f64,
    max: f64,
    value_kind: AutomationValueKind,
}

fn automation_preview_targets(
    request: &SubdivisionSwitchRequestDto,
    bases: &AutomationPreviewBases,
) -> Vec<AutomationPreviewTarget> {
    let mut targets = vec![
        AutomationPreviewTarget {
            target: AUTOMATION_TARGET_TEMPO_BPM.to_string(),
            base: f64::from(bases.tempo_bpm),
            min: 20.0,
            max: 400.0,
            value_kind: AutomationValueKind::Float,
        },
        AutomationPreviewTarget {
            target: AUTOMATION_TARGET_PITCH.to_string(),
            base: f64::from(bases.pitch),
            min: 0.0,
            max: 127.0,
            value_kind: AutomationValueKind::Integer,
        },
        AutomationPreviewTarget {
            target: AUTOMATION_TARGET_VELOCITY.to_string(),
            base: f64::from(bases.velocity),
            min: 1.0,
            max: 127.0,
            value_kind: AutomationValueKind::Integer,
        },
        AutomationPreviewTarget {
            target: AUTOMATION_TARGET_BEAT_ACCENT_MIN.to_string(),
            base: f64::from(bases.accent.beat_start.min),
            min: 0.0,
            max: 127.0,
            value_kind: AutomationValueKind::Integer,
        },
        AutomationPreviewTarget {
            target: AUTOMATION_TARGET_BEAT_ACCENT_MAX.to_string(),
            base: f64::from(bases.accent.beat_start.max),
            min: 0.0,
            max: 127.0,
            value_kind: AutomationValueKind::Integer,
        },
        AutomationPreviewTarget {
            target: AUTOMATION_TARGET_SECTION_ACCENT_MIN.to_string(),
            base: f64::from(bases.accent.section_start_extra.min),
            min: 0.0,
            max: 127.0,
            value_kind: AutomationValueKind::Integer,
        },
        AutomationPreviewTarget {
            target: AUTOMATION_TARGET_SECTION_ACCENT_MAX.to_string(),
            base: f64::from(bases.accent.section_start_extra.max),
            min: 0.0,
            max: 127.0,
            value_kind: AutomationValueKind::Integer,
        },
        AutomationPreviewTarget {
            target: AUTOMATION_TARGET_JATHI_ACCENT_MIN.to_string(),
            base: f64::from(bases.accent.jathi_start.min),
            min: 0.0,
            max: 127.0,
            value_kind: AutomationValueKind::Integer,
        },
        AutomationPreviewTarget {
            target: AUTOMATION_TARGET_JATHI_ACCENT_MAX.to_string(),
            base: f64::from(bases.accent.jathi_start.max),
            min: 0.0,
            max: 127.0,
            value_kind: AutomationValueKind::Integer,
        },
    ];
    for choice in &request.initial_weights {
        targets.push(AutomationPreviewTarget {
            target: automation_target_initial_gati_weight(choice.subdivision),
            base: f64::from(choice.weight),
            min: 0.0,
            max: f64::from(f32::MAX),
            value_kind: AutomationValueKind::Weight,
        });
    }
    for choice in &request.initial_jathi_weights {
        targets.push(AutomationPreviewTarget {
            target: automation_target_initial_jathi_weight(choice.jathi),
            base: f64::from(choice.weight),
            min: 0.0,
            max: f64::from(f32::MAX),
            value_kind: AutomationValueKind::Weight,
        });
    }
    for choice in &request.switch_count_weights {
        targets.push(AutomationPreviewTarget {
            target: automation_target_section_count_weight(choice.count),
            base: f64::from(choice.weight),
            min: 0.0,
            max: f64::from(f32::MAX),
            value_kind: AutomationValueKind::Weight,
        });
    }
    for inflection in &request.inflections {
        let Some(id) = inflection.id.as_deref() else {
            continue;
        };
        targets.push(AutomationPreviewTarget {
            target: automation_target_boundary_probability(id),
            base: f64::from(inflection.change_probability),
            min: 0.0,
            max: 1.0,
            value_kind: AutomationValueKind::Float,
        });
        for choice in &inflection.subdivision_weights {
            targets.push(AutomationPreviewTarget {
                target: automation_target_boundary_gati_weight(id, choice.subdivision),
                base: f64::from(choice.weight),
                min: 0.0,
                max: f64::from(f32::MAX),
                value_kind: AutomationValueKind::Weight,
            });
        }
        for choice in &inflection.jathi_weights {
            targets.push(AutomationPreviewTarget {
                target: automation_target_boundary_jathi_weight(id, choice.jathi),
                base: f64::from(choice.weight),
                min: 0.0,
                max: f64::from(f32::MAX),
                value_kind: AutomationValueKind::Weight,
            });
        }
    }
    targets
}

fn sample_preview_automation_number(
    automation: &AutomationSet,
    cycle: u64,
    beat_index: u32,
    cycle_beats: u32,
    target: &AutomationPreviewTarget,
) -> Option<f64> {
    automation.sample_typed_number(
        &target.target,
        cycle,
        beat_index,
        cycle_beats,
        target.base,
        target.value_kind,
        target.min,
        target.max,
    )
}

fn sample_preview_automation_values(
    automation: &AutomationSet,
    cycle: u64,
    beat_index: u32,
    cycle_beats: u32,
    targets: &[AutomationPreviewTarget],
) -> Vec<AutomationBeatValueDto> {
    targets
        .iter()
        .filter_map(|target| {
            sample_preview_automation_number(automation, cycle, beat_index, cycle_beats, target)
                .map(|value| AutomationBeatValueDto {
                    target: target.target.clone(),
                    value,
                })
        })
        .collect()
}

/// Append preview values for every enabled automation track whose target is NOT
/// one of the typed score targets already sampled above. The backend does not
/// know post-score target value-kinds/domains (those live in the frontend
/// registry), and does not need to: the timeline lane scales the raw value with
/// its own range. This is a pure additive read of the `AutomationSet`; it never
/// touches realization or playback. (F2 in docs/AUTOMATION_AUDIT.md.)
///
/// Sampling beat parity (the "what you see is what plays" contract): each target
/// is sampled at the SAME beat the playback engine reads it. Targets that
/// playback re-samples per beat (F3 — see
/// `cseq_model::automation_target_is_per_beat_post_score`) are sampled here at
/// the visible `beat_index`; every other post-score target is sampled at beat 0
/// (held across the cycle), matching the engine's cycle-start sampling for those.
/// Driving the predicate from the shared model fn means preview and playback
/// cannot drift as more processors are wired for per-beat resampling.
fn append_post_score_preview_values(
    automation: &AutomationSet,
    cycle: u64,
    beat_index: u32,
    cycle_beats: u32,
    score_targets: &[AutomationPreviewTarget],
    values: &mut Vec<AutomationBeatValueDto>,
) {
    use std::collections::HashSet;
    let covered: HashSet<&str> = score_targets
        .iter()
        .map(|target| target.target.as_str())
        .collect();
    let mut seen: HashSet<&str> = HashSet::new();
    for track in &automation.tracks {
        if !track.enabled || covered.contains(track.target.as_str()) {
            continue;
        }
        // One value per target id even if multiple tracks share it (the sampler
        // already combines them).
        if !seen.insert(track.target.as_str()) {
            continue;
        }
        // Per-group/beat for wired targets, beat 0 for the rest — exact parity
        // with how the playback engine samples each.
        let sampled = if cseq_model::automation_target_is_per_beat_post_score(&track.target) {
            let phase = automation_time_for_cycle_tick(
                cycle,
                u64::from(beat_index),
                u64::from(cycle_beats.max(1)),
                automation.length_cycles,
            );
            automation.sample_raw_number_at_phase(&track.target, phase)
        } else {
            automation.sample_raw_number(&track.target, cycle, 0, cycle_beats)
        };
        if let Some(value) = sampled {
            values.push(AutomationBeatValueDto {
                target: track.target.clone(),
                value,
            });
        }
    }
}

fn build_subdivision_switch_score(request: SubdivisionSwitchRequestDto) -> Result<Score, String> {
    let SubdivisionSwitchRequestDto {
        name,
        cycle_beats,
        initial_weights,
        initial_jathi_weights,
        initial_custom_subdivision,
        automation,
        inflections,
        switch_count_weights,
        seed_mode,
        seed,
        history_seeds,
        history_weight,
        new_seed_weight,
        max_history,
        accent,
        pitch,
        velocity,
    } = request;

    if cycle_beats == 0 || cycle_beats > 64 {
        return Err("cycle_beats must be 1-64".to_string());
    }
    if pitch > 127 {
        return Err("pitch must be 0-127".to_string());
    }
    if velocity == 0 || velocity > 127 {
        return Err("velocity must be 1-127".to_string());
    }
    if !history_weight.is_finite()
        || !new_seed_weight.is_finite()
        || history_weight < 0.0
        || new_seed_weight < 0.0
    {
        return Err("history and new seed weights must be finite values >= 0".to_string());
    }
    if max_history > 64 {
        return Err("max_history must be 0-64".to_string());
    }
    let accent = validate_accent_settings(accent)?;

    let initial_custom_subdivision = initial_custom_subdivision
        .map(|custom| custom_subdivision_from_dto("initial_custom_subdivision", custom))
        .transpose()?;

    let initial_weights = validate_subdivision_weights("initial_weights", initial_weights)?;
    let initial_may_use_per_beat = initial_custom_subdivision
        .as_ref()
        .map(|custom| custom.per_beat_weight > 0.0)
        .unwrap_or(true);
    if initial_may_use_per_beat && !initial_weights.iter().any(|c| c.weight > 0.0) {
        return Err(
            "initial_weights must have at least one positive weight when per-beat mode is possible"
                .to_string(),
        );
    }
    let initial_jathi_weights =
        validate_jathi_weights("initial_jathi_weights", initial_jathi_weights)?;

    let inflections = inflections
        .into_iter()
        .enumerate()
        .map(|(i, inflection)| {
            if !inflection.change_probability.is_finite()
                || !(0.0..=1.0).contains(&inflection.change_probability)
            {
                return Err(format!(
                    "inflection {}: change probability must be 0.0-1.0",
                    i + 1
                ));
            }
            if !(inflection.position > 0.0 && inflection.position < 1.0) {
                return Err(format!(
                    "inflection {}: position must lie strictly in (0, 1)",
                    i + 1
                ));
            }
            let position = position_to_beat_rational(inflection.position, cycle_beats)
                .map_err(|reason| format!("inflection {}: {reason}", i + 1))?;
            let custom_subdivision = inflection
                .custom_subdivision
                .map(|custom| {
                    custom_subdivision_from_dto(
                        &format!("inflection {} custom_subdivision", i + 1),
                        custom,
                    )
                })
                .transpose()?;
            let subdivision_weights = validate_subdivision_weights(
                &format!("inflection {}", i + 1),
                inflection.subdivision_weights,
            )?;
            let inflection_may_use_per_beat = custom_subdivision
                .as_ref()
                .map(|custom| custom.per_beat_weight > 0.0)
                .unwrap_or(true);
            if inflection_may_use_per_beat
                && inflection.change_probability > 0.0
                && !subdivision_weights.iter().any(|choice| choice.weight > 0.0)
            {
                return Err(format!(
                    "inflection {}: gati weights need at least one positive option when per-beat mode is possible",
                    i + 1
                ));
            }
            let jathi_weights = validate_jathi_weights(
                &format!("inflection {} jathi weights", i + 1),
                inflection.jathi_weights,
            )?;
            Ok(SubdivisionInflection {
                id: inflection.id,
                position,
                change_probability: inflection.change_probability,
                subdivision_weights,
                jathi_weights,
                custom_subdivision,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let mut sorted_positions: Vec<Rational> = inflections.iter().map(|inf| inf.position).collect();
    sorted_positions.sort();
    for window in sorted_positions.windows(2) {
        if window[0] == window[1] {
            return Err("two inflections share the same position".to_string());
        }
    }

    let switch_count_weights = switch_count_weights
        .into_iter()
        .map(|choice| {
            if choice.count as usize > inflections.len() {
                return Err("switch counts cannot exceed the number of inflections".to_string());
            }
            if !choice.weight.is_finite() || choice.weight < 0.0 {
                return Err("switch count weights must be finite values >= 0".to_string());
            }
            Ok(WeightedSwitchCount {
                count: choice.count,
                weight: choice.weight,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    if !switch_count_weights.is_empty()
        && !switch_count_weights
            .iter()
            .any(|choice| choice.weight > 0.0)
    {
        return Err("switch count weights must have at least one positive weight".to_string());
    }

    let seed_mode = match seed_mode.as_str() {
        "locked" => SwitchSeedMode::Locked { seed },
        "perCycle" => SwitchSeedMode::PerCycle { seed },
        "history" => SwitchSeedMode::History {
            seed,
            history: history_seeds,
            history_weight,
            new_seed_weight,
            max_history,
        },
        other => return Err(format!("unknown seed mode: {other}")),
    };

    Ok(Score::subdivision_switch(
        &name,
        SubdivisionSwitchSpec {
            cycle_beats,
            initial_weights,
            initial_jathi_weights,
            initial_custom_subdivision,
            automation,
            inflections,
            switch_count_weights,
            seed_mode,
            accent,
            pitch,
            velocity,
        },
    ))
}

fn validate_subdivision_weights(
    label: &str,
    weights: Vec<SubdivisionWeightDto>,
) -> Result<Vec<WeightedSubdivisionChoice>, String> {
    weights
        .into_iter()
        .map(|choice| {
            if choice.subdivision == 0 || choice.subdivision > 64 {
                return Err(format!("{label}: gati choices must be 1-64"));
            }
            if !choice.weight.is_finite() || choice.weight < 0.0 {
                return Err(format!("{label}: weights must be finite values >= 0"));
            }
            Ok(WeightedSubdivisionChoice {
                subdivision: choice.subdivision,
                weight: choice.weight,
            })
        })
        .collect()
}

fn custom_subdivision_from_dto(
    label: &str,
    dto: CustomSubdivisionDto,
) -> Result<CustomSubdivisionSpec, String> {
    if !dto.per_beat_weight.is_finite() || dto.per_beat_weight < 0.0 {
        return Err(format!("{label} per_beat_weight must be finite and >= 0"));
    }
    if !dto.equal_parts_weight.is_finite() || dto.equal_parts_weight < 0.0 {
        return Err(format!(
            "{label} equal_parts_weight must be finite and >= 0"
        ));
    }
    let part_count_weights = dto
        .part_count_weights
        .into_iter()
        .map(|choice| {
            if choice.count == 0 || choice.count > 64 {
                return Err(format!("{label} part counts must be 1-64"));
            }
            if !choice.weight.is_finite() || choice.weight < 0.0 {
                return Err(format!(
                    "{label} part-count weights must be finite values >= 0"
                ));
            }
            Ok(WeightedCustomPartCount {
                count: choice.count,
                weight: choice.weight,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let part_gati_weights =
        validate_subdivision_weights(&format!("{label} part_gati_weights"), dto.part_gati_weights)?;
    let divisions = dto
        .divisions
        .into_iter()
        .enumerate()
        .map(|(index, division)| {
            let gati_weights = validate_subdivision_weights(
                &format!("{label} division {}", index + 1),
                division.gati_weights,
            )?;
            Ok(CustomDivision { gati_weights })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let _legacy_jathi_weights = dto.jathi_weights;
    let spec = CustomSubdivisionSpec {
        per_beat_weight: dto.per_beat_weight,
        equal_parts_weight: dto.equal_parts_weight,
        part_count_weights,
        part_gati_weights,
        divisions,
        // Legacy field: equal-parts sections now use regular section-level
        // jathi weights, so custom DTO jathi weights are intentionally ignored.
        jathi_weights: vec![],
    };
    spec.validate().map_err(|err| format!("{label}: {err}"))?;
    Ok(spec)
}

fn validate_jathi_weights(
    label: &str,
    weights: Vec<JathiWeightDto>,
) -> Result<Vec<WeightedJathiChoice>, String> {
    weights
        .into_iter()
        .map(|choice| {
            if !is_allowed_jathi(choice.jathi) {
                return Err(format!(
                    "{label}: jathi choices must be one of 3, 4, 5, 6, 7, 9, 11"
                ));
            }
            if !choice.weight.is_finite() || choice.weight < 0.0 {
                return Err(format!("{label}: weights must be finite values >= 0"));
            }
            Ok(WeightedJathiChoice {
                jathi: choice.jathi,
                weight: choice.weight,
            })
        })
        .collect()
}

fn validate_accent_settings(accent: AccentSettingsDto) -> Result<GatiAccentSpec, String> {
    let jathi_mode = match accent.jathi_mode.as_str() {
        "overrideGati" => JathiAccentMode::OverrideGati,
        "layered" => JathiAccentMode::Layered,
        other => return Err(format!("unknown jathi accent mode: {other}")),
    };

    Ok(GatiAccentSpec {
        beat_start: validate_accent_range("beat start accent", accent.beat_start)?,
        section_start_extra: validate_accent_range(
            "section start extra accent",
            accent.section_start_extra,
        )?,
        jathi_start: validate_accent_range("jathi start accent", accent.jathi_start)?,
        jathi_mode,
    })
}

fn default_jathi_start_dto() -> VelocityAccentRangeDto {
    VelocityAccentRangeDto { min: 24, max: 36 }
}

fn default_jathi_mode_dto() -> String {
    "overrideGati".to_string()
}

fn validate_accent_range(
    label: &str,
    range: VelocityAccentRangeDto,
) -> Result<VelocityAccentRange, String> {
    if range.min > range.max {
        return Err(format!("{label} min must be <= max"));
    }
    if range.max > 127 {
        return Err(format!("{label} values must be 0-127"));
    }
    Ok(VelocityAccentRange {
        min: range.min,
        max: range.max,
    })
}

/// Convert an f64 in (0, 1) to the exact authored after-beat boundary.
///
/// Boundary positions cross the bridge as floats, but the musical model needs
/// the rational `after_beat / cycle_beats`. Snapping through the beat count
/// avoids 2/3 becoming a rational just after the actual beat boundary.
fn position_to_beat_rational(value: f64, cycle_beats: u32) -> Result<Rational, String> {
    if !value.is_finite() {
        return Err("position is not finite".to_string());
    }
    let scaled = value * f64::from(cycle_beats);
    let after_beat = scaled.round();
    if (scaled - after_beat).abs() > 1.0e-6 {
        return Err("position must align to a whole beat boundary".to_string());
    }
    if after_beat <= 0.0 || after_beat >= f64::from(cycle_beats) {
        return Err("position must lie strictly inside the cycle".to_string());
    }
    Ok(Rational::new(after_beat as i64, cycle_beats as i64))
}

fn default_fixed_switch_inflections(count: usize) -> Vec<SubdivisionInflection> {
    let denom = (count + 1) as i64;
    (0..count)
        .map(|i| SubdivisionInflection {
            id: None,
            position: Rational::new(i as i64 + 1, denom),
            change_probability: 1.0,
            subdivision_weights: vec![WeightedSubdivisionChoice {
                subdivision: [3, 4, 5, 7][i % 4],
                weight: 1.0,
            }],
            jathi_weights: vec![],
            custom_subdivision: None,
        })
        .collect()
}

fn patch_schema_version(
    object: &serde_json::Map<String, serde_json::Value>,
) -> Result<u64, String> {
    object
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "patch is missing schemaVersion".to_string())
}

/// Keys owned by features that are deliberately absent from Dum-Ka's v1
/// persistence schema. The TypeScript authoring model still carries several
/// compatibility fields in memory, so validation must fail closed if a caller
/// bypasses the explicit persistence projection (for example by spreading a
/// document and thereby dropping its non-enumerable `toJSON`).
const STRIPPED_PATCH_KEYS: &[&str] = &[
    "rhythm",
    "pitchShaper",
    "shapeGroups",
    "beatLocks",
    "ratchet",
    "ornament",
    "cycleTempoFlux",
    "scoreSnapshot",
    "randomize",
    "probabilityOpen",
    "initialJathiBhedam",
    "initialCustomSubdivision",
    "initialWeights",
    "initialJathiWeights",
    "sectionCountWeights",
    "singleParameterRhythmicModulation",
    "changeProbability",
    "jathiWeights",
    "customSubdivision",
    "jathiBhedam",
    "rhythmPlaybackEnabled",
    "ratchetMode",
    "wholeProbabilityPercent",
    "perHitProbabilityPercent",
    "preserveFirstHit",
    "ornamentMode",
    "ornamentWholeProbabilityPercent",
    "ornamentPerGraceProbabilityPercent",
    "newSeedChance",
    "holdChance",
    "blendCycles",
];

const EVOLUTION_DIRECTIVE_KEYS: &[&str] = &[
    "id",
    "order",
    "enabled",
    "fromCycle",
    "toCycle",
    "family",
    "pacing",
    "magnitude",
    "intensity",
    "scope",
    "options",
];
const EVOLUTION_SCOPE_KEYS: &[&str] = &["startBeat", "lenBeats"];
const EVOLUTION_CURVE_KEYS: &[&str] = &[
    "enabled",
    "modelVersion",
    "toleranceMilli",
    "maxOperations",
    "points",
];
const EVOLUTION_CURVE_POINT_KEYS: &[&str] = &["cycle", "targetMilli"];
const EVOLUTION_MAGNITUDE_KEYS: &[&str] = &[
    "mode",
    "modelVersion",
    "targetMilli",
    "toleranceMilli",
    "maxOperations",
];
const EVOLUTION_OPTION_KEYS: &[&str] = &[
    "barlowTemperature",
    "fillComplexity",
    "densityFloor",
    "densityCeiling",
    "euclidMaxRun",
    "euclidInvert",
    "euclidRestPolicy",
    "rotateDirection",
];

fn validate_evolution_object_keys(
    object: &serde_json::Map<String, serde_json::Value>,
    allowed: &[&str],
    path: &str,
    label: &str,
) -> Result<(), String> {
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!(
            "unsupported evolution {label} key in v1 document: {path}.{key}"
        ));
    }
    Ok(())
}

/// Validate the strict nested part of a v1 Dum-Ka generator without making
/// the otherwise-tolerant patch reader deserialize the complete generator.
/// Unknown family values remain a load-warning/disabled-row concern in the UI,
/// but unknown object keys must fail closed so future schema cannot execute as
/// current v1 data.
fn validate_v1_evolution_plan_shape(
    generator: &serde_json::Map<String, serde_json::Value>,
    path: &str,
) -> Result<(), String> {
    let Some(plan) = generator.get("plan").and_then(serde_json::Value::as_array) else {
        return Ok(());
    };
    if plan.len() > cseq_rhythm::MAX_EVOLUTION_DIRECTIVES {
        return Err(format!(
            "dumka evolution plan in v1 document supports at most {} directives, got {}: {path}.plan",
            cseq_rhythm::MAX_EVOLUTION_DIRECTIVES,
            plan.len()
        ));
    }

    for (index, directive) in plan.iter().enumerate() {
        let Some(directive) = directive.as_object() else {
            continue;
        };
        let directive_path = format!("{path}.plan[{index}]");
        validate_evolution_object_keys(
            directive,
            EVOLUTION_DIRECTIVE_KEYS,
            &directive_path,
            "directive",
        )?;
        if let Some(id) = directive.get("id").filter(|id| id.is_number()) {
            if id.as_u64().is_some_and(|id| id > JS_MAX_SAFE_INTEGER_U64)
                || id
                    .as_f64()
                    .is_some_and(|id| id > 9_007_199_254_740_991.0_f64)
            {
                return Err(format!(
                    "dumka evolution directive id exceeds JavaScript MAX_SAFE_INTEGER in v1 document: {directive_path}.id"
                ));
            }
        }
        if let Some(scope) = directive
            .get("scope")
            .and_then(serde_json::Value::as_object)
        {
            validate_evolution_object_keys(
                scope,
                EVOLUTION_SCOPE_KEYS,
                &format!("{directive_path}.scope"),
                "scope",
            )?;
        }
        if let Some(magnitude) = directive
            .get("magnitude")
            .and_then(serde_json::Value::as_object)
        {
            validate_evolution_object_keys(
                magnitude,
                EVOLUTION_MAGNITUDE_KEYS,
                &format!("{directive_path}.magnitude"),
                "magnitude",
            )?;
        }
        if let Some(options) = directive
            .get("options")
            .and_then(serde_json::Value::as_object)
        {
            validate_evolution_object_keys(
                options,
                EVOLUTION_OPTION_KEYS,
                &format!("{directive_path}.options"),
                "options",
            )?;
        }
    }

    if let Some(curve) = generator
        .get("evolutionCurve")
        .and_then(serde_json::Value::as_object)
    {
        let curve_path = format!("{path}.evolutionCurve");
        validate_evolution_object_keys(curve, EVOLUTION_CURVE_KEYS, &curve_path, "curve")?;
        if let Some(points) = curve.get("points").and_then(serde_json::Value::as_array) {
            if points.len() > cseq_rhythm::MAX_CURVE_POINTS {
                return Err(format!(
                    "dumka evolution curve in v1 document supports at most {} points, got {}: {curve_path}.points",
                    cseq_rhythm::MAX_CURVE_POINTS,
                    points.len()
                ));
            }
            for (index, point) in points.iter().enumerate() {
                let Some(point) = point.as_object() else {
                    continue;
                };
                validate_evolution_object_keys(
                    point,
                    EVOLUTION_CURVE_POINT_KEYS,
                    &format!("{curve_path}.points[{index}]"),
                    "curve point",
                )?;
            }
        }
    }
    Ok(())
}

fn validate_v1_persisted_shape(value: &serde_json::Value, path: &str) -> Result<(), String> {
    match value {
        serde_json::Value::Object(object) => {
            if object.get("kind").and_then(serde_json::Value::as_str) == Some("dumka") {
                validate_v1_evolution_plan_shape(object, path)?;
            }
            for (key, child) in object {
                let child_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                if STRIPPED_PATCH_KEYS.contains(&key.as_str()) {
                    return Err(format!(
                        "unsupported stripped-feature key in v1 document: {child_path}"
                    ));
                }
                if key == "seedBehavior"
                    && !matches!(
                        child.as_str(),
                        Some("followGlobal" | "locked" | "perCycle" | "history")
                    )
                {
                    return Err(format!(
                        "unsupported channel seed behavior in v1 document: {child_path}"
                    ));
                }
                if key == "seedMode"
                    && child.is_string()
                    && !matches!(child.as_str(), Some("locked" | "perCycle" | "history"))
                {
                    return Err(format!(
                        "unsupported sequencer seed mode in v1 document: {child_path}"
                    ));
                }
                validate_v1_persisted_shape(child, &child_path)?;
            }
        }
        serde_json::Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                validate_v1_persisted_shape(child, &format!("{path}[{index}]"))?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_patch_document(patch: &serde_json::Value) -> Result<(), String> {
    let object = patch
        .as_object()
        .ok_or_else(|| "patch must be a JSON object".to_string())?;

    let app = object
        .get("app")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "patch is missing app".to_string())?;
    if app != PATCH_APP_ID {
        return Err(format!("unsupported patch app: {app}"));
    }

    let schema_version = patch_schema_version(object)?;
    if schema_version != PATCH_SCHEMA_VERSION {
        return Err(format!(
            "unsupported patch schema version: {schema_version}"
        ));
    }

    for section in ["transport", "sequencer"] {
        if !object
            .get(section)
            .is_some_and(serde_json::Value::is_object)
        {
            return Err(format!("patch is missing {section} state"));
        }
    }

    if !object
        .get("project")
        .is_some_and(serde_json::Value::is_object)
    {
        return Err("patch is missing project state".to_string());
    }

    validate_v1_persisted_shape(patch, "")?;

    Ok(())
}

fn validate_current_patch_document(patch: &serde_json::Value) -> Result<(), String> {
    validate_patch_document(patch)?;
    let object = patch
        .as_object()
        .ok_or_else(|| "patch must be a JSON object".to_string())?;
    let schema_version = patch_schema_version(object)?;
    if schema_version != PATCH_SCHEMA_VERSION {
        return Err(format!(
            "unsupported patch schema version for save: {schema_version}"
        ));
    }
    Ok(())
}

/// Validate a single-track export envelope.
///
/// Mirrors [`validate_patch_document`] but for the track-only document shape:
/// `{ app, kind: "track", schemaVersion, track: { … } }`. We only accept the
/// current fork-owned v1 schema because there are no legacy variants to
/// migrate from.
fn validate_track_document(document: &serde_json::Value) -> Result<(), String> {
    let object = document
        .as_object()
        .ok_or_else(|| "track document must be a JSON object".to_string())?;

    let app = object
        .get("app")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "track document is missing app".to_string())?;
    if app != PATCH_APP_ID {
        return Err(format!("unsupported track document app: {app}"));
    }

    let kind = object
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "track document is missing kind".to_string())?;
    if kind != "track" {
        return Err(format!("unsupported track document kind: {kind}"));
    }

    let schema_version = object
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "track document is missing schemaVersion".to_string())?;
    if schema_version != PATCH_SCHEMA_VERSION {
        return Err(format!(
            "unsupported track document schema version: {schema_version}"
        ));
    }

    if !object
        .get("track")
        .is_some_and(serde_json::Value::is_object)
    {
        return Err("track document is missing track state".to_string());
    }

    validate_v1_persisted_shape(document, "")?;

    Ok(())
}

/// Helper: set a score on transport and store in app state.
fn set_score_on_transport(state: &State<'_, Arc<AppState>>, score: Score) -> Result<(), String> {
    let transport_guard = state.transport.lock();
    let transport = transport_guard
        .as_ref()
        .ok_or("transport not initialized")?;
    transport
        // Single-track score apply stays immediate for P1 (seamless is P2).
        .set_score(score.clone(), ApplyQuantize::Immediate)
        .map_err(|e| e.to_string())?;
    *state.current_score.lock() = Some(score);
    Ok(())
}

/// Toggle the built-in DLS synth for audio monitoring.
#[tauri::command]
fn synth_set_enabled(enabled: bool, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let guard = state.transport.lock();
    let transport = guard.as_ref().ok_or("transport not initialized")?;
    if enabled {
        transport.enable_synth().map_err(|e| e.to_string())
    } else {
        transport.disable_synth().map_err(|e| e.to_string())
    }
}

/// Set local built-in synth monitor voices by user-facing channel.
#[tauri::command]
fn synth_set_programs(
    programs: Vec<SynthChannelProgramDto>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let guard = state.transport.lock();
    let transport = guard.as_ref().ok_or("transport not initialized")?;
    let programs = programs
        .into_iter()
        .map(|program| SynthChannelProgram {
            channel: program.channel.clamp(1, 16),
            mode: match program.mode {
                SynthChannelModeDto::Melodic => SynthChannelMode::Melodic,
                SynthChannelModeDto::Percussion => SynthChannelMode::Percussion,
            },
            program: program.program.min(127),
            drum_note: program.drum_note.min(127),
        })
        .collect();
    transport
        .set_synth_programs(programs)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// Snapshot polling task
// ---------------------------------------------------------------------

/// Polls the transport at ~60Hz. Always emits a tiny `transport_position` while
/// playing (or when scalar position changed); emits the heavier
/// `transport_timeline_snapshot` only when render-relevant timeline data
/// changed (excluding bare tick movement); emits `transport_log_snapshot` only
/// when logs are enabled and a log layer changed. One atomic sample per poll;
/// all payloads share the same `sampleEpoch` / `timelineEpoch`.
fn spawn_snapshot_emitter(app: AppHandle, state: Arc<AppState>) {
    std::thread::Builder::new()
        .name("cseq-snapshot-emitter".to_string())
        .spawn(move || {
            let interval = Duration::from_millis(16); // ~60Hz

            loop {
                std::thread::sleep(interval);

                let mut telem = state.telemetry.lock();

                let sample = {
                    let guard = state.transport.lock();
                    let Some(transport) = guard.as_ref() else {
                        continue;
                    };
                    transport.sample_telemetry(
                        telem.last_timeline_digest.as_ref(),
                        telem.last_log_digest.as_ref(),
                        telem.log_interest,
                        false,
                    )
                };

                telem.next_sample_epoch = telem.next_sample_epoch.saturating_add(1);
                let sample_epoch = telem.next_sample_epoch;

                // Timeline snapshot: only when the timeline digest changed.
                if let Some(timeline_layers) = &sample.timeline_layers {
                    telem.timeline_epoch = telem.timeline_epoch.saturating_add(1);
                    telem.last_timeline_digest = Some(sample.timeline_digest.clone());
                    let dto = TransportTimelineSnapshotDto::build(
                        sample_epoch,
                        telem.timeline_epoch,
                        &sample.position,
                        timeline_layers,
                    );
                    if let Err(e) = app.emit("transport_timeline_snapshot", &dto) {
                        error!(error = %e, "failed to emit timeline snapshot");
                    }
                }
                let timeline_epoch = telem.timeline_epoch;

                // Log snapshot: only when enabled and a log layer changed.
                if let Some(log_layers) = &sample.log_layers {
                    telem.log_epoch = telem.log_epoch.saturating_add(1);
                    telem.last_log_digest = Some(sample.log_digest);
                    let dto = TransportLogSnapshotDto::build(
                        sample_epoch,
                        telem.log_epoch,
                        timeline_epoch,
                        telem.log_interest,
                        log_layers,
                    );
                    if let Err(e) = app.emit("transport_log_snapshot", &dto) {
                        error!(error = %e, "failed to emit log snapshot");
                    }
                }

                // Position: every poll while playing; while stopped only when a
                // scalar changed (so an idle transport stops re-emitting).
                let sig = PositionSig::of(&sample.position);
                let position_changed = telem.last_position_sig.as_ref() != Some(&sig);
                if sample.position.is_playing || position_changed {
                    telem.last_position_sig = Some(sig);
                    let dto =
                        TransportPositionDto::build(sample_epoch, timeline_epoch, &sample.position);
                    if let Err(e) = app.emit("transport_position", &dto) {
                        error!(error = %e, "failed to emit position");
                    }
                }
            }
        })
        .expect("failed to spawn snapshot emitter thread");
}

fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let new_patch = MenuItem::with_id(app, MENU_NEW_PATCH, "New Patch", true, Some("CmdOrCtrl+N"))?;
    let save_patch = MenuItem::with_id(
        app,
        MENU_SAVE_PATCH,
        "Save Patch",
        true,
        Some("CmdOrCtrl+S"),
    )?;
    let save_patch_as = MenuItem::with_id(
        app,
        MENU_SAVE_PATCH_AS,
        "Save Patch As...",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let recall_patch = MenuItem::with_id(
        app,
        MENU_RECALL_PATCH,
        "Recall Patch...",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let recall_recent_patch = MenuItem::with_id(
        app,
        MENU_RECALL_RECENT_PATCH,
        "Recall Most Recent Patch",
        true,
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let export_score = MenuItem::with_id(
        app,
        MENU_EXPORT_SCORE,
        "Export Cycle JSON...",
        true,
        Some("CmdOrCtrl+Shift+E"),
    )?;
    let toggle_autosave = MenuItem::with_id(
        app,
        MENU_TOGGLE_AUTOSAVE,
        "Toggle Autosave Recovery",
        true,
        Some("CmdOrCtrl+Alt+A"),
    )?;
    let toggle_rhythm_shaper = MenuItem::with_id(
        app,
        MENU_TOGGLE_RHYTHM_SHAPER,
        "Toggle Rhythm Shaper",
        true,
        Some("CmdOrCtrl+Shift+R"),
    )?;
    let reset_transport_sync = MenuItem::with_id(
        app,
        MENU_RESET_TRANSPORT_SYNC,
        "Reset Timeline Sync",
        true,
        Some("CmdOrCtrl+Alt+R"),
    )?;
    let midi_panic = MenuItem::with_id(
        app,
        MENU_MIDI_PANIC,
        "MIDI Panic",
        true,
        Some("CmdOrCtrl+."),
    )?;
    let toggle_synth = MenuItem::with_id(
        app,
        MENU_TOGGLE_SYNTH,
        "Toggle Built-in Synth",
        true,
        Some("CmdOrCtrl+Alt+S"),
    )?;
    let synth_properties = MenuItem::with_id(
        app,
        MENU_SYNTH_PROPERTIES,
        "Built-in Synth Properties...",
        true,
        Some("CmdOrCtrl+Shift+P"),
    )?;
    let audio_midi_setup = MenuItem::with_id(
        app,
        MENU_AUDIO_MIDI_SETUP,
        "Audio & MIDI Setup...",
        true,
        None::<&str>,
    )?;
    let seed_strategy = MenuItem::with_id(
        app,
        MENU_SEED_STRATEGY,
        "Seed Strategy...",
        true,
        None::<&str>,
    )?;

    let file_separator = PredefinedMenuItem::separator(app)?;
    let file_create_separator = PredefinedMenuItem::separator(app)?;
    let close_window = PredefinedMenuItem::close_window(app, None)?;
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_patch,
            &file_create_separator,
            &save_patch,
            &save_patch_as,
            &recall_patch,
            &recall_recent_patch,
            &export_score,
            &toggle_autosave,
            &file_separator,
            &close_window,
        ],
    )?;

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let edit_separator = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &undo,
            &redo,
            &edit_separator,
            &cut,
            &copy,
            &paste,
            &select_all,
        ],
    )?;

    let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
    let view_separator = PredefinedMenuItem::separator(app)?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&toggle_rhythm_shaper, &view_separator, &fullscreen],
    )?;

    let setup_separator = PredefinedMenuItem::separator(app)?;
    let setup_menu = Submenu::with_items(
        app,
        "Setup",
        true,
        &[&audio_midi_setup, &setup_separator, &seed_strategy],
    )?;

    let playback_separator = PredefinedMenuItem::separator(app)?;
    let playback_menu = Submenu::with_items(
        app,
        "Playback",
        true,
        &[
            &midi_panic,
            &reset_transport_sync,
            &playback_separator,
            &synth_properties,
            &toggle_synth,
        ],
    )?;

    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let maximize = PredefinedMenuItem::maximize(app, None)?;
    let window_separator = PredefinedMenuItem::separator(app)?;
    let window_close = PredefinedMenuItem::close_window(app, None)?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[&minimize, &maximize, &window_separator, &window_close],
    )?;

    let help_menu = Submenu::with_items(app, "Help", true, &[])?;

    #[cfg(target_os = "macos")]
    {
        let about = PredefinedMenuItem::about(app, None, None)?;
        let app_separator_1 = PredefinedMenuItem::separator(app)?;
        let services = PredefinedMenuItem::services(app, None)?;
        let app_separator_2 = PredefinedMenuItem::separator(app)?;
        let hide = PredefinedMenuItem::hide(app, None)?;
        let hide_others = PredefinedMenuItem::hide_others(app, None)?;
        let app_separator_3 = PredefinedMenuItem::separator(app)?;
        let quit = PredefinedMenuItem::quit(app, None)?;
        let app_menu = Submenu::with_items(
            app,
            "Dum-Ka",
            true,
            &[
                &about,
                &app_separator_1,
                &services,
                &app_separator_2,
                &hide,
                &hide_others,
                &app_separator_3,
                &quit,
            ],
        )?;

        Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &view_menu,
                &setup_menu,
                &playback_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        let quit_separator = PredefinedMenuItem::separator(app)?;
        let quit = PredefinedMenuItem::quit(app, None)?;
        file_menu.append_items(&[&quit_separator, &quit])?;

        Menu::with_items(
            app,
            &[
                &file_menu,
                &edit_menu,
                &view_menu,
                &setup_menu,
                &playback_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }
}

fn emit_native_menu_action(app: &AppHandle, action: &str) {
    if let Err(e) = app.emit(MENU_ACTION_EVENT, action) {
        error!(error = %e, action, "failed to emit native menu action");
    }
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

/// The app's full command surface. Shared by the production Tauri builder and
/// the e2e harness so the harness can never drift to a different command set.
fn invoke_handler<R: tauri::Runtime>(
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        transport_play,
        transport_stop,
        transport_resync,
        transport_set_tempo,
        transport_get_snapshot,
        transport_set_telemetry_interest,
        patch_save_to_path,
        patch_load_from_path,
        track_save_to_path,
        track_load_from_path,
        patch_autosave,
        patch_load_autosave,
        patch_clear_autosave,
        score_load_from_path,
        score_save_to_path,
        score_get_current,
        score_load_preset,
        score_create_subdivision,
        score_create_subdivision_switch,
        score_preview_subdivision_switch,
        generator_preview,
        track_set_playback,
        parallel_set_playback,
        synth_set_enabled,
        synth_set_programs,
        transport_panic,
        midi_list_destinations,
        midi_set_destination,
        midi_get_route_status,
        machine_prefs_get,
        machine_prefs_set,
    ]
}

fn main() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,cseq_transport=debug,cseq_midi=debug"));
    tracing_subscriber::fmt().with_env_filter(filter).init();

    #[cfg(feature = "e2e-harness")]
    if let Ok(port) = std::env::var("CAESURA_E2E_HARNESS_PORT") {
        let port: u16 = port
            .parse()
            .expect("CAESURA_E2E_HARNESS_PORT must be a u16 port number");
        e2e_harness::run(port);
        return;
    }

    let app_state = Arc::new(AppState::new());

    tauri::Builder::default()
        .menu(build_app_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_NEW_PATCH => emit_native_menu_action(app, MENU_ACTION_NEW_PATCH),
            MENU_SAVE_PATCH => emit_native_menu_action(app, MENU_ACTION_SAVE_PATCH),
            MENU_SAVE_PATCH_AS => emit_native_menu_action(app, MENU_ACTION_SAVE_PATCH_AS),
            MENU_RECALL_PATCH => emit_native_menu_action(app, MENU_ACTION_RECALL_PATCH),
            MENU_RECALL_RECENT_PATCH => {
                emit_native_menu_action(app, MENU_ACTION_RECALL_RECENT_PATCH)
            }
            MENU_EXPORT_SCORE => emit_native_menu_action(app, MENU_ACTION_EXPORT_SCORE),
            MENU_TOGGLE_AUTOSAVE => emit_native_menu_action(app, MENU_ACTION_TOGGLE_AUTOSAVE),
            MENU_AUDIO_MIDI_SETUP => emit_native_menu_action(app, MENU_ACTION_OPEN_SETUP),
            MENU_SEED_STRATEGY => emit_native_menu_action(app, MENU_ACTION_OPEN_SEEDS),
            MENU_TOGGLE_RHYTHM_SHAPER => {
                emit_native_menu_action(app, MENU_ACTION_TOGGLE_RHYTHM_SHAPER)
            }
            MENU_RESET_TRANSPORT_SYNC => {
                emit_native_menu_action(app, MENU_ACTION_RESET_TRANSPORT_SYNC)
            }
            MENU_MIDI_PANIC => emit_native_menu_action(app, MENU_ACTION_MIDI_PANIC),
            MENU_TOGGLE_SYNTH => emit_native_menu_action(app, MENU_ACTION_TOGGLE_SYNTH),
            MENU_SYNTH_PROPERTIES => {
                emit_native_menu_action(app, MENU_ACTION_OPEN_SYNTH_PROPERTIES)
            }
            _ => {}
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state.clone())
        .invoke_handler(invoke_handler())
        .setup(move |app| {
            let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();

            // Machine-local config first: everything after (autosave path,
            // destination restore) resolves through it.
            let machine_dir = resolve_machine_dir(app.path().app_config_dir().ok());
            let _ = state.machine_dir.set(machine_dir.clone());
            let (prefs, source) = load_machine_prefs(&machine_dir);
            migrate_legacy_autosave(&machine_dir);
            let startup_destination = prefs.midi_destination.clone();
            *state.machine_prefs.lock() = prefs;
            *state.machine_prefs_source.lock() = source;

            match Transport::start("Dum-Ka MIDI") {
                Ok(transport) => {
                    info!("transport started");
                    *state.transport.lock() = Some(Arc::new(transport));
                }
                Err(e) => {
                    error!(error = %e, "failed to start transport");
                }
            }

            // Restore the routed destination from machine prefs (connect or
            // mark missing), then keep it reconciled on CoreMIDI hot-plug
            // notifications. The notification client must be created on the
            // main thread (its run loop delivers the callbacks) and must stay
            // alive for the app's lifetime; the callback only pokes a channel
            // — the reconcile itself runs on the watch worker.
            if startup_destination.is_some() {
                state.midi_route.lock().desired = startup_destination;
                reconcile_midi_route(app.handle(), &state);
            }
            let (watch_tx, watch_rx) = std::sync::mpsc::sync_channel::<()>(1);
            match coremidi::Client::new_with_notifications(
                "Dum-Ka MIDI Watch",
                move |notification: &coremidi::Notification| {
                    // Only destination-topology changes can invalidate the
                    // captured endpoint inside midir's connection. Keep the
                    // callback main-run-loop-safe: classify the borrowed
                    // notification, then only try_send into the bounded poke
                    // channel. Enumeration and reconnect stay on the worker.
                    let route_topology_changed = match notification {
                        coremidi::Notification::ObjectAdded(info)
                        | coremidi::Notification::ObjectRemoved(info) => matches!(
                            &info.child,
                            coremidi::AnyObject::Destination(_)
                                | coremidi::AnyObject::ExternalDestination(_)
                        ),
                        _ => false,
                    };
                    if route_topology_changed {
                        let _ = watch_tx.try_send(());
                    }
                },
            ) {
                Ok(client) => {
                    app.manage(MidiWatchClient(client));
                    let watch_app = app.handle().clone();
                    let watch_state = state.clone();
                    std::thread::Builder::new()
                        .name("cseq-midi-watch".to_string())
                        .spawn(move || {
                            while watch_rx.recv().is_ok() {
                                // Debounce the burst of notifications CoreMIDI
                                // emits per device change.
                                while watch_rx.recv_timeout(Duration::from_millis(300)).is_ok() {}
                                reconcile_midi_route_after_notification(&watch_app, &watch_state);
                            }
                        })
                        .expect("failed to spawn MIDI watch thread");
                }
                Err(status) => {
                    debug!(
                        status,
                        "CoreMIDI notification client unavailable; rescan-only mode"
                    );
                }
            }

            spawn_snapshot_emitter(app.handle().clone(), state);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri application")
        .run(|app, event| {
            // Guarantee the shutdown sweep (note-offs on both MIDI legs) runs
            // even when Tauri's exit path would skip managed-state drops.
            if let tauri::RunEvent::Exit = event {
                let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
                let transport = state.transport.lock().take();
                if let Some(transport) = transport {
                    if let Err(error) = transport.shutdown_now() {
                        warn!(%error, "transport shutdown acknowledgement failed");
                    }
                    drop(transport);
                    info!("transport shut down on exit");
                }
            }
        });
}

/// Keeps the CoreMIDI notification client alive for the app's lifetime.
struct MidiWatchClient(#[allow(dead_code)] coremidi::Client);

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use serde_json::json;

    #[test]
    fn lossless_seed_trace_wire_uses_decimal_strings_and_replays_exactly() {
        const ABOVE_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_993;
        const SECOND_FULL_WIDTH_SEED: u64 = 12_345_678_901_234_567_890;

        let dto = PlaybackSeedTraceEventDto::from(cseq_transport::PlaybackSeedTraceEvent {
            cycle: 17,
            domain: "rhythm".to_string(),
            label: "Rhythm".to_string(),
            seed: ABOVE_JS_SAFE_INTEGER,
            base_seed: Some(u64::MAX),
            source: "new".to_string(),
            history_before: vec![ABOVE_JS_SAFE_INTEGER - 1, ABOVE_JS_SAFE_INTEGER],
            history_after: vec![SECOND_FULL_WIDTH_SEED, u64::MAX],
            parallel_track_index: Some(2),
            track_id: Some("track-3".to_string()),
        });
        let wire = serde_json::to_value(dto).expect("seed trace DTO must serialize");

        assert_eq!(wire["cycle"], json!(17));
        assert_eq!(wire["seed"], json!("9007199254740993"));
        assert_eq!(wire["baseSeed"], json!("18446744073709551615"));
        assert_eq!(
            wire["historyBefore"],
            json!(["9007199254740992", "9007199254740993"])
        );
        assert_eq!(
            wire["historyAfter"],
            json!(["12345678901234567890", "18446744073709551615"])
        );

        let replay_dto: SeedPathPlaybackEntryDto =
            serde_json::from_value(wire).expect("canonical string seed path must deserialize");
        let replay = SeedPathPlaybackEntry::from(replay_dto);
        assert_eq!(replay.cycle, 17);
        assert_eq!(replay.seed, ABOVE_JS_SAFE_INTEGER);
        assert_eq!(replay.base_seed, Some(u64::MAX));
        assert_eq!(
            replay.history_before,
            vec![ABOVE_JS_SAFE_INTEGER - 1, ABOVE_JS_SAFE_INTEGER]
        );
        assert_eq!(replay.history_after, vec![SECOND_FULL_WIDTH_SEED, u64::MAX]);
    }

    #[test]
    fn lossless_seed_path_accepts_legacy_numeric_payloads() {
        let legacy = r#"{
            "cycle": 8,
            "domain": "global",
            "label": "Global",
            "seed": 9007199254740993,
            "baseSeed": 18446744073709551615,
            "source": "new",
            "historyBefore": [9007199254740992, 9007199254740993],
            "historyAfter": [12345678901234567890, 18446744073709551615],
            "trackId": null
        }"#;

        let dto: SeedPathPlaybackEntryDto =
            serde_json::from_str(legacy).expect("legacy numeric seed path must deserialize");
        let replay = SeedPathPlaybackEntry::from(dto);

        assert_eq!(replay.seed, 9_007_199_254_740_993);
        assert_eq!(replay.base_seed, Some(u64::MAX));
        assert_eq!(
            replay.history_before,
            vec![9_007_199_254_740_992, 9_007_199_254_740_993]
        );
        assert_eq!(
            replay.history_after,
            vec![12_345_678_901_234_567_890, u64::MAX]
        );
    }

    #[test]
    fn preview_seed_dtos_emit_full_width_values_as_decimal_strings() {
        let generator = GeneratorPreviewDto {
            seed: cseq_rhythm::GeneratorSeedResolution {
                seed: 9_007_199_254_740_993,
                source: cseq_rhythm::GeneratorSeedSource::New,
                history: vec![9_007_199_254_740_993, u64::MAX],
            },
            spans: vec![],
            trace: vec![],
            density_corridor: None,
            cycle_distance: None,
        };
        let generator_wire =
            serde_json::to_value(generator).expect("generator preview must serialize");
        assert_eq!(generator_wire["seed"]["seed"], "9007199254740993");
        assert_eq!(
            generator_wire["seed"]["history"],
            json!(["9007199254740993", "18446744073709551615"])
        );
        assert_eq!(generator_wire["trace"], json!([]));

        let subdivision = SubdivisionSwitchPreviewDto {
            cycle: 0,
            beats: vec![],
            pulse_spans: vec![],
            history_seeds: vec![9_007_199_254_740_993, u64::MAX],
        };
        let subdivision_wire =
            serde_json::to_value(subdivision).expect("subdivision preview must serialize");
        assert_eq!(
            subdivision_wire["historySeeds"],
            json!(["9007199254740993", "18446744073709551615"])
        );
    }

    #[test]
    fn generator_preview_trace_defaults_empty_for_legacy_responses() {
        let legacy: GeneratorPreviewDto = serde_json::from_value(json!({
            "seed": { "seed": "5", "source": "locked", "history": [] },
            "spans": []
        }))
        .expect("legacy preview response without trace must remain readable");
        assert!(legacy.trace.is_empty());
        assert!(legacy.density_corridor.is_none());
    }

    #[test]
    fn generator_preview_rejects_unknown_directive_fields_at_serde_boundary() {
        let base = json!({
            "spans": [],
            "enabled": true,
            "generator": {
                "kind": "dumka",
                "plan": [{
                    "id": 1,
                    "order": 0,
                    "enabled": true,
                    "fromCycle": 1,
                    "toCycle": 1,
                    "family": "rotate",
                    "intensity": 25,
                    "scope": null,
                    "options": {
                        "rotateDirection": "earlier",
                        "densityFloor": 20,
                        "densityCeiling": 60,
                        "futureOption": true
                    }
                }]
            },
            "cycle": 1,
            "cycleBeats": 4
        });
        let error = serde_json::from_value::<GeneratorPreviewRequestDto>(base)
            .expect_err("directive options deny unknown fields")
            .to_string();
        assert!(
            error.contains("futureOption"),
            "unexpected serde error: {error}"
        );
    }

    #[test]
    fn generator_preview_defaults_legacy_pacing_and_rejects_unknown_pacing() {
        let request = json!({
            "spans": [],
            "enabled": true,
            "generator": {
                "kind": "dumka",
                "plan": [{
                    "id": 1,
                    "order": 0,
                    "enabled": true,
                    "fromCycle": 1,
                    "toCycle": 4,
                    "family": "barlowRemove",
                    "intensity": 25
                }]
            },
            "cycle": 1,
            "cycleBeats": 4
        });
        let parsed: GeneratorPreviewRequestDto = serde_json::from_value(request.clone())
            .expect("pre-smoothing directives must default to per-cycle pacing");
        let cseq_rhythm::GeneratorConfig::Dumka(params) = parsed.generator else {
            panic!("fixture must deserialize the Dum-Ka variant")
        };
        assert_eq!(
            params.plan[0].pacing,
            cseq_rhythm::DirectivePacing::PerCycle
        );

        let mut unknown = request.clone();
        unknown["generator"]["plan"][0]["pacing"] = json!("futureCurve");
        let error = serde_json::from_value::<GeneratorPreviewRequestDto>(unknown)
            .expect_err("unknown pacing must fail at the strict invoke boundary")
            .to_string();
        assert!(
            error.contains("futureCurve"),
            "unexpected serde error: {error}"
        );

        let mut stochastic = request;
        stochastic["generator"]["plan"][0]["family"] = json!("stochastic");
        stochastic["generator"]["plan"][0]["pacing"] = json!("linear");
        let request: GeneratorPreviewRequestDto = serde_json::from_value(stochastic)
            .expect("known pacing values deserialize before semantic validation");
        assert_eq!(
            resolve_generator_preview(request, &[])
                .expect_err("stochastic transition pacing must fail engine validation"),
            "dumka plan invalid: directive 1 stochastic pacing must be perCycle"
        );
    }

    #[test]
    fn generator_preview_rejects_directive_ids_above_javascript_safe_integer() {
        let request: GeneratorPreviewRequestDto = serde_json::from_value(json!({
            "spans": [],
            "enabled": true,
            "generator": {
                "kind": "dumka",
                "plan": [{
                    "id": JS_MAX_SAFE_INTEGER_U64 + 1,
                    "order": 0,
                    "enabled": true,
                    "fromCycle": 1,
                    "toCycle": 1,
                    "family": "rotate",
                    "intensity": 25
                }]
            },
            "cycle": 1,
            "cycleBeats": 4
        }))
        .expect("Rust can deserialize the full u64 before bridge validation");

        let error = resolve_generator_preview(request, &[])
            .expect_err("unsafe numeric directive identity must fail at invoke boundary");
        assert_eq!(
            error,
            "dumka plan invalid: directive id 9007199254740992 exceeds JavaScript MAX_SAFE_INTEGER 9007199254740991"
        );
    }

    #[test]
    fn subdivision_history_request_accepts_strings_and_legacy_integers() {
        let parse = |history: &str| {
            let payload = format!(
                r#"{{
                    "name": "switch",
                    "cycleBeats": 4,
                    "initialWeights": [{{"subdivision": 4, "weight": 1.0}}],
                    "inflections": [],
                    "switchCountWeights": [],
                    "seedMode": "history",
                    "seed": 7,
                    "historySeeds": {history},
                    "historyWeight": 1.0,
                    "newSeedWeight": 0.0,
                    "maxHistory": 8,
                    "accent": {{
                        "beatStart": {{"min": 0, "max": 0}},
                        "sectionStartExtra": {{"min": 0, "max": 0}},
                        "jathiStart": {{"min": 0, "max": 0}},
                        "jathiMode": "overrideGati"
                    }},
                    "pitch": 60,
                    "velocity": 96
                }}"#
            );
            serde_json::from_str::<SubdivisionSwitchRequestDto>(&payload)
                .expect("subdivision request must deserialize")
        };

        let canonical = parse(r#"["9007199254740993", "18446744073709551615"]"#);
        let legacy = parse("[9007199254740993, 18446744073709551615]");
        for request in [canonical, legacy] {
            assert_eq!(request.history_seeds, vec![9_007_199_254_740_993, u64::MAX]);
        }
    }

    #[test]
    fn score_js_boundary_stringifies_history_without_changing_v3_score_json() {
        let mut request = switch_request(4, vec![], vec![]);
        request.seed_mode = "history".to_string();
        request.history_seeds = vec![9_007_199_254_740_993, u64::MAX];
        request.history_weight = 1.0;
        request.new_seed_weight = 0.0;
        let score = build_subdivision_switch_score(request).expect("history score must build");

        let score_json = serde_json::to_value(&score).expect("v3 score must serialize");
        assert_eq!(
            score_json["pipeline"][0]["kind"]["seed_mode"]["history"],
            json!([9_007_199_254_740_993_u64, u64::MAX]),
            "on-disk schema-v3 score JSON must retain its numeric history shape"
        );

        let js_value = score_value_for_js(&score).expect("score JS DTO must serialize");
        assert_eq!(
            js_value["pipeline"][0]["kind"]["seed_mode"]["history"],
            json!(["9007199254740993", "18446744073709551615"])
        );

        let replayed: Score =
            serde_json::from_value(js_value).expect("JS score value must round-trip to Score");
        let history = replayed
            .pipeline
            .iter()
            .find_map(|transform| match &transform.kind {
                TransformKind::SubdivisionSwitch {
                    seed_mode: SwitchSeedMode::History { history, .. },
                    ..
                } => Some(history),
                _ => None,
            });
        assert_eq!(
            history.map(Vec::as_slice),
            Some(&[9_007_199_254_740_993, u64::MAX][..])
        );
    }

    fn switch_request(
        cycle_beats: u32,
        inflections: Vec<InflectionDto>,
        switch_count_weights: Vec<SwitchCountWeightDto>,
    ) -> SubdivisionSwitchRequestDto {
        SubdivisionSwitchRequestDto {
            name: "switch".to_string(),
            cycle_beats,
            initial_weights: vec![SubdivisionWeightDto {
                subdivision: 4,
                weight: 1.0,
            }],
            initial_jathi_weights: vec![],
            initial_custom_subdivision: None,
            automation: None,
            inflections,
            switch_count_weights,
            seed_mode: "locked".to_string(),
            seed: 7,
            history_seeds: vec![],
            history_weight: 0.0,
            new_seed_weight: 1.0,
            max_history: 8,
            accent: AccentSettingsDto {
                beat_start: VelocityAccentRangeDto { min: 0, max: 0 },
                section_start_extra: VelocityAccentRangeDto { min: 0, max: 0 },
                jathi_start: VelocityAccentRangeDto { min: 0, max: 0 },
                jathi_mode: "overrideGati".to_string(),
            },
            pitch: 60,
            velocity: 96,
        }
    }

    fn inflection(position: f64, subdivision: u32) -> InflectionDto {
        InflectionDto {
            id: None,
            position,
            change_probability: 1.0,
            subdivision_weights: vec![SubdivisionWeightDto {
                subdivision,
                weight: 1.0,
            }],
            jathi_weights: vec![],
            custom_subdivision: None,
        }
    }

    fn custom_subdivision(gatis: &[u32]) -> CustomSubdivisionDto {
        CustomSubdivisionDto {
            per_beat_weight: 0.0,
            equal_parts_weight: 1.0,
            part_count_weights: vec![CustomPartCountDto {
                count: gatis.len() as u32,
                weight: 1.0,
            }],
            part_gati_weights: gatis
                .first()
                .map(|subdivision| {
                    vec![SubdivisionWeightDto {
                        subdivision: *subdivision,
                        weight: 1.0,
                    }]
                })
                .unwrap_or_default(),
            divisions: vec![],
            jathi_weights: vec![],
        }
    }

    fn pitch_automation(length_cycles: u32) -> AutomationSet {
        AutomationSet {
            length_cycles,
            markers: Vec::new(),
            tracks: vec![cseq_model::AutomationTrack {
                id: "pitch".to_string(),
                target: AUTOMATION_TARGET_PITCH.to_string(),
                enabled: true,
                combine: cseq_model::AutomationCombineMode::Replace,
                graph_range: None,
                curves: vec![cseq_model::AutomationCurve {
                    id: "pitch-line".to_string(),
                    enabled: true,
                    interpolation: cseq_model::AutomationInterpolation::Linear,
                    points: vec![
                        cseq_model::AutomationPoint {
                            id: None,
                            time: AutomationTime::zero(),
                            value: cseq_model::AutomationValue::Number { value: 60.0 },
                            anchor_id: None,
                            out_curve: None,
                        },
                        cseq_model::AutomationPoint {
                            id: None,
                            time: AutomationTime::one(),
                            value: cseq_model::AutomationValue::Number { value: 68.0 },
                            anchor_id: None,
                            out_curve: None,
                        },
                    ],
                }],
            }],
        }
    }

    #[test]
    fn generator_preview_cycle_guard_bounds_stopped_but_allows_live_windows() {
        assert!(validate_generator_preview_cycle(MAX_STOPPED_PREVIEW_CYCLE, &[]).is_ok());
        assert!(validate_generator_preview_cycle(MAX_STOPPED_PREVIEW_CYCLE + 1, &[]).is_err());

        let reference_cycle = 50_000;
        let parallel_track_cycle = 1_000_000;
        let live_cycles = [reference_cycle, parallel_track_cycle];
        assert!(validate_generator_preview_cycle(reference_cycle + 2, &live_cycles).is_ok());
        assert!(validate_generator_preview_cycle(parallel_track_cycle - 2, &live_cycles).is_ok());
        assert!(validate_generator_preview_cycle(parallel_track_cycle + 3, &live_cycles).is_err());
    }

    #[test]
    fn generator_preview_live_window_uses_reference_and_matching_parallel_track_cycles() {
        let parallel_cycles = [("track-a", 70_000), ("track-b", 90_000)];
        assert!(
            generator_preview_live_cycles(false, 50_000, Some("track-b"), parallel_cycles)
                .is_empty()
        );
        assert_eq!(
            generator_preview_live_cycles(true, 50_000, Some("track-b"), parallel_cycles),
            vec![50_000, 90_000]
        );
    }

    #[test]
    fn generator_preview_rejects_an_out_of_window_cycle_before_generator_validation() {
        let error = resolve_generator_preview(
            GeneratorPreviewRequestDto {
                spans: Vec::new(),
                enabled: true,
                generator: cseq_rhythm::GeneratorConfig::Dumka(cseq_rhythm::DumkaGeneratorParams {
                    evolution_rate: 101,
                    ..Default::default()
                }),
                cycle: MAX_STOPPED_PREVIEW_CYCLE + 1,
                cycle_beats: 4,
                automation: None,
                track_id: None,
                span_velocities: Vec::new(),
            },
            &[],
        )
        .expect_err("stopped preview beyond the fold horizon must fail closed");

        assert!(error.contains("exceeds the stopped preview limit"));
        assert!(!error.contains("evolutionRate"));
    }

    #[test]
    fn generator_preview_samples_density_automation_at_cycle_start() {
        let automation = AutomationSet {
            length_cycles: 1,
            markers: Vec::new(),
            tracks: vec![ramp_track(
                "generator-density",
                "generator.example.density",
                true,
            )],
        };
        let preview = resolve_generator_preview(
            GeneratorPreviewRequestDto {
                spans: vec![cseq_rhythm::GeneratorSpanInput {
                    span_id: 7,
                    span_len: 8,
                    label: None,
                    section_index: Some(0),
                    subdivision: Some(2),
                }],
                enabled: true,
                generator: cseq_rhythm::GeneratorConfig::default(),
                cycle: 0,
                cycle_beats: 4,
                automation: Some(automation),
                track_id: Some("track-a".to_string()),
                span_velocities: Vec::new(),
            },
            &[],
        )
        .expect("generator preview");

        assert_eq!(preview.spans.len(), 1);
        assert!(
            preview.trace.is_empty(),
            "Example previews never emit Dum-Ka trace"
        );
        assert!(preview.spans[0].cells.iter().all(|cell| cell.rest));
        assert!(
            preview.spans[0]
                .cells
                .iter()
                .all(|cell| cell.velocity.is_none()),
            "a request without spanVelocities keeps velocity-less cells"
        );
    }

    #[test]
    fn generator_preview_stamps_cell_velocities_from_authored_spans() {
        let span_input = |span_id| cseq_rhythm::GeneratorSpanInput {
            span_id,
            span_len: 4,
            label: None,
            section_index: Some(0),
            subdivision: Some(4),
        };
        // Legacy wire shape: no spanVelocities key must still deserialize.
        let legacy: GeneratorPreviewRequestDto = serde_json::from_value(serde_json::json!({
            "spans": [],
            "enabled": false,
            "generator": { "kind": "example" },
            "cycle": 0,
            "cycleBeats": 4,
        }))
        .expect("legacy request without spanVelocities deserializes");
        assert!(legacy.span_velocities.is_empty());

        let preview = resolve_generator_preview(
            GeneratorPreviewRequestDto {
                spans: vec![span_input(7), span_input(8), span_input(9)],
                enabled: true,
                generator: cseq_rhythm::GeneratorConfig::default(),
                cycle: 0,
                cycle_beats: 4,
                automation: None,
                track_id: None,
                span_velocities: vec![
                    GeneratorSpanVelocitiesDto {
                        span_id: 7,
                        velocities: vec![110, 96, 97, 98],
                    },
                    // Shorter than the span: the trailing cells inherit the
                    // last authored entry, like `note_leaf_for_offset` does.
                    GeneratorSpanVelocitiesDto {
                        span_id: 8,
                        velocities: vec![120, 99],
                    },
                ],
            },
            &[],
        )
        .expect("generator preview");

        assert_eq!(preview.spans.len(), 3);
        let velocities_of = |span_id: u64| {
            preview
                .spans
                .iter()
                .find(|span| span.span_id == span_id)
                .expect("span present")
                .cells
                .iter()
                .map(|cell| cell.velocity)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            velocities_of(7),
            vec![Some(110), Some(96), Some(97), Some(98)]
        );
        assert_eq!(
            velocities_of(8),
            vec![Some(120), Some(99), Some(99), Some(99)]
        );
        assert_eq!(velocities_of(9), vec![None, None, None, None]);
    }

    #[test]
    fn subdivision_preview_surfaces_matra_velocities_matching_realization() {
        let mut request = switch_request(4, vec![], vec![]);
        request.accent = AccentSettingsDto {
            beat_start: VelocityAccentRangeDto { min: 4, max: 4 },
            section_start_extra: VelocityAccentRangeDto { min: 8, max: 8 },
            jathi_start: VelocityAccentRangeDto { min: 0, max: 0 },
            jathi_mode: "overrideGati".to_string(),
        };
        let preview =
            score_preview_subdivision_switch(request, 0, Some(80.0)).expect("subdivision preview");

        let beat_spans = preview
            .pulse_spans
            .iter()
            .filter(|span| span.kind == "gatiBeat")
            .collect::<Vec<_>>();
        assert_eq!(beat_spans.len(), 4);
        assert_eq!(beat_spans[0].matra_velocities, vec![108, 96, 96, 96]);
        for span in &beat_spans[1..] {
            assert_eq!(span.matra_velocities, vec![100, 96, 96, 96]);
        }
        // The per-beat accent readout and the span grid agree at beat starts.
        for (beat, span) in preview.beats.iter().zip(&beat_spans) {
            assert_eq!(beat.accent_velocity, span.matra_velocities[0]);
        }
        // Section spans stay empty: the generator seam never fills them.
        assert!(preview
            .pulse_spans
            .iter()
            .filter(|span| span.kind == "section")
            .all(|span| span.matra_velocities.is_empty()));
    }

    #[test]
    fn subdivision_history_preview_matches_the_transport_prefix() {
        let mut request = switch_request(4, vec![], vec![]);
        request.initial_weights = vec![
            SubdivisionWeightDto {
                subdivision: 3,
                weight: 1.0,
            },
            SubdivisionWeightDto {
                subdivision: 4,
                weight: 1.0,
            },
            SubdivisionWeightDto {
                subdivision: 5,
                weight: 1.0,
            },
        ];
        request.seed_mode = "history".to_string();
        request.seed = 99;
        request.history_seeds = vec![11, 22, 33, 44];
        request.history_weight = 1.0;
        request.new_seed_weight = 1.0;
        request.max_history = 2;

        let mut transport =
            build_subdivision_switch_score(request.clone()).expect("history score should build");
        let mut expected_tree = None;
        let mut saw_reuse = false;
        let mut saw_new = false;
        for cycle in 0..=12 {
            let (tree, trace) = cseq_transforms::apply_pipeline_for_cycle_mut_with_seed_trace(
                &mut transport,
                cycle,
            )
            .expect("transport-style history prefix");
            saw_reuse |= trace[0].source == cseq_transforms::SwitchSeedTraceSource::History;
            saw_new |= trace[0].source == cseq_transforms::SwitchSeedTraceSource::New;
            expected_tree = Some(tree);
        }
        assert!(
            saw_reuse && saw_new,
            "fixture must exercise both history branches"
        );
        let expected_history = transport
            .pipeline
            .iter()
            .find_map(|transform| match &transform.kind {
                TransformKind::SubdivisionSwitch {
                    seed_mode: SwitchSeedMode::History { history, .. },
                    ..
                } => Some(history.clone()),
                _ => None,
            })
            .expect("transport history");

        let preview = score_preview_subdivision_switch(request, 12, Some(80.0))
            .expect("random-access history preview");
        assert_eq!(preview.history_seeds, expected_history);
        let expected_geometry = expected_tree
            .expect("last transport tree")
            .pulse_spans
            .iter()
            .map(|span| {
                (
                    span.id,
                    span.start_matra,
                    span.matra_len,
                    cseq_rhythm::generators::pulse_span_subdivision(span),
                )
            })
            .collect::<Vec<_>>();
        let preview_geometry = preview
            .pulse_spans
            .iter()
            .map(|span| (span.id, span.start_matra, span.matra_len, span.subdivision))
            .collect::<Vec<_>>();
        assert_eq!(preview_geometry, expected_geometry);
    }

    #[test]
    fn dumka_preview_samples_each_historical_cycle_start() {
        let automation = AutomationSet {
            length_cycles: 2,
            markers: Vec::new(),
            tracks: vec![cseq_model::AutomationTrack {
                id: "dumka-rate".to_string(),
                target: "generator.dumka.evolutionRate".to_string(),
                enabled: true,
                combine: cseq_model::AutomationCombineMode::Replace,
                graph_range: None,
                curves: vec![cseq_model::AutomationCurve {
                    id: "dumka-rate-hold".to_string(),
                    enabled: true,
                    interpolation: cseq_model::AutomationInterpolation::Hold,
                    points: vec![
                        cseq_model::AutomationPoint {
                            id: None,
                            time: AutomationTime::zero(),
                            value: cseq_model::AutomationValue::Number { value: 0.0 },
                            anchor_id: None,
                            out_curve: None,
                        },
                        cseq_model::AutomationPoint {
                            id: None,
                            time: AutomationTime::new(1, 2).unwrap(),
                            value: cseq_model::AutomationValue::Number { value: 100.0 },
                            anchor_id: None,
                            out_curve: None,
                        },
                    ],
                }],
            }],
        };
        let generator = cseq_rhythm::GeneratorConfig::Dumka(cseq_rhythm::DumkaGeneratorParams {
            pattern: cseq_rhythm::DEFAULT_DUMKA_PATTERN.to_string(),
            evolution_rate: 0,
            drift_leash: 25,
            seed_mode: cseq_rhythm::GeneratorSeedMode::Locked { seed: 7 },
            ..Default::default()
        });
        let spans = (0..4)
            .map(|index| cseq_rhythm::GeneratorSpanInput {
                span_id: index + 1,
                span_len: 4,
                label: None,
                section_index: Some(0),
                subdivision: Some(4),
            })
            .collect::<Vec<_>>();
        let preview_cycle = |cycle| {
            resolve_generator_preview(
                GeneratorPreviewRequestDto {
                    spans: spans.clone(),
                    enabled: true,
                    generator: generator.clone(),
                    cycle,
                    cycle_beats: 4,
                    automation: Some(automation.clone()),
                    track_id: Some("track-a".to_string()),
                    span_velocities: Vec::new(),
                },
                &[],
            )
            .expect("Dum-Ka generator preview")
        };

        let cycle_one = preview_cycle(1);
        let cycle_two = preview_cycle(2);
        let sounding = cycle_one
            .spans
            .iter()
            .flat_map(|span| &span.cells)
            .filter(|cell| !cell.rest)
            .count();
        assert_eq!(sounding, 9, "cycle one applies seed 7's Add");
        assert_eq!(
            cycle_two.spans, cycle_one.spans,
            "cycle two's 0% sample must preserve cycle one's 100% step"
        );
    }

    #[test]
    fn generator_history_preview_matches_the_transport_prefix() {
        let authored_mode = cseq_rhythm::GeneratorSeedMode::History {
            seed: 9,
            history: vec![17],
            history_weight: 1,
            new_seed_weight: 1,
            max_history: 4,
        };
        let mut transport_mode = authored_mode.clone();
        let (cycle, expected_seed) = (0..=32)
            .find_map(|cycle| {
                let sequential =
                    cseq_rhythm::resolve_generator_seed(&mut transport_mode, cycle).unwrap();
                let mut one_shot_mode = authored_mode.clone();
                let one_shot =
                    cseq_rhythm::resolve_generator_seed(&mut one_shot_mode, cycle).unwrap();
                (sequential != one_shot).then_some((cycle, sequential))
            })
            .expect("fixture must distinguish sequential History from one-shot resolution");
        assert!(cycle > 0);

        let spans = vec![cseq_rhythm::GeneratorSpanInput {
            span_id: 7,
            span_len: 16,
            label: None,
            section_index: Some(0),
            subdivision: Some(4),
        }];
        let generator =
            cseq_rhythm::GeneratorConfig::Example(cseq_rhythm::ExampleGeneratorParams {
                density_percent: 50,
                seed_mode: authored_mode,
            });
        let preview = resolve_generator_preview(
            GeneratorPreviewRequestDto {
                spans: spans.clone(),
                enabled: true,
                generator: generator.clone(),
                cycle,
                cycle_beats: 4,
                automation: None,
                track_id: Some("history-track".to_string()),
                span_velocities: Vec::new(),
            },
            &[],
        )
        .expect("random-access generator history preview");
        assert_eq!(preview.seed, expected_seed);

        let expected_spans = cseq_rhythm::resolve_generator_cycle(
            &generator,
            &cseq_rhythm::GeneratorCycleContext {
                track_id: Some("history-track"),
                cycle,
                cycle_beats: 4,
                spans: &spans,
                seed: expected_seed.seed,
                automation: &|_, _, _| None,
            },
        )
        .expect("expected generator realization");
        assert_eq!(preview.spans, expected_spans);
    }

    fn realized_beat_gatis(mut score: Score) -> Vec<usize> {
        let tree = cseq_transforms::apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect("subdivision switch realization");
        let root = tree.get(tree.root).expect("root");
        let beats = match &root.kind {
            DurationKind::Subdivided { children, .. } => children,
            _ => panic!("expected beat grid"),
        };
        beats
            .iter()
            .map(|beat_id| match &tree.get(*beat_id).expect("beat").kind {
                DurationKind::Subdivided { children, .. } => children.len(),
                _ => panic!("expected matra grid"),
            })
            .collect()
    }

    #[test]
    fn caesura_documents_fail_closed_at_the_invoke_boundary() {
        // Same skeleton as the accepted document, but carrying Caesura's
        // identity: the boundary must refuse it before any state loads.
        let foreign = json!({
            "app": "CarnaticSeq",
            "schemaVersion": PATCH_SCHEMA_VERSION,
            "transport": {},
            "sequencer": {},
            "project": {
                "activeTrackId": "track-1",
                "global": {},
                "tracks": []
            }
        });
        let error = validate_patch_document(&foreign).expect_err("foreign app fails closed");
        assert_eq!(error, "unsupported patch app: CarnaticSeq");

        let foreign_track = json!({
            "app": "CarnaticSeq",
            "kind": "track",
            "schemaVersion": PATCH_SCHEMA_VERSION,
            "track": {}
        });
        let error =
            validate_track_document(&foreign_track).expect_err("foreign track fails closed");
        assert_eq!(error, "unsupported track document app: CarnaticSeq");
    }

    #[test]
    fn patch_document_validation_accepts_current_schema() {
        let patch = json!({
            "app": PATCH_APP_ID,
            "schemaVersion": PATCH_SCHEMA_VERSION,
            "transport": {},
            "sequencer": {},
            "project": {
                "activeTrackId": "track-1",
                "global": {},
                "tracks": []
            }
        });

        validate_patch_document(&patch).expect("current patch schema should validate");
        validate_current_patch_document(&patch).expect("current patch schema should save");
    }

    #[test]
    fn patch_document_validation_rejects_missing_project_state() {
        let patch = json!({
            "app": PATCH_APP_ID,
            "schemaVersion": PATCH_SCHEMA_VERSION,
            "transport": {},
            "sequencer": {},
            "rhythm": {}
        });

        let err = validate_patch_document(&patch).expect_err("project state must be present");
        assert!(err.contains("patch is missing project state"));
    }

    #[test]
    fn patch_document_validation_rejects_wrong_schema() {
        let patch = json!({
            "app": PATCH_APP_ID,
            "schemaVersion": 999,
            "transport": {},
            "sequencer": {},
            "rhythm": {}
        });

        let err = validate_patch_document(&patch).expect_err("unknown schema must fail");
        assert!(err.contains("unsupported patch schema version"));
    }

    #[test]
    fn track_document_validation_accepts_current_schema() {
        let document = json!({
            "app": PATCH_APP_ID,
            "kind": "track",
            "schemaVersion": PATCH_SCHEMA_VERSION,
            "savedAt": "2026-05-30T19:00:00.000Z",
            "track": {
                "id": "track-1",
                "name": "Exported Track"
            },
            "globalContext": {
                "tempoBpm": 96,
                "cycleBeats": 8
            }
        });

        validate_track_document(&document).expect("current track envelope should validate");
    }

    #[test]
    fn track_document_validation_rejects_foreign_or_malformed_envelopes() {
        let document = json!({
            "app": PATCH_APP_ID,
            "kind": "track",
            "schemaVersion": PATCH_SCHEMA_VERSION,
            "track": {}
        });

        let err = validate_track_document(&json!({
            "app": "SomethingElse",
            "kind": "track",
            "schemaVersion": PATCH_SCHEMA_VERSION,
            "track": {}
        }))
        .expect_err("wrong app must fail");
        assert!(err.contains("unsupported track document app"));

        let err = validate_track_document(&json!({
            "app": PATCH_APP_ID,
            "kind": "patch",
            "schemaVersion": PATCH_SCHEMA_VERSION,
            "track": {}
        }))
        .expect_err("wrong kind must fail");
        assert!(err.contains("unsupported track document kind"));

        let err = validate_track_document(&json!({
            "app": PATCH_APP_ID,
            "kind": "track",
            "schemaVersion": 2,
            "track": {}
        }))
        .expect_err("wrong schema must fail");
        assert!(err.contains("unsupported track document schema version"));

        let mut missing_track = document.as_object().expect("object").clone();
        missing_track.remove("track");
        let err = validate_track_document(&serde_json::Value::Object(missing_track))
            .expect_err("missing track must fail");
        assert!(err.contains("track document is missing track state"));
    }

    #[test]
    fn subdivision_switch_bridge_preserves_third_cycle_boundary() {
        let score = build_subdivision_switch_score(switch_request(
            3,
            vec![inflection(2.0 / 3.0, 5)],
            vec![],
        ))
        .expect("bridge request should build");

        assert_eq!(realized_beat_gatis(score), vec![4, 4, 5]);
    }

    #[test]
    fn subdivision_switch_bridge_maps_initial_custom_subdivision() {
        let mut request = switch_request(4, vec![], vec![]);
        request.initial_weights = vec![];
        request.initial_custom_subdivision = Some(custom_subdivision(&[3, 5, 2]));

        let mut score = build_subdivision_switch_score(request).expect("bridge should build");
        let tree =
            cseq_transforms::apply_pipeline_for_cycle_mut(&mut score, 0).expect("realization");
        let custom_gatis = tree
            .pulse_spans
            .iter()
            .filter_map(|span| match span.kind {
                PulseSpanKind::GatiBeat { gati, .. }
                    if span.tags.iter().any(|tag| tag == "custom-division") =>
                {
                    Some((gati, span.duration))
                }
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(
            custom_gatis,
            vec![
                (3, Rational::new(4, 3)),
                (3, Rational::new(4, 3)),
                (3, Rational::new(4, 3))
            ]
        );
    }

    #[test]
    fn subdivision_switch_preview_reports_custom_division_frames() {
        let mut request = switch_request(4, vec![], vec![]);
        request.initial_weights = vec![];
        request.initial_custom_subdivision = Some(custom_subdivision(&[3, 5, 2]));

        let preview = score_preview_subdivision_switch(request, 0, Some(80.0)).expect("preview");

        assert_eq!(preview.beats.len(), 3);
        assert_eq!(
            preview
                .beats
                .iter()
                .map(|beat| (
                    beat.division_index,
                    beat.division_count,
                    beat.gati,
                    beat.start,
                    beat.end
                ))
                .collect::<Vec<_>>(),
            vec![
                (Some(1), Some(3), 3, 0.0, 1.0 / 3.0),
                (Some(2), Some(3), 3, 1.0 / 3.0, 2.0 / 3.0),
                (Some(3), Some(3), 3, 2.0 / 3.0, 1.0),
            ]
        );
        assert!(preview
            .pulse_spans
            .iter()
            .filter(|span| span.kind == "gatiBeat")
            .all(|span| span.tags.iter().any(|tag| tag == "custom-division")));
    }

    #[test]
    fn subdivision_switch_bridge_maps_boundary_custom_subdivision() {
        let mut boundary = inflection(0.5, 7);
        boundary.custom_subdivision = Some(custom_subdivision(&[3, 2]));
        boundary.subdivision_weights = vec![];
        let request = switch_request(4, vec![boundary], vec![]);

        let mut score = build_subdivision_switch_score(request).expect("bridge should build");
        let tree =
            cseq_transforms::apply_pipeline_for_cycle_mut(&mut score, 0).expect("realization");
        let custom_gatis = tree
            .pulse_spans
            .iter()
            .filter_map(|span| match span.kind {
                PulseSpanKind::GatiBeat { gati, .. }
                    if span.tags.iter().any(|tag| tag == "custom-division") =>
                {
                    Some((gati, span.start, span.duration))
                }
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(
            custom_gatis,
            vec![
                (3, Rational::new(2, 1), Rational::new(1, 1)),
                (3, Rational::new(3, 1), Rational::new(1, 1))
            ]
        );
    }

    #[test]
    fn subdivision_switch_bridge_rejects_invalid_custom_subdivision() {
        let mut request = switch_request(4, vec![], vec![]);
        request.initial_weights = vec![];
        request.initial_custom_subdivision = Some(CustomSubdivisionDto {
            per_beat_weight: 0.0,
            equal_parts_weight: 1.0,
            part_count_weights: vec![CustomPartCountDto {
                count: 4,
                weight: 1.0,
            }],
            part_gati_weights: vec![SubdivisionWeightDto {
                subdivision: 0,
                weight: 1.0,
            }],
            divisions: vec![],
            jathi_weights: vec![],
        });

        let err = build_subdivision_switch_score(request).expect_err("invalid custom must fail");
        assert!(err.contains("initial_custom_subdivision"));
        assert!(err.contains("gati choices must be 1-64"));
    }

    #[test]
    fn subdivision_switch_preview_reports_per_beat_automation_samples() {
        let mut request = switch_request(4, vec![], vec![]);
        request.automation = Some(pitch_automation(2));

        let preview = score_preview_subdivision_switch(request, 1, Some(80.0)).expect("preview");
        let first_beat = preview.beats.first().expect("first beat");
        let pitch_sample = first_beat
            .automation_values
            .iter()
            .find(|value| value.target == AUTOMATION_TARGET_PITCH)
            .expect("pitch automation sample");

        assert_eq!(
            first_beat.automation_phase,
            AutomationTime { numer: 1, denom: 2 }
        );
        assert_eq!(pitch_sample.value, 64.0);
        assert_eq!(first_beat.pitch, 64);
    }

    fn ramp_track(id: &str, target: &str, enabled: bool) -> cseq_model::AutomationTrack {
        cseq_model::AutomationTrack {
            id: id.to_string(),
            target: target.to_string(),
            enabled,
            combine: cseq_model::AutomationCombineMode::Replace,
            graph_range: None,
            curves: vec![cseq_model::AutomationCurve {
                id: format!("{id}-line"),
                enabled: true,
                interpolation: cseq_model::AutomationInterpolation::Linear,
                points: vec![
                    cseq_model::AutomationPoint {
                        id: None,
                        time: AutomationTime::zero(),
                        value: cseq_model::AutomationValue::Number { value: 0.0 },
                        anchor_id: None,
                        out_curve: None,
                    },
                    cseq_model::AutomationPoint {
                        id: None,
                        time: AutomationTime::one(),
                        value: cseq_model::AutomationValue::Number { value: 100.0 },
                        anchor_id: None,
                        out_curve: None,
                    },
                ],
            }],
        }
    }

    fn automation_with_post_score_track(enabled: bool) -> AutomationSet {
        // Pitch (score target) plus a retained post-score channel-hocket ramp.
        let mut set = pitch_automation(1);
        set.tracks.push(ramp_track(
            "channel-hocket-fallback",
            "channelHocket.fallback.channel.1.weight",
            enabled,
        ));
        set
    }

    #[test]
    fn preview_samples_post_score_targets_at_their_playback_beat() {
        // Retained channel-hocket targets appear in the stopped-timeline preview
        // at the same beat the engine reads them.
        let mut request = switch_request(4, vec![], vec![]);
        request.automation = Some(automation_with_post_score_track(true));

        let preview = score_preview_subdivision_switch(request, 0, Some(80.0)).expect("preview");
        assert_eq!(preview.beats.len(), 4);

        let values_for = |target: &str| {
            preview
                .beats
                .iter()
                .map(|beat| {
                    beat.automation_values
                        .iter()
                        .find(|value| value.target == target)
                        .map(|value| value.value)
                })
                .collect::<Vec<_>>()
        };

        // Per-beat target: ramp 0->100 over a 4-beat cycle samples each beat
        // phase (0/4,1/4,2/4,3/4) -> 0,25,50,75. This is exactly what playback
        // now hears after F3.
        assert_eq!(
            values_for("channelHocket.fallback.channel.1.weight"),
            vec![Some(0.0), Some(25.0), Some(50.0), Some(75.0)]
        );

        // A later cycle of a multi-cycle span steps the per-beat target by cycle
        // too (phase wraps by lengthCycles).
        let mut later_request = switch_request(4, vec![], vec![]);
        later_request.automation = Some({
            let mut set = automation_with_post_score_track(true);
            set.length_cycles = 2;
            set
        });
        let later =
            score_preview_subdivision_switch(later_request, 1, Some(80.0)).expect("preview");
        // Cycle 1 beat 0 of a 2-cycle span = phase 4/8 = 0.5 -> 50.0.
        let cycle1_beat0 = later.beats[0]
            .automation_values
            .iter()
            .find(|value| value.target == "channelHocket.fallback.channel.1.weight")
            .map(|value| value.value);
        assert_eq!(cycle1_beat0, Some(50.0));

        // Score targets are still present and unchanged.
        assert!(preview.beats[0]
            .automation_values
            .iter()
            .any(|value| value.target == AUTOMATION_TARGET_PITCH));
    }

    #[test]
    fn preview_omits_disabled_post_score_automation_track() {
        let mut request = switch_request(4, vec![], vec![]);
        request.automation = Some(automation_with_post_score_track(false));

        let preview = score_preview_subdivision_switch(request, 0, Some(80.0)).expect("preview");
        assert!(preview.beats.iter().all(|beat| beat
            .automation_values
            .iter()
            .all(|value| value.target != "channelHocket.fallback.channel.1.weight")));
    }

    #[test]
    fn subdivision_switch_bridge_rejects_off_beat_boundary() {
        let err =
            build_subdivision_switch_score(switch_request(4, vec![inflection(0.4, 5)], vec![]))
                .expect_err("off-beat boundary should fail");

        assert!(err.contains("position must align to a whole beat boundary"));
    }

    #[test]
    fn subdivision_switch_bridge_rejects_zero_weight_cap() {
        let err = build_subdivision_switch_score(switch_request(
            4,
            vec![inflection(0.5, 5)],
            vec![SwitchCountWeightDto {
                count: 1,
                weight: 0.0,
            }],
        ))
        .expect_err("cap weights need a positive option");

        assert!(err.contains("switch count weights must have at least one positive weight"));
    }

    #[test]
    fn subdivision_switch_bridge_rejects_non_finite_initial_weight() {
        let mut request = switch_request(4, vec![], vec![]);
        request.initial_weights[0].weight = f32::NAN;

        let err = build_subdivision_switch_score(request).expect_err("NaN weight must fail");

        assert!(err.contains("initial_weights: weights must be finite"));
    }

    #[test]
    fn subdivision_switch_bridge_rejects_non_finite_inflection_probability() {
        let mut request = switch_request(4, vec![inflection(0.5, 5)], vec![]);
        request.inflections[0].change_probability = f32::NAN;

        let err = build_subdivision_switch_score(request).expect_err("NaN probability must fail");

        assert!(err.contains("change probability must be 0.0-1.0"));
    }

    #[test]
    fn subdivision_switch_bridge_rejects_oversized_seed_history() {
        let mut request = switch_request(4, vec![], vec![]);
        request.max_history = 65;

        let err = build_subdivision_switch_score(request).expect_err("max history must fail");

        assert!(err.contains("max_history must be 0-64"));
    }

    #[test]
    fn subdivision_switch_bridge_rejects_inverted_accent_ranges() {
        let mut request = switch_request(4, vec![], vec![]);
        request.accent.beat_start = VelocityAccentRangeDto { min: 64, max: 12 };

        let err = build_subdivision_switch_score(request).expect_err("accent range must fail");

        assert!(err.contains("beat start accent min must be <= max"));
    }

    #[test]
    fn subdivision_switch_bridge_rejects_non_midi_accent_ranges() {
        let mut request = switch_request(4, vec![], vec![]);
        request.accent.beat_start = VelocityAccentRangeDto { min: 128, max: 128 };

        let err = build_subdivision_switch_score(request).expect_err("accent range must fail");

        assert!(err.contains("beat start accent values must be 0-127"));
    }

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 128,
            max_shrink_iters: 2048,
            ..ProptestConfig::default()
        })]

        #[test]
        fn accent_range_bridge_accepts_only_ordered_midi_values(min in any::<u8>(), max in any::<u8>()) {
            let result = validate_accent_range("prop accent", VelocityAccentRangeDto { min, max });

            if min <= max && max <= 127 {
                let range = result.expect("valid MIDI accent range");
                prop_assert_eq!(range.min, min);
                prop_assert_eq!(range.max, max);
            } else {
                prop_assert!(result.is_err());
            }
        }

        #[test]
        fn beat_boundary_bridge_snaps_exact_after_beat_positions(
            cycle_beats in 2_u32..=32,
            after_seed in any::<u32>(),
        ) {
            let after_beat = 1 + (after_seed % (cycle_beats - 1));
            let value = f64::from(after_beat) / f64::from(cycle_beats);

            let position = position_to_beat_rational(value, cycle_beats)
                .expect("exact after-beat boundary should be accepted");

            prop_assert_eq!(
                position,
                Rational::new(after_beat as i64, cycle_beats as i64)
            );
        }

        #[test]
        fn beat_boundary_bridge_rejects_unaligned_positions(
            cycle_beats in 2_u32..=32,
            after_seed in any::<u32>(),
            positive_offset in any::<bool>(),
        ) {
            let after_beat = 1 + (after_seed % (cycle_beats - 1));
            let offset = if positive_offset { 0.001 } else { -0.001 };
            let value = f64::from(after_beat) / f64::from(cycle_beats) + offset;
            prop_assume!(value > 0.0 && value < 1.0);

            prop_assert!(position_to_beat_rational(value, cycle_beats).is_err());
        }
    }

    // ---- Patch / track document validators -----------------------------

    fn minimal_patch_document() -> serde_json::Value {
        json!({
            "app": PATCH_APP_ID,
            "schemaVersion": PATCH_SCHEMA_VERSION,
            "transport": {},
            "sequencer": {},
            "project": {}
        })
    }

    fn minimal_track_document() -> serde_json::Value {
        json!({
            "app": PATCH_APP_ID,
            "kind": "track",
            "schemaVersion": PATCH_SCHEMA_VERSION,
            "savedAt": "2026-05-30T00:00:00.000Z",
            "track": { "id": "track-1", "name": "Track 1" },
            "globalContext": { "tempoBpm": 80, "cycleBeats": 8 }
        })
    }

    fn evolution_generator_document() -> serde_json::Value {
        json!({
            "kind": "dumka",
            "planLengthCycles": 20,
            "plan": [{
                "id": 41,
                "order": 0,
                "enabled": true,
                "fromCycle": 13,
                "toCycle": 13,
                "family": "barlowRemove",
                "intensity": 15,
                "scope": { "startBeat": 2, "lenBeats": 2 },
                "options": {
                    "barlowTemperature": 0,
                    "fillComplexity": null,
                    "densityFloor": 20,
                    "densityCeiling": 60,
                    "euclidMaxRun": null,
                    "euclidInvert": null,
                    "euclidRestPolicy": null,
                    "rotateDirection": "earlier"
                }
            }]
        })
    }

    #[test]
    fn validate_patch_document_accepts_minimal_current_schema() {
        assert!(validate_patch_document(&minimal_patch_document()).is_ok());
    }

    #[test]
    fn validate_patch_document_rejects_wrong_app_and_schema() {
        let mut wrong_app = minimal_patch_document();
        wrong_app["app"] = json!("SomethingElse");
        assert!(validate_patch_document(&wrong_app).is_err());

        let mut wrong_schema = minimal_patch_document();
        wrong_schema["schemaVersion"] = json!(999);
        assert!(validate_patch_document(&wrong_schema).is_err());
    }

    #[test]
    fn validate_patch_document_rejects_missing_sections_and_non_object() {
        let mut missing = minimal_patch_document();
        missing.as_object_mut().unwrap().remove("sequencer");
        assert!(validate_patch_document(&missing).is_err());

        assert!(validate_patch_document(&json!("not an object")).is_err());
    }

    #[test]
    fn validate_patch_document_rejects_every_stripped_v1_key_recursively() {
        for stripped_key in STRIPPED_PATCH_KEYS {
            let mut patch = minimal_patch_document();
            patch["project"] = json!({
                "tracks": [{
                    "sequencer": {}
                }]
            });
            patch["project"]["tracks"][0]["sequencer"]
                .as_object_mut()
                .expect("sequencer object")
                .insert((*stripped_key).to_string(), json!(true));

            let err =
                validate_patch_document(&patch).expect_err("stripped feature key must fail closed");
            assert!(
                err.contains(stripped_key),
                "error should identify {stripped_key}: {err}"
            );
        }
    }

    #[test]
    fn validate_patch_document_accepts_evolution_plan_v1_keys() {
        let plan_keys = [
            "plan",
            "planLengthCycles",
            "id",
            "order",
            "enabled",
            "fromCycle",
            "toCycle",
            "family",
            "pacing",
            "magnitude",
            "mode",
            "modelVersion",
            "targetMilli",
            "toleranceMilli",
            "maxOperations",
            "intensity",
            "scope",
            "startBeat",
            "lenBeats",
            "options",
            "barlowTemperature",
            "fillComplexity",
            "densityFloor",
            "densityCeiling",
            "euclidMaxRun",
            "euclidInvert",
            "euclidRestPolicy",
            "rotateDirection",
        ];
        for key in plan_keys {
            assert!(
                !STRIPPED_PATCH_KEYS.contains(&key),
                "current evolution key {key} must not be classified as stripped"
            );
        }

        let mut patch = minimal_patch_document();
        patch["generator"] = evolution_generator_document();
        validate_patch_document(&patch).expect("evolution plan is current v1 data");
    }

    #[test]
    fn v1_documents_reject_unknown_evolution_nested_keys_in_every_generator_slot() {
        for target in ["directive", "scope", "magnitude", "options"] {
            let with_unknown = || {
                let mut generator = evolution_generator_document();
                let directive = &mut generator["plan"][0];
                match target {
                    "directive" => directive["futureDirective"] = json!(true),
                    "scope" => directive["scope"]["futureScope"] = json!(true),
                    "magnitude" => {
                        directive["magnitude"] = json!({
                            "mode": "perceptual",
                            "modelVersion": "v1",
                            "targetMilli": 5_000,
                            "toleranceMilli": 500,
                            "maxOperations": 16,
                            "futureMagnitude": true,
                        });
                    }
                    "options" => directive["options"]["futureOption"] = json!(true),
                    _ => unreachable!(),
                }
                generator
            };

            let mut root_patch = minimal_patch_document();
            root_patch["generator"] = with_unknown();
            let root_error = validate_patch_document(&root_patch)
                .expect_err("root generator unknown evolution key must fail closed");
            assert!(
                root_error.contains("future"),
                "unexpected error: {root_error}"
            );

            let mut project_patch = minimal_patch_document();
            project_patch["project"] = json!({
                "tracks": [{ "generator": with_unknown() }]
            });
            let project_error = validate_patch_document(&project_patch)
                .expect_err("project track unknown evolution key must fail closed");
            assert!(
                project_error.contains("project.tracks[0].generator"),
                "unexpected error: {project_error}"
            );

            let mut track_document = minimal_track_document();
            track_document["track"]["generator"] = with_unknown();
            let track_error = validate_track_document(&track_document)
                .expect_err("track export unknown evolution key must fail closed");
            assert!(
                track_error.contains("track.generator"),
                "unexpected error: {track_error}"
            );
        }
    }

    #[test]
    fn v1_documents_reject_unsafe_evolution_ids_and_oversized_plans() {
        let mut unsafe_id = minimal_patch_document();
        let mut unsafe_generator = evolution_generator_document();
        unsafe_generator["plan"][0]["id"] = json!(JS_MAX_SAFE_INTEGER_U64 + 1);
        unsafe_id["generator"] = unsafe_generator;
        let id_error = validate_patch_document(&unsafe_id)
            .expect_err("unsafe numeric directive identity must fail closed");
        assert!(
            id_error.contains("MAX_SAFE_INTEGER") && id_error.contains("generator.plan[0].id"),
            "unexpected error: {id_error}"
        );

        let mut oversized = minimal_track_document();
        let mut generator = evolution_generator_document();
        generator["plan"] = serde_json::Value::Array(
            (0..=cseq_rhythm::MAX_EVOLUTION_DIRECTIVES)
                .map(|_| json!({}))
                .collect(),
        );
        oversized["track"]["generator"] = generator;
        let cap_error = validate_track_document(&oversized)
            .expect_err("257 persisted directives must fail closed");
        assert!(
            cap_error.contains("at most 256 directives, got 257"),
            "unexpected error: {cap_error}"
        );
    }

    #[test]
    fn validate_patch_document_rejects_removed_channel_seed_behaviors() {
        for removed in ["drift", "morph"] {
            let mut patch = minimal_patch_document();
            patch["project"] = json!({
                "tracks": [{
                    "channelHocket": { "seedBehavior": removed }
                }]
            });
            let err = validate_patch_document(&patch)
                .expect_err("removed channel seed behavior must fail closed");
            assert!(err.contains("seed behavior"));
        }

        for retained in ["followGlobal", "locked", "perCycle", "history"] {
            let mut patch = minimal_patch_document();
            patch["project"] = json!({
                "tracks": [{
                    "channelHocket": { "seedBehavior": retained }
                }]
            });
            validate_patch_document(&patch).expect("retained channel seed behavior");
        }
    }

    #[test]
    fn validate_patch_document_rejects_removed_sequencer_seed_modes() {
        for removed in ["drift", "morph"] {
            let mut patch = minimal_patch_document();
            patch["sequencer"]["seedMode"] = json!(removed);
            let err = validate_patch_document(&patch)
                .expect_err("removed sequencer seed mode must fail closed");
            assert!(err.contains("seed mode"));
        }

        for retained in ["locked", "perCycle", "history"] {
            let mut patch = minimal_patch_document();
            patch["sequencer"]["seedMode"] = json!(retained);
            validate_patch_document(&patch).expect("retained sequencer seed mode");
        }
    }

    #[test]
    fn validate_track_document_accepts_minimal_envelope() {
        assert!(validate_track_document(&minimal_track_document()).is_ok());
    }

    #[test]
    fn validate_track_document_requires_track_kind() {
        let mut wrong_kind = minimal_track_document();
        wrong_kind["kind"] = json!("patch");
        assert!(validate_track_document(&wrong_kind).is_err());

        let mut missing_kind = minimal_track_document();
        missing_kind.as_object_mut().unwrap().remove("kind");
        assert!(validate_track_document(&missing_kind).is_err());
    }

    #[test]
    fn validate_track_document_rejects_wrong_app_schema_and_missing_track() {
        let mut wrong_app = minimal_track_document();
        wrong_app["app"] = json!("Nope");
        assert!(validate_track_document(&wrong_app).is_err());

        let mut wrong_schema = minimal_track_document();
        wrong_schema["schemaVersion"] = json!(2);
        assert!(validate_track_document(&wrong_schema).is_err());

        let mut missing_track = minimal_track_document();
        missing_track.as_object_mut().unwrap().remove("track");
        assert!(validate_track_document(&missing_track).is_err());

        assert!(validate_track_document(&json!(42)).is_err());
    }

    #[test]
    fn validate_track_document_rejects_a_full_patch_document() {
        // A patch envelope must not validate as a track envelope (no `kind`).
        assert!(validate_track_document(&minimal_patch_document()).is_err());
    }

    #[test]
    fn validate_track_document_rejects_stripped_v1_track_state() {
        for stripped_key in STRIPPED_PATCH_KEYS {
            let mut document = minimal_track_document();
            document["track"]
                .as_object_mut()
                .expect("track object")
                .insert((*stripped_key).to_string(), json!({}));

            let err = validate_track_document(&document)
                .expect_err("stripped track feature key must fail closed");
            assert!(
                err.contains(stripped_key),
                "error should identify {stripped_key}: {err}"
            );
        }
    }

    #[test]
    fn track_save_load_round_trips_through_disk() {
        let dir = std::env::temp_dir();
        let path = dir
            .join(format!(
                "dumka-track-test-{}.dumka-track",
                std::process::id()
            ))
            .to_string_lossy()
            .into_owned();
        let document = minimal_track_document();

        track_save_to_path(path.clone(), document.clone()).expect("save");
        let loaded = track_load_from_path(path.clone()).expect("load");
        assert_eq!(loaded, document);

        let _ = std::fs::remove_file(&path);
    }
}

/// Golden DTO fixtures shared with the frontend.
///
/// These tests serialize fully-populated boundary DTOs into
/// `ui/src/__fixtures__/dto/` so the four hand-mirrored copies of the model
/// (Rust DTOs, `bridge.ts`, `patchIo.ts`, `mockTauri.ts`) *prove* agreement
/// instead of promising it:
///
/// - Rust → TS: `transportSnapshot.fixture.ts` and
///   `subdivisionSwitchPreview.fixture.ts` are
///   emitted as **typed TypeScript
///   literals** (`const x: TransportSnapshot = {...}`), so `pnpm typecheck`
///   fails on any missing, extra, or retyped field in `bridge.ts`.
/// - TS → Rust: `subdivision_switch_request.json` (written by
///   `ui/src/dtoContract.generate.test.ts` through the real `bridge.ts`
///   assembly) must deserialize into `SubdivisionSwitchRequestDto`, and
///   `patch_document.json` (written through the real `patchIo.ts` builders)
///   must pass `validate_patch_document`.
///
/// Default mode compares against the committed files and fails on drift.
/// To regenerate after an intentional DTO change:
/// `UPDATE_DTO_FIXTURES=1 cargo test -p cseq-app dto_fixture` (then run
/// `pnpm typecheck` + `pnpm test` in `ui/` and commit the updated fixtures).
#[cfg(test)]
mod dto_fixtures {
    use super::*;
    use std::path::PathBuf;

    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../ui/src/__fixtures__/dto")
    }

    fn check_or_update(name: &str, contents: &str) {
        let dir = fixture_dir();
        let path = dir.join(name);
        if std::env::var("UPDATE_DTO_FIXTURES").is_ok() {
            std::fs::create_dir_all(&dir).expect("create fixture dir");
            std::fs::write(&path, contents).expect("write fixture");
            return;
        }
        let existing = std::fs::read_to_string(&path).unwrap_or_else(|_| {
            panic!(
                "missing DTO fixture {name}; regenerate with \
                 UPDATE_DTO_FIXTURES=1 cargo test -p cseq-app dto_fixture"
            )
        });
        assert_eq!(
            existing, contents,
            "DTO fixture {name} drifted from the Rust DTOs. If the Rust \
             change is intentional, regenerate with UPDATE_DTO_FIXTURES=1 \
             cargo test -p cseq-app dto_fixture, then mirror the change in \
             ui/src/bridge.ts (pnpm typecheck will point at the fixture) and \
             update dependent fixtures/mocks."
        );
    }

    fn ts_fixture(type_name: &str, const_name: &str, json: &str) -> String {
        format!(
            "// GENERATED by `cargo test -p cseq-app dto_fixture` (UPDATE_DTO_FIXTURES=1).\n\
             // Do not edit by hand. This literal is the serialized Rust DTO; the type\n\
             // annotation makes `pnpm typecheck` the Rust↔TS drift gate.\n\
             import type {{ {type_name} }} from \"../../bridge\";\n\n\
             export const {const_name}: {type_name} = {json};\n"
        )
    }

    /// Every field populated (Options as `Some`) so the serialized shape shows
    /// the full contract, not the sparse default case.
    fn full_transport_snapshot() -> TransportSnapshot {
        TransportSnapshot {
            tempo_bpm: 92.5,
            is_playing: true,
            current_tick: 1234,
            current_cycle: 3,
            ticks_per_cycle: 3840,
            current_score_id: Some("fixture-score".to_string()),
            parallel_track_positions: vec![cseq_transport::ParallelTrackPosition {
                track_index: 0,
                track_id: "track-1".to_string(),
                track_name: "Lead".to_string(),
                cycle: 3,
                tick_in_cycle: 1234,
                ticks_per_cycle: 3840,
                reference_start_tick: 11520,
                reference_end_tick: 15360,
            }],
            midi_debug_events: vec![MidiDebugEvent {
                sequence: 7,
                absolute_tick: 12754,
                cycle: 3,
                tick_in_cycle: 1234,
                channel: Some(1),
                message_type: "noteOn".to_string(),
                data1: Some(60),
                data2: Some(96),
                bytes: vec![144, 60, 96],
                debug_source: Some("queued dispatch".to_string()),
                monitor_bus: Some("bus 1".to_string()),
                monitor_user_channel: Some(1),
                monitor_mode: Some("melodic".to_string()),
                monitor_program: Some(0),
                monitor_drum_note: Some(38),
                monitor_bytes: Some(vec![144, 60, 96]),
                parallel_track_id: Some("track-1".to_string()),
                parallel_track_name: Some("Lead".to_string()),
                parallel_conflict_policy: Some("allowAll".to_string()),
                parallel_conflict_action: Some("priority-winner".to_string()),
                parallel_conflict_group_id: Some("12754:1".to_string()),
            }],
            automation_events: vec![AutomationPlaybackEvent {
                sequence: 5,
                cycle: 3,
                beat_index: 1,
                tick_in_cycle: 960,
                automation_phase: AutomationTime {
                    numer: 13,
                    denom: 4,
                },
                values: vec![AutomationPlaybackValue {
                    target: "transport.tempoBpm".to_string(),
                    value: 92.5,
                }],
            }],
            channel_hocket_events: vec![ChannelHocketPlaybackEvent {
                cycle: 3,
                start_tick: 960,
                end_tick: 1920,
                channel: 2,
                source: RhythmChoiceSource::Transition,
                fallback: false,
                position_rule_id: None,
                position_rule_label: None,
                position_scope: None,
                position_nth: None,
                position_action: None,
                parallel_track_index: Some(0),
                parallel_track_id: Some("track-1".to_string()),
                parallel_track_name: Some("Lead".to_string()),
                suppressed: false,
            }],
            seed_trace_events: vec![cseq_transport::PlaybackSeedTraceEvent {
                cycle: 3,
                domain: "subdivision".to_string(),
                label: "Subdivision switch".to_string(),
                seed: 9_007_199_254_740_993,
                base_seed: Some(u64::MAX),
                source: "perCycle".to_string(),
                history_before: vec![9_007_199_254_740_992, 9_007_199_254_740_993],
                history_after: vec![9_007_199_254_740_992, 9_007_199_254_740_993, u64::MAX],
                parallel_track_index: Some(0),
                track_id: Some("track-1".to_string()),
            }],
            parallel_conflict_events: vec![ParallelConflictDebugEvent {
                sequence: 2,
                absolute_tick: 12480,
                cycle: 3,
                tick_in_cycle: 960,
                output_channel: 1,
                pitch: 60,
                start_tick: 12480,
                end_tick: 12600,
                track_id: "track-2".to_string(),
                track_name: "Follower".to_string(),
                track_index: 1,
                conflict_policy: "allowAll".to_string(),
                conflict_action: "priority-suppress".to_string(),
                conflict_group_id: "12480:1".to_string(),
                colliding_track_ids: vec!["track-1".to_string(), "track-2".to_string()],
                active_track_count: 2,
                passed: false,
            }],
            trigger_decision_events: vec![cseq_transport::TriggerDecisionEvent {
                track_index: 1,
                track_id: "track-2".to_string(),
                track_name: "Follower".to_string(),
                source_cycle_index: 3,
                matched_beat: 2,
                event_tick: 12480,
                candidate_tick: 12480,
                start_kind: "atEvent".to_string(),
                outcome: "launched".to_string(),
                suppress_reason: Some("gateProbability".to_string()),
                launch_tick: Some(12480),
                run_index: Some(3),
                roll_value: Some(412),
                roll_threshold: Some(500),
                roll_passed: Some(true),
                consecutive_misses: 0,
                last_accept_source_cycle: Some(2),
            }],
            realized_rhythm_events: vec![cseq_transport::RealizedRhythmSpanEvent {
                cycle: 3,
                parallel_track_index: Some(0),
                parallel_track_id: Some("track-1".to_string()),
                span: cseq_rhythm::ResolvedRhythmSpan {
                    span_id: 5,
                    span_len: 4,
                    cells: vec![
                        cseq_rhythm::ResolvedRhythmCell {
                            index: 0,
                            start: 0,
                            len: 2,
                            rest: false,
                            tied_from_previous: false,
                            tied_to_next: false,
                            velocity: Some(125),
                        },
                        cseq_rhythm::ResolvedRhythmCell {
                            index: 1,
                            start: 2,
                            len: 2,
                            rest: true,
                            tied_from_previous: false,
                            tied_to_next: false,
                            velocity: Some(96),
                        },
                    ],
                },
            }],
            track_flow_events: vec![cseq_transport::TrackFlowPlaybackEvent {
                cycle: 3,
                reference_start_tick: 11520,
                lane_id: "track-flow-main".to_string(),
                source_track_id: "track-2".to_string(),
                source_track_name: "Track 2".to_string(),
            }],
        }
    }

    #[test]
    fn dto_fixture_transport_snapshot() {
        let dto = SnapshotDto::from(full_transport_snapshot());
        let json = serde_json::to_string_pretty(&dto).expect("serialize snapshot DTO");
        check_or_update(
            "transportSnapshot.fixture.ts",
            &ts_fixture("TransportSnapshot", "transportSnapshotFixture", &json),
        );
    }

    #[test]
    fn dto_fixture_midi_route_status() {
        let dto = MidiRouteState {
            desired: Some(cseq_transport::MidiDestination {
                id: "-673416519".to_string(),
                name: "IAC Driver Bus 1".to_string(),
            }),
            connected: false,
            last_error: Some("destination not present".to_string()),
        };
        let json = serde_json::to_string_pretty(&dto).expect("serialize route status DTO");
        check_or_update(
            "midiRouteStatus.fixture.ts",
            &ts_fixture("MidiRouteStatus", "midiRouteStatusFixture", &json),
        );
    }

    #[test]
    fn dto_fixture_machine_prefs() {
        let dto = MachinePrefsSnapshotDto {
            prefs: MachinePrefs {
                prefs_version: machine::MACHINE_PREFS_VERSION,
                midi_destination: Some(cseq_transport::MidiDestination {
                    id: "-673416519".to_string(),
                    name: "IAC Driver Bus 1".to_string(),
                }),
                autosave_enabled: true,
                autosave_interval_ms: 3_000,
                autoload_recent_session: true,
            },
            source: MachinePrefsSource::File,
        };
        let json = serde_json::to_string_pretty(&dto).expect("serialize machine prefs DTO");
        check_or_update(
            "machinePrefs.fixture.ts",
            &ts_fixture("MachinePrefsSnapshot", "machinePrefsSnapshotFixture", &json),
        );
    }

    #[test]
    fn dto_fixture_subdivision_switch_preview() {
        let request_path = fixture_dir().join("subdivision_switch_request.json");
        let request_text = std::fs::read_to_string(&request_path).expect(
            "missing subdivision_switch_request.json — run `pnpm vitest run \
             src/dtoContract.generate.test.ts` in ui/ first (it writes the \
             request through the real bridge.ts assembly)",
        );
        // The TS→Rust half of the contract: the request the real bridge
        // assembles must deserialize into the command's request DTO.
        let request: SubdivisionSwitchRequestDto = serde_json::from_str(&request_text).expect(
            "bridge.ts request JSON no longer deserializes into SubdivisionSwitchRequestDto",
        );
        let mut preview = score_preview_subdivision_switch(request, 0, Some(80.0))
            .expect("fixture request must produce a preview");
        // Full-width sentinels make the generated TS fixture reject any future
        // regression from decimal strings back to lossy JSON numbers.
        preview.history_seeds = vec![9_007_199_254_740_993, u64::MAX];
        let json = serde_json::to_string_pretty(&preview).expect("serialize preview DTO");
        check_or_update(
            "subdivisionSwitchPreview.fixture.ts",
            &ts_fixture(
                "SubdivisionSwitchPreview",
                "subdivisionSwitchPreviewFixture",
                &json,
            ),
        );
    }

    /// Rhythm-preview request with POPULATED beat-lock and shape-group
    /// overlays, shared by the fixture generator and the TS-request
    /// round-trip test (which deserializes the bridge-assembled JSON copy of
    /// this exact request and must realize the same preview).
    ///
    /// Geometry: one section, three gati-4 beats, one 4-matra span per beat.
    /// The lock claims beats 0-1 (8 matras); both patterns cross the span
    /// boundary at matra 4 with an articulation-free straddling onset, so
    /// whichever the per-cycle draw picks, spans 1-2 resolve with
    /// `locked: true` cells and span 2 starts with a `lockPinnedTie: true`
    /// continuation. The articulation-stage shape group rests beat 2's play
    /// cells with certainty, so span 3 resolves with `shaped: true` cells
    /// (locked cells are never shape-selected, hence the free third beat).
    /// The playbackFinalize group cannot affect an articulation preview; it
    /// rides the request so the round-trip pins `chancePercent` /
    /// `respectCooldown` through serde.

    #[test]
    fn dto_fixture_patch_document_validates() {
        let path = fixture_dir().join("patch_document.json");
        let text = std::fs::read_to_string(&path).expect(
            "missing patch_document.json — run `pnpm vitest run \
             src/dtoContract.generate.test.ts` in ui/ first (it writes the \
             document through the real patchIo.ts builders)",
        );
        let value: serde_json::Value =
            serde_json::from_str(&text).expect("patch fixture must be valid JSON");
        validate_patch_document(&value)
            .expect("patchIo-serialized patch document must pass backend validation");
        validate_current_patch_document(&value)
            .expect("patchIo-serialized patch document must be saveable at the current schema");
    }

    #[test]
    fn dto_fixture_dumka_generator_preview_request_resolves() {
        let path = fixture_dir().join("dumka_generator_preview_request.json");
        let text = std::fs::read_to_string(&path).expect(
            "missing dumka_generator_preview_request.json — run `pnpm vitest run \
             src/dtoContract.generate.test.ts` in ui/ first (it writes the request \
             through the real bridge assembly)",
        );
        let request: GeneratorPreviewRequestDto = serde_json::from_str(&text)
            .expect("bridge-assembled dumka preview request must deserialize");
        let cseq_rhythm::GeneratorConfig::Dumka(params) = &request.generator else {
            panic!("fixture must carry the dumka variant");
        };
        assert_eq!(
            params.pattern,
            "[dum@3 ka] [. ka] [[dum .] [ka .] [dum .] [ka .] [dum .]]@2"
        );
        assert_eq!(
            params.seed_mode,
            cseq_rhythm::GeneratorSeedMode::Locked { seed: 20260611 }
        );
        assert_eq!(params.plan.len(), 4);
        assert_eq!(params.plan[0].id, 101);
        assert_eq!(
            params.plan[0].pacing,
            cseq_rhythm::DirectivePacing::PerCycle
        );
        assert_eq!(params.plan[1].scope.expect("scoped range").start_beat, 2);
        assert_eq!(params.plan[1].pacing, cseq_rhythm::DirectivePacing::Linear);
        assert_eq!(
            params.plan[2].pacing,
            cseq_rhythm::DirectivePacing::EaseInOut
        );
        assert!(!params.plan[2].enabled);
        assert_eq!(params.plan[3].id, 104);
        assert!(!params.plan[3].enabled);
        assert_eq!(params.plan[3].from_cycle, 17);
        assert_eq!(params.plan[3].to_cycle, 19);
        assert_eq!(
            params.plan[3].pacing,
            cseq_rhythm::DirectivePacing::PerCycle
        );
        assert_eq!(
            params.plan[3].magnitude,
            cseq_rhythm::DirectiveMagnitude::Perceptual {
                model_version: cseq_rhythm::PerceptualModelVersion::V1,
                target_milli: 5_000,
                tolerance_milli: 500,
                max_operations: 16,
            }
        );
        assert_eq!(params.plan[3].intensity, 99);
        assert_eq!(params.plan_length_cycles, 20);

        // The wire config must resolve through the one shared dispatch on the
        // fixture's own spans — preview and playback both run this exact path.
        let context = cseq_rhythm::GeneratorCycleContext {
            track_id: None,
            cycle: request.cycle,
            cycle_beats: request.cycle_beats,
            spans: &request.spans,
            seed: 20260611,
            automation: &|_, _, _| None,
        };
        let resolved = cseq_rhythm::resolve_generator_cycle(&request.generator, &context)
            .expect("fixture pattern must resolve on its fixture spans");
        assert_eq!(resolved.len(), request.spans.len());
        let sounding: usize = resolved
            .iter()
            .flat_map(|span| span.cells.iter())
            .filter(|cell| !cell.rest)
            .count();
        assert_eq!(sounding, 8, "the reference pattern carries eight onsets");

        // The bridge also rides authored accent velocities beside the spans;
        // the full preview command must stamp them onto its cells.
        assert_eq!(request.span_velocities.len(), request.spans.len());
        for (index, entry) in request.span_velocities.iter().enumerate() {
            assert_eq!(entry.span_id, index as u64 + 1);
            assert_eq!(entry.velocities.len(), 20);
            assert_eq!(entry.velocities[0], 113 + index as u8);
            assert!(entry.velocities[1..].iter().all(|velocity| *velocity == 96));
        }
        let preview = resolve_generator_preview(request, &[])
            .expect("fixture request must resolve through the preview command");
        for span in &preview.spans {
            let accent = 112 + span.span_id as u8;
            for cell in &span.cells {
                let expected = if cell.start == 0 { accent } else { 96 };
                assert_eq!(
                    cell.velocity,
                    Some(expected),
                    "span {} cell {} carries the authored velocity at its start",
                    span.span_id,
                    cell.index
                );
            }
        }
        assert!(preview.trace.is_empty(), "cycle zero is always the seed");
        assert_eq!(
            preview.density_corridor,
            Some(cseq_rhythm::DensityCorridorRange {
                floor: 20,
                ceiling: 60,
            })
        );

        // The Rust-owned response fixture pins the trace side of the DTO. Use
        // the same rich bridge request at its Barlow pin while disabling the
        // unrelated legacy stochastic layer, then serialize the command DTO.
        let mut traced_request: GeneratorPreviewRequestDto =
            serde_json::from_str(&text).expect("bridge-assembled traced request must deserialize");
        traced_request.cycle = 13;
        let cseq_rhythm::GeneratorConfig::Dumka(params) = &mut traced_request.generator else {
            unreachable!("fixture is pinned to Dum-Ka")
        };
        params.evolution_rate = 0;
        // Behavior-off compatibility pin: resolving the same authored pin at
        // the new 0–100 defaults must preserve the exact pre-M3.9 trajectory
        // and requested/applied trace, not merely its cycle-zero seed.
        let mut legacy_request = traced_request.clone();
        let cseq_rhythm::GeneratorConfig::Dumka(legacy_params) = &mut legacy_request.generator
        else {
            unreachable!("fixture is pinned to Dum-Ka")
        };
        legacy_params.density_floor = 0;
        legacy_params.density_ceiling = 100;
        for directive in &mut legacy_params.plan {
            directive.options.density_floor = None;
            directive.options.density_ceiling = None;
        }
        let legacy_preview = resolve_generator_preview(legacy_request, &[])
            .expect("behavior-off corridor request must resolve");
        assert_eq!(legacy_preview.trace.len(), 1);
        assert_eq!(legacy_preview.trace[0].directive_id, 101);
        assert_eq!(legacy_preview.trace[0].requested, 2);
        assert_eq!(legacy_preview.trace[0].applied, 2);
        assert!(legacy_preview.trace[0].corridor_clamp.is_none());
        assert_eq!(
            legacy_preview.density_corridor,
            Some(cseq_rhythm::DensityCorridorRange {
                floor: 0,
                ceiling: 100,
            })
        );
        let legacy_json = serde_json::to_string_pretty(&legacy_preview)
            .expect("serialize behavior-off Dum-Ka preview DTO");
        check_or_update(
            "dumkaGeneratorLegacyPreview.fixture.ts",
            &ts_fixture(
                "GeneratorPreview",
                "dumkaGeneratorLegacyPreviewFixture",
                &legacy_json,
            ),
        );

        let traced_preview = resolve_generator_preview(traced_request, &[])
            .expect("fixture pin must resolve through the trace-capable preview command");
        assert!(traced_preview
            .trace
            .iter()
            .any(|entry| entry.cycle == 13 && entry.directive_id == 101));
        let json = serde_json::to_string_pretty(&traced_preview)
            .expect("serialize Dum-Ka generator preview DTO");
        check_or_update(
            "dumkaGeneratorPreview.fixture.ts",
            &ts_fixture("GeneratorPreview", "dumkaGeneratorPreviewFixture", &json),
        );

        // Activate only the request's future perceptual row in a derived
        // preview so Rust serialization pins the additive trace object without
        // rewriting either M3.9 corridor fixture.
        let mut perceptual_request: GeneratorPreviewRequestDto =
            serde_json::from_str(&text).expect("perceptual traced request must deserialize");
        perceptual_request.cycle = 17;
        let cseq_rhythm::GeneratorConfig::Dumka(perceptual_params) =
            &mut perceptual_request.generator
        else {
            unreachable!("fixture is pinned to Dum-Ka")
        };
        perceptual_params.evolution_rate = 0;
        perceptual_params.density_floor = 0;
        perceptual_params.density_ceiling = 100;
        for directive in &mut perceptual_params.plan {
            directive.enabled = false;
            directive.options.density_floor = None;
            directive.options.density_ceiling = None;
        }
        perceptual_params.plan[3].enabled = true;
        let perceptual_preview = resolve_generator_preview(perceptual_request, &[])
            .expect("perceptual fixture row must resolve through preview");
        let perceptual_trace = perceptual_preview
            .trace
            .iter()
            .find(|entry| entry.directive_id == 104)
            .expect("perceptual fixture must attribute directive 104");
        let perceptual = perceptual_trace
            .perceptual
            .expect("perceptual fixture trace must carry calibration detail");
        assert_eq!(perceptual_trace.requested, 16);
        assert_eq!(perceptual_trace.applied, 0);
        assert_eq!(
            perceptual_trace.skipped,
            cseq_rhythm::DirectiveSkip::Exhausted
        );
        assert_eq!(
            perceptual.model_version,
            cseq_rhythm::PerceptualModelVersion::V1
        );
        assert_eq!(perceptual.actual_milli, 0);
        assert_eq!(perceptual.target_milli, 5_000);
        assert_eq!(perceptual.tolerance_milli, 500);
        assert!(!perceptual.reached);
        assert!(perceptual.exhausted);
        let perceptual_json = serde_json::to_string_pretty(&perceptual_preview)
            .expect("serialize perceptual Dum-Ka preview DTO");
        check_or_update(
            "dumkaGeneratorPerceptualPreview.fixture.ts",
            &ts_fixture(
                "GeneratorPreview",
                "dumkaGeneratorPerceptualPreviewFixture",
                &perceptual_json,
            ),
        );
    }

    #[test]
    fn dto_fixture_dumka_patch_document_validates() {
        let path = fixture_dir().join("dumka_patch_document.json");
        let text = std::fs::read_to_string(&path).expect(
            "missing dumka_patch_document.json — run `pnpm vitest run \
             src/dtoContract.generate.test.ts` in ui/ first (it writes the \
             document through the real patchIo.ts normalizer)",
        );
        let value: serde_json::Value =
            serde_json::from_str(&text).expect("dumka patch fixture must be valid JSON");
        validate_patch_document(&value).expect("dumka patch document must pass backend validation");
        validate_current_patch_document(&value)
            .expect("dumka patch document must be saveable at the current schema");
        let mut generators = vec![value
            .get("generator")
            .expect("dumka patch document carries a root generator")];
        generators.extend(
            value["project"]["tracks"]
                .as_array()
                .expect("dumka patch carries project tracks")
                .iter()
                .map(|track| {
                    track
                        .get("generator")
                        .expect("each persisted track carries its generator")
                }),
        );
        for generator in generators {
            let config: cseq_rhythm::GeneratorConfig = serde_json::from_value(generator.clone())
                .expect("persisted dumka generator must deserialize as the engine union");
            let cseq_rhythm::GeneratorConfig::Dumka(params) = &config else {
                panic!("persisted generator must be Dum-Ka")
            };
            assert_eq!(
                params.plan[0].pacing,
                cseq_rhythm::DirectivePacing::PerCycle
            );
            assert_eq!(params.plan[1].pacing, cseq_rhythm::DirectivePacing::Linear);
            assert_eq!(
                params.plan[2].pacing,
                cseq_rhythm::DirectivePacing::EaseInOut
            );
            assert_eq!(params.plan.len(), 4);
            assert_eq!(
                params.plan[3].pacing,
                cseq_rhythm::DirectivePacing::PerCycle
            );
            assert!(!params.plan[3].enabled);
            assert_eq!(
                params.plan[3].magnitude,
                cseq_rhythm::DirectiveMagnitude::Perceptual {
                    model_version: cseq_rhythm::PerceptualModelVersion::V1,
                    target_milli: 5_000,
                    tolerance_milli: 500,
                    max_operations: 16,
                }
            );
            config
                .validate()
                .expect("persisted Dum-Ka plan must satisfy engine validation");
        }
    }

    /// The stopped-preview cycle limit exists in three runtimes: these Rust
    /// constants, the TS `timelineModel` clamp, and the mock driver's page
    /// literal. This fixture is the single wire of truth: the TS tests and
    /// the parity spec read it back, so a one-sided change fails a gate
    /// instead of letting the UI offer cycles the backend rejects.
    #[test]
    fn dto_fixture_preview_limits_match() {
        let rendered = format!(
            "{}\n",
            serde_json::to_string_pretty(&serde_json::json!({
                "liveGeneratorPreviewCycleRadius": LIVE_PREVIEW_CYCLE_RADIUS,
                "maxStoppedGeneratorPreviewCycle": MAX_STOPPED_PREVIEW_CYCLE,
            }))
            .expect("serialize preview limits")
        );
        let path = fixture_dir().join("preview_limits.json");
        if std::env::var("UPDATE_DTO_FIXTURES").is_ok() {
            std::fs::write(&path, &rendered).expect("update preview limits fixture");
        } else {
            let checked_in = std::fs::read_to_string(&path).unwrap_or_else(|_| {
                panic!(
                    "missing {}; regenerate with UPDATE_DTO_FIXTURES=1 cargo test -p cseq-app dto_fixture",
                    path.display()
                )
            });
            assert_eq!(
                checked_in, rendered,
                "preview limits changed; regenerate intentionally with UPDATE_DTO_FIXTURES=1"
            );
        }
    }

    #[test]
    fn failed_machine_prefs_write_does_not_publish_candidate_state() {
        let blocker =
            std::env::temp_dir().join(format!("caesura-main-prefs-blocker-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&blocker);
        let _ = std::fs::remove_file(&blocker);
        std::fs::write(&blocker, b"not a directory").unwrap();

        let state = AppState::new();
        state.machine_dir.set(blocker.clone()).unwrap();
        let original = state.machine_prefs.lock().clone();

        let result = persist_machine_prefs_update(&state, |prefs| {
            prefs.autosave_enabled = false;
            prefs.autosave_interval_ms = 10_000;
        });
        assert!(result.is_err());
        assert_eq!(*state.machine_prefs.lock(), original);
        assert_eq!(
            *state.machine_prefs_source.lock(),
            MachinePrefsSource::Defaults
        );

        // Once persistence succeeds, the same candidate is published and its
        // source changes to File.
        std::fs::remove_file(&blocker).unwrap();
        let committed = persist_machine_prefs_update(&state, |prefs| {
            prefs.autosave_enabled = false;
            prefs.autosave_interval_ms = 10_000;
        })
        .unwrap();
        assert_eq!(*state.machine_prefs.lock(), committed);
        assert_eq!(*state.machine_prefs_source.lock(), MachinePrefsSource::File);
        let _ = std::fs::remove_dir_all(&blocker);
    }
}
