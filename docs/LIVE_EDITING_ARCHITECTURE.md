# Live-editing architecture

Status: current Dum-Ka contract.

## Two edit classes

### Value edits

Tempo, generator density/seed configuration, Channel Shaper settings, and other
non-topological values may build a replacement playback request. The request is
generation-tagged and applied through scheduler-acknowledged transport commands.
The UI can preview locally during a gesture, but commits once on pointer release,
Enter, or blur.

### Structural edits

Cycle length, section boundaries, fixed Subdivision/Grouping, track add/copy/
delete/import, roles, trigger graph, and Track Flow membership change runtime
topology. They are disabled from the start of a Play/Stop transition until the
transport is stably stopped.

## Request order

The frontend coordinates asynchronous work with:

- authoring generation for any committed editor change;
- project revision for parallel-project structure;
- playback transition generation/kind;
- request keys for cached section/generator previews;
- `LatestWinsQueue` for persistence and project mutations.

A handler that awaits must capture the relevant tokens before the await and
revalidate them before applying. A newer action wins even if an older promise
resolves last.

## Preview lifecycle

Section preview and generator preview are separate command requests but one
logical frame. The generator request consumes the resolved structural spans.
The timeline publishes a frame only when request keys/generations match current
authored state.

During playback, scheduler-recorded generator/channel/trigger/Track Flow/
conflict layers supersede stopped preview. During pending or stale work, the
last ready rows remain mounted; loading is a status, not an empty musical state.

## Playback reapply

Transport mutations are messages to the scheduler thread. A successful command
returns after processing and snapshot publication. Reapply resets affected
realization state, releases notes that cannot safely survive, and deterministically
rebuilds future cycles. It may not rewrite finalized future events in place.

Global BPM and a track's custom BPM are independent authored values. Editing
the project reference tempo updates tracks that follow global; it must not write
the active custom track's stored BPM.

## Draft flush and persistence

Focused inputs own local text/draft state. Before Save, Save As, export, import,
new/copy track, or another snapshot action, `flushFocusedEditorDraft` blurs the
active field and awaits registered flushers.

Patch/track builders capture the current authored content fingerprint before
their asynchronous score snapshot. They accept the build only if:

- authoring generation is unchanged;
- project revision is unchanged where applicable;
- playback transition is still compatible; and
- the built patch fingerprint matches the pre-await authored fingerprint.

Comparing to a freshly recaptured post-await fingerprint is incorrect: derived
state may have moved, and an authored edit during the await must be rejected.

## Test requirements

- Delayed preview tests hold the actual request, author a newer state, release
  it, and prove rows remain mounted and the stale result is ignored.
- Fingerprint tests mutate authored state during a stubbed async score build and
  prove the guard rejects on revert.
- Mock and real import tests exercise dialogs, disk shape, destination splice,
  and visible completion status.
- Timeline/MIDI parity tests inspect scheduler driver state, not only DOM copy.
