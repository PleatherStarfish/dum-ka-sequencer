import { describe, expect, it } from "vitest";

import {
  autoTiers,
  compositeStrengths,
  fallbackRunProfile,
  manualTier,
  velocityDraw,
} from "./dumkaVelocity";
import { indispensability, stratification } from "./dumkaMetrics";

const runProfile = (k: number): readonly number[] => {
  const strata = stratification(k, 1);
  return strata ? indispensability(strata) : fallbackRunProfile(k);
};

describe("dumkaVelocity mirror", () => {
  it("pins the velocity draw against the Rust vectors", () => {
    // Mirrors velocity.rs `velocity_draws_are_slot_keyed_in_range_and_pinned`:
    // seed 20260818, cycle 3, range 100..=116, slots 0..4.
    const range = { min: 100, max: 116 };
    const pinned = [0, 1, 2, 3].map((slot) =>
      velocityDraw(20260818n, 3, slot, range)
    );
    expect(pinned).toEqual([110, 102, 112, 101]);
    // Degenerate range is a constant; draws replay identically.
    expect(velocityDraw(1n, 1, 0, { min: 96, max: 96 })).toBe(96);
    expect(velocityDraw(20260818n, 3, 2, range)).toBe(112);
  });

  it("mirrors composite strengths and tiers, pinned to the Rust vectors", () => {
    // Beat-aligned: reduces to the Barlow hierarchy.
    const alignedRanks = indispensability(stratification(4, 1)!);
    const aligned = autoTiers([0, 1, 2, 3], alignedRanks, 4, 1, 25, 35, runProfile);
    expect(aligned.filter((tier) => tier === "strong").length).toBe(1);
    expect(aligned[0]).toBe("strong");

    // The beat-spanning quintuplet ("[x x x x x]@2"): pinned against
    // velocity.rs `beat_spanning_quintuplet_gets_a_shifting_non_flat_profile`.
    const ranks = indispensability(stratification(2, 5)!);
    const onsets = [0, 2, 4, 6, 8];
    expect(compositeStrengths(onsets, ranks, 2, 5, runProfile)).toEqual([
      100_000, 55_332, 67_610, 39_277, 56_999,
    ]);
    expect(autoTiers(onsets, ranks, 2, 5, 25, 35, runProfile)).toEqual([
      "strong",
      "medium",
      "strong",
      "weak",
      "medium",
    ]);
  });

  it("mirrors manual tiers with refined slots weak", () => {
    const tiers = ["strong", "weak", "medium", "weak"] as const;
    expect(manualTier(tiers, 0, 3)).toBe("strong");
    expect(manualTier(tiers, 6, 3)).toBe("medium");
    expect(manualTier(tiers, 1, 3)).toBe("weak");
    expect(manualTier(tiers, 7, 3)).toBe("weak");
  });
});
