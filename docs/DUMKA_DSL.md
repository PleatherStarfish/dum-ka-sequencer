# The Dum-Ka seed notation

A pattern describes **one cycle** as a weighted proportional tree. The
Generator editor's visual rhythm builder reads and writes this notation
(expanded form — sugar below is authoring shorthand); the text stays the
single persisted source. The engine parses it in `crates/cseq-rhythm/src/generators/dumka/` (the single
source of truth); `ui/src/dumkaPattern.ts` mirrors the parser for instant
editor feedback and mock previews. A Rust-generated success/error corpus at
`ui/src/__fixtures__/dumka_parser_contract.json` is consumed by Vitest, so a
one-sided parser or compiler change fails the cross-language contract gate.

## Grammar

| Form | Meaning |
|---|---|
| `dum`, `ka`, `x`, any name | An onset. The bare identifier is its **stroke class** — carried through parsing today, becomes velocity/pitch payload in the M4 milestone. |
| `.` | A rest. |
| `_` | A hold: extends whatever element precedes it in time (note or rest). |
| `[ ... ]` | A group: divides its span among its children in proportion to their weights. |
| `@n` | Weight suffix on any node (default 1). At the top level, weight = beats. |
| `E(k,n[,r])` | Euclidean sugar: a Bjorklund necklace of `k` onsets in `n` slots, rotated left `r`. `E(3,8)` is the tresillo. |
| `*n` | Repeat the preceding node as `n` siblings. |
| `\|` | Visual bar separator; ignored. |
| `#` | Comment to end of line. |

The cycle's length in beats is the sum of the top-level weights. **Group
weights are how tuplets happen**, starting anywhere and spanning any number
of nodes: `[x x x x x]@2` is five in the time of two beats;
`[x [x x x] x@2]` nests a triplet inside one slot of a beat (denominators
multiply). Compilation uses arbitrary-precision rational intermediates and
only converts after the authored Subdivision limit is proved, so nothing
quantizes and deeply nested weights return a diagnostic instead of overflowing.

Raw text keeps that literal rule: changing a top-level `@n` can change the
cycle length. The visual Pattern builder's top-level **Span** control is a
timeline gesture instead. Growing a group consumes whole following blocks so
the cycle keeps its existing beats; shrinking inserts rest for the released
time. A span that would end inside an unsplit block is rejected rather than
silently compressing it. An unchanged following block that begins with a hold
also fails closed, because consuming or releasing the prior block would rebind
that hold. Nested Span remains a relative weight inside its fixed parent. To
retain all existing material, shift-select the intended beat range first,
choose **Group**, then change **Count**.

Caps: 128 beats, per-beat Subdivision 64 (the platform's authored maximum),
512 weight, 64-slot Euclid, 16 nesting levels, 4096 Unicode code points, and
4096 actual expanded nodes. Diagnostics carry 1-based line and column.

## Structure

The pattern's boundaries determine the structure it needs: **cycle beats**
= the top-level weight sum, and **Subdivision** = the least common multiple
of every boundary denominator (per beat). The Generator editor shows this
("needs 4 beats · Subdivision 20"). An optional M3.95 depth palette multiplies
that seed requirement once by each selected unique prime level (2/3/5/7, at
most two) to form the **working Subdivision**; repeated prime factors still
add another power, so seed Subdivision 4 with palette `{2}` works at 8. The
result must remain at most 64. **Apply structure** authors one section at the
working Subdivision, with no boundaries, Grouping, or custom division. Any
authored Subdivision that is a *multiple* of the working requirement also works, but
the actual per-beat Subdivision must be uniform across the cycle. The preview
and playback span inputs carry that rate from exact `PulseSpan` geometry:
different Grouping span lengths on one grid remain valid, while a section that
really switches Subdivision fails closed instead of being averaged into a
fictional grid.

A mismatch is a specific error, never a silent quantize:

```
dumka pattern parse error at line 2, column 7: weight must be 1-512
dumka structure mismatch: pattern needs Subdivision 5 (or a multiple); the section has 4
dumka subdivisionPalette needs working Subdivision 80, above the platform maximum 64
```

## Sustains across structural spans (M3.9)

Notes may sustain across adjacent beat or Grouping spans. The projector splits
the duration at each structural seam and emits a paired tie: the left chunk is
`tiedToNext`, the right chunk is `tiedFromPrevious`, and both are sounding.
The generic generator validator rejects every dangling, silent, first-span
incoming, or last-span outgoing half. Transport merges a valid chain into one
audible note using its opener's pitch and velocity, and the timeline renders
one joined note with one pulse badge.

For example, `[x x x x x]@2` is a legal five-in-the-time-of-two phrase on two
per-beat Subdivision-5 spans. The middle note crosses the beat seam without an
extra attack. A single note can cross several adjacent spans; a tie cannot wrap
from the end of a cycle to its beginning.

The builder's selected-group **Articulate** gesture is still available as an
explicit stylistic rewrite. It shortens the selected flat group's notes on the
authored grid and fills the remainder with rests, so `[x x x x x]@2` can become
`[[x .] [x .] [x .] [x .] [x .]]@2` when detached attacks are desired. It is
not an error repair and is never applied automatically.

The reference example (quintuplet onsets across beats three and four, each
note deliberately detached) remains:

```
[dum@3 ka] [. ka] [[dum .] [ka .] [dum .] [ka .] [dum .]]@2
```

## Examples

```
dum . ka .                                # four-on-the-floor call/answer, S=1
[dum . . ka] [. . ka .] [dum . ka .] [x x . x]   # the default pattern, S=4
E(3,8)@4                                  # tresillo stretched over four beats, S=2
[x x] . [x x x] .                         # duplet, rest, triplet, rest, S=6
x@2 _ . .                                 # a two-beat note, tied across its seam
```

## Determinism

With `evolutionRate` 0 (the default) and no enabled rate-automation source,
the generator renders the seed cycle verbatim: output depends only on the
pattern text and structural spans (`crates/cseq-transport/tests/goldens/
dumka_default_pattern.ledger.txt` pins two cycles). With a nonzero authored or
automated rate, cycle N is a pure fold of identity-seeded operators from the
seed — see [DUMKA_EVOLUTION.md](DUMKA_EVOLUTION.md) — and a Locked seed replays
byte-identically.
