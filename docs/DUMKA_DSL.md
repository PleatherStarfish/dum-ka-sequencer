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

Caps: 128 beats, per-beat Subdivision 64 (the platform's authored maximum),
512 weight, 64-slot Euclid, 16 nesting levels, 4096 Unicode code points, and
4096 actual expanded nodes. Diagnostics carry 1-based line and column.

## Structure

The pattern's boundaries determine the structure it needs: **cycle beats**
= the top-level weight sum, and **Subdivision** = the least common multiple
of every boundary denominator (per beat). The Generator editor shows this
("needs 4 beats · Subdivision 20") and **Apply structure** authors it: one
section, that Subdivision on every beat, no boundaries, no Grouping. Any
authored Subdivision that is a *multiple* of the requirement also works, but
the actual per-beat Subdivision must be uniform across the cycle. The preview
and playback span inputs carry that rate from exact `PulseSpan` geometry:
different Grouping span lengths on one grid remain valid, while a section that
really switches Subdivision fails closed instead of being averaged into a
fictional grid.

A mismatch is a specific error, never a silent quantize:

```
dumka pattern parse error at line 2, column 7: weight must be 1-512
dumka structure mismatch: pattern needs Subdivision 5 (or a multiple); the section has 4
```

## Sustains and the span ceiling (M1)

Generated notes cannot tie across structural spans (a platform invariant).
With the per-beat recipe, a note or hold therefore lives inside one beat;
an authored Grouping tile (3/4/5/6/7/9/11 steps) raises the ceiling to its
tile. A hold that would cross reports:

```
dumka structure mismatch: a note sustains across the span boundary at beat 1; split the note or keep the hold inside one beat or Grouping tile
```

Tuplet **onsets** crossing beats are fine: articulate the notes inside
their slots. When a flat k:w group of notes and rests crosses a structural
boundary, the builder offers **Articulate**. It preserves the outer ratio,
stroke names, and authored rests while shortening notes on the authored grid
and filling the remainder of their slots with rests. For example, under
ordinary per-beat spans `[x x x x x]@2` becomes
`[[x .] [x .] [x .] [x .] [x .]]@2`. Equal-duration note children share the
smallest safe slot divisor; in unequal-weight groups only crossing notes are
refined.
The calculation keeps every direct note before the next actual generator-span
end and uses the same current Subdivision and
Grouping spans sent to preview/playback, so it also handles shorter Grouping
tiles, compatible larger Subdivisions, nested groups, and groups beginning
later in the cycle. The rewritten notation is compiler-preflighted before the
button is offered. This is an explicit authoring action, not an automatic
rewrite, and the engine's span fence remains unchanged. Groups containing a
nested group or hold still require selecting the inner flat tuplet or editing
the hold explicitly.

The canonical example (quintuplet onsets across beats three and four, each
note detached):

```
[dum@3 ka] [. ka] [[dum .] [ka .] [dum .] [ka .] [dum .]]@2
```

Relaxing the cross-span tie fence is the named platform extension that
lifts this ceiling (see [ROADMAP.md](ROADMAP.md)).

## Examples

```
dum . ka .                                # four-on-the-floor call/answer, S=1
[dum . . ka] [. . ka .] [dum . ka .] [x x . x]   # the default pattern, S=4
E(3,8)@4                                  # tresillo stretched over four beats, S=2
[x x] . [x x x] .                         # duplet, rest, triplet, rest, S=6
x@2 _ . .                                 # a two-beat note (hold inside... spans!)
```

(That last example needs a Grouping tile of 4 or plays only under a
structure whose spans contain beats one and two together; per-beat spans
report the sustain diagnostic instead.)

## Determinism

With `evolutionRate` 0 (the default) and no enabled rate-automation source,
the generator renders the seed cycle verbatim: output depends only on the
pattern text and structural spans (`crates/cseq-transport/tests/goldens/
dumka_default_pattern.ledger.txt` pins two cycles). With a nonzero authored or
automated rate, cycle N is a pure fold of identity-seeded operators from the
seed — see [DUMKA_EVOLUTION.md](DUMKA_EVOLUTION.md) — and a Locked seed replays
byte-identically.
