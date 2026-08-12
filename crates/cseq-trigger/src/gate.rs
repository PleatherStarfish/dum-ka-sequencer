//! The pure **GATE** (Plan Phase C): a stateful + probabilistic acceptance gate
//! applied to a WHEN candidate before the re-trigger policy.
//!
//! Determinism is the whole game here. Every probability roll is seeded by the
//! candidate's **stable identity** — `(source_cycle_index, matched_beat)` mixed
//! with [`GateSpec::seed`] — never by a running counter or wall clock. So:
//!
//! - the roll for a given candidate is identical no matter how the compile
//!   window is split (windowing stays associative), and
//! - a recompile/reapply (which restarts from cycle 0 with a fresh carry)
//!   reproduces the exact same accept/reject sequence.
//!
//! [`GateState`] (the consecutive-miss streak + last-accept cycle) is threaded
//! in `TriggerCarry`. It evolves only by processing consumed candidates in
//! launch-tick order, which is the same order whether a window is compiled whole
//! or split — so the state converges identically too.

use crate::config::{GateSpec, GATE_PROBABILITY_MAX};
use serde::{Deserialize, Serialize};

/// Stateful gate counters threaded in `TriggerCarry::gate_state`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateState {
    /// Consecutive probability-misses since the last accept (drives miss-boost).
    pub consecutive_misses: u32,
    /// Source-cycle index of the last accept (drives cooldown). `None` until the
    /// first accept.
    pub last_accept_source_cycle: Option<u64>,
}

/// One recorded probability roll. The trust surface (event log) renders these
/// verbatim, so the log can never disagree with what the compiler decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateRoll {
    /// Rolled value in `0..=999` (per-mille). Accept iff `value < threshold`.
    pub value: u16,
    /// Effective accept threshold at roll time (base probability + miss-boost).
    pub threshold: u16,
    pub passed: bool,
}

/// Why the gate rejected a candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GateRejectReason {
    /// The probability roll failed (`value >= threshold`).
    Probability,
    /// Inside `cooldown_cycles` of the last accept (no roll was taken).
    Cooldown,
}

/// Result of evaluating the gate for one candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateEval {
    Accept {
        roll: Option<GateRoll>,
    },
    Reject {
        reason: GateRejectReason,
        roll: Option<GateRoll>,
    },
}

/// Deterministic per-candidate roll in `0..=999`, seeded by stable identity.
/// (A splitmix64 finalizer over `seed`, `source_cycle_index`, `matched_beat` —
/// the same RNG-free style as the compiler's `stable_launch_id`.)
fn gate_roll_value(seed: u64, source_cycle_index: u64, matched_beat: u32) -> u16 {
    let mut z = seed
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(source_cycle_index.wrapping_mul(0xD1B5_4A32_D192_ED03))
        .wrapping_add(u64::from(matched_beat).wrapping_mul(0xBF58_476D_1CE4_E5B9))
        .wrapping_add(0x2545_F491_4F6C_DD1D);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z % u64::from(GATE_PROBABILITY_MAX)) as u16
}

/// Evaluate the gate for one candidate and advance `state`. Pure given
/// `(gate, state, identity)`.
pub fn evaluate_gate(
    gate: &GateSpec,
    state: &mut GateState,
    source_cycle_index: u64,
    matched_beat: u32,
) -> GateEval {
    // 1. Cooldown — a hard gate: no roll, and it leaves the miss streak alone.
    if gate.cooldown_cycles > 0 {
        if let Some(last) = state.last_accept_source_cycle {
            if source_cycle_index.saturating_sub(last) < u64::from(gate.cooldown_cycles) {
                return GateEval::Reject {
                    reason: GateRejectReason::Cooldown,
                    roll: None,
                };
            }
        }
    }
    // 2. Probability roll (with miss-boost folded into the threshold).
    let threshold = gate.effective_threshold(state.consecutive_misses);
    let value = gate_roll_value(gate.seed, source_cycle_index, matched_beat);
    let passed = value < threshold;
    let roll = GateRoll {
        value,
        threshold,
        passed,
    };
    if passed {
        state.consecutive_misses = 0;
        state.last_accept_source_cycle = Some(source_cycle_index);
        GateEval::Accept { roll: Some(roll) }
    } else {
        state.consecutive_misses = state.consecutive_misses.saturating_add(1);
        GateEval::Reject {
            reason: GateRejectReason::Probability,
            roll: Some(roll),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gate(probability_per_mille: u16) -> GateSpec {
        GateSpec {
            probability_per_mille,
            cooldown_cycles: 0,
            miss_boost_per_mille: 0,
            seed: 0xC0FFEE,
        }
    }

    #[test]
    fn probability_zero_never_accepts() {
        let g = gate(0);
        let mut state = GateState::default();
        for cycle in 0..200 {
            assert!(matches!(
                evaluate_gate(&g, &mut state, cycle, 0),
                GateEval::Reject {
                    reason: GateRejectReason::Probability,
                    ..
                }
            ));
        }
    }

    #[test]
    fn probability_full_always_accepts() {
        let g = gate(GATE_PROBABILITY_MAX);
        let mut state = GateState::default();
        for cycle in 0..200 {
            assert!(matches!(
                evaluate_gate(&g, &mut state, cycle, 0),
                GateEval::Accept { .. }
            ));
        }
    }

    #[test]
    fn roll_is_stable_per_identity_regardless_of_state() {
        // Same identity ⇒ same rolled value, independent of the streak counter.
        let g = gate(500);
        let mut a = GateState::default();
        let mut b = GateState {
            consecutive_misses: 7,
            last_accept_source_cycle: Some(3),
        };
        let ra = match evaluate_gate(&g, &mut a, 42, 2) {
            GateEval::Accept { roll } | GateEval::Reject { roll, .. } => roll.unwrap().value,
        };
        let rb = match evaluate_gate(&g, &mut b, 42, 2) {
            GateEval::Accept { roll } | GateEval::Reject { roll, .. } => roll.unwrap().value,
        };
        assert_eq!(ra, rb, "roll value depends only on identity + seed");
    }

    #[test]
    fn miss_boost_eventually_forces_an_accept() {
        // Base probability 0, but +200‰ per miss ⇒ after 5 misses the threshold
        // reaches 1000 and the candidate must accept.
        let g = GateSpec {
            probability_per_mille: 0,
            cooldown_cycles: 0,
            miss_boost_per_mille: 200,
            seed: 1,
        };
        let mut state = GateState::default();
        let mut accepted = None;
        for cycle in 0..10u64 {
            if let GateEval::Accept { .. } = evaluate_gate(&g, &mut state, cycle, 0) {
                accepted = Some(cycle);
                break;
            }
        }
        let accepted = accepted.expect("miss-boost must force an accept");
        assert!(accepted <= 5, "threshold hits 1000 by the 6th attempt");
        // The streak resets on accept.
        assert_eq!(state.consecutive_misses, 0);
        assert_eq!(state.last_accept_source_cycle, Some(accepted));
    }

    #[test]
    fn cooldown_rejects_without_a_roll_and_preserves_streak() {
        // Always-accept base, but a 3-cycle cooldown after the first accept.
        let g = GateSpec {
            probability_per_mille: GATE_PROBABILITY_MAX,
            cooldown_cycles: 3,
            miss_boost_per_mille: 0,
            seed: 9,
        };
        let mut state = GateState::default();
        assert!(matches!(
            evaluate_gate(&g, &mut state, 10, 0),
            GateEval::Accept { .. }
        ));
        // Cycles 11, 12 are within cooldown (gap < 3) ⇒ cooldown reject, no roll.
        for cycle in [11u64, 12] {
            assert!(matches!(
                evaluate_gate(&g, &mut state, cycle, 0),
                GateEval::Reject {
                    reason: GateRejectReason::Cooldown,
                    roll: None
                }
            ));
        }
        // Cycle 13 is exactly cooldown_cycles away (gap == 3, not < 3) ⇒ accepts.
        assert!(matches!(
            evaluate_gate(&g, &mut state, 13, 0),
            GateEval::Accept { .. }
        ));
    }

    #[test]
    fn normalized_clamps_fields() {
        let g = GateSpec {
            probability_per_mille: 5000,
            cooldown_cycles: u32::MAX,
            miss_boost_per_mille: 9000,
            seed: 7,
        }
        .normalized();
        assert_eq!(g.probability_per_mille, GATE_PROBABILITY_MAX);
        assert_eq!(g.miss_boost_per_mille, GATE_PROBABILITY_MAX);
        assert_eq!(g.cooldown_cycles, crate::config::GATE_COOLDOWN_CYCLES_CAP);
        assert_eq!(g.seed, 7);
    }

    #[test]
    fn effective_threshold_saturates_at_max() {
        let g = GateSpec {
            probability_per_mille: 600,
            cooldown_cycles: 0,
            miss_boost_per_mille: 300,
            seed: 0,
        };
        assert_eq!(g.effective_threshold(0), 600);
        assert_eq!(g.effective_threshold(1), 900);
        assert_eq!(g.effective_threshold(2), GATE_PROBABILITY_MAX); // 1200 capped
        assert_eq!(g.effective_threshold(9999), GATE_PROBABILITY_MAX);
    }
}
