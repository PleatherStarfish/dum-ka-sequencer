import type {
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
  "stochastic",
] as const;

/** Mirrors cseq-rhythm's public MAX_EVOLUTION_DIRECTIVES validation bound. */
export const MAX_EVOLUTION_DIRECTIVES = 256;
export const MAX_PERCEPTUAL_DISTANCE_MILLI = 100_000;
export const MAX_PERCEPTUAL_OPERATIONS = 256;
/** Mirrors the engine's cumulative, lifetime prefix-scoring admission bound. */
export const MAX_PERCEPTUAL_SCORING_WORK = 4_096;

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
  stochastic: "Stochastic",
};

export const DEFAULT_DIRECTIVE_OPTIONS: Readonly<DirectiveOptions> = {
  barlowTemperature: null,
  fillComplexity: null,
  densityFloor: null,
  densityCeiling: null,
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

export function normalizeDirectiveOptions(
  value: Partial<DirectiveOptions> | null | undefined
): DirectiveOptions {
  const source = value ?? {};
  const densityFloor = normalizeOverride(source.densityFloor, 0, 100);
  const densityCeiling = normalizeOverride(source.densityCeiling, 0, 100);
  const corridorPaired = densityFloor !== null && densityCeiling !== null;
  return {
    barlowTemperature: normalizeOverride(source.barlowTemperature, 0, 100),
    fillComplexity: normalizeOverride(source.fillComplexity, 0, 100),
    densityFloor: corridorPaired ? Math.min(densityFloor, densityCeiling) : null,
    densityCeiling: corridorPaired ? Math.max(densityFloor, densityCeiling) : null,
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
      options: normalizeDirectiveOptions(row.options),
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

export function validateEvolutionPlan(plan: readonly EvolutionDirective[]): PlanEditResult {
  if (plan.length > MAX_EVOLUTION_DIRECTIVES) {
    return {
      ok: false,
      message: `dumka plan invalid: plan supports at most ${MAX_EVOLUTION_DIRECTIVES} directives, got ${plan.length}`,
    };
  }
  const normalized = normalizeEvolutionPlan(plan);
  const workError = perceptualScoringWorkError(normalized);
  if (workError !== null) {
    return { ok: false, message: workError };
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
  cycle: number
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
      options: { ...DEFAULT_DIRECTIVE_OPTIONS },
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
