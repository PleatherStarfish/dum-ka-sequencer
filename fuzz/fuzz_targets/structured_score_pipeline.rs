#![no_main]

use std::collections::HashSet;

use arbitrary::Unstructured;
use cseq_model::{
    DurationKind, DurationTree, GatiAccentSpec, JathiAccentMode, NodeSelector, Rational, Score,
    SubdivisionInflection, SubdivisionPolicy, SubdivisionSwitchSpec, SwitchSeedMode, TiePattern,
    TransformKind, ValueSpec, VelocityAccentRange, WeightedJathiChoice, WeightedSubdivisionChoice,
    WeightedSwitchCount, SCHEMA_VERSION,
};
use libfuzzer_sys::fuzz_target;

mod common;

const MAX_INPUT_BYTES: usize = 4096;
const MAX_TREE_NODES: usize = 40_000;
const FUZZ_CYCLES: std::ops::Range<u64> = 0..6;

fuzz_target!(|data: &[u8]| {
    if data.len() > MAX_INPUT_BYTES {
        return;
    }

    let mut u = Unstructured::new(data);
    let score = build_score(&mut u);
    run_score(score);
});

fn build_score(u: &mut Unstructured<'_>) -> Score {
    let pitch = common::midi(u, 36, 96);
    let velocity = common::midi(u, 1, 127);

    let mut score = match common::index(u, 3) {
        0 => Score::single_pulse("structured-single", pitch, velocity),
        1 => {
            let count = common::small_usize(u, 1, 8);
            let pitches = (0..count)
                .map(|i| pitch.saturating_add(i as u8).min(127))
                .collect::<Vec<_>>();
            Score::subdivided(
                "structured-subdivided",
                &pitches,
                velocity,
                subdivision_policy(u, count),
            )
        }
        _ => Score::subdivision_switch("structured-switch", subdivision_switch_spec(u)),
    };

    if common::boolish(u) {
        score.add_transform(
            TransformKind::SetVelocity {
                velocity: ValueSpec::fixed(common::midi(u, 1, 127)),
            },
            NodeSelector::ByAccentRef { accent_id: 0 },
            Some("fuzz set velocity".to_string()),
        );
    }

    let child_index = common::small_usize(u, 0, 7);
    match common::index(u, 4) {
        0 => {
            let count = common::small_u32(u, 1, 8);
            score.add_transform(
                TransformKind::Subdivide {
                    policy: subdivision_policy(u, count as usize),
                    count,
                },
                NodeSelector::ByPath {
                    path: vec![child_index],
                },
                Some("fuzz child subdivide".to_string()),
            );
        }
        1 => {
            score.add_transform(
                TransformKind::Tie {
                    pattern: if common::boolish(u) {
                        TiePattern::All
                    } else {
                        TiePattern::Pairs
                    },
                },
                NodeSelector::Root,
                Some("fuzz tie".to_string()),
            );
        }
        2 => {
            score.add_transform(
                TransformKind::RemoveNode,
                NodeSelector::ByPath {
                    path: vec![child_index],
                },
                Some("fuzz remove child".to_string()),
            );
        }
        _ => {}
    }

    score
}

fn subdivision_policy(u: &mut Unstructured<'_>, count: usize) -> SubdivisionPolicy {
    match common::index(u, 3) {
        0 => SubdivisionPolicy::Equal,
        1 => SubdivisionPolicy::Explicit,
        _ => SubdivisionPolicy::Weighted(
            (0..count)
                .map(|_| common::positive_weight(u).min(16))
                .collect(),
        ),
    }
}

fn subdivision_switch_spec(u: &mut Unstructured<'_>) -> SubdivisionSwitchSpec {
    let cycle_beats = common::small_u32(u, 1, 8);
    let mut positions = (1..cycle_beats).collect::<Vec<_>>();
    let keep = common::small_usize(u, 0, positions.len());
    positions.truncate(keep);

    let inflections = positions
        .into_iter()
        .map(|beat| SubdivisionInflection {
            id: None,
            position: Rational::new(beat as i64, cycle_beats as i64),
            change_probability: common::unit_f32(u),
            subdivision_weights: gati_weights(u),
            jathi_weights: jathi_weights(u),
            custom_subdivision: common::boolish(u).then(|| common::custom_subdivision(u)),
        })
        .collect::<Vec<_>>();

    let switch_count_weights = if inflections.is_empty() || common::boolish(u) {
        vec![]
    } else {
        let max_count = inflections.len() as u32;
        (0..=max_count)
            .map(|count| WeightedSwitchCount {
                count,
                weight: if count == 0 {
                    common::unit_f32(u).max(0.001)
                } else {
                    common::unit_f32(u)
                },
            })
            .collect()
    };

    SubdivisionSwitchSpec {
        cycle_beats,
        initial_weights: gati_weights(u),
        initial_jathi_weights: jathi_weights(u),
        initial_custom_subdivision: common::boolish(u).then(|| common::custom_subdivision(u)),
        automation: None,
        inflections,
        switch_count_weights,
        seed_mode: seed_mode(u),
        accent: GatiAccentSpec {
            beat_start: accent_range(u),
            section_start_extra: accent_range(u),
            jathi_start: accent_range(u),
            jathi_mode: if common::boolish(u) {
                JathiAccentMode::OverrideGati
            } else {
                JathiAccentMode::Layered
            },
        },
        pitch: common::midi(u, 36, 96),
        velocity: common::midi(u, 1, 112),
    }
}

fn gati_weights(u: &mut Unstructured<'_>) -> Vec<WeightedSubdivisionChoice> {
    let gatis = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 16];
    let count = common::small_usize(u, 1, 5);
    (0..count)
        .map(|_| WeightedSubdivisionChoice {
            subdivision: common::pick_copy(u, &gatis),
            weight: common::unit_f32(u).max(0.001),
        })
        .collect()
}

fn jathi_weights(u: &mut Unstructured<'_>) -> Vec<WeightedJathiChoice> {
    let count = common::small_usize(u, 0, 4);
    let jathis = [3, 4, 5, 6, 7, 9, 11];
    (0..count)
        .map(|_| WeightedJathiChoice {
            jathi: common::pick_copy(u, &jathis),
            weight: common::unit_f32(u),
        })
        .collect()
}

fn accent_range(u: &mut Unstructured<'_>) -> VelocityAccentRange {
    let a = common::midi(u, 0, 64);
    let b = common::midi(u, 0, 64);
    VelocityAccentRange {
        min: a.min(b),
        max: a.max(b),
    }
}

fn seed_mode(u: &mut Unstructured<'_>) -> SwitchSeedMode {
    match common::index(u, 3) {
        0 => SwitchSeedMode::Locked {
            seed: common::small_u64(u, 0, u64::MAX),
        },
        1 => SwitchSeedMode::PerCycle {
            seed: common::small_u64(u, 0, u64::MAX),
        },
        _ => SwitchSeedMode::History {
            seed: common::small_u64(u, 0, u64::MAX),
            history: vec![],
            history_weight: common::unit_f32(u),
            new_seed_weight: common::unit_f32(u).max(0.001),
            max_history: common::small_usize(u, 1, 8),
        },
    }
}

fn run_score(score: Score) {
    let Ok(json) = serde_json::to_string(&score) else {
        return;
    };
    let Ok(loaded) = cseq_persist::load_from_str(&json) else {
        return;
    };
    assert_eq!(loaded.schema_version, SCHEMA_VERSION);

    for cycle in FUZZ_CYCLES {
        let mut cycle_score = loaded.clone();
        let Ok((tree, trace)) =
            cseq_transforms::apply_pipeline_for_cycle_mut_with_seed_trace(&mut cycle_score, cycle)
        else {
            continue;
        };
        if tree.nodes.len() > MAX_TREE_NODES {
            return;
        }
        assert_tree_invariants(&tree);

        let mut realized_score = loaded.clone();
        realized_score.duration_tree = tree;
        realized_score.pipeline.clear();
        let Ok(realized) = cseq_realize::realize(&realized_score, cycle, cycle) else {
            continue;
        };
        assert_events_are_ordered_and_bounded(&realized.events, realized_score.cycle_length);

        if !trace.is_empty() {
            let replay = trace
                .iter()
                .map(|entry| cseq_transforms::SwitchSeedReplay {
                    seed: entry.seed,
                    source: entry.source,
                    history_before: entry.history_before.clone(),
                    history_after: entry.history_after.clone(),
                })
                .collect::<Vec<_>>();
            let mut replay_score = loaded.clone();
            let Ok((replayed_tree, replayed_trace)) =
                cseq_transforms::apply_pipeline_for_cycle_mut_with_seed_trace_and_replay(
                    &mut replay_score,
                    cycle,
                    &replay,
                )
            else {
                continue;
            };
            assert_eq!(replayed_trace.len(), trace.len());
            assert_eq!(
                replayed_tree.nodes.len(),
                realized_score.duration_tree.nodes.len()
            );
        }
    }
}

fn assert_tree_invariants(tree: &DurationTree) {
    assert!(tree.nodes.contains_key(&tree.root));

    let mut visited = HashSet::new();
    visit_tree(tree, tree.root, &mut visited);

    for node in tree.nodes.values() {
        assert!(node.duration > Rational::new(0, 1));
        if let Some(parent) = node.parent {
            assert!(tree.nodes.contains_key(&parent));
        }
        match &node.kind {
            DurationKind::Subdivided { children, policy } => {
                assert!(!children.is_empty());
                assert!(children.iter().all(|id| tree.nodes.contains_key(id)));
                if let SubdivisionPolicy::Weighted(weights) = policy {
                    assert_eq!(weights.len(), children.len());
                    assert!(weights.iter().all(|weight| *weight > 0));
                }
            }
            DurationKind::Tied { children } => {
                assert!(!children.is_empty());
                assert!(children.iter().all(|id| tree.nodes.contains_key(id)));
            }
            _ => {}
        }
    }
}

fn visit_tree(tree: &DurationTree, node_id: u64, visited: &mut HashSet<u64>) {
    assert!(visited.insert(node_id), "duration tree contains a cycle");
    let Some(node) = tree.nodes.get(&node_id) else {
        panic!("duration tree references missing node {node_id}");
    };
    let children = match &node.kind {
        DurationKind::Subdivided { children, .. } | DurationKind::Tied { children } => children,
        _ => return,
    };
    for child in children {
        visit_tree(tree, *child, visited);
    }
}

fn assert_events_are_ordered_and_bounded(
    events: &[cseq_realize::ScheduledEvent],
    cycle_length: Rational,
) {
    let zero = Rational::new(0, 1);
    for window in events.windows(2) {
        assert!(window[0].offset <= window[1].offset);
    }
    for event in events {
        assert!(event.offset >= zero);
        assert!(event.offset <= cycle_length);
        match event.kind {
            cseq_realize::EventKind::NoteOn {
                pitch, velocity, ..
            } => {
                assert!(pitch <= 127);
                assert!((1..=127).contains(&velocity));
            }
            cseq_realize::EventKind::NoteOff { pitch, .. } => assert!(pitch <= 127),
            cseq_realize::EventKind::Cc {
                controller, value, ..
            } => {
                assert!(controller <= 127);
                assert!(value <= 127);
            }
        }
    }
}
