# Timeline/Audio Parity Postmortem: Re-Hocketed Future Queue

> Historical note: this incident happened in the source product's larger
> playback pipeline. Dum-Ka removed several stages named below, but retained
> the cycle-local finalization rule and its regression harness. For the current
> pipeline, see [ARCHITECTURE.md](ARCHITECTURE.md).

This note documents the channel-color/sound mismatch fixed during the timeline
recovery work. Keep it as a regression reference for humans and AI agents before
changing transport, ratchet, hocket, timeline, or MIDI debug behavior.

## Summary

The timeline channel lane displayed one set of hocket assignments while the
built-in synth and MIDI output played another. The root cause was not CSS,
color mapping, General MIDI channel 10 behavior, or autosave. The transport was
mutating already-realized future events after it had recorded timeline metadata
for those events.

The fix was to make playback rewrites cycle-local:

1. Build a temporary event queue for the cycle currently being realized.
2. Run rhythm overlay, ratchet, static MIDI channel routing, and channel hocket
   only on that temporary cycle queue.
3. Record timeline metadata from the finalized cycle queue.
4. Append those finalized events to the scheduler queue.
5. Never run ratchet or hocket over already-finalized events in the scheduler
   queue.

## User-Visible Symptoms

- Channel colors and numbers in the timeline looked internally stable, but the
  sound assigned to a color appeared to migrate between playback runs or
  timeline repaints.
- MIDI debug rows showed normal queued dispatches on channels 1-4, which made
  the bug look like a synth-monitor or visual-timing problem.
- UI-only fixes could make the lane prettier without making it true.
- Built-in synth routing fixes were necessary for other reasons, but they did
  not solve this mismatch by themselves.

## Technical Root Cause

Before the fix, `realize_and_enqueue` appended the newly realized cycle into the
existing scheduler queue, then called ratchet and channel hocket over that whole
queue. The scheduler intentionally realizes future cycles ahead of playback.
That meant a cycle could be transformed more than once:

```text
play starts
  realize cycle 0
  record channelHocketEvents for cycle 0

scheduler looks ahead
  realize cycle 1
  BUG: hocket runs over queued cycle 0 and cycle 1
  cycle 0 MIDI bytes are rewritten after its timeline events were recorded

scheduler looks ahead again
  realize cycle 2
  BUG: hocket may rewrite older queued events again
```

The timeline consumed `channelHocketEvents` recorded during an earlier pass. The
sound used the final queued MIDI bytes after later passes had rewritten them.
Both were "correct" snapshots of different moments, which is why the failure was
so slippery.

## Broken Invariant

Once playback metadata for a cycle is published to `TransportSnapshot`, the MIDI
events it describes must be immutable except for dispatch/removal.

Equivalently:

- A queued event may be rewritten while its cycle is being finalized.
- A finalized queued event must not be ratcheted, hocketed, or static-channel
  rewritten again.
- Timeline playback layers must describe the same finalized note groups that
  will be dispatched to CoreMIDI and the built-in monitor.

## Why This Was Hard To Diagnose

- The visible defect was in the timeline, but the bug lived in transport queue
  ownership.
- The MIDI debug table reported dispatch-time bytes, while the timeline used
  realization-time hocket metadata. Comparing either one alone was misleading.
- The built-in synth had legitimate channel-10 and per-channel program concerns,
  so it was plausible that the monitor was lying.
- Previous UI collisions and repaint issues made it tempting to keep looking at
  CSS and React layering.
- Removing early MIDI lookahead fixed a real timing risk, but not the queue
  mutation bug.
- The old code had a reasonable local shape: "append events, then rewrite the
  queue." The missing idea was ownership: the scheduler queue already contained
  finalized events.

## Correct Architecture

`cseq-transport` owns playback finalization. The safe flow is:

```text
realize cycle N
  -> local cycle_queue
  -> rhythm overlay events for N
  -> ratchet rewrite inside N only
  -> static channel or hocket rewrite inside N only
  -> playback metadata for N
  -> append finalized events to scheduler queue
  -> dispatch due events later
```

The scheduler queue is not a workbench. It is a holding area for finalized MIDI
events waiting for their due tick.

## Regression Tests

Keep these transport tests:

- `channel_hocket_ignores_events_outside_current_cycle_window`
- `realizing_future_cycles_does_not_rehocket_already_queued_events`
- `channel_hocket_events_match_final_rendered_note_groups_after_ratchet`
- `hocket_timeline_channel_identity_drives_monitor_voice`
- `immediate_dispatch_takes_due_events_without_early_lookahead`

These tests protect different parts of the same contract:

- Hocket only sees the current cycle.
- Future realization does not mutate older queued events.
- Timeline hocket metadata matches final rendered note groups.
- The built-in monitor follows the same user-facing channel identity.
- Immediate MIDI dispatch does not reintroduce a lookahead phase error.

## Debug Checklist

When timeline and sound disagree, check in this order:

1. Is the score/rhythm request identical for preview and playback?
2. Are playback-only timeline layers filtered to the same cycle as the transport
   snapshot?
3. Are queued MIDI events being rewritten after timeline metadata is recorded?
4. Does MIDI debug show dispatch-time bytes that differ from the timeline's
   recorded `channelHocketEvents`?
5. Is the built-in monitor remapping only locally while external MIDI keeps the
   user-facing channel?
6. Are all-notes-off or program-change cleanup rows being mistaken for hocket
   rows?
7. Is visual playhead compensation hiding a smaller timing issue?

Do not start with CSS unless the data has already been proven coherent.

## Future Guardrails

- Any playback feature that rewrites queued MIDI must operate on a cycle-local
  queue or an explicitly scoped event slice.
- If a feature records timeline metadata, record it after that feature has made
  its final MIDI changes for the cycle.
- If a feature mutates an event's MIDI channel, it must also update
  `QueuedEvent.user_channel`.
- If the scheduler realizes ahead, tests must cover "realize cycle N, then
  realize cycle N+1, then verify cycle N is unchanged."
- If a debug surface shows dispatch-time data, label it as such. Do not assume
  it proves realization-time metadata stayed aligned.

## Parity Harness (automated)

The lessons above are now enforced by an automated parity harness rather than
relying on manual discipline. It encodes one invariant:

> For any realized cycle, every visible timeline lane must be derivable from the
> same finalized cycle-local event ledger that MIDI playback uses, in the same
> coordinate system (cycle-local ticks → musical akshara).

In current Dum-Ka terms, the finalized ledger is the audible result of one
cycle-local realization, and every playback lane is a view of metadata recorded
from that same realization. A parity failure is a disagreement between the
picture and the sound.

### Backend: finalized-cycle ledger (`crates/cseq-transport/src/lib.rs`)

`finalized_cycle_ledger` (test-only, in the `tests` module) reads one normalized
row per final MIDI note group out of the finalized queue — *after* rhythm
overlay, ratchet, ornaments/delay, pitch shaping, static routing, channel
hocket, conflict handling, and cycle-flux warping. It carries the fields needed
to compare against playback metadata: cycle, cycle-local start/end ticks, pitch,
velocity, user channel, ratchet group/hit, ornament group/role, parallel
conflict action, and parallel track id/index.

Each `parity_*` test derives a lane from this ledger and asserts the matching
playback metadata (the data the timeline renders) agrees with the scheduled
MIDI:

- `parity_ratchet_metadata_matches_finalized_midi`
- `parity_ornament_metadata_matches_finalized_midi`
- `parity_pitch_metadata_matches_finalized_midi`
- `parity_channel_hocket_metadata_matches_finalized_midi`
- `parity_channel_hocket_after_ratchet_matches_finalized_midi`
- `parity_cycle_flux_warps_metadata_and_finalized_midi_together` (ratchet hits)
- `parity_cycle_flux_warps_all_metadata_families_together` (ornament + pitch +
  channel-hocket all warp consistently with the MIDI under flux)
- `parity_flux_off_is_identity_for_tick_positions`
- `parity_future_cycle_does_not_rewrite_finalized_ledger` (cycle-local rule,
  generalized to the whole ledger)
- `parity_locked_seed_produces_identical_finalized_ledger`
- `parity_gati_7_section_timeline_audio_ledger` (gati subdivides each beat)
- `parity_jathi_active_rhythm_row_matches_finalized_midi` (rhythm row partitions
  the jathi spans, not inactive gati beats, and equals the audio)

These build on the existing oracle helpers (`rendered_note_groups`,
`groups_from_realized_rhythm_snapshot`, the `*_signature` builders) and join the
pre-existing parity tests this document already lists. Adjacent already-covered
regression classes the harness relies on (do not duplicate): same-gati fired
boundary still starts a new section
(`cseq-transforms::subdivision_switch_same_gati_boundary_creates_new_jathi_section`),
triggered followers derive from compiled launches
(`cseq-trigger::compile_window` + `reapply_recompiles_identical_future_launches`),
and rhythm-row/audio resolution parity
(`rhythm_preview_resolution_matches_transport_note_groups`).

Property-based Exact Tiling (`mod tests::prop_tests`). The fixtures above check
hand-picked cases; these check the laws across a wide generated space:

- `assert_exact_tiling` is a reusable checker for the five Exact Tiling laws
  (Cover, Disjoint, Containment, Conservation, Alignment) over a set of spans.
- `finalized_leaf_layer_exactly_tiles_each_accent_span` generates valid scores
  (gati, optional jathi, optional forced section boundary, ratchet/hocket/pitch,
  1–3 cycles; flux off) and asserts the finalized leaf layer Exactly Tiles every
  active accent span, the accent spans tile the cycle, each metadata family
  matches the leaf, and prior cycles stay immutable. This is the only check that
  the leaf is *itself a valid tiling* — fixtures only check leaf-vs-metadata
  equality, so two same-direction bugs would slip past them.
- `cycle_flux_is_a_tiling_preserving_reparametrization` asserts flux adds/drops/
  reorders nothing (onset-order shape sequence), keeps the cycle edges, stays
  parity-consistent with the warped MIDI, and is the exact identity when off.
- `forced_boundary_splits_sections_and_resets_jathi` proves the boundary path is
  non-vacuous (it genuinely splits sections and resets jathi).

Out of the property generator (targeted/future work): rests and ornaments (they
legitimately break audible-leaf cover), and parallel/triggered conflict
suppression.

### Frontend: coordinate-space contract (`ui/src/timelineModel.ts`)

Lanes can also diverge by rendering the *right* events in the *wrong* coordinate
space. Under Cycle Flux the backend warps overlay event ticks to match queued
MIDI; a naive `(tick / ticksPerCycle) * cycleBeats` map then draws those warped
ticks as linear positions, so ratchet/grace/pitch/channel marks drift off their
note groups while the rhythm row and playhead stay on the musical grid.

Two registries fence this, keyed so the two stay in lockstep:

- `TIMELINE_PLAYBACK_LANE_SOURCES` — each lane must be `"realized-snapshot"`
  sourced during playback (never re-resolved preview).
- `TIMELINE_PLAYBACK_LANE_TICK_SPACE` — each lane declares its coordinate space:
  `"akshara-native"` (rhythm row, drawn from akshara spans) or
  `"tick-via-flux-helper"` (overlay lanes, which must convert ticks through
  `timelineTickToMusicalAkshara` in `ratchetDisplay.ts` — the same flux
  inversion the playhead uses).

Tests in `ui/src/timelineModel.test.ts` assert the registries cover the same
lanes, that every tick-sourced lane is flux-safe, that the helper is the linear
identity when flux is off and inverts a non-linear flux map when on, and a
source-level scan that **no overlay lane in `TimelineLanes.tsx` contains a raw
`(tick / ticksPerCycle) * cycleBeats` conversion**.

### Coordinate space per lane

| Lane | Source | Tick space |
|---|---|---|
| Beats / gati matra / jathi pulse | resolved score | musical (akshara grid) |
| Rhythm (`rhythm · gati`/`· jathi`) | `realized_rhythm` snapshot | `akshara-native` |
| Ratchet + grace/ornament | realized snapshot | `tick-via-flux-helper` |
| Pitch | realized snapshot | `tick-via-flux-helper` |
| Channel hocket | realized snapshot | `tick-via-flux-helper` |
| Playhead | live transport tick | flux helper (un-warped) |

### Running the harness

```bash
# Backend ledger parity (focused)
cargo test -p cseq-transport parity --lib
cargo test -p cseq-transport ratchet --lib
# Frontend coordinate-space contract + helper
pnpm --dir ui test -- ratchetDisplay.test.ts timelineModel.test.ts playbackLayers.test.ts
pnpm --dir ui typecheck
# Full backend
cargo test --workspace
```

### Adding a new playback layer without bypassing parity

1. Surface it as a realized-snapshot event family on `CyclePlaybackEvents`
   (recorded from the finalized cycle queue, never re-resolved preview).
2. Add it to **both** `TIMELINE_PLAYBACK_LANE_SOURCES` and
   `TIMELINE_PLAYBACK_LANE_TICK_SPACE` (the second `satisfies` the keys of the
   first, so omitting it fails the type-check/test).
3. If the lane positions markers from ticks, convert through
   `timelineTickToMusicalAkshara` — never a raw linear tick map. The source-scan
   test enforces this for `TimelineLanes.tsx`.
4. Add a `parity_*` Rust test deriving the lane from `finalized_cycle_ledger` and
   asserting it equals the scheduled MIDI, including a Cycle-Flux case.

Generator-authoring readouts such as working Subdivision, density/complexity
corridors, mean depth, depth diversity, placement field, and directive trace
are deliberately **not** playback layers. They describe the fold state that
produced the generic resolved spans; the generator lane and audible MIDI still
come from those same spans. If one of these insights becomes a playback lane in
the future, it must first join both source/tick-space registries and gain the
same finalized-ledger parity proof—never re-run depth or spectral math in the
timeline.

Targeted seam tests (each closes one documented gap):

- `parity_parallel_conflict_removes_group_from_midi_and_survivors_tile` — a
  PriorityOrder collision: the suppressed loser is flagged for ghosting in the
  metadata *and* absent from the MIDI ledger, while the surviving track's groups
  still Exactly Tile their span and the ledger records the winner's conflict
  fields.
- `parity_delay_ornament_shifts_leaf_onset_within_target_boundary` — a delayed
  leaf's onset equals `target_start + delay_ticks` and never reaches the target's
  note-off.
- `parity_triggered_follower_leaf_is_the_compiled_launches` and
  `parity_triggered_follower_only_occupies_not_yet_finalized_ticks` — the
  follower's MIDI leaf equals the compiled launches as full note groups
  (start, end, pitch, channel — not just onsets), and every group the first
  realization enqueues survives the next realization unchanged (a follower never
  rewrites or drops a finalized note group).

### What is NOT yet covered (future work)

- Conflict-suppression parity is covered for a *single* hand-built PriorityOrder
  collision; a property-based sweep over policies/overlaps is future work.
- Rests and ornaments stay out of the *Exact Tiling* property generator (they
  legitimately break audible-leaf cover); delay onset-shift is covered as a
  targeted seam, not inside that generator.
- Pixel/layout regressions — intentionally out of scope; the harness uses
  semantic ledgers and deterministic lane geometry, not screenshots.

## Code References

- Cycle-local finalization: `crates/cseq-transport/src/lib.rs`
  `realize_and_enqueue`
- Finalized-cycle parity ledger: `crates/cseq-transport/src/lib.rs`
  `finalized_cycle_ledger` + `parity_*` tests
- Hocket cycle-window guard: `crates/cseq-transport/src/lib.rs`
  `apply_channel_hocket_to_queue`
- Timeline layer coherence + lane registries: `ui/src/timelineModel.ts`
  (`TIMELINE_PLAYBACK_LANE_SOURCES`, `TIMELINE_PLAYBACK_LANE_TICK_SPACE`)
- Flux-safe tick→akshara conversion: `ui/src/ratchetDisplay.ts`
  `timelineTickToMusicalAkshara`
- MIDI debug DTOs: `crates/cseq-transport/src/lib.rs`, `src-tauri/src/main.rs`,
  and `ui/src/bridge.ts`
