//! The pure weighted **START** chooser (Plan Phase D).
//!
//! When a `TriggerConfig` carries a [`StartSelect`], each accepted candidate's
//! beat-0 placement is chosen from a weighted set of [`LaunchAlignment`]s by an
//! **identity-seeded** roll — `(seed, source_cycle_index, matched_beat)` — never
//! a running counter. So, exactly like the GATE:
//!
//! - the choice for a given candidate is identical no matter how the compile
//!   window is split (windowing stays associative — the compiler already sorts
//!   by the resolved launch tick, so a non-monotonic placement is fine), and
//! - a recompile/reapply reproduces the same placement.
//!
//! The chosen alignment then feeds the existing `TriggerFire::launch_tick` math
//! (alignment → quantize), so START selection composes with everything else.

use crate::config::{LaunchAlignment, StartSelect};

/// The chosen START placement for one candidate + which option produced it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartChoice {
    pub alignment: LaunchAlignment,
    pub option_index: usize,
}

/// Identity-seeded roll in `0..upper` (a splitmix64 finalizer; a distinct domain
/// salt from the GATE so the two rolls for one candidate are independent).
fn start_roll(seed: u64, source_cycle_index: u64, matched_beat: u32, upper: u64) -> u64 {
    if upper == 0 {
        return 0;
    }
    let mut z = seed
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(source_cycle_index.wrapping_mul(0x94D0_49BB_1331_11EB))
        .wrapping_add(u64::from(matched_beat).wrapping_mul(0xD1B5_4A32_D192_ED03))
        .wrapping_add(0xA076_1D64_78BD_642F);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    z % upper
}

/// Choose one START option for a candidate by an identity-seeded weighted roll.
/// Falls back to the first option when all weights are zero, and to `AtEvent`
/// when there are no options (the compiler treats an empty select as "use the
/// single `launch_alignment`", so this is only a defensive floor).
pub fn choose_start(
    select: &StartSelect,
    source_cycle_index: u64,
    matched_beat: u32,
) -> StartChoice {
    if select.options.is_empty() {
        return StartChoice {
            alignment: LaunchAlignment::AtEvent,
            option_index: 0,
        };
    }
    let total = select.total_weight();
    if total == 0 {
        return StartChoice {
            alignment: select.options[0].alignment,
            option_index: 0,
        };
    }
    let roll = start_roll(select.seed, source_cycle_index, matched_beat, total);
    let mut acc: u64 = 0;
    for (index, option) in select.options.iter().enumerate() {
        acc = acc.saturating_add(u64::from(option.weight));
        if roll < acc {
            return StartChoice {
                alignment: option.alignment,
                option_index: index,
            };
        }
    }
    // Unreachable while `total > 0`; defensive last-option fallback.
    let last = select.options.len() - 1;
    StartChoice {
        alignment: select.options[last].alignment,
        option_index: last,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::WeightedStart;

    fn select(options: Vec<(LaunchAlignment, u32)>, seed: u64) -> StartSelect {
        StartSelect {
            options: options
                .into_iter()
                .map(|(alignment, weight)| WeightedStart { alignment, weight })
                .collect(),
            seed,
        }
    }

    #[test]
    fn empty_options_fall_back_to_at_event() {
        let s = select(vec![], 1);
        assert_eq!(choose_start(&s, 0, 0).alignment, LaunchAlignment::AtEvent);
    }

    #[test]
    fn zero_weight_options_pick_the_first() {
        let s = select(
            vec![
                (LaunchAlignment::AtSourceCycleStart, 0),
                (LaunchAlignment::CenterInRest, 0),
            ],
            5,
        );
        for cycle in 0..50 {
            let choice = choose_start(&s, cycle, 0);
            assert_eq!(choice.alignment, LaunchAlignment::AtSourceCycleStart);
            assert_eq!(choice.option_index, 0);
        }
    }

    #[test]
    fn a_single_weighted_option_is_always_chosen() {
        let s = select(
            vec![
                (LaunchAlignment::AtEvent, 0),
                (LaunchAlignment::CenterInRest, 7),
            ],
            9,
        );
        for cycle in 0..50 {
            assert_eq!(
                choose_start(&s, cycle, 0).alignment,
                LaunchAlignment::CenterInRest
            );
        }
    }

    #[test]
    fn choice_is_stable_per_identity() {
        let s = select(
            vec![
                (LaunchAlignment::AtEvent, 1),
                (LaunchAlignment::CenterInRest, 1),
                (LaunchAlignment::AtSourceReturn, 1),
            ],
            42,
        );
        // Same identity ⇒ same choice, every time.
        let a = choose_start(&s, 13, 2);
        for _ in 0..20 {
            assert_eq!(choose_start(&s, 13, 2), a);
        }
    }

    #[test]
    fn equal_weights_exercise_more_than_one_option() {
        let s = select(
            vec![
                (LaunchAlignment::AtEvent, 1),
                (LaunchAlignment::CenterInRest, 1),
            ],
            7,
        );
        let mut seen_event = false;
        let mut seen_center = false;
        for cycle in 0..200 {
            match choose_start(&s, cycle, 0).alignment {
                LaunchAlignment::AtEvent => seen_event = true,
                LaunchAlignment::CenterInRest => seen_center = true,
                other => panic!("unexpected alignment {other:?}"),
            }
        }
        assert!(seen_event && seen_center, "both options must be reachable");
    }
}
