# Product vision

Dum-Ka is a macOS MIDI sequencer for **evolving bass lines and rhythms**. The
musician authors a seed rhythm for the first cycle in a small text notation —
nested proportional trees, so complex tuplets can start anywhere and span any
number of nodes — and the sequence then develops cycle by cycle through
deterministic, seeded transformations grounded in the rhythm-mathematics
literature. A recorded seed path replays the whole performance byte-
identically; evolution is composition, not dice.

## The musical program

The transformation vocabulary comes from a survey of mathematical models of
rhythmic development. Each family maps to a concrete module behind the one
generator seam:

| Family | Technique | Home |
|---|---|---|
| Add / subtract onsets | Barlow indispensability ranking — add or remove attacks in order of metric importance, preserving the groove | `generators/dumka/barlow.rs`, `evolve.rs` (M2) |
| Density / sparsity | Bjorklund/Euclidean `E(k,n)` maximal evenness; Barlow "metric field strength" as a temperature | `lattice.rs`, `evolve.rs` (M2) |
| Temporal displacement | Beat-class rotation `T_k`; Sioros–Guedes reversible syncopate/de-syncopate operators | `lattice.rs` (M2), `sioros.rs` (M3) |
| Rhythmic depth and placement | Prime-refined working lattice; Barlow-indigestibility mean-depth rail; fixed-point geometric gap field | `depth.rs`, `spectrum.rs`, `evolve.rs` (M3.95) |
| Long-distance structure | Drift leash (edit distance to the seed); rotation canons across parallel tracks; tiling canons later | `evolve.rs` (M2), roadmap |
| Directed interpolation | Exact circular transport/edit Morph toward a target pattern; Messiaen added-value **phrase drift** inside a fixed super-cycle later | `evolve.rs` (M3.95), roadmap (`phrase.rs`) |

The seed's own tree supplies the metric stratification, so Barlow and
Sioros–Guedes operators preserve the *authored* feel rather than an assumed
meter. See [ROADMAP.md](ROADMAP.md) for sequencing.

## The platform

Dum-Ka is built on the Seqstart quickstart platform and inherits its shape:

- an audible, useful sequencer on first launch;
- one small generator seam (tagged config variant + exhaustive resolver arm);
- a deterministic structural editor for cycles, sections, Subdivisions, and
  Grouping;
- a multi-track platform with triggers, Track Flow, channel assignment, and
  collision logic;
- a parity-first timeline whose playback rows describe scheduled MIDI;
- a macOS instrument with built-in monitoring and external CoreMIDI routing;
- a testbed with fixtures, ledgers, properties, fuzzing, and mock/real e2e.

Dum-Ka is not:

- a registry/plugin host with runtime-loaded arbitrary code;
- a DAW or piano roll;
- a promise to preserve the source product's research generators;
- a second independent preview implementation for each algorithm;
- an excuse to weaken deterministic replay or queue safety for iteration speed.

## Design priorities

1. **One seam.** Add a tagged config variant and exhaustive resolver arm; keep
   preview and transport kind-agnostic.
2. **Determinism.** Identical params/context produce byte-identical cells and
   replay. Random decisions are derived from stable identity.
3. **Truthful display.** Timeline playback layers come from the realization that
   produced sound.
4. **Safe platform reuse.** Structural edits, async actions, queue rewrites,
   track graphs, and disk formats fail closed.
5. **Inspectable evolution.** Compiler fences, two-way DTO fixtures, invariant
   properties, and ledgers enumerate the consequences of a new variant.
6. **Neutral vocabulary.** User-facing names explain ordinary sequencer concepts;
   inherited internal names remain only where they improve upstream diffability.

## Success for a new generator

A contributor can follow [ADDING_A_GENERATOR.md](ADDING_A_GENERATOR.md), produce
a new algorithm that tiles spans and replays deterministically, see its output
in stopped preview and live playback without custom wiring, persist its v1
config, and make every required test/guardrail enumerate the new variant.
