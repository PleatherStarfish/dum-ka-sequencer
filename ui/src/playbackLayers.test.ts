/**
 * Two-way agreement between the frontend layer descriptor table and the
 * Rust-generated golden snapshot DTO (`__fixtures__/dto/`, emitted by the
 * `dto_fixtures` tests in src-tauri). Together with the compile-time key
 * assertion in `playbackLayers.ts`, this makes "add a playback layer" fail
 * loudly on every unmirrored surface instead of going silently stale.
 */
import { describe, expect, it } from "vitest";

import { transportSnapshotFixture } from "./__fixtures__/dto/transportSnapshot.fixture";
import { TRANSPORT_EVENT_LAYERS } from "./playbackLayers";

describe("playback layer descriptor table", () => {
  it("every descriptor key is a populated array on the real snapshot DTO", () => {
    for (const layer of TRANSPORT_EVENT_LAYERS) {
      const value = transportSnapshotFixture[layer.key];
      expect(Array.isArray(value), `${layer.key} must be a snapshot array`).toBe(
        true
      );
      // The golden fixture populates every layer; an empty array here means
      // the fixture and the descriptor table disagree about this key.
      expect(value.length, `${layer.key} must be populated in the fixture`)
        .toBeGreaterThan(0);
    }
  });

  it("every event-array layer in the real snapshot DTO has a descriptor row", () => {
    const descriptorKeys = new Set<string>(
      TRANSPORT_EVENT_LAYERS.map((layer) => layer.key)
    );
    const fixtureEventKeys = Object.keys(transportSnapshotFixture).filter(
      (key) => key.endsWith("Events")
    );
    expect(fixtureEventKeys.length).toBeGreaterThan(0);
    for (const key of fixtureEventKeys) {
      expect(
        descriptorKeys.has(key),
        `snapshot layer ${key} has no descriptor row in playbackLayers.ts — ` +
          `add it (and its renderer) so the timeline cannot go stale on it`
      ).toBe(true);
    }
  });

  it("descriptor keys are unique and cover all retained layers", () => {
    const keys = TRANSPORT_EVENT_LAYERS.map((layer) => layer.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(8);
  });
});
