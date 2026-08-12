//! `cseq-trigger` — pure logic for **Triggered Tracks**.
//!
//! A triggered track stays silent until a *trigger condition* observed in a
//! source track fires, then launches from its own beat 0 at a configured
//! alignment, for a bounded lifetime, with a re-trigger policy. This crate owns
//! everything that can be expressed without a scheduler, an audio thread, or
//! RNG, so it can be exhaustively unit/property tested in isolation:
//!
//! - [`config`] — trigger configuration, clamping, and graph normalization
//!   (self-trigger / dangling / one-level-DAG rejection with safe continuous
//!   fallback).
//! - [`resolve`] — the [`ResolvedCycle`] adapter that combines structural pulse
//!   spans with realized audible note groups so rest-vs-sounding, gati per beat,
//!   section start, jathi pulses, and note-group boundaries are all legible.
//! - [`evaluator`] — the pure [`evaluate_cycle`]/[`evaluate_cycles`] +
//!   launch-alignment math.
//! - [`compiler`] — the windowed [`compile_window`] with carry state
//!   (determinism, boundedness, windowing-is-associative).
//!
//! Dependency direction is `cseq-trigger -> cseq-model` only. It must never
//! depend on `cseq-transport` or any Tauri DTO. The transport drives this crate;
//! this crate knows nothing about the transport.
//!
//! ## Explicitly deferred (NOT in v1)
//!
//! The following are intentionally out of scope and must not be assumed present:
//!
//! - **Post-score conditions** that observe finalized transport metadata —
//!   `ratchetFiredAtBeat`, `ornamentAtBeat`, `channelHocketRoutedTo`. These read
//!   playback decorations produced *after* the parity-critical cycle-local queue
//!   finalization, not pure resolved structure, so they need the carry/state and
//!   parity machinery this crate does not yet have.
//! - **`conditionalLength`** (length resolved per launch by a rule). A pure
//!   compiler over a bounded window cannot resolve a length that may exceed the
//!   window without extra carry the v1 compiler does not implement.
//! - **`untilStopCondition`** lifetimes (open-ended runs).
//! - **Guards** (cooldown, probability, tempo-range, …) and the wider taxonomy.
//! - **Live external input** triggering and **multi-level trigger DAGs** (v1 is
//!   one source level only; the source must be a continuous track).

pub mod compiler;
pub mod config;
pub mod evaluator;
pub mod gate;
pub mod resolve;
pub mod start;

pub use compiler::{
    compile_window, ActiveRun, CompiledLaunch, CompiledWindow, ConsumedFire, DecisionOutcome,
    FollowerSpec, QueuedLaunch, SuppressReason, TickWindow, TriggerCarry, TriggerDecision,
};
pub use config::{
    normalize_track_modes, BeatSelector, ConditionNode, CountOp, GateSpec, LaunchAlignment,
    LaunchQuantize, Lifetime, NormalizedGraph, NormalizedMode, NormalizedTrack, QuantizeDirection,
    QuantizeGrid, ReTrigger, StartSelect, TriggerCondition, TriggerConfig, TriggerLength,
    TriggerRejectReason, TriggerWarning, WeightedStart, WhenPredicate, WhenSpec,
    DEFAULT_MAX_REPEATS, GATE_COOLDOWN_CYCLES_CAP, GATE_PROBABILITY_MAX, MAX_AFTER_EVENT_TICKS,
    MAX_CONDITION_DEPTH, MAX_CONDITION_NODES, MAX_QUANTIZE_DIVISIONS, MAX_REPEATS_CAP,
    MAX_START_OPTIONS, MAX_START_WEIGHT,
};
pub use evaluator::{evaluate_cycle, evaluate_cycles, EvalContext, TriggerFire};
pub use gate::{evaluate_gate, GateEval, GateRejectReason, GateRoll, GateState};
pub use resolve::{resolve_cycle_from_spans, NoteGroup, ResolvedBeat, ResolvedCycle};
pub use start::{choose_start, StartChoice};

#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;

    const TPB: u64 = 960;
    const CYCLE_BEATS: u64 = 4;
    const CYCLE_TICKS: u64 = TPB * CYCLE_BEATS;

    fn ctx() -> EvalContext {
        EvalContext {
            ticks_per_reference_beat: TPB,
        }
    }

    fn follower() -> FollowerSpec<'static> {
        FollowerSpec {
            phrase_reference_ticks: 2 * TPB,
            phrase_reference_ticks_for_cycle: None,
        }
    }

    fn build_cycle(index: u64, rest_on_3: bool) -> ResolvedCycle {
        let base = index * CYCLE_TICKS;
        let beats = (0..4)
            .map(|beat| ResolvedBeat {
                beat,
                gati: 4,
                section_index: 0,
                section_start: beat == 0,
                jathi: None,
                start_tick: base + u64::from(beat) * TPB,
                end_tick: base + (u64::from(beat) + 1) * TPB,
                sounding: !(beat == 3 && rest_on_3),
                matra_sounding: vec![],
                jathi_pulse_start_ticks: vec![],
            })
            .collect();
        ResolvedCycle {
            cycle_index: index,
            start_tick: base,
            end_tick: base + CYCLE_TICKS,
            beats,
            note_groups: vec![NoteGroup {
                start_tick: base,
                end_tick: base + 1,
            }],
        }
    }

    fn re_trigger_strategy() -> impl Strategy<Value = ReTrigger> {
        prop_oneof![
            Just(ReTrigger::Restart),
            Just(ReTrigger::Ignore),
            Just(ReTrigger::Queue),
        ]
    }

    fn quantize_strategy() -> impl Strategy<Value = Option<LaunchQuantize>> {
        let dir = prop_oneof![
            Just(QuantizeDirection::Next),
            Just(QuantizeDirection::Nearest),
            Just(QuantizeDirection::Previous),
        ];
        let grid = prop_oneof![
            (1u32..8u32).prop_map(|d| QuantizeGrid::ReferenceBeatFraction { divisions: d }),
            (1u32..4u32).prop_map(|b| QuantizeGrid::ReferenceBeatMultiple { beats: b }),
            Just(QuantizeGrid::SourceGatiMatra),
        ];
        prop_oneof![
            Just(None),
            (grid, dir).prop_map(|(grid, direction)| Some(LaunchQuantize { grid, direction })),
        ]
    }

    fn config_strategy() -> impl Strategy<Value = TriggerConfig> {
        (
            re_trigger_strategy(),
            1u32..6u32,
            1u32..40u32,
            quantize_strategy(),
        )
            .prop_map(|(re, passes, max, launch_quantize)| TriggerConfig {
                source_track_id: "lead".to_string(),
                when: None,
                condition: Some(TriggerCondition::BeatIsRest { beat: 3 }),
                launch_alignment: LaunchAlignment::AtEvent,
                launch_quantize,
                lifetime: Lifetime::Repeats { passes },
                re_trigger: re,
                length: TriggerLength::ScoreCycle,
                max_repeats: max,
                gate: None,
                start_select: None,
            })
    }

    fn rests_strategy() -> impl Strategy<Value = Vec<bool>> {
        proptest::collection::vec(any::<bool>(), 1..8)
    }

    proptest! {
        #[test]
        fn determinism_holds(cfg in config_strategy(), rests in rests_strategy()) {
            let cycles: Vec<ResolvedCycle> = rests
                .iter()
                .enumerate()
                .map(|(i, r)| build_cycle(i as u64, *r))
                .collect();
            let window = TickWindow { start: 0, end: rests.len() as u64 * CYCLE_TICKS };
            let a = compile_window(&cfg, &cycles, window, &follower(), &ctx(), TriggerCarry::default());
            let b = compile_window(&cfg, &cycles, window, &follower(), &ctx(), TriggerCarry::default());
            prop_assert_eq!(a, b);
        }

        #[test]
        fn output_is_bounded(cfg in config_strategy(), rests in rests_strategy()) {
            let cycles: Vec<ResolvedCycle> = rests
                .iter()
                .enumerate()
                .map(|(i, r)| build_cycle(i as u64, *r))
                .collect();
            let window = TickWindow { start: 0, end: rests.len() as u64 * CYCLE_TICKS };
            let out = compile_window(&cfg, &cycles, window, &follower(), &ctx(), TriggerCarry::default());
            // Never more launches than 2x the number of fires (each fire can at
            // most start one launch and release one queued launch).
            let fire_count = rests.iter().filter(|r| **r).count();
            prop_assert!(out.launches.len() <= fire_count.saturating_mul(2) + 1);
            // Every launch's pass count is clamped to max_repeats.
            for launch in &out.launches {
                prop_assert!(launch.local_cycle_count <= cfg.max_repeats.max(1));
                prop_assert!(launch.local_cycle_count >= 1);
            }
        }

        #[test]
        fn windowing_is_associative(
            cfg in config_strategy(),
            rests in proptest::collection::vec(any::<bool>(), 1..7),
            split_cycle in 0u64..7u64,
        ) {
            let n = rests.len() as u64;
            let cycles: Vec<ResolvedCycle> = rests
                .iter()
                .enumerate()
                .map(|(i, r)| build_cycle(i as u64, *r))
                .collect();
            let total_end = n * CYCLE_TICKS;
            let split = (split_cycle.min(n) * CYCLE_TICKS).min(total_end);

            let whole = compile_window(
                &cfg, &cycles,
                TickWindow { start: 0, end: total_end },
                &follower(), &ctx(), TriggerCarry::default(),
            );
            let first = compile_window(
                &cfg, &cycles,
                TickWindow { start: 0, end: split },
                &follower(), &ctx(), TriggerCarry::default(),
            );
            let second = compile_window(
                &cfg, &cycles,
                TickWindow { start: split, end: total_end },
                &follower(), &ctx(), first.carry_out.clone(),
            );
            let mut combined = first.launches.clone();
            combined.extend(second.launches.clone());
            prop_assert_eq!(combined, whole.launches);
            prop_assert_eq!(second.carry_out, whole.carry_out);
        }

        #[test]
        fn follower_cycle_indices_are_contiguous_and_stable(
            cfg in config_strategy(),
            rests in rests_strategy(),
        ) {
            let cycles: Vec<ResolvedCycle> = rests
                .iter()
                .enumerate()
                .map(|(i, r)| build_cycle(i as u64, *r))
                .collect();
            let window = TickWindow { start: 0, end: rests.len() as u64 * CYCLE_TICKS };
            let out = compile_window(&cfg, &cycles, window, &follower(), &ctx(), TriggerCarry::default());
            // Follower cycle indices partition [0, next_local_cycle_index) with
            // no overlap, in launch order.
            let mut expected = 0u64;
            for launch in &out.launches {
                prop_assert_eq!(launch.first_local_cycle_index, expected);
                expected += u64::from(launch.local_cycle_count);
            }
            prop_assert_eq!(out.carry_out.next_local_cycle_index, expected);
        }

        #[test]
        fn windowing_associative_multi_candidate_any_beat(
            cfg in config_strategy(),
            patterns in proptest::collection::vec(any::<u8>(), 1..6),
            split_cycle in 0u64..6u64,
        ) {
            // AnyBeat + IsRest fires at every rest beat — multiple candidates per
            // cycle. Verify the identity-dedup + sort compiler stays
            // windowing-associative under restart/ignore/queue.
            let mut cfg = cfg;
            cfg.when = Some(WhenSpec {
                beats: BeatSelector::AnyBeat,
                tree: ConditionNode::leaf(WhenPredicate::IsRest),
            });
            cfg.condition = None;
            let n = patterns.len() as u64;
            let cycles: Vec<ResolvedCycle> = patterns
                .iter()
                .enumerate()
                .map(|(i, bits)| {
                    let base = i as u64 * CYCLE_TICKS;
                    let beats = (0..4u32)
                        .map(|beat| ResolvedBeat {
                            beat,
                            gati: 4,
                            section_index: 0,
                            section_start: beat == 0,
                            jathi: None,
                            start_tick: base + u64::from(beat) * TPB,
                            end_tick: base + (u64::from(beat) + 1) * TPB,
                            // bit clear ⇒ rest ⇒ a candidate beat.
                            sounding: (bits >> beat) & 1 != 0,
                            matra_sounding: vec![],
                            jathi_pulse_start_ticks: vec![],
                        })
                        .collect();
                    ResolvedCycle {
                        cycle_index: i as u64,
                        start_tick: base,
                        end_tick: base + CYCLE_TICKS,
                        beats,
                        note_groups: vec![],
                    }
                })
                .collect();
            let total = n * CYCLE_TICKS;
            let split = (split_cycle.min(n) * CYCLE_TICKS).min(total);
            let whole = compile_window(
                &cfg, &cycles,
                TickWindow { start: 0, end: total },
                &follower(), &ctx(), TriggerCarry::default(),
            );
            let first = compile_window(
                &cfg, &cycles,
                TickWindow { start: 0, end: split },
                &follower(), &ctx(), TriggerCarry::default(),
            );
            let second = compile_window(
                &cfg, &cycles,
                TickWindow { start: split, end: total },
                &follower(), &ctx(), first.carry_out.clone(),
            );
            let mut combined = first.launches.clone();
            combined.extend(second.launches.clone());
            prop_assert_eq!(combined, whole.launches);
            prop_assert_eq!(second.carry_out, whole.carry_out);
        }

        #[test]
        fn gate_keeps_windowing_associative_and_trace_matches(
            patterns in proptest::collection::vec(any::<u8>(), 1..6),
            split_cycle in 0u64..6u64,
            re in re_trigger_strategy(),
            prob in 0u16..=1000u16,
            cooldown in 0u32..3u32,
            miss_boost in 0u16..400u16,
            seed in any::<u64>(),
        ) {
            // A live GATE (probability + cooldown + miss-boost) over AnyBeat+IsRest
            // multi-candidate input. The identity-seeded roll + carried gate_state
            // must keep launches, carry, AND the decision trace identical whether
            // the window is compiled whole or split — the Phase C determinism crux.
            let cfg = TriggerConfig {
                source_track_id: "lead".to_string(),
                when: Some(WhenSpec {
                    beats: BeatSelector::AnyBeat,
                    tree: ConditionNode::leaf(WhenPredicate::IsRest),
                }),
                condition: None,
                launch_alignment: LaunchAlignment::AtEvent,
                launch_quantize: None,
                lifetime: Lifetime::Repeats { passes: 2 },
                re_trigger: re,
                length: TriggerLength::ScoreCycle,
                max_repeats: 64,
                gate: Some(GateSpec {
                    probability_per_mille: prob,
                    cooldown_cycles: cooldown,
                    miss_boost_per_mille: miss_boost,
                    seed,
                }),
                start_select: None,
            };
            let n = patterns.len() as u64;
            let cycles: Vec<ResolvedCycle> = patterns
                .iter()
                .enumerate()
                .map(|(i, bits)| {
                    let base = i as u64 * CYCLE_TICKS;
                    let beats = (0..4u32)
                        .map(|beat| ResolvedBeat {
                            beat,
                            gati: 4,
                            section_index: 0,
                            section_start: beat == 0,
                            jathi: None,
                            start_tick: base + u64::from(beat) * TPB,
                            end_tick: base + (u64::from(beat) + 1) * TPB,
                            sounding: (bits >> beat) & 1 != 0,
                            matra_sounding: vec![],
                            jathi_pulse_start_ticks: vec![],
                        })
                        .collect();
                    ResolvedCycle {
                        cycle_index: i as u64,
                        start_tick: base,
                        end_tick: base + CYCLE_TICKS,
                        beats,
                        note_groups: vec![],
                    }
                })
                .collect();
            let total = n * CYCLE_TICKS;
            let split = (split_cycle.min(n) * CYCLE_TICKS).min(total);
            let whole = compile_window(
                &cfg, &cycles,
                TickWindow { start: 0, end: total },
                &follower(), &ctx(), TriggerCarry::default(),
            );
            let first = compile_window(
                &cfg, &cycles,
                TickWindow { start: 0, end: split },
                &follower(), &ctx(), TriggerCarry::default(),
            );
            let second = compile_window(
                &cfg, &cycles,
                TickWindow { start: split, end: total },
                &follower(), &ctx(), first.carry_out.clone(),
            );
            let mut combined = first.launches.clone();
            combined.extend(second.launches.clone());
            prop_assert_eq!(combined, whole.launches);
            prop_assert_eq!(second.carry_out.clone(), whole.carry_out.clone());
            let mut combined_decisions = first.decisions.clone();
            combined_decisions.extend(second.decisions.clone());
            prop_assert_eq!(combined_decisions, whole.decisions);
        }

        #[test]
        fn weighted_start_keeps_windowing_associative_and_trace_matches(
            patterns in proptest::collection::vec(any::<u8>(), 1..6),
            split_cycle in 0u64..6u64,
            re in re_trigger_strategy(),
            seed in any::<u64>(),
            weights in proptest::collection::vec(0u32..4u32, 4..=4),
        ) {
            // A weighted START over the variable/resolved-context placements
            // (AtEvent / AtSourceCycleStart / CenterInRest / AtSourceReturn) makes
            // launch ticks non-monotonic in source-cycle order. The identity-seeded
            // pick + the compiler's sort-by-launch-tick must keep launches, carry,
            // AND the decision trace identical whether the window is whole or split.
            let cfg = TriggerConfig {
                source_track_id: "lead".to_string(),
                when: Some(WhenSpec {
                    beats: BeatSelector::AnyBeat,
                    tree: ConditionNode::leaf(WhenPredicate::IsRest),
                }),
                condition: None,
                launch_alignment: LaunchAlignment::AtEvent,
                launch_quantize: None,
                lifetime: Lifetime::OnePass,
                re_trigger: re,
                length: TriggerLength::ScoreCycle,
                max_repeats: 64,
                gate: None,
                start_select: Some(StartSelect {
                    options: vec![
                        WeightedStart { alignment: LaunchAlignment::AtEvent, weight: weights[0] },
                        WeightedStart { alignment: LaunchAlignment::AtSourceCycleStart, weight: weights[1] },
                        WeightedStart { alignment: LaunchAlignment::CenterInRest, weight: weights[2] },
                        WeightedStart { alignment: LaunchAlignment::AtSourceReturn, weight: weights[3] },
                    ],
                    seed,
                }),
            };
            let n = patterns.len() as u64;
            let cycles: Vec<ResolvedCycle> = patterns
                .iter()
                .enumerate()
                .map(|(i, bits)| {
                    let base = i as u64 * CYCLE_TICKS;
                    let beats = (0..4u32)
                        .map(|beat| ResolvedBeat {
                            beat,
                            gati: 4,
                            section_index: 0,
                            section_start: beat == 0,
                            jathi: None,
                            start_tick: base + u64::from(beat) * TPB,
                            end_tick: base + (u64::from(beat) + 1) * TPB,
                            sounding: (bits >> beat) & 1 != 0,
                            matra_sounding: vec![],
                            jathi_pulse_start_ticks: vec![],
                        })
                        .collect();
                    ResolvedCycle {
                        cycle_index: i as u64,
                        start_tick: base,
                        end_tick: base + CYCLE_TICKS,
                        beats,
                        note_groups: vec![],
                    }
                })
                .collect();
            let total = n * CYCLE_TICKS;
            let split = (split_cycle.min(n) * CYCLE_TICKS).min(total);
            let whole = compile_window(
                &cfg, &cycles,
                TickWindow { start: 0, end: total },
                &follower(), &ctx(), TriggerCarry::default(),
            );
            let first = compile_window(
                &cfg, &cycles,
                TickWindow { start: 0, end: split },
                &follower(), &ctx(), TriggerCarry::default(),
            );
            let second = compile_window(
                &cfg, &cycles,
                TickWindow { start: split, end: total },
                &follower(), &ctx(), first.carry_out.clone(),
            );
            let mut combined = first.launches.clone();
            combined.extend(second.launches.clone());
            prop_assert_eq!(combined, whole.launches);
            prop_assert_eq!(second.carry_out.clone(), whole.carry_out.clone());
            let mut combined_decisions = first.decisions.clone();
            combined_decisions.extend(second.decisions.clone());
            prop_assert_eq!(combined_decisions, whole.decisions);
        }
    }
}
