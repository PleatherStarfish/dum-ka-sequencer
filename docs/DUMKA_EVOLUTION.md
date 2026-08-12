# Dum-Ka evolution

Cycle N of a Dum-Ka track is a **pure fold** of identity-seeded operators
over cycles 1..=N, starting from the compiled seed pattern
(`crates/cseq-rhythm/src/generators/dumka/evolve.rs`). Cycle 0 is always
the seed verbatim. Authored `evolutionRate` 0 keeps every cycle the seed when
there is no enabled rate-automation source — the M1 behavior, config default,
and constant-time feature-off path. With an active lane, every historical
cycle is sampled independently; a later 0% value freezes the completed prefix
instead of erasing evolution produced by earlier nonzero values.

## Authored evolution score and gradual pacing (M3.75/M3.8)

`DumkaGeneratorParams.plan` replaces chance-driven pacing wherever an enabled
directive is active. A pin names one cycle; a range names inclusive cycles.
Directives are sorted by authored `order`, so different families may compose
at one cycle, while same-family overlaps are rejected. Each stable directive
ID salts its own `SALT_PLAN` stream; reorder and save therefore cannot retarget
its choices. An empty plan is the exact legacy fold and remains the
byte-compatibility anchor.

Intensity is quota, not probability. A pin requests
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

Gradual pacing bounds how many **operator applications** are scheduled at one
cycle boundary; it is not a continuous audio crossfade. One Add/Remove usually
changes one onset and one Syncopate/Desyncopate moves one onset. A single
Rotate can move every onset in its window, Fragment can expose a complete
figure, Consolidate can merge a run, and Euclid can redistribute a whole
beat/cycle. Those families therefore remain capable of an audible structural
step even when their applications are paced gradually.

Optional beat scope is converted to an exact slot interval on the seed grid.
Candidates must remain inside it: figure/reshape intervals are contained,
Sioros source and landing both qualify, and scoped Rotate cyclically shifts only
the window. A pattern edit that makes a scope orphaned does not brick playback;
the directive skips and preview traces `orphanedScope`.

Authored directives are exempt from the drift leash because the change is
explicit, but never from interval disjointness, tie fences, or trial projection.
Preview returns per-cycle `{requested, applied, skipped}` trace entries for the
requested cycle (`none`, `orphanedScope`, `projection`, or `exhausted`). A
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
| BarlowAdd | 3 | Sounds the most indispensable silent pulse (including no covering sustain) as a one-slot hit, inheriting the preceding stroke class | Barlow "filling"; ranks come from [barlow.rs](../crates/cseq-rhythm/src/generators/dumka/barlow.rs) |
| Rotate | 2 | Moves the whole pattern one beat earlier or later via a rotation register | Beat-class transposition T_k (Babbitt/Cohn phasing); ranks stay in the unrotated metric frame, where indispensability means something |
| Syncopate | 0 (opt-in) | Anticipates one onset backward from its strong pulse onto a silent preceding pulse `type` levels faster | Sioros, *Syncopation as Transformation*, PhD diss., U. Porto 2015, ch. 4 (CMMR 2013/LNCS chapter of the same title); [sioros.rs](../crates/cseq-rhythm/src/generators/dumka/sioros.rs) |
| Desyncopate | 0 (opt-in) | Resolves one felt syncopation forward: the qualifying preceding onset moves onto its silent stronger pulse | Same source; exact inverse of Syncopate via the `{pulse, type}` vector |
| Fragment | 0 (opt-in) | Splits one held note (or one silent run) into an `E(k,n)` figure over its own slots — a true equal tuplet when k divides n, the maximally even on-grid figure otherwise | Mongeau & Sankoff 1990 fragmentation; Bjorklund placement; [figures.rs](../crates/cseq-rhythm/src/generators/dumka/figures.rs) |
| Consolidate | 0 (opt-in) | Merges a contiguous sounding run back into one held note — Fragment's exact inverse on sounding intervals | Mongeau & Sankoff 1990 consolidation; the round trip is property-tested exhaustively |
| Euclid | 0 (opt-in) | Redistributes one window's onsets (each beat, or the whole cycle) onto the maximally even necklace with an identity-seeded rotation; count and classes preserved unless inversion fires | Bjorklund/Toussaint via the platform's Caesura-inherited masks; [reshape.rs](../crates/cseq-rhythm/src/generators/dumka/reshape.rs) |

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
silence) — and a fragment whose sustain would cross a span boundary is
skipped by trial projection for that cycle. Finer-than-grid tuplets remain
gated on the platform upsample extension (ROADMAP M6+).

**Euclid reshape knobs** (authored only): `euclidMaxRun` (1–8; above 1
the reshaped onsets cluster into bursts of at most that length, Caesura's
`bjorklund_burst_mask`), `euclidInvert` (percent chance a fired reshape
complements its mask — k onsets become n−k, leash-charged like any density
change; the complement of a Euclidean rhythm is again Euclidean), and
`euclidRestPolicy` (tied = each reshaped onset sustains to the next;
silent = one-slot hits — Caesura's `EuclideanRestPolicy`). Windows with a
sustain straddling their edge are not candidates; cycle-scope reshapes
with tied durations only project on structures whose spans can hold the
sustains. The editor's pattern card also carries a **seed roller** that
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

Indispensability is computed constructively — group starts take the top
ranks by prime Ψ; every off-pulse ranks by its inner stratum band, ordered
by the pickup principle Ψ_q((g+1) mod q) — and is pinned against Barlow's
published tables (3×2 `[5,0,3,1,4,2]`, 2×3 `[5,0,2,4,1,3]`, 2×2
`[3,0,2,1]`, 2×2×2 `[7,0,4,2,6,1,5,3]`). Stratification is the beat
count's prime factors (largest first) then the Subdivision's. Grids with a
prime factor beyond 7 (no published Ψ table here) deterministically play
the seed verbatim instead of guessing.

The Generator editor renders this machinery live per algorithm family
(lanes and formulas mirrored in `ui/src/dumkaMetrics.ts`, pinned by the
Rust-generated `dumka_metrics_contract.json`); see
[UI_AND_INTERACTION.md](UI_AND_INTERACTION.md).

## Guards

- **Drift leash** (`driftLeash`, `generator.dumka.driftLeash`): the
  symmetric difference between the current and seed onset sets may never
  exceed `⌈leash% × seed onsets⌉`. Add, Remove, and the M3 displacement
  pair are all charged against it (a displacement moves an onset, so it
  can spend up to two units). Rotation has its own register and is always
  reversible, so it is not leashed. The leash is also sampled at each
  historical cycle start. If automation tightens it below inherited drift,
  deterministic, trial-projectable removals/restorations contract the state
  before that cycle's stochastic operator is considered.
- **Trial projection**: every candidate result is projected against the
  actual structural spans; an op that would strand a note across a span
  boundary is skipped for that cycle. Evolution can stall; playback can
  never break (property-tested under Grouping-3 tiles where rotation
  genuinely produces illegal candidates).
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
invariants suite fuzzes evolving configs (rate and leash across their full
ranges) through all four property families, including byte-identical
seed-path replay. The fold is recomputed per resolve; measured cost
(cseq-bench `generator/dumka-fold-cycle-10000`, release, M-series): folding
to cycle 10,000 at rate 100 takes ~17 ms. Random-access stopped preview is
therefore capped at cycle 10,000 in both patch normalization and the generic
Tauri preview boundary. Playback itself remains unbounded, and live timeline
requests within two cycles of the reference or active parallel-track cycle
continue to use the same resolver. The per-resolve cost still grows linearly
with a long-running transport's cycle; checkpointing remains future work if
unbounded multi-day real-time runs become a supported performance target.

The mock e2e driver deliberately does not port the fold. It projects the seed
at cycle 0, or at a later cycle only when the authored rate is 0 and no enabled
rate-automation source exists. A request for an evolving later cycle fails
loudly instead of returning false seed cells; those cycles are covered by the
real-backend lane and the invariants.

## Deviations from the roadmap sketch

EuclideanReshape and the Barlow temperature (field-strength) exposure moved
to M3 alongside the Sioros–Guedes displacement pair and per-family weights:
the M2 op set stays small enough to hear each operator's character.
