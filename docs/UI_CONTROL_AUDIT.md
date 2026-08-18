# UI control reference audit — findings catalog

Row-by-row verification of [UI_CONTROL_REFERENCE.md](UI_CONTROL_REFERENCE.md)
on four axes: (1) does the control own what it claims, (2) is it interactive
and unbroken, (3) do displayed ranges match the engine, (4) does it look right.
Method: six code auditors (one per doc section) tracing every row's handler
chain and range constraints, plus a live interaction/visual pass in the
mock-backed app (screenshots + accessible-name dumps + targeted probes).

**~360 of ~420 rows verified clean.** The defects: **UC-1 … UC-60** below,
grouped by area. `Status` says what this pass did about each:
**fixed** (code), **doc-fixed** (the reference row was wrong; corrected),
**deferred** (real defect, deliberately left with reason).

Severity: **broken** (control does nothing / wrong thing), **wiring** (writes
or reads the wrong state), **range** (UI and engine disagree on bounds),
**a11y** (inaccessible or mislabeled), **dead** (unreachable/unused code),
**doc** (reference misdescribes correct code), **visual**.

## Menus, masthead, transport

| ID | Sev | Finding | Status |
|---|---|---|---|
| UC-1 | broken | "Toggle Rhythm Shaper" (⇧⌘R) emitted `toggleRhythmShaper` with no React branch — a menu item controlling nothing (App.tsx menu-action chain covered 13 of 14 actions). Verified live: DOM delta 0. | **fixed** — now toggles the Generator editor (which hosts rhythm authoring); menu retitled "Toggle Generator Editor"; handler branch added |
| UC-2 | a11y | Global BPM: visible label "Global BPM", input `aria-label="Tempo"` — label-in-name mismatch (App.tsx:8279) | **fixed** — aria-label now "Global BPM" |
| UC-3 | broken | Escape closed no utility dialog (Setup, Seed Strategy, Synth Properties) despite the shared-elements contract (doc line 45). Verified live; dialogs also silently stacked. | **fixed** — ModalFrame Escape handler: topmost-open frame closes; field-level Escape (draft cancel) wins via `defaultPrevented` |
| UC-4 | doc | Window menu row claims "Bring All to Front, window list"; menu has Minimize/Zoom/Close Window only (`set_as_windows_menu_for_nsapp` never called) | **doc-fixed** |
| UC-5 | dead | Help submenu mounted permanently empty (main.rs:4085) | **fixed** — removed |
| UC-6 | doc | Preview banner reports rejection/stale only; "pending" copy lives in the patch banner | **doc-fixed** |
| UC-7 | doc | Recall Most Recent loads last *recorded* (saved **or recalled**) path and refuses during playback | **doc-fixed** |

## Project Channel Logic

| ID | Sev | Finding | Status |
|---|---|---|---|
| UC-8 | broken | **Add rule appends at most one rule ever**, then becomes a silent no-op that still shows "Added channel logic override" and dirties the patch. `nextChannelLogicMatrixForAddedPair` never skips already-ruled slots; `hasAvailablePair` counts total slots, not unruled ones (channelLogic.ts:1011-1067, App.tsx:7150) | **fixed** — skips existing `(pair, channel)` keys; `hasAvailablePair` derived from unruled-slot existence |
| UC-9 | wiring | **Every Channel Logic mutation silently deleted authored Track-Flow-lane rules** — six handlers normalized against `project.tracks` (no lane ids) and wrote the pruned matrix back, against patchIo's own documented contract (App.tsx:5713-5833) | **fixed** — all six normalize against `runtimeEndpointTrackIds(tracks, boxes)` |
| UC-10 | wiring | Rule participant selects can't address a Track Flow box (runtime supports box lanes as participants; rules naming lanes are also invisible in the panel) | **deferred** — needs lane participant stubs (labels + member-channel union) through the option/row builders; lane rules are no longer *destroyed* (UC-9) |
| UC-11 | wiring | Priority list strips box lanes on read (write path keeps them), so lane priority exists but can't be seen or reordered | **deferred** — same lane-stub design as UC-10; tracked together |
| UC-12 | dead | Disabled-reason "All track pairs with shared channels already have rules." was unreachable | **fixed** — reachable via the UC-8 predicate; pinned live by the updated D4 metadata e2e spec, which now asserts the exhausted-disabled state instead of the old silent no-op click |
| UC-13 | dead | Six computed per-rule fields (`channelTitle`, `selectedLabel`, …) never rendered | **fixed** — `channelTitle` is now the rule row's title; `selectedLabel` renders as the scope summary; the rest removed |
| UC-14 | doc | Rows name `channelConflictRules` / `parallelPriority`; real state is `global.channelLogicMatrix` / `global.conflictPriority` | **doc-fixed** |
| UC-15 | doc | "Effective-rule summaries and pictograms": summaries are text-only; the one pictogram is a static head illustration | **doc-fixed** (split rows) |

## Track strip, triggers, Track Flow

| ID | Sev | Finding | Status |
|---|---|---|---|
| UC-16 | doc | "Empty/zero chain row uses uniform fallback" was false: once any weight was authored, a zero row deterministically routed to member 0 (`fallback = 0`, never set by UI); the in-app hint repeated the false claim | **fixed** — `trackFlowSpecFromChain` emits uniform fallback weights for unauthored rows, making doc + hint true |
| UC-17 | dead | HTML5 drag path was dead (`draggable={false}` so `onDragStart` never fired); pointer path does all documented dragging | **fixed** — dead handlers removed |
| UC-18 | range | Box chain seed had no `max`; values past 2^53 forwarded raw to a `u64` wire | **fixed** — `max={MAX_SAFE_SEED}` (full u64 migration: see UC-58) |
| UC-19 | range | Trigger fixed length: UI 1–64, engine accepts 1–256 | **fixed** — UI max 256 |
| UC-20 | range | Gate min gap: UI 0–64, engine cap 4096 | **fixed** — UI max 4096 |
| UC-21 | range | Gate probability/miss-boost edited in whole percent — only multiples of 10‰ reachable; imported 655‰ rendered 66% and rewrote on touch | **fixed** — step 0.1% preserves per-mille |
| UC-22 | doc | "Replace with simple" also reset the beat selector to 0 | **fixed** — preserves `when.beats` |
| UC-23 | wiring | Chain weight fields editable during playback but edits never reach the running scheduler (seed field locks; weights didn't) | **fixed** — weights gate on the same structure lock |
| UC-24 | doc | Box collapsed state is persisted project state that dirties the patch, not View | **doc-fixed** (kind → Edit) |
| UC-25 | broken | Matrix dialog disabled for boxes with <2 members, making the box seed unreachable there | **fixed** — dialog opens for any box (empty-state copy + seed field) |
| UC-26 | dead | Four deferred trigger catalogs (`*_DEFERRED`, helpers) imported only by tests; "shown disabled" comments false | **fixed** — removed |

## Launcher, Sections, Generator, Rhythm Builder

| ID | Sev | Finding | Status |
|---|---|---|---|
| UC-27 | doc | Launcher id is `"boundaries"`, not `"sections"`; tile titled "Channel"; badge descriptions didn't match (Generator shows seed mode, not evolution; Evolve shows directives · through-cycle) | **doc-fixed** |
| UC-28 | doc | No absolute-velocity summary in Sections (it lives in Channel Shaper) | **doc-fixed** |
| UC-29 | wiring | Accent center slider Cmd-click created the **min** automation lane and margin field the **max** — neither owns one endpoint alone | **fixed** — per-control `data-automation-target` removed; the pair-aware focus button remains the picker path |
| UC-30 | range | **"Apply structure" wrote cycle lengths 65–128 that the field, handler, and Rust command all reject** (patterns compile to 128 beats; scores cap at 64) — bricked previews | **fixed** — Apply structure disabled with an explanatory message when the pattern needs >64 beats |
| UC-31 | doc | "Group count" resizes an existing group (append/trim); it never stages the next Group action | **doc-fixed** |
| UC-32 | wiring | **Dum-Ka parameters silently lost across save/load when Algorithm is Example** — the patch stores only the active kind's config | **deferred** — patch-schema change (kept-state block) needs its own verified unit; doc row narrowed to in-session; tracked |
| UC-33 | range | Top-level leaf Weight field offered up to 512 where beats past 128 always fail compile | **fixed** — capped at the remaining beat budget |
| UC-34 | dead | `previewError` prop on RhythmBuilder never rendered | **fixed** — removed |
| UC-35 | visual | Accent group labels crowd into their slider boxes (Sections editor) | **fixed** — spacing |

## Dum-Ka parameters & Evolve editor

All 17 parameter rows and all range pins verified clean; the property-curve
inspector, keyboard authoring, `railBlocked` miss reason, and
directive-override styling all exist and are correctly wired.

| ID | Sev | Finding | Status |
|---|---|---|---|
| UC-36 | doc | Point field is `targetMilli`, not `levelMilli` | **doc-fixed** |
| UC-37 | wiring | Horizontal point-handle drag only rewrote the level at the grab cycle (Left/Right arrows did move the cycle) | **fixed** — handle drag now recomputes the cycle from the pointer and moves the point |
| UC-38 | doc | Pacing lane supports click, not drag | **doc-fixed** |
| UC-39 | wiring | Pacing cells on directive-owned cycles rendered with no explanation (computed `rows` counter unused) | **fixed** — "overridden by directive" state in the pacing cell label |
| UC-40 | wiring | Corridor shading: drawn band *replaced* the rail instead of intersecting (engine intersects) | **fixed** — shading intersects drawn band with rails |
| UC-41 | doc | Enter/Space adds a point at realized-level default, not pointer height | **doc-fixed** |

## Channel Shaper, Timeline, Automation

| ID | Sev | Finding | Status |
|---|---|---|---|
| UC-42 | broken | **Tab bar and subpanel body could disagree after a patch load** (body switched on raw state; highlight on the clamped value) — Euclid-authored track showed Matrix body under a Pattern tab bar with no active tab | **fixed** — body renders from the clamped active tab |
| UC-43 | wiring | Axis count silently replaced the authored channel set with 1..N | **doc-fixed** (renamed to "resets the set to the first N channels") — replacement behavior kept intentionally |
| UC-44 | wiring | Velocity preset hardcoded channels 2/3/4; with a palette excluding them it produced **zero** rules | **fixed** — presets map onto the authored channel set |
| UC-45 | range | Accent min/max velocity: JSX min 0, every other layer clamps to 1 | **fixed** — min 1 everywhere |
| UC-46 | range | Nth note ceilings: 256 (UI) / 999 (normalizer+request) / 4096 (Rust) | **fixed** — 999 in UI; doc notes engine tolerance |
| UC-47 | dead | `channelHocket.entry.*` automation family offered in the picker but never sampled by the engine | **fixed** — defs no longer emitted (implementing sampling tracked separately) |
| UC-48 | wiring | **Accent-rule automation indices bind to the compacted wire list** — enabling only the second authored rule made `accentRule.1.*` lanes inert and `…0.*` drive the wrong rule | **fixed (minimal)** — disabled rules now ship with `probability: 0` so indices stay aligned; stable-id keying tracked as follow-up (UC-59) |
| UC-49 | doc | Y min/max clamp stored point values on edit and persist as `track.graphRange` (row said View/display-only) | **doc-fixed** (kind → Edit, clamping described) |
| UC-50 | doc | Curve labels are Line/Smooth/Ease in/Ease out/Ease S/Expo/Step | **doc-fixed** |
| UC-51 | wiring | Partition-mode per-layer `E(k,n)` readout described the full-length necklace, not the remaining-slot mask actually used | **fixed** — readout derives from the same per-layer domain |
| UC-52 | range | Partition pulses silently truncated to the remaining budget at request time | **fixed** — field max = remaining budget; over-budget warning |
| UC-53 | doc | Tab row (mode-conditional tabs; "Pattern" not "Euclid Pattern"), matrix "row sums" (per-cell tooltip), timeline picker (enabled lanes only), timeline `i` (legend + seeds, no parity copy), hocket-enable side effect (seeds two channels) | **doc-fixed** (five rows) |
| UC-54 | a11y | Hocket enable checkbox has no accessible name; Output/Order/Fallback selects unlabeled (live dump) | **fixed** — aria-labels added |
| UC-55 | a11y | Every NumericField stepper reads "Increase value"/"Decrease value" — dozens of identical names per page | **fixed** — steppers are now `aria-hidden` decorative controls: they are mouse-only duplicates of the input's own ArrowUp/Down handling (`tabIndex -1`), so they leave the accessibility tree entirely instead of adding renamed noise. (Contextual names were tried first and made every `getByLabel(field)` ambiguous.) |

## Setup, Seed Strategy, Synth, Debug

| ID | Sev | Finding | Status |
|---|---|---|---|
| UC-56 | wiring | **Seed Strategy Generator tab wrote global seed state** (mode buttons + seed field aliased Global; history visibility gated on the wrong mode; props interface's index signature hid the miswire) | **fixed** — Generator tab writes `generatorSeedMode`/`generatorSeed`; history editor gates on the generator mode; index signature removed. History pool sharing with Global is by design; doc row rewritten |
| UC-57 | broken | **Channel seed mode could never return to `followGlobal`** (the default) — the option wasn't offered, so one click was irreversible without reloading a patch; fresh sessions showed no active mode | **fixed** — "Follow global" is the first mode option |
| UC-58 | range | All base-seed inputs clamp to 2^53−1 while the engine and history pools are full u64 — a remembered seed above 2^53 silently rewrites on touch/load (determinism break) | **deferred** — full u64-string migration (the history side already has the machinery); fields now carry an explicit max; tracked |
| UC-59 | wiring | Seed **Log** tab: "Generator" rows hardcoded global values (never read `generatorSeedMode`/`generatorSeed`) | **fixed** — sources the generator entry from generator state |
| UC-60 | doc/dead | Log tab renders two counts, not the documented path rows/recurrence flags; dead `seedPaths` prop; "Conflict Rows" control doesn't exist; Audio engine/output fields are static strings; route status has 3 states not 5 | **doc-fixed** ×4; dead prop removed |

## Deferred items (real defects, deliberately not fixed in this pass)

1. **UC-32** Dum-Ka params lost when saving with Example active — needs a patch
   kept-state block (schema + fixtures + round-trip tests): its own unit.
2. **UC-58** u64 seed fields — migrate `seed`/`generatorSeed`/`channelHocketSeed`
   /box seeds to the existing `U64SeedDecimal` string machinery.
3. **UC-48 follow-up** stable accent-rule ids end-to-end (the minimal
   index-alignment fix is in place and correct).
5. **UC-10/UC-11** lane-aware Channel Logic participant selects and priority
   rows — requires box-lane participant stubs (label + member-channel union)
   through `parallelTrackTabs`/`buildChannelLogicOverrideRows`/
   `buildParallelPriorityRows`; the destructive half (UC-9) is fixed.
4. **UC-47 follow-up** decide whether `channelHocket.entry.*` automation should
   exist; if yes, implement engine sampling and re-emit the defs.

## Cross-references

The M3.97 property-curves engine audit lives in
[DUMKA_PROPERTY_CURVES_AUDIT.md](DUMKA_PROPERTY_CURVES_AUDIT.md); its UI items
(PC-24…PC-30) were fixed before this audit and re-verified here (UC-36…UC-41
are the residue). The reference doc itself has been corrected row-by-row for
every **doc** finding above.
