#[allow(unused_imports)]
use crate::*;

#[derive(Debug, Clone)]
pub(crate) struct NoteLeaf {
    pub(crate) node_id: u64,
    pub(crate) offset: Rational,
    pub(crate) pitch: u8,
    pub(crate) velocity: u8,
}

#[derive(Debug, Clone)]
pub(crate) struct RhythmOverlayEvent {
    offset: Rational,
    kind: EventKind,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct RhythmOverlayResult {
    pub(crate) events: Vec<RhythmOverlayEvent>,
    /// The realized rhythm spans (pattern/cells per span id) for this cycle — the
    /// same resolution that drives the audio. Surfaced so the live timeline rhythm
    /// row renders realized truth instead of a separate preview resolution.
    pub(crate) resolved_spans: Vec<cseq_rhythm::ResolvedRhythmSpan>,
}

pub(crate) struct CyclePlaybackEvents {
    pub(crate) channel_hocket: Vec<ChannelHocketPlaybackEvent>,
    pub(crate) seed_trace: Vec<PlaybackSeedTraceEvent>,
    pub(crate) parallel_conflict: Vec<ParallelConflictDecision>,
    pub(crate) trigger_decisions: Vec<TriggerDecisionEvent>,
    /// Realized rhythm spans for this cycle (live timeline rhythm-row source).
    pub(crate) realized_rhythm: Vec<RealizedRhythmSpanEvent>,
    /// Which source track the Track Flow lane chose for each lane cycle — the
    /// display channel behind "Track Flow is playing Track N". Empty unless the
    /// project has a Track Flow lane.
    pub(crate) track_flow: Vec<TrackFlowPlaybackEvent>,
    /// Cycle-local resolved structure + audible note groups for this cycle,
    /// captured after generator overlay. Consumed by `realize_parallel_until` to feed the trigger
    /// evaluator the *exact* structure that was realized (C1/C2). Read off the
    /// per-cycle result before `append_cycle_playback_events` discards it.
    pub(crate) resolved_cycle: Option<CapturedCycleResolution>,
}

/// The pieces needed to build a `cseq_trigger::ResolvedCycle`, captured from one
/// realized cycle in cycle-local (0-based) ticks. The parallel layer maps these
/// onto the reference timeline with the same per-cycle tempo map used for the
/// MIDI queue, so the evaluator sees what was scheduled.
#[derive(Debug, Clone)]
pub(crate) struct CapturedCycleResolution {
    pub(crate) pulse_spans: Vec<PulseSpan>,
    pub(crate) note_groups: Vec<cseq_trigger::NoteGroup>,
    pub(crate) cycle_beats: u32,
}

// ---------------------------------------------------------------------------
// Realize a cycle and enqueue events
// ---------------------------------------------------------------------------

#[cfg(any(test, feature = "fuzzing"))]
pub(crate) fn realize_and_enqueue(
    score: &mut Score,
    cycle: u64,
    cycle_base_tick: u64,
    queue: &mut VecDeque<QueuedEvent>,
    _tempo_bpm: f32,
    rhythm: Option<&mut RhythmPlaybackConfig>,
    track_id: Option<&str>,
) -> Result<CyclePlaybackEvents, TransportError> {
    realize_and_enqueue_with_time(score, cycle, cycle_base_tick, queue, rhythm, track_id)
}

pub(crate) fn realize_and_enqueue_with_time(
    score: &mut Score,
    cycle: u64,
    cycle_base_tick: u64,
    queue: &mut VecDeque<QueuedEvent>,
    rhythm: Option<&mut RhythmPlaybackConfig>,
    // Source track for seed-path replay filtering. `None` for single-track
    // playback (entries recorded with `None` apply unchanged).
    track_id: Option<&str>,
) -> Result<CyclePlaybackEvents, TransportError> {
    realize_and_enqueue_with_identities(
        score,
        cycle,
        cycle_base_tick,
        queue,
        rhythm,
        track_id,
        track_id,
    )
}

pub(crate) fn realize_and_enqueue_with_identities(
    score: &mut Score,
    cycle: u64,
    cycle_base_tick: u64,
    queue: &mut VecDeque<QueuedEvent>,
    rhythm: Option<&mut RhythmPlaybackConfig>,
    // Replay identity may be composite for Track Flow, keeping its recorded
    // seed path distinct from the same authored track in ordinary playback.
    seed_path_track_id: Option<&str>,
    // Generator identity is always the authored track id so preview and
    // playback expose the same context even inside a Track Flow box.
    generator_track_id: Option<&str>,
) -> Result<CyclePlaybackEvents, TransportError> {
    let mut effective_rhythm = rhythm.as_deref().cloned();
    if let Some(config) = effective_rhythm.as_mut() {
        apply_rhythm_playback_automation(config, score, cycle);
        for warning in repair_rhythm_playback_config(config) {
            warn!(cycle, warning = %warning, "playback config repaired for safe realization");
        }
    }

    let seed_path = effective_rhythm
        .as_ref()
        .and_then(|config| config.seed_path.as_ref())
        .cloned();
    let seed_path = seed_path.as_ref();

    // Apply the transform pipeline to get the effective tree.
    let switch_replay =
        seed_path_entries_for_domain(seed_path, cycle, "global", seed_path_track_id)
            .into_iter()
            .map(|entry| SwitchSeedReplay {
                seed: entry.seed,
                source: switch_seed_source_from_label(&entry.source),
                history_before: entry.history_before.clone(),
                history_after: entry.history_after.clone(),
            })
            .collect::<Vec<_>>();
    let (mut effective_tree, switch_seed_trace) = if switch_replay.is_empty() {
        cseq_transforms::apply_pipeline_for_cycle_mut_with_seed_trace(score, cycle)
    } else {
        cseq_transforms::apply_pipeline_for_cycle_mut_with_seed_trace_and_replay(
            score,
            cycle,
            &switch_replay,
        )
    }
    .map_err(|e| TransportError::Realize(e.to_string()))?;
    let mut seed_trace = switch_seed_trace
        .into_iter()
        .map(playback_seed_trace_from_switch)
        .collect::<Vec<_>>();

    let rhythm_overlay = if let Some(config) = effective_rhythm.as_mut() {
        if !config.generator_enabled {
            RhythmOverlayResult::default()
        } else {
            let generator_seed_replay =
                seed_path_entry_for_domain(seed_path, cycle, "generator", seed_path_track_id);
            let (result, generator_seed) = apply_generator_to_tree(
                &mut effective_tree,
                score.cycle_length,
                config,
                cycle,
                score_cycle_beats(score).unwrap_or(1).max(1),
                generator_seed_replay,
                generator_track_id,
            )?;
            if let Some(seed) = generator_seed {
                seed_trace.push(playback_seed_trace_from_resolution(
                    cycle,
                    "generator",
                    generator_seed_trace_label(&config.generator),
                    seed,
                ));
            }
            result
        }
    } else {
        RhythmOverlayResult::default()
    };
    let pulse_spans_for_hocket = effective_tree.pulse_spans.clone();

    // Build a temporary score with the effective tree for realization.
    let effective_score = Score {
        duration_tree: effective_tree,
        ..score.clone()
    };

    let realization = cseq_realize::realize(&effective_score, cycle, 0)
        .map_err(|e| TransportError::Realize(e.to_string()))?;

    // Keep the transform pipeline cycle-local. The scheduler queue may already
    // contain finalized future cycles, and re-running hocket across
    // those events would make previously recorded timeline events disagree with
    // the MIDI that is eventually dispatched.
    let mut cycle_queue = VecDeque::new();

    for event in &realization.events {
        let tick_offset = offset_to_ticks(&event.offset);
        let abs_tick = cycle_base_tick + tick_offset;

        match &event.kind {
            EventKind::NoteOn {
                channel,
                pitch,
                velocity,
            } => {
                cycle_queue.push_back(QueuedEvent::note_on(abs_tick, *channel, *pitch, *velocity));
            }
            EventKind::NoteOff { channel, pitch } => {
                cycle_queue.push_back(QueuedEvent::note_off(abs_tick, *channel, *pitch));
            }
            EventKind::Cc {
                channel,
                controller,
                value,
            } => {
                cycle_queue.push_back(QueuedEvent::cc(abs_tick, *channel, *controller, *value));
            }
        }
    }

    for event in &rhythm_overlay.events {
        let tick_offset = offset_to_ticks(&event.offset);
        let abs_tick = cycle_base_tick + tick_offset;

        match &event.kind {
            EventKind::NoteOn {
                channel,
                pitch,
                velocity,
            } => {
                cycle_queue.push_back(QueuedEvent::note_on(abs_tick, *channel, *pitch, *velocity));
            }
            EventKind::NoteOff { channel, pitch } => {
                cycle_queue.push_back(QueuedEvent::note_off(abs_tick, *channel, *pitch));
            }
            EventKind::Cc {
                channel,
                controller,
                value,
            } => {
                cycle_queue.push_back(QueuedEvent::cc(abs_tick, *channel, *controller, *value));
            }
        }
    }

    // Capture the resolved structure + audible note groups for this cycle at
    // the generator layer, before channel hocket decorates the queue. This is
    // the rest-vs-sounding structure the trigger evaluator observes (C1).
    let resolved_cycle = Some(CapturedCycleResolution {
        pulse_spans: pulse_spans_for_hocket.clone(),
        note_groups: capture_note_groups_local(&cycle_queue, cycle_base_tick),
        cycle_beats: score_cycle_beats(score).unwrap_or(1).max(1),
    });

    let channel_hocket_automation_source = effective_rhythm
        .as_ref()
        .and_then(|config| config.automation.clone());
    let channel_hocket_events = if let Some(config) = effective_rhythm.as_mut() {
        if config.channel_hocket_enabled {
            if let Some(spec) = config.channel_hocket.as_mut() {
                apply_channel_hocket_to_queue(
                    &mut cycle_queue,
                    cycle_base_tick,
                    ticks_per_cycle(score),
                    &pulse_spans_for_hocket,
                    spec,
                    cycle,
                    channel_hocket_automation_source.as_ref(),
                    score_cycle_beats(score).unwrap_or(1).max(1),
                    seed_path_entry_for_domain(seed_path, cycle, "channel", seed_path_track_id),
                )?
            } else {
                apply_static_midi_channel_to_queue(&mut cycle_queue, config.midi_output_channel);
                (Vec::new(), None)
            }
        } else {
            apply_static_midi_channel_to_queue(&mut cycle_queue, config.midi_output_channel);
            (Vec::new(), None)
        }
    } else {
        (Vec::new(), None)
    };
    let (channel_hocket_events, channel_seed) = channel_hocket_events;
    if let Some(seed) = channel_seed {
        seed_trace.push(playback_seed_trace_from_resolution(
            cycle,
            "channel",
            "Channel Shaper",
            seed,
        ));
    }

    queue.extend(cycle_queue);

    // Sort by absolute tick, with note-offs before note-ons at the same tick.
    // Arbitrary subdivision can create adjacent held groups with shared edges.
    queue.make_contiguous().sort_by(|a, b| {
        a.absolute_tick
            .cmp(&b.absolute_tick)
            .then_with(|| a.dispatch_order().cmp(&b.dispatch_order()))
    });

    if let (Some(original), Some(effective)) = (rhythm, effective_rhythm.as_ref()) {
        sync_rhythm_playback_seed_state(original, effective);
    }

    // Realized generator spans for this cycle, from the same overlay resolution that
    // produced the audio. Track tags are applied later
    // by `tag_parallel_playback_events`, like the other per-track overlays.
    let realized_rhythm = rhythm_overlay
        .resolved_spans
        .iter()
        .map(|span| RealizedRhythmSpanEvent {
            cycle,
            parallel_track_index: None,
            parallel_track_id: None,
            span: span.clone(),
        })
        .collect::<Vec<_>>();

    Ok(CyclePlaybackEvents {
        channel_hocket: channel_hocket_events,
        seed_trace,
        parallel_conflict: Vec::new(),
        trigger_decisions: Vec::new(),
        realized_rhythm,
        track_flow: Vec::new(),
        resolved_cycle,
    })
}

/// Pair note-ons with their note-offs from a cycle-local queue, returning
/// audible note groups in cycle-relative (0-based) ticks. Used to capture
/// rest-vs-sounding for trigger evaluation. O(n^2) over one cycle's events,
/// which are few; correctness over cleverness.
pub(crate) fn capture_note_groups_local(
    cycle_queue: &VecDeque<QueuedEvent>,
    cycle_base_tick: u64,
) -> Vec<cseq_trigger::NoteGroup> {
    let is_note_on = |e: &QueuedEvent| (e.bytes[0] & 0xF0) == 0x90 && e.bytes[2] != 0;
    let is_note_off = |e: &QueuedEvent| {
        (e.bytes[0] & 0xF0) == 0x80 || ((e.bytes[0] & 0xF0) == 0x90 && e.bytes[2] == 0)
    };
    let key = |e: &QueuedEvent| (e.bytes[0] & 0x0F, e.bytes[1]);
    let mut groups = Vec::new();
    let mut used = vec![false; cycle_queue.len()];
    for on in cycle_queue.iter() {
        if !is_note_on(on) {
            continue;
        }
        let start = on.absolute_tick.saturating_sub(cycle_base_tick);
        // Find the earliest matching note-off strictly after this onset.
        let mut best: Option<(usize, u64)> = None;
        for (jdx, off) in cycle_queue.iter().enumerate() {
            if used[jdx]
                || !is_note_off(off)
                || key(off) != key(on)
                || off.absolute_tick <= on.absolute_tick
            {
                continue;
            }
            if best.map_or(true, |(_, t)| off.absolute_tick < t) {
                best = Some((jdx, off.absolute_tick));
            }
        }
        let end = match best {
            Some((jdx, off_tick)) => {
                used[jdx] = true;
                off_tick.saturating_sub(cycle_base_tick)
            }
            // Unpaired onset (defensive): treat as an instantaneous group so the
            // beat still reads as sounding.
            None => start.saturating_add(1),
        };
        groups.push(cseq_trigger::NoteGroup {
            start_tick: start,
            end_tick: end,
        });
    }
    groups
}

pub(crate) fn empty_cycle_playback_events() -> CyclePlaybackEvents {
    CyclePlaybackEvents {
        channel_hocket: Vec::new(),
        seed_trace: Vec::new(),
        parallel_conflict: Vec::new(),
        trigger_decisions: Vec::new(),
        realized_rhythm: Vec::new(),
        track_flow: Vec::new(),
        resolved_cycle: None,
    }
}

pub(crate) fn append_cycle_playback_events(
    out: &mut CyclePlaybackEvents,
    mut events: CyclePlaybackEvents,
) {
    out.channel_hocket.append(&mut events.channel_hocket);
    out.seed_trace.append(&mut events.seed_trace);
    out.parallel_conflict.append(&mut events.parallel_conflict);
    out.trigger_decisions.append(&mut events.trigger_decisions);
    out.realized_rhythm.append(&mut events.realized_rhythm);
    out.track_flow.append(&mut events.track_flow);
}

#[derive(Debug, Clone)]
pub(crate) struct RhythmPlaybackCell {
    start: Rational,
    end: Rational,
    pitch: u8,
    velocity: u8,
    rest: bool,
    tied_from_previous: bool,
    tied_to_next: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct RhythmGroupBuilder {
    start: Rational,
    pitch: u8,
    velocity: u8,
}

pub(crate) fn append_rhythm_cells(
    span: &cseq_model::PulseSpan,
    resolved_span: &mut cseq_rhythm::ResolvedRhythmSpan,
    span_leaves: &[NoteLeaf],
    all_spans: &[PulseSpan],
    out: &mut Vec<RhythmPlaybackCell>,
) {
    let resolved_span_len = resolved_span.span_len;
    if resolved_span_len == 0 {
        return;
    }

    for cell in resolved_span.cells.iter_mut() {
        if cell.len == 0 || cell.start >= resolved_span_len {
            continue;
        }

        let cell_end = cell.start.saturating_add(cell.len).min(resolved_span_len);
        let start = rhythm_cell_boundary_time(span, all_spans, cell.start, resolved_span_len);
        let end = rhythm_cell_boundary_time(span, all_spans, cell_end, resolved_span_len);
        if end <= start {
            continue;
        }
        let source = note_leaf_for_offset(span_leaves, start).unwrap_or(&span_leaves[0]);
        // A generator-authored velocity (M4 metric dynamics) outranks the
        // authored-leaf inheritance for this note-on; absent — the default
        // and the only value when the feature is off — keeps the historical
        // accent path byte-for-byte. Either way the resolved cell records the
        // exact velocity the queued MIDI gets, so timeline rows stay truthful.
        let velocity = cell.generated_velocity.unwrap_or(source.velocity);
        cell.velocity = Some(velocity);

        out.push(RhythmPlaybackCell {
            start,
            end,
            pitch: source.pitch,
            velocity,
            rest: cell.rest,
            tied_from_previous: cell.tied_from_previous,
            tied_to_next: cell.tied_to_next,
        });
    }
}

pub(crate) fn rhythm_cell_boundary_time(
    span: &PulseSpan,
    all_spans: &[PulseSpan],
    boundary: u32,
    resolved_span_len: u32,
) -> Rational {
    let linear =
        || span.start + span.duration * Rational::new(boundary as i64, resolved_span_len as i64);
    if resolved_span_len == 0 {
        return span.start;
    }

    // If rhythm is operating on the native matra grid, map cell boundaries
    // through the section's gati spans. This preserves non-uniform custom
    // division timing inside jathi spans that cross division boundaries.
    if resolved_span_len == span.matra_len {
        if let Some(mapped) = span_native_matra_boundary_time(span, all_spans, boundary) {
            return mapped;
        }
    }

    linear()
}

pub(crate) fn span_native_matra_boundary_time(
    span: &PulseSpan,
    all_spans: &[PulseSpan],
    boundary: u32,
) -> Option<Rational> {
    let section_index = pulse_span_section_index(span)?;
    let absolute_matra = span.start_matra.checked_add(boundary)?;
    let span_end = span.start + span.duration;

    for candidate in all_spans {
        if pulse_span_section_index(candidate) != Some(section_index)
            || !matches!(candidate.kind, PulseSpanKind::GatiBeat { .. })
            || candidate.matra_len == 0
        {
            continue;
        }

        let candidate_start_matra = candidate.start_matra;
        let candidate_end_matra = candidate_start_matra.checked_add(candidate.matra_len)?;
        if absolute_matra < candidate_start_matra || absolute_matra > candidate_end_matra {
            continue;
        }

        let relative_matra = absolute_matra - candidate_start_matra;
        let mapped = candidate.start
            + candidate.duration * Rational::new(relative_matra as i64, candidate.matra_len as i64);
        if mapped >= span.start && mapped <= span_end {
            return Some(mapped);
        }
    }

    None
}

pub(crate) fn push_rhythm_group(
    group: RhythmGroupBuilder,
    end: Rational,
    overlay_events: &mut Vec<RhythmOverlayEvent>,
) {
    if end <= group.start {
        return;
    }

    overlay_events.push(RhythmOverlayEvent {
        offset: group.start,
        kind: EventKind::NoteOn {
            channel: 0,
            pitch: group.pitch,
            velocity: group.velocity,
        },
    });
    overlay_events.push(RhythmOverlayEvent {
        offset: end,
        kind: EventKind::NoteOff {
            channel: 0,
            pitch: group.pitch,
        },
    });
}

pub(crate) fn emit_rhythm_overlay_events(
    cells: &[RhythmPlaybackCell],
    overlay_events: &mut Vec<RhythmOverlayEvent>,
) {
    let mut active: Option<RhythmGroupBuilder> = None;
    let mut last_end = None;

    for cell in cells {
        last_end = Some(cell.end);

        if cell.rest {
            if let Some(group) = active.take() {
                push_rhythm_group(group, cell.start, overlay_events);
            }
            continue;
        }

        if active.is_none() || !cell.tied_from_previous {
            if let Some(group) = active.take() {
                push_rhythm_group(group, cell.start, overlay_events);
            }
            active = Some(RhythmGroupBuilder {
                start: cell.start,
                pitch: cell.pitch,
                velocity: cell.velocity,
            });
        }

        if cell.tied_to_next {
            continue;
        }

        if let Some(group) = active.take() {
            push_rhythm_group(group, cell.end, overlay_events);
        }
    }

    if let (Some(group), Some(end)) = (active.take(), last_end) {
        push_rhythm_group(group, end, overlay_events);
    }
}

pub(crate) fn note_leaf_for_offset(leaves: &[NoteLeaf], offset: Rational) -> Option<&NoteLeaf> {
    leaves
        .iter()
        .rev()
        .find(|leaf| leaf.offset <= offset)
        .or_else(|| leaves.first())
}

/// Authored-leaf velocities on the matra grid of one beat/grouping span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RhythmSpanMatraVelocities {
    pub span_id: cseq_model::PulseSpanId,
    /// `velocities[m]` is the authored velocity a generated cell starting at
    /// span-local matra `m` inherits. Empty for section spans (the generator
    /// seam never fills them) and for spans holding no note leaves.
    pub velocities: Vec<u8>,
}

/// Per-span authored velocities on the matra grid, computed with the exact
/// leaf-inheritance rule `append_rhythm_cells` applies during realization
/// (`note_leaf_for_offset` at `rhythm_cell_boundary_time` boundaries, over the
/// same per-span leaf window). The stopped structure preview surfaces these so
/// `generator_preview` can stamp per-cell velocities that match realized
/// playback byte-for-byte.
pub fn rhythm_span_matra_velocities(
    tree: &DurationTree,
    cycle_length: Rational,
) -> Result<Vec<RhythmSpanMatraVelocities>, TransportError> {
    let mut leaves = Vec::new();
    let root_duration = tree
        .get(tree.root)
        .map(|root| cycle_length * root.duration)
        .unwrap_or(cycle_length);
    collect_note_leaves(
        tree,
        tree.root,
        Rational::new(0, 1),
        root_duration,
        &mut leaves,
    )?;

    let all_spans = &tree.pulse_spans;
    let mut out = Vec::with_capacity(all_spans.len());
    for span in all_spans {
        if matches!(span.kind, PulseSpanKind::Section { .. }) {
            out.push(RhythmSpanMatraVelocities {
                span_id: span.id,
                velocities: Vec::new(),
            });
            continue;
        }
        let span_start = span.start;
        let span_end = span.start + span.duration;
        let span_leaves = leaves
            .iter()
            .filter(|leaf| leaf.offset >= span_start && leaf.offset < span_end)
            .cloned()
            .collect::<Vec<_>>();
        let velocities = if span_leaves.is_empty() {
            Vec::new()
        } else {
            (0..span.matra_len)
                .map(|matra| {
                    let boundary =
                        rhythm_cell_boundary_time(span, all_spans, matra, span.matra_len);
                    note_leaf_for_offset(&span_leaves, boundary)
                        .unwrap_or(&span_leaves[0])
                        .velocity
                })
                .collect()
        };
        out.push(RhythmSpanMatraVelocities {
            span_id: span.id,
            velocities,
        });
    }
    Ok(out)
}

pub(crate) fn collect_note_leaves(
    tree: &DurationTree,
    node_id: u64,
    offset: Rational,
    node_duration: Rational,
    leaves: &mut Vec<NoteLeaf>,
) -> Result<(), TransportError> {
    let node = tree
        .get(node_id)
        .ok_or_else(|| TransportError::Realize(format!("node {node_id} not found")))?;
    match &node.kind {
        DurationKind::Pulse(pulse) => {
            if let PulseEvent::Note { pitch, .. } = &pulse.event {
                leaves.push(NoteLeaf {
                    node_id,
                    offset,
                    pitch: pitch.as_fixed().copied().unwrap_or(60),
                    velocity: pulse.velocity.as_fixed().copied().unwrap_or(96),
                });
            }
        }
        DurationKind::Subdivided { children, policy } => {
            let child_durations =
                collect_child_durations(tree, children, node_duration, policy, node_id)?;
            let mut child_offset = offset;
            for (index, child_id) in children.iter().enumerate() {
                collect_note_leaves(
                    tree,
                    *child_id,
                    child_offset,
                    child_durations[index],
                    leaves,
                )?;
                child_offset += child_durations[index];
            }
        }
        DurationKind::Tied { children } => {
            let child_durations = collect_child_durations(
                tree,
                children,
                node_duration,
                &SubdivisionPolicy::Explicit,
                node_id,
            )?;
            let mut child_offset = offset;
            for (index, child_id) in children.iter().enumerate() {
                collect_note_leaves(
                    tree,
                    *child_id,
                    child_offset,
                    child_durations[index],
                    leaves,
                )?;
                child_offset += child_durations[index];
            }
        }
        DurationKind::Trigger { .. } => {}
    }
    Ok(())
}

pub(crate) fn collect_child_durations(
    tree: &DurationTree,
    children: &[u64],
    node_duration: Rational,
    policy: &SubdivisionPolicy,
    parent_id: u64,
) -> Result<Vec<Rational>, TransportError> {
    match policy {
        SubdivisionPolicy::Equal => {
            if children.is_empty() {
                return Err(TransportError::Realize(format!(
                    "node {parent_id}: equal subdivision has no children"
                )));
            }
            Ok(vec![
                node_duration / Rational::from(children.len() as i64);
                children.len()
            ])
        }
        SubdivisionPolicy::Weighted(weights) => {
            if weights.len() != children.len() {
                return Err(TransportError::Realize(format!(
                    "node {parent_id}: {} weights for {} children",
                    weights.len(),
                    children.len()
                )));
            }
            if let Some(index) = weights.iter().position(|weight| *weight == 0) {
                return Err(TransportError::Realize(format!(
                    "node {parent_id}: weighted child {} has zero duration",
                    index + 1
                )));
            }
            let total = weights.iter().map(|weight| u64::from(*weight)).sum::<u64>();
            if total == 0 {
                return Err(TransportError::Realize(format!(
                    "node {parent_id}: weighted subdivision total must be positive"
                )));
            }
            Ok(weights
                .iter()
                .map(|weight| node_duration * Rational::new(i64::from(*weight), total as i64))
                .collect())
        }
        SubdivisionPolicy::Explicit => {
            let durations = children
                .iter()
                .map(|child_id| {
                    tree.get(*child_id)
                        .map(|child| child.duration * node_duration)
                        .ok_or_else(|| {
                            TransportError::Realize(format!("node {child_id} not found"))
                        })
                })
                .collect::<Result<Vec<_>, _>>()?;
            if durations.is_empty() {
                return Err(TransportError::Realize(format!(
                    "node {parent_id}: explicit subdivision has no children"
                )));
            }
            if let Some(index) = durations
                .iter()
                .position(|duration| *duration <= Rational::new(0, 1))
            {
                return Err(TransportError::Realize(format!(
                    "node {parent_id}: explicit child {} has non-positive duration",
                    index + 1
                )));
            }
            let sum = durations.iter().copied().sum::<Rational>();
            if sum != node_duration {
                return Err(TransportError::Realize(format!(
                    "node {parent_id}: explicit child durations sum to {sum}, expected {node_duration}"
                )));
            }
            Ok(durations)
        }
    }
}

pub(crate) fn silence_pulse(tree: &mut DurationTree, node_id: u64) -> Result<(), TransportError> {
    let node = tree
        .nodes
        .get_mut(&node_id)
        .ok_or_else(|| TransportError::Realize(format!("node {node_id} not found")))?;
    if let DurationKind::Pulse(pulse) = &mut node.kind {
        pulse.event = PulseEvent::Rest;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_channel_hocket_spec() -> cseq_rhythm::ChannelHocketSpec {
        cseq_rhythm::ChannelHocketSpec {
            order: cseq_rhythm::MarkovOrder::First,
            channels: vec![1, 2, 3],
            transitions: vec![
                cseq_rhythm::ChannelTransition {
                    from: vec![1],
                    to: 2,
                    weight: 1,
                },
                cseq_rhythm::ChannelTransition {
                    from: vec![2],
                    to: 3,
                    weight: 1,
                },
                cseq_rhythm::ChannelTransition {
                    from: vec![3],
                    to: 1,
                    weight: 1,
                },
            ],
            fallback: 1,
            fallback_weights: vec![],
            entry_weights: vec![],
            seed_mode: cseq_rhythm::RhythmSeedMode::Locked { seed: 1 },
            global_seed: 1,
            accent_rules: vec![],
            position_rules: vec![],
            assign_mode: cseq_rhythm::ChannelAssignMode::Markov,
            euclid: None,
        }
    }

    #[test]
    fn cross_span_tie_chain_emits_one_note_with_its_openers_payload() {
        // These are the three flat playback cells produced by three adjacent
        // generator spans. Later spans deliberately carry different leaf
        // payloads: sustain semantics require the chain to inherit its opener.
        let cells = vec![
            RhythmPlaybackCell {
                start: Rational::new(0, 1),
                end: Rational::new(1, 1),
                pitch: 36,
                velocity: 71,
                rest: false,
                tied_from_previous: false,
                tied_to_next: true,
            },
            RhythmPlaybackCell {
                start: Rational::new(1, 1),
                end: Rational::new(2, 1),
                pitch: 48,
                velocity: 99,
                rest: false,
                tied_from_previous: true,
                tied_to_next: true,
            },
            RhythmPlaybackCell {
                start: Rational::new(2, 1),
                end: Rational::new(3, 1),
                pitch: 60,
                velocity: 127,
                rest: false,
                tied_from_previous: true,
                tied_to_next: false,
            },
        ];

        let mut events = Vec::new();
        emit_rhythm_overlay_events(&cells, &mut events);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].offset, Rational::new(0, 1));
        assert!(matches!(
            &events[0].kind,
            EventKind::NoteOn {
                channel: 0,
                pitch: 36,
                velocity: 71,
            }
        ));
        assert_eq!(events[1].offset, Rational::new(3, 1));
        assert!(matches!(
            &events[1].kind,
            EventKind::NoteOff {
                channel: 0,
                pitch: 36,
            }
        ));

        let mut queue = events
            .iter()
            .map(|event| {
                let tick = u64::try_from(event.offset.to_integer()).unwrap();
                match &event.kind {
                    EventKind::NoteOn {
                        channel,
                        pitch,
                        velocity,
                    } => QueuedEvent::note_on(tick, *channel, *pitch, *velocity),
                    EventKind::NoteOff { channel, pitch } => {
                        QueuedEvent::note_off(tick, *channel, *pitch)
                    }
                    EventKind::Cc { .. } => unreachable!("overlay tie proof emits notes only"),
                }
            })
            .collect::<VecDeque<_>>();
        let groups = capture_note_groups_local(&queue, 0);
        assert_eq!(groups.len(), 1, "hocket/trigger consumers see one chain");
        assert_eq!(groups[0].start_tick, 0);
        assert_eq!(groups[0].end_tick, 3);

        let mut spec = test_channel_hocket_spec();
        let (hocket_events, _) =
            apply_channel_hocket_to_queue(&mut queue, 0, 3, &[], &mut spec, 0, None, 3, None)
                .expect("hocket assignment");
        assert_eq!(hocket_events.len(), 1, "one assignment per tied chain");
        assert_eq!(hocket_events[0].start_tick, 0);
        assert_eq!(hocket_events[0].end_tick, 3);
        assert_eq!(queue.len(), 2);
        assert_eq!(queue[0].bytes[1..3], [36, 71]);
        assert_eq!(queue[1].bytes[1], 36);
    }
}
