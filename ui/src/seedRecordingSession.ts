import type { PlaybackSeedTraceEvent } from "./bridge";
import type { ParallelProjectPatch, SeedPath } from "./patchIo";
import { seedTraceDedupeKey } from "./timelineModel";

export interface SeedRecordingSession {
  ownerTrackId: string | null;
  path: SeedPath;
}

const MAX_SEED_PATHS = 24;

/** Insert the recording path without changing any other track's path list. */
export function upsertSeedPath(
  paths: readonly SeedPath[],
  path: SeedPath
): SeedPath[] {
  return [path, ...paths.filter((candidate) => candidate.id !== path.id)].slice(
    0,
    MAX_SEED_PATHS
  );
}

/**
 * Append a telemetry batch to the session-owned path. The ref that holds this
 * result is independent of the selected editor track, so a view switch cannot
 * make later trace points disappear.
 */
export function appendSeedRecordingEvents(
  session: SeedRecordingSession,
  events: readonly PlaybackSeedTraceEvent[],
  recordedAt: string
): SeedRecordingSession {
  if (events.length === 0) return session;
  const existing = new Set(session.path.trace.map(seedTraceDedupeKey));
  const additions = events.flatMap((event) => {
    const key = seedTraceDedupeKey(event);
    if (existing.has(key)) return [];
    existing.add(key);
    return [{ ...event, recordedAt }];
  });
  if (additions.length === 0) return session;
  return {
    ...session,
    path: {
      ...session.path,
      trace: [...session.path.trace, ...additions],
    },
  };
}

/** Show the live session only while its owning track is selected. */
export function seedPathsForSelectedTrack(
  paths: readonly SeedPath[],
  selectedTrackId: string | null,
  session: SeedRecordingSession | null
): SeedPath[] {
  return session && session.ownerTrackId === selectedTrackId
    ? upsertSeedPath(paths, session.path)
    : [...paths];
}

/** Persist the session path into its owner without touching the viewed track. */
export function projectWithSeedRecording(
  project: ParallelProjectPatch | null,
  session: SeedRecordingSession | null
): ParallelProjectPatch | null {
  if (!project || !session?.ownerTrackId) return project;
  if (!project.tracks.some((track) => track.id === session.ownerTrackId)) {
    return project;
  }
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === session.ownerTrackId
        ? {
            ...track,
            seedPaths: upsertSeedPath(track.seedPaths, session.path),
          }
        : track
    ),
  };
}
