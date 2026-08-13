import { expect, test } from "@playwright/test";

import { openCaesura } from "./support/appHarness";

const PATTERN = "[dum . . ka] [. . ka .] [dum . ka .] [x x . x]";

test("mock fails closed for enabled plans but preserves cycle zero and disabled plans", async ({
  page,
}) => {
  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });

  const result = await page.evaluate(async ({ pattern }) => {
    const driver = window.__CAESURA_E2E_DRIVER__;
    if (!driver) throw new Error("missing e2e driver");
    const spans = [1, 2, 3, 4].map((spanId) => ({
      spanId,
      spanLen: 4,
      label: null,
      sectionIndex: 1,
      subdivision: 4,
    }));
    const directive = {
      id: 41,
      order: 0,
      enabled: true,
      fromCycle: 13,
      toCycle: 13,
      family: "barlowRemove",
      intensity: 15,
      scope: null,
      options: { rotateDirection: "earlier" },
    };
    const request = (cycle: number, plan: unknown[]) => ({
      spans,
      enabled: true,
      generator: {
        kind: "dumka",
        pattern,
        evolutionRate: 0,
        plan,
        planLengthCycles: 20,
        seedMode: { type: "locked", seed: 7 },
      },
      cycle,
      cycleBeats: 4,
      automation: null,
      trackId: null,
    });
    const invoke = (cycle: number, plan: unknown[]) =>
      driver.invoke("generator_preview", { request: request(cycle, plan) });

    const staticCycleZero = (await invoke(0, [])) as Record<string, unknown>;
    const plannedCycleZero = (await invoke(0, [directive])) as Record<string, unknown>;
    const staticCycleOne = (await invoke(1, [])) as Record<string, unknown>;
    const disabledCycleOne = (await invoke(1, [
      { ...directive, enabled: false },
    ])) as Record<string, unknown>;
    let enabledPlanError: string | null = null;
    try {
      await invoke(1, [directive]);
    } catch (error) {
      enabledPlanError = error instanceof Error ? error.message : String(error);
    }
    return {
      staticCycleZero,
      plannedCycleZero,
      staticCycleOne,
      disabledCycleOne,
      enabledPlanError,
    };
  }, { pattern: PATTERN });

  expect(result.plannedCycleZero).toEqual(result.staticCycleZero);
  expect(result.disabledCycleOne).toEqual(result.staticCycleOne);
  expect(result.staticCycleZero.trace).toEqual([]);
  expect(result.enabledPlanError).toBe(
    "mock dumka preview cannot resolve evolving cycle 1; use the real-backend lane"
  );
});

test("mock validates depth and Morph plan fields before any folded cycle", async ({
  page,
}) => {
  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });

  const errors = await page.evaluate(async ({ pattern }) => {
    const driver = window.__CAESURA_E2E_DRIVER__;
    if (!driver) throw new Error("missing e2e driver");
    const spans = [1, 2, 3, 4].map((spanId) => ({
      spanId,
      spanLen: 4,
      label: null,
      sectionIndex: 1,
      subdivision: 4,
    }));
    const directive = {
      id: 41,
      order: 0,
      enabled: true,
      fromCycle: 13,
      toCycle: 13,
      family: "barlowAdd",
      pacing: "perCycle",
      intensity: 15,
      scope: null,
      options: { rotateDirection: "earlier" },
    };
    const request = (generator: Record<string, unknown>, cycle = 0) => ({
      spans,
      enabled: true,
      generator: {
        kind: "dumka",
        pattern,
        evolutionRate: 0,
        planLengthCycles: 20,
        seedMode: { type: "locked", seed: 7 },
        ...generator,
      },
      cycle,
      cycleBeats: 4,
      automation: null,
      trackId: null,
    });
    const message = async (
      generator: Record<string, unknown>,
      cycle = 0
    ) => {
      try {
        await driver.invoke("generator_preview", {
          request: request(generator, cycle),
        });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    return {
      complexityFold: await message(
        {
          complexityFloor: 1,
          complexityCeiling: 100_000,
          plan: [],
        },
        1
      ),
      unpairedComplexity: await message({
        plan: [
          {
            ...directive,
            options: {
              ...directive.options,
              complexityFloor: 12_000,
            },
          },
        ],
      }),
      missingDepthLevel: await message({
        subdivisionPalette: [],
        plan: [
          {
            ...directive,
            options: {
              ...directive.options,
              subdivisionLevel: 3,
            },
          },
        ],
      }),
      disabledMissingDepthLevel: await message({
        subdivisionPalette: [],
        plan: [
          {
            ...directive,
            enabled: false,
            options: {
              ...directive.options,
              subdivisionLevel: 3,
            },
          },
        ],
      }),
      missingMorphTarget: await message({
        plan: [
          {
            ...directive,
            family: "morph",
            options: { ...directive.options, morphTarget: null },
          },
        ],
      }),
    };
  }, { pattern: PATTERN });

  expect(errors).toEqual({
    complexityFold:
      "mock dumka preview cannot resolve evolving cycle 1; use the real-backend lane",
    unpairedComplexity:
      "dumka plan invalid: directive 41 complexityFloor and complexityCeiling must both be set or both be omitted",
    missingDepthLevel:
      "dumka plan invalid: directive 41 subdivisionLevel 3 does not exist on working Subdivision 4",
    disabledMissingDepthLevel:
      "dumka plan invalid: directive 41 subdivisionLevel 3 does not exist on working Subdivision 4",
    missingMorphTarget:
      "dumka plan invalid: directive 41 morph requires options.morphTarget",
  });
});
