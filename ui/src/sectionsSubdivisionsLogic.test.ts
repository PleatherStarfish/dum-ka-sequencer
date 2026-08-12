import { describe, expect, it } from "vitest";

import {
  availableCanonicalGatis,
  boundaryPositionOptions,
  canonicalizeGatiWeights,
  canonicalizeJathiWeights,
  canonicalizeSwitchCountWeights,
  fixedGroupingFromWeights,
  fixedGroupingWeights,
  fixedSubdivisionFromWeights,
  fixedSubdivisionWeights,
  isValidGroupingChoice,
  visibleGatiWeights,
} from "./sectionsSubdivisionsLogic";

describe("sections/subdivisions logic", () => {
  it("coalesces duplicate gati identities by summing weights", () => {
    expect(
      canonicalizeGatiWeights([
        { subdivision: 4, weight: 2 },
        { subdivision: 4, weight: 3 },
        { subdivision: 7, weight: 1 },
        { subdivision: 0, weight: 9 },
        { subdivision: 5, weight: -1 },
      ])
    ).toEqual([
      { subdivision: 4, weight: 5 },
      { subdivision: 7, weight: 1 },
    ]);
  });

  it("keeps gati chips active-only while offering unused canonical choices", () => {
    const visible = visibleGatiWeights([
      { subdivision: 4, weight: 2 },
      { subdivision: 5, weight: 0 },
      { subdivision: 8, weight: 1 },
    ]);

    expect(visible).toEqual([
      { subdivision: 4, weight: 2 },
      { subdivision: 8, weight: 1 },
    ]);
    expect(availableCanonicalGatis(visible)).toEqual([3, 5, 6, 7, 9, 11]);
  });

  it("coalesces duplicate jathi identities and can fill the canonical palette", () => {
    expect(
      canonicalizeJathiWeights(
        [
          { jathi: 3, weight: 1 },
          { jathi: 3, weight: 2 },
          { jathi: 8, weight: 9 },
        ],
        { includeAll: true }
      )
    ).toEqual([
      { jathi: 3, weight: 3 },
      { jathi: 4, weight: 0 },
      { jathi: 5, weight: 0 },
      { jathi: 6, weight: 0 },
      { jathi: 7, weight: 0 },
      { jathi: 9, weight: 0 },
      { jathi: 11, weight: 0 },
    ]);
  });

  it("coalesces switch count weights within the legal boundary count", () => {
    expect(
      canonicalizeSwitchCountWeights(
        [
          { count: 0, weight: 1 },
          { count: 2, weight: 2 },
          { count: 2, weight: 3 },
          { count: 4, weight: 8 },
        ],
        3
      )
    ).toEqual([
      { count: 0, weight: 1 },
      { count: 2, weight: 5 },
    ]);
  });

  it("offers only unoccupied boundary positions except the current boundary", () => {
    expect(
      boundaryPositionOptions(
        6,
        [{ afterBeat: 2 }, { afterBeat: 4 }],
        4
      )
    ).toEqual([1, 3, 4, 5]);
  });

  it("projects legacy subdivision weights to one fixed authored value", () => {
    expect(
      fixedSubdivisionFromWeights([
        { subdivision: 7, weight: 2 },
        { subdivision: 5, weight: 4 },
        { subdivision: 3, weight: 4 },
      ])
    ).toBe(5);
    expect(fixedSubdivisionFromWeights([], 6)).toBe(6);
    expect(fixedSubdivisionWeights(7.4)).toEqual([
      { subdivision: 7, weight: 1 },
    ]);
  });

  it("projects only valid grouping weights and supports no grouping", () => {
    expect(
      fixedGroupingFromWeights(
        [
          { jathi: 5, weight: 3 },
          { jathi: 3, weight: 3 },
          { jathi: 4, weight: 9 },
        ],
        15,
        4
      )
    ).toBe(5);
    expect(isValidGroupingChoice(4, 16, 4)).toBe(false);
    expect(fixedGroupingWeights(5)).toEqual([{ jathi: 5, weight: 1 }]);
    expect(fixedGroupingWeights(null)).toEqual([]);
  });
});
