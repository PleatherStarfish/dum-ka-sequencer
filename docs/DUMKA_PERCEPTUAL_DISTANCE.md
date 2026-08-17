# Dum-Ka perceptual distance and calibrated pacing

Status: **implemented, model `v1`.** Dum-Ka can pace an authored deterministic
evolution directive by the realized rhythmic difference it produces, rather
than by a percentage of available operator candidates. The comparison and
planner are pure, fixed-point Rust code used by the same generator fold for
stopped preview and playback.

This is a bounded **perceptual dissimilarity score**, not a proven metric. It is
symmetric, deterministic, and zero for identity, but it does not claim the
triangle inequality or a psychophysically linear unit scale. The `v1` feature
weights are explicit engineering priors informed by rhythm-perception
literature; they have not yet been fitted to listener judgments.

## Representation and scale

The comparison runs on the fold's `EvolutionState`, before structural spans
split sustained notes into transport tie handshakes. This is important: a
notational split of one held note leaves sounding occupancy unchanged, while
its new attack can still make a small nonzero contribution. It also prevents
span layout from masquerading as musical change.

For a fixed cycle of `B` beats and working Subdivision `W`, let `N = B × W`
be the circular slot count and `M = 100_000`. With an empty depth palette,
`W` is exactly the seed's required Subdivision; palette refinement therefore
adds positions without changing model `v1`'s weights. The state's whole-beat rotation
register is applied before scoring. Each onset then contributes:

- an attack at its rotated start slot;
- circular sounding occupancy for its duration, capped at `N` slots;
- a stroke class at its attack slot; and
- onset phase, duration, and cyclic inter-onset interval ratios relative to
  `W`.

Every public component is an integer in `0..=M`. The editor divides by 1,000,
so `5_000` is displayed as `5.0` on a `0.0–100.0` scale. Internally the helper

```text
R(x, y) = 0                                      when y = 0
          min(M, floor((M*x + floor(y/2)) / y)) otherwise
```

normalizes and rounds a non-negative ratio without floating point.

The metrical context uses the fold's exact Barlow indispensability ranks and
Sioros metrical levels. For slot `i`, each vector is independently normalized
to `0..=1000`; higher Barlow rank and lower metrical level both mean stronger.
The salience used below is

```text
w_i = 1 + 3 * normalized_rank_i
        + 2 * normalized(max_level - level_i)
```

The `+1` keeps the weakest slot audible to metrical edit cost.

## The whole-cycle readout

The per-directive trace reports each row's incremental distance, which is
deliberately **not** the whole-cycle answer when several rows stack. For
calibration the resolver also scores the requested cycle's final state
against the state the fold carried out of the previous cycle and returns
it as `cycleDistance { modelVersion, distanceMilli }` on the preview DTO
(absent at cycle 0, for non-Dum-Ka generators, for disabled resolution,
and on grids without published Barlow tables; a verbatim repeat scores an
honest 0). The Evolve editor's **Pacing lane** plots this value per
cycle, overlays every enabled perceptual row's target ± tolerance as a
band (stacked rows sum), and colors the realized bar by verdict. The
readout is preview/authoring observability only — playback consumes the
same resolved spans and never reads it. A cross-fold test pins the
captured value against an independent two-fold comparison.

## Model `v1`: seven components

Let `A` and `A'` be attack bitsets, `O` and `O'` occupancy bitsets, and `|A|`
the number of attack slots. All slot distance is circular.

| Component | Weight | Exact `v1` construction |
|---|---:|---|
| Attack edit | 180 | `R(Hamming(A, A'), N)`. One insertion, deletion, or displaced attack is visible directly. |
| Occupancy | 150 | `R(Hamming(O, O'), N)`. A split sustain is therefore occupancy-identical, while filling a rest changes sounding time. |
| Timing transport | 150 | Symmetric nearest-neighbor displacement: sum the distance from every attack in each pattern to its nearest attack in the other, then divide with `R` by `floor(N/2) × (|A| + |A'|)`. An empty counterpart gives every attack the maximum circular distance. |
| Meter/phase | 240 | A clarity-controlled interpolation between the cheapest circular attack registration and the salience-weighted edit at the authored phase; defined below. |
| Syncopation | 120 | For every attack, scan forward until the next attack. If an intervening first stronger metrical slot exists, add `(source_level - target_level) × target_salience` at that slot. Let `D` be signature L1 difference; the component is `R(D, (|A|+|A'|) × max_level × max_salience)`. |
| Ratio complexity | 100 | Build a histogram of reduced denominators for onset phase within the beat, duration, and every cyclic inter-attack interval. Each denominator receives `1 + Σ prime_cost(p)` per prime factor with multiplicity, where costs are `2→1`, `3→3`, `5→5`, and other primes `min(p,17)`. Compare histograms by `R(L1 difference, sum of per-bin maxima)`. |
| Density/class | 60 | Density is `R(abs(|A|-|A'|), N)`. Inventory is `R(class-count L1 difference, 2N)`; positional is `R(number of slots attacked in both patterns with different classes, N)`. First combine class as nearest-rounded `(3×positional + inventory)/4`, then combine nearest-rounded `(3×density + class)/4`. |

The timing term is a symmetric nearest-neighbor cost, not an optimal one-to-one
earth mover assignment. The ratio term describes the inventory of rhythmic
denominators; it is not a full reconstruction of the proportional tree.

### Rotation and phase ambiguity

The meter/phase component makes a whole-cycle shift expensive when the pattern
has a clear metric anchor, but cheaper when several registrations are nearly
equally plausible.

For every circular shift of `A'`, compute its overlap with `A`. Let `o1` and
`o2` be the best and second-best overlaps. The aligned edit is

```text
aligned = R(|A| + |A'| - 2*o1, N)
```

Equal-overlap shifts choose the smallest absolute signed shift, preferring the
non-positive shift on the remaining tie. The authored-phase edit is

```text
anchored = R(sum(w_i for every A_i != A'_i), sum(w_i))
```

When attack counts differ, clarity is `M`, so a local add/remove does not look
like evidence for phase equivalence. With equal nonzero counts,

```text
clarity = R(o1 - o2, |A|)
meter_phase = aligned
              + round((anchored - aligned) * clarity / M)
```

with signed, saturating integer arithmetic. Empty/degenerate phase evidence has
zero clarity. Thus a periodic rhythm with several equally good alignments stays
near `aligned`, while a uniquely registered rhythm moves toward `anchored`.
The breakdown returned by the Rust API includes `anchored`, `aligned`, the best
signed slot shift, and clarity for auditing; only the composite trace is sent to
the editor today.

### Composite

The total is the nearest-rounded weighted mean of the seven components:

```text
total = round((180 attack + 150 occupancy + 150 timing
               + 240 meter_phase + 120 syncopation
               + 100 ratio_complexity + 60 density_class) / 1000)
```

It is capped at `M`. Any nonzero weighted result that would round to zero is
reported as `1`, preserving identity as the only exact zero.

## Perceptually paced directive planner

Perceptual pacing is opt-in per deterministic directive. At each active cycle:

1. Apply density normalization and then mean-complexity normalization. The
   normalized hold is
   legal prefix `P0`; it may already differ from the directive's incoming
   state when a rail moved.
2. Starting from `P0`, apply the normal identity-seeded family operation one
   step at a time, up to `maxOperations`. Each `Pk` must survive the existing
   scope, interval, density/complexity-corridor, and trial-projection guards. A failed
   frontier ends the reachable prefix. Initial candidate count is deliberately
   not a cap: a legal operation in a repeatable family can create the next
   candidate.
3. Score every reachable prefix against the directive's incoming state with
   the pinned model version, including `P0`.
4. Choose the prefix minimizing `abs(actualMilli - targetMilli)`. Equal errors
   choose the smaller prefix, so the deterministic bias is toward less change.
   Stop before the next operation on an exact target; tolerance alone does not
   stop the search for a closer prefix.

The target **replaces intensity**; it does not filter candidates inside an
intensity quota. `maxOperations` is a computation/search cap, not a requested
musical operation count. The planner searches one deterministic family path,
not every possible rhythm or operator ordering, so a coarse family may only
offer a nearest result outside tolerance.

To keep historical replay bounded, an enabled perceptual score may reserve at
most 4,096 distance evaluations across all of its authored ranges. One active
row-cycle reserves `maxOperations + 1`: every nonzero prefix plus `P0`. The
engine validates the saturating plan-wide sum before playback; the editor
mirrors the same budget while authoring. With the default `maxOperations = 16`,
one uninterrupted range can span at most 240 cycles (4,080 evaluations).

The trace keeps that distinction explicit:

- `requested` is the number of successfully examined nonzero prefixes
  (`0..=maxOperations`), not an initial-candidate estimate;
- `applied` is the selected prefix length and may be zero;
- `skipped` remains `none`, `orphanedScope`, `projection`, or `exhausted`, so a
  structural guard is not hidden by calibration;
- `perceptual.actualMilli`, `targetMilli`, `toleranceMilli`, and `modelVersion`
  record exactly which comparison was made;
- `reached` means `abs(actual-target) <= tolerance`; and
- `exhausted` means no admissible searched prefix reached that tolerance.

The depth rail and its diversity insight are intentionally not extra `v1`
components. `stateComplexityMilli` uses scaled Barlow indigestibility as a
candidate constraint; `stateDepthDiversityMilli` uses normalized denominator
entropy as an insight-only spread statistic. Ratio complexity remains the
immutable `v1` comparison feature. This separation lets a refined onset cost
perceptual distance while preventing either new readout from silently changing
saved `v1` target semantics.

An orphaned scope returns a zero transition and truthful reach/exhaustion
flags. A corridor-normalized `P0` can be selected. When multiple directives
are active on one cycle, each targets the change from the state handed to that
directive after earlier ordered directives; the non-linear distance of the
combined whole-cycle result is not bounded by any one row's target.

## Wire, persistence, and editor contract

The additive directive field is:

```json
{
  "magnitude": {
    "mode": "perceptual",
    "modelVersion": "v1",
    "targetMilli": 5000,
    "toleranceMilli": 500,
    "maxOperations": 16
  }
}
```

- Missing `magnitude`, or explicit `{ "mode": "operationQuota" }`, means the
  historical intensity/quota behavior. Canonical serialization omits that
  default, preserving old patch/request bytes.
- A perceptual row must pin `modelVersion: "v1"`.
- `targetMilli` and `toleranceMilli` are each `0..=100_000`;
  `maxOperations` is `1..=256`.
- Perceptual magnitude requires `pacing: "perCycle"`. Linear and Ease-in/out
  distribute an operation quota and therefore cannot be combined with it.
- The Stochastic family rejects perceptual magnitude because its intensity is
  a probability gate, not a deterministic operator trajectory.
- The model requires a Barlow-supported beat/Subdivision grid. Any enabled
  perceptual row on an unsupported grid fails authoring validation immediately,
  including a future row, instead of silently entering the unsupported-grid
  seed/corridor fallback later. Disabled rows do not activate that rejection.

The Evolve inspector calls this choice **Step size**. Perceptual target exposes
Target magnitude, Tolerance, and Max operations on the `0.0–100.0` display
scale, hides quota-transition controls, and reports Realized versus Target from
the backend trace. The current authoring defaults are target `5.0`, tolerance
`0.5`, and 16 operations; they are starting points, not perceptual thresholds.

## Calibration protocol

Changing `v1` weights in place would reinterpret saved scores and break
deterministic replay. Calibration therefore produces a new immutable model
version and explicit migration/audition decision; it never silently retunes
`v1`.

A suitable listener-study workflow is:

1. Sample legal adjacent states from every operator family across several
   Subdivisions, meters, onset densities, stroke-class inventories, scopes, and
   clear versus ambiguous phase structures. Include controlled anchors such as
   a split sustain, one weak/strong rest fill, one weak/strong displacement,
   symmetric/asymmetric rotations, syncopation changes, and simple/prime-ratio
   tuplets.
2. Render matched MIDI/audio with tempo, timbre, loudness, and listening order
   controlled. Stratify or model musical training and rhythmic culture rather
   than treating one participant pool as universal.
3. Collect suprathreshold difference judgments with held-out repeated trials.
   Maximum-likelihood difference scaling (MLDS) provides a principled way to
   infer a latent difference scale and observer noise from comparative
   judgments.
4. Fit non-negative component weights and, if the data require them, monotone
   component transfer functions. Evaluate held-out rank correlation,
   test/retest reliability, family/grid residuals, and whether the scale is
   stable across source patterns. Keep identity, symmetry, bounds, fixed-point
   arithmetic, and runtime limits as hard constraints.
5. Map practical target presets and tolerances to measured just-noticeable or
   musically useful bands only after those estimates exist. Until then, inspect
   distributions of trace `actualMilli-targetMilli` by family and grid; do not
   label a numeric range "subtle" or "dramatic" as an empirical fact.

## Literature basis and limits

These sources motivate the feature set and calibration method; none publishes
the `v1` weights or validates this exact composite.

- Post and Toussaint, “The Edit Distance as a Measure of Perceived Rhythmic
  Similarity” (2011), motivates explicit onset insertion/deletion sensitivity
  and comparison against listener judgments
  ([DOI](https://doi.org/10.18061/1811/52811)).
- Mongeau and Sankoff, “Comparison of Musical Sequences” (1990), treats
  fragmentation and consolidation as musically meaningful sequence operations,
  motivating a held-note split that is cheaper than unrelated edits
  ([DOI](https://doi.org/10.1007/BF00117340)).
- Palmer and Krumhansl, “Mental Representations for Musical Meter” (1990),
  provides perceptual evidence for hierarchical metrical strength
  ([DOI](https://doi.org/10.1037/0096-1523.16.4.728)).
- Fitch and Rosenfeld, “Perception and Production of Syncopated Rhythms”
  (2007), connects meter-relative syncopation with complexity and phase
  reinterpretation ([DOI](https://doi.org/10.1525/mp.2007.25.1.43)).
- Jacoby and McDermott, “Integer Ratio Priors on Musical Rhythm Revealed
  Cross-culturally by Iterated Reproduction” (2017), motivates an explicit
  rational-grid feature while also warning against assuming one universal
  rhythmic prior ([DOI](https://doi.org/10.1016/j.cub.2016.12.031)).
- van der Weij, Pearce, and Honing, “A Probabilistic Model of Meter Perception:
  Simulating Enculturation” (2017), motivates treating metric interpretation as
  learned and context-dependent rather than an invariant physical property
  ([DOI](https://doi.org/10.3389/fpsyg.2017.00824)).
- Maloney and Yang, “Maximum Likelihood Difference Scaling” (2003), supplies a
  method for estimating suprathreshold perceptual differences and testing the
  difference-scale model from human judgments
  ([DOI](https://doi.org/10.1167/3.8.5)).

Important omissions remain: microtiming, tempo, velocity/accent realization,
pitch, timbre, phrase context, expectation over longer history, and individual
or cultural adaptation. The model compares states on one fixed compiled grid;
it is not a distance between different meters or cycle lengths. Correlated
components can count one musical cause more than once. The phase interpolation
and denominator costs are explainable heuristics, not fitted perceptual laws.

## Verification and performance

Core tests pin identity, symmetry, bounds, deterministic replay, the cheap
sustain split, weak-versus-strong fills and moves, clear-versus-ambiguous
rotation, ratio complexity, legal-prefix selection, zero-prefix holds,
smaller-prefix ties, DTO compatibility, and trace truth.

Focused release benchmarks:

```bash
scripts/bench.sh generator/dumka-perceptual-planner-cycle-1
scripts/bench.sh generator/dumka-perceptual-distance-dense-8192
```

One local release run reported medians of approximately **1.140 ms** for the
32-operation-cap, four-beat planner case and **1.114 ms** for the dense 8,192-slot
distance case. These machine-specific numbers are report-only; they are not CI
thresholds.
