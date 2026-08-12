//! Onset-lattice utilities on the cycle's tatum grid (Z_n): rotation as
//! beat-class transposition, and the symmetric-difference distance the
//! drift leash measures against the seed. Euclidean necklaces live in
//! [`super::euclid`]; indispensability in [`super::barlow`].

/// Rotate slot indices left by `by` slots on a cycle of `slots` (Reich-style
/// beat-class transposition T_by; positions move earlier by `by`).
pub fn rotate_slot(slot: u32, by: u32, slots: u32) -> u32 {
    debug_assert!(slots > 0);
    (slot + slots - (by % slots)) % slots
}

/// How many onsets differ between two onset sets on the same grid — the
/// add/remove edit distance (each Barlow add or remove moves this by one).
pub fn symmetric_difference(a: &[u32], b: &[u32]) -> u32 {
    let mut count = 0u32;
    let mut i = 0usize;
    let mut j = 0usize;
    while i < a.len() && j < b.len() {
        match a[i].cmp(&b[j]) {
            std::cmp::Ordering::Equal => {
                i += 1;
                j += 1;
            }
            std::cmp::Ordering::Less => {
                count += 1;
                i += 1;
            }
            std::cmp::Ordering::Greater => {
                count += 1;
                j += 1;
            }
        }
    }
    count + (a.len() - i) as u32 + (b.len() - j) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_is_a_group_action() {
        let slots = 16u32;
        for slot in 0..slots {
            assert_eq!(rotate_slot(slot, 0, slots), slot);
            assert_eq!(
                rotate_slot(rotate_slot(slot, 5, slots), 11, slots),
                slot,
                "5 + 11 = 16 ≡ identity"
            );
            assert_eq!(
                rotate_slot(rotate_slot(slot, 3, slots), 4, slots),
                rotate_slot(slot, 7, slots),
                "composition adds"
            );
        }
        assert_eq!(
            rotate_slot(0, 4, 16),
            12,
            "left rotation moves starts earlier"
        );
    }

    #[test]
    fn symmetric_difference_is_a_metric_on_small_sets() {
        assert_eq!(symmetric_difference(&[0, 4, 8], &[0, 4, 8]), 0);
        assert_eq!(symmetric_difference(&[0, 4, 8], &[0, 4]), 1);
        assert_eq!(symmetric_difference(&[0, 4], &[0, 6]), 2);
        assert_eq!(symmetric_difference(&[], &[1, 2, 3]), 3);
        // Symmetry and triangle inequality over a small universe.
        let sets: Vec<Vec<u32>> = vec![vec![], vec![0], vec![0, 2], vec![1, 2], vec![0, 1, 2]];
        for a in &sets {
            for b in &sets {
                let ab = symmetric_difference(a, b);
                assert_eq!(ab, symmetric_difference(b, a));
                for c in &sets {
                    assert!(
                        ab <= symmetric_difference(a, c) + symmetric_difference(c, b),
                        "triangle inequality"
                    );
                }
            }
        }
    }
}
