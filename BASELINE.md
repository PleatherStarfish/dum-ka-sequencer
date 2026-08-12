# P0 Baseline Gate Ledger

Source: `carnatic-seq @ be8b1b8`

Baseline recorded 2026-08-03 on macOS with Rust 1.88.0, Node 22.23.1, pnpm 9.15.4 via Corepack, and Playwright 1.42.1 Chromium. Later phases are judged against this ledger, not absolute green, until P8 explicitly clears the expected-fail list.

## Required local preconditions

```bash
. "$HOME/.cargo/env"
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 22
mkdir -p /tmp/sequencer-quickstart-corepack
corepack enable pnpm --install-directory /tmp/sequencer-quickstart-corepack
export PATH="/tmp/sequencer-quickstart-corepack:$PATH"
```

Run UI-GATE once before a clean-tree RUST-GATE because Tauri's `generate_context!` requires `ui/dist` to exist (deviation D-002).

## Gate results

### RUST-GATE — PASS

```bash
cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace --locked && cargo test -p cseq-transport --features fuzzing --test invariants --locked && cargo test -p cseq-transport --features fuzzing --test golden_ledgers --locked && cargo build -p cseq-app --locked
```

Result: exit 0. Invariants: 21 passed. Golden ledgers: 7 passed. No ledger files changed.

### FUZZ-GATE — PASS

```bash
cargo check --manifest-path fuzz/Cargo.toml --locked
```

Result: exit 0.

### UI-GATE — PASS WITH INHERITED WARNINGS

Run from `ui/`:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:timeline && pnpm build
```

Result: exit 0. Vitest: 85 files / 1152 tests passed. Timeline: 26 passed. ESLint: 0 errors and 41 inherited warnings. Vite reports the inherited >500 kB chunk warning.

### FIXTURES verify — PASS

```bash
cargo test -p cseq-app dto_fixture
```

Result: exit 0, 9 passed.

From `ui/`:

```bash
pnpm vitest run src/dtoContract.generate.test.ts
```

Result: exit 0, 3 passed. Working tree stayed clean.

### E2E-MOCK — HISTORICAL P0 FAILURES (all closed by P8)

The spec line numbers in this P0 ledger are historical. The two cases retained
through the initial P8 attempt later moved from `:1245`/`:336` to
`:1129`/`:327` as tests were stripped and reorganized.

Run from `ui/`:

```bash
pnpm test:e2e
```

Historical P0 result: exit 1, 100 passed / 4 failed:

1. `patch-persistence.spec.ts:1245` — editing global BPM while the active track is custom sends `123` to track tempo twice.
2. `patch-persistence.spec.ts:1582` — rich-patch roundtrip expands ratchet time-curve choices, violating the expected saved shape.
3. `timeline-playback-parity.spec.ts:336` — stale-playing-preview setup never records pending preview cycle 1.
4. `track-export-import.spec.ts:9` — imported track is not added; `.parallel-track-cell` remains at count 1.

### E2E-BOOT — PASS

Run from `ui/`:

```bash
pnpm exec playwright test --config playwright.bootcheck.config.ts main-editor-launcher --workers=1
```

Result: exit 0, 8 passed.

### E2E-REAL — HISTORICAL P0 TEST-CAPTURE FAILURE (closed in P9)

Run from `ui/`:

```bash
pnpm test:e2e:real
```

Historical P0 result: exit 1, 7 passed / 1 failed:

1. `real-backend-parity.spec.ts:218` — after a stopped gati-7 edit, the test
   inspected the startup `score_create_subdivision_switch` request (subdivision
   4) instead of the current `score_preview_subdivision_switch` request. The
   real preview and rendered timeline were already subdivision 7. P9 corrected
   the capture and strengthened it to require the exact one-entry weight list.

## Expected-fail contract — CLOSED

Current expected failures: **none**. The five P0 failures above are retained only
as historical evidence; each was removed with its sanctioned phase or closed by
P8. Any later red must be investigated before a green tag.

## P8 closure

The amended P8 scope closes the final two inherited failures and the adversarial
review fixes. The expected-fail list is empty.

From `ui/`:

```bash
pnpm test:e2e
```

Result: exit 0, 91 passed. Global/custom BPM isolation, stale-preview parity,
both fingerprint-timing regressions, and both track-import scenarios pass.

```bash
. "$HOME/.cargo/env"
cargo build --manifest-path ../Cargo.toml -p cseq-app --features e2e-harness
pnpm exec playwright test --config playwright.real.config.ts --workers=1 --grep "track export and import"
```

Result: exit 0, 1 passed. Real track save/load/import uses the Rust backend.

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:timeline && pnpm build
```

Result: exit 0. Vitest: 64 files / 637 tests passed. Timeline: 23 passed.
ESLint: 0 errors and 27 ledgered warnings. Vite retains the ledgered chunk-size
warning.
