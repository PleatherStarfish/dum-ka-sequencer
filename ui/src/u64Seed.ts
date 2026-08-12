/** Canonical unsigned 64-bit seed representation for every engine-produced wire value. */
export type U64SeedDecimal = string;

const MAX_U64_SEED = 18_446_744_073_709_551_615n;

/**
 * Decimal strings never pass through Number. Legacy numeric DTO/patch values
 * remain readable, although an already-rounded unsafe legacy number cannot be
 * made more precise after the fact.
 */
export function normalizeU64SeedDecimal(value: unknown): U64SeedDecimal | null {
  let parsed: bigint;
  try {
    if (typeof value === "string") {
      const text = value.trim();
      if (!/^\d+$/.test(text)) return null;
      parsed = BigInt(text);
    } else if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      parsed = BigInt(Math.round(value));
    } else {
      return null;
    }
  } catch {
    return null;
  }
  return parsed <= MAX_U64_SEED ? parsed.toString() : null;
}

export function normalizeU64SeedDecimalList(value: unknown): U64SeedDecimal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((seed) => {
    const normalized = normalizeU64SeedDecimal(seed);
    return normalized === null ? [] : [normalized];
  });
}
