# Dum-Ka

Dum-Ka is a macOS MIDI sequencer aimed at evolving bass lines and rhythms:
seed patterns that develop cycle by cycle through deterministic, seeded
transformations. It is built on the Seqstart quickstart platform and keeps the
hard platform work—transport, timeline/MIDI parity, parallel and triggered
tracks, Track Flow, channel collision logic, MIDI routing, persistence,
automation, and a deep test rig—behind a small generator seam.

The **Dum-Ka** generator plays a seed rhythm authored in a small notation
([docs/DUMKA_DSL.md](docs/DUMKA_DSL.md)): weighted proportional trees where
group weights express tuplets of any ratio starting anywhere
(`[dum@3 ka] [. ka] [[dum .] [ka .] [dum .] [ka .] [dum .]]@2`), with rests,
holds, `E(k,n)` Euclidean sugar, and stroke-class names. The editor computes
the structure a pattern needs and applies it in one click. Later cycles can
evolve through deterministic Barlow add/remove operations and whole-beat
rotation, bounded by a drift leash and structural playability guards (see
[docs/DUMKA_EVOLUTION.md](docs/DUMKA_EVOLUTION.md)).

The **Evolve** editor turns that fold into an authored score. Put a pin on one
cycle or stretch a family across a range, give it an exact intensity quota,
and optionally confine it to a contiguous beat window. Its composition strip
shows cached onset density plus applied/skipped engine trace ticks; selecting a
directive scrubs stopped preview to its cycle for an honest before/after visual
comparison. Playback still starts through the ordinary transport path; Evolve
does not claim a separate stopped-audition engine.
Ranges can **Repeat each cycle** like the historical score or pace one fixed
target across their full length with **Linear transition** or **Gentle
transition**. This is
deterministic operation pacing—not an audio crossfade: Add/Remove and the
displacement pair usually change one onset per operation, while one Rotate,
Fragment, Consolidate, or Euclid operation can still reshape a larger window.
Gaps retain the legacy stochastic layer, and an empty plan replays every older
trajectory byte-for-byte.

When a sustained tuplet child is rejected at a current Subdivision/Grouping
fence, the visual builder offers **Articulate crossing notes** beside the
error when exactly one tuplet can repair that fence; no block selection is
required. The explicit repair rewrites it into detached, grid-sized notes and
supports tuplets nested or positioned after beat one. If several tuplets cross
other fences, the action remains localized to the first rejected sustain
instead of editing an unrelated group. For valid committed notation, its
Euclidean seed
roller preserves each physical beat's exact local grid, even when the pattern's
cycle-wide requirement is a larger least common multiple. If a committed
generator request is rejected, the disabled Play control keeps the exact
reason visible beside the transport after the Generator editor closes.

The included **Example** generator is intentionally simple: every authored
subdivision step sounds at 100% density, and a seeded Bernoulli decision turns
steps into rests below 100%. It remains the worked reference for adding an
algorithm.

## What is retained

- Fixed sections authored at beat boundaries, each with a per-beat
  **Subdivision** and optional **Grouping**.
- Beat-, section-, and grouping-start velocity accents.
- Base MIDI note and velocity per track.
- Up to 16 parallel tracks with global or track-local tempo and cycle length.
- Continuous and triggered tracks, plus deterministic Track Flow boxes.
- Channel Logic policies and pair/channel overrides for overlapping tracks.
- Channel Shaper assignment through Markov or Euclidean strategies.
- Locked, Per Cycle, and History seed modes; seed-path recording and replay.
- Beat-sampled controls plus cycle-start generator parameter automation.
- A timeline sourced from the same resolved request and playback snapshots as
  audible MIDI. Stopped random-access inspection is bounded to cycles 0–10,000;
  live playback and its timeline continue past that window.
- Built-in synth monitoring, destination selection, hot-plug reconciliation,
  MIDI panic, and the `Dum-Ka MIDI` virtual port.
- Version-1 `.dumka` patches and `.dumka-track` track envelopes, recent
  files, autosave recovery, and native menus.

Dum-Ka deliberately does not carry the source product's research generators
or post-generation decoration layers. Some Rust/DTO names still use `cseq`, `rhythm`,
`gati`, or `jathi` for upstream diffability and wire compatibility; the current
user-facing vocabulary is Section, Subdivision, Grouping, Step, and Generator.

## Requirements

- macOS 11 or newer with CoreMIDI.
- Rust through `rustup` (the repository pins Rust 1.88.0).
- Node 22 for local jsdom/Vitest lanes.
- Corepack with pnpm 9.15.4.
- Tauri CLI 2 (`cargo install tauri-cli --version '^2.0'`).

## Run locally

The preferred managed command works from any directory, uses the central port
allocation, and gives `proj status`, `proj logs`, and `proj stop` ownership of
the complete desktop process group:

```bash
proj setup dum-ka-sequencer
proj start dum-ka-sequencer
```

The direct repository workflow remains available for standalone development
and retains the repository's default development port:

```bash
cd /Users/danielmiller/dev/projects/dum-ka-sequencer
. "$HOME/.cargo/env"
corepack prepare pnpm@9.15.4 --activate
pnpm --dir ui install --frozen-lockfile
cargo tauri dev
```

The app starts with a four-beat, fully sounding Example pattern. Turn on the
built-in synth if needed, then press Play. Open **Sections and Subdivisions** to
set boundaries and grids; open **Generator** to lower density or choose a seed
mode; open **Evolve** to schedule deterministic changes across cycles. The
timeline's generator lane is the resolved output used for playback;
its cells shade by the accent velocity the notes inherit (hover a cell for the
exact value).

To route another instrument, choose it in Audio & MIDI Setup or connect the
`Dum-Ka MIDI` virtual source in a DAW or MIDI monitor. **MIDI Panic** (`⌘.`)
releases sounding notes without stopping the transport.

## Build and verify

```bash
. "$HOME/.cargo/env"
cargo tauri build
```

Fast local checks:

```bash
. "$HOME/.cargo/env"
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
pnpm --dir ui typecheck
pnpm --dir ui lint
pnpm --dir ui test
pnpm --dir ui test:timeline
pnpm --dir ui build
node --test scripts/proj-tauri-dev.test.mjs
```

See [docs/TESTING.md](docs/TESTING.md) for invariant, golden-ledger, fixture,
Playwright mock/real/boot, fuzz, and performance lanes.

## Start here as a generator author

1. Read [docs/ADDING_A_GENERATOR.md](docs/ADDING_A_GENERATOR.md).
2. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), especially the generator
   and preview/playback data flows.
3. Copy the Example variant's touch points and keep the dispatch exhaustive.
4. Preserve the determinism and span-tiling contracts.
5. Regenerate both sides of the DTO fixture only when the wire shape changes.

The complete documentation index is [docs/README.md](docs/README.md). Extraction
history and attribution are recorded in
[PROVENANCE.md](PROVENANCE.md), while deferred work is kept in
[DEFER.md](DEFER.md).
