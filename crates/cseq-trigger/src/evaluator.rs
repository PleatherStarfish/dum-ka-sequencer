//! The pure trigger evaluator: given a resolved source cycle and a condition,
//! produce the ticks at which the follower would launch.
//!
//! Everything is a pure function of the [`ResolvedCycle`] (in reference ticks)
//! and the config. No scheduler, no audio, no RNG.

use crate::config::{
    BeatSelector, ConditionNode, LaunchAlignment, LaunchQuantize, QuantizeDirection, QuantizeGrid,
    WhenPredicate, WhenSpec, MAX_CONDITION_DEPTH,
};
use crate::resolve::{ResolvedBeat, ResolvedCycle};

/// Context the evaluator needs that is not on the cycle itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EvalContext {
    /// Reference ticks per reference beat (PPQN). Used by
    /// [`LaunchAlignment::AtNextReferenceBeat`].
    pub ticks_per_reference_beat: u64,
}

/// A single firing of a condition against one source cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TriggerFire {
    /// Stable source cycle index that produced the fire (used for dedupe).
    pub source_cycle_index: u64,
    /// The source beat that matched.
    pub matched_beat: u32,
    /// Reference tick of the matched event (e.g. the rest onset / beat start).
    pub event_reference_tick: u64,
    /// Reference tick of the source cycle's start (for `atSourceCycleStart`).
    pub source_cycle_start_tick: u64,
    /// Reference tick of the matched beat's start — the phase for a
    /// `SourceGatiMatra` quantize grid.
    pub matched_beat_start_tick: u64,
    /// Reference tick of the matched beat's end (for `CenterInRest`, Phase D).
    pub matched_beat_end_tick: u64,
    /// The source's gati at the matched beat — the divisor for a
    /// `SourceGatiMatra` quantize grid (gati is per beat).
    pub matched_beat_gati: u32,
    /// Reference tick of the source's next sounding onset after the matched
    /// event, within the matched cycle (for `AtSourceReturn`, Phase D). `None`
    /// when the source stays silent to cycle end.
    pub source_return_tick: Option<u64>,
}

impl TriggerFire {
    /// The aligned (pre-quantize) launch tick for `alignment`.
    fn anchor_tick(&self, alignment: LaunchAlignment, ctx: &EvalContext) -> u64 {
        match alignment {
            LaunchAlignment::AtEvent => self.event_reference_tick,
            LaunchAlignment::AtSourceCycleStart => self.source_cycle_start_tick,
            LaunchAlignment::AtNextReferenceBeat => {
                let step = ctx.ticks_per_reference_beat.max(1);
                let tick = self.event_reference_tick;
                // Smallest multiple of `step` that is >= tick.
                let rem = tick % step;
                if rem == 0 {
                    tick
                } else {
                    tick.saturating_add(step - rem)
                }
            }
            LaunchAlignment::AfterEventTicks { ticks } => {
                self.event_reference_tick.saturating_add(ticks)
            }
            // Midpoint of the matched beat's span (intra-beat bounded).
            LaunchAlignment::CenterInRest => {
                let lo = self.matched_beat_start_tick.min(self.matched_beat_end_tick);
                let hi = self.matched_beat_start_tick.max(self.matched_beat_end_tick);
                lo + (hi - lo) / 2
            }
            // The source's next sounding onset after the event (intra-cycle
            // bounded); falls back to the event tick when the source stays silent.
            LaunchAlignment::AtSourceReturn => {
                self.source_return_tick.unwrap_or(self.event_reference_tick)
            }
        }
    }

    /// `(step, phase)` for `quantize`'s grid in reference ticks.
    fn quantize_grid(&self, quantize: LaunchQuantize, ctx: &EvalContext) -> (u64, u64) {
        let ppqn = ctx.ticks_per_reference_beat.max(1);
        match quantize.grid {
            QuantizeGrid::ReferenceBeatFraction { divisions } => {
                (ppqn / u64::from(divisions.max(1)), 0)
            }
            QuantizeGrid::ReferenceBeatMultiple { beats } => {
                (ppqn.saturating_mul(u64::from(beats.max(1))), 0)
            }
            // Integer-tick v1 approximation of the source gati grid. Exact
            // rational matra ticks would require carrying per-matra positions.
            QuantizeGrid::SourceGatiMatra => (
                ppqn / u64::from(self.matched_beat_gati.max(1)),
                self.matched_beat_start_tick,
            ),
        }
    }

    /// Resolve the launch reference tick for this fire under `alignment`, then
    /// optionally snap it to `quantize`'s grid. The snap is monotonic in the
    /// anchor tick for a fixed grid, but source-gati grids may vary by fire; the
    /// compiler therefore sorts by the final snapped launch tick.
    pub fn launch_tick(
        &self,
        alignment: LaunchAlignment,
        quantize: Option<LaunchQuantize>,
        ctx: &EvalContext,
    ) -> u64 {
        let anchor = self.anchor_tick(alignment, ctx);
        match quantize {
            None => anchor,
            Some(q) => {
                let (step, phase) = self.quantize_grid(q, ctx);
                snap_to_grid(anchor, step, phase, q.direction)
            }
        }
    }
}

/// Snap `tick` to the grid of period `step` phased at `phase`, per `direction`.
/// `step == 0` is a no-op. Monotonic non-decreasing in `tick`.
fn snap_to_grid(tick: u64, step: u64, phase: u64, direction: QuantizeDirection) -> u64 {
    if step == 0 {
        return tick;
    }
    // Grid points below `phase` are not represented (ticks below the phase
    // clamp to `phase`); SourceGatiMatra is intended for anchors at/after the
    // matched beat, where this never bites.
    if tick < phase {
        return phase;
    }
    let rel = tick.saturating_sub(phase);
    let lower = phase.saturating_add((rel / step).saturating_mul(step));
    let remainder = rel % step;
    match direction {
        QuantizeDirection::Previous => lower,
        QuantizeDirection::Next => {
            if remainder == 0 {
                tick
            } else {
                lower.saturating_add(step)
            }
        }
        QuantizeDirection::Nearest => {
            if remainder.saturating_mul(2) >= step {
                lower.saturating_add(step)
            } else {
                lower
            }
        }
    }
}

/// Evaluate one WHEN spec against one resolved source cycle. Returns every fire
/// with the matched event's reference tick; `AnyBeat` can yield multiple
/// candidates from a single source cycle. The caller sorts fires across cycles.
pub fn evaluate_cycle(when: &WhenSpec, cycle: &ResolvedCycle) -> Vec<TriggerFire> {
    let when = when.normalized();
    let mut fires = Vec::new();
    let mut consider = |beat_index: u32| {
        if let Some(beat) = cycle.beat(beat_index) {
            if eval_node(&when.tree, cycle, beat, 0) {
                // Next sounding onset strictly after this beat, within the cycle
                // (the `AtSourceReturn` START placement; intra-cycle bounded).
                let source_return_tick = cycle
                    .beats
                    .iter()
                    .filter(|b| b.beat > beat_index && b.sounding)
                    .map(|b| b.start_tick)
                    .min();
                fires.push(TriggerFire {
                    source_cycle_index: cycle.cycle_index,
                    matched_beat: beat_index,
                    // The candidate fires at the anchor beat's start; sub-beat
                    // placement is the START band's job (two-decision model).
                    event_reference_tick: beat.start_tick,
                    source_cycle_start_tick: cycle.start_tick,
                    matched_beat_start_tick: beat.start_tick,
                    matched_beat_end_tick: beat.end_tick,
                    matched_beat_gati: beat.gati,
                    source_return_tick,
                });
            }
        }
    };
    match when.beats {
        BeatSelector::At { beat } => consider(beat),
        BeatSelector::AnyBeat => {
            // Evaluate every beat in ascending order; each match is a candidate.
            let mut indices: Vec<u32> = cycle.beats.iter().map(|b| b.beat).collect();
            indices.sort_unstable();
            for beat in indices {
                consider(beat);
            }
        }
    }
    fires
}

/// Evaluate the boolean tree at `beat` (cycle-level predicates ignore `beat`).
fn eval_node(
    node: &ConditionNode,
    cycle: &ResolvedCycle,
    beat: &ResolvedBeat,
    depth: usize,
) -> bool {
    if depth >= MAX_CONDITION_DEPTH {
        return false;
    }
    match node {
        ConditionNode::All { nodes } => nodes.iter().all(|n| eval_node(n, cycle, beat, depth + 1)),
        ConditionNode::Any { nodes } => nodes.iter().any(|n| eval_node(n, cycle, beat, depth + 1)),
        ConditionNode::Not { node } => !eval_node(node, cycle, beat, depth + 1),
        ConditionNode::Leaf { predicate } => eval_predicate(predicate, cycle, beat),
    }
}

fn eval_predicate(predicate: &WhenPredicate, cycle: &ResolvedCycle, beat: &ResolvedBeat) -> bool {
    match predicate {
        WhenPredicate::IsRest => !beat.sounding,
        WhenPredicate::IsSounding => beat.sounding,
        WhenPredicate::IsSectionStart => beat.section_start,
        WhenPredicate::HasJathiPulse => !beat.jathi_pulse_start_ticks.is_empty(),
        WhenPredicate::GatiIs { gati } => beat.gati == *gati,
        WhenPredicate::MatraIsRest { matra } => beat
            .matra_sounding
            .get(*matra as usize)
            .map(|sounding| !*sounding)
            .unwrap_or(false),
        WhenPredicate::MatraIsSounding { matra } => beat
            .matra_sounding
            .get(*matra as usize)
            .copied()
            .unwrap_or(false),
        WhenPredicate::RestCountInCycle { op, count } => {
            let rests = cycle.beats.iter().filter(|b| !b.sounding).count() as u32;
            op.test(rests, *count)
        }
        WhenPredicate::SoundingCountInCycle { op, count } => {
            let sounding = cycle.beats.iter().filter(|b| b.sounding).count() as u32;
            op.test(sounding, *count)
        }
    }
}

/// Evaluate a WHEN tree across many source cycles, returning all fires sorted
/// ascending by `(event_reference_tick, source_cycle_index, matched_beat)`.
pub fn evaluate_cycles(when: &WhenSpec, cycles: &[ResolvedCycle]) -> Vec<TriggerFire> {
    let mut fires: Vec<TriggerFire> = cycles
        .iter()
        .flat_map(|cycle| evaluate_cycle(when, cycle))
        .collect();
    fires.sort_by_key(|f| (f.event_reference_tick, f.source_cycle_index, f.matched_beat));
    fires
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolve::{NoteGroup, ResolvedBeat, ResolvedCycle};

    const TPB: u64 = 960;

    fn ctx() -> EvalContext {
        EvalContext {
            ticks_per_reference_beat: TPB,
        }
    }

    fn beat(beat: u32, sounding: bool) -> ResolvedBeat {
        ResolvedBeat {
            beat,
            gati: 4,
            section_index: 0,
            section_start: beat == 0,
            jathi: None,
            start_tick: u64::from(beat) * TPB,
            end_tick: (u64::from(beat) + 1) * TPB,
            sounding,
            matra_sounding: vec![],
            jathi_pulse_start_ticks: vec![],
        }
    }

    fn cycle(index: u64, start_tick: u64, beats: Vec<ResolvedBeat>) -> ResolvedCycle {
        ResolvedCycle {
            cycle_index: index,
            start_tick,
            end_tick: start_tick + 4 * TPB,
            beats,
            note_groups: vec![NoteGroup {
                start_tick: 0,
                end_tick: 1,
            }],
        }
    }

    fn when_at(beat: u32, predicate: WhenPredicate) -> WhenSpec {
        WhenSpec {
            beats: BeatSelector::At { beat },
            tree: ConditionNode::leaf(predicate),
        }
    }

    #[test]
    fn beat_is_rest_fires_only_when_rest() {
        let resting = cycle(
            0,
            0,
            vec![beat(0, true), beat(1, true), beat(2, true), beat(3, false)],
        );
        let sounding = cycle(
            1,
            4 * TPB,
            vec![beat(0, true), beat(1, true), beat(2, true), beat(3, true)],
        );
        let when = when_at(3, WhenPredicate::IsRest);
        let fired = evaluate_cycle(&when, &resting);
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].event_reference_tick, 3 * TPB);
        assert_eq!(fired[0].matched_beat, 3);
        assert!(evaluate_cycle(&when, &sounding).is_empty());
    }

    #[test]
    fn beat_is_sounding_is_complement() {
        let c = cycle(0, 0, vec![beat(0, true), beat(1, false)]);
        assert_eq!(
            evaluate_cycle(&when_at(0, WhenPredicate::IsSounding), &c).len(),
            1
        );
        assert!(evaluate_cycle(&when_at(1, WhenPredicate::IsSounding), &c).is_empty());
    }

    #[test]
    fn gati_is_matches_per_beat() {
        let mut b2 = beat(2, true);
        b2.gati = 5;
        let c = cycle(0, 0, vec![beat(0, true), beat(1, true), b2, beat(3, true)]);
        assert_eq!(
            evaluate_cycle(&when_at(2, WhenPredicate::GatiIs { gati: 5 }), &c).len(),
            1
        );
        assert!(evaluate_cycle(&when_at(2, WhenPredicate::GatiIs { gati: 4 }), &c).is_empty());
    }

    #[test]
    fn section_start_condition() {
        let mut b2 = beat(2, true);
        b2.section_start = true;
        b2.section_index = 1;
        let c = cycle(0, 0, vec![beat(0, true), beat(1, true), b2, beat(3, true)]);
        assert_eq!(
            evaluate_cycle(&when_at(2, WhenPredicate::IsSectionStart), &c).len(),
            1
        );
        assert!(evaluate_cycle(&when_at(1, WhenPredicate::IsSectionStart), &c).is_empty());
    }

    #[test]
    fn jathi_pulse_fires_at_anchor_beat() {
        let mut b1 = beat(1, true);
        b1.jathi = Some(3);
        b1.jathi_pulse_start_ticks = vec![TPB];
        let c = cycle(0, 0, vec![beat(0, true), b1]);
        let fired = evaluate_cycle(&when_at(1, WhenPredicate::HasJathiPulse), &c);
        assert_eq!(fired.len(), 1);
        // Under the two-decision model the candidate anchors at the beat start.
        assert_eq!(fired[0].event_reference_tick, TPB);
        assert!(evaluate_cycle(&when_at(0, WhenPredicate::HasJathiPulse), &c).is_empty());
    }

    #[test]
    fn missing_beat_never_fires() {
        let c = cycle(0, 0, vec![beat(0, false)]);
        assert!(evaluate_cycle(&when_at(9, WhenPredicate::IsRest), &c).is_empty());
    }

    #[test]
    fn all_combines_predicates_at_anchor_beat() {
        // Beat 2 is a rest AND gati 5.
        let mut b2 = beat(2, false);
        b2.gati = 5;
        let c = cycle(0, 0, vec![beat(0, true), beat(1, true), b2, beat(3, true)]);
        let both = WhenSpec {
            beats: BeatSelector::At { beat: 2 },
            tree: ConditionNode::All {
                nodes: vec![
                    ConditionNode::leaf(WhenPredicate::IsRest),
                    ConditionNode::leaf(WhenPredicate::GatiIs { gati: 5 }),
                ],
            },
        };
        assert_eq!(evaluate_cycle(&both, &c).len(), 1);
        // Gati 7 fails the AND → no fire.
        let mismatch = WhenSpec {
            beats: BeatSelector::At { beat: 2 },
            tree: ConditionNode::All {
                nodes: vec![
                    ConditionNode::leaf(WhenPredicate::IsRest),
                    ConditionNode::leaf(WhenPredicate::GatiIs { gati: 7 }),
                ],
            },
        };
        assert!(evaluate_cycle(&mismatch, &c).is_empty());
    }

    #[test]
    fn any_and_not_compose() {
        let c = cycle(0, 0, vec![beat(0, true), beat(1, false)]);
        // ANY[ rest, gati 9 ] at beat 1 (rest) → fires.
        let any = WhenSpec {
            beats: BeatSelector::At { beat: 1 },
            tree: ConditionNode::Any {
                nodes: vec![
                    ConditionNode::leaf(WhenPredicate::IsRest),
                    ConditionNode::leaf(WhenPredicate::GatiIs { gati: 9 }),
                ],
            },
        };
        assert_eq!(evaluate_cycle(&any, &c).len(), 1);
        // NOT sounding == is rest.
        let not_sounding = WhenSpec {
            beats: BeatSelector::At { beat: 1 },
            tree: ConditionNode::Not {
                node: Box::new(ConditionNode::leaf(WhenPredicate::IsSounding)),
            },
        };
        assert_eq!(evaluate_cycle(&not_sounding, &c).len(), 1);
        assert!(evaluate_cycle(
            &WhenSpec {
                beats: BeatSelector::At { beat: 0 },
                tree: not_sounding.tree.clone(),
            },
            &c
        )
        .is_empty());
    }

    #[test]
    fn any_beat_selector_fires_at_every_match() {
        // beats 1 and 3 are rests; AnyBeat + IsRest → two candidates, sorted.
        let c = cycle(
            0,
            0,
            vec![beat(0, true), beat(1, false), beat(2, true), beat(3, false)],
        );
        let when = WhenSpec {
            beats: BeatSelector::AnyBeat,
            tree: ConditionNode::leaf(WhenPredicate::IsRest),
        };
        let fired = evaluate_cycle(&when, &c);
        assert_eq!(
            fired.iter().map(|f| f.matched_beat).collect::<Vec<_>>(),
            vec![1, 3]
        );
    }

    #[test]
    fn matra_predicates_read_the_beat_matra_map() {
        let mut b = beat(0, true);
        b.gati = 4;
        b.matra_sounding = vec![true, false, true, false];
        let c = cycle(0, 0, vec![b]);
        assert_eq!(
            evaluate_cycle(&when_at(0, WhenPredicate::MatraIsSounding { matra: 0 }), &c).len(),
            1
        );
        assert!(
            evaluate_cycle(&when_at(0, WhenPredicate::MatraIsSounding { matra: 1 }), &c).is_empty()
        );
        assert_eq!(
            evaluate_cycle(&when_at(0, WhenPredicate::MatraIsRest { matra: 1 }), &c).len(),
            1
        );
        // Out-of-range matra never matches.
        assert!(
            evaluate_cycle(&when_at(0, WhenPredicate::MatraIsSounding { matra: 9 }), &c).is_empty()
        );
    }

    #[test]
    fn cycle_level_count_predicate_gates_all_beats() {
        use crate::config::CountOp;
        // 2 rests in the cycle. "rest AND restCount >= 2" fires at each rest.
        let c = cycle(
            0,
            0,
            vec![beat(0, true), beat(1, false), beat(2, true), beat(3, false)],
        );
        let gated = WhenSpec {
            beats: BeatSelector::AnyBeat,
            tree: ConditionNode::All {
                nodes: vec![
                    ConditionNode::leaf(WhenPredicate::IsRest),
                    ConditionNode::leaf(WhenPredicate::RestCountInCycle {
                        op: CountOp::AtLeast,
                        count: 2,
                    }),
                ],
            },
        };
        assert_eq!(evaluate_cycle(&gated, &c).len(), 2);
        // Require >= 3 rests → the cycle-level gate fails for all beats.
        let too_many = WhenSpec {
            beats: BeatSelector::AnyBeat,
            tree: ConditionNode::All {
                nodes: vec![
                    ConditionNode::leaf(WhenPredicate::IsRest),
                    ConditionNode::leaf(WhenPredicate::RestCountInCycle {
                        op: CountOp::AtLeast,
                        count: 3,
                    }),
                ],
            },
        };
        assert!(evaluate_cycle(&too_many, &c).is_empty());
    }

    #[test]
    fn empty_combinator_normalizes_to_safe_default_before_evaluation() {
        let c = cycle(0, 0, vec![beat(0, false), beat(1, true)]);
        let empty_all = WhenSpec {
            beats: BeatSelector::AnyBeat,
            tree: ConditionNode::All { nodes: vec![] },
        };
        // A raw empty ALL would be vacuously true if evaluated directly as a
        // boolean fold. Public evaluation normalizes first, so it behaves like
        // the safe default IsRest predicate and only fires at the rest beat.
        let fired = evaluate_cycle(&empty_all, &c);
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].matched_beat, 0);
    }

    #[test]
    fn evaluate_cycle_populates_source_return_tick() {
        // rest@0, rest@1, sounding@2 ⇒ a fire at beat 0 (IsRest) returns at beat 2.
        let when = WhenSpec {
            beats: BeatSelector::At { beat: 0 },
            tree: ConditionNode::leaf(WhenPredicate::IsRest),
        };
        let c = cycle(0, 0, vec![beat(0, false), beat(1, false), beat(2, true)]);
        let fired = evaluate_cycle(&when, &c);
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].source_return_tick, Some(2 * TPB));
        assert_eq!(fired[0].matched_beat_end_tick, TPB);

        // All-rest cycle ⇒ no return.
        let silent = cycle(0, 0, vec![beat(0, false), beat(1, false)]);
        let fired = evaluate_cycle(&when, &silent);
        assert_eq!(fired[0].source_return_tick, None);
    }

    fn fire_at(event_reference_tick: u64, matched_beat_start_tick: u64, gati: u32) -> TriggerFire {
        TriggerFire {
            source_cycle_index: 0,
            matched_beat: 3,
            event_reference_tick,
            source_cycle_start_tick: 8 * TPB,
            matched_beat_start_tick,
            matched_beat_end_tick: matched_beat_start_tick + TPB,
            matched_beat_gati: gati,
            source_return_tick: None,
        }
    }

    #[test]
    fn center_in_rest_is_the_beat_midpoint() {
        let fire = fire_at(3 * TPB, 3 * TPB, 4); // beat span [3*TPB, 4*TPB)
        assert_eq!(
            fire.launch_tick(LaunchAlignment::CenterInRest, None, &ctx()),
            3 * TPB + TPB / 2
        );
    }

    #[test]
    fn at_source_return_uses_next_sounding_or_falls_back() {
        let mut fire = fire_at(3 * TPB, 3 * TPB, 4);
        // No return in-cycle ⇒ falls back to the event tick.
        assert_eq!(
            fire.launch_tick(LaunchAlignment::AtSourceReturn, None, &ctx()),
            3 * TPB
        );
        // A return at 5*TPB places beat 0 there.
        fire.source_return_tick = Some(5 * TPB);
        assert_eq!(
            fire.launch_tick(LaunchAlignment::AtSourceReturn, None, &ctx()),
            5 * TPB
        );
    }

    #[test]
    fn launch_alignment_math() {
        let fire = fire_at(3 * TPB + 100, 3 * TPB, 4); // 100 ticks past beat 3
        assert_eq!(
            fire.launch_tick(LaunchAlignment::AtEvent, None, &ctx()),
            3 * TPB + 100
        );
        assert_eq!(
            fire.launch_tick(LaunchAlignment::AtSourceCycleStart, None, &ctx()),
            8 * TPB
        );
        // Next reference beat after 3*TPB+100 is 4*TPB.
        assert_eq!(
            fire.launch_tick(LaunchAlignment::AtNextReferenceBeat, None, &ctx()),
            4 * TPB
        );
        assert_eq!(
            fire.launch_tick(LaunchAlignment::AfterEventTicks { ticks: 50 }, None, &ctx()),
            3 * TPB + 150
        );
    }

    #[test]
    fn at_next_reference_beat_is_idempotent_on_boundary() {
        let fire = fire_at(2 * TPB, 2 * TPB, 4);
        assert_eq!(
            fire.launch_tick(LaunchAlignment::AtNextReferenceBeat, None, &ctx()),
            2 * TPB
        );
    }

    fn quantize(grid: QuantizeGrid, direction: QuantizeDirection) -> Option<LaunchQuantize> {
        Some(LaunchQuantize { grid, direction })
    }

    #[test]
    fn quantize_reference_beat_fraction_snaps_to_subdivision() {
        // Event at beat 3 + 100 ticks; quarter-beat grid = TPB/4 = 240.
        let fire = fire_at(3 * TPB + 100, 3 * TPB, 4);
        let q = |dir| {
            fire.launch_tick(
                LaunchAlignment::AtEvent,
                quantize(QuantizeGrid::ReferenceBeatFraction { divisions: 4 }, dir),
                &ctx(),
            )
        };
        // 3*TPB = 2880; +100 = 2980. Quarter-beat grid points: 2880, 3120, ...
        assert_eq!(q(QuantizeDirection::Previous), 2880);
        assert_eq!(q(QuantizeDirection::Next), 3120);
        assert_eq!(q(QuantizeDirection::Nearest), 2880); // 100 < 120 (half of 240)
    }

    #[test]
    fn quantize_whole_beat_fraction_equals_next_reference_beat() {
        // divisions=1 + Next is exactly the AtNextReferenceBeat semantics.
        let fire = fire_at(3 * TPB + 100, 3 * TPB, 4);
        assert_eq!(
            fire.launch_tick(
                LaunchAlignment::AtEvent,
                quantize(
                    QuantizeGrid::ReferenceBeatFraction { divisions: 1 },
                    QuantizeDirection::Next
                ),
                &ctx(),
            ),
            fire.launch_tick(LaunchAlignment::AtNextReferenceBeat, None, &ctx()),
        );
    }

    #[test]
    fn quantize_reference_beat_multiple_snaps_to_n_beats() {
        // Event at 3*TPB+100; 2-beat grid points: 0, 1920, 3840, ...
        let fire = fire_at(3 * TPB + 100, 3 * TPB, 4);
        assert_eq!(
            fire.launch_tick(
                LaunchAlignment::AtEvent,
                quantize(
                    QuantizeGrid::ReferenceBeatMultiple { beats: 2 },
                    QuantizeDirection::Next
                ),
                &ctx(),
            ),
            4 * TPB // next 2-beat boundary after 2980 is 3840
        );
    }

    #[test]
    fn quantize_source_gati_matra_uses_beat_gati_and_phase() {
        // Beat 2 starts at 2*TPB=1920, gati 3 → matra step 320, phased at 1920:
        // grid 1920, 2240, 2560, ... Event 50 ticks into the beat → 1970.
        let fire = fire_at(2 * TPB + 50, 2 * TPB, 3);
        let q = |dir| {
            fire.launch_tick(
                LaunchAlignment::AtEvent,
                quantize(QuantizeGrid::SourceGatiMatra, dir),
                &ctx(),
            )
        };
        assert_eq!(q(QuantizeDirection::Previous), 1920);
        assert_eq!(q(QuantizeDirection::Next), 2240); // 1920 + 320
        assert_eq!(q(QuantizeDirection::Nearest), 1920); // 50 < 160
    }

    #[test]
    fn quantize_next_below_phase_clamps_to_phase() {
        let fire = TriggerFire {
            source_cycle_index: 0,
            matched_beat: 2,
            event_reference_tick: 2 * TPB,
            source_cycle_start_tick: 0,
            matched_beat_start_tick: 2 * TPB,
            matched_beat_end_tick: 3 * TPB,
            matched_beat_gati: 4,
            source_return_tick: None,
        };
        assert_eq!(
            fire.launch_tick(
                LaunchAlignment::AtSourceCycleStart,
                quantize(QuantizeGrid::SourceGatiMatra, QuantizeDirection::Next),
                &ctx(),
            ),
            2 * TPB
        );
    }

    #[test]
    fn quantize_launch_ticks_monotonic_in_reference_spaced_fixture() {
        // In this simple reference-spaced fixture, quantized launch ticks remain
        // non-decreasing in source-cycle order. The compiler does not rely on
        // that globally; it sorts by final snapped launch tick.
        let cond = when_at(0, WhenPredicate::IsRest);
        let grids = [
            QuantizeGrid::ReferenceBeatFraction { divisions: 3 },
            QuantizeGrid::ReferenceBeatMultiple { beats: 2 },
            QuantizeGrid::SourceGatiMatra,
        ];
        let dirs = [
            QuantizeDirection::Next,
            QuantizeDirection::Nearest,
            QuantizeDirection::Previous,
        ];
        // 6 one-beat cycles at absolute reference ticks, beat 0 always a rest
        // (gati 3 to exercise the SourceGatiMatra grid).
        let cycles: Vec<ResolvedCycle> = (0..6)
            .map(|i| {
                let base = i * TPB;
                ResolvedCycle {
                    cycle_index: i,
                    start_tick: base,
                    end_tick: base + TPB,
                    beats: vec![ResolvedBeat {
                        beat: 0,
                        gati: 3,
                        section_index: 0,
                        section_start: true,
                        jathi: None,
                        start_tick: base,
                        end_tick: base + TPB,
                        sounding: false,
                        matra_sounding: vec![],
                        jathi_pulse_start_ticks: vec![],
                    }],
                    note_groups: vec![],
                }
            })
            .collect();
        for grid in grids {
            for dir in dirs {
                let fires = evaluate_cycles(&cond, &cycles);
                let ticks: Vec<u64> = fires
                    .iter()
                    .map(|f| f.launch_tick(LaunchAlignment::AtEvent, quantize(grid, dir), &ctx()))
                    .collect();
                for pair in ticks.windows(2) {
                    assert!(
                        pair[0] <= pair[1],
                        "non-monotonic {ticks:?} for {grid:?}/{dir:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn evaluate_cycles_sorts_by_tick() {
        let cond = when_at(0, WhenPredicate::IsRest);
        let c0 = cycle(0, 0, vec![beat(0, false)]);
        let c1 = cycle(1, 4 * TPB, vec![beat(0, false)]);
        // Provide out of order; expect sorted ascending by tick.
        let fires = evaluate_cycles(&cond, &[c1.clone(), c0.clone()]);
        assert_eq!(fires.len(), 2);
        assert!(fires[0].event_reference_tick <= fires[1].event_reference_tick);
        assert_eq!(fires[0].source_cycle_index, 0);
        assert_eq!(fires[1].source_cycle_index, 1);
    }
}
