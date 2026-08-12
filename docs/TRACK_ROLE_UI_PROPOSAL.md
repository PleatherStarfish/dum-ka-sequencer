# Proposal — Unify the track-role UI (Continuous / Triggered / Track Flow)

This proposal evaluates whether the **continuous / triggered / Track Flow**
distinction is differentiated correctly in the logic (it is), explains why the
**UI is muddled**, and proposes a presentation redesign. It is **UI-and-patch-shape
only** — no engine, transport, or realization change is needed or wanted, because
the underlying model is already correct.

## 1. What the logic actually enforces today

A track is in exactly one of **three mutually exclusive roles**, and the code
enforces that exclusivity at every layer:

| Role | Mechanism | "Activated by…" | Can be a trigger source? |
|---|---|---|---|
| **Continuous** | plays every cycle on its own | always on | yes |
| **Triggered** (follower) | fires when a *source* track does something (a rest, accent, …) — a condition evaluated against the source's events | an **event** on another track | no |
| **Track Flow member** | belongs to a box; the box's Markov chain picks **one member to sound per cycle**, the box counts as a single conflict participant | the box's **turn-taking chain** | no |

Enforcement (all consistent, all already shipped):

- A boxed track's trigger is forced off when the request is built —
  `playbackRequests.ts:1014` (`{ ...built, trigger: null }`) and the patch
  normalizer `patchIo.ts:2831` ("A boxed track is sequential (Track Flow): it can
  be neither a triggered [follower] nor a source → `trigger: null`").
- Trigger **source** pickers exclude boxed *and* already-triggered tracks —
  `App.tsx:6488` (`!track.trigger && !boxedTrackIds.has(track.id)`).
- The backend re-derives modes defensively: `cseq_trigger::normalize_track_modes`
  ([config.rs:1258](../crates/cseq-trigger/src/config.rs)) demotes self-trigger,
  dangling-source, and source-is-triggered to Continuous (one-level rule); a box
  member carrying a trigger is rejected by `validate_track_flow_box`
  ([lib.rs:977](../crates/cseq-transport/src/lib.rs), "no v1 triggers").
- Membership is the single source of truth (project-level `trackFlowBoxes` with
  ordered `memberTrackIds`); `mode` is *derived* from it, not independently
  stored — `enforceTriggerGraph` recomputes `mode: boxedIds.has(id) ? "trackFlow"
  : "parallel"` on every normalization (`patchIo.ts:2973`).

**Verdict: the logic is correctly differentiated.** The user's instinct — "a
consecutive track can't participate in normal triggered-track activities" — is
exactly the invariant the code keeps. There is no logic defect to fix here.

### One mechanism nuance worth stating

"Consecutive / triggered by the end of the previous track" is the *intuition*,
but the actual Track Flow mechanism is **per-cycle Markov turn-taking** over the
box's members (`trackflow.rs` resolver; one member sounds per cycle, chosen by a
transition matrix). Strict A→B→A succession is just the special case where the
chain is a simple cycle. So Track Flow is genuinely a **third** activation kind —
not a sugar over event-triggering, and not literally "after the previous track."
This is precisely why it must read as its own role, not be folded into "Triggered".

## 2. Why the UI is muddled

The Active-Track control strip presents the role as **two independent-looking
sibling groups** (`App.tsx` ~8607 and ~8657):

- **`Track Flow` group** — a `Move to: [Parallel | <box> | New box…]` select plus a
  drag hint and a now-playing readout.
- **`Trigger` group** — the `<TriggerInspector>`, whose own `Mode: continuous /
  triggered` toggle (`handleSetActiveTrackTriggerMode`, `App.tsx:5262`) lives
  *inside* it.

Problems this creates:

1. **The taxonomy is invisible.** A track's role is one exclusive choice among
   three, but it's spread across two controls in two boxes. Nothing says "pick
   one of three."
2. **Exclusivity is implicit, enforced silently.** Moving a track into a box
   nulls its trigger (correct), but the Trigger group doesn't visibly disable or
   explain itself for a boxed track; conversely, the Track Flow "Move to" stays
   enabled for a triggered track and silently drops the trigger on use. The user
   only learns the rule by tripping over it.
3. **The shared concept is unnamed.** Both Triggered and Track Flow are forms of
   *conditional activation* (vs always-on Continuous). The UI never says so, so
   the natural question — "isn't Track Flow just another kind of triggering?" —
   goes unanswered. (It's a *sibling* kind, not the same kind.)
4. **Naming collision.** "Track Flow" / "consecutive" vs "Triggered" don't signal
   that they're alternatives at the same level; they read as unrelated features.

## 3. Proposed redesign — one Role picker, three exclusive roles

Replace the two sibling groups with a **single "Role" (a.k.a. "Activation")
control** that names the choice and then reveals only the chosen role's details.

```
ACTIVE TRACK · Lead
┌─ Role ───────────────────────────────────────────────┐
│  ( ) Continuous    — plays every cycle on its own     │
│  ( ) Triggered     — responds to another track        │
│  ( ) Track Flow    — takes turns inside a group        │
└───────────────────────────────────────────────────────┘
   └─ (detail for the selected role only) ──────────────
      Continuous → (no extra controls)
      Triggered  → Source [Lead ▾]  +  the existing TriggerInspector
                   (When it fires · What it plays)
      Track Flow → Box [Box 1 ▾ | New box…]  +  "▦ edit chain"
                   + "Box 1 → <now playing>"
```

Key moves:

1. **Three radio-style roles, mutually exclusive by construction.** Selecting a
   role calls **one new atomic `applyTrackRole(intent)`** (see §6): it builds the
   patch once and sets membership *and* trigger together, then applies it via
   `applyParallelProject`. It must **not** chain the two existing async handlers
   (`handleAssignTrackToBox` + `applyActiveTrackTrigger` each rebuild the patch, so
   chaining can race), and it must **not** reuse `handleSetActiveTrackTriggerMode`,
   whose source filter (`App.tsx:5270`, `!track.trigger` only) is weaker than the
   picker's — it can pick a *boxed* track as the trigger source, which the
   normalizer then strips while the toast still says "set to triggered". The change
   is computed by the pure `roleTransition` + `applyRoleIntent` helpers, which pick
   the source via `eligibleTriggerSources` (boxed excluded). No engine path changes
   — only this one new frontend handler over the existing patch shape.
2. **Role-specific detail is the only thing shown below.** The TriggerInspector
   renders **only** under Triggered; the box/chain controls render **only** under
   Track Flow. This removes the "why is the Trigger panel here for my boxed
   track?" confusion.
3. **Disable with a reason, don't hide silently.** If there is no eligible trigger
   source (no other continuous, non-boxed track), the **Triggered** radio is
   disabled with the reason shown as **visible inline text** (and wired via
   `aria-describedby`, not just a `title` tooltip — a disabled radio isn't
   focusable, so a tooltip is unreachable by keyboard/screen-reader): *"Add another
   continuous, unboxed track to use as a trigger source."* (Today this only
   surfaces as a status toast after the fact — `App.tsx:5274`.) Likewise the
   **Track Flow** radio shows why it needs another track.
4. **Name the shared idea once.** A one-line lead under the Role header:
   *"How this track is activated. Continuous always plays; Triggered and Track
   Flow are two different ways to play only sometimes."* Plus a `?` popover that
   states the difference in one sentence each (event-condition vs box turn-taking)
   and the rule *"a Track Flow track can't trigger or be triggered."*
5. **Keep drag-to-box and the now-playing readout** — they're good and stay, but
   as the *Track Flow detail*, not a separate top-level group. Dragging a track
   onto a box is just another way to pick the Track Flow role.

### Copy (final, plain-language)

- Continuous — "Plays every cycle on its own."
- Triggered — "Plays when another track does something (e.g. rests on beat 3)."
- Track Flow — "Shares one lane with other tracks; the group takes turns, one per
  cycle."

This deliberately reuses the existing reframing from `TRIGGER_UI_REDESIGN.md`
("plays on its own / responds to a track") and extends it with the missing third
option instead of leaving Track Flow as a disconnected feature.

### Coexistence with drag-and-drop

The app already lets you drag a track tab onto a Track Flow box (and out to the
parallel lane). The Role picker does **not** replace that — they are two
affordances over **one source of truth**, so they cannot disagree:

- **Same write path.** Every drag drop routes through the same
  `handleAssignTrackToBox(trackId, target)` the Role picker uses — pointer-drag
  onto a box (`App.tsx:7311`), HTML5 drop onto a box (`App.tsx:7353`), and drop
  onto the parallel lane to un-box (`App.tsx:8380`, `target = ""`). Membership is
  the single source of truth; the Role radio's filled state is **derived** via
  `trackRole(track, boxes)`. So a drag instantly re-fills the radio, and clicking
  the radio is equivalent to a drag — there is never a second state to drift.

- **Drag covers a strict subset.** Drag only moves a track along the **Track
  Flow axis**: drop on a box ⇒ "Track Flow, this box"; drop on the parallel lane
  ⇒ back to **Continuous**. There is no drag gesture for **Triggered** (nothing to
  "drop a follower onto a source"). The Role picker is therefore the *only* way to
  reach Triggered, and the explicit, keyboard-accessible, disabled-with-reason
  front door for all three roles.

- **Complementary, not redundant.** Drag stays the fast spatial gesture for
  grouping ("put these in a box together", reorder within a box); the picker names
  the full taxonomy and adds the trigger axis. The picker's Track Flow detail
  keeps the "Or drag a track onto a box" hint, pointing *back* at drag rather than
  hiding it. (Mental model: a "Move to…" menu next to drag-to-folder.)

- **Shared edge cases hold via normalization, not the box write.**
  `handleAssignTrackToBox` mutates only `trackFlowBoxes` (`App.tsx:5306`–`5359`);
  a boxed track's trigger is cleared a step later by `enforceTriggerGraph` during
  `readPatchDocument` / `applyParallelProject` (`patchIo.ts:2970` → `:2831`). So
  dragging a *triggered* track into a box ends with no trigger after
  normalization (the same end state as the `applyTrackRole` triggered→trackFlow
  path), and dragging *out* of a box lands on Continuous (the trigger was nulled on
  entry and is not restored). The two paths clear the trigger differently — the
  **drag/box-write** handler never touches it (the normalizer does), while
  **`applyTrackRole`** writes `trigger: null` explicitly and atomically with the box
  change (see §5/§6) — but `enforceTriggerGraph` enforces the same end state on
  both, so neither path can leave a boxed track triggered.

Implication for implementation: route every membership mutation — drag *and* the
Role picker — through the same box-assignment logic (the pure `assignTrackToBoxes`,
applied once via `applyParallelProject`), and never let the Role picker store its
own copy of the role. The derived-state rule (§4) is what makes the two affordances
safe to coexist.

## 4. Scope and non-goals

- **UI + patch-shape only.** Membership already lives in `trackFlowBoxes`; trigger
  already lives in `track.trigger`. The Role picker is a *view* over those two; a
  change is applied by **one new frontend handler, `applyTrackRole`**, that mutates
  both in a single patch (built once, applied once via `applyParallelProject`) — it
  does not reuse the existing per-axis handlers (see §3.1). No `bridge.ts`/`patchIo`
  DTO change, no engine change, so timeline⇄MIDI parity and the trigger/Track-Flow
  invariants are untouched.
- **Do not** merge Track Flow into the trigger graph or let a box member be a
  source/follower — that exclusivity is a deliberate v1 invariant
  (`CONSECUTIVE_TRACK_BOXES_PROPOSAL.md` → "Trigger interaction"). The redesign
  *surfaces* the rule; it must not relax it.
- **Derive, don't add state.** The selected role is computed:
  `boxForTrack(...) ? "trackFlow" : track.trigger ? "triggered" : "continuous"`.
  No new persisted field (avoids a third source of truth that could disagree with
  membership/trigger).

## 5. Transitions and edge cases

- **Triggered → Track Flow**: `applyTrackRole` boxes the track *and* writes
  `trigger: null` in the same patch (via `applyRoleIntent`) — atomically, not
  relying on normalization order; `enforceTriggerGraph` then enforces the same
  invariant as a backstop. (The separate drag/box-write path leaves the trigger to
  the normalizer — §3.) Confirm the source-picker recompute drops the now-boxed
  track from other tracks' source lists.
- **A track that is some follower's source → Track Flow / Triggered**: today the
  follower silently demotes to Continuous via `normalize_track_modes`. The Role
  picker should **warn before** committing ("Track X follows this track; it will
  become Continuous"), surfacing the existing normalizer warning proactively.
- **Last eligible source moved into a box**: any existing follower demotes to
  Continuous — same warning path.
- **Playback running**: the role control is disabled while playing
  (`snapshot.isPlaying`), matching today's guards; keep that.
- **Single-track Track Flow — a deliberate tightening (decision).** The helpers
  disable Track Flow when there is no other track to take turns with
  (`trackRole.ts`), so a single-track project offers only Continuous. This is
  *stricter than today*: the existing "New Track Flow box…" menu (`App.tsx:8633`)
  and the "New Track Flow box" button (`App.tsx:8425`) still let you box a lone
  track, and the backend only rejects *empty* boxes
  (`validate_track_flow_box`, `lib.rs:979`). **Decision:** keep the
  stricter rule for *new* assignments (a one-member "takes turns" box is
  misleading), and **bring the drag/menu paths into line** (hide "New box"/the drop
  zone, and reject single-track boxing, when no other track exists). **Preserve
  existing one-member boxes:** the current role stays selectable, so a track already
  in a one-member box still reads as Track Flow and is not force-migrated —
  `roleOptions`'s current-role carve-out already does this.

## 6. Verification plan (when implemented)

- **Pure helpers (done, unit-tested in `trackRole.test.ts`):** `trackRole`,
  `eligibleTriggerSources`, `roleOptions`, `roleTransition`, plus
  `assignTrackToBoxes` (box-membership mutation, extracted from
  `handleAssignTrackToBox`) and `applyRoleIntent` (the atomic `{ boxes, trigger }`
  a role change implies, computed together). The source is always chosen via
  `eligibleTriggerSources`, so the boxed-source bug in
  `handleSetActiveTrackTriggerMode` (`App.tsx:5270`) cannot recur on this path.
- **New frontend handler `applyTrackRole(intent)`** (the only non-pure piece):
  `buildPatchDocument()` once → `applyRoleIntent` → write `trackFlowBoxes` + the
  active track's `trigger` into that one patch → `applyParallelProject` once. **No
  chaining of `handleAssignTrackToBox` + `applyActiveTrackTrigger`** (two rebuilds
  race); a unit/integration test should assert a single apply per role change.
- **Playwright:** selecting each role produces the right patch (trigger
  set/cleared, membership set/cleared), the disabled-with-reason states, the
  follower-demotion warning, and that a drag and a Role-picker change to the same
  state yield identical patches. Reuse the existing `track-mode-select` /
  `track-flow-*` test ids so current e2e coverage migrates rather than breaks.

### Risks this proposal owns

- **Async race (must fix at implementation):** a role change can require *both*
  un-boxing and a trigger change; doing that as two chained patch-rebuilding
  handlers can overwrite a stale patch. `applyTrackRole` must build and apply one
  patch. (This is why §3.1 forbids reusing the per-axis handlers.)
- **No render/Playwright coverage yet:** the prototype is verified by pure unit
  tests + `tsc` + ESLint only. A jsdom render test is *not* added because this
  repo's jsdom environment currently fails to load (`html-encoding-sniffer` ESM
  break), so rendered behavior is deferred to the Playwright pass above.
- **Pre-existing latent bug surfaced:** `handleSetActiveTrackTriggerMode` can
  already pick a boxed source today; the redesign routes around it but does not, by
  itself, fix that legacy handler — worth a separate small fix.

## 7. Open questions for the author

- Headline term: **"Role"** vs **"Activation"** vs **"Mode"** (today's code uses
  "mode" for `parallel|trackFlow` *and* `continuous|triggered` — overloaded;
  picking one umbrella word and retiring the other uses is part of the win).
- Should Track Flow stay named "Track Flow", or be relabeled to something that
  reads as a peer of Continuous/Triggered (e.g. "Take turns" / "Sequential")?
  Recommend keeping "Track Flow" as the feature name but subtitling it
  "takes turns" so the role list reads as three peers.
