//! Authored evolution directives and their deterministic fold bookkeeping.
//!
//! This module owns only the score-shaped data and schedule math. Operator
//! application stays in `evolve.rs`, beside the legacy stochastic fold, so
//! preview and transport continue through the same generator seam.

use num_bigint::BigUint;
use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};

use crate::generators::GeneratorError;

use super::perceptual::PerceptualModelVersion;
use super::reshape::EuclidRestPolicy;

/// Hard upper bound for one authored evolution score. Validation checks this
/// before inspecting rows or running the same-family overlap scan, keeping
/// hostile DTOs from turning the pairwise authoring rule into unbounded work.
pub const MAX_EVOLUTION_DIRECTIVES: usize = 256;
/// The perceptual model reports normalized milli-distance on this closed
/// interval. Keeping authored targets in the same integer domain makes the
/// score portable and avoids float-dependent planner decisions.
pub const MAX_PERCEPTUAL_DISTANCE_MILLI: u32 = super::perceptual::PERCEPTUAL_DISTANCE_MAX_MILLI;
/// Hard work bound for one perceptually paced directive at one cycle.
pub const MAX_PERCEPTUAL_OPERATIONS: u32 = 256;
/// Maximum aggregate prefix-scoring work admitted by one generator
/// resolution. Dum-Ka reconstructs a requested cycle by folding every
/// historical cycle from one, so this budget is cumulative across every
/// enabled perceptual row that has entered that fold.
///
/// Each active row-cycle charges its normalized zero-prefix score plus up to
/// `maxOperations` nonzero-prefix scores. The default 16-operation search can
/// therefore remain active for 240 row-cycles. Keeping this separate from
/// [`MAX_PERCEPTUAL_OPERATIONS`] bounds a far historical preview without
/// making ordinary calibration too coarse.
pub const MAX_PERCEPTUAL_SCORING_WORK: u64 = 4_096;
/// Maximum microsteps one Morph target may reserve. Morph recomputes its
/// deterministic transport frontier after each accepted step, so this cap is
/// both a gradualism bound and a hostile-patch work bound.
pub const MAX_MORPH_MICROSTEPS: u32 = 256;
/// Maximum onset-pair evaluations admitted by one Morph alignment. Equal
/// cardinality enumerates every cyclic pairing; unequal cardinality runs one
/// edit-DP per target rotation.
pub const MAX_MORPH_ALIGNMENT_WORK: u64 = 65_536;
/// Sentinel used by trace rows produced by the un-authored stochastic layer.
/// Authored directive IDs validate as positive, so this cannot collide with
/// score rows. The legacy layer emits it only when a density-corridor clamp
/// actually changes or blocks that cycle; behavior-off traces stay empty.
pub const LEGACY_EVOLUTION_TRACE_ID: u64 = 0;

/// Trace identity for the composition-level evolution curve. Reserved at
/// JavaScript's MAX_SAFE_INTEGER: authored directive ids are validated
/// strictly below it, so the sentinel can never collide and still crosses
/// the JSON boundary losslessly.
pub const EVOLUTION_CURVE_TRACE_ID: u64 = 9_007_199_254_740_991;

/// Breakpoint cap for the evolution curve; enough for a long-form arc
/// while keeping validation and the editor canvas bounded.
pub const MAX_CURVE_POINTS: usize = 64;

/// Widest cycle span (last point − first point) the curve may cover. With
/// the per-cycle search bounded by [`MAX_CURVE_OPERATIONS`], the whole
/// curve stays inside the shared perceptual scoring budget.
pub const MAX_CURVE_SPAN_CYCLES: u64 = 512;

/// Per-cycle prefix-search cap for the curve, deliberately tighter than a
/// directive's [`MAX_PERCEPTUAL_OPERATIONS`]: the curve runs on every
/// covered cycle, so its per-cycle work is what playback latency feels.
pub const MAX_CURVE_OPERATIONS: u32 = 8;

/// One breakpoint of the composition-level evolution curve.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurvePoint {
    pub cycle: u64,
    pub target_milli: u32,
}

/// The composition-level evolution curve: a piecewise-linear perceptual
/// step-size target over the cycle axis. When enabled it replaces the
/// legacy stochastic layer on every cycle without an active directive —
/// the curve says how much a cycle changes, the authored family weights
/// say what kind of change is drawn, and directives remain the scalpel
/// that overrides both at specific cycles. Outside the points' span the
/// target is 0 (literal repetition).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvolutionCurve {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_curve_model_version")]
    pub model_version: PerceptualModelVersion,
    #[serde(default = "default_curve_tolerance")]
    pub tolerance_milli: u32,
    #[serde(default = "default_curve_operations")]
    pub max_operations: u32,
    #[serde(default)]
    pub points: Vec<CurvePoint>,
}

const fn default_curve_model_version() -> PerceptualModelVersion {
    PerceptualModelVersion::V1
}

const fn default_curve_tolerance() -> u32 {
    500
}

const fn default_curve_operations() -> u32 {
    4
}

impl Default for EvolutionCurve {
    fn default() -> Self {
        Self {
            enabled: false,
            model_version: PerceptualModelVersion::V1,
            tolerance_milli: default_curve_tolerance(),
            max_operations: default_curve_operations(),
            points: Vec::new(),
        }
    }
}

impl EvolutionCurve {
    /// Whether the curve does any work at all.
    pub fn is_active(&self) -> bool {
        self.enabled && self.points.iter().any(|point| point.target_milli > 0)
    }

    /// The interpolated target at `cycle`: 0 outside the points' span,
    /// exact at breakpoints, integer round-half-away-from-zero linear
    /// interpolation between neighbors. Pure integer arithmetic.
    pub fn target_milli_at(&self, cycle: u64) -> u32 {
        if !self.enabled || self.points.is_empty() {
            return 0;
        }
        let first = self.points.first().expect("non-empty");
        let last = self.points.last().expect("non-empty");
        if cycle < first.cycle || cycle > last.cycle {
            return 0;
        }
        let mut previous = first;
        for point in &self.points {
            if point.cycle == cycle {
                return point.target_milli;
            }
            if point.cycle > cycle {
                let span = i128::from(point.cycle) - i128::from(previous.cycle);
                let offset = i128::from(cycle) - i128::from(previous.cycle);
                let delta = i128::from(point.target_milli) - i128::from(previous.target_milli);
                let numerator = delta * offset;
                let half = span / 2;
                let rounded = if numerator >= 0 {
                    (numerator + half) / span
                } else {
                    (numerator - half) / span
                };
                let value = i128::from(previous.target_milli) + rounded;
                return u32::try_from(value.clamp(0, i128::from(MAX_PERCEPTUAL_DISTANCE_MILLI)))
                    .expect("clamped to u32 range");
            }
            previous = point;
        }
        0
    }

    /// Scoring evaluations the curve reserves through `through_cycle`:
    /// every covered cycle with a nonzero target costs the hold evaluation
    /// plus up to `max_operations` prefix evaluations. Authored data only.
    pub(crate) fn scoring_work_through(&self, through_cycle: u64) -> u64 {
        if !self.is_active() || through_cycle == 0 {
            return 0;
        }
        let first = self.points.first().expect("active curve has points").cycle;
        let last = self
            .points
            .last()
            .expect("active curve has points")
            .cycle
            .min(through_cycle);
        let mut total = 0u64;
        let mut cycle = first.max(1);
        while cycle <= last {
            if self.target_milli_at(cycle) > 0 {
                total = total.saturating_add(u64::from(self.max_operations).saturating_add(1));
            }
            cycle += 1;
        }
        total
    }
}

/// Pinned like every other dumka authoring error.
pub(crate) fn validate_curve(curve: &EvolutionCurve) -> Result<(), GeneratorError> {
    let invalid = |message: String| GeneratorError::DumkaPlanInvalid { message };
    if curve.points.len() > MAX_CURVE_POINTS {
        return Err(invalid(format!(
            "curve supports at most {MAX_CURVE_POINTS} points, got {}",
            curve.points.len()
        )));
    }
    let mut previous: Option<u64> = None;
    for point in &curve.points {
        if point.cycle == 0 {
            return Err(invalid("curve point cycles must be ≥ 1".to_string()));
        }
        if let Some(previous) = previous {
            if point.cycle <= previous {
                return Err(invalid(
                    "curve points must have strictly ascending cycles".to_string(),
                ));
            }
        }
        if point.target_milli > MAX_PERCEPTUAL_DISTANCE_MILLI {
            return Err(invalid(format!(
                "curve targetMilli must be 0-{MAX_PERCEPTUAL_DISTANCE_MILLI}, got {}",
                point.target_milli
            )));
        }
        previous = Some(point.cycle);
    }
    if curve.tolerance_milli > MAX_PERCEPTUAL_DISTANCE_MILLI {
        return Err(invalid(format!(
            "curve toleranceMilli must be 0-{MAX_PERCEPTUAL_DISTANCE_MILLI}, got {}",
            curve.tolerance_milli
        )));
    }
    if curve.max_operations == 0 || curve.max_operations > MAX_CURVE_OPERATIONS {
        return Err(invalid(format!(
            "curve maxOperations must be 1-{MAX_CURVE_OPERATIONS}, got {}",
            curve.max_operations
        )));
    }
    if let (Some(first), Some(last)) = (curve.points.first(), curve.points.last()) {
        let span = last.cycle.saturating_sub(first.cycle);
        if span > MAX_CURVE_SPAN_CYCLES {
            return Err(invalid(format!(
                "curve spans {span} cycles between its first and last points, the maximum is {MAX_CURVE_SPAN_CYCLES}"
            )));
        }
    }
    Ok(())
}

/// One contiguous beat scope, measured in the unrotated metric frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeatRange {
    pub start_beat: u32,
    pub len_beats: u32,
}

/// Direction for authored Rotate directives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum RotateDirection {
    #[default]
    Earlier,
    Later,
}

/// How an authored range schedules its operation budget.
///
/// `PerCycle` is the original behavior: intensity is applied again at every
/// cycle. The transition modes interpret intensity once at range start and
/// distribute that fixed target across the inclusive range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DirectivePacing {
    #[default]
    PerCycle,
    Linear,
    EaseInOut,
}

/// How a directive decides how many legal operator applications to realize.
///
/// `OperationQuota` is the historical intensity-driven behavior. Perceptual
/// pacing instead searches the legal prefix of the operator trajectory and
/// chooses the prefix nearest the requested transition distance. The enum is
/// internally tagged so future magnitude models remain additive on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DirectiveMagnitude {
    #[default]
    OperationQuota,
    Perceptual {
        model_version: PerceptualModelVersion,
        target_milli: u32,
        tolerance_milli: u32,
        max_operations: u32,
    },
}

impl DirectiveMagnitude {
    const fn is_operation_quota(&self) -> bool {
        matches!(self, Self::OperationQuota)
    }
}

/// Operator family named by an authored directive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectiveFamily {
    BarlowRemove,
    BarlowAdd,
    Rotate,
    Syncopate,
    Desyncopate,
    Fragment,
    Consolidate,
    Euclid,
    Stochastic,
    /// Directed, lattice-exact transport toward an authored Dum-Ka target.
    /// Morph is directive-only and never enters the stochastic family band.
    Morph,
}

impl DirectiveFamily {
    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::BarlowRemove => "barlowRemove",
            Self::BarlowAdd => "barlowAdd",
            Self::Rotate => "rotate",
            Self::Syncopate => "syncopate",
            Self::Desyncopate => "desyncopate",
            Self::Fragment => "fragment",
            Self::Consolidate => "consolidate",
            Self::Euclid => "euclid",
            Self::Stochastic => "stochastic",
            Self::Morph => "morph",
        }
    }
}

/// Family-specific overrides. `None` inherits the corresponding global knob.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectiveOptions {
    #[serde(default)]
    pub barlow_temperature: Option<u32>,
    #[serde(default)]
    pub fill_complexity: Option<u32>,
    #[serde(default)]
    pub euclid_max_run: Option<u32>,
    #[serde(default)]
    pub euclid_invert: Option<u32>,
    #[serde(default)]
    pub euclid_rest_policy: Option<EuclidRestPolicy>,
    /// Optional directive-local density corridor. The pair is all-or-nothing
    /// so one row cannot accidentally inherit half of an automated corridor.
    #[serde(default)]
    pub density_floor: Option<u32>,
    #[serde(default)]
    pub density_ceiling: Option<u32>,
    /// Optional directive-local attack-depth corridor, in normalized milli.
    /// Like density, the pair is all-or-nothing.
    #[serde(default)]
    pub complexity_floor: Option<u32>,
    #[serde(default)]
    pub complexity_ceiling: Option<u32>,
    /// Barlow/geometric placement blend. Zero is the historical Barlow order.
    #[serde(default)]
    pub placement_bias: Option<u32>,
    /// Optional palette-prime filter for candidate positions.
    #[serde(default)]
    pub subdivision_level: Option<u32>,
    /// Required target notation for the Morph family.
    #[serde(default)]
    pub morph_target: Option<String>,
    #[serde(default)]
    pub rotate_direction: RotateDirection,
}

/// One authored pin (`from_cycle == to_cycle`) or inclusive range.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvolutionDirective {
    pub id: u64,
    pub order: u32,
    pub enabled: bool,
    pub from_cycle: u64,
    pub to_cycle: u64,
    pub family: DirectiveFamily,
    #[serde(default)]
    pub pacing: DirectivePacing,
    /// Omitted legacy rows retain byte-identical intensity/quota semantics.
    #[serde(
        default,
        skip_serializing_if = "DirectiveMagnitude::is_operation_quota"
    )]
    pub magnitude: DirectiveMagnitude,
    pub intensity: u32,
    #[serde(default)]
    pub scope: Option<BeatRange>,
    #[serde(default)]
    pub options: DirectiveOptions,
}

impl EvolutionDirective {
    pub const fn is_pin(&self) -> bool {
        self.from_cycle == self.to_cycle
    }

    pub const fn is_active(&self, cycle: u64) -> bool {
        self.enabled && cycle >= self.from_cycle && cycle <= self.to_cycle
    }
}

/// Conservatively reserve the maximum legal-prefix scoring work needed to
/// reconstruct `requested_cycle`. Exact-target early exits are deliberately
/// ignored: request admission must depend only on authored data, never on the
/// evolving musical state. Disabled and strictly future rows cost no work;
/// completed rows still count because deterministic historical replay visits
/// their active cycles again on every resolution.
pub(crate) fn validate_perceptual_scoring_work_through(
    plan: &[EvolutionDirective],
    curve: &EvolutionCurve,
    through_cycle: u64,
) -> Result<(), GeneratorError> {
    let curve_work = curve.scoring_work_through(through_cycle);
    let requested = plan.iter().fold(curve_work, |total, directive| {
        let DirectiveMagnitude::Perceptual { max_operations, .. } = directive.magnitude else {
            return total;
        };
        if !directive.enabled || through_cycle == 0 {
            return total;
        }

        // The historical fold is exactly 1..=through_cycle. Clamping the
        // authored start keeps this helper total even before row validation.
        let first = directive.from_cycle.max(1);
        let last = directive.to_cycle.min(through_cycle);
        let active_cycles = if last < first {
            0
        } else {
            last.saturating_sub(first).saturating_add(1)
        };
        let scores_per_cycle = u64::from(max_operations).saturating_add(1);
        total.saturating_add(active_cycles.saturating_mul(scores_per_cycle))
    });

    if requested > MAX_PERCEPTUAL_SCORING_WORK {
        return Err(GeneratorError::DumkaPerceptualWorkLimit {
            requested,
            limit: MAX_PERCEPTUAL_SCORING_WORK,
        });
    }
    Ok(())
}

/// Why a scheduled quota did not fully apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DirectiveSkip {
    #[default]
    None,
    OrphanedScope,
    Projection,
    Exhausted,
}

/// Which side of the active density corridor prevented an operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DensityCorridorLimit {
    Floor,
    Ceiling,
}

/// Additive clamp detail for a directive trace. This deliberately does not
/// replace [`DirectiveSkip`]: projection and candidate exhaustion remain
/// independently truthful when they are the reason an operation stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DensityCorridorClamp {
    pub limit: DensityCorridorLimit,
    /// The effective authored or sampled boundary, in percent of grid slots.
    pub density_percent: u32,
}

/// Which side of the active attack-depth corridor prevented an operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComplexityCorridorLimit {
    Floor,
    Ceiling,
}

/// Additive depth-rail truth. Projection, density, and complexity may all be
/// reported for the same failed frontier without hiding one another.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComplexityCorridorClamp {
    pub limit: ComplexityCorridorLimit,
    pub complexity_milli: u32,
}

/// Additive truth for an opt-in perceptually paced transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerceptualPacingTrace {
    pub model_version: PerceptualModelVersion,
    pub actual_milli: u32,
    pub target_milli: u32,
    pub tolerance_milli: u32,
    pub reached: bool,
    /// True when a reachable-prefix search ran to its work cap or structural
    /// frontier without finding a prefix inside the tolerance window. An
    /// orphaned scope performs no search and therefore leaves this false.
    pub exhausted: bool,
}

/// Authoring trace for one active directive at one cycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectiveTraceEntry {
    pub cycle: u64,
    pub directive_id: u64,
    pub family: DirectiveFamily,
    pub requested: u32,
    pub applied: u32,
    pub skipped: DirectiveSkip,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corridor_clamp: Option<DensityCorridorClamp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub complexity_corridor_clamp: Option<ComplexityCorridorClamp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perceptual: Option<PerceptualPacingTrace>,
}

/// Exact integer remainder carried by one range across the historical fold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct RangeAccumulator {
    remainder: u64,
    transition_target: Option<u32>,
}

impl RangeAccumulator {
    /// Diffuse `intensity * candidates / 100` without floating point.
    pub(crate) fn quota(&mut self, intensity: u32, candidates: usize) -> u32 {
        let numerator = u64::from(intensity)
            .saturating_mul(u64::try_from(candidates).unwrap_or(u64::MAX))
            .saturating_add(self.remainder);
        let quota = numerator / 100;
        self.remainder = numerator % 100;
        u32::try_from(quota).unwrap_or(u32::MAX)
    }

    /// Return this cycle's delta and its transition-global operation ordinal.
    /// The target is captured exactly once, even when the first eased step is
    /// zero, so later candidate-count changes cannot turn the range into a
    /// compounding percentage.
    pub(crate) fn transition_quota(
        &mut self,
        directive: &EvolutionDirective,
        cycle: u64,
        candidates: usize,
        rotate: bool,
    ) -> (u32, u64) {
        let target = *self.transition_target.get_or_insert_with(|| {
            if rotate {
                rotate_pin_quota(directive.intensity, candidates)
            } else {
                pin_quota(directive.intensity, candidates)
            }
        });
        let len = directive
            .to_cycle
            .saturating_sub(directive.from_cycle)
            .saturating_add(1);
        let step = cycle.saturating_sub(directive.from_cycle).saturating_add(1);
        let before = transition_cumulative(directive.pacing, target, step - 1, len);
        let after = transition_cumulative(directive.pacing, target, step, len);
        (after.saturating_sub(before), u64::from(before))
    }
}

fn transition_cumulative(pacing: DirectivePacing, target: u32, step: u64, len: u64) -> u32 {
    if target == 0 || step == 0 {
        return 0;
    }
    if step >= len {
        return target;
    }
    let target = BigUint::from(target);
    let step = BigUint::from(step);
    let len = BigUint::from(len);
    let cumulative = match pacing {
        DirectivePacing::PerCycle => unreachable!("per-cycle ranges use the legacy accumulator"),
        DirectivePacing::Linear => (&target * &step) / &len,
        DirectivePacing::EaseInOut => {
            // smoothstep(t) = t²(3 - 2t), evaluated exactly as integers.
            let numerator = &target * &step * &step * ((&len * 3_u8) - (&step * 2_u8));
            let denominator = &len * &len * &len;
            numerator / denominator
        }
    };
    cumulative
        .to_u32()
        .unwrap_or(target.to_u32().unwrap_or(u32::MAX))
}

pub(crate) fn pin_quota(intensity: u32, candidates: usize) -> u32 {
    let numerator = u64::from(intensity).saturating_mul(candidates as u64);
    u32::try_from(numerator.div_ceil(100)).unwrap_or(u32::MAX)
}

pub(crate) fn rotate_pin_quota(intensity: u32, beats: usize) -> u32 {
    let numerator = u64::from(intensity).saturating_mul(beats as u64);
    u32::try_from((numerator + 50) / 100).unwrap_or(u32::MAX)
}

/// A validated slot window. End is exclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlotRange {
    pub start: u32,
    pub end: u32,
}

impl SlotRange {
    pub(crate) const fn contains_slot(self, slot: u32) -> bool {
        slot >= self.start && slot < self.end
    }

    pub(crate) const fn contains_interval(self, start: u32, end: u32) -> bool {
        start >= self.start && end <= self.end
    }

    pub(crate) const fn len(self) -> u32 {
        self.end - self.start
    }
}

pub(crate) fn slot_range(
    scope: Option<BeatRange>,
    total_beats: u32,
    subdivision: u32,
) -> Result<Option<SlotRange>, DirectiveSkip> {
    let Some(scope) = scope else {
        return Ok(None);
    };
    let Some(end_beat) = scope.start_beat.checked_add(scope.len_beats) else {
        return Err(DirectiveSkip::OrphanedScope);
    };
    if end_beat > total_beats {
        return Err(DirectiveSkip::OrphanedScope);
    }
    let start = scope
        .start_beat
        .checked_mul(subdivision)
        .ok_or(DirectiveSkip::OrphanedScope)?;
    let end = end_beat
        .checked_mul(subdivision)
        .ok_or(DirectiveSkip::OrphanedScope)?;
    Ok(Some(SlotRange { start, end }))
}

pub(crate) fn active_directives(
    plan: &[EvolutionDirective],
    cycle: u64,
) -> Vec<&EvolutionDirective> {
    let mut active = plan
        .iter()
        .filter(|directive| directive.is_active(cycle))
        .collect::<Vec<_>>();
    active.sort_by_key(|directive| (directive.order, directive.id));
    active
}

pub(crate) fn validate_plan(
    plan: &[EvolutionDirective],
    curve: &EvolutionCurve,
) -> Result<(), GeneratorError> {
    validate_curve(curve)?;
    if plan.len() > MAX_EVOLUTION_DIRECTIVES {
        return Err(GeneratorError::DumkaPlanInvalid {
            message: format!(
                "plan supports at most {MAX_EVOLUTION_DIRECTIVES} directives, got {}",
                plan.len()
            ),
        });
    }
    let mut seen_ids = std::collections::BTreeSet::new();
    for directive in plan {
        if directive.id == 0 {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: "directive id must be at least 1".to_string(),
            });
        }
        if directive.id >= EVOLUTION_CURVE_TRACE_ID {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: format!(
                    "directive id {} collides with the reserved curve sentinel {}",
                    directive.id, EVOLUTION_CURVE_TRACE_ID
                ),
            });
        }
        if !seen_ids.insert(directive.id) {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: format!("duplicate directive id {}", directive.id),
            });
        }
        if directive.from_cycle == 0 {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: format!("directive {} fromCycle must be at least 1", directive.id),
            });
        }
        if directive.to_cycle < directive.from_cycle {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: format!(
                    "directive {} toCycle must be at least fromCycle",
                    directive.id
                ),
            });
        }
        if directive.intensity > 100 {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: format!(
                    "directive {} intensity must be 0-100, got {}",
                    directive.id, directive.intensity
                ),
            });
        }
        if let DirectiveMagnitude::Perceptual {
            model_version: _,
            target_milli,
            tolerance_milli,
            max_operations,
        } = directive.magnitude
        {
            if target_milli > MAX_PERCEPTUAL_DISTANCE_MILLI {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} magnitude targetMilli must be 0-{MAX_PERCEPTUAL_DISTANCE_MILLI}, got {target_milli}",
                        directive.id
                    ),
                });
            }
            if tolerance_milli > MAX_PERCEPTUAL_DISTANCE_MILLI {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} magnitude toleranceMilli must be 0-{MAX_PERCEPTUAL_DISTANCE_MILLI}, got {tolerance_milli}",
                        directive.id
                    ),
                });
            }
            if !(1..=MAX_PERCEPTUAL_OPERATIONS).contains(&max_operations) {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} magnitude maxOperations must be 1-{MAX_PERCEPTUAL_OPERATIONS}, got {max_operations}",
                        directive.id
                    ),
                });
            }
            if directive.pacing != DirectivePacing::PerCycle {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} perceptual magnitude pacing must be perCycle",
                        directive.id
                    ),
                });
            }
            if directive.family == DirectiveFamily::Stochastic {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} stochastic magnitude must be operationQuota",
                        directive.id
                    ),
                });
            }
        }
        if directive.scope.is_some_and(|scope| scope.len_beats == 0) {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: format!(
                    "directive {} scope lenBeats must be at least 1",
                    directive.id
                ),
            });
        }
        if directive.family == DirectiveFamily::Stochastic
            && directive.pacing != DirectivePacing::PerCycle
        {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: format!(
                    "directive {} stochastic pacing must be perCycle",
                    directive.id
                ),
            });
        }
        for (name, value) in [
            ("barlowTemperature", directive.options.barlow_temperature),
            ("fillComplexity", directive.options.fill_complexity),
            ("euclidInvert", directive.options.euclid_invert),
            ("densityFloor", directive.options.density_floor),
            ("densityCeiling", directive.options.density_ceiling),
            ("placementBias", directive.options.placement_bias),
        ] {
            if let Some(value) = value.filter(|value| *value > 100) {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} {name} must be 0-100, got {value}",
                        directive.id
                    ),
                });
            }
        }
        match (
            directive.options.density_floor,
            directive.options.density_ceiling,
        ) {
            (Some(floor), Some(ceiling)) if floor > ceiling => {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} densityFloor must be at most densityCeiling, got {floor} > {ceiling}",
                        directive.id
                    ),
                });
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} densityFloor and densityCeiling must both be set or both be omitted",
                        directive.id
                    ),
                });
            }
            _ => {}
        }
        match (
            directive.options.complexity_floor,
            directive.options.complexity_ceiling,
        ) {
            (Some(floor), Some(ceiling)) if floor > ceiling => {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} complexityFloor must be at most complexityCeiling, got {floor} > {ceiling}",
                        directive.id
                    ),
                });
            }
            (Some(floor), Some(ceiling))
                if floor > MAX_PERCEPTUAL_DISTANCE_MILLI
                    || ceiling > MAX_PERCEPTUAL_DISTANCE_MILLI =>
            {
                let (name, value) = if floor > MAX_PERCEPTUAL_DISTANCE_MILLI {
                    ("complexityFloor", floor)
                } else {
                    ("complexityCeiling", ceiling)
                };
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} {name} must be 0-{MAX_PERCEPTUAL_DISTANCE_MILLI}, got {value}",
                        directive.id
                    ),
                });
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} complexityFloor and complexityCeiling must both be set or both be omitted",
                        directive.id
                    ),
                });
            }
            _ => {}
        }
        match (directive.family, directive.options.morph_target.as_deref()) {
            (DirectiveFamily::Morph, Some(target)) if !target.trim().is_empty() => {}
            (DirectiveFamily::Morph, _) => {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} morph requires options.morphTarget",
                        directive.id
                    ),
                });
            }
            (_, Some(_)) => {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: format!(
                        "directive {} morphTarget is only valid for morph",
                        directive.id
                    ),
                });
            }
            _ => {}
        }
        if let Some(value) = directive
            .options
            .euclid_max_run
            .filter(|value| *value == 0 || *value > 8)
        {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: format!(
                    "directive {} euclidMaxRun must be 1-8, got {value}",
                    directive.id
                ),
            });
        }
    }

    // Validate the complete authored ranges up front. A request-cycle guard
    // remains at the generator seam as defense in depth, but any plan accepted
    // here is safe throughout normal transport progression.
    validate_perceptual_scoring_work_through(plan, curve, u64::MAX)?;

    for (index, left) in plan.iter().enumerate() {
        for right in &plan[index + 1..] {
            if left.family != right.family {
                continue;
            }
            let first_shared = left.from_cycle.max(right.from_cycle);
            if first_shared <= left.to_cycle.min(right.to_cycle) {
                return Err(GeneratorError::DumkaPlanOverlap {
                    family: left.family.wire_name(),
                    first_id: left.id,
                    second_id: right.id,
                    cycle: first_shared,
                });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn directive(id: u64, family: DirectiveFamily, from: u64, to: u64) -> EvolutionDirective {
        EvolutionDirective {
            id,
            order: id as u32,
            enabled: true,
            from_cycle: from,
            to_cycle: to,
            family,
            pacing: DirectivePacing::PerCycle,
            magnitude: DirectiveMagnitude::OperationQuota,
            intensity: 32,
            scope: None,
            options: DirectiveOptions::default(),
        }
    }

    #[test]
    fn range_quota_is_error_diffused_without_clumps() {
        let mut accumulator = RangeAccumulator::default();
        let quotas = (0..10)
            .map(|_| accumulator.quota(32, 1))
            .collect::<Vec<_>>();
        assert_eq!(quotas, vec![0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
        assert_eq!(quotas.iter().sum::<u32>(), 3);
    }

    #[test]
    fn transition_ranges_schedule_one_exact_target_without_compounding() {
        let mut linear = directive(1, DirectiveFamily::BarlowRemove, 13, 16);
        linear.intensity = 25;
        linear.pacing = DirectivePacing::Linear;
        let mut accumulator = RangeAccumulator::default();
        let deltas = (13..=16)
            .map(|cycle| accumulator.transition_quota(&linear, cycle, 8, false).0)
            .collect::<Vec<_>>();
        assert_eq!(deltas, vec![0, 1, 0, 1]);
        assert_eq!(deltas.iter().sum::<u32>(), pin_quota(25, 8));

        let mut gentle = linear.clone();
        gentle.pacing = DirectivePacing::EaseInOut;
        gentle.intensity = 100;
        let mut accumulator = RangeAccumulator::default();
        let deltas = (13..=16)
            .map(|cycle| accumulator.transition_quota(&gentle, cycle, 8, false).0)
            .collect::<Vec<_>>();
        assert_eq!(deltas, vec![1, 3, 2, 2]);
        assert_eq!(deltas.iter().sum::<u32>(), 8);
    }

    #[test]
    fn stochastic_rejects_transition_pacing() {
        let mut row = directive(9, DirectiveFamily::Stochastic, 1, 4);
        row.pacing = DirectivePacing::Linear;
        assert_eq!(
            validate_plan(&[row], &EvolutionCurve::default())
                .unwrap_err()
                .to_string(),
            "dumka plan invalid: directive 9 stochastic pacing must be perCycle"
        );
    }

    #[test]
    fn legacy_magnitude_defaults_and_serializes_byte_compatibly() {
        let legacy = serde_json::json!({
            "id": 9,
            "order": 9,
            "enabled": true,
            "fromCycle": 1,
            "toCycle": 4,
            "family": "barlowAdd",
            "pacing": "perCycle",
            "intensity": 32,
            "scope": null,
            "options": {}
        });
        let row: EvolutionDirective = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(row.magnitude, DirectiveMagnitude::OperationQuota);
        let serialized = serde_json::to_value(row).unwrap();
        assert!(
            serialized.get("magnitude").is_none(),
            "the default must not add bytes to the historical wire object"
        );
    }

    #[test]
    fn perceptual_magnitude_is_bounded_and_rejects_combination_semantics() {
        let mut row = directive(9, DirectiveFamily::BarlowAdd, 1, 4);
        row.magnitude = DirectiveMagnitude::Perceptual {
            model_version: PerceptualModelVersion::V1,
            target_milli: 5_000,
            tolerance_milli: 500,
            max_operations: 16,
        };
        validate_plan(&[row.clone()], &EvolutionCurve::default())
            .expect("a bounded per-cycle target is valid");
        assert_eq!(
            serde_json::to_value(&row).unwrap()["magnitude"],
            serde_json::json!({
                "mode": "perceptual",
                "modelVersion": "v1",
                "targetMilli": 5_000,
                "toleranceMilli": 500,
                "maxOperations": 16
            })
        );
        let missing_version = serde_json::json!({
            "mode": "perceptual",
            "targetMilli": 5_000,
            "toleranceMilli": 500,
            "maxOperations": 16
        });
        assert!(
            serde_json::from_value::<DirectiveMagnitude>(missing_version).is_err(),
            "a perceptual row must pin its scoring model"
        );
        let unknown_version = serde_json::json!({
            "mode": "perceptual",
            "modelVersion": "v2",
            "targetMilli": 5_000,
            "toleranceMilli": 500,
            "maxOperations": 16
        });
        assert!(
            serde_json::from_value::<DirectiveMagnitude>(unknown_version).is_err(),
            "an unknown scoring model must fail closed"
        );

        row.pacing = DirectivePacing::Linear;
        assert_eq!(
            validate_plan(&[row.clone()], &EvolutionCurve::default())
                .unwrap_err()
                .to_string(),
            "dumka plan invalid: directive 9 perceptual magnitude pacing must be perCycle"
        );
        row.pacing = DirectivePacing::PerCycle;
        row.family = DirectiveFamily::Stochastic;
        assert_eq!(
            validate_plan(&[row.clone()], &EvolutionCurve::default())
                .unwrap_err()
                .to_string(),
            "dumka plan invalid: directive 9 stochastic magnitude must be operationQuota"
        );
        row.family = DirectiveFamily::BarlowAdd;
        row.magnitude = DirectiveMagnitude::Perceptual {
            model_version: PerceptualModelVersion::V1,
            target_milli: 5_000,
            tolerance_milli: 500,
            max_operations: 0,
        };
        assert_eq!(
            validate_plan(&[row], &EvolutionCurve::default())
                .unwrap_err()
                .to_string(),
            "dumka plan invalid: directive 9 magnitude maxOperations must be 1-256, got 0"
        );
    }

    #[test]
    fn perceptual_scoring_work_budget_accepts_the_boundary_and_rejects_one_more_cycle() {
        let mut row = directive(9, DirectiveFamily::BarlowAdd, 1, 240);
        row.magnitude = DirectiveMagnitude::Perceptual {
            model_version: PerceptualModelVersion::V1,
            target_milli: 5_000,
            tolerance_milli: 500,
            max_operations: 16,
        };
        validate_plan(&[row.clone()], &EvolutionCurve::default())
            .expect("240 default searches reserve 4,080 scores");

        row.to_cycle = 241;
        let error = validate_plan(&[row], &EvolutionCurve::default()).unwrap_err();
        assert_eq!(
            error,
            GeneratorError::DumkaPerceptualWorkLimit {
                requested: 4_097,
                limit: MAX_PERCEPTUAL_SCORING_WORK,
            }
        );
        assert_eq!(
            error.to_string(),
            "dumka perceptual plan reserves 4097 scoring operations, exceeding the limit of 4096"
        );

        let mut minimal = directive(10, DirectiveFamily::Fragment, 1, 2_048);
        minimal.magnitude = DirectiveMagnitude::Perceptual {
            model_version: PerceptualModelVersion::V1,
            target_milli: 5_000,
            tolerance_milli: 500,
            max_operations: 1,
        };
        validate_plan(&[minimal.clone()], &EvolutionCurve::default())
            .expect("one candidate plus P0 reserves two scores per active cycle");
        minimal.to_cycle = 2_049;
        assert_eq!(
            validate_plan(&[minimal], &EvolutionCurve::default()).unwrap_err(),
            GeneratorError::DumkaPerceptualWorkLimit {
                requested: 4_098,
                limit: MAX_PERCEPTUAL_SCORING_WORK,
            }
        );
    }

    #[test]
    fn perceptual_scoring_work_is_aggregate_saturating_and_enabled_only() {
        let perceptual = |mut row: EvolutionDirective, max_operations| {
            row.magnitude = DirectiveMagnitude::Perceptual {
                model_version: PerceptualModelVersion::V1,
                target_milli: 5_000,
                tolerance_milli: 500,
                max_operations,
            };
            row
        };
        let left = perceptual(directive(1, DirectiveFamily::BarlowAdd, 1, 120), 16);
        let right = perceptual(directive(2, DirectiveFamily::Fragment, 1, 120), 16);
        validate_plan(&[left.clone(), right.clone()], &EvolutionCurve::default())
            .expect("different families aggregate below the shared work boundary");

        let extra = perceptual(directive(3, DirectiveFamily::Rotate, 9, 9), 16);
        assert_eq!(
            validate_plan(&[left, right, extra], &EvolutionCurve::default()).unwrap_err(),
            GeneratorError::DumkaPerceptualWorkLimit {
                requested: MAX_PERCEPTUAL_SCORING_WORK + 1,
                limit: MAX_PERCEPTUAL_SCORING_WORK,
            }
        );

        let mut disabled = perceptual(
            directive(4, DirectiveFamily::Euclid, 1, u64::MAX),
            MAX_PERCEPTUAL_OPERATIONS,
        );
        disabled.enabled = false;
        validate_plan(&[disabled], &EvolutionCurve::default())
            .expect("disabled rows reserve no scoring work");

        let huge = perceptual(
            directive(5, DirectiveFamily::Consolidate, 1, u64::MAX),
            MAX_PERCEPTUAL_OPERATIONS,
        );
        assert_eq!(
            validate_plan(&[huge], &EvolutionCurve::default()).unwrap_err(),
            GeneratorError::DumkaPerceptualWorkLimit {
                requested: u64::MAX,
                limit: MAX_PERCEPTUAL_SCORING_WORK,
            },
            "inclusive range arithmetic must saturate instead of wrapping"
        );
    }

    #[test]
    fn request_relative_perceptual_work_guard_counts_only_replayed_history() {
        let mut row = directive(9, DirectiveFamily::BarlowAdd, 1, 241);
        row.magnitude = DirectiveMagnitude::Perceptual {
            model_version: PerceptualModelVersion::V1,
            target_milli: 5_000,
            tolerance_milli: 500,
            max_operations: 16,
        };
        validate_perceptual_scoring_work_through(&[row.clone()], &EvolutionCurve::default(), 0)
            .unwrap();
        validate_perceptual_scoring_work_through(&[row.clone()], &EvolutionCurve::default(), 240)
            .unwrap();
        assert_eq!(
            validate_perceptual_scoring_work_through(&[row], &EvolutionCurve::default(), 241)
                .unwrap_err(),
            GeneratorError::DumkaPerceptualWorkLimit {
                requested: 4_097,
                limit: MAX_PERCEPTUAL_SCORING_WORK,
            }
        );
    }

    #[test]
    fn directive_density_corridor_is_paired_ordered_and_bounded() {
        let mut row = directive(9, DirectiveFamily::Fragment, 1, 4);
        row.options.density_floor = Some(25);
        assert_eq!(
            validate_plan(&[row.clone()], &EvolutionCurve::default()).unwrap_err().to_string(),
            "dumka plan invalid: directive 9 densityFloor and densityCeiling must both be set or both be omitted"
        );

        row.options.density_ceiling = Some(20);
        assert_eq!(
            validate_plan(&[row.clone()], &EvolutionCurve::default()).unwrap_err().to_string(),
            "dumka plan invalid: directive 9 densityFloor must be at most densityCeiling, got 25 > 20"
        );

        row.options.density_floor = Some(0);
        row.options.density_ceiling = Some(101);
        assert_eq!(
            validate_plan(&[row.clone()], &EvolutionCurve::default())
                .unwrap_err()
                .to_string(),
            "dumka plan invalid: directive 9 densityCeiling must be 0-100, got 101"
        );

        row.options.density_ceiling = Some(60);
        validate_plan(&[row], &EvolutionCurve::default())
            .expect("a paired ordered corridor is valid");
    }

    #[test]
    fn clamp_trace_serializes_additively_to_the_skip_reason() {
        let trace = DirectiveTraceEntry {
            cycle: 4,
            directive_id: 9,
            family: DirectiveFamily::Fragment,
            requested: 2,
            applied: 1,
            skipped: DirectiveSkip::Projection,
            corridor_clamp: Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 60,
            }),
            complexity_corridor_clamp: None,
            perceptual: None,
        };
        assert_eq!(
            serde_json::to_value(trace).unwrap(),
            serde_json::json!({
                "cycle": 4,
                "directiveId": 9,
                "family": "fragment",
                "requested": 2,
                "applied": 1,
                "skipped": "projection",
                "corridorClamp": {"limit": "ceiling", "densityPercent": 60}
            })
        );
    }

    #[test]
    fn perceptual_trace_serializes_as_an_additive_truth_object() {
        let trace = DirectiveTraceEntry {
            cycle: 4,
            directive_id: 9,
            family: DirectiveFamily::Rotate,
            requested: 1,
            applied: 0,
            skipped: DirectiveSkip::Exhausted,
            corridor_clamp: None,
            complexity_corridor_clamp: None,
            perceptual: Some(PerceptualPacingTrace {
                model_version: PerceptualModelVersion::V1,
                actual_milli: 0,
                target_milli: 1_000,
                tolerance_milli: 100,
                reached: false,
                exhausted: true,
            }),
        };
        assert_eq!(
            serde_json::to_value(trace).unwrap(),
            serde_json::json!({
                "cycle": 4,
                "directiveId": 9,
                "family": "rotate",
                "requested": 1,
                "applied": 0,
                "skipped": "exhausted",
                "perceptual": {
                    "modelVersion": "v1",
                    "actualMilli": 0,
                    "targetMilli": 1_000,
                    "toleranceMilli": 100,
                    "reached": false,
                    "exhausted": true
                }
            })
        );
    }

    #[test]
    fn full_u64_transition_span_stays_total() {
        let mut row = directive(1, DirectiveFamily::BarlowRemove, 1, u64::MAX);
        row.intensity = 100;
        row.pacing = DirectivePacing::Linear;
        let mut accumulator = RangeAccumulator::default();
        assert_eq!(accumulator.transition_quota(&row, 1, 8, false), (0, 0));
        assert_eq!(
            accumulator.transition_quota(&row, u64::MAX, 8, false),
            (1, 7)
        );
    }

    #[test]
    fn same_family_overlap_is_rejected_even_when_disabled() {
        let left = directive(7, DirectiveFamily::BarlowRemove, 5, 9);
        let mut right = directive(9, DirectiveFamily::BarlowRemove, 8, 12);
        right.enabled = false;
        let error = validate_plan(&[left, right], &EvolutionCurve::default()).unwrap_err();
        assert_eq!(
            error.to_string(),
            "dumka plan overlap: barlowRemove directives 7 and 9 share cycle 8"
        );
    }

    #[test]
    fn directive_ids_are_positive_and_unique_across_families() {
        let mut zero = directive(1, DirectiveFamily::BarlowAdd, 1, 1);
        zero.id = 0;
        assert_eq!(
            validate_plan(&[zero], &EvolutionCurve::default())
                .unwrap_err()
                .to_string(),
            "dumka plan invalid: directive id must be at least 1"
        );

        let add = directive(7, DirectiveFamily::BarlowAdd, 1, 1);
        let remove = directive(7, DirectiveFamily::BarlowRemove, 2, 2);
        assert_eq!(
            validate_plan(&[add, remove], &EvolutionCurve::default())
                .unwrap_err()
                .to_string(),
            "dumka plan invalid: duplicate directive id 7"
        );
    }

    #[test]
    fn directive_count_cap_accepts_boundary_and_rejects_before_row_checks() {
        let valid_at_cap = (1..=MAX_EVOLUTION_DIRECTIVES)
            .map(|index| {
                directive(
                    index as u64,
                    DirectiveFamily::BarlowRemove,
                    index as u64,
                    index as u64,
                )
            })
            .collect::<Vec<_>>();
        validate_plan(&valid_at_cap, &EvolutionCurve::default())
            .expect("256 non-overlapping rows are legal");

        let mut too_many = valid_at_cap;
        let mut invalid_row = directive(0, DirectiveFamily::BarlowAdd, 0, 0);
        invalid_row.intensity = 101;
        too_many.push(invalid_row);
        assert_eq!(
            validate_plan(&too_many, &EvolutionCurve::default())
                .unwrap_err()
                .to_string(),
            "dumka plan invalid: plan supports at most 256 directives, got 257"
        );
    }

    #[test]
    fn different_families_layer_and_active_order_is_authored() {
        let mut remove = directive(2, DirectiveFamily::BarlowRemove, 3, 3);
        remove.order = 9;
        let mut fragment = directive(1, DirectiveFamily::Fragment, 3, 3);
        fragment.order = 2;
        let plan = vec![remove, fragment];
        validate_plan(&plan, &EvolutionCurve::default()).unwrap();
        let active = active_directives(&plan, 3);
        assert_eq!(active.iter().map(|d| d.id).collect::<Vec<_>>(), vec![1, 2]);
    }

    #[test]
    fn active_set_distinguishes_pins_ranges_gaps_and_disabled_rows() {
        let pin = directive(1, DirectiveFamily::BarlowRemove, 3, 3);
        let range = directive(2, DirectiveFamily::Fragment, 2, 4);
        let mut disabled = directive(3, DirectiveFamily::Rotate, 1, 5);
        disabled.enabled = false;
        let plan = vec![pin, range, disabled];
        let ids_at = |cycle| {
            active_directives(&plan, cycle)
                .into_iter()
                .map(|directive| directive.id)
                .collect::<Vec<_>>()
        };
        assert!(ids_at(1).is_empty());
        assert_eq!(ids_at(2), vec![2]);
        assert_eq!(ids_at(3), vec![1, 2]);
        assert_eq!(ids_at(4), vec![2]);
        assert!(ids_at(5).is_empty());
    }

    #[test]
    fn orphaned_scope_is_runtime_skip_not_validation_failure() {
        let scope = BeatRange {
            start_beat: 3,
            len_beats: 2,
        };
        assert_eq!(
            slot_range(Some(scope), 4, 4),
            Err(DirectiveSkip::OrphanedScope)
        );
        assert_eq!(
            slot_range(Some(scope), 5, 4),
            Ok(Some(SlotRange { start: 12, end: 20 }))
        );
    }

    proptest! {
        #[test]
        fn pin_quota_is_exact_ceiling(intensity in 0_u32..=100, candidates in 0_usize..=256) {
            let quota = pin_quota(intensity, candidates);
            let product = u64::from(intensity) * candidates as u64;
            prop_assert_eq!(u64::from(quota), product.div_ceil(100));
        }

        #[test]
        fn range_quota_diffuses_the_exact_integer_total(
            intensity in 0_u32..=100,
            candidates in prop::collection::vec(0_usize..=128, 1..=64),
        ) {
            let mut accumulator = RangeAccumulator::default();
            let mut applied = 0_u64;
            let mut numerator = 0_u64;
            for count in candidates {
                let quota = accumulator.quota(intensity, count);
                let local_numerator = u64::from(intensity) * count as u64;
                prop_assert!(u64::from(quota) <= local_numerator.div_ceil(100));
                applied += u64::from(quota);
                numerator += local_numerator;
            }
            prop_assert_eq!(applied, numerator / 100);
        }
    }

    #[test]
    fn curve_interpolation_is_integer_exact() {
        let curve = EvolutionCurve {
            enabled: true,
            model_version: PerceptualModelVersion::V1,
            tolerance_milli: 500,
            max_operations: 4,
            points: vec![
                CurvePoint {
                    cycle: 10,
                    target_milli: 1000,
                },
                CurvePoint {
                    cycle: 20,
                    target_milli: 4000,
                },
                CurvePoint {
                    cycle: 30,
                    target_milli: 0,
                },
            ],
        };
        assert_eq!(curve.target_milli_at(9), 0, "before the span");
        assert_eq!(curve.target_milli_at(10), 1000, "first breakpoint exact");
        assert_eq!(curve.target_milli_at(15), 2500, "midpoint of the ramp");
        assert_eq!(curve.target_milli_at(11), 1300);
        assert_eq!(curve.target_milli_at(20), 4000);
        assert_eq!(curve.target_milli_at(25), 2000, "descending half");
        assert_eq!(curve.target_milli_at(30), 0);
        assert_eq!(curve.target_milli_at(31), 0, "after the span");
        // Round-half-away-from-zero: 1000 + (3000 × 1)/10 rounds at .5.
        let half = EvolutionCurve {
            points: vec![
                CurvePoint {
                    cycle: 1,
                    target_milli: 0,
                },
                CurvePoint {
                    cycle: 3,
                    target_milli: 3,
                },
            ],
            ..curve.clone()
        };
        assert_eq!(half.target_milli_at(2), 2, "1.5 rounds away from zero");
        let disabled = EvolutionCurve {
            enabled: false,
            ..curve
        };
        assert_eq!(disabled.target_milli_at(15), 0);
    }

    #[test]
    fn curve_validation_messages_are_pinned() {
        let base = EvolutionCurve {
            enabled: true,
            model_version: PerceptualModelVersion::V1,
            tolerance_milli: 500,
            max_operations: 4,
            points: vec![CurvePoint {
                cycle: 1,
                target_milli: 1000,
            }],
        };
        let err = |curve: &EvolutionCurve| validate_curve(curve).unwrap_err().to_string();
        assert!(validate_curve(&base).is_ok());
        // An enabled empty curve is inert (is_active is false), so it is
        // deliberately legal: the natural authoring flow is enable, then
        // draw the first point.
        assert!(validate_curve(&EvolutionCurve {
            points: vec![],
            ..base.clone()
        })
        .is_ok());
        assert_eq!(
            err(&EvolutionCurve {
                max_operations: 9,
                ..base.clone()
            }),
            "dumka plan invalid: curve maxOperations must be 1-8, got 9"
        );
        assert_eq!(
            err(&EvolutionCurve {
                points: vec![
                    CurvePoint { cycle: 1, target_milli: 1 },
                    CurvePoint { cycle: 600, target_milli: 1 },
                ],
                ..base.clone()
            }),
            "dumka plan invalid: curve spans 599 cycles between its first and last points, the maximum is 512"
        );
        assert_eq!(
            err(&EvolutionCurve {
                points: vec![
                    CurvePoint {
                        cycle: 4,
                        target_milli: 1
                    },
                    CurvePoint {
                        cycle: 4,
                        target_milli: 2
                    },
                ],
                ..base.clone()
            }),
            "dumka plan invalid: curve points must have strictly ascending cycles"
        );
    }

    #[test]
    fn curve_work_shares_the_perceptual_budget() {
        // 512 nonzero cycles × (8 + 1) = 4,608 > 4,096: rejected up front.
        let hot = EvolutionCurve {
            enabled: true,
            model_version: PerceptualModelVersion::V1,
            tolerance_milli: 500,
            max_operations: 8,
            points: vec![
                CurvePoint {
                    cycle: 1,
                    target_milli: 1000,
                },
                CurvePoint {
                    cycle: 512,
                    target_milli: 1000,
                },
            ],
        };
        let error = validate_plan(&[], &hot).unwrap_err().to_string();
        assert!(
            error.contains("4608") && error.contains("4096"),
            "budget error names both numbers: {error}"
        );
        // Dialing the per-cycle search down fits the same span in budget.
        let cool = EvolutionCurve {
            max_operations: 4,
            ..hot
        };
        assert!(validate_plan(&[], &cool).is_ok());
        // Reserved sentinel id is rejected for authored rows.
        let mut row = directive(1, DirectiveFamily::BarlowRemove, 1, 1);
        row.id = EVOLUTION_CURVE_TRACE_ID;
        let sentinel = validate_plan(&[row], &EvolutionCurve::default())
            .unwrap_err()
            .to_string();
        assert!(sentinel.contains("reserved curve sentinel"), "{sentinel}");
    }
}
