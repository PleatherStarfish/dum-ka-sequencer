//! Integration coverage for the Triggered Tracks transport seam: a real
//! source score is realized, its resolved rests drive a follower's compiled
//! launches, and the follower's events flow through the same merge/conflict
//! path as any track. These complement the pure unit/property tests in
//! `cseq-trigger`; here we prove the *wiring*.
use crate::*;
use cseq_trigger::{
    BeatSelector, ConditionNode, CountOp, GateSpec, LaunchAlignment, LaunchQuantize, Lifetime,
    QuantizeDirection, QuantizeGrid, ReTrigger, StartSelect, TriggerCondition, TriggerConfig,
    TriggerLength, WeightedStart, WhenPredicate, WhenSpec,
};
use std::collections::VecDeque;

const TPB: u64 = PPQN as u64; // ticks per (reference) beat
const REF_BEATS: u32 = 4;
const REF_TPC: u64 = TPB * REF_BEATS as u64; // 3840

/// A `beats`-beat continuous source where `rest_beats` resolve to rests.
/// (`beat_euclidean` always emits a note per beat, so we silence chosen
/// beats by switching their pulse to `Rest`.)
fn lead_score(beats: usize, rest_beats: &[usize]) -> cseq_model::Score {
    let pitches = (0..beats).map(|i| 60 + i as u8).collect::<Vec<_>>();
    let mut score =
        cseq_model::Score::subdivided("lead", &pitches, 96, cseq_model::SubdivisionPolicy::Equal);
    score.cycle_length = Rational::from_integer(beats as i64);
    for &b in rest_beats {
        let node_id = (b + 1) as u64; // beat i -> node id i+1
        if let Some(node) = score.duration_tree.nodes.get_mut(&node_id) {
            if let cseq_model::DurationKind::Pulse(pulse) = &mut node.kind {
                pulse.event = cseq_model::PulseEvent::Rest;
            }
        }
    }
    score
}

/// A `beats`-beat follower, one note per beat (pitches in a distinct range).
fn follower_score(beats: usize) -> cseq_model::Score {
    let pitches = (0..beats).map(|i| 72 + i as u8).collect::<Vec<_>>();
    let mut score =
        cseq_model::Score::subdivided("follow", &pitches, 96, cseq_model::SubdivisionPolicy::Equal);
    score.cycle_length = Rational::from_integer(beats as i64);
    score
}

fn trig(
    cond: TriggerCondition,
    lifetime: Lifetime,
    re: ReTrigger,
    length: TriggerLength,
) -> TriggerConfig {
    TriggerConfig {
        source_track_id: "lead".to_string(),
        when: None,
        condition: Some(cond),
        launch_alignment: LaunchAlignment::AtEvent,
        launch_quantize: None,
        lifetime,
        re_trigger: re,
        length,
        max_repeats: 64,
        gate: None,
        start_select: None,
    }
}

/// Like [`trig`] but carries a multi-condition Phase-B [`WhenSpec`] tree
/// (`when`) instead of a single legacy `condition`.
fn trig_when(
    when: WhenSpec,
    lifetime: Lifetime,
    re: ReTrigger,
    length: TriggerLength,
) -> TriggerConfig {
    TriggerConfig {
        source_track_id: "lead".to_string(),
        when: Some(when),
        condition: None,
        launch_alignment: LaunchAlignment::AtEvent,
        launch_quantize: None,
        lifetime,
        re_trigger: re,
        length,
        max_repeats: 64,
        gate: None,
        start_select: None,
    }
}

fn tempo_hold_rhythm_two_cycles(first_bpm: f64, second_bpm: f64) -> RhythmPlaybackConfig {
    RhythmPlaybackConfig {
        generator_enabled: false,
        generator: cseq_rhythm::GeneratorConfig::default(),
        midi_output_channel: 1,
        automation: Some(cseq_model::AutomationSet {
            length_cycles: 2,
            markers: Vec::new(),
            tracks: vec![cseq_model::AutomationTrack {
                id: "triggered-tempo-track".to_string(),
                target: AUTOMATION_TARGET_TEMPO_BPM.to_string(),
                enabled: true,
                combine: cseq_model::AutomationCombineMode::Replace,
                graph_range: None,
                curves: vec![cseq_model::AutomationCurve {
                    id: "triggered-tempo-curve".to_string(),
                    enabled: true,
                    interpolation: cseq_model::AutomationInterpolation::Hold,
                    points: vec![
                        cseq_model::AutomationPoint {
                            id: Some("triggered-tempo-first".to_string()),
                            time: AutomationTime::zero(),
                            value: cseq_model::AutomationValue::Number { value: first_bpm },
                            anchor_id: None,
                            out_curve: None,
                        },
                        cseq_model::AutomationPoint {
                            id: Some("triggered-tempo-second".to_string()),
                            time: AutomationTime::new(1, 2).expect("valid midpoint"),
                            value: cseq_model::AutomationValue::Number { value: second_bpm },
                            anchor_id: None,
                            out_curve: None,
                        },
                    ],
                }],
            }],
        }),
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

fn runtime(
    lead: cseq_model::Score,
    follow: cseq_model::Score,
    trigger: Option<TriggerConfig>,
    policy: ChannelConflictPolicy,
) -> ParallelRuntimeConfig {
    ParallelRuntimeConfig::from_config(ParallelPlaybackConfig {
        tracks: vec![
            ParallelPlaybackTrackConfig {
                id: "lead".to_string(),
                name: "Lead".to_string(),
                score: lead,
                rhythm: None,
                tempo_bpm: 80.0,
                trigger: None,
                silent: false,
            },
            ParallelPlaybackTrackConfig {
                id: "follow".to_string(),
                name: "Follow".to_string(),
                score: follow,
                rhythm: None,
                tempo_bpm: 80.0,
                trigger,
                silent: false,
            },
        ],
        reference_tempo_bpm: 80.0,
        reference_cycle_beats: REF_BEATS,
        channel_conflict_policy: policy,
        channel_logic_matrix: Vec::new(),
        conflict_priority: vec!["lead".to_string(), "follow".to_string()],
        track_flow_boxes: vec![],
    })
}

fn track_note_on_ticks(queue: &VecDeque<QueuedEvent>, track_id: &str) -> Vec<u64> {
    let mut ticks: Vec<u64> = queue
        .iter()
        .filter(|e| {
            e.parallel_track_id.as_deref() == Some(track_id)
                && (e.bytes[0] & 0xF0) == 0x90
                && e.bytes[2] != 0
        })
        .map(|e| e.absolute_tick)
        .collect();
    ticks.sort_unstable();
    ticks
}

/// Full note groups `(start, end, pitch, user_channel)` for a track, paired
/// from the finalized queue — the follower's *leaf*, not just its onsets. Each
/// note-on pairs with the earliest matching note-off (same FIFO geometry as
/// `finalized_cycle_ledger`), so wrong durations, end boundaries, channels, or
/// pairing are caught, not only onset ticks.
fn track_note_groups(queue: &VecDeque<QueuedEvent>, track_id: &str) -> Vec<(u64, u64, u8, u8)> {
    let events: Vec<&QueuedEvent> = queue
        .iter()
        .filter(|e| e.parallel_track_id.as_deref() == Some(track_id))
        .collect();
    let mut used_off = vec![false; events.len()];
    let mut groups = Vec::new();
    for (on_index, on) in events.iter().enumerate() {
        if (on.bytes[0] & 0xF0) != 0x90 || on.bytes[2] == 0 {
            continue;
        }
        let wire_channel = on.bytes[0] & 0x0F;
        let pitch = on.bytes[1];
        let off = events.iter().enumerate().skip(on_index + 1).find(|(j, e)| {
            let status = e.bytes[0] & 0xF0;
            let is_off = status == 0x80 || (status == 0x90 && e.bytes[2] == 0);
            !used_off[*j] && is_off && (e.bytes[0] & 0x0F) == wire_channel && e.bytes[1] == pitch
        });
        if let Some((off_index, off)) = off {
            used_off[off_index] = true;
            let user_channel = on.user_channel.unwrap_or(wire_channel + 1);
            groups.push((on.absolute_tick, off.absolute_tick, pitch, user_channel));
        }
    }
    groups.sort_unstable();
    groups
}

#[test]
fn follower_launches_at_resolved_rest_tick_one_pass() {
    // Worked example: lead rests beat 3; follower 2-beat onePass restart.
    let mut rt = runtime(
        lead_score(4, &[3]),
        follower_score(2),
        Some(trig(
            TriggerCondition::BeatIsRest { beat: 3 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
        )),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, 2 * REF_TPC, &mut queue).unwrap();
    // Beat 3 of cycle 0 = tick 2880; of cycle 1 = 6720. Each launch is a
    // 2-beat phrase => notes at launch and launch+960.
    assert_eq!(
        track_note_on_ticks(&queue, "follow"),
        vec![2880, 3840, 6720, 7680]
    );
}

#[test]
fn follower_position_row_disappears_between_runs() {
    // Regression: `track_positions` used to fall back to the LAST timing
    // window when nothing covered the current tick, so a finished run kept
    // reporting the follower as playing forever (the UI's armed/running
    // chip never re-armed). A triggered follower must only have a position
    // row while a launched run's window covers the tick; the continuous
    // lead keeps its tail fallback.
    let mut rt = runtime(
        lead_score(4, &[3]),
        follower_score(2),
        Some(trig(
            TriggerCondition::BeatIsRest { beat: 3 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
        )),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, 2 * REF_TPC, &mut queue).unwrap();
    let has_row = |tick: u64, id: &str| {
        rt.track_positions(tick)
            .iter()
            .any(|position| position.track_id == id)
    };
    // Inside run 1 ([2880, 4800)): the follower is running.
    assert!(
        has_row(3000, "follow"),
        "follower should be positioned mid-run"
    );
    // Between runs ([4800, 6720)): armed again — NO position row.
    assert!(
        !has_row(5000, "follow"),
        "finished run must not report a stale position"
    );
    // Inside run 2 it is running again; the continuous lead is always rowed.
    assert!(has_row(6900, "follow"));
    assert!(has_row(3000, "lead"));
    assert!(has_row(5000, "lead"));
}

#[test]
fn parity_triggered_follower_leaf_is_the_compiled_launches() {
    // The follower's MIDI leaf must be exactly the compiled launches — two
    // launches at the resolved beat-3 rest ticks, each a 2-beat phrase (note-ons
    // at L and L+TPB) — and nothing the UI invented outside them. This is the
    // "single source of truth" invariant observed at the leaf.
    let mut rt = runtime(
        lead_score(4, &[3]),
        follower_score(2),
        Some(trig(
            TriggerCondition::BeatIsRest { beat: 3 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
        )),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, 2 * REF_TPC, &mut queue).unwrap();

    // Compare full note groups (start, end, pitch), not just onsets, so wrong
    // durations, end boundaries, or pairing are caught. Each beat-3 rest (ticks
    // 2880, 6720) launches a 2-beat phrase: pitch 72 over [L, L+TPB) then pitch
    // 73 over [L+TPB, L+2*TPB).
    let groups = track_note_groups(&queue, "follow");
    let launches = [2880_u64, 6720];
    let expected = launches
        .iter()
        .flat_map(|&launch| {
            [
                (launch, launch + TPB, 72_u8),
                (launch + TPB, launch + 2 * TPB, 73_u8),
            ]
        })
        .collect::<Vec<_>>();
    let actual = groups
        .iter()
        .map(|&(start, end, pitch, _channel)| (start, end, pitch))
        .collect::<Vec<_>>();
    assert_eq!(
        actual, expected,
        "the follower leaf must equal the compiled launches, group-for-group"
    );
    // The follower sounds on a single, consistent channel.
    assert!(
        !groups.is_empty()
            && groups
                .iter()
                .all(|&(_, _, _, channel)| channel == groups[0].3),
        "the follower leaf must use one consistent channel"
    );
}

#[test]
fn parity_triggered_follower_only_occupies_not_yet_finalized_ticks() {
    // Realize cycle 0, then the future. A follower never retro-launches into
    // already-finalized ticks, so cycle 0's follower leaf must be byte-stable
    // after the later realization (the cycle-local rule, extended to triggers).
    let make_runtime = || {
        runtime(
            lead_score(4, &[3]),
            follower_score(2),
            Some(trig(
                TriggerCondition::BeatIsRest { beat: 3 },
                Lifetime::OnePass,
                ReTrigger::Restart,
                TriggerLength::ScoreCycle,
            )),
            ChannelConflictPolicy::AllowAll,
        )
    };
    let mut rt = make_runtime();
    let mut queue = VecDeque::new();

    // Snapshot whatever follower groups the first realization actually enqueues
    // (the full groups, not a tick-windowed subset of onsets — the first launch
    // phrase already extends past REF_TPC, so a windowed filter would silently
    // drop a finalized note).
    realize_parallel_until(&mut rt, REF_TPC, &mut queue).unwrap();
    let after_first = track_note_groups(&queue, "follow");
    assert!(
        !after_first.is_empty(),
        "the follower should have launched by the first realization"
    );

    // Realize the future. Every group already enqueued must survive unchanged —
    // a follower never rewrites or drops a finalized note group.
    realize_parallel_until(&mut rt, 2 * REF_TPC, &mut queue).unwrap();
    let after_second = track_note_groups(&queue, "follow");
    for group in &after_first {
        assert!(
            after_second.contains(group),
            "a finalized follower group was rewritten or dropped: {group:?}"
        );
    }
    // ...and the future realization genuinely added the next launch (non-vacuous).
    assert!(
        after_second.len() > after_first.len(),
        "the second realization should add the future launch"
    );
}

#[test]
fn launch_quantize_snaps_follower_start_to_grid() {
    // Beat-3 rest events land at reference tick 2880. With a 2-reference-beat
    // quantize grid (Next), the launch snaps forward to 3840. End-to-end this
    // proves the compiler reads `launch_quantize` and the follower lands on
    // the snapped tick — same path, so timeline and MIDI agree.
    let plain = {
        let mut rt = runtime(
            lead_score(4, &[3]),
            follower_score(2),
            Some(trig(
                TriggerCondition::BeatIsRest { beat: 3 },
                Lifetime::OnePass,
                ReTrigger::Restart,
                TriggerLength::ScoreCycle,
            )),
            ChannelConflictPolicy::AllowAll,
        );
        let mut q = VecDeque::new();
        realize_parallel_until(&mut rt, 2 * REF_TPC, &mut q).unwrap();
        track_note_on_ticks(&q, "follow")
    };
    assert_eq!(
        plain.first(),
        Some(&2880),
        "unquantized launches at the rest"
    );

    let mut cfg = trig(
        TriggerCondition::BeatIsRest { beat: 3 },
        Lifetime::OnePass,
        ReTrigger::Restart,
        TriggerLength::ScoreCycle,
    );
    cfg.launch_quantize = Some(LaunchQuantize {
        grid: QuantizeGrid::ReferenceBeatMultiple { beats: 2 },
        direction: QuantizeDirection::Next,
    });
    let mut rt = runtime(
        lead_score(4, &[3]),
        follower_score(2),
        Some(cfg),
        ChannelConflictPolicy::AllowAll,
    );
    let mut q = VecDeque::new();
    realize_parallel_until(&mut rt, 2 * REF_TPC, &mut q).unwrap();
    let ticks = track_note_on_ticks(&q, "follow");
    assert_eq!(
        ticks.first(),
        Some(&3840),
        "2-beat grid snaps the beat-3 rest (2880) up to 3840; got {ticks:?}"
    );
}

#[test]
fn follower_is_silent_before_its_first_launch() {
    let mut rt = runtime(
        lead_score(4, &[3]),
        follower_score(2),
        Some(trig(
            TriggerCondition::BeatIsRest { beat: 3 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
        )),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, 2 * REF_TPC, &mut queue).unwrap();
    let ticks = track_note_on_ticks(&queue, "follow");
    assert!(!ticks.is_empty());
    assert!(
        ticks.iter().all(|&t| t >= 2880),
        "armed track must not sound before the first launch tick"
    );
}

#[test]
fn follower_does_not_perturb_source_events() {
    // The lead's own realized events must be identical whether the follower
    // is continuous or triggered (continuous-golden / non-perturbation).
    let lead = lead_score(4, &[3]);
    let mut continuous = runtime(
        lead.clone(),
        follower_score(2),
        None,
        ChannelConflictPolicy::AllowAll,
    );
    let mut triggered = runtime(
        lead,
        follower_score(2),
        Some(trig(
            TriggerCondition::BeatIsRest { beat: 3 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
        )),
        ChannelConflictPolicy::AllowAll,
    );
    let mut q1 = VecDeque::new();
    let mut q2 = VecDeque::new();
    realize_parallel_until(&mut continuous, 2 * REF_TPC, &mut q1).unwrap();
    realize_parallel_until(&mut triggered, 2 * REF_TPC, &mut q2).unwrap();
    assert_eq!(
        track_note_on_ticks(&q1, "lead"),
        track_note_on_ticks(&q2, "lead"),
    );
}

#[test]
fn follower_length_not_dividing_reference_cycle() {
    // 3-beat follower phrase against a 4-beat reference, launched at beat 3.
    let mut rt = runtime(
        lead_score(4, &[3]),
        follower_score(3),
        Some(trig(
            TriggerCondition::BeatIsRest { beat: 3 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
        )),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, 2 * REF_TPC, &mut queue).unwrap();
    // Launch at 2880: 3 notes at 2880,3840,4800. Launch at 6720: 6720,7680,8640.
    assert_eq!(
        track_note_on_ticks(&queue, "follow"),
        vec![2880, 3840, 4800, 6720, 7680, 8640]
    );
}

#[test]
fn fixed_beats_length_realizes_n_beat_phrase() {
    // FixedBeats{3} + repeats{2}: a single launch realizes two 3-beat
    // phrases, so the second phrase starts 3 beats (2880) after the first.
    // One source cycle window so only the beat-0 rest fires once.
    let mut rt = runtime(
        lead_score(4, &[0]),
        follower_score(1),
        Some(trig(
            TriggerCondition::BeatIsRest { beat: 0 },
            Lifetime::Repeats { passes: 2 },
            ReTrigger::Restart,
            TriggerLength::FixedBeats { beats: 3 },
        )),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, REF_TPC, &mut queue).unwrap();
    // Launch at 0; phrase 1 at 0, phrase 2 at 0 + 3*960 = 2880.
    assert_eq!(track_note_on_ticks(&queue, "follow"), vec![0, 2880]);
}

#[test]
fn ignore_suppresses_midrun_relaunch_restart_does_not() {
    // Lead rests beat 0 every cycle (a trigger every cycle). With a long
    // run, ignore drops the mid-run re-trigger while restart honors it.
    let make = |re: ReTrigger| {
        runtime(
            lead_score(4, &[0]),
            follower_score(2),
            Some(trig(
                TriggerCondition::BeatIsRest { beat: 0 },
                Lifetime::Repeats { passes: 3 },
                re,
                TriggerLength::ScoreCycle,
            )),
            ChannelConflictPolicy::AllowAll,
        )
    };
    let mut ignore_rt = make(ReTrigger::Ignore);
    let mut restart_rt = make(ReTrigger::Restart);
    let mut iq = VecDeque::new();
    let mut rq = VecDeque::new();
    realize_parallel_until(&mut ignore_rt, 2 * REF_TPC, &mut iq).unwrap();
    realize_parallel_until(&mut restart_rt, 2 * REF_TPC, &mut rq).unwrap();
    let ignore_ticks = track_note_on_ticks(&iq, "follow");
    let restart_ticks = track_note_on_ticks(&rq, "follow");
    // Ignore: one run of 3 phrases from tick 0 only.
    assert_eq!(ignore_ticks.first(), Some(&0));
    // Restart re-launches mid-run, producing strictly more launched cycles.
    assert!(
        restart_ticks.len() > ignore_ticks.len(),
        "restart={restart_ticks:?} ignore={ignore_ticks:?}"
    );
}

#[test]
fn queue_releases_a_launch_after_the_run_ends() {
    // repeats{3} run from tick 0 ends at 5760; the cycle-1 trigger at 3840
    // lands mid-run and is QUEUED, releasing a new launch at 5760. With
    // ignore the same trigger is dropped, so no launch at 5760.
    let make = |re: ReTrigger| {
        runtime(
            lead_score(4, &[0]),
            follower_score(2),
            Some(trig(
                TriggerCondition::BeatIsRest { beat: 0 },
                Lifetime::Repeats { passes: 3 },
                re,
                TriggerLength::ScoreCycle,
            )),
            ChannelConflictPolicy::AllowAll,
        )
    };
    let mut queue_rt = make(ReTrigger::Queue);
    let mut ignore_rt = make(ReTrigger::Ignore);
    let mut qq = VecDeque::new();
    let mut iq = VecDeque::new();
    realize_parallel_until(&mut queue_rt, 2 * REF_TPC, &mut qq).unwrap();
    realize_parallel_until(&mut ignore_rt, 2 * REF_TPC, &mut iq).unwrap();
    let queue_ticks = track_note_on_ticks(&qq, "follow");
    let ignore_ticks = track_note_on_ticks(&iq, "follow");
    assert!(
        queue_ticks.contains(&5760),
        "queued launch should release at run end (5760): {queue_ticks:?}"
    );
    assert!(
        !ignore_ticks.contains(&5760),
        "ignore must not produce the queued launch: {ignore_ticks:?}"
    );
}

#[test]
fn queued_launch_releases_after_actual_variable_tempo_run_end() {
    // The first launched run has two follower cycles with different mapped
    // reference durations. Queue must release when those realized cycles
    // actually end, not at `passes * duration(cycle 0)`.
    let follower_score = follower_score(1);
    let follower_rhythm = tempo_hold_rhythm_two_cycles(40.0, 80.0);
    let d0 = LocalTempoAutomationMap::from_cycle(
        &follower_score,
        Some(&follower_rhythm),
        0,
        TPB,
        80.0,
        80.0,
    )
    .reference_duration_ticks();
    let d1 = LocalTempoAutomationMap::from_cycle(
        &follower_score,
        Some(&follower_rhythm),
        1,
        TPB,
        80.0,
        80.0,
    )
    .reference_duration_ticks();
    assert_ne!(d0, d1, "fixture must produce variable phrase durations");
    let expected_release = d0.saturating_add(d1);

    let mut follower = cfg_track(
        "follow",
        "Follow",
        follower_score,
        Some(trig(
            TriggerCondition::BeatIsRest { beat: 0 },
            Lifetime::Repeats { passes: 2 },
            ReTrigger::Queue,
            TriggerLength::ScoreCycle,
        )),
        false,
    );
    follower.rhythm = Some(follower_rhythm);
    let mut rt = runtime_from(
        vec![
            cfg_track("lead", "Lead", lead_score(1, &[0]), None, false),
            follower,
        ],
        1,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, 6 * TPB, &mut queue).unwrap();
    let ticks = track_note_on_ticks(&queue, "follow");
    assert!(
        ticks.len() >= 3,
        "expected the initial two cycles plus queued release, got {ticks:?}"
    );
    assert_eq!(
        &ticks[..3],
        &[0, d0, expected_release],
        "queued release must follow actual realized durations, not stale nominal duration"
    );
}

#[test]
fn reapply_recompiles_identical_future_launches() {
    // Determinism across reapply (C4): realizing fresh, vs realizing then
    // reset_realization (the reapply path) then realizing again, yields
    // identical follower launches. This is what makes the scheduler's
    // discard-stale-before-cutoff safe (no dropped/duplicated runs).
    let build = || {
        runtime(
            lead_score(4, &[3]),
            follower_score(2),
            Some(trig(
                TriggerCondition::BeatIsRest { beat: 3 },
                Lifetime::OnePass,
                ReTrigger::Restart,
                TriggerLength::ScoreCycle,
            )),
            ChannelConflictPolicy::AllowAll,
        )
    };
    let mut fresh = build();
    let mut fq = VecDeque::new();
    realize_parallel_until(&mut fresh, 3 * REF_TPC, &mut fq).unwrap();
    let fresh_ticks = track_note_on_ticks(&fq, "follow");

    let mut reapplied = build();
    let mut tmp = VecDeque::new();
    realize_parallel_until(&mut reapplied, REF_TPC, &mut tmp).unwrap();
    // Reapply: discard the queue + reset realization, then re-realize.
    reapplied.reset_realization();
    let mut rq = VecDeque::new();
    realize_parallel_until(&mut reapplied, 3 * REF_TPC, &mut rq).unwrap();
    assert_eq!(track_note_on_ticks(&rq, "follow"), fresh_ticks);
}

fn queue_snapshot(queue: &VecDeque<QueuedEvent>) -> Vec<(u64, [u8; 3])> {
    queue.iter().map(|e| (e.absolute_tick, e.bytes)).collect()
}

fn plain_parallel_config(
    tracks: Vec<ParallelPlaybackTrackConfig>,
    reference_cycle_beats: u32,
) -> ParallelPlaybackConfig {
    let conflict_priority = tracks.iter().map(|t| t.id.clone()).collect();
    ParallelPlaybackConfig {
        tracks,
        reference_tempo_bpm: 80.0,
        reference_cycle_beats,
        channel_conflict_policy: ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: Vec::new(),
        conflict_priority,
        track_flow_boxes: vec![],
    }
}

/// Count a track's note-ons whose tick falls in reference cycle `cycle`.
fn note_ons_in_cycle(queue: &VecDeque<QueuedEvent>, track_id: &str, cycle: u64) -> usize {
    let lo = cycle * REF_TPC;
    let hi = lo + REF_TPC;
    track_note_on_ticks(queue, track_id)
        .into_iter()
        .filter(|&t| t >= lo && t < hi)
        .count()
}

#[test]
fn parallel_apply_in_place_swaps_params_forward_without_reset() {
    // P1: a NextCycle parallel apply mutates the running runtime in place —
    // the already-realized cycles and the realization cursors are untouched,
    // and the new params take effect only for cycles realized after the swap.
    let mut project = runtime_from(
        vec![cfg_track("a", "A", lead_score(4, &[]), None, false)],
        REF_BEATS,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut project, 2 * REF_TPC, &mut queue).unwrap();
    let cursor_before = project.tracks[0].realized_up_to_reference_tick;
    let queue_before = queue_snapshot(&queue);
    // Cycles 0 and 1 played all four beats.
    assert_eq!(note_ons_in_cycle(&queue, "a", 0), 4);
    assert_eq!(note_ons_in_cycle(&queue, "a", 1), 4);

    // Swap in a score that rests beats 1 and 2 (2 note-ons/cycle).
    let incoming = plain_parallel_config(
        vec![cfg_track("a", "A", lead_score(4, &[1, 2]), None, false)],
        REF_BEATS,
    );
    assert!(
        project.apply_in_place(&incoming),
        "matching topology applies in place"
    );

    // No reset, no replay: cursor and already-queued events are unchanged.
    assert_eq!(
        project.tracks[0].realized_up_to_reference_tick, cursor_before,
        "realization cursor preserved (no reset-to-zero)"
    );
    assert_eq!(
        queue_snapshot(&queue),
        queue_before,
        "already-realized cycles untouched"
    );

    // Realizing forward applies the new params from the current position on.
    realize_parallel_until(&mut project, 4 * REF_TPC, &mut queue).unwrap();
    assert_eq!(
        note_ons_in_cycle(&queue, "a", 0),
        4,
        "past cycle 0 still full"
    );
    assert_eq!(
        note_ons_in_cycle(&queue, "a", 1),
        4,
        "past cycle 1 still full"
    );
    assert_eq!(
        note_ons_in_cycle(&queue, "a", 2),
        2,
        "cycle 2 reflects the new rests"
    );
    assert_eq!(
        note_ons_in_cycle(&queue, "a", 3),
        2,
        "cycle 3 reflects the new rests"
    );
}

#[test]
fn parallel_apply_in_place_rejects_topology_change() {
    let mut project = runtime_from(
        vec![cfg_track("a", "A", lead_score(4, &[]), None, false)],
        REF_BEATS,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut project, REF_TPC, &mut queue).unwrap();

    // A different track-id set is a topology change (Tier D) — must be rejected
    // so the caller keeps the running runtime instead of tearing it down.
    let renamed = plain_parallel_config(
        vec![cfg_track("b", "B", lead_score(4, &[]), None, false)],
        REF_BEATS,
    );
    assert!(
        !project.apply_in_place(&renamed),
        "track-id change rejected"
    );

    // A trigger-role change (continuous -> triggered) on the same id set is
    // also a topology change. Uses lead/follow so the trigger source resolves
    // (the `trig` helper points at "lead") and the follower is not demoted.
    let mut two = runtime_from(
        vec![
            cfg_track("lead", "Lead", lead_score(4, &[3]), None, false),
            cfg_track("follow", "Follow", follower_score(2), None, false),
        ],
        REF_BEATS,
    );
    realize_parallel_until(&mut two, REF_TPC, &mut VecDeque::new()).unwrap();
    let now_triggered = plain_parallel_config(
        vec![
            cfg_track("lead", "Lead", lead_score(4, &[3]), None, false),
            cfg_track(
                "follow",
                "Follow",
                follower_score(2),
                Some(trig(
                    TriggerCondition::BeatIsRest { beat: 3 },
                    Lifetime::OnePass,
                    ReTrigger::Restart,
                    TriggerLength::ScoreCycle,
                )),
                false,
            ),
        ],
        REF_BEATS,
    );
    assert!(
        !two.apply_in_place(&now_triggered),
        "trigger-role change rejected"
    );
}

#[test]
fn parallel_apply_in_place_rejects_reference_grid_change() {
    let mut project = runtime_from(
        vec![cfg_track("a", "A", lead_score(4, &[]), None, false)],
        REF_BEATS,
    );
    realize_parallel_until(&mut project, REF_TPC, &mut VecDeque::new()).unwrap();
    // Changing the reference cycle length moves the master tick grid; it can't
    // be applied forward in place (would need a phase remap + requeue).
    let regridded = plain_parallel_config(
        vec![cfg_track("a", "A", lead_score(4, &[]), None, false)],
        REF_BEATS + 1,
    );
    assert!(
        !project.apply_in_place(&regridded),
        "reference-grid change rejected"
    );
}

#[test]
fn parallel_apply_in_place_updates_reference_tempo() {
    let mut project = runtime_from(
        vec![cfg_track("a", "A", lead_score(4, &[]), None, false)],
        REF_BEATS,
    );
    assert_eq!(project.reference_tempo_bpm, 80.0);
    let mut faster = plain_parallel_config(
        vec![cfg_track("a", "A", lead_score(4, &[]), None, false)],
        REF_BEATS,
    );
    faster.reference_tempo_bpm = 140.0;
    assert!(project.apply_in_place(&faster));
    assert_eq!(
        project.reference_tempo_bpm, 140.0,
        "reference tempo updated in place"
    );
}

#[test]
fn parallel_apply_in_place_resets_omitted_priority_to_track_order() {
    let rank = |project: &ParallelRuntimeConfig, id: &str| {
        project
            .tracks
            .iter()
            .find(|t| t.id == id)
            .unwrap()
            .priority_rank
    };
    let mut reversed = plain_parallel_config(
        vec![
            cfg_track("a", "A", lead_score(4, &[]), None, false),
            cfg_track("b", "B", lead_score(4, &[]), None, false),
        ],
        REF_BEATS,
    );
    reversed.conflict_priority = vec!["b".to_string(), "a".to_string()];
    let mut project = ParallelRuntimeConfig::from_config(reversed);
    assert_eq!(rank(&project, "a"), 1);
    assert_eq!(rank(&project, "b"), 0);

    // Re-apply the same topology with an EMPTY priority list: ranks must fall
    // back to track order like `from_config`, not leave `b` stale at 0.
    let mut empty = plain_parallel_config(
        vec![
            cfg_track("a", "A", lead_score(4, &[]), None, false),
            cfg_track("b", "B", lead_score(4, &[]), None, false),
        ],
        REF_BEATS,
    );
    empty.conflict_priority = vec![];
    assert!(project.apply_in_place(&empty));
    assert_eq!(rank(&project, "a"), 0, "a falls back to its track index");
    assert_eq!(rank(&project, "b"), 1, "b no longer stale at rank 0");
}

#[test]
fn parallel_apply_in_place_honors_same_source_trigger_config_edit() {
    let follower_config = |project: &ParallelRuntimeConfig| {
        project
            .tracks
            .iter()
            .find(|t| t.id == "follow")
            .unwrap()
            .triggered
            .as_ref()
            .unwrap()
            .config
            .clone()
    };
    let mut project = runtime_from(
        vec![
            cfg_track("lead", "Lead", lead_score(4, &[1, 3]), None, false),
            cfg_track(
                "follow",
                "Follow",
                follower_score(2),
                Some(trig(
                    TriggerCondition::BeatIsRest { beat: 3 },
                    Lifetime::OnePass,
                    ReTrigger::Restart,
                    TriggerLength::ScoreCycle,
                )),
                false,
            ),
        ],
        REF_BEATS,
    );
    realize_parallel_until(&mut project, REF_TPC, &mut VecDeque::new()).unwrap();
    let before = follower_config(&project);

    // Same topology (same source "lead"), edited condition. The gate accepts
    // it; before the fix realization kept observing beat 3 (config ignored).
    let incoming = plain_parallel_config(
        vec![
            cfg_track("lead", "Lead", lead_score(4, &[1, 3]), None, false),
            cfg_track(
                "follow",
                "Follow",
                follower_score(2),
                Some(trig(
                    TriggerCondition::BeatIsRest { beat: 1 },
                    Lifetime::OnePass,
                    ReTrigger::Restart,
                    TriggerLength::ScoreCycle,
                )),
                false,
            ),
        ],
        REF_BEATS,
    );
    assert!(
        project.apply_in_place(&incoming),
        "same-source trigger edit applies in place"
    );
    let after = follower_config(&project);
    assert_ne!(
        after, before,
        "the running follower config was updated, not ignored"
    );
    // It matches the normalized config `from_config` would build for the edit.
    let expected = ParallelRuntimeConfig::from_config(incoming.clone());
    assert_eq!(
        after,
        follower_config(&expected),
        "config equals the normalized edit"
    );
}

#[test]
fn parallel_tempo_change_is_continuous_and_preserves_queue() {
    // P0.1 seam: a pure tempo change on the parallel path must not touch the
    // queue or the realization cursor. Before the fix this branch cleared the
    // queue and reset realization, stranding every sounding note's note-off
    // (a stuck note) and re-dispatching the current cycle.
    let mut project = runtime(
        lead_score(4, &[]),
        follower_score(2),
        None,
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut project, 2 * REF_TPC, &mut queue).unwrap();
    let mut realized_until = 2 * REF_TPC;

    // The realized window contains real note-offs whose loss would strand notes.
    let off_count = queue
        .iter()
        .filter(|e| (e.bytes[0] & 0xF0) == 0x80 || ((e.bytes[0] & 0xF0) == 0x90 && e.bytes[2] == 0))
        .count();
    assert!(
        off_count > 0,
        "test needs sounding notes with offs to be meaningful"
    );
    let before = queue_snapshot(&queue);

    let tpc = project.reference_ticks_per_cycle();
    // Reference tpc is BPM-independent, so a tempo change never changes it.
    let requeued = apply_parallel_tempo_change(
        &mut project,
        &mut queue,
        &mut realized_until,
        80.0,
        tpc,
        tpc,
    );

    assert!(!requeued, "pure tempo change must not requeue");
    assert_eq!(
        queue_snapshot(&queue),
        before,
        "queue (and its note-offs) preserved"
    );
    assert_eq!(realized_until, 2 * REF_TPC, "realization cursor preserved");
}

#[test]
fn parallel_set_tempo_updates_reference_tempo_without_requeue() {
    // P0.1 completion: a parallel `SetTempo` must actually change the tempo —
    // it drives `reference_tempo_bpm`, which is the source of both the
    // effective dispatch clock and the snapshot `tempo_bpm` — while still
    // leaving the queue and realization cursor untouched (the grid is
    // BPM-independent, so no requeue).
    let mut project = runtime(
        lead_score(4, &[]),
        follower_score(2),
        None,
        ChannelConflictPolicy::AllowAll,
    );
    assert_eq!(
        project.reference_tempo_bpm, 80.0,
        "runtime starts at 80 BPM"
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut project, 2 * REF_TPC, &mut queue).unwrap();
    let mut realized_until = 2 * REF_TPC;
    let before = queue_snapshot(&queue);
    let tpc = project.reference_ticks_per_cycle();

    let requeued = apply_parallel_tempo_change(
        &mut project,
        &mut queue,
        &mut realized_until,
        120.0,
        tpc,
        tpc,
    );

    // The snapshot/effective tempo both read `reference_tempo_bpm`, so this
    // is the observable tempo change.
    assert_eq!(
        project.reference_tempo_bpm, 120.0,
        "reference tempo updated 80 -> 120"
    );
    assert!(!requeued, "a BPM-only change must not requeue");
    assert_eq!(
        queue_snapshot(&queue),
        before,
        "queue preserved across the tempo change"
    );
    assert_eq!(realized_until, 2 * REF_TPC, "realization cursor preserved");
    // Out-of-range input is clamped, matching config construction.
    apply_parallel_tempo_change(
        &mut project,
        &mut queue,
        &mut realized_until,
        9_999.0,
        tpc,
        tpc,
    );
    assert_eq!(
        project.reference_tempo_bpm, 400.0,
        "tempo clamped to the valid range"
    );
}

/// A subdivision-switch score whose gati is a coin-flip between 3 and 5 each
/// cycle, resolved through a **History** seed mode. History accumulates seeds
/// across cycles on the persistent score, so a later cycle's draw depends on
/// how many cycles were realized — the exact state `reset_realization` must
/// restore to its authored baseline for replay-from-zero to be deterministic.
fn history_switch_score(name: &str) -> cseq_model::Score {
    cseq_model::Score::subdivision_switch(
        name,
        cseq_model::SubdivisionSwitchSpec {
            cycle_beats: REF_BEATS,
            initial_weights: vec![
                cseq_model::WeightedSubdivisionChoice {
                    subdivision: 3,
                    weight: 1.0,
                },
                cseq_model::WeightedSubdivisionChoice {
                    subdivision: 5,
                    weight: 1.0,
                },
            ],
            initial_jathi_weights: vec![],
            initial_custom_subdivision: None,
            automation: None,
            inflections: vec![],
            switch_count_weights: vec![],
            seed_mode: cseq_model::SwitchSeedMode::History {
                seed: 0x51ED_C0DE,
                history: vec![],
                history_weight: 1.0,
                new_seed_weight: 1.0,
                max_history: 4,
            },
            accent: cseq_model::GatiAccentSpec::default(),
            pitch: 60,
            velocity: 96,
        },
    )
}

fn first_switch_history(score: &cseq_model::Score) -> Vec<u64> {
    score
        .pipeline
        .iter()
        .find_map(|transform| match &transform.kind {
            cseq_model::TransformKind::SubdivisionSwitch {
                seed_mode: cseq_model::SwitchSeedMode::History { history, .. },
                ..
            } => Some(history.clone()),
            _ => None,
        })
        .unwrap_or_default()
}

#[test]
fn parallel_history_switch_replay_is_deterministic_after_reset() {
    // S2 gate: History-mode subdivision-switch seeds accumulate on the
    // persistent score during forward playback. Without restoring the
    // authored baseline on reset, replay-from-zero draws a *different* gati at
    // cycle 0 (the grown history changes the coin), so audio would silently
    // diverge from the timeline after any Resync / grid-changing reapply.
    let build = || {
        runtime_from(
            vec![cfg_track("h", "H", history_switch_score("h"), None, false)],
            REF_BEATS,
        )
    };

    let mut fresh = build();
    let mut fq = VecDeque::new();
    realize_parallel_until(&mut fresh, 4 * REF_TPC, &mut fq).unwrap();
    let fresh_events = queue_snapshot(&fq);
    assert!(
        !fresh_events.is_empty(),
        "the history score must emit notes"
    );

    let mut reapplied = build();
    let mut warm = VecDeque::new();
    realize_parallel_until(&mut reapplied, 4 * REF_TPC, &mut warm).unwrap();
    // Forward playback really did accumulate history (else the test is vacuous).
    assert!(
        !first_switch_history(&reapplied.tracks[0].score).is_empty(),
        "History must accumulate during forward realization"
    );

    reapplied.reset_realization();
    // The fix: reset restores the authored (empty) baseline.
    assert_eq!(
        first_switch_history(&reapplied.tracks[0].score),
        Vec::<u64>::new(),
        "reset_realization restores the authored History baseline"
    );

    let mut rq = VecDeque::new();
    realize_parallel_until(&mut reapplied, 4 * REF_TPC, &mut rq).unwrap();
    assert_eq!(
        queue_snapshot(&rq),
        fresh_events,
        "replay after reset is bit-identical to a fresh realization"
    );
}

#[test]
fn parallel_generator_history_replay_is_deterministic_after_reset() {
    let build = || {
        let mut track = cfg_track("g", "G", history_switch_score("g"), None, false);
        track.rhythm = Some(RhythmPlaybackConfig {
            generator_enabled: true,
            generator: cseq_rhythm::GeneratorConfig::Example(cseq_rhythm::ExampleGeneratorParams {
                density_percent: 37,
                seed_mode: cseq_rhythm::GeneratorSeedMode::History {
                    seed: 0x6EED_1234,
                    history: vec![7],
                    history_weight: 0,
                    new_seed_weight: 1,
                    max_history: 4,
                },
            }),
            midi_output_channel: 1,
            automation: None,
            channel_hocket_enabled: false,
            channel_hocket: None,
            seed_path: None,
        });
        runtime_from(vec![track], REF_BEATS)
    };

    let mut fresh = build();
    let mut fresh_queue = VecDeque::new();
    realize_parallel_until(&mut fresh, 4 * REF_TPC, &mut fresh_queue).unwrap();
    let fresh_events = queue_snapshot(&fresh_queue);

    let mut reapplied = build();
    let mut warmup = VecDeque::new();
    realize_parallel_until(&mut reapplied, 4 * REF_TPC, &mut warmup).unwrap();
    let history_before_reset = match reapplied.tracks[0]
        .rhythm
        .as_ref()
        .map(|config| config.generator.seed_mode())
    {
        Some(cseq_rhythm::GeneratorSeedMode::History { history, .. }) => history.clone(),
        _ => panic!("test requires generator History mode"),
    };
    assert_ne!(history_before_reset, vec![7]);

    reapplied.reset_realization();
    let restored_history = match reapplied.tracks[0]
        .rhythm
        .as_ref()
        .map(|config| config.generator.seed_mode())
    {
        Some(cseq_rhythm::GeneratorSeedMode::History { history, .. }) => history.clone(),
        _ => panic!("test requires generator History mode"),
    };
    assert_eq!(restored_history, vec![7]);

    let mut replay_queue = VecDeque::new();
    realize_parallel_until(&mut reapplied, 4 * REF_TPC, &mut replay_queue).unwrap();
    assert_eq!(queue_snapshot(&replay_queue), fresh_events);
}

#[test]
fn parallel_tempo_change_requeues_only_on_grid_change() {
    // The defensive guard: an actual grid change (different tpc) still forces
    // the full requeue, so the helper stays correct if a grid change is ever
    // routed through it.
    let mut project = runtime(
        lead_score(4, &[]),
        follower_score(2),
        None,
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut project, REF_TPC, &mut queue).unwrap();
    let mut realized_until = REF_TPC;
    let tpc = project.reference_ticks_per_cycle();

    let requeued = apply_parallel_tempo_change(
        &mut project,
        &mut queue,
        &mut realized_until,
        100.0,
        tpc,
        tpc + 1,
    );

    assert!(requeued, "a genuine grid change must requeue");
    assert_eq!(
        project.reference_tempo_bpm, 100.0,
        "tempo still updates on a grid change"
    );
    assert!(queue.is_empty(), "grid change clears the stale queue");
    assert_eq!(
        realized_until, 0,
        "grid change resets the realization cursor"
    );
}

fn cfg_track(
    id: &str,
    name: &str,
    score: cseq_model::Score,
    trigger: Option<TriggerConfig>,
    silent: bool,
) -> ParallelPlaybackTrackConfig {
    ParallelPlaybackTrackConfig {
        id: id.to_string(),
        name: name.to_string(),
        score,
        rhythm: None,
        tempo_bpm: 80.0,
        trigger,
        silent,
    }
}

fn runtime_from(
    tracks: Vec<ParallelPlaybackTrackConfig>,
    reference_cycle_beats: u32,
) -> ParallelRuntimeConfig {
    runtime_from_policy(
        tracks,
        reference_cycle_beats,
        ChannelConflictPolicy::AllowAll,
    )
}

fn runtime_from_policy(
    tracks: Vec<ParallelPlaybackTrackConfig>,
    reference_cycle_beats: u32,
    policy: ChannelConflictPolicy,
) -> ParallelRuntimeConfig {
    let priority = tracks.iter().map(|t| t.id.clone()).collect();
    ParallelRuntimeConfig::from_config(ParallelPlaybackConfig {
        tracks,
        reference_tempo_bpm: 80.0,
        reference_cycle_beats,
        channel_conflict_policy: policy,
        channel_logic_matrix: Vec::new(),
        conflict_priority: priority,
        track_flow_boxes: vec![],
    })
}

/// Audible note-on events as `(tick, wire-channel, pitch)`, sorted.
fn audible_note_ons(queue: &VecDeque<QueuedEvent>) -> Vec<(u64, u8, u8)> {
    let mut v: Vec<(u64, u8, u8)> = queue
        .iter()
        .filter(|e| (e.bytes[0] & 0xF0) == 0x90 && e.bytes[2] != 0)
        .map(|e| (e.absolute_tick, e.bytes[0] & 0x0F, e.bytes[1]))
        .collect();
    v.sort_unstable();
    v
}

#[test]
fn silent_source_does_not_change_count_based_conflict_output() {
    // Two audible tracks collide on the same channel/pitch each beat. Under
    // `And` they pass iff collision_count == active_track_count. A muted
    // silent source must NOT inflate that denominator and suppress them.
    let two_audible = || {
        vec![
            cfg_track("a", "A", lead_score(4, &[]), None, false),
            cfg_track("b", "B", lead_score(4, &[]), None, false),
        ]
    };
    let mut without_silent =
        runtime_from_policy(two_audible(), REF_BEATS, ChannelConflictPolicy::And);
    let mut with_silent = {
        let mut tracks = two_audible();
        tracks.push(cfg_track(
            "clock",
            "Clock",
            lead_score(4, &[]),
            None,
            /* silent */ true,
        ));
        runtime_from_policy(tracks, REF_BEATS, ChannelConflictPolicy::And)
    };
    let mut q_without = VecDeque::new();
    let mut q_with = VecDeque::new();
    let events_without =
        realize_parallel_until(&mut without_silent, REF_TPC, &mut q_without).unwrap();
    let events_with = realize_parallel_until(&mut with_silent, REF_TPC, &mut q_with).unwrap();
    // `And` should pass both colliding tracks when there are two active.
    assert!(
        !audible_note_ons(&q_without).is_empty(),
        "And should pass two colliding active tracks"
    );
    // Adding a silent source must not change the audible output.
    assert_eq!(
        audible_note_ons(&q_without),
        audible_note_ons(&q_with),
        "a silent source must not alter count-based conflict outcomes"
    );
    assert_eq!(
        events_without.parallel_conflict.len(),
        events_with.parallel_conflict.len()
    );
    for decision in &events_with.parallel_conflict {
        assert_eq!(decision.active_track_count, 2);
        assert_eq!(
            decision.colliding_track_ids,
            vec!["a".to_string(), "b".to_string()]
        );
    }
}

#[test]
fn silent_source_does_not_enable_policy_for_single_audible_track() {
    // A silent source should behave as absent for conflict resolution. In
    // particular, it must not flip a one-audible-track runtime into applying
    // the global policy to single note groups.
    let mut without_silent = runtime_from_policy(
        vec![cfg_track("a", "A", lead_score(4, &[]), None, false)],
        REF_BEATS,
        ChannelConflictPolicy::ForceOff,
    );
    let mut with_silent = runtime_from_policy(
        vec![
            cfg_track("a", "A", lead_score(4, &[]), None, false),
            cfg_track("clock", "Clock", lead_score(4, &[]), None, true),
        ],
        REF_BEATS,
        ChannelConflictPolicy::ForceOff,
    );
    let mut q_without = VecDeque::new();
    let mut q_with = VecDeque::new();
    let events_without =
        realize_parallel_until(&mut without_silent, REF_TPC, &mut q_without).unwrap();
    let events_with = realize_parallel_until(&mut with_silent, REF_TPC, &mut q_with).unwrap();
    assert_eq!(audible_note_ons(&q_without), audible_note_ons(&q_with));
    assert!(events_without.parallel_conflict.is_empty());
    assert!(events_with.parallel_conflict.is_empty());
}

#[test]
fn capture_not_truncated_in_large_lookahead_window() {
    // Regression: a 1-beat source against a 64-beat reference realizes 128
    // source cycles in the first 2-cycle lookahead — far more than any fixed
    // retention cap. The follower must still see source cycle 0 and launch at
    // tick 0 (previously a 64-cap dropped the early cycles before compile).
    let mut rt = runtime_from(
        vec![
            cfg_track("lead", "Lead", lead_score(1, &[0]), None, false),
            cfg_track(
                "follow",
                "Follow",
                follower_score(2),
                Some(trig(
                    TriggerCondition::BeatIsRest { beat: 0 },
                    Lifetime::OnePass,
                    ReTrigger::Restart,
                    TriggerLength::ScoreCycle,
                )),
                false,
            ),
        ],
        64,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, 2 * 64 * TPB, &mut queue).unwrap();
    let ticks = track_note_on_ticks(&queue, "follow");
    assert_eq!(
        ticks.first(),
        Some(&0),
        "follower must launch at source cycle 0 (tick 0); got {ticks:?}"
    );
}

#[test]
fn silent_source_still_drives_follower_without_sounding() {
    // A muted/silent source drives the follower but emits no audible MIDI.
    let mut rt = runtime_from(
        vec![
            cfg_track(
                "lead",
                "Lead",
                lead_score(4, &[3]),
                None,
                /* silent */ true,
            ),
            cfg_track(
                "follow",
                "Follow",
                follower_score(2),
                Some(trig(
                    TriggerCondition::BeatIsRest { beat: 3 },
                    Lifetime::OnePass,
                    ReTrigger::Restart,
                    TriggerLength::ScoreCycle,
                )),
                false,
            ),
        ],
        REF_BEATS,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, 2 * REF_TPC, &mut queue).unwrap();
    assert!(
        track_note_on_ticks(&queue, "lead").is_empty(),
        "silent source must not emit audible notes"
    );
    assert_eq!(
        track_note_on_ticks(&queue, "follow"),
        vec![2880, 3840, 6720, 7680],
        "follower must launch at the silent source's beat-3 rest"
    );
}

#[test]
fn launched_events_participate_in_channel_conflict() {
    // Follower launches at cycle start (beat 0 sounding) and overlaps the
    // lead on the same MIDI channel. Under Xor, overlapping note groups are
    // suppressed; under AllowAll they are not. The launched follower events
    // therefore go through the same conflict path as any track.
    let allow = {
        let mut rt = runtime(
            lead_score(4, &[]),
            follower_score(4),
            Some(trig(
                TriggerCondition::BeatIsSounding { beat: 0 },
                Lifetime::OnePass,
                ReTrigger::Restart,
                TriggerLength::ScoreCycle,
            )),
            ChannelConflictPolicy::AllowAll,
        );
        let mut q = VecDeque::new();
        realize_parallel_until(&mut rt, REF_TPC, &mut q).unwrap();
        q.iter()
            .filter(|e| (e.bytes[0] & 0xF0) == 0x90 && e.bytes[2] != 0)
            .count()
    };
    let xor = {
        let mut rt = runtime(
            lead_score(4, &[]),
            follower_score(4),
            Some(trig(
                TriggerCondition::BeatIsSounding { beat: 0 },
                Lifetime::OnePass,
                ReTrigger::Restart,
                TriggerLength::ScoreCycle,
            )),
            ChannelConflictPolicy::Xor,
        );
        let mut q = VecDeque::new();
        realize_parallel_until(&mut rt, REF_TPC, &mut q).unwrap();
        q.iter()
            .filter(|e| (e.bytes[0] & 0xF0) == 0x90 && e.bytes[2] != 0)
            .count()
    };
    assert!(
        xor < allow,
        "Xor must suppress overlapping launched/source notes (xor={xor}, allow={allow})"
    );
}

// ----- Phase B: multi-condition WHEN through the transport seam -----

#[test]
fn any_beat_rest_when_fires_at_every_rest_through_the_seam() {
    // Phase B headline capability: a WHEN with an `AnyBeat` selector yields
    // *multiple candidates per source cycle*. Lead rests at beats 1 and 3, so
    // a one-beat onePass follower must launch at BOTH rest ticks in a single
    // cycle (960 and 2880) — proving the transport reads `cfg.when`, the
    // multi-candidate path survives the seam, and the candidate-identity dedup
    // (source_cycle, matched_beat) keeps each beat distinct.
    let when = WhenSpec {
        beats: BeatSelector::AnyBeat,
        tree: ConditionNode::leaf(WhenPredicate::IsRest),
    };
    let mut rt = runtime(
        lead_score(4, &[1, 3]),
        follower_score(1),
        Some(trig_when(
            when,
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
        )),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, REF_TPC, &mut queue).unwrap();
    assert_eq!(track_note_on_ticks(&queue, "follow"), vec![960, 2880]);
}

#[test]
fn all_tree_with_cycle_count_gates_launch_through_the_seam() {
    // Phase B tree composition + a cycle-level predicate: `All[ IsRest @beat3,
    // SoundingCountInCycle >= N ]`. Lead rests only at beat 3, leaving 3
    // sounding beats (0,1,2). With N=3 the count passes and beat 3 is a rest,
    // so the follower launches at 2880. Raising the threshold to N=4 makes the
    // cycle-level leaf fail, so the whole `All` fails and nothing launches —
    // proving the tree (not just a single leaf) is evaluated end-to-end and a
    // cycle-level count can veto an otherwise-matching beat.
    let make = |min_sounding: u32| WhenSpec {
        beats: BeatSelector::At { beat: 3 },
        tree: ConditionNode::All {
            nodes: vec![
                ConditionNode::leaf(WhenPredicate::IsRest),
                ConditionNode::leaf(WhenPredicate::SoundingCountInCycle {
                    op: CountOp::AtLeast,
                    count: min_sounding,
                }),
            ],
        },
    };

    let fires = {
        let mut rt = runtime(
            lead_score(4, &[3]),
            follower_score(1),
            Some(trig_when(
                make(3),
                Lifetime::OnePass,
                ReTrigger::Restart,
                TriggerLength::ScoreCycle,
            )),
            ChannelConflictPolicy::AllowAll,
        );
        let mut q = VecDeque::new();
        realize_parallel_until(&mut rt, REF_TPC, &mut q).unwrap();
        track_note_on_ticks(&q, "follow")
    };
    assert_eq!(
        fires,
        vec![2880],
        "count>=3 satisfied -> launches at beat 3"
    );

    let vetoed = {
        let mut rt = runtime(
            lead_score(4, &[3]),
            follower_score(1),
            Some(trig_when(
                make(4),
                Lifetime::OnePass,
                ReTrigger::Restart,
                TriggerLength::ScoreCycle,
            )),
            ChannelConflictPolicy::AllowAll,
        );
        let mut q = VecDeque::new();
        realize_parallel_until(&mut rt, REF_TPC, &mut q).unwrap();
        track_note_on_ticks(&q, "follow")
    };
    assert!(
        vetoed.is_empty(),
        "count>=4 fails (only 3 sounding) -> All vetoes, no launch (got {vetoed:?})"
    );
}

// ----- Phase C: GATE through the transport seam -----

fn trig_gated(
    cond: TriggerCondition,
    lifetime: Lifetime,
    re: ReTrigger,
    length: TriggerLength,
    gate: GateSpec,
) -> TriggerConfig {
    TriggerConfig {
        gate: Some(gate),
        ..trig(cond, lifetime, re, length)
    }
}

#[test]
fn gate_probability_zero_silences_the_follower_through_the_seam() {
    // A gate that never accepts ⇒ the follower stays silent end-to-end, even
    // though WHEN matches the beat-3 rest every cycle. Proves the transport
    // honors `cfg.gate` through `compile_window`.
    let mut rt = runtime(
        lead_score(4, &[3]),
        follower_score(2),
        Some(trig_gated(
            TriggerCondition::BeatIsRest { beat: 3 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
            GateSpec {
                probability_per_mille: 0,
                cooldown_cycles: 0,
                miss_boost_per_mille: 0,
                seed: 1,
            },
        )),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, 3 * REF_TPC, &mut queue).unwrap();
    assert!(
        track_note_on_ticks(&queue, "follow").is_empty(),
        "p=0 gate ⇒ no follower notes"
    );
}

#[test]
fn gate_probability_full_matches_ungated_launches_through_the_seam() {
    // p=1000 must behave exactly like no gate at all.
    let run = |gate: Option<GateSpec>| {
        let cfg = TriggerConfig {
            gate,
            ..trig(
                TriggerCondition::BeatIsRest { beat: 3 },
                Lifetime::OnePass,
                ReTrigger::Restart,
                TriggerLength::ScoreCycle,
            )
        };
        let mut rt = runtime(
            lead_score(4, &[3]),
            follower_score(2),
            Some(cfg),
            ChannelConflictPolicy::AllowAll,
        );
        let mut q = VecDeque::new();
        realize_parallel_until(&mut rt, 2 * REF_TPC, &mut q).unwrap();
        track_note_on_ticks(&q, "follow")
    };
    let ungated = run(None);
    let full = run(Some(GateSpec {
        probability_per_mille: 1000,
        cooldown_cycles: 0,
        miss_boost_per_mille: 0,
        seed: 99,
    }));
    assert_eq!(ungated, vec![2880, 3840, 6720, 7680]);
    assert_eq!(full, ungated, "p=1000 ⇒ identical to ungated");
}

#[test]
fn gate_cooldown_spaces_launches_through_the_seam() {
    // Beat-3 rest every cycle + a 2-cycle cooldown ⇒ launches only on cycles
    // 0, 2, 4 (1 and 3 are inside the cooldown). One-beat onePass follower so
    // each accepted launch is a single note at the beat-3 tick of its cycle.
    let mut rt = runtime(
        lead_score(4, &[3]),
        follower_score(1),
        Some(trig_gated(
            TriggerCondition::BeatIsRest { beat: 3 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
            GateSpec {
                probability_per_mille: 1000,
                cooldown_cycles: 2,
                miss_boost_per_mille: 0,
                seed: 5,
            },
        )),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, 5 * REF_TPC, &mut queue).unwrap();
    // Beat 3 tick of cycle c = c*REF_TPC + 2880.
    assert_eq!(
        track_note_on_ticks(&queue, "follow"),
        vec![2880, 2 * REF_TPC + 2880, 4 * REF_TPC + 2880]
    );
}

// ----- Phase D: START placement through the transport seam -----

#[test]
fn center_in_rest_places_the_follower_at_the_beat_midpoint_through_the_seam() {
    // Lead rests beat 3 (span [2880, 3840)); CenterInRest ⇒ beat 0 at 3360.
    let cfg = TriggerConfig {
        launch_alignment: LaunchAlignment::CenterInRest,
        ..trig(
            TriggerCondition::BeatIsRest { beat: 3 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
        )
    };
    let mut rt = runtime(
        lead_score(4, &[3]),
        follower_score(1),
        Some(cfg),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    realize_parallel_until(&mut rt, REF_TPC, &mut queue).unwrap();
    assert_eq!(track_note_on_ticks(&queue, "follow"), vec![3360]);
}

#[test]
fn weighted_start_resolves_deterministically_through_the_seam() {
    // A weighted START with only CenterInRest weighted ⇒ the follower lands at
    // the midpoint, and re-realizing the same config reproduces it exactly.
    let make = || TriggerConfig {
        start_select: Some(StartSelect {
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
            seed: 7,
        }),
        ..trig(
            TriggerCondition::BeatIsRest { beat: 3 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
        )
    };
    let run = || {
        let mut rt = runtime(
            lead_score(4, &[3]),
            follower_score(1),
            Some(make()),
            ChannelConflictPolicy::AllowAll,
        );
        let mut q = VecDeque::new();
        realize_parallel_until(&mut rt, REF_TPC, &mut q).unwrap();
        track_note_on_ticks(&q, "follow")
    };
    let first = run();
    assert_eq!(
        first,
        vec![3360],
        "weighted pick (CenterInRest) reaches the seam"
    );
    assert_eq!(run(), first, "weighted START is reproducible");
}

#[test]
fn delayed_weighted_start_retains_source_until_future_launch_window() {
    // Regression: source-cycle retention looked only at the single
    // `launch_alignment`, so a weighted START option with `afterEventTicks`
    // could leave a source fire queued for a future window and then prune
    // the source cycle before that delayed launch became in-window.
    let delay = 3 * REF_TPC + TPB;
    let cfg = TriggerConfig {
        start_select: Some(StartSelect {
            options: vec![WeightedStart {
                alignment: LaunchAlignment::AfterEventTicks { ticks: delay },
                weight: 1,
            }],
            seed: 17,
        }),
        ..trig(
            TriggerCondition::BeatIsRest { beat: 0 },
            Lifetime::OnePass,
            ReTrigger::Restart,
            TriggerLength::ScoreCycle,
        )
    };
    let mut rt = runtime(
        lead_score(4, &[0]),
        follower_score(1),
        Some(cfg),
        ChannelConflictPolicy::AllowAll,
    );
    let mut queue = VecDeque::new();
    for target in [REF_TPC, 2 * REF_TPC, 3 * REF_TPC, 4 * REF_TPC] {
        realize_parallel_until(&mut rt, target, &mut queue).unwrap();
    }
    assert_eq!(
        track_note_on_ticks(&queue, "follow"),
        vec![delay],
        "delayed weighted START must retain the source cycle until tick {delay}"
    );
}

/// Recording MidiSink: the Phase 3.2 fake that lets send-side scheduler
/// helpers run off-hardware.
struct RecordingSink {
    sent: Vec<(u64, Vec<u8>)>,
}

impl cseq_midi::MidiSink for RecordingSink {
    fn send_raw(&mut self, bytes: &[u8]) -> Result<(), MidiError> {
        self.sent.push((0, bytes.to_vec()));
        Ok(())
    }

    fn send_at(&mut self, host_time: u64, bytes: &[u8]) -> Result<(), MidiError> {
        self.sent.push((host_time, bytes.to_vec()));
        Ok(())
    }
}

#[test]
fn shutdown_now_completes_with_other_arc_owners_and_is_idempotent() {
    use std::sync::atomic::{AtomicBool, Ordering};

    struct ShutdownSink {
        sent: Arc<Mutex<Vec<Vec<u8>>>>,
        dropped: Arc<AtomicBool>,
    }
    impl MidiSink for ShutdownSink {
        fn send_raw(&mut self, bytes: &[u8]) -> Result<(), MidiError> {
            self.sent.lock().push(bytes.to_vec());
            Ok(())
        }
    }
    impl Drop for ShutdownSink {
        fn drop(&mut self) {
            self.dropped.store(true, Ordering::Release);
        }
    }

    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 80.0,
        is_playing: false,
        current_tick: 0,
        current_cycle: 0,
        ticks_per_cycle: 0,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));
    let sent = Arc::new(Mutex::new(Vec::new()));
    let dropped = Arc::new(AtomicBool::new(false));
    let (cmd_tx, cmd_rx) = bounded(64);
    let scheduler_shared = Arc::clone(&shared);
    let sink_sent = Arc::clone(&sent);
    let sink_dropped = Arc::clone(&dropped);
    let scheduler_thread = thread::spawn(move || {
        scheduler_loop(
            ShutdownSink {
                sent: sink_sent,
                dropped: sink_dropped,
            },
            scheduler_shared,
            cmd_rx,
        );
    });
    let transport = Arc::new(Transport {
        shared,
        cmd_tx,
        thread: Mutex::new(Some(scheduler_thread)),
        shutdown_result: OnceLock::new(),
    });
    let other_owner = Arc::clone(&transport);

    transport
        .shutdown_now()
        .expect("shutdown is acknowledged through an Arc");
    assert!(
        dropped.load(Ordering::Acquire),
        "the MIDI sink is dropped before shutdown_now returns"
    );
    assert_eq!(
        sent.lock()
            .iter()
            .filter(|bytes| bytes.get(1) == Some(&123))
            .count(),
        16
    );

    let message_count = sent.lock().len();
    other_owner
        .shutdown_now()
        .expect("a repeated shutdown reuses the completed result");
    assert_eq!(
        sent.lock().len(),
        message_count,
        "a repeated shutdown does not run a second sweep"
    );
}

#[test]
fn acknowledged_transport_commands_publish_shared_state_before_returning() {
    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 80.0,
        is_playing: false,
        current_tick: 0,
        current_cycle: 0,
        ticks_per_cycle: 0,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));
    let (cmd_tx, cmd_rx) = bounded(64);
    let scheduler_shared = Arc::clone(&shared);
    let thread = thread::spawn(move || {
        scheduler_loop(RecordingSink { sent: Vec::new() }, scheduler_shared, cmd_rx);
    });
    let transport = Transport {
        shared,
        cmd_tx,
        thread: Mutex::new(Some(thread)),
        shutdown_result: OnceLock::new(),
    };

    transport.play().expect("play is acknowledged");
    assert!(transport.snapshot().is_playing);

    transport.set_tempo(123.0).expect("tempo is acknowledged");
    assert_eq!(transport.snapshot().tempo_bpm, 123.0);

    transport.resync().expect("resync is acknowledged");
    assert!(transport.snapshot().is_playing);

    transport.stop().expect("stop is acknowledged");
    assert!(!transport.snapshot().is_playing);

    transport.shutdown();
}

#[test]
fn panic_silences_sounding_notes_and_keeps_the_transport_playing() {
    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 400.0,
        is_playing: false,
        current_tick: 0,
        current_cycle: 0,
        ticks_per_cycle: 0,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));
    let (cmd_tx, cmd_rx) = bounded(64);
    let scheduler_shared = Arc::clone(&shared);
    let thread = thread::spawn(move || {
        scheduler_loop(RecordingSink { sent: Vec::new() }, scheduler_shared, cmd_rx);
    });
    let transport = Transport {
        shared: Arc::clone(&shared),
        cmd_tx,
        thread: Mutex::new(Some(thread)),
        shutdown_result: OnceLock::new(),
    };

    transport
        .set_score(
            Score::single_pulse("panic-test", 60, 96),
            ApplyQuantize::Immediate,
        )
        .expect("score loads");
    transport.play().expect("play is acknowledged");

    // Wait for a real note-on to dispatch so the ledger has content.
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        let saw_note_on = shared
            .lock()
            .layers
            .midi_debug
            .iter()
            .any(|event| is_note_on(&event.bytes));
        if saw_note_on {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "no note-on dispatched within 2s"
        );
        thread::sleep(Duration::from_millis(5));
    }

    transport.panic().expect("panic is acknowledged");
    assert!(
        transport.snapshot().is_playing,
        "panic must not stop the transport"
    );

    {
        let guard = shared.lock();
        let panic_events: Vec<&MidiDebugEvent> = guard
            .layers
            .midi_debug
            .iter()
            .filter(|event| event.debug_source.as_deref() == Some("midi panic"))
            .collect();
        let explicit_offs = panic_events
            .iter()
            .filter(|event| is_note_off(&event.bytes))
            .count();
        let sweeps = panic_events
            .iter()
            .filter(|event| event.bytes.get(1) == Some(&123))
            .count();
        assert!(
            explicit_offs >= 1,
            "panic sends explicit note-offs for the sounding notes"
        );
        assert_eq!(sweeps, 16, "panic sweeps CC123 across all 16 channels");
        let first_sweep = panic_events
            .iter()
            .position(|event| event.bytes.get(1) == Some(&123))
            .unwrap();
        let last_off = panic_events
            .iter()
            .rposition(|event| is_note_off(&event.bytes))
            .unwrap();
        assert!(
            last_off < first_sweep,
            "explicit offs precede the CC123 sweep"
        );
    }

    // Let the queued note-offs for the panicked notes dispatch: they are
    // harmless duplicates and must NOT trip the stuck-note residue sweep.
    thread::sleep(Duration::from_millis(400));
    let stuck_sweeps = shared
        .lock()
        .layers
        .midi_debug
        .iter()
        .filter(|event| {
            event
                .debug_source
                .as_deref()
                .is_some_and(|source| source.contains("stuck"))
        })
        .count();
    assert_eq!(
        stuck_sweeps, 0,
        "duplicate note-offs after panic must not look like an engine bug"
    );

    transport.shutdown();
}

/// The connect ack round-trips through the sink seam: a sink that records
/// destination requests sees exactly what `connect_midi_destination` sent.
#[test]
fn connect_midi_destination_acks_through_the_sink() {
    type ConnectLog = Arc<Mutex<Vec<(bool, Option<MidiDestination>)>>>;

    struct ConnectRecordingSink {
        connects: ConnectLog,
    }
    impl cseq_midi::MidiSink for ConnectRecordingSink {
        fn send_raw(&mut self, _bytes: &[u8]) -> Result<(), MidiError> {
            Ok(())
        }
        fn connect_destination(
            &mut self,
            dest: Option<&MidiDestination>,
            _sounding_notes: &[SoundingNote],
        ) -> Result<(), MidiError> {
            self.connects.lock().push((false, dest.cloned()));
            match dest {
                Some(dest) if dest.id == "missing" => {
                    Err(MidiError::Connect("destination not found".to_string()))
                }
                _ => Ok(()),
            }
        }

        fn reconnect_destination(
            &mut self,
            dest: Option<&MidiDestination>,
            _sounding_notes: &[SoundingNote],
        ) -> Result<(), MidiError> {
            self.connects.lock().push((true, dest.cloned()));
            Ok(())
        }
    }

    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 80.0,
        is_playing: false,
        current_tick: 0,
        current_cycle: 0,
        ticks_per_cycle: 0,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));
    let connects: ConnectLog = Arc::new(Mutex::new(Vec::new()));
    let (cmd_tx, cmd_rx) = bounded(64);
    let scheduler_shared = Arc::clone(&shared);
    let sink_connects = Arc::clone(&connects);
    let thread = thread::spawn(move || {
        scheduler_loop(
            ConnectRecordingSink {
                connects: sink_connects,
            },
            scheduler_shared,
            cmd_rx,
        );
    });
    let transport = Transport {
        shared,
        cmd_tx,
        thread: Mutex::new(Some(thread)),
        shutdown_result: OnceLock::new(),
    };

    let dest = MidiDestination {
        id: "42".to_string(),
        name: "IAC Bus".to_string(),
    };
    transport
        .connect_midi_destination(Some(dest.clone()))
        .expect("connect acks Ok");
    transport
        .connect_midi_destination(None)
        .expect("disconnect acks Ok");
    transport
        .reconnect_midi_destination(Some(dest.clone()))
        .expect("forced reconnect acks Ok");
    let error = transport
        .connect_midi_destination(Some(MidiDestination {
            id: "missing".to_string(),
            name: "Gone".to_string(),
        }))
        .expect_err("missing destination surfaces the connect error");
    assert!(matches!(error, TransportError::MidiRoute(_)));

    assert_eq!(
        *connects.lock(),
        vec![
            (false, Some(dest.clone())),
            (false, None),
            (true, Some(dest)),
            (
                false,
                Some(MidiDestination {
                    id: "missing".to_string(),
                    name: "Gone".to_string(),
                }),
            ),
        ]
    );

    transport.shutdown();
}

/// Phase 3.2: the swap-time orphan release, driven through the MidiSink
/// fake — releases exactly the listed notes (immediate 0x80), records the
/// debug event, clears them from the ledger, and leaves everything else
/// ringing.
#[test]
fn release_orphan_notes_sends_offs_and_prunes_ledger() {
    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 80.0,
        is_playing: true,
        current_tick: 0,
        current_cycle: 0,
        ticks_per_cycle: 960,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));
    let mut sink = RecordingSink { sent: Vec::new() };
    let mut active: HashMap<(u8, u8), u32> = HashMap::new();
    active.insert((0, 60), 1);
    active.insert((0, 64), 2);
    release_orphan_notes(
        &[(0, 60)],
        "swap orphan note-off",
        &mut sink,
        None,
        &default_synth_voices(),
        &shared,
        480,
        960,
        &mut active,
    );
    assert_eq!(
        sink.sent,
        vec![(0, cseq_midi::note_off_bytes(0, 60).to_vec())],
        "exactly the orphan gets an immediate note-off"
    );
    assert!(
        !active.contains_key(&(0, 60)),
        "orphan pruned from the ledger"
    );
    assert_eq!(
        active.get(&(0, 64)),
        Some(&2),
        "unlisted notes keep ringing"
    );
    let logged = shared.lock().layers.midi_debug.back().cloned();
    assert_eq!(
        logged.map(|event| event.bytes),
        Some(cseq_midi::note_off_bytes(0, 60).to_vec()),
        "the release is logged as a MIDI debug event"
    );
}

/// Phase 3.2: the blanket all-notes-off helper hits all 16 channels
/// through the sink with CC 123.
#[test]
fn send_all_notes_off_logged_covers_all_channels() {
    let shared = Arc::new(Mutex::new(TransportShared {
        tempo_bpm: 80.0,
        is_playing: false,
        current_tick: 0,
        current_cycle: 0,
        ticks_per_cycle: 960,
        current_score_id: None,
        parallel_track_positions: Vec::new(),
        layers: PlaybackLayers::default(),
    }));
    let mut sink = RecordingSink { sent: Vec::new() };
    send_all_notes_off_logged(&mut sink, &shared, 0, 960, "test");
    let expected: Vec<(u64, Vec<u8>)> = (0..16u8)
        .map(|ch| (0, cseq_midi::all_notes_off_bytes(ch).to_vec()))
        .collect();
    assert_eq!(sink.sent, expected);
}
