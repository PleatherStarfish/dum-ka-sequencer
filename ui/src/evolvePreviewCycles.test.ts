import { describe, expect, it } from "vitest";

import { selectEvolutionPreviewCycles } from "./evolvePreviewCycles";

describe("selectEvolutionPreviewCycles", () => {
  it("keeps every visible cycle and bounds directive-edge prewarming to the LRU", () => {
    const plan = Array.from({ length: 300 }, (_, order) => ({
      order,
      fromCycle: 1_000 + order * 3,
      toCycle: 1_001 + order * 3,
    }));
    const selected = selectEvolutionPreviewCycles(plan, 20, 40, 10_000, 32);

    expect(selected.cacheLimit).toBe(32);
    expect(selected.cycles).toHaveLength(32);
    for (let cycle = 20; cycle <= 40; cycle += 1) {
      expect(selected.cycles).toContain(cycle);
    }
  });

  it("grows the cache limit when the visible viewport itself is wider", () => {
    const selected = selectEvolutionPreviewCycles([], 0, 80, 10_000, 32);
    expect(selected.cacheLimit).toBe(81);
    expect(selected.cycles).toEqual(Array.from({ length: 81 }, (_, cycle) => cycle));
  });

  it("clamps reversed and extreme windows to the stopped-preview domain", () => {
    expect(selectEvolutionPreviewCycles([], 20_000, -5, 10_000, 8)).toEqual({
      cycles: Array.from({ length: 512 }, (_, cycle) => cycle),
      cacheLimit: 512,
    });
  });
});
