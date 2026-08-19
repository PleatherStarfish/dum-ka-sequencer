# Design: user-authored strong/weak beats (Metric Profile)

Status: design note, not yet scheduled. Follows the unit discipline
(byte-compat proofs per unit) and the prevention rules in
DUMKA_DEFECT_POSTMORTEM.md.

## The diagnosis, stated precisely

The engine is not missing a strong/weak concept — every algorithm already
runs on one. What is missing is any way for the **user** to author it.

Today "strong" means exactly one thing: **Barlow indispensability derived
from the prime-factor stratification of the meter**
(`stratification(total_beats, W)` → `indispensability` → `ranks`, plus
`metrical_levels` → the Sioros template). Two consequences:

1. Every piece in a given meter has the **identical** metric hierarchy.
   4/4 always ranks beat 1 > beat 3 > beat 4 > beat 2, downbeat above
   pickup, and so on — Barlow's Eurologic default.
2. Music whose felt anchors are not the notated meter's — clave and other
   timelines (tresillo anchors at 3+3+2), tala angas with their own
   strong/weak beat structure, backbeat-centric feels — cannot tell the
   evolution where its accents live. The generator will forever "correct"
   toward the textbook hierarchy: Remove eats the very onsets the style
   treats as anchors, Add fills textbook-strong slots the style leaves
   empty.

The reach of this single derived hierarchy is total. `ranks`/`template`
are built at one construction seam in the fold (evolve.rs, immediately
after `stratification`) and flow by reference into:

- BarlowAdd/BarlowRemove candidate order (`blended_candidate_order`,
  already a blend of ranks with the geometric void field via
  `placementBias` — the integer-blend precedent this design reuses);
- Fragment interval ranking (strongest interior pulse) and Consolidate
  (weakest attachment);
- Euclid reshape window ranking;
- density-corridor and leash normalization (weakest-first removal,
  strongest-first restoration);
- Sioros syncopate/desyncopate legality and targets (via the level
  template);
- the perceptual distance model (`PerceptualContext::new` consumes the
  same ranks/levels for salience weighting);
- the UI's rank lane (the TS Barlow mirror in dumkaMetrics renders the
  same order the engine uses).

That seam concentration is the good news: author-ability lands in one
place and upgrades every algorithm at once.

## What the user authors

Two layers, both optional, both persisted with the generator config:

```jsonc
"metricProfile": {
  // Layer 1 — one weight per top-level beat of the seed (0-100).
  // Orders the beats; Barlow continues to order pulses WITHIN a beat.
  "beatWeights": [100, 20, 60, 85],          // e.g. backbeat-leaning 4/4
  // Layer 2 — explicit sub-beat anchors on the SEED grid (beat, slot,
  // weight). This is how a timeline/clave marks a strong point that is
  // not on any beat: tresillo = anchors at 1.0, 1.75(→slot), 2.5 …
  "anchors": [ { "beat": 1, "slot": 3, "weight": 95 } ]
}
```

- Absent profile ⇒ derived Barlow, byte-for-byte — the compatibility
  anchor, same pattern as every prior feature.
- Stored on the **seed grid**, not the working grid: a palette change
  refines each seed slot into children deterministically (children keep
  Barlow order among themselves under the parent's authored weight), so
  enabling `{3,5}` never orphans the profile.
- Default for new configs can be **derived from the authored score
  structure**: Grouping/jathi span starts already encode the tala's
  strong points on the platform side (they shape accent velocity today).
  Seeding `beatWeights` from those spans makes the generator tala-aware
  out of the box while staying fully overridable.

## How it becomes ranks (deterministic, integer-only)

One new pure module, `metric.rs`:

```text
effective_rank_key(slot) =
    weight_of(slot) as u64 * SCALE      // authored layer: beat weight,
                                        // overridden by an exact anchor
  + barlow_rank_within_tier(slot)       // derived layer: Barlow breaks
                                        // ties inside equal weights
→ sort desc, tie-break by slot → a PERMUTATION 0..slots
```

Rules that keep the engine's discipline intact:

- **Permutation invariant**: effective ranks are always a total order
  (property-tested; `pool_pick` index 0 must remain a unique argmax).
- **Integer only**, same as `placementBias` blending — no float in any
  decision path; byte-identical replay preserved.
- The profile transforms ranks **once at the seam**; no operator learns
  a new parameter. Every consumer listed above inherits the authored
  hierarchy for free.

Two consumers need explicit decisions rather than free inheritance:

1. **Sioros template.** Syncopation legality ("anticipate N levels
   faster") is structural — it comes from the strata, not the rank
   order. v1 of this feature keeps the template derived: authored
   weights re-rank *which* syncopation targets are preferred, but what
   *counts* as a syncopation stays on the published Sioros basis.
   Deriving levels from authored weights (thresholding into tiers) is a
   possible v2 with its own listening tests.
2. **Perceptual model.** v1 weights are pinned and calibrated against
   derived Barlow salience. The seam therefore splits: operators receive
   effective ranks; `PerceptualContext` keeps receiving **derived**
   ranks until a calibrated v2 says otherwise. Documented consequence:
   pacing distance measures change against the notated meter, not the
   authored one. (Folding the profile into a `PerceptualModelVersion::V2`
   is the eventual fix, gated on the MLDS protocol in
   DUMKA_PERCEPTUAL_DISTANCE.md.)

## UI

The panel already renders the exact object the user needs to touch: the
**rank lane** (RankLane in EvolutionPanels, "Remove pool / Add pool"
readouts). The profile makes it editable:

- drag a beat header to set its `beatWeights` entry; drag an individual
  bar to place/remove an anchor — direct manipulation of the same lane
  the engine draws from, with the Remove/Add pool outlines recomputing
  live (the TS Barlow mirror gains the same `metric.rs` transform,
  contract-tested against pinned Rust vectors like the rest of the
  mirror);
- a "derived from score structure / custom" chip so it is always legible
  whether the hierarchy is authored, exactly like the algorithm switches
  make layer participation legible.

Not automatable in v1 (it is structural, like the pattern). A later
milestone can morph between profiles per cycle via a directive — metric
modulation as an authored gesture.

## Staged plan (each unit lands with its proofs)

- **A — schema + math.** `MetricProfile` on the params (serde-defaulted
  absent), validation with pinned messages (weights 0-100, beat count
  match, anchor slots on the seed grid), `metric.rs` with the
  effective-rank builder. Tests: permutation property, absent-profile
  identity, pinned reorder vectors (backbeat and tresillo examples).
- **B — engine seam.** Thread effective ranks through the fold's two
  construction sites (operators + normalization + figures + reshape);
  perceptual context keeps derived ranks. Proofs: absent profile leaves
  every golden byte-identical; a pinned profile golden
  (`dumka_backbeat_profile`) shows Add filling authored-strong slots.
  Fuzz: profile drawn by `dumka_params_strategy` in the same commit
  (post-mortem rule 1); liveness suite unchanged (rule 2).
- **C — wire + persistence.** bridge.ts union, patch v1 normalizer
  (fail-open to absent), DTO fixtures both directions, mock validation
  parity for the pinned error strings.
- **D — UI.** Editable rank lane + weights row + provenance chip;
  TS mirror of `metric.rs` with contract vectors; panel tests; e2e
  authoring round-trip.
- **E — docs + calibration follow-up.** DUMKA_EVOLUTION knob section,
  UI_CONTROL_REFERENCE rows, GLOSSARY (Metric profile, Anchor); open a
  tracked item for perceptual v2.

## The other half: strength must reach velocity (Metric Dynamics)

Authorable or not, the hierarchy currently stops at PLACEMENT. The chain
for loudness is entirely authored-side today:

- `ResolvedRhythmCell.velocity` is explicitly display metadata: "Generators
  must leave this `None` and never read it … backfilled by the realization
  and preview seams, not generation identity" (cseq-rhythm/src/lib.rs).
- Realization inherits each cell's velocity from the authored leaf at/before
  the cell start plus the structural accent bands (beat/section/grouping
  starts, the `beatAccentMin/Max` family). Those bands know span starts —
  they know nothing about metric depth, and nothing about where evolution
  actually put onsets.

Consequence: an onset the fold deliberately placed on a strong pulse and a
grace-like hit on the deepest triplet slot sound identical (modulo a beat
boundary). Every generated cycle is dynamically flat inside the beat. This
is the M4 boundary from the charter ("Bass payload … accent_class honored
through overlay → realize → MIDI"), still unbuilt — and it is the natural
FIRST unit of this design, because it pays off with the derived hierarchy
immediately and the authored profile later just changes which hierarchy it
reads.

Architecture:

1. **Generator stamps strength.** Each sounding generated cell gains an
   optional `metricStrengthMilli` (0..=100_000: the onset slot's effective
   rank normalized over the working grid — derived Barlow today, the
   metric profile once it exists). Serde-defaulted absent; absent replays
   history byte-for-byte. This is generation identity — goldens change
   only when the feature is ON.
2. **Realization maps strength into the authored band, never past it.**
   One authored knob, `metricDynamics` (0-100, default 0 = today's flat
   output): at depth d, a note's velocity positions itself inside the
   structural accent band the authored layer already grants that position
   — strength 100_000 at the band ceiling, strength 0 at
   `ceiling − d% × band width`. The authored accent system stays the outer
   authority (Channel Logic, span accents, and existing bands keep their
   meaning); the generator only shades within it. Integer math throughout.
3. **Surface**: the timeline already renders per-cell velocity metadata,
   so display comes free; the generator editor gets the one knob (and a
   later automation lane, `generator.dumka.metricDynamics`, cycle-start
   sampled like its siblings).
4. **Proofs per the post-mortem rules**: knob drawn by the fuzz strategy
   same-commit; invariant that every emitted note-on stays inside its
   authored accent band at every depth; a pinned golden
   (`dumka_metric_dynamics`) whose commit body names the audible change;
   liveness untouched (dynamics never gates placement).

Ordering recommendation: ship Metric Dynamics (strength → velocity, one
knob) BEFORE the authorable profile. It is smaller, independently audible
on every existing patch, and it turns the profile — when it lands — into
something you can hear directly rather than only infer from placement.

## Open questions

- Should `beatWeights` allow ties (two beats equally strong)? The math
  handles it (Barlow breaks ties), musically it is meaningful — lean yes.
- Anchor semantics under Fragment: an anchor inside a note biases the
  figure boundary toward articulating it — follows from interval ranking
  for free, but deserves its own pinned test.
- Whether Rotate should re-anchor the profile with the rotation register
  (profile describes the felt meter, which does NOT rotate with the
  material — current design: profile stays fixed in the metric frame,
  which is also what the unrotated-rank discipline already does).
