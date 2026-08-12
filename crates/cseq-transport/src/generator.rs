#[allow(unused_imports)]
use crate::*;

#[cfg(test)]
std::thread_local! {
    static OBSERVED_GENERATOR_TRACK_IDS: std::cell::RefCell<Vec<Option<String>>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub(crate) fn take_observed_generator_track_ids() -> Vec<Option<String>> {
    OBSERVED_GENERATOR_TRACK_IDS.with(|observed| std::mem::take(&mut *observed.borrow_mut()))
}

#[derive(Debug, Clone, PartialEq)]
pub struct RhythmPlaybackConfig {
    pub generator_enabled: bool,
    pub generator: cseq_rhythm::GeneratorConfig,
    /// User-facing static MIDI output channel, 1-16. Used whenever channel
    /// hocketing is disabled.
    pub midi_output_channel: u8,
    pub automation: Option<AutomationSet>,
    pub channel_hocket_enabled: bool,
    pub channel_hocket: Option<ChannelHocketSpec>,
    pub seed_path: Option<SeedPathPlaybackConfig>,
}

pub(crate) fn automate_seed_mode(
    automation: &AutomationSet,
    scope: AutomationSampleScope,
    mode: &mut RhythmSeedMode,
    prefix: &str,
) {
    let RhythmSeedMode::History {
        history_weight,
        new_seed_weight,
        max_history,
        ..
    } = mode
    else {
        return;
    };
    if let Some(value) = sample_automation_weight(
        automation,
        scope,
        &format!("{prefix}.historyWeight"),
        *history_weight,
    ) {
        *history_weight = value;
    }
    if let Some(value) = sample_automation_weight(
        automation,
        scope,
        &format!("{prefix}.newSeedWeight"),
        *new_seed_weight,
    ) {
        *new_seed_weight = value;
    }
    if let Some(value) = sample_automation_u32(
        automation,
        scope,
        &format!("{prefix}.maxHistory"),
        (*max_history).try_into().unwrap_or(64),
        0,
        64,
    ) {
        *max_history = value as usize;
    }
}

pub(crate) fn sync_rhythm_playback_seed_state(
    original: &mut RhythmPlaybackConfig,
    effective: &RhythmPlaybackConfig,
) {
    original.generator = effective.generator.clone();
    if let (Some(original), Some(effective)) = (
        original.channel_hocket.as_mut(),
        effective.channel_hocket.as_ref(),
    ) {
        original.seed_mode = effective.seed_mode.clone();
    }
}

pub(crate) fn apply_rhythm_playback_automation(
    config: &mut RhythmPlaybackConfig,
    score: &Score,
    cycle: u64,
) {
    let Some(automation) = config.automation.clone() else {
        return;
    };
    if automation.tracks.is_empty() {
        return;
    }
    let scope = AutomationSampleScope::cycle_start(score, cycle);
    if let Some(channel) = sample_automation_u8(
        &automation,
        scope,
        "transport.midiOutputChannel",
        config.midi_output_channel,
        1,
        16,
    )
    .or_else(|| {
        sample_automation_u8(
            &automation,
            scope,
            "channelHocket.outputChannel",
            config.midi_output_channel,
            1,
            16,
        )
    }) {
        config.midi_output_channel = channel;
    }
    automate_channel_hocket(&automation, scope, config);
}

pub(crate) fn automate_channel_hocket(
    automation: &AutomationSet,
    scope: AutomationSampleScope,
    config: &mut RhythmPlaybackConfig,
) {
    if let Some(enabled) = sample_automation_bool(
        automation,
        scope,
        "channelHocket.enabled",
        config.channel_hocket_enabled,
    ) {
        config.channel_hocket_enabled = enabled;
    }
    let Some(spec) = config.channel_hocket.as_mut() else {
        return;
    };
    automate_channel_hocket_spec(automation, scope, spec);
}

pub(crate) fn automate_channel_hocket_spec(
    automation: &AutomationSet,
    scope: AutomationSampleScope,
    spec: &mut ChannelHocketSpec,
) {
    automate_seed_mode(automation, scope, &mut spec.seed_mode, "channelHocket.seed");
    if let Some(value) = sample_automation_u8(
        automation,
        scope,
        "channelHocket.fallback.staticChannel",
        spec.fallback,
        1,
        16,
    ) {
        spec.fallback = value;
    }
    for channel in &spec.channels {
        let target = format!("channelHocket.fallback.channel.{channel}.weight");
        let base = spec
            .fallback_weights
            .iter()
            .find(|weight| weight.channel == *channel)
            .map(|weight| weight.weight)
            .unwrap_or(0);
        if let Some(weight) = sample_automation_weight(automation, scope, &target, base) {
            if let Some(index) = spec
                .fallback_weights
                .iter()
                .position(|item| item.channel == *channel)
            {
                if weight == 0 {
                    spec.fallback_weights.remove(index);
                } else {
                    spec.fallback_weights[index].weight = weight;
                }
            } else if weight > 0 {
                spec.fallback_weights
                    .push(cseq_rhythm::ChannelFallbackWeight {
                        channel: *channel,
                        weight,
                    });
            }
        }
    }
    for from in channel_contexts(&spec.channels, spec.order) {
        for to in spec.channels.clone() {
            let target = format!(
                "channelHocket.matrix.{}.{}.to.{}.weight",
                markov_order_target_part(spec.order),
                from.iter().map(u8::to_string).collect::<Vec<_>>().join("."),
                to
            );
            let base = spec
                .transitions
                .iter()
                .find(|transition| transition.from == from && transition.to == to)
                .map(|transition| transition.weight)
                .unwrap_or(0);
            if let Some(weight) = sample_automation_weight(automation, scope, &target, base) {
                upsert_channel_transition(spec, from.clone(), to, weight);
            }
        }
    }
    if let Some(euclid) = spec.euclid.as_mut() {
        // Euclid pattern geometry is automatable like any numeric target;
        // the assigner re-reads the table per group, so a rotation or pulse
        // lane sweeps the pattern mid-cycle without disturbing the index
        // (the roadmap's "rotation per beat, section, or span").
        let max_steps = cseq_rhythm::EUCLID_MAX_STEPS as u8;
        if let Some(value) = sample_automation_u8(
            automation,
            scope,
            "channelHocket.euclid.steps",
            euclid.steps.min(255) as u8,
            1,
            max_steps,
        ) {
            euclid.steps = u32::from(value);
        }
        for (layer_index, layer) in euclid.layers.iter_mut().enumerate() {
            let pulses_target = format!("channelHocket.euclid.layer.{layer_index}.pulses");
            if let Some(value) = sample_automation_u8(
                automation,
                scope,
                &pulses_target,
                layer.pulses.min(255) as u8,
                0,
                max_steps,
            ) {
                layer.pulses = u32::from(value);
            }
            let rotation_target = format!("channelHocket.euclid.layer.{layer_index}.rotation");
            if let Some(value) = sample_automation_u8(
                automation,
                scope,
                &rotation_target,
                layer.rotation.min(255) as u8,
                0,
                max_steps.saturating_sub(1),
            ) {
                layer.rotation = u32::from(value);
            }
            let max_run_target = format!("channelHocket.euclid.layer.{layer_index}.maxRun");
            if let Some(value) = sample_automation_u8(
                automation,
                scope,
                &max_run_target,
                layer.max_run.min(255) as u8,
                1,
                max_steps,
            ) {
                layer.max_run = u32::from(value);
            }
            let steps_target = format!("channelHocket.euclid.layer.{layer_index}.steps");
            if let Some(value) = sample_automation_u8(
                automation,
                scope,
                &steps_target,
                layer.steps.min(255) as u8,
                1,
                max_steps,
            ) {
                layer.steps = u32::from(value);
            }
        }
    }
    for (rule_index, rule) in spec.accent_rules.iter_mut().enumerate() {
        let enabled_target = format!("channelHocket.accentRule.{rule_index}.enabled");
        if let Some(value) = sample_automation_bool(automation, scope, &enabled_target, true) {
            if !value {
                rule.probability = 0.0;
            }
        }
        let min_target = format!("channelHocket.accentRule.{rule_index}.minVelocity");
        if let Some(value) =
            sample_automation_u8(automation, scope, &min_target, rule.min_velocity, 0, 127)
        {
            rule.min_velocity = value;
        }
        let max_target = format!("channelHocket.accentRule.{rule_index}.maxVelocity");
        if let Some(value) =
            sample_automation_u8(automation, scope, &max_target, rule.max_velocity, 0, 127)
        {
            rule.max_velocity = value;
        }
        if rule.max_velocity < rule.min_velocity {
            std::mem::swap(&mut rule.min_velocity, &mut rule.max_velocity);
        }
        let probability_target =
            format!("channelHocket.accentRule.{rule_index}.probabilityPercent");
        if let Some(value) =
            sample_automation_unit_percent(automation, scope, &probability_target, rule.probability)
        {
            rule.probability = value;
        }
        for channel in &spec.channels {
            let target = format!("channelHocket.accentRule.{rule_index}.channel.{channel}.weight");
            let base = rule
                .weights
                .iter()
                .find(|weight| weight.channel == *channel)
                .map(|weight| weight.weight)
                .unwrap_or(0);
            if let Some(weight) = sample_automation_weight(automation, scope, &target, base) {
                if let Some(index) = rule
                    .weights
                    .iter()
                    .position(|item| item.channel == *channel)
                {
                    if weight == 0 {
                        rule.weights.remove(index);
                    } else {
                        rule.weights[index].weight = weight;
                    }
                } else if weight > 0 {
                    rule.weights.push(cseq_rhythm::ChannelAccentWeight {
                        channel: *channel,
                        weight,
                    });
                }
            }
        }
    }
    let channels = spec.channels.clone();
    for rule in &mut spec.position_rules {
        let rule_id = sanitize_target_id_part(&rule.id);
        let prefix = format!("channelHocket.positionRule.{rule_id}");
        let enabled_target = format!("{prefix}.enabled");
        if let Some(enabled) =
            sample_automation_bool(automation, scope, &enabled_target, rule.enabled)
        {
            rule.enabled = enabled;
        }
        let nth_target = format!("{prefix}.nth");
        if let Some(nth) = sample_automation_u32(automation, scope, &nth_target, rule.nth, 1, 4096)
        {
            rule.nth = nth;
        }
        let normal_target = format!("{prefix}.action.normalMarkov.weight");
        if let Some(weight) = sample_automation_weight(
            automation,
            scope,
            &normal_target,
            rule.action_weights.normal_markov,
        ) {
            rule.action_weights.normal_markov = weight;
        }
        let render_target = format!("{prefix}.action.renderOnly.weight");
        if let Some(weight) = sample_automation_weight(
            automation,
            scope,
            &render_target,
            rule.action_weights.render_only,
        ) {
            rule.action_weights.render_only = weight;
        }
        let reset_target = format!("{prefix}.action.resetMarkov.weight");
        if let Some(weight) = sample_automation_weight(
            automation,
            scope,
            &reset_target,
            rule.action_weights.reset_markov,
        ) {
            rule.action_weights.reset_markov = weight;
        }
        for channel in &channels {
            let target = format!("{prefix}.render.channel.{channel}.weight");
            let base = rule
                .render_weights
                .iter()
                .find(|weight| weight.channel == *channel)
                .map(|weight| weight.weight)
                .unwrap_or(0);
            if let Some(weight) = sample_automation_weight(automation, scope, &target, base) {
                upsert_channel_weight(&mut rule.render_weights, *channel, weight);
            }
            let target = format!("{prefix}.reset.channel.{channel}.weight");
            let base = rule
                .reset
                .weights
                .iter()
                .find(|weight| weight.channel == *channel)
                .map(|weight| weight.weight)
                .unwrap_or(0);
            if let Some(weight) = sample_automation_weight(automation, scope, &target, base) {
                upsert_channel_weight(&mut rule.reset.weights, *channel, weight);
            }
        }
    }
}

pub(crate) fn upsert_channel_transition(
    spec: &mut ChannelHocketSpec,
    from: Vec<u8>,
    to: u8,
    weight: u32,
) {
    if let Some(index) = spec
        .transitions
        .iter()
        .position(|transition| transition.from == from && transition.to == to)
    {
        if weight == 0 {
            spec.transitions.remove(index);
        } else {
            spec.transitions[index].weight = weight;
        }
    } else if weight > 0 {
        spec.transitions
            .push(cseq_rhythm::ChannelTransition { from, to, weight });
    }
}

pub(crate) fn upsert_channel_weight(
    weights: &mut Vec<cseq_rhythm::ChannelAccentWeight>,
    channel: u8,
    weight: u32,
) {
    if let Some(index) = weights.iter().position(|item| item.channel == channel) {
        if weight == 0 {
            weights.remove(index);
        } else {
            weights[index].weight = weight;
        }
    } else if weight > 0 {
        weights.push(cseq_rhythm::ChannelAccentWeight { channel, weight });
    }
}

pub(crate) fn playback_seed_trace_from_switch(trace: SwitchSeedTrace) -> PlaybackSeedTraceEvent {
    PlaybackSeedTraceEvent {
        cycle: trace.cycle,
        domain: "global".to_string(),
        label: format!(
            "Score transform {} node {}",
            trace.transform_id, trace.node_id
        ),
        seed: trace.seed,
        base_seed: None,
        source: switch_seed_source_label(trace.source).to_string(),
        history_before: trace.history_before,
        history_after: trace.history_after,
        parallel_track_index: None,
        track_id: None,
    }
}

pub(crate) struct PlaybackSeedResolution {
    pub(crate) seed: u64,
    pub(crate) base_seed: Option<u64>,
    pub(crate) source: String,
    pub(crate) history_before: Vec<u64>,
    pub(crate) history_after: Vec<u64>,
}

pub(crate) fn playback_seed_trace_from_resolution(
    cycle: u64,
    domain: &str,
    label: &str,
    seed: PlaybackSeedResolution,
) -> PlaybackSeedTraceEvent {
    PlaybackSeedTraceEvent {
        cycle,
        domain: domain.to_string(),
        label: label.to_string(),
        seed: seed.seed,
        base_seed: seed.base_seed,
        source: seed.source,
        history_before: seed.history_before,
        history_after: seed.history_after,
        parallel_track_index: None,
        track_id: None,
    }
}

/// Seed-path lineage entry for a triggered track's GATE (Plan Phase C). The
/// gate's probability rolls are seeded by stable candidate identity inside
/// `cseq-trigger`; this records the per-cycle base-seed lineage so the seed-path
/// panel shows the `trigger` domain alongside generator and channel data. This is
/// display-only lineage; Phase E owns any seed-path lock/replay override.
pub(crate) fn playback_seed_trace_for_trigger(
    cycle: u64,
    base_seed: u64,
    track_index: usize,
    track_id: &str,
) -> PlaybackSeedTraceEvent {
    PlaybackSeedTraceEvent {
        cycle,
        domain: "trigger".to_string(),
        label: format!("Trigger gate display seed {base_seed}"),
        seed: cseq_rhythm::mix_seed(base_seed ^ 0x7416_6EA7_E9A7_0001, cycle),
        base_seed: Some(base_seed),
        source: "stableIdentity".to_string(),
        history_before: vec![],
        history_after: vec![],
        parallel_track_index: Some(track_index),
        track_id: Some(track_id.to_string()),
    }
}

/// Flatten one pure `cseq_trigger::TriggerDecision` into the UI-facing event.
pub(crate) fn trigger_decision_event(
    track_index: usize,
    track_id: &str,
    track_name: &str,
    decision: &cseq_trigger::TriggerDecision,
) -> TriggerDecisionEvent {
    let (outcome, suppress_reason, launch_tick, run_index) = match decision.outcome {
        cseq_trigger::DecisionOutcome::Launched {
            launch_tick,
            run_index,
            ..
        } => (
            "launched".to_string(),
            None,
            Some(launch_tick),
            Some(run_index),
        ),
        cseq_trigger::DecisionOutcome::Queued => ("queued".to_string(), None, None, None),
        cseq_trigger::DecisionOutcome::Suppressed { reason } => {
            let reason = match reason {
                cseq_trigger::SuppressReason::GateProbability => "gateProbability",
                cseq_trigger::SuppressReason::GateCooldown => "gateCooldown",
                cseq_trigger::SuppressReason::ReTriggerIgnore => "reTriggerIgnore",
                cseq_trigger::SuppressReason::ReTriggerQueueFull => "reTriggerQueueFull",
            };
            (
                "suppressed".to_string(),
                Some(reason.to_string()),
                None,
                None,
            )
        }
    };
    let start_kind = match decision.start_alignment {
        cseq_trigger::LaunchAlignment::AtEvent => "atEvent",
        cseq_trigger::LaunchAlignment::AtSourceCycleStart => "atSourceCycleStart",
        cseq_trigger::LaunchAlignment::AtNextReferenceBeat => "atNextReferenceBeat",
        cseq_trigger::LaunchAlignment::AfterEventTicks { .. } => "afterEventTicks",
        cseq_trigger::LaunchAlignment::CenterInRest => "centerInRest",
        cseq_trigger::LaunchAlignment::AtSourceReturn => "atSourceReturn",
    }
    .to_string();
    let roll = decision.gate_rolls.first();
    TriggerDecisionEvent {
        track_index,
        track_id: track_id.to_string(),
        track_name: track_name.to_string(),
        source_cycle_index: decision.source_cycle_index,
        matched_beat: decision.matched_beat,
        event_tick: decision.event_reference_tick,
        candidate_tick: decision.candidate_tick,
        start_kind,
        outcome,
        suppress_reason,
        launch_tick,
        run_index,
        roll_value: roll.map(|r| r.value),
        roll_threshold: roll.map(|r| r.threshold),
        roll_passed: roll.map(|r| r.passed),
        consecutive_misses: decision.gate_state_after.consecutive_misses,
        last_accept_source_cycle: decision.gate_state_after.last_accept_source_cycle,
    }
}

pub(crate) fn trigger_max_after_event_ticks(config: &cseq_trigger::TriggerConfig) -> u64 {
    let mut max_ticks = match config.launch_alignment {
        cseq_trigger::LaunchAlignment::AfterEventTicks { ticks } => ticks,
        _ => 0,
    };
    if let Some(select) = config.start_select.as_ref() {
        for option in &select.options {
            if let cseq_trigger::LaunchAlignment::AfterEventTicks { ticks } = option.alignment {
                max_ticks = max_ticks.max(ticks);
            }
        }
    }
    max_ticks
}

pub(crate) fn switch_seed_source_label(source: SwitchSeedTraceSource) -> &'static str {
    match source {
        SwitchSeedTraceSource::Locked => "locked",
        SwitchSeedTraceSource::PerCycle => "perCycle",
        SwitchSeedTraceSource::History => "history",
        SwitchSeedTraceSource::New => "new",
    }
}

pub(crate) fn rhythm_seed_source_label(source: RhythmSeedSource) -> &'static str {
    match source {
        RhythmSeedSource::FollowGlobal => "followGlobal",
        RhythmSeedSource::Locked => "locked",
        RhythmSeedSource::PerCycle => "perCycle",
        RhythmSeedSource::History => "history",
        RhythmSeedSource::New => "new",
    }
}

pub(crate) fn switch_seed_source_from_label(source: &str) -> SwitchSeedTraceSource {
    match source {
        "perCycle" => SwitchSeedTraceSource::PerCycle,
        "history" => SwitchSeedTraceSource::History,
        "new" => SwitchSeedTraceSource::New,
        _ => SwitchSeedTraceSource::Locked,
    }
}

pub(crate) fn rhythm_seed_history_before(seed_mode: &RhythmSeedMode) -> Vec<u64> {
    match seed_mode {
        RhythmSeedMode::History { history, .. } => history.clone(),
        RhythmSeedMode::FollowGlobal
        | RhythmSeedMode::Locked { .. }
        | RhythmSeedMode::PerCycle { .. } => Vec::new(),
    }
}

pub(crate) fn apply_rhythm_seed_history_after(
    seed_mode: &mut RhythmSeedMode,
    history_after: &[u64],
) {
    if let RhythmSeedMode::History { history, .. } = seed_mode {
        *history = history_after.to_vec();
    }
}

pub(crate) fn playback_seed_resolution_from_rhythm(
    seed: cseq_rhythm::RhythmSeedResolution,
    history_before: Vec<u64>,
) -> PlaybackSeedResolution {
    PlaybackSeedResolution {
        seed: seed.seed,
        base_seed: None,
        source: rhythm_seed_source_label(seed.source).to_string(),
        history_before,
        history_after: seed.history,
    }
}

pub(crate) fn generator_seed_history_before(
    seed_mode: &cseq_rhythm::GeneratorSeedMode,
) -> Vec<u64> {
    match seed_mode {
        cseq_rhythm::GeneratorSeedMode::History { history, .. } => history.clone(),
        cseq_rhythm::GeneratorSeedMode::Locked { .. }
        | cseq_rhythm::GeneratorSeedMode::PerCycle { .. } => Vec::new(),
    }
}

pub(crate) fn apply_generator_seed_history_after(
    seed_mode: &mut cseq_rhythm::GeneratorSeedMode,
    history_after: &[u64],
) {
    if let cseq_rhythm::GeneratorSeedMode::History { history, .. } = seed_mode {
        *history = history_after.to_vec();
    }
}

pub(crate) fn generator_seed_source_label(
    source: cseq_rhythm::GeneratorSeedSource,
) -> &'static str {
    match source {
        cseq_rhythm::GeneratorSeedSource::Locked => "locked",
        cseq_rhythm::GeneratorSeedSource::PerCycle => "perCycle",
        cseq_rhythm::GeneratorSeedSource::History => "history",
        cseq_rhythm::GeneratorSeedSource::New => "new",
    }
}

pub(crate) fn generator_seed_trace_label(config: &cseq_rhythm::GeneratorConfig) -> &'static str {
    match config {
        cseq_rhythm::GeneratorConfig::Example(_) => "Example Generator",
        cseq_rhythm::GeneratorConfig::Dumka(_) => "Dum-Ka Generator",
    }
}

pub(crate) fn playback_seed_resolution_from_generator(
    seed: cseq_rhythm::GeneratorSeedResolution,
    history_before: Vec<u64>,
) -> PlaybackSeedResolution {
    PlaybackSeedResolution {
        seed: seed.seed,
        base_seed: None,
        source: generator_seed_source_label(seed.source).to_string(),
        history_before,
        history_after: seed.history,
    }
}

pub(crate) fn playback_seed_resolution_from_seed_path(
    entry: &SeedPathPlaybackEntry,
) -> PlaybackSeedResolution {
    PlaybackSeedResolution {
        seed: entry.seed,
        base_seed: entry.base_seed,
        source: entry.source.clone(),
        history_before: entry.history_before.clone(),
        history_after: entry.history_after.clone(),
    }
}

/// Track-matching rule for seed-path replay. A recorded `None` track id is a
/// legacy/single-track entry and matches any replaying track; a replaying
/// `None` track (single-track playback) accepts any recorded entry; two
/// concrete ids must be equal. This keeps single-track and legacy replay
/// byte-identical while making multi-track replay track-precise.
pub(crate) fn seed_path_track_matches(recorded: Option<&str>, replaying: Option<&str>) -> bool {
    match (recorded, replaying) {
        (None, _) => true,
        (_, None) => true,
        (Some(a), Some(b)) => a == b,
    }
}

pub(crate) fn seed_path_has_wildcard(
    path: &SeedPathPlaybackConfig,
    domain: &str,
    cycle: u64,
    track_id: Option<&str>,
) -> bool {
    path.wildcards.iter().any(|wildcard| {
        wildcard.domain == domain
            && wildcard
                .cycle
                .map_or(true, |wild_cycle| wild_cycle == cycle)
            && seed_path_track_matches(wildcard.track_id.as_deref(), track_id)
    })
}

pub(crate) fn seed_path_entries_for_domain<'a>(
    path: Option<&'a SeedPathPlaybackConfig>,
    cycle: u64,
    domain: &str,
    track_id: Option<&str>,
) -> Vec<&'a SeedPathPlaybackEntry> {
    let Some(path) = path else {
        return Vec::new();
    };
    if seed_path_has_wildcard(path, domain, cycle, track_id) {
        return Vec::new();
    }
    path.entries
        .iter()
        .filter(|entry| {
            entry.cycle == cycle
                && entry.domain == domain
                && seed_path_track_matches(entry.track_id.as_deref(), track_id)
        })
        .collect()
}

pub(crate) fn seed_path_entry_for_domain<'a>(
    path: Option<&'a SeedPathPlaybackConfig>,
    cycle: u64,
    domain: &str,
    track_id: Option<&str>,
) -> Option<&'a SeedPathPlaybackEntry> {
    seed_path_entries_for_domain(path, cycle, domain, track_id)
        .into_iter()
        .next()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_generator_to_tree(
    tree: &mut DurationTree,
    cycle_length: Rational,
    config: &mut RhythmPlaybackConfig,
    cycle: u64,
    cycle_beats: u32,
    generator_seed_replay: Option<&SeedPathPlaybackEntry>,
    track_id: Option<&str>,
) -> Result<(RhythmOverlayResult, Option<PlaybackSeedResolution>), TransportError> {
    let active_spans = rhythm_accent_spans(&tree.pulse_spans);
    let spans = active_spans
        .iter()
        .map(|span| cseq_rhythm::GeneratorSpanInput::from(*span))
        .collect::<Vec<_>>();
    if spans.is_empty() {
        return Ok((RhythmOverlayResult::default(), None));
    }
    let seed = if let Some(entry) = generator_seed_replay {
        apply_generator_seed_history_after(config.generator.seed_mode_mut(), &entry.history_after);
        playback_seed_resolution_from_seed_path(entry)
    } else {
        let history_before = generator_seed_history_before(config.generator.seed_mode());
        let seed = cseq_rhythm::resolve_generator_seed(config.generator.seed_mode_mut(), cycle)
            .map_err(|error| TransportError::Realize(error.to_string()))?;
        playback_seed_resolution_from_generator(seed, history_before)
    };
    let automation = |target: &str, sample_cycle: u64, default: f64| {
        let automation = config.automation.as_ref()?;
        if !automation_target_has_enabled_source(automation, target) {
            return None;
        }
        let scope = AutomationSampleScope {
            cycle: sample_cycle,
            beat_index: 0,
            cycle_beats,
            phase: None,
        };
        Some(
            sample_automation_number(
                automation,
                scope,
                target,
                default,
                AutomationValueKind::Float,
                -f64::MAX,
                f64::MAX,
            )
            .unwrap_or(default),
        )
    };
    #[cfg(test)]
    OBSERVED_GENERATOR_TRACK_IDS.with(|observed| {
        observed.borrow_mut().push(track_id.map(ToOwned::to_owned));
    });
    let context = cseq_rhythm::GeneratorCycleContext {
        track_id,
        cycle,
        cycle_beats,
        spans: &spans,
        seed: seed.seed,
        automation: &automation,
    };
    let resolved_spans = cseq_rhythm::resolve_generator_cycle(&config.generator, &context)
        .map_err(|error| TransportError::Realize(error.to_string()))?;
    let mut resolved_by_span = resolved_spans
        .into_iter()
        .map(|span| (span.span_id, span))
        .collect::<std::collections::HashMap<_, _>>();

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

    let rhythm_spans = active_spans.into_iter().cloned().collect::<Vec<_>>();
    let all_pulse_spans = tree.pulse_spans.clone();

    let mut rhythm_cells = Vec::new();
    for span in rhythm_spans {
        let Some(resolved_span) = resolved_by_span.get_mut(&span.id) else {
            continue;
        };
        let span_start = span.start;
        let span_end = span.start + span.duration;
        let span_leaves = leaves
            .iter()
            .filter(|leaf| leaf.offset >= span_start && leaf.offset < span_end)
            .cloned()
            .collect::<Vec<_>>();
        if span_leaves.is_empty() {
            continue;
        }

        for leaf in &span_leaves {
            silence_pulse(tree, leaf.node_id)?;
        }

        append_rhythm_cells(
            &span,
            resolved_span,
            &span_leaves,
            &all_pulse_spans,
            &mut rhythm_cells,
        );
    }
    let mut result = RhythmOverlayResult::default();
    emit_rhythm_overlay_events(&rhythm_cells, &mut result.events);
    // Surface the realized rhythm spans (sorted by span id for determinism) so the
    // live timeline rhythm row can render exactly what was scheduled this cycle.
    let mut resolved_spans = resolved_by_span.into_values().collect::<Vec<_>>();
    resolved_spans.sort_by_key(|span| span.span_id);
    result.resolved_spans = resolved_spans;

    Ok((result, Some(seed)))
}
