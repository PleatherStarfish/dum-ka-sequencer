//! Transform pipeline for Score editing.
//!
//! A transform is a pure function that modifies a `DurationTree`.
//! `apply_pipeline` clones the seed tree and applies each enabled
//! transform in order, producing the effective tree for realization.

use cseq_model::{
    is_allowed_jathi, AutomationSet, AutomationValueKind, CustomSubdivisionSpec, DurationKind,
    DurationNode, DurationTree, JathiAccentMode, NodeId, NodeMetadata, NodeSelector, PulseData,
    PulseEvent, PulseSpanKind, Rational, Score, SubdivisionInflection, SubdivisionPolicy,
    SwitchSeedMode, TiePattern, Transform, TransformKind, ValueSpec, WeightedJathiChoice,
    WeightedSubdivisionChoice, WeightedSwitchCount, AUTOMATION_TARGET_BEAT_ACCENT_MAX,
    AUTOMATION_TARGET_BEAT_ACCENT_MIN, AUTOMATION_TARGET_JATHI_ACCENT_MAX,
    AUTOMATION_TARGET_JATHI_ACCENT_MIN, AUTOMATION_TARGET_PITCH,
    AUTOMATION_TARGET_SECTION_ACCENT_MAX, AUTOMATION_TARGET_SECTION_ACCENT_MIN,
    AUTOMATION_TARGET_VELOCITY,
};
use thiserror::Error;
use tracing::debug;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum TransformError {
    #[error("target not found: {selector:?} (transform {transform_id})")]
    TargetNotFound { transform_id: u64, selector: String },

    #[error("invalid target for {kind} (transform {transform_id}): {reason}")]
    InvalidTarget {
        transform_id: u64,
        kind: String,
        reason: String,
    },
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Apply all enabled transforms in the score's pipeline to its seed
/// duration tree. Returns the effective tree for realization.
pub fn apply_pipeline(score: &Score) -> Result<DurationTree, TransformError> {
    apply_pipeline_for_cycle(score, 0)
}

/// Apply the pipeline for a specific cycle without mutating the original Score.
pub fn apply_pipeline_for_cycle(score: &Score, cycle: u64) -> Result<DurationTree, TransformError> {
    let mut score = score.clone();
    apply_pipeline_for_cycle_mut(&mut score, cycle)
}

/// Apply the pipeline for a specific cycle, mutating seed history where needed.
pub fn apply_pipeline_for_cycle_mut(
    score: &mut Score,
    cycle: u64,
) -> Result<DurationTree, TransformError> {
    apply_pipeline_for_cycle_mut_inner(score, cycle, None, None)
}

/// Resolve a random-access cycle with the same structural seed history as
/// transport playback starting at cycle zero. The supplied score is the
/// baseline and is advanced in place through `cycle`; callers that need to
/// retain authored state should pass a clone. Locked and PerCycle modes are
/// stateless, so a score with no enabled History switch resolves directly.
pub fn apply_pipeline_through_cycle_mut(
    score: &mut Score,
    cycle: u64,
) -> Result<DurationTree, TransformError> {
    let has_enabled_history = score.pipeline.iter().any(|transform| {
        transform.enabled
            && matches!(
                &transform.kind,
                TransformKind::SubdivisionSwitch {
                    seed_mode: SwitchSeedMode::History { .. },
                    ..
                }
            )
    });
    if !has_enabled_history {
        return apply_pipeline_for_cycle_mut(score, cycle);
    }

    let mut tree = apply_pipeline_for_cycle_mut(score, 0)?;
    for replay_cycle in 1..=cycle {
        tree = apply_pipeline_for_cycle_mut(score, replay_cycle)?;
    }
    Ok(tree)
}

/// Apply the pipeline for a specific cycle and report every stochastic seed
/// consumed by subdivision-switch transforms. History seed modes still mutate
/// the supplied score exactly as normal playback would.
pub fn apply_pipeline_for_cycle_mut_with_seed_trace(
    score: &mut Score,
    cycle: u64,
) -> Result<(DurationTree, Vec<SwitchSeedTrace>), TransformError> {
    let mut trace = Vec::new();
    let tree = apply_pipeline_for_cycle_mut_inner(score, cycle, Some(&mut trace), None)?;
    Ok((tree, trace))
}

/// Apply the pipeline with a recorded seed path. Replayed seeds are consumed in
/// the same order that subdivision-switch seeds are normally resolved. If the
/// replay path runs out, remaining seed choices resolve normally.
pub fn apply_pipeline_for_cycle_mut_with_seed_trace_and_replay(
    score: &mut Score,
    cycle: u64,
    replay: &[SwitchSeedReplay],
) -> Result<(DurationTree, Vec<SwitchSeedTrace>), TransformError> {
    let mut trace = Vec::new();
    let mut replay = SwitchSeedReplayCursor::new(replay);
    let tree =
        apply_pipeline_for_cycle_mut_inner(score, cycle, Some(&mut trace), Some(&mut replay))?;
    Ok((tree, trace))
}

fn apply_pipeline_for_cycle_mut_inner(
    score: &mut Score,
    cycle: u64,
    mut seed_trace: Option<&mut Vec<SwitchSeedTrace>>,
    mut seed_replay: Option<&mut SwitchSeedReplayCursor<'_>>,
) -> Result<DurationTree, TransformError> {
    let mut tree = score.duration_tree.clone();
    let cycle_beats = rational_to_positive_u32(score.cycle_length);

    for transform in &mut score.pipeline {
        if !transform.enabled {
            continue;
        }
        apply_one(
            &mut tree,
            transform,
            cycle,
            cycle_beats,
            seed_trace.as_deref_mut(),
            seed_replay.as_deref_mut(),
        )?;
    }

    Ok(tree)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwitchSeedTraceSource {
    Locked,
    PerCycle,
    History,
    New,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwitchSeedTrace {
    pub cycle: u64,
    pub transform_id: u64,
    pub node_id: NodeId,
    pub seed: u64,
    pub source: SwitchSeedTraceSource,
    pub history_before: Vec<u64>,
    pub history_after: Vec<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwitchSeedReplay {
    pub seed: u64,
    pub source: SwitchSeedTraceSource,
    pub history_before: Vec<u64>,
    pub history_after: Vec<u64>,
}

struct SwitchSeedReplayCursor<'a> {
    entries: &'a [SwitchSeedReplay],
    index: usize,
}

impl<'a> SwitchSeedReplayCursor<'a> {
    fn new(entries: &'a [SwitchSeedReplay]) -> Self {
        Self { entries, index: 0 }
    }

    fn next(&mut self) -> Option<&'a SwitchSeedReplay> {
        let entry = self.entries.get(self.index)?;
        self.index = self.index.saturating_add(1);
        Some(entry)
    }
}

fn rational_to_positive_u32(value: Rational) -> Option<u32> {
    if *value.denom() != 1 || *value.numer() <= 0 {
        return None;
    }
    u32::try_from(*value.numer()).ok()
}

// ---------------------------------------------------------------------------
// Single transform application
// ---------------------------------------------------------------------------

fn apply_one(
    tree: &mut DurationTree,
    transform: &mut Transform,
    cycle: u64,
    cycle_beats: Option<u32>,
    mut seed_trace: Option<&mut Vec<SwitchSeedTrace>>,
    mut seed_replay: Option<&mut SwitchSeedReplayCursor<'_>>,
) -> Result<(), TransformError> {
    let node_ids = resolve_selector(tree, &transform.target);

    if node_ids.is_empty() {
        return Err(TransformError::TargetNotFound {
            transform_id: transform.id,
            selector: format!("{:?}", transform.target),
        });
    }

    for &node_id in &node_ids {
        match &mut transform.kind {
            TransformKind::Subdivide { policy, count } => {
                apply_subdivide(tree, node_id, *count, policy.clone(), transform.id)?;
            }
            TransformKind::SubdivisionSwitch {
                initial_weights,
                initial_jathi_weights,
                initial_custom_subdivision,
                automation,
                inflections,
                switch_count_weights,
                seed_mode,
                pitch,
                velocity,
                accent,
            } => {
                let cycle_beats = cycle_beats.ok_or_else(|| {
                    invalid(
                        transform.id,
                        "SubdivisionSwitch",
                        "score cycle_length must be a positive integer beat count",
                    )
                })?;
                let args = SubdivisionSwitchArgs {
                    initial_weights,
                    initial_jathi_weights,
                    initial_custom_subdivision: initial_custom_subdivision.as_deref(),
                    automation: automation.as_deref(),
                    inflections,
                    switch_count_weights,
                    seed_mode,
                    pitch,
                    velocity,
                    accent,
                    cycle,
                    cycle_beats,
                    transform_id: transform.id,
                    seed_trace: seed_trace.as_deref_mut(),
                };
                apply_subdivision_switch(tree, node_id, args, seed_replay.as_deref_mut())?;
            }
            TransformKind::SetVelocity { velocity } => {
                apply_set_velocity(tree, node_id, velocity, transform.id)?;
            }
            TransformKind::Tie { pattern } => {
                apply_tie(tree, node_id, pattern, transform.id)?;
            }
            TransformKind::RemoveNode => {
                apply_remove(tree, node_id);
            }
        }
    }

    debug!(transform_id = transform.id, "applied transform");
    Ok(())
}

// ---------------------------------------------------------------------------
// NodeSelector resolution
// ---------------------------------------------------------------------------

fn resolve_selector(tree: &DurationTree, selector: &NodeSelector) -> Vec<NodeId> {
    match selector {
        NodeSelector::Root => vec![tree.root],
        NodeSelector::ById { id } => {
            if tree.nodes.contains_key(id) {
                vec![*id]
            } else {
                vec![]
            }
        }
        NodeSelector::ByPath { path } => resolve_by_path(tree, path).into_iter().collect(),
        NodeSelector::ByTag { tag } => tree
            .nodes
            .values()
            .filter(|n| n.metadata.label.as_deref() == Some(tag))
            .map(|n| n.id)
            .collect(),
        NodeSelector::ByAccentRef { accent_id } => tree
            .nodes
            .values()
            .filter(|n| n.accent_ref == Some(*accent_id))
            .map(|n| n.id)
            .collect(),
    }
}

fn resolve_by_path(tree: &DurationTree, path: &[usize]) -> Option<NodeId> {
    let mut current = tree.root;
    for &index in path {
        let node = tree.nodes.get(&current)?;
        let children = match &node.kind {
            DurationKind::Subdivided { children, .. } => children,
            DurationKind::Tied { children } => children,
            _ => return None,
        };
        current = *children.get(index)?;
    }
    Some(current)
}

// ---------------------------------------------------------------------------
// Individual transform implementations
// ---------------------------------------------------------------------------

fn subdivision_child_fractions(
    child_count: usize,
    policy: &SubdivisionPolicy,
    transform_id: u64,
    kind: &str,
    parent_id: NodeId,
) -> Result<Vec<Rational>, TransformError> {
    if child_count == 0 {
        return Err(invalid(
            transform_id,
            kind,
            &format!("node {parent_id}: subdivision count must be greater than zero"),
        ));
    }

    match policy {
        SubdivisionPolicy::Equal => Ok(vec![Rational::new(1, child_count as i64); child_count]),
        SubdivisionPolicy::Weighted(weights) => {
            if weights.len() != child_count {
                return Err(invalid(
                    transform_id,
                    kind,
                    &format!(
                        "node {parent_id}: {} weights for {} children",
                        weights.len(),
                        child_count
                    ),
                ));
            }
            if let Some(index) = weights.iter().position(|weight| *weight == 0) {
                return Err(invalid(
                    transform_id,
                    kind,
                    &format!(
                        "node {parent_id}: weighted subdivision child {} has zero duration",
                        index + 1
                    ),
                ));
            }
            let total = weights.iter().map(|weight| u64::from(*weight)).sum::<u64>();
            if total == 0 {
                return Err(invalid(
                    transform_id,
                    kind,
                    &format!("node {parent_id}: weighted subdivision total must be positive"),
                ));
            }
            Ok(weights
                .iter()
                .map(|weight| Rational::new(i64::from(*weight), total as i64))
                .collect())
        }
        SubdivisionPolicy::Explicit => Ok(vec![Rational::new(1, child_count as i64); child_count]),
    }
}

fn effective_child_fractions(
    tree: &DurationTree,
    children: &[NodeId],
    policy: &SubdivisionPolicy,
    transform_id: u64,
    kind: &str,
    parent_id: NodeId,
) -> Result<Vec<Rational>, TransformError> {
    match policy {
        SubdivisionPolicy::Explicit => {
            if children.is_empty() {
                return Err(invalid(
                    transform_id,
                    kind,
                    &format!("node {parent_id}: explicit subdivision has no children"),
                ));
            }
            let mut fractions = Vec::with_capacity(children.len());
            let mut sum = Rational::new(0, 1);
            for &child_id in children {
                let child =
                    tree.nodes
                        .get(&child_id)
                        .ok_or_else(|| TransformError::TargetNotFound {
                            transform_id,
                            selector: format!("ById({child_id})"),
                        })?;
                if child.duration <= Rational::new(0, 1) {
                    return Err(invalid(
                        transform_id,
                        kind,
                        &format!("child {child_id}: explicit duration must be positive"),
                    ));
                }
                fractions.push(child.duration);
                sum += child.duration;
            }
            if sum != Rational::new(1, 1) {
                return Err(invalid(
                    transform_id,
                    kind,
                    &format!("node {parent_id}: explicit child durations sum to {sum}, expected 1"),
                ));
            }
            Ok(fractions)
        }
        _ => subdivision_child_fractions(children.len(), policy, transform_id, kind, parent_id),
    }
}

fn apply_subdivide(
    tree: &mut DurationTree,
    node_id: NodeId,
    count: u32,
    policy: SubdivisionPolicy,
    transform_id: u64,
) -> Result<(), TransformError> {
    let child_durations =
        subdivision_child_fractions(count as usize, &policy, transform_id, "Subdivide", node_id)?;

    let node = tree
        .nodes
        .get(&node_id)
        .ok_or_else(|| TransformError::TargetNotFound {
            transform_id,
            selector: format!("ById({node_id})"),
        })?;

    // Can only subdivide a Pulse node.
    let pulse_data = match &node.kind {
        DurationKind::Pulse(pd) => pd.clone(),
        other => {
            return Err(TransformError::InvalidTarget {
                transform_id,
                kind: "Subdivide".to_string(),
                reason: format!("expected Pulse, got {:?}", std::mem::discriminant(other)),
            });
        }
    };

    let accent_ref = node.accent_ref;

    // Create N child pulse nodes.
    let mut children = Vec::with_capacity(count as usize);

    for child_dur in child_durations {
        let child_id = tree.next_id();
        children.push(child_id);
        tree.nodes.insert(
            child_id,
            DurationNode {
                id: child_id,
                parent: Some(node_id),
                duration: child_dur,
                accent_ref,
                kind: DurationKind::Pulse(pulse_data.clone()),
                metadata: NodeMetadata::default(),
            },
        );
    }

    // Replace the target node's kind with Subdivided.
    if let Some(node) = tree.nodes.get_mut(&node_id) {
        node.kind = DurationKind::Subdivided { children, policy };
    }

    Ok(())
}

fn fixed_or_invalid<T: Clone + serde::Serialize + serde::de::DeserializeOwned>(
    spec: &ValueSpec<T>,
    transform_id: u64,
    kind: &str,
    field: &str,
) -> Result<T, TransformError> {
    spec.as_fixed()
        .cloned()
        .ok_or_else(|| TransformError::InvalidTarget {
            transform_id,
            kind: kind.to_string(),
            reason: format!("{field} must be fixed in deterministic mode"),
        })
}

struct SubdivisionSwitchArgs<'a> {
    initial_weights: &'a [WeightedSubdivisionChoice],
    initial_jathi_weights: &'a [WeightedJathiChoice],
    initial_custom_subdivision: Option<&'a cseq_model::CustomSubdivisionSpec>,
    automation: Option<&'a AutomationSet>,
    inflections: &'a [SubdivisionInflection],
    switch_count_weights: &'a [WeightedSwitchCount],
    seed_mode: &'a mut SwitchSeedMode,
    pitch: &'a ValueSpec<u8>,
    velocity: &'a ValueSpec<u8>,
    accent: &'a cseq_model::GatiAccentSpec,
    cycle: u64,
    cycle_beats: u32,
    transform_id: u64,
    seed_trace: Option<&'a mut Vec<SwitchSeedTrace>>,
}

#[derive(Clone, Copy)]
struct AutomationBeatContext<'a> {
    automation: Option<&'a AutomationSet>,
    cycle: u64,
    beat_index: u32,
    cycle_beats: u32,
}

fn apply_subdivision_switch(
    tree: &mut DurationTree,
    node_id: NodeId,
    mut args: SubdivisionSwitchArgs<'_>,
    seed_replay: Option<&mut SwitchSeedReplayCursor<'_>>,
) -> Result<(), TransformError> {
    validate_subdivision_switch_inputs(&args)?;

    let pitch = fixed_or_invalid(args.pitch, args.transform_id, "SubdivisionSwitch", "pitch")?;
    let velocity = fixed_or_invalid(
        args.velocity,
        args.transform_id,
        "SubdivisionSwitch",
        "velocity",
    )?;

    let node = tree
        .nodes
        .get(&node_id)
        .ok_or_else(|| TransformError::TargetNotFound {
            transform_id: args.transform_id,
            selector: format!("ById({node_id})"),
        })?;

    match &node.kind {
        DurationKind::Pulse(_) => {}
        other => {
            return Err(TransformError::InvalidTarget {
                transform_id: args.transform_id,
                kind: "SubdivisionSwitch".to_string(),
                reason: format!("expected Pulse, got {:?}", std::mem::discriminant(other)),
            });
        }
    }

    let accent_ref = node.accent_ref;
    let seed_resolution = resolve_seed(args.seed_mode, args.cycle, args.transform_id, seed_replay)?;
    let seed = seed_resolution.seed;
    if let Some(seed_trace) = args.seed_trace.as_deref_mut() {
        seed_trace.push(SwitchSeedTrace {
            cycle: args.cycle,
            transform_id: args.transform_id,
            node_id,
            seed,
            source: seed_resolution.source,
            history_before: seed_resolution.history_before,
            history_after: seed_resolution.history_after,
        });
    }
    let mut rng = SplitMix64::new(seed);
    // The pre-reset DTO still carries weighted section fields. During the P4
    // compatibility window they are interpreted as fixed authored choices;
    // section automation, count ladders, and rhythmic modulation no longer
    // participate in structural resolution.
    let initial_weights = args.initial_weights.to_vec();
    let initial_jathi_weights = args.initial_jathi_weights.to_vec();

    // Sort inflections by position; remember original index so the seeded
    // greedy selection lines up with the user's original ordering.
    let mut sorted: Vec<(usize, &SubdivisionInflection)> =
        args.inflections.iter().enumerate().collect();
    sorted.sort_by_key(|(_, inf)| inf.position);

    let sorted_view: Vec<SubdivisionInflection> =
        sorted.iter().map(|(_, inf)| (*inf).clone()).collect();

    let initial_custom = if let Some(custom) = args.initial_custom_subdivision {
        Some(resolve_fixed_custom_section(custom, args.transform_id)?)
    } else {
        None
    };

    let initial_gati = if initial_custom
        .as_ref()
        .and_then(|custom| custom.requested_grid.as_ref())
        .is_some()
    {
        // The initial equal-parts section has already sampled its grid-wide
        // gati. Do not consume the legacy single-gati draw here; otherwise
        // equal-parts initial sections shift every later stochastic choice.
        None
    } else {
        Some(
            choose_fixed_subdivision(&initial_weights, None).ok_or_else(|| {
                invalid(
                    args.transform_id,
                    "SubdivisionSwitch",
                    "initial_weights have no positive entries",
                )
            })?,
        )
    };

    let (fired, resolved_custom_boundaries) =
        resolve_fixed_boundaries(&sorted_view, args.transform_id)?;

    // Resolve a gati for each beat. A chosen boundary changes the current
    // gati; that gati then subdivides each following beat into matras until
    // another chosen boundary changes it.
    let mut beat_gatis = Vec::with_capacity(args.cycle_beats as usize);
    let mut section_starts = Vec::with_capacity(args.cycle_beats as usize);
    let mut section_jathi_weights = Vec::with_capacity(args.cycle_beats as usize);
    // Per section-start beat: the custom-subdivision spec that originated the
    // section (cloned from the initial spec or the fired inflection). `None`
    // keeps the uniform-gati path.
    let mut section_custom: Vec<Option<ResolvedCustomSection>> =
        Vec::with_capacity(args.cycle_beats as usize);
    let mut next_inflection = 0usize;
    let mut current_gati = initial_gati.unwrap_or(1);
    let mut current_jathi_weights = initial_jathi_weights;
    let mut current_custom = initial_custom;

    for beat_index in 0..args.cycle_beats {
        let beat_start = Rational::new(beat_index as i64, args.cycle_beats as i64);
        let mut section_start = beat_index == 0;
        let mut jathi_weights_for_section = if section_start {
            current_jathi_weights.clone()
        } else {
            vec![]
        };
        let mut custom_for_section = if section_start {
            current_custom.clone()
        } else {
            None
        };

        while next_inflection < sorted_view.len()
            && sorted_view[next_inflection].position <= beat_start
        {
            if fired[next_inflection] {
                section_start = true;
                match resolved_custom_boundaries
                    .get(next_inflection)
                    .and_then(Option::as_ref)
                {
                    Some(ResolvedCustomBoundaryChoice::EqualParts(custom)) => {
                        current_custom = Some(custom.clone());
                    }
                    Some(ResolvedCustomBoundaryChoice::PerBeatGati { custom, gati }) => {
                        current_custom = Some(custom.clone());
                        current_gati = *gati;
                    }
                    None => {
                        current_custom = None;
                        current_gati = choose_fixed_subdivision(
                            &sorted_view[next_inflection].subdivision_weights,
                            None,
                        )
                        .ok_or_else(|| {
                            invalid(
                                args.transform_id,
                                "SubdivisionSwitch",
                                &format!(
                                    "fired inflection {} has no positive gati weights",
                                    next_inflection + 1
                                ),
                            )
                        })?;
                    }
                }
                current_jathi_weights = sorted_view[next_inflection].jathi_weights.clone();
                jathi_weights_for_section = current_jathi_weights.clone();
                custom_for_section = current_custom.clone();
            }
            next_inflection += 1;
        }

        beat_gatis.push(current_gati);
        section_starts.push(section_start);
        section_jathi_weights.push(jathi_weights_for_section);
        section_custom.push(custom_for_section);
    }

    let section_plans = resolve_section_plans(
        &beat_gatis,
        &section_starts,
        &section_jathi_weights,
        &section_custom,
        args.transform_id,
    )?;

    tree.pulse_spans.clear();
    tree.next_pulse_span_id = 0;
    emit_pulse_spans(tree, &section_plans);

    let beat_duration = Rational::new(1, args.cycle_beats as i64);
    // Root children. For a uniform-only cycle these are one node per integer beat
    // (Equal policy, byte-identical to before). When any custom section is
    // present the root switches to Explicit policy, where each child's `duration`
    // field is its fraction of the whole cycle (children must sum to 1), so a
    // custom section can contribute a single multi-beat subtree without forcing
    // equal beat widths.
    let mut root_children: Vec<NodeId> = Vec::new();
    let any_custom = section_plans.iter().any(|s| s.custom.is_some());

    for section_plan in &section_plans {
        let ctx = MatraBuildCtx {
            automation: args.automation,
            cycle: args.cycle,
            cycle_beats: args.cycle_beats,
            accent: args.accent,
            pitch,
            velocity,
            accent_ref,
        };
        if let Some(divisions) = &section_plan.custom {
            // One section subtree spanning the section's integer beats; inside,
            // N equal parts, each subdivided by the sampled grid-wide gati.
            let section_node_id = tree.next_id();
            let mut division_ids = Vec::with_capacity(divisions.len());
            for (division_index, division) in divisions.iter().enumerate() {
                if division.matra_count == 0 {
                    return Err(invalid(
                        args.transform_id,
                        "SubdivisionSwitch",
                        "realized custom equal-part gati cannot be zero",
                    ));
                }
                let division_id = tree.next_id();
                let matra_ids = build_matra_nodes(
                    tree,
                    &mut rng,
                    division_id,
                    &ctx,
                    MatraGroupSpec {
                        // Custom equal parts sample automation at their
                        // floor(start beat), preserving the existing
                        // beat-quantized automation model.
                        beat_index: division_automation_beat_index(
                            division.start,
                            args.cycle_beats,
                        ),
                        matra_count: division.matra_count,
                        matra_duration: Rational::new(1, division.matra_count as i64),
                        section_relative_matra_base: division.start_matra,
                        is_section_start: division_index == 0,
                        jathi: section_plan.jathi,
                        label_prefix: format!(
                            "section {} div {}",
                            section_plan.index,
                            division_index + 1
                        ),
                    },
                );
                tree.nodes.insert(
                    division_id,
                    DurationNode {
                        id: division_id,
                        parent: Some(section_node_id),
                        duration: division.duration,
                        accent_ref,
                        kind: DurationKind::Subdivided {
                            children: matra_ids,
                            policy: SubdivisionPolicy::Equal,
                        },
                        metadata: NodeMetadata {
                            label: Some(format!(
                                "div {} gati={}",
                                division_index + 1,
                                division.gati
                            )),
                            color: None,
                            tags: if division_index == 0 {
                                vec!["section-start".to_string()]
                            } else {
                                vec![]
                            },
                        },
                    },
                );
                division_ids.push(division_id);
            }
            let section_beats = section_plan
                .end_beat
                .saturating_sub(section_plan.start_beat);
            // Fraction of the whole cycle this section occupies (Explicit root
            // reads each child's `duration` as a parent-fraction; they sum to 1).
            let section_fraction = Rational::new(section_beats as i64, args.cycle_beats as i64);
            tree.nodes.insert(
                section_node_id,
                DurationNode {
                    id: section_node_id,
                    parent: Some(node_id),
                    duration: section_fraction,
                    accent_ref,
                    kind: DurationKind::Subdivided {
                        children: division_ids,
                        // N equal parts of the section span.
                        policy: SubdivisionPolicy::Equal,
                    },
                    metadata: NodeMetadata {
                        label: Some(format!("section {} custom", section_plan.index)),
                        color: None,
                        tags: vec!["section-start".to_string()],
                    },
                },
            );
            root_children.push(section_node_id);
        } else {
            // Uniform section: one node per integer beat (unchanged behavior).
            let beat_matra_count = section_plan.beat_matra_count();
            if beat_matra_count == 0 {
                return Err(invalid(
                    args.transform_id,
                    "SubdivisionSwitch",
                    "realized gati cannot be zero",
                ));
            }
            for beat_index in section_plan.start_beat..section_plan.end_beat {
                let beat_id = tree.next_id();
                let section_start = section_starts
                    .get(beat_index as usize)
                    .copied()
                    .unwrap_or(beat_index == 0);
                let matra_ids = build_matra_nodes(
                    tree,
                    &mut rng,
                    beat_id,
                    &ctx,
                    MatraGroupSpec {
                        beat_index: beat_index as usize,
                        matra_count: beat_matra_count,
                        matra_duration: Rational::new(1, beat_matra_count as i64),
                        section_relative_matra_base: (beat_index - section_plan.start_beat)
                            * beat_matra_count,
                        is_section_start: section_start,
                        jathi: section_plan.jathi,
                        label_prefix: format!("beat {}", beat_index + 1),
                    },
                );
                tree.nodes.insert(
                    beat_id,
                    DurationNode {
                        id: beat_id,
                        parent: Some(node_id),
                        duration: beat_duration,
                        accent_ref,
                        kind: DurationKind::Subdivided {
                            children: matra_ids,
                            policy: SubdivisionPolicy::Equal,
                        },
                        metadata: NodeMetadata {
                            label: Some(format!(
                                "beat {} gati={}",
                                beat_index + 1,
                                section_plan.gati
                            )),
                            color: None,
                            tags: if section_start {
                                vec!["section-start".to_string()]
                            } else {
                                vec![]
                            },
                        },
                    },
                );
                root_children.push(beat_id);
            }
        }
    }

    if let Some(node) = tree.nodes.get_mut(&node_id) {
        node.kind = DurationKind::Subdivided {
            children: root_children,
            // Uniform-only cycles keep the original Equal policy (byte-identical).
            // With a custom section present, Explicit reads each child's
            // `duration` field (its cycle-fraction) so a multi-beat custom section
            // sits beside single-beat uniform sections.
            policy: if any_custom {
                SubdivisionPolicy::Explicit
            } else {
                SubdivisionPolicy::Equal
            },
        };
    }

    Ok(())
}

struct MatraBuildCtx<'a> {
    automation: Option<&'a AutomationSet>,
    cycle: u64,
    cycle_beats: u32,
    accent: &'a cseq_model::GatiAccentSpec,
    pitch: u8,
    velocity: u8,
    accent_ref: Option<cseq_model::AccentNodeId>,
}

struct MatraGroupSpec {
    beat_index: usize,
    matra_count: u32,
    matra_duration: Rational,
    section_relative_matra_base: u32,
    is_section_start: bool,
    jathi: Option<u32>,
    label_prefix: String,
}

/// Build the matra pulse nodes for one frame (a uniform beat or a custom
/// division), returning their ids in order. Accent/jathi/section tagging matches
/// the original per-beat logic; jathi is `section_relative_matra % jathi`.
fn build_matra_nodes(
    tree: &mut DurationTree,
    rng: &mut SplitMix64,
    parent_id: NodeId,
    ctx: &MatraBuildCtx<'_>,
    spec: MatraGroupSpec,
) -> Vec<NodeId> {
    let automation_context = AutomationBeatContext {
        automation: ctx.automation,
        cycle: ctx.cycle,
        beat_index: spec.beat_index as u32,
        cycle_beats: ctx.cycle_beats,
    };
    let beat_pitch = sample_automation_u8(
        automation_context,
        AUTOMATION_TARGET_PITCH,
        ctx.pitch,
        0,
        127,
    );
    let beat_velocity = sample_automation_u8(
        automation_context,
        AUTOMATION_TARGET_VELOCITY,
        ctx.velocity,
        1,
        127,
    );
    let beat_accent = sample_automation_accent(automation_context, ctx.accent);

    let mut matra_ids = Vec::with_capacity(spec.matra_count as usize);
    for matra_index in 0..spec.matra_count {
        let matra_id = tree.next_id();
        let section_relative_matra = spec.section_relative_matra_base + matra_index;
        let is_gati_start = matra_index == 0;
        let is_section_start = spec.is_section_start && matra_index == 0;
        let is_jathi_start = spec
            .jathi
            .map(|jathi| section_relative_matra % jathi == 0)
            .unwrap_or(false);
        let pulse_velocity = accented_velocity(
            beat_velocity,
            &beat_accent,
            is_gati_start,
            is_section_start,
            is_jathi_start,
            rng,
        );
        let mut tags = Vec::new();
        if is_gati_start {
            tags.push("beat-start".to_string());
        }
        if is_jathi_start {
            tags.push("jathi-start".to_string());
        }
        if is_section_start {
            tags.push("section-start-matra".to_string());
        }
        tree.nodes.insert(
            matra_id,
            DurationNode {
                id: matra_id,
                parent: Some(parent_id),
                duration: spec.matra_duration,
                accent_ref: ctx.accent_ref,
                kind: DurationKind::Pulse(PulseData {
                    event: PulseEvent::Note {
                        pitch: ValueSpec::fixed(beat_pitch),
                        duration_frac: Rational::new(1, 1),
                    },
                    velocity: ValueSpec::fixed(pulse_velocity),
                }),
                metadata: NodeMetadata {
                    label: Some(format!("{} matra {}", spec.label_prefix, matra_index + 1)),
                    color: None,
                    tags,
                },
            },
        );
        matra_ids.push(matra_id);
    }
    matra_ids
}

fn division_automation_beat_index(start: Rational, cycle_beats: u32) -> usize {
    if cycle_beats == 0 {
        return 0;
    }
    let beat = start.numer().div_euclid(*start.denom());
    beat.clamp(0, cycle_beats.saturating_sub(1) as i64) as usize
}

fn validate_subdivision_switch_inputs(
    args: &SubdivisionSwitchArgs<'_>,
) -> Result<(), TransformError> {
    if args.cycle_beats == 0 {
        return Err(invalid(
            args.transform_id,
            "SubdivisionSwitch",
            "cycle_beats must be greater than zero",
        ));
    }
    validate_gati_weights(args.transform_id, "initial_weights", args.initial_weights)?;
    validate_jathi_weights(
        args.transform_id,
        "initial_jathi_weights",
        args.initial_jathi_weights,
    )?;
    if let Some(custom) = args.initial_custom_subdivision {
        validate_custom_subdivision_spec(args.transform_id, "initial_custom_subdivision", custom)?;
    }

    let initial_may_use_per_beat = args
        .initial_custom_subdivision
        .map(|custom| custom.per_beat_weight > 0.0)
        .unwrap_or(true);
    if initial_may_use_per_beat
        && !args
            .initial_weights
            .iter()
            .any(|choice| choice.weight > 0.0)
    {
        return Err(invalid(
            args.transform_id,
            "SubdivisionSwitch",
            "initial_weights need a positive gati weight when the initial section can use per-beat gati",
        ));
    }
    validate_accent_spec(args.transform_id, args.accent)?;

    let zero = Rational::new(0, 1);
    let one = Rational::new(1, 1);
    let mut positions = Vec::with_capacity(args.inflections.len());
    for (i, inf) in args.inflections.iter().enumerate() {
        if !inf.change_probability.is_finite() || !(0.0..=1.0).contains(&inf.change_probability) {
            return Err(invalid(
                args.transform_id,
                "SubdivisionSwitch",
                &format!("inflection {} change probability must be 0.0-1.0", i + 1),
            ));
        }
        if inf.position <= zero || inf.position >= one {
            return Err(invalid(
                args.transform_id,
                "SubdivisionSwitch",
                &format!("inflection {} position must lie strictly in (0, 1)", i + 1),
            ));
        }
        let scaled = inf.position * Rational::from_integer(args.cycle_beats as i64);
        if *scaled.denom() != 1 {
            return Err(invalid(
                args.transform_id,
                "SubdivisionSwitch",
                &format!(
                    "inflection {} position must align to a whole beat boundary",
                    i + 1
                ),
            ));
        }
        positions.push(inf.position);
        validate_gati_weights(
            args.transform_id,
            &format!("inflection {} gati weights", i + 1),
            &inf.subdivision_weights,
        )?;
        validate_jathi_weights(
            args.transform_id,
            &format!("inflection {} jathi weights", i + 1),
            &inf.jathi_weights,
        )?;
        if let Some(custom) = &inf.custom_subdivision {
            validate_custom_subdivision_spec(
                args.transform_id,
                &format!("inflection {} custom_subdivision", i + 1),
                custom,
            )?;
            if inf.change_probability > 0.0
                && custom.per_beat_weight > 0.0
                && !inf
                    .subdivision_weights
                    .iter()
                    .any(|choice| choice.weight > 0.0)
            {
                return Err(invalid(
                    args.transform_id,
                    "SubdivisionSwitch",
                    &format!(
                        "inflection {} gati weights need a positive entry when per-beat mode is possible",
                        i + 1
                    ),
                ));
            }
        }
    }
    positions.sort_unstable();
    for window in positions.windows(2) {
        if window[0] == window[1] {
            return Err(invalid(
                args.transform_id,
                "SubdivisionSwitch",
                "inflection positions must be strictly distinct",
            ));
        }
    }
    if !args.switch_count_weights.is_empty() {
        if args
            .switch_count_weights
            .iter()
            .any(|choice| !choice.weight.is_finite() || choice.weight < 0.0)
        {
            return Err(invalid(
                args.transform_id,
                "SubdivisionSwitch",
                "switch_count_weights must contain finite weights >= 0",
            ));
        }
        if !args
            .switch_count_weights
            .iter()
            .any(|choice| choice.weight > 0.0)
        {
            return Err(invalid(
                args.transform_id,
                "SubdivisionSwitch",
                "switch_count_weights must have at least one positive weight",
            ));
        }
        if args
            .switch_count_weights
            .iter()
            .any(|choice| choice.count as usize > args.inflections.len())
        {
            return Err(invalid(
                args.transform_id,
                "SubdivisionSwitch",
                "switch counts cannot exceed the number of inflections",
            ));
        }
    }

    Ok(())
}

fn validate_custom_subdivision_spec(
    transform_id: u64,
    label: &str,
    custom: &CustomSubdivisionSpec,
) -> Result<(), TransformError> {
    custom.validate().map_err(|err| {
        invalid(
            transform_id,
            "SubdivisionSwitch",
            &format!("{label}: {err}"),
        )
    })
}

fn validate_gati_weights(
    transform_id: u64,
    label: &str,
    weights: &[WeightedSubdivisionChoice],
) -> Result<(), TransformError> {
    for choice in weights {
        if choice.subdivision == 0 || choice.subdivision > 64 {
            return Err(invalid(
                transform_id,
                "SubdivisionSwitch",
                &format!("{label} gati choices must be 1-64"),
            ));
        }
        if !choice.weight.is_finite() || choice.weight < 0.0 {
            return Err(invalid(
                transform_id,
                "SubdivisionSwitch",
                &format!("{label} weights must be finite values >= 0"),
            ));
        }
    }
    Ok(())
}

fn validate_jathi_weights(
    transform_id: u64,
    label: &str,
    weights: &[WeightedJathiChoice],
) -> Result<(), TransformError> {
    for choice in weights {
        if !is_allowed_jathi(choice.jathi) {
            return Err(invalid(
                transform_id,
                "SubdivisionSwitch",
                &format!("{label} jathi choices must be one of 3, 4, 5, 6, 7, 9, 11"),
            ));
        }
        if !choice.weight.is_finite() || choice.weight < 0.0 {
            return Err(invalid(
                transform_id,
                "SubdivisionSwitch",
                &format!("{label} weights must be finite values >= 0"),
            ));
        }
    }
    Ok(())
}

fn validate_accent_spec(
    transform_id: u64,
    accent: &cseq_model::GatiAccentSpec,
) -> Result<(), TransformError> {
    for (label, range) in [
        ("beat start accent", &accent.beat_start),
        ("section start extra accent", &accent.section_start_extra),
        ("jathi start accent", &accent.jathi_start),
    ] {
        if range.min > range.max {
            return Err(invalid(
                transform_id,
                "SubdivisionSwitch",
                &format!("{label} min must be <= max"),
            ));
        }
        if range.max > 127 {
            return Err(invalid(
                transform_id,
                "SubdivisionSwitch",
                &format!("{label} values must be 0-127"),
            ));
        }
    }
    Ok(())
}

/// One resolved equal part of a custom-subdivided section. The part occupies an
/// equal `1/N` fraction of the section span and carries the grid-wide sampled
/// gati.
#[derive(Debug, Clone)]
struct ResolvedDivision {
    /// Grid-wide sampled gati for this part (matras = gati; no speed in v1).
    gati: u32,
    /// Matras in this division.
    matra_count: u32,
    /// Exact start of this division within the cycle (in beat units).
    start: Rational,
    /// Exact duration of this division (in beat units; equals beat_count / N).
    duration: Rational,
    /// Running matra offset of this division within the section.
    start_matra: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ResolvedCustomGrid {
    part_count: u32,
    grid_gati: u32,
}

#[derive(Debug, Clone)]
struct ResolvedCustomSection {
    /// `Some` means equal-parts won the stochastic request. `None` means the
    /// custom spec was active but the requested section stayed on per-beat gati.
    requested_grid: Option<ResolvedCustomGrid>,
}

#[derive(Debug, Clone)]
enum ResolvedCustomBoundaryChoice {
    EqualParts(ResolvedCustomSection),
    PerBeatGati {
        custom: ResolvedCustomSection,
        gati: u32,
    },
}

#[derive(Debug, Clone)]
struct ResolvedSectionPlan {
    /// One-based section index for human-facing UI/readouts.
    index: u32,
    /// Zero-based beat index where the section starts.
    start_beat: u32,
    /// Zero-based exclusive beat index where the section ends.
    end_beat: u32,
    gati: u32,
    section_matra_len: u32,
    gati_frame_beats: u32,
    gati_frame_matras: u32,
    jathi: Option<u32>,
    jathi_frame_pulses: Option<u32>,
    jathi_frame_matras: Option<u32>,
    /// `Some` => custom-subdivided section: the section span is split into these
    /// equal parts, all using the same grid-wide gati. `None` => uniform-gati
    /// section (all existing fields above describe the single gati grid). When
    /// `Some`, `section_matra_len`/`jathi*` still summarize the section as a
    /// whole (sum of part matras + the single section jathi tiling that total).
    custom: Option<Vec<ResolvedDivision>>,
}

impl ResolvedSectionPlan {
    fn beat_matra_count(&self) -> u32 {
        if self.gati_frame_beats == 1 {
            self.gati_frame_matras
        } else {
            self.gati
        }
    }
}

fn resolve_section_plans(
    beat_gatis: &[u32],
    section_starts: &[bool],
    section_jathi_weights: &[Vec<WeightedJathiChoice>],
    section_custom: &[Option<ResolvedCustomSection>],
    transform_id: u64,
) -> Result<Vec<ResolvedSectionPlan>, TransformError> {
    if beat_gatis.is_empty() {
        return Ok(vec![]);
    }
    // Section boundary beats (start of each run). Beat 0 always starts one.
    let mut boundaries = vec![0usize];
    for beat_index in 1..beat_gatis.len() {
        if section_starts.get(beat_index).copied().unwrap_or(false) {
            boundaries.push(beat_index);
        }
    }

    let mut plans = Vec::with_capacity(boundaries.len());
    for (i, &start) in boundaries.iter().enumerate() {
        let end_beat = boundaries.get(i + 1).copied().unwrap_or(beat_gatis.len());
        let request = SectionPlanRequest {
            index: i as u32 + 1,
            start_beat: start,
            end_beat,
            gati: beat_gatis[start],
            jathi_weights: section_jathi_weights
                .get(start)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            custom: section_custom.get(start).and_then(Option::as_ref),
            transform_id,
        };
        let plan = resolve_section_plan(request, plans.last())?;
        plans.push(plan);
    }

    Ok(plans)
}

fn resolve_fixed_boundaries(
    inflections: &[SubdivisionInflection],
    transform_id: u64,
) -> Result<(Vec<bool>, Vec<Option<ResolvedCustomBoundaryChoice>>), TransformError> {
    let fired = vec![true; inflections.len()];
    let mut custom_choices = Vec::with_capacity(inflections.len());
    for (index, inflection) in inflections.iter().enumerate() {
        custom_choices.push(resolve_fixed_custom_boundary_choice(
            index,
            inflection,
            transform_id,
        )?);
    }

    Ok((fired, custom_choices))
}

fn resolve_fixed_custom_boundary_choice(
    index: usize,
    inflection: &SubdivisionInflection,
    transform_id: u64,
) -> Result<Option<ResolvedCustomBoundaryChoice>, TransformError> {
    let Some(custom) = inflection.custom_subdivision.as_ref() else {
        return Ok(None);
    };
    if choose_fixed_equal_parts_mode(custom) {
        return Ok(Some(ResolvedCustomBoundaryChoice::EqualParts(
            resolve_fixed_custom_section(custom, transform_id)?,
        )));
    }

    let gati =
        choose_fixed_subdivision(&inflection.subdivision_weights, None).ok_or_else(|| {
            invalid(
                transform_id,
                "SubdivisionSwitch",
                &format!(
                    "fired inflection {} has no positive gati weights",
                    index + 1
                ),
            )
        })?;
    Ok(Some(ResolvedCustomBoundaryChoice::PerBeatGati {
        custom: ResolvedCustomSection {
            requested_grid: None,
        },
        gati,
    }))
}

fn choose_fixed_equal_parts_mode(custom: &CustomSubdivisionSpec) -> bool {
    let per_beat = custom.per_beat_weight.max(0.0);
    let equal_parts = custom.equal_parts_weight.max(0.0);
    equal_parts > 0.0 && equal_parts > per_beat
}

fn resolve_fixed_custom_section(
    custom: &CustomSubdivisionSpec,
    transform_id: u64,
) -> Result<ResolvedCustomSection, TransformError> {
    let requested_grid = if choose_fixed_equal_parts_mode(custom) {
        Some(resolve_fixed_custom_grid(custom, transform_id)?)
    } else {
        None
    };
    Ok(ResolvedCustomSection { requested_grid })
}

fn resolve_fixed_custom_grid(
    custom: &CustomSubdivisionSpec,
    transform_id: u64,
) -> Result<ResolvedCustomGrid, TransformError> {
    let part_count = choose_fixed_weighted_value(
        custom
            .part_count_weights
            .iter()
            .map(|choice| (choice.count, choice.weight)),
    )
    .ok_or_else(|| {
        invalid(
            transform_id,
            "SubdivisionSwitch",
            "equal-parts grid has no positive part-count choices",
        )
    })?;
    if part_count == 0 {
        return Err(invalid(
            transform_id,
            "SubdivisionSwitch",
            "custom subdivision needs at least one equal part",
        ));
    }
    let gati_weights = custom_grid_gati_weights(custom).ok_or_else(|| {
        invalid(
            transform_id,
            "SubdivisionSwitch",
            "equal-parts grid has no gati weights",
        )
    })?;
    let grid_gati = choose_fixed_subdivision(gati_weights, None).ok_or_else(|| {
        invalid(
            transform_id,
            "SubdivisionSwitch",
            "equal-parts grid has no positive gati weights",
        )
    })?;
    Ok(ResolvedCustomGrid {
        part_count,
        grid_gati,
    })
}

struct SectionPlanRequest<'a> {
    index: u32,
    start_beat: usize,
    end_beat: usize,
    gati: u32,
    jathi_weights: &'a [WeightedJathiChoice],
    custom: Option<&'a ResolvedCustomSection>,
    transform_id: u64,
}

fn resolve_section_plan(
    request: SectionPlanRequest<'_>,
    _previous: Option<&ResolvedSectionPlan>,
) -> Result<ResolvedSectionPlan, TransformError> {
    let SectionPlanRequest {
        index,
        start_beat,
        end_beat,
        gati,
        jathi_weights,
        custom,
        transform_id,
    } = request;

    let requested = if let Some(custom_grid) =
        custom.and_then(|custom_section| custom_section.requested_grid.as_ref())
    {
        // Custom-subdivided section: split the span into N equal parts, each
        // using the same fixed grid-wide subdivision. Grouping is resolved over
        // the section's total matras.
        resolve_custom_section_plan(CustomSectionPlanRequest {
            index,
            start_beat,
            end_beat,
            custom: custom_grid,
            jathi_weights,
            transform_id,
        })
    } else {
        let beat_count = end_beat.saturating_sub(start_beat) as u32;
        let total_matras = gati.saturating_mul(beat_count);
        let jathi = choose_fixed_jathi(jathi_weights, total_matras, gati);

        Ok(ResolvedSectionPlan {
            index,
            start_beat: start_beat as u32,
            end_beat: end_beat as u32,
            gati,
            section_matra_len: total_matras,
            gati_frame_beats: 1,
            gati_frame_matras: gati,
            jathi,
            jathi_frame_pulses: jathi.map(|_| 1),
            jathi_frame_matras: jathi,
            custom: None,
        })
    }?;

    Ok(requested)
}

struct CustomSectionPlanRequest<'a> {
    index: u32,
    start_beat: usize,
    end_beat: usize,
    custom: &'a ResolvedCustomGrid,
    jathi_weights: &'a [WeightedJathiChoice],
    transform_id: u64,
}

/// Resolve an equal-parts section: first sample the part count, then sample one
/// grid-wide subdivision. The section span (`end_beat - start_beat` cycle-beats)
/// is split into that many equal notes. Grouping tiles the section's total
/// matras as the active accent layer.
fn resolve_custom_section_plan(
    request: CustomSectionPlanRequest<'_>,
) -> Result<ResolvedSectionPlan, TransformError> {
    let CustomSectionPlanRequest {
        index,
        start_beat,
        end_beat,
        custom,
        jathi_weights,
        transform_id,
    } = request;
    let beat_count = end_beat.saturating_sub(start_beat) as u32;
    let n = custom.part_count;
    if n == 0 {
        return Err(invalid(
            transform_id,
            "SubdivisionSwitch",
            "custom subdivision needs at least one equal part",
        ));
    }
    let (divisions, total_matras) =
        custom_divisions(start_beat, end_beat, custom).ok_or_else(|| {
            invalid(
                transform_id,
                "SubdivisionSwitch",
                "custom subdivision needs at least one equal part",
            )
        })?;

    // One jathi over the whole section's matras: it must divide `total_matras`
    // (and not be the degenerate whole-section pulse). Pass `total_matras` as the
    // frame so the "subset of gati pulses" guard only rejects jathi == total.
    let jathi = choose_fixed_jathi(jathi_weights, total_matras, total_matras);
    Ok(ResolvedSectionPlan {
        index,
        start_beat: start_beat as u32,
        end_beat: end_beat as u32,
        // Summary fields describe the section as a whole. `gati` is reported as
        // the first equal part's gati for readouts; the authoritative layout is in
        // `custom`. There is no single uniform gati frame, so frame fields cover
        // the whole section (1 frame of `total_matras`).
        gati: divisions.first().map(|d| d.gati).unwrap_or(1),
        section_matra_len: total_matras,
        gati_frame_beats: beat_count.max(1),
        gati_frame_matras: total_matras,
        jathi,
        jathi_frame_pulses: jathi.map(|_| 1),
        jathi_frame_matras: jathi,
        custom: Some(divisions),
    })
}

fn custom_divisions(
    start_beat: usize,
    end_beat: usize,
    custom: &ResolvedCustomGrid,
) -> Option<(Vec<ResolvedDivision>, u32)> {
    let beat_count = end_beat.saturating_sub(start_beat) as u32;
    let n = custom.part_count;
    if n == 0 {
        return None;
    }
    let section_start = Rational::from_integer(start_beat as i64);
    let division_duration = Rational::new(beat_count as i64, n as i64);
    let mut divisions = Vec::with_capacity(n as usize);
    let mut running_matra = 0u32;
    let gati = custom.grid_gati;
    for i in 0..n as usize {
        let start = section_start + division_duration * Rational::from_integer(i as i64);
        divisions.push(ResolvedDivision {
            gati,
            matra_count: gati,
            start,
            duration: division_duration,
            start_matra: running_matra,
        });
        running_matra = running_matra.saturating_add(gati);
    }
    Some((divisions, running_matra))
}

fn custom_grid_gati_weights(
    custom: &CustomSubdivisionSpec,
) -> Option<&[WeightedSubdivisionChoice]> {
    if !custom.part_gati_weights.is_empty() {
        return Some(&custom.part_gati_weights);
    }
    custom
        .divisions
        .first()
        .map(|division| division.gati_weights.as_slice())
}

fn valid_jathi_for_section(jathi: u32, total_matras: u32, gati_frame_matras: u32) -> bool {
    total_matras > 0
        && gati_frame_matras > 0
        && is_allowed_jathi(jathi)
        && total_matras % jathi == 0
        && !jathi_is_subset_of_gati_pulses(jathi, gati_frame_matras)
}

fn custom_matra_boundary_time(
    section: &ResolvedSectionPlan,
    divisions: &[ResolvedDivision],
    boundary_matra: u32,
) -> Option<Rational> {
    if boundary_matra == section.section_matra_len {
        return Some(Rational::from_integer(section.end_beat as i64));
    }

    for division in divisions {
        let start_matra = division.start_matra;
        let end_matra = start_matra.checked_add(division.matra_count)?;
        if boundary_matra >= start_matra && boundary_matra <= end_matra {
            if division.matra_count == 0 {
                return None;
            }
            let relative_matra = boundary_matra - start_matra;
            return Some(
                division.start
                    + division.duration
                        * Rational::new(relative_matra as i64, division.matra_count as i64),
            );
        }
    }

    None
}

fn section_matra_span_time(
    section: &ResolvedSectionPlan,
    start_matra: u32,
    matra_len: u32,
) -> Option<(Rational, Rational)> {
    if matra_len == 0 {
        return None;
    }
    let end_matra = start_matra.checked_add(matra_len)?;
    if end_matra > section.section_matra_len {
        return None;
    }

    if let Some(divisions) = &section.custom {
        let start = custom_matra_boundary_time(section, divisions, start_matra)?;
        let end = custom_matra_boundary_time(section, divisions, end_matra)?;
        return (end > start).then_some((start, end - start));
    }

    if section.section_matra_len == 0 {
        return None;
    }
    let beat_count = section.end_beat.saturating_sub(section.start_beat);
    let section_start = Rational::from_integer(section.start_beat as i64);
    let start = section_start
        + Rational::new(
            (start_matra * beat_count) as i64,
            section.section_matra_len as i64,
        );
    let duration = Rational::new(
        (matra_len * beat_count) as i64,
        section.section_matra_len as i64,
    );
    Some((start, duration))
}

fn emit_pulse_spans(tree: &mut DurationTree, sections: &[ResolvedSectionPlan]) {
    for section in sections {
        let beat_count = section.end_beat.saturating_sub(section.start_beat);
        let total_matras = section.section_matra_len;
        let section_start = Rational::from_integer(section.start_beat as i64);
        let section_duration = Rational::from_integer(beat_count as i64);

        tree.push_pulse_span(
            PulseSpanKind::Section {
                index: section.index,
            },
            section_start,
            section_duration,
            0,
            total_matras,
            vec!["section".to_string(), "protected-accent-span".to_string()],
        );

        if let Some(divisions) = &section.custom {
            // One gati-beat accent span per custom equal part, at its own exact
            // fractional start/duration. `beat` carries the 1-based equal-part
            // index (used only as a label/id seed). Tagging them `gati-beat`
            // keeps the rhythm partitioner treating each equal part as one frame.
            for (i, division) in divisions.iter().enumerate() {
                tree.push_pulse_span(
                    PulseSpanKind::GatiBeat {
                        section_index: section.index,
                        beat: i as u32 + 1,
                        gati: division.gati,
                    },
                    division.start,
                    division.duration,
                    division.start_matra,
                    division.matra_count,
                    vec![
                        "gati-beat".to_string(),
                        "custom-division".to_string(),
                        "protected-accent-span".to_string(),
                    ],
                );
            }
        } else {
            let gati_frame_beats = section.gati_frame_beats.max(1);
            let gati_frame_count = beat_count / gati_frame_beats;
            for frame_index in 0..gati_frame_count {
                let beat = section.start_beat + frame_index * gati_frame_beats;
                let section_relative_matra = frame_index * section.gati_frame_matras;
                tree.push_pulse_span(
                    PulseSpanKind::GatiBeat {
                        section_index: section.index,
                        beat: beat + 1,
                        gati: section.gati,
                    },
                    Rational::from_integer(beat as i64),
                    Rational::from_integer(gati_frame_beats as i64),
                    section_relative_matra,
                    section.gati_frame_matras,
                    vec!["gati-beat".to_string(), "protected-accent-span".to_string()],
                );
            }
        }

        if let Some(jathi) = section.jathi {
            let pulse_count = total_matras / jathi;
            let jathi_frame_pulses = section.jathi_frame_pulses.unwrap_or(1).max(1);
            let jathi_frame_matras = section.jathi_frame_matras.unwrap_or(jathi);
            let jathi_frame_count = pulse_count / jathi_frame_pulses;
            for frame_index in 0..jathi_frame_count {
                let pulse_index = frame_index * jathi_frame_pulses;
                let start_matra = pulse_index * jathi;
                let jathi_matras = jathi * jathi_frame_pulses;
                let Some((start, duration)) =
                    section_matra_span_time(section, start_matra, jathi_matras)
                else {
                    continue;
                };
                tree.push_pulse_span(
                    PulseSpanKind::JathiPulse {
                        section_index: section.index,
                        jathi,
                        index: pulse_index + 1,
                    },
                    start,
                    duration,
                    start_matra,
                    jathi_frame_matras,
                    vec![
                        "jathi-pulse".to_string(),
                        "protected-accent-span".to_string(),
                    ],
                );
            }
        }
    }
}

/// Translate a legacy weighted list to one fixed authored value. The largest
/// positive weight wins; ties preserve authored order.
fn choose_fixed_weighted_value(choices: impl IntoIterator<Item = (u32, f32)>) -> Option<u32> {
    let mut selected: Option<(u32, f32)> = None;
    for (value, weight) in choices {
        if weight > 0.0 && selected.map_or(true, |(_, selected_weight)| weight > selected_weight) {
            selected = Some((value, weight));
        }
    }
    selected.map(|(value, _)| value)
}

fn choose_fixed_subdivision(
    weights: &[WeightedSubdivisionChoice],
    exclude: Option<u32>,
) -> Option<u32> {
    choose_fixed_weighted_value(weights.iter().filter_map(|choice| {
        (Some(choice.subdivision) != exclude).then_some((choice.subdivision, choice.weight))
    }))
}

fn choose_fixed_jathi(
    weights: &[WeightedJathiChoice],
    total_matras: u32,
    gati: u32,
) -> Option<u32> {
    if total_matras == 0 || gati == 0 {
        return None;
    }
    choose_fixed_weighted_value(weights.iter().filter_map(|choice| {
        valid_jathi_for_section(choice.jathi, total_matras, gati)
            .then_some((choice.jathi, choice.weight))
    }))
}

fn jathi_is_subset_of_gati_pulses(jathi: u32, gati: u32) -> bool {
    gati != 0 && jathi % gati == 0
}

fn accented_velocity(
    base: u8,
    accent: &cseq_model::GatiAccentSpec,
    gati_start: bool,
    section_start: bool,
    jathi_start: bool,
    rng: &mut SplitMix64,
) -> u8 {
    let mut velocity = base;
    match accent.jathi_mode {
        JathiAccentMode::OverrideGati => {
            if jathi_start {
                velocity = velocity.saturating_add(sample_velocity_boost(&accent.jathi_start, rng));
            } else if gati_start {
                velocity = velocity.saturating_add(sample_velocity_boost(&accent.beat_start, rng));
            }
        }
        JathiAccentMode::Layered => {
            if gati_start {
                velocity = velocity.saturating_add(sample_velocity_boost(&accent.beat_start, rng));
            }
            if jathi_start {
                velocity = velocity.saturating_add(sample_velocity_boost(&accent.jathi_start, rng));
            }
        }
    }

    let section_boost = if section_start {
        sample_velocity_boost(&accent.section_start_extra, rng)
    } else {
        0
    };
    velocity.saturating_add(section_boost).clamp(1, 127)
}

fn sample_automation_u8(
    context: AutomationBeatContext<'_>,
    target: &str,
    base: u8,
    min: u8,
    max: u8,
) -> u8 {
    let Some(value) = context.automation.and_then(|set| {
        set.sample_typed_number(
            target,
            context.cycle,
            context.beat_index,
            context.cycle_beats,
            f64::from(base),
            AutomationValueKind::Integer,
            f64::from(min),
            f64::from(max),
        )
    }) else {
        return base.clamp(min, max);
    };
    value.round().clamp(f64::from(min), f64::from(max)) as u8
}

fn sample_automation_accent(
    context: AutomationBeatContext<'_>,
    base: &cseq_model::GatiAccentSpec,
) -> cseq_model::GatiAccentSpec {
    let mut accent = base.clone();
    accent.beat_start.min = sample_automation_u8(
        context,
        AUTOMATION_TARGET_BEAT_ACCENT_MIN,
        base.beat_start.min,
        0,
        127,
    );
    accent.beat_start.max = sample_automation_u8(
        context,
        AUTOMATION_TARGET_BEAT_ACCENT_MAX,
        base.beat_start.max,
        0,
        127,
    );
    accent.section_start_extra.min = sample_automation_u8(
        context,
        AUTOMATION_TARGET_SECTION_ACCENT_MIN,
        base.section_start_extra.min,
        0,
        127,
    );
    accent.section_start_extra.max = sample_automation_u8(
        context,
        AUTOMATION_TARGET_SECTION_ACCENT_MAX,
        base.section_start_extra.max,
        0,
        127,
    );
    accent.jathi_start.min = sample_automation_u8(
        context,
        AUTOMATION_TARGET_JATHI_ACCENT_MIN,
        base.jathi_start.min,
        0,
        127,
    );
    accent.jathi_start.max = sample_automation_u8(
        context,
        AUTOMATION_TARGET_JATHI_ACCENT_MAX,
        base.jathi_start.max,
        0,
        127,
    );
    accent
}

fn sample_velocity_boost(range: &cseq_model::VelocityAccentRange, rng: &mut SplitMix64) -> u8 {
    let lo = range.min.min(range.max);
    let hi = range.min.max(range.max);
    if lo == hi {
        return lo;
    }
    let span = u16::from(hi) - u16::from(lo) + 1;
    let offset = (rng.next_u64() % u64::from(span)) as u16;
    (u16::from(lo) + offset) as u8
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SwitchSeedResolution {
    seed: u64,
    source: SwitchSeedTraceSource,
    history_before: Vec<u64>,
    history_after: Vec<u64>,
}

fn resolve_seed(
    seed_mode: &mut SwitchSeedMode,
    cycle: u64,
    transform_id: u64,
    seed_replay: Option<&mut SwitchSeedReplayCursor<'_>>,
) -> Result<SwitchSeedResolution, TransformError> {
    if let Some(entry) = seed_replay.and_then(SwitchSeedReplayCursor::next) {
        if let SwitchSeedMode::History { history, .. } = seed_mode {
            *history = entry.history_after.clone();
        }
        return Ok(SwitchSeedResolution {
            seed: entry.seed,
            source: entry.source,
            history_before: entry.history_before.clone(),
            history_after: entry.history_after.clone(),
        });
    }

    match seed_mode {
        SwitchSeedMode::Locked { seed } => Ok(SwitchSeedResolution {
            seed: *seed,
            source: SwitchSeedTraceSource::Locked,
            history_before: vec![],
            history_after: vec![],
        }),
        SwitchSeedMode::PerCycle { seed } => Ok(SwitchSeedResolution {
            seed: mix_seed(*seed, cycle),
            source: SwitchSeedTraceSource::PerCycle,
            history_before: vec![],
            history_after: vec![],
        }),
        SwitchSeedMode::History {
            seed,
            history,
            history_weight,
            new_seed_weight,
            max_history,
        } => {
            if *max_history == 0 {
                history.clear();
            } else {
                while history.len() > *max_history {
                    history.remove(0);
                }
            }
            let history_before = history.clone();
            let mut rng = SplitMix64::new(mix_seed(*seed, cycle));
            let can_use_history = !history.is_empty() && *history_weight > 0.0;
            let can_make_new = *new_seed_weight > 0.0;
            if !can_use_history && !can_make_new {
                return Err(invalid(
                    transform_id,
                    "SubdivisionSwitch",
                    "history seed mode has no positive history or new-seed weight",
                ));
            }
            let use_history = if can_use_history {
                let total = history_weight.max(0.0) + new_seed_weight.max(0.0);
                total > f32::EPSILON && rng.next_f32() * total < history_weight.max(0.0)
            } else {
                false
            };

            if use_history {
                let index = (rng.next_u64() as usize) % history.len();
                Ok(SwitchSeedResolution {
                    seed: history[index],
                    source: SwitchSeedTraceSource::History,
                    history_before,
                    history_after: history.clone(),
                })
            } else {
                let new_seed = rng.next_u64();
                if *max_history > 0 {
                    history.push(new_seed);
                    while history.len() > *max_history {
                        history.remove(0);
                    }
                }
                Ok(SwitchSeedResolution {
                    seed: new_seed,
                    source: SwitchSeedTraceSource::New,
                    history_before,
                    history_after: history.clone(),
                })
            }
        }
    }
}

fn invalid(transform_id: u64, kind: &str, reason: &str) -> TransformError {
    TransformError::InvalidTarget {
        transform_id,
        kind: kind.to_string(),
        reason: reason.to_string(),
    }
}

fn mix_seed(seed: u64, cycle: u64) -> u64 {
    let mut x = seed ^ cycle.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    x ^= x >> 30;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        mix_seed(self.state, 0)
    }

    fn next_f32(&mut self) -> f32 {
        let value = self.next_u64() >> 40;
        value as f32 / (1u32 << 24) as f32
    }
}

fn apply_set_velocity(
    tree: &mut DurationTree,
    node_id: NodeId,
    velocity: &ValueSpec<u8>,
    transform_id: u64,
) -> Result<(), TransformError> {
    let node = tree
        .nodes
        .get_mut(&node_id)
        .ok_or_else(|| TransformError::TargetNotFound {
            transform_id,
            selector: format!("ById({node_id})"),
        })?;

    match &mut node.kind {
        DurationKind::Pulse(pd) => {
            pd.velocity = velocity.clone();
        }
        _ => {
            let children: Vec<NodeId> = match &node.kind {
                DurationKind::Subdivided { children, .. } => children.clone(),
                DurationKind::Tied { children } => children.clone(),
                _ => return Ok(()),
            };
            for child_id in children {
                apply_set_velocity(tree, child_id, velocity, transform_id)?;
            }
        }
    }

    Ok(())
}

fn apply_tie(
    tree: &mut DurationTree,
    node_id: NodeId,
    pattern: &TiePattern,
    transform_id: u64,
) -> Result<(), TransformError> {
    let node = tree
        .nodes
        .get(&node_id)
        .ok_or_else(|| TransformError::TargetNotFound {
            transform_id,
            selector: format!("ById({node_id})"),
        })?;

    let (children, policy) = match &node.kind {
        DurationKind::Subdivided { children, policy } => (children.clone(), policy.clone()),
        other => {
            return Err(TransformError::InvalidTarget {
                transform_id,
                kind: "Tie".to_string(),
                reason: format!(
                    "expected Subdivided, got {:?}",
                    std::mem::discriminant(other)
                ),
            });
        }
    };
    let child_fractions =
        effective_child_fractions(tree, &children, &policy, transform_id, "Tie", node_id)?;

    match pattern {
        TiePattern::All => {
            // Replace the Subdivided node with a Tied node using the same
            // children, preserving the effective timing from the original
            // subdivision policy in each child's duration field.
            for (&child_id, duration) in children.iter().zip(child_fractions.iter().copied()) {
                if let Some(child) = tree.nodes.get_mut(&child_id) {
                    child.duration = duration;
                }
            }
            if let Some(node) = tree.nodes.get_mut(&node_id) {
                node.kind = DurationKind::Tied { children };
            }
        }
        TiePattern::Pairs => {
            // Group children into consecutive pairs, each pair becomes a Tied node.
            // If odd count, last child stays as-is.
            let accent_ref = tree.nodes.get(&node_id).and_then(|n| n.accent_ref);
            let mut new_children = Vec::new();

            let mut i = 0;
            while i < children.len() {
                if i + 1 < children.len() {
                    // Create a new Tied node wrapping this pair.
                    let tied_id = tree.next_id();
                    let pair = vec![children[i], children[i + 1]];
                    let pair_dur = child_fractions[i] + child_fractions[i + 1];
                    if pair_dur <= Rational::new(0, 1) {
                        return Err(invalid(
                            transform_id,
                            "Tie",
                            "pair duration must be positive",
                        ));
                    }
                    // Update children's parent to the new tied node.
                    for (pair_index, &cid) in pair.iter().enumerate() {
                        if let Some(c) = tree.nodes.get_mut(&cid) {
                            c.parent = Some(tied_id);
                            c.duration = child_fractions[i + pair_index] / pair_dur;
                        }
                    }
                    tree.nodes.insert(
                        tied_id,
                        DurationNode {
                            id: tied_id,
                            parent: Some(node_id),
                            duration: pair_dur,
                            accent_ref,
                            kind: DurationKind::Tied { children: pair },
                            metadata: NodeMetadata::default(),
                        },
                    );
                    new_children.push(tied_id);
                    i += 2;
                } else {
                    if let Some(child) = tree.nodes.get_mut(&children[i]) {
                        child.duration = child_fractions[i];
                        child.parent = Some(node_id);
                    }
                    new_children.push(children[i]);
                    i += 1;
                }
            }

            if let Some(node) = tree.nodes.get_mut(&node_id) {
                node.kind = DurationKind::Subdivided {
                    children: new_children,
                    policy: SubdivisionPolicy::Explicit,
                };
            }
        }
    }

    Ok(())
}

fn apply_remove(tree: &mut DurationTree, node_id: NodeId) {
    let mut descendants = Vec::new();
    collect_descendant_ids(tree, node_id, &mut descendants);
    for descendant in descendants {
        tree.nodes.remove(&descendant);
    }

    // Replace the node with a Rest pulse (preserves timing, silences output).
    if let Some(node) = tree.nodes.get_mut(&node_id) {
        node.kind = DurationKind::Pulse(PulseData {
            event: PulseEvent::Rest,
            velocity: ValueSpec::fixed(0),
        });
    }
}

fn collect_descendant_ids(tree: &DurationTree, node_id: NodeId, out: &mut Vec<NodeId>) {
    let Some(node) = tree.nodes.get(&node_id) else {
        return;
    };
    let children = match &node.kind {
        DurationKind::Subdivided { children, .. } | DurationKind::Tied { children } => {
            children.clone()
        }
        _ => Vec::new(),
    };
    for child in children {
        collect_descendant_ids(tree, child, out);
        out.push(child);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use cseq_model::SubdivisionPolicy;

    fn chatusra_score() -> Score {
        Score::subdivided("test", &[60, 62, 64, 65], 100, SubdivisionPolicy::Equal)
    }

    fn realized_matra_velocities(tree: &DurationTree) -> Vec<u8> {
        let root = tree.get(tree.root).unwrap();
        let beats = match &root.kind {
            DurationKind::Subdivided { children, .. } => children.clone(),
            _ => panic!("expected beat grid"),
        };

        beats
            .iter()
            .flat_map(|beat_id| match &tree.get(*beat_id).unwrap().kind {
                DurationKind::Subdivided { children, .. } => children.clone(),
                _ => panic!("expected beat subdivided into matras"),
            })
            .map(|matra_id| match &tree.get(matra_id).unwrap().kind {
                DurationKind::Pulse(pulse) => *pulse.velocity.as_fixed().unwrap(),
                _ => panic!("expected pulse matra"),
            })
            .collect()
    }

    fn direct_switch_score(
        cycle_beats: u32,
        inflections: Vec<cseq_model::SubdivisionInflection>,
        switch_count_weights: Vec<cseq_model::WeightedSwitchCount>,
    ) -> Score {
        let mut score = Score::single_pulse("switch", 60, 96);
        score.cycle_length = Rational::from_integer(cycle_beats as i64);
        score.add_transform(
            TransformKind::SubdivisionSwitch {
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections,
                switch_count_weights,
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 7 },
                pitch: ValueSpec::fixed(60),
                velocity: ValueSpec::fixed(96),
                accent: cseq_model::GatiAccentSpec::default(),
            },
            NodeSelector::Root,
            None,
        );
        score
    }

    fn switch_transform_mut(score: &mut Score) -> &mut TransformKind {
        &mut score.pipeline[0].kind
    }

    fn zero_accent() -> cseq_model::GatiAccentSpec {
        cseq_model::GatiAccentSpec {
            beat_start: cseq_model::VelocityAccentRange { min: 0, max: 0 },
            section_start_extra: cseq_model::VelocityAccentRange { min: 0, max: 0 },
            jathi_start: cseq_model::VelocityAccentRange { min: 0, max: 0 },
            jathi_mode: cseq_model::JathiAccentMode::OverrideGati,
        }
    }

    fn automation_set(
        length_cycles: u32,
        target: &str,
        points: &[(u64, u64, f64)],
    ) -> cseq_model::AutomationSet {
        cseq_model::AutomationSet {
            length_cycles,
            markers: Vec::new(),
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
                    points: points
                        .iter()
                        .map(|(numer, denom, value)| cseq_model::AutomationPoint {
                            id: None,
                            time: cseq_model::AutomationTime::new(*numer, *denom).unwrap(),
                            value: cseq_model::AutomationValue::Number { value: *value },
                            anchor_id: None,
                            out_curve: None,
                        })
                        .collect(),
                }],
            }],
        }
    }

    fn automated_switch_score(
        automation: cseq_model::AutomationSet,
        pitch: u8,
        velocity: u8,
    ) -> Score {
        Score::subdivision_switch(
            "automation",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 4,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 1,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: Some(automation),
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: zero_accent(),
                pitch,
                velocity,
            },
        )
    }

    fn first_matra_pitches(tree: &DurationTree) -> Vec<u8> {
        let root = tree.get(tree.root).unwrap();
        let beat_ids = match &root.kind {
            DurationKind::Subdivided { children, .. } => children,
            _ => panic!("expected beat grid"),
        };
        beat_ids
            .iter()
            .map(|beat_id| {
                let beat = tree.get(*beat_id).unwrap();
                let matra_id = match &beat.kind {
                    DurationKind::Subdivided { children, .. } => children[0],
                    _ => panic!("expected matra grid"),
                };
                let matra = tree.get(matra_id).unwrap();
                match &matra.kind {
                    DurationKind::Pulse(pulse) => match &pulse.event {
                        PulseEvent::Note { pitch, .. } => *pitch.as_fixed().unwrap(),
                        _ => panic!("expected note"),
                    },
                    _ => panic!("expected pulse"),
                }
            })
            .collect()
    }

    fn first_matra_velocities(tree: &DurationTree) -> Vec<u8> {
        let root = tree.get(tree.root).unwrap();
        let beat_ids = match &root.kind {
            DurationKind::Subdivided { children, .. } => children,
            _ => panic!("expected beat grid"),
        };
        beat_ids
            .iter()
            .map(|beat_id| {
                let beat = tree.get(*beat_id).unwrap();
                let matra_id = match &beat.kind {
                    DurationKind::Subdivided { children, .. } => children[0],
                    _ => panic!("expected matra grid"),
                };
                let matra = tree.get(matra_id).unwrap();
                match &matra.kind {
                    DurationKind::Pulse(pulse) => *pulse.velocity.as_fixed().unwrap(),
                    _ => panic!("expected pulse"),
                }
            })
            .collect()
    }

    fn custom_division_first_matra_pitches(tree: &DurationTree) -> Vec<u8> {
        let root = tree.get(tree.root).unwrap();
        let section_ids = match &root.kind {
            DurationKind::Subdivided { children, .. } => children,
            _ => panic!("expected custom section grid"),
        };
        let section = tree.get(section_ids[0]).unwrap();
        let division_ids = match &section.kind {
            DurationKind::Subdivided { children, .. } => children,
            _ => panic!("expected custom equal parts"),
        };
        division_ids
            .iter()
            .map(|division_id| {
                let division = tree.get(*division_id).unwrap();
                let matra_id = match &division.kind {
                    DurationKind::Subdivided { children, .. } => children[0],
                    _ => panic!("expected division matras"),
                };
                let matra = tree.get(matra_id).unwrap();
                match &matra.kind {
                    DurationKind::Pulse(pulse) => match &pulse.event {
                        PulseEvent::Note { pitch, .. } => *pitch.as_fixed().unwrap(),
                        _ => panic!("expected note"),
                    },
                    _ => panic!("expected pulse"),
                }
            })
            .collect()
    }

    #[test]
    fn automation_changes_pitch_per_beat_in_subdivision_switch() {
        let automation = automation_set(1, AUTOMATION_TARGET_PITCH, &[(0, 1, 60.0), (1, 1, 72.0)]);
        let mut score = automated_switch_score(automation, 60, 96);

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();

        assert_eq!(first_matra_pitches(&tree), vec![60, 63, 66, 69]);
    }

    #[test]
    fn automation_changes_base_velocity_before_accent_sampling() {
        let automation = automation_set(
            1,
            AUTOMATION_TARGET_VELOCITY,
            &[(0, 1, 40.0), (1, 1, 100.0)],
        );
        let mut score = automated_switch_score(automation, 60, 96);

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();

        assert_eq!(first_matra_velocities(&tree), vec![40, 55, 70, 85]);
    }

    #[test]
    fn custom_equal_parts_sample_automation_at_part_start_beat() {
        let automation = automation_set(1, AUTOMATION_TARGET_PITCH, &[(0, 1, 60.0), (1, 1, 72.0)]);
        let mut score = Score::subdivision_switch(
            "custom-automation",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 4,
                initial_weights: vec![gati_weight(4)],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: Some(cseq_model::CustomSubdivisionSpec {
                    per_beat_weight: 0.0,
                    equal_parts_weight: 1.0,
                    part_count_weights: vec![cseq_model::WeightedCustomPartCount {
                        count: 5,
                        weight: 1.0,
                    }],
                    part_gati_weights: vec![gati_weight(1)],
                    divisions: vec![],
                    jathi_weights: vec![],
                }),
                automation: Some(automation),
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: zero_accent(),
                pitch: 60,
                velocity: 96,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();

        // Five equal parts over four beats start at 0, 4/5, 8/5, 12/5, 16/5;
        // the beat-quantized automation samples floor beat indices 0, 0, 1, 2, 3.
        assert_eq!(
            custom_division_first_matra_pitches(&tree),
            vec![60, 60, 63, 66, 69]
        );
    }

    #[test]
    fn automation_length_cycles_stretches_existing_pitch_points() {
        let automation = automation_set(
            2,
            AUTOMATION_TARGET_PITCH,
            &[(0, 1, 60.0), (1, 2, 72.0), (1, 1, 84.0)],
        );
        let mut score = automated_switch_score(automation, 60, 96);

        let tree = apply_pipeline_for_cycle_mut(&mut score, 1).unwrap();

        assert_eq!(first_matra_pitches(&tree)[0], 72);
    }

    fn forced_inflection(
        position: Rational,
        subdivision: u32,
    ) -> cseq_model::SubdivisionInflection {
        cseq_model::SubdivisionInflection {
            id: None,
            position,
            change_probability: 1.0,
            subdivision_weights: vec![cseq_model::WeightedSubdivisionChoice {
                subdivision,
                weight: 1.0,
            }],
            jathi_weights: vec![],
            custom_subdivision: None,
        }
    }

    #[test]
    fn seed_trace_records_locked_switch_seed_without_mutating_pipeline() {
        let mut score = direct_switch_score(4, vec![], vec![]);
        let (_tree, trace) = apply_pipeline_for_cycle_mut_with_seed_trace(&mut score, 2).unwrap();

        assert_eq!(trace.len(), 1);
        assert_eq!(trace[0].cycle, 2);
        assert_eq!(trace[0].seed, 7);
        assert_eq!(trace[0].source, SwitchSeedTraceSource::Locked);
        assert!(trace[0].history_before.is_empty());
        assert!(trace[0].history_after.is_empty());
    }

    #[test]
    fn seed_trace_records_history_before_and_after_new_seed() {
        let mut score = direct_switch_score(4, vec![], vec![]);
        if let TransformKind::SubdivisionSwitch { seed_mode, .. } = &mut score.pipeline[0].kind {
            *seed_mode = cseq_model::SwitchSeedMode::History {
                seed: 99,
                history: vec![11],
                history_weight: 0.0,
                new_seed_weight: 1.0,
                max_history: 3,
            };
        }

        let (_tree, trace) = apply_pipeline_for_cycle_mut_with_seed_trace(&mut score, 0).unwrap();

        assert_eq!(trace.len(), 1);
        assert_eq!(trace[0].source, SwitchSeedTraceSource::New);
        assert_eq!(trace[0].history_before, vec![11]);
        assert_eq!(trace[0].history_after.len(), 2);
        assert_eq!(trace[0].history_after[0], 11);
        assert_eq!(trace[0].history_after[1], trace[0].seed);
    }

    #[test]
    fn seed_replay_forces_switch_seed_and_restores_history_for_extension() {
        let mut score = direct_switch_score(4, vec![], vec![]);
        if let TransformKind::SubdivisionSwitch { seed_mode, .. } = &mut score.pipeline[0].kind {
            *seed_mode = cseq_model::SwitchSeedMode::History {
                seed: 99,
                history: vec![7],
                history_weight: 0.0,
                new_seed_weight: 1.0,
                max_history: 4,
            };
        }

        let replay = [SwitchSeedReplay {
            seed: 42,
            source: SwitchSeedTraceSource::History,
            history_before: vec![11],
            history_after: vec![11, 42],
        }];
        let (_tree, trace) =
            apply_pipeline_for_cycle_mut_with_seed_trace_and_replay(&mut score, 0, &replay)
                .unwrap();

        assert_eq!(trace.len(), 1);
        assert_eq!(trace[0].seed, 42);
        assert_eq!(trace[0].source, SwitchSeedTraceSource::History);
        assert_eq!(trace[0].history_before, vec![11]);
        assert_eq!(trace[0].history_after, vec![11, 42]);
        let TransformKind::SubdivisionSwitch { seed_mode, .. } = &score.pipeline[0].kind else {
            panic!("expected switch");
        };
        assert!(matches!(
            seed_mode,
            cseq_model::SwitchSeedMode::History { history, .. } if history == &vec![11, 42]
        ));

        let (_tree, next_trace) =
            apply_pipeline_for_cycle_mut_with_seed_trace(&mut score, 1).unwrap();
        assert_eq!(next_trace[0].history_before, vec![11, 42]);
        assert_eq!(next_trace[0].history_after.len(), 3);
    }

    #[test]
    fn through_cycle_history_matches_transport_prefix_reuse_and_truncation() {
        let mut authored = direct_switch_score(4, vec![], vec![]);
        let TransformKind::SubdivisionSwitch {
            initial_weights,
            seed_mode,
            ..
        } = switch_transform_mut(&mut authored)
        else {
            panic!("expected subdivision switch");
        };
        *initial_weights = vec![
            cseq_model::WeightedSubdivisionChoice {
                subdivision: 3,
                weight: 1.0,
            },
            cseq_model::WeightedSubdivisionChoice {
                subdivision: 4,
                weight: 1.0,
            },
            cseq_model::WeightedSubdivisionChoice {
                subdivision: 5,
                weight: 1.0,
            },
        ];
        *seed_mode = cseq_model::SwitchSeedMode::History {
            seed: 99,
            history: vec![11, 22, 33, 44],
            history_weight: 1.0,
            new_seed_weight: 1.0,
            max_history: 2,
        };

        let mut transport = authored.clone();
        let mut expected_tree = None;
        let mut saw_reuse = false;
        let mut saw_new = false;
        for cycle in 0..=12 {
            let (tree, trace) =
                apply_pipeline_for_cycle_mut_with_seed_trace(&mut transport, cycle).unwrap();
            assert_eq!(trace.len(), 1);
            if cycle == 0 {
                assert_eq!(
                    trace[0].history_before,
                    vec![33, 44],
                    "transport truncates the authored pool before its first draw"
                );
            }
            saw_reuse |= trace[0].source == SwitchSeedTraceSource::History;
            saw_new |= trace[0].source == SwitchSeedTraceSource::New;
            assert!(trace[0].history_after.len() <= 2);
            expected_tree = Some(tree);
        }
        assert!(saw_reuse, "fixture must reuse a seed from its bounded pool");
        assert!(saw_new, "fixture must also learn a new seed");

        let mut random_access = authored;
        let actual_tree = apply_pipeline_through_cycle_mut(&mut random_access, 12).unwrap();
        assert_eq!(
            serde_json::to_value(&actual_tree).unwrap(),
            serde_json::to_value(expected_tree.unwrap()).unwrap()
        );
        let transport_history = match &transport.pipeline[0].kind {
            TransformKind::SubdivisionSwitch {
                seed_mode: SwitchSeedMode::History { history, .. },
                ..
            } => history,
            _ => panic!("expected transport history mode"),
        };
        let random_access_history = match &random_access.pipeline[0].kind {
            TransformKind::SubdivisionSwitch {
                seed_mode: SwitchSeedMode::History { history, .. },
                ..
            } => history,
            _ => panic!("expected random-access history mode"),
        };
        assert_eq!(random_access_history, transport_history);
        assert!(random_access_history.len() <= 2);
    }

    #[test]
    fn through_cycle_cycle_zero_and_stateless_input_semantics_are_exact() {
        let mut history = direct_switch_score(4, vec![], vec![]);
        if let TransformKind::SubdivisionSwitch { seed_mode, .. } =
            switch_transform_mut(&mut history)
        {
            *seed_mode = cseq_model::SwitchSeedMode::History {
                seed: 7,
                history: vec![10, 20, 30],
                history_weight: 1.0,
                new_seed_weight: 0.0,
                max_history: 2,
            };
        }
        let mut direct_history = history.clone();
        let expected = apply_pipeline_for_cycle_mut(&mut direct_history, 0).unwrap();
        let actual = apply_pipeline_through_cycle_mut(&mut history, 0).unwrap();
        assert_eq!(
            serde_json::to_value(&actual).unwrap(),
            serde_json::to_value(&expected).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&history).unwrap(),
            serde_json::to_value(&direct_history).unwrap(),
            "cycle zero advances History exactly once"
        );

        for seed_mode in [
            SwitchSeedMode::Locked { seed: 42 },
            SwitchSeedMode::PerCycle { seed: 42 },
        ] {
            let mut score = direct_switch_score(4, vec![], vec![]);
            if let TransformKind::SubdivisionSwitch {
                seed_mode: score_mode,
                ..
            } = switch_transform_mut(&mut score)
            {
                *score_mode = seed_mode;
            }
            let before = serde_json::to_value(&score).unwrap();
            let mut direct = score.clone();
            let expected = apply_pipeline_for_cycle_mut(&mut direct, 10_000).unwrap();
            let actual = apply_pipeline_through_cycle_mut(&mut score, 10_000).unwrap();
            assert_eq!(
                serde_json::to_value(&actual).unwrap(),
                serde_json::to_value(&expected).unwrap()
            );
            assert_eq!(
                serde_json::to_value(&score).unwrap(),
                before,
                "stateless random access does not alter the supplied score"
            );
        }
    }

    fn gati_weight(subdivision: u32) -> cseq_model::WeightedSubdivisionChoice {
        cseq_model::WeightedSubdivisionChoice {
            subdivision,
            weight: 1.0,
        }
    }

    fn jathi_weight(jathi: u32) -> cseq_model::WeightedJathiChoice {
        cseq_model::WeightedJathiChoice { jathi, weight: 1.0 }
    }

    #[test]
    fn subdivide_root_pulse() {
        let mut score = Score::single_pulse("test", 60, 100);
        score.add_transform(
            TransformKind::Subdivide {
                policy: SubdivisionPolicy::Equal,
                count: 4,
            },
            NodeSelector::Root,
            None,
        );

        let tree = apply_pipeline(&score).unwrap();
        // Root should now be Subdivided with 4 children.
        let root = tree.get(tree.root).unwrap();
        let children = match &root.kind {
            DurationKind::Subdivided { children, .. } => children,
            other => panic!(
                "expected Subdivided, got {:?}",
                std::mem::discriminant(other)
            ),
        };
        assert_eq!(children.len(), 4);

        // Each child should be a Pulse with pitch 60 (inherited from seed).
        for &cid in children {
            let child = tree.get(cid).unwrap();
            if let DurationKind::Pulse(pd) = &child.kind {
                if let PulseEvent::Note { pitch, .. } = &pd.event {
                    assert_eq!(pitch.as_fixed(), Some(&60));
                }
            } else {
                panic!("expected Pulse child");
            }
        }
    }

    #[test]
    fn subdivision_switch_forced_count_assigns_gati_per_beat() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 3,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![
                    cseq_model::SubdivisionInflection {
                        id: None,
                        position: cseq_model::Rational::new(1, 3),
                        change_probability: 1.0,
                        subdivision_weights: vec![cseq_model::WeightedSubdivisionChoice {
                            subdivision: 3,
                            weight: 1.0,
                        }],
                        jathi_weights: vec![],
                        custom_subdivision: None,
                    },
                    cseq_model::SubdivisionInflection {
                        id: None,
                        position: cseq_model::Rational::new(2, 3),
                        change_probability: 1.0,
                        subdivision_weights: vec![cseq_model::WeightedSubdivisionChoice {
                            subdivision: 5,
                            weight: 1.0,
                        }],
                        jathi_weights: vec![],
                        custom_subdivision: None,
                    },
                ],
                switch_count_weights: vec![cseq_model::WeightedSwitchCount {
                    count: 2,
                    weight: 1.0,
                }],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 7 },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let root = tree.get(tree.root).unwrap();
        let beats = match &root.kind {
            DurationKind::Subdivided { children, .. } => children,
            _ => panic!("expected beat grid"),
        };
        let child_counts: Vec<usize> = beats
            .iter()
            .map(|id| match &tree.get(*id).unwrap().kind {
                DurationKind::Subdivided { children, .. } => children.len(),
                _ => panic!("expected beat subdivided into matras"),
            })
            .collect();

        assert_eq!(child_counts, vec![4, 3, 5]);
    }

    #[test]
    fn subdivision_sections_are_fixed_and_cycle_invariant() {
        let score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 3,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![
                    cseq_model::SubdivisionInflection {
                        id: None,
                        position: cseq_model::Rational::new(1, 3),
                        change_probability: 0.0,
                        subdivision_weights: vec![
                            cseq_model::WeightedSubdivisionChoice {
                                subdivision: 7,
                                weight: 0.25,
                            },
                            cseq_model::WeightedSubdivisionChoice {
                                subdivision: 3,
                                weight: 1.0,
                            },
                        ],
                        jathi_weights: vec![],
                        custom_subdivision: None,
                    },
                    cseq_model::SubdivisionInflection {
                        id: None,
                        position: cseq_model::Rational::new(2, 3),
                        change_probability: 1.0,
                        subdivision_weights: vec![cseq_model::WeightedSubdivisionChoice {
                            subdivision: 5,
                            weight: 1.0,
                        }],
                        jathi_weights: vec![],
                        custom_subdivision: None,
                    },
                ],
                switch_count_weights: vec![cseq_model::WeightedSwitchCount {
                    count: 2,
                    weight: 1.0,
                }],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 7 },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );

        let section_subdivisions = |cycle| {
            let mut score = score.clone();
            let tree = apply_pipeline_for_cycle_mut(&mut score, cycle).unwrap();
            let root = tree.get(tree.root).unwrap();
            let beats = match &root.kind {
                DurationKind::Subdivided { children, .. } => children,
                _ => panic!("expected beat subdivision"),
            };
            beats
                .iter()
                .map(|id| match &tree.get(*id).unwrap().kind {
                    DurationKind::Subdivided { children, .. } => children.len(),
                    _ => panic!("expected gati subdivision"),
                })
                .collect::<Vec<_>>()
        };

        assert_eq!(section_subdivisions(0), vec![4, 3, 5]);
        assert_eq!(section_subdivisions(99), vec![4, 3, 5]);
    }

    #[test]
    fn subdivision_switch_rejects_non_beat_aligned_inflections() {
        let mut score =
            direct_switch_score(4, vec![forced_inflection(Rational::new(1, 3), 5)], vec![]);

        let err = apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect_err("off-grid boundary must be rejected");
        assert!(err
            .to_string()
            .contains("must align to a whole beat boundary"));
    }

    #[test]
    fn subdivision_switch_rejects_duplicate_inflection_positions() {
        let mut score = direct_switch_score(
            4,
            vec![
                forced_inflection(Rational::new(1, 2), 5),
                forced_inflection(Rational::new(1, 2), 7),
            ],
            vec![],
        );

        let err = apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect_err("duplicate boundary positions must be rejected");
        assert!(err
            .to_string()
            .contains("positions must be strictly distinct"));
    }

    #[test]
    fn subdivision_switch_rejects_zero_weighted_section_cap() {
        let mut score = direct_switch_score(
            4,
            vec![forced_inflection(Rational::new(1, 2), 5)],
            vec![cseq_model::WeightedSwitchCount {
                count: 1,
                weight: 0.0,
            }],
        );

        let err = apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect_err("non-empty cap weights need a positive option");
        assert!(err
            .to_string()
            .contains("switch_count_weights must have at least one positive weight"));
    }

    #[test]
    fn subdivision_switch_rejects_non_finite_loaded_weight() {
        let mut score =
            direct_switch_score(4, vec![forced_inflection(Rational::new(1, 2), 5)], vec![]);
        let TransformKind::SubdivisionSwitch {
            initial_weights, ..
        } = switch_transform_mut(&mut score)
        else {
            panic!("expected switch");
        };
        initial_weights[0].weight = f32::NAN;

        let err = apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect_err("loaded NaN gati weight must be rejected");
        assert!(err
            .to_string()
            .contains("initial_weights weights must be finite"));
    }

    #[test]
    fn subdivision_switch_rejects_oversized_loaded_gati() {
        let mut score =
            direct_switch_score(4, vec![forced_inflection(Rational::new(1, 2), 5)], vec![]);
        let TransformKind::SubdivisionSwitch {
            initial_weights, ..
        } = switch_transform_mut(&mut score)
        else {
            panic!("expected switch");
        };
        initial_weights[0].subdivision = 65;

        let err = apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect_err("loaded oversized gati must be rejected");
        assert!(err.to_string().contains("gati choices must be 1-64"));
    }

    #[test]
    fn subdivision_switch_rejects_invalid_loaded_jathi() {
        let mut score =
            direct_switch_score(4, vec![forced_inflection(Rational::new(1, 2), 5)], vec![]);
        let TransformKind::SubdivisionSwitch {
            initial_jathi_weights,
            ..
        } = switch_transform_mut(&mut score)
        else {
            panic!("expected switch");
        };
        initial_jathi_weights.push(cseq_model::WeightedJathiChoice {
            jathi: 8,
            weight: 1.0,
        });

        let err = apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect_err("loaded non-Carnatic jathi must be rejected");
        assert!(err.to_string().contains("jathi choices must be one of"));
    }

    #[test]
    fn subdivision_switch_rejects_inverted_loaded_accent_range() {
        let mut score =
            direct_switch_score(4, vec![forced_inflection(Rational::new(1, 2), 5)], vec![]);
        let TransformKind::SubdivisionSwitch { accent, .. } = switch_transform_mut(&mut score)
        else {
            panic!("expected switch");
        };
        accent.beat_start = cseq_model::VelocityAccentRange { min: 40, max: 8 };

        let err = apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect_err("loaded inverted accent range must be rejected");
        assert!(err
            .to_string()
            .contains("beat start accent min must be <= max"));
    }

    #[test]
    fn subdivision_switch_rejects_non_midi_loaded_accent_range() {
        let mut score =
            direct_switch_score(4, vec![forced_inflection(Rational::new(1, 2), 5)], vec![]);
        let TransformKind::SubdivisionSwitch { accent, .. } = switch_transform_mut(&mut score)
        else {
            panic!("expected switch");
        };
        accent.beat_start = cseq_model::VelocityAccentRange { min: 128, max: 128 };

        let err = apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect_err("loaded non-MIDI accent range must be rejected");
        assert!(err
            .to_string()
            .contains("beat start accent values must be 0-127"));
    }

    #[test]
    fn sample_velocity_boost_handles_full_u8_range() {
        let mut rng = SplitMix64::new(1);
        let range = cseq_model::VelocityAccentRange { min: 0, max: 255 };

        let _ = sample_velocity_boost(&range, &mut rng);
        let high_range = cseq_model::VelocityAccentRange { min: 250, max: 255 };
        let boost = sample_velocity_boost(&high_range, &mut rng);

        assert!((250..=255).contains(&boost));
    }

    #[test]
    fn subdivision_switch_applies_gati_per_beat_after_inflection() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 4,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![cseq_model::SubdivisionInflection {
                    id: None,
                    position: cseq_model::Rational::new(1, 4),
                    change_probability: 1.0,
                    subdivision_weights: vec![cseq_model::WeightedSubdivisionChoice {
                        subdivision: 3,
                        weight: 1.0,
                    }],
                    jathi_weights: vec![],
                    custom_subdivision: None,
                }],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let root = tree.get(tree.root).unwrap();
        let beats = match &root.kind {
            DurationKind::Subdivided { children, .. } => children.clone(),
            _ => panic!("expected beat grid"),
        };
        assert_eq!(beats.len(), 4);

        let durations: Vec<cseq_model::Rational> = beats
            .iter()
            .map(|id| tree.get(*id).unwrap().duration)
            .collect();
        assert_eq!(durations, vec![cseq_model::Rational::new(1, 4); 4]);

        let child_counts: Vec<usize> = beats
            .iter()
            .map(|id| match &tree.get(*id).unwrap().kind {
                DurationKind::Subdivided { children, .. } => children.len(),
                _ => panic!("expected beat subdivided into matras"),
            })
            .collect();
        assert_eq!(child_counts, vec![4, 3, 3, 3]);
    }

    #[test]
    fn subdivision_switch_accents_beat_and_section_starts() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 3,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![cseq_model::SubdivisionInflection {
                    id: None,
                    position: cseq_model::Rational::new(1, 3),
                    change_probability: 1.0,
                    subdivision_weights: vec![cseq_model::WeightedSubdivisionChoice {
                        subdivision: 4,
                        weight: 1.0,
                    }],
                    jathi_weights: vec![],
                    custom_subdivision: None,
                }],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: cseq_model::GatiAccentSpec {
                    beat_start: cseq_model::VelocityAccentRange { min: 10, max: 10 },
                    section_start_extra: cseq_model::VelocityAccentRange { min: 5, max: 5 },
                    jathi_start: cseq_model::VelocityAccentRange { min: 30, max: 30 },
                    jathi_mode: cseq_model::JathiAccentMode::OverrideGati,
                },
                pitch: 60,
                velocity: 80,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let root = tree.get(tree.root).unwrap();
        let beats = match &root.kind {
            DurationKind::Subdivided { children, .. } => children.clone(),
            _ => panic!("expected beat grid"),
        };

        let first_matra_velocities: Vec<u8> = beats
            .iter()
            .map(|beat_id| match &tree.get(*beat_id).unwrap().kind {
                DurationKind::Subdivided { children, .. } => {
                    let first = tree.get(children[0]).unwrap();
                    match &first.kind {
                        DurationKind::Pulse(pulse) => *pulse.velocity.as_fixed().unwrap(),
                        _ => panic!("expected pulse matra"),
                    }
                }
                _ => panic!("expected beat subdivided into matras"),
            })
            .collect();
        let section_starts: Vec<bool> = beats
            .iter()
            .map(|beat_id| {
                tree.get(*beat_id)
                    .unwrap()
                    .metadata
                    .tags
                    .iter()
                    .any(|tag| tag == "section-start")
            })
            .collect();

        assert_eq!(first_matra_velocities, vec![95, 95, 90]);
        assert_eq!(section_starts, vec![true, true, false]);
    }

    #[test]
    fn subdivision_switch_emits_jathi_pulse_spans_when_they_tile() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 3,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![cseq_model::WeightedJathiChoice {
                    jathi: 3,
                    weight: 1.0,
                }],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let jathi_spans: Vec<_> = tree
            .pulse_spans
            .iter()
            .filter(|span| matches!(span.kind, cseq_model::PulseSpanKind::JathiPulse { .. }))
            .collect();

        assert_eq!(jathi_spans.len(), 4);
        assert_eq!(
            jathi_spans
                .iter()
                .map(|span| span.start)
                .collect::<Vec<_>>(),
            vec![
                cseq_model::Rational::new(0, 1),
                cseq_model::Rational::new(3, 4),
                cseq_model::Rational::new(3, 2),
                cseq_model::Rational::new(9, 4),
            ]
        );
        assert_eq!(
            jathi_spans
                .iter()
                .map(|span| span.duration)
                .collect::<Vec<_>>(),
            vec![cseq_model::Rational::new(3, 4); 4]
        );
        assert_eq!(
            jathi_spans
                .iter()
                .map(|span| span.start_matra)
                .collect::<Vec<_>>(),
            vec![0, 3, 6, 9]
        );
        assert_eq!(
            jathi_spans.last().unwrap().start + jathi_spans.last().unwrap().duration,
            cseq_model::Rational::new(3, 1)
        );
        assert!(jathi_spans.iter().all(|span| span.matra_len == 3
            && span.tags.iter().any(|tag| tag == "protected-accent-span")));
    }

    // ---- Custom section subdivision (one grid-wide gati) ----

    fn custom_switch_score(cycle_beats: u32, gatis: &[u32], jathi: Option<u32>) -> Score {
        let jathi_weights = jathi
            .map(|j| {
                vec![cseq_model::WeightedJathiChoice {
                    jathi: j,
                    weight: 1.0,
                }]
            })
            .unwrap_or_default();
        Score::subdivision_switch(
            "custom-switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: jathi_weights,
                initial_custom_subdivision: Some(cseq_model::CustomSubdivisionSpec {
                    per_beat_weight: 0.0,
                    equal_parts_weight: 1.0,
                    part_count_weights: vec![cseq_model::WeightedCustomPartCount {
                        count: gatis.len() as u32,
                        weight: 1.0,
                    }],
                    part_gati_weights: gatis
                        .first()
                        .map(|gati| {
                            vec![cseq_model::WeightedSubdivisionChoice {
                                subdivision: *gati,
                                weight: 1.0,
                            }]
                        })
                        .unwrap_or_default(),
                    divisions: vec![],
                    jathi_weights: vec![],
                }),
                automation: None,
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        )
    }

    #[test]
    fn custom_section_divides_span_into_n_equal_parts() {
        // 4-beat cycle, whole cycle is one custom section split into 5 equal
        // equal parts -> each part is 4/5 of a beat. One grid-wide gati 3.
        let mut score = custom_switch_score(4, &[3, 2, 5, 4, 1], None);
        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();

        let gati_spans: Vec<_> = tree
            .pulse_spans
            .iter()
            .filter(|span| matches!(span.kind, cseq_model::PulseSpanKind::GatiBeat { .. }))
            .collect();
        assert_eq!(gati_spans.len(), 5, "one gati span per equal part");

        // Exact fractional starts: 0, 4/5, 8/5, 12/5, 16/5.
        assert_eq!(
            gati_spans.iter().map(|s| s.start).collect::<Vec<_>>(),
            vec![
                cseq_model::Rational::new(0, 1),
                cseq_model::Rational::new(4, 5),
                cseq_model::Rational::new(8, 5),
                cseq_model::Rational::new(12, 5),
                cseq_model::Rational::new(16, 5),
            ]
        );
        // Equal 4/5-beat durations.
        assert_eq!(
            gati_spans.iter().map(|s| s.duration).collect::<Vec<_>>(),
            vec![cseq_model::Rational::new(4, 5); 5]
        );
        // Each equal part uses the one grid-wide gati and matra length.
        assert_eq!(
            gati_spans
                .iter()
                .map(|s| match s.kind {
                    cseq_model::PulseSpanKind::GatiBeat { gati, .. } => gati,
                    _ => 0,
                })
                .collect::<Vec<_>>(),
            vec![3, 3, 3, 3, 3]
        );
        assert_eq!(
            gati_spans.iter().map(|s| s.matra_len).collect::<Vec<_>>(),
            vec![3, 3, 3, 3, 3]
        );
        // Running matra offsets accumulate.
        assert_eq!(
            gati_spans.iter().map(|s| s.start_matra).collect::<Vec<_>>(),
            vec![0, 3, 6, 9, 12]
        );
    }

    #[test]
    fn custom_section_builds_equal_part_subtree_with_grid_matra_count() {
        // Gati 2 over a 2-beat cycle: the whole cycle is one custom section
        // (Explicit root) containing one section node, itself split into 2 equal
        // parts with 2 matra children each.
        let mut score = custom_switch_score(2, &[2, 3], None);
        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();

        let root = tree.get(tree.root).unwrap();
        let section_children = match &root.kind {
            DurationKind::Subdivided { children, policy } => {
                // One custom section present -> Explicit root with a single child
                // (the section subtree spanning the whole 2-beat cycle).
                assert!(matches!(policy, SubdivisionPolicy::Explicit));
                assert_eq!(children.len(), 1);
                children.clone()
            }
            _ => panic!("expected subdivided root"),
        };

        let section = tree.get(section_children[0]).unwrap();
        let division_ids = match &section.kind {
            DurationKind::Subdivided { children, policy } => {
                assert!(matches!(policy, SubdivisionPolicy::Equal));
                children.clone()
            }
            _ => panic!("expected subdivided section"),
        };
        assert_eq!(division_ids.len(), 2);

        let matra_counts: Vec<usize> = division_ids
            .iter()
            .map(|id| match &tree.get(*id).unwrap().kind {
                DurationKind::Subdivided { children, .. } => children.len(),
                _ => panic!("expected subdivided division"),
            })
            .collect();
        assert_eq!(matra_counts, vec![2, 2]);
    }

    #[test]
    fn custom_section_jathi_tiles_total_matras() {
        // Five equal parts at grid-wide gati 3 sum to 15 matras; jathi 5 -> 3 pulses tiling the whole
        // 4-beat section. Jathi pulses may cross division boundaries.
        let mut score = custom_switch_score(4, &[3, 2, 5, 4, 1], Some(5));
        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let jathi_spans: Vec<_> = tree
            .pulse_spans
            .iter()
            .filter(|span| matches!(span.kind, cseq_model::PulseSpanKind::JathiPulse { .. }))
            .collect();
        assert_eq!(jathi_spans.len(), 3, "15 matras / jathi 5 = 3 pulses");
        // Jathi pulses follow the actual custom matra grid.
        assert_eq!(
            jathi_spans.iter().map(|s| s.start).collect::<Vec<_>>(),
            vec![
                cseq_model::Rational::new(0, 1),
                cseq_model::Rational::new(4, 3),
                cseq_model::Rational::new(8, 3),
            ]
        );
        assert_eq!(
            jathi_spans.iter().map(|s| s.duration).collect::<Vec<_>>(),
            vec![
                cseq_model::Rational::new(4, 3),
                cseq_model::Rational::new(4, 3),
                cseq_model::Rational::new(4, 3),
            ]
        );
        // Last pulse reaches the section end (4 beats).
        let last = jathi_spans.last().unwrap();
        assert_eq!(last.start + last.duration, cseq_model::Rational::new(4, 1));
        assert_eq!(
            jathi_spans
                .iter()
                .map(|s| s.start_matra)
                .collect::<Vec<_>>(),
            vec![0, 5, 10]
        );
    }

    #[test]
    fn custom_section_jathi_rejected_when_not_dividing_total() {
        // Three equal parts at gati 2 sum to 6; jathi 5 does not divide 6 -> no jathi spans.
        let mut score = custom_switch_score(3, &[2, 2, 2], Some(5));
        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let jathi_spans = tree
            .pulse_spans
            .iter()
            .filter(|span| matches!(span.kind, cseq_model::PulseSpanKind::JathiPulse { .. }))
            .count();
        assert_eq!(jathi_spans, 0);
    }

    #[test]
    fn custom_section_uses_regular_jathi_weights_not_legacy_custom_jathi() {
        // Five equal parts at grid gati 3 sum to 15. Regular jathi 5 should
        // produce three pulses; legacy custom jathi 3 would produce five.
        let mut score = custom_switch_score(4, &[3, 3, 3, 3, 3], Some(5));
        let TransformKind::SubdivisionSwitch {
            initial_custom_subdivision,
            ..
        } = switch_transform_mut(&mut score)
        else {
            panic!("expected switch");
        };
        initial_custom_subdivision
            .as_mut()
            .expect("custom spec")
            .jathi_weights = vec![jathi_weight(3)];

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let jathis = tree
            .pulse_spans
            .iter()
            .filter_map(|span| match span.kind {
                cseq_model::PulseSpanKind::JathiPulse { jathi, .. } => Some(jathi),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(jathis, vec![5, 5, 5]);
    }

    #[test]
    fn custom_grid_sampling_is_not_shifted_by_later_uniform_boundary() {
        fn score(with_later_boundary: bool) -> Score {
            let custom = cseq_model::CustomSubdivisionSpec {
                per_beat_weight: 0.0,
                equal_parts_weight: 1.0,
                part_count_weights: vec![
                    cseq_model::WeightedCustomPartCount {
                        count: 5,
                        weight: 1.0,
                    },
                    cseq_model::WeightedCustomPartCount {
                        count: 8,
                        weight: 3.0,
                    },
                ],
                part_gati_weights: vec![
                    cseq_model::WeightedSubdivisionChoice {
                        subdivision: 2,
                        weight: 1.0,
                    },
                    cseq_model::WeightedSubdivisionChoice {
                        subdivision: 7,
                        weight: 3.0,
                    },
                ],
                divisions: vec![],
                jathi_weights: vec![],
            };
            let inflections = if with_later_boundary {
                vec![cseq_model::SubdivisionInflection {
                    id: None,
                    position: cseq_model::Rational::new(1, 4),
                    change_probability: 1.0,
                    subdivision_weights: vec![
                        cseq_model::WeightedSubdivisionChoice {
                            subdivision: 3,
                            weight: 1.0,
                        },
                        cseq_model::WeightedSubdivisionChoice {
                            subdivision: 6,
                            weight: 1.0,
                        },
                    ],
                    jathi_weights: vec![],
                    custom_subdivision: None,
                }]
            } else {
                vec![]
            };
            Score::subdivision_switch(
                "custom-grid-order",
                cseq_model::SubdivisionSwitchSpec {
                    cycle_beats: 4,
                    initial_weights: vec![gati_weight(4)],
                    initial_jathi_weights: vec![],
                    initial_custom_subdivision: Some(custom),
                    automation: None,
                    inflections,
                    switch_count_weights: vec![],
                    seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 913 },
                    accent: zero_accent(),
                    pitch: 60,
                    velocity: 100,
                },
            )
        }

        fn first_section_gatis(tree: &DurationTree) -> Vec<u32> {
            tree.pulse_spans
                .iter()
                .filter_map(|span| match span.kind {
                    cseq_model::PulseSpanKind::GatiBeat {
                        section_index: 1,
                        gati,
                        ..
                    } => Some(gati),
                    _ => None,
                })
                .collect()
        }

        let mut without_later_boundary = score(false);
        let without = apply_pipeline_for_cycle_mut(&mut without_later_boundary, 0).unwrap();
        let mut with_later_boundary = score(true);
        let with = apply_pipeline_for_cycle_mut(&mut with_later_boundary, 0).unwrap();

        assert_eq!(first_section_gatis(&with), first_section_gatis(&without));
    }

    #[test]
    fn fired_custom_boundary_grid_sampling_is_not_shifted_by_later_boundary() {
        fn custom_spec() -> cseq_model::CustomSubdivisionSpec {
            cseq_model::CustomSubdivisionSpec {
                per_beat_weight: 0.0,
                equal_parts_weight: 1.0,
                part_count_weights: vec![
                    cseq_model::WeightedCustomPartCount {
                        count: 5,
                        weight: 1.0,
                    },
                    cseq_model::WeightedCustomPartCount {
                        count: 8,
                        weight: 3.0,
                    },
                ],
                part_gati_weights: vec![
                    cseq_model::WeightedSubdivisionChoice {
                        subdivision: 2,
                        weight: 1.0,
                    },
                    cseq_model::WeightedSubdivisionChoice {
                        subdivision: 7,
                        weight: 3.0,
                    },
                ],
                divisions: vec![],
                jathi_weights: vec![],
            }
        }

        fn score(with_later_boundary: bool) -> Score {
            let mut inflections = vec![cseq_model::SubdivisionInflection {
                id: None,
                position: cseq_model::Rational::new(1, 4),
                change_probability: 1.0,
                subdivision_weights: vec![gati_weight(4)],
                jathi_weights: vec![],
                custom_subdivision: Some(custom_spec()),
            }];
            if with_later_boundary {
                inflections.push(cseq_model::SubdivisionInflection {
                    id: None,
                    position: cseq_model::Rational::new(3, 4),
                    change_probability: 1.0,
                    subdivision_weights: vec![
                        cseq_model::WeightedSubdivisionChoice {
                            subdivision: 3,
                            weight: 1.0,
                        },
                        cseq_model::WeightedSubdivisionChoice {
                            subdivision: 6,
                            weight: 1.0,
                        },
                    ],
                    jathi_weights: vec![],
                    custom_subdivision: None,
                });
            }
            Score::subdivision_switch(
                "custom-boundary-grid-order",
                cseq_model::SubdivisionSwitchSpec {
                    cycle_beats: 4,
                    initial_weights: vec![gati_weight(4)],
                    initial_jathi_weights: vec![],
                    initial_custom_subdivision: None,
                    automation: None,
                    inflections,
                    switch_count_weights: vec![],
                    seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 913 },
                    accent: zero_accent(),
                    pitch: 60,
                    velocity: 100,
                },
            )
        }

        fn custom_section_gatis(tree: &DurationTree) -> Vec<u32> {
            tree.pulse_spans
                .iter()
                .filter_map(|span| match span.kind {
                    cseq_model::PulseSpanKind::GatiBeat {
                        section_index: 2,
                        gati,
                        ..
                    } => Some(gati),
                    _ => None,
                })
                .collect()
        }

        let mut without_later_boundary = score(false);
        let without = apply_pipeline_for_cycle_mut(&mut without_later_boundary, 0).unwrap();
        let mut with_later_boundary = score(true);
        let with = apply_pipeline_for_cycle_mut(&mut with_later_boundary, 0).unwrap();

        assert_eq!(custom_section_gatis(&with), custom_section_gatis(&without));
    }

    #[test]
    fn initial_custom_section_resolves_grid_gati_deterministically() {
        let part_gati_weights = vec![
            cseq_model::WeightedSubdivisionChoice {
                subdivision: 2,
                weight: 1.0,
            },
            cseq_model::WeightedSubdivisionChoice {
                subdivision: 7,
                weight: 3.0,
            },
        ];
        let seed = 77;
        let expected_gati = 7;
        let mut score = Score::subdivision_switch(
            "custom-rng",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 3,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: Some(cseq_model::CustomSubdivisionSpec {
                    per_beat_weight: 0.0,
                    equal_parts_weight: 1.0,
                    part_count_weights: vec![cseq_model::WeightedCustomPartCount {
                        count: 3,
                        weight: 1.0,
                    }],
                    part_gati_weights,
                    divisions: vec![],
                    jathi_weights: vec![],
                }),
                automation: None,
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed },
                accent: zero_accent(),
                pitch: 60,
                velocity: 100,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let actual_gatis = tree
            .pulse_spans
            .iter()
            .filter_map(|span| match span.kind {
                cseq_model::PulseSpanKind::GatiBeat { gati, .. } => Some(gati),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(actual_gatis, vec![expected_gati; 3]);
    }

    #[test]
    fn custom_subdivision_rejects_invalid_loaded_division_weights() {
        let mut score = custom_switch_score(2, &[3], None);
        let TransformKind::SubdivisionSwitch {
            initial_custom_subdivision,
            ..
        } = switch_transform_mut(&mut score)
        else {
            panic!("expected switch");
        };
        let custom = initial_custom_subdivision.as_mut().expect("custom spec");
        custom.part_gati_weights[0].weight = 0.0;

        let err = apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect_err("custom grid needs positive gati weights");
        assert!(err
            .to_string()
            .contains("initial_custom_subdivision: custom subdivision grid gati choices needs a positive gati weight"));
    }

    #[test]
    fn custom_subdivision_rejects_oversized_loaded_division_gati() {
        let mut score = custom_switch_score(2, &[3], None);
        let TransformKind::SubdivisionSwitch {
            initial_custom_subdivision,
            ..
        } = switch_transform_mut(&mut score)
        else {
            panic!("expected switch");
        };
        let custom = initial_custom_subdivision.as_mut().expect("custom spec");
        custom.part_gati_weights[0].subdivision = 65;

        let err = apply_pipeline_for_cycle_mut(&mut score, 0)
            .expect_err("custom grid should reuse gati validation");
        assert!(err.to_string().contains(
            "initial_custom_subdivision: custom subdivision grid gati choices gati choices must be 1-64"
        ));
    }

    #[test]
    fn uniform_section_unchanged_when_custom_is_none() {
        // Regression guard: a plain uniform switch (custom = None everywhere)
        // realizes to exactly the same note onsets as before the custom-section
        // work. 3-beat cycle, gati 4 -> 12 matras at k/4 beat offsets.
        let mut score = Score::subdivision_switch(
            "uniform",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 3,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
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
                velocity: 100,
            },
        );
        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        // Root keeps Equal policy (no custom section present) with one node per
        // integer beat — byte-identical structure to before this feature.
        let root = tree.get(tree.root).unwrap();
        let beat_ids = match &root.kind {
            DurationKind::Subdivided { policy, children } => {
                assert!(matches!(policy, SubdivisionPolicy::Equal));
                assert_eq!(children.len(), 3, "3 integer beats");
                children.clone()
            }
            _ => panic!("expected subdivided root"),
        };
        // Each beat is a uniform gati-4 subtree of 4 matras.
        let matra_counts: Vec<usize> = beat_ids
            .iter()
            .map(|id| match &tree.get(*id).unwrap().kind {
                DurationKind::Subdivided { children, .. } => children.len(),
                _ => panic!("expected subdivided beat"),
            })
            .collect();
        assert_eq!(matra_counts, vec![4, 4, 4]);
        assert_eq!(beat_ids, vec![1, 6, 11]);
        assert_eq!(
            beat_ids
                .iter()
                .map(|id| tree.get(*id).unwrap().metadata.label.as_deref())
                .collect::<Vec<_>>(),
            vec![
                Some("beat 1 gati=4"),
                Some("beat 2 gati=4"),
                Some("beat 3 gati=4")
            ]
        );
        let gati_spans = tree
            .pulse_spans
            .iter()
            .filter(|span| matches!(span.kind, cseq_model::PulseSpanKind::GatiBeat { .. }))
            .collect::<Vec<_>>();
        assert_eq!(gati_spans.len(), 3);
        assert_eq!(
            gati_spans.iter().map(|span| span.start).collect::<Vec<_>>(),
            vec![
                cseq_model::Rational::new(0, 1),
                cseq_model::Rational::new(1, 1),
                cseq_model::Rational::new(2, 1),
            ]
        );
        assert_eq!(
            gati_spans
                .iter()
                .map(|span| (span.id, span.start_matra, span.matra_len))
                .collect::<Vec<_>>(),
            vec![(1, 0, 4), (2, 4, 4), (3, 8, 4)]
        );
    }

    #[test]
    fn subdivision_switch_filters_jathi_choices_that_do_not_tile_section_matras() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 2,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 5,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![cseq_model::WeightedJathiChoice {
                    jathi: 3,
                    weight: 1.0,
                }],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        assert!(!tree
            .pulse_spans
            .iter()
            .any(|span| matches!(span.kind, cseq_model::PulseSpanKind::JathiPulse { .. })));
        assert_eq!(
            tree.pulse_spans
                .iter()
                .filter(|span| matches!(span.kind, cseq_model::PulseSpanKind::GatiBeat { .. }))
                .count(),
            2
        );
    }

    #[test]
    fn subdivision_switch_same_gati_boundary_creates_new_jathi_section() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 6,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![cseq_model::WeightedJathiChoice {
                    jathi: 3,
                    weight: 1.0,
                }],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![cseq_model::SubdivisionInflection {
                    id: None,
                    position: cseq_model::Rational::new(1, 2),
                    change_probability: 1.0,
                    subdivision_weights: vec![cseq_model::WeightedSubdivisionChoice {
                        subdivision: 4,
                        weight: 1.0,
                    }],
                    jathi_weights: vec![cseq_model::WeightedJathiChoice {
                        jathi: 3,
                        weight: 1.0,
                    }],
                    custom_subdivision: None,
                }],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let section_indices: Vec<u32> = tree
            .pulse_spans
            .iter()
            .filter_map(|span| match span.kind {
                cseq_model::PulseSpanKind::Section { index } => Some(index),
                _ => None,
            })
            .collect();
        let jathi_section_indices: Vec<u32> = tree
            .pulse_spans
            .iter()
            .filter_map(|span| match span.kind {
                cseq_model::PulseSpanKind::JathiPulse { section_index, .. } => Some(section_index),
                _ => None,
            })
            .collect();

        assert_eq!(section_indices, vec![1, 2]);
        assert_eq!(jathi_section_indices, vec![1, 1, 1, 1, 2, 2, 2, 2]);
    }

    #[test]
    fn subdivision_switch_filters_jathi_that_only_duplicates_gati_pulses() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 3,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![
                    cseq_model::WeightedJathiChoice {
                        jathi: 4,
                        weight: 100.0,
                    },
                    cseq_model::WeightedJathiChoice {
                        jathi: 3,
                        weight: 1.0,
                    },
                ],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let jathis: Vec<u32> = tree
            .pulse_spans
            .iter()
            .filter_map(|span| match span.kind {
                cseq_model::PulseSpanKind::JathiPulse { jathi, .. } => Some(jathi),
                _ => None,
            })
            .collect();

        assert_eq!(jathis, vec![3, 3, 3, 3]);
    }

    #[test]
    fn subdivision_switch_default_jathi_accent_overrides_gati_accent() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 3,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![cseq_model::WeightedJathiChoice {
                    jathi: 3,
                    weight: 1.0,
                }],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: cseq_model::GatiAccentSpec {
                    beat_start: cseq_model::VelocityAccentRange { min: 10, max: 10 },
                    section_start_extra: cseq_model::VelocityAccentRange { min: 5, max: 5 },
                    jathi_start: cseq_model::VelocityAccentRange { min: 30, max: 30 },
                    jathi_mode: cseq_model::JathiAccentMode::OverrideGati,
                },
                pitch: 60,
                velocity: 80,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let velocities = realized_matra_velocities(&tree);

        // Matra 0 is both gati and jathi, so jathi replaces gati:
        // base 80 + jathi 30 + section extra 5.
        assert_eq!(velocities[0], 115);
        // Matra 3 is jathi only.
        assert_eq!(velocities[3], 110);
        // Matra 4 is gati only.
        assert_eq!(velocities[4], 90);
    }

    #[test]
    fn subdivision_switch_layered_accent_sums_gati_and_jathi_levels() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 3,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![cseq_model::WeightedJathiChoice {
                    jathi: 3,
                    weight: 1.0,
                }],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: cseq_model::GatiAccentSpec {
                    beat_start: cseq_model::VelocityAccentRange { min: 10, max: 10 },
                    section_start_extra: cseq_model::VelocityAccentRange { min: 5, max: 5 },
                    jathi_start: cseq_model::VelocityAccentRange { min: 30, max: 30 },
                    jathi_mode: cseq_model::JathiAccentMode::Layered,
                },
                pitch: 60,
                velocity: 80,
            },
        );

        let tree = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap();
        let velocities = realized_matra_velocities(&tree);

        // Matra 0 layers all three accents: base 80 + gati 10 + jathi 30
        // + section extra 5.
        assert_eq!(velocities[0], 125);
        assert_eq!(velocities[3], 110);
        assert_eq!(velocities[4], 90);
    }

    #[test]
    fn subdivision_switch_history_mode_remembers_new_seed() {
        let mut mode = cseq_model::SwitchSeedMode::History {
            seed: 1,
            history: vec![],
            history_weight: 0.0,
            new_seed_weight: 1.0,
            max_history: 2,
        };

        let first = resolve_seed(&mut mode, 0, 0, None).unwrap();
        let second = resolve_seed(&mut mode, 1, 0, None).unwrap();

        assert_ne!(first, second);
        assert!(matches!(
            mode,
            cseq_model::SwitchSeedMode::History { ref history, .. } if history.len() == 2
        ));
    }

    #[test]
    fn subdivision_switch_history_mode_rejects_empty_seed_sources() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 1,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::History {
                    seed: 7,
                    history: vec![],
                    history_weight: 0.0,
                    new_seed_weight: 0.0,
                    max_history: 8,
                },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );

        let err = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap_err();
        assert!(matches!(err, TransformError::InvalidTarget { .. }));
        assert!(err
            .to_string()
            .contains("history seed mode has no positive history"));
    }

    #[test]
    fn subdivision_switch_fired_boundary_requires_positive_gati_weight() {
        let mut score = Score::subdivision_switch(
            "switch",
            cseq_model::SubdivisionSwitchSpec {
                cycle_beats: 2,
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![cseq_model::SubdivisionInflection {
                    id: None,
                    position: cseq_model::Rational::new(1, 2),
                    change_probability: 1.0,
                    subdivision_weights: vec![cseq_model::WeightedSubdivisionChoice {
                        subdivision: 7,
                        weight: 0.0,
                    }],
                    jathi_weights: vec![],
                    custom_subdivision: None,
                }],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                accent: cseq_model::GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );

        let err = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap_err();
        assert!(err
            .to_string()
            .contains("fired inflection 1 has no positive gati weights"));
    }

    #[test]
    fn subdivision_switch_requires_integer_cycle_length() {
        let mut score = Score::single_pulse("bad-cycle", 60, 100);
        score.cycle_length = cseq_model::Rational::new(3, 2);
        score.add_transform(
            TransformKind::SubdivisionSwitch {
                initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![],
                switch_count_weights: vec![],
                seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                pitch: ValueSpec::fixed(60),
                velocity: ValueSpec::fixed(100),
                accent: cseq_model::GatiAccentSpec::default(),
            },
            NodeSelector::Root,
            None,
        );

        let err = apply_pipeline_for_cycle_mut(&mut score, 0).unwrap_err();
        assert!(err
            .to_string()
            .contains("cycle_length must be a positive integer"));
    }

    #[test]
    fn set_velocity_by_id() {
        let mut score = chatusra_score();
        score.add_transform(
            TransformKind::SetVelocity {
                velocity: ValueSpec::fixed(50),
            },
            NodeSelector::ById { id: 3 },
            None,
        );

        let tree = apply_pipeline(&score).unwrap();
        let node = tree.get(3).unwrap();
        if let DurationKind::Pulse(pd) = &node.kind {
            assert_eq!(pd.velocity.as_fixed(), Some(&50));
        }
    }

    #[test]
    fn tie_all() {
        let mut score = chatusra_score();
        score.add_transform(
            TransformKind::Tie {
                pattern: TiePattern::All,
            },
            NodeSelector::Root,
            None,
        );

        let tree = apply_pipeline(&score).unwrap();
        let root = tree.get(tree.root).unwrap();
        assert!(matches!(&root.kind, DurationKind::Tied { children } if children.len() == 4));
    }

    #[test]
    fn remove_node() {
        let mut score = chatusra_score();
        score.add_transform(
            TransformKind::RemoveNode,
            NodeSelector::ById { id: 2 },
            None,
        );

        let tree = apply_pipeline(&score).unwrap();
        let node = tree.get(2).unwrap();
        assert!(matches!(
            &node.kind,
            DurationKind::Pulse(pd) if matches!(pd.event, PulseEvent::Rest)
        ));
    }

    #[test]
    fn target_not_found() {
        let mut score = chatusra_score();
        score.add_transform(
            TransformKind::RemoveNode,
            NodeSelector::ById { id: 999 },
            None,
        );

        let result = apply_pipeline(&score);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            TransformError::TargetNotFound { .. }
        ));
    }

    #[test]
    fn subdivide_non_pulse_rejected() {
        let mut score = chatusra_score();
        // Root is already Subdivided — can't subdivide it again.
        score.add_transform(
            TransformKind::Subdivide {
                policy: SubdivisionPolicy::Equal,
                count: 2,
            },
            NodeSelector::Root,
            None,
        );

        let result = apply_pipeline(&score);
        assert!(matches!(
            result.unwrap_err(),
            TransformError::InvalidTarget { .. }
        ));
    }

    #[test]
    fn subdivide_zero_count_rejected_instead_of_panicking() {
        let mut score = Score::single_pulse("test", 60, 100);
        score.add_transform(
            TransformKind::Subdivide {
                policy: SubdivisionPolicy::Equal,
                count: 0,
            },
            NodeSelector::Root,
            None,
        );

        let err = apply_pipeline(&score).unwrap_err();
        assert!(err
            .to_string()
            .contains("subdivision count must be greater than zero"));
    }

    #[test]
    fn subdivide_weighted_policy_must_match_count_and_be_positive() {
        let mut mismatch = Score::single_pulse("test", 60, 100);
        mismatch.add_transform(
            TransformKind::Subdivide {
                policy: SubdivisionPolicy::Weighted(vec![2, 1]),
                count: 3,
            },
            NodeSelector::Root,
            None,
        );
        assert!(apply_pipeline(&mismatch)
            .unwrap_err()
            .to_string()
            .contains("2 weights for 3 children"));

        let mut zero = Score::single_pulse("test", 60, 100);
        zero.add_transform(
            TransformKind::Subdivide {
                policy: SubdivisionPolicy::Weighted(vec![2, 0, 1]),
                count: 3,
            },
            NodeSelector::Root,
            None,
        );
        assert!(apply_pipeline(&zero)
            .unwrap_err()
            .to_string()
            .contains("zero duration"));
    }

    #[test]
    fn subdivide_weighted_policy_sets_child_durations_from_weights() {
        let mut score = Score::single_pulse("test", 60, 100);
        score.add_transform(
            TransformKind::Subdivide {
                policy: SubdivisionPolicy::Weighted(vec![1, 2, 3]),
                count: 3,
            },
            NodeSelector::Root,
            None,
        );

        let tree = apply_pipeline(&score).unwrap();
        let root = tree.get(tree.root).unwrap();
        let children = match &root.kind {
            DurationKind::Subdivided { children, .. } => children,
            _ => panic!("expected subdivided root"),
        };
        let durations = children
            .iter()
            .map(|id| tree.get(*id).unwrap().duration)
            .collect::<Vec<_>>();
        assert_eq!(
            durations,
            vec![
                cseq_model::Rational::new(1, 6),
                cseq_model::Rational::new(1, 3),
                cseq_model::Rational::new(1, 2),
            ]
        );
    }

    #[test]
    fn tie_pairs_preserves_weighted_subdivision_timing() {
        let mut score = Score::subdivided(
            "weighted",
            &[60, 62, 64, 65],
            100,
            SubdivisionPolicy::Weighted(vec![1, 2, 3, 4]),
        );
        score.add_transform(
            TransformKind::Tie {
                pattern: TiePattern::Pairs,
            },
            NodeSelector::Root,
            None,
        );

        let tree = apply_pipeline(&score).unwrap();
        let root = tree.get(tree.root).unwrap();
        let pair_ids = match &root.kind {
            DurationKind::Subdivided {
                children,
                policy: SubdivisionPolicy::Explicit,
            } => children,
            _ => panic!("expected explicit pairs"),
        };
        assert_eq!(pair_ids.len(), 2);

        let first_pair = tree.get(pair_ids[0]).unwrap();
        let second_pair = tree.get(pair_ids[1]).unwrap();
        assert_eq!(first_pair.duration, cseq_model::Rational::new(3, 10));
        assert_eq!(second_pair.duration, cseq_model::Rational::new(7, 10));

        let first_children = match &first_pair.kind {
            DurationKind::Tied { children } => children,
            _ => panic!("expected tied pair"),
        };
        assert_eq!(
            first_children
                .iter()
                .map(|id| tree.get(*id).unwrap().duration)
                .collect::<Vec<_>>(),
            vec![
                cseq_model::Rational::new(1, 3),
                cseq_model::Rational::new(2, 3),
            ]
        );
    }

    mod prop_tests {
        use super::*;
        use proptest::prelude::*;
        use proptest::test_runner::{TestCaseError, TestCaseResult};
        use std::collections::HashSet;

        const CASES: u32 = 128;

        #[derive(Debug, Clone)]
        enum PipelineOp {
            SubdivideChild {
                child_index: usize,
                count: u32,
                policy: SubdivisionPolicy,
            },
            TieRoot(TiePattern),
            SetVelocity(u8),
            RemoveChild(usize),
        }

        proptest! {
            #![proptest_config(ProptestConfig {
                cases: CASES,
                max_shrink_iters: 2048,
                ..ProptestConfig::default()
            })]

            #[test]
            fn successful_subdivide_transforms_keep_tree_well_formed(
                count in 1_u32..=12,
                policy in subdivision_policy_strategy(),
            ) {
                let policy = normalize_policy(policy, count as usize);
                let mut score = Score::single_pulse("prop-subdivide", 60, 96);
                score.add_transform(
                    TransformKind::Subdivide { policy, count },
                    NodeSelector::Root,
                    None,
                );

                let tree = apply_pipeline(&score)?;

                assert_tree_invariants(&tree)?;
                assert_container_durations_tile(&tree)?;
            }

            #[test]
            fn successful_mixed_pipelines_keep_tree_well_formed(
                ops in proptest::collection::vec(pipeline_op_strategy(), 0..8),
            ) {
                let mut score = Score::subdivided(
                    "prop-pipeline",
                    &[60, 62, 64, 65],
                    96,
                    SubdivisionPolicy::Equal,
                );
                for op in ops {
                    add_pipeline_op(&mut score, op);
                }

                let Ok(tree) = apply_pipeline(&score) else {
                    return Ok(());
                };

                assert_tree_invariants(&tree)?;
                assert_container_durations_tile(&tree)?;
            }

            #[test]
            fn subdivision_switch_boundaries_create_per_beat_gati_sections(case in switch_case_strategy()) {
                let score = switch_case_score(&case);

                let tree = apply_pipeline_for_cycle(&score, 0)?;

                assert_switch_case(&tree, &case)?;
            }

            #[test]
            fn subdivision_switch_history_seed_sources_and_trims_history(
                seed in any::<u64>(),
                initial_history in proptest::collection::vec(any::<u64>(), 0..8),
                history_weight in 0_u8..=8,
                new_seed_weight in 0_u8..=8,
                max_history in 0_usize..=8,
                cycles in 1_u64..=12,
            ) {
                let mut mode = SwitchSeedMode::History {
                    seed,
                    history: initial_history,
                    history_weight: f32::from(history_weight),
                    new_seed_weight: f32::from(new_seed_weight),
                    max_history,
                };

                for cycle in 0..cycles {
                    let before = normalized_switch_history_for_max(
                        switch_history_from_mode(&mode),
                        max_history,
                    );
                    let can_use_history =
                        max_history > 0 && !before.is_empty() && history_weight > 0;
                    let can_make_new = new_seed_weight > 0;
                    let resolved = resolve_seed(&mut mode, cycle, 0, None);

                    if !can_use_history && !can_make_new {
                        prop_assert!(resolved.is_err());
                        continue;
                    }

                    let resolved = resolved?;
                    prop_assert_eq!(&resolved.history_before, &before);
                    prop_assert!(resolved.history_after.len() <= max_history);
                    match resolved.source {
                        SwitchSeedTraceSource::History => {
                            prop_assert!(can_use_history);
                            prop_assert!(before.contains(&resolved.seed));
                            prop_assert_eq!(&resolved.history_after, &before);
                        }
                        SwitchSeedTraceSource::New => {
                            prop_assert!(can_make_new);
                            if max_history == 0 {
                                prop_assert!(resolved.history_after.is_empty());
                            } else {
                                prop_assert_eq!(
                                    resolved.history_after.last().copied(),
                                    Some(resolved.seed)
                                );
                            }
                        }
                        other => {
                            return Err(TestCaseError::fail(format!(
                                "history switch mode returned unexpected source {other:?}"
                            )));
                        }
                    }
                    prop_assert_eq!(
                        switch_history_from_mode(&mode),
                        resolved.history_after.clone()
                    );
                }
            }
        }

        #[derive(Debug, Clone)]
        struct SwitchCase {
            cycle_beats: u32,
            boundary_after_beat: u32,
            initial_gati: u32,
            switched_gati: u32,
        }

        fn subdivision_policy_strategy() -> impl Strategy<Value = SubdivisionPolicy> {
            prop_oneof![
                Just(SubdivisionPolicy::Equal),
                Just(SubdivisionPolicy::Explicit),
                proptest::collection::vec(1_u32..=32, 1..=12).prop_map(SubdivisionPolicy::Weighted),
            ]
        }

        fn pipeline_op_strategy() -> impl Strategy<Value = PipelineOp> {
            prop_oneof![
                (0_usize..4, 1_u32..=5, subdivision_policy_strategy()).prop_map(
                    |(child_index, count, policy)| PipelineOp::SubdivideChild {
                        child_index,
                        count,
                        policy: normalize_policy(policy, count as usize),
                    }
                ),
                any::<bool>().prop_map(|pairs| {
                    PipelineOp::TieRoot(if pairs {
                        TiePattern::Pairs
                    } else {
                        TiePattern::All
                    })
                }),
                (0_u8..=127_u8).prop_map(PipelineOp::SetVelocity),
                (0_usize..4).prop_map(PipelineOp::RemoveChild),
            ]
        }

        fn switch_case_strategy() -> impl Strategy<Value = SwitchCase> {
            (
                2_u32..=8,
                gati_strategy(),
                gati_strategy(),
                any::<bool>(),
                any::<u32>(),
            )
                .prop_map(
                    |(cycle_beats, initial_gati, candidate_gati, same_gati, boundary_seed)| {
                        let boundary_after_beat = 1 + (boundary_seed % (cycle_beats - 1));
                        let switched_gati = if same_gati {
                            initial_gati
                        } else if candidate_gati == initial_gati {
                            match initial_gati {
                                3 => 4,
                                4 => 5,
                                _ => 3,
                            }
                        } else {
                            candidate_gati
                        };
                        SwitchCase {
                            cycle_beats,
                            boundary_after_beat,
                            initial_gati,
                            switched_gati,
                        }
                    },
                )
        }

        fn gati_strategy() -> impl Strategy<Value = u32> {
            prop_oneof![
                Just(3_u32),
                Just(4_u32),
                Just(5_u32),
                Just(7_u32),
                Just(8_u32),
                Just(9_u32),
                Just(11_u32),
                Just(16_u32),
            ]
        }

        fn switch_case_score(case: &SwitchCase) -> Score {
            let zero_accent = cseq_model::VelocityAccentRange { min: 0, max: 0 };
            Score::subdivision_switch(
                "prop-subdivision-switch",
                cseq_model::SubdivisionSwitchSpec {
                    cycle_beats: case.cycle_beats,
                    initial_weights: vec![cseq_model::WeightedSubdivisionChoice {
                        subdivision: case.initial_gati,
                        weight: 1.0,
                    }],
                    initial_jathi_weights: vec![],
                    initial_custom_subdivision: None,
                    automation: None,
                    inflections: vec![cseq_model::SubdivisionInflection {
                        id: Some("forced-boundary".to_string()),
                        position: Rational::new(
                            case.boundary_after_beat as i64,
                            case.cycle_beats as i64,
                        ),
                        change_probability: 1.0,
                        subdivision_weights: vec![cseq_model::WeightedSubdivisionChoice {
                            subdivision: case.switched_gati,
                            weight: 1.0,
                        }],
                        jathi_weights: vec![],
                        custom_subdivision: None,
                    }],
                    switch_count_weights: vec![cseq_model::WeightedSwitchCount {
                        count: 1,
                        weight: 1.0,
                    }],
                    seed_mode: cseq_model::SwitchSeedMode::Locked { seed: 1 },
                    accent: cseq_model::GatiAccentSpec {
                        beat_start: zero_accent.clone(),
                        section_start_extra: zero_accent.clone(),
                        jathi_start: zero_accent,
                        jathi_mode: cseq_model::JathiAccentMode::OverrideGati,
                    },
                    pitch: 60,
                    velocity: 96,
                },
            )
        }

        fn normalize_policy(policy: SubdivisionPolicy, count: usize) -> SubdivisionPolicy {
            match policy {
                SubdivisionPolicy::Weighted(mut weights) => {
                    weights.resize(count, 1);
                    weights.truncate(count);
                    for weight in &mut weights {
                        *weight = (*weight).max(1);
                    }
                    SubdivisionPolicy::Weighted(weights)
                }
                other => other,
            }
        }

        fn add_pipeline_op(score: &mut Score, op: PipelineOp) {
            match op {
                PipelineOp::SubdivideChild {
                    child_index,
                    count,
                    policy,
                } => score.add_transform(
                    TransformKind::Subdivide { policy, count },
                    NodeSelector::ByPath {
                        path: vec![child_index],
                    },
                    None,
                ),
                PipelineOp::TieRoot(pattern) => {
                    score.add_transform(TransformKind::Tie { pattern }, NodeSelector::Root, None)
                }
                PipelineOp::SetVelocity(velocity) => score.add_transform(
                    TransformKind::SetVelocity {
                        velocity: ValueSpec::fixed(velocity),
                    },
                    NodeSelector::Root,
                    None,
                ),
                PipelineOp::RemoveChild(child_index) => score.add_transform(
                    TransformKind::RemoveNode,
                    NodeSelector::ByPath {
                        path: vec![child_index],
                    },
                    None,
                ),
            };
        }

        fn assert_switch_case(tree: &DurationTree, case: &SwitchCase) -> TestCaseResult {
            let root = tree
                .get(tree.root)
                .ok_or_else(|| TestCaseError::fail("missing root"))?;
            let beat_ids = match &root.kind {
                DurationKind::Subdivided { children, .. } => children,
                _ => return Err(TestCaseError::fail("switch root was not subdivided")),
            };
            prop_assert_eq!(beat_ids.len(), case.cycle_beats as usize);

            for (beat_index, beat_id) in beat_ids.iter().copied().enumerate() {
                let expected_gati = expected_gati_for_beat(case, beat_index as u32);
                let beat = tree
                    .get(beat_id)
                    .ok_or_else(|| TestCaseError::fail(format!("missing beat {beat_id}")))?;
                prop_assert_eq!(beat.duration, Rational::new(1, case.cycle_beats as i64));
                let matra_ids = match &beat.kind {
                    DurationKind::Subdivided { children, policy } => {
                        prop_assert!(matches!(policy, SubdivisionPolicy::Equal));
                        children
                    }
                    _ => return Err(TestCaseError::fail("beat was not subdivided into matras")),
                };
                prop_assert_eq!(matra_ids.len(), expected_gati as usize);
                prop_assert_eq!(
                    beat.metadata.tags.contains(&"section-start".to_string()),
                    beat_index == 0 || beat_index as u32 == case.boundary_after_beat
                );

                for (matra_index, matra_id) in matra_ids.iter().copied().enumerate() {
                    let matra = tree
                        .get(matra_id)
                        .ok_or_else(|| TestCaseError::fail(format!("missing matra {matra_id}")))?;
                    prop_assert_eq!(matra.duration, Rational::new(1, expected_gati as i64));
                    prop_assert_eq!(matra.parent, Some(beat_id));
                    prop_assert_eq!(
                        matra
                            .metadata
                            .tags
                            .contains(&"section-start-matra".to_string()),
                        matra_index == 0
                            && (beat_index == 0 || beat_index as u32 == case.boundary_after_beat)
                    );
                }
            }

            let section_spans = tree
                .pulse_spans
                .iter()
                .filter(|span| matches!(span.kind, PulseSpanKind::Section { .. }))
                .collect::<Vec<_>>();
            prop_assert_eq!(section_spans.len(), 2);
            prop_assert_eq!(section_spans[0].start, Rational::new(0, 1));
            prop_assert_eq!(
                section_spans[0].duration,
                Rational::from_integer(case.boundary_after_beat as i64)
            );
            prop_assert_eq!(
                section_spans[0].matra_len,
                case.boundary_after_beat * case.initial_gati
            );
            prop_assert_eq!(
                section_spans[1].start,
                Rational::from_integer(case.boundary_after_beat as i64)
            );
            prop_assert_eq!(
                section_spans[1].duration,
                Rational::from_integer((case.cycle_beats - case.boundary_after_beat) as i64)
            );
            prop_assert_eq!(
                section_spans[1].matra_len,
                (case.cycle_beats - case.boundary_after_beat) * case.switched_gati
            );

            let gati_spans = tree
                .pulse_spans
                .iter()
                .filter_map(|span| match span.kind {
                    PulseSpanKind::GatiBeat { beat, gati, .. } => Some((span, beat, gati)),
                    _ => None,
                })
                .collect::<Vec<_>>();
            prop_assert_eq!(gati_spans.len(), case.cycle_beats as usize);
            for (span, beat, gati) in gati_spans {
                let beat_index = beat - 1;
                prop_assert_eq!(gati, expected_gati_for_beat(case, beat_index));
                prop_assert_eq!(span.start, Rational::from_integer(beat_index as i64));
                prop_assert_eq!(span.duration, Rational::new(1, 1));
                prop_assert_eq!(span.matra_len, gati);
            }

            Ok(())
        }

        fn expected_gati_for_beat(case: &SwitchCase, beat_index: u32) -> u32 {
            if beat_index < case.boundary_after_beat {
                case.initial_gati
            } else {
                case.switched_gati
            }
        }

        fn switch_history_from_mode(mode: &SwitchSeedMode) -> Vec<u64> {
            match mode {
                SwitchSeedMode::History { history, .. } => history.clone(),
                _ => vec![],
            }
        }

        fn normalized_switch_history_for_max(
            mut history: Vec<u64>,
            max_history: usize,
        ) -> Vec<u64> {
            if max_history == 0 {
                return vec![];
            }
            if history.len() > max_history {
                history.drain(0..history.len() - max_history);
            }
            history
        }

        fn assert_tree_invariants(tree: &DurationTree) -> TestCaseResult {
            prop_assert!(tree.nodes.contains_key(&tree.root));
            let mut visited = HashSet::new();
            visit_tree(tree, tree.root, &mut visited)?;
            prop_assert_eq!(visited.len(), tree.nodes.len());

            for node in tree.nodes.values() {
                prop_assert!(node.duration > Rational::new(0, 1));
                if let Some(parent) = node.parent {
                    prop_assert!(tree.nodes.contains_key(&parent));
                }
                match &node.kind {
                    DurationKind::Subdivided { children, policy } => {
                        prop_assert!(!children.is_empty());
                        prop_assert!(children.iter().all(|id| tree.nodes.contains_key(id)));
                        if let SubdivisionPolicy::Weighted(weights) = policy {
                            prop_assert_eq!(weights.len(), children.len());
                            prop_assert!(weights.iter().all(|weight| *weight > 0));
                        }
                    }
                    DurationKind::Tied { children } => {
                        prop_assert!(!children.is_empty());
                        prop_assert!(children.iter().all(|id| tree.nodes.contains_key(id)));
                    }
                    _ => {}
                }
            }
            Ok(())
        }

        fn visit_tree(
            tree: &DurationTree,
            node_id: NodeId,
            visited: &mut HashSet<NodeId>,
        ) -> TestCaseResult {
            prop_assert!(visited.insert(node_id), "duration tree contains a cycle");
            let node = tree
                .nodes
                .get(&node_id)
                .ok_or_else(|| TestCaseError::fail(format!("missing node {node_id}")))?;
            let children = match &node.kind {
                DurationKind::Subdivided { children, .. } | DurationKind::Tied { children } => {
                    children
                }
                _ => return Ok(()),
            };
            for child in children {
                let child_node = tree
                    .nodes
                    .get(child)
                    .ok_or_else(|| TestCaseError::fail(format!("missing child {child}")))?;
                prop_assert_eq!(child_node.parent, Some(node_id));
                visit_tree(tree, *child, visited)?;
            }
            Ok(())
        }

        fn assert_container_durations_tile(tree: &DurationTree) -> TestCaseResult {
            for node in tree.nodes.values() {
                let children = match &node.kind {
                    DurationKind::Subdivided { children, .. } | DurationKind::Tied { children } => {
                        children
                    }
                    _ => continue,
                };
                let total = children
                    .iter()
                    .map(|id| tree.nodes[id].duration)
                    .fold(Rational::new(0, 1), |acc, duration| acc + duration);
                prop_assert_eq!(total, Rational::new(1, 1));
            }
            Ok(())
        }
    }
}
