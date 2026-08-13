# Dum-Ka Architecture

Dum-Ka is a Tauri 2 desktop app with a Rust sequencing engine and a
React/TypeScript authoring surface. The architectural contract is simple:
TypeScript owns drafts and project-file projection; Rust owns structural
resolution, generator execution, transport, and MIDI. Timeline playback layers
are snapshots of the same cycle-local realization that produced audible MIDI.

## Repository map

```text
dum-ka-sequencer/
  Cargo.toml                  Rust workspace
  crates/
    cseq-model/               exact musical data and automation
    cseq-transforms/          deterministic section/tree transforms
    cseq-rhythm/              generator seam, seed core, channel hocket
    cseq-trigger/             pure triggered-track evaluator/compiler
    cseq-realize/             duration tree to note events
    cseq-transport/           scheduler, parallel runtime, playback layers
    cseq-midi/                CoreMIDI and built-in synth adapters
    cseq-persist/             version-1 score JSON
    cseq-bench/               retained engine benchmarks
  src-tauri/                  commands, validation, menus, machine prefs
  ui/                         React app, patch projection, tests and harnesses
  fuzz/                       five libFuzzer targets
  examples/scores/            score fixtures and golden-ledger inputs
```

The `cseq-*` crate names, several `Rhythm*` Rust types, and `CAESURA_*`
environment variables are intentionally retained for source diffability and
harness compatibility. They do not describe Dum-Ka's current product surface.

## Ownership boundaries

### Model and deterministic structure

`cseq-model` defines exact rational timing, duration/accent trees, stable IDs,
section pulse spans, automation curves, and version-1 `Score` data. Musical
time stays rational until transport maps it to ticks.

`cseq-transforms` applies the score pipeline and resolves the authored section
plan. Sections start at beat boundaries. Each section has one fixed
Subdivision per beat and an optional fixed Grouping. Legacy internal names such
as `SubdivisionSwitchSpec`, `GatiBeat`, and `JathiPulse` remain on this boundary;
the resolver no longer rolls weighted research choices.

`cseq-realize` is the small deterministic compiler from an effective duration
tree to note events. It has no UI, Tauri, or scheduler responsibility.

### Generator seam and channel assignment

Despite its inherited name, `cseq-rhythm` now has three jobs:

1. Define the exhaustive `GeneratorConfig` enum and `CycleGenerator` contract.
2. Resolve Locked, Per Cycle, and History seeds using the canonical
   `SplitMix64`/`mix_seed` implementation.
3. Assign final note groups to channels through the retained Markov or
   Euclidean Channel Shaper.

The seam lives in `crates/cseq-rhythm/src/generators/`:

```text
GeneratorConfig + GeneratorCycleContext
              │
              ▼
     resolve_generator_cycle
              │ exhaustive match
              ▼
       CycleGenerator::generate
              │
              ▼
       Vec<GeneratedSpan>
```

History is sequential state with a pure random-access projection: stopped
preview replays the authored structural and generator pools from cycle 0 to
the requested cycle, while transport retains those same mutations as it
advances. This keeps cycle-N preview and playback identical without letting a
preview request mutate authored state.

`GeneratorCycleContext` supplies track identity, cycle, cycle length, input
spans, a caller-resolved seed, and a cycle-aware automation sampler. Each
`GeneratorSpanInput` also carries the exact per-beat Subdivision derived from
its source `PulseSpan`; this distinguishes a shorter Grouping tile from a real
grid change without reconstructing rational geometry from preview floats. A
generator returns ordered cells that exactly tile each input span. Adjacent
spans may form a sounding paired tie handshake: left `tiedToNext` and right
`tiedFromPrevious`. The validator rejects dangling, silent, first-incoming,
and final-outgoing halves. Dum-Ka requires the metadata to be present and
uniform across the cycle. It cannot
choose its own wall clock, entropy source, or seed lifecycle.

Two variants ship today. Example emits one cell per step: density 100 takes
no RNG branch; lower values make identity-seeded Bernoulli rest decisions.
Dumka compiles a seed-notation pattern (persisted verbatim in its config;
see [DUMKA_DSL.md](DUMKA_DSL.md)) to exact rational events, folds its seeded
evolution operators through the requested cycle, and projects the result onto
the input spans. Its optional ordered evolution plan schedules deterministic
family quotas and beat scopes inside that same fold. A range may retain the
legacy per-cycle quota or distribute one fixed start quota through an
integer-only linear/smoothstep transition; the latter paces operator
applications and is not a second renderer or an audio crossfade. The fold's
density corridor is an onset-count invariant shared by stochastic and planned
families; automation and directive-local overrides are sampled inside the
historical fold, and trace reports independent corridor clamps. Empty-plan
dispatch stays on the byte-compatible legacy path. `resolve_generator_cycle_with_trace`
wraps the exhaustive resolver for stopped authoring preview, while the
transport-facing `resolve_generator_cycle` delegates to it and returns only
spans. Parse and structure mismatches are pinned `GeneratorError`
Display strings; a Rust-generated parser corpus gates the TypeScript editor
mirror. Preview calls the trace-returning wrapper and transport calls its
span-only delegate; both share the same exhaustive dispatch and generator
implementation, so adding a variant does not create a second preview algorithm. See
[ADDING_A_GENERATOR.md](ADDING_A_GENERATOR.md).

M3.95 adds a working lattice inside that same fold. `dumka/depth.rs` validates
the authored prime palette, derives `workingSubdivision`, prices reduced
within-beat attack denominators with exact scaled Barlow indigestibility, and
computes two deliberately orthogonal observables: mean state complexity and
normalized denominator entropy. Only mean complexity participates in the
complexity corridor; depth diversity is preview insight and never candidate
admission. Corridor Promote/Demote candidates sort by the smallest positive
depth-price change before displacement, so refinement walks the cheapest
depth ladder rather than jumping to the nearest but most exotic slot.

`dumka/spectrum.rs` supplies a pinned Q16 low-harmonic placement field.
`placementBias` blends its gap-seeking order with Barlow order before the
existing temperature pool; bias 0 is the legacy identity endpoint. This
spectral objective can diverge from a Bjorklund necklace and is not the Euclid
operator in disguise. `ui/src/dumkaMetrics.ts` mirrors the display-only order
from Rust-emitted roots and cases with the same integer recurrence; it is not a
second playback resolver. The directive-only Morph family compiles its target
onto the same working lattice, aligns attacks by exact circular transport/edit
cost, and exposes one legal micro-step at a time to ordinary quota or
perceptual prefix pacing. Density, complexity, scope, tie, and projection
guards remain common admission predicates. Exact formulas and non-claims are
in [DUMKA_TREE_DEPTH.md](DUMKA_TREE_DEPTH.md).

A deterministic plan row may instead opt into the versioned perceptual
step-size planner in `dumka/perceptual.rs` + `evolve.rs`. It scores the
directive's incoming state against every reachable legal operator prefix,
including the corridor-normalized zero-operation hold, and selects the prefix
nearest its fixed-point target; equal errors choose the smaller prefix. The
target replaces intensity, `maxOperations` bounds work, and ordinary scope,
corridor, interval, and trial-projection guards still admit every candidate.
Search stops at the first failed frontier or exact target; initial candidate
count is not a cap because repeatable families can create later candidates.
The immutable `v1` model combines seven auditable feature distances; its
current weights are engineering priors, not listener-calibrated results. Each
active row targets its own ordered contribution, so several same-cycle
families may compose without claiming a bound on their non-linear aggregate.
See [DUMKA_PERCEPTUAL_DISTANCE.md](DUMKA_PERCEPTUAL_DISTANCE.md).

### Triggered tracks and Track Flow

`cseq-trigger` is a pure compiler for one-level triggered tracks. It normalizes
the trigger graph, evaluates source conditions from resolved structure, aligns
launches, and compiles deterministic future windows. A follower's source must
be a different continuous track; invalid graphs degrade safely with warnings.

`crates/cseq-transport/src/trackflow.rs` resolves each Track Flow box as one synthetic
parallel participant. A box chooses one member at a time through its authored
Markov chain. Display identity, conflict identity, and seed-path identity are
kept separate deliberately.

### Transport and MIDI

`cseq-transport` is split by responsibility while `lib.rs` preserves the public
facade:

| Module | Responsibility |
| --- | --- |
| `clock.rs` | PPQN, automation sampling, tick/tempo mapping |
| `engine.rs` | transport API, scheduler commands, MIDI/synth control |
| `generator.rs` | per-track generator/hocket playback configuration |
| `overlay.rs` | generated cells to rational note overlays |
| `sections.rs` | score validation and section helpers |
| `timeline.rs` | MIDI/automation/playback metadata records |
| `parallel.rs` | parallel tracks, triggers, Track Flow, channel conflicts |
| `rewrite.rs` | cycle-local channel/static routing rewrites |
| `snapshot.rs` | scheduler-acknowledged transport snapshots |
| `layers.rs` | uniform lifecycle for timeline-trust layers and logs |

The scheduler realizes ahead but dispatches only due events. Any rewrite that
affects audible notes is cycle-local: generated overlays and static/hocket
channel routing are finalized before the cycle joins the shared queue; Channel
Logic then suppresses colliding parallel note groups. Already-finalized future
events must never be reprocessed.

`cseq-midi` owns CoreMIDI output, the `Dum-Ka MIDI` virtual port, destination
enumeration, note-off/all-notes-off helpers, and the built-in synth monitor.

## Preview and playback data flow

Stopped preview:

```text
React section drafts
  → score_preview_subdivision_switch
  → deterministic PulseSpan/ResolvedBeat structure (+ per-matra accent
    velocities via cseq_transport::rhythm_span_matra_velocities)
  → generator_preview (spans + optional spanVelocities)
  → resolve_generator_cycle_with_trace, then per-cell velocity stamping
    (spans + working Subdivision + fold-owned density/complexity corridors +
    state complexity/depth-diversity insights + evolution trace, including
    authored directives and reserved directiveId 0 legacy clamps)
  → timeline structure + generator lane (accent-shaded cells)
```

Playback:

```text
React project snapshot
  → parallel_set_playback
  → deterministic sections
  → resolve_generator_cycle
  → generated-cell overlay
  → realize notes
  → triggered/Track Flow window assembly
  → channel hocket or static route (cycle-local)
  → Channel Logic conflict pass
  → scheduler queue → CoreMIDI / built-in synth
                       └→ TransportSnapshot playback layers → timeline
```

The stopped timeline may optimistically show the latest completed preview. Once
playing, it prefers scheduler snapshots. Requests are generation-tagged and
latest-wins; a late result may not replace a newer authored state. Rows remain
mounted during a pending/stale preview so transient work does not erase the
last truthful frame.

## Tauri boundary

`src-tauri/src/main.rs` exposes the command DTOs. Important command families are:

- score create/preview/get and score-file commands;
- `generator_preview` and `track_set_playback`;
- `parallel_set_playback` and transport play/stop/tempo/resync/snapshot;
- MIDI route discovery/selection and synth configuration;
- patch and track file dialogs/read/write;
- machine preferences and e2e-harness controls.

`ui/src/bridge.ts` is the only frontend module that should call Tauri directly.
`src-tauri/src/e2e_harness.rs` exposes an HTTP invoke bridge for real-backend
Playwright; `machine.rs` owns preferences and MIDI hot-plug reconciliation.

Transport mutation commands are scheduler-acknowledged: success means the
scheduler processed the request and published the corresponding state, not just
that a channel accepted a message.

The managed development boundary is `scripts/proj-tauri-dev.sh` plus
`scripts/proj-tauri-dev.mjs`. `proj` injects the registry-owned
`PROJ_PORT_TAURI_UI` value and passes the shell wrapper a deterministic Node 22
adapter. The wrapper deliberately remains the recorded process-group leader;
the Node launcher and its descendants stay in that group, avoiding an
executable-identity handoff during stop. The Node launcher validates the port,
atomically writes an ignored `.dev/tauri.proj.conf.json`, and starts
`cargo tauri dev --config .dev/tauri.proj.conf.json`. The generated override
derives both Vite's strict `--port` argument and Tauri's `build.devUrl` from
that one value. The checked-in Tauri and Vite defaults remain the standalone,
non-`proj` workflow and are not the source for the centrally managed
allocation.

## React application

`ui/src/App.tsx` coordinates cross-domain state, transport transitions, patch
build/apply, menus, and parallel-project actions. New domain logic belongs in a
pure module, hook, or component rather than expanding that orchestration file.

Current focused editors are Sections and Subdivisions, Generator, Evolve, and
Channel Shaper. Other major surfaces include the timeline, Track Role/Trigger controls,
Track Flow, Channel Logic, automation, seed strategy, Audio & MIDI Setup, synth
properties, and MIDI/automation diagnostics.

Important pure/frontend boundaries:

- `playbackRequests.ts`: build transport requests and content fingerprints.
- `patchIo.ts`: normalize in-memory state and project version-1 disk shapes.
- `timelineModel.ts` / `playbackLayers.ts`: select preview vs playback truth.
- `channelLogic.ts`, `trackFlowBoxes.ts`, `triggerUi.ts`: project reducers and
  request projections.
- `appInteractionPerformance.ts`: latest-wins queues and transition helpers.
- `editorDraftFlush.tsx`: commit focused drafts before persistence/actions.

## Persistence

There are three intentionally separate stores:

- **Patch v1** (`.dumka`): TypeScript projects current UI state to a strict,
  stripped disk shape. Tauri's Rust validator rejects unsupported versions,
  malformed envelopes, and removed-feature keys before writing.
- **Track v1** (`.dumka-track`): the same projection for one portable track.
  Import assigns fresh identity, drops project-specific trigger/seed snapshot
  state, and reconciles project priority and channel rules.
- **Score v1**: `cseq-persist` serializes Rust `Score` fixtures and accepts only
  schema version 1. Score files are not patch files.

Machine preferences remain their own versioned store under the Dum-Ka bundle
identifier. Patch autosave is recovery data and does not replace explicit Save.
Evolution directive pacing is part of the v1 plan row. Absence materializes as
`perCycle` for compatibility. Tolerant patch recall drops an explicitly
unknown pacing (or a smoothed Stochastic row) with the malformed-row warning;
the Tauri/Rust invoke boundary remains strict for direct DTO input.
Depth fields are additive v1 generator data: absent palette, default
`0..100000` complexity corridor, and placement bias 0 preserve the legacy
fold. Morph targets and directive subdivision-level filters stay inside the
plan row. Preview-only `workingSubdivision`, state metrics, corridors, and
clamp trace never enter the persisted authored shape.
Directive magnitude is an additive tagged field. Absence or explicit
`operationQuota` canonicalizes to the historical omitted shape. A
`perceptual` row must pin `modelVersion: v1`, use `perCycle`, remain within the
fixed target/tolerance/work bounds, and name a deterministic family; malformed
combinations fail closed. Preview trace adds the realized/target/tolerance and
reach/exhaustion truth, while transport continues to consume only the common
resolved spans.
Because `v1` requires the Barlow/Sioros metrical context, an unsupported metric
grid fails authoring validation when any perceptual row is enabled, including
a future row; disabled rows preserve the legacy unsupported-grid fallback.
Enabled perceptual rows also reserve a saturating plan-wide lifetime scoring
budget. The Rust boundary and TypeScript model use the same 4,096-evaluation
formula (`inclusive cycles × (maxOperations + 1)`); tolerant patch import keeps
but disables later rows that would exceed it, with a visible load warning.

## Verification architecture

The repository uses overlapping nets because the Rust/TypeScript boundary is
hand mirrored:

- Rust unit/property tests across every crate.
- Transport invariant properties and golden MIDI ledgers.
- Four compile-gated libFuzzer targets under `fuzz/`.
- Vitest node/jsdom tests plus model/component/bridge guardrails.
- A separate Node timeline-model lane.
- Two-way Rust↔TypeScript DTO fixtures in `ui/src/__fixtures__/dto/`.
- Playwright mock, real-Rust-backend, and isolated frontend bootcheck lanes.
- Performance baselines for frontend interactions and retained Rust benches.

Fixture and ledger regeneration are review events, not routine fixes. The exact
commands and ownership rules are in [TESTING.md](TESTING.md).
