# Design note — M3.95 "Depth": subdivision palettes, geometric placement, transport morphing

Status: **implemented in the M3.95 engine and editor; release verification is
tracked in §8.** This is the normative implementation reference. Read
`AGENTS.md`, `DUMKA_EVOLUTION.md`,
`DUMKA_EVOLVE_PLAN.md`, `DUMKA_PERCEPTUAL_DISTANCE.md`, and
`DUMKA_SPAN_TIES_AND_DENSITY.md` first; every contract there stays in
force. The source ideas in `rhythm-evolution-models.md` (torus transport /
density field / spectral models) are adapted here onto Dum-Ka's
deterministic substrate — **integer or fixed-point arithmetic only in
decision paths, identity-seeded draws, byte-identical replay**. Where the
source document says Langevin noise and floats, this design says salted
draws and pinned integer tables. The musical intent survives; the
nondeterminism does not.

## 0. The problem, precisely

1. **Representation ceiling.** `EvolutionState` lives on
   `N = totalBeats × requiredSubdivision`, fixed by the seed's own
   denominators. A seed of quarters (subdivision 4) can never grow an
   eighth, a triplet, or a 5:2 figure: those positions do not exist in
   the state space. Every operator — Barlow add/remove, Sioros pair,
   Fragment/Consolidate, Euclid reshape, rotation, the curve — moves
   onsets on the seed lattice. Rhythm-tree depth is flattened at compile
   time and never revisited.
2. **Policy blindness.** Even on grids with room (subdivision 12 holds
   binary and ternary positions), candidate ranking is seed-grid Barlow
   indispensability: strong slots first. Nothing evaluates "an onset at a
   NEW level here would read as syncopation / ornament / density," so
   evolution reinforces the prevailing feel.
3. **Control requirement.** Any fix must keep gradualism (the perceptual
   curve/targets stay the master governor) and add *controlled* depth —
   complexity must be a rail the author sets, not a side effect.

## 1. Architecture in one paragraph

The fold gains a **working lattice**: `W = requiredSubdivision × R`,
where the refinement `R` comes from an authored **subdivision palette**
(prime levels the piece may explore). Everything downstream is untouched
because the projector already accepts any multiple of the requirement
("needs Subdivision S (or a multiple)") — proven in production by the
authored-35-over-required-5 case. Barlow ranks and Sioros templates are
computed on the working stratification, so new-level positions
automatically rank as weak/off-template — the mathematically correct
statement of "these are ornamental/syncopated placements." On top:
(a) a **complexity corridor** (third rail, exactly the density-corridor
pattern) bounds how much new-level material the state may carry;
(b) a **geometric placement field** (fixed-point spectrum, from the
source doc's Model B) gives Add/Remove an evenness/void-seeking
candidate order blendable against Barlow; (c) a **transport morph**
directive family (Model A, exact integer OT on the circle) provides
directed, provably gradual movement toward a target pattern. The
perceptual prefix search and evolution curve remain the sole pacing
authority; the v1 model already prices tuplet/ratio complexity and
syncopation, so refined-lattice edits cost honest perceptual distance.
Mean depth is not mistaken for variety: a separate, insight-only
**depth-diversity** statistic reports the normalized entropy of the same
reduced-denominator inventory. A uniformly ternary pattern may therefore
have high mean depth and zero diversity, while a mixture of beat, binary,
and ternary positions reports a positive spread.

Model C (spectral-invariance wander) is **deferred**: its musical value
("keeps sounding like itself while changing") is substantially covered by
perceptual pacing, exact homometry classes are small (source doc's own
caveat), and it would add a third ranking system before the first two are
calibrated. The fixed-point spectrum currently lands as the candidate
placement field; a separate authored spectral-invariance rail or wander
operator does not.

## 2. Phase 0 — precondition: clear the open audit findings

Before widening the lattice, land the queued M3.75–M3.9 audit fixes
(session task list #17), because refinement multiplies exposure to
exactly those defects: cycle-local leash exemption, gap-cycle rule with a
non-empty plan, attack-only scope filters for Remove/Sioros, windowed
Rotate containment, corridor freeze/no-trace edge cases, zero-intensity
corridor mutations, silent >7-prime drops, and the mock's missing plan
validation. Each fix ships with the regression test named in the audit
report. Exit: all previously-green suites plus new regressions green.

## 3. Phase 1 — the subdivision palette (representation)

### Params

```rust
/// Authored depth palette: prime levels evolution may explore beyond the
/// seed's own grid. Order-insensitive; deduplicated; serde default [].
#[serde(default)]
pub subdivision_palette: Vec<u32>,   // each ∈ {2, 3, 5, 7}, ≤ 2 entries
```

Empty palette ⇒ working lattice = seed lattice ⇒ **every existing
trajectory replays byte-identically** (the compat pin; test sweeps every
pinned trajectory and golden with palette []).

### Working lattice

```
P = sort(deduplicate(subdivisionPalette))
R = Π p, for p in P
W = requiredSubdivision × R
```

Exact rule: for each unique palette entry `p`, multiply `R` by `p` once. A
prime already present in the seed factorization contributes one **additional**
power: palette `{2}` on required Subdivision 4 produces working Subdivision 8.
Validation (pinned `GeneratorError::DumkaPlanInvalid`-style messages on a
new `DumkaRange`-family variant):
- entries ∈ {2,3,5,7}: `dumka subdivisionPalette entries must be 2, 3, 5, or 7, got {v}`
- ≤ 2 entries after dedupe: `dumka subdivisionPalette supports at most 2 levels, got {n}`
- `W ≤ DUMKA_MAX_SUBDIVISION (64)`:
  `dumka subdivisionPalette needs working Subdivision {w}, above the platform maximum 64`
  (validation-time, against the CURRENT pattern's requirement; a later
  pattern edit that breaks the cap is a resolve-time structure error via
  the normal path, never a silent drop).

### State and metrics on W

- `seed_state`: slot/dur computed at `W` (`event.start × W` exact — the
  rationals divide by construction).
- `strata = factor_descending(beats) ++ factor_descending(W)`; ranks,
  Sioros templates, beat_level unchanged in code — they simply receive
  the refined stratification. **This is the depth unlock**: an added
  onset at a bare-triplet position is automatically low-rank (enters as
  ornament under temperature/bias) and off-template (immediately
  syncopatable by the existing Sioros pair).
- Leash: budget stays `% of seed onset COUNT` (count-based, scale-free).
  `seed_slots` are on `W`. Pinned test: same pattern, palette [] vs {2},
  leash semantics equivalent for on-seed-lattice edits.
- Fragment/Euclid/figures: no code change; `k_candidates`/windows see the
  finer grid naturally. New pinned tests: Fragment of a quarter into
  true 8ths with palette {2}; Euclid reshape emitting triplet positions
  with palette {3}.
- Whole-cycle perceptual distance & pacing: `PerceptualContext` built on
  `W`. Add a pinned check that the v1 ratio-complexity component scores
  refined-position onsets HIGHER than seed-lattice onsets on the same
  pattern (if v1 mis-prices this, document it as v2 calibration input —
  v1 stays immutable; do NOT tune weights).

### Structure plumbing (the one user-visible contract change)

`requiredStructure` gains the working subdivision:
- Rust `required_structure()` and the TS mirror
  (`analyzeDumkaPattern` + `deriveDumkaBeatSlotCounts`) return
  `{ cycleBeats, subdivision (seed), workingSubdivision }`, where
  `workingSubdivision = subdivision × R(palette)`. The parser contract
  fixture grows palette cases (fixture regeneration is Rust-emitted as
  established).
- **Apply structure authors `workingSubdivision`.** `dumkaStructureMatches`
  accepts any multiple of `workingSubdivision` (not merely of the seed
  requirement) — otherwise structure-ready would claim ready while the
  palette has no room. Generator editor readout: `needs 4 beats ·
  Subdivision 4 · working 12 (palette ×3)`. The oversized-multiple
  simplify affordance keys off `workingSubdivision`.
- Mock: same mirror, bit-exact; palette-bearing verbatim configs resolve
  (cycle 0 / non-evolving), folded cycles keep failing loudly.

### Trace/UI surfacing

Add `workingSubdivision` to the preview DTO next to `densityCorridor`
(fixture churn both directions with no-op proofs). The timeline already
renders any uniform grid; badges (beat fractions) and the anchor ruler
already scale.

## 4. Phase 2 — the complexity corridor (control)

**State complexity metric**: the Barlow-indigestibility functional
`C(x)` defined exactly in §4a below — attack-point denominator pricing,
integer-exact, order-free, literature-grounded. Phase 2 implements §4a–d
verbatim: the metric, the Promote/Demote micro-operators, the
normalization flows with their termination arguments, and the
density-before-complexity ordering rule.

**Rails**, cloned from the density corridor wholesale (same shapes, precedence
*density corridor > complexity corridor > plan > leash*, same trace
vocabulary):
- Params `complexityFloor` / `complexityCeiling` (0..=100000 milli,
  serde defaults 0/100000 ⇒ off ⇒ byte-compat), validation floor ≤
  ceiling, cycle-start automation targets
  `generator.dumka.complexityFloor/Ceiling` (registry 112 → 114, exact-
  definition tests, snapshot delta verified), per-directive
  `options.complexityFloor/Ceiling` overrides (paired, like density).
- Enforcement: quota clamp before every apply (an Add/Fragment/Euclid
  candidate whose resulting state complexity exceeds the ceiling is
  clamped/skipped with `ComplexityCorridorClamp` trace detail); floor
  symmetric for Remove/Consolidate of the last refined material;
  `normalize_to_complexity_corridor` when the rail moves under an inherited
  state. It visits shallowest-first for a floor and deepest-first for a
  ceiling; each onset moves to the smallest-price-step admissible silent slot,
  deterministically and trial-projected. Complexity normalization does not
  change onset count—if no move is possible, it reports the clamp/stall rather
  than borrowing density normalization's add/remove operations.
- Preview DTO: `complexityCorridor` + per-cycle realized
  `stateComplexityMilli` beside `cycleDistance` (the Evolve editor draws
  it as a second thin band lane under Step size — same cell machinery).

This is the "controlled levels of complexity" dial: floor 0 / ceiling
raised gradually (authorable via directives' overrides across ranges)
lets depth *in* on the author's schedule; the perceptual curve still
paces per-cycle change.

## 4a–4e. Mathematics of depth: metric, flow, admissibility, bounds

This section is normative. Every formula is integer- or rational-exact;
every constant is pinned by a test.

### 4a. The complexity functional (Barlow indigestibility of attack points)

Barlow's *indigestibility* (Barlow 1987, "Two Essays on Theory" — the
same paper as the indispensability tables already in `barlow.rs`) prices
a positive integer by its prime decomposition:

```
ξ(p) = 2(p−1)²/p                    for prime p
ξ(Π pᵢ^kᵢ) = Σ kᵢ·ξ(pᵢ)             (additive over the factorization)
ξ(1) = 0
```

Scaled by 210 = lcm(2,3,5,7), ξ becomes an **exact integer table** over
the platform's admissible primes:

```
ξ̂(1) = 0     ξ̂(2) = 210    ξ̂(3) = 560    ξ̂(5) = 1344    ξ̂(7) = 2160
ξ̂(composite) additive:  ξ̂(4) = 420, ξ̂(6) = 770, ξ̂(8) = 630,
ξ̂(12) = 980, ξ̂(20) = 1764, …
```

The ordering 8ths < triplets < quintuplets < septuplets (210 < 560 <
1344 < 2160) matches musician intuition and Barlow's own harmonicity
ranking; composite depth adds (a sextuplet position costs a binary plus
a ternary, 770).

**Onset depth price.** For an onset at working-lattice slot `s` (grid
`W` per beat), let `f = (s mod W)/W` reduced to lowest terms `p/q`. Then

```
δ(s) = ξ̂(q)          — the indigestibility of the attack point's
                        reduced within-beat denominator.
```

`δ` is position-only: order-independent (no dependence on stratification
ordering), zero exactly on beat starts, and invariant under beat-class
rotation (rotation shifts whole beats, so `s mod W` is preserved —
rotation is complexity-neutral, which is why it stays unleashed and
uncorridored).

**State complexity.** For state `x` with onsets `s₁…s_k` (`k ≥ 1` is an
existing invariant):

```
C(x) = round( 100000 · Σᵢ δ(sᵢ) / (k · ξ̂(W)) )   ∈ 0..=100000
```

`ξ̂(W)` is the maximum of `ξ̂(q)` over divisors `q | W` (additivity ⇒ the
maximum sits at `q = W`), so the normalization is exact and `C = 100000`
iff every onset sits on a finest-denominator position. Pinned vectors:
`dum . ka .` on W=4 → C=0; the same onsets after one 8th-note promotion
on W=8 → C = round(100000·210/(3·630)); a full triplet beat on W=12; a
5:2 spanning pair on W=20. Duration is deliberately unpriced — duration
structure is the figures family's domain and is already perceptually
priced; `C` measures *attack-point depth* only.

### 4b. The push and the pull: Promote/Demote micro-operators

Depth needs a force, not just permission. Define two deterministic
micro-operators used by corridor normalization (and only there — they
are constraint flows, not part of the stochastic/curve draw):

**Promote(i)**: onset `i` at slot `s` moves to an admissible slot `s′`,
subject to:

```
ξ̂(den(s′)) > ξ̂(den(s))                    (strictly deeper price)
|wrap(s′ − s)| ≤ ⌊W / (2·q)⌋               (identity bound: stay within
                                            half the source level's
                                            period — the promoted onset
                                            reads as the SAME note
                                            nudged into a tuplet slot)
s′ silent and uncovered; result disjoint; trial projection passes.
```

Candidate order is the musical ladder, not the nearest raw grid point:

```
Promote: (smallest positive Δξ̂, displacement, placement rank, slot)
Demote:  (smallest positive −Δξ̂, displacement, placement rank, slot)
```

The depth-price change is therefore the primary key. Displacement decides
only between targets on the cheapest strictly deeper (or shallower) level;
the blended placement rank (§Phase 3) and slot are final deterministic
ties. This correction is load-bearing. On `W = 12`, a proximity-first
Promote from a beat start could choose adjacent slot 1, whose denominator 12
costs `ξ̂(12) = 980`, and jump immediately to the most exotic available
position. Price-first ordering instead exposes the intended ladder
beat (`0`) → eighth (`210`) → sixteenth (`420`) → triplet (`560`),
with composite levels following their exact price. **Demote(i)** mirrors the
same smallest-price-step rule (`ξ̂` strictly smaller, displacement bound
computed from the target's period).

Both operators preserve onset count, duration, and stroke class; both are
their own inverse's witness (a promotion's reverse demotion is admissible by
construction unless material moved into the vacated slot — no exactness claim
is made, unlike figures).

**Floor flow** (the push): while `C(x) < complexityFloor` and progress
is possible: promote the onset with the smallest `δ(sᵢ)` whose Promote
admits a target (ties: ascending Barlow rank of its slot, then slot).
**Ceiling flow** (the constraint): while `C(x) > complexityCeiling`:
demote the onset with the largest `δ(sᵢ)` (ties symmetric).

**Termination proof.** `Σᵢ ξ̂(den(sᵢ))` is a nonneg integer, bounded by
`k·ξ̂(W)`; each promotion strictly increases it, each demotion strictly
decreases it, and the loops never mix directions in one pass ⇒ both
flows terminate in at most `k·ξ̂(W)/min-step` iterations; in practice ≤ k
per cycle because each onset is touched at most once per pass (enforced:
one flow pass visits each onset index at most once — pinned). A pass
that makes no progress records the corridor clamp in the trace exactly
like density normalization (`ComplexityCorridorClamp { limit,
complexityMilli }`) — a silent stall is forbidden.

### 4c. Normalization ordering and the admissibility algebra

Within one folded cycle the deterministic order is:

```
1. density normalization      (existing; changes k)
2. complexity normalization   (new; k fixed, moves onsets between levels)
3. the cycle's operator work  (stochastic | curve | directives)
```

Density first because it changes `k`, which appears in `C`'s
denominator; running complexity first would let a subsequent add/remove
invalidate the corridor it just established. Both run before operator
work, mirroring the existing leash-then-corridor discipline; the
precedence lattice extends to:

```
projection/tie-fence  ⊃  density corridor  ⊃  complexity corridor
        ⊃  plan (directives/curve)  ⊃  leash (stochastic layer only)
```

**Candidate admission** is now a predicate over the feature vector
`Φ(x′) = (k(x′), C(x′), symdiff(x′, seed), proj(x′))`: an operator
candidate `x′` is admissible iff every applicable rail holds. All
operator families — Add, Remove, Sioros pair, Fragment, Consolidate,
Euclid, Morph, Promote/Demote-in-normalization — evaluate the SAME
predicate (one function, `candidate_failure`, extended with the
complexity clamp; no family gets a private variant). The perceptual
prefix search optimizes `|d(x, x′) − target|` **over admissible prefixes
only**, so the curve can never buy depth the corridor forbids, and the
corridor can never be bypassed by search pressure — the search sees
clamped candidates as frontier failures exactly as it sees density
clamps today.

### 4d. Gradualism bounds (what "controlled" means, quantitatively)

Per-operator complexity flux is bounded: one application moves or adds
at most one onset (Fragment: `k−1` onsets, each priced), so

```
|ΔC| per application ≤ 100000 · max_add_ξ̂ / (k · ξ̂(W))
```

with `max_add_ξ̂ = ξ̂(W)` in the worst case (one onset to/from the finest
level) and `Fragment ≤ (k_frag−1)·ξ̂(W)` handled by its corridor clamp on
the whole figure. Per cycle, applications are bounded by `maxOperations`
(curve/perceptual directives, ≤ 8) or the per-cycle quota (legacy/quota
directives) ⇒ `|ΔC|` per cycle ≤ `100000·maxOps/k` in the loose worst
case. Two binding constraints make practice far tighter and are the real
control story: (i) every operator candidate is rejected before it would leave
an already-satisfied corridor or move a violated state farther past its active
limit; (ii) the v1 perceptual model's tuplet/ratio component prices refined
placements, so a curve target of `T` milli per cycle bounds depth flux through
the distance budget.

A moving or newly enabled rail is not always reachable in one cycle. The
normalizer touches each original onset at most once so the constraint flow
itself stays gradual; projection, occupied targets, and the discrete set of
depth prices can also make an exact boundary unattainable. In that case the
resolved `C` may remain outside the band, but an independent
`ComplexityCorridorClamp { limit, complexityMilli }` is mandatory. This is the
same honesty rule as a stalled density normalization: never silently claim
that an unreachable rail was met. Acceptance therefore asserts "inside or
truthfully clamped," not unconditional inside-band output.

### 4e. Spanning tuplets: expressibility and price (theorem + tests)

On working grid `W`, an exact `k:b` tuplet spanning `b` whole beats
(onsets at `j·b/k` beats, `j = 0..k−1`) is expressible **iff
`k | b·W`**, in which case its onsets sit at slots `j·bW/k` and the
figure's price contribution is `Σⱼ ξ̂(den(frac(j·b/k)))` with maximum
element `ξ̂(k / gcd(k, b))`. Consequences, stated and pinned:

- Palette {5} with any `W` a multiple of 5 admits exact 5:2 and 5:4
  figures (e.g. W=20: slots every 8 across two beats — the canonical
  articulated quintuplet's grid, now reachable by EVOLUTION, not only
  authoring).
- `Fragment` on a `b`-beat interval with size `k` already emits exactly
  these positions when `k | bW` (`E(k, bW)` degenerates to the equal
  tuplet on the divisibility condition) — a pinned test promotes this
  from accident to contract, including the crossing sustains through the
  M3.9 tie handshake.
- `Morph` targets containing spanning tuplets are admissible iff the
  target's requirement divides `W` (already required by Phase 4
  validation) — so the divisibility condition surfaces to the author as
  one pinned message, never a silent approximation.
- The Sioros pair on the refined template may land anticipations ON
  tuplet slots; the landing's `Δδ` is charged through the complexity
  corridor like any candidate (a syncopation INTO depth is priced as
  depth). One pinned test: with ceiling below `ξ̂(3)`-equivalent, a
  ternary-landing syncopation is clamped while the binary-landing one
  passes.

### 4f. Depth diversity (spread, not another mean)

`C(x)` is deliberately context-free and first-order: it answers "how deep is
the average attack?" It cannot answer "how many different depth classes are
coexisting?" Uniform triplets can satisfy a high complexity floor while being
as depth-monotone as uniform sixteenths. Retuning Barlow's `ξ̂` table cannot
repair that missing statistic because every onset is still priced
independently.

Let `n_q` be the number of attacks whose reduced within-beat denominator is
`q`, let `k = Σ_q n_q`, and let `τ(W)` be the number of divisors of the working
Subdivision. With `p_q = n_q/k`, the insight readout is normalized Shannon
entropy (Shannon 1948, applied here to the denominator-class distribution):

```
H(x) = − Σ_q p_q log2(p_q)
D(x) = round(100000 · H(x) / log2(min(k, τ(W))))
```

For fewer than two attacks, one occupied denominator class, or a zero
normalizer, `D(x) = 0`. The engine evaluates `log2` with a pinned 16-step Q16
integer recurrence; no floating point enters replay or ranking. Counts are
order-free and beat-class rotation leaves the denominator multiset unchanged.
Pinned anchors on `W = 12` are:

- uniformly triplet attacks: `D = 0`;
- `{denominator 1 × 2, denominator 2 × 1, denominator 3 × 1}`:
  `D = 75000`; and
- one attack at every available denominator class: `D = 100000`.

`D` ships as `stateDepthDiversityMilli` in preview and as an insight readout,
not as an admissibility rail. The only enforced depth rail remains the mean
complexity corridor `[complexityFloor, complexityCeiling]`. Promoting diversity
to an authored corridor would require separate musical calibration and a
normalization flow that can change the denominator histogram without fighting
the mean rail.

### What §4a–f buys, mapped to the complaint

- "Evolution stays in the prevailing tuplet" → Promote flow + palette:
  depth has a *force* (floor), not just permission.
- "No depth explored via rhythm trees" → `δ` prices exactly the tree
  depth of each attack point; `C` is the tree-depth budget of the whole
  state; corridors schedule it over the composition.
- "Doesn't consider whether adding triplets would add syncopation" →
  placement bias chooses void-seeking vs metric placement; the refined
  Sioros template makes new levels syncopatable; the perceptual model
  prices the result; the complexity corridor prices the depth — four
  independent, individually-testable mathematical answers instead of one
  heuristic.
- "A uniformly deep result is still monotonous" → `D(x)` exposes the
  denominator spread independently of `C(x)`; it is visible evidence, not an
  uncalibrated constraint.

## 5. Phase 3 — geometric placement (the syncopation-aware chooser)

Adapted from source Model B (§4.2–4.3), determinism-first.

### Fixed-point spectrum module (`spectrum.rs`)

- Q16.16 (i64 accumulation) fixed-point `cosTable[W][M]` for
  `cos(2π·m·s/W)`, `m = 1..=M`, `M = min(16, W/2)`, generated by the
  integer angle-addition recurrence from pinned seeds per denominator
  (no libm in any decision path). Table pinned against reference vectors
  (…values for W ∈ {8,12,16,20,24,48,60,64} at m ≤ 4) in unit tests, and
  cross-pinned to the TS mirror via a new section of the Rust-emitted
  metrics contract fixture.
- `F(m)` over onset slots by table lookup; incremental update on
  add/remove (O(M) per candidate) exactly as the source doc's
  `insertion_delta`: `ΔE_ins(s) = Σ_m w_m·(2·Re(conj(F(m))·e^{-2πims/W}) + 1)`
  with `w_m = ⌊2^16/m⌋` (the doc's `m^{-α}, α=1`), harmonics `m ≡ 0
  (mod k)` skipped per the doc's evenness note.
- `geometric_add_order(state) -> Vec<u32>`: silent-uncovered slots sorted
  ascending by ΔE_ins (lowest-energy insertion first), ties by slot.
  `geometric_remove_order`: sounding onsets descending by redundancy
  (ΔE_del), ties by slot. Both pure, integer, exact.

### Blended ranking (`placementBias`)

New percent param `placementBias` (serde default 0 ⇒ byte-compat; 0–100
validated like every knob; cycle-start automation target, registry 114 →
115; per-directive `options.placementBias` override). Candidate order
for Add/Remove (stochastic layer, curve steps, and directives alike):

```
score(slot) = (100 − bias) × barlowRankNorm(slot) + bias × geoRankNorm(slot)
```

integer normalized ranks (0..=1000 each, from position in the respective
order), sorted ascending/descending as each op requires, ties by slot.
Temperature pooling applies ON TOP of the blended order, unchanged. At
bias 0 the order is bit-identical to today (pin). At bias 100 placement
is pure void-seeking — onsets land in temporal gaps regardless of metric
strength, which the Sioros component of the perceptual model then prices
as syncopation. **This is the "does adding this create syncopation"
chooser asked for**: bias decides metric-reinforcing vs gap-seeking
placement; the working lattice decides which levels exist to seek into;
the complexity corridor bounds how deep; the curve bounds how fast.

Verification adapted from source §7.1–7.2 is exact, not stochastic.
`placementBias = 100` optimizes this pinned low-harmonic energy; it is **not**
specified as another spelling of Bjorklund. Greedy spectral insertion agrees
with a maximally even necklace for some divisor cases and diverges for others
(for example, the `W = 8`, `k = 4` spectral prefix is `[0, 4, 1, 6]` under the
pinned harmonic weights). Agreement cases and divergence fingerprints must be
snapshot-pinned separately. Treating every divergence as a bug would silently
replace the authored geometric objective with the Euclidean operator's
different objective.

## 6. Phase 4 — transport morph (directed gradualism)

Adapted from source Model A; everything integer on the working lattice.

- New directive family `Morph` (weights stay directive-only; no
  stochastic band — append enum variant, band order preserved).
  `options.morphTarget: Option<String>` — a Dum-Ka pattern compiled at
  validation (same beats; its own requirement must divide W or validation
  fails with a pinned message; compiled onsets land on W).
- Equal counts: circular OT = best-of-k cyclic pairings, integer cost
  `Σ |wrap_signed_slots|` (i64), deterministic tie-break (smallest
  rotation). Unequal: the λ_e edit DP from the doc, exact integers,
  `λ_e = round(0.4 × meanIOIslots)` per its scale-free caveat, rotations
  enumerated, ties by rotation then lexicographic backtrack (pinned).
- One Morph operation recomputes the deterministic alignment, then performs
  the first remaining micro-step: move one matched attack by one slot on its
  shortest circular arc; once co-located, adopt its target duration/class; or
  insert/delete one unmatched attack. It never emits an interpolated or
  phantom onset.
- Pacing reuses the directive's ordinary quota machinery. Per-cycle ranges
  recompute the remaining micro-step count; Linear and Ease-in/out freeze one
  finite target at the range start and distribute it through the existing
  integer `RangeAccumulator`. The endpoint tests pin exact target equality,
  including a palette-enabled spanning 5:2 target. Perceptual magnitude uses
  the same one-step path and chooses its nearest admissible prefix. Remaining
  transport/edit work is monotone; model-`v1` perceptual distance itself is
  not claimed to be a monotone geodesic.
- Guards: density/complexity corridors, scope, projection, and the tie fence
  apply to every micro-step. A veto ends the current legal frontier and is
  traced; gradual pacing never repays failed work as a later catch-up burst.
- Roadmap note: this delivers the M6+ "morphing toward a second target
  pattern" item early, scoped to directives.

## 7. Phase 5 — UI

- **Generator editor**: palette chips (2/3/5/7 toggles) beside the
  structure row with the live working-grid readout and cap warnings;
  placementBias slider in the Depth card, with metric and void endpoints.
  The browser's display-only geometric mirror uses the Rust-emitted root
  vectors and the same integer recurrence to render the dynamic slot-field
  profile beneath the slider; it never evaluates independent trigonometry or
  participates in playback. The mean-complexity corridor and independent Depth
  diversity readout are labelled separately; realized State complexity is
  plotted in Evolve.
- **Evolve editor**: complexity band lane under Step size (realized
  `stateComplexityMilli` + corridor band, same cell code); Morph
  directive inspector (target pattern textarea with mirror validation +
  compiled-target mini block view reusing rhythm-builder blocks);
  directive options gain complexity overrides + placementBias +
  subdivisionLevel filter (`options.subdivisionLevel: Option<u32>` —
  restrict a directive's candidate slots to positions whose reduced
  denominator is divisible by that enabled palette prime; validation: level
  must be 2/3/5/7 and present in the palette).
- Inventory rows, UI_AND_INTERACTION, DUMKA_EVOLUTION operator-table
  updates; DUMKA_FIGURES note that fragment sizes now reach palette
  levels.

## 8. Parity, fixtures, invariants, bench (non-negotiable checklist)

- TS mirrors: required/working structure, Morph validation messages, and the
  display-only fixed-point geometric tables/orders. Rust emits the root
  vectors, order cases, blend endpoints, and the `W = 8`, `k = 4`
  `[0, 4, 1, 6]` fingerprint into the metrics contract; TypeScript advances
  the same recurrence rather than evaluating trigonometry. Complexity and
  diversity remain backend-owned preview values. Two-way DTO fixtures pin the
  exposed fields.
- Mock: refuses any folded cycle (already does); validates every new
  param with pinned messages at cycle 0 (close the audit's plan-
  validation gap as part of Phase 0).
- DTO/patch fixtures both directions + no-op proofs; STRIPPED_PATCH_KEYS
  screen for every new key (`subdivisionPalette`, `placementBias`,
  `complexityFloor/Ceiling`, `morphTarget`, `subdivisionLevel`,
  `workingSubdivision`, `stateComplexityMilli`,
  `stateDepthDiversityMilli`, `complexityCorridor`);
  v1 shape-validator allowlists extended.
- Invariants strategies draw palettes/bias/corridors/morph targets from
  the fuzz pattern set; `parallel_transport_queue` arm extended;
  `dumka_dsl_parse` untouched.
- Goldens: `dumka_palette_triplets` (palette {3}, curve on — audible
  ternary emergence), `dumka_morph` (pinned morph trajectory).
- Bench: fold-to-10k with palette {2,3} + bias 50 + curve; budget note.
  Spectrum incremental updates keep per-candidate cost O(M); document
  measured numbers next to the existing corridor baseline. The implemented
  `generator/dumka-depth-fold-cycle-10000` case uses working Subdivision 24
  and a nonzero curve tail that stays inside the 4,096-score lifetime budget;
  one local release iteration measured 57.170 ms (checksum 57). The separate
  density-corridor plan's documented median is ~10.66 ms; both are report-only
  machine measurements rather than CI thresholds.
- PROPTEST_CASES=2048 sweep on invariants before calling it done (the
  rotation-wrap bug was found at 2048, not 256 — treat that as the
  minimum bar for lattice-affecting changes).

## 9. What this deliberately does not do

- No off-lattice (continuous) onsets, no float state: the source doc's
  unquantized torus is future work gated on the platform upsample
  extension; the palette covers the musically demanded cases within
  Subdivision ≤ 64.
- No Model C wander family yet (metrics land, operator deferred).
- No diversity corridor. `stateDepthDiversityMilli` is observability only;
  mean depth remains the one enforced complexity rail.
- No changes to perceptual model v1 weights (immutable; findings feed v2
  calibration per DUMKA_PERCEPTUAL_DISTANCE.md's MLDS protocol).
- No relaxation of: one seam, tie handshake, corridor/plan/leash
  precedence, identity-seeded draw discipline, loud-mock rule.

## 10. Acceptance (the user-audible exits)

1. Seed `dum . ka .` (subdivision 1), palette {2,3}, complexity ceiling
   ramped 0→60% over 24 cycles by directives, curve 2.0→6.0: by ~cycle
   12 the piece audibly contains 8th-note and triplet material it could
   never have reached before, arriving gradually, with every cycle inside the
   reachable complexity band or carrying explicit clamp truth, and with step
   size tracking the curve.
2. Same seed, bias 0 vs bias 100 at fixed density: bias 0 adds land on
   strong beats; bias 100 adds land in gaps and the Sioros syncopation
   readout (perceptual breakdown) visibly rises. Both replay
   byte-identically from their seeds.
3. A Morph directive from the seed to `[x x x x x]@2 …` over cycles
   5–20 reaches the target exactly at 20, monotonically, with cardinality
   honest at every intermediate cycle (no phantom onsets).
4. Scenario 1's per-cycle complexity trace `ΔC(c)` never exceeds the
   §4d analytic bound; every out-of-band state names the active clamp and
   cannot be driven farther outside by operator work. Disabling the floor
   reproduces today's grid-locked behavior byte-for-byte on an empty palette
   (the negative control).
5. Two states can have comparable `C` but visibly different `D`: a uniform
   denominator inventory reads `D = 0`, while a mixed beat/binary/ternary
   inventory reads positive. Changing `D` alone never admits, rejects, or
   reorders an evolution candidate.
