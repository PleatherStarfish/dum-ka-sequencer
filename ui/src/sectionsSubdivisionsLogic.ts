import type {
  CustomPartCountChoice,
  JathiWeight,
  SubdivisionWeight,
  SwitchCountWeight,
} from "./bridge";

export const GATI_UI_VALUES = [3, 4, 5, 6, 7, 9, 11] as const;
export const JATHI_VALUES = [3, 4, 5, 6, 7, 9, 11] as const;

const GATI_UI_SET = new Set<number>(GATI_UI_VALUES);
const JATHI_SET = new Set<number>(JATHI_VALUES);
const GATI_ORDER = new Map<number, number>(
  GATI_UI_VALUES.map((gati, index) => [gati, index])
);
const JATHI_ORDER = new Map<number, number>(
  JATHI_VALUES.map((jathi, index) => [jathi, index])
);

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Project a legacy weighted subdivision list onto the fixed authoring model.
 * The P4 Rust compatibility seam uses the same rule: the largest positive
 * weight wins and authored order breaks ties.
 */
export function fixedSubdivisionFromWeights(
  weights: readonly SubdivisionWeight[],
  fallback = 4
): number {
  let selected: SubdivisionWeight | null = null;
  for (const choice of weights) {
    const subdivision = Math.round(choice.subdivision);
    if (
      subdivision < 1 ||
      subdivision > 64 ||
      !Number.isFinite(choice.weight) ||
      choice.weight <= 0
    ) {
      continue;
    }
    if (!selected || choice.weight > selected.weight) {
      selected = { subdivision, weight: choice.weight };
    }
  }
  return selected?.subdivision ?? Math.min(64, Math.max(1, Math.round(fallback)));
}

export function fixedSubdivisionWeights(subdivision: number): SubdivisionWeight[] {
  return [
    {
      subdivision: Math.min(64, Math.max(1, Math.round(subdivision))),
      weight: 1,
    },
  ];
}

export function isValidGroupingChoice(
  grouping: number,
  totalMatras?: number,
  timingGrid?: number
): boolean {
  const rounded = Math.round(grouping);
  if (!JATHI_SET.has(rounded)) return false;
  const tiles = totalMatras === undefined || totalMatras % rounded === 0;
  const nonTrivial = timingGrid === undefined || rounded % timingGrid !== 0;
  return tiles && nonTrivial;
}

/** Apply the fixed-value compatibility projection to legacy grouping weights. */
export function fixedGroupingFromWeights(
  weights: readonly JathiWeight[],
  totalMatras?: number,
  timingGrid?: number
): number | null {
  let selected: JathiWeight | null = null;
  for (const choice of weights) {
    const jathi = Math.round(choice.jathi);
    if (
      !isValidGroupingChoice(jathi, totalMatras, timingGrid) ||
      !Number.isFinite(choice.weight) ||
      choice.weight <= 0
    ) {
      continue;
    }
    if (!selected || choice.weight > selected.weight) {
      selected = { jathi, weight: choice.weight };
    }
  }
  return selected?.jathi ?? null;
}

export function fixedGroupingWeights(grouping: number | null): JathiWeight[] {
  return grouping === null || !isValidGroupingChoice(grouping)
    ? []
    : [{ jathi: Math.round(grouping), weight: 1 }];
}

function sortByCanonicalOrder<T>(
  rows: T[],
  getIdentity: (row: T) => number,
  order: Map<number, number>
): T[] {
  return rows.sort((a, b) => {
    const aIdentity = getIdentity(a);
    const bIdentity = getIdentity(b);
    const aOrder = order.get(aIdentity);
    const bOrder = order.get(bIdentity);
    if (aOrder !== undefined && bOrder !== undefined) {
      return aOrder - bOrder;
    }
    if (aOrder !== undefined) return -1;
    if (bOrder !== undefined) return 1;
    return aIdentity - bIdentity;
  });
}

export function isCanonicalGati(value: number): boolean {
  return GATI_UI_SET.has(Math.round(value));
}

export function canonicalizeGatiWeights(
  weights: SubdivisionWeight[],
  options: { includePaletteZeros?: boolean } = {}
): SubdivisionWeight[] {
  const bySubdivision = new Map<number, number>();
  for (const weight of weights) {
    const subdivision = Math.round(weight.subdivision);
    if (subdivision < 1 || subdivision > 64) continue;
    if (!finiteNonNegative(weight.weight)) continue;
    bySubdivision.set(
      subdivision,
      (bySubdivision.get(subdivision) ?? 0) + weight.weight
    );
  }
  if (options.includePaletteZeros) {
    for (const gati of GATI_UI_VALUES) {
      if (!bySubdivision.has(gati)) {
        bySubdivision.set(gati, 0);
      }
    }
  }
  return sortByCanonicalOrder(
    Array.from(bySubdivision, ([subdivision, weight]) => ({
      subdivision,
      weight,
    })),
    (row) => row.subdivision,
    GATI_ORDER
  );
}

export function visibleGatiWeights(
  weights: SubdivisionWeight[],
  resolvedGati?: number | null
): SubdivisionWeight[] {
  const roundedResolved =
    resolvedGati !== null && resolvedGati !== undefined
      ? Math.round(resolvedGati)
      : null;
  const canonical = canonicalizeGatiWeights(weights);
  const visible = canonical.filter(
    (weight) =>
      weight.weight > 0 ||
      weight.subdivision === roundedResolved ||
      !isCanonicalGati(weight.subdivision)
  );
  if (visible.length > 0 || canonical.length === 0) {
    return visible;
  }
  const first = canonical[0];
  return first ? [first] : [];
}

export function availableCanonicalGatis(
  visibleWeights: SubdivisionWeight[]
): number[] {
  const visible = new Set(visibleWeights.map((weight) => weight.subdivision));
  return GATI_UI_VALUES.filter((gati) => !visible.has(gati));
}

export function canonicalizeJathiWeights(
  weights: JathiWeight[],
  options: { includeAll?: boolean } = {}
): JathiWeight[] {
  const byJathi = new Map<number, number>();
  for (const weight of weights) {
    const jathi = Math.round(weight.jathi);
    if (!JATHI_SET.has(jathi)) continue;
    if (!finiteNonNegative(weight.weight)) continue;
    byJathi.set(jathi, (byJathi.get(jathi) ?? 0) + weight.weight);
  }
  if (options.includeAll) {
    for (const jathi of JATHI_VALUES) {
      if (!byJathi.has(jathi)) {
        byJathi.set(jathi, 0);
      }
    }
  }
  return sortByCanonicalOrder(
    Array.from(byJathi, ([jathi, weight]) => ({ jathi, weight })),
    (row) => row.jathi,
    JATHI_ORDER
  );
}

export function canonicalizePartCountWeights(
  weights: CustomPartCountChoice[]
): CustomPartCountChoice[] {
  const byCount = new Map<number, number>();
  for (const weight of weights) {
    const count = Math.round(weight.count);
    if (count < 1 || count > 64) continue;
    if (!finiteNonNegative(weight.weight)) continue;
    byCount.set(count, (byCount.get(count) ?? 0) + weight.weight);
  }
  return Array.from(byCount, ([count, weight]) => ({ count, weight })).sort(
    (a, b) => a.count - b.count
  );
}

export function canonicalizeSwitchCountWeights(
  weights: SwitchCountWeight[],
  boundaryCount: number
): SwitchCountWeight[] {
  const maxSwitchCount = Math.max(0, Math.round(boundaryCount));
  const byCount = new Map<number, number>();
  for (const weight of weights) {
    const count = Math.round(weight.count);
    if (count < 0 || count > maxSwitchCount) continue;
    if (!finiteNonNegative(weight.weight)) continue;
    byCount.set(count, (byCount.get(count) ?? 0) + weight.weight);
  }
  return Array.from(byCount, ([count, weight]) => ({ count, weight })).sort(
    (a, b) => a.count - b.count
  );
}

export function boundaryPositionOptions(
  cycleBeats: number,
  boundaries: Array<{ afterBeat: number }>,
  currentPosition?: number | null
): number[] {
  const roundedCycleBeats = Math.max(1, Math.round(cycleBeats || 1));
  if (roundedCycleBeats < 2) {
    return [];
  }
  const roundedCurrent =
    currentPosition === null || currentPosition === undefined
      ? null
      : Math.round(currentPosition);
  const occupied = new Set(
    boundaries.map((boundary) => Math.round(boundary.afterBeat))
  );
  return Array.from(
    { length: roundedCycleBeats - 1 },
    (_, index) => index + 1
  ).filter(
    (afterBeat) => afterBeat === roundedCurrent || !occupied.has(afterBeat)
  );
}

export function canMoveBoundaryTo(
  cycleBeats: number,
  boundaries: Array<{ afterBeat: number }>,
  currentPosition: number,
  nextPosition: number
): boolean {
  const options = boundaryPositionOptions(cycleBeats, boundaries, currentPosition);
  return options.includes(Math.round(nextPosition));
}
