# Seqstart — extracting `sequencer-quickstart` from carnatic-seq

## 1 · Context

`carnatic-seq` (Caesura, `main` @ `be8b1b8`, tree clean) has accreted a production-grade desktop-sequencer **platform** around its Carnatic rhythm-generation **research**: Rust workspace (10 crates + src-tauri) + Tauri 2 + React 18; rock-solid transport with preview/playback parity, 16-slot parallel tracks with triggered tracks + Track Flow boxes + channel-logic collision arbitration, MIDI machine integration, patch persistence, and a deep test rig (two-way DTO-fixture contract, mock/real/bootcheck Playwright, proptest invariant fuzzer, golden MIDI ledgers, guardrail coverage tests).

Daniel wants to explore **other generation algorithms** without rebuilding that platform. This plan produces `/Users/danielmiller/dev/projects/sequencer-quickstart` (currently empty): a fork that keeps the platform, strips the research, and installs a **documented generator seam** where new algorithms plug in.

**carnatic-seq is never modified.** Every bug/shortcoming discovered goes into the fork's `docs/UPSTREAM_FINDINGS.md` (ledger seeded in §10 — 17 findings already).

## 2 · Decisions (locked with Daniel)

| Decision | Choice |
|---|---|
| Hocket scope | **Full Channel Shaper** — both strategies (Markov + Euclid/Bjorklund), accent routing, position rules; gestures tab minus ratchet/ornament rows. Runtime toggle only (no cargo feature). |
| Example generator | **Seeded per-matra Bernoulli density**, default 100% ⇒ every subdivision sounds out of the box; lowering density exercises seeds/replay through the seam. |
| Identity | **Seqstart** — `identifier com.foundry.seqstart`, productName/window/masthead "Seqstart", virtual MIDI port **"Seqstart MIDI"** (e2e: "Seqstart MIDI (e2e)"), patch ext **`.seqstart`**, track ext **`.seqstart-track`**, `PATCH_APP_ID = "Seqstart"`. Crate names (`cseq-*`) and env names (`CAESURA_MACHINE_DIR`, `CAESURA_E2E*`) unchanged for upstream diffability. |
| Vocabulary | **Neutral UI labels** (Subdivision / Grouping / Step for gati / jathi / matra); internal type/field names unchanged. |
| Scope rulings | "Tracks intersection" = **Channel Logic** (kept wholesale). **Triggered Tracks and Track Flow are tracks logic — kept 100%** (overrides one explorer's delete suggestion). Cycle Flux, Randomize, Drift/Morph seed modes: stripped. Base per-track pitch+velocity: kept (not pitch generation). |

## 3 · Load-bearing architecture facts (verified at file:line)

1. **Parity invariant**: timeline preview and MIDI playback derive from the same request DTO. Preserved end-to-end; it is the platform's central contract (docs/TIMELINE_AUDIO_PARITY_POSTMORTEM.md).
2. **Timeline renders resolved DTOs** (`ResolvedBeat[]`, `PulseSpan[]`), so a deterministic structure resolver emitting the same shapes keeps the whole timeline/transport/trigger/track-flow stack alive.
3. **The score constructor IS the generator** upstream (`SubdivisionSwitch` rolls probabilistic gati sections). Fork rule: **keep the structural vocabulary, strip the stochastic resolution** — `PulseSpanKind::{Section, GatiBeat, JathiPulse}` survive with *fixed authored* subdivision/grouping per section; boundary chance, weighted draws, section-count ladder, speed multipliers/pratiloma, single-parameter modulation, `JathiBhedamPulse` die. Trigger conditions (rest/sounding/section-start/gati-is/jathi-pulse) all remain evaluable.
4. **The engine seam** is `realize_and_enqueue_with_time` (cseq-transport/src/lib.rs:7766): pipeline apply (:7802) → **[rhythm branch :7838–7885 = the cut]** → `cseq_realize::realize` (:7900) → queue → post-stages ratchet→ornament→pitch→hocket→static-channel (:14791). Fork keeps the span→cells→Rational-overlay bridge (`RhythmGroupBuilder`/`emit_rhythm_overlay_events` :11255–11448) as seam chassis; post-stages reduce to hocket→static-channel.
5. **Seeds are generic infrastructure**: identity-seeded convention (seed by stable identity, never draw order), `SplitMix64`+`mix_seed`, per-domain streams, seed-path trace/replay/wildcards, u64-as-decimal-string over JS (`LosslessU64`/`U64SeedDecimal`). Kept; domains shrink to `global | generator | channel`. Fork unifies the ×3 SplitMix64 / ×2 mix_seed duplication.
6. **Persistence is two systems**: patch document lives **entirely in TypeScript** (`patchIo.ts`, tolerant normalizer, v8) with a Rust validation mirror (main.rs:4064); Score JSON is separate (cseq-persist, v3). Both reset to fork-v1.

## 4 · Target product surface (what Seqstart does on first launch)

Deterministic sections sequencer with the full platform: N beats/cycle; sections authored as fixed boundaries (after beat K) each with fixed Subdivision (1..N per beat) + optional Grouping; velocity-accent hierarchy (beat-start / section-start / grouping-start); base note + base velocity per track; per-track Example generator (density 100% default) rendering onsets on the grid; up to 16 parallel tracks (follow/custom BPM + cycle length), Triggered Tracks, Track Flow boxes with per-box Markov member chains; Channel Logic collision operators + pair-rule matrix + priority; optional Channel Shaper hocket (Markov | Euclid); automation (`transport.tempoBpm` + kept targets incl. `generator.example.density`); seed strategy (global/generator/channel; Locked/PerCycle/History) + seed-path record/replay/wildcards; timeline (ruler, subdivision/grouping lanes, generator-output lane, hocket lane, automation lanes, playhead); MIDI destination picker + hot-plug + panic (⌘.) + quit-safety + built-in DLS synth monitor; patch save/recall/autosave-recovery; native menus; dark/light theme.

## 5 · Generator seam (the product of the fork)

Full design from the seam Plan agent, adopted with these decisions:

- **Config idiom**: `generator_enabled: bool` + `GeneratorConfig` enum (`#[serde(tag="kind")]`) holding only real generators — matches the codebase's enabled+spec idiom and the fuzzer's feature-off-byte-identity invariant (no `None` variant; disabling preserves params). `enabled:false` short-circuits before span extraction → byte-identical to upstream's `rhythm_enabled:false` arm.
- **Home**: `cseq-rhythm` **survives as the trimmed generator+hocket crate** (name kept for diffability; it holds `GeneratorConfig`, `ExampleGeneratorParams`, `GeneratorSeedMode` (= `RhythmSeedMode` minus FollowGlobal/Drift/Morph), the slimmed span/cell types, `resolve_generator_cycle`, generators/ modules, the full `Channel*`/`Euclid*` hocket blocks, seed infra).
- **Dispatch**: `trait CycleGenerator { fn generate(&self, ctx: &GeneratorCycleContext) -> Result<Vec<GeneratedSpan>, GeneratorError> }` as the named contract; **exhaustive match** in `resolve_generator_cycle(config, ctx)` as dispatch (compiler enumerates touch points on new variants; no dyn registry).
- **Context**: `GeneratorCycleContext { track_id, cycle, cycle_beats, spans: &[GeneratorSpanInput], seed /* pre-resolved incl. seed-path replay */, automation sampler }`. `GeneratorSpanInput` = `RhythmSpanInput` minus generation leaks: drop `notes_per_cell` (JB-H) + `section_matra_len` (speed-grid); rename `chain_context`→`section_index`.
- **Output**: slim `ResolvedRhythmSpan`/`ResolvedRhythmCell` **in place** (retained names; `pub type GeneratedSpan/GeneratedCell` aliases). Cell keeps `{index, start, len, rest, tied_from_previous, tied_to_next}`; drops `intent, accent_conflict, locked, lock_pinned_tie, shaped, internal`. Ties/rests are generic sequencer vocabulary consumed by the retained `RhythmGroupBuilder`.
- **Slim playback config** replacing 30-field `RhythmPlaybackConfig`: `{generator_enabled, generator, midi_output_channel, channel_hocket_enabled, channel_hocket, automation, seed_path}`. Rides `parallel_set_playback` (track field `rhythm`→`playback`); `rhythm_set_playback`→`track_set_playback`. Scheduler's no-op-resend compare + cycle-local clear/re-realize retained unchanged.
- **Example generator**: per span emit `span_len` cells of len 1; onset unless Bernoulli fails; density 100 short-circuits (zero RNG). Seed identity: `span_stream = ctx.seed ^ fnv1a64(span_id) ^ EXAMPLE_DENSITY_SALT; draw = SplitMix64(mix_seed(span_stream, cell_index))`. Automation target `"generator.example.density"`. Seed-trace domain `"generator"`, label "Example Generator". UI: one `GeneratorEditor.tsx` main-editor panel (Switch enable · Density slider · seed mode Locked/PerCycle/History · seed NumericField).
- **Preview parity**: new `generator_preview` command mirroring `rhythm_preview` (request: spans + enabled + config + cycle; response: `{seed: GeneratorSeedResolution, spans: ResolvedRhythmSpan[]}`) — **calls the same `resolve_generator_cycle` the transport calls** (one fn, two callers ⇒ divergence structurally impossible). Playing state stays on the retained `RealizedRhythmSpanEvent` snapshot layer + `RhythmLayerLane`; both lane registries (`TIMELINE_PLAYBACK_LANE_SOURCES` / `_TICK_SPACE`, timelineModel.ts:454/483) kept, trimmed to `{rhythm, channelHocket}`, tick-space becomes unwarped identity (Flux gone) but the registry fence stays.
- **Recipe doc** `docs/ADDING_A_GENERATOR.md`: determinism contract + seam diagram + worked Example + **12-touch-point checklist** (enum variant+validation → resolver module+tests → dispatch arm [compiler-forced] → seed-trace label arm → invariants.rs strategy arm [+ discriminant-coverage test] → bridge.ts union variant → patchIo normalizer arm → editor panel+launcher entry → mockTauri arm → dto-fixture regen both directions → TS tests/e2e smoke → optional automation target). Preview wiring + transport are kind-agnostic (zero per-generator work — stated explicitly).
- **Determinism contract** (updated by M3.9): pure fn of (params, ctx); no wall clock/OS entropy/global state/float nondeterminism; identity-seeded with pinned salts (add/skip/reorder draws never perturbs unrelated decisions); seed resolution is caller's job; must replay byte-identical under seed-path; structural postconditions (cells sorted, non-overlapping, tile `[0, span_len)`, sequential index, cross-span ties only as paired sounding interior handshakes, no first incoming or final outgoing tie); enabled:false ⇒ ledger byte-identical to config that never carried it.

## 6 · Dispositions

### 6.1 Rust workspace (LOC = code excl. inline tests)

| Crate | Verdict | Detail (line refs = source of the cut) |
|---|---|---|
| **cseq-model** (2.6k) | SURGICAL ~55% keep | KEEP: ids, `LosslessU64` serde, `ValueSpec` (Fixed arm), automation block whole (223–864), `AccentTree`, `PulseSpan`/`PulseSpanKind` (Section+GatiBeat+JathiPulse; drop JathiBhedamPulse), `DurationTree`, Transform infra, `Score` (drop `default_gati/jathi`), `CustomSubdivisionSpec`, `SubdivisionInflection` (position only; probability/weights die). STRIP: jathi consts (135–143), protected-cuts/rhythm-accent helpers (1123–1216), speed/accent/JB blocks (1645–2052), `SwitchSeedMode::{Drift,Morph}`, `TransformKind::{Euclidean,SetPitch}`, `DurationKind::{Choice,Euclidean}`, `Score::{euclidean,beat_euclidean}`, `WeightedSubdivisionChoice`/`WeightedJathiChoice`/`BeatEuclideanSpec`. |
| **cseq-transforms** (4.1k) | SURGICAL | KEEP Half A: `apply_pipeline*` (49–119), selector/subdivide/tie/remove/set_velocity, `ResolvedSectionPlan` types (1470–1548), `resolve_section_plan(s)` **rewritten deterministic**, custom-section plan (2018–2192), `emit_pulse_spans` (2965–3096), accent sampling for kept accents. STRIP Half B: `apply_euclidean` (485–618), bhedam (1891–2017), single-param modulation (2193–2900), weighted gati/jathi/speed choosers (3098–3238), drift/morph (3718–3884), `apply_set_pitch`. Drop dep on cseq-jathi-bhedam. |
| **cseq-rhythm** (9.6k) | **TRIMMED, survives as generator+hocket crate** | KEEP: full hocket blocks — `Channel*` specs (97–497), resolvers + `EuclidAssigner` (7506–8169), channel validators (9378–9530), Bjorklund tables (4482–4663 as hocket internals), shared Markov walker `choose_entry/fallback/transition` (8727–8944, channel arms), `MarkovOrder`, `RhythmSeedMode`→`GeneratorSeedMode` (minus Drift/Morph/FollowGlobal), `resolve_seed`/`mix_seed`/`SplitMix64` (canonical home), slimmed `RhythmSpanInput`→`GeneratorSpanInput` + `ResolvedRhythmSpan/Cell`, NEW: `GeneratorConfig` + `resolve_generator_cycle` + `generators/example.rs`. STRIP: everything else (Markov rhythm chains, articulation system, arb-subdivision, speed spec, beat locks, shape groups, ratchet/ornament/flux specs, whole pitch block, extrapolate/import). |
| **cseq-trigger** (2.1k) | **KEEP 100%** | Triggered Tracks = tracks logic. `resolve.rs` reads PulseSpanKind — survives on deterministic structure. |
| **cseq-jathi-bhedam** (1.1k) | **DELETE** | + remove from cseq-transforms deps and cseq-transport dev-deps. |
| **cseq-realize** (0.4k) | KEEP 100% | Pure deterministic tree→event compiler (already errors on Choice/Euclidean/non-Fixed). |
| **cseq-transport** (19k of 41k) | SURGICAL ~50% + **file split (P6)** | KEEP: scheduler_loop (18180–18969) incl. orphan/stuck-note sweeps (:18840–:18882), Transport API (7275–7683) incl. panic/shutdown_now/set_parallel_playback, realize_and_enqueue* (7742–8252) with seam swap, realize_parallel_until PASS A/B/C (9771–10137), triggered follower (10138–10517), **all channel-logic** (`ChannelConflictPolicy`/matrix :615–646, FinalNoteGroup/`channel_overlap_components`/`collision_allowed_tracks`/`matrix_allowed_tracks`/`apply_parallel_channel_conflicts_for_keys` 8868–9770), note-off deferral (9058–9147) + ledger sweeps (6860–7077), tempo/automation sampling (3747–4534), LocalTempoAutomationMap + `map_parallel_queue_ticks` (8327–8856), overlay bridge (7200–7274, 11255–11608), hocket apply (13630–14790) + static-channel (:14791), synth monitor (7078–7199), layers.rs (layer set → midi/automation/hocket/realizedRhythm/trackFlow/conflict/trigger/seedTrace), trackflow.rs, fuzz hooks (738–967), snapshot/telemetry. STRIP: ratchet apply+math (11901–12579 + 14800–18179 minus any generic tempo helpers), ornaments (12580–13137), pitch apply (13138–13629), `apply_rhythm_to_tree` internals replaced by generator dispatch (10663–11266 → new slim version), stripped-feature validators/automate_* (969–2388, 4535–6456 keep hocket+seed+tempo ones), Ratchet/Ornament/Pitch/RealizedRhythm† events (†kept), `RatchetCarry`, CycleTempoFlux. |
| **cseq-midi** (0.8k) | KEEP 100% | Port name → "Seqstart MIDI". |
| **cseq-persist** (0.2k) | KEEP, reset | Score schema → fork v1; drop v1→v3 migrations; keep versioned+explicit-migration pattern + roundtrip property test. |
| **cseq-bench** (0.7k) | KEEP reduced | `fast_forward_parallel`, `realize_tracks`, `resolve_dense_channel(+_euclid)`, new `generator/example` case; drop rhythm/pitch/switch cases. |
| **src-tauri / cseq-app** (5.2k) | KEEP shell | Commands 39→31−8+2: DROP `score_create_euclidean`, `score_create_beat_euclidean`, `rhythm_preview`, `ratchet_preview`, `rhythm_extrapolate`, `rhythm_import_passage`, `pitch_import_passage`, `rhythm_set_playback`; ADD `generator_preview`, `track_set_playback`. Keep machine.rs (prefs/hot-plug/reconcile/debounce), e2e_harness.rs, menu (drop Rhythm-Shaper toggle), snapshot emitter, `LosslessSeed`, dto_fixtures (regenerated). |
| **fuzz/** | KEEP 4 of 9 | `persist_load_score`, `score_pipeline`, `structured_score_pipeline`, `parallel_transport_queue` (trimmed; it is the only note-balance guard besides invariants.rs); retire the rest. invariants.rs: keep all four invariant families, re-arm matrix to kept features + GeneratorConfig strategy (+ discriminant-coverage test). |

### 6.2 UI (`ui/src`)

**KEEP wholesale**: bridge.ts (trim DTOs), timelineModel.ts, TimelinePanel.tsx, LiveTransportReadout, resolvedSections.ts, telemetryGating.ts, playbackGating.ts, playbackLayers.ts (shrink), appInteractionPerformance.ts (LatestWinsQueue et al.), channelLogic.ts + ChannelLogicPanel.tsx, trackFlowBoxes.ts, trackRole.ts, trackPlaybackStates.ts, TrackRoleControl.tsx, DeleteTrackConfirmModal, triggerUi.ts, TriggerInspector.tsx, AccentControls.tsx, AutomationEditorModal/FocusModal/DebugPanel, SetupDialog.tsx, SynthPropertiesModal, MidiDebugPanel, midiRouting.ts, midiDebugFormat.ts, synthVoices.ts, machinePrefs.ts, sessionPrefs.ts, themePrefs.ts + ThemeToggle, NumericField/SliderField/Switch/ControlRow/CommitPointerRail, ModalChrome, MainEditorChrome (launcher: boundaries · generator · channel), editorDraftFlush.tsx, boundaryPlanning.ts, filenames.ts (new extensions), formatters.ts, u64Seed.ts, ErrorBoundary, main.tsx, index.html (title Seqstart).

**KEEP-modify**: App.tsx (11,514 → est. ~6–7k; strip ranges 1398–1780, 2434–2940 rhythm-preview parts, 2939–3510 non-hocket builders, 3512–3800, 4707–5010 reduce, 8284–8600 reduce, 8825–8930; keep everything tracks/flow/logic/persistence/transport/automation/machine); patchIo.ts (schema v1 §7); playbackRequests.ts (strip lock/shape/pitch/euclid-as-rhythm builders; keep fingerprint, parallel request, hocket + trackflow builders; add generator builder); automationTargets.ts (strip stripped-domain targets; add generator target); sectionsSubdivisionsLogic.ts (boundary helpers stay; weights die); SectionBoundariesPanel.tsx (boundary layer + accents bar; subdivision becomes a fixed-value editor; jathi→fixed Grouping; bhedam layer dies); BoundaryDetailDialog (position + fixed subdivision/grouping); WeightEditors.tsx (BoundaryProbabilityRail→boundary rail sans probability; SectionCountWeights/JathiWeights/SectionGridEditor die); ChannelShaperPanel + useChannelShaperState (kept whole minus ratchet/ornament gesture rows — **split hook first**, P2); TimelineLanes.tsx (keep Ruler/GatiMatra→Subdivision/JathiPulse→Grouping/RhythmLayer→Generator/ChannelHocket/Automation/Playhead; drop Ratchet/Pitch/FluxRail); styles.css (carve stripped feature blocks by range); SeedSetupDialog rebuilt small (tabs global | generator | channel | log); seedRecordingSession/SeedControls kept for kept domains (monitor stays iff History mode UI keeps it meaningful — default keep).

**KEEP because hocket/track-flow depend on them** (verify importers, keep minimal): markovWeights.ts (channel matrix editing idiom), euclidChannels.ts (hocket Euclid mode Bjorklund helpers).

**STRIP**: RhythmShaperPanel (5365), RatchetStrips (4769), RatchetTimeCurveEditor, BeatLockPanel (1655), ShapeGroupsPanel (1725) + ShapeSelectionMatrix + shapeSelectionViz, RandomizePanel (887) + randomize.ts (2257) + advancedMatrix(+Harness), PitchShaperPanel (2214) + PitchImportModal + PitchMatrixTransferModal + pitchCollectionDetect/MatrixTransfer/PassageImport/Recipes + huygensFokkerModes, useRhythmShaperState (2613), usePitchShaperState (1089), JathiBhedamEditor (670), ratchetDisplay.ts (extract tick-space helper first), ratchetRanges, rhythmShaperModel, rhythmSpeedLabels, seedStrategyModel (drift/morph parts), ArticulationSeedPolicyControl, 5 dead bridge wrappers.

**Pre-split hazards (P2, mechanical, before any deletion)**: (a) useChannelShaperState → kept-state hook vs doomed-state hook (161 useState; owns `setMainEditorOpen`, 5 open flags, velocity/accents, automationSet); (b) PitchNotation.tsx → `transportConstants.ts` (TRANSPORT_PPQN, PLAYHEAD_LATENCY_COMPENSATION_MS) + `timelineRenderModel.ts` + `e2eState.ts` (publishCaesuraE2eState) + `transitionHeat.ts` (Track Flow matrix modal dep) + `format.ts`; (c) ratchetDisplay.ts → extract kept tick-space conversion.

### 6.3 Test rig & tooling

- **Keep whole rig**: vitest (node + jsdom lanes), `test:timeline` node lane, Playwright mock (5178) / real (5179, via `cseq-app --features e2e-harness` HTTP invoke bridge) / bootcheck (5181) / fuzz / chaos / tools projects; mockTauri.ts trimmed per-command in lockstep; appHarness/realBackend/realTauri support; dto-contract two-way fixtures; guardrail tests (modelCoverage KNOWN_UNTESTED-empty, componentCoverage shrink-only register, e2eHarnessContract) updated same-commit as removals; golden ledgers (regen only at sanctioned phases); invariants.rs re-armed; proptest-regressions reset for changed crates.
- **Test carry-over**: keep ≈55 vitest suites (persistence/tracks/intersection/timeline/machine/sections/primitives/automation/loudness buckets per inventory), drop ≈33 stripped-bucket suites; keep 17 e2e specs (patch-persistence, track-export-import, machine-setup, launch-plan-first-slice, transport-and-locks, timeline-playback-parity, track-flow ×2, triggered-tracks, track-tablist-a11y, channel-shaper, channel-positions, channel-euclid [hocket kept!], score-setup-and-accents, boundary-authoring [trim weights], main-editor-launcher, control-chrome, interaction-performance, theme-contrast, real-backend-parity, model-ui-fuzzer, chaos-gremlins, css-dead-selector, _headershot], drop beat-locks/shape-groups/jathi-bhedam/pitch-shaper-restructure. Rust: keep model/transforms(kept-half)/trigger/realize/transport(kept)/midi/persist/machine tests + invariants + golden_ledgers; drop JB/rhythm-stripped inline tests (~15–18k lines die with their subjects).
- **scripts/**: keep bench.sh, perf-check.py + re-baselined perf-baseline.json, carve/ (used during P2/P3), fault-risk-surfaces.py, mutants.sh (re-scoped), fuzz-*.sh (pruned targets). **CI**: port rust.yml / ui.yml / e2e.yml / fuzz.yml with pruned steps; Node 20 in CI (document local Node-22 jsdom caveat); toolchain 1.88.0; pnpm 9.15.4.
- **Docs**: port the §4.1 keep-list (ARCHITECTURE, CHANNEL_LOGIC×3, SECTIONS spec, TRIGGERED_TRACKS, CONSECUTIVE_TRACK_BOXES, TRACK_EXPORT_IMPORT, LIVE_EDITING, TIMELINE parity docs, UI_AND_INTERACTION, TESTING, FUZZING, INVARIANT_FUZZER, KNOWN_RISKS, GLOSSARY, DEVELOPMENT_WORKFLOW…) rewritten where they reference stripped features; drop stripped-feature docs + ~30 one-shot CODEX/CLAUDE prompt files; NEW: README (quickstart-focused), docs/ADDING_A_GENERATOR.md, docs/UPSTREAM_FINDINGS.md, PROVENANCE.md, DEFER.md.

## 7 · Schema resets

- **Patch v1** (`.seqstart`): `PATCH_APP_ID="Seqstart"`, `PATCH_SCHEMA_VERSION=1`, zero legacy migrations; keep tolerant-normalizer architecture + resilience corpus (rewritten) + save→load→save idempotence property. Keep flat↔project duality (`flattenProjectPatchForActiveTrack`/`withProjectState`). Shape = v8 minus stripped blocks: per-track `{sequencer: {name, cycleBeats, boundaries[{id, afterBeat, subdivision, grouping|null}], velocity, accent{beatStart, sectionStartExtra, groupingStart, groupingMode}, basePitch, seedMode(Locked/PerCycle/History)+seed+history*, userPreviewCycle, panel-open state}, generatorEnabled, generator{kind:"example", densityPercent, seedMode}, automation, channelHocket (full minus ratchet/ornament modes), seedPaths}`; `project.global` = {tempoBpm, cycleBeats, channelConflictPolicy, channelLogicMatrix, conflictPriority, trackFlowBoxes, synthEnabled, synthPrograms}; `transport`, `setup` (write-only), `ui`. Unknown generator `kind` → default Example disabled + load warning.
- **Track envelope v1** (`.seqstart-track`): same envelope pattern; accepted versions = `{1}` (fixing upstream's discontinuous `{3,6,7,8}` whitelist by construction); importer integrity rules kept verbatim (fresh id, dedupe name, drop seedPaths/scoreSnapshot/trigger, re-derive priority+matrix).
- **Score v1** (`.cseq.json` shape, fork-versioned): cseq-model `SCHEMA_VERSION=1`; regenerate `examples/scores/*.json` (authored-fixed-subdivision forms) → they remain both serialization fixtures and golden-ledger inputs.
- **Machine prefs**: unchanged (v1) — new dir `~/Library/Application Support/com.foundry.seqstart/` via the new bundle id.

## 8 · Execution phases (subtractive; each phase = commits + annotated tag `phase-N-green`)

**Strategy: full-copy-then-delete.** Kept fraction is the majority; the test rig only nets on a full tree; the inventory is keyed to source line numbers which stay valid until each cut. Mechanism: `git -C carnatic-seq archive be8b1b8 | tar -x -C sequencer-quickstart` (tracked files only; source untouched).

**Gate definitions** — RUST-GATE: `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace --locked && cargo test -p cseq-transport --features fuzzing --test invariants --locked && cargo test -p cseq-transport --features fuzzing --test golden_ledgers --locked && cargo build -p cseq-app --locked` · FUZZ-GATE: `cargo check --manifest-path fuzz/Cargo.toml --locked` · UI-GATE (ui/): `pnpm typecheck && pnpm lint && pnpm test && pnpm test:timeline && pnpm build` · E2E-MOCK `pnpm test:e2e` · E2E-BOOT (bootcheck config) · E2E-REAL `pnpm test:e2e:real` · FIXTURES (fixed order, one `regen:` commit): `UPDATE_DTO_FIXTURES=1 cargo test -p cseq-app dto_fixture` → `pnpm vitest run -u src/dtoContract.generate.test.ts` → verify both clean · LEDGERS (sanctioned phases only): `UPDATE_GOLDEN_LEDGERS=1 …` → review diff → rerun clean. (`. "$HOME/.cargo/env"` before cargo; Node 22 locally for jsdom lanes.)

| P | Scope | Gate |
|---|---|---|
| **P0** (S) | Archive-extract be8b1b8 → `git init -b main`; baseline commit w/ `Source: carnatic-seq @ be8b1b8` trailer + tag `source-be8b1b8`; cleanup commit (4 tracked junk files; .gitignore fixes: `*.config.*.timestamp-*.mjs`, bare `test-results/`, `_tmp_*`, `.claude/worktrees/`); toolchain pin (rustup 1.88.0, corepack pnpm@9.15.4, `pnpm install`, `playwright install chromium`). **Full dress rehearsal of every gate → `BASELINE.md` expected-fail ledger** (track-import e2e expected red; possibly patch-persistence entries — record actuals). All later gates compare against this ledger. | FULL matrix |
| **P1** (S) | Identity: tauri.conf.json (`com.foundry.seqstart`, productName/title Seqstart), masthead, virtual port "Seqstart MIDI"(+" (e2e)"), fix title/port assertions in e2e + e2eHarnessContract. (Extensions/PATCH_APP_ID wait for P7.) Early so fork + Caesura can run concurrently. | build cseq-app, UI-GATE, E2E-BOOT, E2E-MOCK |
| **P2** (M) | Mechanical pre-splits, one commit each, zero behavior change: useChannelShaperState split; PitchNotation split (transportConstants/timelineRenderModel/e2eState/transitionHeat/format); ratchetDisplay tick-space extraction. | UI-GATE, E2E-MOCK, E2E-BOOT |
| **P3** (L) | UI feature strip (engine still intact ⇒ green throughout): delete rhythm/pitch/shape/randomize/bhedam/beat-lock/ratchet/flux/drift-morph panels+modules+their tests+their e2e; neutral-label pass on kept strings; guardrail-list edits same-commit; temporary `stripped-pending-P4` allowlist where UI↔Rust coverage maps cross; trim mockTauri UI flows (command mocks stay). | UI-GATE, E2E-MOCK, E2E-BOOT |
| **P4** (XL) | Engine strip + determinization, strangler order w/ `cargo check -p cseq-transport` per slice: (1) seam swap :7838–7885 → GeneratorConfig dispatch + `generators/example.rs` + `generator_preview` + `track_set_playback`; (2) determinize `resolve_section_plan` (fixed subdivision/grouping; DTO shapes byte-compatible); (3) pure-delete ratchet/ornament/pitch/locks/shapes/flux/drift-morph + inline tests; (4) trim cseq-transforms then cseq-model (model last); (5) trim cseq-rhythm to generator+hocket crate; delete cseq-jathi-bhedam; symbol grep-sweeps; (6) commands −8+2 + final mockTauri trim + drop `stripped-pending-P4`; (7) fuzz 9→4, cseq-bench reduce, re-author examples/scores. | RUST-GATE + FUZZ-GATE + FIXTURES + LEDGERS (sanctioned churn #1 — non-gati scores byte-identical or stop) + UI-GATE + E2E-MOCK + **E2E-REAL** + E2E-BOOT |
| **P5** (M) | Sections authoring surface: deterministic editor rewrite (boundary rail sans probability; fixed Subdivision/Grouping inspector), GeneratorEditor panel + launcher wiring, automation-target audit (add density target), examples/scores final forms. | UI-GATE, FIXTURES, LEDGERS (#2), E2E-MOCK, E2E-REAL, E2E-BOOT, cargo test |
| **P6** (L) | Transport lib.rs split, **pure moves only**, lib.rs becomes pub-use façade (external paths unchanged): `clock / engine / generator / overlay / sections / timeline / parallel / rewrite / snapshot` + existing layers/trackflow; inline tests move with subjects; no module >4k lines. After the strip (line-ref inventory must stay valid through P4; delete-then-move keeps both diffs reviewable). | RUST-GATE with goldens **byte-identical, no regen** (pure-move proof), FIXTURES verify-only, E2E-REAL smoke, E2E-BOOT |
| **P7** (L) | Persistence reset: patch v1 (§7) + extensions + PATCH_APP_ID; Score v1 in cseq-persist + model; track envelope v1; resilience corpus + idempotence property; filenames.ts/dialog filters/Rust validators; manual save→reload check. | RUST-GATE (goldens identical), UI-GATE, FIXTURES, E2E-MOCK+E2E-REAL persistence specs, E2E-BOOT |
| **P8** (M) | Import-regression fix (fork-only): failing e2e first; locate guards by status string (not line); root-cause fingerprint asymmetry `buildPatchDocument()` vs `currentAuthoredPatchFingerprintRef` (upstream guard :6326 `patchBuildStillMatchesCurrentAuthoring`; suspects fcd1e4f draft-flush + 1d67366/be8b1b8 seed serialization); fix + make every silent early-return emit a distinct `patchStatus`; fingerprint-symmetry unit test; audit sibling guards (upstream :6144/:6218/:6359/:6482/:7263 — Save/SaveAs/duplicate/new-track). After P7 so the fix targets the final buildPatchDocument. | new tests red→green; full E2E-MOCK; E2E-REAL import; UI-GATE; **BASELINE.md expected-fail list now empty** |
| **P9** (M) | Final re-baseline: FIXTURES+LEDGERS regen must be no-ops (determinism proof); guardrail audit; CI port (4 workflows, pruned); perf-baseline regen; docs (README/ARCHITECTURE rewrite, ADDING_A_GENERATOR, UPSTREAM_FINDINGS final, PROVENANCE, DEFER); tag `v0.1.0`. | full local matrix zero expected-fails, then all 4 CI workflows green |

**Git**: fresh history, no clone; provenance via commit trailer + tag + PROVENANCE.md. One logical strip/split/move per commit; never mix move+edit; `regen:` commits atomic with their cause; sanctioned ledger churn named in message; phase rollback = reset to previous `phase-N-green` tag.

## 9 · Risks (top 10, mitigated)

1. Hidden compile-coupling in transport strip (seed enums in kept structs, serde derives, `fuzzing`-feature hooks) → strangler order, model last, per-slice `cargo check`, invariants compiled `--features fuzzing` at every P4 sub-gate.
2. Golden-ledger auto-accept masking regressions → regen only P4/P5; unexpected diff at P6/P7 = stop and bisect; non-gati scores byte-identical even in P4.
3. DTO-fixture drift loops → single fixed-order regen, atomic commit, verify-run both; shape diffs outside P4/P5/P7 are bugs.
4. Fix-while-carving scope creep → only 6 sanctioned behavior changes (identity P1/P7, seam P4, sections P4/P5, schemas P7, import fix P8); all else → DEFER.md; P2/P6 verified behavior-identical.
5. Guardrail erosion (blind list-editing) → same-commit edits, per-phase guardrail-diff review as the strip manifest, bounded `stripped-pending-P4` window.
6. Import fix on wrong root cause → failing e2e first, string-located guards, symmetry unit test pins mechanism, deferred to P8.
7. e2e flake surface → per-phase gates are MOCK+BOOT; REAL only at engine/persistence gates; chaos/fuzz/soak CI-scheduled only; one-retry flake policy.
8. patchIo v1 silently dropping kept state → schema derived from post-P3 kept-hook inventory, idempotence property, v1 resilience corpus, manual save/reload at P7.
9. Baseline redder than believed (memory: 2 persistence-e2e failures were fixed only on an uncommitted branch; import spec red) → P0 dress rehearsal + BASELINE.md is the contract.
10. Sections⟂gati deeper than inventoried → determinize inside P4 before crate deletion; PulseSpan/ResolvedBeat pinned by fixtures; gati-ledger diffs reviewed value-by-value.

## 10 · Upstream findings ledger (seeds `docs/UPSTREAM_FINDINGS.md`; grows during execution — carnatic-seq NOT modified)

1. **Track-import regression** (bisected to fcd1e4f): `handleImportTrack` (App.tsx:6252–6350) exits through ~8 **silent** early-return guards; prime suspect guard :6326 fingerprint asymmetry (`buildPatchDocument()` vs `currentAuthoredPatchFingerprintRef`, plausibly aggravated by 1d67366/be8b1b8 seed-string changes); same pattern in 5 sibling handlers (Save/SaveAs/duplicate/new-track possibly affected). UX sub-finding: guards fail without surfacing errors.
2. Track-envelope version whitelist is discontinuous `{3,6,7,8}` — v4/v5 track files rejected (fix exists only on uncommitted branch claude/focused-lamarr-22955c).
3. `cseq-transport/src/lib.rs` = 40,997 lines in one file (54% inline tests).
4. Seed infra duplicated: SplitMix64 ×3, `mix_seed` ×2, entire Drift/Morph impl ×2 (transforms↔rhythm) with divergent helper names.
5. src-tauri bypasses cseq-persist — patch/track IO is hand-rolled serde_json validation in main.rs; two persistence mechanisms coexist.
6. Committed junk: `_tmp_19_*` (root + ui, 0-byte, tracked), `ui/vitest.config.ts.timestamp-*.mjs` (tracked + gitignore pattern gap), root `test-results/.last-run.json` (tracked + gitignore gap); `.claude/worktrees` ignored only via local `.git/info/exclude`.
7. `examples/scores/*.json` double as serialization fixtures AND golden-ledger inputs — hidden regeneration coupling.
8. `fuzzing` cargo feature is load-bearing for normal tests (invariants, golden_ledgers, cseq-bench dep).
9. Five dead bridge wrappers (scoreLoadFromPath/scoreLoadPreset/scoreCreateSubdivision/scoreCreateEuclidean/scoreCreateBeatEuclidean) — no UI callers; 3 have live Tauri commands behind them.
10. `styles.css` = 25,400 lines single file.
11. `PitchNotation.tsx` misnamed grab-bag holding timeline/e2e/matrix-heat/PPQN infra used by unrelated kept features.
12. `useChannelShaperState.tsx` god-hook: 161 useState incl. main-editor open flags + velocity/automation state unrelated to channels.
13. `PitchTab` type declares 5 tabs; only 3 render (dead `transpose`/`seeds` ids).
14. `cseq-bench/Cargo.toml` rayon rationale comment stale (transport itself now uses rayon).
15. ARCHITECTURE.md repo-layout drawing omits cseq-jathi-bhedam/cseq-trigger/cseq-bench.
16. CI runs vitest on Node 20 while project docs state jsdom suites need Node 22 locally — unverified discrepancy worth pinning down.
17. docs/ mixes ~30 one-shot CODEX/CLAUDE review-prompt files with durable design docs (101 files total).

## 11 · Defer list (DEFER.md in fork)

App.tsx decomposition beyond required splits; dependency upgrades (Playwright 1.42.1, React, Tauri, cargo update); mutants/perf recalibration beyond baseline regen; chaos/fuzz soak tuning; CSS dead-selector purge; additional generators beyond Example; cseq-*/CAESURA_* renames; icon/branding assets; timestamped MIDI delivery milestone; backporting any fix to carnatic-seq (explicitly out of scope — findings doc only); stopped-preview automation-sampling gap (documented, mirrors upstream).

## 12 · Acceptance (end state)

- `pnpm --dir ui typecheck/lint/test/build`, `cargo fmt/clippy/test --workspace`, invariants @64, golden ledgers, FIXTURES verify, E2E mock+real+boot: all green with **zero** expected-fail entries; CI 4/4 green.
- Fresh launch: Seqstart window, deterministic default cycle audible via built-in synth on Play, "Seqstart MIDI" visible in Audio MIDI Setup, destination picker + panic functional.
- Manual smoke: author 2 sections w/ different subdivisions → generator density 60% + PerCycle seed → timeline generator lane matches audio; record seed path → replay byte-identical (trace log); 2 tracks overlapping channel → Channel Logic "Overlap only" audibly gates; Track Flow box alternates members; triggered track launches on source rest; hocket Euclid distributes channels; patch save→quit→relaunch→autosave-recovery declined→recall patch → identical state; track export→import adds track (P8 proof).
- `docs/ADDING_A_GENERATOR.md` checklist verified by implementing… the Example generator itself as its own worked example (each of the 12 touch points cross-referenced to a real commit).

## 13 · Handoff prompt (GPT 5.6 implementer)

```
You are implementing a fully specified extraction plan. Read it first, follow it exactly.

PLAN: /Users/danielmiller/.claude/plans/cryptic-bouncing-harbor.md
SOURCE (READ-ONLY — never modify, never commit, never run write-tools inside):
  /Users/danielmiller/dev/projects/carnatic-seq   (use main @ be8b1b8)
TARGET (empty — build everything here):
  /Users/danielmiller/dev/projects/sequencer-quickstart

Rules:
1. Execute phases P0–P9 in order (plan §8). Do not reorder, merge, or skip phases.
2. At P0, copy the plan into the target repo as docs/EXTRACTION_PLAN.md and create
   BASELINE.md from a full dress-run of every gate; every later gate is judged
   against that ledger, not absolute green. Stop and investigate on any red
   beyond the ledger.
3. Run each phase's gate commands exactly as defined in §8 before tagging
   phase-N-green. Fixture/ledger regens only at sanctioned phases, atomic
   `regen:` commits.
4. Only the 6 sanctioned behavior changes are allowed (identity P1/P7, generator
   seam P4, sections determinization P4/P5, schema resets P7, import fix P8).
   Anything else you're tempted to improve goes to DEFER.md.
5. Every bug or shortcoming you discover in carnatic-seq goes into
   docs/UPSTREAM_FINDINGS.md (append to the 17 seeded in plan §10) — never fix
   it upstream.
6. Commit discipline per plan §8: one logical strip/split/move per commit, never
   mix move+edit, annotated tag per phase.
7. Environment: run `. "$HOME/.cargo/env"` before cargo; use Node 22 for local
   jsdom vitest lanes (CI stays Node 20); pnpm 9.15.4 via corepack.
8. If the code contradicts the plan (a line ref drifted, a dependency the
   inventory missed), prefer the code, note the deviation in
   docs/EXTRACTION_DEVIATIONS.md, and keep the plan's intent.

When you finish (or must stop), your FINAL output must be a short review prompt
(≤300 words) addressed to Fable (Claude) titled "Verify sequencer-quickstart
extraction". It must contain: (a) repo path + last phase tag reached and the
one-line status of each phase; (b) the exact gate commands to re-run and the
expected results incl. any BASELINE.md leftovers; (c) pointers to
EXTRACTION_DEVIATIONS.md, UPSTREAM_FINDINGS.md entries you added, and DEFER.md;
(d) 3–5 spot-checks you consider highest-risk for your own work (name file +
what could be wrong); (e) instruction to verify carnatic-seq is untouched
(`git -C /Users/danielmiller/dev/projects/carnatic-seq status` clean, HEAD be8b1b8).
Do not claim a gate passed without having run it.
```
