import { describe, expect, it } from "vitest";

import type { ParallelProjectPatch, SeedPath } from "./patchIo";
import {
  appendSeedRecordingEvents,
  projectWithSeedRecording,
  seedPathsForSelectedTrack,
  type SeedRecordingSession,
} from "./seedRecordingSession";

function path(id: string, cycles: number[] = []): SeedPath {
  return {
    id,
    name: id,
    createdAt: "2026-07-31T00:00:00.000Z",
    sourcePathId: null,
    immutable: true,
    wildcardRules: [],
    trace: cycles.map((cycle) => ({
      cycle,
      domain: "subdivision",
      label: "Subdivision switch",
      seed: String(100 + cycle),
      baseSeed: "7",
      source: "locked",
      historyBefore: [],
      historyAfter: [String(100 + cycle)],
      parallelTrackIndex: 1,
      trackId: "track-beta",
      recordedAt: "2026-07-31T00:00:00.000Z",
    })),
  };
}

function project(): ParallelProjectPatch {
  return {
    activeTrackId: "track-alpha",
    global: {} as ParallelProjectPatch["global"],
    tracks: [
      { id: "track-alpha", seedPaths: [path("alpha-path")] },
      { id: "track-beta", seedPaths: [path("recording", [0])] },
    ] as ParallelProjectPatch["tracks"],
  };
}

describe("seed recording session ownership", () => {
  it("deduplicates telemetry while appending later cycles to the session path", () => {
    const session: SeedRecordingSession = {
      ownerTrackId: "track-beta",
      path: path("recording", [0]),
    };
    const repeated = session.path.trace[0]!;
    const next = appendSeedRecordingEvents(
      session,
      [repeated, { ...repeated, cycle: 1, seed: "101" }],
      "2026-07-31T01:00:00.000Z"
    );

    expect(next.path.trace.map((point) => point.cycle)).toEqual([0, 1]);
    expect(next.path.trace[1]?.recordedAt).toBe("2026-07-31T01:00:00.000Z");
  });

  it("copies and deduplicates full-width trace values without coercion", () => {
    const fullWidthSeed = "16602156551234156693";
    const adjacentSeed = "16602156551234156692";
    const session: SeedRecordingSession = {
      ownerTrackId: "track-beta",
      path: path("recording"),
    };
    const event = {
      cycle: 0,
      domain: "rhythm",
      label: "Rhythm seed",
      seed: fullWidthSeed,
      baseSeed: "18446744073709551615",
      source: "history",
      historyBefore: [adjacentSeed, fullWidthSeed],
      historyAfter: [fullWidthSeed, adjacentSeed],
      parallelTrackIndex: 1,
      trackId: "track-beta",
    };

    const next = appendSeedRecordingEvents(
      session,
      [event, { ...event }],
      "2026-07-31T01:00:00.000Z"
    );

    expect(next.path.trace).toHaveLength(1);
    expect(next.path.trace[0]).toMatchObject({
      seed: fullWidthSeed,
      baseSeed: "18446744073709551615",
      historyBefore: [adjacentSeed, fullWidthSeed],
      historyAfter: [fullWidthSeed, adjacentSeed],
    });
  });

  it("does not expose an active path in a different track's editor", () => {
    const session: SeedRecordingSession = {
      ownerTrackId: "track-beta",
      path: path("recording", [0, 1]),
    };
    expect(
      seedPathsForSelectedTrack([path("alpha-path")], "track-alpha", session).map(
        (candidate) => candidate.id
      )
    ).toEqual(["alpha-path"]);
    expect(
      seedPathsForSelectedTrack([path("recording", [0])], "track-beta", session)[0]
        ?.trace
    ).toHaveLength(2);
  });

  it("persists the recording into its owner while another track is selected", () => {
    const session: SeedRecordingSession = {
      ownerTrackId: "track-beta",
      path: path("recording", [0, 1, 2]),
    };
    const next = projectWithSeedRecording(project(), session)!;

    expect(next.activeTrackId).toBe("track-alpha");
    expect(next.tracks[0]?.seedPaths.map((candidate) => candidate.id)).toEqual([
      "alpha-path",
    ]);
    expect(next.tracks[1]?.seedPaths[0]?.trace).toHaveLength(3);
  });
});
