import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEGACY_RANDOMIZE_SETTINGS,
  normalizeLegacyRandomizeSettings,
} from "./legacyRandomizeSettings";

describe("legacy Randomize persistence adapter", () => {
  it("preserves the pre-extraction defaults until the P7 schema reset", () => {
    expect(normalizeLegacyRandomizeSettings(undefined)).toEqual(
      DEFAULT_LEGACY_RANDOMIZE_SETTINGS
    );
  });

  it("is an idempotent tolerant normalizer", () => {
    const normalized = normalizeLegacyRandomizeSettings({
      seed: 12.6,
      rhythm: {
        enabled: false,
        complexity: 99,
        recipe: "mesh",
        fields: { cells: false },
        advancedMatrix: { enabled: true, spectralModes: 99 },
      },
    });
    expect(normalized.seed).toBe(13);
    expect(normalized.rhythm.complexity).toBe(5);
    expect(normalized.rhythm.fields?.cells).toBe(false);
    expect(normalized.rhythm.advancedMatrix.spectralModes).toBe(4);
    expect(normalizeLegacyRandomizeSettings(normalized)).toEqual(normalized);
  });
});
