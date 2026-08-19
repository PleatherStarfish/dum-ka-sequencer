# Dum-Ka evolution

Cycle N of a Dum-Ka track is a **pure fold** of identity-seeded operators
over cycles 1..=N, starting from the compiled seed pattern
(`crates/cseq-rhythm/src/generators/dumka/evolve.rs`). Cycle 0 is always
the seed verbatim. Authored `evolutionRate` 0 keeps every cycle the seed when
there is no enabled rate-automation source — the M1 behavior, config default,
and constant-time feature-off path. With an active lane, every historical
cycle is sampled independently; a later 0% value freezes the completed prefix
instead of erasing evolution produced by earlier nonzero values.

When `subdivisionPalette` is nonempty, the seed is lifted exactly onto a
working Subdivision `W = seedSubdivision × product(unique palette levels)`
before the fold. The palette admits up to two levels from 2/3/5/7 and `W` must
remain at most 64. Every operator, metrical context, perceptual comparison, and
projector then uses `W`; an empty palette is the byte-compatible legacy grid.
The exact depth, geometry, and Morph contracts are in
[DUMKA_TREE_DEPTH.md](DUMKA_TREE_DEPTH.md).

## Authored evolution score and gradual pacing (M3.75/M3.8)

`DumkaGeneratorParams.plan` replaces chance-driven pacing wherever an enabled
directive is active. A pin names one cycle; a range names inclusive cycles.
Directives are sorted by authored `order`, so different families may compose
at one cycle, while same-family overlaps are rejected. Each stable directive
ID salts its own `SALT_PLAN` stream; reorder and save therefore cannot retarget
its choices. An empty plan is the exact legacy fold and remains the
byte-compatibility anchor.

In operation-quota mode, intensity is quota, not probability. A pin requests
`ceil(intensity × candidates / 100)` operations (Rotate rounds its requested
beat displacement). Each range also authors a pacing policy:

- **Per cycle** is the compatibility default. It carries an integer remainder
  from `fromCycle` and applies the intensity to the candidate count it sees on
  every covered cycle, exactly as the original evolution score did.
- **Linear** and **Ease in/out** freeze one target quota at the range start and
  distribute that fixed amount across the range with integer-only cumulative
  progress. Linear advances uniformly; Ease in/out uses smoothstep so the
  first and last steps are gentler. The last cycle targets the exact full
  quota—there is no floating-point drift or late random catch-up.

`Stochastic` is the exception: its intensity remains the legacy fire rate for
that covered cycle and it accepts only Per cycle pacing. If no directive is
active, the legacy rate/weight layer runs unchanged. Missing `pacing` on an
older patch defaults to Per cycle, preserving its trajectory.

Each deterministic row also has an opt-in **Step size**. Missing `magnitude`
(or explicit `operationQuota`) is the exact intensity behavior above and
serializes in the historical omitted shape. `perceptual` instead pins model
`v1` and seeks a target fixed-point rhythm distance on every active cycle. The
planner scores the corridor-normalized zero-operation hold, then sequential
legal prefixes up to `maxOperations`, stopping at the first guard failure or
exact target. Initial candidate count does not cap repeatable families. It
chooses the nearest target and breaks equal errors toward the smaller prefix.
Its target replaces intensity and therefore
requires Per cycle pacing; Stochastic rejects it. Scope, density and complexity
corridors, and trial projection continue to govern the search. See
[DUMKA_PERCEPTUAL_DISTANCE.md](DUMKA_PERCEPTUAL_DISTANCE.md) for the exact seven
components, bounds, calibration status, and limitations.

Gradual pacing bounds how many **operator applications** are scheduled at one
cycle boundary; it is not a continuous audio crossfade. One Add/Remove usually
changes one onset and one Syncopate/Desyncopate moves one onset. A single
Rotate can move every onset in its window, Fragment can expose a complete
figure, Consolidate can merge a run, and Euclid can redistribute a whole
beat/cycle. Those families therefore remain capable of an audible structural
step even when their applications are paced gradually.

`Morph` is the directed exception to an undirected operator family: its target
is another exact Dum-Ka pattern with the same beat count whose requirement
divides `W`. Exact circular transport/edit alignment exposes one movement,
attribute edit, insertion, or deletion at a time. The existing quota schedules
those micro-steps, and perceptual magnitude searches only their legal prefix;
there is no audio crossfade or second renderer. Corridor, scope, tie, and trial-
projection guards remain absolute at every intermediate state.

Optional beat scope is converted to an exact slot interval on the working grid.
Candidates must remain inside it: figure/reshape intervals are contained,
Sioros source and landing both qualify, and scoped Rotate cyclically shifts only
the window. A pattern edit that makes a scope orphaned does not brick playback;
the directive skips and preview traces `orphanedScope`.

Authored directives are exempt from the drift leash because the change is
explicit, but never from the density corridor, interval disjointness, or trial
projection. Valid paired ties across adjacent spans are projectable; dangling
or cycle-wrapping ties remain forbidden. Preview returns per-cycle
`{requested, applied, skipped, corridorClamp?, complexityCorridorClamp?,
perceptual?}` trace entries for
the requested cycle (`none`, `orphanedScope`, `projection`, or `exhausted`). In
perceptual mode, `requested` is the number of successfully examined nonzero
prefixes, `applied` is the selected prefix (possibly zero), and the additive object reports model,
actual, target, tolerance, reached, and exhausted truth. A
gradual range reports a trace even on a scheduled hold (`0/0`), so the editor
can show its position without inventing cumulative work from a partial cache.
Transport does not carry trace and still realizes the same resolved spans. See
[DUMKA_EVOLVE_PLAN.md](DUMKA_EVOLVE_PLAN.md) for the schema and editor contract.

## The operators (M2)

Each cycle, with probability `evolutionRate`% (sampled at that historical
cycle's start through `generator.dumka.evolutionRate`), exactly one operator
fires:

| Operator | Default weight | What it does | Basis |
|---|---|---|---|
| BarlowRemove | 3 | Silences the least indispensable sounding onset | Barlow's "rhythmic dilution": density falls, metric feel survives (Barlow 1987; the survey's Stage-2 add/remove family) |
| BarlowAdd | 3 | Sounds the most indispensable silent pulse (including no covering sustain) as a one-slot hit | Barlow "filling"; ranks come from [barlow.rs](../crates/cseq-rhythm/src/generators/dumka/barlow.rs) |
| Rotate | 2 | Moves the whole pattern one beat earlier or later via a rotation register | Beat-class transposition T_k (Babbitt/Cohn phasing); ranks stay in the unrotated metric frame, where indispensability means something |
| Syncopate | 0 (opt-in) | Anticipates one onset backward from its strong pulse onto a silent preceding pulse `type` levels faster | Sioros, *Syncopation as Transformation*, PhD diss., U. Porto 2015, ch. 4 (CMMR 2013/LNCS chapter of the same title); [sioros.rs](../crates/cseq-rhythm/src/generators/dumka/sioros.rs) |
| Desyncopate | 0 (opt-in) | Resolves one felt syncopation forward: the qualifying preceding onset moves onto its silent stronger pulse | Same source; exact inverse of Syncopate via the `{pulse, type}` vector |
| Fragment | 0 (opt-in) | Splits one held note (or one silent run) into an `E(k,n)` figure over its own slots — a true equal tuplet when k divides n, the maximally even on-grid figure otherwise | Mongeau & Sankoff 1990 fragmentation; Bjorklund placement; [figures.rs](../crates/cseq-rhythm/src/generators/dumka/figures.rs) |
| Consolidate | 0 (opt-in) | Merges a contiguous sounding run back into one held note — Fragment's exact inverse on sounding intervals | Mongeau & Sankoff 1990 consolidation; the round trip is property-tested exhaustively |
| Euclid | 0 (opt-in) | Redistributes one window's onsets (each beat, or the whole cycle) onto the maximally even necklace with an identity-seeded rotation; count and classes preserved unless inversion fires | Bjorklund/Toussaint via the platform's Caesura-inherited masks; [reshape.rs](../crates/cseq-rhythm/src/generators/dumka/reshape.rs) |
| Morph | directive only | Moves, edits, inserts, or deletes one aligned onset micro-step toward an exact target pattern on the working lattice | Integer circular transport/edit alignment; [DUMKA_TREE_DEPTH.md](DUMKA_TREE_DEPTH.md) |

The operator is drawn from the **authored per-family weights** (each
0–100) over one identity-seeded band; the defaults reproduce M2's 3/3/2
draw bit-for-bit, so recorded trajectories replay unchanged until a weight
is authored differently. All-zero weights freeze the pattern.

Two Sioros implementation notes, per the primary source's own worked
examples: the dissertation's printed vector line has its type operands
transposed (this code computes `type = level(source) − level(target)`,
nonnegative, as Figs 4-7/4-19 require), and its transcribed source-walk
would admit a grab across a silent same-level pulse whose reversal lands
on the wrong slot — the walk here requires the source to be strictly
deeper than every silent pulse crossed, restoring the chapter's own 1-1
reversibility guarantee (the crossed configuration stays reachable as the
compound type-0-then-type-1 chain shown in Fig 4-19). Type-0 (same-level)
shifts exist only inside ternary strata, never at or above the beat level.
Displacement counts against the drift leash like add/remove, an interval
guard skips moves that would overlap a sustain, and everything is
trial-projected as usual.

**Fill complexity** (0–100, `generator.dumka.fillComplexity`, cycle-start
automation like the other percent knobs) biases Fragment's figure size
over the divisors-first candidate order: 0 always takes the simplest true
tuplet, 100 draws over every legal size (same integer pool construction as
the temperature; cap 64 pieces). Interval choice for both figure operators
ranks by the indispensability of the strongest pulse the figure would
newly articulate (fragment) or the weakest onset the merge would remove
(consolidate), widened by the temperature pool. Figures charge the drift
leash like adds and removes — a fragment of k pieces spends k−1 (k from
silence). Paired cross-span ties now project normally. The working subdivision
palette gives figures exact finer-than-seed positions within the platform
maximum; off-lattice/continuous timing remains out of scope.

**Euclid reshape knobs** (authored only): `euclidMaxRun` (1–8; above 1
the reshaped onsets cluster into bursts of at most that length, Caesura's
`bjorklund_burst_mask`), `euclidInvert` (percent chance a fired reshape
complements its mask — k onsets become n−k, leash-charged like any density
change; the complement of a Euclidean rhythm is again Euclidean), and
`euclidRestPolicy` (tied = each reshaped onset sustains to the next;
silent = one-slot hits — Caesura's `EuclideanRestPolicy`). Windows with a
sustain straddling their reshape window are not candidates; tied durations
may cross adjacent structural spans through the paired tie handshake. The
editor's pattern card also carries a **seed roller** that
composes whole cycles from the same vocabulary (`E(k,n,r)` sugar for plain
rolls, expanded burst/inverted masks otherwise). Each physical beat uses the
exact local slot count derived from the committed pattern, including rest
boundaries; a pattern whose cycle-wide LCM is 20 can therefore roll local grids
such as `[5,4,1,1]` instead of flattening every beat to 20. Tied expanded masks
are deterministically reoriented when needed so holds cannot collapse that
grid. The roller is an authoring tool whose output is ordinary pattern text.

**Barlow temperature** (0–100, `generator.dumka.barlowTemperature`,
cycle-start automation like rate and leash) widens the Remove/Add
candidate pool deterministically over the rank order: 0 keeps the strict
most/least-indispensable choice, 100 draws uniformly over all candidates.
This is an integer approximation of Barlow's real-valued "metric field
strength" probability formula, chosen so replay never depends on
platform-varying transcendental functions.

**Placement bias** (0–100, `generator.dumka.placementBias`) blends that Barlow
candidate order with the pinned Q16 geometric gap field before temperature
widens the pool. Zero is exact legacy Barlow order; 100 is pure spectral
void-seeking. The spectral objective is not universally Bjorklund: its known
agreement and divergence fingerprints are intentional and pinned separately.

Indispensability is computed constructively — group starts take the top
ranks by prime Ψ; every off-pulse ranks by its inner stratum band, ordered
by the pickup principle Ψ_q((g+1) mod q) — and is pinned against Barlow's
published tables (3×2 `[5,0,3,1,4,2]`, 2×3 `[5,0,2,4,1,3]`, 2×2
`[3,0,2,1]`, 2×2×2 `[7,0,4,2,6,1,5,3]`). Stratification is the beat
count's prime factors (largest first) then the Subdivision's. Grids with a
prime factor beyond 7 (no published Ψ table here) deterministically play
the seed verbatim when the corridor is off. If a corridor is active, a
documented positional order is used only to normalize density; it does not
pretend to be a missing Barlow ranking. Perceptual scoring is the exception:
any enabled perceptual row on an unsupported grid fails authoring validation,
including a future row, because the pinned model cannot construct its
Barlow/Sioros metrical context. Disabled rows preserve the legacy fallback.

The Generator editor renders this machinery live per algorithm family
(lanes and formulas mirrored in `ui/src/dumkaMetrics.ts`, pinned by the
Rust-generated `dumka_metrics_contract.json`); see
[UI_AND_INTERACTION.md](UI_AND_INTERACTION.md).

## Guards

- **Density corridor** (`densityFloor` / `densityCeiling`, automated at
  `generator.dumka.densityFloor` / `generator.dumka.densityCeiling`): onset
  count stays between `ceil(floor% × grid slots)` and
  `floor(ceiling% × grid slots)`. Defaults 0/100 switch the rail off and keep
  old trajectories byte-identical. Each operator is quota-clamped; Fragment
  can use fewer pieces and Consolidate can merge a shorter run. If the rail
  moves past inherited state, deterministic weakest-first removals or
  strongest-first additions normalize it before that cycle's operators, with
  every edit trial-projected. Directive-local paired overrides take precedence
  over sampled globals. Independently automated rails may cross; the ceiling
  stays the hard limit and the effective floor contracts to it. Preview trace
  records the blocking `floor` or `ceiling` and its effective percentage.
  Authored directive IDs remain positive; `directiveId: 0`, family
  `stochastic`, is the reserved trace source for a clamped legacy layer.
  Preview also returns the fold-owned cycle-effective floor/ceiling so the
  Evolve band remains truthful under automation and ordered overrides.
- **Complexity corridor** (`complexityFloor` / `complexityCeiling`, automated
  at `generator.dumka.complexityFloor` /
  `generator.dumka.complexityCeiling`): mean scaled Barlow indigestibility of
  attack-point denominators is controlled on `0..=100000`. Defaults 0/100000
  switch the rail off. Density normalization runs first because it changes the
  mean's denominator; complexity normalization then promotes or demotes each
  original onset at most once. Candidate order minimizes the strictly positive
  depth-price change before displacement, placement rank, and slot. Every
  family and the perceptual/curve frontier share the same complexity admission
  check. A discrete or projection-blocked target can remain outside the band,
  but an independent `complexityCorridorClamp` must then remain visible beside
  density and projection truth; silent stalls are forbidden.
- **Depth diversity** (`stateDepthDiversityMilli` in preview) is normalized
  Shannon entropy of the reduced-denominator multiset. It answers whether
  several levels coexist; it is insight only, not a fourth rail. A uniformly
  deep state can therefore have high complexity and zero diversity.
- **Metric velocity** (`metricVelocity`): the strong/weak hierarchy reaches
  loudness. Active modes classify every generated note-on into a
  strong/medium/weak tier — Auto by percentiles of a composite strength
  (pinned integer weights 40/30/30: working-grid Barlow rank; the note's
  position in its maximal equal-spacing run scored by that run-length's own
  Barlow ordering, so quintuplets carry the quintuplet profile; and the
  underlying beat strengths linearly interpolated at the note's temporal
  position — the accent the meter would give that moment if the beats were
  not spanned), Manual by an authored per-seed-slot map (palette-refined
  slots are weak) —
  and draw its MIDI velocity uniformly from that tier's authored 1-127
  range, identity-seeded per (seed, cycle, slot) under a pinned salt.
  Transport realization and preview display honor the stamped value over
  the authored-leaf inheritance; `off` (the default) preserves the
  historical accent path byte-for-byte. Validation is pinned
  (`dumka metricVelocity invalid: …`); auto mode requires a
  Barlow-supported grid and manual tiers must cover the seed grid exactly.
- **Algorithm switches** (`enableBarlowRemove` … `enableEuclid`): track-wide
  master switch per operator family. Off excludes the family from every
  stochastic layer — the weighted classic/pacing draws AND property-curve
  steering, which ignores weights by design (so a zero weight alone never
  meant "off" once a curve was drawn). Authored directives are not gated:
  they carry their own per-directive `enabled` flag and remain the explicit
  override. Serde defaults are all-on, so absent keys replay history
  byte-for-byte.
- **Drift leash** (`driftLeash`, `generator.dumka.driftLeash`): the
  symmetric difference between the current and seed onset sets may never
  exceed `⌈leash% × seed onsets⌉`. Add, Remove, and the M3 displacement
  pair are all charged against it (a displacement moves an onset, so it
  can spend up to two units). Rotation has its own register and is always
  reversible, so it is not leashed. The leash is also sampled at each
  historical cycle start. If automation tightens it below inherited drift,
  deterministic, trial-projectable removals/restorations contract the state
  before that cycle's stochastic operator is considered.
  The pacing-curve and property-steering walks are the stochastic layer under
  another name, so they obey the same budget per cycle (measured from the
  cycle's corridor-normalized inherited state), plus an **anchored onset-count
  floor**: `last authored count − budget`, where the anchor is the seed until
  a directive changes it. The floor exists because those walks re-anchor every
  cycle, and without it a sustained large step target deletes one budget of
  onsets per cycle until a single note remains — a near-empty state is an
  absorbing attractor under the distance model. Growth has no anchored
  ceiling (added material saturates rather than compounds distance); the
  density corridor remains the authored rail in both directions and outranks
  the floor when they disagree.
- **Trial projection**: every candidate result is projected against the
  actual structural spans. Paired cross-span tie chains are legal; malformed
  ties, overlap, incompatible grids, or broken tiling are not. Evolution can
  stall; playback can never break.
- **Precedence**: density corridor > complexity corridor > explicit plan >
  stochastic drift leash; projection remains an absolute playability
  postcondition. A directive may exceed the leash, but it cannot exceed either
  corridor or bypass projection.
- Out-of-range authored knobs are rejected with a pinned Display
  (`dumka evolutionRate must be 0-100, got 101`), never clamped; the
  automation samplers clamp their sampled values like every other target.

## Seed modes

| Mode | Meaning for the fold |
|---|---|
| Locked | One deterministic trajectory per seed — the musical default. Byte-identical replay; re-roll the seed for a new trajectory. |
| Per Cycle | The fold re-bases on a per-cycle seed: "parallel universe at cycle N". Deterministic and replayable, but not a continuous walk. |
| History | Re-bases on the weighted seed pool like every generator; the seed-path record/replay captures each resolution. |

## Determinism and cost

Every stochastic decision is keyed by `(seed, cycle, purpose salt)` —
never by draw order — so adding a decision can never perturb another. The
invariants suite fuzzes evolving configs (rate, leash, and paired density
corridors across their full ranges) through all four property families,
including byte-identical seed-path replay. The fold is recomputed per resolve;
measured cost (cseq-bench
`generator/dumka-fold-corridor-cycle-10000`, release, M-series): folding a
legal 16-directive plan through a 25–60% corridor to cycle 10,000 has a
10.66 ms median over 10 measured runs. Random-access stopped preview is
therefore capped at cycle 10,000 in both patch normalization and the generic
Tauri preview boundary. Playback itself remains unbounded, and live timeline
requests within two cycles of the reference or active parallel-track cycle
continue to use the same resolver. The per-resolve cost still grows linearly
with a long-running transport's cycle; checkpointing remains future work if
unbounded multi-day real-time runs become a supported performance target.

Two report-only release cases cover calibrated pacing:
`generator/dumka-perceptual-planner-cycle-1` and
`generator/dumka-perceptual-distance-dense-8192`. One local run measured
approximately 1.140 ms and 1.114 ms median respectively. These machine-specific
numbers are not CI thresholds; commands and model scope are recorded in
[DUMKA_PERCEPTUAL_DISTANCE.md](DUMKA_PERCEPTUAL_DISTANCE.md).
The generator rejects enabled perceptual plans that reserve more than 4,096
distance evaluations over their complete authored ranges; each active
row-cycle reserves `maxOperations + 1` for prefix zero and the nonzero search.
This prevents a valid far-cycle preview from multiplying the dense-distance
case into minutes of replay work.

The refined-grid release case is
`generator/dumka-depth-fold-cycle-10000`: palette `{2,3}`, working
Subdivision 24, placement bias 50, and a bounded nonzero curve tail through
cycle 10,000. One local release iteration measured approximately **57.170
ms** (checksum 57). This is a report-only machine measurement, not a CI
threshold; the command and its like-for-like caveat are in
[TESTING.md](TESTING.md).

The mock e2e driver deliberately does not port the fold. It projects the seed
at cycle 0, or at a later cycle only when the authored rate is 0 and no enabled
rate-automation source exists. A request for an evolving later cycle fails
loudly instead of returning false seed cells; those cycles are covered by the
real-backend lane and the invariants.

## Deviations from the roadmap sketch

EuclideanReshape and the Barlow temperature (field-strength) exposure moved
to M3 alongside the Sioros–Guedes displacement pair and per-family weights:
the M2 op set stays small enough to hear each operator's character.
