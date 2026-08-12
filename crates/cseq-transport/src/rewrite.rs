#[allow(unused_imports)]
use crate::*;

pub(crate) fn post_score_resample_scope(
    automation: Option<&AutomationSet>,
    cycle: u64,
    cycle_beats: u32,
    cycle_base_tick: u64,
    ticks_per_cycle: u64,
    start_tick: u64,
) -> Option<(&AutomationSet, AutomationSampleScope)> {
    let automation = automation?;
    if automation.tracks.is_empty() || ticks_per_cycle == 0 {
        return None;
    }
    let cycle_beats = cycle_beats.max(1);
    let tick_in_cycle = start_tick.saturating_sub(cycle_base_tick);
    let beat_index = automation_beat_index_for_tick(tick_in_cycle, ticks_per_cycle, cycle_beats);
    let phase = automation_time_for_cycle_tick(
        cycle,
        tick_in_cycle,
        ticks_per_cycle,
        automation.length_cycles,
    );
    Some((
        automation,
        AutomationSampleScope {
            cycle,
            beat_index,
            cycle_beats,
            phase: Some(phase),
        },
    ))
}

pub(crate) fn channel_hocket_spec_for_group<'a>(
    spec: &'a ChannelHocketSpec,
    automation: Option<&AutomationSet>,
    cycle: u64,
    cycle_beats: u32,
    cycle_base_tick: u64,
    ticks_per_cycle: u64,
    start_tick: u64,
) -> std::borrow::Cow<'a, ChannelHocketSpec> {
    let Some((automation, sample_scope)) = post_score_resample_scope(
        automation,
        cycle,
        cycle_beats,
        cycle_base_tick,
        ticks_per_cycle,
        start_tick,
    ) else {
        return std::borrow::Cow::Borrowed(spec);
    };
    let mut adjusted = spec.clone();
    automate_channel_hocket_spec(automation, sample_scope, &mut adjusted);
    if adjusted.assign_mode == cseq_rhythm::ChannelAssignMode::Euclid {
        // Numeric automation lanes are sampled independently, so a group can
        // otherwise observe a transient invalid relation (for example,
        // partition pulses whose sum exceeds an automated step count). Repair
        // only the Euclid branch here: Markov-mode automation must remain
        // byte-identical to the pre-Euclid path.
        repair_euclid_channel_hocket_spec(&mut adjusted, &mut Vec::new());
    }
    std::borrow::Cow::Owned(adjusted)
}

#[derive(Debug, Clone)]
pub(crate) struct ChannelNoteGroup {
    pub(crate) on_index: usize,
    pub(crate) off_index: usize,
    pub(crate) start_tick: u64,
    pub(crate) end_tick: u64,
    pub(crate) velocity: u8,
}

#[derive(Debug, Clone)]
pub(crate) struct ChannelAssignment {
    channel: u8,
    source: RhythmChoiceSource,
    position: Option<ChannelPositionAssignment>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct AccentChannelAssignment {
    channel: u8,
    mode: cseq_rhythm::ChannelAccentRoutingMode,
}

#[derive(Debug, Clone)]
pub(crate) struct ChannelPositionAssignment {
    rule_id: String,
    label: String,
    scope: cseq_rhythm::ChannelPositionScope,
    nth: u32,
    action: cseq_rhythm::ChannelPositionAction,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ChannelNotePosition {
    nth_in_beat: u32,
    section_index: Option<u32>,
    nth_in_section: Option<u32>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ChannelSectionRegion {
    index: u32,
    start_tick: u64,
    end_tick: u64,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_channel_hocket_to_queue(
    queue: &mut VecDeque<QueuedEvent>,
    cycle_base_tick: u64,
    ticks_per_cycle: u64,
    pulse_spans: &[PulseSpan],
    spec: &mut ChannelHocketSpec,
    cycle: u64,
    automation: Option<&AutomationSet>,
    cycle_beats: u32,
    seed_replay: Option<&SeedPathPlaybackEntry>,
) -> Result<
    (
        Vec<ChannelHocketPlaybackEvent>,
        Option<PlaybackSeedResolution>,
    ),
    TransportError,
> {
    if ticks_per_cycle == 0 {
        return Ok((Vec::new(), None));
    }

    let cycle_end_tick = cycle_base_tick.saturating_add(ticks_per_cycle);
    let mut events = queue.drain(..).collect::<Vec<_>>();
    let groups = collect_channel_note_groups(&events)
        .into_iter()
        .filter(|group| group.start_tick >= cycle_base_tick && group.end_tick <= cycle_end_tick)
        .collect::<Vec<_>>();
    if groups.is_empty() {
        *queue = events.into();
        return Ok((Vec::new(), None));
    }
    let positions = channel_note_position_index(
        &groups,
        cycle_base_tick,
        ticks_per_cycle,
        cycle_beats,
        pulse_spans,
    );

    let seed = if let Some(entry) = seed_replay {
        apply_rhythm_seed_history_after(&mut spec.seed_mode, &entry.history_after);
        playback_seed_resolution_from_seed_path(entry)
    } else {
        let history_before = rhythm_seed_history_before(&spec.seed_mode);
        let seed = cseq_rhythm::resolve_seed(&mut spec.seed_mode, cycle, spec.global_seed)
            .map_err(|e| TransportError::Realize(e.to_string()))?;
        playback_seed_resolution_from_rhythm(seed, history_before)
    };
    cseq_rhythm::validate_channel_hocket_spec(spec)
        .map_err(|e| TransportError::Realize(e.to_string()))?;
    // Reset-region keys and span-accent flags are structural (pattern
    // position only) so they derive from the authored spec; per-group
    // automation still governs everything the assigner renders.
    let euclid_contexts = match (spec.assign_mode, spec.euclid.as_ref()) {
        (cseq_rhythm::ChannelAssignMode::Euclid, Some(euclid)) => Some(euclid_group_contexts(
            &groups,
            euclid,
            cycle_base_tick,
            ticks_per_cycle,
            cycle_beats.max(1),
            pulse_spans,
        )),
        _ => None,
    };
    let mut assigner = ChannelAssigner::new(spec, seed.seed)
        .map_err(|e| TransportError::Realize(e.to_string()))?;
    let mut rng = HocketRng::new(cseq_rhythm::mix_seed(
        seed.seed ^ 0xC4A7_4E11_0017_5519,
        cycle,
    ));
    let mut hocket_events = Vec::new();
    for group in &groups {
        let effective_spec = channel_hocket_spec_for_group(
            spec,
            automation,
            cycle,
            cycle_beats,
            cycle_base_tick,
            ticks_per_cycle,
            group.start_tick,
        );
        let context = euclid_contexts
            .as_ref()
            .and_then(|contexts| contexts.get(&group.on_index));
        let assignment = if let Some(pinned) =
            euclid_bypassed_accent_assignment(effective_spec.as_ref(), context)
        {
            pinned
        } else {
            if let Some(context) = context {
                assigner.enter_region(context.region_key);
            }
            next_channel_assignment_for_group(
                &mut assigner,
                effective_spec.as_ref(),
                std::slice::from_ref(group),
                &mut rng,
                &positions,
            )
            .map_err(|e| TransportError::Realize(e.to_string()))?
        };
        assign_channel_group(
            &mut events,
            std::slice::from_ref(group),
            &assignment,
            cycle,
            cycle_base_tick,
            &mut hocket_events,
        );
    }

    events.sort_by(|a, b| {
        a.absolute_tick
            .cmp(&b.absolute_tick)
            .then_with(|| a.dispatch_order().cmp(&b.dispatch_order()))
    });
    *queue = events.into();
    Ok((hocket_events, Some(seed)))
}

pub(crate) fn collect_channel_note_groups(events: &[QueuedEvent]) -> Vec<ChannelNoteGroup> {
    // LIFO pairing per (channel, pitch): a note-off closes the most recently
    // opened matching note-on. Identical to a forward first-match scan for
    // sequential notes, but for nested same-pitch/same-channel groups it pairs
    // inner-to-inner instead of swapping their durations. This must agree with
    // `collect_final_note_groups`, which uses the same rule, or channel
    // re-collection would disagree with the conflict pass.
    let mut pending: HashMap<(u8, u8), Vec<usize>> = HashMap::new();
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    for (event_index, event) in events.iter().enumerate() {
        if is_note_on_event(event) {
            let channel = event.bytes[0] & 0x0F;
            let pitch = event.bytes[1];
            pending
                .entry((channel, pitch))
                .or_default()
                .push(event_index);
        } else if event.len == 3 {
            let status = event.bytes[0] & 0xF0;
            let is_off = status == 0x80 || (status == 0x90 && event.bytes[2] == 0);
            if !is_off {
                continue;
            }
            let channel = event.bytes[0] & 0x0F;
            let pitch = event.bytes[1];
            if let Some(on_index) = pending.get_mut(&(channel, pitch)).and_then(Vec::pop) {
                pairs.push((on_index, event_index));
            }
        }
    }
    // Invariant: LIFO pairing never yields a note-off earlier than its note-on
    // (the off is always scanned after the on it closes). If a future overlay
    // ever produces genuinely interleaved same-pitch/same-channel groups (the
    // ambiguous case MIDI itself cannot disambiguate), this surfaces it in
    // debug/test builds rather than silently mispairing.
    debug_assert!(
        pairs
            .iter()
            .all(|(on_index, off_index)| off_index > on_index
                && events[*off_index].absolute_tick >= events[*on_index].absolute_tick),
        "note-group pairing produced a negative-duration or out-of-order pair"
    );

    // Preserve the prior contract that groups are ordered by note-on position;
    // downstream channel assignment observes a stable note-on order.
    pairs.sort_unstable_by_key(|(on_index, _)| *on_index);
    pairs
        .into_iter()
        .map(|(on_index, off_index)| ChannelNoteGroup {
            on_index,
            off_index,
            start_tick: events[on_index].absolute_tick,
            end_tick: events[off_index].absolute_tick,
            velocity: events[on_index].bytes[2],
        })
        .collect()
}

pub(crate) fn channel_note_position_index(
    groups: &[ChannelNoteGroup],
    cycle_base_tick: u64,
    ticks_per_cycle: u64,
    cycle_beats: u32,
    pulse_spans: &[PulseSpan],
) -> HashMap<usize, ChannelNotePosition> {
    if ticks_per_cycle == 0 {
        return HashMap::new();
    }
    let cycle_beats = cycle_beats.max(1);
    let section_regions = channel_section_regions(cycle_base_tick, pulse_spans);
    let mut ordered = groups.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|group| (group.start_tick, group.on_index));

    let mut beat_counts: HashMap<u32, u32> = HashMap::new();
    let mut section_counts: HashMap<u32, u32> = HashMap::new();
    let mut positions = HashMap::with_capacity(groups.len());
    for group in ordered {
        let beat_index = channel_beat_index_for_tick(
            group.start_tick.saturating_sub(cycle_base_tick),
            ticks_per_cycle,
            cycle_beats,
        );
        let nth_in_beat = beat_counts
            .entry(beat_index)
            .and_modify(|count| *count = count.saturating_add(1))
            .or_insert(1);
        let section_index = containing_channel_section(&section_regions, group.start_tick)
            .map(|region| region.index);
        let nth_in_section = section_index.map(|index| {
            *section_counts
                .entry(index)
                .and_modify(|count| *count = count.saturating_add(1))
                .or_insert(1)
        });
        positions.insert(
            group.on_index,
            ChannelNotePosition {
                nth_in_beat: *nth_in_beat,
                section_index,
                nth_in_section,
            },
        );
    }
    positions
}

pub(crate) fn channel_beat_index_for_tick(
    tick_in_cycle: u64,
    ticks_per_cycle: u64,
    cycle_beats: u32,
) -> u32 {
    if ticks_per_cycle == 0 || cycle_beats == 0 {
        return 0;
    }
    ((u128::from(tick_in_cycle) * u128::from(cycle_beats)) / u128::from(ticks_per_cycle))
        .min(u128::from(cycle_beats.saturating_sub(1))) as u32
}

pub(crate) fn channel_section_regions(
    cycle_base_tick: u64,
    pulse_spans: &[PulseSpan],
) -> Vec<ChannelSectionRegion> {
    pulse_spans
        .iter()
        .filter_map(|span| {
            let PulseSpanKind::Section { index } = span.kind else {
                return None;
            };
            let start_tick = cycle_base_tick.saturating_add(offset_to_ticks(&span.start));
            let end_tick =
                cycle_base_tick.saturating_add(offset_to_ticks(&(span.start + span.duration)));
            (end_tick > start_tick).then_some(ChannelSectionRegion {
                index,
                start_tick,
                end_tick,
            })
        })
        .collect()
}

pub(crate) fn containing_channel_section(
    regions: &[ChannelSectionRegion],
    start_tick: u64,
) -> Option<ChannelSectionRegion> {
    regions
        .iter()
        .copied()
        .find(|region| start_tick >= region.start_tick && start_tick < region.end_tick)
}

/// Strategy dispatch for the per-note channel decision: one Markov resolver
/// or one Euclid assigner per cycle behind the same three-method surface the
/// group loop drives. Step consumption is identical across strategies —
/// every method call is exactly one draw/step — so gesture semantics and
/// call counts never depend on the strategy.
pub(crate) enum ChannelAssigner<'a> {
    Markov(cseq_rhythm::ChannelHocketResolver<'a>),
    Euclid(cseq_rhythm::EuclidAssigner),
}

impl<'a> ChannelAssigner<'a> {
    fn new(
        spec: &'a ChannelHocketSpec,
        seed: u64,
    ) -> Result<Self, cseq_rhythm::ChannelHocketError> {
        match spec.assign_mode {
            cseq_rhythm::ChannelAssignMode::Markov => Ok(Self::Markov(
                cseq_rhythm::ChannelHocketResolver::new(spec, seed)?,
            )),
            cseq_rhythm::ChannelAssignMode::Euclid => {
                cseq_rhythm::validate_channel_hocket_spec(spec)?;
                Ok(Self::Euclid(cseq_rhythm::EuclidAssigner::new()))
            }
        }
    }

    /// Euclid only: re-anchor the step index when a gesture enters a new
    /// reset region. A gesture that crosses a region boundary stays anchored
    /// to the region it starts in. Markov has no positional state; no-op.
    fn enter_region(&mut self, key: u64) {
        if let Self::Euclid(assigner) = self {
            assigner.enter_region(key);
        }
    }

    fn next_choice_with_spec(
        &mut self,
        spec: &ChannelHocketSpec,
    ) -> Result<cseq_rhythm::ResolvedChannelChoice, cseq_rhythm::ChannelHocketError> {
        match self {
            Self::Markov(resolver) => resolver.next_choice_with_spec(spec),
            Self::Euclid(assigner) => assigner.next_choice_with_spec(spec),
        }
    }

    fn force_channel_with_spec(
        &mut self,
        spec: &ChannelHocketSpec,
        channel: u8,
    ) -> Result<cseq_rhythm::ResolvedChannelChoice, cseq_rhythm::ChannelHocketError> {
        match self {
            Self::Markov(resolver) => resolver.force_channel_with_spec(spec, channel),
            Self::Euclid(assigner) => assigner.force_channel_with_spec(spec, channel),
        }
    }

    fn reset_channel_with_spec(
        &mut self,
        spec: &ChannelHocketSpec,
        channel: u8,
    ) -> Result<cseq_rhythm::ResolvedChannelChoice, cseq_rhythm::ChannelHocketError> {
        match self {
            Self::Markov(resolver) => resolver.reset_channel_with_spec(spec, channel),
            Self::Euclid(assigner) => assigner.reset_channel_with_spec(spec, channel),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ChannelAccentRegion {
    start_tick: u64,
    end_tick: u64,
}

/// Accent spans for the Euclid span-accent features: per section, use grouping
/// frames when present, otherwise the subdivision beat frames.
pub(crate) fn channel_accent_regions(
    cycle_base_tick: u64,
    pulse_spans: &[PulseSpan],
) -> Vec<ChannelAccentRegion> {
    #[derive(Default)]
    struct SectionAccentSpans {
        jathi: Vec<ChannelAccentRegion>,
        gati: Vec<ChannelAccentRegion>,
    }
    let mut by_section: BTreeMap<u32, SectionAccentSpans> = BTreeMap::new();
    for span in pulse_spans {
        let start_tick = cycle_base_tick.saturating_add(offset_to_ticks(&span.start));
        let end_tick =
            cycle_base_tick.saturating_add(offset_to_ticks(&(span.start + span.duration)));
        if end_tick <= start_tick {
            continue;
        }
        let region = ChannelAccentRegion {
            start_tick,
            end_tick,
        };
        match span.kind {
            PulseSpanKind::JathiPulse { section_index, .. } => by_section
                .entry(section_index)
                .or_default()
                .jathi
                .push(region),
            PulseSpanKind::GatiBeat { section_index, .. } => by_section
                .entry(section_index)
                .or_default()
                .gati
                .push(region),
            _ => {}
        }
    }
    let mut regions: Vec<ChannelAccentRegion> = Vec::new();
    for spans in by_section.into_values() {
        let picked = if !spans.jathi.is_empty() {
            spans.jathi
        } else {
            spans.gati
        };
        regions.extend(picked);
    }
    regions.sort_by_key(|region| region.start_tick);
    regions
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct EuclidGroupContext {
    region_key: u64,
    is_span_accent: bool,
}

/// Sentinel region for groups outside every section/accent span: they share
/// one region of their own rather than re-anchoring per note.
pub(crate) const EUCLID_NO_REGION: u64 = u64::MAX;

pub(crate) fn euclid_group_contexts(
    groups: &[ChannelNoteGroup],
    euclid: &cseq_rhythm::EuclidChannelSpec,
    cycle_base_tick: u64,
    ticks_per_cycle: u64,
    cycle_beats: u32,
    pulse_spans: &[PulseSpan],
) -> HashMap<usize, EuclidGroupContext> {
    let accent_regions = channel_accent_regions(cycle_base_tick, pulse_spans);
    let section_regions = channel_section_regions(cycle_base_tick, pulse_spans);
    let mut contexts = HashMap::with_capacity(groups.len());
    for group in groups {
        let containing_accent = accent_regions.iter().find(|region| {
            group.start_tick >= region.start_tick && group.start_tick < region.end_tick
        });
        // The span-start accent is the note at the span's exact start tick;
        // a silent span start (rest/tie) simply contributes no accent.
        let is_span_accent =
            containing_accent.is_some_and(|region| region.start_tick == group.start_tick);
        let region_key = match euclid.reset {
            cseq_rhythm::EuclidResetScope::Cycle => 0,
            cseq_rhythm::EuclidResetScope::Section => {
                containing_channel_section(&section_regions, group.start_tick)
                    .map(|region| region.start_tick)
                    .unwrap_or(EUCLID_NO_REGION)
            }
            cseq_rhythm::EuclidResetScope::Beat => u64::from(channel_beat_index_for_tick(
                group.start_tick.saturating_sub(cycle_base_tick),
                ticks_per_cycle,
                cycle_beats,
            )),
            cseq_rhythm::EuclidResetScope::AccentSpan => containing_accent
                .map(|region| region.start_tick)
                .unwrap_or(EUCLID_NO_REGION),
        };
        contexts.insert(
            group.on_index,
            EuclidGroupContext {
                region_key,
                is_span_accent,
            },
        );
    }
    contexts
}

/// Euclid Bypass mode: the note group starting an accent span is pinned to
/// the anchor channel, consumes no pattern step, and outranks position and
/// velocity-accent rules — the pin is the point of the toggle.
pub(crate) fn euclid_bypassed_accent_assignment(
    spec: &ChannelHocketSpec,
    context: Option<&EuclidGroupContext>,
) -> Option<ChannelAssignment> {
    let context = context?;
    if !context.is_span_accent {
        return None;
    }
    if spec.assign_mode != cseq_rhythm::ChannelAssignMode::Euclid {
        return None;
    }
    let euclid = spec.euclid.as_ref()?;
    if euclid.span_accent_mode != cseq_rhythm::EuclidSpanAccentMode::Bypass {
        return None;
    }
    Some(ChannelAssignment {
        channel: euclid.span_accent_channel.unwrap_or(spec.fallback),
        source: RhythmChoiceSource::Accent,
        position: None,
    })
}

pub(crate) fn next_channel_assignment_for_group(
    assigner: &mut ChannelAssigner<'_>,
    spec: &ChannelHocketSpec,
    group: &[ChannelNoteGroup],
    rng: &mut HocketRng,
    positions: &HashMap<usize, ChannelNotePosition>,
) -> Result<ChannelAssignment, cseq_rhythm::ChannelHocketError> {
    if let Some(assignment) =
        choose_position_channel_assignment(assigner, spec, group, rng, positions)?
    {
        return Ok(assignment);
    }
    let accent_assignment = choose_accent_channel_assignment(spec, group, rng);
    if let Some(accent) = accent_assignment {
        match accent.mode {
            cseq_rhythm::ChannelAccentRoutingMode::DriveChain => {
                let choice = assigner.force_channel_with_spec(spec, accent.channel)?;
                return Ok(ChannelAssignment {
                    channel: choice.channel,
                    source: choice.source,
                    position: None,
                });
            }
            cseq_rhythm::ChannelAccentRoutingMode::RenderOnly => {
                let _ = assigner.next_choice_with_spec(spec)?;
                return Ok(ChannelAssignment {
                    channel: accent.channel,
                    source: RhythmChoiceSource::Accent,
                    position: None,
                });
            }
        }
    }

    let choice = assigner.next_choice_with_spec(spec)?;
    Ok(ChannelAssignment {
        channel: choice.channel,
        source: choice.source,
        position: None,
    })
}

pub(crate) fn choose_position_channel_assignment(
    assigner: &mut ChannelAssigner<'_>,
    spec: &ChannelHocketSpec,
    group: &[ChannelNoteGroup],
    rng: &mut HocketRng,
    positions: &HashMap<usize, ChannelNotePosition>,
) -> Result<Option<ChannelAssignment>, cseq_rhythm::ChannelHocketError> {
    let Some(note_group) = group.first() else {
        return Ok(None);
    };
    let Some(position) = positions.get(&note_group.on_index).copied() else {
        return Ok(None);
    };
    for rule in spec.position_rules.iter().filter(|rule| rule.enabled) {
        if !channel_position_rule_matches(rule, position) {
            continue;
        }
        let Some(action) = choose_channel_position_action(rule, spec, rng) else {
            continue;
        };
        let metadata = ChannelPositionAssignment {
            rule_id: rule.id.clone(),
            label: rule.label.clone(),
            scope: rule.scope,
            nth: rule.nth,
            action,
        };
        return match action {
            cseq_rhythm::ChannelPositionAction::NormalMarkov => {
                let choice = assigner.next_choice_with_spec(spec)?;
                Ok(Some(ChannelAssignment {
                    channel: choice.channel,
                    source: choice.source,
                    position: Some(metadata),
                }))
            }
            cseq_rhythm::ChannelPositionAction::RenderOnly => {
                let Some(channel) = choose_channel_position_render_channel(rule, spec, rng) else {
                    return Ok(None);
                };
                let _ = assigner.next_choice_with_spec(spec)?;
                Ok(Some(ChannelAssignment {
                    channel,
                    source: RhythmChoiceSource::Position,
                    position: Some(metadata),
                }))
            }
            cseq_rhythm::ChannelPositionAction::ResetMarkov => {
                let Some(channel) = choose_channel_position_reset_channel(rule, spec, rng) else {
                    return Ok(None);
                };
                let choice = assigner.reset_channel_with_spec(spec, channel)?;
                Ok(Some(ChannelAssignment {
                    channel: choice.channel,
                    source: choice.source,
                    position: Some(metadata),
                }))
            }
        };
    }
    Ok(None)
}

pub(crate) fn channel_position_rule_matches(
    rule: &cseq_rhythm::ChannelPositionRule,
    position: ChannelNotePosition,
) -> bool {
    match rule.scope {
        cseq_rhythm::ChannelPositionScope::Beat => position.nth_in_beat == rule.nth,
        cseq_rhythm::ChannelPositionScope::Section => {
            position.section_index.is_some() && position.nth_in_section == Some(rule.nth)
        }
    }
}

pub(crate) fn choose_channel_position_action(
    rule: &cseq_rhythm::ChannelPositionRule,
    spec: &ChannelHocketSpec,
    rng: &mut HocketRng,
) -> Option<cseq_rhythm::ChannelPositionAction> {
    let mut choices = Vec::with_capacity(3);
    if rule.action_weights.normal_markov > 0 {
        choices.push((
            cseq_rhythm::ChannelPositionAction::NormalMarkov,
            rule.action_weights.normal_markov,
        ));
    }
    if rule.action_weights.render_only > 0
        && has_positive_enabled_channel_weight(&rule.render_weights, spec)
    {
        choices.push((
            cseq_rhythm::ChannelPositionAction::RenderOnly,
            rule.action_weights.render_only,
        ));
    }
    if rule.action_weights.reset_markov > 0 && channel_position_reset_has_target(&rule.reset, spec)
    {
        choices.push((
            cseq_rhythm::ChannelPositionAction::ResetMarkov,
            rule.action_weights.reset_markov,
        ));
    }
    weighted_u32_choice(&choices, rng)
}

pub(crate) fn choose_channel_position_render_channel(
    rule: &cseq_rhythm::ChannelPositionRule,
    spec: &ChannelHocketSpec,
    rng: &mut HocketRng,
) -> Option<u8> {
    choose_channel_weight(&rule.render_weights, spec, rng)
}

pub(crate) fn choose_channel_position_reset_channel(
    rule: &cseq_rhythm::ChannelPositionRule,
    spec: &ChannelHocketSpec,
    rng: &mut HocketRng,
) -> Option<u8> {
    match rule.reset.mode {
        cseq_rhythm::ChannelPositionResetMode::StaticFallback => Some(spec.fallback),
        cseq_rhythm::ChannelPositionResetMode::WeightedFallback => {
            choose_channel_fallback_weight(&spec.fallback_weights, spec, rng)
                .or(Some(spec.fallback))
        }
        cseq_rhythm::ChannelPositionResetMode::CustomWeighted => {
            choose_channel_weight(&rule.reset.weights, spec, rng)
        }
    }
}

pub(crate) fn channel_position_reset_has_target(
    reset: &cseq_rhythm::ChannelPositionResetSpec,
    spec: &ChannelHocketSpec,
) -> bool {
    match reset.mode {
        cseq_rhythm::ChannelPositionResetMode::StaticFallback
        | cseq_rhythm::ChannelPositionResetMode::WeightedFallback => true,
        cseq_rhythm::ChannelPositionResetMode::CustomWeighted => {
            has_positive_enabled_channel_weight(&reset.weights, spec)
        }
    }
}

pub(crate) fn has_positive_enabled_channel_weight(
    weights: &[cseq_rhythm::ChannelAccentWeight],
    spec: &ChannelHocketSpec,
) -> bool {
    weights
        .iter()
        .any(|weight| weight.weight > 0 && spec.channels.contains(&weight.channel))
}

pub(crate) fn choose_channel_weight(
    weights: &[cseq_rhythm::ChannelAccentWeight],
    spec: &ChannelHocketSpec,
    rng: &mut HocketRng,
) -> Option<u8> {
    let candidates = weights
        .iter()
        .filter(|weight| weight.weight > 0 && spec.channels.contains(&weight.channel))
        .collect::<Vec<_>>();
    let total = candidates
        .iter()
        .map(|weight| u64::from(weight.weight))
        .sum::<u64>();
    if total == 0 {
        return None;
    }
    let mut pick = rng.next_below(total);
    for candidate in candidates {
        let weight = u64::from(candidate.weight);
        if pick < weight {
            return Some(candidate.channel);
        }
        pick -= weight;
    }
    None
}

pub(crate) fn choose_channel_fallback_weight(
    weights: &[cseq_rhythm::ChannelFallbackWeight],
    spec: &ChannelHocketSpec,
    rng: &mut HocketRng,
) -> Option<u8> {
    let candidates = weights
        .iter()
        .filter(|weight| weight.weight > 0 && spec.channels.contains(&weight.channel))
        .collect::<Vec<_>>();
    let total = candidates
        .iter()
        .map(|weight| u64::from(weight.weight))
        .sum::<u64>();
    if total == 0 {
        return None;
    }
    let mut pick = rng.next_below(total);
    for candidate in candidates {
        let weight = u64::from(candidate.weight);
        if pick < weight {
            return Some(candidate.channel);
        }
        pick -= weight;
    }
    None
}

pub(crate) fn weighted_u32_choice<T: Copy>(choices: &[(T, u32)], rng: &mut HocketRng) -> Option<T> {
    let total = choices
        .iter()
        .map(|(_, weight)| u64::from(*weight))
        .sum::<u64>();
    if total == 0 {
        return None;
    }
    let mut pick = rng.next_below(total);
    for (value, weight) in choices {
        let weight = u64::from(*weight);
        if pick < weight {
            return Some(*value);
        }
        pick -= weight;
    }
    None
}

pub(crate) fn choose_accent_channel_assignment(
    spec: &ChannelHocketSpec,
    group: &[ChannelNoteGroup],
    rng: &mut HocketRng,
) -> Option<AccentChannelAssignment> {
    let velocity = group.iter().map(|note| note.velocity).max()?;
    for rule in &spec.accent_rules {
        let lo = rule.min_velocity.min(rule.max_velocity);
        let hi = rule.min_velocity.max(rule.max_velocity);
        if velocity < lo || velocity > hi || rule.probability <= 0.0 {
            continue;
        }
        if rng.next_f32() >= rule.probability.clamp(0.0, 1.0) {
            continue;
        }
        let candidates = rule
            .weights
            .iter()
            .filter(|weight| weight.weight > 0 && spec.channels.contains(&weight.channel))
            .collect::<Vec<_>>();
        let total = candidates
            .iter()
            .map(|weight| u64::from(weight.weight))
            .sum::<u64>();
        if total == 0 {
            continue;
        }
        let mut pick = rng.next_below(total);
        for candidate in candidates {
            let weight = u64::from(candidate.weight);
            if pick < weight {
                return Some(AccentChannelAssignment {
                    channel: candidate.channel,
                    mode: rule.mode,
                });
            }
            pick -= weight;
        }
    }
    None
}

pub(crate) fn assign_channel_group(
    events: &mut [QueuedEvent],
    group: &[ChannelNoteGroup],
    assignment: &ChannelAssignment,
    cycle: u64,
    cycle_base_tick: u64,
    out: &mut Vec<ChannelHocketPlaybackEvent>,
) {
    for note_group in group {
        set_queued_event_channel(&mut events[note_group.on_index], assignment.channel);
        set_queued_event_channel(&mut events[note_group.off_index], assignment.channel);
        out.push(ChannelHocketPlaybackEvent {
            cycle,
            start_tick: note_group.start_tick.saturating_sub(cycle_base_tick),
            end_tick: note_group.end_tick.saturating_sub(cycle_base_tick),
            channel: assignment.channel,
            source: assignment.source,
            fallback: assignment.source == RhythmChoiceSource::Fallback,
            position_rule_id: assignment
                .position
                .as_ref()
                .map(|position| position.rule_id.clone()),
            position_rule_label: assignment
                .position
                .as_ref()
                .map(|position| position.label.clone()),
            position_scope: assignment.position.as_ref().map(|position| position.scope),
            position_nth: assignment.position.as_ref().map(|position| position.nth),
            position_action: assignment.position.as_ref().map(|position| position.action),
            parallel_track_index: None,
            parallel_track_id: None,
            parallel_track_name: None,
            suppressed: false,
        });
    }
}

pub(crate) fn set_queued_event_channel(event: &mut QueuedEvent, user_channel: u8) {
    let channel = user_channel_to_wire_channel(user_channel);
    event.user_channel = Some(wire_channel_to_user_channel(channel));
    event.bytes[0] = (event.bytes[0] & 0xF0) | channel;
}

pub(crate) fn apply_static_midi_channel_to_queue(
    queue: &mut VecDeque<QueuedEvent>,
    user_channel: u8,
) {
    let channel = user_channel.clamp(1, 16);
    for event in queue.iter_mut() {
        if event.len == 3 && event.bytes[0] < 0xF0 {
            set_queued_event_channel(event, channel);
        }
    }
}

pub(crate) fn is_note_on_event(event: &QueuedEvent) -> bool {
    event.len == 3 && event.bytes[0] & 0xF0 == 0x90 && event.bytes[2] > 0
}

pub(crate) struct HocketRng {
    state: u64,
}

impl HocketRng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn next_f32(&mut self) -> f32 {
        let value = self.next_u64() >> 40;
        value as f32 / (1u64 << 24) as f32
    }

    fn next_below(&mut self, upper_exclusive: u64) -> u64 {
        if upper_exclusive == 0 {
            return 0;
        }
        self.next_u64() % upper_exclusive
    }
}
