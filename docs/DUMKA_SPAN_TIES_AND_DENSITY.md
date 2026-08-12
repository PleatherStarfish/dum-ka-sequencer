# Design note — M3.9 "Tied spans and the density corridor"

Status: **architecture, not implemented.** The lasting fix for the two
reported timeline defects: (1) tuplets that sustain across beat
boundaries are rejected with structure warnings; (2) after some cycles of
evolution the music becomes faster and more subdivided than intended.
Both are root-caused below to seam-level policy choices — **not**
transport defects — and both fixes live inside the generator seam and the
evolution fold. Transport is explicitly not redesigned; §5 carries the
evidence that it is the healthy organ.

## 1. Root causes, with the evidence chain

### Bug 1 — "tuplets still throw warnings across beat boundaries"

The platform's cell model has carried cross-cell ties since M1:
`ResolvedRhythmCell { tied_from_previous, tied_to_next }`. The overlay
already plays them: `emit_rhythm_overlay_events` merges a
`tied_from_previous` cell into the active note group
(cseq-transport/src/overlay.rs, the `!cell.tied_from_previous` branch),
and `append_rhythm_cells` emits one flat, time-ordered cell list across
all spans, so a tie at a span boundary merges exactly like a tie inside
one. Downstream is safe by construction: channel hocket, Channel Logic,
and triggers consume **merged queued notes**
(`capture_note_groups_local` pairs note-on/note-off from the queue),
never raw cells. Velocity and pitch of a merged note come from its
opening cell's leaf — a tie inherits its opener, which is already the
sustain semantics.

What actually forbids the spanning tuplet is two lines of policy:

1. `resolve_seed_cells` (dumka tree.rs) **errors** ("a note sustains
   across the span boundary at beat N…") instead of emitting a tied cell
   pair.
2. `validate_generated_spans` (generators/mod.rs) rejects
   `tied_from_previous` on any span's first cell (`CrossSpanTie`) — the
   M1 conservative fence, adopted before the overlay's tie handling had
   generator traffic.

Every symptom the user has hit traces here: the builder's forced
"articulate" repairs, the `[[dum .] [ka .]…]@2` idiom being mandatory
instead of stylistic, the Grouping-tile ceiling, Fragment/Euclid `Tied`
results being trial-projection-vetoed on per-beat structures — and the
"more subdivided than intended" *feel*, because everything that wanted
to sustain is forced into one-slot chains.

### Bug 2 — "after a few bars it gets faster and more subdivided"

The grid never changes mid-flight (evolution operates on the seed's
fixed `beats × requiredSubdivision` lattice; no operator can refine it).
What changes is **onset density and duration structure**, and nothing
bounds them:

- Fragment adds `k−1` onsets per application (`k` from a silent run),
  Euclid `invert` can jump `k → n−k`, Add adds; Remove/Consolidate
  default to weight 0. The growth direction is built in.
- Plan directives are **leash-exempt by design** (an authored pin must
  not be silently vetoed), and per-cycle ranges deliberately compound.
- Even the stochastic layer's drift leash measures **onset-set identity**
  against the seed (symmetric difference budgeted as % of *seed* onsets)
  — it is an identity rail, not a density rail, and it scales wrong as
  density grows.
- Forced articulation from Bug 1 doubles the perceived effect: the same
  onsets render and sound as staccato chains.

There is no invariant anywhere that says "stay near this density." That
is the missing piece, not a transport fault.

## 2. Part A — Tied spans (the platform extension, done as a handshake)

### Engine

- `resolve_seed_cells`: an event crossing one or more span boundaries
  emits a **tied chain** — `tied_to_next` on the closing cell of each
  span it exits, `tied_from_previous` on the opening cell of each span
  it enters — instead of the structure error. The diagnostic
  "split the note or keep the hold inside one beat or Grouping tile"
  is deleted. Crossing the **cycle boundary** remains impossible by
  construction (pattern events live in `[0, beats)`) and stays fenced.
- `validate_generated_spans`: `CrossSpanTie` becomes a **pairing
  handshake**, still fail-closed: a first cell with
  `tied_from_previous` is legal iff the previous span's last cell has
  `tied_to_next` and both are non-rest; a dangling tie on either side is
  the existing error. The very first span's first cell keeps the
  absolute fence (no wrap ties). Cursor contiguity, span identity, and
  len ≥ 1 rules are untouched.
- Trial projection: unchanged code, new reach — figure `Tied` results
  and cycle-scope reshapes on per-beat structures stop being vetoed
  because they now project. Evolution operators need **zero changes**;
  the state model was already cycle-native slots.

### Mirrors and UI

- `resolveDumkaCells` (ui/src/dumkaPattern.ts) mirrors the tied-chain
  emission; the Rust-generated parser contract fixture grows crossing
  cases so a one-sided change fails the parity gate; the mock stays
  bit-exact.
- Timeline lane: tied cells render joined (no boundary stroke, single
  rounded cap at chain ends) — one visual note, matching the one audible
  note. The generator-lane matra badges count the chain once.
- Rhythm builder: the mandatory repair flow becomes optional style
  ("Articulate" stays as a gesture; the tie-fence hint disappears). The
  syntax help and DUMKA_DSL.md "span ceiling" section are rewritten: the
  ceiling is gone; `x@2 _` inside per-beat structure simply plays.

### What stays an error (honesty preserved)

Subdivision incompatibility ("needs Subdivision 20 (or a multiple)"),
non-uniform per-beat rates, wrap ties, span identity/tiling violations.
The seam still never quantizes silently.

## 3. Part B — The density corridor

A new authored invariant with one job: **the onset density the author
set is the onset density the piece keeps**, no matter which layer
(stochastic, plan, or future families) is doing the evolving.

- Params: `densityFloor`, `densityCeiling` (percent of grid slots
  sounding an onset, 0–100; serde defaults 0/100 = corridor off ⇒ every
  existing trajectory byte-identical). Validation: floor ≤ ceiling.
  Cycle-start automation targets `generator.dumka.densityFloor` /
  `generator.dumka.densityCeiling` (registry 110 → 112), and
  per-directive `options` overrides in the plan.
- Enforcement, deterministic and traced, inside the fold:
  1. **Quota clamp** (primary): every operator application — stochastic
     or directive — computes its change and is clamped so the resulting
     onset count stays inside the corridor. A Fragment that would exceed
     the ceiling fragments into fewer pieces or is skipped; an Add at
     the ceiling is skipped; Remove at the floor likewise. Clamps are
     recorded in the trace (`CorridorClamped { limit }`) so the Evolve
     UI can show *why* a pin under-applied.
  2. **Normalization** (edge cases only): when the corridor itself
     moves (automation/plan) below the inherited state, a
     `normalize_to_corridor` pass — weakest-first removals or
     strongest-first adds, temperature 0, salted, trial-projected —
     contracts the state before the cycle's operators, exactly the
     `normalize_to_leash` pattern.
- Precedence, stated loudly in DUMKA_EVOLUTION.md: **corridor > plan >
  leash**. Directives override the leash (authored intent beats the
  safety rail) but never the corridor (the corridor *is* authored
  intent); the leash keeps governing only the stochastic layer's
  identity drift. Three rails, three distinct jobs: corridor = how
  dense, leash = how far from the seed, projection = playable at all.
- Surfacing: the corridor renders as a shaded band on the Evolve
  editor's density sparkline and on the Density insight card; the
  sparkline crossing the band is impossible after cycle 1, and the trace
  ticks explain every clamp.

## 4. Why this is lasting

Both fixes convert implicit policy into explicit, tested contract:

- The tie handshake makes the *data model's own* tie semantics available
  end-to-end; there is no second rhythm path, no transport change, and
  the class of "legal notation that cannot play on legal structure"
  errors is closed by construction, not case-by-case.
- The corridor is a fold invariant, so **every future operator family
  inherits it automatically** — a new op cannot reintroduce runaway
  density any more than it can emit an unplayable span.

## 5. Why transport is not redesigned

- Timing is exact and pinned: cell boundaries map through rational span
  geometry (`rhythm_cell_boundary_time`, incl. the native-matra path),
  and nine golden ledgers pin the audible output; none of the reported
  symptoms is a tick-level error.
- Ties already play correctly through the overlay merge; the queue and
  everything after it (hocket, triggers, MIDI) operates on merged notes.
- The "faster/more subdivided" percept is fully explained by density +
  articulation above, both of which live before transport.
Redesigning transport would rewrite the one layer with zero implicated
defects and put every golden, invariant, and parity fixture in play for
no mechanism gain. Rejected.

## 6. Test matrix

- **Byte-compat pins first**: all nine goldens, every pinned trajectory,
  and both DTO fixture directions unchanged with corridor off and
  non-crossing patterns (proves the relaxation is purely additive).
- Tie handshake: proptest over random patterns × structures (per-beat
  and Grouping-3) — every emitted chain pairs correctly, dangling ties
  impossible, `emit_rhythm_overlay_events` produces one note per chain
  with opener velocity/pitch; one hocket assignment per chain (queued
  note-group regression); wrap tie still errors.
- New golden `dumka_tied_quintuplet`: the literal user flow —
  `[x x x x x]@2` over per-beat Subdivision 5 — sustains audibly across
  the beat; ledger diff is the proof.
- Parser-contract fixture: crossing patterns added; TS mirror parity.
- Corridor: proptest — onset density inside `[floor, ceiling]` for every
  cycle ≥ 1 across random plans/rates/seeds; compounding-Fragment range
  against ceiling 60% plateaus (the reported bug, pinned as a test);
  corridor-move contraction determinism; replay; clamp trace entries.
- e2e: builder spanning tuplet plays *without* articulation (mock
  pattern allowlist + real lane); Evolve strip shows corridor band and
  clamp ticks (fixture-driven component test).
- Bench: fold-to-10k with corridor on (expect noise; the clamp is O(1)
  per application).

## 7. Delivery (7 commits, M2/M3 discipline)

1. `feat(rhythm)`: tied-chain emission in `resolve_seed_cells` +
   handshake in `validate_generated_spans` + compat pins.
2. `feat(transport)`: tie regression tests through overlay/queue/hocket
   (no production change expected — the commit is the proof).
3. `regen + feat(ui)`: TS mirror + parser contract fixture + timeline
   tie-joined rendering + builder de-mandating repairs + docs
   (DUMKA_DSL span-ceiling rewrite).
4. `feat(rhythm)`: corridor params/validation/clamp/normalize + trace
   entries + property tests.
5. `feat(transport+ui)`: corridor automation targets (110→112),
   EvolutionPanels + Evolve strip band, fixtures both directions.
6. `test(golden+e2e) + regen`: `dumka_tied_quintuplet` golden, corridor
   plateau test, e2e flows, bench note.
7. `docs`: DUMKA_EVOLUTION three-rails section; UI_AND_INTERACTION;
   EDITABLE_VALUE_INVENTORY rows; ROADMAP (M3.9 delivered; cross-span
   tie relaxation graduates out of the M6+ wishlist).

## 8. Open questions (recommendations inline)

- **Wrap ties** (last cell → cycle start): defer to M5 phrase drift,
  where cycle identity itself is in motion; fencing stays.
- **Corridor on stroke-class balance** (not just count): defer to M4
  bass payload, where classes become audible as pitch.
- **Upsample factor `k`** (true finer-than-grid tuplets): unchanged,
  still M6+, orthogonal to both fixes here.
