#[allow(unused_imports)]
use crate::*;

// ---------------------------------------------------------------------------
// Transport snapshot
// ---------------------------------------------------------------------------

pub struct TransportSnapshot {
    pub tempo_bpm: f32,
    pub is_playing: bool,
    pub current_tick: u64,
    pub current_cycle: u64,
    pub ticks_per_cycle: u64,
    pub current_score_id: Option<String>,
    pub parallel_track_positions: Vec<ParallelTrackPosition>,
    pub midi_debug_events: Vec<MidiDebugEvent>,
    pub automation_events: Vec<AutomationPlaybackEvent>,
    pub channel_hocket_events: Vec<ChannelHocketPlaybackEvent>,
    pub seed_trace_events: Vec<PlaybackSeedTraceEvent>,
    pub parallel_conflict_events: Vec<ParallelConflictDebugEvent>,
    /// GATE acceptance decisions (Plan Phase C). The truthful event log.
    pub trigger_decision_events: Vec<TriggerDecisionEvent>,
    /// Realized rhythm spans per cycle/track — the live timeline generator-row source,
    /// from the same realization that drives audio.
    pub realized_rhythm_events: Vec<RealizedRhythmSpanEvent>,
    /// Per-box Track Flow lane selections (each carries its box's `lane_id`), for
    /// the per-box "Box → Track" display.
    pub track_flow_events: Vec<TrackFlowPlaybackEvent>,
}

// ---------------------------------------------------------------------------
// Telemetry sampling
//
// One sampler, three payload classes. A single `sample_telemetry` call locks
// `TransportShared` once, reads the clock + parallel positions, computes the
// overlay/log version digests, and clones only the layer vectors whose digest
// actually changed. The Tauri layer owns epoch counters and emission; this
// crate owns the atomic read and the change detection.
// ---------------------------------------------------------------------------

/// High-frequency clock data for the playhead. Tiny, latest-wins.
#[derive(Debug, Clone)]
pub struct TransportPositionSample {
    pub tempo_bpm: f32,
    pub is_playing: bool,
    pub current_tick: u64,
    pub current_cycle: u64,
    pub ticks_per_cycle: u64,
    pub current_score_id: Option<String>,
    pub parallel_track_positions: Vec<ParallelTrackPosition>,
}

/// The cycle-coherent overlay layers — the timeline render trust surface.
#[derive(Debug, Clone)]
pub struct TimelineLayers {
    pub channel_hocket_events: Vec<ChannelHocketPlaybackEvent>,
    pub realized_rhythm_events: Vec<RealizedRhythmSpanEvent>,
    /// Per-box Track Flow lane selections (each carries its box's `lane_id`).
    pub track_flow_events: Vec<TrackFlowPlaybackEvent>,
}

/// The rolling diagnostic/log layers, delivered only when a log consumer is
/// interested (see `TelemetrySample::log_layers`).
#[derive(Debug, Clone)]
pub struct LogLayers {
    pub midi_debug_events: Vec<MidiDebugEvent>,
    pub automation_events: Vec<AutomationPlaybackEvent>,
    pub seed_trace_events: Vec<PlaybackSeedTraceEvent>,
    pub parallel_conflict_events: Vec<ParallelConflictDebugEvent>,
    pub trigger_decision_events: Vec<TriggerDecisionEvent>,
}

/// Selects how much rolling telemetry to clone and publish. Seed recording and
/// the trigger inspector are deliberately separate from full diagnostics:
/// MIDI activity is much more frequent than either and must not force unrelated
/// log serialization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TelemetryLogInterest {
    #[default]
    None,
    SeedTrace,
    Trigger,
    SeedTraceAndTrigger,
    Full,
}

impl TelemetryLogInterest {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::SeedTrace => "seedTrace",
            Self::Trigger => "trigger",
            Self::SeedTraceAndTrigger => "seedTraceAndTrigger",
            Self::Full => "full",
        }
    }
}

/// Coarse parallel-track identity for the timeline digest: everything the
/// timeline grid depends on *except* tick-only movement (`tick_in_cycle`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParallelTrackCoarse {
    pub track_id: String,
    pub cycle: u64,
    pub ticks_per_cycle: u64,
    pub reference_start_tick: u64,
    pub reference_end_tick: u64,
}

/// Fingerprint of render-relevant timeline state, explicitly excluding
/// `current_tick`. Two equal digests mean the timeline payload would be
/// identical, so no `transport_timeline_snapshot` need be emitted.
#[derive(Debug, Clone, PartialEq)]
pub struct TimelineDigest {
    pub is_playing: bool,
    pub current_cycle: u64,
    pub ticks_per_cycle: u64,
    /// `tempo_bpm.to_bits()` so the digest is exactly comparable.
    pub tempo_bits: u32,
    pub current_score_id: Option<String>,
    pub parallel_coarse: Vec<ParallelTrackCoarse>,
    pub overlay_versions: OverlayVersions,
}

/// Fingerprint of the rolling log layers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogDigest {
    pub log_versions: LogVersions,
}

/// One atomic telemetry read: always a position, plus the timeline/log payloads
/// whose digest changed (or were forced).
#[derive(Debug, Clone)]
pub struct TelemetrySample {
    pub position: TransportPositionSample,
    pub timeline_digest: TimelineDigest,
    pub log_digest: LogDigest,
    /// `Some` when the timeline digest changed vs `previous_timeline` or `force`.
    pub timeline_layers: Option<TimelineLayers>,
    /// `Some` when an interested log subset changed (or `force`).
    pub log_layers: Option<LogLayers>,
}

#[derive(Debug, Clone)]
pub struct ParallelTrackPosition {
    pub track_index: usize,
    pub track_id: String,
    pub track_name: String,
    pub cycle: u64,
    pub tick_in_cycle: u64,
    pub ticks_per_cycle: u64,
    pub reference_start_tick: u64,
    pub reference_end_tick: u64,
}
