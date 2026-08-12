# User Manual

# CAESURA: Probabilistic Carnatic Sequencer

Reference manual, written in the format of the Orthogonal Devices ER-102
manual: one chapter per subsystem, one table per control group, exact
ranges and defaults, no figurative language.

---

## CONTENTS

| Chapter | Page topic |
|---|---|
| 1. Introduction | What the program does; the window; manual conventions |
| 2. The Musical Model | Cycle, beat, gati, matra, section, boundary, jathi, accent span |
| 3. The Realization Pipeline | The ordered passes that produce one cycle of MIDI |
| 4. Cycle And Sections | The Sections and Subdivisions editor |
| 5. Velocity Accents | Beat-start, section-start, jathi-start ranges |
| 6. Jathi Bhedam | Irregular, evolving accent phrases |
| 7. The Timeline | Lane-by-lane reference |
| 8. Seeds | Locked, per-cycle, history; inheritance; seed paths |
| 9. Automation | Lanes, curves, markers, sampling rules |
| 10. Rhythm | Markov patterns, articulation, beat locks, re-subdivision |
| 11. Ratchet | Playback subdivision of note groups |
| 12. Ornaments | Grace notes and onset delay |
| 13. Cycle Flux | Cycle-local tempo warp |
| 14. Pitch | Pitch map, transitions, playback behavior |
| 15. Channel | Static channel, Markov hocket, Euclidean pattern, routing |
| 16. Shape Groups | Select spans, then transform them |
| 17. Randomize | Generating configurations |
| 18. Tracks, Track Flow, Channel Logic | Parallel playback |
| 19. MIDI Output And The Built-In Synth | Virtual port, monitor routing |
| 20. Files | Patches, autosave, export, track transfer |
| 21. Setup And Menus | Dialogs and native menu items |
| 22. Diagnostics | The three logging surfaces |
| 23. Procedures | Nine worked examples |
| Appendix A | Allowed gati and jathi values |
| Appendix B | Default values |
| Appendix C | Colors and lane marks |
| Appendix D | Keyboard shortcuts |
| Appendix E | Glossary |
| Appendix F | Troubleshooting |

---

# 1. INTRODUCTION

## 1.1 What it does

CAESURA is a macOS desktop MIDI sequencer. It generates one repeating
cycle of MIDI at a time. The contents of that cycle are produced by a
sequence of deterministic transformations over probabilistic settings.
Every random choice is drawn from a seeded generator, so a given patch
plus a given seed always produces the same output.

The program does five things:

1. It divides a repeating cycle of beats into **sections**, each with its
   own beat subdivision (**gati**) and optional accent pulse (**jathi**).
2. It groups the resulting subdivisions into rhythmic cells using
   per-span-length Markov chains, then applies rests and ties.
3. It applies playback transformations: ratchet, grace notes, onset
   delay, and a cycle-local tempo warp.
4. It rewrites the final pitch and the final MIDI channel of every note.
5. It sends the result to a virtual CoreMIDI port and, optionally, to a
   built-in monitor synthesizer.

It does not record audio, host plug-ins, mix, or sync to external clock.

## 1.2 Output

Output is MIDI only. On launch the program creates one virtual CoreMIDI
source. Any macOS application that reads CoreMIDI can receive from it.
The built-in synthesizer is a monitor for checking work; it is not the
intended sound source.

## 1.3 The window

```
+---------------------------------------------------------------------+
| TRANSPORT: Play  Stop  Synth  Tempo  Project cycle  Patch memory    |
+---------------------------------------------------------------------+
| CHANNEL LOGIC strip (parallel-playback collision rules)              |
+---------------------------------------------------------------------+
| TRACK TABS + Track Flow box lane   [ + New track ] [ Copy ] [ ... ]  |
| Active track settings: name, cycle mode, BPM mode, automation        |
+---------------------------------------------------------------------+
| BOUNDARY PROBABILITY RAIL                                           |
+---------------------------------------------------------------------+
| RESOLVED TIMELINE                                                    |
|   beat ruler / gati / jathi / rhythm / ratchet+ornament / pitch /    |
|   channel                                                            |
+---------------------------------------------------------------------+
| MAIN EDITORS (launcher grid, one open at a time)                     |
|   Sections and Subdivisions | Rhythm | Pitch | Channel |             |
|   Shape Groups | Randomize                                           |
+---------------------------------------------------------------------+
| Built-in Synth | MIDI Debug | Automation Debug | Parallel conflict   |
+---------------------------------------------------------------------+
```

The main editors are mutually exclusive. Opening one closes the others.
The Escape key closes the open editor.

Two lower-frequency surfaces are modal dialogs opened from the macOS
menu bar: **Audio & MIDI Setup** and **Seed Strategy**.

## 1.4 Conventions used in this manual

- A **control table** lists Control, Range, Default, and Effect. Ranges
  are inclusive. "—" means the control has no numeric range.
- Weights are always relative, non-negative integers. A weight of 0
  makes an option visible but unselectable. Weights `{3, 4, 5}` produce
  shares of 25%, 33.3%, and 41.7%.
- Percentages authored in the interface are stored as integers 0 to 100
  unless the table says otherwise.
- "Beat N" is 1-based in the interface. Storage is 0-based; this affects
  only hand-edited patch files.
- A **boundary after beat N** means: if that boundary fires, beat N+1
  begins a new section.
- **NOTE** paragraphs state a rule that is easy to miss.
- **LIMIT** paragraphs state a restriction of the current build.

---

# 2. THE MUSICAL MODEL

## 2.1 Terms

| Term | Definition |
|---|---|
| Cycle | One loop of the sequencer. Contains a fixed number of beats. |
| Beat | A primary pulse inside the cycle. |
| Gati | The number of equal matras inside one beat. |
| Matra | One subdivision of a beat. |
| Section | A contiguous run of beats sharing one resolved gati. |
| Boundary | A position after a beat at which a new section may start. |
| Jathi | A regular accent pulse measured in matras. |
| Accent span | The interval between two protected accent boundaries. |
| Rhythm cell | One element of a rhythm pattern; a run of matras. |
| Note group | One audible note produced by the rhythm layer. |

## 2.2 Nesting

```
Cycle
 └── Beat            (count set by Beats/cycle)
      └── Matra      (count set by the beat's section gati)

Section              (a span of beats)
 └── Jathi pulse     (equal matra groups tiling the section)

Accent span          (jathi pulse if jathi resolved, else gati beat)
 └── Rhythm cell     (Markov pattern element)
      └── Note group (one MIDI note, unless rested or tied)
           └── Ratchet hits / grace notes  (playback only)
```

## 2.3 Exact tiling

Every layer must exactly fill its parent. Four conditions apply to every
parent-to-children edge:

- **Cover** — the children leave no gap in the parent.
- **Disjoint** — the children do not overlap.
- **Containment** — each child lies entirely inside one parent.
- **Conservation** — the children's lengths sum to the parent's length.

Boundaries are compared as exact rational numbers, not floating point.
A choice that cannot tile exactly is rejected or skipped. It is never
stretched or rounded to fit.

## 2.4 Gati

Gati is the number of matras per beat, and nothing else. It is not the
number of events in a section and it is not a time signature.

Allowed values: **3, 4, 5, 6, 7, 9, 11**.

Traditional names: 3 tisra, 4 chatusra, 5 khanda, 7 misra, 9 sankirna.
Values 6 and 11 are provided in addition to those five.

Gati is a property of the section. Every beat in a section receives the
same gati. To change gati at beat N, place a boundary after beat N-1.

## 2.5 Jathi

Jathi is a regular accent pulse measured in matras. Allowed values are
the same set: **3, 4, 5, 6, 7, 9, 11**.

A jathi value is valid for a resolved section only if both conditions
hold:

```
1.  (section total matras) mod jathi == 0        exact tiling
2.  jathi mod gati != 0                          not a duplicate of
                                                 the beat-start pulse
```

Example: a 3-beat section in gati 4 has 12 matras.

| Jathi | Test 1 | Test 2 | Valid |
|---|---|---|---|
| 3 | 12 mod 3 = 0 | 3 mod 4 = 3 | yes |
| 4 | 12 mod 4 = 0 | 4 mod 4 = 0 | no — lands only on beat starts |
| 5 | 12 mod 5 = 2 | — | no — does not tile |
| 6 | 12 mod 6 = 0 | 6 mod 4 = 2 | yes |

Invalid jathi values are drawn dimmed in the section inspector. If no
weighted jathi value is valid for a resolved section, that section
resolves with no jathi and the jathi lane is empty for it.

## 2.6 Accent spans

The accent span layer is chosen per section:

- If the section resolved a jathi, the **jathi pulse spans** are the
  accent spans.
- Otherwise the **gati beat spans** are the accent spans.

Accent spans are protected. Rhythm grouping, re-subdivision, and ratchet
must stay inside one accent span. The single exception is an explicit
tie-over-accent policy (§10.6), which lets a held note cross an accent
start.

## 2.7 Sections

A boundary that fires always starts a new section, including when the
new section resolves the same gati as the previous one. Sections are
structural events: they carry a section-start accent, can host a
different jathi tiling, and are drawn with a divider on the timeline.

---

# 3. THE REALIZATION PIPELINE

One cycle of MIDI is produced by the following ordered passes. Each pass
rewrites only the cycle currently being realized. Cycles already in the
scheduler queue are never re-processed.

```
 1  Sample automation at the cycle and at each beat
 2  Roll the max-section cap
 3  Roll boundaries, left to right, stopping at the cap
 4  Resolve gati per section
 5  Resolve jathi per section
 6  Emit section / gati beat / jathi pulse spans
 7  Apply gati speed and jathi timing multipliers
 8  Apply velocity accents
 9  Apply arbitrary subdivision (re-subdivision) overlay
10  Resolve Markov rhythm grouping inside each accent span
11  Apply beat locks
12  Apply rest / tie articulation
13  Apply articulation-stage Shape Groups
14  Realize note-on / note-off events at exact rational offsets
15  Apply playback-finalize Shape Groups (velocity, pitch, triggers)
16  Ratchet pass
17  Ornament pass (grace notes, then delay)
18  Pitch shaper rewrite
19  Channel hocket rewrite
20  Channel Logic collision resolution across parallel tracks
21  Cycle Flux tempo warp
22  Append to the scheduler queue; dispatch to CoreMIDI and the monitor
```

Passes 1 through 12 also run in the stopped preview, through the same
backend entry point the transport uses. This is why the stopped timeline
and playback agree on structure. Passes 15 through 21 are playback-only;
their timeline lanes appear only while the transport runs.

**NOTE** The scheduler converts exact rational cycle positions to
PPQN = 960 ticks at the last moment. Nested subdivisions do not
accumulate floating-point error.

---
# 4. CYCLE AND SECTIONS

The **Sections and Subdivisions** editor holds every control that
determines the structure of the cycle. It has four regions, top to
bottom: the cycle core bar, the probability and accents bar, the section
map, and the section inspector.

```
+--- SECTIONS AND SUBDIVISIONS -------------------------------------+
| Cycle name [        ]  Beats/cycle [8]  Pitch [60]  Velocity [96] |
| > Cycle tempo flux            off                                 |
+-------------------------------------------------------------------+
| Accent mode: [single-parameter mod] [jathi mode]                  |
| Velocity accents:  Section [+8 +/-2]  Gati [+15 +/-4]             |
|                    Jathi [+18 +/-4]                               |
+-------------------------------------------------------------------+
| SECTION MAP                    | SECTION INSPECTOR                |
|  Max sections per cycle  [2]   |  [Boundary][Subdivision]         |
|  Section 1        g4  j5       |  [Jathi Accent][Jathi Bhedam]    |
|  After beat 4  60% g7  j-      |                                  |
|  After beat 6  25% g4  off     |  ...layer controls...            |
+-------------------------------------------------------------------+
```

## 4.1 Cycle core bar

| Control | Range | Default | Effect |
|---|---|---|---|
| Cycle name | text | empty | Label stored in the patch. Not sent over MIDI. |
| Beats/cycle | 1–64 | 8 | Number of primary pulses in the repeating cycle. |
| Pitch | 0–127 | 60 | Base MIDI note before pitch shaping and ornaments. Automation target `sequencer.pitch`. |
| Velocity | 1–127 | 96 | Base MIDI velocity. Accent boosts add to this value and clamp at 127. Automation target `sequencer.velocity`. |

Beats/cycle is disabled while the transport runs. Stop before changing
it. Reducing it can strand boundaries past the end of the cycle; those
positions are normalized when possible.

**Cycle tempo flux** is a collapsed disclosure in this bar. Its controls
are described in Chapter 13.

## 4.2 Probability and accents bar

| Control | Values | Default | Effect |
|---|---|---|---|
| Single-parameter rhythmic modulation | off / on | off | See §4.7. |
| Jathi mode | Override gati / Layered | Override gati | Which accent wins where a jathi pulse and a beat start land on the same matra. See §5.2. |
| Section accent | center, ± margin | see App. B | Extra velocity on matra 1 of a section-starting beat. |
| Gati accent | center, ± margin | see App. B | Velocity on matra 1 of every beat. |
| Jathi accent | center, ± margin | see App. B | Velocity on every jathi pulse start. |

The global seed readout also appears here. It is a shortcut; editing
happens in the Seed Strategy dialog (Chapter 8).

## 4.3 The section map

The map lists Section 1 followed by every possible boundary in beat
order. Each row shows compact chips for chance, resolved subdivision,
jathi, and Jathi Bhedam state. Selecting a row loads it into the
inspector.

**Max sections per cycle** sits at the top of the map. It is a weighted
count ladder, sampled once per cycle before any boundary is rolled.

```
Max sections = N  =>  at most N-1 boundaries may fire this cycle.

cap 1  ->  no boundary can fire; the cycle is one section
cap 2  ->  one boundary may fire
cap 3  ->  two boundaries may fire, in left-to-right order
```

The upper limit is `possible boundaries + 1`. Raising the direct Max
number creates the missing boundary slots; from a one-beat cycle it
first expands the cycle enough for those slots to exist.

Boundaries are rolled left to right. Once the cap is reached, later
boundaries cannot fire even when their own probability would have
succeeded.

Automation targets: `sequencer.sectionCount.{N}.weight`.

## 4.4 The boundary rail

The rail is the horizontal strip directly above the resolved timeline.
It shares the timeline's horizontal coordinate frame, so each marker
sits above its after-beat position.

| Gesture | Result |
|---|---|
| Click empty rail position | Add a boundary after that beat |
| Drag marker vertically | Change the boundary's chance |
| Drag marker horizontally | Move to a different after-beat position |
| Marker `edit` action | Open that boundary in the section inspector |
| Marker `del` action | Delete the boundary |

Vertical position encodes chance; higher is more likely.

## 4.5 The section inspector

The inspector shows one row of the map at a time, on one of four layers.
The initial section has no boundary chance, so it opens on Subdivision
and has no Boundary layer.

| Layer | Contents |
|---|---|
| Boundary | After-beat position, fire chance |
| Subdivision | Gati choice weights; custom equal-parts grid |
| Jathi Accent | Regular jathi weights |
| Jathi Bhedam | Irregular evolving accent selection (Chapter 6) |

### Boundary layer

| Control | Range | Default | Effect |
|---|---|---|---|
| After beat | 1 – (beats−1) | position clicked | Which beat this boundary follows |
| Chance | 0–100% | 50 | Probability the boundary fires, subject to the cap |

Automation target: `sequencer.boundary.{id}.probability`.

### Subdivision layer

Seven gati weight chips: 3, 4, 5, 6, 7, 9, 11. Each chip shows its
weight and the implied share. The chip for the gati resolved in the
current cycle is marked.

Automation targets: `sequencer.initial.gati.{N}.weight` for the initial
section, `sequencer.boundary.{id}.gati.{N}.weight` for a boundary.

The same layer carries the **custom equal-parts** option: instead of a
gati from the allowed set, the section can be divided into an arbitrary
equal number of parts, with its own count weights and its own chance of
being used instead of a gati.

### Jathi Accent layer

Seven jathi weight chips: 3, 4, 5, 6, 7, 9, 11. Options that fail either
validity test for the resolved section are dimmed and cannot be drawn.

Automation targets: `sequencer.initial.jathi.{N}.weight`,
`sequencer.boundary.{id}.jathi.{N}.weight`.

## 4.6 Resolution order inside one cycle

```
1.  cap        = weighted draw from Max sections ladder
2.  for each possible boundary, left to right:
        if fired count < cap - 1:
            fired = (uniform draw < boundary chance)
3.  for each resulting section:
        gati   = weighted draw from that section's gati weights
4.  for each resulting section:
        jathi  = weighted draw restricted to valid jathi values
                 (empty set => no jathi for this section)
```

## 4.7 Single-parameter rhythmic modulation

Off by default. When on, the engine still samples gati and jathi as
usual, but if the sampled pair would change both the subdivision and the
perceived accent-span duration at once, it substitutes the nearest
candidate that changes only one, in this order:

1. Preserve the previous accent span duration in matras (or in
   speed-adjusted units when a gati speed multiplier applies).
2. Otherwise preserve the gati and switch to a different valid jathi.
3. Otherwise choose the gati/jathi pair whose accent span duration is
   closest in absolute time to the previous span.
4. Otherwise keep the originally sampled pair.

The mode never blocks or warns. It only narrows the choice to candidates
already present in the weighted sets.

Automation target: `sequencer.singleParameterRhythmicMod` (boolean).

---

# 5. VELOCITY ACCENTS

## 5.1 The three layers

| Layer | Applies to |
|---|---|
| Gati (beat-start) | Matra 1 of every beat |
| Section-start extra | Matra 1 of a beat that starts a section, added on top of the beat-start accent |
| Jathi-start | The first matra of every resolved jathi pulse |

Each layer is authored as a center value and a ± margin. The model
stores two fields, `min` and `max`:

```
min = center - margin
max = center + margin
```

Each realization draws a uniform integer in `[min, max]` and adds it to
the base velocity. The result clamps to 1–127.

Automation targets: `sequencer.accent.beatStart.min`, `.max`, and the
equivalents for `sectionStartExtra` and `jathiStart`. Each endpoint is
automatable independently.

## 5.2 Collisions

When a jathi pulse start and a beat start fall on the same matra, the
**Jathi mode** control decides the result:

| Mode | Result at the collision |
|---|---|
| Override gati (default) | The jathi accent replaces the gati accent. The section-start extra accent still applies. |
| Layered | The gati accent and the jathi accent both add. |

Worked example, base velocity 96, gati draw +11, jathi draw +12,
section extra +8, at matra 1 of a section-starting beat that is also a
jathi pulse start:

```
Override gati:  96 + 12 + 8 = 116
Layered:        96 + 11 + 12 + 8 = 127
```

---

# 6. JATHI BHEDAM

Jathi Bhedam is an alternative accent layer for a section. Instead of a
regular pulse of equal length, it plays an irregular sequence of pulse
lengths and transforms that sequence over successive cycles.

It is authored per section, on the **Jathi Bhedam** inspector layer, for
the initial section and for each boundary independently. Where a
selection is active and drawn, its cells replace the regular jathi
tiling for that section.

## 6.1 Technique selection

Regular jathi and Jathi Bhedam are independent toggles. Per section, per
cycle, a seeded weighted draw picks one of three techniques:

| Technique | Meaning |
|---|---|
| Gati only | No accent layer above the beat; accent spans are gati beat spans |
| Jathi | The regular jathi pulse of §2.5 |
| Jathi Bhedam | The irregular evolving phrase of this chapter |

The **Weight** group biases that draw.

| Control | Range | Default | Effect |
|---|---|---|---|
| Base | ≥ 0 | 1 | Bhedam weight; the gati-only reference weight is 1.0 |
| Gati weights | per-gati ≥ 0 | empty | Additional weight when the section resolved a specific gati |
| Length bias — Below beats | ≥ 1 | — | Section-length threshold separating short from long |
| Length bias — Shorter W / Longer W | ≥ 0 | — | Weights applied on each side of the threshold |
| Cycle position — Start zone / End zone | fraction of cycle | — | Extent of the two zones |
| Cycle position — Start W / End W | ≥ 0 | — | Weights inside each zone |

## 6.2 Phrase

| Control | Range | Default | Effect |
|---|---|---|---|
| Seed numbers | each 1–8 | worked phrase | The starting sequence of pulse lengths in matras |
| Seed | ≥ 0 | 0 | Base seed for the evolution stream |
| Mukthay | Pad to sam / Truncate to sam | Pad to sam | How a generated sequence whose sum misses the section total is resolved |

The sum of the seed numbers is displayed beside the field. The evolved
sequence must resolve on sam — that is, it must sum exactly to the
section's matra count. The mukthay policy decides whether a short
sequence is padded or a long one is truncated.

## 6.3 Evolution (per cycle)

| Control | Range | Default | Effect |
|---|---|---|---|
| Ops per generation | ≥ 0 | 1 | How many operators are applied each cycle |
| Operator list | see below | one entry | Weighted operators drawn each generation |

Operators:

| Operator | Effect on the pulse sequence |
|---|---|
| Retrograde | Reverse the sequence |
| Exchange adjacent | Swap two neighbouring values |
| Reorder fragments | Permute contiguous groups |
| Repeat fragment | Duplicate a contiguous group |
| Omit fragment | Remove a contiguous group |
| Split | Replace one value with two summing to it |
| Merge | Replace two adjacent values with their sum |
| Insert | Insert a new value |
| Extend | Lengthen one value |

The evolution is windowed and deterministic: cycle N's sequence is a
pure function of the selection, the seed, and N. Scrubbing back to an
earlier cycle reproduces that cycle's sequence exactly.

## 6.4 Phrasing

Each bhedam cell can carry a notes-per-cell count, which subdivides that
cell into that many equal notes.

**Beat locks and Shape Groups take precedence.** A bhedam notes-per-cell
rewrite yields to any span that a beat lock pinned or a Shape Group
articulated, because those are explicit user overrides that the stopped
preview already displayed.

**LIMIT** Bhedam pulses do not fire jathi-pulse position triggers, and
bhedam cells have no speed multiplier.

---
# 7. THE TIMELINE

The resolved timeline sits under the boundary rail. Every lane uses one
shared horizontal coordinate frame measured in absolute matra position
inside the cycle. Scrolling or zooming any lane moves all of them,
including the boundary rail.

Section containers may draw outlines. Outlines, borders, and padding do
not change the track width the musical lanes use. Row labels are drawn
over the track rather than occupying a layout column, so lanes cannot
drift relative to one another.

## 7.1 Lane order

```
+-- Section 1 (gati 4) ---------+-- Section 2 (gati 7) -------------+
| B1   | B2   | B3   | B4       | B5      | B6      | B7      |     |  beat ruler
| .... | .... | .... | ....     | ....... | ....... | ....... |     |  gati matras
| [   jathi 4 ][   jathi 4 ]    | [ jathi 7 ][ jathi 7 ]          |  jathi pulses
| |==|=|===|  |==|=|===|        | |====|===| |==|==|===|          |  rhythm cells
|   ~~~~~   <>                  |        ~~~~~                     |  ratchet+ornament
|  . . ..  .   . .   ..         |   .  ..   .    .                 |  pitch
| [1][3][1][7]                  | [2][2][4]                        |  channel
+-------------------------------+----------------------------------+
```

## 7.2 Beat ruler and gati lane

The beat ruler draws one cell per beat. The beat currently sounding is
tinted green during playback.

The gati lane draws one cell per matra. A gati 4 section shows four
equal cells per beat; a gati 7 section shows seven.

| Cell color | Meaning |
|---|---|
| Neutral dim | Ordinary matra |
| Gold | Beat-start accent cell |
| Orange | Section-start extra accent cell |
| Green tint | Active beat or section during playback |

When a gati speed multiplier is active the section label reads, for
example, `gati 4 x 2` or `gati 5 x 1/2`. The gati lane still draws the
native matra count. The annotation describes the timing grid used for
jathi validity and Markov rhythm, not the number of drawn cells.

## 7.3 Jathi lane

When a section resolves a jathi, this lane draws the pulse spans as
equal amber blocks that tile the section exactly. Markov grouping
subdivides the interior of a pulse span; it never changes the span
itself.

When a section resolves Jathi Bhedam, this lane draws the irregular
bhedam cells instead. When neither resolves, the lane is empty for that
section.

## 7.4 Rhythm lane

Draws the partition of each accent span into rhythm cells. Widths are
proportional to the cell lengths in matras.

```
jathi 5 pulse span:     [        5 matras        ]
chosen pattern [2,1,2]: |======|===|======|
```

| Color | Meaning |
|---|---|
| Dusty cyan | Partition of a gati beat span |
| Amber | Partition of a jathi pulse span |
| Red | Fallback hit (no chain authored for this span length) or an inert weighted pool |
| Hollow, low emphasis | Rested cell |
| Joined with a tie tick | Tied cell |

## 7.5 Ratchet and ornament rail

One thin rail between the rhythm lane and the pitch lane. It carries
three mark types.

| Mark | Meaning |
|---|---|
| Amber rounded bar with internal ticks | A ratchet. Bar edges are the source note's start and end. Ticks are the actual rendered hit intervals, so tick spacing shows the contour directly. |
| Rose diamond | A grace note. Before-beat ornaments anchor on the diamond's right edge; on-beat ornaments anchor on the left edge. |
| Cool blue bracket | A delay ornament: displacement of the onset, not a new attack. |

This rail draws only during playback. It is blank when stopped.

## 7.6 Pitch lane

Draws the final note-on pitch bytes that the transport dispatched, as
muted violet marks. Vertical position encodes pitch. Playback only.

## 7.7 Channel lane

Draws each note's final user-facing MIDI channel (1–16) as a span over
the same geometry, carrying both the channel number and that channel's
stable color. Playback only.

| Treatment | Meaning |
|---|---|
| Stable per-channel color | The channel identity, identical everywhere in the program |
| Subtle edge or glow | Fallback assignment or accent-routed assignment |
| Pointed silhouette | A ratcheted channel event |
| Ghosted | A note group suppressed by Channel Logic |

## 7.8 Coherence guards

The playback-only lanes must pass a cycle-coherence check before
rendering. If a required source is still catching up after a repaint,
the lane hides itself and shows a "syncing" status rather than combining
data from two different realizations.

The ratchet lane is the one exception: a ratchet event carries its own
final hit intervals, so it can draw even when rhythm preview metadata is
briefly behind.

---

# 8. SEEDS

Every probabilistic choice is drawn from a seeded generator. Seed
behavior is edited in one place: **Setup → Seed Strategy**. Inline seed
readouts elsewhere are shortcuts into that dialog.

## 8.1 Streams

```
                     Global score seed
                             |
        +--------------------+--------------------+
        |                    |                    |
     Rhythm               Pitch               Channel
    (inherit or          (inherit or         (inherit or
      local)               local)              local)

     Ratchet             Ornaments            Shape Groups
   (independent)       (independent)         (own set seed)
```

| Stream | Drives |
|---|---|
| Global | Max-section cap, boundary firing, gati choice, jathi choice, technique selection, accent margin draws |
| Rhythm | Markov state choice, entry, fallback, rest/tie articulation, beat lock draws, arbitrary subdivision |
| Pitch | Pitch Markov walk, transposition, ratchet and ornament pitch resolution |
| Channel | Hocket walk, accent-routing draws, position-rule draws, gesture channel resolution |
| Ratchet | Fire rolls, hit counts, curve blends, timing jitter, velocity draws |
| Ornaments | Grace and delay fire rolls, counts, placement, timing draws |
| Shape Groups | One chance stream per group; one stream per probabilistic operation |

## 8.2 Modes

| Mode | Behavior |
|---|---|
| Locked | The same seed every cycle. Identical realization each cycle. |
| Per-cycle | Seed derived from the base seed and the absolute cycle number. Variation is reproducible across runs and machines. |
| Drift | Keeps the previous cycle's seed or re-rolls a new one, with a percent chance per cycle. Runs of identical cycles punctuated by changes; fully stateless and replayable. |
| Morph | Crossfades between seed generations: new layers born at a percent chance fade in over a blend width and permanently retire older layers; a repeat chance adds inertia. Typically ~3 layers interleave. Fully stateless and replayable. |
| History or new | Each cycle either reuses a seed from a bounded pool or generates a new seed and appends it to the pool. |

```
Locked      cycle 1 -> S -> R1     cycle 2 -> S -> R1     cycle 3 -> S -> R1

Per-cycle   cycle 1 -> hash(S,1) -> R1
            cycle 2 -> hash(S,2) -> R2
            cycle 3 -> hash(S,3) -> R3

Drift       cycle n: decision(S, n) rolls under newSeedChance?
                yes -> hash(S,n) -> fresh realization
                no  -> keep the seed from the previous cycle
            (the decision stream is pure, so the whole trajectory
             replays from (S, chance) alone)

Morph       births(S): a new generation is born newSeedChance% of cycles
            each generation fades in over blendCycles; once any younger
            generation saturates, everything older is dead forever
            cycle n: holdChance% -> repeat the previous pick
                     else        -> sample a generation by its fade-in weight
            A A A A B A A B A B C A B A C C B A A B A C C B C A B B C ...
            (all three streams are pure, so the trajectory replays
             from (S, holdChance, newSeedChance, blendCycles) alone)

History     if roll <= historyWeight / (historyWeight + newWeight):
                reuse a seed drawn from the pool
            else:
                generate a new seed, append, drop the oldest if full
```

History-mode controls: history weight, new-seed weight, and maximum pool
depth. Drift-mode control: new-seed chance (0-100%); 0% behaves like
Locked, 100% is identical to Per-cycle. Morph-mode controls: repeat chance
(0-100%), new-layer chance (0-100%, the same knob Drift uses), and blend
width (1-64 cycles); a finishing fade-in can take over even while Morph is
holding.

## 8.3 Inheritance

Rhythm, Pitch, and Channel each have a **Follow global** toggle. When
on, that stream uses the global mode and its local controls are hidden.
When off, it runs its own mode and base seed. The Overview tab draws the
current arrangement.

Ratchet and Ornaments always run their own base seeds, because they
realize during dispatch. In a neutral patch both start at 0.

## 8.4 Seed paths

While the transport runs, the engine records the seed actually used for
each cycle in each domain. The resulting list is a **seed path**. Paths
are immutable.

| Action | Effect |
|---|---|
| Replay | Force the recorded seeds on the next playthrough. Wildcarded positions sample fresh. |
| Wildcard | Mark a domain, or specific cycles inside a domain, as free. |
| Save | Store the path in the patch. |
| Promote | Use the most recent path as the basis for further variation. |

Recording a playthrough always produces a new path. Replaying never
mutates the source path.

Procedure — capture a variation permanently:

1. Stop the transport. Note the cycle index of the variation.
2. Open Setup → Seed Strategy → Overview.
3. Locate the path covering those cycles.
4. Mark that path for replay.
5. Save the patch.

Procedure — keep the rhythm, vary the rest:

1. Record a playthrough as above.
2. Wildcard the Pitch and Channel domains in the path.
3. Replay. Rhythm reproduces; pitch and channel resolve fresh.

---

# 9. AUTOMATION

Automation moves editable values over musical time. The timeline preview
and MIDI playback read the same backend evaluator, so a displayed value
is the value in use.

## 9.1 Properties

| Property | Value |
|---|---|
| Sampling | Once per beat, before that beat is realized |
| Position storage | Exact rational `numer/denom`; editing precision 1,000,000,000 units |
| Span | One Automation length in cycles, shared by every lane |
| Curve | Per segment: type plus an amount |
| Editing during playback | Not permitted; edits clear the preview, refresh the visible cycle, and only then re-enable Play |

Automation length is a per-track setting in the active-track settings
row. Changing it stretches every lane. Point times are normalized, so a
point at 73% of the span stays at 73% whether the span is 8 cycles or
800.

## 9.2 The right-edge rule

Beat sampling never samples the exact right edge `1/1`.

```
4-beat cycle, 1-cycle span:  sampled phases are 0/4, 1/4, 2/4, 3/4
```

A point at `1/1` shapes the interpolation approaching the end of the
span but is never itself sampled. To set a value on the last beat, place
a point at that beat's own phase, `3/4` in this example.

## 9.3 Opening a lane

| Route | Result |
|---|---|
| Automation control in the active-track settings row | Opens the panel |
| Automation symbol beside a subsection label | Floating shortlist of that group's lanes; a colored count means some already have automation |
| Cmd-click or Control-click an automatable control | Opens the panel, creates the lane if needed, selects that target |

Adding a target creates a lane with two points, at `0/1` and `1/1`, both
set to the target's current value.

## 9.4 The lane editor

```
+--- Automation ---------------------------------------------+
| Search [____]   Group [All v]   Type [All v]                |
| Target browser:  sequencer.pitch              float         |
|                  sequencer.velocity           integer       |
|                  sequencer.boundary.{id}.probability  prob  |
| Active lanes: [Pitch] [Velocity] [Boundary 1 prob]          |
| +-- graph ------------------+  +-- points --+               |
| |     +--+---+--+           |  | 0/1    60  |               |
| |    /   |   |   \          |  | 1/4    72  |               |
| |   /    |   |    +         |  | 1/2    60  |               |
| +---------------------------+  | 3/4    48  |               |
| Weight lanes: Y min [0] Y max [20] [reset axis]             |
| Segment: [linear v]  Amount [0.5]                           |
| Global markers: [+] [-]                                     |
+-------------------------------------------------------------+
```

| Action | Gesture |
|---|---|
| Add a point | Click the graph |
| Move a point | Drag it |
| Select a segment | Click its line |
| Snap to a marker | Drag within 1.25% of the full span, or choose the marker in the point list |
| Edit exactly | Type phase percent and value in the point list |

Type handling: boolean lanes show 0/1 selectors; integer lanes round;
float and weight lanes stay continuous until their target clamps them.
Weight lanes add Y-min and Y-max controls that affect graph scaling and
point-edit limits only, not the meaning of the weight.

## 9.5 Curve types

```
hold        |___________|      value holds until the next point
linear      |__________/       straight interpolation
smooth      ___/      \___     smoothstep; amount blends linear to smooth
easeIn      |      ____/       slow start, faster end
easeOut     ____/      |       fast start, slow end
easeInOut   ___/   \___        slow at both ends
exponential      ____/         exponential, bend set by amount
```

Amount is clamped to 0.0–1.0. For the ease curves it sets the exponent;
for exponential it sets bend strength.

## 9.6 Global markers

Markers are shared vertical references drawn on every lane graph. Add,
edit, and remove them from the marker list; each has a phase percent and
a label.

**LIMIT** Markers are visual snap anchors, not constraints. A snapped
point stores the marker id and the marker's time at the moment of
snapping. Moving the marker later does not move the point; the evaluator
reads the point's stored time.

## 9.7 Target coverage

The target registry is wider than the set the engine currently applies.
Lanes for every registered target can be created, edited, and saved, and
they round-trip through the patch file.

Applied today:

- Cycle-level structure: pitch, velocity, all accent range endpoints,
  single-parameter rhythmic modulation, initial gati and jathi weights,
  max-section weights, boundary probabilities, per-boundary gati and
  jathi weights.
- `transport.tempoBpm`. In single-track playback this lane becomes the
  effective scheduler BPM while the Tempo field remains the base BPM. In
  a parallel track with custom tempo, the same lane is integrated
  continuously as that track's local clock.

Not yet applied: rhythm, ratchet, ornament, pitch shaper, channel
shaper, and synth program targets. Authoring them is safe and
persistent; they do not change sound yet.

## 9.8 The automation playback log

One row is recorded each time playback enters a beat with active
automation samples: sequence number, cycle, zero-based beat index,
tick-in-cycle, exact automation phase, and every sampled target value.
The table is capped and is diagnostic only. It samples through the same
typed evaluator playback uses, so it is authoritative when a value is in
question.

---
# 10. RHYTHM

The **Rhythm** editor decides how each protected accent span is divided
into cells, and what each cell does. It has four tabs.

| Tab | Contents |
|---|---|
| Patterns | Markov pattern matrix per span length, articulation, beat locks |
| Re-subdivision | Gati speed and jathi timing multipliers; arbitrary subdivision |
| Ratchet | Chapter 11 |
| Ornaments | Chapter 12 |

The panel header shows a status strip: seed mode, ratchet on/off,
ornaments on/off, flux on/off.

## 10.1 Span length and pattern states

A **pattern** is an ordered list of positive matra lengths that sums
exactly to the span length. Patterns are the integer compositions of
that length.

```
span 3:  [3]  [1,2]  [2,1]  [1,1,1]
span 4:  [4]  [1,3]  [3,1]  [2,2]  [1,1,2]  [1,2,1]  [2,1,1]  [1,1,1,1]
span 5:  [5]  [1,4]  [4,1]  [2,3]  [3,2]  [1,1,3]  ...
```

The **Span Length** picker selects which matrix is being edited: 3, 4, 5,
6, 7, 9, or 11. Each length has its own matrix, because the set of
patterns that fill 4 matras is unrelated to the set that fills 7.

Select a subset of states for each length. Only selected states appear in
the matrix and only selected states can be drawn. Reducing the subset is
the direct way to narrow the rhythmic vocabulary.

## 10.2 The transition matrix

| Control | Values | Default | Effect |
|---|---|---|---|
| Chain order | first / second | first | First order uses the previous state as context; second order uses the previous two |
| Cell weights | integers ≥ 0 | 0 | Relative weight of the transition from the row state to the column state |

The matrix is drawn as a heat map. Weight magnitude runs
blue → teal → green → yellow → orange → red. Empty cells are recessed
charcoal. Inputs sit inside the heat cell.

## 10.3 Entry and fallback

These are distinct mechanisms and are configured separately.

| Mechanism | Used when |
|---|---|
| Entry selector | A chain has no context yet — the first span of a fresh chain |
| Fallback | A chain has context but the current state has no positive outgoing weight |

Fallback modes:

| Mode | Behavior |
|---|---|
| Static | Always use one fixed state, typically `[N]` |
| Weighted | Draw from a weighted pool of states |

Resolved spans record whether they came from a fallback. Cold-start entry
choices are reported separately from true fallback hits. Fallback hits
are drawn red in the rhythm lane.

## 10.4 Articulation: rest and tie

Each resolved cell rolls one of three outcomes.

| Outcome | Effect |
|---|---|
| Play | An ordinary note-on at the cell start |
| Rest | Silence for the cell's duration |
| Tie | This cell sustains forward into the following cell; the following cell has no new note-on |

Rest and tie probabilities are authored per cell of each selected state.
They are mutually exclusive; Rest owns the first probability slice, Tie is
capped by the remainder, and the rest is Play.

```
state [1,3]   cell 1: rest 5%  tie 0%   -> play 95%
              cell 2: rest 0%  tie 20%  -> play 80%
```

Rules:

- A rest on a cell breaks an incoming tie and an outgoing tie.
- A tie only holds between audible, unlocked neighbours.
- The final cell can sample Tie intent but has no following cell to hold, and a
  Tie intent targeting a Rest cannot become an audible held edge. Resolved
  intent percentages therefore match the controls over independent trials even
  when the audible held-edge percentage is lower.
- Percentages are seeded Bernoulli rates, not exact quotas per cycle. A locked
  rhythm seed with Follow rhythm 100% deliberately repeats one finite mask;
  use independent/per-cycle seeds to measure the configured long-run rate.
- Tied cells are one MIDI note from the note-on through the last tied
  cell.

## 10.5 Accent policies

By default, a rest or tie that would hide the first cell of an active accent
span is converted back to play. The two percentage gates control how often the
sampled articulation is allowed through at those protected boundaries.

| Policy | Values | Default | Effect |
|---|---|---|---|
| Rest over accent | 0–100% | 0% | Conditional chance that a sampled Rest may start on an accent-span start |
| Tie over accent | 0–100% | 0% | Conditional chance that a sampled Tie may cross an accent-span start |

The authored and accent probabilities multiply at protected boundaries: Rest
40% with Rest-over-accent 25% produces a 10% final rest rate there. The same
conditional rule applies to a Tie crossing an accent, before accounting for a
rested target.

A tied group crossing an accent start is the only case in which rhythm
may hide an accent. If such a group is ratcheted, the ratchet fills the
whole tied duration as though the group had been authored at that
length. Rested cells never ratchet.

## 10.6 Copy current

Writes the current matrix into other span lengths after extrapolating
the states: each state is mapped to an analogous state in the target
length and the transition weights are renormalized. The result is an
ordinary editable matrix with no runtime link to the source.

## 10.7 Learn from passage

Accepts a list of pulse lengths, independent of the current cycle:

```
[1, 5, 2, 3, 1, 4, 1, 1, 1, 2, 1, 1, 2, 1, 3, 3, 3, 1, 5]
```

The importer treats the list as source vocabulary. It infers a compact
state subset per target span length, fits observed windows into that
subset, and tallies first-order or second-order transition weights.
Target chips select which span-length matrices receive the result; the
order control selects which matrix order the weights land in.

The generated chain is materialized as ordinary editable matrix state.

## 10.8 Beat locks

A beat lock pins one beat or a range of beats to a fixed rhythm, or to a
weighted choice from a small pool, with an optional weighted
"pass through unlocked" outcome.

The lock overlays the resolved Markov rhythm. It is applied after Markov
resolution and re-subdivision and before articulation, ratchet, pitch,
and channel routing. The Markov chain underneath continues undisturbed
and unaware.

On a custom equal-parts section, a lock applies only when every authored
beat boundary maps exactly to an integer pulse boundary on the resolved
part grid. If any beat boundary falls between pulses, the whole lock
passes through for that section and cycle.

**Strict tiling.** A locked pattern is authored in matras of the
prevailing per-beat gati. It is eligible in a given cycle only if its
pulses sum exactly to the locked span's resolved matra count, that is
`Σ gati` over the locked beats. Because gati can change per cycle, the
pool may hold patterns of several totals; each cycle the draw happens
among the patterns whose total matches that cycle's resolved count, plus
the weighted unlocked option. If nothing in the pool is eligible, the
lock passes through unchanged for that cycle and reports a distinct
diagnostic.

| Control | Range | Default | Effect |
|---|---|---|---|
| Beat range | 1 – beats/cycle | — | Which beats the lock covers; individual beats can also be toggled |
| Assignment mode | fixed / weighted | fixed | One pattern, or a weighted pool |
| Pattern list | patterns summing to M | — | Candidate patterns; each has a weight |
| Catalog gati | 3–11 | — | The gati whose matra total the add-pattern helper builds for |
| Unlocked weight | ≥ 0 | 0 | Weight of drawing no lock this cycle |
| Rest % / Tie % (lock defaults) | 0–100 | 0 | Articulation defaults for the lock's cells |
| Per-cell rest / tie | 0–100 | inherit | Per-cell overrides; a cell left at 0/0 follows the lock defaults |
| Beat lock seed | ≥ 0 | 0 | Stream for the lock draws |

Beat locks take precedence over Shape Groups and over Jathi Bhedam
notes-per-cell rewrites. Locked cells and pinned tie continuations are
never reshaped.

## 10.9 Gati speed and jathi timing

Speed multipliers reinterpret the timing grid for a gati or jathi
context without changing the drawn gati identity.

| Weight row | Meaning |
|---|---|
| 1st | Native matra count. Neutral. |
| 2nd, 3rd, 4th | Anuloma. 2, 3, or 4 times as many timing units in the same beat. |
| 1/2 … 1/7 | Pratiloma. The native material is spread across a 2- to 7-beat frame. |

```
gati 5 x 2    -> 10 timing units per beat
gati 5 x 1/2  -> 5 timing units per 2 beats; valid only over an even
                 number of beats
```

Jathi timing exposes only 1st through 4th.

Timeline labels read `gati 4 x 2`, `gati 5 x 1/2`, `jathi 3 x 2`. The
gati lane still draws native cells. The annotation describes the grid
that jathi validity and Markov rhythm tile.

Pratiloma speeds that cannot tile a section context exactly stay visible
in the editor and are marked as skipped.

## 10.10 Arbitrary subdivision

Reinterprets a protected accent span at a different virtual matra count
before Markov grouping, across the same absolute duration.

```
native protected span:   9 matras   |=================|
virtual target:          7 matras   |=================|
chosen virtual pattern:  [1, 6]
audible onsets:          at 0/7 and 1/7 of the native span duration
```

| Control | Range | Default | Effect |
|---|---|---|---|
| Probability | 0–100% | 0 | Chance a span is reinterpreted this realization |
| Target weights | ≥ 0 per length | 1 per length | Weighted virtual span lengths |
| Clump count weights | 1–4 | 1 each | How many contiguous virtual clumps to use |
| Cell source | Markov / weighted pool | Markov | Markov uses the target length's chain; pool uses a per-target weighted set |
| Allow trivial | on / off | off | Whether the trivial `[N]` pattern may be drawn |

Rules:

- The original accent span boundary stays protected.
- The virtual subdivision stays wholly inside that one span.
- Required protected cuts inside the span must project exactly onto the
  virtual grid, or the span is skipped.
- Weighted-pool mode does not advance the target length's Markov history.
- A target length with no positive eligible pool cell is inert: it is
  skipped rather than failing realization.

Default probability is 0, so rhythm behavior is unchanged until enabled.

---

# 11. RATCHET

Ratchet subdivides an already audible note group into repeated note-on /
note-off pairs during playback. It does not change gati, jathi, section
structure, or the rhythm tree.

The primary surface is a vertical stack of strips, each answering one
question, with a read-only outcome picture and its controls beside it.
A deep drawer holds the full parameter set.

```
+- RATCHET  (o power) --------------------------------- deep ▸ -+
| OUTCOMES          natural fire probability, rolled three times |
| HOW OFTEN?        amount + cooldown                            |
| HOW FAST?         effective millisecond band, shape, sync      |
| WHERE IN PHRASE?  phrase / in-span / exact-edge weights        |
| WHICH NOTES?      short-long preference + optional pulse window|
| EVERY BURST       one realized sample: onsets, fill, pace, jitter|
+---------------------------------------------------------------+
```

Every handle is keyboard operable: arrow keys nudge, Shift steps larger.

**Commit on release.** During a pointer drag only the local graphic and
its numeric readout move. There are no patch writes and no preview calls
until the pointer is released. Starting a drag invalidates outstanding
previews, so a late response cannot overwrite the gesture. Keyboard
steps commit immediately.

## 11.1 Outcomes and how often

The outcome blocks show backend-computed natural fire probabilities. The
three faint lanes beneath them are display-only sample rolls.

| Control | Range | Default | Effect |
|---|---|---|---|
| Power | off / on | off | Enables the whole ratchet layer |
| Amount | 0–100% | 0 | Base density of fired gestures |
| Cooldown amount | see basis table | 0 | Refractory window after a gesture fires |
| Cooldown basis | pulses / ms / beat multiple / % of beat | pulses | Unit for the cooldown window |

Cooldown limits by basis:

| Basis | Maximum | Step |
|---|---|---|
| Pulses (matras) | 16 | 1 |
| Milliseconds | 2000 | 10 |
| Beat multiple | 4 | 0.125 |
| % of beat | 400 | 5 |

During cooldown, later candidates are skipped before their probability is
rolled.

Shape Group ratchet triggers (Chapter 16) are an additional path that
forces a fire.

## 11.2 How fast — the band

Repeat speed is governed by a tempo-elastic band rather than a fixed
rate.

| Control | Range | Default | Effect |
|---|---|---|---|
| Slow edge | hits/sec at 120 BPM | 9 | Slow limit of the band |
| Fast edge | hits/sec at 120 BPM | 25 | Fast limit of the band |
| Tempo follow (tracking) | 0.0–1.0 | 0.5 | 0 = fixed milliseconds; 1 = fully metric |
| Bias | −1.0–1.0 | 0 | Shifts the likelihood inside the band |
| Spread | 0.0–1.0 | 0 | Widens the likelihood inside the band |
| Sync | off / on | off | Lock repeats to an integer subdivision of the real local pulse grid |

Band behavior:

- Edges are authored at a 120 BPM reference and scale with the effective
  local beat by the tracking exponent.
- Scaling saturates softly at ±3×.
- Absolute rails are 18 ms and 200 ms. Values beyond the rails clamp.
- Every rapid inter-onset interval is enforced inside the band, under
  drawn time curves, jitter, Cycle Flux, parallel-track local tempo, and
  tempo automation.
- The band counts consecutive rapid onsets only. The last rapid segment's
  remaining sustain and a separate fill hold are not counted as
  intervals.
- With Sync on, a fractional fill can end with a short terminal
  remainder. A tied note crossing a gati change follows each region's own
  pulse width.

The millisecond handles invert the backend's own band computation; the
interface does not keep a second formula.

## 11.3 Where in the phrase, which notes

| Control | Range | Default | Effect |
|---|---|---|---|
| Phrase weights | ≥ 0 per accent span | empty | Redistributes chance across the accent spans of the cycle |
| In-span start / mid / end | ≥ 0 | 1 / 1 / 1 | Gradient of chance within one span |
| Edge weights: accent start, accent end, section start, section end, cycle start, cycle end | ≥ 0 | 1 each | Chance at exact structural boundaries |
| Normalize | off / on | on | Rescales placement to mean 1 per cycle so Amount stays a density |
| Length bias | −1.0–1.0 | −0.5 | Negative prefers short notes; positive prefers long notes |
| Length window | duration range | off | Restricts candidates to a range of note durations |

With V2 placement active, the edge weights replace the legacy modifier
stack described in §11.6.

## 11.4 Every burst

This strip shows one backend-realized sample gesture with its actual
onsets, durations, velocities, and any hold.

| Control | Range | Default | Effect |
|---|---|---|---|
| Hit count | integer | from band | Number of repeats in the focused sample |
| Fire chance | 0–100% | computed | The focused sample's own probability |
| Pace | accelerate ↔ ritard | neutral | Writes a two-point custom time curve. A hand-drawn curve takes precedence and this handle steps aside. |
| Fill | off / lead / trail | off | `lead` plays the burst then sustains one hold hit to the note end; `trail` holds first and lands the burst on the span boundary |
| Jitter | 0–100% | 0 | Seeded timing spread |
| Velocity contour | rise / fall / arc | none | Moves the velocity attractor across the burst |
| Humanize | 0–100% | 0 | Loosens the velocity draw around the contour |

The hold hit in a fill gesture is exempt from the band and renders as a
sustained tail. The hits still tile the source span exactly.

## 11.5 Velocity

| Control | Range | Default | Effect |
|---|---|---|---|
| Mode | relative / absolute | relative | Relative offsets are measured from the source note's velocity |
| Min | −64 – 64 (relative) | −24 | Low edge of the generated range |
| Max | −64 – 64 (relative) | 16 | High edge of the generated range |
| Center | −64 – 64 | 0 | Attractor value |
| Attraction | 0.0–1.0 | 0.65 | Pull of each draw toward Center |
| Same as previous | 0.0–1.0 | 0 | Probability a hit repeats the previous hit's velocity |

Relative mode keeps a burst over a soft note soft and a burst over a loud
accent loud. Absolute mode uses fixed MIDI velocities.

## 11.6 Deep drawer and legacy fields

The drawer contains the complete parameter set. Each legacy resolver
still applies verbatim when its corresponding V2 layer is null.

**Probability modifiers.** Each modifier either multiplies the running
chance (neutral 1) or adds a fixed offset (neutral 0). The result is
clamped to 0.0–1.0.

| Modifier | Default | Applies when |
|---|---|---|
| Slow note | off, threshold 2 matras, ×1.5 | Candidate duration is at or above the threshold |
| Fast note | off, threshold 20% of beat, ×0.6 | Candidate duration is at or below the threshold |
| Accent span start / end | ×1 | Candidate begins or ends an accent span |
| Section start / end | ×1 | Candidate begins or ends a section |
| Cycle start / end | ×1 | Candidate begins or ends the cycle |
| Phrase position | off, flat 3-point curve | Interpolates a probability and a speed factor across the cycle |

Slow-note and fast-note thresholds can be expressed in matras or as a
percentage of one beat.

**Rate strategies.**

| Strategy | Default window | Behavior |
|---|---|---|
| Audible hits per second | 12–22 | Accept an integer repeat count only if the resulting rate falls in a BPM-aware window |
| Bounded hits per beat | 8–14 | Accept a count only if the resulting hits per beat fall in the window |
| Hits per matra | 2–3 | Tuplet-locked; hits follow local matra speed |

Distribution shapes the draw inside the accepted range: uniform, toward
median, away from median, favor slow, favor fast.

**Time curve.**

```
y (relative stretch)
^
|  even-spacing line ....................................
|            /---\
|          /      \___
|     ___-/
+------------------------------------------> x (position in the note)
0/1                                        1/1
```

- x is position through the source note group.
- y is relative stretch. The center line is even spacing; above center
  lengthens that region, below center shortens it.
- Variance is a seeded vertical spread around the curve; 0 is exact.
- Preset weights: even, accelerando, retardando, accelerando-retardando,
  retardando-accelerando. All default to 0.
- With interpolation off, one weighted curve is drawn. With
  interpolation on, two are drawn and a seeded uniform blend amount is
  taken between the configured low and high bounds.

Time curves always hold the source note's start and end fixed and move
only interior split points. Interior boundaries stay monotonic.

**Span gate.**

| Control | Range | Default | Effect |
|---|---|---|---|
| Multi-matra | off / on | off | Whether ratchet may target groups longer than one matra |
| Global max span | matras | 4 | Cap on held width for every subdivision length |
| Per-subdivision max | matras | — | Per-length overrides of the cap |

The limit always applies inside one accent span.

**Internal ratchet rhythm.** Optionally groups the generated hit grid
using a Markov rhythm chain whose span length equals the generated hit
count. Default hit-count gate is 3 to 11. If no matching chain exists,
if the drawn pattern does not tile the count, or if the count falls
outside the gate, playback keeps the straight generated hits. Internal
rest and tie articulation is permitted inside the burst.

---

# 12. ORNAMENTS

Ornaments are playback articulations of resolved note groups. Two types
exist: grace notes and onset delay. One power switch covers both; each
type is disabled individually by setting its probability to 0.

## 12.1 Grace notes

Grace notes are short attacks placed before or on the target note.

| Control | Range | Default | Effect |
|---|---|---|---|
| Probability | 0–100% | 0 | Chance a candidate target receives grace notes |
| Count weights | single / double / triple, ≥ 0 | — | How many grace notes in the group |
| Placement | before beat ↔ on beat, 0–100% each | — | Two-sided weight; either side may be 0 |
| Duration basis | ms / % of beat | ms | Unit for grace-note length |
| Duration | ms ≤ 250, or % of beat ≤ 50 | — | Length of one grace note |
| Target rests | off / on | off | Whether rested cells may receive grace notes |
| Cooldown | same controls as ratchet | 0 | Refractory window |
| Velocity mode | relative / absolute | relative | As in §11.5 |
| Velocity min / max / center | −64 – 64 | −18 / 4 / −8 | Generated range and attractor |
| Attraction | 0.0–1.0 | 0.55 | Pull toward center |
| Probability modifiers | same family as ratchet | neutral | See §11.6 |

Placement rules:

- **Before beat** grace notes end at the target's start. Targets on the
  first tick of the cycle are skipped; grace notes never wrap into the
  previous cycle.
- **On beat** grace notes start at the target's start and delay the
  principal note when the target is audible.

Tie rules: a tied group is one target and may receive one ornament for
the whole group. Tie continuation cells never receive their own ornament.

## 12.2 Delay

Delay moves the target's note-on later. The note-off stays at its
expected tick, so the note is shortened. Playback clips the resolved
delay to before the target's note-off, so the note remains audible and
never overlaps the following event.

| Control | Range | Default | Effect |
|---|---|---|---|
| Probability | 0–100% | 0 | Chance a target is delayed |
| Basis | ms / matras / beats / % of beat | ms | Unit for the timing window |
| Min | in the chosen basis | 0 | Low edge of the window |
| Max | in the chosen basis | 0 | High edge of the window |
| Sampling | unquantized / quantized | unquantized | See below |
| Distribution | uniform and related shapes | uniform | Shape of the unquantized draw |
| Tuplet weights | 3, 4, 5, 6, 7, 9, 11; ≥ 0 | — | Grid weights for quantized sampling |

- **Unquantized** draws anywhere inside the window using the selected
  distribution.
- **Quantized** selects a tuplet grid point that falls inside the window,
  weighted by the per-tuplet weights. A weight of 0 removes a grid
  without deleting the row.

## 12.3 Pitch and channel of an ornament

Each ornament type declares how its pitch and channel resolve. The Pitch
editor and Channel editor evaluate these.

| Rule | Result |
|---|---|
| Keep source target | The ornament uses the target note's pitch and channel |
| Move whole ornament | One value is resolved for the entire ornament group |
| Per-hit probabilistic | Each grace note resolves its own value |

Onset delay never changes pitch.

---

# 13. CYCLE FLUX

Cycle Flux warps event times inside one cycle. It is edited from the
**Cycle tempo flux** disclosure in the Sections and Subdivisions editor.

It defines an instantaneous BPM profile across one complete cycle. The
transport converts that profile into a normalized cumulative time map,
then pins the cycle start and the cycle end to exact ticks.

```
BPM
^
|     ___          ___
|    /   \   ___  /   \
|  -/     \-/   \/     \-
+---------------------------------> cycle position
0                               1

Cycle start and end ticks are fixed. Only interior events move.
Total cycle length does not change.
```

| Control | Range | Default | Effect |
|---|---|---|---|
| Enabled | off / on | off | Enables the warp |
| Low BPM | BPM | 78 | Bottom of the profile range |
| High BPM | BPM | 84 | Top of the profile range |
| Curve | drawable, 5 points | 0.72, 0.58, 0.38, 0.58, 0.72 | The BPM profile across the cycle |
| LFO depth | 0.0–1.0 | 0 | Seeded slow cycle-periodic warp added to the curve |

Cycle Flux does not change gati, jathi, section boundaries, Markov
grouping, rests, ties, pitch, or channel. It changes only when events
occur inside the fixed cycle length.

When enabled, the timeline draws a compact full-cycle flux rail above
the resolved sections, using the same cycle seed and timing map as
playback, and marks the warped beat-boundary positions.

---
# 14. PITCH

The Pitch editor rewrites note pitches after rhythm, ratchet, and
ornaments have produced the final audible note groups, and before the
Channel editor assigns final MIDI channels.

Pitch shaping does not change gati, jathi, rhythm grouping, rests, ties,
ratchet timing, velocity, or channel identity.

The editor has three tabs.

| Tab | Contents |
|---|---|
| Pitch Map | Range, collection, pitch set, fallback |
| Transitions | Markov order, matrix, entry, fallback, boundary policy |
| Playback | Ratchet pitch, ornament pitch, grace injection, transposition |

## 14.1 Pitch Map

Pitch states are edited as notation on a grand staff. Names and MIDI
numbers remain available as secondary labels and fields; the staff is
the primary editor. Numeric inputs and labels are never placed on top of
noteheads, accidentals, ledger lines, or clefs; weighted fallback values
live in an aligned lane below the staff.

| Control | Range | Default | Effect |
|---|---|---|---|
| Range low | 0–127 | 48 (C3) | Lowest pitch the shaper may output |
| Range high | 0–127 | 71 (B4) | Highest pitch the shaper may output |
| Collection | preset list | chromatic | Selecting a collection materializes an ordinary editable pitch set |
| Transposition index | 0 – (transpositions−1) | 0 | Which transposition of a limited-transposition collection |
| Notehead | on / off / ghost | — | Membership of the pitch set, and fallback role |
| Weighted fallback values | ≥ 0 per degree | — | Weights used by the fallback policy |

Limited-transposition collections (the Messiaen modes T1, T2, …) are
presets. Selecting one writes ordinary editable pitch states. There is no
runtime dependency on the preset afterward: individual notes, fallback,
and weights can all be edited freely.

## 14.2 Transitions

| Control | Values | Default | Effect |
|---|---|---|---|
| Order | first / second | first | First order uses the previous resolved pitch as context; second order uses the previous two |
| Matrix cell weights | ≥ 0 | 0 | Relative weight of one transition |
| Entry selector | ≥ 0 per state | — | Weighted first choice for a fresh chain |
| Fallback | static / weighted | static | Used when the current state has no positive outgoing weight |
| Boundary policy | see table | nearest | What happens when a transition would land outside the range |
| Modulo interval | semitones | 12 | The interval used by the wrap policy |

Boundary policies:

| Policy | Result when a transition leaves the range |
|---|---|
| Wrap | Wrap around the modulo interval |
| Clamp | Clamp to the range edge |
| Reflect | Mirror back into the range |
| Fallback | Use the static or weighted fallback |
| Nearest | Snap to the nearest in-range pitch |

Matrices may mix absolute pitch targets with relative chromatic targets
and relative collection targets. The heat map uses the same ramp as the
Rhythm and Channel matrices.

**Transition recipes** fill the matrix with a named contour in one
action:

| Recipe | Result |
|---|---|
| Step up | Walk up the scale one step at a time |
| Step down | Walk down the scale one step at a time |
| Pendulum | Rise below the tonic, fall above it |
| To tonic | Wander by step but keep resolving back to the tonic |
| Random walk | Mostly single steps, sometimes leaps of two |

A pitch passage can also be pasted; the importer tallies its transitions
into the matrix in the same way the rhythm passage importer does.

## 14.3 Playback

| Control | Values | Default | Effect |
|---|---|---|---|
| Ratchet pitch mode | source / whole gesture / per hit | source | How a ratchet burst resolves pitch |
| Whole gesture chance | 0–100% | 0 | Chance the whole burst moves to a new pitch |
| Per-hit chance | 0–100% | 0 | Chance each hit resolves its own pitch |
| Ornament pitch mode | target / whole ornament / per grace | target | How a grace group resolves pitch |
| Grace pitch chance | 0–100% | 0 | Chance a grace note takes a pitch from the grace pool |
| Grace pitch pool | weighted MIDI pitches | one entry, 60 | Candidate grace-note pitches |
| Grace transpose chance | 0–100% | 0 | Chance a grace note transposes from its target |
| Grace transpose intervals | weighted semitones | 1, 2, 7 at weight 1 | Candidate grace-note intervals |
| Transpose enabled | off / on | off | Enables probabilistic transposition |
| Transpose probability | 0–100% | 0 | Chance a transposition applies |
| Transpose mode | per note / stair-step | per note | Per note transposes independently; stair-step transposes a passage then advances |
| Transpose value | semitones | — | Step size |

Transposition is separate from transition choice. By default it renders
a different pitch without driving Markov memory. It drives memory only
when that is explicitly enabled and the rendered pitch matches a state.

Onset delay never changes pitch.

---

# 15. CHANNEL

The Channel editor assigns each note's output MIDI channel. It runs
after pitch shaping and before Channel Logic resolves collisions between
parallel tracks.

Channel states are user-facing MIDI channels 1–16. When hocketing is off,
every event uses the static output channel.

```
+--- CHANNEL -------------------------------------------------+
| Hocket [on/off]  Output [1]  Assignment [Markov v]  Seed     |
| Order [first]    Axis [4]    Fallback [1]                    |
| Channel set: [x]1 [x]2 [ ]3 [x]4 [ ]5 ...                    |
| Tabs: Matrix | Entry & Fallback | Accents | Positions |      |
|       Gestures                                               |
+--------------------------------------------------------------+
```

| Header control | Values | Default | Effect |
|---|---|---|---|
| Hocket | off / on | off | Enables per-note channel assignment |
| Output | 1–16 | 1 | Static channel used when hocketing is off |
| Assignment | Markov chain / Euclidean (Bjorklund) | Markov | Which strategy assigns channels |
| Order | first / second | first | Markov only |
| Axis | 1–16 | 4 | Sizes the Markov axes, entry selector, and fallback pool; setting 6 enables channels 1–6 |
| Fallback | 1–16 | 1 | Channel used when the chain is stuck |
| Channel set | 16 chips | 1, 2, 3, 4 | Which channels may receive routed notes |

Exactly one assignment strategy is active. The other strategy's settings
stay authored and validated, so switching back loses nothing. Order and
Axis are Markov-only and are hidden in Euclidean mode.

## 15.1 Markov strategy

The **Matrix** tab is the authoring surface: rows are the context
channel, columns the destination, cells hold non-negative weights. First
order uses the previous resolved channel; second order uses the previous
two.

**Entry & Fallback** sets how a fresh chain starts and how a stuck chain
recovers, with the same entry-versus-fallback distinction described in
§10.3.

Channels not in the enabled set never receive routed notes.

## 15.2 Euclidean (Bjorklund) strategy

The Euclidean strategy replaces the stochastic walk with a deterministic
multi-voice pattern. Each layer is "k pulses spread as evenly as
possible over n steps" — E(3,8) = 10010010 — read one step per note. The
**Pattern** tab replaces Matrix and Entry & Fallback.

| Control | Values | Effect |
|---|---|---|
| Placement | Partition / Stack | Partition shares one cycle of Steps slots among the layers; Stack gives each layer its own Length |
| Steps | integer | Slot count for Partition placement |
| Length | integer, per layer | Mask length for Stack placement |
| Layer channel | enabled palette | Which channel this layer claims |
| Pulses | 0 – steps | How many slots the layer claims |
| Rotate | 0 – steps−1 | Start the necklace at a different position |
| Invert | off / on | The layer claims its rests instead of its pulses (Stack only) |
| Max run | ≥ 1 | Values above 1 cluster pulses into bursts of at most that length, then space the bursts by the same algorithm. Max run 1 is the classic pattern. |
| Reset | every cycle / every section / every beat / every accent span | When the pattern re-anchors to step one |
| Span accents | Woven into pattern / Pinned to channel | Whether accent-span starts take an ordinary step, or are routed to the anchor channel and removed from the stream |

Placement details:

- **Partition.** Each layer claims its pulses by iterated Bjorklund over
  the slots earlier layers left behind, so per-layer quotas are exact.
  Leftover slots go to the Fallback channel.
- **Stack.** Each layer has its own length, so the masks drift against
  one another. Earlier layers win collisions; misses fall back.

Layers are priority-ordered and reordered with the arrow controls.

Readouts per layer: the resolved mask as a bead strip, the adjacent
inter-onset interval vector — E(5,9) = (22221) — and, where the
classification applies, a Euclidean string or reverse Euclidean string
badge. The numbered strip at the bottom shows the resolved channel per
step, with fallback slots dimmed.

With **Pinned to channel**, accent-span starts leave the pattern stream
entirely and the weave compacts across them, so the interior sequence
stays exact while structural accents keep one channel.

Position rules and accent routing still apply in Euclidean mode with
positional meanings: a position reset re-anchors the pattern, and an
accent rule set to drive the chain advances the pattern to the next step
that plays the forced channel and continues from there.

Because the pattern is deterministic, the same cycle always weaves the
same way. Seeds continue to govern the probabilistic extras: accent
chances, gesture rolls, and weighted position actions.

## 15.3 Accents tab

Accent routing is a velocity-band override. Each rule states: notes whose
velocity falls in this range prefer these channels with these weights.

| Control | Range | Effect |
|---|---|---|
| Velocity low / high | 1–127 | The band the rule matches |
| Channel weights | ≥ 0 per channel | Preference inside the band |
| Mode | Render only / Drive chain | Render only rewrites the output channel without changing chain state; Drive chain makes the choice the new context |

The tab shows the current base, section, gati, and jathi velocity bands
as a read-only reference. Editing them jumps to the canonical controls in
the Sections and Subdivisions editor rather than duplicating them here.

## 15.4 Positions tab

Position rules act on note positions rather than velocity.

| Control | Values | Effect |
|---|---|---|
| Scope | Beat / Section | The unit the rule counts within |
| Nth note | integer | Which note inside that unit the rule matches |
| Action weights | normal Markov / render only / reset Markov | Weighted choice of what the rule does when it matches |
| Render channels | ≥ 0 per channel | Weights used by the render-only action |
| Reset mode | Static fallback / Weighted fallback / Custom weights | Where a reset action sends the chain |
| Reset channels | ≥ 0 per channel | Weights used by the custom-weights reset mode |

## 15.5 Gestures tab

| Control | Values | Default | Effect |
|---|---|---|---|
| Ratchet channel mode | source / whole ratchet / per hit | source | How a ratchet burst resolves its channel |
| Ornament channel mode | target / whole ornament / per grace | target | How a grace group resolves its channel |

## 15.6 Identity rule

The channel drawn on the timeline is the channel sent to external
CoreMIDI and shown in the MIDI debug log. The built-in synthesizer may
remap internally to work around General MIDI percussion behavior, but
that remap never changes the channel byte in the timeline, the debug
rows, or the external output.

---

# 16. SHAPE GROUPS

A Shape Group selects a set of musical spans and applies operations to
them. It answers four questions: what is selected, what stage of the
pipeline it acts at, what chance it fires with, and which operations
apply.

```
Shape Group
  domain     beat | rhythmCell | noteGroup
  stage      articulation | playbackFinalize
  selection  a composable expression
  chance     0-100%
  operations an ordered list
```

## 16.1 Stages and domains

| Stage | Runs | Legal domains |
|---|---|---|
| articulation | Inside the shared rhythm-overlay pass, so the stopped preview and playback produce identical results | beat, rhythmCell |
| playbackFinalize | In the transport, on finalized note-group onsets, before ratchet, ornaments, and hocket | beat, noteGroup |

A group may only select spans that exist at its stage. Mismatched
selectors are rejected by validation and dropped by the editor when the
domain changes.

## 16.2 Chance

`Chance` is the group's final gate, applied after selection and before
the operations. One draw per selected unit, shared by every operation in
the group. The draw is keyed by the unit's position, not by the
selection, so editing the selection or the operation list never re-rolls
which units passed. Default 100.

Chance and a probabilistic operation are independent gates, so their rates
multiply: Chance 40% with Rest 50% yields 20% rests across independent seeded
trials. These percentages are Bernoulli rates, not quotas inside each short
cycle. A locked seed intentionally repeats one deterministic mask; use a
per-cycle/independent seed stream when evaluating the long-run frequency. In
the beat domain, one draw is shared by every shapeable cell owned by that beat.

## 16.3 Selection

Selection is an expression built from the following terms.

| Category | Selector | Meaning |
|---|---|---|
| Explicit | beats | An explicit list of beats |
| | beatRange | A start beat and an end beat |
| Metric | everyNth | Every Nth unit along the domain's own axis, with an offset |
| | everyNthMatra ("every Nth pulse") | Every Nth position on the native subdivision grid, regardless of how cells group matras |
| | everyNthOnset | Every Nth note start; tie continuations never count. `countRests` decides whether rests occupy countable positions |
| | firstBeat, lastBeat | The first or last beat of the cycle |
| Structural | sectionStarts | Units that begin a section |
| | gatiEquals | Units in a section of a given gati |
| Generated | euclidean | A Bjorklund mask with pulses, steps, rotate, and invert, repeated across the units |
| Resolved (rhythmCell only) | cellIndexInSpan | Position of the cell inside its accent span |
| | cellLenEquals | Cells of a given matra length |
| | cellState | play, rest, or tie |
| Logic | not, and, or | Combine any of the above |

Notes on the axes:

- `everyNth` and `euclidean` count along the domain's own axis: beat
  index in the beat domain, resolved-cell order in rhythmCell, and
  note-group onset order in noteGroup.
- `everyNthMatra` counts the native grid, so it differs from cell order
  whenever one cell spans several matras.
- `everyNthOnset` is legal only in the rhythmCell and noteGroup domains.
  At the articulation stage the numbering is taken at the start of each
  operation, so an operation's own rewrites do not renumber mid-pass;
  later operations and groups see the updated articulation.

Beat-level predicates in the cell and note-group domains resolve each
unit to its owning beat.

## 16.4 Operations

Operations apply in list order. Later operations see earlier rewrites.

Articulation stage:

| Operation | Parameters | Effect |
|---|---|---|
| restProbability | percent | Silence the cell with that probability |
| tieProbability | percent | Sustain this cell forward into the following cell |
| forcePlay | — | Force an audible onset; clears rest and both holds |

Collision rules at this stage:

- `rest` is a hard silence. It breaks the incoming and the outgoing hold
  together, restoring the neighbours' tie flags coherently.
- `tie` holds only between audible, unlocked neighbours at that point in
  the pipeline. Rested, locked, and pinned targets are skipped, and the final
  cycle cell has no following target. The audible held-edge percentage can
  therefore be lower than the sampled Tie-operation percentage.
- `forcePlay` is a hard reset of the onset and clears stale tie metadata.

Playback-finalize stage:

| Operation | Parameters | Effect |
|---|---|---|
| setVelocity | 1–127 | Overwrite the velocity |
| scaleVelocity | ≤ 400% | Scale the current velocity |
| transposePitch | ±48 semitones | Add to the pitch |
| randomizePitch | range ≤ 48 | Uniform ± range, one draw per selected onset |
| randomWalkPitch | step ≤ 24 | Cumulative ± step across selected onsets; resets each cycle |
| accumulatePitch | perCycle ±48, wrap ≤ 96 | Offset = perCycle × cycle, folded into [0, wrap) when wrap > 0. No random draw. |
| invertPitch | centerPitch | p′ = 2c − p |
| stretchIntervals | percent ≤ 400, centerPitch | p′ = c + (p − c)·k, rounded half away from zero |
| quantizePitchToCollection | — | Snap to the nearest degree of the Pitch Map collection, ties downward |
| triggerRatchet | respectCooldown | Force a ratchet on the selected onset |
| triggerOrnament | respectCooldown | Force a grace ornament on the selected onset |

Each value is clamped as it is applied.

**Where pitch operations act.** Pitch operations transform the final
pitch. With the pitch shaper off they rewrite the leaf pitches directly.
With the shaper on, each selected onset's operations are reduced to a
compact pitch program that rides the queued note-on and is applied to the
shaper's rendered pitch at its write site. Ratchet hits inherit their
principal's program. The interface states the active application point on
each pitch-operation row.

**Trigger semantics.** Shape triggers sum with the panels' own
probability rolls: an onset fires if either says so. The panel's own roll
still consumes its random draws exactly as before, so runs without
triggers are byte-identical to runs of the same patch without the
feature. Set a panel probability to 0 to get only shape-triggered
gestures. The feature enable switch still gates everything: with ratchet
disabled, a ratchet trigger is inert. All settings — rate, curves,
velocity, grace shape — stay in the ratchet and ornament panels; a group
contributes only the trigger.

With `respectCooldown`, a trigger follows the same cooldown rules as a
natural fire: it is skipped while the cooldown is hot, and it resets the
timer when it fires.
Without it, the trigger is cooldown-transparent: it fires while the
window is hot, never resets the timer, and the natural path behaves
exactly as if the trigger did not exist. Delay ornaments are not
triggerable; grace ornaments are.

## 16.5 Priority and determinism

- Priority is list order. A later group sees earlier groups' rewrites, so
  a `forcePlay` group can revive cells an earlier group rested.
- Beat locks always win. Locked cells and pinned tie continuations are
  never reshaped.
- On unlocked Jathi Bhedam notes-per-cell spans, the generated fill is created
  before shaping, so Shape Groups operate on the cells that will be voiced.
- Each probabilistic operation has its own random stream, keyed by the
  set seed, the group id, the operation index, and the cycle. One draw
  per selected unit in domain order.
- Editing an operation's parameters or the group's selection never
  re-rolls another operation. Appending an operation never re-rolls
  existing ones. Removing or reordering re-keys the operations after the
  edit point.

---

# 17. RANDOMIZE

The Randomize editor generates configurations for one or more subsystems
in a single action. It does not run during playback; it writes ordinary
editable state that can then be edited by hand.

## 17.1 Domains

Select any subset. Each domain has a complexity setting from 1 (simple)
to 5 (complex).

| Domain | What it writes |
|---|---|
| Sections | Possible-boundary placement, chance, and section-count bias |
| Subdivisions | The gati and jathi vocabulary chosen within each section |
| Rhythm | Markov cells, entry, and fallback for the active span length |
| Ratchet | A modest ratchet chance plus a placement curve |
| Ornaments | Grace-note articulation of the resolved rhythm |
| Accents | The velocity-accent hierarchy: gati below jathi, plus a section boost |
| Jathi Bhedam | Seed numbers, evolution, and phrasing |
| Pitch | Mode and tonic, a transition contour over an in-mode subset, transposition |
| Channel | Hocket channel set and directed transitions across MIDI 1–16 |

Sections, Subdivisions, and Jathi Bhedam are structural domains; they
change what the cycle is, not only how it is articulated.

## 17.2 Family

The Family sets the shape of the generated Markov behavior — how one
step leads to the next. Each domain applies that shape to its own
material: a transition matrix for Rhythm, Pitch, and Channel; a placement
curve or vocabulary spread for the others.

| Family | Behavior |
|---|---|
| Loop | A short cycle that keeps coming back around. Tight and repetitive. |
| Drift | Keeps moving forward and rarely repeats. Never settles. |
| Hub | Keeps returning to one home state, then branches out again. |
| Braid | A few patterns phasing and crossing against each other. |
| Mesh | Almost anything can follow anything. Dense and least predictable. |

## 17.3 Advanced matrix modes

For the Rhythm, Pitch, and Channel domains, the generated matrix can be
produced by a different construction than the Family.

| Mode | Controls | Result |
|---|---|---|
| Classic (family) | — | The Family shape above |
| Stationary target | Preset, Strength | Builds a matrix whose long-run distribution matches a chosen preset |
| Diffusion geometry | Bandwidth, Drift | Transitions concentrated near the current state, with a directional drift |
| Metastable basins | Basins, Dwell, Escape | Clusters of states with long residence and occasional jumps between clusters |
| Spectral shaping | Gap, Oscillation, Modes | Shapes the matrix's eigenvalue structure to set mixing speed and periodicity |

Stationary presets: Even, Home-weighted, Favor sparse, Favor dense,
Favor entropy. Their meaning is domain-specific:

| Preset | Rhythm | Pitch / Channel |
|---|---|---|
| Even | Visit every cell about equally | Visit every state about equally |
| Home-weighted | Spend most time on the first, simplest cell | Spend most time on the lowest state |
| Favor sparse | Prefer cells with fewer onsets | Prefer the low end of the range |
| Favor dense | Prefer busier cells | Prefer the high end of the range |
| Favor entropy | Prefer the most internally varied cells | Prefer the most connected states |

Two shared controls apply to every generated matrix:

| Control | Effect |
|---|---|
| Sparsity | Proportion of cells left at weight 0 |
| Max weight | Upper bound on generated cell weights |

A preview of the generated transition matrix is drawn before the settings
are applied.

---
# 18. TRACKS, TRACK FLOW, AND CHANNEL LOGIC

A patch holds global references and up to **16 parallel track slots**.
Each track has its own complete sequencer surface: sections, rhythm,
pitch, channel, shape groups, automation.

## 18.1 The track strip

```
+-------------------------------------------------------------------+
| Tracks: [Track 1*] [Track 2] [ ▦ box A: Track 3 | Track 4 ]       |
| Actions: [New track] [Copy active] [Import track] [New box]       |
| Active track: name [        ]  cycle [follow v]  BPM [follow v]   |
|               automation cycles [4]  [Automation]                 |
+-------------------------------------------------------------------+
```

| Control | Values | Effect |
|---|---|---|
| Track tab | — | Selects the active track; switching during playback is a view change only and does not rewrite the running transport |
| Mute | off / on | Removes the track from audible output |
| Solo | off / on | Restricts audible output to soloed tracks |
| Export | — | Writes the track to a file |
| Delete | — | Removes the track. Requires confirmation and offers to save the track first. |
| New track | — | Adds an empty track |
| Copy active track | — | Duplicates the active track |
| Import track | — | Loads a track file into a new slot |
| Track cycle mode | follow global / custom | Whether the track uses the project cycle length |
| Track custom cycle | 1–64 | Beats per cycle for this track |
| Track BPM mode | follow global / custom | Whether the track uses the project tempo |
| Track custom BPM | BPM | This track's tempo |
| Track automation cycles | ≥ 1 | Automation length for this track |

A track tab shows small BPM text only when that track has a custom tempo
or custom tempo automation, including the automated BPM range where one
is available.

Transport playback merges every audible track after mute and solo
filtering. Parallel playback uses the global BPM and global cycle as the
reference clock; custom tracks map their own BPM, cycle length, and
continuous tempo automation against that reference.

Timeline editing and preview follow the active track, and the timeline
readout names the track being shown.

## 18.2 Track Flow boxes

A Track Flow box groups several track tabs. The box's own chain selects
**one member to sound per cycle**; the other members are silent that
cycle.

| Control | Effect |
|---|---|
| New Track Flow box | Creates an empty box in the tab lane |
| Drag a track tab onto a box | Adds that track to the box |
| Expand box | Shows the members |
| Rename box | Renames it |
| Delete box | Removes the box; its members become ordinary parallel tracks |
| Box transition matrix (▦) | Edits the weights that choose the next member |
| Box chain seed | The random stream for that box's member choice |

The lane readout shows which member each box is currently sounding.

Each box contributes one synthetic lane to the parallel participant list.
The participant total — parallel tracks plus one lane per box — is capped
at 16.

## 18.3 Channel Logic

Channel Logic resolves collisions. After every participant is realized
and merged into the shared transport queue, final note groups whose
sounding spans overlap **on the same user-facing MIDI channel** form an
overlap component, and a policy decides which tracks in that component
pass. The rest are suppressed before dispatch — note-on and note-off are
removed together — and are ghosted on the timeline.

Channel Logic is distinct from the Channel editor. The Channel editor
decides where notes land. Channel Logic decides who survives a landing
collision. It exists only on the parallel path; single-track playback
runs no conflict pass.

The panel sits below the transport bar and above the track tabs. The `i`
button in its header opens an inline reference covering collision scope,
default versus pair-rule evaluation, and each mode.

### Project default modes

| Mode | Result |
|---|---|
| Layer all | Every emitting track in the overlap passes. Note-off pairing is protected. |
| Random one | A single track passes. A collision keeps one winner, chosen deterministically from the collision tick, the MIDI channel, and the track list. |
| Alternate | A single track passes. Each successive collision on a channel advances to the next track; the rotation restarts every cycle. |
| Priority | The highest-priority colliding track passes; the rest are suppressed. The priority order is edited below the modes. |
| One only | A single track on the channel passes. Two or more overlapping tracks suppress the whole group. |
| Overlap only | Two or more overlapping tracks pass. A single track by itself is suppressed. |
| All tracks | Output appears only when every audible track is part of the same-channel overlap. |
| Majority | The group passes when more than half the audible tracks join it. |
| Minority | The group passes when fewer than half the audible tracks join it. |

The denominator for All tracks, Majority, and Minority is the current
audible track count after mute and solo. Tracks realized only to drive
followers are excluded from that count, so muting a source cannot change
the audible arithmetic.

Random one and Alternate are deterministic. Neither consults a random
seed: Random one hashes the collision tick and the channel; Alternate
uses the collision's rank among the resolved collisions on the same
channel in the same reference cycle.

### Pair and channel rules

The rule list overrides the default operator for one track pair on one or
more shared MIDI channels.

| Rule mode | Result for that pair on that channel |
|---|---|
| Layer | Rescue the pair even when the default would suppress it |
| Mute overlap | Suppress both tracks whenever they overlap |
| Random one | As above, applied to the pair |
| Alternate | As above, applied to the pair |
| Priority | As above, applied to the pair |

The shared-channel list is built from each track's possible output: the
static output channel when hocketing is off, or the entry selectors,
Markov destinations, and fallback channels when hocketing is on. Channels
that are configured but cannot collide yet remain visible as inactive
chips, labeled with the reason — the track's hocket is off, or the
channel is not routed by the current entry, transition, or fallback
weights.

**Conflicting rules block playback.** If two rows assign different
operators to the same track pair and MIDI channel, the conflict is
marked, a transport warning explains why Play is blocked, and playback
stays blocked until one of the rules is corrected.

Collision decisions operate on final note groups: a suppressed group
loses its note-on and its note-off together, and overlapping duplicate
channel/pitch notes are protected from premature note-offs.

The MIDI debug log and the parallel conflict debug table expose track id
and name, conflict policy, conflict action, and conflict group id, so a
group's pass or suppression can be checked directly.

---

# 19. MIDI OUTPUT AND THE BUILT-IN SYNTH

## 19.1 The virtual port and routed destination

On launch the program creates one virtual CoreMIDI source, **Caesura
MIDI** — the app's always-alive identity and canonical output.

Optionally, Setup → MIDI → Destination routes a copy of the stream to a
real destination (hardware interface, IAC bus, another app's virtual
input), matched by the destination's stable CoreMIDI unique id. The
virtual source stays alive regardless; the destination receives the same
bytes. The choice is machine-local (stored in the machine-prefs file,
never in patch documents) and reconnects automatically on hot-plug. A
missing destination falls back to the virtual source with a top-bar
warning chip.

| Host | Route |
|---|---|
| Ableton Live | Enable the "Caesura MIDI" input in MIDI Preferences, then select it as a track input |
| Logic Pro | External Instrument |
| Max/MSP | `midiin` with the port name |
| MIDI monitor | Read raw bytes |
| Hardware | Pick it under Setup → MIDI → Destination, or route via an audio interface / USB-MIDI box |

## 19.2 The monitor synthesizer

The built-in synthesizer is a monitor implemented over the macOS DLS
General MIDI synthesizer. Each user-facing MIDI channel is either melodic
or percussion and has its own program or drum key.

| Control | Range | Default | Effect |
|---|---|---|---|
| Channel mode | melodic / percussion | melodic | Which voice family channel N uses |
| Program | 0–127 | see App. B | GM program for a melodic channel |
| Drum key | GM drum note | see App. B | Drum note substituted for a percussion channel |
| Channel preset | load / save | — | Stores a full 16-channel voice set |

Routing: each user-facing channel owns a dedicated local synth bus. This
prevents cross-channel program-state bleed inside the monitor.

- A melodic voice plays on channel 1 of its dedicated bus with the
  configured program.
- A percussion voice plays on the drum channel of its dedicated bus, with
  the channel's configured drum note substituted.
- User channel 10 has no special status. If it is melodic it plays on
  channel 1 of its own bus; if it is percussion it plays on the drum
  channel of its own bus.

This routing is local to the monitor. External CoreMIDI bytes always
carry the user-facing channel exactly.

## 19.3 Voice changes during playback

If monitor voices change while the transport runs, the scheduler clears
realized future events and re-realizes from the current cycle, because
already-queued channel markers would otherwise describe the previous
channel-to-sound assignment.

Unchanged voice commands are no-ops. The same rule applies to unchanged
rhythm playback commands: the scheduler compares against the last
requested playback configuration, not the mutable runtime configuration,
so history seed pools can evolve internally without an identical resend
clearing the live queue.

---

# 20. FILES

## 20.1 The patch

The project file is a `.caesura` patch, internally a
`SequencerPatchDocument` schema version 6 document in indented JSON.

A patch records the complete working surface, not only the score:

- Transport tempo, project cycle, base pitch and velocity, cycle name.
- All parallel tracks, Track Flow boxes, and the Channel Logic
  configuration.
- Section boundary topology, gati and jathi weights, Jathi Bhedam
  selections, accent ranges, jathi mode, single-parameter modulation.
- Markov rhythm matrices per span length, articulation, accent policies,
  beat locks, gati speed and jathi timing weights, arbitrary subdivision.
- Ratchet, ornament, and Cycle Flux settings.
- Pitch editor state; Channel editor state including accent, position,
  and gesture rules; Euclidean pattern layers.
- Shape Group sets, Randomize settings.
- Seed strategy for every stream, history pools, and saved seed paths.
- Automation sets: length, markers, lanes, curves, points.
- Built-in synth voices, setup preferences, editor panel open states,
  MIDI debug visibility.
- A current cycle JSON snapshot for inspection.

Schema migrations are explicit. Schema version 1 patches load through the
legacy single-track migration; version 2 project files load through the
current migration path. Patches missing newer fields fall back to
defaults.

The file is readable and hand-editable JSON. Fields are interrelated and
the validator rejects inconsistent states; keep a backup before editing
by hand.

## 20.2 Save, recall, autosave

| Control | Location | Effect |
|---|---|---|
| Save | Transport bar and File menu | Writes to the current path. Disabled when nothing has changed since the last save. |
| Recall | Transport bar and File menu | Prompts for a patch file and rehydrates the working surface |
| Save Patch As | File menu | Always prompts for a new `.caesura` path |
| Recall Most Recent Patch | File menu | Loads the last remembered patch |
| Autosave toggle / status pill | Transport bar | Shows the current file name and the saved / unsaved state |

Autosave is recovery state, not a substitute for saving.

- Autosave writes a temporary recovery file at the configured interval
  (default 3 seconds; editable in Setup → Files).
- Every explicit save clears the autosave file.
- On startup a previous-session marker is checked. A clean previous
  session clears the autosave file.
- An unclean previous session produces a prompt before the autosave is
  loaded. Declining, or an invalid recovery file, clears it.
- Startup never silently applies autosave over a remembered recent patch.

## 20.3 Export Cycle JSON

Export Cycle writes a `.cseq.json` file: the structural cycle data only.
It cannot represent editor or interface settings. Use it to inspect the
structural representation or to pass a cycle to another tool. Use Save
Patch for everything else.

## 20.4 Track files

A single track can be exported to a file and imported into another patch,
from the track strip. Import creates a new track slot.

---

# 21. SETUP AND MENUS

## 21.1 Audio & MIDI Setup

Opened from the macOS **Setup** menu. Three tabs.

```
+----- Audio & MIDI Setup -------------------------------+
| ( Audio )  ( MIDI )  ( Files )                         |
|                                                        |
| AUDIO                                                  |
|   Built-in synth monitor       [ on / off ]            |
|   System audio output:         (readout)               |
|   Monitor voice count:         16                      |
|   [ Open Synth Properties... ]                         |
|                                                        |
| MIDI                                                   |
|   Default static MIDI channel: [ 1 ]                   |
|   Virtual CoreMIDI source:     (readout)               |
|   [ Open Channel editor ]                              |
|   MIDI debug visibility:       [ on / off ]            |
|   [ All notes off ]                                    |
|                                                        |
| FILES                                                  |
|   Autosave recovery:           [ on ]                  |
|   Autosave interval:           [ 3 s ]                 |
|   Recent-session autoload:     [ on ]                  |
|   Project state: (name)  (saved / unsaved)             |
|   [ Save As ] [ Export Cycle ] [ Clear Recovery ]      |
+--------------------------------------------------------+
```

Backend-fixed values such as the system audio output and the virtual
CoreMIDI source name are shown as readouts, not as selectable device
menus.

## 21.2 Seed Strategy

Opened from Setup → Seed Strategy. This is the only editable surface for
seed preferences; see Chapter 8. Tabs: Overview, Global, Rhythm, Pitch,
Channel, Ratchet, Ornaments.

## 21.3 Native menus

```
File
  New Patch                      cmd-N
  Save Patch                     cmd-S
  Save Patch As...               cmd-shift-S
  Recall Patch...                cmd-O
  Recall Most Recent Patch
  Export Cycle JSON
  Toggle Autosave Recovery

Setup
  Audio & MIDI Setup...
  Seed Strategy...

View
  Toggle Rhythm editor

Playback
  Reset Timeline Sync
  Built-in Synth Properties...
  Toggle Built-in Synth
```

Menu items are emitted as events the interface listens for, so menu
commands run the same handlers as the visible controls.

## 21.4 Structural edits during playback

Controls that would rebuild already-realized timing — beats per cycle,
boundary topology, automation edits — are disabled or become no-ops with
a short status message while the transport runs. The scheduler can
resynchronize safely, but the interface directs structural edits to a
stopped transport.

---

# 22. DIAGNOSTICS

Three logging surfaces are available, each a bounded ring driven by the
same transport snapshot data the timeline uses. None of them changes
playback.

| Surface | Contents | Default depth |
|---|---|---|
| MIDI debug log | Outgoing MIDI events the scheduler dispatched | 250 rows |
| Automation playback log | Automation samples consumed beat by beat | 100 rows |
| Parallel conflict table | Channel Logic decisions per note group | — |

MIDI debug row fields: sequence number, tick, decoded status byte,
user-facing channel, note and value bytes, a source label that
distinguishes transport cleanup messages from queued note dispatch, and
the monitor voice route for that note.

Use the MIDI debug log when the audio and the timeline appear to
disagree: it reports what was actually sent.

## 22.1 Reset Timeline Sync

Playback → Reset Timeline Sync clears the scheduler queue, releases the
notes the rebuilt stream will not close, and re-realizes from the
current cycle. It never modifies patch data; it discards only the
in-flight queue.

## 22.2 MIDI Panic

Playback → MIDI Panic (`⌘.`), also on Setup → MIDI, sends explicit
note-offs for every sounding note plus an all-notes-off sweep on every
channel and silences the synth — **without** stopping the transport
(playback continues). Use it to clear a stuck note on an external
instrument mid-performance.

---
# 23. PROCEDURES

Each procedure is a complete, checkable exercise. Each states the
expected audible result and what to look for on the timeline.

## 23.1 First sounding cycle

1. Launch the program. A new patch loads: 4 beats, 80 BPM, pitch 60,
   velocity 96, gati 4 at weight 1, all jathi weights 0.
2. Open **Sections and Subdivisions**. Set Beats/cycle to 8.
3. Enable the built-in synth in the transport bar.
4. Press Play.

Result: eight beats of four evenly spaced notes each, at pitch 60,
velocity 96, on channel 1.

Timeline: the beat ruler shows eight cells; the gati lane shows four
matras per beat; the active beat is tinted green.

## 23.2 A two-section probabilistic cycle

Goal: an 8-beat cycle that usually plays beats 1–4 in gati 4 and beats
5–8 in gati 7, but sometimes stays in gati 4 throughout.

1. Beats/cycle = 8, Pitch = 60, Velocity = 96.
2. Section inspector → Section 1 → Subdivision: gati 4 weight 1, all
   others 0.
3. Click the boundary rail after beat 4. Open the marker's `edit`
   action.
4. Boundary layer: chance 70%.
5. Subdivision layer: gati 4 weight 1, gati 7 weight 3.
6. Section map → Max sections per cycle: cap 2 weight 2, cap 1 weight 1.
7. Play.

Result: most cycles have four beats of four matras followed by four
beats of seven matras. About one third of cycles are capped at one
section and stay in gati 4 for the whole cycle. Occasionally the
boundary fires and draws gati 4 again; beats 5–8 then keep the same
subdivision but a new section begins.

Timeline: the section divider moves depending on whether the boundary
fired. Beat 5 receives the section-start extra accent whenever a section
starts there, regardless of the gati drawn.

Variation: lower the boundary chance to 30%; add a second boundary after
beat 6 at 40% with gati 4 and gati 5 weights, and raise the cap to 3.

## 23.3 A jathi across a section

Goal: a five-beat section in gati 4 carrying a jathi 5 accent pulse.

1. Beats/cycle = 5.
2. Section 1 → Subdivision: gati 4 weight 5, all others 0.
3. Section 1 → Jathi Accent: jathi 5 weight 3, all others 0.
4. Probability and accents bar: Jathi mode = Override gati; gati accent
   center +10 margin 2; section accent center +8 margin 2; jathi accent
   center +18 margin 4.
5. Play.

Result: 5 × 4 = 20 matras. Jathi accents fall on matras 1, 6, 11, and 16,
so they cross the beat starts at three of those four positions.

Timeline: the jathi lane shows four equal amber blocks of five matras.

Check the validity rule: set Beats/cycle to 4. The section now has 16
matras and 16 mod 5 ≠ 0, so jathi 5 is dimmed and the section resolves
with no jathi.

## 23.4 Markov rhythm inside jathi spans

Continue from 23.3.

1. Open **Rhythm** → Patterns. Span Length = 5.
2. Select the states `[5]`, `[1,4]`, `[2,3]`, `[3,2]`, `[1,1,3]`,
   `[2,1,2]`.
3. Chain order = first.
4. Weights: `[5]→[5]` 1, `[5]→[2,3]` 3, `[2,3]→[3,2]` 3,
   `[3,2]→[1,1,3]` 2, and enough others that the chain does not sit on
   one state.
5. Fallback = static `[5]`.
6. Play.

Result: each five-matra jathi span is divided by a pattern drawn from
the selected set, moving through them according to the weights.

Timeline: the jathi lane stays regular; the rhythm lane varies inside
each block, drawn amber because the jathi layer is the accent layer. A
red cell indicates a fallback hit.

Variation: set the rhythm seed to History mode with new-seed weight 2,
history weight 3, and depth 5. Over 10 to 20 cycles some patterns recur
and others arrive new.

## 23.5 Ratchet on long cells only

Continue from 23.4.

1. Open **Rhythm** → Ratchet. Power on.
2. Amount = 40%.
3. Which notes: Length bias = +0.6 (prefer long notes).
4. Deep drawer → probability modifiers: slow note enabled, threshold 2
   matras, multiply 2.0; fast note enabled, threshold 1 matra, multiply
   0.
5. How fast: slow edge 9, fast edge 25, tempo follow 0.5.
6. Span gate: multi-matra on, global max span 3.
7. Cooldown: basis pulses, value 1.5.
8. Play.

Result: the long cells — the `[5]` whole-span pattern and the trailing 3
of `[2,3]` — become rapid repeated hits. The one-matra cells never
ratchet.

Timeline: amber duration bars appear on the ratchet rail, with internal
ticks at the rendered hit intervals.

Variation: in the deep drawer set the time-curve preset weights to
even 1 and accelerando 3, then to retardando 3, and compare the tick
spacing on the rail.

## 23.6 Ornaments

Continue from 23.5.

1. Open **Rhythm** → Ornaments. Power on.
2. Grace notes: probability 20%; count weights single 3, double 1,
   triple 0; placement before beat 70% / on beat 30%; duration 25 ms;
   cooldown 2 pulses; section-start modifier +10%.
3. Delay: probability 15%; basis % of beat; min 5, max 25; sampling
   unquantized, uniform.
4. Play.

Result: occasional short attacks land before the principal note, more
often at section starts. Some onsets shift slightly later; the note-off
does not move, so those notes are shorter.

Timeline: rose diamonds and cool blue brackets appear on the ratchet
rail. A tied group receives at most one ornament for the whole group.

## 23.7 Pitch inside a collection

Continue from 23.6.

1. Open **Pitch** → Pitch Map. Range C3 to C5.
2. Choose a limited-transposition collection. The staff fills with its
   pitch set as editable noteheads.
3. Transitions: order first; give every transition weight 1 to start, or
   apply the **To tonic** recipe.
4. Boundary policy = nearest; modulo interval 12.
5. Playback tab: ratchet pitch mode = source; ornament pitch mode = per
   grace; transpose enabled, mode stair-step, value +5, probability 12%.
6. Enable the pitch shaper. Play.

Result: the line stays inside the collection. Occasionally the
stair-step transposition shifts it up five semitones, so the pitch center
walks over several cycles. Ratchet bursts stay on one pitch; grace notes
sometimes take a different pitch.

Timeline: the pitch lane shows the resolved pitches as violet marks at
their pitch heights.

Check: with `nearest`, a transposition that leaves the range snaps back
to the nearest in-range pitch. With `wrap` it wraps by the modulo
interval; with `reflect` it mirrors.

## 23.8 Channel hocketing with an accent override

1. Open **Channel**. Hocket on. Assignment = Markov. Enable channels
   1, 2, 3, 4. Axis 4.
2. Open Built-in Synth Properties and give channels 1–4 four distinct
   melodic programs.
3. Matrix, first order: `1→2` 3, `1→3` 1, `2→1` 2, `2→3` 2, `3→1` 1,
   `3→2` 3.
4. Entry & Fallback: static fallback channel 1.
5. Accents tab: add a rule for velocity 110–127 with channel 4 weight 3,
   mode = Render only.
6. Play.

Result: notes alternate across three voices in a pattern derived from
the matrix. Loud accented notes are routed to channel 4 without changing
the chain state, so the three-voice pattern continues underneath.

Timeline: the channel lane shows each note's final channel number and
color.

Variation: switch the accent rule to Drive chain. Channel 4 becomes a
real state and the distribution changes substantially.

## 23.9 A Euclidean channel weave

1. Open **Channel**. Hocket on. Assignment = Euclidean.
2. Pattern tab: Placement = Partition, Steps = 16.
3. Layer 1: channel 1, pulses 5, rotate 0, max run 1.
4. Layer 2: channel 2, pulses 3, rotate 2, max run 1.
5. Layer 3: channel 3, pulses 4, rotate 0, max run 2.
6. Fallback channel 4. Reset = every cycle.
7. Span accents = Pinned to channel, anchor channel 1.
8. Play.

Result: a fixed, repeating distribution of notes across four channels.
Accent-span starts always sound on channel 1 and are removed from the
pattern stream, so the interior weave is unaffected by them.

Readouts: each layer shows its resolved mask, its inter-onset interval
vector, and where applicable a Euclidean string badge. The numbered
strip shows the resolved channel per step with fallback slots dimmed.

## 23.10 Automation across a long form

1. Open the Automation panel for the active track. Set automation length
   to 16 cycles.
2. Add `sequencer.pitch`. Drag the end point from 60 to 72.
3. Add `sequencer.sectionCount.3.weight`. Set points: `0/1` = 0,
   `1/3` = 4, `2/3` = 2, `1/1` = 0.
4. Add global markers at 50% and 75%.
5. Save the patch. Play.

Result: over 16 cycles the base pitch rises an octave, and the
probability of three sections per cycle rises in the middle of the form
and falls toward the end.

Check: stop, change the automation length from 16 to 32. Point times are
stored as exact rationals, so the shape is unchanged and the arc takes
twice as long.

## 23.11 A Shape Group that thins a phrase

1. Open **Shape Groups**. Add a group.
2. Domain = rhythmCell. Stage = articulation.
3. Selection: `and( everyNthOnset { n: 3, offset: 0, countRests: false },
   not( sectionStarts ) )`.
4. Chance = 100.
5. Operation: `restProbability { percent: 60 }`.
6. Play.

Result: every third note start outside a section start is silenced 60%
of the time. Section starts are untouched.

Timeline: the affected cells are drawn as hollow rested cells in the
stopped preview as well as during playback, because articulation-stage
groups run inside the shared overlay pass.

Add a second group below the first with `forcePlay` on `firstBeat` to
guarantee the downbeat always sounds; later groups see earlier rewrites.

---

# APPENDIX A — ALLOWED VALUES

## A.1 Gati and jathi

| Value | Name | Available as gati | Available as jathi |
|---|---|---|---|
| 3 | tisra | yes | yes |
| 4 | chatusra | yes | yes |
| 5 | khanda | yes | yes |
| 6 | — | yes | yes |
| 7 | misra | yes | yes |
| 9 | sankirna | yes | yes |
| 11 | — | yes | yes |

## A.2 Jathi validity, worked

Section total matras = beats in section × gati.

| Section | Total | Valid jathi values |
|---|---|---|
| 3 beats, gati 4 | 12 | 3, 6 |
| 4 beats, gati 4 | 16 | none — 4 duplicates the beat starts, 8 is not an allowed value, nothing else divides 16 |
| 3 beats, gati 5 | 15 | 3 only — 5 duplicates the beat starts |
| 4 beats, gati 5 | 20 | 4 only — 5 duplicates, 10 is not an allowed value |
| 4 beats, gati 7 | 28 | 4 only — 7 duplicates, 14 is not an allowed value |
| 5 beats, gati 4 | 20 | 5 |

## A.3 Rhythm span lengths

Matrices exist for span lengths 3, 4, 5, 6, 7, 9, 11.

Pattern enumeration is bounded, and the number of selected states per
matrix is bounded, so very long spans present a workable state set rather
than every composition.

## A.4 Delay tuplet grids

3, 4, 5, 6, 7, 9, 11.

---

# APPENDIX B — DEFAULT VALUES

A new patch starts from neutral values, so nothing sounds until the user
authors it. Where the model has a richer suggested default, it is listed
in the third column.

| Value | New patch | Suggested default in the model |
|---|---|---|
| Beats/cycle | 4 | — |
| Tempo | 80 BPM | — |
| Pitch | 60 | — |
| Velocity | 96 | — |
| Initial gati weights | gati 4 = 1 | 4 = 2, 3 = 1, 5 = 1 |
| Boundary gati weights | — | 3 = 1, 4 = 1, 5 = 1, 7 = 0.6 |
| Jathi weights | all 0 | all 1 |
| Max-section ladder | one section | 0 = 1, 1 = 2, 2 = 3, 3 = 1 |
| Custom equal-parts count weights | — | 5 = 1, 8 = 1 |
| Custom equal-parts gati weights | — | 5 = 1, 7 = 1 |
| Gati accent range | 0 / 0 | — |
| Section accent range | 0 / 0 | — |
| Jathi accent range | 0 / 0 | — |
| Jathi mode | Override gati | — |
| Single-parameter modulation | off | — |
| Hocket channels | — | 1, 2, 3, 4 |
| Static output channel | 1 | — |
| Channel accent rules | both disabled | Beat accents 104–116 → channel 2, render only; Strong accents 117–127 → channel 4, drive chain |
| Arbitrary subdivision probability | 0% | targets: 7 = 1, others 0; clumps: 1 = 1, others 0 |
| Ratchet power | off | — |
| Ratchet band slow / fast edge | 9 / 25 hits per second at 120 BPM | — |
| Ratchet tempo follow | 0.5 | — |
| Ratchet band rails | 18–200 ms, saturation ±3× | — |
| Ratchet length bias | −0.5 | — |
| Ratchet in-span start / mid / end | 1 / 1 / 1 | — |
| Ratchet edge weights | 1 each | — |
| Ratchet normalize | on | — |
| Rate window: audible hits per second | 12–22 | — |
| Rate window: hits per beat | 8–14 | — |
| Rate window: hits per matra | 2–3 | — |
| Ratchet max span | 4 matras | — |
| Ratchet internal-rhythm hit gate | 3–11 | — |
| Ratchet velocity | relative, −24 to 16, center 0, attraction 0.65, same 0 | — |
| Ratchet slow-note modifier | off, threshold 2 matras, ×1.5 | — |
| Ratchet fast-note modifier | off, threshold 20% of beat, ×0.6 | — |
| Ratchet curve preset weights | all 0 | — |
| Ratchet time curve | flat, five points at 0.5 | — |
| Ratchet cooldown maxima | pulses 16, ms 2000, beat multiple 4, % of beat 400 | — |
| Ornament velocity | relative, −18 to 4, center −8, attraction 0.55 | — |
| Grace duration maxima | 250 ms, or 50% of beat | — |
| Cycle Flux | off, 78–84 BPM, curve 0.72 / 0.58 / 0.38 / 0.58 / 0.72 | — |
| Pitch range | 48–71 (C3–B4) | — |
| Pitch boundary policy | nearest, modulo 12 | — |
| Grace pitch pool | pitch 60, weight 1 | — |
| Grace transpose intervals | 1, 2, 7 at weight 1 | — |
| Autosave | on, 3 s interval | — |
| MIDI debug depth | 250 rows | — |
| Automation debug depth | 100 rows | — |
| Automation length | 1 cycle | — |
| Channel Logic default | Priority | — |
| Monitor synth voices | melodic, program 0 | programs 0, 12, 104, 77, 62, 89, 116, 115, 4, 0, 45, 48, 52, 73, 80, 88 on channels 1–16 |

---

# APPENDIX C — COLORS AND MARKS

```
Gati lane
  neutral dim         ordinary matra
  gold                beat-start accent cell
  orange              section-start extra accent cell
  green tint          active beat or section during playback

Jathi lane
  amber block         regular jathi pulse span
  irregular blocks    Jathi Bhedam cells

Rhythm lane
  dusty cyan          partition of a gati beat span
  amber               partition of a jathi pulse span
  red                 fallback hit or inert weighted pool
  hollow              rested cell
  tie tick            joined tied cells

Ratchet / ornament rail
  amber rounded bar   ratchet duration, with per-hit ticks
  rose diamond        grace note
  cool blue bracket   onset delay

Pitch lane
  muted violet mark   final pitch, positioned by pitch height

Channel lane
  stable color        one color per user-facing channel, everywhere
  subtle edge / glow  fallback or accent-routed assignment
  pointed silhouette  ratcheted channel event
  ghosted             suppressed by Channel Logic

Matrix heat maps (Rhythm, Pitch, Channel)
  blue / teal / green    low weight
  yellow / orange / red  high weight
  recessed charcoal      empty cell

Panel header chips
  accent tone   an enabled feature
  red tone      needs attention
  neutral tone  a value readout
```

Header chips are exceptions, not a status mirror. A default state
produces no chips.

---

# APPENDIX D — KEYBOARD AND POINTER

| Action | Input |
|---|---|
| New patch | cmd-N |
| Save patch | cmd-S |
| Save patch as | cmd-shift-S |
| Recall patch | cmd-O |
| MIDI panic (silence, keep playing) | cmd-. |
| Play / stop | Spacebar, when the timeline has focus |
| Close the open main editor | Escape |
| Open the automation lane for a control | cmd-click or control-click that control |
| Show the automation lanes for a group | The automation symbol beside the subsection label |
| Nudge a ratchet strip handle | Arrow keys |
| Larger step on a strip handle | Shift + arrow keys |
| Add a boundary | Click the boundary rail |
| Change a boundary's chance | Drag its marker vertically |
| Move a boundary | Drag its marker horizontally |
| Add a track to a Track Flow box | Drag the track tab onto the box |

---

# APPENDIX E — GLOSSARY

**Accent span.** The interval between two protected accent boundaries.
Jathi pulse spans when a jathi resolved; otherwise gati beat spans.

**Akshara.** A beat-like unit. The interface says "beat".

**Anuloma.** A faster speed relationship: ×2, ×3, ×4.

**Arbitrary subdivision.** A rhythm pass that reinterprets one protected
accent span at a different virtual matra count.

**Beat lock.** A pinned rhythm for one beat or a beat range, overlaid on
the resolved Markov rhythm.

**Boundary.** A position after a beat at which a new section may start.

**Channel hocketing.** Per-note assignment of the output MIDI channel.

**Channel Logic.** The collision resolver for parallel playback.

**Cycle.** One loop of the sequencer.

**Cycle Flux.** A playback-only BPM profile across one cycle that
preserves total cycle duration.

**Exact tiling.** The requirement that children cover their parent
exactly: no gap, no overlap, containment, and conservation of length,
with rational-exact boundaries.

**Fallback.** The state used when a Markov chain has context but no
positive outgoing transition. Distinct from the entry selector.

**Gati.** The number of matras per beat.

**Inflection.** The internal term for a possible boundary. The interface
says "boundary after beat N".

**Jathi.** A regular accent pulse measured in matras, which must tile the
resolved section and must not duplicate the gati beat-start pulse.

**Jathi Bhedam.** An irregular accent phrase that evolves over cycles by
weighted operators.

**Markov matrix.** Transition weights between rhythm patterns, pitches,
or channels, for one span length or state set.

**Matra.** One subdivision of a beat.

**Mukthay policy.** How an evolved bhedam sequence that misses the
section total is resolved: pad to sam or truncate to sam.

**Note group.** One audible note produced by the rhythm layer.

**Ornament.** A playback articulation of a resolved note group. Grace
notes and onset delay are the implemented types.

**Patch.** A `.caesura` file recording the complete working surface.

**Pratiloma.** A slower speed relationship: ×1/2 through ×1/7.

**Protected cut.** A required internal cut inside a rhythm span, which
chosen patterns and virtual subdivisions must preserve.

**Pulse span.** A resolved span representing a section, a gati beat, or a
jathi pulse.

**Ratchet.** A playback transform that subdivides one audible note group
into repeated hits.

**Ratchet band.** The tempo-elastic window that bounds every rapid
inter-onset interval in a ratchet.

**Realization.** A concrete result sampled from probabilistic settings
for a specific cycle and seed.

**Rhythm pattern.** An ordered list of positive matra lengths that
exactly fills an accent span.

**Sam.** The start of the cycle. A sequence "resolves on sam" when its
lengths sum exactly to the span it must fill.

**Section.** A contiguous run of beats sharing one resolved gati.

**Seed path.** A recorded list of the seeds actually used, per cycle and
per domain, replayable with optional wildcards.

**Shape Group.** A selection of spans plus an ordered list of operations
applied to them.

**Tala.** A fixed cyclic rhythmic structure. The Beats/cycle control is
the equivalent here.

**Tiling tree.** The nested hierarchy of spans for one realized cycle, in
which every layer exactly tiles its parent.

---

# APPENDIX F — TROUBLESHOOTING

| Symptom | First step |
|---|---|
| The timeline shows one gati and the audio sounds like another | Playback → Reset Timeline Sync. If it persists, report it: the preview and playback read the same evaluator, so a difference is a defect. |
| The channel marker says one channel and the monitor plays another sound | Check the MIDI debug row's monitor voice route. External CoreMIDI bytes carry the marker's channel regardless. |
| No MIDI arrives in the host | Confirm the virtual port is enabled in the host's MIDI preferences. |
| The virtual port does not appear at all | Open Audio MIDI Setup → Window → Show MIDI Studio and confirm no stale port is held by an old process. Restart the program. Log out and in to reset CoreMIDI state if it persists. |
| Nothing sounds at all | A new patch is neutral. Check that at least one gati weight is positive, and that either the synth monitor is on or a host is listening. |
| A boundary never fires | Check the max-section ladder. A cap of 1 prevents every boundary. Check that boundaries earlier in the cycle are not consuming the cap. |
| No jathi ever resolves | At least one weighted jathi value must tile the resolved section without duplicating beat starts. Invalid values are dimmed. |
| The ratchet rail stays empty | Confirm ratchet power is on and Amount is above 0. Check the modifiers, which can multiply the running chance to near zero. Check the cooldown window. Check the span gate: with multi-matra off, only one-matra notes qualify. |
| Pitch shaping has no effect | Confirm the shaper is enabled and at least one pitch state has a positive weight. Confirm the boundary policy is not snapping every transition back to the source pitch. The pitch lane is playback-only, so check it during transport. |
| Channel numbers look off by one | The lane shows the user-facing channel 1–16, not the zero-based MIDI status nibble. |
| An automation lane exists but nothing changes | The target may be registered but not yet applied by the engine. See §9.7. |
| Play is blocked | Two Channel Logic rules assign different operators to the same track pair and channel. The transport warning names the conflict. |
| Play will not start after an edit | Automation edits clear the preview first. Wait for the visible cycle to refresh, then press Play. |
| Notes hang | Setup → MIDI → All notes off. |
| A loaded patch is missing a setting | The patch may pre-date the field. Missing fields fall back to defaults; check the relevant panel. |
| Performance is poor | Hide the MIDI debug log, disable the built-in synth and use an external host, reduce automation lane and point count, or raise the tempo. |

---

*End of manual.*

If the timeline and the audio disagree, or if this manual and the program
disagree, report it. Both are cases of the same contract: the timeline
displays the data that playback uses.
