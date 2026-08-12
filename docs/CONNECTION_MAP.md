# Caesura Sequencer — Connection Map

Seven scoped Mermaid diagrams showing how the crates, functions, presets, and UI
modules connect. One giant graph would be unreadable, so each subsystem gets its
own diagram. Every node label is a real identifier from the codebase (verified
against source).

---

## 1. Crate dependency graph

Internal path dependencies across the Rust workspace, the Tauri shell, and the
React frontend (arrows point from dependent → dependency). `cseq-model` is the
pure-data root everything builds on; `cseq-transport` is the integrator.

```mermaid
flowchart TD
  subgraph frontend["Frontend (React / TS)"]
    ui["ui/src UI"]
    bridge["bridge.ts (only Tauri caller)"]
  end
  subgraph shell["Shell"]
    tauri["src-tauri (cseq-app)"]
  end
  subgraph core["Rust core crates"]
    model["cseq-model"]
    jathi["cseq-jathi-bhedam"]
    trigger["cseq-trigger"]
    rhythm["cseq-rhythm"]
    realize["cseq-realize"]
    persist["cseq-persist"]
    transforms["cseq-transforms"]
    transport["cseq-transport"]
    midi["cseq-midi"]
  end

  ui --> bridge
  bridge --> tauri

  tauri --> transport
  tauri --> midi
  tauri --> model
  tauri --> transforms
  tauri --> rhythm
  tauri --> trigger

  transport --> model
  transport --> realize
  transport --> rhythm
  transport --> transforms
  transport --> trigger
  transport --> midi

  transforms --> model
  transforms --> jathi
  jathi --> model
  trigger --> model
  rhythm --> model
  realize --> model
  persist --> model
```

---

## 2. End-to-end request / playback flow

From a React panel edit, through the single Tauri caller, into the per-cycle
realization pipeline, out to CoreMIDI and the built-in synth.

```mermaid
flowchart TD
  subgraph fe["Frontend"]
    App["App"]
    build["buildParallelPlaybackRequest"]
    br1["parallelSetPlayback (bridge)"]
    br2["rhythmSetPlayback (bridge)"]
  end
  subgraph cmd["Tauri commands"]
    pcmd["parallel_set_playback"]
    rcmd["rhythm_set_playback"]
  end
  subgraph tp["cseq-transport"]
    sched["scheduler_loop"]
    rpar["realize_parallel_until"]
    renq["realize_and_enqueue"]
    apipe["apply_pipeline_for_cycle_mut (transforms)"]
    a2t["apply_rhythm_to_tree"]
  end
  subgraph rz["cseq-realize / rhythm overlays"]
    rlz["realize"]
    rat["apply_ratchet"]
    orn["apply_ornament"]
    pit["apply_pitch_shaper"]
    hoc["resolve_channel_hocket"]
  end
  subgraph out["cseq-midi"]
    mo["MidiOutput.send_raw / send_at"]
    synth["BuiltinSynth.send_midi"]
  end

  App --> build --> br1 --> pcmd
  App --> br2 --> rcmd
  pcmd --> sched
  rcmd --> sched
  sched --> rpar --> renq
  renq --> apipe --> a2t
  a2t --> rlz --> rat --> orn --> pit --> hoc
  hoc --> sched
  sched --> mo
  sched --> synth
```

---

## 3. Rhythm engine (`cseq-rhythm`) internals

The Markov resolution entry points plus the overlay spec DTOs that decorate
resolved spans (ratchet, ornament, pitch shaper, channel hocket) and cycle-level
tempo flux. These specs are authored in the UI and consumed by transport.

```mermaid
flowchart TD
  subgraph resolve["Resolution"]
    rrs["resolve_rhythm_with_seed_mode_and_subdivision_layers"]
    art["resolve_rhythm_articulation"]
    rspan["ResolvedRhythmSpan"]
    rres["RhythmResolution"]
  end
  subgraph chain["Markov chain"]
    chainspec["RhythmChainSpec"]
    order["MarkovOrder"]
    validate["validate_chain"]
    extra["extrapolate_chain"]
    imp["import_passage_chain"]
  end
  subgraph subdiv["Subdivision / speed"]
    arb["ArbitrarySubdivisionSpec"]
    speed["RhythmSpeedSpec"]
    flux["CycleTempoFluxSpec"]
  end
  subgraph overlays["Overlay DTOs"]
    ratp["RatchetPlaybackSpec"]
    ratcurve["RatchetCurve / RatchetTimeCurveSpec"]
    ratint["RatchetInternalRhythmSpec"]
    ornp["OrnamentPlaybackSpec"]
    pitp["PitchShaperSpec"]
    pcol["PitchCollection"]
    hocp["ChannelHocketSpec"]
    artspec["RhythmArticulationSpec"]
  end

  rrs --> chainspec
  rrs --> arb
  rrs --> speed
  rrs --> rspan
  rres --> rspan
  art --> artspec
  art --> rspan
  chainspec --> order
  validate --> chainspec
  extra --> chainspec
  imp --> chainspec
  ratp --> ratcurve
  ratp --> ratint
  ratint --> chainspec
  pitp --> pcol
  flux --> rrs
```

---

## 4. Transform / SubdivisionSwitch pipeline

`apply_subdivision_switch` orchestrates gati resolution → section boundaries →
jathi choice → conservative modulation → jathi-bhedam realization → span/matra/
accent emission, delegating accent cells to `cseq-jathi-bhedam`.

```mermaid
flowchart TD
  subgraph pipe["cseq-transforms"]
    apply1["apply_one"]
    ass["apply_subdivision_switch"]
    rseed["resolve_seed"]
    csub["choose_subdivision"]
    rbf["resolve_boundary_fires_and_custom_choices"]
    rsps["resolve_section_plans"]
    rsp["resolve_section_plan"]
    rcsp["resolve_custom_section_plan"]
    cj["choose_jathi"]
    csm["choose_speed_multiplier"]
    consv["conservative_section_plan"]
    abt["apply_bhedam_technique"]
    dbt["decide_bhedam_technique"]
    eps["emit_pulse_spans"]
    bmn["build_matra_nodes"]
    sau["sample_automation_u8 / _accent / _bool / _f32"]
    av["accented_velocity"]
  end
  subgraph jb["cseq-jathi-bhedam"]
    selt["select::select_technique"]
    bew["select::bhedam_effective_weight"]
    rsa["realize::realize_section_accents"]
    evolve["evolve::evolve"]
    ops["ops (retrograde, split, merge, resolve_to_total_matras)"]
  end

  apply1 --> ass
  ass --> rseed
  ass --> csub
  ass --> rbf
  ass --> rsps --> rsp
  rsp --> rcsp --> cj
  rsp --> csm
  rsp --> consv
  rsp --> abt --> dbt
  dbt --> selt
  dbt --> rsa
  ass --> eps
  ass --> bmn --> sau
  bmn --> av
  bew --> selt
  selt --> rsa
  rsa --> evolve --> ops
```

---

## 5. Triggered tracks + parallel / track-flow runtime

Trigger-graph validation, cycle resolution, and windowed launch compilation
(`evaluate_gate` → `choose_start`), feeding the parallel scheduler and the Track
Flow walker. Everything in `cseq-trigger` is pure/seeded (windowing-associative);
the transport thread consumes its `CompiledLaunch` output.

```mermaid
flowchart TD
  subgraph pure["cseq-trigger (pure logic)"]
    norm["config::normalize_track_modes"]
    rcfs["resolve::resolve_cycle_from_spans"]
    cw["compiler::compile_window"]
    ecs["evaluator::evaluate_cycles"]
    ec["evaluator::evaluate_cycle"]
    eg["gate::evaluate_gate"]
    cs["start::choose_start"]
    cl["CompiledLaunch / CompiledWindow"]
    carry["TriggerCarry"]
  end
  subgraph runtime["cseq-transport parallel runtime"]
    rpar["realize_parallel_until"]
    rtf["realize_triggered_follower"]
    merge["merge_parallel_queue"]
    prt["ParallelRuntimeTrack"]
    tfr["TrackFlowResolver"]
    tfs["TrackFlowSpec"]
  end

  norm --> cw
  rcfs --> ec
  cw --> ecs --> ec
  cw --> eg
  cw --> cs
  cw --> carry
  cw --> cl
  rpar --> rcfs
  rpar --> rtf --> cw
  rpar --> merge
  rpar --> prt --> tfr --> tfs
  cl --> merge
```

---

## 6. UI structure

`App` drives the shaper panels (each paired with a state hook), the randomize
workflow with its preset tables, and the pure-logic request/patch builders that
all funnel through `bridge.ts`.

```mermaid
flowchart TD
  App["App"]
  subgraph panels["Shaper panels + hooks"]
    rsp["RhythmShaperPanel"]
    urs["useRhythmShaperState"]
    psp["PitchShaperPanel"]
    ups["usePitchShaperState"]
    csp["ChannelShaperPanel"]
    ucs["useChannelShaperState"]
    jbe["JathiBhedamEditor"]
  end
  subgraph rand["Randomize + presets"]
    rpanel["RandomizePanel"]
    rr["randomizeRhythm / randomizePitch / randomizeChannel"]
    hf["HUYGENS_FOKKER_12_TET_COLLECTIONS"]
    sv["SYNTH_VOICE_PRESETS"]
    bam["buildAdvancedStochasticMatrix"]
    recipes["RANDOMIZE_RECIPES"]
  end
  subgraph pure["Pure logic / IO"]
    bppr["buildParallelPlaybackRequest"]
    rpr["rhythmPlaybackRequestFromParallelTrack"]
    brc["buildRhythmChainForLength"]
    rpd["readPatchDocument"]
    bridge["bridge.ts"]
  end

  App --> rsp --> urs
  App --> psp --> ups
  App --> csp --> ucs
  App --> jbe
  App --> rpanel
  rpanel --> rr
  rr --> recipes
  rr --> bam
  rr --> hf
  rr --> sv
  App --> bppr --> rpr --> brc
  App --> rpd
  bppr --> bridge
```

---

## 7. Persistence & snapshot / debug flows

Patch/track/autosave save-load through `cseq-persist` (schema-versioned,
currently v3), and the `PlaybackLayers` telemetry rings captured per cycle and
streamed back to UI debug panels at 60 Hz.

```mermaid
flowchart TD
  subgraph save["Persistence"]
    psave["patch_save_to_path / track_save_to_path"]
    pauto["patch_autosave"]
    pload["patch_load_from_path / patch_load_autosave"]
    save2["persist::save"]
    load2["persist::load / load_from_str"]
    migrate["persist::migrate"]
    score["model::Score"]
  end
  subgraph debug["Snapshot / debug rings"]
    rcpe["record_cycle_playback_events"]
    layers["PlaybackLayers rings"]
    emit["spawn_snapshot_emitter (60Hz)"]
    snap["transport_get_snapshot"]
    onlog["onTransportLogSnapshot / onTransportTimelineSnapshot"]
    midp["MidiDebugPanel"]
    tinsp["TriggerInspector"]
    tl["TimelineLanes"]
  end

  psave --> save2 --> score
  pauto --> save2
  pload --> load2 --> migrate
  load2 --> score
  rcpe --> layers
  emit --> snap --> onlog
  layers --> emit
  onlog --> midp
  onlog --> tinsp
  onlog --> tl
```

---

## Legend & notes

- **Arrows** mean "depends-on / calls / feeds-into" in the direction drawn;
  type-containment is drawn the same way for readability.
- **Node ids** are alphanumeric; the real symbol names (with `::`, `()`, `/`)
  live inside the quoted labels.
- **Single Tauri boundary:** `ui/src/bridge.ts` is the only frontend module that
  invokes Tauri commands — all UI → Rust traffic passes through it (diagrams 2, 6).
- **Canonical per-cycle pipeline** (diagram 2): `apply_pipeline_for_cycle_mut` →
  rhythm resolution + arbitrary subdivision → articulation overlay → `realize` →
  ratchet → ornament → pitch shaper → channel hocket → optional cycle tempo-flux
  warp → scheduler queue → CoreMIDI + synth. Rewrites are deliberately
  **cycle-local** (already-queued future cycles are never re-ratcheted/re-hocketed).
- **Purity boundary:** `cseq-trigger` and `cseq-jathi-bhedam` are pure/seeded;
  the only async boundary is the transport `scheduler_loop` thread, which consumes
  their `CompiledWindow` / accent outputs.
- **Presets** live entirely in the UI: `HUYGENS_FOKKER_12_TET_COLLECTIONS`
  (tuning/mode collections), `SYNTH_VOICE_PRESETS` (GM voices), and
  `RANDOMIZE_RECIPES` — all fed into `randomize*` and the shaper panels (diagram 6).
  Ratchet **time-curve presets** live in `cseq-rhythm` as `RatchetTimeCurveSpec`
  (diagram 3).
- **Scope:** each diagram shows the load-bearing symbols for one subsystem; leaf
  helpers and secondary data types are elided to keep every graph legible.
