# Channel Logic — Safety Hardening + UI Clarity Plan

Date: 2026-07-07 · Status: **A0-A3 + B0 + B1 landed 2026-07-07** (A0: spec; A1: stranded-off
fixed; A2: pairwise cliff — D1=O3; A3: Alternate — D2=Oc1; **B0: panel extracted to
`components/ChannelLogicPanel.tsx` + one `POLICY_METADATA` vocabulary; B1: sentence header +
pictogram + rule sentences + effective-policy footer + priority relocated; D3 keep
default-equal rules; D4 ambiguity unrepresentable + Play-block removed**; 817 FE unit + 8 RTL
green, 2 e2e specs rewritten & green, typecheck/lint clean, all engine 4096-sweeps green).
A4-A5 designed in **`CHANNEL_LOGIC_DESIGN.md`**; D5-D7 pending (D1/D2/D3/D4 decided)
Companion to `TEST_COVERAGE_PLAN_2026-07.md` (§3 item 5, §4 Phase 2.1 notes, Phase 3);
extends — does not replace — the stranded-note-off engine investigation that plan calls for.
Line numbers below are anchors as of today's working tree and will drift.

---

## 0 · Orientation: what channel logic is

Channel logic is the **project-level collision resolver for parallel playback**: after every
audible track (plus triggered followers and Track Flow box lanes) is realized and merged into
the transport queue, any set of final note groups whose spans transitively overlap on the same
user-facing MIDI channel forms an *overlap component*, and a policy decides which tracks'
groups survive. Suppressed groups are removed on-and-off together; the timeline shows them
ghosted via a suppressed flag rather than re-deriving its own resolution.

Configuration is three fields on the parallel project, persisted FE-side in the patch and sent
per playback request:

| Field | Meaning |
|---|---|
| `channelConflictPolicy` | project default policy |
| `channelLogicMatrix` | pairwise overrides: `{trackAId, trackBId, outputChannel: 1-16 \| null(=all), policy}` |
| `conflictPriority` | ordered track ids consumed by the `priorityOrder` policy |

Where the seam lives:

- **Engine (single file):** `crates/cseq-transport/src/lib.rs` — enum `ChannelConflictPolicy`
  (18 variants, :508), matrix entry (:530), runtime compile (:2379, :2129), overlap components
  (:7507), pair composition `matrix_allowed_tracks` (:7886), policy semantics
  `collision_allowed_tracks` (:7768), conflict pass (:7944, prod call site :8398), note-off
  dedup (:7565), LIFO pairing (:7441), timeline suppression flags (:8665).
- **Wire:** `src-tauri/src/main.rs` DTOs (:1421, :1469), assembly (:2500).
- **FE model:** `ui/src/channelLogic.ts` (pure helpers, labels, help copy, row builders,
  reducers), `ui/src/patchIo.ts` (normalization :2036, policy projections :2087/:2110),
  `ui/src/playbackRequests.ts` (:1123-1279).
- **FE UI:** inline in `App.tsx` — panel :8539-8822, handlers :5934-6067, priority editor
  :9147-9189, post-hoc "Parallel conflicts" debug table :9606-9665.
- **Docs:** `UI_AND_INTERACTION.md` :207-244, manual :2237-2266, `ARCHITECTURE.md` :660-680.
  No entry in `GLOSSARY.md`, `KNOWN_RISKS.md`, or `FAULT_RISK_SURFACES.md`.

Existing safety nets (real, keep): 18-policy × matrix × priority generation in the invariant
matrix with note-balance proven for plain tracks (`invariants.rs:1917`, deep sweeps green),
`parallel_transport_queue` fuzz target, per-policy Rust unit suite (lib.rs:16965-17479),
request validation (self-pairs, unknown tracks, duplicate rows, channel range, 16-participant
cap — :964-1051), FE unit tests (`channelLogic.test.ts`), two Playwright tests
(`patch-persistence.spec.ts:1966, :2039`), FE Play-blocking on contradictory rule sets.

---

## 1 · Risk register (verified, ranked)

**R1 — Stranded note-offs → hung notes. REAL, pinned.**
`duplicate_same_pitch_note_off_indices` (lib.rs:7565) drops a group's note-off whenever any
other surviving same-channel/pitch group *strictly spans* it, without checking that pairing
survives. Sound only for nested overlaps; under tempo-warped shaper overlaps it strands ons.
Pinned `#[ignore]` repro `conflict_suppression_strands_note_offs` (invariants.rs:2090) with the
`allow_known_orphans` carve-out (:1606); two sibling shapes (trigger restart truncation,
multitrack shaper bookkeeping) share the family. Nothing in normal playback releases a stranded
on (`orphaned_active_notes` runs only on config swaps). Blast radius: hung MIDI notes in live
performance — the worst failure class this app has.

**R2 — The pairwise cliff: any matrix entry silently changes the default's semantics.**
`matrix_allowed_tracks` (lib.rs:7886): matrix empty → default evaluated **group-wise** with the
true audible-track denominator. Matrix non-empty → *every* pair in the component is evaluated
**pairwise with `active=2`**, and unmatched pairs fall back to the default *in that degenerate
form* (:7919-7929). Consequences: with any rule present, default `majority` passes everything
(2·2>2 always), `and` passes everything, `minority` suppresses everything, `xnor`≈layer,
group-scoped denominators are gone. The in-app help explicitly promises the opposite
("the denominator is the current audible track count", channelLogic.ts:397). So the shipped
help copy is wrong whenever the matrix is non-empty. Also a UX trap: adding one rule for one
pair mutates behavior of unrelated pairs.

**R3 — `Alternate` is order- and window-dependent by construction.**
Winner = mutable `alternate_offsets[channel]` counter (lib.rs:2136), advanced on every
evaluation that hits the Alternate arm — including **once per pair consult** inside the matrix
path (:7931) rather than once per collision component. Rotation therefore depends on component
size, on how many matrix pairs resolve to Alternate, and on incremental realize windowing
(`only_keys`, :8395). The reapply-bit-identical property is green today, but the semantics is
fragile: an unrelated matrix edit or window boundary shifts every subsequent winner. Help copy
says only "advances a winner index per MIDI channel".

**R4 — Four duplicated encodings that must stay in lockstep (drift risk):**
  a) *Policy degeneration table*: FE `musicalChannelLogicRulePolicy` (patchIo.ts:2110) is a
     hand-written mirror of what BE pairwise evaluation degenerates to. Verified consistent
     today for all 13 collapsed policies — but nothing tests it.
  b) *Channel reachability*: `channelHocketPossibleMidiChannels` (channelLogic.ts:72) statically
     re-derives, from six weight sources, which channels the engine's hocket can emit — chips,
     rule capacity, and conflict messages all sit on this prediction. One test covers it.
  c) *Blocking vs validation*: FE conflict messages block Play (App.tsx:4256), BE
     `validate_parallel_playback_config` rejects a narrower set (duplicate (pair, channel)
     keys, policy-blind). The live-edit contract (LIVE_EDITING_ARCHITECTURE.md:119) leans on
     the FE side staying strictly stricter — untested.
  d) *Three label vocabularies*: dropdowns say "One only / Layer all"; conflict warnings use
     `channelConflictPolicyLabel` ("XOR", "Allow all / OR"); the debug table prints raw ids
     ("xnor"). A user cannot correlate the three surfaces.

**R5 — Delta-matrix intent loss.**
`normalizeChannelLogicMatrix` culls entries whose policy equals the current default
(patchIo.ts:2060) and reducers refuse to add them. Changing the default therefore silently
deletes rules that had been absorbed by it; the user's per-pair intent is unrecoverable.

**R6 — Ambiguity is representable, then punished.**
The model allows multiple policies for the same (pair, channel) key as separate rows; the UI
lets you author them, then blocks all playback with a warning banner until resolved. The
product forbids what the model permits — inverted. (The engine is a backstop, not a resolver:
`validate_parallel_playback_config` rejects duplicate (pair, channel) keys policy-blind, so
the FE gate is the only thing keeping a playing session from a rejected live push. The FE
gate is also strictly *wider*: it blocks legacy-all-channel + specific-channel policy mixes
the engine would accept and resolve by precedence.)

**R7 — Structural coverage gaps.**
The panel is ~280 lines of JSX inline in `App.tsx` — exempt from the model-coverage guardrail,
zero RTL coverage, only reachable via two Playwright tests. Balance invariants for
shaper/jitter parallel configs are carved out pending R1. No channel-logic axis in
`KNOWN_RISKS.md`/`FAULT_RISK_SURFACES.md` despite a pinned engine finding.

**R8 — Comprehension debt (UI).** Detailed in §3: four "channel" features and two "matrix"
meanings; priority editor hidden unless the *default* is Priority (a pair rule set to Priority
depends on an invisible, un-editable order — App.tsx:9147 gate); 9-vs-5 option asymmetry with
"Layer all"≠"Layer"; idle chips with dead-end reasons ("hocket off") and no route to fix;
silent legacy-policy rewriting on load; no pre-playback view of outcomes; collision definition
buried in collapsed help.

---

## 2 · Part A — Safety plan

### A0 — Spec first: `docs/CHANNEL_LOGIC.md` (S, do first) — **DONE 2026-07-07**
Landed: `docs/CHANNEL_LOGIC.md` (semantics spec incl. the 18-policy degeneration table and
D1-D6 decision log, all pending), GLOSSARY entries (Channel Logic, Channel Shaper),
KNOWN_RISKS §Parallel Channel Conflict Resolution, risk-tool "conflict" vocabulary
(script + FAULT_RISK_SURFACES.md). New facts the spec verification added: engine validation
rejects duplicate (pair, channel) keys policy-blind (FE gate is strictly wider, not the only
gate); `alternate_offsets` reset on every config push including live edits; pairwise
`randomOne` composition can never pick the middle track of a 3-track component; pairwise
`alternate` composition can suppress an entire component; `oneHigh` ≡ `xor`; note-off dedup
runs even for a single audible participant. Original brief:
Write the missing single source of truth, derived from code and reviewed against the invariant
suite: data model; overlap-component construction (sweep-line, `max(end, start+1)` spans);
resolution precedence (exact pair+channel → legacy pair `null` → default); pairwise-veto
composition and the **full 18-policy degeneration table** (group-wise vs pairwise columns);
`RandomOne` determinism inputs (`start_tick`, `user_channel` hash); `Alternate` state rules;
note-off dedup + LIFO pairing rules; suppressed-flag timeline parity (±1 tick tolerance);
live-edit contract (which side blocks what); the two policy projections and load-time
rewriting. Add GLOSSARY entry; add R1/R2/R3 to `KNOWN_RISKS.md` + `FAULT_RISK_SURFACES.md`.
The spec is also where D1-D5 (§4) get decided and recorded.

### A1 — Kill the hung-note class (M-L, engine; highest value) — **DONE 2026-07-07**
Landed: `duplicate_same_pitch_note_off_indices` replaced by
`defer_premature_same_pitch_note_offs` (spanned offs are deferred to the overlap chain's
end, not dropped — audibly identical on last-off receivers, count-balanced everywhere);
scheduler-side `stuck_note_residue` sweep releases provably-stuck notes once per realized
window (zero false positives by construction — long ties have queued offs). All THREE
pinned repros shared the dedup root (the trigger-restart and multitrack-shaper "siblings"
included) and now run un-ignored as regression pins; `allow_known_orphans` carve-outs are
deleted from `invariants.rs` and the `parallel_transport_queue` fuzz target; balance is
unconditional. Verified: 308 lib + 6 golden-ledger + 15 invariant tests green, 0 ignored;
PROPTEST_CASES=4096 parallel deep sweep green. Residual (optional, A4-adjacent): a
decision-level per-component atomicity property — wire balance can't see theoretically
offsetting partial-removal bugs across groups. Original brief:
1. Rewrite same-pitch note-off resolution to be **pairing-aware**: compute per
   (channel, pitch) the active-count timeline over *surviving* groups; keep exactly the offs
   that close the final sounding instance at their tick (reference-counted note-off merging),
   instead of the "strictly spanned" heuristic. Suppression already removes groups atomically
   (:8047-8054) — the dedup step is the leak; make the whole pass group-atomic by construction.
2. Extend `orphaned_active_notes` reconciliation to run during normal playback (per realize
   window or per cycle), emitting protective offs for ons whose offs left the queue — defense
   in depth so *no* future regression in this family can hang a note for longer than a window.
   Coordinate with TEST_COVERAGE_PLAN Phase 3.2 (`MidiSink` fake) so the sweep is testable.
3. Acceptance: un-ignore `conflict_suppression_strands_note_offs` (and siblings if the same
   root); **delete** the `allow_known_orphans` carve-outs in `invariants.rs` and
   `fuzz/fuzz_targets/parallel_transport_queue.rs`; ≥4096-case deep sweep green with balance
   enforced for shaper + tempo-jitter parallel configs; add the stronger invariant
   "for every component decision: suppressed group ⇒ zero events remain, surviving group ⇒
   both on and off remain".

### A2 — Fix the pairwise cliff (M, engine + spec decision D1) — **DONE 2026-07-07**
Landed D1 = **O3** (design doc's rescue+veto over a group-wise base, chosen over the plan's
original veto-only sketch, which would have broken the rule-rescue use-case): the default is
evaluated group-wise on the whole component (`S0`) matrix or not; each *explicit* rule
evaluates its pair and RESCUES members its policy passes / VETOES members it fails;
`S = (S0 ∪ rescued) − vetoed`. Unmatched pairs are skipped, never defaulted-pairwise, so
count-based defaults keep their true denominator. `matrix_allowed_tracks` now returns
`(allowed, ruled)`; the conflict pass labels each track `channelLogicMatrix` only when a
rule governed it (unruled tracks keep the default's own label). Verified: worked-example
unit tests (rescue, veto, irrelevant-no-degrade + per-track labels), existing matrix tests
pass unchanged, new invariant `parallel_irrelevant_matrix_entry_is_a_no_op` (empty matrix ≡
matrix + a silent-endpoint irrelevant rule) green at 4096, full suite + golden ledgers +
workspace check + clippy clean. Side effect: the shipped help copy
("the denominator is the current audible track count") is now TRUE unconditionally — the
pre-O3 lie is gone with no copy change. Compat: patches with no matrix bit-identical;
explicitly-ruled pairs unchanged; unruled components regain group-wise semantics (audible
change only for count-based defaults mixed with rules). Original brief:

### A3 — Deterministic `Alternate` (S-M, engine + spec decision D2) — **DONE 2026-07-07**
Landed D2 = **Oc1** (per-collision rotation). The mutable `alternate_offsets:[usize;16]` is
gone; the winner index is now `alternate_ordinal % k`, where the ordinal is the collision's
rank among resolved multi-track collisions on the same `(user channel, reference cycle)`,
derived from `config.alternate_resolved: HashMap<(u8,u64), BTreeSet<u64>>` (idempotent insert
→ safe under incremental re-resolution). Result: rotation is per-collision, cycle-local,
**matrix-shape-independent** (ordinal never consults the matrix), and **live-edit-stable**
(cleared on swap; future cycles restart at 0, past winners frozen). Added the **R9
dispatch-horizon guard**: the conflict pass skips any component starting at/behind
`config.dispatch_horizon_tick` (set to the playhead by the scheduler each tick; 0 in
tests/Play-init disables it), so an already-dispatched component is never re-suppressed.
Tests: unit rotation + cycle-reset; new `fuzz_realize_parallel_cycles_stepped` hook driving
two properties — `parallel_stepped_realization_is_balanced` (the PRODUCTION per-cycle path is
note-balanced, a previously-untested gap) and `parallel_stepped_uniform_continuous_realization_equals_fresh`
(window-independence for uniform-tempo continuous tracks). **Honest residual** (documented,
NOT a regression, balance-preserving): fresh single-pass ≠ stepped for triggered followers /
boxes (per-batch source history) and tempo jitter (overrun shifts the A1 deferral fixpoint +
RandomOne's tick-hash) — the stepped path is production and is balanced; byte-level
window-independence was never an engine property. Verified: 313 lib + 6 golden + 18 invariant
green, 4096 parallel sweep green, clippy clean, app help copy updated. Original brief:
Replace the mutable counter with a derived rotation index — e.g. hash-derived ordinal like
`RandomOne` but rotating over the collision ordinal per (channel, cycle) — or, minimally,
advance exactly **once per component** (not per pair consult) and document the state's reset
points (play start, config swap). Property: Alternate winners are invariant under (i) adding an
unrelated matrix row, (ii) incremental vs full realization of the same window, (iii) replay.

### A4 — Contract tests across the duplicated seams (M)
Kill R4 with fixtures, not discipline (repo already has the Rust→TS fixture pattern):
- **Degeneration table fixture**: Rust test emits JSON of pairwise results for all 18 policies;
  vitest asserts `musicalChannelLogicRulePolicy` / `musicalChannelLogicDefaultPolicy` agree.
- **Reachability parity fixture**: generate hocket specs (reuse the `structured_pitch_channel`
  generator), have the engine report reachable channel sets, assert
  `channelHocketPossibleMidiChannels` matches. Longer term (B2), expose engine-computed
  reachability in the inspect/preview DTO so chips consume truth instead of prediction.
- **DTO fixtures with populated `channelLogicMatrix`** both directions (extend the Phase 2.4
  pattern) so camelCase serde names and `outputChannel: null` are byte-pinned.
- **Blocking ⊇ validation property**: any config FE would allow to play must pass BE
  `validate_parallel_playback_config` (drive both over generated matrices).

### A5 — FE model hardening (S-M)
- Exhaustive unit tests (domain is small — no fast-check needed): normalize idempotence,
  projection tables, reducer round-trips (toggle on→off ≡ identity; group ops preserve
  normalized order; box-lane endpoints survive every reducer).
- `randomize.ts` deliberately skips channel logic — pin that with a test or a comment-anchored
  assertion so a future randomize sweep doesn't silently start scrambling collision policy.
- E2E additions: live-edit path (edit a rule mid-play → assert deduped re-push payload,
  next-cycle apply against mock backend); priority-visibility behavior after B1.

---

## 3 · Part B — UI plan

Design constraints (from `DESIGN_LANGUAGE.md`): dense, legible, direct, calm; grid before
card; one control one meaning; **blue = channel/routing signal**; no new chrome. Keep
`UI_AND_INTERACTION.md:236`'s decision: a **rule list, not a 16×16 grid**. The feature's mental
model to express: *"Notes that overlap on the same MIDI channel collide; a policy decides who
survives; pair rules override the default; Priority is the tiebreaker."*

### B0 — Extraction + one vocabulary — **DONE 2026-07-07**
Landed: `components/ChannelLogicPanel.tsx` (presentational; App keeps state, passes callback
props) + `ChannelLogicPanel.test.tsx` (8 RTL tests, guardrail satisfied); one
`POLICY_METADATA` table in `channelLogic.ts` drives every label/option/help surface (one
label per policy; technical names only in help detail). Original brief:
- Move the panel out of `App.tsx` into `components/ChannelLogicPanel.tsx` (JSX move only —
  logic already lives in `channelLogic.ts`), then add RTL behavior tests. Closes the guardrail
  exemption (TEST_COVERAGE_PLAN 4.2) for this seam.
- Single `POLICY_METADATA` table in `channelLogic.ts`: `{policy, label, shortLabel, summary,
  detail, availableAs: default|rule|both, technicalName}`. `CHANNEL_LOGIC_DEFAULT_OPTIONS`,
  `CHANNEL_LOGIC_RULE_OPTIONS`, `channelConflictPolicyLabel`, help card, conflict messages,
  and the debug table all render from it. Test: no UI surface renders a raw policy id; the
  same policy never renders two different labels ("Layer all" vs "Layer" dies here).
- Copy audit: the word "matrix" never appears in channel-logic UI copy (reserved for Markov
  grids); wire/persist name `channelLogicMatrix` is unchanged (compat), noted in the spec.

### B1 — Structure that teaches the model — **DONE 2026-07-07**
Landed: sentence header + flat overlap pictogram; rules as subject→scope→verb with a
"= default" tag (D3); priority editor relocated into the panel, shown whenever the default OR
any rule uses Priority; per-channel effective-policy footer via new pure
`resolveChannelLogicPolicy` + `buildEffectiveChannelSummaries` (engine-precedence-mirroring,
unit-tested). D4: channel toggling moves ownership (ambiguity unrepresentable); conflict
messages + Play gate + warning banner deleted; the two conflict-flow e2e specs rewritten to
the never-blocks contract and green. B2 (chip triad / routing jump / suppression counters)
and B3 (help/docs convergence) remain. Original brief:

### B1(orig) — Structure that teaches the model (M)
Panel reads top-to-bottom as the algorithm runs:

```
CHANNEL LOGIC                                                    (i)
When notes overlap on the same MIDI channel:  [ Random one ▾ ]
  ▸ overlap = sustained spans crossing, not shared starts   ⌇⌇ pictogram

Pair rules (override the default)                    [+ Add rule]
  Track 1 ↔ Track 3   on [Ch 2][Ch 3]        → [ Mute overlap ▾ ]  (−)
  Track 2 ↔ Track 3   on [All shared]        → [ Priority ▾ ]      (−)

Priority order (used by 1 rule)          1. Track 2  2. Track 3  ↑↓

Ch 2 · T1↔T3 Mute overlap · else Random one        ← effective view
Ch 5 · no rules · Random one
```

- **The sentence is the model**: default select embedded in "When notes overlap on the same
  MIDI channel: …". The overlap definition gets a two-lane inline pictogram (flat SVG, tone
  steps only) instead of a buried help bullet.
- **Rows read as rules**: subject (pair) → scope (channel chips) → verb (policy). Same pieces
  as today, reordered; scope label always visible.
- **Effective-policy footer**: one dense line per *in-use shared channel*, computed by a
  single exported resolver in `channelLogic.ts` that mirrors engine precedence and is
  contract-tested against it (A4). This is the channel-centric read the pair-centric list
  can't give, and it makes precedence visible without prose.
- **Priority editor moves into the panel** and renders whenever *any* effective policy
  (default or rule) is `priorityOrder`, with a "used by N rules / default" caption. Kills the
  hidden-dependency trap (App.tsx:9147 gate). One home, one meaning.
- **Ambiguity becomes unrepresentable** (decision D4): toggling a channel that another row of
  the same pair owns *moves* it (one policy per (pair, channel) key by construction). The
  blocking banner remains only as a load-time repair path for old patches: auto-group, show
  "resolved N conflicting rules" notice once. Play is never blocked by freshly-authored state.

### B2 — Honest, actionable state (M)
- Chip triad, consistent everywhere: **selected** (blue fill — routing signal), **available**
  (outline), **idle** (dim + reason). Reasons name the cause and the fix and link there:
  "idle — Track 2 routes to Ch 5 only · Edit routing →" (opens that track's Channel Shaper
  axis). No more dead-end "hocket off".
- Empty states teach instead of vanishing: >1 track with disjoint channels renders one calm
  line — "Tracks never share a MIDI channel, so nothing can collide. Shared channels come from
  each track's routing →". (Single-track: panel stays hidden; nothing can collide by
  definition.) Disabled "+ Add rule" gets a title explaining why.
- **Proof over promise**: surface suppression where it happens. (a) Timeline: suppressed
  groups already carry flags — make the ghost rendering + legend explicit for parallel
  playback. (b) Per-row live counters fed by the existing conflict debug events: "suppressed
  12 groups last cycle" chip on the responsible rule/default. The buried `<details>` debug
  table stays for forensics; the counters are its headline. (c) A pre-playback dry-run
  preview would need new engine machinery (no parallel stopped-preview exists — verified);
  scoped out to D5 rather than promised here.

### B3 — Help + docs convergence (S)
Help card shrinks to: 3 bullets (what collides, precedence, determinism note) + pictogram +
per-mode summaries rendered from `POLICY_METADATA` (detail on demand). Manual §channel-logic
and `UI_AND_INTERACTION.md:207-244` updated to the new structure; both cite the A0 spec as
source of truth. GLOSSARY entry added (A0).

---

## 4 · Decisions needed (recommendations inline)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Unmatched-pair fallback semantics (R2) | Group-wise default first, explicit rules veto on top — matches shipped help copy; accept the behavior change, note it |
| D2 | `Alternate` determinism model (R3) | Derived ordinal (RandomOne-style hash + rotation); mutable counters die |
| D3 | Delta-culling of default-equal rules (R5) | Stop culling; render "= default" tag; keep culling only inside legacy-projection load shim |
| D4 | Multi-policy per (pair, channel) (R6) | Make unrepresentable in reducers; load-time auto-repair with notice; drop Play-blocking for new edits |
| D5 | Pre-playback parallel dry-run preview | Defer. Timeline ghosts + rule counters (B2) deliver most of the value without new engine surface |
| D6 | Fate of 9 legacy policies | Keep engine variants (tested, cheap, wire compat); never offer or persist them; spec documents the projections as load shims |

---

## 5 · Sequencing

```
A0 spec ──┬─► A1 hung-note fix ─► un-ignore repros, delete carve-outs
          ├─► A2 pairwise cliff (D1) ─┐
          ├─► A3 Alternate (D2)       ├─► A4 contract fixtures ─► B2 truth-fed chips/counters
          └─► B0 extract + vocabulary ┴─► B1 structure (D3, D4) ─► B3 help/docs
A5 rides alongside; E2E additions land with the B-phase they cover.
```

- A1 is independent of all UI work — start immediately; it is the only item with live hung-note
  risk. A2/A3 are semantic changes and want the A0 spec agreed first.
- B0 is mechanical and can start in parallel with A1.
- B1's effective-policy footer must consume the shared resolver so it ships no earlier than the
  resolver's contract test (A4 first bullet).
- Rough effort: A0 S · A1 M-L · A2 M · A3 S-M · A4 M · A5 S-M · B0 S-M · B1 M · B2 M · B3 S.

## 6 · Global acceptance

1. Zero `#[ignore]`d channel-logic repros; zero `allow_known_orphans` carve-outs; deep sweep
   ≥4096 green with balance enforced for shaper/jitter parallel configs.
2. Empty-matrix ≡ irrelevant-matrix property green for all 18 policies (R2 closed).
3. Alternate replay/window/matrix-edit invariance property green (R3 closed).
4. Degeneration-table, reachability, DTO, and blocking⊇validation fixtures green in CI (R4).
5. One policy vocabulary across dropdowns, warnings, debug, help (test-enforced).
6. Panel extracted, RTL-covered; priority editor visible iff used; ambiguous rules
   unrepresentable; e2e covers live-edit + load-repair paths.
7. `CHANNEL_LOGIC.md` spec exists; GLOSSARY/KNOWN_RISKS/FAULT_RISK_SURFACES/manual/
   UI_AND_INTERACTION updated and pointing at it.

## 7 · Non-goals

- No 16×16 grid; the rule list stays (documented rationale, UI_AND_INTERACTION.md:236).
- No stateful Logica-style operators (sequence/latch/delay) — ARCHITECTURE.md:673 already
  defers them to a dedicated chronological runtime; this plan does not open that door.
- No new color roles, chrome, or modal surfaces; the panel remains one compact section.
- No wire/persist renames (`channelLogicMatrix` et al. stay).
