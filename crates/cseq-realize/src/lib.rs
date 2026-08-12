//! Deterministic and stochastic realization of Scores into concrete event lists.
//!
//! M2: deterministic realization (Pulse, Subdivided, Tied).
//! M5: stochastic operators (Choice, Euclidean, probabilistic ValueSpecs).

use cseq_model::{
    AccentTree, DurationKind, DurationTree, NodeId, PulseEvent, Rational, Score, ScoreId,
    SubdivisionPolicy,
};
use serde::Serialize;
use thiserror::Error;
use tracing::debug;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

pub type CycleNumber = u64;
pub type Seed = u64;

#[derive(Debug, Clone, Serialize)]
pub struct Realization {
    pub cycle: CycleNumber,
    pub seed: Seed,
    pub events: Vec<ScheduledEvent>,
    pub cycle_length_ticks: u64,
    pub source_score: ScoreId,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScheduledEvent {
    pub offset: Rational,
    pub kind: EventKind,
    pub source_node: NodeId,
    pub accent_strength: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EventKind {
    NoteOn {
        channel: u8,
        pitch: u8,
        velocity: u8,
    },
    NoteOff {
        channel: u8,
        pitch: u8,
    },
    Cc {
        channel: u8,
        controller: u8,
        value: u8,
    },
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum RealizeError {
    #[error("stochastic node {node_id} in deterministic mode (kind: {kind})")]
    StochasticNodeInDeterministicMode { node_id: NodeId, kind: String },

    #[error("node {0} not found in duration tree")]
    NodeNotFound(NodeId),

    #[error("subdivision policy mismatch: {0}")]
    SubdivisionMismatch(String),

    #[error("ValueSpec is not Fixed: node {node_id}, field {field}")]
    NonFixedValue { node_id: NodeId, field: String },
}

// ---------------------------------------------------------------------------
// Realize
// ---------------------------------------------------------------------------

/// Realize a Score into a concrete event list for a given cycle.
///
/// For M2, only deterministic node kinds are supported (Pulse, Subdivided, Tied).
/// Stochastic nodes (Choice, Euclidean, non-Fixed ValueSpecs) return an error.
/// `master_seed` is accepted but unused until M5.
pub fn realize(
    score: &Score,
    cycle: CycleNumber,
    master_seed: Seed,
) -> Result<Realization, RealizeError> {
    let mut events = Vec::new();
    let offset = Rational::new(0, 1);
    let root = score
        .duration_tree
        .get(score.duration_tree.root)
        .ok_or(RealizeError::NodeNotFound(score.duration_tree.root))?;
    let root_duration = score.cycle_length * root.duration;

    realize_node(
        &score.duration_tree,
        &score.accent_tree,
        score.duration_tree.root,
        offset,
        root_duration,
        false, // not inside a tie
        &mut events,
    )?;

    // Sort by offset. Ties: note-offs before note-ons at same offset.
    events.sort_by(|a, b| {
        a.offset.cmp(&b.offset).then_with(|| {
            let a_ord = event_sort_order(&a.kind);
            let b_ord = event_sort_order(&b.kind);
            a_ord.cmp(&b_ord)
        })
    });

    debug!(
        cycle,
        events = events.len(),
        "realized score '{}'",
        score.name
    );

    Ok(Realization {
        cycle,
        seed: master_seed,
        events,
        cycle_length_ticks: 0, // caller computes from PPQN
        source_score: score.id.clone(),
    })
}

/// NoteOff = 0, NoteOn = 1, CC = 2. This ensures note-offs sort before note-ons.
fn event_sort_order(kind: &EventKind) -> u8 {
    match kind {
        EventKind::NoteOff { .. } => 0,
        EventKind::NoteOn { .. } => 1,
        EventKind::Cc { .. } => 2,
    }
}

fn realize_node(
    tree: &DurationTree,
    accent_tree: &AccentTree,
    node_id: NodeId,
    offset: Rational,
    node_duration: Rational,
    suppress_note_on: bool,
    events: &mut Vec<ScheduledEvent>,
) -> Result<(), RealizeError> {
    let node = tree
        .get(node_id)
        .ok_or(RealizeError::NodeNotFound(node_id))?;

    match &node.kind {
        DurationKind::Pulse(pulse_data) => {
            let accent_strength = node
                .accent_ref
                .map(|id| accent_tree.resolve_strength(id))
                .unwrap_or(1.0);

            match &pulse_data.event {
                PulseEvent::Note {
                    pitch,
                    duration_frac,
                } => {
                    let pitch_val = require_fixed(pitch, node_id, "pitch")?;
                    let velocity_val = require_fixed(&pulse_data.velocity, node_id, "velocity")?;
                    let note_duration = node_duration * *duration_frac;

                    if !suppress_note_on {
                        events.push(ScheduledEvent {
                            offset,
                            kind: EventKind::NoteOn {
                                channel: 0,
                                pitch: pitch_val,
                                velocity: velocity_val,
                            },
                            source_node: node_id,
                            accent_strength,
                        });
                    }

                    events.push(ScheduledEvent {
                        offset: offset + note_duration,
                        kind: EventKind::NoteOff {
                            channel: 0,
                            pitch: pitch_val,
                        },
                        source_node: node_id,
                        accent_strength,
                    });
                }
                PulseEvent::Rest => {
                    // Rests produce no events but consume time.
                }
                PulseEvent::Cc { controller, value } => {
                    let value_val = require_fixed(value, node_id, "cc_value")?;
                    events.push(ScheduledEvent {
                        offset,
                        kind: EventKind::Cc {
                            channel: 0,
                            controller: *controller,
                            value: value_val,
                        },
                        source_node: node_id,
                        accent_strength: 1.0,
                    });
                }
            }

            Ok(())
        }

        DurationKind::Subdivided { children, policy } => {
            let child_durations =
                compute_child_durations(tree, children, node_duration, policy, node_id)?;

            let mut child_offset = offset;
            for (i, &child_id) in children.iter().enumerate() {
                realize_node(
                    tree,
                    accent_tree,
                    child_id,
                    child_offset,
                    child_durations[i],
                    false,
                    events,
                )?;
                child_offset += child_durations[i];
            }
            Ok(())
        }

        DurationKind::Tied { children } => {
            // Tied: only the first child emits a note-on. The note-off lands
            // at the end of the full tied span. Intermediate note-offs are
            // suppressed entirely — we realize the first child for its note-on,
            // then compute the total duration for the final note-off.
            if children.is_empty() {
                return Ok(());
            }

            if node_duration <= Rational::new(0, 1) {
                return Err(RealizeError::SubdivisionMismatch(format!(
                    "node {node_id}: tied span duration must be positive"
                )));
            }
            let child_durations =
                compute_tied_child_durations(tree, children, node_duration, node_id)?;

            // Realize only the first child (for its note-on).
            let event_start = events.len();
            realize_node(
                tree,
                accent_tree,
                children[0],
                offset,
                child_durations[0],
                false,
                events,
            )?;

            // Remove only the first child's own note-off from the events it
            // just generated. Do not retain-filter the whole event list: an
            // earlier same-pitch note elsewhere in the cycle must keep its
            // note-off.
            let mut generated = events.split_off(event_start);
            let tie_pitch = generated.iter().find_map(|event| match &event.kind {
                EventKind::NoteOn { pitch, .. } => Some(*pitch),
                _ => None,
            });

            if let Some(pitch) = tie_pitch {
                generated.retain(
                    |e| !matches!(&e.kind, EventKind::NoteOff { pitch: p, .. } if *p == pitch),
                );
                events.extend(generated);

                // Place note-off at the end of the full tied span.
                let first_child = tree.get(children[0]);
                let accent_strength = first_child
                    .and_then(|n| n.accent_ref)
                    .map(|id| accent_tree.resolve_strength(id))
                    .unwrap_or(1.0);

                events.push(ScheduledEvent {
                    offset: offset + node_duration,
                    kind: EventKind::NoteOff { channel: 0, pitch },
                    source_node: children[0],
                    accent_strength,
                });
            } else {
                events.extend(generated);
            }

            Ok(())
        }

        DurationKind::Trigger { .. } => {
            // Trigger nodes exist in the model but are ignored until v2.
            Ok(())
        }
    }
}

fn compute_child_durations(
    tree: &DurationTree,
    children: &[NodeId],
    node_duration: Rational,
    policy: &SubdivisionPolicy,
    parent_id: NodeId,
) -> Result<Vec<Rational>, RealizeError> {
    match policy {
        SubdivisionPolicy::Equal => {
            if children.is_empty() {
                return Err(RealizeError::SubdivisionMismatch(format!(
                    "node {parent_id}: equal subdivision has no children"
                )));
            }
            let n = children.len() as i64;
            let child_dur = node_duration / Rational::from(n);
            Ok(vec![child_dur; children.len()])
        }
        SubdivisionPolicy::Weighted(weights) => {
            if weights.len() != children.len() {
                return Err(RealizeError::SubdivisionMismatch(format!(
                    "node {parent_id}: {} weights for {} children",
                    weights.len(),
                    children.len()
                )));
            }
            if let Some(index) = weights.iter().position(|weight| *weight == 0) {
                return Err(RealizeError::SubdivisionMismatch(format!(
                    "node {parent_id}: weighted child {} has zero duration",
                    index + 1
                )));
            }
            let total = weights.iter().map(|weight| u64::from(*weight)).sum::<u64>();
            if total == 0 {
                return Err(RealizeError::SubdivisionMismatch(format!(
                    "node {parent_id}: weighted subdivision total must be positive"
                )));
            }
            Ok(weights
                .iter()
                .map(|&w| node_duration * Rational::new(i64::from(w), total as i64))
                .collect())
        }
        SubdivisionPolicy::Explicit => {
            // Each child's duration field is used directly.
            let durations = children
                .iter()
                .map(|&id| {
                    tree.get(id)
                        .map(|n| n.duration * node_duration)
                        .ok_or(RealizeError::NodeNotFound(id))
                })
                .collect::<Result<Vec<_>, _>>()?;
            if durations.is_empty() {
                return Err(RealizeError::SubdivisionMismatch(format!(
                    "node {parent_id}: explicit subdivision has no children"
                )));
            }
            if let Some(index) = durations
                .iter()
                .position(|duration| *duration <= Rational::new(0, 1))
            {
                return Err(RealizeError::SubdivisionMismatch(format!(
                    "node {parent_id}: explicit child {} has non-positive duration",
                    index + 1
                )));
            }
            let sum = durations.iter().copied().sum::<Rational>();
            if sum != node_duration {
                return Err(RealizeError::SubdivisionMismatch(format!(
                    "node {parent_id}: explicit child durations sum to {sum}, expected {node_duration}"
                )));
            }
            Ok(durations)
        }
    }
}

fn compute_tied_child_durations(
    tree: &DurationTree,
    children: &[NodeId],
    node_duration: Rational,
    parent_id: NodeId,
) -> Result<Vec<Rational>, RealizeError> {
    compute_child_durations(
        tree,
        children,
        node_duration,
        &SubdivisionPolicy::Explicit,
        parent_id,
    )
}

fn require_fixed<T: Clone + serde::Serialize + serde::de::DeserializeOwned>(
    spec: &cseq_model::ValueSpec<T>,
    node_id: NodeId,
    field: &str,
) -> Result<T, RealizeError> {
    spec.as_fixed()
        .cloned()
        .ok_or_else(|| RealizeError::NonFixedValue {
            node_id,
            field: field.to_string(),
        })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use cseq_model::*;
    use std::collections::HashMap;

    fn accent_tree_default() -> AccentTree {
        AccentTree::single_accent(1.0)
    }

    fn make_pulse_node(
        id: NodeId,
        parent: Option<NodeId>,
        duration: Rational,
        pitch: u8,
        velocity: u8,
    ) -> DurationNode {
        DurationNode {
            id,
            parent,
            duration,
            accent_ref: Some(0),
            kind: DurationKind::Pulse(PulseData {
                event: PulseEvent::Note {
                    pitch: ValueSpec::fixed(pitch),
                    duration_frac: Rational::new(1, 1),
                },
                velocity: ValueSpec::fixed(velocity),
            }),
            metadata: NodeMetadata::default(),
        }
    }

    fn make_score(duration_tree: DurationTree) -> Score {
        Score {
            id: "test".to_string(),
            name: "test".to_string(),
            duration_tree,
            accent_tree: accent_tree_default(),
            cycle_length: Rational::new(1, 1),
            default_gati: 4,
            default_jathi: 4,
            pipeline: vec![],
            next_transform_id: 0,
            metadata: ScoreMetadata::default(),
            schema_version: SCHEMA_VERSION,
        }
    }

    #[test]
    fn single_pulse_realization() {
        let tree = DurationTree::single_pulse(Rational::new(1, 1));
        let score = make_score(tree);
        let result = realize(&score, 0, 0).unwrap();

        assert_eq!(result.events.len(), 2); // NoteOn + NoteOff
        assert!(matches!(
            result.events[0].kind,
            EventKind::NoteOn {
                pitch: 60,
                velocity: 100,
                ..
            }
        ));
        assert!(matches!(
            result.events[1].kind,
            EventKind::NoteOff { pitch: 60, .. }
        ));
        assert_eq!(result.events[0].offset, Rational::new(0, 1));
        assert_eq!(result.events[1].offset, Rational::new(1, 1));
    }

    #[test]
    fn equal_subdivision_of_4() {
        let mut nodes = HashMap::new();
        let children: Vec<NodeId> = (1..=4).collect();

        for (i, &id) in children.iter().enumerate() {
            nodes.insert(
                id,
                make_pulse_node(id, Some(0), Rational::new(1, 4), 60 + i as u8, 100),
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
                    children: children.clone(),
                    policy: SubdivisionPolicy::Equal,
                },
                metadata: NodeMetadata::default(),
            },
        );

        let tree = DurationTree {
            root: 0,
            nodes,
            next_id: 5,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };
        let score = make_score(tree);
        let result = realize(&score, 0, 0).unwrap();

        // 4 notes * 2 events (on+off) = 8 events
        assert_eq!(result.events.len(), 8);

        // Check note-on offsets: 0, 1/4, 2/4, 3/4
        let note_ons: Vec<_> = result
            .events
            .iter()
            .filter(|e| matches!(e.kind, EventKind::NoteOn { .. }))
            .collect();
        assert_eq!(note_ons.len(), 4);
        assert_eq!(note_ons[0].offset, Rational::new(0, 1));
        assert_eq!(note_ons[1].offset, Rational::new(1, 4));
        assert_eq!(note_ons[2].offset, Rational::new(1, 2));
        assert_eq!(note_ons[3].offset, Rational::new(3, 4));
    }

    #[test]
    fn weighted_subdivision_3_3_2() {
        let mut nodes = HashMap::new();
        let children: Vec<NodeId> = vec![1, 2, 3];
        let pitches = [60, 62, 64];

        for (i, &id) in children.iter().enumerate() {
            nodes.insert(
                id,
                make_pulse_node(
                    id,
                    Some(0),
                    Rational::new(1, 3), // ignored by Weighted policy
                    pitches[i],
                    100,
                ),
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
                    children: children.clone(),
                    policy: SubdivisionPolicy::Weighted(vec![3, 3, 2]),
                },
                metadata: NodeMetadata::default(),
            },
        );

        let tree = DurationTree {
            root: 0,
            nodes,
            next_id: 4,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };
        let score = make_score(tree);
        let result = realize(&score, 0, 0).unwrap();

        let note_ons: Vec<_> = result
            .events
            .iter()
            .filter(|e| matches!(e.kind, EventKind::NoteOn { .. }))
            .collect();
        assert_eq!(note_ons.len(), 3);
        // Offsets: 0, 3/8, 6/8
        assert_eq!(note_ons[0].offset, Rational::new(0, 1));
        assert_eq!(note_ons[1].offset, Rational::new(3, 8));
        assert_eq!(note_ons[2].offset, Rational::new(3, 4));

        let note_offs: Vec<_> = result
            .events
            .iter()
            .filter(|e| matches!(e.kind, EventKind::NoteOff { .. }))
            .collect();
        assert_eq!(note_offs.len(), 3);
        assert_eq!(note_offs[0].offset, Rational::new(3, 8));
        assert_eq!(note_offs[1].offset, Rational::new(3, 4));
        assert_eq!(note_offs[2].offset, Rational::new(1, 1));
    }

    #[test]
    fn nested_subdivision_tisra_in_chatusra() {
        // Root: subdivided into 4 (chatusra).
        // Child 0: subdivided into 3 (tisra) — nested tuplet.
        // Children 1-3: pulses.
        let mut nodes = HashMap::new();

        // Tisra children (ids 10, 11, 12)
        for i in 0..3u64 {
            let id = 10 + i;
            nodes.insert(
                id,
                make_pulse_node(id, Some(1), Rational::new(1, 3), 60 + i as u8, 100),
            );
        }

        // Tisra subdivision node (id 1)
        nodes.insert(
            1,
            DurationNode {
                id: 1,
                parent: Some(0),
                duration: Rational::new(1, 4),
                accent_ref: None,
                kind: DurationKind::Subdivided {
                    children: vec![10, 11, 12],
                    policy: SubdivisionPolicy::Equal,
                },
                metadata: NodeMetadata::default(),
            },
        );

        // Other chatusra children (ids 2, 3, 4)
        for i in 2..=4u64 {
            nodes.insert(
                i,
                make_pulse_node(i, Some(0), Rational::new(1, 4), 70 + i as u8, 100),
            );
        }

        // Root: chatusra
        nodes.insert(
            0,
            DurationNode {
                id: 0,
                parent: None,
                duration: Rational::new(1, 1),
                accent_ref: None,
                kind: DurationKind::Subdivided {
                    children: vec![1, 2, 3, 4],
                    policy: SubdivisionPolicy::Equal,
                },
                metadata: NodeMetadata::default(),
            },
        );

        let tree = DurationTree {
            root: 0,
            nodes,
            next_id: 13,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };
        let score = make_score(tree);
        let result = realize(&score, 0, 0).unwrap();

        let note_ons: Vec<_> = result
            .events
            .iter()
            .filter(|e| matches!(e.kind, EventKind::NoteOn { .. }))
            .collect();

        // 3 tisra notes + 3 chatusra notes = 6
        assert_eq!(note_ons.len(), 6);

        // Tisra notes: at 0, 1/12, 2/12
        assert_eq!(note_ons[0].offset, Rational::new(0, 1));
        assert_eq!(note_ons[1].offset, Rational::new(1, 12));
        assert_eq!(note_ons[2].offset, Rational::new(1, 6));

        // Chatusra notes: at 1/4, 2/4, 3/4
        assert_eq!(note_ons[3].offset, Rational::new(1, 4));
        assert_eq!(note_ons[4].offset, Rational::new(1, 2));
        assert_eq!(note_ons[5].offset, Rational::new(3, 4));
    }

    #[test]
    fn tied_span() {
        // Three pulses tied together: one NoteOn at start, one NoteOff at end.
        let mut nodes = HashMap::new();

        for i in 1..=3u64 {
            nodes.insert(i, make_pulse_node(i, Some(0), Rational::new(1, 3), 60, 100));
        }

        nodes.insert(
            0,
            DurationNode {
                id: 0,
                parent: None,
                duration: Rational::new(1, 1),
                accent_ref: None,
                kind: DurationKind::Tied {
                    children: vec![1, 2, 3],
                },
                metadata: NodeMetadata::default(),
            },
        );

        let tree = DurationTree {
            root: 0,
            nodes,
            next_id: 4,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };
        let score = make_score(tree);
        let result = realize(&score, 0, 0).unwrap();

        // Should be exactly 1 NoteOn and 1 NoteOff.
        let note_ons: Vec<_> = result
            .events
            .iter()
            .filter(|e| matches!(e.kind, EventKind::NoteOn { .. }))
            .collect();
        let note_offs: Vec<_> = result
            .events
            .iter()
            .filter(|e| matches!(e.kind, EventKind::NoteOff { .. }))
            .collect();

        assert_eq!(note_ons.len(), 1);
        assert_eq!(note_offs.len(), 1);
        assert_eq!(note_ons[0].offset, Rational::new(0, 1));
        // NoteOff at the end of the full tied span (1/1).
        assert_eq!(note_offs[0].offset, Rational::new(1, 1));
    }

    #[test]
    fn tied_span_does_not_remove_prior_same_pitch_note_off() {
        let mut nodes = HashMap::new();
        nodes.insert(1, make_pulse_node(1, Some(0), Rational::new(1, 2), 60, 100));
        nodes.insert(
            20,
            make_pulse_node(20, Some(2), Rational::new(1, 2), 60, 100),
        );
        nodes.insert(
            21,
            make_pulse_node(21, Some(2), Rational::new(1, 2), 60, 100),
        );
        nodes.insert(
            2,
            DurationNode {
                id: 2,
                parent: Some(0),
                duration: Rational::new(1, 2),
                accent_ref: None,
                kind: DurationKind::Tied {
                    children: vec![20, 21],
                },
                metadata: NodeMetadata::default(),
            },
        );
        nodes.insert(
            0,
            DurationNode {
                id: 0,
                parent: None,
                duration: Rational::new(1, 1),
                accent_ref: None,
                kind: DurationKind::Subdivided {
                    children: vec![1, 2],
                    policy: SubdivisionPolicy::Equal,
                },
                metadata: NodeMetadata::default(),
            },
        );

        let tree = DurationTree {
            root: 0,
            nodes,
            next_id: 22,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };
        let score = make_score(tree);
        let result = realize(&score, 0, 0).unwrap();
        let note_off_offsets = result
            .events
            .iter()
            .filter_map(|event| match event.kind {
                EventKind::NoteOff { pitch: 60, .. } => Some(event.offset),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(
            note_off_offsets,
            vec![Rational::new(1, 2), Rational::new(1, 1)]
        );
    }

    #[test]
    fn rest_produces_no_events() {
        let tree = DurationTree::empty_cycle(Rational::new(1, 1));
        let score = make_score(tree);
        let result = realize(&score, 0, 0).unwrap();
        assert!(result.events.is_empty());
    }

    #[test]
    fn equal_subdivision_rejects_empty_children() {
        let mut nodes = HashMap::new();
        nodes.insert(
            0,
            DurationNode {
                id: 0,
                parent: None,
                duration: Rational::new(1, 1),
                accent_ref: None,
                kind: DurationKind::Subdivided {
                    children: vec![],
                    policy: SubdivisionPolicy::Equal,
                },
                metadata: NodeMetadata::default(),
            },
        );

        let tree = DurationTree {
            root: 0,
            nodes,
            next_id: 1,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };
        let err = realize(&make_score(tree), 0, 0).unwrap_err();
        assert!(matches!(err, RealizeError::SubdivisionMismatch(_)));
        assert!(err.to_string().contains("has no children"));
    }

    #[test]
    fn weighted_subdivision_rejects_zero_weight() {
        let mut nodes = HashMap::new();
        nodes.insert(1, make_pulse_node(1, Some(0), Rational::new(1, 2), 60, 100));
        nodes.insert(2, make_pulse_node(2, Some(0), Rational::new(1, 2), 62, 100));
        nodes.insert(
            0,
            DurationNode {
                id: 0,
                parent: None,
                duration: Rational::new(1, 1),
                accent_ref: None,
                kind: DurationKind::Subdivided {
                    children: vec![1, 2],
                    policy: SubdivisionPolicy::Weighted(vec![1, 0]),
                },
                metadata: NodeMetadata::default(),
            },
        );

        let tree = DurationTree {
            root: 0,
            nodes,
            next_id: 3,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };
        let err = realize(&make_score(tree), 0, 0).unwrap_err();
        assert!(matches!(err, RealizeError::SubdivisionMismatch(_)));
        assert!(err.to_string().contains("zero duration"));
    }

    #[test]
    fn explicit_subdivision_rejects_children_that_do_not_tile_parent() {
        let mut nodes = HashMap::new();
        nodes.insert(1, make_pulse_node(1, Some(0), Rational::new(1, 3), 60, 100));
        nodes.insert(2, make_pulse_node(2, Some(0), Rational::new(1, 3), 62, 100));
        nodes.insert(
            0,
            DurationNode {
                id: 0,
                parent: None,
                duration: Rational::new(1, 1),
                accent_ref: None,
                kind: DurationKind::Subdivided {
                    children: vec![1, 2],
                    policy: SubdivisionPolicy::Explicit,
                },
                metadata: NodeMetadata::default(),
            },
        );

        let tree = DurationTree {
            root: 0,
            nodes,
            next_id: 3,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };
        let err = realize(&make_score(tree), 0, 0).unwrap_err();
        assert!(matches!(err, RealizeError::SubdivisionMismatch(_)));
        assert!(err.to_string().contains("sum to 2/3, expected 1"));
    }

    #[test]
    fn note_offs_before_note_ons_at_same_offset() {
        // Two adjacent notes: first note's NoteOff and second note's NoteOn
        // land at the same offset. NoteOff should sort first.
        let mut nodes = HashMap::new();
        nodes.insert(1, make_pulse_node(1, Some(0), Rational::new(1, 2), 60, 100));
        nodes.insert(2, make_pulse_node(2, Some(0), Rational::new(1, 2), 60, 100));
        nodes.insert(
            0,
            DurationNode {
                id: 0,
                parent: None,
                duration: Rational::new(1, 1),
                accent_ref: None,
                kind: DurationKind::Subdivided {
                    children: vec![1, 2],
                    policy: SubdivisionPolicy::Equal,
                },
                metadata: NodeMetadata::default(),
            },
        );

        let tree = DurationTree {
            root: 0,
            nodes,
            next_id: 3,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };
        let score = make_score(tree);
        let result = realize(&score, 0, 0).unwrap();

        // At offset 1/2: should see NoteOff then NoteOn.
        let at_half: Vec<_> = result
            .events
            .iter()
            .filter(|e| e.offset == Rational::new(1, 2))
            .collect();
        assert_eq!(at_half.len(), 2);
        assert!(matches!(at_half[0].kind, EventKind::NoteOff { .. }));
        assert!(matches!(at_half[1].kind, EventKind::NoteOn { .. }));
    }

    #[test]
    fn snapshot_canonical_score() {
        // A simple score for insta snapshot testing.
        let mut nodes = HashMap::new();
        for i in 1..=3u64 {
            nodes.insert(
                i,
                make_pulse_node(i, Some(0), Rational::new(1, 3), 60 + i as u8, 100),
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
                    children: vec![1, 2, 3],
                    policy: SubdivisionPolicy::Equal,
                },
                metadata: NodeMetadata::default(),
            },
        );
        let tree = DurationTree {
            root: 0,
            nodes,
            next_id: 4,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };
        let score = make_score(tree);
        let result = realize(&score, 0, 42).unwrap();

        let snapshot: Vec<String> = result
            .events
            .iter()
            .map(|e| {
                format!(
                    "offset={}/{} kind={:?} node={}",
                    e.offset.numer(),
                    e.offset.denom(),
                    e.kind,
                    e.source_node
                )
            })
            .collect();

        insta::assert_debug_snapshot!(snapshot);
    }

    mod prop_tests {
        use super::*;
        use proptest::prelude::*;
        use proptest::test_runner::TestCaseResult;
        use std::collections::HashMap;

        const CASES: u32 = 128;

        #[derive(Debug, Clone)]
        enum RealizePolicyCase {
            Equal { count: u32 },
            Explicit { weights: Vec<u32> },
            Weighted { weights: Vec<u32> },
        }

        proptest! {
            #![proptest_config(ProptestConfig {
                cases: CASES,
                max_shrink_iters: 2048,
                ..ProptestConfig::default()
            })]

            #[test]
            fn subdivided_notes_realize_as_sorted_bounded_balanced_events(
                policy in realize_policy_case(),
                cycle_len in 1_i64..=8,
            ) {
                let expected_notes = policy.child_count();
                let mut score = score_for_subdivision(policy);
                score.cycle_length = Rational::from_integer(cycle_len);

                let realized = realize(&score, 0, 0)?;

                assert_realization_invariants(&realized, score.cycle_length)?;
                prop_assert_eq!(note_on_count(&realized), expected_notes);
                prop_assert_eq!(note_off_count(&realized), expected_notes);
                prop_assert_eq!(first_note_on_offset(&realized), Some(Rational::new(0, 1)));
                prop_assert_eq!(last_note_off_offset(&realized), Some(score.cycle_length));
            }

            #[test]
            fn tied_note_groups_emit_one_note_pair_for_the_full_span(
                weights in proptest::collection::vec(1_u32..=32, 1..=12),
                cycle_len in 1_i64..=8,
                pitch in 0_u8..=127,
            ) {
                let mut score = score_for_tied_notes(&weights, pitch);
                score.cycle_length = Rational::from_integer(cycle_len);

                let realized = realize(&score, 0, 0)?;

                assert_realization_invariants(&realized, score.cycle_length)?;
                prop_assert_eq!(note_on_count(&realized), 1);
                prop_assert_eq!(note_off_count(&realized), 1);
                prop_assert_eq!(first_note_on_offset(&realized), Some(Rational::new(0, 1)));
                prop_assert_eq!(last_note_off_offset(&realized), Some(score.cycle_length));
            }
        }

        fn realize_policy_case() -> impl Strategy<Value = RealizePolicyCase> {
            prop_oneof![
                (1_u32..=12).prop_map(|count| RealizePolicyCase::Equal { count }),
                proptest::collection::vec(1_u32..=32, 1..=12)
                    .prop_map(|weights| RealizePolicyCase::Explicit { weights }),
                proptest::collection::vec(1_u32..=32, 1..=12)
                    .prop_map(|weights| RealizePolicyCase::Weighted { weights }),
            ]
        }

        impl RealizePolicyCase {
            fn child_count(&self) -> usize {
                match self {
                    RealizePolicyCase::Equal { count } => *count as usize,
                    RealizePolicyCase::Explicit { weights }
                    | RealizePolicyCase::Weighted { weights } => weights.len(),
                }
            }
        }

        fn score_for_subdivision(policy: RealizePolicyCase) -> Score {
            let count = policy.child_count();
            let weights = match &policy {
                RealizePolicyCase::Explicit { weights }
                | RealizePolicyCase::Weighted { weights } => weights.clone(),
                RealizePolicyCase::Equal { count } => vec![1; *count as usize],
            };
            let total = weights.iter().map(|weight| u64::from(*weight)).sum::<u64>();
            let children = (1..=count as NodeId).collect::<Vec<_>>();
            let mut nodes = HashMap::new();
            for (index, child_id) in children.iter().copied().enumerate() {
                let duration = Rational::new(weights[index] as i64, total as i64);
                nodes.insert(
                    child_id,
                    make_pulse_node(child_id, Some(0), duration, 48 + index as u8, 96),
                );
            }

            let policy = match policy {
                RealizePolicyCase::Equal { .. } => SubdivisionPolicy::Equal,
                RealizePolicyCase::Explicit { .. } => SubdivisionPolicy::Explicit,
                RealizePolicyCase::Weighted { weights } => SubdivisionPolicy::Weighted(weights),
            };
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

            make_score(DurationTree {
                root: 0,
                nodes,
                next_id: count as NodeId + 1,
                pulse_spans: vec![],
                next_pulse_span_id: 0,
            })
        }

        fn score_for_tied_notes(weights: &[u32], pitch: u8) -> Score {
            let total = weights.iter().map(|weight| u64::from(*weight)).sum::<u64>();
            let children = (1..=weights.len() as NodeId).collect::<Vec<_>>();
            let mut nodes = HashMap::new();
            for (index, child_id) in children.iter().copied().enumerate() {
                nodes.insert(
                    child_id,
                    make_pulse_node(
                        child_id,
                        Some(0),
                        Rational::new(weights[index] as i64, total as i64),
                        pitch,
                        96,
                    ),
                );
            }
            nodes.insert(
                0,
                DurationNode {
                    id: 0,
                    parent: None,
                    duration: Rational::new(1, 1),
                    accent_ref: None,
                    kind: DurationKind::Tied { children },
                    metadata: NodeMetadata::default(),
                },
            );

            make_score(DurationTree {
                root: 0,
                nodes,
                next_id: weights.len() as NodeId + 1,
                pulse_spans: vec![],
                next_pulse_span_id: 0,
            })
        }

        fn assert_realization_invariants(
            realized: &Realization,
            cycle_length: Rational,
        ) -> TestCaseResult {
            for window in realized.events.windows(2) {
                let left = (&window[0].offset, event_sort_order(&window[0].kind));
                let right = (&window[1].offset, event_sort_order(&window[1].kind));
                prop_assert!(left <= right, "events must be sorted by musical offset");
            }

            let mut active = HashMap::<(u8, u8), u32>::new();
            for event in &realized.events {
                prop_assert!(event.offset >= Rational::new(0, 1));
                prop_assert!(event.offset <= cycle_length);
                match event.kind {
                    EventKind::NoteOn {
                        channel,
                        pitch,
                        velocity,
                    } => {
                        prop_assert!(pitch <= 127);
                        prop_assert!(velocity <= 127);
                        *active.entry((channel, pitch)).or_default() += 1;
                    }
                    EventKind::NoteOff { channel, pitch } => {
                        prop_assert!(pitch <= 127);
                        let key = (channel, pitch);
                        prop_assert!(
                            active.contains_key(&key),
                            "note off without matching note on"
                        );
                        let count = active.get_mut(&key).expect("checked above");
                        prop_assert!(*count > 0);
                        *count -= 1;
                    }
                    EventKind::Cc {
                        controller, value, ..
                    } => {
                        prop_assert!(controller <= 127);
                        prop_assert!(value <= 127);
                    }
                }
            }
            prop_assert!(active.values().all(|count| *count == 0));
            Ok(())
        }

        fn note_on_count(realized: &Realization) -> usize {
            realized
                .events
                .iter()
                .filter(|event| matches!(event.kind, EventKind::NoteOn { .. }))
                .count()
        }

        fn note_off_count(realized: &Realization) -> usize {
            realized
                .events
                .iter()
                .filter(|event| matches!(event.kind, EventKind::NoteOff { .. }))
                .count()
        }

        fn first_note_on_offset(realized: &Realization) -> Option<Rational> {
            realized.events.iter().find_map(|event| match event.kind {
                EventKind::NoteOn { .. } => Some(event.offset),
                _ => None,
            })
        }

        fn last_note_off_offset(realized: &Realization) -> Option<Rational> {
            realized
                .events
                .iter()
                .rev()
                .find_map(|event| match event.kind {
                    EventKind::NoteOff { .. } => Some(event.offset),
                    _ => None,
                })
        }
    }
}
