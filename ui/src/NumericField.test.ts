import { describe, expect, test } from "vitest";

import { resolveNumericFieldBehavior } from "./NumericField";

describe("resolveNumericFieldBehavior", () => {
  test("defaults ordinary numeric fields to integer stepping", () => {
    expect(resolveNumericFieldBehavior({}).mode).toBe("integer");
    expect(resolveNumericFieldBehavior({}).stepNumber).toBe(1);
    expect(resolveNumericFieldBehavior({}).inputMode).toBe("numeric");
  });

  test("uses explicit weight mode for nonnegative integer stepping", () => {
    const byMode = resolveNumericFieldBehavior({
      numericMode: "weight",
      step: 0.5,
    });
    expect(byMode.mode).toBe("weight");
    expect(byMode.minNumber).toBe(0);
    expect(byMode.stepNumber).toBe(1);
    expect(byMode.inputMode).toBe("numeric");
  });

  test("keeps explicit sub-integer controls decimal", () => {
    const decimal = resolveNumericFieldBehavior({ step: 0.05 });
    expect(decimal.mode).toBe("decimal");
    expect(decimal.stepNumber).toBe(0.05);
    expect(decimal.inputMode).toBe("decimal");
  });
});
