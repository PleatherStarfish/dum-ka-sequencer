# Editable Value Inventory

This document is the canonical checklist of editable Caesura values for AI
agents, automation work, and regression testing. It is intentionally more
mechanical than the user manual: if a user can edit a value, or if a persisted
patch stores the value because it changes the working surface, it belongs here.

The inventory has three jobs:

1. Give automation work a complete map of targets still to expose.
2. Give tests a complete map of values that need persistence, preview, and
   playback coverage.
3. Make future UI changes add a row here when they add a control.

## Numeric Entry Contract

Every numeric value below is entered through `ui/src/NumericField.tsx`
(React Aria number engine + app semantics). The entry contract — commit on
blur/Enter, clamp+quantize at commit, drafts never commit, invalid/empty
never emits, Escape reverts — is specified by
`ui/src/NumericField.behavior.test.tsx` and documented with the per-family
study in [NUMERIC_INPUT_SURVEY.md](NUMERIC_INPUT_SURVEY.md). Call sites
receive committed numbers via `onValueCommit` and must not parse, clamp, or
invent fallbacks.

## Coverage Contract

Every row or row family below should eventually have coverage in the relevant
columns:

- `Persistence`: save a `.caesura` patch, recall it, and confirm the value.
- `Preview`: confirm the visible timeline or preview state uses the value.
- `Playback`: confirm scheduled MIDI or playback diagnostics use the same value
  shown in the timeline.
- `Automation`: if the value is a musical/playback parameter, confirm beat-level
  automation can sample and apply it. UI-only values are excluded by design.

Automation coverage status:

- `Current`: implemented in the automation registry/evaluator today.
- `Phase 3`: planned musical target family for the broad automation expansion.
- `Structural`: topology-changing value. It should not be interpolated as a
  normal beat value without a discrete-change design.
- `UI-only`: view preference, filter, dialog tab, or debug display state.
- `Computed`: derived state, log output, trace data, or historical snapshot.

## Value Kinds

- `boolean`: stored as true/false. Automation should coerce through `0` or `1`.
- `integer`: whole-number value, generally clamped.
- `float`: continuous number, often normalized `0..1` or percent in the UI.
- `weight`: non-negative number used by a weighted choice or Markov edge.
- `enum`: closed string option.
- `text`: user-entered string.
- `rational time`: exact normalized automation position `{ numer, denom }`.
- `object/list`: add/remove/reorder container or nested editable values.

## Top-Level Transport And Playback

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `transport.tempoBpm` | Tempo field | float `20..400` BPM | `SequencerPatchDocument.transport.tempoBpm` / `project.global.tempoBpm` -> `transportSetTempo` or parallel reference clock | Persistence, playback clock, ratchet-rate behavior, parallel global tempo slaving | Implemented |
| `transport.synthEnabled` | Built-in synth on/off | boolean | `transport.synthEnabled` | Persistence, playback monitor | Phase 3 or exclude as monitor-only |
| `transport.rhythmPlaybackEnabled` | Legacy rhythm enabled flag, normalized on | boolean | `transport.rhythmPlaybackEnabled` | Compatibility persistence | Not automatable |
| `transport.currentScoreId` | Current backend score id | text/null | `transport.currentScoreId` | Persistence sanity only | Computed |
| `transport.cycleTempoFlux.enabled` | Cycle tempo flux on/off | boolean | `transport.cycleTempoFlux.enabled` | Persistence, playback tempo diagnostics | Phase 3 |
| `transport.cycleTempoFlux.minBpm` | Flux min BPM | float `20..400` | `transport.cycleTempoFlux.minBpm` | Persistence, playback | Phase 3 |
| `transport.cycleTempoFlux.maxBpm` | Flux max BPM | float `20..400` | `transport.cycleTempoFlux.maxBpm` | Persistence, playback | Phase 3 |
| `transport.cycleTempoFlux.seed` | Flux seed | integer `>=0` | `transport.cycleTempoFlux.seed` | Persistence, deterministic playback | Phase 3 |
| `transport.cycleTempoFlux.curve.points[*].x` | Flux curve point time | float `0..1` | `transport.cycleTempoFlux.curve.points` | Persistence, playback | Structural for point topology, Phase 3 for point values |
| `transport.cycleTempoFlux.curve.points[*].y` | Flux curve point value | float `0..1` | `transport.cycleTempoFlux.curve.points` | Persistence, playback | Phase 3 |
| `transport.cycleTempoFlux.curve.variance` | Flux curve variance | float `0..1` | `transport.cycleTempoFlux.curve.variance` | Persistence, playback | Phase 3 |

## Project Tracks

Project track values are schema `2` patch metadata. They control tabbed
editing and parallel transport playback. Timeline preview still displays the
selected active track, while transport playback merges all audible tracks when
more than one track is active after mute/solo filtering.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `project.activeTrackId` | Track tabs | text id | `SequencerPatchDocument.project.activeTrackId` | Persistence, active editor hydration, tab switching tests | UI-only |
| `project.global.channelConflictPolicy` | Default channel logic select | enum `forceOn`, `forceOff`, `allowAll`, `or`, `randomOne`, `alternate`, `priorityOrder`, `xor`, `xnor`, `and`, `nand`, `nor`, `even`, `odd`, `oneHigh`, `oneLow`, `majority`, `minority` | `ParallelProjectPatch.global.channelConflictPolicy` | Persistence, parallel same-channel merge | Structural |
| `project.global.channelLogicMatrix` | Channel logic track/channel override rows | list of track-pair ids, optional MIDI channel, plus channel logic enum | `ParallelProjectPatch.global.channelLogicMatrix` | Persistence, pairwise parallel same-channel merge overrides | Structural |
| `project.global.conflictPriority` | Priority order editor | list of track ids | `ParallelProjectPatch.global.conflictPriority` | Persistence, priority collision merge | Structural |
| `project.global.tempoBpm` | Global BPM reference field | float `20..400` BPM | `ParallelProjectPatch.global.tempoBpm` | Persistence, parallel reference clock, global-follow track tempo | Structural |
| `project.global.cycleBeats` | Global cycle reference field | integer `1..64` beats | `ParallelProjectPatch.global.cycleBeats` | Persistence, parallel reference cycle, global-follow track cycle length | Structural |
| `project.tracks[*].name` | Active track name | text | `ParallelTrackPatch.name` | Persistence, tab UI | UI-only |
| `project.tracks[*].muted` | Track M button | boolean | `ParallelTrackPatch.muted` | Persistence, parallel audible-track filter | Structural |
| `project.tracks[*].soloed` | Track S button | boolean | `ParallelTrackPatch.soloed` | Persistence, parallel audible-track filter | Structural |
| `project.tracks[*].tempoMode` | Track BPM mode | enum `global`, `custom` | `ParallelTrackPatch.tempoMode` | Persistence, active track hydration, parallel playback tempo | Structural |
| `project.tracks[*].cycleLengthMode` | Track cycle mode | enum `global`, `custom` | `ParallelTrackPatch.cycleLengthMode` | Persistence, active track hydration, parallel playback cycle length | Structural |

## Built-In Synth Monitor

These values change local monitoring and are saved with the patch. They do not
change the rhythm tree itself, but they are user-editable and can affect what
the user hears when the built-in synth is active.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `transport.synthPrograms[channel].mode` | Channel voice mode | enum `melodic`, `percussion` | `SynthChannelProgram.mode` | Persistence, monitor routing | Phase 3 or monitor-only |
| `transport.synthPrograms[channel].program` | GM melodic program | integer `0..127` | `SynthChannelProgram.program` | Persistence, monitor program change | Phase 3 or monitor-only |
| `transport.synthPrograms[channel].drumNote` | GM percussion key | integer `0..127` | `SynthChannelProgram.drumNote` | Persistence, monitor note mapping | Phase 3 or monitor-only |
| `ui.synthPropertiesOpen` | Synth properties disclosure | boolean | `SequencerPatchDocument.ui.synthPropertiesOpen` | Persistence only | UI-only |

## Core Sequencer Score

These fields define the base subdivision-switch score. They are the highest
priority for automation and parity testing because the timeline and MIDI must
come from the same resolved request.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `sequencer.name` | Score name | text | `PatchSequencerState.name` | Persistence, export naming | Structural/text |
| `sequencer.cycleBeats` | Beats per cycle | integer `1..64` | `PatchSequencerState.cycleBeats` | Persistence, preview, playback | Structural |
| `sequencer.pitch` | Base MIDI pitch | integer `0..127` | `SwitchRequestData.pitch` | Persistence, preview, playback | Current |
| `sequencer.velocity` | Base MIDI velocity | integer `1..127` | `SwitchRequestData.velocity` | Persistence, preview, playback | Current |
| `sequencer.initialWeights[*].subdivision` | Initial gati option | integer, normally `3,4,5,7...` | `SubdivisionWeight.subdivision` | Persistence, preview, playback | Structural for option list |
| `sequencer.initialWeights[*].weight` | Initial gati weight | weight `>=0` | `SubdivisionWeight.weight` | Persistence, preview, playback | Current via `sequencer.initial.gati.{subdivision}.weight` |
| `sequencer.initialJathiWeights[*].jathi` | Initial jathi option | enum/int `3,4,5,6,7,9,11` | `JathiWeight.jathi` | Persistence, preview, playback | Structural for option list |
| `sequencer.initialJathiWeights[*].weight` | Initial jathi weight | weight `>=0` | `JathiWeight.weight` | Persistence, preview, playback | Current via `sequencer.initial.jathi.{jathi}.weight` |
| `sequencer.boundaries[*].id` | Boundary stable id | text | `BoundaryPoint.id` | Persistence, automation target stability | Structural |
| `sequencer.boundaries[*].afterBeat` | Boundary position | integer beat index | `BoundaryPoint.afterBeat` -> `SubdivisionInflection.after_beat` | Persistence, preview, playback | Structural |
| `sequencer.boundaries[*].changeProbability` | Boundary chance | float `0..1` | `BoundaryPoint.changeProbability` | Persistence, preview, playback | Current via `sequencer.boundary.{id}.probability` |
| `sequencer.boundaries[*].weights[*].subdivision` | Boundary gati option | integer | `BoundaryPoint.weights[].subdivision` | Persistence, preview, playback | Structural |
| `sequencer.boundaries[*].weights[*].weight` | Boundary gati weight | weight `>=0` | `BoundaryPoint.weights[].weight` | Persistence, preview, playback | Current via `sequencer.boundary.{id}.gati.{subdivision}.weight` |
| `sequencer.boundaries[*].jathiWeights[*].jathi` | Boundary jathi option | enum/int `3,4,5,6,7,9,11` | `BoundaryPoint.jathiWeights[].jathi` | Persistence, preview, playback | Structural |
| `sequencer.boundaries[*].jathiWeights[*].weight` | Boundary jathi weight | weight `>=0` | `BoundaryPoint.jathiWeights[].weight` | Persistence, preview, playback | Current via `sequencer.boundary.{id}.jathi.{jathi}.weight` |
| `sequencer.sectionCountWeights[*].count` | Max-section count option | integer `>=0` | `SwitchCountWeight.count` | Persistence, preview, playback | Structural |
| `sequencer.sectionCountWeights[*].weight` | Max-section count weight | weight `>=0` | `SwitchCountWeight.weight` | Persistence, preview, playback | Current via `sequencer.sectionCount.{count}.weight` |
| `sequencer.singleParameterRhythmicModulation` | Single-parameter modulation | boolean | `SwitchRequestData.singleParameterRhythmicModulation` | Persistence, preview, playback | Current |
| `sequencer.userPreviewCycle` | Inspected stopped cycle | integer `0..10000` | `PatchSequencerState.userPreviewCycle` | Persistence normalization, bounded stopped-preview controls, preview only | UI-only for automation |

## Global Seed Strategy

Seed values are editable and sound-changing. They should be tested for
determinism and persisted recall. They should not be interpolated as continuous
automation without an explicit seed-change policy.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `sequencer.seedMode` | Global seed mode | enum `locked`, `perCycle`, `history`, `drift`, `morph` | `PatchSequencerState.seedMode` | Persistence, deterministic preview/playback | Structural/discrete |
| `sequencer.seed` | Global seed | integer `>=0` | `PatchSequencerState.seed` | Persistence, deterministic preview/playback | Structural/discrete |
| `sequencer.historySeeds` | Global seed history | list of integers | `PatchSequencerState.historySeeds` | Persistence, history behavior | Structural |
| `sequencer.historyWeight` | Existing-history weight | weight `>=0` | `PatchSequencerState.historyWeight` | Persistence, history behavior | Phase 3 discrete/weight |
| `sequencer.newSeedWeight` | New-seed weight | weight `>=0` | `PatchSequencerState.newSeedWeight` | Persistence, history behavior | Phase 3 discrete/weight |
| `sequencer.maxHistory` | Max history length | integer `0..64` | `PatchSequencerState.maxHistory` | Persistence, history behavior | Structural |
| `sequencer.newSeedChance` | Drift/Morph new-seed chance | percent `0..100` | `PatchSequencerState.newSeedChance` | Persistence, drift + morph behavior | Structural |
| `sequencer.holdChance` | Morph repeat chance | percent `0..100` | `PatchSequencerState.holdChance` | Persistence, morph behavior | Structural |
| `sequencer.blendCycles` | Morph blend width | integer `1..64` | `PatchSequencerState.blendCycles` | Persistence, morph behavior | Structural |

## Generator (Dum-Ka)

The generator panel authors one `PatchGeneratorConfig` per track (plus the
flat single-track mirror). The pattern is persisted verbatim — canonical
form is the Rust parser's job — and every percent knob round-trips as an
integer because the Rust side deserializes `u32` (`patchIo.ts` rounds
before clamping). Weights are authored-only; the three percent knobs are
cycle-start automation targets sampled per historical cycle inside the
evolution fold.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `track.generatorEnabled` | Generator on/off | boolean | `PatchTrackState.generatorEnabled` | Persistence, preview, playback, disabled byte-identity | Structural |
| `generator.kind` | Generator kind | enum `example`, `dumka` | `PatchGeneratorConfig.kind` | Persistence (unknown kind disables with warning), preview, playback | Structural/discrete |
| `generator.dumka.pattern` | Seed pattern textarea | string, ≤4096 code points, Dum-Ka notation | `PatchGeneratorConfig.pattern` | Persistence verbatim, parse diagnostics, preview, playback | Structural |
| `generator.dumka.seedMode` | Generator seed mode | enum `locked`, `perCycle`, `history` | `PatchGeneratorConfig.seedMode` | Persistence, deterministic trajectory replay | Structural/discrete |
| `generator.dumka.evolutionRate` | Evolution rate | percent `0..100` | `PatchGeneratorConfig.evolutionRate` | Persistence, preview, playback (rate 0 = seed verbatim) | Current (`generator.dumka.evolutionRate`, cycleStart) |
| `generator.dumka.driftLeash` | Drift leash | percent `0..100` | `PatchGeneratorConfig.driftLeash` | Persistence, preview, playback, leash invariants | Current (`generator.dumka.driftLeash`, cycleStart) |
| `generator.dumka.densityFloor` | Density corridor floor | percent `0..100`, ≤ ceiling | `PatchGeneratorConfig.densityFloor` | Persistence, preview/playback fold, normalization and clamp trace | Current (`generator.dumka.densityFloor`, cycleStart) |
| `generator.dumka.densityCeiling` | Density corridor ceiling | percent `0..100`, ≥ floor | `PatchGeneratorConfig.densityCeiling` | Persistence, preview/playback fold, Fragment/Consolidate plateau | Current (`generator.dumka.densityCeiling`, cycleStart) |
| `generator.dumka.barlowTemperature` | Barlow temperature | percent `0..100` | `PatchGeneratorConfig.barlowTemperature` | Persistence, preview, playback, pool-widening determinism | Current (`generator.dumka.barlowTemperature`, cycleStart) |
| `generator.dumka.weightBarlowRemove` | Remove weight | weight `0..100` | `PatchGeneratorConfig.weightBarlowRemove` | Persistence, preview, playback (default 3) | Structural |
| `generator.dumka.weightBarlowAdd` | Add weight | weight `0..100` | `PatchGeneratorConfig.weightBarlowAdd` | Persistence, preview, playback (default 3) | Structural |
| `generator.dumka.weightRotate` | Rotate weight | weight `0..100` | `PatchGeneratorConfig.weightRotate` | Persistence, preview, playback (default 2) | Structural |
| `generator.dumka.weightSyncopate` | Syncopate weight | weight `0..100` | `PatchGeneratorConfig.weightSyncopate` | Persistence, preview, playback (default 0, opt-in) | Structural |
| `generator.dumka.weightDesyncopate` | Desyncopate weight | weight `0..100` | `PatchGeneratorConfig.weightDesyncopate` | Persistence, preview, playback (default 0, opt-in) | Structural |
| `generator.dumka.weightFragment` | Fragment weight | weight `0..100` | `PatchGeneratorConfig.weightFragment` | Persistence, preview, playback (default 0, opt-in) | Structural |
| `generator.dumka.weightConsolidate` | Consolidate weight | weight `0..100` | `PatchGeneratorConfig.weightConsolidate` | Persistence, preview, playback (default 0, opt-in) | Structural |
| `generator.dumka.fillComplexity` | Fill complexity | percent `0..100` | `PatchGeneratorConfig.fillComplexity` | Persistence, preview, playback, figure-size pool determinism | Current (`generator.dumka.fillComplexity`, cycleStart) |
| `generator.dumka.weightEuclid` | Reshape weight | weight `0..100` | `PatchGeneratorConfig.weightEuclid` | Persistence, preview, playback (default 0, opt-in) | Structural |
| `generator.dumka.euclidMaxRun` | Reshape max run | integer `1..8` | `PatchGeneratorConfig.euclidMaxRun` | Persistence, preview, playback (pinned range error) | Structural |
| `generator.dumka.euclidInvert` | Reshape invert chance | percent `0..100` | `PatchGeneratorConfig.euclidInvert` | Persistence, preview, playback | Structural |
| `generator.dumka.euclidRestPolicy` | Reshape rest policy | enum `tied`, `silent` | `PatchGeneratorConfig.euclidRestPolicy` | Persistence, preview, playback | Structural/discrete |
| `generator.dumka.plan` | Evolve lane pins/ranges + inspector | ordered directive rows: family, cycles ≥1, intensity `0..100`, pacing, optional beat scope/options | `PatchGeneratorConfig.plan` | Persistence normalization/warnings, deterministic preview/playback fold, preview trace | Structural tuple; deliberately not an automation target |
| `generator.dumka.plan[*].pacing` | Evolve Transition control | enum `perCycle`, `linear`, `easeInOut`; absent defaults `perCycle`; Stochastic accepts only `perCycle` | `EvolutionDirective.pacing` | Legacy default identity, tolerant malformed-row warning, strict DTO validation, gradual schedule properties, preview/playback parity | Structural/discrete; not automation |
| `generator.dumka.plan[*].options.densityFloor/Ceiling` | Directive corridor override | paired percentages `0..100`, floor ≤ ceiling, or both absent | `DirectiveOptions.densityFloor` / `densityCeiling` | Strict/tolerant persistence fences, deterministic normalization, clamp trace | Structural/discrete; inherits global rails when absent |
| `generator.dumka.planLengthCycles` | Evolve view extent | integer `0..u32::MAX` (`0` = automatic UI extent) | `PatchGeneratorConfig.planLengthCycles` | Persistence and editor canvas only; engine ignores it | UI-only structural |

### Evolution curve (Evolve editor)

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `generator.dumka.evolutionCurve.enabled` | Curve enabled | boolean | `PatchGeneratorConfig.evolutionCurve.enabled` | Persistence, preview, playback (replaces stochastic layer) | Structural |
| `generator.dumka.evolutionCurve.toleranceMilli` | Curve tolerance | milli `0..100000` (shown /1000) | `evolutionCurve.toleranceMilli` | Persistence, trace verdicts | Structural |
| `generator.dumka.evolutionCurve.maxOperations` | Curve max operations | integer `1..8` | `evolutionCurve.maxOperations` | Persistence, budget validation | Structural |
| `generator.dumka.evolutionCurve.points[*]` | Curve breakpoints | `(cycle ≥ 1, targetMilli 0..100000)`, ≤64 points, span ≤512 | `evolutionCurve.points` | Persistence, step-size lane bands, fold targets | Structural |

## Accent Settings

Accent ranges are sampled during beat realization. The min/max fields are
current automation targets; the mode is a discrete semantic choice.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `sequencer.accent.beatStart.min` | Beat accent min | integer `0..127` | `AccentSettings.beatStart.min` | Persistence, preview, playback | Current |
| `sequencer.accent.beatStart.max` | Beat accent max | integer `0..127` | `AccentSettings.beatStart.max` | Persistence, preview, playback | Current |
| `sequencer.accent.sectionStartExtra.min` | Section accent min | integer `0..127` | `AccentSettings.sectionStartExtra.min` | Persistence, preview, playback | Current |
| `sequencer.accent.sectionStartExtra.max` | Section accent max | integer `0..127` | `AccentSettings.sectionStartExtra.max` | Persistence, preview, playback | Current |
| `sequencer.accent.jathiStart.min` | Jathi accent min | integer `0..127` | `AccentSettings.jathiStart.min` | Persistence, preview, playback | Current |
| `sequencer.accent.jathiStart.max` | Jathi accent max | integer `0..127` | `AccentSettings.jathiStart.max` | Persistence, preview, playback | Current |
| `sequencer.accent.jathiMode` | Jathi accent mode | enum `overrideGati`, `layered` | `AccentSettings.jathiMode` | Persistence, preview, playback | Phase 3 discrete |

## Automation Authoring

Automation points use exact normalized rational time, not low-precision floats.
The UI currently uses a large denominator when converting percent edits, while
the model stores `{ numer, denom }` and compares by cross multiplication.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `automation.lengthCycles` | Top-level automation length | integer `1..1_000_000` cycles | `AutomationSet.lengthCycles` | Persistence, preview stretching, playback wrapping | Structural |
| `automation.markers[*].id` | Marker id | text | `AutomationMarker.id` | Persistence, snapping stability | Structural |
| `automation.markers[*].time` | Marker position | rational time `0..1` | `AutomationMarker.time` | Persistence, graph snapping | Structural for marker topology |
| `automation.markers[*].label` | Marker label | text | `AutomationMarker.label` | Persistence | UI/label |
| `automation.tracks[*].id` | Automation lane id | text | `AutomationTrack.id` | Persistence | Structural |
| `automation.tracks[*].target` | Lane target | text target id | `AutomationTrack.target` | Persistence, evaluation | Structural |
| `automation.tracks[*].enabled` | Lane enabled | boolean | `AutomationTrack.enabled` | Persistence, evaluation | Structural/discrete |
| `automation.tracks[*].combine` | Lane combine mode | enum `replace`, `add`, `multiply` | `AutomationTrack.combine` | Persistence, evaluation | Structural/discrete |
| `automation.tracks[*].curves[*].id` | Curve id | text | `AutomationCurve.id` | Persistence | Structural |
| `automation.tracks[*].curves[*].enabled` | Curve enabled | boolean | `AutomationCurve.enabled` | Persistence, evaluation | Structural/discrete |
| `automation.tracks[*].curves[*].interpolation` | Curve interpolation | enum `hold`, `linear`, `smooth` | `AutomationCurve.interpolation` | Persistence, evaluation | Structural/discrete |
| `automation.tracks[*].curves[*].points[*].id` | Point id | text/null | `AutomationPoint.id` | Persistence, editing | Structural |
| `automation.tracks[*].curves[*].points[*].time` | Point time | rational time `0..1` | `AutomationPoint.time` | Persistence, evaluation | Structural for point topology |
| `automation.tracks[*].curves[*].points[*].value.type` | Point value type | enum `number`, `bool`, `text` | `AutomationValue.type` | Persistence, evaluation | Structural/discrete |
| `automation.tracks[*].curves[*].points[*].value.value` | Point value | number/bool/text | `AutomationValue.value` | Persistence, evaluation | N/A: the value drives another target |
| `automation.tracks[*].curves[*].points[*].anchorId` | Marker anchor | text/null | `AutomationPoint.anchorId` | Persistence, snapping | Structural |
| `automation.tracks[*].curves[*].points[*].outCurve.kind` | Segment curve type | enum `hold`, `linear`, `smooth`, `easeIn`, `easeOut`, `easeInOut`, `exponential` | `AutomationSegmentCurve.kind` | Persistence, evaluation | Structural/discrete |
| `automation.tracks[*].curves[*].points[*].outCurve.amount` | Segment curve amount | float `0..1` | `AutomationSegmentCurve.amount` | Persistence, evaluation | Structural/curve value |
| `ui.automationOpen` | Automation panel open | boolean | `SequencerPatchDocument.ui.automationOpen` | Persistence only | UI-only |
| `automationTargetSearch` | Target search field | text | React state only | UI test only | UI-only |
| `automationTargetGroupFilter` | Target group filter | enum/string | React state only | UI test only | UI-only |
| `automationTargetKindFilter` | Target type filter | enum/string | React state only | UI test only | UI-only |
| `selectedAutomationTrackId` | Selected lane | id/null | React state only | UI test only | UI-only |
| `selectedAutomationCurveId` | Selected curve | id/null | React state only | UI test only | UI-only |
| `selectedAutomationPointId` | Selected point | id/null | React state only | UI test only | UI-only |
| `selectedAutomationSegmentPointId` | Selected segment | id/null | React state only | UI test only | UI-only |
| `automationMarkerPhaseInput` | New marker percent | float percent | React state only | UI test only | UI-only |
| `automationMarkerLabelInput` | New marker label input | text | React state only | UI test only | UI-only |

Current automation target families:

- `sequencer.pitch`
- `sequencer.velocity`
- `sequencer.singleParameterRhythmicModulation`
- `sequencer.accent.beatStart.min`
- `sequencer.accent.beatStart.max`
- `sequencer.accent.sectionStartExtra.min`
- `sequencer.accent.sectionStartExtra.max`
- `sequencer.accent.jathiStart.min`
- `sequencer.accent.jathiStart.max`
- `sequencer.initial.gati.{subdivision}.weight`
- `sequencer.initial.jathi.{jathi}.weight`
- `sequencer.boundary.{boundaryId}.probability`
- `sequencer.boundary.{boundaryId}.gati.{subdivision}.weight`
- `sequencer.boundary.{boundaryId}.jathi.{jathi}.weight`
- `sequencer.sectionCount.{count}.weight`

## Rhythm Shaper: Matrix Authoring

The Rhythm Shaper edits Markov chains over protected pulse spans. These values
are musical/playback values and should be Phase 3 automation targets. Matrix
cells are dynamic: a complete test matrix must generate every visible state and
transition family for first-order and second-order modes.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `rhythm.rhythmOpen` | Rhythm Shaper open | boolean | `PatchRhythmState.rhythmOpen` | Persistence only | UI-only |
| `rhythm.rhythmTab` | Rhythm tab | enum `patterns`, `resubdivision`, `flux`, `ratchet`, `ornaments`, `seeds` | `PatchRhythmState.rhythmTab` | Persistence only | UI-only |
| `rhythm.rhythmLength` | Edited span length | integer `1..64` | `PatchRhythmState.rhythmLength` | Persistence, matrix UI | UI selector |
| `rhythm.rhythmOrder` | Markov order | enum `first`, `second` | `RhythmChainSpec.order` | Persistence, preview, playback | Phase 3 discrete |
| `rhythm.selectedKeysByLength[spanLen]` | Active state subset | list of pattern keys | `PatchRhythmState.selectedKeysByLength` | Persistence, preview, playback | Structural |
| `rhythm.weights[transitionKey]` | Markov transition cell | weight `0..999` | `RhythmTransition.weight` | Persistence, preview, playback | Phase 3 |
| `rhythm.entryWeightsByLength[spanLen][entryKey]` | Entry selector cell | weight `0..999` | `RhythmEntryWeight.weight` | Persistence, preview, playback | Phase 3 |
| `rhythm.fallback` | Static fallback state | integer state index | `RhythmChainSpec.fallback` | Persistence, preview, playback | Phase 3 |
| `rhythm.fallbackMode` | Fallback mode | enum `static`, `weighted` | UI -> fallback request | Persistence, preview, playback | Phase 3 discrete |
| `rhythm.fallbackWeightsByLength[spanLen][state]` | Weighted fallback cell | weight `0..999` | `RhythmFallbackWeight.weight` | Persistence, preview, playback | Phase 3 |
| `rhythm.rhythmSeedBehavior` | Rhythm seed behavior | enum `followGlobal`, `locked`, `perCycle`, `history`, `drift`, `morph` | `RhythmSeedMode` | Persistence, deterministic preview/playback | Structural/discrete |
| `rhythm.rhythmSeed` | Rhythm seed | integer `>=0` | `PatchRhythmState.rhythmSeed` | Persistence, deterministic preview/playback | Structural/discrete |
| `rhythm.historySeeds` | Rhythm seed history | list integers | `PatchRhythmState.historySeeds` | Persistence, history behavior | Structural |
| `rhythm.historyWeight` | Rhythm history weight | weight `>=0` | `PatchRhythmState.historyWeight` | Persistence, history behavior | Phase 3 |
| `rhythm.newSeedWeight` | Rhythm new seed weight | weight `>=0` | `PatchRhythmState.newSeedWeight` | Persistence, history behavior | Phase 3 |
| `rhythm.maxHistory` | Rhythm max history | integer `0..64` | `PatchRhythmState.maxHistory` | Persistence, history behavior | Structural |
| `rhythm.newSeedChance` | Rhythm drift/morph new-seed chance | percent `0..100` | `PatchRhythmState.newSeedChance` | Persistence, drift + morph behavior | Structural |
| `rhythm.holdChance` | Rhythm morph repeat chance | percent `0..100` | `PatchRhythmState.holdChance` | Persistence, morph behavior | Structural |
| `rhythm.blendCycles` | Rhythm morph blend width | integer `1..64` | `PatchRhythmState.blendCycles` | Persistence, morph behavior | Structural |

## Rhythm Shaper: Copy, Extrapolate, And Passage Tools

These are authoring controls. They can write normal matrix cells, but the tool
settings themselves are not playback parameters once materialized.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `rhythm.rhythmExtrapolateFrom` | Source span length | integer `1..64` | `PatchRhythmState.rhythmExtrapolateFrom` | Persistence, UI action tests | UI/tool |
| `rhythm.rhythmExtrapolationStrategy` | Extrapolation strategy | enum `boundaryProjection`, `densityPreserving`, `shapePreserving`, `hybridTransport`, `sparseNearest` | `PatchRhythmState.rhythmExtrapolationStrategy` | Persistence, extrapolate tests | UI/tool |
| `rhythm.rhythmMaterializeMode` | Write mode | enum `replace`, `fillEmpty` | `PatchRhythmState.rhythmMaterializeMode` | Persistence, extrapolate tests | UI/tool |
| `rhythm.copyTargetMode` | Copy target mode | enum `all`, `selected` | `PatchRhythmState.copyTargetMode` | Persistence, copy tests | UI/tool |
| `rhythm.copySelectedTargets` | Selected copy target lengths | list integers | `PatchRhythmState.copySelectedTargets` | Persistence, copy tests | UI/tool |
| `rhythm.passageInput` | Passage pulse list | text | `PatchRhythmState.passageInput` | Persistence, import tests | UI/tool |
| `rhythm.passageStrategy` | Passage learning strategy | enum `metricChunks`, `pulseWindows`, `matraWindows`, `hybridVocabulary` | `PatchRhythmState.passageStrategy` | Persistence, import tests | UI/tool |
| `rhythm.passageOrder` | Passage Markov order | enum `first`, `second` | `PatchRhythmState.passageOrder` | Persistence, import tests | UI/tool |
| `rhythm.passageFitStrategy` | Passage fit strategy | extrapolation enum | `PatchRhythmState.passageFitStrategy` | Persistence, import tests | UI/tool |
| `rhythm.passageTargetMode` | Passage target mode | enum `all`, `selected` | `PatchRhythmState.passageTargetMode` | Persistence, import tests | UI/tool |
| `rhythm.passageSelectedTargets` | Passage target lengths | list integers | `PatchRhythmState.passageSelectedTargets` | Persistence, import tests | UI/tool |
| `rhythm.passageHelpOpen` | Passage help open | boolean | `PatchRhythmState.passageHelpOpen` | Persistence only | UI-only |

## Rhythm Articulation

Articulation cells change whether rhythm cells play, rest, or tie. These are
musical values and should become automation targets per span, state, and cell.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `rhythm.articulation.open` | Articulation section open | boolean | `PatchRhythmArticulationState.open` | Persistence only | UI-only |
| `rhythm.articulation.cells[cellKey].restProbabilityPercent` | Cell rest chance | integer percent `0..100` | `RhythmCellArticulation.restProbability` | Persistence, preview, playback | Phase 3 |
| `rhythm.articulation.cells[cellKey].tieProbabilityPercent` | Cell tie chance | integer percent `0..100`, capped by rest | `RhythmCellArticulation.tieProbability` | Persistence, preview, playback | Phase 3 |
| `rhythm.articulation.tieOverAccentProbabilityPercent` | Tie over accent chance | integer percent `0..100` | `RhythmArticulationSpec.tieOverAccentProbability` | Persistence, preview, playback | Phase 3 |
| `rhythm.articulation.restOverAccentProbabilityPercent` | Rest over accent chance | integer percent `0..100` | `RhythmArticulationSpec.restOverAccentProbability` | Persistence, preview, playback | Phase 3 |
| `rhythm.articulation.blend.mode` | Articulation blend mode | `manualOverrides`, `average`, `weighted` | `RhythmArticulationSpec.blend.mode` | Persistence, preview, playback | Not automated |
| `rhythm.articulation.blend.*Weight` | Articulation blend source weight | non-negative float | `RhythmArticulationSpec.blend` | Persistence, preview, playback | Not automated |
| `rhythm.articulation.fragmentPosition[role]` | Fragment-position rest/tie default | enabled plus integer rest/tie percent `0..100` | `RhythmArticulationSpec.fragmentPosition` | Persistence, preview, playback | Not automated |
| `rhythm.articulation.sectionPosition[role]` | Section-position rest/tie default | enabled plus integer rest/tie percent `0..100` | `RhythmArticulationSpec.sectionPosition` | Persistence, preview, playback | Not automated |
| `rhythm.articulation.cyclePosition[role]` | Cycle-position rest/tie default | enabled plus integer rest/tie percent `0..100` | `RhythmArticulationSpec.cyclePosition` | Persistence, preview, playback | Not automated |
| `rhythm.articulation.neighbor.*MultiplierPercent` | Follow-rule outcome multiplier | integer percent `0..200` | `RhythmArticulationSpec.neighborRules` | Persistence, preview, playback | Not automated |

## Beat Locks (source-product history; removed from Seqstart)

Beat locks pin the resolved rhythm across a beat range to a fixed/weighted
pattern (or pass-through) after Markov resolution, without touching the Markov
chain. Patterns must exactly tile the window `M = Σ gati` over the locked beats.
The dedicated source-product design documents were removed during extraction.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `rhythm.beatLocks.open` | Beat-locks section open | boolean | `PatchRhythmState.beatLocks.open` | Persistence only | UI-only |
| `rhythm.beatLocks.seed` | Beat-locks domain seed | integer `>=0` | `BeatLockSpec.seed` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].enabled` | Lock on/off | boolean | `BeatLock.enabled` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].mode` | Assignment mode | enum `span`, `perBeat` (perBeat expands to one engine lock per covered beat) | `PatchBeatLock.mode` (FE expansion in `beatLockSpecFromPatch`) | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].startBeat` | Lock first beat | integer 0-based cycle beat | `BeatLock.startBeat` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].endBeat` | Lock last beat | integer 0-based cycle beat, inclusive | `BeatLock.endBeat` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].patterns[n].pulses` | Locked pattern pulses | list of matra counts (must tile `M`) | `WeightedLockPattern.pattern.pulses` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].patterns[n].weight` | Locked pattern weight | weight `0..999` | `WeightedLockPattern.weight` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].patterns[n].cells[c].restProbabilityPercent` | Per-matra rest chance (lock pattern cell) | integer percent `0..100` | `LockCellArticulation.restProbabilityPercent` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].patterns[n].cells[c].tieProbabilityPercent` | Per-matra tie chance (lock pattern cell) | integer percent `0..100`, capped by rest | `LockCellArticulation.tieProbabilityPercent` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].unlockedWeight` | Pass-through weight | weight `0..999` | `BeatLock.unlockedWeight` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].allowTieIn` | Allow tie into first cell | boolean | `BeatLock.allowTieIn` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].allowTieOut` | Allow tie out of last cell | boolean | `BeatLock.allowTieOut` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].allowArticulation` | Apply GLOBAL rest/tie layers to locked cells | boolean | `BeatLock.allowArticulation` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].restProbabilityPercent` | Lock-local rest chance | integer percent `0..100` | `BeatLock.restProbabilityPercent` | Persistence, preview, playback | Not automated |
| `rhythm.beatLocks.locks[id].tieProbabilityPercent` | Lock-local tie chance | integer percent `0..100`, capped by rest | `BeatLock.tieProbabilityPercent` | Persistence, preview, playback | Not automated |

## Shape Groups (source-product history; removed from Seqstart)

Select structure (beats / rhythm cells / note groups) and transform it —
articulation-stage rest/tie/force, playbackFinalize velocity/pitch. See
The dedicated source-product design document was removed during extraction.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `rhythm.shapeGroups.open` | Shape-groups section open | boolean | `PatchRhythmState.shapeGroups.open` | Persistence only | UI-only |
| `rhythm.shapeGroups.seed` | Shape-groups domain seed | integer `>=0` | `ShapeGroupSet.seed` | Persistence, preview, playback | Not automated |
| `rhythm.shapeGroups.groups[id].enabled` | Group on/off | boolean | `ShapeGroupSpec.enabled` | Persistence, preview, playback | Not automated |
| `rhythm.shapeGroups.groups[id].name` | Group name | string ≤64 | `ShapeGroupSpec.name` | Persistence only | UI-only |
| `rhythm.shapeGroups.groups[id].stage` | Pipeline stage | enum `articulation`, `playbackFinalize` | `ShapeGroupSpec.stage` | Persistence, preview, playback | Structural |
| `rhythm.shapeGroups.groups[id].domain` | Selection domain | enum `beat`, `rhythmCell`, `noteGroup` (stage-gated) | `ShapeGroupSpec.domain` | Persistence, preview, playback | Structural |
| `rhythm.shapeGroups.groups[id].selection` | Selection expression | tagged union (explicit/metric/structural/Euclidean + and/or/not) | `ShapeGroupSpec.selection` | Persistence, preview, playback | Structural |
| `rhythm.shapeGroups.groups[id].chancePercent` | "2 · Chance — fires N% of the time" | integer 0–100 (100 = always; one draw per selected unit, shared by all ops) | `ShapeGroupSpec.chance_percent` | Persistence, preview (articulation stage), playback | Not automated |
| `rhythm.shapeGroups.groups[id].operations[n]` | Operation | tagged union, stage-gated (`restProbability`/`tieProbability`/`forcePlay`; `scaleVelocity`/`setVelocity`/`transposePitch`/`randomizePitch`/`randomWalkPitch`/`accumulatePitch`/`invertPitch`/`stretchIntervals`/`quantizePitchToCollection`/`triggerRatchet`/`triggerOrnament`) | `ShapeGroupSpec.operations` | Persistence, preview, playback | Not automated (Macro Bus is phase 3) |
| `rhythm.shapeGroups.groups[id].operations[n].respectCooldown` | Trigger op "respect cooldown" switch | boolean (default true; false = bypass the panel cooldown and leave it untouched) | `TriggerRatchet`/`TriggerOrnament.respect_cooldown` | Persistence, playback (triggers are transport-only) | Not automated |

## Gati Speed And Jathi Timing

These weights choose speed multipliers in a context of gati or jathi value.
They affect protected spans before Markov grouping.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `rhythm.speedSubdivisionWeights[{contextKind}:{contextValue}:{choiceId}]` | Speed/timing choice weight | weight `>=0` | `RhythmSpeedSpec.choices` | Persistence, preview, playback | Phase 3 |
| `rhythmSpeedEditorKind` | Speed editor kind | enum `gati`, `jathi` | React state only | UI test only | UI-only |
| `rhythmSpeedEditorValue` | Speed editor value | integer span value | React state only | UI test only | UI-only |

## Arbitrary Subdivision

Arbitrary subdivision reinterprets active protected spans into virtual targets
before rhythm grouping. It must preserve protected cuts or skip the span.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `rhythm.arbitrarySubdivision.probabilityPercent` | Re-subdivision chance | float percent `0..100` | `ArbitrarySubdivisionSpec.probability` | Persistence, preview, playback | Phase 3 |
| `rhythm.arbitrarySubdivision.targets[*].spanLen` | Target span option | integer | `WeightedSubdivisionTarget.spanLen` | Persistence, preview, playback | Structural |
| `rhythm.arbitrarySubdivision.targets[*].weight` | Target span weight | weight `>=0` | `WeightedSubdivisionTarget.weight` | Persistence, preview, playback | Phase 3 |
| `rhythm.arbitrarySubdivision.clumpLengths[*].count` | Clump count option | integer `>0` | `WeightedClumpLength.count` | Persistence, preview, playback | Structural |
| `rhythm.arbitrarySubdivision.clumpLengths[*].weight` | Clump count weight | weight `>=0` | `WeightedClumpLength.weight` | Persistence, preview, playback | Phase 3 |
| `rhythm.arbitrarySubdivision.allowTrivialPattern` | Allow trivial pattern | boolean | `ArbitrarySubdivisionSpec.allowTrivialPattern` | Persistence, preview, playback | Phase 3 |
| `rhythm.arbitrarySubdivision.patternSource` | Pattern source | enum `markov`, `weightedPool` | `ArbitrarySubdivisionSpec.patternSource` | Persistence, preview, playback | Phase 3 discrete |
| `rhythm.arbitrarySubdivision.poolWeightsByLength[spanLen][patternKey]` | Weighted pool pattern cell | weight `>=0` | `WeightedArbitrarySubdivisionCell.weight` | Persistence, preview, playback | Phase 3 |
| `arbitraryPoolEditorLength` | Pool editor selected length | integer | React state only | UI test only | UI-only |

## Ratchet Playback

Ratchet is playback-only: it rewrites a cycle-local MIDI queue after rhythm and
before channel/pitch post-processing. It must never mutate the underlying rhythm
tree. All sound-changing values below are Phase 3 automation candidates.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `rhythm.ratchet.enabled` | Ratchet on/off | boolean | `PatchRhythmState.ratchet.enabled` | Persistence, playback diagnostics | Phase 3 |
| `rhythm.ratchet.spec.seed` | Ratchet seed | integer `>=0` | `RatchetPlaybackSpec.seed` | Persistence, deterministic playback | Structural/discrete |
| `rhythm.ratchet.spec.probability` | Ratchet chance | float `0..1` | `RatchetPlaybackSpec.probability` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.speed.strategy` | Speed strategy | enum `audibleRate`, `pulsesPerMatra`, `beatRate` | `RatchetSpeedRange.strategy` | Persistence, playback | Phase 3 discrete |
| `rhythm.ratchet.spec.speed.min` | Speed min | float `>=0` | `RatchetSpeedRange.min` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.speed.max` | Speed max | float `>=0` | `RatchetSpeedRange.max` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.speed.distribution` | Speed distribution | enum `uniform`, `towardMedian`, `awayFromMedian`, `favorSlow`, `favorFast` | `RatchetSpeedRange.distribution` | Persistence, playback | Phase 3 discrete |
| `rhythm.ratchet.spec.curve` | Ratchet shape | enum `even`, `accelerando`, `retardando`, `accelerandoRetardando`, `retardandoAccelerando` | `RatchetPlaybackSpec.curve` | Persistence, playback | Phase 3 discrete |
| `rhythm.ratchet.spec.curveWeights.{curve}` | Weighted curve choice | weight `>=0` | `RatchetCurveWeights` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.cooldownMatras` | Cooldown amount | basis-normalized float | `RatchetPlaybackSpec.cooldownMatras` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.cooldownBasis` | Cooldown basis | enum `matras`, `milliseconds`, `beats`, `percentOfBeat` | `RatchetPlaybackSpec.cooldownBasis` | Persistence, playback | Phase 3 discrete |
| `rhythm.ratchet.spec.allowMultiMatra` | Allow multi-matra spans | boolean | `RatchetPlaybackSpec.allowMultiMatra` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.maxSpanMatras` | Global max span | integer `1..64` | `RatchetPlaybackSpec.maxSpanMatras` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.maxSpanMatrasBySubdivision[*].subdivision` | Per-gati gate key | integer | `RatchetSpanGateLimit.subdivision` | Persistence, playback | Structural |
| `rhythm.ratchet.spec.maxSpanMatrasBySubdivision[*].maxSpanMatras` | Per-gati max span | integer | `RatchetSpanGateLimit.maxSpanMatras` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.temporalEasing` | Easing amount | float `0..1` | `RatchetPlaybackSpec.temporalEasing` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.temporalEasingShape` | Easing shape | enum `humanize`, `humanizeTight`, `humanizeLoose`, `subtleAccelerando`, `subtleRetardando`, `sway`, `lilt` | `RatchetTemporalEasingShape` | Persistence, playback | Phase 3 discrete |
| `rhythm.ratchet.spec.temporalEasingProbability` | Easing chance | float `0..1` | `RatchetPlaybackSpec.temporalEasingProbability` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.temporalEasingWeights.{shape}` | Weighted easing shape | weight `>=0` | `RatchetTemporalEasingWeights` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.timeCurve.points[*].x` | Time curve x | float `0..1` | `RatchetTimeCurvePoint.x` | Persistence, playback | Structural for point topology |
| `rhythm.ratchet.spec.timeCurve.points[*].y` | Time curve y | float `0..1` | `RatchetTimeCurvePoint.y` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.timeCurve.variance` | Time curve variance | float `0..1` | `RatchetTimeCurveSpec.variance` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.timeCurve.interpolate` | Interpolate curves | boolean | `RatchetTimeCurveSpec.interpolate` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.timeCurve.interpolationMin` | Interpolation min | float `0..1` | `RatchetTimeCurveSpec.interpolationMin` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.timeCurve.interpolationMax` | Interpolation max | float `0..1` | `RatchetTimeCurveSpec.interpolationMax` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.timeCurve.choices[*].id` | Time preset id | enum preset id | `RatchetTimeCurveChoice.id` | Persistence, playback | Structural |
| `rhythm.ratchet.spec.timeCurve.choices[*].weight` | Time preset weight | weight `>=0` | `RatchetTimeCurveChoice.weight` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.velocity.enabled` | Velocity shaping on/off | boolean | `RatchetVelocitySpec.enabled` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.velocity.mode` | Velocity mode | enum `relative`, `absolute` | `RatchetVelocitySpec.mode` | Persistence, playback | Phase 3 discrete |
| `rhythm.ratchet.spec.velocity.min` | Velocity min | integer, relative `-64..64` or absolute `1..127` | `RatchetVelocitySpec.min` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.velocity.max` | Velocity max | integer, relative `-64..64` or absolute `1..127` | `RatchetVelocitySpec.max` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.velocity.center` | Velocity gravity center | integer, mode-dependent | `RatchetVelocitySpec.center` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.velocity.attraction` | Velocity attraction | float `0..1` | `RatchetVelocitySpec.attraction` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.velocity.sameProbability` | Same velocity chance | float `0..1` | `RatchetVelocitySpec.sameProbability` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.internalRhythm.enabled` | Internal ratchet rhythm | boolean | `RatchetInternalRhythmSpec.enabled` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.internalRhythm.minCount` | Internal min hit count | integer `2..64` | `RatchetInternalRhythmSpec.minCount` | Persistence, playback | Phase 3 |
| `rhythm.ratchet.spec.internalRhythm.maxCount` | Internal max hit count | integer `0..64` | `RatchetInternalRhythmSpec.maxCount` | Persistence, playback | Phase 3 |

Shared ratchet-style modifier fields apply to ratchet, grace notes, and delay.
For each modifier owner (`ratchet`, `ornament.grace`, `ornament.delay`) test
the following:

- `modifiers.slowNote.enabled`
- `modifiers.slowNote.threshold`
- `modifiers.slowNote.basis`
- `modifiers.slowNote.multiplier`
- `modifiers.slowNote.operation`
- `modifiers.fastNote.enabled`
- `modifiers.fastNote.threshold`
- `modifiers.fastNote.basis`
- `modifiers.fastNote.multiplier`
- `modifiers.fastNote.operation`
- `modifiers.position.enabled`
- `modifiers.position.points[*].position`
- `modifiers.position.points[*].probability`
- `modifiers.position.points[*].speed`
- `modifiers.accentSpanStart`
- `modifiers.accentSpanEnd`
- `modifiers.sectionStart`
- `modifiers.sectionEnd`
- `modifiers.cycleStart`
- `modifiers.cycleEnd`
- `modifiers.operations.accentSpanStart`
- `modifiers.operations.accentSpanEnd`
- `modifiers.operations.sectionStart`
- `modifiers.operations.sectionEnd`
- `modifiers.operations.cycleStart`
- `modifiers.operations.cycleEnd`

## Ornaments And Delay

Grace notes and delay ornaments are playback-only rewrites with their own seed.
Pitch and channel behavior for the generated notes is controlled in the Pitch
Shaper and Channel Hocket sections.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `rhythm.ornament.enabled` | Ornaments on/off | boolean | `PatchRhythmState.ornament.enabled` | Persistence, playback diagnostics | Phase 3 |
| `ornamentTab` | Ornament subtab | enum `grace`, `delay` | React state only | UI test only | UI-only |
| `rhythm.ornament.spec.seed` | Ornament seed | integer `>=0` | `OrnamentPlaybackSpec.seed` | Persistence, deterministic playback | Structural/discrete |
| `rhythm.ornament.spec.grace.placementWeights.beforeBeat` | Before-beat placement weight | weight percent-ish | `GraceNotePlacementWeights.beforeBeat` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.grace.placementWeights.onBeat` | On-beat placement weight | derived from before-beat UI | `GraceNotePlacementWeights.onBeat` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.grace.probability` | Grace probability | float `0..1` | `GraceNoteSpec.probability` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.grace.countWeights.single` | Single grace weight | weight `>=0` | `GraceNoteCountWeights.single` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.grace.countWeights.double` | Double grace weight | weight `>=0` | `GraceNoteCountWeights.double` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.grace.countWeights.triple` | Triple grace weight | weight `>=0` | `GraceNoteCountWeights.triple` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.grace.duration` | Grace duration | float, basis-dependent | `GraceNoteSpec.duration` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.grace.durationBasis` | Grace duration basis | enum `milliseconds`, `percentOfBeat` | `GraceNoteSpec.durationBasis` | Persistence, playback | Phase 3 discrete |
| `rhythm.ornament.spec.grace.cooldown` | Grace cooldown | basis-dependent float | `GraceNoteSpec.cooldown` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.grace.cooldownBasis` | Grace cooldown basis | enum `matras`, `milliseconds`, `beats`, `percentOfBeat` | `GraceNoteSpec.cooldownBasis` | Persistence, playback | Phase 3 discrete |
| `rhythm.ornament.spec.grace.allowRests` | Allow grace on rests | boolean | `GraceNoteSpec.allowRests` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.grace.velocity.*` | Grace velocity shaper | same fields as ratchet velocity | `GraceNoteSpec.velocity` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.grace.modifiers.*` | Grace probability modifiers | shared modifier fields above | `GraceNoteSpec.modifiers` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.delay.enabled` | Delay on/off | boolean | `DelayOrnamentSpec.enabled` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.delay.probability` | Delay probability | float `0..1` | `DelayOrnamentSpec.probability` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.delay.quantization` | Delay quantization | enum `unquantized`, `quantized` | `DelayOrnamentSpec.quantization` | Persistence, playback | Phase 3 discrete |
| `rhythm.ornament.spec.delay.distribution` | Delay distribution | enum `uniform`, `early`, `late`, `center`, `edges` | `DelayOrnamentSpec.distribution` | Persistence, playback | Phase 3 discrete |
| `rhythm.ornament.spec.delay.basis` | Delay basis | enum `matras`, `milliseconds`, `beats`, `percentOfBeat` | `DelayOrnamentSpec.basis` | Persistence, playback | Phase 3 discrete |
| `rhythm.ornament.spec.delay.min` | Delay min | basis-dependent float | `DelayOrnamentSpec.min` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.delay.max` | Delay max | basis-dependent float | `DelayOrnamentSpec.max` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.delay.tuplets[*].tuplet` | Quantized delay tuplet | integer, normally `3,4,5,6,7,9,11` | `DelayTupletWeight.tuplet` | Persistence, playback | Structural |
| `rhythm.ornament.spec.delay.tuplets[*].weight` | Quantized delay tuplet weight | weight `>=0` | `DelayTupletWeight.weight` | Persistence, playback | Phase 3 |
| `rhythm.ornament.spec.delay.modifiers.*` | Delay probability modifiers | shared modifier fields above | `DelayOrnamentSpec.modifiers` | Persistence, playback | Phase 3 |

## Pitch Shaper

Pitch Shaper rewrites final note pitch after rhythm, ratchet, and ornaments.
It owns pitch-state authoring, pitch Markov transition weights, fallback, range
behavior, ratchet/ornament pitch policy, and transposition rules.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `pitchShaper.open` | Pitch Shaper open | boolean | `PatchPitchShaperState.open` | Persistence only | UI-only |
| `pitchShaper.enabled` | Pitch Shaper on/off | boolean | `PitchShaperSpec` null/non-null | Persistence, playback diagnostics | Phase 3 |
| `pitchShaper.tab` | Pitch tab | enum `collection`, `matrix`, `gracePitch`, `transpose`, `seeds` | `PatchPitchShaperState.tab` | Persistence only | UI-only |
| `pitchShaper.order` | Pitch Markov order | enum `first`, `second` | `PitchShaperSpec.order` | Persistence, playback | Phase 3 discrete |
| `pitchShaper.collectionId` | Pitch collection preset | enum preset id | `PatchPitchShaperState.collectionId` | Persistence, state generation | Structural/discrete |
| `pitchShaper.collectionTransposition` | Collection transposition | integer `0..11` | `collectionTransposition` | Persistence, state generation | Phase 3 |
| `pitchShaper.rangeLow` | State range low | integer `0..127` | `rangeLow` | Persistence, state generation | Structural |
| `pitchShaper.rangeHigh` | State range high | integer `0..127` | `rangeHigh` | Persistence, state generation | Structural |
| `pitchShaper.states[*].pitch` | Pitch state MIDI note | integer `0..127` | `PitchState.pitch` | Persistence, playback | Structural for state list; Phase 3 for state value if stable id added |
| `pitchShaper.states[*].label` | Pitch state label | text | `PitchState.label` | Persistence, UI | UI/label |
| `pitchShaper.weights[transitionKey]` | Pitch transition matrix cell | weight `0..999` | `PitchTransition.weight` | Persistence, playback | Phase 3 |
| `pitchShaper.entryWeights[entryKey]` | Pitch entry selector cell | weight `0..999` | `PitchEntryWeight.weight` | Persistence, playback | Phase 3 |
| `pitchShaper.fallback` | Static fallback state | integer state index | `PitchShaperSpec.fallback` | Persistence, playback | Phase 3 |
| `pitchShaper.fallbackMode` | Pitch fallback mode | enum `static`, `weighted` | UI -> fallback request | Persistence, playback | Phase 3 discrete |
| `pitchShaper.fallbackWeights[state]` | Weighted fallback state | weight `0..999` | `PitchFallbackWeight.weight` | Persistence, playback | Phase 3 |
| `pitchShaper.seedBehavior` | Pitch seed behavior | enum `followGlobal`, `locked`, `perCycle`, `history`, `drift`, `morph` | `RhythmSeedMode` | Persistence, deterministic playback | Structural/discrete |
| `pitchShaper.seed` | Pitch seed | integer `>=0` | `PatchPitchShaperState.seed` | Persistence, deterministic playback | Structural/discrete |
| `pitchShaper.historySeeds` | Pitch seed history | list integers | `PatchPitchShaperState.historySeeds` | Persistence, history behavior | Structural |
| `pitchShaper.historyWeight` | Pitch history weight | weight `>=0` | `PatchPitchShaperState.historyWeight` | Persistence, history behavior | Phase 3 |
| `pitchShaper.newSeedWeight` | Pitch new seed weight | weight `>=0` | `PatchPitchShaperState.newSeedWeight` | Persistence, history behavior | Phase 3 |
| `pitchShaper.maxHistory` | Pitch max history | integer `0..64` | `PatchPitchShaperState.maxHistory` | Persistence, history behavior | Structural |
| `pitchShaper.newSeedChance` | Pitch drift/morph new-seed chance | percent `0..100` | `PatchPitchShaperState.newSeedChance` | Persistence, drift + morph behavior | Structural |
| `pitchShaper.holdChance` | Pitch morph repeat chance | percent `0..100` | `PatchPitchShaperState.holdChance` | Persistence, morph behavior | Structural |
| `pitchShaper.blendCycles` | Pitch morph blend width | integer `1..64` | `PatchPitchShaperState.blendCycles` | Persistence, morph behavior | Structural |
| `pitchShaper.boundary.low` | Boundary low pitch | integer `0..127` | `PitchBoundary.low` | Persistence, playback | Phase 3 |
| `pitchShaper.boundary.high` | Boundary high pitch | integer `0..127` | `PitchBoundary.high` | Persistence, playback | Phase 3 |
| `pitchShaper.boundary.modulo` | Boundary modulo | integer `1..48` | `PitchBoundary.modulo` | Persistence, playback | Phase 3 |
| `pitchShaper.boundary.policy` | Boundary policy | enum `wrap`, `clamp`, `reflect`, `fallback`, `nearest` | `PitchBoundary.policy` | Persistence, playback | Phase 3 discrete |
| `pitchShaper.ratchetMode` | Ratchet pitch behavior | enum `sourcePitch`, `wholeRatchet`, `perRatchetHit` | `PitchRatchetSpec.mode` | Persistence, playback | Phase 3 discrete |
| `pitchShaper.wholeProbabilityPercent` | Whole-ratchet pitch chance | percent `0..100` | `PitchRatchetSpec.wholeProbability` | Persistence, playback | Phase 3 |
| `pitchShaper.perHitProbabilityPercent` | Per-hit pitch chance | percent `0..100` | `PitchRatchetSpec.perHitProbability` | Persistence, playback | Phase 3 |
| `pitchShaper.preserveFirstHit` | Preserve first ratchet pitch | boolean | `PitchRatchetSpec.preserveFirstHit` | Persistence, playback | Phase 3 |
| `pitchShaper.ornamentMode` | Ornament pitch behavior | enum `sourcePitch`, `wholeOrnament`, `perGraceNote` | `PitchOrnamentSpec.mode` | Persistence, playback | Phase 3 discrete |
| `pitchShaper.ornamentWholeProbabilityPercent` | Whole-ornament pitch chance | percent `0..100` | `PitchOrnamentSpec.wholeProbability` | Persistence, playback | Phase 3 |
| `pitchShaper.ornamentPerGraceProbabilityPercent` | Per-grace pitch chance | percent `0..100` | `PitchOrnamentSpec.perGraceProbability` | Persistence, playback | Phase 3 |
| `pitchShaper.gracePitchEnabled` | Grace pitch injection on/off | boolean | `PitchOrnamentSpec.gracePitch.enabled` | Persistence, playback | Current |
| `pitchShaper.gracePitchProbabilityPercent` | Grace pitch injection chance | percent `0..100` | `PitchOrnamentSpec.gracePitch.probability` | Persistence, playback | Current |
| `pitchShaper.gracePitchScope` | Grace pitch injection cluster handling | enum `wholeCluster`, `perGraceNote` | `PitchOrnamentSpec.gracePitch.scope` | Persistence, playback | Structural/discrete |
| `pitchShaper.gracePitchPitches[*].pitch` | Grace pitch pool MIDI note | integer `0..127` | `WeightedMidiPitch.pitch` | Persistence, playback | Structural for target identity |
| `pitchShaper.gracePitchPitches[*].weight` | Grace pitch pool weight | weight `0..999` | `WeightedMidiPitch.weight` | Persistence, playback | Current |
| `pitchShaper.graceTransposeEnabled` | Grace transpose injection on/off | boolean | `PitchOrnamentSpec.graceTranspose.enabled` | Persistence, playback | Current |
| `pitchShaper.graceTransposeProbabilityPercent` | Grace transpose injection chance | percent `0..100` | `PitchOrnamentSpec.graceTranspose.probability` | Persistence, playback | Current |
| `pitchShaper.graceTransposeScope` | Grace transpose cluster handling | enum `wholeCluster`, `perGraceNote` | `PitchOrnamentSpec.graceTranspose.scope` | Persistence, playback | Structural/discrete |
| `pitchShaper.graceTransposeUpWeight` | Grace transpose up direction weight | weight `0..999` | `GraceTransposeDirectionWeights.up` | Persistence, playback | Current |
| `pitchShaper.graceTransposeDownWeight` | Grace transpose down direction weight | weight `0..999` | `GraceTransposeDirectionWeights.down` | Persistence, playback | Current |
| `pitchShaper.graceTransposeIntervals[*].semitones` | Grace transpose interval size | integer `1..48` | `WeightedPitchInterval.semitones` | Persistence, playback | Structural for target identity |
| `pitchShaper.graceTransposeIntervals[*].weight` | Grace transpose interval weight | weight `0..999` | `WeightedPitchInterval.weight` | Persistence, playback | Current |
| `pitchShaper.transposeEnabled` | Transposition on/off | boolean | `PitchTranspositionRule.enabled` | Persistence, playback | Phase 3 |
| `pitchShaper.transposeProbabilityPercent` | Transposition chance | percent `0..100` | `PitchTranspositionRule.probability` | Persistence, playback | Phase 3 |
| `pitchShaper.transposeMode` | Transposition mode | enum `singleNote`, `stairStep` | `PitchTranspositionRule.mode` | Persistence, playback | Phase 3 discrete |
| `pitchShaper.transposeIntervals` | Weighted interval list | text parsed into `{semitones, weight}` | `PitchTranspositionRule.intervals` | Persistence, playback | Structural/text parser; Phase 3 for parsed weights |
| `pitchShaper.transposeDriveChain` | Transpose drives chain | boolean | `PitchTranspositionRule.driveChain` | Persistence, playback | Phase 3 |

## Channel Hocket

Channel Hocket is the final channel-routing rewrite. It must remain cycle-local
and must not mutate the rhythm tree or timing.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `channelHocket.open` | Channel Shaper open | boolean | `PatchChannelHocketState.open` | Persistence only | UI-only |
| `channelHocket.enabled` | Channel Hocket on/off | boolean | `ChannelHocketSpec` null/non-null | Persistence, playback diagnostics | Phase 3 |
| `channelHocket.outputChannel` | Static MIDI channel | integer `1..16` | `PatchChannelHocketState.outputChannel` | Persistence, playback | Phase 3 |
| `channelHocket.order` | Channel Markov order | enum `first`, `second` | `ChannelHocketSpec.order` | Persistence, playback | Phase 3 discrete |
| `channelHocket.assignMode` | Assignment strategy | enum `markov`, `euclid` | `ChannelHocketSpec.assign_mode` | Persistence, playback | Structural/discrete |
| `channelHocket.euclid.placement` | Euclid placement | enum `partition`, `stack` | `EuclidChannelSpec.placement` | Persistence, playback | Structural/discrete |
| `channelHocket.euclid.steps` | Euclid steps | integer `1..64` | `EuclidChannelSpec.steps` | Persistence, playback, quota fuzz property | Phase 3 |
| `channelHocket.euclid.reset` | Euclid reset scope | enum `cycle`, `section`, `beat`, `accentSpan` | `EuclidChannelSpec.reset` | Persistence, playback | Structural/discrete |
| `channelHocket.euclid.spanAccentMode` | Span accents woven/pinned | enum `woven`, `bypass` | `EuclidChannelSpec.span_accent_mode` | Persistence, playback, quota fuzz property | Structural/discrete |
| `channelHocket.euclid.spanAccentChannel` | Span accent anchor | integer `1..16` or fallback | `EuclidChannelSpec.span_accent_channel` | Persistence, playback | Structural/discrete |
| `channelHocket.euclid.layer[*].channel` | Euclid layer channel | integer `1..16` (palette member) | `EuclidChannelLayer.channel` | Persistence, playback | Structural |
| `channelHocket.euclid.layer[*].pulses` | Euclid layer pulses | integer `0..64` | `EuclidChannelLayer.pulses` | Persistence, playback, quota fuzz property | Phase 3 |
| `channelHocket.euclid.layer[*].rotation` | Euclid layer rotation | integer `0..63` | `EuclidChannelLayer.rotation` | Persistence, playback | Phase 3 |
| `channelHocket.euclid.layer[*].maxRun` | Euclid layer max run (bursts) | integer `1..64` | `EuclidChannelLayer.max_run` | Persistence, playback | Phase 3 |
| `channelHocket.euclid.layer[*].steps` | Euclid layer length (stack) | integer `1..64` | `EuclidChannelLayer.steps` | Persistence, playback | Phase 3 |
| `channelHocket.euclid.layer[*].invert` | Euclid layer invert (stack) | boolean | `EuclidChannelLayer.invert` | Persistence, playback | Structural |
| `channelHocket.channels[*]` | Enabled channel set / Axis Count | list integers `1..16` | `ChannelHocketSpec.channels` | Persistence, playback, matrix/fallback axis sizing | Structural |
| `channelHocket.weights[transitionKey]` | Channel transition cell | weight `0..999` | `ChannelTransition.weight` | Persistence, playback | Phase 3 |
| `channelHocket.entryWeights[entryKey]` | Channel entry selector cell | weight `0..999` | `ChannelEntryWeight.weight` | Persistence, playback | Phase 3 |
| `channelHocket.fallback` | Static fallback channel | integer `1..16` | `ChannelHocketSpec.fallback` | Persistence, playback | Phase 3 |
| `channelHocket.fallbackWeights[channel]` | Weighted fallback channel | weight `0..999` | `ChannelFallbackWeight.weight` | Persistence, playback | Phase 3 |
| `channelHocket.seedBehavior` | Channel seed behavior | enum `followGlobal`, `locked`, `perCycle`, `history`, `drift`, `morph` | `RhythmSeedMode` | Persistence, deterministic playback | Structural/discrete |
| `channelHocket.seed` | Channel seed | integer `>=0` | `PatchChannelHocketState.seed` | Persistence, deterministic playback | Structural/discrete |
| `channelHocket.historySeeds` | Channel seed history | list integers | `PatchChannelHocketState.historySeeds` | Persistence, history behavior | Structural |
| `channelHocket.historyWeight` | Channel history weight | weight `>=0` | `PatchChannelHocketState.historyWeight` | Persistence, history behavior | Phase 3 |
| `channelHocket.newSeedWeight` | Channel new seed weight | weight `>=0` | `PatchChannelHocketState.newSeedWeight` | Persistence, history behavior | Phase 3 |
| `channelHocket.maxHistory` | Channel max history | integer `0..64` | `PatchChannelHocketState.maxHistory` | Persistence, history behavior | Structural |
| `channelHocket.newSeedChance` | Channel drift/morph new-seed chance | percent `0..100` | `PatchChannelHocketState.newSeedChance` | Persistence, drift + morph behavior | Structural |
| `channelHocket.holdChance` | Channel morph repeat chance | percent `0..100` | `PatchChannelHocketState.holdChance` | Persistence, morph behavior | Structural |
| `channelHocket.blendCycles` | Channel morph blend width | integer `1..64` | `PatchChannelHocketState.blendCycles` | Persistence, morph behavior | Structural |
| `channelHocket.ratchetMode` | Ratchet channel behavior | enum `sourceChannel`, `wholeRatchet`, `perRatchetHit` | `ChannelHocketRatchetSpec.mode` | Persistence, playback | Phase 3 discrete |
| `channelHocket.wholeProbabilityPercent` | Whole-ratchet channel chance | percent `0..100` | `ChannelHocketRatchetSpec.wholeProbability` | Persistence, playback | Phase 3 |
| `channelHocket.perHitProbabilityPercent` | Per-hit channel chance | percent `0..100` | `ChannelHocketRatchetSpec.perHitProbability` | Persistence, playback | Phase 3 |
| `channelHocket.preserveFirstHit` | Preserve first ratchet channel | boolean | `ChannelHocketRatchetSpec.preserveFirstHit` | Persistence, playback | Phase 3 |
| `channelHocket.ornamentMode` | Ornament channel behavior | enum `sourceChannel`, `wholeOrnament`, `perGraceNote` | `ChannelHocketOrnamentSpec.mode` | Persistence, playback | Phase 3 discrete |
| `channelHocket.ornamentWholeProbabilityPercent` | Whole-ornament channel chance | percent `0..100` | `ChannelHocketOrnamentSpec.wholeProbability` | Persistence, playback | Phase 3 |
| `channelHocket.ornamentPerGraceProbabilityPercent` | Per-grace channel chance | percent `0..100` | `ChannelHocketOrnamentSpec.perGraceProbability` | Persistence, playback | Phase 3 |
| `channelHocket.accentRules[*].label` | Accent rule label | text | `PatchChannelAccentRule.label` | Persistence, UI | UI/label |
| `channelHocket.accentRules[*].enabled` | Accent rule on/off | boolean | `ChannelAccentRule` inclusion | Persistence, playback | Phase 3 |
| `channelHocket.accentRules[*].minVelocity` | Accent rule min velocity | integer `0..127` | `ChannelAccentRule.minVelocity` | Persistence, playback | Phase 3 |
| `channelHocket.accentRules[*].maxVelocity` | Accent rule max velocity | integer `0..127` | `ChannelAccentRule.maxVelocity` | Persistence, playback | Phase 3 |
| `channelHocket.accentRules[*].probabilityPercent` | Accent rule chance | percent `0..100` | `ChannelAccentRule.probability` | Persistence, playback | Phase 3 |
| `channelHocket.accentRules[*].mode` | Accent routing mode | enum `renderOnly`, `driveChain` | `ChannelAccentRule.mode` | Persistence, playback | Phase 3 discrete |
| `channelHocket.accentRules[*].weights[channel]` | Accent target channel weight | weight `>=0` | `ChannelAccentWeight.weight` | Persistence, playback | Phase 3 |
| `channelHocket.positionRules[*].id` | Position rule stable id | text | `PatchChannelPositionRule.id` | Persistence, automation target stability | Structural |
| `channelHocket.positionRules[*].label` | Position rule label | text | `PatchChannelPositionRule.label` | Persistence, UI | UI/label |
| `channelHocket.positionRules[*].enabled` | Position rule on/off | boolean | `ChannelPositionRule.enabled` | Persistence, playback | Current |
| `channelHocket.positionRules[*].scope` | Position rule scope | enum `beat`, `section` | `ChannelPositionRule.scope` | Persistence, playback | Phase 3 discrete |
| `channelHocket.positionRules[*].nth` | Position rule nth note group | integer `>=1` | `ChannelPositionRule.nth` | Persistence, playback | Current |
| `channelHocket.positionRules[*].actionWeights.normalMarkov` | Normal Markov action weight | weight `0..999` | `ChannelPositionActionWeights.normalMarkov` | Persistence, playback | Current |
| `channelHocket.positionRules[*].actionWeights.renderOnly` | Render-only action weight | weight `0..999` | `ChannelPositionActionWeights.renderOnly` | Persistence, playback | Current |
| `channelHocket.positionRules[*].actionWeights.resetMarkov` | Reset Markov action weight | weight `0..999` | `ChannelPositionActionWeights.resetMarkov` | Persistence, playback | Current |
| `channelHocket.positionRules[*].renderWeights[channel]` | Position render channel weight | weight `0..999` | `ChannelPositionRule.renderWeights` | Persistence, playback | Current |
| `channelHocket.positionRules[*].resetMode` | Position reset source | enum `staticFallback`, `weightedFallback`, `customWeighted` | `ChannelPositionResetSpec.mode` | Persistence, playback | Phase 3 discrete |
| `channelHocket.positionRules[*].resetWeights[channel]` | Position reset channel weight | weight `0..999` | `ChannelPositionResetSpec.weights` | Persistence, playback | Current |

## Setup, Patch, Debug, And Session UI

These values affect workflow, recovery, and diagnostics. They should be covered
by persistence or UI tests, but most are intentionally excluded from musical
automation.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `setup.open` | Setup dialog open | boolean | `PatchSetupState.open` | Persistence only | UI-only |
| `setup.tab` | Setup tab | enum `audio`, `midi`, `files` | `PatchSetupState.tab` | Persistence only | UI-only |
| `setup.autosaveEnabled` | Autosave recovery toggle | boolean | `PatchSetupState.autosaveEnabled` and local preference | Persistence/preference tests | UI-only |
| `setup.autosaveIntervalMs` | Autosave interval | integer `1000..60000` ms | `PatchSetupState.autosaveIntervalMs` | Persistence/preference tests | UI-only |
| `setup.autoloadRecentSession` | Load recovery on launch | boolean | `PatchSetupState.autoloadRecentSession` | Persistence/preference tests | UI-only |
| `currentPatchPath` | Current patch path | path/null | local state/storage | File workflow tests | UI-only |
| `recentPatches[*]` | Recent patch list | path/name/date | local storage | File workflow tests | UI-only |
| `patchPersistenceState` | Saved/autosaved status | enum | derived fingerprint state | UI tests | Computed |
| `ui.midiDebugOpen` | MIDI out log open | boolean | `SequencerPatchDocument.ui.midiDebugOpen` | Persistence only | UI-only |
| `ui.midiDebugLimit` | MIDI log row limit | enum `40,100,250,500,1000` | `SequencerPatchDocument.ui.midiDebugLimit` | Persistence/UI tests | UI-only |
| `ui.automationDebugOpen` | Automation playback log open | boolean | `SequencerPatchDocument.ui.automationDebugOpen` | Persistence only | UI-only |
| `ui.automationDebugLimit` | Automation log row limit | enum `20,50,100,250,500,1000` | `SequencerPatchDocument.ui.automationDebugLimit` | Persistence/UI tests | UI-only |
| `ui.seedSetupOpen` | Seed dialog open | boolean | `SequencerPatchDocument.ui.seedSetupOpen` | Persistence only | UI-only |
| `ui.seedSetupTab` | Seed dialog tab | enum `overview`, `global`, `rhythm`, `pitch`, `channel`, `ratchet`, `log` | `SequencerPatchDocument.ui.seedSetupTab` | Persistence only | UI-only |
| `seedLogScope` | Seed log filter | enum `all`, `global`, `rhythm`, `pitch`, `channel`, `paths` | React state only | UI tests | UI-only |

## Seed Paths

Seed paths are an advanced recall/debug surface. User-editable parts are the
path name and wildcard rules; trace points are recorded from playback.

| Inventory id | User surface | Kind/range | Patch/model source | Coverage | Automation |
| --- | --- | --- | --- | --- | --- |
| `seedPaths[*].id` | Seed path id | text | `SeedPath.id` | Persistence | Structural |
| `seedPaths[*].name` | Seed path name | text | `SeedPath.name` | Persistence/UI | UI/label |
| `seedPaths[*].createdAt` | Creation timestamp | ISO text | `SeedPath.createdAt` | Persistence | Computed |
| `seedPaths[*].sourcePathId` | Clone source | id/null | `SeedPath.sourcePathId` | Persistence | Computed |
| `seedPaths[*].immutable` | Immutable flag | true | `SeedPath.immutable` | Persistence | Computed |
| `seedPaths[*].wildcardRules[*].domain` | Wildcard domain | enum `global`, `rhythm`, `pitch`, `channel`, `ratchet` | `SeedPathWildcardRule.domain` | Persistence, playback | Structural/discrete |
| `seedPaths[*].wildcardRules[*].cycle` | Wildcard cycle | integer/null | `SeedPathWildcardRule.cycle` | Persistence, playback | Structural/discrete |
| `seedPaths[*].trace[*]` | Recorded trace events | event objects | `SeedPath.trace` | Persistence, playback diagnostics | Computed |
| `activeSeedPathId` | Active recorder path | id/null | React state only | UI/playback workflow | UI-only |
| `queuedSeedPathId` | Queued playback path | id/null | React state only | UI/playback workflow | UI-only |

## Computed Playback Logs

These are not authoring inputs, but they are critical test oracles. They should
be asserted when validating timeline/audio parity and automation coverage.

| Inventory id | Source | Purpose |
| --- | --- | --- |
| `TransportSnapshot.midiDebugEvents` | Transport snapshot | MIDI out log parity and scheduler debugging |
| `TransportSnapshot.automationEvents` | Transport snapshot | Active automation samples during playback |
| `TransportSnapshot.ratchetEvents` | Transport snapshot | Ratchet firing diagnostics |
| `TransportSnapshot.ornamentEvents` | Transport snapshot | Grace/delay diagnostics |
| `TransportSnapshot.pitchEvents` | Transport snapshot | Pitch rewrite diagnostics |
| `TransportSnapshot.channelHocketEvents` | Transport snapshot | Channel rewrite diagnostics |
| `TransportSnapshot.seedTraceEvents` | Transport snapshot | Seed mode and seed path diagnostics |

## Required Test Families

Minimum regression families for this inventory:

1. Patch round-trip tests for every persisted row in `SequencerPatchDocument`.
2. Preview request tests for every core score row that changes resolved beats,
   sections, gati, jathi, accent, pitch, or velocity.
3. Playback request tests proving preview and playback use the same request data
   for score, rhythm, ratchet, ornament, pitch, channel, and automation values.
4. Automation target registry tests proving every `Current` target has the
   correct kind, clamp range, sample rate, fallback value, and stable id.
5. Phase 3 automation expansion tests for matrix cells, articulation cells,
   arbitrary subdivision, speed/timing, ratchet, ornament, pitch, and channel
   values.
6. Structural edit tests for add/remove/reorder controls, with special attention
   to stable ids and stale automation targets.
7. Log oracle tests proving MIDI, automation, ratchet, ornament, pitch, channel,
   and seed logs are capped, deterministic under locked seeds, and attached to
   the same cycle data visible in the timeline.

When a new editable value is introduced, add it to this document in the same
change as the code. If it is musical, either add an automation target or mark
the reason it is structural/discrete.
