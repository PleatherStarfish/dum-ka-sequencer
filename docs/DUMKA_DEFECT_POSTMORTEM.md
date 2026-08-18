# Post-mortem: how the generative-procedure defects escaped

Two critical bugs shipped in the evolution engine and survived a verification
ladder of ~790 Rust tests, 17 golden ledgers, a 10-property fuzz suite, and
~1,040 TS/e2e tests:

1. **Pacing collapse** — a drawn step-size curve satisfied large targets by
   mass deletion; patterns decayed to a single downbeat onset and stayed
   there (the walk ignored the drift leash, and its per-cycle re-anchoring
   ratcheted density one budget per cycle).
2. **Figures never fired** — the Fragment operator (division into 3/4/5)
   silently no-opped on essentially every realistic config (deterministic
   argmax picked a silence whose fill exceeded the leash; the rejection
   produced no trace and no fallback).

Both escaped for the same three reasons. Each now has a structural defense.

## Hole 1 — the fuzz strategy lagged the feature set

`dumka_params_strategy` (invariants.rs) hardcoded
`evolution_curve: EvolutionCurve::default()` — the pacing curve was **off in
every one of the 2048 cases** of every sweep ever run. The collapse lived
exclusively behind `curve.enabled = true`, so the sweep could not have found
it at any case count. The same pattern was called out for property curves in
the M3.97 audit (PC-15) and partially fixed; the curve stayed dark.

**Defense**: the strategy now draws the pacing curve (enabled flag, target,
tolerance, span), with a comment pinning the rule. **Process rule: a feature
flag ships in the same commit that adds it to the invariants strategy.** A
flag the fuzzer cannot flip is a flag the fuzzer certifies untested.

## Hole 2 — every invariant was consistency-shaped; none was musical

The suite proved determinism, replay byte-identity, disabled-path
byte-identity, and preview/MIDI parity — all of the form "the engine agrees
with itself". A pattern deterministically collapsing to one onset passes
every one of those properties, byte-identically, forever.

**Defense**: the first *bounded-musical-state* property,
`stochastic_layers_hold_the_leash_count_floor` — with directives absent and
the corridor open, no stochastic layer may pull sounding onsets below the
seed anchor minus the leash budget, across the whole fuzzed config space.
More bounds should join it (complexity corridor honesty, occupancy sanity)
as features stabilize.

## Hole 3 — silent no-op paths made stalls invisible

The classic step had ~14 `return (current, normalization_trace())` sites —
no-ops that emit **no trace** (`normalization_trace()` is `None` unless a
corridor clamped). Worse, a *successful* stochastic op also traced nothing
unless clamped. Applied and permanently-stalled were therefore
indistinguishable — in tests and in the Evolve inspector alike. Unit tests
proved operators correct *when called* (figures.rs round-trips pass); nothing
proved they were ever *reached*: liveness was untested everywhere, and
temperature-0 determinism turns one inadmissible pick into a permanent stall.

**Defenses**:

- Applied stochastic ops now always trace `requested 1, applied 1`; a
  leash-rejected draw traces `requested 1, applied 0, skipped exhausted`
  (evolve.rs). Stalls are visible to the preview and assertable by tests.
- `operator_liveness_tests` (dumka/mod.rs): every operator family, soloed on
  material designed for it, must visibly apply within 16 cycles — the test
  shape that catches "correct but unreachable" on day one. A scoped-rotate
  stress over tie-heavy material additionally pins honest skips and span
  tiling.
- `depth_reachability_tests` and `curve_leash_tests` (dumka/mod.rs) pin the
  two escaped bugs specifically, through all three paths (classic, pacing
  walk, steering).

## New finding from the extended sweep: unbounded Morph cost (open)

The first 2048-case sweep over the extended space burned 55+ minutes at 100%
CPU inside `parallel_queue_is_structural_and_reapply_stable`. A process
sample located the tail: `apply_directive → directive_candidate_count →
morph_schedule` (+ per-candidate trial projection) — rare authored Morph
configurations cost **minutes per resolve**, and `directive_candidate_count`
re-runs the morph scheduler each call while the historical fold re-pays it
per cycle. `MAX_MORPH_ALIGNMENT_WORK` does not bound the folded total. Since
resolves run on the preview path, a pathological authored plan can freeze
the preview. Tracked as its own task (bound/memoize the schedule, add a cost
regression); until it lands, the deep-sweep tier for `parallel_queue` is
512 (57 s) and 2048 for the other ten properties (110 s).

## What the hunt re-checked (and found healthy)

- Scoped/windowed Rotate over boundary-crossing sustains: applies where
  containment allows, skips honestly, never breaks span tiling
  (8 seeds × 4 scopes × 16 cycles, plus the liveness matrix).
- Global rotation + sustains: wrap-fence rejections are honest; no resolve
  errors.
- Syncopate/Desyncopate saturate against the leash and now trace the stall
  instead of hiding it.
- All eight families pass liveness; Consolidate converges (runs merge until
  none remain ≥ 2) and now traces while active.

## The rules going forward

1. New authored knob or feature flag ⇒ same-commit strategy coverage in
   `invariants.rs`.
2. New operator or steering behavior ⇒ same-commit liveness test (it must
   *visibly apply* under an enabling config, not merely be correct when
   invoked directly).
3. No silent no-op paths: an operation that fires must leave a trace entry,
   applied or skipped. `normalization_trace()`-style `None` returns are for
   cycles where nothing fired at all.
4. Deep sweeps (`PROPTEST_CASES=2048`) remain the bar for lattice- or
   walk-affecting changes — but only after 1–3, because a sweep over a space
   with hardcoded feature flags certifies nothing about those features.
