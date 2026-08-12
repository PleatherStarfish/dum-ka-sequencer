# Automation F2 (preview exposure) + F3 (per-beat post-score) — fix plan

Companion to `docs/AUTOMATION_AUDIT.md`. F2 and F3 share a root cause: post-score
automation targets are second-class versus score targets. This plan delivers F2
now (with tests written first) and specifies F3 as a test-first implementation
to land where a Rust toolchain is available.

Decision (with the user): build F2 now; deliver F3 as a written, test-first
plan. The implementation sandbox has no Rust toolchain, so all Rust here is
authored carefully and accompanied by tests to run with `cargo test`.

---

## F2 — Post-score automation values in the stopped-timeline preview

### Why it's safe

Post-score targets sample purely from the `AutomationSet` by
`(target, cycle, beat_index)`. They do not need the realized tree or the
playback config. So exposing them in the preview is a **pure additive read**:
it adds entries to `ResolvedBeatDto.automation_values` and cannot change
playback, the realized tree, or the parity invariant. The frontend automation
lane already renders any target id by looking it up in `automationValues` and
scales it with the frontend registry's own range — so post-score lanes that are
perpetually "pending" today simply start showing live per-beat values.

### Design

`score_preview_subdivision_switch` already samples per beat the *score* targets
listed in `preview_automation_targets`. Add a second contribution: for every
**enabled track in the preview `AutomationSet` whose target is not already a
score target**, sample it per beat and append a raw value.

Backend does not know post-score target value-kinds (those live in the frontend
registry), and it does not need to: the timeline lane only needs the value to
position the cell within the frontend-known axis range. So sample post-score
tracks as raw float with no domain clamp via a dedicated, clearly-named helper.
This keeps the typed score path unchanged and avoids the backend guessing types.

Key points:

- Use a `HashSet` of the score target ids already covered, so a target is never
  double-sampled.
- Only emit a value when the track actually produces a sample (skip otherwise),
  matching the existing `filter_map` behavior so "no automation" stays "pending"
  in the lane.
- Beat index and `length_cycles` phase math reuse the exact existing code, so
  F2 cannot introduce a phase discrepancy versus playback's beat sampling.

### Implementation (this change set)

- `cseq-model`: add `AutomationSet::sample_raw_number(target, cycle, beat_index,
  cycle_beats) -> Option<f64>` — equivalent to `sample_number` (Float, no
  clamp), named to signal "preview/raw use." (Thin wrapper; keeps the call site
  in `main.rs` readable and unit-testable in the model crate.)
- `src-tauri/main.rs`: in the per-beat loop, after the score `automation_values`
  are built, append post-score samples for enabled non-score targets. Add a
  helper `append_post_score_preview_values`.
- No DTO shape change (still `Vec<AutomationBeatValueDto>`), no bridge change,
  no frontend change required for rendering — the lane already consumes them.
  (A follow-up may add a subtle "preview vs played" cue, but it is not required
  for correctness.)

### Tests written first

`cseq-model`:
- `sample_raw_number_matches_sample_number_without_clamp`: a curve value beyond
  a hypothetical domain is returned unclamped; equals `sample_number`.
- `sample_raw_number_none_when_no_track`: returns `None` with no matching track.

`src-tauri` preview tests (extend the existing per-beat sample test):
- `preview_includes_post_score_automation_values_per_beat`: build a preview
  request whose `AutomationSet` has an enabled `ratchet.probabilityPercent`
  (a post-score target) ramp; assert each beat's `automation_values` contains
  that target with a per-beat-changing value, and that score targets are still
  present and unchanged.
- `preview_post_score_value_absent_when_track_disabled`: disabled track → not
  present.

These tests fail before the change (post-score targets never appear in preview)
and pass after.

---

## F3 — Per-beat (eventually per-note-group) post-score sampling at playback

### Problem recap

`apply_rhythm_playback_automation` samples the effective config once at
`AutomationSampleScope::cycle_start` (beat 0). The rhythm/ratchet/ornament/
pitch/hocket passes then consume that single config for the whole cycle. A curve
that moves a post-score value within a cycle has no audible effect past beat 0;
it only steps between cycles.

### Constraint that shapes the design

The post-score passes rewrite the **whole cycle queue** at once and the cycle is
finalized as one unit for the timeline-audio parity contract. Re-realizing the
whole cycle per beat would multiply work and risk the parity invariant. So F3
must sample per beat *without* re-running each pass per beat.

### Recommended approach: per-note-group resampling at consumption

Thread a per-group beat index into the passes and re-sample only the **scalar
fields each pass reads per group**, at the moment it reads them:

1. Add `automation: Option<&AutomationSet>`, `cycle`, and `cycle_beats` to the
   scope each pass already receives (most already take a `*Scope`).
2. Compute each note group's beat index from its start tick:
   `automation_beat_index_for_tick(start_tick - cycle_base_tick, ticks_per_cycle,
   cycle_beats)` (this helper already exists and is used by the tempo sampler).
3. Where a pass currently reads a probability/weight/threshold from the
   cycle-sampled `config`, re-sample that one field with the group's beat index,
   falling back to the cycle-sampled value when no automation track targets it
   (so behavior is unchanged unless that target is actually automated).

Scope discipline: do the **scalar per-group** fields first (ratchet base/whole/
per-hit probability and speed bounds; ornament probability; pitch ratchet/
ornament probabilities; channel ratchet/ornament probabilities; static channel).
Matrix/fallback/entry weights and seed mode stay cycle-sampled at beat 0 for now
(re-sampling a whole Markov axis per group changes chain history semantics and
needs its own design). Document that boundary explicitly.

This is bounded, leaves the structural passes intact, and changes audible
behavior only for targets that are actually automated.

### Why not "sample full config per beat"

Sampling the entire effective config per beat and re-realizing per beat would be
the most faithful but is the largest, most parity-critical change and would
re-enter chain/seed resolution mid-cycle. It is explicitly out of scope for a
safe first pass.

### Tests written first (run with cargo)

In `cseq-transport`:
- `ratchet_probability_automation_changes_within_cycle`: a multi-beat cycle with
  a ratchet-probability ramp produces different fire decisions/metadata in early
  vs late beats (seeded, deterministic). Fails today (beat-0 only).
- `post_score_target_without_automation_is_unchanged`: with no automation track
  on the field, per-group resampling returns the cycle-sampled value — output is
  byte-identical to current behavior (guards against regressions).
- `matrix_weights_still_sampled_at_cycle_start`: confirm the documented boundary
  (axis weights remain beat-0) so the limitation is intentional and tested.

### Sequencing

1. Land F2 (this change set) — safe, additive, independently shippable.
2. Land F3 per-note-group scalars behind the test suite above, on a machine with
   `cargo`. Then optionally extend F2's preview to show the per-beat post-score
   values (F2 already exposes per-beat values; once F3 makes them audible per
   beat, preview and playback converge fully).

## Verification

- Frontend: `pnpm typecheck`, `pnpm build`, timeline unit tests, Playwright
  discovery (runnable in-sandbox).
- Rust: `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D
  warnings` (must run on a dev machine — no toolchain in the authoring sandbox).

---

## Status — implemented 2026-05-28 (test-first)

Both F2 and F3 are now implemented. The implementation sandbox still has no Rust
toolchain, so the Rust additions are authored and reviewed by hand and **must be
validated with `cargo test --workspace` and `cargo clippy --workspace
--all-targets -- -D warnings` on a dev machine.** The frontend typechecks clean
in-sandbox and needed no changes.

### F3 — per-note-group scalar resampling (ratchet first)

- `RatchetPlaybackScope` gained a lifetime and two fields: `automation:
  Option<&AutomationSet>` and `cycle_beats: u32`. `&AutomationSet` is `Copy`, so
  the scope stays `Copy`. `None` automation disables resampling → byte-identical
  to the previous beat-0 behavior.
- New helper `ratchet_resample_scope(scope, cycle_base_tick, ticks_per_cycle,
  start_tick)` converts a note group's start tick to its beat index (via the
  existing `automation_beat_index_for_tick`) and yields a per-beat
  `AutomationSampleScope`.
- In `apply_ratchet_to_queue`, each note group re-samples `ratchet.
  probabilityPercent`, `ratchet.speed.min`, and `ratchet.speed.max` at its own
  beat. Probability flows through the existing `probability_with_modifiers`;
  speed bounds go through a `Cow<RatchetPlaybackSpec>` that only clones when a
  speed bound is actually automated. When no track targets a field, the sample
  returns `None` and the cycle-sampled `spec` value is used unchanged.
- `realize_and_enqueue` threads `effective_rhythm`'s (un-consumed)
  `config.automation` and `score_cycle_beats(score)` into the scope.
- **Scope of this pass:** ratchet scalars only. Ornament/pitch/channel scalars
  and static channel are still beat-0 (not yet wired); Markov matrix/fallback/
  entry weights and seed mode remain beat-0 by design. The single source of
  truth for "which post-score targets are per-beat" is the new
  `cseq_model::automation_target_is_per_beat_post_score(target)` — extend it in
  the same change that wires each additional processor so preview and playback
  cannot drift.

Tests (cseq-transport): `ratchet_probability_automation_changes_within_cycle`
(0%→100% ramp over a 4-beat cycle: beat 0 never fires, beats 2–3 always fire —
fails under beat-0 sampling, passes after F3), `ratchet_without_probability_
automation_is_unchanged` (threading an unrelated tempo ramp leaves the queue
byte-identical to no automation), `matrix_weights_still_sampled_at_cycle_start`
(documents the beat-0 boundary). Model test
`per_beat_post_score_predicate_lists_only_wired_targets`.

### F2 — preview now samples each target at its playback beat

`append_post_score_preview_values` previously sampled every post-score target at
beat 0 (held), to avoid out-promising playback before F3. Now that ratchet
scalars are per-beat in playback, the preview samples **per-beat for targets in
`automation_target_is_per_beat_post_score`, beat 0 for the rest** — exact parity
with the engine, driven by the same predicate. (User decision: exact per-target
parity over a blanket per-beat flip.) Test
`preview_samples_post_score_targets_at_their_playback_beat` asserts a per-beat
lane (ratchet) ramps `0,25,50,75` across four beats while a still-beat-0 lane
(`pitch.ratchet.wholeProbabilityPercent`) stays held at beat 0.

---

## Status — ornament extended 2026-05-28 (test-first)

The ornament post-score scalars now follow the same per-beat pattern as ratchet.

- The ratchet-specific `ratchet_resample_scope` was generalized into a shared
  `post_score_resample_scope(automation, cycle, cycle_beats, cycle_base_tick,
  ticks_per_cycle, start_tick)`; `ratchet_resample_scope` now delegates to it.
- `OrnamentPlaybackScope` gained the same lifetime + `automation:
  Option<&AutomationSet>` + `cycle_beats` fields (still `Copy`);
  `DelayOrnamentApplyContext` carries the lifetime through to its `scope` field.
- `apply_ornaments_to_queue` re-samples `ornament.probabilityPercent` per grace
  candidate; `apply_delay_ornaments_to_events` re-samples
  `delay.probabilityPercent` per delay candidate. Both feed the resampled base
  through the existing `probability_with_modifiers` and fall back to the
  cycle-sampled `spec` value when no track targets the field (byte-identical when
  unautomated). `realize_and_enqueue` threads `effective_rhythm.config.automation`
  + `score_cycle_beats` into the ornament scope.
- `automation_target_is_per_beat_post_score` now also returns true for
  `ornament.probabilityPercent` and `delay.probabilityPercent`, so the F2 preview
  shows them per beat automatically.

Tests (cseq-transport): `ornament_grace_probability_automation_changes_within_
cycle`, `ornament_grace_without_automation_is_unchanged`,
`ornament_delay_probability_automation_changes_within_cycle`. Model predicate
test updated for the two ornament ids. Frontend tsc clean; Rust must be
`cargo test`/`clippy`-validated on a dev machine.

### Follow-ups

- **Pitch/channel** scalar probabilities + static channel are deliberately NOT
  per-beat yet. Their probabilities gate a stateful, seeded resolver/RNG whose
  draw stream cascades through the rest of the cycle; resampling mid-cycle would
  desync playback from what the stopped preview can show (a new shown≠played
  gap). Wiring them requires a re-seedable-per-beat resolver checkpoint design
  first; only then add their ids to `automation_target_is_per_beat_post_score`.
- Matrix/seed per-beat sampling remains deliberately out of scope (needs a chain-
  history design).
