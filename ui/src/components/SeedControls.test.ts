import { describe, expect, it } from "vitest";

import {
  parseSeeds,
  seedBehaviorShortLabel,
  seedListLabel,
  seedModeShortLabel,
  seedPathPlaybackConfig,
  seedStrategyDetail,
  seedStrategySummary,
  seedToneCode,
  seedToneForBehavior,
  seedToneForMode,
  seedToneName,
} from "./SeedControls";
import type { SeedPath } from "../patchIo";

describe("parseSeeds / seedListLabel", () => {
  it("parses a comma list, dropping invalid and negative entries", () => {
    expect(parseSeeds("1, 2, 3")).toEqual(["1", "2", "3"]);
    expect(parseSeeds(" 7 ,x, -4, 9 ")).toEqual(["7", "9"]);
    expect(parseSeeds("")).toEqual([]);
  });

  it("preserves full-width decimal seeds and rejects u64 overflow", () => {
    expect(
      parseSeeds(
        "09007199254740993, 18446744073709551615, 18446744073709551616"
      )
    ).toEqual(["9007199254740993", "18446744073709551615"]);
  });

  it("labels a seed list, with an empty fallback", () => {
    expect(seedListLabel([1, 2])).toBe("1, 2");
    expect(seedListLabel([])).toBe("empty");
  });
});

describe("seed path replay wire", () => {
  it("preserves a full-width u64 through replay request assembly", () => {
    const fullWidthSeed = "16602156551234156693";
    const path: SeedPath = {
      id: "u64-path",
      name: "u64 path",
      createdAt: "2026-08-02T00:00:00.000Z",
      sourcePathId: null,
      immutable: true,
      wildcardRules: [],
      trace: [
        {
          cycle: 4,
          domain: "rhythm",
          label: "Rhythm seed",
          seed: fullWidthSeed,
          baseSeed: fullWidthSeed,
          source: "history",
          historyBefore: ["7", fullWidthSeed],
          historyAfter: [fullWidthSeed, "7"],
          parallelTrackIndex: null,
          trackId: null,
          recordedAt: "2026-08-02T00:00:00.000Z",
        },
      ],
    };

    const wire = JSON.parse(JSON.stringify(seedPathPlaybackConfig(path)));
    expect(wire.entries[0]).toMatchObject({
      seed: fullWidthSeed,
      baseSeed: fullWidthSeed,
      historyBefore: ["7", fullWidthSeed],
      historyAfter: [fullWidthSeed, "7"],
    });
  });
});

describe("seed mode / behavior short labels", () => {
  it("labels modes", () => {
    expect(seedModeShortLabel("locked")).toBe("locked");
    expect(seedModeShortLabel("history")).toBe("history/new");
    expect(seedModeShortLabel("perCycle")).toBe("per-cycle");
    expect(seedModeShortLabel("drift")).toBe("drift");
    expect(seedModeShortLabel("morph")).toBe("morph");
  });

  it("labels behaviors, with inheritance", () => {
    expect(seedBehaviorShortLabel("followGlobal")).toBe("inherits");
    expect(seedBehaviorShortLabel("locked")).toBe("locked");
    expect(seedBehaviorShortLabel("history")).toBe("history/new");
    expect(seedBehaviorShortLabel("drift")).toBe("drift");
    expect(seedBehaviorShortLabel("morph")).toBe("morph");
  });
});

describe("seed tones", () => {
  it("maps modes and behaviors to tones", () => {
    expect(seedToneForMode("locked")).toBe("locked");
    expect(seedToneForMode("history")).toBe("history");
    expect(seedToneForMode("perCycle")).toBe("cycle");
    expect(seedToneForMode("drift")).toBe("drift");
    expect(seedToneForMode("morph")).toBe("morph");
    expect(seedToneForBehavior("followGlobal")).toBe("inherit");
    expect(seedToneForBehavior("locked")).toBe("locked");
    expect(seedToneForBehavior("drift")).toBe("drift");
    expect(seedToneForBehavior("morph")).toBe("morph");
  });

  it("codes and names tones", () => {
    expect(seedToneCode("locked")).toBe("L");
    expect(seedToneCode("history")).toBe("H");
    expect(seedToneCode("inherit")).toBe("IN");
    expect(seedToneCode("ratchet")).toBe("R");
    expect(seedToneCode("drift")).toBe("D");
    expect(seedToneCode("morph")).toBe("M");
    expect(seedToneCode("cycle")).toBe("C");
    expect(seedToneName("history")).toBe("History");
    expect(seedToneName("inherit")).toBe("Inherits");
    expect(seedToneName("drift")).toBe("Drift");
    expect(seedToneName("morph")).toBe("Morph");
  });
});

describe("seedStrategySummary / seedStrategyDetail", () => {
  it("summarizes history pools vs a fixed seed", () => {
    expect(
      seedStrategySummary(
        "history",
        42,
        ["1", "2", "3"],
        2,
        1,
        8,
        15,
        50,
        16
      )
    ).toBe("3 remembered · history 2 / new 1 · max 8");
    expect(seedStrategySummary("locked", 42, [], 0, 0, 0, 15, 50, 16)).toBe(
      "locked seed 42"
    );
  });

  it("summarizes drift with its re-roll chance", () => {
    expect(seedStrategySummary("drift", 42, [], 0, 0, 0, 35, 50, 16)).toBe(
      "drift seed 42 · 35% new"
    );
  });

  it("summarizes morph with its chances and blend width", () => {
    expect(seedStrategySummary("morph", 42, [], 0, 0, 0, 25, 40, 12)).toBe(
      "morph seed 42 · 25% new · hold 40% · blend 12"
    );
  });

  it("explains each strategy", () => {
    expect(seedStrategyDetail("locked")).toContain("reused");
    expect(seedStrategyDetail("history")).toContain("remembered seed");
    expect(seedStrategyDetail("perCycle")).toContain("cycle number");
    expect(seedStrategyDetail("drift")).toContain("previous cycle's seed");
    expect(seedStrategyDetail("morph")).toContain("crossfade");
  });
});
