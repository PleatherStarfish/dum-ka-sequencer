# UI control and readout reference

This is the element-by-element contract for Dum-Ka's current mounted user
interface. It answers two questions for every control family and meaningful
readout:

1. What does the element do?
2. Which property, command, or local view state does it own?

Use [UI_AND_INTERACTION.md](UI_AND_INTERACTION.md) for workflow and async
behavior, and use this document when changing a label, wiring a control, or
checking whether a property has an honest UI owner. The React/Tauri source is
authoritative if this inventory falls out of date.

## Scope and notation

- **Edit** changes authored project or track state and is saved in a patch
  unless the row says otherwise.
- **Preference** changes machine-level or session UI state, not musical patch
  content.
- **Command** starts an operation; it does not directly own a patch property.
- **View** changes only what is open, selected, filtered, or visible.
- **Readout** reports state and does not control it.
- A row marked **per track**, **per box**, **per rule**, **per point**, or **per
  channel** represents every repeated instance of that element.
- Dotted names such as `generator.dumka.pattern` name the closest stable state,
  DTO, or command concept. They are ownership aids, not a promise that every
  field is stored as one flat JavaScript object.
- Native file choosers, confirmation sheets, standard macOS Edit/Window menu
  items, and shared modal dismissal are included. Decorative marks, layout
  containers, and unmounted/test-only components are not.

## Shared interaction elements

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Numeric field text input | Edit | The property named by its surrounding label. It keeps a draft while focused and commits a parsed, clamped, step-quantized number on blur or Enter. Escape restores the previous value. |
| Numeric field decrement/increment steppers | Edit | The same property as the adjacent numeric input, by one configured step; Shift uses ten steps and Option uses one tenth where supported. |
| Slider rail/thumb | Edit | The property named by its label. Pointer movement stages a value; ordinary sliders commit on release. Keyboard arrows use the configured step. |
| Checkbox or switch | Edit/Preference | The Boolean property named by its label. A disabled switch is explanatory state, not a second property. |
| Select menu | Edit/View | The enumerated property named by its label; view-only selectors are called out below. |
| `auto` shortcut beside an annotated control | View/Command | Opens the focused automation picker for that control's target ID; it does not enable automation by itself. |
| Command/Control-click on an annotated control | View/Command | Opens the same focused automation picker without changing the underlying property. |
| Main-editor backdrop, close button, or Escape | View | Closes the active main editor (`mainEditorOpen`) without changing authored settings. |
| Utility-dialog backdrop, `×`, Done/Close, or Escape | View | Closes that dialog's local open state. |
| Disclosure summary/chevron | View | Mounts or reveals that panel's contents; opening a panel does not enable its musical feature. |
| Disabled control | Readout | Communicates a transport lock, capacity limit, invalid dependency, or unavailable roadmap mode. It has no independent state. |

## macOS application menus

### File

| Menu item | Kind | Property or effect it owns |
| --- | --- | --- |
| New Patch (`⌘N`) | Command | Immediately replaces the stopped current project with a new neutral version-1 project, clears its file association, and clears temporary recovery state. There is currently no unsaved-changes confirmation. |
| Save Patch (`⌘S`) | Command | Projects current in-memory state into the strict `.dumka` v1 envelope and writes the current path, or opens Save As when no path exists. |
| Save Patch As (`⇧⌘S`) | Command | Opens the native destination chooser and writes a `.dumka` v1 file. |
| Recall Patch (`⌘O`) | Command | Opens the native source chooser and replaces the project with a validated `.dumka` file. |
| Recall Most Recent Patch (`⇧⌘O`) | Command | Loads the most recently saved patch path recorded by the app. |
| Export Cycle JSON (`⇧⌘E`) | Command | Writes the current active-track cycle realization as JSON. |
| Toggle Autosave Recovery (`⌥⌘A`) | Preference | Toggles `autosaveEnabled`, the machine preference for temporary crash-recovery writes. |
| Close Window | Command | Invokes the standard macOS close-window action. |

### Edit, View, Setup, Playback, and Window

| Menu item | Kind | Property or effect it owns |
| --- | --- | --- |
| Undo, Redo, Cut, Copy, Paste, Select All | Command | Standard macOS text-editing actions for the currently focused native/web text control. They do not operate as a project-wide musical undo stack. |
| Toggle Rhythm Shaper (`⇧⌘R`) | Command with current gap | Tauri emits `toggleRhythmShaper`, but the mounted React menu-action handler currently has no corresponding state transition. The visible menu item therefore controls no UI property at present. |
| Enter/Exit Full Screen | Command | Standard macOS window fullscreen state. |
| Audio & MIDI Setup | View | Opens `setupOpen` on the Audio/MIDI/Files setup dialog. |
| Seed Strategy | View | Opens `seedSetupOpen` on the seed-domain dialog. |
| MIDI Panic (`⌘.`) | Command | Invokes the panic path that releases active notes and sends all-notes-off behavior. |
| Reset Timeline Sync (`⌥⌘R`) | Command | Rebuilds/resynchronizes scheduler-to-timeline transport state; it does not edit the score. |
| Built-in Synth Properties (`⇧⌘P`) | View | Opens `synthPropertiesOpen`. |
| Toggle Built-in Synth (`⌥⌘S`) | Command/Edit | Toggles `synthEnabled` through the synth bridge command. |
| Minimize, Zoom, Bring All to Front, window list | Command | Standard macOS window-management state. |

### Application and Help menus

| Menu item | Kind | Property or effect it owns |
| --- | --- | --- |
| About Dum-Ka | View | Opens the standard macOS application-information panel. |
| Services | Command/View | Opens the standard macOS Services submenu for the current system and focus context. |
| Hide Dum-Ka / Hide Others | Command | Changes standard macOS application visibility. |
| Quit Dum-Ka | Command | Terminates the application through the standard macOS quit action. |
| Help | Readout | The Help submenu is mounted but currently contains no items. |

## Masthead and global status

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Dum-Ka title and product copy | Readout | Identifies the application; no editable property. |
| Seed-history loop monitor button | View/Readout | Reports recent recurrence in global/generator/channel seed histories and opens the Seed Strategy **Log** tab. |
| Missing/disconnected MIDI-route chip | View/Readout | Reports `midiRouteStatus`; clicking opens Setup on the **MIDI** tab. It appears only when the desired route is unavailable or incomplete. |
| Score ID | Readout | Reports the current preview/transport score snapshot ID (`currentScoreId`). |
| Theme toggle | Preference | Sets `themeMode` to `light` or `dark`; this is presentation state, not patch content. |
| Error banner | Readout | Reports the latest bridge/action error. |
| Preview status banner | Readout | Reports preview pending, rejection, or stale-generation state for the active authored fingerprint/cycle. |
| Patch status banner | Readout | Reports save, recall, import, export, autosave, and recovery outcomes. |

## Transport, monitor, and patch toolbar

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Running/Idle/Starting/Stopping indicator | Readout | Reports acknowledged transport transition state, not merely enqueue success. |
| Play | Command | Invokes `transport_play` for the current ready realization. It is disabled while the authored state lacks a matching ready preview or transport is transitioning. |
| Stop | Command | Invokes `transport_stop` and waits for scheduler acknowledgement. |
| Transport warning | Readout | Reports why playback is unavailable, stale, or unsafe. |
| Synth on/off | Edit/Command | Sets `synthEnabled`; this controls the built-in monitor only and does not disable external MIDI. |
| Properties | View | Opens Built-in Synth Properties. |
| Global BPM | Edit | Sets the project reference tempo (`parallelGlobalTempoBpm` / `transport.tempoBpm`). Tracks in custom-tempo mode keep their own value. |
| Project cycle | Edit | In multi-track projects, sets `parallelGlobalCycleBeats`, the cycle length inherited by tracks in global-cycle mode. |
| Save | Command | Runs the Save Patch workflow at the current path or Save As if none exists. |
| Recall | Command | Runs the native Recall Patch workflow and replaces the current project after validation. |
| Auto on/off | Preference/Command | Sets `autosaveEnabled`; switching it off also clears temporary recovery state. |
| File/recovery status text | Readout | Reports current patch path, dirty/save state, last autosave time, and whether recovery is enabled. |

## Project Channel Logic

This project-level panel appears when parallel conflict handling is relevant.
It decides which overlapping participants survive **after** Channel Shaper has
assigned output channels.

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Help button | View | Toggles the local Channel Logic explanation and operator legend. |
| Default channel logic | Edit | Sets project `channelConflictPolicy`: Layer all, Random one, Alternate, Priority, One only/XOR, Overlap only/XNOR, All tracks/AND, Majority, Minority. |
| Add rule | Edit | Appends one pair/channel override to `channelConflictRules`. |
| First track / Second track, per rule | Edit | Sets the two distinct conflict participants addressed by that override. A Track Flow box is one synthetic participant. |
| `All shared`, per wildcard rule | Readout | Indicates a wildcard pair rule loaded for all shared channels. While present, the individual channel chips are disabled. |
| Channel chip, per explicit rule/channel | Edit | Adds or removes that MIDI channel from the pair override's scope. |
| Operator, per rule | Edit | Sets its pair policy: Layer all, Mute overlap, Random one, Alternate, or Priority. |
| Remove, per rule | Edit | Deletes that pair override. |
| Priority up/down, per participant | Edit | Reorders `parallelPriority`, used wherever Priority is the effective policy. |
| Effective-rule summaries and pictograms | Readout | Resolve and explain the default, pair override, channel scope, and participant result for each shared channel. |

## Track strip and active-track controls

### Track tabs and project actions

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Track tab, per track | View | Sets `activeTrackId`. Selection changes the edited track, not its continuous/triggered/flow role. |
| Track tab badges | Readout | Report mute/solo, inherited or custom tempo/cycle, trigger state, and live sounding/armed/driving/waiting/silenced state. |
| Track color dot/accent, per track | Readout | Reports `track.color`, the stable visual identity assigned to that track; the current UI has no color editor. |
| `M`, per track | Edit | Toggles `track.muted`. A muted source can remain a silent trigger source. |
| `S`, per track | Edit | Toggles `track.soloed`; the project solo filter determines audible participants. |
| Export, per track | Command | Writes that track as a strict `.dumka-track` v1 envelope. |
| Delete, per track | View | Opens the delete confirmation for that track. |
| Track drag handle/cell | Edit | Dragging to another Track Flow box changes box membership and appends the track to that box's ordered member list; dragging to the parallel lane removes box membership. Dropping into the track's existing box is a no-op. |
| New track | Edit | Adds a neutral authored track, up to the 16-track limit. |
| Copy active track | Edit | Duplicates the active track with fresh identity and reconciled project membership/priority state. |
| Import track | Command/Edit | Opens a `.dumka-track` chooser, assigns fresh identity, and reconciles the imported track into the destination project. |
| New Track Flow box | Edit | Appends a new `trackFlowBoxes[]` box. |

### Active-track identity, timing, and automation

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Rename button / name input | Edit | Sets `track.name`; Enter/blur commits and Escape cancels the draft. |
| Track cycle Global/Custom | Edit | Sets `track.cycleLengthMode`. Global inherits `parallelGlobalCycleBeats`; Custom uses the track's score length. |
| Custom cycle length | Edit | Sets the active track's custom cycle beats (`customCycleBeats` / score cycle length). |
| Track BPM Global/Custom | Edit | Sets `track.tempoMode`. Global inherits project BPM; Custom uses `customTempoBpm`. |
| Custom BPM | Edit | Sets `track.customTempoBpm`; its automation target is `transport.tempoBpm`. |
| Automation length | Edit | Sets `track.automation.lengthCycles` and proportionally stretches existing automation point phases. |
| Automation Editor | View | Opens/closes the automation editor for the active track. |

### Track role

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Continuous | Edit | Makes the track an independently running continuous participant and clears incompatible triggered/box role state. |
| Triggered | Edit | Makes the track a follower and creates/uses `track.trigger`; the source must be a different existing continuous track. |
| Track Flow | Edit | Assigns exclusive `track.boxId` membership and removes incompatible trigger state. |
| Role caption and blocked reason | Readout | Explains the current role and why a role transition is unavailable. |
| Track Flow box selector | Edit | Sets the selected box membership or creates a new box for the active track. |
| Now-playing member/box | Readout | Reports the scheduler's selected Track Flow member for the current cycle. |

## Triggered-track inspector

The following controls edit `track.trigger` for the active follower.

### Source and presets

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Mode Continuous/Triggered | Edit | Sets whether the track owns a trigger configuration. |
| Source | Edit | Sets `trigger.sourceTrackId`; only other continuous tracks are valid. |
| `?` How triggers work | View | Toggles local trigger help text. |
| Preset cards | Edit | Replace the trigger configuration with Fill a rest, Launch next beat, Phase-locked shadow, Quantized fill, or Probabilistic fill defaults. Disabled roadmap presets do not write state. |
| Basic/Advanced detail | View | Changes inspector disclosure only. |
| Status/help/compiled summary | Readout | Reports source validity, armed/running state, and the compiled launch behavior. |

### When

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Match All/Any | Edit | Sets the root `trigger.when` Boolean combinator. |
| Beat Any/specific and beat index | Edit | Sets the beat filter inside `trigger.when.beats`; displayed indices are explicitly zero-based where labelled. |
| Condition subject, per condition | Edit | Sets a leaf predicate: beat rest/sounding, section start, grouping pulse, subdivision equals, pulse rest/sounding, rest count, or sounding count. |
| NOT, per condition | Edit | Negates that condition leaf. |
| Subdivision value | Edit | Sets the required subdivision for a subdivision predicate. |
| Pulse index | Edit | Sets the pulse addressed by a pulse predicate. |
| Count comparison | Edit | Sets at least, at most, exactly, more than, or less than for a count predicate. |
| Count threshold | Edit | Sets the integer threshold for that count comparison. |
| Add/remove condition | Edit | Adds or removes a simple condition in the root group. |
| Replace with simple | Edit | Replaces an unsupported/custom nested predicate tree with the editor's simple default tree. |

### Gate, phrase start, quantization, and run

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Enable gate | Edit | Creates or clears `trigger.gate`. |
| Probability | Edit | Sets `trigger.gate.probabilityPerMille`. |
| Min gap | Edit | Sets `trigger.gate.cooldownCycles`. |
| Miss boost | Edit | Sets `trigger.gate.missBoostPerMille`. |
| Start Fixed/Weighted | Edit | Sets `trigger.startSelect` to one fixed placement or a weighted placement pool. |
| Placement, per fixed/weighted option | Edit | Sets trigger event, source cycle start, next reference beat, tick offset after trigger, center matched beat, or source return. |
| Placement weight, per weighted option | Edit | Sets that option's selection weight. |
| Tick offset, where applicable | Edit | Sets that placement's post-trigger tick offset. |
| Add/remove weighted placement | Edit | Adds or removes an entry in the weighted phrase-start pool. |
| Snap | Edit | Sets `trigger.launchQuantize.grid`: off, 1/N beat, N beats, or source subdivision. |
| Divisions / beat multiple | Edit | Sets the grid size used by the selected snap mode. |
| Round next/nearest/previous | Edit | Sets launch-quantize direction. |
| Length Score cycle/Fixed beats | Edit | Sets `trigger.length`; fixed mode also owns its beat count. |
| Repeat Once/Repeat | Edit | Sets `trigger.lifetime`; Repeat also owns pass count. |
| Retrigger Restart/Ignore/Queue | Edit | Sets `trigger.reTrigger`. |

### Trigger trace

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Show suppressed | View | Filters whether suppressed decisions are drawn in the trigger overlay. |
| All/Launched/Queued/Suppressed | View | Filters the visible trigger log rows. |
| Trigger overlay and log | Readout | Report compiled source matches, gates, quantization, launch/queue/suppress decisions, and reason codes. |

## Track Flow boxes

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Collapsed box tab / expand chevron | View | Sets that box's local expanded state. |
| Box name / rename input | Edit | Sets `trackFlowBoxes[].name`; double-click or Rename starts the draft. |
| Delete box | Edit | Removes the box; former members return safely to continuous parallel participation. |
| Matrix | View | Opens the transition-matrix dialog for that box. |
| Member drag/drop | Edit | Sets box membership and the destination's resulting append order in `trackFlowBoxes[].memberTrackIds`; it does not provide an in-place reorder gesture inside the same box. |
| Selected member/live state | Readout | Reports the box's deterministic selected member and current scheduler state. |
| Box chain seed | Edit | Sets `trackFlowBoxes[].seed`, the deterministic chain seed. |
| Start weight, per member | Edit | Sets `trackFlowBoxes[].chain.entryWeights[member]`. |
| Transition weight, per previous/next pair | Edit | Sets `trackFlowBoxes[].chain.weights[from,to]`; an empty/zero row uses the documented uniform fallback. |
| Matrix close | View | Closes the matrix without another commit. |

## Main editor launcher

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Sections and Subdivisions | View | Sets `mainEditorOpen = "sections"`. Its badges summarize cycle, section, and structure state. |
| Generator | View | Sets `mainEditorOpen = "generator"`. Its badges summarize kind, enablement, and density/evolution state. |
| Evolve | View | Sets `mainEditorOpen = "evolve"`. Its badges summarize directives, curves, and current cycle insight. |
| Channel Shaper | View | Sets `mainEditorOpen = "channel"`. Its badges summarize static/Markov/Euclidean routing. |

Only one main editor is open at a time. Launcher badges are readouts and do not
toggle the represented feature.

## Sections and Subdivisions editor

### Cycle and accent controls

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Panel summary | View | Opens/closes the focused Sections editor. |
| Cycle name | Edit | Sets the active score's `name`. |
| Beats/cycle | Edit | Sets the active score cycle length. Subdivision still remains steps **per beat**. |
| Base pitch | Edit | Sets `sequencer.pitch`, the score's MIDI note number. |
| Velocity | Edit | Sets `sequencer.velocity`, the base MIDI velocity before accents. |
| Grouping mode | Edit | Sets `jathiAccentMode`: grouping accents either override subdivision-start accents or layer with them. |
| Section accent center / random margin | Edit | Together set `sectionAccentMin` and `sectionAccentMax`, the extra velocity range at authored section starts. |
| Subdivision accent center / random margin | Edit | Together set `beatAccentMin` and `beatAccentMax`, the velocity range at per-beat subdivision starts. |
| Grouping accent center / random margin | Edit | Together set `jathiAccentMin` and `jathiAccentMax`, the velocity range at grouping starts. |
| Accent range bars and absolute-velocity summaries | Readout | Report the resulting min/max velocity bands; they do not write another property. |

### Section map and boundary detail

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Section map row, per section | View | Selects the boundary/section inspector; it does not merge adjacent equal subdivisions. |
| `+ boundary` | Edit | Inserts the next available authored boundary after an integer beat. |
| Initial-section Subdivision | Edit | Sets `initialWeights`, the fixed pulses-per-beat value used from beat 1 until the first boundary. |
| Initial-section Grouping | Edit | Sets optional `initialJathiWeights`, the first section's fixed grouping accent cycle. |
| Boundary `After beat` | Edit | Sets `boundaries[].afterBeat`; the following beat begins a distinct section. |
| Boundary Subdivision | Edit | Sets that section's fixed `weights`/subdivision value, applied to every beat in the section. |
| Boundary Grouping | Edit | Sets optional fixed `jathiWeights`/grouping, or None. |
| Remove/Delete boundary | Edit | Removes that authored boundary and its distinct section start. |
| Boundary rail click/drag | Edit | Adds a boundary at the nearest legal after-beat position. |
| Boundary rail Option-click, Command-click, or double-click | Edit | Removes the boundary at that position. |
| Boundary marker `edit` | View | Opens the boundary detail dialog. |
| Boundary marker `del` | Edit | Removes that boundary directly. |
| Fired/active boundary styling | Readout | Reports which authored boundary fired in the realized cycle. |

## Generator editor

### Common generator controls

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Panel summary | View | Opens/closes the focused Generator editor. |
| Algorithm | Edit | Sets `generator.kind` to Example or Dum-Ka; parameters for the inactive kind remain stored. |
| Generator enabled | Edit | Sets `generator.enabled`. Off preserves the feature-off transport identity contract. |
| Example Density | Edit | Sets `generator.example.densityPercent`; automation target `generator.example.density`. |
| Seed mode | Edit | Sets generator seed behavior to Locked, Per Cycle, or History. |
| Seed | Edit | Sets the active generator's base seed (`generator.seedMode.seed`). |

### Dum-Ka seed pattern and structure

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Syntax help | View | Toggles the local Dum-Ka pattern grammar reference. |
| Pattern textarea | Edit | Sets `generator.dumka.pattern`; blur or `⌘Enter` commits the draft. |
| Pattern mini/block view | View | Selects Rhythm Builder nodes and reports the committed tree; it does not create a second pattern. |
| Apply structure / Simplify | Edit | Rewrites the active score's cycle beats, subdivision, boundary, and grouping structure to the pattern's compatible requirement. |
| Depth palette prime chips (`×2`, `×3`, `×5`, `×7`) | Edit | Sets `generator.dumka.subdivisionPalette`, with at most two selected primes. |
| Euclidean roll seed | View input | Sets the local roll seed used only by the next Roll action. |
| Euclidean roll Density | View input | Selects sparse, medium, or dense roll generation. |
| Euclidean roll Style | View input | Selects plain, bursts, or inverted roll generation. |
| Roll | Edit/Command | Deterministically generates and writes a new `generator.dumka.pattern` from the local roll inputs. |
| Open Evolve | View | Switches the focused main editor to Evolve. |
| Depth diversity / geometric placement summaries | Readout | Report analysis of the current preview and pattern. |

### Rhythm Builder

All rows below operate on the currently selected node(s) of the same
`generator.dumka.pattern` tree.

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Proportional block | View | Selects a leaf/group; Shift extends the local selection. |
| Note / Rest / Hold | Edit | Sets the selected leaf's sounding type. Hold remains constrained by tie legality. |
| Weight | Edit | Sets a selected leaf's relative duration weight. |
| Group relative span | Edit | Sets a nested group's relative span weight. |
| Top-level group span | Edit | Sets how many existing cycle beats a top-level group consumes. |
| Group count | Edit | Sets how many selected siblings the next Group action will wrap. |
| Group | Edit | Wraps the selected compatible siblings in one group. |
| Ungroup | Edit | Replaces the selected group with its children. |
| Articulate | Edit | Converts a compatible hold/tie region into explicit articulation. |
| Split count / Split | Edit | Replaces the selected leaf with a tuplet/group of that many parts. |
| Euclid onsets (`k`) / slots (`n`) / E-fill | Edit | Replaces the selection with a deterministic Euclidean pattern. |
| Insert before / Insert after | Edit | Adds a sibling leaf adjacent to the selection. |
| Delete selection | Edit | Removes selected nodes while preserving a valid nonempty pattern. |

### Dum-Ka depth and evolution parameters

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Complexity Floor / Ceiling | Edit | Set `generator.dumka.complexityFloor` and `.complexityCeiling` in fixed-point milli-units. |
| Placement | Edit | Sets `generator.dumka.placementBias`, from metric to void placement. |
| Evolution rate | Edit | Sets `generator.dumka.evolutionRate`, the per-cycle chance of attempting change. |
| Remove / Add weights | Edit | Set the Remove/Add operator lottery weights. |
| Barlow temperature | Edit | Sets candidate-pool breadth for Barlow-ranked operations. |
| Density floor / ceiling | Edit | Set the global hard onset corridor. |
| Syncopate / Desyncopate weights | Edit | Set the corresponding displacement operator weights. |
| Fragment / Consolidate weights | Edit | Set the corresponding depth-changing operator weights. |
| Fill complexity | Edit | Sets the complexity used by fill generation. |
| Reshape weight | Edit | Sets the Euclidean reshape operator weight. |
| Max run | Edit | Sets the maximum adjacent Euclidean onset run. |
| Invert chance | Edit | Sets the Euclidean inversion probability. |
| Rests Tied/Silent | Edit | Sets the generated rest policy. |
| Rotate weight | Edit | Sets the rotation operator weight. |
| Drift leash | Edit | Sets maximum allowed distance from the seed rhythm. |
| Per-section `i` help | View | Toggles local explanatory copy for that parameter family. |
| Odds, candidate, lattice, corridor, and budget summaries | Readout | Report derived probabilities and preview analysis; they do not change generator state. |

## Evolve editor

### Workbench and preview navigation

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Panel summary | View | Opens/closes the Evolve editor. |
| Depth diversity | Readout | Reports `stateDepthDiversityMilli` for the stopped preview cycle. |
| Used lanes only | View | Hides directive-family lanes with no authored directives. |
| View cycles | Edit/View | Sets the stored Evolve plan authoring extent (`dumkaPlanLengthCycles`); it does not truncate directives beyond the visible window. |
| Cycle ruler drag | View | Pans the workbench horizontally. |
| Mouse wheel / `⌘`-wheel | View | Pans / zooms the cycle grid. |
| Out-of-window, capacity, validation, and budget notices | Readout | Report authored data beyond the view, directive capacity, invalid edits, or work-budget constraints. |

### Aggregate pacing curve

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Pacing lane click/drag | Edit | Adds or changes an aggregate evolution-curve breakpoint: cycle and target perceptual step size. |
| Pacing lane Shift-click | Edit | Removes the breakpoint at that cycle. |
| Curve enabled | Edit | Sets `generator.dumka.evolutionCurve.enabled`. |
| Curve tolerance | Edit | Sets `.toleranceMilli`, the acceptable distance around the aggregate step-size target. |
| Curve max operations | Edit | Sets `.maxOperations`, the search cap used to approach a curve target. |
| Remove point, per curve point | Edit | Deletes that aggregate evolution-curve point. |
| Realized cycle-distance line/ticks | Readout | Reports backend `cycleDistance` and whether directives override the curve on a cycle. |

### Property curves

Each property lane reports the backend-measured trajectory and, when enabled,
owns one target-band curve in `generator.dumka.propertyCurves[]`.

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Density lane | Edit/Readout | Reports `propertyProfile.densityMilli`; authored points target sounding-onset density. |
| Complexity lane | Edit/Readout | Reports `propertyProfile.complexityMilli`; authored points target fixed-point Barlow attack-depth complexity. |
| Syncopation lane | Edit/Readout | Reports `propertyProfile.syncopationMilli`; authored points target off-metric attack displacement. |
| Evenness lane | Edit/Readout | Reports `propertyProfile.evennessMilli`; authored points target inter-onset spacing evenness. |
| Occupancy lane | Edit/Readout | Reports `propertyProfile.occupancyMilli`; authored points target the proportion of the cycle occupied by sounding duration. |
| Diversity lane | Edit/Readout | Reports `propertyProfile.diversityMilli`; authored points target rhythmic interval/duration variety. |
| Empty lane cell click or Enter/Space | Edit | Adds/updates a point at that cycle and vertical 0–100 level. |
| Point drag / Up/Down | Edit | Changes `propertyCurves[].points[].levelMilli`. |
| Point horizontal drag / Left/Right | Edit | Changes `propertyCurves[].points[].cycle`. |
| Shift-click or Delete | Edit | Removes the point at that cycle. |
| Property selector | View | Chooses which property's settings are shown in the inspector. |
| Enabled | Edit | Sets the selected `PropertyCurve.enabled`. |
| Tolerance | Edit | Sets `PropertyCurve.toleranceMilli`, the half-width of its effective target band. |
| Weight | Edit | Sets `PropertyCurve.weight`, its relative steering priority when several properties compete. |
| Density/complexity corridor shading | Readout | Reports the intersection of global hard rails, directive overrides, and the drawn band. |
| Miss marker/tooltip | Readout | Reports a truthful miss reason: no reducing candidate, pacing cap, budget cap, projection, or hard-rail block. |
| Directive-override styling | Readout | Reports that an enabled directive owns that cycle and suppresses property-curve steering there. |

### Directive lanes and inspector

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Remove, Add, Rotate, Syncopate, Desyncopate, Fragment, Consolidate, Euclid, Morph, Stochastic lane | Edit/Readout | Click adds an `EvolutionDirective` of that family at the cycle; existing pins/ranges show authored coverage. |
| Directive pin/range | View/Edit | Click selects; drag changes `fromCycle` and `toCycle`. |
| Start/end resize handles | Edit | Change the corresponding cycle edge. |
| Option-drag | Edit | Duplicates the directive and moves the copy. |
| Arrow keys / Shift+arrows | Edit | Move / resize the selected directive. Delete removes it. |
| Duplicate / Delete | Edit | Copies or removes the selected directive. |
| Enabled | Edit | Sets `EvolutionDirective.enabled`. |
| Intensity | Edit | Sets `EvolutionDirective.intensity`, the operation quota for quota-paced cycles. |
| Order | Edit | Sets directive ordering where multiple admitted directives compose. |
| From / To cycle | Edit | Set the directive's inclusive cycle range. |
| Step size Operation quota/Perceptual target | Edit | Creates or clears `EvolutionDirective.magnitude`; Stochastic is quota-only. |
| Target magnitude | Edit | Sets `magnitude.targetMilli`, desired incremental perceptual change per active cycle. |
| Perceptual tolerance | Edit | Sets `magnitude.toleranceMilli`. |
| Max operations | Edit | Sets `magnitude.maxOperations`, the per-directive search cap. |
| Smooth across 4 cycles | Edit | Converts a compatible one-cycle quota pin into a four-cycle gentle range. |
| Transition Repeat each/Linear/Gentle | Edit | Sets directive `pacing` across a multi-cycle quota range. |
| Whole cycle / beat chips | Edit | Sets `directive.scope`; Shift-click extends a contiguous beat run. |
| Override density corridor / Floor / Ceiling | Edit | Creates or clears per-directive `options.densityFloor` and `.densityCeiling`. |
| Override complexity corridor / Floor / Ceiling | Edit | Creates or clears per-directive `options.complexityFloor` and `.complexityCeiling`. |
| Option override checkbox, per nullable family field | Edit | Chooses inherit-global (`null`) versus a directive-local override. |
| Barlow temperature | Edit | Per Remove/Add override of `options.barlowTemperature`. |
| Placement bias | Edit | Per Remove/Add override of `options.placementBias`. |
| Fill complexity | Edit | Per Fragment override of `options.fillComplexity`. |
| Subdivision level | Edit | Per supported family, sets `options.subdivisionLevel` to Any/inherited or a selected working-lattice prime. |
| Euclid max run | Edit | Sets `options.euclidMaxRun`. |
| Euclid invert | Edit | Sets `options.euclidInvert`. |
| Euclid rest policy | Edit | Sets `options.euclidRestPolicy` to inherit, tied, or silent. |
| Rotate direction | Edit | Sets `options.rotateDirection` to earlier or later. |
| Morph target textarea | Edit | Sets `options.morphTarget`, the exact destination pattern for a Morph directive. |
| Morph mini-block / validity status | Readout | Reports parsed target structure and compatibility. |
| Before / After preview | View/Command | Selects and builds the stopped comparison cycle before or at the directive; it does not edit the plan. |
| Directive event trace / perceptual result / score budget | Readout | Reports requested/applied operators, skips/clamps, chosen family, actual vs target magnitude, and remaining scoring work. |

## Channel Shaper editor

Channel Shaper is track-level channel assignment. It runs before project-level
Channel Logic.

### Assignment header

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Panel summary | View | Opens/closes the focused Channel Shaper editor. |
| Hocket enabled | Edit | Sets `channelHocket.enabled`; off uses static output routing. |
| Output | Edit | Sets the track's static/default output channel (`channelHocket.outputChannel`). |
| Assignment Markov/Euclidean | Edit | Sets the channel-assignment engine. |
| Markov order First/Second | Edit | Sets `channelHocket.order`, the context length for the transition matrix. |
| Axis count | Edit | Sets how many channels are in the active Markov channel set. |
| Fallback | Edit | Sets `channelHocket.fallback`, the static channel used when a weighted choice cannot resolve. |
| Channel chips 1–16 | Edit | Toggle membership in `channelHocket.channels`; other-track usage marks are read-only collision hints. |
| Matrix / Entry & Fallback / Euclid Pattern / Accents / Positions tabs | View | Select the local Channel Shaper subpanel; they do not switch assignment mode. |

### Markov assignment

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Transition weight, per context→channel cell | Edit | Sets `channelHocket.weights[context,to]`. |
| Entry weight, per initial context | Edit | Sets `channelHocket.entryWeights[context]`. |
| Fallback weight, per channel | Edit | Sets `channelHocket.fallbackWeights[channel]`. |
| Context labels, heat, row sums, and fallback explanation | Readout | Report the active matrix and deterministic fallback behavior. |

### Euclidean assignment

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Placement Partition/Stack | Edit | Sets Euclidean placement mode: partition one shared mask or stack independent layer masks. |
| Steps shared | Edit | Sets shared `channelHocket.euclid.steps` in Partition mode. |
| Reset every Cycle/Section/Beat/Accent span | Edit | Sets `channelHocket.euclid.reset`. |
| Span accents Woven/Bypass | Edit | Sets whether accent-span starts consume the Euclidean pattern or bypass it. |
| Anchor | Edit | Sets bypass rendering to static fallback or a selected channel. |
| Channel, per layer | Edit | Sets the output channel owned by that Euclidean layer. |
| Pulses, per layer | Edit | Sets the layer's onset count. |
| Rotate, per layer | Edit | Sets the layer's pattern rotation. |
| Max run, per layer | Edit | Sets its maximum consecutive selected steps. |
| Length, per stacked layer | Edit | Sets that layer's independent step count. |
| Invert, per stacked layer | Edit | Sets whether the layer mask is inverted. |
| Layer up/down | Edit | Reorders Euclidean layer priority. |
| Remove / Add layer | Edit | Deletes or appends a Euclidean channel layer. |
| Pattern masks and routing summary | Readout | Preview computed masks and overlap/priority behavior. |

### Accent routing

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Velocity preset | Edit | Replaces `channelHocket.accentRules` with the selected preset mapped to current score/accent velocity bands. |
| Clear | Edit | Resets accent routing rules to their default/off state. |
| Edit base / Edit accents | View | Opens Sections at base velocity / accent controls. |
| Routing velocity guide | Readout | Reports final velocity bands after base, section, subdivision, and grouping accents. |
| Enabled, per accent rule | Edit | Sets `accentRules[].enabled`. |
| Mode Render only/Drive chain | Edit | Sets whether a matching rule only changes rendering or also advances/drives Markov state. |
| Minimum / maximum velocity | Edit | Set the inclusive match band. |
| Chance | Edit | Sets the rule application percentage. |
| Channel weight, per rule/channel | Edit | Sets `accentRules[].weights[channel]`. |

### Position routing

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Add / Clear | Edit | Appends a position rule / removes all position rules. |
| Enabled, per rule | Edit | Sets `positionRules[].enabled`. |
| Label, per rule | Edit | Sets `positionRules[].label`. |
| Remove, per rule | Edit | Deletes that position rule. |
| Scope Beat/Section | Edit | Sets the counter reset scope used to identify the nth note group. |
| Nth note | Edit | Sets `positionRules[].nth`. |
| Reset mode Static fallback/Weighted fallback/Custom weights | Edit | Sets how a Reset action chooses the new Markov context. |
| Normal / Render / Reset action weights | Edit | Set the lottery among normal assignment, render-only override, and Markov reset. |
| Render channel weights | Edit | Set the output-channel pool for Render. |
| Reset channel weights | Edit | Set the custom reset pool when Custom weights is selected. |
| Automation shortcut buttons | View/Command | Open focused automation for the exact dynamic rule/weight target. |

## Timeline

The timeline's musical lanes are readouts of the realization used for queued
MIDI. Its authoring controls are limited to stopped-cycle inspection,
automation visibility, and the shared boundary rail.

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Previous / next stopped cycle | View/Command | Decrements/increments `userPreviewCycle` and requests that cycle's deterministic preview. Disabled during playback. |
| Automation layers | View | Opens the timeline automation-layer picker. |
| Target checkbox, per automation track | View | Adds/removes that target ID from `timelineAutomationTargetIds`; it does not enable the automation track. |
| Hide | View | Clears all visible automation target IDs. |
| Timeline info `i` | View | Toggles the timeline legend and truth/parity explanation. |
| Boundary rail and marker actions | Edit/View | Own the same boundary properties documented under Sections; disabled during transport locks. |
| Active track, cycle, section/boundary counts | Readout | Report which track and stopped/live cycle the rows represent. |
| Syncing/suppression/lock notices | Readout | Report pending realization, conflict suppression, and transport mutation lock state. |
| Beat ruler | Readout | Reports beat/tick positions. |
| Subdivision lane | Readout | Reports the per-beat resolved subdivision and subdivision-start accents. |
| Grouping lane | Readout | Reports grouping pulses and grouping-start accents. |
| Automation lane, per visible target | Readout | Reports the values sampled into the realization. |
| Rhythm/generator lane | Readout | Reports realized cells, rests/ties, velocity, and generator overlays. |
| Channel lane | Readout | Reports the final recorded MIDI-channel assignment after Channel Shaper. |
| Playhead | Readout | Reports current scheduler cycle/tick against those recorded rows. |
| Footer cycle/tick and MIDI route | Readout | Reports live transport position and destination/channel status. |

## Automation editor

Automation is stored per authored track in `track.automation`.

### Target browser and lane selection

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Find | View | Filters available target rows by group, label, or target ID. |
| Group | View | Filters target rows by automation target group. |
| Type | View | Filters by Boolean, integer, float, or weight value kind. |
| Available/total target counts | Readout | Report the filtered available row count and the complete dynamically built target count. |
| Add, per target row | Edit | Creates one automation track for that target with its fallback curve. |
| Lane pill, per active target | View | Sets the selected automation target in the editor. |
| Lane on/off | Edit | Sets `automation.tracks[].enabled`. |
| Remove lane | Edit | Deletes that automation target track. |
| Focused shortlist target button, per target | Edit/View | From an `auto` shortcut, adds the target when absent or selects it when present, then opens the full Automation editor on that lane. |

### Markers, graph, points, and segments

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Marker % / Label / Add marker | Edit | Append an `automation.markers[]` entry with normalized phase and optional label. |
| Marker phase, per existing marker | Edit | Changes that marker's normalized time. Anchored points follow it. |
| Marker label, per existing marker | Edit | Changes that marker's displayed label. |
| Remove marker, per marker | Edit | Deletes the marker and releases point anchors that referred to it. |
| Y min / Y max | View | Set the selected weight lane's editor graph range only; they do not clamp automation data. |
| Reset axis | View | Restores the graph's derived display range. |
| Empty graph click | Edit | Adds a point to the selected curve at that phase/value, snapping to a nearby marker when applicable. |
| Point drag | Edit | Changes point phase, value, and marker anchor according to the gesture. |
| Segment click | View | Selects the segment between two points for curve editing. |
| Point row | View | Selects that point. |
| Point phase | Edit | Sets `point.phase` and clears its marker anchor. |
| Point value | Edit | Sets the Boolean or numeric `point.value` for the target kind. |
| Snap marker / Free | Edit | Sets or clears `point.anchorId`. |
| Remove point | Edit | Deletes that point, subject to the two-point minimum. |
| Segment | View | Selects which adjacent point pair owns the interpolation settings. |
| Curve | Edit | Sets segment kind: Linear, Smooth, Ease in, Ease out, Ease in/out, Exponential, or Hold. |
| Bend | Edit | Sets the selected segment's curve amount. |

### Automatable target catalog

The target picker creates one **Add** row per definition returned by
`buildAutomationTargetDefs`. Dynamic rows repeat for the currently authored
channel set, Euclidean layers, accent rules, and position rules.

| Target row/family | Owned playback property |
| --- | --- |
| Tempo — `transport.tempoBpm` | Custom track tempo sampled per beat. |
| MIDI output channel — `transport.midiOutputChannel` | Static transport output channel sampled at cycle start. |
| Pitch — `sequencer.pitch` | MIDI pitch sampled per beat. |
| Velocity — `sequencer.velocity` | Base MIDI velocity sampled per beat. |
| Beat accent min/max — `sequencer.accent.beatStart.*` | Subdivision-start accent range sampled per beat. |
| Section accent min/max — `sequencer.accent.sectionStartExtra.*` | Section-start extra range sampled per beat. |
| Grouping accent min/max — `sequencer.accent.jathiStart.*` | Grouping-start accent range sampled per beat. |
| Example Density — `generator.example.density` | Example-generator density sampled at cycle start. |
| Dum-Ka evolution rate, drift leash, density floor/ceiling, complexity floor/ceiling, placement bias, Barlow temperature, fill complexity — `generator.dumka.*` | The named Dum-Ka global parameter sampled at cycle start. |
| Channel Hocket enabled/output/static fallback — `channelHocket.enabled`, `.outputChannel`, `.fallback.staticChannel` | Markov/Euclidean enable and static/fallback output channels. |
| Channel entry, per context — `channelHocket.entry.{order}.{context}.weight` | Initial Markov-context weight. |
| Channel matrix, per context→channel — `channelHocket.matrix.{order}.{context}.to.{channel}.weight` | Transition weight. |
| Channel fallback, per channel — `channelHocket.fallback.channel.{channel}.weight` | Weighted fallback pool. |
| Channel seed history/new/max — `channelHocket.seed.*` | History-vs-new selection weights and maximum history length. |
| Euclidean steps and per-layer pulses/rotation/max-run/length — `channelHocket.euclid.*` | The named Euclidean mask property. |
| Accent rule enabled/min/max/chance/channel weight — `channelHocket.accentRule.{index}.*` | The named dynamic accent-routing rule property. |
| Position rule enabled/nth/action/render/reset weight — `channelHocket.positionRule.{rule-id}.*` | The named dynamic position-routing rule property; nth is sampled per note group. |

The active channel set and authored rule/layer collection therefore determine
the exact number of rows. `ui/src/automationTargets.ts` is the executable
catalog and source of truth.

## Audio & MIDI Setup

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Audio / MIDI / Files tabs | View | Set `setupTab`; changing tabs does not alter audio, routing, or persistence state. |

### Audio

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Synth monitor | Edit/Command | Sets `synthEnabled`. External MIDI remains independent. |
| Channel voices | View | Opens Built-in Synth Properties. |
| Engine/output/voice-count fields | Readout | Report audio engine availability, output configuration, and active voice counts. |

### MIDI

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Destination | Preference/Edit | Sets the desired CoreMIDI destination; Virtual-only chooses the app's virtual source rather than an external destination. |
| Route status | Readout | Reports desired, resolved, connected, missing, or disconnected route state. |
| Rescan | Command | Refreshes CoreMIDI destinations and route status. |
| Default channel | Edit | Sets `midiOutputChannel` / `transport.midiOutputChannel`. |
| MIDI debug | View | Shows/hides the MIDI Debug panel; it does not enable MIDI itself. |
| Channel Shaper | View | Closes Setup and opens the Channel Shaper main editor. |
| MIDI panic | Command | Sends the same panic/release path as the Playback menu. |

### Files

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Autosave interval | Preference | Sets the machine preference for recovery-write interval in milliseconds. |
| Autosave temporary recovery | Preference/Command | Sets `autosaveEnabled`. |
| Autoload recent patch after clean launch | Preference | Sets the machine preference for loading the recent manual patch after a clean start. |
| Current file/recent/recovery rows | Readout | Report current path, recent-patch metadata, and recovery availability/time. |
| Save As | Command | Opens the patch destination chooser and writes the strict v1 envelope. |
| Export cycle | Command | Opens the JSON export destination chooser. |
| Clear recovery | Command | Deletes the temporary recovery file/state; it does not delete a manually saved patch. |

## Seed Strategy dialog

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Global / Generator / Channel / Log tabs | View | Select the visible seed domain or trace log. |
| Global mode | Edit | Sets `globalSeedMode`: Locked, Per cycle, or History. |
| Global seed | Edit | Sets the global decimal base seed. |
| Roll, global | Edit/Command | Writes a new datetime-derived global seed. |
| Lock for new sessions | Preference | Sets `globalSeedStartupLocked`. |
| Global remembered seeds | Edit | Replaces the global seed-history pool from comma-separated decimal values. |
| Global history length | Edit | Sets the global `maxHistory`. |
| Generator mode | Edit with current gap | Despite its label, the current Seed Strategy **Generator** tab writes the same `globalSeedMode` property as the Global tab. It does not write the active generator's distinct `generatorSeedMode`; that property is controlled in the Generator editor. |
| Generator seed / Roll / remembered seeds / history length | Edit with current gap | These currently alias the Global tab's `seed`, `historySeedsInput`, and `maxHistory`. They do not write the active generator's distinct seed fields in the Generator editor. |
| Channel mode | Edit | Sets `channelHocketSeedBehavior`: Locked, Per cycle, or History. |
| Channel seed / Roll | Edit | Set the Channel Shaper base seed. |
| Channel remembered seeds / history length | Edit | Set the Channel Shaper history pool and maximum history. |
| Log filter All/Global/Generator/Channel/Paths | View | Filters visible seed trace records. |
| Seed counts, path rows, recurrence flags | Readout | Report stored histories and decimal seed-path trace/replay data. |

## Built-in Synth Properties

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Melodic palette | Edit/Command | Replaces all 16 `synthChannelVoices[]` entries with melodic General MIDI program defaults. |
| Percussion rack | Edit/Command | Replaces all 16 voice entries with percussion-note defaults. |
| Kit + colors | Edit/Command | Replaces all 16 entries with the mixed kit/color preset. |
| Melodic/Percussion, per channel | Edit | Sets `synthChannelVoices[channel].mode`. |
| Sound, per channel | Edit | Sets the channel's GM melodic program or percussion note according to its mode. |
| Reset palette | Edit/Command | Restores the default 16-channel voice configuration. |
| Done / close | View | Closes the synth-properties dialog. |

## Debug and diagnostic surfaces

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| MIDI Debug disclosure | View | Opens/closes the MIDI event ledger. |
| MIDI Debug Rows | View | Sets the visible tail-row limit. |
| Active track only | View | Filters the ledger to the active track. |
| MIDI ledger table | Readout | Reports sequence, cycle, tick, channel, message, track/source, conflict group, data bytes, monitor, and raw bytes. |
| Parallel conflicts disclosure | View | Opens/closes the Channel Logic decision ledger. |
| Conflict Rows | View | Uses the diagnostic row limit for visible conflict decisions. |
| Conflict table | Readout | Reports overlap components, effective policy, winners/suppressed notes, and participant/channel identity. |
| Automation Debug disclosure | View | Opens/closes sampled automation diagnostics. |
| Automation Debug Rows | View | Sets the visible tail-row limit. |
| Automation table | Readout | Reports per-beat target values, interpolation, curve/point identity, and applied state. |
| Live transport footer | Readout | Reports scheduler cycle/tick, current route, and active note/transport state. |

## Native prompts, destructive dialogs, and failure recovery

| Element | Kind | Property or effect it owns |
| --- | --- | --- |
| Native open/save path chooser | Command input | Chooses the source/destination path for Recall, Save As, track import/export, or cycle JSON export. The chooser does not alter musical properties by itself. |
| Track-import timing prompt | Command input | Chooses whether imported track-local cycle/tempo timing is retained or reconciled to project timing. |
| Autosave recovery prompt | Command input | Chooses whether to restore the validated temporary recovery patch after an unclean shutdown. |
| Delete-track Cancel | View | Closes the confirmation and keeps the track. |
| Delete-track Save track | Command | Exports the track before deletion; it intentionally leaves the confirmation open for the final choice. |
| Delete-track Delete | Edit | Removes the authored track and reconciles trigger sources, boxes, priority, and channel state. |
| Boundary-detail close | View | Closes the detail dialog without another mutation. |
| Root-error message | Readout | Reports an unexpected React render/lifecycle error; the last manually saved patch is not modified. |
| Root-error Reload | Command | Reloads the app window to reconstruct UI state. |

## Maintenance checklist

When a visible element is added, removed, renamed, or rewired:

1. Update its row here with the exact property, command, or view state it owns.
2. If it is automatable, update the target family/catalog row and
   `ui/src/automationTargets.ts` tests.
3. If behavior or workflow changed, also update
   [UI_AND_INTERACTION.md](UI_AND_INTERACTION.md) and the root
   [README](../README.md).
4. Keep repeated controls grouped only when every instance has identical
   semantics; split the row when one instance owns different state.
5. Treat a visible control with no state transition, or a writable property
   with no documented owner, as a defect to investigate rather than silently
   describing intended behavior.
