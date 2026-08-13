# UI and interaction

Dum-Ka is a compact desktop instrument. The timeline is the main truth
display; focused editors expose the authored inputs that produce it. Shared
styling rules remain in [DESIGN_LANGUAGE.md](DESIGN_LANGUAGE.md).

## Screen structure

From top to bottom, the app contains:

1. Masthead, seed-history monitor, MIDI-route status, score ID, and theme toggle.
2. Transport, built-in synth, Global BPM, optional project cycle, and patch
   Save/Recall/autosave status.
3. Channel Logic when more than one track exists.
4. The track/Track Flow strip and active-track settings.
5. The resolved timeline.
6. Automation editor and focused-editor launchers.
7. MIDI, conflict, and automation diagnostics.

The focused editors are **Sections and Subdivisions**, **Generator**,
**Evolve**, and **Channel Shaper**. Only one main editor is open at a time;
closed editors keep small launcher summaries without keeping their expensive
contents mounted.

## Transport and setup

- Play is enabled only after current authored state has a matching ready
  preview/request. Starting and Stopping are explicit acknowledged transitions.
- A terminal generator-preview rejection leaves Play disabled and shows the
  exact reason beside the transport, including while the Generator editor is
  closed. The notice is tagged to its request and cycle, so editing the
  generator, changing tracks/cycles, or disabling it removes stale copy while
  the replacement preview is pending.
- Structural actions are locked through the entire Play/Stop transition, not
  merely while the last snapshot says playing.
- The built-in synth is a monitor; MIDI output remains available independently.
- Global BPM changes the project reference tempo. A track in custom-BPM mode
  keeps its own BPM when the global field changes.
- Audio & MIDI Setup controls destination routing, rescanning, static output
  channel, synth access, MIDI diagnostics, autosave interval, and recovery
  behavior.
- MIDI Panic (`⌘.`) sends explicit release/all-notes-off behavior without
  requiring playback to stop.

## Tracks

The track strip supports up to 16 tracks. The active track exposes name,
mute/solo, global/custom cycle length, global/custom BPM, automation length,
and one of three roles:

- **Parallel**: free-runs with other parallel participants.
- **Triggered**: stays armed until a condition on a continuous source fires.
- **Track Flow**: belongs to a box whose chain selects one member per cycle.

New, copy, import, export, delete, rename, mute/solo, role, and box-membership
actions operate on a current project snapshot. Structure-changing actions are
disabled during transport transitions. Track Flow boxes can be created,
renamed, reordered by membership drag/drop, and edited through a transition
matrix. Each box displays its currently selected member while playing.

Channel Logic is project-level. It explains the default policy, pair/channel
overrides, effective rule, and priority order. The Channel Shaper is different:
it assigns a track's notes to output channels before Channel Logic resolves
collisions.

## Sections and Subdivisions

The first section begins at beat 1. Clicking the boundary rail adds or opens an
authored boundary after an integer beat; that boundary always starts a section.
The detail window edits its position, fixed Subdivision, optional Grouping, or
deletes it.

Subdivision means steps per beat. Grouping is an optional tiling accent cycle.
The editor also owns track name, cycle length, base note and velocity, plus
beat-, section-, and grouping-start velocity accents. See
[SECTIONS_SUBDIVISIONS_LOGIC_SPEC.md](SECTIONS_SUBDIVISIONS_LOGIC_SPEC.md).

## Generator

The included Example editor has one enable switch, Density, seed mode, and seed.
At 100% every structural step sounds; lower density marks seeded steps as
rests. Locked, Per Cycle, and History seed details are centralized with other
seed domains in the Seed Strategy dialog.

The Generator editor's Algorithm select switches between Example and
Dum-Ka; parameters for the inactive kind are preserved. The Dum-Ka side is
a visual rhythm builder over a pattern textarea. The builder renders the
committed pattern as a proportional block tree (block width = share of the
cycle; nested groups show a k:w ratio badge when they play k children in
the time of w beats). Narrow blocks shed detail rather than clip: weight
badges disappear, text shrinks, and a very narrow note block renders a dot
glyph — the full name stays in the block's tooltip and accessible name.
Click selects a block, shift-click extends along
siblings, and a toolbar edits the selection: note/rest/hold type, stroke
name, weight, "split into tuplet" (k equal strokes over the block's span),
identity-weight Group/Ungroup, group Count, nested relative Span, and a
top-level Span gesture that consumes whole following Pattern blocks without
changing the cycle's beat count. Growing replaces the covered blocks;
shrinking leaves rest, and a partial-block endpoint or hold that would be
rebound fails closed. To preserve the material inside every covered beat,
select that sibling range first and Group it before changing Count. The toolbar also offers
optional stylistic **Articulate**, insert, and delete. Cross-span sustains are
legal paired ties, so the editor never demands articulation as a repair.
Selecting a compatible flat group still exposes the gesture when the author
wants detached grid-aligned attacks plus rests; its exact parent geometry is
compiler-preflighted before commit. Every builder edit prints the tree back to notation
and commits through the textarea's own path — the mirrored compiler
re-checks the printed text first and an illegal edit is rejected in place
with the engine's message, so the builder can never author around the
seam. Visual edits rewrite `E(...)`/`*n` sugar, comments, and bar lines in
expanded form (a hint says so whenever the committed text contains them).
Below it sits the pattern textarea itself, which commits on blur or
Cmd/Ctrl+Enter; drafts flush through the shared editor-draft lifecycle before
Save. Instant line/column diagnostics appear while typing, and the backend's
preview error for the committed pattern appears beneath it. A condensed
[DUMKA_DSL.md](DUMKA_DSL.md) syntax reference sits behind the heading's ⓘ
help button. The "Roll a Euclidean seed" cluster (roll number, density, and
plain/bursts/inverted style) writes a rolled per-beat Euclidean cycle through
the ordinary commit path. Plain rolls emit readable `E(k,n,r)` sugar, each
physical beat keeps its exact compiler-visible local slot count rather than
the cycle-wide LCM, and rolls reproduce exactly from their roll number.
Roll stays unavailable until the committed notation parses, because no local
beat grid exists to preserve otherwise.
The required-structure readout's
"Apply structure" button authors the per-beat recipe (pattern beats, the
working Subdivision, no boundaries/Grouping/custom division) through the
ordinary structure state. Below it, the evolution fold documented in
[DUMKA_EVOLUTION.md](DUMKA_EVOLUTION.md) gets one insight panel per
algorithm family, each holding its controls, a live sentence computed with
the engine's exact integer formulas, and an ⓘ-disclosed reference:

- **Evolution pipeline** — the numbered fire→operator→target→guards strip
  and the Evolution rate slider; the live line converts the rate into
  "about 1 cycle in N" and calls out the all-weights-zero frozen state.
- **Density (Barlow)** — Remove/Add weights with per-operator odds
  (weight/total of fired cycles), the Barlow temperature slider, paired
  Density floor/ceiling sliders, a corridor band with the seed-density marker, and an
  indispensability lane drawn on the pattern's own required grid: bar
  height = published-table rank, sounding/sustained/silent shading, and
  the actual Remove/Add candidate pools at the current temperature
  outlined (pool = 1 + ⌊t·(candidates−1)/100⌋). Grids with a prime factor
  beyond 7 show the seed-verbatim notice instead of guessing.
- **Depth** — prime palette chips 2/3/5/7 (at most two) and the live seed →
  working-Subdivision readout; paired mean-complexity floor/ceiling controls;
  and separate State complexity and Depth diversity values. Complexity is
  scaled mean Barlow indigestibility and is the enforced rail. Diversity is
  normalized entropy of the attack denominator classes and is insight only:
  uniform triplets can be deep but have zero variety. Promote/Demote corridor
  flow takes the smallest positive depth-price step before displacement, so
  the controls produce a gradual depth ladder rather than nearest-slot jumps.
- **Geometric placement** — the Placement bias slider blends Barlow strength
  with a pinned low-harmonic gap field. Bias 0 is legacy metric placement;
  bias 100 is spectral void-seeking. A dynamic slot-field profile under the
  slider visualizes that blend and has an accessible metric/void percentage
  label. The geometric field can intentionally diverge from a Bjorklund rhythm
  and is not the Euclid family in disguise.
- **Displacement (Sioros–Guedes)** — Syncopate/Desyncopate weights and the
  metrical-template lane (taller mark = stronger pulse, beat-level pulses
  shaded), with the reversibility and ternary type-0 rules in its
  reference.
- **Figures (fragmentation)** — Fragment/Consolidate weights with odds,
  the Fill complexity slider (0 = simplest true tuplet, 100 = any legal
  E(k,n) size), and a live count of the seed's fragmentable intervals and
  consolidatable runs; its reference explains the Mongeau–Sankoff pair,
  the on-grid tuplet rule, and the leash/projection accounting.
- **Euclidean (reshape)** — the Reshape weight with odds, the Caesura
  extension knobs (Max run bursts, Invert chance, Tied/Silent rests), and
  a live line naming the candidate windows; its reference covers the
  necklace math and the complement rule.
- **Rotation** — its weight and the unleashed-register explanation.
- **Guards** — density-corridor precedence, the Drift leash slider with the
  budget spelled out in real units (⌈leash% × seed onsets⌉ = N slots), and the
  trial-projection guarantee.

The Barlow/Sioros lanes come from `ui/src/dumkaMetrics.ts`, a TS mirror pinned
byte-for-byte by the Rust-generated `dumka_metrics_contract.json` fixture
(same scheme as the parser contract); they are display-only — playback never
runs through them. The same module mirrors the spectral candidate order from
Rust-emitted Q16 root vectors and pinned cases by advancing the integer
recurrence; it never evaluates browser trigonometry. Scalar controls keep their
`generator.dumka.*` cycle-start automation targets, weights stay authored-only
with serde defaults 3/3/2/0/0, and at
rate 0 or all-zero weights the seed repeats verbatim. The rhythm builder's
toolbar also carries an E(k,n) Euclidean fill that expands the same
Bjorklund necklace as the notation sugar over the selected block's span.

## Evolve

Evolve is the fourth full-window editor, beside Generator. It authors the
Dum-Ka generator's ordered directive plan rather than adding automation
targets. Cycle 0 is a locked seed column; each fixed family lane accepts pins
or inclusive ranges. A directive carries an enabled toggle, family options, an
optional contiguous beat scope, and a retained 0–100 intensity field used by
operation-quota mode. Its **Step size** is either that legacy operation quota
or a versioned perceptual target. A quota range can use **Repeat each cycle**
pacing or distribute one fixed
target across its inclusive cycles with **Linear transition** or **Gentle
transition** pacing. Missing pacing in an older patch recalls as Repeat each
cycle; Stochastic remains Repeat each cycle because its intensity is a fire probability rather than a target
quota. Same-family cycle overlap is rejected while cross-family directives
layer in authored order. Stable directive IDs survive reorder and persistence
because they salt the deterministic draw stream. One score supports up to 256
directives; the editor and persistence boundary enforce the same limit before
the engine performs overlap checks or folds a cycle.

The **Morph** lane is directive-only. Its inspector supplies a target Dum-Ka
pattern, validates that target's beat count and exact fit on the working
Subdivision, and previews the compiled target with the rhythm-builder block
idiom. Morph uses the same Repeat/Linear/Gentle operation pacing and the same
perceptual legal-prefix option as other deterministic families; it is gradual
onset transport, not an audio crossfade. Complexity overrides, Placement-bias
overrides, and palette-level filters stay ordinary directive options and
remain subordinate to projection and both corridors.

Pins render as diamonds, ranges as bars, gradual quota pacing appears as
Linear/Ease range treatment, disabled rows as hollow marks, and a beat-strip
glyph shows scope. The inspector supports numeric range, order,
family-specific overrides, whole-cycle/contiguous-beat scope, duplication,
deletion, and before/after preview comparison. Operation quota exposes
Intensity and Transition. Perceptual target exposes Target magnitude,
Tolerance, and Max operations on a 0.0–100.0 display scale, pins model `v1`,
shows the backend's Realized versus Target trace, and displays the plan-wide
Score budget (used and remaining out of 4,096 lifetime evaluations). An edit
that would exceed the budget is rejected without changing the score; tolerant
patch recall preserves but disables later over-budget perceptual rows and
warns the author. It targets each active
cycle and therefore hides Transition and smoothing controls; Stochastic cannot
use it. Selecting a directive moves stopped preview to its
first cycle; Before selects the preceding cycle and After restores the pin or
range start. A deterministic pin offers **Smooth across 4 cycles**, which
atomically extends it to four cycles and selects Gentle transition; ranges use
the compact **Transition** selector. Stochastic exposes neither control.
Arrow keys move the selected directive, Shift+Arrow resizes it,
Delete removes it, and Alt-drag duplicates it.

The cycle ruler supports horizontal wheel panning, pointer-drag panning, and
pointer-anchored Control/Command-wheel zoom. Only the visible ruler and
composition cells (plus a small overscan) are mounted, and the editor caps its
random-access visual window at cycle 10,000. Directives beyond that window stay
authored and continue to run during playback; the editor reports their count
instead of attempting an unbounded canvas allocation.

The **Curve card** at the top of the Evolve inspector authors the
composition-level evolution curve: an enabled toggle, tolerance and
max-operations fields, and the breakpoint list. With the curve enabled,
clicking the Step size lane places a breakpoint at that cycle (height =
target), shift-click removes one, and removing the last point disables
the curve. Below the composition strip, the **Step size lane** plots each cached
cycle's whole-cycle realized perceptual distance (`cycleDistance` on the
preview DTO) as a bar, overlays every enabled perceptual directive's
target ± tolerance as a band (stacked rows sum), and colors the bar green
inside the band, red outside; cycles without a cached preview say "not
cached". This is the calibration feedback loop: author a target, read
what the cycle actually realized.
The composition strip uses a bounded, authoring-only cache populated through
the same structure-preview and `generator_preview` commands as the timeline.
It follows the visible canvas, works while the Generator playback toggle is
off, and shows onset/density marks against the global corridor band, with one
focusable filled trace tick per
applied directive, one hollow tick per skipped directive, and a split
green/red tick when only part of a requested quota survived projection. A
corridor clamp is marked independently and names the floor or ceiling that
limited the operation, even when projection/exhaustion is also true. The
inspector can override both corridor rails as one paired option. For a
perceptual row, `requested` is the count of successfully examined nonzero
prefixes, `applied` is the selected prefix (including zero), and
reached/exhausted reflects the inclusive
target tolerance rather than an inferred operation percentage. A
gradual range labels its current step, including scheduled 0/0 holds; trace
fractions remain this-cycle work, not a cumulative percentage inferred from a
partial cache. This cache never
supplies timeline rows or playback. Generator retains the legacy stochastic knobs, annotated as
applying only where no plan directive is active, and links directly to Evolve.

Under Step size, the **Complexity** lane plots each cached cycle's backend
state complexity inside the effective complexity band and labels an independent
complexity clamp, including a normalization stall. The adjacent **Depth
diversity** value is an insight readout only; the UI never draws an authored
diversity band or describes it as an admissibility limit.

Gradual quota evolution is operation pacing, not an audio crossfade. It spreads
a fixed number of engine operations across cycle boundaries. One Rotate,
Fragment, Consolidate, or Euclid operation can still reshape many notes, so
these families may retain a pronounced structural step even under eased
pacing. Perceptual target is the alternative when one directive's incremental
change magnitude is the intended constraint: it searches the legal family
prefix nearest the fixed-point target, including a zero-operation hold, while
keeping corridor and projection guards absolute. Multiple active rows compose,
so their final whole-cycle change may be larger than any one target. Its `v1`
weights are engineering priors rather than
empirically calibrated thresholds; exact math and limitations are in
[DUMKA_PERCEPTUAL_DISTANCE.md](DUMKA_PERCEPTUAL_DISTANCE.md).

Generator controls update stopped preview through `generator_preview` and the
playback request through `track_set_playback`/`parallel_set_playback`; neither
the component nor timeline runs a second generation algorithm.
The generator lane shades each sounding cell by the accent velocity its notes
inherit at realize time (beat-, section-, and grouping-start accents over the
base velocity), with the exact value in the cell tooltip. Both sources feed the
same optional per-cell `velocity`: realized playback stamps it in the transport
overlay, and stopped preview stamps identical values from the structure
preview's per-matra `matraVelocities`, which the UI forwards in the
`generator_preview` request as `spanVelocities`. Rest cells and velocity-less
legacy payloads keep the unshaded look.
Timeline lane rows share a fixed label gutter (labels never overlap row
content), generator cells badge their length as a reduced beat fraction
("2/5" for eight pulses on a Subdivision-20 grid; rests and sub-3%-width
cells carry no badge, exact pulse counts stay in the tooltip), and the
Subdivision ruler numbers only anchor pulses — the beat start plus its
principal divisions (quarter-beat anchors 1/6/11/16 at Subdivision 20;
prime counts label the beat start alone) — leaving other pulses as
unnumbered ticks.
Random-access inspection while stopped is bounded to cycles 0 through 10,000
so cumulative generators cannot turn a recalled patch into unbounded preview
work. During playback the timeline remains unbounded and may resolve the live
reference or active-track cycle (plus the two-cycle live window) through that
same generator resolver.

## Channel Shaper

Channel Shaper can be disabled for static output or enabled in:

- **Markov** mode, with first-/second-order transitions, entry/fallback weights,
  accent routing, and position rules; or
- **Euclidean** mode, with channel layers, rotation, reset scope, burst limits,
  and accent behavior.

The timeline's channel lane shows recorded final assignments. It must not
recalculate them from editor controls.

## Timeline truth

The timeline includes the ruler, section boundaries, Subdivision/Grouping
structure, generator output, optional channel assignments, selected automation
lanes, trigger/Track Flow state, suppression state, and playhead.

Stopped state shows the newest completed preview matching authored generation.
While playing, scheduler-recorded layers win. If another preview is pending or
a late response is stale, existing rows remain mounted until a newer truthful
frame is ready. A loading state must not erase the last resolved cycle.

## Control commit rules

- Slider/rail drags update local visual state and commit once on release.
- Numeric/text fields commit on Enter or blur.
- A focused draft is flushed before Save, Save As, export, import, new/copy
  track, and similar snapshot actions.
- Async preview, patch-build, and project-structure actions carry generation or
  revision tokens. A late result may not overwrite newer authored state.
- Superseded operations do not publish stale success/error statuses.
- Command/control-click on annotated controls opens their automation target;
  focused automation buttons show only the local target group.

## Persistence workflow

- **Save** writes the current `.dumka` path or asks for one.
- **Recall** loads a version-1 patch and replaces the current project after
  normalization and validation.
- **Autosave** is crash-recovery state. It does not mark an explicit project
  file saved.
- **Export track** writes `.dumka-track`; **Import** asks whether to retain
  saved local timing and appends a fresh-identity track.
- Load warnings are visible. Unknown generator kinds are disabled rather than
  silently treated as Example.

Patch status text distinguishes cancellation, stale authored state, stale
project revision, transition changes, read/write failure, and success so an
action never appears to no-op without explanation.

## Accessibility and rendering

Track selection uses tab semantics; dialogs have labelled modal layers and
keyboard close behavior. Icon-only buttons carry names and titles. Theme
contrast, tab semantics, dialog focus, and control chrome have Playwright or RTL
coverage.

High-frequency playhead movement updates narrow render surfaces. Hidden
diagnostics do not subscribe to full event logs. Deferred panels mount their
expensive work only while open.
