# Testing

Dum-Ka uses overlapping test layers to pin pure generation, scheduler
invariants, the hand-mirrored Rust/TypeScript DTO boundary, persistence, and
desktop workflows. Run Cargo commands after `. "$HOME/.cargo/env"`; use Node 22
and pnpm 9.15.4 for local frontend lanes.

## Full local gates

From the repository root:

```bash
. "$HOME/.cargo/env"
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
cargo test -p cseq-transport --features fuzzing --test invariants --locked
cargo test -p cseq-transport --features fuzzing --test golden_ledgers --locked
cargo build -p cseq-app --locked
cargo check --manifest-path fuzz/Cargo.toml --locked
```

From `ui/`:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:timeline
pnpm build
pnpm test:e2e
pnpm test:e2e:real
pnpm exec playwright test --config playwright.bootcheck.config.ts main-editor-launcher --workers=1
```

The mock suite uses Vite plus `ui/tests/e2e/support/mockTauri.ts`. The real suite
builds `cseq-app --features e2e-harness` and drives the same React app through
the Rust HTTP invoke bridge. The bootcheck uses an isolated Vite port to prove
the frontend transform and main editor reach first render; it is not a packaged
Tauri launch.

## Layers

| Layer | Location | Contract |
| --- | --- | --- |
| Rust unit/property | inline tests and crate-local `tests/` | model, transforms, generator, trigger, persistence, scheduler helpers |
| Transport invariants | `crates/cseq-transport/tests/invariants.rs` | deterministic replay, note balance, queue and feature-off invariants |
| Golden ledgers | `crates/cseq-transport/tests/golden_ledgers.rs` | exact MIDI ledger for every example score |
| DTO contract | `src-tauri/src/main.rs`, `ui/src/dtoContract*.test.ts` | Rust serialization and TypeScript builder/parser agree |
| Frontend unit/RTL | `ui/src/**/*.test.{ts,tsx}` | reducers, normalization, controls, async guards |
| Guardrails | `modelCoverage`, `componentCoverage`, `e2eHarnessContract` | enums/components/commands cannot drift silently |
| Timeline node lane | `ui/tests/timelineModel.test.cjs` | pure timeline selection outside jsdom |
| Mock Playwright | `ui/tests/e2e/*.spec.ts` | complete workflows with deterministic driver state |
| Real Playwright | `real-backend-parity.spec.ts` | real Rust command/IO/transport parity |
| Bootcheck | `playwright.bootcheck.config.ts` | isolated frontend boot and first render |
| Fuzz | `fuzz/fuzz_targets/` | malformed persistence, score pipelines, parallel queue |
| Performance | `scripts/perf-check.py`, `scripts/perf-baseline.json` | retained Rust and UI interaction baselines |

## DTO fixtures

DTO fixtures are generated in a fixed direction/order because both languages
mirror the same shape. Regenerate only for an intentional wire change:

```bash
. "$HOME/.cargo/env"
UPDATE_DTO_FIXTURES=1 cargo test -p cseq-rhythm rust_parser_contract_fixture_matches
UPDATE_DTO_FIXTURES=1 cargo test -p cseq-app dto_fixture
cd ui
pnpm vitest run -u src/dtoContract.generate.test.ts
```

Review the diff, then verify without update variables:

```bash
cd ..
cargo test -p cseq-rhythm rust_parser_contract_fixture_matches
cargo test -p cseq-app dto_fixture
cd ui
pnpm vitest run src/dtoContract.generate.test.ts
```

Fixture churn must be an atomic `regen:` commit with its cause. P9's final
verification expects both update commands to be no-ops.

## Golden ledgers

Every `examples/scores/*.json` input is also a ledger input. Verify with:

```bash
. "$HOME/.cargo/env"
cargo test -p cseq-transport --features fuzzing --test golden_ledgers --locked
```

`UPDATE_GOLDEN_LEDGERS=1` is permitted only in a phase that explicitly sanctions
ledger churn. Always inspect values, rerun clean, and keep the regeneration
atomic. An unexpected P9 difference is a regression.

## Focused regression expectations

- A generator change needs pure determinism/tiling tests, exhaustive variant
  coverage, DTO/normalizer coverage, and at least a UI or e2e smoke.
- A cumulative pacing change also needs pinned per-cycle request vectors,
  monotone/exact integer endpoint properties, duration-one compatibility, and
  a semantic adjacent-cycle rhythm-distance assertion. A trace count alone is
  insufficient because one Rotate/Figure/Euclid application may affect many
  notes.
- A preview/playback change needs a stale-result test and timeline/MIDI parity
  coverage.
- A queue rewrite needs note-balance and future-cycle non-rewrite coverage.
- A persistence change needs normalization idempotence, spread/projection,
  Rust boundary rejection, and save/reload/import coverage.
- An async action needs a test that mutates authored state during the awaited
  work and proves the result is rejected.
- Tests should fail when the implementation fix is reverted. Assertions may be
  strengthened, never replaced by waiting less or accepting a stale state.

For Dum-Ka gradual ranges, keep all three distinct proofs:

1. Rust fold tests prove Linear/Gentle schedules, exact targets, deterministic
   identity, scope/projection safety, and no delayed catch-up after a veto.
2. A full-window golden plus semantic onset/slot assertions proves the musical
   path, while the existing `dumka_planned` golden remains the legacy
   `perCycle` compatibility anchor.
3. Real-backend Playwright compares each stopped transition cycle's exact spans
   with sequential scheduler snapshots, including a History-seed case. The
   mock lane covers editing/persistence only and must continue to fail loudly
   for a folded evolving cycle.

## Fuzz and deep sweeps

The four libFuzzer targets are documented in [FUZZING.md](FUZZING.md). Compile
them with the fuzz gate above. A deeper invariant sweep can be run with:

```bash
. "$HOME/.cargo/env"
PROPTEST_CASES=4096 cargo test -p cseq-transport --features fuzzing --test invariants --locked
```

Nightly fuzz/chaos/soak jobs complement, rather than replace, the deterministic
push/PR matrix.

## CI

Four workflows mirror the local responsibilities:

- `.github/workflows/rust.yml`
- `.github/workflows/ui.yml`
- `.github/workflows/e2e.yml`
- `.github/workflows/fuzz.yml`

Keep Node 20 in CI unless the workflow pin is deliberately changed; Node 22 is
the supported local jsdom lane. The release acceptance target is all four
workflows green with no expected-failure ledger entries.
