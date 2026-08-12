use crate::*;

fn automation_set_with_values(targets: &[(&str, f64)]) -> cseq_model::AutomationSet {
    cseq_model::AutomationSet {
        length_cycles: 1,
        markers: Vec::new(),
        tracks: targets
            .iter()
            .map(|(target, value)| cseq_model::AutomationTrack {
                id: format!("{target}-track"),
                target: (*target).to_string(),
                enabled: true,
                combine: cseq_model::AutomationCombineMode::Replace,
                graph_range: None,
                curves: vec![cseq_model::AutomationCurve {
                    id: format!("{target}-curve"),
                    enabled: true,
                    interpolation: cseq_model::AutomationInterpolation::Hold,
                    points: vec![cseq_model::AutomationPoint {
                        id: Some(format!("{target}-point")),
                        time: AutomationTime::zero(),
                        value: cseq_model::AutomationValue::Number { value: *value },
                        anchor_id: None,
                        out_curve: None,
                    }],
                }],
            })
            .collect(),
    }
}

#[test]
fn automation_replace_tracks_average_across_tracks() {
    let automation = automation_set_with_values(&[
        ("channelHocket.accentRule.0.probabilityPercent", 0.2),
        ("channelHocket.accentRule.0.probabilityPercent", 0.8),
    ]);

    assert_eq!(
        sample_automation_number_at_phase(
            &automation,
            "channelHocket.accentRule.0.probabilityPercent",
            AutomationTime::zero(),
            0.0,
            AutomationValueKind::Float,
            0.0,
            1.0,
        ),
        Some(0.5)
    );
}

fn tempo_ramp_automation(start_bpm: f64, end_bpm: f64) -> cseq_model::AutomationSet {
    cseq_model::AutomationSet {
        length_cycles: 1,
        markers: Vec::new(),
        tracks: vec![cseq_model::AutomationTrack {
            id: "tempo-ramp-track".to_string(),
            target: AUTOMATION_TARGET_TEMPO_BPM.to_string(),
            enabled: true,
            combine: cseq_model::AutomationCombineMode::Replace,
            graph_range: None,
            curves: vec![cseq_model::AutomationCurve {
                id: "tempo-ramp-curve".to_string(),
                enabled: true,
                interpolation: cseq_model::AutomationInterpolation::Linear,
                points: vec![
                    cseq_model::AutomationPoint {
                        id: Some("tempo-ramp-start".to_string()),
                        time: AutomationTime::zero(),
                        value: cseq_model::AutomationValue::Number { value: start_bpm },
                        anchor_id: None,
                        out_curve: None,
                    },
                    cseq_model::AutomationPoint {
                        id: Some("tempo-ramp-end".to_string()),
                        time: AutomationTime::one(),
                        value: cseq_model::AutomationValue::Number { value: end_bpm },
                        anchor_id: None,
                        out_curve: None,
                    },
                ],
            }],
        }],
    }
}

fn beat_pulse_score(name: &str, beats: usize) -> cseq_model::Score {
    let pitches = (0..beats).map(|index| 60 + index as u8).collect::<Vec<_>>();
    let mut score =
        cseq_model::Score::subdivided(name, &pitches, 96, cseq_model::SubdivisionPolicy::Equal);
    score.cycle_length = Rational::from_integer(beats as i64);
    score
}

fn subdivision_switch_score(name: &str, cycle_beats: u32, subdivision: u32) -> Score {
    Score::subdivision_switch(
        name,
        cseq_model::SubdivisionSwitchSpec {
            cycle_beats,
            initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                subdivision,
                weight: 1.0,
            }],
            initial_jathi_weights: vec![],
            initial_custom_subdivision: None,
            automation: None,
            inflections: vec![],
            switch_count_weights: vec![],
            seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
            accent: cseq_model::GatiAccentSpec::default(),
            pitch: 60,
            velocity: 96,
        },
    )
}

fn generator_playback_config() -> RhythmPlaybackConfig {
    RhythmPlaybackConfig {
        generator_enabled: true,
        generator: cseq_rhythm::GeneratorConfig::default(),
        midi_output_channel: 1,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

#[test]
fn generator_seed_trace_label_is_variant_specific() {
    assert_eq!(
        generator_seed_trace_label(&cseq_rhythm::GeneratorConfig::default()),
        "Example Generator"
    );
    assert_eq!(
        generator_seed_trace_label(&cseq_rhythm::GeneratorConfig::Dumka(
            cseq_rhythm::DumkaGeneratorParams::default()
        )),
        "Dum-Ka Generator"
    );
}

#[test]
fn generator_density_automation_drives_realized_playback() {
    let mut score = subdivision_switch_score("generator-density-automation", 1, 4);
    let mut rhythm = generator_playback_config();
    rhythm.automation = Some(automation_set_with_values(&[(
        "generator.example.density",
        0.0,
    )]));
    let mut queue = VecDeque::new();

    let events = realize_and_enqueue(&mut score, 0, 0, &mut queue, 120.0, Some(&mut rhythm), None)
        .expect("realize automated generator density");

    assert!(!events.realized_rhythm.is_empty());
    assert!(events
        .realized_rhythm
        .iter()
        .flat_map(|event| &event.span.cells)
        .all(|cell| cell.rest));
    assert!(note_on_ticks(&queue).is_empty());
}

#[test]
fn dumka_playback_samples_each_historical_cycle_start() {
    let automation = cseq_model::AutomationSet {
        length_cycles: 2,
        markers: Vec::new(),
        tracks: vec![cseq_model::AutomationTrack {
            id: "dumka-rate-track".to_string(),
            target: "generator.dumka.evolutionRate".to_string(),
            enabled: true,
            combine: cseq_model::AutomationCombineMode::Replace,
            graph_range: None,
            curves: vec![cseq_model::AutomationCurve {
                id: "dumka-rate-curve".to_string(),
                enabled: true,
                interpolation: cseq_model::AutomationInterpolation::Hold,
                points: vec![
                    cseq_model::AutomationPoint {
                        id: Some("dumka-rate-zero".to_string()),
                        time: AutomationTime::zero(),
                        value: cseq_model::AutomationValue::Number { value: 0.0 },
                        anchor_id: None,
                        out_curve: None,
                    },
                    cseq_model::AutomationPoint {
                        id: Some("dumka-rate-one".to_string()),
                        time: AutomationTime::new(1, 2).unwrap(),
                        value: cseq_model::AutomationValue::Number { value: 100.0 },
                        anchor_id: None,
                        out_curve: None,
                    },
                ],
            }],
        }],
    };
    let mut rhythm = generator_playback_config();
    rhythm.generator = cseq_rhythm::GeneratorConfig::Dumka(cseq_rhythm::DumkaGeneratorParams {
        pattern: cseq_rhythm::DEFAULT_DUMKA_PATTERN.to_string(),
        evolution_rate: 0,
        drift_leash: 25,
        seed_mode: cseq_rhythm::GeneratorSeedMode::Locked { seed: 7 },
        ..Default::default()
    });
    rhythm.automation = Some(automation);

    let resolve_cycle = |cycle| {
        let mut score = subdivision_switch_score("dumka-cycle-rate", 4, 4);
        let mut config = rhythm.clone();
        let mut queue = VecDeque::new();
        let events = realize_and_enqueue(
            &mut score,
            cycle,
            0,
            &mut queue,
            120.0,
            Some(&mut config),
            None,
        )
        .expect("realize automated Dum-Ka cycle");
        events
            .realized_rhythm
            .into_iter()
            .map(|event| event.span.cells)
            .collect::<Vec<_>>()
    };

    let cycle_one = resolve_cycle(1);
    let cycle_two = resolve_cycle(2);
    let sounding = cycle_one.iter().flatten().filter(|cell| !cell.rest).count();
    assert_eq!(sounding, 9, "cycle one applies seed 7's Add");
    assert_eq!(
        cycle_two, cycle_one,
        "cycle two's 0% sample must not erase cycle one's 100% step"
    );
}

#[test]
fn realized_generator_cells_carry_the_authored_accent_velocities() {
    // The dumka_default_pattern golden's exact setup: 4 beats of subdivision 4,
    // default randomized accents over base velocity 0x60, switch seed 20260810.
    // Its ledger pins beat-start note-ons 0x7d/0x73/0x70 against 0x60 interiors.
    let golden_score = || {
        cseq_model::Score::subdivision_switch(
            "golden-dumka",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 4,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![],
                switch_count_weights: vec![cseq_model::WeightedSwitchCount {
                    count: 0,
                    weight: 1.0,
                }],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 20260810 },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 45,
                velocity: 96,
            },
        )
    };
    let mut rhythm = generator_playback_config();
    rhythm.generator = cseq_rhythm::GeneratorConfig::Dumka(cseq_rhythm::DumkaGeneratorParams {
        pattern: cseq_rhythm::DEFAULT_DUMKA_PATTERN.to_string(),
        seed_mode: cseq_rhythm::GeneratorSeedMode::Locked { seed: 20260810 },
        ..Default::default()
    });

    let mut score = golden_score();
    let mut queue = VecDeque::new();
    let events = realize_and_enqueue(&mut score, 0, 0, &mut queue, 120.0, Some(&mut rhythm), None)
        .expect("realize the golden Dum-Ka cycle");

    let mut spans = events
        .realized_rhythm
        .iter()
        .map(|event| event.span.clone())
        .collect::<Vec<_>>();
    spans.sort_by_key(|span| span.span_id);
    assert!(!spans.is_empty());
    assert!(
        spans
            .iter()
            .flat_map(|span| &span.cells)
            .all(|cell| cell.velocity.is_some()),
        "every realized cell inherits an authored velocity"
    );

    // The surfaced velocities are the queued MIDI's velocities: in time order,
    // sounding cells match the golden ledger's note-on bytes exactly.
    let sounding = spans
        .iter()
        .flat_map(|span| &span.cells)
        .filter(|cell| !cell.rest)
        .map(|cell| cell.velocity.expect("sounding cell velocity"))
        .collect::<Vec<_>>();
    assert_eq!(
        sounding,
        vec![0x7d, 0x60, 0x60, 0x73, 0x60, 0x70, 0x60, 0x60],
        "realized cell velocities must match the golden ledger's note-ons"
    );
    let queued = queue
        .iter()
        .filter(|event| event.bytes[0] & 0xF0 == 0x90 && event.bytes[2] > 0)
        .map(|event| event.bytes[2])
        .collect::<Vec<_>>();
    assert_eq!(queued, sounding, "timeline cells and queued MIDI agree");

    // Preview parity: stamping cells from `rhythm_span_matra_velocities` (what
    // the structure preview forwards to `generator_preview`) reproduces the
    // realized inheritance byte-for-byte.
    let mut preview_score = golden_score();
    let tree = cseq_transforms::apply_pipeline_for_cycle_mut(&mut preview_score, 0)
        .expect("preview tree for the same cycle");
    let by_span = rhythm_span_matra_velocities(&tree, preview_score.cycle_length)
        .expect("span matra velocities")
        .into_iter()
        .map(|entry| (entry.span_id, entry.velocities))
        .collect::<std::collections::HashMap<_, _>>();
    for span in &spans {
        let velocities = by_span
            .get(&span.span_id)
            .expect("realized span has a matra-velocity entry");
        assert!(!velocities.is_empty());
        for cell in &span.cells {
            let stamped = velocities[(cell.start as usize).min(velocities.len() - 1)];
            assert_eq!(
                cell.velocity,
                Some(stamped),
                "span {} cell {} preview stamp must match realization",
                span.span_id,
                cell.index
            );
        }
    }
}

fn playback_config_with_automation(automation: cseq_model::AutomationSet) -> RhythmPlaybackConfig {
    RhythmPlaybackConfig {
        generator_enabled: false,
        generator: cseq_rhythm::GeneratorConfig::default(),
        midi_output_channel: 1,
        automation: Some(automation),
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

fn note_on_ticks(queue: &VecDeque<QueuedEvent>) -> Vec<u64> {
    queue
        .iter()
        .filter(|event| event.bytes[0] & 0xF0 == 0x90 && event.bytes[2] > 0)
        .map(|event| event.absolute_tick)
        .collect()
}

fn note_on_channels(queue: &VecDeque<QueuedEvent>) -> Vec<u8> {
    queue
        .iter()
        .filter(|event| event.bytes[0] & 0xF0 == 0x90 && event.bytes[2] > 0)
        .map(|event| (event.bytes[0] & 0x0F) + 1)
        .collect()
}

fn note_on_channels_in_tick_range(queue: &VecDeque<QueuedEvent>, start: u64, end: u64) -> Vec<u8> {
    queue
        .iter()
        .filter(|event| {
            event.bytes[0] & 0xF0 == 0x90
                && event.bytes[2] > 0
                && event.absolute_tick >= start
                && event.absolute_tick < end
        })
        .map(|event| (event.bytes[0] & 0x0F) + 1)
        .collect()
}

fn rendered_note_groups(
    queue: &VecDeque<QueuedEvent>,
    cycle_base_tick: u64,
) -> Vec<(u64, u64, u8)> {
    let events = queue.iter().collect::<Vec<_>>();
    let mut used_offs = vec![false; events.len()];
    let mut groups = Vec::new();
    for (on_index, on) in events.iter().enumerate() {
        if !is_note_on_event(on) {
            continue;
        }
        let channel = on.bytes[0] & 0x0F;
        let pitch = on.bytes[1];
        let Some((off_index, off)) =
            events
                .iter()
                .enumerate()
                .skip(on_index + 1)
                .find(|(off_index, event)| {
                    if used_offs[*off_index] {
                        return false;
                    }
                    let status = event.bytes[0] & 0xF0;
                    let is_off = status == 0x80 || (status == 0x90 && event.bytes[2] == 0);
                    is_off && (event.bytes[0] & 0x0F) == channel && event.bytes[1] == pitch
                })
        else {
            continue;
        };
        used_offs[off_index] = true;
        groups.push((
            on.absolute_tick.saturating_sub(cycle_base_tick),
            off.absolute_tick.saturating_sub(cycle_base_tick),
            channel + 1,
        ));
    }
    groups
}
fn four_matra_queue() -> VecDeque<QueuedEvent> {
    VecDeque::from([
        QueuedEvent::note_on(0, 0, 60, 96),
        QueuedEvent::note_off(240, 0, 60),
        QueuedEvent::note_on(240, 0, 60, 96),
        QueuedEvent::note_off(480, 0, 60),
        QueuedEvent::note_on(480, 0, 60, 96),
        QueuedEvent::note_off(720, 0, 60),
        QueuedEvent::note_on(720, 0, 60, 96),
        QueuedEvent::note_off(960, 0, 60),
    ])
}

#[test]
fn track_flow_lane_is_one_participant_and_alternates_sources_deterministically() {
    let make_track = |id: &str, pitch: u8| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: cseq_model::Score::single_pulse(id, pitch, 96),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    // Deterministic chain: entry on 0, then 0 -> 1 -> 0 -> 1 ...
    let spec = trackflow::TrackFlowSpec {
        order: cseq_rhythm::MarkovOrder::First,
        state_count: 2,
        transitions: vec![
            trackflow::TrackFlowTransition {
                from: vec![0],
                to: 1,
                weight: 1,
            },
            trackflow::TrackFlowTransition {
                from: vec![1],
                to: 0,
                weight: 1,
            },
        ],
        fallback: 0,
        fallback_weights: vec![],
        entry_weights: vec![trackflow::TrackFlowEntryWeight {
            states: vec![0],
            weight: 1,
        }],
    };
    let config = ParallelPlaybackConfig {
        tracks: vec![make_track("p0", 60)],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: vec![],
        conflict_priority: vec![],
        track_flow_boxes: vec![TrackFlowBoxConfig {
            id: "main".to_string(),
            name: "Track Flow".to_string(),
            sources: vec![make_track("s0", 64), make_track("s1", 67)],
            spec: Some(spec),
            seed: 1,
        }],
    };
    let mut runtime = ParallelRuntimeConfig::from_config(config);
    let lane = trackflow::lane_id("main");

    // The box lane is appended as exactly one participant; its sources are not
    // separate participants and so do not inflate the conflict count.
    assert_eq!(runtime.tracks.len(), 2);
    assert!(runtime.tracks.iter().any(|track| track.id == lane));
    assert_eq!(runtime.conflict_active_track_count(), 2);

    let mut queue = VecDeque::new();
    let events = realize_parallel_until(&mut runtime, 16 * PPQN as u64, &mut queue).unwrap();

    // The lane alternates s0, s1, s0, ... per the deterministic chain, and the
    // display identity is always the authored source (never the lane slot).
    let chosen: Vec<&str> = events
        .track_flow
        .iter()
        .map(|event| event.source_track_id.as_str())
        .collect();
    assert!(
        chosen.len() >= 2,
        "expected several lane cycles, got {chosen:?}"
    );
    assert_eq!(&chosen[0..2], &["s0", "s1"]);
    assert!(events
        .track_flow
        .iter()
        .all(|event| event.source_track_id != lane));
    // Every lane event carries the box's lane id (the per-box display key).
    assert!(events.track_flow.iter().all(|event| event.lane_id == lane));

    // The lane's MIDI carries the lane (conflict) identity; the parallel track
    // is unaffected; source ids never leak into the dispatched queue.
    assert!(queue
        .iter()
        .any(|event| event.parallel_track_id.as_deref() == Some(lane.as_str())));
    assert!(queue
        .iter()
        .any(|event| event.parallel_track_id.as_deref() == Some("p0")));
    assert!(queue
        .iter()
        .all(|event| event.parallel_track_id.as_deref() != Some("s0")));
}

#[test]
fn track_flow_reset_reproduces_the_same_lane_sequence() {
    let make_track = |id: &str, pitch: u8| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: cseq_model::Score::single_pulse(id, pitch, 96),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    let config = || ParallelPlaybackConfig {
        tracks: vec![],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: vec![],
        conflict_priority: vec![],
        track_flow_boxes: vec![TrackFlowBoxConfig {
            id: "main".to_string(),
            name: "Track Flow".to_string(),
            sources: vec![
                make_track("s0", 64),
                make_track("s1", 67),
                make_track("s2", 71),
            ],
            spec: None, // default uniform chain
            seed: 99,
        }],
    };
    let mut runtime = ParallelRuntimeConfig::from_config(config());
    let mut queue = VecDeque::new();
    let first = realize_parallel_until(&mut runtime, 16 * PPQN as u64, &mut queue)
        .unwrap()
        .track_flow
        .iter()
        .map(|event| event.source_track_id.clone())
        .collect::<Vec<_>>();
    runtime.reset_realization();
    let mut queue2 = VecDeque::new();
    let again = realize_parallel_until(&mut runtime, 16 * PPQN as u64, &mut queue2)
        .unwrap()
        .track_flow
        .iter()
        .map(|event| event.source_track_id.clone())
        .collect::<Vec<_>>();
    assert_eq!(first, again);
    assert!(!first.is_empty());
}

#[test]
fn track_flow_seed_trace_uses_composite_identity_and_does_not_collide() {
    // Same authored id "s0" lives both as an ordinary parallel track AND as a
    // Track Flow source. Their seed-path identities must stay distinct so
    // replay of one never matches the other.
    let make_track = |id: &str| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: subdivision_switch_score(id, 1, 4),
        rhythm: Some(generator_playback_config()),
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    let config = ParallelPlaybackConfig {
        tracks: vec![make_track("s0")],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 1,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: vec![],
        conflict_priority: vec![],
        track_flow_boxes: vec![TrackFlowBoxConfig {
            id: "main".to_string(),
            name: "Track Flow".to_string(),
            sources: vec![make_track("s0")],
            spec: None,
            seed: 7,
        }],
    };
    let mut runtime = ParallelRuntimeConfig::from_config(config);
    let mut queue = VecDeque::new();
    let events = realize_parallel_until(&mut runtime, 4 * PPQN as u64, &mut queue).unwrap();

    let composite = trackflow::seed_path_id("main", "s0");
    let lane_traces = events
        .seed_trace
        .iter()
        .filter(|event| event.track_id.as_deref() == Some(composite.as_str()))
        .count();
    let parallel_traces = events
        .seed_trace
        .iter()
        .filter(|event| event.track_id.as_deref() == Some("s0"))
        .count();
    assert!(
        lane_traces > 0,
        "lane produced no composite-tagged seed traces"
    );
    assert!(
        parallel_traces > 0,
        "parallel track produced no seed traces"
    );
    // The lane's seed traces are NEVER tagged with the bare lane id (that
    // would break replay round-trip) — only the composite id.
    let lane = trackflow::lane_id("main");
    assert!(events
        .seed_trace
        .iter()
        .all(|event| event.track_id.as_deref() != Some(lane.as_str())));
    // The two "s0" identities are distinct strings ⇒ no replay collision.
    assert_ne!(composite, "s0");
}

#[test]
fn validate_accepts_track_flow_only_project_and_rejects_truly_empty() {
    let source = |id: &str| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: subdivision_switch_score(id, 1, 4),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    let base = |tracks: Vec<ParallelPlaybackTrackConfig>,
                track_flow_boxes: Vec<TrackFlowBoxConfig>| {
        ParallelPlaybackConfig {
            tracks,
            reference_tempo_bpm: 80.0,
            reference_cycle_beats: 4,
            channel_conflict_policy: ChannelConflictPolicy::AllowAll,
            channel_logic_matrix: vec![],
            conflict_priority: vec![],
            track_flow_boxes,
        }
    };
    let box_of = |id: &str, sources: Vec<ParallelPlaybackTrackConfig>| TrackFlowBoxConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        sources,
        spec: None,
        seed: 1,
    };
    // Every track moved into a Track Flow box: valid (the lane is the participant).
    assert!(validate_parallel_playback_config(&base(
        vec![],
        vec![box_of("main", vec![source("s0"), source("s1")])],
    ))
    .is_ok());
    // No parallel tracks AND no Track Flow sources: rejected.
    assert!(validate_parallel_playback_config(&base(vec![], vec![])).is_err());
    // A box with no sources is rejected.
    assert!(
        validate_parallel_playback_config(&base(vec![], vec![box_of("main", vec![])],)).is_err()
    );
}

#[test]
fn validate_rejects_duplicate_parallel_track_ids() {
    let track = |id: &str| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: subdivision_switch_score(id, 1, 4),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    let cfg = ParallelPlaybackConfig {
        tracks: vec![track("dup"), track("dup")],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: vec![],
        conflict_priority: vec![],
        track_flow_boxes: vec![],
    };
    assert!(validate_parallel_playback_config(&cfg).is_err());
}

#[test]
fn validate_rejects_stale_or_duplicate_conflict_priority_ids() {
    let track = |id: &str| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: subdivision_switch_score(id, 1, 4),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    let base = |conflict_priority: Vec<String>| ParallelPlaybackConfig {
        tracks: vec![track("a"), track("b")],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::PriorityOrder,
        channel_logic_matrix: vec![],
        conflict_priority,
        track_flow_boxes: vec![],
    };
    assert!(
        validate_parallel_playback_config(&base(vec!["a".to_string(), "ghost".to_string(),]))
            .is_err()
    );
    assert!(
        validate_parallel_playback_config(&base(vec!["a".to_string(), "a".to_string(),])).is_err()
    );
    assert!(
        validate_parallel_playback_config(&base(vec!["b".to_string(), "a".to_string(),])).is_ok()
    );
}

#[test]
fn validate_rejects_duplicate_channel_logic_matrix_entries() {
    let track = |id: &str| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: subdivision_switch_score(id, 1, 4),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    let entry = |a: &str, b: &str, output_channel: Option<u8>, policy: ChannelConflictPolicy| {
        ChannelLogicMatrixEntry {
            track_a_id: a.to_string(),
            track_b_id: b.to_string(),
            output_channel,
            policy,
        }
    };
    let base = |channel_logic_matrix: Vec<ChannelLogicMatrixEntry>| ParallelPlaybackConfig {
        tracks: vec![track("a"), track("b")],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix,
        conflict_priority: vec![],
        track_flow_boxes: vec![],
    };

    assert!(validate_parallel_playback_config(&base(vec![
        entry("a", "b", None, ChannelConflictPolicy::Xor),
        entry("b", "a", None, ChannelConflictPolicy::And),
    ]))
    .is_err());
    assert!(validate_parallel_playback_config(&base(vec![
        entry("a", "b", Some(1), ChannelConflictPolicy::Xor),
        entry("b", "a", Some(2), ChannelConflictPolicy::And),
        entry("a", "b", None, ChannelConflictPolicy::Or),
    ]))
    .is_ok());
}

#[test]
fn validate_rejects_reserved_ids_and_malformed_track_flow() {
    let source = |id: &str| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: subdivision_switch_score(id, 1, 4),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    let base = |tracks: Vec<ParallelPlaybackTrackConfig>,
                track_flow_boxes: Vec<TrackFlowBoxConfig>| {
        ParallelPlaybackConfig {
            tracks,
            reference_tempo_bpm: 80.0,
            reference_cycle_beats: 4,
            channel_conflict_policy: ChannelConflictPolicy::AllowAll,
            channel_logic_matrix: vec![],
            conflict_priority: vec![],
            track_flow_boxes,
        }
    };
    let box_with = |id: &str,
                    sources: Vec<ParallelPlaybackTrackConfig>,
                    spec: Option<trackflow::TrackFlowSpec>| {
        vec![TrackFlowBoxConfig {
            id: id.to_string(),
            name: id.to_uppercase(),
            sources,
            spec,
            seed: 1,
        }]
    };

    // An authored parallel track may not take a reserved lane id.
    assert!(validate_parallel_playback_config(&base(
        vec![source("track-flow-main")],
        box_with("main", vec![source("s0")], None),
    ))
    .is_err());
    // A source may not take a reserved (family-prefixed) id.
    assert!(validate_parallel_playback_config(&base(
        vec![],
        box_with("main", vec![source("track-flow-main:x")], None),
    ))
    .is_err());
    // Duplicate source ids within a box are rejected.
    assert!(validate_parallel_playback_config(&base(
        vec![],
        box_with("main", vec![source("s0"), source("s0")], None),
    ))
    .is_err());
    // An empty box id is rejected.
    assert!(validate_parallel_playback_config(&base(
        vec![],
        box_with("", vec![source("s0")], None),
    ))
    .is_err());
    // A box id containing ':' is rejected (it would break the seed-path split).
    assert!(validate_parallel_playback_config(&base(
        vec![],
        box_with("a:b", vec![source("s0")], None),
    ))
    .is_err());
    // A malformed chain spec (out-of-range transition target) is rejected
    // instead of being clamped into the wrong source.
    let bad_spec = trackflow::TrackFlowSpec {
        transitions: vec![trackflow::TrackFlowTransition {
            from: vec![0],
            to: 9,
            weight: 1,
        }],
        ..trackflow::TrackFlowSpec::uniform(2)
    };
    assert!(validate_parallel_playback_config(&base(
        vec![],
        box_with("main", vec![source("s0"), source("s1")], Some(bad_spec)),
    ))
    .is_err());
    // A spec whose state_count disagrees with the source count is rejected.
    assert!(validate_parallel_playback_config(&base(
        vec![],
        box_with(
            "main",
            vec![source("s0")],
            Some(trackflow::TrackFlowSpec::uniform(3))
        ),
    ))
    .is_err());
    // The same config with a well-formed (default) chain validates.
    assert!(validate_parallel_playback_config(&base(
        vec![],
        box_with("main", vec![source("s0"), source("s1")], None),
    ))
    .is_ok());
}

#[test]
fn validate_allows_track_flow_lane_as_a_matrix_endpoint_only_when_present() {
    let source = |id: &str| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: subdivision_switch_score(id, 1, 4),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    let matrix_entry = |a: &str, b: &str| ChannelLogicMatrixEntry {
        track_a_id: a.to_string(),
        track_b_id: b.to_string(),
        output_channel: None,
        policy: ChannelConflictPolicy::Xor,
    };
    let with = |tracks: Vec<ParallelPlaybackTrackConfig>,
                matrix: Vec<ChannelLogicMatrixEntry>,
                track_flow_boxes: Vec<TrackFlowBoxConfig>| {
        ParallelPlaybackConfig {
            tracks,
            reference_tempo_bpm: 80.0,
            reference_cycle_beats: 4,
            channel_conflict_policy: ChannelConflictPolicy::AllowAll,
            channel_logic_matrix: matrix,
            conflict_priority: vec![],
            track_flow_boxes,
        }
    };
    let box_of = |id: &str, sources: Vec<ParallelPlaybackTrackConfig>| TrackFlowBoxConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        sources,
        spec: None,
        seed: 1,
    };
    let lane = trackflow::lane_id("main");

    // A parallel track paired with a box lane validates when that box exists.
    assert!(validate_parallel_playback_config(&with(
        vec![source("p0")],
        vec![matrix_entry("p0", &lane)],
        vec![box_of("main", vec![source("s0")])],
    ))
    .is_ok());
    // Referencing the lane with no Track Flow box present is an unknown track.
    assert!(validate_parallel_playback_config(&with(
        vec![source("p0"), source("p1")],
        vec![matrix_entry("p0", &lane)],
        vec![],
    ))
    .is_err());
}

#[test]
fn track_flow_composite_seed_path_id_does_not_collide_with_parallel_id() {
    let composite = trackflow::seed_path_id("main", "track-3");
    // The lane replays only its own composite entries; a parallel "track-3"
    // entry must not match the lane, and vice versa.
    assert!(seed_path_track_matches(Some(&composite), Some(&composite)));
    assert!(!seed_path_track_matches(Some(&composite), Some("track-3")));
    assert!(!seed_path_track_matches(Some("track-3"), Some(&composite)));
}

#[test]
fn two_track_flow_boxes_alternate_independently_and_each_is_one_participant() {
    let make_track = |id: &str, pitch: u8| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: cseq_model::Score::single_pulse(id, pitch, 96),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    // Box A: 0 -> 1 -> 0 ...   Box B: 0 -> 1 -> 0 ... over its own sources.
    let two_state_cycle = || trackflow::TrackFlowSpec {
        order: cseq_rhythm::MarkovOrder::First,
        state_count: 2,
        transitions: vec![
            trackflow::TrackFlowTransition {
                from: vec![0],
                to: 1,
                weight: 1,
            },
            trackflow::TrackFlowTransition {
                from: vec![1],
                to: 0,
                weight: 1,
            },
        ],
        fallback: 0,
        fallback_weights: vec![],
        entry_weights: vec![trackflow::TrackFlowEntryWeight {
            states: vec![0],
            weight: 1,
        }],
    };
    let config = ParallelPlaybackConfig {
        tracks: vec![make_track("p0", 60)],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: vec![],
        conflict_priority: vec![],
        track_flow_boxes: vec![
            TrackFlowBoxConfig {
                id: "a".to_string(),
                name: "Box A".to_string(),
                sources: vec![make_track("a0", 64), make_track("a1", 67)],
                spec: Some(two_state_cycle()),
                seed: 1,
            },
            TrackFlowBoxConfig {
                id: "b".to_string(),
                name: "Box B".to_string(),
                sources: vec![make_track("b0", 72), make_track("b1", 76)],
                spec: Some(two_state_cycle()),
                seed: 2,
            },
        ],
    };
    let mut runtime = ParallelRuntimeConfig::from_config(config);
    let lane_a = trackflow::lane_id("a");
    let lane_b = trackflow::lane_id("b");

    // One parallel track + two box lanes = three participants.
    assert_eq!(runtime.tracks.len(), 3);
    assert!(runtime.tracks.iter().any(|t| t.id == lane_a));
    assert!(runtime.tracks.iter().any(|t| t.id == lane_b));
    assert_eq!(runtime.conflict_active_track_count(), 3);

    let mut queue = VecDeque::new();
    let events = realize_parallel_until(&mut runtime, 16 * PPQN as u64, &mut queue).unwrap();

    // Each box alternates independently over its own member sources, tagged
    // with its own lane id.
    let chosen_a: Vec<&str> = events
        .track_flow
        .iter()
        .filter(|e| e.lane_id == lane_a)
        .map(|e| e.source_track_id.as_str())
        .collect();
    let chosen_b: Vec<&str> = events
        .track_flow
        .iter()
        .filter(|e| e.lane_id == lane_b)
        .map(|e| e.source_track_id.as_str())
        .collect();
    assert_eq!(&chosen_a[0..2], &["a0", "a1"]);
    assert_eq!(&chosen_b[0..2], &["b0", "b1"]);
    // Both lanes dispatch MIDI under their own conflict identity.
    assert!(queue
        .iter()
        .any(|e| e.parallel_track_id.as_deref() == Some(lane_a.as_str())));
    assert!(queue
        .iter()
        .any(|e| e.parallel_track_id.as_deref() == Some(lane_b.as_str())));
}

#[test]
fn two_boxes_produce_distinct_composite_seed_paths_for_the_same_source_id() {
    take_observed_generator_track_ids();
    let make_track = |id: &str| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: subdivision_switch_score(id, 1, 4),
        rhythm: Some(generator_playback_config()),
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    // The same authored source id "s" lives in two different boxes.
    let config = ParallelPlaybackConfig {
        tracks: vec![],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 1,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: vec![],
        conflict_priority: vec![],
        track_flow_boxes: vec![
            TrackFlowBoxConfig {
                id: "a".to_string(),
                name: "Box A".to_string(),
                sources: vec![make_track("s")],
                spec: None,
                seed: 1,
            },
            TrackFlowBoxConfig {
                id: "b".to_string(),
                name: "Box B".to_string(),
                sources: vec![make_track("s")],
                spec: None,
                seed: 2,
            },
        ],
    };
    let mut runtime = ParallelRuntimeConfig::from_config(config);
    let mut queue = VecDeque::new();
    let events = realize_parallel_until(&mut runtime, 4 * PPQN as u64, &mut queue).unwrap();

    let composite_a = trackflow::seed_path_id("a", "s");
    let composite_b = trackflow::seed_path_id("b", "s");
    assert_ne!(composite_a, composite_b);
    assert!(events
        .seed_trace
        .iter()
        .any(|e| e.track_id.as_deref() == Some(composite_a.as_str())));
    assert!(events
        .seed_trace
        .iter()
        .any(|e| e.track_id.as_deref() == Some(composite_b.as_str())));
    let generator_track_ids = take_observed_generator_track_ids();
    assert!(!generator_track_ids.is_empty());
    assert!(generator_track_ids
        .iter()
        .all(|track_id| track_id.as_deref() == Some("s")));
}

#[test]
fn validate_rejects_duplicate_box_ids_and_cross_box_source_ids() {
    let source = |id: &str| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: subdivision_switch_score(id, 1, 4),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    let base = |boxes: Vec<TrackFlowBoxConfig>| ParallelPlaybackConfig {
        tracks: vec![],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: vec![],
        conflict_priority: vec![],
        track_flow_boxes: boxes,
    };
    let box_of = |id: &str, sources: Vec<ParallelPlaybackTrackConfig>| TrackFlowBoxConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        sources,
        spec: None,
        seed: 1,
    };

    // Duplicate box ids ⇒ duplicate derived lane ids ⇒ rejected.
    assert!(validate_parallel_playback_config(&base(vec![
        box_of("a", vec![source("s0")]),
        box_of("a", vec![source("s1")]),
    ]))
    .is_err());
    // The same runtime source id in two different boxes ⇒ rejected.
    assert!(validate_parallel_playback_config(&base(vec![
        box_of("a", vec![source("shared")]),
        box_of("b", vec![source("shared")]),
    ]))
    .is_err());
    // Distinct box ids with distinct source ids ⇒ accepted.
    assert!(validate_parallel_playback_config(&base(vec![
        box_of("a", vec![source("s0")]),
        box_of("b", vec![source("s1")]),
    ]))
    .is_ok());
}

#[test]
fn validate_enforces_global_conflict_participant_cap() {
    let track = |id: &str| ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: subdivision_switch_score(id, 1, 4),
        rhythm: None,
        tempo_bpm: 80.0,
        trigger: None,
        silent: false,
    };
    let box_of = |id: &str| TrackFlowBoxConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        sources: vec![track(&format!("{id}-s"))],
        spec: None,
        seed: 1,
    };
    // 15 parallel tracks + 2 boxes = 17 participants ⇒ over the 16 cap.
    let tracks: Vec<_> = (0..15).map(|i| track(&format!("p{i}"))).collect();
    let cfg = ParallelPlaybackConfig {
        tracks,
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: vec![],
        conflict_priority: vec![],
        track_flow_boxes: vec![box_of("a"), box_of("b")],
    };
    assert!(validate_parallel_playback_config(&cfg).is_err());
    // 14 parallel tracks + 2 boxes = 16 participants ⇒ exactly at the cap.
    let tracks: Vec<_> = (0..14).map(|i| track(&format!("p{i}"))).collect();
    let cfg = ParallelPlaybackConfig {
        tracks,
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: vec![],
        conflict_priority: vec![],
        track_flow_boxes: vec![box_of("a"), box_of("b")],
    };
    assert!(validate_parallel_playback_config(&cfg).is_ok());
}

fn parallel_runtime(policy: ChannelConflictPolicy) -> ParallelRuntimeConfig {
    ParallelRuntimeConfig {
        tracks: vec![
            ParallelRuntimeTrack {
                id: "alpha".to_string(),
                name: "Alpha".to_string(),
                score_switch_seed_baseline: Vec::new(),
                generator_seed_history_baseline: None,
                score: cseq_model::Score::single_pulse("alpha", 60, 96),
                rhythm: None,
                tempo_bpm: 80.0,
                priority_rank: 1,
                realized_up_to_cycle: 0,
                realized_up_to_reference_tick: 0,
                timing_windows: VecDeque::new(),
                silent: false,
                triggered: None,
                track_flow: None,
                recent_resolved: VecDeque::new(),
            },
            ParallelRuntimeTrack {
                id: "beta".to_string(),
                name: "Beta".to_string(),
                score_switch_seed_baseline: Vec::new(),
                generator_seed_history_baseline: None,
                score: cseq_model::Score::single_pulse("beta", 67, 96),
                rhythm: None,
                tempo_bpm: 80.0,
                priority_rank: 0,
                realized_up_to_cycle: 0,
                realized_up_to_reference_tick: 0,
                timing_windows: VecDeque::new(),
                silent: false,
                triggered: None,
                track_flow: None,
                recent_resolved: VecDeque::new(),
            },
            ParallelRuntimeTrack {
                id: "gamma".to_string(),
                name: "Gamma".to_string(),
                score_switch_seed_baseline: Vec::new(),
                generator_seed_history_baseline: None,
                score: cseq_model::Score::single_pulse("gamma", 72, 96),
                rhythm: None,
                tempo_bpm: 80.0,
                priority_rank: 2,
                realized_up_to_cycle: 0,
                realized_up_to_reference_tick: 0,
                timing_windows: VecDeque::new(),
                silent: false,
                triggered: None,
                track_flow: None,
                recent_resolved: VecDeque::new(),
            },
        ],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 1,
        channel_conflict_policy: policy,
        channel_logic_matrix: HashMap::new(),
        alternate_resolved: HashMap::new(),
        dispatch_horizon_tick: 0,
    }
}

fn parallel_note_pair_on_channel(
    start: u64,
    end: u64,
    track_index: usize,
    pitch: u8,
    channel: u8,
) -> [QueuedEvent; 2] {
    let (track_id, track_name) = match track_index {
        0 => ("alpha".to_string(), "Alpha".to_string()),
        1 => ("beta".to_string(), "Beta".to_string()),
        2 => ("gamma".to_string(), "Gamma".to_string()),
        index => (format!("track-{index}"), format!("Track {}", index + 1)),
    };
    [
        QueuedEvent::note_on(start, channel, pitch, 96).with_parallel_track(
            track_index,
            &track_id,
            &track_name,
        ),
        QueuedEvent::note_off(end, channel, pitch).with_parallel_track(
            track_index,
            &track_id,
            &track_name,
        ),
    ]
}

fn parallel_note_pair(start: u64, end: u64, track_index: usize, pitch: u8) -> [QueuedEvent; 2] {
    parallel_note_pair_on_channel(start, end, track_index, pitch, 0)
}

fn parallel_note_on_tracks(queue: &VecDeque<QueuedEvent>) -> Vec<usize> {
    queue
        .iter()
        .filter(|event| is_note_on_event(event))
        .filter_map(|event| event.parallel_track_index)
        .collect()
}

fn parallel_note_off_ticks(queue: &VecDeque<QueuedEvent>) -> Vec<u64> {
    queue
        .iter()
        .filter(|event| is_note_off_event(event))
        .map(|event| event.absolute_tick)
        .collect()
}

#[test]
fn parallel_reference_cycle_uses_project_reference_not_first_track() {
    let mut first_score = cseq_model::Score::single_pulse("custom", 60, 96);
    first_score.cycle_length = Rational::from_integer(5);
    let runtime = ParallelRuntimeConfig::from_config(ParallelPlaybackConfig {
        tracks: vec![ParallelPlaybackTrackConfig {
            id: "custom".to_string(),
            name: "Custom".to_string(),
            score: first_score,
            rhythm: None,
            tempo_bpm: 123.0,
            trigger: None,
            silent: false,
        }],
        reference_tempo_bpm: 88.0,
        reference_cycle_beats: 12,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: Vec::new(),
        conflict_priority: vec!["custom".to_string()],
        track_flow_boxes: vec![],
    });

    assert_eq!(runtime.reference_tempo_bpm, 88.0);
    assert_eq!(runtime.reference_ticks_per_cycle(), 12 * PPQN as u64);
}

#[test]
fn parallel_global_and_custom_tempo_scale_against_reference() {
    let mut global_score = cseq_model::Score::single_pulse("global", 60, 96);
    global_score.cycle_length = Rational::from_integer(1);
    let mut custom_score = cseq_model::Score::single_pulse("custom", 67, 96);
    custom_score.cycle_length = Rational::from_integer(1);
    let mut runtime = ParallelRuntimeConfig::from_config(ParallelPlaybackConfig {
        tracks: vec![
            ParallelPlaybackTrackConfig {
                id: "global".to_string(),
                name: "Global".to_string(),
                score: global_score,
                rhythm: None,
                tempo_bpm: 80.0,
                trigger: None,
                silent: false,
            },
            ParallelPlaybackTrackConfig {
                id: "custom".to_string(),
                name: "Custom".to_string(),
                score: custom_score,
                rhythm: None,
                tempo_bpm: 160.0,
                trigger: None,
                silent: false,
            },
        ],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 1,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: Vec::new(),
        conflict_priority: vec!["global".to_string(), "custom".to_string()],
        track_flow_boxes: vec![],
    });
    let mut queue = VecDeque::new();

    realize_parallel_until(&mut runtime, PPQN as u64, &mut queue).unwrap();

    let starts = queue
        .iter()
        .filter(|event| is_note_on_event(event))
        .map(|event| (event.parallel_track_index.unwrap(), event.absolute_tick))
        .collect::<Vec<_>>();
    assert_eq!(starts, vec![(0, 0), (1, 0), (1, PPQN as u64 / 2)]);
    assert_eq!(runtime.tracks[0].realized_up_to_reference_tick, PPQN as u64);
    assert_eq!(runtime.tracks[1].realized_up_to_reference_tick, PPQN as u64);
    assert_eq!(runtime.tracks[0].realized_up_to_cycle, 1);
    assert_eq!(runtime.tracks[1].realized_up_to_cycle, 2);
}

#[test]
fn parallel_custom_tempo_automation_changes_track_cycle_duration() {
    let mut score = cseq_model::Score::single_pulse("automated", 60, 96);
    score.cycle_length = Rational::from_integer(1);
    let rhythm = playback_config_with_automation(automation_set_with_values(&[(
        AUTOMATION_TARGET_TEMPO_BPM,
        160.0,
    )]));
    let mut runtime = ParallelRuntimeConfig::from_config(ParallelPlaybackConfig {
        tracks: vec![ParallelPlaybackTrackConfig {
            id: "automated".to_string(),
            name: "Automated".to_string(),
            score,
            rhythm: Some(rhythm),
            tempo_bpm: 80.0,
            trigger: None,
            silent: false,
        }],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 1,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: Vec::new(),
        conflict_priority: vec!["automated".to_string()],
        track_flow_boxes: vec![],
    });
    let mut queue = VecDeque::new();

    realize_parallel_until(&mut runtime, PPQN as u64, &mut queue).unwrap();

    assert_eq!(note_on_ticks(&queue), vec![0, PPQN as u64 / 2]);
    assert_eq!(
        parallel_note_off_ticks(&queue),
        vec![PPQN as u64 / 2, PPQN as u64]
    );
    assert_eq!(runtime.tracks[0].realized_up_to_cycle, 2);
    assert_eq!(runtime.tracks[0].realized_up_to_reference_tick, PPQN as u64);
}

#[test]
fn parallel_local_tempo_automation_integrates_continuously_inside_cycle() {
    let score = beat_pulse_score("ramp", 4);
    let rhythm = playback_config_with_automation(tempo_ramp_automation(80.0, 160.0));
    let mut runtime = ParallelRuntimeConfig::from_config(ParallelPlaybackConfig {
        tracks: vec![ParallelPlaybackTrackConfig {
            id: "ramp".to_string(),
            name: "Ramp".to_string(),
            score,
            rhythm: Some(rhythm),
            tempo_bpm: 80.0,
            trigger: None,
            silent: false,
        }],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: Vec::new(),
        conflict_priority: vec!["ramp".to_string()],
        track_flow_boxes: vec![],
    });
    let mut queue = VecDeque::new();

    realize_parallel_until(&mut runtime, 2_500, &mut queue).unwrap();

    let starts = note_on_ticks(&queue);
    let ends = parallel_note_off_ticks(&queue);
    assert_eq!(starts[0], 0);
    assert!(
        starts[1] < PPQN as u64,
        "a continuous 80->160 BPM ramp should pull beat 2 earlier than a stair-step cycle scale"
    );
    assert!(
        ends[3] < 3 * PPQN as u64,
        "the integrated local cycle should end before 3 reference beats, got {}",
        ends[3]
    );
    assert_eq!(runtime.tracks[0].realized_up_to_cycle, 1);
    assert_eq!(runtime.tracks[0].realized_up_to_reference_tick, ends[3]);
}

#[test]
fn parallel_local_tempo_map_warps_queue_but_keeps_metadata_track_local() {
    let score = beat_pulse_score("metadata-ramp", 4);
    let rhythm = playback_config_with_automation(tempo_ramp_automation(80.0, 160.0));
    let tempo_map =
        LocalTempoAutomationMap::from_cycle(&score, Some(&rhythm), 1, 4 * PPQN as u64, 80.0, 80.0);
    let mapped_cycle_base_tick = 9_999;
    let cycle_base_tick = 4 * PPQN as u64;
    let mut queue = VecDeque::from([
        QueuedEvent::note_on(cycle_base_tick + PPQN as u64, 0, 60, 96),
        QueuedEvent::note_off(cycle_base_tick + 4 * PPQN as u64, 0, 60),
    ]);
    let mut events = CyclePlaybackEvents {
        channel_hocket: vec![ChannelHocketPlaybackEvent {
            cycle: 1,
            start_tick: PPQN as u64,
            end_tick: 4 * PPQN as u64,
            channel: 2,
            source: RhythmChoiceSource::Transition,
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
        }],
        seed_trace: Vec::new(),
        parallel_conflict: Vec::new(),
        trigger_decisions: Vec::new(),
        realized_rhythm: Vec::new(),
        track_flow: Vec::new(),
        resolved_cycle: None,
    };

    map_parallel_queue_ticks(
        &mut queue,
        cycle_base_tick,
        mapped_cycle_base_tick,
        &tempo_map,
    );
    tag_parallel_playback_events(&mut events, 2, "metadata-ramp", "Metadata Ramp");

    assert_ne!(events.channel_hocket[0].start_tick, queue[0].absolute_tick);
    assert_eq!(events.channel_hocket[0].start_tick, PPQN as u64);
    assert_eq!(events.channel_hocket[0].end_tick, 4 * PPQN as u64);
    assert_eq!(
        events.channel_hocket[0].parallel_track_id.as_deref(),
        Some("metadata-ramp")
    );
    assert_eq!(
        events.channel_hocket[0].parallel_track_name.as_deref(),
        Some("Metadata Ramp")
    );
}

#[test]
fn parallel_track_position_reports_local_cycle_for_reference_tick() {
    let score = beat_pulse_score("position-ramp", 4);
    let rhythm = playback_config_with_automation(tempo_ramp_automation(80.0, 160.0));
    let mut runtime = ParallelRuntimeConfig::from_config(ParallelPlaybackConfig {
        tracks: vec![ParallelPlaybackTrackConfig {
            id: "position-ramp".to_string(),
            name: "Position Ramp".to_string(),
            score,
            rhythm: Some(rhythm),
            tempo_bpm: 80.0,
            trigger: None,
            silent: false,
        }],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: Vec::new(),
        conflict_priority: vec!["position-ramp".to_string()],
        track_flow_boxes: vec![],
    });
    let mut queue = VecDeque::new();

    realize_parallel_until(&mut runtime, 3 * PPQN as u64, &mut queue).unwrap();

    let first_cycle_end = runtime.tracks[0].timing_windows[0].reference_end_tick;
    assert!(first_cycle_end < 3 * PPQN as u64);
    let positions = runtime.track_positions(first_cycle_end.saturating_add(1));
    assert_eq!(positions.len(), 1);
    assert_eq!(positions[0].track_id, "position-ramp");
    assert_eq!(positions[0].cycle, 1);
    assert!(
        positions[0].tick_in_cycle < PPQN as u64 / 16,
        "the active track timeline should advance to local cycle 1 near its local start"
    );
}

#[test]
fn final_note_group_metadata_pairs_note_on_and_note_off() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair_on_channel(12, 96, 1, 64, 2) {
        queue.push_back(event);
    }

    let groups = collect_final_note_groups(&queue);

    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].track_index, 1);
    assert_eq!(groups[0].track_id, "beta");
    assert_eq!(groups[0].track_name, "Beta");
    assert_eq!(groups[0].output_channel, 3);
    assert_eq!(groups[0].pitch, 64);
    assert_eq!(groups[0].velocity, 96);
    assert_eq!(groups[0].start_tick, 12);
    assert_eq!(groups[0].end_tick, 96);
    assert_eq!(groups[0].event_indices, vec![0, 1]);
    assert_eq!(groups[0].note_off_event_indices, vec![1]);
}

#[test]
fn nested_same_pitch_groups_pair_inner_to_inner_channel_collection() {
    // Outer note [0,400) and inner note [100,200) on the same channel/pitch.
    // Event order after sorting: on@0, on@100, off@200, off@400.
    // LIFO must pair inner on@100 -> off@200 and outer on@0 -> off@400, not
    // swap them (which FIFO/forward-scan would do).
    let mut events = vec![
        QueuedEvent::note_on(0, 0, 60, 96),
        QueuedEvent::note_on(100, 0, 60, 96),
        QueuedEvent::note_off(200, 0, 60),
        QueuedEvent::note_off(400, 0, 60),
    ];
    events.sort_by(|a, b| {
        a.absolute_tick
            .cmp(&b.absolute_tick)
            .then_with(|| a.dispatch_order().cmp(&b.dispatch_order()))
    });
    let groups = collect_channel_note_groups(&events);
    assert_eq!(groups.len(), 2);
    // Groups are ordered by note-on position: outer (on@0) then inner (on@100).
    assert_eq!((groups[0].start_tick, groups[0].end_tick), (0, 400));
    assert_eq!((groups[1].start_tick, groups[1].end_tick), (100, 200));
}

#[test]
fn nested_same_pitch_groups_pair_inner_to_inner_final_collection() {
    // Same nesting, exercised through the parallel conflict-pass collector.
    let mut queue = VecDeque::new();
    for event in parallel_note_pair_on_channel(0, 400, 0, 60, 0) {
        queue.push_back(event);
    }
    for event in parallel_note_pair_on_channel(100, 200, 0, 60, 0) {
        queue.push_back(event);
    }
    sort_queue(&mut queue);
    let groups = collect_final_note_groups(&queue);
    let mut spans: Vec<(u64, u64)> = groups.iter().map(|g| (g.start_tick, g.end_tick)).collect();
    spans.sort_unstable();
    assert_eq!(spans, vec![(0, 400), (100, 200)]);
    assert!(
        groups.iter().all(|g| g.end_tick >= g.start_tick),
        "no group may have negative duration"
    );
}

#[test]
fn sequential_same_pitch_groups_unchanged_under_lifo() {
    // The common case: two back-to-back same-pitch notes. LIFO must behave
    // exactly like the previous forward-scan pairing.
    let mut events = vec![
        QueuedEvent::note_on(0, 0, 60, 96),
        QueuedEvent::note_off(100, 0, 60),
        QueuedEvent::note_on(100, 0, 60, 96),
        QueuedEvent::note_off(200, 0, 60),
    ];
    events.sort_by(|a, b| {
        a.absolute_tick
            .cmp(&b.absolute_tick)
            .then_with(|| a.dispatch_order().cmp(&b.dispatch_order()))
    });
    let groups = collect_channel_note_groups(&events);
    assert_eq!(groups.len(), 2);
    assert_eq!((groups[0].start_tick, groups[0].end_tick), (0, 100));
    assert_eq!((groups[1].start_tick, groups[1].end_tick), (100, 200));
}

fn seed_entry(
    cycle: u64,
    domain: &str,
    seed: u64,
    track_id: Option<&str>,
) -> SeedPathPlaybackEntry {
    SeedPathPlaybackEntry {
        cycle,
        domain: domain.to_string(),
        label: format!("{domain} {seed}"),
        seed,
        base_seed: None,
        source: "history".to_string(),
        history_before: vec![],
        history_after: vec![],
        track_id: track_id.map(str::to_string),
    }
}

#[test]
fn seed_path_track_match_rule_handles_legacy_and_concrete_ids() {
    // None recorded matches any replaying track (legacy/single-track).
    assert!(seed_path_track_matches(None, Some("beta")));
    assert!(seed_path_track_matches(None, None));
    // None replaying (single-track playback) accepts any recorded entry.
    assert!(seed_path_track_matches(Some("alpha"), None));
    // Concrete vs concrete must be equal.
    assert!(seed_path_track_matches(Some("beta"), Some("beta")));
    assert!(!seed_path_track_matches(Some("alpha"), Some("beta")));
}

#[test]
fn seed_path_entry_lookup_filters_by_track() {
    let path = SeedPathPlaybackConfig {
        entries: vec![
            seed_entry(0, "rhythm", 111, Some("alpha")),
            seed_entry(0, "rhythm", 222, Some("beta")),
            seed_entry(0, "rhythm", 333, None), // legacy
        ],
        wildcards: vec![],
    };
    // Beta replay sees beta's entry and the legacy entry, not alpha's.
    let beta = seed_path_entries_for_domain(Some(&path), 0, "rhythm", Some("beta"));
    let beta_seeds: Vec<u64> = beta.iter().map(|e| e.seed).collect();
    assert_eq!(beta_seeds, vec![222, 333]);
    // Alpha replay sees alpha's entry and the legacy entry, not beta's.
    let alpha = seed_path_entries_for_domain(Some(&path), 0, "rhythm", Some("alpha"));
    let alpha_seeds: Vec<u64> = alpha.iter().map(|e| e.seed).collect();
    assert_eq!(alpha_seeds, vec![111, 333]);
    // Single-track replay (None) sees everything (back-compat).
    let any = seed_path_entries_for_domain(Some(&path), 0, "rhythm", None);
    assert_eq!(any.len(), 3);
}

#[test]
fn seed_path_wildcard_can_scope_to_one_track() {
    let path = SeedPathPlaybackConfig {
        entries: vec![
            seed_entry(0, "rhythm", 111, Some("alpha")),
            seed_entry(0, "rhythm", 222, Some("beta")),
        ],
        wildcards: vec![SeedPathWildcard {
            domain: "rhythm".to_string(),
            cycle: Some(0),
            track_id: Some("beta".to_string()),
        }],
    };
    // Beta's rhythm is wildcarded -> no forced entry (fresh resolution).
    assert!(seed_path_entries_for_domain(Some(&path), 0, "rhythm", Some("beta")).is_empty());
    // Alpha is unaffected by a beta-scoped wildcard.
    let alpha = seed_path_entries_for_domain(Some(&path), 0, "rhythm", Some("alpha"));
    assert_eq!(alpha.iter().map(|e| e.seed).collect::<Vec<_>>(), vec![111]);
}

#[test]
fn parallel_allow_all_overlapping_same_pitch_defers_premature_note_offs() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 240, 1, 60) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::AllowAll);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    // The premature off is deferred to the overlap chain's end, not
    // dropped: last-off receivers hear one merged sustain, and every
    // note-on keeps a closing off (no hung-note leak).
    assert_eq!(parallel_note_on_tracks(&queue), vec![0, 1]);
    assert_eq!(parallel_note_off_ticks(&queue), vec![240, 240]);
}

#[test]
fn parallel_allow_all_adjacent_same_pitch_keeps_intentional_note_offs() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(120, 240, 1, 60) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::AllowAll);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&queue), vec![0, 1]);
    assert_eq!(parallel_note_off_ticks(&queue), vec![120, 240]);
}

#[test]
fn parallel_collision_xor_suppresses_colliding_channel_groups() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(240, 360, 0, 62) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Xor);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&queue), vec![0]);
    assert_eq!(
        queue
            .iter()
            .filter(|event| is_note_off_event(event))
            .count(),
        1
    );
}

#[test]
fn parallel_collision_xor_suppresses_staggered_overlapping_note_groups() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 240, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(120, 360, 1, 67) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Xor);

    let decisions = apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert!(parallel_note_on_tracks(&queue).is_empty());
    assert!(parallel_note_off_ticks(&queue).is_empty());
    assert_eq!(decisions.len(), 2);
    assert!(decisions.iter().all(|decision| {
        !decision.passed
            && decision.conflict_policy == "xor"
            && decision.colliding_track_ids == ["alpha", "beta"]
    }));
}

fn hocket_metadata(
    track_index: usize,
    track_id: &str,
    start_tick: u64,
) -> ChannelHocketPlaybackEvent {
    ChannelHocketPlaybackEvent {
        cycle: 0,
        start_tick,
        end_tick: start_tick + 60,
        channel: 3,
        source: RhythmChoiceSource::Transition,
        fallback: false,
        position_rule_id: None,
        position_rule_label: None,
        position_scope: None,
        position_nth: None,
        position_action: None,
        parallel_track_index: Some(track_index),
        parallel_track_id: Some(track_id.to_string()),
        parallel_track_name: Some(track_id.to_string()),
        suppressed: false,
    }
}

fn suppressed_decision(
    track_index: usize,
    track_id: &str,
    start_tick: u64,
) -> ParallelConflictDecision {
    ParallelConflictDecision {
        absolute_tick: start_tick,
        output_channel: 3,
        pitch: 69,
        start_tick,
        end_tick: start_tick + 60,
        track_id: track_id.to_string(),
        track_name: track_id.to_string(),
        track_index,
        conflict_policy: "xor".to_string(),
        conflict_action: "xor-suppress".to_string(),
        conflict_group_id: format!("{start_tick}:3"),
        colliding_track_ids: vec!["alpha".to_string(), "beta".to_string()],
        active_track_count: 2,
        passed: false,
    }
}

#[test]
fn suppressed_note_group_flags_timeline_metadata_for_ghosting() {
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Xor);
    let beta_score = Score::single_pulse("beta", 67, 96);
    let tpc = ticks_per_cycle(&beta_score).max(1);
    runtime.tracks[1]
        .timing_windows
        .push_back(ParallelTrackTimingWindow {
            cycle: 0,
            reference_start_tick: 0,
            reference_end_tick: tpc,
            local_ticks_per_cycle: tpc,
            tempo_map: LocalTempoAutomationMap::from_cycle(&beta_score, None, 0, tpc, 80.0, 80.0),
        });
    let mut events = empty_cycle_playback_events();
    events.channel_hocket.push(hocket_metadata(1, "beta", 120));
    events.channel_hocket.push(hocket_metadata(0, "alpha", 120));
    flag_suppressed_playback_metadata(
        &mut events,
        &[suppressed_decision(1, "beta", 120)],
        &runtime,
    );
    assert!(events.channel_hocket[0].suppressed);
    assert!(!events.channel_hocket[1].suppressed);
}

#[test]
fn conflict_metadata_can_use_current_batch_windows_before_pruning() {
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Xor);
    let beta_score = Score::single_pulse("beta", 67, 96);
    let tpc = ticks_per_cycle(&beta_score).max(1);
    for cycle in 0..10_u64 {
        let base = cycle * tpc;
        runtime.tracks[1]
            .timing_windows
            .push_back(ParallelTrackTimingWindow {
                cycle,
                reference_start_tick: base,
                reference_end_tick: base + tpc,
                local_ticks_per_cycle: tpc,
                tempo_map: LocalTempoAutomationMap::from_cycle(
                    &beta_score,
                    None,
                    cycle,
                    tpc,
                    80.0,
                    80.0,
                ),
            });
    }
    let mut events = empty_cycle_playback_events();
    events.channel_hocket.push(hocket_metadata(1, "beta", 120));
    flag_suppressed_playback_metadata(
        &mut events,
        &[suppressed_decision(1, "beta", 120)],
        &runtime,
    );
    assert!(events.channel_hocket[0].suppressed);
    prune_parallel_timing_windows(&mut runtime);
    assert_eq!(runtime.tracks[1].timing_windows.len(), 8);
    assert_eq!(runtime.tracks[1].timing_windows[0].cycle, 2);
}

#[test]
fn parallel_collision_xor_keeps_adjacent_non_overlapping_note_groups() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(120, 240, 1, 67) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Xor);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&queue), vec![0, 1]);
    assert_eq!(parallel_note_off_ticks(&queue), vec![120, 240]);
}

#[test]
fn parallel_collision_resolves_new_batch_against_existing_future_events() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(480, 720, 0, 60) {
        queue.push_back(event);
    }
    let mut batch = VecDeque::new();
    for event in parallel_note_pair(480, 720, 1, 67) {
        batch.push_back(event);
    }
    let resolve_keys = parallel_note_group_keys(&batch);
    queue.extend(batch);
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Xor);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, Some(&resolve_keys));

    assert!(parallel_note_on_tracks(&queue).is_empty());
    assert_eq!(
        queue
            .iter()
            .filter(|event| is_note_off_event(event))
            .count(),
        0
    );
}

#[test]
fn parallel_collision_resolves_new_batch_against_existing_overlap() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(480, 720, 0, 60) {
        queue.push_back(event);
    }
    let mut batch = VecDeque::new();
    for event in parallel_note_pair(600, 840, 1, 67) {
        batch.push_back(event);
    }
    let resolve_keys = parallel_note_group_keys(&batch);
    queue.extend(batch);
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Xor);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, Some(&resolve_keys));

    assert!(parallel_note_on_tracks(&queue).is_empty());
    assert!(parallel_note_off_ticks(&queue).is_empty());
}

#[test]
fn parallel_collision_priority_chooses_highest_priority_tab() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::PriorityOrder);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&queue), vec![1]);
    assert!(queue
        .iter()
        .all(|event| event.parallel_track_index == Some(1)));
}

#[test]
fn parallel_collision_debug_records_passed_and_suppressed_groups() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::PriorityOrder);

    let decisions = apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(decisions.len(), 2);
    let passed = decisions
        .iter()
        .find(|decision| decision.passed)
        .expect("passed decision");
    let suppressed = decisions
        .iter()
        .find(|decision| !decision.passed)
        .expect("suppressed decision");
    assert_eq!(passed.track_id, "beta");
    assert_eq!(passed.track_name, "Beta");
    assert_eq!(passed.conflict_policy, "priorityOrder");
    assert_eq!(passed.conflict_action, "priority-winner");
    assert_eq!(passed.conflict_group_id, "0:1");
    assert_eq!(passed.colliding_track_ids, vec!["alpha", "beta"]);
    assert_eq!(suppressed.track_id, "alpha");
    assert_eq!(suppressed.conflict_action, "priority-suppress");
    assert!(queue.iter().all(|event| {
        event.parallel_track_id.as_deref() == Some("beta")
            && event
                .parallel_conflict
                .as_ref()
                .is_some_and(|metadata| metadata.group_id == "0:1")
    }));
}

#[test]
fn parallel_collision_alternate_rotates_by_channel() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(240, 360, 0, 62) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(240, 360, 1, 69) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Alternate);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&queue), vec![0, 1]);
}

#[test]
fn parallel_collision_xnor_passes_collisions_but_suppresses_singles() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(240, 360, 2, 72) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Xnor);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&queue), vec![0, 1]);
}

#[test]
fn parallel_collision_ignores_other_midi_channels() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair_on_channel(0, 120, 0, 60, 0) {
        queue.push_back(event);
    }
    for event in parallel_note_pair_on_channel(0, 120, 1, 67, 1) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Xor);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&queue), vec![0, 1]);
    assert_eq!(parallel_note_off_ticks(&queue), vec![120, 120]);
}

#[test]
fn parallel_collision_and_requires_every_audible_track() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::And);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert!(parallel_note_on_tracks(&queue).is_empty());

    let mut full_queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        full_queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        full_queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 2, 72) {
        full_queue.push_back(event);
    }
    apply_parallel_channel_conflicts_for_keys(&mut full_queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&full_queue), vec![0, 1, 2]);
}

#[test]
fn parallel_collision_nand_suppresses_only_full_audible_consensus() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Nand);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&queue), vec![0, 1]);

    for event in parallel_note_pair(0, 120, 2, 72) {
        queue.push_back(event);
    }
    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert!(parallel_note_on_tracks(&queue).is_empty());
}

#[test]
fn parallel_collision_majority_and_minority_use_audible_track_denominator() {
    let mut majority_queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        majority_queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        majority_queue.push_back(event);
    }
    let mut majority_runtime = parallel_runtime(ChannelConflictPolicy::Majority);

    apply_parallel_channel_conflicts_for_keys(&mut majority_queue, &mut majority_runtime, None);

    assert_eq!(parallel_note_on_tracks(&majority_queue), vec![0, 1]);

    let mut minority_queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        minority_queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        minority_queue.push_back(event);
    }
    let mut minority_runtime = parallel_runtime(ChannelConflictPolicy::Minority);

    apply_parallel_channel_conflicts_for_keys(&mut minority_queue, &mut minority_runtime, None);

    assert!(parallel_note_on_tracks(&minority_queue).is_empty());
}

#[test]
fn parallel_collision_nor_suppresses_any_channel_time_group() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Nor);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert!(parallel_note_on_tracks(&queue).is_empty());
    assert!(parallel_note_off_ticks(&queue).is_empty());
}

#[test]
fn parallel_channel_logic_matrix_overrides_one_track_pair() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 2, 72) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::AllowAll);
    runtime
        .channel_logic_matrix
        .insert(channel_logic_key(0, 1, None), ChannelConflictPolicy::Xor);

    let decisions = apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    // The Xor rule on (0,1) vetoes both; track 2 is untouched by any rule
    // and passes on the AllowAll default.
    assert_eq!(parallel_note_on_tracks(&queue), vec![2]);
    assert_eq!(decisions.len(), 3);
    let decision_for = |track_id: &str| {
        decisions
            .iter()
            .find(|decision| decision.track_id == track_id)
            .unwrap_or_else(|| panic!("no decision for {track_id}"))
    };
    // Per-track labels (O3): only the ruled tracks read as channelLogicMatrix.
    for ruled in ["alpha", "beta"] {
        let decision = decision_for(ruled);
        assert_eq!(decision.conflict_policy, "channelLogicMatrix");
        assert_eq!(decision.conflict_action, "matrix-suppress");
        assert!(!decision.passed);
    }
    let gamma = decision_for("gamma");
    assert_eq!(gamma.conflict_policy, "allowAll");
    assert!(gamma.passed);
}

#[test]
fn parallel_channel_logic_matrix_adds_logica_simple_modes() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::AllowAll);
    runtime
        .channel_logic_matrix
        .insert(channel_logic_key(0, 1, None), ChannelConflictPolicy::Odd);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert!(parallel_note_on_tracks(&queue).is_empty());
}

#[test]
fn parallel_channel_logic_matrix_targets_one_midi_channel() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair_on_channel(0, 120, 0, 60, 0) {
        queue.push_back(event);
    }
    for event in parallel_note_pair_on_channel(0, 120, 1, 67, 0) {
        queue.push_back(event);
    }
    for event in parallel_note_pair_on_channel(240, 360, 0, 62, 1) {
        queue.push_back(event);
    }
    for event in parallel_note_pair_on_channel(240, 360, 1, 69, 1) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::AllowAll);
    runtime
        .channel_logic_matrix
        .insert(channel_logic_key(0, 1, Some(1)), ChannelConflictPolicy::Xor);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    let remaining = queue
        .iter()
        .filter(|event| is_note_on_event(event))
        .map(|event| {
            (
                event.parallel_track_index.unwrap(),
                event.user_channel.unwrap(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(remaining, vec![(0, 2), (1, 2)]);
}

#[test]
fn parallel_channel_logic_matrix_channel_rule_overrides_pair_fallback() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair_on_channel(0, 120, 0, 60, 0) {
        queue.push_back(event);
    }
    for event in parallel_note_pair_on_channel(0, 120, 1, 67, 0) {
        queue.push_back(event);
    }
    for event in parallel_note_pair_on_channel(240, 360, 0, 62, 1) {
        queue.push_back(event);
    }
    for event in parallel_note_pair_on_channel(240, 360, 1, 69, 1) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::AllowAll);
    runtime
        .channel_logic_matrix
        .insert(channel_logic_key(0, 1, None), ChannelConflictPolicy::Xor);
    runtime.channel_logic_matrix.insert(
        channel_logic_key(0, 1, Some(2)),
        ChannelConflictPolicy::AllowAll,
    );

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    let remaining = queue
        .iter()
        .filter(|event| is_note_on_event(event))
        .map(|event| {
            (
                event.parallel_track_index.unwrap(),
                event.user_channel.unwrap(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(remaining, vec![(0, 2), (1, 2)]);
}

// O3 (spec §5): a rule stays authoritative for its pair — it can rescue a
// pair the group-wise default suppressed. Xor default suppresses two
// colliding tracks; an explicit AllowAll ("Layer") rule on the pair passes
// both.
#[test]
fn parallel_channel_logic_rule_rescues_pair_from_suppressing_default() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Xor);
    runtime.channel_logic_matrix.insert(
        channel_logic_key(0, 1, None),
        ChannelConflictPolicy::AllowAll,
    );

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&queue), vec![0, 1]);
}

// O3: a rule can veto a track the permissive default allowed, without
// touching the unruled tracks. AllowAll default passes all three; a
// forceOff rule on (0,1) removes exactly those two, leaving track 2.
#[test]
fn parallel_channel_logic_rule_vetoes_pair_from_permissive_default() {
    let mut queue = VecDeque::new();
    for event in parallel_note_pair(0, 120, 0, 60) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 1, 67) {
        queue.push_back(event);
    }
    for event in parallel_note_pair(0, 120, 2, 72) {
        queue.push_back(event);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::AllowAll);
    runtime.channel_logic_matrix.insert(
        channel_logic_key(0, 1, None),
        ChannelConflictPolicy::ForceOff,
    );

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    assert_eq!(parallel_note_on_tracks(&queue), vec![2]);
}

// O3 headline (the pairwise-cliff fix): an irrelevant rule — one whose pair
// never appears in a component — must not change the outcome. A count-based
// default (`And`, active=3) evaluated group-wise suppresses a 2-track
// component; before O3, the mere PRESENCE of any matrix entry switched the
// default to a pairwise active=2 evaluation that would have passed both.
#[test]
fn parallel_channel_logic_irrelevant_rule_does_not_degrade_group_default() {
    // Tracks 0,1 collide on channel 1; track 2 sounds alone on channel 2 —
    // three audible participants, one 2-track collision component.
    let build_queue = || {
        let mut queue = VecDeque::new();
        for event in parallel_note_pair_on_channel(0, 120, 0, 60, 0) {
            queue.push_back(event);
        }
        for event in parallel_note_pair_on_channel(0, 120, 1, 67, 0) {
            queue.push_back(event);
        }
        for event in parallel_note_pair_on_channel(0, 120, 2, 72, 1) {
            queue.push_back(event);
        }
        queue
    };

    let mut without_rule = build_queue();
    let mut runtime = parallel_runtime(ChannelConflictPolicy::And);
    apply_parallel_channel_conflicts_for_keys(&mut without_rule, &mut runtime, None);

    let mut with_irrelevant_rule = build_queue();
    let mut runtime = parallel_runtime(ChannelConflictPolicy::And);
    // A rule on the (0,1) pair but on a channel no component ever uses.
    runtime.channel_logic_matrix.insert(
        channel_logic_key(0, 1, Some(9)),
        ChannelConflictPolicy::AllowAll,
    );
    apply_parallel_channel_conflicts_for_keys(&mut with_irrelevant_rule, &mut runtime, None);

    // Identical outcome; And(active=3) suppresses the 2-track component.
    assert_eq!(
        parallel_note_on_tracks(&without_rule),
        parallel_note_on_tracks(&with_irrelevant_rule)
    );
    assert!(!parallel_note_on_tracks(&with_irrelevant_rule).contains(&0));
    assert!(!parallel_note_on_tracks(&with_irrelevant_rule).contains(&1));
}

// A3 (D2 = Oc1): Alternate rotates the winner across successive collisions
// within a reference cycle. Two separate same-channel collisions in cycle 0
// → the first picks track index 0 (ordinal 0), the second picks track index 1
// (ordinal 1).
#[test]
fn parallel_alternate_rotates_winner_per_collision_within_a_cycle() {
    let mut queue = VecDeque::new();
    for e in parallel_note_pair(10, 20, 0, 60) {
        queue.push_back(e);
    }
    for e in parallel_note_pair(10, 20, 1, 60) {
        queue.push_back(e);
    }
    for e in parallel_note_pair(30, 40, 0, 62) {
        queue.push_back(e);
    }
    for e in parallel_note_pair(30, 40, 1, 62) {
        queue.push_back(e);
    }
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Alternate);

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    let winners: Vec<(u64, usize)> = queue
        .iter()
        .filter(|e| is_note_on_event(e))
        .map(|e| (e.absolute_tick, e.parallel_track_index.unwrap()))
        .collect();
    assert_eq!(winners, vec![(10, 0), (30, 1)]);
}

// Rotation is cycle-local: a collision in the next reference cycle restarts
// at ordinal 0 (same winner as the first collision of cycle 0), and it does
// not depend on the mutable state a live edit used to reset.
#[test]
fn parallel_alternate_rotation_restarts_each_cycle() {
    let mut runtime = parallel_runtime(ChannelConflictPolicy::Alternate);
    let tpc = runtime.reference_ticks_per_cycle();
    let mut queue = VecDeque::new();
    // Cycle 0 collision.
    for e in parallel_note_pair(10, 20, 0, 60) {
        queue.push_back(e);
    }
    for e in parallel_note_pair(10, 20, 1, 60) {
        queue.push_back(e);
    }
    // Cycle 1 collision (a full reference cycle later).
    for e in parallel_note_pair(tpc + 10, tpc + 20, 0, 60) {
        queue.push_back(e);
    }
    for e in parallel_note_pair(tpc + 10, tpc + 20, 1, 60) {
        queue.push_back(e);
    }

    apply_parallel_channel_conflicts_for_keys(&mut queue, &mut runtime, None);

    let winners: Vec<(u64, usize)> = queue
        .iter()
        .filter(|e| is_note_on_event(e))
        .map(|e| (e.absolute_tick, e.parallel_track_index.unwrap()))
        .collect();
    // Both cycles' first collision resolve to ordinal 0 → track index 0.
    assert_eq!(winners, vec![(10, 0), (tpc + 10, 0)]);
}
#[test]
fn pop_due_event_leaves_future_events_queued() {
    let mut queue = VecDeque::from([
        QueuedEvent::note_on(10, 0, 60, 96),
        QueuedEvent::note_on(20, 0, 62, 96),
    ]);

    assert!(pop_due_event(&mut queue, 9).is_none());
    assert_eq!(queue.len(), 2);

    let event = pop_due_event(&mut queue, 10).expect("tick 10 should be due");
    assert_eq!(event.absolute_tick, 10);
    assert_eq!(queue.front().map(|event| event.absolute_tick), Some(20));

    assert!(pop_due_event(&mut queue, 15).is_none());
    assert_eq!(queue.front().map(|event| event.absolute_tick), Some(20));
}

#[test]
fn pop_due_event_dispatches_late_events_instead_of_dropping() {
    let mut queue = VecDeque::from([
        QueuedEvent::note_on(10, 0, 60, 96),
        QueuedEvent::note_on(20, 0, 62, 96),
    ]);

    let first = pop_due_event(&mut queue, 100).expect("late tick 10 should still play");
    let second = pop_due_event(&mut queue, 100).expect("late tick 20 should still play");

    assert_eq!(first.absolute_tick, 10);
    assert_eq!(second.absolute_tick, 20);
    assert!(queue.is_empty());
}

#[test]
fn resync_discard_keeps_current_and_future_events_only() {
    let mut queue = VecDeque::from([
        QueuedEvent::note_on(10, 0, 60, 96),
        QueuedEvent::note_off(20, 0, 60),
        QueuedEvent::note_on(30, 0, 62, 96),
        QueuedEvent::note_on(40, 0, 64, 96),
    ]);

    let discarded = discard_stale_events_before_tick(&mut queue, 30);

    assert_eq!(discarded, 2);
    assert_eq!(
        queue
            .iter()
            .map(|event| event.absolute_tick)
            .collect::<Vec<_>>(),
        vec![30, 40]
    );
}

#[test]
fn ledger_tracks_sounding_notes_and_clears_on_note_off() {
    let mut ledger: HashMap<(u8, u8), u32> = HashMap::new();
    ledger_record_dispatch(&mut ledger, &QueuedEvent::note_on(0, 0, 60, 96).bytes);
    ledger_record_dispatch(&mut ledger, &QueuedEvent::note_on(0, 1, 64, 96).bytes);
    assert_eq!(ledger.get(&(0, 60)), Some(&1));
    assert_eq!(ledger.get(&(1, 64)), Some(&1));

    // Overlapping same (channel, pitch) note-ons count up; one note-off leaves
    // it sounding, the second releases it.
    ledger_record_dispatch(&mut ledger, &QueuedEvent::note_on(0, 0, 60, 96).bytes);
    assert_eq!(ledger.get(&(0, 60)), Some(&2));
    ledger_record_dispatch(&mut ledger, &QueuedEvent::note_off(0, 0, 60).bytes);
    assert_eq!(
        ledger.get(&(0, 60)),
        Some(&1),
        "still one instance sounding"
    );
    // A note-on with velocity 0 is a note-off.
    ledger_record_dispatch(&mut ledger, &QueuedEvent::note_on(0, 0, 60, 0).bytes);
    assert_eq!(ledger.get(&(0, 60)), None, "released; removed from ledger");
    assert_eq!(ledger.get(&(1, 64)), Some(&1), "unrelated note untouched");
}

#[test]
fn panic_explicit_offs_honor_multiplicity_and_late_offs_stay_harmless() {
    struct ByteSink(Vec<Vec<u8>>);
    impl MidiSink for ByteSink {
        fn send_raw(&mut self, bytes: &[u8]) -> Result<(), MidiError> {
            self.0.push(bytes.to_vec());
            Ok(())
        }
    }

    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 80.0,
        is_playing: true,
        current_tick: 240,
        current_cycle: 0,
        ticks_per_cycle: 960,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));
    let mut ledger = HashMap::from([((0, 60), 2), ((2, 67), 1)]);
    let mut sink = ByteSink(Vec::new());

    send_active_note_offs_logged(&ledger, &mut sink, &shared, 240, 960, "midi panic");
    send_all_notes_off_logged(&mut sink, &shared, 240, 960, "midi panic");

    assert_eq!(
        &sink.0[..3],
        &[
            note_off_bytes(0, 60).to_vec(),
            note_off_bytes(0, 60).to_vec(),
            note_off_bytes(2, 67).to_vec(),
        ],
        "a receiver that ignores CC123 still gets one off per note-on"
    );
    assert_eq!(sink.0.len(), 3 + 16);

    // Panic clears the ledger but leaves queued offs in place. When both
    // later offs for the overlapping pitch arrive, decrementing absent
    // keys remains a no-op and the positive-residue detector stays quiet.
    ledger.clear();
    ledger_record_dispatch(&mut ledger, &note_off_bytes(0, 60));
    ledger_record_dispatch(&mut ledger, &note_off_bytes(0, 60));
    assert!(ledger.is_empty());
    assert!(stuck_note_residue(&ledger, &VecDeque::new()).is_empty());
}

#[test]
fn route_change_snapshot_preserves_sorted_note_multiplicity() {
    let ledger = HashMap::from([((9, 38), 1), ((0, 60), 2)]);
    assert_eq!(
        sounding_notes_snapshot(&ledger),
        vec![
            SoundingNote {
                channel: 0,
                note: 60,
                count: 2,
            },
            SoundingNote {
                channel: 9,
                note: 38,
                count: 1,
            },
        ]
    );
}

#[test]
fn stuck_note_residue_never_flags_notes_the_queue_will_close() {
    let mut ledger: HashMap<(u8, u8), u32> = HashMap::new();
    ledger.insert((0, 60), 1);
    // A long tie: the off is queued far ahead, plus a balanced future
    // re-attack of the same pitch. Nothing is stuck.
    let queue = VecDeque::from(vec![
        QueuedEvent::note_off(5000, 0, 60),
        QueuedEvent::note_on(6000, 0, 60, 96),
        QueuedEvent::note_off(7000, 0, 60),
    ]);
    assert_eq!(stuck_note_residue(&ledger, &queue), Vec::<(u8, u8)>::new());
}

#[test]
fn stuck_note_residue_flags_sounding_notes_the_queue_can_never_balance() {
    let mut ledger: HashMap<(u8, u8), u32> = HashMap::new();
    ledger.insert((0, 60), 1);
    ledger.insert((1, 64), 1);
    // Pitch 60's off never entered the queue (only an unrelated pair and a
    // balanced future re-attack of 60); pitch 64's off is queued.
    let queue = VecDeque::from(vec![
        QueuedEvent::note_on(100, 0, 62, 96),
        QueuedEvent::note_off(200, 0, 62),
        QueuedEvent::note_on(300, 0, 60, 96),
        QueuedEvent::note_off(400, 0, 60),
        QueuedEvent::note_off(500, 1, 64),
    ]);
    assert_eq!(stuck_note_residue(&ledger, &queue), vec![(0, 60)]);
}

#[test]
fn stuck_note_residue_ignores_pitches_that_are_not_sounding() {
    // An unpaired queued note-on for a pitch with no sounding instance is
    // not releasable at the wire yet — the sweep only names sounding keys.
    let ledger: HashMap<(u8, u8), u32> = HashMap::new();
    let queue = VecDeque::from(vec![QueuedEvent::note_on(100, 0, 60, 96)]);
    assert_eq!(stuck_note_residue(&ledger, &queue), Vec::<(u8, u8)>::new());
}

#[test]
fn orphan_sweep_releases_only_notes_the_new_stream_wont_close() {
    // Three notes sounding at the swap.
    let mut ledger: HashMap<(u8, u8), u32> = HashMap::new();
    for &(ch, pitch) in &[(0u8, 60u8), (0, 64), (1, 67)] {
        *ledger.entry((ch, pitch)).or_insert(0) += 1;
    }
    let swap_tick = 100;
    // New re-realized queue (all events at/after the swap):
    //  - (0,60): note-off later -> the new stream closes it -> NOT an orphan.
    //  - (0,64): a fresh note-on later -> would collide -> ORPHAN (release now).
    //  - (1,67): no event at all -> ORPHAN.
    let queue = VecDeque::from([
        QueuedEvent::note_off(120, 0, 60),
        QueuedEvent::note_on(140, 0, 64, 96),
        QueuedEvent::note_off(200, 0, 64),
    ]);
    let orphans = orphaned_active_notes(&ledger, &queue, swap_tick);
    assert_eq!(orphans, vec![(0, 64), (1, 67)]);
}

#[test]
fn orphan_sweep_ignores_events_before_the_swap_tick() {
    // A note-off that fell *before* the swap tick (stale, discarded) does not
    // count as closing the sounding note — it must still be swept.
    let mut ledger: HashMap<(u8, u8), u32> = HashMap::new();
    *ledger.entry((0, 60)).or_insert(0) += 1;
    let queue = VecDeque::from([QueuedEvent::note_off(50, 0, 60)]);
    assert_eq!(orphaned_active_notes(&ledger, &queue, 100), vec![(0, 60)]);
    // The same note-off at/after the swap tick DOES close it.
    let queue = VecDeque::from([QueuedEvent::note_off(150, 0, 60)]);
    assert!(orphaned_active_notes(&ledger, &queue, 100).is_empty());
}

fn channel_hocket_spec() -> cseq_rhythm::ChannelHocketSpec {
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

fn channel_position_rule(
    id: &str,
    scope: cseq_rhythm::ChannelPositionScope,
    nth: u32,
    action: cseq_rhythm::ChannelPositionAction,
    channel: u8,
) -> cseq_rhythm::ChannelPositionRule {
    let action_weights = match action {
        cseq_rhythm::ChannelPositionAction::NormalMarkov => {
            cseq_rhythm::ChannelPositionActionWeights {
                normal_markov: 1,
                render_only: 0,
                reset_markov: 0,
            }
        }
        cseq_rhythm::ChannelPositionAction::RenderOnly => {
            cseq_rhythm::ChannelPositionActionWeights {
                normal_markov: 0,
                render_only: 1,
                reset_markov: 0,
            }
        }
        cseq_rhythm::ChannelPositionAction::ResetMarkov => {
            cseq_rhythm::ChannelPositionActionWeights {
                normal_markov: 0,
                render_only: 0,
                reset_markov: 1,
            }
        }
    };
    cseq_rhythm::ChannelPositionRule {
        id: id.to_string(),
        label: id.to_string(),
        enabled: true,
        scope,
        nth,
        action_weights,
        render_weights: vec![cseq_rhythm::ChannelAccentWeight { channel, weight: 1 }],
        reset: cseq_rhythm::ChannelPositionResetSpec {
            mode: cseq_rhythm::ChannelPositionResetMode::CustomWeighted,
            weights: vec![cseq_rhythm::ChannelAccentWeight { channel, weight: 1 }],
        },
    }
}
#[test]
fn channel_hocket_rewrites_note_pairs_after_queue_realization() {
    let mut queue = four_matra_queue();
    let mut spec = channel_hocket_spec();

    let (events, seed) =
        apply_channel_hocket_to_queue(&mut queue, 0, 960, &[], &mut spec, 0, None, 1, None)
            .expect("channel hocket");

    assert_eq!(seed.expect("seed").seed, 1);
    assert_eq!(note_on_channels(&queue), vec![1, 2, 3, 1]);
    assert_eq!(
        events
            .iter()
            .map(|event| (event.start_tick, event.end_tick, event.channel))
            .collect::<Vec<_>>(),
        vec![(0, 240, 1), (240, 480, 2), (480, 720, 3), (720, 960, 1)]
    );
}

#[test]
fn channel_hocket_ignores_events_outside_current_cycle_window() {
    let mut queue = four_matra_queue();
    queue.extend(four_matra_queue().into_iter().map(|mut event| {
        event.absolute_tick += 960;
        event
    }));
    let mut spec = channel_hocket_spec();

    let (events, _seed) =
        apply_channel_hocket_to_queue(&mut queue, 960, 960, &[], &mut spec, 1, None, 1, None)
            .expect("channel hocket");

    assert_eq!(events.len(), 4);
    assert!(events
        .iter()
        .all(|event| event.cycle == 1 && event.start_tick < 960 && event.end_tick <= 960));
    assert_eq!(
        note_on_channels_in_tick_range(&queue, 0, 960),
        vec![1, 1, 1, 1]
    );
    assert_eq!(
        note_on_channels_in_tick_range(&queue, 960, 1920),
        vec![1, 2, 3, 1]
    );
}

#[test]
fn accent_render_only_channel_does_not_move_markov_history() {
    let mut queue = four_matra_queue();
    queue[0].bytes[2] = 120;
    let mut spec = channel_hocket_spec();
    spec.accent_rules = vec![cseq_rhythm::ChannelAccentRule {
        min_velocity: 110,
        max_velocity: 127,
        probability: 1.0,
        mode: cseq_rhythm::ChannelAccentRoutingMode::RenderOnly,
        weights: vec![cseq_rhythm::ChannelAccentWeight {
            channel: 3,
            weight: 1,
        }],
    }];

    let (events, _seed) =
        apply_channel_hocket_to_queue(&mut queue, 0, 960, &[], &mut spec, 0, None, 1, None)
            .expect("channel hocket");

    assert_eq!(note_on_channels(&queue), vec![3, 2, 3, 1]);
    assert_eq!(events[0].source, RhythmChoiceSource::Accent);
    assert_eq!(events[1].source, RhythmChoiceSource::Transition);
}

#[test]
fn accent_drive_chain_channel_becomes_markov_history() {
    let mut queue = four_matra_queue();
    queue[0].bytes[2] = 120;
    let mut spec = channel_hocket_spec();
    spec.accent_rules = vec![cseq_rhythm::ChannelAccentRule {
        min_velocity: 110,
        max_velocity: 127,
        probability: 1.0,
        mode: cseq_rhythm::ChannelAccentRoutingMode::DriveChain,
        weights: vec![cseq_rhythm::ChannelAccentWeight {
            channel: 3,
            weight: 1,
        }],
    }];

    let (events, _seed) =
        apply_channel_hocket_to_queue(&mut queue, 0, 960, &[], &mut spec, 0, None, 1, None)
            .expect("channel hocket");

    assert_eq!(note_on_channels(&queue), vec![3, 1, 2, 3]);
    assert_eq!(events[0].source, RhythmChoiceSource::Accent);
    assert_eq!(events[1].source, RhythmChoiceSource::Transition);
}

#[test]
fn position_render_only_channel_does_not_move_markov_history() {
    let mut queue = four_matra_queue();
    let mut spec = channel_hocket_spec();
    spec.position_rules = vec![channel_position_rule(
        "beat-two",
        cseq_rhythm::ChannelPositionScope::Beat,
        2,
        cseq_rhythm::ChannelPositionAction::RenderOnly,
        1,
    )];

    let (events, _seed) =
        apply_channel_hocket_to_queue(&mut queue, 0, 960, &[], &mut spec, 0, None, 1, None)
            .expect("channel hocket");

    assert_eq!(note_on_channels(&queue), vec![1, 1, 3, 1]);
    assert_eq!(events[1].source, RhythmChoiceSource::Position);
    assert_eq!(
        events[1].position_action,
        Some(cseq_rhythm::ChannelPositionAction::RenderOnly)
    );
    assert_eq!(events[2].source, RhythmChoiceSource::Transition);
    assert_eq!(
        events[2].channel, 3,
        "the post-position Markov state should match the unmodulated chain"
    );
}

#[test]
fn position_normal_markov_can_leave_channel_hocket_unmodulated() {
    let mut queue = four_matra_queue();
    queue[0].bytes[2] = 120;
    let mut spec = channel_hocket_spec();
    spec.position_rules = vec![channel_position_rule(
        "first-normal",
        cseq_rhythm::ChannelPositionScope::Beat,
        1,
        cseq_rhythm::ChannelPositionAction::NormalMarkov,
        2,
    )];
    spec.accent_rules = vec![cseq_rhythm::ChannelAccentRule {
        min_velocity: 110,
        max_velocity: 127,
        probability: 1.0,
        mode: cseq_rhythm::ChannelAccentRoutingMode::RenderOnly,
        weights: vec![cseq_rhythm::ChannelAccentWeight {
            channel: 3,
            weight: 1,
        }],
    }];

    let (events, _seed) =
        apply_channel_hocket_to_queue(&mut queue, 0, 960, &[], &mut spec, 0, None, 1, None)
            .expect("channel hocket");

    assert_eq!(events[0].channel, 1);
    assert_eq!(events[0].source, RhythmChoiceSource::Initial);
    assert_eq!(
        events[0].position_action,
        Some(cseq_rhythm::ChannelPositionAction::NormalMarkov)
    );
    assert_eq!(
        note_on_channels(&queue)[0],
        1,
        "the matching position rule should bypass the accent override"
    );
}

#[test]
fn position_reset_markov_replaces_second_order_history() {
    let mut queue = four_matra_queue();
    let mut spec = channel_hocket_spec();
    spec.order = cseq_rhythm::MarkovOrder::Second;
    spec.transitions = vec![cseq_rhythm::ChannelTransition {
        from: vec![3, 3],
        to: 2,
        weight: 1,
    }];
    spec.position_rules = vec![channel_position_rule(
        "reset-second",
        cseq_rhythm::ChannelPositionScope::Beat,
        2,
        cseq_rhythm::ChannelPositionAction::ResetMarkov,
        3,
    )];

    let (events, _seed) =
        apply_channel_hocket_to_queue(&mut queue, 0, 960, &[], &mut spec, 0, None, 1, None)
            .expect("channel hocket");

    assert_eq!(note_on_channels(&queue), vec![1, 3, 2, 1]);
    assert_eq!(
        events[1].position_action,
        Some(cseq_rhythm::ChannelPositionAction::ResetMarkov)
    );
    assert_eq!(events[2].source, RhythmChoiceSource::Transition);
    assert_eq!(
        events[2].channel, 2,
        "after reset, the next second-order context should be [3, 3]"
    );
}

#[test]
fn position_section_nth_restarts_at_resolved_section_spans() {
    let mut queue = VecDeque::from([
        QueuedEvent::note_on(0, 0, 60, 96),
        QueuedEvent::note_off(120, 0, 60),
        QueuedEvent::note_on(240, 0, 61, 96),
        QueuedEvent::note_off(360, 0, 61),
        QueuedEvent::note_on(960, 0, 62, 96),
        QueuedEvent::note_off(1080, 0, 62),
        QueuedEvent::note_on(1200, 0, 63, 96),
        QueuedEvent::note_off(1320, 0, 63),
    ]);
    let spans = vec![
        PulseSpan {
            id: 1,
            kind: PulseSpanKind::Section { index: 0 },
            start: Rational::new(0, 1),
            duration: Rational::new(1, 1),
            start_matra: 0,
            matra_len: 4,
            tags: vec![],
        },
        PulseSpan {
            id: 2,
            kind: PulseSpanKind::Section { index: 1 },
            start: Rational::new(1, 1),
            duration: Rational::new(1, 1),
            start_matra: 4,
            matra_len: 4,
            tags: vec![],
        },
    ];
    let mut spec = channel_hocket_spec();
    spec.position_rules = vec![channel_position_rule(
        "section-one",
        cseq_rhythm::ChannelPositionScope::Section,
        1,
        cseq_rhythm::ChannelPositionAction::RenderOnly,
        3,
    )];

    let (events, _seed) =
        apply_channel_hocket_to_queue(&mut queue, 0, 1920, &spans, &mut spec, 0, None, 2, None)
            .expect("channel hocket");

    assert_eq!(note_on_channels(&queue), vec![3, 2, 3, 1]);
    assert_eq!(
            events
                .iter()
                .filter(|event| event.position_scope
                    == Some(cseq_rhythm::ChannelPositionScope::Section))
                .map(|event| (event.start_tick, event.position_nth, event.channel))
                .collect::<Vec<_>>(),
            vec![(0, Some(1), 3), (960, Some(1), 3)]
        );
}

fn euclid_hocket_spec(
    placement: cseq_rhythm::EuclidPlacement,
    steps: u32,
    layers: Vec<(u8, u32)>,
) -> cseq_rhythm::ChannelHocketSpec {
    let mut spec = channel_hocket_spec();
    spec.assign_mode = cseq_rhythm::ChannelAssignMode::Euclid;
    spec.euclid = Some(cseq_rhythm::EuclidChannelSpec {
        placement,
        steps,
        layers: layers
            .into_iter()
            .map(|(channel, pulses)| cseq_rhythm::EuclidChannelLayer {
                channel,
                pulses,
                rotation: 0,
                max_run: 1,
                steps: 16,
                invert: false,
            })
            .collect(),
        reset: cseq_rhythm::EuclidResetScope::Cycle,
        span_accent_mode: cseq_rhythm::EuclidSpanAccentMode::Woven,
        span_accent_channel: None,
    });
    spec
}

#[test]
fn euclid_channel_assignment_is_deterministic_and_seed_independent() {
    // Partition steps 4, E(2,4) on channel 2 -> table [2, 1, 2, 1]
    // (slots 1 and 3 fall back to channel 1).
    for seed in [1u64, 99u64] {
        let mut queue = four_matra_queue();
        let mut spec = euclid_hocket_spec(cseq_rhythm::EuclidPlacement::Partition, 4, vec![(2, 2)]);
        spec.seed_mode = cseq_rhythm::RhythmSeedMode::Locked { seed };
        let (events, _seed) =
            apply_channel_hocket_to_queue(&mut queue, 0, 960, &[], &mut spec, 0, None, 1, None)
                .expect("euclid hocket");
        assert_eq!(note_on_channels(&queue), vec![2, 1, 2, 1]);
        assert_eq!(
            events
                .iter()
                .map(|event| (event.channel, event.fallback))
                .collect::<Vec<_>>(),
            vec![(2, false), (1, true), (2, false), (1, true)]
        );
    }
}

#[test]
fn euclid_reset_scope_section_reanchors_the_pattern() {
    // Layers E(1,4) ch2 then E(1,3-of-remaining) ch3 -> table [2, 3, 1, 1].
    let spans = vec![
        PulseSpan {
            id: 1,
            kind: PulseSpanKind::Section { index: 0 },
            start: Rational::new(0, 1),
            duration: Rational::new(1, 1),
            start_matra: 0,
            matra_len: 4,
            tags: vec![],
        },
        PulseSpan {
            id: 2,
            kind: PulseSpanKind::Section { index: 1 },
            start: Rational::new(1, 1),
            duration: Rational::new(1, 1),
            start_matra: 4,
            matra_len: 4,
            tags: vec![],
        },
    ];
    let two_section_queue = || {
        VecDeque::from([
            QueuedEvent::note_on(0, 0, 60, 96),
            QueuedEvent::note_off(120, 0, 60),
            QueuedEvent::note_on(240, 0, 61, 96),
            QueuedEvent::note_off(360, 0, 61),
            QueuedEvent::note_on(960, 0, 62, 96),
            QueuedEvent::note_off(1080, 0, 62),
            QueuedEvent::note_on(1200, 0, 63, 96),
            QueuedEvent::note_off(1320, 0, 63),
        ])
    };

    // Cycle scope: the pattern runs freely across the section boundary.
    let mut queue = two_section_queue();
    let mut spec = euclid_hocket_spec(
        cseq_rhythm::EuclidPlacement::Partition,
        4,
        vec![(2, 1), (3, 1)],
    );
    apply_channel_hocket_to_queue(&mut queue, 0, 1920, &spans, &mut spec, 0, None, 2, None)
        .expect("euclid hocket");
    assert_eq!(note_on_channels(&queue), vec![2, 3, 1, 1]);

    // Section scope: the second section re-anchors to the pattern head.
    let mut queue = two_section_queue();
    let mut spec = euclid_hocket_spec(
        cseq_rhythm::EuclidPlacement::Partition,
        4,
        vec![(2, 1), (3, 1)],
    );
    spec.euclid.as_mut().unwrap().reset = cseq_rhythm::EuclidResetScope::Section;
    apply_channel_hocket_to_queue(&mut queue, 0, 1920, &spans, &mut spec, 0, None, 2, None)
        .expect("euclid hocket");
    assert_eq!(note_on_channels(&queue), vec![2, 3, 2, 3]);
}

#[test]
fn euclid_span_accents_weave_bypass_and_reanchor() {
    // One section over two beats, with two jathi accent spans (one per
    // beat). Notes at ticks 0 and 960 start the spans.
    let spans = vec![
        PulseSpan {
            id: 1,
            kind: PulseSpanKind::Section { index: 0 },
            start: Rational::new(0, 1),
            duration: Rational::new(2, 1),
            start_matra: 0,
            matra_len: 8,
            tags: vec![],
        },
        PulseSpan {
            id: 2,
            kind: PulseSpanKind::JathiPulse {
                section_index: 1,
                jathi: 4,
                index: 1,
            },
            start: Rational::new(0, 1),
            duration: Rational::new(1, 1),
            start_matra: 0,
            matra_len: 4,
            tags: vec![],
        },
        PulseSpan {
            id: 3,
            kind: PulseSpanKind::JathiPulse {
                section_index: 1,
                jathi: 4,
                index: 2,
            },
            start: Rational::new(1, 1),
            duration: Rational::new(1, 1),
            start_matra: 4,
            matra_len: 4,
            tags: vec![],
        },
    ];
    let jathi_queue = || {
        VecDeque::from([
            QueuedEvent::note_on(0, 0, 60, 96),
            QueuedEvent::note_off(120, 0, 60),
            QueuedEvent::note_on(240, 0, 61, 96),
            QueuedEvent::note_off(360, 0, 61),
            QueuedEvent::note_on(960, 0, 62, 96),
            QueuedEvent::note_off(1080, 0, 62),
            QueuedEvent::note_on(1200, 0, 63, 96),
            QueuedEvent::note_off(1320, 0, 63),
        ])
    };
    let base_spec = || {
        euclid_hocket_spec(
            cseq_rhythm::EuclidPlacement::Partition,
            4,
            vec![(2, 1), (3, 1)], // table [2, 3, 1, 1]
        )
    };

    // Woven (default): span accents are ordinary steps.
    let mut queue = jathi_queue();
    let mut spec = base_spec();
    apply_channel_hocket_to_queue(&mut queue, 0, 1920, &spans, &mut spec, 0, None, 2, None)
        .expect("euclid hocket");
    assert_eq!(note_on_channels(&queue), vec![2, 3, 1, 1]);

    // Bypass: span-start accents pin to the anchor and consume no step,
    // so the interior weave compacts across them (sigma = j - accents).
    let mut queue = jathi_queue();
    let mut spec = base_spec();
    {
        let euclid = spec.euclid.as_mut().unwrap();
        euclid.span_accent_mode = cseq_rhythm::EuclidSpanAccentMode::Bypass;
        euclid.span_accent_channel = Some(3);
    }
    let (events, _seed) =
        apply_channel_hocket_to_queue(&mut queue, 0, 1920, &spans, &mut spec, 0, None, 2, None)
            .expect("euclid hocket");
    assert_eq!(note_on_channels(&queue), vec![3, 2, 3, 3]);
    assert_eq!(
        events
            .iter()
            .map(|event| (event.start_tick, event.channel, event.source))
            .collect::<Vec<_>>(),
        vec![
            (0, 3, RhythmChoiceSource::Accent),
            (240, 2, RhythmChoiceSource::Transition),
            (960, 3, RhythmChoiceSource::Accent),
            (1200, 3, RhythmChoiceSource::Transition),
        ]
    );

    // Woven + AccentSpan scope: every span replays the pattern head, so
    // span accents deterministically sound table[0].
    let mut queue = jathi_queue();
    let mut spec = base_spec();
    spec.euclid.as_mut().unwrap().reset = cseq_rhythm::EuclidResetScope::AccentSpan;
    apply_channel_hocket_to_queue(&mut queue, 0, 1920, &spans, &mut spec, 0, None, 2, None)
        .expect("euclid hocket");
    assert_eq!(note_on_channels(&queue), vec![2, 3, 2, 3]);
}

#[test]
fn euclid_repair_clamps_layers_and_preserves_the_palette_rule() {
    let mut spec = euclid_hocket_spec(
        cseq_rhythm::EuclidPlacement::Partition,
        4,
        vec![(2, 3), (3, 2), (9, 1), (2, 1)],
    );
    {
        let euclid = spec.euclid.as_mut().unwrap();
        euclid.layers[1].max_run = 0;
        euclid.span_accent_channel = Some(14);
    }
    let mut warnings = Vec::new();
    repair_channel_hocket_spec(&mut spec, &mut warnings);
    let euclid = spec.euclid.as_ref().unwrap();
    // Out-of-palette channel 9 and the duplicate channel-2 layer drop;
    // partition pulses clamp into the shared steps budget.
    assert_eq!(
        euclid
            .layers
            .iter()
            .map(|layer| (layer.channel, layer.pulses, layer.max_run))
            .collect::<Vec<_>>(),
        vec![(2, 3, 1), (3, 1, 1)]
    );
    assert_eq!(euclid.span_accent_channel, None);
    assert!(!warnings.is_empty());
    assert!(cseq_rhythm::validate_channel_hocket_spec(&spec).is_ok());
}

#[test]
fn euclid_per_group_automation_repairs_partition_budget() {
    let spec = euclid_hocket_spec(
        cseq_rhythm::EuclidPlacement::Partition,
        8,
        vec![(2, 4), (3, 4)],
    );
    let automation = automation_set_with_values(&[("channelHocket.euclid.steps", 4.0)]);
    let effective = channel_hocket_spec_for_group(&spec, Some(&automation), 0, 1, 0, 960, 0);
    let euclid = effective.euclid.as_ref().unwrap();

    assert_eq!(euclid.steps, 4);
    assert_eq!(
        euclid
            .layers
            .iter()
            .map(|layer| layer.pulses)
            .collect::<Vec<_>>(),
        vec![4, 0]
    );
    assert!(cseq_rhythm::validate_channel_hocket_spec(effective.as_ref()).is_ok());
}

#[test]
fn static_midi_output_channel_applies_when_hocket_is_off() {
    let mut score = beat_pulse_score("static-midi-channel", 4);
    let mut rhythm = RhythmPlaybackConfig {
        generator_enabled: false,
        generator: cseq_rhythm::GeneratorConfig::default(),
        midi_output_channel: 7,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    };
    let mut queue = VecDeque::new();

    let events = realize_and_enqueue(&mut score, 0, 0, &mut queue, 120.0, Some(&mut rhythm), None)
        .expect("realize queue");

    assert!(events.channel_hocket.is_empty());
    assert_eq!(note_on_channels(&queue), vec![7, 7, 7, 7]);
}

#[test]
fn synth_program_assignments_are_user_channel_based() {
    let programs = normalized_synth_programs(&[
        SynthChannelProgram {
            channel: 2,
            mode: SynthChannelMode::Melodic,
            program: 12,
            drum_note: 38,
        },
        SynthChannelProgram {
            channel: 99,
            mode: SynthChannelMode::Percussion,
            program: 200,
            drum_note: 200,
        },
        SynthChannelProgram {
            channel: 0,
            mode: SynthChannelMode::Melodic,
            program: 7,
            drum_note: 36,
        },
    ]);

    assert_eq!(programs[0].mode, SynthChannelMode::Melodic);
    assert_eq!(programs[0].program, 7);
    assert_eq!(programs[1].program, 12);
    assert_eq!(programs[15].mode, SynthChannelMode::Percussion);
    assert_eq!(programs[15].program, 127);
    assert_eq!(programs[15].drum_note, 127);
}

#[test]
fn synth_percussion_voice_maps_only_local_monitor_note() {
    let voices = normalized_synth_programs(&[SynthChannelProgram {
        channel: 3,
        mode: SynthChannelMode::Percussion,
        program: 0,
        drum_note: 38,
    }]);

    let note_on = synth_monitor_event(&[0x92, 60, 96], Some(3), &voices).expect("note on");
    assert_eq!(note_on.bus_channel, 3);
    assert_eq!(&note_on.bytes[..note_on.len], &[0x99, 38, 96]);

    let note_off = synth_monitor_event(&[0x82, 60, 0], Some(3), &voices).expect("note off");
    assert_eq!(note_off.bus_channel, 3);
    assert_eq!(&note_off.bytes[..note_off.len], &[0x89, 38, 0]);

    let melodic = synth_monitor_event(&[0x90, 64, 96], Some(1), &voices).expect("melodic");
    assert_eq!(melodic.bus_channel, 1);
    assert_eq!(&melodic.bytes[..melodic.len], &[0x90, 64, 96]);
}

#[test]
fn synth_monitor_routes_user_channel_ten_melodic_to_own_bus() {
    let voices = normalized_synth_programs(&[SynthChannelProgram {
        channel: 10,
        mode: SynthChannelMode::Melodic,
        program: 80,
        drum_note: 36,
    }]);

    let note_on = synth_monitor_event(&[0x99, 64, 96], Some(10), &voices).expect("note on");
    assert_eq!(note_on.bus_channel, 10);
    assert_eq!(&note_on.bytes[..note_on.len], &[0x90, 64, 96]);

    let control_change = synth_monitor_event(&[0xB9, 123, 0], Some(10), &voices).expect("cc");
    assert_eq!(control_change.bus_channel, 10);
    assert_eq!(&control_change.bytes[..control_change.len], &[0xB0, 123, 0]);
}

#[test]
fn synth_monitor_keeps_user_channel_ten_percussion_on_gm_drum_bus() {
    let voices = normalized_synth_programs(&[SynthChannelProgram {
        channel: 10,
        mode: SynthChannelMode::Percussion,
        program: 0,
        drum_note: 42,
    }]);

    let note_on = synth_monitor_event(&[0x99, 64, 96], Some(10), &voices).expect("note on");
    assert_eq!(note_on.bus_channel, 10);
    assert_eq!(&note_on.bytes[..note_on.len], &[0x99, 42, 96]);
}

#[test]
fn synth_monitor_gives_each_user_channel_an_isolated_bus() {
    let voices = normalized_synth_programs(&[
        SynthChannelProgram {
            channel: 2,
            mode: SynthChannelMode::Melodic,
            program: 12,
            drum_note: 36,
        },
        SynthChannelProgram {
            channel: 3,
            mode: SynthChannelMode::Percussion,
            program: 0,
            drum_note: 38,
        },
    ]);

    let channel_two = synth_monitor_event(&[0x91, 60, 96], Some(2), &voices).expect("channel 2");
    let channel_three = synth_monitor_event(&[0x92, 60, 96], Some(3), &voices).expect("channel 3");

    assert_eq!(channel_two.bus_channel, 2);
    assert_eq!(&channel_two.bytes[..channel_two.len], &[0x90, 60, 96]);
    assert_eq!(channel_three.bus_channel, 3);
    assert_eq!(&channel_three.bytes[..channel_three.len], &[0x99, 38, 96]);
}

#[test]
fn queued_user_channel_identity_drives_monitor_and_debug() {
    let voices = normalized_synth_programs(&[SynthChannelProgram {
        channel: 3,
        mode: SynthChannelMode::Percussion,
        program: 0,
        drum_note: 38,
    }]);
    let mut event = QueuedEvent::note_on(0, 0, 60, 96);
    event.user_channel = Some(3);

    let monitor_event =
        synth_monitor_event_for_queued_event(&event, &voices).expect("monitor route");
    assert_eq!(monitor_event.user_channel, 3);
    assert_eq!(monitor_event.voice.mode, SynthChannelMode::Percussion);
    assert_eq!(&monitor_event.bytes[..monitor_event.len], &[0x99, 38, 96]);

    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 80.0,
        is_playing: false,
        current_tick: 0,
        current_cycle: 0,
        ticks_per_cycle: 960,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));
    record_queued_midi_debug_event(&shared, &event, 960, Some(&monitor_event));

    let debug_event = shared
        .lock()
        .layers
        .midi_debug
        .back()
        .cloned()
        .expect("debug event");
    assert_eq!(debug_event.channel, Some(3));
    assert_eq!(debug_event.monitor_bus.as_deref(), Some("userChannel3"));
    assert_eq!(debug_event.monitor_user_channel, Some(3));
    assert_eq!(debug_event.monitor_mode.as_deref(), Some("percussion"));
    assert_eq!(debug_event.monitor_drum_note, Some(38));
    assert_eq!(debug_event.debug_source.as_deref(), Some("queued dispatch"));
    assert_eq!(
        debug_event.monitor_bytes.as_deref(),
        Some(&[0x99, 38, 96][..])
    );
}

#[test]
fn midi_debug_event_records_transport_cleanup_source() {
    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 80.0,
        is_playing: false,
        current_tick: 0,
        current_cycle: 0,
        ticks_per_cycle: 960,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));

    record_midi_debug_event(&shared, 960, 960, &[0xB0, 123, 0], Some("transport stop"));

    let debug_event = shared
        .lock()
        .layers
        .midi_debug
        .back()
        .cloned()
        .expect("debug event");
    assert_eq!(debug_event.cycle, 1);
    assert_eq!(debug_event.channel, Some(1));
    assert_eq!(debug_event.message_type, "controlChange");
    assert_eq!(debug_event.debug_source.as_deref(), Some("transport stop"));
}

#[test]
fn midi_debug_event_records_parallel_track_and_conflict_fields() {
    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 80.0,
        is_playing: false,
        current_tick: 0,
        current_cycle: 0,
        ticks_per_cycle: 960,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));
    let mut event = QueuedEvent::note_on(0, 0, 60, 96).with_parallel_track(1, "beta", "Beta");
    event.parallel_conflict = Some(ParallelConflictMetadata {
        policy: "priorityOrder".to_string(),
        action: "priority-winner".to_string(),
        group_id: "0:1".to_string(),
    });

    record_queued_midi_debug_event(&shared, &event, 960, None);

    let debug_event = shared
        .lock()
        .layers
        .midi_debug
        .back()
        .cloned()
        .expect("debug event");
    assert_eq!(debug_event.parallel_track_id.as_deref(), Some("beta"));
    assert_eq!(debug_event.parallel_track_name.as_deref(), Some("Beta"));
    assert_eq!(
        debug_event.parallel_conflict_policy.as_deref(),
        Some("priorityOrder")
    );
    assert_eq!(
        debug_event.parallel_conflict_action.as_deref(),
        Some("priority-winner")
    );
    assert_eq!(
        debug_event.parallel_conflict_group_id.as_deref(),
        Some("0:1")
    );
}

#[test]
fn automation_playback_event_records_current_beat_states() {
    let automation = cseq_model::AutomationSet {
        length_cycles: 1,
        markers: Vec::new(),
        tracks: vec![cseq_model::AutomationTrack {
            id: "pitch".to_string(),
            target: AUTOMATION_TARGET_PITCH.to_string(),
            enabled: true,
            combine: cseq_model::AutomationCombineMode::Replace,
            graph_range: None,
            curves: vec![cseq_model::AutomationCurve {
                id: "pitch-curve".to_string(),
                enabled: true,
                interpolation: cseq_model::AutomationInterpolation::Linear,
                points: vec![
                    cseq_model::AutomationPoint {
                        id: Some("start".to_string()),
                        time: AutomationTime::zero(),
                        value: cseq_model::AutomationValue::Number { value: 60.0 },
                        anchor_id: None,
                        out_curve: None,
                    },
                    cseq_model::AutomationPoint {
                        id: Some("end".to_string()),
                        time: AutomationTime::one(),
                        value: cseq_model::AutomationValue::Number { value: 72.0 },
                        anchor_id: None,
                        out_curve: None,
                    },
                ],
            }],
        }],
    };
    let score = Score::subdivision_switch(
        "automation playback log",
        cseq_model::SubdivisionSwitchSpec {
            cycle_beats: 4,
            initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                subdivision: 4,
                weight: 1.0,
            }],
            initial_jathi_weights: vec![],
            initial_custom_subdivision: None,
            automation: Some(automation),
            inflections: vec![],
            switch_count_weights: vec![],
            seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
            accent: cseq_model::GatiAccentSpec::default(),
            pitch: 60,
            velocity: 96,
        },
    );
    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 80.0,
        is_playing: false,
        current_tick: 0,
        current_cycle: 0,
        ticks_per_cycle: 3840,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));

    let key = current_automation_log_key(&score, None, 0, 960, 3840).expect("log key");
    assert_eq!(key, (0, 1));
    assert!(record_current_automation_state(
        &shared, &score, None, key.0, key.1, 960
    ));

    let event = shared
        .lock()
        .layers
        .automation
        .back()
        .cloned()
        .expect("automation event");
    assert_eq!(event.sequence, 0);
    assert_eq!(event.cycle, 0);
    assert_eq!(event.beat_index, 1);
    assert_eq!(event.tick_in_cycle, 960);
    assert_eq!(event.automation_phase, AutomationTime::new(1, 4).unwrap());
    assert_eq!(event.values.len(), 1);
    assert_eq!(event.values[0].target, AUTOMATION_TARGET_PITCH);
    assert_eq!(event.values[0].value, 63.0);
}

#[test]
fn transport_tempo_automation_samples_runtime_bpm() {
    let score = subdivision_switch_score("tempo-automation", 4, 4);
    let config = playback_config_with_automation(automation_set_with_values(&[(
        AUTOMATION_TARGET_TEMPO_BPM,
        123.0,
    )]));

    assert_eq!(
        transport_tempo_bpm_for_tick(&score, Some(&config), 0, PPQN as u64, 3840, 80.0),
        123.0
    );
    assert_eq!(
        transport_tempo_bpm_for_cycle_start(&score, None, 0, 96.0),
        96.0
    );
}

#[test]
fn hocket_timeline_channel_identity_drives_monitor_voice() {
    let mut queue = four_matra_queue();
    let voices = normalized_synth_programs(&[SynthChannelProgram {
        channel: 2,
        mode: SynthChannelMode::Percussion,
        program: 0,
        drum_note: 38,
    }]);
    let mut spec = channel_hocket_spec();

    let (channel_events, _seed) =
        apply_channel_hocket_to_queue(&mut queue, 0, 960, &[], &mut spec, 0, None, 1, None)
            .expect("hocket");
    let second_timeline_event = channel_events
        .iter()
        .find(|event| event.start_tick == 240)
        .expect("second channel marker");
    let second_note_on = queue
        .iter()
        .find(|event| is_note_on_event(event) && event.absolute_tick == 240)
        .expect("second note on");
    let monitor_event =
        synth_monitor_event_for_queued_event(second_note_on, &voices).expect("monitor route");

    assert_eq!(second_timeline_event.channel, 2);
    assert_eq!(
        second_note_on.user_channel,
        Some(second_timeline_event.channel)
    );
    assert!(second_note_on.user_channel_matches_wire());
    assert_eq!(monitor_event.user_channel, second_timeline_event.channel);
    assert_eq!(monitor_event.bus_channel, second_timeline_event.channel);
    assert_eq!(monitor_event.voice.mode, SynthChannelMode::Percussion);
    assert_eq!(&monitor_event.bytes[..monitor_event.len], &[0x99, 38, 96]);
}

#[test]
fn ticks_per_cycle_for_unit_score() {
    let score = cseq_model::Score::single_pulse("test", 60, 100);
    // cycle_length = 1 akshara, PPQN = 960, so tpc = 960
    assert_eq!(ticks_per_cycle(&score), 960);
}

#[test]
fn transport_score_validation_rejects_zero_cycle_length() {
    let mut score = cseq_model::Score::single_pulse("bad-cycle", 60, 100);
    score.cycle_length = Rational::new(0, 1);

    let err = validate_score_for_transport(&score)
        .expect_err("zero cycle length must not enter transport");
    assert!(err.contains("cycle length must produce at least one transport tick"));
}

#[test]
fn absolute_tick_saturates_instead_of_wrapping() {
    assert_eq!(absolute_tick(u64::MAX, 960, 959), u64::MAX);
    assert_eq!(absolute_tick(2, 960, 5), 1925);
}

#[test]
fn offset_to_ticks_basic() {
    // 1/4 of a beat = 240 ticks
    assert_eq!(offset_to_ticks(&Rational::new(1, 4)), 240);
    // 1/3 of a beat = 320 ticks
    assert_eq!(offset_to_ticks(&Rational::new(1, 3)), 320);
    // 0 = 0 ticks
    assert_eq!(offset_to_ticks(&Rational::new(0, 1)), 0);
    // 1 beat = 960 ticks
    assert_eq!(offset_to_ticks(&Rational::new(1, 1)), 960);
}

#[test]
fn offset_to_ticks_rounds_with_integer_math() {
    assert_eq!(offset_to_ticks(&Rational::new(1, 7)), 137);
    assert_eq!(offset_to_ticks(&Rational::new(6, 7)), 823);
    assert_eq!(offset_to_ticks(&Rational::new(-1, 4)), 0);
}

#[test]
fn note_leaf_for_offset_uses_current_source_leaf() {
    let leaves = vec![
        NoteLeaf {
            node_id: 1,
            offset: Rational::new(0, 1),
            pitch: 60,
            velocity: 80,
        },
        NoteLeaf {
            node_id: 2,
            offset: Rational::new(1, 3),
            pitch: 62,
            velocity: 90,
        },
        NoteLeaf {
            node_id: 3,
            offset: Rational::new(2, 3),
            pitch: 64,
            velocity: 100,
        },
    ];

    let leaf = note_leaf_for_offset(&leaves, Rational::new(1, 2)).unwrap();

    assert_eq!(leaf.node_id, 2);
    assert_eq!(leaf.pitch, 62);
    assert_eq!(leaf.velocity, 90);
}

#[test]
fn ticks_per_cycle_rounds_fractional_cycles_without_truncation() {
    let mut score = cseq_model::Score::single_pulse("fractional", 60, 100);
    score.cycle_length = Rational::new(1, 7);
    assert_eq!(ticks_per_cycle(&score), 137);
}

#[test]
fn nanos_per_tick_at_60_bpm() {
    // At 60 BPM: 1 beat = 1 second = 1e9 nanos
    // 1 tick = 1e9 / 960 ≈ 1041666.67 nanos
    let npt = nanos_per_tick(60.0);
    let expected = 1e9 / 960.0;
    assert!((npt - expected).abs() < 0.01);
}

#[test]
fn nanos_per_tick_at_120_bpm() {
    let npt = nanos_per_tick(120.0);
    let expected = 0.5e9 / 960.0;
    assert!((npt - expected).abs() < 0.01);
}

#[test]
fn immediate_dispatch_takes_due_events_without_early_lookahead() {
    let mut queue = VecDeque::from(vec![
        QueuedEvent::note_on(900, 0, 60, 100),
        QueuedEvent::note_on(1000, 0, 62, 100),
        QueuedEvent::note_on(1001, 0, 64, 100),
    ]);

    let due = take_due_events_for_immediate_dispatch(&mut queue, 1000);

    assert_eq!(
        due.iter()
            .map(|event| event.absolute_tick)
            .collect::<Vec<_>>(),
        vec![900, 1000]
    );
    assert_eq!(
        queue
            .iter()
            .map(|event| event.absolute_tick)
            .collect::<Vec<_>>(),
        vec![1001]
    );
}

#[test]
fn realize_and_enqueue_single_pulse() {
    let mut score = cseq_model::Score::single_pulse("test", 60, 100);
    let mut queue = VecDeque::new();
    realize_and_enqueue(&mut score, 0, 0, &mut queue, 120.0, None, None).unwrap();

    // Single pulse: NoteOn at tick 0, NoteOff at tick 960
    assert_eq!(queue.len(), 2);
    assert_eq!(queue[0].absolute_tick, 0);
    assert_eq!(queue[0].bytes[0] & 0xF0, 0x90); // NoteOn
    assert_eq!(queue[1].absolute_tick, 960);
    assert_eq!(queue[1].bytes[0] & 0xF0, 0x80); // NoteOff
}

#[test]
fn realize_and_enqueue_with_cycle_offset() {
    let mut score = cseq_model::Score::single_pulse("test", 60, 100);
    let tpc = ticks_per_cycle(&score); // 960
    let mut queue = VecDeque::new();
    realize_and_enqueue(&mut score, 1, tpc, &mut queue, 120.0, None, None).unwrap();

    // Events offset by one cycle.
    assert_eq!(queue[0].absolute_tick, 960);
    assert_eq!(queue[1].absolute_tick, 1920);
}

#[test]
fn realize_subdivided_chatusra() {
    let mut score = cseq_model::Score::subdivided(
        "chatusra",
        &[60, 62, 64, 65],
        100,
        cseq_model::SubdivisionPolicy::Equal,
    );
    let tpc = ticks_per_cycle(&score);
    assert_eq!(tpc, 960);

    let mut queue = VecDeque::new();
    realize_and_enqueue(&mut score, 0, 0, &mut queue, 120.0, None, None).unwrap();

    // 4 notes: each has NoteOn + NoteOff = 8 events.
    assert_eq!(queue.len(), 8);

    // NoteOns at 0, 240, 480, 720
    let note_ons: Vec<_> = queue.iter().filter(|e| e.bytes[0] & 0xF0 == 0x90).collect();
    assert_eq!(note_ons.len(), 4);
    assert_eq!(note_ons[0].absolute_tick, 0);
    assert_eq!(note_ons[1].absolute_tick, 240);
    assert_eq!(note_ons[2].absolute_tick, 480);
    assert_eq!(note_ons[3].absolute_tick, 720);

    // Pitches
    assert_eq!(note_ons[0].bytes[1], 60);
    assert_eq!(note_ons[1].bytes[1], 62);
    assert_eq!(note_ons[2].bytes[1], 64);
    assert_eq!(note_ons[3].bytes[1], 65);
}

#[test]
fn realize_subdivision_switch_gati_seven_as_midi_events() {
    let mut score = cseq_model::Score::subdivision_switch(
        "gati-seven",
        cseq_model::SubdivisionSwitchSpec {
            cycle_beats: 1,
            initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                subdivision: 7,
                weight: 1.0,
            }],
            initial_jathi_weights: vec![],
            initial_custom_subdivision: None,
            automation: None,
            inflections: vec![],
            switch_count_weights: vec![],
            seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
            accent: cseq_model::GatiAccentSpec::default(),
            pitch: 60,
            velocity: 96,
        },
    );

    let mut queue = VecDeque::new();
    realize_and_enqueue(&mut score, 0, 0, &mut queue, 120.0, None, None).unwrap();

    let note_ons: Vec<_> = queue.iter().filter(|e| e.bytes[0] & 0xF0 == 0x90).collect();
    assert_eq!(note_ons.len(), 7);
    assert_eq!(
        note_ons.iter().map(|e| e.absolute_tick).collect::<Vec<_>>(),
        vec![0, 137, 274, 411, 549, 686, 823]
    );
}

#[test]
fn realizing_future_cycles_does_not_rehocket_already_queued_events() {
    let mut score = subdivision_switch_score("cycle-local-hocket", 1, 4);
    let tpc = ticks_per_cycle(&score);
    let mut rhythm = generator_playback_config();
    rhythm.channel_hocket_enabled = true;
    rhythm.channel_hocket = Some(channel_hocket_spec());
    let mut queue = VecDeque::new();

    let cycle0_events =
        realize_and_enqueue(&mut score, 0, 0, &mut queue, 120.0, Some(&mut rhythm), None)
            .expect("realize cycle 0");
    let cycle0_channels = note_on_channels_in_tick_range(&queue, 0, tpc);
    let cycle0_timeline = cycle0_events
        .channel_hocket
        .iter()
        .map(|event| (event.start_tick, event.end_tick, event.channel))
        .collect::<Vec<_>>();

    let cycle1_events = realize_and_enqueue(
        &mut score,
        1,
        tpc,
        &mut queue,
        120.0,
        Some(&mut rhythm),
        None,
    )
    .expect("realize cycle 1");

    assert_eq!(cycle0_events.channel_hocket.len(), 4);
    assert_eq!(cycle1_events.channel_hocket.len(), 4);
    assert_eq!(
        note_on_channels_in_tick_range(&queue, 0, tpc),
        cycle0_channels
    );
    assert_eq!(
        rendered_note_groups(&queue, 0)
            .into_iter()
            .filter(|(_start, end, _channel)| *end <= tpc)
            .collect::<Vec<_>>(),
        cycle0_timeline
    );
    assert!(cycle1_events
        .channel_hocket
        .iter()
        .all(|event| event.cycle == 1 && event.start_tick < tpc && event.end_tick <= tpc));
}

fn post_score_ramp_automation(target: &str, end_value: f64) -> AutomationSet {
    AutomationSet {
        length_cycles: 1,
        markers: vec![],
        tracks: vec![cseq_model::AutomationTrack {
            id: format!("{target}-track"),
            target: target.to_string(),
            enabled: true,
            combine: cseq_model::AutomationCombineMode::Replace,
            graph_range: None,
            curves: vec![cseq_model::AutomationCurve {
                id: format!("{target}-curve"),
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
                        value: cseq_model::AutomationValue::Number { value: end_value },
                        anchor_id: None,
                        out_curve: None,
                    },
                ],
            }],
        }],
    }
}

fn late_two_note_queue() -> VecDeque<QueuedEvent> {
    VecDeque::from([
        QueuedEvent::note_on(0, 0, 60, 96),
        QueuedEvent::note_off(120, 0, 60),
        QueuedEvent::note_on(959, 0, 62, 96),
        QueuedEvent::note_off(960, 0, 62),
    ])
}

#[test]
fn channel_hocket_automation_changes_within_cycle() {
    let target = "channelHocket.accentRule.0.channel.3.weight";
    let automation = post_score_ramp_automation(target, 999.0);
    let mut queue = late_two_note_queue();
    let mut spec = channel_hocket_spec();
    spec.accent_rules = vec![cseq_rhythm::ChannelAccentRule {
        min_velocity: 0,
        max_velocity: 127,
        probability: 1.0,
        mode: cseq_rhythm::ChannelAccentRoutingMode::RenderOnly,
        weights: vec![cseq_rhythm::ChannelAccentWeight {
            channel: 3,
            weight: 0,
        }],
    }];

    let (events, _seed) = apply_channel_hocket_to_queue(
        &mut queue,
        0,
        960,
        &[],
        &mut spec,
        0,
        Some(&automation),
        1,
        None,
    )
    .expect("channel hocket");

    let late_phase = automation_time_for_cycle_tick(0, 959, 960, automation.length_cycles);
    let late_sample = automation
        .sample_raw_number_at_phase(target, late_phase)
        .expect("late channel sample");
    assert!(
        late_sample > 990.0,
        "late channel group should sample near the end of the ramp, got {late_sample}"
    );
    assert_eq!(events[0].channel, 1);
    assert_eq!(
        events[1].channel, 3,
        "late channel group should route through the now-weighted accent rule"
    );
    assert_eq!(note_on_channels(&queue), vec![1, 3]);
}

#[test]
fn channel_position_rule_automation_changes_within_cycle() {
    let target = "channelHocket.positionRule.pos.render.channel.3.weight";
    let automation = post_score_ramp_automation(target, 999.0);
    let mut queue = late_two_note_queue();
    let mut spec = channel_hocket_spec();
    spec.position_rules = vec![cseq_rhythm::ChannelPositionRule {
        id: "pos".to_string(),
        label: "Position".to_string(),
        enabled: true,
        scope: cseq_rhythm::ChannelPositionScope::Beat,
        nth: 2,
        action_weights: cseq_rhythm::ChannelPositionActionWeights {
            normal_markov: 0,
            render_only: 1,
            reset_markov: 0,
        },
        render_weights: vec![cseq_rhythm::ChannelAccentWeight {
            channel: 3,
            weight: 0,
        }],
        reset: cseq_rhythm::ChannelPositionResetSpec::default(),
    }];

    let (events, _seed) = apply_channel_hocket_to_queue(
        &mut queue,
        0,
        960,
        &[],
        &mut spec,
        0,
        Some(&automation),
        1,
        None,
    )
    .expect("channel hocket");

    let late_phase = automation_time_for_cycle_tick(0, 959, 960, automation.length_cycles);
    let late_sample = automation
        .sample_raw_number_at_phase(target, late_phase)
        .expect("late position sample");
    assert!(
        late_sample > 990.0,
        "late position group should sample near the end of the ramp, got {late_sample}"
    );
    assert_eq!(events[0].channel, 1);
    assert_eq!(events[1].channel, 3);
    assert_eq!(events[1].source, RhythmChoiceSource::Position);
    assert_eq!(
        events[1].position_action,
        Some(cseq_rhythm::ChannelPositionAction::RenderOnly)
    );
    assert_eq!(note_on_channels(&queue), vec![1, 3]);
}
