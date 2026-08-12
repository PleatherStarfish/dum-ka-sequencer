# Channel Logic — Semantics Specification

Date: 2026-07-07 · Source of truth for the parallel channel-conflict seam.
Derived line-by-line from code at today's tree and reviewed against the invariant suite;
line anchors will drift, section structure should not. Sections marked **⚠** describe
verified defects or hazards scheduled for change by `CHANNEL_LOGIC_PLAN.md` — until that
work lands, the code behaves exactly as written here. The decision log (§11) records the
open semantic decisions; nothing marked *pending* there may be "fixed" in code without a
recorded decision.

Related: `CHANNEL_LOGIC_PLAN.md` (hardening + UI plan), `ARCHITECTURE.md` §parallel,
`UI_AND_INTERACTION.md` :207-244 (panel spec), `GLOSSARY.md` (Channel Logic entry),
`KNOWN_RISKS.md` §Parallel Channel Conflict Resolution.

---

## 1 · What channel logic is

Channel logic is the **collision resolver for parallel playback**. After every participant
(parallel track, triggered follower, Track Flow box lane) is realized and merged into the
transport queue, final note groups whose sounding spans transitively overlap **on the same
user-facing MIDI channel** form an *overlap component*, and a policy decides which tracks in
that component pass; the rest are suppressed (note-on and note-off removed together, before
dispatch). The timeline never re-derives this: suppressed metadata is flagged so the UI
ghosts exactly what the queue dropped.

It is distinct from the **Channel Shaper (channel hocket)**, which *assigns* each note's
output channel per track earlier in the pipeline. Hocket decides where notes land; channel
logic decides who survives a landing collision. Channel logic only exists on the parallel
path — the single-track path sends no channel-logic fields and runs no conflict pass.

Pipeline position (per track): rhythm → ratchet → ornament → pitch → static routing /
channel hocket → merge into shared queue → **channel logic** → note-off deferral →
dispatch (with a scheduler-side stuck-note sweep as defense in depth, §3.7).

## 2 · Data model

**Engine** (`crates/cseq-transport/src/lib.rs`):

- `ChannelConflictPolicy` (:508) — 18 variants (§4).
- `ChannelLogicMatrixEntry` (:530) — `track_a_id`, `track_b_id`, `output_channel:
  Option<u8>` (1–16; `None` = legacy **all-channel** pair rule), `policy`.
- `ParallelPlaybackConfig` (:560) carries `channel_conflict_policy`,
  `channel_logic_matrix: Vec<_>`, `conflict_priority: Vec<String>`.
- Runtime compile (`from_config` :2379, `apply_in_place` :2562): the matrix becomes
  `HashMap<(usize, usize, Option<u8>), ChannelConflictPolicy>` keyed by **unordered track
  position pair** (`channel_logic_key` :7634 sorts the pair; channels clamped 1–16).
  Entries whose ids don't resolve to distinct current participants are **silently dropped**
  at compile time (`filter_map`). `conflict_priority` compiles to `priority_rank` = index in
  the list; ids omitted from the list fall back to track position (:2551, same in
  `from_config`).
- `alternate_offsets: [usize; 16]` (:2136) — mutable per-channel rotation counters for the
  `Alternate` policy. Reset to zero on **every** accepted config application: `from_config`
  (:2401) *and* `apply_in_place` (:2667). Since every live edit re-pushes the config (§6),
  any mid-play edit resets Alternate rotation.

**Wire** (`src-tauri/src/main.rs`): `ChannelConflictPolicyDto` (:1421, camelCase strings —
`allowAll`, `xor`, …), `ChannelLogicMatrixEntryDto` (:1469, camelCase,
`outputChannel` defaulting to `null`), assembled at :2500-2517. All 18 policies are legal on
the wire.

**Frontend** (patch JSON, FE-owned — Rust persistence never sees these fields):
`project.global.{channelConflictPolicy, channelLogicMatrix, conflictPriority}`
(`ui/src/patchIo.ts:1058`), normalized on load/import/track-edit and again at request build
(§8). Single-track default: `priorityOrder`, empty matrix, `[trackId]` (:1756).

**Participants.** The compiled track list = parallel tracks plus one synthetic lane per
Track Flow box (`track-flow-<boxId>`), capped at **16 total** (validation :964). Box lane
ids are legal matrix/priority endpoints (:989). *Silent sources* (muted/solo-hidden tracks
realized only to drive triggered followers) are participants but are excluded from the
count-based denominator (§4) — a muted source must not change audible conflict math
(`conflict_active_track_count` :2675).

## 3 · The resolution pipeline

`apply_parallel_channel_conflicts_for_keys` (:7944), sole production call site
`realize_parallel_until` :8398 — runs on every realize-ahead batch (initial window at Play,
then the tick loop), always **before** the affected ticks can dispatch.

1. **Sort queue, collect final note groups** (:7949). Grouping walks the queue pairing
   note-offs to note-ons per `(track_index, user_channel, pitch)` — **LIFO**: an off closes
   the most recently opened on (:7473-7484). For sequential notes this equals FIFO; for
   nested same-pitch groups it pairs inner-to-inner instead of swapping durations. Events
   without parallel track / user channel / pitch, and offs with no pending on, join no group
   and are never touched by this pass.
2. **Gate**: if `conflict_active_track_count() <= 1`, skip suppression entirely (no
   decisions logged). Note the **note-off dedup (step 6) still runs** — same-pitch overlap
   merging applies even to a lone audible participant.
3. **Overlap components** (`channel_overlap_components` :7507): groups sort by
   `(channel, start_tick, span_end, track, pitch)`; a sweep per channel unions groups whose
   spans transitively overlap. Span = `max(end_tick, start_tick + 1)` (:7499) so zero-length
   groups occupy one tick. A new component starts when the channel changes or
   `start >= current_end`. Touching-at-a-boundary (start == previous end) does **not**
   collide. Components are *transitive*: A–B overlap + B–C overlap puts A and C in one
   component even if A and C never touch.
4. **Incremental scope** (`only_keys`): on realize-ahead batches the pass receives the keys
   of newly appended groups; a component is resolved iff **any** of its groups is new, and
   then it is resolved **wholesale** — previously passed, not-yet-dispatched groups can be
   re-suppressed when a new group joins their component (and component `start_tick`, hence
   `RandomOne`'s hash input, can change). **R9 guard** (A3): a component whose `start_tick`
   is at or behind `config.dispatch_horizon_tick` (the scheduler's current playhead, 0 in
   tests/Play-init) is **skipped** — its note-ons may already be on the wire, so
   re-suppressing them would strand notes.
5. **Decide + suppress**: distinct tracks in the component (`by_track`) → `collision_count`;
   `matrix_allowed_tracks` (§5) returns the surviving track set. Every event index of every
   group of a non-surviving track is removed — **on and off together, atomically** (:8047).
   Metadata is stamped on queue events (`parallel_conflict`) and a
   `ParallelConflictDecision` ledger row is emitted per (track, group) when
   `should_log = policy ≠ AllowAll || collision_count > 1 || matrix used` (:7988). Decision
   rows feed the UI's "Parallel conflicts" debug table; `conflict_group_id` =
   `"<component_start>:<channel>"`.
6. **Note-off deferral** (:8060+): after removal the queue is re-sorted and groups
   re-collected; `defer_premature_same_pitch_note_offs` then moves any group's note-off that
   another surviving group with the **same channel and pitch strictly spans**
   (`other.start < off_tick && other.end > off_tick`) forward to the **end of the transitive
   overlap chain** (the fixpoint tick no surviving same-pitch span strictly contains), and
   re-sorts if anything moved. Overlapping same-pitch surviving notes therefore merge into
   one sustain on last-off receivers — audibly identical to the pre-2026-07-07 behavior,
   which *dropped* those offs — while every note-on keeps exactly one closing off (the drop
   was the root of the stranded-off/hung-note family, **R1, fixed 2026-07-07**). Deferral
   only moves offs forward in time and is a no-op once every off sits at its chain's end, so
   incremental re-resolution is safe and idempotent. It runs project-wide (across tracks and
   components) and unconditionally (step 2's gate does not cover it).
7. **Runtime stuck-note sweep** (scheduler loop, defense in depth): after each newly
   realized window, any sounding note whose dispatch-ledger count plus queued ons minus
   queued offs is positive for its (wire channel, pitch) is **provably stuck** — offs enter
   the queue with their on's realize batch and afterwards only move forward or leave
   group-atomically — and is released immediately with a warning log and a
   `stuck-note sweep note-off` MIDI debug row (`stuck_note_residue`). Long ties are never
   flagged (their offs are queued). This must stay silent in a healthy engine; a hit is a
   contained regression, not a tolerable state.

## 4 · Policy semantics (group-wise, the default path)

`collision_allowed_tracks` (:7768). Inputs: the component's distinct-track list
(`collision_count = k`), `active = conflict_active_track_count()` (non-silent participants,
project-wide — **not** component-local), and for winner policies the collision tick +
channel. Solo components (k = 1, including a single track overlapping itself) **are**
evaluated whenever the pass runs.

| Policy | Survivors (k tracks colliding, `active` = A) | Solo component (k=1, A≥2) |
|---|---|---|
| `forceOn`, `allowAll`, `or` | all | pass |
| `forceOff` | none | **suppressed** |
| `randomOne` | 1 winner: `track_indices[splitmix(start_tick, channel) % k]` (:7602) | pass |
| `alternate` | 1 winner: `track_indices[ordinal % k]`, ordinal = this collision's rank among same-(channel, cycle) collisions | pass |
| `priorityOrder` | 1 winner: min `priority_rank` (:7618) | pass (it is its own winner) |
| `xor` | all iff k = 1, else none | pass |
| `xnor` | all iff k ≥ 2, else none | **suppressed** |
| `and` | all iff k = A, else none | suppressed unless A=1 (gated) |
| `nand` | none iff k = A, else all | pass (A≥2) |
| `nor` | none, always | **suppressed** |
| `even` | all iff k even | **suppressed** |
| `odd` | all iff k odd | pass |
| `oneHigh` | all iff k = 1 — **byte-identical to `xor`** (:7855) | pass |
| `oneLow` | all iff A − k = 1 (:7862) | pass iff A = 2 |
| `majority` | all iff 2k > A (:7869) | suppressed for A ≥ 2 |
| `minority` | all iff 2k < A (:7876) | pass iff A ≥ 3 |

Determinism notes:

- **`randomOne`** hashes only `(component start_tick, user_channel)` — SplitMix-style
  (:7602). Track identities enter via count and sort order only. Same realized score → same
  winners; the winner *index* is shared by every evaluation at the same (tick, channel).
- **`alternate`** (D2 = Oc1, fixed 2026-07-07). The winner index is
  `alternate_ordinal % k`, where `alternate_ordinal` is **this collision's rank among the
  resolved multi-track collisions on the same (user channel, reference cycle), in start
  order** — derived structurally from `config.alternate_resolved` (a set of resolved
  collision start ticks per channel+cycle), not from a mutable counter. Every k ≥ 2
  component counts as one collision regardless of the policy that resolved it; a component's
  ordinal is shared by its default-base evaluation and any explicit `alternate` rule on its
  pairs. Consequences: rotation is **per collision** (not per pair), **cycle-local** (resets
  each reference cycle), **independent of matrix shape** (the ordinal never consults the
  matrix — proven by `parallel_irrelevant_matrix_entry_is_a_no_op`), and **live-edit-stable**
  (the set is cleared on config swap, but already-resolved winners are frozen in the queue
  and future cycles restart at ordinal 0 deterministically). The insert is idempotent, so
  incremental re-resolution never double-advances. **Residual**: under per-track *tempo
  jitter*, cross-cycle overrun can make collisions first appear out of start order across
  realize batches, so the rank a collision receives reflects arrival order rather than strict
  start order (still cycle-local and matrix-independent; note balance is unaffected — see §9
  and the R3 note). For uniform tempo the ordinal is exactly start-ordered.
- **`priorityOrder`** never suppresses everything: some track has the min rank. Ranks come
  from `conflictPriority` order; omitted ids rank by track position.

## 5 · Matrix composition (D1 = O3, fixed 2026-07-07)

`matrix_allowed_tracks` (`:7966`) returns `(allowed, ruled)` — the survivor set and the
subset of component tracks an **explicit** rule governed (the caller labels a track
`channelLogicMatrix` only when it is in `ruled`, §7):

```
S0 = collision_allowed_tracks(default, component_tracks, active)   // group-wise, ALWAYS (§4)
if matrix empty OR component has ≤1 track → return (S0, ruled = ∅)
rescued = ∅ ; vetoed = ∅ ; ruled = ∅
for each unordered pair (a,b) of the component's tracks:
    policy = matrix[(a,b,Some(channel))]  ?? matrix[(a,b,None)]  ?? (no entry → SKIP the pair)
    V = collision_allowed_tracks(policy, [a,b], active = 2)
    for m in {a,b}: ruled += m ; if m ∈ V { rescued += m } else { vetoed += m }
allowed = (S0 ∪ rescued) − vetoed        // veto dominates rescue
```

Three properties this gives:
- **The default always runs group-wise** on the whole component with the true `active`
  denominator (S0), matrix present or not. There is no longer a separate "pairwise path".
- **Unmatched pairs are skipped, not defaulted-pairwise.** A rule elsewhere in the project
  cannot change how the default treats an unruled component ⇒ *empty matrix ≡ a matrix of
  irrelevant rules* (invariant `parallel_irrelevant_matrix_entry_is_a_no_op`).
- **An explicit rule is authoritative for its pair**: it can **rescue** a pair the default
  suppressed (e.g. `Layer`/`allowAll` rule under an `xor` default → both sound) or **veto**
  a track the default allowed (e.g. `forceOff` rule under `allowAll` → those two drop).
  Veto wins ties.

Worked examples (unit-pinned in `parallel_channel_logic_*` tests):
- `xor` default + `allowAll(A,B)`: S0=∅, rescue → **{A,B}**.
- `allowAll` default + `forceOff(A,B)` over {A,B,C}: S0=all, veto {A,B} → **{C}** (C's
  decision keeps the `allowAll` label — it was never ruled).
- `and` default (active=3) over a 2-track component {A,B} + a rule on an **unused channel**:
  S0=∅ (k=2≠3), no pair matches → **∅** (pre-O3 this passed both — the fixed cliff).

**The degeneration table now describes EXPLICIT rules only** (a rule's policy evaluated on
its 2-track pair, `active=2`). It no longer leaks to unruled pairs:

| Rule policy on a pair | Pair result (k=2, A=2) | Effect as a rule |
|---|---|---|
| `forceOn`, `allowAll`, `or` | pass both | rescue both |
| `forceOff`, `nor` | suppress both | veto both |
| `xor`, `nand`, `odd`, `oneHigh`, `oneLow`, `minority` | suppress both | veto both (≡ `forceOff`) |
| `xnor`, `and`, `even`, `majority` | pass both | rescue both (≡ `allowAll`) |
| `randomOne` | one winner (hash index) | rescue winner, veto loser |
| `alternate` | one winner (counter) | rescue winner, veto loser (see R3/§4) |
| `priorityOrder` | higher-priority member | rescue winner, veto loser |

This is exactly why the FE offers only `allowAll`/`forceOff`/`randomOne`/`alternate`/
`priorityOrder` as rule policies (spec §8, *rule projection*): every other policy collapses
to `allowAll` or `forceOff` at the pair level, and the projection is now contract-pinned
(A4).

Notes on winner policies **as the default** (S0), unchanged by O3: `randomOne`/`alternate`
still pick one group-wide winner over the whole component (no middle-track exclusion — that
was a pairwise-composition artifact, now gone); `alternate` statefulness is R3 (spec §4),
addressed by A3. Mixing a thinning default with a rescue rule is legal and additive: e.g.
`randomOne` default picks C in {A,B,C} while `allowAll(A,B)` rescues A,B → **{A,B,C}**
(documented so it reads as intentional, not a bug).

## 6 · Validation and the FE/BE contract

**Engine validation** (`validate_parallel_playback_config` :964-1051, run on every Play and
every live push, :6495): rejects >16 participants, duplicate track ids, self-pair entries,
out-of-range channels, entries naming unknown endpoints (box lane ids are known), and —
policy-blind — **duplicate `(unordered pair, outputChannel)` keys**: the same pair+channel
twice is an error *even with identical policies*. A `None` (all-channel) entry and a
`Some(ch)` entry for the same pair are distinct keys and legal; precedence (§5) resolves
them.

**FE blocking — removed 2026-07-07 (D4).** The editor no longer lets a contradictory rule
set exist: `nextChannelLogicMatrixForToggledChannel` moves a channel's ownership (drops the
(pair, channel) key from every rule before re-adding), and `normalizeChannelLogicMatrix`
dedups duplicate keys as a load-time backstop, with `channelLogicMatrixRepairCount` driving
a one-time "resolved N conflicting rules" notice. Because ambiguity is unrepresentable,
`channelLogicConflictMessagesForProject`, the Play gate, and the transport warning banner
are deleted — channel logic never blocks playback. Engine `validate_parallel_playback_config`
remains the wire-level backstop (it rejects a duplicate (pair, channel) key), but a
reducer-produced matrix can never reach it in that state.

Known contract edges (spec'd, not yet test-pinned — see plan A4/A5):

- FE normalization does **not** dedup byte-identical entries; reducers can't produce them,
  but a hand-edited patch with exact duplicates passes the FE gate and is rejected by the
  engine at Play/push (surfaced as a playback error).
- FE conflict expansion of `None` entries depends on the FE's *predicted* reachable
  channels (§8); a prediction miss changes what the FE blocks, never what the engine does.

**Live editing.** Channel-logic fields are in the "safest family" tier: while a parallel
runtime is playing, any project edit rebuilds the full request and re-pushes it deduped
(`App.tsx:3484-3517`) with `nextCycle: true`. The transport applies it in place when
topology matches (`apply_in_place` :2530): matrix rebuilt against live track positions,
priority ranks reset (omitted ids → track position), and the **Alternate rotation memory
clears** (`alternate_resolved`). Edits land at the next un-realized cycle; already-realized,
not-yet-dispatched cycles keep their prior resolution (except §3.4 wholesale re-resolution
when new groups join a component). Clearing the Alternate memory is safe: future cycles
restart at ordinal 0 deterministically, and already-resolved winners are frozen in the queue,
so a live edit never re-phases a decision already heard.

## 7 · Timeline parity and observability

The timeline renders realized truth; parity is achieved by flagging, not re-deriving:

- `flag_suppressed_playback_metadata` (:8665) marks ratchet / ornament / pitch /
  channel-hocket metadata events as suppressed when their track's decision at the same
  reference tick failed. Mapping: each metadata event's local-cycle start tick is forward-
  mapped through the same per-cycle tempo map that produced the queue
  (`timing_windows`), then matched against the suppressed set keyed
  `(track_index, reference_start_tick)` with **±1 tick tolerance** for rounding (:8700).
  Ornaments anchor to their target note's start. The key is deliberately coarse — channel
  and pitch are not part of it, so two same-track events starting on the same tick share a
  suppression verdict.
- The decision ledger (`playback_events.parallel_conflict`, §3.5) is the authoritative
  record of every pass/suppress with policy, action label, component id, colliding track
  ids, and the active count. **Labels are per track** (O3): a track reads
  `channelLogicMatrix` / `matrix-pass|matrix-suppress` only when an explicit rule governed
  it (it was in `ruled`); tracks the group-wise default alone decided carry the default
  policy's own label and action — so a mixed component shows both, honestly attributing
  each track. The UI's collapsed "Parallel conflicts" debug table (`App.tsx:9606`) renders
  it verbatim (raw policy ids — vocabulary unification is plan B0).

## 8 · Frontend model, projections, and prediction

**Normalization** (`normalizeChannelLogicMatrix`, `patchIo.ts`) runs on patch load,
import remap, track add/remove, every reducer, and request build. It drops entries with
unknown/self/absent track ids, maps each entry's policy through the **rule projection**
(below), orders each pair, and sorts deterministically. Since D3 (2026-07-07) it **keeps
rules whose policy equals the current default** (shown "= default") — no more delta-culling,
so changing the default never erases per-pair intent. Since D4 it **dedups duplicate
(pair, channel) keys**, keep-first in sort order (the load-time repair; `collectValidChannelLogicEntries`
+ `channelLogicMatrixRepairCount` expose the pre-dedup set and drop count).

**The two projections** (`patchIo.ts:2087, :2110`) collapse the 18-policy wire enum to what
the UI offers:

- *Default projection* (9 usable): `forceOn`/`or`→`allowAll`, `oneHigh`→`xor`,
  `forceOff`/`nor`/`nand`/`oneLow`→`xnor`, `even`/`odd`→`majority`; identity otherwise.
  Lossy approximations of legacy defaults — e.g. `nand` ("all-but-consensus") becomes
  `xnor` ("overlap only"), `odd` becomes `majority`.
- *Rule projection* (5 usable): `forceOn`/`or`/`and`/`xnor`/`even`/`majority`→`allowAll`;
  `xor`/`nand`/`nor`/`odd`/`oneHigh`/`oneLow`/`minority`→`forceOff`; identity for
  `allowAll`/`forceOff`/`randomOne`/`alternate`/`priorityOrder`.
  **This is exactly the engine's rule degeneration table (§5)** — the FE projection and the
  engine's explicit-rule k=2/A=2 evaluation must agree policy-by-policy. They do today
  (verified by hand); plan A4 pins it with a generated fixture. Legacy policies in loaded
  patches are silently rewritten to their projections (documented in
  `UI_AND_INTERACTION.md:241`); decision D6 keeps this as a load shim.

**Prediction.** Which channels a track "can emit on" — driving the rule rows' chip states,
rule capacity, and the `None`-entry expansion in the FE gate — is *predicted* FE-side by
`channelHocketPossibleMidiChannels` (`channelLogic.ts:72`): a reachability analysis over the
Channel Shaper spec (static output, Markov transition/entry weights, static + weighted
fallbacks, accent rules, position rules; any weight > 0 counts). This duplicates engine
hocket semantics and is display/gating-only — the engine never consumes it. Divergence
mislabels chips and shifts the FE gate, never the audio (plan A4 adds a parity fixture).

**Request build** (`buildParallelPlaybackRequest`, `playbackRequests.ts:1123`): audible
parallel tracks + silent trigger sources + audible box lanes form the participant list; the
matrix and priority are re-normalized against exactly that list (box lanes included). If
fewer than two participants and no box lane exist, the parallel path (and with it channel
logic) is not engaged at all.

## 9 · What the invariant suite proves today

`crates/cseq-transport/tests/invariants.rs` (with `--features fuzzing`; nightly deep sweeps)
and `fuzz/fuzz_targets/parallel_transport_queue.rs` generate all 18 policies, matrix rows
(per-channel and `None`), and priority orderings:

- **Proven, all policy/matrix/priority combinations, triggers and shapers and tempo jitter
  included:** deterministic parallel realization; sorted, window-bounded queues;
  **unconditional note-on/off balance per (channel, pitch)** (with off-without-on a hard
  failure, jointly the wire-observable form of group atomicity — suppressed ⇒ no events,
  surviving ⇒ on and off); re-apply is bit-identical to fresh build; multi-track seed-path
  replay reproduces the ledger. Deep sweep 4096 cases green (2026-07-07, post-fix).
- **The 2026-07-07 stranded-off family is FIXED** (root cause: the old dedup *dropped*
  strictly-spanned offs; now deferred — §3.6). The three former `#[ignore]` repros
  (`trigger_restart_truncation_strands_note_offs`, `conflict_suppression_strands_note_offs`,
  `multitrack_shapers_strand_note_offs`) run un-ignored as regression pins, and the
  `allow_known_orphans` carve-outs are **deleted** from both `invariants.rs` and the
  `parallel_transport_queue` fuzz target. Do not reintroduce them.
- **Production-path (stepped) balance:** `parallel_stepped_realization_is_balanced` realizes
  per-cycle — the way the live scheduler actually does, not the single pass the other
  properties use — and enforces note balance across triggers, shapers, and jitter. This
  closed a real gap: the incremental path is what plays, and its balance was previously
  untested.
- **Incremental determinism (scoped):** `parallel_stepped_uniform_continuous_realization_equals_fresh`
  pins stepped ≡ single-pass for uniform-tempo continuous tracks (all policies, matrix,
  priority, shapers) — a real Alternate-ordinal windowing regression breaks it. **Known,
  balance-preserving residual** (deliberately out of scope, not a bug): for triggered
  followers / Track Flow boxes (realization depends on per-batch source history) and for
  per-track tempo jitter (overrun shifts the deferral fixpoint and RandomOne's tick-hash),
  stepped is *not* byte-identical to a single pass. Balance still holds (property above); the
  single-pass fuzz path is the artifact, the stepped path is production.
- **Not yet covered:** the §5 degeneration/composition equivalences beyond the irrelevant
  case (plan A4), FE↔BE projection and reachability fixtures (plan A4), and a decision-level
  (per-component) atomicity property.

## 10 · Known defects and hazards (summary)

| ID | What | Where | Status |
|---|---|---|---|
| R1 | Note-off dedup DROPPED strictly-spanned offs → stranded ons/hung notes | §3.6 | **FIXED 2026-07-07** (deferral + runtime sweep + unconditional balance; repros are regression pins) |
| R2 | Any matrix entry degraded the default to pairwise semantics; help copy contradicted | §5 | **FIXED 2026-07-07** (D1=O3: group-wise default + explicit rules rescue/veto; irrelevant-matrix property + worked-example tests; per-track labels) |
| R3 | Alternate rotation depended on evaluation order/matrix shape/windowing; reset on every live edit | §4 | **FIXED 2026-07-07** (D2=Oc1: stateless per-(channel,cycle) rank; matrix-independent + cycle-local + live-edit-stable; balance-preserving tempo-jitter residual documented in §4/§9) |
| R5 | Delta-culling dropped rules equal to the default; intent lost on default change | §8 | **FIXED 2026-07-07** (D3: rules equal to the default are kept and shown "= default"; normalize no longer culls) |
| R6 | Same-(pair, channel) multi-policy states authorable, then Play-blocked | §6 | **FIXED 2026-07-07** (D4: reducers move channel ownership so ambiguity is unrepresentable; load-time key-dedup repairs old patches; Play-block/warning removed) |
| R9 | Wholesale component re-resolution (§3.4) can suppress a group whose note-ON already dispatched (long tie spanning the playhead), removing its queued off | §3.4 | **GUARDED 2026-07-07** (A3): the conflict pass skips any component starting at/behind `dispatch_horizon_tick` (the scheduler's playhead); still backstopped by the A1 stuck-note sweep |

(Numbering matches `CHANNEL_LOGIC_PLAN.md` §1; R4/R7/R8 are drift/coverage/UI risks tracked
there.)

## 11 · Decision log

| # | Question | Options | Recommendation | Status |
|---|---|---|---|---|
| D1 | R2: semantics when a matrix exists | (a) keep pairwise fallback; fix help copy · (b) veto-only over group-wise base · (c/O3) group-wise default base + explicit rules RESCUE **and** veto for their pair | **(c/O3) LANDED 2026-07-07** — preserves rule-rescue (which pure veto-only breaks), restores group-wise defaults for unruled tracks, per-track ledger labels; behavior change only for patches mixing count-based defaults with rules; empty-matrix ≡ irrelevant-matrix proven | **DONE 2026-07-07** |
| D2 | R3: Alternate determinism | (a) document counter behavior · (b) advance once per component · (c/Oc1) per-(channel, cycle) collision-rank ordinal, stateless · (Oc2) beat-derived | **(c/Oc1) LANDED 2026-07-07** — per-collision rotation, cycle-local, matrix-independent, live-edit-stable; dispatch-horizon (R9) guard; balance-preserving tempo-jitter residual documented | **DONE 2026-07-07** |
| D3 | R5: delta-culling | (a) keep culling · (b) keep rules equal to the default, render "= default" | **(b) LANDED 2026-07-07** — normalize keeps default-equal rules; reducers no longer drop them; panel shows a "= default" tag | **DONE 2026-07-07** |
| D4 | R6: multi-policy (pair, channel) states | (a) keep author-then-block · (b) unrepresentable via reducers (toggling moves ownership); load-time auto-repair + notice; Play never blocked by fresh edits | **(b) LANDED 2026-07-07** — `nextChannelLogicMatrixForToggledChannel` moves ownership; `normalizeChannelLogicMatrix` key-dedups; `channelLogicMatrixRepairCount` for the load notice; Play-block + warning banner deleted | **DONE 2026-07-07** |
| D5 | Pre-playback parallel dry-run preview | (a) build one · (b) defer; rely on timeline ghosts + per-rule counters | **(b)** — no parallel stopped-preview machinery exists | **pending** |
| D6 | 9 legacy policies (`forceOn or and* nand nor even odd oneHigh oneLow`) | (a) delete from engine+wire · (b) keep engine+wire, never offer/persist; projections are load shims | **(b)** — engine arms are tested and cheap; wire stays compatible | **pending** |
| D7 | FE can author >16 conflict participants; only BE validation rejects, at Play | (a) hard cap in authoring UI · (b) pre-Play validation message | **(b)** — no authoring friction, loud failure (CHANNEL_LOGIC_DESIGN.md A4.4) | **pending** |

*`and` is legacy as a rule policy only; it remains a first-class default option.

When a decision lands: set Status to the date, update the affected sections here (and the
degeneration table if D1 changes it), then implement per the plan phase.

## 12 · Anchor index

| Thing | Where |
|---|---|
| Policy enum / matrix entry / config | `cseq-transport/src/lib.rs:508, :530, :560` |
| Runtime compile + alternate/horizon reset | `from_config`, `apply_in_place` (`alternate_resolved.clear()`) |
| Alternate ordinal state / R9 horizon fields | `ParallelRuntimeConfig.alternate_resolved`, `.dispatch_horizon_tick` |
| Active-count rule | `conflict_active_track_count` |
| Group collection (LIFO) / span / components | `collect_final_note_groups`, `channel_overlap_components` |
| Note-off deferral (R1 fix) | `defer_premature_same_pitch_note_offs` |
| Runtime stuck-note sweep | `stuck_note_residue` + scheduler-loop graft |
| RandomOne hash / priority winner / key sort | `deterministic_collision_choice`, `priority_winner`, `channel_logic_key` |
| Policy semantics (18 arms) | `collision_allowed_tracks` |
| Matrix composition O3 (S0 + rescue/veto, R2 fix) | `matrix_allowed_tracks` |
| Conflict pass + per-track labels + decision ledger | `apply_parallel_channel_conflicts_for_keys` |
| Production call site / suppressed flagging | `:8398, :8665` |
| Validation | `:964-1051` |
| Wire DTOs | `src-tauri/src/main.rs:1421, :1469, :2500` |
| FE normalize + projections | `ui/src/patchIo.ts:2036, :2087, :2110` |
| FE prediction / labels / reducers / gate | `ui/src/channelLogic.ts:72, :262, :749-981, :429` |
| Request build / live re-push / Play gate | `ui/src/playbackRequests.ts:1123`, `App.tsx:3484, :4138` |
| Panel / priority editor / debug table | `App.tsx:8539, :9147, :9606` |
| Invariants + pinned repros | `cseq-transport/tests/invariants.rs:1557-1675, :2050-2163` |
| Fuzz target | `fuzz/fuzz_targets/parallel_transport_queue.rs` |
