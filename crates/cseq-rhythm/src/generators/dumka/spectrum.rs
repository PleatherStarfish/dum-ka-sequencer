//! Deterministic fixed-point spectral placement on a circular slot lattice.
//!
//! The decision path uses only pinned Q16.16 roots and integer recurrences;
//! it never calls floating-point trigonometry. Callers own musical filtering
//! (silent/uncovered slots for Add and sounding onsets for Remove) and pass the
//! corresponding candidates explicitly.

use std::collections::{BTreeMap, BTreeSet};

use super::depth::MAX_WORKING_SUBDIVISION;

pub const Q16_ONE: i32 = 65_536;
pub const MAX_HARMONICS: u32 = 16;

/// Pinned Q16.16 `(cos(2π/W), sin(2π/W))` seeds for `W = 1..=64`.
///
/// Seeds were generated once from an offline trigonometric reference and are now wire
/// constants. Rows are advanced with complex multiplication and nearest
/// rounding, so Rust and TypeScript can mirror the same integers exactly.
const UNIT_ROOTS_Q16: [(i32, i32); 64] = [
    (65_536, 0),
    (-65_536, 0),
    (-32_768, 56_756),
    (0, 65_536),
    (20_252, 62_328),
    (32_768, 56_756),
    (40_861, 51_238),
    (46_341, 46_341),
    (50_203, 42_126),
    (53_020, 38_521),
    (55_132, 35_431),
    (56_756, 32_768),
    (58_029, 30_456),
    (59_046, 28_435),
    (59_870, 26_656),
    (60_547, 25_080),
    (61_111, 23_674),
    (61_584, 22_415),
    (61_985, 21_280),
    (62_328, 20_252),
    (62_624, 19_317),
    (62_881, 18_464),
    (63_106, 17_681),
    (63_303, 16_962),
    (63_477, 16_298),
    (63_632, 15_684),
    (63_769, 15_114),
    (63_893, 14_583),
    (64_004, 14_088),
    (64_104, 13_626),
    (64_194, 13_192),
    (64_277, 12_785),
    (64_352, 12_403),
    (64_420, 12_042),
    (64_483, 11_702),
    (64_540, 11_380),
    (64_593, 11_076),
    (64_642, 10_787),
    (64_687, 10_513),
    (64_729, 10_252),
    (64_768, 10_004),
    (64_804, 9_768),
    (64_838, 9_542),
    (64_869, 9_327),
    (64_898, 9_121),
    (64_926, 8_924),
    (64_951, 8_735),
    (64_975, 8_554),
    (64_998, 8_381),
    (65_019, 8_214),
    (65_039, 8_054),
    (65_058, 7_899),
    (65_076, 7_751),
    (65_093, 7_608),
    (65_109, 7_471),
    (65_124, 7_338),
    (65_138, 7_209),
    (65_152, 7_086),
    (65_165, 6_966),
    (65_177, 6_850),
    (65_189, 6_738),
    (65_200, 6_630),
    (65_210, 6_525),
    (65_220, 6_424),
];

/// One harmonic's Q16.16 samples around a complete period.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarmonicRow {
    pub harmonic: u32,
    pub cosine: Vec<i32>,
    pub sine: Vec<i32>,
}

/// Build `m=1..=min(16,W/2)` fixed-point rows.
///
/// Returns an empty table outside the supported `1..=64` period domain.
pub fn cosine_table(period_slots: u32) -> Vec<HarmonicRow> {
    if period_slots == 0 || period_slots > MAX_WORKING_SUBDIVISION {
        return Vec::new();
    }
    let base = UNIT_ROOTS_Q16[(period_slots - 1) as usize];
    let fundamental = recurrence(period_slots, base);
    let maximum = MAX_HARMONICS.min(period_slots / 2);
    (1..=maximum)
        .map(|harmonic| {
            let mut cosine = Vec::with_capacity(period_slots as usize);
            let mut sine = Vec::with_capacity(period_slots as usize);
            for slot in 0..period_slots {
                let index =
                    ((u64::from(harmonic) * u64::from(slot)) % u64::from(period_slots)) as usize;
                cosine.push(fundamental[index].0);
                sine.push(fundamental[index].1);
            }
            HarmonicRow {
                harmonic,
                cosine,
                sine,
            }
        })
        .collect()
}

fn recurrence(period_slots: u32, root: (i32, i32)) -> Vec<(i32, i32)> {
    let mut result = Vec::with_capacity(period_slots as usize);
    let mut current = (Q16_ONE, 0i32);
    for slot in 0..period_slots {
        result.push(current);
        current = (
            q16_mul(current.0, root.0) - q16_mul(current.1, root.1),
            q16_mul(current.1, root.0) + q16_mul(current.0, root.1),
        );
        let next_slot = slot + 1;
        if period_slots % 4 == 0 && next_slot == period_slots / 4 {
            current = (0, Q16_ONE);
        } else if period_slots % 2 == 0 && next_slot == period_slots / 2 {
            current = (-Q16_ONE, 0);
        }
        // Quantized recurrence drifts by a few integer units around the
        // circle. Mirror the computed first half exactly so the fixed-point
        // table retains cos(-x)=cos(x), sin(-x)=-sin(x) by construction.
        if next_slot > period_slots / 2 && next_slot < period_slots {
            let mirror = (period_slots - next_slot) as usize;
            current = (result[mirror].0, -result[mirror].1);
        }
    }
    result
}

fn q16_mul(left: i32, right: i32) -> i32 {
    let product = i64::from(left) * i64::from(right);
    let rounded = if product >= 0 {
        product + i64::from(Q16_ONE) / 2
    } else {
        product - i64::from(Q16_ONE) / 2
    };
    i32::try_from(rounded / i64::from(Q16_ONE)).unwrap_or_else(|_| {
        if rounded.is_negative() {
            i32::MIN
        } else {
            i32::MAX
        }
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SpectrumBin {
    harmonic: u32,
    real: i64,
    imaginary: i64,
}

/// Reusable fixed-point field. Construction is `O(kM)`; every score and
/// incremental mutation is `O(M)`, where `M <= 16`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeometricField {
    period_slots: u32,
    table: Vec<HarmonicRow>,
    bins: Vec<SpectrumBin>,
    onset_slots: BTreeSet<u32>,
}

impl GeometricField {
    pub fn new(period_slots: u32, onset_slots: &[u32]) -> Self {
        let period_slots = if period_slots <= MAX_WORKING_SUBDIVISION {
            period_slots
        } else {
            0
        };
        let table = cosine_table(period_slots);
        let onset_slots = onset_slots.iter().copied().collect::<BTreeSet<_>>();
        let bins = table
            .iter()
            .map(|row| {
                let (real, imaginary) = onset_slots.iter().fold((0i64, 0i64), |sum, &slot| {
                    let index = (slot % period_slots) as usize;
                    (
                        sum.0 + i64::from(row.cosine[index]),
                        sum.1 + i64::from(row.sine[index]),
                    )
                });
                SpectrumBin {
                    harmonic: row.harmonic,
                    real,
                    imaginary,
                }
            })
            .collect();
        Self {
            period_slots,
            table,
            bins,
            onset_slots,
        }
    }

    pub fn insertion_delta(&self, candidate_slot: u32) -> i128 {
        self.delta_from_bins(
            &self.bins,
            self.onset_slots.len().saturating_add(1),
            candidate_slot,
        )
    }

    pub fn deletion_delta(&self, candidate_slot: u32) -> i128 {
        if self.period_slots == 0 || !self.onset_slots.contains(&candidate_slot) {
            return 0;
        }
        let index = (candidate_slot % self.period_slots) as usize;
        let remaining = self
            .bins
            .iter()
            .zip(&self.table)
            .map(|(bin, row)| SpectrumBin {
                harmonic: bin.harmonic,
                real: bin.real - i64::from(row.cosine[index]),
                imaginary: bin.imaginary - i64::from(row.sine[index]),
            })
            .collect::<Vec<_>>();
        self.delta_from_bins(&remaining, self.onset_slots.len(), candidate_slot)
    }

    pub fn insert(&mut self, slot: u32) -> bool {
        if self.period_slots == 0 || !self.onset_slots.insert(slot) {
            return false;
        }
        let index = (slot % self.period_slots) as usize;
        for (bin, row) in self.bins.iter_mut().zip(&self.table) {
            bin.real += i64::from(row.cosine[index]);
            bin.imaginary += i64::from(row.sine[index]);
        }
        true
    }

    pub fn remove(&mut self, slot: u32) -> bool {
        if self.period_slots == 0 || !self.onset_slots.remove(&slot) {
            return false;
        }
        let index = (slot % self.period_slots) as usize;
        for (bin, row) in self.bins.iter_mut().zip(&self.table) {
            bin.real -= i64::from(row.cosine[index]);
            bin.imaginary -= i64::from(row.sine[index]);
        }
        true
    }

    pub fn onset_count(&self) -> usize {
        self.onset_slots.len()
    }

    fn delta_from_bins(
        &self,
        bins: &[SpectrumBin],
        resulting_count: usize,
        candidate_slot: u32,
    ) -> i128 {
        if self.period_slots == 0 {
            return 0;
        }
        let index = (candidate_slot % self.period_slots) as usize;
        self.table
            .iter()
            .zip(bins)
            .filter(|(row, _)| resulting_count == 0 || row.harmonic as usize % resulting_count != 0)
            .map(|(row, bin)| {
                // F stores Σe^(+iθ); `Re(conj(F)e^(+iθ)) = a·cos + b·sin`.
                let projection = i128::from(bin.real) * i128::from(row.cosine[index])
                    + i128::from(bin.imaginary) * i128::from(row.sine[index]);
                let unit = i128::from(Q16_ONE) * i128::from(Q16_ONE);
                let weight = i128::from((Q16_ONE as u32) / bin.harmonic);
                weight * (2 * projection + unit)
            })
            .sum()
    }
}

/// Weighted insertion-energy delta for one candidate slot.
///
/// Lower values fill larger temporal voids. Harmonics divisible by the
/// resulting cardinality are skipped: those bins describe the trivial
/// `k`-fold repetition of a `k`-onset set rather than spacing unevenness.
pub fn insertion_delta(period_slots: u32, onset_slots: &[u32], candidate_slot: u32) -> i128 {
    GeometricField::new(period_slots, onset_slots).insertion_delta(candidate_slot)
}

/// Weighted deletion-energy delta (energy removed) for one sounding slot.
///
/// Larger values are more spectrally redundant and therefore removed first.
/// This is computed as the exact inverse insertion into the remaining set;
/// it is still `O(M)` per candidate after the caller maintains/removes the
/// candidate from its incremental spectrum.
pub fn deletion_delta(period_slots: u32, onset_slots: &[u32], candidate_slot: u32) -> i128 {
    GeometricField::new(period_slots, onset_slots).deletion_delta(candidate_slot)
}

/// Silent/uncovered absolute cycle slots ordered largest-void first.
///
/// Spectral phase is reduced modulo `period_slots` (normally the working
/// per-beat Subdivision), while final ties use the absolute slot. This lets
/// one fixed table rank a multi-beat cycle without flattening meter into an
/// unsupported `beats × W` trigonometric period.
pub fn geometric_add_order(
    period_slots: u32,
    onset_slots: &[u32],
    candidate_slots: &[u32],
) -> Vec<u32> {
    let field = GeometricField::new(period_slots, onset_slots);
    let mut scored = canonical_candidates(period_slots, candidate_slots)
        .into_iter()
        .map(|slot| (field.insertion_delta(slot), slot))
        .collect::<Vec<_>>();
    scored.sort_unstable();
    scored.into_iter().map(|(_, slot)| slot).collect()
}

/// Sounding absolute cycle slots ordered most-redundant first.
pub fn geometric_remove_order(
    period_slots: u32,
    onset_slots: &[u32],
    candidate_slots: &[u32],
) -> Vec<u32> {
    let field = GeometricField::new(period_slots, onset_slots);
    let mut scored = canonical_candidates(period_slots, candidate_slots)
        .into_iter()
        .map(|slot| (field.deletion_delta(slot), slot))
        .collect::<Vec<_>>();
    scored.sort_unstable_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    scored.into_iter().map(|(_, slot)| slot).collect()
}

fn canonical_candidates(period_slots: u32, candidates: &[u32]) -> Vec<u32> {
    if period_slots == 0 {
        return Vec::new();
    }
    candidates
        .iter()
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// Map an order to integer ranks `0..=1000` (best to worst).
pub fn normalized_ranks(order: &[u32]) -> Vec<(u32, u32)> {
    let denominator = order.len().saturating_sub(1) as u64;
    order
        .iter()
        .enumerate()
        .map(|(index, &slot)| {
            let rank = if denominator == 0 {
                0
            } else {
                ((index as u64 * 1_000) + denominator / 2) / denominator
            };
            (slot, rank as u32)
        })
        .collect()
}

/// Blend two best-to-worst orders by placement bias (`0..=100`).
///
/// At bias 0 this returns the Barlow order byte-for-byte. At 100 it returns
/// the geometric order byte-for-byte. Missing candidates sort after candidates
/// present in both lists, and slot is the final deterministic tie-break.
pub fn blended_order(barlow_order: &[u32], geometric_order: &[u32], bias: u32) -> Vec<u32> {
    let bias = bias.min(100);
    if bias == 0 {
        return dedupe(barlow_order);
    }
    if bias == 100 {
        return dedupe(geometric_order);
    }

    let barlow = normalized_ranks(&dedupe(barlow_order))
        .into_iter()
        .collect::<BTreeMap<_, _>>();
    let geometric = normalized_ranks(&dedupe(geometric_order))
        .into_iter()
        .collect::<BTreeMap<_, _>>();
    let mut slots = barlow
        .keys()
        .chain(geometric.keys())
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    slots.sort_unstable_by_key(|slot| {
        let barlow_rank = barlow.get(slot).copied().unwrap_or(1_001);
        let geometric_rank = geometric.get(slot).copied().unwrap_or(1_001);
        ((100 - bias) * barlow_rank + bias * geometric_rank, *slot)
    });
    slots
}

fn dedupe(order: &[u32]) -> Vec<u32> {
    let mut seen = BTreeSet::new();
    order
        .iter()
        .copied()
        .filter(|slot| seen.insert(*slot))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_root_recurrence_vectors_are_stable() {
        for (period, expected) in [
            (8, vec![65_536, 46_341, 0, -46_341, -65_536]),
            (12, vec![65_536, 56_756, 32_768, 0, -32_768]),
            (16, vec![65_536, 60_547, 46_341, 25_080, 0]),
            (20, vec![65_536, 62_328, 53_020, 38_521, 20_252]),
            (24, vec![65_536, 63_303, 56_756, 46_341, 32_768]),
            (48, vec![65_536, 64_975, 63_303, 60_547, 56_756]),
            (60, vec![65_536, 65_177, 64_104, 62_328, 59_870]),
            (64, vec![65_536, 65_220, 64_277, 62_714, 60_547]),
        ] {
            let table = cosine_table(period);
            for (&actual, expected) in table[0].cosine[..5].iter().zip(expected) {
                assert!(
                    actual.abs_diff(expected) <= 4,
                    "period {period}: {actual} vs {expected}"
                );
            }
            assert_eq!(table.len(), MAX_HARMONICS.min(period / 2) as usize);
        }
    }

    #[test]
    fn table_has_expected_quadrature_and_periodicity() {
        for period in 1..=64 {
            let table = cosine_table(period);
            for row in &table {
                assert_eq!(row.cosine.len(), period as usize);
                assert_eq!(row.sine.len(), period as usize);
                assert_eq!(row.cosine[0], Q16_ONE);
                assert_eq!(row.sine[0], 0);
                for slot in 0..period {
                    let inverse = ((period - slot) % period) as usize;
                    assert!(
                        (row.cosine[slot as usize] - row.cosine[inverse]).abs() <= 8,
                        "cosine symmetry W={period}, m={}, s={slot}",
                        row.harmonic
                    );
                    assert!(
                        (row.sine[slot as usize] + row.sine[inverse]).abs() <= 8,
                        "sine symmetry W={period}, m={}, s={slot}",
                        row.harmonic
                    );
                }
            }
        }
    }

    #[test]
    fn geometric_orders_are_rotation_equivariant() {
        for period in [8u32, 12, 16, 20, 24, 48, 60, 64] {
            let onsets = [0, period / 4, period / 2];
            let candidates = (0..period)
                .filter(|slot| !onsets.contains(slot))
                .collect::<Vec<_>>();
            let original = geometric_add_order(period, &onsets, &candidates);
            for shift in 0..period {
                let shifted_onsets = onsets
                    .iter()
                    .map(|slot| (slot + shift) % period)
                    .collect::<Vec<_>>();
                let shifted_candidates = candidates
                    .iter()
                    .map(|slot| (slot + shift) % period)
                    .collect::<Vec<_>>();
                let shifted = geometric_add_order(period, &shifted_onsets, &shifted_candidates);
                let expected_set = original
                    .iter()
                    .map(|slot| (slot + shift) % period)
                    .collect::<BTreeSet<_>>();
                assert_eq!(shifted.into_iter().collect::<BTreeSet<_>>(), expected_set);
            }
        }
    }

    #[test]
    fn add_and_remove_delta_are_exact_inverses() {
        for period in [8u32, 12, 20, 64] {
            let before = vec![0, period / 3, period / 2];
            for candidate in 0..period {
                if before.contains(&candidate) {
                    continue;
                }
                let insertion = insertion_delta(period, &before, candidate);
                let mut after = before.clone();
                after.push(candidate);
                after.sort_unstable();
                assert_eq!(insertion, deletion_delta(period, &after, candidate));
            }
        }
    }

    #[test]
    fn incremental_field_matches_fresh_reconstruction() {
        let mut onsets = vec![0, 5, 12, 19];
        let mut field = GeometricField::new(12, &onsets);
        assert_eq!(field.onset_count(), 4);
        for candidate in [1, 7, 13, 23] {
            assert_eq!(
                field.insertion_delta(candidate),
                insertion_delta(12, &onsets, candidate)
            );
        }

        assert!(field.insert(7));
        onsets.push(7);
        assert!(!field.insert(7));
        assert_eq!(field.onset_count(), 5);
        assert_eq!(field.deletion_delta(7), deletion_delta(12, &onsets, 7));

        assert!(field.remove(5));
        onsets.retain(|&slot| slot != 5);
        assert!(!field.remove(5));
        assert_eq!(field.onset_count(), 4);
        for candidate in [2, 8, 14, 20] {
            assert_eq!(
                field.insertion_delta(candidate),
                insertion_delta(12, &onsets, candidate)
            );
        }
    }

    #[test]
    fn candidate_orders_are_unique_and_tie_by_slot() {
        let candidates = [7, 1, 5, 3, 1];
        assert_eq!(geometric_add_order(8, &[], &candidates), vec![1, 3, 5, 7]);
        assert_eq!(
            geometric_remove_order(8, &[1, 3, 5, 7], &candidates).len(),
            4
        );
    }

    #[test]
    fn one_period_table_ranks_absolute_slots_across_multiple_beats() {
        let onsets = [0, 4, 8];
        let candidates = [1, 9, 3, 11, 17];
        let order = geometric_add_order(8, &onsets, &candidates);
        assert_eq!(
            order.iter().copied().collect::<BTreeSet<_>>(),
            candidates.into_iter().collect::<BTreeSet<_>>()
        );
        assert_eq!(
            insertion_delta(8, &onsets, 1),
            insertion_delta(8, &onsets, 9)
        );
        assert_eq!(
            insertion_delta(8, &onsets, 1),
            insertion_delta(8, &onsets, 17)
        );

        // Removing absolute slot 0 leaves the same-phase onset at slot 8.
        assert_eq!(
            deletion_delta(8, &onsets, 0),
            insertion_delta(8, &[4, 8], 0)
        );
    }

    #[test]
    fn normalized_and_blended_ranks_pin_compatibility_endpoints() {
        let barlow = [7, 0, 4, 2, 6, 1, 5, 3];
        let geometric = [0, 4, 2, 6, 1, 5, 3, 7];
        assert_eq!(
            normalized_ranks(&[10, 20, 30]),
            vec![(10, 0), (20, 500), (30, 1_000)]
        );
        assert_eq!(blended_order(&barlow, &geometric, 0), barlow);
        assert_eq!(blended_order(&barlow, &geometric, 100), geometric);
        assert_eq!(blended_order(&[2, 1, 0], &[0, 1, 2], 50), vec![0, 1, 2]);
    }
}
