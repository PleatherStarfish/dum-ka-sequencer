# Roadmap

Dum-Ka's charter: author a **seed rhythm** for the first cycle in a small tree
notation, then let the sequence **evolve** cycle by cycle through
deterministic, seeded transformations drawn from the rhythm-mathematics
literature (see [PRODUCT_VISION.md](PRODUCT_VISION.md) for the mapping).
Everything ships through the platform's one generator seam
([ADDING_A_GENERATOR.md](ADDING_A_GENERATOR.md)); no parallel preview,
scheduler, or persistence paths.

The previous roadmap in this file described the Caesura-era research feature
set and predated the extraction; it is superseded by this document.

## Phase 0 — Repository charter (done, 2026-08-10)

- proj-managed launcher adopted; registry block 38900.
- Inherited launch cruft removed.
- Dum-Ka product identity taken (name, bundle id, `.dumka`/`.dumka-track`,
  "Dum-Ka MIDI", `dum-ka-ui`); historical docs retain Seqstart naming.
- This charter and the vision rewrite.

## M1 — The seed cycle plays

A new `dumka` generator whose config carries a **pattern** string:
weighted proportional trees (`[dum@3 ka] [. ka] [dum ka dum ka dum]@2`),
where group weights express arbitrary tuplets starting anywhere and spanning
any number of nodes; `.` rests, `_` holds, `E(k,n)` Euclidean sugar. The
compiler derives the required structure (cycle beats, per-beat Subdivision =
LCM of the pattern's denominators, capped at the platform's 64) and the
editor offers one-click "Apply structure". Platform validation restricts
Grouping tiles to 3/4/5/6/7/9/11 steps, so in M1 a sustain lives inside one
beat (or one authored Grouping tile); a hold that would cross a span
boundary is a specific diagnostic, and relaxing the cross-span tie fence is
the named platform extension that would lift the ceiling (tracked for
M2/M3). Structure mismatches and parse errors are specific `GeneratorError`s
with pinned formats; nothing quantizes silently.

Exit: a pattern with a mid-tree quintuplet plays correctly through the
built-in synth (holds within their beat sustain; a crossing hold reports its
diagnostic); the timeline generator lane shows the cells; parse errors
render at the textarea; all gates green.

## M2 — It evolves (shipped 2026-08-10)

Pure-fold evolution: cycle N is a fold of identity-seeded operators over
cycles 1..=N (Locked seed = one deterministic trajectory; byte-identical
replay, fuzzed through the seed-path invariants). Shipped operators, per
the research survey's Stage 1–2 recommendations
([DUMKA_EVOLUTION.md](DUMKA_EVOLUTION.md)):

- **Barlow indispensability** add/remove (density change that preserves
  metric feel), ranks pinned against the published tables.
- **Rotation** (beat-class transposition) via a whole-beat register.
- **Drift leash** bounding add/remove distance from the seed, plus trial
  projection so no operator can ever make the pattern unplayable.

Params `evolutionRate`/`driftLeash` with `generator.dumka.*` cycle-start
automation. Fold cost measured at ~17 ms to cycle 10,000 (cseq-bench).
Deviation: Euclidean reshape and the Barlow field-strength temperature
moved to M3 so each shipped operator's character stays audible.

## M3 — Displacement and feel (delivered)

The Sioros–Guedes syncopate/de-syncopate operator pair (reversible, local,
metric-template-driven; implemented from the dissertation with two
documented reconciliations — see
[DUMKA_EVOLUTION.md](DUMKA_EVOLUTION.md)), per-family operator weights
whose defaults preserve M2 trajectories bit-exactly, Barlow temperature as
deterministic pool widening with cycle-start automation, and the
`dumka_dsl_parse` fuzz target with a seeded corpus.

## M3.5 — Figures: fragmentation and consolidation (delivered)

Duration-structure operators: Fragment (a held note or rest run becomes an
E(k,n) figure over its own slots; true tuplets when k divides n) and
Consolidate (its exact inverse), with a fillComplexity knob and interval
choice ranked by the same indispensability tables as Add/Remove. Design
note first: [DUMKA_FIGURES.md](DUMKA_FIGURES.md) (Mongeau–Sankoff
fragmentation/consolidation; GTTM elaboration; kin.rhythmicator density).
At M3.5 this remained limited to the seed grid; M3.95 later supplied an exact
prime-refined working grid within the existing Subdivision-64 ceiling.

## M3.75 — The evolution score (delivered)

Planned, scoped, visual evolution ships as pins and ranges on a cycle timeline
(each naming an operator family, a deterministic intensity quota, and an
optional beat-range scope), executed by the same pure fold with
error-diffusion pacing, a per-cycle applied/skipped trace through the
preview DTO, and a lane-per-family Evolve editor with a composition
strip. The plan persists in v1 patches, preview exposes directive trace while
transport stays on the common span-only DTO, and an empty plan preserves the
legacy fold. Full architecture and exact semantics:
[DUMKA_EVOLVE_PLAN.md](DUMKA_EVOLVE_PLAN.md).

## M3.8 — Gradual evolution pacing (delivered)

Evolution ranges can preserve M3.75's **Repeat each cycle** behavior or
distribute one fixed start quota through a **Linear transition** or **Gentle
transition**. The schedules use exact integer cumulative progress, resolve
through the same pure fold for stopped preview and playback, and keep missing
`pacing` byte-compatible with older plans. This is operation pacing rather
than a continuous audio crossfade: families such as Rotate, Fragment,
Consolidate, and Euclid can still make a broad structural change in one legal
application. Exact semantics and trace/UI constraints remain in
[DUMKA_EVOLVE_PLAN.md](DUMKA_EVOLVE_PLAN.md).

## M3.9 — Tied spans and the density corridor (delivered)

The cross-span tie fence is now a fail-closed pairing handshake (the overlay
merges tied cells; sustained tuplets across beats are legal end-to-end, and
the articulated idiom is a style instead of a requirement). The automatable,
plan-aware density corridor now makes onset density an enforced fold invariant
with corridor > plan > leash precedence and additive clamp trace. Transport
production code remained untouched; the evidence and implementation contract live in
[DUMKA_SPAN_TIES_AND_DENSITY.md](DUMKA_SPAN_TIES_AND_DENSITY.md).

## M3.95 — Depth: subdivision palettes, geometric placement, transport morphing (implemented)

Evolution escapes the seed's frozen lattice: an authored prime palette
refines the fold's working grid (projection already accepts multiples —
zero transport surgery), a complexity corridor rails how much new-level
material may exist, a fixed-point geometric placement field gives
Add/Remove a void-seeking order blendable against Barlow (the
syncopation-aware chooser), and an exact integer transport morph
directive delivers directed gradual movement toward a target pattern.
Promote/Demote follows the cheapest positive depth-price step before
displacement, preventing nearest-slot jumps straight to exotic composite
denominators. An orthogonal normalized denominator-entropy readout exposes
mixed-depth variety without making an uncalibrated diversity rail. Spectral
placement is deliberately distinct from Bjorklund/Euclid and its agreement and
divergence fingerprints are pinned separately. Full implementation reference:
[DUMKA_TREE_DEPTH.md](DUMKA_TREE_DEPTH.md).

## M4 — Bass payload (the one platform extension)

Optional per-cell `accent_class`/`pitch_degree` honored through
overlay → realize → MIDI; scale model; pitch operators (indispensability-
anchored roots/fifths, seeded walks). The DSL's stroke classes (`dum`, `ka`,
…) become audible. Full DTO/patch/golden churn, each regen atomic with a
musical explanation.

## M5 — Phrase drift (evolving cycle length)

Phrase lengths evolve by Messiaen added/subtracted values and stream across a
fixed super-cycle (wrap state in the fold) — the heard cycle drifts while the
transport cycle stays fixed. Design note first (`DUMKA_PHRASE_DRIFT.md`).

## M6+ — Unscheduled

- DFT layer: evenness / perfect-balance meters; spectral leash.
- Calibrated depth-diversity rail, if listener/audition evidence justifies
  promoting the current insight-only entropy statistic.
- Rotation canons across parallel tracks (per-track T_k).
- Tiling-canon catalog (Vuza) for long-span structure.
- Platform extensions only if proven necessary: integer upsample factor `k`
  on generated spans (finer-than-authored grids). (Cross-span tie
  relaxation graduated to M3.9.)

## What not to do yet

- Transport-level variable cycle lengths (unless M5 proves musically
  insufficient — it is deep surgery against the accepted architecture).
- Registry/plugin hosts, DAW/piano-roll views, cross-platform work.
- Backporting to `carnatic-seq` (findings go to
  [UPSTREAM_FINDINGS.md](UPSTREAM_FINDINGS.md)).
