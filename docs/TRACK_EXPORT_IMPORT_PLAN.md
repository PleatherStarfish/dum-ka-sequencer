# Track export and import

Status: implemented in Seqstart v1.

## Envelope

A track is exported as a strict `.seqstart-track` JSON envelope:

```text
app: Seqstart
kind: track
schemaVersion: 1
savedAt: ISO timestamp
track: projected portable track
global: saved reference tempo/cycle context
```

This shape is distinct from a `.seqstart` project. The TypeScript projection in
`ui/src/patchIo.ts` strips UI/recovery/project-only state; Rust
`validate_track_document` rejects unsupported versions, malformed envelopes,
and removed-feature keys before write.

## Export

Each track can be exported from its destructive-action confirmation/menu flow.
Before building the envelope, the handler:

1. verifies playback structure is stable;
2. records authoring generation and project revision;
3. flushes the focused editor draft;
4. captures authored fingerprint;
5. awaits the score snapshot/build;
6. rejects a result if generation, revision, transition, or fingerprint changed;
7. asks for a `.seqstart-track` path and writes through the Tauri boundary.

Every cancellation/guard produces a distinct visible status.

## Import

Import reads and normalizes a v1 envelope, then asks whether to keep saved
track-local tempo/cycle or follow the destination project's global values. The
splice:

- assigns a fresh unique track ID, name, and color;
- resets mute/solo;
- does not import a trigger source or score snapshot blindly;
- drops seed paths that are project/run specific;
- appends the track without replacing the active project;
- reconciles `conflictPriority` and `channelLogicMatrix`;
- respects the 16-track limit;
- makes the imported track active on success.

Import is revision/fingerprint/transition guarded around every await. A changed
destination project cannot receive a track built for an older snapshot.

## Coverage

- TypeScript projection/normalization/resilience tests in `patchIo*.test.ts`.
- Pure splice/reconciliation tests in `patchIo.test.ts`.
- Mock workflow in `ui/tests/e2e/track-export-import.spec.ts`, including import
  into an already-applied project.
- Real filesystem/dialog roundtrip in `ui/tests/e2e/real-backend-parity.spec.ts`; it skips
  MIDI-dependent assertions when the backend reports `midiReady: false`.
- Rust validation tests reject stripped keys in both patch and track envelopes.
