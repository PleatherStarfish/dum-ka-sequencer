#[allow(unused_imports)]
use crate::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelConflictPolicy {
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

#[derive(Debug, Clone)]
pub struct ChannelLogicMatrixEntry {
    pub track_a_id: String,
    pub track_b_id: String,
    /// User-facing MIDI channel number, 1-16. None is a legacy/all-channel
    /// pair override that applies when no channel-specific entry exists.
    pub output_channel: Option<u8>,
    pub policy: ChannelConflictPolicy,
}

#[derive(Debug, Clone)]
pub struct ParallelPlaybackTrackConfig {
    pub id: String,
    pub name: String,
    pub score: Score,
    pub rhythm: Option<RhythmPlaybackConfig>,
    pub tempo_bpm: f32,
    /// `None` ⇒ continuous (today's behavior). `Some` ⇒ triggered: the track is
    /// armed and launches only when its trigger fires against `source_track_id`.
    /// The graph is normalized (self/dangling/non-continuous-source rejected) in
    /// `ParallelRuntimeConfig::from_config`.
    pub trigger: Option<cseq_trigger::TriggerConfig>,
    /// A **silent source**: realized so its resolved structure can drive a
    /// triggered follower, but its own MIDI is suppressed (it produces no
    /// audible notes and does not participate in conflict resolution). This is
    /// how a *muted* track keeps driving its followers — the documented mute
    /// semantics. Default `false`.
    pub silent: bool,
}

#[derive(Debug, Clone)]
pub struct ParallelPlaybackConfig {
    pub tracks: Vec<ParallelPlaybackTrackConfig>,
    pub reference_tempo_bpm: f32,
    pub reference_cycle_beats: u32,
    pub channel_conflict_policy: ChannelConflictPolicy,
    pub channel_logic_matrix: Vec<ChannelLogicMatrixEntry>,
    pub conflict_priority: Vec<String>,
    /// The project's Track Flow boxes. Empty ⇒ pure parallel playback (today's
    /// behavior, unchanged). Each box is one synthetic sequential lane that plays
    /// in parallel with the others; the v1 single lane is the box with id `main`.
    pub track_flow_boxes: Vec<TrackFlowBoxConfig>,
}

/// One Track Flow box: a single synthetic participant (`track-flow-<id>`) that,
/// each cycle, Markov-chooses one of its member source tracks to realize. Member
/// tracks are silent except on the cycles the box selects them, and the box
/// counts as exactly one conflict participant. The runtime config carries the
/// box's **audible** member sources only (the frontend prunes muted/solo-hidden
/// members and restricts the chain to the audible set before sending).
#[derive(Debug, Clone)]
pub struct TrackFlowBoxConfig {
    /// Authored box id; the conflict lane id derives as `track-flow-<id>` and the
    /// seed-path namespace as `track-flow-<id>:`. Must be non-empty, colon-free,
    /// unique across boxes, and reserved against authored track ids.
    pub id: String,
    /// Display / snapshot label for the box's lane (e.g. "Box A"). The v1 box is
    /// named "Track Flow".
    pub name: String,
    /// The candidate source tracks, in authored order (audible members only).
    /// Realized with the same machinery as parallel tracks; `trigger`/`silent`
    /// are ignored here.
    pub sources: Vec<ParallelPlaybackTrackConfig>,
    /// Explicit Markov chain over the sources (state indices match `sources`
    /// order). `None` ⇒ a uniform first-order chain over the sources.
    pub spec: Option<trackflow::TrackFlowSpec>,
    /// Concrete RNG seed for this box's chain walk (resolved upstream).
    pub seed: u64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SeedPathPlaybackConfig {
    pub entries: Vec<SeedPathPlaybackEntry>,
    pub wildcards: Vec<SeedPathWildcard>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SeedPathPlaybackEntry {
    pub cycle: u64,
    pub domain: String,
    pub label: String,
    pub seed: u64,
    pub base_seed: Option<u64>,
    pub source: String,
    pub history_before: Vec<u64>,
    pub history_after: Vec<u64>,
    /// Track this entry was recorded for. `None` is a legacy/single-track entry
    /// that matches any track during replay; a concrete id matches only that
    /// track. See `seed_path_entry_matches_track`.
    pub track_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SeedPathWildcard {
    pub domain: String,
    pub cycle: Option<u64>,
    /// Track this wildcard applies to. `None` applies to all tracks.
    pub track_id: Option<String>,
}

#[cfg(feature = "fuzzing")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportFuzzQueuedEvent {
    pub absolute_tick: u64,
    pub user_channel: Option<u8>,
    pub bytes: Vec<u8>,
}

#[cfg(feature = "fuzzing")]
#[derive(Debug, Clone)]
pub struct TransportCycleFuzzResult {
    pub cycle: u64,
    pub ticks_per_cycle: u64,
    pub queue: Vec<TransportFuzzQueuedEvent>,
    pub channel_hocket: Vec<ChannelHocketPlaybackEvent>,
    pub seed_trace: Vec<PlaybackSeedTraceEvent>,
}

#[cfg(feature = "fuzzing")]
pub fn fuzz_realize_transport_cycles(
    score: &mut Score,
    mut rhythm: Option<&mut RhythmPlaybackConfig>,
    start_cycle: u64,
    cycle_count: u64,
    tempo_bpm: f32,
) -> Result<Vec<TransportCycleFuzzResult>, TransportError> {
    if !(20.0..=400.0).contains(&tempo_bpm) {
        return Err(TransportError::InvalidTempo(tempo_bpm));
    }
    validate_score_for_transport(score).map_err(TransportError::InvalidScore)?;
    if let Some(config) = rhythm.as_deref() {
        validate_rhythm_playback_config(config).map_err(TransportError::InvalidPlaybackConfig)?;
    }

    let ticks_per_cycle = ticks_per_cycle(score);
    let mut queue = VecDeque::new();
    let mut out = Vec::new();
    for offset in 0..cycle_count.min(16) {
        let cycle = start_cycle.saturating_add(offset);
        let cycle_base_tick = cycle.saturating_mul(ticks_per_cycle);
        let events = realize_and_enqueue(
            score,
            cycle,
            cycle_base_tick,
            &mut queue,
            tempo_bpm,
            rhythm.as_deref_mut(),
            None,
        )?;
        out.push(TransportCycleFuzzResult {
            cycle,
            ticks_per_cycle,
            queue: queue.iter().map(TransportFuzzQueuedEvent::from).collect(),
            channel_hocket: events.channel_hocket,
            seed_trace: events.seed_trace,
        });
    }
    Ok(out)
}

#[cfg(feature = "fuzzing")]
impl From<&QueuedEvent> for TransportFuzzQueuedEvent {
    fn from(event: &QueuedEvent) -> Self {
        Self {
            absolute_tick: event.absolute_tick,
            user_channel: event.user_channel,
            bytes: event.as_bytes().to_vec(),
        }
    }
}

/// Fuzzing-only public wrapper for the **parallel / Track Flow** realize path —
/// the multi-track analogue of [`fuzz_realize_transport_cycles`]. It validates
/// the config (participant/source caps, reserved ids, per-track scores), builds
/// the runtime, and realizes `cycle_count` reference cycles in a single
/// `realize_parallel_until` pass (rayon PASS A + triggered followers + Track Flow
/// lanes + the conflict pass), returning the flattened MIDI ledger. Parallel
/// conflict/track metadata is dropped by the [`TransportFuzzQueuedEvent`]
/// projection, which is sufficient for determinism/structural/cap invariants.
/// Behind `feature = "fuzzing"`; adds no production surface.
#[cfg(feature = "fuzzing")]
pub fn fuzz_realize_parallel_cycles(
    config: ParallelPlaybackConfig,
    cycle_count: u64,
) -> Result<Vec<TransportFuzzQueuedEvent>, TransportError> {
    validate_parallel_playback_config(&config).map_err(TransportError::InvalidPlaybackConfig)?;
    // Reference ticks per cycle bounds the realize window; matches the live
    // scheduler's `ParallelRuntimeConfig::reference_ticks_per_cycle`.
    let reference_tpc = u64::from(config.reference_cycle_beats) * u64::from(PPQN);
    let target_tick = cycle_count.clamp(1, 16).saturating_mul(reference_tpc);
    let mut runtime = ParallelRuntimeConfig::from_config(config);
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut runtime, target_tick, &mut queue)?;
    Ok(queue.iter().map(TransportFuzzQueuedEvent::from).collect())
}

/// Fuzzing-only wrapper that realizes `cycle_count` reference cycles, runs the
/// **reapply path** (`reset_realization` + re-realize the same window), and
/// returns the second pass's ledger. Comparing this against
/// [`fuzz_realize_parallel_cycles`] with the same config asserts the S2
/// replay-from-zero determinism contract: `reset_realization` must restore every
/// domain (including History-mode subdivision-switch seeds) to its authored
/// baseline so a boundary-quantized reapply produces bit-identical output.
#[cfg(feature = "fuzzing")]
pub fn fuzz_realize_parallel_cycles_reapplied(
    config: ParallelPlaybackConfig,
    cycle_count: u64,
) -> Result<Vec<TransportFuzzQueuedEvent>, TransportError> {
    validate_parallel_playback_config(&config).map_err(TransportError::InvalidPlaybackConfig)?;
    let reference_tpc = u64::from(config.reference_cycle_beats) * u64::from(PPQN);
    let target_tick = cycle_count.clamp(1, 16).saturating_mul(reference_tpc);
    let mut runtime = ParallelRuntimeConfig::from_config(config);
    let mut warmup = VecDeque::new();
    realize_parallel_until(&mut runtime, target_tick, &mut warmup)?;
    runtime.reset_realization();
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut runtime, target_tick, &mut queue)?;
    Ok(queue.iter().map(TransportFuzzQueuedEvent::from).collect())
}

/// [`fuzz_realize_parallel_cycles`] variant that realizes the same window in
/// per-cycle **steps** — one `realize_parallel_until` call per reference cycle,
/// accumulating into a single queue — exactly as the live scheduler does its
/// realize-ahead. Comparing this against the single-pass
/// [`fuzz_realize_parallel_cycles`] asserts that incremental realization (with
/// the conflict pass running per batch over `only_keys`) is byte-identical to
/// realizing everything at once: the guarantee the D2 = Oc1 Alternate ordinal
/// and the A1 note-off deferral both depend on.
#[cfg(feature = "fuzzing")]
pub fn fuzz_realize_parallel_cycles_stepped(
    config: ParallelPlaybackConfig,
    cycle_count: u64,
) -> Result<Vec<TransportFuzzQueuedEvent>, TransportError> {
    validate_parallel_playback_config(&config).map_err(TransportError::InvalidPlaybackConfig)?;
    let reference_tpc = u64::from(config.reference_cycle_beats) * u64::from(PPQN);
    let cycles = cycle_count.clamp(1, 16);
    let mut runtime = ParallelRuntimeConfig::from_config(config);
    let mut queue = VecDeque::new();
    for cycle in 1..=cycles {
        realize_parallel_until(
            &mut runtime,
            cycle.saturating_mul(reference_tpc),
            &mut queue,
        )?;
    }
    Ok(queue.iter().map(TransportFuzzQueuedEvent::from).collect())
}

/// [`fuzz_realize_parallel_cycles`] variant that also returns the seed-trace
/// events the realization recorded (every domain, every track — including
/// triggered followers and box-lane composite `track-flow-<box>:<source>`
/// ids). A caller can turn that trace into a [`SeedPathPlaybackConfig`],
/// attach it to every track's rhythm config, and re-realize to assert the
/// multi-track seed-path replay contract.
#[cfg(feature = "fuzzing")]
pub fn fuzz_realize_parallel_cycles_traced(
    config: ParallelPlaybackConfig,
    cycle_count: u64,
) -> Result<(Vec<TransportFuzzQueuedEvent>, Vec<PlaybackSeedTraceEvent>), TransportError> {
    validate_parallel_playback_config(&config).map_err(TransportError::InvalidPlaybackConfig)?;
    let reference_tpc = u64::from(config.reference_cycle_beats) * u64::from(PPQN);
    let target_tick = cycle_count.clamp(1, 16).saturating_mul(reference_tpc);
    let mut runtime = ParallelRuntimeConfig::from_config(config);
    let mut queue = VecDeque::new();
    let events = realize_parallel_until(&mut runtime, target_tick, &mut queue)?;
    Ok((
        queue.iter().map(TransportFuzzQueuedEvent::from).collect(),
        events.seed_trace,
    ))
}

/// Fuzzing/bench-only hook that measures the **fast-forward** cost the
/// boundary-quantized reapply relies on: build a parallel runtime and realize
/// `cycle_count` reference cycles in a single `realize_parallel_until` pass,
/// returning the realized event count as a checksum. Unlike
/// [`fuzz_realize_parallel_cycles`] it is not clamped to a 16-cycle window (only
/// a runaway-guard upper bound), so `cseq-bench` can measure per-1000-cycle
/// replay cost and inform whether periodic realization checkpoints are needed.
#[cfg(feature = "fuzzing")]
pub fn fuzz_fast_forward_parallel_cycles(
    config: ParallelPlaybackConfig,
    cycle_count: u64,
) -> Result<usize, TransportError> {
    validate_parallel_playback_config(&config).map_err(TransportError::InvalidPlaybackConfig)?;
    let reference_tpc = u64::from(config.reference_cycle_beats) * u64::from(PPQN);
    let target_tick = cycle_count.clamp(1, 100_000).saturating_mul(reference_tpc);
    let mut runtime = ParallelRuntimeConfig::from_config(config);
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut runtime, target_tick, &mut queue)?;
    Ok(queue.len())
}

#[derive(Debug, Clone)]
pub(crate) struct ParallelTrackTimingWindow {
    pub(crate) cycle: u64,
    pub(crate) reference_start_tick: u64,
    pub(crate) reference_end_tick: u64,
    pub(crate) local_ticks_per_cycle: u64,
    pub(crate) tempo_map: LocalTempoAutomationMap,
}

/// Per-launch realization cursor + carry for a triggered follower track.
///
/// The follower's launches are the single source of truth (see
/// `docs/TRIGGERED_TRACKS_PLAN.md` C2): `compile_window` decides them purely from
/// the source's resolved cycles; this struct realizes them incrementally and
/// future-only. `carry` threads boundary-crossing state between windows;
/// `launches` is the append-only decided list; the cursor remembers how far
/// realization has progressed so a run can span multiple lookahead windows.
#[derive(Debug, Clone)]
pub(crate) struct TriggeredRuntime {
    config: cseq_trigger::TriggerConfig,
    /// The follower's phrase score. Equals `track.score` for `length:
    /// scoreCycle`; for `length: fixedBeats { n }` it is the score with
    /// `cycle_length` overridden to `n` beats so the pipeline cuts an n-beat
    /// cycle. Realized against `&mut` so per-cycle Markov history evolves across
    /// the follower's launched cycles exactly like a continuous track.
    phrase_score: Score,
    /// Authored `SubdivisionSwitch` History seed baseline of `phrase_score`,
    /// restored on `reset_realization` so replay-from-zero is deterministic (S2).
    phrase_score_switch_seed_baseline: Vec<Option<Vec<u64>>>,
    phrase_local_tpc: u64,
    carry: cseq_trigger::TriggerCarry,
    launches: Vec<cseq_trigger::CompiledLaunch>,
    /// Index into `launches` of the next launch to realize.
    next_launch_idx: usize,
    /// Next follower cycle (0-based within the current launch) to realize.
    next_cycle_in_launch: u32,
    /// Reference tick where the next follower cycle to realize starts. Unlike
    /// the compiler's nominal `reference_start_tick + k * phrase`, this
    /// **accumulates the actual per-cycle reference duration** (exactly as a
    /// continuous track does) so a launch's later cycles land correctly even
    /// when per-cycle local tempo automation makes cycle durations differ.
    /// Persisted across windows when a run is realized incrementally.
    next_cycle_reference_tick: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct ParallelRuntimeTrack {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) score: Score,
    /// Authored `SubdivisionSwitch` History seed baseline of `score`, restored on
    /// `reset_realization` so replay-from-zero is deterministic (S2). Empty for a
    /// Track Flow lane (its placeholder score never realizes).
    pub(crate) score_switch_seed_baseline: Vec<Option<Vec<u64>>>,
    /// Authored generator History seed pool, restored with score seed state on
    /// replay-from-zero.
    pub(crate) generator_seed_history_baseline: Option<Vec<u64>>,
    pub(crate) rhythm: Option<RhythmPlaybackConfig>,
    pub(crate) tempo_bpm: f32,
    pub(crate) priority_rank: usize,
    pub(crate) realized_up_to_cycle: u64,
    pub(crate) realized_up_to_reference_tick: u64,
    pub(crate) timing_windows: VecDeque<ParallelTrackTimingWindow>,
    /// Realize for structure capture only; suppress audible output (muted
    /// trigger source). See `ParallelPlaybackTrackConfig::silent`.
    pub(crate) silent: bool,
    /// `Some` ⇒ this track is a triggered follower (continuous tracks are
    /// `None` and realize byte-identically to before this feature).
    pub(crate) triggered: Option<TriggeredRuntime>,
    /// `Some` ⇒ this is the synthetic sequential Track Flow lane
    /// (`track-flow-main`); its `score`/`rhythm` are placeholders and it realizes
    /// one of `track_flow.sources` per cycle instead. Mutually exclusive with
    /// `triggered`. Continuous and triggered tracks are always `None`.
    pub(crate) track_flow: Option<TrackFlowRuntime>,
    /// Resolved cycles captured while this track was realized, in reference
    /// ticks. Populated only when the track is referenced as a trigger source;
    /// read by follower compilation. Capped to bound memory.
    pub(crate) recent_resolved: VecDeque<cseq_trigger::ResolvedCycle>,
}

/// One candidate source track the Track Flow lane can sound. Holds the same
/// realize material as a parallel track plus its own cycle cursor, which only
/// advances on the cycles the lane selects this source — so a source resumes its
/// generative sequence where it left off when re-selected.
#[derive(Debug, Clone)]
pub(crate) struct TrackFlowSource {
    id: String,
    name: String,
    score: Score,
    /// Authored `SubdivisionSwitch` History seed baseline of `score`, restored on
    /// `reset_realization` so replay-from-zero is deterministic (S2).
    score_switch_seed_baseline: Vec<Option<Vec<u64>>>,
    generator_seed_history_baseline: Option<Vec<u64>>,
    rhythm: Option<RhythmPlaybackConfig>,
    tempo_bpm: f32,
    realized_cycle: u64,
}

/// Runtime state for one Track Flow box's sequential lane: the chain walk plus
/// its source pool and a lane cycle counter (for display/diagnostics). `box_id`
/// is the authored box id (the lane id is `track-flow-<box_id>`); it is needed to
/// build per-source composite seed-path ids in PASS C.
#[derive(Debug, Clone)]
pub(crate) struct TrackFlowRuntime {
    box_id: String,
    resolver: trackflow::TrackFlowResolver,
    sources: Vec<TrackFlowSource>,
    cycle_index: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct ParallelRuntimeConfig {
    pub(crate) tracks: Vec<ParallelRuntimeTrack>,
    pub(crate) reference_tempo_bpm: f32,
    pub(crate) reference_cycle_beats: u32,
    pub(crate) channel_conflict_policy: ChannelConflictPolicy,
    pub(crate) channel_logic_matrix: HashMap<(usize, usize, Option<u8>), ChannelConflictPolicy>,
    /// `Alternate` rotation memory (D2 = Oc1): the start ticks of already-resolved
    /// multi-track collisions per `(user channel, reference cycle)`. A collision's
    /// rotation index is its rank in this set (count of resolved collisions with an
    /// earlier start), so rotation is per-collision, cycle-local, and derived from
    /// structure rather than a mutable per-channel counter. Idempotent under the
    /// incremental pass's re-resolution (re-inserting a known start does not shift
    /// ranks). Pruned as cycles fall behind the realize frontier; cleared on config
    /// swap (future cycles restart at ordinal 0, already-resolved winners are frozen
    /// in the queue, so a live edit never re-phases what is already decided).
    pub(crate) alternate_resolved: HashMap<(u8, u64), BTreeSet<u64>>,
    /// Playhead tick the scheduler last dispatched to (0 when unused, e.g. tests and
    /// Play init). The conflict pass never re-resolves a component that starts at or
    /// behind this horizon — its note-ons may already be on the wire, so re-suppressing
    /// them would strand notes (risk R9). Set fresh each scheduler tick.
    pub(crate) dispatch_horizon_tick: u64,
}

/// Append one synthetic Track Flow lane participant per box to the runtime track
/// list. Each box's lane is one conflict participant; its member source tracks
/// live inside its runtime and are not separate participants. Boxes with no
/// sources are skipped (an empty box contributes no lane). The lane id, name and
/// priority rank are derived per box; this generalizes the v1 single lane (box
/// id `main`) into the N-box loop.
pub(crate) fn append_track_flow_boxes(
    tracks: &mut Vec<ParallelRuntimeTrack>,
    boxes: Vec<TrackFlowBoxConfig>,
    priority: &HashMap<&str, usize>,
) {
    for config in boxes {
        if config.sources.is_empty() {
            continue;
        }
        let sources: Vec<TrackFlowSource> = config
            .sources
            .into_iter()
            .map(|source| {
                let generator_seed_history_baseline =
                    capture_generator_seed_history(&source.rhythm);
                TrackFlowSource {
                    id: source.id,
                    name: source.name,
                    score_switch_seed_baseline: capture_switch_seed_histories(&source.score),
                    generator_seed_history_baseline,
                    score: source.score,
                    rhythm: source.rhythm,
                    tempo_bpm: source.tempo_bpm.clamp(20.0, 400.0),
                    realized_cycle: 0,
                }
            })
            .collect();
        let spec = config
            .spec
            .unwrap_or_else(|| trackflow::TrackFlowSpec::uniform(sources.len() as u32));
        let resolver = trackflow::TrackFlowResolver::new(spec, config.seed);
        // The lane never realizes its own `score`; carry a placeholder so the
        // field is valid (PASS A skips the lane, PASS C realizes the chosen
        // source).
        let placeholder_score = sources[0].score.clone();
        let lane_id = trackflow::lane_id(&config.id);
        let priority_rank = priority
            .get(lane_id.as_str())
            .copied()
            .unwrap_or(tracks.len());
        tracks.push(ParallelRuntimeTrack {
            id: lane_id,
            name: config.name,
            // The lane never realizes its placeholder score, so it carries no
            // seed baseline; each source restores its own (PASS C).
            score_switch_seed_baseline: Vec::new(),
            generator_seed_history_baseline: None,
            score: placeholder_score,
            rhythm: None,
            tempo_bpm: 120.0,
            priority_rank,
            realized_up_to_cycle: 0,
            realized_up_to_reference_tick: 0,
            timing_windows: VecDeque::new(),
            silent: false,
            triggered: None,
            track_flow: Some(TrackFlowRuntime {
                box_id: config.id,
                resolver,
                sources,
                cycle_index: 0,
            }),
            recent_resolved: VecDeque::new(),
        });
    }
}

/// The authored `SubdivisionSwitch` History seed vectors of a score's pipeline,
/// in pipeline order — one entry per `SubdivisionSwitch` transform, `None` when
/// that transform is not in History mode (Locked/PerCycle/FollowGlobal carry no
/// mutable seed state).
///
/// Why this exists (S2): `apply_pipeline_for_cycle_mut_inner` realizes through
/// `&mut score.pipeline`, and the `SwitchSeedMode::History` arm of
/// `resolve_seed` mutates its `history` Vec in place (push/trim). Unlike the
/// rhythm/pitch/channel configs — which `realize_and_enqueue` clones per cycle
/// so their History mutation is discarded — the `Score` is threaded un-cloned,
/// so History accumulates on the persistent score across cycles (correct for
/// forward playback). That makes `reset_realization` + replay-from-zero NON
/// deterministic for History mode unless we restore the authored baseline on
/// reset. We capture the baseline at construction and reinstall it on reset.
pub(crate) fn capture_switch_seed_histories(score: &Score) -> Vec<Option<Vec<u64>>> {
    score
        .pipeline
        .iter()
        .filter_map(|transform| match &transform.kind {
            TransformKind::SubdivisionSwitch { seed_mode, .. } => Some(match seed_mode {
                cseq_model::SwitchSeedMode::History { history, .. } => Some(history.clone()),
                _ => None,
            }),
            _ => None,
        })
        .collect()
}

/// Reinstall the authored History seed vectors captured by
/// `capture_switch_seed_histories`, returning the score's switch seed history to
/// its authored baseline so a `reset_realization` + replay is bit-identical.
/// Forward playback is untouched — only reset restores the baseline.
pub(crate) fn restore_switch_seed_histories(score: &mut Score, baseline: &[Option<Vec<u64>>]) {
    let switch_seed_modes = score
        .pipeline
        .iter_mut()
        .filter_map(|transform| match &mut transform.kind {
            TransformKind::SubdivisionSwitch { seed_mode, .. } => Some(seed_mode),
            _ => None,
        });
    for (seed_mode, base) in switch_seed_modes.zip(baseline.iter()) {
        if let (cseq_model::SwitchSeedMode::History { history, .. }, Some(base_history)) =
            (seed_mode, base)
        {
            history.clone_from(base_history);
        }
    }
}

pub(crate) fn capture_generator_seed_history(
    rhythm: &Option<RhythmPlaybackConfig>,
) -> Option<Vec<u64>> {
    match rhythm.as_ref().map(|config| config.generator.seed_mode()) {
        Some(cseq_rhythm::GeneratorSeedMode::History { history, .. }) => Some(history.clone()),
        _ => None,
    }
}

pub(crate) fn restore_generator_seed_history(
    rhythm: &mut Option<RhythmPlaybackConfig>,
    baseline: Option<&[u64]>,
) {
    if let (Some(RhythmPlaybackConfig { generator, .. }), Some(baseline)) =
        (rhythm.as_mut(), baseline)
    {
        if let cseq_rhythm::GeneratorSeedMode::History { history, .. } = generator.seed_mode_mut() {
            history.clear();
            history.extend_from_slice(baseline);
        }
    }
}

/// Swap one running track's authored parameters (name/tempo/silent/score/rhythm)
/// for the incoming config's, keeping all realization cursors and generative
/// state (P1 in-place apply). A triggered follower's `config` and phrase-score
/// *content* are updated too, but its carry/launch schedule is kept (future
/// launches recompile from the source under the new config each window; any
/// already-compiled lookahead launches play out — a bounded transient, and the
/// UI locks trigger edits mid-play so this is an API-correctness path).
/// `normalized_trigger` is the incoming trigger after graph normalization (the
/// same value `from_config` would build); `None` leaves the running config.
/// History-mode subdivision-switch seed pools reset to the incoming authored
/// baseline (documented discontinuity).
pub(crate) fn apply_track_params_in_place(
    track: &mut ParallelRuntimeTrack,
    incoming: &ParallelPlaybackTrackConfig,
    normalized_trigger: Option<&cseq_trigger::TriggerConfig>,
) {
    track.name = incoming.name.clone();
    track.tempo_bpm = incoming.tempo_bpm.clamp(20.0, 400.0);
    track.silent = incoming.silent;
    if let Some(triggered) = track.triggered.as_mut() {
        // Honor a same-source config edit before deriving the phrase, so a
        // `length` change (ScoreCycle <-> FixedBeats) shapes the new phrase cycle.
        if let Some(new_config) = normalized_trigger {
            triggered.config = new_config.clone();
        }
        let mut phrase_score = incoming.score.clone();
        if let cseq_trigger::TriggerLength::FixedBeats { beats } = triggered.config.length {
            phrase_score.cycle_length = Rational::from_integer(i64::from(beats.max(1)));
        }
        triggered.phrase_local_tpc = ticks_per_cycle(&phrase_score);
        triggered.phrase_score_switch_seed_baseline = capture_switch_seed_histories(&phrase_score);
        triggered.phrase_score = phrase_score;
    }
    track.score_switch_seed_baseline = capture_switch_seed_histories(&incoming.score);
    track.score = incoming.score.clone();
    track.generator_seed_history_baseline = capture_generator_seed_history(&incoming.rhythm);
    track.rhythm = incoming.rhythm.clone();
}

impl ParallelRuntimeConfig {
    pub(crate) fn from_config(config: ParallelPlaybackConfig) -> Self {
        let priority = config
            .conflict_priority
            .iter()
            .enumerate()
            .map(|(index, id)| (id.as_str(), index))
            .collect::<HashMap<_, _>>();

        // Normalize the trigger graph: self-trigger, dangling source, a source
        // that is itself triggered (one-level rule), and any cycle are demoted
        // to continuous with a logged warning. The result decides which tracks
        // get a `TriggeredRuntime`.
        let requested_modes: Vec<(String, Option<cseq_trigger::TriggerConfig>)> = config
            .tracks
            .iter()
            .map(|track| (track.id.clone(), track.trigger.clone()))
            .collect();
        let graph = cseq_trigger::normalize_track_modes(&requested_modes);
        for warning in &graph.warnings {
            warn!(
                track = %warning.track_id,
                source = %warning.source_id,
                message = %warning.message,
                "triggered track demoted to continuous"
            );
        }

        let mut tracks: Vec<ParallelRuntimeTrack> = config
            .tracks
            .into_iter()
            .enumerate()
            .map(|(index, track)| {
                let triggered = graph.trigger_for(&track.id).map(|cfg| {
                    // Build the follower phrase score; for fixed-beats, cut an
                    // n-beat cycle (the pipeline reads cycle beats from
                    // `score.cycle_length`).
                    let mut phrase_score = track.score.clone();
                    if let cseq_trigger::TriggerLength::FixedBeats { beats } = cfg.length {
                        phrase_score.cycle_length = Rational::from_integer(i64::from(beats.max(1)));
                    }
                    let phrase_local_tpc = ticks_per_cycle(&phrase_score);
                    let phrase_score_switch_seed_baseline =
                        capture_switch_seed_histories(&phrase_score);
                    TriggeredRuntime {
                        config: cfg.clone(),
                        phrase_score,
                        phrase_score_switch_seed_baseline,
                        phrase_local_tpc,
                        carry: cseq_trigger::TriggerCarry::default(),
                        launches: Vec::new(),
                        next_launch_idx: 0,
                        next_cycle_in_launch: 0,
                        next_cycle_reference_tick: 0,
                    }
                });
                let generator_seed_history_baseline = capture_generator_seed_history(&track.rhythm);
                ParallelRuntimeTrack {
                    priority_rank: priority.get(track.id.as_str()).copied().unwrap_or(index),
                    id: track.id,
                    name: track.name,
                    score_switch_seed_baseline: capture_switch_seed_histories(&track.score),
                    generator_seed_history_baseline,
                    score: track.score,
                    rhythm: track.rhythm,
                    tempo_bpm: track.tempo_bpm.clamp(20.0, 400.0),
                    realized_up_to_cycle: 0,
                    realized_up_to_reference_tick: 0,
                    timing_windows: VecDeque::new(),
                    silent: track.silent,
                    triggered,
                    track_flow: None,
                    recent_resolved: VecDeque::new(),
                }
            })
            .collect();
        // Append one synthetic sequential Track Flow lane (`track-flow-<boxId>`)
        // per box as an ordinary conflict participant. Each box's source tracks
        // live *inside* its lane runtime (not in `tracks`), so they never appear
        // as separate participants and cost nothing while the lane is between
        // selections. Built before `track_indices` so each lane gets an index and
        // can take part in conflict/priority like any track.
        append_track_flow_boxes(&mut tracks, config.track_flow_boxes, &priority);
        let track_indices = tracks
            .iter()
            .enumerate()
            .map(|(index, track)| (track.id.as_str(), index))
            .collect::<HashMap<_, _>>();
        let channel_logic_matrix = config
            .channel_logic_matrix
            .into_iter()
            .filter_map(|entry| {
                let a = *track_indices.get(entry.track_a_id.as_str())?;
                let b = *track_indices.get(entry.track_b_id.as_str())?;
                (a != b).then_some((
                    channel_logic_key(
                        a,
                        b,
                        entry.output_channel.map(|channel| channel.clamp(1, 16)),
                    ),
                    entry.policy,
                ))
            })
            .collect::<HashMap<_, _>>();
        Self {
            tracks,
            reference_tempo_bpm: config.reference_tempo_bpm.clamp(20.0, 400.0),
            reference_cycle_beats: config.reference_cycle_beats.clamp(1, 64),
            channel_conflict_policy: config.channel_conflict_policy,
            channel_logic_matrix,
            alternate_resolved: HashMap::new(),
            dispatch_horizon_tick: 0,
        }
    }

    /// Whether an incoming config has the same *topology* as this running
    /// runtime: identical non-lane track ids, identical box (lane) ids and their
    /// membership, and an identical normalized trigger graph (id → source). Only
    /// a topology match may be applied forward in place; anything else must
    /// rebuild (and, mid-play, is rejected — the FE never sends it).
    fn topology_matches(&self, config: &ParallelPlaybackConfig) -> bool {
        let self_track_ids: BTreeSet<&str> = self
            .tracks
            .iter()
            .filter(|track| track.track_flow.is_none())
            .map(|track| track.id.as_str())
            .collect();
        let config_track_ids: BTreeSet<&str> = config
            .tracks
            .iter()
            .map(|track| track.id.as_str())
            .collect();
        if self_track_ids != config_track_ids {
            return false;
        }

        let self_box_ids: BTreeSet<&str> = self
            .tracks
            .iter()
            .filter_map(|track| track.track_flow.as_ref().map(|flow| flow.box_id.as_str()))
            .collect();
        let config_box_ids: BTreeSet<&str> = config
            .track_flow_boxes
            .iter()
            .filter(|the_box| !the_box.sources.is_empty())
            .map(|the_box| the_box.id.as_str())
            .collect();
        if self_box_ids != config_box_ids {
            return false;
        }

        // Trigger graph normalized the same way `from_config` does, so a demoted
        // trigger compares equal to the continuous track it became.
        let requested_modes: Vec<(String, Option<cseq_trigger::TriggerConfig>)> = config
            .tracks
            .iter()
            .map(|track| (track.id.clone(), track.trigger.clone()))
            .collect();
        let graph = cseq_trigger::normalize_track_modes(&requested_modes);
        let config_trigger_map: BTreeMap<&str, Option<String>> = config
            .tracks
            .iter()
            .map(|track| {
                (
                    track.id.as_str(),
                    graph
                        .trigger_for(&track.id)
                        .map(|cfg| cfg.source_track_id.clone()),
                )
            })
            .collect();
        let self_trigger_map: BTreeMap<&str, Option<String>> = self
            .tracks
            .iter()
            .filter(|track| track.track_flow.is_none())
            .map(|track| {
                (
                    track.id.as_str(),
                    track
                        .triggered
                        .as_ref()
                        .map(|triggered| triggered.config.source_track_id.clone()),
                )
            })
            .collect();
        if config_trigger_map != self_trigger_map {
            return false;
        }

        // Box membership (source ids per box) must match too.
        for the_box in &config.track_flow_boxes {
            if the_box.sources.is_empty() {
                continue;
            }
            let lane_id = trackflow::lane_id(&the_box.id);
            let Some(flow) = self
                .tracks
                .iter()
                .find(|track| track.id == lane_id)
                .and_then(|track| track.track_flow.as_ref())
            else {
                return false;
            };
            let self_sources: BTreeSet<&str> = flow
                .sources
                .iter()
                .map(|source| source.id.as_str())
                .collect();
            let config_sources: BTreeSet<&str> = the_box
                .sources
                .iter()
                .map(|source| source.id.as_str())
                .collect();
            if self_sources != config_sources {
                return false;
            }
        }
        true
    }

    /// Apply a new authored config to a RUNNING runtime **in place** (P1),
    /// preserving every realization cursor and generative-state field so
    /// realization continues forward from the current position with no replay
    /// (the O(cycles²) replay-from-zero is never invoked). Returns `false` when
    /// the change cannot be applied forward — a topology change, or a
    /// reference-grid (`reference_cycle_beats`) change that would move the master
    /// tick grid — signalling the caller to reject it mid-play.
    ///
    /// Continuity: rhythm/pitch/channel Markov chains re-derive their per-cycle
    /// seed from `(seed_mode, cycle)`, so swapping a track's config keeps them
    /// continuous; the Track Flow lane resolver walk and each triggered
    /// follower's carry/launch schedule are preserved (a follower's launches are
    /// recompiled from its source each window, so a changed source updates them
    /// forward). Only History-mode subdivision-switch seed pools reset to their
    /// authored baseline — the documented "seeds are a discontinuity" caveat. This
    /// resets **every** non-lane track's pool on **any** successful apply, because
    /// every non-lane track's score is replaced (there is no per-track change
    /// detection yet); the FE payload dedup only skips the push when the whole
    /// config is unchanged. Preserving an untouched History track's pool needs
    /// per-track fingerprinting (a deferred follow-up).
    pub(crate) fn apply_in_place(&mut self, config: &ParallelPlaybackConfig) -> bool {
        if self.reference_cycle_beats != config.reference_cycle_beats.clamp(1, 64) {
            return false;
        }
        if !self.topology_matches(config) {
            return false;
        }

        // Global params — take effect on the next conflict/realize pass.
        self.reference_tempo_bpm = config.reference_tempo_bpm.clamp(20.0, 400.0);
        self.channel_conflict_policy = config.channel_conflict_policy;
        let priority: HashMap<&str, usize> = config
            .conflict_priority
            .iter()
            .enumerate()
            .map(|(index, id)| (id.as_str(), index))
            .collect();
        // Fall back to track position for ids the incoming list omits, exactly as
        // `from_config` does — otherwise an omitted id would keep a stale rank
        // (e.g. re-applying with an empty list must reset every rank to track
        // order, not leave the previous ordering in place).
        for (index, track) in self.tracks.iter_mut().enumerate() {
            track.priority_rank = priority.get(track.id.as_str()).copied().unwrap_or(index);
        }
        // Positions are stable (topology matches), so the position-keyed matrix
        // can be rebuilt against the live track order.
        let track_indices: HashMap<&str, usize> = self
            .tracks
            .iter()
            .enumerate()
            .map(|(index, track)| (track.id.as_str(), index))
            .collect();
        self.channel_logic_matrix = config
            .channel_logic_matrix
            .iter()
            .filter_map(|entry| {
                let a = *track_indices.get(entry.track_a_id.as_str())?;
                let b = *track_indices.get(entry.track_b_id.as_str())?;
                (a != b).then_some((
                    channel_logic_key(
                        a,
                        b,
                        entry.output_channel.map(|channel| channel.clamp(1, 16)),
                    ),
                    entry.policy,
                ))
            })
            .collect();

        // Per-track parameters (continuous + triggered), keyed by id. Normalize
        // the trigger graph the same way `from_config` does so a same-source
        // trigger *config* edit (condition/length/gate/…) is carried into the
        // running follower — topology only guaranteed the source id is unchanged.
        let requested_modes: Vec<(String, Option<cseq_trigger::TriggerConfig>)> = config
            .tracks
            .iter()
            .map(|track| (track.id.clone(), track.trigger.clone()))
            .collect();
        let graph = cseq_trigger::normalize_track_modes(&requested_modes);
        for incoming in &config.tracks {
            if let Some(track) = self
                .tracks
                .iter_mut()
                .find(|track| track.track_flow.is_none() && track.id == incoming.id)
            {
                apply_track_params_in_place(track, incoming, graph.trigger_for(&incoming.id));
            }
        }

        // Box lanes: swap each source's score/rhythm/tempo, keep the resolver's
        // walk position so the lane's selection sequence stays continuous. Box
        // chain spec/seed live-editing is deferred (P3).
        for incoming_box in &config.track_flow_boxes {
            let lane_id = trackflow::lane_id(&incoming_box.id);
            if let Some(flow) = self
                .tracks
                .iter_mut()
                .find(|track| track.id == lane_id)
                .and_then(|track| track.track_flow.as_mut())
            {
                for incoming_source in &incoming_box.sources {
                    if let Some(source) = flow
                        .sources
                        .iter_mut()
                        .find(|source| source.id == incoming_source.id)
                    {
                        source.tempo_bpm = incoming_source.tempo_bpm.clamp(20.0, 400.0);
                        source.score_switch_seed_baseline =
                            capture_switch_seed_histories(&incoming_source.score);
                        source.score = incoming_source.score.clone();
                        source.generator_seed_history_baseline =
                            capture_generator_seed_history(&incoming_source.rhythm);
                        source.rhythm = incoming_source.rhythm.clone();
                    }
                }
            }
        }
        true
    }

    pub(crate) fn reset_realization(&mut self) {
        for track in &mut self.tracks {
            track.realized_up_to_cycle = 0;
            track.realized_up_to_reference_tick = 0;
            track.timing_windows.clear();
            track.recent_resolved.clear();
            // Restore the continuous track's authored SubdivisionSwitch History
            // seed baseline so re-realizing from cycle 0 draws the identical
            // seed stream (S2). Other seed modes carry no state to restore.
            restore_switch_seed_histories(&mut track.score, &track.score_switch_seed_baseline);
            restore_generator_seed_history(
                &mut track.rhythm,
                track.generator_seed_history_baseline.as_deref(),
            );
            // Recompiling from cycle 0 with a fresh carry/cursor reproduces the
            // identical launch sequence (determinism across reapply, C4). The
            // phrase score's structure persists, but its History seed baseline is
            // restored (like the continuous score) so replay is bit-identical.
            if let Some(triggered) = track.triggered.as_mut() {
                triggered.carry = cseq_trigger::TriggerCarry::default();
                triggered.launches.clear();
                triggered.next_launch_idx = 0;
                triggered.next_cycle_in_launch = 0;
                triggered.next_cycle_reference_tick = 0;
                restore_switch_seed_histories(
                    &mut triggered.phrase_score,
                    &triggered.phrase_score_switch_seed_baseline,
                );
            }
            // The Track Flow lane re-walks from the same seed and each source
            // resumes at cycle 0, so a reapply reproduces the identical sequence.
            if let Some(flow) = track.track_flow.as_mut() {
                flow.resolver.reset();
                flow.cycle_index = 0;
                for source in &mut flow.sources {
                    source.realized_cycle = 0;
                    restore_switch_seed_histories(
                        &mut source.score,
                        &source.score_switch_seed_baseline,
                    );
                    restore_generator_seed_history(
                        &mut source.rhythm,
                        source.generator_seed_history_baseline.as_deref(),
                    );
                }
            }
        }
        // Future cycles restart Alternate rotation at ordinal 0 (deterministic);
        // already-resolved winners stay frozen in the queue, so an in-place edit
        // never re-phases a decision the listener may already have heard.
        self.alternate_resolved.clear();
    }

    /// Number of tracks that can participate in channel-conflict resolution.
    /// Silent sources emit no audible note groups, so they must NOT count toward
    /// the denominator of count-based policies (And/Nand/OneLow/Majority/Minority)
    /// or `active_track_count` — otherwise a muted source would silently change
    /// audible output for the real tracks.
    pub(crate) fn conflict_active_track_count(&self) -> usize {
        self.tracks.iter().filter(|track| !track.silent).count()
    }

    /// Track ids referenced as a trigger source by some follower. Only these
    /// tracks capture `ResolvedCycle`s during realization.
    fn trigger_source_ids(&self) -> std::collections::HashSet<String> {
        self.tracks
            .iter()
            .filter_map(|track| {
                track
                    .triggered
                    .as_ref()
                    .map(|t| t.config.source_track_id.clone())
            })
            .collect()
    }

    pub(crate) fn reference_ticks_per_cycle(&self) -> u64 {
        u64::from(self.reference_cycle_beats)
            .saturating_mul(PPQN as u64)
            .max(1)
    }

    pub(crate) fn track_positions(&self, reference_tick: u64) -> Vec<ParallelTrackPosition> {
        self.tracks
            .iter()
            .enumerate()
            .filter_map(|(track_index, track)| {
                // A silent source is muted: it must not appear as a
                // positioned/playing track in the snapshot/UI even though it is
                // realized internally to drive its follower.
                if track.silent {
                    return None;
                }
                let live_window = track.timing_windows.iter().find(|window| {
                    reference_tick >= window.reference_start_tick
                        && reference_tick < window.reference_end_tick
                });
                // Continuous tracks fall back to their last window so the
                // position readout stays stable at the realized tail. A
                // triggered follower must NOT: between launched runs it is
                // armed/idle, and a stale last-run window would report it as
                // playing forever after its first run finished.
                let window = match live_window {
                    Some(window) => window,
                    None if track.triggered.is_some() => return None,
                    None => track.timing_windows.back()?,
                };
                let reference_offset = reference_tick.saturating_sub(window.reference_start_tick);
                Some(ParallelTrackPosition {
                    track_index,
                    track_id: track.id.clone(),
                    track_name: track.name.clone(),
                    cycle: window.cycle,
                    tick_in_cycle: window
                        .tempo_map
                        .reference_tick_to_local_tick(reference_offset),
                    ticks_per_cycle: window.local_ticks_per_cycle,
                    reference_start_tick: window.reference_start_tick,
                    reference_end_tick: window.reference_end_tick,
                })
            })
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParallelConflictMetadata {
    pub(crate) policy: String,
    pub(crate) action: String,
    pub(crate) group_id: String,
}

/// A MIDI event ready for dispatch, with its absolute tick position.
pub(crate) struct QueuedEvent {
    pub(crate) absolute_tick: u64,
    /// User-facing MIDI channel number, 1-16. This is the channel identity that
    /// timeline, MIDI debug, external MIDI, and the built-in monitor must agree
    /// on. Raw MIDI bytes remain zero-based at the wire boundary.
    pub(crate) user_channel: Option<u8>,
    pub(crate) bytes: [u8; 3],
    pub(crate) len: u8,
    pub(crate) parallel_track_index: Option<usize>,
    pub(crate) parallel_track_id: Option<String>,
    pub(crate) parallel_track_name: Option<String>,
    pub(crate) parallel_conflict: Option<ParallelConflictMetadata>,
}

impl QueuedEvent {
    pub(crate) fn note_on(tick: u64, channel: u8, pitch: u8, velocity: u8) -> Self {
        Self {
            absolute_tick: tick,
            user_channel: Some(wire_channel_to_user_channel(channel)),
            bytes: [0x90 | (channel & 0x0F), pitch & 0x7F, velocity & 0x7F],
            len: 3,
            parallel_track_index: None,
            parallel_track_id: None,
            parallel_track_name: None,
            parallel_conflict: None,
        }
    }

    pub(crate) fn note_off(tick: u64, channel: u8, pitch: u8) -> Self {
        Self {
            absolute_tick: tick,
            user_channel: Some(wire_channel_to_user_channel(channel)),
            bytes: [0x80 | (channel & 0x0F), pitch & 0x7F, 0],
            len: 3,
            parallel_track_index: None,
            parallel_track_id: None,
            parallel_track_name: None,
            parallel_conflict: None,
        }
    }

    pub(crate) fn cc(tick: u64, channel: u8, controller: u8, value: u8) -> Self {
        Self {
            absolute_tick: tick,
            user_channel: Some(wire_channel_to_user_channel(channel)),
            bytes: [0xB0 | (channel & 0x0F), controller & 0x7F, value & 0x7F],
            len: 3,
            parallel_track_index: None,
            parallel_track_id: None,
            parallel_track_name: None,
            parallel_conflict: None,
        }
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.bytes[..self.len as usize]
    }

    pub(crate) fn with_parallel_track(
        mut self,
        track_index: usize,
        track_id: &str,
        track_name: &str,
    ) -> Self {
        self.parallel_track_index = Some(track_index);
        self.parallel_track_id = Some(track_id.to_string());
        self.parallel_track_name = Some(track_name.to_string());
        self
    }

    fn wire_channel(&self) -> Option<u8> {
        (self.len > 0 && self.bytes[0] < 0xF0).then_some(self.bytes[0] & 0x0F)
    }

    pub(crate) fn user_channel_matches_wire(&self) -> bool {
        match (self.user_channel, self.wire_channel()) {
            (Some(user_channel), Some(wire_channel)) => {
                user_channel == wire_channel_to_user_channel(wire_channel)
            }
            (None, None) => true,
            _ => false,
        }
    }

    pub(crate) fn dispatch_order(&self) -> u8 {
        match self.bytes[0] & 0xF0 {
            0x80 => 0,
            0x90 if self.bytes[2] == 0 => 0,
            0xB0 => 1,
            0x90 => 2,
            _ => 3,
        }
    }
}

pub(crate) fn tag_parallel_playback_events(
    events: &mut CyclePlaybackEvents,
    track_index: usize,
    track_id: &str,
    track_name: &str,
) {
    for event in &mut events.channel_hocket {
        event.parallel_track_index = Some(track_index);
        event.parallel_track_id = Some(track_id.to_string());
        event.parallel_track_name = Some(track_name.to_string());
    }
    // Tag seed-trace decisions with their source track so seed-path replay can
    // be filtered per track. This is the single recording-side tagging point;
    // keeping it here (next to the other per-track metadata) prevents the
    // record and replay sides from drifting out of agreement.
    for event in &mut events.seed_trace {
        event.parallel_track_index = Some(track_index);
        event.track_id = Some(track_id.to_string());
    }
    for event in &mut events.realized_rhythm {
        event.parallel_track_index = Some(track_index);
        event.parallel_track_id = Some(track_id.to_string());
    }
}

/// A Track Flow lane advances one lane cycle while each source owns an
/// independent realization-cycle counter. Finalization identities and timing
/// windows must use the lane cycle.
pub(crate) fn retag_track_flow_cycle(events: &mut CyclePlaybackEvents, lane_cycle: u64) {
    for event in &mut events.channel_hocket {
        event.cycle = lane_cycle;
    }
    for event in &mut events.realized_rhythm {
        event.cycle = lane_cycle;
    }
}

/// Map a realized track cycle's queue from local ticks into the reference
/// clock. Note pairs map jointly with guaranteed positive width, and remaining
/// events map alone (audit finding 1 — the local-tempo map rounds each tick
/// independently and dense hits could collapse to note-off-before-note-on).
pub(crate) fn map_parallel_queue_ticks(
    queue: &mut VecDeque<QueuedEvent>,
    cycle_base_tick: u64,
    mapped_cycle_base_tick: u64,
    map: &LocalTempoAutomationMap,
) {
    let reference_limit = map.reference_duration_ticks();
    let mut new_ticks: Vec<Option<u64>> = vec![None; queue.len()];
    let mut open_notes: HashMap<(u8, u8), VecDeque<usize>> = HashMap::new();

    let mut order: Vec<usize> = (0..queue.len()).collect();
    order.sort_by_key(|&index| (queue[index].absolute_tick, queue[index].dispatch_order()));
    for &index in &order {
        let event = &queue[index];
        let local = event.absolute_tick.saturating_sub(cycle_base_tick);
        if is_note_on_event(event) {
            open_notes
                .entry((event.bytes[0] & 0x0F, event.bytes[1]))
                .or_default()
                .push_back(index);
            continue;
        }
        if is_note_off_event(event) {
            let key = (event.bytes[0] & 0x0F, event.bytes[1]);
            if let Some(on_index) = open_notes
                .get_mut(&key)
                .and_then(|pending| pending.pop_front())
            {
                let on_local = queue[on_index]
                    .absolute_tick
                    .saturating_sub(cycle_base_tick);
                let mut on_reference = map.map_local_tick(on_local);
                let mut off_reference = map.map_local_tick(local);
                if local > on_local && off_reference <= on_reference {
                    if on_reference < reference_limit {
                        off_reference = on_reference + 1;
                    } else if reference_limit > 0 {
                        on_reference = reference_limit - 1;
                        off_reference = reference_limit;
                    }
                }
                new_ticks[on_index] = Some(on_reference);
                new_ticks[index] = Some(off_reference);
            } else {
                new_ticks[index] = Some(map.map_local_tick(local));
            }
            continue;
        }
        new_ticks[index] = Some(map.map_local_tick(local));
    }
    for pending in open_notes.values() {
        for &on_index in pending {
            let local = queue[on_index]
                .absolute_tick
                .saturating_sub(cycle_base_tick);
            new_ticks[on_index] = Some(map.map_local_tick(local));
        }
    }

    for (index, tick) in new_ticks.iter().enumerate() {
        if let Some(tick) = tick {
            queue[index].absolute_tick = mapped_cycle_base_tick.saturating_add(*tick);
        }
    }
}

pub(crate) fn queue_sort_key(event: &QueuedEvent) -> (u64, u8) {
    (event.absolute_tick, event.dispatch_order())
}

pub(crate) fn sort_queue(queue: &mut VecDeque<QueuedEvent>) {
    queue.make_contiguous().sort_by_key(queue_sort_key);
}

/// Express an absolute finalized reference tick on the unwrapped local timeline
/// that begins at `origin_cycle`. A deferred note-off can land in a later cycle
/// whose tempo map differs from the originating cycle; extrapolating the first
/// map across the seam is therefore wrong. Walk the actual timing windows and
/// add each completed local-cycle width before inverting inside the containing
/// window. Triggered gaps have no local musical time, so they add no width.
/// When the reference tick lies beyond the last realized window, extrapolate
/// only the final uncovered tail as a render fallback; the exact reference tick
/// remains authoritative in metadata.
pub(crate) fn is_note_off_event(event: &QueuedEvent) -> bool {
    event.len == 3
        && ((event.bytes[0] & 0xF0) == 0x80
            || ((event.bytes[0] & 0xF0) == 0x90 && event.bytes[2] == 0))
}

pub(crate) fn note_pitch(event: &QueuedEvent) -> Option<u8> {
    (event.len >= 2).then_some(event.bytes[1])
}

#[derive(Debug, Clone)]
pub(crate) struct FinalNoteGroup {
    pub(crate) start_tick: u64,
    pub(crate) end_tick: u64,
    pub(crate) output_channel: u8,
    pub(crate) pitch: u8,
    pub(crate) velocity: u8,
    pub(crate) track_id: String,
    pub(crate) track_name: String,
    pub(crate) track_index: usize,
    pub(crate) event_indices: Vec<usize>,
    pub(crate) note_off_event_indices: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct FinalNoteGroupKey {
    start_tick: u64,
    end_tick: u64,
    output_channel: u8,
    pitch: u8,
    track_index: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct ChannelOverlapComponent {
    start_tick: u64,
    output_channel: u8,
    group_indices: Vec<usize>,
}

#[derive(Debug, Clone)]
pub(crate) struct ParallelConflictDecision {
    pub(crate) absolute_tick: u64,
    pub(crate) output_channel: u8,
    pub(crate) pitch: u8,
    pub(crate) start_tick: u64,
    pub(crate) end_tick: u64,
    pub(crate) track_id: String,
    pub(crate) track_name: String,
    pub(crate) track_index: usize,
    pub(crate) conflict_policy: String,
    pub(crate) conflict_action: String,
    pub(crate) conflict_group_id: String,
    pub(crate) colliding_track_ids: Vec<String>,
    pub(crate) active_track_count: usize,
    pub(crate) passed: bool,
}

pub(crate) fn collect_final_note_groups(queue: &VecDeque<QueuedEvent>) -> Vec<FinalNoteGroup> {
    let mut groups = Vec::new();
    let mut pending: HashMap<(usize, u8, u8), VecDeque<usize>> = HashMap::new();
    for (event_index, event) in queue.iter().enumerate() {
        let Some(track_index) = event.parallel_track_index else {
            continue;
        };
        let Some(user_channel) = event.user_channel else {
            continue;
        };
        let Some(pitch) = note_pitch(event) else {
            continue;
        };
        let key = (track_index, user_channel, pitch);
        if is_note_on_event(event) {
            let group_index = groups.len();
            groups.push(FinalNoteGroup {
                start_tick: event.absolute_tick,
                end_tick: event.absolute_tick,
                output_channel: user_channel,
                pitch,
                velocity: event.bytes[2],
                track_id: event
                    .parallel_track_id
                    .clone()
                    .unwrap_or_else(|| format!("track-{track_index}")),
                track_name: event.parallel_track_name.clone().unwrap_or_default(),
                track_index,
                event_indices: vec![event_index],
                note_off_event_indices: Vec::new(),
            });
            pending.entry(key).or_default().push_back(group_index);
        } else if is_note_off_event(event) {
            // LIFO: close the most recently opened note-on for this
            // (track, channel, pitch). For sequential notes this is identical
            // to FIFO; for nested same-pitch/same-channel groups it pairs
            // inner-to-inner instead of swapping their durations.
            if let Some(group_index) = pending.get_mut(&key).and_then(VecDeque::pop_back) {
                let group = &mut groups[group_index];
                group.end_tick = event.absolute_tick;
                group.event_indices.push(event_index);
                group.note_off_event_indices.push(event_index);
            }
        }
    }
    groups
}

pub(crate) fn final_note_group_key(group: &FinalNoteGroup) -> FinalNoteGroupKey {
    FinalNoteGroupKey {
        start_tick: group.start_tick,
        end_tick: group.end_tick,
        output_channel: group.output_channel,
        pitch: group.pitch,
        track_index: group.track_index,
    }
}

pub(crate) fn note_group_span_end(group: &FinalNoteGroup) -> u64 {
    if group.end_tick > group.start_tick {
        group.end_tick
    } else {
        group.start_tick.saturating_add(1)
    }
}

pub(crate) fn channel_overlap_components(
    groups: &[FinalNoteGroup],
) -> Vec<ChannelOverlapComponent> {
    let mut ordered_indices = (0..groups.len()).collect::<Vec<_>>();
    ordered_indices.sort_by_key(|index| {
        let group = &groups[*index];
        (
            group.output_channel,
            group.start_tick,
            note_group_span_end(group),
            group.track_index,
            group.pitch,
        )
    });

    let mut components = Vec::new();
    let mut current_channel = None;
    let mut current_start_tick = 0_u64;
    let mut current_end_tick = 0_u64;
    let mut current_group_indices: Vec<usize> = Vec::new();

    for group_index in ordered_indices {
        let group = &groups[group_index];
        let span_end = note_group_span_end(group);
        let begins_new_component = current_group_indices.is_empty()
            || current_channel != Some(group.output_channel)
            || group.start_tick >= current_end_tick;

        if begins_new_component {
            if let Some(output_channel) = current_channel {
                if !current_group_indices.is_empty() {
                    components.push(ChannelOverlapComponent {
                        start_tick: current_start_tick,
                        output_channel,
                        group_indices: std::mem::take(&mut current_group_indices),
                    });
                }
            }
            current_channel = Some(group.output_channel);
            current_start_tick = group.start_tick;
            current_end_tick = span_end;
        } else {
            current_end_tick = current_end_tick.max(span_end);
        }
        current_group_indices.push(group_index);
    }

    if let Some(output_channel) = current_channel {
        if !current_group_indices.is_empty() {
            components.push(ChannelOverlapComponent {
                start_tick: current_start_tick,
                output_channel,
                group_indices: current_group_indices,
            });
        }
    }

    components
}

/// Overlapping same-channel/same-pitch surviving groups merge into one
/// sustain: a note-off that lands strictly inside another surviving group's
/// span would silence that group early. Instead of dropping such an off (which
/// leaves its note-on permanently unbalanced — the 2026-07-07 stranded-off /
/// hung-note family), DEFER it to the end of the transitive overlap chain: the
/// fixpoint tick no surviving same-pitch span strictly contains. Last-off
/// receivers hear the same merged sustain the drop used to produce, while
/// note-counting receivers now see one off per on. Deferral only ever moves an
/// off forward in time, so already-resolved windows stay valid, and once every
/// off in a chain sits at the chain's end the pass is a no-op (idempotent
/// under incremental re-resolution).
pub(crate) fn defer_premature_same_pitch_note_offs(
    queue: &mut VecDeque<QueuedEvent>,
    groups: &[FinalNoteGroup],
) -> bool {
    let mut spans_by_key: HashMap<(u8, u8), Vec<(u64, u64)>> = HashMap::new();
    for group in groups {
        spans_by_key
            .entry((group.output_channel, group.pitch))
            .or_default()
            .push((group.start_tick, group.end_tick));
    }
    let mut deferred = false;
    for group in groups {
        debug_assert!(group.velocity > 0);
        if group.note_off_event_indices.is_empty() {
            continue;
        }
        let Some(spans) = spans_by_key.get(&(group.output_channel, group.pitch)) else {
            continue;
        };
        // Chase the off tick out of every strictly-spanning span. Each step
        // strictly increases the tick toward the finite maximum end, so this
        // terminates; a span never strictly contains its own end tick, so the
        // group's own span cannot hold the fixpoint back.
        let mut off_tick = group.end_tick;
        loop {
            let Some(next_tick) = spans
                .iter()
                .filter(|(start, end)| *start < off_tick && *end > off_tick)
                .map(|(_, end)| *end)
                .max()
            else {
                break;
            };
            off_tick = next_tick;
        }
        if off_tick == group.end_tick {
            continue;
        }
        for event_index in &group.note_off_event_indices {
            if let Some(event) = queue.get_mut(*event_index) {
                event.absolute_tick = off_tick;
                deferred = true;
            }
        }
    }
    deferred
}

pub(crate) fn remove_queued_event_indices(
    queue: &mut VecDeque<QueuedEvent>,
    indices: &HashSet<usize>,
) {
    if indices.is_empty() {
        return;
    }
    let mut index = 0_usize;
    queue.retain(|_| {
        let keep = !indices.contains(&index);
        index += 1;
        keep
    });
}

pub(crate) fn deterministic_collision_choice(
    start_tick: u64,
    user_channel: u8,
    track_indices: &[usize],
) -> usize {
    let mut value = start_tick
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(u64::from(user_channel).wrapping_mul(0xBF58_476D_1CE4_E5B9));
    value ^= value >> 30;
    value = value.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^= value >> 31;
    track_indices[(value as usize) % track_indices.len()]
}

pub(crate) fn priority_winner(
    track_indices: &[usize],
    tracks: &[ParallelRuntimeTrack],
) -> Option<usize> {
    track_indices.iter().copied().min_by_key(|index| {
        tracks
            .get(*index)
            .map_or(usize::MAX, |track| track.priority_rank)
    })
}

pub(crate) fn track_pair_key(a: usize, b: usize) -> (usize, usize) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

pub(crate) fn channel_logic_key(
    a: usize,
    b: usize,
    output_channel: Option<u8>,
) -> (usize, usize, Option<u8>) {
    let (a, b) = track_pair_key(a, b);
    (a, b, output_channel)
}

pub(crate) fn channel_conflict_policy_label(policy: ChannelConflictPolicy) -> &'static str {
    match policy {
        ChannelConflictPolicy::ForceOn => "forceOn",
        ChannelConflictPolicy::ForceOff => "forceOff",
        ChannelConflictPolicy::AllowAll => "allowAll",
        ChannelConflictPolicy::Or => "or",
        ChannelConflictPolicy::RandomOne => "randomOne",
        ChannelConflictPolicy::Alternate => "alternate",
        ChannelConflictPolicy::PriorityOrder => "priorityOrder",
        ChannelConflictPolicy::Xor => "xor",
        ChannelConflictPolicy::Xnor => "xnor",
        ChannelConflictPolicy::And => "and",
        ChannelConflictPolicy::Nand => "nand",
        ChannelConflictPolicy::Nor => "nor",
        ChannelConflictPolicy::Even => "even",
        ChannelConflictPolicy::Odd => "odd",
        ChannelConflictPolicy::OneHigh => "oneHigh",
        ChannelConflictPolicy::OneLow => "oneLow",
        ChannelConflictPolicy::Majority => "majority",
        ChannelConflictPolicy::Minority => "minority",
    }
}

pub(crate) fn channel_conflict_action_label(
    policy: ChannelConflictPolicy,
    collision_count: usize,
    active_track_count: usize,
    passed: bool,
) -> &'static str {
    if collision_count <= 1 {
        return if passed {
            "single-pass"
        } else {
            "single-suppress"
        };
    }
    match policy {
        ChannelConflictPolicy::ForceOn => "force-on",
        ChannelConflictPolicy::ForceOff => "force-off",
        ChannelConflictPolicy::AllowAll | ChannelConflictPolicy::Or => "allow-all",
        ChannelConflictPolicy::RandomOne => {
            if passed {
                "random-winner"
            } else {
                "random-suppress"
            }
        }
        ChannelConflictPolicy::Alternate => {
            if passed {
                "alternate-winner"
            } else {
                "alternate-suppress"
            }
        }
        ChannelConflictPolicy::PriorityOrder => {
            if passed {
                "priority-winner"
            } else {
                "priority-suppress"
            }
        }
        ChannelConflictPolicy::Xor => "xor-suppress",
        ChannelConflictPolicy::Xnor => {
            if passed {
                "xnor-pass"
            } else {
                "xnor-suppress"
            }
        }
        ChannelConflictPolicy::And => {
            if collision_count == active_track_count && passed {
                "and-consensus"
            } else {
                "and-suppress"
            }
        }
        ChannelConflictPolicy::Nand => {
            if collision_count == active_track_count {
                "nand-suppress"
            } else {
                "nand-pass"
            }
        }
        ChannelConflictPolicy::Nor => "nor-suppress",
        ChannelConflictPolicy::Even => {
            if passed {
                "even-pass"
            } else {
                "even-suppress"
            }
        }
        ChannelConflictPolicy::Odd => {
            if passed {
                "odd-pass"
            } else {
                "odd-suppress"
            }
        }
        ChannelConflictPolicy::OneHigh => {
            if passed {
                "one-high-pass"
            } else {
                "one-high-suppress"
            }
        }
        ChannelConflictPolicy::OneLow => {
            if passed {
                "one-low-pass"
            } else {
                "one-low-suppress"
            }
        }
        ChannelConflictPolicy::Majority => {
            if passed {
                "majority-pass"
            } else {
                "majority-suppress"
            }
        }
        ChannelConflictPolicy::Minority => {
            if passed {
                "minority-pass"
            } else {
                "minority-suppress"
            }
        }
    }
}

pub(crate) fn collision_allowed_tracks(
    policy: ChannelConflictPolicy,
    start_tick: u64,
    user_channel: u8,
    track_indices: &[usize],
    active_track_count: usize,
    tracks: &[ParallelRuntimeTrack],
    // Alternate's rotation index for this collision: its rank among the
    // resolved multi-track collisions on the same (channel, reference cycle),
    // in start order (D2 = Oc1). Stateless — the caller derives it structurally,
    // so it does not depend on realize-window chunking or matrix shape the way
    // the old mutable per-channel counter did.
    alternate_ordinal: usize,
) -> HashSet<usize> {
    let collision_count = track_indices.len();
    if collision_count == 0 {
        return HashSet::new();
    }
    let all = || track_indices.iter().copied().collect::<HashSet<_>>();
    match policy {
        ChannelConflictPolicy::ForceOn
        | ChannelConflictPolicy::AllowAll
        | ChannelConflictPolicy::Or => all(),
        ChannelConflictPolicy::ForceOff => HashSet::new(),
        ChannelConflictPolicy::RandomOne => {
            if collision_count == 1 {
                all()
            } else {
                HashSet::from([deterministic_collision_choice(
                    start_tick,
                    user_channel,
                    track_indices,
                )])
            }
        }
        ChannelConflictPolicy::Alternate => {
            if collision_count == 1 {
                all()
            } else {
                HashSet::from([track_indices[alternate_ordinal % collision_count]])
            }
        }
        ChannelConflictPolicy::PriorityOrder => priority_winner(track_indices, tracks)
            .map(|winner| HashSet::from([winner]))
            .unwrap_or_default(),
        ChannelConflictPolicy::Xor => {
            if collision_count == 1 {
                all()
            } else {
                HashSet::new()
            }
        }
        ChannelConflictPolicy::Xnor => {
            if collision_count >= 2 {
                all()
            } else {
                HashSet::new()
            }
        }
        ChannelConflictPolicy::And => {
            if collision_count == active_track_count {
                all()
            } else {
                HashSet::new()
            }
        }
        ChannelConflictPolicy::Nand => {
            if collision_count == active_track_count {
                HashSet::new()
            } else {
                all()
            }
        }
        ChannelConflictPolicy::Nor => HashSet::new(),
        ChannelConflictPolicy::Even => {
            if collision_count % 2 == 0 {
                all()
            } else {
                HashSet::new()
            }
        }
        ChannelConflictPolicy::Odd => {
            if collision_count % 2 == 1 {
                all()
            } else {
                HashSet::new()
            }
        }
        ChannelConflictPolicy::OneHigh => {
            if collision_count == 1 {
                all()
            } else {
                HashSet::new()
            }
        }
        ChannelConflictPolicy::OneLow => {
            if active_track_count.saturating_sub(collision_count) == 1 {
                all()
            } else {
                HashSet::new()
            }
        }
        ChannelConflictPolicy::Majority => {
            if collision_count.saturating_mul(2) > active_track_count {
                all()
            } else {
                HashSet::new()
            }
        }
        ChannelConflictPolicy::Minority => {
            if collision_count.saturating_mul(2) < active_track_count {
                all()
            } else {
                HashSet::new()
            }
        }
    }
}

/// Resolve which tracks in one same-channel overlap component survive.
///
/// Returns `(allowed, ruled)`: the surviving track set, and the subset of the
/// component's tracks that an EXPLICIT channel-logic rule spoke to (used by the
/// caller to label each track's decision — a track is `channelLogicMatrix` only
/// when a rule actually governed it, not merely because the project has a rule
/// somewhere).
///
/// Composition (spec §5, D1 = O3):
///   S0     = the project default evaluated GROUP-WISE over the whole component
///            with the true audible-track denominator — ALWAYS, matrix or not.
///   rules  = for each unordered component pair with an explicit entry
///            (exact (a,b,channel) → else legacy (a,b,null); unmatched pairs are
///            NOT evaluated, so they never degrade the default), evaluate that
///            entry pairwise; a member the pair passes is RESCUED, one it fails
///            is VETOED.
///   S      = (S0 ∪ rescued) − vetoed        (veto dominates rescue).
///
/// This keeps every group-wise default guarantee for unruled tracks (so an
/// empty matrix is indistinguishable from a matrix of irrelevant rules — the
/// old "pairwise cliff" is gone), while an explicit rule stays authoritative for
/// its pair: it can rescue a pair the default suppressed (e.g. `Layer` under an
/// `xor` default) or veto a track the default allowed.
pub(crate) fn matrix_allowed_tracks(
    start_tick: u64,
    user_channel: u8,
    track_indices: &[usize],
    config: &ParallelRuntimeConfig,
    alternate_ordinal: usize,
) -> (HashSet<usize>, HashSet<usize>) {
    let base = collision_allowed_tracks(
        config.channel_conflict_policy,
        start_tick,
        user_channel,
        track_indices,
        config.conflict_active_track_count(),
        &config.tracks,
        alternate_ordinal,
    );
    if config.channel_logic_matrix.is_empty() || track_indices.len() <= 1 {
        return (base, HashSet::new());
    }

    let mut rescued: HashSet<usize> = HashSet::new();
    let mut vetoed: HashSet<usize> = HashSet::new();
    let mut ruled: HashSet<usize> = HashSet::new();
    for (left_position, left) in track_indices.iter().copied().enumerate() {
        for right in track_indices.iter().copied().skip(left_position + 1) {
            let Some(policy) = config
                .channel_logic_matrix
                .get(&channel_logic_key(left, right, Some(user_channel)))
                .or_else(|| {
                    config
                        .channel_logic_matrix
                        .get(&channel_logic_key(left, right, None))
                })
                .copied()
            else {
                continue;
            };
            let pair = [left, right];
            let pair_allowed = collision_allowed_tracks(
                policy,
                start_tick,
                user_channel,
                &pair,
                2,
                &config.tracks,
                alternate_ordinal,
            );
            for member in pair {
                ruled.insert(member);
                if pair_allowed.contains(&member) {
                    rescued.insert(member);
                } else {
                    vetoed.insert(member);
                }
            }
        }
    }

    let allowed = base
        .into_iter()
        .chain(rescued)
        .filter(|track| !vetoed.contains(track))
        .collect();
    (allowed, ruled)
}

pub(crate) fn apply_parallel_channel_conflicts_for_keys(
    queue: &mut VecDeque<QueuedEvent>,
    config: &mut ParallelRuntimeConfig,
    only_keys: Option<&HashSet<FinalNoteGroupKey>>,
) -> Vec<ParallelConflictDecision> {
    sort_queue(queue);
    let mut groups = collect_final_note_groups(queue);
    if groups.is_empty() {
        return Vec::new();
    }

    let mut remove_event_indices = HashSet::new();
    let mut decisions = Vec::new();
    // Count-based policies and reported metadata must use the number of tracks
    // that can actually contribute audible note groups. Silent sources never do,
    // so excluding them keeps a muted source from changing audible conflict math.
    let conflict_active_count = config.conflict_active_track_count();
    let reference_tpc = config.reference_ticks_per_cycle();
    let dispatch_horizon = config.dispatch_horizon_tick;
    if conflict_active_count > 1 {
        for component in channel_overlap_components(&groups) {
            if only_keys.is_some_and(|keys| {
                !component
                    .group_indices
                    .iter()
                    .any(|group_index| keys.contains(&final_note_group_key(&groups[*group_index])))
            }) {
                continue;
            }
            // R9 guard: a component that starts at or behind the playhead may
            // already have its note-ons on the wire; re-resolving it here could
            // suppress a group whose on already sounded, stranding the note.
            // Leave already-dispatched components exactly as first resolved.
            // (`dispatch_horizon == 0` — tests and Play init — disables the guard.)
            if dispatch_horizon > 0 && component.start_tick < dispatch_horizon {
                continue;
            }
            let mut by_track: HashMap<usize, Vec<usize>> = HashMap::new();
            for group_index in &component.group_indices {
                let group = &groups[*group_index];
                by_track
                    .entry(group.track_index)
                    .or_default()
                    .push(*group_index);
            }
            let mut track_indices = by_track.keys().copied().collect::<Vec<_>>();
            track_indices.sort_unstable();
            let collision_count = track_indices.len();
            // Alternate rotation index (D2 = Oc1): this collision's rank among the
            // resolved multi-track collisions on the same (channel, reference cycle),
            // in start order. Derived from structure, so it is independent of matrix
            // shape and (for in-order arrival) of realize windowing.
            let ordinal_key = (
                component.output_channel,
                component.start_tick / reference_tpc,
            );
            let alternate_ordinal = config
                .alternate_resolved
                .get(&ordinal_key)
                .map_or(0, |resolved| resolved.range(..component.start_tick).count());
            let (allowed, ruled) = matrix_allowed_tracks(
                component.start_tick,
                component.output_channel,
                &track_indices,
                config,
                alternate_ordinal,
            );
            // Remember this collision so later collisions on the same
            // (channel, cycle) rotate past it. Every multi-track component counts
            // as one collision regardless of the policy that resolved it. Inserting
            // a known start is a no-op, so incremental re-resolution never
            // double-advances the rotation.
            if collision_count >= 2 {
                config
                    .alternate_resolved
                    .entry(ordinal_key)
                    .or_default()
                    .insert(component.start_tick);
            }
            let should_log = config.channel_conflict_policy != ChannelConflictPolicy::AllowAll
                || collision_count > 1
                || !ruled.is_empty();
            let conflict_group_id =
                format!("{}:{}", component.start_tick, component.output_channel);
            let colliding_track_ids = track_indices
                .iter()
                .map(|index| {
                    config
                        .tracks
                        .get(*index)
                        .map_or_else(|| format!("track-{index}"), |track| track.id.clone())
                })
                .collect::<Vec<_>>();
            for (track_index, group_indices) in &by_track {
                let passed = allowed.contains(track_index);
                // A track is labeled `channelLogicMatrix` only when an explicit
                // rule actually governed it (rescued or vetoed it); tracks the
                // group-wise default alone decided keep the default's own label.
                let is_ruled = ruled.contains(track_index);
                let action = if is_ruled {
                    if passed {
                        "matrix-pass"
                    } else {
                        "matrix-suppress"
                    }
                } else {
                    channel_conflict_action_label(
                        config.channel_conflict_policy,
                        collision_count,
                        conflict_active_count,
                        passed,
                    )
                };
                let metadata = ParallelConflictMetadata {
                    policy: if is_ruled {
                        "channelLogicMatrix".to_string()
                    } else {
                        channel_conflict_policy_label(config.channel_conflict_policy).to_string()
                    },
                    action: action.to_string(),
                    group_id: conflict_group_id.clone(),
                };
                for group_index in group_indices {
                    let group = &groups[*group_index];
                    if should_log {
                        decisions.push(ParallelConflictDecision {
                            absolute_tick: group.start_tick,
                            output_channel: group.output_channel,
                            pitch: group.pitch,
                            start_tick: group.start_tick,
                            end_tick: group.end_tick,
                            track_id: group.track_id.clone(),
                            track_name: group.track_name.clone(),
                            track_index: *track_index,
                            conflict_policy: metadata.policy.clone(),
                            conflict_action: metadata.action.clone(),
                            conflict_group_id: metadata.group_id.clone(),
                            colliding_track_ids: colliding_track_ids.clone(),
                            active_track_count: conflict_active_count,
                            passed,
                        });
                    }
                    for event_index in &group.event_indices {
                        if let Some(event) = queue.get_mut(*event_index) {
                            event.parallel_conflict = should_log.then(|| metadata.clone());
                        }
                        if !passed {
                            remove_event_indices.insert(*event_index);
                        }
                    }
                }
            }
        }
    }

    if !remove_event_indices.is_empty() {
        remove_queued_event_indices(queue, &remove_event_indices);
        sort_queue(queue);
        groups = collect_final_note_groups(queue);
    }

    // Bound the Alternate rotation memory: keep only the most recent few cycles.
    // Old cycles never resolve again (their groups are dispatched and gone), so
    // their rotation ranks are dead weight. Horizon-independent so it also bounds
    // long test/fuzz runs that leave `dispatch_horizon_tick` at 0.
    if let Some(max_cycle) = config
        .alternate_resolved
        .keys()
        .map(|(_, cycle)| *cycle)
        .max()
    {
        let floor = max_cycle.saturating_sub(2);
        if floor > 0 {
            config
                .alternate_resolved
                .retain(|(_, cycle), _| *cycle >= floor);
        }
    }

    if defer_premature_same_pitch_note_offs(queue, &groups) {
        sort_queue(queue);
    }
    decisions
}

pub(crate) fn parallel_note_group_keys(
    queue: &VecDeque<QueuedEvent>,
) -> HashSet<FinalNoteGroupKey> {
    collect_final_note_groups(queue)
        .into_iter()
        .map(|group| final_note_group_key(&group))
        .collect()
}

/// Hard memory ceiling on retained `ResolvedCycle`s per source track. This is a
/// safety bound only; the real retention is decided by a reference-tick floor
/// after followers compile (see the prune at the end of `realize_parallel_until`)
/// so that a single lookahead window — which may contain far more than this many
/// tiny source cycles against a long reference cycle — is never truncated before
/// the followers that consume it have run.
pub(crate) const SOURCE_RESOLVED_CEILING: usize = 8192;

pub(crate) fn realize_parallel_until(
    config: &mut ParallelRuntimeConfig,
    target_tick: u64,
    queue: &mut VecDeque<QueuedEvent>,
) -> Result<CyclePlaybackEvents, TransportError> {
    let mut playback_events = empty_cycle_playback_events();
    let mut batch = VecDeque::new();
    let reference_tempo_bpm = config.reference_tempo_bpm;
    let reference_tpc = config.reference_ticks_per_cycle();
    let source_ids = config.trigger_source_ids();
    // The largest `afterEventTicks` offset among followers; a source event up to
    // this far before the next window start can still produce a future launch,
    // so retained history must cover it. Weighted START options are launch
    // alignments too, so they participate in the same look-back bound.
    let max_after_event_ticks = config
        .tracks
        .iter()
        .filter_map(|track| track.triggered.as_ref())
        .map(|triggered| trigger_max_after_event_ticks(&triggered.config))
        .max()
        .unwrap_or(0);

    // PASS A — continuous tracks realize exactly as before, but across the rayon
    // pool: each track's realization is fully independent (its own score/rhythm
    // RNG state, its own queue), so we realize in parallel and then merge the
    // per-track results into the shared batch/playback_events in deterministic
    // track order. The ordered merge + the conflict/hocket/finalize pass below
    // stay sequential, so the dispatched output is identical to the serial
    // version. For tracks that are a trigger source we additionally capture each
    // realized cycle's resolved structure (in reference ticks) so followers
    // observe what was scheduled.
    let pass_a = config
        .tracks
        .par_iter_mut()
        .enumerate()
        .map(|(track_index, track)| {
            let mut local_batch: VecDeque<QueuedEvent> = VecDeque::new();
            let mut local_events = empty_cycle_playback_events();
            // Triggered followers (PASS B) and the Track Flow lane (PASS C)
            // realize on their own; PASS A handles only continuous tracks.
            if track.triggered.is_some() || track.track_flow.is_some() {
                return Ok((local_batch, local_events));
            }
            let track_tpc = ticks_per_cycle(&track.score);
            if track_tpc == 0 {
                return Ok((local_batch, local_events));
            }
            let capture_source = source_ids.contains(&track.id);
            let is_silent = track.silent;
            while track.realized_up_to_reference_tick < target_tick {
                let track_cycle = track.realized_up_to_cycle;
                let cycle_base_tick = track_cycle.saturating_mul(track_tpc);
                let mapped_cycle_base_tick = track.realized_up_to_reference_tick;
                let tempo_map = LocalTempoAutomationMap::from_cycle(
                    &track.score,
                    track.rhythm.as_ref(),
                    track_cycle,
                    track_tpc,
                    reference_tempo_bpm,
                    track.tempo_bpm,
                );
                let mapped_cycle_duration = tempo_map.reference_duration_ticks();
                let mut track_queue = VecDeque::new();
                let track_id_for_seed_path = track.id.clone();
                let mut events = realize_and_enqueue_with_time(
                    &mut track.score,
                    track_cycle,
                    cycle_base_tick,
                    &mut track_queue,
                    track.rhythm.as_mut(),
                    Some(track_id_for_seed_path.as_str()),
                )
                .map_err(|error| {
                    TransportError::Realize(format!(
                        "parallel track {} cycle {}: {error}",
                        track.id, track_cycle
                    ))
                })?;
                let captured = events.resolved_cycle.take();
                // A silent source realizes only to capture its resolved
                // structure; its MIDI is suppressed (no merge, no conflict
                // participation, no playback metadata) so a muted track can
                // still drive followers without being heard.
                if !is_silent {
                    map_parallel_queue_ticks(
                        &mut track_queue,
                        cycle_base_tick,
                        mapped_cycle_base_tick,
                        &tempo_map,
                    );
                    tag_parallel_playback_events(&mut events, track_index, &track.id, &track.name);
                    local_batch.extend(track_queue.into_iter().map(|event| {
                        event.with_parallel_track(track_index, &track.id, &track.name)
                    }));
                    append_cycle_playback_events(&mut local_events, events);
                }
                if capture_source {
                    if let Some(cap) = captured {
                        let local = cseq_trigger::resolve_cycle_from_spans(
                            &cap.pulse_spans,
                            &cap.note_groups,
                            cap.cycle_beats,
                            track_cycle,
                            PPQN as u64,
                        );
                        let reference = local.remap_to_reference(mapped_cycle_base_tick, |t| {
                            tempo_map.map_local_tick(t)
                        });
                        // Do NOT evict here: PASS B must see every source cycle
                        // realized for this window. Pruning happens after PASS B.
                        track.recent_resolved.push_back(reference);
                    }
                }
                track.realized_up_to_cycle = track.realized_up_to_cycle.saturating_add(1);
                track.realized_up_to_reference_tick =
                    mapped_cycle_base_tick.saturating_add(mapped_cycle_duration);
                track.timing_windows.push_back(ParallelTrackTimingWindow {
                    cycle: track_cycle,
                    reference_start_tick: mapped_cycle_base_tick,
                    reference_end_tick: track.realized_up_to_reference_tick,
                    local_ticks_per_cycle: track_tpc,
                    tempo_map,
                });
            }
            Ok((local_batch, local_events))
        })
        .collect::<Result<Vec<(VecDeque<QueuedEvent>, CyclePlaybackEvents)>, TransportError>>()?;
    // Deterministic merge: track order, cycles within a track already ordered.
    for (local_batch, local_events) in pass_a {
        batch.extend(local_batch);
        append_cycle_playback_events(&mut playback_events, local_events);
    }

    // PASS C — one sequential lane per Track Flow box. Each box is one
    // participant in `config.tracks`; each cycle it Markov-chooses one member
    // source track and realizes that source's next cycle under the box's
    // *conflict* identity (`track-flow-<boxId>`) and a composite
    // `track-flow-<boxId>:<sourceId>` *seed-path* identity, while recording the
    // authored source for *display*. Member sources are not separate
    // participants, so they cost nothing while unselected. Boxes are mutually
    // independent (separate sources/resolvers/clocks); this loop merges them in
    // runtime participant index order, which keeps the dispatched output
    // deterministic (the determinism requirement for the rayon-parallelizable
    // per-box work). Each box ⇒ sequential, like PASS B.
    for (track_index, track) in config.tracks.iter_mut().enumerate() {
        let ParallelRuntimeTrack {
            id: lane_id,
            name: lane_name,
            track_flow,
            realized_up_to_cycle,
            realized_up_to_reference_tick,
            timing_windows,
            ..
        } = track;
        let Some(flow) = track_flow.as_mut() else {
            continue;
        };
        if flow.sources.is_empty() {
            continue;
        }
        // The box id is fixed for the whole lane; capture it before the per-cycle
        // mutable borrow of `flow.sources` so seed-path construction is clean.
        let box_id = flow.box_id.clone();
        while *realized_up_to_reference_tick < target_tick {
            let choice = flow.resolver.next_choice();
            let source_index = (choice.state as usize).min(flow.sources.len() - 1);
            let lane_cycle = flow.cycle_index;
            let source = &mut flow.sources[source_index];
            let source_tpc = ticks_per_cycle(&source.score);
            if source_tpc == 0 {
                // Degenerate source score: advance the lane clock so we never spin.
                *realized_up_to_reference_tick = target_tick;
                break;
            }
            let source_cycle = source.realized_cycle;
            let cycle_base_tick = source_cycle.saturating_mul(source_tpc);
            let mapped_cycle_base_tick = *realized_up_to_reference_tick;
            let tempo_map = LocalTempoAutomationMap::from_cycle(
                &source.score,
                source.rhythm.as_ref(),
                source_cycle,
                source_tpc,
                reference_tempo_bpm,
                source.tempo_bpm,
            );
            let mapped_cycle_duration = tempo_map.reference_duration_ticks();
            let mut track_queue = VecDeque::new();
            let seed_path_id = trackflow::seed_path_id(&box_id, &source.id);
            let mut events = realize_and_enqueue_with_identities(
                &mut source.score,
                source_cycle,
                cycle_base_tick,
                &mut track_queue,
                source.rhythm.as_mut(),
                Some(seed_path_id.as_str()),
                Some(source.id.as_str()),
            )
            .map_err(|error| {
                TransportError::Realize(format!(
                    "track flow source {} cycle {}: {error}",
                    source.id, source_cycle
                ))
            })?;
            // The lane is not a trigger source in v1.
            let _ = events.resolved_cycle.take();
            map_parallel_queue_ticks(
                &mut track_queue,
                cycle_base_tick,
                mapped_cycle_base_tick,
                &tempo_map,
            );
            retag_track_flow_cycle(&mut events, lane_cycle);
            tag_parallel_playback_events(&mut events, track_index, lane_id, lane_name);
            // Seed-path replay keys on the composite `track-flow-main:<sourceId>`
            // identity (the same id `realize_and_enqueue` resolved against), NOT
            // the bare lane id — so a re-recorded seed path round-trips and never
            // collides with the source track's ordinary parallel identity. The
            // other overlays stay tagged with the lane (they display under the
            // lane row).
            for event in &mut events.seed_trace {
                event.track_id = Some(seed_path_id.clone());
            }
            events.track_flow.push(TrackFlowPlaybackEvent {
                cycle: lane_cycle,
                reference_start_tick: mapped_cycle_base_tick,
                lane_id: lane_id.clone(),
                source_track_id: source.id.clone(),
                source_track_name: source.name.clone(),
            });
            batch.extend(
                track_queue
                    .into_iter()
                    .map(|event| event.with_parallel_track(track_index, lane_id, lane_name)),
            );
            append_cycle_playback_events(&mut playback_events, events);
            source.realized_cycle = source.realized_cycle.saturating_add(1);
            *realized_up_to_cycle = realized_up_to_cycle.saturating_add(1);
            *realized_up_to_reference_tick =
                mapped_cycle_base_tick.saturating_add(mapped_cycle_duration);
            timing_windows.push_back(ParallelTrackTimingWindow {
                cycle: lane_cycle,
                reference_start_tick: mapped_cycle_base_tick,
                reference_end_tick: *realized_up_to_reference_tick,
                local_ticks_per_cycle: source_tpc,
                tempo_map,
            });
            flow.cycle_index = flow.cycle_index.saturating_add(1);
        }
    }

    // PASS B — triggered followers. Sources are guaranteed continuous (v1
    // one-level rule), so their resolved cycles are all captured above. Snapshot
    // them into an owned map to avoid aliasing the mutable follower iteration.
    let source_resolved: HashMap<String, Vec<cseq_trigger::ResolvedCycle>> = config
        .tracks
        .iter()
        .filter(|track| source_ids.contains(&track.id))
        .map(|track| {
            (
                track.id.clone(),
                track.recent_resolved.iter().cloned().collect(),
            )
        })
        .collect();
    let empty_source: Vec<cseq_trigger::ResolvedCycle> = Vec::new();
    for (track_index, track) in config.tracks.iter_mut().enumerate() {
        let Some(source_id) = track
            .triggered
            .as_ref()
            .map(|t| t.config.source_track_id.clone())
        else {
            continue;
        };
        let source_cycles = source_resolved.get(&source_id).unwrap_or(&empty_source);
        realize_triggered_follower(
            track,
            track_index,
            source_cycles,
            target_tick,
            reference_tempo_bpm,
            &mut batch,
            &mut playback_events,
        )?;
    }

    // Now that every follower has compiled from the full window, prune retained
    // source resolution. Keep any cycle whose end is within
    // `reference_tpc + max_after_event_ticks` of the current target: a future
    // window starts at `target`, future-only drops launches before it, and the
    // largest look-back is one reference beat (alignment) or `afterEventTicks`.
    // Cycles entirely older than that can never produce a future launch.
    let prune_guard = reference_tpc.saturating_add(max_after_event_ticks);
    let prune_floor = target_tick.saturating_sub(prune_guard);
    for track in &mut config.tracks {
        if track.recent_resolved.is_empty() {
            continue;
        }
        track
            .recent_resolved
            .retain(|cycle| cycle.end_tick >= prune_floor);
        while track.recent_resolved.len() > SOURCE_RESOLVED_CEILING {
            track.recent_resolved.pop_front();
        }
    }

    if !batch.is_empty() {
        let resolve_keys = parallel_note_group_keys(&batch);
        queue.extend(batch);
        let decisions =
            apply_parallel_channel_conflicts_for_keys(queue, config, Some(&resolve_keys));
        // Conflict resolution removes suppressed note groups from the dispatched
        // MIDI queue. Flag the matching timeline metadata as suppressed so the
        // UI can ghost those notes (and warn on the owning track) instead of
        // drawing them as if they were played. The metadata is in each track's
        // local-cycle ticks while decisions are in reference ticks, so we map
        // each metadata event's local start forward through the same per-cycle
        // tempo map that produced the queue and compare against the decision.
        flag_suppressed_playback_metadata(&mut playback_events, &decisions, config);
        playback_events.parallel_conflict.extend(decisions);
        sort_queue(queue);
    }
    prune_parallel_timing_windows(config);

    Ok(playback_events)
}

pub(crate) fn prune_parallel_timing_windows(config: &mut ParallelRuntimeConfig) {
    for track in &mut config.tracks {
        while track.timing_windows.len() > 8 {
            track.timing_windows.pop_front();
        }
    }
}

/// Realize one triggered follower's launches for the lookahead window.
///
/// 1. Compile the follower's launches for `[realized_up_to_reference_tick,
///    target_tick)` from the source's resolved cycles (the single source of
///    truth, C2), threading the carry (C5).
/// 2. Realize launch cycles from the persistent cursor up to `target_tick`,
///    placing follower cycles by accumulating each cycle's actual mapped
///    reference duration.
///    A launch's not-yet-realized cycles are truncated when a later launch
///    starts earlier (restart/next takes over) — finalized cycles are never
///    touched (future-only, C6). Cycles past `target_tick` defer to the next
///    window via the cursor.
///
/// The follower's events flow into the same `batch` and conflict/hocket path as
/// any track; nothing downstream knows triggering happened.
#[allow(clippy::too_many_arguments)]
pub(crate) fn realize_triggered_follower(
    track: &mut ParallelRuntimeTrack,
    track_index: usize,
    source_cycles: &[cseq_trigger::ResolvedCycle],
    target_tick: u64,
    reference_tempo_bpm: f32,
    batch: &mut VecDeque<QueuedEvent>,
    playback_events: &mut CyclePlaybackEvents,
) -> Result<(), TransportError> {
    // Disjoint mutable field borrows so the follower's phrase score, rhythm,
    // timing windows, and cursor can all be touched in one pass.
    let ParallelRuntimeTrack {
        id,
        name,
        rhythm,
        tempo_bpm,
        realized_up_to_reference_tick,
        timing_windows,
        triggered,
        ..
    } = track;
    let Some(triggered) = triggered.as_mut() else {
        return Ok(());
    };
    let phrase_local_tpc = triggered.phrase_local_tpc;
    if phrase_local_tpc == 0 {
        // Degenerate follower score: re-arm without emitting (no divide-by-zero).
        *realized_up_to_reference_tick = target_tick;
        return Ok(());
    }
    let window = cseq_trigger::TickWindow {
        start: *realized_up_to_reference_tick,
        end: target_tick,
    };
    if window.start >= window.end {
        return Ok(());
    }

    // Reference duration of one follower phrase; a representative cycle is exact
    // for placement math.
    let repr_cycle = triggered.carry.next_local_cycle_index;
    let repr_map = LocalTempoAutomationMap::from_cycle(
        &triggered.phrase_score,
        rhythm.as_ref(),
        repr_cycle,
        phrase_local_tpc,
        reference_tempo_bpm,
        *tempo_bpm,
    );
    let phrase_reference_ticks = repr_map.reference_duration_ticks().max(1);

    let ctx = cseq_trigger::EvalContext {
        ticks_per_reference_beat: PPQN as u64,
    };
    let follower_spec = cseq_trigger::FollowerSpec {
        phrase_reference_ticks,
        phrase_reference_ticks_for_cycle: None,
    };
    let carry_in = std::mem::take(&mut triggered.carry);
    let compiled = {
        let duration_for_cycle = |local_cycle_index: u64| {
            LocalTempoAutomationMap::from_cycle(
                &triggered.phrase_score,
                rhythm.as_ref(),
                local_cycle_index,
                phrase_local_tpc,
                reference_tempo_bpm,
                *tempo_bpm,
            )
            .reference_duration_ticks()
            .max(1)
        };
        let exact_follower_spec = cseq_trigger::FollowerSpec {
            phrase_reference_ticks: follower_spec.phrase_reference_ticks,
            phrase_reference_ticks_for_cycle: Some(&duration_for_cycle),
        };
        cseq_trigger::compile_window(
            &triggered.config,
            source_cycles,
            window,
            &exact_follower_spec,
            &ctx,
            carry_in,
        )
    };
    triggered.carry = compiled.carry_out;
    triggered.launches.extend(compiled.launches);

    // Surface the trigger decision trace: a by-product of the same pure compile,
    // so the event log can never disagree with the realized launches. The
    // trigger-domain seed lineage below is display-only for the GATE seed; replay
    // stability comes from identity seeding inside `cseq_trigger` (GATE and
    // weighted START), not from this ring. A full trigger replay override is a
    // later seed-path phase.
    if !compiled.decisions.is_empty() {
        if let Some(gate) = triggered.config.gate.as_ref() {
            let lineage_cycle = compiled.decisions[0].source_cycle_index;
            playback_events
                .seed_trace
                .push(playback_seed_trace_for_trigger(
                    lineage_cycle,
                    gate.seed,
                    track_index,
                    id.as_str(),
                ));
        }
        for decision in &compiled.decisions {
            playback_events
                .trigger_decisions
                .push(trigger_decision_event(
                    track_index,
                    id.as_str(),
                    name.as_str(),
                    decision,
                ));
        }
    }

    // Realize launch cycles from the cursor.
    loop {
        let Some(launch) = triggered.launches.get(triggered.next_launch_idx).copied() else {
            break;
        };
        // Starting a launch fresh: anchor the accumulating reference cursor at
        // the launch tick (beat 0). Resuming a deferred launch keeps the
        // persisted, already-accumulated cursor.
        if triggered.next_cycle_in_launch == 0 {
            triggered.next_cycle_reference_tick = launch.reference_start_tick;
        }
        let next_launch_start = triggered
            .launches
            .get(triggered.next_launch_idx + 1)
            .map(|l| l.reference_start_tick);
        let mut deferred = false;
        while triggered.next_cycle_in_launch < launch.local_cycle_count {
            let k = triggered.next_cycle_in_launch;
            let cycle_ref_start = triggered.next_cycle_reference_tick;
            // A later launch starting at/before this cycle truncates the rest of
            // this (not-yet-realized) launch: restart/next supersedes.
            if next_launch_start.is_some_and(|ns| cycle_ref_start >= ns) {
                break;
            }
            // Cycles past the window defer to the next call (cursor preserved).
            if cycle_ref_start >= target_tick {
                deferred = true;
                break;
            }
            let local_cycle_index = launch.first_local_cycle_index.saturating_add(u64::from(k));
            let cycle_base_tick = local_cycle_index.saturating_mul(phrase_local_tpc);
            let tempo_map = LocalTempoAutomationMap::from_cycle(
                &triggered.phrase_score,
                rhythm.as_ref(),
                local_cycle_index,
                phrase_local_tpc,
                reference_tempo_bpm,
                *tempo_bpm,
            );
            let mapped_cycle_duration = tempo_map.reference_duration_ticks();
            let mut track_queue = VecDeque::new();
            let mut events = realize_and_enqueue_with_time(
                &mut triggered.phrase_score,
                local_cycle_index,
                cycle_base_tick,
                &mut track_queue,
                rhythm.as_mut(),
                Some(id.as_str()),
            )
            .map_err(|error| {
                TransportError::Realize(format!(
                    "triggered track {id} launch cycle {local_cycle_index}: {error}"
                ))
            })?;
            events.resolved_cycle = None;
            map_parallel_queue_ticks(
                &mut track_queue,
                cycle_base_tick,
                cycle_ref_start,
                &tempo_map,
            );
            tag_parallel_playback_events(&mut events, track_index, id, name);
            batch.extend(
                track_queue
                    .into_iter()
                    .map(|event| event.with_parallel_track(track_index, id, name)),
            );
            append_cycle_playback_events(playback_events, events);
            timing_windows.push_back(ParallelTrackTimingWindow {
                cycle: local_cycle_index,
                reference_start_tick: cycle_ref_start,
                reference_end_tick: cycle_ref_start.saturating_add(mapped_cycle_duration),
                local_ticks_per_cycle: phrase_local_tpc,
                tempo_map,
            });
            // Advance the cursor by the ACTUAL mapped duration of this cycle, so
            // the next cycle of a multi-pass run starts where this one truly
            // ends (not at a fixed nominal step).
            triggered.next_cycle_reference_tick =
                cycle_ref_start.saturating_add(mapped_cycle_duration);
            triggered.next_cycle_in_launch += 1;
        }
        if deferred {
            break;
        }
        // Launch fully realized or truncated: advance to the next launch.
        triggered.next_launch_idx += 1;
        triggered.next_cycle_in_launch = 0;
    }

    // Drop the fully-realized launch prefix to bound memory; the current
    // (partially realized) launch, if any, becomes index 0.
    if triggered.next_launch_idx > 0 {
        triggered.launches.drain(0..triggered.next_launch_idx);
        triggered.next_launch_idx = 0;
    }
    *realized_up_to_reference_tick = target_tick;
    Ok(())
}

/// Mark channel metadata whose note group was removed by
/// parallel channel-conflict resolution. Keyed by `(track_index, reference
/// start tick)`; reference ticks are derived from each track's local-cycle
/// metadata via the same forward tempo map used to build the merged queue, so
/// no inverse-map rounding is involved. A 1-tick tolerance absorbs the rounding
/// already baked into `map_local_tick`.
pub(crate) fn flag_suppressed_playback_metadata(
    events: &mut CyclePlaybackEvents,
    decisions: &[ParallelConflictDecision],
    config: &ParallelRuntimeConfig,
) {
    let suppressed: HashSet<(usize, u64)> = decisions
        .iter()
        .filter(|decision| !decision.passed)
        .map(|decision| (decision.track_index, decision.start_tick))
        .collect();
    if suppressed.is_empty() {
        return;
    }

    // (track_index, local_cycle) -> (reference_start_tick, tempo_map)
    let mut windows: HashMap<(usize, u64), &ParallelTrackTimingWindow> = HashMap::new();
    for (track_index, track) in config.tracks.iter().enumerate() {
        for window in &track.timing_windows {
            windows.insert((track_index, window.cycle), window);
        }
    }

    // Forward-map a metadata event's local-cycle start tick into the reference
    // clock (the same space the conflict decisions use) and test membership in
    // the suppressed set. The ±1 tolerance absorbs `map_local_tick` rounding.
    let is_suppressed = |track_index: Option<usize>, cycle: u64, local_start: u64| -> bool {
        let Some(ti) = track_index else {
            return false;
        };
        let Some(window) = windows.get(&(ti, cycle)).copied() else {
            return false;
        };
        let reference = window
            .reference_start_tick
            .saturating_add(window.tempo_map.map_local_tick(local_start));
        suppressed.contains(&(ti, reference))
            || suppressed.contains(&(ti, reference.saturating_sub(1)))
            || suppressed.contains(&(ti, reference.saturating_add(1)))
    };

    for event in &mut events.channel_hocket {
        event.suppressed = is_suppressed(event.parallel_track_index, event.cycle, event.start_tick);
    }
}

#[cfg(test)]
mod triggered_integration_tests;
