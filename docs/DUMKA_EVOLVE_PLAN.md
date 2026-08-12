# Design note — M3.75 "The evolution score": planned, scoped, visual evolution

Status: **implemented.** This began as the design-first artifact
(same convention as `DUMKA_FIGURES.md` / `DUMKA_PHRASE_DRIFT.md`) for
replacing "rate-percent roulette" with an authored plan: *pins* and
*ranges* on a cycle timeline, each naming an operator family, an
intensity, and an optional beat-range scope — all executed by the same
pure, identity-seeded fold, byte-replayable, through the one generator
seam. `planLengthCycles` remains canvas-only, directive trace remains a
preview/authoring artifact, and transport still consumes the ordinary span
result.

M3.8 extends each deterministic range with `perCycle`, `linear`, or
`easeInOut` pacing. The default is the original schedule; the latter two pace
one fixed target through the authored range. They remain part of this same
plan/fold contract rather than introducing a morph renderer.

## 1. Problem statement (verbatim from use)

The stochastic model (per-cycle Bernoulli fire at `evolutionRate`, then a
weighted family draw) produces clumps and droughts — evolution "sometimes
too fast, sometimes too slow," and never *where* the author wants it. The
author wants to say, exactly:

- "Cycles 1–12 repeat. **At cycle 13**, evolve **15%** by **Barlow
  indispensability**."
- "**At cycle 15**, **fragment** at **22%** intensity, **only in the last
  2 beats**."
- "**From cycle 5 through cycle 9**, syncopate by **32%**," spread evenly.
- Every family pinnable **independently**; a **graphic** shows the
  composition over time; the result is **audibly obvious**.

## 2. Architectural position

The plan is **config, not automation**. It rides `DumkaGeneratorParams`
as data, so preview and playback resolve it through the existing seam
with zero new paths; patches persist it; the DTO fixtures pin it both
directions; determinism is inherited (pure fn of params + ctx). The
existing automation lanes (`evolutionRate`/`driftLeash`/…) stay exactly
as they are and keep modulating the *stochastic layer*; they cannot carry
family + scope + intensity tuples and are the wrong vehicle for a score.

Cycle 0 remains the seed, always verbatim. The fold remains
`state(N) = step(state(N−1), N)`; directives only change what `step`
does at the cycles they cover.

## 3. Data model (engine, exact)

```rust
/// One authored evolution event: a pin (from == to) or a range.
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvolutionDirective {
    /// Stable authoring identity: salts, trace attribution, UI selection.
    pub id: u64,
    /// Application order within a cycle (UI-managed, dense from 0).
    pub order: u32,
    pub enabled: bool,              // authoring toggle; disabled = absent
    pub from_cycle: u64,            // inclusive; ≥ 1
    pub to_cycle: u64,              // inclusive; == from_cycle for a pin
    pub family: DirectiveFamily,
    #[serde(default)]
    pub pacing: DirectivePacing,    // PerCycle | Linear | EaseInOut
    /// 0–100; family-specific meaning, §4. Clamped, never rejected.
    pub intensity: u32,
    /// Beat window in the UNROTATED metric frame; None = whole cycle.
    pub scope: Option<BeatRange>,   // { start_beat: u32, len_beats: u32 }
    #[serde(default)]
    pub options: DirectiveOptions,  // all fields serde-defaulted
}

#[derive(Serialize, Deserialize, Default, ...)]
#[serde(rename_all = "camelCase")]
pub enum DirectivePacing {
    #[default]
    PerCycle,
    Linear,
    EaseInOut,
}

#[derive(Serialize, Deserialize, ...)]
#[serde(rename_all = "camelCase")]
pub enum DirectiveFamily {
    BarlowRemove, BarlowAdd, Rotate, Syncopate, Desyncopate,
    Fragment, Consolidate, Euclid,
    /// Schedules the legacy stochastic layer explicitly (§6).
    Stochastic,
}

#[derive(Serialize, Deserialize, Default, ...)]
#[serde(rename_all = "camelCase")]
pub struct DirectiveOptions {
    /// Overrides the global knob for this directive when Some.
    pub barlow_temperature: Option<u32>,   // pool widening
    pub fill_complexity: Option<u32>,      // Fragment k bias
    pub euclid_max_run: Option<u32>,       // 1–8
    pub euclid_invert: Option<u32>,        // percent
    pub euclid_rest_policy: Option<EuclidRestPolicy>,
}
```

`DumkaGeneratorParams` grows `#[serde(default)] plan: Vec<EvolutionDirective>`
and `#[serde(default)] plan_length_cycles: u32` (canvas extent only — the
engine never reads it; 0 = UI default view). **Empty plan ⇒ every existing
trajectory replays byte-identically** (the compat pin, §10).

Validation (authored, `GeneratorError`-pinned like every dumka knob):
`from_cycle ≥ 1`, `to_cycle ≥ from_cycle`, intensity/percents ≤ 100,
`euclid_max_run` 1–8, scope `len_beats ≥ 1`, JavaScript-safe positive IDs,
and at most 256 directives. The row cap is checked before overlap validation
or folding, so hand-edited and direct-invoke plans cannot turn authoring into
unbounded quadratic work. Two directives of the **same
family** with overlapping cycle spans are rejected
(`dumka plan overlap: {family} directives {a} and {b} share cycle {c}`) —
overlap across different families is the point and is fine. Scope is
validated against the *pattern's* beat count at resolve time, not author
time: a pattern edit that orphans a scope **skips the directive and
records it in the trace** (§7) — pattern edits must never brick playback.
`Stochastic` accepts only `PerCycle`; it is a probability gate, not a
deterministic target that can be tweened. Missing `pacing` defaults to
`PerCycle`, so every pre-smoothing patch and request retains its old schedule.
The tolerant TypeScript patch reader drops an explicitly invalid pacing row
with a warning; direct Rust DTO input remains strict and rejects unknown enum
values.

## 4. Intensity semantics — exact, per family

Intensity is a **deterministic quota**, not a probability. Let `C(c)` be
the candidate count the family sees at cycle `c` *within scope* (sounding
onsets for Remove; silent-uncovered slots for Add; legal vectors for the
Sioros pair; fragmentable intervals / consolidatable runs for figures;
reshape windows for Euclid; `total_beats` for Rotate).

- **Pin** (`from == to`): apply `n = ceil(intensity × C(c) / 100)`
  operations at that cycle (bounded by candidate exhaustion; each
  application recomputes candidates).
- **Per-cycle range** (the compatibility default): per covered cycle, an
  **error-diffusion accumulator** (Bresenham) spreads the same rate evenly:
  `acc += intensity × C(c) / 100; n = floor(acc); acc -= n`.
  The accumulator is per-directive fold state, reset at `from_cycle`.
  Candidate counts are recomputed after previous edits. This is the exact
  original range behavior and can deliberately compound a transformation.
- **Linear / Ease-in-out range**: freeze `C₀` at `from_cycle`, derive one
  target quota `Q` with the corresponding pin rule, and distribute `Q` across
  the inclusive range from integer cumulative progress. Linear uses a straight
  ramp. Ease-in/out uses integer smoothstep; it starts and ends more gently.
  The per-cycle request is the difference between this step's cumulative
  target and the previous step's, with the endpoint forced to exactly `Q`.
  Projection/exhaustion remains truthful and never becomes a later catch-up
  burst. A one-cycle smoothed range is the same endpoint as its pin.
- **Rotate**: intensity = percent of the cycle rotated across the
  directive's whole span (pin: `round(intensity × total_beats / 100)`
  beats at once; range: one-beat operator steps under the selected pacing).
  Direction lives in options (`earlier`/`later`) and defaults to `earlier`,
  matching the anticipatory bias of the Sioros pair; the UI exposes both.
- **Stochastic**: intensity replaces `evolutionRate` for the covered
  cycles; the family draw uses the authored weights as today. It rejects
  Linear/Ease-in-out because a probability envelope cannot guarantee a tween.

Within one application, target choice uses the family's existing ranked
candidate order + temperature pool (directive override or global), with
draws salted per §6 — so a 15% Barlow pin removes the *least
indispensable* ~15% (temperature 0) or a pool-widened selection, exactly
as the insight panels teach.

The word **pacing** is intentional. The unit being spread is one operator
application, not one note or a continuous mix coefficient. Add/Remove and the
Sioros pair usually make a small local edit; Rotate, Fragment, Consolidate, and
Euclid may reshape many events in one legal application. Gradual pacing makes
large batches less likely but does not promise a crossfade or a universal
bound on adjacent-cycle onset distance.

## 5. Scope — "only the last 2 beats"

`BeatRange {start_beat, len_beats}` ⇒ slot window
`[start×S, (start+len)×S)` on the unrotated grid (S = required
Subdivision). Threading: every `ranked_*` candidate enumerator
(barlow orders in `evolve.rs`, `figures::ranked_*`,
`reshape::ranked_reshape_windows`, `sioros::legal_*`) gains an optional
`window: Option<SlotRange>` filter; a candidate qualifies only if its
entire effect lies inside the window (onset in window; figure interval
⊆ window; reshape window ⊆ window; Sioros source **and** landing in
window — displacement never smuggles an onset across the scope edge).
Rotate with scope = cyclic slot-shift of the onsets inside the window
(a distinct, well-defined operation; the whole-cycle register is
untouched). Whole-cycle Rotate keeps the register semantics.

The scope is authored in beats because that is the musical unit the user
named; it survives Subdivision changes and is cheap to render as a
beat-strip glyph.

## 6. Determinism, salts, and layering

- New salt block: `SALT_PLAN: 0xD0A1_5EED_0010_0010`. Every directive
  draw: `draw(seed ^ SALT_PLAN ^ mix_seed(directive.id, ordinal), cycle,
  bound)` where `ordinal` numbers the draws inside one application
  (target pick, k pick, rotation, invert…). No draw-order coupling
  across directives or with the stochastic layer.
- **Layering rule** (exact): at cycle `c`, let `A(c)` = enabled,
  in-range, non-skipped directives sorted by `order`. If `A(c)` is
  non-empty, apply them in order and **skip the legacy stochastic fire
  draw** for that cycle. If `A(c)` is empty, cycle `c` behaves exactly
  as today (rate/weights/leash stochastic layer). The `Stochastic`
  family re-enters the old behavior *inside* a plan deliberately.
  Consequence: gaps in the plan are literal repetition when
  `evolutionRate` is 0 — "how many cycles of repetition" is authored by
  where the pins are.
- **Leash**: directive applications are exempt from the drift leash (the
  author demanded exactly this change; a silently vetoed pin is the
  "uncontrolled" feeling this design kills) but are **never** exempt
  from trial projection, the tie fence, or interval disjointness —
  playability stays inviolable. A projection-vetoed application is
  skipped and **traced**. The leash continues to govern `Stochastic`
  cycles. Loudly documented in DUMKA_EVOLUTION.md.

## 7. Observability — the trace (DTO extension)

"Easily apparent in the musical result" requires the engine to say what
it did. `resolve_generator_cycle`'s dumka path returns, alongside spans:

```rust
pub struct DirectiveTraceEntry {
    pub cycle: u64,
    pub directive_id: u64,
    pub family: DirectiveFamily,
    pub requested: u32,   // quota n for this cycle
    pub applied: u32,     // survived projection
    pub skipped: DirectiveSkip, // None | OrphanedScope | Projection | Exhausted
}
```

Wire: `generator_preview` response gains `trace: Vec<DirectiveTraceEntry>`
(serde default empty; absent for non-dumka and for cycle 0). Both DTO
fixture directions regenerate; the mock — which cannot fold — keeps
failing loudly for any evolving cycle and now treats a non-empty enabled
plan as evolving. Playback needs no trace (the ledger is the truth); the
trace is a preview/authoring artifact, which keeps the transport DTO
untouched.

For gradual ranges, `requested` and `applied` are deliberately the **current
cycle's delta**, not a cumulative completion percentage. A scheduled 0/0 hold
still emits an entry. The editor derives `step k of L` from the directive's
range and ID; it never sums whichever earlier traces happen to be in its
bounded preview cache and calls that authoritative progress.

Random-access preview resolves both structural and generator History seed
pools sequentially from cycle 0 through the requested cycle. Transport mutates
the same pools as it advances, so cycle-N composition, stopped preview, and
queued playback select the same seeds without making preview stateful.

## 8. The Evolve editor (UI)

A new full-window editor **Evolve** (launcher button beside Generator),
orchestrated from App.tsx but implemented in components + one pure model
module.

**Pure model** `ui/src/dumkaEvolvePlan.ts`: the TS mirror of the
directive schema plus every editing operation as a pure function —
`addPin(plan, family, cycle)`, `moveDirective`, `resizeRange`,
`setIntensity`, `setScope`, `setOptions`, `toggleEnabled`, `reorder`,
`setPacing`, `removeDirective` — each returning
`{ok, plan} | {ok:false, message}`
with the same-family-overlap rule enforced at edit time (the engine
re-validates; the editor never authors what the engine rejects).
Normalization mirrors patch rules; ids allocated
`max(existing)+1`; `order` kept dense.

**Canvas** `ui/src/components/EvolvePlanEditor.tsx`:

- X axis: cycles `0..max(plan_length_cycles, last directive + 4)`,
  zoom/pan (wheel + drag on a ruler identical in idiom to the timeline
  panel's cycle header). Cycle 0 rendered as a locked "seed" column. The
  stopped-preview canvas is virtualized and capped at cycle 10,000; rows beyond
  it remain persisted/executable and are summarized rather than mounted.
- One **lane per family**, fixed order = band order (Remove, Add,
  Rotate, Syncopate, Desyncopate, Fragment, Consolidate, Euclid,
  Stochastic), each in the family's established insight-panel color;
  collapsible to used-lanes-only.
- A **pin** renders as a diamond at (cycle, lane) with an intensity
  badge ("15%"); a **range** as a rounded bar `[from..to]` with the
  badge centered. Gradual ranges carry a visible Linear or Ease marker;
  **scope** renders as a beat-strip glyph inside the
  bar (N cells, covered beats filled — "last 2 of 4" is legible at a
  glance); disabled directives render hollow.
- **Gestures**: click empty lane space = pin at that cycle (family
  defaults); drag = move; drag either edge = grow into range; Alt-drag
  = duplicate; Delete = remove; every gesture keyboard-accessible
  (selection + arrow keys / fields — the a11y contract the component
  tests pin, and what Playwright drives).
- **Inspector** (selected directive): intensity NumericField, from/to
  cycle fields, enabled toggle, **Transition** (`Repeat each cycle`, `Linear
  transition`, or `Gentle transition`) for deterministic families,
  family-specific option fields, and the
  **scope picker** — the cycle's beats rendered as proportional blocks
  (reusing the rhythm-builder block idiom); click/shift-click selects a
  contiguous beat run; "whole cycle" clears. A deterministic pin offers
  **Smooth across 4 cycles**, which atomically turns it into a four-cycle
  Gentle transition. Stochastic exposes no Transition control.
- **Composition strip** (the requested graphic): a per-cycle summary row
  under the lanes — onset-count sparkline + density heat ribbon,
  computed from cached per-cycle previews (the existing
  `generator_preview` random access, ≤ cycle 10 000, debounced and
  LRU-cached exactly like the timeline's rhythm cache) — overlaid with
  **applied-trace ticks**: a filled tick where `applied > 0`, a hollow
  tick where a directive was skipped (tooltip carries the skip reason).
  Requested-vs-applied divergence is therefore visible per cycle. A selected
  gradual range also labels its current transition step; a zero-change easing
  hold remains visible rather than masquerading as an inactive gap.
- **Preview comparison**: selecting a directive scrubs the stopped preview
  (`userPreviewCycle`) to its `from_cycle`; a "before/after" toggle flips
  between `from_cycle − 1` and `from_cycle`. This is deliberately a visual
  stopped comparison. The editor does not promise sound from a playback path
  that does not exist. (True "play from cycle N" is a transport feature —
  tracked as an open question, not assumed.)

**Generator editor cross-link**: the Evolution card gains a one-line
plan summary ("Plan: 3 directives, cycles 13–17 · open Evolve") and the
stochastic knobs annotate themselves as "applies where no directive is
active."

## 9. Persistence, fixtures, mock, automation registry

- Patch v1: `plan` + `planLengthCycles` under the dumka generator config,
  normalized per §3 (unknown family ⇒ directive dropped with the
  existing disabled-with-warning tone; stable unique positive ids preserved,
  invalid/duplicate ids repaired, and order re-densified;
  absent pacing materializes as `perCycle`, while an unknown pacing or a
  smoothed Stochastic row is dropped as malformed with a warning;
  fail-closed key screening for every new field name against
  `STRIPPED_PATCH_KEYS`).
- DTO fixtures: `dumka_generator_preview_request.json` and
  `dumka_patch_document.json` regenerate with a rich 3-directive plan
  (a Per-cycle pin, a scoped Linear range, and a disabled Gentle directive);
  `preview` response
  fixture pins a non-empty trace. No-op proofs on both sides.
- Mock: plan-aware "evolving" predicate; still resolves cycle 0 and
  non-evolving configs bit-exactly; still throws the pinned message for
  folded cycles.
- Automation registry: **unchanged** (110 targets). The plan is not an
  automation target; the doc states why (tuple-valued, scoped, ordered).

## 10. Test matrix (regression-first)

Engine:
- Empty-plan byte-compat: every pinned M2/M3/M3.5 trajectory unchanged
  (the load-bearing pin).
- Scheduling: active-set per cycle (pins, ranges, order, enabled,
  same-family overlap rejection).
- Quota math: pin quota exactness; legacy Per-cycle Bresenham property — over
  `[from..to]`, `Σ applied == round(Σ intensity·C(c)/100) ± 1` with no
  cycle exceeding `ceil` (proptest).
- Gradual pacing: pinned linear/ease vectors, monotone integer cumulative
  targets, exact final target, duration-one pin identity, no projection
  catch-up, and deterministic replay. The canonical 8-onset 15% Remove target
  becomes counts `8, 8, 7, 7, 6` from the pre-range baseline through four
  linear cycles, instead of one 8→6 boundary.
- Scope: per family, candidates fully inside the window (proptest over
  random scopes); Sioros landing-in-scope; windowed Rotate is a pure
  cyclic shift; orphaned scope ⇒ skip + trace.
- Independence: two families pinned at one cycle both apply, in `order`.
- Leash exemption + projection supremacy: a directive change that the
  tie fence rejects is skipped and traced; playability proptest stays
  green under Grouping-3 spans.
- Pinned plan trajectory: the user's literal example (repeat to 12;
  Barlow 15% at 13; Fragment 22% scoped last-2-beats at 15) → exact
  event vectors at cycles 12/13/14/15/16 + byte replay.
- Golden: retain `dumka_planned.ledger.txt` as the Per-cycle compatibility
  anchor and add a full gradual-range window whose semantic assertions pin the
  adjacent-cycle onset counts as well as the MIDI bytes.
- Invariants strategy: 0–4 random valid directives through all property
  families; fuzz arm extension (bounded plan in
  `parallel_transport_queue`); `dumka_dsl_parse` untouched (plan is not
  notation).
- Bench: fold-to-10k with a 16-directive plan (accumulators are O(1)
  per directive per cycle; expect ≈ current ~17 ms).

UI:
- `dumkaEvolvePlan` model: every op, overlap rule, pacing transition, and
  normalization round-trip (patch → model → patch fixed point).
- Component: create/move/resize/scope/inspector flows by role/label;
  trace tick rendering from a fixture trace.
- e2e (real lane): author the user's example through the editor, Apply
  structure, play, assert every gradual cycle's trace and exact
  preview/playback spans (including History random access);
  mock lane covers editor CRUD + persistence round-trip with the plan
  (no folding asserted there).

## 11. Delivery choreography (M2/M3 discipline, ~8 commits)

1. `feat(rhythm)`: directive schema + validation + scheduling +
   accumulators in `evolve.rs` (`plan.rs` module); empty-plan compat pin.
2. `feat(rhythm)`: scope threading through every candidate enumerator +
   windowed Rotate.
3. `feat(rhythm)`: quota application per family + trace; pinned plan
   trajectory tests.
4. `feat(transport+app)`: trace through `generator_preview`; DTO
   fixtures both directions + no-op proofs; mock predicate.
5. `feat(patch+bridge)`: persistence + normalization + fixtures.
6. `feat(ui)`: `dumkaEvolvePlan.ts` + `EvolvePlanEditor` canvas +
   inspector + scope picker; Generator-card cross-link.
7. `test(golden+e2e) + regen`: `dumka_planned` golden; e2e flows; bench.
8. `docs`: DUMKA_EVOLUTION layering/leash rules; UI_AND_INTERACTION;
   EDITABLE_VALUE_INVENTORY (plan rows are structural, not automation);
   this note flips to implemented; ROADMAP.

## 12. Open questions (recommendation inline)

- **Plan looping** (`plan repeats every N cycles`): defer — re-entering a
  plan on evolved state is not a musical loop; needs its own design
  (interacts with M5 phrase drift).
- **Play-from-cycle transport**: investigate cost; if the engine can
  seek (the fold makes state(N) cheap), a "start at cycle N" transport
  affordance is the single biggest comparison win; not assumed here.
- **Intensity > 100 / compound pins**: clamped at 100; stacking two
  same-family pins at adjacent `order`s is the escape hatch.
- **Directive-level seed override**: defer; `id`-salting already gives
  each directive its own stream.
- **Morph-toward-target as a family** (M6+ DFT work): the directive
  schema deliberately leaves room (`family` is an enum; options are
  defaulted) — no schema break needed later.
