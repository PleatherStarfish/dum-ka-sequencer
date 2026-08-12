# Triggered Tracks — Design & Implementation Plan

**Status:** proposed · **Created:** 2026-05-30 · **Owner:** TBD

A new per-track **mode** that lets a track stay silent until a *trigger condition*
observed in another track fires, then run on its own terms (its own cycle length,
its own start alignment, a bounded number of repeats, and re-trigger behavior).
This is the first feature that makes tracks *interact* rather than merely run in
parallel, so the design centers on keeping that interaction **deterministic**,
**cycle-local**, and faithful to the existing timeline↔MIDI parity contract.

> Read alongside: `AGENTS.md` (High-Risk Invariants),
> `docs/TIMELINE_AUDIO_PARITY_POSTMORTEM.md`, and `docs/ARCHITECTURE.md`. This plan
> obeys those invariants; where it interacts with them it says so explicitly.

---

## Review corrections (BINDING — supersedes the optimistic claims below)

> **Status update — 2026-05-30:** v1 is now *implemented*, not proposed. A
> design review found several load-bearing claims in §0–§10 below to be
> over-optimistic or false. The corrections in this section are **authoritative**
> and describe what was actually built; where the older sections (§0, §3, §8,
> §10) disagree, this section wins. The older text is kept for historical
> context. The implementation lives in the pure crate `crates/cseq-trigger` plus
> a single explicit transport seam in `crates/cseq-transport`.

### C1. The preview path is NOT rest-aware — a real `ResolvedCycle` adapter was built

§0.1(1) / §3.3 / §8-R2 / Phase-0 claim that `rhythm_preview` /
`preview_frames_from_root` already exposes rest-vs-sounding. **False.**
`preview_frames_from_root` (`src-tauri/src/main.rs`) emits purely structural
`PreviewFrame`s (node id, start/duration, division index); rest-vs-sounding is
decided by the *rhythm-articulation overlay during realization*
(`apply_rhythm_to_tree` in `cseq-transport`), not by the structural pipeline.

Correction: `cseq-trigger::resolve` defines `ResolvedCycle` and
`resolve_cycle_from_spans`, which **combine** the resolved structural pulse
spans (`PulseSpan`: gati per beat, section start, jathi pulses) with the
**realized audible note groups** (which carry rest-vs-sounding). The transport
captures the note groups from the cycle it actually realizes, so the evaluator
reads exactly what is scheduled. Tests prove beat-3-rest, gati-per-beat,
section-start, jathi-pulse, and note-group boundaries are all legible.

### C2. Parity is not automatic — there is ONE compiled-window source of truth

§0.2 / §8 claim parity holds "for free." It does **not** hold automatically,
because the timeline preview is computed via a *different* path than MIDI
scheduling. Correction: the **single source of truth** is the
`CompiledLaunch` list produced by `cseq-trigger::compile_window` and realized by
the transport. The follower's notes exist in exactly one place — the realized
queue — and reach the timeline only via the transport snapshot (the same way
ratchet/hocket metadata already does). When stopped, a triggered track previews
as *armed/idle* (no ghost notes). The UI never independently guesses launched
notes. Both timeline and MIDI therefore derive from the identical compiled
artifact.

### C3. The transport DOES change — an honest, explicit, future-only seam

§0.3-R1 / §8 claim "the scheduler loop is not touched" and that
`discard_stale_events_before_tick` already solves per-track replacement
unchanged. **Not true as stated.** `realize_parallel_until` free-runs every
track every cycle; a follower that is silent between launches needs an explicit
seam. Correction (as built):

- `ParallelRuntimeTrack` gains an optional `triggered: Option<TriggeredRuntime>`.
  `None` ⇒ the existing continuous path runs **byte-for-byte unchanged** (guarded
  by a continuous-only golden test).
- `realize_parallel_until` realizes continuous tracks first (capturing each
  source cycle's `ResolvedCycle`), then realizes triggered tracks by compiling
  their launches for the same lookahead window and placing the follower's cycles
  at launch ticks. This is the explicit runtime representation the plan owed.
- The seam is **append-only / future-only**: a follower only ever realizes ticks
  ≥ its realize cursor; it never rewrites already-finalized queue events. On
  edit/reapply, the existing discard-stale-and-re-realize machinery runs and the
  follower recompiles deterministically from cycle 0.

### C4. Determinism needs stable identity + stable follower cycle indexing

§0.3-R3 / §8-R2 claim "determinism collapses to a pure compiler." Insufficient:
per-cycle seeding means a recompile could shift a launched cycle's seed index.
Correction: every launch gets a `run_index` and a `first_local_cycle_index` from
monotonic counters that are **reproducible from cycle 0** and threaded through
the carry. The follower's k-th launched cycle realizes at local cycle index
`first_local_cycle_index + k`, which feeds the existing per-cycle `mix_seed`
path — so the same trigger yields the same launched phrase across
recompile/reapply, and seed-path replay survives reapply. No new seed machinery.

### C5. Windowed compilation carries explicit state

Implemented as `compile_window(cfg, source_cycles, window, follower, ctx,
carry_in) -> (launches, carry_out)`. `TriggerCarry` carries the boundary-crossing
`active_run`, the depth-1 `queued` launch, the `next_run_index` /
`next_local_cycle_index` counters, and `consumed_through_source_cycle` (dedupe).
A property test proves **windowing is associative**: compiling `[0,W]` then
`[W,2W]` with threaded carry equals compiling `[0,2W]` (launches and carry).

### C6. "Instant start" is future-only by construction

A fire whose launch tick is before the window start (already finalized/queued) is
**dropped** — the follower cannot retro-launch into the past, and the transport
never mutates finalized scheduler-queue events. So restart cleanly truncates a
not-yet-realized run within the lookahead window; a restart of an
already-finalized run cannot cut its finalized tail (a documented limitation, not
a bug). "Instant" is exact only inside the not-yet-realized window.

### C7. Trigger graph depth is ONE level, enforced

v1 allows **one source level only**: a follower's source must be a *continuous*
track. `normalize_track_modes` rejects (→ continuous fallback + warning):
self-trigger, dangling source, a source that is itself triggered, and any
residual cycle. This removes the §6.1-vs-§11 contradiction in the older text.
Multi-level DAG ordering is explicitly deferred.

### C8. AGENTS.md invariants preserved (and one added)

Triggered followers compile **upstream** of realization and feed the *same*
`realize_and_enqueue` → cycle-local-finalize → conflict/hocket path as any track,
so: timeline==MIDI parity holds (C2); playback queue rewrites stay cycle-local
(C3, C6); channel hocket remains the final MIDI rewrite; ratchet stays
playback-only; gati stays per beat (the `ResolvedCycle` adapter reads gati per
`GatiBeat` span). A new invariant is added to `AGENTS.md`: *the trigger graph is
acyclic and one level deep; follower scores are compiled upstream and never
rewrite finalized queue events; the evaluator/compiler are pure and
deterministic.*

### v1 scope actually shipped vs deferred

**Shipped:** `trackMode` continuous|triggered; conditions `beatIsRest`,
`beatIsSounding`, `sectionStartAtBeat`, `gatiIs`, `jathiPulseAtBeat`; alignments
`atEvent`, `atSourceCycleStart`, `atNextReferenceBeat`, `afterEventTicks`;
lifetimes `onePass` and `repeats{n}`; re-trigger `restart`/`ignore`/`queue`
(depth 1); length `scoreCycle` and `fixedBeats{n}`; `maxRepeats` safety cap
(default 64).

**Deferred (NOT in v1), each requiring the carry/state + parity machinery noted:**
`conditionalLength`; `untilStopCondition`; **post-score conditions**
`ratchetFiredAtBeat` / `ornamentAtBeat` / `channelHocketRoutedTo` (they observe
finalized transport metadata, not pure preview/resolved data); all guards
(cooldown/probability/tempo); the wider structural taxonomy
(`everyNthCycle`, …); live external input; multi-level trigger DAGs;
`onlyWhenSourceAudible` (mute still does **not** suppress triggers — triggers
observe resolved structure, not audibility).

---

## 0. Recommended architecture (READ THIS FIRST) — "compiled launches", low-risk

> An earlier draft of this plan (preserved below as §2–§3 "Alternative considered")
> resolved triggers *inside* the live scheduler by rewriting the per-track free-run
> loop into a dependency-ordered driver. That concentrated four HIGH risks on the
> most fragile, already-postmortem'd part of the codebase (the realize→queue→parity
> pipeline). **We are not doing that.** This section is the recommendation.

### 0.1 The reframing that removes the risk

A triggered track is not a scheduler-control problem. It is a **score-generation**
problem that sits *upstream* of the scheduler. The dependency is **one-directional
and one level deep**: a source track's resolution never depends on its followers.
So we never need to interleave realization or rewrite the scheduler loop.

Three facts about the existing engine make this safe (all verified in code):

1. The engine can **resolve a score to a structured, rest-aware, rational-timed
   cycle purely and off the audio thread** — this is exactly what the existing
   `rhythm_preview` / `preview_frames_from_root` path already does. Rest-vs-sounding
   and beat/matra positions are readable from the resolved frame tree.
2. A parallel track is, to the conflict/hocket/merge stage, **just a score placed
   on the reference timeline**. `realize_parallel_until` tags every track's events
   and runs them all through the same conflict resolution uniformly — it does not
   care *how* a track's score was produced.
3. Tracks already support **track-local cycle length and tempo** that need not
   match the global cycle (`ParallelTrackTimingWindow`, `map_parallel_queue_ticks`).
   A 1- or 2-beat phrase placed at an arbitrary reference tick is already a solved
   problem for continuous local-tempo tracks.

### 0.2 The design: a triggered track *compiles* to an ordinary track

Pipeline, entirely upstream of the scheduler:

```
            (pure, off-thread, reuses existing preview resolver)
source track score ──► resolve cycles in the lookahead window ──► ResolvedCycle[]
                                                                      │
                                   TriggerEvaluator (pure) ◄──────────┘
                                   = list of launch ticks + per-launch length/seed
                                                                      │
                                   TriggeredScoreCompiler (pure) ◄─────┘
                                   = build the follower's effective score for this
                                     window: silence between launches, the phrase
                                     at each launch tick, bounded by repeats/caps
                                                                      │
                                   ▼
   feed that compiled score to the SAME parallel realization path as a
   continuous track — no scheduler changes, no new control flow in the hot loop
```

The triggered track enters `realize_parallel_until` looking exactly like a
continuous track whose score happens to be "rests, then a phrase, then rests."
Everything downstream — realization, tick mapping, ratchet/ornament/hocket,
metadata, the cycle-local queue discipline, timeline preview — is **unchanged and
unaware** that triggering happened. Parity holds because the follower's timeline
and MIDI both derive from the same compiled score, same as every other track.

### 0.3 Why each original HIGH risk disappears

- **R1 (rewrite the free-run loop → regressions): GONE.** The scheduler loop is not
  touched. Continuous tracks realize byte-for-byte as today; a triggered track is
  another track in the existing per-track loop. No ordered-driver refactor.
- **R2 (thread rest-structure into the hot path): GONE.** Trigger evaluation reads
  the **already-existing pure preview resolution**, off the audio thread, before
  scheduling. We are *consuming* resolved data, not surfacing new data inside
  realization.
- **R3 (launch-identity seeding that must survive replay): REDUCED to normal.** The
  compiled follower score is deterministic given (source score, seeds, config). It
  then seeds per-cycle exactly like any track — there is no new replay machinery in
  the scheduler. The only determinism rule is "the compiler is a pure function,"
  which is trivially unit-testable in isolation.
- **R4 (transport reapply duplicates/drops runs): REDUCED to normal.** On any edit,
  we recompile the follower score from the (re-resolved) source window and hand the
  scheduler a fresh score — the **same** discard-and-re-realize path the engine
  already uses for an edited continuous track. There is no in-flight trigger state
  in the scheduler to corrupt; recompilation is idempotent because the compiler is
  pure.

What remains is ordinary, well-bounded work: a pure evaluator, a pure compiler, and
config plumbing — the exact shape of work the test harness is strongest at.

### 0.4 The one real constraint this introduces

The follower must be compiled over the **same lookahead window** the scheduler
realizes (the engine stays ~2 cycles ahead). So the compiler runs incrementally:
each time the engine is about to extend the realized window for the source, we
(re)compile the follower's score for that same window and replace the follower's
score *for not-yet-realized ticks only*. Because we only ever rewrite the future
(never already-queued events), this respects the cycle-local queue rule by
construction. This "recompile the future window" step is the single new seam in the
transport layer, and it is small, pure-fed, and append-only — not a control-flow
rewrite. It is the thing to design and test most carefully (now the *only*
medium-risk item; see revised §8).

### 0.5 Latency / "instant start" is preserved

Because triggers are computed from resolved cycles in the lookahead window (which
is ahead of the playhead), a launch tick computed for "the rest on beat 3" is
placed exactly at that rest's reference tick — sample-accurate, not approximated,
and identical in preview and audio. "Instant" is exact, same as the original
approach, but without touching the scheduler core.

### 0.6 Trade-off to accept

A triggered follower can only react to source events **within the current
lookahead window** (~2 cycles ≈ the realize-ahead horizon). For musical triggering
(react next cycle / next beat boundary) this is exactly right. It cannot do
"react within 5ms of *this* instant to something happening *right now*" — but that
is live-input territory, already out of scope (§11), and the rejected approach
couldn't do it either. No musical capability in the feature request is lost.

The remainder of this document (data model §4, taxonomy §5, edge cases §6, UI §7,
testing §9, phases §10) applies to **this** architecture with one substitution:
wherever the old text says "the dependency-ordered realization driver launches the
track," read "the TriggeredScoreCompiler emits the launch into the follower's
compiled score." The revised risk register (§8) and phasing notes below reflect the
lower risk.

---

## 1. Concept & vocabulary

- **Continuous track** (today's behavior): free-runs cycle after cycle on the
  shared reference timeline, at global or track-local tempo/cycle.
- **Triggered track** (new): does not free-run. It is *armed* and waits. When a
  **trigger** fires, the track **launches**: it starts realizing from its own
  beat 0 at a launch tick derived from the trigger. It runs for a bounded
  **lifetime** (one pass, or N repeats, or until a stop condition), then returns
  to *armed*. While running it may **re-trigger** (restart from 0) or **ignore**
  further triggers, per configuration.
- **Source track**: the track a trigger condition observes. Usually a different
  track; self-reference is disallowed (see §6).
- **Trigger condition**: a predicate evaluated against *resolved* events of the
  source track at a specific musical location (e.g. "beat 3 of the source is a
  rest"). The full taxonomy is in §5; it is designed to grow.
- **Launch alignment**: where the triggered track's beat 0 lands relative to the
  trigger (at the triggering event's tick, at the source's next beat/cycle
  boundary, etc. — §4.3).
- **Lifetime / repeats**: how long the track runs once launched (§4.4).
- **Re-trigger policy**: what a new trigger does while already running (§4.5).

### Worked example (from the feature request)

Track 1 is continuous. Track 2 is triggered, 2 beats long, condition = "beat 3 of
Track 1 resolves to a rest", alignment = "at the rest", lifetime = "1 pass",
re-trigger = "restart". Each time a cycle of Track 1 resolves with a rest on
beat 3, Track 2 launches at that rest tick, plays its 2-beat pattern once, and
re-arms. If two qualifying rests occur before Track 2 finishes, the second
restarts it from beat 0.

---

## 2. Alternative considered & REJECTED: resolve triggers inside the scheduler

> **This section is retained for the record. It is NOT the recommendation — see §0.**
> It resolves triggers at realization time by rewriting the per-track free-run loop
> into a dependency-ordered driver. It works, and the determinism argument is sound,
> but it concentrates four HIGH risks on the realize→queue→parity pipeline. §0's
> "compiled launches" design achieves the same musical behavior and the same exact
> latency while leaving that pipeline untouched, so we prefer it.

This is the load-bearing choice of the rejected approach; everything in §3 follows
from it.

The scheduler already realizes cycles **ahead** of the playhead. Continuous
parallel tracks are realized by `realize_parallel_until(config, target_tick, …)`
in `crates/cseq-transport/src/lib.rs`, which advances *each track independently*
to a `target_tick` and maps each track's local ticks onto a shared reference
timeline; the single-track path stays "2 cycles ahead" (`scheduler_loop`). Ratchet,
ornament, channel hocket, accent, and all playback **metadata** are computed
during realization (`realize_and_enqueue` → `CyclePlaybackEvents`), then the
finalized cycle's events are appended to the scheduler queue. Per
`TIMELINE_AUDIO_PARITY_POSTMORTEM.md`, queue rewrites must be **cycle-local**:
finalize a temporary cycle, record metadata from it, then append.

Because resolution is deterministic under locked seeds, **a trigger that will
fire is knowable at the moment the source cycle is realized** — which is ahead of
playback. So we evaluate trigger conditions against the source track's *just-
realized* cycle and launch the triggered track in the same realization pass. We do
**not** wait until audio playback hears the rest. Consequences:

- Timeline preview and MIDI stay identical (both derive from the same realized
  data) — the parity invariant holds for free.
- No real-time scramble to inject a track mid-audio-callback; the triggered
  track's launched cycles are normal realized cycles appended to the queue.
- "Instant" start is exact: the launch tick is computed from the trigger event's
  resolved tick on the reference timeline, not approximated live.

The cost: realization is no longer fully independent per track. We must realize in
**reference-tick order across tracks** so a source cycle is resolved before the
triggered track that depends on it is asked to fill the same span. §3 handles
this with a dependency-ordered realization scheduler. This is the single biggest
change from today's "each track free-runs in its own loop" model.

### Why not audio-time triggering?

Audio-time triggering (evaluate as the playhead passes the rest, then start the
other track) was considered and rejected: it (a) breaks timeline/audio parity (the
preview can't know the future), (b) forces a real-time queue rewrite that
`AGENTS.md` explicitly warns against, and (c) makes determinism/seeding far
harder. The only case that *requires* audio-time evaluation is triggering on
**live external input** (e.g. incoming MIDI), which is explicitly out of scope for
v1 (§11) and, if ever added, would be a separate "live arm" path.

---

## 3. Engine architecture

### 3.1 Realization becomes dependency-ordered

Today each track advances in its own `while realized_up_to_reference_tick <
target_tick` loop, independently. We replace the per-track loops with a single
**reference-tick-ordered** realization driver:

```
realize_until(target_tick):
  loop:
    pick the track+cycle with the smallest next-unrealized reference_start_tick
      among tracks that are *ready* to realize that span
      (continuous: always ready; triggered: ready only if armed-and-launched
       for a launch_tick <= that span, else it contributes no cycles)
    if none remain below target_tick: break
    realize that one cycle (existing realize_and_enqueue path, unchanged)
    record its CyclePlaybackEvents (incl. resolved rests/notes for trigger eval)
    feed the just-resolved cycle into the TriggerEvaluator (§3.3), which may
      arm/launch/restart triggered tracks whose source is this track
```

Continuous tracks behave exactly as before (they're always "ready" and ordered by
reference tick). Triggered tracks only produce cycles once launched, and their
launched cycles are realized in tick order interleaved with everyone else.

Determinism: the realization order is a pure function of (scores, seeds, trigger
config). Ties (two tracks with equal next reference tick) break by a fixed key
(priority rank, then track index) so the order is stable and reproducible — this
is a new invariant we must test (§9).

### 3.2 New runtime state on a triggered track

Extend `ParallelRuntimeTrack` (and leave continuous tracks using the existing
fields):

```rust
enum TrackRunMode {
    Continuous,
    Triggered(TriggeredRuntime),
}

struct TriggeredRuntime {
    armed: bool,                 // waiting for a trigger
    // Active run, if launched:
    launch_reference_tick: Option<u64>, // where this run's beat 0 sits on the reference timeline
    run_cycles_done: u32,        // completed local cycles in the current run
    run_cycle_budget: RunBudget, // how many cycles/repeats this run lasts (resolved at launch)
    last_trigger_fingerprint: Option<u64>, // dedupe identical triggers in one span
    rng_for_launch: ...,         // seed stream for this run (see §3.5)
}
```

`launch_reference_tick` replaces the implicit `realized_up_to_reference_tick`
free-run base for triggered tracks: a launched triggered track maps its local
cycle 0 to `launch_reference_tick`, local cycle 1 to `launch_reference_tick +
local_cycle_duration`, etc., until its budget is exhausted, then it re-arms.

### 3.3 The TriggerEvaluator

A pure module (testable in isolation, no scheduler/audio deps) — strong candidate
for its own file `crates/cseq-transforms/src/triggers.rs` or a new `cseq-trigger`
crate (decision in §10):

```
struct TriggerContext<'a> {
    source_track_index, source_track_id,
    source_cycle, source_reference_window: (start_tick, end_tick),
    resolved: &'a CycleResolution, // beats, gati, rests, accents, jathi, note groups
    reference_tpc, source_local_tpc,
}

fn evaluate(condition: &TriggerCondition, ctx: &TriggerContext)
    -> Option<TriggerFire>  // None = did not fire; Some carries the fire tick + which event matched
```

`CycleResolution` is the resolved description of a cycle the engine already
produces for the timeline (beats with gati/section-start/jathi/accent, and — what
we must ensure is exposed — **rest vs sounding** per beat/matra and note-group
boundaries). If today's `CyclePlaybackEvents` doesn't already carry rest
positions in a form the evaluator can read, surfacing that is a Phase-1
prerequisite (§8, Risk R2).

A `TriggerFire` yields a **reference tick** for the matched event (e.g. the rest's
onset tick), which combines with launch-alignment (§4.3) to produce
`launch_reference_tick`.

### 3.4 Per-cycle / multi-trigger semantics

A single source cycle can contain several qualifying events (two rests). The
evaluator returns *all* fires in tick order; the triggered track's re-trigger
policy (§4.5) decides what each does. We dedupe identical fires within a span via
`last_trigger_fingerprint` so re-realizing the same cycle (transport reapply,
§8 R4) doesn't double-launch.

### 3.5 Seeding & determinism

A launched run needs reproducible stochastic choices. Today seeds are per-track
and per-cycle (`mix_seed(base, cycle)`), with locked / per-cycle / history modes
(`AGENTS.md`). For a triggered run we derive the run's seed stream from the
track's base seed **mixed with the launch identity** so that the *same* trigger
always yields the *same* run, but different launches differ:

```
run_seed = mix_seed(track_base_seed, launch_reference_tick ^ source_cycle ^ run_index)
```

This must be specified exactly and frozen with a regression test (§9), because it
extends the seed-path replay machinery we already hardened
(`SEED_PATH_PARALLEL_FIX_PLAN.md`). Seed-path trace events for a triggered run
carry the track id (already supported) **plus** the launch tick so replay can
reproduce launches, not just per-cycle rolls.

### 3.6 What stays unchanged

- `realize_and_enqueue` and the rhythm/ratchet/ornament/hocket pipeline: a
  launched cycle is realized exactly like any other cycle. Triggers gate *whether*
  and *where* a cycle is realized, never *how*.
- Cycle-local queue discipline (`AGENTS.md`): launched cycles are finalized in a
  temp queue, metadata recorded, then appended — same as today.
- Channel-conflict / hocket across tracks: a launched triggered track's events
  participate in conflict resolution like any other track's events for the ticks
  they occupy.

---

## 4. Data model (track configuration)

All new fields live on the per-track patch (`ParallelTrackPatch` in
`ui/src/patchIo.ts`, mirrored by the Tauri DTO in `src-tauri/src/main.rs`, and the
runtime `ParallelTrackPatch`/`ParallelRuntimeTrack` in `cseq-transport`). New
fields are **optional with continuous-mode defaults** so every existing patch and
saved `.caesura-track` loads unchanged (back-compat is a hard requirement; see §8
R5 and the schema-version note).

### 4.1 Mode
```
trackMode: "continuous" | "triggered"   // default "continuous"
```

### 4.2 Trigger source + condition
```
trigger: {
  sourceTrackId: string,            // must reference another existing track
  condition: TriggerCondition,      // §5 (a tagged union, extensible)
  // optional gate: only evaluate when these are also true
  guards: TriggerGuard[],           // §5.4 conditionals (AND-combined)
}
```

### 4.3 Launch alignment
```
launchAlignment:
  | "atEvent"            // beat 0 at the matched event's tick (the rest)
  | "atSourceBeat"       // at the source's next beat boundary
  | "atSourceCycleStart" // at the source cycle's start
  | "atNextReferenceBeat"// at the next global/reference beat
  | { "afterEventTicks": n }  // matched tick + n ticks (quantized, non-negative)
```

### 4.4 Lifetime / repeats
```
lifetime:
  | "onePass"                 // run exactly one local cycle (or one "length", §4.6)
  | { "repeats": n }          // run n local cycles then re-arm
  | "untilStopCondition"      // run until a stop condition fires (§5.3), capped by maxRepeats
maxRepeats: number            // hard safety cap (default e.g. 64) — never unbounded
```

### 4.5 Re-trigger policy (while already running)
```
reTrigger:
  | "restart"   // new qualifying trigger resets the run to beat 0
  | "ignore"    // ignore triggers until the current run finishes, then re-arm
  | "queue"     // finish current run, then immediately launch once more (depth 1)
```

### 4.6 Length model (independent of global/local cycle)
A triggered track's "length" need not equal a cycle. Support:
```
length:
  | "scoreCycle"               // its own score's natural cycle length (default)
  | { "beats": n }             // a fixed n-beat phrase (n need not divide the global cycle)
  | "conditionalLength"        // length resolved per-launch by a rule (§5.5), capped
```
A 1- or 2-beat triggered track is just `{ "beats": 1|2 }`. Conditional length
defers to a small resolver evaluated at launch (kept bounded and deterministic).

### 4.7 Persistence / schema
- These fields extend the v3 patch envelope additively. Because they are optional
  with defaults, **no schema-version bump is required** for load (a v3 patch
  without them is a valid continuous project). We will, however, add normalizer
  coverage so malformed/partial trigger config is coerced to safe continuous
  defaults rather than throwing (extends `patchIo.resilience.test.ts`).
- `.caesura-track` export already carries the whole `ParallelTrackPatch`, so a
  triggered track exports/imports its trigger config for free — **except** that
  `sourceTrackId` references another track that may not exist in the destination
  project. On import, `spliceImportedTrack` must **null out / disable** a dangling
  `sourceTrackId` (fall back to continuous, or armed-but-unsourced) exactly as it
  already strips foreign seed-path track ids. New edge case to add to the track
  import tests.

---

## 5. Trigger condition & conditional taxonomy (extensible)

The condition is a **tagged union** so new kinds are additive (new variant +
evaluator arm + UI row + tests), never a breaking change. v1 ships a useful core;
the rest are designed-for. Group them by what they observe.

### 5.1 Rhythm / event conditions (observe resolved source events)
- `beatIsRest { beat }` / `beatIsSounding { beat }` — the request's leading
  example. Generalize to `beatAt(beat)` predicates.
- `matraIsRest { beat, matra }` / `matraIsSounding { … }` — sub-beat granularity.
- `restCountInCycle { op, n }` — e.g. ">= 2 rests this cycle".
- `noteGroupCount { op, n }`, `longestRestAtLeast { matras }`.
- `accentAtBeat { beat }`, `sectionStartAtBeat { beat }`,
  `jathiPulseAtBeat { beat }` — observe accent/section/jathi resolution.
- `gatiIs { beat, gati }` / `gatiChangedAtBeat { beat }`.
- `ratchetFiredAtBeat { beat }`, `ornamentAtBeat { beat }` — observe playback
  decorations (note: these are realized too, so observable).
- `channelHocketRoutedTo { beat, channel }`.

### 5.2 Structural / positional conditions
- `everyNthCycle { n, phase }` — fire on source cycles n, 2n, … (a "clock divider").
- `onSourceCycleStart` / `onSourceSectionStart`.
- `firstCycleOnly`, `afterCycle { n }`, `cycleInRange { lo, hi }`.

### 5.3 Stop conditions (for `untilStopCondition` lifetimes)
Same predicate space, evaluated to *end* a run instead of start one:
- `stopWhenSourceRestAtBeat { beat }`, `stopAfterSourceCycles { n }`,
  `stopWhenSourceSilentForCycles { n }`.

### 5.4 Guards / conditionals (AND-combined gates on a trigger)
A trigger only fires if its condition matches **and** all guards pass:
- `sourceTempoInRange { minBpm, maxBpm }`, `globalCycleIs { beats }`.
- `sourceGatiIn { set }`, `probability { p, seedScope }` (stochastic gate —
  deterministic under seed), `cooldownCycles { n }` (debounce: ignore re-fires
  for n source cycles), `onlyWhenArmed` (implicit), `notWhileRunning` (implicit
  alternative to reTrigger=ignore).
- `combine: all | any` at the top level so guards can be OR-grouped later.

### 5.5 Conditional length resolvers (for `conditionalLength`)
- `lengthFromSourceRestCount { base, perRest }`,
  `lengthFromSourceGati`, `lengthMatchSourceSectionLength`,
  `lengthRandomInRange { lo, hi, seedScope }` (deterministic).

> **Design rule:** every variant must be (1) evaluable from already-resolved
> cycle data (no new audio-time info), (2) deterministic under locked seeds, and
> (3) bounded (no condition can cause unbounded realization). A variant that can't
> meet all three is rejected or deferred.

---

## 6. Invariants, edge cases & failure modes

These are the things most likely to break; each becomes a test (§9).

1. **No cross-feeding loops.** `sourceTrackId` must form a DAG. Track A triggered
   by B, B triggered by A is illegal; A triggered by B where B is triggered by C
   is fine. Detect cycles in the trigger graph at config-normalize time and at
   runtime-config build; on a cycle, the offending edge is disabled (continuous
   fallback) with a surfaced warning. **Self-trigger disallowed.**
2. **Bounded realization.** Triggered tracks must not let `realize_until` spin: a
   track that re-triggers every span could, in principle, realize forever within
   a window. The reference-tick-ordered driver only realizes spans `< target_tick`
   and each launched run is capped by `maxRepeats`; assert progress (every
   iteration advances some track's reference tick) to prevent infinite loops.
3. **Triggered length not dividing the cycle.** A 2-beat track against an 8-beat
   global cycle: its local ticks map onto the reference timeline by duration, not
   by cycle alignment. Reuse the existing local-tempo/tick mapping
   (`map_parallel_queue_ticks`, `ParallelTrackTimingWindow`) — a triggered run is
   just a sequence of local cycles based at `launch_reference_tick`. Verify no
   assumption that track tpc divides reference tpc.
4. **Transport reapply / re-realization** (`AGENTS.md`, parity postmortem). When
   the user edits during playback and the engine discards+re-realizes from a
   cutoff tick, triggered launches must be **recomputed identically** from the
   re-resolved source cycles — hence the launch fingerprint/dedupe and seeding by
   launch identity. A reapply must not drop or duplicate an in-flight triggered
   run. This is the highest-risk interaction.
5. **Back-compat.** Every existing patch/`.caesura-track` loads as continuous; the
   normalizer fills defaults; no schema bump for load. Round-trip + idempotence
   tests must include trigger config and the dangling-`sourceTrackId` import case.
6. **Re-trigger vs lifetime interaction.** `reTrigger:"restart"` + `repeats:n`:
   a restart resets `run_cycles_done` to 0 and re-resolves the budget. `ignore`
   must truly ignore (no fingerprint update that would suppress a later legit
   trigger after re-arm). `queue` depth is capped at 1.
7. **Two triggers in one source cycle** with `restart`: the *later* tick wins for
   that cycle (the run restarts at the second qualifying event). Order is
   tick-ascending and deterministic.
8. **Source track muted/soloed.** Does muting the source suppress triggers?
   **Decision:** triggers observe *resolved structure*, which exists regardless of
   audibility, so **mute does not suppress triggering** by default (a muted clock
   track still drives its triggered followers). Provide a guard
   `onlyWhenSourceAudible` for users who want the opposite. Soloing another track
   that mutes the source likewise does not stop triggers. (This is a real product
   decision — flag for confirmation in §12.)
9. **Triggered track as a conflict participant.** Its launched events route through
   channel hocket / conflict resolution for the ticks they occupy; a launched run
   overlapping a continuous track is normal N-track conflict, already handled.
10. **Empty / zero-length resolution.** A triggered track whose conditional length
    resolves to 0 beats, or whose score is empty, must no-op safely (re-arm
    without emitting), never divide-by-zero (`track_tpc == 0` already guarded).
11. **Preview/timeline of an armed-but-not-fired track.** The timeline must show a
    triggered track as armed/idle (no ghost notes) until launched, then show its
    launched cycles. Preview is generated from the same realized data, so this is
    automatic — but the **UI must visually distinguish** armed vs running (§7).

---

## 7. UI / interaction

Keep it minimalist and consistent with the existing per-track tools (the BPM/Cycle
mode selectors are the precedent).

- **Mode selector** per track: `continuous | triggered` (next to the existing
  BPM/Cycle mode dropdowns). Selecting `triggered` reveals a compact trigger
  panel; `continuous` hides it.
- **Trigger panel** (only when triggered):
  - Source track picker (lists other tracks; excludes self; warns on dangling).
  - Condition builder: a single condition row to start (kind dropdown + its
    parameters), with "add guard" to append AND-ed guards. The kind dropdown is
    driven by the taxonomy so new variants appear automatically.
  - Launch alignment, lifetime (+ repeats / maxRepeats), re-trigger policy,
    length model — as compact selects/number fields (reuse `NumericField`,
    `SliderField`).
- **Timeline rendering**: a triggered track's lane shows an *armed* state
  (dim/placeholder) between runs and renders launched cycles where they land
  (which may not align to global cycle gridlines — the lane must tolerate
  off-grid placement, which the parallel timeline already does for local-tempo
  tracks). A small "triggered by → Track N" affordance on the track header.
- **Playback locks**: like other structure controls, trigger config is locked
  while playing (consistent with cycle-length/topology locks in
  `transport-and-locks`).
- **Discoverability**: the track-mode selector and a one-line explainer; full
  taxonomy documented in `README.md` / `docs/UI_AND_INTERACTION.md`.

---

## 8. Risk register — REVISED for the §0 "compiled launches" architecture

The four HIGH risks of the rejected approach (old R1–R4: free-run-loop rewrite,
hot-path rest threading, launch-identity seeding surviving replay, in-flight reapply
state) **do not exist** in the recommended design — §0.3 explains why each is
eliminated or reduced to ordinary work. What's left:

- **R1 (was the only structural risk) — The "recompile the future window" seam in
  the transport layer (MEDIUM).** This is the one new touch to transport code (§0.4):
  before the scheduler extends the realized window for a follower, swap in the freshly
  compiled follower score for *not-yet-realized ticks only*. Mitigations: (a) it is
  append-only/future-only by construction, so it cannot rewrite queued events
  (respects the cycle-local rule); (b) reuse the **existing** "score changed → discard
  stale future + re-realize from cutoff" path the engine already has for edited tracks
  — we are invoking proven machinery, not inventing queue surgery; (c) a continuous-
  only golden test still guards that non-triggered projects are byte-identical.
- **R2 — Compiler/evaluator determinism (LOW).** Both are pure functions; determinism
  is established by unit/property tests in isolation (no scheduler involved). Seeding
  is per-cycle as today once the score is compiled — no new replay machinery.
- **R3 — Back-compat / persistence (LOW/MEDIUM).** Optional-with-defaults fields +
  normalizer resilience + dangling-`sourceTrackId` import handling. Standard, and the
  test harness already covers this shape (`patchIo.resilience.test.ts`, track
  import/export tests).
- **R4 — Boundedness / perf (LOW/MEDIUM).** The compiler emits at most `maxRepeats`
  launches per window and only over the bounded lookahead, so there is no spin risk in
  the scheduler at all; a pure property test asserts the compiled score length is
  bounded by config. Recompiling each window has a cost — keep the compiler cheap and
  only recompile when the source window or config actually changes (cache by
  source-resolution fingerprint).
- **R5 — UI off-grid lane rendering (LOW).** The follower is a normal local-cycle
  track to the timeline; off-grid placement is already handled for local-tempo tracks.
- **R6 — Window-boundary launches (LOW, design-it-in).** A trigger event near the end
  of the lookahead window must compile a launch that may extend past the window; the
  incremental compiler must carry the in-progress launch's remaining length into the
  next window's compile. Covered by a property test (compile window [0,W] then [W,2W]
  equals compile [0,2W] for the follower — a "windowing is associative" invariant).

Net: **zero HIGH risks**, one MEDIUM seam that reuses existing machinery, the rest
LOW and squarely in the test harness's wheelhouse.

---

## 9. Testing requirements (test-first, per `docs/TESTING.md`)

The trigger evaluator and config normalization are **pure** → heavy unit/property
coverage. The scheduler integration → Rust integration tests. The UI flow →
Playwright. Determinism → golden/regression tests. Concretely:

### 9.1 Rust unit (TriggerEvaluator — pure, write first)
- Each v1 condition variant: fires exactly when expected against hand-built
  `CycleResolution` fixtures (rest on beat 3 fires `beatIsRest{3}`; no rest does
  not; etc.). Table-driven.
- Guards AND/OR-combine correctly; cooldown debounces; probability gate is
  deterministic under a fixed seed.
- Multi-fire ordering is tick-ascending; fingerprint dedupe suppresses identical
  re-evaluation.
- Launch-alignment math: each alignment maps the matched tick to the correct
  `launch_reference_tick` (including `afterEventTicks` quantization and non-
  division-by-cycle cases).
- Conditional-length resolvers return bounded, deterministic lengths; 0-length
  no-ops.

### 9.2 Rust property tests (`proptest`, the codebase already uses it)
- **Boundedness:** for arbitrary trigger configs + scores + seeds,
  `realize_until(target)` terminates and realizes only spans `< target`
  (progress/anti-spin property).
- **Determinism:** realizing the same (scores, seeds, config, target) twice yields
  identical queues + metadata (byte-equal). Re-running after a simulated reapply
  from a cutoff yields identical *future* events (the R4 property).
- **DAG safety:** random trigger graphs never deadlock; cycles are detected and
  disabled, never hang.
- **No-source-mutation:** triggered tracks never mutate the source's resolved
  rhythm tree (parallels the ratchet/hocket "playback-only" invariants).

### 9.3 Rust integration (scheduler)
- Continuous-only golden test (R1): existing parallel fixtures realize
  byte-identically before/after the driver refactor.
- The worked example (§1) end-to-end: Track 1 continuous with a beat-3 rest,
  Track 2 triggered 2-beat onePass restart → assert Track 2's launched events
  appear at the rest tick, exactly once per qualifying cycle, with correct local
  ticks.
- Repeats / untilStopCondition / re-trigger policies each get a scenario asserting
  cycle counts and re-arm timing.
- Triggered length not dividing global cycle: tick mapping correct.
- Transport reapply mid-run (R4): edit during an active triggered run, assert no
  dropped/dupe events past the cutoff.

### 9.4 Frontend unit (vitest)
- **patchIo normalization/resilience:** trigger config round-trips and is
  idempotent; malformed/partial trigger config coerces to safe defaults (extend
  `patchIo.resilience.test.ts`); a triggered track with a dangling `sourceTrackId`
  imported via `spliceImportedTrack` falls back safely (extend the track
  import/export tests).
- **Bridge contract:** any new Tauri command/param for trigger config asserted in
  `bridge.test.ts` (command name + arg keys vs `src-tauri/src/main.rs`).
- **Extracted pure helpers:** any trigger-config derivation pulled out of App.tsx
  (e.g. "list of valid source tracks", "is this trigger graph acyclic") gets its
  own vitest spec (per the extraction norm).

### 9.5 Playwright e2e (stable suite)
- Switch a track to triggered, pick a source + condition, play, and assert the
  triggered lane shows armed→running and the expected events (driven through the
  Tauri mocks like `track-export-import.spec.ts`). Add to the scoped PR suite.

### 9.6 Fuzz (optional, nightly)
- Extend the structured score/transport fuzz targets to include trigger configs so
  libFuzzer explores condition/guard/length combinations against the boundedness
  and determinism properties.

### 9.7 Coverage / CI
- New pure modules (`triggers.rs`, any extracted TS) must come with tests under the
  diff-coverage ratchet. CI already runs all of the above.

---

## 10. Phased implementation — REVISED for §0 (each phase test-first, ships green)

The order front-loads the pure, isolatable pieces (where the test harness is
strongest) and defers the single transport seam until the logic it carries is
already proven. Every phase is independently mergeable and leaves all tracks
behaving as continuous until the very end, so partial progress can't ship a
regression.

- **Phase 0 — Spike & guardrail (no behavior change).** Confirm the existing pure
  preview resolver (`rhythm_preview` / `preview_frames_from_root`) exposes
  rest-vs-sounding + beat/matra positions the evaluator needs (it appears to —
  verify and, if a field is missing, add it to the *preview* output, not the hot
  loop). Write the **continuous-only golden test**: snapshot realized queues for the
  existing parallel fixtures so any later transport touch is provably
  non-regressing. Create the pure `cseq-trigger` crate (empty). *Recommendation
  stands:* a dedicated pure crate, not a module in `cseq-transforms`.

- **Phase 1 — Model & normalization (pure, no engine behavior).** Config types in
  `cseq-trigger`; patch fields in `patchIo.ts` + Tauri DTO + `cseq-transport`
  config; the normalizer (continuous defaults + DAG/self-trigger detection +
  resilience); back-compat / round-trip / resilience / dangling-source-import tests.
  Triggered config is parsed but **inert** (all tracks still realize continuously).

- **Phase 2 — `ResolvedCycle` adapter (pure).** A thin, pure function that turns the
  existing preview resolution into the `ResolvedCycle` view the evaluator consumes.
  Unit-tested against fixtures: "beat 3 is a rest" reads correctly, gati/accent/
  jathi/section-start/note-group boundaries are all legible. No scheduler.

- **Phase 3 — TriggerEvaluator (pure, the core).** v1 conditions/guards + launch
  alignment, producing launch ticks + per-launch length/seed. Full §9.1/§9.2 unit +
  property suite (fires-iff-expected, multi-fire ordering, guard combination,
  determinism). No scheduler.

- **Phase 4 — TriggeredScoreCompiler (pure, the heart of the new design).** Given a
  source `ResolvedCycle[]` over a window + config, emit the follower's effective
  score for that window (silence/phrase/silence, bounded by repeats/caps). Property
  tests: determinism; boundedness (≤ `maxRepeats` per window); the **windowing-is-
  associative** invariant (§8 R6: compile [0,W]+[W,2W] == compile [0,2W]); 0-length
  and empty-score no-ops. Still no scheduler — this is all pure data → data.

- **Phase 5 — The transport seam (the only MEDIUM-risk step, now de-risked).** Wire
  the compiler into the parallel realization path: when extending a follower's
  realized window, compile its score for that window from the source's resolution
  and feed it to the *existing* `realize_parallel_until` path; on edits, recompile
  and reuse the *existing* discard-stale-future-and-re-realize machinery. Guarded by
  the Phase-0 golden test (continuous unchanged) + §9.3 integration tests: the
  worked example, repeats/stop/re-trigger policies, off-grid length, and the
  transport-reapply-mid-run scenario. Because the seam is append-only/future-only
  and fed by a pure compiler, this is the proven-machinery path, not queue surgery.

- **Phase 6 — Bridge + UI.** Tauri command/DTO plumbing (+ bridge contract tests);
  the track-mode selector and trigger panel; timeline armed/running rendering;
  playback locks. §9.5 Playwright spec.

- **Phase 7 — Taxonomy expansion.** Remaining condition/guard/length variants behind
  the established pattern (variant + evaluator arm + compiler support if needed + UI
  row + tests). Open-ended; rides on normal feature work.

- **Phase 8 — Docs & verification.** Update `AGENTS.md` (new invariants: trigger DAG
  is acyclic/one-directional; follower scores are compiled upstream and never rewrite
  queued events; compiler/evaluator are pure and deterministic), `ARCHITECTURE.md`,
  `UI_AND_INTERACTION.md`, `README.md`, `GLOSSARY.md`. Full CI
  green; extend the structured fuzz target with trigger configs.

> Phases 0–4 (everything pure) carry **no** risk to existing behavior and constitute
> the bulk of the logic. The only step that touches the fragile pipeline is Phase 5,
> and it arrives with the logic already proven and the golden test in place.

---

## 11. Out of scope for v1

- Triggering on **live external MIDI / audio input** (would require an audio-time
  arm path; revisit separately — see §2).
- Triggers that observe a track's *own* output (self-trigger).
- Triggers across **separate projects**.
- Nested trigger depth beyond a small configured cap (deep chains realize fine but
  the UI/products should stay legible).

---

## 12. Open questions for product confirmation

1. **Mute semantics (§6.8):** confirm that muting the source track does *not*
   suppress triggers (with an opt-in `onlyWhenSourceAudible` guard). This is the
   one genuinely ambiguous product call.
2. **Default `maxRepeats`** safety cap value (proposed 64).
3. **Default re-trigger policy** (proposed `restart`, matching the worked example).
4. **Whether `everyNthCycle` clock-divider** ships in v1 (it's the most useful
   non-rhythm trigger and cheap) or waits for Phase 5.
5. **Conditional length** in v1 or deferred — it's the most complex length mode.
