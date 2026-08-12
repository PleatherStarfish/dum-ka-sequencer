import { describe, expect, it } from "vitest";

import {
  SEED_LOOP_MONITOR_MODES,
  childStreamSeedModeRequest,
} from "./seedStrategyModel";

const global = {
  mode: "history" as const,
  seed: 1,
  history: ["11", "22"],
  historyWeight: 3,
  newSeedWeight: 1,
  maxHistory: 8,
};
const own = {
  seed: 99,
  history: ["7"],
  historyWeight: 2,
  newSeedWeight: 4,
  maxHistory: 5,
};

describe("retained seed strategy", () => {
  it("monitors only history recurrence", () => {
    expect(SEED_LOOP_MONITOR_MODES).toEqual(["history"]);
  });

  it("inherits the global history pool", () => {
    expect(childStreamSeedModeRequest("followGlobal", global, own)).toEqual({
      type: "history",
      seed: 1,
      history: ["11", "22"],
      historyWeight: 3,
      newSeedWeight: 1,
      maxHistory: 8,
    });
  });

  it("uses an owned retained mode", () => {
    expect(childStreamSeedModeRequest("locked", global, own)).toEqual({
      type: "locked",
      seed: 99,
    });
  });

  it("projects legacy drift and morph compatibility values to per-cycle", () => {
    expect(childStreamSeedModeRequest("drift", global, own)).toEqual({
      type: "perCycle",
      seed: 99,
    });
    expect(childStreamSeedModeRequest("morph", global, own)).toEqual({
      type: "perCycle",
      seed: 99,
    });
  });
});
