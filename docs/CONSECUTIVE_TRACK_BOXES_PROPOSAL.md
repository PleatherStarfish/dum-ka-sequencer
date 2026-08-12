# Architecture proposal — Track Flow Boxes (multi-lane Track Flow)

This is the definitive architecture proposal for generalizing v1 Track Flow.
The one-shot review checklist was removed during Seqstart extraction.

## Context
v1 Track Flow (shipped, Phases 0–5) gives the project **one** synthetic sequential lane,
`track-flow-main`, that Markov-chooses among the tracks in `trackFlow` mode and plays one at a
time, counting as a single conflict participant. This proposal generalizes that single lane into
**multiple Track Flow boxes.** Each box:

- contains an arbitrary number of member tracks that **alternate** (play consecutively, one per
  cycle), never simultaneously;
- has its **own Markov chain matrix** governing movement between its member tracks;
- is itself a single participant that plays **in parallel** with ordinary parallel tracks and with
  every other box.

In short: a Track Flow box is a v1 Track Flow lane with a name and its own chain, and the v1 single
lane becomes the N = 1 case. But this is **not a 1:1 generalization** — it *reuses the v1 realization
model* (pure resolver, per-source cloned score/cursor, reset, conflict-as-one) while **requiring new,
explicit work** for multi-lane identity, validation split across patch/runtime layers,
behavior-preserving migration, trigger interaction, member audibility, and per-box display events.
The v1 code hard-codes several single-lane seams (lane id/name, priority lookup, seed-path
construction) that this proposal makes per-box. The sections below mark what reuses unchanged vs.
what is genuinely new.

## Binding decisions

These are intentionally settled before implementation:

1. **User-facing and code term:** "Track Flow box." Prefer `trackFlowBoxes` / `TrackFlowBoxConfig`
   over "consecutive" names so the implementation vocabulary matches the shipped feature.
2. **Membership source of truth:** project-level boxes with ordered `memberTrackIds`, not a per-track
   `boxId`.
3. **Member audibility:** muted or solo-hidden members are **pruned from the runtime source list**.
   The authored matrix is restricted/re-indexed to the audible members at request-build time. A
   muted member is not visited silently in v1.
4. **Migration target:** v1 patches migrate to one `id: "main"`, `name: "Track Flow"`, `seed: 0`
   box and must be runtime-equivalent to v1. The serialized request shape changes, so tests should
   assert runtime identity/queue behavior rather than raw JSON byte equality.
5. **Runtime budget:** parallel tracks plus audible box lanes share a conflict-participant cap.

## What the v1 model reuses vs. where new multi-lane work is required
| v1 (one lane) | Generalized (N boxes) |
|---|---|
| `TrackFlowSpec` + `TrackFlowResolver` (`trackflow.rs`) — Markov over member indices | **unchanged** — one spec/resolver per box |
| `ParallelPlaybackConfig.track_flow: Option<TrackFlowPlaybackConfig>` | `track_flow_boxes: Vec<TrackFlowBoxConfig>` |
| `append_track_flow_lane` (lib.rs:1817) appends one `track-flow-main` participant | loop: append one participant per box |
| `track.track_flow: Option<TrackFlowRuntime>` on a runtime participant (lib.rs:1773) | **unchanged** — one such participant per box |
| PASS C (lib.rs:7121) realizes the one lane | PASS C iterates boxes (independent → rayon-parallelizable) |
| `conflict_active_track_count` counts non-silent participants; lane = 1 | each box lane = 1 *present* (non-silent) participant; idle members cost 0 |
| identity split: display=`sourceTrackId`, conflict=`track-flow-main`, seed-path=`track-flow-main:<src>` | per box: conflict=`track-flow-<boxId>`, seed-path=`track-flow-<boxId>:<src>` |
| `validate_track_flow_config` / `trackflow::validate_track_flow_spec` | per-box validation, same checks |
| frontend `track.mode: "parallel"\|"trackFlow"` | track → box membership (see below) |

> **The "loop `append_track_flow_lane`" line is the easy part; the seams are not.** v1 hard-codes
> the lane id (`TRACK_FLOW_LANE_ID`) and name (`"Track Flow"`, lib.rs ~1851), the priority lookup
> against that id (~1847), and the seed-path string (~7170). Generalizing means: derive
> `lane_id`/`name`/`seed_path` **per box** from centralized `trackflow.rs` helpers, look priority up
> by the box's lane id, and pass each box's lane id into PASS C and the seed-path construction.
> Treat this as a refactor of those seams, not a textual `Option`→`Vec` swap.

## Data model

### Membership (frontend patch) — box-centric, single source of truth
Replace the per-track `mode` flag with **project-level boxes that own an ordered member list**:

```ts
interface TrackFlowBox {
  id: string;                 // authored; lane id derives as `track-flow-${id}`
  name: string;               // display ("Box A")
  memberTrackIds: string[];   // ordered; defines chain state indices 0..n-1
  chain: TrackFlowChainState; // weight map keyed by member *track id* (stable)
  seed: number;               // per-box chain RNG seed
}
// ParallelProjectPatch.global gains: trackFlowBoxes: TrackFlowBox[]
```

A track is **parallel** iff it appears in no box's `memberTrackIds`; it is **boxed** iff it appears
in exactly one box. `memberTrackIds` (not a per-track `boxId`) is authoritative because:
(a) it carries member **order**, which the chain matrix indexes; (b) it makes "a track in ≤1 box"
a normalizer invariant rather than a cross-field consistency burden. The normalizer drops a track
id that appears in two boxes (keeping the first) and prunes ids of deleted tracks.

**Member audibility (mute/solo) — explicit v1 decision.** v1 sends only *audible* Track Flow tracks to
the lane: `buildParallelPlaybackRequest` filters `audibleTracks` (mute + solo) **before** selecting
`mode === "trackFlow"` (`playbackRequests.ts` ~898–905). The box request builder must do the same —
a box's runtime `sources` are its **audible** members only; a muted or solo-hidden member is
*dropped from the lane source list*, not alternated-over-silently. Consequences to specify: chain
state indices are over the *audible* member list (muting a member changes the run's state set), and
a box with no audible members contributes no lane (omitted, like an empty box).

The rejected alternative is to keep muted members in the chain and send them as `silent: true`
sources. That preserves the authored matrix under mute, but it is not a small reuse of the existing
silent-source path: v1 conflict-count semantics are static over present non-silent runtime
participants. A lane that sometimes visits a silent member would either count as an active conflict
participant while intentionally emitting no notes, or require a new dynamic conflict-count model
where a lane's participant status changes per selected source. That is a larger semantic change
than this proposal needs. A future "structural gaps / visit silently" option can be designed as an
explicit feature; v1 boxes preserve the shipped Track Flow audible-source model.

**Chain authored by track id, sent as indices — and pruned to the audible members.** The per-box
matrix is stored keyed by member track id (stable across reordering/membership edits) and converted
to the backend's index-based `TrackFlowSpec` at request-build time — exactly how the rhythm/channel
-hocket matrices already work (frontend stores by key; the request builder emits indexed
transitions). v1's single uniform default becomes the default for a box with no authored chain.

Because the realized state set is the **audible** members (mute/solo can remove members at request
time), the conversion must **prune against the audible set**, or the generated spec fails v1's
validator (`trackflow.rs` `validate_track_flow_spec` ~137 rejects `state_count` mismatch and
out-of-range states): re-index transitions/entry/fallback to the audible-member positions, **drop**
any transition/entry whose context or target references a removed member, and remap `fallback` to a
surviving member (or the uniform default if it was removed). Equivalently: build the spec from the
authored chain *restricted to the audible members*. A box with one audible member ⇒ a trivial
1-state spec; zero audible ⇒ no lane.

### Backend DTO (`crates/cseq-transport/src/lib.rs`)
```rust
// ParallelPlaybackConfig: replace `track_flow: Option<TrackFlowPlaybackConfig>` with
pub track_flow_boxes: Vec<TrackFlowBoxConfig>,

pub struct TrackFlowBoxConfig {
    pub id: String,                                   // lane id = format!("track-flow-{id}")
    pub name: String,                                 // display / snapshot label
    pub sources: Vec<ParallelPlaybackTrackConfig>,    // ordered members (reuse v1 source shape)
    pub spec: Option<trackflow::TrackFlowSpec>,       // None ⇒ uniform first-order
    pub seed: u64,
}
```
(`TrackFlowPlaybackConfig` is renamed/absorbed into `TrackFlowBoxConfig` + box identity.) The
runtime DTO intentionally carries the **audible runtime sources**, not the full authored
`memberTrackIds`; full membership validation belongs to the frontend patch normalizer.

## Identity model (generalized; do not collapse)
- **Conflict slot** per box: `track-flow-<boxId>` (v1's `track-flow-main` = box id `main`).
- **Seed-path** per realization: `track-flow-<boxId>:<sourceTrackId>`.
- **Display**: box name + chosen `sourceTrackId` ("Box A → Track 3").

Reservation generalizes: today `is_reserved_track_id` reserves the exact id `track-flow-main` and
the prefix `track-flow-main:`. Change it to reserve the **`track-flow-` family**: an authored
parallel-track or member id may not equal `track-flow-<anything>` nor start with `track-flow-`.
Box ids are validated to (a) be unique, (b) be non-empty, (c) **not contain `:`** so the composite
seed-path `track-flow-<boxId>:<sourceId>` parses unambiguously, and (d) produce a lane id that
collides with no authored track id. Keep the lane-id construction centralized in `trackflow.rs`
(`fn lane_id(box_id) -> String`, `fn seed_path_id(box_id, src) -> String`).

## Validation — split by what each layer can see
The transport DTO carries only **audible runtime sources** (per the audibility rule), so it cannot
see a muted member duplicated across boxes. Split validation by layer accordingly — do **not** ask
the backend to validate authored membership it never receives:

- **Backend (transport validator, the security boundary)** — validates the *submitted runtime
  config*: reject duplicate **box ids**; duplicate **derived lane ids** (`track-flow-<boxId>`) —
  critical, because `from_config` keys `track_indices` by runtime id (lib.rs ~1950) and a dup lane
  id silently collapses matrix/priority lookups; empty / `:`-containing / reserved box ids; the
  **same runtime source id appearing in two boxes' source lists**; plus v1's per-box checks (≥1
  source, no triggered sources, dup source ids within a box, spec valid against the box's *source*
  count) generalized per box.
- **Frontend patch normalizer (sees full authored membership)** — enforces what the DTO can't: a
  track id appears in **at most one box's `memberTrackIds`** (including muted/solo-hidden members),
  unique box ids, the `track-flow-` reservation, and box-id sanitization (non-empty, colon-free),
  applied **after** normalization so reservation can't be bypassed by an unsanitized id.

### Global caps (new — v1 only caps per-lane)
v1 caps parallel tracks at 16 before appending the single Track Flow lane (lib.rs ~813), and caps a
single lane's sources at 64 (~905). Multi-box needs **global** caps, enforced in the backend
validator:
- **Total runtime conflict participants** (parallel tracks **+ box lanes**) ≤ **16** — this is the
  constrained resource (conflict math, MIDI 1–16); a box lane counts as one participant, so boxes
  reduce the parallel-track budget. This is stricter than the raw v1 transport shape, but it keeps
  the app's conflict and UI resource model bounded.
- **Audible sources per box** ≤ 64 (keep v1's per-lane cap).
- **Total audible box sources across all boxes** ≤ a generous bound (e.g. 256) to cap realize work.
Confirm the exact numbers in the remaining product decisions.

## Runtime (`realize_parallel_until`)
- `from_config` builds parallel participants as today, then appends **one lane participant per
  box** (generalize `append_track_flow_lane` into a loop), each holding a `TrackFlowRuntime`
  (resolver + ordered sources + own cycle clock).
- **PASS C** generalizes from "the lane" to "for each box lane": resolver picks the next member →
  realize that member's next cycle under `track-flow-<boxId>:<src>` → merge under the box's lane
  identity → the single existing conflict/hocket/finalize pass treats each box as one participant.
- Boxes are mutually independent before merge (separate sources, resolvers, clocks), so the
  per-box realization work in PASS C is rayon-parallelizable like PASS A. Determinism requires an
  ordered merge by runtime participant index. The shared append, conflict resolution,
  channel-hocket/finalize, and alternate-offset updates still happen once after all cycle-local
  batches have been merged.
- `reset_realization` resets every box (resolver `reset()`, per-box cycle index, per-member
  cursors).

## Conflict / priority / channel-logic
Each box lane is a real `ParallelRuntimeTrack` participant (as v1's single lane is). Note the exact
v1 semantics: `conflict_active_track_count` (lib.rs ~2015) counts **every non-silent runtime
participant** — not only those with a note at the current tick — so each box lane counts as one
*present* participant for count-based policies (And/Nand/Majority/…), while its idle source members
(inside the lane, not in `config.tracks`) count as zero. Each box can be a channel-logic matrix
endpoint (the Phase-2 fix that allowed `track-flow-main` generalizes — accept any
`track-flow-<boxId>` whose box exists), and takes a conflict-priority rank. Boxes playing in
parallel is automatic: N independent participants in the same conflict pass.

## Trigger interaction (must be made explicit)
v1 keeps Track Flow and triggered tracks disjoint: the request builder excludes Track Flow tracks
from the parallel participant/silent-source computation (`playbackRequests.ts` ~904) and the
backend rejects triggered lane sources (lib.rs ~929). The box model must preserve this on **both**
edges of the trigger graph: a boxed track (a) cannot be a triggered follower, and (b) cannot be
selected as another track's trigger **source**. Concretely: drop boxed tracks from the trigger
source pickers (frontend) and from `normalize_track_modes`/trigger-graph normalization, and keep
the backend rejection of triggered box members (generalized per box). A track moving into a box
clears its trigger (mirrors the Phase-5 toggle, which already nulls `trigger` on `trackFlow`).

## Frontend
- **Box management** (project scope): create/rename/delete boxes; the per-track control becomes
  "Parallel / Box A / Box B / …" (assign the active track to a box or back to parallel). Generalize
  the Phase-5 `track-mode-select`, but change the setter shape: the active-track control now reads
  box membership from `project.global.trackFlowBoxes` and mutates box `memberTrackIds`, not
  `track.mode`.
- **Per-box chain matrix editor**: reuse the existing Markov-matrix editor used for rhythm/channel
  hocket — author transitions between the box's member tracks. v1 had no editor; this is the main
  *new* UI surface.
- **Request builder** (`buildParallelPlaybackRequest`): group boxed tracks by box → emit one
  `TrackFlowBoxConfig` per box (audible ordered members, indexed chain, seed); exclude members
  from `tracks`. Three normalizations must include the box lane ids, not just `project.tracks`:
  - **Conflict priority** against parallel tracks **plus** box lane ids (extend the Phase-4 P1 fix).
  - **Channel-logic matrix** — today `normalizeChannelLogicMatrix` (`patchIo.ts` ~1921) drops any
    endpoint not in `project.tracks` (`playbackRequests.ts` ~995), which would silently delete every
    authored box-lane rule. Normalize against parallel track ids **plus existing box lane ids** so
    `track-flow-<boxId>` endpoints survive (matching the backend's Phase-2 endpoint acceptance).
  - **Seed-path lookup per source** — v1 looks a source's recorded seed path up by the **bare**
    track id (`seedPathConfigForTrack(seedPath, track.id)`, `playbackRequests.ts` ~944), but a
    boxed source records/replays under the **composite** id `track-flow-<boxId>:<sourceId>` (backend
    replay needs an exact concrete-id match, lib.rs ~5068, and PASS C rewrites the seed trace to the
    composite, ~7201). So box sources must look up their seed-path config by
    `track_flow_seed_path_id(boxId, sourceId)`, not the bare id, or replay silently no-ops.
- **Display indicator**: the deferred v1 indicator (task #44) generalizes to one "Box → Track N"
  readout per box. **This needs an event-shape change, not just DTO plumbing.** Today
  `TrackFlowPlaybackEvent` (lib.rs ~324) carries only `cycle`/`reference_start_tick`/source — no
  lane/box id — PASS C pushes none (~7204), and `record_cycle` drops `track_flow` entirely
  (layers.rs ~441). Multi-box surfacing requires: add a `lane_id`/`box_id` to the event, push it in
  PASS C, keep it through `record_cycle` → `PlaybackLayers` → `TransportSnapshot` → DTO → bridge,
  then group by box in the UI. (Doing the event-id addition *now*, even before the indicator ships,
  avoids a later breaking change.)

## Migration from v1 (must be runtime-equivalent)
v1 patches have `track.mode: "trackFlow"`. Migrate all `trackFlow` tracks into a **single default
box** with the v1 lane's exact identity so existing projects behave the same at runtime:
- `id: "main"` → derived lane id `track-flow-main` (preserved).
- `name: "Track Flow"` — **not** "Box 1". v1 appends the lane with the name `"Track Flow"`
  (lib.rs ~1851) and `track_positions` exposes that name in snapshots (lib.rs ~2059); a different
  name changes the runtime label.
- `seed: 0` — v1's request builder uses the fixed `TRACK_FLOW_LANE_DEFAULT_SEED = 0`
  (`playbackRequests.ts` ~889, ~988); the default box must carry the same seed or the chain walk
  diverges.
- no authored chain ⇒ the same uniform first-order default.

Drop the `mode` field after migration (or keep it as a derived read-only compat shim for one schema
version). The serialized request shape changes from `trackFlow` to `trackFlowBoxes`, so do not
write brittle raw-JSON byte-equality tests. Add migration tests that prove semantic equivalence:
same lane id/name/seed/sources/order, same trigger separation, same participant counts, and same
queued playback / seed-trace signatures for representative v1 Track Flow projects.

## Phasing (each independently verifiable, mirrors the v1 phase discipline)
1. **Backend multi-lane** — `Option<TrackFlowPlaybackConfig>` → `Vec<TrackFlowBoxConfig>` + box
   ids; refactor the hard-coded lane seams (id/name/priority/seed-path) into per-box centralized
   helpers; PASS C over boxes; generalize identity/reservation; **backend cross-box validation**
   (dup box/lane ids, duplicate runtime source ids across box source lists); generalize trigger
   rejection per box; **add a `lane_id` to `TrackFlowPlaybackEvent` now** (so the later indicator
   isn't a breaking change).
   Reuse all v1 tests; add multi-box tests (two boxes alternate independently, each one conflict
   participant, seed-paths distinct, dup-lane-id rejected).
2. **IPC + request builder** — DTO `trackFlowBoxes` / Rust `track_flow_boxes`;
   `buildParallelPlaybackRequest` grouping
   over **audible** members only (mute/solo, matching v1); bridge types; box membership in the
   patch + migration (runtime-equivalent: id `main` / name "Track Flow" / seed 0); the patch
   normalizer validates full authored membership, including muted members; trigger source pickers
   exclude boxed tracks; dtoContract fixture refresh + a v1→box migration behavior test.
3. **Chain matrix editor + box management UI** — assignment control + per-box matrix editor.
4. **Per-box display indicator** (folds in task #44, generalized).

## Remaining product decisions
1. **Exact caps:** confirm the shared conflict-participant cap is 16, per-box audible sources stay
   capped at 64, and total audible box sources are capped at 256.
2. **Priority and channel-matrix UI:** box lanes are runtime participants; decide whether the UI
   lists them in the same selector as tracks or in a grouped "Track Flow boxes" section.
3. **Empty authored boxes:** recommended behavior is to allow empty boxes as UI drafts / saved
   structure, but omit them from runtime requests until they have at least one audible member. A
   one-member box is valid and simply chooses that member every cycle.

## Acceptance criteria
1. v1 Track Flow projects migrate to one `main` Track Flow box and produce the same runtime lane id,
   label, seed, source order, conflict participant behavior, queued playback, and seed trace
   signatures as v1.
2. Two or more boxes can run concurrently; each resolves independently, each counts as one
   non-silent runtime participant, and the merged cycle-local batch still goes through one
   conflict/channel-hocket/finalize pass.
3. Box identity is never collapsed: display uses box name + source id, conflict/matrix/priority use
   `track-flow-<boxId>`, and seed replay uses `track-flow-<boxId>:<sourceTrackId>`.
4. Validation is split correctly: the frontend normalizer enforces full authored membership
   invariants, while the backend validates only submitted runtime boxes and rejects duplicate box
   ids, duplicate lane ids, duplicate runtime source ids across boxes, empty submitted boxes,
   triggered box sources, and invalid specs.
5. Muted or solo-hidden members are pruned from the runtime source list and the authored chain is
   restricted/re-indexed to the audible member set. They are not visited silently in v1 boxes.
6. Boxed tracks are excluded from ordinary `tracks`, silent-source computation, trigger followers,
   and trigger source pickers. Moving a track into a box clears its trigger.
7. Conflict priority, channel-logic normalization, seed-path lookup, and display events all accept
   arbitrary box lane ids, not only `track-flow-main`.
