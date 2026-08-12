import { describe, expect, it } from "vitest";

import {
  DEFAULT_DIRECTIVE_OPTIONS,
  DEFAULT_DIRECTIVE_PACING,
  MAX_EVOLUTION_DIRECTIVES,
  addPin,
  duplicateDirective,
  moveDirective,
  normalizeEvolutionPlan,
  removeDirective,
  reorder,
  resizeRange,
  setIntensity,
  setOptions,
  setPacing,
  setScope,
  smoothDirectiveOverFourCycles,
  toggleEnabled,
  validateEvolutionPlan,
  type EvolutionDirective,
} from "./dumkaEvolvePlan";

function pin(
  id: number,
  family: EvolutionDirective["family"],
  cycle: number,
  order = id - 1
): EvolutionDirective {
  return {
    id,
    order,
    enabled: true,
    fromCycle: cycle,
    toCycle: cycle,
    family,
    intensity: 25,
    pacing: DEFAULT_DIRECTIVE_PACING,
    scope: null,
    options: { ...DEFAULT_DIRECTIVE_OPTIONS },
  };
}

function planOf(result: ReturnType<typeof addPin>): EvolutionDirective[] {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

describe("dumka evolution plan model", () => {
  it("normalizes ids, orders, cycles, quota, scope, and options", () => {
    const row = pin(4, "euclid", 3, 9);
    const normalized = normalizeEvolutionPlan([
      {
        ...row,
        id: 0,
        fromCycle: -7,
        toCycle: -3,
        intensity: 190,
        scope: { startBeat: -2, lenBeats: 0 },
        options: {
          ...row.options,
          barlowTemperature: -2,
          fillComplexity: 130,
          euclidMaxRun: 99,
          euclidInvert: 105,
          euclidRestPolicy: "silent",
          rotateDirection: "later",
        },
      },
      { ...pin(1, "fragment", 8, 3), id: 1 },
    ]);

    expect(normalized.map(({ id, order }) => ({ id, order }))).toEqual([
      { id: 1, order: 0 },
      { id: 2, order: 1 },
    ]);
    expect(normalized[1]).toMatchObject({
      fromCycle: 1,
      toCycle: 1,
      intensity: 100,
      pacing: "perCycle",
      scope: { startBeat: 0, lenBeats: 1 },
      options: {
        barlowTemperature: 0,
        fillComplexity: 100,
        euclidMaxRun: 8,
        euclidInvert: 100,
        euclidRestPolicy: "silent",
        rotateDirection: "later",
      },
    });
  });

  it("allocates max id + 1 and cycle 0 never becomes editable", () => {
    const result = addPin([pin(7, "rotate", 4)], "fragment", 0);
    expect(planOf(result)[1]).toMatchObject({
      id: 8,
      order: 1,
      fromCycle: 1,
      toCycle: 1,
      intensity: 25,
      enabled: true,
    });
  });

  it("repairs duplicate maximum-safe ids without leaving the safe range", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const normalized = normalizeEvolutionPlan([
      pin(max, "fragment", 2, 0),
      pin(max, "euclid", 3, 1),
    ]);
    expect(normalized.map((row) => row.id)).toEqual([max, 1]);
  });

  it("rejects same-family overlap while permitting layered families", () => {
    const base = [{ ...pin(1, "fragment", 5), toCycle: 8 }];
    const overlap = addPin(base, "fragment", 7);
    expect(overlap).toEqual({
      ok: false,
      message: "dumka plan overlap: fragment directives 1 and 2 share cycle 7",
    });
    expect(addPin(base, "euclid", 7).ok).toBe(true);
  });

  it("moves and resizes while retaining duration and rejecting collisions", () => {
    const base = [
      { ...pin(1, "rotate", 2), toCycle: 4 },
      pin(2, "rotate", 8),
    ];
    expect(planOf(moveDirective(base, 1, 5))[0]).toMatchObject({
      fromCycle: 5,
      toCycle: 7,
    });
    expect(moveDirective(base, 1, 6).ok).toBe(false);
    expect(planOf(resizeRange(base, 1, 3, 6))[0]).toMatchObject({
      fromCycle: 3,
      toCycle: 6,
    });
    expect(resizeRange(base, 1, 3, 8).ok).toBe(false);
  });

  it("updates intensity, scope, options, enabled state, order, and removal", () => {
    const base = [pin(10, "fragment", 4), pin(20, "euclid", 6)];
    const intensity = planOf(setIntensity(base, 10, 111));
    expect(intensity[0]!.intensity).toBe(100);

    const scoped = planOf(setScope(intensity, 10, { startBeat: -3, lenBeats: 0 }));
    expect(scoped[0]!.scope).toEqual({ startBeat: 0, lenBeats: 1 });

    const options = planOf(
      setOptions(scoped, 10, { fillComplexity: 72, rotateDirection: "later" })
    );
    expect(options[0]!.options).toMatchObject({
      fillComplexity: 72,
      rotateDirection: "later",
    });

    const toggled = planOf(toggleEnabled(options, 10));
    expect(toggled[0]!.enabled).toBe(false);

    const reordered = planOf(reorder(toggled, 20, 0));
    expect(reordered.map(({ id, order }) => ({ id, order }))).toEqual([
      { id: 20, order: 0 },
      { id: 10, order: 1 },
    ]);

    const removed = planOf(removeDirective(reordered, 20));
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ id: 10, order: 0 });
  });

  it("duplicates to a requested cycle without coupling mutable children", () => {
    const source = {
      ...pin(1, "fragment", 3),
      toCycle: 5,
      scope: { startBeat: 2, lenBeats: 2 },
    };
    const result = duplicateDirective([source], 1, 8);
    const plan = planOf(result);
    expect(plan[1]).toMatchObject({
      id: 2,
      fromCycle: 8,
      toCycle: 10,
      scope: { startBeat: 2, lenBeats: 2 },
    });
    expect(plan[1]!.scope).not.toBe(plan[0]!.scope);
    expect(plan[1]!.options).not.toBe(plan[0]!.options);
  });

  it("normalizes transition pacing and forces Stochastic to repeat per cycle", () => {
    const normalized = normalizeEvolutionPlan([
      { ...pin(1, "fragment", 2), pacing: "easeInOut", toCycle: 5 },
      { ...pin(2, "stochastic", 6), pacing: "linear", toCycle: 9 },
    ]);
    expect(normalized.map((row) => row.pacing)).toEqual([
      "easeInOut",
      "perCycle",
    ]);
    expect(planOf(setPacing(normalized, 1, "linear"))[0]!.pacing).toBe(
      "linear"
    );
    expect(planOf(setPacing(normalized, 2, "easeInOut"))[1]!.pacing).toBe(
      "perCycle"
    );
  });

  it("smooths a deterministic pin across four cycles atomically", () => {
    const base = [pin(1, "fragment", 5), pin(2, "fragment", 10)];
    expect(planOf(smoothDirectiveOverFourCycles(base, 1))[0]).toMatchObject({
      fromCycle: 5,
      toCycle: 8,
      pacing: "easeInOut",
    });

    const colliding = [pin(1, "fragment", 5), pin(2, "fragment", 8)];
    expect(smoothDirectiveOverFourCycles(colliding, 1)).toEqual({
      ok: false,
      message: "dumka plan overlap: fragment directives 1 and 2 share cycle 8",
    });
    expect(colliding[0]).toMatchObject({
      fromCycle: 5,
      toCycle: 5,
      pacing: "perCycle",
    });
  });

  it("does not offer smoothing semantics to Stochastic directives", () => {
    expect(smoothDirectiveOverFourCycles([pin(1, "stochastic", 4)], 1)).toEqual({
      ok: false,
      message:
        "Stochastic directives use a per-cycle probability and cannot be smoothed",
    });
  });

  it("mirrors the engine's 256-directive cap for validation and creation", () => {
    const full = Array.from(
      { length: MAX_EVOLUTION_DIRECTIVES },
      (_, index) => pin(index + 1, "fragment", index + 1, index)
    );
    expect(validateEvolutionPlan(full).ok).toBe(true);
    expect(addPin(full, "euclid", 300)).toEqual({
      ok: false,
      message:
        "dumka plan invalid: plan supports at most 256 directives, got 257",
    });
    expect(duplicateDirective(full, 1, 300)).toEqual({
      ok: false,
      message:
        "dumka plan invalid: plan supports at most 256 directives, got 257",
    });
    expect(
      validateEvolutionPlan([...full, pin(257, "euclid", 257, 256)])
    ).toEqual({
      ok: false,
      message:
        "dumka plan invalid: plan supports at most 256 directives, got 257",
    });
  });
});
