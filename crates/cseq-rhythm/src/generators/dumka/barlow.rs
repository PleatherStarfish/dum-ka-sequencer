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
        use super::super::sioros::metrical_levels;

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
        let cases = grids
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
        let rendered = format!(
            "{}\n",
            serde_json::to_string_pretty(&cases).expect("serialize metrics contract")
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
