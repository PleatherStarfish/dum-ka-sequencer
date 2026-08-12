# Triggered Tracks — Upgraded UI Plan (banded inspector + live state)

**Status:** proposed · **Created:** 2026-05-30 · Builds on `docs/TRIGGERED_TRACKS_PLAN.md`
(v1 engine, shipped) and its review corrections (binding).

This plans the **WHEN / GATE / START / RUN** banded inspector, the live state
strip + event log, and the timeline overlays. It is deliberately honest about
the gap between the requested UI and the shipped engine, and it phases the work
so every visible control maps to a real engine capability (or is explicitly
disabled), never a fake.

---

## 0. Framing — the UI is a superset of the v1 engine

The requested UI describes capabilities the v1 engine does **not** yet have.
Shipped today (`cseq-trigger`): a single beat-anchored condition; one launch
alignment + optional quantize; lifetime/re-trigger/length; `maxRepeats`. The new
spec adds: multi-row boolean **WHEN** (subjects/operators/ALL/ANY/NOT), a
stateful+probabilistic **GATE**, conditional/weighted **START**, a richer
**RUN**, and a live **state model + event log + timeline overlays**.

The plan's job is therefore three things, not one:

1. **Map** each band to existing config, new pure-crate logic, or deferred work.
2. **Protect** the hard invariants (parity, determinism under seed, cycle-local
   /future-only, one-level DAG, the compiler's launch-tick ordering). The GATE
   rolls and the event log are the two places most likely to violate them.
3. **Phase** so each step ships green and the UI never exposes a control that
   the engine can't honor.

### The core principle is already in the data model

The spec's central idea — *"trigger accepted because…" is a separate decision
from "beat 0 placed because…"* — already maps onto the v1 split:
`condition`(+gate) decides **acceptance**; `launch_alignment`(+quantize) decides
**placement**; `lifetime`/`re_trigger`/`length` decide **the run**. The banded
UI makes that split visexplicit. We keep that separation load-bearing: WHEN+GATE
produce a *candidate + accept/reject*, START consumes an *accepted candidate*.

---

## 1. Data model evolution (`cseq-trigger::config`, additive + back-compat)

All new shape is `#[serde(default)]` + normalized, so every existing
`.caesura` patch and v1 `TriggerConfig` loads unchanged. v1 fields are retained
as the degenerate case of the richer ones.

```
TriggerConfig {
  source_track_id, observe,                 // observe: Structure | Rhythm | PostScore(deferred)
  when:  ConditionTree,                      // was: condition (single leaf)
  gate:  Vec<GateRule>,                       // NEW
  start: StartSpec,                           // was: launch_alignment + launch_quantize
  run:   RunSpec,                             // was: lifetime + re_trigger + length + max_repeats
}
```

- **`ConditionTree`** = `All(Vec) | Any(Vec) | Not(Box) | Leaf(Predicate)`.
  `Predicate { subject, position, operator, value }`. A v1 single condition is a
  one-`Leaf` tree (migration is a pure upcast; serialize old shape readable).
- **`GateRule`** (ordered, AND-combined): `Probability{p, roll_scope, seed_scope}`,
  `OneInN`, `Cooldown{cycles}`, `OnlyAfterMisses{n}`, `EveryNthAccepted{n}`,
  `ProbabilityBy{key, curve}`, `MemoryAbsentFor{cycles}`, `MemoryHappenedN{n}`,
  `StateIs{idle|running(deferred)}`. Each carries an explicit **roll scope**
  (`PerEvent | PerSourceCycle | PerLaunchIdentity`) and **seed scope**
  (`Global | Track | SourceCycle | Launch`).
- **`StartSpec`** = `Fixed(LaunchAlignment + Option<LaunchQuantize>)` (v1) |
  `Conditional(Vec<{when: ConditionTree, then: StartChoice}>, else)` |
  `Weighted(Vec<{weight, StartChoice}>, seed_scope)`. `StartChoice` adds the
  spec's musical placements (center-in-rest, end-phrase-at-return, rotate-accent
  /-cadence) as new variants.
- **`RunSpec`** = today's lifetime/re-trigger/length/max_repeats + `queue_depth`
  + `after_run` + `until_stop`(deferred, present-but-disabled).
- **`Observe`** = `Structure | Rhythm` (v1) | `PostScore` (deferred; disabled in
  UI). This is the spec's "Observe" control and it gates which subjects are
  selectable.

Normalization upcasts v1 → banded, clamps every numeric, and rejects/strips
predicates whose `subject` isn't legible under the chosen `observe` layer.

---

## 2. Engine work per band (what each row actually requires)

| Band | Lives in | New engine work | Parity/determinism note |
|---|---|---|---|
| **WHEN** | `evaluator` (ConditionTree eval) + `resolve` (adapter) | boolean tree eval; new subjects (Matra, RestSpan, NoteGroup, Accent, Cycle, count/duration/nth ops) need `ResolvedCycle` to expose matra-level rest/sounding, note-group spans, accent velocities, per-cycle counts | Pure; deterministic. **Multiple candidates per cycle** (e.g. `count in cycle`, multiple matching beats) breaks the current cycle-index dedup — see §4. |
| **GATE** | new pure `gate` module + compiler carry | stateful counters (cooldown/miss/memory) in `TriggerCarry`; **seeded probability rolls**; emits accept/reject + rolled value | **The determinism hot spot.** RNG must be seeded by the chosen scope, reproducible across recompile/reapply, and recorded in the seed-path (new trace domain). |
| **START** | `evaluator`/`compiler` | per-candidate conditional + **weighted (seeded) choice**; new placements need resolved-cycle context (rest-span bounds, source return tick, accent rotation) | Weighted/conditional START makes launch ticks **non-monotonic** in cycle order — breaks the compiler's early-break + dedup. See §4. |
| **RUN** | `compiler` (mostly exists) | `queue_depth>1`, `after_run`, `until_stop` | `until_stop` needs open-ended carry — deferred, stays disabled. |

The richer subjects/operators are designed-for in v1's tagged unions (variant +
evaluator arm + adapter field + UI row + tests), so they extend without breaking
shape — but several need the `ResolvedCycle` adapter to surface data it doesn't
today (matra rest map, note-group spans, accent velocity, jathi pulse list is
already there). That adapter work is the WHEN band's real cost.

---

## 3. The trust surface — state strip + event log come from the engine

This is the part most likely to be done wrong (a UI that *re-derives* state
diverges from what played). The rule, same as everywhere else: **the engine is
the single source of truth; the UI renders what the compiler decided.**

- `compile_window` already returns the authoritative launches. Extend its output
  with an ordered **decision trace**: `Vec<TriggerDecision>` =
  `{ source_cycle, beat, candidate_tick, gate_rolls: [{kind, value, threshold, scope, passed}], outcome: Accepted{launch_tick, beat0_tick, start_reason} | Rejected{reason}, state_after }`.
  This is a *by-product* of the same pure computation that produced the launches
  — so the log cannot disagree with the audio.
- The transport records that trace into a capped ring in `TransportShared`
  (exactly like `ratchet_events`/`seed_trace_events`) and exposes it +
  a per-track **current state** (`Continuous|Armed|Candidate|Running|Queued|Cooldown`,
  `next_source_cycle`, `gate_percent`) in `TransportSnapshot`.
- The UI's state strip and event log read only those snapshot fields. The track
  row's compact mode indicator reads the per-track current state.
- Cycle-local/future-only still holds: the trace describes the compiled
  not-yet-finalized window; on reapply it recomputes from cycle 0 identically.

Event-log line ("Cycle 14 beat 3: rest matched · roll 0.41 ≤ 0.62 · accepted ·
start at event") is a direct render of one `TriggerDecision`. Clicking a state
chip filters the ring to that track/cycle.

---

## 4. Two invariants the upgrade threatens (call these out in review)

These are the sharp edges; the plan commits to handling them before the
relevant band ships.

**(a) Launch-tick monotonicity (START band).** `compile_window` relies on launch
ticks being non-decreasing in source-cycle order (early `break` on
`>= window.end`, and `consumed_through_source_cycle` dedup). v1 + quantize
preserve this. **Conditional/weighted START does not** — a later candidate can
choose an earlier placement than an earlier one. Before START becomes variable:
refactor the compiler from "process fires in tick order with early-break" to
"resolve all candidate launch ticks for the window, then sort, then process,"
and bound start displacement to ±1 source cycle so windowing/carry stay bounded.
Re-prove the associativity + determinism property tests with variable START.
**✅ Done (Phase B/D):** the compiler already resolves-then-sorts with no
early-break (the future-fire branch explicitly does not `break`); Phase D's
placements are intra-cycle bounded (no extra clamp needed); and
`weighted_start_keeps_windowing_associative_and_trace_matches` re-proves
associativity (launches + carry + trace) under non-monotonic weighted START.

**(b) Per-cycle dedup (WHEN band).** `consumed_through_source_cycle` assumes one
candidate per source cycle. Subjects that match multiple beats / `count in
cycle` produce several candidates per cycle. Replace cycle-index dedup with
**candidate-identity dedup** (`(source_cycle, beat, predicate-hash)`), carried in
`TriggerCarry`. Keep it bounded.

Both are pure-crate refactors with property tests; neither touches the transport
seam. They are prerequisites for Phases B/D below, not Phase A.

**Determinism of GATE rolls.** Probability/miss-boost/curve introduce RNG. Derive
each roll's seed from `mix(track_base_seed, scope_key)` where `scope_key` is the
roll's identity under its seed scope (launch id / source cycle / event index) —
the same stable-identity mechanism launches already use. Record every roll in
the seed-path (new `trigger` domain) so replay/reapply reproduce exactly. The
compiler stays a pure function of `(config, source_cycles, seeds, carry)`.

---

## 5. UI architecture (React, `ui/src`)

- **`TriggerInspector`** — a new collapsible section/tab in the per-track
  inspector (evolve the current compact panel). Top strip: Mode · Source ·
  **Observe** (locked to structure+rhythm in v1) · live State summary.
- **Band components** `WhenBand` / `GateBand` / `StartBand` / `RunBand`, each
  dense and row-based, sharing **row primitives**: `SubjectSelect`,
  `OperatorSelect`, `ValueField` (numeric/select/set), `ProbabilitySlider`,
  `RollScopeMenu`, `SeedScopeMenu`, connector chips (ALL/ANY/NOT).
- **Data-driven row registry.** A pure table `SUBJECTS → allowed operators →
  value kind → observe-layer requirement`. Rows render from the registry, so a
  new predicate variant appears automatically and disabled subjects (post-score)
  grey out. This is the extensibility the spec asks for, without a node canvas.
- **`ConditionTreeEditor`** — indented ALL/ANY/NOT with chips (Match: All | Any |
  Custom). Custom reveals nesting. No graph until proven necessary.
- **`TriggerStateStrip`** + **`TriggerEventLog`** — read-only, snapshot-driven.
- **Presets** — pure `preset() -> TriggerConfig` builders that populate rows
  (Fill a rest / Launch next beat / Launch next cycle / Phase-locked shadow /
  Probabilistic fill / Cadence into return). No hidden modes.
- **Extracted pure helpers** (unit-tested per the codebase norm): condition-tree
  normalize/validate, config↔UI row mapping, preset builders, valid-source list,
  observe-layer subject filter. Mirrors `patchIo`'s `normalizeTriggerConfig` /
  `enforceTriggerGraph` / `parallelSilentSourceIds` pattern.
- **Locking** while playing (existing rule). **Mode indicator** on the track row
  from snapshot state.

Plumbing reuses the existing path: `bridge.ts` types ↔ `cseq_trigger` serde DTO
(embedded, so `src-tauri` is mostly free) ↔ `patchIo` normalization ↔
`buildParallelPlaybackRequest`.

---

## 6. Timeline overlays (`ui/src/timelineModel.ts` + snapshot)

Two layers per triggered track, all fed by the snapshot (no UI guessing):
- **Armed lane** — thin neutral line, no ghost notes.
- **Launch marks** — amber ticks at accepted candidate ticks (from the trace).
- **Running phrase** — the follower's realized notes (already surfaced).
- **Beat-0 marker** — a small downbeat tick on the follower lane at each launch's
  `beat0_tick` (the concept users most need to see).
- **Rejected candidates** — faint marks when "inspect" is enabled.
- **Debug connector** — a thin line `candidate_tick → launch_tick → beat0_tick`,
  the single most instructive overlay; gated behind an inspect toggle.

---

## 7. Phasing (each phase ships green + gets an adversarial review)

- **Phase A — Banded UI shell over the v1 engine (no engine change). ✅ IMPLEMENTED.**
  Built the four bands, rows, presets, state pill (armed/running from snapshot
  positions), Observe-locked top strip, and a per-track-row mode chip — exposing
  only controls the v1 engine honors: WHEN = one leaf row (Match=All shown,
  ANY/Custom disabled "later"); START = current alignments + quantize; RUN =
  current; GATE = a visible disabled band ("Phase C"); Observe locked to
  structure+rhythm. Presets populate v1-expressible configs; the three that need
  later phases (Launch next cycle, Probabilistic fill, Cadence into return) are
  disabled with roadmap tooltips. **Nothing lies.** Files: `ui/src/triggerUi.ts`
  (pure select↔config + preset builders, unit-tested in `triggerUi.test.ts`),
  `ui/src/TriggerInspector.tsx` (the banded component), wired into `App.tsx`
  (panel extracted; per-track-row chip in `parallelTrackTabs`), styles in
  `styles.css`, e2e in `tests/e2e/triggered-tracks.spec.ts`. No engine/config/
  bridge/patchIo change. The full live state strip + event log + timeline
  overlays land with Phase C/E (they need the engine decision trace).
- **Phase B — Multi-condition WHEN. ✅ IMPLEMENTED.** `WhenSpec { beats:
  BeatSelector, tree: ConditionNode }` is now the canonical condition; the legacy
  single `condition` upcasts to a one-leaf tree via `effective_when()`
  (`normalized()` folds it into `when` and clears `condition`, so canonical
  configs carry only `when`). `ConditionNode` = All/Any/Not/Leaf over
  `WhenPredicate` (IsRest, IsSounding, IsSectionStart, HasJathiPulse, GatiIs,
  MatraIsRest/Sounding, Rest/SoundingCountInCycle with a `CountOp`); bounded by
  `MAX_CONDITION_NODES`/`MAX_CONDITION_DEPTH` (over-large trees collapse to a safe
  `IsRest` leaf). `BeatSelector::AnyBeat` yields a candidate **per matching beat**
  — multi-candidate-per-cycle rides the existing `ConsumedFire (source_cycle,
  matched_beat)` identity dedup (§4b), no new mechanism. Adapter extension:
  `ResolvedBeat.matra_sounding`. Evaluation is per-beat (`eval_node`/
  `eval_predicate`); cycle-level count predicates gate every beat candidate.
  jathiPulse now anchors at beat-start (sub-beat onset is a START concern under
  the two-decision model). UI: the WHEN band is a flat tree editor — ALL/ANY
  combinator (Custom = engine-valid nested trees shown read-only with a Reset),
  per-row NOT, add/remove rows, at-beat / any-beat selector; every subject maps
  to a real predicate so nothing is faked. Files: `cseq-trigger` (`config.rs`
  types + clamps, `resolve.rs` matra map, `evaluator.rs` tree eval,
  `compiler.rs`/`lib.rs` wiring; 57 crate tests incl. a multi-candidate
  windowing-associativity property), `cseq-transport` (two seam tests: AnyBeat
  multi-candidate + an ALL-tree cycle-count veto), `ui/src/bridge.ts` (`When`
  types), `ui/src/patchIo.ts` (normalizers + legacy upcast + resilience),
  `ui/src/triggerUi.ts` (editor model + round-trip), `ui/src/TriggerInspector.tsx`
  (the tree editor), `styles.css`, e2e `triggered-tracks.spec.ts`
  (multi-condition tree → backend). Back-compat: a legacy `condition` config
  still loads and runs identically.
- **Phase C — GATE. ✅ IMPLEMENTED.** A pure `gate` module + a carried
  `GateState` (consecutive-miss streak + last-accept cycle) extend the compiler.
  `GateSpec { probabilityPerMille, cooldownCycles, missBoostPerMille, seed }`
  (optional on `TriggerConfig`; absent ⇒ always accept = pre-Phase-C behavior)
  gates each WHEN candidate **before** the re-trigger policy. The probability
  roll is seeded by **stable candidate identity** `(seed, source_cycle, beat)` —
  never a running counter — so it is window-split-independent and reproduces on
  recompile/reapply. Cooldown is a hard gate (no roll, leaves the streak);
  miss-boost adds to the threshold per consecutive miss (so a dry spell
  eventually launches). `compile_window` now also returns an ordered **decision
  trace** `Vec<TriggerDecision> { source_cycle, beat, candidate_tick, gate_rolls,
  outcome (Launched/Queued/Suppressed{reason}), gate_state_after }` — a *by-product
  of the same pure compute that produced the launches*, so the log can't disagree
  with the audio (§3). The transport flattens it into a capped
  `trigger_decision_events` ring in `TransportShared` + `TransportSnapshot`
  (mirroring `ratchet_events`), and emits a `trigger`-domain seed-path lineage
  entry. The UI GATE band is now editable (probability % · cooldown cycles ·
  miss-boost %, with an on/off toggle), `probabilisticFill` is a live preset, and
  a **LOG** band renders the engine's decision trace (the truthful event log).
  Determinism crux proven by a property test: a live gate over multi-candidate
  AnyBeat input keeps **launches, carry, and the decision trace** identical whole
  vs split. Files: `cseq-trigger` (`config.rs` `GateSpec`, new `gate.rs`,
  `compiler.rs` trace + loop, `lib.rs` re-exports + property test; 73 tests),
  `cseq-transport` (decision ring + snapshot + seed lineage + 3 gate seam tests;
  194 tests), `src-tauri` (`TriggerDecisionEventDto`), `ui/src/bridge.ts`
  (`TriggerGateSpec` + `TriggerDecisionEvent`), `ui/src/patchIo.ts`
  (`normalizeGateSpec`), `ui/src/triggerUi.ts` (gate helpers + preset),
  `ui/src/TriggerInspector.tsx` (editable GATE band + LOG), `App.tsx` (passes the
  filtered decision trace), `styles.css`, e2e. **The state strip + event log are
  now truthful.** Deferred to Phase E: timeline overlays + full seed-path
  lock/replay override (the gate is already replay-stable via identity seeding).
- **Phase D — Conditional/weighted START. ✅ IMPLEMENTED.** The monotonicity
  refactor (§4a) was already in place from the quantize work — `compile_window`
  resolves every candidate's launch tick, **sorts**, then processes (no
  early-break), so a non-monotonic placement is fine. Phase D adds two
  resolved-context placements — `CenterInRest` (beat 0 at the matched beat's
  midpoint) and `AtSourceReturn` (beat 0 at the source's next sounding onset
  within the cycle, else the event tick) — both **intra-cycle bounded**, so
  carry stays bounded without a new ±1 clamp. `TriggerFire` gained
  `matched_beat_end_tick` + `source_return_tick` to keep `launch_tick` a pure
  function of the fire. Weighted START: `StartSelect { options:
  Vec<WeightedStart { alignment, weight }>, seed }` (optional on `TriggerConfig`;
  supersedes `launch_alignment` when present + non-empty) picks one placement per
  candidate via an **identity-seeded** weighted roll `(seed, source_cycle, beat)`
  in the new pure `start.rs` — the same determinism mechanism as the GATE, so the
  choice is window-split-independent and reproduces on reapply. The chosen
  alignment feeds the existing alignment→quantize math and is recorded in the
  decision trace (`TriggerDecision.start_alignment`; surfaced as `startKind`).
  Determinism re-proven by a property test: a weighted START over the variable
  placements keeps **launches, carry, and the decision trace** identical whole vs
  split. UI: the START placement select gains the two placements, and a
  **Placement: Fixed | Weighted** toggle reveals a weighted editor (placement + weight rows,
  add/remove); `nothing lies` — every option maps to a real alignment. Files:
  `cseq-trigger` (`config.rs` `LaunchAlignment` + `StartSelect`/`WeightedStart`,
  `evaluator.rs` fire fields + anchors, new `start.rs`, `compiler.rs` per-fire
  pick + trace, `lib.rs` property test; 91 tests), `cseq-transport`
  (`start_kind` on the decision event + 2 START seam tests; 196 tests),
  `src-tauri` (`startKind` DTO), `ui/src/bridge.ts`/`patchIo.ts`/`triggerUi.ts`/
  `TriggerInspector.tsx`, e2e. Deferred (Phase F): accent/cadence rotation,
  end-at-return (an END/length concern, not START).
- **Phase E — Timeline overlays + log polish. ✅ IMPLEMENTED.** The compiler's
  `TriggerDecision` gained `event_reference_tick` (the raw WHEN onset, pre-
  placement) so the overlay can draw the **event → placement connector** — the
  most instructive mark when START displaces beat 0 (CenterInRest, AtSourceReturn,
  …). Surfaced as `eventTick` through the transport decision event + DTO + bridge.
  A pure `timelineModel` selector `selectTriggerOverlayMarks(events, {
  referenceCycleTicks, showRejected, maxMarks })` positions each decision by its
  **reference-tick phase within the cycle** (`tick mod referenceCycleTicks`),
  bounded to the most-recent `maxMarks`, filtered by an inspect toggle — a *pure
  render of the engine trace*, never re-derived (Plan §8 parity). The inspector
  gains a **TIMELINE** band: a one-cycle phase strip drawing, per decision, the
  matched-onset dot + the placement mark (amber launched / yellow queued / faint
  suppressed) + the connector, with an `inspect` toggle for rejected candidates.
  The **LOG** band gains an outcome filter (`filterTriggerDecisions`:
  all/launched/queued/suppressed) — the "clickable log filtering" — and an empty
  state. Files: `cseq-trigger` (one trace field; 91 tests), `cseq-transport`
  (`event_tick`; 196 tests), `src-tauri` (`eventTick` DTO), `ui/src/bridge.ts`,
  `ui/src/timelineModel.ts` (selectors, vitest in `triggerOverlay.test.ts`),
  `ui/src/TriggerInspector.tsx` (TIMELINE band + log filter), `styles.css`, e2e
  (overlay + log render from the trace during playback). **Scope note:** the
  overlay is a dedicated per-cycle phase strip *in the inspector* rather than a
  lane on the main akshara/score timeline — cross-track reference-tick decision
  events don't map cleanly onto the structural score view, and a self-contained
  strip keeps it truthful without that risky integration. The armed/running lane
  + a main-timeline launch lane remain a possible follow-up.
- **Phase F — Roadmap without fake controls. ✅ IMPLEMENTED.** The roadmap is now
  legible without faking behavior: genuinely-unimplemented capabilities are
  summarized in the Advanced roadmap row, not placed inside live dropdowns.
  Surfaced: RUN lifetime `until stop`, RUN length `until source returns`
  (end-at-return), START placements `rotate to accent` / `rotate to cadence`,
  WHEN subjects `ratchet fired` / `ornament at beat` (post-score) and `source
  running` (cross-track). **No engine change** — these are not real engine
  variants; the existing normalizers already coerce any hand-edited deferred
  value to a safe real default (`untilStop`→`onePass`, `untilReturn`→`scoreCycle`,
  `rotateToAccent`→`atEvent`, `ratchetFired`→`isRest`), proven by
  `triggers.test.ts` resilience tests, so the engine can never receive an
  unsupported capability. UI-only: `triggerUi.ts` keeps pure deferred catalogs
  (`TRIGGER_START_ALIGNMENTS_DEFERRED`, `TRIGGER_WHEN_SUBJECTS_DEFERRED`) separate
  from real catalogs for resilience tests, while `TriggerInspector.tsx` keeps
  live dropdowns real-only; e2e asserts deferred values are absent from selects
  and present in roadmap copy.

Phase A is mostly front-end and shippable fast; B–D are engine-led and each is a
self-contained pure-crate increment plus a snapshot/UI slice.

---

## 8. Invariants this plan must not break (the review checklist)

- Timeline == MIDI parity: the event log + overlays render the compiler's
  decision trace, which produced the launches. No second derivation.
- Deterministic under locked seeds: GATE rolls + weighted START seeded by stable
  identity, recorded in seed-path, reproduced on recompile/reapply (recompute
  from cycle 0).
- Cycle-local / future-only: gate state in carry; never mutate finalized events.
- One-level DAG; gati per beat; silent-source conflict inertness — all unchanged.
- Bounded: every gate/memory counter and candidate set is bounded per window.
- The two compiler refactors (§4) re-prove associativity + monotonicity (or
  replace the monotonic-break with sort-based processing) before B/D ship.

---

## 9. Open product questions

1. **Inspector placement** — new tab vs. collapsible section in the existing
   inspector? (Recommend collapsible section; tab if it grows past ~4 bands.)
2. **GATE seed default** — `launch` scope (so re-arm re-rolls) vs `track`?
3. **Multiple candidates per cycle** — is that a v1.5 need, or can WHEN stay
   single-beat longer (defers the §4b refactor)?
4. **Weighted/conditional START in scope soon**, or keep START fixed (defers the
   §4a monotonicity refactor, the riskier of the two)?
5. **`until_stop`** — show disabled, or hide until built?
