#![no_main]

//! Multi-track analogue of `transport_queue`: builds a full
//! `ParallelPlaybackConfig` (continuous generated tracks, a triggered
//! follower, a Track Flow box with an authored chain, channel-logic policy +
//! matrix + priority) from binary fuzzer input, realizes it through the
//! parallel/rayon path, and checks structural queue invariants, determinism
//! (same config twice), and the S2 reapply contract. Uses the purpose-built
//! `fuzz_realize_parallel_cycles*` hooks that sat unwired until Phase 2.2 of
//! docs/TEST_COVERAGE_PLAN_2026-07.md.

use std::collections::HashMap;

use arbitrary::Unstructured;
use cseq_model as model;
use cseq_transport::{
    fuzz_realize_parallel_cycles, fuzz_realize_parallel_cycles_reapplied, trackflow,
    ChannelConflictPolicy, ChannelLogicMatrixEntry, ParallelPlaybackConfig,
    ParallelPlaybackTrackConfig, RhythmPlaybackConfig, TrackFlowBoxConfig,
    TransportFuzzQueuedEvent, PPQN,
};
use libfuzzer_sys::fuzz_target;

mod common;

const MAX_INPUT_BYTES: usize = 8192;
const MAX_QUEUE_EVENTS: usize = 40_000;
const MAX_CYCLES: u64 = 3;

const POLICIES: [ChannelConflictPolicy; 18] = [
    ChannelConflictPolicy::AllowAll,
    ChannelConflictPolicy::ForceOn,
    ChannelConflictPolicy::ForceOff,
    ChannelConflictPolicy::Or,
    ChannelConflictPolicy::RandomOne,
    ChannelConflictPolicy::Alternate,
    ChannelConflictPolicy::PriorityOrder,
    ChannelConflictPolicy::Xor,
    ChannelConflictPolicy::Xnor,
    ChannelConflictPolicy::And,
    ChannelConflictPolicy::Nand,
    ChannelConflictPolicy::Nor,
    ChannelConflictPolicy::Even,
    ChannelConflictPolicy::Odd,
    ChannelConflictPolicy::OneHigh,
    ChannelConflictPolicy::OneLow,
    ChannelConflictPolicy::Majority,
    ChannelConflictPolicy::Minority,
];

fuzz_target!(|data: &[u8]| {
    if data.len() > MAX_INPUT_BYTES {
        return;
    }
    let mut u = Unstructured::new(data);
    let config = parallel_config(&mut u);
    let cycles = common::small_u64(&mut u, 1, MAX_CYCLES);
    run(config, cycles);
});

fn run(config: ParallelPlaybackConfig, cycles: u64) {
    let Ok(first) = fuzz_realize_parallel_cycles(config.clone(), cycles) else {
        return;
    };
    if first.len() > MAX_QUEUE_EVENTS {
        return;
    }
    assert_queue(&first, cycles);

    let Ok(second) = fuzz_realize_parallel_cycles(config.clone(), cycles) else {
        panic!("parallel realize succeeded once then failed on the same config");
    };
    assert_eq!(first, second, "parallel realization is non-deterministic");

    let Ok(reapplied) = fuzz_realize_parallel_cycles_reapplied(config, cycles) else {
        panic!("reapply path failed where the fresh path succeeded");
    };
    assert_eq!(
        first, reapplied,
        "reapply (reset + replay-from-zero) diverged from a fresh realization"
    );
}

fn parallel_config(u: &mut Unstructured<'_>) -> ParallelPlaybackConfig {
    let n_tracks = common::small_usize(u, 1, 3);
    let use_trigger = common::boolish(u);
    let n_tracks = if use_trigger {
        n_tracks.max(2)
    } else {
        n_tracks
    };
    let mut tracks: Vec<_> = (0..n_tracks)
        .map(|i| parallel_track(u, &format!("t{i}"), 60 + i as u8))
        .collect();
    if use_trigger {
        tracks[1].trigger = Some(trigger_config(u, "t0"));
    }
    let track_flow_boxes = if common::boolish(u) {
        let sources = vec![parallel_track(u, "s0", 72), parallel_track(u, "s1", 76)];
        vec![TrackFlowBoxConfig {
            id: "b0".to_string(),
            name: "Box".to_string(),
            sources,
            spec: common::boolish(u).then(|| box_chain(u, 2)),
            seed: common::small_u64(u, 0, u64::MAX),
        }]
    } else {
        vec![]
    };
    let policy = POLICIES[common::index(u, POLICIES.len())];
    let channel_logic_matrix = if n_tracks >= 2 && common::boolish(u) {
        (0..common::small_usize(u, 1, 3))
            .map(|_| ChannelLogicMatrixEntry {
                track_a_id: "t0".to_string(),
                track_b_id: "t1".to_string(),
                output_channel: common::boolish(u).then(|| common::midi(u, 1, 16)),
                policy: POLICIES[common::index(u, POLICIES.len())],
            })
            .collect()
    } else {
        vec![]
    };
    let conflict_priority = if common::boolish(u) {
        let mut ids: Vec<String> = tracks.iter().map(|track| track.id.clone()).collect();
        if !track_flow_boxes.is_empty() {
            ids.push("track-flow-b0".to_string());
        }
        ids.reverse();
        ids
    } else {
        vec![]
    };
    ParallelPlaybackConfig {
        tracks,
        reference_tempo_bpm: common::small_u32(u, 40, 240) as f32,
        reference_cycle_beats: common::small_u32(u, 1, 8),
        channel_conflict_policy: policy,
        channel_logic_matrix,
        conflict_priority,
        track_flow_boxes,
    }
}

fn parallel_track(u: &mut Unstructured<'_>, id: &str, pitch: u8) -> ParallelPlaybackTrackConfig {
    ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: id.to_uppercase(),
        score: track_score(u, id, pitch),
        rhythm: common::boolish(u).then(|| track_rhythm(u)),
        tempo_bpm: common::small_u32(u, 40, 240) as f32,
        trigger: None,
        silent: common::index(u, 5) == 0,
    }
}

fn track_score(u: &mut Unstructured<'_>, name: &str, pitch: u8) -> model::Score {
    let cycle_beats = common::small_u32(u, 1, 6);
    model::Score::subdivision_switch(
        name,
        model::SubdivisionSwitchSpec {
            cycle_beats,
            initial_weights: (0..common::small_usize(u, 1, 3))
                .map(|_| model::WeightedSubdivisionChoice {
                    subdivision: common::small_u32(u, 1, 8),
                    weight: 1.0,
                })
                .collect(),
            initial_jathi_weights: vec![],
            initial_custom_subdivision: common::boolish(u).then(|| common::custom_subdivision(u)),
            automation: None,
            inflections: vec![],
            switch_count_weights: vec![],
            seed_mode: model::SwitchSeedMode::Locked {
                seed: common::small_u64(u, 0, u64::MAX),
            },
            accent: model::GatiAccentSpec::default(),
            pitch,
            velocity: common::midi(u, 32, 112),
        },
    )
}

fn directive_family(index: usize) -> cseq_rhythm::DirectiveFamily {
    match index % 10 {
        0 => cseq_rhythm::DirectiveFamily::BarlowRemove,
        1 => cseq_rhythm::DirectiveFamily::BarlowAdd,
        2 => cseq_rhythm::DirectiveFamily::Rotate,
        3 => cseq_rhythm::DirectiveFamily::Syncopate,
        4 => cseq_rhythm::DirectiveFamily::Desyncopate,
        5 => cseq_rhythm::DirectiveFamily::Fragment,
        6 => cseq_rhythm::DirectiveFamily::Consolidate,
        7 => cseq_rhythm::DirectiveFamily::Euclid,
        8 => cseq_rhythm::DirectiveFamily::Stochastic,
        _ => cseq_rhythm::DirectiveFamily::Morph,
    }
}

fn evolution_plan(
    u: &mut Unstructured<'_>,
    subdivision_palette: &[u32],
) -> Vec<cseq_rhythm::EvolutionDirective> {
    let count = common::small_usize(u, 0, 4);
    let family_offset = common::index(u, 10);
    (0..count)
        .map(|index| {
            let first = common::small_u64(u, 1, MAX_CYCLES);
            let second = common::small_u64(u, 1, MAX_CYCLES);
            let family = directive_family(family_offset + index);
            let perceptual = family != cseq_rhythm::DirectiveFamily::Stochastic
                && common::boolish(u);
            let pacing = if family == cseq_rhythm::DirectiveFamily::Stochastic || perceptual {
                cseq_rhythm::DirectivePacing::PerCycle
            } else {
                match common::index(u, 3) {
                    0 => cseq_rhythm::DirectivePacing::PerCycle,
                    1 => cseq_rhythm::DirectivePacing::Linear,
                    _ => cseq_rhythm::DirectivePacing::EaseInOut,
                }
            };
            let scope = common::boolish(u).then(|| {
                let start = common::small_u32(u, 0, 3);
                cseq_rhythm::BeatRange {
                    start_beat: start,
                    len_beats: common::small_u32(u, 1, 4 - start),
                }
            });
            let density_override = if common::boolish(u) {
                let first = common::small_u32(u, 0, 100);
                let second = common::small_u32(u, 0, 100);
                Some((first.min(second), first.max(second)))
            } else {
                None
            };
            let complexity_override = if common::boolish(u) {
                let first = common::small_u32(u, 0, 100_000);
                let second = common::small_u32(u, 0, 100_000);
                Some((first.min(second), first.max(second)))
            } else {
                None
            };
            cseq_rhythm::EvolutionDirective {
                id: index as u64 + 1,
                order: index as u32,
                enabled: common::boolish(u),
                from_cycle: first.min(second),
                to_cycle: first.max(second),
                family,
                pacing,
                magnitude: if perceptual {
                    cseq_rhythm::DirectiveMagnitude::Perceptual {
                        model_version: cseq_rhythm::PerceptualModelVersion::V1,
                        target_milli: common::small_u32(u, 0, 100_000),
                        tolerance_milli: common::small_u32(u, 0, 100_000),
                        max_operations: common::small_u32(u, 1, 32),
                    }
                } else {
                    cseq_rhythm::DirectiveMagnitude::OperationQuota
                },
                intensity: common::small_u32(u, 0, 100),
                scope,
                options: cseq_rhythm::DirectiveOptions {
                    barlow_temperature: common::boolish(u)
                        .then(|| common::small_u32(u, 0, 100)),
                    fill_complexity: common::boolish(u)
                        .then(|| common::small_u32(u, 0, 100)),
                    density_floor: density_override.map(|(floor, _)| floor),
                    density_ceiling: density_override.map(|(_, ceiling)| ceiling),
                    complexity_floor: complexity_override.map(|(floor, _)| floor),
                    complexity_ceiling: complexity_override.map(|(_, ceiling)| ceiling),
                    placement_bias: common::boolish(u)
                        .then(|| common::small_u32(u, 0, 100)),
                    subdivision_level: common::boolish(u)
                        .then(|| subdivision_palette.first().copied())
                        .flatten(),
                    morph_target: (family == cseq_rhythm::DirectiveFamily::Morph)
                        .then(|| "x . x .".to_string()),
                    euclid_max_run: common::boolish(u)
                        .then(|| common::small_u32(u, 1, 8)),
                    euclid_invert: common::boolish(u)
                        .then(|| common::small_u32(u, 0, 100)),
                    euclid_rest_policy: common::boolish(u).then(|| {
                        if common::boolish(u) {
                            cseq_rhythm::EuclidRestPolicy::Tied
                        } else {
                            cseq_rhythm::EuclidRestPolicy::Silent
                        }
                    }),
                    rotate_direction: if common::boolish(u) {
                        cseq_rhythm::RotateDirection::Earlier
                    } else {
                        cseq_rhythm::RotateDirection::Later
                    },
                },
            }
        })
        .collect()
}

/// A bounded per-track generator config that exercises all seed-mode arms.
fn track_rhythm(u: &mut Unstructured<'_>) -> RhythmPlaybackConfig {
    let seed = common::small_u64(u, 0, u64::MAX);
    let seed_mode = match common::index(u, 3) {
        0 => cseq_rhythm::GeneratorSeedMode::Locked { seed },
        1 => cseq_rhythm::GeneratorSeedMode::PerCycle { seed },
        _ => cseq_rhythm::GeneratorSeedMode::History {
            seed,
            history: vec![seed.rotate_left(17)],
            history_weight: common::small_u32(u, 0, 100),
            new_seed_weight: common::small_u32(u, 1, 100),
            max_history: common::small_usize(u, 1, 8),
        },
    };
    // Dum-Ka patterns are drawn from a fixed valid set; against arbitrary
    // fuzzed structures they exercise both clean generation and the
    // structure-mismatch error paths (realize errors are tolerated above).
    const DUMKA_FUZZ_PATTERNS: [&str; 4] = [
        "x . x .",
        "dum . ka .",
        "[x x] . [x x x] .",
        "E(3,8)@4",
    ];
    let generator = if common::boolish(u) {
        cseq_rhythm::GeneratorConfig::Example(cseq_rhythm::ExampleGeneratorParams {
            density_percent: common::small_u32(u, 0, 100),
            seed_mode,
        })
    } else {
        let subdivision_palette = match common::index(u, 6) {
            0 => vec![],
            1 => vec![2],
            2 => vec![3],
            3 => vec![5],
            4 => vec![7],
            _ => vec![2, 3],
        };
        let plan = evolution_plan(u, &subdivision_palette);
        let first_density_limit = common::small_u32(u, 0, 100);
        let second_density_limit = common::small_u32(u, 0, 100);
        let first_complexity_limit = common::small_u32(u, 0, 100_000);
        let second_complexity_limit = common::small_u32(u, 0, 100_000);
        cseq_rhythm::GeneratorConfig::Dumka(cseq_rhythm::DumkaGeneratorParams {
            pattern: DUMKA_FUZZ_PATTERNS[common::index(u, DUMKA_FUZZ_PATTERNS.len())].to_string(),
            subdivision_palette,
            evolution_rate: common::small_u32(u, 0, 100),
            drift_leash: common::small_u32(u, 0, 100),
            barlow_temperature: common::small_u32(u, 0, 100),
            placement_bias: common::small_u32(u, 0, 100),
            weight_barlow_remove: common::small_u32(u, 0, 100),
            weight_barlow_add: common::small_u32(u, 0, 100),
            weight_rotate: common::small_u32(u, 0, 100),
            weight_syncopate: common::small_u32(u, 0, 100),
            weight_desyncopate: common::small_u32(u, 0, 100),
            weight_fragment: common::small_u32(u, 0, 100),
            weight_consolidate: common::small_u32(u, 0, 100),
            fill_complexity: common::small_u32(u, 0, 100),
            density_floor: first_density_limit.min(second_density_limit),
            density_ceiling: first_density_limit.max(second_density_limit),
            complexity_floor: first_complexity_limit.min(second_complexity_limit),
            complexity_ceiling: first_complexity_limit.max(second_complexity_limit),
            weight_euclid: common::small_u32(u, 0, 100),
            euclid_max_run: common::small_u32(u, 1, 8),
            euclid_invert: common::small_u32(u, 0, 100),
            euclid_rest_policy: if common::boolish(u) {
                cseq_rhythm::EuclidRestPolicy::Tied
            } else {
                cseq_rhythm::EuclidRestPolicy::Silent
            },
            plan,
            plan_length_cycles: 0,
            evolution_curve: cseq_rhythm::EvolutionCurve::default(),
            property_curves: Vec::new(),
            seed_mode,
        })
    };
    RhythmPlaybackConfig {
        generator_enabled: common::boolish(u),
        generator,
        midi_output_channel: common::midi(u, 1, 16),
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

fn trigger_config(u: &mut Unstructured<'_>, source: &str) -> cseq_trigger::TriggerConfig {
    cseq_trigger::TriggerConfig {
        source_track_id: source.to_string(),
        when: None,
        condition: Some(cseq_trigger::TriggerCondition::BeatIsSounding {
            beat: common::small_u32(u, 0, 3),
        }),
        launch_alignment: match common::index(u, 3) {
            0 => cseq_trigger::LaunchAlignment::AtEvent,
            1 => cseq_trigger::LaunchAlignment::AtNextReferenceBeat,
            _ => cseq_trigger::LaunchAlignment::AtSourceCycleStart,
        },
        launch_quantize: None,
        lifetime: if common::boolish(u) {
            cseq_trigger::Lifetime::OnePass
        } else {
            cseq_trigger::Lifetime::Repeats {
                passes: common::small_u32(u, 1, 3),
            }
        },
        re_trigger: match common::index(u, 3) {
            0 => cseq_trigger::ReTrigger::Restart,
            1 => cseq_trigger::ReTrigger::Ignore,
            _ => cseq_trigger::ReTrigger::Queue,
        },
        length: cseq_trigger::TriggerLength::ScoreCycle,
        max_repeats: common::small_u32(u, 1, 8),
        gate: None,
        start_select: None,
    }
}

fn box_chain(u: &mut Unstructured<'_>, state_count: u32) -> trackflow::TrackFlowSpec {
    let n = state_count.max(1);
    let mut transitions = Vec::new();
    for from in 0..n {
        for to in 0..n {
            transitions.push(trackflow::TrackFlowTransition {
                from: vec![from],
                to,
                weight: common::maybe_zero_weight(u),
            });
        }
    }
    trackflow::TrackFlowSpec {
        order: cseq_rhythm::MarkovOrder::First,
        state_count: n,
        transitions,
        fallback: common::small_u32(u, 0, n - 1),
        fallback_weights: vec![],
        entry_weights: vec![],
    }
}

fn assert_queue(events: &[TransportFuzzQueuedEvent], cycles: u64) {
    // Bounded overrun: followers may legitimately run their phrase past the
    // realize window; 16 reference beats of slack matches the invariant suite.
    let max_tick = cycles.clamp(1, 16) * 8 * u64::from(PPQN) + 16 * u64::from(PPQN);
    let mut active: HashMap<(u8, u8), u32> = HashMap::new();
    for e in events {
        assert!(
            e.absolute_tick <= max_tick,
            "event past the bounded overrun window"
        );
        assert!((1..=3).contains(&e.bytes.len()));
        let status = e.bytes[0] & 0xF0;
        if matches!(status, 0x80 | 0x90 | 0xB0) {
            assert_eq!(e.bytes.len(), 3);
            assert!(e.bytes[1] <= 127);
            assert!(e.bytes[2] <= 127);
            assert_eq!(e.user_channel, Some((e.bytes[0] & 0x0F) + 1));
        }
        match status {
            0x90 if e.bytes[2] > 0 => {
                *active.entry((e.bytes[0] & 0x0F, e.bytes[1])).or_default() += 1;
            }
            0x80 | 0x90 => {
                let key = (e.bytes[0] & 0x0F, e.bytes[1]);
                let count = active
                    .get_mut(&key)
                    .unwrap_or_else(|| panic!("note off without a matching note on: {e:?}"));
                assert!(*count > 0);
                *count -= 1;
            }
            _ => {}
        }
    }
    // Balance is unconditional since the 2026-07-07 stranded-off fix
    // (defer_premature_same_pitch_note_offs): a suppressed group leaves no
    // events, a surviving group keeps both on and off. A new orphan here is
    // a new engine bug, not a case to carve out.
    assert!(
        active.values().all(|c| *c == 0),
        "unbalanced note on/off in parallel queue: {active:?}"
    );
}
