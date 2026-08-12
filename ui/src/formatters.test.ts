import { describe, expect, it } from "vitest";

import {
  formatMultiplier,
  formatPercent,
  formatShortNumber,
  formatVelocityOffset,
  gcdNumber,
} from "./formatters";

describe("formatMultiplier", () => {
  it("drops decimals for integers and keeps two otherwise", () => {
    expect(formatMultiplier(2)).toBe("x2");
    expect(formatMultiplier(3)).toBe("x3");
    expect(formatMultiplier(1.5)).toBe("x1.50");
    expect(formatMultiplier(0.5)).toBe("x0.50");
  });
});

describe("formatPercent", () => {
  it("rounds and clamps to 0-100%", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.333)).toBe("33%");
    expect(formatPercent(1.5)).toBe("100%");
    expect(formatPercent(-0.2)).toBe("0%");
  });
});

describe("formatShortNumber", () => {
  it("shows integers plainly and one decimal otherwise", () => {
    expect(formatShortNumber(5)).toBe("5");
    expect(formatShortNumber(-3)).toBe("-3");
    expect(formatShortNumber(2.5)).toBe("2.5");
  });
});

describe("formatVelocityOffset", () => {
  it("labels relative velocity offsets", () => {
    expect(formatVelocityOffset(0)).toBe("source");
    expect(formatVelocityOffset(5)).toBe("source +5");
    expect(formatVelocityOffset(-5)).toBe("source -5");
    expect(formatVelocityOffset(2.4)).toBe("source +2");
    expect(formatVelocityOffset(-0.4)).toBe("source");
  });
});

describe("gcdNumber", () => {
  it("computes the gcd of rounded absolute values", () => {
    expect(gcdNumber(12, 8)).toBe(4);
    expect(gcdNumber(7, 13)).toBe(1);
    expect(gcdNumber(6, 9)).toBe(3);
    expect(gcdNumber(-12, -8)).toBe(4);
  });

  it("treats zero as one", () => {
    expect(gcdNumber(0, 5)).toBe(1);
    expect(gcdNumber(0, 0)).toBe(1);
  });
});
