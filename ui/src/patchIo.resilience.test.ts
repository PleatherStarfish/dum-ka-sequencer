/**
 * Resilience / hostile-input tests for patchIo normalizers.
 *
 * The patch readers and `normalize*` helpers are the trust boundary for any
 * data coming off disk. The contract they must honor: given arbitrary garbage,
 * either return a *valid normalized value* (never `undefined`/`NaN`/an object
 * with the wrong shape) or throw a clear, intentional error. These tests feed
 * deliberately malformed input and assert that contract — complementing the
 * happy-path round-trip tests in `patchIo.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  PATCH_APP_ID,
  PATCH_SCHEMA_VERSION,
  normalizeAutomationSet,
  normalizeAutosaveIntervalMs,
  normalizeChannelLogicMatrix,
  normalizeCycleTempoFlux,
  normalizeMidiDebugLimit,
  normalizedConflictPriority,
  readPatchDocument,
  type ParallelTrackPatch,
} from "./patchIo";
import { makeMinimalProject, makeMinimalTrack } from "./__fixtures__/patch";

const GARBAGE: unknown[] = [
  null,
  undefined,
  0,
  -1,
  NaN,
  Infinity,
  "",
  "nonsense",
  true,
  [],
  [1, 2, 3],
  {},
  { unexpected: "field" },
  () => undefined,
];

describe("readPatchDocument — hostile input", () => {
  it("throws a clear error for non-objects and wrong app/schema", () => {
    expect(() => readPatchDocument(null)).toThrow(/JSON object/i);
    expect(() => readPatchDocument(42)).toThrow(/JSON object/i);
    expect(() =>
      readPatchDocument({ app: "SomethingElse", schemaVersion: PATCH_SCHEMA_VERSION })
    ).toThrow(/Dum-Ka/);
    expect(() =>
      readPatchDocument({ app: PATCH_APP_ID, schemaVersion: 999 })
    ).toThrow(/schema/i);
  });

  it("throws (does not silently produce junk) when core sections are missing", () => {
    expect(() =>
      readPatchDocument({ app: PATCH_APP_ID, schemaVersion: PATCH_SCHEMA_VERSION })
    ).toThrow();
  });

  it("normalizes a sparse-but-valid v1 doc into a complete document", () => {
    const doc = readPatchDocument({
      app: PATCH_APP_ID,
      schemaVersion: PATCH_SCHEMA_VERSION,
      transport: {},
      sequencer: {},
      rhythm: {},
      project: { activeTrackId: "track-1", global: {}, tracks: [{ id: "track-1" }] },
    });
    expect(doc.project.tracks.length).toBe(1);
    expect(doc.transport.tempoBpm).toBeGreaterThan(0);
    expect(Number.isFinite(doc.sequencer.cycleBeats)).toBe(true);
    expect(doc.project.global.conflictPriority).toContain("track-1");
  });

  it("is idempotent across the on-disk v1 projection", () => {
    const once = JSON.parse(
      JSON.stringify(readPatchDocument(makeMinimalProject(3)))
    );
    const twice = JSON.parse(
      JSON.stringify(readPatchDocument(JSON.parse(JSON.stringify(once))))
    );
    expect(twice).toEqual(once);
  });
});

describe("scalar normalizers clamp/replace garbage with finite values", () => {
  it("normalizeMidiDebugLimit always returns a finite positive integer", () => {
    for (const g of GARBAGE) {
      const v = normalizeMidiDebugLimit(g);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("normalizeAutosaveIntervalMs stays within the documented bounds", () => {
    for (const g of GARBAGE) {
      const v = normalizeAutosaveIntervalMs(g);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1_000);
      expect(v).toBeLessThanOrEqual(60_000);
    }
  });
});

describe("structured normalizers never throw on garbage", () => {
  it("normalizeAutomationSet returns a well-formed set for any input", () => {
    for (const g of GARBAGE) {
      const set = normalizeAutomationSet(g);
      expect(set).toBeTypeOf("object");
      expect(Array.isArray(set.tracks)).toBe(true);
      expect(Array.isArray(set.markers)).toBe(true);
      expect(Number.isFinite(set.lengthCycles)).toBe(true);
    }
  });

  it("normalizeCycleTempoFlux returns finite bpm bounds for any input", () => {
    for (const g of GARBAGE) {
      const flux = normalizeCycleTempoFlux(g);
      expect(typeof flux.enabled).toBe("boolean");
      expect(Number.isFinite(flux.minBpm)).toBe(true);
      expect(Number.isFinite(flux.maxBpm)).toBe(true);
    }
  });
});

describe("channel-conflict normalizers drop dangling ids", () => {
  const tracks: Pick<ParallelTrackPatch, "id">[] = [{ id: "track-1" }, { id: "track-2" }];

  it("normalizedConflictPriority returns exactly the live ids, deduped", () => {
    for (const g of GARBAGE) {
      const out = normalizedConflictPriority(g, tracks);
      expect([...out].sort()).toEqual(["track-1", "track-2"]);
    }
    // Dangling id is dropped; missing live id is appended.
    expect(
      normalizedConflictPriority(["track-2", "ghost", "track-2"], tracks).sort()
    ).toEqual(["track-1", "track-2"]);
  });

  it("normalizeChannelLogicMatrix discards rules referencing unknown tracks", () => {
    const matrix = normalizeChannelLogicMatrix(
      [
        { trackAId: "track-1", trackBId: "ghost", outputChannel: 3, policy: "forceOff" },
        { trackAId: "track-1", trackBId: "track-2", outputChannel: 3, policy: "forceOff" },
      ],
      tracks,
      "priorityOrder"
    );
    for (const rule of matrix) {
      expect(["track-1", "track-2"]).toContain(rule.trackAId);
      expect(["track-1", "track-2"]).toContain(rule.trackBId);
    }
    expect(normalizeChannelLogicMatrix(null, tracks, "priorityOrder")).toEqual([]);
  });
});

describe("fixtures are themselves valid", () => {
  it("makeMinimalTrack and makeMinimalProject produce schema-valid shapes", () => {
    const track = makeMinimalTrack("track-9", "Nine");
    expect(track.id).toBe("track-9");
    expect(track.sequencer).toBeTypeOf("object");
    const project = makeMinimalProject(2);
    expect(project.app).toBe(PATCH_APP_ID);
    expect(project.project.tracks).toHaveLength(2);
  });
});
