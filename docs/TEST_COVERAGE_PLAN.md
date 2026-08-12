# Test Coverage Upgrade Plan

**Status:** implemented and verified · **Created:** 2026-05-30

> All four source-product phases below were implemented. The one-shot
> verification handoff was removed during Seqstart extraction;
> `docs/TESTING.md` is the living testing guide.


This plan closes the major gaps identified in the testing audit. It is ordered by return on investment: lock in what already exists (CI), then make the cheapest missing layer real (frontend unit tests), then make gaps visible (coverage), then backfill the thin Rust crates. App.tsx is handled by **incremental extraction**, not an up-front refactor.

## Where we are today (baseline)

- **Rust core is well tested:** ~460 inline `#[test]` fns. Heaviest in `cseq-transport` (175; ~90% of `lib.rs` is its test module), `cseq-rhythm` (109), `cseq-transforms` (83), `cseq-model` (49). Property tests via `proptest!` in 6 crates; 8 libFuzzer targets in `fuzz/` with committed corpora. `cseq-model` already has `insta` for snapshots.
- **Frontend is e2e-heavy, unit-light:** ~5,300 lines of Playwright specs (mature, with Tauri mocks + an app harness) vs. a single vitest file (`ui/src/patchIo.test.ts`, ~1,200 lines) added today in commit `6dbd144`. `App.tsx` (~28k lines) and `bridge.ts` (~1,600 lines) have no direct unit tests.
- **CI runs only fuzzing.** `.github/workflows/fuzz.yml` is the sole workflow (scheduled libFuzzer smoke on `ubuntu-latest`, nightly toolchain, `Swatinem/rust-cache`). There is **no** job running `cargo test`, `cargo clippy`, `vitest`, or `playwright`. Notably, `playwright.config.ts` already branches `reporter` on `process.env.CI` — CI was anticipated but never built.
- **No coverage tooling** anywhere. No `rust-toolchain.toml`. No node/pnpm version pin in `ui/package.json` (CI will need one for reproducibility).

## Guiding principles

1. **Lock before you build.** Get existing tests gating merges before writing new ones, so coverage can't regress while we work.
2. **Test-first for extractions.** When pulling logic out of `App.tsx`, write the vitest spec against the new pure module in the same change.
3. **Pure logic → vitest; rendered behavior → Playwright.** Don't reach for a DOM/component renderer when the logic can be a pure function. Reserve Playwright for genuinely UI/integration concerns.
4. **Determinism.** Seeded RNG, fixed clocks, no real timers/network in unit tests. The codebase already favors seeded generation — keep it.
5. **Ratchet, don't gate hard, on coverage.** Start by *measuring*; only enforce thresholds once a baseline is known, and ratchet upward.

---

## Phase 1 — CI enforcement (highest ROI, do first)

**Goal:** every push/PR runs the suites that already exist, on Linux, with caching. This alone protects 460 Rust tests + the vitest unit + 8 Playwright specs that today rely on local runs.

### 1.1 Pin toolchains for reproducibility
- Add `rust-toolchain.toml` (channel pinned to the stable rustc version required by the locked dependency graph; components `rustfmt`, `clippy`, and `llvm-tools-preview` for coverage).
- Add a `packageManager` field (pnpm, matching the lockfile) and an `engines.node` range to `ui/package.json`; optionally `.nvmrc`. CI will key Node/pnpm setup off these.

### 1.2 Rust CI workflow — `.github/workflows/rust.yml`
Triggers: `push` to main + `pull_request`. Runner `ubuntu-latest`. Steps:
- `actions/checkout@v4`, `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2` (mirror fuzz.yml's cache).
- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace --locked`
- (Build only, no run) `cargo build -p cseq-app` to catch the Tauri crate compiling
  (the src-tauri package name is `cseq-app`).
- Reuse the fuzz workflow's `build-fuzz-targets` idea only if cheap; the scheduled fuzz job stays separate.

### 1.3 Frontend CI workflow — `.github/workflows/ui.yml`
Triggers: same. Runner `ubuntu-latest`. Steps:
- Checkout, `pnpm/action-setup`, `actions/setup-node@v4` (cache pnpm), `pnpm --dir ui install --frozen-lockfile`.
- `pnpm --dir ui typecheck` (`tsc --noEmit`).
- `pnpm --dir ui lint` (see 1.5 — fix the eslint config first or this fails).
- `pnpm --dir ui test` (vitest run).
- `pnpm --dir ui test:timeline` (the `node --test` timeline check).
- Build smoke: `pnpm --dir ui build`.

> **Linux native-binary note:** `vite`/`vitest`/`esbuild`/`rollup` need Linux-arch native binaries. On a clean CI checkout `pnpm install` fetches the correct ones automatically (unlike a committed macOS `node_modules`), so this "just works" in CI even though it needs a manual binary fetch in a macOS-mounted sandbox. Document this in the workflow comment so future debugging doesn't chase a non-issue.

### 1.4 Playwright in CI — `.github/workflows/e2e.yml` (separate, may be `pull_request` + nightly)
Playwright is slower and heavier; isolate it so a flaky browser run doesn't block the fast lane.
- Checkout, Node/pnpm setup, `pnpm --dir ui install --frozen-lockfile`, `pnpm --dir ui exec playwright install --with-deps chromium`.
- `pnpm --dir ui test:e2e` for the stable browser suite (the config's `webServer` boots `pnpm dev`; `reporter` is already CI-aware). The stable suite is run serially because these integration specs share one app/server harness and are not yet parallel-safe.
- Exclude fuzz/chaos variants from PR runs; optionally run `test:e2e:fuzz` (bounded) + `test:e2e:chaos` (bounded) on the nightly schedule only. Keep the `:soak` variants local/manual.
- Upload the Playwright HTML report + traces on failure (`actions/upload-artifact`), mirroring how fuzz.yml uploads crash artifacts.

### 1.5 Fix lint config (blocker for 1.3)
- `pnpm --dir ui lint` runs `eslint src --ext ts,tsx`, but no `.eslintrc*`/`eslint.config.*` is present at the expected paths. Locate or add a flat `eslint.config.js` (TS + React Hooks rules) so `lint` actually runs in CI rather than erroring or no-opping.

### 1.6 Branch protection
- Once green, mark the Rust + UI fast-lane jobs as required status checks on the default branch. (e2e can stay non-blocking until proven stable.)

**Acceptance:** a PR that breaks a Rust test, a vitest assertion, types, or lint fails CI. Fast lane (Rust + UI unit/type/lint/build) completes in a few minutes; Playwright runs on its own lane.

**Est. size:** S–M. Mostly YAML + small config files; no production-code change except the eslint config.

---

## Phase 2 — Frontend unit layer (biggest coverage hole)

**Goal:** make pure TypeScript logic fast-testable and actually tested, growing the vitest layer beyond its single file. App.tsx is addressed by **incremental extraction** (Phase 4), so Phase 2 targets already-modular code plus a small, safe first extraction.

### 2.1 Broaden vitest config
- `vitest.config.ts` currently includes only `src/**/*.test.ts`. Keep co-located specs, but confirm `.tsx` is matchable for future component tests (`src/**/*.test.{ts,tsx}`).
- Decide environment per-file: keep `node` as default (pure logic); add `// @vitest-environment jsdom` opt-in for any future component/DOM test (add `jsdom` as a dev-dep only if/when needed).
- Add `@testing-library/react` + `@testing-library/user-event` to dev-deps **only when** the first component test lands (don't add unused tooling now).

### 2.2 Test `bridge.ts` seam logic (no Tauri required)
`bridge.ts` is mostly thin `invoke` wrappers, but it contains pure, testable pieces: the file-filter constants, default-filename/dialog argument shaping, the DTO type-mirroring, and any normalization. Target the **pure** functions and the **invoke argument contracts** (e.g. assert `trackSaveToPath` calls `invoke("track_save_to_path", { path, document })`) by mocking `@tauri-apps/api/core`'s `invoke` with `vi.fn()`. This catches Rust↔bridge command/param-name drift — a class of bug that otherwise only surfaces at runtime.

### 2.3 Deepen `patchIo.ts` coverage
`patchIo.ts` (~4,600 lines) is the serialization/normalization brain and the most valuable pure module. The new `patchIo.test.ts` covers track export/import; extend systematically to the rest:
- Round-trip + idempotence for `readPatchDocument` across schema v1/v2/v3 (legacy migration paths).
- `normalizeParallelProjectPatch` / `flattenProjectPatchForActiveTrack` / `withProjectState` invariants (active-track flattening, project↔flat consistency).
- Each `normalize*` validator's clamping and drop-gate behavior on malformed input (fuzz-style: feed garbage, assert a valid normalized result or a clean throw).
- The custom-subdivision save/load gate (already partially covered) — keep as regression anchors.

### 2.4 Establish patterns + fixtures
- Promote the fixture builders in `patchIo.test.ts` (`makeFlatState`, `makeTrack`, `makeProjectFixture`) into a shared `src/__fixtures__/patch.ts` so future specs reuse them.
- Write a short `docs/TESTING.md` "how we test the frontend" note: when to use vitest vs Playwright, the fixture helpers, the invoke-mock pattern, determinism rules.

**Acceptance:** `bridge.ts` invoke-contract tests and expanded `patchIo` tests pass in CI; the shared fixtures + `TESTING.md` exist. Vitest file count goes from 1 to several; pure serialization/bridge logic no longer depends on Playwright for coverage.

**Est. size:** M. Pure additive test code + tiny config tweak.

---

## Phase 3 — Coverage measurement (make gaps visible, then ratchet)

**Goal:** quantify coverage on both sides and surface it on PRs, so progress is tracked and regressions are visible. Measure first; enforce thresholds only after a baseline.

### 3.1 Rust coverage
- Add `cargo-llvm-cov` to the Rust CI job: `cargo llvm-cov --workspace --lcov --output-path lcov-rust.info` (llvm-cov is the modern, accurate choice vs. tarpaulin).
- Upload to a coverage service (Codecov/Coveralls) or just publish the summary as a CI artifact + PR comment.
- **Don't** gate on a hard % yet. Record the baseline (transport/rhythm/transforms will be high; midi/persist/realize low — that informs Phase 4 targets).

### 3.2 Frontend coverage
- Enable vitest's V8 coverage: `vitest run --coverage` (add `@vitest/coverage-v8` dev-dep; configure `coverage.include = ["src/**"]`, exclude tests/fixtures).
- Publish the summary the same way.
- Expect a low number initially (App.tsx dominates lines and is untested) — that's the point; it makes the monolith's risk legible.

### 3.3 Ratchet policy
- After two weeks of baseline data, set a **non-decreasing** threshold per side (fail CI if coverage drops more than a small delta), not an absolute target. Raise it as Phases 2/4 land.
- Optionally add per-PR diff coverage ("new/changed lines must be ≥ X% covered") — this is the highest-signal gate for a large untested monolith because it forces *new* code to be tested without demanding a big-bang backfill.

**Acceptance:** every PR shows Rust + frontend coverage deltas; a documented ratchet (or diff-coverage) policy is in place. No flakiness introduced.

**Est. size:** S. Tooling + CI wiring; no production-code change.

---

## Phase 4 — Backfill thin Rust crates + App.tsx incremental extraction

**Goal:** raise the floor where Rust coverage is thinnest, and convert App.tsx logic into tested modules opportunistically.

### 4.1 Backfill under-tested Rust crates (targets from the audit)
Prioritize by risk × current thinness:
- **`cseq-persist` (4 tests):** it's the serialization boundary — round-trip every persisted type, malformed-input rejection, schema/version handling, and (paired with `src-tauri`) the file save/load commands. High value for low effort.
- **`cseq-midi` (2 tests):** MIDI byte encoding/decoding edge cases (channel/program/drum-note ranges, status bytes, running status if any). Pure and easy to table-test.
- **`cseq-realize` (15 tests):** realization is core to output correctness — add property tests (it already has `proptest`) for invariants across random scores, plus regression cases for any past defects.
- **`src-tauri` (23 tests, ~17% of `main.rs`):** add unit tests for the command DTO validators (`validate_patch_document`, `validate_track_document`, `validate_current_patch_document`) and the patch/track save/load passthrough — assert app/kind/schema rejection and verbatim JSON round-trips. This pairs naturally with the new track export/import work.
- Use `insta` (already a dev-dep in `cseq-model`) for snapshot-testing complex serialized structures where hand-writing expected values is brittle; add it to other crates' dev-deps as needed.

### 4.2 App.tsx incremental extraction (test-first, opportunistic)
Do **not** do a big-bang refactor. The rule: **whenever a feature touches a chunk of App.tsx logic that is pure (no React state/effects), extract it into a `src/` module and land a vitest spec in the same PR.** Good early candidates (pure, high-value, low-risk):
- Filename/slug helpers (`defaultPatchFilename`, `defaultScoreFilename`, `defaultTrackFilename`), `fileNameFromPath`.
- Track-list/identity helpers already factored conceptually (`uniqueParallelTrackId`, name de-dup, color pickers) — consolidate the App.tsx copies with the patchIo ones to remove duplication and test once.
- Any reducer-like state transforms (e.g. the project-mutation helpers around `applyParallelProject`/`updateParallelProjectMetadata`) that can be expressed as `(state, action) => state`.
- Derived-value computations (badges, summaries, validation predicates) that take inputs and return display data.
- Track a running checklist in `docs/TESTING.md` of "extracted & tested" vs. "still inline" so progress is visible without forcing a refactor sprint.

> Rationale for incremental: App.tsx is ~28k lines and central; an up-front carve-out carries high merge-conflict and regression risk relative to the payoff. Extracting along the grain of feature work spreads the risk and guarantees each extraction has a real test exercising it.

### 4.3 Targeted component/DOM tests (only where e2e is too slow/coarse)
For a handful of intricate widgets (e.g. the automation curve editor, the boundary/subdivision controls, the passage notation staff), consider `@testing-library/react` component tests once the relevant logic is extractable — but default to Playwright for full UI flows. Add `jsdom` + testing-library only at this point.

**Acceptance:** `cseq-persist`/`cseq-midi`/`cseq-realize`/`src-tauri` coverage rises measurably (visible via Phase 3); App.tsx line count trends down as pure logic moves into tested modules; the extraction checklist is maintained.

**Est. size:** L, but spread over time — 4.1 is a bounded backfill; 4.2 is continuous and rides on normal feature work.

---

## Sequencing & dependencies

```
Phase 1 (CI) ──► Phase 2 (FE unit) ──► Phase 3 (coverage) ──► Phase 4 (backfill + extraction)
     │                                        ▲                         │
     └─ 1.5 eslint fix (blocker for 1.3)      └─ baseline informs ──────┘ 4.1 crate targets
```

- **Phase 1 first** — it protects everything else and is mostly config.
- **Phase 2 before 3** — having a few real frontend unit tests makes the coverage number meaningful rather than just "App.tsx is 0%".
- **Phase 3 before/with 4** — the coverage baseline tells you which crates and which App.tsx regions to attack first.
- **4.2 is ongoing** and intentionally never "finished" as a phase; it's a working norm.

## Risks & non-goals

- **Playwright flakiness in CI** is the main risk. Mitigation: isolate it on its own lane, keep PR runs to the stable browser suite, run bounded fuzz/chaos variants only on schedule, upload traces on failure. Don't make e2e a required check until it's proven stable.
- **Native-binary confusion** (rollup/esbuild on Linux): a non-issue in clean CI; documented in the workflow comment so it isn't re-debugged.
- **Coverage theater:** absolute % targets invite low-value tests. The plan deliberately uses non-decreasing ratchet + diff-coverage instead.
- **Non-goal:** rewriting App.tsx. Extraction is opportunistic and test-gated, not a sprint.

## Definition of done (program-level)

- PRs run Rust (fmt/clippy/test) + frontend (type/lint/vitest/timeline/build) as required checks; Playwright runs on its own lane.
- Vitest covers `patchIo`, `bridge` contracts, and a growing set of extracted App.tsx logic; shared fixtures + `docs/TESTING.md` exist.
- Rust + frontend coverage are reported on every PR with a non-decreasing (or diff-coverage) gate.
- `cseq-persist`, `cseq-midi`, `cseq-realize`, and `src-tauri` command/validator paths have meaningful tests; App.tsx pure-logic surface is shrinking and tested as it moves.
