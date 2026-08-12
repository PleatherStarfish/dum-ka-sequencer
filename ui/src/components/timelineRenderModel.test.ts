import { describe, expect, it } from "vitest";

import {
  exactCycleValue,
  rememberCachedCycleValue,
  type CachedCycleValue,
} from "./timelineRenderModel";

describe("exactCycleValue", () => {
  const cache = new Map<number, CachedCycleValue<string>>([
    [3, { requestKey: "current-structure", value: "cached current" }],
    [4, { requestKey: "old-structure", value: "cached stale" }],
  ]);

  it("accepts a live value only when request identity and cycle both match", () => {
    expect(exactCycleValue("live", 3, "current-structure", cache, 3, "current-structure"))
      .toBe("live");
    expect(exactCycleValue("stale cycle", 2, "current-structure", cache, 3, "current-structure"))
      .toBe("cached current");
    expect(exactCycleValue("stale request", 3, "old-structure", cache, 3, "current-structure"))
      .toBe("cached current");
  });

  it("never falls back to a differently keyed playback cache entry", () => {
    expect(exactCycleValue(null, null, "", cache, 4, "current-structure"))
      .toBeNull();
  });

  it("refreshes insertion order when an LRU entry is reused", () => {
    let current = new Map<number, CachedCycleValue<string>>();
    current = rememberCachedCycleValue(current, 1, "key", "one", 2);
    current = rememberCachedCycleValue(current, 2, "key", "two", 2);
    current = rememberCachedCycleValue(current, 1, "key", "one again", 2);
    current = rememberCachedCycleValue(current, 3, "key", "three", 2);

    expect([...current.keys()]).toEqual([1, 3]);
    expect(current.get(1)?.value).toBe("one again");
  });
});
