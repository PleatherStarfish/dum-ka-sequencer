# Design note — M3.97 "Property curves": drawable per-property automation for the whole composition

Status: **implemented contract.** Read `AGENTS.md`,
`DUMKA_EVOLVE_PLAN.md` (directives, M3.85 aggregate curve),
`DUMKA_PERCEPTUAL_DISTANCE.md` (v1 model, immutable),
`DUMKA_TREE_DEPTH.md` (working lattice, complexity corridor, §4a–4f), and
`DUMKA_SPAN_TIES_AND_DENSITY.md` (density corridor, trace honesty) first.
Every contract there stays in force: one seam, pure fold, identity-seeded
draws, integer/fixed-point decision paths, byte-identical replay,
corridors > plan > leash, loud mock, traced clamps.

## 0. The product statement and the one load-bearing reframe

The user's ask: *"draw automation curves for each property for the
composition as a whole, where the automation curve shows the actual
perceptual change over time for that property."* Each property gets a
DAW-style lane over the cycle axis: you draw the intent; the lane also
plots what actually happened; drawn-vs-realized divergence is visible per
property, per cycle. This replaces the Composition / Step size /
Complexity bar rows, whose meaning was only reachable by hover.

**The reframe (normative):** you author **levels**, and you pace with the
one existing aggregate step-size curve. You do not author per-property
*deltas*. Reasons, argued once here and binding everywhere:

1. The v1 perceptual components are pairwise (cycle N vs N−1). A drawn
   "attack-edit delta per cycle" curve is musically incoherent — nobody
   composes "the rate of change of my syncopation's difference."
   Composers shape *how syncopated / how dense / how deep* the music is
   over time (levels), and *how fast it is allowed to move* (one pacing
   rate). That is exactly levels + pacing.
2. Two level rails already exist and are proven (density corridor,
   complexity corridor). A property curve is a **time-varying corridor**:
   a drawn center line with a tolerance band instead of a static
   floor/ceiling. The clamp / normalize / trace machinery generalizes
   directly; nothing new has to be invented for enforcement.
3. Per-property delta targets are a genuinely intractable multi-objective
   distance-matching problem with unsatisfiable regions. Level tracking
   under a pacing budget is a monotone steering problem with honest,
   traceable misses.

"Shows the actual perceptual change" is still delivered literally: every
lane overlays the **realized trajectory** of its property, and the Step
size (pacing) lane gains the v1 **component breakdown** in its inspector,
so per-component change per cycle is inspectable where change actually
lives.

## 1. The properties (per-state functionals, all integer-exact)

A lane requires a *state functional* `P_i(x) ∈ 0..=100_000` — an absolute
measurement of one cycle's realized state on the working lattice `W`,
order-free, pure, pinned. Six ship in v1:

| Lane | Functional | Source of truth |
|---|---|---|
| **Density** | `100000 × onsets / N` (N = B·W slots) | exists (density corridor math) |
| **Complexity** | mean attack-point indigestibility `C(x)` (TREE_DEPTH §4a) | exists (`depth.rs`) |
| **Syncopation** | normalized magnitude of the v1 per-state `syncopation_signature` (perceptual.rs:655) — the SAME signature the immutable model diffs; we sum its weights per state and normalize by the grid's maximum signature weight. No new theory; v1 internals re-exposed per state. | exists, needs a public per-state wrapper |
| **Evenness** | `100000 × (1 − E₁(x)/E₁max)` from the fixed-point spectrum's fundamental energy (`|F(1)|²` deficit; Milne balance / Demaine evenness, already pinned in `spectrum.rs`) | exists, needs normalization wrapper |
| **Occupancy** | `100000 × covered_slots / N` (sounding sustain coverage; rests = uncovered) | trivial new |
| **Depth diversity** | `D(x)` (TREE_DEPTH §4f) | exists (`depth.rs`) |

Excluded from lanes, deliberately: attack-edit, timing displacement,
metrical phase, stroke class — pairwise or register-like quantities.
They remain visible as the pacing lane's component breakdown (§6) and,
for rotation, as the Rotate directive family. The doc saying "no" here is
what keeps the lanes meaningful.

Each functional: Rust implementation with pinned hand-computed vectors
(including palette-refined grids), exposed to the TS mirror **only**
through the Rust-emitted metrics contract fixture (the established
scheme; no independent trig/log/entropy in TS), and carried per cycle in
the preview DTO as `propertyProfile { densityMilli, complexityMilli,
syncopationMilli, evennessMilli, occupancyMilli, diversityMilli }`
(complexity/diversity already travel; the others join them).

## 2. Schema (config, not automation lanes)

Same architectural position as the plan and the aggregate curve: config
on `DumkaGeneratorParams`, resolved through the one seam, persisted in
patch v1, pinned in DTO fixtures both directions.

```rust
#[derive(Serialize, Deserialize, ...)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PropertyCurve {
    pub property: CurveProperty,   // Density|Complexity|Syncopation|Evenness|Occupancy|Diversity
    pub enabled: bool,
    /// Half-width of the acceptance band around the drawn line.
    pub tolerance_milli: u32,      // 0..=100_000
    /// Steering weight in the error vector (§4). 1..=100, default 50.
    pub weight: u32,
    /// ≤ 64 points, (cycle ≥ 1, target 0..=100_000), sorted, deduped.
    pub points: Vec<CurvePoint>,
}
// DumkaGeneratorParams:
//   #[serde(default)] pub property_curves: Vec<PropertyCurve>,  // ≤ 1 per property
```

Interpolation between points: identical integer round-half-away-from-zero
rule as the aggregate curve (`plan.rs` `curve_target_milli_at` —
generalize, do not duplicate). Outside the point span the curve is
**absent** (no band, no steering) — NOT zero: a level of "absent" and a
level of 0 are different things, unlike the pacing curve where 0 = repeat.
This asymmetry is deliberate and must be pinned.

Validation (pinned messages, engine + mirror + mock byte-identical):
one curve per property; points ≤ 64; cycles ≥ 1; targets/tolerance ≤
100_000; weight 1..=100; and the **static intersection check** — at every
cycle where a property curve band and the matching global corridor (or a
directive's corridor override) are both active, their intersection must
be non-empty: `dumka propertyCurve {property} conflicts with the
{rail} at cycle {c}`. Cross-property conflicts are NOT statically
checkable (state-dependent) and are handled at runtime by traced misses
(§5), never silence.

Empty `property_curves` ⇒ byte-identical legacy behavior (the compat pin,
swept against every pinned trajectory and golden).

## 3. Effective band algebra (rails compose by intersection)

At cycle `c`, for property `i`, the **effective band** is:

```
band_i(c) = corridor_i ∩ directiveOverride_i(c) ∩ curveBand_i(c)
```

where each absent term is the full `[0, 100000]`. The existing global
corridors and per-directive overrides are unchanged — a static corridor
is now just the constant special case. `candidate_failure` evaluates the
effective band exactly where it evaluates the two corridors today; no
family gets a private variant. Precedence language updates from
"density > complexity" to "**effective bands** (density, then
complexity, then the other four in the fixed lane order) > plan > leash";
projection stays supreme.

Normalization (rail moved under an inherited state) generalizes the two
existing normalizers: density first (changes k), then complexity
(Promote/Demote flows), then the remaining properties **by clamped
operator steps only** — syncopation/evenness/occupancy/diversity have no
dedicated micro-operators in v1 and are *steered* (§4), not normalized;
a violated band that steering cannot reach is a traced miss. This keeps
the termination story exactly as proven in TREE_DEPTH §4b and avoids
inventing four new flows with unproven convergence.

## 4. The steering search (what replaces "weights decide what kind")

On a cycle owned by directives: unchanged — directives override curves.
On a directive-free cycle where any curve is active (property or
pacing):

```
targets  = interpolated property bands + pacing target T ± tol (aggregate)
error(x) = Σ_i weight_i × gap_i(x)        // gap = integer distance to band_i, 0 inside
```

Prefix loop (deterministic, budgeted, ≤ maxOperations steps):

1. If `error(x) == 0` and pacing satisfied (realized aggregate distance
   within T ± tol, when the pacing curve is active): stop — smallest
   sufficient prefix, same minimality rule as M3.85.
2. Enumerate one **best candidate per eligible family** (the family's
   existing ranked order, scope/options applied; ≤ 9 evaluations per
   step). Score each candidate by `error(candidate)`; a candidate that
   violates any effective band or guard is inadmissible (shared
   predicate).
3. Apply the candidate with the greatest error reduction; ties break by
   the fixed family band order, then the identity-seeded salt
   `SALT_STEER = 0xD0A1_5EED_0012_0012` (per-ordinal, same discipline as
   every stream).
4. Stop when: no admissible candidate reduces `error` (frontier stall →
   per-property `curveMiss { property, gapMilli }` trace entries), or the
   pacing rail would be exceeded (aggregate distance of the prefix past
   `T + tol` → stop at the last within-pace prefix — **pacing wins over
   level targets**; a level the pace cannot reach this cycle is reached
   over later cycles, which is the entire musical point), or budgets run
   out.
```

The family-weights draw is not consulted on steered cycles — the error
vector says *what kind*, the pacing curve says *how much*, the drawn
levels say *where to go*. Weights keep governing: legacy stochastic
cycles, `Stochastic` directives, and steered ties only via band order
(documented). This is the semantic upgrade the whole feature buys:
operator choice with a stated reason, per cycle, in the trace
(`chosenFor: property` on each applied entry).

**Budget accounting.** Steering costs per step: ≤ 8 family-candidate
evaluations × 6 functionals (each O(k) or O(k·M)) plus P0 and candidate v1
distance scores when
pacing is active. The 4,096 lifetime budget keeps its exact current
meaning (v1 distance evaluations). Property-functional work gets its own
lifetime budget `PROPERTY_EVAL_BUDGET = 32_768` with the same
validation-time accounting shape and pinned over-budget message, and the
same preserved-but-disabled import rule — closing the M3.85 import hole
(audit defect: `patchIo` budget loop omits curve work) is a Phase-0 item
here, and the new accounting lands on the fixed version. Bench extends
`dumka-depth-fold-cycle-10000` with a 6-curve steering variant; report
numbers, no CI threshold.

## 5. Honesty rules (misses are data, never silence)

- Every steered cycle emits its realized `propertyProfile` plus zero or
  more `curveMiss` entries. A missed band renders as the realized line
  outside the shaded band in the lane — red segment, tooltip carries
  `gapMilli` and the stall reason (no-reducing-candidate | pacing-capped
  | budget-capped | projection | rail-blocked). A rail-blocked miss also names
  `globalCorridor`, `automation`, or `discreteGrid`.
- Conflicting drawn curves (density up, complexity down, nothing
  admissible) therefore *look* like exactly what they are: two lanes
  whose realized lines can't both stay in their bands, with the trace
  saying which property lost each cycle and why.
- No catch-up bursts: a missed level is re-approached under the same
  pacing rail next cycle (the accumulator machinery is not reused here —
  levels are absolute, so "catch up" is just "keep steering").

## 6. UI (the Evolve editor consolidation)

- The Composition / Step size / Complexity rows are **retired**. In
  their place: one `PropertyCurveLane` stack — Pacing (the existing
  aggregate curve, same semantics), then Density, Complexity,
  Syncopation, Evenness, Occupancy, Diversity. Collapsible; lanes with
  drawn points or non-default rails pin open, untouched lanes collapse
  to a sparkline row.
- Every lane, one visual grammar: drawn polyline (editable: click places
  a point, shift-click removes, drag moves — generalizing the already-
  built M3.85 step-lane editor into a shared component), tolerance band
  shading, realized line overlay, red segments outside band, y-axis
  labels at 0/50/100 and on band edges (the legibility fix the bar rows
  never had). Trace ticks move to a single Events gutter row under the
  lane stack (green applied / hollow skipped, unchanged tooltips).
- The pacing lane's inspector adds the v1 **component breakdown** for
  the selected cycle (8 bars, from `PerceptualBreakdown` threaded
  through the preview DTO) — "actual perceptual change per component"
  lives here, where change is real.
- Corridor controls in the Generator editor remain (global static
  rails); each lane shows its effective band, and a lane inspector
  cross-links to whichever rail is binding. NumericField discipline,
  aria labels per lane/cycle, keyboard editing parity with the existing
  lane — all per the audited conventions, including the pointer-button
  and passive-wheel fixes from the M3.75 audit list.

## 7. Phasing (defect queue first, then read, then write)

- **Phase 0 — prerequisites.** Land task #22 (subdivisionLevel
  semantics, dead Morph A* resolution, curve import budget, fmt/clippy)
  and the #17 audit batch. The lanes display exactly the functionals
  those defects corrupt; building the display on a broken engine wastes
  the calibration instrument. Full matrix + 2048 sweep green.
- **Phase 1 — realized lanes (read-only). LANDED.** Per-state functionals
  (`spectrum::state_evenness_milli`, `PerceptualContext::state_properties`) +
  pinned vectors + metrics-contract `propertyProfiles` fixture rows;
  `propertyProfile` through the resolution/preview DTO, the four preview
  fixtures, the `bridge.ts` type, the `dumkaMetrics.ts` TS mirror
  (`stateProperties`, byte-exact vs the fixture), and the mock (`mockTauri`,
  with a fail-closed self-consistency guard); the lane-stack UI in
  `EvolvePlanEditor` replacing the three rows — Pacing (the existing curve
  editor, unchanged) plus six read-only property lanes and an Events gutter.
  Zero engine-behavior change (display plumbing only). Deferred to Phase 2:
  the pacing inspector's v1 component breakdown, which needs
  `PerceptualBreakdown` threaded through the preview DTO (not yet wired).
- **Phase 2 — drawable curves + steering.** Schema, validation,
  intersection algebra, steering search, budgets, goldens
  (`dumka_steered_build`: density+syncopation curves shaping 32 cycles),
  proptests (single-curve convergence-and-hold; conflicting-curves
  traced-miss liveness — never panic, never silent, never oscillating
  unboundedly: error is non-increasing per applied step by construction;
  byte-compat with curves absent; pacing-cap dominance).
- **Phase 3 — consolidation.** Corridors presented as constant curves in
  the UI, docs (EVOLUTION, EVOLVE_PLAN cross-reference, inventory rows,
  UI_AND_INTERACTION), calibration acceptance below.

## 8. Acceptance (user-audible)

1. Draw Density rising 20→80 over cycles 1–32 with pacing 3.0 ± 1.0:
   the piece thickens smoothly; the Density lane's realized line climbs
   inside its band; Step size stays inside the pacing band every cycle.
2. Add a conflicting Complexity ceiling-hugging curve at 0 with palette
   {3} and a Syncopation curve rising to 70: the engine steers
   syncopation up using on-seed-lattice displacement only; any cycle it
   cannot, the Syncopation lane shows a red segment whose tooltip names
   the binding rail — no silence, no burst.
3. Delete every drawn curve: byte-identical legacy replay (pin).
4. The pacing lane inspector shows the per-component change bars for any
   selected cycle, matching the immutable v1 breakdown to the milli.
