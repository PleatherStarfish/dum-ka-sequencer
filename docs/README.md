# Dum-Ka documentation

This directory contains the current Dum-Ka references, retained platform
design records, and the extraction audit trail. The root
[README](../README.md) is the shortest user and developer quickstart.

## Read first

For generator authors:

1. [ADDING_A_GENERATOR.md](ADDING_A_GENERATOR.md) — determinism contract,
   Example walkthrough, and exhaustive touch-point checklist.
2. [ARCHITECTURE.md](ARCHITECTURE.md) — ownership boundaries and the shared
   preview/playback path.
3. [TESTING.md](TESTING.md) — fixtures, ledgers, invariant tests, and e2e lanes.

For platform work:

1. [../AGENTS.md](../AGENTS.md) — high-risk invariants and safe workflow.
2. [ARCHITECTURE.md](ARCHITECTURE.md) — Rust/Tauri/React structure.
3. [UI_AND_INTERACTION.md](UI_AND_INTERACTION.md) — current visible surfaces and
   async interaction rules.
4. [KNOWN_RISKS.md](KNOWN_RISKS.md) — parity, queue, persistence, and race risks.
5. [TIMELINE_AUDIO_PARITY_POSTMORTEM.md](TIMELINE_AUDIO_PARITY_POSTMORTEM.md) —
   why cycle-local finalization is load-bearing.

## Current references

- [ARCHITECTURE.md](ARCHITECTURE.md) — repository map, generator seam, data
  flows, persistence, and verification architecture.
- [PRODUCT_VISION.md](PRODUCT_VISION.md) — what Dum-Ka is musically, the
  rhythm-mathematics program behind it, and what a successful generator
  extension preserves.
- [ROADMAP.md](ROADMAP.md) — the Dum-Ka milestone sequence (seed notation →
  evolution operators → displacement → pitch payload → phrase drift).
- [DUMKA_DSL.md](DUMKA_DSL.md) — the seed notation: grammar, required
  structure, sustain rules, and determinism.
- [DUMKA_EVOLUTION.md](DUMKA_EVOLUTION.md) — the evolution fold: Barlow
  operators, the drift leash, trial projection, seed-mode semantics, and
  measured fold cost.
- [DUMKA_EVOLVE_PLAN.md](DUMKA_EVOLVE_PLAN.md) — the implemented evolution
  score: directive schema, per-cycle/linear/gentle operation pacing,
  quota/scope semantics, trace, and editor contract.
- [ADDING_A_GENERATOR.md](ADDING_A_GENERATOR.md) — how to add a generator without
  creating a second preview or transport path.
- [SECTIONS_SUBDIVISIONS_LOGIC_SPEC.md](SECTIONS_SUBDIVISIONS_LOGIC_SPEC.md) —
  fixed section, Subdivision, and Grouping rules.
- [UI_AND_INTERACTION.md](UI_AND_INTERACTION.md) — authoring surfaces, timeline
  truth, draft commit, playback locks, and persistence workflows.
- [TESTING.md](TESTING.md) — local matrix, DTO fixtures, ledgers, fuzz, and CI.
- [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) — setup and contribution
  workflow.
- [FUZZING.md](FUZZING.md) — the four retained libFuzzer targets.
- [GLOSSARY.md](GLOSSARY.md) — current user vocabulary and inherited code names.
- [AI_HANDOFF.md](AI_HANDOFF.md) — compact code map for a new implementation
  session.

## Retained platform specifications

These documents predate the extraction but describe platform behavior Dum-Ka
still carries. Function/line anchors are historical; current code and
[ARCHITECTURE.md](ARCHITECTURE.md) win if they differ.

- [CHANNEL_LOGIC.md](CHANNEL_LOGIC.md),
  [CHANNEL_LOGIC_DESIGN.md](CHANNEL_LOGIC_DESIGN.md), and
  [CHANNEL_LOGIC_PLAN.md](CHANNEL_LOGIC_PLAN.md) — parallel collision semantics
  and their implementation history.
- [TRIGGERED_TRACKS_PLAN.md](TRIGGERED_TRACKS_PLAN.md),
  [TRIGGER_UI_PLAN.md](TRIGGER_UI_PLAN.md), and
  [TRIGGER_UI_REDESIGN.md](TRIGGER_UI_REDESIGN.md) — triggered-track compiler and
  authoring design.
- [CONSECUTIVE_TRACK_BOXES_PROPOSAL.md](CONSECUTIVE_TRACK_BOXES_PROPOSAL.md) —
  the implemented multi-box Track Flow architecture.
- [TRACK_EXPORT_IMPORT_PLAN.md](TRACK_EXPORT_IMPORT_PLAN.md) — portable track
  envelope and import reconciliation.
- [LIVE_EDITING_ARCHITECTURE.md](LIVE_EDITING_ARCHITECTURE.md) and
  [UI_INTERACTION_PERFORMANCE.md](UI_INTERACTION_PERFORMANCE.md) — async
  mutation, latest-wins, and rendering contracts.
- [TIMELINE_AUDIO_PARITY_POSTMORTEM.md](TIMELINE_AUDIO_PARITY_POSTMORTEM.md) and
  [TIMELINE_PARITY_TESTING_PLAN.md](TIMELINE_PARITY_TESTING_PLAN.md) — parity
  failure history and regression strategy.
- [EUCLID_CHANNEL_DESIGN.md](EUCLID_CHANNEL_DESIGN.md) — retained Euclidean
  Channel Shaper assignment.
- [AUTOMATION.md](AUTOMATION.md) — exact-time automation model. Its older target
  inventory is historical; `ui/src/automationTargets.ts` is authoritative.

## Extraction and release records

- [EXTRACTION_PLAN.md](EXTRACTION_PLAN.md) — the source extraction plan.
- [EXTRACTION_DEVIATIONS.md](EXTRACTION_DEVIATIONS.md) — code/plan differences
  encountered during execution.
- [UPSTREAM_FINDINGS.md](UPSTREAM_FINDINGS.md) — findings recorded against the
  read-only source repository.
- [../BASELINE.md](../BASELINE.md) — baseline and phase gate ledger.
- [ACCEPTANCE.md](ACCEPTANCE.md) — complete v0.1.0 automated and manual §12
  checklist, including unexecuted hosted/hardware items.
- [../PROVENANCE.md](../PROVENANCE.md) — source revision and commit lineage.
- [../DEFER.md](../DEFER.md) — intentionally deferred work.

Files not listed as current references are retained design or audit history.
They may use the source product's names or discuss features removed from
Dum-Ka; do not treat them as current product documentation.

## Maintenance rules

- A new generator updates [ADDING_A_GENERATOR.md](ADDING_A_GENERATOR.md) and its
  tests/fixtures in the same change.
- A Rust/Tauri DTO or command change updates
  [ARCHITECTURE.md](ARCHITECTURE.md) and the two-way DTO fixture.
- A visible workflow change updates [../README.md](../README.md) and
  [UI_AND_INTERACTION.md](UI_AND_INTERACTION.md).
- A queue rewrite must preserve cycle-local finalization and add parity coverage.
- Never regenerate DTO fixtures or golden ledgers merely to hide an unexplained
  difference.
