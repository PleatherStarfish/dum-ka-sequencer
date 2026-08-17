# M3.97 Property Curves — defect audit

Status: **findings, not fixes.** Nothing in this document has been repaired. The
feature stack it audits is the uncommitted M3.97 working tree (43 changed files,
~4 150 insertions): Phase 1 (read-only property lanes) and Phase 2 units A–E
(schema, steering fold, golden, trace threading, drawable UI).

Read [DUMKA_PROPERTY_CURVES.md](DUMKA_PROPERTY_CURVES.md) first — it is the
normative contract, and most findings below are deviations from it.

## Method and confidence

Seven independent auditors read the real code across seven dimensions
(steering, byte-compat/replay, schema/persistence, trace honesty, UI, the
functionals and their TS mirror, and test coverage). Every finding was then
handed to a separate adversarial verifier whose default answer was *refuted*,
with instructions to look for the guard the finder missed. 53 findings were
examined; **49 survived verification, 4 were refuted**. Several were reproduced
against the built engine through the public seam — those are marked
**(measured)** and quote real observed values.

Findings that multiple dimensions discovered independently are noted; that
convergence is the strongest evidence in this document.

The verifiers also *corrected* claims. Where a finder overstated a trigger or
misattributed a mechanism, the corrected version is what appears below.

## Why the test suite is green

Every gate passes today: `cargo check --workspace --all-targets` clean,
17 golden ledgers, 10 invariants, full `cseq-rhythm` lib suite, TS typecheck,
886 vitest, 25 mock e2e, 18 real-backend e2e. **That is not evidence the feature
works.** §Tier 3 explains precisely why: the assertions that look like they
prove steering are satisfied by corridor normalization running *before* the
steering loop, the one steering proptest compares a call to itself, and no test
anywhere combines a pacing curve with a property curve — which is exactly the
configuration in which PC-3 and PC-4 destroy the output.

## Severity scale

| Level | Meaning |
|---|---|
| **critical** | Produces wrong audio, silently. Blocks release. |
| **high** | Wrong behavior in a plausible, reachable configuration. |
| **medium** | Real edge case, contract deviation, or robustness hole. |
| **low** | Latent inaccuracy, cosmetic, or currently unreachable. |

## Index

| ID | Sev | Area | Defect |
|---|---|---|---|
| [PC-1](#pc-1) | critical | steering | Density band milli→percent conversion inverts the corridor; can silence the pattern |
| [PC-2](#pc-2) | high | functionals | Evenness is silently `0` on every grid wider than 64 slots |
| [PC-3](#pc-3) | high | steering | A pacing target of `0` removes the pacing cap instead of enforcing a hold |
| [PC-4](#pc-4) | high | steering | Pacing is never a lower bound; one satisfied band freezes the composition |
| [PC-5](#pc-5) | medium | steering | Effective complexity band can invert (floor > ceiling) |
| [PC-6](#pc-6) | medium | trace | `frontier_failure` is never reset — stale stall attribution |
| [PC-7](#pc-7) | medium | trace | One per-cycle `stop_reason` is stamped on every missed property |
| [PC-8](#pc-8) | medium | trace | `step_saw_pacing_cap` fires for candidates that would not have helped |
| [PC-9](#pc-9) | medium | trace | No `MissReason` names a rail, so rail-blocked misses are mislabelled |
| [PC-10](#pc-10) | medium | ui | Directive-owned cycle: band painted red with no reason |
| [PC-11](#pc-11) | low | trace | Steered trace: no family, no `chosenFor`, `requested == applied` always |
| [PC-12](#pc-12) | low | trace | Effective corridors are never reported to the DTO |
| [PC-13](#pc-13) | high | tests | No test proves the steering search has any *effect* |
| [PC-14](#pc-14) | high | tests | No test combines a pacing curve with property curves |
| [PC-15](#pc-15) | medium | tests | Invariants strategy hardcodes empty `property_curves` |
| [PC-16](#pc-16) | medium | tests | No DTO fixture carries populated curves or any `curveMisses` |
| [PC-17](#pc-17) | medium | tests | Directive precedence and the orphaned-scope branch are untested |
| [PC-18](#pc-18) | low | tests | Metrics contract pins only ≤16-slot grids |
| [PC-19](#pc-19) | medium | validation | `PROPERTY_EVAL_BUDGET` has no TS mirror |
| [PC-20](#pc-20) | medium | persistence | Import silently deletes curve points |
| [PC-21](#pc-21) | medium | validation | Corridor edits do not re-validate existing curves |
| [PC-22](#pc-22) | medium | budget | v1 distance work under-reserved ~7× on steered cycles |
| [PC-23](#pc-23) | low | budget | `PROPERTY_EVAL_BUDGET` and `MAX_CURVE_SPAN_CYCLES` are off by one |
| [PC-24](#pc-24) | high | ui | Drag authors invisible points past the rendered timeline |
| [PC-25](#pc-25) | medium | ui | A rejected edit poisons the draft and kills the rest of the gesture |
| [PC-26](#pc-26) | medium | ui | No UI for `toleranceMilli`, `weight`, or `enabled` |
| [PC-27](#pc-27) | medium | ui | Property curves cannot be authored by keyboard at all |
| [PC-28](#pc-28) | medium | ui | CSS `order` desynchronizes focus order from visual order |
| [PC-29](#pc-29) | low | ui | The drawn line never passes through its own handles |
| [PC-30](#pc-30) | low | ui | `overflow: hidden` clips handles at 0 and 100 |

---

# Tier 1 — wrong musical output

<a id="pc-1"></a>
## PC-1 · critical · Density band milli→percent conversion inverts the corridor

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:3229-3237`
**Found independently by 4 of 7 auditors.**

### Mechanism

The drawn Density band is in milliunits. It is folded into the effective
corridor by rounding the floor **up** and the ceiling **down** to whole percent:

```rust
CurveProperty::Density => {
    let floor_percent = floor.div_ceil(1_000).min(100);
    let ceiling_percent = (ceiling / 1_000).min(100);
    effective_density = DensityCorridor::new(
        effective_density.floor_percent.max(floor_percent),
        effective_density.ceiling_percent.min(ceiling_percent),
        slots,
    );
}
```

Two distinct quantization losses follow:

1. **Inversion.** When `ceil(floor/1000) > floor(ceiling/1000)` — i.e. whenever
   the band is narrower than 1000 milli and lies strictly inside one percent —
   the pair inverts. `DensityCorridor::new` does not reject this; it swallows it
   at `evolve.rs:299` with `let floor_count = exact_floor.min(ceiling_count);`,
   collapsing the corridor onto the ceiling count.
2. **Silent narrowing.** Even when it does not invert, the runtime band is
   always narrower than what the user drew.

The collapse is not inert. `normalize_to_density_corridor` (`evolve.rs:729`)
deletes onsets while `len > ceiling_count`, and `candidate_failure`
(`evolve.rs:2159`) rejects every candidate above it. The state is pinned below
the drawn band for that cycle and every subsequent cycle with the same band.

### Reproduction (measured)

Grid 4 beats × subdivision 4 = 16 slots, seed 23, no other rails.

| Drawn curve | Expected | Actual |
|---|---|---|
| `target 43750, tol 0` (exactly 7/16, exactly reachable) | density 43750 | **37500** — an onset *deleted*; false `CurveMiss { Density, gap 6250, NoReducingCandidate }` |
| `target 43825, tol 75` → band [43750, 43900] | 7 onsets satisfies it | **37500**, permanent miss |
| `target 6250, tol 0` ("one onset in sixteen") | 1 onset | **sounding = 0 — the pattern goes silent** |
| `target 19500, tol 5000` (UI default tolerance) | band [14500, 24500] | effective rail [15000, 24000] — 500 milli tighter on each side, spurious misses |

The engine deletes notes to move **away** from the level the user drew, then
reports a miss it caused itself.

### Root cause

A spec deviation, not merely a rounding nit. §3 defines the effective band as a
milli-space intersection, `band_i(c) = corridor_i ∩ directiveOverride_i(c) ∩
curveBand_i(c)`. The percent round-trip is not that intersection. The Complexity
branch immediately below (`evolve.rs:3239-3242`) intersects in exact milli —
Density is the only lossy lane.

This is also a **validation hole**: `validate_property_curves` performs its
static intersection check entirely in milli (`plan.rs:507-512`), so a curve whose
band contains no multiple of 1000 passes validation and then produces an
inverted corridor at runtime. Validation and runtime do not agree.

### Reachability

The last row of the table is reachable with **UI defaults today** (every drawn
curve carries `DEFAULT_PROPERTY_CURVE_TOLERANCE = 5000`, and any target not on a
percent boundary loses up to 500 milli per side).

The inverting rows require `toleranceMilli ≤ ~499`, which the shipped UI cannot
author — but **both mirrors default `toleranceMilli` to 0 when the key is
absent** (`ui/src/dumkaEvolvePlan.ts:566-568`; `plan.rs:325-326` serde default),
so any hand-edited patch, foreign patch, or direct preview IPC payload lands in
the inverting regime for nearly every target.

### Fix

Stop converting through percent. Derive the counts directly in milli, matching
what Complexity already does:

```
floor_count   = ceil(floor_milli   × slots / 100_000)
ceiling_count = floor(ceiling_milli × slots / 100_000)
```

Then enforce the crossed-pair invariant explicitly rather than letting
`min()` swallow it, and make `validate_property_curves` reject (or the runtime
trace report) a band that admits no integer onset count on the working grid.

---

<a id="pc-2"></a>
## PC-2 · high · Evenness is silently `0` on every grid wider than 64 slots

**Location** `crates/cseq-rhythm/src/generators/dumka/perceptual.rs:236-247`
**Found independently by 2 auditors.**

### Mechanism

`state_properties` measures evenness over the **whole cycle**:

```rust
let slots = self.slots;            // total_beats * subdivision
evenness_milli: super::spectrum::state_evenness_milli(slots, attack_slots),
```

But the Q16 spectrum table domain is **per-beat**, capped at
`MAX_WORKING_SUBDIVISION = 64` (`spectrum.rs:98-101`):

```rust
pub fn cosine_table(period_slots: u32) -> Vec<HarmonicRow> {
    if period_slots == 0 || period_slots > MAX_WORKING_SUBDIVISION {
        return Vec::new();
    }
```

`state_evenness_milli` then takes the `let … else` escape at
`spectrum.rs:435-438` and returns **0 — no error, no flag, no trace**.

### Reproduction (measured)

Perfectly regular one-onset-per-beat pattern:

| Grid | Slots | Reported evenness |
|---|---|---|
| 8 beats × 8 | 64 | 100000 (correct — a perfect k-gon) |
| 8 beats × 9 | 72 | **0** |
| 8 beats × 16 | 128 | **0** |
| 16 beats × 8 | 128 | **0** |

The same music reports 100000 or 0 depending only on how the grid is spelled.

### Consequences

1. The read-only Evenness lane displays a **false constant 0** for most real
   grids (it reaches the UI through the preview DTO, `mod.rs:610`).
2. A drawn Evenness curve on such a grid is **permanently unsatisfiable**.
   Steering burns its budget every cycle chasing an unreachable target and
   emits a `CurveMiss` whose reason is unrelated to the true cause.

### Reachability

Not palette-specific and not exotic. `total_beats × required_subdivision > 64`
is common: `tree.rs` compiles seeds at required subdivision 15 and 20
(`tree.rs:393,420,429`), so a plain 4-beat seed at subdivision 20 (80 slots)
already trips it — no palette involved. Any two-prime palette on a 4-beat
pattern trips it easily (4 × 24 = 96 slots).

### Fix

Three options, in order of preference:

1. Measure evenness on a **reduced period** — the fundamental only needs the
   onset phases modulo the cycle, so the table could be indexed by a period that
   stays inside the supported domain, or generated on demand for the true period.
2. Extend the unit-root table domain to the real maximum
   (`MAX_TOTAL_BEATS × MAX_SUBDIVISION`), at a table-size cost.
3. At minimum, **fail loudly**: return `Option<u32>` and have the lane render
   "unavailable" rather than a fabricated 0, and have validation reject an
   Evenness curve on a grid where the functional cannot be computed.

Option 3 alone still leaves the lane useless on most grids, so it is a stopgap.

---

<a id="pc-3"></a>
## PC-3 · high · A pacing target of `0` removes the cap instead of enforcing a hold

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:3289-3296`
**Found independently by 5 of 7 auditors** — the widest convergence in the audit.

### Mechanism

```rust
let pacing_target = if inputs.curve.enabled {
    let target = inputs.curve.target_milli_at(cycle);
    (target > 0).then_some(target)
} else {
    None
};
let pacing_cap =
    pacing_target.map(|target| target.saturating_add(inputs.curve.tolerance_milli));
```

`EvolutionCurve::target_milli_at` (`plan.rs:143-172`) returns `0` in **three**
distinct situations: an authored point at 0, any cycle *before* the first point,
and any cycle *after* the last point. All three collapse to "no cap".

Everywhere else in the engine `target == 0` means **literal repetition** —
`plan.rs:93-94` pins it, and the non-steered branch the steering branch preempts
says so in its own comment (`evolve.rs:4359-4363`: "a zero target is
deterministic repetition"). Steering inverts the strictest possible instruction
into no limit at all, contradicting §4's "pacing wins over level targets".

### Reproduction (measured)

Pacing curve enabled, points `(1,0),(8,0)` (a drawn hold), plus one Syncopation
curve target 60000 ± 2000:

| Configuration | Whole-cycle distance |
|---|---|
| pacing hold alone, no property curve | 0 (frozen — correct) |
| pacing hold **+** syncopation curve | **46459** |
| pacing **off** + syncopation curve | 46459 (identical) |

The drawn hold has *zero* effect. Setting the pacing target to 200 instead of 0
correctly applies the cap. `trace.perceptual` is `None` throughout, so the
pacing lane cannot even show that it was overrun.

### Root cause

`EvolutionCurve::target_milli_at` cannot distinguish "outside the span"
(absent) from "drawn 0" (hold) — the very asymmetry the spec pins for *property*
curves at §2 (lines 102-105) but that the pacing accessor cannot express.

### Fix

Give the pacing accessor the same absent/zero distinction property curves
already have (return `Option<u32>`, or pair it with an in-span predicate).
Then in steering: absent ⇒ no cap; present-and-zero ⇒ cap of
`0 + tolerance`, i.e. a real hold.

---

<a id="pc-4"></a>
## PC-4 · high · Pacing is never a lower bound; one satisfied band freezes the piece

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:3298-3332`

### Mechanism

§4 step 1 is normative: stop when "`error(x) == 0` **and** pacing satisfied
(realized aggregate distance within T ± tol, when the pacing curve is active)".
The implementation drops the second conjunct. The pacing curve is wired *only*
as an upper bound (`pacing_cap`), never as a lower bound.

The deeper root cause, per verification: **the pacing target is not part of the
objective at all.** `error_of` (`evolve.rs:3298-3309`) sums only property-band
gaps. Removing the `if current_error == 0 { break; }` at `evolve.rs:3330` would
therefore fix nothing — the loop only accepts candidates with
`candidate_error < current_error`, so at zero error no candidate qualifies and
the stall arm breaks out on the first iteration anyway.

Because a steered cycle takes precedence over `inputs.curve.enabled`
(`evolve.rs:4234`, `4388`), `apply_evolution_curve` never runs on that cycle, so
nothing else enforces the pacing minimum either.

### Reproduction (measured)

Pacing curve enabled, target 3000 ± 500 over cycles 1–8:

| Configuration | Cycle-4 result |
|---|---|
| pacing curve alone | density 43750, complexity 21429, **distance 6048** (moving as authored) |
| \+ one Occupancy curve, tolerance 100000 (band `[0,100000]`, always satisfied) | byte-identical to the unevolved seed, **distance 0**, `requested 0, applied 0`, `curve_misses []` |

Enabling a single wide lane the user never intended as a constraint silently
turns off their entire authored pacing. No `CurveMiss` is emitted, because the
miss block at `evolve.rs:3436` is guarded by `if current_error > 0`.

Scope is broader than "trivially satisfied bands": because the break sits at the
top of the loop, *every* steered cycle stops the instant error hits zero,
however far the realized distance is from the pacing target.

### Fix

Make pacing a term in the objective rather than a filter. Either:

- extend `error_of` with a pacing gap (weighted, so levels and pace trade off
  explicitly), or
- after the property bands are satisfied, continue the search under the existing
  `apply_evolution_curve` minimality rule until the realized distance enters
  `T ± tol`.

Either way, emit a miss when the pacing band cannot be reached, so the freeze is
never silent.

---

<a id="pc-5"></a>
## PC-5 · medium · Effective complexity band can invert

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:3238-3243`

```rust
CurveProperty::Complexity => {
    effective_complexity = ComplexityCorridor {
        floor_milli: effective_complexity.floor_milli.max(floor),
        ceiling_milli: effective_complexity.ceiling_milli.min(ceiling),
    };
}
```

No `floor_milli = floor.min(ceiling)` re-establishment. **Every other
`ComplexityCorridor` construction site in the file applies that invariant** —
e.g. `sampled_complexity_corridor_with_presence` (`evolve.rs:453-457`).

Reachable because static validation only intersects the drawn band against the
**authored** corridor: a `complexityCeiling` automation lane can drop the
*sampled* ceiling below a drawn band's floor at some cycle. With floor 40000 /
ceiling 20000, the per-move acceptance guard (`evolve.rs:935-937`) requires
`candidate ≤ ceiling`, so the result is a **stall/deadlock**, not the overshoot
originally hypothesized — normalization can satisfy neither side, with no trace
of the inversion.

**Fix** Apply the same crossed-pair invariant as every sibling constructor, and
extend the static check to the automated corridor envelope, or report the
inversion as a distinct clamp.

---

# Tier 2 — the honesty instrument lies

The design's central promise (§5) is that misses are data, never silence. These
findings do not change audio; they make the calibration instrument untrustworthy,
which is nearly as damaging for a tool whose purpose is calibration.

<a id="pc-6"></a>
## PC-6 · medium · `frontier_failure` is never reset

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:3325`
**Found independently by 4 auditors.**

Declared once *outside* the step loop (`3325`, loop starts `3330`), assigned on
every `Err` from every family in every step (`3383-3385`), **never cleared**.
It is last-write-wins across both the inner family loop and the outer step loop,
yet it is consumed as "the failure at the stall" in three places: the
`MissReason::Projection` branch (`3402-3411`), and the `trace.skipped` /
`trace.corridor_clamp` / `trace.complexity_corridor_clamp` overrides
(`3417-3426`).

Two correctives from verification:

- **The dominant path is not the stall branch** but the post-loop block at
  `3418-3430`, which runs on *any* exit with `current_error > 0` — including the
  ordinary budget-exhaustion exit that is the default outcome at
  `max_operations = 4`.
- **Misattribution runs in both directions.** `Euclid` is evaluated last and
  commonly returns `Err(Exhausted)`, so a genuine `Projection` stall is just as
  likely to be *downgraded* as an innocuous stall is to be *upgraded*.

**Fix** Reset `frontier_failure` at the top of each step, and capture the
failure that actually characterizes the stalling step (or keep a per-step
summary) rather than the last error seen anywhere in the cycle.

<a id="pc-7"></a>
## PC-7 · medium · One per-cycle `stop_reason` is stamped on every missed property

**Location** `evolve.rs:3328` (default), `evolve.rs:3453` (application)

`stop_reason` is a single scalar describing why the **loop** stopped; it is
copied verbatim into every `CurveMiss` for the cycle. §5 asks the trace to say
which property lost *and why*; the implementation can only say why the search as
a whole terminated.

Example: a reachable Density curve alongside an unreachable Diversity curve. The
search spends all four steps improving density and exits by budget exhaustion,
so `stop_reason` stays at its `BudgetCapped` default. The Diversity tooltip
reads "budget spent", advising the user to raise `maxOperations` — which cannot
help, because that band is unreachable on this lattice at any budget.

Verification note: the harm is bounded — §4/§5 do define the four reasons as
loop-level stall causes, and per-property reachability is not computable within
budget. It never affects audio, only the tooltip.

**Fix** Either document `reason` as loop-level (and rename it accordingly), or
add a cheap per-property post-check: if no admissible single-operator candidate
moves property *i* toward its band at all, label that miss `NoReducingCandidate`
regardless of why the loop exited.

<a id="pc-8"></a>
## PC-8 · medium · `step_saw_pacing_cap` fires for candidates that would not have helped

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:3362-3373`

The cap check runs **before** the candidate's error is scored, and `continue`s:

```rust
if let Some(cap) = pacing_cap {
    let distance = perceptual_distance(state, &candidate, &context, &model).total_milli;
    if distance > cap {
        step_saw_pacing_cap = true;
        continue;                       // error never computed
    }
}
let candidate_error = error_of(&context.state_properties(&candidate));
```

So a candidate that over-paces **and would have increased the error** still sets
the flag, and on a stalling step that flag outranks every other reason —
including `Projection`. Because `Euclid` is a whole-window reshape it frequently
over-paces, so this fires often. The tooltip then tells the user to widen the
pacing band; doing so admits the candidate, which makes the property gap worse.

**Fix** Score the candidate first and only set the flag when a candidate that
*would have reduced error* was rejected by the cap.

<a id="pc-9"></a>
## PC-9 · medium · No `MissReason` names a rail

**Location** `crates/cseq-rhythm/src/generators/dumka/plan.rs:398-400`

The four variants are `NoReducingCandidate`, `PacingCapped`, `BudgetCapped`,
`Projection`. None says "the density/complexity corridor blocked it" — yet for
those two properties the corridor is exactly what structurally prevents reaching
the drawn level. The comment at `evolve.rs:3221-3226` claims a tighter corridor
"degrades to a clamp, which surfaces honestly in the trace"; it does not.

Verification refined the mechanism: the intersected corridor is never truly
*empty* (the ceiling wins the crossing tie in `DensityCorridor::new`), so the
search stalls against a pinned rail and reports whatever the loop terminated on.

**Fix** Add a `RailBlocked` variant carrying which rail bound (global corridor,
directive override, or automation) and emit it when the effective band is
tighter than the drawn band at that cycle.

<a id="pc-10"></a>
## PC-10 · medium · Directive-owned cycle: band painted red with no reason

**Location** `ui/src/components/EvolvePlanEditor.tsx` (miss lookup), engine at
`evolve.rs:4232` / `4388`

Steering — and therefore miss emission — runs only when `active.is_empty()` or
`all_orphaned`. On a cycle owned by a non-orphaned directive the curve is
correctly ignored (§4: "directives override curves"), so the engine emits no
miss. **The UI still computes the band client-side and paints the cell
outside-band**, with no reason suffix — visually identical to a genuine engine
failure.

Verification is explicit that **the engine is correct here and §5 is not
violated**; the defect is UI-side presentation.

**Fix** In the UI, when a cycle is directive-owned, render the drawn band as
*inactive* (e.g. dimmed, "overridden by directive") rather than as a miss.

<a id="pc-11"></a>
## PC-11 · low · Steered trace: no family, no `chosenFor`, `requested == applied`

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:3249-3259`, `3388-3397`

The single `DirectiveTraceEntry` a steered cycle emits hardcodes
`family: DirectiveFamily::Stochastic` no matter which of the eight families ran,
carries **no `chosenFor` field at all**, and increments `requested` only inside
the success arm, so `requested == applied` always.

§4 makes `chosenFor` the explicit payoff of the whole feature — "operator choice
with a stated reason, per cycle, in the trace". Measured: a cycle applying four
steering operations across different families emits
`{ family: Stochastic, requested: 4, applied: 4, skipped: Exhausted }`, so the
Events gutter shows four green ticks attributed to the family-weights layer that
§4 says is *not consulted* on steered cycles.

Note: a related claim — that the lockstep counter makes a skipped tick
impossible — was **refuted** as stated; the entry can still carry a `skipped`
value, as the measurement above shows.

**Fix** Record the winning family per applied step and add the `chosenFor`
property the spec requires; count rejected candidates in `requested`.

<a id="pc-12"></a>
## PC-12 · low · Effective corridors are never reported to the DTO

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:4216-4219`

`requested_density_corridor` / `requested_complexity_corridor` are initialized
from the global rails and only reassigned inside the *directive* loop
(`4352-4359`). The steering branch computes and enforces `effective_density` /
`effective_complexity` locally and never writes them back — even though
`evolve.rs:3809` documents the field as "the final requested cycle's **effective**
percent rail", and §6 promises each lane shows its effective band.

Measured: a Density curve that clamped the state at 43% via the effective
corridor still reports `density_corridor: { floor: 0, ceiling: 100 }`.

Currently **display-only and latent** — no shipped surface renders it in a way
that misleads, because the lane prefers the drawn band. It becomes user-visible
the moment the §6 "which rail is binding" cross-link is built.

**Fix** Write the effective corridors back from both steering call sites.

---

# Tier 3 — the tests do not prove the algorithm

This tier explains why Tier 1 survived a fully green suite. It is the most
important section of this document.

<a id="pc-13"></a>
## PC-13 · high · No test proves the steering search has any *effect*

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:4701` (unit test),
`6884`, `6949` (proptests)

Verification established the precise state of affairs — more nuanced than "the
loop never runs":

- The loop **does** execute and **does** apply operations (instrumentation shows
  1–4 applied iterations), and `golden_dumka_steered_build` **does** fail if the
  loop body is deleted.
- But **no assertion anywhere observes the search's effect.**
  `property_steering_resolves_and_replays_for_random_curves` compares a call to
  itself. The density unit test and both density proptests are satisfied by
  `normalize_to_active_corridors` — candidate zero, which runs *before* the
  loop. `conflicting_curves_trace_the_property_that_lost` asserts a miss
  *exists*, and deleting steering produces *more* misses, not fewer.
- The golden certifies only stability, not correctness: it was generated from
  the current (buggy) code.

So the search could be selecting the *worst* candidate each step and the suite
would stay green apart from a golden hash.

**Fix** Add a test that asserts a strict improvement: construct a state outside a
drawn band where normalization alone cannot reach it, and assert the realized
property moves monotonically toward the band across steps. Add a mutation check
in review: does the test fail if the candidate selection picks `max` instead of
`min` error?

<a id="pc-14"></a>
## PC-14 · high · No test combines a pacing curve with property curves

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:4476-4482`, `4532`, `4565`

Every property-curve test builds inputs through `inputs()` /
`inputs_with_automation()`, which hardcode `curve: &CURVE_OFF`, and
`dumka_steered_rhythm()` in the golden ends with `..Default::default()`
(evolution curve disabled).

Therefore `pacing_target` / `pacing_cap` (`3289-3296`), the per-candidate cap
rejection (`3366-3373`), the steered-cycle `PerceptualPacingTrace` emission
(`3432-3442`) and the **entire `MissReason::PacingCapped` variant** have zero
coverage.

This single gap is what allowed PC-3 and PC-4 — both of which destroy output —
to ship green. One test that sets `curve.enabled = true` alongside
`property_curves` would have caught both.

<a id="pc-15"></a>
## PC-15 · medium · Invariants strategy hardcodes empty `property_curves`

**Location** `crates/cseq-transport/tests/invariants.rs:267-268`

```rust
evolution_curve: rhythm::EvolutionCurve::default(),
property_curves: Vec::new(),
```

`generator_config_strategy()` is the sole generator source for all four
transport invariants, so determinism/replay and the disabled-is-identical fence
never execute the steering fold, and the new types are entirely unfuzzed.

Verification **refuted the seam half** of the original claim: preview and
playback both bottom out in `resolve_generator_cycle_with_trace`
(`generators/mod.rs:278-283`), so a seam divergence is not structurally possible
here. The **determinism/fuzz half stands and was understated** — steering is the
most stateful code in the fold and gets no property-based coverage at all.

**Fix** Generate `property_curves` in the strategy (a small arbitrary set,
including the empty case) so replay, byte-compat, and the serde fence all cover
steered configurations.

<a id="pc-16"></a>
## PC-16 · medium · No DTO fixture carries populated curves or any `curveMisses`

**Location** `ui/src/__fixtures__/dto/*`

`rg 'propertyCurves|curveMisses' ui/src/__fixtures__/` returns exactly three
hits, all `"propertyCurves": []`. **`curveMisses` appears in zero fixtures, zero
tests, and zero mocks.**

Demonstrated mutation, per verification: rename `toleranceMilli` in
`bridge.ts`'s `PropertyCurve`, or flip `MissReason` from camelCase to snake_case
so the wire emits `no_reducing_candidate` — **typecheck passes, all 886 vitest
pass, all Rust tests pass**, and the `deny_unknown_fields` fence never fires
because no fixture contains the field. The UI would silently stop rendering miss
reasons forever.

**Fix** Emit at least one fixture with a populated `propertyCurves` and one
preview carrying `curveMisses`, in both directions.

<a id="pc-17"></a>
## PC-17 · medium · Directive precedence and the orphaned-scope branch are untested

**Location** `crates/cseq-rhythm/src/generators/dumka/evolve.rs:4239` and `4391`

Every property-curve test passes `plan: &[]`, so neither the
directives-override-curves rule (§4) nor the second steering call site is
exercised.

Verification found the orphaned path is **not equivalent** to the empty-cycle
path — notably it **normalizes twice for one cycle** (once at `4333` against the
raw corridors, once inside `apply_property_steering` at `3262` against the
effective ones). That difference is unasserted and could itself be a defect.

<a id="pc-18"></a>
## PC-18 · low · Metrics contract pins only ≤16-slot grids

**Location** `crates/cseq-rhythm/src/generators/dumka/barlow.rs:319-328`

The eight `propertyProfiles` reference cases cover 6-, 8-, and 16-slot lattices
(the 52-slot `4×13` case emits `null`). §1 requires "pinned hand-computed vectors
(including palette-refined grids)"; none is palette-refined.

Consequence: **PC-2 is invisible to CI by construction** — the evenness collapse
only manifests above 64 slots, and fixing it would change zero fixture bytes.

---

# Tier 4 — validation and persistence

<a id="pc-19"></a>
## PC-19 · medium · `PROPERTY_EVAL_BUDGET` has no TS mirror

**Location** `ui/src/dumkaEvolvePlan.ts` (absent), `plan.rs:790-805` (the rule)

`rg "PROPERTY_EVAL_BUDGET|32_768" ui/src ui/tests` returns nothing. Neither the
editor commit path (`EvolvePlanEditor.tsx:579-593`) nor the importer
(`patchIo.ts:2090-2092`) enforces the steering work budget that
`DumkaGeneratorParams::validate()` enforces on **every preview and every
playback resolution**.

§4 explicitly requires "the same validation-time accounting shape and pinned
over-budget message, and the same preserved-but-disabled import rule" — the
treatment `budgetEvolutionCurve` already gives the pacing curve.

Repro: two curves over disjoint 300-cycle runs with pacing `maxOperations = 8`
⇒ 601 × 8 × 8 = 38 464 > 32 768. The editor accepts both draws, the patch saves
and reloads clean, and then every resolution fails — a project that will not play.

<a id="pc-20"></a>
## PC-20 · medium · Import silently deletes curve points

**Location** `ui/src/patchIo.ts:2090-2092`

```ts
const normalizedPropertyCurves = normalizePropertyCurves(
  candidate.propertyCurves
).curves;
```

The `.curves` projection throws away `droppedPoints` and `droppedCurves`, and
`evolutionPlanLoadWarnings` (`patchIo.ts:2019-2047`) never inspects
`propertyCurves` at all. Every *other* repair the importer makes emits a
user-visible warning; deleted automation data emits nothing. The user loads a
patch, sees a truncated line, and re-saving persists the truncation.

Reachable through **supported UI actions**, not just hand-edited patches:
neither `upsertPropertyCurvePoint` nor the freehand handlers enforce
`MAX_CURVE_POINTS` (64) or `MAX_CURVE_SPAN_CYCLES` (512), so a normal drag can
author a curve the importer will later silently truncate. Violates contract 6.

<a id="pc-21"></a>
## PC-21 · medium · Corridor edits do not re-validate existing curves

**Location** `ui/src/App.tsx:916-917`, checked only at `EvolvePlanEditor.tsx:579-593`

The static intersection check runs only when a *curve* is edited, never when the
*corridor* it is checked against changes. The corridor knobs are plain
`useState` setters wired straight through, so drawing a curve and then tightening
`densityFloor` produces a config the engine rejects.

Blast radius is larger than a preview failure: `validate()` runs inside
`resolve_generator_cycle_with_trace` (`generators/mod.rs:333`) and transport maps
the same error to `TransportError::Realize`
(`cseq-transport/src/generator.rs:823`) — **stopped preview and playback both
hard-fail on every cycle.** Patch load is equally unchecked.

<a id="pc-22"></a>
## PC-22 · medium · v1 distance work is under-reserved ~7× on steered cycles

**Location** `crates/cseq-rhythm/src/generators/dumka/plan.rs:713-746` vs `evolve.rs:3365-3373`

`validate_perceptual_scoring_work_through` charges `max_operations + 1` v1
distance evaluations per curve-covered cycle — correct for
`apply_evolution_curve`. But when pacing is active, `apply_property_steering`
calls `perceptual_distance` **once per candidate** (8 families) per step:
up to `8 × max_operations + 1`.

Measured: pacing `maxOperations = 8` over cycles 1–400 plus a density curve is
**accepted** (400 × 9 = 3 600 ≤ 4 096) but performs up to 400 × 65 = ~26 000
evaluations — 6–7× the documented lifetime cap.

Verification refinement: not unbounded — transitively capped by
`PROPERTY_EVAL_BUDGET` (~33 k). The defect is that the *expensive* evaluation is
governed only by the loose budget intended for the *cheap* functionals, and that
this diverges from §4, which pins steering at "+1 v1 distance when pacing is
active" per step.

<a id="pc-23"></a>
## PC-23 · low · Budget and span cap are off by one against each other

**Location** `crates/cseq-rhythm/src/generators/dumka/plan.rs:37-43`

A curve at the maximum legal span (`MAX_CURVE_SPAN_CYCLES = 512`, first=1
last=513) covers **513** inclusive cycles, so at `maxOperations = 8` it charges
513 × 8 × 8 = 32 832 > `PROPERTY_EVAL_BUDGET = 32 768` and is rejected — while
the constant's own doc comment asserts that a full-span curve "sits exactly at
this ceiling". Reconcile (budget 33 024, or span 511) or correct the comment.

---

# Tier 5 — UI and interaction

<a id="pc-24"></a>
## PC-24 · high · Drag authors invisible points past the rendered timeline

**Location** `ui/src/components/EvolvePlanEditor.tsx:292-299` (`cycleFromPointer`)

`cycleFromPointer` clamps only the **lower** bound. Under pointer capture a drag
continues delivering moves past the last rendered cell (the lane is
`min-width: 100%`, so empty grid extends to the right, and capture keeps
delivering even off-window). `extent` is computed from the directive plan and
**never grows to include property-curve points**.

Measured geometry: with `planLengthCycles = 16`, cells exist to x≈1030px but the
lane stretches to ~1400px; a drag to the right edge yields cycle 22. Points at
cycles 17–22 are committed, saved into the patch, and **steer the engine** —
while the lane draws nothing there.

Verification refinement: the state is recoverable (raising the "cycles" field
grows `extent` and reveals them), so this is *silent invisibility*, not data
loss. Unlike out-of-window **directives**, which get an explicit banner, curve
points get nothing.

**Fix** Clamp `moveCycle` to `extent` during a drag, and/or extend `extent` to
cover property-curve points and surface an out-of-window count the way
directives already do.

<a id="pc-25"></a>
## PC-25 · medium · A rejected edit poisons the draft and kills the rest of the gesture

**Location** `ui/src/components/EvolvePlanEditor.tsx:1653-1660`, `1604-1618`

```ts
const next = upsertPropertyCurvePoint(draw.draft, lane.property, moveCycle, …);
draw.draft = next;          // mutated BEFORE the commit is attempted
applyPropertyCurves(next);  // may reject and return without touching draw.draft
```

Once one point makes the draft invalid, every subsequent move rebuilds on the
poisoned draft and is also rejected: the line stops following the cursor for the
remainder of the drag. The `pointerdown` path has the same flaw, so a gesture can
be dead on arrival. `upsertPropertyCurvePoint` has no `MAX_CURVE_POINTS` cap, so
a long drag reliably triggers this at the 65th crossed cycle.

Verification refinement: **not silent** — `setPropertyCurveError` fires and
renders live in a `role="alert"` paragraph; but that banner sits on the far side
of the workbench from the lane being drawn.

**Fix** Only advance `draw.draft` on a successful commit; cap points at
`MAX_CURVE_POINTS` in the helper (dropping or coalescing rather than failing);
surface the error adjacent to the lane.

<a id="pc-26"></a>
## PC-26 · medium · No UI for `toleranceMilli`, `weight`, or `enabled`

**Location** `ui/src/dumkaEvolvePlan.ts:404` (`setPropertyCurveSettings`)

Exported and unit-tested, but **called from no component**. There is no
inspector, enable toggle, tolerance field, or weight field for property curves.
Every curve authored in the app is permanently pinned at `toleranceMilli 5000`
and `weight 50`.

Consequences: §4's per-property steering weight
(`error(x) = Σ_i weight_i × gap_i(x)`) is unreachable, so §8 acceptance case 2 —
which turns on relative weights deciding which property wins — cannot be
performed. A curve imported with `enabled: false` renders nothing and **cannot be
turned back on**.

Verification correction to the original claim: equal-error ties break on
**family** order (`evolve.rs:3376-3383`), not band order; `CurveProperty::ALL`
order governs only the corridor intersection and miss reporting order.

<a id="pc-27"></a>
## PC-27 · medium · Property curves cannot be authored by keyboard

**Location** `ui/src/components/EvolvePlanEditor.tsx:1553-1573`

The drawable cell is a non-focusable `<span role="group">` with pointer handlers
only — no `tabIndex`, no `onKeyDown`, and no alternative control. Worse, the
section-level `handleKeyDown` (`983-986`) **explicitly early-returns** for any
focused button that is not `.evolve-plan-directive`, so keys bubbling from a
point handle are deliberately inert.

A keyboard-only user can Tab to an existing handle and delete it, but can never
create or move a point. The authoring half of M3.97 is pointer-exclusive, in a
component whose directive pills already implement full arrow-key editing.

<a id="pc-28"></a>
## PC-28 · medium · CSS `order` desynchronizes focus order from visual order

**Location** `ui/src/styles.css:6356-6374` — *introduced by the Unit E layout fix*

```css
.evolve-plan-scroll { display: flex; flex-direction: column; align-items: flex-start; }
.evolve-plan-ruler { order: 0; }
.evolve-plan-step-lane, .evolve-plan-property-lane, .evolve-plan-events { order: 1; }
.evolve-plan-lane, .evolve-plan-empty { order: 2; }
```

DOM order is ruler → empty → directive families → pacing → property lanes →
events. Visual order is ruler → pacing → property lanes → events → directive
families. The two now disagree, so Tab reaches the directive add-pin buttons and
pills (visually at the *bottom*) **before** the property handles above them, and
assistive technology reads the stack in an order that does not match the screen.

This regression was introduced while fixing a genuine problem (the property lanes
were below the fold). The fix must preserve the visual order without divorcing it
from the DOM.

**Fix** Reorder the JSX so DOM order matches visual order, and drop the `order`
declarations.

<a id="pc-29"></a>
## PC-29 · low · The drawn line never passes through its own handles

**Location** `ui/src/components/EvolvePlanEditor.tsx:1702-1716`

Each cell's inline SVG spans the full cell (`inset: 0`) with
`viewBox="0 0 100 100" preserveAspectRatio="none"`, and draws

```
x1=0   y1 = prev level      →  x2=100  y2 = this level
```

so cycle *c*'s authored level lands at the cell's **right edge**. But the point
handle is `left: 50%` (cell-centered), as are the tolerance band, the realized
mark, and the ruler label.

With points at cycle 3 = 40.0 and cycle 4 = 70.0, cell 4's segment runs y=40 at
the left edge to y=70 at the right edge, while the handle sits at y=70 in the
horizontal center — where the line is at y=55. The accent handle visibly floats
off the line it represents, and the drawn line reads misaligned against the
realized mark by half a cell.

**Fix** Anchor segments center-to-center: draw from x=50 (previous level) to
x=150 across a two-cell-wide overflow-visible SVG, or render one polyline for the
whole lane instead of per-cell segments.

<a id="pc-30"></a>
## PC-30 · low · `overflow: hidden` clips handles at 0 and 100

**Location** `ui/src/styles.css:6452-6457`, `6530-6547`

`.evolve-plan-property-cell { overflow: hidden; }` with a 12 px handle carrying
`margin-bottom: -6px`, positioned by `bottom: <level>%`. At level 0 the lower
6 px is clipped; at level 100000 the upper 6 px is. The grab target halves to
12×6 px and the hover `scale(1.4)` growth is cut away — precisely on the points a
user most wants to correct after overshooting off the end of the lane. Freehand
drag reaches both extremes because the fraction is clamped to 0..1.

---

# Refuted findings

Recorded so they are not re-litigated. Each was claimed by a finder and
disproved by a verifier reading the code.

| Claim | Why refuted |
|---|---|
| The pacing cap is never applied to candidate zero (normalization), so a curve can force an unbounded step | Normalization is bounded by the corridors themselves; the claimed unbounded path does not exist |
| `validate_property_steering_work_through` lacks a defense-in-depth call at the resolve seam | It is reached via `DumkaGeneratorParams::validate()` on every resolution |
| Lockstep `requested`/`applied` means the Events gutter can never show a skipped tick | The entry still carries `skipped`; measured as `Exhausted`. (The lockstep itself is real — see [PC-11](#pc-11)) |
| Property lanes lack `touch-action: none`, so touch drawing is preempted by native panning | Pointer capture plus the existing handlers cover the touch path |

---

# Remediation plan

Ordered so that each step makes the next one verifiable.

**Stage 0 — restore the ability to detect defects** (do this first; it is why
Tier 1 shipped green)
1. [PC-14](#pc-14) Add a pacing-curve + property-curve test matrix.
2. [PC-13](#pc-13) Add a strict-improvement assertion on the steering search.
3. [PC-15](#pc-15) Generate `property_curves` in the invariants strategy.
4. [PC-16](#pc-16) Emit populated `propertyCurves` / `curveMisses` fixtures.

**Stage 1 — stop producing wrong output**
5. [PC-1](#pc-1) Intersect the density band in milli; reject/report empty bands.
6. [PC-3](#pc-3) Distinguish absent pacing from a drawn hold.
7. [PC-4](#pc-4) Make pacing part of the steering objective.
8. [PC-2](#pc-2) Fix the evenness period domain (or fail loudly).
9. [PC-5](#pc-5) Restore the crossed-pair invariant on the complexity band.

**Stage 2 — make the instrument honest**
10. [PC-6](#pc-6), [PC-8](#pc-8) Per-step failure tracking and cap attribution.
11. [PC-9](#pc-9) Add a rail-blocked miss reason.
12. [PC-11](#pc-11), [PC-12](#pc-12) Real family + `chosenFor`; effective corridor writeback.
13. [PC-7](#pc-7), [PC-10](#pc-10) Per-property reasons; directive-override rendering.

**Stage 3 — close validation and persistence holes**
14. [PC-19](#pc-19), [PC-21](#pc-21), [PC-20](#pc-20), [PC-22](#pc-22), [PC-23](#pc-23).

**Stage 4 — UI correctness and access**
15. [PC-24](#pc-24), [PC-25](#pc-25) Drag clamping and draft integrity.
16. [PC-26](#pc-26) The per-lane inspector (tolerance / weight / enable).
17. [PC-28](#pc-28) Restore DOM/visual order agreement.
18. [PC-27](#pc-27) Keyboard authoring.
19. [PC-29](#pc-29), [PC-30](#pc-30) Line geometry and handle clipping.

**Also outstanding, unrelated to this audit:** the M3.75–M3.9 audit batch
(rotation-wrap tie bug and siblings) remains open, and the e2e mock still does
not implement steering, so steered realized lines are real-backend-only.

---

# Appendix — one process note

The real-backend e2e harness binary (`target/debug/cseq-app`) goes stale
whenever `cargo fmt` or an edit touches `src-tauri/src/main.rs`, and the failure
presents as an unrelated health-check timeout. Rebuild before the real lane:

```
cargo build -p cseq-app --features e2e-harness
```
