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
use super::plan::{
    active_directives, pin_quota, rotate_pin_quota, slot_range, DensityCorridorClamp,
    DensityCorridorLimit, DirectiveFamily, DirectivePacing, DirectiveSkip, DirectiveTraceEntry,
    EvolutionDirective, RangeAccumulator, RotateDirection, SlotRange,
};
use super::sioros::{
    desyncopate_at, legal_desyncopations, legal_syncopations, metrical_levels, syncopation_target,
};
use super::tree::{CompiledSeed, SeedEvent};
use super::{
    DUMKA_BARLOW_TEMPERATURE_TARGET, DUMKA_DENSITY_CEILING_TARGET, DUMKA_DENSITY_FLOOR_TARGET,
    DUMKA_DRIFT_LEASH_TARGET, DUMKA_EVOLUTION_RATE_TARGET, DUMKA_FILL_COMPLEXITY_TARGET,
};
use crate::generators::{GeneratorAutomationSampler, GeneratorSpanInput};
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
/// Euclid reshape's rotation draw (0..window len).
const SALT_EUCLID_ROT: u64 = 0xD0A1_5EED_0008_0008;
/// Euclid reshape's inversion chance (0..100 against euclidInvert).
const SALT_EUCLID_INV: u64 = 0xD0A1_5EED_0009_0009;
const SALT_PLAN: u64 = 0xD0A1_5EED_0010_0010;

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
    /// Authored fallback for the Barlow candidate-pool temperature; the
    /// automation lane is sampled at each folded cycle like rate and leash.
    pub barlow_temperature: u32,
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
    /// Authored only (no automation lane yet, documented).
    pub op_weights: OpWeights,
    pub automation: &'a GeneratorAutomationSampler<'a>,
    pub spans: &'a [GeneratorSpanInput],
    pub cycle_beats: u32,
}

fn seed_state(seed: &CompiledSeed) -> EvolutionState {
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
}

fn sampled_density_corridor(
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    slots: u32,
) -> DensityCorridor {
    let sampled_floor = sampled_percent(
        inputs,
        DUMKA_DENSITY_FLOOR_TARGET,
        inputs.density_floor,
        cycle,
    );
    let sampled_ceiling = sampled_percent(
        inputs,
        DUMKA_DENSITY_CEILING_TARGET,
        inputs.density_ceiling,
        cycle,
    );
    // Two automation lanes are independent and can cross between authored
    // points. Playback never fails for that transient: the ceiling remains
    // the hard cap and the effective floor contracts to meet it.
    DensityCorridor::new(sampled_floor.min(sampled_ceiling), sampled_ceiling, slots)
}

fn directive_density_corridor(
    directive: &EvolutionDirective,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    slots: u32,
) -> DensityCorridor {
    match (
        directive.options.density_floor,
        directive.options.density_ceiling,
    ) {
        (Some(floor), Some(ceiling)) => DensityCorridor::new(floor, ceiling, slots),
        _ => sampled_density_corridor(inputs, cycle, slots),
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

fn state_slots(state: &EvolutionState) -> Vec<u32> {
    state.onsets.iter().map(|onset| onset.slot).collect()
}

fn state_is_projectable(
    seed: &CompiledSeed,
    state: &EvolutionState,
    inputs: &EvolutionInputs<'_>,
) -> bool {
    let projected = state_to_compiled(seed, state);
    super::tree::resolve_seed_cells(&projected, inputs.cycle_beats, inputs.spans).is_ok()
}

/// Bring inherited state into the active density corridor before this
/// cycle's operators run. Contraction removes weakest onsets first;
/// expansion adds strongest genuinely silent pulses first. Every individual
/// edit is trial-projected, giving normalization the same playability fence
/// as ordinary evolution while keeping the choice equivalent to temperature
/// zero (no draw-order-dependent randomness).
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
        let occupied = occupied_slots(&current, slots);
        let mut strongest = (0..slots)
            .filter(|slot| !occupied[*slot as usize])
            .collect::<Vec<_>>();
        strongest.sort_by_key(|&slot| (std::cmp::Reverse(ranks[slot as usize]), slot));
        let mut changed = false;
        for slot in strongest {
            let mut candidate = current.clone();
            let insert_at = candidate.onsets.partition_point(|onset| onset.slot < slot);
            candidate.onsets.insert(
                insert_at,
                EvolvedOnset {
                    slot,
                    dur: 1,
                    class: fill_class_before(&current, slot),
                },
            );
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

/// Tightening an automated leash must not leave an inherited state outside
/// the new bound. Undo added onsets first (weakest first), then restore missing
/// seed onsets (strongest first), trial-projecting every change. This is
/// deterministic constraint normalization, not the cycle's stochastic op.
fn normalize_to_leash(
    seed: &CompiledSeed,
    state: &EvolutionState,
    seed_slots: &[u32],
    ranks: &[u32],
    inputs: &EvolutionInputs<'_>,
    budget: u32,
) -> EvolutionState {
    if symmetric_difference(&state_slots(state), seed_slots) <= budget {
        return state.clone();
    }

    let mut current = state.clone();
    let mut added_slots = current
        .onsets
        .iter()
        .map(|onset| onset.slot)
        .filter(|slot| seed_slots.binary_search(slot).is_err())
        .collect::<Vec<_>>();
    added_slots.sort_by_key(|&slot| (ranks[slot as usize], slot));
    for slot in added_slots {
        if symmetric_difference(&state_slots(&current), seed_slots) <= budget {
            return current;
        }
        let mut candidate = current.clone();
        candidate.onsets.retain(|onset| onset.slot != slot);
        if state_is_projectable(seed, &candidate, inputs) {
            current = candidate;
        }
    }

    let initial_seed_state = seed_state(seed);
    let current_slots = state_slots(&current);
    let mut missing_onsets = initial_seed_state
        .onsets
        .into_iter()
        .filter(|onset| current_slots.binary_search(&onset.slot).is_err())
        .collect::<Vec<_>>();
    missing_onsets.sort_by(|a, b| {
        ranks[b.slot as usize]
            .cmp(&ranks[a.slot as usize])
            .then_with(|| a.slot.cmp(&b.slot))
    });
    for onset in missing_onsets {
        if symmetric_difference(&state_slots(&current), seed_slots) <= budget {
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

    if symmetric_difference(&state_slots(&current), seed_slots) <= budget {
        return current;
    }

    // A changed span layout can make an otherwise valid partial restoration
    // impossible at the retained rotation. Prefer the exact seed at that
    // rotation, then the unrotated seed. If even the authored seed is invalid
    // on the supplied spans, returning it makes final projection report the
    // existing structure mismatch instead of emitting an over-budget state.
    let mut fallback = seed_state(seed);
    fallback.rotation_beats = state.rotation_beats;
    if state_is_projectable(seed, &fallback, inputs) {
        return fallback;
    }
    fallback.rotation_beats = 0;
    fallback
}

#[allow(clippy::too_many_arguments)] // fold environment; same precedent as apply_generator_to_tree
fn step(
    seed: &CompiledSeed,
    state: &EvolutionState,
    seed_slots: &[u32],
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
) -> EvolutionState {
    step_scoped(
        seed, seed_slots, state, ranks, template, beat_level, inputs, cycle, None,
    )
}

#[allow(clippy::too_many_arguments)]
fn step_scoped(
    seed: &CompiledSeed,
    seed_slots: &[u32],
    state: &EvolutionState,
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    window: Option<SlotRange>,
) -> EvolutionState {
    let drift_leash = sampled_percent(inputs, DUMKA_DRIFT_LEASH_TARGET, inputs.drift_leash, cycle);
    let budget = (drift_leash * seed_slots.len() as u32).div_ceil(100);
    let leashed = normalize_to_leash(seed, state, seed_slots, ranks, inputs, budget);
    let slots = seed.total_beats * seed.required_subdivision;
    let corridor = sampled_density_corridor(inputs, cycle, slots);
    // Corridor > leash: when the two constraints disagree, normalize the
    // leash first and leave the corridor as the final inherited-state rail.
    let current = normalize_to_density_corridor(seed, &leashed, ranks, inputs, corridor);

    let evolution_rate = sampled_percent(
        inputs,
        DUMKA_EVOLUTION_RATE_TARGET,
        inputs.evolution_rate,
        cycle,
    );
    if evolution_rate == 0
        || draw(inputs.seed_value, cycle, SALT_FIRE, 100) >= u64::from(evolution_rate)
    {
        return current;
    }

    let Some(op) = drawn_op(&inputs.op_weights, inputs.seed_value, cycle) else {
        return current;
    };
    let temperature = sampled_percent(
        inputs,
        DUMKA_BARLOW_TEMPERATURE_TARGET,
        inputs.barlow_temperature,
        cycle,
    );

    let mut candidate = current.clone();
    match op {
        Op::Remove => {
            if current.onsets.len() <= 1 {
                return current;
            }
            // Weakest-first candidate order; the temperature pool widens
            // toward uniform. Ranks are a permutation, so index 0 at
            // temperature 0 is exactly the historical argmin.
            let mut order: Vec<usize> = (0..current.onsets.len()).collect();
            order.retain(|&index| {
                window.map_or(true, |window| {
                    window.contains_slot(current.onsets[index].slot)
                })
            });
            if order.is_empty() {
                return current;
            }
            order.sort_by_key(|&index| {
                (
                    ranks[current.onsets[index].slot as usize],
                    current.onsets[index].slot,
                )
            });
            let pick = pool_pick(order.len(), temperature, inputs.seed_value, cycle);
            candidate.onsets.remove(order[pick]);
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
            silent.sort_by_key(|&slot| (std::cmp::Reverse(ranks[slot as usize]), slot));
            if silent.is_empty() {
                return current;
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
                    return current;
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
            let vectors = legal_syncopations(&onset_slots, template, beat_level, window);
            if vectors.is_empty() {
                return current;
            }
            let vector = vectors[draw(
                inputs.seed_value,
                cycle,
                SALT_SYNC_PICK,
                vectors.len() as u64,
            ) as usize];
            let Some(landing) = syncopation_target(&onset_slots, template, vector, beat_level)
            else {
                return current;
            };
            move_onset(&mut candidate, vector.pulse, landing);
        }
        Op::Desyncopate => {
            let onset_slots = state_slots(&current);
            let pulses = legal_desyncopations(&onset_slots, template, beat_level, window);
            if pulses.is_empty() {
                return current;
            }
            let pulse = pulses[draw(
                inputs.seed_value,
                cycle,
                SALT_DESYNC_PICK,
                pulses.len() as u64,
            ) as usize];
            let Some((source, _vector)) = desyncopate_at(&onset_slots, template, pulse, beat_level)
            else {
                return current;
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
                return current;
            }
            let interval =
                intervals[pool_pick(intervals.len(), temperature, inputs.seed_value, cycle)];
            let mut ks = super::figures::k_candidates(interval.len);
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
                return current;
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
                return current;
            }
            let mut run = runs[pool_pick(runs.len(), temperature, inputs.seed_value, cycle)];
            let removable = current.onsets.len().saturating_sub(corridor.floor_count);
            if removable == 0 {
                return current;
            }
            run.count = run.count.min(removable.saturating_add(1));
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
                return current;
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
                return current;
            };
            candidate = reshaped;
        }
    }

    // Density is the primary authored invariant, including for plan-exempt
    // families and inverted Euclid jumps. Count-preserving operators pass
    // this check without changing their historical trajectory.
    if corridor.clamp_for(candidate.onsets.len()).is_some() {
        return current;
    }

    // Sustained notes can overlap after a displacement; the projector would
    // silently swallow the overlapped onset, so skip instead.
    if matches!(
        op,
        Op::Syncopate | Op::Desyncopate | Op::Fragment | Op::Consolidate | Op::Euclid
    ) && !state_intervals_disjoint(&candidate, slots)
    {
        return current;
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
        if symmetric_difference(&candidate_slots, seed_slots) > budget {
            return current;
        }
    }

    // Trial projection: an op that would make the pattern unplayable on the
    // actual spans is skipped for this cycle.
    let projected = state_to_compiled(seed, &candidate);
    if super::tree::resolve_seed_cells(&projected, inputs.cycle_beats, inputs.spans).is_err() {
        return current;
    }

    candidate
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
            onset.slot = window.start + rotated;
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
            .filter(|onset| window.map_or(true, |window| window.contains_slot(onset.slot)))
            .count()
            .saturating_sub(usize::from(state.onsets.len() <= 1)),
        DirectiveFamily::BarlowAdd => {
            let occupied = occupied_slots(state, slots);
            (0..slots)
                .filter(|slot| !occupied[*slot as usize])
                .filter(|slot| window.map_or(true, |window| window.contains_slot(*slot)))
                .count()
        }
        DirectiveFamily::Rotate => match window {
            Some(window) => usize::try_from(window.len() / seed.required_subdivision).unwrap_or(0),
            None => usize::try_from(seed.total_beats).unwrap_or(0),
        },
        DirectiveFamily::Syncopate => {
            legal_syncopations(&state_slots(state), template, beat_level, window).len()
        }
        DirectiveFamily::Desyncopate => {
            legal_desyncopations(&state_slots(state), template, beat_level, window).len()
        }
        DirectiveFamily::Fragment => {
            super::figures::ranked_fragment_intervals(state, slots, ranks, window).len()
        }
        DirectiveFamily::Consolidate => {
            super::figures::ranked_consolidate_runs(state, ranks, window).len()
        }
        DirectiveFamily::Euclid => super::reshape::ranked_reshape_windows(
            state,
            seed.total_beats,
            seed.required_subdivision,
            ranks,
            window,
        )
        .len(),
        DirectiveFamily::Stochastic => 1,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DirectiveApplyError {
    Skip(DirectiveSkip),
    Corridor(DensityCorridorClamp),
}

impl From<DirectiveSkip> for DirectiveApplyError {
    fn from(skip: DirectiveSkip) -> Self {
        Self::Skip(skip)
    }
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
) -> Result<EvolutionState, DirectiveApplyError> {
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
    let mut candidate = state.clone();
    match directive.family {
        DirectiveFamily::BarlowRemove => {
            if state.onsets.len() <= 1 {
                return Err(DirectiveSkip::Exhausted.into());
            }
            let mut order = state
                .onsets
                .iter()
                .enumerate()
                .filter(|(_, onset)| window.map_or(true, |window| window.contains_slot(onset.slot)))
                .map(|(index, _)| index)
                .collect::<Vec<_>>();
            order.sort_by_key(|&index| {
                (
                    ranks[state.onsets[index].slot as usize],
                    state.onsets[index].slot,
                )
            });
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
            candidate.onsets.remove(order[pick]);
        }
        DirectiveFamily::BarlowAdd => {
            let occupied = occupied_slots(state, slots);
            let mut silent = (0..slots)
                .filter(|slot| !occupied[*slot as usize])
                .filter(|slot| window.map_or(true, |window| window.contains_slot(*slot)))
                .collect::<Vec<_>>();
            silent.sort_by_key(|&slot| (std::cmp::Reverse(ranks[slot as usize]), slot));
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
                .ok_or(DirectiveSkip::Exhausted)?;
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
            let vectors = legal_syncopations(&onset_slots, template, beat_level, window);
            if vectors.is_empty() {
                return Err(DirectiveSkip::Exhausted);
            }
            let vector = vectors[plan_draw(
                inputs.seed_value,
                directive.id,
                draw_cycle,
                draw_base,
                vectors.len() as u64,
            ) as usize];
            let landing = syncopation_target(&onset_slots, template, vector, beat_level)
                .ok_or(DirectiveSkip::Exhausted)?;
            move_onset(&mut candidate, vector.pulse, landing);
        }
        DirectiveFamily::Desyncopate => {
            let onset_slots = state_slots(state);
            let pulses = legal_desyncopations(&onset_slots, template, beat_level, window);
            if pulses.is_empty() {
                return Err(DirectiveSkip::Exhausted);
            }
            let pulse = pulses[plan_draw(
                inputs.seed_value,
                directive.id,
                draw_cycle,
                draw_base,
                pulses.len() as u64,
            ) as usize];
            let (source, _) = desyncopate_at(&onset_slots, template, pulse, beat_level)
                .ok_or(DirectiveSkip::Exhausted)?;
            move_onset(&mut candidate, source, pulse);
        }
        DirectiveFamily::Fragment => {
            let intervals = super::figures::ranked_fragment_intervals(state, slots, ranks, window);
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
            let mut ks = super::figures::k_candidates(interval.len);
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
                return Err(DirectiveApplyError::Corridor(DensityCorridorClamp {
                    limit: DensityCorridorLimit::Ceiling,
                    density_percent: corridor.ceiling_percent,
                }));
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
            let runs = super::figures::ranked_consolidate_runs(state, ranks, window);
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
            let removable = state.onsets.len().saturating_sub(corridor.floor_count);
            if removable == 0 {
                return Err(DirectiveApplyError::Corridor(DensityCorridorClamp {
                    limit: DensityCorridorLimit::Floor,
                    density_percent: corridor.floor_percent,
                }));
            }
            run.count = run.count.min(removable.saturating_add(1));
            candidate = super::figures::apply_consolidate(state, &run);
        }
        DirectiveFamily::Euclid => {
            let windows = super::reshape::ranked_reshape_windows(
                state,
                seed.total_beats,
                seed.required_subdivision,
                ranks,
                window,
            );
            if windows.is_empty() {
                return Err(DirectiveSkip::Exhausted);
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
                .ok_or(DirectiveSkip::Exhausted)?;
        }
        DirectiveFamily::Stochastic => return Err(DirectiveSkip::Exhausted.into()),
    }


    if let Some(clamp) = corridor.clamp_for(candidate.onsets.len()) {
        return Err(DirectiveApplyError::Corridor(clamp));
    }

    if !state_intervals_disjoint(&candidate, slots) {
        return Err(DirectiveSkip::Projection.into());
    }
    if !state_is_projectable(seed, &candidate, inputs) {
        return Err(DirectiveSkip::Projection.into());
    }
    Ok(candidate)
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
    seed_slots: &[u32],
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    window: Option<SlotRange>,
) -> (EvolutionState, bool, Option<DirectiveSkip>) {
    let drift_leash = sampled_percent(inputs, DUMKA_DRIFT_LEASH_TARGET, inputs.drift_leash, cycle);
    let budget = (drift_leash * seed_slots.len() as u32).div_ceil(100);
    let current = normalize_to_leash(seed, state, seed_slots, ranks, inputs, budget);
    if directive.intensity == 0
        || plan_draw(inputs.seed_value, directive.id, cycle, 0, 100)
            >= u64::from(directive.intensity)
    {
        return (current, false, None);
    }
    let total = inputs.op_weights.total();
    if total == 0 {
        return (current, true, Some(DirectiveSkip::Exhausted));
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

    let candidate = match apply_one_directive_operation(
        &selected, &current, seed, ranks, template, beat_level, inputs, cycle, cycle, 1, window,
    ) {
        Ok(candidate) => candidate,
        Err(skip) => return (current, true, Some(skip)),
    };
    if op != Op::Rotate && symmetric_difference(&state_slots(&candidate), seed_slots) > budget {
        return (current, true, Some(DirectiveSkip::Exhausted));
    }
    (candidate, true, None)
}

#[allow(clippy::too_many_arguments)]
fn apply_directive(
    directive: &EvolutionDirective,
    state: &EvolutionState,
    seed: &CompiledSeed,
    seed_slots: &[u32],
    ranks: &[u32],
    template: &[u32],
    beat_level: u32,
    inputs: &EvolutionInputs<'_>,
    cycle: u64,
    accumulator: &mut RangeAccumulator,
) -> (EvolutionState, DirectiveTraceEntry) {
    let mut trace = DirectiveTraceEntry {
        cycle,
        directive_id: directive.id,
        family: directive.family,
        requested: 0,
        applied: 0,
        skipped: DirectiveSkip::None,
    };
    let window = match slot_range(directive.scope, seed.total_beats, seed.required_subdivision) {
        Ok(window) => window,
        Err(skip) => {
            trace.skipped = skip;
            return (state.clone(), trace);
        }
    };

    if directive.family == DirectiveFamily::Stochastic {
        let (next, attempted, skipped) = apply_stochastic_directive(
            directive, seed, state, seed_slots, ranks, template, beat_level, inputs, cycle, window,
        );
        trace.requested = u32::from(attempted);
        trace.applied = u32::from(attempted && skipped.is_none());
        trace.skipped = skipped.unwrap_or(DirectiveSkip::None);
        return (next, trace);
    }

    let initial_candidates =
        directive_candidate_count(directive, state, seed, ranks, template, beat_level, window);
    if initial_candidates == 0
        && directive.intensity > 0
        && (directive.is_pin() || directive.pacing == DirectivePacing::PerCycle)
    {
        trace.skipped = DirectiveSkip::Exhausted;
        return (state.clone(), trace);
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
        return (state.clone(), trace);
    }
    if initial_candidates == 0 && directive.intensity > 0 {
        trace.skipped = DirectiveSkip::Exhausted;
        return (state.clone(), trace);
    }

    let mut current = state.clone();
    for offset in 0..u64::from(requested) {
        let ordinal = first_ordinal.saturating_add(offset);
        match apply_one_directive_operation(
            directive, &current, seed, ranks, template, beat_level, inputs, cycle, draw_cycle,
            ordinal, window,
        ) {
            Ok(next) => {
                current = next;
                trace.applied += 1;
            }
            Err(skip) => {
                trace.skipped = skip;
                break;
            }
        }
    }
    if trace.applied < trace.requested && trace.skipped == DirectiveSkip::None {
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
/// the published Barlow tables — the caller then plays the seed verbatim
/// (documented fallback), keeping behavior deterministic rather than
/// guessing ranks.
pub struct EvolvedSeedResolution {
    pub seed: CompiledSeed,
    pub trace: Vec<DirectiveTraceEntry>,
}

pub fn evolved_seed_with_trace(
    seed: &CompiledSeed,
    inputs: &EvolutionInputs<'_>,
) -> Option<EvolvedSeedResolution> {
    if inputs.cycle == 0 {
        return Some(EvolvedSeedResolution {
            seed: seed.clone(),
            trace: Vec::new(),
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
    if inputs.plan.is_empty() && inputs.evolution_rate == 0 && !evolution_is_automated {
        return Some(EvolvedSeedResolution {
            seed: seed.clone(),
            trace: Vec::new(),
        });
    }
    let strata = stratification(seed.total_beats, seed.required_subdivision)?;
    let ranks = indispensability(&strata);
    let template = metrical_levels(&strata);
    let beat_level = factor_descending(seed.total_beats).len() as u32;
    let seed_slots: Vec<u32> = seed_state(seed).onsets.iter().map(|o| o.slot).collect();

    let mut state = seed_state(seed);
    let mut accumulators = std::collections::BTreeMap::<u64, RangeAccumulator>::new();
    let mut requested_cycle_trace = Vec::new();
    for cycle in 1..=inputs.cycle {
        let active = active_directives(inputs.plan, cycle);
        if active.is_empty() {
            let legacy_rate = sampled_percent(
                inputs,
                DUMKA_EVOLUTION_RATE_TARGET,
                inputs.evolution_rate,
                cycle,
            );
            // A planned pin is outside the leash. At an authored 0% legacy
            // gap, literal repetition must therefore retain that pin instead
            // of letting leash normalization silently undo it.
            if inputs.plan.is_empty() || legacy_rate > 0 {
                state = step(
                    seed,
                    &state,
                    &seed_slots,
                    &ranks,
                    &template,
                    beat_level,
                    inputs,
                    cycle,
                );
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
        for directive in active {
            let accumulator = accumulators.entry(directive.id).or_default();
            let (next, trace) = apply_directive(
                directive,
                &state,
                seed,
                &seed_slots,
                &ranks,
                &template,
                beat_level,
                inputs,
                cycle,
                accumulator,
            );
            state = next;
            if cycle == inputs.cycle {
                requested_cycle_trace.push(trace);
            }
        }
        if all_orphaned {
            let legacy_rate = sampled_percent(
                inputs,
                DUMKA_EVOLUTION_RATE_TARGET,
                inputs.evolution_rate,
                cycle,
            );
            if legacy_rate > 0 {
                state = step(
                    seed,
                    &state,
                    &seed_slots,
                    &ranks,
                    &template,
                    beat_level,
                    inputs,
                    cycle,
                );
            }
        }
    }
    Some(EvolvedSeedResolution {
        seed: state_to_compiled(seed, &state),
        trace: requested_cycle_trace,
    })
}

pub fn evolved_seed(seed: &CompiledSeed, inputs: &EvolutionInputs<'_>) -> Option<CompiledSeed> {
    evolved_seed_with_trace(seed, inputs).map(|resolved| resolved.seed)
}

#[cfg(test)]
mod tests {
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
            barlow_temperature: 0,
            fill_complexity: 0,
            euclid_max_run: 1,
            euclid_invert: 0,
            euclid_rest_policy: super::super::reshape::EuclidRestPolicy::Tied,
            plan: &[],
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
            barlow_temperature: 0,
            fill_complexity: 0,
            euclid_max_run: 1,
            euclid_invert: 0,
            euclid_rest_policy: super::super::reshape::EuclidRestPolicy::Tied,
            plan: &[],
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
            );
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
    fn directive_is_exempt_from_zero_leash_but_not_projection() {
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
        assert_eq!(rotated.trace[0].applied, 1);
        assert_eq!(rotated.trace[0].skipped, DirectiveSkip::Projection);
        resolve_seed_cells(&rotated.seed, 4, &tile_spans).expect("projection remains supreme");
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

    proptest! {
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
                        );
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
        );
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
        );
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
        );
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
    fn unsupported_prime_grids_fall_back_to_the_seed() {
        // Eleven beats: prime 11 exceeds the published Barlow tables.
        let seed = compiled(&"x ".repeat(11));
        let s = spans(11, 1);
        let mut inputs11 = inputs(7, 12, 100, 100, &s);
        inputs11.cycle_beats = 11;
        assert_eq!(evolved_seed(&seed, &inputs11), None);
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
            );
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
