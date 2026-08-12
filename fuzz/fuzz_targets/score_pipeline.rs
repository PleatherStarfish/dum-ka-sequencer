#![no_main]

use cseq_model::{NodeSelector, Score, SubdivisionPolicy, Transform, TransformKind};
use libfuzzer_sys::fuzz_target;

const MAX_JSON_BYTES: usize = 64 * 1024;
const MAX_INITIAL_NODES: usize = 256;
const MAX_PIPELINE_TRANSFORMS: usize = 8;
const MAX_TREE_NODES_AFTER_PIPELINE: usize = 20_000;
const MAX_EXPANSION_COUNT: u32 = 8;
const MAX_VECTOR_LEN: usize = 128;
const FUZZ_CYCLES: std::ops::Range<u64> = 0..4;

fuzz_target!(|data: &[u8]| {
    if data.len() > MAX_JSON_BYTES {
        return;
    }

    let Ok(json) = std::str::from_utf8(data) else {
        return;
    };
    let Ok(score) = cseq_persist::load_from_str(json) else {
        return;
    };
    if !score_is_bounded(&score) {
        return;
    }

    for cycle in FUZZ_CYCLES {
        let mut score = score.clone();
        let Ok(tree) = cseq_transforms::apply_pipeline_for_cycle_mut(&mut score, cycle) else {
            continue;
        };
        if tree.nodes.len() > MAX_TREE_NODES_AFTER_PIPELINE {
            return;
        }
    }
});

fn score_is_bounded(score: &Score) -> bool {
    score.duration_tree.nodes.len() <= MAX_INITIAL_NODES
        && score.accent_tree.nodes.len() <= MAX_VECTOR_LEN
        && score.duration_tree.pulse_spans.len() <= MAX_VECTOR_LEN
        && score.pipeline.len() <= MAX_PIPELINE_TRANSFORMS
        && score.pipeline.iter().all(transform_is_bounded)
}

fn transform_is_bounded(transform: &Transform) -> bool {
    selector_is_bounded(&transform.target)
        && match &transform.kind {
            TransformKind::Subdivide { policy, count } => {
                *count <= MAX_EXPANSION_COUNT && subdivision_policy_is_bounded(policy, *count)
            }
            TransformKind::SubdivisionSwitch {
                initial_weights,
                initial_jathi_weights,
                automation,
                inflections,
                switch_count_weights,
                ..
            } => {
                initial_weights.len() <= MAX_VECTOR_LEN
                    && initial_jathi_weights.len() <= MAX_VECTOR_LEN
                    && inflections.len() <= MAX_VECTOR_LEN
                    && switch_count_weights.len() <= MAX_VECTOR_LEN
                    && automation
                        .as_deref()
                        .map(|automation| {
                            automation.tracks.len() <= 32
                                && automation.markers.len() <= MAX_VECTOR_LEN
                                && automation.tracks.iter().all(|track| {
                                    track.curves.len() <= 16
                                        && track
                                            .curves
                                            .iter()
                                            .all(|curve| curve.points.len() <= MAX_VECTOR_LEN)
                                })
                        })
                        .unwrap_or(true)
            }
            TransformKind::SetVelocity { .. }
            | TransformKind::Tie { .. }
            | TransformKind::RemoveNode => true,
        }
}

fn selector_is_bounded(selector: &NodeSelector) -> bool {
    match selector {
        NodeSelector::Root | NodeSelector::ById { .. } | NodeSelector::ByAccentRef { .. } => true,
        NodeSelector::ByPath { path } => path.len() <= 32,
        NodeSelector::ByTag { tag } => tag.len() <= 128,
    }
}

fn subdivision_policy_is_bounded(policy: &SubdivisionPolicy, child_count: u32) -> bool {
    match policy {
        SubdivisionPolicy::Equal | SubdivisionPolicy::Explicit => true,
        SubdivisionPolicy::Weighted(weights) => {
            weights.len() == child_count as usize && weights.len() <= MAX_VECTOR_LEN
        }
    }
}
