#[allow(unused_imports)]
use crate::*;

pub(crate) fn validate_score_for_transport(score: &Score) -> Result<(), String> {
    if score.duration_tree.get(score.duration_tree.root).is_none() {
        return Err(format!(
            "duration tree root {} is missing",
            score.duration_tree.root
        ));
    }

    let tpc = ticks_per_cycle(score);
    if tpc == 0 {
        return Err("cycle length must produce at least one transport tick".to_string());
    }
    if tpc > MAX_TRANSPORT_TICKS_PER_CYCLE {
        return Err(format!(
            "cycle length produces {tpc} ticks; maximum is {MAX_TRANSPORT_TICKS_PER_CYCLE}"
        ));
    }

    let effective_tree = cseq_transforms::apply_pipeline_for_cycle(score, 0)
        .map_err(|error| format!("transform pipeline failed: {error}"))?;
    let effective_score = Score {
        duration_tree: effective_tree,
        ..score.clone()
    };
    cseq_realize::realize(&effective_score, 0, 0)
        .map_err(|error| format!("deterministic realization failed: {error}"))?;

    Ok(())
}

pub(crate) fn validate_rhythm_playback_config(config: &RhythmPlaybackConfig) -> Result<(), String> {
    if !(1..=16).contains(&config.midi_output_channel) {
        return Err(format!(
            "static MIDI output channel {} must be 1-16",
            config.midi_output_channel
        ));
    }
    config
        .generator
        .validate()
        .map_err(|error| format!("generator: {error}"))?;
    if config.channel_hocket_enabled {
        let spec = config
            .channel_hocket
            .as_ref()
            .ok_or_else(|| "channel hocket is enabled without a spec".to_string())?;
        validate_seed_mode("channel hocket seed mode", &spec.seed_mode)?;
        cseq_rhythm::validate_channel_hocket_spec(spec)
            .map_err(|error| format!("channel hocket: {error}"))?;
    }
    Ok(())
}

pub(crate) fn validate_parallel_playback_config(
    config: &ParallelPlaybackConfig,
) -> Result<(), String> {
    let total_box_sources: usize = config
        .track_flow_boxes
        .iter()
        .map(|b| b.sources.len())
        .sum();
    // A project where every track has been moved into a Track Flow box is valid:
    // the runtime appends each box as a sounding lane participant.
    if config.tracks.is_empty() && total_box_sources == 0 {
        return Err(
            "parallel playback requires at least one audible track or Track Flow source"
                .to_string(),
        );
    }
    // Global conflict-participant cap: parallel tracks plus box lanes share the
    // 16-slot budget (conflict math, MIDI 1-16). A box lane counts as one
    // participant, so boxes reduce the parallel-track budget.
    let participant_count = config.tracks.len() + config.track_flow_boxes.len();
    if participant_count > 16 {
        return Err(format!(
            "parallel playback supports at most 16 conflict participants \
             (parallel tracks + Track Flow boxes), got {participant_count}"
        ));
    }
    // Total audible box sources across all boxes are bounded to cap realize work.
    if total_box_sources > 256 {
        return Err(format!(
            "Track Flow boxes support at most 256 audible sources in total, got {total_box_sources}"
        ));
    }
    if !(20.0..=400.0).contains(&config.reference_tempo_bpm) {
        return Err(format!(
            "parallel reference tempo {} must be 20-400 BPM",
            config.reference_tempo_bpm
        ));
    }
    if !(1..=64).contains(&config.reference_cycle_beats) {
        return Err(format!(
            "parallel reference cycle {} must be 1-64 beats",
            config.reference_cycle_beats
        ));
    }
    // Each Track Flow box is appended as a real participant (`track-flow-<boxId>`)
    // when it has sources, so its lane id is a legal channel-logic matrix endpoint
    // even though it is not an authored track. Box lane ids stay reserved against
    // authored track/source ids (checked below), so this cannot be user-spoofed.
    let box_lane_ids: Vec<String> = config
        .track_flow_boxes
        .iter()
        .map(|b| trackflow::lane_id(&b.id))
        .collect();
    let mut track_ids = HashSet::new();
    for track in &config.tracks {
        if !track_ids.insert(track.id.as_str()) {
            return Err(format!(
                "parallel tracks have a duplicate id {:?}",
                track.id
            ));
        }
    }
    for lane in &box_lane_ids {
        track_ids.insert(lane.as_str());
    }
    let mut channel_logic_keys = HashSet::new();
    for entry in &config.channel_logic_matrix {
        if entry.track_a_id == entry.track_b_id {
            return Err("channel logic matrix entries need two distinct tracks".to_string());
        }
        if entry
            .output_channel
            .is_some_and(|channel| !(1..=16).contains(&channel))
        {
            return Err(format!(
                "channel logic matrix entry for {} and {} references invalid MIDI channel {}",
                entry.track_a_id,
                entry.track_b_id,
                entry.output_channel.unwrap_or_default()
            ));
        }
        if !track_ids.contains(entry.track_a_id.as_str())
            || !track_ids.contains(entry.track_b_id.as_str())
        {
            return Err(format!(
                "channel logic matrix references unknown tracks {} and {}",
                entry.track_a_id, entry.track_b_id
            ));
        }
        let track_a_id = entry.track_a_id.as_str();
        let track_b_id = entry.track_b_id.as_str();
        let (left_id, right_id) = if track_a_id <= track_b_id {
            (track_a_id, track_b_id)
        } else {
            (track_b_id, track_a_id)
        };
        if !channel_logic_keys.insert((left_id, right_id, entry.output_channel)) {
            return Err(format!(
                "channel logic matrix contains duplicate rule for {} and {} on {}",
                entry.track_a_id,
                entry.track_b_id,
                entry
                    .output_channel
                    .map(|channel| format!("MIDI channel {channel}"))
                    .unwrap_or_else(|| "all channels".to_string())
            ));
        }
    }
    let mut priority_ids = HashSet::new();
    for id in &config.conflict_priority {
        if !track_ids.contains(id.as_str()) {
            return Err(format!("conflict priority references unknown track {id:?}"));
        }
        if !priority_ids.insert(id.as_str()) {
            return Err(format!("conflict priority contains duplicate track {id:?}"));
        }
    }
    for (index, track) in config.tracks.iter().enumerate() {
        if track.id.trim().is_empty() {
            return Err(format!("parallel track {} has an empty id", index + 1));
        }
        if trackflow::is_reserved_track_id(&track.id) {
            return Err(format!(
                "parallel track {} uses the reserved Track Flow id {:?}",
                index + 1,
                track.id
            ));
        }
        if !(20.0..=400.0).contains(&track.tempo_bpm) {
            return Err(format!(
                "parallel track {} tempo {} must be 20-400 BPM",
                track.id, track.tempo_bpm
            ));
        }
        validate_score_for_transport(&track.score)
            .map_err(|error| format!("parallel track {} score: {error}", track.id))?;
        if let Some(rhythm) = track.rhythm.as_ref() {
            validate_rhythm_playback_config(rhythm)
                .map_err(|error| format!("parallel track {} playback: {error}", track.id))?;
        }
    }
    validate_track_flow_boxes(config)?;
    Ok(())
}

/// Cross-box validation over the *submitted runtime boxes* (the security
/// boundary). The transport DTO carries only audible runtime sources, so this
/// layer cannot see authored membership it never received (e.g. a muted member
/// duplicated across boxes); the frontend patch normalizer enforces those. Here
/// we reject what would corrupt the runtime: duplicate box ids (⇒ duplicate
/// derived lane ids — critical, because `from_config` keys `track_indices` by the
/// runtime lane id, so a dup silently collapses matrix/priority lookups), box
/// lane ids colliding with authored track ids, and the same runtime source id
/// appearing in two boxes' source lists — plus each box's own checks.
pub(crate) fn validate_track_flow_boxes(config: &ParallelPlaybackConfig) -> Result<(), String> {
    let authored_track_ids: HashSet<&str> = config.tracks.iter().map(|t| t.id.as_str()).collect();
    let mut box_ids: HashSet<&str> = HashSet::new();
    let mut all_source_ids: HashSet<&str> = HashSet::new();
    for the_box in &config.track_flow_boxes {
        trackflow::validate_box_id(&the_box.id)?;
        if !box_ids.insert(the_box.id.as_str()) {
            // Duplicate box id ⇒ duplicate derived lane id `track-flow-<id>`.
            return Err(format!(
                "Track Flow boxes have a duplicate id {:?} (derived lane ids would collide)",
                the_box.id
            ));
        }
        let lane = trackflow::lane_id(&the_box.id);
        if authored_track_ids.contains(lane.as_str()) {
            return Err(format!(
                "Track Flow box {:?} derives lane id {lane:?}, which collides with an authored track id",
                the_box.id
            ));
        }
        validate_track_flow_box(the_box)?;
        for source in &the_box.sources {
            if !all_source_ids.insert(source.id.as_str()) {
                return Err(format!(
                    "Track Flow source id {:?} appears in more than one box",
                    source.id
                ));
            }
        }
    }
    Ok(())
}

/// Validate one Track Flow box: its source tracks (ids, scores, rhythm, no v1
/// triggers, reserved-namespace, per-box dup ids) and, if present, its Markov
/// chain spec against the box's source count. Mirrors the per-track checks in
/// `validate_parallel_playback_config` for the box's source pool.
pub(crate) fn validate_track_flow_box(config: &TrackFlowBoxConfig) -> Result<(), String> {
    if config.sources.is_empty() {
        return Err(format!(
            "Track Flow box {:?} requires at least one source track",
            config.id
        ));
    }
    if config.sources.len() > 64 {
        return Err(format!(
            "Track Flow box {:?} supports at most 64 source tracks, got {}",
            config.id,
            config.sources.len()
        ));
    }
    let mut source_ids = HashSet::new();
    for (index, source) in config.sources.iter().enumerate() {
        if source.id.trim().is_empty() {
            return Err(format!(
                "Track Flow box {:?} source {} has an empty id",
                config.id,
                index + 1
            ));
        }
        if trackflow::is_reserved_track_id(&source.id) {
            return Err(format!(
                "Track Flow box {:?} source {} uses the reserved Track Flow id {:?}",
                config.id,
                index + 1,
                source.id
            ));
        }
        if !source_ids.insert(source.id.as_str()) {
            return Err(format!(
                "Track Flow box {:?} sources have a duplicate id {:?}",
                config.id, source.id
            ));
        }
        if source.trigger.is_some() {
            return Err(format!(
                "Track Flow box {:?} source {} cannot be a triggered track in v1",
                config.id, source.id
            ));
        }
        if !(20.0..=400.0).contains(&source.tempo_bpm) {
            return Err(format!(
                "Track Flow box {:?} source {} tempo {} must be 20-400 BPM",
                config.id, source.id, source.tempo_bpm
            ));
        }
        validate_score_for_transport(&source.score).map_err(|error| {
            format!(
                "Track Flow box {:?} source {} score: {error}",
                config.id, source.id
            )
        })?;
        if let Some(rhythm) = source.rhythm.as_ref() {
            validate_rhythm_playback_config(rhythm).map_err(|error| {
                format!(
                    "Track Flow box {:?} source {} playback: {error}",
                    config.id, source.id
                )
            })?;
        }
    }
    if let Some(spec) = config.spec.as_ref() {
        trackflow::validate_track_flow_spec(spec, config.sources.len())
            .map_err(|error| format!("Track Flow box {:?}: {error}", config.id))?;
    }
    Ok(())
}

pub(crate) fn repair_rhythm_playback_config(config: &mut RhythmPlaybackConfig) -> Vec<String> {
    let mut warnings = Vec::new();
    let repaired_channel = config.midi_output_channel.clamp(1, 16);
    if repaired_channel != config.midi_output_channel {
        warnings.push(format!(
            "static MIDI output channel {} was clamped to {}",
            config.midi_output_channel, repaired_channel
        ));
        config.midi_output_channel = repaired_channel;
    }
    if config.channel_hocket_enabled {
        if let Some(spec) = config.channel_hocket.as_mut() {
            repair_seed_mode(
                "channel hocket seed mode",
                &mut spec.seed_mode,
                &mut warnings,
            );
            repair_channel_hocket_spec(spec, &mut warnings);
            if !spec.channels.contains(&spec.fallback) {
                if let Some(channel) = spec
                    .channels
                    .iter()
                    .copied()
                    .find(|channel| (1..=16).contains(channel))
                {
                    warnings.push(format!(
                        "channel hocket fallback {} was moved to enabled channel {}",
                        spec.fallback, channel
                    ));
                    spec.fallback = channel;
                }
            }
        }
        match config.channel_hocket.as_ref() {
            Some(spec) if cseq_rhythm::validate_channel_hocket_spec(spec).is_ok() => {}
            Some(spec) => {
                let error = cseq_rhythm::validate_channel_hocket_spec(spec).unwrap_err();
                warnings.push(format!("channel hocket disabled: {error}"));
                config.channel_hocket_enabled = false;
            }
            None => {
                warnings.push("channel hocket disabled: missing spec".to_string());
                config.channel_hocket_enabled = false;
            }
        }
    }
    warnings
}

pub(crate) fn validate_seed_mode(label: &str, mode: &RhythmSeedMode) -> Result<(), String> {
    let RhythmSeedMode::History {
        history,
        history_weight,
        new_seed_weight,
        max_history,
        ..
    } = mode
    else {
        return Ok(());
    };

    if *max_history > 64 {
        return Err(format!("{label} max history {max_history} must be 0-64"));
    }
    if *history_weight == 0 && *new_seed_weight == 0 {
        return Err(format!(
            "{label} must have a positive history or new seed weight"
        ));
    }
    if (*max_history == 0 || history.is_empty()) && *new_seed_weight == 0 {
        return Err(format!(
            "{label} cannot use history-only mode with no usable history"
        ));
    }
    Ok(())
}

pub(crate) fn repair_seed_mode(label: &str, mode: &mut RhythmSeedMode, warnings: &mut Vec<String>) {
    let RhythmSeedMode::History {
        history,
        history_weight,
        new_seed_weight,
        max_history,
        ..
    } = mode
    else {
        return;
    };

    if *max_history > 64 {
        warnings.push(format!(
            "{label} max history {} was clamped to 64",
            *max_history
        ));
        *max_history = 64;
    }
    if *max_history == 0 && !history.is_empty() {
        warnings.push(format!(
            "{label} history was cleared because max history is 0"
        ));
        history.clear();
    } else {
        while history.len() > *max_history {
            history.remove(0);
        }
    }
    if *history_weight == 0 && *new_seed_weight == 0 {
        warnings.push(format!(
            "{label} new seed weight was restored because both seed weights were zero"
        ));
        *new_seed_weight = 1;
    }
    if history.is_empty() && *new_seed_weight == 0 {
        warnings.push(format!(
            "{label} new seed weight was restored because history is empty"
        ));
        *new_seed_weight = 1;
    }
}

pub(crate) fn repair_euclid_channel_hocket_spec(
    spec: &mut ChannelHocketSpec,
    warnings: &mut Vec<String>,
) {
    if spec.assign_mode == cseq_rhythm::ChannelAssignMode::Euclid && spec.euclid.is_none() {
        warnings.push(
            "euclid channel assignment had no pattern; a default one was created".to_string(),
        );
        spec.euclid = Some(cseq_rhythm::EuclidChannelSpec::default());
    }
    if let Some(euclid) = spec.euclid.as_mut() {
        if euclid.steps == 0 || euclid.steps > cseq_rhythm::EUCLID_MAX_STEPS {
            warnings.push(format!(
                "euclid steps {} was clamped into 1-{}",
                euclid.steps,
                cseq_rhythm::EUCLID_MAX_STEPS
            ));
            euclid.steps = euclid.steps.clamp(1, cseq_rhythm::EUCLID_MAX_STEPS);
        }
        if euclid.layers.len() > cseq_rhythm::EUCLID_MAX_LAYERS {
            warnings.push(format!(
                "euclid layer count {} was truncated to {}",
                euclid.layers.len(),
                cseq_rhythm::EUCLID_MAX_LAYERS
            ));
            euclid.layers.truncate(cseq_rhythm::EUCLID_MAX_LAYERS);
        }
        let palette = spec.channels.clone();
        let mut seen = [false; 17];
        euclid.layers.retain(|layer| {
            let member = (1..=16).contains(&layer.channel) && palette.contains(&layer.channel);
            let duplicate = member && seen[layer.channel as usize];
            if member && !duplicate {
                seen[layer.channel as usize] = true;
                return true;
            }
            warnings.push(if duplicate {
                format!(
                    "euclid layer repeating channel {} was dropped",
                    layer.channel
                )
            } else {
                format!(
                    "euclid layer on disabled channel {} was dropped",
                    layer.channel
                )
            });
            false
        });
        for layer in &mut euclid.layers {
            if layer.max_run == 0 {
                warnings.push("euclid layer max run was moved to 1".to_string());
                layer.max_run = 1;
            }
            if layer.steps == 0 || layer.steps > cseq_rhythm::EUCLID_MAX_STEPS {
                warnings.push(format!(
                    "euclid layer steps {} was clamped into 1-{}",
                    layer.steps,
                    cseq_rhythm::EUCLID_MAX_STEPS
                ));
                layer.steps = layer.steps.clamp(1, cseq_rhythm::EUCLID_MAX_STEPS);
            }
        }
        if euclid.placement == cseq_rhythm::EuclidPlacement::Partition {
            let mut budget = euclid.steps;
            for layer in &mut euclid.layers {
                if layer.pulses > budget {
                    warnings.push(format!(
                        "euclid layer pulses {} on channel {} was clamped to the remaining {}",
                        layer.pulses, layer.channel, budget
                    ));
                    layer.pulses = budget;
                }
                budget -= layer.pulses;
            }
        }
        if let Some(anchor) = euclid.span_accent_channel {
            if !palette.contains(&anchor) {
                warnings.push(format!(
                    "euclid span-accent channel {anchor} is not enabled; using the fallback"
                ));
                euclid.span_accent_channel = None;
            }
        }
    }
}

pub(crate) fn repair_channel_hocket_spec(spec: &mut ChannelHocketSpec, warnings: &mut Vec<String>) {
    for rule in &mut spec.accent_rules {
        if rule.min_velocity > rule.max_velocity {
            warnings.push(format!(
                "channel hocket accent velocity range {}..{} was swapped",
                rule.min_velocity, rule.max_velocity
            ));
            std::mem::swap(&mut rule.min_velocity, &mut rule.max_velocity);
        }
    }
    for rule in &mut spec.position_rules {
        if rule.nth == 0 {
            warnings.push("channel hocket position rule nth note was moved to 1".to_string());
            rule.nth = 1;
        }
    }
    repair_euclid_channel_hocket_spec(spec, warnings);
}
