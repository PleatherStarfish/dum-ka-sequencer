//! Barlow indispensability (Barlow 1987, "Two Essays on Theory"; On
//! Musiquantics 2012): every pulse of a stratified meter gets a unique
//! integer rank — how damaging its removal is to the meter's identity.
//! Removing onsets in ascending rank order thins a pattern while keeping
//! its metric feel; adding at the highest-ranked empty pulses fills it the
//! same way. This is the M2 evolution engine's density backbone.
//!
//! Implementation: group starts take the top `q` ranks ordered by the
//! prime indispensability Ψ_q; every other pulse ranks by its inner
//! stratum band, ordered within the band by Barlow's pickup principle —
//! a pulse ranks by the strength of the group start that FOLLOWS it,
//! which reduces to `Ψ_q((g + 1) mod q)`. The module tests pin this
//! against Barlow's published tables for both six-pulse orders, every
//! 12-pulse order containing one ternary stratum, and 3×5.

/// Prime indispensabilities. Ψ_2/Ψ_3/Ψ_5 are printed in Barlow 1987 (CMJ
/// 11(1), p. 56); Ψ_7 is forced by the published prime formula (CMJ 1987
/// Eq. 5 ≡ On Musiquantics F32b: Ψ_p(n) = q + [q ≥ ⌊p/4⌋], with
/// q = ψ_{p−1}(n−⌊n/p⌋) over p−1 stratified largest-prime-first, and
/// Ψ_p(p−1) pinned to ⌊p/4⌋). Strata are limited to these primes;
/// `stratification` rejects larger factors so the policy falls back
/// deterministically. Extending to Ψ_11/Ψ_13 means implementing that
/// formula, not guessing.
fn prime_psi(prime: u32) -> Option<&'static [u32]> {
    match prime {
        2 => Some(&[1, 0]),
        3 => Some(&[2, 0, 1]),
        5 => Some(&[4, 0, 3, 1, 2]),
        7 => Some(&[6, 0, 4, 2, 5, 1, 3]),
        _ => None,
    }
}

/// Largest prime factor allowed in a stratification.
pub const MAX_STRATUM_PRIME: u32 = 7;

/// Factor `value` into primes, largest first (Barlow's conventional
/// stratification order for a bare number, e.g. 6 → [3, 2] i.e. 3/4 feel).
pub fn factor_descending(value: u32) -> Vec<u32> {
    let mut rest = value.max(1);
    let mut factors = Vec::new();
    let mut p = 2;
    while p * p <= rest {
        while rest % p == 0 {
            factors.push(p);
            rest /= p;
        }
        p += 1;
    }
    if rest > 1 {
        factors.push(rest);
    }
    factors.sort_unstable_by(|a, b| b.cmp(a));
    factors
}

/// The stratification of the cycle grid: the beat count's factors (largest
/// first), then the per-beat Subdivision's factors (largest first) — beats
/// divide the cycle before Subdivision divides the beat. `None` if any
/// prime factor exceeds [`MAX_STRATUM_PRIME`].
pub fn stratification(cycle_beats: u32, subdivision: u32) -> Option<Vec<u32>> {
    let mut strata = factor_descending(cycle_beats);
    strata.extend(factor_descending(subdivision));
    if strata.iter().any(|&q| prime_psi(q).is_none()) {
        return None;
    }
    Some(strata)
}

/// Indispensability ranks for every pulse of the stratified meter. The
/// result has `Π strata` entries, each rank unique in `0..len`, higher =
/// more indispensable. An empty stratification is the single pulse `[0]`.
pub fn indispensability(strata: &[u32]) -> Vec<u32> {
    let Some((&q, rest)) = strata.split_first() else {
        return vec![0];
    };
    let inner = indispensability(rest);
    let m = inner.len() as u32;
    let n = q * m;
    let psi = prime_psi(q).expect("stratification validated the primes");
    let mut ranks = vec![0u32; n as usize];
    for g in 0..q {
        for (j, &inner_rank) in inner.iter().enumerate() {
            let position = (g * m + j as u32) as usize;
            ranks[position] = if j == 0 {
                // Group starts take the top q ranks in Ψ_q order.
                (n - q) + psi[g as usize]
            } else {
                // Off-pulses: banded by the inner stratum rank, ordered
                // within the band by the strength of the following group
                // start (the pickup principle).
                inner_rank * q + psi[((g + 1) % q) as usize]
            };
        }
    }
    ranks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn published_tables_hold() {
        // Barlow 1987: 6 pulses stratified 3×2 (3/4) and 2×3 (6/8).
        assert_eq!(indispensability(&[3, 2]), vec![5, 0, 3, 1, 4, 2]);
        assert_eq!(indispensability(&[2, 3]), vec![5, 0, 2, 4, 1, 3]);
        // The paper also prints all three 12-pulse orders and a 3×5 table.
        // These exercise the recurrence beyond the original two-level,
        // 2/3-only fixtures.
        assert_eq!(
            indispensability(&[3, 2, 2]),
            vec![11, 0, 6, 3, 9, 1, 7, 4, 10, 2, 8, 5]
        );
        assert_eq!(
            indispensability(&[2, 3, 2]),
            vec![11, 0, 6, 2, 8, 4, 10, 1, 7, 3, 9, 5]
        );
        assert_eq!(
            indispensability(&[2, 2, 3]),
            vec![11, 0, 4, 8, 2, 6, 10, 1, 5, 9, 3, 7]
        );
        assert_eq!(
            indispensability(&[3, 5]),
            vec![14, 0, 9, 3, 6, 12, 1, 10, 4, 7, 13, 2, 11, 5, 8]
        );
        // The classic 4- and 8-pulse duple tables.
        assert_eq!(indispensability(&[2, 2]), vec![3, 0, 2, 1]);
        assert_eq!(indispensability(&[2, 2, 2]), vec![7, 0, 4, 2, 6, 1, 5, 3]);
        // Bare primes are their Ψ tables.
        assert_eq!(indispensability(&[2]), vec![1, 0]);
        assert_eq!(indispensability(&[3]), vec![2, 0, 1]);
        assert_eq!(indispensability(&[5]), vec![4, 0, 3, 1, 2]);
        assert_eq!(indispensability(&[7]), vec![6, 0, 4, 2, 5, 1, 3]);
        // Composite coverage catches propagation of the prime-7 table through
        // the pickup-rule recurrence, not only the bare-prime base case.
        assert_eq!(
            indispensability(&[7, 2]),
            vec![13, 0, 7, 4, 11, 2, 9, 5, 12, 1, 8, 3, 10, 6]
        );
    }

    #[test]
    fn every_rank_is_unique_and_dense() {
        for strata in [
            vec![2u32, 2, 2, 2],
            vec![3, 2, 2],
            vec![5, 2],
            vec![2, 5],
            vec![7, 3],
            vec![3, 5, 2],
        ] {
            let ranks = indispensability(&strata);
            let n = strata.iter().product::<u32>() as usize;
            assert_eq!(ranks.len(), n);
            let mut seen = vec![false; n];
            for &rank in &ranks {
                assert!(!seen[rank as usize], "duplicate rank in {strata:?}");
                seen[rank as usize] = true;
            }
            assert_eq!(ranks[0], n as u32 - 1, "pulse zero is most indispensable");
        }
    }

    #[test]
    fn stratification_orders_beats_before_subdivision() {
        assert_eq!(stratification(4, 4), Some(vec![2, 2, 2, 2]));
        assert_eq!(stratification(6, 2), Some(vec![3, 2, 2]));
        assert_eq!(stratification(4, 20), Some(vec![2, 2, 5, 2, 2]));
        assert_eq!(stratification(3, 7), Some(vec![3, 7]));
        // Prime factors beyond 7 have no published Ψ table here.
        assert_eq!(stratification(11, 4), None);
        assert_eq!(stratification(4, 13), None);
    }

    #[test]
    fn factoring_is_descending() {
        assert_eq!(factor_descending(1), Vec::<u32>::new());
        assert_eq!(factor_descending(12), vec![3, 2, 2]);
        assert_eq!(factor_descending(20), vec![5, 2, 2]);
        assert_eq!(factor_descending(7), vec![7]);
    }

    /// Cross-language pin for the editor's algorithm-insight lanes: the TS
    /// mirror (`ui/src/dumkaMetrics.ts`) must reproduce stratification,
    /// indispensability ranks, and Sioros metrical levels for this grid
    /// corpus byte-for-byte, the same scheme as the parser contract fixture
    /// in tree.rs. Regenerate intentionally with
    /// `UPDATE_DTO_FIXTURES=1 cargo test -p cseq-rhythm rust_metrics_contract_fixture_matches`.
    #[test]
    fn rust_metrics_contract_fixture_matches() {
        use super::super::evolve::{EvolutionState, EvolvedOnset};
        use super::super::perceptual::PerceptualContext;
        use super::super::sioros::metrical_levels;
        use super::super::spectrum::{
            blended_order, cosine_table, geometric_add_order, geometric_remove_order,
            normalized_ranks,
        };

        let grids: Vec<(u32, u32)> = vec![
            (1, 1),
            (2, 1),
            (3, 1),
            (4, 1),
            (4, 2),
            (4, 4),
            (4, 5),
            (4, 16),
            (4, 20),
            (3, 2),
            (2, 3),
            (5, 4),
            (6, 4),
            (7, 1),
            (8, 8),
            (9, 2),
            (12, 2),
            (16, 4),
            // Prime factors beyond the published Ψ tables: the engine plays
            // the seed verbatim and the UI must say so instead of guessing.
            (11, 1),
            (4, 13),
        ];
        let metrical_cases = grids
            .into_iter()
            .map(|(cycle_beats, subdivision)| {
                let entry = match stratification(cycle_beats, subdivision) {
                    Some(strata) => serde_json::json!({
                        "strata": strata,
                        "ranks": indispensability(&strata),
                        "levels": metrical_levels(&strata),
                        "beatLevel": factor_descending(cycle_beats).len() as u32,
                    }),
                    None => serde_json::json!(null),
                };
                serde_json::json!({
                    "cycleBeats": cycle_beats,
                    "subdivision": subdivision,
                    "metrics": entry,
                })
            })
            .collect::<Vec<_>>();
        let table_periods = [8u32, 12, 16, 20, 24, 48, 60, 64];
        let spectrum_tables = table_periods
            .into_iter()
            .map(|period| {
                let harmonics = cosine_table(period)
                    .into_iter()
                    .take(4)
                    .map(|row| {
                        serde_json::json!({
                            "harmonic": row.harmonic,
                            // Five phase samples cross-pin the root
                            // recurrence without duplicating the full 64×16
                            // lookup table in a display-only contract.
                            "cosinePrefix": row.cosine.into_iter().take(5).collect::<Vec<_>>(),
                            "sinePrefix": row.sine.into_iter().take(5).collect::<Vec<_>>(),
                        })
                    })
                    .collect::<Vec<_>>();
                serde_json::json!({
                    "period": period,
                    "harmonics": harmonics,
                })
            })
            .collect::<Vec<_>>();

        let spectrum_cases = [
            (8u32, vec![], (0..8).collect::<Vec<_>>()),
            (8, vec![0, 4], vec![1, 2, 3, 5, 6, 7]),
            (12, vec![0, 4, 8], vec![1, 2, 3, 5, 6, 7, 9, 10, 11]),
            (20, vec![0, 8, 16], vec![1, 4, 6, 10, 12, 18]),
            (24, vec![0, 6, 12, 18], vec![1, 3, 8, 10, 14, 16, 20, 22]),
        ]
        .into_iter()
        .map(|(period, onsets, add_candidates)| {
            let geometric_add = geometric_add_order(period, &onsets, &add_candidates);
            let geometric_remove = geometric_remove_order(period, &onsets, &onsets);
            let mut metric_add = add_candidates.clone();
            metric_add.sort_unstable();
            let mut metric_remove = onsets.clone();
            metric_remove.sort_unstable();
            serde_json::json!({
                "period": period,
                "onsets": onsets,
                "addCandidates": add_candidates,
                "geometricAddOrder": geometric_add,
                "geometricRemoveOrder": geometric_remove,
                "normalizedAddRanks": normalized_ranks(&geometric_add),
                "blend0": blended_order(&metric_add, &geometric_add, 0),
                "blend50": blended_order(&metric_add, &geometric_add, 50),
                "blend100": blended_order(&metric_add, &geometric_add, 100),
            })
        })
        .collect::<Vec<_>>();

        // The weighted fixed-point fingerprint is intentionally not plain
        // Bjorklund at every cardinality. This W=8 greedy path is the pinned
        // k=4 divergence called out in the M3.95 design review.
        let mut fingerprint_onsets = Vec::new();
        while fingerprint_onsets.len() < 4 {
            let candidates = (0..8)
                .filter(|slot| !fingerprint_onsets.contains(slot))
                .collect::<Vec<_>>();
            let next = geometric_add_order(8, &fingerprint_onsets, &candidates)[0];
            fingerprint_onsets.push(next);
        }
        assert_eq!(fingerprint_onsets, vec![0, 4, 1, 6]);

        // §M3.97 property lanes: the six read-only per-state functionals. The
        // TS mirror (`dumkaMetrics.stateProperties`) must reproduce every
        // field byte-for-byte, so the engine emits reference profiles for
        // representative realized states — an even polygon (evenness maxed,
        // syncopation nil), sustains (occupancy above density), a syncopated
        // set, a rotated multi-beat state, and a grid whose primes exceed the
        // published tables (no profile, exactly as the fold reports none).
        // (cycle_beats, subdivision, [(slot, dur), …], rotation_beats)
        type PropertySpec = (u32, u32, Vec<(u32, u32)>, u32);
        let property_specs: Vec<PropertySpec> = vec![
            (1, 8, vec![(0, 1), (2, 1), (4, 1), (6, 1)], 0),
            (1, 8, vec![(0, 4), (4, 2)], 0),
            (1, 8, vec![(0, 1), (3, 1)], 0),
            (1, 8, vec![], 0),
            (2, 8, vec![(0, 3), (5, 1), (11, 2)], 1),
            (4, 4, vec![(0, 1), (4, 1), (8, 1), (12, 1)], 0),
            // Whole-cycle period above the old per-beat 64-slot spectrum cap.
            // One onset per beat is a regular octagon and must remain maximally
            // even rather than silently collapsing to zero.
            (
                8,
                9,
                vec![
                    (0, 1),
                    (9, 1),
                    (18, 1),
                    (27, 1),
                    (36, 1),
                    (45, 1),
                    (54, 1),
                    (63, 1),
                ],
                0,
            ),
            (3, 2, vec![(0, 1), (2, 1), (4, 1)], 0),
            (4, 13, vec![(0, 1)], 0),
        ];
        let property_profiles = property_specs
            .into_iter()
            .map(|(cycle_beats, subdivision, onsets, rotation_beats)| {
                let profile = stratification(cycle_beats, subdivision)
                    .and_then(|strata| {
                        PerceptualContext::new(
                            cycle_beats,
                            subdivision,
                            indispensability(&strata),
                            metrical_levels(&strata),
                        )
                        .ok()
                    })
                    .map(|context| {
                        let state = EvolutionState {
                            onsets: onsets
                                .iter()
                                .map(|&(slot, dur)| EvolvedOnset {
                                    slot,
                                    dur,
                                    class: "x".to_owned(),
                                })
                                .collect(),
                            rotation_beats,
                        };
                        context.state_properties(&state)
                    });
                serde_json::json!({
                    "cycleBeats": cycle_beats,
                    "subdivision": subdivision,
                    "rotationBeats": rotation_beats,
                    "onsets": onsets
                        .iter()
                        .map(|&(slot, dur)| vec![slot, dur])
                        .collect::<Vec<_>>(),
                    "profile": profile,
                })
            })
            .collect::<Vec<_>>();

        let contract = serde_json::json!({
            "metricalCases": metrical_cases,
            "spectrum": {
                "q16One": super::super::spectrum::Q16_ONE,
                "maxHarmonics": super::super::spectrum::MAX_HARMONICS,
                "tables": spectrum_tables,
                "cases": spectrum_cases,
                "greedyW8K4Fingerprint": fingerprint_onsets,
            },
            "propertyProfiles": property_profiles,
        });
        let rendered = format!(
            "{}\n",
            serde_json::to_string_pretty(&contract).expect("serialize metrics contract")
        );
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../ui/src/__fixtures__/dumka_metrics_contract.json");
        if std::env::var("UPDATE_DTO_FIXTURES").is_ok() {
            std::fs::write(&path, &rendered).expect("update Dum-Ka metrics contract fixture");
        } else {
            let checked_in = std::fs::read_to_string(&path).unwrap_or_else(|_| {
                panic!(
                    "missing {}; regenerate with UPDATE_DTO_FIXTURES=1 cargo test -p cseq-rhythm rust_metrics_contract_fixture_matches",
                    path.display()
                )
            });
            assert_eq!(
                checked_in, rendered,
                "Rust metrics contract changed; regenerate intentionally with UPDATE_DTO_FIXTURES=1"
            );
        }
    }
}
