import { describe, expect, it } from "vitest";

import {
  timelineTickToMusicalAkshara,
} from "./timelineTickSpace";

describe("timeline tick-space conversion", () => {
  it("uses the linear cycle position", () => {
    expect(timelineTickToMusicalAkshara(250, 1000, 8)).toBe(2);
  });
});
