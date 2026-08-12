# Design: Automation Evaluation Completion

Status: proposed (2026-07-01 docs-vs-code audit)
Owner docs: [AUTOMATION.md](../AUTOMATION.md), [AUTOMATION_AUDIT.md](../AUTOMATION_AUDIT.md)

## Problem

The automation *model* (targets, curves, markers, sample rates, combine modes)
is richer than the automation *evaluator*. Five verified gaps let a user author
state that renders in the editor, persists in patches, and then does nothing —
or something subtly different — at playback:

| # | Gap | Evidence |
|---|-----|----------|
| 1 | Pitch, channel-hocket, and matrix-weight post-score targets sample once per cycle at cycle start; intra-cycle curve shape is ignored. Ratchet + ornament were fixed (F3) and re-sample per note group. | `AutomationSampleScope::cycle_start` (`crates/cseq-transport/src/lib.rs:3556`); F3 comments at `lib.rs:5998`, `lib.rs:6012` show the fixed pattern the remaining targets lack |
| 2 | Relational marker anchors are stored, editable, and persisted but never evaluated — `markers` appears in transport only as `Vec::new()` in tests. | `crates/cseq-transport/src/lib.rs` (no marker evaluation path); `ui/src/automationTargets.ts:1539-1560` (marker sorting/nearest exists FE-only) |
| 3 | Non-beat sample rates (`cycleStart` etc.) exist in the type system but the backend has no `sample_rate` handling at all — every curve is sampled on the evaluator's own schedule regardless of the authored rate. | no `sample_rate`/`SampleRate` matches in `crates/cseq-transport/src/lib.rs`; admitted at `AUTOMATION.md:632` |
| 4 | Text automation values are modeled but never consumed (numeric/boolean only). | `AUTOMATION.md:144` |
| 5 | Multiple enabled Replace-mode tracks on one target resolve last-writer-wins (each track overwrites `value`), while curves *within* one track average. Cross-track averaging is what the within-track behavior implies. | `crates/cseq-transport/src/lib.rs:3126` |

Adjacent residuals from F1 (synth targets removed from the registry):

- `AutomationTargetBuildInput.synthEnabled` / `.synthPrograms` are threaded
  through `ui/src/components/useChannelShaperState.tsx` (props at :161-162,
  pass-through at :449-451, :726-727) but never consumed by
  `buildAutomationTargetDefs`.
- Legacy patches that contain synth lanes load them as generic "Custom" lanes
  (`automationTargetDef` fallback, `ui/src/automationTargets.ts:317`) with no
  indication they are inert.
- `lengthCycles` endpoint `1/1` is never an audible beat (F7,
  `cseq_model::…::from_beat`, `crates/cseq-model/src/lib.rs:192-197`) — new
  lanes seed an endpoint the user can hear only asymptotically.

## Design

### Phase A — per-note-group sampling for the remaining post-score targets

Mirror the F3 ratchet/ornament fix for pitch, channel hocket, and matrix
weights:

1. Thread the `automation` source (`effective_rhythm.config.automation`) into
   `apply_pitch_to_queue` / the hocket rewrite / matrix-weight resolution the
   same way `RatchetPlaybackScope.automation` does it
   (`crates/cseq-transport/src/lib.rs:5998`).
2. At each note group (pitch), each rewrite decision (hocket), and each span
   resolution (matrix weights), compute the group's cycle fraction from its
   start tick (`cycle_base_tick`, `ticks_per_cycle`) and call the existing
   curve sampler with that phase instead of the frozen cycle-start scope.
3. Determinism: sampling is pure in phase; seeds are untouched. Locked-seed
   replay stays byte-identical for constant curves (the sampled value at any
   phase equals the old cycle-start value when the curve is flat) — add a
   regression test asserting exactly that equivalence.
4. Parity: the stopped-timeline preview must sample with the same per-group
   phases. The preview already re-derives note groups; reuse the group phase
   computation from step 2 via a shared helper so preview and playback cannot
   diverge (KNOWN_RISKS "Preview And MIDI Drift").

Tests: one per target family — draw a 0→1 ramp across one cycle, assert the
last note group in the cycle gets a near-1 value (would be 0 under beat-0
freezing), plus the flat-curve replay-identity test.

### Phase B — sample-rate semantics

Give `AutomationSampleRate` real meaning in one place:

- Add `fn sample_phase(rate, group_phase, beat_phase, cycle_start_phase) -> f64`
  in `cseq-transport` next to the curve sampler; every evaluation site asks it
  which phase to sample at (`beat` → quantize to the enclosing beat's phase,
  `cycleStart` → 0.0, per-note-group targets → raw group phase).
- The FE editor already labels rates (`automationSampleRateLabel`); no UI work
  beyond removing the "not yet evaluated" caveat in AUTOMATION.md once wired.

### Phase C — marker anchors

Decide once: evaluate or remove. Recommended: evaluate, because markers are
persisted user data.

- Resolve each marker to a cycle fraction at score-apply time (they are
  positions, not curves) in `cseq-transport`, mirroring
  `sortAutomationMarkers` / nearest-marker logic that exists FE-side
  (`ui/src/automationTargets.ts:1539`).
- Curves whose points anchor to a marker id shift with the marker's resolved
  phase. Unresolvable anchors (marker deleted) fall back to the point's stored
  absolute phase — never drop the point.
- If evaluation is rejected, then: strip marker-anchor UI, keep parsing old
  patches (ignore anchors), and document the removal — do not leave a third
  state where the editor implies meaning the engine lacks.

### Phase D — combine-mode correctness

Replace mode with N>1 enabled tracks on one target: accumulate Replace samples
across tracks and average once at the end (collect `replace_samples` across the
track loop in the combiner at `crates/cseq-transport/src/lib.rs:3100-3143`,
then `value = mean(replace_samples)` before Add/Multiply application). This is
a behavior change for patches relying on track order; gate it behind the patch
schema version bump if any real patches would change (survey: multiple replace
tracks on one target is currently pathological, so a silent fix is defensible —
decide at implementation review).

### Phase E — small honest UX

- Inert legacy lanes: in `automationTargetDef` fallback (Custom group), label
  legacy `synth.*` / `transport.synthEnabled` targets "(not automatable)" and
  render the lane pill muted with a tooltip.
- `lengthCycles` endpoint: seed new lanes' final point at the last audible beat
  phase (`(beats-1)/beats`) instead of `1/1`, and show a faint marker at `1/1`
  labeled "end (shapes interpolation, never sampled)".
- Synth plumbing: if Phase A-D ships without synth automation, delete
  `synthEnabled`/`synthPrograms` from `AutomationTargetBuildInput` and the
  `useChannelShaperState` thread-through; if synth automation is wanted, wire
  it in the scheduler's synth-program path as F1 originally proposed.

## Sequencing and risk

A → B are one mechanical pattern applied to known sites (F3 already proved it).
C is the only data-model decision. D is a one-function change plus a
compatibility call. E is independent polish. Every phase keeps the
preview/playback parity invariant test-guarded; nothing touches the rhythm
tree, so Exact Tiling is unaffected.
