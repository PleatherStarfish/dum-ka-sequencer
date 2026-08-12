/**
 * P3 persistence adapter for pre-extraction patch documents.
 *
 * The Randomize authoring feature is gone. Until the P7 schema reset removes
 * its serialized block, keep only the old shape/default/normalizer so loading
 * and resaving an existing patch remains byte-compatible.
 */

const DOMAINS = [
  "sections",
  "subdivisions",
  "rhythm",
  "ratchet",
  "ornaments",
  "accents",
  "jathiBhedam",
  "pitch",
  "channel",
] as const;
type DomainId = (typeof DOMAINS)[number];

const FIELDS: Record<DomainId, readonly string[]> = {
  sections: ["boundaries", "count"],
  subdivisions: ["gati", "jathi", "equalParts"],
  rhythm: ["cells", "entryFallback", "articulation"],
  ratchet: ["chance", "position", "timing", "cooldown", "spanGate"],
  ornaments: ["chance", "clusters", "placement", "duration", "cooldown", "rests"],
  accents: ["beat", "jathi", "section", "mode"],
  jathiBhedam: [],
  pitch: ["mode", "tonic", "matrix", "entryFallback", "transpose"],
  channel: ["channels", "entryFallback"],
};

export type LegacyRandomizeRecipeId = "loop" | "drift" | "hub" | "braid" | "mesh";

export interface LegacyAdvancedMatrixSettings {
  enabled: boolean;
  mode: "classic" | "stationary" | "diffusion" | "metastable" | "spectral";
  stationaryPreset: "even" | "home" | "sparse" | "dense" | "entropy";
  stationaryStrength: number;
  diffusionBandwidth: number;
  diffusionDrift: number;
  metastableBasins: number;
  metastableDwell: number;
  metastableEscape: number;
  spectralGap: number;
  spectralOscillation: number;
  spectralModes: number;
  sparsity: number;
  maxWeight: number;
}

export interface LegacyRandomizeDomainSettings {
  enabled: boolean;
  complexity: number;
  recipe: LegacyRandomizeRecipeId;
  fields?: Record<string, boolean>;
}

export interface LegacyMatrixRandomizeDomainSettings
  extends LegacyRandomizeDomainSettings {
  advancedMatrix: LegacyAdvancedMatrixSettings;
}

export interface LegacyRandomizeSettings {
  seed: number;
  sections: LegacyRandomizeDomainSettings;
  subdivisions: LegacyRandomizeDomainSettings;
  rhythm: LegacyMatrixRandomizeDomainSettings;
  ratchet: LegacyRandomizeDomainSettings;
  ornaments: LegacyRandomizeDomainSettings;
  accents: LegacyRandomizeDomainSettings;
  jathiBhedam: LegacyRandomizeDomainSettings;
  pitch: LegacyMatrixRandomizeDomainSettings;
  channel: LegacyMatrixRandomizeDomainSettings;
}

const DEFAULT_ADVANCED_MATRIX_SETTINGS: LegacyAdvancedMatrixSettings = {
  enabled: false,
  mode: "classic",
  stationaryPreset: "even",
  stationaryStrength: 50,
  diffusionBandwidth: 50,
  diffusionDrift: 0,
  metastableBasins: 2,
  metastableDwell: 60,
  metastableEscape: 30,
  spectralGap: 50,
  spectralOscillation: 0,
  spectralModes: 1,
  sparsity: 0,
  maxWeight: 64,
};

const defaultFields = (domain: DomainId): Record<string, boolean> =>
  Object.fromEntries(FIELDS[domain].map((field) => [field, true]));

const domain = (
  enabled: boolean,
  recipe: LegacyRandomizeRecipeId,
  id: DomainId
): LegacyRandomizeDomainSettings => ({
  enabled,
  complexity: 2,
  recipe,
  fields: defaultFields(id),
});

export const DEFAULT_LEGACY_RANDOMIZE_SETTINGS: LegacyRandomizeSettings = {
  seed: 1,
  sections: domain(false, "hub", "sections"),
  subdivisions: domain(false, "loop", "subdivisions"),
  rhythm: {
    ...domain(true, "loop", "rhythm"),
    advancedMatrix: { ...DEFAULT_ADVANCED_MATRIX_SETTINGS },
  },
  ratchet: domain(false, "loop", "ratchet"),
  ornaments: domain(false, "loop", "ornaments"),
  accents: domain(false, "hub", "accents"),
  jathiBhedam: domain(false, "loop", "jathiBhedam"),
  pitch: {
    ...domain(true, "drift", "pitch"),
    advancedMatrix: { ...DEFAULT_ADVANCED_MATRIX_SETTINGS },
  },
  channel: {
    ...domain(false, "braid", "channel"),
    advancedMatrix: { ...DEFAULT_ADVANCED_MATRIX_SETTINGS },
  },
};

const recordOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, number));
};

const normalizeAdvanced = (value: unknown): LegacyAdvancedMatrixSettings => {
  const source = recordOf(value);
  const fallback = DEFAULT_ADVANCED_MATRIX_SETTINGS;
  const modes = ["classic", "stationary", "diffusion", "metastable", "spectral"];
  const presets = ["even", "home", "sparse", "dense", "entropy"];
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    mode: modes.includes(String(source.mode))
      ? (source.mode as LegacyAdvancedMatrixSettings["mode"])
      : fallback.mode,
    stationaryPreset: presets.includes(String(source.stationaryPreset))
      ? (source.stationaryPreset as LegacyAdvancedMatrixSettings["stationaryPreset"])
      : fallback.stationaryPreset,
    stationaryStrength: Math.round(clamp(source.stationaryStrength, 0, 100, fallback.stationaryStrength)),
    diffusionBandwidth: Math.round(clamp(source.diffusionBandwidth, 1, 100, fallback.diffusionBandwidth)),
    diffusionDrift: Math.round(clamp(source.diffusionDrift, -100, 100, fallback.diffusionDrift)),
    metastableBasins: Math.round(clamp(source.metastableBasins, 2, 4, fallback.metastableBasins)),
    metastableDwell: Math.round(clamp(source.metastableDwell, 0, 100, fallback.metastableDwell)),
    metastableEscape: Math.round(clamp(source.metastableEscape, 0, 100, fallback.metastableEscape)),
    spectralGap: Math.round(clamp(source.spectralGap, 0, 100, fallback.spectralGap)),
    spectralOscillation: Math.round(clamp(source.spectralOscillation, 0, 100, fallback.spectralOscillation)),
    spectralModes: Math.round(clamp(source.spectralModes, 1, 4, fallback.spectralModes)),
    sparsity: Math.round(clamp(source.sparsity, 0, 100, fallback.sparsity)),
    maxWeight: Math.round(clamp(source.maxWeight, 16, 999, fallback.maxWeight)),
  };
};

const recipes: readonly LegacyRandomizeRecipeId[] = ["loop", "drift", "hub", "braid", "mesh"];

const normalizeDomain = (
  value: unknown,
  fallback: LegacyRandomizeDomainSettings,
  id: DomainId
): LegacyRandomizeDomainSettings => {
  const source = recordOf(value);
  const rawFields = recordOf(source.fields);
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    complexity: Math.round(clamp(source.complexity, 1, 5, fallback.complexity)),
    recipe: recipes.includes(source.recipe as LegacyRandomizeRecipeId)
      ? (source.recipe as LegacyRandomizeRecipeId)
      : fallback.recipe,
    fields: Object.fromEntries(
      FIELDS[id].map((field) => [
        field,
        typeof rawFields[field] === "boolean" ? rawFields[field] : true,
      ])
    ) as Record<string, boolean>,
  };
};

const normalizeMatrixDomain = (
  value: unknown,
  fallback: LegacyMatrixRandomizeDomainSettings,
  id: "rhythm" | "pitch" | "channel"
): LegacyMatrixRandomizeDomainSettings => {
  const normalized = normalizeDomain(value, fallback, id);
  return {
    enabled: normalized.enabled,
    complexity: normalized.complexity,
    recipe: normalized.recipe,
    advancedMatrix: normalizeAdvanced(recordOf(value).advancedMatrix),
    fields: normalized.fields,
  };
};

export function normalizeLegacyRandomizeSettings(value: unknown): LegacyRandomizeSettings {
  const source = recordOf(value);
  const fallback = DEFAULT_LEGACY_RANDOMIZE_SETTINGS;
  const seed =
    typeof source.seed === "number" && Number.isFinite(source.seed)
      ? Math.max(0, Math.round(source.seed))
      : fallback.seed;
  return {
    seed,
    sections: normalizeDomain(source.sections, fallback.sections, "sections"),
    subdivisions: normalizeDomain(source.subdivisions, fallback.subdivisions, "subdivisions"),
    rhythm: normalizeMatrixDomain(source.rhythm, fallback.rhythm, "rhythm"),
    ratchet: normalizeDomain(source.ratchet, fallback.ratchet, "ratchet"),
    ornaments: normalizeDomain(source.ornaments, fallback.ornaments, "ornaments"),
    accents: normalizeDomain(source.accents, fallback.accents, "accents"),
    jathiBhedam: normalizeDomain(source.jathiBhedam, fallback.jathiBhedam, "jathiBhedam"),
    pitch: normalizeMatrixDomain(source.pitch, fallback.pitch, "pitch"),
    channel: normalizeMatrixDomain(source.channel, fallback.channel, "channel"),
  };
}
