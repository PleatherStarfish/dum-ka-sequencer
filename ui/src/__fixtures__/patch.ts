/**
 * Shared, lightweight patch/track fixtures for vitest specs.
 *
 * These are intentionally minimal — just enough valid shape to exercise the
 * pure logic in `patchIo.ts` and the bridge contracts. They lean on the
 * library's own normalizers (`readPatchDocument`, `readTrackEnvelope`,
 * `normalizeParallelTrackPatch`) to fill defaults, so a fixture stays valid even
 * as the schema grows. For deep, field-by-field serialization fixtures see the
 * heavier builders inside `patchIo.test.ts`.
 */
import {
  DEFAULT_PARALLEL_TRACK_ID,
  PATCH_APP_ID,
  PATCH_SCHEMA_VERSION,
  buildTrackEnvelope,
  readPatchDocument,
  readTrackEnvelope,
  type ParallelProjectPatch,
  type ParallelTrackPatch,
  type SequencerPatchDocument,
  type SequencerPatchFlatState,
} from "../patchIo";

export const FIXTURE_SAVED_AT = "2026-05-30T19:00:00.000Z";

/**
 * A fully-defaulted flat state, produced by running an empty stub through the
 * real project reader. Useful as a `fallback` argument for normalizers.
 */
export function defaultFlatState(): SequencerPatchFlatState {
  return readPatchDocument({
    app: PATCH_APP_ID,
    schemaVersion: PATCH_SCHEMA_VERSION,
    transport: {},
    sequencer: {},
    rhythm: {},
    project: {
      activeTrackId: DEFAULT_PARALLEL_TRACK_ID,
      global: {},
      tracks: [{ id: DEFAULT_PARALLEL_TRACK_ID }],
    },
  });
}

/**
 * A single normalized track with the given id/name, built by round-tripping a
 * sparse object through `readTrackEnvelope` so every field is schema-valid.
 */
export function makeMinimalTrack(
  id = "track-1",
  name = "Track 1"
): ParallelTrackPatch {
  const envelope = buildTrackEnvelope(
    { id, name } as unknown as ParallelTrackPatch,
    { tempoBpm: 80, cycleBeats: 8 }
  );
  // buildTrackEnvelope clones its input verbatim; normalize it to fill defaults.
  return readTrackEnvelope(envelope).track;
}

/**
 * A minimal but valid multi-track project document. `trackCount` tracks named
 * "Track 1".."Track N", the first active.
 */
export function makeMinimalProject(trackCount = 2): SequencerPatchDocument {
  const flat = defaultFlatState();
  const tracks: ParallelTrackPatch[] = Array.from({ length: trackCount }, (_, i) =>
    makeMinimalTrack(`track-${i + 1}`, `Track ${i + 1}`)
  );
  const project: ParallelProjectPatch = {
    activeTrackId: tracks[0]!.id,
    global: {
      tempoBpm: 80,
      cycleBeats: 8,
      channelConflictPolicy: "priorityOrder",
      channelLogicMatrix: [],
      conflictPriority: tracks.map((t) => t.id),
      trackFlowBoxes: [],
      synthEnabled: false,
      synthPrograms: flat.transport.synthPrograms,
      rhythmPlaybackEnabled: true,
      cycleTempoFlux: flat.transport.cycleTempoFlux,
    },
    tracks,
  };
  // Round-trip through the reader so the doc is exactly what the app would load.
  return readPatchDocument({ ...flat, schemaVersion: PATCH_SCHEMA_VERSION, project });
}
