# AI handoff

Read [../AGENTS.md](../AGENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), and
[ADDING_A_GENERATOR.md](ADDING_A_GENERATOR.md) before semantic work.

## Current build shape

- Product/repository: Dum-Ka / `dum-ka-sequencer` (built on the Seqstart quickstart platform).
- Desktop stack: Rust + Tauri 2 + React 18 on macOS.
- Rust workspace: nine library/bench crates plus `cseq-app`.
- The engine research layers were removed. `cseq-rhythm` now contains the
  generator seam, seed core, and retained Channel Shaper.
- Sections are deterministic fixed Subdivision/Grouping structures.
- Patch, track, and score persistence are fork version 1.
- `cseq-*`, selected `Rhythm*`/gati/jathi identifiers, and `CAESURA_*` e2e env
  names remain intentionally for upstream diffability.

## Start points by task

| Task | Start here |
| --- | --- |
| Add a generator | `crates/cseq-rhythm/src/generators/`, `docs/ADDING_A_GENERATOR.md` |
| Section semantics | `crates/cseq-transforms`, `ui/src/sectionsSubdivisionsLogic.ts`, `ui/src/components/SectionBoundariesPanel.tsx` |
| Preview/build parity | `ui/src/playbackRequests.ts`, `App.tsx` preview effects, `generator_preview` |
| Scheduler/queue | `crates/cseq-transport/src/{engine,parallel,rewrite,layers}.rs` |
| Triggered tracks | `crates/cseq-trigger`, `ui/src/components/TriggerInspector.tsx`, `ui/src/triggerUi.ts` |
| Track Flow | `crates/cseq-transport/src/trackflow.rs`, `ui/src/trackFlowBoxes.ts`, App box handlers |
| Channel Logic | `crates/cseq-transport/src/parallel.rs`, `ui/src/channelLogic.ts`, `ui/src/components/ChannelLogicPanel.tsx` |
| Patch/track persistence | `ui/src/patchIo.ts`, persistence actions in `App.tsx`, Rust validators in `src-tauri/src/main.rs` |
| Tauri commands/DTOs | `ui/src/bridge.ts`, `src-tauri/src/main.rs`, DTO fixtures |
| MIDI/machine prefs | `crates/cseq-midi`, `src-tauri/src/machine.rs`, `ui/src/midiRouting.ts`, `ui/src/machinePrefs.ts` |
| Timeline | `ui/src/timelineModel.ts`, `ui/src/playbackLayers.ts`, `ui/src/components/TimelinePanel.tsx`, transport snapshots |

`App.tsx` and `patchIo.ts` remain large orchestration/schema files. Keep new
domain algorithms elsewhere. Edits there should be narrow and regression-pinned.

## Load-bearing contracts

- `resolve_generator_cycle` is shared by preview and playback.
- Generated cells tile their spans exactly and stochastic decisions are seeded
  by stable identity.
- Playback layers are recorded from the finalized cycle that produced MIDI.
- Hocket/static routing and conflict suppression never rewrite an older
  finalized future cycle.
- A pending/stale preview preserves the last truthful mounted rows.
- Triggered followers compile only future launches; their source graph is one
  continuous level.
- Track Flow display, conflict, and seed-path identities are deliberately
  distinct.
- Patch actions flush drafts, capture authored fingerprint before async build,
  and reject stale generations/revisions.
- Version-1 Rust file validators fail closed on removed-feature keys.
- Seeds cross JS as decimal strings.

## Test map

- Rust unit/property: `cargo test --workspace --locked`.
- Invariants/goldens: `crates/cseq-transport/tests/`.
- DTO contract: `src-tauri/src/main.rs` + `ui/src/dtoContract*.test.ts`.
- UI unit/RTL guardrails: `ui/src/**/*.test.{ts,tsx}`.
- Mock workflows: `ui/tests/e2e/` through `mockTauri.ts`.
- Real Rust boundary: `real-backend-parity.spec.ts` through `realBackend.ts`.
- Isolated frontend boot: `playwright.bootcheck.config.ts`.
- Fuzz: four targets documented in [FUZZING.md](FUZZING.md).

Use [TESTING.md](TESTING.md) for exact gates and regeneration order.

## Persistence notes

The in-memory patch model is richer than the disk shape. Never rely on a hidden
serializer hook surviving object spread. Save/export must explicitly project to
the v1 envelope, and Tauri must validate the payload before writing.

Patch import/recall replaces project state. Track import splices one normalized
track with fresh identity, strips project-local trigger/seed snapshot data, and
reconciles conflict priority/matrix. Both paths are latest-wins and
revision-guarded.

## Working rules

- Prefer symbol search over inherited line numbers.
- A fix needs a test that fails on revert, especially for async timing guards.
- Do not update a fixture or ledger until the semantic difference is understood.
- Never write to `/Users/danielmiller/dev/projects/carnatic-seq`; upstream
  shortcomings belong in [UPSTREAM_FINDINGS.md](UPSTREAM_FINDINGS.md).
- Put out-of-scope improvements in [../DEFER.md](../DEFER.md).
