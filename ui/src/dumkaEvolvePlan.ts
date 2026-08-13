import type {
  CurvePoint,
  EvolutionCurve,
  DirectiveBeatRange,
  DirectiveEuclidRestPolicy,
  DirectiveFamily,
  DirectiveMagnitude,
  DirectiveOptions,
  DirectivePacing,
  DirectiveRotateDirection,
  DirectiveTraceEntry,
  EvolutionDirective,
} from "./bridge";
import {
  compileDumkaPattern,
  MAX_DUMKA_PATTERN_LENGTH,
  normalizeDumkaSubdivisionPalette,
} from "./dumkaPattern";
import { dumkaSubdivisionLevelExists } from "./dumkaMetrics";

export type {
  DirectiveEuclidRestPolicy as EuclidRestPolicy,
  DirectiveFamily,
  DirectiveMagnitude,
  DirectiveOptions,
  DirectivePacing,
  DirectiveRotateDirection as RotateDirection,
  DirectiveTraceEntry,
  EvolutionDirective,
};
export type BeatRange = DirectiveBeatRange;

export const DIRECTIVE_FAMILIES = [
  "barlowRemove",
  "barlowAdd",
  "rotate",
  "syncopate",
  "desyncopate",
  "fragment",
  "consolidate",
  "euclid",
  "morph",
  "stochastic",
] as const;

/** Mirrors cseq-rhythm's public MAX_EVOLUTION_DIRECTIVES validation bound. */
export const MAX_EVOLUTION_DIRECTIVES = 256;
export const MAX_PERCEPTUAL_DISTANCE_MILLI = 100_000;
export const MAX_PERCEPTUAL_OPERATIONS = 256;
/** Mirrors the engine's cumulative, lifetime prefix-scoring admission bound. */
export const MAX_PERCEPTUAL_SCORING_WORK = 4_096;
export const MAX_COMPLEXITY_MILLI = 100_000;
export const MAX_SUBDIVISION_LEVEL_INDEX = 0xffff_ffff;

export const DEFAULT_SUBDIVISION_PALETTE: readonly number[] = [];

export function normalizeSubdivisionPalette(value: unknown): number[] {
  return normalizeDumkaSubdivisionPalette(value);
}

/** Mirrors plan.rs curve caps. */
export const MAX_CURVE_POINTS = 64;
export const MAX_CURVE_SPAN_CYCLES = 512;
export const MAX_CURVE_OPERATIONS = 8;

export const DEFAULT_EVOLUTION_CURVE: EvolutionCurve = {
  enabled: false,
  modelVersion: "v1",
  toleranceMilli: 500,
  maxOperations: 4,
  points: [],
};

export function curveIsActive(curve: EvolutionCurve): boolean {
  return curve.enabled && curve.points.some((point) => point.targetMilli > 0);
}

/** Exact mirror of EvolutionCurve::target_milli_at (integer lerp,
 * round-half-away-from-zero, 0 outside the points' span). */
export function curveTargetMilliAt(curve: EvolutionCurve, cycle: number): number {
  if (!curve.enabled || curve.points.length === 0) return 0;
  const first = curve.points[0]!;
  const last = curve.points[curve.points.length - 1]!;
  if (cycle < first.cycle || cycle > last.cycle) return 0;
  let previous = first;
  for (const point of curve.points) {
    if (point.cycle === cycle) return point.targetMilli;
    if (point.cycle > cycle) {
      const span = point.cycle - previous.cycle;
      const offset = cycle - previous.cycle;
      const delta = point.targetMilli - previous.targetMilli;
      const numerator = delta * offset;
      const half = Math.trunc(span / 2);
      const rounded =
        numerator >= 0
          ? Math.trunc((numerator + half) / span)
          : Math.trunc((numerator - half) / span);
      return Math.min(100_000, Math.max(0, previous.targetMilli + rounded));
    }
    previous = point;
  }
  return 0;
}

/** Mirrors EvolutionCurve::scoring_work_through(u64::MAX): every covered
 * cycle with a nonzero target reserves maxOperations + 1 evaluations. */
export function curveScoringWork(curve: EvolutionCurve): bigint {
  if (!curveIsActive(curve)) return 0n;
  const first = curve.points[0]!.cycle;
  const last = curve.points[curve.points.length - 1]!.cycle;
  let total = 0n;
  for (let cycle = Math.max(1, first); cycle <= last; cycle += 1) {
    if (curveTargetMilliAt(curve, cycle) > 0) {
      total += BigInt(curve.maxOperations) + 1n;
    }
  }
  return total;
}

export type CurveEditResult =
  | { ok: true; curve: EvolutionCurve }
  | { ok: false; message: string };

/** Mirrors plan.rs validate_curve messages byte-for-byte. */
export function validateEvolutionCurve(curve: EvolutionCurve): string | null {
  if (curve.points.length > MAX_CURVE_POINTS) {
    return `dumka plan invalid: curve supports at most ${MAX_CURVE_POINTS} points, got ${curve.points.length}`;
  }
  let previous: number | null = null;
  for (const point of curve.points) {
    if (point.cycle < 1) {
      return "dumka plan invalid: curve point cycles must be ≥ 1";
    }
    if (previous !== null && point.cycle <= previous) {
      return "dumka plan invalid: curve points must have strictly ascending cycles";
    }
    if (point.targetMilli > 100_000) {
      return `dumka plan invalid: curve targetMilli must be 0-100000, got ${point.targetMilli}`;
    }
    previous = point.cycle;
  }
  if (curve.toleranceMilli > 100_000) {
    return `dumka plan invalid: curve toleranceMilli must be 0-100000, got ${curve.toleranceMilli}`;
  }
  if (curve.maxOperations < 1 || curve.maxOperations > MAX_CURVE_OPERATIONS) {
    return `dumka plan invalid: curve maxOperations must be 1-${MAX_CURVE_OPERATIONS}, got ${curve.maxOperations}`;
  }
  if (curve.points.length > 0) {
    const span =
      curve.points[curve.points.length - 1]!.cycle - curve.points[0]!.cycle;
    if (span > MAX_CURVE_SPAN_CYCLES) {
      return `dumka plan invalid: curve spans ${span} cycles between its first and last points, the maximum is ${MAX_CURVE_SPAN_CYCLES}`;
    }
  }
  return null;
}

function finishCurve(
  plan: readonly EvolutionDirective[],
  curve: EvolutionCurve
): CurveEditResult {
  const structural = validateEvolutionCurve(curve);
  if (structural !== null) return { ok: false, message: structural };
  const requested = perceptualScoringWork(plan) + curveScoringWork(curve);
  if (requested > BigInt(MAX_PERCEPTUAL_SCORING_WORK)) {
    return {
      ok: false,
      message: `dumka perceptual plan reserves ${requested.toString()} scoring operations, exceeding the limit of ${MAX_PERCEPTUAL_SCORING_WORK}`,
    };
  }
  return { ok: true, curve };
}

/** Insert or replace the point at `cycle`, keeping points sorted. */
export function upsertCurvePoint(
  plan: readonly EvolutionDirective[],
  curve: EvolutionCurve,
  cycle: number,
  targetMilli: number
): CurveEditResult {
  const points: CurvePoint[] = curve.points.filter(
    (point) => point.cycle !== cycle
  );
  points.push({
    cycle: Math.max(1, Math.round(cycle)),
    targetMilli: Math.min(100_000, Math.max(0, Math.round(targetMilli))),
  });
  points.sort((a, b) => a.cycle - b.cycle);
  return finishCurve(plan, { ...curve, points });
}

export function removeCurvePoint(
  plan: readonly EvolutionDirective[],
  curve: EvolutionCurve,
  cycle: number
): CurveEditResult {
  const points = curve.points.filter((point) => point.cycle !== cycle);
  return finishCurve(plan, { ...curve, points });
}

export function setCurveSettings(
  plan: readonly EvolutionDirective[],
  curve: EvolutionCurve,
  settings: Partial<
    Pick<EvolutionCurve, "enabled" | "toleranceMilli" | "maxOperations">
  >
): CurveEditResult {
  return finishCurve(plan, { ...curve, ...settings });
}

/** Tolerant patch-reader normalization: repairs what it can, drops what it
 * must, and never invents values the engine would reject. */
export function normalizeEvolutionCurve(value: unknown): {
  curve: EvolutionCurve;
  droppedPoints: number;
} {
  if (typeof value !== "object" || value === null) {
    return { curve: { ...DEFAULT_EVOLUTION_CURVE, points: [] }, droppedPoints: 0 };
  }
  const source = value as Partial<EvolutionCurve> & { points?: unknown };
  let dropped = 0;
  const points: CurvePoint[] = [];
  if (Array.isArray(source.points)) {
    for (const raw of source.points) {
      if (typeof raw !== "object" || raw === null) {
        dropped += 1;
        continue;
      }
      const candidate = raw as Partial<CurvePoint>;
      const cycle = Number(candidate.cycle);
      const target = Number(candidate.targetMilli);
      if (
        !Number.isInteger(cycle) ||
        cycle < 1 ||
        !Number.isInteger(target) ||
        target < 0 ||
        target > 100_000
      ) {
        dropped += 1;
        continue;
      }
      if (points.some((point) => point.cycle === cycle)) {
        dropped += 1;
        continue;
      }
      points.push({ cycle, targetMilli: target });
    }
  }
  points.sort((a, b) => a.cycle - b.cycle);
  while (points.length > MAX_CURVE_POINTS) {
    points.pop();
    dropped += 1;
  }
  while (
    points.length > 1 &&
    points[points.length - 1]!.cycle - points[0]!.cycle > MAX_CURVE_SPAN_CYCLES
  ) {
    points.pop();
    dropped += 1;
  }
  const toleranceRaw = Number(source.toleranceMilli);
  const opsRaw = Number(source.maxOperations);
  const curve: EvolutionCurve = {
    enabled: source.enabled === true,
    modelVersion: "v1",
    toleranceMilli: Number.isInteger(toleranceRaw)
      ? Math.min(100_000, Math.max(0, toleranceRaw))
      : DEFAULT_EVOLUTION_CURVE.toleranceMilli,
    maxOperations: Number.isInteger(opsRaw)
      ? Math.min(MAX_CURVE_OPERATIONS, Math.max(1, opsRaw))
      : DEFAULT_EVOLUTION_CURVE.maxOperations,
    points,
  };
  return { curve, droppedPoints: dropped };
}

const U64_MAX = (1n << 64n) - 1n;

export const DEFAULT_PERCEPTUAL_MAGNITUDE: Readonly<
  Extract<DirectiveMagnitude, { mode: "perceptual" }>
> = {
  mode: "perceptual",
  modelVersion: "v1",
  targetMilli: 5_000,
  toleranceMilli: 500,
  maxOperations: 16,
};

export const DIRECTIVE_FAMILY_LABELS: Record<DirectiveFamily, string> = {
  barlowRemove: "Remove",
  barlowAdd: "Add",
  rotate: "Rotate",
  syncopate: "Syncopate",
  desyncopate: "Desyncopate",
  fragment: "Fragment",
  consolidate: "Consolidate",
  euclid: "Euclid",
  morph: "Morph",
  stochastic: "Stochastic",
};

export const DEFAULT_DIRECTIVE_OPTIONS: Readonly<DirectiveOptions> = {
  barlowTemperature: null,
  fillComplexity: null,
  densityFloor: null,
  densityCeiling: null,
  complexityFloor: null,
  complexityCeiling: null,
  placementBias: null,
  subdivisionLevel: null,
  morphTarget: null,
  euclidMaxRun: null,
  euclidInvert: null,
  euclidRestPolicy: null,
  rotateDirection: "earlier",
};

export const DEFAULT_DIRECTIVE_PACING: DirectivePacing = "perCycle";

export const DIRECTIVE_PACING_LABELS: Readonly<Record<DirectivePacing, string>> = {
  perCycle: "Repeat each cycle",
  linear: "Linear transition",
  easeInOut: "Gentle transition",
};

export type PlanEditResult =
  | { ok: true; plan: EvolutionDirective[] }
  | { ok: false; message: string };

const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;
const familySet = new Set<string>(DIRECTIVE_FAMILIES);

function integer(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, integer(value, fallback)));
}

function saturatingU64(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  const integerValue = BigInt(Math.round(value));
  return integerValue > U64_MAX ? U64_MAX : integerValue;
}

function saturatingAddU64(left: bigint, right: bigint): bigint {
  const sum = left + right;
  return sum > U64_MAX ? U64_MAX : sum;
}

function saturatingMulU64(left: bigint, right: bigint): bigint {
  if (left === 0n || right === 0n) return 0n;
  return left > U64_MAX / right ? U64_MAX : left * right;
}

/**
 * Maximum model scores reserved by one row over its complete inclusive range.
 * P0 is scored before each row's 1..=maxOperations prefix search.
 */
export function perceptualDirectiveScoringWork(
  directive: Pick<
    EvolutionDirective,
    "enabled" | "fromCycle" | "toCycle" | "magnitude"
  >
): bigint {
  if (!directive.enabled || directive.magnitude?.mode !== "perceptual") return 0n;
  const first = saturatingU64(directive.fromCycle);
  const last = saturatingU64(directive.toCycle);
  if (last < first) return 0n;
  const activeCycles = saturatingAddU64(last - first, 1n);
  const scoresPerCycle = saturatingAddU64(
    saturatingU64(directive.magnitude.maxOperations),
    1n
  );
  return saturatingMulU64(activeCycles, scoresPerCycle);
}

/** Aggregate lifetime score reservation, using the engine's saturating u64 math. */
export function perceptualScoringWork(
  plan: readonly Pick<
    EvolutionDirective,
    "enabled" | "fromCycle" | "toCycle" | "magnitude"
  >[]
): bigint {
  return plan.reduce(
    (total, directive) =>
      saturatingAddU64(total, perceptualDirectiveScoringWork(directive)),
    0n
  );
}

export function perceptualScoringWorkError(
  plan: readonly Pick<
    EvolutionDirective,
    "enabled" | "fromCycle" | "toCycle" | "magnitude"
  >[]
): string | null {
  const requested = perceptualScoringWork(plan);
  return requested > BigInt(MAX_PERCEPTUAL_SCORING_WORK)
    ? `dumka perceptual plan reserves ${requested.toString()} scoring operations, exceeding the limit of ${MAX_PERCEPTUAL_SCORING_WORK}`
    : null;
}

function normalizeOverride(
  value: unknown,
  min: number,
  max: number
): number | null {
  return value === null || value === undefined
    ? null
    : clamp(value, min, max, min);
}

function normalizeMorphTarget(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  let length = 0;
  for (const _codePoint of value) {
    length += 1;
    if (length > MAX_DUMKA_PATTERN_LENGTH) return null;
  }
  return value;
}

export function normalizeDirectiveOptions(
  value: Partial<DirectiveOptions> | null | undefined
): DirectiveOptions {
  const source = value ?? {};
  const densityFloor = normalizeOverride(source.densityFloor, 0, 100);
  const densityCeiling = normalizeOverride(source.densityCeiling, 0, 100);
  const corridorPaired = densityFloor !== null && densityCeiling !== null;
  const complexityFloor = normalizeOverride(
    source.complexityFloor,
    0,
    MAX_COMPLEXITY_MILLI
  );
  const complexityCeiling = normalizeOverride(
    source.complexityCeiling,
    0,
    MAX_COMPLEXITY_MILLI
  );
  const complexityPaired =
    complexityFloor !== null && complexityCeiling !== null;
  const subdivisionLevel =
    typeof source.subdivisionLevel === "number" &&
    Number.isInteger(source.subdivisionLevel) &&
    source.subdivisionLevel >= 0 &&
    source.subdivisionLevel <= MAX_SUBDIVISION_LEVEL_INDEX
      ? source.subdivisionLevel
      : null;
  return {
    barlowTemperature: normalizeOverride(source.barlowTemperature, 0, 100),
    fillComplexity: normalizeOverride(source.fillComplexity, 0, 100),
    densityFloor: corridorPaired ? Math.min(densityFloor, densityCeiling) : null,
    densityCeiling: corridorPaired ? Math.max(densityFloor, densityCeiling) : null,
    complexityFloor: complexityPaired
      ? Math.min(complexityFloor, complexityCeiling)
      : null,
    complexityCeiling: complexityPaired
      ? Math.max(complexityFloor, complexityCeiling)
      : null,
    placementBias: normalizeOverride(source.placementBias, 0, 100),
    subdivisionLevel,
    morphTarget: normalizeMorphTarget(source.morphTarget),
    euclidMaxRun: normalizeOverride(source.euclidMaxRun, 1, 8),
    euclidInvert: normalizeOverride(source.euclidInvert, 0, 100),
    euclidRestPolicy:
      source.euclidRestPolicy === "silent" || source.euclidRestPolicy === "tied"
        ? source.euclidRestPolicy
        : null,
    rotateDirection: source.rotateDirection === "later" ? "later" : "earlier",
  };
}

export function normalizeDirectivePacing(
  value: unknown,
  family: DirectiveFamily
): DirectivePacing {
  if (family === "stochastic") return DEFAULT_DIRECTIVE_PACING;
  return value === "linear" || value === "easeInOut"
    ? value
    : DEFAULT_DIRECTIVE_PACING;
}

export function normalizeDirectiveMagnitude(
  value: unknown,
  family: DirectiveFamily
): EvolutionDirective["magnitude"] {
  if (family === "stochastic" || typeof value !== "object" || value === null) {
    return undefined;
  }
  const source = value as Partial<Extract<DirectiveMagnitude, { mode: "perceptual" }>> & {
    mode?: unknown;
  };
  if (source.mode !== "perceptual" || source.modelVersion !== "v1") {
    return undefined;
  }
  return {
    mode: "perceptual",
    modelVersion: "v1",
    targetMilli: clamp(
      source.targetMilli,
      0,
      MAX_PERCEPTUAL_DISTANCE_MILLI,
      DEFAULT_PERCEPTUAL_MAGNITUDE.targetMilli
    ),
    toleranceMilli: clamp(
      source.toleranceMilli,
      0,
      MAX_PERCEPTUAL_DISTANCE_MILLI,
      DEFAULT_PERCEPTUAL_MAGNITUDE.toleranceMilli
    ),
    maxOperations: clamp(
      source.maxOperations,
      1,
      MAX_PERCEPTUAL_OPERATIONS,
      DEFAULT_PERCEPTUAL_MAGNITUDE.maxOperations
    ),
  };
}

function withMagnitude<T extends EvolutionDirective>(
  row: T,
  magnitude: EvolutionDirective["magnitude"]
): T {
  const { magnitude: _magnitude, ...base } = row;
  return (magnitude === undefined ? base : { ...base, magnitude }) as T;
}

function cloneDirective(row: EvolutionDirective): EvolutionDirective {
  return withMagnitude({
    ...row,
    scope: row.scope ? { ...row.scope } : null,
    options: { ...row.options },
  }, normalizeDirectiveMagnitude(row.magnitude, row.family));
}

function dense(plan: readonly EvolutionDirective[]): EvolutionDirective[] {
  return [...plan]
    .sort((a, b) => a.order - b.order)
    .map((row, order) => ({ ...cloneDirective(row), order }));
}

/**
 * Canonical editor normalization. Persistence owns malformed/unknown-row
 * warnings; this accepts known typed rows and makes their shape deterministic.
 */
export function normalizeEvolutionPlan(
  plan: readonly EvolutionDirective[]
): EvolutionDirective[] {
  const reservedIds = new Set(
    plan
      .map((row) => integer(row.id, 0))
      .filter((id) => id > 0 && id <= MAX_SAFE_ID)
  );
  const seenIds = new Set<number>();
  const maxReserved = Math.max(0, ...reservedIds);
  let nextId = maxReserved < MAX_SAFE_ID ? maxReserved + 1 : 1;

  const allocateId = () => {
    while (reservedIds.has(nextId) || seenIds.has(nextId)) {
      nextId = nextId < MAX_SAFE_ID ? nextId + 1 : 1;
    }
    const allocated = nextId;
    nextId = nextId < MAX_SAFE_ID ? nextId + 1 : 1;
    return allocated;
  };

  const normalized = plan.map((row, sourceIndex) => {
    let id = integer(row.id, 0);
    if (id <= 0 || id > MAX_SAFE_ID || seenIds.has(id)) {
      id = allocateId();
    }
    seenIds.add(id);
    const fromCycle = Math.max(1, integer(row.fromCycle, 1));
    const scope = row.scope
      ? {
          startBeat: Math.max(0, integer(row.scope.startBeat, 0)),
          lenBeats: Math.max(1, integer(row.scope.lenBeats, 1)),
        }
      : null;
    const magnitude = normalizeDirectiveMagnitude(row.magnitude, row.family);
    const options = normalizeDirectiveOptions(row.options);
    return withMagnitude({
      ...row,
      id,
      order: Math.max(0, integer(row.order, sourceIndex)),
      enabled: row.enabled !== false,
      fromCycle,
      toCycle: Math.max(fromCycle, integer(row.toCycle, fromCycle)),
      intensity: clamp(row.intensity, 0, 100, 25),
      pacing:
        magnitude?.mode === "perceptual"
          ? DEFAULT_DIRECTIVE_PACING
          : normalizeDirectivePacing(row.pacing, row.family),
      scope,
      options: {
        ...options,
        morphTarget: row.family === "morph" ? options.morphTarget : null,
      },
      sourceIndex,
    }, magnitude);
  });

  return normalized
    .sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex)
    .map(({ sourceIndex: _sourceIndex, ...row }, order) => ({ ...row, order }));
}

function overlapCycle(
  a: Pick<EvolutionDirective, "fromCycle" | "toCycle">,
  b: Pick<EvolutionDirective, "fromCycle" | "toCycle">
): number | null {
  const cycle = Math.max(a.fromCycle, b.fromCycle);
  return cycle <= Math.min(a.toCycle, b.toCycle) ? cycle : null;
}

export function subdivisionLevelValidationError(
  plan: readonly EvolutionDirective[],
  workingSubdivision: number
): string | null {
  const invalid = plan.find(
    (row) =>
      row.options.subdivisionLevel !== null &&
      !dumkaSubdivisionLevelExists(
        row.options.subdivisionLevel,
        workingSubdivision
      )
  );
  return invalid
    ? `dumka plan invalid: directive ${invalid.id} subdivisionLevel ${invalid.options.subdivisionLevel} does not exist on working Subdivision ${workingSubdivision}`
    : null;
}

export function validateEvolutionPlan(
  plan: readonly EvolutionDirective[],
  workingSubdivision?: number
): PlanEditResult {
  if (plan.length > MAX_EVOLUTION_DIRECTIVES) {
    return {
      ok: false,
      message: `dumka plan invalid: plan supports at most ${MAX_EVOLUTION_DIRECTIVES} directives, got ${plan.length}`,
    };
  }
  const normalized = normalizeEvolutionPlan(plan);
  const morphWithoutTarget = normalized.find(
    (row) => row.family === "morph" && row.options.morphTarget === null
  );
  if (morphWithoutTarget) {
    return {
      ok: false,
      message: `dumka plan invalid: directive ${morphWithoutTarget.id} morph requires options.morphTarget`,
    };
  }
  const silentMorph = normalized.find((row) => {
    if (row.family !== "morph" || row.options.morphTarget === null) return false;
    const compiled = compileDumkaPattern(row.options.morphTarget);
    return compiled.ok && compiled.compiled.events.length === 0;
  });
  if (silentMorph) {
    return {
      ok: false,
      message: `dumka plan invalid: directive ${silentMorph.id} morph target must contain at least one sounding onset`,
    };
  }
  const workError = perceptualScoringWorkError(normalized);
  if (workError !== null) {
    return { ok: false, message: workError };
  }
  if (workingSubdivision !== undefined) {
    const levelError = subdivisionLevelValidationError(
      normalized,
      workingSubdivision
    );
    if (levelError !== null) return { ok: false, message: levelError };
  }
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const a = normalized[left]!;
      const b = normalized[right]!;
      if (a.family !== b.family) continue;
      const cycle = overlapCycle(a, b);
      if (cycle !== null) {
        return {
          ok: false,
          message: `dumka plan overlap: ${a.family} directives ${a.id} and ${b.id} share cycle ${cycle}`,
        };
      }
    }
  }
  return { ok: true, plan: normalized };
}

function finish(plan: readonly EvolutionDirective[]): PlanEditResult {
  return validateEvolutionPlan(dense(plan));
}

function nextDirectiveId(plan: readonly EvolutionDirective[]): number | null {
  let max = 0;
  for (const directive of plan) {
    max = Math.max(max, clamp(directive.id, 1, MAX_SAFE_ID, 1));
  }
  return max < MAX_SAFE_ID ? max + 1 : null;
}

function replace(
  plan: readonly EvolutionDirective[],
  id: number,
  edit: (row: EvolutionDirective) => EvolutionDirective
): PlanEditResult {
  let found = false;
  const next = plan.map((row) => {
    if (row.id !== id) return cloneDirective(row);
    found = true;
    return edit(cloneDirective(row));
  });
  return found ? finish(next) : { ok: false, message: `Directive ${id} was not found` };
}

export function addPin(
  plan: readonly EvolutionDirective[],
  family: DirectiveFamily,
  cycle: number,
  morphTarget = "x"
): PlanEditResult {
  if (!familySet.has(family)) return { ok: false, message: "Unknown directive family" };
  if (plan.length >= MAX_EVOLUTION_DIRECTIVES) {
    return {
      ok: false,
      message: `dumka plan invalid: plan supports at most ${MAX_EVOLUTION_DIRECTIVES} directives, got ${plan.length + 1}`,
    };
  }
  const id = nextDirectiveId(plan);
  if (id === null) return { ok: false, message: "No directive ids remain" };
  const at = Math.max(1, integer(cycle, 1));
  return finish([
    ...plan,
    {
      id,
      order: plan.reduce((max, row) => Math.max(max, row.order), -1) + 1,
      enabled: true,
      fromCycle: at,
      toCycle: at,
      family,
      intensity: 25,
      pacing: DEFAULT_DIRECTIVE_PACING,
      scope: null,
      options: {
        ...DEFAULT_DIRECTIVE_OPTIONS,
        morphTarget: family === "morph" ? morphTarget : null,
      },
    },
  ]);
}

export function moveDirective(
  plan: readonly EvolutionDirective[],
  id: number,
  fromCycle: number,
  toCycle?: number
): PlanEditResult {
  return replace(plan, id, (row) => {
    const duration = row.toCycle - row.fromCycle;
    const from = Math.max(1, integer(fromCycle, row.fromCycle));
    return {
      ...row,
      fromCycle: from,
      toCycle: toCycle === undefined
        ? from + duration
        : Math.max(from, integer(toCycle, from)),
    };
  });
}

export function resizeRange(
  plan: readonly EvolutionDirective[],
  id: number,
  fromCycle: number,
  toCycle: number
): PlanEditResult {
  return replace(plan, id, (row) => {
    const from = Math.max(1, integer(fromCycle, row.fromCycle));
    return { ...row, fromCycle: from, toCycle: Math.max(from, integer(toCycle, from)) };
  });
}

export function setIntensity(
  plan: readonly EvolutionDirective[],
  id: number,
  intensity: number
): PlanEditResult {
  return replace(plan, id, (row) => ({
    ...row,
    intensity: clamp(intensity, 0, 100, row.intensity),
  }));
}

export function setPacing(
  plan: readonly EvolutionDirective[],
  id: number,
  pacing: DirectivePacing
): PlanEditResult {
  return replace(plan, id, (row) => ({
    ...row,
    pacing:
      row.magnitude?.mode === "perceptual"
        ? DEFAULT_DIRECTIVE_PACING
        : normalizeDirectivePacing(pacing, row.family),
  }));
}

export function setMagnitude(
  plan: readonly EvolutionDirective[],
  id: number,
  magnitude: DirectiveMagnitude | undefined
): PlanEditResult {
  return replace(plan, id, (row) => {
    const normalized = normalizeDirectiveMagnitude(magnitude, row.family);
    return withMagnitude(
      {
        ...row,
        pacing:
          normalized?.mode === "perceptual"
            ? DEFAULT_DIRECTIVE_PACING
            : row.pacing,
      },
      normalized
    );
  });
}

/** Turn one deterministic pin into an inclusive four-cycle gentle range. */
export function smoothDirectiveOverFourCycles(
  plan: readonly EvolutionDirective[],
  id: number
): PlanEditResult {
  const source = plan.find((row) => row.id === id);
  if (!source) return { ok: false, message: `Directive ${id} was not found` };
  if (source.family === "stochastic") {
    return {
      ok: false,
      message: "Stochastic directives use a per-cycle probability and cannot be smoothed",
    };
  }
  if (source.magnitude?.mode === "perceptual") {
    return {
      ok: false,
      message:
        "Perceptual directives target each active cycle and cannot use transition pacing",
    };
  }
  return replace(plan, id, (row) => ({
    ...row,
    toCycle: row.fromCycle + 3,
    pacing: "easeInOut",
  }));
}

export function setScope(
  plan: readonly EvolutionDirective[],
  id: number,
  scope: BeatRange | null
): PlanEditResult {
  return replace(plan, id, (row) => ({
    ...row,
    scope: scope
      ? {
          startBeat: Math.max(0, integer(scope.startBeat, 0)),
          lenBeats: Math.max(1, integer(scope.lenBeats, 1)),
        }
      : null,
  }));
}

export function setOptions(
  plan: readonly EvolutionDirective[],
  id: number,
  options: Partial<DirectiveOptions>
): PlanEditResult {
  return replace(plan, id, (row) => ({
    ...row,
    options: normalizeDirectiveOptions({ ...row.options, ...options }),
  }));
}

/** Set or clear one paired per-directive density corridor override. */
export function setDensityCorridor(
  plan: readonly EvolutionDirective[],
  id: number,
  corridor: { floor: number; ceiling: number } | null
): PlanEditResult {
  return replace(plan, id, (row) => ({
    ...row,
    options: normalizeDirectiveOptions({
      ...row.options,
      densityFloor: corridor?.floor ?? null,
      densityCeiling: corridor?.ceiling ?? null,
    }),
  }));
}

/** Set or clear one paired per-directive attack-depth corridor override. */
export function setComplexityCorridor(
  plan: readonly EvolutionDirective[],
  id: number,
  corridor: { floor: number; ceiling: number } | null
): PlanEditResult {
  return replace(plan, id, (row) => ({
    ...row,
    options: normalizeDirectiveOptions({
      ...row.options,
      complexityFloor: corridor?.floor ?? null,
      complexityCeiling: corridor?.ceiling ?? null,
    }),
  }));
}

export function toggleEnabled(
  plan: readonly EvolutionDirective[],
  id: number
): PlanEditResult {
  return replace(plan, id, (row) => ({ ...row, enabled: !row.enabled }));
}

export function reorder(
  plan: readonly EvolutionDirective[],
  id: number,
  order: number
): PlanEditResult {
  const normalized = dense(plan);
  const index = normalized.findIndex((row) => row.id === id);
  if (index < 0) return { ok: false, message: `Directive ${id} was not found` };
  const [row] = normalized.splice(index, 1);
  normalized.splice(clamp(order, 0, normalized.length, index), 0, row!);
  return validateEvolutionPlan(
    normalized.map((directive, denseOrder) => ({ ...directive, order: denseOrder }))
  );
}

export function removeDirective(
  plan: readonly EvolutionDirective[],
  id: number
): PlanEditResult {
  if (!plan.some((row) => row.id === id)) {
    return { ok: false, message: `Directive ${id} was not found` };
  }
  return finish(plan.filter((row) => row.id !== id));
}

export function duplicateDirective(
  plan: readonly EvolutionDirective[],
  id: number,
  fromCycle: number
): PlanEditResult {
  if (plan.length >= MAX_EVOLUTION_DIRECTIVES) {
    return {
      ok: false,
      message: `dumka plan invalid: plan supports at most ${MAX_EVOLUTION_DIRECTIVES} directives, got ${plan.length + 1}`,
    };
  }
  const base = normalizeEvolutionPlan(plan);
  const source = base.find((row) => row.id === id);
  if (!source) return { ok: false, message: `Directive ${id} was not found` };
  const nextId = nextDirectiveId(base);
  if (nextId === null) return { ok: false, message: "No directive ids remain" };
  const from = Math.max(1, integer(fromCycle, source.fromCycle));
  return finish([
    ...base,
    {
      ...cloneDirective(source),
      id: nextId,
      order: base.length,
      fromCycle: from,
      toCycle: from + source.toCycle - source.fromCycle,
    },
  ]);
}
