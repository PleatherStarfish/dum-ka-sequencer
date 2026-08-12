# Dum-Ka Agent Guide

Read this before changing code. Dum-Ka is a macOS MIDI sequencer for evolving
bass lines and rhythms, built on the Seqstart quickstart platform: the retained
transport/track/persistence/test platform plus a small deterministic generator
seam. It is not the removed Caesura research feature set.

## Required reading

- [README.md](README.md) — current product surface and quickstart.
- [docs/README.md](docs/README.md) — documentation index.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — ownership and data flow.
- [docs/ADDING_A_GENERATOR.md](docs/ADDING_A_GENERATOR.md) — generator contract.
- [docs/TESTING.md](docs/TESTING.md) — exact verification lanes.
- [docs/TIMELINE_AUDIO_PARITY_POSTMORTEM.md](docs/TIMELINE_AUDIO_PARITY_POSTMORTEM.md)
  — why queue ownership is load-bearing.

## Product model

1. A cycle contains beats.
2. Authored section boundaries occur after beats.
3. Each section has one fixed Subdivision; it subdivides **every beat** in the
   section into that many steps.
4. A section may have one optional fixed Grouping that tiles its structure.
5. Beat-, section-, and grouping-start accents shape velocity.
6. The selected generator receives those structural spans and returns cells.
7. Generated cells become note overlays and are realized through the common
   transport path.
8. Optional Channel Shaper routing assigns final note groups to channels.
9. Parallel Channel Logic resolves same-channel overlap.
10. Timeline playback layers and MIDI come from the same realization.

Internal Rust/DTO names such as gati, jathi, rhythm, and matra survive for
upstream diffability. Do not infer that the stripped stochastic feature set is
still supported.

## High-risk invariants

### Generator and structure

- A Subdivision is per beat, never a division count for the whole section.
- Boundaries are after integer beats in the UI.
- A boundary starts a distinct section even when adjacent sections have the
  same Subdivision.
- `resolve_generator_cycle` is the only generator dispatch. Preview and
  transport must both call it.
- A generator is a pure function of its parameters and
  `GeneratorCycleContext`; no wall clock, OS entropy, global mutable state, or
  float-dependent randomness.
- Generator cells are ordered, non-overlapping, sequentially indexed, and tile
  each input span exactly. A tie may cross only as a paired, sounding interior
  handshake; no tie may enter the first span or leave the final span.
- Identity-seeded decisions must not depend on draw order. Adding/skipping a
  draw may not perturb unrelated cells.
- `generator_enabled: false` must preserve the feature-off byte-identity
  contract in transport ledgers.
- Locked seeds replay byte-identically; Per Cycle and History behavior remains
  deterministic for the same project/cycle state.
- Seed-path trace/replay uses decimal strings across the JavaScript boundary;
  never coerce a 64-bit seed through a JS `number`.

### Timeline and scheduler

- Displayed playback rows come from the realization that produced queued MIDI.
- Late preview/build results are generation-tagged and cannot replace newer
  authored state.
- A pending or stale preview keeps the last truthful rows mounted.
- Playback queue rewrites are cycle-local. Channel hocket/static routing and
  Channel Logic may not reprocess already-finalized future events.
- Note-on/note-off suppression stays paired, including overlap components and
  same-pitch deferral.
- Transport mutations are scheduler-acknowledged; enqueue success alone is not
  an applied-state guarantee.

### Tracks

- A project has at most 16 authored tracks.
- A triggered follower's source is a different existing **continuous** track.
  Self-source, dangling source, and multi-level trigger chains are rejected or
  normalized safely.
- Trigger compilation happens upstream of the hot scheduler loop. Its compiled
  launch list is the one source of truth for follower notes and timeline state.
- Followers realize only not-yet-finalized ticks; no retroactive launch may
  rewrite the queue.
- A muted source may remain a silent trigger source; it does not emit audible
  MIDI or participate in conflicts.
- Each Track Flow box is one synthetic conflict participant even though its
  selected display member and seed-path identity refer to authored tracks.
- Channel Shaper assigns channels per track; Channel Logic decides which
  overlapping parallel participants survive after assignment. Do not collapse
  those stages.

### Persistence and async actions

- `.dumka` and `.dumka-track` are strict version-1 disk envelopes. Removed
  feature keys must fail closed at the Rust invoke boundary.
- In-memory convenience fields are not the disk schema. Spread-copying a patch
  must not bypass the v1 projection.
- An unknown generator kind loads as disabled Example with a warning; it must
  not silently execute as a known variant.
- Imported tracks receive fresh identity and are reconciled into destination
  priority/channel state. Project-specific trigger and seed snapshot state is
  not imported blindly.
- Focused editor drafts flush before save/export/import/project-structure
  actions.
- Patch builds compare against the authored fingerprint captured before their
  async score snapshot. A newer authoring generation must reject the result.
- Latest-wins actions must not let a superseded operation overwrite newer
  status or project state.

## How to work

- Keep semantic edits small and add a regression test that fails on revert.
- Run `. "$HOME/.cargo/env"` before Cargo commands.
- Use Node 22 locally for jsdom/Vitest lanes and pnpm 9.15.4 through Corepack.
- Use `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`, and
  `cargo test --workspace --locked` before calling Rust work complete.
- Use `pnpm --dir ui typecheck`, `pnpm --dir ui lint`,
  `pnpm --dir ui test`, `pnpm --dir ui test:timeline`, and
  `pnpm --dir ui build` for frontend work.
- Run the relevant Playwright mock/real/boot lane for workflow or bridge changes.
- Update both directions of the DTO fixture when the Rust/TypeScript wire shape
  changes; unexplained fixture or golden-ledger churn is a bug, not an update.
- Put new domain logic in a module/component/hook. `App.tsx` is orchestration,
  not the default home for another feature implementation.
- If visible behavior changes, update [README.md](README.md) and
  [docs/UI_AND_INTERACTION.md](docs/UI_AND_INTERACTION.md). If ownership or a
  command/DTO changes, update [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Common mistakes

- Wrong: treat Subdivision 7 over four beats as seven total steps.
  Correct: each beat has seven steps, for 28 steps.
- Wrong: implement a generator-specific preview path.
  Correct: add one exhaustive dispatch arm; preview and playback stay generic.
- Wrong: use a mutable RNG stream whose results shift when cells are reordered.
  Correct: derive each stochastic decision from stable identity and pinned salt.
- Wrong: append a new cycle and then hocket the whole scheduler queue.
  Correct: finalize the temporary cycle, record its metadata, then append it.
- Wrong: make a timeline lane independently guess playback.
  Correct: select the scheduler's recorded layer while playing.
- Wrong: serialize the full in-memory patch object.
  Correct: project and validate the strict v1 disk envelope.
