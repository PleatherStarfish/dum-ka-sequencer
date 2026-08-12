# Custom section subdivision — design & implementation plan

## Goal

Extend SECTION BOUNDARIES so that, in addition to today's "one gati fills every
beat of the section" behavior, a section may probabilistically use an
**equal-parts grid**: first choose whether to keep normal per-beat gati or use
equal parts, then choose **how many equal notes** fill the section (for example
5 sometimes, 8 other times), then choose **one gati for that whole equal-parts
grid**. **Jathi** remains the normal section-level accent pulse over the
section's total matras, exactly as it tiles a normal section today.

All existing gati/jathi/boundary behavior is **kept unchanged**. This is an
additive section *mode*, not a replacement.

## Decisions (confirmed)

1. **Mode choice:** each section with a custom spec has weights for keeping the
   normal per-beat gati path vs. using the equal-parts grid.
2. **Span vs parts:** when equal parts wins, the section's existing span (its
   whole cycle-beats) is split into **N equal notes**. A section spanning 4
   cycle-beats divided into 5 → five equal notes, each `4/5` of a cycle-beat
   long. Part count is a weighted random choice and is decoupled from the
   integer cycle-beat grid.
3. **Grid gati:** the equal-parts grid resolves **one weighted gati choice**
   for all of those equal notes. It does not choose a separate gati per note.
4. **Jathi:** **one jathi over the whole section's matras.** `total_matras =
   resolved_part_count * resolved_grid_gati`; a single chosen jathi must divide
   `total_matras` evenly and tiles the section's full duration (current jathi
   semantics, just over a non-beat-aligned grid).

## Why this is a real architectural change (the invariant it bends)

Today (see `AGENTS.md`): *"Gati is per beat, not per section duration"*, *"Section
boundaries are after beats, not arbitrary fractional positions"*, and every beat
in a section shares one gati. The current `ResolvedSectionPlan` encodes exactly
one `gati` and a uniform `beat_matra_count()` for the entire section, and
`emit_pulse_spans` lays out uniform gati frames keyed to **integer** beats
(`GatiBeat { beat, gati }`).

Custom subdivision deliberately introduces a section whose **equal notes are
fractional-beat-length and share one grid-wide gati**. The good news: the engine is
built on exact `Rational` time (cycle length, offsets, jathi spans already use
`start_matra * beat_count / total_matras`), so fractional divisions are exactly
representable with no float drift. The work is to thread a **non-uniform
equal-parts grid** through plan resolution, span emission, the matra/accent
build loop, preview DTO, and timeline — **without touching the uniform path**.

## Data model (cseq-model)

Add an **optional** custom-subdivision spec to a section boundary. Two carriers
need it: the initial section (cycle start) and each `SubdivisionInflection`
(fired boundary that starts a section).

```rust
/// Legacy row for older fixed custom grids.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomDivision {
    pub gati_weights: Vec<WeightedSubdivisionChoice>,
}

pub struct WeightedCustomPartCount {
    pub count: u32,
    pub weight: f32,
}

/// Optional custom equal-parts mode. When present, the section samples whether
/// to use normal per-beat gati or equal parts. Equal parts then samples one part
/// count and one grid-wide gati.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSubdivisionSpec {
    pub per_beat_weight: f32,
    pub equal_parts_weight: f32,
    pub part_count_weights: Vec<WeightedCustomPartCount>,
    pub part_gati_weights: Vec<WeightedSubdivisionChoice>,
    /// Legacy fixed custom grid rows.
    #[serde(default)]
    pub divisions: Vec<CustomDivision>,
    /// Legacy/deprecated: equal-parts sections use the section's regular jathi
    /// weights. This exists only so older custom specs round-trip.
    #[serde(default)]
    pub jathi_weights: Vec<WeightedJathiChoice>,
}
```

- `SubdivisionInflection` gains `#[serde(default, skip_serializing_if = "Option::is_none")] pub custom_subdivision: Option<CustomSubdivisionSpec>`.
- `SubdivisionSwitchSpec` gains `#[serde(default, skip_serializing_if = "Option::is_none")] pub initial_custom_subdivision: Option<CustomSubdivisionSpec>` (for a custom-subdivided first section).
- All `#[serde(default)]` + `Option`, so **existing patches deserialize unchanged** (custom = `None` → today's behavior). No schema bump required (loader already tolerates new optional fields); add normalization defaults like the other specs.

Validation helpers (model): mode weights are finite and non-negative; if equal
parts can win, at least one part-count option and one grid-gati option must have
positive weight; gatis are allowed values. Jathi **divisibility is resolved at
realize time** because it depends on the sampled part count and grid gati.

## Engine (cseq-transforms) — the core

`apply_subdivision_switch` currently derives, per beat, a `current_gati` and
section-start flags, then `resolve_section_plans` collapses runs of beats into
`ResolvedSectionPlan { gati, … }`. The custom path forks at the section level.

### Plan shape

Generalize `ResolvedSectionPlan` to carry an optional equal-parts layout:

```rust
struct ResolvedDivision {
    gati: u32,
    /// matras in this equal part (the one grid-wide gati)
    matra_count: u32,
    /// exact start within the cycle and exact duration (fraction of a beat)
    start: Rational,
    duration: Rational,
    start_matra: u32, // running matra offset within the section
}

struct ResolvedSectionPlan {
    // ...existing fields stay for the uniform path...
    /// Some(divisions) => equal-parts section; None => uniform gati path.
    custom: Option<Vec<ResolvedDivision>>,
}
```

For the uniform path `custom = None` and **all existing fields/behavior are
unchanged** (this is the key to not regressing the 200+ existing tests).

### Resolving a custom section

When the section's originating boundary has a `CustomSubdivisionSpec`:

1. Sample equal-parts mode vs. per-beat mode from `per_beat_weight` and
   `equal_parts_weight`. If per-beat wins, the requested section uses the
   normal path but still carries the custom subdivision surface for
   single-parameter modulation.
2. Sample `N` from `part_count_weights`. Each equal note duration is
   `beat_count / N` (a `Rational`).
3. Sample one grid gati from `part_gati_weights`. Every equal note uses that
   gati. `total_matras = N * grid_gati`. Each matra's exact time = note start +
   `(k / grid_gati) * note_duration`, all `Rational`.
4. **Jathi:** sample one jathi from the section's regular
   `initial_jathi_weights` / `inflection.jathi_weights`; accept only if
   `total_matras % jathi == 0` (reuse `choose_jathi`'s validity filter against
   `total_matras`; if none valid, `jathi = None`). Jathi pulses tile the
   section's **full duration** using the same matra→time mapping (a jathi pulse
   of `jathi` matras may now span a division boundary — that's fine and
   intended, "jathi as if any other matras").

When `single_parameter_rhythmic_modulation` is enabled, the sampled request is
still resolved first and consumes the same RNG as when modulation is off. The
conservative candidate search then treats enabled equal-parts grids as valid
section-plan candidates alongside enabled per-beat gatis:

- if per-beat mode is enabled, uniform candidates come from the section's gati
  weights, plus the previous/requested uniform grid for continuity;
- if equal-parts mode is enabled, equal-parts candidates come from the
  part-count and grid-gati weight surfaces, plus the previous/requested
  equal-parts grid for continuity;
- equal-parts gati-only candidates compare the duration of one equal part;
- equal-parts jathi candidates validate against `N * grid_gati` total matras and
  compare `jathi * section_beats / (N * grid_gati)`.

Jathi-bhedam is applied after this final grid decision so its cells tile the
realized, possibly modulated, section matras.

### Span emission (`emit_pulse_spans`)

For a custom section, emit:
- The `Section` span (unchanged: full span, `total_matras`).
- One `GatiBeat`-style span **per equal part**, each at its own
  `start`/`duration`, with `matra_count = grid_gati` and `gati = grid_gati`.
  The `beat` field becomes the equal part's 1-based index within the section
  (it's already only used as a label/id seed). Tag them `gati-beat` +
  `protected-accent-span` exactly as today so the Markov rhythm partitioner
  treats each equal part as one accent frame.
- Jathi spans (if resolved): identical loop to today, over `total_matras`.

Because each equal part is a `gati-beat` accent span, `rhythm_accent_spans` and
the rhythm partitioner keep working unchanged — they already iterate spans, not
the integer beat grid.

### Matra/accent build loop

Today the loop iterates `beat_index in 0..cycle_beats` and, for each, builds
`beat_matra_count` matras. For custom sections the iteration unit becomes the
**division** rather than the cycle-beat. Cleanest implementation: build the
duration tree from the **resolved spans / divisions** rather than re-deriving per
integer beat. Concretely, factor the per-frame matra emission into a helper that
takes `(start, duration, gati, matra_count, section_relative_matra_base,
is_section_start, jathi)` and call it:
- uniform path: once per integer beat (current behavior), and
- custom path: once per equal part, using the section's one sampled grid gati.

Accents: `is_gati_start` = first matra of an equal part; `is_section_start` =
first matra of the section's first equal part; `is_jathi_start` =
`section_relative_matra % jathi == 0`. This matches the user's "jathi applies as
if it were any other matras" precisely.

### Automation

Per-beat automation (pitch/velocity/accent) is sampled by beat index today. For
custom sections we sample each equal part at the nearest cycle-beat for the
existing beat-indexed targets (or extend sampling to equal-part granularity).
v1: sample at the equal part's **start-beat index** (floor of its start position)
to stay compatible with the beat-quantized automation model; note as a
refinement that finer equal-part automation can come later.

## Tauri DTOs (`src-tauri/main.rs`)

- Add `CustomPartCountDto { count, weight }` and `CustomSubdivisionDto {
  per_beat_weight, equal_parts_weight, part_count_weights, part_gati_weights,
  legacy jathi_weights }`; thread onto the boundary/inflection request DTOs and
  the `SubdivisionSwitchRequestDto` (initial). Mapping intentionally ignores the
  custom jathi field; regular section jathi weights remain the source of truth.
- **Preview DTO:** `ResolvedBeatDto` currently describes resolved beats. For
  custom sections the resolved units are equal parts. Add per-beat fields already
  present (gati, jathi, section-start, accent) computed **per equal part**, and
  add an optional `division_index` / `division_count` so the timeline can render
  non-uniform widths. Preview must walk the same resolver so "what you see is
  what plays" holds (the project's core contract).
- Validation command surfaces model validation errors (positive mode weights,
  part counts 1-64, positive grid gati weights, allowed gatis/jathis).

## Bridge (`ui/src/bridge.ts`)

Add `CustomPartCountChoice`, `CustomSubdivision` types; add
`customSubdivision?: CustomSubdivision | null` to the inflection/boundary types
and `initialCustomSubdivision` to the switch request; extend preview beat type
with `divisionIndex?/divisionCount?`.

## Frontend (`ui/src/App.tsx`)

- `BoundaryPoint` gains `customSubdivision: CustomSubdivision | null` (and the
  initial-section editor gets the same). Default `null` → today's UI/behavior.
- SECTION BOUNDARIES panel: place **Equal-parts grid chance** beside the existing
  Gati/Jathi controls for the section. When enabled, reveal:
  `per_beat_weight` vs `equal_parts_weight`, weighted equal-part count choices
  (for example 5 and 8), and **one grid-gati weighted picker** used by all equal
  notes in the chosen grid. Jathi stays in the regular Jathi control and tiles
  the resolved section in either mode.
- `buildInflections` (the `boundary → SubdivisionInflection` mapper, ~line 4973)
  passes `customSubdivision` through; a boundary still needs regular positive
  gati weights when per-beat mode can win, and the equal-parts grid needs a
  positive part-count weight plus a positive grid-gati weight.
- Timeline: render custom sections as N non-uniform equal-part cells (widths
  from `divisionCount`) using the preview DTO; keep ghost/parity behavior. Reuse
  existing gati-beat span rendering, just driven by the preview's equal-part
  spans rather than assuming uniform widths.
- Persistence/normalization: `normalizeBoundary` defaults `customSubdivision` to
  `null`; round-trips through patch state.

## Tests (write first, run with cargo / vitest / Playwright)

**cseq-model:** custom spec serde round-trip; absence deserializes to `None`
(back-compat); validation rejects invalid mode weights, invalid part counts,
empty grid-gati weights, and disallowed gati/jathi.

**cseq-transforms (core, deterministic with a locked seed):**
- `custom_section_divides_span_into_n_equal_parts`: 4-beat section, N=5 →
  five equal parts each `4/5` beat; assert exact `Rational` starts/durations.
- `custom_grid_gati_resolves_once`: part-count choices choose N, grid-gati
  choices choose one gati, and every equal part has that matra count.
- `custom_section_jathi_tiles_total_matras`: total matras divisible by jathi →
  jathi pulses tile full section duration, may cross division boundaries;
  non-divisible jathi weight is rejected (jathi=None).
- `custom_section_emits_one_gati_span_per_equal_part` + section span + jathi spans.
- `uniform_section_unchanged_when_custom_is_none`: byte-identical plan/spans to
  today (regression guard — protects every existing behavior).
- Accent tags: section-start on first equal part's first matra; gati-start per
  equal part; jathi-start by matra modulo.

**cseq-transport / parity:** a realized custom section's MIDI note offsets match
the preview's equal-part matra grid (timeline↔MIDI parity for the new mode);
ratchet/ornament still operate per the emitted spans.

**src-tauri:** preview DTO reports equal-part beats with gati/jathi/section
flags; validation errors surface.

**Frontend:** `buildInflections` passes custom spec; vitest for the
part-count/grid-gati reducers; Playwright discovery for the new controls;
timeline renders N cells.

## Non-goals (v1, explicitly deferred)

- Per-equal-part **speed multipliers** (anuloma/pratiloma inside a custom part).
  Custom equal parts are plain grid-gati frames in v1; speed warping can layer on
  later via the existing `RhythmSpeedSpec` keyed to equal-part contexts.
- **Per-equal-part jathi** (we ship one jathi over the whole section per the
  decision).
- Equal-part-level (sub-beat) automation granularity (v1 samples at the part's
  start-beat index).

## Rollout phases

1. **Model**: types + serde + validation + back-compat tests.
2. **Engine**: `ResolvedSectionPlan.custom`, custom resolver, span emission,
   factored matra-build helper, tests (incl. the uniform regression guard).
3. **DTOs + preview**: request/preview DTOs, preview walks the resolver, tests.
4. **Bridge + frontend**: types, BoundaryPoint, SECTION BOUNDARIES UI, timeline
   render, persistence, tests.
5. **Verify**: `cargo test`/`clippy`, frontend typecheck/build/vitest/Playwright;
   update `AGENTS.md` (note the new section mode + that the "gati per beat"
   invariant still holds for uniform sections) and rhythm docs.
