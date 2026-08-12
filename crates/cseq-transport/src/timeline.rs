#[allow(unused_imports)]
use crate::*;

#[derive(Debug, Clone)]
pub struct MidiDebugEvent {
    pub sequence: u64,
    pub absolute_tick: u64,
    pub cycle: u64,
    pub tick_in_cycle: u64,
    /// User-facing MIDI channel number, 1-16. System messages have no channel.
    pub channel: Option<u8>,
    pub message_type: String,
    pub data1: Option<u8>,
    pub data2: Option<u8>,
    pub bytes: Vec<u8>,
    pub debug_source: Option<String>,
    pub monitor_bus: Option<String>,
    pub monitor_user_channel: Option<u8>,
    pub monitor_mode: Option<String>,
    pub monitor_program: Option<u8>,
    pub monitor_drum_note: Option<u8>,
    pub monitor_bytes: Option<Vec<u8>>,
    pub parallel_track_id: Option<String>,
    pub parallel_track_name: Option<String>,
    pub parallel_conflict_policy: Option<String>,
    pub parallel_conflict_action: Option<String>,
    pub parallel_conflict_group_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParallelConflictDebugEvent {
    pub sequence: u64,
    pub absolute_tick: u64,
    pub cycle: u64,
    pub tick_in_cycle: u64,
    /// User-facing MIDI channel number, 1-16.
    pub output_channel: u8,
    pub pitch: u8,
    pub start_tick: u64,
    pub end_tick: u64,
    pub track_id: String,
    pub track_name: String,
    pub track_index: usize,
    pub conflict_policy: String,
    pub conflict_action: String,
    pub conflict_group_id: String,
    pub colliding_track_ids: Vec<String>,
    pub active_track_count: usize,
    pub passed: bool,
}

#[derive(Debug, Clone)]
pub struct AutomationPlaybackValue {
    pub target: String,
    pub value: f64,
}

#[derive(Debug, Clone)]
pub struct AutomationPlaybackEvent {
    pub sequence: u64,
    pub cycle: u64,
    pub beat_index: u32,
    pub tick_in_cycle: u64,
    pub automation_phase: AutomationTime,
    pub values: Vec<AutomationPlaybackValue>,
}

/// One realized rhythm span for a cycle: the exact `ResolvedRhythmSpan` the
/// scheduler used to produce audio, surfaced so the live timeline rhythm row can
/// render realized truth (not a separate preview resolution). Window-bounded via
/// `PlaybackLayers` like the other realized overlays; tagged per track.
#[derive(Debug, Clone)]
pub struct RealizedRhythmSpanEvent {
    pub cycle: u64,
    pub parallel_track_index: Option<usize>,
    pub parallel_track_id: Option<String>,
    pub span: cseq_rhythm::ResolvedRhythmSpan,
}

/// One Track Flow box selection: which authored source track a box's synthetic
/// `track-flow-<boxId>` lane sounded for a given lane cycle. The display identity
/// (`source_track_id`/`source_track_name`) is the authored track — distinct from
/// the box's conflict identity (`lane_id`, `track-flow-<boxId>`) and its composite
/// seed-path identity (`track-flow-<boxId>:<source_track_id>`). `lane_id` lets the
/// UI group selections per box (added ahead of the display indicator so surfacing
/// it later is not a breaking event-shape change).
#[derive(Debug, Clone)]
pub struct TrackFlowPlaybackEvent {
    pub cycle: u64,
    pub reference_start_tick: u64,
    pub lane_id: String,
    pub source_track_id: String,
    pub source_track_name: String,
}

#[derive(Debug, Clone)]
pub struct ChannelHocketPlaybackEvent {
    pub cycle: u64,
    pub start_tick: u64,
    pub end_tick: u64,
    /// User-facing MIDI channel number, 1-16.
    pub channel: u8,
    pub source: RhythmChoiceSource,
    pub fallback: bool,
    pub position_rule_id: Option<String>,
    pub position_rule_label: Option<String>,
    pub position_scope: Option<cseq_rhythm::ChannelPositionScope>,
    pub position_nth: Option<u32>,
    pub position_action: Option<cseq_rhythm::ChannelPositionAction>,
    pub parallel_track_index: Option<usize>,
    pub parallel_track_id: Option<String>,
    pub parallel_track_name: Option<String>,
    /// True when parallel conflict resolution removed the corresponding note.
    pub suppressed: bool,
}

/// One GATE acceptance decision, surfaced to the trust surface (state strip +
/// event log). A flattened, UI-facing render of `cseq_trigger::TriggerDecision`
/// — a by-product of the same pure compile that produced the launches, so the
/// log can never disagree with the audio (Plan §3).
#[derive(Debug, Clone)]
pub struct TriggerDecisionEvent {
    pub track_index: usize,
    pub track_id: String,
    pub track_name: String,
    pub source_cycle_index: u64,
    pub matched_beat: u32,
    /// The raw matched-event reference tick (the WHEN onset, pre-placement).
    /// Pairs with `candidate_tick` for the timeline's event → placement connector.
    pub event_tick: u64,
    /// The launch tick the candidate would use (post alignment + quantize).
    pub candidate_tick: u64,
    /// The START alignment resolved for this candidate (Phase D): `"atEvent"`,
    /// `"atSourceCycleStart"`, `"atNextReferenceBeat"`, `"afterEventTicks"`,
    /// `"centerInRest"`, or `"atSourceReturn"`.
    pub start_kind: String,
    /// `"launched"`, `"queued"`, or `"suppressed"`.
    pub outcome: String,
    /// For `suppressed`: `"gateProbability"` | `"gateCooldown"` |
    /// `"reTriggerIgnore"` | `"reTriggerQueueFull"`. `None` otherwise.
    pub suppress_reason: Option<String>,
    /// For `launched`: the realized launch tick + stable run index.
    pub launch_tick: Option<u64>,
    pub run_index: Option<u32>,
    /// The probability roll (per-mille, `0..=999`) + threshold, when a roll was
    /// taken (absent for a cooldown rejection or an un-gated follower).
    pub roll_value: Option<u16>,
    pub roll_threshold: Option<u16>,
    pub roll_passed: Option<bool>,
    /// Gate counters *after* this decision (the live state strip reads these).
    pub consecutive_misses: u32,
    pub last_accept_source_cycle: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct PlaybackSeedTraceEvent {
    pub cycle: u64,
    pub domain: String,
    pub label: String,
    pub seed: u64,
    pub base_seed: Option<u64>,
    pub source: String,
    pub history_before: Vec<u64>,
    pub history_after: Vec<u64>,
    /// Source parallel track for this decision. `None` for single-track
    /// playback (and legacy data); set per track during parallel realization so
    /// seed-path replay can be filtered to the track that recorded it.
    pub parallel_track_index: Option<usize>,
    pub track_id: Option<String>,
}
