//! The Dum-Ka evolution engine: cycle N's pattern is a pure fold of
//! identity-seeded operators over cycles 1..=N starting from the compiled
//! seed. With a Locked seed the trajectory is one deterministic piece of
//! music; PerCycle/History re-base the fold ("parallel universe at cycle
//! N"). Everything replays byte-identically because every stochastic
//! decision is keyed by (seed, cycle, purpose salt) — never by draw order.
//!
//! Operators (M2+M3, per docs/ROADMAP.md), drawn per cycle from the
//! authored family weights (defaults reproduce the historical 3/3/2 draw;
//! the displacement pair is opt-in at weight 0):
//!
//! - **BarlowRemove** — silence the least indispensable sounding onset
//!   (Barlow's "rhythmic dilution": density falls, metric feel survives).
//! - **BarlowAdd** — sound the most indispensable silent pulse as a
//!   one-slot hit, inheriting the preceding onset's stroke class.
//! - **Rotate** — move the whole pattern one beat earlier or later via a
//!   rotation register; Barlow ranks stay in the unrotated metric frame,
//!   where they mean something.
//! - **Syncopate / Desyncopate** — the Sioros–Guedes reversible
//!   displacement pair ([`super::sioros`]): anticipate an onset onto a
//!   silent faster pulse, or resolve a felt syncopation forward onto its
//!   silent stronger pulse.
//!
//! The Barlow choices widen deterministically with **temperature** (integer
//! pool over the rank order — an approximation of Barlow's real-valued
//! field-strength formula, chosen to keep replay free of platform
//! transcendentals). Three guards keep evolution musical and safe: the
//! **drift leash** bounds the onset-set distance from the seed (add,
//! remove, and displacement all count; rotation has its own register), an
//! **interval guard** skips displacements that would overlap a sustain
//! (the projector would silently swallow it), and every candidate is
//! **trial-projected** against the actual spans so evolution can stall but
//! playback can never break.

use crate::{mix_seed, SplitMix64};

use super::barlow::{factor_descending, indispensability, stratification};
use super::lattice::symmetric_difference;
use super::perceptual::{
    perceptual_distance, PerceptualContext, PerceptualCycleDistance, PerceptualModel,
    PerceptualModelVersion,
};
use super::plan::{
    active_directives, pin_quota, rotate_pin_quota, slot_range, ComplexityCorridorClamp,
    ComplexityCorridorLimit, DensityCorridorClamp, DensityCorridorLimit, DirectiveFamily,
    DirectiveMagnitude, DirectivePacing, DirectiveSkip, DirectiveTraceEntry, EvolutionCurve,
    EvolutionDirective, PerceptualPacingTrace, RangeAccumulator, RotateDirection, SlotRange,
    EVOLUTION_CURVE_TRACE_ID, LEGACY_EVOLUTION_TRACE_ID, MAX_MORPH_ALIGNMENT_WORK,
    MAX_MORPH_MICROSTEPS,
};
use super::sioros::{
    desyncopate_at, legal_desyncopations, legal_syncopations, metrical_levels, syncopation_target,
};
use super::tree::{CompiledSeed, SeedEvent};
use super::{
    DUMKA_BARLOW_TEMPERATURE_TARGET, DUMKA_COMPLEXITY_CEILING_TARGET,
    DUMKA_COMPLEXITY_FLOOR_TARGET, DUMKA_DENSITY_CEILING_TARGET, DUMKA_DENSITY_FLOOR_TARGET,
    DUMKA_DRIFT_LEASH_TARGET, DUMKA_EVOLUTION_RATE_TARGET, DUMKA_FILL_COMPLEXITY_TARGET,
};
use crate::generators::{
    ComplexityCorridorRange, DensityCorridorRange, GeneratorAutomationSampler, GeneratorError,
    GeneratorSpanInput,
};
use cseq_model::Rational;

const SALT_FIRE: u64 = 0xD0A1_5EED_0001_0001;
const SALT_OP: u64 = 0xD0A1_5EED_0002_0002;
const SALT_SIGN: u64 = 0xD0A1_5EED_0003_0003;
const SALT_POOL: u64 = 0xD0A1_5EED_0004_0004;
const SALT_SYNC_PICK: u64 = 0xD0A1_5EED_0005_0005;
const SALT_DESYNC_PICK: u64 = 0xD0A1_5EED_0006_0006;
/// Fragment's figure-size draw. Interval choice for both figure ops reuses
/// the SALT_POOL temperature pool exactly like Add/Remove candidate lists;
/// only the k draw needs its own stream (two draws in one fired cycle).
const SALT_FIG_K: u64 = 0xD0A1_5EED_0007_0007;
/// The evolution curve's family draw per search ordinal; every other draw
/// inside a curve step runs in the reserved sentinel id's plan stream.
const SALT_CURVE: u64 = 0xD0A1_5EED_0011_0011;
/// Euclid reshape's rotation draw (0..window len).
const SALT_EUCLID_ROT: u64 = 0xD0A1_5EED_0008_0008;
/// Euclid reshape's inversion chance (0..100 against euclidInvert).
const SALT_EUCLID_INV: u64 = 0xD0A1_5EED_0009_0009;
const SALT_PLAN: u64 = 0xD0A1_5EED_0010_0010;

/// Cumulative scan, candidate, and trial-projection work available to complexity
/// normalization during one requested-cycle reconstruction. A corridor can
/// be sampled on every historical cycle, so this lifetime guard matters more
/// than a per-call cap: once exhausted, later normalizations deterministically
/// hold and keep reporting the active floor/ceiling clamp.
const MAX_COMPLEXITY_NORMALIZATION_WORK: u64 = 65_536;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ComplexityNormalizationBudget {
    remaining: u64,
}

impl ComplexityNormalizationBudget {
    const fn new() -> Self {
        Self {
            remaining: MAX_COMPLEXITY_NORMALIZATION_WORK,
        }
    }

    fn spend(&mut self, work: u64) -> bool {
        if self.remaining < work {
            return false;
        }
        self.remaining -= work;
        true
    }
}

/// Per-family operator weights, in the fixed band order the draw uses.
/// The defaults reproduce the historical 3/3/2-of-8 mapping bit-exactly
/// (same salt, same bound, same band edges), so recorded locked-seed
/// trajectories replay unchanged until a weight is authored differently;
/// the displacement pair ships opt-in at weight 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpWeights {
    pub barlow_remove: u32,
    pub barlow_add: u32,
    pub rotate: u32,
    pub syncopate: u32,
    pub desyncopate: u32,
    pub fragment: u32,
    pub consolidate: u32,
    pub euclid: u32,
}

impl Default for OpWeights {
    fn default() -> Self {
        Self {
            barlow_remove: 3,
            barlow_add: 3,
            rotate: 2,
            syncopate: 0,
            desyncopate: 0,
            fragment: 0,
            consolidate: 0,
            euclid: 0,
        }
    }
}

impl OpWeights {
    fn total(&self) -> u64 {
        u64::from(self.barlow_remove)
            + u64::from(self.barlow_add)
            + u64::from(self.rotate)
            + u64::from(self.syncopate)
            + u64::from(self.desyncopate)
            + u64::from(self.fragment)
            + u64::from(self.consolidate)
            + u64::from(self.euclid)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvolvedOnset {
    /// Slot on the seed's own grid (total_beats × required_subdivision),
    /// in the unrotated metric frame.
    pub slot: u32,
    /// Duration in slots (never crosses what the seed's structure allowed).
    pub dur: u32,
    pub class: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvolutionState {
    pub onsets: Vec<EvolvedOnset>,
    /// Net whole-beat rotation, in beats, normalized to `0..total_beats`.
    pub rotation_beats: u32,
}

pub struct EvolutionInputs<'a> {
    pub seed_value: u64,
    pub cycle: u64,
    /// Authored fallback; automation is sampled separately for every step in
    /// the historical fold so cycle N cannot rewrite cycles 1..N-1.
    pub evolution_rate: u32,
    pub drift_leash: u32,
    /// Authored density corridor fallbacks. Automation is sampled at each
    /// folded cycle so replay preserves the complete historical shape.
    pub density_floor: u32,
    pub density_ceiling: u32,
    /// Authored attack-depth rail fallbacks, sampled at every fold cycle.
    pub complexity_floor: u32,
    pub complexity_ceiling: u32,
    /// Authored fallback for the Barlow candidate-pool temperature; the
    /// automation lane is sampled at each folded cycle like rate and leash.
    pub barlow_temperature: u32,
    /// Barlow/geometric placement blend sampled at every fold cycle.
    pub placement_bias: u32,
    /// Authored fallback for Fragment's figure-size bias; sampled per
    /// folded cycle like rate, leash, and temperature.
    pub fill_complexity: u32,
    /// Reshape burst cap (authored only, validated 1-8).
    pub euclid_max_run: u32,
    /// Reshape inversion chance in percent (authored only).
    pub euclid_invert: u32,
    /// Reshape duration style (authored only).
    pub euclid_rest_policy: super::reshape::EuclidRestPolicy,
    /// Authored directive plan. Empty means the exact legacy fold.
    pub plan: &'a [EvolutionDirective],
    pub curve: &'a EvolutionCurve,
    /// Authored only (no automation lane yet, documented).
    pub op_weights: OpWeights,
    pub automation: &'a GeneratorAutomationSampler<'a>,
    pub spans: &'a [GeneratorSpanInput],
    pub cycle_beats: u32,
}

/// Convert one compiled Dum-Ka cycle into the canonical state consumed by the
/// perceptual-distance API and the evolution fold.
pub fn evolution_state(seed: &CompiledSeed) -> EvolutionState {
    let s = seed.required_subdivision;
    EvolutionState {
        onsets: seed
            .events
            .iter()
            .map(|event| {
                let slot = event.start * Rational::from_integer(i64::from(s));
                let dur = event.dur * Rational::from_integer(i64::from(s));
                debug_assert!(slot.is_integer() && dur.is_integer());
                EvolvedOnset {
                    slot: u32::try_from(slot.to_integer()).expect("in range"),
                    dur: u32::try_from(dur.to_integer()).expect("in range"),
                    class: event.class.clone(),
                }
            })
            .collect(),
        rotation_beats: 0,
    }
}

fn seed_state(seed: &CompiledSeed) -> EvolutionState {
    evolution_state(seed)
}

/// Rebuild a projectable seed from an evolved state (rotation applied).
pub fn state_to_compiled(seed: &CompiledSeed, state: &EvolutionState) -> CompiledSeed {
    let s = i64::from(seed.required_subdivision);
    let slots = seed.total_beats * seed.required_subdivision;
    let shift = state.rotation_beats * seed.required_subdivision;
    let mut events: Vec<SeedEvent> = state
        .onsets
        .iter()
        .map(|onset| {
            let slot = (onset.slot + shift) % slots;
            SeedEvent {
                start: Rational::new(i64::from(slot), s),
                dur: Rational::new(i64::from(onset.dur), s),
                class: onset.class.clone(),
            }
        })
        .collect();
    events.sort_by(|a, b| a.start.cmp(&b.start));
    CompiledSeed {
        total_beats: seed.total_beats,
        required_subdivision: seed.required_subdivision,
        events,
    }
}

fn draw(seed_value: u64, cycle: u64, salt: u64, bound: u64) -> u64 {
    let mut rng = SplitMix64::new(mix_seed(seed_value ^ salt, cycle));
    rng.next_below(bound)
}

fn sampled_percent(inputs: &EvolutionInputs<'_>, target: &str, authored: u32, cycle: u64) -> u32 {
    (inputs.automation)(target, cycle, f64::from(authored))
        .unwrap_or(f64::from(authored))
        .round()
        .clamp(0.0, 100.0) as u32
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DensityCorridor {
    floor_count: usize,
    ceiling_count: usize,
    floor_percent: u32,
    ceiling_percent: u32,
}

impl DensityCorridor {
    fn new(floor_percent: u32, ceiling_percent: u32, slots: u32) -> Self {
        let ceiling_count = usize::try_from((u64::from(ceiling_percent) * u64::from(slots)) / 100)
            .unwrap_or(usize::MAX);
        let exact_floor =
            usize::try_from((u64::from(floor_percent) * u64::from(slots)).div_ceil(100))
                .unwrap_or(usize::MAX);
        // Small grids can have no integer onset count between two otherwise
        // valid percentages. As with crossed automation below, the ceiling
        // is the hard cap and therefore wins this discretization tie.
        let floor_count = exact_floor.min(ceiling_count);
        Self {
            floor_count,
            ceiling_count,
            floor_percent,
            ceiling_percent,
        }
    }

    fn clamp_for(self, onset_count: usize) -> Option<DensityCorridorClamp> {
        if onset_count < self.floor_count {
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Floor,
                density_percent: self.floor_percent,
            })
        } else if onset_count > self.ceiling_count {
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: self.ceiling_percent,
            })
        } else {
            None
        }
    }

    const fn percent_range(self) -> DensityCorridorRange {
        DensityCorridorRange {
            floor: self.floor_percent,
            ceiling: self.ceiling_percent,
        }
    }
}

fn normalization_clamp(
    before: &EvolutionState,
    after: &EvolutionState,
    corridor: DensityCorridor,
) -> Option<DensityCorridorClamp> {
    let changed = match after.onsets.len().cmp(&before.onsets.len()) {
        std::cmp::Ordering::Less => Some(DensityCorridorClamp {
            limit: DensityCorridorLimit::Ceiling,
            density_percent: corridor.ceiling_percent,
        }),
        std::cmp::Ordering::Greater => Some(DensityCorridorClamp {
            limit: DensityCorridorLimit::Floor,
            density_percent: corridor.floor_percent,
        }),
        std::cmp::Ordering::Equal => None,
    };
    // A projection fence can leave normalization with no admissible next
    // edit. Do not let an unchanged-but-still-outside state look like an
    // ordinary hold: the active rail remains independently truthful in the
    // preview trace.
    changed.or_else(|| corridor.clamp_for(after.onsets.len()))
}

fn sampled_density_corridor(
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    slots: u32,
) -> DensityCorridor {
    sampled_density_corridor_with_presence(inputs, cycle, slots).0
}

fn sampled_density_corridor_with_presence(
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    slots: u32,
) -> (DensityCorridor, bool) {
    let floor_sample = (inputs.automation)(
        DUMKA_DENSITY_FLOOR_TARGET,
        cycle,
        f64::from(inputs.density_floor),
    );
    let ceiling_sample = (inputs.automation)(
        DUMKA_DENSITY_CEILING_TARGET,
        cycle,
        f64::from(inputs.density_ceiling),
    );
    let sampled_floor = floor_sample
        .unwrap_or(f64::from(inputs.density_floor))
        .round()
        .clamp(0.0, 100.0) as u32;
    let sampled_ceiling = ceiling_sample
        .unwrap_or(f64::from(inputs.density_ceiling))
        .round()
        .clamp(0.0, 100.0) as u32;
    // Two automation lanes are independent and can cross between authored
    // points. Playback never fails for that transient: the ceiling remains
    // the hard cap and the effective floor contracts to meet it.
    (
        DensityCorridor::new(sampled_floor.min(sampled_ceiling), sampled_ceiling, slots),
        floor_sample.is_some() || ceiling_sample.is_some(),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ComplexityCorridor {
    floor_milli: u32,
    ceiling_milli: u32,
}

impl ComplexityCorridor {
    fn clamp_for(self, state: &EvolutionState, working: u32) -> Option<ComplexityCorridorClamp> {
        let complexity = super::depth::state_complexity_milli(&state_slots(state), working);
        if complexity < self.floor_milli {
            Some(ComplexityCorridorClamp {
                limit: ComplexityCorridorLimit::Floor,
                complexity_milli: self.floor_milli,
            })
        } else if complexity > self.ceiling_milli {
            Some(ComplexityCorridorClamp {
                limit: ComplexityCorridorLimit::Ceiling,
                complexity_milli: self.ceiling_milli,
            })
        } else {
            None
        }
    }

    const fn range(self) -> ComplexityCorridorRange {
        ComplexityCorridorRange {
            floor: self.floor_milli,
            ceiling: self.ceiling_milli,
        }
    }
}

fn sampled_complexity_corridor(inputs: &EvolutionInputs<'_>, cycle: u64) -> ComplexityCorridor {
    sampled_complexity_corridor_with_presence(inputs, cycle).0
}

fn sampled_complexity_corridor_with_presence(
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
) -> (ComplexityCorridor, bool) {
    let floor_sample = (inputs.automation)(
        DUMKA_COMPLEXITY_FLOOR_TARGET,
        cycle,
        f64::from(inputs.complexity_floor),
    );
    let ceiling_sample = (inputs.automation)(
        DUMKA_COMPLEXITY_CEILING_TARGET,
        cycle,
        f64::from(inputs.complexity_ceiling),
    );
    let floor = floor_sample
        .unwrap_or(f64::from(inputs.complexity_floor))
        .round()
        .clamp(0.0, 100_000.0) as u32;
    let ceiling = ceiling_sample
        .unwrap_or(f64::from(inputs.complexity_ceiling))
        .round()
        .clamp(0.0, 100_000.0) as u32;
    (
        ComplexityCorridor {
            floor_milli: floor.min(ceiling),
            ceiling_milli: ceiling,
        },
        floor_sample.is_some() || ceiling_sample.is_some(),
    )
}

fn directive_complexity_corridor(
    directive: &EvolutionDirective,
    global: ComplexityCorridor,
) -> ComplexityCorridor {
    match (
        directive.options.complexity_floor,
        directive.options.complexity_ceiling,
    ) {
        (Some(floor), Some(ceiling)) => ComplexityCorridor {
            floor_milli: floor.min(ceiling),
            ceiling_milli: ceiling,
        },
        _ => global,
    }
}

fn directive_density_corridor(
    directive: &EvolutionDirective,
    global: DensityCorridor,
    slots: u32,
) -> DensityCorridor {
    match (
        directive.options.density_floor,
        directive.options.density_ceiling,
    ) {
        (Some(floor), Some(ceiling)) => DensityCorridor::new(floor, ceiling, slots),
        _ => global,
    }
}

/// The candidate operators; the drawn one applies unless a guard skips it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Remove,
    Add,
    Rotate,
    Syncopate,
    Desyncopate,
    Fragment,
    Consolidate,
    Euclid,
}

fn drawn_op(weights: &OpWeights, seed_value: u64, cycle: u64) -> Option<Op> {
    let total = weights.total();
    if total == 0 {
        return None;
    }
    op_for_roll(weights, draw(seed_value, cycle, SALT_OP, total))
}

fn op_for_roll(weights: &OpWeights, mut roll: u64) -> Option<Op> {
    for (op, weight) in [
        (Op::Remove, weights.barlow_remove),
        (Op::Add, weights.barlow_add),
        (Op::Rotate, weights.rotate),
        (Op::Syncopate, weights.syncopate),
        (Op::Desyncopate, weights.desyncopate),
        (Op::Fragment, weights.fragment),
        (Op::Consolidate, weights.consolidate),
        (Op::Euclid, weights.euclid),
    ] {
        let band = u64::from(weight);
        if roll < band {
            return Some(op);
        }
        roll -= band;
    }
    None
}

/// Barlow "field strength" as deterministic pool widening: temperature 0
/// keeps the argmax/argmin choice; temperature 100 draws uniformly over all
/// candidates; between, the pool grows linearly over the rank-sorted
/// candidates. Integer arithmetic only — Barlow's real-valued probability
/// formula would drag platform-varying transcendentals into the replay
/// contract, so the pool model is documented as an approximation.
fn pool_pick(candidates: usize, temperature: u32, seed_value: u64, cycle: u64) -> usize {
    if candidates <= 1 {
        return 0;
    }
    let widen = (u64::from(temperature) * (candidates as u64 - 1)) / 100;
    let pool = 1 + widen as usize;
    if pool <= 1 {
        return 0;
    }
    draw(seed_value, cycle, SALT_POOL, pool as u64) as usize
}

fn plan_draw(seed_value: u64, directive_id: u64, cycle: u64, ordinal: u64, bound: u64) -> u64 {
    debug_assert!(bound > 0);
    let directive_stream = seed_value ^ SALT_PLAN ^ mix_seed(directive_id, ordinal);
    let mut rng = SplitMix64::new(mix_seed(directive_stream, cycle));
    rng.next_below(bound)
}

fn plan_pool_pick(
    candidates: usize,
    temperature: u32,
    seed_value: u64,
    directive_id: u64,
    cycle: u64,
    ordinal: u64,
) -> usize {
    if candidates <= 1 {
        return 0;
    }
    let widen = (u64::from(temperature) * (candidates as u64 - 1)) / 100;
    let pool = 1 + widen as usize;
    if pool <= 1 {
        return 0;
    }
    plan_draw(seed_value, directive_id, cycle, ordinal, pool as u64) as usize
}

/// Sustained notes make overlap possible after a displacement; the span
/// projector silently consumes overlapped onsets, so an op that would
/// overlap (or run past the cycle end) must be skipped explicitly.
fn state_intervals_disjoint(state: &EvolutionState, slots: u32) -> bool {
    let mut previous_end = 0u32;
    for onset in &state.onsets {
        if onset.slot < previous_end {
            return false;
        }
        let Some(end) = onset.slot.checked_add(onset.dur) else {
            return false;
        };
        if end > slots {
            return false;
        }
        previous_end = end;
    }
    true
}

/// Validate intervals after the global rotation register is applied. A
/// rotation wraps onsets onto the cycle, but cycle edges are absolute sustain
/// fences: durations do not wrap with them. Sorting the physical intervals is
/// also necessary because wrapping changes their temporal order and can make
/// two otherwise-disjoint state intervals overlap.
fn rotated_state_intervals_disjoint(seed: &CompiledSeed, state: &EvolutionState) -> bool {
    let slots = seed.total_beats.saturating_mul(seed.required_subdivision);
    if slots == 0 {
        return false;
    }
    let shift = state
        .rotation_beats
        .saturating_mul(seed.required_subdivision)
        % slots;
    let mut intervals = Vec::with_capacity(state.onsets.len());
    for onset in &state.onsets {
        let Some(shifted) = onset.slot.checked_add(shift) else {
            return false;
        };
        let start = shifted % slots;
        let Some(end) = start.checked_add(onset.dur) else {
            return false;
        };
        if onset.dur == 0 || end > slots {
            return false;
        }
        intervals.push((start, end));
    }
    intervals.sort_unstable();
    intervals.windows(2).all(|pair| pair[0].1 <= pair[1].0)
}

fn state_slots(state: &EvolutionState) -> Vec<u32> {
    state.onsets.iter().map(|onset| onset.slot).collect()
}

/// A scoped attack owns its complete sounding interval, not only its onset.
/// This keeps destructive and displacement edits from reaching across a
/// directive boundary through an inherited sustain.
fn onset_fits_window(onset: &EvolvedOnset, window: Option<SlotRange>) -> bool {
    window.map_or(true, |window| {
        onset
            .slot
            .checked_add(onset.dur)
            .is_some_and(|end| window.contains_interval(onset.slot, end))
    })
}

/// Sioros moves preserve duration, so both the source interval and the
/// destination interval must be contained by an authored scope.
fn onset_move_fits_window(
    state: &EvolutionState,
    from: u32,
    to: u32,
    window: Option<SlotRange>,
) -> bool {
    let Some(window) = window else {
        return true;
    };
    state
        .onsets
        .iter()
        .find(|onset| onset.slot == from)
        .is_some_and(|onset| {
            let source_end = onset.slot.checked_add(onset.dur);
            let destination_end = to.checked_add(onset.dur);
            source_end.is_some_and(|end| window.contains_interval(onset.slot, end))
                && destination_end.is_some_and(|end| window.contains_interval(to, end))
        })
}

fn scoped_legal_syncopations(
    state: &EvolutionState,
    template: &[u32],
    beat_level: u32,
    window: Option<SlotRange>,
) -> Vec<super::sioros::SiorosVector> {
    let onset_slots = state_slots(state);
    legal_syncopations(&onset_slots, template, beat_level, window)
        .into_iter()
        .filter(|&vector| {
            syncopation_target(&onset_slots, template, vector, beat_level)
                .is_some_and(|landing| onset_move_fits_window(state, vector.pulse, landing, window))
        })
        .collect()
}

fn scoped_legal_desyncopations(
    state: &EvolutionState,
    template: &[u32],
    beat_level: u32,
    window: Option<SlotRange>,
) -> Vec<u32> {
    let onset_slots = state_slots(state);
    legal_desyncopations(&onset_slots, template, beat_level, window)
        .into_iter()
        .filter(|&pulse| {
            desyncopate_at(&onset_slots, template, pulse, beat_level)
                .is_some_and(|(source, _)| onset_move_fits_window(state, source, pulse, window))
        })
        .collect()
}

fn state_is_projectable(
    seed: &CompiledSeed,
    state: &EvolutionState,
    inputs: &EvolutionInputs<'_>,
) -> bool {
    if !rotated_state_intervals_disjoint(seed, state) {
        return false;
    }
    let projected = state_to_compiled(seed, state);
    super::tree::resolve_seed_cells(&projected, inputs.cycle_beats, inputs.spans).is_ok()
}

/// Bring inherited state into the active density corridor before this
/// cycle's operators run. Contraction removes weakest onsets first;
/// expansion adds the strongest missing grid pulses first, splitting an
/// existing sustain when necessary. Every individual edit is trial-projected,
/// giving normalization the same playability fence as ordinary evolution
/// while keeping the choice equivalent to temperature zero (no
/// draw-order-dependent randomness).
fn normalize_to_density_corridor(
    seed: &CompiledSeed,
    state: &EvolutionState,
    ranks: &[u32],
    inputs: &EvolutionInputs<'_>,
    corridor: DensityCorridor,
) -> EvolutionState {
    let slots = seed.total_beats * seed.required_subdivision;
    let mut current = state.clone();

    while current.onsets.len() > corridor.ceiling_count {
        let mut weakest = current
            .onsets
            .iter()
            .map(|onset| onset.slot)
            .collect::<Vec<_>>();
        weakest.sort_by_key(|&slot| (ranks[slot as usize], slot));
        let mut changed = false;
        for slot in weakest {
            let mut candidate = current.clone();
            candidate.onsets.retain(|onset| onset.slot != slot);
            if state_is_projectable(seed, &candidate, inputs) {
                current = candidate;
                changed = true;
                break;
            }
        }
        if !changed {
            break;
        }
    }

    while current.onsets.len() < corridor.floor_count {
        let mut strongest = (0..slots)
            .filter(|slot| current.onsets.iter().all(|onset| onset.slot != *slot))
            .collect::<Vec<_>>();
        strongest.sort_by_key(|&slot| (std::cmp::Reverse(ranks[slot as usize]), slot));
        let mut changed = false;
        for slot in strongest {
            let mut candidate = current.clone();
            let covering = candidate
                .onsets
                .iter()
                .position(|onset| onset.slot < slot && slot < onset.slot.saturating_add(onset.dur));
            let added = if let Some(index) = covering {
                // A high authored floor can require articulating an existing
                // sustain. Split it without changing coverage or stroke
                // class; this is the deterministic, temperature-zero form
                // of adding the strongest missing onset.
                let old_end = candidate.onsets[index]
                    .slot
                    .saturating_add(candidate.onsets[index].dur);
                let class = candidate.onsets[index].class.clone();
                candidate.onsets[index].dur = slot - candidate.onsets[index].slot;
                EvolvedOnset {
                    slot,
                    dur: old_end - slot,
                    class,
                }
            } else {
                EvolvedOnset {
                    slot,
                    dur: 1,
                    class: fill_class_before(&current, slot),
                }
            };
            let insert_at = candidate.onsets.partition_point(|onset| onset.slot < slot);
            candidate.onsets.insert(insert_at, added);
            if state_is_projectable(seed, &candidate, inputs) {
                current = candidate;
                changed = true;
                break;
            }
        }
        if !changed {
            break;
        }
    }

    current
}

/// Deterministically push or pull attack depth into the active rail. Every
/// onset is touched at most once per pass, and every move is trial-projected.
fn normalize_to_complexity_corridor(
    seed: &CompiledSeed,
    state: &EvolutionState,
    ranks: &[u32],
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    placement_bias_override: Option<u32>,
    corridor: ComplexityCorridor,
    work_budget: &mut ComplexityNormalizationBudget,
) -> (EvolutionState, Option<ComplexityCorridorClamp>) {
    let working = seed.required_subdivision;
    let cycle_slots = seed.total_beats.saturating_mul(working);
    // The default rail admits the metric's complete codomain. Preserve the
    // behavior-off fold without even rescoring a dense inherited state.
    if corridor.floor_milli == 0 && corridor.ceiling_milli == 100_000 {
        return (state.clone(), None);
    }
    let initial = super::depth::state_complexity_milli(&state_slots(state), working);
    if initial >= corridor.floor_milli && initial <= corridor.ceiling_milli {
        return (state.clone(), None);
    }
    let promote = initial < corridor.floor_milli;
    let placement_bias = placement_bias_override.unwrap_or_else(|| {
        sampled_percent(
            inputs,
            super::DUMKA_PLACEMENT_BIAS_TARGET,
            inputs.placement_bias,
            cycle,
        )
    });
    let mut current = state.clone();
    // Source priority is invariant until that original onset is consumed:
    // normalization only moves the selected source, and a moved source is
    // never revisited. Sort once instead of rebuilding and sorting the same
    // source list after every successful move.
    let mut source_slots = state_slots(state);
    source_slots.sort_by_key(|&slot| {
        let depth = super::depth::onset_depth(slot, working);
        if promote {
            (depth, ranks[slot as usize], slot)
        } else {
            (u32::MAX - depth, u32::MAX - ranks[slot as usize], slot)
        }
    });
    for source_slot in source_slots {
        let complexity = super::depth::state_complexity_milli(&state_slots(&current), working);
        if (promote && complexity >= corridor.floor_milli)
            || (!promote && complexity <= corridor.ceiling_milli)
        {
            break;
        }
        // Account for the state scan, source lookup, and coverage map before
        // performing them. This makes the lifetime cap effective even when a
        // nearly full multi-beat grid has only one silent candidate.
        let scan_work = u64::from(cycle_slots)
            .saturating_add(u64::try_from(current.onsets.len()).unwrap_or(u64::MAX));
        if !work_budget.spend(scan_work) {
            break;
        }
        let Some(index) = current
            .onsets
            .iter()
            .position(|onset| onset.slot == source_slot)
        else {
            continue;
        };
        // A fully covered grid has no legal movement target. This case is
        // common after a density-floor articulation pass and must not sort
        // and rescan every onset merely to discover the same fact.
        let occupied = occupied_slots(&current, cycle_slots);
        let candidates = (0..cycle_slots)
            .filter(|slot| !occupied[*slot as usize])
            .collect::<Vec<_>>();
        if candidates.is_empty() {
            break;
        }
        // Candidate pricing is linear in the silent set. With geometric
        // placement active, field construction also scans the current onset
        // set; charge that extra scan before building it.
        let candidate_work = u64::try_from(candidates.len()).unwrap_or(u64::MAX);
        let geometric_work = if placement_bias == 0 {
            0
        } else {
            u64::try_from(current.onsets.len())
                .unwrap_or(u64::MAX)
                .saturating_add(u64::from(working))
        };
        if !work_budget.spend(candidate_work.saturating_add(geometric_work)) {
            break;
        }
        let source = current.onsets[index].clone();
        let placement_order = blended_candidate_order(
            &candidates,
            &current,
            ranks,
            working,
            placement_bias,
            // Promote and Demote both choose a silent target. The
            // mirror is depth-price direction, not deletion energy at
            // a target that does not yet exist.
            true,
        );
        let placement_ranks = super::spectrum::normalized_ranks(&placement_order);
        let moves = if promote {
            super::depth::promotion_candidates(
                source.slot,
                working,
                cycle_slots,
                &candidates,
                &placement_ranks,
            )
        } else {
            super::depth::demotion_candidates(
                source.slot,
                working,
                cycle_slots,
                &candidates,
                &placement_ranks,
            )
        };
        for movement in moves {
            // Trial projection can be substantially more expensive than
            // pure candidate pricing, so it consumes an additional unit.
            if !work_budget.spend(1) {
                break;
            }
            let mut candidate = current.clone();
            candidate.onsets[index].slot = movement.slot;
            candidate.onsets.sort_by_key(|onset| onset.slot);
            let candidate_complexity =
                super::depth::state_complexity_milli(&state_slots(&candidate), working);
            if ((!promote && candidate_complexity >= corridor.floor_milli)
                || (promote && candidate_complexity <= corridor.ceiling_milli))
                && state_is_projectable(seed, &candidate, inputs)
            {
                current = candidate;
                break;
            }
        }
    }
    let limit = if promote {
        ComplexityCorridorLimit::Floor
    } else {
        ComplexityCorridorLimit::Ceiling
    };
    (
        current,
        Some(ComplexityCorridorClamp {
            limit,
            complexity_milli: if promote {
                corridor.floor_milli
            } else {
                corridor.ceiling_milli
            },
        }),
    )
}

#[allow(clippy::too_many_arguments)]
fn normalize_to_active_corridors(
    seed: &CompiledSeed,
    state: &EvolutionState,
    ranks: &[u32],
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    placement_bias_override: Option<u32>,
    density: DensityCorridor,
    complexity: ComplexityCorridor,
    complexity_work_budget: &mut ComplexityNormalizationBudget,
) -> (
    EvolutionState,
    Option<DensityCorridorClamp>,
    Option<ComplexityCorridorClamp>,
) {
    let density_normalized = normalize_to_density_corridor(seed, state, ranks, inputs, density);
    let density_clamp = normalization_clamp(state, &density_normalized, density)
        .or_else(|| density.clamp_for(density_normalized.onsets.len()));
    let (normalized, complexity_clamp) = normalize_to_complexity_corridor(
        seed,
        &density_normalized,
        ranks,
        inputs,
        cycle,
        placement_bias_override,
        complexity,
        complexity_work_budget,
    );
    (normalized, density_clamp, complexity_clamp)
}

fn legacy_corridor_trace(
    cycle: u64,
    density: Option<DensityCorridorClamp>,
    complexity: Option<ComplexityCorridorClamp>,
) -> Option<DirectiveTraceEntry> {
    (density.is_some() || complexity.is_some()).then_some(DirectiveTraceEntry {
        cycle,
        directive_id: LEGACY_EVOLUTION_TRACE_ID,
        family: DirectiveFamily::Stochastic,
        requested: 0,
        applied: 0,
        skipped: DirectiveSkip::None,
        corridor_clamp: density,
        complexity_corridor_clamp: complexity,
        perceptual: None,
    })
}

/// Tightening an automated leash must not leave an inherited state outside
/// the new bound. Undo added onsets first (weakest first), then restore missing
/// authored-anchor onsets (strongest first), trial-projecting every change. This is
/// deterministic constraint normalization, not the cycle's stochastic op.
fn normalize_to_leash(
    seed: &CompiledSeed,
    state: &EvolutionState,
    leash_anchor: &EvolutionState,
    ranks: &[u32],
    inputs: &EvolutionInputs<'_>,
    budget: u32,
) -> EvolutionState {
    let anchor_slots = state_slots(leash_anchor);
    if symmetric_difference(&state_slots(state), &anchor_slots) <= budget {
        return state.clone();
    }

    let mut current = state.clone();
    let mut added_slots = current
        .onsets
        .iter()
        .map(|onset| onset.slot)
        .filter(|slot| anchor_slots.binary_search(slot).is_err())
        .collect::<Vec<_>>();
    added_slots.sort_by_key(|&slot| (ranks[slot as usize], slot));
    for slot in added_slots {
        if symmetric_difference(&state_slots(&current), &anchor_slots) <= budget {
            return current;
        }
        let mut candidate = current.clone();
        candidate.onsets.retain(|onset| onset.slot != slot);
        if state_is_projectable(seed, &candidate, inputs) {
            current = candidate;
        }
    }

    let current_slots = state_slots(&current);
    let mut missing_onsets = leash_anchor
        .onsets
        .iter()
        .filter(|onset| current_slots.binary_search(&onset.slot).is_err())
        .cloned()
        .collect::<Vec<_>>();
    missing_onsets.sort_by(|a, b| {
        ranks[b.slot as usize]
            .cmp(&ranks[a.slot as usize])
            .then_with(|| a.slot.cmp(&b.slot))
    });
    for onset in missing_onsets {
        if symmetric_difference(&state_slots(&current), &anchor_slots) <= budget {
            return current;
        }
        let mut candidate = current.clone();
        let insert_at = candidate
            .onsets
            .iter()
            .position(|existing| existing.slot > onset.slot)
            .unwrap_or(candidate.onsets.len());
        candidate.onsets.insert(insert_at, onset);
        if state_is_projectable(seed, &candidate, inputs) {
            current = candidate;
        }
    }

    if symmetric_difference(&state_slots(&current), &anchor_slots) <= budget {
        return current;
    }

    // A changed span layout can make an otherwise valid partial restoration
    // impossible at the retained rotation. Prefer the exact authored anchor
    // at that rotation, then at its own authored rotation. If even the anchor is invalid
    // on the supplied spans, returning it makes final projection report the
    // existing structure mismatch instead of emitting an over-budget state.
    let mut fallback = leash_anchor.clone();
    fallback.rotation_beats = state.rotation_beats;
    if state_is_projectable(seed, &fallback, inputs) {
        return fallback;
    }
    leash_anchor.clone()
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)] // direct fold tests use the sampled wrapper
fn step(
    seed: &CompiledSeed,
    state: &EvolutionState,
    seed_slots: &[u32],
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
) -> (EvolutionState, Option<DirectiveTraceEntry>) {
    let slots = seed.total_beats * seed.required_subdivision;
    let corridor = sampled_density_corridor(inputs, cycle, slots);
    let leash_anchor = seed_state(seed);
    let mut complexity_work_budget = ComplexityNormalizationBudget::new();
    step_with_corridor(
        seed,
        state,
        &leash_anchor,
        seed_slots.len(),
        ranks,
        template,
        beat_level,
        inputs,
        cycle,
        corridor,
        &mut complexity_work_budget,
    )
}

#[allow(clippy::too_many_arguments)]
fn step_with_corridor(
    seed: &CompiledSeed,
    state: &EvolutionState,
    leash_anchor: &EvolutionState,
    seed_onset_count: usize,
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    corridor: DensityCorridor,
    complexity_work_budget: &mut ComplexityNormalizationBudget,
) -> (EvolutionState, Option<DirectiveTraceEntry>) {
    step_scoped(
        seed,
        leash_anchor,
        seed_onset_count,
        state,
        ranks,
        template,
        beat_level,
        inputs,
        cycle,
        None,
        corridor,
        complexity_work_budget,
    )
}

#[allow(clippy::too_many_arguments)]
fn step_scoped(
    seed: &CompiledSeed,
    leash_anchor: &EvolutionState,
    seed_onset_count: usize,
    state: &EvolutionState,
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    window: Option<SlotRange>,
    corridor: DensityCorridor,
    complexity_work_budget: &mut ComplexityNormalizationBudget,
) -> (EvolutionState, Option<DirectiveTraceEntry>) {
    let drift_leash = sampled_percent(inputs, DUMKA_DRIFT_LEASH_TARGET, inputs.drift_leash, cycle);
    let budget = (drift_leash * seed_onset_count as u32).div_ceil(100);
    let leashed = normalize_to_leash(seed, state, leash_anchor, ranks, inputs, budget);
    let slots = seed.total_beats * seed.required_subdivision;
    // Corridor > leash: when the two constraints disagree, normalize the
    // leash first and leave both corridors as the final inherited-state rails.
    let complexity_corridor = sampled_complexity_corridor(inputs, cycle);
    let (current, normalization_clamp, normalization_complexity_clamp) =
        normalize_to_active_corridors(
            seed,
            &leashed,
            ranks,
            inputs,
            cycle,
            None,
            corridor,
            complexity_corridor,
            complexity_work_budget,
        );
    let trace = |requested, applied, skipped, corridor_clamp, complexity_corridor_clamp| {
        DirectiveTraceEntry {
            cycle,
            directive_id: LEGACY_EVOLUTION_TRACE_ID,
            family: DirectiveFamily::Stochastic,
            requested,
            applied,
            skipped,
            corridor_clamp,
            complexity_corridor_clamp,
            perceptual: None,
        }
    };
    let normalization_trace = || {
        (normalization_clamp.is_some() || normalization_complexity_clamp.is_some()).then(|| {
            trace(
                0,
                0,
                DirectiveSkip::None,
                normalization_clamp,
                normalization_complexity_clamp,
            )
        })
    };

    let evolution_rate = sampled_percent(
        inputs,
        DUMKA_EVOLUTION_RATE_TARGET,
        inputs.evolution_rate,
        cycle,
    );
    if evolution_rate == 0
        || draw(inputs.seed_value, cycle, SALT_FIRE, 100) >= u64::from(evolution_rate)
    {
        return (current, normalization_trace());
    }

    let Some(op) = drawn_op(&inputs.op_weights, inputs.seed_value, cycle) else {
        return (current, normalization_trace());
    };
    let temperature = sampled_percent(
        inputs,
        DUMKA_BARLOW_TEMPERATURE_TARGET,
        inputs.barlow_temperature,
        cycle,
    );
    let placement_bias = sampled_percent(
        inputs,
        super::DUMKA_PLACEMENT_BIAS_TARGET,
        inputs.placement_bias,
        cycle,
    );

    let mut candidate = current.clone();
    let mut successful_clamp = None;
    match op {
        Op::Remove => {
            if current.onsets.len() <= 1 {
                return (current, normalization_trace());
            }
            // Weakest-first candidate order; the temperature pool widens
            // toward uniform. Ranks are a permutation, so index 0 at
            // temperature 0 is exactly the historical argmin.
            let candidates = current
                .onsets
                .iter()
                .filter(|onset| onset_fits_window(onset, window))
                .map(|onset| onset.slot)
                .collect::<Vec<_>>();
            let order = blended_candidate_order(
                &candidates,
                &current,
                ranks,
                seed.required_subdivision,
                placement_bias,
                false,
            );
            if order.is_empty() {
                return (current, normalization_trace());
            }
            let pick = pool_pick(order.len(), temperature, inputs.seed_value, cycle);
            candidate.onsets.retain(|onset| onset.slot != order[pick]);
        }
        Op::Add => {
            // An "empty pulse" must be silent, not merely free of another
            // onset. Adding inside a sustain would create overlapping events;
            // the span projector would consume the long note and silently
            // discard the supposed one-slot hit. Excluding every covered slot
            // preserves the one-operation/one-onset leash accounting without
            // implicitly shortening an authored sustain.
            let mut occupied = vec![false; slots as usize];
            for onset in &current.onsets {
                let end = onset.slot.saturating_add(onset.dur).min(slots);
                occupied[onset.slot as usize..end as usize].fill(true);
            }
            // Strongest-first candidate order with the same temperature pool.
            let mut silent: Vec<u32> = (0..slots)
                .filter(|&s| !occupied[s as usize])
                .filter(|&slot| window.map_or(true, |window| window.contains_slot(slot)))
                .collect();
            silent = blended_candidate_order(
                &silent,
                &current,
                ranks,
                seed.required_subdivision,
                placement_bias,
                true,
            );
            if silent.is_empty() {
                return (current, normalization_trace());
            }
            let slot = silent[pool_pick(silent.len(), temperature, inputs.seed_value, cycle)];
            let class = current
                .onsets
                .iter()
                .rev()
                .find(|onset| onset.slot < slot)
                .or_else(|| current.onsets.last())
                .map(|onset| onset.class.clone())
                .unwrap_or_else(|| "x".to_string());
            let insert_at = candidate
                .onsets
                .iter()
                .position(|onset| onset.slot > slot)
                .unwrap_or(candidate.onsets.len());
            candidate.onsets.insert(
                insert_at,
                EvolvedOnset {
                    slot,
                    dur: 1,
                    class,
                },
            );
        }
        Op::Rotate => {
            let beats = seed.total_beats;
            let earlier = draw(inputs.seed_value, cycle, SALT_SIGN, 2) == 0;
            if let Some(window) = window {
                let direction = if earlier {
                    RotateDirection::Earlier
                } else {
                    RotateDirection::Later
                };
                let Some(rotated) =
                    windowed_rotate(&current, window, seed.required_subdivision, direction)
                else {
                    return (current, normalization_trace());
                };
                candidate = rotated;
            } else {
                candidate.rotation_beats = if earlier {
                    (candidate.rotation_beats + 1) % beats
                } else {
                    (candidate.rotation_beats + beats - 1) % beats
                };
            }
        }
        Op::Syncopate => {
            // Displacement operates in the unrotated metric frame like the
            // Barlow operators; the rotation register turns the result.
            let onset_slots = state_slots(&current);
            let vectors = scoped_legal_syncopations(&current, template, beat_level, window);
            if vectors.is_empty() {
                return (current, normalization_trace());
            }
            let vector = vectors[draw(
                inputs.seed_value,
                cycle,
                SALT_SYNC_PICK,
                vectors.len() as u64,
            ) as usize];
            let Some(landing) = syncopation_target(&onset_slots, template, vector, beat_level)
            else {
                return (current, normalization_trace());
            };
            move_onset(&mut candidate, vector.pulse, landing);
        }
        Op::Desyncopate => {
            let onset_slots = state_slots(&current);
            let pulses = scoped_legal_desyncopations(&current, template, beat_level, window);
            if pulses.is_empty() {
                return (current, normalization_trace());
            }
            let pulse = pulses[draw(
                inputs.seed_value,
                cycle,
                SALT_DESYNC_PICK,
                pulses.len() as u64,
            ) as usize];
            let Some((source, _vector)) = desyncopate_at(&onset_slots, template, pulse, beat_level)
            else {
                return (current, normalization_trace());
            };
            move_onset(&mut candidate, source, pulse);
        }
        Op::Fragment => {
            // Interval choice ranks strongest-interior-pulse first (the
            // figure that would articulate the most indispensable new
            // pulse), widened by the same temperature pool as Add/Remove.
            let intervals =
                super::figures::ranked_fragment_intervals(&current, slots, ranks, window);
            if intervals.is_empty() {
                return (current, normalization_trace());
            }
            let interval =
                intervals[pool_pick(intervals.len(), temperature, inputs.seed_value, cycle)];
            let mut ks = super::figures::k_candidates(interval.len);
            let unconstrained_k_count = ks.len();
            let headroom = corridor.ceiling_count.saturating_sub(current.onsets.len());
            ks.retain(|&k| {
                let added = if interval.onset_index.is_some() {
                    k.saturating_sub(1)
                } else {
                    k
                };
                usize::try_from(added).unwrap_or(usize::MAX) <= headroom
            });
            if ks.is_empty() {
                return (
                    current,
                    Some(trace(
                        1,
                        0,
                        DirectiveSkip::None,
                        Some(DensityCorridorClamp {
                            limit: DensityCorridorLimit::Ceiling,
                            density_percent: corridor.ceiling_percent,
                        }),
                        normalization_complexity_clamp,
                    )),
                );
            }
            if ks.len() < unconstrained_k_count {
                successful_clamp = Some(DensityCorridorClamp {
                    limit: DensityCorridorLimit::Ceiling,
                    density_percent: corridor.ceiling_percent,
                });
            }
            let fill_complexity = sampled_percent(
                inputs,
                DUMKA_FILL_COMPLEXITY_TARGET,
                inputs.fill_complexity,
                cycle,
            );
            // Same integer pool construction as the temperature: 0 keeps
            // the simplest true tuplet, 100 draws over every legal size.
            let k_pool = 1 + (u64::from(fill_complexity) * (ks.len() as u64 - 1)) / 100;
            let k = ks[draw(inputs.seed_value, cycle, SALT_FIG_K, k_pool) as usize];
            // A silent run's figures inherit the preceding stroke class,
            // Add's rule generalized to whole figures.
            let fill_class = current
                .onsets
                .iter()
                .rev()
                .find(|onset| onset.slot < interval.start)
                .or_else(|| current.onsets.last())
                .map(|onset| onset.class.clone())
                .unwrap_or_else(|| "x".to_string());
            candidate = super::figures::apply_fragment(&current, &interval, k, &fill_class);
        }
        Op::Consolidate => {
            let runs = super::figures::ranked_consolidate_runs(&current, ranks, window);
            if runs.is_empty() {
                return (current, normalization_trace());
            }
            let mut run = runs[pool_pick(runs.len(), temperature, inputs.seed_value, cycle)];
            let unconstrained_count = run.count;
            let removable = current.onsets.len().saturating_sub(corridor.floor_count);
            if removable == 0 {
                return (
                    current,
                    Some(trace(
                        1,
                        0,
                        DirectiveSkip::None,
                        Some(DensityCorridorClamp {
                            limit: DensityCorridorLimit::Floor,
                            density_percent: corridor.floor_percent,
                        }),
                        normalization_complexity_clamp,
                    )),
                );
            }
            run.count = run.count.min(removable.saturating_add(1));
            if run.count < unconstrained_count {
                successful_clamp = Some(DensityCorridorClamp {
                    limit: DensityCorridorLimit::Floor,
                    density_percent: corridor.floor_percent,
                });
            }
            candidate = super::figures::apply_consolidate(&current, &run);
        }
        Op::Euclid => {
            let windows = super::reshape::ranked_reshape_windows(
                &current,
                seed.total_beats,
                seed.required_subdivision,
                ranks,
                window,
            );
            if windows.is_empty() {
                return (current, normalization_trace());
            }
            let window = windows[pool_pick(windows.len(), temperature, inputs.seed_value, cycle)];
            let options = super::reshape::ReshapeOptions {
                rotation: draw(
                    inputs.seed_value,
                    cycle,
                    SALT_EUCLID_ROT,
                    u64::from(window.len),
                ) as u32,
                max_run: inputs.euclid_max_run,
                invert: inputs.euclid_invert > 0
                    && draw(inputs.seed_value, cycle, SALT_EUCLID_INV, 100)
                        < u64::from(inputs.euclid_invert),
                rest_policy: inputs.euclid_rest_policy,
            };
            let Some(reshaped) = super::reshape::apply_reshape(&current, &window, &options) else {
                return (current, normalization_trace());
            };
            candidate = reshaped;
        }
    }

    // Drift leash: distance of the onset set from the seed, budgeted as a
    // percentage of the seed's onset count. Displacement moves an onset off
    // one seed slot onto another, so it is leashed like add/remove;
    // rotation is tracked by its own register and always reversible, so it
    // is not.
    // Figures are leashed too: fragmenting adds k−1 (or k, from silence)
    // onsets of symmetric difference, consolidation subtracts the same.
    if matches!(
        op,
        Op::Remove
            | Op::Add
            | Op::Syncopate
            | Op::Desyncopate
            | Op::Fragment
            | Op::Consolidate
            | Op::Euclid
    ) {
        let candidate_slots: Vec<u32> = candidate.onsets.iter().map(|o| o.slot).collect();
        if symmetric_difference(&candidate_slots, &state_slots(leash_anchor)) > budget {
            return (current, normalization_trace());
        }
    }

    // All present and future legacy families share the same projection,
    // density, and complexity admission seam as authored directives.
    if let Some(failure) = candidate_failure(
        seed,
        &candidate,
        inputs,
        slots,
        corridor,
        complexity_corridor,
    ) {
        return (
            current,
            Some(trace(
                1,
                0,
                failure.skipped,
                failure.corridor_clamp.or(normalization_clamp),
                failure
                    .complexity_corridor_clamp
                    .or(normalization_complexity_clamp),
            )),
        );
    }

    (
        candidate,
        successful_clamp
            .map(|clamp| {
                trace(
                    1,
                    1,
                    DirectiveSkip::None,
                    Some(clamp),
                    normalization_complexity_clamp,
                )
            })
            .or_else(normalization_trace),
    )
}

fn occupied_slots(state: &EvolutionState, slots: u32) -> Vec<bool> {
    let mut occupied = vec![false; slots as usize];
    for onset in &state.onsets {
        let end = onset.slot.saturating_add(onset.dur).min(slots);
        occupied[onset.slot as usize..end as usize].fill(true);
    }
    occupied
}

fn fill_class_before(state: &EvolutionState, slot: u32) -> String {
    state
        .onsets
        .iter()
        .rev()
        .find(|onset| onset.slot < slot)
        .or_else(|| state.onsets.last())
        .map(|onset| onset.class.clone())
        .unwrap_or_else(|| "x".to_string())
}

fn windowed_rotate(
    state: &EvolutionState,
    window: SlotRange,
    subdivision: u32,
    direction: RotateDirection,
) -> Option<EvolutionState> {
    if window.len() == 0 {
        return None;
    }
    let mut next = state.clone();
    let mut changed = false;
    for onset in &mut next.onsets {
        let end = onset.slot.checked_add(onset.dur)?;
        if window.contains_interval(onset.slot, end) {
            let offset = onset.slot - window.start;
            let shift = subdivision % window.len();
            let rotated = match direction {
                RotateDirection::Earlier => (offset + window.len() - shift) % window.len(),
                RotateDirection::Later => (offset + shift) % window.len(),
            };
            let rotated_start = window.start.checked_add(rotated)?;
            let rotated_end = rotated_start.checked_add(onset.dur)?;
            if !window.contains_interval(rotated_start, rotated_end) {
                return None;
            }
            onset.slot = rotated_start;
            changed |= rotated != offset;
        } else if onset.slot < window.end && end > window.start {
            return None;
        }
    }
    if !changed {
        return None;
    }
    next.onsets.sort_by_key(|onset| onset.slot);
    Some(next)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MorphPair {
    current: Option<usize>,
    target: Option<usize>,
}

fn morph_target_state(
    directive: &EvolutionDirective,
    seed: &CompiledSeed,
) -> Option<EvolutionState> {
    let text = directive.options.morph_target.as_deref()?;
    let parsed = super::dsl::parse(text).ok()?;
    let mut target = super::tree::compile(&parsed).ok()?;
    if target.total_beats != seed.total_beats
        || seed.required_subdivision % target.required_subdivision != 0
    {
        return None;
    }
    target.required_subdivision = seed.required_subdivision;
    Some(seed_state(&target))
}

fn circular_slot_distance(left: u32, right: u32, slots: u32) -> u32 {
    let direct = left.abs_diff(right);
    direct.min(slots.saturating_sub(direct))
}

fn materialize_rotation(seed: &CompiledSeed, state: &EvolutionState) -> EvolutionState {
    if state.rotation_beats == 0 {
        return state.clone();
    }
    let slots = seed.total_beats.saturating_mul(seed.required_subdivision);
    let shift = state
        .rotation_beats
        .saturating_mul(seed.required_subdivision);
    let mut physical = state.clone();
    for onset in &mut physical.onsets {
        onset.slot = (onset.slot + shift) % slots;
    }
    physical.onsets.sort_by_key(|onset| onset.slot);
    physical.rotation_beats = 0;
    physical
}

fn morph_alignment_work(left: usize, right: usize) -> u64 {
    let left = u64::try_from(left).unwrap_or(u64::MAX);
    let right = u64::try_from(right).unwrap_or(u64::MAX);
    if left == right {
        return left.saturating_mul(right.max(1));
    }
    right
        .max(1)
        .saturating_mul(left.saturating_add(1))
        .saturating_mul(right.saturating_add(1))
}

/// Integer edit/transport alignment on the cycle. Equal-cardinality rhythms
/// reduce to exact best-cyclic circular OT. Unequal rhythms add a scale-free
/// insertion/deletion penalty and solve every cyclic target rotation by DP.
fn morph_alignment(
    current: &EvolutionState,
    target: &EvolutionState,
    slots: u32,
) -> Vec<MorphPair> {
    let left = &current.onsets;
    let right = &target.onsets;
    if left.is_empty() && right.is_empty() {
        return Vec::new();
    }
    if morph_alignment_work(left.len(), right.len()) > MAX_MORPH_ALIGNMENT_WORK {
        return Vec::new();
    }
    if left.len() == right.len() {
        let mut best: Option<(u64, usize)> = None;
        for rotation in 0..right.len() {
            let cost = left
                .iter()
                .enumerate()
                .map(|(index, onset)| {
                    let target_onset = &right[(rotation + index) % right.len()];
                    u64::from(circular_slot_distance(onset.slot, target_onset.slot, slots))
                })
                .sum();
            let candidate = (cost, rotation);
            if best.map_or(true, |incumbent| candidate < incumbent) {
                best = Some(candidate);
            }
        }
        let rotation = best.map_or(0, |(_, rotation)| rotation);
        return (0..left.len())
            .map(|index| MorphPair {
                current: Some(index),
                target: Some((rotation + index) % right.len()),
            })
            .collect();
    }
    let reference_count = left.len().max(right.len()).max(1) as u64;
    let denominator = 5_u64.saturating_mul(reference_count);
    let edit_penalty =
        u32::try_from((2_u64.saturating_mul(u64::from(slots)) + denominator / 2) / denominator)
            .unwrap_or(u32::MAX)
            .max(1);
    // Preserve the normative transport/edit cost as the primary key, then
    // prefer fewer insert/delete operations at an exact tie. This prevents a
    // cheap delete+insert detour from consuming gradual quota when an equally
    // priced one-to-one move exists. The scale is larger than the maximum
    // possible edit-count difference across one alignment.
    let cost_scale =
        u64::try_from(left.len().saturating_add(right.len()).saturating_add(1)).unwrap_or(u64::MAX);
    let rotations = right.len().max(1);
    let mut best: Option<(u64, usize, Vec<MorphPair>)> = None;
    for rotation in 0..rotations {
        let rotated = if right.is_empty() {
            Vec::new()
        } else {
            (0..right.len())
                .map(|index| (rotation + index) % right.len())
                .collect::<Vec<_>>()
        };
        let width = rotated.len() + 1;
        let mut cost = vec![u64::MAX; (left.len() + 1) * width];
        let mut choice = vec![0u8; cost.len()];
        cost[0] = 0;
        for i in 0..=left.len() {
            for j in 0..=rotated.len() {
                let index = i * width + j;
                let base = cost[index];
                if base == u64::MAX {
                    continue;
                }
                let relax = |next: usize,
                             candidate: u64,
                             candidate_choice: u8,
                             cost: &mut [u64],
                             choice: &mut [u8]| {
                    if candidate < cost[next]
                        || (candidate == cost[next] && candidate_choice < choice[next])
                    {
                        cost[next] = candidate;
                        choice[next] = candidate_choice;
                    }
                };
                if i < left.len() && j < rotated.len() {
                    let target_index = rotated[j];
                    let delta =
                        circular_slot_distance(left[i].slot, right[target_index].slot, slots);
                    let attribute = u32::from(
                        left[i].dur != right[target_index].dur
                            || left[i].class != right[target_index].class,
                    );
                    let next = (i + 1) * width + j + 1;
                    relax(
                        next,
                        base.saturating_add(
                            u64::from(delta.saturating_add(attribute)).saturating_mul(cost_scale),
                        ),
                        1,
                        &mut cost,
                        &mut choice,
                    );
                }
                if i < left.len() {
                    let next = (i + 1) * width + j;
                    relax(
                        next,
                        base.saturating_add(
                            u64::from(edit_penalty)
                                .saturating_mul(cost_scale)
                                .saturating_add(1),
                        ),
                        2,
                        &mut cost,
                        &mut choice,
                    );
                }
                if j < rotated.len() {
                    let next = i * width + j + 1;
                    relax(
                        next,
                        base.saturating_add(
                            u64::from(edit_penalty)
                                .saturating_mul(cost_scale)
                                .saturating_add(1),
                        ),
                        3,
                        &mut cost,
                        &mut choice,
                    );
                }
            }
        }
        let mut i = left.len();
        let mut j = rotated.len();
        let mut pairs = Vec::new();
        while i > 0 || j > 0 {
            match choice[i * width + j] {
                1 => {
                    i -= 1;
                    j -= 1;
                    pairs.push(MorphPair {
                        current: Some(i),
                        target: Some(rotated[j]),
                    });
                }
                2 => {
                    i -= 1;
                    pairs.push(MorphPair {
                        current: Some(i),
                        target: None,
                    });
                }
                3 => {
                    j -= 1;
                    pairs.push(MorphPair {
                        current: None,
                        target: Some(rotated[j]),
                    });
                }
                _ => break,
            }
        }
        pairs.reverse();
        let candidate = (cost[left.len() * width + rotated.len()], rotation, pairs);
        if best.as_ref().map_or(true, |incumbent| {
            (candidate.0, candidate.1) < (incumbent.0, incumbent.1)
        }) {
            best = Some(candidate);
        }
    }
    best.map(|(_, _, pairs)| pairs).unwrap_or_default()
}

fn morph_remaining_steps(
    directive: &EvolutionDirective,
    state: &EvolutionState,
    seed: &CompiledSeed,
    window: Option<SlotRange>,
) -> usize {
    let physical = materialize_rotation(seed, state);
    let Some(target) = morph_target_state(directive, seed) else {
        return 0;
    };
    let slots = seed.total_beats.saturating_mul(seed.required_subdivision);
    morph_alignment(&physical, &target, slots)
        .into_iter()
        .filter(|pair| match (pair.current, pair.target) {
            (Some(current), Some(target_index)) => {
                let source = &physical.onsets[current];
                let target = &target.onsets[target_index];
                window.map_or(true, |range| {
                    range.contains_interval(source.slot, source.slot.saturating_add(source.dur))
                        && range
                            .contains_interval(target.slot, target.slot.saturating_add(target.dur))
                })
            }
            (Some(current), None) => window.map_or(true, |range| {
                let onset = &physical.onsets[current];
                range.contains_interval(onset.slot, onset.slot.saturating_add(onset.dur))
            }),
            (None, Some(target_index)) => window.map_or(true, |range| {
                let onset = &target.onsets[target_index];
                range.contains_interval(onset.slot, onset.slot.saturating_add(onset.dur))
            }),
            (None, None) => false,
        })
        .map(|pair| match (pair.current, pair.target) {
            (Some(current), Some(target_index)) => {
                let source = &physical.onsets[current];
                let target = &target.onsets[target_index];
                usize::try_from(circular_slot_distance(source.slot, target.slot, slots))
                    .unwrap_or(usize::MAX)
                    .saturating_add(usize::from(
                        source.dur != target.dur || source.class != target.class,
                    ))
            }
            _ => 1,
        })
        .sum()
}

fn morph_step_candidates(
    directive: &EvolutionDirective,
    state: &EvolutionState,
    seed: &CompiledSeed,
    window: Option<SlotRange>,
) -> Vec<EvolutionState> {
    let physical = materialize_rotation(seed, state);
    let Some(target) = morph_target_state(directive, seed) else {
        return Vec::new();
    };
    let Some(slots) = seed.total_beats.checked_mul(seed.required_subdivision) else {
        return Vec::new();
    };
    let pairs = morph_alignment(&physical, &target, slots);
    let mut candidates = Vec::with_capacity(pairs.len());
    for pair in pairs {
        match (pair.current, pair.target) {
            (Some(current_index), Some(target_index)) => {
                let source = &physical.onsets[current_index];
                let target_onset = &target.onsets[target_index];
                if !directive_slot_allowed(directive, target_onset.slot, seed.required_subdivision)
                {
                    continue;
                }
                if !window.map_or(true, |range| {
                    range.contains_interval(source.slot, source.slot.saturating_add(source.dur))
                        && range.contains_interval(
                            target_onset.slot,
                            target_onset.slot.saturating_add(target_onset.dur),
                        )
                }) {
                    continue;
                }
                if source.slot == target_onset.slot {
                    if source.dur == target_onset.dur && source.class == target_onset.class {
                        continue;
                    }
                    let mut next = physical.clone();
                    next.onsets[current_index].dur = target_onset.dur;
                    next.onsets[current_index].class = target_onset.class.clone();
                    candidates.push(next);
                    continue;
                }
                let forward = (target_onset.slot + slots - source.slot) % slots;
                let backward = (source.slot + slots - target_onset.slot) % slots;
                let adjacent = if forward < backward {
                    vec![(source.slot + 1) % slots]
                } else if backward < forward {
                    vec![(source.slot + slots - 1) % slots]
                } else {
                    vec![(source.slot + slots - 1) % slots, (source.slot + 1) % slots]
                };
                for slot in adjacent {
                    if !directive_slot_allowed(directive, slot, seed.required_subdivision) {
                        continue;
                    }
                    let mut next = physical.clone();
                    next.onsets[current_index].slot = slot;
                    next.onsets.sort_by_key(|onset| onset.slot);
                    candidates.push(next);
                }
            }
            (Some(current_index), None) if physical.onsets.len() > 1 => {
                let onset = &physical.onsets[current_index];
                if !directive_slot_allowed(directive, onset.slot, seed.required_subdivision) {
                    continue;
                }
                if !window.map_or(true, |range| {
                    range.contains_interval(onset.slot, onset.slot.saturating_add(onset.dur))
                }) {
                    continue;
                }
                let mut next = physical.clone();
                next.onsets.remove(current_index);
                candidates.push(next);
            }
            (None, Some(target_index)) => {
                let onset = &target.onsets[target_index];
                if !directive_slot_allowed(directive, onset.slot, seed.required_subdivision) {
                    continue;
                }
                if !window.map_or(true, |range| {
                    range.contains_interval(onset.slot, onset.slot.saturating_add(onset.dur))
                }) {
                    continue;
                }
                let mut next = physical.clone();
                let at = next
                    .onsets
                    .partition_point(|current| current.slot < onset.slot);
                next.onsets.insert(at, onset.clone());
                candidates.push(next);
            }
            _ => {}
        }
    }
    candidates
}

pub(crate) fn validate_morph_target_work(
    directive_id: u64,
    seed: &CompiledSeed,
    target: &CompiledSeed,
) -> Result<(), GeneratorError> {
    let current = seed_state(seed);
    let target = seed_state(target);
    let alignment_work = morph_alignment_work(current.onsets.len(), target.onsets.len());
    if alignment_work > MAX_MORPH_ALIGNMENT_WORK {
        return Err(GeneratorError::DumkaPlanInvalid {
            message: format!(
                "directive {directive_id} morph alignment reserves {alignment_work} pair evaluations, exceeding the limit of {MAX_MORPH_ALIGNMENT_WORK}"
            ),
        });
    }
    let slots = seed.total_beats.saturating_mul(seed.required_subdivision);
    let steps = morph_alignment(&current, &target, slots)
        .into_iter()
        .map(|pair| match (pair.current, pair.target) {
            (Some(current_index), Some(target_index)) => {
                let source = &current.onsets[current_index];
                let target = &target.onsets[target_index];
                u64::from(circular_slot_distance(source.slot, target.slot, slots)).saturating_add(
                    u64::from(source.dur != target.dur || source.class != target.class),
                )
            }
            _ => 1,
        })
        .fold(0_u64, u64::saturating_add);
    if steps > u64::from(MAX_MORPH_MICROSTEPS) {
        return Err(GeneratorError::DumkaPlanInvalid {
            message: format!(
                "directive {directive_id} morph requires {steps} microsteps, exceeding the limit of {MAX_MORPH_MICROSTEPS}"
            ),
        });
    }
    Ok(())
}

fn directive_slot_allowed(directive: &EvolutionDirective, slot: u32, working: u32) -> bool {
    directive.options.subdivision_level.map_or(true, |level| {
        super::depth::slot_level_index(slot, working) == Some(level)
    })
}

fn blended_candidate_order(
    candidates: &[u32],
    state: &EvolutionState,
    ranks: &[u32],
    working: u32,
    placement_bias: u32,
    add: bool,
) -> Vec<u32> {
    let mut barlow = candidates.to_vec();
    if add {
        barlow.sort_by_key(|&slot| (std::cmp::Reverse(ranks[slot as usize]), slot));
    } else {
        barlow.sort_by_key(|&slot| (ranks[slot as usize], slot));
    }
    if placement_bias == 0 {
        return barlow;
    }
    let onset_slots = state_slots(state);
    let geometric = if add {
        super::spectrum::geometric_add_order(working, &onset_slots, candidates)
    } else {
        super::spectrum::geometric_remove_order(working, &onset_slots, candidates)
    };
    super::spectrum::blended_order(&barlow, &geometric, placement_bias)
}

#[allow(clippy::too_many_arguments)]
fn directive_candidate_count(
    directive: &EvolutionDirective,
    state: &EvolutionState,
    seed: &CompiledSeed,
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    window: Option<SlotRange>,
) -> usize {
    let slots = seed.total_beats * seed.required_subdivision;
    match directive.family {
        DirectiveFamily::BarlowRemove => state
            .onsets
            .iter()
            .filter(|onset| onset_fits_window(onset, window))
            .filter(|onset| {
                directive_slot_allowed(directive, onset.slot, seed.required_subdivision)
            })
            .count()
            .saturating_sub(usize::from(state.onsets.len() <= 1)),
        DirectiveFamily::BarlowAdd => {
            let occupied = occupied_slots(state, slots);
            (0..slots)
                .filter(|slot| !occupied[*slot as usize])
                .filter(|slot| window.map_or(true, |window| window.contains_slot(*slot)))
                .filter(|slot| directive_slot_allowed(directive, *slot, seed.required_subdivision))
                .count()
        }
        DirectiveFamily::Rotate => match window {
            Some(window) => usize::try_from(window.len() / seed.required_subdivision).unwrap_or(0),
            None => usize::try_from(seed.total_beats).unwrap_or(0),
        },
        DirectiveFamily::Syncopate => {
            scoped_legal_syncopations(state, template, beat_level, window)
                .into_iter()
                .filter(|vector| {
                    syncopation_target(&state_slots(state), template, *vector, beat_level)
                        .is_some_and(|landing| {
                            directive_slot_allowed(directive, landing, seed.required_subdivision)
                        })
                })
                .count()
        }
        DirectiveFamily::Desyncopate => {
            scoped_legal_desyncopations(state, template, beat_level, window)
                .into_iter()
                .filter(|pulse| {
                    directive_slot_allowed(directive, *pulse, seed.required_subdivision)
                })
                .count()
        }
        DirectiveFamily::Fragment => {
            super::figures::ranked_fragment_intervals(state, slots, ranks, window)
                .into_iter()
                .filter(|interval| {
                    super::figures::k_candidates(interval.len)
                        .into_iter()
                        .any(|k| {
                            super::figures::fragment_positions(interval.len, k)
                                .into_iter()
                                .skip(1)
                                .map(|offset| interval.start.saturating_add(offset))
                                .all(|slot| {
                                    directive_slot_allowed(
                                        directive,
                                        slot,
                                        seed.required_subdivision,
                                    )
                                })
                        })
                })
                .count()
        }
        DirectiveFamily::Consolidate => {
            super::figures::ranked_consolidate_runs(state, ranks, window)
                .into_iter()
                .filter(|run| {
                    state.onsets[run.first_index + 1..run.first_index + run.count]
                        .iter()
                        .all(|onset| {
                            directive_slot_allowed(directive, onset.slot, seed.required_subdivision)
                        })
                })
                .count()
        }
        DirectiveFamily::Euclid => super::reshape::ranked_reshape_windows(
            state,
            seed.total_beats,
            seed.required_subdivision,
            ranks,
            window,
        )
        .into_iter()
        .filter(|reshape_window| {
            (reshape_window.start..reshape_window.start + reshape_window.len)
                .any(|slot| directive_slot_allowed(directive, slot, seed.required_subdivision))
        })
        .count(),
        DirectiveFamily::Stochastic => 1,
        DirectiveFamily::Morph => {
            morph_remaining_steps(directive, state, seed, window).min(MAX_MORPH_MICROSTEPS as usize)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DirectiveApplyFailure {
    skipped: DirectiveSkip,
    corridor_clamp: Option<DensityCorridorClamp>,
    complexity_corridor_clamp: Option<ComplexityCorridorClamp>,
}

impl DirectiveApplyFailure {
    const fn corridor(clamp: DensityCorridorClamp) -> Self {
        Self {
            skipped: DirectiveSkip::None,
            corridor_clamp: Some(clamp),
            complexity_corridor_clamp: None,
        }
    }
}

impl From<DirectiveSkip> for DirectiveApplyFailure {
    fn from(skip: DirectiveSkip) -> Self {
        Self {
            skipped: skip,
            corridor_clamp: None,
            complexity_corridor_clamp: None,
        }
    }
}

/// One central post-operation guard for every present and future family.
/// Projection and corridor failure are evaluated independently so the trace
/// can tell both truths when a candidate violates both contracts.
fn candidate_failure(
    seed: &CompiledSeed,
    candidate: &EvolutionState,
    inputs: &EvolutionInputs<'_>,
    slots: u32,
    corridor: DensityCorridor,
    complexity_corridor: ComplexityCorridor,
) -> Option<DirectiveApplyFailure> {
    let corridor_clamp = corridor.clamp_for(candidate.onsets.len());
    let complexity_corridor_clamp =
        complexity_corridor.clamp_for(candidate, seed.required_subdivision);
    let projection_failed = !state_intervals_disjoint(candidate, slots)
        || !state_is_projectable(seed, candidate, inputs);
    let skipped = if projection_failed {
        DirectiveSkip::Projection
    } else {
        DirectiveSkip::None
    };
    (skipped != DirectiveSkip::None
        || corridor_clamp.is_some()
        || complexity_corridor_clamp.is_some())
    .then_some(DirectiveApplyFailure {
        skipped,
        corridor_clamp,
        complexity_corridor_clamp,
    })
}

type MorphStateKey = Vec<(u32, u32, String)>;

fn morph_state_key(state: &EvolutionState) -> MorphStateKey {
    state
        .onsets
        .iter()
        .map(|onset| (onset.slot, onset.dur, onset.class.clone()))
        .collect()
}

fn scoped_morph_target(
    current: &EvolutionState,
    target: &EvolutionState,
    window: Option<SlotRange>,
) -> EvolutionState {
    let Some(window) = window else {
        return target.clone();
    };
    let mut onsets = current
        .onsets
        .iter()
        .filter(|onset| !onset_fits_window(onset, Some(window)))
        .cloned()
        .chain(
            target
                .onsets
                .iter()
                .filter(|onset| onset_fits_window(onset, Some(window)))
                .cloned(),
        )
        .collect::<Vec<_>>();
    onsets.sort_by_key(|onset| onset.slot);
    EvolutionState {
        onsets,
        rotation_beats: 0,
    }
}

fn morph_search_heuristic(state: &EvolutionState, target: &EvolutionState) -> u32 {
    let missing = target
        .onsets
        .iter()
        .filter(|onset| !state.onsets.contains(onset))
        .count();
    let extra = state
        .onsets
        .iter()
        .filter(|onset| !target.onsets.contains(onset))
        .count();
    u32::try_from(missing.max(extra)).unwrap_or(u32::MAX)
}

fn morph_search_neighbors(
    directive: &EvolutionDirective,
    state: &EvolutionState,
    target: &EvolutionState,
    working: u32,
    slots: u32,
    window: Option<SlotRange>,
) -> Vec<(EvolutionState, bool)> {
    let mut neighbors = std::collections::BTreeMap::<MorphStateKey, (EvolutionState, bool)>::new();
    let mut insert = |mut next: EvolutionState, is_edit: bool| {
        next.onsets.sort_by_key(|onset| onset.slot);
        let key = morph_state_key(&next);
        match neighbors.get_mut(&key) {
            Some((_, incumbent_is_edit)) if *incumbent_is_edit && !is_edit => {
                *incumbent_is_edit = false;
            }
            Some(_) => {}
            None => {
                neighbors.insert(key, (next, is_edit));
            }
        }
    };

    for (index, onset) in state.onsets.iter().enumerate() {
        for slot in [
            (onset.slot + slots - 1) % slots,
            (onset.slot + 1) % slots,
        ] {
            if slot == onset.slot
                || !directive_slot_allowed(directive, slot, working)
                || !onset_move_fits_window(state, onset.slot, slot, window)
            {
                continue;
            }
            let mut next = state.clone();
            next.onsets[index].slot = slot;
            insert(next, false);
        }

        if let Some(target_onset) = target
            .onsets
            .iter()
            .find(|target_onset| target_onset.slot == onset.slot)
        {
            if (target_onset.dur != onset.dur || target_onset.class != onset.class)
                && directive_slot_allowed(directive, target_onset.slot, working)
                && onset_fits_window(onset, window)
                && onset_fits_window(target_onset, window)
            {
                let mut next = state.clone();
                next.onsets[index].dur = target_onset.dur;
                next.onsets[index].class = target_onset.class.clone();
                insert(next, false);
            }
        }

        if state.onsets.len() > 1
            && !target.onsets.contains(onset)
            && directive_slot_allowed(directive, onset.slot, working)
            && onset_fits_window(onset, window)
        {
            let mut next = state.clone();
            next.onsets.remove(index);
            insert(next, true);
        }
    }

    for onset in &target.onsets {
        if state.onsets.contains(onset)
            || !directive_slot_allowed(directive, onset.slot, working)
            || !onset_fits_window(onset, window)
        {
            continue;
        }
        let mut next = state.clone();
        let at = next
            .onsets
            .partition_point(|current| current.slot < onset.slot);
        next.onsets.insert(at, onset.clone());
        insert(next, true);
    }

    neighbors.into_values().collect()
}

/// Precompute one complete, admissible Morph path before applying its first
/// microstep. A recomputed local OT frontier is not complete in the presence
/// of occupied slots: sometimes an onset must temporarily move away, or an
/// edit must happen before transport can continue. This bounded deterministic
/// A* search makes endpoint exactness a property of the chosen prefix rather
/// than a hope attached to greedy re-alignment.
#[allow(clippy::too_many_arguments)]
fn morph_schedule(
    directive: &EvolutionDirective,
    state: &EvolutionState,
    seed: &CompiledSeed,
    inputs: &EvolutionInputs<'_>,
    window: Option<SlotRange>,
    corridor: DensityCorridor,
    complexity_corridor: ComplexityCorridor,
) -> Result<Vec<EvolutionState>, DirectiveApplyFailure> {
    let start = materialize_rotation(seed, state);
    let Some(authored_target) = morph_target_state(directive, seed) else {
        return Err(DirectiveSkip::Exhausted.into());
    };
    let target = scoped_morph_target(&start, &authored_target, window);
    if start == target {
        return Ok(Vec::new());
    }
    let Some(slots) = seed.total_beats.checked_mul(seed.required_subdivision) else {
        return Err(DirectiveSkip::Exhausted.into());
    };
    if candidate_failure(seed, &target, inputs, slots, corridor, complexity_corridor).is_some() {
        return Err(candidate_failure(seed, &target, inputs, slots, corridor, complexity_corridor)
            .expect("checked target failure"));
    }

    let start_key = morph_state_key(&start);
    let target_key = morph_state_key(&target);
    let mut open = std::collections::BinaryHeap::new();
    let initial_h = morph_search_heuristic(&start, &target);
    open.push(std::cmp::Reverse((initial_h, initial_h, 0_u32, 0_u32, start_key.clone())));
    let mut best = std::collections::BTreeMap::from([(start_key.clone(), (0_u32, 0_u32))]);
    let mut states = std::collections::BTreeMap::from([(start_key.clone(), start)]);
    let mut parent = std::collections::BTreeMap::<MorphStateKey, MorphStateKey>::new();
    let mut expanded = 0_u64;
    let mut first_failure = None;

    while let Some(std::cmp::Reverse((_, _, g, edits, key))) = open.pop() {
        if best.get(&key).copied() != Some((g, edits)) {
            continue;
        }
        if key == target_key {
            let mut path = Vec::new();
            let mut cursor = key;
            while cursor != start_key {
                path.push(states[&cursor].clone());
                cursor = parent[&cursor].clone();
            }
            path.reverse();
            return Ok(path);
        }
        if g >= MAX_MORPH_MICROSTEPS {
            continue;
        }
        expanded = expanded.saturating_add(1);
        if expanded > MAX_MORPH_ALIGNMENT_WORK {
            break;
        }
        let current = states[&key].clone();
        for (next, is_edit) in morph_search_neighbors(
            directive,
            &current,
            &target,
            seed.required_subdivision,
            slots,
            window,
        ) {
            if let Some(failure) =
                candidate_failure(seed, &next, inputs, slots, corridor, complexity_corridor)
            {
                first_failure.get_or_insert(failure);
                continue;
            }
            let next_key = morph_state_key(&next);
            let next_g = g.saturating_add(1);
            let next_edits = edits.saturating_add(u32::from(is_edit));
            if best
                .get(&next_key)
                .is_some_and(|&(old_g, old_edits)| (old_g, old_edits) <= (next_g, next_edits))
            {
                continue;
            }
            let h = morph_search_heuristic(&next, &target);
            best.insert(next_key.clone(), (next_g, next_edits));
            parent.insert(next_key.clone(), key.clone());
            states.insert(next_key.clone(), next);
            open.push(std::cmp::Reverse((
                next_g.saturating_add(h),
                h,
                next_g,
                next_edits,
                next_key,
            )));
        }
    }

    Err(first_failure.unwrap_or_else(|| DirectiveSkip::Exhausted.into()))
}

#[allow(clippy::too_many_arguments)]
fn apply_one_directive_operation(
    directive: &EvolutionDirective,
    state: &EvolutionState,
    seed: &CompiledSeed,
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    authored_cycle: u64,
    draw_cycle: u64,
    ordinal: u64,
    window: Option<SlotRange>,
    corridor: DensityCorridor,
    complexity_corridor: ComplexityCorridor,
) -> Result<(EvolutionState, Option<DensityCorridorClamp>), DirectiveApplyFailure> {
    // Reserve a stable block for every application. Multi-draw families use
    // offsets inside the block, so application N's option draw can never
    // collide with application N+1's target draw.
    let draw_base = ordinal.saturating_mul(4);
    let slots = seed.total_beats * seed.required_subdivision;
    let temperature = directive.options.barlow_temperature.unwrap_or_else(|| {
        sampled_percent(
            inputs,
            DUMKA_BARLOW_TEMPERATURE_TARGET,
            inputs.barlow_temperature,
            authored_cycle,
        )
    });
    let placement_bias = directive.options.placement_bias.unwrap_or_else(|| {
        sampled_percent(
            inputs,
            super::DUMKA_PLACEMENT_BIAS_TARGET,
            inputs.placement_bias,
            authored_cycle,
        )
    });
    let mut candidate = state.clone();
    let mut successful_clamp = None;
    match directive.family {
        DirectiveFamily::BarlowRemove => {
            if state.onsets.len() <= 1 {
                return Err(DirectiveSkip::Exhausted.into());
            }
            let candidates = state
                .onsets
                .iter()
                .filter(|onset| onset_fits_window(onset, window))
                .filter(|onset| {
                    directive_slot_allowed(directive, onset.slot, seed.required_subdivision)
                })
                .map(|onset| onset.slot)
                .collect::<Vec<_>>();
            let order = blended_candidate_order(
                &candidates,
                state,
                ranks,
                seed.required_subdivision,
                placement_bias,
                false,
            );
            if order.is_empty() {
                return Err(DirectiveSkip::Exhausted.into());
            }
            let pick = plan_pool_pick(
                order.len(),
                temperature,
                inputs.seed_value,
                directive.id,
                draw_cycle,
                draw_base,
            );
            candidate.onsets.retain(|onset| onset.slot != order[pick]);
        }
        DirectiveFamily::BarlowAdd => {
            let occupied = occupied_slots(state, slots);
            let mut silent = (0..slots)
                .filter(|slot| !occupied[*slot as usize])
                .filter(|slot| window.map_or(true, |window| window.contains_slot(*slot)))
                .filter(|slot| directive_slot_allowed(directive, *slot, seed.required_subdivision))
                .collect::<Vec<_>>();
            silent = blended_candidate_order(
                &silent,
                state,
                ranks,
                seed.required_subdivision,
                placement_bias,
                true,
            );
            if silent.is_empty() {
                return Err(DirectiveSkip::Exhausted.into());
            }
            let pick = plan_pool_pick(
                silent.len(),
                temperature,
                inputs.seed_value,
                directive.id,
                draw_cycle,
                draw_base,
            );
            let slot = silent[pick];
            let insert_at = candidate.onsets.partition_point(|onset| onset.slot < slot);
            candidate.onsets.insert(
                insert_at,
                EvolvedOnset {
                    slot,
                    dur: 1,
                    class: fill_class_before(state, slot),
                },
            );
        }
        DirectiveFamily::Rotate => {
            if let Some(window) = window {
                candidate = windowed_rotate(
                    state,
                    window,
                    seed.required_subdivision,
                    directive.options.rotate_direction,
                )
                .ok_or(DirectiveSkip::Exhausted)
                .map_err(DirectiveApplyFailure::from)?;
            } else {
                candidate.rotation_beats = match directive.options.rotate_direction {
                    // `state_to_compiled` adds this register to absolute
                    // onset positions. Earlier therefore decrements it;
                    // scoped Rotate performs the same physical direction
                    // directly on slots inside its window.
                    RotateDirection::Earlier => {
                        (candidate.rotation_beats + seed.total_beats - 1) % seed.total_beats
                    }
                    RotateDirection::Later => (candidate.rotation_beats + 1) % seed.total_beats,
                };
            }
        }
        DirectiveFamily::Syncopate => {
            let onset_slots = state_slots(state);
            let vectors = scoped_legal_syncopations(state, template, beat_level, window)
                .into_iter()
                .filter(|vector| {
                    syncopation_target(&onset_slots, template, *vector, beat_level).is_some_and(
                        |landing| {
                            directive_slot_allowed(directive, landing, seed.required_subdivision)
                        },
                    )
                })
                .collect::<Vec<_>>();
            if vectors.is_empty() {
                return Err(DirectiveSkip::Exhausted.into());
            }
            let vector = vectors[plan_draw(
                inputs.seed_value,
                directive.id,
                draw_cycle,
                draw_base,
                vectors.len() as u64,
            ) as usize];
            let landing = syncopation_target(&onset_slots, template, vector, beat_level)
                .ok_or(DirectiveSkip::Exhausted)
                .map_err(DirectiveApplyFailure::from)?;
            move_onset(&mut candidate, vector.pulse, landing);
        }
        DirectiveFamily::Desyncopate => {
            let onset_slots = state_slots(state);
            let pulses = scoped_legal_desyncopations(state, template, beat_level, window)
                .into_iter()
                .filter(|pulse| {
                    directive_slot_allowed(directive, *pulse, seed.required_subdivision)
                })
                .collect::<Vec<_>>();
            if pulses.is_empty() {
                return Err(DirectiveSkip::Exhausted.into());
            }
            let pulse = pulses[plan_draw(
                inputs.seed_value,
                directive.id,
                draw_cycle,
                draw_base,
                pulses.len() as u64,
            ) as usize];
            let (source, _) = desyncopate_at(&onset_slots, template, pulse, beat_level)
                .ok_or(DirectiveSkip::Exhausted)
                .map_err(DirectiveApplyFailure::from)?;
            move_onset(&mut candidate, source, pulse);
        }
        DirectiveFamily::Fragment => {
            let intervals = super::figures::ranked_fragment_intervals(state, slots, ranks, window)
                .into_iter()
                .filter(|interval| {
                    super::figures::k_candidates(interval.len)
                        .into_iter()
                        .any(|k| {
                            super::figures::fragment_positions(interval.len, k)
                                .into_iter()
                                .skip(1)
                                .map(|offset| interval.start.saturating_add(offset))
                                .all(|slot| {
                                    directive_slot_allowed(
                                        directive,
                                        slot,
                                        seed.required_subdivision,
                                    )
                                })
                        })
                })
                .collect::<Vec<_>>();
            if intervals.is_empty() {
                return Err(DirectiveSkip::Exhausted.into());
            }
            let interval = intervals[plan_pool_pick(
                intervals.len(),
                temperature,
                inputs.seed_value,
                directive.id,
                draw_cycle,
                draw_base,
            )];
            let mut ks = super::figures::k_candidates(interval.len)
                .into_iter()
                .filter(|k| {
                    super::figures::fragment_positions(interval.len, *k)
                        .into_iter()
                        .skip(1)
                        .map(|offset| interval.start.saturating_add(offset))
                        .all(|slot| {
                            directive_slot_allowed(directive, slot, seed.required_subdivision)
                        })
                })
                .collect::<Vec<_>>();
            let unconstrained_k_count = ks.len();
            let headroom = corridor.ceiling_count.saturating_sub(state.onsets.len());
            ks.retain(|&k| {
                let added = if interval.onset_index.is_some() {
                    k.saturating_sub(1)
                } else {
                    k
                };
                usize::try_from(added).unwrap_or(usize::MAX) <= headroom
            });
            if ks.is_empty() {
                return Err(DirectiveApplyFailure::corridor(DensityCorridorClamp {
                    limit: DensityCorridorLimit::Ceiling,
                    density_percent: corridor.ceiling_percent,
                }));
            }
            if ks.len() < unconstrained_k_count {
                successful_clamp = Some(DensityCorridorClamp {
                    limit: DensityCorridorLimit::Ceiling,
                    density_percent: corridor.ceiling_percent,
                });
            }
            let complexity = directive.options.fill_complexity.unwrap_or_else(|| {
                sampled_percent(
                    inputs,
                    DUMKA_FILL_COMPLEXITY_TARGET,
                    inputs.fill_complexity,
                    authored_cycle,
                )
            });
            let pool = 1 + (u64::from(complexity) * (ks.len() as u64 - 1)) / 100;
            let k = ks[plan_draw(
                inputs.seed_value,
                directive.id,
                draw_cycle,
                draw_base.saturating_add(1),
                pool,
            ) as usize];
            candidate = super::figures::apply_fragment(
                state,
                &interval,
                k,
                &fill_class_before(state, interval.start),
            );
        }
        DirectiveFamily::Consolidate => {
            let runs = super::figures::ranked_consolidate_runs(state, ranks, window)
                .into_iter()
                .filter(|run| {
                    state.onsets[run.first_index + 1..run.first_index + run.count]
                        .iter()
                        .all(|onset| {
                            directive_slot_allowed(directive, onset.slot, seed.required_subdivision)
                        })
                })
                .collect::<Vec<_>>();
            if runs.is_empty() {
                return Err(DirectiveSkip::Exhausted.into());
            }
            let mut run = runs[plan_pool_pick(
                runs.len(),
                temperature,
                inputs.seed_value,
                directive.id,
                draw_cycle,
                draw_base,
            )];
            let unconstrained_count = run.count;
            let removable = state.onsets.len().saturating_sub(corridor.floor_count);
            if removable == 0 {
                return Err(DirectiveApplyFailure::corridor(DensityCorridorClamp {
                    limit: DensityCorridorLimit::Floor,
                    density_percent: corridor.floor_percent,
                }));
            }
            run.count = run.count.min(removable.saturating_add(1));
            if run.count < unconstrained_count {
                successful_clamp = Some(DensityCorridorClamp {
                    limit: DensityCorridorLimit::Floor,
                    density_percent: corridor.floor_percent,
                });
            }
            candidate = super::figures::apply_consolidate(state, &run);
        }
        DirectiveFamily::Euclid => {
            let windows = super::reshape::ranked_reshape_windows(
                state,
                seed.total_beats,
                seed.required_subdivision,
                ranks,
                window,
            )
            .into_iter()
            .filter(|reshape_window| {
                (reshape_window.start..reshape_window.start + reshape_window.len)
                    .any(|slot| directive_slot_allowed(directive, slot, seed.required_subdivision))
            })
            .collect::<Vec<_>>();
            if windows.is_empty() {
                return Err(DirectiveSkip::Exhausted.into());
            }
            let reshape_window = windows[plan_pool_pick(
                windows.len(),
                temperature,
                inputs.seed_value,
                directive.id,
                draw_cycle,
                draw_base,
            )];
            let invert_percent = directive
                .options
                .euclid_invert
                .unwrap_or(inputs.euclid_invert);
            let options = super::reshape::ReshapeOptions {
                rotation: plan_draw(
                    inputs.seed_value,
                    directive.id,
                    draw_cycle,
                    draw_base.saturating_add(1),
                    u64::from(reshape_window.len),
                ) as u32,
                max_run: directive
                    .options
                    .euclid_max_run
                    .unwrap_or(inputs.euclid_max_run),
                invert: invert_percent > 0
                    && plan_draw(
                        inputs.seed_value,
                        directive.id,
                        draw_cycle,
                        draw_base.saturating_add(2),
                        100,
                    ) < u64::from(invert_percent),
                rest_policy: directive
                    .options
                    .euclid_rest_policy
                    .unwrap_or(inputs.euclid_rest_policy),
            };
            candidate = super::reshape::apply_reshape(state, &reshape_window, &options)
                .ok_or(DirectiveSkip::Exhausted)
                .map_err(DirectiveApplyFailure::from)?;
            if candidate.onsets.iter().any(|onset| {
                onset.slot >= reshape_window.start
                    && onset.slot < reshape_window.start + reshape_window.len
                    && !directive_slot_allowed(directive, onset.slot, seed.required_subdivision)
            }) {
                return Err(DirectiveSkip::Exhausted.into());
            }
        }
        DirectiveFamily::Stochastic => return Err(DirectiveSkip::Exhausted.into()),
        DirectiveFamily::Morph => {
            let mut candidates = morph_step_candidates(directive, state, seed, window);
            if !candidates.is_empty() {
                let start = usize::try_from(ordinal).unwrap_or(usize::MAX) % candidates.len();
                candidates.rotate_left(start);
            }
            let mut first_failure = None;
            for morph_candidate in candidates {
                if let Some(failure) = candidate_failure(
                    seed,
                    &morph_candidate,
                    inputs,
                    slots,
                    corridor,
                    complexity_corridor,
                ) {
                    first_failure.get_or_insert(failure);
                    continue;
                }
                // Morph alignment may expose an insertion before moving the
                // onset that currently occupies its target interval. Search
                // the deterministic one-step frontier for the first legal
                // microstep instead of letting that temporary overlap stall
                // an otherwise reachable target.
                return Ok((morph_candidate, None));
            }
            return Err(first_failure.unwrap_or_else(|| DirectiveSkip::Exhausted.into()));
        }
    }
    if let Some(failure) = candidate_failure(
        seed,
        &candidate,
        inputs,
        slots,
        corridor,
        complexity_corridor,
    ) {
        return Err(failure);
    }
    Ok((candidate, successful_clamp))
}

fn directive_family_for_op(op: Op) -> DirectiveFamily {
    match op {
        Op::Remove => DirectiveFamily::BarlowRemove,
        Op::Add => DirectiveFamily::BarlowAdd,
        Op::Rotate => DirectiveFamily::Rotate,
        Op::Syncopate => DirectiveFamily::Syncopate,
        Op::Desyncopate => DirectiveFamily::Desyncopate,
        Op::Fragment => DirectiveFamily::Fragment,
        Op::Consolidate => DirectiveFamily::Consolidate,
        Op::Euclid => DirectiveFamily::Euclid,
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_stochastic_directive(
    directive: &EvolutionDirective,
    seed: &CompiledSeed,
    state: &EvolutionState,
    leash_anchor: &EvolutionState,
    seed_onset_count: usize,
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    window: Option<SlotRange>,
    corridor: DensityCorridor,
    complexity_corridor: ComplexityCorridor,
    complexity_work_budget: &mut ComplexityNormalizationBudget,
) -> (
    EvolutionState,
    bool,
    Option<DirectiveApplyFailure>,
    Option<DensityCorridorClamp>,
    Option<ComplexityCorridorClamp>,
) {
    let drift_leash = sampled_percent(inputs, DUMKA_DRIFT_LEASH_TARGET, inputs.drift_leash, cycle);
    let budget = (drift_leash * seed_onset_count as u32).div_ceil(100);
    let leashed = normalize_to_leash(seed, state, leash_anchor, ranks, inputs, budget);
    let (current, normalized_clamp, normalized_complexity_clamp) = normalize_to_active_corridors(
        seed,
        &leashed,
        ranks,
        inputs,
        cycle,
        directive.options.placement_bias,
        corridor,
        complexity_corridor,
        complexity_work_budget,
    );
    if directive.intensity == 0
        || plan_draw(inputs.seed_value, directive.id, cycle, 0, 100)
            >= u64::from(directive.intensity)
    {
        return (
            current,
            false,
            None,
            normalized_clamp,
            normalized_complexity_clamp,
        );
    }
    let total = inputs.op_weights.total();
    if total == 0 {
        return (
            current,
            true,
            Some(DirectiveSkip::Exhausted.into()),
            normalized_clamp,
            normalized_complexity_clamp,
        );
    }
    let op = op_for_roll(
        &inputs.op_weights,
        plan_draw(inputs.seed_value, directive.id, cycle, 1, total),
    )
    .expect("positive operator weight total selects a family");
    let mut selected = directive.clone();
    selected.family = directive_family_for_op(op);
    if op == Op::Rotate {
        selected.options.rotate_direction =
            if plan_draw(inputs.seed_value, directive.id, cycle, 2, 2) == 0 {
                RotateDirection::Earlier
            } else {
                RotateDirection::Later
            };
    }

    let (candidate, successful_clamp) = match apply_one_directive_operation(
        &selected,
        &current,
        seed,
        ranks,
        template,
        beat_level,
        inputs,
        cycle,
        cycle,
        1,
        window,
        corridor,
        complexity_corridor,
    ) {
        Ok(outcome) => outcome,
        Err(error) => {
            return (
                current,
                true,
                Some(error),
                normalized_clamp,
                normalized_complexity_clamp,
            )
        }
    };
    if op != Op::Rotate
        && symmetric_difference(&state_slots(&candidate), &state_slots(leash_anchor)) > budget
    {
        return (
            current,
            true,
            Some(DirectiveSkip::Exhausted.into()),
            successful_clamp.or(normalized_clamp),
            normalized_complexity_clamp,
        );
    }
    (
        candidate,
        true,
        None,
        successful_clamp.or(normalized_clamp),
        normalized_complexity_clamp,
    )
}

#[allow(clippy::too_many_arguments)]
/// One curve cycle: candidate zero is the corridor-normalized hold; each
/// later prefix draws a family from the authored weights (identity-seeded,
/// per-ordinal) and applies one operation through the same guards as a
/// directive. Nearest realized whole-cycle distance to the interpolated
/// target wins; smaller prefixes win ties. Leash-exempt like every
/// authored intent; corridor and projection stay supreme.
#[allow(clippy::too_many_arguments)] // fold environment; same precedent as step
fn apply_evolution_curve(
    target_milli: u32,
    state: &EvolutionState,
    seed: &CompiledSeed,
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    corridor: DensityCorridor,
    complexity_work_budget: &mut ComplexityNormalizationBudget,
) -> (EvolutionState, DirectiveTraceEntry) {
    let curve = inputs.curve;
    let mut trace = DirectiveTraceEntry {
        cycle,
        directive_id: EVOLUTION_CURVE_TRACE_ID,
        family: DirectiveFamily::Stochastic,
        requested: 0,
        applied: 0,
        skipped: DirectiveSkip::None,
        corridor_clamp: None,
        complexity_corridor_clamp: None,
        perceptual: None,
    };
    let complexity_corridor = sampled_complexity_corridor(inputs, cycle);
    let (normalized, density_clamp, complexity_clamp) = normalize_to_active_corridors(
        seed,
        state,
        ranks,
        inputs,
        cycle,
        None,
        corridor,
        complexity_corridor,
        complexity_work_budget,
    );
    trace.corridor_clamp = density_clamp;
    trace.complexity_corridor_clamp = complexity_clamp;

    let weights = &inputs.op_weights;
    let families = [
        (DirectiveFamily::BarlowRemove, weights.barlow_remove),
        (DirectiveFamily::BarlowAdd, weights.barlow_add),
        (DirectiveFamily::Rotate, weights.rotate),
        (DirectiveFamily::Syncopate, weights.syncopate),
        (DirectiveFamily::Desyncopate, weights.desyncopate),
        (DirectiveFamily::Fragment, weights.fragment),
        (DirectiveFamily::Consolidate, weights.consolidate),
        (DirectiveFamily::Euclid, weights.euclid),
    ];
    let total: u64 = families.iter().map(|(_, weight)| u64::from(*weight)).sum();

    let context = PerceptualContext::new(
        seed.total_beats,
        seed.required_subdivision,
        ranks.to_vec(),
        template.to_vec(),
    )
    .expect("validated Barlow grid constructs a perceptual context");
    let model = PerceptualModel::for_version(curve.model_version);

    let mut current = normalized.clone();
    let initial = perceptual_distance(state, &current, &context, &model).total_milli;
    let mut best_state = current.clone();
    let mut best_actual = initial;
    let mut best_error = initial.abs_diff(target_milli);
    let mut best_applied = 0;
    let mut current_clamp = trace.corridor_clamp;
    let mut best_clamp = current_clamp;
    let mut frontier_failure = None;

    if total > 0 {
        for offset in 0..u64::from(curve.max_operations) {
            if best_error == 0 {
                break;
            }
            let mut roll = draw(
                inputs.seed_value,
                cycle,
                SALT_CURVE ^ mix_seed(EVOLUTION_CURVE_TRACE_ID, offset),
                total,
            );
            let mut drawn = DirectiveFamily::BarlowRemove;
            for (family, weight) in families {
                let band = u64::from(weight);
                if roll < band {
                    drawn = family;
                    break;
                }
                roll -= band;
            }
            let synthetic = EvolutionDirective {
                id: EVOLUTION_CURVE_TRACE_ID,
                order: 0,
                enabled: true,
                from_cycle: cycle,
                to_cycle: cycle,
                family: drawn,
                pacing: DirectivePacing::PerCycle,
                magnitude: DirectiveMagnitude::OperationQuota,
                intensity: 0,
                scope: None,
                options: super::plan::DirectiveOptions::default(),
            };
            match apply_one_directive_operation(
                &synthetic,
                &current,
                seed,
                ranks,
                template,
                beat_level,
                inputs,
                cycle,
                cycle,
                offset,
                None,
                corridor,
                sampled_complexity_corridor(inputs, cycle),
            ) {
                Ok((next, clamp)) => {
                    trace.requested = trace.requested.saturating_add(1);
                    current = next;
                    if clamp.is_some() {
                        current_clamp = clamp;
                    }
                    let actual = perceptual_distance(state, &current, &context, &model).total_milli;
                    let error = actual.abs_diff(target_milli);
                    if error < best_error {
                        best_state = current.clone();
                        best_actual = actual;
                        best_error = error;
                        best_applied = u32::try_from(offset.saturating_add(1)).unwrap_or(u32::MAX);
                        best_clamp = current_clamp;
                    }
                }
                Err(failure) => {
                    frontier_failure = Some(failure);
                    break;
                }
            }
        }
    }

    trace.applied = best_applied;
    trace.corridor_clamp = best_clamp;
    let reached = best_error <= curve.tolerance_milli;
    if !reached {
        trace.skipped = DirectiveSkip::Exhausted;
        if let Some(failure) = frontier_failure {
            if failure.skipped != DirectiveSkip::None {
                trace.skipped = failure.skipped;
            }
            if failure.corridor_clamp.is_some() {
                trace.corridor_clamp = failure.corridor_clamp;
            }
            if failure.complexity_corridor_clamp.is_some() {
                trace.complexity_corridor_clamp = failure.complexity_corridor_clamp;
            }
        }
    }
    trace.perceptual = Some(PerceptualPacingTrace {
        model_version: curve.model_version,
        actual_milli: best_actual,
        target_milli,
        tolerance_milli: curve.tolerance_milli,
        reached,
        exhausted: !reached,
    });
    (best_state, trace)
}

#[allow(clippy::too_many_arguments)] // fold environment; same precedent as step
fn apply_directive(
    directive: &EvolutionDirective,
    state: &EvolutionState,
    seed: &CompiledSeed,
    leash_anchor: &EvolutionState,
    seed_onset_count: usize,
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    accumulator: &mut RangeAccumulator,
    corridor: DensityCorridor,
    complexity_work_budget: &mut ComplexityNormalizationBudget,
) -> (EvolutionState, DirectiveTraceEntry) {
    let mut trace = DirectiveTraceEntry {
        cycle,
        directive_id: directive.id,
        family: directive.family,
        requested: 0,
        applied: 0,
        skipped: DirectiveSkip::None,
        corridor_clamp: None,
        complexity_corridor_clamp: None,
        perceptual: None,
    };
    let window = match slot_range(directive.scope, seed.total_beats, seed.required_subdivision) {
        Ok(window) => window,
        Err(skip) => {
            trace.skipped = skip;
            if let DirectiveMagnitude::Perceptual {
                model_version,
                target_milli,
                tolerance_milli,
                ..
            } = directive.magnitude
            {
                trace.perceptual = Some(PerceptualPacingTrace {
                    model_version,
                    actual_milli: 0,
                    target_milli,
                    tolerance_milli,
                    reached: target_milli <= tolerance_milli,
                    // No prefix search ran because the authored scope does
                    // not exist in this structure. Keep exhaustion reserved
                    // for a search that actually consumed its legal frontier.
                    exhausted: false,
                });
            }
            return (state.clone(), trace);
        }
    };

    if directive.family == DirectiveFamily::Stochastic {
        let complexity_corridor =
            directive_complexity_corridor(directive, sampled_complexity_corridor(inputs, cycle));
        let (next, attempted, error, successful_clamp, successful_complexity_clamp) =
            apply_stochastic_directive(
                directive,
                seed,
                state,
                leash_anchor,
                seed_onset_count,
                ranks,
                template,
                beat_level,
                inputs,
                cycle,
                window,
                corridor,
                complexity_corridor,
                complexity_work_budget,
            );
        trace.requested = u32::from(attempted);
        trace.applied = u32::from(attempted && error.is_none());
        trace.corridor_clamp = successful_clamp;
        trace.complexity_corridor_clamp = successful_complexity_clamp;
        if let Some(failure) = error {
            trace.skipped = failure.skipped;
            trace.corridor_clamp = corridor
                .clamp_for(next.onsets.len())
                .or(failure.corridor_clamp)
                .or(trace.corridor_clamp);
            trace.complexity_corridor_clamp = complexity_corridor
                .clamp_for(&next, seed.required_subdivision)
                .or(failure.complexity_corridor_clamp)
                .or(trace.complexity_corridor_clamp);
        }
        return (next, trace);
    }

    let complexity_corridor =
        directive_complexity_corridor(directive, sampled_complexity_corridor(inputs, cycle));
    let (normalized, density_clamp, complexity_clamp) = normalize_to_active_corridors(
        seed,
        state,
        ranks,
        inputs,
        cycle,
        directive.options.placement_bias,
        corridor,
        complexity_corridor,
        complexity_work_budget,
    );
    trace.corridor_clamp = density_clamp;
    trace.complexity_corridor_clamp = complexity_clamp;

    let initial_candidates = directive_candidate_count(
        directive,
        &normalized,
        seed,
        ranks,
        template,
        beat_level,
        window,
    );
    if let DirectiveMagnitude::Perceptual {
        model_version,
        target_milli,
        tolerance_milli,
        max_operations,
    } = directive.magnitude
    {
        // The target replaces intensity in this opt-in mode. Candidate zero
        // is the corridor-normalized hold; every later prefix is admitted
        // only after the ordinary operator, corridor, and projection guards.
        let context = PerceptualContext::new(
            seed.total_beats,
            seed.required_subdivision,
            ranks.to_vec(),
            template.to_vec(),
        )
        .expect("validated Barlow grid constructs a perceptual context");
        let model = PerceptualModel::for_version(model_version);

        let mut current = normalized.clone();
        let initial_distance = perceptual_distance(state, &current, &context, &model);
        let mut best_state = current.clone();
        let mut best_actual = initial_distance.total_milli;
        let mut best_error = best_actual.abs_diff(target_milli);
        let mut best_applied = 0;
        let mut current_clamp = trace.corridor_clamp;
        let mut best_clamp = current_clamp;
        let mut frontier_failure = None;

        for offset in 0..u64::from(max_operations) {
            if best_error == 0 {
                break;
            }
            match apply_one_directive_operation(
                directive,
                &current,
                seed,
                ranks,
                template,
                beat_level,
                inputs,
                cycle,
                cycle,
                offset,
                window,
                corridor,
                directive_complexity_corridor(
                    directive,
                    sampled_complexity_corridor(inputs, cycle),
                ),
            ) {
                Ok((next, clamp)) => {
                    trace.requested = trace.requested.saturating_add(1);
                    current = next;
                    if clamp.is_some() {
                        current_clamp = clamp;
                    }
                    let actual = perceptual_distance(state, &current, &context, &model).total_milli;
                    let error = actual.abs_diff(target_milli);
                    // Strict comparison makes the deterministic tie-break the
                    // smaller prefix (candidate zero included).
                    if error < best_error {
                        best_state = current.clone();
                        best_actual = actual;
                        best_error = error;
                        best_applied = u32::try_from(offset.saturating_add(1)).unwrap_or(u32::MAX);
                        best_clamp = current_clamp;
                    }
                }
                Err(failure) => {
                    frontier_failure = Some(failure);
                    break;
                }
            }
        }

        trace.applied = best_applied;
        trace.corridor_clamp = best_clamp;
        let reached = best_error <= tolerance_milli;
        if !reached {
            trace.skipped = DirectiveSkip::Exhausted;
            if let Some(failure) = frontier_failure {
                if failure.skipped != DirectiveSkip::None {
                    trace.skipped = failure.skipped;
                }
                if failure.corridor_clamp.is_some() {
                    trace.corridor_clamp = failure.corridor_clamp;
                }
                if failure.complexity_corridor_clamp.is_some() {
                    trace.complexity_corridor_clamp = failure.complexity_corridor_clamp;
                }
            }
        }
        trace.perceptual = Some(PerceptualPacingTrace {
            model_version,
            actual_milli: best_actual,
            target_milli,
            tolerance_milli,
            reached,
            exhausted: !reached,
        });
        return (best_state, trace);
    }
    if initial_candidates == 0
        && directive.intensity > 0
        && (directive.is_pin() || directive.pacing == DirectivePacing::PerCycle)
    {
        trace.skipped = DirectiveSkip::Exhausted;
        return (normalized, trace);
    }
    let (requested, first_ordinal, draw_cycle) = if directive.is_pin() {
        let requested = if directive.family == DirectiveFamily::Rotate {
            rotate_pin_quota(directive.intensity, initial_candidates)
        } else {
            pin_quota(directive.intensity, initial_candidates)
        };
        (requested, 0, cycle)
    } else if directive.pacing == DirectivePacing::PerCycle {
        (
            accumulator.quota(directive.intensity, initial_candidates),
            0,
            cycle,
        )
    } else {
        let (requested, first_ordinal) = accumulator.transition_quota(
            directive,
            cycle,
            initial_candidates,
            directive.family == DirectiveFamily::Rotate,
        );
        (requested, first_ordinal, directive.from_cycle)
    };
    trace.requested = requested;
    if requested == 0 {
        return (normalized, trace);
    }
    if initial_candidates == 0 && directive.intensity > 0 {
        trace.skipped = DirectiveSkip::Exhausted;
        return (normalized, trace);
    }

    let mut current = normalized;
    for offset in 0..u64::from(requested) {
        let ordinal = first_ordinal.saturating_add(offset);
        match apply_one_directive_operation(
            directive,
            &current,
            seed,
            ranks,
            template,
            beat_level,
            inputs,
            cycle,
            draw_cycle,
            ordinal,
            window,
            corridor,
            directive_complexity_corridor(directive, sampled_complexity_corridor(inputs, cycle)),
        ) {
            Ok((next, clamp)) => {
                current = next;
                trace.applied += 1;
                if clamp.is_some() {
                    trace.corridor_clamp = clamp;
                }
            }
            Err(failure) => {
                trace.skipped = failure.skipped;
                trace.corridor_clamp = corridor
                    .clamp_for(current.onsets.len())
                    .or(failure.corridor_clamp)
                    .or(trace.corridor_clamp);
                trace.complexity_corridor_clamp = directive_complexity_corridor(
                    directive,
                    sampled_complexity_corridor(inputs, cycle),
                )
                .clamp_for(&current, seed.required_subdivision)
                .or(failure.complexity_corridor_clamp)
                .or(trace.complexity_corridor_clamp);
                break;
            }
        }
    }
    if trace.applied < trace.requested
        && trace.skipped == DirectiveSkip::None
        && trace.corridor_clamp.is_none()
    {
        trace.skipped = DirectiveSkip::Exhausted;
    }
    (current, trace)
}

/// Move the onset at `from` to the silent slot `to`, keeping duration and
/// stroke class, and keeping the onset list sorted by slot.
fn move_onset(state: &mut EvolutionState, from: u32, to: u32) {
    let Some(index) = state.onsets.iter().position(|onset| onset.slot == from) else {
        return;
    };
    let mut onset = state.onsets.remove(index);
    onset.slot = to;
    let insert_at = state
        .onsets
        .iter()
        .position(|existing| existing.slot > to)
        .unwrap_or(state.onsets.len());
    state.onsets.insert(insert_at, onset);
}

/// Fold the policy from the seed through `inputs.cycle` and return the
/// evolved, rotation-applied pattern ready for span projection. Cycle 0 is
/// always the seed verbatim. `None` when the grid's prime factors exceed
/// the published Barlow tables and the corridor is off — the caller then
/// plays the seed verbatim. An active corridor instead uses the explicitly
/// non-metric positional fallback below so its density invariant remains
/// true without inventing Barlow ranks.
pub struct EvolvedSeedResolution {
    pub seed: CompiledSeed,
    pub trace: Vec<DirectiveTraceEntry>,
    /// The final requested cycle's effective percent rail. This is captured
    /// by the same ordered fold that enforced it, so preview cannot drift
    /// from automation, scope, or directive precedence.
    pub density_corridor: DensityCorridorRange,
    pub complexity_corridor: ComplexityCorridorRange,
    pub state_complexity_milli: u32,
    pub state_depth_diversity_milli: u32,
    /// Whole-cycle realized perceptual distance (requested cycle vs the
    /// state carried out of the previous cycle), from the same fold. `None`
    /// at cycle 0 and on grids without published Barlow tables.
    pub cycle_distance: Option<PerceptualCycleDistance>,
}

/// Score the requested cycle against its predecessor with the immutable v1
/// model. Verbatim repeats score an honest 0 — "this cycle sounds identical"
/// is exactly what the calibration lane needs to say.
fn whole_cycle_distance(
    seed: &CompiledSeed,
    previous: &EvolutionState,
    current: &EvolutionState,
    ranks: &[u32],
    template: &[u32],
) -> Option<PerceptualCycleDistance> {
    let context = PerceptualContext::new(
        seed.total_beats,
        seed.required_subdivision,
        ranks.to_vec(),
        template.to_vec(),
    )
    .ok()?;
    let model = PerceptualModel::for_version(PerceptualModelVersion::V1);
    Some(PerceptualCycleDistance {
        model_version: PerceptualModelVersion::V1,
        distance_milli: perceptual_distance(previous, current, &context, &model).total_milli,
    })
}

/// Corridor-only fallback for grids outside the published Barlow tables.
/// Slot zero is strongest and later slots weaken monotonically; this is a
/// stable normalization order, not a claim of metric indispensability. The
/// legacy no-corridor path still returns `None` and plays the seed verbatim,
/// preserving its historical compatibility contract.
fn unsupported_grid_corridor_resolution(
    seed: &CompiledSeed,
    inputs: &EvolutionInputs<'_>,
    requested_global_corridor: DensityCorridor,
) -> EvolvedSeedResolution {
    let slots = seed.total_beats * seed.required_subdivision;
    let ranks = (0..slots).map(|slot| slots - slot - 1).collect::<Vec<_>>();
    let mut state = seed_state(seed);
    let mut requested_cycle_trace = Vec::new();
    let mut requested_density_corridor = requested_global_corridor.percent_range();
    let mut requested_complexity_corridor =
        sampled_complexity_corridor(inputs, inputs.cycle).range();
    let mut complexity_work_budget = ComplexityNormalizationBudget::new();

    for cycle in 1..=inputs.cycle {
        let global_corridor = if cycle == inputs.cycle {
            requested_global_corridor
        } else {
            sampled_density_corridor(inputs, cycle, slots)
        };
        let global_complexity_corridor = sampled_complexity_corridor(inputs, cycle);
        let active = active_directives(inputs.plan, cycle);
        let all_orphaned = !active.is_empty()
            && active.iter().all(|directive| {
                slot_range(directive.scope, seed.total_beats, seed.required_subdivision).is_err()
            });

        if active.is_empty() || all_orphaned {
            let corridor = global_corridor;
            if cycle == inputs.cycle {
                requested_density_corridor = corridor.percent_range();
                requested_complexity_corridor = global_complexity_corridor.range();
            }
            let (normalized, density_clamp, complexity_clamp) = normalize_to_active_corridors(
                seed,
                &state,
                &ranks,
                inputs,
                cycle,
                None,
                corridor,
                global_complexity_corridor,
                &mut complexity_work_budget,
            );
            state = normalized;
            if cycle == inputs.cycle {
                // Match the supported-grid trace order: authored orphan rows
                // first, then the independent normalization sentinel.
                requested_cycle_trace.extend(active.iter().filter_map(|directive| {
                    slot_range(directive.scope, seed.total_beats, seed.required_subdivision)
                        .err()
                        .map(|skipped| DirectiveTraceEntry {
                            cycle,
                            directive_id: directive.id,
                            family: directive.family,
                            requested: 0,
                            applied: 0,
                            skipped,
                            corridor_clamp: None,
                            complexity_corridor_clamp: None,
                            perceptual: None,
                        })
                }));
                requested_cycle_trace.extend(legacy_corridor_trace(
                    cycle,
                    density_clamp,
                    complexity_clamp,
                ));
            }
        } else {
            for directive in active {
                match slot_range(directive.scope, seed.total_beats, seed.required_subdivision) {
                    Err(skipped) => {
                        if cycle == inputs.cycle {
                            requested_cycle_trace.push(DirectiveTraceEntry {
                                cycle,
                                directive_id: directive.id,
                                family: directive.family,
                                requested: 0,
                                applied: 0,
                                skipped,
                                corridor_clamp: None,
                                complexity_corridor_clamp: None,
                                perceptual: None,
                            });
                        }
                    }
                    Ok(_) => {
                        let corridor =
                            directive_density_corridor(directive, global_corridor, slots);
                        if cycle == inputs.cycle {
                            requested_density_corridor = corridor.percent_range();
                            requested_complexity_corridor = directive_complexity_corridor(
                                directive,
                                global_complexity_corridor,
                            )
                            .range();
                        }
                        let complexity_corridor =
                            directive_complexity_corridor(directive, global_complexity_corridor);
                        let (normalized, density_clamp, complexity_clamp) =
                            normalize_to_active_corridors(
                                seed,
                                &state,
                                &ranks,
                                inputs,
                                cycle,
                                directive.options.placement_bias,
                                corridor,
                                complexity_corridor,
                                &mut complexity_work_budget,
                            );
                        state = normalized;
                        if cycle == inputs.cycle {
                            requested_cycle_trace.extend(
                                (density_clamp.is_some() || complexity_clamp.is_some()).then_some(
                                    DirectiveTraceEntry {
                                        cycle,
                                        directive_id: directive.id,
                                        family: directive.family,
                                        requested: 0,
                                        applied: 0,
                                        skipped: DirectiveSkip::None,
                                        corridor_clamp: density_clamp,
                                        complexity_corridor_clamp: complexity_clamp,
                                        perceptual: None,
                                    },
                                ),
                            );
                        }
                    }
                }
            }
        }
    }

    EvolvedSeedResolution {
        seed: state_to_compiled(seed, &state),
        trace: requested_cycle_trace,
        density_corridor: requested_density_corridor,
        complexity_corridor: requested_complexity_corridor,
        state_complexity_milli: super::depth::state_complexity_milli(
            &state_slots(&state),
            seed.required_subdivision,
        ),
        state_depth_diversity_milli: super::depth::depth_diversity_milli(
            &state_slots(&state),
            seed.required_subdivision,
        ),
        cycle_distance: None,
    }
}

/// Fail before resolution when an unsupported metric grid would otherwise
/// silently discard an active evolution request. Corridor-only holds remain
/// eligible for the deterministic positional fallback, and disabled/future
/// plan rows remain behavior-off.
pub(crate) fn validate_evolution_grid(
    seed: &CompiledSeed,
    inputs: &EvolutionInputs<'_>,
) -> Result<(), GeneratorError> {
    if inputs.cycle == 0 || stratification(seed.total_beats, seed.required_subdivision).is_some() {
        return Ok(());
    }

    // Preserve the unsupported-grid feature-off fast path. An enabled
    // automation lane reports `Some` even when its requested-cycle value is
    // zero, because an earlier folded cycle may still have evolved.
    let evolution_is_automated = (inputs.automation)(
        DUMKA_EVOLUTION_RATE_TARGET,
        inputs.cycle,
        f64::from(inputs.evolution_rate),
    )
    .is_some();
    let plan_requests_work = inputs.plan.iter().any(|directive| {
        directive.enabled
            && directive.from_cycle <= inputs.cycle
            && directive.to_cycle >= 1
            && slot_range(directive.scope, seed.total_beats, seed.required_subdivision).is_ok()
            && (directive.intensity > 0
                || matches!(directive.magnitude, DirectiveMagnitude::Perceptual { .. }))
    });
    if inputs.evolution_rate == 0
        && !evolution_is_automated
        && !plan_requests_work
        && inputs.curve.scoring_work_through(inputs.cycle) == 0
    {
        return Ok(());
    }

    for cycle in 1..=inputs.cycle {
        let active = active_directives(inputs.plan, cycle);
        let valid = active
            .into_iter()
            .filter(|directive| {
                slot_range(directive.scope, seed.total_beats, seed.required_subdivision).is_ok()
            })
            .collect::<Vec<_>>();

        if !valid.is_empty() {
            for directive in valid {
                match directive.magnitude {
                    DirectiveMagnitude::Perceptual { .. } => {
                        return Err(GeneratorError::DumkaPlanInvalid {
                            message: format!(
                                "directive {} perceptual magnitude requires a Barlow-supported beat/subdivision grid",
                                directive.id
                            ),
                        });
                    }
                    DirectiveMagnitude::OperationQuota if directive.intensity > 0 => {
                        return Err(GeneratorError::DumkaPlanInvalid {
                            message: format!(
                                "directive {} operation quota requires a Barlow-supported beat/subdivision grid",
                                directive.id
                            ),
                        });
                    }
                    DirectiveMagnitude::OperationQuota => {}
                }
            }
            continue;
        }

        // With no valid active directive, the curve owns the gap whenever it
        // is enabled; otherwise the historical stochastic layer does.
        if inputs.curve.enabled {
            if inputs.curve.target_milli_at(cycle) > 0 {
                return Err(GeneratorError::DumkaPlanInvalid {
                    message: "curve targets require a Barlow-supported beat/subdivision grid"
                        .to_string(),
                });
            }
        } else if sampled_percent(
            inputs,
            DUMKA_EVOLUTION_RATE_TARGET,
            inputs.evolution_rate,
            cycle,
        ) > 0
        {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: "legacy evolution requires a Barlow-supported beat/subdivision grid"
                    .to_string(),
            });
        }
    }
    Ok(())
}

pub fn evolved_seed_with_trace(
    seed: &CompiledSeed,
    inputs: &EvolutionInputs<'_>,
) -> Option<EvolvedSeedResolution> {
    let slots = seed.total_beats * seed.required_subdivision;
    if inputs.cycle == 0 {
        return Some(EvolvedSeedResolution {
            seed: seed.clone(),
            trace: Vec::new(),
            density_corridor: sampled_density_corridor(inputs, 0, slots).percent_range(),
            complexity_corridor: sampled_complexity_corridor(inputs, 0).range(),
            state_complexity_milli: super::depth::state_complexity_milli(
                &state_slots(&seed_state(seed)),
                seed.required_subdivision,
            ),
            state_depth_diversity_milli: super::depth::depth_diversity_milli(
                &state_slots(&seed_state(seed)),
                seed.required_subdivision,
            ),
            cycle_distance: None,
        });
    }
    // Preserve the feature-off O(1) path only when no enabled automation
    // source exists. `Some(0.0)` is deliberately not equivalent to absence:
    // earlier cycles in that lane may have evolved the seed.
    let evolution_is_automated = (inputs.automation)(
        DUMKA_EVOLUTION_RATE_TARGET,
        inputs.cycle,
        f64::from(inputs.evolution_rate),
    )
    .is_some();
    let (requested_global_corridor, density_is_automated) =
        sampled_density_corridor_with_presence(inputs, inputs.cycle, slots);
    let (_, complexity_is_automated) =
        sampled_complexity_corridor_with_presence(inputs, inputs.cycle);
    // An override activates the unsupported-grid corridor fallback only once
    // an enabled row has entered the historical fold. Disabled and strictly
    // future rows must preserve the legacy no-corridor `None` contract.
    let plan_corridor_is_active = inputs.plan.iter().any(|directive| {
        directive.enabled
            && directive.from_cycle <= inputs.cycle
            && (directive.options.density_floor.is_some()
                || directive.options.density_ceiling.is_some()
                || directive.options.complexity_floor.is_some()
                || directive.options.complexity_ceiling.is_some())
    });
    let corridor_is_active = inputs.density_floor > 0
        || inputs.density_ceiling < 100
        || density_is_automated
        || inputs.complexity_floor > 0
        || inputs.complexity_ceiling < 100_000
        || complexity_is_automated
        || plan_corridor_is_active;
    if inputs.plan.is_empty()
        && inputs.evolution_rate == 0
        && !evolution_is_automated
        && !corridor_is_active
        && !inputs.curve.is_active()
    {
        let verbatim_distance = stratification(seed.total_beats, seed.required_subdivision)
            .and_then(|strata| {
                let ranks = indispensability(&strata);
                let template = metrical_levels(&strata);
                let state = seed_state(seed);
                whole_cycle_distance(seed, &state, &state, &ranks, &template)
            });
        return Some(EvolvedSeedResolution {
            seed: seed.clone(),
            trace: Vec::new(),
            density_corridor: requested_global_corridor.percent_range(),
            complexity_corridor: sampled_complexity_corridor(inputs, inputs.cycle).range(),
            state_complexity_milli: super::depth::state_complexity_milli(
                &state_slots(&seed_state(seed)),
                seed.required_subdivision,
            ),
            state_depth_diversity_milli: super::depth::depth_diversity_milli(
                &state_slots(&seed_state(seed)),
                seed.required_subdivision,
            ),
            cycle_distance: verbatim_distance,
        });
    }
    let Some(strata) = stratification(seed.total_beats, seed.required_subdivision) else {
        return corridor_is_active.then(|| {
            unsupported_grid_corridor_resolution(seed, inputs, requested_global_corridor)
        });
    };
    let ranks = indispensability(&strata);
    let template = metrical_levels(&strata);
    let beat_level = factor_descending(seed.total_beats).len() as u32;
    let initial_state = seed_state(seed);
    let seed_onset_count = initial_state.onsets.len();
    let mut state = initial_state.clone();
    // Authored directives and the composition curve establish persistent
    // musical state. The stochastic leash measures later drift from this
    // moving authored anchor instead of pulling every gap back to the
    // original pattern.
    let mut leash_anchor = initial_state;
    let mut accumulators = std::collections::BTreeMap::<u64, RangeAccumulator>::new();
    let mut requested_cycle_trace = Vec::new();
    let mut requested_density_corridor = requested_global_corridor.percent_range();
    let mut requested_complexity_corridor =
        sampled_complexity_corridor(inputs, inputs.cycle).range();
    let mut complexity_work_budget = ComplexityNormalizationBudget::new();
    // The state entering the requested cycle IS the previous cycle's final
    // state; snapshot it for the whole-cycle calibration readout.
    let mut previous_cycle_state = state.clone();
    for cycle in 1..=inputs.cycle {
        if cycle == inputs.cycle {
            previous_cycle_state = state.clone();
        }
        let corridor = if cycle == inputs.cycle {
            requested_global_corridor
        } else {
            sampled_density_corridor(inputs, cycle, slots)
        };
        let active = active_directives(inputs.plan, cycle);
        if active.is_empty() {
            if inputs.curve.enabled {
                // The curve owns every directive-free cycle when enabled:
                // the legacy stochastic layer never fires, and a zero
                // target is deterministic repetition (corridor still
                // normalizes, like any other hold).
                let target = inputs.curve.target_milli_at(cycle);
                if target > 0 {
                    let (next, curve_trace) = apply_evolution_curve(
                        target,
                        &state,
                        seed,
                        &ranks,
                        &template,
                        beat_level,
                        inputs,
                        cycle,
                        corridor,
                        &mut complexity_work_budget,
                    );
                    state = next;
                    if cycle == inputs.cycle {
                        requested_cycle_trace.push(curve_trace);
                    }
                } else {
                    let (normalized, density_clamp, complexity_clamp) =
                        normalize_to_active_corridors(
                            seed,
                            &state,
                            &ranks,
                            inputs,
                            cycle,
                            None,
                            corridor,
                            sampled_complexity_corridor(inputs, cycle),
                            &mut complexity_work_budget,
                        );
                    state = normalized;
                    if cycle == inputs.cycle {
                        requested_cycle_trace.extend(legacy_corridor_trace(
                            cycle,
                            density_clamp,
                            complexity_clamp,
                        ));
                    }
                }
                leash_anchor = state.clone();
            } else {
                let (next, legacy_trace) = step_with_corridor(
                    seed,
                    &state,
                    &leash_anchor,
                    seed_onset_count,
                    &ranks,
                    &template,
                    beat_level,
                    inputs,
                    cycle,
                    corridor,
                    &mut complexity_work_budget,
                );
                state = next;
                if cycle == inputs.cycle {
                    requested_cycle_trace.extend(legacy_trace);
                }
            }
            continue;
        }
        // Orphaned scopes are skipped before A(c) is formed. If every
        // authored row at this cycle is orphaned, preserve the legacy layer
        // exactly as if no directive were active, while still reporting each
        // orphan to the preview trace. Exhaustion/projection happen only
        // after selection and therefore do suppress the legacy draw.
        let all_orphaned = active.iter().all(|directive| {
            slot_range(directive.scope, seed.total_beats, seed.required_subdivision).is_err()
        });
        let mut orphaned_normalization_trace = None;
        if all_orphaned {
            let (normalized, density_clamp, complexity_clamp) = normalize_to_active_corridors(
                seed,
                &state,
                &ranks,
                inputs,
                cycle,
                None,
                corridor,
                sampled_complexity_corridor(inputs, cycle),
                &mut complexity_work_budget,
            );
            orphaned_normalization_trace =
                legacy_corridor_trace(cycle, density_clamp, complexity_clamp);
            state = normalized;
        }
        for directive in active {
            let scope_is_valid =
                slot_range(directive.scope, seed.total_beats, seed.required_subdivision).is_ok();
            let directive_corridor = directive_density_corridor(directive, corridor, slots);
            if cycle == inputs.cycle && scope_is_valid {
                requested_density_corridor = directive_corridor.percent_range();
                requested_complexity_corridor = directive_complexity_corridor(
                    directive,
                    sampled_complexity_corridor(inputs, cycle),
                )
                .range();
            }
            let accumulator = accumulators.entry(directive.id).or_default();
            let (next, trace) = apply_directive(
                directive,
                &state,
                seed,
                &leash_anchor,
                seed_onset_count,
                &ranks,
                &template,
                beat_level,
                inputs,
                cycle,
                accumulator,
                directive_corridor,
                &mut complexity_work_budget,
            );
            state = next;
            if scope_is_valid && directive.family != DirectiveFamily::Stochastic {
                leash_anchor = state.clone();
            }
            if cycle == inputs.cycle {
                requested_cycle_trace.push(trace);
            }
        }
        if all_orphaned {
            if cycle == inputs.cycle {
                requested_cycle_trace.extend(orphaned_normalization_trace);
            }
            if inputs.curve.enabled {
                let target = inputs.curve.target_milli_at(cycle);
                if target > 0 {
                    let (next, curve_trace) = apply_evolution_curve(
                        target,
                        &state,
                        seed,
                        &ranks,
                        &template,
                        beat_level,
                        inputs,
                        cycle,
                        corridor,
                        &mut complexity_work_budget,
                    );
                    state = next;
                    if cycle == inputs.cycle {
                        requested_cycle_trace.push(curve_trace);
                    }
                }
                leash_anchor = state.clone();
            } else {
                let (next, legacy_trace) = step_with_corridor(
                    seed,
                    &state,
                    &leash_anchor,
                    seed_onset_count,
                    &ranks,
                    &template,
                    beat_level,
                    inputs,
                    cycle,
                    corridor,
                    &mut complexity_work_budget,
                );
                state = next;
                if cycle == inputs.cycle {
                    requested_cycle_trace.extend(legacy_trace);
                }
            }
        }
    }
    let cycle_distance =
        whole_cycle_distance(seed, &previous_cycle_state, &state, &ranks, &template);
    Some(EvolvedSeedResolution {
        seed: state_to_compiled(seed, &state),
        trace: requested_cycle_trace,
        density_corridor: requested_density_corridor,
        complexity_corridor: requested_complexity_corridor,
        state_complexity_milli: super::depth::state_complexity_milli(
            &state_slots(&state),
            seed.required_subdivision,
        ),
        state_depth_diversity_milli: super::depth::depth_diversity_milli(
            &state_slots(&state),
            seed.required_subdivision,
        ),
        cycle_distance,
    })
}

pub fn evolved_seed(seed: &CompiledSeed, inputs: &EvolutionInputs<'_>) -> Option<CompiledSeed> {
    evolved_seed_with_trace(seed, inputs).map(|resolved| resolved.seed)
}

#[cfg(test)]
mod tests {
    static CURVE_OFF: EvolutionCurve = EvolutionCurve {
        enabled: false,
        model_version: super::super::perceptual::PerceptualModelVersion::V1,
        tolerance_milli: 500,
        max_operations: 4,
        points: Vec::new(),
    };

    use super::*;
    use crate::generators::dumka::dsl::parse;
    use crate::generators::dumka::tree::{compile, resolve_seed_cells};
    use proptest::prelude::*;

    fn compiled(text: &str) -> CompiledSeed {
        compile(&parse(text).unwrap()).unwrap()
    }

    fn spans(count: u64, len: u32) -> Vec<GeneratorSpanInput> {
        (0..count)
            .map(|i| GeneratorSpanInput {
                span_id: i + 1,
                span_len: len,
                label: None,
                section_index: Some(1),
                subdivision: Some(len),
            })
            .collect()
    }

    fn no_automation(_: &str, _: u64, _: f64) -> Option<f64> {
        None
    }

    fn inputs<'a>(
        seed_value: u64,
        cycle: u64,
        rate: u32,
        leash: u32,
        spans: &'a [GeneratorSpanInput],
    ) -> EvolutionInputs<'a> {
        EvolutionInputs {
            seed_value,
            cycle,
            evolution_rate: rate,
            drift_leash: leash,
            density_floor: 0,
            density_ceiling: 100,
            complexity_floor: 0,
            complexity_ceiling: 100_000,
            barlow_temperature: 0,
            placement_bias: 0,
            fill_complexity: 0,
            euclid_max_run: 1,
            euclid_invert: 0,
            euclid_rest_policy: super::super::reshape::EuclidRestPolicy::Tied,
            plan: &[],
            curve: &CURVE_OFF,
            op_weights: OpWeights::default(),
            automation: &no_automation,
            spans,
            cycle_beats: 4,
        }
    }

    fn inputs_with_automation<'a>(
        seed_value: u64,
        cycle: u64,
        rate: u32,
        leash: u32,
        spans: &'a [GeneratorSpanInput],
        automation: &'a GeneratorAutomationSampler<'a>,
    ) -> EvolutionInputs<'a> {
        EvolutionInputs {
            seed_value,
            cycle,
            evolution_rate: rate,
            drift_leash: leash,
            density_floor: 0,
            density_ceiling: 100,
            complexity_floor: 0,
            complexity_ceiling: 100_000,
            barlow_temperature: 0,
            placement_bias: 0,
            fill_complexity: 0,
            euclid_max_run: 1,
            euclid_invert: 0,
            euclid_rest_policy: super::super::reshape::EuclidRestPolicy::Tied,
            plan: &[],
            curve: &CURVE_OFF,
            op_weights: OpWeights::default(),
            automation,
            spans,
            cycle_beats: 4,
        }
    }

    fn directive(
        id: u64,
        order: u32,
        family: DirectiveFamily,
        from_cycle: u64,
        to_cycle: u64,
        intensity: u32,
    ) -> EvolutionDirective {
        EvolutionDirective {
            id,
            order,
            enabled: true,
            from_cycle,
            to_cycle,
            family,
            pacing: DirectivePacing::PerCycle,
            magnitude: DirectiveMagnitude::OperationQuota,
            intensity,
            scope: None,
            options: super::super::plan::DirectiveOptions::default(),
        }
    }

    const SEED_TEXT: &str = "[dum . . ka] [. . ka .] [dum . ka .] [x x . x]";

    fn fold_env(beats: u32, subdivision: u32) -> (Vec<u32>, Vec<u32>, u32) {
        let strata = stratification(beats, subdivision).unwrap();
        (
            indispensability(&strata),
            metrical_levels(&strata),
            factor_descending(beats).len() as u32,
        )
    }

    fn transition_distance(left: &CompiledSeed, right: &CompiledSeed) -> u32 {
        assert_eq!(left.total_beats, right.total_beats);
        assert_eq!(left.required_subdivision, right.required_subdivision);
        let (ranks, levels, _) = fold_env(left.total_beats, left.required_subdivision);
        let context =
            PerceptualContext::new(left.total_beats, left.required_subdivision, ranks, levels)
                .unwrap();
        perceptual_distance(
            &seed_state(left),
            &seed_state(right),
            &context,
            &PerceptualModel::default(),
        )
        .total_milli
    }

    fn perceptually_paced(
        mut row: EvolutionDirective,
        target_milli: u32,
        tolerance_milli: u32,
        max_operations: u32,
    ) -> EvolutionDirective {
        row.magnitude = DirectiveMagnitude::Perceptual {
            model_version: super::super::perceptual::PerceptualModelVersion::V1,
            target_milli,
            tolerance_milli,
            max_operations,
        };
        row
    }

    fn event_picture(seed: &CompiledSeed) -> Vec<(i64, i64, &str)> {
        let subdivision = i64::from(seed.required_subdivision);
        seed.events
            .iter()
            .map(|event| {
                (
                    *event.start.numer() * subdivision / *event.start.denom(),
                    *event.dur.numer() * subdivision / *event.dur.denom(),
                    event.class.as_str(),
                )
            })
            .collect()
    }

    fn onset_snapshot(seed: &CompiledSeed) -> std::collections::BTreeSet<(u32, u32, String)> {
        seed_state(seed)
            .onsets
            .into_iter()
            .map(|onset| (onset.slot, onset.dur, onset.class))
            .collect()
    }

    const PLAN_FAMILIES: [DirectiveFamily; 9] = [
        DirectiveFamily::BarlowRemove,
        DirectiveFamily::BarlowAdd,
        DirectiveFamily::Rotate,
        DirectiveFamily::Syncopate,
        DirectiveFamily::Desyncopate,
        DirectiveFamily::Fragment,
        DirectiveFamily::Consolidate,
        DirectiveFamily::Euclid,
        DirectiveFamily::Stochastic,
    ];

    #[test]
    fn cycle_zero_and_rate_zero_are_the_seed_verbatim() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        assert_eq!(
            evolved_seed(&seed, &inputs(7, 0, 100, 100, &s)).unwrap(),
            seed
        );
        for cycle in [1, 9, 300] {
            assert_eq!(
                evolved_seed(&seed, &inputs(7, cycle, 0, 100, &s)).unwrap(),
                seed
            );
        }
    }

    #[test]
    fn behavior_off_legacy_fold_keeps_trace_empty() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        for cycle in [0, 1, 12] {
            let resolution =
                evolved_seed_with_trace(&seed, &inputs(7, cycle, 100, 100, &s)).unwrap();
            assert!(resolution.trace.is_empty(), "cycle {cycle}");
        }
    }

    #[test]
    fn legacy_corridor_normalization_uses_the_reserved_trace_sentinel() {
        let seed = compiled("[x x x x] [x x x x] [x x x x] [x x x x]");
        let s = spans(4, 4);
        let mut corridor_inputs = inputs(7, 1, 0, 100, &s);
        corridor_inputs.density_ceiling = 50;
        let resolution = evolved_seed_with_trace(&seed, &corridor_inputs).unwrap();
        assert_eq!(resolution.seed.events.len(), 8);
        assert_eq!(resolution.trace.len(), 1);
        let trace = &resolution.trace[0];
        assert_eq!(trace.directive_id, LEGACY_EVOLUTION_TRACE_ID);
        assert_eq!(trace.family, DirectiveFamily::Stochastic);
        assert_eq!((trace.requested, trace.applied), (0, 0));
        assert_eq!(trace.skipped, DirectiveSkip::None);
        assert_eq!(
            trace.corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 50,
            })
        );
    }

    #[test]
    fn legacy_stochastic_operation_clamp_is_traced_truthfully() {
        let seed = compiled("[x x x x] [x x x x] [x x x x] [x x x x]");
        let s = spans(4, 4);
        let mut corridor_inputs = inputs(7, 1, 100, 100, &s);
        corridor_inputs.density_floor = 100;
        corridor_inputs.density_ceiling = 100;
        corridor_inputs.op_weights = OpWeights {
            barlow_remove: 1,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 0,
            consolidate: 0,
            euclid: 0,
        };
        let resolution = evolved_seed_with_trace(&seed, &corridor_inputs).unwrap();
        assert_eq!(resolution.seed, seed);
        assert_eq!(resolution.trace.len(), 1);
        let trace = &resolution.trace[0];
        assert_eq!(trace.directive_id, LEGACY_EVOLUTION_TRACE_ID);
        assert_eq!((trace.requested, trace.applied), (1, 0));
        assert_eq!(trace.skipped, DirectiveSkip::None);
        assert_eq!(
            trace.corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Floor,
                density_percent: 100,
            })
        );
        assert_eq!(
            serde_json::to_value(trace).unwrap(),
            serde_json::json!({
                "cycle": 1,
                "directiveId": 0,
                "family": "stochastic",
                "requested": 1,
                "applied": 0,
                "skipped": "none",
                "corridorClamp": {"limit": "floor", "densityPercent": 100}
            })
        );
    }

    #[test]
    fn legacy_fragment_reports_a_successful_reduced_figure_clamp() {
        let seed = compiled("[x _ _ _ _ _ . .] [ka . ka .]");
        let s = spans(2, 8);
        let mut corridor_inputs = inputs(17, 1, 100, 100, &s);
        corridor_inputs.cycle_beats = 2;
        corridor_inputs.density_ceiling = 25;
        corridor_inputs.fill_complexity = 100;
        corridor_inputs.op_weights = OpWeights {
            barlow_remove: 0,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 1,
            consolidate: 0,
            euclid: 0,
        };
        let resolution = evolved_seed_with_trace(&seed, &corridor_inputs).unwrap();
        assert_eq!(resolution.seed.events.len(), 4);
        assert_eq!(resolution.trace.len(), 1);
        let trace = &resolution.trace[0];
        assert_eq!(trace.directive_id, LEGACY_EVOLUTION_TRACE_ID);
        assert_eq!((trace.requested, trace.applied), (1, 1));
        assert_eq!(trace.skipped, DirectiveSkip::None);
        assert_eq!(
            trace.corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 25,
            })
        );
    }

    #[test]
    fn legacy_consolidate_reports_a_successful_truncated_merge_clamp() {
        let seed = compiled("[x x x x] [x x x x] [x x x x] [x x x x]");
        let s = spans(4, 4);
        let mut corridor_inputs = inputs(7, 1, 100, 100, &s);
        corridor_inputs.density_floor = 75;
        corridor_inputs.op_weights = OpWeights {
            barlow_remove: 0,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 0,
            consolidate: 1,
            euclid: 0,
        };
        let resolution = evolved_seed_with_trace(&seed, &corridor_inputs).unwrap();
        assert_eq!(resolution.seed.events.len(), 12);
        assert_eq!(resolution.trace.len(), 1);
        let trace = &resolution.trace[0];
        assert_eq!(trace.directive_id, LEGACY_EVOLUTION_TRACE_ID);
        assert_eq!((trace.requested, trace.applied), (1, 1));
        assert_eq!(trace.skipped, DirectiveSkip::None);
        assert_eq!(
            trace.corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Floor,
                density_percent: 75,
            })
        );
    }

    #[test]
    fn the_fold_satisfies_the_prefix_property() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let (ranks, template, beat_level) = fold_env(4, 4);
        let seed_slots: Vec<u32> = seed_state(&seed).onsets.iter().map(|o| o.slot).collect();

        let mut state = seed_state(&seed);
        for cycle in 1..=48u64 {
            let stepped = step(
                &seed,
                &state,
                &seed_slots,
                &ranks,
                &template,
                beat_level,
                &inputs(42, cycle, 60, 50, &s),
                cycle,
            )
            .0;
            state = stepped;
            let direct = evolved_seed(&seed, &inputs(42, cycle, 60, 50, &s)).unwrap();
            assert_eq!(direct, state_to_compiled(&seed, &state), "cycle {cycle}");
        }
    }

    #[test]
    fn default_policy_trajectory_is_pinned() {
        // Byte-compatibility anchor: the M3 family-weight bands and Barlow
        // temperature must reproduce this exact trajectory at their default
        // values (weights 3/3/2/0/0, temperature 0), because the defaults
        // are defined as the historical draw mapping. If this pin moves,
        // every locked-seed performance recorded before the change replays
        // differently — that is a musical regression, not an update.
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let evolved = evolved_seed(&seed, &inputs(42, 40, 60, 60, &s)).unwrap();
        let picture: Vec<(i64, i64, &str)> = evolved
            .events
            .iter()
            .map(|event| {
                (
                    *event.start.numer() * 16 / *event.start.denom(),
                    *event.dur.numer() * 16 / *event.dur.denom(),
                    event.class.as_str(),
                )
            })
            .collect();
        assert_eq!(
            picture,
            vec![
                (0, 4, "x"),
                (8, 4, "x"),
                (12, 4, "x"),
                (16, 4, "dum"),
                (24, 4, "dum"),
                (32, 4, "ka"),
                (40, 4, "ka"),
                (48, 4, "dum"),
                (56, 4, "ka"),
            ]
        );
    }

    #[test]
    fn planned_user_trajectory_repeats_then_layers_scoped_pins() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let remove = directive(13, 0, DirectiveFamily::BarlowRemove, 13, 13, 15);
        let mut fragment = directive(15, 1, DirectiveFamily::Fragment, 15, 15, 22);
        fragment.scope = Some(super::super::plan::BeatRange {
            start_beat: 2,
            len_beats: 2,
        });
        let plan = vec![remove, fragment];

        let resolve = |cycle| {
            let mut plan_inputs = inputs(7, cycle, 0, 0, &s);
            plan_inputs.plan = &plan;
            evolved_seed_with_trace(&seed, &plan_inputs).unwrap()
        };
        let cycle12 = resolve(12);
        let cycle13 = resolve(13);
        let cycle14 = resolve(14);
        let cycle15 = resolve(15);
        let cycle16 = resolve(16);

        assert_eq!(
            event_picture(&cycle12.seed),
            vec![
                (0, 1, "dum"),
                (3, 1, "ka"),
                (6, 1, "ka"),
                (8, 1, "dum"),
                (10, 1, "ka"),
                (12, 1, "x"),
                (13, 1, "x"),
                (15, 1, "x"),
            ]
        );
        let after_remove = vec![
            (0, 1, "dum"),
            (6, 1, "ka"),
            (8, 1, "dum"),
            (10, 1, "ka"),
            (12, 1, "x"),
            (15, 1, "x"),
        ];
        assert_eq!(event_picture(&cycle13.seed), after_remove);
        assert_eq!(event_picture(&cycle14.seed), after_remove);
        let after_fragment = vec![
            (0, 1, "dum"),
            (6, 1, "ka"),
            (8, 1, "dum"),
            (10, 1, "ka"),
            (12, 1, "x"),
            (13, 1, "x"),
            (14, 1, "x"),
            (15, 1, "x"),
        ];
        assert_eq!(event_picture(&cycle15.seed), after_fragment);
        assert_eq!(event_picture(&cycle16.seed), after_fragment);
        assert_eq!(resolve(15).seed, cycle15.seed, "planned fold byte-replays");
        assert_eq!(resolve(15).trace, cycle15.trace, "trace byte-replays");

        assert_eq!(cycle12.seed, seed, "cycles 1-12 are literal repetition");
        assert_eq!(cycle13.trace.len(), 1);
        assert_eq!(cycle13.trace[0].directive_id, 13);
        assert_eq!(cycle13.trace[0].requested, 2, "ceil(15% of 8)");
        assert_eq!(cycle13.trace[0].applied, 2);
        assert_eq!(cycle13.trace[0].skipped, DirectiveSkip::None);
        assert_eq!(
            cycle14.seed, cycle13.seed,
            "cycle 14 repeats the pin result"
        );

        assert_eq!(cycle15.trace.len(), 1);
        assert_eq!(cycle15.trace[0].directive_id, 15);
        assert_eq!(cycle15.trace[0].applied, 1);
        assert_eq!(cycle15.trace[0].skipped, DirectiveSkip::None);
        assert_eq!(cycle16.seed, cycle15.seed, "cycle 16 repeats the figure");

        let before_scope = cycle14
            .seed
            .events
            .iter()
            .filter(|event| event.start < Rational::from_integer(2))
            .cloned()
            .collect::<Vec<_>>();
        let after_scope = cycle15
            .seed
            .events
            .iter()
            .filter(|event| event.start < Rational::from_integer(2))
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(before_scope, after_scope, "last-two-beat scope is strict");
        assert_ne!(cycle15.seed, cycle14.seed, "fragment pin is audible");
    }

    #[test]
    fn equal_count_morph_alignment_is_cyclic_transport_without_edits() {
        let state = |slots: &[u32]| EvolutionState {
            onsets: slots
                .iter()
                .copied()
                .map(|slot| EvolvedOnset {
                    slot,
                    dur: 1,
                    class: "x".to_string(),
                })
                .collect(),
            rotation_beats: 0,
        };
        let pairs = morph_alignment(&state(&[0, 1, 2, 3]), &state(&[0, 1, 2, 7]), 8);
        assert_eq!(
            pairs,
            vec![
                MorphPair {
                    current: Some(0),
                    target: Some(0),
                },
                MorphPair {
                    current: Some(1),
                    target: Some(1),
                },
                MorphPair {
                    current: Some(2),
                    target: Some(2),
                },
                MorphPair {
                    current: Some(3),
                    target: Some(3),
                },
            ]
        );
    }

    #[test]
    fn morph_materializes_prior_rotation_before_comparing_with_its_target() {
        let seed = compiled("x . . .");
        let mut rotated = seed_state(&seed);
        rotated.rotation_beats = 1;
        let mut row = directive(90, 0, DirectiveFamily::Morph, 1, 1, 100);
        row.options.morph_target = Some(". x . .".to_string());

        assert_eq!(morph_remaining_steps(&row, &rotated, &seed, None), 0);
        assert_eq!(state_to_compiled(&seed, &rotated), compiled(". x . ."));
    }

    #[test]
    fn morph_validation_caps_alignment_and_microstep_work() {
        let dense = |count: u32| CompiledSeed {
            total_beats: count,
            required_subdivision: 1,
            events: (0..count)
                .map(|slot| SeedEvent {
                    start: Rational::from_integer(i64::from(slot)),
                    dur: Rational::ONE,
                    class: "x".to_string(),
                })
                .collect(),
        };
        let too_many = 257;
        assert!(matches!(
            validate_morph_target_work(91, &dense(too_many), &dense(too_many)),
            Err(GeneratorError::DumkaPlanInvalid { message })
                if message == format!(
                    "directive 91 morph alignment reserves {} pair evaluations, exceeding the limit of {MAX_MORPH_ALIGNMENT_WORK}",
                    u64::from(too_many).pow(2)
                )
        ));

        let seed = CompiledSeed {
            total_beats: 512,
            required_subdivision: 1,
            events: vec![
                SeedEvent {
                    start: Rational::ZERO,
                    dur: Rational::ONE,
                    class: "x".to_string(),
                },
                SeedEvent {
                    start: Rational::from_integer(256),
                    dur: Rational::ONE,
                    class: "x".to_string(),
                },
            ],
        };
        let target = CompiledSeed {
            total_beats: 512,
            required_subdivision: 1,
            events: vec![
                SeedEvent {
                    start: Rational::from_integer(128),
                    dur: Rational::ONE,
                    class: "ka".to_string(),
                },
                SeedEvent {
                    start: Rational::from_integer(384),
                    dur: Rational::ONE,
                    class: "ka".to_string(),
                },
            ],
        };
        assert!(matches!(
            validate_morph_target_work(92, &seed, &target),
            Err(GeneratorError::DumkaPlanInvalid { message })
                if message == format!(
                    "directive 92 morph requires 258 microsteps, exceeding the limit of {MAX_MORPH_MICROSTEPS}"
                )
        ));
    }

    #[test]
    fn gentle_remove_transition_paces_one_fixed_target_and_matches_the_pin_endpoint() {
        let seed = compiled("x x x x x x x x");
        let s = spans(8, 1);
        let mut gentle = directive(1, 0, DirectiveFamily::BarlowRemove, 1, 4, 25);
        gentle.pacing = DirectivePacing::EaseInOut;
        let gentle_plan = vec![gentle];

        let resolve = |cycle| {
            let mut plan_inputs = inputs(17, cycle, 0, 0, &s);
            plan_inputs.plan = &gentle_plan;
            plan_inputs.cycle_beats = 8;
            evolved_seed_with_trace(&seed, &plan_inputs).unwrap()
        };
        let cycles = (0..=4).map(resolve).collect::<Vec<_>>();
        assert_eq!(
            cycles
                .iter()
                .map(|resolution| resolution.seed.events.len())
                .collect::<Vec<_>>(),
            vec![8, 8, 7, 7, 6]
        );
        assert_eq!(
            cycles[1..]
                .iter()
                .map(|resolution| {
                    let trace = &resolution.trace[0];
                    (trace.requested, trace.applied, trace.skipped)
                })
                .collect::<Vec<_>>(),
            vec![
                (0, 0, DirectiveSkip::None),
                (1, 1, DirectiveSkip::None),
                (0, 0, DirectiveSkip::None),
                (1, 1, DirectiveSkip::None),
            ]
        );

        let pin_plan = vec![directive(1, 0, DirectiveFamily::BarlowRemove, 1, 1, 25)];
        let mut pin_inputs = inputs(17, 1, 0, 0, &s);
        pin_inputs.plan = &pin_plan;
        pin_inputs.cycle_beats = 8;
        let pin = evolved_seed_with_trace(&seed, &pin_inputs).unwrap();
        assert_eq!(
            cycles[4].seed, pin.seed,
            "pacing changes operation timing, not the final selected target"
        );
        assert_eq!(resolve(4).seed, cycles[4].seed, "transition byte-replays");

        let mut hot_gentle_inputs = inputs(17, 4, 0, 0, &s);
        hot_gentle_inputs.plan = &gentle_plan;
        hot_gentle_inputs.cycle_beats = 8;
        hot_gentle_inputs.barlow_temperature = 100;
        let hot_gentle = evolved_seed_with_trace(&seed, &hot_gentle_inputs).unwrap();
        let mut hot_pin_inputs = inputs(17, 1, 0, 0, &s);
        hot_pin_inputs.plan = &pin_plan;
        hot_pin_inputs.cycle_beats = 8;
        hot_pin_inputs.barlow_temperature = 100;
        let hot_pin = evolved_seed_with_trace(&seed, &hot_pin_inputs).unwrap();
        assert_eq!(
            hot_gentle.seed, hot_pin.seed,
            "temperature-widened identity draws use range-global ordinals"
        );
    }

    #[test]
    fn gentle_morph_reaches_the_target_through_small_repeatable_steps() {
        let seed = compiled("[x . . .]");
        let s = spans(1, 4);
        let mut row = directive(81, 0, DirectiveFamily::Morph, 1, 4, 100);
        row.pacing = DirectivePacing::EaseInOut;
        row.options.morph_target = Some("[. . x .]".to_string());
        let plan = vec![row];

        let resolve = |cycle| {
            let mut plan_inputs = inputs(41, cycle, 0, 0, &s);
            plan_inputs.cycle_beats = 1;
            plan_inputs.plan = &plan;
            evolved_seed_with_trace(&seed, &plan_inputs).unwrap()
        };
        let cycles = (0..=4).map(resolve).collect::<Vec<_>>();
        assert_eq!(
            cycles
                .iter()
                .map(|resolution| seed_state(&resolution.seed).onsets[0].slot)
                .collect::<Vec<_>>(),
            vec![0, 0, 3, 3, 2],
            "the gentle shoulders hold while each requested step moves only one slot"
        );
        assert_eq!(
            cycles[1..]
                .iter()
                .map(|resolution| {
                    let trace = &resolution.trace[0];
                    (trace.requested, trace.applied, trace.skipped)
                })
                .collect::<Vec<_>>(),
            vec![
                (0, 0, DirectiveSkip::None),
                (1, 1, DirectiveSkip::None),
                (0, 0, DirectiveSkip::None),
                (1, 1, DirectiveSkip::None),
            ]
        );
        assert_eq!(cycles[4].seed, compiled("[. . x .]"));
        let replay = resolve(4);
        assert_eq!(replay.seed, cycles[4].seed, "Morph must byte-replay");
        assert_eq!(
            replay.trace, cycles[4].trace,
            "Morph trace must byte-replay"
        );
    }

    #[test]
    fn perceptual_morph_selects_the_nearest_legal_microstep() {
        let seed = compiled("[x . . .]");
        let s = spans(1, 4);
        let mut oracle_row = directive(82, 0, DirectiveFamily::Morph, 1, 1, 50);
        oracle_row.options.morph_target = Some("[. . x .]".to_string());
        let oracle_plan = vec![oracle_row.clone()];
        let mut oracle_inputs = inputs(43, 1, 0, 0, &s);
        oracle_inputs.cycle_beats = 1;
        oracle_inputs.plan = &oracle_plan;
        let oracle = evolved_seed_with_trace(&seed, &oracle_inputs).unwrap();
        assert_eq!(seed_state(&oracle.seed).onsets[0].slot, 3);
        assert_eq!(oracle.trace[0].applied, 1);
        let target = transition_distance(&seed, &oracle.seed);
        assert!(target > 0);

        let plan = vec![perceptually_paced(oracle_row, target, 0, 2)];
        let mut plan_inputs = inputs(43, 1, 0, 0, &s);
        plan_inputs.cycle_beats = 1;
        plan_inputs.plan = &plan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolution.seed, oracle.seed);
        assert_eq!(
            (resolution.trace[0].requested, resolution.trace[0].applied),
            (1, 1)
        );
        assert!(resolution.trace[0]
            .perceptual
            .is_some_and(|trace| trace.reached && trace.actual_milli == target));
    }

    #[test]
    fn morph_insertion_is_one_legal_endpoint_step() {
        let seed = compiled("[x . . .]");
        let s = spans(1, 4);
        let mut row = directive(83, 0, DirectiveFamily::Morph, 1, 1, 100);
        row.options.morph_target = Some("[x . x .]".to_string());
        let plan = vec![row];
        let mut plan_inputs = inputs(47, 1, 0, 0, &s);
        plan_inputs.cycle_beats = 1;
        plan_inputs.plan = &plan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolution.seed, compiled("[x . x .]"));
        assert_eq!(
            (resolution.trace[0].requested, resolution.trace[0].applied),
            (1, 1)
        );
        assert_eq!(resolution.trace[0].skipped, DirectiveSkip::None);
    }

    #[test]
    fn morph_antipode_retries_the_equally_short_legal_arc() {
        let seed = compiled("[x x . .]");
        let s = spans(1, 4);
        let mut row = directive(86, 0, DirectiveFamily::Morph, 1, 1, 100);
        row.options.morph_target = Some("[x . . x]".to_string());
        let plan = vec![row];
        let mut plan_inputs = inputs(61, 1, 0, 0, &s);
        plan_inputs.cycle_beats = 1;
        plan_inputs.plan = &plan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();

        assert_eq!(resolution.seed, compiled("[x . . x]"));
        assert_eq!(resolution.trace[0].skipped, DirectiveSkip::None);
        assert_eq!(resolution.trace[0].applied, 2);
    }

    #[test]
    fn unequal_morph_uses_its_fixed_quota_to_reach_the_exact_endpoint() {
        let seed = compiled("[x . . . . .]");
        let s = spans(1, 6);
        let mut row = directive(87, 0, DirectiveFamily::Morph, 1, 1, 100);
        row.options.morph_target = Some("[. . x x . .]".to_string());
        let plan = vec![row];
        let mut plan_inputs = inputs(67, 1, 0, 0, &s);
        plan_inputs.cycle_beats = 1;
        plan_inputs.plan = &plan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();

        assert_eq!(resolution.seed, compiled("[. . x x . .]"));
        assert_eq!(resolution.trace[0].skipped, DirectiveSkip::None);
        assert_eq!(
            (resolution.trace[0].requested, resolution.trace[0].applied),
            (3, 3)
        );
    }

    #[test]
    fn morph_microsteps_obey_the_shared_complexity_corridor() {
        let seed = compiled("[x . . .]");
        let s = spans(1, 4);
        let mut row = directive(85, 0, DirectiveFamily::Morph, 1, 1, 100);
        row.options.morph_target = Some("[. x . .]".to_string());
        let plan = vec![row];
        let mut plan_inputs = inputs(59, 1, 0, 0, &s);
        plan_inputs.cycle_beats = 1;
        plan_inputs.complexity_ceiling = 0;
        plan_inputs.plan = &plan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolution.seed, seed);
        assert_eq!(
            (resolution.trace[0].requested, resolution.trace[0].applied),
            (1, 0)
        );
        assert_eq!(resolution.trace[0].skipped, DirectiveSkip::Exhausted);
        assert_eq!(
            resolution.trace[0].complexity_corridor_clamp,
            Some(ComplexityCorridorClamp {
                limit: ComplexityCorridorLimit::Ceiling,
                complexity_milli: 0,
            })
        );
    }

    #[test]
    fn palette_morph_reaches_a_spanning_five_in_two_target_at_the_range_endpoint() {
        let mut seed = compiled(SEED_TEXT);
        seed.required_subdivision = 20;
        let target_text = "[x x x x x]@2 [dum . ka .] [x x . x]";
        let mut target = compiled(target_text);
        target.required_subdivision = 20;
        let s = spans(4, 20);
        let mut row = directive(84, 0, DirectiveFamily::Morph, 5, 20, 100);
        row.pacing = DirectivePacing::EaseInOut;
        row.options.morph_target = Some(target_text.to_string());
        let plan = vec![row.clone()];

        let resolve = |cycle| {
            let mut plan_inputs = inputs(53, cycle, 0, 0, &s);
            plan_inputs.plan = &plan;
            evolved_seed_with_trace(&seed, &plan_inputs).unwrap()
        };
        let cycles = (4..=20).map(resolve).collect::<Vec<_>>();
        assert_eq!(cycles[0].seed, seed, "the pre-range cycle is unchanged");
        assert_eq!(
            cycles[16].seed, target,
            "the inclusive range reaches its target"
        );

        let remaining = cycles
            .iter()
            .map(|resolution| {
                morph_remaining_steps(&row, &seed_state(&resolution.seed), &seed, None)
            })
            .collect::<Vec<_>>();
        assert!(
            remaining.windows(2).all(|pair| pair[1] <= pair[0]),
            "Morph must make monotone progress: {remaining:?}"
        );
        assert_eq!(remaining.last(), Some(&0));
        let replay = resolve(20);
        assert_eq!(replay.seed, cycles[16].seed);
        assert_eq!(replay.trace, cycles[16].trace);
    }

    #[test]
    fn perceptual_pacing_finds_one_tiny_add_or_remove_in_the_full_fold() {
        for (family, text) in [
            (DirectiveFamily::BarlowRemove, "x x x x x x x x"),
            (DirectiveFamily::BarlowAdd, "x . x . x . x ."),
        ] {
            let seed = compiled(text);
            let s = spans(8, 1);

            // Use the historical one-operation path as an independent oracle
            // for this directive's identity-seeded first prefix.
            let oracle_plan = vec![directive(71, 0, family, 1, 1, 1)];
            let mut oracle_inputs = inputs(17, 1, 0, 0, &s);
            oracle_inputs.plan = &oracle_plan;
            oracle_inputs.cycle_beats = 8;
            let oracle = evolved_seed_with_trace(&seed, &oracle_inputs).unwrap();
            assert_eq!(oracle.trace[0].applied, 1);
            let target = transition_distance(&seed, &oracle.seed);
            assert!(target > 0, "{family:?} must be perceptually audible");

            let mut row = directive(71, 0, family, 1, 1, 0);
            row = perceptually_paced(row, target, 0, 16);
            let plan = vec![row];
            let mut plan_inputs = inputs(17, 1, 0, 0, &s);
            plan_inputs.plan = &plan;
            plan_inputs.cycle_beats = 8;
            let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
            assert_eq!(resolution.seed, oracle.seed, "{family:?}");
            let trace = &resolution.trace[0];
            assert_eq!(trace.applied, 1, "{family:?}");
            assert_eq!(trace.skipped, DirectiveSkip::None, "{family:?}");
            assert_eq!(
                trace.perceptual,
                Some(PerceptualPacingTrace {
                    model_version: super::super::perceptual::PerceptualModelVersion::V1,
                    actual_milli: target,
                    target_milli: target,
                    tolerance_milli: 0,
                    reached: true,
                    exhausted: false,
                }),
                "{family:?}"
            );
        }
    }

    #[test]
    fn perceptual_rotate_holds_when_one_step_would_overshoot_the_target() {
        let seed = compiled("x . . .");
        let s = spans(4, 1);
        let oracle_plan = vec![directive(72, 0, DirectiveFamily::Rotate, 1, 1, 25)];
        let mut oracle_inputs = inputs(23, 1, 0, 0, &s);
        oracle_inputs.plan = &oracle_plan;
        let oracle = evolved_seed_with_trace(&seed, &oracle_inputs).unwrap();
        let one_step = transition_distance(&seed, &oracle.seed);
        assert!(one_step > 2);

        let plan = vec![perceptually_paced(
            directive(72, 0, DirectiveFamily::Rotate, 1, 1, 100),
            1,
            0,
            1,
        )];
        let mut plan_inputs = inputs(23, 1, 0, 0, &s);
        plan_inputs.plan = &plan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolution.seed, seed, "candidate zero is a truthful hold");
        let trace = &resolution.trace[0];
        assert_eq!((trace.requested, trace.applied), (1, 0));
        assert_eq!(trace.skipped, DirectiveSkip::Exhausted);
        assert_eq!(
            trace.perceptual,
            Some(PerceptualPacingTrace {
                model_version: super::super::perceptual::PerceptualModelVersion::V1,
                actual_milli: 0,
                target_milli: 1,
                tolerance_milli: 0,
                reached: false,
                exhausted: true,
            })
        );
    }

    #[test]
    fn perceptual_prefix_ties_choose_the_smaller_prefix_deterministically() {
        let seed = compiled("x . . .");
        let s = spans(4, 1);
        let oracle_plan = vec![directive(73, 0, DirectiveFamily::Rotate, 1, 1, 25)];
        let mut oracle_inputs = inputs(29, 1, 0, 0, &s);
        oracle_inputs.plan = &oracle_plan;
        let oracle = evolved_seed_with_trace(&seed, &oracle_inputs).unwrap();
        let one_step = transition_distance(&seed, &oracle.seed);
        assert_eq!(one_step % 2, 0, "fixture must create an exact integer tie");
        let target = one_step / 2;

        let plan = vec![perceptually_paced(
            directive(73, 0, DirectiveFamily::Rotate, 1, 1, 0),
            target,
            0,
            1,
        )];
        let resolve = || {
            let mut plan_inputs = inputs(29, 1, 0, 0, &s);
            plan_inputs.plan = &plan;
            evolved_seed_with_trace(&seed, &plan_inputs).unwrap()
        };
        let first = resolve();
        let replay = resolve();
        assert_eq!(first.seed, seed);
        assert_eq!(first.trace[0].applied, 0);
        assert_eq!(first.seed, replay.seed);
        assert_eq!(first.trace, replay.trace);
    }

    #[test]
    fn perceptual_search_follows_repeatable_candidates_beyond_the_initial_count() {
        let seed = compiled("[x _ _ _] [x . . .]");
        let s = spans(2, 4);
        let (ranks, template, beat_level) = fold_env(2, 4);
        let mut row = directive(74, 0, DirectiveFamily::Fragment, 1, 1, 0);
        row.scope = Some(super::super::plan::BeatRange {
            start_beat: 0,
            len_beats: 1,
        });
        let mut oracle_inputs = inputs(31, 1, 0, 0, &s);
        oracle_inputs.cycle_beats = 2;
        let corridor = DensityCorridor::new(0, 100, 8);
        let mut oracle = seed_state(&seed);
        let window = slot_range(row.scope, 2, 4).unwrap();
        assert_eq!(
            directive_candidate_count(&row, &oracle, &seed, &ranks, &template, beat_level, window,),
            1,
            "the fixture starts with one fragmentable sustain"
        );
        for ordinal in 0..3 {
            oracle = apply_one_directive_operation(
                &row,
                &oracle,
                &seed,
                &ranks,
                &template,
                beat_level,
                &oracle_inputs,
                1,
                1,
                ordinal,
                window,
                corridor,
                ComplexityCorridor {
                    floor_milli: 0,
                    ceiling_milli: 100_000,
                },
            )
            .expect("fragmentation creates another legal prefix")
            .0;
        }
        let context = PerceptualContext::new(2, 4, ranks, template).unwrap();
        let target = perceptual_distance(
            &seed_state(&seed),
            &oracle,
            &context,
            &PerceptualModel::v1(),
        )
        .total_milli;

        let plan = vec![perceptually_paced(row, target, 0, 8)];
        let mut plan_inputs = inputs(31, 1, 0, 0, &s);
        plan_inputs.cycle_beats = 2;
        plan_inputs.plan = &plan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(seed_state(&resolution.seed), oracle);
        assert_eq!(
            (resolution.trace[0].requested, resolution.trace[0].applied),
            (3, 3),
            "the search must not be capped by the single initial interval"
        );
        assert!(resolution.trace[0]
            .perceptual
            .is_some_and(|trace| trace.reached));
    }

    #[test]
    fn gradual_ranges_sample_automation_at_the_operation_cycle() {
        let seed = compiled("x x x x x x x x");
        let s = spans(8, 1);
        let mut row = directive(1, 0, DirectiveFamily::BarlowRemove, 1, 4, 25);
        row.pacing = DirectivePacing::EaseInOut;
        let plan = vec![row];
        let sampled_cycles = std::cell::RefCell::new(Vec::new());
        let automation = |target: &str, cycle: u64, authored: f64| {
            if target == DUMKA_BARLOW_TEMPERATURE_TARGET {
                sampled_cycles.borrow_mut().push(cycle);
                Some(if cycle == 2 { 100.0 } else { 0.0 })
            } else {
                Some(authored)
            }
        };
        let mut plan_inputs = inputs_with_automation(17, 4, 0, 0, &s, &automation);
        plan_inputs.plan = &plan;
        plan_inputs.cycle_beats = 8;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolution.seed.events.len(), 6);
        assert_eq!(
            sampled_cycles.into_inner(),
            vec![2, 4],
            "only scheduled operations sample their actual historical cycle"
        );
    }

    #[test]
    fn every_deterministic_family_transition_remains_projectable() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        for (index, family) in PLAN_FAMILIES[..8].iter().copied().enumerate() {
            let mut row = directive(index as u64 + 1, 0, family, 1, 4, 50);
            row.pacing = DirectivePacing::EaseInOut;
            let plan = vec![row];
            let mut plan_inputs = inputs(81, 4, 0, 100, &s);
            plan_inputs.plan = &plan;
            let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
            resolve_seed_cells(&resolution.seed, 4, &s)
                .unwrap_or_else(|error| panic!("{family:?} transition broke projection: {error}"));
        }
    }

    #[test]
    fn range_rotate_quota_is_diffused_and_replays() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let plan = vec![directive(5, 0, DirectiveFamily::Rotate, 1, 4, 32)];
        let requested = (1..=4)
            .map(|cycle| {
                let mut plan_inputs = inputs(91, cycle, 0, 0, &s);
                plan_inputs.plan = &plan;
                let first = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
                let replay = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
                assert_eq!(first.seed, replay.seed);
                assert_eq!(first.trace, replay.trace);
                first.trace[0].requested
            })
            .collect::<Vec<_>>();
        assert_eq!(requested, vec![1, 1, 1, 2]);
    }

    #[test]
    fn authored_whole_cycle_rotate_directions_move_absolute_onsets_as_named() {
        let seed = compiled("x . . .");
        let s = spans(4, 1);
        let resolve_direction = |direction| {
            let mut rotate = directive(5, 0, DirectiveFamily::Rotate, 1, 1, 25);
            rotate.options.rotate_direction = direction;
            let plan = vec![rotate];
            let mut plan_inputs = inputs(91, 1, 0, 0, &s);
            plan_inputs.plan = &plan;
            evolved_seed_with_trace(&seed, &plan_inputs).unwrap()
        };

        let earlier = resolve_direction(RotateDirection::Earlier);
        assert_eq!(
            event_picture(&earlier.seed),
            vec![(3, 1, "x")],
            "earlier wraps the downbeat onset to the preceding beat"
        );
        assert_eq!(earlier.trace[0].requested, 1);
        assert_eq!(earlier.trace[0].applied, 1);

        let later = resolve_direction(RotateDirection::Later);
        assert_eq!(
            event_picture(&later.seed),
            vec![(1, 1, "x")],
            "later moves the downbeat onset to the following beat"
        );
        assert_eq!(later.trace[0].requested, 1);
        assert_eq!(later.trace[0].applied, 1);
    }

    #[test]
    fn scoped_and_whole_cycle_rotate_share_absolute_direction() {
        let seed = compiled("x . . .");
        let s = spans(4, 1);
        let resolve = |direction, scope| {
            let mut rotate = directive(5, 0, DirectiveFamily::Rotate, 1, 1, 25);
            rotate.options.rotate_direction = direction;
            rotate.scope = scope;
            let plan = vec![rotate];
            let mut plan_inputs = inputs(91, 1, 0, 0, &s);
            plan_inputs.plan = &plan;
            evolved_seed_with_trace(&seed, &plan_inputs).unwrap().seed
        };
        let full_scope = Some(super::super::plan::BeatRange {
            start_beat: 0,
            len_beats: 4,
        });
        for direction in [RotateDirection::Earlier, RotateDirection::Later] {
            assert_eq!(
                event_picture(&resolve(direction, None)),
                event_picture(&resolve(direction, full_scope)),
                "{direction:?} must mean the same absolute motion in both forms"
            );
        }
    }

    #[test]
    fn plan_order_layers_independent_families_and_trace_matches_order() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let remove = directive(20, 9, DirectiveFamily::BarlowRemove, 1, 1, 15);
        let add = directive(10, 2, DirectiveFamily::BarlowAdd, 1, 1, 15);
        let plan = vec![remove, add];
        let mut plan_inputs = inputs(3, 1, 0, 0, &s);
        plan_inputs.plan = &plan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(
            resolution
                .trace
                .iter()
                .map(|entry| entry.directive_id)
                .collect::<Vec<_>>(),
            vec![10, 20]
        );
        assert!(resolution.trace.iter().all(|entry| entry.applied > 0));
    }

    #[test]
    fn fold_reports_the_last_scope_valid_directive_corridor_in_authored_order() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let mut override_row = directive(10, 0, DirectiveFamily::Fragment, 2, 2, 0);
        override_row.options.density_floor = Some(20);
        override_row.options.density_ceiling = Some(60);
        let inheriting = directive(20, 1, DirectiveFamily::Rotate, 2, 2, 0);
        let mut orphaned = directive(30, 2, DirectiveFamily::BarlowAdd, 2, 2, 0);
        orphaned.scope = Some(super::super::plan::BeatRange {
            start_beat: 4,
            len_beats: 1,
        });
        orphaned.options.density_floor = Some(30);
        orphaned.options.density_ceiling = Some(40);

        let mut plan_inputs = inputs(7, 2, 0, 100, &s);
        plan_inputs.density_floor = 10;
        plan_inputs.density_ceiling = 90;
        let override_then_orphan = vec![override_row.clone(), orphaned.clone()];
        plan_inputs.plan = &override_then_orphan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(
            resolution.density_corridor,
            DensityCorridorRange {
                floor: 20,
                ceiling: 60,
            },
            "an orphaned later row cannot replace the last applied rail"
        );

        let override_then_inherit_then_orphan = vec![override_row, inheriting, orphaned];
        plan_inputs.plan = &override_then_inherit_then_orphan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(
            resolution.density_corridor,
            DensityCorridorRange {
                floor: 10,
                ceiling: 90,
            },
            "a valid inheriting row restores the sampled global rail"
        );
    }

    #[test]
    fn cycle_zero_reports_its_crossed_automated_global_without_evolving() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let automated: &GeneratorAutomationSampler<'_> = &|target, cycle, _| {
            assert_eq!(cycle, 0);
            match target {
                DUMKA_DENSITY_FLOOR_TARGET => Some(70.0),
                DUMKA_DENSITY_CEILING_TARGET => Some(55.0),
                _ => None,
            }
        };
        let plan = vec![directive(10, 0, DirectiveFamily::Fragment, 0, 0, 100)];
        let mut cycle_zero = inputs_with_automation(7, 0, 100, 100, &s, automated);
        cycle_zero.plan = &plan;
        let resolution = evolved_seed_with_trace(&seed, &cycle_zero).unwrap();
        assert_eq!(resolution.seed, seed);
        assert!(resolution.trace.is_empty());
        assert_eq!(
            resolution.density_corridor,
            DensityCorridorRange {
                floor: 55,
                ceiling: 55,
            }
        );
    }

    #[test]
    fn directive_is_exempt_from_zero_leash_and_cross_span_ties_now_project() {
        let seed = compiled(SEED_TEXT);
        let beat_spans = spans(4, 4);
        let plan = vec![directive(1, 0, DirectiveFamily::BarlowRemove, 1, 1, 15)];
        let mut plan_inputs = inputs(7, 1, 0, 0, &beat_spans);
        plan_inputs.plan = &plan;
        let removed = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_ne!(removed.seed, seed, "authored pin ignores the zero leash");
        assert_eq!(removed.trace[0].applied, 2);

        let crossing_seed = compiled("[x _ . .] [x . x .] [x . x .] [x . x .]");
        let tile_spans = [3u32, 3, 3, 3, 3, 1]
            .iter()
            .enumerate()
            .map(|(index, &len)| GeneratorSpanInput {
                span_id: index as u64 + 1,
                span_len: len,
                label: None,
                section_index: Some(1),
                subdivision: Some(4),
            })
            .collect::<Vec<_>>();
        let rotate_plan = vec![directive(2, 0, DirectiveFamily::Rotate, 1, 1, 50)];
        let mut rotate_inputs = inputs(7, 1, 0, 0, &tile_spans);
        rotate_inputs.plan = &rotate_plan;
        let rotated = evolved_seed_with_trace(&crossing_seed, &rotate_inputs).unwrap();
        assert_eq!(rotated.trace[0].requested, 2);
        assert_eq!(rotated.trace[0].applied, 2);
        assert_eq!(rotated.trace[0].skipped, DirectiveSkip::None);
        resolve_seed_cells(&rotated.seed, 4, &tile_spans)
            .expect("paired cross-span ties are projectable");
    }

    #[test]
    fn orphaned_only_plan_traces_then_falls_through_to_legacy_layer() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let legacy = evolved_seed(&seed, &inputs(7, 1, 100, 100, &s)).unwrap();
        assert_ne!(legacy, seed, "fixture seed fires legacy evolution");

        let mut orphan = directive(44, 0, DirectiveFamily::BarlowRemove, 1, 1, 100);
        orphan.scope = Some(super::super::plan::BeatRange {
            start_beat: 4,
            len_beats: 1,
        });
        let plan = vec![orphan];
        let mut plan_inputs = inputs(7, 1, 100, 100, &s);
        plan_inputs.plan = &plan;
        let resolved = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolved.seed, legacy);
        assert_eq!(resolved.trace[0].skipped, DirectiveSkip::OrphanedScope);
    }

    #[test]
    fn orphaned_only_cycle_keeps_its_global_normalization_clamp_trace_at_rate_zero() {
        let seed = compiled("[x x x x] [x x x x] [x x x x] [x x x x]");
        let s = spans(4, 4);
        let mut orphan = directive(44, 0, DirectiveFamily::BarlowRemove, 1, 1, 100);
        orphan.scope = Some(super::super::plan::BeatRange {
            start_beat: 4,
            len_beats: 1,
        });
        let plan = vec![orphan];
        let mut plan_inputs = inputs(7, 1, 0, 100, &s);
        plan_inputs.plan = &plan;
        plan_inputs.density_ceiling = 50;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolution.seed.events.len(), 8);
        assert_eq!(
            resolution.density_corridor,
            DensityCorridorRange {
                floor: 0,
                ceiling: 50,
            },
            "all orphaned rows leave the requested cycle on its global rail"
        );
        assert_eq!(resolution.trace.len(), 2);
        assert_eq!(resolution.trace[0].directive_id, 44);
        assert_eq!(resolution.trace[0].skipped, DirectiveSkip::OrphanedScope);
        assert_eq!(resolution.trace[1].directive_id, LEGACY_EVOLUTION_TRACE_ID);
        assert_eq!(
            (resolution.trace[1].requested, resolution.trace[1].applied),
            (0, 0)
        );
        assert_eq!(
            resolution.trace[1].corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 50,
            })
        );
    }

    #[test]
    fn stochastic_no_fire_is_not_candidate_exhaustion() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let no_fire_seed = (0..u64::MAX)
            .find(|seed_value| plan_draw(*seed_value, 6, 1, 0, 100) >= 1)
            .unwrap();
        let plan = vec![directive(6, 0, DirectiveFamily::Stochastic, 1, 1, 1)];
        let mut plan_inputs = inputs(no_fire_seed, 1, 0, 100, &s);
        plan_inputs.plan = &plan;
        let resolved = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolved.seed, seed);
        assert_eq!(resolved.trace[0].requested, 0);
        assert_eq!(resolved.trace[0].applied, 0);
        assert_eq!(resolved.trace[0].skipped, DirectiveSkip::None);
    }

    #[test]
    fn stochastic_fire_with_no_weighted_family_is_exhausted() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let plan = vec![directive(6, 0, DirectiveFamily::Stochastic, 1, 1, 100)];
        let mut plan_inputs = inputs(11, 1, 0, 100, &s);
        plan_inputs.plan = &plan;
        plan_inputs.op_weights = OpWeights {
            barlow_remove: 0,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 0,
            consolidate: 0,
            euclid: 0,
        };
        let resolved = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolved.seed, seed);
        assert_eq!(resolved.trace[0].requested, 1);
        assert_eq!(resolved.trace[0].applied, 0);
        assert_eq!(resolved.trace[0].skipped, DirectiveSkip::Exhausted);
    }

    #[test]
    fn deterministic_directive_with_no_candidates_is_exhausted() {
        let seed = compiled("x . x .");
        let s = spans(4, 1);
        let plan = vec![directive(7, 0, DirectiveFamily::Consolidate, 1, 1, 100)];
        let mut plan_inputs = inputs(11, 1, 0, 100, &s);
        plan_inputs.plan = &plan;
        let resolved = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolved.seed, seed);
        assert_eq!(resolved.trace[0].requested, 0);
        assert_eq!(resolved.trace[0].applied, 0);
        assert_eq!(resolved.trace[0].skipped, DirectiveSkip::Exhausted);
    }

    #[test]
    fn stochastic_directive_stream_is_salted_by_identity() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let resolve = |id| {
            let plan = vec![directive(id, 0, DirectiveFamily::Stochastic, 1, 1, 100)];
            let mut plan_inputs = inputs(42, 1, 0, 100, &s);
            plan_inputs.plan = &plan;
            evolved_seed_with_trace(&seed, &plan_inputs).unwrap()
        };
        let first = resolve(1);
        let first_replay = resolve(1);
        let second = resolve(2);
        assert_eq!(first.seed, first_replay.seed, "identity stream replays");
        assert_eq!(first.trace, first_replay.trace);
        assert_ne!(
            first.seed, second.seed,
            "changing directive identity must select an independent stochastic stream"
        );
    }

    #[test]
    fn stochastic_directive_honors_its_beat_scope() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let mut stochastic = directive(8, 0, DirectiveFamily::Stochastic, 1, 1, 100);
        stochastic.scope = Some(super::super::plan::BeatRange {
            start_beat: 3,
            len_beats: 1,
        });
        let plan = vec![stochastic];
        let mut plan_inputs = inputs(42, 1, 0, 100, &s);
        plan_inputs.plan = &plan;
        plan_inputs.op_weights = OpWeights {
            barlow_remove: 1,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 0,
            consolidate: 0,
            euclid: 0,
        };
        let resolved = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolved.trace[0].requested, 1);
        assert_eq!(resolved.trace[0].applied, 1);
        let seed_prefix = seed
            .events
            .iter()
            .filter(|event| event.start < Rational::from_integer(3))
            .cloned()
            .collect::<Vec<_>>();
        let resolved_prefix = resolved
            .seed
            .events
            .iter()
            .filter(|event| event.start < Rational::from_integer(3))
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(resolved_prefix, seed_prefix);
        assert_eq!(resolved.seed.events.len(), seed.events.len() - 1);
    }

    #[test]
    fn compounding_fragment_plateaus_at_the_ceiling_and_traces_the_clamp() {
        let seed = compiled("[x _ _ _ _ _ . .] [ka . ka .]");
        let s = spans(2, 8);
        let mut fragment = directive(1, 0, DirectiveFamily::Fragment, 1, 12, 100);
        fragment.options.fill_complexity = Some(100);
        let plan = vec![fragment];
        let mut previous = 0usize;
        let mut plateaued = false;
        for cycle in 1..=12 {
            let mut plan_inputs = inputs(17, cycle, 0, 100, &s);
            plan_inputs.cycle_beats = 2;
            plan_inputs.plan = &plan;
            plan_inputs.density_ceiling = 60;
            let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
            let count = resolution.seed.events.len();
            assert!(count <= 9, "60% of 16 slots floors to 9 at cycle {cycle}");
            if count == previous {
                plateaued = true;
            }
            previous = count;
        }
        assert!(plateaued, "compounding Fragment must visibly plateau");
        let mut final_inputs = inputs(17, 12, 0, 100, &s);
        final_inputs.cycle_beats = 2;
        final_inputs.plan = &plan;
        final_inputs.density_ceiling = 60;
        let final_resolution = evolved_seed_with_trace(&seed, &final_inputs).unwrap();
        assert_eq!(final_resolution.seed.events.len(), 9);
        assert_eq!(
            final_resolution.trace[0].corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 60,
            })
        );
    }

    #[test]
    fn moving_corridor_contracts_inherited_state_weakest_first_and_replays() {
        let seed = compiled("[x x x x] [x x x x] [x x x x] [x x x x]");
        let s = spans(4, 4);
        let moving: &GeneratorAutomationSampler<'_> = &|target, cycle, fallback| match target {
            DUMKA_DENSITY_CEILING_TARGET => Some(if cycle < 3 { 100.0 } else { 50.0 }),
            _ => Some(fallback),
        };
        let mut moving_inputs = inputs_with_automation(7, 3, 0, 100, &s, &moving);
        moving_inputs.density_floor = 0;
        moving_inputs.density_ceiling = 100;
        let first = evolved_seed(&seed, &moving_inputs).unwrap();
        let replay = evolved_seed(&seed, &moving_inputs).unwrap();
        assert_eq!(first, replay);
        assert_eq!(first.events.len(), 8);

        let ranks = indispensability(&stratification(4, 4).unwrap());
        let retained = seed_state(&first)
            .onsets
            .iter()
            .map(|onset| onset.slot)
            .collect::<Vec<_>>();
        let mut expected = (0..16u32).collect::<Vec<_>>();
        expected.sort_by_key(|&slot| (ranks[slot as usize], slot));
        let weakest = expected
            .into_iter()
            .take(8)
            .collect::<std::collections::BTreeSet<_>>();
        assert!(retained.iter().all(|slot| !weakest.contains(slot)));
    }

    #[test]
    fn corridor_automation_is_historical_and_crossing_lanes_give_ceiling_precedence() {
        let seed = compiled("[x . . .] [x . . .] [x . . .] [x . . .]");
        let s = spans(4, 4);
        let sampled: &GeneratorAutomationSampler<'_> = &|target, cycle, fallback| match target {
            DUMKA_DENSITY_FLOOR_TARGET => Some(if cycle == 1 { 50.0 } else { 90.0 }),
            DUMKA_DENSITY_CEILING_TARGET => Some(if cycle == 1 { 100.0 } else { 40.0 }),
            _ => Some(fallback),
        };
        let at_one = inputs_with_automation(7, 1, 0, 100, &s, &sampled);
        let at_two = inputs_with_automation(7, 2, 0, 100, &s, &sampled);
        let cycle_one = evolved_seed(&seed, &at_one).unwrap();
        let cycle_two = evolved_seed(&seed, &at_two).unwrap();
        assert_eq!(cycle_one.events.len(), 8, "cycle one sampled its own floor");
        assert_eq!(
            cycle_two.events.len(),
            6,
            "cycle two keeps cycle one's prefix then ceiling 40% wins the crossed lanes"
        );
    }

    #[test]
    fn floor_normalization_can_articulate_a_sustain_to_reach_the_invariant() {
        let seed = compiled("[x _ _ .] . . .");
        let s = spans(4, 4);
        let mut normalized_inputs = inputs(7, 1, 0, 100, &s);
        normalized_inputs.density_floor = 100;
        normalized_inputs.density_ceiling = 100;
        let normalized = evolved_seed(&seed, &normalized_inputs).unwrap();
        assert_eq!(normalized.events.len(), 16);
        assert!(normalized
            .events
            .iter()
            .all(|event| event.dur == Rational::new(1, 4)));
        resolve_seed_cells(&normalized, 4, &s).expect("articulated floor remains projectable");
    }

    #[test]
    fn complexity_normalization_visits_each_original_onset_at_most_once() {
        let seed = CompiledSeed {
            total_beats: 2,
            required_subdivision: 12,
            events: vec![SeedEvent {
                start: Rational::new(1, 2),
                dur: Rational::new(1, 12),
                class: "x".to_string(),
            }],
        };
        let s = spans(2, 12);
        let mut rail_inputs = inputs(7, 1, 0, 100, &s);
        rail_inputs.cycle_beats = 2;
        let (ranks, _, _) = fold_env(2, 12);
        let mut work_budget = ComplexityNormalizationBudget::new();

        let (normalized, clamp) = normalize_to_complexity_corridor(
            &seed,
            &seed_state(&seed),
            &ranks,
            &rail_inputs,
            1,
            None,
            ComplexityCorridor {
                floor_milli: 100_000,
                ceiling_milli: 100_000,
            },
            &mut work_budget,
        );

        assert_eq!(normalized.onsets.len(), 1);
        assert_eq!(
            super::super::depth::onset_depth(normalized.onsets[0].slot, 12),
            420
        );
        assert_eq!(
            super::super::depth::state_complexity_milli(&state_slots(&normalized), 12),
            42_857,
            "one pass may take the first strict W=12 depth step, but must not revisit the moved onset"
        );
        assert_eq!(
            clamp,
            Some(ComplexityCorridorClamp {
                limit: ComplexityCorridorLimit::Floor,
                complexity_milli: 100_000,
            })
        );
    }

    #[test]
    fn complexity_normalization_does_not_overshoot_the_opposite_rail() {
        let seed = CompiledSeed {
            total_beats: 1,
            required_subdivision: 12,
            events: vec![SeedEvent {
                start: Rational::ZERO,
                dur: Rational::new(1, 12),
                class: "x".to_string(),
            }],
        };
        let s = spans(1, 12);
        let mut rail_inputs = inputs(7, 1, 0, 100, &s);
        rail_inputs.cycle_beats = 1;
        let (ranks, _, _) = fold_env(1, 12);
        let original = seed_state(&seed);
        let mut work_budget = ComplexityNormalizationBudget::new();

        let (normalized, clamp) = normalize_to_complexity_corridor(
            &seed,
            &original,
            &ranks,
            &rail_inputs,
            1,
            None,
            ComplexityCorridor {
                floor_milli: 10_000,
                ceiling_milli: 11_000,
            },
            &mut work_budget,
        );

        assert_eq!(
            normalized, original,
            "the cheapest promotion crosses the ceiling"
        );
        assert_eq!(
            clamp,
            Some(ComplexityCorridorClamp {
                limit: ComplexityCorridorLimit::Floor,
                complexity_milli: 10_000,
            }),
            "an unreachable narrow band stalls with truthful floor pressure"
        );
    }

    #[test]
    fn complexity_normalization_exits_after_one_scan_when_the_grid_is_fully_covered() {
        let seed = CompiledSeed {
            total_beats: 1,
            required_subdivision: 64,
            events: (0..64)
                .map(|slot| SeedEvent {
                    start: Rational::new(slot, 64),
                    dur: Rational::new(1, 64),
                    class: "x".to_string(),
                })
                .collect(),
        };
        let s = spans(1, 64);
        let mut rail_inputs = inputs(7, 1, 0, 100, &s);
        rail_inputs.cycle_beats = 1;
        let (ranks, _, _) = fold_env(1, 64);
        let original = seed_state(&seed);
        let mut work_budget = ComplexityNormalizationBudget { remaining: 129 };

        let (normalized, clamp) = normalize_to_complexity_corridor(
            &seed,
            &original,
            &ranks,
            &rail_inputs,
            1,
            None,
            ComplexityCorridor {
                floor_milli: 0,
                ceiling_milli: 0,
            },
            &mut work_budget,
        );

        assert_eq!(normalized, original);
        assert_eq!(
            work_budget.remaining, 1,
            "no silent target stops before candidate ordering or projection"
        );
        assert_eq!(
            clamp,
            Some(ComplexityCorridorClamp {
                limit: ComplexityCorridorLimit::Ceiling,
                complexity_milli: 0,
            }),
            "the early exit must still expose the unsatisfied ceiling"
        );
    }

    #[test]
    fn complexity_normalization_budget_bounds_a_stalled_w64_search() {
        let seed = CompiledSeed {
            total_beats: 1,
            required_subdivision: 64,
            events: (0..32)
                .map(|slot| SeedEvent {
                    start: Rational::new(slot * 2, 64),
                    dur: Rational::new(1, 64),
                    class: "x".to_string(),
                })
                .collect(),
        };
        let s = spans(1, 64);
        let mut rail_inputs = inputs(7, 1, 0, 100, &s);
        rail_inputs.cycle_beats = 1;
        rail_inputs.placement_bias = 100;
        let (ranks, _, _) = fold_env(1, 64);
        let original = seed_state(&seed);
        let mut work_budget = ComplexityNormalizationBudget { remaining: 31 };

        let (normalized, clamp) = normalize_to_complexity_corridor(
            &seed,
            &original,
            &ranks,
            &rail_inputs,
            1,
            None,
            ComplexityCorridor {
                floor_milli: 100_000,
                ceiling_milli: 100_000,
            },
            &mut work_budget,
        );

        assert_eq!(normalized, original);
        assert_eq!(
            work_budget.remaining, 31,
            "an unaffordable source scan is not partial"
        );
        assert_eq!(
            clamp,
            Some(ComplexityCorridorClamp {
                limit: ComplexityCorridorLimit::Floor,
                complexity_milli: 100_000,
            }),
            "budget exhaustion is a deterministic, truthful rail stall"
        );
    }

    #[test]
    fn cycle_10000_fully_covered_w64_complexity_stall_is_fold_bounded_and_truthful() {
        let seed = CompiledSeed {
            total_beats: 1,
            required_subdivision: 64,
            events: (0..64)
                .map(|slot| SeedEvent {
                    start: Rational::new(slot, 64),
                    dur: Rational::new(1, 64),
                    class: "x".to_string(),
                })
                .collect(),
        };
        let s = spans(1, 64);
        let mut rail_inputs = inputs(7, 10_000, 0, 100, &s);
        rail_inputs.cycle_beats = 1;
        rail_inputs.density_floor = 100;
        rail_inputs.density_ceiling = 100;
        rail_inputs.complexity_floor = 0;
        rail_inputs.complexity_ceiling = 0;

        let resolution = evolved_seed_with_trace(&seed, &rail_inputs).unwrap();

        assert_eq!(resolution.seed.events.len(), 64);
        assert!(resolution.state_complexity_milli > 0);
        assert_eq!(
            resolution
                .trace
                .last()
                .and_then(|entry| entry.complexity_corridor_clamp),
            Some(ComplexityCorridorClamp {
                limit: ComplexityCorridorLimit::Ceiling,
                complexity_milli: 0,
            }),
            "the requested-cycle trace keeps the unsatisfied rail visible"
        );
    }

    #[test]
    fn directive_corridor_overrides_globals_and_corridor_beats_plan_and_leash() {
        let seed = compiled("[x x x x] [x x x x] [x x x x] [x x x x]");
        let s = spans(4, 4);
        let mut remove = directive(1, 0, DirectiveFamily::BarlowRemove, 1, 1, 100);
        remove.options.density_floor = Some(75);
        remove.options.density_ceiling = Some(75);
        let plan = vec![remove];
        let mut plan_inputs = inputs(7, 1, 0, 0, &s);
        plan_inputs.plan = &plan;
        plan_inputs.density_floor = 0;
        plan_inputs.density_ceiling = 100;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolution.seed.events.len(), 12);
        assert_eq!(resolution.trace[0].requested, 12);
        assert_eq!(resolution.trace[0].applied, 0);
        assert_eq!(
            resolution.trace[0].corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Floor,
                density_percent: 75,
            })
        );
        assert_eq!(resolution.trace[0].skipped, DirectiveSkip::None);
    }

    #[test]
    fn central_candidate_guard_reports_projection_and_corridor_together() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let guard_inputs = inputs(7, 1, 0, 100, &s);
        let candidate = EvolutionState {
            onsets: vec![
                EvolvedOnset {
                    slot: 0,
                    dur: 2,
                    class: "x".to_string(),
                },
                EvolvedOnset {
                    slot: 1,
                    dur: 1,
                    class: "x".to_string(),
                },
                EvolvedOnset {
                    slot: 4,
                    dur: 1,
                    class: "x".to_string(),
                },
                EvolvedOnset {
                    slot: 8,
                    dur: 1,
                    class: "x".to_string(),
                },
                EvolvedOnset {
                    slot: 12,
                    dur: 1,
                    class: "x".to_string(),
                },
            ],
            rotation_beats: 0,
        };
        let failure = candidate_failure(
            &seed,
            &candidate,
            &guard_inputs,
            16,
            DensityCorridor::new(0, 25, 16),
            ComplexityCorridor {
                floor_milli: 0,
                ceiling_milli: 100_000,
            },
        )
        .expect("overlapping five-onset candidate violates both guards");
        assert_eq!(failure.skipped, DirectiveSkip::Projection);
        assert_eq!(
            failure.corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 25,
            })
        );
    }

    #[test]
    fn stochastic_normalization_clamp_does_not_hide_exhaustion() {
        let seed = compiled("[x x x x] [x x x x] [x x x x] [x x x x]");
        let s = spans(4, 4);
        let mut stochastic = directive(1, 0, DirectiveFamily::Stochastic, 1, 1, 100);
        stochastic.options.density_floor = Some(50);
        stochastic.options.density_ceiling = Some(50);
        let plan = vec![stochastic];
        let mut plan_inputs = inputs(7, 1, 0, 100, &s);
        plan_inputs.plan = &plan;
        plan_inputs.op_weights = OpWeights {
            barlow_remove: 0,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 0,
            consolidate: 0,
            euclid: 0,
        };
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolution.seed.events.len(), 8);
        assert_eq!(resolution.trace[0].skipped, DirectiveSkip::Exhausted);
        assert_eq!(
            resolution.trace[0].corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 50,
            })
        );
    }

    #[test]
    fn stochastic_operation_clamp_survives_a_later_leash_veto() {
        let seed = compiled("[x _ _ _ _ _ . .] [ka . ka .]");
        let s = spans(2, 8);
        let mut stochastic = directive(1, 0, DirectiveFamily::Stochastic, 1, 1, 100);
        stochastic.options.density_floor = Some(0);
        stochastic.options.density_ceiling = Some(25);
        let plan = vec![stochastic];
        let mut plan_inputs = inputs(7, 1, 0, 0, &s);
        plan_inputs.cycle_beats = 2;
        plan_inputs.plan = &plan;
        plan_inputs.op_weights = OpWeights {
            barlow_remove: 0,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 1,
            consolidate: 0,
            euclid: 0,
        };
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolution.seed, seed, "zero leash vetoes the fragment");
        assert_eq!(resolution.trace[0].skipped, DirectiveSkip::Exhausted);
        assert_eq!(
            resolution.trace[0].corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 25,
            }),
            "the earlier corridor reduction remains independently visible"
        );
    }

    proptest! {
        #[test]
        fn every_family_stays_inside_random_corridors_across_cycles(
            floor in 0_u32..=100,
            ceiling_hint in 0_u32..=100,
            complexity_floor in 0_u32..=100_000,
            complexity_ceiling_hint in 0_u32..=100_000,
            cycle in 1_u64..=12,
            seed_value in any::<u64>(),
        ) {
            let ceiling = ceiling_hint.max(floor);
            let complexity_ceiling = complexity_ceiling_hint.max(complexity_floor);
            let seed = compiled(SEED_TEXT);
            let s = spans(4, 4);
            for (index, family) in PLAN_FAMILIES.into_iter().enumerate() {
                let mut row = directive(index as u64 + 1, 0, family, 1, cycle, 100);
                row.options.density_floor = Some(floor);
                row.options.density_ceiling = Some(ceiling);
                row.options.complexity_floor = Some(complexity_floor);
                row.options.complexity_ceiling = Some(complexity_ceiling);
                let plan = vec![row];
                let mut plan_inputs = inputs(seed_value, cycle, 0, 100, &s);
                plan_inputs.plan = &plan;
                plan_inputs.op_weights = OpWeights {
                    barlow_remove: 1,
                    barlow_add: 1,
                    rotate: 1,
                    syncopate: 1,
                    desyncopate: 1,
                    fragment: 1,
                    consolidate: 1,
                    euclid: 1,
                };
                let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
                let count = resolution.seed.events.len();
                let corridor = DensityCorridor::new(floor, ceiling, 16);
                prop_assert!(
                    count >= corridor.floor_count && count <= corridor.ceiling_count,
                    "{family:?} emitted {count} outside {}..={}",
                    corridor.floor_count,
                    corridor.ceiling_count,
                );
                prop_assert_eq!(
                    evolved_seed_with_trace(&seed, &plan_inputs).unwrap().seed,
                    resolution.seed.clone(),
                    "{:?} replay diverged",
                    family,
                );
                let realized_complexity = super::super::depth::state_complexity_milli(
                    &state_slots(&seed_state(&resolution.seed)),
                    seed.required_subdivision,
                );
                let complexity_inside = realized_complexity >= complexity_floor
                    && realized_complexity <= complexity_ceiling;
                let truthful_stall = resolution.trace.iter().any(|entry| {
                    entry.complexity_corridor_clamp.as_ref().is_some_and(|clamp| {
                        (realized_complexity < complexity_floor
                            && clamp.limit == ComplexityCorridorLimit::Floor
                            && clamp.complexity_milli == complexity_floor)
                            || (realized_complexity > complexity_ceiling
                                && clamp.limit == ComplexityCorridorLimit::Ceiling
                                && clamp.complexity_milli == complexity_ceiling)
                    })
                });
                prop_assert!(
                    complexity_inside || truthful_stall,
                    "{family:?} emitted complexity {realized_complexity} outside {complexity_floor}..={complexity_ceiling} without a truthful stall clamp",
                );
            }
        }

        #[test]
        fn every_scoped_family_changes_only_scoped_onsets_and_stays_projectable_on_grouping_three(
            start_beat in 0_u32..4,
            len_hint in 1_u32..=4,
            intensity in 0_u32..=100,
            seed_value in any::<u64>(),
        ) {
            let len_beats = len_hint.min(4 - start_beat);
            let scope = super::super::plan::BeatRange {
                start_beat,
                len_beats,
            };
            let window = slot_range(Some(scope), 4, 4).unwrap().unwrap();
            let seed = compiled(SEED_TEXT);
            let before = onset_snapshot(&seed);
            let tile_spans = [3u32, 3, 3, 3, 3, 1]
                .iter()
                .enumerate()
                .map(|(index, &len)| GeneratorSpanInput {
                    span_id: index as u64 + 1,
                    span_len: len,
                    label: None,
                    section_index: Some(1),
                    subdivision: Some(4),
                })
                .collect::<Vec<_>>();

            for (index, family) in PLAN_FAMILIES.into_iter().enumerate() {
                let mut scoped = directive(
                    index as u64 + 1,
                    0,
                    family,
                    1,
                    1,
                    intensity,
                );
                scoped.scope = Some(scope);
                let plan = vec![scoped];
                let mut plan_inputs = inputs(seed_value, 1, 0, 100, &tile_spans);
                plan_inputs.plan = &plan;
                plan_inputs.op_weights = OpWeights {
                    barlow_remove: 1,
                    barlow_add: 1,
                    rotate: 1,
                    syncopate: 1,
                    desyncopate: 1,
                    fragment: 1,
                    consolidate: 1,
                    euclid: 1,
                };
                let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
                resolve_seed_cells(&resolution.seed, 4, &tile_spans)
                    .unwrap_or_else(|error| panic!("{family:?} broke Grouping-3: {error}"));

                let after = onset_snapshot(&resolution.seed);
                for changed in before.symmetric_difference(&after) {
                    prop_assert!(
                        window.contains_slot(changed.0),
                        "{family:?} changed onset {} outside {window:?}",
                        changed.0,
                    );
                }
            }
        }

        #[test]
        fn remove_range_applied_quota_tracks_error_diffusion(
            intensity in 0_u32..=100,
            cycles in 1_u64..=16,
        ) {
            let seed = compiled("[x x x x] [x x x x] [x x x x] [x x x x]");
            let s = spans(4, 4);
            let plan = vec![directive(
                1,
                0,
                DirectiveFamily::BarlowRemove,
                1,
                cycles,
                intensity,
            )];
            let mut previous_count = seed.events.len() as u64;
            let mut numerator = 0_u64;
            let mut applied_total = 0_u64;
            for cycle in 1..=cycles {
                let candidates = if previous_count > 1 { previous_count } else { 0 };
                let local_numerator = u64::from(intensity) * candidates;
                numerator += local_numerator;
                let mut plan_inputs = inputs(17, cycle, 0, 0, &s);
                plan_inputs.plan = &plan;
                let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
                let trace = &resolution.trace[0];
                prop_assert!(u64::from(trace.requested) <= local_numerator.div_ceil(100));
                prop_assert!(trace.applied <= trace.requested);
                applied_total += u64::from(trace.applied);
                previous_count -= u64::from(trace.applied);
                prop_assert_eq!(resolution.seed.events.len() as u64, previous_count);
            }
            prop_assert!(applied_total.abs_diff(numerator / 100) <= 1);
        }

        #[test]
        fn windowed_rotate_is_a_pure_cyclic_shift(
            start_beat in 0_u32..=2,
            len_hint in 2_u32..=4,
            mask in any::<u16>(),
        ) {
            let subdivision = 4;
            let len_beats = len_hint.min(4 - start_beat).max(2);
            let window = SlotRange {
                start: start_beat * subdivision,
                end: (start_beat + len_beats) * subdivision,
            };
            let mut onsets = (window.start..window.end)
                .filter(|slot| mask & (1 << (slot - window.start)) != 0)
                .map(|slot| EvolvedOnset {
                    slot,
                    dur: 1,
                    class: format!("x{slot}"),
                })
                .collect::<Vec<_>>();
            if onsets.is_empty() {
                onsets.push(EvolvedOnset {
                    slot: window.start,
                    dur: 1,
                    class: "x".to_string(),
                });
            }
            if window.start > 0 {
                onsets.push(EvolvedOnset {
                    slot: 0,
                    dur: 1,
                    class: "outside-before".to_string(),
                });
            }
            if window.end < 16 {
                onsets.push(EvolvedOnset {
                    slot: 15,
                    dur: 1,
                    class: "outside-after".to_string(),
                });
            }
            onsets.sort_by_key(|onset| onset.slot);
            let state = EvolutionState {
                onsets,
                rotation_beats: 3,
            };
            let earlier = windowed_rotate(
                &state,
                window,
                subdivision,
                RotateDirection::Earlier,
            )
            .expect("a multi-beat shift moves every scoped onset");
            let restored = windowed_rotate(
                &earlier,
                window,
                subdivision,
                RotateDirection::Later,
            )
            .expect("the inverse shift also moves");
            prop_assert_eq!(&restored, &state);
            prop_assert_eq!(earlier.rotation_beats, 3);
            let contained_or_unchanged = earlier.onsets.iter().all(|onset| {
                window.contains_slot(onset.slot)
                    || state.onsets.iter().any(|original| original == onset)
            });
            prop_assert!(contained_or_unchanged);
        }
    }

    #[test]
    fn trajectories_replay_and_diverge_by_seed() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let a1 = evolved_seed(&seed, &inputs(42, 40, 60, 60, &s)).unwrap();
        let a2 = evolved_seed(&seed, &inputs(42, 40, 60, 60, &s)).unwrap();
        assert_eq!(a1, a2, "byte-identical replay");
        let b = evolved_seed(&seed, &inputs(43, 40, 60, 60, &s)).unwrap();
        assert_ne!(a1, b, "another seed walks another path");
        assert_ne!(a1, seed, "sixty percent over forty cycles moved");
    }

    #[test]
    fn the_leash_bounds_add_remove_drift_for_every_cycle() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let seed_slots: Vec<u32> = seed_state(&seed).onsets.iter().map(|o| o.slot).collect();
        for leash in [0u32, 25, 50] {
            let budget = (leash * seed_slots.len() as u32).div_ceil(100);
            for cycle in 0..=64u64 {
                let evolved = evolved_seed(&seed, &inputs(9, cycle, 100, leash, &s)).unwrap();
                let unrotated: Vec<u32> = {
                    // Undo the rotation register by comparing onset COUNTS
                    // plus set distance at zero rotation: recompute the
                    // state directly for exactness.
                    let (ranks, template, beat_level) = fold_env(4, 4);
                    let mut state = seed_state(&seed);
                    for c in 1..=cycle {
                        state = step(
                            &seed,
                            &state,
                            &seed_slots,
                            &ranks,
                            &template,
                            beat_level,
                            &inputs(9, c, 100, leash, &s),
                            c,
                        )
                        .0;
                    }
                    state.onsets.iter().map(|o| o.slot).collect()
                };
                assert!(
                    symmetric_difference(&unrotated, &seed_slots) <= budget,
                    "leash {leash} broken at cycle {cycle}"
                );
                assert_eq!(evolved.total_beats, 4);
            }
        }
    }

    #[test]
    fn a_tightened_automated_leash_contracts_before_the_cycle_operator() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let seed_slots = state_slots(&seed_state(&seed));
        let (ranks, template, beat_level) = fold_env(4, 4);
        let automation: &GeneratorAutomationSampler<'_> = &|target, cycle, _| match target {
            DUMKA_EVOLUTION_RATE_TARGET => Some(100.0),
            DUMKA_DRIFT_LEASH_TARGET => Some(if cycle == 1 { 100.0 } else { 0.0 }),
            _ => None,
        };
        let inputs = inputs_with_automation(7, 2, 0, 25, &s, automation);

        let cycle_one = step(
            &seed,
            &seed_state(&seed),
            &seed_slots,
            &ranks,
            &template,
            beat_level,
            &inputs,
            1,
        )
        .0;
        assert_eq!(
            symmetric_difference(&state_slots(&cycle_one), &seed_slots),
            1,
            "seed 7 adds one onset under the open leash"
        );

        let cycle_two = step(
            &seed,
            &cycle_one,
            &seed_slots,
            &ranks,
            &template,
            beat_level,
            &inputs,
            2,
        )
        .0;
        assert_eq!(
            symmetric_difference(&state_slots(&cycle_two), &seed_slots),
            0,
            "the 0% leash contracts inherited drift before finalizing cycle two"
        );
        assert_eq!(
            evolved_seed(&seed, &inputs).unwrap(),
            state_to_compiled(&seed, &cycle_two)
        );
    }

    #[test]
    fn add_uses_the_post_normalization_state_for_its_wrapped_class() {
        let seed = compiled("a . b .");
        let s = spans(4, 1);
        let seed_slots = state_slots(&seed_state(&seed));
        let (ranks, template, beat_level) = fold_env(4, 1);
        let mut inherited = seed_state(&seed);
        inherited.onsets.remove(0);
        inherited.onsets.push(EvolvedOnset {
            slot: 3,
            dur: 1,
            class: "removed-by-leash".to_string(),
        });

        // The 50% leash first removes slot 3, leaving the seed onset at slot 0
        // missing. Seed 7's cycle-one Add restores that strongest empty slot.
        // Since it precedes every surviving onset, class selection wraps to
        // the last onset in the normalized state ("b"), not the removed one.
        let next = step(
            &seed,
            &inherited,
            &seed_slots,
            &ranks,
            &template,
            beat_level,
            &inputs(7, 1, 100, 50, &s),
            1,
        )
        .0;
        let restored = next
            .onsets
            .iter()
            .find(|onset| onset.slot == 0)
            .expect("Add restores slot zero");
        assert_eq!(restored.class, "b");
        assert!(next
            .onsets
            .iter()
            .all(|onset| onset.class != "removed-by-leash"));
    }

    #[test]
    fn displacement_only_policies_move_without_changing_density() {
        // Weights 0/0/0/4/4: only the Sioros pair fires. Onset count must
        // stay fixed (displacement never adds or removes), every cycle must
        // stay playable, and the trajectory must replay byte-identically.
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let displaced_only = |seed_value: u64, cycle: u64| {
            let mut inputs = inputs(seed_value, cycle, 100, 100, &s);
            inputs.op_weights = OpWeights {
                barlow_remove: 0,
                barlow_add: 0,
                rotate: 0,
                syncopate: 4,
                desyncopate: 4,
                fragment: 0,
                consolidate: 0,
                euclid: 0,
            };
            evolved_seed(&seed, &inputs).unwrap()
        };
        let mut moved = false;
        for cycle in 0..=48u64 {
            let evolved = displaced_only(11, cycle);
            assert_eq!(evolved.events.len(), seed.events.len(), "cycle {cycle}");
            resolve_seed_cells(&evolved, 4, &s)
                .unwrap_or_else(|e| panic!("cycle {cycle} unplayable: {e}"));
            if evolved != seed {
                moved = true;
            }
        }
        assert!(moved, "48 cycles at rate 100 must displace something");
        assert_eq!(displaced_only(11, 37), displaced_only(11, 37), "replay");
        assert_ne!(
            displaced_only(11, 37),
            displaced_only(12, 37),
            "another seed walks another displacement path"
        );
    }

    #[test]
    fn figure_only_policies_change_duration_structure_reversibly() {
        // Weights 0/0/0/0/0 + fragment 4 / consolidate 4: only the figure
        // pair fires. Total sounding duration is conserved by construction
        // (fragments tile their interval; merges sum theirs) unless a
        // silent run gets filled, so playability and replay are the load-
        // bearing assertions; duration-structure change is the feature.
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let figures_only = |seed_value: u64, cycle: u64| {
            let mut inputs = inputs(seed_value, cycle, 100, 100, &s);
            inputs.op_weights = OpWeights {
                barlow_remove: 0,
                barlow_add: 0,
                rotate: 0,
                syncopate: 0,
                desyncopate: 0,
                fragment: 4,
                consolidate: 4,
                euclid: 0,
            };
            inputs.fill_complexity = 60;
            evolved_seed(&seed, &inputs).unwrap()
        };
        let mut durations_changed = false;
        for cycle in 0..=48u64 {
            let evolved = figures_only(21, cycle);
            resolve_seed_cells(&evolved, 4, &s)
                .unwrap_or_else(|e| panic!("cycle {cycle} unplayable: {e}"));
            let seed_durs: Vec<_> = seed.events.iter().map(|e| e.dur).collect();
            let evolved_durs: Vec<_> = evolved.events.iter().map(|e| e.dur).collect();
            if evolved_durs != seed_durs {
                durations_changed = true;
            }
        }
        assert!(
            durations_changed,
            "48 cycles of figure ops must alter the duration structure"
        );
        assert_eq!(figures_only(21, 37), figures_only(21, 37), "replay");
    }

    #[test]
    fn fragmenting_a_sustain_is_leashed() {
        // One long note + leash 0: any fragmentation adds onsets off the
        // seed slots, so the leash must veto every figure and the seed
        // must survive verbatim at rate 100. The sustain lives inside one
        // beat, so the span fence is not what freezes it.
        let seed = compiled("[x _ _ _ _ _ . .] [ka . ka .]");
        let s = spans(2, 8);
        let mut inputs = inputs(31, 40, 100, 0, &s);
        inputs.cycle_beats = 2;
        inputs.op_weights = OpWeights {
            barlow_remove: 0,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 8,
            consolidate: 0,
            euclid: 0,
        };
        let evolved = evolved_seed(&seed, &inputs).unwrap();
        assert_eq!(evolved, seed, "leash 0 must freeze figure drift");
    }

    #[test]
    fn fill_complexity_widens_the_figure_size_pool_deterministically() {
        // At complexity 0 the k draw pool is exactly one candidate (the
        // simplest true tuplet), so every fired Fragment across seeds picks
        // the same k for a given interval; at 100 the pool spans all legal
        // sizes and some seed must diverge. The seed needs a real sustain
        // INSIDE one beat (the span fence must not be the limiter), and
        // one long enough that its k pool is not a singleton.
        let seed = compiled("[x _ _ _ _ _ . .] [ka . ka .]");
        let s = spans(2, 8);
        let run = |seed_value: u64, complexity: u32, cycle: u64| {
            let mut inputs = inputs(seed_value, cycle, 100, 100, &s);
            inputs.cycle_beats = 2;
            // Temperature 100 pools interval choice over every candidate;
            // at 0 the pick pins to the top-ranked interval, which may be
            // a 2-slot run whose k pool is a singleton at any complexity.
            inputs.barlow_temperature = 100;
            inputs.op_weights = OpWeights {
                barlow_remove: 0,
                barlow_add: 0,
                rotate: 0,
                syncopate: 0,
                desyncopate: 0,
                fragment: 1,
                consolidate: 0,
                euclid: 0,
            };
            inputs.fill_complexity = complexity;
            evolved_seed(&seed, &inputs).unwrap()
        };
        for cycle in [1u64, 2, 3] {
            assert_eq!(run(5, 0, cycle), run(5, 0, cycle), "replay at 0");
            assert_eq!(run(5, 100, cycle), run(5, 100, cycle), "replay at 100");
        }
        let mut diverged = false;
        'outer: for seed_value in 1..=40u64 {
            for cycle in 1..=4u64 {
                if run(seed_value, 100, cycle) != run(seed_value, 0, cycle) {
                    diverged = true;
                    break 'outer;
                }
            }
        }
        assert!(diverged, "complexity 100 must reach figure sizes 0 cannot");
    }

    #[test]
    fn euclid_only_policies_reshape_toward_evenness_and_replay() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let reshaped_only = |seed_value: u64, cycle: u64, invert: u32| {
            let mut inputs = inputs(seed_value, cycle, 100, 100, &s);
            inputs.op_weights = OpWeights {
                barlow_remove: 0,
                barlow_add: 0,
                rotate: 0,
                syncopate: 0,
                desyncopate: 0,
                fragment: 0,
                consolidate: 0,
                euclid: 4,
            };
            inputs.euclid_invert = invert;
            inputs.euclid_rest_policy = super::super::reshape::EuclidRestPolicy::Silent;
            evolved_seed(&seed, &inputs).unwrap()
        };
        let mut moved = false;
        for cycle in 0..=32u64 {
            let evolved = reshaped_only(13, cycle, 0);
            resolve_seed_cells(&evolved, 4, &s)
                .unwrap_or_else(|e| panic!("cycle {cycle} unplayable: {e}"));
            // Plain reshape preserves the onset count exactly.
            assert_eq!(evolved.events.len(), seed.events.len(), "cycle {cycle}");
            if evolved != seed {
                moved = true;
            }
        }
        assert!(
            moved,
            "32 cycles of reshape at rate 100 must move something"
        );
        assert_eq!(reshaped_only(13, 21, 0), reshaped_only(13, 21, 0), "replay");
        assert_ne!(
            reshaped_only(13, 21, 0),
            reshaped_only(14, 21, 0),
            "another seed rotates another way"
        );
    }

    #[test]
    fn inversion_is_leashed_like_any_density_change() {
        // Leash 0: an inverted window would flip k onsets to n−k, blowing
        // the zero budget, so rate 100 + invert 100 must freeze the seed.
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let mut inputs = inputs(17, 40, 100, 0, &s);
        inputs.op_weights = OpWeights {
            barlow_remove: 0,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 0,
            consolidate: 0,
            euclid: 8,
        };
        inputs.euclid_invert = 100;
        inputs.euclid_rest_policy = super::super::reshape::EuclidRestPolicy::Silent;
        let evolved = evolved_seed(&seed, &inputs).unwrap();
        assert_eq!(evolved, seed, "leash 0 must veto every inverted reshape");
    }

    fn curve(points: &[(u64, u32)], tolerance: u32, ops: u32) -> EvolutionCurve {
        EvolutionCurve {
            enabled: true,
            model_version: super::super::perceptual::PerceptualModelVersion::V1,
            tolerance_milli: tolerance,
            max_operations: ops,
            points: points
                .iter()
                .map(|&(cycle, target_milli)| super::super::plan::CurvePoint {
                    cycle,
                    target_milli,
                })
                .collect(),
        }
    }

    #[test]
    fn the_curve_owns_gap_cycles_and_suppresses_the_stochastic_layer() {
        // With the curve enabled, the legacy rate must be irrelevant on
        // directive-free cycles: rate 0 and rate 100 fold identically.
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let ramp = curve(&[(1, 1000), (12, 6000)], 500, 4);
        let resolve = |rate: u32, cycle: u64| {
            let mut inputs = inputs(21, cycle, rate, 100, &s);
            inputs.curve = &ramp;
            evolved_seed_with_trace(&seed, &inputs).expect("supported grid resolves")
        };
        for cycle in [1u64, 5, 9, 12] {
            assert_eq!(
                resolve(0, cycle).seed,
                resolve(100, cycle).seed,
                "cycle {cycle}: the stochastic layer fired under the curve"
            );
        }
        // Replay is byte-identical, and the trace attributes the curve.
        assert_eq!(resolve(0, 7).seed, resolve(0, 7).seed);
        let trace = resolve(0, 7).trace;
        assert_eq!(trace.len(), 1);
        assert_eq!(trace[0].directive_id, EVOLUTION_CURVE_TRACE_ID);
        let detail = trace[0].perceptual.expect("curve trace carries detail");
        assert_eq!(detail.target_milli, ramp.target_milli_at(7));
        // The realized distance is the whole-cycle readout by construction.
        assert_eq!(
            resolve(0, 7).cycle_distance.map(|d| d.distance_milli),
            Some(detail.actual_milli)
        );
    }

    #[test]
    fn outside_the_curve_span_the_state_repeats_verbatim() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let short = curve(&[(1, 4000), (6, 4000)], 500, 4);
        let resolve = |cycle: u64| {
            let mut inputs = inputs(33, cycle, 0, 100, &s);
            inputs.curve = &short;
            evolved_seed_with_trace(&seed, &inputs).expect("resolves")
        };
        let at_end = resolve(6);
        let beyond = resolve(9);
        assert_eq!(at_end.seed, beyond.seed, "post-curve cycles must hold");
        assert_eq!(beyond.cycle_distance.map(|d| d.distance_milli), Some(0));
        assert!(beyond.trace.is_empty(), "no curve entry outside the span");
    }

    #[test]
    fn zero_weights_leave_the_curve_exhausted_and_the_state_held() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let ramp = curve(&[(1, 4000), (8, 4000)], 500, 4);
        let mut inputs = inputs(5, 3, 0, 100, &s);
        inputs.curve = &ramp;
        inputs.op_weights = OpWeights {
            barlow_remove: 0,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 0,
            consolidate: 0,
            euclid: 0,
        };
        let resolved = evolved_seed_with_trace(&seed, &inputs).expect("resolves");
        assert_eq!(resolved.seed, seed, "no families to draw: hold verbatim");
        assert_eq!(resolved.trace.len(), 1);
        assert_eq!(resolved.trace[0].skipped, DirectiveSkip::Exhausted);
        assert_eq!(resolved.trace[0].applied, 0);
    }

    #[test]
    fn directive_cycles_defer_the_curve() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let ramp = curve(&[(1, 3000), (12, 3000)], 500, 4);
        let plan = vec![directive(1, 0, DirectiveFamily::BarlowRemove, 5, 5, 40)];
        let mut inputs5 = inputs(9, 5, 0, 100, &s);
        inputs5.plan = &plan;
        inputs5.curve = &ramp;
        let at_5 = evolved_seed_with_trace(&seed, &inputs5).expect("resolves");
        assert_eq!(at_5.trace.len(), 1, "only the directive traces at cycle 5");
        assert_eq!(at_5.trace[0].directive_id, 1);
    }

    #[test]
    fn whole_cycle_distance_matches_an_independent_two_fold_comparison() {
        // The calibration example: a BarlowRemove pin at cycle 13. The
        // readout must equal the v1 distance between the states two
        // separate folds reach at cycles 12 and 13 — proving the previous-
        // state capture inside the single fold is exact.
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let plan = vec![directive(1, 0, DirectiveFamily::BarlowRemove, 13, 13, 40)];
        let resolve = |cycle: u64| {
            let mut inputs = inputs(9, cycle, 0, 100, &s);
            inputs.plan = &plan;
            evolved_seed_with_trace(&seed, &inputs).expect("supported grid resolves")
        };
        let at_12 = resolve(12);
        let at_13 = resolve(13);
        let strata =
            stratification(seed.total_beats, seed.required_subdivision).expect("supported");
        let context = PerceptualContext::new(
            seed.total_beats,
            seed.required_subdivision,
            indispensability(&strata),
            metrical_levels(&strata),
        )
        .expect("context builds");
        let model = PerceptualModel::for_version(PerceptualModelVersion::V1);
        let direct = perceptual_distance(
            &evolution_state(&at_12.seed),
            &evolution_state(&at_13.seed),
            &context,
            &model,
        )
        .total_milli;
        assert!(direct > 0, "a 40% removal pin must be audible");
        assert_eq!(
            at_13.cycle_distance,
            Some(super::super::perceptual::PerceptualCycleDistance {
                model_version: PerceptualModelVersion::V1,
                distance_milli: direct,
            })
        );
        // The cycle after the pin repeats verbatim: honest zero.
        let at_14 = resolve(14);
        assert_eq!(
            at_14.cycle_distance.map(|d| d.distance_milli),
            Some(0),
            "a gap cycle after the pin sounds identical to cycle 13"
        );
    }

    #[test]
    fn whole_cycle_distance_edges_are_none_or_zero_by_contract() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        // Cycle 0 is the seed by definition: no predecessor, no readout.
        let inputs0 = inputs(9, 0, 0, 100, &s);
        assert_eq!(
            evolved_seed_with_trace(&seed, &inputs0)
                .expect("cycle 0 resolves")
                .cycle_distance,
            None
        );
        // Feature-off verbatim repeat at cycle 5: identical cycles score 0.
        let inputs5 = inputs(9, 5, 0, 100, &s);
        assert_eq!(
            evolved_seed_with_trace(&seed, &inputs5)
                .expect("verbatim resolves")
                .cycle_distance
                .map(|d| d.distance_milli),
            Some(0)
        );
    }

    #[test]
    fn zero_total_weights_freeze_the_pattern() {
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let mut inputs = inputs(7, 33, 100, 100, &s);
        inputs.op_weights = OpWeights {
            barlow_remove: 0,
            barlow_add: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 0,
            consolidate: 0,
            euclid: 0,
        };
        assert_eq!(evolved_seed(&seed, &inputs).unwrap(), seed);
    }

    #[test]
    fn temperature_widens_the_barlow_pool_deterministically() {
        // At temperature 0 the first fired Remove always takes the single
        // weakest onset; at 100 the pool spans every onset, so across many
        // seeds the removed slot must vary — while each individual
        // trajectory still replays byte-identically.
        let seed = compiled(SEED_TEXT);
        let s = spans(4, 4);
        let removed_slot = |seed_value: u64, temperature: u32| -> Option<u32> {
            let mut inputs = inputs(seed_value, 1, 100, 100, &s);
            inputs.barlow_temperature = temperature;
            inputs.op_weights = OpWeights {
                barlow_remove: 1,
                barlow_add: 0,
                rotate: 0,
                syncopate: 0,
                desyncopate: 0,
                fragment: 0,
                consolidate: 0,
                euclid: 0,
            };
            let evolved = evolved_seed(&seed, &inputs).unwrap();
            let seed_slots: std::collections::BTreeSet<i64> =
                seed.events.iter().map(|e| *e.start.numer()).collect();
            let evolved_slots: std::collections::BTreeSet<i64> =
                evolved.events.iter().map(|e| *e.start.numer()).collect();
            seed_slots
                .difference(&evolved_slots)
                .next()
                .map(|v| *v as u32)
        };

        let cold: std::collections::BTreeSet<Option<u32>> =
            (0..24u64).map(|sv| removed_slot(sv, 0)).collect();
        assert_eq!(cold.len(), 1, "temperature 0 is the strict Barlow order");
        let hot: std::collections::BTreeSet<Option<u32>> =
            (0..24u64).map(|sv| removed_slot(sv, 100)).collect();
        assert!(hot.len() > 1, "temperature 100 varies the removal");
        assert_eq!(removed_slot(9, 100), removed_slot(9, 100), "replay");
    }

    #[test]
    fn evolution_never_breaks_playback() {
        // A two-slot note at slots (0,1) is legal under Grouping-3 tiles
        // ([3,3,3,3,3,1] over the 16-slot grid), but rotating it two beats
        // lands it on slots (8,9) across the tile boundary at 9 — an
        // illegal candidate the trial projection must skip. Every cycle of
        // an aggressive walk must still resolve.
        let seed = compiled("[x _ . .] [x . x .] [x . x .] [x . x .]");
        let tile_spans: Vec<GeneratorSpanInput> = [3u32, 3, 3, 3, 3, 1]
            .iter()
            .enumerate()
            .map(|(i, &len)| GeneratorSpanInput {
                span_id: i as u64 + 1,
                span_len: len,
                label: None,
                section_index: Some(1),
                subdivision: Some(4),
            })
            .collect();
        resolve_seed_cells(&seed, 4, &tile_spans).expect("seed legal under tiles");
        for cycle in 0..=96u64 {
            let evolved = evolved_seed(&seed, &inputs(1234, cycle, 100, 100, &tile_spans)).unwrap();
            resolve_seed_cells(&evolved, 4, &tile_spans)
                .unwrap_or_else(|e| panic!("cycle {cycle} unplayable: {e}"));
        }
        // The same walk against plain per-beat spans keeps the beat-aligned
        // guard honest too.
        let beat_spans = spans(4, 4);
        for cycle in 0..=96u64 {
            let evolved = evolved_seed(&seed, &inputs(1234, cycle, 100, 100, &beat_spans)).unwrap();
            resolve_seed_cells(&evolved, 4, &beat_spans)
                .unwrap_or_else(|e| panic!("cycle {cycle} unplayable on beats: {e}"));
        }
    }

    #[test]
    fn unsupported_prime_grids_without_a_corridor_fall_back_to_the_seed() {
        // Eleven beats: prime 11 exceeds the published Barlow tables.
        let seed = compiled(&"x ".repeat(11));
        let s = spans(11, 1);
        let mut inputs11 = inputs(7, 12, 100, 100, &s);
        inputs11.cycle_beats = 11;
        assert_eq!(evolved_seed(&seed, &inputs11), None);
    }

    #[test]
    fn unsupported_prime_grid_enforces_an_active_global_corridor_deterministically() {
        // The metric operator tables intentionally stop at prime 7, but a
        // corridor is a fold invariant rather than an optional operator.
        let seed = compiled(&"x ".repeat(11));
        let s = spans(11, 1);
        let mut inputs11 = inputs(7, 1, 0, 100, &s);
        inputs11.cycle_beats = 11;
        inputs11.density_ceiling = 50;

        let resolution = evolved_seed_with_trace(&seed, &inputs11)
            .expect("an active corridor supplies the positional fallback");
        assert_eq!(
            resolution.density_corridor,
            DensityCorridorRange {
                floor: 0,
                ceiling: 50,
            }
        );
        assert_eq!(
            state_slots(&seed_state(&resolution.seed)),
            vec![0, 1, 2, 3, 4],
            "the stable positional rank keeps the first five of eleven slots"
        );
        assert_eq!(resolution.trace.len(), 1);
        assert_eq!(resolution.trace[0].directive_id, LEGACY_EVOLUTION_TRACE_ID);
        assert_eq!(resolution.trace[0].requested, 0);
        assert_eq!(resolution.trace[0].applied, 0);
        assert_eq!(resolution.trace[0].skipped, DirectiveSkip::None);
        assert_eq!(
            resolution.trace[0].corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 50,
            })
        );
        assert_eq!(
            evolved_seed_with_trace(&seed, &inputs11).unwrap().seed,
            resolution.seed,
            "unsupported-grid fallback must replay byte-identically"
        );
    }

    #[test]
    fn unsupported_prime_grid_honors_an_active_directive_override() {
        let seed = compiled(&"x ".repeat(11));
        let s = spans(11, 1);
        let mut row = directive(91, 0, DirectiveFamily::Rotate, 1, 1, 100);
        row.options.density_floor = Some(36);
        row.options.density_ceiling = Some(45);
        let plan = vec![row];
        let mut inputs11 = inputs(7, 1, 0, 100, &s);
        inputs11.cycle_beats = 11;
        inputs11.plan = &plan;

        let resolution = evolved_seed_with_trace(&seed, &inputs11)
            .expect("the directive corridor activates the positional fallback");
        assert_eq!(resolution.seed.events.len(), 4);
        assert_eq!(
            resolution.density_corridor,
            DensityCorridorRange {
                floor: 36,
                ceiling: 45,
            }
        );
        assert_eq!(resolution.trace.len(), 1);
        assert_eq!(resolution.trace[0].directive_id, 91);
        assert_eq!(
            resolution.trace[0].corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 45,
            })
        );
    }

    #[test]
    fn unsupported_prime_grid_ignores_disabled_and_future_corridor_overrides() {
        let seed = compiled(&"x ".repeat(11));
        let s = spans(11, 1);
        let mut disabled = directive(91, 0, DirectiveFamily::Rotate, 1, 1, 100);
        disabled.enabled = false;
        disabled.options.density_floor = Some(36);
        disabled.options.density_ceiling = Some(45);
        let mut future = directive(92, 1, DirectiveFamily::Rotate, 2, 2, 100);
        future.options.density_floor = Some(36);
        future.options.density_ceiling = Some(45);
        let plan = vec![disabled, future];
        let mut inputs11 = inputs(7, 1, 0, 100, &s);
        inputs11.cycle_beats = 11;
        inputs11.plan = &plan;

        assert!(
            evolved_seed_with_trace(&seed, &inputs11).is_none(),
            "inactive overrides do not opt an unsupported grid into fallback"
        );
        inputs11.cycle = 0;
        let cycle_zero = evolved_seed_with_trace(&seed, &inputs11)
            .expect("cycle zero is always the exact authored seed");
        assert_eq!(cycle_zero.seed, seed);
        assert!(cycle_zero.trace.is_empty());
    }

    #[test]
    fn authored_pin_rebases_the_leash_for_later_stochastic_gaps() {
        let seed = compiled(&"[x x x x] ".repeat(4));
        let s = spans(4, 4);
        let plan = vec![directive(401, 0, DirectiveFamily::BarlowRemove, 1, 1, 25)];
        let resolve = |cycle| {
            let mut plan_inputs = inputs(17, cycle, 100, 0, &s);
            plan_inputs.plan = &plan;
            // Cycle two still runs leash normalization, but no stochastic
            // family obscures which state the leash considers authored.
            plan_inputs.op_weights = OpWeights {
                barlow_remove: 0,
                barlow_add: 0,
                rotate: 0,
                syncopate: 0,
                desyncopate: 0,
                fragment: 0,
                consolidate: 0,
                euclid: 0,
            };
            evolved_seed_with_trace(&seed, &plan_inputs).unwrap().seed
        };
        let pinned = resolve(1);
        assert_ne!(pinned, seed, "the authored pin changes the pattern");
        assert_eq!(
            resolve(2),
            pinned,
            "zero leash measures stochastic drift from persistent authored state"
        );
    }

    #[test]
    fn disabled_and_future_rows_do_not_change_legacy_gap_semantics() {
        let seed = compiled(&"[x x x x] ".repeat(4));
        let s = spans(4, 4);
        let automation: &GeneratorAutomationSampler<'_> = &|target, cycle, fallback| match target {
            DUMKA_EVOLUTION_RATE_TARGET => Some(if cycle == 1 { 100.0 } else { 0.0 }),
            DUMKA_DRIFT_LEASH_TARGET => Some(if cycle == 1 { 100.0 } else { 0.0 }),
            _ => Some(fallback),
        };
        let mut disabled = directive(402, 0, DirectiveFamily::Rotate, 1, 1, 100);
        disabled.enabled = false;
        let future = directive(403, 1, DirectiveFamily::Rotate, 10, 10, 100);
        let irrelevant = vec![disabled, future];

        let resolve = |plan: &[EvolutionDirective]| {
            let mut gap_inputs = inputs_with_automation(7, 2, 0, 100, &s, automation);
            gap_inputs.plan = plan;
            gap_inputs.op_weights = OpWeights {
                barlow_remove: 1,
                barlow_add: 0,
                rotate: 0,
                syncopate: 0,
                desyncopate: 0,
                fragment: 0,
                consolidate: 0,
                euclid: 0,
            };
            evolved_seed_with_trace(&seed, &gap_inputs).unwrap().seed
        };
        let empty = resolve(&[]);
        assert_eq!(empty, seed, "cycle-two leash contracts the cycle-one drift");
        assert_eq!(resolve(&irrelevant), empty);
    }

    #[test]
    fn scoped_remove_and_sioros_candidates_own_the_full_sounding_interval() {
        let seed = compiled("[x . . .] [x . . .]");
        let (ranks, template, beat_level) = fold_env(2, 4);
        let crossing = EvolutionState {
            onsets: vec![
                EvolvedOnset {
                    slot: 3,
                    dur: 2,
                    class: "x".to_string(),
                },
                EvolvedOnset {
                    slot: 6,
                    dur: 1,
                    class: "x".to_string(),
                },
            ],
            rotation_beats: 0,
        };
        let first_beat = Some(SlotRange { start: 0, end: 4 });
        let remove = directive(404, 0, DirectiveFamily::BarlowRemove, 1, 1, 100);
        assert_eq!(
            directive_candidate_count(
                &remove, &crossing, &seed, &ranks, &template, beat_level, first_beat,
            ),
            0,
            "an onset inside the beat cannot remove a sustain that exits it"
        );

        let sioros_template = metrical_levels(&[2, 2, 2]);
        let sustained = EvolutionState {
            onsets: vec![EvolvedOnset {
                slot: 3,
                dur: 5,
                class: "x".to_string(),
            }],
            rotation_beats: 0,
        };
        assert!(legal_desyncopations(&[3], &sioros_template, 1, None).contains(&4));
        assert!(
            !scoped_legal_desyncopations(
                &sustained,
                &sioros_template,
                1,
                Some(SlotRange { start: 0, end: 8 }),
            )
            .contains(&4),
            "the landing attack is inside, but its preserved duration exits the scope"
        );
    }

    #[test]
    fn scoped_rotate_rejects_a_post_rotation_interval_escape() {
        let state = EvolutionState {
            onsets: vec![EvolvedOnset {
                slot: 2,
                dur: 6,
                class: "x".to_string(),
            }],
            rotation_beats: 0,
        };
        assert!(windowed_rotate(
            &state,
            SlotRange { start: 0, end: 8 },
            4,
            RotateDirection::Later,
        )
        .is_none());
    }

    #[test]
    fn stalled_density_normalization_still_reports_the_active_rail() {
        let unchanged = EvolutionState {
            onsets: (0..5)
                .map(|slot| EvolvedOnset {
                    slot,
                    dur: 1,
                    class: "x".to_string(),
                })
                .collect(),
            rotation_beats: 0,
        };
        assert_eq!(
            normalization_clamp(&unchanged, &unchanged, DensityCorridor::new(0, 50, 8),),
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 50,
            })
        );
    }

    #[test]
    fn zero_intensity_directive_still_applies_its_density_corridor() {
        let seed = compiled(&"[x x x x] ".repeat(4));
        let s = spans(4, 4);
        let mut hold = directive(405, 0, DirectiveFamily::BarlowRemove, 1, 1, 0);
        hold.options.density_floor = Some(50);
        hold.options.density_ceiling = Some(50);
        let plan = vec![hold];
        let mut plan_inputs = inputs(7, 1, 0, 0, &s);
        plan_inputs.plan = &plan;
        let resolution = evolved_seed_with_trace(&seed, &plan_inputs).unwrap();
        assert_eq!(resolution.seed.events.len(), 8);
        assert_eq!(
            (resolution.trace[0].requested, resolution.trace[0].applied),
            (0, 0)
        );
        assert_eq!(
            resolution.trace[0].corridor_clamp,
            Some(DensityCorridorClamp {
                limit: DensityCorridorLimit::Ceiling,
                density_percent: 50,
            })
        );
    }

    #[test]
    fn unsupported_grid_preflight_distinguishes_active_evolution_from_feature_off() {
        let seed = compiled(&"x ".repeat(11));
        let s = spans(11, 1);
        let mut off = inputs(7, 1, 0, 100, &s);
        off.cycle_beats = 11;
        assert_eq!(validate_evolution_grid(&seed, &off), Ok(()));

        let mut legacy = inputs(7, 1, 100, 100, &s);
        legacy.cycle_beats = 11;
        assert!(matches!(
            validate_evolution_grid(&seed, &legacy),
            Err(GeneratorError::DumkaPlanInvalid { message })
                if message.starts_with("legacy evolution")
        ));

        let quota_plan = vec![directive(406, 0, DirectiveFamily::Rotate, 1, 1, 100)];
        let mut quota = inputs(7, 1, 0, 100, &s);
        quota.cycle_beats = 11;
        quota.plan = &quota_plan;
        assert!(matches!(
            validate_evolution_grid(&seed, &quota),
            Err(GeneratorError::DumkaPlanInvalid { message })
                if message.starts_with("directive 406 operation quota")
        ));

        let curve = EvolutionCurve {
            enabled: true,
            model_version: PerceptualModelVersion::V1,
            tolerance_milli: 500,
            max_operations: 4,
            points: vec![super::super::plan::CurvePoint {
                cycle: 1,
                target_milli: 1_000,
            }],
        };
        let mut curved = inputs(7, 1, 0, 100, &s);
        curved.cycle_beats = 11;
        curved.curve = &curve;
        assert!(matches!(
            validate_evolution_grid(&seed, &curved),
            Err(GeneratorError::DumkaPlanInvalid { message })
                if message.starts_with("curve targets")
        ));

        let mut disabled = directive(407, 0, DirectiveFamily::Rotate, 1, 1, 100);
        disabled.enabled = false;
        let future = directive(408, 1, DirectiveFamily::Rotate, 2, 2, 100);
        let inactive = vec![disabled, future];
        off.plan = &inactive;
        assert_eq!(validate_evolution_grid(&seed, &off), Ok(()));
    }

    #[test]
    fn barlow_order_thins_the_weakest_pulses_first() {
        // Full 16-grid at rate 100 with only Remove possible: force by
        // starting from an all-onset pattern and a leash that permits it.
        let seed = compiled(&"[x x x x] ".repeat(4));
        let s = spans(4, 4);
        let (ranks, template, beat_level) = fold_env(4, 4);
        let seed_slots: Vec<u32> = (0..16).collect();
        let mut state = seed_state(&seed);
        // Apply Remove directly three times through step() by scanning
        // cycles until three removals happened; verify each removal took
        // the weakest remaining slot.
        let mut removed: Vec<u32> = Vec::new();
        let mut cycle = 1u64;
        while removed.len() < 3 && cycle < 200 {
            let next = step(
                &seed,
                &state,
                &seed_slots,
                &ranks,
                &template,
                beat_level,
                &inputs(5, cycle, 100, 100, &s),
                cycle,
            )
            .0;
            if next.onsets.len() < state.onsets.len() {
                let removed_slot = state
                    .onsets
                    .iter()
                    .find(|o| !next.onsets.iter().any(|n| n.slot == o.slot))
                    .map(|o| o.slot)
                    .unwrap();
                let weakest = state
                    .onsets
                    .iter()
                    .map(|o| ranks[o.slot as usize])
                    .min()
                    .unwrap();
                assert_eq!(ranks[removed_slot as usize], weakest);
                removed.push(removed_slot);
            }
            state = next;
            cycle += 1;
        }
        assert_eq!(removed.len(), 3, "three removals observed");
    }
}
