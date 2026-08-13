# Design note — M3.5 "Figures": fragmentation and consolidation

Status: **implemented** (M3.5; operators in
[figures.rs](../crates/cseq-rhythm/src/generators/dumka/figures.rs), wired
through [evolve.rs](../crates/cseq-rhythm/src/generators/dumka/evolve.rs)).
This note remains the design rationale; the operator table in
[DUMKA_EVOLUTION.md](DUMKA_EVOLUTION.md) is the running documentation.
One deviation from the plan below: only ONE new salt was needed
(`SALT_FIG_K`, the figure-size draw) — interval choice for both operators
reuses the temperature pool exactly like the Add/Remove candidate lists,
so `SALT_FIG_PICK`/`SALT_CONS_PICK` never materialized.

## What exists already, precisely

- **"Filling a rest with a note" ships today**: Barlow **Add** sounds the
  most indispensable silent pulse (sustains block it) as a one-slot hit.
  What Add cannot do: re-articulate a **sustain**, fill a rest with a
  **multi-onset figure**, or place anything **longer than one slot**.
- **Remove** thins; **Rotate** phases; the **Sioros pair** displaces.
  No operator changes the *duration structure* — the fold's onset count can
  drift but a long note can never become a run, and a run can never fuse.
  That is the gap the user hears as "the most obvious transformations are
  missing."

## Literature mapping

| Gesture | Published grounding | What we take |
|---|---|---|
| Split one note into several shorter ones / merge several into one | Mongeau & Sankoff 1990, *Comparison of Musical Sequences* — **fragmentation** and **consolidation** as edit operations distinct from insert/delete, the most-cited similarity ops in MIR | The operator pair's names, semantics, and its exact-inverse framing |
| Where to elaborate, hierarchically | Lerdahl & Jackendoff 1983 (GTTM) **time-span reduction**; Gilbert & Conklin 2007, *A PCFG for Melodic Reduction* (repeat/neighbour/passing elaborations learned as a grammar) | Reduction grammars run backwards are elaboration grammars: fragmenting a whole group is the same rule applied at a higher time-span level — no new machinery, larger interval |
| Which pulses deserve onsets | Barlow 1987 indispensability (already pinned in `barlow.rs`); Sioros & Guedes 2011 **kin.rhythmicator** (NIME) — stochastic generation with per-stratum density, metrical strength, and syncopation knobs | Interval choice and interior onset placement rank by the same indispensability tables the Add/Remove family already uses; density-per-metrical-level is the published precedent for "fill toward the meter" |
| "Tuplet of a certain complexity" on a fixed grid | Bjorklund/Toussaint Euclidean rhythms; Demaine et al., maximal evenness (already used by `E(k,n)` sugar and the builder's E-fill) | `k` onsets across an `n`-slot interval: when `k ∣ n` the split is a true equal tuplet; otherwise `E(k,n)` is the **maximally even on-grid approximation** — documented, never silently quantized |
| Syncopating the new figure | Sioros 2015 dissertation ch. 4 (already implemented in `sioros.rs`); its compound transforms are ordered vector arrays | New onsets land on the metrical template and are immediately reachable by the existing Syncopate/Desyncopate operators — composition for free; a fused "fragment-then-anticipate" compound is future work, cited, not needed for v1 |

The platform invariant stays supreme: generators cannot emit off the resolved
working grid. M3.95's authored subdivision palette now refines the seed onto
that grid before evolution, so Fragment can create true binary, ternary,
quintuplet, or septuplet positions when the selected palette makes them exact
and the resulting Subdivision stays at most 64. Without a palette, the legacy
seed grid is unchanged. `E(k,n)` remains exact when `k` divides `n` and the
maximally even on-grid figure otherwise; continuous/off-lattice timing remains
outside the platform contract. See [DUMKA_TREE_DEPTH.md](DUMKA_TREE_DEPTH.md).

## The operator pair

**Fragment** — choose a *maximal uniform interval*: either one sounding
note (onset + its sustain, length `n ≥ 2` slots) or one maximal rest run
(`n ≥ 2`). Draw a figure size `k` (2..=n). Replace the interval with onsets
at the `E(k, n, 0)` positions; each fragment sustains to the next fragment
boundary. A fragmented note keeps its stroke class on the first fragment
(the rest inherit it); a fragmented rest run becomes sounding figures that
inherit the preceding stroke class (Add's rule, generalized).

**Consolidate** — exact inverse: choose a maximal run of ≥ 2 consecutive
sounding fragments with no interior rest, and merge it into one note
(first onset's class, combined duration). Fragment ∘ Consolidate on the
same interval is the identity; the reversibility property test mirrors the
Sioros exhaustive round-trip.

Determinism: interval choice, `k`, and direction each draw from
identity-seeded salts (`SALT_FIG_PICK`, `SALT_FIG_K`, `SALT_CONS_PICK`,
next values in the 0xD0A1_5EED block), keyed `(seed, cycle, salt)` like
every other decision — never draw-order coupled.

### Policy knobs

- `weightFragment`, `weightConsolidate` — two new operator-family weights,
  serde defaults **0** (opt-in; the pinned default trajectory stays
  byte-identical, same as the Sioros rollout).
- `fillComplexity` (0–100, cycle-start automation like rate/leash/
  temperature): biases the `k` draw — 0 prefers the simplest legal split
  (k = 2, and divisor `k`s before non-divisors), 100 approaches uniform
  over 2..=n. Same integer-band construction as the temperature pool; no
  float transcendentals.
- Interval choice reuses **barlowTemperature**: candidate intervals rank by
  the indispensability of their strongest interior silent pulse (fragment)
  or weakest interior onset (consolidate); the temperature pool widens the
  candidate set exactly as it does for Add/Remove.

### Guards (unchanged machinery, new accounting)

- **Leash**: the onset-set symmetric difference already covers figures —
  fragmenting a note adds `k − 1` onsets, fragmenting a rest run adds `k`,
  consolidation subtracts the same; no metric change, only tests.
- **Trial projection**: a sustain may cross structural spans as a paired,
  sounding tie chain. The op is skipped only when its result is genuinely
  unprojectable (broken tiling, incompatible grid, overlap, or malformed tie),
  preserving the same stall-not-break rule as every other family.
- **Interval overlap**: operates only on maximal intervals, so figures can
  never overlap existing onsets by construction; the existing disjointness
  guard stays as the belt-and-suspenders check.

### Hierarchy ("splitting a larger grouping")

No special case: an interval spanning several beats is just a larger `n`.
The GTTM framing says why this is enough — elaboration at a higher
time-span level is the same rule with a bigger window. The recursion the
user describes (rest → note → figure → syncopated figure) emerges from
repeated cycles: Fragment creates material, the Barlow family densifies or
thins it, the Sioros pair displaces it, Consolidate can fuse it back.
Every step remains individually reversible and leash-charged.

## Delivery plan (one milestone, M2/M3 choreography)

1. `feat(rhythm)`: `figures.rs` — interval scan, E(k,n) placement, the
   pair, salts; unit tests incl. exhaustive fragment/consolidate round-trip
   and E-divisor exactness.
2. `feat(rhythm)`: wire into `evolve.rs` step + weights + fillComplexity
   sampling; params/validation in `mod.rs` (screen names against
   `STRIPPED_PATCH_KEYS`); invariants strategies extended; pinned
   default-trajectory test proves byte-compat.
3. `feat(transport+ui)`: `generator.dumka.fillComplexity` cycle-start
   automation target; bridge/patch/App/EvolutionPanels (a "Figures —
   fragmentation" card: two weights with odds, complexity slider, interval
   candidates highlighted on the existing rank lane); fixtures both
   directions with no-op proofs; mock stays loud on evolving cycles.
4. `test(golden) + regen`: a figures-on trajectory golden with the musical
   explanation in the commit body; bench note if fold cost moves.
5. `docs`: DUMKA_EVOLUTION operator table + this note flips to
   "implemented"; UI_AND_INTERACTION; EDITABLE_VALUE_INVENTORY rows.

Open decision (recommendation inline): whether Fragment may also target
the **pattern's rests inside an otherwise sounding beat** when the rest run
is length 1 (k = 1 degenerate = exactly Add). Recommended: no — keep Add
as the one-slot specialist so the families stay audibly distinct and the
draw bands stay interpretable.

## References

- Mongeau, M., & Sankoff, D. (1990). Comparison of Musical Sequences.
  *Computers and the Humanities*, 24(3), 161–175.
- Lerdahl, F., & Jackendoff, R. (1983). *A Generative Theory of Tonal
  Music.* MIT Press (time-span reduction).
- Gilbert, É., & Conklin, D. (2007). A Probabilistic Context-Free Grammar
  for Melodic Reduction. IJCAI-07 Music-AI workshop.
- Sioros, G., & Guedes, C. (2011). Automatic Rhythmic Performance in
  Max/MSP: the kin.rhythmicator. *NIME 2011*.
- Sioros, G. (2015). *Syncopation as Transformation.* PhD diss., U. Porto,
  ch. 4 (already implemented in `sioros.rs`).
- Toussaint, G. (2005). The Euclidean Algorithm Generates Traditional
  Musical Rhythms; Demaine et al. (2009), The Distance Geometry of Music.
- Barlow, C. (1987). Two Essays on Theory. *Computer Music Journal*, 11(1)
  (already implemented in `barlow.rs`).
