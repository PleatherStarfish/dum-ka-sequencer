import { describe, expect, it } from "vitest";

import {
  validateEvolutionCurve,
  upsertCurvePoint,
  setCurveSettings,
  removeCurvePoint,
  normalizeEvolutionCurve,
  curveTargetMilliAt,
  curveScoringWork,
  validatePropertyCurves,
  validatePropertyCurveConfiguration,
  propertySteeringWork,
  propertyPacingScoringWork,
  propertyCurveTargetMilliAt,
  propertyCurveBandAt,
  upsertPropertyCurvePoint,
  removePropertyCurvePoint,
  setPropertyCurveSettings,
  DEFAULT_PROPERTY_CURVE_TOLERANCE,
  normalizePropertyCurves,
  DEFAULT_EVOLUTION_CURVE,
  DEFAULT_DIRECTIVE_OPTIONS,
  DEFAULT_DIRECTIVE_PACING,
  DEFAULT_PERCEPTUAL_MAGNITUDE,
  MAX_EVOLUTION_DIRECTIVES,
  MAX_PERCEPTUAL_DISTANCE_MILLI,
  MAX_PERCEPTUAL_OPERATIONS,
  MAX_PERCEPTUAL_SCORING_WORK,
  addPin,
  duplicateDirective,
  moveDirective,
  normalizeEvolutionPlan,
  perceptualDirectiveScoringWork,
  perceptualScoringWork,
  removeDirective,
  reorder,
  resizeRange,
  setDensityCorridor,
  setComplexityCorridor,
  setIntensity,
  setMagnitude,
  setOptions,
  setPacing,
  setScope,
  smoothDirectiveOverFourCycles,
  toggleEnabled,
  validateEvolutionPlan,
  normalizeSubdivisionPalette,
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
  it("normalizes depth controls without changing perceptual pacing", () => {
    expect(normalizeSubdivisionPalette([7, 3, 3, 2, 11])).toEqual([2, 3]);
    const row = pin(1, "barlowAdd", 4);
    const normalized = normalizeEvolutionPlan([
      {
        ...row,
        magnitude: { ...DEFAULT_PERCEPTUAL_MAGNITUDE },
        options: {
          ...row.options,
          complexityFloor: 70_000,
          complexityCeiling: 20_000,
          placementBias: 77,
          subdivisionLevel: 3,
        },
      },
    ])[0]!;
    expect(normalized.pacing).toBe("perCycle");
    expect(normalized.magnitude).toEqual(DEFAULT_PERCEPTUAL_MAGNITUDE);
    expect(normalized.options).toMatchObject({
      complexityFloor: 20_000,
      complexityCeiling: 70_000,
      placementBias: 77,
      subdivisionLevel: 3,
    });
    // subdivisionLevel names a palette prime: valid iff enabled in the palette.
    expect(validateEvolutionPlan([normalized], [2, 3]).ok).toBe(true);
    expect(
      validateEvolutionPlan(
        [
          {
            ...normalized,
            enabled: false,
            options: { ...normalized.options, subdivisionLevel: 5 },
          },
        ],
        [2, 3]
      )
    ).toEqual({
      ok: false,
      message:
        "dumka plan invalid: directive 1 subdivisionLevel 5 is not an enabled palette prime",
    });
  });

  it("authors paired complexity rails and a directed Morph target", () => {
    const added = planOf(addPin([], "morph", 5, "x x x x"));
    expect(added[0]).toMatchObject({
      family: "morph",
      options: { morphTarget: "x x x x" },
    });
    const ranged = planOf(resizeRange(added, added[0]!.id, 5, 20));
    const paced = planOf(setPacing(ranged, added[0]!.id, "easeInOut"));
    expect(paced[0]!.pacing).toBe("easeInOut");
    const corridor = planOf(
      setComplexityCorridor(paced, added[0]!.id, {
        floor: 12_000,
        ceiling: 44_000,
      })
    );
    expect(corridor[0]!.options).toMatchObject({
      complexityFloor: 12_000,
      complexityCeiling: 44_000,
    });
    expect(
      validateEvolutionPlan([
        {
          ...corridor[0]!,
          options: { ...corridor[0]!.options, morphTarget: null },
        },
      ])
    ).toEqual({
      ok: false,
      message: `dumka plan invalid: directive ${added[0]!.id} morph requires options.morphTarget`,
    });
    expect(
      validateEvolutionPlan([
        {
          ...corridor[0]!,
          options: { ...corridor[0]!.options, morphTarget: ". . . ." },
        },
      ])
    ).toEqual({
      ok: false,
      message: `dumka plan invalid: directive ${added[0]!.id} morph target must contain at least one sounding onset`,
    });
  });

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
          densityFloor: 75,
          densityCeiling: 35,
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
        densityFloor: 35,
        densityCeiling: 75,
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

    const corridor = planOf(
      setDensityCorridor(options, 10, { floor: 72, ceiling: 24 })
    );
    expect(corridor[0]!.options).toMatchObject({
      densityFloor: 24,
      densityCeiling: 72,
    });
    const inheritedCorridor = planOf(setDensityCorridor(corridor, 10, null));
    expect(inheritedCorridor[0]!.options).toMatchObject({
      densityFloor: null,
      densityCeiling: null,
    });

    const toggled = planOf(toggleEnabled(inheritedCorridor, 10));
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

  it("keeps operation quota absent and safely normalizes perceptual magnitude", () => {
    const normalized = normalizeEvolutionPlan([
      pin(1, "fragment", 2),
      {
        ...pin(2, "rotate", 3),
        pacing: "linear",
        magnitude: { mode: "operationQuota" },
      },
      {
        ...pin(3, "euclid", 4),
        pacing: "easeInOut",
        magnitude: {
          mode: "perceptual",
          modelVersion: "v1",
          targetMilli: MAX_PERCEPTUAL_DISTANCE_MILLI + 1,
          toleranceMilli: -1,
          maxOperations: MAX_PERCEPTUAL_OPERATIONS + 1,
        },
      },
      {
        ...pin(4, "stochastic", 5),
        magnitude: { ...DEFAULT_PERCEPTUAL_MAGNITUDE },
      },
    ]);

    expect(normalized[0]).not.toHaveProperty("magnitude");
    expect(normalized[1]).not.toHaveProperty("magnitude");
    expect(normalized[1]!.pacing).toBe("linear");
    expect(normalized[2]).toMatchObject({
      pacing: "perCycle",
      magnitude: {
        mode: "perceptual",
        modelVersion: "v1",
        targetMilli: 100_000,
        toleranceMilli: 0,
        maxOperations: 256,
      },
    });
    expect(normalized[3]).not.toHaveProperty("magnitude");
  });

  it("switches magnitude modes without repurposing the stored intensity", () => {
    const base = [{ ...pin(1, "fragment", 5), pacing: "easeInOut" as const }];
    const perceptual = planOf(
      setMagnitude(base, 1, { ...DEFAULT_PERCEPTUAL_MAGNITUDE })
    );
    expect(perceptual[0]).toMatchObject({
      intensity: 25,
      pacing: "perCycle",
      magnitude: DEFAULT_PERCEPTUAL_MAGNITUDE,
    });
    expect(planOf(setPacing(perceptual, 1, "linear"))[0]!.pacing).toBe(
      "perCycle"
    );

    const quota = planOf(setMagnitude(perceptual, 1, undefined));
    expect(quota[0]).not.toHaveProperty("magnitude");
    expect(quota[0]!.intensity).toBe(25);
    expect(
      planOf(
        setMagnitude(
          [pin(2, "stochastic", 6)],
          2,
          { ...DEFAULT_PERCEPTUAL_MAGNITUDE }
        )
      )[0]
    ).not.toHaveProperty("magnitude");
  });

  it("mirrors the engine's inclusive lifetime perceptual scoring budget", () => {
    const left = {
      ...pin(1, "fragment", 1),
      toCycle: 240,
      magnitude: { ...DEFAULT_PERCEPTUAL_MAGNITUDE },
    };
    const right = {
      ...pin(2, "rotate", 241),
      magnitude: { ...DEFAULT_PERCEPTUAL_MAGNITUDE },
    };

    expect(perceptualDirectiveScoringWork(left)).toBe(4_080n);
    expect(perceptualScoringWork([left])).toBe(4_080n);
    expect(validateEvolutionPlan([left]).ok).toBe(true);
    expect(validateEvolutionPlan([left, right])).toEqual({
      ok: false,
      message:
        "dumka perceptual plan reserves 4097 scoring operations, exceeding the limit of 4096",
    });
    expect(MAX_PERCEPTUAL_SCORING_WORK).toBe(4_096);

    expect(
      perceptualScoringWork([
        {
          ...right,
          enabled: false,
          fromCycle: 1,
          toCycle: Number.MAX_SAFE_INTEGER,
          magnitude: {
            ...DEFAULT_PERCEPTUAL_MAGNITUDE,
            maxOperations: MAX_PERCEPTUAL_OPERATIONS,
          },
        },
      ])
    ).toBe(0n);
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

  it("does not apply transition pacing to perceptual directives", () => {
    const row = {
      ...pin(1, "fragment", 4),
      magnitude: { ...DEFAULT_PERCEPTUAL_MAGNITUDE },
    };
    expect(smoothDirectiveOverFourCycles([row], 1)).toEqual({
      ok: false,
      message:
        "Perceptual directives target each active cycle and cannot use transition pacing",
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

describe("evolution curve model", () => {
  const curve = (points: Array<[number, number]>, overrides = {}) => ({
    ...DEFAULT_EVOLUTION_CURVE,
    enabled: true,
    points: points.map(([cycle, targetMilli]) => ({ cycle, targetMilli })),
    ...overrides,
  });

  it("interpolates exactly like the engine (pinned vectors)", () => {
    const ramp = curve([
      [10, 1000],
      [20, 4000],
      [30, 0],
    ]);
    expect(curveTargetMilliAt(ramp, 9)).toBe(0);
    expect(curveTargetMilliAt(ramp, 10)).toBe(1000);
    expect(curveTargetMilliAt(ramp, 11)).toBe(1300);
    expect(curveTargetMilliAt(ramp, 15)).toBe(2500);
    expect(curveTargetMilliAt(ramp, 20)).toBe(4000);
    expect(curveTargetMilliAt(ramp, 25)).toBe(2000);
    expect(curveTargetMilliAt(ramp, 31)).toBe(0);
    // Round-half-away-from-zero, matching plan.rs.
    expect(curveTargetMilliAt(curve([[1, 0], [3, 3]]), 2)).toBe(2);
    expect(
      curveTargetMilliAt({ ...ramp, enabled: false }, 15)
    ).toBe(0);
  });

  it("shares the perceptual scoring budget with the plan", () => {
    const hot = curve([[1, 1000], [512, 1000]], { maxOperations: 8 });
    expect(curveScoringWork(hot)).toBe(4608n);
    const rejected = setCurveSettings([], hot, { maxOperations: 8 });
    expect(rejected).toEqual({
      ok: false,
      message:
        "dumka perceptual plan reserves 4608 scoring operations, exceeding the limit of 4096",
    });
    const fits = setCurveSettings([], hot, { maxOperations: 4 });
    expect(fits.ok).toBe(true);
  });

  it("validates with the engine's pinned messages", () => {
    // Enabled-but-empty is legal: the curve is inert until a point lands.
    expect(validateEvolutionCurve(curve([], {}))).toBeNull();
    expect(
      validateEvolutionCurve(curve([[4, 1], [4, 2]]))
    ).toBe("dumka plan invalid: curve points must have strictly ascending cycles");
    expect(
      validateEvolutionCurve(curve([[1, 1]], { maxOperations: 9 }))
    ).toBe("dumka plan invalid: curve maxOperations must be 1-8, got 9");
    expect(
      validateEvolutionCurve(curve([[1, 1], [600, 1]]))
    ).toBe(
      "dumka plan invalid: curve spans 599 cycles between its first and last points, the maximum is 511"
    );
  });

  it("upserts sorted points and removes them", () => {
    const base = curve([[5, 2000]]);
    const added = upsertCurvePoint([], base, 2, 1000);
    expect(added.ok && added.curve.points).toEqual([
      { cycle: 2, targetMilli: 1000 },
      { cycle: 5, targetMilli: 2000 },
    ]);
    const replaced = upsertCurvePoint([], base, 5, 900);
    expect(replaced.ok && replaced.curve.points).toEqual([
      { cycle: 5, targetMilli: 900 },
    ]);
    const removed = removeCurvePoint([], base, 5);
    if (!removed.ok) throw new Error(removed.message);
    expect(removed.curve.points).toEqual([]);
    // Enabled-but-empty survives the last removal; the curve is inert.
    expect(removed.curve.enabled).toBe(true);
  });

  it("normalizes persisted curves fail-closed", () => {
    const { curve: repaired, droppedPoints } = normalizeEvolutionCurve({
      enabled: true,
      modelVersion: "v9",
      toleranceMilli: 999_999,
      maxOperations: 99,
      points: [
        { cycle: 3, targetMilli: 4000 },
        { cycle: 3, targetMilli: 5000 },
        { cycle: 0, targetMilli: 1 },
        { cycle: 2.5, targetMilli: 1 },
        { cycle: 9, targetMilli: 200_000 },
        "junk",
      ],
    });
    expect(repaired.points).toEqual([{ cycle: 3, targetMilli: 4000 }]);
    expect(droppedPoints).toBe(5);
    expect(repaired.modelVersion).toBe("v1");
    expect(repaired.toleranceMilli).toBe(100_000);
    expect(repaired.maxOperations).toBe(8);
    expect(repaired.enabled).toBe(true);
    const emptied = normalizeEvolutionCurve({ enabled: true, points: [] });
    expect(emptied.curve.enabled).toBe(true);
  });

  it("mirrors plan.rs PropertyCurve interpolation and absence", () => {
    const curve = {
      property: "density" as const,
      enabled: true,
      toleranceMilli: 1_000,
      weight: 50,
      points: [
        { cycle: 2, targetMilli: 20_000 },
        { cycle: 6, targetMilli: 80_000 },
      ],
    };
    // Absent — not zero — outside the drawn span.
    expect(propertyCurveTargetMilliAt(curve, 1)).toBeNull();
    expect(propertyCurveBandAt(curve, 1)).toBeNull();
    expect(propertyCurveTargetMilliAt(curve, 7)).toBeNull();
    expect(propertyCurveTargetMilliAt(curve, 2)).toBe(20_000);
    expect(propertyCurveTargetMilliAt(curve, 4)).toBe(50_000);
    expect(propertyCurveBandAt(curve, 2)).toEqual([19_000, 21_000]);
    expect(
      propertyCurveBandAt({ ...curve, toleranceMilli: 100_000 }, 2)
    ).toEqual([0, 100_000]);
  });

  it("draws, moves, and clears points on a per-property curve", () => {
    // Drawing the first point creates an enabled curve with default rails.
    const created = upsertPropertyCurvePoint([], "syncopation", 3, 40_000);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      property: "syncopation",
      enabled: true,
      toleranceMilli: DEFAULT_PROPERTY_CURVE_TOLERANCE,
      weight: 50,
      points: [{ cycle: 3, targetMilli: 40_000 }],
    });
    // A second point sorts in; re-drawing a cycle replaces (moves) it.
    const two = upsertPropertyCurvePoint(created, "syncopation", 1, 10_000);
    expect(two[0]!.points).toEqual([
      { cycle: 1, targetMilli: 10_000 },
      { cycle: 3, targetMilli: 40_000 },
    ]);
    const moved = upsertPropertyCurvePoint(two, "syncopation", 3, 90_000);
    expect(moved[0]!.points).toEqual([
      { cycle: 1, targetMilli: 10_000 },
      { cycle: 3, targetMilli: 90_000 },
    ]);
    // A second property lands in fixed lane order (density before syncopation).
    const withDensity = upsertPropertyCurvePoint(moved, "density", 2, 60_000);
    expect(withDensity.map((curve) => curve.property)).toEqual([
      "density",
      "syncopation",
    ]);
    // Settings edit an existing lane; removing the last point drops the curve.
    const weighted = setPropertyCurveSettings(withDensity, "density", {
      weight: 80,
      toleranceMilli: 12_000,
    });
    expect(weighted.find((c) => c.property === "density")).toMatchObject({
      weight: 80,
      toleranceMilli: 12_000,
    });
    const dropped = removePropertyCurvePoint(weighted, "density", 2);
    expect(dropped.map((curve) => curve.property)).toEqual(["syncopation"]);
    // Setting on an absent property pre-creates a disabled placeholder lane.
    const placeholder = setPropertyCurveSettings([], "evenness", {
      enabled: true,
    });
    expect(placeholder[0]).toMatchObject({
      property: "evenness",
      enabled: true,
      points: [],
    });
  });

  it("coalesces a 65th point and clamps a 513-cycle endpoint before committing", () => {
    const full = [
      {
        property: "occupancy" as const,
        enabled: true,
        toleranceMilli: 5_000,
        weight: 50,
        points: Array.from({ length: 64 }, (_, index) => ({
          cycle: index + 1,
          targetMilli: 20_000,
        })),
      },
    ];
    const coalesced = upsertPropertyCurvePoint(full, "occupancy", 100, 90_000);
    expect(coalesced[0]!.points).toHaveLength(64);
    expect(coalesced[0]!.points.at(-1)).toEqual({
      cycle: 64,
      targetMilli: 90_000,
    });

    const clamped = upsertPropertyCurvePoint(
      [
        {
          ...full[0]!,
          points: [{ cycle: 1, targetMilli: 20_000 }],
        },
      ],
      "occupancy",
      1_000,
      80_000
    );
    expect(clamped[0]!.points.at(-1)!.cycle).toBe(512);
  });

  it("pins property-only and shared pacing work budgets", () => {
    const propertyCurve = (
      property: "syncopation" | "occupancy",
      first: number,
      last: number
    ) => ({
      property,
      enabled: true,
      toleranceMilli: 1_000,
      weight: 50,
      points: [
        { cycle: first, targetMilli: 50_000 },
        { cycle: last, targetMilli: 50_000 },
      ],
    });
    const oneSpan = [propertyCurve("syncopation", 1, 512)];
    expect(propertySteeringWork(oneSpan, 8)).toBe(32_768n);
    const disjoint = [
      ...oneSpan,
      propertyCurve("occupancy", 513, 1_024),
    ];
    expect(
      validatePropertyCurveConfiguration(
        disjoint,
        0,
        100,
        0,
        100_000,
        [],
        { ...DEFAULT_EVOLUTION_CURVE, maxOperations: 8 }
      )
    ).toBe(
      "dumka plan invalid: propertyCurve steering needs 65536 functional evaluations across 1024 cycles, the maximum is 32768"
    );

    const pacing = {
      ...DEFAULT_EVOLUTION_CURVE,
      enabled: true,
      maxOperations: 8,
      points: [
        { cycle: 1, targetMilli: 0 },
        { cycle: 64, targetMilli: 0 },
      ],
    };
    const shared = [propertyCurve("syncopation", 1, 64)];
    expect(propertyPacingScoringWork([], pacing, shared)).toBe(4_160n);
    expect(
      validatePropertyCurveConfiguration(
        shared,
        0,
        100,
        0,
        100_000,
        [],
        pacing
      )
    ).toBe(
      "dumka perceptual plan reserves 4160 scoring operations, exceeding the limit of 4096"
    );
    const within = {
      ...pacing,
      points: [
        { cycle: 1, targetMilli: 0 },
        { cycle: 63, targetMilli: 0 },
      ],
    };
    expect(
      propertyPacingScoringWork(
        [],
        within,
        [propertyCurve("syncopation", 1, 63)]
      )
    ).toBe(4_095n);
  });

  it("mirrors plan.rs validate_property_curves messages byte-for-byte", () => {
    const density = (points: { cycle: number; targetMilli: number }[]) => ({
      property: "density" as const,
      enabled: true,
      toleranceMilli: 5_000,
      weight: 50,
      points,
    });
    const ok = [density([{ cycle: 1, targetMilli: 50_000 }])];
    expect(validatePropertyCurves(ok, 0, 100, 0, 100_000)).toBeNull();

    expect(validatePropertyCurves([...ok, ...ok], 0, 100, 0, 100_000)).toBe(
      "dumka plan invalid: propertyCurve supports at most one curve per property, got a second density"
    );
    expect(
      validatePropertyCurves(
        [{ ...density([{ cycle: 1, targetMilli: 1 }]), weight: 0 }],
        0,
        100,
        0,
        100_000
      )
    ).toBe("dumka plan invalid: propertyCurve density weight must be 1-100, got 0");
    expect(
      validatePropertyCurves(
        [
          density([
            { cycle: 3, targetMilli: 1 },
            { cycle: 3, targetMilli: 2 },
          ]),
        ],
        0,
        100,
        0,
        100_000
      )
    ).toBe(
      "dumka plan invalid: propertyCurve density points must have strictly ascending cycles"
    );
    // Static intersection: 90% ± 1% band cannot fit a 0-50% corridor.
    expect(
      validatePropertyCurves(
        [{ ...density([{ cycle: 5, targetMilli: 90_000 }]), toleranceMilli: 1_000 }],
        0,
        50,
        0,
        100_000
      )
    ).toBe(
      "dumka plan invalid: propertyCurve density conflicts with the density corridor at cycle 5"
    );
    // A steered-only property never triggers the intersection check.
    expect(
      validatePropertyCurves(
        [
          {
            property: "syncopation" as const,
            enabled: true,
            toleranceMilli: 1_000,
            weight: 50,
            points: [{ cycle: 5, targetMilli: 90_000 }],
          },
        ],
        0,
        50,
        0,
        100_000
      )
    ).toBeNull();
  });

  it("tolerantly normalizes a property-curve array", () => {
    const { curves, droppedCurves, droppedPoints } = normalizePropertyCurves([
      {
        property: "density",
        enabled: true,
        toleranceMilli: 5_000,
        weight: 50,
        points: [
          { cycle: 2, targetMilli: 40_000 },
          { cycle: 1, targetMilli: 20_000 },
          { cycle: 1, targetMilli: 99_000 }, // duplicate cycle → dropped
        ],
      },
      { property: "density", enabled: true, weight: 50, points: [] }, // second density → dropped
      { property: "bogus", enabled: true, points: [] }, // unknown property → dropped
    ]);
    expect(curves).toHaveLength(1);
    expect(curves[0]!.points.map((point) => point.cycle)).toEqual([1, 2]);
    expect(droppedPoints).toBe(1);
    expect(droppedCurves).toBe(2);
  });
});
