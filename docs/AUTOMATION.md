# Automation

Automation is Caesura's DAW-style parameter motion layer. It lets a patch move
editable sequencer values over musical time while preserving the project
invariant that timeline preview and MIDI playback are realized from the same
request data.

This document describes the current implemented state. It is also the checklist
for extending automation to more of the sequencer surface.

## Current Status

Implemented now:

- One top-level automation span measured in cycles.
- Exact normalized automation point times stored as rational
  numerator/denominator pairs.
- Beat-quantized backend evaluation, sampled before each beat is realized into
  matras and playback events.
- Typed numeric target evaluation for boolean, integer, float, and weight
  values.
- Per-segment line shaping with hold, linear, smooth, ease-in, ease-out,
  ease-in-out, and exponential curves.
- Global visual markers that appear on every automation graph and can be used
  as snap references.
- Relational marker anchors are evaluated by the shared sampler. When a point's
  `anchorId` resolves to a marker, the marker's current time is used as the
  point's effective phase; missing markers fall back to the point's stored time.
- The editor mirrors that resolution: the graph, point list, and segment picker
  render and order points at their EFFECTIVE (marker-aware) time — an anchored
  point draws at its marker (dashed ring) and follows it when the marker moves,
  exactly as playback samples it. Editing a point's phase pins the typed value
  and clears its anchor; deleting a marker frees its anchored points.
- Anchor hygiene: an `anchorId` that names no existing marker is stripped to
  null by patch normalization (this also heals the vestigial
  `automation-start`/`automation-end` sentinels that pre-anchor-era default
  lanes carried). New lanes are created with unanchored endpoints.
- Segment-curve parity is pinned by a golden table asserted on BOTH sides:
  `warpAutomationUnit` (`ui/src/automationTargets.test.ts`) and
  `warp_automation_t` (`crates/cseq-model`). A point without an explicit
  `outCurve` falls back to the CURVE's interpolation in the editor and the
  sampler alike. Change one implementation only together with the other and
  both tables.
- A top-level Automation panel with target search/filtering, lane selection, a
  focused graph editor, a point list for exact editing, and segment curve
  controls.
- Weighted-value lanes store a per-lane graph range (`graphRange`) for the
  editor and timeline lane scaling. This lets relative integer-like weights be
  edited in a useful local range such as 0-5 or 1-20 while preserving the
  target's full backend domain.
- A broad frontend automation target registry for the current musical editing
  surface: score controls, boundary probabilities, gati/jathi weights, section
  count weights, rhythm transition weights, rhythm fallback weights,
  articulation rest/tie cells, arbitrary subdivision weights and pools, rhythm
  speed weights, ratchet controls, ornament controls, pitch shaper controls,
  pitch matrix weights, channel hocket controls, channel matrix weights, accent
  routing weights, synth channel program/drum-note values, and transport tempo.
- Transport playback now receives the active `AutomationSet` with
  `RhythmPlaybackConfig` and samples the same target ids into the effective
  cycle-local playback config before realizing a cycle. This currently covers
  rhythm matrices/fallbacks/articulation, arbitrary subdivision, rhythm speed,
  ratchet, ornament/delay, pitch shaper, channel hocket, channel accent rules,
  static MIDI channel, cycle tempo flux, and transport tempo. For single-track
  playback, the `transport.tempoBpm` lane is sampled by the scheduler at the
  current beat and controls effective playback BPM while the manual Tempo field
  remains the base BPM. Parallel custom-tempo tracks are the intentional
  exception to beat-stepped post-score automation: `transport.tempoBpm` is
  integrated as a continuous track-local clock map across each realized cycle.
  Tracks that follow the global BPM use the project reference tempo and ignore
  local tempo automation.
- Command-click/control-click lane opening for annotated editable controls. The
  handler is generic: any element with `data-automation-target` opens or creates
  the matching lane.
- Timeline lanes that render from backend preview samples, not from a separate
  frontend evaluator.
- Playback locking for automation edits, so the visible timeline cannot drift
  from the score installed on the transport.

Not implemented yet:

- Per-note-group beat-local sampling inside the post-score playback processors —
  **implemented for ratchet, ornament, pitch, channel hocket, and rhythm matrix
  weights**. Score-level
  `SubdivisionSwitch` automation is sampled per beat before the rhythm tree is
  materialized. For post-score playback automation, the **ratchet** scalar fields
  (`ratchet.probabilityPercent`, `ratchet.speed.min`, `ratchet.speed.max`) and
  the **ornament** fire probabilities (`ornament.probabilityPercent`,
  `delay.probabilityPercent`) are re-sampled per note group. Pitch and channel
  hocket spec fields are re-sampled per rewrite group while preserving the same
  seeded resolver stream, and rhythm Markov matrix weights are re-sampled per
  resolved span. Still beat-0: seed mode and post-score fields not listed by the
  shared predicate. The set of per-beat/per-group post-score targets is the
  single source of truth
  `cseq_model::automation_target_is_per_beat_post_score`, which the stopped
  timeline preview also consults so preview and playback sample each target at
  the same phase.
- Built-in synth voice automation. The target registry exposes synth
  program/drum-note lanes, but the synth program command path is still separate
  from the rhythm playback config.
- Exhaustive `data-automation-target` annotation for every last editable widget.
  The generic shortcut path is in place and the primary musical controls are
  annotated; remaining UI fields should be annotated as they are touched.
- UI controls for creating multiple curves per lane or changing add/multiply
  combine modes, even though the model and evaluator already support them.

## Behavioral Contract

Automation is beat-quantized. The UI may draw curves for editing clarity, but
the transport samples a single value for each beat.

For every automatable value:

1. The value must have a stable target id.
2. The target must declare its data type and numeric domain.
3. The backend must sample the target on the same path used by preview and
   playback.
4. The timeline must render sampled backend values for the currently visible
   cycle.
5. Editing automation must refresh the timeline before playback starts.

Automation is not a separate playback-only modulation layer. If an automated
pitch, velocity, weight, probability, or boolean is visible in the timeline,
that sampled value is the value the transport will use.

## Data Model

The core model lives in `crates/cseq-model/src/lib.rs`.

`AutomationSet`

- `lengthCycles`: the shared automation span, measured in full rhythmic cycles.
- `markers`: global visual snap markers shared by every graph.
- `tracks`: automation lanes, each attached to one target id.

`AutomationTrack`

- `id`: stable lane id for UI and persistence.
- `target`: stable automatable value id, such as `sequencer.pitch`.
- `enabled`: disabled tracks are ignored by the evaluator.
- `combine`: how this track combines with the target's base value.
- `graphRange`: optional editor Y-axis range. It is currently used for weight
  lanes so the graph can show the musically useful local weight window instead
  of always showing the full 0-999 storage domain.
- `curves`: one or more enabled/disabled curves.

`AutomationCurve`

- `id`: stable curve id.
- `enabled`: disabled curves are ignored.
- `interpolation`: legacy curve-level fallback, currently `hold`, `linear`, or
  `smooth`.
- `points`: ordered by exact time during sampling.

`AutomationPoint`

- `id`: optional stable point id for UI editing.
- `time`: exact normalized `AutomationTime`.
- `value`: number, boolean, or text. Current sampling only consumes numeric and
  boolean values.
- `anchorId`: optional marker id remembered by the UI.
- `outCurve`: optional segment shape from this point to the next point.

`AutomationMarker`

- `id`: stable marker id.
- `time`: exact normalized `AutomationTime`.
- `label`: user-facing label.

Bridge types are mirrored in `ui/src/bridge.ts`. Serialized JSON uses
camelCase names, so Rust `out_curve` is persisted as `outCurve` and
`anchor_id` is persisted as `anchorId`.

## Time Model

Automation runs over one top-level span measured in cycles. The span is stored
as `AutomationSet.lengthCycles` and is edited in the main transport area. Every
lane shares this length.

Point positions are normalized over the full span:

```text
0/1 = start of automation span
1/2 = halfway through the automation span
1/1 = right edge of the automation span
```

The stored representation is exact:

```text
AutomationTime { numer, denom }
```

`AutomationTime::new` clamps the numerator into `0..denom`, rejects a zero
denominator, reduces the fraction by gcd, and stores the normalized rational.
Exact ordering uses cross multiplication through `u128` in `cmp_exact`, so the
backend can order points without converting them to floating point.

The UI converts pointer positions and percent inputs into high-resolution
rationals using `AUTOMATION_TIME_DENOMINATOR = 1_000_000_000`, then reduces the
fraction. This gives editing enough precision for coordinated events to remain
coordinated when the automation span is stretched from a few cycles to hundreds
or more.

Changing `lengthCycles` does not rewrite point times. A point at `73/100`
remains exactly `73/100`; it simply maps to a different absolute cycle and beat
because the total automation span changed.

The current evaluator wraps by the automation length. Internally it uses:

```text
cycleInRange = cycle % lengthCycles
totalBeats = lengthCycles * cycleBeats
automationBeat = cycleInRange * cycleBeats + beatIndex
phase = automationBeat / totalBeats
```

This means a four-cycle automation span repeats every four cycles. A patch that
uses a very long form should set the automation length to that form length if it
does not want the automation to repeat earlier.

One subtle but important detail: ordinary beat sampling never samples the exact
right edge `1/1`. For a four-beat one-cycle span, beat phases are:

```text
0/4, 1/4, 2/4, 3/4
```

The endpoint at `1/1` shapes interpolation toward the end of the span, but it
is not itself an audible beat. If the last beat must hit a specific value, put
that point at the last beat's actual phase, such as `3/4` in a four-beat span.

## Sampling Pipeline

The evaluator entry points are:

- `AutomationSet::sample_typed_number`
- `AutomationSet::sample_number`
- `AutomationSet::sample_bool`
- `AutomationCurve::sample_number`

For a target sample:

1. Compute exact beat phase with `AutomationTime::from_beat`.
2. Find enabled tracks whose `target` matches the requested target id.
3. For each matching track, sample each enabled curve.
4. Combine curve samples according to the track's combine mode.
5. Coerce the result by `AutomationValueKind` and the target min/max.
6. Return `None` if no enabled matching track produced a sample.

Track combine modes currently behave as follows:

- `replace`: average all enabled curve samples across all enabled Replace tracks
  for the target, then replace the base value with that mean.
- `add`: sum all enabled Add curve samples and add them after Replace has been
  resolved.
- `multiply`: multiply all enabled Multiply curve samples after Replace and Add
  have been resolved.

The simplified UI currently creates one `replace` track with one curve per
target. Existing serialized data with multiple curves or non-replace modes still
has backend support. Compatibility note: a 2026-07-02 survey of committed JSON
patch/fixture files found no patches with multiple enabled Replace tracks on the
same target, so cross-track Replace averaging shipped as a silent semantics fix
without a schema gate.

## Curve Evaluation

When a curve is sampled:

1. Points without numeric values are ignored.
2. Remaining points are sorted by exact `AutomationTime`.
3. If the sample phase is before the first point, the first point's value is
   used.
4. If the sample phase is after the last point, the last point's value is used.
5. If the sample phase exactly equals a point, that point's value is used.
6. Otherwise, the evaluator finds the bracketing left/right points exactly and
   interpolates between their numeric values.

Only after the exact bracket is selected does interpolation convert times to
floating point. This keeps storage, ordering, and coordination exact while
allowing conventional curve math for the segment.

The segment shape comes from the left point's `outCurve`. That curve controls
the line from the left point to the next point. If `outCurve` is missing, the
curve's legacy `interpolation` value supplies a fallback so older documents
still behave sensibly.

Segment curve kinds:

- `hold`: stay at the left value until the right point.
- `linear`: straight interpolation.
- `smooth`: smoothstep blend, with `amount` blending from linear to smooth.
- `easeIn`: slow start, faster end.
- `easeOut`: faster start, slow end.
- `easeInOut`: slow start and end, faster middle.
- `exponential`: exponential rise shaped by `amount`.

`amount` is clamped to `0..1`. For ease curves it controls the exponent range;
for exponential it controls bend strength.

## Value Types

Automation targets declare an `AutomationValueKind`:

- `boolean`: numeric samples are coerced to `0` or `1` at a threshold of `0.5`.
- `integer`: samples are clamped to the target domain, then rounded.
- `float`: samples are clamped to the target domain and left continuous.
- `weight`: samples are clamped like floats, with current targets using a
  minimum of zero.

This type layer is required before automating the rest of the sequencer. Markov
transition states, toggles, probabilities, MIDI values, and weights should not
share an untyped generic float path.

The model also defines `AutomationSampleRate`:

- `beat`
- `sectionStart`
- `cycleStart`
- `rhythmSpan`
- `noteGroup`

The current implemented sampler is beat-based. The other sample-rate labels are
part of the target definition contract for future targets that should only be
sampled at structural boundaries.

## Target Registry

The current frontend registry is intentionally wider than the backend-applied
surface. It gives every current musical subsystem stable target ids, labels,
types, domains, and fallback values so automation lanes can be created from the
top-level browser or from command-click/control-click gestures.

Backend-applied targets are currently focused on `SubdivisionSwitch` score
realization.

Base score targets:

- `sequencer.pitch`
- `sequencer.velocity`
- `sequencer.accent.beatStart.min`
- `sequencer.accent.beatStart.max`
- `sequencer.accent.sectionStartExtra.min`
- `sequencer.accent.sectionStartExtra.max`
- `sequencer.accent.jathiStart.min`
- `sequencer.accent.jathiStart.max`
- `sequencer.singleParameterRhythmicModulation`

Initial choice targets:

- `sequencer.initial.gati.{subdivision}.weight`
- `sequencer.initial.jathi.{jathi}.weight`

Boundary targets:

- `sequencer.boundary.{boundaryId}.probability`
- `sequencer.boundary.{boundaryId}.gati.{subdivision}.weight`
- `sequencer.boundary.{boundaryId}.jathi.{jathi}.weight`

Section count targets:

- `sequencer.sectionCount.{count}.weight`

Target id helpers are defined in `cseq-model`, for example:

- `automation_target_boundary_probability(boundary_id)`
- `automation_target_boundary_gati_weight(boundary_id, subdivision)`
- `automation_target_boundary_jathi_weight(boundary_id, jathi)`
- `automation_target_initial_gati_weight(subdivision)`
- `automation_target_initial_jathi_weight(jathi)`
- `automation_target_section_count_weight(count)`

Frontend target definitions are built by `buildAutomationTargetDefs` in
`ui/src/App.tsx`. The function derives labels, groups, types, ranges, steps,
units, and fallback values from the current editable sequencer state.

Additional frontend target families currently include:

- `transport.*` for tempo, synth enable, MIDI output, and cycle tempo flux
  controls.
- `rhythm.matrix.{length}.{order}.{from}.to.{to}.weight` for individual
  Markov transition weights.
- `rhythm.fallback.{length}.{state}.weight` for weighted fallback states.
- `rhythm.articulation.{length}.{state}.cell.{index}.{field}` for contingent
  rest/tie probabilities on rhythm cells that exist in the active state set.
- `rhythm.arbitrarySubdivision.*` and `rhythm.speed.*` for arbitrary
  subdivision and gati/jathi speed-weight controls.
- `ratchet.*`, `ornament.*`, and `delay.*` for playback shaper probabilities,
  weights, curve controls, velocity shaping, and modifier values.
- `pitch.*` and `pitch.matrix.{order}.{from}.to.{to}.weight` for pitch shaper
  ranges, fallback pools, pitch behavior probabilities, transposition controls,
  and individual pitch transition weights.
- `channelHocket.*` and
  `channelHocket.matrix.{order}.{from}.to.{to}.weight` for channel hocket
  routing, fallback pools, behavior probabilities, accent routing, and
  individual channel transition weights.
- `synth.channel.{channel}.program` and `synth.channel.{channel}.drumNote` for
  channel voice assignments.

Contingent targets are only emitted when the relevant musical object exists.
For example, rhythm articulation rest/tie targets are created for cells in the
active rhythm state set, arbitrary-pool targets are created for currently
pooled cells, pitch fallback weights are created when weighted fallback mode is
active, and matrix targets are generated from the active state/channel sets.

## Where Targets Are Sampled

Automation is applied inside the same `SubdivisionSwitch` transform that
realizes the preview and playback tree.

Current sampling anchors:

- Pitch, base velocity, and accent ranges are sampled per beat before that beat
  creates matras.
- `singleParameterRhythmicModulation`, initial gati weights, initial jathi
  weights, and section count weights are sampled at beat `0` of the current
  cycle before cycle-level choices are resolved.
- Boundary probability and boundary gati/jathi weights are sampled at the
  boundary's after-beat position before fired boundaries are resolved.

Boundary targets are keyed by stable boundary id. If a boundary lacks an id,
the transform falls back to an `after-beat-{N}` id, but the UI should continue
creating and preserving stable ids for user-authored boundaries. Automation
should stay attached when a boundary moves to another beat.

If an automation target references an object that no longer exists, it is
ignored safely because no matching sample request is made for that target.

## Timeline And Playback Parity

The Tauri preview command `score_preview_subdivision_switch` receives the
current `AutomationSet`. Its resolved beat DTO includes:

- `automationPhase`: exact `AutomationTime` for that beat.
- `automationValues`: sampled target/value pairs for active automation targets.
  Score targets and per-beat/per-group post-score targets
  (`cseq_model::automation_target_is_per_beat_post_score`) are sampled at the
  beat's own phase; other post-score targets are sampled at beat 0 (held across
  the cycle). Each target is therefore previewed at the same phase family the
  playback engine reads, so the stopped lane matches what plays.

The timeline's automation lanes render from these backend samples. The frontend
graph editor can draw the editable curve, but it is not authoritative for what
plays. The authoritative visible lane data is the preview response, because the
same Rust model and transform path is used by playback.

Automation edits are treated like timeline-affecting score edits:

- Editing is disabled while playback is running.
- Changes update the patch state.
- Stale timeline preview data is cleared.
- A fresh preview is requested for the visible stopped cycle.
- Play waits for a coherent preview before starting.

This protects the core rule: what is visible in the timeline is what will play
back.

## Playback Debug Log

The transport also records an automation playback debug log while playback is
running. It is exposed as `TransportSnapshot.automationEvents` and rendered in
the Automation playback debug table in `ui/src/App.tsx`.

The log records one row when live playback enters a new beat with active
automation samples. Each row includes:

- Sequence number.
- Cycle.
- Zero-based beat index.
- Tick-in-cycle.
- Exact automation phase.
- All active sampled target values for that beat.

The log is diagnostic only and is capped at 1000 rows. Score-level entries use
the same typed backend evaluator used by the transform path. Post-score rhythm
playback entries sample the active transport automation tracks at the current
beat so fast in-cycle motion can be inspected even before every playback
processor consumes those samples beat by beat.

## Current UI

The top transport area contains:

- `Automation` length in cycles, clamped to `1..1_000_000`.
- An Automation toggle that opens the top-level Automation overview.

The Automation overview contains:

- A target browser.
- A lane strip for active automation tracks.
- A global marker editor.
- One focused graph editor for the selected lane.
- A point list under the graph.
- Segment curve controls.

The target browser supports:

- Text search.
- Group filtering.
- Type filtering.
- Target rows with label, group, value kind, and sample-rate chip.

Adding a target creates a lane with one enabled replace curve. New lanes start
with two points:

- Start point at `0/1`.
- End point at `1/1`.

Both points start at the target's current fallback value. The start point has a
default linear outgoing segment. The end point has no outgoing segment because
there is no following point.

The graph editor supports:

- Click empty graph space to add a point.
- Drag an existing point to change phase and value.
- Select a segment by clicking its drawn line.
- See global markers as vertical lines.
- Snap new or dragged points to a marker when within `1.25%` of the full span.
- Use hover titles to inspect phase and value.

The point list supports:

- Exact phase percent editing with six displayed decimal places.
- Exact numeric value editing.
- Boolean value editing as a `0` or `1` selector.
- Marker snap selection.
- Point removal, with removal disabled when only the two default endpoints
  remain.

The segment controls support:

- Selecting any segment by its percent range.
- Choosing a segment curve type.
- Adjusting bend amount from `0..1`.

The current UI intentionally focuses on one graph line at a time. It does not
yet expose a full multi-curve stack or relative add/multiply lanes.

Direct target access behavior:

- The app shell listens for modified clicks on elements with
  `data-automation-target`.
- Subsection automation symbols are explicit inline buttons beside subsection
  labels in `ui/src/App.tsx`. Each button passes a short target-id list into the
  shared floating modal, so dense controls get local lane access without a field
  of visible per-control buttons. Markov transition matrices are an intentional
  exception: rhythm, pitch, and channel matrix cells render a tiny symbol beside
  each transition weight and pass that cell's single stable target id.
- Inline symbols stay unbordered and quiet by default. A small colored count on
  the symbol reports how many lanes in that local group already have automation.
- If the lane already exists, the Automation panel opens with that lane
  selected.
- If the lane does not exist, the UI creates a default two-point replace curve,
  opens the Automation panel, and selects the new lane.
- Direct target access is disabled during playback because automation edits are
  locked while transport is running.

## Global Markers

Markers are shared visual references. They are useful for coordinating many
automation lanes around the same form moment, such as `73%` through a long
composition.

Current marker behavior:

- Markers are stored in `AutomationSet.markers`.
- Marker times use exact `AutomationTime`.
- Markers render as vertical lines on every graph.
- The marker list can add, edit, and remove markers.
- Points can snap to markers while dragging or by choosing a marker in the
  point list.
- Removing a marker clears matching point `anchorId` values.

Marker anchoring is relational during evaluation. A point snapped to a marker
stores both the marker id and its current absolute time; the sampler uses the
marker time when the id resolves, so moving the marker moves the point's
effective phase for playback and preview. If a patch contains an anchor id whose
marker is missing, the sampler falls back to the point's stored time and still
evaluates the point.

Markers are visual and editorial only. They do not create score events, force
section boundaries, or affect sampling unless a point's `anchorId` resolves to
that marker.

## Persistence And Compatibility

Patch persistence stores the full automation set along with the rest of the
working surface. The UI normalization path accepts missing or older fields:

- Missing `lengthCycles` defaults to `1`.
- Missing `markers` defaults to an empty list.
- Missing `curves` defaults to an empty list for the track.
- Missing `outCurve` falls back to curve-level `interpolation`.
- Invalid segment curve kinds fall back to `linear`.
- Invalid point values fall back to numeric `0`.

This allows older patches with curve-level interpolation to keep loading after
per-segment curves were added.

## Test Coverage

Model-level tests in `crates/cseq-model/src/lib.rs` cover:

- Exact rational normalization.
- Beat-quantized linear sampling.
- Hold interpolation.
- Exact stretching when `lengthCycles` changes.
- Multiple curves on a replace track averaging their samples.
- Multiple Replace tracks on the same target averaging their samples.
- Integer and boolean coercion.
- Per-segment curve override behavior.
- Marker JSON roundtrip with exact time.
- Marker-anchor movement, missing-marker fallback to stored time, and
  post-roundtrip anchor evaluation.

Transform-level tests in `crates/cseq-transforms/src/lib.rs` cover:

- Pitch automation changing per beat.
- Velocity automation before accent sampling.
- Length-cycle stretching reaching the intended later-cycle value.
- Boolean automation flipping single-parameter rhythmic modulation.
- Boundary probability automation by stable id.
- Weight target automation for gati/jathi/section choices.

Tauri preview tests in `src-tauri/src/main.rs` cover per-beat automation sample
reporting in `score_preview_subdivision_switch`.

When a new target is added, it should have at least one evaluator or transform
test proving the sampled value reaches realized output.

## Current Limitations

The current automation foundation now has a broad target registry and broad
playback application, but a few parts are still intentionally narrower than the
lane-addressable UI surface. Known limitations:

- Post-score automation targets now appear in the subdivision preview beat
  samples (F2, 2026-05-28): `score_preview_subdivision_switch` appends them to
  each beat's `automationValues`, so the stopped timeline can render
  previously-"pending" post-score lanes. They are sampled at the cycle-start
  value (held across the cycle) to match how post-score playback samples today;
  they step per cycle. Once per-beat post-score playback (F3) lands, the preview
  helper `append_post_score_preview_values` should switch from beat 0 to the
  actual beat index so preview and playback stay per-beat-identical.
- Post-score automation is sampled at cycle realization. A target that changes
  inside the cycle is visible in the debug log, but ratchet, ornament, pitch,
  channel, and rhythm-shaper playback decisions currently use the sampled
  effective config for that realized cycle.
- Synth program/drum-note targets can be created, edited, persisted, and opened
  by target id, but they do not yet alter the separate synth program command
  path.
- Text automation values are represented in the model but not evaluated by the
  current sampler.
- Non-beat sample rates exist in the type system but do not yet have dedicated
  evaluator paths.
- Some editable widgets still need `data-automation-target` annotations even
  though the generic command-click/control-click path exists.
- The UI cannot yet manage multiple curves per track.

These limitations are expected next-step work, not reasons to fork the model.
New automation should extend this document, target registry, typed evaluator,
and preview/playback path.

## Adding A New Target

Use this checklist for every new automatable value.

1. Choose a stable target id.

   Use data identity, not display text. Repeatable objects need stable object
   ids before their fields can be automated. A Markov transition cell should be
   addressed through stable matrix/state identifiers, not a fragile table
   coordinate that changes when the UI is reordered.

2. Declare the target definition.

   Add label, group, `AutomationValueKind`, min, max, step, optional unit, and
   intended `AutomationSampleRate`. The UI should derive the fallback value
   from the same state the manual control edits.

3. Add or reuse backend target helpers.

   Prefer helper functions for parameterized ids, as with boundary and weight
   targets.

4. Sample in the Rust realization path.

   Apply the sampled value where the manual value is consumed. Do not sample in
   a frontend-only path and do not create a second playback-only behavior.

5. Preserve preview/playback parity.

   If the target affects what a beat, span, note group, or MIDI event becomes,
   the preview DTOs must expose enough sampled data for the timeline to render
   exactly what playback will use.

6. Clamp and coerce by type.

   Boolean targets must land on `0` or `1`. Integer MIDI targets must round and
   clamp. Weights must not go negative. Probability targets should remain
   within `0..1`.

7. Add tests.

   Add evaluator tests for model behavior when needed, transform tests proving
   musical output changes correctly, and bridge/preview tests when timeline data
   shape changes.

8. Update docs.

   Update this file, `docs/ARCHITECTURE.md`, `docs/AI_HANDOFF.md`, and
   `docs/UI_AND_INTERACTION.md` when the target changes data flow, semantics,
   or visible workflow.

## Files Of Interest

- `crates/cseq-model/src/lib.rs`: automation data model, target helpers,
  evaluator, and model tests.
- `crates/cseq-transforms/src/lib.rs`: automation sampling inside
  `SubdivisionSwitch` realization.
- `src-tauri/src/main.rs`: preview request/response bridge and per-beat sample
  DTOs.
- `ui/src/bridge.ts`: TypeScript bridge types.
- `ui/src/App.tsx`: target registry construction, automation editor UI,
  marker editing, graph editing, timeline lanes, and playback edit locking.
- `ui/src/styles.css`: automation panel, graph, marker, and timeline lane
  styling.
