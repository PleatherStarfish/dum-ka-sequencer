//! Property-based invariants for the retained generator/transport platform.
//!
//! The four families are: deterministic seed replay, disabled-feature byte
//! identity, preview/playback parity, and structural MIDI/parallel invariants.

use std::collections::{HashMap, HashSet};

use cseq_model as model;
use cseq_rhythm as rhythm;
use cseq_transport::{
    fuzz_realize_parallel_cycles, fuzz_realize_parallel_cycles_reapplied,
    fuzz_realize_parallel_cycles_stepped, fuzz_realize_transport_cycles, ChannelConflictPolicy,
    ChannelLogicMatrixEntry, ParallelPlaybackConfig, ParallelPlaybackTrackConfig,
    RhythmPlaybackConfig, SeedPathPlaybackConfig, SeedPathPlaybackEntry, TransportFuzzQueuedEvent,
    PPQN,
};
use proptest::prelude::*;
use proptest::strategy::ValueTree;
use proptest::test_runner::TestRunner;

const CASES: u32 = 96;

fn proptest_cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(CASES)
}

fn generator_seed_mode_strategy() -> impl Strategy<Value = rhythm::GeneratorSeedMode> {
    prop_oneof![
        any::<u64>().prop_map(|seed| rhythm::GeneratorSeedMode::Locked { seed }),
        any::<u64>().prop_map(|seed| rhythm::GeneratorSeedMode::PerCycle { seed }),
        (
            any::<u64>(),
            prop::collection::vec(any::<u64>(), 0..5),
            0_u32..101,
            1_u32..101
        )
            .prop_map(|(seed, history, history_weight, new_seed_weight)| {
                rhythm::GeneratorSeedMode::History {
                    seed,
                    history,
                    history_weight,
                    new_seed_weight,
                    max_history: 8,
                }
            }),
    ]
}

/// Valid Dum-Ka patterns whose events never cross an integer-beat boundary,
/// so they realize on any single-section per-beat structure whose
/// Subdivision is a multiple of theirs (see `dumka_section_score`).
const DUMKA_FUZZ_PATTERNS: [&str; 4] = ["x . x .", "dum . ka .", "[x x] . [x x x] .", "E(3,8)@4"];

fn directive_family(index: usize) -> rhythm::DirectiveFamily {
    match index % 10 {
        0 => rhythm::DirectiveFamily::BarlowRemove,
        1 => rhythm::DirectiveFamily::BarlowAdd,
        2 => rhythm::DirectiveFamily::Rotate,
        3 => rhythm::DirectiveFamily::Syncopate,
        4 => rhythm::DirectiveFamily::Desyncopate,
        5 => rhythm::DirectiveFamily::Fragment,
        6 => rhythm::DirectiveFamily::Consolidate,
        7 => rhythm::DirectiveFamily::Euclid,
        8 => rhythm::DirectiveFamily::Stochastic,
        _ => rhythm::DirectiveFamily::Morph,
    }
}

/// Bounded valid plans: at most one row per family, so every generated plan
/// satisfies the same-family overlap rule while still exercising layering.
fn evolution_plan_strategy() -> impl Strategy<Value = Vec<rhythm::EvolutionDirective>> {
    (
        0_usize..=4,
        0_usize..10,
        prop::collection::vec(
            (
                prop::bool::ANY,
                1_u64..=3,
                1_u64..=3,
                0_u32..=100,
                prop::option::of((0_u32..4, 1_u32..=4)),
                0_u32..=100,
                0_u32..=100,
                1_u32..=8,
                0_u32..=100,
                prop::bool::ANY,
                prop::bool::ANY,
                0_u8..3,
            ),
            4,
        ),
    )
        .prop_map(|(count, family_offset, rows)| {
            rows.into_iter()
                .take(count)
                .enumerate()
                .map(
                    |(
                        index,
                        (
                            enabled,
                            from,
                            to_hint,
                            intensity,
                            scope_hint,
                            temperature,
                            complexity,
                            max_run,
                            invert,
                            tied,
                            later,
                            pacing_hint,
                        ),
                    )| {
                        let from_cycle = from.min(to_hint);
                        let to_cycle = from.max(to_hint);
                        let scope = scope_hint.map(|(start, len_hint)| {
                            let len_beats = len_hint.min(4 - start);
                            rhythm::BeatRange {
                                start_beat: start,
                                len_beats,
                            }
                        });
                        let family = directive_family(family_offset + index);
                        let perceptual = family != rhythm::DirectiveFamily::Stochastic
                            && pacing_hint == 0
                            && later;
                        let pacing = if family == rhythm::DirectiveFamily::Stochastic || perceptual
                        {
                            rhythm::DirectivePacing::PerCycle
                        } else {
                            match pacing_hint {
                                0 => rhythm::DirectivePacing::PerCycle,
                                1 => rhythm::DirectivePacing::Linear,
                                _ => rhythm::DirectivePacing::EaseInOut,
                            }
                        };
                        rhythm::EvolutionDirective {
                            id: index as u64 + 1,
                            order: index as u32,
                            enabled,
                            from_cycle,
                            to_cycle,
                            family,
                            pacing,
                            magnitude: if perceptual {
                                rhythm::DirectiveMagnitude::Perceptual {
                                    model_version: rhythm::PerceptualModelVersion::V1,
                                    target_milli: temperature.saturating_mul(1_000),
                                    tolerance_milli: complexity.saturating_mul(100),
                                    max_operations: max_run,
                                }
                            } else {
                                rhythm::DirectiveMagnitude::OperationQuota
                            },
                            intensity,
                            scope,
                            options: rhythm::DirectiveOptions {
                                barlow_temperature: Some(temperature),
                                fill_complexity: Some(complexity),
                                density_floor: Some(temperature.min(complexity)),
                                density_ceiling: Some(temperature.max(complexity)),
                                complexity_floor: Some(
                                    temperature.min(complexity).saturating_mul(1_000),
                                ),
                                complexity_ceiling: Some(
                                    temperature.max(complexity).saturating_mul(1_000),
                                ),
                                placement_bias: Some(invert),
                                subdivision_level: None,
                                morph_target: (family == rhythm::DirectiveFamily::Morph)
                                    .then(|| "x . x .".to_string()),
                                euclid_max_run: Some(max_run),
                                euclid_invert: Some(invert),
                                euclid_rest_policy: Some(if tied {
                                    rhythm::EuclidRestPolicy::Tied
                                } else {
                                    rhythm::EuclidRestPolicy::Silent
                                }),
                                rotate_direction: if later {
                                    rhythm::RotateDirection::Later
                                } else {
                                    rhythm::RotateDirection::Earlier
                                },
                            },
                        }
                    },
                )
                .collect()
        })
}

/// Small, valid authored property-curve sets. The final targets for Density
/// and Complexity are projected into the generated global rails below so this
/// strategy exercises steering rather than being discarded by validation.
fn property_curve_hints_strategy() -> impl Strategy<Value = Vec<(usize, bool, u32, u32, u32)>> {
    prop_oneof![
        3 => Just(Vec::new()),
        1 => prop::collection::vec(
            (
                0_usize..6,
                prop::bool::ANY,
                0_u32..=100_000,
                0_u32..=10_000,
                1_u32..=100,
            ),
            1..=2,
        ),
    ]
}

fn dumka_params_strategy() -> impl Strategy<Value = rhythm::DumkaGeneratorParams> {
    (
        0..DUMKA_FUZZ_PATTERNS.len(),
        0_u32..=100,
        0_u32..=100,
        0_u32..=100,
        0_u32..=100,
        prop::array::uniform8(0_u32..=100),
        (1_u32..=8, 0_u32..=100, prop::bool::ANY),
        evolution_plan_strategy(),
        prop_oneof![
            Just(Vec::<u32>::new()),
            Just(vec![2]),
            Just(vec![3]),
            Just(vec![5]),
            Just(vec![7]),
            Just(vec![2, 3]),
        ],
        property_curve_hints_strategy(),
        // The pacing curve MUST be drawn here: it was hardcoded disabled
        // while the curve walk shipped without a leash, so 2048-case sweeps
        // never touched the exact surface that collapsed patterns to a
        // single onset. Every authored feature flag belongs in this strategy
        // the day it ships.
        (prop::bool::ANY, 0_u32..=100_000, 0_u32..=20_000, 1_u64..=8),
        generator_seed_mode_strategy(),
    )
        .prop_map(
            |(
                index,
                evolution_rate,
                drift_leash,
                barlow_temperature,
                fill_complexity,
                weights,
                (euclid_max_run, euclid_invert, euclid_tied),
                mut plan,
                subdivision_palette,
                property_curve_hints,
                (curve_enabled, curve_target, curve_tolerance, curve_span),
                seed_mode,
            )| {
                for (index, directive) in plan.iter_mut().enumerate() {
                    if index % 2 == 0 {
                        directive.options.subdivision_level = subdivision_palette.first().copied();
                    }
                }
                let density_floor = barlow_temperature.min(fill_complexity);
                let density_ceiling = barlow_temperature.max(fill_complexity);
                let complexity_floor = density_floor.saturating_mul(1_000);
                let complexity_ceiling = density_ceiling.saturating_mul(1_000);
                let mut seen = HashSet::new();
                let property_curves = property_curve_hints
                    .into_iter()
                    .filter_map(|(property_index, enabled, hint, tolerance_milli, weight)| {
                        let property = match property_index {
                            0 => rhythm::CurveProperty::Density,
                            1 => rhythm::CurveProperty::Complexity,
                            2 => rhythm::CurveProperty::Syncopation,
                            3 => rhythm::CurveProperty::Evenness,
                            4 => rhythm::CurveProperty::Occupancy,
                            _ => rhythm::CurveProperty::Diversity,
                        };
                        if !seen.insert(property) {
                            return None;
                        }
                        let (floor, ceiling) = match property {
                            rhythm::CurveProperty::Density => (
                                density_floor.saturating_mul(1_000),
                                density_ceiling.saturating_mul(1_000),
                            ),
                            rhythm::CurveProperty::Complexity => {
                                (complexity_floor, complexity_ceiling)
                            }
                            _ => (0, 100_000),
                        };
                        let width = ceiling.saturating_sub(floor);
                        let target_milli = floor.saturating_add(if width == 0 {
                            0
                        } else {
                            hint % width.saturating_add(1)
                        });
                        Some(rhythm::PropertyCurve {
                            property,
                            enabled,
                            tolerance_milli,
                            weight,
                            points: vec![rhythm::CurvePoint {
                                cycle: 1,
                                target_milli,
                            }],
                        })
                    })
                    .collect();
                rhythm::DumkaGeneratorParams {
                    pattern: DUMKA_FUZZ_PATTERNS[index].to_string(),
                    subdivision_palette,
                    evolution_rate,
                    drift_leash,
                    barlow_temperature,
                    fill_complexity,
                    density_floor,
                    density_ceiling,
                    complexity_floor,
                    complexity_ceiling,
                    placement_bias: euclid_invert,
                    weight_barlow_remove: weights[0],
                    weight_barlow_add: weights[1],
                    weight_rotate: weights[2],
                    weight_syncopate: weights[3],
                    weight_desyncopate: weights[4],
                    weight_fragment: weights[5],
                    weight_consolidate: weights[6],
                    weight_euclid: weights[7],
                    euclid_max_run,
                    euclid_invert,
                    euclid_rest_policy: if euclid_tied {
                        rhythm::EuclidRestPolicy::Tied
                    } else {
                        rhythm::EuclidRestPolicy::Silent
                    },
                    plan,
                    plan_length_cycles: 0,
                    evolution_curve: rhythm::EvolutionCurve {
                        enabled: curve_enabled,
                        tolerance_milli: curve_tolerance,
                        points: vec![
                            rhythm::CurvePoint {
                                cycle: 1,
                                target_milli: curve_target,
                            },
                            rhythm::CurvePoint {
                                cycle: 1 + curve_span,
                                target_milli: curve_target / 2,
                            },
                        ],
                        ..rhythm::EvolutionCurve::default()
                    },
                    property_curves,
                    seed_mode,
                }
            },
        )
}

fn generator_config_strategy() -> impl Strategy<Value = rhythm::GeneratorConfig> {
    prop_oneof![
        (0_u32..=100, generator_seed_mode_strategy()).prop_map(|(density_percent, seed_mode)| {
            rhythm::GeneratorConfig::Example(rhythm::ExampleGeneratorParams {
                density_percent,
                seed_mode,
            })
        }),
        dumka_params_strategy().prop_map(rhythm::GeneratorConfig::Dumka),
    ]
}

/// A single-section score matched to a Dum-Ka pattern's working structure:
/// the pattern's beat count, its palette-refined Subdivision times a bounded
/// multiplier, and no Grouping (per-beat spans).
fn dumka_section_score(
    params: &rhythm::DumkaGeneratorParams,
    multiplier_hint: u32,
    seed: u64,
) -> model::Score {
    let tree = rhythm::generators::dumka::dsl::parse(&params.pattern).expect("fuzz patterns parse");
    let compiled = rhythm::generators::dumka::tree::compile(&tree).expect("fuzz patterns compile");
    let required = compiled.required_structure();
    let working = rhythm::generators::dumka::depth::working_subdivision(
        required.subdivision,
        &params.subdivision_palette,
    )
    .expect("strategy emits a legal working Subdivision");
    let max_multiplier = (64 / working).max(1);
    let subdivision = working * multiplier_hint.clamp(1, max_multiplier);
    model::Score::subdivision_switch(
        "invariant-dumka",
        model::SubdivisionSwitchSpec {
            cycle_beats: required.cycle_beats,
            initial_weights: vec![model::WeightedSubdivisionChoice {
                subdivision,
                weight: 1.0,
            }],
            initial_jathi_weights: vec![],
            initial_custom_subdivision: None,
            automation: None,
            inflections: vec![],
            switch_count_weights: vec![model::WeightedSwitchCount {
                count: 0,
                weight: 1.0,
            }],
            seed_mode: model::SwitchSeedMode::Locked { seed },
            accent: model::GatiAccentSpec::default(),
            pitch: 60,
            velocity: 96,
        },
    )
}

/// A score the drawn generator can actually realize: Example accepts any
/// section structure; Dum-Ka needs the structure its pattern requires.
fn compatible_score(
    generator: &rhythm::GeneratorConfig,
    subdivision: u32,
    grouping: Option<u32>,
    seed: u64,
) -> model::Score {
    match generator {
        rhythm::GeneratorConfig::Example(_) => section_score(subdivision, grouping, seed),
        rhythm::GeneratorConfig::Dumka(params) => dumka_section_score(params, subdivision, seed),
    }
}

fn section_score(subdivision: u32, grouping: Option<u32>, seed: u64) -> model::Score {
    let subdivision = subdivision.clamp(1, 16);
    let initial_jathi_weights = grouping
        .filter(|value| *value > 0)
        .map(|jathi| vec![model::WeightedJathiChoice { jathi, weight: 1.0 }])
        .unwrap_or_default();
    model::Score::subdivision_switch(
        "invariant-sections",
        model::SubdivisionSwitchSpec {
            cycle_beats: 4,
            initial_weights: vec![model::WeightedSubdivisionChoice {
                subdivision,
                weight: 1.0,
            }],
            initial_jathi_weights,
            initial_custom_subdivision: None,
            automation: None,
            inflections: vec![model::SubdivisionInflection {
                id: Some("half".to_string()),
                position: model::Rational::new(1, 2),
                change_probability: 1.0,
                subdivision_weights: vec![model::WeightedSubdivisionChoice {
                    subdivision: (subdivision % 8) + 1,
                    weight: 1.0,
                }],
                jathi_weights: vec![],
                custom_subdivision: None,
            }],
            switch_count_weights: vec![model::WeightedSwitchCount {
                count: 1,
                weight: 1.0,
            }],
            seed_mode: model::SwitchSeedMode::Locked { seed },
            accent: model::GatiAccentSpec::default(),
            pitch: 60,
            velocity: 96,
        },
    )
}

fn hocket_spec(seed: u64) -> rhythm::ChannelHocketSpec {
    rhythm::ChannelHocketSpec {
        order: rhythm::MarkovOrder::First,
        channels: vec![1, 2],
        transitions: vec![
            rhythm::ChannelTransition {
                from: vec![1],
                to: 2,
                weight: 1,
            },
            rhythm::ChannelTransition {
                from: vec![2],
                to: 1,
                weight: 1,
            },
        ],
        fallback: 1,
        fallback_weights: vec![],
        entry_weights: vec![],
        seed_mode: rhythm::RhythmSeedMode::Locked { seed },
        global_seed: seed,
        accent_rules: vec![],
        position_rules: vec![],
        assign_mode: rhythm::ChannelAssignMode::Markov,
        euclid: None,
    }
}

fn playback(
    enabled: bool,
    generator: rhythm::GeneratorConfig,
    hocket: bool,
    channel: u8,
) -> RhythmPlaybackConfig {
    RhythmPlaybackConfig {
        generator_enabled: enabled,
        generator,
        midi_output_channel: channel,
        automation: None,
        channel_hocket_enabled: hocket,
        channel_hocket: hocket.then(|| hocket_spec(73)),
        seed_path: None,
    }
}

fn queue_signature(
    results: &[cseq_transport::TransportCycleFuzzResult],
) -> Vec<Vec<TransportFuzzQueuedEvent>> {
    results.iter().map(|result| result.queue.clone()).collect()
}

fn seed_path_from_results(
    results: &[cseq_transport::TransportCycleFuzzResult],
) -> SeedPathPlaybackConfig {
    SeedPathPlaybackConfig {
        entries: results
            .iter()
            .flat_map(|result| result.seed_trace.iter())
            .map(|entry| SeedPathPlaybackEntry {
                cycle: entry.cycle,
                domain: entry.domain.clone(),
                label: entry.label.clone(),
                seed: entry.seed,
                base_seed: entry.base_seed,
                source: entry.source.clone(),
                history_before: entry.history_before.clone(),
                history_after: entry.history_after.clone(),
                track_id: entry.track_id.clone(),
            })
            .collect(),
        wildcards: vec![],
    }
}

fn note_on_ticks(events: &[TransportFuzzQueuedEvent]) -> Vec<u64> {
    events
        .iter()
        .filter(|event| event.bytes.first().is_some_and(|byte| byte & 0xf0 == 0x90))
        .filter(|event| event.bytes.get(2).copied().unwrap_or(0) > 0)
        .map(|event| event.absolute_tick)
        .collect()
}

fn offset_to_ticks(offset: model::Rational) -> u64 {
    let scaled = offset * model::Rational::from(i64::from(PPQN));
    let numer = i128::from(*scaled.numer());
    let denom = i128::from(*scaled.denom());
    let quotient = numer / denom;
    let remainder = numer % denom;
    u64::try_from(if remainder * 2 >= denom {
        quotient + 1
    } else {
        quotient
    })
    .unwrap()
}

/// Sounding onsets (non-rest, non-tied) the generator resolves at `cycle`.
fn sounding_onset_count(
    score: &model::Score,
    generator: &rhythm::GeneratorConfig,
    cycle: u64,
) -> usize {
    let tree = cseq_transforms::apply_pipeline_for_cycle(score, cycle).expect("sections resolve");
    let active = model::rhythm_accent_spans(&tree.pulse_spans);
    let spans = active
        .iter()
        .map(|span| rhythm::GeneratorSpanInput::from(*span))
        .collect::<Vec<_>>();
    let mut generator = generator.clone();
    let seed = rhythm::resolve_generator_seed(generator.seed_mode_mut(), cycle)
        .expect("generator seed resolves")
        .seed;
    rhythm::resolve_generator_cycle(
        &generator,
        &rhythm::GeneratorCycleContext {
            track_id: None,
            cycle,
            cycle_beats: 4,
            spans: &spans,
            seed,
            automation: &|_, _, _| None,
        },
    )
    .expect("generator resolves")
    .iter()
    .flat_map(|span| span.cells.iter())
    .filter(|cell| !cell.rest && !cell.tied_from_previous)
    .count()
}

fn expected_generator_onsets(
    score: &model::Score,
    generator: &rhythm::GeneratorConfig,
    cycle: u64,
) -> Vec<u64> {
    let tree = cseq_transforms::apply_pipeline_for_cycle(score, cycle).expect("sections resolve");
    let active = model::rhythm_accent_spans(&tree.pulse_spans);
    let spans = active
        .iter()
        .map(|span| rhythm::GeneratorSpanInput::from(*span))
        .collect::<Vec<_>>();
    let mut generator = generator.clone();
    let seed = rhythm::resolve_generator_seed(generator.seed_mode_mut(), cycle)
        .expect("generator seed resolves")
        .seed;
    let resolved = rhythm::resolve_generator_cycle(
        &generator,
        &rhythm::GeneratorCycleContext {
            track_id: None,
            cycle,
            cycle_beats: 4,
            spans: &spans,
            seed,
            automation: &|_, _, _| None,
        },
    )
    .expect("generator preview resolves");
    let pulse_spans = active
        .into_iter()
        .map(|span| (span.id, span))
        .collect::<HashMap<_, _>>();
    let mut ticks = resolved
        .iter()
        .flat_map(|span| {
            let pulse = pulse_spans[&span.span_id];
            span.cells
                .iter()
                .filter(|cell| !cell.rest)
                .map(move |cell| {
                    offset_to_ticks(
                        pulse.start
                            + pulse.duration
                                * model::Rational::new(
                                    i64::from(cell.start),
                                    i64::from(span.span_len),
                                ),
                    )
                })
        })
        .collect::<Vec<_>>();
    ticks.sort_unstable();
    ticks
}

fn resolved_onset_slots(spans: &[rhythm::GeneratedSpan]) -> Vec<u32> {
    let mut span_start = 0u32;
    let mut onsets = Vec::new();
    for span in spans {
        onsets.extend(
            span.cells
                .iter()
                .filter(|cell| !cell.rest && !cell.tied_from_previous)
                .map(|cell| span_start + cell.start),
        );
        span_start = span_start.saturating_add(span.span_len);
    }
    onsets
}

fn dispatch_order(event: &TransportFuzzQueuedEvent) -> u8 {
    match event.bytes.first().map(|byte| byte & 0xf0) {
        Some(0x80) => 0,
        Some(0x90) if event.bytes.get(2) == Some(&0) => 0,
        Some(0x90) => 1,
        _ => 2,
    }
}

fn assert_structural_queue(events: &[TransportFuzzQueuedEvent], max_tick: u64) {
    let mut active = HashMap::<(u8, u8), u32>::new();
    for window in events.windows(2) {
        assert!(
            (window[0].absolute_tick, dispatch_order(&window[0]))
                <= (window[1].absolute_tick, dispatch_order(&window[1])),
            "transport queue is not dispatch-sorted"
        );
    }
    for event in events {
        assert!(event.absolute_tick <= max_tick);
        assert!((1..=3).contains(&event.bytes.len()));
        let status = event.bytes[0] & 0xf0;
        if matches!(status, 0x80 | 0x90 | 0xb0) {
            assert_eq!(event.bytes.len(), 3);
            assert!(event.bytes[1] <= 127 && event.bytes[2] <= 127);
        }
        match status {
            0x90 if event.bytes[2] > 0 => {
                *active
                    .entry((event.bytes[0] & 0x0f, event.bytes[1]))
                    .or_default() += 1;
            }
            0x80 | 0x90 => {
                let key = (event.bytes[0] & 0x0f, event.bytes[1]);
                let count = active
                    .get_mut(&key)
                    .unwrap_or_else(|| panic!("note-off without note-on: {event:?}"));
                assert!(*count > 0);
                *count -= 1;
            }
            _ => {}
        }
    }
    assert!(active.values().all(|count| *count == 0));
}

fn conflict_policy(index: u8) -> ChannelConflictPolicy {
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
    POLICIES[usize::from(index) % POLICIES.len()]
}

fn trigger(source: &str) -> cseq_trigger::TriggerConfig {
    cseq_trigger::TriggerConfig {
        source_track_id: source.to_string(),
        when: None,
        condition: Some(cseq_trigger::TriggerCondition::BeatIsSounding { beat: 0 }),
        launch_alignment: cseq_trigger::LaunchAlignment::AtEvent,
        launch_quantize: None,
        lifetime: cseq_trigger::Lifetime::OnePass,
        re_trigger: cseq_trigger::ReTrigger::Restart,
        length: cseq_trigger::TriggerLength::ScoreCycle,
        max_repeats: 4,
        gate: None,
        start_select: None,
    }
}

fn parallel_config(
    generator: rhythm::GeneratorConfig,
    policy: ChannelConflictPolicy,
    hocket: bool,
    triggered: bool,
) -> ParallelPlaybackConfig {
    let (score_a, score_b) = match &generator {
        rhythm::GeneratorConfig::Example(_) => {
            (section_score(4, Some(3), 11), section_score(5, None, 12))
        }
        rhythm::GeneratorConfig::Dumka(params) => (
            dumka_section_score(params, 1, 11),
            dumka_section_score(params, 2, 12),
        ),
    };
    let tracks = vec![
        ParallelPlaybackTrackConfig {
            id: "a".to_string(),
            name: "A".to_string(),
            score: score_a,
            rhythm: Some(playback(true, generator.clone(), hocket, 1)),
            tempo_bpm: 120.0,
            trigger: None,
            silent: false,
        },
        ParallelPlaybackTrackConfig {
            id: "b".to_string(),
            name: "B".to_string(),
            score: score_b,
            rhythm: Some(playback(true, generator, hocket, 1)),
            tempo_bpm: 120.0,
            trigger: triggered.then(|| trigger("a")),
            silent: false,
        },
    ];
    ParallelPlaybackConfig {
        tracks,
        reference_tempo_bpm: 120.0,
        reference_cycle_beats: 4,
        channel_conflict_policy: policy,
        channel_logic_matrix: vec![ChannelLogicMatrixEntry {
            track_a_id: "a".to_string(),
            track_b_id: "b".to_string(),
            output_channel: None,
            policy,
        }],
        conflict_priority: vec!["a".to_string(), "b".to_string()],
        track_flow_boxes: vec![],
    }
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: proptest_cases(),
        .. ProptestConfig::default()
    })]

    #[test]
    fn deterministic_resolution_and_seed_path_replay(
        subdivision in 1_u32..=12,
        generator in generator_config_strategy(),
    ) {
        let base_score = compatible_score(&generator, subdivision, Some(3), 21);
        let base_playback = playback(true, generator, false, 1);
        let mut score_a = base_score.clone();
        let mut playback_a = base_playback.clone();
        let first = fuzz_realize_transport_cycles(
            &mut score_a,
            Some(&mut playback_a),
            0,
            3,
            120.0,
        ).expect("first realization");

        let mut score_b = base_score.clone();
        let mut playback_b = base_playback.clone();
        let second = fuzz_realize_transport_cycles(
            &mut score_b,
            Some(&mut playback_b),
            0,
            3,
            120.0,
        ).expect("second realization");
        prop_assert_eq!(queue_signature(&first), queue_signature(&second));

        let mut replay = base_playback;
        replay.seed_path = Some(seed_path_from_results(&first));
        let mut replay_score = base_score;
        let replayed = fuzz_realize_transport_cycles(
            &mut replay_score,
            Some(&mut replay),
            0,
            3,
            120.0,
        ).expect("seed-path replay");
        prop_assert_eq!(queue_signature(&first), queue_signature(&replayed));
    }

    #[test]
    fn disabled_generator_is_byte_identical_to_absent_config(
        subdivision in 1_u32..=12,
        generator in generator_config_strategy(),
    ) {
        let score = compatible_score(&generator, subdivision, None, 22);
        let mut absent_score = score.clone();
        let absent = fuzz_realize_transport_cycles(
            &mut absent_score,
            None,
            0,
            2,
            120.0,
        ).expect("absent generator");
        let mut disabled_score = score;
        let mut disabled = playback(false, generator, false, 1);
        let present = fuzz_realize_transport_cycles(
            &mut disabled_score,
            Some(&mut disabled),
            0,
            2,
            120.0,
        ).expect("disabled generator");
        prop_assert_eq!(queue_signature(&absent), queue_signature(&present));
    }

    #[test]
    fn generator_preview_matches_finalized_midi_onsets(
        subdivision in 1_u32..=12,
        generator in generator_config_strategy(),
    ) {
        let score = compatible_score(&generator, subdivision, Some(3), 23);
        let expected = expected_generator_onsets(&score, &generator, 0);
        let mut transport_score = score;
        let mut transport_playback = playback(true, generator, false, 1);
        let realized = fuzz_realize_transport_cycles(
            &mut transport_score,
            Some(&mut transport_playback),
            0,
            1,
            120.0,
        ).expect("transport realization");
        let actual = note_on_ticks(&realized[0].queue);
        prop_assert_eq!(expected, actual);
    }

    /// The pacing-collapse regression, as a property over the whole fuzzed
    /// config space: with directives absent and the density corridor open,
    /// NO stochastic layer (classic step, pacing-curve walk, property
    /// steering) may pull the sounding onset count below the seed anchor
    /// minus the leash budget — however large the drawn step targets are.
    /// The original escape was possible because the pacing curve was never
    /// drawn by this strategy and no property asserted a musical bound.
    #[test]
    fn stochastic_layers_hold_the_leash_count_floor(
        params in dumka_params_strategy(),
        cycle in 4_u64..=14,
    ) {
        let mut params = params;
        params.plan.clear();
        params.density_floor = 0;
        params.density_ceiling = 100;
        params
            .property_curves
            .retain(|curve| curve.property != rhythm::CurveProperty::Density);
        let generator = rhythm::GeneratorConfig::Dumka(params.clone());
        let score = compatible_score(&generator, 1, None, 27);
        let seed_onsets = sounding_onset_count(&score, &generator, 0);
        let sounding = sounding_onset_count(&score, &generator, cycle);
        let budget = (params.drift_leash as usize)
            .saturating_mul(seed_onsets)
            .div_ceil(100);
        prop_assert!(
            sounding >= seed_onsets.saturating_sub(budget),
            "cycle {} sounded {} onsets; seed {} leash budget {}",
            cycle,
            sounding,
            seed_onsets,
            budget
        );
    }

    #[test]
    fn parallel_queue_is_structural_and_reapply_stable(
        generator in generator_config_strategy(),
        policy_index in any::<u8>(),
        hocket in any::<bool>(),
        triggered in any::<bool>(),
    ) {
        let config = parallel_config(
            generator,
            conflict_policy(policy_index),
            hocket,
            triggered,
        );
        let direct = fuzz_realize_parallel_cycles(config.clone(), 3)
            .expect("parallel realization");
        let reapplied = fuzz_realize_parallel_cycles_reapplied(config.clone(), 3)
            .expect("parallel reapply");
        let stepped = fuzz_realize_parallel_cycles_stepped(config, 3)
            .expect("parallel stepped realization");
        prop_assert_eq!(&direct, &reapplied);
        if !triggered {
            prop_assert_eq!(&direct, &stepped);
        }
        assert_structural_queue(&direct, 7 * 4 * u64::from(PPQN));
        assert_structural_queue(&stepped, 7 * 4 * u64::from(PPQN));
    }
}

#[test]
fn generator_strategy_discriminants_are_exhaustive() {
    let mut runner = TestRunner::deterministic();
    let strategy = generator_config_strategy();
    let mut variants = HashSet::new();
    for _ in 0..64 {
        let tree = strategy
            .new_tree(&mut runner)
            .expect("generator strategy produces a value");
        match tree.current() {
            rhythm::GeneratorConfig::Example(_) => {
                variants.insert("example");
            }
            rhythm::GeneratorConfig::Dumka(_) => {
                variants.insert("dumka");
            }
        }
    }
    assert_eq!(variants, HashSet::from(["example", "dumka"]));
}

#[test]
fn evolution_plan_strategy_reaches_bounds_and_every_family() {
    let mut runner = TestRunner::deterministic();
    let strategy = evolution_plan_strategy();
    let mut lengths = HashSet::new();
    let mut families = HashSet::new();
    for _ in 0..512 {
        let tree = strategy
            .new_tree(&mut runner)
            .expect("plan strategy produces a value");
        let plan = tree.current();
        lengths.insert(plan.len());
        for directive in plan {
            families.insert(directive.family);
        }
    }
    assert!(lengths.contains(&0));
    assert!(lengths.contains(&4));
    assert_eq!(
        families,
        HashSet::from([
            rhythm::DirectiveFamily::BarlowRemove,
            rhythm::DirectiveFamily::BarlowAdd,
            rhythm::DirectiveFamily::Rotate,
            rhythm::DirectiveFamily::Syncopate,
            rhythm::DirectiveFamily::Desyncopate,
            rhythm::DirectiveFamily::Fragment,
            rhythm::DirectiveFamily::Consolidate,
            rhythm::DirectiveFamily::Euclid,
            rhythm::DirectiveFamily::Stochastic,
            rhythm::DirectiveFamily::Morph,
        ])
    );
}

#[test]
fn dumka_depth_strategy_reaches_every_palette_and_new_control_bounds() {
    let mut runner = TestRunner::deterministic();
    let strategy = dumka_params_strategy();
    let mut palettes = HashSet::new();
    let mut saw_zero_complexity = false;
    let mut saw_max_complexity = false;
    let mut saw_zero_bias = false;
    let mut saw_max_bias = false;
    let mut saw_morph = false;
    let mut saw_level_filter = false;
    let mut curve_properties = HashSet::new();
    for _ in 0..2_048 {
        let tree = strategy
            .new_tree(&mut runner)
            .expect("Dum-Ka strategy produces a value");
        let params = tree.current();
        palettes.insert(params.subdivision_palette.clone());
        saw_zero_complexity |= params.complexity_floor == 0;
        saw_max_complexity |= params.complexity_ceiling == 100_000;
        saw_zero_bias |= params.placement_bias == 0;
        saw_max_bias |= params.placement_bias == 100;
        saw_morph |= params
            .plan
            .iter()
            .any(|directive| directive.family == rhythm::DirectiveFamily::Morph);
        saw_level_filter |= params
            .plan
            .iter()
            .any(|directive| directive.options.subdivision_level.is_some());
        curve_properties.extend(params.property_curves.iter().map(|curve| curve.property));
    }
    assert_eq!(
        palettes,
        HashSet::from([vec![], vec![2], vec![3], vec![5], vec![7], vec![2, 3],])
    );
    assert!(saw_zero_complexity && saw_max_complexity);
    assert!(saw_zero_bias && saw_max_bias);
    assert!(saw_morph && saw_level_filter);
    assert_eq!(
        curve_properties,
        HashSet::from([
            rhythm::CurveProperty::Density,
            rhythm::CurveProperty::Complexity,
            rhythm::CurveProperty::Syncopation,
            rhythm::CurveProperty::Evenness,
            rhythm::CurveProperty::Occupancy,
            rhythm::CurveProperty::Diversity,
        ]),
        "the transport invariant generator must exercise every property lane"
    );
}

#[test]
fn subdivision_level_filters_real_add_candidates_on_the_working_grid() {
    let spans = [rhythm::GeneratorSpanInput {
        span_id: 1,
        span_len: 12,
        label: None,
        section_index: Some(1),
        subdivision: Some(12),
    }];
    let directive = |subdivision_level| rhythm::EvolutionDirective {
        id: 501,
        order: 0,
        enabled: true,
        from_cycle: 1,
        to_cycle: 1,
        family: rhythm::DirectiveFamily::BarlowAdd,
        pacing: rhythm::DirectivePacing::PerCycle,
        magnitude: rhythm::DirectiveMagnitude::OperationQuota,
        intensity: 100,
        scope: None,
        options: rhythm::DirectiveOptions {
            subdivision_level,
            ..Default::default()
        },
    };
    let resolve = |subdivision_level| {
        let config = rhythm::GeneratorConfig::Dumka(rhythm::DumkaGeneratorParams {
            pattern: "[x . . .]".to_string(),
            subdivision_palette: vec![3],
            evolution_rate: 0,
            drift_leash: 0,
            plan: vec![directive(subdivision_level)],
            seed_mode: rhythm::GeneratorSeedMode::Locked { seed: 501 },
            ..Default::default()
        });
        rhythm::resolve_generator_cycle_with_trace(
            &config,
            &rhythm::GeneratorCycleContext {
                track_id: None,
                cycle: 1,
                cycle_beats: 1,
                spans: &spans,
                seed: 501,
                automation: &|_, _, _| None,
            },
        )
        .expect("filtered Add resolves")
    };

    let filtered = resolve(Some(3));
    let unfiltered = resolve(None);
    let filtered_slots = resolved_onset_slots(&filtered.spans);
    let unfiltered_slots = resolved_onset_slots(&unfiltered.spans);
    let filtered_additions = filtered_slots
        .iter()
        .copied()
        .filter(|slot| *slot != 0)
        .collect::<Vec<_>>();

    // subdivisionLevel 3 is a palette PRIME: every filtered addition must land
    // on a slot the ×3 refinement created (reduced denominator divisible by 3).
    assert!(!filtered_additions.is_empty());
    assert!(filtered_additions
        .iter()
        .all(|slot| { rhythm::generators::dumka::depth::reduced_denominator(*slot, 12) % 3 == 0 }));
    assert!(unfiltered_slots.iter().any(|slot| {
        *slot != 0 && rhythm::generators::dumka::depth::reduced_denominator(*slot, 12) % 3 != 0
    }));
    assert_ne!(filtered_slots, unfiltered_slots);
    assert!(filtered.trace[0].applied > 0);
}

#[test]
fn depth_diversity_is_a_readout_and_does_not_select_an_evolution_path() {
    let spans = [rhythm::GeneratorSpanInput {
        span_id: 1,
        span_len: 12,
        label: None,
        section_index: Some(1),
        subdivision: Some(12),
    }];
    let config = rhythm::GeneratorConfig::Dumka(rhythm::DumkaGeneratorParams {
        pattern: "[x . x .]".to_string(),
        subdivision_palette: vec![3],
        evolution_rate: 100,
        drift_leash: 100,
        weight_barlow_remove: 0,
        weight_barlow_add: 100,
        weight_rotate: 0,
        seed_mode: rhythm::GeneratorSeedMode::Locked { seed: 777 },
        ..Default::default()
    });
    let context = rhythm::GeneratorCycleContext {
        track_id: None,
        cycle: 3,
        cycle_beats: 1,
        spans: &spans,
        seed: 777,
        automation: &|_, _, _| None,
    };

    let observed = rhythm::resolve_generator_cycle_with_trace(&config, &context)
        .expect("observed resolution succeeds");
    let ordinary =
        rhythm::resolve_generator_cycle(&config, &context).expect("ordinary resolution succeeds");
    let onset_slots = resolved_onset_slots(&observed.spans);

    assert_eq!(ordinary, observed.spans);
    assert_eq!(
        observed.state_depth_diversity_milli,
        Some(rhythm::generators::dumka::depth::depth_diversity_milli(
            &onset_slots,
            12,
        ))
    );
    assert!(observed.state_depth_diversity_milli.is_some());
    assert_eq!(
        rhythm::resolve_generator_cycle_with_trace(&config, &context)
            .expect("readout replay succeeds"),
        observed,
        "reading diversity cannot admit, reject, or reorder candidates"
    );
}

#[test]
fn generator_seed_strategy_reaches_every_mode() {
    let mut runner = TestRunner::deterministic();
    let strategy = generator_seed_mode_strategy();
    let mut variants = HashSet::new();
    for _ in 0..256 {
        let tree = strategy
            .new_tree(&mut runner)
            .expect("seed strategy produces a value");
        variants.insert(match tree.current() {
            rhythm::GeneratorSeedMode::Locked { .. } => "locked",
            rhythm::GeneratorSeedMode::PerCycle { .. } => "perCycle",
            rhythm::GeneratorSeedMode::History { .. } => "history",
        });
    }
    assert_eq!(variants, HashSet::from(["locked", "perCycle", "history"]));
}
