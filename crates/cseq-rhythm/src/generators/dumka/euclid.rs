//! Bjorklund's algorithm for maximally even onset necklaces.
//!
//! This is the repeated-pairing formulation of the Euclidean algorithm
//! (Bjorklund 2003; Toussaint 2005). It produces the canonical rotation that
//! the literature cites for timelines: `E(3,8)` is the tresillo `10010010`
//! and `E(5,8)` is the cinquillo family `10110110`. The seed-notation sugar
//! `E(k,n,r)` exposes `rotate_left` steps on top of the canonical form.

/// Distribute `onsets` attacks as evenly as possible over `slots` positions.
///
/// Returns a vector of length `slots`; `true` marks an onset. `onsets` must
/// not exceed `slots` (the parser validates before calling).
pub fn bjorklund(onsets: u32, slots: u32) -> Vec<bool> {
    debug_assert!(onsets <= slots);
    let slots_usize = slots as usize;
    if slots == 0 {
        return Vec::new();
    }
    if onsets == 0 {
        return vec![false; slots_usize];
    }
    if onsets == slots {
        return vec![true; slots_usize];
    }

    let mut front: Vec<Vec<bool>> = (0..onsets).map(|_| vec![true]).collect();
    let mut back: Vec<Vec<bool>> = (0..slots - onsets).map(|_| vec![false]).collect();

    while back.len() > 1 {
        let pairs = front.len().min(back.len());
        let mut paired: Vec<Vec<bool>> = Vec::with_capacity(pairs);
        for _ in 0..pairs {
            let mut group = front.remove(0);
            group.extend(back.remove(0));
            paired.push(group);
        }
        let mut leftover: Vec<Vec<bool>> = Vec::new();
        leftover.append(&mut front);
        leftover.append(&mut back);
        front = paired;
        back = leftover;
    }

    front.into_iter().chain(back).flatten().collect()
}

/// `bjorklund` rotated left by `rotation` slots.
pub fn bjorklund_rotated(onsets: u32, slots: u32, rotation: u32) -> Vec<bool> {
    let mut pattern = bjorklund(onsets, slots);
    if !pattern.is_empty() {
        let by = (rotation as usize) % pattern.len();
        pattern.rotate_left(by);
    }
    pattern
}

#[cfg(test)]
mod tests {
    use super::*;

    fn as_string(pattern: &[bool]) -> String {
        pattern.iter().map(|&b| if b { '1' } else { '0' }).collect()
    }

    #[test]
    fn canonical_timelines_match_the_literature() {
        assert_eq!(as_string(&bjorklund(3, 8)), "10010010"); // tresillo
        assert_eq!(as_string(&bjorklund(5, 8)), "10110110"); // cinquillo family
        assert_eq!(as_string(&bjorklund(5, 16)), "1001001001001000");
        assert_eq!(as_string(&bjorklund(4, 12)), "100100100100");
    }

    #[test]
    fn degenerate_counts_are_exact() {
        assert_eq!(as_string(&bjorklund(0, 4)), "0000");
        assert_eq!(as_string(&bjorklund(4, 4)), "1111");
        assert_eq!(as_string(&bjorklund(1, 4)), "1000");
        assert!(bjorklund(0, 0).is_empty());
    }

    #[test]
    fn rotation_shifts_left_and_wraps() {
        assert_eq!(as_string(&bjorklund_rotated(3, 8, 3)), "10010100");
        assert_eq!(as_string(&bjorklund_rotated(3, 8, 8)), "10010010");
        assert_eq!(as_string(&bjorklund_rotated(3, 8, 0)), "10010010");
    }

    #[test]
    fn onset_counts_and_lengths_hold_for_all_small_pairs() {
        for slots in 0..=24u32 {
            for onsets in 0..=slots {
                let pattern = bjorklund(onsets, slots);
                assert_eq!(pattern.len(), slots as usize);
                let count = pattern.iter().filter(|&&b| b).count() as u32;
                assert_eq!(count, onsets, "E({onsets},{slots})");
                if onsets > 0 {
                    assert!(pattern[0], "E({onsets},{slots}) must start on an onset");
                }
            }
        }
    }

    #[test]
    fn adjacent_inter_onset_intervals_differ_by_at_most_one() {
        for slots in 1..=24u32 {
            for onsets in 1..=slots {
                let pattern = bjorklund(onsets, slots);
                let positions: Vec<usize> = pattern
                    .iter()
                    .enumerate()
                    .filter_map(|(i, &b)| b.then_some(i))
                    .collect();
                let mut intervals: Vec<usize> = positions.windows(2).map(|w| w[1] - w[0]).collect();
                intervals.push(slots as usize - positions[positions.len() - 1] + positions[0]);
                let min = intervals.iter().min().unwrap();
                let max = intervals.iter().max().unwrap();
                assert!(
                    max - min <= 1,
                    "E({onsets},{slots}) intervals {intervals:?}"
                );
            }
        }
    }
}
