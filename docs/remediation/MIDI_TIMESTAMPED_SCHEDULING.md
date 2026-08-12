# Design: Timestamped MIDI Scheduling (retire the tight-loop dispatcher)

Status: proposed (2026-07-01 docs-vs-code audit)
Owner docs: [KNOWN_RISKS.md](../KNOWN_RISKS.md) "Scheduler Timing",
[ARCHITECTURE.md](../ARCHITECTURE.md)

## Problem

KNOWN_RISKS states it plainly: "The scheduler sends events immediately through
`midir`, with a tight loop and no deferred timestamping. This is good enough
for current testing but not a final high-precision MIDI scheduler." The
accuracy ceiling is the loop's wake-up jitter (OS scheduling of the transport
thread), which is audible in dense material — exactly the material this app
exists for (high gati counts, ratchet subdivisions, hocketing across
channels). This is a *systemic efficiency/accuracy* gap against the product's
own bar ("musical accuracy"), not a bug; it needs a design because it touches
queue ownership rules the postmortem hardened.

A second documented sharp edge lives in the same loop: on mid-cycle reapply or
manual resync, re-realized events before the current tick must be discarded or
they fire immediately as "late MIDI" (KNOWN_RISKS mitigation bullet). A
timestamped design must preserve that discard rule.

## Constraints (from the postmortem and layer rules)

- The scheduler queue is a holding area for **finalized** events; realization
  and playback rewrites happen on a cycle-local queue first. Timestamping must
  not reintroduce whole-queue mutation.
- `record_cycle_playback_events` / `clear_realized_playback_layers` remain the
  only metadata entry points.
- Locked-seed replay must stay byte-identical: timestamps are derived
  presentation data, never inputs to realization.
- `cseq-midi` already has `host_time.rs` — the mach host-time conversion layer
  a CoreMIDI timestamped send needs.

## Design

Two-stage clock separation: the transport loop keeps *deciding* what plays
(cycle realization, queue management) but stops being the *timing* authority
for individual events.

1. **Event timestamps at enqueue.** When a cycle's finalized events append to
   the scheduler queue, stamp each with an absolute host time computed from
   `(cycle_base_tick + event_tick) → mach host time` using the tempo map at
   enqueue time. `crates/cseq-midi/src/host_time.rs` owns the conversion.
2. **Lookahead dispatch window.** The loop wakes every W ms (start: W=15) and
   hands every event inside `[now, now + 2W]` to the output stage with its
   timestamp; events stay in the queue until handed off. This drops the
   current "dispatch only due events, immediately" pattern in favor of
   "dispatch soon-due events, stamped".
3. **Output stage.**
   - macOS/CoreMIDI: send via `MIDISendList` (or midir's raw CoreMIDI handle
     if exposed; otherwise a thin `coremidi`-crate output alongside midir,
     selected at device-open time) with the event's host timestamp. CoreMIDI
     then delivers with sub-ms accuracy regardless of loop jitter.
   - Fallback (midir/virtual/CI): keep immediate send at due time — identical
     to today, so tests and non-macOS builds are unaffected.
4. **Tempo changes inside the window.** Tempo automation applies at cycle
   realization (tempo per cycle is already resolved then); a mid-window manual
   BPM change triggers the existing reapply path — see next point.
5. **Reapply/resync discard rule, extended.** On reapply/resync, discard
   (a) re-realized events before the current tick (existing rule) and
   (b) **already-handed-off events not yet due**: CoreMIDI accepts unschedule
   via `MIDIFlushOutput` on the port — call it on every reapply/resync/stop
   before rebuilding the forward queue. This keeps the "no stale future
   events" invariant with hardware-grade timing.
6. **Stop.** `stop` = flush output port + clear forward queue (existing
   semantics), plus all-notes-off as today.

## What does NOT change

- Realization cadence, cycle-local rewrites (ratchet/routing/hocket), metadata
  recording, seed handling, snapshot parity — all untouched. Timestamps are
  attached after `record_cycle_playback_events`, so timeline metadata still
  describes exactly what will sound.

## Test plan

- Unit: tick→host-time conversion round-trips under tempo values including
  extreme BPM; window handoff selects exactly `[now, now+2W)`.
- Determinism: existing locked-seed replay tests unchanged (timestamps are not
  recorded in layers).
- Reapply: extend the existing late-MIDI regression (KNOWN_RISKS mitigation)
  to assert flushed-then-rebuilt queues never double-send an event id.
- Manual validation: record into Ableton/Max (KNOWN_RISKS suggestion) at gati
  9/11 + ratchet, compare inter-onset variance before/after; target <1ms
  stddev on CoreMIDI path.

## Sequencing

1. Host-time stamping + lookahead handoff with immediate-send output (pure
   refactor, no audible change) — lands the structure with zero platform risk.
2. CoreMIDI timestamped output behind a feature flag; A/B by recording.
3. Flush-on-reapply wiring + regression tests; flip the flag on by default.
