# Development workflow

## Toolchain

- macOS 11+ for the desktop/MIDI app.
- Rust 1.88.0 through the repository's `rust-toolchain.toml`.
- Node 22 locally for jsdom/Vitest.
- pnpm 9.15.4 through Corepack.
- Tauri CLI 2 for `cargo tauri dev/build`.

```bash
cd /Users/danielmiller/dev/projects/dum-ka-sequencer
. "$HOME/.cargo/env"
corepack prepare pnpm@9.15.4 --activate
pnpm --dir ui install --frozen-lockfile
cargo install tauri-cli --version '^2.0'
```

## Run

```bash
. "$HOME/.cargo/env"
cargo tauri dev
```

Tauri starts Vite through `src-tauri/tauri.conf.json`. Running `pnpm --dir ui
dev` alone is useful for layout work, but normal Tauri commands are unavailable
unless an e2e harness supplies them.

Build the distributable app/DMG with:

```bash
. "$HOME/.cargo/env"
cargo tauri build
```

## Change discipline

- Keep commits focused: one logical move, strip, or semantic change.
- Never combine a pure move with edits; this preserves reviewable provenance.
- Add a regression test that fails when the implementation is reverted.
- Keep generated DTO fixtures or golden ledgers in an atomic `regen:` commit
  with the change that requires them.
- Do not accept unexplained fixture/ledger churn.
- Preserve unrelated work in a dirty tree.
- `App.tsx` is cross-domain orchestration; prefer pure modules, components, and
  hooks for new behavior.

## Checks

Run the relevant focused test while iterating. Before handoff, run the complete
gate for the changed layer. The canonical commands are in
[TESTING.md](TESTING.md).

Minimum Rust handoff:

```bash
. "$HOME/.cargo/env"
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
```

Minimum frontend handoff:

```bash
pnpm --dir ui typecheck
pnpm --dir ui lint
pnpm --dir ui test
pnpm --dir ui test:timeline
pnpm --dir ui build
```

Workflow/bridge changes also run the relevant mock, real-backend, and/or
bootcheck Playwright lane. Generator, queue, persistence, and DTO changes need
the specialized gates described in [TESTING.md](TESTING.md).

## Documentation ownership

- Generator contract: [ADDING_A_GENERATOR.md](ADDING_A_GENERATOR.md).
- Crates, commands, DTOs, persistence, data flow:
  [ARCHITECTURE.md](ARCHITECTURE.md).
- Visible workflows: [../README.md](../README.md) and
  [UI_AND_INTERACTION.md](UI_AND_INTERACTION.md).
- Fragile invariants: [KNOWN_RISKS.md](KNOWN_RISKS.md) and
  [../AGENTS.md](../AGENTS.md).
- Source-extraction discoveries: [UPSTREAM_FINDINGS.md](UPSTREAM_FINDINGS.md),
  never a write to the source repository.

## MIDI verification

For audible local smoke, enable the built-in synth and press Play. For external
routing, select a destination in Audio & MIDI Setup or connect `Dum-Ka MIDI`
in Audio MIDI Setup/your DAW. Confirm panic releases active notes, destination
hot-plug updates status, and timeline generator/channel rows match audible
output.
