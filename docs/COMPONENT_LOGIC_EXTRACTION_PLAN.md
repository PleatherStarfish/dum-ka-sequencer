# Component Logic Extraction & Unit-Test Plan

Executable companion to [TEST_COVERAGE_PLAN.md](TEST_COVERAGE_PLAN.md) (Phase 2
"frontend unit layer" + Phase 4 "App.tsx incremental extraction"). That doc sets
the strategy; this one is the concrete, prioritized backlog with real file
inventories, the module pattern, and the guardrails that keep the gap closed.

## The gap, in numbers

Pure branching logic on the frontend is verified almost entirely by `tsc` + slow
Playwright clicks + human eyeballing. Three layers:

- **L0 — already extracted, never tested.** ~14 pure `src/*.ts` modules plus
  `SeedControls.tsx` have **no** colocated test: `playbackRequests` (1167 lines,
  42 exports — *builds the actual transport requests*), `automationTargets`
  (1658/65), `advancedMatrix` (1026/25), `ratchetDisplay` (545/36),
  `channelLogic` (464/18), `huygensFokkerModes` (501/2), `synthVoices` (248/9),
  `resolvedSections` (262/10), `markovWeights` (210/19), `midiDebugFormat`
  (115/10), `boundaryPlanning` (107/5), `formatters` (34/5), `rhythmSpeedLabels`
  (31/4), `sessionPrefs` (250/25, localStorage), `SeedControls` (26 exports).
- **L1 — inline in components.** `SeedSetupDialog.tsx` (1261 lines, 0 memos):
  the seed logic lives in render-body consts and IIFEs (`nextCycleDotKinds`,
  `applyReproduce`, the familiar↔fresh mapping, Follow/Own → behavior).
- **L2 — trapped in memos.** `useRhythmShaperState.tsx` (2656 lines, 39 memos)
  and `App.tsx` (**8625 lines**, 33 memos) assemble playback specs, seed-mode
  requests, cache keys, and overlay rows inside `useMemo` bodies.

L0 is the cheapest possible coverage (no refactor, zero risk). L1 is the proof
case the recent seed work exposed. L2 is the long tail.

## The "model module" pattern (the target idiom)

Mirror the modules that already work this way (`timelineModel.ts`,
`randomize.ts`, `patchIo.ts`, `playbackLayers.ts`):

- **Pure.** No `react`/`react-dom` import. Plain functions over explicit
  input/output types. No hooks, no refs, no DOM, no `Date.now()`/`Math.random()`
  unless injected.
- **Component holds only wiring.** State, effects, dispatch, and JSX stay in the
  `.tsx`; it imports the model functions and calls them. A `useMemo` becomes
  `useMemo(() => buildX(deps), [deps])`.
- **Colocated test.** `seedStrategyModel.ts` ↔ `seedStrategyModel.test.ts`,
  covering each branch and the edge cases (empty pools, zero weights, clamps).
- **Setters become plans.** Where logic dispatches React setters (e.g.
  `applyReproduce`), the pure function returns a *plan* (`{ scope, seed, lockTo }`)
  and the component executes it. The plan is unit-testable; the one-line dispatch
  is not worth testing.

## Guardrails — so the gap stays closed (the "decisively" part)

1. **No React in model modules.** ESLint `no-restricted-imports` override: any
   non-component `.ts` under `src/` may not import `react`/`react-dom`. Makes
   "this is pure" mechanically enforced.
2. **Every model module has a test.** A meta-test (vitest) scans `src/*.ts`
   (excluding `.d.ts`, `bridge.ts`, `*.test.ts`, and an explicit allowlist of
   type-only modules) and fails if one lacks a colocated `*.test.ts`. A new pure
   module without a test breaks CI.
3. **Diff coverage gate.** Turn on `pnpm test:coverage` (already wired:
   `@vitest/coverage-v8`) in CI; record the baseline, then require changed lines
   in `src/**` to meet a threshold (per TEST_COVERAGE_PLAN Phase 3). Forces *new*
   logic to ship with tests without demanding a big-bang backfill.
4. **Component line budget (soft).** A CI warning if `App.tsx` /
   `useRhythmShaperState.tsx` grow; net-negative is the goal during Phases 1-3.

## Phases

### Phase 0 — Harvest the free coverage (no refactor)

Write colocated tests for the L0 modules. Zero refactor risk, immediate
coverage. **Prioritize by blast radius, not size:**

1. `playbackRequests.ts` — assembles what's sent to the transport; a bug here is
   audible. Highest value.
2. `channelLogic.ts`, `ratchetDisplay.ts`, `advancedMatrix.ts`,
   `automationTargets.ts` — behavior-shaping logic.
3. `resolvedSections.ts`, `markovWeights.ts`, `synthVoices.ts`,
   `boundaryPlanning.ts`, `huygensFokkerModes.ts` — model/derivation logic.
4. `SeedControls.tsx` pure exports (`parseSeeds`, `seedStrategySummary`,
   `seedStrategyDetail`, `seedToneFor*`, `seedListLabel`, …) — relevant to the
   seed work.
5. `midiDebugFormat.ts`, `formatters.ts`, `rhythmSpeedLabels.ts` — display
   formatting; trivial table-driven tests.
6. `sessionPrefs.ts` — localStorage; test the pure parse/serialize halves,
   inject storage for the rest.

**Done when:** every L0 module has a test; coverage baseline recorded.

### Phase 1 — `seedStrategyModel.ts` (the proof case)

Extract from `SeedSetupDialog.tsx` and test:

- `seedStrategyEffect(mode, maxHistory, rememberedCount, newSeedWeight)` — the
  Evolve copy (currently `strategyEffectText`).
- `freshPercentFromWeights(historyWeight, newSeedWeight)` and
  `weightsFromFreshPercent(pct)` — the familiar↔fresh ↔ weights mapping
  (round-trip + zero-total fallback to 50).
- `nextCycleDotKinds(mode, maxHistory, freshPercent)` — dot preview: count =
  `clamp(maxHistory,1,64)`; locked → all `is-same`; perCycle → `is-new-i%5`;
  Evolve → fresh distribution matches probability, remembered cycle the pool up
  to 8 colours. The meatiest logic; the one most worth pinning.
- `ownBehaviorFor(toggle, current, globalMode)` — Follow → `followGlobal`; Own →
  `current === "followGlobal" ? globalMode : current`.
- `reproducePlan(target, rawSeed)` → `{ scope, seed, lockMode } | null` — parse +
  normalize + which scope + whether to switch to Repeat. `applyReproduce`
  becomes "compute plan → dispatch setters."
- Constants `SEED_STRATEGIES`, `REPRODUCE_TARGETS`.

**Done when:** `SeedSetupDialog.tsx` imports all of the above and contains only
wiring + JSX; `seedStrategyModel.test.ts` covers every branch; the
`launch-plan-first-slice` seed assertions that duplicate unit logic can be
thinned to navigation/integration only.

### Phase 2 — `rhythmShaperModel.ts`

Extract the pure `useMemo` bodies from `useRhythmShaperState.tsx` (call sites
stay as `useMemo(() => build…(deps), [deps])`). First targets:

- `rhythmSeedModeRequest`, `arbitrarySubdivisionSpec` builders.
- `timelineRhythmChains` / `playbackRhythmChains` builders.
- Cache-key builders: `switchRequestKey`, `previewRequestCacheKey`,
  `rhythmPreviewRequestKey` (pure string keys — fast, high-value regression
  fences).
- Fold `rhythmBySpanId`'s preview branch into `timelineModel` next to
  `selectRealizedRhythmBySpanId`.

### Phase 3 — `App.tsx` incremental extraction (ongoing, test-first)

8625 lines / 33 memos. Do **one cluster per PR**, test-first, never big-bang.
Highest-risk first — the spec builders that feed the transport:

- `channelHocketSpec`, `pitchShaperSpec`, `ratchetSpec`, `ornamentSpec`,
  `cycleTempoFluxSpec`, `channelHocketSeedModeRequest`, `pitchSeedModeRequest`,
  `synthProgramRequest` → pure `buildXSpec(inputs)` in `playbackRequests.ts` /
  `channelLogic.ts` / `synthVoices.ts` (extend the existing modules).
- Then overlay/derivation memos: `channelLogicOverrideRows`,
  `parallelPriorityRows`, `seedRecurrenceRows`, `availableAutomationTargets`,
  `automationTargetGroups`.

## Definition of done (per module)

Pure (no react import) · explicit input/output types · colocated `*.test.ts`
covering branches + edges · imported by the component (which keeps only wiring) ·
passes the no-react and has-a-test guardrails.

## Sequencing & effort (rough)

| Phase | Effort | Risk | Payoff |
|---|---|---|---|
| 0 — backfill L0 | 2-3 days | none | large immediate coverage |
| 1 — seedStrategyModel | ~half day | low | covers recent work; proves pattern |
| 2 — rhythmShaperModel | 1-2 days | low-med | rhythm pipeline fences |
| 3 — App.tsx clusters | ongoing | med | shrinks the monolith over time |
| Guardrails | ~half day | low | prevents regrowth |

Recommended order: **Phase 0 (start with `playbackRequests`) → guardrails 1-2 →
Phase 1 → Phase 2 → Phase 3 incrementally.** Land the guardrails early so new
work is held to the standard while the backlog burns down.

## Risks / notes

- Some L0 modules wrap heavy domain math (`huygensFokkerModes`,
  `automationTargets`); test the public contract + a few golden cases, not every
  internal branch — match `randomize.test.ts`'s depth.
- `App.tsx` memos often already delegate to extracted modules; the gap is the
  *assembly/gating* in the memo body. Extract that, don't rewrite the callee.
- Keep `bridge.ts` (mirrored DTO types) on the no-test allowlist — it's covered
  by the DTO golden-fixture contract, not unit tests.
