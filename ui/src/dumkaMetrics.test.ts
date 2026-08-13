import { describe, expect, it } from "vitest";
import metricsContract from "./__fixtures__/dumka_metrics_contract.json";

import { compileDumkaPattern } from "./dumkaPattern";
import {
  barlowPoolSize,
  beatLevel,
  blendedPlacementOrder,
  dumkaSubdivisionLevelExists,
  dumkaSubdivisionLevels,
  factorDescending,
  figureCandidateCounts,
  fixedPointSpectrumTable,
  geometricAddOrder,
  geometricRemoveOrder,
  gridInsight,
  indispensability,
  leashBudget,
  metricalLevels,
  normalizedPlacementRanks,
  stateComplexityMilli,
  stateDepthDiversityMilli,
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

interface SpectrumContract {
  q16One: number;
  maxHarmonics: number;
  greedyW8K4Fingerprint: number[];
  tables: Array<{
    period: number;
    harmonics: Array<{
      harmonic: number;
      cosinePrefix: number[];
      sinePrefix: number[];
    }>;
  }>;
  cases: Array<{
    period: number;
    onsets: number[];
    addCandidates: number[];
    geometricAddOrder: number[];
    geometricRemoveOrder: number[];
    normalizedAddRanks: Array<[number, number]>;
    blend0: number[];
    blend50: number[];
    blend100: number[];
  }>;
}

interface MetricsContract {
  metricalCases: ContractCase[];
  spectrum: SpectrumContract;
}

describe("dumkaMetrics", () => {
  it("indexes working-grid denominator levels by Barlow price, not palette prime", () => {
    expect(dumkaSubdivisionLevels(12)).toEqual([
      { index: 0, denominator: 1, indigestibility: 0 },
      { index: 1, denominator: 2, indigestibility: 210 },
      { index: 2, denominator: 4, indigestibility: 420 },
      { index: 3, denominator: 3, indigestibility: 560 },
      { index: 4, denominator: 6, indigestibility: 770 },
      { index: 5, denominator: 12, indigestibility: 980 },
    ]);
    expect(dumkaSubdivisionLevels(11)).toEqual([
      { index: 0, denominator: 1, indigestibility: 0 },
      { index: 1, denominator: 11, indigestibility: 3818 },
    ]);
    expect(dumkaSubdivisionLevelExists(5, 12)).toBe(true);
    expect(dumkaSubdivisionLevelExists(6, 12)).toBe(false);
    expect(dumkaSubdivisionLevelExists(0, 1)).toBe(true);
  });

  it("matches the Rust metrics contract fixture on every grid", () => {
    const cases = (metricsContract as MetricsContract).metricalCases;
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

  it("matches the Rust fixed-point geometric placement contract", () => {
    const contract = (metricsContract as MetricsContract).spectrum;
    expect(contract.q16One).toBe(65_536);
    expect(contract.maxHarmonics).toBe(16);
    const tables = new Map(
      contract.tables.map((entry) => {
        const rootRow = entry.harmonics.find((row) => row.harmonic === 1)!;
        const table = fixedPointSpectrumTable(entry.period, [
          rootRow.cosinePrefix[1]!,
          rootRow.sinePrefix[1]!,
        ]);
        for (const expected of entry.harmonics) {
          const actual = table.find((row) => row.harmonic === expected.harmonic)!;
          expect(actual.cosine.slice(0, 5)).toEqual(expected.cosinePrefix);
          expect(actual.sine.slice(0, 5)).toEqual(expected.sinePrefix);
        }
        return [entry.period, table] as const;
      })
    );

    for (const entry of contract.cases) {
      const table = tables.get(entry.period)!;
      const add = geometricAddOrder(
        entry.period,
        entry.onsets,
        entry.addCandidates,
        table
      );
      expect(add).toEqual(entry.geometricAddOrder);
      expect(
        geometricRemoveOrder(entry.period, entry.onsets, entry.onsets, table)
      ).toEqual(entry.geometricRemoveOrder);
      expect(normalizedPlacementRanks(add)).toEqual(entry.normalizedAddRanks);
      const metric = [...entry.addCandidates].sort((left, right) => left - right);
      expect(blendedPlacementOrder(metric, add, 0)).toEqual(entry.blend0);
      expect(blendedPlacementOrder(metric, add, 50)).toEqual(entry.blend50);
      expect(blendedPlacementOrder(metric, add, 100)).toEqual(entry.blend100);
    }

    const table = tables.get(8)!;
    const greedy: number[] = [];
    while (greedy.length < 4) {
      const candidates = Array.from({ length: 8 }, (_, slot) => slot).filter(
        (slot) => !greedy.includes(slot)
      );
      greedy.push(geometricAddOrder(8, greedy, candidates, table)[0]!);
    }
    expect(greedy).toEqual(contract.greedyW8K4Fingerprint);
    expect(greedy).toEqual([0, 4, 1, 6]);
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

  it("mirrors the fixed-point depth complexity and diversity insights", () => {
    expect(stateComplexityMilli([0, 0, 0], 4)).toBe(0);
    expect(stateComplexityMilli([0, 6, 4, 3, 2, 1], 12)).toBe(50_000);
    expect(stateDepthDiversityMilli([], 12)).toBe(0);
    expect(stateDepthDiversityMilli([4, 16, 28], 12)).toBe(0);
    expect(stateDepthDiversityMilli([0, 12, 6, 4], 12)).toBe(75_000);
    expect(stateDepthDiversityMilli([0, 6, 4, 3, 2, 1], 12)).toBe(100_000);
    expect(stateDepthDiversityMilli([12, 18, 16, 15, 14, 13], 12)).toBe(
      100_000
    );
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
