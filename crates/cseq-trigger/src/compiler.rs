//! The windowed triggered-score compiler.
//!
//! `compile_window(cfg, source_cycles, window, follower, ctx, carry_in)`
//! → `(launches, carry_out)` is a **pure function** that decides, for a bounded
//! reference-tick window, where the follower launches, how long each run is, and
//! which stable follower-cycle indices each run uses. The transport then
//! realizes those launches (and truncates not-yet-realized cycles on restart).
//!
//! ## Carry state (critique #5)
//!
//! Launches are emitted in the window where they *start*; a run that crosses the
//! window boundary is summarized in [`TriggerCarry::active_run`] so the next
//! window applies re-trigger correctly without re-emitting or mutating it.
//! `next_run_index` / `next_local_cycle_index` thread the stable identity +
//! follower cycle counter; precise consumed fire identities dedupe a source fire
//! that appears in two overlapping windows. This matters because launch
//! quantize can reorder launch ticks relative to source-cycle order. This makes
//! `compile([0,W]) ++ compile([W,2W])` equal to `compile([0,2W])`
//! (the **windowing-is-associative** property, proven in tests).
//!
//! ## Determinism & stable identity (critique #4)
//!
//! Launches are a pure function of `(cfg, source_cycles, carry)`. Each launch's
//! `first_local_cycle_index` is assigned from a monotonic counter that is
//! reproducible from cycle 0, so a recompile/reapply (which restarts from cycle
//! 0 with a fresh carry) reproduces identical launch identities and follower
//! cycle indices — the same trigger yields the same launched phrase.
//!
//! ## Future-only (critique #6)
//!
//! A fire whose launch tick is before `window.start` is dropped (it would
//! require launching at an already-finalized tick). "Instant start" therefore
//! applies only to trigger ticks inside the not-yet-realized window.

use crate::config::{LaunchAlignment, ReTrigger, TriggerConfig};
use crate::evaluator::{evaluate_cycles, EvalContext};
use crate::gate::{evaluate_gate, GateEval, GateRejectReason, GateRoll, GateState};
use crate::resolve::ResolvedCycle;
use crate::start::choose_start;
use std::collections::BTreeSet;

/// Hard cap for carried consumed-fire identities. The transport only retains a
/// bounded source-resolution history, so this is ample for overlapping windows
/// while preventing unbounded carry growth in long playback sessions.
const CONSUMED_FIRE_CEILING: usize = 8192;

/// Reference-tick window `[start, end)` the follower is compiled over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TickWindow {
    pub start: u64,
    pub end: u64,
}

/// Follower realization parameters the compiler needs in reference ticks.
pub struct FollowerSpec<'a> {
    /// Reference-tick duration of one follower phrase (one realized follower
    /// cycle). For `length: scoreCycle` this is the follower's mapped cycle
    /// duration; for `length: fixedBeats { n }` it is `n` reference beats.
    /// Used as a fixed fallback when no per-cycle duration callback is supplied.
    pub phrase_reference_ticks: u64,
    /// Optional exact duration lookup for follower local cycle indices. Transport
    /// uses this when per-cycle local tempo automation changes phrase duration.
    pub phrase_reference_ticks_for_cycle: Option<&'a dyn Fn(u64) -> u64>,
}

impl std::fmt::Debug for FollowerSpec<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FollowerSpec")
            .field("phrase_reference_ticks", &self.phrase_reference_ticks)
            .field(
                "phrase_reference_ticks_for_cycle",
                &self.phrase_reference_ticks_for_cycle.is_some(),
            )
            .finish()
    }
}

impl FollowerSpec<'_> {
    fn phrase_ticks_for_cycle(&self, local_cycle_index: u64) -> u64 {
        self.phrase_reference_ticks_for_cycle
            .map(|lookup| lookup(local_cycle_index))
            .unwrap_or(self.phrase_reference_ticks)
            .max(1)
    }

    fn run_ticks(&self, first_local_cycle_index: u64, passes: u32) -> u64 {
        (0..passes).fold(0_u64, |total, offset| {
            total.saturating_add(
                self.phrase_ticks_for_cycle(
                    first_local_cycle_index.saturating_add(u64::from(offset)),
                ),
            )
        })
    }
}

/// One compiled launch: a run of `local_cycle_count` follower phrases starting
/// at `reference_start_tick`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompiledLaunch {
    /// Stable identity for tracing/dedup, reproducible across recompile.
    pub launch_id: u64,
    /// Reference tick where the follower's beat 0 lands.
    pub reference_start_tick: u64,
    /// Stable follower cycle index of this run's first phrase (feeds per-cycle
    /// seeding; reproducible from cycle 0).
    pub first_local_cycle_index: u64,
    /// Nominal number of follower phrases (passes) this run realizes.
    pub local_cycle_count: u32,
    /// Reference duration of one phrase (so the transport can place cycle k at
    /// `reference_start_tick + k * phrase_reference_ticks`).
    pub phrase_reference_ticks: u64,
    /// Exact nominal duration of this whole run in reference ticks.
    pub run_reference_ticks: u64,
    /// Monotonic run index (0-based), reproducible from cycle 0.
    pub run_index: u32,
    /// Source cycle that triggered this launch.
    pub source_cycle_index: u64,
    /// Source beat that matched.
    pub matched_beat: u32,
}

impl CompiledLaunch {
    /// Nominal end reference tick (may extend past the compile window).
    pub fn nominal_end_tick(&self) -> u64 {
        self.reference_start_tick
            .saturating_add(self.run_reference_ticks)
    }
}

/// A run summarized for the next window's re-trigger logic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActiveRun {
    pub launch_id: u64,
    pub start_tick: u64,
    pub end_tick: u64,
    pub run_index: u32,
}

/// A depth-1 queued launch awaiting the active run's end (re-trigger = queue).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueuedLaunch {
    pub source_cycle_index: u64,
    pub matched_beat: u32,
}

/// Identity of one source fire, used for exact dedupe across overlapping
/// compile windows. v1 conditions produce at most one fire per source cycle, but
/// keeping the beat in the identity avoids baking that assumption into carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ConsumedFire {
    pub source_cycle_index: u64,
    pub matched_beat: u32,
}

/// State threaded between successive `compile_window` calls.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TriggerCarry {
    pub active_run: Option<ActiveRun>,
    pub queued: Option<QueuedLaunch>,
    pub next_run_index: u32,
    pub next_local_cycle_index: u64,
    /// Highest consumed source cycle index, retained as a human-readable
    /// summary for diagnostics/tests. Dedupe uses `consumed_fires`, because
    /// quantized launch ticks can be processed out of source-cycle order.
    pub consumed_through_source_cycle: Option<u64>,
    pub consumed_fires: Vec<ConsumedFire>,
    /// GATE counters (Phase C): the consecutive-miss streak + last-accept cycle.
    /// Evolves only by processing consumed candidates in launch-tick order, so it
    /// converges identically whether a window is compiled whole or split.
    pub gate_state: GateState,
}

/// The fate of one WHEN candidate, recorded as a **by-product of the same pure
/// computation** that produced the launches — so the event log / state strip can
/// never disagree with the audio (Plan §3). Ordered by processing (launch-tick)
/// order within the window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TriggerDecision {
    pub source_cycle_index: u64,
    pub matched_beat: u32,
    /// The raw matched-event reference tick (pre alignment/quantize) — the WHEN
    /// onset. Pairs with `candidate_tick` to draw the START placement connector.
    pub event_reference_tick: u64,
    /// The launch tick this candidate would use (post alignment + quantize).
    pub candidate_tick: u64,
    /// Probability rolls taken. Empty when the gate is absent, or when the only
    /// rejection was a cooldown (which takes no roll).
    pub gate_rolls: Vec<GateRoll>,
    /// The START alignment resolved for this candidate (Phase D) — the single
    /// `launch_alignment`, or the option a weighted `StartSelect` chose.
    pub start_alignment: LaunchAlignment,
    pub outcome: DecisionOutcome,
    /// Gate counters *after* this decision (for the trust surface).
    pub gate_state_after: GateState,
}

/// The outcome recorded in a [`TriggerDecision`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionOutcome {
    /// Accepted and launched now.
    Launched {
        launch_id: u64,
        launch_tick: u64,
        run_index: u32,
    },
    /// Accepted by the gate but deferred behind the active run (re-trigger=queue).
    Queued,
    /// Not launched. `reason` distinguishes gate vs re-trigger suppression.
    Suppressed { reason: SuppressReason },
}

/// Why a candidate did not launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuppressReason {
    /// Gate probability roll failed.
    GateProbability,
    /// Gate cooldown active.
    GateCooldown,
    /// Accepted by the gate, but an active run + re-trigger=ignore dropped it.
    ReTriggerIgnore,
    /// Accepted by the gate, but the depth-1 re-trigger queue was already full.
    ReTriggerQueueFull,
}

/// Output of one compile window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledWindow {
    pub launches: Vec<CompiledLaunch>,
    pub carry_out: TriggerCarry,
    /// Ordered acceptance trace for the trust surface. A pure by-product of the
    /// same computation that produced `launches`.
    pub decisions: Vec<TriggerDecision>,
}

/// Deterministic, RNG-free mix for a stable launch id. (splitmix64 finalizer.)
fn stable_launch_id(source_cycle_index: u64, matched_beat: u32, run_index: u32) -> u64 {
    let mut z = source_cycle_index
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(u64::from(matched_beat).wrapping_mul(0xBF58_476D_1CE4_E5B9))
        .wrapping_add(u64::from(run_index).wrapping_mul(0x94D0_49BB_1331_11EB));
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// An internal candidate fire with its resolved launch tick + the START
/// alignment chosen for it (a fixed alignment, or one picked by a seeded
/// weighted `StartSelect`).
#[derive(Debug, Clone, Copy)]
struct WindowFire {
    launch_tick: u64,
    /// The raw matched-event reference tick (pre alignment/quantize). Recorded in
    /// the trace so the timeline can draw the event → placement connector.
    event_reference_tick: u64,
    source_cycle_index: u64,
    matched_beat: u32,
    alignment: LaunchAlignment,
}

impl WindowFire {
    fn consumed_fire(&self) -> ConsumedFire {
        ConsumedFire {
            source_cycle_index: self.source_cycle_index,
            matched_beat: self.matched_beat,
        }
    }
}

/// Compile the follower's launches for one reference-tick window.
pub fn compile_window(
    cfg: &TriggerConfig,
    source_cycles: &[ResolvedCycle],
    window: TickWindow,
    follower: &FollowerSpec,
    ctx: &EvalContext,
    carry_in: TriggerCarry,
) -> CompiledWindow {
    let cfg = cfg.normalized();
    let mut carry = carry_in;
    let passes = cfg.passes();

    // A stale active run that ended before this window needs no special entry
    // handling: the `launch_tick < end_tick` active test below treats it as
    // inactive, and the post-loop canonicalization drops it. (A run is only
    // ever carried in if it ends at/after this window's start.)

    // 1. Evaluate fires, dedupe already-consumed source fires, resolve launch
    //    ticks, then sort by launch time. Source-gati quantize can reorder
    //    launch ticks relative to source-cycle order under local tempo changes.
    let when = cfg.effective_when();
    let all_fires = evaluate_cycles(&when, source_cycles);
    let mut consumed_fires: BTreeSet<ConsumedFire> = carry.consumed_fires.iter().copied().collect();
    let mut window_fires: Vec<WindowFire> = Vec::new();
    for fire in all_fires {
        let consumed_fire = ConsumedFire {
            source_cycle_index: fire.source_cycle_index,
            matched_beat: fire.matched_beat,
        };
        if consumed_fires.contains(&consumed_fire) {
            continue;
        }
        // START placement (Phase D): a weighted `StartSelect` picks the alignment
        // per candidate by a seeded, identity-stable roll, else the single
        // `launch_alignment`. The pick happens here so it feeds both the launch
        // tick and the decision trace, and stays window-split-independent.
        let alignment = match &cfg.start_select {
            Some(select) if !select.options.is_empty() => {
                choose_start(select, fire.source_cycle_index, fire.matched_beat).alignment
            }
            _ => cfg.launch_alignment,
        };
        let launch_tick = fire.launch_tick(alignment, cfg.launch_quantize, ctx);
        if launch_tick < window.start {
            // Past fire: cannot retro-launch at a finalized tick. Consume it.
            consumed_fires.insert(consumed_fire);
            continue;
        }
        if launch_tick >= window.end {
            // Future fire: leave it for the next window. Do not break: a later
            // source fire may quantize/place to an earlier in-window launch tick.
            continue;
        }
        window_fires.push(WindowFire {
            launch_tick,
            event_reference_tick: fire.event_reference_tick,
            source_cycle_index: fire.source_cycle_index,
            matched_beat: fire.matched_beat,
            alignment,
        });
    }
    window_fires.sort_by_key(|fire| (fire.launch_tick, fire.source_cycle_index, fire.matched_beat));

    // 2. Discrete-event simulation over in-window fires + queue releases.
    let mut launches: Vec<CompiledLaunch> = Vec::new();
    let mut decisions: Vec<TriggerDecision> = Vec::new();
    let mut fire_idx = 0usize;
    // Hard safety cap: every iteration either consumes a fire or releases a
    // queue (which clears `queued`, set only by a fire), so progress is
    // guaranteed; the cap is belt-and-suspenders against future edits.
    let safety = window_fires.len().saturating_mul(2).saturating_add(8);
    let mut guard = 0usize;

    loop {
        guard += 1;
        if guard > safety {
            break;
        }
        let next_fire_tick = window_fires.get(fire_idx).map(|f| f.launch_tick);
        let next_release_tick = match (&carry.active_run, &carry.queued) {
            (Some(run), Some(_)) if run.end_tick >= window.start && run.end_tick < window.end => {
                Some(run.end_tick)
            }
            _ => None,
        };

        // A queue release at the run's end happens before a fire at the same
        // tick (the run ends → armed → the fire then starts a fresh launch).
        let do_release = match (next_fire_tick, next_release_tick) {
            (Some(ft), Some(rt)) => rt <= ft,
            (None, Some(_)) => true,
            (Some(_), None) => false,
            (None, None) => break,
        };

        if do_release {
            let release_tick = next_release_tick.expect("release tick present");
            let queued = carry.queued.take().expect("queued present");
            let launch = emit_launch(
                release_tick,
                queued.source_cycle_index,
                queued.matched_beat,
                passes,
                follower,
                &mut carry,
            );
            launches.push(launch);
        } else {
            let fire = window_fires[fire_idx];
            fire_idx += 1;
            let consumed_fire = fire.consumed_fire();

            // GATE (acceptance) runs *before* the re-trigger policy. An absent
            // gate ⇒ always accept (pre-Phase-C behavior). The roll is seeded by
            // the candidate's stable identity, so it is window-split-independent.
            let mut gate_rolls: Vec<GateRoll> = Vec::new();
            if let Some(gate) = &cfg.gate {
                match evaluate_gate(
                    gate,
                    &mut carry.gate_state,
                    fire.source_cycle_index,
                    fire.matched_beat,
                ) {
                    GateEval::Accept { roll } => gate_rolls.extend(roll),
                    GateEval::Reject { reason, roll } => {
                        gate_rolls.extend(roll);
                        let reason = match reason {
                            GateRejectReason::Probability => SuppressReason::GateProbability,
                            GateRejectReason::Cooldown => SuppressReason::GateCooldown,
                        };
                        decisions.push(TriggerDecision {
                            source_cycle_index: fire.source_cycle_index,
                            matched_beat: fire.matched_beat,
                            event_reference_tick: fire.event_reference_tick,
                            candidate_tick: fire.launch_tick,
                            gate_rolls,
                            start_alignment: fire.alignment,
                            outcome: DecisionOutcome::Suppressed { reason },
                            gate_state_after: carry.gate_state,
                        });
                        consumed_fires.insert(consumed_fire);
                        continue; // rejected: no re-trigger interaction
                    }
                }
            }

            // Gate accepted (or no gate) ⇒ apply the re-trigger policy.
            let active = carry
                .active_run
                .filter(|run| fire.launch_tick < run.end_tick);
            let outcome = match (active.is_some(), cfg.re_trigger) {
                (true, ReTrigger::Ignore) => {
                    // Ignore: drop the trigger; the active run continues.
                    DecisionOutcome::Suppressed {
                        reason: SuppressReason::ReTriggerIgnore,
                    }
                }
                (true, ReTrigger::Queue) => {
                    // Depth 1: only the first queued trigger is kept.
                    if carry.queued.is_none() {
                        carry.queued = Some(QueuedLaunch {
                            source_cycle_index: fire.source_cycle_index,
                            matched_beat: fire.matched_beat,
                        });
                        DecisionOutcome::Queued
                    } else {
                        DecisionOutcome::Suppressed {
                            reason: SuppressReason::ReTriggerQueueFull,
                        }
                    }
                }
                _ => {
                    // Restart while running, or a fresh launch while armed.
                    let launch = emit_launch(
                        fire.launch_tick,
                        fire.source_cycle_index,
                        fire.matched_beat,
                        passes,
                        follower,
                        &mut carry,
                    );
                    // A restart supersedes any pending queue.
                    carry.queued = None;
                    let outcome = DecisionOutcome::Launched {
                        launch_id: launch.launch_id,
                        launch_tick: launch.reference_start_tick,
                        run_index: launch.run_index,
                    };
                    launches.push(launch);
                    outcome
                }
            };
            decisions.push(TriggerDecision {
                source_cycle_index: fire.source_cycle_index,
                matched_beat: fire.matched_beat,
                event_reference_tick: fire.event_reference_tick,
                candidate_tick: fire.launch_tick,
                gate_rolls,
                start_alignment: fire.alignment,
                outcome,
                gate_state_after: carry.gate_state,
            });
            consumed_fires.insert(consumed_fire);
        }
    }

    prune_consumed_fires(&mut consumed_fires, source_cycles);
    carry.consumed_fires = consumed_fires.into_iter().collect();
    carry.consumed_through_source_cycle = carry
        .consumed_fires
        .iter()
        .map(|fire| fire.source_cycle_index)
        .max();

    // Canonicalize the carry so that windowing is associative: keep `active_run`
    // (and its queued launch) only if it crosses into the next window, i.e. ends
    // at or after `window.end`. A run that ended strictly within this window is
    // finished by the next window's start and must not linger, regardless of
    // whether the whole window or a split produced it.
    if let Some(run) = carry.active_run {
        if run.end_tick < window.end {
            carry.active_run = None;
            carry.queued = None;
        }
    }

    CompiledWindow {
        launches,
        carry_out: carry,
        decisions,
    }
}

fn prune_consumed_fires(
    consumed_fires: &mut BTreeSet<ConsumedFire>,
    source_cycles: &[ResolvedCycle],
) {
    if let Some(min_cycle_index) = source_cycles.iter().map(|cycle| cycle.cycle_index).min() {
        consumed_fires.retain(|fire| fire.source_cycle_index >= min_cycle_index);
    }
    while consumed_fires.len() > CONSUMED_FIRE_CEILING {
        let Some(first) = consumed_fires.iter().next().copied() else {
            break;
        };
        consumed_fires.remove(&first);
    }
}

fn emit_launch(
    tick: u64,
    source_cycle_index: u64,
    matched_beat: u32,
    passes: u32,
    follower: &FollowerSpec<'_>,
    carry: &mut TriggerCarry,
) -> CompiledLaunch {
    let run_index = carry.next_run_index;
    carry.next_run_index = carry.next_run_index.saturating_add(1);
    let first_local_cycle_index = carry.next_local_cycle_index;
    carry.next_local_cycle_index = carry
        .next_local_cycle_index
        .saturating_add(u64::from(passes));
    let launch_id = stable_launch_id(source_cycle_index, matched_beat, run_index);
    let phrase = follower.phrase_ticks_for_cycle(first_local_cycle_index);
    let run_reference_ticks = follower.run_ticks(first_local_cycle_index, passes);
    let end_tick = tick.saturating_add(run_reference_ticks);
    carry.active_run = Some(ActiveRun {
        launch_id,
        start_tick: tick,
        end_tick,
        run_index,
    });
    CompiledLaunch {
        launch_id,
        reference_start_tick: tick,
        first_local_cycle_index,
        local_cycle_count: passes,
        phrase_reference_ticks: phrase,
        run_reference_ticks,
        run_index,
        source_cycle_index,
        matched_beat,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        BeatSelector, ConditionNode, GateSpec, LaunchAlignment, LaunchQuantize, Lifetime,
        QuantizeDirection, QuantizeGrid, StartSelect, TriggerCondition, TriggerLength,
        WeightedStart, WhenPredicate, WhenSpec, DEFAULT_MAX_REPEATS, GATE_PROBABILITY_MAX,
    };
    use crate::resolve::{NoteGroup, ResolvedBeat, ResolvedCycle};

    const TPB: u64 = 960;
    const CYCLE_BEATS: u64 = 4;
    const CYCLE_TICKS: u64 = TPB * CYCLE_BEATS;

    fn ctx() -> EvalContext {
        EvalContext {
            ticks_per_reference_beat: TPB,
        }
    }

    fn follower() -> FollowerSpec<'static> {
        // 2-beat follower phrase against a 4-beat reference cycle (off-grid).
        FollowerSpec {
            phrase_reference_ticks: 2 * TPB,
            phrase_reference_ticks_for_cycle: None,
        }
    }

    fn cfg(re_trigger: ReTrigger, lifetime: Lifetime) -> TriggerConfig {
        TriggerConfig {
            source_track_id: "lead".to_string(),
            when: None,
            condition: Some(TriggerCondition::BeatIsRest { beat: 3 }),
            launch_alignment: LaunchAlignment::AtEvent,
            launch_quantize: None,
            lifetime,
            re_trigger,
            length: TriggerLength::ScoreCycle,
            max_repeats: DEFAULT_MAX_REPEATS,
            gate: None,
            start_select: None,
        }
    }

    /// Source cycle `index` based at reference tick `index * CYCLE_TICKS`, with
    /// beat 3 a rest iff `rest_on_3`.
    fn source_cycle(index: u64, rest_on_3: bool) -> ResolvedCycle {
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

    fn one_beat_source_cycle(index: u64, start_tick: u64, gati: u32) -> ResolvedCycle {
        ResolvedCycle {
            cycle_index: index,
            start_tick,
            end_tick: start_tick + TPB,
            beats: vec![ResolvedBeat {
                beat: 0,
                gati,
                section_index: 0,
                section_start: true,
                jathi: None,
                start_tick,
                end_tick: start_tick + TPB,
                sounding: false,
                matra_sounding: vec![],
                jathi_pulse_start_ticks: vec![],
            }],
            note_groups: vec![],
        }
    }

    fn whole_window(cycles: u64) -> TickWindow {
        TickWindow {
            start: 0,
            end: cycles * CYCLE_TICKS,
        }
    }

    #[test]
    fn worked_example_one_pass_launches_at_rest_tick() {
        // Track 1: beat 3 rest in cycle 0 and cycle 2; sounding in cycle 1.
        let cycles = vec![
            source_cycle(0, true),
            source_cycle(1, false),
            source_cycle(2, true),
        ];
        let out = compile_window(
            &cfg(ReTrigger::Restart, Lifetime::OnePass),
            &cycles,
            whole_window(3),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(out.launches.len(), 2);
        // Launch at beat 3 of cycle 0 = tick 3*TPB; and cycle 2 = 2*CYCLE+3*TPB.
        assert_eq!(out.launches[0].reference_start_tick, 3 * TPB);
        assert_eq!(
            out.launches[1].reference_start_tick,
            2 * CYCLE_TICKS + 3 * TPB
        );
        // onePass => 1 follower cycle each.
        assert_eq!(out.launches[0].local_cycle_count, 1);
        // Stable follower cycle indices: 0 then 1.
        assert_eq!(out.launches[0].first_local_cycle_index, 0);
        assert_eq!(out.launches[1].first_local_cycle_index, 1);
        assert_eq!(out.launches[0].phrase_reference_ticks, 2 * TPB);
    }

    #[test]
    fn determinism_same_inputs_same_output() {
        let cycles = vec![source_cycle(0, true), source_cycle(1, true)];
        let a = compile_window(
            &cfg(ReTrigger::Restart, Lifetime::OnePass),
            &cycles,
            whole_window(2),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let b = compile_window(
            &cfg(ReTrigger::Restart, Lifetime::OnePass),
            &cycles,
            whole_window(2),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(a, b);
    }

    #[test]
    fn restart_supersedes_active_run() {
        // Two rests close together; with a long (repeats) run, the second
        // restarts. Use repeats=4 so the first run spans the second trigger.
        let cycles = vec![source_cycle(0, true), source_cycle(1, true)];
        let out = compile_window(
            &cfg(ReTrigger::Restart, Lifetime::Repeats { passes: 4 }),
            &cycles,
            whole_window(2),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        // Both fires produce launches (restart = new launch each time).
        assert_eq!(out.launches.len(), 2);
        assert_eq!(out.launches[0].reference_start_tick, 3 * TPB);
        assert_eq!(out.launches[1].reference_start_tick, CYCLE_TICKS + 3 * TPB);
        // Run indices increment; follower cycle indices advance by passes.
        assert_eq!(out.launches[0].run_index, 0);
        assert_eq!(out.launches[1].run_index, 1);
        assert_eq!(out.launches[0].first_local_cycle_index, 0);
        assert_eq!(out.launches[1].first_local_cycle_index, 4);
    }

    #[test]
    fn ignore_drops_triggers_while_running() {
        let cycles = vec![source_cycle(0, true), source_cycle(1, true)];
        let out = compile_window(
            &cfg(ReTrigger::Ignore, Lifetime::Repeats { passes: 4 }),
            &cycles,
            whole_window(2),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        // Only the first launches; the second is inside the active run → ignored.
        assert_eq!(out.launches.len(), 1);
        assert_eq!(out.launches[0].reference_start_tick, 3 * TPB);
    }

    #[test]
    fn queue_depth_one_releases_after_run_end() {
        // repeats=1 run from cycle 0 (start 3*TPB, end 3*TPB + 2*TPB = 5*TPB).
        // A second trigger at cycle 1 beat 3 = CYCLE+3*TPB = 7*TPB, which is
        // AFTER 5*TPB, so the run already ended → it just launches again.
        // To exercise queue, make the run long (repeats=4 => end 3*TPB+8*TPB).
        let cycles = vec![source_cycle(0, true), source_cycle(1, true)];
        let out = compile_window(
            &cfg(ReTrigger::Queue, Lifetime::Repeats { passes: 4 }),
            &cycles,
            whole_window(4),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        // First launch at 3*TPB, run ends at 3*TPB + 8*TPB = 11*TPB.
        // Second trigger at 7*TPB is inside the run → queued, released at 11*TPB.
        assert_eq!(out.launches.len(), 2);
        assert_eq!(out.launches[0].reference_start_tick, 3 * TPB);
        assert_eq!(out.launches[1].reference_start_tick, 11 * TPB);
    }

    #[test]
    fn fires_before_window_start_are_dropped_future_only() {
        // Window starts at 1.5 cycles; cycle 0's rest at 3*TPB is in the past.
        let cycles = vec![source_cycle(0, true), source_cycle(1, true)];
        let out = compile_window(
            &cfg(ReTrigger::Restart, Lifetime::OnePass),
            &cycles,
            TickWindow {
                start: CYCLE_TICKS + 2 * TPB, // 6*TPB
                end: 2 * CYCLE_TICKS,
            },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        // Cycle 0 rest (3*TPB) dropped (past). Cycle 1 rest (CYCLE+3*TPB=7*TPB)
        // is in window.
        assert_eq!(out.launches.len(), 1);
        assert_eq!(out.launches[0].reference_start_tick, 7 * TPB);
        // Past fire consumed so it never re-launches.
        assert_eq!(out.carry_out.consumed_through_source_cycle, Some(1));
    }

    #[test]
    fn zero_length_no_op_when_no_fires() {
        let cycles = vec![source_cycle(0, false), source_cycle(1, false)];
        let out = compile_window(
            &cfg(ReTrigger::Restart, Lifetime::OnePass),
            &cycles,
            whole_window(2),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert!(out.launches.is_empty());
        assert!(out.carry_out.active_run.is_none());
    }

    #[test]
    fn windowing_is_associative_split_vs_whole() {
        // Rests on cycles 0,1,2,3; restart, repeats=3 so runs cross boundaries.
        let cfg = cfg(ReTrigger::Restart, Lifetime::Repeats { passes: 3 });
        let cycles: Vec<ResolvedCycle> = (0..4).map(|i| source_cycle(i, true)).collect();

        // Whole window [0, 4 cycles).
        let whole = compile_window(
            &cfg,
            &cycles,
            whole_window(4),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );

        // Split at 2 cycles, threading carry.
        let first = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 0,
                end: 2 * CYCLE_TICKS,
            },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let second = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 2 * CYCLE_TICKS,
                end: 4 * CYCLE_TICKS,
            },
            &follower(),
            &ctx(),
            first.carry_out.clone(),
        );

        let mut combined = first.launches.clone();
        combined.extend(second.launches.clone());
        assert_eq!(combined, whole.launches, "split launches must equal whole");
        assert_eq!(second.carry_out, whole.carry_out, "carry must converge");
    }

    #[test]
    fn windowing_associative_with_queue_across_boundary() {
        let cfg = cfg(ReTrigger::Queue, Lifetime::Repeats { passes: 5 });
        let cycles: Vec<ResolvedCycle> = (0..4).map(|i| source_cycle(i, true)).collect();
        let whole = compile_window(
            &cfg,
            &cycles,
            whole_window(4),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let first = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 0,
                end: 2 * CYCLE_TICKS,
            },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let second = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 2 * CYCLE_TICKS,
                end: 4 * CYCLE_TICKS,
            },
            &follower(),
            &ctx(),
            first.carry_out.clone(),
        );
        let mut combined = first.launches.clone();
        combined.extend(second.launches.clone());
        assert_eq!(combined, whole.launches);
        assert_eq!(second.carry_out, whole.carry_out);
    }

    #[test]
    fn non_monotonic_quantized_launches_do_not_drop_future_source_cycles() {
        // Local tempo can place source cycles close together in reference time.
        // With SourceGatiMatra quantize, the first source cycle can snap later
        // than the second; the compiler must sort by launch tick, not break on
        // source-cycle order.
        let mut cfg = cfg(ReTrigger::Restart, Lifetime::OnePass);
        cfg.condition = Some(TriggerCondition::BeatIsRest { beat: 0 });
        cfg.launch_alignment = LaunchAlignment::AfterEventTicks { ticks: 500 };
        cfg.launch_quantize = Some(LaunchQuantize {
            grid: QuantizeGrid::SourceGatiMatra,
            direction: QuantizeDirection::Next,
        });
        let cycles = vec![
            // anchor 500, phase 0, gati 1 => snaps to 960 (future for [0,900)).
            one_beat_source_cycle(0, 0, 1),
            // anchor 560, phase 60, gati 4 => snaps to 780 (inside [0,900)).
            one_beat_source_cycle(1, 60, 4),
        ];

        let whole = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 0,
                end: 1000,
            },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(
            whole
                .launches
                .iter()
                .map(|launch| (launch.reference_start_tick, launch.source_cycle_index))
                .collect::<Vec<_>>(),
            vec![(780, 1), (960, 0)]
        );

        let first = compile_window(
            &cfg,
            &cycles,
            TickWindow { start: 0, end: 900 },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(
            first
                .launches
                .iter()
                .map(|launch| (launch.reference_start_tick, launch.source_cycle_index))
                .collect::<Vec<_>>(),
            vec![(780, 1)]
        );

        let second = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 900,
                end: 1000,
            },
            &follower(),
            &ctx(),
            first.carry_out.clone(),
        );
        let mut combined = first.launches.clone();
        combined.extend(second.launches.clone());
        assert_eq!(combined, whole.launches);
        assert_eq!(second.carry_out, whole.carry_out);
    }

    #[test]
    fn dedupe_prevents_double_launch_on_overlapping_windows() {
        // Same source cycle offered to two windows; the second must not relaunch.
        let cycles = vec![source_cycle(0, true)];
        let first = compile_window(
            &cfg(ReTrigger::Restart, Lifetime::OnePass),
            &cycles,
            whole_window(1),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(first.launches.len(), 1);
        let second = compile_window(
            &cfg(ReTrigger::Restart, Lifetime::OnePass),
            &cycles, // same cycle again
            whole_window(1),
            &follower(),
            &ctx(),
            first.carry_out.clone(),
        );
        assert!(
            second.launches.is_empty(),
            "consumed cycle must not relaunch"
        );
    }

    #[test]
    fn any_beat_candidate_on_split_edge_is_emitted_once() {
        let mut cfg = cfg(ReTrigger::Restart, Lifetime::OnePass);
        cfg.condition = None;
        cfg.when = Some(WhenSpec {
            beats: BeatSelector::AnyBeat,
            tree: ConditionNode::leaf(WhenPredicate::IsRest),
        });
        let base = 0;
        let cycle = ResolvedCycle {
            cycle_index: 0,
            start_tick: base,
            end_tick: base + CYCLE_TICKS,
            beats: (0..4)
                .map(|beat| ResolvedBeat {
                    beat,
                    gati: 4,
                    section_index: 0,
                    section_start: beat == 0,
                    jathi: None,
                    start_tick: base + u64::from(beat) * TPB,
                    end_tick: base + (u64::from(beat) + 1) * TPB,
                    sounding: beat != 1 && beat != 3,
                    matra_sounding: vec![],
                    jathi_pulse_start_ticks: vec![],
                })
                .collect(),
            note_groups: vec![],
        };
        let cycles = vec![cycle];

        let whole = compile_window(
            &cfg,
            &cycles,
            whole_window(1),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(
            whole
                .launches
                .iter()
                .map(|launch| (launch.reference_start_tick, launch.matched_beat))
                .collect::<Vec<_>>(),
            vec![(TPB, 1), (3 * TPB, 3)]
        );

        let first = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 0,
                end: 3 * TPB,
            },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let second = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 3 * TPB,
                end: CYCLE_TICKS,
            },
            &follower(),
            &ctx(),
            first.carry_out.clone(),
        );
        let mut combined = first.launches.clone();
        combined.extend(second.launches.clone());
        assert_eq!(combined, whole.launches);
        assert_eq!(second.carry_out, whole.carry_out);
    }

    // ----- GATE (Phase C) -----

    fn gated(cfg: TriggerConfig, gate: GateSpec) -> TriggerConfig {
        TriggerConfig {
            gate: Some(gate),
            ..cfg
        }
    }

    #[test]
    fn gate_absent_matches_pre_phase_c_behavior() {
        // The worked example with no gate: identical launches, and a decision
        // per fire, all Launched with no rolls.
        let cycles = vec![source_cycle(0, true), source_cycle(2, true)];
        let out = compile_window(
            &cfg(ReTrigger::Restart, Lifetime::OnePass),
            &cycles,
            whole_window(3),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(out.launches.len(), 2);
        assert_eq!(out.decisions.len(), 2);
        assert!(out.decisions.iter().all(|d| d.gate_rolls.is_empty()));
        assert!(out
            .decisions
            .iter()
            .all(|d| matches!(d.outcome, DecisionOutcome::Launched { .. })));
    }

    #[test]
    fn gate_probability_zero_suppresses_every_candidate_but_records_it() {
        let cfg = gated(
            cfg(ReTrigger::Restart, Lifetime::OnePass),
            GateSpec {
                probability_per_mille: 0,
                cooldown_cycles: 0,
                miss_boost_per_mille: 0,
                seed: 1,
            },
        );
        let cycles = vec![source_cycle(0, true), source_cycle(1, true)];
        let out = compile_window(
            &cfg,
            &cycles,
            whole_window(2),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert!(out.launches.is_empty(), "p=0 launches nothing");
        assert_eq!(out.decisions.len(), 2, "but every candidate is traced");
        assert!(out.decisions.iter().all(|d| matches!(
            d.outcome,
            DecisionOutcome::Suppressed {
                reason: SuppressReason::GateProbability
            }
        )));
        // Every fire was consumed so it can never silently relaunch later.
        assert_eq!(out.carry_out.consumed_fires.len(), 2);
        assert_eq!(out.carry_out.gate_state.consecutive_misses, 2);
    }

    #[test]
    fn gate_probability_full_launches_like_no_gate() {
        let base = cfg(ReTrigger::Restart, Lifetime::OnePass);
        let cycles = vec![source_cycle(0, true), source_cycle(2, true)];
        let ungated = compile_window(
            &base,
            &cycles,
            whole_window(3),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let full = compile_window(
            &gated(
                base,
                GateSpec {
                    probability_per_mille: GATE_PROBABILITY_MAX,
                    cooldown_cycles: 0,
                    miss_boost_per_mille: 0,
                    seed: 42,
                },
            ),
            &cycles,
            whole_window(3),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(full.launches, ungated.launches, "p=1000 ⇒ same launches");
    }

    #[test]
    fn gate_cooldown_spaces_accepts_by_source_cycle() {
        // Always-accept base + a 2-cycle cooldown. Rests every cycle 0..4 ⇒
        // accepts at cycles 0, 2, 4 (1 and 3 fall inside the cooldown).
        let cfg = gated(
            cfg(ReTrigger::Restart, Lifetime::OnePass),
            GateSpec {
                probability_per_mille: GATE_PROBABILITY_MAX,
                cooldown_cycles: 2,
                miss_boost_per_mille: 0,
                seed: 7,
            },
        );
        let cycles: Vec<ResolvedCycle> = (0..5).map(|i| source_cycle(i, true)).collect();
        let out = compile_window(
            &cfg,
            &cycles,
            whole_window(5),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let launched: Vec<u64> = out.launches.iter().map(|l| l.source_cycle_index).collect();
        assert_eq!(launched, vec![0, 2, 4]);
        // The in-cooldown candidates are traced as cooldown rejections (no roll).
        let cooldown_rejects: Vec<u64> = out
            .decisions
            .iter()
            .filter(|d| {
                matches!(
                    d.outcome,
                    DecisionOutcome::Suppressed {
                        reason: SuppressReason::GateCooldown
                    }
                ) && d.gate_rolls.is_empty()
            })
            .map(|d| d.source_cycle_index)
            .collect();
        assert_eq!(cooldown_rejects, vec![1, 3]);
    }

    #[test]
    fn gate_decision_trace_is_associative_across_a_split() {
        // A partial-probability gate over rests in cycles 0..4; the trace from a
        // split window must equal the whole-window trace exactly.
        let cfg = gated(
            cfg(ReTrigger::Restart, Lifetime::OnePass),
            GateSpec {
                probability_per_mille: 500,
                cooldown_cycles: 0,
                miss_boost_per_mille: 100,
                seed: 0xDECAF,
            },
        );
        let cycles: Vec<ResolvedCycle> = (0..4).map(|i| source_cycle(i, true)).collect();
        let whole = compile_window(
            &cfg,
            &cycles,
            whole_window(4),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let first = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 0,
                end: 2 * CYCLE_TICKS,
            },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let second = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 2 * CYCLE_TICKS,
                end: 4 * CYCLE_TICKS,
            },
            &follower(),
            &ctx(),
            first.carry_out.clone(),
        );
        let mut combined = first.decisions.clone();
        combined.extend(second.decisions.clone());
        assert_eq!(combined, whole.decisions);
        assert_eq!(second.carry_out.gate_state, whole.carry_out.gate_state);
    }

    #[test]
    fn gate_recompile_from_zero_reproduces_launches_carry_and_trace() {
        // Reapply recompiles from cycle 0 with fresh carry. The probability rolls
        // are identity-seeded, so a prior partial compile must not affect the fresh
        // accept/reject sequence.
        let cfg = gated(
            cfg(ReTrigger::Restart, Lifetime::OnePass),
            GateSpec {
                probability_per_mille: 430,
                cooldown_cycles: 2,
                miss_boost_per_mille: 175,
                seed: 0x0BAD_5EED,
            },
        );
        let cycles: Vec<ResolvedCycle> = (0..6).map(|i| source_cycle(i, true)).collect();

        let fresh = compile_window(
            &cfg,
            &cycles,
            whole_window(6),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );

        // Advance a throwaway scheduler carry through a split compile, as the live
        // transport would before a reapply.
        let prefix = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 0,
                end: 3 * CYCLE_TICKS,
            },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let _suffix = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 3 * CYCLE_TICKS,
                end: 6 * CYCLE_TICKS,
            },
            &follower(),
            &ctx(),
            prefix.carry_out,
        );

        let reapplied = compile_window(
            &cfg,
            &cycles,
            whole_window(6),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );

        assert_eq!(reapplied.launches, fresh.launches);
        assert_eq!(reapplied.carry_out, fresh.carry_out);
        assert_eq!(reapplied.decisions, fresh.decisions);
    }

    #[test]
    fn launched_decisions_match_immediate_launches() {
        let cfg = gated(
            cfg(ReTrigger::Restart, Lifetime::OnePass),
            GateSpec {
                probability_per_mille: GATE_PROBABILITY_MAX,
                cooldown_cycles: 0,
                miss_boost_per_mille: 0,
                seed: 123,
            },
        );
        let cycles = vec![source_cycle(0, true), source_cycle(2, true)];
        let out = compile_window(
            &cfg,
            &cycles,
            whole_window(3),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );

        let decision_launches: Vec<(u64, u32, u64, u32)> = out
            .decisions
            .iter()
            .filter_map(|decision| match decision.outcome {
                DecisionOutcome::Launched {
                    launch_tick,
                    run_index,
                    ..
                } => Some((
                    launch_tick,
                    run_index,
                    decision.source_cycle_index,
                    decision.matched_beat,
                )),
                DecisionOutcome::Queued | DecisionOutcome::Suppressed { .. } => None,
            })
            .collect();
        let real_launches: Vec<(u64, u32, u64, u32)> = out
            .launches
            .iter()
            .map(|launch| {
                (
                    launch.reference_start_tick,
                    launch.run_index,
                    launch.source_cycle_index,
                    launch.matched_beat,
                )
            })
            .collect();

        assert_eq!(decision_launches, real_launches);
    }

    #[test]
    fn gate_accepts_before_retrigger_ignore_and_queue_are_traced() {
        let gate = GateSpec {
            probability_per_mille: GATE_PROBABILITY_MAX,
            cooldown_cycles: 0,
            miss_boost_per_mille: 0,
            seed: 99,
        };
        let cycles = vec![source_cycle(0, true), source_cycle(1, true)];

        let ignored = compile_window(
            &gated(
                cfg(ReTrigger::Ignore, Lifetime::Repeats { passes: 4 }),
                gate,
            ),
            &cycles,
            whole_window(2),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(ignored.launches.len(), 1);
        assert!(matches!(
            ignored.decisions[1].outcome,
            DecisionOutcome::Suppressed {
                reason: SuppressReason::ReTriggerIgnore
            }
        ));
        assert_eq!(
            ignored.decisions[1]
                .gate_state_after
                .last_accept_source_cycle,
            Some(1),
            "accepted-by-gate candidates update gate state before re-trigger ignore"
        );
        assert!(ignored.decisions[1]
            .gate_rolls
            .iter()
            .all(|roll| roll.passed));

        let queued = compile_window(
            &gated(cfg(ReTrigger::Queue, Lifetime::Repeats { passes: 4 }), gate),
            &cycles,
            whole_window(4),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(
            queued
                .decisions
                .iter()
                .map(|decision| decision.outcome)
                .collect::<Vec<_>>(),
            vec![
                DecisionOutcome::Launched {
                    launch_id: queued.launches[0].launch_id,
                    launch_tick: queued.launches[0].reference_start_tick,
                    run_index: queued.launches[0].run_index,
                },
                DecisionOutcome::Queued,
            ]
        );
        assert_eq!(queued.launches.len(), 2);
        assert_eq!(
            queued.launches[1].reference_start_tick,
            queued.launches[0].nominal_end_tick(),
            "queued candidate releases as a launch at the active run end"
        );
    }

    #[test]
    fn queue_full_candidates_are_suppressed_not_reported_as_queued() {
        let mut config = cfg(ReTrigger::Queue, Lifetime::Repeats { passes: 4 });
        config.when = Some(WhenSpec {
            beats: BeatSelector::AnyBeat,
            tree: ConditionNode::leaf(WhenPredicate::IsRest),
        });
        config.condition = None;
        let cycle = ResolvedCycle {
            cycle_index: 0,
            start_tick: 0,
            end_tick: 4 * TPB,
            beats: (0..4)
                .map(|beat| ResolvedBeat {
                    beat,
                    gati: 4,
                    section_index: 0,
                    section_start: beat == 0,
                    jathi: None,
                    start_tick: u64::from(beat) * TPB,
                    end_tick: u64::from(beat + 1) * TPB,
                    sounding: false,
                    matra_sounding: vec![],
                    jathi_pulse_start_ticks: vec![],
                })
                .collect(),
            note_groups: vec![],
        };

        let out = compile_window(
            &config,
            &[cycle],
            whole_window(1),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert!(matches!(
            out.decisions[0].outcome,
            DecisionOutcome::Launched { .. }
        ));
        assert_eq!(out.decisions[1].outcome, DecisionOutcome::Queued);
        assert!(matches!(
            out.decisions[2].outcome,
            DecisionOutcome::Suppressed {
                reason: SuppressReason::ReTriggerQueueFull
            }
        ));
        assert!(matches!(
            out.decisions[3].outcome,
            DecisionOutcome::Suppressed {
                reason: SuppressReason::ReTriggerQueueFull
            }
        ));
    }

    // ----- START (Phase D) -----

    #[test]
    fn center_in_rest_places_launch_at_the_beat_midpoint() {
        let mut cfg = cfg(ReTrigger::Restart, Lifetime::OnePass);
        cfg.launch_alignment = LaunchAlignment::CenterInRest;
        // Rest at beat 3 of cycle 0: span [3*TPB, 4*TPB) ⇒ midpoint 3*TPB + TPB/2.
        let cycles = vec![source_cycle(0, true)];
        let out = compile_window(
            &cfg,
            &cycles,
            whole_window(1),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(out.launches.len(), 1);
        assert_eq!(out.launches[0].reference_start_tick, 3 * TPB + TPB / 2);
        assert_eq!(
            out.decisions[0].start_alignment,
            LaunchAlignment::CenterInRest
        );
        // The trace carries both ends of the connector: the matched event onset
        // (beat 3) and the placed launch tick (the beat midpoint).
        assert_eq!(out.decisions[0].event_reference_tick, 3 * TPB);
        assert_eq!(out.decisions[0].candidate_tick, 3 * TPB + TPB / 2);
    }

    #[test]
    fn weighted_start_picks_a_single_option_deterministically() {
        // Only CenterInRest has weight ⇒ every accepted candidate uses it, and the
        // trace records the chosen alignment. Two equal compiles must agree.
        let mut cfg = cfg(ReTrigger::Restart, Lifetime::OnePass);
        cfg.start_select = Some(StartSelect {
            options: vec![
                WeightedStart {
                    alignment: LaunchAlignment::AtEvent,
                    weight: 0,
                },
                WeightedStart {
                    alignment: LaunchAlignment::CenterInRest,
                    weight: 1,
                },
            ],
            seed: 123,
        });
        let cycles = vec![source_cycle(0, true), source_cycle(1, true)];
        let run = || {
            compile_window(
                &cfg,
                &cycles,
                whole_window(2),
                &follower(),
                &ctx(),
                TriggerCarry::default(),
            )
        };
        let a = run();
        let b = run();
        assert_eq!(a, b, "weighted START is deterministic");
        assert!(a
            .decisions
            .iter()
            .all(|d| d.start_alignment == LaunchAlignment::CenterInRest));
        // Each launch lands at its cycle's beat-3 midpoint.
        assert_eq!(a.launches[0].reference_start_tick, 3 * TPB + TPB / 2);
        assert_eq!(
            a.launches[1].reference_start_tick,
            CYCLE_TICKS + 3 * TPB + TPB / 2
        );
    }

    #[test]
    fn empty_start_select_falls_back_to_launch_alignment() {
        // An empty option list must not override the single `launch_alignment`.
        let mut cfg = cfg(ReTrigger::Restart, Lifetime::OnePass);
        cfg.launch_alignment = LaunchAlignment::AtSourceCycleStart;
        cfg.start_select = Some(StartSelect {
            options: vec![],
            seed: 1,
        });
        let cycles = vec![source_cycle(0, true)];
        let out = compile_window(
            &cfg,
            &cycles,
            whole_window(1),
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        // AtSourceCycleStart ⇒ beat 0 at the cycle start (tick 0).
        assert_eq!(out.launches[0].reference_start_tick, 0);
        assert_eq!(
            out.decisions[0].start_alignment,
            LaunchAlignment::AtSourceCycleStart
        );
    }

    #[test]
    fn weighted_start_non_monotonic_launches_are_split_stable_and_reapply_stable() {
        // Seed 0 chooses AfterEventTicks for (cycle 0, beat 0), but
        // AtSourceCycleStart for (cycle 1, beat 0). The later source candidate
        // therefore launches earlier, and the compiler must keep scanning after
        // seeing cycle 0's future launch.
        let mut cfg = cfg(ReTrigger::Restart, Lifetime::OnePass);
        cfg.condition = Some(TriggerCondition::BeatIsRest { beat: 0 });
        cfg.start_select = Some(StartSelect {
            options: vec![
                WeightedStart {
                    alignment: LaunchAlignment::AfterEventTicks { ticks: 2 * TPB },
                    weight: 1,
                },
                WeightedStart {
                    alignment: LaunchAlignment::AtSourceCycleStart,
                    weight: 1,
                },
            ],
            seed: 0,
        });
        let cycles = vec![
            one_beat_source_cycle(0, 0, 4),
            one_beat_source_cycle(1, 100, 4),
        ];
        let whole = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 0,
                end: 3 * TPB,
            },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(
            whole
                .launches
                .iter()
                .map(|launch| (launch.reference_start_tick, launch.source_cycle_index))
                .collect::<Vec<_>>(),
            vec![(100, 1), (2 * TPB, 0)]
        );
        assert_eq!(
            whole
                .decisions
                .iter()
                .map(|decision| (decision.candidate_tick, decision.start_alignment))
                .collect::<Vec<_>>(),
            vec![
                (100, LaunchAlignment::AtSourceCycleStart),
                (2 * TPB, LaunchAlignment::AfterEventTicks { ticks: 2 * TPB }),
            ]
        );

        let first = compile_window(
            &cfg,
            &cycles,
            TickWindow { start: 0, end: TPB },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        let second = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: TPB,
                end: 3 * TPB,
            },
            &follower(),
            &ctx(),
            first.carry_out.clone(),
        );
        let mut combined_launches = first.launches.clone();
        combined_launches.extend(second.launches.clone());
        assert_eq!(combined_launches, whole.launches);
        assert_eq!(second.carry_out, whole.carry_out);
        let mut combined_decisions = first.decisions.clone();
        combined_decisions.extend(second.decisions.clone());
        assert_eq!(combined_decisions, whole.decisions);

        // Reapply starts from cycle 0 with fresh carry and must reproduce the same
        // chosen placements, trace, and launch order.
        let reapplied = compile_window(
            &cfg,
            &cycles,
            TickWindow {
                start: 0,
                end: 3 * TPB,
            },
            &follower(),
            &ctx(),
            TriggerCarry::default(),
        );
        assert_eq!(reapplied.launches, whole.launches);
        assert_eq!(reapplied.carry_out, whole.carry_out);
        assert_eq!(reapplied.decisions, whole.decisions);
    }
}
