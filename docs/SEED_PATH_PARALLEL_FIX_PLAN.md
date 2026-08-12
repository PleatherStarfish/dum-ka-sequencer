# Architectural Fix Plan: Seed-Path × Parallel Tracks + Note-Group Pairing

Status: IMPLEMENTED 2026-05-28 (Option 1 + Option B1 landed directly; the
interim single-track guard was skipped since the full fix shipped in one pass).
Frontend `pnpm typecheck`/`build` and the Node unit tests pass (22/22). The Rust
changes and tests could not be compiled/run in the implementation environment
(no Rust toolchain) — run `cargo test --workspace` and
`cargo clippy --workspace --all-targets -- -D warnings` before merge. The
Playwright browser could not be downloaded; specs compile and are discovered.

This plan covers the two open defects from the feature-edge scan:

1. **Seed-path replay is unsound across parallel tracks** (high severity,
   live). Seed traces are recorded and replayed without a track dimension, so
   in multi-track mode every track is forced to the same recorded seeds and a
   path recorded in multi-track is a lossy merge.
2. **`collect_final_note_groups` FIFO pairing can swap durations for nested
   same-pitch/same-channel note groups on one track** (low severity, latent).

The already-fixed items (conflict-suppression ghosting, playhead warp
correction, MIDI-debug track filter, BPM/clock snapshot race) are out of scope
here and referenced only where they constrain the design.

---

## Part A — Seed-path replay across parallel tracks

### A.1 Problem statement and current data flow

A "seed path" is an immutable recording of the stochastic seed decisions made
during a playback run, so a user can replay an exact realization or wildcard
selected domains to explore variations. Decisions are tagged by `domain`
(`global` / `rhythm` / `pitch` / `channel` / `ratchet`) and `cycle`.

Current record flow:

```
scheduler realizes each track cycle
  -> per-track CyclePlaybackEvents.seed_trace (PlaybackSeedTraceEvent: cycle, domain, label, seed, ...)
  -> realize_parallel_until appends ALL tracks' traces into one Vec
  -> record_seed_trace_events -> one TransportShared.seed_trace_events ring
  -> TransportSnapshot.seedTraceEvents (DTO has no track id)
  -> ui acceptTransportSnapshot: dedupe by seedTraceKey = `${cycle}:${domain}:${label}`
  -> appended to the active SeedPath.trace (per-track in patch, but trace points carry no track id)
```

Current replay flow:

```
ui seedPathPlaybackConfig(path) -> SeedPathPlaybackConfig { entries[], wildcards[] }
  -> buildParallelPlaybackRequest passes the SAME config into EVERY track's rhythm request
  -> backend seed_path_entries_for_domain(path, cycle, domain) filters by (cycle, domain) only
  -> each track forces its (domain, cycle) seed to the recorded value
```

The defect is structural: `SeedPathPlaybackEntry`, `PlaybackSeedTraceEvent`,
their DTOs, the bridge types, the frontend `SeedPathTracePoint`, and
`seedTraceKey` all lack a track dimension; and `buildParallelPlaybackRequest`
broadcasts one path to all tracks.

### A.2 Design goals

- **Faithful single-track behavior is preserved exactly.** A path recorded and
  replayed in single-track mode must produce byte-identical MIDI to today. This
  is the most-used path and has e2e coverage; we must not regress it.
- **Multi-track replay is correct or honestly disabled.** Either each track
  replays its own recorded decisions, or the feature is clearly gated to
  single-track with a visible reason. No silent wrong behavior.
- **Old patches keep loading.** Seed paths persist in `*.caesura` (schema v3).
  Any field added must be additive with a safe default; no schema bump unless a
  migration is genuinely required.
- **One source of truth.** Recording and replay must use the same track-keying
  rule, or they will drift again (this is exactly how the current bug arose).

### A.3 Options considered

**Option 1 — Track-scoped seed paths (full fidelity).**
Add an optional `track_id` to every seed trace point and seed-path entry.
Recording tags each point with its source track; replay filters entries by
`(track_id, cycle, domain)`; the per-track request only receives that track's
entries. Wildcards gain an optional `track_id` too.

- Pros: the feature works correctly in multi-track; replaying a multi-track
  performance reproduces it; wildcards can target one track. Matches the
  project's parallel-everything direction.
- Cons: largest surface (Rust model + DTO + bridge + UI + persistence + tests).
  Backward-compat care: legacy entries with no `track_id` must still drive a
  single-track replay.

**Option 2 — Gate seed-path record/replay to single-track.**
When more than one track is audible, disable the "record into path" and
"replay/wildcard" affordances with a tooltip ("Seed paths are single-track;
solo a track to record or replay"). Backend unchanged except an assertion.

- Pros: tiny, safe, ships in hours; removes the wrong behavior immediately.
- Cons: removes a capability in multi-track; users lose reproducibility exactly
  where parallel composition is most complex.

**Option 3 — Per-track path objects (N independent paths).**
Each track owns its own `SeedPath` list and records/replays independently; no
shared path. The transport already keeps per-track `RhythmPlaybackConfig`, so
each track's `seed_path` would simply be its own.

- Pros: conceptually clean; no `track_id` on entries (the path *is* the track's).
- Cons: the UI's seed model is currently a single global path list with a
  cross-domain trace view; reworking it into per-track lists is a larger UI
  change than Option 1, and "replay the whole performance" becomes "replay each
  track's path together," which needs orchestration anyway.

### A.4 Recommendation

**Adopt Option 1 (track-scoped entries) as the durable fix, and land Option 2
as an interim guard in the same first phase.** Rationale: Option 2 stops the
live wrong behavior immediately and is independently shippable; Option 1 then
restores the capability correctly without ever re-exposing the broken state.
Option 3's per-track decomposition is more invasive on the UI for no behavioral
gain over Option 1, and Option 1 keeps the existing "one performance, one path"
mental model that the timeline seed view is built around.

The keying rule (the single source of truth) is:

> A seed decision belongs to `(track_id, domain, cycle)`. `track_id` is `None`
> for single-track playback and legacy data. During replay, an entry with
> `track_id == None` matches any track (legacy compatibility); an entry with a
> concrete `track_id` matches only that track. Recording always writes a
> concrete `track_id` in parallel mode and `None` in single-track mode.

This rule makes legacy single-track paths replay unchanged, makes new
single-track paths replay unchanged, and makes multi-track paths track-precise.

### A.5 Change surface (Option 1)

Ordered by dependency. Each layer compiles independently.

**1. Rust model (`crates/cseq-transport/src/lib.rs`)**
- `PlaybackSeedTraceEvent`: add `pub track_id: Option<String>` (and optionally
  `track_index: Option<usize>` to mirror the other playback-event structs).
  Default `None`.
- `SeedPathPlaybackEntry`: add `pub track_id: Option<String>`.
- `SeedPathWildcard`: add `pub track_id: Option<String>`.
- `tag_parallel_playback_events` (already tags ratchet/pitch/ornament/channel):
  extend to also set `track_id`/`track_index` on each `seed_trace` event. This
  is the recording-side tagging and reuses the exact place the other metadata
  is tagged, so the two cannot drift.
- `seed_path_has_wildcard` and `seed_path_entries_for_domain`: add a
  `track_id: Option<&str>` parameter. Match rule: a wildcard/entry matches when
  `entry.track_id.is_none() || entry.track_id.as_deref() == track_id`. The
  single-track call sites pass `None` (their events were recorded with `None`),
  so they behave exactly as today.
- Thread the realizing track's id into `realize_and_enqueue` so its internal
  `seed_path_entries_for_domain(...)` / `seed_path_entry_for_domain(...)` calls
  pass the current `track_id`. In the single-track scheduler path the id is
  `None`; in `realize_parallel_until` it is `Some(track.id)`.

**2. Tauri DTOs (`src-tauri/src/main.rs`)**
- `PlaybackSeedTraceEventDto`: add `track_id: Option<String>` (+ `From` mapping).
- `SeedPathPlaybackEntryDto` and `SeedPathWildcardDto`: add
  `#[serde(default)] track_id: Option<String>` (+ `From` mappings).
- All additive with serde defaults, so older frontends/payloads deserialize.

**3. Bridge (`ui/src/bridge.ts`)**
- Add `trackId: string | null` to `PlaybackSeedTraceEvent`,
  `SeedPathPlaybackConfig` entry, and wildcard types.

**4. Frontend (`ui/src/App.tsx`)**
- `SeedPathTracePoint`: add `trackId: string | null`.
- Recording (`acceptTransportSnapshot` seed-trace append): carry `trackId` from
  the snapshot event into the stored trace point.
- `seedTraceKey`: include `trackId` →
  `${trackId ?? ""}:${cycle}:${domain}:${label}` so multi-track points on the
  same domain/cycle are no longer deduped into one.
- `seedPathPlaybackConfig`: pass `trackId` through into the entries it builds.
- `buildParallelPlaybackRequest` / `rhythmPlaybackRequestFromParallelTrack`:
  instead of passing the whole path to every track, pass the full path object
  but rely on backend filtering (simplest), OR pre-filter the entries to the
  track's id (defense-in-depth). Recommendation: do **both** — pre-filter in the
  UI so the wire payload is small and obviously correct, and keep the backend
  filter as the authority.
- Wildcard editor: allow a wildcard to be scoped to a track or "all tracks"
  (`trackId: null`). Minimal first version may keep wildcards all-tracks.

**5. Persistence (`ui/src/App.tsx` `readPatchDocument` / `normalizeSeedPaths`)**
- `normalizeSeedPaths` already clones trace points; add `trackId` with a
  `null` default. No schema bump: a v3 patch without `trackId` on trace points
  loads as `null`, which replays exactly as legacy single-track behavior.

### A.6 Invariants and tests

Invariants to assert (and keep asserted):

- INV-1: In single-track mode, recorded trace points have `trackId === null`
  and replay is byte-identical to no-path playback under a locked seed.
- INV-2: In multi-track mode, a recorded path contains entries for each audible
  track tagged with that track's id; no two tracks share an entry object.
- INV-3: Replaying a multi-track path makes each track resolve exactly the
  seeds recorded for *that* track; a different track's recorded seed never
  forces this track.
- INV-4: A legacy entry (`track_id == None`) still forces the matching
  `(domain, cycle)` on whichever track replays it (back-compat).
- INV-5: Wildcards scoped to a track skip only that track's recorded entries.

Rust tests (`crates/cseq-transport`):
- `seed_trace_tags_source_track_in_parallel` — realize two tracks, assert each
  emitted trace event carries the correct `track_id`.
- `seed_path_entry_lookup_filters_by_track` — unit test
  `seed_path_entries_for_domain` with mixed `track_id`s incl. `None` legacy.
- `parallel_seed_path_replay_is_track_independent` — record a two-track path,
  replay, assert each track's resolved seeds match its own recorded values and
  that swapping the path between tracks does not cross-contaminate.
- `legacy_untagged_seed_path_replays_single_track` — entries with `track_id ==
  None` reproduce the pre-change single-track realization (guards INV-1/INV-4).

Frontend unit (`ui/tests/timelineModel.test.cjs` or a new pure helper):
- Extract the entry-filtering/`seedTraceKey` logic into a pure function in a
  testable module (mirrors how `selectActiveTrackTimelineLayers` was extracted)
  and test: dedupe no longer collapses cross-track points; per-track filter
  returns only that track's entries plus untagged legacy entries.

e2e (`ui/tests/e2e/`), runnable once the browser is available:
- Record a path with two audible tracks via the mock transport (extend the mock
  to emit per-track-tagged `seedTraceEvents`), replay, and assert the parallel
  playback request carries per-track-filtered seed paths (reference the existing
  `parallel_set_playback` request assertions).

### A.7 Interim guard (Option 2, lands first)

Before the model change ships, add a UI guard so the live wrong behavior stops:

- Compute `seedPathReplaySupported = !hasMultipleParallelTracks` (or
  `audibleTrackCount <= 1`).
- Disable the replay and "record into path" affordances when unsupported, with
  a tooltip explaining solo-to-use. Keep viewing existing paths.
- This is removed (or relaxed to "multi-track supported") in the same PR that
  lands Option 1, so there is never a window of silent breakage.

---

## Part B — Note-group pairing for nested same-pitch/same-channel groups

### B.1 Problem statement

`collect_final_note_groups` (parallel conflict pass) and `matching_note_off_index`
(pitch/hocket re-collection) pair note-on/off events FIFO per
`(track, channel, pitch)`. For strictly sequential notes this is correct. For
two **nested** same-pitch/same-channel note groups on one track
(on1, on2, off, off), FIFO pairs on1↔first-off and on2↔second-off, which swaps
the intended durations.

Today the realize pipeline emits sequential matras per channel, so this does
not trigger. The risk is latent: ratchet + arbitrary-subdivision overlays, or
grace-note injection, could in principle place two same-pitch notes on one
channel that overlap.

### B.2 Design goals

- Correct pairing for any nesting/overlap pattern, not just sequential.
- No behavior change for the common sequential case (and no perf regression on
  the hot scheduler path).
- A test that fails on the swap so the invariant is protected even if a future
  overlay starts producing overlaps.

### B.3 Options considered

**Option B1 — LIFO (stack) pairing instead of FIFO.**
Pair each note-off with the most recently opened matching note-on. This
correctly nests (on1, on2, off→on2, off→on1).

- Pros: one-line change (use a stack pop-back instead of queue pop-front);
  correct for properly nested groups; identical to FIFO for sequential groups.
- Cons: incorrect for *interleaved* (non-nested) overlap (on1, on2, off1, off2)
  where the musical intent is on1↔off1 — but MIDI itself is ambiguous here and
  most engines use LIFO; acceptable.

**Option B2 — Duration-aware pairing.**
Pair by matching each note-on to the note-off that yields the intended
duration, using the originating event metadata (e.g. tie/ratchet group ids).

- Pros: unambiguous even for interleaved overlap.
- Cons: requires carrying explicit pair ids on every note-on/off through all
  passes; large change for a latent risk.

**Option B3 — Guarantee no same-pitch/same-channel overlap upstream.**
Add a debug assertion + an upstream normalization that nudges/merges
overlapping same-pitch groups before pairing.

- Pros: keeps pairing trivial; surfaces the condition loudly in tests/fuzz.
- Cons: "nudging" timing is itself a parity risk; better as a guard than a fix.

### B.4 Recommendation

**Adopt Option B1 (LIFO pairing) plus a debug assertion from Option B3.** LIFO
is the minimal correct change for nested groups and is a no-op for the
sequential case that dominates today. Add a `debug_assert!`-level check (or a
fuzz-only invariant) that flags interleaved same-pitch/same-channel overlap on a
single track, so if a future overlay introduces the genuinely ambiguous
interleaved case we learn about it rather than silently mispairing.

Apply the same LIFO rule in **both** `collect_final_note_groups` and
`matching_note_off_index` so the two pairing sites cannot disagree (a hocket
re-collection that pairs differently from the conflict pass would itself be a
parity bug).

### B.5 Change surface and tests

- `collect_final_note_groups`: change the per-key `pending` from
  `VecDeque<usize>` consumed via `pop_front` to a stack consumed via
  `pop_back` (LIFO). Keep the sort precondition.
- `matching_note_off_index`: it currently scans forward for the first unused
  matching note-off; for nesting we want the off that closes the *most recent*
  open on. Re-express the pitch/hocket collectors to use the same stack-based
  pairing helper as `collect_final_note_groups` (shared function) so there is
  one pairing implementation.
- Tests (`crates/cseq-transport`):
  - `nested_same_pitch_groups_pair_inner_to_inner` — construct on1,on2,off,off
    on one channel/pitch and assert durations are not swapped.
  - `sequential_same_pitch_groups_unchanged` — guards the common case.
  - Extend a fuzz/property check (the repo already fuzzes) to assert pairing
    never produces a negative or zero duration and that on/off counts match.

---

## Sequencing and rollout

Phase 0 (safe, immediate):
- Part A interim guard (Option 2): gate seed-path record/replay to single-track.
- Ship independently; stops the live defect.

Phase 1 (Rust core, behind the same keying rule):
- Part A model + DTO changes (track-scoped entries), back-compat `None` rule.
- Part B LIFO pairing + assertion.
- Land with Rust tests green (`cargo test --workspace`,
  `cargo clippy --workspace --all-targets -- -D warnings`).

Phase 2 (bridge + UI + persistence):
- Bridge types, frontend recording/replay/dedupe/wildcards, `normalizeSeedPaths`.
- Relax/remove the Phase 0 single-track guard (multi-track now supported).
- `pnpm typecheck` + `pnpm build` + timeline unit tests green.

Phase 3 (e2e + docs):
- Extend the mock to emit track-tagged seed traces; add the parallel seed-path
  e2e. Update `docs/AI_HANDOFF.md`, `docs/ARCHITECTURE.md`, and
  `docs/KNOWN_RISKS.md` (seed-path section) to document the track-keying rule.

Each phase is independently revertible. Phase 0 can ship before Phase 1 is
ready; Phases 1–2 must land together for multi-track replay to be exposed.

## Verification matrix

| Change | cargo test | cargo clippy | pnpm typecheck | pnpm build | e2e (local) |
|---|---|---|---|---|---|
| Part A interim guard | — | — | ✓ | ✓ | ✓ |
| Part A Rust core | ✓ | ✓ | — | — | — |
| Part A bridge/UI | — | — | ✓ | ✓ | ✓ |
| Part B pairing | ✓ | ✓ | — | — | — |

Note: the current sandbox has no Rust toolchain and cannot download a Playwright
browser, so `cargo test`/`clippy` and the e2e suite must be run on a dev machine.
Frontend `pnpm typecheck`/`build` and the Node timeline unit tests are runnable
anywhere.

## Risks introduced by the fix

- **Back-compat regressions in single-track replay** if the `None` matching rule
  is wrong. Mitigation: INV-1/INV-4 tests assert byte-identical single-track
  behavior and legacy-entry replay before merging.
- **Record/replay drift** if only one side gets track tagging. Mitigation:
  recording tags inside `tag_parallel_playback_events` (same place as all other
  per-track metadata) and replay filters in `seed_path_entries_for_domain`; both
  are covered by tests, and the keying rule is documented as the single source
  of truth.
- **Pairing change altering existing output** if LIFO differs from FIFO for
  today's data. Mitigation: they are identical for sequential groups (the only
  pattern realized today); `sequential_same_pitch_groups_unchanged` guards this.
