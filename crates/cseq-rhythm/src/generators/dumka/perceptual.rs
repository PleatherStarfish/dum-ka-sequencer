//! Deterministic perceptual distance for two realized Dum-Ka evolution states.
//!
//! The distance is intentionally computed on [`EvolutionState`], before the
//! projector splits notes into span-local tie handshakes.  That keeps a
//! notational split of one sustain cheap (and occupancy-identical) while still
//! letting attacks, meter, syncopation, and rational-grid changes contribute
//! independently.  All arithmetic is integer/fixed-point so a locked seed and
//! the calibrated-change planner replay byte-identically on every platform.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::evolve::EvolutionState;
use super::tree::{MAX_SUBDIVISION, MAX_TOTAL_BEATS};

/// 100.000 perceptual units, expressed in milli-units.
pub const PERCEPTUAL_DISTANCE_MAX_MILLI: u32 = 100_000;

/// Whole-cycle realized distance: the requested cycle's final state scored
/// against the state the fold carried out of the previous cycle. This is
/// the calibration readout ("how different does cycle N actually sound
/// from N−1") — a preview/authoring artifact like the directive trace;
/// playback never consumes it. `None` upstream when the grid has no
/// published Barlow tables or at cycle 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerceptualCycleDistance {
    pub model_version: PerceptualModelVersion,
    pub distance_milli: u32,
}

/// Version of the pinned feature model used to score a distance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerceptualModelVersion {
    /// First fixed-point model.
    V1,
}

/// Relative weights of the seven independently bounded feature distances.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PerceptualWeights {
    pub attack_edit: u32,
    pub occupancy: u32,
    pub timing_transport: u32,
    pub meter_phase: u32,
    pub syncopation: u32,
    pub ratio_complexity: u32,
    pub density_class: u32,
}

impl PerceptualWeights {
    const fn sum(self) -> u64 {
        self.attack_edit as u64
            + self.occupancy as u64
            + self.timing_transport as u64
            + self.meter_phase as u64
            + self.syncopation as u64
            + self.ratio_complexity as u64
            + self.density_class as u64
    }
}

/// A pinned, serializable-by-name scoring policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PerceptualModel {
    version: PerceptualModelVersion,
    weights: PerceptualWeights,
}

impl PerceptualModel {
    /// The initial model. Weights sum to 1,000 for straightforward auditing.
    pub const fn v1() -> Self {
        Self {
            version: PerceptualModelVersion::V1,
            weights: PerceptualWeights {
                attack_edit: 180,
                occupancy: 150,
                timing_transport: 150,
                meter_phase: 240,
                syncopation: 120,
                ratio_complexity: 100,
                density_class: 60,
            },
        }
    }

    /// Resolve a persisted version to its immutable weight table.
    pub const fn for_version(version: PerceptualModelVersion) -> Self {
        match version {
            PerceptualModelVersion::V1 => Self::v1(),
        }
    }

    pub const fn version(self) -> PerceptualModelVersion {
        self.version
    }

    pub const fn weights(self) -> PerceptualWeights {
        self.weights
    }
}

impl Default for PerceptualModel {
    fn default() -> Self {
        Self::v1()
    }
}

/// Invalid metrical context supplied to the distance model.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PerceptualError {
    #[error("perceptual distance requires at least one beat")]
    ZeroBeats,
    #[error("perceptual distance requires a non-zero subdivision")]
    ZeroSubdivision,
    #[error("perceptual distance supports at most {MAX_TOTAL_BEATS} beats, got {beats}")]
    TooManyBeats { beats: u32 },
    #[error(
        "perceptual distance supports subdivision at most {MAX_SUBDIVISION}, got {subdivision}"
    )]
    SubdivisionTooLarge { subdivision: u32 },
    #[error("perceptual distance grid overflows u32 slots")]
    GridOverflow,
    #[error(
        "perceptual metric vectors must each have {expected} slots, got {ranks} ranks and {levels} levels"
    )]
    MetricLength {
        expected: usize,
        ranks: usize,
        levels: usize,
    },
}

/// Fixed structural context shared by every comparison on one cycle grid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PerceptualContext {
    total_beats: u32,
    subdivision: u32,
    slots: u32,
    metrical_ranks: Vec<u32>,
    metrical_levels: Vec<u32>,
    salience: Vec<u64>,
    total_salience: u64,
}

impl PerceptualContext {
    /// Build a context from the exact Barlow ranks and Sioros metrical levels
    /// used by evolution. Higher rank and lower level both mean stronger.
    pub fn new(
        total_beats: u32,
        subdivision: u32,
        metrical_ranks: Vec<u32>,
        metrical_levels: Vec<u32>,
    ) -> Result<Self, PerceptualError> {
        if total_beats == 0 {
            return Err(PerceptualError::ZeroBeats);
        }
        if subdivision == 0 {
            return Err(PerceptualError::ZeroSubdivision);
        }
        if total_beats > MAX_TOTAL_BEATS {
            return Err(PerceptualError::TooManyBeats { beats: total_beats });
        }
        if subdivision > MAX_SUBDIVISION {
            return Err(PerceptualError::SubdivisionTooLarge { subdivision });
        }
        let slots = total_beats
            .checked_mul(subdivision)
            .ok_or(PerceptualError::GridOverflow)?;
        let expected = slots as usize;
        if metrical_ranks.len() != expected || metrical_levels.len() != expected {
            return Err(PerceptualError::MetricLength {
                expected,
                ranks: metrical_ranks.len(),
                levels: metrical_levels.len(),
            });
        }

        let max_rank = metrical_ranks.iter().copied().max().unwrap_or(0);
        let max_level = metrical_levels.iter().copied().max().unwrap_or(0);
        let salience = metrical_ranks
            .iter()
            .zip(&metrical_levels)
            .map(|(&rank, &level)| {
                let rank_strength = normalized_strength(rank, max_rank);
                let level_strength =
                    normalized_strength(max_level.saturating_sub(level), max_level);
                // The +1 keeps every pulse audible to the metric edit term.
                1 + 3 * rank_strength + 2 * level_strength
            })
            .collect::<Vec<_>>();
        let total_salience = salience.iter().sum();

        Ok(Self {
            total_beats,
            subdivision,
            slots,
            metrical_ranks,
            metrical_levels,
            salience,
            total_salience,
        })
    }

    pub const fn total_beats(&self) -> u32 {
        self.total_beats
    }

    pub const fn subdivision(&self) -> u32 {
        self.subdivision
    }

    pub const fn slots(&self) -> u32 {
        self.slots
    }

    pub fn metrical_ranks(&self) -> &[u32] {
        &self.metrical_ranks
    }

    pub fn metrical_levels(&self) -> &[u32] {
        &self.metrical_levels
    }

    /// The six read-only per-state property functionals the calibration UI
    /// plots over cycle time (M3.97 §1). Each is an absolute `0..=100_000`
    /// milliunit measurement of one realized cycle on the working grid,
    /// order-free and pure — display inputs only, never a decision path.
    /// Complexity/diversity delegate to `depth`; evenness to `spectrum`;
    /// syncopation reuses this model's own signature per state.
    pub fn state_properties(&self, state: &EvolutionState) -> StateProperties {
        let view = RhythmView::new(state, self);
        let slots = self.slots;
        let attack_slots = &view.attack_slots;
        let onset_count = attack_slots.len() as u32;
        let covered = view.occupancy.iter().filter(|&&covered| covered).count() as u32;
        StateProperties {
            density_milli: ratio_milli(onset_count, slots),
            complexity_milli: super::depth::state_complexity_milli(attack_slots, self.subdivision),
            syncopation_milli: self.state_syncopation_milli(&view),
            evenness_milli: super::spectrum::state_evenness_milli(slots, attack_slots),
            occupancy_milli: ratio_milli(covered, slots),
            diversity_milli: super::depth::depth_diversity_milli(attack_slots, self.subdivision),
        }
    }

    /// Summed syncopation signature normalized by its per-state maximum: each
    /// of the `k` attacks contributes at most `max_level × max_salience`, so
    /// the ratio stays in `0..=100_000`. Zero when nothing can syncopate.
    fn state_syncopation_milli(&self, view: &RhythmView<'_>) -> u32 {
        let onset_count = view.attack_slots.len() as u64;
        let max_level = u64::from(self.metrical_levels.iter().copied().max().unwrap_or(0));
        let max_salience = self.salience.iter().copied().max().unwrap_or(0);
        let capacity = onset_count
            .saturating_mul(max_level)
            .saturating_mul(max_salience);
        if capacity == 0 {
            return 0;
        }
        let total: u64 = syncopation_signature(view, self).into_iter().sum();
        u32::try_from((100_000 * total.min(capacity)) / capacity).unwrap_or(100_000)
    }
}

/// The read-only per-state property profile (M3.97 §1). All six are
/// absolute `0..=100_000` milliunits; the calibration UI plots them per cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateProperties {
    pub density_milli: u32,
    pub complexity_milli: u32,
    pub syncopation_milli: u32,
    pub evenness_milli: u32,
    pub occupancy_milli: u32,
    pub diversity_milli: u32,
}

/// `round(100_000 × numerator / denominator)`, saturating and integer-exact.
fn ratio_milli(numerator: u32, denominator: u32) -> u32 {
    if denominator == 0 {
        return 0;
    }
    let scaled = 100_000u64 * u64::from(numerator) + u64::from(denominator) / 2;
    u32::try_from((scaled / u64::from(denominator)).min(100_000)).unwrap_or(100_000)
}

/// Auditable feature breakdown for one comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PerceptualDistance {
    pub model_version: PerceptualModelVersion,
    pub attack_edit_milli: u32,
    pub occupancy_milli: u32,
    pub timing_transport_milli: u32,
    pub meter_phase_milli: u32,
    pub syncopation_milli: u32,
    pub ratio_complexity_milli: u32,
    pub density_class_milli: u32,
    /// Metric-salience-weighted edit at the authored phase.
    pub anchored_milli: u32,
    /// Minimum attack-set edit under any circular slot shift.
    pub aligned_milli: u32,
    /// Shift applied to the right-hand state to obtain `aligned_milli`.
    pub best_shift_slots: i32,
    /// Gap between the best and second-best phase alignments; zero is
    /// maximally phase-ambiguous (periodic/symmetric).
    pub alignment_clarity_milli: u32,
    pub total_milli: u32,
}

/// Alternate name for callers that emphasize the feature breakdown.
pub type PerceptualBreakdown = PerceptualDistance;

/// Compare two evolved patterns on one fixed metrical grid.
pub fn perceptual_distance(
    left: &EvolutionState,
    right: &EvolutionState,
    context: &PerceptualContext,
    model: &PerceptualModel,
) -> PerceptualDistance {
    let left = RhythmView::new(left, context);
    let right = RhythmView::new(right, context);

    let attack_edit_milli = set_edit(&left.attacks, &right.attacks);
    let occupancy_milli = occupancy_edit(&left.occupancy, &right.occupancy);
    let timing_transport_milli =
        timing_transport(&left.attack_slots, &right.attack_slots, context.slots);
    let anchored_milli = anchored_meter_edit(&left.attacks, &right.attacks, context);
    let alignment = phase_alignment(&left.attacks, &right.attacks);
    let aligned_milli = alignment.cost_milli;
    let meter_phase_milli =
        clarity_interpolation(aligned_milli, anchored_milli, alignment.clarity_milli);
    let syncopation_milli = syncopation_edit(&left, &right, context);
    let ratio_complexity_milli = signature_edit(
        &ratio_signature(&left, context),
        &ratio_signature(&right, context),
    );
    let density_class_milli = density_class_edit(&left, &right);

    let components = [
        (attack_edit_milli, model.weights.attack_edit),
        (occupancy_milli, model.weights.occupancy),
        (timing_transport_milli, model.weights.timing_transport),
        (meter_phase_milli, model.weights.meter_phase),
        (syncopation_milli, model.weights.syncopation),
        (ratio_complexity_milli, model.weights.ratio_complexity),
        (density_class_milli, model.weights.density_class),
    ];
    let weight_sum = model.weights.sum();
    let weighted_sum = components.iter().fold(0u128, |sum, &(value, weight)| {
        sum + u128::from(value) * u128::from(weight)
    });
    let total_milli = if weight_sum == 0 {
        0
    } else {
        let rounded = ((weighted_sum + u128::from(weight_sum / 2)) / u128::from(weight_sum))
            .min(u128::from(PERCEPTUAL_DISTANCE_MAX_MILLI)) as u32;
        if weighted_sum == 0 {
            0
        } else {
            rounded.max(1)
        }
    };

    PerceptualDistance {
        model_version: model.version,
        attack_edit_milli,
        occupancy_milli,
        timing_transport_milli,
        meter_phase_milli,
        syncopation_milli,
        ratio_complexity_milli,
        density_class_milli,
        anchored_milli,
        aligned_milli,
        best_shift_slots: alignment.shift_slots,
        alignment_clarity_milli: alignment.clarity_milli,
        total_milli,
    }
}

#[derive(Debug)]
struct NormalizedOnset<'a> {
    start: u32,
    dur: u32,
    class: &'a str,
}

#[derive(Debug)]
struct RhythmView<'a> {
    onsets: Vec<NormalizedOnset<'a>>,
    attacks: Vec<bool>,
    attack_slots: Vec<u32>,
    occupancy: Vec<bool>,
    class_by_slot: Vec<Option<&'a str>>,
}

impl<'a> RhythmView<'a> {
    fn new(state: &'a EvolutionState, context: &PerceptualContext) -> Self {
        let slots = context.slots;
        let rotation = (state.rotation_beats % context.total_beats) * context.subdivision;
        let mut onsets = state
            .onsets
            .iter()
            .map(|onset| NormalizedOnset {
                start: (onset.slot % slots + rotation) % slots,
                dur: onset.dur.min(slots),
                class: &onset.class,
            })
            .collect::<Vec<_>>();
        onsets.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.class.cmp(b.class)));

        let mut attacks = vec![false; slots as usize];
        let mut occupancy = vec![false; slots as usize];
        let mut class_by_slot = vec![None; slots as usize];
        for onset in &onsets {
            attacks[onset.start as usize] = true;
            class_by_slot[onset.start as usize] = Some(onset.class);
            for offset in 0..onset.dur {
                occupancy[((onset.start + offset) % slots) as usize] = true;
            }
        }
        let attack_slots = attacks
            .iter()
            .enumerate()
            .filter_map(|(slot, &is_attack)| is_attack.then_some(slot as u32))
            .collect();

        Self {
            onsets,
            attacks,
            attack_slots,
            occupancy,
            class_by_slot,
        }
    }
}

fn normalized_strength(value: u32, maximum: u32) -> u64 {
    if maximum == 0 {
        0
    } else {
        (u64::from(value) * 1_000 + u64::from(maximum / 2)) / u64::from(maximum)
    }
}

fn scaled_ratio(numerator: u64, denominator: u64) -> u32 {
    if denominator == 0 {
        return 0;
    }
    ((u128::from(numerator) * u128::from(PERCEPTUAL_DISTANCE_MAX_MILLI)
        + u128::from(denominator / 2))
        / u128::from(denominator))
    .min(u128::from(PERCEPTUAL_DISTANCE_MAX_MILLI)) as u32
}

fn clarity_interpolation(aligned: u32, anchored: u32, clarity: u32) -> u32 {
    let difference = aligned.abs_diff(anchored);
    let adjustment = ((u64::from(difference) * u64::from(clarity)
        + u64::from(PERCEPTUAL_DISTANCE_MAX_MILLI / 2))
        / u64::from(PERCEPTUAL_DISTANCE_MAX_MILLI)) as u32;
    if anchored >= aligned {
        aligned.saturating_add(adjustment)
    } else {
        aligned.saturating_sub(adjustment)
    }
}

fn set_edit(left: &[bool], right: &[bool]) -> u32 {
    let mut changed = 0u64;
    for (&left, &right) in left.iter().zip(right) {
        changed += u64::from(left != right);
    }
    scaled_ratio(changed, left.len() as u64)
}

fn occupancy_edit(left: &[bool], right: &[bool]) -> u32 {
    let changed = left
        .iter()
        .zip(right)
        .filter(|(left, right)| left != right)
        .count() as u64;
    scaled_ratio(changed, left.len() as u64)
}

fn timing_transport(left: &[u32], right: &[u32], slots: u32) -> u32 {
    if left == right || slots < 2 {
        return 0;
    }
    let max_distance = slots / 2;
    let mut total = 0u64;
    for &slot in left {
        total += u64::from(nearest_circular_distance(slot, right, slots, max_distance));
    }
    for &slot in right {
        total += u64::from(nearest_circular_distance(slot, left, slots, max_distance));
    }
    scaled_ratio(
        total,
        u64::from(max_distance) * (left.len() + right.len()) as u64,
    )
}

fn nearest_circular_distance(slot: u32, targets: &[u32], slots: u32, empty: u32) -> u32 {
    if targets.is_empty() {
        return empty;
    }
    let insertion = targets.partition_point(|&target| target < slot);
    let after = targets[insertion % targets.len()];
    let before = targets[(insertion + targets.len() - 1) % targets.len()];
    circular_distance(slot, after, slots).min(circular_distance(slot, before, slots))
}

fn circular_distance(left: u32, right: u32, slots: u32) -> u32 {
    let direct = left.abs_diff(right);
    direct.min(slots - direct)
}

fn anchored_meter_edit(left: &[bool], right: &[bool], context: &PerceptualContext) -> u32 {
    let changed_salience = left
        .iter()
        .zip(right)
        .zip(&context.salience)
        .filter_map(|((&left, &right), &salience)| (left != right).then_some(salience))
        .sum();
    scaled_ratio(changed_salience, context.total_salience)
}

#[derive(Debug, Clone, Copy)]
struct Alignment {
    cost_milli: u32,
    shift_slots: i32,
    clarity_milli: u32,
}

fn phase_alignment(left: &[bool], right: &[bool]) -> Alignment {
    let slots = left.len();
    debug_assert_eq!(slots, right.len());
    let left_count = left.iter().filter(|&&value| value).count();
    let right_count = right.iter().filter(|&&value| value).count();
    let overlap = circular_overlaps(left, right, left_count, right_count);

    let mut best_overlap = i64::MIN;
    let mut second_overlap = i64::MIN;
    let mut best_shift = 0usize;
    for (shift, &intersection) in overlap.iter().enumerate() {
        debug_assert!(intersection >= 0);
        if intersection > best_overlap {
            second_overlap = best_overlap;
            best_overlap = intersection;
            best_shift = shift;
        } else if intersection == best_overlap {
            second_overlap = best_overlap;
            if shift_key(shift, slots) < shift_key(best_shift, slots) {
                best_shift = shift;
            }
        } else {
            second_overlap = second_overlap.max(intersection);
        }
    }
    let best_overlap = best_overlap.max(0) as usize;
    let changed = left_count + right_count - 2 * best_overlap;
    let cost_milli = scaled_ratio(changed as u64, slots as u64);
    let clarity_milli = if left_count != right_count {
        // A density edit is not evidence of a phase-equivalent pattern; keep
        // direct metrical placement audible for local adds/removes.
        PERCEPTUAL_DISTANCE_MAX_MILLI
    } else if left_count == 0 || second_overlap == i64::MIN {
        0
    } else {
        scaled_ratio(
            best_overlap.saturating_sub(second_overlap.max(0) as usize) as u64,
            left_count as u64,
        )
    };
    Alignment {
        cost_milli,
        shift_slots: signed_shift(best_shift, slots),
        clarity_milli,
    }
}

/// Exact circular cross-correlation. Sparse patterns use onset/empty-position
/// pairs; dense patterns switch to bit-packed windows. The latter caps a
/// legal 8,192-slot comparison at roughly N²/64 word operations rather than
/// N² scalar pair additions, which matters because the calibrated planner
/// evaluates a prefix of candidates on every fired cycle.
fn circular_overlaps(
    left: &[bool],
    right: &[bool],
    left_count: usize,
    right_count: usize,
) -> Vec<i64> {
    let slots = left.len();
    let empty_product = (slots - left_count).saturating_mul(slots - right_count);
    let onset_product = left_count.saturating_mul(right_count);
    let packed_work = slots.saturating_mul(slots.div_ceil(64));
    if onset_product.min(empty_product) <= packed_work {
        sparse_circular_overlaps(left, right, left_count, right_count)
    } else {
        packed_circular_overlaps(left, right)
    }
}

fn sparse_circular_overlaps(
    left: &[bool],
    right: &[bool],
    left_count: usize,
    right_count: usize,
) -> Vec<i64> {
    let slots = left.len();
    let mut overlap = vec![0i64; slots];
    let left_true = positions(left, true);
    let right_true = positions(right, true);
    let left_false = positions(left, false);
    let right_false = positions(right, false);
    if left_true.len().saturating_mul(right_true.len())
        <= left_false.len().saturating_mul(right_false.len())
    {
        add_pair_overlaps(&mut overlap, &left_true, &right_true);
    } else {
        add_pair_overlaps(&mut overlap, &left_false, &right_false);
        let base = left_count as i64 + right_count as i64 - slots as i64;
        for value in &mut overlap {
            *value += base;
        }
    }
    overlap
}

fn packed_circular_overlaps(left: &[bool], right: &[bool]) -> Vec<i64> {
    let slots = left.len();
    let words = slots.div_ceil(64);
    let left_bits = pack_bits(left);

    // A doubled right-hand necklace makes each circularly shifted pattern a
    // contiguous N-bit window. The spare word makes unaligned 64-bit loads
    // branch-free at the end of the doubled sequence.
    let mut doubled_right = vec![0u64; (slots.saturating_mul(2)).div_ceil(64) + 1];
    for (slot, &set) in right.iter().chain(right).enumerate() {
        if set {
            doubled_right[slot / 64] |= 1u64 << (slot % 64);
        }
    }

    (0..slots)
        .map(|shift| {
            let window_start = (slots - shift) % slots;
            let intersection = left_bits
                .iter()
                .enumerate()
                .map(|(word, &left_word)| {
                    let offset = window_start + word * 64;
                    (left_word & load_unaligned_word(&doubled_right, offset)).count_ones() as i64
                })
                .sum();
            debug_assert_eq!(left_bits.len(), words);
            intersection
        })
        .collect()
}

fn pack_bits(values: &[bool]) -> Vec<u64> {
    let mut packed = vec![0u64; values.len().div_ceil(64)];
    for (index, &set) in values.iter().enumerate() {
        if set {
            packed[index / 64] |= 1u64 << (index % 64);
        }
    }
    packed
}

fn load_unaligned_word(words: &[u64], bit_offset: usize) -> u64 {
    let word = bit_offset / 64;
    let shift = bit_offset % 64;
    if shift == 0 {
        words[word]
    } else {
        (words[word] >> shift) | (words[word + 1] << (64 - shift))
    }
}

fn positions(values: &[bool], selected: bool) -> Vec<usize> {
    values
        .iter()
        .enumerate()
        .filter_map(|(index, &value)| (value == selected).then_some(index))
        .collect()
}

fn add_pair_overlaps(overlap: &mut [i64], left: &[usize], right: &[usize]) {
    let slots = overlap.len();
    for &left_slot in left {
        for &right_slot in right {
            let shift = (left_slot + slots - right_slot) % slots;
            overlap[shift] += 1;
        }
    }
}

fn signed_shift(shift: usize, slots: usize) -> i32 {
    if shift <= slots / 2 {
        shift as i32
    } else {
        shift as i32 - slots as i32
    }
}

fn shift_key(shift: usize, slots: usize) -> (u32, bool) {
    let signed = signed_shift(shift, slots);
    (signed.unsigned_abs(), signed.is_positive())
}

fn syncopation_signature(view: &RhythmView<'_>, context: &PerceptualContext) -> Vec<u64> {
    let slots = context.slots;
    let mut signature = vec![0u64; slots as usize];
    if view.attack_slots.is_empty() {
        return signature;
    }
    for &source in &view.attack_slots {
        let source_level = context.metrical_levels[source as usize];
        for distance in 1..slots {
            let target = (source + distance) % slots;
            if view.attacks[target as usize] {
                break;
            }
            let target_level = context.metrical_levels[target as usize];
            if target_level < source_level {
                let level_drop = u64::from(source_level - target_level);
                signature[target as usize] += level_drop * context.salience[target as usize];
                break;
            }
        }
    }
    signature
}

fn syncopation_edit(
    left: &RhythmView<'_>,
    right: &RhythmView<'_>,
    context: &PerceptualContext,
) -> u32 {
    let left_signature = syncopation_signature(left, context);
    let right_signature = syncopation_signature(right, context);
    let changed = left_signature
        .iter()
        .zip(&right_signature)
        .map(|(&left, &right)| left.abs_diff(right))
        .sum();
    let max_level = context.metrical_levels.iter().copied().max().unwrap_or(0) as u64;
    let max_salience = context.salience.iter().copied().max().unwrap_or(0);
    let source_capacity = (left.attack_slots.len() + right.attack_slots.len()) as u64;
    scaled_ratio(
        changed,
        source_capacity
            .saturating_mul(max_level)
            .saturating_mul(max_salience),
    )
}

fn ratio_signature(view: &RhythmView<'_>, context: &PerceptualContext) -> Vec<u64> {
    let mut signature = vec![0u64; context.subdivision as usize + 1];
    for onset in &view.onsets {
        add_ratio(
            &mut signature,
            onset.start % context.subdivision,
            context.subdivision,
        );
        if onset.dur > 0 {
            add_ratio(&mut signature, onset.dur, context.subdivision);
        }
    }
    if !view.attack_slots.is_empty() {
        for index in 0..view.attack_slots.len() {
            let current = view.attack_slots[index];
            let next = view.attack_slots[(index + 1) % view.attack_slots.len()];
            let interval = if next > current {
                next - current
            } else {
                context.slots - current + next
            };
            add_ratio(&mut signature, interval, context.subdivision);
        }
    }
    signature
}

fn add_ratio(signature: &mut [u64], numerator: u32, denominator: u32) {
    let reduced_denominator = denominator / gcd(numerator, denominator);
    signature[reduced_denominator as usize] += ratio_weight(reduced_denominator);
}

fn gcd(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left.max(1)
}

fn ratio_weight(mut denominator: u32) -> u64 {
    if denominator <= 1 {
        return 1;
    }
    let mut weight = 1u64;
    let mut prime = 2u32;
    while prime.saturating_mul(prime) <= denominator {
        while denominator % prime == 0 {
            weight += prime_complexity(prime);
            denominator /= prime;
        }
        prime += 1;
    }
    if denominator > 1 {
        weight += prime_complexity(denominator);
    }
    weight
}

fn prime_complexity(prime: u32) -> u64 {
    match prime {
        2 => 1,
        3 => 3,
        5 => 5,
        _ => u64::from(prime.min(17)),
    }
}

fn signature_edit(left: &[u64], right: &[u64]) -> u32 {
    let mut changed = 0u64;
    let mut union_mass = 0u64;
    for (&left, &right) in left.iter().zip(right) {
        changed += left.abs_diff(right);
        union_mass += left.max(right);
    }
    scaled_ratio(changed, union_mass)
}

fn density_class_edit(left: &RhythmView<'_>, right: &RhythmView<'_>) -> u32 {
    let left_count = left.attack_slots.len() as u64;
    let right_count = right.attack_slots.len() as u64;
    let slots = left.attacks.len() as u64;
    let density = scaled_ratio(left_count.abs_diff(right_count), slots);

    let mut left_classes = BTreeMap::<&str, u64>::new();
    let mut right_classes = BTreeMap::<&str, u64>::new();
    for onset in &left.onsets {
        *left_classes.entry(onset.class).or_default() += 1;
    }
    for onset in &right.onsets {
        *right_classes.entry(onset.class).or_default() += 1;
    }
    let all_classes = left_classes
        .keys()
        .chain(right_classes.keys())
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    let class_changed = all_classes
        .iter()
        .map(|class| {
            left_classes
                .get(class)
                .copied()
                .unwrap_or(0)
                .abs_diff(right_classes.get(class).copied().unwrap_or(0))
        })
        .sum();
    let inventory = scaled_ratio(class_changed, slots.saturating_mul(2));
    let positional_changes = left
        .class_by_slot
        .iter()
        .zip(&right.class_by_slot)
        .filter(
            |&(left, right)| matches!((left, right), (Some(left), Some(right)) if left != right),
        )
        .count() as u64;
    let positional = scaled_ratio(positional_changes, slots);
    let class = ((u64::from(positional) * 3 + u64::from(inventory) + 2) / 4) as u32;
    ((u64::from(density) * 3 + u64::from(class) + 2) / 4) as u32
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;
    use crate::generators::dumka::barlow::{indispensability, stratification};
    use crate::generators::dumka::evolve::EvolvedOnset;
    use crate::generators::dumka::sioros::metrical_levels;

    fn context(beats: u32, subdivision: u32) -> PerceptualContext {
        let strata = stratification(beats, subdivision).expect("supported test grid");
        PerceptualContext::new(
            beats,
            subdivision,
            indispensability(&strata),
            metrical_levels(&strata),
        )
        .unwrap()
    }

    fn state(onsets: &[(u32, u32, &str)], rotation_beats: u32) -> EvolutionState {
        EvolutionState {
            onsets: onsets
                .iter()
                .map(|&(slot, dur, class)| EvolvedOnset {
                    slot,
                    dur,
                    class: class.to_owned(),
                })
                .collect(),
            rotation_beats,
        }
    }

    #[test]
    fn state_properties_report_the_six_functionals() {
        let context = context(1, 8);
        // An even 4-gon of one-slot hits: exactly known density, occupancy,
        // and evenness; syncopation is zero because no attack is followed by
        // a silent stronger pulse before the next attack.
        let even = state(&[(0, 1, "x"), (2, 1, "x"), (4, 1, "x"), (6, 1, "x")], 0);
        let profile = context.state_properties(&even);
        assert_eq!(profile.density_milli, 50_000);
        assert_eq!(profile.occupancy_milli, 50_000);
        assert_eq!(profile.evenness_milli, 100_000);
        assert_eq!(profile.syncopation_milli, 0);
        // Complexity and diversity match the standalone depth helpers on the
        // same working grid (the profile must not diverge from the corridor
        // metrics the fold enforces).
        let slots = [0u32, 2, 4, 6];
        assert_eq!(
            profile.complexity_milli,
            super::super::depth::state_complexity_milli(&slots, 8)
        );
        assert_eq!(
            profile.diversity_milli,
            super::super::depth::depth_diversity_milli(&slots, 8)
        );

        // Sustains raise occupancy above density; every field stays bounded.
        let sustained = state(&[(0, 4, "x"), (4, 2, "x")], 0);
        let held = context.state_properties(&sustained);
        assert_eq!(held.density_milli, 25_000); // 2 attacks of 8 slots
        assert_eq!(held.occupancy_milli, 75_000); // 6 covered of 8
        assert!(held.evenness_milli <= 100_000 && held.syncopation_milli <= 100_000);

        // A syncopated pattern (offbeat attack before a silent stronger pulse)
        // reports positive syncopation, unlike the on-grid even set above.
        let syncopated = state(&[(0, 1, "x"), (3, 1, "x")], 0);
        assert!(context.state_properties(&syncopated).syncopation_milli > 0);
    }

    fn distance(
        left: &EvolutionState,
        right: &EvolutionState,
        context: &PerceptualContext,
    ) -> PerceptualDistance {
        perceptual_distance(left, right, context, &PerceptualModel::v1())
    }

    #[test]
    fn identity_is_exactly_zero() {
        let context = context(2, 8);
        let pattern = state(&[(0, 3, "dum"), (5, 1, "ka"), (11, 2, "x")], 1);
        let result = distance(&pattern, &pattern, &context);
        assert_eq!(result.total_milli, 0);
        assert_eq!(result.attack_edit_milli, 0);
        assert_eq!(result.occupancy_milli, 0);
        assert_eq!(result.timing_transport_milli, 0);
        assert_eq!(result.meter_phase_milli, 0);
        assert_eq!(result.syncopation_milli, 0);
        assert_eq!(result.ratio_complexity_milli, 0);
        assert_eq!(result.density_class_milli, 0);
        assert_eq!(result.best_shift_slots, 0);
    }

    #[test]
    fn empty_rhythms_are_total_symmetric_and_have_no_invented_phase() {
        let context = context(4, 4);
        let empty = state(&[], 3);
        let sounded = state(&[(0, 1, "dum")], 0);
        let identity = distance(&empty, &empty, &context);
        assert_eq!(identity.total_milli, 0);
        assert_eq!(identity.best_shift_slots, 0);
        assert_eq!(identity.alignment_clarity_milli, 0);

        let forward = distance(&empty, &sounded, &context);
        let reverse = distance(&sounded, &empty, &context);
        assert_eq!(forward.total_milli, reverse.total_milli);
        assert!(forward.total_milli > 0);
        assert_eq!(
            forward.alignment_clarity_milli,
            PERCEPTUAL_DISTANCE_MAX_MILLI
        );
    }

    #[test]
    fn model_version_has_a_stable_wire_name_and_resolves_pinned_weights() {
        assert_eq!(
            serde_json::to_string(&PerceptualModelVersion::V1).unwrap(),
            "\"v1\""
        );
        assert_eq!(
            serde_json::from_str::<PerceptualModelVersion>("\"v1\"").unwrap(),
            PerceptualModelVersion::V1
        );
        assert_eq!(
            PerceptualModel::for_version(PerceptualModelVersion::V1),
            PerceptualModel::v1()
        );
    }

    #[test]
    fn context_rejects_work_above_the_canonical_dumka_grid() {
        assert_eq!(
            PerceptualContext::new(MAX_TOTAL_BEATS + 1, 1, Vec::new(), Vec::new()),
            Err(PerceptualError::TooManyBeats {
                beats: MAX_TOTAL_BEATS + 1,
            })
        );
        assert_eq!(
            PerceptualContext::new(1, MAX_SUBDIVISION + 1, Vec::new(), Vec::new()),
            Err(PerceptualError::SubdivisionTooLarge {
                subdivision: MAX_SUBDIVISION + 1,
            })
        );
    }

    #[test]
    fn a_single_stroke_class_change_cannot_round_down_to_identity() {
        let context = context(128, 64);
        let dum = state(&[(0, 1, "dum")], 0);
        let ka = state(&[(0, 1, "ka")], 0);
        let result = distance(&dum, &ka, &context);
        assert!(result.density_class_milli > 0);
        assert_eq!(result.total_milli, 1);
    }

    #[test]
    fn attack_symmetric_rotation_still_hears_positional_stroke_classes() {
        let context = context(4, 4);
        let pattern = state(
            &[(0, 1, "dum"), (4, 1, "ka"), (8, 1, "dum"), (12, 1, "ka")],
            0,
        );
        let rotated = EvolutionState {
            rotation_beats: 1,
            ..pattern.clone()
        };
        let result = distance(&pattern, &rotated, &context);
        assert_eq!(result.attack_edit_milli, 0);
        assert_eq!(result.aligned_milli, 0);
        assert!(result.density_class_milli > 0);
        assert!(result.total_milli > 0);
    }

    #[test]
    fn splitting_a_sustain_preserves_occupancy_and_stays_small() {
        let context = context(1, 16);
        let held = state(&[(0, 8, "dum")], 0);
        let split = state(&[(0, 4, "dum"), (4, 4, "dum")], 0);
        let result = distance(&held, &split, &context);
        assert_eq!(result.occupancy_milli, 0);
        assert!(result.total_milli > 0);
        assert!(result.total_milli < 30_000, "{result:?}");
    }

    #[test]
    fn a_weak_fill_is_smaller_than_a_strong_fill() {
        let context = context(1, 8);
        let seed = state(&[(0, 1, "dum")], 0);
        let weak_fill = state(&[(0, 1, "dum"), (1, 1, "ka")], 0);
        let strong_fill = state(&[(0, 1, "dum"), (4, 1, "ka")], 0);
        let weak = distance(&seed, &weak_fill, &context);
        let strong = distance(&seed, &strong_fill, &context);
        assert!(
            weak.total_milli < strong.total_milli,
            "weak={weak:?}, strong={strong:?}"
        );
    }

    #[test]
    fn a_single_anacrusis_contributes_syncopation_distance() {
        let context = context(1, 8);
        let downbeat = state(&[(0, 1, "dum")], 0);
        let anacrusis = state(&[(7, 1, "dum")], 0);
        assert!(distance(&downbeat, &anacrusis, &context).syncopation_milli > 0);
    }

    #[test]
    fn moving_weak_pulses_is_smaller_than_crossing_a_strong_metric_position() {
        let context = context(1, 16);
        let weak_source = state(&[(1, 1, "ka")], 0);
        let weak_move = state(&[(3, 1, "ka")], 0);
        let strong_source = state(&[(0, 1, "ka")], 0);
        let strong_move = state(&[(2, 1, "ka")], 0);
        assert!(
            distance(&weak_source, &weak_move, &context).total_milli
                < distance(&strong_source, &strong_move, &context).total_milli
        );
    }

    #[test]
    fn alignment_distinguishes_symmetric_and_anchored_rotation() {
        let context = context(4, 4);
        let symmetric = state(&[(0, 1, "x"), (4, 1, "x"), (8, 1, "x"), (12, 1, "x")], 0);
        let symmetric_rotated = EvolutionState {
            rotation_beats: 1,
            ..symmetric.clone()
        };
        assert_eq!(
            distance(&symmetric, &symmetric_rotated, &context).total_milli,
            0
        );

        let asymmetric = state(&[(0, 1, "dum"), (1, 1, "ka"), (6, 1, "x")], 0);
        let asymmetric_rotated = EvolutionState {
            rotation_beats: 1,
            ..asymmetric.clone()
        };
        let result = distance(&asymmetric, &asymmetric_rotated, &context);
        assert!(result.anchored_milli > 0);
        assert_eq!(result.aligned_milli, 0);
        assert_eq!(result.best_shift_slots, -4);
        assert!(result.total_milli > 0);
    }

    #[test]
    fn phase_clarity_makes_near_periodic_rotation_cheaper_than_anchored_rotation() {
        let context = context(4, 4);
        // A repeating quarter-note backbone with one ornament has several
        // plausible registrations. It is not exactly rotation-symmetric,
        // but its phase evidence is intentionally ambiguous.
        let ambiguous = state(
            &[
                (0, 1, "dum"),
                (1, 1, "ka"),
                (4, 1, "dum"),
                (8, 1, "dum"),
                (12, 1, "dum"),
            ],
            0,
        );
        let ambiguous_rotated = EvolutionState {
            rotation_beats: 1,
            ..ambiguous.clone()
        };
        let anchored = state(&[(0, 1, "dum"), (1, 1, "ka"), (6, 1, "x")], 0);
        let anchored_rotated = EvolutionState {
            rotation_beats: 1,
            ..anchored.clone()
        };

        let ambiguous_result = distance(&ambiguous, &ambiguous_rotated, &context);
        let anchored_result = distance(&anchored, &anchored_rotated, &context);
        assert!(
            ambiguous_result.alignment_clarity_milli < anchored_result.alignment_clarity_milli,
            "ambiguous={ambiguous_result:?}, anchored={anchored_result:?}"
        );
        assert!(
            ambiguous_result.meter_phase_milli < anchored_result.meter_phase_milli,
            "ambiguous={ambiguous_result:?}, anchored={anchored_result:?}"
        );
    }

    #[test]
    fn ratio_grid_complexity_detects_quintuple_against_quarter_spacing() {
        let context = context(1, 20);
        let quarters = state(&[(0, 1, "x"), (5, 1, "x"), (10, 1, "x"), (15, 1, "x")], 0);
        let fifths = state(
            &[
                (0, 1, "x"),
                (4, 1, "x"),
                (8, 1, "x"),
                (12, 1, "x"),
                (16, 1, "x"),
            ],
            0,
        );
        assert!(distance(&quarters, &fifths, &context).ratio_complexity_milli > 0);
    }

    fn generated_state(raw: Vec<(u8, bool)>, rotation: u8) -> EvolutionState {
        let mut by_slot = BTreeMap::new();
        for (slot, alternate) in raw {
            by_slot.insert(slot % 16, if alternate { "ka" } else { "dum" });
        }
        state(
            &by_slot
                .into_iter()
                .map(|(slot, class)| (u32::from(slot), 1, class))
                .collect::<Vec<_>>(),
            u32::from(rotation % 4),
        )
    }

    fn equal_length_bool_pairs() -> impl Strategy<Value = (Vec<bool>, Vec<bool>)> {
        (1usize..130).prop_flat_map(|length| {
            (
                proptest::collection::vec(any::<bool>(), length),
                proptest::collection::vec(any::<bool>(), length),
            )
        })
    }

    fn naive_circular_overlaps(left: &[bool], right: &[bool]) -> Vec<i64> {
        (0..left.len())
            .map(|shift| {
                left.iter()
                    .enumerate()
                    .filter(|&(slot, &set)| {
                        set && right[(slot + right.len() - shift) % right.len()]
                    })
                    .count() as i64
            })
            .collect()
    }

    #[test]
    fn legal_max_grid_phase_alignment_finishes_on_the_packed_path() {
        use std::time::{Duration, Instant};

        let slots = (128 * 64) as usize;
        let left = (0..slots)
            .map(|slot| (slot % 2 == 0) ^ (slot % 127 == 0))
            .collect::<Vec<_>>();
        let expected_shift = 173usize;
        let right = (0..slots)
            .map(|slot| left[(slot + expected_shift) % slots])
            .collect::<Vec<_>>();

        let started = Instant::now();
        let alignment = phase_alignment(&left, &right);
        let elapsed = started.elapsed();
        assert_eq!(alignment.cost_milli, 0);
        assert_eq!(alignment.shift_slots, expected_shift as i32);
        assert!(
            elapsed < Duration::from_secs(2),
            "legal maximum phase comparison took {elapsed:?}"
        );
    }

    proptest! {
        #[test]
        fn packed_correlation_matches_the_scalar_definition(
            (left, right) in equal_length_bool_pairs(),
        ) {
            let expected = naive_circular_overlaps(&left, &right);
            prop_assert_eq!(packed_circular_overlaps(&left, &right), expected.clone());
            prop_assert_eq!(
                circular_overlaps(
                    &left,
                    &right,
                    left.iter().filter(|&&set| set).count(),
                    right.iter().filter(|&&set| set).count(),
                ),
                expected,
            );
        }

        #[test]
        fn distance_is_symmetric_bounded_and_deterministic(
            left_raw in proptest::collection::vec((0u8..16, any::<bool>()), 0..17),
            right_raw in proptest::collection::vec((0u8..16, any::<bool>()), 0..17),
            left_rotation in 0u8..4,
            right_rotation in 0u8..4,
        ) {
            let context = context(4, 4);
            let left = generated_state(left_raw, left_rotation);
            let right = generated_state(right_raw, right_rotation);
            let forward = distance(&left, &right, &context);
            let reverse = distance(&right, &left, &context);
            let replay = distance(&left, &right, &context);
            let left_view = RhythmView::new(&left, &context);
            let right_view = RhythmView::new(&right, &context);

            prop_assert_eq!(forward, replay);
            prop_assert_eq!(forward.total_milli, reverse.total_milli);
            prop_assert_eq!(forward.attack_edit_milli, reverse.attack_edit_milli);
            prop_assert_eq!(forward.occupancy_milli, reverse.occupancy_milli);
            prop_assert_eq!(forward.timing_transport_milli, reverse.timing_transport_milli);
            prop_assert_eq!(forward.meter_phase_milli, reverse.meter_phase_milli);
            prop_assert_eq!(forward.syncopation_milli, reverse.syncopation_milli);
            prop_assert_eq!(forward.ratio_complexity_milli, reverse.ratio_complexity_milli);
            prop_assert_eq!(forward.density_class_milli, reverse.density_class_milli);
            prop_assert_eq!(forward.anchored_milli, reverse.anchored_milli);
            prop_assert_eq!(forward.aligned_milli, reverse.aligned_milli);
            prop_assert_eq!(forward.alignment_clarity_milli, reverse.alignment_clarity_milli);
            if left_view.attacks != right_view.attacks
                || left_view.occupancy != right_view.occupancy
                || left_view.class_by_slot != right_view.class_by_slot
            {
                prop_assert!(forward.total_milli > 0);
            }
            for component in [
                forward.attack_edit_milli,
                forward.occupancy_milli,
                forward.timing_transport_milli,
                forward.meter_phase_milli,
                forward.syncopation_milli,
                forward.ratio_complexity_milli,
                forward.density_class_milli,
                forward.anchored_milli,
                forward.aligned_milli,
                forward.alignment_clarity_milli,
                forward.total_milli,
            ] {
                prop_assert!(component <= PERCEPTUAL_DISTANCE_MAX_MILLI);
            }
        }
    }
}
