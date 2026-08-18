import { describe, expect, it } from "vitest";

import {
  selectEvolutionPreviewCycles,
  selectEvolveCachedPreviews,
} from "./evolvePreviewCycles";

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

describe("selectEvolveCachedPreviews", () => {
  const entry = (requestKey: string, value: string) => ({ requestKey, value });

  it("returns current-key entries unflagged and sorted by cycle", () => {
    const cache = new Map([
      [7, entry("k1", "seven")],
      [2, entry("k1", "two")],
    ]);
    expect(selectEvolveCachedPreviews("k1", [cache])).toEqual([
      { cycle: 2, preview: "two", stale: false },
      { cycle: 7, preview: "seven", stale: false },
    ]);
  });

  it("keeps differently keyed values flagged stale instead of dropping them", () => {
    // An edit that rotates the request key (drawing a curve point, changing a
    // weight) must not blank the strip: the old value stays, dimmed, until
    // the refill effect replaces it under the new key.
    const cache = new Map([
      [3, entry("old-key", "before-edit")],
      [4, entry("new-key", "after-edit")],
    ]);
    expect(selectEvolveCachedPreviews("new-key", [cache])).toEqual([
      { cycle: 3, preview: "before-edit", stale: true },
      { cycle: 4, preview: "after-edit", stale: false },
    ]);
  });

  it("prefers a fresh entry from any cache over a stale one for the same cycle", () => {
    const evolveCache = new Map([[5, entry("old-key", "stale-value")]]);
    const timelineCache = new Map([[5, entry("k", "fresh-value")]]);
    expect(
      selectEvolveCachedPreviews("k", [evolveCache, timelineCache])
    ).toEqual([{ cycle: 5, preview: "fresh-value", stale: false }]);
    // A fresh first-cache entry is never displaced by a stale later one.
    expect(
      selectEvolveCachedPreviews("k", [timelineCache, evolveCache])
    ).toEqual([{ cycle: 5, preview: "fresh-value", stale: false }]);
  });

  it("keeps the first stale candidate when no cache has a fresh value", () => {
    const evolveCache = new Map([[9, entry("a", "authoring")]]);
    const timelineCache = new Map([[9, entry("b", "render")]]);
    expect(
      selectEvolveCachedPreviews("current", [evolveCache, timelineCache])
    ).toEqual([{ cycle: 9, preview: "authoring", stale: true }]);
  });
});
