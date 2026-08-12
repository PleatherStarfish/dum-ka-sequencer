import { describe, expect, it } from "vitest";

import {
  firstOpenBoundaryAfterBeat,
  makeBoundaryPoint,
  newStableId,
} from "./boundaryPlanning";

describe("firstOpenBoundaryAfterBeat", () => {
  it("returns the first unused beat", () => {
    expect(firstOpenBoundaryAfterBeat([], 4)).toBe(1);
    expect(
      firstOpenBoundaryAfterBeat([makeBoundaryPoint(1, "a")], 4)
    ).toBe(2);
  });

  it("falls back to the last slot when all are used", () => {
    const used = [1, 2, 3].map((b, i) => makeBoundaryPoint(b, `b${i}`));
    expect(firstOpenBoundaryAfterBeat(used, 4)).toBe(3);
  });
});

describe("makeBoundaryPoint", () => {
  it("builds a default boundary at the given beat", () => {
    const point = makeBoundaryPoint(2, "fixed-id");
    expect(point.id).toBe("fixed-id");
    expect(point.afterBeat).toBe(2);
    expect(point.changeProbability).toBe(1);
    expect(point.customSubdivision).toBeNull();
    expect(point.weights).toEqual([{ subdivision: 4, weight: 1 }]);
    expect(point.jathiWeights).toEqual([]);
  });
});

describe("newStableId", () => {
  it("prefixes the id and stays unique", () => {
    expect(newStableId("boundary")).toMatch(/^boundary-/);
    expect(newStableId("x")).not.toBe(newStableId("x"));
  });
});
