//! Fragmentation and consolidation — the duration-structure operator pair.
//!
//! Primary source: Mongeau & Sankoff 1990, *Comparison of Musical
//! Sequences* (Computers and the Humanities 24), which defines
//! **fragmentation** (one note replaced by several shorter ones) and
//! **consolidation** (several notes replaced by one longer one) as edit
//! operations distinct from insertion/deletion. This module applies the
//! pair on the evolution state's slot grid; hierarchy comes for free
//! (fragmenting a multi-beat interval is the same rule over a larger
//! window — the GTTM time-span framing, see docs/DUMKA_FIGURES.md).
//!
//! Placement inside an interval uses the Bjorklund necklace `E(k, n)`
//! (Toussaint): a true equal tuplet whenever `k` divides `n`, the
//! maximally even on-grid figure otherwise. Nothing is emitted finer than
//! the resolved working grid; subdivision palettes refine that grid before
//! evolution, while off-working-grid or continuous timing remains gated.
//!
//! Exactness contract: `apply_consolidate` inverts `apply_fragment` on any
//! sounding interval (`fragment_then_consolidate_is_identity` proves it
//! exhaustively). Fragmenting a SILENT run is the generalized Add — its
//! inverse is Remove/Consolidate compositions, not a single op — and is
//! deliberately not part of the exact-inverse claim.

use super::euclid::bjorklund;
use super::evolve::{EvolutionState, EvolvedOnset};
use super::plan::SlotRange;

/// UI-facing cap on figure size, matching the notation's 64-slot Euclid
/// cap; intervals longer than this still fragment, just never into more
/// than 64 pieces.
pub const MAX_FIGURE_K: u32 = 64;

/// A fragmentable interval on the state's grid. `onset_index` is the
/// sounding note being split, or `None` for a maximal silent run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FigureInterval {
    pub start: u32,
    pub len: u32,
    pub onset_index: Option<usize>,
}

/// A consolidatable run: `count ≥ 2` contiguous onsets starting at
/// `first_index` with no silence between them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConsolidateRun {
    pub first_index: usize,
    pub count: usize,
}

/// Every fragmentable interval, ordered strongest-interior-pulse first
/// (descending Barlow rank of the best pulse the figure would newly
/// articulate, ties by start). The temperature pool then widens over this
/// order exactly as it does for the Add/Remove candidate lists.
pub fn ranked_fragment_intervals(
    state: &EvolutionState,
    slots: u32,
    ranks: &[u32],
    window: Option<SlotRange>,
) -> Vec<FigureInterval> {
    let mut intervals = Vec::new();
    let mut cursor = 0u32;
    for (index, onset) in state.onsets.iter().enumerate() {
        if onset.slot > cursor && onset.slot - cursor >= 2 {
            intervals.push(FigureInterval {
                start: cursor,
                len: onset.slot - cursor,
                onset_index: None,
            });
        }
        if onset.dur >= 2 {
            intervals.push(FigureInterval {
                start: onset.slot,
                len: onset.dur,
                onset_index: Some(index),
            });
        }
        cursor = cursor.max(onset.slot.saturating_add(onset.dur));
    }
    if slots > cursor && slots - cursor >= 2 {
        intervals.push(FigureInterval {
            start: cursor,
            len: slots - cursor,
            onset_index: None,
        });
    }
    // A rotated state may be physically projectable even when one onset's
    // unrotated interval crosses the cycle fence. That interval cannot be
    // fragmented on this linear metric frame: its interior would include a
    // slot outside both the grid and `ranks`. Leave it to the rotation and
    // projection guards instead of indexing one rank past the cycle.
    intervals.retain(|interval| {
        interval
            .start
            .checked_add(interval.len)
            .is_some_and(|end| end <= slots)
    });
    if let Some(window) = window {
        intervals.retain(|interval| {
            window.contains_interval(interval.start, interval.start.saturating_add(interval.len))
        });
    }
    let interior_best = |interval: &FigureInterval| -> u32 {
        (interval.start + 1..interval.start + interval.len)
            .map(|slot| ranks[slot as usize])
            .max()
            .unwrap_or(0)
    };
    intervals.sort_by_key(|interval| (std::cmp::Reverse(interior_best(interval)), interval.start));
    intervals
}

/// Every maximal contiguous sounding run of ≥ 2 onsets, ordered
/// weakest-attachment first (ascending minimum rank over the onsets the
/// merge would remove, ties by start slot).
pub fn ranked_consolidate_runs(
    state: &EvolutionState,
    ranks: &[u32],
    window: Option<SlotRange>,
) -> Vec<ConsolidateRun> {
    let mut runs = Vec::new();
    let mut index = 0usize;
    while index < state.onsets.len() {
        let mut count = 1usize;
        while index + count < state.onsets.len() {
            let previous = &state.onsets[index + count - 1];
            let next = &state.onsets[index + count];
            if previous.slot.saturating_add(previous.dur) == next.slot {
                count += 1;
            } else {
                break;
            }
        }
        if count >= 2 {
            let start = state.onsets[index].slot;
            let last = &state.onsets[index + count - 1];
            let end = last.slot.saturating_add(last.dur);
            if window.is_some_and(|scope| !scope.contains_interval(start, end)) {
                index += count;
                continue;
            }
            runs.push(ConsolidateRun {
                first_index: index,
                count,
            });
        }
        index += count;
    }
    let removed_weakest = |run: &ConsolidateRun| -> u32 {
        state.onsets[run.first_index + 1..run.first_index + run.count]
            .iter()
            .map(|onset| ranks[onset.slot as usize])
            .min()
            .unwrap_or(u32::MAX)
    };
    runs.sort_by_key(|run| (removed_weakest(run), state.onsets[run.first_index].slot));
    runs
}

/// Figure sizes for an `len`-slot interval, simplest-first: divisors of
/// `len` ascending (true equal tuplets, including `len` itself — the full
/// roll), then non-divisors ascending (maximally even `E(k, len)`),
/// everything capped at [`MAX_FIGURE_K`]. `fillComplexity` widens a pool
/// over this order, so 0 always picks the simplest true tuplet.
pub fn k_candidates(len: u32) -> Vec<u32> {
    let cap = len.min(MAX_FIGURE_K);
    let mut divisors: Vec<u32> = (2..=cap).filter(|k| len % k == 0).collect();
    let non_divisors: Vec<u32> = (2..=cap).filter(|k| len % k != 0).collect();
    divisors.extend(non_divisors);
    divisors
}

/// Onset offsets of the `E(k, len)` necklace within the interval
/// (offset 0 is always an onset).
pub fn fragment_positions(len: u32, k: u32) -> Vec<u32> {
    bjorklund(k, len)
        .iter()
        .enumerate()
        .filter_map(|(slot, &sounds)| sounds.then_some(slot as u32))
        .collect()
}

/// Replace `interval` with its `E(k, len)` figure. A sounding interval's
/// fragments all carry the split note's stroke class (the first fragment
/// IS the original onset, shortened); a silent interval's fragments
/// inherit the preceding stroke class like Add, `fill_class` being that
/// precomputed class. Fragments sustain to the next fragment boundary, so
/// the interval stays exactly covered.
pub fn apply_fragment(state: &EvolutionState, interval: &FigureInterval, k: u32) -> EvolutionState {
    let positions = fragment_positions(interval.len, k);
    let mut fragments = Vec::with_capacity(positions.len());
    for (index, &position) in positions.iter().enumerate() {
        let end = positions.get(index + 1).copied().unwrap_or(interval.len);
        fragments.push(EvolvedOnset {
            slot: interval.start + position,
            dur: end - position,
        });
    }
    let mut next = state.clone();
    if let Some(index) = interval.onset_index {
        next.onsets.splice(index..=index, fragments);
    } else {
        let insert_at = next
            .onsets
            .iter()
            .position(|onset| onset.slot > interval.start)
            .unwrap_or(next.onsets.len());
        next.onsets.splice(insert_at..insert_at, fragments);
    }
    next
}

/// Merge the run into one note: the first onset's slot, the run's combined
/// duration. Exact inverse of `apply_fragment` on a sounding interval.
pub fn apply_consolidate(state: &EvolutionState, run: &ConsolidateRun) -> EvolutionState {
    let mut next = state.clone();
    let combined: u32 = next.onsets[run.first_index..run.first_index + run.count]
        .iter()
        .map(|onset| onset.dur)
        .sum();
    let merged = EvolvedOnset {
        slot: next.onsets[run.first_index].slot,
        dur: combined,
    };
    next.onsets
        .splice(run.first_index..run.first_index + run.count, [merged]);
    next
}

#[cfg(test)]
mod tests {
    use super::*;

    fn onset(slot: u32, dur: u32, _class: &str) -> EvolvedOnset {
        EvolvedOnset { slot, dur }
    }

    fn state(onsets: Vec<EvolvedOnset>) -> EvolutionState {
        EvolutionState {
            onsets,
            rotation_beats: 0,
        }
    }

    #[test]
    fn interval_scan_finds_sustains_and_silent_runs() {
        // Grid of 12: note(0,4) rest(4..6) note(6,1) note(7,1) rest(8..12).
        let s = state(vec![
            onset(0, 4, "dum"),
            onset(6, 1, "ka"),
            onset(7, 1, "ka"),
        ]);
        let ranks: Vec<u32> = (0..12).rev().collect(); // strictly decreasing
        let intervals = ranked_fragment_intervals(&s, 12, &ranks, None);
        let as_tuples: Vec<(u32, u32, bool)> = intervals
            .iter()
            .map(|i| (i.start, i.len, i.onset_index.is_some()))
            .collect();
        // Strongest interior pulse wins: the sustain's interior starts at
        // slot 1 (rank 10), then the 4..6 gap (rank 7), then 8..12 (rank 3).
        assert_eq!(as_tuples, vec![(0, 4, true), (4, 2, false), (8, 4, false)]);
    }

    #[test]
    fn rotated_onset_crossing_unrotated_cycle_fence_is_not_fragmentable() {
        // On W=2 over four beats, rotating this state forward one beat makes
        // the final onset physically span slots 1..3. In the unrotated
        // operator frame it remains 7..9 and therefore cannot be ranked or
        // fragmented against the eight-slot grid.
        let mut s = state(vec![onset(0, 2, "dum"), onset(7, 2, "ka")]);
        s.rotation_beats = 1;
        let ranks: Vec<u32> = (0..8).rev().collect();

        let intervals = ranked_fragment_intervals(&s, 8, &ranks, None);

        assert!(intervals
            .iter()
            .all(|interval| interval.start + interval.len <= 8));
        assert!(!intervals
            .iter()
            .any(|interval| interval.onset_index == Some(1)));
    }

    #[test]
    fn consolidate_runs_require_contiguity() {
        let s = state(vec![
            onset(0, 2, "dum"),
            onset(2, 1, "dum"),
            onset(3, 1, "dum"),
            onset(6, 1, "ka"),
            onset(7, 1, "ka"),
        ]);
        let ranks = vec![0u32; 12];
        let runs = ranked_consolidate_runs(&s, &ranks, None);
        let as_tuples: Vec<(usize, usize)> =
            runs.iter().map(|r| (r.first_index, r.count)).collect();
        assert!(as_tuples.contains(&(0, 3)));
        assert!(as_tuples.contains(&(3, 2)));
        assert_eq!(as_tuples.len(), 2);
    }

    #[test]
    fn scoped_candidates_are_fully_contained() {
        let s = state(vec![
            onset(0, 4, "dum"),
            onset(4, 2, "ka"),
            onset(6, 1, "x"),
            onset(10, 2, "dum"),
        ]);
        let ranks: Vec<u32> = (0..12).collect();
        let scope = SlotRange { start: 4, end: 8 };
        assert!(
            ranked_fragment_intervals(&s, 12, &ranks, Some(scope))
                .iter()
                .all(|interval| scope
                    .contains_interval(interval.start, interval.start + interval.len))
        );
        assert!(ranked_consolidate_runs(&s, &ranks, Some(scope))
            .iter()
            .all(|run| {
                let start = s.onsets[run.first_index].slot;
                let last = &s.onsets[run.first_index + run.count - 1];
                scope.contains_interval(start, last.slot + last.dur)
            }));
    }

    #[test]
    fn divisors_come_first_and_are_exact() {
        assert_eq!(k_candidates(6), vec![2, 3, 6, 4, 5]);
        assert_eq!(k_candidates(5), vec![5, 2, 3, 4]);
        assert_eq!(k_candidates(2), vec![2]);
        // A divisor split is a true equal tuplet.
        assert_eq!(fragment_positions(6, 3), vec![0, 2, 4]);
        assert_eq!(fragment_positions(6, 2), vec![0, 3]);
        // A non-divisor split is the maximally even necklace.
        assert_eq!(fragment_positions(8, 3), vec![0, 3, 6]); // tresillo
    }

    #[test]
    fn fragment_covers_the_interval_exactly() {
        let s = state(vec![onset(2, 6, "dum")]);
        let interval = FigureInterval {
            start: 2,
            len: 6,
            onset_index: Some(0),
        };
        let split = apply_fragment(&s, &interval, 4);
        let covered: u32 = split.onsets.iter().map(|o| o.dur).sum();
        assert_eq!(covered, 6);
        assert_eq!(split.onsets.first().unwrap().slot, 2);
        let ends: Vec<u32> = split.onsets.iter().map(|o| o.slot + o.dur).collect();
        let starts: Vec<u32> = split.onsets.iter().skip(1).map(|o| o.slot).collect();
        assert_eq!(&ends[..ends.len() - 1], &starts[..]);
    }

    #[test]
    fn silent_fill_inherits_the_given_class_and_stays_sorted() {
        let s = state(vec![onset(0, 2, "dum"), onset(8, 2, "ka")]);
        let interval = FigureInterval {
            start: 2,
            len: 6,
            onset_index: None,
        };
        let filled = apply_fragment(&s, &interval, 3);
        let slots: Vec<u32> = filled.onsets.iter().map(|o| o.slot).collect();
        assert_eq!(slots, vec![0, 2, 4, 6, 8]);
        let covered: u32 = filled.onsets[1..4].iter().map(|o| o.dur).sum();
        assert_eq!(covered, 6);
    }

    #[test]
    fn fragment_then_consolidate_is_identity_exhaustively() {
        // Every sounding interval length 2..=12, every legal k.
        for len in 2u32..=12 {
            for k in k_candidates(len) {
                let s = state(vec![onset(1, len, "dum"), onset(len + 3, 1, "ka")]);
                let interval = FigureInterval {
                    start: 1,
                    len,
                    onset_index: Some(0),
                };
                let split = apply_fragment(&s, &interval, k);
                assert_eq!(split.onsets.len(), 1 + k as usize);
                let run = ConsolidateRun {
                    first_index: 0,
                    count: k as usize,
                };
                let merged = apply_consolidate(&split, &run);
                assert_eq!(merged, s, "len {len} k {k}");
            }
        }
    }
}
