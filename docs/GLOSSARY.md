# Glossary

## Beat

The primary unit of a cycle. A section's Subdivision is applied to every beat.
Internal code may call a beat an `akshara`.

## Boundary

An authored section break after an integer beat. Every boundary is active and
starts the next section.

## Cell / Step

One generator output interval inside a structural span. A cell has an index,
start, positive length, rest flag, and tie flags. Cells must tile the span.

## Channel Logic

The project-level collision resolver for parallel playback. After final channel
assignment, overlapping note groups on the same user-facing MIDI channel are
grouped and a default or pair/channel policy decides which participants pass.
Suppressed groups are removed on/off together and ghosted on the timeline.

## Channel Shaper / Channel hocket

Per-track assignment of final note groups to MIDI channels through a Markov or
Euclidean strategy. It happens before Channel Logic. `channelHocket` is the
wire/internal name.

## Continuous track

A normal track that free-runs while playing. A continuous track may be the
source of a triggered follower.

## Cycle

One repeating structural duration. Tracks may follow the project cycle or use
a custom beat length.

## Dum-Ka generator

The seed-notation generator: a **pattern** (weighted proportional tree,
[DUMKA_DSL.md](DUMKA_DSL.md)) compiles to exact rational events and renders
verbatim each cycle. Its **stroke classes** (`dum`, `ka`, any bare name)
are carried through parsing and become velocity/pitch payload in a later
milestone; its required structure (beats + Subdivision) is applied from the
Generator editor.

## Example generator

The included seeded per-step density generator. At 100% all steps sound; below
100%, identity-seeded Bernoulli decisions mark steps as rests.

## Generated span

The cells returned for one input structural span. Internal Rust aliases retain
the names `ResolvedRhythmSpan` and `ResolvedRhythmCell` for upstream
diffability.

## Generator

A pure implementation of `CycleGenerator` selected by the exhaustive
`GeneratorConfig` enum. It receives caller-resolved context and returns cells;
it does not own seed resolution, preview wiring, transport, or MIDI.

## Grouping

An optional accent cycle inside a fixed section. It must tile the section's
resolved steps and is shown as a structural/accent lane. Internal DTOs may call
it `jathi` or `JathiPulse`.

## History seed mode

A deterministic seed strategy that chooses from bounded prior seeds or creates
a new seed according to integer weights.

## Locked seed mode

Uses the authored seed unchanged, producing byte-identical replay for the same
parameters/context.

## Matra

An inherited internal name for the step grid produced by subdivision. Current
UI copy says Step or pulse.

## Parallel track

A continuous track realized alongside other parallel participants. Parallel
tracks can follow or override project BPM/cycle length.

## Patch

A complete Dum-Ka project saved as a strict version-1 `.dumka` envelope.
It is different from a Rust score fixture.

## Per Cycle seed mode

Derives a deterministic seed from the authored base seed and cycle number.

## Pulse span

A structural interval emitted by deterministic section resolution and consumed
by the generator/trigger layers. Internal variants include Section, `GatiBeat`,
and `JathiPulse`; the latter names map to Subdivision and Grouping structure.

## Section

A contiguous run of beats beginning at beat 1 or after an authored boundary.
Each section owns one fixed Subdivision and optional Grouping.

## Seed path

A recorded domain/track/cycle/label-to-seed mapping used for trace, exact
replay, and wildcard matching. Seeds cross JavaScript as decimal strings.

## Subdivision

The number of steps in **each beat** of a section. Internal code frequently
uses `gati` for this value.

## Track envelope

A portable strict version-1 `.dumka-track` file. Import assigns fresh track
identity and reconciles destination-project timing, priority, and Channel Logic.

## Track Flow box

A sequential lane containing authored tracks. Its seeded Markov chain selects
one member at a time; the whole box is one synthetic parallel conflict
participant.

## Triggered track

A follower that stays armed and silent until a configured condition on a
different continuous source fires. The trigger graph is acyclic and one source
level deep.
