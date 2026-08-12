use cseq_model::*;
use std::collections::HashMap;

fn make_subdivided_score(id: &str, name: &str, pitches: &[u8], policy: SubdivisionPolicy) -> Score {
    let cycle = Rational::new(1, 1);
    let accent_tree = AccentTree::single_accent(1.0);

    let mut nodes = HashMap::new();
    let mut children = Vec::new();

    for (i, &pitch) in pitches.iter().enumerate() {
        let node_id = (i + 1) as NodeId;
        children.push(node_id);
        nodes.insert(
            node_id,
            DurationNode {
                id: node_id,
                parent: Some(0),
                duration: Rational::new(1, pitches.len() as i64),
                accent_ref: Some(0),
                kind: DurationKind::Pulse(PulseData {
                    event: PulseEvent::Note {
                        pitch: ValueSpec::fixed(pitch),
                        duration_frac: Rational::new(1, 1),
                    },
                    velocity: ValueSpec::fixed(100),
                }),
                metadata: NodeMetadata::default(),
            },
        );
    }

    nodes.insert(
        0,
        DurationNode {
            id: 0,
            parent: None,
            duration: Rational::new(1, 1),
            accent_ref: None,
            kind: DurationKind::Subdivided { children, policy },
            metadata: NodeMetadata::default(),
        },
    );

    let duration_tree = DurationTree {
        root: 0,
        nodes,
        next_id: (pitches.len() + 1) as NodeId,
        pulse_spans: vec![],
        next_pulse_span_id: 0,
    };

    Score {
        id: id.to_string(),
        name: name.to_string(),
        duration_tree,
        accent_tree,
        cycle_length: cycle,
        default_gati: 4,
        default_jathi: 4,
        pipeline: vec![],
        next_transform_id: 0,
        metadata: ScoreMetadata::default(),
        schema_version: SCHEMA_VERSION,
    }
}

fn make_fixed_pattern_score(id: &str, beats: &[(u32, &[u32], u8, u8)]) -> Score {
    let cycle = Rational::new(beats.len() as i64, 1);
    let accent_tree = AccentTree::single_accent(1.0);
    let mut nodes = HashMap::new();
    let mut beat_ids = Vec::new();
    let mut next_id = 1_u64;

    for (steps, onsets, pitch, velocity) in beats {
        let beat_id = next_id;
        next_id += 1;
        beat_ids.push(beat_id);
        let mut step_ids = Vec::new();
        for index in 0..*steps {
            let step_id = next_id;
            next_id += 1;
            step_ids.push(step_id);
            let event = if onsets.contains(&index) {
                PulseEvent::Note {
                    pitch: ValueSpec::fixed(*pitch),
                    duration_frac: Rational::new(1, 1),
                }
            } else {
                PulseEvent::Rest
            };
            nodes.insert(
                step_id,
                DurationNode {
                    id: step_id,
                    parent: Some(beat_id),
                    duration: Rational::new(1, i64::from(*steps)),
                    accent_ref: Some(0),
                    kind: DurationKind::Pulse(PulseData {
                        event,
                        velocity: ValueSpec::fixed(*velocity),
                    }),
                    metadata: NodeMetadata::default(),
                },
            );
        }
        nodes.insert(
            beat_id,
            DurationNode {
                id: beat_id,
                parent: Some(0),
                duration: Rational::new(1, 1),
                accent_ref: None,
                kind: DurationKind::Subdivided {
                    children: step_ids,
                    policy: SubdivisionPolicy::Equal,
                },
                metadata: NodeMetadata::default(),
            },
        );
    }

    nodes.insert(
        0,
        DurationNode {
            id: 0,
            parent: None,
            duration: Rational::new(1, 1),
            accent_ref: None,
            kind: DurationKind::Subdivided {
                children: beat_ids,
                policy: SubdivisionPolicy::Equal,
            },
            metadata: NodeMetadata::default(),
        },
    );

    Score {
        id: id.to_string(),
        name: id.to_string(),
        duration_tree: DurationTree {
            root: 0,
            nodes,
            next_id,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        },
        accent_tree,
        cycle_length: cycle,
        default_gati: beats.first().map_or(4, |beat| beat.0),
        default_jathi: 4,
        pipeline: vec![],
        next_transform_id: 0,
        metadata: ScoreMetadata::default(),
        schema_version: SCHEMA_VERSION,
    }
}

fn sample_score_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("examples")
        .join("scores")
}

fn sample_scores() -> Vec<(&'static str, Score)> {
    vec![
        (
            "tisra.json",
            make_subdivided_score(
                "tisra",
                "Tisra (3)",
                &[60, 62, 64],
                SubdivisionPolicy::Equal,
            ),
        ),
        (
            "chatusra.json",
            make_subdivided_score(
                "chatusra",
                "Chatusra (4)",
                &[60, 62, 64, 65],
                SubdivisionPolicy::Equal,
            ),
        ),
        (
            "khanda_chapu.json",
            make_subdivided_score(
                "khanda_chapu",
                "Khanda Chapu (2+1+2)",
                &[60, 62, 64],
                SubdivisionPolicy::Weighted(vec![2, 1, 2]),
            ),
        ),
        (
            "euclid_3_8.json",
            make_fixed_pattern_score("euclid_3_8", &[(8, &[0, 3, 6], 60, 100)]),
        ),
        (
            "beat_cycle_demo.json",
            make_fixed_pattern_score(
                "beat_cycle_demo",
                &[
                    (4, &[0, 2, 3], 60, 104),
                    (3, &[0, 1], 62, 96),
                    (5, &[0, 3], 65, 104),
                    (7, &[0, 2, 5], 67, 96),
                ],
            ),
        ),
        (
            "switch_cycle_demo.json",
            Score::subdivision_switch(
                "switch_cycle_demo",
                SubdivisionSwitchSpec {
                    cycle_beats: 8,
                    initial_weights: vec![WeightedSubdivisionChoice {
                        subdivision: 4,
                        weight: 1.0,
                    }],
                    initial_jathi_weights: vec![],
                    initial_custom_subdivision: None,
                    automation: None,
                    inflections: (1..8)
                        .map(|i| SubdivisionInflection {
                            id: Some(format!("boundary-{i}")),
                            position: Rational::new(i, 8),
                            change_probability: 1.0,
                            subdivision_weights: vec![WeightedSubdivisionChoice {
                                subdivision: [3, 4, 5, 7][(i - 1) as usize % 4],
                                weight: 1.0,
                            }],
                            jathi_weights: vec![],
                            custom_subdivision: None,
                        })
                        .collect(),
                    switch_count_weights: vec![WeightedSwitchCount {
                        count: 7,
                        weight: 1.0,
                    }],
                    seed_mode: SwitchSeedMode::Locked { seed: 20260505 },
                    accent: cseq_model::GatiAccentSpec::default(),
                    pitch: 60,
                    velocity: 96,
                },
            ),
        ),
    ]
}

#[test]
fn sample_scores_match_checked_in_fixtures() {
    let base = sample_score_dir();

    for (filename, score) in sample_scores() {
        let fixture_path = base.join(filename);
        let fixture_json = std::fs::read_to_string(&fixture_path)
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", fixture_path.display()));
        let fixture_score: Score = serde_json::from_str(&fixture_json)
            .unwrap_or_else(|error| panic!("failed to parse {}: {error}", fixture_path.display()));
        let fixture_value = serde_json::to_value(fixture_score).expect("fixture value");
        let expected_value = serde_json::to_value(score).expect("score value");

        assert_eq!(
            fixture_value,
            expected_value,
            "{} is stale; run `cargo test -p cseq-model --test gen_scores -- --ignored` to regenerate",
            fixture_path.display()
        );
    }
}

#[test]
#[ignore]
fn regenerate_sample_scores() {
    let base = sample_score_dir();
    std::fs::create_dir_all(&base).unwrap();

    for (filename, score) in sample_scores() {
        let json = serde_json::to_string_pretty(&score).unwrap();
        std::fs::write(base.join(filename), format!("{json}\n")).unwrap();
    }
}
