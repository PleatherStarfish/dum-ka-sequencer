# Automation Deep-Dive Audit

Status: findings (no code changed). Scope: the automation model
(`cseq-model`), the score-time sampler (`cseq-transforms`), the post-score
runtime sampler (`cseq-transport`), preview/playback parity, the target
registry, and the editor UI. Goal: surface bugs, logic errors, never-wired
targets, and edge cases.

Bottom line: the automation **engine is in much better shape than the cautious
tone of `AUTOMATION.md` implies** — the rational time model and curve math are
correct, the per-type sampling helpers handle units correctly, the post-score
sampler covers matrices/fallbacks/accent-rules/probabilities, and matrix target
ids have parity tests. The real problems are concentrated in a handful of
seams: a few **never-wired target families**, a **timeline-vs-played parity
gap for post-score targets**, and **beat-0-only post-score sampling**.

Severity legend: 🔴 confirmed bug / 🟠 real risk or gap / 🟡 minor / ✅ verified
sound (documented so we don't re-investigate).

---

## 🔴 / 🟠 Findings

### F1 — Synth voice + synth-enable targets are creatable but never applied — REGISTRY SIDE FIXED (🟡, residual: legacy lanes)

**Status update (2026-07-01 audit):** `buildAutomationTargetDefs` no longer
registers any synth targets (the "cheaper, honest" fix below landed) — the UI
no longer offers dead synth lanes. Residuals:

- `AutomationTargetBuildInput.synthEnabled` / `.synthPrograms` are still
  declared and threaded through `useChannelShaperState.tsx` but never consumed
  by `buildAutomationTargetDefs`. Keep them only if synth automation will be
  wired up; otherwise remove the plumbing (see
  `docs/remediation/AUTOMATION_EVALUATION_COMPLETION.md`).
- Patches saved while the targets existed still load their synth lanes; the
  editor shows them as generic "Custom" lanes (`automationTargetDef` fallback)
  with no hint that they are inert.

Original finding (for history):

`buildAutomationTargetDefs` registered `synth.channel.{n}.program`,
`synth.channel.{n}.drumNote`, and `transport.synthEnabled`, so the UI let you
create lanes, draw curves, persist them, and open them — but there is **no
`automate_*` path** for synth in `cseq-transport` (grep confirms: synth program
changes flow through a separate command path, never through
`apply_rhythm_playback_automation`). Result: a user automates a synth voice, sees
a lane, and nothing happens on playback.

- Fix options: either sample these in the scheduler's synth-program path, or
  (cheaper, honest) mark them in the registry as "not yet automatable" /
  hide them until wired, so the UI never offers a dead lane.
- This is the clearest "never wired up" case. The doc admits it; the UI does not.

### F2 — Post-score automation is invisible in the stopped timeline — FIXED 2026-05-28 (🟠, parity gap, partly documented)

Fix landed: `score_preview_subdivision_switch` now appends post-score automation
targets to each beat's `automation_values` via `append_post_score_preview_values`
(a pure additive read of the `AutomationSet`; no playback/realization impact).
The timeline lane already renders any target id and scales with its own range,
so previously-"pending" post-score lanes now show values. To avoid creating a
*new* shown≠played gap before F3, the preview samples post-score targets at
**beat 0 of the cycle, held** — matching how post-score playback samples today;
it steps per cycle. When F3 lands (per-beat playback), switch the preview helper
to the actual per-beat index. New model API `AutomationSet::sample_raw_number`
(+ tests); preview tests `preview_includes_post_score_automation_held_at_cycle_start`
and `preview_omits_disabled_post_score_automation_track`. See
`docs/AUTOMATION_F2_F3_PLAN.md`. (Rust not compiled in the authoring sandbox —
run `cargo test`.)

Original problem:

Only `SubdivisionSwitch` score targets (pitch, velocity, accent ranges,
boundary/gati/jathi/section weights, single-parameter modulation) are returned
in the preview beat DTO and rendered in timeline lanes while stopped. Every
post-score target (ratchet/ornament/pitch/channel/rhythm-matrix/speed/flux) is
sampled only by the transport when a cycle is realized.

Consequence vs. the project's core contract ("what's visible is what plays"):
while **stopped**, the timeline cannot show the effect of an automated ratchet
probability, pitch matrix, channel route, etc. — the playback-only lanes are
hidden while stopped, so the user gets no preview of post-score automation at
all. While **playing**, those lanes are driven by the live snapshot (which does
reflect the sampled config), so it is at least consistent during playback.

- Severity medium: not silent *wrong* audio, but the editing loop for post-score
  automation is "blind" — you can't see what a curve will do until you press
  play. That undercuts the whole point of beat-quantized preview parity for the
  majority of targets.
- Fix: extend the preview payload to carry sampled post-score values for the
  visible cycle (at least beat 0, matching how playback samples them), so the
  relevant lanes can render a stopped preview.

### F3 — Post-score targets sampled once per cycle at beat 0 — RATCHET + ORNAMENT FIXED 2026-05-28 (🟠, per-note-group resampling; pitch/channel/matrix still beat-0)

Fix landed for the **ratchet** and **ornament (grace + delay)** scalar fire
fields (test-first); the same pattern is ready for the remaining processors.

`apply_ratchet_to_queue` re-samples `ratchet.probabilityPercent` and the speed
bounds (`ratchet.speed.min`/`max`); `apply_ornaments_to_queue` /
`apply_delay_ornaments_to_events` re-sample `ornament.probabilityPercent` and
`delay.probabilityPercent` — all **per note group**, at the group's beat index
(`automation_beat_index_for_tick(start_tick - cycle_base_tick, …)`), via the
shared `post_score_resample_scope` helper. When no automation track targets a
field, the sample returns `None` and the cycle-sampled value is used — so output
is byte-identical unless that field is actually automated. Source curves are
threaded through the per-pass scopes (`RatchetPlaybackScope` /
`OrnamentPlaybackScope`, now carrying `automation: Option<&AutomationSet>` +
`cycle_beats`; both still `Copy`). The single source of truth for which
post-score targets are per-beat is
`cseq_model::automation_target_is_per_beat_post_score`, shared with the F2
preview so the two cannot drift.

Still beat-0 (deliberate, documented):

- **Pitch / channel** scalar probabilities (`pitch.ratchet.*`,
  `channelHocket.ratchet.*`) and static channel: their probabilities gate a
  stateful, seeded **resolver/RNG** whose draw stream cascades through the rest
  of the cycle. Resampling mid-cycle would desync the resolver from what the
  stopped-timeline preview can show — *creating* a new shown≠played gap. Safe
  per-beat support needs a re-seedable-per-beat resolver checkpoint design; out
  of scope until then.
- Markov matrix / fallback / entry weights and seed mode: re-sampling a whole
  Markov axis mid-cycle changes chain-history semantics and needs its own design.
  `apply_rhythm_playback_automation` still samples these at `cycle_start`.

Original problem (retained for context):

`apply_rhythm_playback_automation` used `AutomationSampleScope::cycle_start`
(beat 0). So a lane authored to move a ratchet/pitch/channel value *within* a
cycle had **no audible effect except at the beat-0 value**. Score targets
(pitch/velocity/etc.) were already sampled per beat; only post-score targets were
beat-0-only. A slow ramp across a single long cycle collapsed to its starting
value; a multi-cycle ramp stepped per cycle (beat 0 of each) but was frozen
inside each cycle.

Tests: `ratchet_probability_automation_changes_within_cycle`,
`ratchet_without_probability_automation_is_unchanged`,
`ornament_grace_probability_automation_changes_within_cycle`,
`ornament_grace_without_automation_is_unchanged`,
`ornament_delay_probability_automation_changes_within_cycle`,
`matrix_weights_still_sampled_at_cycle_start` (cseq-transport);
`per_beat_post_score_predicate_lists_only_wired_targets` (cseq-model). Rust not
compiled in the authoring sandbox — run `cargo test`/`cargo clippy`.

### F4 — Relational marker anchors are stored but inert (🟡, documented)

A point snapped to a marker stores `anchorId` + the marker's time, but the
sampler reads the point's stored time. Moving the marker does **not** move
snapped points. So "snap to marker" reads as a live constraint but is a one-time
copy. Either make marker edits update matching `anchorId` points, or relabel the
affordance as a one-time snap.

### F5 — Text automation values and non-beat sample rates are modeled but unevaluated (🟡, documented)

`AutomationValue::Text` exists; the sampler only consumes numeric/boolean.
`AutomationSampleRate` has `sectionStart`/`cycleStart`/`rhythmSpan`/`noteGroup`,
but only `beat` is implemented. These are contract placeholders; today they are
inert. Low risk because nothing user-facing produces text-valued automation, but
a future target declaring `noteGroup` would silently sample per beat.

### F6 — Multiple replace tracks on one target: last-writer-wins, not averaged (🟡, edge case)

`sample_typed_number` iterates matching tracks in array order; for `replace`
each overwrites `value`, so with two enabled `replace` tracks on the same target
the **last track wins** (within-track curves are averaged, as documented, but
cross-track replace is not). The simplified UI makes one track per target, so
this can only arise from hand-edited/legacy data — but if multi-curve/multi-lane
UI is added (a stated next step), this ordering needs a defined rule.

### F7 — `lengthCycles` endpoint `1/1` is never an audible beat (🟡, documented gotcha, easy to trip)

Beat phases are `0/4,1/4,2/4,3/4` for a 4-beat cycle; the `1/1` endpoint shapes
interpolation but is never sampled. New lanes are created with an endpoint at
`1/1` defaulted to the same value as the start, so the *last beat* of a one-cycle
span samples the segment value approaching `1/1`, not `1/1` itself. This is
correct-by-design but a frequent source of "my last beat didn't reach the end
value" confusion. Consider seeding new lanes' end point at the last real beat
phase, or surfacing the note in the editor.

---

## ✅ Verified sound (do not re-investigate without cause)

- **Exact rational time** (`AutomationTime`): `new` reduces by gcd and rejects
  zero denom; `from_beat` wraps cycle by `lengthCycles` and clamps beat;
  `cmp_exact` cross-multiplies in `u128` (no overflow for u64 inputs); ordering
  never converts to float. Stretching `lengthCycles` keeps point times exact.
- **Curve sampler** (`AutomationCurve::sample_number`): empty points → `None`;
  single point → that value everywhere; before-first/after-last clamp to the
  endpoint; exact bracket selection before any float conversion; exact-equal
  point hits return that point's value. No off-by-one in the window scan.
- **Segment shaping** (`warp_automation_t`): hold/linear/smooth/easeIn/easeOut/
  easeInOut/exponential are continuous (incl. at t=0.5 for easeInOut), `amount`
  clamped, exponential guarded against divide-by-zero, results clamped.
- **Combine + coercion**: replace averages within-track curves; add sums;
  multiply products; non-finite results reject; boolean coerces at 0.5 then
  `>= 1.0`; integer rounds+clamps; weight clamps to 0..999. NaN/`min>max`/
  non-finite base all early-return `None`.
- **Per-type runtime helpers** (`sample_automation_unit_percent/u8/u32/i16/
  weight/bool`): units correct — percent helper converts base 0..1 → 0..100,
  samples in percent space (matching the frontend `makePercentTarget`), divides
  back. No unit mismatch.
- **Matrix target-id parity**: rhythm/pitch/channel matrix, fallback, and entry
  target ids are built identically on both sides (`sanitize_target_id_part`
  vs `sanitizeTargetIdPart`, same `{order}.{from.join(".")}.to.{to}` shape) and
  covered by parity tests (`rhythm.matrix.4.first.4.to.1-3.weight`,
  `pitch.matrix.first.0.to.0.weight`, `channelHocket.matrix.first.1.to.2.weight`).
  These families ARE wired end-to-end.
- **Post-score coverage** (`apply_rhythm_playback_automation`): genuinely broad —
  rhythm enable, MIDI output channel, rhythm seed, rhythm chains + fallback +
  entry, articulation cells, arbitrary subdivision + pools, rhythm speed,
  ratchet (probability/curve weights/velocity/duration/modifiers), ornament +
  delay, pitch shaper (fallback index + per-state weights + boundary + full
  matrix + ratchet/ornament policies + grace injection), channel hocket
  (fallback + matrix + ratchet/ornament + accent rules), cycle tempo flux.
- **Tempo automation**: single-track samples `transport.tempoBpm` per beat in
  the scheduler (separate from beat-0 post-score path, no conflict); parallel
  custom-tempo tracks integrate it continuously across the cycle; global-follow
  tracks ignore it. (Validated by the BPM/clock work earlier.)
- **Editing parity protection**: automation mutations are gated by
  `playbackStructureLocked` (transport playing) throughout the editor, so the
  visible timeline cannot drift from the installed score.
- **Persistence**: missing `lengthCycles`/`markers`/`curves`/`outCurve`/invalid
  curve kinds/invalid point values all have safe normalization defaults.

---

## Suggested priorities

1. **F2 + F3** — DONE for ratchet + ornament (2026-05-28): those post-score
   scalars are now previewable while stopped *and* sampled per beat, with
   preview/playback parity enforced by a shared predicate. **Next:** extend F3
   per-beat resampling to **pitch/channel** probabilities + static channel — but
   only after adding a re-seedable-per-beat resolver checkpoint, because those
   probabilities gate a stateful resolver/RNG draw stream that would otherwise
   desync from the stopped preview. (Matrix/seed per-beat also stays out of scope
   pending a chain-history design.) New per-beat targets must be added to
   `cseq_model::automation_target_is_per_beat_post_score` in the same change.
2. **F1**: either wire synth-voice automation or stop offering dead lanes.
3. **F4**: make marker anchors relational or relabel them.
4. Define cross-track `replace` semantics (**F6**) before shipping multi-lane UI.

## Test gaps worth closing

- A test asserting every registry target id either has a backend sampler or is
  explicitly marked non-applicable (would have caught F1 and prevents future
  drift).
- Curve edge cases: single-point curve, all-points-same-time, points exactly on
  `1/1`, `lengthCycles` change preserving coordination (model has some; extend).
- A preview/playback parity test for at least one post-score target once F2 is
  implemented.

## Files

- Model/math: `crates/cseq-model/src/lib.rs` (`AutomationTime`,
  `sample_typed_number`, `AutomationCurve::sample_number`, `warp_automation_t`).
- Score sampling: `crates/cseq-transforms/src/lib.rs` (SubdivisionSwitch).
- Post-score runtime sampling: `crates/cseq-transport/src/lib.rs`
  (`apply_rhythm_playback_automation` + `automate_*` + `sample_automation_*`).
- Preview DTO: `src-tauri/src/main.rs` (`score_preview_subdivision_switch`).
- Registry + editor + lanes: `ui/src/App.tsx` (`buildAutomationTargetDefs`,
  `*AutomationTarget` id builders, graph editor, timeline lanes).
