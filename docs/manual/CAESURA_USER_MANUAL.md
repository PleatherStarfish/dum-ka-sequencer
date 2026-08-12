# Caesura User Manual

A Carnatic-inspired probabilistic MIDI sequencer for macOS.

---

## How To Read This Manual

Caesura is dense. It exposes ideas — gati, jathi, protected accent spans,
Markov rhythm grouping, seeded probability, ratchet, pitch and channel
shaping — that ordinary step sequencers hide or simply do not have. To make
that surface manageable, this manual is layered.

- **Part I — Foundations** explains the project's motivation and the musical
  model in one place. Read it once. It is the spine that the rest of the
  manual hangs off.
- **Part II — Getting Started** walks through installation, first launch,
  and producing your first sounding cycle. If you are impatient, jump here.
- **Part III through Part XII** are reference chapters for every editing
  surface: score controls, the resolved timeline, automation, Rhythm Shaper,
  ratchet, ornaments, Cycle Flux, Pitch Shaper, Channel Shaper, the built-in
  synth, and patch persistence.
- **Part XIII — Theory Background** offers a short Carnatic primer for users
  who have not yet absorbed gati/jathi/tala in practice.
- **Appendices** collect glossary entries, troubleshooting, keyboard
  shortcuts, the color and lane reference, and the editable value inventory
  you can use as a checklist.

Throughout, diagrams are rendered as ASCII boxes and line art. They are
intentionally schematic. The point is to make geometry, hierarchy, and lane
alignment readable on paper, in a terminal, or in a Markdown viewer.

The most important sentence in this manual is the project's core promise:

> What is visible in the timeline is what playback is using.

If you ever see the timeline say one thing and hear another, treat it as a
bug. The whole architecture is built so that those two things cannot drift
apart silently.

---

# Part I — Foundations

## 1. What Caesura Is

Caesura is a desktop MIDI sequencer. It runs natively on macOS, hosts a
small built-in monitor synth, and opens a virtual CoreMIDI port that any
other audio application can receive — Ableton Live, Logic, Max/MSP, Bitwig,
hardware synths through a MIDI interface, or a MIDI monitor.

Functionally it is several things at once:

- **A rhythm-tree compiler.** Each cycle is built as a tree of timing
  spans — beats inside cycle, matras inside beats, jathi pulses across
  matras, Markov groupings inside protected accent spans, ornament and
  ratchet hits over note groups. The tree is rebuilt every cycle and the
  scheduler reads from it.
- **A Carnatic-inspired gati and accent exploration tool.** Gati genuinely
  means the subdivision of the beat. Jathi genuinely means a regular accent
  pulse that must tile a resolved section. Sections are spans of beats.
  Nothing in the surface is a relabel of a generic 16-step grid.
- **A probabilistic realization engine with explicit seed control.** Almost
  every choice — gati per section, jathi tiling, section boundary firing,
  Markov rhythm grouping, ratchet hits, ornament onsets, pitch transitions,
  channel routing — is a weighted random draw. The drawing is seeded so
  that runs are repeatable, and the seed strategy is itself a first-class
  control with a dedicated dialog.
- **A live playback surface where the timeline is the primary editor.** The
  resolved timeline sits directly under the transport and is always
  visible. Almost everything you can edit either is a timeline gesture, or
  is reflected in the timeline as soon as you commit it.
- **A bridge between structured rhythmic thinking and conventional
  software.** Caesura's output is MIDI. It does not try to be a DAW. It
  tries to send MIDI good enough that any DAW will treat it as a
  first-class source.

## 2. What Caesura Is Not

It is worth being explicit, because the project has refused several
familiar shapes:

- It is **not a piano-roll sequencer.** There is no horizontal staff onto
  which you draw notes. Pitches come from base pitch plus pitch shaping;
  rhythm comes from gati and shaping passes.
- It is **not a generic fixed-grid step sequencer.** Steps inside one beat
  can be 3 or 4 or 5 or 7 or 9 — gati is per-section, not per-cycle.
- It is **not a DAW.** No audio recording, no mixer routing inside the
  app, no audio effects. Plenty of DAWs do that better than a small native
  app could.
- It is **not a complete Carnatic notation system.** A real Carnatic score
  carries melodic content, sahitya, ornamentation, korvai, and pedagogical
  context that Caesura intentionally does not represent.
- It is **not a tabla or mridangam sample instrument.** The built-in synth
  is a monitor for testing; serious sound comes from another instrument
  receiving Caesura's MIDI.
- It is **not a groovebox with Indian labels pasted on.** The Carnatic
  terms in the UI carry their Carnatic meaning, and the engine respects
  the rules behind them.

## 3. The Musical Problem

Step sequencers flatten time. A 16-step grid is a strong tool for many
patterns, but it cannot easily express:

- One section in chatusra (4 matras per beat), the next in misra (7
  matras per beat), the next back in chatusra.
- An accent pulse of 5 matras crossing a 4-matras-per-beat grid, then
  retiling cleanly when the cycle resolves.
- A protected accent boundary that rhythm grouping must respect — no held
  group may cross it without an explicit policy.
- Probability built into the structure itself: "fire a section boundary
  after beat 4 with 35% chance; if it fires, choose gati 5 or gati 7
  with weights 3:2."
- Rapid ratchet hits inside a single audible note group, gated by
  position in the cycle and respecting accent spans.
- A different stochastic realization every cycle, but reproducible if you
  later want to capture the variation that worked.

Caesura's musical model is built around those needs. Once you see how the
pieces fit, the larger control surface — automation, Markov rhythm, pitch
shaping, channel hocketing — is less a pile of features than a sequence of
layered passes that each rewrite the already-realized cycle in a contained
way.

## 4. The Musical Model In One Page

```
                  +-------------------------------+
                  |              Cycle             |
                  |                                |
                  |  Beat 1  Beat 2  Beat 3 ...    |
                  +---|--------|--------|----------+
                      |        |        |
                      v        v        v
                 +-------+ +-------+ +-------+
                 | matra | | matra | | matra |   <- gati subdivides each beat
                 | matra | | matra | | matra |
                 | matra | | matra | | matra |
                 +-------+ +-------+ +-------+

      Sections are ranges of beats. A boundary AFTER beat N means beat N+1
      may begin a new section. Each section carries one gati.

      Jathi is a regular accent pulse measured in matras. A jathi must
      tile the resolved section exactly. Jathi pulses become protected
      accent spans which rhythm and ratchet may not cross casually.
```

A Caesura score is one repeating cycle. Inside that cycle:

- A **cycle** contains **beats**.
- Each beat is subdivided into **matras** by its active **gati**.
- **Sections** are spans of beats. Each section chooses one gati that
  applies to every beat in that section.
- **Boundaries** sit between beats. Each boundary has a fire probability
  and weighted gati/jathi choices. If a boundary fires, the next beat
  starts a new section.
- A section may also choose a **jathi** — a regular accent pulse — when
  that pulse tiles the section's matras cleanly and isn't merely a
  duplicate of the gati beat-start pulses.
- **Protected accent spans** are the active pulse spans inside a section.
  When jathi tiles the section, the jathi pulse spans are protected. When
  it does not, the gati beat spans are protected.
- **Markov rhythm grouping** chooses how each protected span is internally
  partitioned. The choice is a pattern (an ordered list of positive matra
  lengths) that exactly fills the span — `[4]`, `[1, 3]`, `[2, 1, 1]`.
- **Arbitrary subdivision** can virtually reinterpret a protected span at
  a different matra count before grouping.
- **Articulation** can convert chosen rhythm cells into rests or ties.
- **Ratchet** rapidly subdivides single audible note groups during
  playback. It is a playback pass; the underlying rhythm tree is untouched.
- **Ornaments** — grace notes and onset delay — attach to resolved note
  groups during playback.
- **Pitch shaping** rewrites final note pitches after rhythm and playback
  passes.
- **Channel hocketing** rewrites final MIDI channels after pitch.
- **Cycle Flux** is a playback timing warp across the cycle. It does not
  change rhythmic structure, only how time stretches inside the fixed
  cycle endpoints.

If a four-beat section resolves to gati 7, every one of the four beats
receives seven matras. The section has 28 matras. A jathi 4 over that
section is invalid — every jathi pulse would land only on gati beat-starts.
A jathi 7 is valid — `28 % 7 = 0` and the pulses don't duplicate gati
starts.

## 5. The Layered Realization Pass

Each cycle is realized through a sequence of passes. Holding this picture
makes the rest of the manual easier:

```
            +-------------------------------------------+
            |   1. Score request (cycle, base values,   |
            |      boundaries, weights, automation)     |
            +----------------------+--------------------+
                                   |
                                   v
            +-------------------------------------------+
            |   2. Subdivision Switch transform:        |
            |      - sample automation at cycle/beats   |
            |      - roll max-section cap               |
            |      - roll boundaries left to right      |
            |      - resolve gati per section           |
            |      - resolve jathi per section          |
            |      - emit section/gati/jathi spans      |
            |      - apply gati speed / jathi timing    |
            |      - apply velocity accents             |
            +----------------------+--------------------+
                                   |
                                   v
            +-------------------------------------------+
            |   3. Rhythm pass:                         |
            |      - arbitrary subdivision overlay      |
            |      - Markov grouping inside protected   |
            |        accent spans                       |
            |      - rest/tie articulation              |
            +----------------------+--------------------+
                                   |
                                   v
            +-------------------------------------------+
            |   4. Realize note-on / note-off events    |
            |      (deterministic, rational offsets)    |
            +----------------------+--------------------+
                                   |
                                   v
            +-------------------------------------------+
            |   5. Ratchet pass on this cycle's queue   |
            +----------------------+--------------------+
                                   |
                                   v
            +-------------------------------------------+
            |   6. Ornament pass (grace + delay)        |
            +----------------------+--------------------+
                                   |
                                   v
            +-------------------------------------------+
            |   7. Pitch shaper rewrite                 |
            +----------------------+--------------------+
                                   |
                                   v
            +-------------------------------------------+
            |   8. Channel hocket rewrite               |
            +----------------------+--------------------+
                                   |
                                   v
            +-------------------------------------------+
            |   9. Cycle Flux tempo warp                |
            +----------------------+--------------------+
                                   |
                                   v
            +-------------------------------------------+
            |   10. Append cycle events to scheduler    |
            |       Dispatch to CoreMIDI + monitor      |
            +-------------------------------------------+
```

This pipeline runs once per cycle. The crucial property: each pass only
ever rewrites the cycle currently being realized. Future cycles already in
the scheduler queue are never re-ratcheted or re-hocketed. That guarantee
is what makes timeline colors and ratchet marks reliable — they describe
the same notes that will actually sound.

## 6. North-Star User Experience

Caesura tries to feel like a small, calm, precise instrument. The guiding
priorities, in order:

1. **Musical correctness.** Gati must mean beat subdivision. Boundaries
   must sit after beats. Jathi must tile. Rhythm and ratchet must respect
   protected spans.
2. **Timeline trust.** Preview and playback must be generated from the
   same request data. If the timeline says gati 7 but you hear gati 4,
   that is a bug to file.
3. **Deterministic stochasticity.** Locked seeds repeat exactly.
   Per-cycle seeds vary reproducibly. History mode makes "the variation
   that worked" reusable instead of mysterious.
4. **High-leverage complexity.** Advanced probability, Markov, ratchet,
   and shaper controls are exposed when they unlock musical behavior, but
   they are required to explain themselves visually — chips, percentages,
   heatmaps, contour graphs.
5. **One excellent instrument first.** A strong single-channel
   probabilistic rhythm tool is more valuable than a broad multi-channel
   surface with weak semantics.

You should be able to glance at Caesura and answer:

- How many beats are in the cycle?
- Where can a section boundary happen, and how likely is each?
- What gati and jathi were chosen this cycle?
- What rhythm groups are active inside the current protected spans?
- Did a ratchet just fire, and at what density?
- Is the playback you hear matching the request the timeline shows?

If any of those questions takes more than a second to answer from the
screen, the UI is failing its job.

---

# Part II — Getting Started

## 7. Installation

Caesura is distributed as a macOS app bundle. There is no installer; drop
`Caesura.app` into `/Applications` or launch it from `~/Downloads`. The
first launch may require approving the app in **System Settings → Privacy
& Security** if you downloaded it from outside the Mac App Store.

On launch the app will:

- Open a CoreMIDI virtual output port named after the app.
- Start an internal scheduler thread.
- Try to bring up the built-in DLS monitor synth.
- Restore the most recent patch, if one is remembered.

If the previous session ended uncleanly, the app may prompt to restore
from autosave recovery instead. That is described in §44.

## 8. Anatomy Of The Main Window

```
+---------------------------------------------------------------+
| Caesura  | Play  Stop  Synth   Properties   Tempo: 92.00 BPM |  <- transport
|          | Auto: 1 cyc   Save  Recall                         |
|          | Rhythm  Pitch  Channel   Beats/cycle: 8            |
+---------------------------------------------------------------+
| BOUNDARY PROBABILITY RAIL                                     |  <- quiet rail
|  | . . . . | . . . . | . . . . | . . . . | . . . . | . .     |
+---------------------------------------------------------------+
| RESOLVED TIMELINE                                             |
|   Sect 1, gati 4         |   Sect 2, gati 7      | Sect 3 ... |
|   B1   B2   B3   B4      |   B5   B6  ...        |            |
|   . . . . . . . . . .    |   .  .  .  .  .  .  . | ...        |
|   Jathi pulses overlay                                        |
|   Rhythm groups overlay                                       |
|   Ratchet + Ornament rail                                     |
|   Pitch lane                                                  |
|   Channel lane                                                |
+---------------------------------------------------------------+
| Cycle Setup            (collapsed)                            |
| Sections and Subdivisions                                     |
|   Probability and accents bar                                 |
| Rhythm Shaper          (collapsed)                            |
| Pitch Shaper           (collapsed)                            |
| Channel Shaper         (collapsed)                            |
| Built-in Synth         (collapsed)                            |
| MIDI Debug             (collapsed)                            |
| Automation Debug       (collapsed)                            |
+---------------------------------------------------------------+
```

From top to bottom:

- **Transport bar.** Play/Stop, synth on/off, synth properties, tempo,
  automation length and overview button, save/recall, and feature
  switches for the three "shapers" (Rhythm, Pitch, Channel) plus cycle
  length and base cycle values.
- **Boundary probability rail.** A quiet horizontal strip directly above
  the resolved timeline. It is the primary editor for boundary topology
  and per-boundary chance. Each marker is positioned at an after-beat
  position; vertical position encodes probability. Marker chips expose
  compact `edit` and `del` actions.
- **Resolved timeline.** The truth display. Beats, gati matras, jathi
  pulses, rhythm groups, ratchet marks, ornaments, pitch choices, and
  channel assignments all align on the same horizontal coordinate frame.
- **Collapsible editor panels** for Cycle setup, Sections and Subdivisions
  (including the Probability and accents bar), Rhythm Shaper, Pitch Shaper,
  Channel Shaper, built-in synth properties, MIDI debug, and automation playback
  debug.

Lower-frequency surfaces — **Audio & MIDI Setup** and **Seed Strategy** —
live in modal dialogs reachable from the macOS menu bar (Setup menu).
File, View, and Playback menus give keyboard-shortcut access to common
project actions.

## 9. Your First Cycle

A complete walkthrough that produces a sounding cycle in roughly two
minutes.

1. **Open the app.** A default empty patch loads.
2. **Set cycle length.** Open the **Cycle Setup** panel. Set Beats/cycle
   to `8`. This is a familiar adi tala-ish length and gives you room to
   place a boundary.
3. **Set base pitch and velocity.** In the same panel, set Pitch to `60`
   (middle C) and Velocity to `96`.
4. **Set initial weights.** Open **Sections and Subdivisions**. Select
   the initial section, then under **Gati choices** give gati 4 a weight
   of `3` and gati 5 a weight of `1`. Leave others at `0`. The first
   section will land on gati 4 most of the time.
5. **Add a boundary.** Click the boundary rail at the position after
   beat 4. A boundary marker appears. Click its `edit` action. Set its
   chance to `60%`. Under its gati weights, set gati 7 to `2` and gati 4
   to `1`. Leave jathi weights empty — Caesura will skip jathi if no
   valid choice is available.
6. **Enable the built-in synth.** Toggle **Synth** in the transport.
7. **Press Play.** The timeline begins animating. The active beat is
   tinted green. You should hear MIDI notes routed through the local
   monitor.
8. **Watch the structure resolve.** Each cycle, the boundary may or may
   not fire. When it fires, beat 5 starts a new section in gati 7 (most
   likely) and you hear seven matras per beat there. When it does not
   fire, beat 5 stays in the same section as beats 1-4.
9. **Stop. Save.** Press Stop. From the **File** menu, choose
   **Save Patch As...** and pick a path. The file extension is
   `.caesura` (and internally `.caesura-patch.json`).

You have just authored a probabilistic two-section cycle with
deterministic playback semantics. Everything else in this manual builds
on that loop.

## 10. The Seed Strategy In Thirty Seconds

Stochastic does not mean uncontrolled. Open **Setup → Seed Strategy**.
The Overview tab shows a small hierarchy diagram:

```
                +-------------------+
                |   Global score    |
                +---------+---------+
                          |
       +------------------+------------------+
       |                  |                  |
       v                  v                  v
+-----------+      +-----------+      +-----------+
|  Rhythm   |      |   Pitch   |      |  Channel  |
|  Shaper   |      |  Shaper   |      |  Shaper   |
+-----------+      +-----------+      +-----------+
       (each "inherits" or "local" with separate base seeds)

                 +---------------+    +--------------+
                 |   Ratchet     |    |   Ornaments  |
                 +---------------+    +--------------+
                 (independent base playback seeds)
```

The global score seed drives boundary firing, gati choice, jathi choice,
and accent jitter. The shapers can inherit that strategy (so a locked
global seed locks rhythm too) or run their own. Ratchet and ornaments use
independent playback seeds because they realize during MIDI dispatch and
make sense as separately controllable.

Three modes:

- **Locked** — same seed every cycle. Same result every cycle.
- **Per-cycle** — derive a new seed each cycle from the base. Variation
  is reproducible across runs.
- **History or new** — choose a remembered seed from a small history
  pool, or generate a new seed and remember it. Lets good variations
  recur without freezing them.

We come back to seed paths and replay in §22.

---

# Part III — The Cycle Surface

This part is the reference for the simplest editing surface: the cycle,
base MIDI values, initial weights, max-section cap, boundary editing, and
the velocity accent ranges.

## 11. Cycle Setup Panel

```
+--- Cycle Setup -----------------------------------------+
|  Name: [ Untitled                                ]      |
|  Beats/cycle:  [ 8  ]                                   |
|  Pitch:        [ 60 ]   (slider 0-127)                  |
|  Velocity:     [ 96 ]   (slider 1-127)                  |
+---------------------------------------------------------+
```

### Name

Stored only in the patch; not sent over MIDI. Use it to label the patch
in the saved-state pill and recent-patch lists.

### Beats/cycle

The number of primary pulses in the repeating form. Range is intentionally
permissive — short cycles (3-4 beats) feel like talas like rupakam or
khanda chapu; longer cycles (16, 32) can carry small forms.

Changing this value during playback is discouraged: it can invalidate
existing boundary after-beat positions if any boundary now sits past the
cycle's end. The UI normalizes those positions when possible but you
should generally stop transport before reshaping the cycle.

### Pitch

The base MIDI note before pitch shaping, accent overlay, or channel
routing. Drag the slider or type a value. Pitch is an automation target
(`sequencer.pitch`), so you can drive it from the automation lane while
playback runs.

### Velocity

The base MIDI velocity floor. All accent boosts add to this floor and
clamp to MIDI velocity 1-127. Velocity is automatable
(`sequencer.velocity`).

## 12. Initial Weights — The First Section

The first section in any cycle uses the initial section's **Gati choices**
and **Section jathi accent** weights in Sections and Subdivisions. Global
seed behavior, single-parameter modulation, jathi accent mode, and velocity
accent ranges sit in the Probability and accents bar at the top of that
editor.

```
+--- SECTIONS AND SUBDIVISIONS ---------------------------+
|  Probability and accents: seed, jathi mode, velocity     |
|                                                         |
|  Initial section / Gati choices                         |
|    [3]  [4]  [5]  [6]  [7]  [9]  [11]                   |
|    g3   g4   g5   g6   g7   g9   g11                    |
|    25%  50%  25%  ...                                   |
|                                                         |
|  Initial section / Section jathi accent                 |
|    [3]  [4]  [5]  [6]  [7]  [9]  [11]                   |
+---------------------------------------------------------+
```

Each weight box is a **chip**: a numeric value (the weight) and the
implied percentage share alongside. Weights are relative, not literal
percentages. A box showing `0` is visible but cannot be chosen.

Valid gati values exposed in the UI are `3, 4, 5, 6, 7, 9, 11`. Valid
jathi values are the same set, but jathi options that cannot tile the
resolved section are visibly dimmed.

### Why "Initial"

The first section has no prior boundary to inherit from, so its gati and
jathi must be sampled from initial weights instead of from a boundary's
weighted list. Every boundary after that carries its own gati and jathi
weight set.

## 13. The Max-Section Cap

The max-section cap is chosen first, every cycle, before boundary rolls
begin. Its purpose is to limit how many sections may exist:

- A cap of `1` means the entire cycle stays in one section — no boundary
  can fire.
- A cap of `2` allows one boundary to fire.
- A cap of `3` allows two boundaries to fire, in left-to-right order.
- And so on, up to `possible-boundaries + 1`.

The cap is itself probabilistic. Weights for each cap value are edited
on the ladder; if you give caps 2 and 3 weights `2` and `1`, you get
two sections about 67% of the time and three sections about 33%.

### Greedy Boundary Resolution

After the cap is sampled, boundaries are rolled left to right:

```
+----+        +----+        +----+
| B1 |        | B2 |        | B3 |     <-- possible boundaries
+----+        +----+        +----+
  ^             ^             ^
   \             \             \
    roll first    if cap not    if cap not
    boundary      reached        reached
                  yet, roll      yet, roll
                  second         third
```

Once the cap is reached, later boundaries cannot fire even if their dice
would otherwise come up.

## 14. Boundary Editing

Boundaries are the heart of the cycle surface. Each boundary is a
"possible section change after beat N."

### Editing On The Rail

```
boundary probability rail:
  ^
  |       *         *
  |   *       *           *      *
  |________________________________________
   beat 1   2    3   4   5    6    7    8

  * = boundary marker at after-beat position
  vertical position = chance
```

- **Click** on the rail at an after-beat position to add a new
  boundary at that position.
- **Drag** an existing marker vertically to change its chance.
- **Drag horizontally** to a different after-beat position.
- Each marker has compact `edit` and `del` actions revealed on hover.
- The rail shares the timeline's horizontal coordinate frame, so a
  marker always sits exactly above the after-beat line below it.

### Sections And Subdivisions Inspector

The Sections and Subdivisions panel is a cycle map plus a focused
inspector. The map lists Section 1 and every possible boundary with
compact chips for chance, subdivision, jathi, and Jathi Bhedam state.
The map also owns Max sections per cycle, the count ladder that is
chosen before boundary rolls and limits how many live sections may
appear. Raising the direct Max number creates missing boundary slots;
from a one-beat cycle it first expands the cycle enough for those slots
to exist. Pick a row, then use the inspector layers to edit only the
thing you mean to change:

```
+--- Cycle map ----------------+   +--- Inspector --------+
| Section 1                    |   | Boundary              |
| After beat 4   60% g7 j5     |   | Subdivision           |
| After beat 6   25% g4 off    |   | Jathi Accent          |
|                              |   | Jathi Bhedam          |
+------------------------------+   +----------------------+
```

For a boundary, the **Boundary** layer edits after-beat position and
chance. The **Subdivision** layer edits gati choices and optional
equal-parts grid chance. The **Jathi Accent** layer edits regular jathi
weights. The **Jathi Bhedam** layer edits the replacement bhedam
selection. The initial section starts on the Subdivision layer because
it has no boundary chance.

A boundary row always reads as "After beat N." This phrasing matters
because:

- If the boundary fires, beat **N+1** starts a new section.
- The boundary's gati weights choose the gati for that new section.
- That gati subdivides every beat in the new section until another
  boundary fires.
- The boundary's jathi weights choose an accent pulse — but only from
  jathi values that tile the resolved section. Invalid jathi options
  are dimmed.

### Same-Gati Boundaries

A fired boundary always starts a new section, **even when it chooses the
same gati as the previous section**. This is intentional. Sections are
first-class structural events. They can receive an extra section-start
accent, may host different jathi tilings, and may eventually attach
transforms or labels. The visible timeline shows a section divider even
if the gati number is unchanged.

## 15. Single-Parameter Rhythmic Modulation

This is a realization preference, not a structural change. Off by default.

When enabled, the engine still samples requested gati and jathi normally,
but if the request would change both subdivision and perceived accent
spacing at once, it silently resolves to the nearest continuous
modulation path:

1. Preserve the previous active accent span duration (in matras, or in
   speed-adjusted units when gati speed is in play).
2. Otherwise preserve the gati/grid but switch to a different valid
   jathi.
3. Otherwise choose the gati/jathi pair whose accent span duration is
   closest to the previous span's duration in absolute time.
4. Otherwise keep the originally sampled request.

The mode never warns, blocks, or rejects. It only narrows the chosen
realization to candidates already available in the weighted choice
surface. The result is smoother rhythmic drift instead of abrupt
switching. Use it when you want long-form coherence and disable it when
you want bold contrast.

## 16. Velocity Accents

Three velocity accent layers exist, each authored as a center + margin
range:

- **Beat-start accent.** Boost applied to matra 1 of every beat.
- **Section-start extra accent.** Additional boost on matra 1 of beats
  that start sections.
- **Jathi-start accent.** Boost applied to every resolved jathi pulse
  start.

```
+--- Beat-start velocity accent range ---------------+
|   center: [+15]                                    |
|   +/-:    [ 4 ]                                    |
|   actual range written into the model: +11..+19    |
|                                                    |
|   slider rail with highlighted band:               |
|   |--------------- - - +    +    + - - -----------|
|                                  ^                |
|                                  amber band       |
+----------------------------------------------------+
```

Behind the slider, the model stores exact `min` and `max` values
(`sequencer.accent.beatStart.min`, `.max` and the equivalents for
section-start-extra and jathi-start). The center+margin editor is a
friendlier projection over those two model fields. Each accent endpoint
is independently automatable.

### Jathi Accent Mode

When a jathi pulse and a gati beat-start land on the same matra, the
mode decides who wins:

- **Override gati** (default) — jathi accent replaces the gati accent.
  Section-start extra accent still applies on top.
- **Layered** — gati and jathi accents both contribute. The result is
  louder where they collide.

Choose Override Gati when jathi should feel like a primary accent layer;
choose Layered when you want the collision to feel emphasized.

---

# Part IV — Probability And Determinism

## 17. The Seed Strategy Dialog

Open from **Setup → Seed Strategy** in the macOS menu bar, or by clicking
on any inline seed-summary chip in the panels. The dialog is the single
editable surface for seed preferences. Inline summaries elsewhere are
read-only shortcuts.

The dialog has tabs:

- **Overview** — the hierarchy diagram plus seed-path actions.
- **Global** — global score seed mode.
- **Rhythm** — Rhythm Shaper seed mode plus inheritance toggle.
- **Pitch** — Pitch Shaper seed mode plus inheritance toggle.
- **Channel** — Channel Shaper seed mode plus inheritance toggle.
- **Ratchet** — independent base playback seed, starting at 0 in neutral
  patches, and a readout of the random choices it controls.
- **Ornaments** — independent base playback seed, starting at 0 in neutral
  patches, and the random choices it controls.

## 18. Locked Mode

Locked mode uses the same seed every cycle.

```
cycle 1  -> seed S -> realization R1
cycle 2  -> seed S -> realization R1  (identical)
cycle 3  -> seed S -> realization R1
```

Use locked mode when you have captured a variation you like and want it
to repeat exactly. Locked global seed plus locked rhythm seed plus
locked pitch seed produces the most deterministic Caesura.

## 19. Per-Cycle Mode

Per-cycle mode mixes the base seed with the absolute cycle number.

```
cycle 1  -> hash(S, 1) -> realization R1
cycle 2  -> hash(S, 2) -> realization R2
cycle 3  -> hash(S, 3) -> realization R3
```

Use per-cycle when you want continuous variation across cycles but want
the *sequence* of variations to be reproducible. The same controls plus
the same base seed always produce the same R1, R2, R3 sequence in the
same order, on every run, on every machine.

## 19.1 Drift Mode

Drift mode keeps the previous cycle's seed or re-rolls a new one, with an
adjustable percent chance per cycle.

```
cycle 1  -> hash(S, 1) -> realization R1
cycle 2  -> held       -> realization R1  (identical)
cycle 3  -> held       -> realization R1
cycle 4  -> hash(S, 4) -> realization R4  (re-roll landed)
cycle 5  -> held       -> realization R4
```

Use drift for sequencer-like repetition with gradual evolution: an idea
loops for a stretch, then the music moves on to a new idea and loops
that. The chance slider runs from 0% (never move on — same as locked)
to 100% (move on every cycle — same as per-cycle); the default 15%
holds an idea for about 6-7 cycles on average. The whole trajectory is
derived from the base seed and the chance alone, so the same settings
reproduce the same holds and changes on every run. Unlike history mode,
drift remembers nothing — once it moves on, it never returns to an old
seed.

## 19.2 Morph Mode

Morph is drift's crossfading sibling: instead of cutting to a new seed,
new material *bleeds in* while the old material bleeds out.

```
A A A A B A A B A B C A B A C C B A A B A C C B C A B B C B B B C C B
C C C B C C C C C
```

Three controls shape the texture. The **new-layer chance** (the same
knob drift uses) sets how often a fresh seed is born — at the default
15%, about every 7 cycles. The **blend width** (default 16 cycles) sets
how long a newborn seed takes to fully take over; while it fades in,
old and new seeds interleave, and when births arrive faster than fades
complete you hear three-way mixtures like the middle of the pattern
above. The **repeat chance** (default 50%) adds inertia — runs of the
same pick inside the mixture. The moment any newer seed finishes fading
in, everything older is retired for good: morph, like drift, never
returns to dead material. Everything derives from the base seed and the
three controls, so the same settings reproduce the same crossfades on
every run. One subtlety: a finishing fade-in can take over even while
morph is holding — the audible seed steps to its successor and the loop
monitor honestly marks that cycle as a change.

## 20. History Or New Mode

History mode is the most expressive of the five. It maintains a small
history pool of seeds. Each cycle, the engine draws either from history
(re-using a remembered seed) or generates a new seed and adds it to
history. The relative weights between "from history" and "new seed" are
adjustable. So is the maximum history depth.

```
+----- history pool (max 6) -----+
|  S1   S4   S7   S9   S10   S12 |
+--------------------------------+
        ^      ^      ^
        |      |      |
        chance of reuse vs chance of new

new cycle:
   if roll <= historyWeight / total:
      pick one seed from history (weighted uniform)
   else:
      generate fresh seed, append to history,
      drop oldest if full
```

Use history mode for pieces that should revisit prior variations.
Sometimes you'll hear cycle 12 sounding suspiciously like cycle 4 —
that's working as intended; the engine picked S4 again.

## 21. Inheritance — Follow Global

Each shaper (Rhythm, Pitch, Channel) has a **Follow global** toggle. When
on, the shaper's seed mode is whatever the global score seed mode is and
the shaper's local controls are hidden. When off, the shaper runs its
own locked/per-cycle/drift/morph/history settings.

```
global = per-cycle
   rhythm  follow global  -> rhythm uses per-cycle from global seed
   pitch   follow global  -> pitch uses per-cycle from global seed
   channel local locked   -> channel keeps the same pattern every cycle
```

Inheritance is shown in the Overview diagram as `inherits` (the child
hangs off the global node with a labeled connector) or `local` (the
child is its own root with its own base seed).

## 22. Seed Paths — Replay And Wildcards

Seed paths are an advanced tool for recording and replaying seed choices
across domains. They live in the Overview tab.

While playback runs, the engine records a path: for each cycle and each
domain (global, rhythm, channel, ratchet, etc.), it stores the seed
actually used. The result is a list of `PlaybackSeedTraceEvent`
records. Paths are immutable.

You can:

- **Replay** a stored path on the next playthrough. Recorded seeds are
  forced; wildcards resolve normally.
- **Wildcard** a domain or specific cycles inside the path. Wildcarded
  positions sample fresh and are written into a new path during the
  replay.
- **Save** a path as part of the patch.
- **Promote** the most recent path as the basis for further variation.

The transport treats seed paths as playback configuration sent through
`rhythm_set_playback`. Recording the next playthrough always produces a
new path — replay does not mutate the source.

In practice, the most useful workflow is:

1. Improvise with `per-cycle` or `history` mode until you hear a great
   sequence of cycles.
2. Open the seed log, find the path that produced those cycles.
3. Replay that path to lock the rendition.
4. Wildcard a specific domain (say, channel) and replay again to keep
   the rhythmic identity but explore channel routing.

---

# Part V — The Resolved Timeline

The resolved timeline is the truth display. This part covers every lane.

## 23. Geometry And Coordinate Frame

Every lane in the resolved timeline lives in the same horizontal
coordinate frame. The frame measures absolute matra position inside the
cycle (or inside the section, when section labels are drawn). All lanes
share scroll geometry — scrolling the boundary rail scrolls the resolved
timeline; zooming the timeline zooms the rail.

Section containers may draw outlines, but neither outlines, borders, nor
padding alter the track width that musical layers use. Row labels overlay
the track rather than consuming horizontal layout columns; this is
deliberate, because label columns make musical layers visually drift
relative to one another.

```
+-- Section 1 (gati 4) ------- + -- Section 2 (gati 7) --------+
| B1   |  B2   |  B3   |  B4   | B5     |  B6     |  B7    |...|
| .... | .... | .... | ....  | ....... | ....... | .......|...|
|                              |                               |
|  jathi 5 pulses overlay      |  jathi 7 pulses overlay       |
|  rhythm groups overlay       |  rhythm groups overlay        |
|  ratchet + ornament rail     |  ratchet + ornament rail      |
|  pitch lane                  |  pitch lane                   |
|  channel lane                |  channel lane                 |
+------------------------------+-------------------------------+
```

## 24. Beat Ruler And Gati Matras

The topmost lane in the resolved timeline is the beat ruler. Cells are
quiet neutral. The currently active beat during playback is tinted green.

Below it, the gati lane draws one cell per matra. A section in gati 4
shows four equal cells per beat; gati 7 shows seven. Colors:

- **Neutral** — ordinary matra cell.
- **Gold (amber)** — beat-start accent cell (matra 1 of each beat).
- **Orange (warmer amber)** — section-start extra accent cell (matra 1
  of a beat that starts a section).
- **Green tint** — active beat or active section during playback.

When gati speed is in play (see §32), labels show the speed annotation
like `gati 4 x 2` or `gati 5 x 1/2`. The native gati lane still draws
the native matras; the speed annotation describes the timing grid that
jathi validity and Markov rhythm use, not the visible cell count.

## 25. Jathi Pulse Lane

When a section resolves a valid jathi, the jathi lane sits directly under
the gati lane and shows the regular jathi pulse spans as compact amber
blocks. Each block has equal duration; together they tile the section
exactly. Jathi blocks are regular and are never distorted by Markov
grouping — Markov groups subdivide the jathi pulse spans internally
without ever changing the pulse spans themselves.

If no jathi resolves for a section (e.g. its weights have no valid
choice for that section), the jathi lane is empty for that section.

## 26. Rhythm Layer

The rhythm layer draws how each active accent span is internally grouped:

- In a section with resolved jathi, the rhythm row partitions each jathi
  pulse span.
- In a section without jathi, the rhythm row partitions each gati beat
  span.

```
jathi 5 pulse span:        [    span (5 matras)    ]
chosen Markov pattern: [2, 1, 2]
rhythm row:                |======|===|=====|

each '=' is one matra; group widths are proportional to pattern lengths.
```

Color:

- **Dusty cyan** for partitions of gati beat spans.
- **Amber** for partitions of jathi pulse spans.
- **Red** for missing-chain fallback (no Markov chain authored for the
  current span length) or weighted-pool inert states (arbitrary
  subdivision pool with no eligible cells).

Rested cells appear as low-emphasis hollow blocks; tied cells appear as
adjacent groups joined by a tie tick.

Group widths are proportional to the matra group lengths inside the
protected span. Rhythm groups never cross active accent span boundaries
— except when an explicit tie-over-accent policy allows a held note to
carry through.

## 27. Ratchet And Ornament Rail

A single thin rail sits between the rhythm layer and the pitch lane. It
hosts ratchet hits, grace-note ornaments, and delay ornaments together —
combining them in one row preserves vertical density.

Visual conventions:

- **Ratchet** — amber rounded duration bars subdivided with per-hit
  ticks. Curve direction (accelerando vs retardando) is encoded by the
  spacing of internal ticks.
- **Grace-note ornaments** — rose diamond attack marks anchored on a
  thin attachment rail. Before-beat grace notes anchor on the right
  edge of their diamond (they end at the target); on-beat ornaments
  anchor on the left edge (they start at the target).
- **Delay ornaments** — cool blue offset brackets/spans, not amber
  bars. Delay reads as timing displacement, not as a new attack.

The rail only shows transport snapshot events while playback is running.
When stopped, the rail is blank.

## 28. Pitch Lane

The pitch lane sits below the ratchet rail and is also a playback-snapshot
lane. It shows the final note-on/note-off pitch bytes that transport
dispatched, as muted violet marks. Marker vertical position encodes the
pitch (high pitches sit higher in the lane).

The lane is bound by what the transport actually sent, not by what the
Pitch Shaper UI thinks should have been sent. If the two disagree, treat
it as a parity bug.

## 29. Channel Lane

The channel lane sits at the bottom of the resolved timeline. It is also
playback-snapshot only. Each note's final user-facing MIDI channel is
drawn as an absolute-positioned span over the same track geometry. The
marker carries the user-facing channel number (1-16) and a stable color
drawn from the shared `timelineChannelColor` mapping.

```
beat 1     2     3     4
  C1    C3    C1    C7
[====][====][====][====]   <-- final channel assignments
```

Color rules:

- Color and number travel together on the same marker surface — no
  detached legend, no separate per-channel row.
- A given channel keeps the same color in every cycle, section,
  timeline pass, channel chip, and synth properties view.
- Fallback or accent-routed assignments are marked by subtle edge or
  glow treatments, not by moving them out of the lane.
- Ratcheted channel events may use a clipped/pointed silhouette to
  imply a playback subdivision, but they keep the same horizontal tick
  geometry as the rendered note group.

If the channel marker shows `3` but you hear the sound assigned to
channel 7, that is a critical bug. The built-in synth has internal
remapping for General MIDI percussion limitations, but that remap stays
behind the monitor boundary and never changes the channel byte in the
displayed lane, MIDI debug rows, or external CoreMIDI bytes.

## 30. Playback Coherence Guards

Playback-only lanes (ratchet, ornament, pitch, channel) must pass a
cycle-coherence check before rendering. Ratchet has its own per-hit tick
intervals so it can render even if rhythm preview metadata is briefly
behind, but pitch and channel lanes wait for full coherence. If a
required source is still catching up after a repaint, the affected lane
hides and shows a quiet "syncing" status rather than composing data from
two different realizations.

This is the same parity invariant that keeps the timeline trustworthy.
It is better to show nothing for half a cycle than to show a number that
contradicts the sound.

---

# Part VI — Automation

## 31. Automation In One Page

Automation is Caesura's DAW-style parameter motion layer. A patch can
move editable sequencer values over musical time, with one crucial
constraint: the timeline preview and MIDI playback sample the same
backend evaluator, so the visible value is the playing value.

Automation properties:

- **Beat-quantized.** The engine samples each automation target once,
  before each beat is realized.
- **Exact time storage.** Automation point positions are exact rationals
  (`numer/denom`). Editing precision is 1 billion units. Stretching the
  automation length does not corrupt point positions.
- **Shared length.** One top-level Automation length measured in cycles
  governs every lane. Lanes stretch together.
- **Global markers.** Shared visual snap anchors across every lane.
- **Per-segment curve shaping.** Each segment between two points has a
  curve type (hold, linear, smooth, easeIn, easeOut, easeInOut,
  exponential) and a bend amount.
- **Weight graph ranges.** Weight lanes can set their graph Y axis to a local
  relative range, such as 0-5 or 1-20, so integer-like weights stay readable
  even though the underlying target can accept a much larger domain.
- **Cannot be edited during playback.** Automation edits clear the
  preview, refresh the visible cycle, and only then is play available
  again. This prevents the visible cycle from drifting from the score
  the transport actually has installed.

### The Automation Span

```
                  +---- automation length in cycles ----+
                  |  cycle 1  cycle 2  cycle 3  cycle 4 |
   normalized:    0/1                                  1/1
                  |                                     |
   point times:   0/1   1/4    1/2    3/4   ...        |
```

A point at 73 percent of the span remains at 73 percent whether the
span is 8 cycles or 800. Coordinated changes across long forms therefore
stay coordinated when the form length changes.

Important sampling rule: beat sampling never samples the exact right
edge `1/1`. For a 4-beat one-cycle span, the beat phases sampled are
`0/4, 1/4, 2/4, 3/4`. The point at `1/1` shapes interpolation at the
end of the span but is not itself audible. To hit a specific value on
the last beat, place a point at the last beat's actual phase (e.g.
`3/4`).

## 32. The Automation Overview

The Automation panel opens from the transport bar's Automation control.
For direct access from the main sequencer surface, use either:

- The small automation symbol beside a subsection label, which opens a floating
  shortlist for only that group's lanes. A tiny colored count means some lanes
  in that group already have automation.
- **Cmd-click / Control-click** an automatable editable control.

Each path opens the Automation panel, creates the lane if needed, and selects
that target for editing.

It contains:

```
+--- Automation Overview --------------------------------+
| Search [____]   Group [ All v ]   Type [ All v ]       |
|                                                        |
| Target browser                                         |
|   sequencer.pitch                       float          |
|   sequencer.velocity                    integer        |
|   sequencer.singleParameterRhythmicMod  boolean        |
|   sequencer.boundary.{id}.probability   probability    |
|   sequencer.initial.gati.{N}.weight     weight         |
|   ...                                                  |
|                                                        |
| Active lanes                                           |
|   [ Pitch    ]  [ Velocity ]  [ Boundary 1 prob ]      |
|                                                        |
| Selected lane                                          |
|   +------ graph editor -------+   +- point list -+     |
|   |                           |   | 0/1     60   |     |
|   |    +--+-----+--+          |   | 1/4     72   |     |
|   |   /   |     |   \         |   | 1/2     60   |     |
|   | /     |     |    +        |   | 3/4     48   |     |
|   |/      |     |     \       |   | 1/1     60   |     |
|   +---------------------------+   +--------------+     |
|                                                        |
| Weight lanes: Y min [0]   Y max [20]   [reset axis]   |
| Segment curve: [ linear v ]  Amount [ 0.5 ]            |
| Global markers: [+] [-]   ( vertical lines on graph )  |
+--------------------------------------------------------+
```

The target browser supports text search, group filtering, and type
filtering. Adding a target creates a default lane with two points
(start at `0/1`, end at `1/1`), both initialized to the target's
current fallback value.

The graph editor lets you click to add points, drag to move them,
select a segment by clicking its line, and snap points to global
markers within 1.25% of the full span. The point list under the graph
lets you edit phase percent and value exactly. Boolean lanes show 0/1
selectors; integer lanes round; float and weight lanes stay continuous
until their target clamps them. Weight lanes add Y-min/Y-max controls;
these affect graph scaling and point-edit limits for that lane, not the
meaning of the weight itself.

The segment controls let you choose the curve type and bend amount for
the currently selected segment. Curve types behave as described in §33.

## 33. Curve Types

```
hold      |____________|         (stays at left value until next point)

linear    |___________/          (straight interpolation)
              ___________
smooth    ___/           \___    (smoothstep blend; amount blends linear->smooth)

easeIn    |       ___/           (slow start, faster end)

easeOut   ___/       |           (faster start, slow end)
              ____
easeInOut ___/    \___           (slow at both ends, faster in middle)

exponential   _____/             (exponential rise shaped by amount)
```

Amount is clamped to `0..1`. For ease curves it controls the exponent;
for exponential it controls bend strength.

## 34. Global Markers

Markers are shared visual references on every graph. They are useful for
coordinating many lanes around the same form moment, e.g. "73% through".

- Add a marker by clicking the marker editor's `+` and choosing a phase
  percent and label.
- Edit or remove markers from the same list.
- Points can snap to markers while dragging or by choosing a marker in
  the point list.

**Important limitation.** Markers are currently visual snap anchors, not
relational constraints. A snapped point stores the marker id and the
current marker time, but moving the marker later does not move the point.
The evaluator reads the point's stored time.

## 35. Target Coverage

The frontend target registry is intentionally wider than the
backend-applied surface today. You can create and persist automation
lanes for many targets, but the engine currently applies automation
only to:

- Cycle-level Subdivision Switch targets — pitch, velocity, accent
  range endpoints, single-parameter rhythmic modulation, initial gati
  and jathi weights, max-section weights, boundary probabilities, and
  per-boundary gati and jathi weights.
- Transport tempo — in single-track playback, the `transport.tempoBpm` lane is
  sampled during playback as the effective scheduler BPM while the Tempo field
  remains the base BPM. In parallel custom-tempo tracks, the same lane is
  integrated continuously as that track's local clock.

Newly registered targets for rhythm, ratchet, ornament, pitch shaper,
channel shaper, and synth-channel program values can be created and
saved into the patch, but they do not yet alter realized output until
evaluator wiring for those subsystems is added.

Both states matter to you as a user:

- You can author the automation now and it will round-trip through patch
  save/load.
- It will not affect what you hear for those subsystems until the
  evaluator is wired up.

## 36. The Automation Playback Debug Table

The transport records a row each time live playback enters a new beat
with active automation samples. Each row has:

- Sequence number
- Cycle
- Zero-based beat index
- Tick-in-cycle
- Exact automation phase (`numer/denom`)
- All active sampled target values for that beat

The table is capped at 1000 rows and is diagnostic only. It samples
through the same typed backend evaluator used by playback, not through
frontend graph drawing helpers — so if you suspect automation is
sampling the "wrong" value, this table is authoritative.

---

# Part VII — Rhythm Shaper

The Rhythm Shaper is the layer where Caesura moves beyond one note per
matra and starts choosing rhythmic patterns. It opens as an inline
collapsible panel near the timeline and has tabs:

- **Patterns** — the Markov rhythm matrix per span length, with rest/tie
  articulation.
- **Re-subdivision** — arbitrary subdivision overlay plus gati speed /
  jathi timing.
- **Ratchet** — playback ratchet (covered in Part VIII).
- **Ornaments** — grace notes and delay (covered in Part IX).
- **Cycle Flux** — cycle-level BPM contour (covered in Part X).
- **Seeds** — a summary/shortcut tab. Real editing happens in the
  top-level Seed Strategy dialog.

This part covers the Patterns tab and the Re-subdivision tab.

## 37. The Patterns Tab

### Span Length

```
+----- Patterns ---------------------------------------------+
|  Span Length:  [ 3 ] [ 4 ] [ 5 ] [ 6 ] [ 7 ] [ 9 ] [ 11 ]  |
|                                                            |
|  Selected states (4-matra patterns):                       |
|    [4]   [1,3]   [2,2]   [3,1]   [1,1,2]   [2,1,1]  ...    |
|                                                            |
|  Matrix order: ( first ) ( second )                        |
|                                                            |
|  Matrix heatmap (current axis subset):                     |
|    +--------+--------+--------+--------+                   |
|    |   [4]  | [1,3]  | [2,2]  | [3,1]  |                   |
|    +---+----+--------+--------+--------+                   |
|    [4]| 4   | 2      | 1      | 0      |                   |
|    [1,3]| 1 | 6      | 2      | 1      |                   |
|    [2,2]| 0 | 2      | 8      | 3      |                   |
|    [3,1]| 1 | 1      | 2      | 5      |                   |
|    +---+----+--------+--------+--------+                   |
|                                                            |
|  Fallback: ( static [4] )  ( weighted pool )               |
|                                                            |
|  Per-cell rest/tie probabilities                           |
|    state [1,3]   rest 5%   tie 10%                         |
|    state [2,2]   rest 0%   tie 20%                         |
|                                                            |
|  Rest-over-accent policy: [ break ]                        |
|  Tie-over-accent policy:  [ break ]                        |
|                                                            |
|  Copy current matrix to: [3] [4] [5] [6] [7] [9] [11]      |
|  Learn from passage: [ paste pulse list ]                  |
+------------------------------------------------------------+
```

The Span Length picker is the key top-level control of this tab.
Caesura keeps a separate Markov matrix per span length because the state
space of patterns that exactly fill 4 matras is different from the state
space for 7 matras. Switching span length changes which matrix you are
editing.

### Pattern States

A **state** is a pulse pattern for a span length. Patterns are integer
compositions of the span length:

```
span 4: [4]  [1,3]  [3,1]  [2,2]  [1,1,2]  [2,1,1]  [1,2,1]  [1,1,1,1]
span 5: [5]  [1,4]  [4,1]  [2,3]  [3,2]  [1,1,3]  ...
```

You select a state subset for each span length. Only selected states
appear in the matrix and can be chosen by the engine. Reducing the
selected subset is a powerful way to narrow the rhythmic vocabulary.

### Transitions

A **transition** is a weighted move from one state to another:

- In **first-order** mode, the previous state selects the next.
- In **second-order** mode, the previous two states select the next.

Weights are non-negative integers. The matrix heatmap colors cells by
weight using the canonical blue/teal/green-through-yellow/orange/red
ramp. Empty cells are recessed charcoal.

### Fallback

When the chain has no usable outgoing edge — because the previous state
has no positive weights to anywhere — the engine uses a **fallback**:

- **Static fallback** — a fixed state (typically `[N]`, the whole-span
  pattern).
- **Weighted fallback pool** — a small weighted set of fallback states.

Resolved rhythm spans expose `fallback-hit` source metadata so the UI
can flag fallbacks. Initial cold-start choices are reported separately
from true fallbacks.

### Entry Selector

The **Entry selector** is the weighted startup selector for a fresh
first-order or second-order context. It is separate from fallback: entry
weights decide how a section/span chain begins, while fallback weights
are only used when an already-contextualized chain gets stuck.

### Per-cell Rest/Tie Probabilities

Each chosen Markov pattern is expanded into resolved cells. By default
every cell plays. You can assign rest and tie probabilities to each cell
of each selected state:

- **Rest** — cell is silent.
- **Tie** — cell is held into the following cell with no new note-on.
- Rest and tie are mutually exclusive for one cell; the remainder is
  ordinary play.
- A rest on the following cell breaks an incoming tie.

The per-cell editor sits in a collapsed tile near the selected state
subset. Each cell shows a graphical play/rest/tie probability bar plus
labeled rails for direct editing.

### Rest-Over-Accent And Tie-Over-Accent

Protected accent spans matter for articulation too. By default, a rest
or tie that would start at an active accent span's first cell is
broken back to ordinary play, because rests and ties there hide an
accent.

The rest-over-accent and tie-over-accent policies allow you to override
that default. A tied group that crosses an accent start is the one
current case where rhythm may hide an accent. If such a tied group
ratchets, the ratchet fills the whole tied duration as if the group
had originally been authored at that length. Rested cells never ratchet.

### Copy Current

The Copy Current action takes the current matrix and writes it into
selected target span lengths after **extrapolating** the states. The
extrapolator maps each state to an analogous state in the target
length and re-normalizes the transition weights. The result is an
ordinary, editable matrix — there are no hidden runtime dependencies on
the source.

### Learn From Passage

The Learn From Passage action accepts a pulse-length list independent of
the current cycle:

```
[1, 5, 2, 3, 1, 4, 1, 1, 1, 2, 1, 1, 2, 1, 3, 3, 3, 1, 5]
```

The importer treats the passage as source vocabulary. Chunking and
windowing strategies infer a compact axis subset for each target span
length, nearest-fit observed windows into that subset, and tally
first-order or second-order transition weights. Target chips choose
which span-length matrices receive generated transitions. The order
control chooses whether learned weights land in first-order or
second-order matrix state.

The generated chain is materialized as ordinary editable matrix state,
again with no hidden source dependency.

## 38. The Re-Subdivision Tab

This tab hosts two related but distinct controls: gati speed / jathi
timing (a structural reframe) and arbitrary subdivision (a virtual
overlay).

### Gati Speed / Jathi Timing

Speed/timing weights reinterpret the rhythmic frame for a gati or
jathi context.

```
+----- Re-subdivision -----------------------------------+
|  Gati context: [ 3 ] [ 4 ] [ 5 ] [ 6 ] [ 7 ] [ 9 ] [11]|
|  Speed weights for gati 5:                             |
|    1st  [3]      2nd  [2]      3rd  [1]      4th  [1]  |
|    1/2  [1]      1/3  [0]      1/4  [0]      1/5  [0]  |
|    1/6  [0]      1/7  [0]                              |
|                                                        |
|  Jathi context: [ 3 ] [ 4 ] [ 5 ] [ 7 ] [ 9 ] [11]     |
|  Speed weights for jathi 3:                            |
|    1st  [3]      2nd  [1]      3rd  [0]      4th  [0]  |
+--------------------------------------------------------+
```

Gati speed multipliers:

- `1st` — keep the native matra count. Neutral first speed.
- `2nd` / `3rd` / `4th` — anuloma. Halve/third/quarter the note value,
  yielding 2x/3x/4x as many timing units in the same beat. For example
  `gati 5 x 2` has a 10-unit timing grid per beat.
- `1/2` through `1/7` — pratiloma. The native material is spread across
  a 2- through 7-beat frame. For example `gati 5 x 1/2` is valid over an
  even number of beats because each two-beat frame contains five timing
  units.

Jathi timing is narrower: only `1st` through `4th`. Slower multi-pulse
jathi frames behave like phrase framing and are not surfaced as
"jathi pratiloma" today.

Timeline labels show the annotation directly: `gati 4 x 2`,
`gati 5 x 1/2`, `jathi 3 x 2`. The gati lane still draws native gati
cells; the speed annotation describes the timing grid that jathi
validity and Markov rhythm tile, not the visible cell count.

Slower pratiloma speeds that cannot tile a section context exactly are
still visible in the editor but are clearly marked as skipped.

### Arbitrary Subdivision

Arbitrary subdivision can reinterpret a protected accent span at a
different virtual matra count before Markov rhythm grouping:

```
native protected span:    9 matras  |==========|
virtual target:           7 matras  |========|         (still spans
chosen virtual pattern:   [1, 6]                       the same absolute
audible output:           hits at 0/7 and 1/7          duration)
                          of the native span
```

The arbitrary subdivision card exposes:

- **Probability** — chance the span is reinterpreted this realization.
- **Target weights** — weighted target span lengths.
- **Clump count weights** — how many contiguous virtual clumps to use.
- **Cell source** — Markov-derived patterns (uses the target-length
  Markov chain) or a per-target weighted pool.
- **Allow trivial** — whether the trivial `[N]` pattern is allowed.

Rules:

- The original accent span boundary remains protected.
- The virtual subdivision stays wholly inside that one span.
- Required protected cuts inside the original span must project exactly
  into the virtual grid; otherwise the span is skipped for arbitrary
  subdivision.
- Weighted-pool mode does not advance the target-length Markov history
  — it's render-only for Markov memory.
- An active target length with no positive eligible pool cells is
  inert: it is skipped rather than making rhythm realization fail.
- Default chance is 0%, so existing rhythm behavior is unchanged unless
  enabled.

## 39. Rhythm Articulation

Articulation is the layer that converts chosen Markov patterns into
concrete play/rest/tie outcomes. The per-cell rest/tie editor is in the
Patterns tab; the policy controls (rest-over-accent and tie-over-accent)
sit next to it.

The result of articulation is shared by preview and playback — rested
cells appear as low-emphasis hollow blocks in the rhythm row both in
the preview cycle and during transport. Tied cells appear joined by tie
ticks; they remain one MIDI note from note-on through the tie.

---

# Part VIII — Ratchet

Ratchet is a playback subdivision of already audible note groups. It
rapidly subdivides one note group into repeated MIDI note-on/note-off
pairs without changing the underlying gati, jathi, section, or
rhythm-span structure. Ratchet lives in the Rhythm Shaper's Ratchet tab,
whose primary surface is the **stochastic strips** (V2/v3, 2026-07).

## 39a. The Ratchet Stochastic Strips

The surface is one vertical story. Each strip answers one musical question,
with a read-only outcome picture in the middle and the controls that govern it
on the right. Every handle is keyboard-operable (arrow keys nudge, Shift steps
larger) and can expose its automation target.

```
+- RATCHET -- [pickup stutter][tight roll][sparse fill][flutter][buzz] - deep -+
| OUTCOMES            natural panel chance, rolled three times                  |
| HOW OFTEN?          amount + cooldown                                         |
| HOW FAST?           effective-ms band, likelihood shape, tempo follow, sync   |
| WHERE IN PHRASE?    phrase/span/edge placement weights                        |
| WHICH NOTES?        short/long preference + optional pulse window             |
| EVERY BURST         focused backend sample, fill, pace, timing, dynamics      |
+------------------------------------------------------------------------------+
```

- **OUTCOMES / HOW OFTEN.** Outcome blocks use backend-computed natural fire
  probabilities; the three faint lanes are display-only rolls. Shape Group
  ratchet triggers are an additional force-fire path. Amount sets density and
  cooldown spaces successful gestures.
- **HOW FAST (band).** Repeats are governed by a tempo-elastic band:
  edges authored at 120 BPM, following the effective local tempo by the
  tempo-follow amount (fixed ms ↔ metric), saturating at ±3x, hard rails
  18–200 ms. Every rapid inter-onset interval is enforced inside the
  band — under drawn curves, jitter, Cycle Flux, local parallel tempo, and
  tempo automation. The millisecond handles invert the backend's exact
  `bandScaleMs`; the UI does not keep a second band formula.
  R-BAND measures consecutive rapid onsets; the last rapid segment's remaining
  sustain and a separate fill hold are not extra IOIs. Sync uses an integer
  subdivision rate on the real local-pulse grid. Fractional fills can end with
  a short terminal remainder, and tied notes crossing gatis follow each
  region's own pulse width.
- **WHERE / WHICH.** Phrase weights, the within-span curve, and edge emphasis
  redistribute chance; normalization keeps amount meaningful as a density.
  Length bias and an optional pulse window then select note sizes.
- **EVERY BURST.** The focused backend sample shows actual onsets, durations,
  velocities, and a possible hold. The pace handle accelerates or ritards the
  burst (it writes a two-point custom time curve; a hand-drawn curve takes
  precedence and the handle steps aside). The fill bracket turns long notes into
  burst-plus-hold gestures: lead = shatter then ring, trail = ring then
  land the burst on the next accent. Jitter is the seeded timing spread.
- **SOUND.** The contour handles move the velocity attractor across the
  burst (rise into the target, fall away, arc); humanize loosens the
  draw around that path. The relative window, Repeat-Last, and the
  cross-burst carry still apply (deep drawer).
- **Deep drawer (▸).** Everything else lives one click down and nothing
  was removed: the full chance/rate/time/velocity panels, internal
  Markov rhythm, span gates, cooldown bases, the drawn time-curve editor
  and its weighted preset space, and — with V2 placement active — the
  exact-boundary Edge Emphasis weights that replace the legacy modifier
  stack.

**Commit-on-release.** During a pointer drag, only the local strip graphic and
receipt move. There are no patch writes and no preview calls. Release commits
once; starting a drag invalidates outstanding bold and ghost previews, so a
late resolve or error cannot overwrite the gesture. Keyboard steps remain
discrete commits.

**Directly in the strips** (no drawer trip needed):

- The **power dot** next to the RATCHET title is the enable switch.
- The **How often?** strip owns amount and the cooldown amount/basis.
- **How fast?** shows the effective band and achievable millisecond limits at
  the current local tempo; values remain exact when committed.
- **Where in the phrase?** owns phrase, in-span, and exact-edge emphasis.
- **Which notes?** owns the short/long bias and optional pulse window.
- **Every burst** owns the velocity window/contour and the focused sample's
  hit count and fire chance.

Sections 40–48 below describe the all-controls drawer and retained legacy
(pre-V2) fields. Each legacy resolver still applies verbatim when its
corresponding V2 layer is null. Pre-v5 fixed-Hz specs migrate when
position-speed shaping is neutral;
values beyond the 18–200 ms rails clamp intentionally. Metric rate strategies
and active position-speed shaping remain on the legacy resolver.

## 40. Ratchet Overview (deep drawer / legacy model)

```
+----- Ratchet ------------------------------------------+
| Power: [ on / off ]                                    |
| Base chance: [ 35% ]                                   |
|                                                        |
| Position Probability Modifiers                         |
|   Phrase: cycle start * 1.2   cycle end * 0.6          |
|   Speed:  faster near start, slower near end           |
|   Accent-span start  + 5%                              |
|   Accent-span end    - 5%                              |
|   Slow-note (>= 1 matra)  * 1.5                        |
|   Fast-note (<= 0.5 beat) * 0.4                        |
|                                                        |
| RATE                                                   |
|   Strategy: ( audible hits/sec ) (beats) (matras)      |
|   Min: 6.0  Max: 24.0   Distribution: toward median    |
|                                                        |
| TIME                                                   |
|   Drawable curve [ . . . . . . . ]                     |
|   Variance band  [ . . . . ]                           |
|   Preset weights: even 2  accel 1  retard 1            |
|   Interpolation: ( hard ) ( seeded blend )             |
|   Blend low [ 0.0 ]  Blend high [ 0.5 ]                |
|                                                        |
| Span Gate                                              |
|   Multi-matra: [ on ]                                  |
|   Global max span: [ 3 ] matras                        |
|   Per-subdivision: 4 -> 3   5 -> 4   7 -> 4            |
|                                                        |
| Internal rhythm: ( off ) ( use rhythm chain for hits ) |
|   Min hit count [ 6 ]  Max [ 16 ]                      |
|                                                        |
| Velocity                                               |
|   Mode: ( relative ) ( absolute )                      |
|   Min  [ -10 ]  Max  [ +5 ]  Center [ 0 ]              |
|   Attraction [ 0.6 ]   Same-as-previous [ 0.2 ]        |
|                                                        |
| Cooldown                                               |
|   Basis: ( matras ) ( ms ) ( beat multiples ) ( % beat)|
|   Value: [ 0.5 ]                                       |
+--------------------------------------------------------+
```

## 41. Probability Modifiers

The base chance is the starting probability. Modifiers can either
**multiply** that chance (neutral `x 1`) or **add** a finite offset
(neutral `+ 0`). Their results are clamped to `0..1`.

Stacking modifiers:

- **Slow-note modifier** — applies when the candidate note group is at
  or above a duration threshold. Threshold can be expressed in matras
  inside the active accent span or as a percentage of one beat
  duration.
- **Fast-note modifier** — applies when the candidate note group is at
  or below a threshold.
- **Active accent-span start/end modifiers** — bias ratcheting at
  protected span starts or ends.
- **Section start/end modifiers** — bias at section boundaries.
- **Cycle start/end modifiers** — bias at cycle endpoints.
- **Phrase-position modifier** — interpolates start/mid/end points
  across the cycle. The result multiplies probability and can also
  scale the speed range before the ratchet count is chosen.

All modifiers can be set to multiplicative or additive in the UI. The
modifiers are visible in a single stacked card so you can read the
running chance from top to bottom.

## 42. Rate Strategies

The Rate panel chooses how many repeated hits will fill the source
note group's duration. Three strategies:

- **Audible hits per second** — choose an integer repeat count only
  when the resulting repeated notes fit inside a BPM-aware hit-rate
  window. Useful at variable tempos where audible density is what
  matters.
- **Bounded hits per beat** — choose an integer repeat count only
  when the resulting repeated notes fit inside the selected beat-
  relative hit-rate window. Useful when you want hits per beat to be
  bounded regardless of tempo.
- **Hits per matra** — explicit tuplet-locked behavior. Hits follow
  local matra speed.

Distribution shapes the random draw inside the chosen range:

- **Uniform** — even draw.
- **Toward median** — middle speeds more likely.
- **Away from median** — slow and fast edges more likely.
- **Favor slow** — bias toward slower hit counts.
- **Favor fast** — bias toward faster hit counts.

## 43. Time Curve

The TIME panel authors a custom ratchet contour. It is the primary
visual object of this tab:

```
y (relative stretch)
^
| even spacing line  .................................
|         curve  /---\
|              /     \___
|        ___-/
|     -/
+--------------------------------------> x (position through note group)
0/1                                     1/1
```

- **x** is position through the source note group.
- **y** is relative stretch. Center means even spacing; above center
  makes that part slower/longer; below center makes it faster/shorter.
- **Variance** is a seeded vertical spread around the curve. Zero
  variance is exact; larger values create a probabilistic spread band.
- **Presets** can be weighted (even / accelerando / retardando /
  accel-then-retard / retard-then-accel). For each fired ratchet, the
  engine samples within that weighted set.
  - With interpolation off, one weighted curve is hard-picked.
  - With interpolation on, two weighted curves are picked and a seeded
    uniform blend amount is drawn inside the configured low/high
    bounds.

Timing curves always keep the source note group's start and end fixed
and only move internal split points; internal hit boundaries are
monotonic.

Legacy fixed/weighted curves and temporal easing fields are still
loadable from older patches, but custom time curves take precedence.

## 44. Span Gate

Span Gate decides whether ratchet may target held groups longer than one
matra:

- **Multi-matra on** — ratchet may target longer note groups.
- **Global max span** — one slider that caps the held width for every
  subdivision length.
- **Per-subdivision** — per-length max widths so longer holds can be
  allowed globally or tuned per span length.

The limit is always applied inside one active accent span; ratchet
skips any candidate that would cross that span (except in the explicit
tie-over-accent case described in §37).

## 45. Internal Ratchet Rhythm

An optional internal ratchet rhythm groups the generated hit grid using
the same Markov rhythm chain shape as the main rhythm engine. The
chain's `spanLen` must equal the generated ratchet hit count.

If no matching chain exists, if the chosen pattern does not tile that
count, or if the hit count is outside the configured min/max gate,
playback keeps the straight generated hits. Internal rest/tie
articulation is allowed inside the ratchet; the underlying rhythm tree
remains unchanged.

## 46. Velocity Generation

Ratchet velocity has two modes:

- **Relative** (preferred). `min`, `max`, and `center` are offsets from
  the velocity of the note being replaced. A ratchet over a soft
  accented note stays soft relative to that source; a ratchet over a
  loud accent stays loud relative to that source.
- **Absolute**. Fixed MIDI velocity range. Legacy/explicit behavior.

Generated velocities are chosen inside the resolved range, pulled
toward `center` by `attraction`, and may repeat the previous hit's
velocity according to `sameProbability`.

## 47. Cooldown

Cooldown is a refractory period after a ratchet (or grace-note
ornament) fires. During cooldown, later candidate note groups are
skipped before probability is rolled. Cooldown basis options:

- **Matras** — local matras inside the active accent span.
- **Milliseconds** — wall-clock.
- **Beat multiples** — at the current BPM.
- **Percent of beat** — percentage of one beat duration.

Choose the basis that matches the musical "feel" you want for the
refractory window.

## 48. Reading The Ratchet Rail

During playback, fired ratchets appear in the ratchet rail as amber
rounded duration bars with rounded per-hit subdivisions. The duration
bar's left edge sits at the source note's start; its right edge at the
source note's end. Internal ticks mark each generated hit at its actual
rendered tick interval (carried on the snapshot event), so accelerando
and retardando read directly off the rail spacing.

If a ratchet event arrives but its underlying note group is no longer
present in the resolved preview, the event is still drawn — because
the event carries its own final hit intervals. This is intentional:
ratchet visibility should not lie just because rhythm metadata is half
a cycle behind.

---

# Part IX — Ornaments

Ornaments are playback articulations of resolved target note groups.
Two ornament types exist today: grace notes and onset delay. They live
in the Rhythm Shaper's Ornaments tab.

## 49. Ornament Tab Structure

```
+----- Ornaments ----------------------------------------+
| Power: [ on / off ]                                    |
|                                                        |
| Type submenu:  ( Grace Notes )  ( Delay )              |
+--------------------------------------------------------+
```

The Ornaments tab has a local type submenu. Grace Notes contains
grace-note burst controls; Delay contains onset-delay controls. The
power switch covers both ornament types; you can disable a type via its
own probability setting if you want only one.

## 50. Grace Notes

Grace notes attach as small, rapid attack-marks before or on the target
note.

```
+----- Grace Notes --------------------------------------+
| Probability: [ 30% ]                                   |
|                                                        |
| Count weights:  single [3]  double [1]  triple [1]     |
| Placement:                                             |
|   Before beat   [ 60% ]                                |
|   On beat       [ 40% ]                                |
| Duration:    [ 30 ms / matra ]                         |
| Cooldown:    [ ... same controls as ratchet ... ]      |
| Target rests: [ on / off ]                             |
|                                                        |
| Velocity                                               |
|   Mode: ( relative ) ( absolute )                      |
|   Min [ -8 ]  Max [ +0 ]  Center [ -4 ]                |
|                                                        |
| Probability modifiers                                  |
|   ... same family as ratchet ...                       |
+--------------------------------------------------------+
```

### Placement

Placement is a two-sided weight slider between **Before beat** and **On
beat**. Either side can be set to 0%.

- **Before beat** grace notes end at the target's start. They must
  skip targets at the first tick of the cycle; they do not wrap to the
  previous cycle.
- **On beat** grace notes start at the target's start and delay the
  principal target note when the target is audible.

### Tied Cells And Target Rests

Tied rhythm cells are not separate target notes. A tied group may
receive one ornament as a whole target, but tie-in cells must not
receive separate ornaments. Grace notes may optionally target rests
(this is a grace-note setting, not a promise that future ornament types
will). Rested cells never ratchet.

### Visualization

Grace-note playback markers draw in the ratchet rail as rose diamond
attack marks on a thin attachment rail. Before-beat ornaments anchor on
their right edge; on-beat ornaments anchor on their left edge. The
diamond shape and rose color distinguish them visually from ratchet
amber bars.

## 51. Delay

Delay ornaments move the target note-on later. The note-off remains at
the expected tick, so the delayed note is shortened. Delay never
overlaps or rewrites neighboring notes.

```
+----- Delay --------------------------------------------+
| Probability: [ 20% ]                                   |
|                                                        |
| Timing window                                          |
|   Basis: ( ms ) ( matras ) ( beats ) ( % beat )        |
|   Min:   [ 5  ]                                        |
|   Max:   [ 30 ]                                        |
|                                                        |
| Sampling                                               |
|   Mode: ( unquantized + distribution )                 |
|         ( quantized to tuplet pool )                   |
|   Distribution: uniform                                |
|   Tuplet weights: 3:1  4:2  5:1  7:1  9:0              |
|                                                        |
| Probability modifiers                                  |
|   ... same family as ratchet ...                       |
+--------------------------------------------------------+
```

### Timing Window

Delay boundaries are authored as a probabilistic range, not as one
fixed percent of the note duration. Supported bases:

- Milliseconds (clock-based feel)
- Matras (local span-relative)
- Beats (beat-multiples)
- Percent of beat

Playback always clips the resolved delay to before the target's
note-off so the delayed note remains audible and never overlaps the
next event.

### Sampling

- **Unquantized** — sample within the boundary range using the
  selected distribution.
- **Quantized** — select a tuplet grid point that falls inside the
  range, weighted by per-tuplet weights. Tuplet weights can be zero so
  a grid can be removed without deleting the row.

### Visualization

Delay markers draw in the ratchet rail as cool blue offset
brackets/spans. They read as timing displacement, not as new attacks.
This distinguishes them from amber ratchet bars and rose grace-note
diamonds.

## 52. Pitch And Channel Handling For Ornaments

Each ornament has explicit pitch and channel rules:

- **Keep source target** — ornament pitch/channel matches the target
  note.
- **Move whole ornament** — pitch/channel resolved once for the whole
  ornament group.
- **Per-hit probabilistic** — each grace note resolves its own pitch
  and channel probabilistically.

These rules are exposed on each ornament type and are evaluated by the
Pitch Shaper and Channel Shaper respectively.

---

# Part X — Cycle Flux

Cycle Flux is a playback timing warp across one complete cycle. It
lives in its own Rhythm Shaper tab because it is a BPM contour over the
full cycle, not a subdivision control.

## 53. What Cycle Flux Does

Cycle Flux defines an instantaneous BPM profile across one complete
cycle. The transport converts that profile into a normalized cumulative
time map, then **pins the cycle start and cycle end to exact ticks**.

```
BPM
^
|     ___          ___
|    /   \   ___  /   \
|  -/     \-/   \/     \-       <- BPM profile across cycle
|
+------------------------------------> cycle position
0                                  1

  Cycle start and end ticks are LOCKED. Only events inside the
  cycle move earlier or later. Total cycle length is invariant.
```

This means a curve can feel slightly faster near the start and end, or
slower near the center, without accumulating tempo drift over repeated
cycles. Cycle Flux does **not** change gati, jathi, section boundaries,
Markov grouping, rests, ties, pitch choices, or channel choices.

## 54. Cycle Flux Controls

```
+----- Cycle Flux ---------------------------------------+
| Enabled: [ on / off ]                                  |
|                                                        |
| BPM range                                              |
|   Low:  [ 80  ]                                        |
|   High: [ 120 ]                                        |
|                                                        |
| Direct curve [ . . . . . . . ]                         |
|                                                        |
| Seeded LFO depth: [ 0.15 ]                             |
|                                                        |
| Summary: 80..120 BPM, LFO depth 0.15                   |
+--------------------------------------------------------+
```

Controls resemble the Ratchet TIME editor: low and high BPM edges, a
direct curve editor, and a seeded LFO depth. The LFO is a slow
cycle-periodic random warp, not sharp per-event jitter.

The tab summary reports the active BPM range and LFO depth, independent
of the Ratchet tab summary.

## 55. Cycle Flux On The Timeline

When Cycle Flux is enabled, the timeline shows a compact full-cycle
tempo-flux rail above the resolved sections. The rail uses the same
cycle seed and timing map as playback, draws the BPM contour, and marks
warped beat-boundary positions.

The locked-endpoint invariant is shown compactly; it must never imply
that total cycle length can drift.

---

# Part XI — Pitch Shaper

Pitch shaping is a final MIDI pitch layer. It rewrites pitches after
rhythm, ratchet, and ornaments have produced the final audible note
groups and before channel hocketing assigns final MIDI channels.

Pitch shaping must **not** change gati, jathi, rhythm grouping, rests,
ties, ratchet timing, velocity, or channel identity.

## 56. Notation-First Editing

Pitch states are edited primarily as **notation**. The grand-staff
editor displays the selected collection/range as noteheads:

```
+----- Pitch Shaper ---------------------------+
|  Range:  C3 .. C5                            |
|                                              |
|  Grand staff                                 |
|                                              |
|     _____o___________________________        |
|    |        _____o___________ _____          |
|  G |             _____o___                   |
|    |   _________________o_____               |
|  F |                                         |
|     _____________________________________    |
|                                              |
|  Collection: ( None ) (T1) (T2) (T3) (T4)..  |
|  Fallback noteheads (toggle ghost vs solid)  |
|                                              |
|  Weighted fallback values (aligned lane)     |
|    C   D   E   F   G   A   B                 |
|   [2] [0] [1] [3] [1] [0] [2]                |
+----------------------------------------------+
```

Names and MIDI numbers may remain available as secondary labels,
tooltips, or fallback controls, but the staff is the primary editor.

The notation editor uses separate lanes for separate jobs: noteheads
edit the pitch set or choose/toggle fallback behavior, while weighted
fallback values live in an aligned control lane below the staff.
Numeric inputs, labels, or other controls are never placed directly on
top of noteheads, accidentals, ledger lines, or clefs.

## 57. Limited-Transposition Collections

Limited-transposition collections (Messiaen modes T1, T2, T3, ...) are
prioritized presets. Selecting a collection materializes ordinary
editable pitch states — the user can then edit individual notes,
fallback, and weights as usual. The collection acts as a starting point,
not a hidden runtime dependency.

## 58. Pitch Markov Matrix

Pitch transitions use a Markov matrix sharing the same canonical table
shell as Rhythm and Channel matrices:

- **First-order** uses the previous resolved pitch as context.
- **Second-order** uses the previous two resolved pitches.
- Matrices may mix absolute pitch targets with relative chromatic and
  relative collection targets.

The heatmap uses the same ramp as the Rhythm Shaper: blue/teal/green
through yellow/orange/red. Empty cells are recessed. Inputs sit inside
the heat cell and remain legible at every intensity.

## 59. Boundary Policies

Pitch boundary policies define what happens when a transition would
land outside the configured range:

- **Wrap** — wrap around the modulo interval.
- **Clamp** — clamp to range edges.
- **Reflect** — mirror back into range.
- **Fallback** — use the static or weighted fallback.
- **Nearest** — snap to the nearest in-range pitch.

The visible modulo interval is shown so the user can see what "wrap"
means in their current configuration.

## 60. Transposition

Probabilistic transposition is **separate** from transition choice. It
may render a different pitch without driving Markov memory, or drive
memory only when explicitly enabled and the rendered pitch matches a
state.

Transposition can be authored as:

- **Per-note** — each note may transpose independently.
- **Stair-step** — passages transpose by a step amount, then advance.

## 61. Ratchet And Ornament Pitch Behavior

Ratchet pitch behavior:

- **Keep source pitch.** Ratchet hits inherit the source note's pitch.
- **Move whole gesture.** A single new pitch is chosen for the whole
  ratchet gesture.
- **Per-hit probabilistic.** Each ratchet hit resolves its own pitch.

Ornament pitch behavior mirrors this: keep target pitch, move whole
ornament, or per-grace-note probabilistic. Onset delay does not change
pitch.

## 62. Pitch Seed Behavior

Pitch seed behavior mirrors Rhythm Shaper and Channel Shaper. Edit it
in the top-level Seed Strategy dialog. Pitch Markov, transposition, and
ratchet/ornament pitch behavior share this pitch shaper stream.

## 63. The Pitch Lane

The timeline pitch lane is playback-snapshot data. It shows the same
final note-on/note-off pitch bytes that transport dispatched, as muted
violet marks. It must always pass the cycle-coherence guard before
rendering.

---

# Part XII — Channel Shaper

Channel hocketing is the final MIDI playback layer. It rewrites final
MIDI channels after pitch shaping. Channel hocketing must not change
gati, jathi, rhythm grouping, rests, ties, or ratchet timing.

## 64. Channel States And Static Output

Channel states are user-facing MIDI channels 1-16. The static MIDI
output channel remains editable when hocketing is off — that's the
channel every event gets if hocketing is disabled.

```
+----- Channel Shaper -----------------------------------+
|  Hocket [ on/off ]  Output [1]  Seed [...]             |
|  Order [first]      Axis [4]    Fallback [1]           |
|                                                        |
|  Channel set:                                          |
|    [x] 1  [x] 2  [ ] 3  [x] 4  [ ] 5  ...              |
|                                                        |
|  Tabs: Matrix | Entry & Fallback | Accents | Gestures  |
|                                                        |
|  Channel transition matrix (first order):              |
|   from\to | 1   2   4                                  |
|     1     | 3   2   1                                  |
|     2     | 2   3   2                                  |
|     4     | 1   1   3                                  |
+--------------------------------------------------------+
```

The header's **Assignment** select chooses the per-track strategy:
**Markov chain** (the transition-matrix walk below) or **Euclidean
(Bjorklund)** (§65's deterministic pattern engine). Exactly one is active;
the other's settings stay authored and validated, so switching back never
loses work. Order and Axis are Markov-only controls and hide in Euclidean
mode.

Axis count is the fast way to size the Markov X/Y axes, entry selector,
and weighted fallback pool. Setting it to 6 enables channels 1 through 6.
The individual channel chips can still make the enabled set
non-contiguous after that.

With the Markov strategy, the **Matrix** tab is the primary authoring
surface and **Entry & Fallback** edits how a fresh or stuck chain chooses a
context. With the Euclidean strategy both are replaced by the **Pattern**
tab. **Accents** (velocity-band channel overrides) and **Gestures** (ratchet
and ornament channel behavior) apply to both strategies.

## 65. Assignment Strategies: Markov Matrix And Euclidean Pattern

### Markov transition matrix

The matrix uses the same canonical shell as Rhythm and Pitch matrices —
sticky headers, cell sizing, heatmap ramp, and inputs inside the heat
cell.

- **First-order** uses the previous resolved channel as context.
- **Second-order** uses the previous two resolved channels.

The user must explicitly choose which channels are "enabled" for
hocketing. Disabled channels never receive routed notes (the static
output channel still applies when hocketing is off).

Entry and fallback behavior mirrors Rhythm Shaper: entry selector first,
then static fallback plus optional weighted fallback pool for stuck
chains.

### Euclidean (Bjorklund) pattern

The Euclidean strategy replaces the stochastic walk with a deterministic
multi-voice Bjorklund pattern: layers of "k pulses, as evenly spread as
possible" (Toussaint's E(k,n) rhythms — E(3,8) is the tresillo
`10010010`), read one step per note. The **Pattern** tab owns it:

- **Placement.** *Partition* shares one cycle of **Steps** slots: each
  layer claims its pulses by iterated Bjorklund over the slots earlier
  layers left behind (exact per-layer quotas), and leftover slots fall to
  the Fallback channel. *Stack* gives every layer its own **Length** —
  polymetric masks that drift against each other; earlier layers win
  collisions, misses fall back, and *Invert* makes a layer claim its rests.
- **Layers.** Priority-ordered rows (reorder with the arrows). Each has a
  channel from the enabled palette, **Pulses**, **Rotate** (start the
  necklace elsewhere — many world rhythms are rotations of the same E(k,n)),
  and **Max run**: values above 1 cluster the pulses into bursts of at most
  that length, Bjorklund-spacing the bursts among the rests (with max run 1
  this is exactly the classic pattern).
- **Readouts.** Every layer shows its resolved mask as a bead strip, its
  adjacent inter-onset interval vector — E(5,9) = (22221) — and, where the
  classification applies, a **Euclidean string** or **reverse Euclidean
  string** badge (Ellis-Ruskey-Sawada-Simpson). The numbered strip at the
  bottom is the resolved channel per step, fallback slots dimmed.
- **Reset** re-anchors the pattern to step one **every cycle** (it runs
  freely across sections), **every section**, **every beat**, or **every
  accent span** (each jathi frame / bhedam cell replays the pattern head).
- **Span accents.** *Woven into pattern* treats the note starting each
  accent span like any step. *Pinned to channel* routes those notes to the
  anchor channel and removes them from the pattern stream entirely — the
  weave compacts across them, so the interior mix stays exact while the
  structural accents keep one timbre (on a hocket, the channel is the
  timbre).

Position rules and accent routing still fire in Euclidean mode with
positional meanings: a position *reset* re-anchors the pattern (next note
reads step one), and an accent rule's *drive chain* becomes a phase
magnet — the pattern jumps to the next step that plays the forced channel
and continues from there. Because the pattern is deterministic, the same
cycle always weaves the same way; seeds keep governing the probabilistic
extras (accent chances, gesture rolls, weighted position actions).

## 66. Accent Routing

Accent Routing is a velocity-band override. Each rule says: "notes with
velocity in this range prefer these channels with these weights." Rules
have two modes:

- **Render only** — the rule rewrites the rendered channel without
  driving the chain state. Subsequent transitions still see the chain's
  "logical" previous channel.
- **Drive chain** — the rule's choice becomes the new chain context.

Velocity routing surfaces, especially this one, show the current base,
section, gati, and jathi velocity bands in place as a read-only guide.
Edits jump to the canonical Cycle Setup controls or the Probability and accents
bar in Sections and Subdivisions instead of duplicating them.

## 67. Ratchet And Ornament Channel Behavior

Ratchet channel behavior:

- **Source** — ratchet hits stay on the source channel.
- **Whole** — a single new channel is chosen for the whole ratchet
  gesture.
- **Per-hit** — each ratchet hit resolves its own channel.

Ornament channel behavior mirrors this: keep target channel, move
whole ornament, or per-grace-note probabilistic.

## 68. Channel Seed Behavior

Channel seed behavior is edited in the top-level Seed Strategy dialog.
The accent-routing stream uses the same channel shaper seed — there is
no hidden separate seed.

## 69. Timeline Channel Lane And Parity

The timeline channel lane and MIDI debug table show what transport
actually sent. External MIDI receives the actual user-facing channel
shown in the timeline.

The built-in synth is a monitor and may internally remap events only
to work around General MIDI/DLS percussion behavior. That remap stays
behind the monitor boundary; do not change
`ChannelHocketPlaybackEvent.channel`, MIDI debug channel numbers, or
external CoreMIDI bytes to satisfy DLS synth limitations.

If the marker says channel 3, the local monitor must play the channel
3 voice assignment, even if it routes percussion through a bus-local
GM drum channel internally. MIDI debug rows show the monitor voice
route for each sent note so you can verify channel marker, channel
color, and built-in synth sound are all following the same user-facing
channel identity.

---

# Part XIII — Built-in Synth And MIDI Routing

## 70. The Virtual MIDI Port

On launch, Caesura creates a virtual CoreMIDI output port named
**Caesura MIDI**. Any macOS audio application can receive from it:

- In Ableton Live, enable the input named "Caesura MIDI" in MIDI
  Preferences, then select it as a track's input.
- In Logic Pro, route via External Instrument.
- In Max/MSP, use `midiin` with the port name.
- In a MIDI monitor, watch raw bytes.
- For hardware, route via your audio interface or a USB-MIDI box.

To send directly to a real destination (a hardware interface, an IAC
bus, or another app's virtual input) instead of relying on the receiver
to listen to the virtual source, pick it under Setup → MIDI →
Destination. The virtual "Caesura MIDI" source stays alive as the app's
identity, and the chosen destination receives the same byte stream. The
choice is remembered per machine and reconnects automatically when the
device reappears; if it is missing, Caesura falls back to the virtual
source and shows a warning chip in the top bar.

The virtual port is the canonical output. The built-in synth is a
local monitor, not the canonical sound.

## 71. The Built-In Synth

The built-in synth is a convenience monitor implemented over macOS's
DLS general-MIDI synth. Each user-facing MIDI channel can be melodic or
percussion, with its own GM program or drum key.

```
+----- Built-in Synth Properties -----------------------+
|  Channel 1   [ Melodic ]   Program: Acoustic Grand     |
|  Channel 2   [ Melodic ]   Program: Tubular Bells      |
|  Channel 3   [ Melodic ]   Program: Pizzicato Strings  |
|  Channel 4   [ Percussion] Drum key: Snare Drum 1      |
|  Channel 5   [ Melodic ]   Program: Choir Aahs         |
|  ...                                                   |
|                                                        |
|  Channel preset: [ load ] [ save ]                     |
+--------------------------------------------------------+
```

Routing rule (current implementation): each user-facing channel owns a
dedicated local DLS synth bus. This avoids cross-channel program-state
bleed in the monitor and keeps channel color, channel number, and sound
assignment stable across playback runs.

- Melodic voices play on channel 1 of their dedicated bus with the
  configured GM program.
- Percussion voices play on the GM drum channel inside their dedicated
  bus, with the channel's configured drum note substituted.
- User channel 10 is no longer special at the app identity layer. If
  it is melodic, it plays on channel 1 of its own bus; if it is
  percussion, it plays on the drum channel of its own bus.

This routing is monitor-local. External CoreMIDI bytes and the
`ChannelHocketPlaybackEvent.channel` always carry the user-facing
channel exactly.

## 72. Synth Voice Changes During Playback

If built-in synth channel voices change while transport is playing, the
scheduler clears realized future events and re-realizes from the
current cycle. Already-queued future channel markers must not survive a
monitor voice change, because they would describe the old
channel-to-sound contract.

Unchanged voice commands are no-ops. The same rule applies to
unchanged rhythm playback commands: the scheduler compares against the
last requested playback config, not the mutable runtime config, so
history seed pools can evolve internally without making identical UI
resends clear the live queue.

## 73. The MIDI Debug Log

The MIDI debug panel shows a capped 1000-row ring of outgoing MIDI
events. Each row includes:

- Sequence number
- Tick
- Status byte (decoded)
- User-facing channel
- Note / value bytes
- A `debug_source` label so transport cleanup messages can be
  distinguished from normal queued note dispatch
- Monitor voice route (so you can verify channel marker, channel color,
  and built-in synth sound match)

The debug log is diagnostic only. It reports what transport actually
sent. Use it when the audio and the timeline appear to disagree.

---

# Part XIV — Patch Files, Autosave, Recovery

## 74. The Patch File

Caesura's project file is a `.caesura` patch (internally a
`SequencerPatchDocument` schema version 6 document in pretty JSON). A patch can
carry global references and up to 16 parallel track slots. The track strip can
switch, add, copy, rename, mute, solo, export, and remove any track. Removing a
track requires confirmation and offers a save-track option before deletion. BPM
and cycle length can follow the global reference or be custom per track. The top
transport bar
contains global BPM and global cycle controls; the project Channel Logic strip
sits beneath it and above the track tabs; the row under the tabs contains the
active track's follow/custom BPM, follow/custom cycle, and automation
controls. Track tabs show tiny BPM text only when a track has custom tempo or
custom tempo automation, including the automated BPM range when available.
Timeline editing and preview focus the active track, and the timeline readout
names which track is shown. Track tabs can be switched during playback as a view
change without rewriting the running transport. Transport playback merges all
audible tracks when more than one tab is active after mute/solo filtering.
Same-channel MIDI notes with overlapping spans use the project channel logic;
when Priority is selected, the track strip exposes the exact winning order for
colliding tabs. The Channel logic rule list can override the default operator
for an individual track pair on one or more shared MIDI channels, so that
track/channel intersection can use a compact musical subset. Project defaults
offer Layer all, Random one, Alternate, Priority, One only, Overlap only, All
tracks, Majority, and Minority. Pair/channel rules offer Layer, Mute overlap,
Random one, Alternate, and Priority.
Channel Logic builds its shared-channel list from each track's possible output:
the static output channel when hocketing is off, or the hocket entry selectors,
Markov destinations, and fallback channels when hocketing is on.
Channels that are configured but cannot collide yet remain visible as inactive
chips, with labels explaining whether a track's hocket is off or that the
channel is not routed by the current entry, transition, or fallback weights.
If two rows assign different operators to the same track pair and MIDI channel,
Caesura marks the conflict, shows a transport warning explaining why Play is
blocked, and blocks playback until one of the rules is fixed.
Use the `i` button in the Channel Logic header for an inline reference covering
collision scope, default versus pair-rule evaluation, and each logic mode.
Collision decisions operate on final note groups, so a suppressed
group removes its note-on and note-off together, and overlapping duplicate
channel/pitch notes are protected from premature note-offs. Parallel playback uses the global BPM and
global cycle as its reference clock; custom tracks map their own BPM, cycle
length, and continuous custom tempo automation against that reference. MIDI debug and the
parallel conflict debug table expose track ID/name, conflict policy, conflict
action, and conflict group ID for checking why a group passed or was suppressed.
A patch records the complete working sequencer surface:

- Transport tempo and base values.
- Synth toggle and built-in synth voice settings.
- Built-in synth channel voices.
- Global / rhythm / pitch / channel seed strategy.
- Section boundary topology, gati/jathi weights, accent ranges.
- Editor panel open/closed states.
- Single-parameter modulation mode.
- Markov rhythm matrices.
- Pitch Shaper state, channel accent-routing rules.
- Rhythm seed mode and history.
- Extrapolation/import editor state.
- Gati speed / jathi timing settings.
- Arbitrary subdivision settings.
- Rhythm articulation state.
- Ratchet, ornament, and Cycle Flux settings.
- Channel Shaper state.
- Setup preferences (Audio & MIDI Setup).
- MIDI debug visibility.
- A current cycle JSON snapshot for inspection.
- Seed paths.

This is more than a preset; it is the full sequencer surface, which is
why it is described as a patch rather than a score.

## 75. Save, Recall, Save As

The transport bar keeps these controls minimal:

- **Save** — writes to the current patch path when one is known. Disabled
  if the current state is unchanged from the last save.
- **Recall** — prompts for a patch file and rehydrates the working
  surface.
- A compact **autosave toggle / status pill** with the current file
  name and saved/unsaved state.

The macOS File menu exposes:

- New Patch
- Save Patch
- Save Patch As (always prompts for a new `.caesura` path)
- Recall Patch
- Recall Most Recent Patch
- Export Cycle JSON
- Toggle Autosave Recovery

## 76. Autosave Recovery

Autosave is recovery state, not a replacement for explicit saves.

- Autosave writes a temporary `.caesura` recovery file at a fast
  interval (the interval is editable in Setup → Files).
- Autosave clears after every explicit save.
- On startup, Caesura checks a previous-session marker in local
  storage. If the previous session ended cleanly, the autosave file is
  cleared.
- If the previous session ended uncleanly, Caesura prompts before
  loading the autosave. Declined or invalid recovery clears the
  temporary file.
- Normal startup then falls back to File → Recall Most Recent Patch
  behavior when recent-session autoload is enabled.

Startup must never silently apply autosave over a remembered recent
patch.

## 77. Export Cycle JSON

Export Cycle JSON is separate from patch save because a cycle
(`.cseq.json`) is a lower-level artifact. It cannot represent every UI
or editor setting — only the structural cycle data. Use Export Cycle
when you want to inspect the structural representation or share with
another tool. Use Save Patch for everything else.

---

# Part XV — Setup And Native Menus

## 78. The Audio & MIDI Setup Dialog

Open from the macOS Setup menu. The dialog is preference-like and stays
utilitarian:

```
+----- Audio & MIDI Setup -------------------------------+
| ( Audio )  ( MIDI )  ( Files )                         |
|                                                        |
| AUDIO                                                  |
|   Built-in synth monitor   [ on / off ]                |
|   System audio output:     "MacBook Pro Speakers"      |
|   Monitor voice count:     16                          |
|   [ Open Synth Properties... ]                         |
|                                                        |
| MIDI                                                   |
|   Destination:  [ Virtual port only (default)  v ]     |
|                 Sending on the virtual port only.      |
|                 [ rescan ]                             |
|   Default static MIDI channel: [ 1 ]                   |
|   Virtual CoreMIDI source:    "Caesura MIDI"           |
|   Channel Shaper:    [ Open Channel Shaper ]           |
|   MIDI debug visibility:      [ on / off ]             |
|   [ MIDI panic ]                                       |
|                                                        |
| FILES                                                  |
|   Autosave recovery:          [ on ]                   |
|   Autosave interval (sec):    [ 3 ]                    |
|   Recent-session autoload:    [ on ]                   |
|   Project state: Untitled  ( unsaved )                 |
|   [ Save As ] [ Export Cycle ]                         |
|   [ Clear Recovery ]                                   |
+--------------------------------------------------------+
```

Backend-fixed details such as "default macOS audio output" and "virtual
CoreMIDI source" appear as readouts rather than pretending to be
selectable device menus.

## 79. The Seed Strategy Dialog

Open from Setup → Seed Strategy. This is the single editable surface
for seed preferences. Inline panels show summaries and shortcuts but
do not duplicate seed inputs. The dialog's tabs are described in §17.

## 80. Native Menus

```
File
  New Patch                           (cmd-N)
  Save Patch                          (cmd-S)
  Save Patch As...                    (cmd-shift-S)
  Recall Patch...                     (cmd-O)
  Recall Most Recent Patch
  Export Cycle JSON
  Toggle Autosave Recovery

Setup
  Audio & MIDI Setup...
  Seed Strategy...

View
  Toggle Rhythm Shaper

Playback
  Reset Timeline Sync
  Built-in Synth Properties...
  Toggle Built-in Synth
```

Native menu items are emitted as `native_menu_action` events that React
listens to, so menu commands reuse the same save/recall/export/autosave,
setup, and UI-toggle handlers as the visible controls.

## 81. Cycle-Structure Edits During Playback

During playback, controls that can rebuild already-realized timing —
beats/cycle, section boundary topology, automation edits — are
disabled or no-op with a short status message. The scheduler can resync
safely, but the UI steers users toward stopping before structural
edits. This is part of the same parity contract that keeps the timeline
trustworthy.

---

# Part XVI — Debugging And Diagnostics

## 82. Three Diagnostic Surfaces

Caesura exposes three diagnostic surfaces, each capped at 1000 rows and
each driven by the same transport snapshot data the timeline uses:

- **MIDI debug log** (§73) — outgoing MIDI events the scheduler
  dispatched.
- **Automation playback log** (§36) — automation samples the transport
  consumed beat-by-beat.
- **Ratchet rail and event rings** (§28, §48) — ratchet, ornament, and
  pitch playback rings.

Each ring is exposed via `TransportSnapshot` DTOs and rendered in
selectable-depth tables under the timeline. All three are diagnostic;
none of them changes playback. They exist because they let you confirm
that what the timeline says is what transport actually sent.

## 83. Reset Timeline Sync

Playback → Reset Timeline Sync clears the scheduler queue, releases the
notes the rebuilt stream will not close, and re-realizes from the
current cycle. Use it if you ever suspect the timeline and audio have
drifted, for example after a heavy parameter change during playback.
Reset Timeline Sync is the safe button — it never destroys patch data,
only the in-flight queue.

## 84. MIDI Panic

Playback → MIDI Panic (`⌘.`), also on the Setup dialog's MIDI tab,
silences everything: explicit note-offs for every sounding note plus an
all-notes-off sweep on all 16 channels, and the built-in synth. Unlike
Stop, it does **not** stop the transport — the playhead keeps moving and
the next cycle sounds normally. Use it to clear a stuck note from a
hardware synth mid-performance.

## 85. Common Symptoms And First Steps

| Symptom | First step |
|---|---|
| Timeline shows gati 7 but audio sounds like gati 4 | Reset Timeline Sync. If persistent, file as a timeline-parity bug. |
| Channel marker says 3, monitor plays a different sound | Check MIDI debug row's monitor voice route. If they disagree, it's a routing bug; external CoreMIDI bytes are still correct. |
| No MIDI in Ableton Live | Confirm "Caesura MIDI" virtual port is enabled in Live's MIDI prefs. |
| Ratchet rail empty during playback | Confirm ratchet power is on and base chance > 0. Check probability modifiers and cooldown. |
| Automation lane created but no audible effect | The target may be in the broader registry but not yet evaluator-applied. See §35. |
| Playback won't start | Automation may be locked while the preview refreshes. Wait one beat, then retry. |
| Notes stuck after a patch change | Press MIDI Panic (`⌘.`), or the MIDI panic button in Setup → MIDI. |
| Boundary won't fire | Check the max-section cap. Cap of 1 means no boundaries fire. |
| Jathi never resolves | Check that at least one weighted jathi tiles the resolved section. Invalid jathi options are dimmed in the panel. |

---

# Part XVII — Theory Background

This part is a short, opinionated primer for users who have not yet
absorbed gati / jathi / tala in practice. It is intentionally not a
Carnatic textbook — Reina's PhD thesis *Karnatic Rhythmical Structures
as a source for new thinking in Western Music* is one canonical
reference for deeper study.

## 86. Tala

A tala is a fixed cyclic rhythmic structure. Adi tala, the most common,
has 8 beats per cycle. Rupakam has 3 (or 6 depending on speed
convention). Misra chapu has 7. The cycle is repeated indefinitely as
the unit over which compositions and improvisations articulate.

Caesura's "cycle length in beats" is its tala equivalent. The app
does not model the specific clap/wave gestures of tala, but it does
model the cycle as a first-class object.

## 87. Gati — Subdivision Of The Beat

Gati is the number of equal matras inside each beat:

- **Tisra** — 3 matras per beat.
- **Chatusra** — 4.
- **Khanda** — 5.
- **Misra** — 7.
- **Sankirna** — 9.

Caesura also exposes 6 and 11 because they are useful in modern
practice. Gati is per-section, not per-cycle, which is one of the
defining ways Caesura is not a generic 16-step grid.

## 88. Jathi — Accent Pulse

Jathi is a regular accent pulse measured in matras. Allowed jathi
values are `3, 4, 5, 6, 7, 9, 11`. A jathi is valid for a resolved
section only if it tiles that section's total matra count exactly and
does not merely duplicate the gati beat-start pulses.

```
3-beat section in chatusra: 3 * 4 = 12 matras total.
  jathi 3 — valid (12 % 3 = 0)
  jathi 5 — invalid (12 % 5 != 0)
  jathi 4 — invalid in chatusra (lands only on beat starts)
```

Jathi crosses the gati grid at points other than beat starts. That
"crossing" is what gives jathi its musical character.

## 89. Anuloma / Pratiloma — Speed

Anuloma multiplies the number of matras in a beat (`x 2`, `x 3`, `x 4`).
Pratiloma spreads the matras of a gati across multiple beats (`x 1/2`,
`x 1/3`, ...). Each speed has its own felt identity.

Reina stresses that speed changes traditionally resolve on tala sam
(cycle start) and last at least one tala cycle in classical
formulation. Caesura's gati speed / jathi timing controls preserve the
native gati identity in the label, but allow speed weights to be set
per gati and per jathi context — see §38.

## 90. Markov Grouping And Western Reception

The Markov rhythm engine is Caesura's own layer, not a Carnatic
inheritance. It exists because:

- Real Carnatic compositions exhibit strong recurring sub-patterns
  within tala cycles.
- Western generative music has a long history of Markov / first-order
  / second-order models.
- The combination of a Carnatic structural skeleton (cycle, beats,
  gati, jathi) with a Markov articulation layer turns out to express a
  surprising range of behaviors with relatively few controls.

The engine is intentionally agnostic about Carnatic vs. Western
provenance for the patterns it produces. It's a tool. What you do with
it is up to you.

---

# Part XVIII — Tutorials And Worked Examples

This part is a sequence of complete, start-to-finish exercises. Each
one builds on the last. They are meant to be done at the app, but they
read as a printed walkthrough too. Each tutorial states what you should
end up hearing and what to look for in the timeline.

If you only ever finish Tutorial 1, you will already have produced a
Caesura piece. The later tutorials introduce specific features in the
context of a small concrete goal.

## 91. Tutorial 1 — Two-Section Probabilistic Cycle

**Goal.** A short, 8-beat cycle that usually plays its first half in
chatusra (gati 4) and its second half in misra (gati 7), but
occasionally stays in chatusra for the entire cycle.

**Setup.**

1. New patch (File → Save Patch As to give it a name; we'll save
   later).
2. Cycle Setup: Beats/cycle = 8, Pitch = 60, Velocity = 96.
3. Sections and Subdivisions: initial gati weights = `0 4 0 0 0 0 0`
   (only g4 enabled).
4. Boundary rail: click after beat 4. Set its chance to 70%.
5. Open the boundary detail. Set its gati weights to `0 1 0 0 3 0 0`
   (g4 has weight 1, g7 has weight 3 — most fires land on g7).
6. Max-section ladder: weights for cap 2 = `2`, cap 1 = `1`. Sometimes
   the boundary will be capped out before it can fire.
7. Built-in synth: on. Play.

**What you should hear.**

Most cycles, the first four beats sound a steady chatusra (four
matras per beat); the last four beats sound misra (seven per beat).
Occasionally the boundary will be capped out and the whole cycle stays
in chatusra. Once in a while the boundary fires but lands back on
gati 4, in which case beats 5-8 keep the same gati but you'll see the
new section start marked on the timeline.

**What to notice in the timeline.**

- Section dividers move depending on whether the boundary fired.
- Beat 5 gets a section-start extra accent when a new section starts
  there, regardless of gati.
- The boundary marker on the rail keeps its position even though the
  outcome varies.

**Variations to try.**

- Change boundary chance from 70% to 30% and watch behavior become
  less predictable.
- Add a second boundary after beat 6 with chance 40% and gati weights
  for g4 and g5. Now realizations can have up to three sections.

## 92. Tutorial 2 — Jathi Across A Section

**Goal.** A five-beat section in chatusra that hosts a jathi 5 accent
pulse — the classic "5 over 4" feeling.

**Setup.**

1. Continue from Tutorial 1 or open a fresh patch.
2. Cycle Setup: Beats/cycle = 5.
3. Initial gati weights: g4 = `5`, everything else `0`.
4. Initial jathi weights: j5 = `3`, j4 = `0` (j4 only duplicates gati
   beat-starts in chatusra, so it would be dimmed anyway).
5. Sections and Subdivisions → Probability and accents bar → Jathi mode =
   Override gati.
6. Velocity Accents: beat-start center `+10` margin `2`, section-start
   extra center `+8` margin `2`, jathi-start center `+18` margin `4`.

**What you should hear.**

A steady chatusra (`5 * 4 = 20` matras total) with a loud jathi 5
accent pulse: jathi accents land every five matras (positions 1, 6,
11, 16), so they cross gati beat-starts at unpredictable-feeling
points.

**What to notice.**

- The jathi pulse lane shows four amber blocks tiling the section
  (four blocks of five matras each = 20).
- Jathi accent overrides gati accent at collisions; section-start
  extra accent still applies.

**Why jathi validity matters.** Try changing Beats/cycle to 4. Now the
section has `4 * 4 = 16` matras. `16 % 5 != 0`. Jathi 5 is invalid
for this section — the Section jathi accent weights will dim j5. The
section will have no resolved jathi. This is the engine refusing to
author an irregular jathi tiling. It is the correct musical rule.

## 93. Tutorial 3 — Markov Rhythm Inside Jathi Spans

**Goal.** Take Tutorial 2's resolved section (5 beats chatusra with
jathi 5) and add Markov rhythm grouping inside each jathi pulse span,
so the rhythm row partitions the 5-matra jathi spans with
recognizable subgroups.

**Setup.**

1. Continue from a working version of Tutorial 2.
2. Open Rhythm Shaper → Patterns.
3. Span Length: select `5`.
4. Select states: enable `[5]`, `[1, 4]`, `[2, 3]`, `[3, 2]`,
   `[1, 1, 3]`, `[2, 1, 2]`.
5. Matrix order: first.
6. Matrix weights: give `[5] -> [5]` weight 1, `[5] -> [2, 3]` weight 3,
   `[2, 3] -> [3, 2]` weight 3, `[3, 2] -> [1, 1, 3]` weight 2, and so
   on — author a small chain that doesn't sit forever on `[5]`.
7. Fallback: static `[5]`. (If the chain ever has nowhere to go, it
   plays one long held note for the span.)
8. Transport bar: Rhythm = on. Play.

**What you should hear.**

Each five-matra jathi pulse span subdivides into a small ordered
pattern from your selected set. Across many cycles, the engine moves
through patterns according to your transition weights. The jathi
pulse lane remains regular (four equal amber blocks) even though the
rhythm row varies inside each block.

**What to notice.**

- The rhythm row shows amber partitions (jathi-span layer is active).
- If the chain hits a state with no outgoing edge, you'll see a
  fallback marker — the rhythm cell flags as red.
- The same matrix is reusable; switch the global seed mode between
  Locked, Per-cycle, and History to feel the difference.

**Variation.**

Switch the rhythm seed to History mode in the Seed Strategy dialog.
Set new-seed weight to 2 and history weight to 3 with max history 5.
Listen across 10-20 cycles. You should hear some patterns recur,
others arrive fresh, and the piece settle into a personality.

## 94. Tutorial 4 — Ratchet As Articulation, Not Decoration

**Goal.** Add ratchet to the cycle so it triggers on the longer
rhythm cells — the long held notes — but not on the short ones.

**Setup.**

1. Continue from Tutorial 3.
2. Open Rhythm Shaper → Ratchet.
3. Ratchet Power: on.
4. Base chance: 40%.
5. Slow-note modifier: threshold = 2 matras (anything >= 2 matras
   counts as slow). Multiplier: `x 2`. Now slow notes ratchet 80%
   of the time.
6. Fast-note modifier: threshold = 1 matra (anything <= 1 matra
   counts as fast). Multiplier: `x 0`. Fast notes never ratchet.
7. Rate: strategy = audible hits per second. Min 8, Max 16.
   Distribution: toward median.
8. Time curve: keep default even spacing.
9. Span Gate: Multi-matra on. Global max span = 3 matras.
10. Cooldown: basis matras, value 1.5.

**What you should hear.**

Long held cells (the `[5]` whole-span and the trailing `3` in
`[2, 3]`) now ratchet into rapid repeated hits. Short cells
(`1` cells in `[1, 4]`, `[1, 1, 3]`, `[2, 1, 2]`) pass through cleanly.
The result is articulated rather than uniformly busy.

**What to notice.**

- The ratchet rail draws amber duration bars where ratchet fires, with
  per-hit ticks revealing the chosen contour.
- Ratchet count varies cycle to cycle. The hits-per-second window
  bounds density even when tempo changes.
- Slow-note threshold uses matras here. Switch it to "% of one beat"
  to see how the same control reshapes when the tempo changes.

**Variation.**

Change Time curve presets: weight even = 1, accelerando = 3. Now
ratchets tend to feel like they're rushing forward. Switch to
retardando = 3 and they feel like they're winding down.

## 95. Tutorial 5 — Ornaments For Phrase Shaping

**Goal.** Add grace-note ornaments to selected beats and a delay to
others, to shape phrases beyond the steady matra grid.

**Setup.**

1. Continue from Tutorial 4.
2. Open Rhythm Shaper → Ornaments.
3. Ornaments Power: on.
4. Grace Notes tab:
   - Probability: 20%.
   - Count weights: single = 3, double = 1, triple = 0.
   - Placement: before beat = 70%, on beat = 30%.
   - Duration: 25 ms (the grace flicks).
   - Cooldown: matras 2.
   - Probability modifiers: section-start modifier `+ 10%` (grace
     notes are slightly more likely at section starts).
5. Delay tab:
   - Probability: 15%.
   - Basis: % of beat. Min: 5%. Max: 25%.
   - Sampling: unquantized + uniform.
6. Press Play.

**What you should hear.**

Occasional grace-note flicks land before the principal beats, more
often at section starts. A subtle delayed onset shifts the principal
attack slightly later sometimes, shortening the principal note
without overlapping the next one. Together they make the rhythm feel
human.

**What to notice.**

- The ratchet rail now contains rose diamond marks for grace notes
  (before-beat anchored on the right edge) and cool blue offset
  brackets for delays.
- Tied cells receive at most one ornament for the whole tied group;
  the engine never attaches separate ornaments to tie-in cells.
- Cooldown prevents ornament pile-up.

**Variation.**

Set grace-note placement to before beat = 100% and try Triple count
weight = 2. You'll get more elaborate grace-note groups landing right
before the beat.

## 96. Tutorial 6 — Pitch Shaping Inside A Mode

**Goal.** Constrain pitches to a Messiaen T2 mode and add gentle
probabilistic transposition.

**Setup.**

1. Continue from Tutorial 5.
2. Open Pitch Shaper.
3. Range: C3 to C5.
4. Limited-transposition collection: T2. Press Materialize.
5. The grand staff shows the T2 pitch set as noteheads. Optionally
   toggle individual noteheads if you want a custom subset.
6. Markov order: first.
7. Matrix: give each transition equal weight 1 to start (simple
   uniform Markov over the set).
8. Boundary policy: nearest. Modulo interval: 12.
9. Transposition: mode = stair-step, value = +5 semitones, probability
   = 12% per beat.
10. Ratchet pitch behavior: keep source pitch.
11. Ornament pitch behavior: per-grace-note probabilistic.
12. Pitch Shaper power: on. Play.

**What you should hear.**

The melodic line stays inside T2 most of the time. Occasionally the
stair-step transposition shifts the line up five semitones; over
several cycles, the pitch center walks. Ratchet hits stay on the
source pitch (so a single ratchet burst is on one pitch), while
grace notes occasionally pick a different pitch from the set per
grace note.

**What to notice.**

- The pitch lane shows muted violet marks at the heights of the
  resolved pitches.
- After several cycles the stair-step rises beyond the original
  range and the boundary policy (`nearest`) snaps it back. With
  `wrap` it would wrap; with `reflect` it would bounce.
- Transposition doesn't drive Markov memory by default — the chain
  keeps its previous "logical" state.

## 97. Tutorial 7 — Channel Hocketing Across Three Synths

**Goal.** Distribute audible notes across three channels so the
result sounds like three instruments alternating, then add an accent
routing rule that sends loud notes to a fourth channel.

**Setup.**

1. Open Channel Shaper.
2. Enable channels 1, 2, 3, and 4.
3. Open Built-in Synth Properties and set:
   - Ch 1 = Acoustic Grand
   - Ch 2 = Pizzicato Strings
   - Ch 3 = Choir Aahs
   - Ch 4 = Tubular Bells
4. Channel matrix (first order):
   - `1 -> 2` weight 3, `1 -> 3` weight 1
   - `2 -> 1` weight 2, `2 -> 3` weight 2
   - `3 -> 1` weight 1, `3 -> 2` weight 3
5. Fallback: static channel 1.
6. Accent Routing: add a rule `velocity 110..127 -> channel 4 weight 3`.
   Mode: render only (loud notes go to channel 4 but the chain keeps
   its underlying state).
7. Channel Shaper Power: on. Play.

**What you should hear.**

Notes alternate between three voices (piano, strings, choir) in a
fairly stable pattern derived from the matrix. Loud accent notes — the
beat-start and section-start matras — jump to channel 4 (tubular
bells) without disrupting the underlying three-voice chain.

**What to notice.**

- The channel lane shows each note's final user-facing channel as
  colored markers with channel numbers visible.
- Even when accent routing rewrites a marker, the chain's previous
  state stays on the underlying three voices, so subsequent
  transitions don't pile up on channel 4.
- Switching Accent Routing mode to "drive chain" makes channel 4 a
  real state in the chain. The hocketing behavior changes
  significantly.

## 98. Tutorial 8 — Automation Across A Long Form

**Goal.** Author a 16-cycle form in which base pitch climbs slowly,
ratchet chance rises and falls, and the section count cap
intensifies before resolving back.

**Setup.**

1. Open the Automation panel.
2. Set Automation length to 16 cycles.
3. Add a target: `sequencer.pitch`. Default lane is a two-point
   start-and-end at value 60. Drag the end point up to 72.
4. Add a target: `sequencer.sectionCount.3.weight`. Set:
   - Point at 0/1 = 0
   - Point at 1/3 = 4
   - Point at 2/3 = 2
   - Point at 1/1 = 0
5. Add a global marker at 50% labeled "midpoint" and another at 75%
   labeled "wind down".
6. Save the patch (Cmd-S).
7. Play.

**What you should hear.**

Over 16 cycles, the base pitch climbs an octave. The likelihood of
three sections per cycle rises in the middle of the form and falls
toward the end — a structural arc.

**What to notice.**

- The Automation playback debug table shows the sampled values per
  beat. Watch them shift cycle to cycle.
- Stop, change the Automation length from 16 to 32. All point times
  stay the same (exact rationals). The arc is now twice as slow but
  the same shape.
- Many ratchet/ornament/pitch/channel targets are in the broader
  registry but not yet evaluator-applied (see §35). Cycle-level
  targets like pitch and section count weights take effect
  immediately.

## 99. Tutorial 9 — A Complete Short Piece

**Goal.** Combine everything from Tutorials 1-8 into one patch and
save it. The result is a small Caesura composition.

**Setup.**

1. Start from any earlier tutorial.
2. Adjust Beats/cycle to 16 for a longer feel.
3. Author three boundaries (after beats 4, 8, and 12) with chances
   60%, 40%, 50%. Boundary gati weights mix g4, g5, g7.
4. Initial gati: g4 = 3, g7 = 1.
5. Markov rhythm matrices for spans 4, 5, and 7, each with about
   six selected states and authored transitions.
6. Ratchet base chance 30% with slow-note `x 1.5` and fast-note
   `x 0.2`.
7. Grace notes 15%, mostly before-beat single.
8. Pitch Shaper constrained to T2 with `nearest` boundary policy.
9. Channel hocketing across three channels with accent routing to a
   fourth.
10. Automation: pitch arc from 60 to 67 to 60 over 12 cycles.
11. Seed: per-cycle global, per-cycle rhythm follow-global, ratchet
    locked at a chosen seed.
12. Save Patch As "first piece.caesura".
13. Play.

**What you should hear.**

A piece. Not infinite, not trivially repetitive — a specific
relationship between rhythm, pitch, and routing that develops over
12+ cycles before resetting. Replay the patch (Recall Patch). Press
Play. The piece reproduces exactly because seeds and history are
locked into the patch file.

This is the result Caesura is for: stochastic in process, repeatable
in outcome, structurally legible at every moment.

---

# Part XIX — A Worked Realization Example

This part is for the curious. It walks one specific cycle through the
realization pipeline step by step, with concrete numbers. You do not
need to read it to use the app. It exists because seeing the pipeline
concretely makes the rest of the manual click.

## 100. The Inputs

We start from this score request:

```
Cycle length:     6 beats
Base pitch:       60
Base velocity:    96
Initial gati:     g4 = 1, g5 = 1
Initial jathi:    j3 = 1, j5 = 1
Max sections:     cap 2 weight 3, cap 1 weight 1
Boundary list:
  after beat 3, chance 50%, gati g4=1 g5=2, jathi j3=1 j5=1
Velocity accents:
  beat-start    center +10 margin 2
  section start center +8  margin 1
  jathi-start   center +14 margin 3
Single-param rhythmic modulation: off
Seed mode:        Locked global, base seed 12345
```

## 101. Pass 1 — Sample Automation At Cycle/Beats

We have no automation lanes for this realization. The evaluator returns
no overrides. Skip.

## 102. Pass 2 — Roll Max-Section Cap

The cap weights are `{2: 3, 1: 1}`. The seeded RNG samples
proportionally. With seed 12345 and the deterministic sampling order,
the cap rolls 2. So at most one boundary may fire.

## 103. Pass 3 — Roll Boundaries Left To Right

There is one boundary (after beat 3, chance 50%). With the cap not yet
reached, the RNG rolls. Say the roll is 0.32 — under 0.50, so the
boundary fires. The cap is now reached (1 fired, cap of 2 - 1 = 1
boundary maximum). No further boundaries to consider.

Section topology:

- Section 0: beats 1-3.
- Section 1: beats 4-6.

## 104. Pass 4 — Resolve Gati Per Section

Section 0 uses initial gati weights `{g4: 1, g5: 1}`. RNG samples; say
it picks g5. Section 0 has gati 5.

Section 1 uses the boundary's gati weights `{g4: 1, g5: 2}`. RNG
samples; say it picks g5. Section 1 has gati 5.

Note: same gati on both sides of the boundary, but the boundary still
fires and section 1 is a new section. Section-start accents apply at
beat 4.

## 105. Pass 5 — Resolve Jathi Per Section

Section 0 has `3 beats * 5 matras = 15` matras. Candidate jathi from
initial weights `{j3: 1, j5: 1}`:

- j3: `15 % 3 = 0` valid. Non-trivial: `3 % 5 != 0` (jathi doesn't
  duplicate beat-starts) → valid.
- j5: `15 % 5 = 0` valid. Non-trivial: `5 % 5 == 0` — every jathi
  pulse would land on gati beat starts. j5 is trivial in this
  section and is rejected.

Only valid jathi for section 0 is j3. The engine picks j3.

Section 1 has the same structure. Engine picks j3.

## 106. Pass 6 — Emit Pulse Spans

Section 0:

- 1 section span (15 matras).
- 3 gati beat spans (5 matras each).
- 5 jathi pulse spans (3 matras each, tiling 15).

Section 1: identical structure.

Total cycle: 30 matras. The active accent span layer is jathi (since
jathi resolved), so jathi pulse spans are protected.

## 107. Pass 7 — Apply Velocity Accents

For each matra cell:

- Matra 1 of each beat → gets a beat-start accent. RNG samples a
  margin in `[-2, +2]` and adds it to center `+10`. Say +11. Final
  velocity = base 96 + 11 = 107.
- Matra 1 of section-start beats (beats 1 and 4) → additionally gets
  the section-start extra accent. Say +8. So beats 1 and 4 matra 1
  receive 107 + 8 = 115.
- Matras at jathi pulse starts → jathi accent. RNG samples in
  `[-3, +3]` around +14. Say +12. Resulting accent depends on jathi
  mode:
  - Override gati (default): the jathi accent replaces gati accent at
    collisions. Velocity = 96 + 12 = 108 at the jathi-start matra
    even if it coincides with a beat-start.
  - Layered: 96 + 11 + 12 = 119 at the same collision.
- All other matras keep base velocity 96.

## 108. Pass 8 — Rhythm Pass

Markov rhythm grouping runs over the active accent spans (jathi pulse
spans of length 3). Suppose the span-3 matrix has weights:

```
[3]    -> [3] = 1, [1, 2] = 2, [2, 1] = 1
[1, 2] -> [3] = 1, [2, 1] = 3
[2, 1] -> [3] = 2, [1, 2] = 1
```

The first jathi span (section 0, pulse 1) has no prior state, so the
engine uses the chain entry selector. Say `[3]`.

Subsequent jathi spans follow the chain:

```
span 1: [3]      (initial)
span 2: [1, 2]   (chain: [3] -> [1, 2])
span 3: [2, 1]   (chain: [1, 2] -> [2, 1])
span 4: [3]      (chain: [2, 1] -> [3])
span 5: [1, 2]
span 6: [2, 1]
span 7: [3]
...
```

Each pattern partitions its 3-matra span. The rhythm row in the
timeline draws these partitions in amber.

Articulation runs after this — every cell rolls play/rest/tie
according to its probabilities. Suppose all cells are pure play in
this example.

## 109. Pass 9 — Realize Events

`cseq-realize` walks the deterministic tree and emits note-on /
note-off pairs with rational offsets. Events are sorted by offset;
note-offs sort before note-ons at the same offset.

## 110. Pass 10 — Ratchet Pass

Each candidate note group passes through ratchet probability
modifiers. Suppose ratchet base chance is 0.30, slow-note (>= 2
matras) multiplier is 1.5, fast-note (<= 1 matra) multiplier is 0.

Cells of length 2 trigger the slow-note modifier (1.5x). Running
chance = `0.30 * 1.5 = 0.45`. Cells of length 1 trigger fast-note
(0x), so they never ratchet.

For each 2-matra cell, RNG rolls. If the roll < 0.45, ratchet fires.
Suppose it fires. The rate strategy picks a hit count inside the
configured window (say 4-12 hits). The time curve maps internal hit
positions. Per-hit velocities resolve from the source velocity in
relative mode.

The result is a finalized ratchet event with concrete tick
intervals. The ratchet rail will draw a duration bar with internal
ticks for each hit.

## 111. Pass 11 — Ornament Pass

Each candidate target rolls grace-note probability. If it fires, a
grace-note count is sampled, placement (before / on beat) is sampled,
and grace-note durations are computed. Delays similarly roll
independently.

## 112. Pass 12 — Pitch Shaper Rewrite

If pitch shaping is enabled, the chain walks: each note-on chooses
its pitch from the matrix given the previous pitch state. Boundary
policy applies. Ratchet hits and ornaments resolve their pitches
according to their declared behaviors.

In our worked example, pitch shaping is off. Skip.

## 113. Pass 13 — Channel Hocket Rewrite

If channel hocketing is enabled, the chain walks: each note's final
MIDI channel is resolved from the matrix given the previous channel
state. Accent routing rules can override the rendered channel without
necessarily updating the chain state.

In our worked example, hocketing is off. All notes go on the static
output channel.

## 114. Pass 14 — Cycle Flux Tempo Warp

If Cycle Flux is enabled, the cycle-local timing map warps event
ticks. Cycle start and end remain pinned to exact ticks.

In our worked example, Cycle Flux is off. Skip.

## 115. Pass 15 — Append And Dispatch

The finalized cycle events append to the scheduler queue. The
scheduler dispatches events whose ticks are due to CoreMIDI and to
the built-in synth's monitor buses. Already-finalized future cycles
in the queue are never re-passed.

If the user changes any score parameter mid-cycle, the scheduler
clears queued future events, sends all-notes-off, and re-realizes
from the current cycle (and discards any re-realized events earlier
than the current absolute tick, to prevent stale bursts).

That is the complete realization pipeline for one cycle.

---

# Part XX — Frequently Asked Questions

## 116. Conceptual Questions

**Is Caesura a Carnatic notation system?**

No. It uses Carnatic terms because they carry the concepts the engine
needs — gati for beat subdivision, jathi for accent pulse — but it
does not represent Carnatic notation, sahitya, korvai, or the body of
practice that a real Carnatic musician depends on.

**Is gati the same as a time signature?**

No. A time signature usually expresses both how many beats are in a
measure and what kind of note gets the beat. Gati in Caesura is
strictly the number of equal matras per beat. The cycle's beat count
is a separate control.

**Can I have different gatis on different beats inside the same
section?**

Not within a single section. By design, a section carries one gati
that applies to every beat in the section. To change gati at beat N,
author a boundary after beat N-1; if the boundary fires, beat N
starts a new section that can have a different gati.

**Why must jathi tile?**

Because a jathi that doesn't tile would either leave matras at the
end of the section unaccented, or accent them irregularly. A jathi is
defined musically as a regular accent pulse. An irregular tail is no
longer a jathi.

**Why does a same-gati boundary still start a new section?**

Because sections are first-class events. They can receive accents,
host different jathi tilings, and (eventually) attach transforms and
labels. Inferring sections only by gati changes would lose all that.

**What is the difference between rhythm grouping and ratchet?**

Rhythm grouping is a compositional pass: it decides how a protected
accent span is internally partitioned. The result is part of the
duration tree.

Ratchet is a playback pass: it rapidly subdivides one already audible
note group at dispatch time. The duration tree never changes.

**What is the difference between automation and seed strategy?**

Automation moves editable parameter values over musical time —
deterministic motion. Seed strategy controls how stochastic choices
realize — deterministic or varied draws over the same probability
distribution.

A point on an automation lane changes the underlying value, which then
participates in seeded probability draws. They are orthogonal layers.

**Why is the timeline considered "the truth"?**

Because the preview that draws the timeline and the playback that
sends MIDI both build from the same backend evaluator on the same
request DTO. They cannot drift silently. If they ever appear to, it
is a bug to file, not a difference of opinion between two layers.

## 117. Workflow Questions

**Should I start with the score surface or the Rhythm Shaper?**

Start with the score surface. Get cycle length, gati, jathi, and a
boundary or two working before you reach for Markov rhythm,
arbitrary subdivision, ratchet, ornaments, or pitch and channel
shaping. The score surface is the spine; everything else is a
shaping layer on top of it.

**When should I use Locked seed vs Per-cycle vs History?**

- Use **Locked** when you have a variation you love and want to
  freeze it.
- Use **Per-cycle** when you want each cycle to vary, but you want
  the variation sequence to be reproducible across runs.
- Use **History** when you want a piece to revisit prior good
  variations and also generate new ones.

A common workflow: improvise with Per-cycle, find a variation you
like via seed paths, save the path, and Replay locked.

**Should I edit the timeline or the panels?**

Both. The boundary rail is the primary editor for boundary topology
and chance. The panels are where you set detail — boundary gati and
jathi weights, accent ranges, rhythm matrices, ratchet, pitch,
channel.

A good rule: if a change can be made directly on the timeline (or its
boundary rail), make it there. Otherwise, find the right panel.

**Can I edit cycle length during playback?**

You can, but the UI will discourage it. Cycle-structure controls
that can rebuild already-realized timing are disabled or no-op with
a short status message during transport. Stop, edit, play.

**How do I make the piece sound less mechanical?**

- Per-cycle or History seed mode.
- Velocity accent margins > 0 so accents jitter.
- Ratchet with relative velocity and a non-uniform time curve.
- Grace notes with low cooldown but moderate base chance.
- Cycle Flux with a mild LFO depth (0.05-0.15).
- Single-Parameter Rhythmic Modulation on.

**How do I capture a one-off variation forever?**

After hearing the variation:

1. Stop. Note the cycle index of the variation.
2. Open Seed Strategy → Overview. Inspect the seed log.
3. Mark the corresponding seed path for Replay.
4. Save Patch.

Recall Patch on relaunch will queue the replay automatically.

## 118. Technical Questions

**What is the timing model?**

The model uses exact rationals (`num-rational::Rational`) for cycle
positions. The scheduler converts to PPQN=960 ticks at the scheduling
boundary. This avoids floating-point drift even with deeply nested
subdivisions.

**Can two Caesura instances send MIDI to each other?**

In principle yes — both open virtual CoreMIDI output ports. macOS's
MIDI routing lets you target one instance's output as another's input.
In practice it's unusual; if you need it, route through a tool like
MIDI Studio or Max/MSP.

**Does Caesura support MIDI clock or Ableton Link?**

Not yet. The roadmap lists external sync as a likely future direction
but the project intentionally prioritizes a strong single-channel
sequencer over breadth.

**Does Caesura support audio recording?**

No. It is not a DAW. To record Caesura's output, route the virtual
CoreMIDI port into a DAW or audio host and record there.

**Is the patch file format stable?**

The patch file is versioned (`SequencerPatchDocument`, currently schema version
6). Schema migrations are explicit. Schema version 1 patches load through the
legacy single-track migration, and schema version 2 project files load through
the current migration path. There is no silent breakage.

**Can I read or hand-edit a patch file?**

Yes — it's pretty JSON. Be cautious: fields are interrelated and the
app's validator will reject inconsistent states. If you hand-edit,
keep a backup.

**Can I script Caesura?**

Not directly. There is no scripting language inside the app. You can
manipulate patch files outside the app with any JSON tool, and you
can drive its MIDI output from other apps.

## 119. Troubleshooting Questions

These supplement Appendix G.

**The app won't start the virtual MIDI port.**

Open Audio MIDI Setup → Window → Show MIDI Studio. Confirm no
existing "Caesura MIDI" port is held by a stale process. Restart Caesura.
If it persists, log out / log in to reset CoreMIDI state.

**Notes hang after the app loses focus.**

Press the All Notes Off button in Setup → MIDI. If hangs persist,
file a bug — All Notes Off should be the reliable recovery.

**Timeline and audio disagree.**

The single most important parity bug. Press Reset Timeline Sync
first. If they still disagree, capture: the patch file, the symptom
description, screenshots of the timeline vs the MIDI debug log, and
file the bug. This is the project's highest-priority bug class.

**Patch loads but something is missing.**

The patch may pre-date the field you expect. The patch normalizer is
forgiving — missing fields fall back to defaults. Check the new
default in the relevant panel.

**Performance feels sluggish.**

Try:

- Reduce MIDI debug log visibility (the debug table is cheap but not
  free).
- Disable the built-in synth and route to an external host instead.
- Reduce automation lane count or curve point density.
- Increase the Tempo control's BPM (lower BPM means more time between
  beats and a larger queued event window).

---

# Appendices

## Appendix A — Glossary

- **Accent span.** The active rhythmic interval from one protected
  accent boundary to the next. When jathi resolves for a section,
  jathi pulse spans are active. Otherwise gati beat spans are active.
- **Akshara.** A beat-like unit. The code and UI mostly say "beat."
- **Anuloma.** Faster speed relationship (`x 2`, `x 3`, `x 4`).
- **Arbitrary subdivision.** An optional rhythm-engine pass that
  interprets one protected accent span through a different virtual
  matra count.
- **Beat.** A primary unit inside the cycle. Gati subdivides each beat
  into matras.
- **Boundary.** A possible section break after a beat. If it fires,
  the next beat starts a new section.
- **Channel hocketing.** Final MIDI channel-routing layer that
  distributes audible events across enabled channels with a Markov
  matrix.
- **Cycle.** One loop of the sequencer.
- **Cycle Flux.** A playback-only BPM contour over one full cycle that
  preserves total cycle duration.
- **Duration tree.** The tree of timing spans that determines where
  events can happen.
- **Fallback.** The rhythm-engine state used when a Markov chain has
  no usable transition for the current context. May be static or
  weighted-random.
- **Gati.** The number of matras per beat. The most important term to
  preserve correctly.
- **History seed mode.** A seed mode that can choose prior remembered
  seeds or create new seeds.
- **Inflection.** Backend term for a possible boundary. In the UI,
  prefer "boundary after beat N."
- **Jathi.** A regular accent pulse measured in matras. Must tile the
  resolved section and must not merely duplicate the gati beat-start
  pulse.
- **Markov matrix.** A set of transition weights between rhythm
  patterns for one span length. First-order matrices use the previous
  state; second-order matrices use the previous two.
- **Matra.** A subdivision inside a beat.
- **Ornament.** A playback-only articulation of resolved target note
  groups. Grace notes and delay are the implemented types.
- **Patch.** A `.caesura` file recording the whole working UI state.
- **Pitch shaping.** Final MIDI pitch layer that rewrites note pitches
  after rhythm and playback passes.
- **Pratiloma.** Slower speed relationship (`x 1/2` through `x 1/7`).
- **Protected cut.** A required internal cut inside a rhythm span.
  Chosen Markov patterns and virtual subdivisions must preserve these
  cuts.
- **Pulse span.** A resolved backend span representing a section,
  gati beat, or jathi pulse.
- **Ratchet.** A playback transform that rapidly subdivides an
  already audible note group.
- **Realization.** A concrete result sampled from probabilistic score
  data for a specific cycle and seed.
- **Rhythm pattern.** An ordered list of positive matra lengths that
  exactly fills a protected accent span.
- **Section.** A contiguous span of beats. Each section carries one
  resolved gati.
- **Seed.** A number that makes probabilistic choices reproducible.
- **Tala.** A fixed cyclic rhythmic structure.
- **ValueSpec.** A model type representing fixed, weighted, uniform,
  or modulation-driven values.

## Appendix B — Color And Lane Reference

```
Timeline cell colors
  Neutral (dim)          ordinary matra
  Gold (amber)           beat-start accent cell
  Orange (warmer amber)  section-start extra accent cell
  Green tint             active beat / active section during playback
  Recessed charcoal      empty matrix cell

Rhythm row colors
  Dusty cyan             gati-beat span partitions
  Amber                  jathi pulse span partitions
  Red                    fallback / missing chain
  Low-emphasis hollow    rested cell

Ratchet / ornament rail
  Amber rounded bar      ratchet hit duration
  Rose diamond           grace-note attack mark
  Cool blue bracket      delay onset displacement

Pitch lane
  Muted violet           final pitch mark

Channel lane
  Stable channel color   per-channel via timelineChannelColor mapping
  Pointed silhouette     ratcheted channel event
  Subtle edge / glow     fallback or accent-routed assignment

Matrix heatmap (Rhythm / Pitch / Channel)
  Blue/teal/green        low weight
  Yellow/orange/red      high weight
  Recessed charcoal      empty
```

## Appendix C — Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| New Patch | Cmd-N |
| Save Patch | Cmd-S |
| Save Patch As | Cmd-Shift-S |
| Recall Patch | Cmd-O |
| Play / Stop | Spacebar (when timeline focused) |
| All Notes Off | (button in Setup → MIDI) |
| Show local Automation lanes | Inline subsection automation symbol |
| Open Automation lane for control | Cmd-click / Control-click an annotated control |
| Toggle Rhythm Shaper | View menu |
| Open Setup | Setup menu |
| Open Seed Strategy | Setup menu |

## Appendix D — Channel Cheat Sheet

```
External MIDI:  always carries the user-facing channel (1..16).
Timeline:       always shows the user-facing channel + stable color.
Built-in synth: monitor; routes each user-facing channel to its own
                local DLS bus and may internally remap percussion to
                that bus's GM drum channel.

If you see X on the timeline:
   - External CoreMIDI bytes use X.
   - MIDI debug row's channel column is X.
   - Built-in synth plays the voice configured for X.
   - The visible color tag is the color mapped to X.
```

## Appendix E — Probability Cheat Sheet

```
Weights are relative.
   Weight 0    -> impossible (but visible).
   Weights {3, 4, 5} -> shares {25%, 50%, 25%}.

Boundary chance is a percentage 0..100%.

Max-section cap is sampled first.
   Cap N allows at most N-1 boundaries to fire.

Boundary rolls go left to right.
   Once the cap is reached, later boundaries cannot fire.

Same-gati boundary still starts a new section.
```

## Appendix F — Editable Value Inventory (Summary)

The companion developer/testing inventory is
[`docs/EDITABLE_VALUE_INVENTORY.md`](../EDITABLE_VALUE_INVENTORY.md). It
lists every persisted and editable value family, including dynamic
matrix cells and automation target families. Use it when checking
whether a feature has persistence, preview, playback, and automation
coverage.

The high-level families are:

- Cycle setup (cycle, pitch, velocity, name).
- Initial gati and jathi weights.
- Max-section weights.
- Single-parameter rhythmic modulation toggle.
- Velocity accent ranges (beat-start, section-start-extra, jathi-start).
- Section boundary topology, per-boundary chance, gati and jathi
  weights.
- Markov rhythm matrices per span length (selected states, transitions,
  fallback, weighted fallback).
- Per-cell rest/tie probabilities, rest-over-accent and
  tie-over-accent policies.
- Gati speed weights, jathi timing weights.
- Arbitrary subdivision (probability, target weights, clumps, source,
  weighted pool).
- Ratchet (base chance, all modifiers, rate strategy/window/distribution,
  custom time curve, variance, preset weights, blend mode, span gate,
  internal rhythm, velocity mode/range/center/attraction/same-prob,
  cooldown basis/value, seed).
- Ornaments — grace (probability, count weights, placement, duration,
  rest target, cooldown, velocity, modifiers).
- Ornaments — delay (probability, basis, min/max range,
  unquantized/quantized, distribution, tuplet weights, modifiers).
- Cycle Flux (BPM range, curve, LFO depth).
- Pitch Shaper (range, collection, fallback noteheads, entry selector,
  weighted fallback, Markov matrix, boundary policy, transposition
  mode/value, ratchet/ornament pitch behaviors, seed).
- Channel Shaper (enabled channels, static channel, matrix order,
  matrix weights, entry selector, fallback, accent routing rules,
  ratchet/ornament channel behaviors, seed).
- Built-in synth channel voices (program or drum key per channel).
- Automation set (length cycles, markers, tracks, curves, points).
- Seed strategy (global / rhythm / pitch / channel / ratchet /
  ornaments modes, history pools, paths).
- Setup preferences (autosave, monitor toggle, MIDI debug visibility).

## Appendix G — Troubleshooting Recipes

### "I want to capture this variation forever."

1. Stop playback.
2. Open Seed Strategy → Overview.
3. Find the most recent seed path covering the cycle(s) you liked.
4. Mark the path for replay on the next playthrough.
5. Save Patch As.

The next time you Recall this patch, Replay is queued and the
realization reproduces exactly.

### "I want variation, but keep the rhythm identity."

1. Use seed paths to record one playthrough you like.
2. Wildcard the Pitch and Channel domains in that path.
3. Replay.

Pitch and channel resolve fresh while rhythm stays stable.

### "The piece feels too uniform."

- Enable History or New seed mode on the global stream.
- Reduce history weight, increase new-seed weight.
- Cap history depth lower so new seeds compete more often.

### "The piece feels too chaotic."

- Switch to Locked global mode or Per-cycle mode.
- Lower boundary chances.
- Reduce ratchet base chance.
- Disable arbitrary subdivision.
- Turn on Single-Parameter Rhythmic Modulation for smoother gati/jathi
  transitions.

### "I can't hear ratchet hits I expect to hear."

- Confirm Ratchet → Power is on.
- Confirm base chance > 0.
- Check probability modifiers — multipliers can drive running chance
  to nearly zero.
- Check cooldown — if cooldown is long, eligible note groups may be
  inside the refractory window.
- Check Span Gate — if multi-matra is off, only one-matra notes
  qualify.

### "Pitch shaping doesn't seem to take effect."

- Confirm Pitch Shaper power switch is on.
- Confirm at least one pitch state has a positive weight.
- Confirm the boundary policy isn't snapping every transition to a
  fallback that equals the source pitch.
- Verify the transposition mode and value.
- The pitch lane is playback-snapshot, so check it during transport,
  not while stopped.

### "Channel hocketing seems off-by-one."

- The lane shows the user-facing channel (1-16), not a zero-based
  MIDI status nibble.
- If the monitor sound disagrees with the lane number, check the MIDI
  debug row's monitor voice route column.

---

## Appendix H — Glossary Of Files

For users curious about the project layout:

- `crates/cseq-model/` — pure data structures, automation evaluator.
- `crates/cseq-transforms/` — Subdivision Switch transform, automation
  sampling.
- `crates/cseq-rhythm/` — Markov rhythm engine, ratchet, ornament,
  Cycle Flux, pitch, channel specs.
- `crates/cseq-realize/` — converts trees into scheduled events.
- `crates/cseq-transport/` — playback state machine, scheduler loop.
- `crates/cseq-midi/` — virtual CoreMIDI output, built-in synth
  routing, host-time helpers.
- `crates/cseq-persist/` — patch save/load and schema migration.
- `src-tauri/` — desktop shell, Rust/TS bridge, snapshot emission.
- `ui/` — React/TypeScript frontend.

You do not need to read any of those to use Caesura. They are listed
here because some users will want to inspect what is, after all, a
small open codebase.

---

*End of manual.*

If you find a place where the timeline and the audio disagree, or where
the manual and the app disagree, treat it as a high-priority bug and
file it. Both are aspects of the same parity contract that gives Caesura
its character.
