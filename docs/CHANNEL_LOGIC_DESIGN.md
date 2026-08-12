# Channel Logic — Execution Design for A2–A5 and B0–B3

Date: 2026-07-07 · Status: **design, awaiting D-decisions; no phase started**
Parent plan: `CHANNEL_LOGIC_PLAN.md` (A0 spec + A1 hung-note fix are DONE).
Semantics source of truth: `CHANNEL_LOGIC.md` (cited below as "spec §N").
This document is self-contained: someone with no session context should be able to execute
any phase from it. Line anchors are as of 2026-07-07 and will drift; function names won't.

---

## 0 · Context capsule

Channel logic resolves same-MIDI-channel note collisions between parallel participants
(tracks, triggered followers, Track Flow box lanes). Config = project default policy +
pairwise override list (`channelLogicMatrix`: `{trackAId, trackBId, outputChannel|null,
policy}`) + `conflictPriority`. The engine pass lives entirely in
`crates/cseq-transport/src/lib.rs` (`matrix_allowed_tracks`, `collision_allowed_tracks`,
`apply_parallel_channel_conflicts_for_keys`); the FE model in `ui/src/channelLogic.ts` +
`ui/src/patchIo.ts` (normalize :2036, projections :2087/:2110); the UI inline in `App.tsx`
(panel :8539-8822, handlers :5934-6067, priority editor :9147, debug table :9606).

What A1 already fixed (do not re-litigate): the conflict pass now **defers** strictly-
spanned same-pitch note-offs instead of dropping them
(`defer_premature_same_pitch_note_offs`), a scheduler sweep (`stuck_note_residue`) releases
provably-stuck notes, note balance is enforced unconditionally in `invariants.rs` +
`fuzz/fuzz_targets/parallel_transport_queue.rs`, and the three former `#[ignore]` repros are
regression pins.

Remaining verified problems, by owner phase:

| # | Problem (spec ref) | Phase | Decision gate |
|---|---|---|---|
| P1 | Pairwise cliff: any matrix entry degrades the default to pairwise `active=2` semantics project-wide; help copy contradicts behavior (spec §5, R2) | A2 | **D1** |
| P2 | `Alternate` winner depends on evaluation order, matrix shape, realize windowing; counters reset on every live edit (spec §4, R3) | A3 | **D2** |
| P3 | Four hand-mirrored encodings with no lockstep test: FE rule projection ↔ BE pair degeneration; FE reachability ↔ engine hocket; FE Play-gate ↔ BE validation; DTO field names (R4) | A4 | none |
| P4 | FE model gaps: no normalize-idempotence/reducer properties; randomize's channel-logic exclusion unpinned; no live-edit e2e (R7 part) | A5 | none |
| P5 | Panel is ~280 lines of inline App.tsx JSX, zero RTL coverage, three label vocabularies for one enum (R7, R4d) | B0 | none |
| P6 | UI teaches nothing: precedence invisible, priority editor hidden unless the *default* is Priority, delta-culling erases intent, ambiguity authorable-then-Play-blocked (R5, R6, R8) | B1 | **D3, D4** |
| P7 | Dead-end chip reasons, invisible feature when channels are disjoint, no proof of what suppression did (R8) | B2 | none (D5 deferral stands) |
| P8 | Help card is a wall of text; manual/UI docs describe the pre-B1 UI | B3 | none |

Environment notes for executors: `cargo` needs `. "$HOME/.cargo/env"` first. RTL/jsdom
vitest (`*.test.tsx`) needs Node 22. Sweeps: `PROPTEST_CASES=4096 cargo test -p
cseq-transport --features fuzzing --test invariants`. DTO fixtures regenerate with
`UPDATE_DTO_FIXTURES=1 cargo test -p cseq-app dto_fixture` + `pnpm vitest run -u
src/dtoContract.generate.test.ts`. Golden ledgers: `UPDATE_GOLDEN_LEDGERS=1 cargo test -p
cseq-transport --features fuzzing --test golden_ledgers`. The e2e stable suite is the
explicit file list in `ui/package.json` `test:e2e`.

---

## Part A — engine + contract hardening

### A2 · Fix the pairwise cliff (gate: D1) — M

**Problem, precisely.** `matrix_allowed_tracks` (lib.rs:7886): with an empty matrix, the
default policy is evaluated **group-wise** on the whole overlap component with the true
audible-track denominator. With *any* matrix entry anywhere, every pair in every component
is evaluated **pairwise** (`collision_count=2, active=2`), and unmatched pairs fall back to
the default *in that degenerate form*. Which defaults actually change (worked from the
policy arms, spec §4):

- **Unaffected** (pairwise ≡ group-wise composition): `forceOn/allowAll/or`,
  `forceOff/nor`, `xor`, `oneHigh` (≡ xor), `xnor`, `priorityOrder` (veto-composes to the
  global min rank).
- **Materially changed**: `and` (consensus gate → passes everything), `majority`
  (density gate → passes everything), `minority` (→ suppresses everything ≥2), `nand`,
  `even`, `odd`, `oneLow`; `randomOne` (winner distribution collapses to {lowest, highest
  index}: the shared hash index picks `pair[i]` with the same `i` for every pair, so a
  middle track can never survive the veto intersection); `alternate` (per-pair counter
  bumps make pair winners inconsistent — a 3-track component can veto **everyone**,
  silencing the component).

Of the UI-offered default vocabulary, the user-visible casualties are `and`, `majority`,
`minority`, `randomOne` (fairness), `alternate` (silence). The in-app help describes
group-wise semantics unconditionally (channelLogic.ts:397), so shipped copy is wrong
whenever one rule exists.

**Options.**

- **O1 — Keep pairwise fallback; fix the copy.** Zero engine risk; help text gains "when
  any pair rule exists, the default applies per pair" caveats. Rejected as primary: it
  preserves the alternate-silence and randomOne-fairness defects, and the conditional
  semantics ("your density gate stops working the moment you add one unrelated rule") is
  exactly the comprehension debt this effort exists to remove.
- **O2 — Group-wise default first; explicit rules veto on top (monotone).** `S = S0 −
  vetoes`, where S0 is the group-wise default result and each *explicit* matrix entry
  evaluates pairwise and can only remove its members. Clean, but **breaks the rescue
  use-case**: today `default = xor` + explicit `Layer` on (A,B,ch) lets A+B sound
  together (the explicit allowAll pair passes both); monotone veto can never re-admit a
  track the default suppressed. Real regression against authored patches and against the
  UI's own "Layer" rule affordance. Rejected.
- **O3 — Group-wise default + explicit rules are authoritative for their pair
  (rescue + veto), RECOMMENDED.** Semantics:

  ```
  if component has ≤1 track → group-wise default (unchanged)
  S0 = collision_allowed_tracks(default, component_tracks, active)   // ALWAYS group-wise
  if matrix empty → (S0, used=false)
  rescued = ∅ ; vetoed = ∅ ; ruled = ∅
  for each unordered pair (a,b) of component tracks WITH an explicit entry
      (exact (a,b,channel) → else legacy (a,b,null); no entry → pair is NOT evaluated):
      V = collision_allowed_tracks(entry.policy, [a,b], active=2)
      for m in [a,b]: ruled += m; if m ∈ V { rescued += m } else { vetoed += m }
  S = (S0 ∪ rescued) − vetoed          // veto dominates rescue on conflicts
  ```

  Why this shape: it restores every group-wise default guarantee for unruled tracks
  (empty-matrix ≡ irrelevant-matrix by construction), preserves today's behavior for
  explicitly-ruled pairs (worked examples below), keeps the rescue use-case, and shrinks
  the Alternate statefulness problem to explicit alternate *rules* only (unruled pairs no
  longer evaluate Alternate per pair — relevant to A3).

  Worked examples (verified against the policy arms):
  - `xor` default + `Layer(A,B)` on {A,B}: S0=∅, rescue {A,B} → **{A,B}** (today: same;
    O2 would give ∅).
  - `allowAll` default + `forceOff(A,B)` on {A,B,C}: S0=all, veto {A,B} → **{C}** (today:
    same).
  - `majority` default (active=4) + `Priority(A,B)` on 3-track component {A,B,C}: S0=all
    (2·3>4); V(A,B)={A} → veto B → **{A,C}** (today: same outcome via degenerate pairwise;
    now the *reason* is explainable).
  - `majority` default (active=4), rule on (t0,t1)@ch5 only, component on ch1 {A,B}: S0 =
    ∅ (2·2>4 false) → **∅** (today: **{A,B}** — the cliff; this is the intended behavior
    change).
  - Winner-policy default + pass-rule interplay: `randomOne` default picks C in {A,B,C};
    `Layer(A,B)` rescues A,B → **{A,B,C}**. Documented consequence of mixing a thinning
    default with an explicit pass rule; the alternative (rescued members *replace* the
    draw) makes rules non-local again. Goes in help copy as one sentence.

  **Decision-ledger labels** improve as a side effect: today `used_override=true` relabels
  every track in the component `channelLogicMatrix` (lib.rs:8004-8023). Under O3, only
  tracks in `ruled` get `matrix-pass|matrix-suppress`; unruled tracks keep the default
  policy's own label. `used_override` (the `(HashSet, bool)` return) becomes per-track:
  return `(S, ruled: HashSet<usize>)` and derive each track's label from membership.

**Implementation steps** (single file, `cseq-transport/src/lib.rs`):
1. Rewrite `matrix_allowed_tracks` per O3; change return type to `(HashSet<usize>,
   HashSet<usize>)` (allowed, ruled); update the one caller
   (`apply_parallel_channel_conflicts_for_keys` :7982) to label per track.
2. Unit tests: pin each worked example above as a table test; audit the existing per-policy
   matrix tests (`parallel_channel_logic_matrix_*`, :17486-17566) — all four assert
   *explicit-rule* behavior, which O3 preserves; expected to pass unchanged. Add the
   "unrelated rule does not degrade the default" test (majority example 4).
3. New invariant property (invariants.rs): **irrelevant-matrix equivalence** — for every
   generated `ParallelParams`, realization with `channel_logic_matrix = []` is
   byte-identical to realization with entries that can never match (e.g. the same pair on
   `output_channel: Some(16)` while `build_parallel_matrix` tracks emit on channels 1–3 —
   check the generator's channel range first and pick an unused channel; if all 16 are
   reachable, use a synthetic pair of silent-source ids instead). Wire into the proptest
   block at default cases; deep-sweep before merging.
4. Re-run: full `cargo test -p cseq-transport --features fuzzing`, 4096-case sweep, golden
   ledgers (single-track — expected untouched), `cargo check --workspace`.
5. Docs: spec §5 rewritten (the O3 algorithm + updated degeneration-table framing: the
   table then describes *explicit rules only*); spec §11 D1 stamped; `CHANNEL_LOGIC_PLAN.md`
   R2 → fixed; KNOWN_RISKS cause bullet updated; help-copy fix moves to B3 (or a one-line
   interim tweak if B3 is far: majority/minority/and `detail` strings are now TRUE again —
   verify wording only).

**Compatibility.** Patches with no matrix: bit-identical. Patches with matrix rows:
explicitly-ruled pairs behave the same; unruled pairs/components regain documented
group-wise semantics — audible change for count-based defaults (examples above). This is
the D1-accepted behavior change; release note: *"Channel-logic defaults now keep their
documented meaning when pair rules exist; pair rules unchanged."* No wire/schema change; no
FE change required (FE never modeled the cliff).

**Acceptance.** Irrelevant-matrix property green at 4096; worked-example table tests green;
existing rule tests green unchanged; per-track labels verified in one decision-ledger unit
test; spec/plan/KNOWN_RISKS updated.

---

### A3 · Deterministic `Alternate` (gate: D2) — S–M

**Problem, precisely** (spec §4). `alternate_offsets: [usize; 16]` on
`ParallelRuntimeConfig` (:2136): winner = `track_indices[offsets[ch] % k]`, then
`offsets[ch] += 1`, inside `collision_allowed_tracks` (:7798-7808). Consequences:
(a) with a matrix present, the counter bumps once per *pair consult*, not per collision
(O3/A2 removes this for unruled pairs, but explicit alternate rules still bump per pair);
(b) counters reset to zero on **every** accepted config push — `from_config` :2401 and
`apply_in_place` :2667 — so any live edit mid-performance restarts the rotation phase;
(c) incremental re-resolution (spec §3.4: a component is re-resolved wholesale when a new
group joins it) advances the counter again for the same musical collision, so rotation
phase depends on realize windowing. The reapply-bit-identical property is green because
both fuzz paths realize with the same windowing; nothing tests *incremental vs fresh*
equality today.

**Options.**

- **Ob — Keep the counter; advance once per component; document resets.** Move the
  advance out of the policy arm: `collision_allowed_tracks` takes the current offset as a
  value; the *component* loop advances `offsets[ch]` exactly once per component whose
  governing evaluation hit Alternate. Explicit alternate pair rules advance a
  pair-scoped counter (`HashMap<(a,b,ch), usize>`). Fixes (a); (b) and (c) remain and get
  documented. Cheapest; still order/window-dependent. Fallback choice.
- **Oc1 — Cycle-local ordinal (stateless), RECOMMENDED.** Winner index =
  `ordinal(component) % k`, where `ordinal` = number of same-channel components with
  `start_tick <` this component's start **within the same reference cycle** (computable
  from the realized groups, no mutable state). Rotation restarts each cycle — consistent
  with the repo's "cycle-local rewrites" doctrine (KNOWN_RISKS "Preview And MIDI Drift"
  mitigations). Kills (a), (b), (c)'s state — but inherits a **new** windowing edge: if a
  later realize batch adds a component *earlier in the same cycle* on the same channel,
  ordinals of already-resolved later components shift, and `only_keys` (spec §3.4) skips
  re-resolving them → incremental output diverges from a fresh realize. Mitigation:
  **cycle-scope re-resolution** — when `only_keys` matches any component, widen
  re-resolution to all same-channel components in the affected reference cycle(s). Bounded
  (≤1 cycle of components), pre-dispatch in the normal 2-cycle-ahead regime.
  ⚠ While designing this we identified a **pre-existing adjacent hazard, now R9 in the
  risk register**: wholesale re-resolution (today's behavior, not new) can in principle
  suppress a group whose note-ON is already dispatched (a long tie spanning the playhead
  when a new group joins its component), removing its queued OFF → a stranded on. The A1
  `stuck_note_residue` sweep now *contains* this to ~one realize window, which is why A1
  shipped the sweep even with balance green. A3's cycle-scope widening slightly enlarges
  the re-resolution surface, so A3 must add the guard: **never re-resolve a component
  whose earliest group start is at or behind the dispatch horizon** (skip + log). Cheap
  (compare against the realize call's `target_tick` floor), and it closes R9 generally.
- **Oc2 — Beat-derived index (stateless, simplest).** Winner =
  `track_indices[(start_tick / beat_ticks) % k]`. No ordinal, no re-resolution widening,
  fully stable. Semantics change: "alternates by beat position", not per collision — two
  collisions inside one beat share a winner; sparse collisions skip rotation steps.
  Musically defensible but different from the shipped help copy ("advances a winner index
  per MIDI channel").

Recommendation: **Oc1** with the R9 guard; Ob if D2 wants minimal churn. Oc2 only if Daniel
prefers position-based alternation musically (it is the most robust of the three).

**Implementation steps (Oc1).**
1. Delete `alternate_offsets` from `ParallelRuntimeConfig` (+ both reset sites, the field
   init, and the `&mut [usize; 16]` parameter threading in `collision_allowed_tracks` /
   `matrix_allowed_tracks` — signature simplification touches ~6 call sites incl. tests).
2. Thread an `alternate_ordinal: usize` input instead, computed in
   `apply_parallel_channel_conflicts_for_keys` per component: group components per
   (channel, reference cycle) — `cycle = component.start_tick / reference_tpc`; sort by
   start; index within the cycle. `reference_tpc` is available at the call site
   (`realize_parallel_until` owns it; pass through).
3. `only_keys` widening: compute affected (channel, cycle) pairs from matched components;
   re-resolve every component in those pairs, subject to the R9 dispatch-horizon guard
   (skip components with `min group start < floor`, `warn!` when skipped).
4. Explicit alternate *rules* (post-A2 the only other Alternate site): same ordinal input
   (the pair evaluation shares the component's ordinal — a pair rule alternates per
   collision of that component, which is the musical intent).
5. Tests: (i) property — realizing in one shot vs. two `realize_parallel_until` steps
   (split target) yields byte-identical queues (NEW `fuzz_realize_parallel_cycles_stepped`
   hook mirroring the existing traced hook; valuable far beyond Alternate — it pins the
   whole incremental path); (ii) property — adding an irrelevant matrix row does not change
   Alternate winners (subsumed by A2's irrelevant-matrix property once both land); (iii)
   unit: two same-channel collisions in one cycle rotate A→B; next cycle restarts at A;
   live-edit mid-cycle does not shift phase (drive via `apply_in_place`).
6. Docs: spec §4 Alternate row + determinism note rewritten; §11 D2 stamped; help copy
   `alternate.detail` ("Caesura advances a winner index per MIDI channel") updated to
   "rotates per collision within each cycle" (B3 owns copy, but this one string ships with
   A3 so the app never lies).

**Compatibility.** Alternate winner *sequences* change for existing patches (rotation phase
now cycle-anchored). Replay: seed paths don't record Alternate state (it was never
seeded RNG), so old recorded seed-paths replay fine — rotation is derived, not replayed.
Release note one-liner.

**Acceptance.** Stepped-realize property green at 4096 (this is the headline — it also
retroactively guards A1's deferral idempotence); phase-stability unit tests green; state
fields deleted; R9 guard in place with a unit test (construct a tie spanning the horizon,
assert skip + warn + sweep containment).

---

### A4 · Contract fixtures across the duplicated seams — M

Four hand-maintained mirrors, four fixtures. All follow the existing DTO-contract pattern
(`ui/src/__fixtures__/dto/`, generated by `cargo test -p cseq-app dto_fixture` under
`UPDATE_DTO_FIXTURES=1`, consumed by vitest; TESTING.md "DTO contract fixtures").

**A4.1 Degeneration-table fixture (FE rule projection ↔ BE pair evaluation).**
- Rust: new `dto_fixture` case emitting `channel_logic_degeneration.json`: for each of the
  18 `ChannelConflictPolicy` variants, evaluate `collision_allowed_tracks(policy, [0,1],
  active=2)` (post-A2: the explicit-rule path) and classify → `"both" | "none" |
  "winner"`. Include the camelCase policy id string via the existing DTO serialization so
  the fixture also pins serde names.
- Vitest (`channelLogic.contract.test.ts`): for each entry assert
  `musicalChannelLogicRulePolicy(policy)` is `allowAll` iff `both`, `forceOff` iff `none`,
  identity iff `winner`. This turns the spec §8 "verified by hand" claim into CI.
- Note: A2/O3 does not change pair evaluation of explicit rules, so this fixture is valid
  before or after A2.

**A4.2 Reachability soundness fixture (FE prediction ⊇ engine behavior).**
- Design choice: do **not** write a second reachability algorithm in Rust (a third mirror).
  Instead pin the *soundness direction empirically*: FE-predicted channels must be a
  **superset** of engine-observed channels. (Prediction over-approximation = chips shown
  for channels that never sound — cosmetic; under-approximation = collisions the UI says
  can't happen — the dangerous direction. Superset is the safety property.)
- Rust: generate N (~64) hocket specs with a seeded generator reusing the invariant
  suite's hocket strategies (invariants.rs already generates `ChannelHocketSpec` for its
  shaper axis — extract/share the strategy); for each spec, realize K cycles × S seeds on
  one track and collect the set of emitted user channels. Emit
  `channel_hocket_reachability.json`: `[{ spec: <PatchChannelHocketState-shaped JSON>,
  observed: number[] }]`. The spec is emitted in the FE *patch* shape (camelCase field
  names matching `patchIo.ts` `PatchChannelHocketState`) — generate it in Rust with a
  small serde struct mirroring those names; this is new but it is a *test-only* mirror
  whose drift fails loudly (vitest can't parse → red).
- Vitest: `expect(observed).toSatisfy(subsetOf(channelHocketPossibleMidiChannels(spec)))`;
  additionally log `predicted − observed` sizes so gross over-approximation is visible in
  test output without failing.
- Cost note: K×S realizations in a fixture *generator* is fine (runs only under
  `UPDATE_DTO_FIXTURES=1`); the committed JSON keeps CI fast.

**A4.3 Populated `channelLogicMatrix` DTO fixtures, both directions.**
- Rust→TS: extend the existing snapshot fixture generation so the parallel request/patch
  fixtures carry a non-empty matrix: ≥1 exact-channel row, ≥1 legacy `outputChannel: null`
  row, one legacy policy string (e.g. `"nand"`) — with in-generator asserts so it can't
  regress to empty (same discipline as the beat-lock fixture, TEST_COVERAGE_PLAN Phase 2.4
  notes).
- TS→Rust: add `parallel_playback_request.json` — vitest snapshots
  `buildParallelPlaybackRequest` output for a 2-track + 1-rule project fixture; a
  `cseq-app` test deserializes it through `ParallelPlaybackRequestDto` and runs
  `validate_parallel_playback_config` (mirrors the `rhythm_preview_request.json` seam).
  This byte-pins `trackAId`/`trackBId`/`outputChannel`/policy camelCase and the
  `null`-channel semantics through real serde.

**A4.4 Blocking ⊇ validation.**
- Enumerate the BE rejection classes (spec §6): >16 participants; duplicate track ids;
  self-pair; channel ∉1..16; unknown endpoints; duplicate (pair, channel) key
  (policy-blind).
- FE-side vitest per class: construct a raw patch/project exhibiting the class → run
  `normalizeChannelLogicMatrix` + `buildParallelPlaybackRequest` → assert the offending
  shape cannot reach the wire (dropped/clamped/deduped) or, where it can (>16
  participants — the FE has no cap today), assert it *can* and file the gap decision.
- Code change bundled here: **make `normalizeChannelLogicMatrix` dedup exact duplicate
  (pair, channel, policy) rows and duplicate (pair, channel) keys** (keep the first in
  sorted order). Today a hand-edited patch with duplicates passes the FE gate and dies at
  BE validation (spec §6 "contract edges"). Deduping at normalize is the D4 direction
  (load-time auto-repair) delivered early and is safe standalone: it never changes the
  meaning of reducer-produced matrices (reducers can't make duplicates).
- The >16-participant question goes to the D-list as **D7** (options: FE hard cap at
  authoring time vs. pre-Play validation message; recommend pre-Play message — cheap,
  no authoring friction).

**Acceptance.** All four fixtures in CI; regeneration commands documented in TESTING.md;
`musicalChannelLogicRulePolicy` and `channelHocketPossibleMidiChannels` each covered by a
generated contract; duplicate-key normalize dedup landed with unit tests.

---

### A5 · FE model hardening — S–M

No decisions needed; can land any time. All in `ui/src`.

1. **Normalize idempotence + reducer properties** (`channelLogic.test.ts` /
   `patchIo.test.ts`): hand-rolled seeded-PRNG loops (~500 cases; no fast-check in the
   repo — keep it that way for consistency): generate matrices (random pairs from 4 track
   ids + box-lane id, channels 0–17 incl. invalid, all 18 policies, duplicates) and assert
   (i) `normalize(normalize(x)) === normalize(x)` deep-equal; (ii) output sorted by the
   documented key; (iii) toggling a channel on then off round-trips to the pre-toggle
   normalized matrix; (iv) every reducer's output is already-normalized (normalize is a
   fixpoint); (v) box-lane endpoints survive every reducer.
2. **Randomize exclusion pin**: `randomize.test.ts` — run the full randomize entry point
   over a project fixture with a seeded RNG and assert
   `channelConflictPolicy`/`channelLogicMatrix`/`conflictPriority` are reference-equal
   (or deep-equal) afterward. One test, prevents a future randomize sweep from silently
   scrambling collision policy (`randomize.ts` has zero channel-logic references today —
   deliberate, but nothing says so).
3. **Live-edit e2e** (stable suite): start mock playback (mockTauri supports the parallel
   path — `tests/e2e/support/mockTauri.ts:237` consumes these requests), edit a rule's
   policy mid-play, assert a deduped `parallel_set_playback` re-push arrives with
   `nextCycle: true` and the updated matrix, and that an *identical* second edit does not
   re-push (pins `parallelPushDedupKey` behavior, App.tsx:3484-3517).
4. **Conflict-message self-consistency** (pre-D4; delete with D4): generated matrices —
   if `channelLogicConflictMessagesForProject` is empty then every (pair, channel) policy
   set is a singleton.

---

## Part B — UI clarity

Design constraints (DESIGN_LANGUAGE.md): dense/legible/direct/calm; flat signal design;
grid before card; one control one meaning; **blue = channel/routing signal**; matrix
heatmap language reserved for Markov grids. Keep the rule-list-not-grid decision
(UI_AND_INTERACTION.md:236). Contrast is guarded by `theme-contrast.spec.ts` — any new
chip/tag styling must pass it in both themes.

### B0 · Extraction + one vocabulary — S–M (no decisions; start immediately)

**B0.1 Extract `components/ChannelLogicPanel.tsx`.** JSX move only, zero behavior change.
Props stay thin; derivations remain in App.tsx for now:

```ts
type ChannelLogicPanelProps = {
  defaultPolicy: ChannelConflictPolicy;
  overrideRows: ChannelLogicOverrideRow[];      // buildChannelLogicOverrideRows output
  conflictMessages: string[];                    // dies in D4/B1
  hasAvailablePair: boolean;
  helpOpen: boolean;
  onSetDefaultPolicy(p: ChannelConflictPolicy): void;
  onSetGroupPolicy(g: ChannelLogicGroupRef, p: ChannelConflictPolicy): void;
  onToggleChannel(g: ChannelLogicGroupRef, ch: number, selected: boolean): void;
  onSetGroupTrack(g: ChannelLogicGroupRef, side: "a" | "b", trackId: string): void;
  onAddPair(): void;
  onRemoveGroup(g: ChannelLogicGroupRef): void;
  onToggleHelp(): void;
  trackTabs: ChannelLogicTrackTab[];            // for the track selects
};
```

The existing Playwright tests (`patch-persistence.spec.ts:1966, :2039`) are the
no-regression guardrail — they must pass unchanged after the move. The
`componentCoverage.test.ts` guardrail (≥400 lines ⇒ colocated test, shrink-only debt
register) applies: ship `ChannelLogicPanel.behavior.test.tsx` in the same change (Node 22).
RTL test list: default-select fires callback; help region toggles with correct aria; chip
click fires with (group, channel, selected); disabled idle chip has reason in accessible
name; rule-policy select offers exactly the rule vocabulary; remove fires; add disabled
state renders title; conflict block renders first 3 + "+N more".

**B0.2 One `POLICY_METADATA` table** (channelLogic.ts):

```ts
export const POLICY_METADATA: Record<ChannelConflictPolicy, {
  label: string;          // the ONE user-facing name, e.g. "One only"
  summary: string;        // one sentence (select title / help summary)
  detail: string;         // help card long form
  availableAs: "default" | "rule" | "both" | "legacy";
  technicalName: string;  // "XOR" — shown only in help detail, parenthesized
}>
```

Derive `CHANNEL_LOGIC_DEFAULT_OPTIONS`, `CHANNEL_LOGIC_RULE_OPTIONS`,
`channelConflictPolicyLabel`, and `CHANNEL_LOGIC_HELP_MODES` from it (keep the exported
names; consumers don't churn). Copy decisions folded in: `allowAll` is labeled
**"Layer all"** everywhere (the rule dropdown's bare "Layer" dies); `xor` is "One only"
everywhere ("XOR" survives only as `technicalName`). The debug table (App.tsx:9653) renders
`POLICY_METADATA[policy]?.label ?? policy` for policy ids; action ids (`matrix-suppress`
etc.) stay raw — they are forensic identifiers, add a `title` attribute instead.
Enforcement tests: (i) every enum member has metadata; (ii) a source-scan test (pattern:
`timelineModel.test.ts` raw-conversion ban / `e2eHarnessContract.test.ts`) asserting
`ChannelLogicPanel.tsx` contains no string literal matching `/\b(XOR|XNOR|NAND|NOR)\b/`
and no `/matrix/i` in user-facing copy; (iii) conflict-message and debug-table label paths
go through the table (unit-level assertion on the formatting helpers).

**B0.3 Copy audit**: sweep `channelLogic.ts` + panel JSX for "matrix" (wire name
`channelLogicMatrix` is exempt — code, not copy). UI_AND_INTERACTION.md gets the new
vocabulary table (B3 finalizes).

### B1 · Structure that teaches the model (gates: D3, D4; after B0) — M

Target anatomy (single panel, top-to-bottom = evaluation order):

```
CHANNEL LOGIC                                                        (i)
When notes overlap on the same MIDI channel:   [ Random one ▾ ]
  ⌇⌇ overlap = sustained spans crossing — not shared starts   ← pictogram + caption

Pair rules (override the default for a pair)            [+ Add rule]
  [Track 1 ▾] ↔ [Track 3 ▾]  on [Ch 2][Ch 3][idle Ch 5]  → [ Mute overlap ▾ ]  (−)
  [Track 2 ▾] ↔ [Track 3 ▾]  on [All shared]             → [ Priority ▾ ] (= default) (−)

Priority order · used by the default            1 Track 2 · 2 Track 3 · 3 Track 1  ↑↓

Ch 2 · T1↔T3 Mute overlap · else Random one            ← effective-policy footer
Ch 5 · no rules · Random one
```

**B1.1 Sentence framing.** The header line *is* the mental model: static text "When notes
overlap on the same MIDI channel:" + the default select inline. Subtitle
"same MIDI channel + overlapping note spans" (App.tsx:8571) is replaced by the pictogram
caption. Pictogram: inline SVG, two lanes, three bars, the overlapping pair highlighted
with `--blue` (routing signal), a non-overlap adjacency shown NOT highlighted; monotone
`--line`/`--base0*` otherwise; ~24×120px; `role="img"` with the caption as accessible name.
No new colors, no gradients (flat-signal rule).

**B1.2 Rules as sentences.** Reorder existing row controls to subject–scope–verb (track
selects, channel chips, policy select) — the pieces all exist
(`.parallel-logic-rule`, App.tsx:8655-8812); this is markup order + CSS grid, plus the
scope label folded into the chip group ("All shared" chip already exists).

**B1.3 Effective-policy footer + shared resolver.** New pure functions in
`channelLogic.ts`:

```ts
export function resolveChannelLogicPolicy(
  entries: ChannelLogicMatrixEntry[],   // normalized
  defaultPolicy: ChannelConflictPolicy,
  trackAId: string, trackBId: string, channel: number
): { policy: ChannelConflictPolicy; source: "channel-rule" | "pair-rule" | "default" }

export function buildEffectiveChannelSummaries(
  entries: ChannelLogicMatrixEntry[], defaultPolicy: ChannelConflictPolicy,
  trackTabs: ChannelLogicTrackTab[]
): Array<{ channel: number; ruleParts: Array<{ label: string; policy: ChannelConflictPolicy }>;
           defaultPolicy: ChannelConflictPolicy }>
```

`resolveChannelLogicPolicy` mirrors engine precedence exactly (exact (pair, channel) →
legacy (pair, null) → default) and is contract-anchored: a unit test drives it against the
same cases as the engine's `..._channel_rule_overrides_pair_fallback` test (:17566), and
A4.1's fixture pins the policy vocabulary. The footer renders one dense line per channel in
the union of pairwise shared channels (predicted, §B2 caveats apply): explicit rules first,
then "else {default label}". Under D1/O3 this is *semantically faithful* ("rules override
their pair; the default governs the rest group-wise"); if D1 chose O1 instead, the footer
must carry the cliff caveat — one more reason to decide D1 before B1 copy freezes.

**B1.4 Priority relocation + visibility.** Move the priority editor
(App.tsx:9147-9189) into the panel; render when
`defaultPolicy === "priorityOrder" || overrideRows.some(r => r.policy === "priorityOrder")`;
caption "used by the default" / "used by N rule(s)". Keep `moveParallelTrackPriority` and
testids (`parallel-priority-<id>-up/down`) so `patch-persistence.spec.ts:1787` keeps
passing; audit e2e for geometric assertions about its old location (the :1982-1991 panel
placement assertions target the *panel*, not the priority list — verify). Delete the
track-strip instance (one control, one meaning).

**B1.5 D3 — stop culling default-equal rules.** Changes:
- `normalizeChannelLogicMatrix` (patchIo.ts:2060): delete the `policy === defaultPolicy`
  drop; keep A4.4's key dedup.
- `nextChannelLogicMatrixForToggledChannel` (channelLogic.ts:881): remove the
  `|| policy === defaultPolicy` add-guard; `nextChannelLogicMatrixForGroupPolicy` (:787):
  repointing to the default *keeps* the rule (delete the `=== defaultPolicy → []` arm).
- UI: rows whose policy equals the default render a calm `= default` tag
  (`--base0*` text, no accent).
- Touch-point sweep (each needs its test updated): `channelLogic.test.ts` culling cases
  (assert keep+tag semantics instead); `channelLogicGlobalsForDefaultPolicy` test;
  `patchIo` round-trip fixtures; regenerated DTO snapshots (A4.3 fixtures should include a
  default-equal row *after* D3 to pin survival); `patch-persistence.spec.ts` matrix
  asserts (audit: current tests use `forceOff` vs defaults `allowAll`/`xnor` — likely
  untouched, verify).
- Compatibility: old patches contain no culled rows (they were culled at save) — loads
  unchanged. New patches opened in old builds: old normalize culls the default-equal rows
  → graceful degradation, no schema bump. Spec §8 updated; R5 closed.

**B1.6 D4 — ambiguity unrepresentable.** Changes:
- Reducer: `nextChannelLogicMatrixForToggledChannel` removes the (pair, channel) key from
  **every** row (any policy) before adding — toggling a channel *moves* its ownership to
  the clicked row. `nextChannelLogicMatrixForAddedPair` already picks rule-free keys.
- Load repair: normalize's key-dedup (A4.4) is the mechanism; add
  `channelLogicMatrixRepairCount(raw, tracks, defaultPolicy): number` so the patch loader
  can surface "Resolved N conflicting channel-logic rules" once via the existing
  `patchStatus` toast. Deterministic keep-first-in-sort-order rule documented in spec §8.
- Deletions: `channelLogicConflictMessagesForProject` + its `useMemo` (App.tsx:4127), the
  Play gate early-return (:4138) and `canStartPlayback` clause (:4256), the transport
  warning banner (:8386-8405, testid `transport-channel-logic-warning`), the
  `.parallel-logic-errors` block. BE validation stays as the API-level backstop.
- e2e rewrites (both current tests assert the author-then-block flow):
  `patch-persistence.spec.ts:1966-2037` becomes "toggling a channel owned by another row
  moves it" (assert chip deselects on row 1 when selected on row 2, no warning banner
  exists, Play stays enabled); `:2039-2127`'s `role="alert"` + Play-disabled assertions
  are replaced by persisted-matrix asserts (already present) + a load-repair test: seed a
  patch fixture containing a duplicate key via the harness, load, assert toast + deduped
  matrix.
- Docs: `LIVE_EDITING_ARCHITECTURE.md:119` ("FE must keep blocking contradictory rule
  sets") rewritten: contradictory sets are unrepresentable in the editor and auto-repaired
  at load; BE validation remains the wire backstop. Spec §6 + §11 D4 stamped; R6 closed.

**B1 acceptance.** RTL tests for: sentence header renders default select; footer lines
match `buildEffectiveChannelSummaries` for a fixture; priority visibility rule (default
Priority / rule Priority / neither); `= default` tag; ownership-move toggle. e2e: rewritten
persistence pair + priority-visibility spec green. No `transport-channel-logic-warning`
testid remains in src or specs.

### B2 · Honest, actionable state — M (after B0; counters benefit from B1's resolver)

**B2.1 Chip triad.** Selected = `--blue` fill with `--accent-ink` text (routing signal,
AA-contrast — verify against `theme-contrast.spec.ts` in both themes); available =
`--line` outline on `--panel-3`; idle = dimmed monotone + reason. Audit current
`.parallel-logic-channel-picker` styles and normalize to exactly these three states; the
same triad vocabulary should match the Channel Shaper axis strip's selected style so
"routing" reads as one system (check `ChannelShaperPanel.tsx` `.channel-axis-strip` styles
before inventing anything).

**B2.2 Actionable idle reasons + routing jump.** Reasons already computed
(`inactiveReasonForChannel`, channelLogic.ts:616 — "Track 2 has no route", "hocket off",
"not routed now"). Extend each rule row with one small routing-glyph button per track
select (title: "Edit Track N routing") that (i) sets that track active
(`setActiveTrackId`), (ii) opens the Channel Shaper main editor
(`MainEditorId "channel"` — the launcher already models this, App.tsx:7218, state setter
`setMainEditorOpen` :827). Reason strings gain the fix hint: "idle — Track 2 routes to
Ch 5 only · use ⟳ to edit routing". No modal, no new chrome.

**B2.3 Empty states that teach.** (a) >1 track, zero pairwise shared channels: replace the
disabled add-button-only state with one calm line inside the panel: "Tracks never share a
MIDI channel, so nothing can collide. Shared channels come from each track's routing." +
the same routing-jump affordance for the active track. (b) "+ Add rule" disabled title:
"All track pairs with shared channels already have rules" vs "No two tracks share a MIDI
channel" (distinguish `channelLogicRuleCapacity` exhausted from zero, App.tsx:6941-6957).
(c) Single-track: panel stays hidden (nothing can collide; no change).

**B2.4 Suppression counters (proof over promise).** Data source: the existing
`ParallelConflictDebugEvent[]` already delivered to the FE (bridge.ts:35/:110 — fields
`outputChannel`, `trackId`, `collidingTrackIds`, `conflictPolicy`, `conflictAction`,
`conflictGroupId`, `passed`; retention = the debug table's existing window). New pure
helper `attributeConflictEvents(events, entries, defaultPolicy): Map<attribution, {passed:
number; suppressed: number}>` where attribution is a rule's group key or `"default"`:
for each event with `passed === false`, resolve via B1.3's
`resolveChannelLogicPolicy(entries, defaultPolicy, event.trackId, otherId, channel)` over
`collidingTrackIds` pairs containing the suppressed track; attribute to every matching
explicit rule (multi-veto events attribute to each vetoing rule) else to the default.
Display: a small count per rule row and on the default line — "12 suppressed last window",
hidden at zero, `--base0*` text (data, not alarm). Caveats documented in the component:
attribution is *approximate under live edits* (events from a pre-edit matrix attributed
against the current one) and post-A2 the engine's per-track `matrix-*` action labels can
be used as a cross-check (`conflictAction.startsWith("matrix")` ⇒ must attribute to a
rule; log mismatch in dev). No engine/DTO change needed.
- RTL: fixture events + entries → expected attribution map; zero-count hidden; label copy.

**B2.5 Timeline ghost legend (audit + copy, small).** Suppressed *shaper marker* styling
exists (`.pitch-event-marker.is-suppressed`, `.channel-event-marker.is-suppressed`,
`.ratchet-event-marker.is-suppressed`, styles.css:10116+), fed by the suppressed flags
(spec §7). Audit items: (i) confirm the realized-note row itself ghosts suppressed groups
in parallel view (if not, scope: it is metadata-driven like the markers — add the class
hook, no engine change; timebox, and if it grows, split to its own change); (ii) add a
one-line legend entry to the timeline legend UI naming the ghost state ("ghost = removed
by Channel Logic"); (iii) e2e: extend an existing parallel spec to assert the marker class
appears for a forced-suppression fixture (mockTauri can emit `parallelConflictEvents` +
suppressed flags — check `mockTauri.ts` event fixtures for the suppressed field first).

**B2 non-goal (D5 stands).** No pre-playback dry-run preview: there is no parallel
stopped-preview machinery (verified — no such Tauri command exists), and building one is a
separate engine surface. Counters + ghosts + footer deliver the proof during/after play.

### B3 · Help + docs convergence — S (last; freezes copy)

- Help card shrinks to: 3 bullets — *what collides* (spans overlap on one channel, not
  shared starts), *how rules compose* (rules override their pair; the default governs the
  rest — wording per D1 outcome), *determinism* (winners derive from the collision's
  position, so a locked seed replays identically) — + the B1 pictogram + per-mode entries
  rendered from `POLICY_METADATA` (summary visible, detail expandable). Delete the
  hand-maintained 6-bullet primer (App.tsx:8599-8629) and `CHANNEL_LOGIC_HELP_MODES` (now
  metadata-derived).
- `channelLogicHelpOpen` persistence stays (patch.ui field — App.tsx:1315/:4744/:4810).
- Manual `docs/manual/CAESURA_USER_MANUAL.md:2237-2266` rewritten against the B1 anatomy
  (sentence header, rules-as-sentences, footer, priority-in-panel, `= default` tag,
  counters); `UI_AND_INTERACTION.md:207-244` likewise, including retiring the
  "contradictory rows warn and block Play" paragraph (D4) and the legacy-policy note
  :241-242 pointing at spec §8. Both cite `CHANNEL_LOGIC.md` as semantics authority.
- `DESIGN_LANGUAGE.md`: add the chip-triad + rule-sentence row as a named pattern only if
  another feature adopts it; otherwise skip (avoid speculative pattern inflation).
- Source-scan test extended: help copy for `majority`/`minority`/`and` must not claim an
  audible-track denominator unless D1=O3 landed (tie the string to the fixture from A4.1
  via a comment — manual check at review is acceptable if a string-test is too brittle).

---

## Sequencing, dependencies, effort

```
decision-free now:   B0 ──► (B2.1-B2.3 may follow B0 alone)
                     A4 ──► (A4.1 anchors B1.3's resolver; A4.4 seeds D4's repair)
                     A5.1/2/4 (unit) — any time; A5.3 (live-edit e2e) — any time
D1 ──► A2 ──► help-copy truthfulness for B1.3 footer / B3 bullets
D2 ──► A3 (independent of UI; touches only cseq-transport)
D3+D4 ──► B1 (needs B0) ──► B2.4 counters (needs B1.3 resolver) ──► B3 (freezes copy)
```

Recommended order: **B0 → A4 → A2(D1) → A3(D2) → B1(D3,D4) → B2 → B3**, with A5 riding
alongside whichever phase touches the same files. Rough effort: A2 M · A3 S-M (Oc1) / S
(Ob) · A4 M · A5 S-M · B0 S-M · B1 M · B2 M · B3 S. Each phase lands green on: full
`cargo test -p cseq-transport --features fuzzing`, workspace check + clippy, `pnpm -dir ui
test` (Node 22), stable e2e list, and (engine phases) a 4096-case sweep.

## Compatibility & migration summary

| Change | Patch files | Wire/DTO | Old builds reading new patches |
|---|---|---|---|
| A2 (O3) | none | none | n/a (engine-only) |
| A3 (Oc1) | none | none | n/a; Alternate phase changes audibly |
| A4.4 dedup | normalize-time repair only | none | fine (fewer rows) |
| B1.5 (D3) | default-equal rows now persist | none | old normalize culls them (graceful) |
| B1.6 (D4) | duplicate keys auto-repaired at load | none | fine |
| B0/B2/B3 | none (UI + `channelLogicHelpOpen` already persisted) | none | fine |

No schema-version bump anywhere. Release notes needed for: A2 (default semantics with
rules present), A3 (Alternate phase), B1 (panel restructure + no more Play blocking).

## Decision log additions (for `CHANNEL_LOGIC.md` §11)

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 (existing) | pairwise-cliff semantics | O1 document / O2 veto-only / **O3 rescue+veto over group-wise base** | O3 — preserves rule rescue AND restores group-wise defaults; per-track ledger labels |
| D2 (existing) | Alternate determinism | Ob per-component counter / **Oc1 cycle-local ordinal + horizon guard** / Oc2 beat-derived | Oc1; Ob as low-churn fallback; Oc2 if beat-anchored alternation is musically preferred |
| D7 (new) | >16 conflict participants authorable in FE, rejected by BE only at Play | (a) hard cap in authoring UI / (b) pre-Play validation message | (b) — no authoring friction, loud failure |
| R9 (new risk) | wholesale component re-resolution can suppress a group whose ON already dispatched (long tie spanning playhead) | — | contained by A1 sweep today; A3 adds the dispatch-horizon guard that closes it |

## Open questions for Daniel (beyond D1–D7)

1. B1.5 tag copy: `= default` vs `matches default` (2 words max; current mock uses
   `= default`).
2. B2.2 jump affordance: per-track glyph button in each rule row (proposed) vs a single
   "routing" link in the panel header. Per-row is more direct but adds two small buttons
   per rule; header link is calmer.
3. B2.4 counter window wording: "last window" (matches retention) vs "last cycle"
   (musical); retention is cycle-windowed today, so "last cycle" is probably honest —
   confirm against the layers retention policy when implementing.
4. A3: does cycle-anchored Alternate rotation match your musical intent, or is
   beat-derived (Oc2) actually preferable for performance predictability?
