//! Exact working-lattice and attack-point depth mathematics for Dum-Ka.
//!
//! This module deliberately owns no evolution state.  Callers supply sorted
//! or unsorted slot slices and retain responsibility for interval,
//! projection, and corridor guards.  Every decision value is integer-exact.

use std::collections::BTreeMap;

use thiserror::Error;

/// The platform's largest legal per-beat Subdivision.
pub const MAX_WORKING_SUBDIVISION: u32 = 64;
/// `100.000` depth units, expressed in milli-units.
pub const MAX_COMPLEXITY_MILLI: u32 = 100_000;
/// Common denominator used by the pinned Barlow indigestibility table.
pub const INDIGESTIBILITY_SCALE: u32 = 210;

const PALETTE_PRIMES: [u32; 4] = [2, 3, 5, 7];

/// Invalid authored palette or working lattice.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DepthError {
    #[error("dumka subdivisionPalette requires a positive seed Subdivision")]
    ZeroSubdivision,
    #[error("dumka subdivisionPalette entries must be 2, 3, 5, or 7, got {value}")]
    InvalidPaletteEntry { value: u32 },
    #[error("dumka subdivisionPalette supports at most 2 levels, got {count}")]
    TooManyPaletteLevels { count: usize },
    #[error(
        "dumka subdivisionPalette needs working Subdivision {working_subdivision}, above the platform maximum 64"
    )]
    WorkingSubdivisionTooLarge { working_subdivision: u32 },
}

/// Validate and canonicalize an authored palette.
///
/// Palette order is semantically irrelevant. Duplicate entries are removed,
/// and the returned representation is ascending for stable persistence and
/// identity keys.
pub fn canonical_subdivision_palette(palette: &[u32]) -> Result<Vec<u32>, DepthError> {
    let mut canonical = Vec::with_capacity(palette.len().min(2));
    for &level in palette {
        if !PALETTE_PRIMES.contains(&level) {
            return Err(DepthError::InvalidPaletteEntry { value: level });
        }
        if !canonical.contains(&level) {
            canonical.push(level);
        }
    }
    canonical.sort_unstable();
    if canonical.len() > 2 {
        return Err(DepthError::TooManyPaletteLevels {
            count: canonical.len(),
        });
    }
    Ok(canonical)
}

/// Refine a seed Subdivision by one factor for each unique palette level.
///
/// A prime already present in the seed contributes one additional power: a
/// `{2}` palette on seed Subdivision 4 therefore produces working
/// Subdivision 8. Empty palette is exact identity.
pub fn working_subdivision(required: u32, palette: &[u32]) -> Result<u32, DepthError> {
    if required == 0 {
        return Err(DepthError::ZeroSubdivision);
    }
    let canonical = canonical_subdivision_palette(palette)?;
    let working = canonical.iter().try_fold(required, |working, &level| {
        working
            .checked_mul(level)
            .ok_or(DepthError::WorkingSubdivisionTooLarge {
                working_subdivision: u32::MAX,
            })
    })?;
    if working > MAX_WORKING_SUBDIVISION {
        return Err(DepthError::WorkingSubdivisionTooLarge {
            working_subdivision: working,
        });
    }
    Ok(working)
}

/// Greatest common divisor, including the conventional `gcd(0, n) = n`.
pub const fn gcd(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}

/// Exact within-beat denominator of a working-lattice slot after reduction.
///
/// Beat starts have denominator 1. A zero working Subdivision is treated as
/// denominator 1 so this total helper remains safe at tolerant UI boundaries;
/// engine validation must reject that lattice before evolution.
pub fn reduced_denominator(slot: u32, working_subdivision: u32) -> u32 {
    if working_subdivision == 0 {
        return 1;
    }
    let phase = slot % working_subdivision;
    working_subdivision / gcd(phase, working_subdivision).max(1)
}

/// Barlow indigestibility scaled by 210.
///
/// For prime `p`, `210 * 2(p-1)^2/p` is integral for the admissible palette
/// primes. Composite prices add over prime factors with multiplicity. The
/// general factorizer is intentional: it remains mathematically exact when
/// evaluating an invalid external value, while validation separately limits
/// working lattices to factors 2, 3, 5, and 7.
pub fn indigestibility_scaled(value: u32) -> u32 {
    if value <= 1 {
        return 0;
    }
    let mut rest = value;
    let mut prime = 2u32;
    let mut price = 0u64;
    while u64::from(prime) * u64::from(prime) <= u64::from(rest) {
        while rest % prime == 0 {
            price = price.saturating_add(prime_indigestibility_scaled(prime));
            rest /= prime;
        }
        prime += 1;
    }
    if rest > 1 {
        price = price.saturating_add(prime_indigestibility_scaled(rest));
    }
    u32::try_from(price).unwrap_or(u32::MAX)
}

fn prime_indigestibility_scaled(prime: u32) -> u64 {
    let p = u128::from(prime);
    // Nearest integer is exact for 2/3/5/7. Keeping the general branch
    // rounded makes the total helper deterministic outside the valid domain.
    let numerator = 2 * u128::from(INDIGESTIBILITY_SCALE) * (p - 1) * (p - 1);
    u64::try_from((numerator + p / 2) / p).unwrap_or(u64::MAX)
}

/// Price the reduced denominator of one onset's within-beat position.
pub fn onset_depth(slot: u32, working_subdivision: u32) -> u32 {
    indigestibility_scaled(reduced_denominator(slot, working_subdivision))
}

/// Mean attack-point depth normalized to `0..=100_000`.
///
/// Duration is deliberately absent. Empty onset sets and invalid zero grids
/// score zero at this pure boundary; the generator's nonempty-state and
/// positive-grid invariants remain stricter.
pub fn state_complexity_milli(onset_slots: &[u32], working_subdivision: u32) -> u32 {
    if onset_slots.is_empty() || working_subdivision == 0 {
        return 0;
    }
    let maximum = indigestibility_scaled(working_subdivision);
    if maximum == 0 {
        return 0;
    }
    let total = onset_slots
        .iter()
        .map(|&slot| u128::from(onset_depth(slot, working_subdivision)))
        .sum::<u128>();
    let denominator = onset_slots.len() as u128 * u128::from(maximum);
    let rounded = (u128::from(MAX_COMPLEXITY_MILLI) * total + denominator / 2) / denominator;
    u32::try_from(rounded.min(u128::from(MAX_COMPLEXITY_MILLI))).unwrap_or(MAX_COMPLEXITY_MILLI)
}

/// Normalized Shannon entropy of the attack-point denominator inventory.
///
/// This insight-only readout distinguishes concentration on one depth level
/// from a mixture of binary, ternary, and other admitted levels. Counts are
/// order-free; the normalization ceiling is `log2(min(k, tau(W)))`, where
/// `tau(W)` is the number of possible reduced denominators (divisors of W).
/// `log2` is evaluated by a pinned 16-step integer squaring recurrence, never
/// floating point. A one-level inventory is exactly zero and the score is
/// bounded to `0..=100_000`.
pub fn depth_diversity_milli(onset_slots: &[u32], working_subdivision: u32) -> u32 {
    if onset_slots.len() <= 1 || working_subdivision == 0 {
        return 0;
    }
    let mut counts = BTreeMap::<u32, u32>::new();
    for &slot in onset_slots {
        *counts
            .entry(reduced_denominator(slot, working_subdivision))
            .or_default() += 1;
    }
    if counts.len() <= 1 {
        return 0;
    }

    let count = u32::try_from(onset_slots.len()).unwrap_or(u32::MAX);
    let weighted_log_sum = counts
        .values()
        .map(|&frequency| u128::from(frequency) * u128::from(log2_q16(frequency)))
        .sum::<u128>();
    let mean_log = (weighted_log_sum + u128::from(count) / 2) / u128::from(count);
    let entropy_q16 = u128::from(log2_q16(count)).saturating_sub(mean_log);

    let possible_levels = u32::try_from(divisors(working_subdivision).len()).unwrap_or(u32::MAX);
    let maximum_categories = count.min(possible_levels);
    let maximum_entropy_q16 = u128::from(log2_q16(maximum_categories));
    if maximum_entropy_q16 == 0 {
        return 0;
    }
    let normalized = (entropy_q16 * u128::from(MAX_COMPLEXITY_MILLI) + maximum_entropy_q16 / 2)
        / maximum_entropy_q16;
    u32::try_from(normalized.min(u128::from(MAX_COMPLEXITY_MILLI))).unwrap_or(MAX_COMPLEXITY_MILLI)
}

/// `floor(log2(value) * 2^16)` by normalized repeated squaring.
fn log2_q16(value: u32) -> u32 {
    if value <= 1 {
        return 0;
    }
    let integer = 31 - value.leading_zeros();
    let mut normalized = u128::from(value) << (63 - integer);
    let mut fraction = 0u32;
    for bit in (0..16).rev() {
        normalized = (normalized * normalized) >> 63;
        if normalized >= (1u128 << 64) {
            normalized >>= 1;
            fraction |= 1 << bit;
        }
    }
    integer * (1 << 16) + fraction
}

fn divisors(value: u32) -> Vec<u32> {
    let mut divisors = Vec::new();
    for divisor in 1..=value {
        if value % divisor == 0 {
            divisors.push(divisor);
        }
    }
    divisors
}

/// One strict depth move available to corridor normalization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DepthMoveCandidate {
    pub slot: u32,
    /// Strictly positive price change in the requested direction.
    pub depth_delta: u32,
    pub displacement: u32,
    pub placement_rank: u32,
    pub depth: u32,
}

/// Deterministically enumerate deeper target slots for one onset.
///
/// `candidate_slots` must already be silent, uncovered, in scope, and safe to
/// trial-project. `placement_ranks` is an optional slot→rank map from the
/// blended Barlow/geometric order. The result follows the normative tie-break:
/// smallest positive depth-price increase, displacement, placement rank, slot.
pub fn promotion_candidates(
    source_slot: u32,
    working_subdivision: u32,
    cycle_slots: u32,
    candidate_slots: &[u32],
    placement_ranks: &[(u32, u32)],
) -> Vec<DepthMoveCandidate> {
    if working_subdivision == 0 || cycle_slots == 0 {
        return Vec::new();
    }
    let source_depth = onset_depth(source_slot, working_subdivision);
    let source_denominator = reduced_denominator(source_slot, working_subdivision);
    let displacement_limit = working_subdivision / source_denominator.saturating_mul(2).max(1);
    let ranks = placement_ranks.iter().copied().collect::<BTreeMap<_, _>>();
    let mut candidates = candidate_slots
        .iter()
        .copied()
        .filter(|&slot| slot < cycle_slots && onset_depth(slot, working_subdivision) > source_depth)
        .filter_map(|slot| {
            let displacement = circular_distance(source_slot, slot, cycle_slots);
            (displacement <= displacement_limit).then_some(DepthMoveCandidate {
                slot,
                depth_delta: onset_depth(slot, working_subdivision) - source_depth,
                displacement,
                placement_rank: ranks.get(&slot).copied().unwrap_or(u32::MAX),
                depth: onset_depth(slot, working_subdivision),
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_unstable_by_key(|candidate| {
        (
            candidate.depth_delta,
            candidate.displacement,
            candidate.placement_rank,
            candidate.slot,
        )
    });
    candidates
}

/// Deterministically enumerate shallower target slots for one onset.
///
/// The displacement bound uses each target denominator's period, as required
/// by the Demote mirror. Smallest positive price decrease comes first, then
/// displacement, placement rank, and slot.
pub fn demotion_candidates(
    source_slot: u32,
    working_subdivision: u32,
    cycle_slots: u32,
    candidate_slots: &[u32],
    placement_ranks: &[(u32, u32)],
) -> Vec<DepthMoveCandidate> {
    if working_subdivision == 0 || cycle_slots == 0 {
        return Vec::new();
    }
    let source_depth = onset_depth(source_slot, working_subdivision);
    let ranks = placement_ranks.iter().copied().collect::<BTreeMap<_, _>>();
    let mut candidates = candidate_slots
        .iter()
        .copied()
        .filter(|&slot| slot < cycle_slots && onset_depth(slot, working_subdivision) < source_depth)
        .filter_map(|slot| {
            let target_denominator = reduced_denominator(slot, working_subdivision);
            let limit = working_subdivision / target_denominator.saturating_mul(2).max(1);
            let displacement = circular_distance(source_slot, slot, cycle_slots);
            (displacement <= limit).then_some(DepthMoveCandidate {
                slot,
                depth_delta: source_depth - onset_depth(slot, working_subdivision),
                displacement,
                placement_rank: ranks.get(&slot).copied().unwrap_or(u32::MAX),
                depth: onset_depth(slot, working_subdivision),
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_unstable_by_key(|candidate| {
        (
            candidate.depth_delta,
            candidate.displacement,
            candidate.placement_rank,
            candidate.slot,
        )
    });
    candidates
}

fn circular_distance(left: u32, right: u32, cycle_slots: u32) -> u32 {
    let left = left % cycle_slots;
    let right = right % cycle_slots;
    let direct = left.abs_diff(right);
    direct.min(cycle_slots - direct)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn palette_is_order_insensitive_deduplicated_and_bounded() {
        assert_eq!(canonical_subdivision_palette(&[]), Ok(vec![]));
        assert_eq!(canonical_subdivision_palette(&[3, 2, 3]), Ok(vec![2, 3]));
        assert_eq!(
            canonical_subdivision_palette(&[2, 3, 5]),
            Err(DepthError::TooManyPaletteLevels { count: 3 })
        );
        assert_eq!(
            canonical_subdivision_palette(&[11]),
            Err(DepthError::InvalidPaletteEntry { value: 11 })
        );
    }

    #[test]
    fn working_lattice_refines_once_per_unique_palette_prime() {
        assert_eq!(working_subdivision(4, &[]), Ok(4));
        assert_eq!(working_subdivision(4, &[2]), Ok(8));
        assert_eq!(working_subdivision(4, &[3, 2, 3]), Ok(24));
        assert_eq!(working_subdivision(1, &[5, 7]), Ok(35));
        assert_eq!(
            working_subdivision(16, &[2, 3]),
            Err(DepthError::WorkingSubdivisionTooLarge {
                working_subdivision: 96
            })
        );
    }

    #[test]
    fn scaled_indigestibility_matches_normative_vectors() {
        for (value, expected) in [
            (1, 0),
            (2, 210),
            (3, 560),
            (4, 420),
            (5, 1_344),
            (6, 770),
            (7, 2_160),
            (8, 630),
            (12, 980),
            (20, 1_764),
        ] {
            assert_eq!(indigestibility_scaled(value), expected, "value {value}");
        }
        for left in 1..=64 {
            for right in 1..=64 {
                assert_eq!(
                    indigestibility_scaled(left * right),
                    indigestibility_scaled(left) + indigestibility_scaled(right)
                );
            }
        }
    }

    #[test]
    fn general_factorization_is_order_free_and_monotone_per_prime_power() {
        for value in 1..=64 {
            assert_eq!(indigestibility_scaled(value), indigestibility_scaled(value));
            for prime in PALETTE_PRIMES {
                assert!(
                    indigestibility_scaled(value.saturating_mul(prime))
                        > indigestibility_scaled(value)
                );
            }
        }
        assert_eq!(indigestibility_scaled(4_294_967_291), u32::MAX);
    }

    #[test]
    fn onset_denominators_and_levels_are_exact() {
        assert_eq!(reduced_denominator(0, 12), 1);
        assert_eq!(reduced_denominator(6, 12), 2);
        assert_eq!(reduced_denominator(4, 12), 3);
        assert_eq!(reduced_denominator(3, 12), 4);
        assert_eq!(reduced_denominator(1, 12), 12);
        assert_eq!(onset_depth(4, 12), 560);
    }

    #[test]
    fn state_complexity_prices_attack_points_not_duration() {
        assert_eq!(state_complexity_milli(&[0, 4, 8], 4), 0);
        // Two beat starts plus one eighth-note promotion on W=8:
        // round(100000 * 210 / (3 * 630)).
        assert_eq!(state_complexity_milli(&[0, 4, 8], 8), 11_111);
        assert_eq!(state_complexity_milli(&[0, 4, 8], 12), 38_095);
        assert_eq!(state_complexity_milli(&[0, 8], 20), 38_095);
        assert_eq!(state_complexity_milli(&[1, 3, 5, 7], 8), 100_000);
    }

    #[test]
    fn beat_class_rotation_is_complexity_neutral() {
        let source = [0, 3, 8, 14, 19];
        for beats in 0..8 {
            let shifted = source
                .iter()
                .map(|slot| slot + beats * 20)
                .collect::<Vec<_>>();
            assert_eq!(
                state_complexity_milli(&shifted, 20),
                state_complexity_milli(&source, 20)
            );
        }
    }

    #[test]
    fn complexity_is_bounded_and_permutation_invariant() {
        for working in 1..=64 {
            let mut slots = (0..working).collect::<Vec<_>>();
            let complexity = state_complexity_milli(&slots, working);
            assert!(complexity <= MAX_COMPLEXITY_MILLI);
            slots.reverse();
            assert_eq!(state_complexity_milli(&slots, working), complexity);
        }
    }

    #[test]
    fn fixed_point_log_and_depth_diversity_are_pinned() {
        assert_eq!(log2_q16(1), 0);
        assert_eq!(log2_q16(2), 65_536);
        assert_eq!(log2_q16(3), 103_872);
        assert_eq!(log2_q16(5), 152_169);
        assert_eq!(log2_q16(12), 234_944);
        assert_eq!(depth_diversity_milli(&[], 12), 0);
        assert_eq!(depth_diversity_milli(&[4], 12), 0);

        let uniform_triplets = [4, 8, 16, 20];
        assert_eq!(depth_diversity_milli(&uniform_triplets, 12), 0);

        // Denominator inventory {1: 2, 2: 1, 3: 1}: entropy 1.5 bits,
        // normalized by log2(4) = 2 bits.
        let mixed = [0, 12, 6, 4];
        assert_eq!(depth_diversity_milli(&mixed, 12), 75_000);
        assert_eq!(depth_diversity_milli(&[4, 0, 6, 12], 12), 75_000);
        assert_eq!(
            depth_diversity_milli(&mixed.iter().map(|slot| slot + 12).collect::<Vec<_>>(), 12),
            75_000
        );

        // One attack at every possible denominator of W=12 reaches the
        // exact normalized maximum.
        assert_eq!(depth_diversity_milli(&[0, 6, 4, 3, 2, 1], 12), 100_000);

        for working in 1..=64 {
            assert!(
                depth_diversity_milli(&(0..working).collect::<Vec<_>>(), working)
                    <= MAX_COMPLEXITY_MILLI
            );
        }
    }

    #[test]
    fn promote_and_demote_follow_strict_price_bounds_and_ties() {
        let ranks = [(1, 2), (7, 0), (11, 1), (5, 3)];
        let promoted = promotion_candidates(6, 12, 24, &[7, 5, 11, 1], &ranks);
        assert_eq!(
            promoted
                .iter()
                .map(|candidate| candidate.slot)
                .collect::<Vec<_>>(),
            vec![7, 5]
        );
        assert!(promoted
            .iter()
            .all(|candidate| candidate.depth > onset_depth(6, 12)));

        let demoted = demotion_candidates(7, 12, 24, &[6, 8, 4, 0], &[]);
        assert_eq!(
            demoted
                .iter()
                .map(|candidate| candidate.slot)
                .collect::<Vec<_>>(),
            vec![8, 6]
        );
        assert!(demoted
            .iter()
            .all(|candidate| candidate.depth < onset_depth(7, 12)));
    }

    #[test]
    fn w12_moves_climb_and_descend_the_smallest_depth_ladder_first() {
        let promoted = promotion_candidates(6, 12, 24, &[7, 4, 3, 8, 9, 5], &[(7, 0), (5, 3)]);
        assert_eq!(
            promoted
                .iter()
                .map(|candidate| (candidate.slot, candidate.depth_delta))
                .collect::<Vec<_>>(),
            vec![(3, 210), (9, 210), (4, 350), (8, 350), (7, 770), (5, 770)]
        );

        let demoted = demotion_candidates(7, 12, 24, &[12, 6, 8], &[]);
        assert_eq!(
            demoted
                .iter()
                .map(|candidate| (candidate.slot, candidate.depth_delta))
                .collect::<Vec<_>>(),
            vec![(8, 420), (6, 770), (12, 980)]
        );
    }
}
