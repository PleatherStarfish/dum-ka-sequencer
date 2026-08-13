//! Golden MIDI event ledgers for every score in `examples/scores/`
//! (docs/TEST_COVERAGE_PLAN_2026-07.md Phase 3.3): each fixture is realized
//! through the REAL transport path for two cycles at a fixed tempo and the
//! resulting queue — tick, wire channel, raw bytes — is pinned against a
//! committed golden file. This converts the example scores from
//! serialization anchors into broad-spectrum audio-output regressions: any
//! engine change that alters what these scores PLAY fails here with a diff.
//!
//! Regenerate after an intentional musical change:
//!
//! ```text
//! UPDATE_GOLDEN_LEDGERS=1 cargo test -p cseq-transport --features fuzzing --test golden_ledgers
//! ```
//!
//! then review the diff like any other golden (the change IS the sound).

use std::fmt::Write as _;
use std::path::PathBuf;

use cseq_transport::fuzz_realize_transport_cycles;

const CYCLES: u64 = 2;
const TEMPO_BPM: f32 = 120.0;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root resolves")
}

fn golden_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/goldens")
        .join(format!("{name}.ledger.txt"))
}

/// One line per queued event: `tick <tab> user-channel <tab> bytes-hex`.
/// Plain text so golden diffs read chronologically in review.
fn render_ledger(name: &str) -> String {
    render_ledger_with_rhythm(name, name, None)
}

/// Like `render_ledger`, but with a playback config attached — for shaper
/// features (like the channel strategies) that live on the rhythm config
/// rather than in the score JSON. `golden_name` keys the golden file;
/// `score_name` picks the example score it plays.
fn render_ledger_with_rhythm(
    golden_name: &str,
    score_name: &str,
    rhythm: Option<cseq_transport::RhythmPlaybackConfig>,
) -> String {
    let score_path = repo_root()
        .join("examples/scores")
        .join(format!("{score_name}.json"));
    let score = cseq_persist::load(&score_path)
        .unwrap_or_else(|e| panic!("example score {score_name} loads: {e}"));
    render_ledger_for_score(golden_name, score, rhythm)
}

/// Like `render_ledger_with_rhythm`, but over an in-code score — for
/// generator goldens that need structural spans (a sectioned score), which
/// the plain duration-tree examples do not produce.
fn render_ledger_for_score(
    name: &str,
    score: cseq_model::Score,
    rhythm: Option<cseq_transport::RhythmPlaybackConfig>,
) -> String {
    render_ledger_window_for_score(name, score, rhythm, 0, CYCLES)
}

fn render_ledger_window_for_score(
    name: &str,
    mut score: cseq_model::Score,
    mut rhythm: Option<cseq_transport::RhythmPlaybackConfig>,
    start_cycle: u64,
    cycle_count: u64,
) -> String {
    let results = fuzz_realize_transport_cycles(
        &mut score,
        rhythm.as_mut(),
        start_cycle,
        cycle_count,
        TEMPO_BPM,
    )
    .unwrap_or_else(|e| panic!("golden score {name} realizes: {e}"));
    let mut out = String::new();
    if start_cycle == 0 && cycle_count == CYCLES {
        let _ = writeln!(out, "# {name} · {CYCLES} cycles @ {TEMPO_BPM} BPM");
    } else {
        let _ = writeln!(
            out,
            "# {name} · {cycle_count} cycles from {start_cycle} @ {TEMPO_BPM} BPM"
        );
    }
    for cycle in &results {
        let _ = writeln!(
            out,
            "# cycle {} · ticks/cycle {}",
            cycle.cycle, cycle.ticks_per_cycle
        );
    }
    // The queue is cumulative per cycle; the final cycle's queue is the full
    // two-cycle ledger.
    if let Some(last) = results.last() {
        for event in &last.queue {
            let bytes = event
                .bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<Vec<_>>()
                .join(" ");
            let channel = event
                .user_channel
                .map(|ch| ch.to_string())
                .unwrap_or_else(|| "-".to_string());
            let _ = writeln!(out, "{}\t{}\t{}", event.absolute_tick, channel, bytes);
        }
    }
    out
}

fn assert_golden(name: &str) {
    assert_golden_rendered(name, render_ledger(name));
}

fn assert_golden_rendered(name: &str, rendered: String) {
    let path = golden_path(name);
    if std::env::var("UPDATE_GOLDEN_LEDGERS").is_ok() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &rendered).unwrap();
        return;
    }
    let golden = std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "missing golden {} — run UPDATE_GOLDEN_LEDGERS=1 cargo test -p cseq-transport \
             --features fuzzing --test golden_ledgers",
            path.display()
        )
    });
    assert_eq!(
        rendered, golden,
        "realized ledger for {name} diverged from the committed golden \
         (if the musical change is intentional, regenerate with UPDATE_GOLDEN_LEDGERS=1)"
    );
}

#[test]
fn golden_beat_cycle_demo() {
    assert_golden("beat_cycle_demo");
}

#[test]
fn golden_chatusra() {
    assert_golden("chatusra");
}

#[test]
fn golden_euclid_3_8() {
    assert_golden("euclid_3_8");
}

#[test]
fn golden_khanda_chapu() {
    assert_golden("khanda_chapu");
}

#[test]
fn golden_switch_cycle_demo() {
    assert_golden("switch_cycle_demo");
}

#[test]
fn golden_tisra() {
    assert_golden("tisra");
}

/// Dum-Ka generator over a bass-register single-section score: four beats
/// at Subdivision 4, the default seed pattern (eight dum/ka strokes)
/// rendered verbatim every cycle with a locked seed. Pins the audible MIDI
/// of the notation → cells → overlay path on a structure the Apply
/// structure helper would author.
fn dumka_rhythm() -> cseq_transport::RhythmPlaybackConfig {
    use cseq_rhythm as rhythm;
    cseq_transport::RhythmPlaybackConfig {
        generator_enabled: true,
        generator: rhythm::GeneratorConfig::Dumka(rhythm::DumkaGeneratorParams {
            pattern: rhythm::DEFAULT_DUMKA_PATTERN.to_string(),
            seed_mode: rhythm::GeneratorSeedMode::Locked { seed: 20260810 },
            ..Default::default()
        }),
        midi_output_channel: 1,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

fn dumka_section_score() -> cseq_model::Score {
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
}

#[test]
fn golden_dumka_default_pattern() {
    assert_golden_rendered(
        "dumka_default_pattern",
        render_ledger_for_score(
            "dumka_default_pattern",
            dumka_section_score(),
            Some(dumka_rhythm()),
        ),
    );
}

/// M3.9 tie-handshake golden: a five-in-the-time-of-two phrase crosses the
/// per-beat structure seam. The projector emits two tied cells at the seam,
/// while the transport ledger must contain exactly the five audible notes
/// authored by the phrase, with no extra re-attack at beat 2.
fn dumka_tied_quintuplet_score() -> cseq_model::Score {
    cseq_model::Score::subdivision_switch(
        "golden-dumka-tied-quintuplet",
        cseq_model::SubdivisionSwitchSpec {
            cycle_beats: 2,
            initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                subdivision: 5,
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
            seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 20260812 },
            accent: cseq_model::GatiAccentSpec::default(),
            pitch: 45,
            velocity: 96,
        },
    )
}

fn dumka_tied_quintuplet_rhythm() -> cseq_transport::RhythmPlaybackConfig {
    use cseq_rhythm as rhythm;
    cseq_transport::RhythmPlaybackConfig {
        generator_enabled: true,
        generator: rhythm::GeneratorConfig::Dumka(rhythm::DumkaGeneratorParams {
            pattern: "[x x x x x]@2".to_string(),
            seed_mode: rhythm::GeneratorSeedMode::Locked { seed: 20260812 },
            ..Default::default()
        }),
        midi_output_channel: 1,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

#[test]
fn golden_dumka_tied_quintuplet() {
    assert_golden_rendered(
        "dumka_tied_quintuplet",
        render_ledger_for_score(
            "dumka_tied_quintuplet",
            dumka_tied_quintuplet_score(),
            Some(dumka_tied_quintuplet_rhythm()),
        ),
    );
}

/// M3.75 evolution-score golden: cycles 1-12 repeat the seed, cycle 13
/// removes exactly ceil(15% of eight) Barlow-ranked onsets, and cycle 15
/// carries the user's scoped last-two-beat Fragment pin. The two-cycle window
/// around cycle 13 makes the audible before/after diff the golden itself.
fn dumka_planned_rhythm() -> cseq_transport::RhythmPlaybackConfig {
    use cseq_rhythm as rhythm;
    let directive = |id, order, cycle, family, intensity, scope| rhythm::EvolutionDirective {
        id,
        order,
        enabled: true,
        from_cycle: cycle,
        to_cycle: cycle,
        family,
        pacing: rhythm::DirectivePacing::PerCycle,
        magnitude: rhythm::DirectiveMagnitude::OperationQuota,
        intensity,
        scope,
        options: rhythm::DirectiveOptions::default(),
    };
    cseq_transport::RhythmPlaybackConfig {
        generator_enabled: true,
        generator: rhythm::GeneratorConfig::Dumka(rhythm::DumkaGeneratorParams {
            pattern: rhythm::DEFAULT_DUMKA_PATTERN.to_string(),
            evolution_rate: 0,
            drift_leash: 0,
            plan: vec![
                directive(13, 0, 13, rhythm::DirectiveFamily::BarlowRemove, 15, None),
                directive(
                    15,
                    1,
                    15,
                    rhythm::DirectiveFamily::Fragment,
                    22,
                    Some(rhythm::BeatRange {
                        start_beat: 2,
                        len_beats: 2,
                    }),
                ),
            ],
            seed_mode: rhythm::GeneratorSeedMode::Locked { seed: 7 },
            ..Default::default()
        }),
        midi_output_channel: 1,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

#[test]
fn golden_dumka_planned() {
    assert_golden_rendered(
        "dumka_planned",
        render_ledger_window_for_score(
            "dumka_planned",
            dumka_section_score(),
            Some(dumka_planned_rhythm()),
            12,
            2,
        ),
    );
}

/// Operation-pacing golden: one 25% Remove target is eased over cycles 1-4.
/// With the eight-onset default seed the fold holds at cycle 1, removes one
/// onset at cycle 2, holds at cycle 3, and removes the second at cycle 4.
fn dumka_smoothed_rhythm() -> cseq_transport::RhythmPlaybackConfig {
    use cseq_rhythm as rhythm;
    cseq_transport::RhythmPlaybackConfig {
        generator_enabled: true,
        generator: rhythm::GeneratorConfig::Dumka(rhythm::DumkaGeneratorParams {
            pattern: rhythm::DEFAULT_DUMKA_PATTERN.to_string(),
            evolution_rate: 0,
            drift_leash: 0,
            plan: vec![rhythm::EvolutionDirective {
                id: 1,
                order: 0,
                enabled: true,
                from_cycle: 1,
                to_cycle: 4,
                family: rhythm::DirectiveFamily::BarlowRemove,
                pacing: rhythm::DirectivePacing::EaseInOut,
                magnitude: rhythm::DirectiveMagnitude::OperationQuota,
                intensity: 25,
                scope: None,
                options: rhythm::DirectiveOptions::default(),
            }],
            seed_mode: rhythm::GeneratorSeedMode::Locked { seed: 17 },
            ..Default::default()
        }),
        midi_output_channel: 1,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

#[test]
fn golden_dumka_smoothed() {
    assert_golden_rendered(
        "dumka_smoothed",
        render_ledger_window_for_score(
            "dumka_smoothed",
            dumka_section_score(),
            Some(dumka_smoothed_rhythm()),
            0,
            5,
        ),
    );
}

fn omit_depth_fields_from_legacy_wire(
    mut rhythm: cseq_transport::RhythmPlaybackConfig,
) -> cseq_transport::RhythmPlaybackConfig {
    let cseq_rhythm::GeneratorConfig::Dumka(params) = &rhythm.generator else {
        panic!("legacy depth identity fixture must use Dum-Ka");
    };
    assert!(params.subdivision_palette.is_empty());
    assert_eq!(
        (params.complexity_floor, params.complexity_ceiling),
        (0, 100_000)
    );
    assert_eq!(params.placement_bias, 0);
    assert!(params.plan.iter().all(|directive| {
        directive.options.complexity_floor.is_none()
            && directive.options.complexity_ceiling.is_none()
            && directive.options.placement_bias.is_none()
            && directive.options.subdivision_level.is_none()
            && directive.options.morph_target.is_none()
    }));

    let mut wire = serde_json::to_value(params).expect("Dum-Ka params serialize");
    let object = wire.as_object_mut().expect("Dum-Ka params are an object");
    for key in [
        "subdivisionPalette",
        "complexityFloor",
        "complexityCeiling",
        "placementBias",
    ] {
        object.remove(key);
    }
    if let Some(plan) = object
        .get_mut("plan")
        .and_then(serde_json::Value::as_array_mut)
    {
        for directive in plan {
            if let Some(options) = directive
                .get_mut("options")
                .and_then(serde_json::Value::as_object_mut)
            {
                for key in [
                    "complexityFloor",
                    "complexityCeiling",
                    "placementBias",
                    "subdivisionLevel",
                    "morphTarget",
                ] {
                    options.remove(key);
                }
            }
        }
    }
    rhythm.generator = cseq_rhythm::GeneratorConfig::Dumka(
        serde_json::from_value(wire).expect("legacy Dum-Ka wire defaults decode"),
    );
    rhythm
}

#[test]
fn empty_depth_palette_is_byte_identical_across_legacy_golden_trajectories() {
    let cases = [
        ("default", dumka_rhythm(), 0, 8),
        ("planned", dumka_planned_rhythm(), 0, 16),
        ("smoothed", dumka_smoothed_rhythm(), 0, 5),
        ("figures", dumka_figures_rhythm(), 0, 8),
        ("euclid", dumka_euclid_rhythm(), 0, 8),
    ];
    for (name, explicit, start_cycle, cycle_count) in cases {
        let omitted = omit_depth_fields_from_legacy_wire(explicit.clone());
        let explicit_ledger = render_ledger_window_for_score(
            name,
            dumka_section_score(),
            Some(explicit),
            start_cycle,
            cycle_count,
        );
        let omitted_ledger = render_ledger_window_for_score(
            name,
            dumka_section_score(),
            Some(omitted),
            start_cycle,
            cycle_count,
        );
        assert_eq!(
            omitted_ledger.as_bytes(),
            explicit_ledger.as_bytes(),
            "omitted M3.95 fields changed the {name} legacy trajectory"
        );
    }
}

/// M3.95 working-lattice golden: the seed owns only beat-level positions,
/// while palette {3} supplies ternary slots. A curve-driven Barlow-Add path
/// must therefore produce audible attacks between integer beats without a
/// second generator or transport path.
fn dumka_palette_triplets_score() -> cseq_model::Score {
    cseq_model::Score::subdivision_switch(
        "golden-dumka-palette-triplets",
        cseq_model::SubdivisionSwitchSpec {
            cycle_beats: 4,
            initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                subdivision: 3,
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
            seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 20260813 },
            accent: cseq_model::GatiAccentSpec::default(),
            pitch: 45,
            velocity: 96,
        },
    )
}

fn dumka_palette_triplets_rhythm() -> cseq_transport::RhythmPlaybackConfig {
    use cseq_rhythm as rhythm;
    cseq_transport::RhythmPlaybackConfig {
        generator_enabled: true,
        generator: rhythm::GeneratorConfig::Dumka(rhythm::DumkaGeneratorParams {
            pattern: "x . x .".to_string(),
            subdivision_palette: vec![3],
            evolution_rate: 0,
            drift_leash: 100,
            weight_barlow_remove: 0,
            weight_barlow_add: 100,
            weight_rotate: 0,
            evolution_curve: rhythm::EvolutionCurve {
                enabled: true,
                model_version: rhythm::PerceptualModelVersion::V1,
                tolerance_milli: 0,
                max_operations: 4,
                points: vec![
                    rhythm::CurvePoint {
                        cycle: 1,
                        target_milli: 100_000,
                    },
                    rhythm::CurvePoint {
                        cycle: 2,
                        target_milli: 100_000,
                    },
                ],
            },
            seed_mode: rhythm::GeneratorSeedMode::Locked { seed: 20260813 },
            ..Default::default()
        }),
        midi_output_channel: 1,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

#[test]
fn golden_dumka_palette_triplets() {
    let rendered = render_ledger_for_score(
        "dumka_palette_triplets",
        dumka_palette_triplets_score(),
        Some(dumka_palette_triplets_rhythm()),
    );
    let has_ternary_attack = rendered.lines().any(|line| {
        let mut columns = line.split('\t');
        let tick = columns.next().and_then(|value| value.parse::<u64>().ok());
        let _channel = columns.next();
        let bytes = columns.next().unwrap_or_default();
        tick.is_some_and(|tick| tick % u64::from(cseq_transport::PPQN) != 0)
            && bytes.starts_with("90 ")
    });
    assert!(
        has_ternary_attack,
        "palette {{3}} plus the curve must audibly leave the seed's beat grid"
    );
    assert_golden_rendered("dumka_palette_triplets", rendered);
}

/// M3.95 directed-transport golden: two beat-level attacks move to the
/// complementary beats over a four-cycle eased Morph range. Palette {2}
/// makes the intermediate half-beat steps audible; the final cycle must equal
/// the authored target exactly.
fn dumka_morph_score() -> cseq_model::Score {
    cseq_model::Score::subdivision_switch(
        "golden-dumka-morph",
        cseq_model::SubdivisionSwitchSpec {
            cycle_beats: 4,
            initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                subdivision: 2,
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
            seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 20260814 },
            accent: cseq_model::GatiAccentSpec::default(),
            pitch: 45,
            velocity: 96,
        },
    )
}

fn dumka_morph_rhythm() -> cseq_transport::RhythmPlaybackConfig {
    use cseq_rhythm as rhythm;
    cseq_transport::RhythmPlaybackConfig {
        generator_enabled: true,
        generator: rhythm::GeneratorConfig::Dumka(rhythm::DumkaGeneratorParams {
            pattern: "x . x .".to_string(),
            subdivision_palette: vec![2],
            evolution_rate: 0,
            drift_leash: 0,
            plan: vec![rhythm::EvolutionDirective {
                id: 1,
                order: 0,
                enabled: true,
                from_cycle: 1,
                to_cycle: 4,
                family: rhythm::DirectiveFamily::Morph,
                pacing: rhythm::DirectivePacing::EaseInOut,
                magnitude: rhythm::DirectiveMagnitude::OperationQuota,
                intensity: 100,
                scope: None,
                options: rhythm::DirectiveOptions {
                    morph_target: Some(". x . x".to_string()),
                    ..Default::default()
                },
            }],
            seed_mode: rhythm::GeneratorSeedMode::Locked { seed: 20260814 },
            ..Default::default()
        }),
        midi_output_channel: 1,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

#[test]
fn golden_dumka_morph() {
    use cseq_rhythm as rhythm;

    let rendered = render_ledger_window_for_score(
        "dumka_morph",
        dumka_morph_score(),
        Some(dumka_morph_rhythm()),
        0,
        5,
    );
    assert_golden_rendered("dumka_morph", rendered);

    let spans = (0..4)
        .map(|index| rhythm::GeneratorSpanInput {
            span_id: index + 1,
            span_len: 2,
            label: None,
            section_index: Some(0),
            subdivision: Some(2),
        })
        .collect::<Vec<_>>();
    let rhythm::GeneratorConfig::Dumka(params) = dumka_morph_rhythm().generator else {
        unreachable!("fixture is Dum-Ka")
    };
    let resolved = rhythm::resolve_generator_cycle(
        &rhythm::GeneratorConfig::Dumka(params),
        &rhythm::GeneratorCycleContext {
            track_id: None,
            cycle: 4,
            cycle_beats: 4,
            spans: &spans,
            seed: 20260814,
            automation: &|_, _, _| None,
        },
    )
    .expect("Morph endpoint resolves");
    let final_onsets = resolved
        .iter()
        .enumerate()
        .flat_map(|(span_index, span)| {
            span.cells
                .iter()
                .filter(|cell| !cell.rest && !cell.tied_from_previous)
                .map(move |cell| span_index as u32 * 2 + cell.start)
        })
        .collect::<Vec<_>>();
    assert_eq!(
        final_onsets,
        vec![2, 6],
        "Morph endpoint must equal its target"
    );
}

/// M3.5 figures golden: the same four-beat section score, but a seed with
/// in-beat sustains and the figure pair switched on (fragment 3 /
/// consolidate 2 over remove 1 / add 1 / rotate 1, fillComplexity 50,
/// rate 60, leash 60). Pins the audible duration-structure evolution:
/// sustains split into E(k,n) figures, contiguous runs fuse back, and the
/// locked seed replays the trajectory byte-identically.
fn dumka_figures_rhythm() -> cseq_transport::RhythmPlaybackConfig {
    use cseq_rhythm as rhythm;
    cseq_transport::RhythmPlaybackConfig {
        generator_enabled: true,
        generator: rhythm::GeneratorConfig::Dumka(rhythm::DumkaGeneratorParams {
            pattern: "[dum _ _ ka] [. . ka .] [x _ x .] [x x . x]".to_string(),
            evolution_rate: 60,
            drift_leash: 60,
            fill_complexity: 50,
            weight_barlow_remove: 1,
            weight_barlow_add: 1,
            weight_rotate: 1,
            weight_syncopate: 0,
            weight_desyncopate: 0,
            weight_fragment: 3,
            weight_consolidate: 2,
            seed_mode: rhythm::GeneratorSeedMode::Locked { seed: 20260811 },
            ..Default::default()
        }),
        midi_output_channel: 1,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

#[test]
fn golden_dumka_figures() {
    assert_golden_rendered(
        "dumka_figures",
        render_ledger_for_score(
            "dumka_figures",
            dumka_section_score(),
            Some(dumka_figures_rhythm()),
        ),
    );
}

/// Euclid reshape golden: the four-beat section score with the reshape
/// family switched on (weight 5 over remove 1 / add 1, burst cap 2,
/// 20% inversion, silent rest policy, rate 60, leash 60, locked seed).
/// Pins the audible maximal-evenness drift: windows re-necklace onto
/// E(k,n) with rotation draws, occasional bursts, and the rare complement.
fn dumka_euclid_rhythm() -> cseq_transport::RhythmPlaybackConfig {
    use cseq_rhythm as rhythm;
    cseq_transport::RhythmPlaybackConfig {
        generator_enabled: true,
        generator: rhythm::GeneratorConfig::Dumka(rhythm::DumkaGeneratorParams {
            pattern: "[dum . . ka] [. . ka .] [dum . ka .] [x x . x]".to_string(),
            evolution_rate: 60,
            drift_leash: 60,
            weight_barlow_remove: 1,
            weight_barlow_add: 1,
            weight_rotate: 0,
            weight_euclid: 5,
            euclid_max_run: 2,
            euclid_invert: 20,
            euclid_rest_policy: rhythm::EuclidRestPolicy::Silent,
            seed_mode: rhythm::GeneratorSeedMode::Locked { seed: 20260812 },
            ..Default::default()
        }),
        midi_output_channel: 1,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

#[test]
fn golden_dumka_euclid_reshape() {
    assert_golden_rendered(
        "dumka_euclid_reshape",
        render_ledger_for_score(
            "dumka_euclid_reshape",
            dumka_section_score(),
            Some(dumka_euclid_rhythm()),
        ),
    );
}

/// Euclid channel strategy over the chatusra example: Partition E(3,8) on
/// channel 2 + E(2, remaining) with max-run-2 bursts on channel 3, remainder
/// on channel 1, re-anchoring per section. Pins the full two-cycle MIDI
/// ledger of the deterministic assigner end-to-end.
fn euclid_hocket_rhythm() -> cseq_transport::RhythmPlaybackConfig {
    use cseq_rhythm as rhythm;
    cseq_transport::RhythmPlaybackConfig {
        generator_enabled: false,
        generator: rhythm::GeneratorConfig::default(),
        midi_output_channel: 1,
        automation: None,
        channel_hocket_enabled: true,
        channel_hocket: Some(rhythm::ChannelHocketSpec {
            order: rhythm::MarkovOrder::First,
            channels: vec![1, 2, 3],
            transitions: vec![],
            fallback: 1,
            fallback_weights: vec![],
            entry_weights: vec![],
            seed_mode: rhythm::RhythmSeedMode::Locked { seed: 7 },
            global_seed: 7,
            accent_rules: vec![],
            position_rules: vec![],
            assign_mode: rhythm::ChannelAssignMode::Euclid,
            euclid: Some(rhythm::EuclidChannelSpec {
                placement: rhythm::EuclidPlacement::Partition,
                steps: 8,
                layers: vec![
                    rhythm::EuclidChannelLayer {
                        channel: 2,
                        pulses: 3,
                        rotation: 0,
                        max_run: 1,
                        steps: 16,
                        invert: false,
                    },
                    rhythm::EuclidChannelLayer {
                        channel: 3,
                        pulses: 2,
                        rotation: 0,
                        max_run: 2,
                        steps: 16,
                        invert: false,
                    },
                ],
                reset: rhythm::EuclidResetScope::Section,
                span_accent_mode: rhythm::EuclidSpanAccentMode::Woven,
                span_accent_channel: None,
            }),
        }),
        seed_path: None,
    }
}

#[test]
fn golden_euclid_hocket_chatusra() {
    assert_golden_rendered(
        "euclid_hocket_chatusra",
        render_ledger_with_rhythm(
            "euclid_hocket_chatusra",
            "chatusra",
            Some(euclid_hocket_rhythm()),
        ),
    );
}
