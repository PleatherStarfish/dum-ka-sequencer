import { describe, expect, it } from "vitest";
import metricsContract from "./__fixtures__/dumka_metrics_contract.json";

import { compileDumkaPattern } from "./dumkaPattern";
import {
  barlowPoolSize,
  beatLevel,
  factorDescending,
  figureCandidateCounts,
  gridInsight,
  indispensability,
  leashBudget,
  metricalLevels,
  stratification,
} from "./dumkaMetrics";

interface ContractCase {
  cycleBeats: number;
  subdivision: number;
  metrics: {
    strata: number[];
    ranks: number[];
    levels: number[];
    beatLevel: number;
  } | null;
}

describe("dumkaMetrics", () => {
  it("matches the Rust metrics contract fixture on every grid", () => {
    const cases = metricsContract as ContractCase[];
    expect(cases.length).toBeGreaterThan(0);
    for (const contractCase of cases) {
      const strata = stratification(
        contractCase.cycleBeats,
        contractCase.subdivision
      );
      if (contractCase.metrics === null) {
        expect(strata).toBeNull();
        continue;
      }
      expect(strata).toEqual(contractCase.metrics.strata);
      expect(indispensability(strata!)).toEqual(contractCase.metrics.ranks);
      expect(metricalLevels(strata!)).toEqual(contractCase.metrics.levels);
      expect(beatLevel(contractCase.cycleBeats)).toBe(
        contractCase.metrics.beatLevel
      );
    }
  });

  it("reproduces Barlow's published tables", () => {
    expect(indispensability([3, 2])).toEqual([5, 0, 3, 1, 4, 2]);
    expect(indispensability([2, 3])).toEqual([5, 0, 2, 4, 1, 3]);
    expect(indispensability([2, 2, 2])).toEqual([7, 0, 4, 2, 6, 1, 5, 3]);
    expect(indispensability([3, 5])).toEqual([
      14, 0, 9, 3, 6, 12, 1, 10, 4, 7, 13, 2, 11, 5, 8,
    ]);
    expect(factorDescending(12)).toEqual([3, 2, 2]);
    expect(metricalLevels([3, 2])).toEqual([0, 2, 1, 2, 1, 2]);
    expect(metricalLevels([2, 3])).toEqual([0, 2, 2, 1, 2, 2]);
  });

  it("pins the two display formulas to the engine's integer arithmetic", () => {
    // evolve.rs pool_pick: 1 + floor(t·(len−1)/100); ≤1 candidate stays put.
    expect(barlowPoolSize(0, 16)).toBe(1);
    expect(barlowPoolSize(15, 16)).toBe(3);
    expect(barlowPoolSize(100, 16)).toBe(16);
    expect(barlowPoolSize(99, 2)).toBe(1);
    expect(barlowPoolSize(50, 1)).toBe(1);
    expect(barlowPoolSize(50, 0)).toBe(0);
    // evolve.rs budget: div_ceil(leash × onsets, 100).
    expect(leashBudget(0, 9)).toBe(0);
    expect(leashBudget(53, 9)).toBe(5);
    expect(leashBudget(60, 5)).toBe(3);
    expect(leashBudget(100, 7)).toBe(7);
    expect(leashBudget(1, 1)).toBe(1);
  });

  it("derives the insight lanes from a compiled pattern", () => {
    const compiled = compileDumkaPattern("x . x@2");
    if (!compiled.ok) throw new Error("expected compile");
    const insight = gridInsight(compiled.compiled)!;
    expect(insight.slots).toBe(4);
    expect(insight.strata).toEqual([2, 2]);
    expect(insight.ranks).toEqual([3, 0, 2, 1]);
    expect(insight.onsetSlots).toEqual([0, 2]);
    // Slot 3 is covered by the two-beat note's sustain: not addable.
    expect(insight.occupied).toEqual([true, false, true, true]);
    expect(insight.addOrder).toEqual([1]);
    // Remove candidates run weakest-first: slot 2 (rank 2) before 0 (rank 3).
    expect(insight.removeOrder).toEqual([2, 0]);
  });

  it("counts figure candidates like the engine's interval scan", () => {
    const compiled = compileDumkaPattern("[x _ _ _ _ _ . .] [ka . ka .]");
    if (!compiled.ok) throw new Error("expected compile");
    expect(figureCandidateCounts(compiled.compiled)).toEqual({
      fragmentable: 6,
      consolidatable: 0,
      longestInterval: 6,
    });
    const contiguous = compileDumkaPattern("x x x .");
    if (!contiguous.ok) throw new Error("expected compile");
    // Three back-to-back one-slot notes form one consolidatable run; the
    // only silence is the single trailing slot, so nothing is fragmentable.
    expect(figureCandidateCounts(contiguous.compiled)).toEqual({
      fragmentable: 0,
      consolidatable: 1,
      longestInterval: 0,
    });
  });

  it("returns null insight beyond the published prime tables", () => {
    const compiled = compileDumkaPattern("[x x x x x x x x x x x]");
    if (!compiled.ok) throw new Error("expected compile");
    expect(compiled.compiled.requiredSubdivision).toBe(11);
    expect(gridInsight(compiled.compiled)).toBeNull();
  });
});
