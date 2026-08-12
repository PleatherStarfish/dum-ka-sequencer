# Timeline / Playback Parity Testing Plan

Living plan for the test strategy that keeps every **live timeline depiction** in
lockstep with **what the transport actually realized and played**. Background:
[TIMELINE_AUDIO_PARITY_POSTMORTEM.md](TIMELINE_AUDIO_PARITY_POSTMORTEM.md) (the
original re-hocketed-queue bug) and the history-seed rhythm-row divergence that
motivated Phase 1.

The invariant under test:

> During playback, every depiction of a realized result must derive from the
> **same realized data that produced the audio**. Preview re-derivation is only
> legitimate when stopped (arbitrary-cycle inspection), or when the preview is
> explicitly supplied the realized replay state.

---

## Phase 1 — landed (2026-06-22)

Single-cycle, rhythm-local regression coverage for the realized-rhythm-row path.
Promoted into the Phase 2 corpus (see below); kept here for provenance.

- **Data path:** `realize_and_enqueue` → `CyclePlaybackEvents.realized_rhythm`
  (`RealizedRhythmSpanEvent`, reusing `cseq_rhythm::ResolvedRhythmSpan`) →
  `PlaybackLayers.realized_rhythm` (`Retention::CycleWindow`) →
  `TransportSnapshot.realized_rhythm_events` → DTO `realizedRhythmEvents` →
  `bridge.ts`.
- **UI sourcing:** `useRhythmShaperState.rhythmBySpanId` uses
  `selectRealizedRhythmBySpanId` while playing (realized-only, scoped to visible
  cycle + active track), preview only when stopped. Runtime lane-source registry
  `TIMELINE_PLAYBACK_LANE_SOURCES` + `realizedRhythmEvents` as the 10th
  `playbackLayers.ts` descriptor row.
- **Tests:** 4 Rust parity tests in `cseq-transport` (rhythm-local history;
  followGlobal + global history single-cycle; seedPath replay; parallel
  tagging) built on the shared `rhythm_groups_from_resolved` /
  `groups_from_realized_rhythm_snapshot` / `rendered_note_groups` helpers; TS
  guardrail + `selectRealizedRhythmBySpanId` selector tests; DTO contract
  coverage; one e2e (`timeline-playback-parity.spec.ts`,
  "sources the live rhythm row from the realized snapshot") using mockTauri's
  `divergentRealizedRhythm` option.

**Phase 1 limitation carried into Phase 2:** the realized snapshot carries
realized *rhythm cells per span id*, but **not realized structural geometry**.
`groups_from_realized_rhythm_snapshot` recovers geometry by re-applying the
pipeline on a *pristine, identically-seeded* score — valid only because the
subdivision switch is locked (or history mode's cycle-0 draw is deterministic).
That trick does **not** generalize to multi-cycle structural divergence; see the
structural-divergence axis and its prerequisite below.

---

## Phase 2 — generalized parity oracle

**Goal:** generalize Phase 1 from "rhythm row, single cycle, rhythm-local
history" to every realized lane, across seed modes, transport boundaries, and
parallel/triggered topologies — without a cartesian explosion and without a
false `preview == realize` oracle.

### 2.0 Corrected oracle (read first)

Do **not** assert `preview == realize` for history / new-seed / any stateful
mode unless the preview call is explicitly given the **same `seedPath` +
`history-after` replay state** the transport used. A bare preview re-resolves a
different seed and will diverge by design — that is the bug class, not a check.

The **primary Phase 2 oracle is a three-way identity on normalized data:**

```
live timeline depiction  ==  transport-realized snapshot data  ==  queued / playback metadata
        (A)                            (B)                                  (C)
```

- **A** — the lane data the UI renders, taken from the model/selectors
  (`selectRealized*…`, `rhythmBySpanId`, etc.), not scraped from the DOM.
- **B** — `TransportSnapshot.*_events` (the realized snapshot layers).
- **C** — the actual enqueued MIDI / playback metadata for the cycle (note
  on/off ticks, channels, velocities, ratchet hits, grace placements). This is
  the ground truth the audio came from.

Preview is a **secondary** oracle, valid only when:
- the mode is **stateless** (locked / perCycle treated per-cycle / no Markov
  carry), **or**
- preview is invoked with the recorded `seedPath` + `history-after` so it
  replays the realized state. In that case `preview(replayState) == B == C` may
  be asserted.

`A == B` is the anti-regression core (it is what broke). `B == C` is the
audio-truth check (the snapshot must equal what played). `A == B == C` together
is the oracle.

### 2.1 Canonical normalized comparison format

Compare **normalized records**, never raw DOM or raw DTO shape. Each lane emits
a sorted list of records with a common header plus lane-specific fields. Sort key
is `(cycle, trackId, onsetTick, spanId?, …)`; all ticks are absolute (cycle base
+ in-cycle offset) so A/B/C are directly comparable.

Common header (every lane):

| field      | meaning                                              |
|------------|------------------------------------------------------|
| `cycle`    | cycle index                                          |
| `trackId`  | parallel/triggered track id, or `null` for single    |
| `onsetTick`| absolute start tick                                  |
| `endTick`  | absolute end tick (span), `null` if instantaneous    |
| `spanId`   | pulse-span id when the lane is span-anchored, else `null` |

Lane-specific additions:

- **rhythm:** `pattern` (pulse list) + `cells` normalized to
  `[{start,len,rest,tiedFromPrevious,tiedToNext}]`; `source`.
- **pitch:** `sourcePitch`, `pitch`, `transpositionSemitones`.
- **channel/hocket:** `channel`, `source`, `fallback`.
- **ratchet:** `count`, `curve`, `hits` as `[{index,onsetTick,endTick,velocity}]`.
- **ornament/grace/delay:** `kind`, `placement`, `count`, `delayTicks`,
  `delayQuantized`, `delayTuplet`, `targetRest`.

Each of A/B/C provides a normalizer to this format. The Rust oracle normalizes B
(snapshot structs) and C (the `VecDeque<QueuedEvent>`); the TS layer normalizes A
(selector output) and B (DTO) — and a cross-language fixture pins that Rust-B and
TS-B agree (extends the existing `__fixtures__/dto` contract).

### 2.2 Metamorphic relations (corrected)

Let `realize(0..N)` mean "cold start, realize cycles 0 through N in order" and
`startAt(N)` mean "begin realization directly at cycle N".

1. **Determinism / reproducibility.** Two cold runs from the *same configured
   state* produce identical normalized B and C for every cycle. (Holds for all
   modes; this is the baseline and already exercised by the multilayer
   determinism tests — fold those into the corpus.)

2. **Start-anywhere — stateless modes.** For **locked / perCycle / stateless**
   modes: `startAt(N).B(N) == realize(0..N).B(N)` and likewise for C. Per-cycle
   seed is a pure function of cycle index, so the skeleton and cells at N do not
   depend on the path taken to reach N.

3. **Start-anywhere — history / stateful modes.** Start-anywhere is valid **only
   when replayed from the recorded `seedPath` + `history-after` state captured at
   cycle N**. i.e. `startAt(N, replayState=recorded@N).B(N) == realize(0..N).B(N)`.
   Without the replay state, start-anywhere is **expected to diverge** and must
   **not** be asserted equal. Phase 1's seedPath-replay test is the cycle-0 case
   of this relation; Phase 2 extends it to N>0.

4. **Transport-boundary relations (no pause/resume exists — only `play`,
   `stop`, `resync`).** Pin the semantics explicitly per relation:

   - **`stop` → `play`, engine-only (no reconfigure):** `cycle` resets to 0 and
     realized layers clear, but the stored seed history is **preserved**
     (mutated state continues). The second run's cycle-0 output therefore
     **diverges** from the first run's cycle-0 in history modes. Assert
     *continuation*, not reset. (There is no seed-mode baseline/restore in the
     engine.)
   - **`stop` → `set_score`/`set_rhythm_playback` → `play` (the app's real
     path):** the fresh configs re-seed history to its configured initial state,
     so the second run **resets** and reproduces the first cold run. This is the
     reset relation and the baseline for replay. (App always re-applies before
     play — verified in `timeline-playback-parity.spec.ts`.)
   - **`resync` while playing (the only "resume-like" op):** `cycle` and seed
     history are **preserved**; only the forward queue is rebuilt from the
     current cycle. Assert that B/C for already-played cycles are unchanged and
     that cycles realized after resync continue the same history stream.

5. **Snapshot/queue agreement under windowing.** For any cycle inside the
   realized window, B and C agree (the `CycleWindow` retention must not drop or
   stale a cycle's realized data while it is still queued).

### 2.3 Structural-divergence axis (global history + rhythm followGlobal)

Phase 1 covered only the **cells-only** axis (rhythm-local history: span ids /
start / duration are fixed before the rhythm seed in `apply_rhythm_to_tree`).
Phase 2 **must** include the **structural** axis: the subdivision-switch
`seed_mode` in history / new-seed mode, with rhythm `followGlobal`, so the
**pulse-span skeleton itself diverges cycle to cycle**.

- **Oracle:** still `A == B == C`, but geometry now changes per cycle, so the
  test cannot recompute geometry by re-applying a pristine pipeline (the Phase 1
  trick). Two acceptable resolutions, pick per layer:
  1. compare against **C directly** — derive onsets/spans from the queued
     events for that cycle (ground truth, no re-resolution); or
  2. **extend the realized snapshot to carry realized structural geometry**
     (realized pulse spans, or absolute tick bounds per realized rhythm span) so
     B is self-describing.
- **Prerequisite (track explicitly):** the structural axis likely needs option
  (2) — adding realized geometry to the snapshot — or a queue-derived normalizer
  for (1). Decide this before writing the structural tests; it is the one real
  data-model change Phase 2 may require. Until then, structural-axis tests use
  the queue (C) as the geometry oracle.
- **Live-row requirement:** while playing in this mode, the timeline's section /
  pulse-span structure shown to the user must be realized-sourced for the visible
  cycle, not a preview re-resolve — the same rule as the rhythm cells, applied to
  the skeleton.

### 2.4 Test matrix — corpus + pairwise (no cartesian explosion)

**Step 1 — promote Phase 1 regressions into a corpus.** Each Phase 1 scenario
(and the existing determinism/seedPath tests) becomes a named fixture in a shared
corpus: `{ id, score config, rhythm config, transport script, expected A/B/C }`.
The corpus is the per-PR floor and the seed for everything below.

**Step 2 — targeted pairwise coverage.** Cover the factor interactions with an
all-pairs (pairwise) selection, not the full product. Factors:

- **Seed mode:** locked · perCycle · rhythm-local history (+newSeedWeight) ·
  global history + rhythm followGlobal · seedPath replay.
- **Topology:** single track · parallel (≥2, with channel conflict) · triggered.
- **Transport op:** cold start · start-anywhere(N) · resync · stop→reconfigure→play.
- **Lane focus:** rhythm · pitch · channel/hocket · ratchet · ornament.

A pairwise set over these factors is ~12–16 cases (vs. hundreds cartesian).
Representative pairs to guarantee:

| case | seed mode | topology | transport op | lane focus |
|------|-----------|----------|--------------|------------|
| P1 | rhythm-local history+newSeedWeight | single | cold start | rhythm |
| P2 | global history + followGlobal | single | start-anywhere(N, replay) | rhythm+structure |
| P3 | seedPath replay | parallel | cold start | pitch |
| P4 | perCycle | parallel | resync | channel/hocket |
| P5 | locked | triggered | start-anywhere(N) | ratchet |
| P6 | rhythm-local history | triggered | stop→reconfigure→play | ornament |
| P7 | global history + followGlobal | parallel | resync | rhythm+structure |
| P8 | seedPath replay | single | start-anywhere(N, replay) | rhythm |
| P9 | perCycle | single | cold start | ornament+pitch |
| P10 | locked | parallel | cold start | all lanes (smoke) |

Each case asserts the 2.0 oracle on the 2.1 normalized format, choosing the
2.2 relation that matches its transport op (and only asserting preview where
2.0 permits).

### 2.5 Implementation split by layer

1. **Rust differential oracle (bulk of Phase 2).** In `cseq-transport`, around
   `realize_and_enqueue` + the snapshot layers. Normalize B (snapshot structs)
   and C (`QueuedEvent` queue) to 2.1, assert `B == C` per cycle, and run the
   2.2 metamorphic relations. This is where seed modes, transport boundaries,
   parallel/triggered, and the structural axis are exercised — fast, hermetic,
   no browser. Preview equality only with replay-state-matched inputs.

2. **TS selector/model tests (`vitest`).** Prove **A is realized-sourced while
   playing and preview-sourced while stopped**, for every lane — generalize the
   Phase 1 `selectRealizedRhythmBySpanId` test and the
   `TIMELINE_PLAYBACK_LANE_SOURCES` guardrail to all lanes. Feed selectors the
   Rust-generated golden snapshot fixtures, normalize A and B to 2.1, assert
   `A == B`. Extend the DTO contract so Rust-B and TS-B normalizers agree.

3. **Minimal e2e smoke (`Playwright`).** DOM integration only — that the
   realized model reaches the rendered lanes — **not** the matrix. Keep to ~1–3
   tests (the existing rhythm-row parity test + at most one per additional
   realized lane), using mockTauri divergence options. The matrix lives in
   layers 1–2.

### 2.6 Per-PR vs nightly

**Per-PR (fast, deterministic, blocking):**
- Phase 1 corpus regressions (Rust + TS) — the floor.
- The 2.4 pairwise targeted set (~12–16 Rust oracle cases).
- TS selector/model `A == B` tests for all lanes + lane-source guardrail.
- DTO contract (Rust-B ↔ TS-B normalizer agreement).
- 1–3 e2e smoke tests.

**Nightly (broad / randomized / slow, non-blocking):**
- Property-based / fuzzed seeds and configs over the same oracle (random seed
  modes, random transition matrices, random cycle counts).
- Long-run start-anywhere and resync soak across many cycles (windowing /
  retention stress) and large parallel/triggered ensembles.
- Wider-than-pairwise sweeps (e.g. 3-wise) for the highest-risk factor groups.
- Mutation testing of the oracle/normalizers to confirm the suite actually
  fails when realized data and queue disagree.

Rationale: per-PR catches regressions in the known-risky interactions at
checkout speed; nightly explores the long tail and proves the oracle has teeth,
without making every PR pay for it.

---

## Open prerequisites / risks

- **Realized geometry in the snapshot (2.3).** The structural axis needs either a
  queue-derived geometry normalizer or a snapshot extension carrying realized
  pulse-span bounds. Decide before writing structural tests.
- **Pin transport-boundary semantics in code, not assumption (2.2.4).** The
  preserve-vs-reset behavior of `stop`/`play`/`resync` and the app's
  reconfigure-before-play path must each be asserted by a dedicated relation
  test, since they are subtle and currently only implied by the engine code.
- **Corpus is the contract.** Keep the corpus the single source of scenarios so
  per-PR and nightly exercise the same fixtures at different breadth.
