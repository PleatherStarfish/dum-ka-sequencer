//! Euclidean reshape — redistributing a window's onsets onto a maximally
//! even necklace, with the extension set carried over from Caesura
//! (carnatic-seq `cseq-rhythm`): rotation, burst clustering
//! (`bjorklund_burst_mask`, moinsound 2022), inversion (mask complement —
//! Toussaint: the complement of a Euclidean rhythm is again Euclidean),
//! and the Silent/Tied rest policy (`EuclideanRestPolicy` in Caesura's
//! model). The mask builders themselves are the platform's own
//! `bjorklund_mask`/`bjorklund_burst_mask` (crate root), inherited verbatim
//! from Caesura and pinned there against the published vectors, so this
//! module adds no third implementation.
//!
//! Scope ("every level"): candidate windows are each whole beat plus the
//! whole cycle. A window is a candidate only when no sustain straddles its
//! edge and it holds at least one onset. Reshaping preserves the window's
//! onset count (and stroke classes, in order) unless inversion fires, which
//! complements the mask — both paths stay behind the drift leash and trial
//! projection like every other operator.

use crate::{bjorklund_burst_mask, bjorklund_mask};

use super::evolve::{EvolutionState, EvolvedOnset};
use super::plan::SlotRange;
use serde::{Deserialize, Serialize};

/// How reshaped onsets fill time, mirroring Caesura's `EuclideanRestPolicy`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum EuclidRestPolicy {
    /// One-slot hits; the gaps are literal rests.
    Silent,
    /// Each onset sustains to the next onset (or the window end) — the
    /// duration-covering style Fragment also uses.
    #[default]
    Tied,
}

/// A reshapeable window on the state's slot grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReshapeWindow {
    pub start: u32,
    pub len: u32,
}

fn window_onsets(state: &EvolutionState, window: &ReshapeWindow) -> Option<Vec<usize>> {
    let end = window.start + window.len;
    let mut indices = Vec::new();
    for (index, onset) in state.onsets.iter().enumerate() {
        let onset_end = onset.slot.saturating_add(onset.dur);
        let inside = onset.slot >= window.start && onset_end <= end;
        let outside = onset_end <= window.start || onset.slot >= end;
        if inside {
            indices.push(index);
        } else if !outside {
            // A sustain straddling the window edge disqualifies the window.
            return None;
        }
    }
    Some(indices)
}

/// Candidate windows ordered strongest-interior-pulse first (the same
/// Barlow ordering as the figure intervals; the temperature pool widens
/// over it). Each whole beat, then the whole cycle when it spans more than
/// one beat; windows with straddling sustains or zero onsets drop out.
pub fn ranked_reshape_windows(
    state: &EvolutionState,
    beats: u32,
    subdivision: u32,
    ranks: &[u32],
    scope: Option<SlotRange>,
) -> Vec<ReshapeWindow> {
    let mut windows = Vec::new();
    for beat in 0..beats {
        windows.push(ReshapeWindow {
            start: beat * subdivision,
            len: subdivision,
        });
    }
    if beats > 1 {
        windows.push(ReshapeWindow {
            start: 0,
            len: beats * subdivision,
        });
    }
    windows.retain(|window| {
        window.len >= 2
            && scope.map_or(true, |scope| {
                scope.contains_interval(window.start, window.start.saturating_add(window.len))
            })
            && matches!(window_onsets(state, window), Some(indices) if !indices.is_empty())
    });
    let interior_best = |window: &ReshapeWindow| -> u32 {
        (window.start..window.start + window.len)
            .map(|slot| ranks[slot as usize])
            .max()
            .unwrap_or(0)
    };
    windows.sort_by_key(|window| (std::cmp::Reverse(interior_best(window)), window.start));
    windows
}

/// Options for one reshape application; every stochastic choice is drawn by
/// the caller (evolve.rs) from its identity-seeded salts.
#[derive(Debug, Clone, Copy)]
pub struct ReshapeOptions {
    /// Rotate the mask later by this many slots (0..window.len).
    pub rotation: u32,
    /// Burst run cap: 1 = plain Bjorklund; >1 clusters onsets into runs of
    /// at most this length (Caesura's `bjorklund_burst_mask`).
    pub max_run: u32,
    /// Complement the mask after rotation (Caesura's `invert`): the
    /// window's k onsets become n−k.
    pub invert: bool,
    pub rest_policy: EuclidRestPolicy,
}

/// Redistribute the window's onsets onto the option-shaped necklace.
/// Returns `None` when the window is not a candidate (straddled edge, no
/// onsets, or an inverted mask with no onsets left while the rest of the
/// state is also empty — the all-rests guard belongs to the caller's
/// projection, but a fully empty state is never produced here).
pub fn apply_reshape(
    state: &EvolutionState,
    window: &ReshapeWindow,
    options: &ReshapeOptions,
) -> Option<EvolutionState> {
    let indices = window_onsets(state, window)?;
    if indices.is_empty() {
        return None;
    }
    let n = window.len;
    let k = indices.len() as u32;
    let mut mask = if options.max_run > 1 {
        bjorklund_burst_mask(k, n, options.max_run)
    } else {
        bjorklund_mask(k, n)
    };
    let mask_len = mask.len();
    if mask_len > 0 {
        mask.rotate_right((options.rotation as usize) % mask_len);
    }
    if options.invert {
        for bit in &mut mask {
            *bit = !*bit;
        }
    }
    let positions: Vec<u32> = mask
        .iter()
        .enumerate()
        .filter_map(|(slot, &sounds)| sounds.then_some(window.start + slot as u32))
        .collect();
    if positions.is_empty() && state.onsets.len() == indices.len() {
        return None;
    }

    // Classes carry over in order, cycling when inversion grows the count.
    let classes: Vec<String> = indices
        .iter()
        .map(|&index| state.onsets[index].class.clone())
        .collect();
    let window_end = window.start + window.len;
    let mut replacement = Vec::with_capacity(positions.len());
    for (order, &slot) in positions.iter().enumerate() {
        let dur = match options.rest_policy {
            EuclidRestPolicy::Silent => 1,
            EuclidRestPolicy::Tied => {
                positions.get(order + 1).copied().unwrap_or(window_end) - slot
            }
        };
        replacement.push(EvolvedOnset {
            slot,
            dur,
            class: classes[order % classes.len()].clone(),
        });
    }

    let mut next = state.clone();
    // indices are ascending; remove back-to-front, then insert sorted.
    for &index in indices.iter().rev() {
        next.onsets.remove(index);
    }
    for onset in replacement {
        let insert_at = next
            .onsets
            .iter()
            .position(|existing| existing.slot > onset.slot)
            .unwrap_or(next.onsets.len());
        next.onsets.insert(insert_at, onset);
    }
    Some(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn onset(slot: u32, dur: u32, class: &str) -> EvolvedOnset {
        EvolvedOnset {
            slot,
            dur,
            class: class.to_string(),
        }
    }

    fn state(onsets: Vec<EvolvedOnset>) -> EvolutionState {
        EvolutionState {
            onsets,
            rotation_beats: 0,
        }
    }

    fn slots_of(state: &EvolutionState) -> Vec<u32> {
        state.onsets.iter().map(|o| o.slot).collect()
    }

    #[test]
    fn beat_windows_and_cycle_window_are_candidates() {
        // 2 beats × 8: onsets in beat 0 only.
        let s = state(vec![onset(0, 1, "dum"), onset(3, 1, "ka")]);
        let ranks: Vec<u32> = (0..16).rev().collect();
        let windows = ranked_reshape_windows(&s, 2, 8, &ranks, None);
        let as_tuples: Vec<(u32, u32)> = windows.iter().map(|w| (w.start, w.len)).collect();
        // Beat 1 has no onsets and drops out; beat 0 and the cycle remain.
        assert!(as_tuples.contains(&(0, 8)));
        assert!(as_tuples.contains(&(0, 16)));
        assert_eq!(as_tuples.len(), 2);
    }

    #[test]
    fn straddling_sustains_disqualify_a_window() {
        // A sustain crossing the beat boundary blocks both beat windows but
        // not the whole-cycle window.
        let s = state(vec![onset(6, 4, "dum")]);
        let ranks = vec![0u32; 16];
        let windows = ranked_reshape_windows(&s, 2, 8, &ranks, None);
        assert_eq!(
            windows,
            vec![ReshapeWindow { start: 0, len: 16 }],
            "only the cycle window survives"
        );
    }

    #[test]
    fn scope_keeps_only_fully_contained_reshape_windows() {
        let s = state(vec![onset(0, 1, "dum"), onset(9, 1, "ka")]);
        let ranks: Vec<u32> = (0..16).collect();
        let scope = SlotRange { start: 8, end: 16 };
        assert_eq!(
            ranked_reshape_windows(&s, 2, 8, &ranks, Some(scope)),
            vec![ReshapeWindow { start: 8, len: 8 }]
        );
    }

    #[test]
    fn plain_reshape_preserves_count_and_classes_in_order() {
        // Clustered onsets at 0,1,2 in an 8-slot beat reshape to E(3,8).
        let s = state(vec![
            onset(0, 1, "dum"),
            onset(1, 1, "ka"),
            onset(2, 1, "x"),
        ]);
        let window = ReshapeWindow { start: 0, len: 8 };
        let options = ReshapeOptions {
            rotation: 0,
            max_run: 1,
            invert: false,
            rest_policy: EuclidRestPolicy::Silent,
        };
        let next = apply_reshape(&s, &window, &options).unwrap();
        assert_eq!(slots_of(&next), vec![0, 3, 6], "E(3,8) tresillo");
        let classes: Vec<&str> = next.onsets.iter().map(|o| o.class.as_str()).collect();
        assert_eq!(classes, vec!["dum", "ka", "x"]);
        assert!(next.onsets.iter().all(|o| o.dur == 1), "silent policy");
    }

    #[test]
    fn tied_policy_covers_the_window() {
        let s = state(vec![
            onset(0, 1, "dum"),
            onset(1, 1, "ka"),
            onset(2, 1, "x"),
        ]);
        let window = ReshapeWindow { start: 0, len: 8 };
        let options = ReshapeOptions {
            rotation: 0,
            max_run: 1,
            invert: false,
            rest_policy: EuclidRestPolicy::Tied,
        };
        let next = apply_reshape(&s, &window, &options).unwrap();
        let durs: Vec<u32> = next.onsets.iter().map(|o| o.dur).collect();
        assert_eq!(durs, vec![3, 3, 2], "sustain to next onset / window end");
    }

    #[test]
    fn burst_clustering_and_rotation_follow_the_caesura_masks() {
        // 5 onsets in 13 slots with max_run 3: the moinsound worked example
        // 1110000110000 (pinned upstream in the platform mask tests).
        let s = state((0..5).map(|i| onset(i, 1, "x")).collect());
        let window = ReshapeWindow { start: 0, len: 13 };
        let options = ReshapeOptions {
            rotation: 0,
            max_run: 3,
            invert: false,
            rest_policy: EuclidRestPolicy::Silent,
        };
        let next = apply_reshape(&s, &window, &options).unwrap();
        assert_eq!(slots_of(&next), vec![0, 1, 2, 7, 8]);

        let rotated = apply_reshape(
            &s,
            &window,
            &ReshapeOptions {
                rotation: 2,
                ..options
            },
        )
        .unwrap();
        assert_eq!(
            slots_of(&rotated),
            vec![2, 3, 4, 9, 10],
            "rotated later by 2"
        );
    }

    #[test]
    fn inversion_complements_the_mask_and_cycles_classes() {
        // E(3,8) inverted → the five complementary slots sound.
        let s = state(vec![
            onset(0, 1, "dum"),
            onset(3, 1, "ka"),
            onset(6, 1, "x"),
        ]);
        let window = ReshapeWindow { start: 0, len: 8 };
        let options = ReshapeOptions {
            rotation: 0,
            max_run: 1,
            invert: true,
            rest_policy: EuclidRestPolicy::Silent,
        };
        let next = apply_reshape(&s, &window, &options).unwrap();
        assert_eq!(slots_of(&next), vec![1, 2, 4, 5, 7]);
        let classes: Vec<&str> = next.onsets.iter().map(|o| o.class.as_str()).collect();
        assert_eq!(classes, vec!["dum", "ka", "x", "dum", "ka"], "cycled");
    }

    #[test]
    fn outside_onsets_survive_untouched() {
        let s = state(vec![
            onset(0, 1, "dum"),
            onset(1, 1, "dum"),
            onset(9, 2, "ka"),
        ]);
        let window = ReshapeWindow { start: 0, len: 8 };
        let options = ReshapeOptions {
            rotation: 0,
            max_run: 1,
            invert: false,
            rest_policy: EuclidRestPolicy::Silent,
        };
        let next = apply_reshape(&s, &window, &options).unwrap();
        assert_eq!(slots_of(&next), vec![0, 4, 9], "E(2,8) inside, ka outside");
        assert_eq!(next.onsets[2], onset(9, 2, "ka"));
    }
}
