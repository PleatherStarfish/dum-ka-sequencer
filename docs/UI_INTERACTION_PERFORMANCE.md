# UI Interaction Performance

This document records the July 2026 UI latency audit, the fixes that close its
state-coupling bugs, and the regression contract for future controls. Musical
semantics are unchanged: every committed edit still flows through the canonical
preview/playback request path, and the timeline/audio parity rules remain in
force.

## Audited Surface Inventory

| Surface / owner | Coupling found | Mitigation and regression seam |
| --- | --- | --- |
| Transport bar and `App` | Animation-frame clock and active-beat state invalidated the root; Play/Stop completion reflected queueing rather than processing | Small imperative readouts, timeline-owned beat highlight, scheduler acknowledgements, stopped-idle commit-count test |
| Timeline lanes | Highlight movement rerendered stable lanes; point drags could survive document replacement | Memoized lanes, local drag draft, discard-generation test with trailing pointer events |
| `NumericField`, seed lists, names, labels | Keystrokes or invalid partial values reached authored state; hidden focused drafts escaped Save/autosave | Local draft lifecycle, semantic flush/discard, blur/Enter/Escape and delayed-unmount tests |
| `SliderField` and section/rhythm rails | Pointer movement rebuilt App requests and read layout repeatedly | Cached geometry, one release commit, cancel/lost-capture/100-move tests |
| Sections / Subdivisions | Weight and boundary controls coupled pointer-rate changes to preview and backend apply | Shared commit-mode controls plus coalesced coherent previews |
| Rhythm Shaper | Passage typing, articulation rails, extrapolation/import, and closed diagnostics caused root work or stale async writes | Debounced/local passage draft, local rails, generation guards, hidden-body tests |
| Beat Locks and Shape Groups | Range/cell painting and editable lists committed continuously or leaked after Recall | Cached 2-D hit map, one semantic commit, registered text drafts, wrapped-grid and stale-click tests |
| Ratchet / Ornament | Strip/time-curve drags measured and committed per move; preview ownership could leak on disable/unmount | Local/cached gestures, balanced preview ownership, cancel/unmount/geometry regressions |
| Pitch Shaper | Passage typing and learn/transfer work could race later edits; import/transfer modals retained old-document snapshots | Draft debounce, async generation checks, synchronous modal teardown on Recall |
| Channel Shaper | Labels and matrix controls churned App state; playback structure could change during start | Local label drafts, latest-wins playback writes, transition-inclusive structure lock |
| Automation | Bend, graph points, search, and marker labels coupled pointer/typing rate to parent state | Continuous local bend preview only; frame-coalesced graph draft; semantic marker commits and discard tests |
| Parallel tracks / Track Flow | Async select/add/copy/import/remove and custom drags could cross Play or document ownership; view hydration could swallow the first live edit or detach seed recording from its owner | Draft flush + authoring/document generations, post-await structure-lock checks, interaction-released hydration guards, owner-scoped recording session, drag cancellation |
| Patch persistence | Autosave duplicated slow builds; a local draft could change while score/file/cleanup awaits and still appear saved | Single build owner, serialized Save, post-flush interaction token and content rechecks after every await |
| Telemetry bridge/backend | Full rolling MIDI diagnostics cloned/serialized for sparse seed or trigger consumers | Five-mode seed/trigger/full interest mask, selected version digests, scoped payloads, forced mode hydration, Rust sampler test |

## Problems Found And Mitigations

### App-wide render and background work

- The transport animation loop published root React state on every stopped
  animation frame even when tick and cycle were unchanged. It now publishes only
  a meaningful stopped-position change or a playing cycle transition; the
  playhead itself remains an imperative timeline overlay.
- Active-beat highlighting lived in `App`, invalidating the entire UI as the
  playhead crossed beats. `TimelinePanel` now owns that visual state and stable
  timeline lanes are memoized across highlight changes.
- MIDI, automation, conflict, and trigger telemetry was requested even with no
  visible or recording consumer. React now declares telemetry interest only
  while a relevant inspector is visible or a seed path is being recorded.
  The bridge exposes `none`, `seedTrace`, `trigger`, `seedTraceAndTrigger`, and
  `full` modes. The Rust sampler excludes unrelated versions from sparse
  seed/trigger digests and does not clone or serialize unrelated arrays.
  Seed-only recording promotes only the seed rows needed by the always-visible
  loop monitor and recording session; trigger-only inspection updates only
  decision rows. Neither path copies MIDI/automation/conflict arrays. Each
  payload carries its scope, duplicate cumulative traces preserve state
  identity, and changing interest forces one mode-appropriate hydration
  snapshot.
- Collapsed debug tables and closed primary editors still filtered, mapped, and
  rendered their bodies. Closed bodies now unmount while their compact summaries
  remain available. Expensive Randomize matrix diagnostics are built only for an
  open, enabled advanced domain.

### Pointer and text interaction

- `SliderField` used to write semantic/App state for every pointer update. Its
  default contract is now a local visual draft followed by one `onChange` and
  `onChangeEnd` on release. Pointer cancellation restores the committed value;
  lost capture commits once; keyboard changes remain immediate discrete edits.
  `changeMode="continuous"` is reserved for cheap component-local previews such
  as Automation Bend, whose graph redraws from the local draft and commits the
  curve once.
- Boundary weights, rhythm articulation probabilities, Ratchet time-curve
  points, Automation graph points, Beat Lock cell rails, and Beat Lock range
  painting all wrote parent state during pointer movement. Each now caches its
  geometry once, renders a local draft (animation-frame-coalesced where useful),
  and makes one semantic commit on pointer-up or lost capture. Cancellation
  discards the draft.
- Beat Lock range hit-testing uses cached two-dimensional bounds for every beat
  cell. It handles gaps, run-start margins, and wrapped rows; it does not infer a
  beat from the width of the whole strip.
- Name, label, numeric, and other free-form fields that previously sent transient
  or invalid intermediate values now draft locally and commit on blur/Enter (or
  through `NumericField`). Escape restores the committed value. Search/filter
  text remains intentionally local and continuous.
- Authored local drafts register a shared flush/discard lifecycle. Manual Save
  and track export capture hidden drafts; autosave publishes them without moving
  focus; ordinary panel unmount commits them; document replacement discards them.
  Numeric and slider primitives also invalidate an old document's active edit or
  pointer id, so trailing blur/release events cannot leak into a recalled patch.
  Bespoke Automation, Beat Lock, Ratchet, timeline, rail, and Track Flow gestures
  cancel pointer ownership, pending animation work, and cached geometry on the
  same discard signal.
- Rhythm and Pitch passage text now parses and previews from a panel-local draft
  while committing authored state on a short trailing debounce, blur, or
  Command/Ctrl-S. Automation target search and new-marker labels likewise stay
  inside the modal until they are actually committed, so typing no longer
  rebuilds the root sequencer tree. Import-clearing side effects run once per
  passage editing session instead of once per keystroke.
- Native controls that registered both `onChange` and `onInput` for the same
  semantic write were reduced to one path.

### Preview, playback, and async state

- Identical subdivision/rhythm preview requests are coalesced by request key and
  cycle. A stopped timeline retains the last coherent preview while its
  replacement is pending instead of flashing empty or mixing cycles.
- Debounced backend writes use a serialized latest-wins queue: one command may be
  in flight and only the newest pending payload is retained. An old response can
  neither claim UI success/error state nor remain the final backend state.
  Immediate Play joins an identical score apply; if a newer edit supersedes the
  captured score while Play is starting, that start aborts rather than launching
  stale data.
- Synth-program and rhythm/parallel playback configuration writes share the same
  single-writer principle across automatic effects, patch application, synth
  enable, live parallel updates, and Play. Successful payload keys are recorded
  only after the backend accepts them, so a failed write remains retryable.
- Play and Stop are generation-owned exclusive transitions. A second Play
  cannot launch a duplicate runtime, Stop can cancel a start that is waiting on
  IPC, and late cleanup from an older transition cannot change the newer
  transport state. The Play configuration key uses authored tempo rather than a
  live tempo-flux display value; stale stopped snapshots are ignored while Play,
  patch recall, or a tempo write is pending.
- Stop-gated track topology and timing actions treat both `starting` and
  `stopping` as locked states. File choosers, draft flushes, and patch builds
  recheck the transport-transition generation after every await, so an action
  begun while stopped cannot land inside a newly started playback session.
- Play, Stop, resync, and tempo commands now acknowledge only after the scheduler
  has processed the command and published shared transport state. UI transitions
  therefore cannot return to idle merely because a channel send succeeded.
- Seed-path replay is pinned to the run that consumed it. Queueing the next take
  while playing cannot replace the active single-track or parallel seed path.
  The recording path also retains the launch track as its owner independently
  of the track currently shown. A live view switch therefore keeps collecting
  trace points, merges them back only into the owner on return/save/stop, and
  cannot copy one track's seed paths into another.
  Edits made during a failed/aborted start are restaged when backend ownership
  returns to idle, including the auto-score-pending/explicit-Play edge case.
- Rapid track selection, project metadata/trigger edits, Randomize rolls, Pitch
  import/transfer, and Rhythm import/extrapolation use current-value refs or
  generation guards. A stale async completion cannot overwrite a newer user
  action.
- Live track selection hydrates the chosen editor without rewriting the running
  transport. Its transport-effect guards last through hydration and are released
  at the next captured interaction, before that interaction's handler; this
  prevents both a selection-only write and the old timer window that could drop
  the first immediate live edit.
- The shared async-authoring token advances at pointer-down as well as commit,
  and covers assistive click activation. Async track builds flush drafts and
  recheck both content and interaction generation before switching documents.
  Preview errors and explicit import/extrapolation errors have separate owners,
  so an old preview cannot erase a later action failure.
- Structural track/project actions use the full playback lock, including
  `starting` and `stopping`, and async actions recheck that lock after dialogs or
  builds. A late import/select/add completion therefore cannot rewrite the
  project assembled by an in-flight Play.

### Persistence

- Autosave checks stop before patch construction when autosave is disabled, a
  patch is applying, or either the build or write phase is already in flight.
  One owner covers the full build/fingerprint/write sequence.
- Before autosave captures its builder closure, it publishes registered local
  drafts without blurring the editor and yields one task for React to refresh
  the canonical patch capture.
- Patch construction captures all React and project fields synchronously before
  awaiting the backend score snapshot, preventing a mixed old/new project file.
  A generation change during construction invalidates the result, and a fresh
  authored-content comparison also rejects a build made stale by an ordinary
  field edit.
- Manual saves are serialized latest-wins operations and exclude autosave for
  their complete build/write/cleanup window. A newer Save intent prevents an
  older slow build from enqueueing afterward; edits made while a write is in
  flight remain visibly unsaved even though the click-time snapshot was written.
  Persistence captures the shared authoring-interaction generation after draft
  flush and rechecks it after construction, file write, and recovery cleanup, so
  an uncommitted text or pointer draft cannot be hidden by an unchanged content
  fingerprint. Autosave abandons a stale build and never labels a stale recovery
  payload current.
- Patch recall publishes its complete React document before waiting for
  transport synchronization, claims each backend transport intent before
  yielding, and generation-gates error and cleanup callbacks. Save is disabled
  for the recall window so an incoming document cannot be written to the
  outgoing document's path.
- Patch application synchronously closes import/transfer dialogs, delete and
  matrix prompts, inline renames, automation pickers, and active Track Flow
  drags. Frozen transient state from the old document cannot apply to the new
  one after Recall.
- Derived score snapshots are excluded from the authored-content fingerprint.
  Transport progress alone therefore cannot mark a project dirty or trigger a
  redundant autosave.
- Patch application no longer sends the same synth program payload once directly
  and again from the reactive effect.

## Control Contract

Use these rules for new or modified UI:

1. Pointer-rate data belongs in the smallest component that can draw the draft.
2. Cache layout geometry at gesture start; do not call
   `getBoundingClientRect()` for every move.
3. Commit authored state once on release/lost capture. Cancel restores the
   committed value. Keyboard operations commit one discrete step immediately.
4. Use continuous callbacks only for cheap, explicitly local feedback. A
   continuous callback must not construct a patch, invoke Tauri, rebuild the
   timeline request, or write root App state.
5. Debounce limits how often work starts; it does not make already-started async
   work safe. Mutating commands also need serialization and latest-intent checks.
6. Read-only requests should be coalesced by stable input key and ignore stale
   completions.
7. Closed or invisible surfaces may keep summary state, but must not allocate
   large row models, diagnostics, or DOM bodies.
8. A visual transport concern should not live in root state unless another
   App-level consumer genuinely needs it.

## Regression Test Plan

### Unit and component tests

- Drive at least 100 pointer moves through every reusable drag primitive and
  assert zero semantic writes before release and exactly one after release.
- Cover pointer cancel, lost capture, blur where applicable, external controlled
  value changes during a draft, and keyboard arrows/Home/End.
- Mock geometry once, then fail the test if a move re-reads layout. For wrapped
  grids, cover cells on multiple rows and pointer positions in gaps.
- Use deferred promises to test A → B → C command ordering: only A and C may
  start, C must be final, A's error/success must be stale, and a same-key
  immediate request must join rather than duplicate A.
- Cover the inverse same-key edge: when B is an automatic guarded task pending
  behind A, explicit Play for B must replace it and run rather than inherit its
  `starting`-state rejection.
- Test generation-guarded imports/randomization with responses resolved in
  reverse order.
- Resolve an async action during a held pointer gesture, and assert pointer-down
  already invalidated it. Recall a same-valued document mid-edit/mid-drag and
  assert trailing blur, move, lost-capture, and release cannot commit old state.
- Hold track import/add/delete work at a chooser or patch-build await, start
  playback, then release it; the structural action must abort without changing
  the running project. Its controls stay disabled through start and stop.
- Re-feed identical cumulative seed logs and assert no second root/state update;
  when seed recording is the only log consumer, diagnostic log events must not
  commit the main editor, while seed rows still refresh the top loop monitor.
  At the Rust sampler boundary, assert MIDI-only version changes do not wake
  `seedTrace`, `trigger`, or `seedTraceAndTrigger`; seed and trigger changes wake
  only the modes that requested them; and `full` hydrates every log layer.
- Assert closed editors/debug panels have no body rows or expensive diagnostic
  calls while their summaries still report accurate counts/status.
- Test that score-snapshot-only changes do not change the patch fingerprint and
  authored changes do.
- Hold manual-save and autosave builds/writes with deferred promises. Resolve
  rapid saves and competing recalls out of order; assert only the newest intent
  can publish path/status, a stale autosave is rejected by content, and an edit
  during a completed write still leaves the current document unsaved.
- Feed a stopped transport snapshot while Play, recall, and a tempo write are
  pending. Assert it cannot replace the newer authored tempo; stopped idle
  snapshots may be adopted and playing snapshots remain display-only.
- Exercise the scheduler with a recording MIDI sink and assert acknowledged
  Play/Stop/resync/tempo calls expose their new shared snapshot immediately on
  return.

### Browser integration tests

- Install the React DevTools commit hook, leave the stopped app idle for one
  second, and require fewer than 20 root commits (normally near zero after initial
  settling). The historical failure was roughly one commit per animation frame.
- Assert no primary `.editor-panel-body`/`.shaper-body` exists while all editors
  are closed, exactly one appears for the selected editor, and it disappears on
  close.
- Exercise slider/rail drags, wrapped Beat Lock ranges, Automation point drags,
  text blur/Enter/Escape, rapid track switches, and rapid Play-after-edit against
  deferred mocked Tauri commands.
- During parallel playback, switch the shown track and assert the selection
  itself sends no transport config. Immediately edit the new view and require
  exactly one `nextCycle` parallel write. Keep recording through that switch,
  save while viewing the other track, and assert trace points persist only on
  the launch track and continue after switching back.
- Hold score reads, patch writes, and recovery cleanup while typing; the written
  snapshot may complete, but the readout must remain unsaved. Recall while Pitch
  import/transfer drafts are open and require both to close without applying.
  Begin an async structural track action during Play start and require it to be
  rejected before it can mutate project or runtime ownership.
- Preserve existing stopped preview-to-DOM, applied request, live-cycle hiding,
  trigger, channel, and gati-7 timeline/MIDI parity scenarios.

### Full validation

- Frontend: Vitest, TypeScript, production Vite build, focused ESLint, and the
  Playwright parity/performance suite.
- Backend: `cargo test --workspace` and
  `cargo clippy --workspace --all-targets -- -D warnings`.
- Manual profiling: record an idle trace and long drags in each primary editor.
  Confirm no root render train while stopped, no repeated Tauri command during a
  gesture, no forced-layout loop, and no stale command landing after the newest
  payload.

Any regression that makes the timeline show a different realization from the
scheduled MIDI remains release-blocking, even if the UI feels faster.
