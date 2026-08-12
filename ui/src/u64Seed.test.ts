import { describe, expect, it } from "vitest";

import {
  normalizeU64SeedDecimal,
  normalizeU64SeedDecimalList,
} from "./u64Seed";

describe("u64 seed normalization", () => {
  it("preserves 2^53+1 and u64::MAX without numeric coercion", () => {
    expect(normalizeU64SeedDecimal("9007199254740993")).toBe(
      "9007199254740993"
    );
    expect(normalizeU64SeedDecimal("18446744073709551615")).toBe(
      "18446744073709551615"
    );
    expect(normalizeU64SeedDecimal("18446744073709551616")).toBeNull();
  });

  it("accepts legacy safe numbers and canonicalizes decimal lists", () => {
    expect(
      normalizeU64SeedDecimalList([7, "09007199254740993", -1, "bad"])
    ).toEqual(["7", "9007199254740993"]);
  });
});
