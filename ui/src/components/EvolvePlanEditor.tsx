import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import type {
  CurveProperty,
  DumkaPropertyProfile,
  EvolutionCurve,
  GeneratorPreview,
  MissReason,
  PropertyCurve,
} from "../bridge";
import { analyzeDumkaPattern, compileDumkaPattern } from "../dumkaPattern";
import {
  dumkaSubdivisionLevels,
  type DumkaSubdivisionLevelDescriptor,
} from "../dumkaMetrics";
import {
  MAX_CURVE_OPERATIONS,
  upsertCurvePoint,
  setCurveSettings,
  removeCurvePoint,
  curveTargetMilliAt,
  propertyCurveTargetMilliAt,
  propertyCurveBandAt,
  upsertPropertyCurvePoint,
  removePropertyCurvePoint,
  setPropertyCurveSettings,
  validatePropertyCurveConfiguration,
  DEFAULT_EVOLUTION_CURVE,
  DIRECTIVE_FAMILIES,
  DIRECTIVE_FAMILY_LABELS,
  DIRECTIVE_PACING_LABELS,
  DEFAULT_PERCEPTUAL_MAGNITUDE,
  MAX_EVOLUTION_DIRECTIVES,
  MAX_PERCEPTUAL_OPERATIONS,
  MAX_PERCEPTUAL_SCORING_WORK,
  addPin,
  duplicateDirective,
  moveDirective,
  perceptualScoringWork,
  removeDirective,
  reorder,
  resizeRange,
  setIntensity,
  setMagnitude,
  setComplexityCorridor,
  setDensityCorridor,
  setOptions,
  setPacing,
  setScope,
  smoothDirectiveOverFourCycles,
  toggleEnabled,
  subdivisionLevelValidationError,
  validateEvolutionPlan,
  type DirectiveFamily,
  type DirectiveOptions,
  type DirectivePacing,
  type DirectiveTraceEntry,
  type EvolutionDirective,
  type PlanEditResult,
} from "../dumkaEvolvePlan";
import { NumericField } from "../NumericField";
import { MAX_STOPPED_PREVIEW_CYCLE } from "../timelineModel";
import { RhythmBuilderMiniBlock } from "./RhythmBuilder";

const CELL_WIDTH = 54;
const MIN_CELL_WIDTH = 30;
const MAX_CELL_WIDTH = 104;
const LANE_LABEL_WIDTH = 112;
const MIN_VIEW_CYCLES = 16;
const TRAILING_CYCLES = 4;
const VIEWPORT_OVERSCAN = 3;

/**
 * The property lanes (M3.97), rendered top-to-bottom under the pacing lane.
 * Each plots its functional's realized trajectory (0..=100_000 milliunits) per
 * cycle from the preview's `propertyProfile`, and — when the curve is enabled —
 * lets the user DRAW a target level: click a cell to place a point, shift-click
 * to remove one. Density and Complexity also shade their effective corridor
 * rail. `property` is the wire enum a drawn curve is keyed by; `key` is the
 * realized functional field on the profile.
 */
const PROPERTY_LANES: ReadonlyArray<{
  property: CurveProperty;
  key: keyof DumkaPropertyProfile;
  label: string;
  modifier: string;
  band: "density" | "complexity" | null;
}> = [
  {
    property: "density",
    key: "densityMilli",
    label: "Density",
    modifier: "is-density",
    band: "density",
  },
  {
    property: "complexity",
    key: "complexityMilli",
    label: "Complexity",
    modifier: "is-complexity",
    band: "complexity",
  },
  {
    property: "syncopation",
    key: "syncopationMilli",
    label: "Syncopation",
    modifier: "is-syncopation",
    band: null,
  },
  {
    property: "evenness",
    key: "evennessMilli",
    label: "Evenness",
    modifier: "is-evenness",
    band: null,
  },
  {
    property: "occupancy",
    key: "occupancyMilli",
    label: "Occupancy",
    modifier: "is-occupancy",
    band: null,
  },
  {
    property: "diversity",
    key: "diversityMilli",
    label: "Diversity",
    modifier: "is-diversity",
    band: null,
  },
];

/** Short human labels for the engine's steering-miss reasons (M3.97 §5),
 * surfaced in a lane cell's tooltip when its realized line misses a drawn band. */
const MISS_REASON_LABELS: Record<MissReason, string> = {
  noReducingCandidate: "no operator helped",
  pacingCapped: "pacing capped",
  budgetCapped: "budget spent",
  projection: "structurally blocked",
  railBlocked: "hard rail blocked",
};

export interface EvolutionCachedPreview {
  cycle: number;
  preview: Pick<
    GeneratorPreview,
    | "spans"
    | "densityCorridor"
    | "cycleDistance"
    | "workingSubdivision"
    | "stateComplexityMilli"
    | "stateDepthDiversityMilli"
    | "complexityCorridor"
    | "propertyProfile"
    | "curveMisses"
  >;
}

export type EvolutionInheritedOptions = Partial<
  Pick<
    DirectiveOptions,
    | "barlowTemperature"
    | "fillComplexity"
    | "densityFloor"
    | "densityCeiling"
    | "complexityFloor"
    | "complexityCeiling"
    | "placementBias"
    | "subdivisionLevel"
    | "euclidMaxRun"
    | "euclidInvert"
    | "euclidRestPolicy"
  >
>;

export interface EvolvePlanEditorProps {
  plan: readonly EvolutionDirective[];
  planLengthCycles: number;
  totalBeats: number;
  /** Beat count compiled from the Dum-Ka seed. Unlike totalBeats, this stays
   * authoritative while authored score structure is awaiting Apply. */
  seedTotalBeats?: number;
  disabled?: boolean;
  /** Cycle currently displayed by the stopped preview/scrubber. */
  previewCycle?: number;
  cachedPreviews?: readonly EvolutionCachedPreview[];
  trace?: readonly DirectiveTraceEntry[];
  inheritedOptions?: EvolutionInheritedOptions;
  initialSelectedId?: number | null;
  onPlanChange: (plan: EvolutionDirective[]) => void;
  onPlanLengthCyclesChange?: (cycles: number) => void;
  onPreviewCycleChange?: (cycle: number) => void;
  onAuditionCycle?: (cycle: number, comparison: "before" | "after") => void;
  onVisibleCycleRangeChange?: (fromCycle: number, toCycle: number) => void;
  densityFloor?: number;
  densityCeiling?: number;
  complexityFloor?: number;
  complexityCeiling?: number;
  workingSubdivision?: number;
  /** Enabled palette primes; the only valid subdivisionLevel filter values. */
  subdivisionPalette?: readonly number[];
  /** Composition-level evolution curve; edited via the Curve card and by
   * clicking in the step-size lane while the curve is enabled. */
  curve?: EvolutionCurve;
  onCurveChange?: (curve: EvolutionCurve) => void;
  /** Drawn per-property level curves (M3.97 §2), edited by clicking a property
   * lane. Empty means no steering — the lanes stay read-only realized plots. */
  propertyCurves?: readonly PropertyCurve[];
  onPropertyCurvesChange?: (curves: PropertyCurve[]) => void;
}

type DragMode = "move" | "resize-start" | "resize-end";

interface DragState {
  id: number;
  pointerId: number;
  mode: DragMode;
  startClientX: number;
  originalFrom: number;
  originalTo: number;
  duplicate: boolean;
}

interface RulerPanState {
  pointerId: number;
  startClientX: number;
  startScrollLeft: number;
}

interface VisibleCycleRange {
  fromCycle: number;
  toCycle: number;
}

const familyOptionFields: Partial<
  Record<DirectiveFamily, readonly (keyof DirectiveOptions)[]>
> = {
  barlowRemove: ["barlowTemperature", "placementBias", "subdivisionLevel"],
  barlowAdd: ["barlowTemperature", "placementBias", "subdivisionLevel"],
  syncopate: ["subdivisionLevel"],
  desyncopate: ["subdivisionLevel"],
  fragment: ["fillComplexity", "subdivisionLevel"],
  consolidate: ["subdivisionLevel"],
  euclid: [
    "euclidMaxRun",
    "euclidInvert",
    "euclidRestPolicy",
    "subdivisionLevel",
  ],
  rotate: ["rotateDirection"],
  morph: ["morphTarget"],
};

function directiveTitle(row: EvolutionDirective): string {
  const magnitude =
    row.magnitude?.mode === "perceptual"
      ? `${formatPerceptualScore(row.magnitude.targetMilli)} perceptual target`
      : `${row.intensity}%`;
  if (row.fromCycle === row.toCycle) {
    return `${DIRECTIVE_FAMILY_LABELS[row.family]}, cycle ${row.fromCycle}, ${magnitude}`;
  }
  if (row.magnitude?.mode === "perceptual") {
    return `${DIRECTIVE_FAMILY_LABELS[row.family]}, cycles ${row.fromCycle} through ${row.toCycle}, ${magnitude}`;
  }
  return `${DIRECTIVE_FAMILY_LABELS[row.family]}, cycles ${row.fromCycle} through ${row.toCycle}, ${magnitude}, ${DIRECTIVE_PACING_LABELS[row.pacing].toLowerCase()}`;
}

function formatPerceptualScore(milli: number): string {
  return (milli / 1_000).toFixed(1);
}

function transitionHelp(row: EvolutionDirective): string {
  const cycles = row.toCycle - row.fromCycle + 1;
  if (row.pacing === "linear") {
    return `One ${row.intensity}% target spread evenly across ${cycles} cycles.`;
  }
  if (row.pacing === "easeInOut") {
    return `One ${row.intensity}% target, with smaller steps near the start and finish.`;
  }
  return `${row.intensity}% at each of ${cycles} cycles.`;
}

function cycleFromPointer(
  event: PointerEvent<HTMLElement>,
  scroller: HTMLElement,
  cellWidth: number
): number {
  const rect = scroller.getBoundingClientRect();
  const x = event.clientX - rect.left + scroller.scrollLeft - LANE_LABEL_WIDTH;
  return Math.max(1, Math.floor(x / cellWidth));
}

function firstAvailableCycle(
  plan: readonly EvolutionDirective[],
  family: DirectiveFamily,
  extent: number
): number {
  for (let cycle = 1; cycle <= extent; cycle += 1) {
    if (
      !plan.some(
        (row) =>
          row.family === family &&
          cycle >= row.fromCycle &&
          cycle <= row.toCycle
      )
    ) {
      return cycle;
    }
  }
  return extent + 1;
}

function directiveOwnsCycle(
  row: EvolutionDirective,
  cycle: number,
  seedBeats: number
): boolean {
  if (!row.enabled || cycle < row.fromCycle || cycle > row.toCycle) return false;
  if (row.scope === null) return true;
  return (
    row.scope.startBeat >= 0 &&
    row.scope.lenBeats > 0 &&
    row.scope.startBeat + row.scope.lenBeats <= seedBeats
  );
}

function firstAvailableSpan(
  plan: readonly EvolutionDirective[],
  family: DirectiveFamily,
  duration: number,
  fromCycle: number,
  throughCycle: number
): number | null {
  const start = Math.max(1, fromCycle);
  const lastStart = throughCycle - duration + 1;
  for (let cycle = start; cycle <= lastStart; cycle += 1) {
    const end = cycle + duration - 1;
    if (
      !plan.some(
        (row) =>
          row.family === family &&
          cycle <= row.toCycle &&
          end >= row.fromCycle
      )
    ) {
      return cycle;
    }
  }
  return null;
}

function previewMetrics(entry: EvolutionCachedPreview): {
  onsets: number;
  density: number;
} {
  let onsets = 0;
  let structuralSlots = 0;
  for (const span of entry.preview.spans) {
    structuralSlots += Math.max(0, span.spanLen);
    for (const cell of span.cells) {
      if (!cell.rest && !cell.tiedFromPrevious) onsets += 1;
    }
  }
  return {
    onsets,
    density: structuralSlots === 0 ? 0 : onsets / structuralSlots,
  };
}

function traceEntryLabel(
  entry: DirectiveTraceEntry,
  directive?: EvolutionDirective
): string {
  const corridor = entry.corridorClamp
    ? `, ${entry.corridorClamp.limit} corridor ${entry.corridorClamp.densityPercent}%`
    : "";
  const complexityCorridor = entry.complexityCorridorClamp
    ? `, ${entry.complexityCorridorClamp.limit} complexity corridor ${formatPerceptualScore(entry.complexityCorridorClamp.complexityMilli)}`
    : "";
  const perceptual = entry.perceptual
    ? `, realized ${formatPerceptualScore(entry.perceptual.actualMilli)} vs target ${formatPerceptualScore(entry.perceptual.targetMilli)} ±${formatPerceptualScore(entry.perceptual.toleranceMilli)}${entry.perceptual.reached ? ", within tolerance" : entry.perceptual.exhausted ? ", nearest legal step" : ""}`
    : "";
  const choices = entry.steeringChoices?.length
    ? `, chose ${entry.steeringChoices
        .map(
          (choice) =>
            `${DIRECTIVE_FAMILY_LABELS[choice.family]} for ${choice.chosenFor}`
        )
        .join("; ")}`
    : "";
  const result = `${DIRECTIVE_FAMILY_LABELS[entry.family]}: ${entry.applied}/${entry.requested}${corridor}${complexityCorridor}${perceptual}${choices}${entry.skipped === "none" ? "" : `, ${entry.skipped}`}`;
  if (
    !directive ||
    directive.pacing === "perCycle" ||
    directive.fromCycle === directive.toCycle ||
    entry.cycle < directive.fromCycle ||
    entry.cycle > directive.toCycle
  ) {
    return result;
  }
  const step = entry.cycle - directive.fromCycle + 1;
  const steps = directive.toCycle - directive.fromCycle + 1;
  return `${result} this cycle · ${DIRECTIVE_PACING_LABELS[directive.pacing]} · step ${step} of ${steps}`;
}

function scopeRunFromBeat(
  row: EvolutionDirective,
  beat: number,
  extend: boolean
): { startBeat: number; lenBeats: number } {
  if (!extend || row.scope === null) return { startBeat: beat, lenBeats: 1 };
  const anchor = row.scope.startBeat;
  return {
    startBeat: Math.min(anchor, beat),
    lenBeats: Math.abs(beat - anchor) + 1,
  };
}

function morphTargetStatus(
  target: string | null,
  seedTotalBeats: number,
  workingSubdivision: number,
  directiveId: number
): { ok: true; summary: string } | { ok: false; message: string } {
  if (!target) {
    return {
      ok: false,
      message: `dumka plan invalid: directive ${directiveId} morph requires options.morphTarget`,
    };
  }
  const analysis = analyzeDumkaPattern(target);
  if (!analysis.ok) {
    return {
      ok: false,
      message: `dumka pattern parse error at line ${analysis.issue.line}, column ${analysis.issue.col}: ${analysis.issue.message}`,
    };
  }
  if (analysis.required.cycleBeats !== seedTotalBeats) {
    return {
      ok: false,
      message: `dumka plan invalid: directive ${directiveId} morph target spans ${analysis.required.cycleBeats} beats but the seed spans ${seedTotalBeats}`,
    };
  }
  const compiled = compileDumkaPattern(target);
  if (compiled.ok && compiled.compiled.events.length === 0) {
    return {
      ok: false,
      message: `dumka plan invalid: directive ${directiveId} morph target must contain at least one sounding onset`,
    };
  }
  if (workingSubdivision % analysis.required.subdivision !== 0) {
    return {
      ok: false,
      message: `dumka plan invalid: directive ${directiveId} morph target needs Subdivision ${analysis.required.subdivision} which does not divide working Subdivision ${workingSubdivision}`,
    };
  }
  return {
    ok: true,
    summary: `${analysis.required.cycleBeats} beats · Subdivision ${analysis.required.subdivision} · exact on working ${workingSubdivision}`,
  };
}

function subdivisionLevelLabel(
  level: DumkaSubdivisionLevelDescriptor
): string {
  return `Prime ${level.prime} · 1/${level.prime}-family positions`;
}

function ScopeGlyph({ row, totalBeats }: { row: EvolutionDirective; totalBeats: number }) {
  if (row.scope === null || totalBeats <= 0) return null;
  const end = row.scope.startBeat + row.scope.lenBeats;
  return (
    <span className="evolve-plan-scope-glyph" aria-label={`Beats ${row.scope.startBeat + 1} through ${end}`}>
      {Array.from({ length: totalBeats }, (_, beat) => (
        <i
          key={beat}
          className={beat >= row.scope!.startBeat && beat < end ? "is-covered" : undefined}
        />
      ))}
    </span>
  );
}

function NullableOptionField({
  label,
  value,
  min,
  max,
  disabled,
  inheritedValue,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  disabled: boolean;
  inheritedValue?: number | null;
  onChange: (value: number | null) => void;
}) {
  const inherited = value === null;
  return (
    <div className="evolve-plan-option-row">
      <label>
        <input
          type="checkbox"
          aria-label={`Override ${label}`}
          checked={!inherited}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.currentTarget.checked ? inheritedValue ?? min : null
            )
          }
        />
        <span>{label}</span>
      </label>
      {inherited ? (
        <span className="evolve-plan-inherited-value">
          Inherit global
          {inheritedValue === undefined || inheritedValue === null
            ? ""
            : ` · ${inheritedValue}`}
        </span>
      ) : (
        <NumericField
          aria-label={label}
          value={value}
          min={min}
          max={max}
          step={1}
          size="compact"
          disabled={disabled}
          onValueCommit={onChange}
        />
      )}
    </div>
  );
}

export function EvolvePlanEditor({
  plan,
  planLengthCycles,
  totalBeats,
  seedTotalBeats,
  disabled = false,
  previewCycle = 0,
  cachedPreviews = [],
  trace = [],
  inheritedOptions = {},
  initialSelectedId = null,
  onPlanChange,
  onPlanLengthCyclesChange,
  onPreviewCycleChange,
  onAuditionCycle,
  onVisibleCycleRangeChange,
  densityFloor = 0,
  densityCeiling = 100,
  complexityFloor = 0,
  complexityCeiling = 100_000,
  workingSubdivision = 1,
  subdivisionPalette = [],
  curve = DEFAULT_EVOLUTION_CURVE,
  onCurveChange,
  propertyCurves = [],
  onPropertyCurvesChange,
}: EvolvePlanEditorProps) {
  const morphSeedBeats = seedTotalBeats ?? totalBeats;
  const subdivisionLevels = useMemo(
    () => dumkaSubdivisionLevels(subdivisionPalette),
    [subdivisionPalette]
  );
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId);
  const [usedOnly, setUsedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [curveError, setCurveError] = useState<string | null>(null);
  const applyCurve = (result: { ok: true; curve: EvolutionCurve } | { ok: false; message: string }) => {
    if (!onCurveChange) return;
    if (!result.ok) {
      setCurveError(result.message);
      return;
    }
    const combined = validatePropertyCurveConfiguration(
      propertyCurves,
      densityFloor,
      densityCeiling,
      complexityFloor,
      complexityCeiling,
      plan,
      result.curve
    );
    if (combined) {
      setCurveError(combined);
      return;
    }
    setCurveError(null);
    onCurveChange(result.curve);
  };
  const [propertyCurveError, setPropertyCurveError] = useState<string | null>(
    null
  );
  // Commit a drawn property-curve edit, but only if the whole set still passes
  // the engine's validation (uniqueness, bounds, and the static corridor
  // intersection) — a rejected edit surfaces the pinned message, unchanged.
  const applyPropertyCurves = (next: PropertyCurve[]) => {
    if (!onPropertyCurvesChange) return false;
    const message = validatePropertyCurveConfiguration(
      next,
      densityFloor,
      densityCeiling,
      complexityFloor,
      complexityCeiling,
      plan,
      curve
    );
    if (message) {
      setPropertyCurveError(message);
      return false;
    }
    setPropertyCurveError(null);
    onPropertyCurvesChange(next);
    return true;
  };
  const propertyCurveByProperty = useMemo(
    () => new Map(propertyCurves.map((entry) => [entry.property, entry])),
    [propertyCurves]
  );
  const [comparison, setComparison] = useState<"before" | "after">("after");
  const [selectedProperty, setSelectedProperty] =
    useState<CurveProperty>("density");
  const selectedPropertyCurve =
    propertyCurveByProperty.get(selectedProperty) ?? null;
  const selectedPropertyLabel =
    PROPERTY_LANES.find((lane) => lane.property === selectedProperty)?.label ??
    selectedProperty;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [cellWidth, setCellWidth] = useState(CELL_WIDTH);
  const [visibleRange, setVisibleRange] = useState<VisibleCycleRange>({
    fromCycle: 0,
    toCycle: MIN_VIEW_CYCLES,
  });
  const [rulerPanning, setRulerPanning] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // In-progress freehand automation draw on a property lane. The draft
  // accumulates points across the drag so each pointermove commits the latest
  // line (not a stale render-time snapshot); bottom/height come from the
  // captured cell, whose row bounds match the whole lane.
  const propertyDrawRef = useRef<{
    property: CurveProperty;
    pointerId: number;
    bottom: number;
    height: number;
    draft: readonly PropertyCurve[];
  } | null>(null);
  // An in-progress drag of a single existing point handle. `moved` gates the
  // click-vs-drag decision: a release without crossing the threshold is a
  // click (delete); a drag repositions the point's level.
  const handleDragRef = useRef<{
    property: CurveProperty;
    cycle: number;
    pointerId: number;
    bottom: number;
    height: number;
    startX: number;
    startY: number;
    moved: boolean;
    draft: readonly PropertyCurve[];
  } | null>(null);
  const rulerPanRef = useRef<RulerPanState | null>(null);
  const pendingZoomScrollLeftRef = useRef<number | null>(null);
  const pendingTransitionFocusIdRef = useRef<number | null>(null);
  const transitionSelectRef = useRef<HTMLSelectElement | null>(null);
  const visibleRangeCallbackRef = useRef(onVisibleCycleRangeChange);

  const selected = plan.find((row) => row.id === selectedId) ?? null;
  const perceptualMagnitude =
    selected?.magnitude?.mode === "perceptual" ? selected.magnitude : null;
  const selectedPerceptualTrace = selected
    ? trace.find(
        (entry) =>
          entry.cycle === previewCycle &&
          entry.directiveId === selected.id &&
          entry.perceptual
      )?.perceptual ?? null
    : null;
  const perceptualWorkUsed = perceptualScoringWork(plan);
  const perceptualWorkRemaining =
    BigInt(MAX_PERCEPTUAL_SCORING_WORK) - perceptualWorkUsed;
  const planAtCapacity = plan.length >= MAX_EVOLUTION_DIRECTIVES;
  const lastPreviewableCycle = plan.reduce(
    (max, row) => Math.max(max, Math.min(MAX_STOPPED_PREVIEW_CYCLE, row.toCycle)),
    0
  );
  const lastPropertyCurveCycle = propertyCurves.reduce(
    (max, propertyCurve) =>
      Math.max(max, propertyCurve.points.at(-1)?.cycle ?? 0),
    0
  );
  const requestedExtent = Math.max(
    MIN_VIEW_CYCLES,
    Math.round(planLengthCycles),
    Math.min(
      MAX_STOPPED_PREVIEW_CYCLE,
      Math.max(lastPreviewableCycle, lastPropertyCurveCycle) + TRAILING_CYCLES
    )
  );
  const extent = Math.min(MAX_STOPPED_PREVIEW_CYCLE, requestedExtent);
  const outOfWindowDirectiveCount = plan.filter(
    (row) => row.fromCycle > extent || row.toCycle > extent
  ).length;
  const outOfWindowPropertyPointCount = propertyCurves.reduce(
    (count, propertyCurve) =>
      count +
      propertyCurve.points.filter((point) => point.cycle > extent).length,
    0
  );
  const renderFromCycle = Math.max(
    0,
    Math.min(extent, visibleRange.fromCycle - VIEWPORT_OVERSCAN)
  );
  const renderToCycle = Math.max(
    renderFromCycle,
    Math.min(extent, visibleRange.toCycle + VIEWPORT_OVERSCAN)
  );
  const cycles = useMemo(
    () =>
      Array.from(
        { length: renderToCycle - renderFromCycle + 1 },
        (_, offset) => renderFromCycle + offset
      ),
    [renderFromCycle, renderToCycle]
  );
  const families = usedOnly
    ? DIRECTIVE_FAMILIES.filter((family) => plan.some((row) => row.family === family))
    : DIRECTIVE_FAMILIES;
  const previewByCycle = useMemo(
    () =>
      new Map(
        cachedPreviews.map((entry) => [
          entry.cycle,
          {
            ...previewMetrics(entry),
            corridor: entry.preview.densityCorridor ?? null,
            distanceMilli: entry.preview.cycleDistance?.distanceMilli ?? null,
            complexityMilli: entry.preview.stateComplexityMilli ?? null,
            depthDiversityMilli:
              entry.preview.stateDepthDiversityMilli ?? null,
            complexityCorridor: entry.preview.complexityCorridor ?? null,
            propertyProfile: entry.preview.propertyProfile ?? null,
            curveMisses: entry.preview.curveMisses ?? [],
            workingSubdivision:
              entry.preview.workingSubdivision ?? workingSubdivision,
          },
        ])
      ),
    [cachedPreviews, workingSubdivision]
  );
  const traceByCycle = useMemo(() => {
    const map = new Map<number, DirectiveTraceEntry[]>();
    for (const entry of trace) {
      const entries = map.get(entry.cycle) ?? [];
      entries.push(entry);
      map.set(entry.cycle, entries);
    }
    return map;
  }, [trace]);
  const directiveById = useMemo(
    () => new Map(plan.map((directive) => [directive.id, directive])),
    [plan]
  );
  // Perceptual step targets per cycle: the sum of every enabled perceptual
  // row covering the cycle (cross-family rows may stack; their increments
  // are sequential, so the whole-cycle intent is additive).
  const perceptualTargetByCycle = useMemo(() => {
    const map = new Map<number, { targetMilli: number; toleranceMilli: number; rows: number }>();
    // Engine precedence mirrored: at cycles with any enabled directive the
    // directives own the cycle (curve suppressed); elsewhere the curve's
    // interpolated target is the band.
    const directiveCoveredCycles = new Set<number>();
    for (const row of plan) {
      for (let cycle = row.fromCycle; cycle <= row.toCycle; cycle += 1) {
        if (directiveOwnsCycle(row, cycle, morphSeedBeats)) {
          directiveCoveredCycles.add(cycle);
        }
      }
    }
    if (curve.enabled && curve.points.length > 0) {
      const first = curve.points[0]!.cycle;
      const last = curve.points[curve.points.length - 1]!.cycle;
      for (let cycle = first; cycle <= last; cycle += 1) {
        if (directiveCoveredCycles.has(cycle)) continue;
        const target = curveTargetMilliAt(curve, cycle);
        map.set(cycle, {
          targetMilli: target,
          toleranceMilli: curve.toleranceMilli,
          rows: 0,
        });
      }
    }
    for (const row of plan) {
      if (!row.enabled || row.magnitude?.mode !== "perceptual") continue;
      for (let cycle = row.fromCycle; cycle <= row.toCycle; cycle += 1) {
        if (!directiveOwnsCycle(row, cycle, morphSeedBeats)) continue;
        const current = map.get(cycle) ?? {
          targetMilli: 0,
          toleranceMilli: 0,
          rows: 0,
        };
        current.targetMilli += row.magnitude.targetMilli;
        current.toleranceMilli += row.magnitude.toleranceMilli;
        current.rows += 1;
        map.set(cycle, current);
      }
    }
    return map;
  }, [curve, morphSeedBeats, plan]);
  const maxVisibleStepMilli = useMemo(() => {
    let max = 1;
    for (const [cycle, metrics] of previewByCycle) {
      if (
        cycle >= visibleRange.fromCycle &&
        cycle <= visibleRange.toCycle &&
        metrics.distanceMilli !== null
      ) {
        max = Math.max(max, metrics.distanceMilli);
      }
    }
    for (const [cycle, target] of perceptualTargetByCycle) {
      if (cycle >= visibleRange.fromCycle && cycle <= visibleRange.toCycle) {
        max = Math.max(max, target.targetMilli + target.toleranceMilli);
      }
    }
    return max;
  }, [
    perceptualTargetByCycle,
    previewByCycle,
    visibleRange.fromCycle,
    visibleRange.toCycle,
  ]);

  useEffect(() => {
    if (selectedId !== null && !plan.some((row) => row.id === selectedId)) {
      setSelectedId(null);
    }
  }, [plan, selectedId]);

  useLayoutEffect(() => {
    if (
      pendingTransitionFocusIdRef.current === selected?.id &&
      selected.fromCycle < selected.toCycle
    ) {
      transitionSelectRef.current?.focus();
      pendingTransitionFocusIdRef.current = null;
    }
  }, [selected]);

  const measureVisibleCycleRange = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const viewportWidth =
      scroller.clientWidth > 0
        ? scroller.clientWidth
        : LANE_LABEL_WIDTH + (MIN_VIEW_CYCLES + 1) * cellWidth;
    const fromCycle = Math.max(
      0,
      Math.min(
        extent,
        Math.floor((scroller.scrollLeft - LANE_LABEL_WIDTH) / cellWidth)
      )
    );
    const toCycle = Math.max(
      fromCycle,
      Math.min(
        extent,
        Math.ceil(
          (scroller.scrollLeft + viewportWidth - LANE_LABEL_WIDTH) / cellWidth
        )
      )
    );
    setVisibleRange((current) =>
      current.fromCycle === fromCycle && current.toCycle === toCycle
        ? current
        : { fromCycle, toCycle }
    );
  }, [cellWidth, extent]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller && pendingZoomScrollLeftRef.current !== null) {
      scroller.scrollLeft = Math.max(0, pendingZoomScrollLeftRef.current);
      pendingZoomScrollLeftRef.current = null;
    }
    measureVisibleCycleRange();
  }, [measureVisibleCycleRange]);

  useEffect(() => {
    const handleResize = () => measureVisibleCycleRange();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [measureVisibleCycleRange]);

  useEffect(() => {
    visibleRangeCallbackRef.current = onVisibleCycleRangeChange;
  }, [onVisibleCycleRangeChange]);

  useEffect(() => {
    visibleRangeCallbackRef.current?.(
      visibleRange.fromCycle,
      visibleRange.toCycle
    );
  }, [
    visibleRange.fromCycle,
    visibleRange.toCycle,
  ]);

  const previewAt = (cycle: number, mode: "before" | "after" = "after") => {
    setComparison(mode);
    onPreviewCycleChange?.(cycle);
    onAuditionCycle?.(cycle, mode);
  };

  const commit = (result: PlanEditResult, nextSelection = selectedId) => {
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    const contextual = validateEvolutionPlan(result.plan, subdivisionPalette);
    if (!contextual.ok) {
      setError(contextual.message);
      return false;
    }
    onPlanChange(contextual.plan);
    setSelectedId(nextSelection);
    setError(null);
    return true;
  };

  const select = (row: EvolutionDirective) => {
    setSelectedId(row.id);
    setError(null);
    previewAt(row.fromCycle);
  };

  const add = (family: DirectiveFamily, cycle: number) => {
    const result = addPin(
      plan,
      family,
      cycle,
      family === "morph"
        ? Array.from({ length: Math.max(1, morphSeedBeats) }, () => "x").join(" ")
        : undefined
    );
    const id = result.ok
      ? result.plan.find((row) => !plan.some((prior) => prior.id === row.id))?.id ??
        null
      : null;
    if (commit(result, id) && id !== null) {
      previewAt(Math.max(1, cycle));
    }
  };

  const nudgeSelected = (delta: number, resize = false) => {
    if (!selected || disabled) return;
    const result = resize
      ? resizeRange(plan, selected.id, selected.fromCycle, selected.toCycle + delta)
      : moveDirective(plan, selected.id, selected.fromCycle + delta);
    if (commit(result, selected.id) && result.ok) {
      const moved = result.plan.find((row) => row.id === selected.id);
      if (moved) previewAt(moved.fromCycle);
    }
  };

  const nudgeDirective = (row: EvolutionDirective, delta: number, resize = false) => {
    if (disabled) return;
    const result = resize
      ? resizeRange(plan, row.id, row.fromCycle, row.toCycle + delta)
      : moveDirective(plan, row.id, row.fromCycle + delta);
    if (commit(result, row.id) && result.ok) {
      const moved = result.plan.find((candidate) => candidate.id === row.id);
      if (moved) previewAt(moved.fromCycle);
    }
  };

  const removeById = (id: number) => {
    if (!disabled) commit(removeDirective(plan, id), null);
  };

  const removeSelected = () => {
    if (!selected || disabled) return;
    commit(removeDirective(plan, selected.id), null);
  };

  const duplicateSelected = () => {
    if (!selected || disabled) return;
    const duration = selected.toCycle - selected.fromCycle + 1;
    const target = firstAvailableSpan(
      plan,
      selected.family,
      duration,
      selected.toCycle + 1,
      MAX_STOPPED_PREVIEW_CYCLE
    );
    if (target === null) {
      setError(
        `No open ${duration}-cycle span remains through cycle ${MAX_STOPPED_PREVIEW_CYCLE.toLocaleString()}.`
      );
      return;
    }
    const result = duplicateDirective(plan, selected.id, target);
    const duplicateId = result.ok
      ? result.plan.find((row) => !plan.some((prior) => prior.id === row.id))?.id ??
        null
      : null;
    if (commit(result, duplicateId) && duplicateId !== null) {
      previewAt(target);
    }
  };

  const smoothSelected = () => {
    if (!selected || disabled || selected.family === "stochastic") return;
    const result = smoothDirectiveOverFourCycles(plan, selected.id);
    if (result.ok) pendingTransitionFocusIdRef.current = selected.id;
    if (commit(result, selected.id) && result.ok) {
      previewAt(selected.fromCycle);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.matches("input, select") ||
      (target.matches("button") && !target.matches(".evolve-plan-directive"))
    ) return;
    if ((event.key === "Delete" || event.key === "Backspace") && selected) {
      event.preventDefault();
      removeSelected();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      nudgeSelected(event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
    }
  };

  const beginDrag = (
    event: PointerEvent<HTMLButtonElement>,
    row: EvolutionDirective,
    mode: DragMode
  ) => {
    if (disabled) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    select(row);
    setDrag({
      id: row.id,
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      originalFrom: row.fromCycle,
      originalTo: row.toCycle,
      duplicate: event.altKey && mode === "move",
    });
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = Math.round((event.clientX - drag.startClientX) / cellWidth);
    if (delta !== 0) {
      const result =
        drag.mode === "resize-start"
          ? resizeRange(plan, drag.id, drag.originalFrom + delta, drag.originalTo)
          : drag.mode === "resize-end"
            ? resizeRange(plan, drag.id, drag.originalFrom, drag.originalTo + delta)
            : drag.duplicate
              ? duplicateDirective(plan, drag.id, drag.originalFrom + delta)
              : moveDirective(plan, drag.id, drag.originalFrom + delta);
      const nextId =
        drag.duplicate && result.ok
          ? result.plan.find((row) => !plan.some((prior) => prior.id === row.id))
              ?.id ?? drag.id
          : drag.id;
      if (commit(result, nextId) && result.ok) {
        const moved = result.plan.find((row) => row.id === nextId);
        if (moved) previewAt(moved.fromCycle);
      }
    }
    setDrag(null);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const rect = scroller.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const anchoredCycle =
        (scroller.scrollLeft + pointerX - LANE_LABEL_WIDTH) / cellWidth;
      const scale = Math.exp(-event.deltaY * 0.0025);
      const nextWidth = Math.max(
        MIN_CELL_WIDTH,
        Math.min(MAX_CELL_WIDTH, Math.round(cellWidth * scale))
      );
      if (nextWidth === cellWidth) return;
      pendingZoomScrollLeftRef.current =
        LANE_LABEL_WIDTH + anchoredCycle * nextWidth - pointerX;
      setCellWidth(nextWidth);
      return;
    }
    scroller.scrollLeft = Math.max(
      0,
      scroller.scrollLeft + event.deltaX + event.deltaY
    );
    measureVisibleCycleRange();
  };

  const beginRulerPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    rulerPanRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: scroller.scrollLeft,
    };
    setRulerPanning(true);
  };

  const moveRulerPan = (event: PointerEvent<HTMLDivElement>) => {
    const pan = rulerPanRef.current;
    const scroller = scrollerRef.current;
    if (!pan || !scroller || pan.pointerId !== event.pointerId) return;
    scroller.scrollLeft = Math.max(
      0,
      pan.startScrollLeft - (event.clientX - pan.startClientX)
    );
    measureVisibleCycleRange();
  };

  const endRulerPan = (event: PointerEvent<HTMLDivElement>) => {
    if (rulerPanRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    rulerPanRef.current = null;
    setRulerPanning(false);
  };

  const updateSelected = (
    operation: (row: EvolutionDirective) => PlanEditResult
  ) => {
    if (selected) commit(operation(selected), selected.id);
  };

  const selectedOptionFields = selected ? familyOptionFields[selected.family] ?? [] : [];
  const previewDepthDiversityMilli =
    previewByCycle.get(previewCycle)?.depthDiversityMilli ?? null;
  const selectedMorphStatus =
    selected?.family === "morph"
      ? morphTargetStatus(
          selected.options.morphTarget,
          morphSeedBeats,
          workingSubdivision,
          selected.id
        )
      : null;
  const currentSubdivisionLevelError = subdivisionLevelValidationError(
    plan,
    subdivisionPalette
  );

  return (
    <section
      className="evolve-plan-editor"
      aria-label="Evolution score"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <header className="evolve-plan-head">
        <div>
          <h2>Evolution score</h2>
          <p>Pins apply once. Ranges repeat a quota or pace one target across cycles.</p>
        </div>
        {previewDepthDiversityMilli !== null ? (
          <output
            className="evolve-plan-depth-insight"
            aria-label={`Cycle ${previewCycle} depth diversity ${formatPerceptualScore(previewDepthDiversityMilli)}`}
          >
            <span>Depth diversity</span>
            <b>{formatPerceptualScore(previewDepthDiversityMilli)}</b>
            <em>cycle {previewCycle}</em>
          </output>
        ) : null}
        <label className="evolve-plan-used-toggle">
          <input
            type="checkbox"
            checked={usedOnly}
            onChange={(event) => setUsedOnly(event.currentTarget.checked)}
          />
          <span>Used lanes only</span>
        </label>
        <label className="evolve-plan-length">
          <span>View cycles</span>
          <NumericField
            aria-label="Plan view cycles"
            value={extent}
            min={1}
            max={MAX_STOPPED_PREVIEW_CYCLE}
            step={1}
            size="compact"
            disabled={disabled || !onPlanLengthCyclesChange}
            onValueCommit={(value) => onPlanLengthCyclesChange?.(value)}
          />
        </label>
      </header>

      {outOfWindowDirectiveCount > 0 ? (
        <p className="evolve-plan-window-note" role="note">
          {outOfWindowDirectiveCount} directive
          {outOfWindowDirectiveCount === 1 ? "" : "s"} continue beyond the
          preview window at cycle {MAX_STOPPED_PREVIEW_CYCLE.toLocaleString()}.
          They remain authored and will run during playback.
        </p>
      ) : null}
      {outOfWindowPropertyPointCount > 0 ? (
        <p className="evolve-plan-window-note" role="note">
          {outOfWindowPropertyPointCount} property-curve point
          {outOfWindowPropertyPointCount === 1 ? "" : "s"} continue beyond the
          preview window at cycle {MAX_STOPPED_PREVIEW_CYCLE.toLocaleString()}.
          They remain authored and will run during playback.
        </p>
      ) : null}
      {planAtCapacity ? (
        <p className="evolve-plan-capacity-note" role="status">
          Plan limit reached · {MAX_EVOLUTION_DIRECTIVES} directives. Move,
          resize, or remove a directive before adding another.
        </p>
      ) : null}

      <div className="evolve-plan-workbench">
        <div
          className="evolve-plan-scroll"
          ref={scrollerRef}
          aria-label="Evolution score timeline"
          style={
            {
              "--evolve-cycle-count": extent + 1,
              "--evolve-cycle-width": `${cellWidth}px`,
            } as CSSProperties
          }
          onScroll={measureVisibleCycleRange}
          onWheel={handleWheel}
        >
          <div
            className={`evolve-plan-ruler${rulerPanning ? " is-panning" : ""}`}
            aria-label="Cycle ruler; drag to pan"
            onPointerDown={beginRulerPan}
            onPointerMove={moveRulerPan}
            onPointerUp={endRulerPan}
            onPointerCancel={endRulerPan}
          >
            <span className="evolve-plan-corner">Cycles</span>
            {cycles.map((cycle) => (
              <span
                key={cycle}
                className={cycle === 0 ? "is-seed" : undefined}
                style={{ gridColumn: cycle + 2 }}
              >
                {cycle === 0 ? "0 seed" : cycle}
              </span>
            ))}
          </div>

          <div className="evolve-plan-step-lane" aria-label="Pacing lane">
            <span className="evolve-plan-lane-name">Pacing</span>
            {cycles.map((cycle) => {
              const metrics = previewByCycle.get(cycle);
              const realized = metrics?.distanceMilli ?? null;
              const target = perceptualTargetByCycle.get(cycle) ?? null;
              const within =
                realized !== null &&
                target !== null &&
                Math.abs(realized - target.targetMilli) <= target.toleranceMilli;
              const stepLabel =
                realized === null
                  ? `Cycle ${cycle} step size not cached`
                  : target === null
                    ? `Cycle ${cycle} step size ${formatPerceptualScore(realized)}`
                    : `Cycle ${cycle} step size ${formatPerceptualScore(realized)}, target ${formatPerceptualScore(target.targetMilli)} ±${formatPerceptualScore(target.toleranceMilli)}${within ? ", within tolerance" : ", outside tolerance"}`;
              const scale = (value: number) =>
                Math.round(Math.min(1, value / maxVisibleStepMilli) * 100);
              return (
                <span
                  key={cycle}
                  className={`evolve-plan-step-cell${
                    target !== null
                      ? within
                        ? " is-within-target"
                        : realized !== null
                          ? " is-outside-target"
                          : ""
                      : ""
                  }${curve.enabled && onCurveChange ? " is-curve-editable" : ""}`}
                  role="group"
                  aria-label={stepLabel}
                  title={stepLabel}
                  style={{ gridColumn: cycle + 2 }}
                  onPointerDown={(event) => {
                    if (
                      event.button !== 0 ||
                      disabled ||
                      !onCurveChange ||
                      !curve.enabled ||
                      cycle < 1
                    ) {
                      return;
                    }
                    if (event.shiftKey) {
                      if (curve.points.some((point) => point.cycle === cycle)) {
                        applyCurve(removeCurvePoint(plan, curve, cycle));
                      }
                      return;
                    }
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const fraction =
                      bounds.height <= 0
                        ? 0
                        : Math.min(
                            1,
                            Math.max(
                              0,
                              (bounds.bottom - event.clientY) / bounds.height
                            )
                          );
                    // An empty lane has a degenerate y-scale (max 1 milli);
                    // clicks then place points against a 10.0 default
                    // ceiling so the first drawn arc is audible, not zero.
                    const clickScaleMilli = Math.max(
                      maxVisibleStepMilli,
                      10_000
                    );
                    applyCurve(
                      upsertCurvePoint(
                        plan,
                        curve,
                        cycle,
                        Math.round(fraction * clickScaleMilli)
                      )
                    );
                  }}
                >
                  {target !== null ? (
                    <i
                      className="evolve-plan-step-band"
                      aria-hidden="true"
                      style={{
                        bottom: `${scale(
                          Math.max(0, target.targetMilli - target.toleranceMilli)
                        )}%`,
                        height: `${Math.max(
                          2,
                          scale(target.targetMilli + target.toleranceMilli) -
                            scale(
                              Math.max(
                                0,
                                target.targetMilli - target.toleranceMilli
                              )
                            )
                        )}%`,
                      }}
                    />
                  ) : null}
                  {realized !== null ? (
                    <i
                      className="evolve-plan-step-bar"
                      aria-hidden="true"
                      style={{ height: `${Math.max(realized > 0 ? 2 : 1, scale(realized))}%` }}
                    />
                  ) : null}
                </span>
              );
            })}
          </div>

          {PROPERTY_LANES.map((lane) => {
            const laneCurve = propertyCurveByProperty.get(lane.property) ?? null;
            const editable = Boolean(onPropertyCurvesChange) && !disabled;
            return (
              <div
                key={lane.key}
                className={`evolve-plan-property-lane ${lane.modifier}${
                  editable ? " is-editable" : ""
                }${laneCurve?.enabled ? " is-drawn" : ""}`}
                aria-label={`${lane.label} lane`}
                onPointerDownCapture={() => setSelectedProperty(lane.property)}
                onFocusCapture={() => setSelectedProperty(lane.property)}
              >
                <span className="evolve-plan-lane-name">{lane.label}</span>
                {cycles.map((cycle) => {
                  const metrics = previewByCycle.get(cycle);
                  const profile = metrics?.propertyProfile ?? null;
                  // Realized functional in milliunits. Density, complexity, and
                  // diversity fall back to the standalone preview fields on
                  // grids whose primes exceed the published tables.
                  let realized: number | null = profile
                    ? profile[lane.key]
                    : null;
                  if (realized === null) {
                    if (lane.key === "complexityMilli") {
                      realized = metrics?.complexityMilli ?? null;
                    } else if (lane.key === "diversityMilli") {
                      realized = metrics?.depthDiversityMilli ?? null;
                    } else if (
                      lane.key === "densityMilli" &&
                      metrics?.density != null
                    ) {
                      realized = Math.round(metrics.density * 100_000);
                    }
                  }
                  // The global corridor rail (Density/Complexity only).
                  let railFloor: number | null = null;
                  let railCeil: number | null = null;
                  if (lane.band === "density") {
                    railFloor =
                      metrics?.corridor?.floorMilli ??
                      (metrics?.corridor?.floor ?? densityFloor) * 1_000;
                    railCeil =
                      metrics?.corridor?.ceilingMilli ??
                      (metrics?.corridor?.ceiling ?? densityCeiling) * 1_000;
                  } else if (lane.band === "complexity") {
                    const corridor = metrics?.complexityCorridor ?? {
                      floor: complexityFloor,
                      ceiling: complexityCeiling,
                    };
                    railFloor = corridor.floor;
                    railCeil = corridor.ceiling;
                  }
                  // The drawn target + tolerance band this cycle (absent outside
                  // the drawn span). The authored intent judges the realized
                  // line; the corridor rail applies only where nothing is drawn.
                  const drawnTarget = laneCurve
                    ? propertyCurveTargetMilliAt(laneCurve, cycle)
                    : null;
                  // The previous cycle's level, so this cell can draw the
                  // connecting segment of a continuous automation line.
                  const drawnTargetPrev =
                    laneCurve && cycle > 0
                      ? propertyCurveTargetMilliAt(laneCurve, cycle - 1)
                      : null;
                  const drawnBand = laneCurve
                    ? propertyCurveBandAt(laneCurve, cycle)
                    : null;
                  const drawnPointHere =
                    laneCurve?.points.some((point) => point.cycle === cycle) ??
                    false;
                  const bandFloor = drawnBand ? drawnBand[0] : railFloor;
                  const bandCeil = drawnBand ? drawnBand[1] : railCeil;
                  const hasBand = bandFloor !== null && bandCeil !== null;
                  const directiveOwned =
                    drawnBand !== null &&
                    plan.some((row) =>
                      directiveOwnsCycle(row, cycle, morphSeedBeats)
                    );
                  const within =
                    !directiveOwned &&
                    hasBand &&
                    realized !== null &&
                    realized >= bandFloor! &&
                    realized <= bandCeil!;
                  // The engine's stall reason for a missed drawn band, if it
                  // reported one — knowledge the client cannot infer itself.
                  const missReason =
                    drawnBand && !directiveOwned && !within && realized !== null
                      ? metrics?.curveMisses?.find(
                          (miss) => miss.property === lane.property
                        )?.reason ?? null
                      : null;
                  const ariaName = lane.label.toLowerCase();
                  let label: string;
                  if (realized === null) {
                    label = `Cycle ${cycle} ${ariaName} not cached`;
                  } else if (drawnBand && directiveOwned) {
                    label = `Cycle ${cycle} ${ariaName} ${formatPerceptualScore(
                      realized
                    )}, target band overridden by directive`;
                  } else if (drawnBand) {
                    label = `Cycle ${cycle} ${ariaName} ${formatPerceptualScore(
                      realized
                    )}, target ${formatPerceptualScore(
                      drawnTarget ?? 0
                    )} band ${formatPerceptualScore(
                      drawnBand[0]
                    )} through ${formatPerceptualScore(drawnBand[1])}, ${
                      within ? "inside band" : "outside band"
                    }${missReason ? ` (${MISS_REASON_LABELS[missReason]})` : ""}`;
                  } else if (lane.band === "density") {
                    const onsets = metrics?.onsets ?? 0;
                    label = `Cycle ${cycle} density ${Math.round(
                      realized / 1_000
                    )}%, ${onsets} ${onsets === 1 ? "onset" : "onsets"}, corridor ${Math.round(
                      railFloor! / 1_000
                    )}% through ${Math.round(railCeil! / 1_000)}%, ${
                      within ? "inside" : "outside"
                    } corridor`;
                  } else if (lane.band === "complexity") {
                    label = `Cycle ${cycle} complexity ${formatPerceptualScore(
                      realized
                    )}, corridor ${formatPerceptualScore(
                      railFloor!
                    )} through ${formatPerceptualScore(railCeil!)}${
                      within ? ", inside corridor" : ", outside corridor"
                    }`;
                  } else {
                    label = `Cycle ${cycle} ${ariaName} ${formatPerceptualScore(
                      realized
                    )}`;
                  }
                  return (
                    <span
                      key={cycle}
                      className={`evolve-plan-property-cell${
                        directiveOwned
                          ? " is-overridden"
                          : hasBand
                          ? within
                            ? " is-within-corridor"
                            : realized !== null
                              ? " is-outside-corridor"
                              : ""
                          : ""
                      }${drawnBand ? " is-drawn" : ""}${
                        drawnPointHere ? " has-point" : ""
                      }`}
                      role="group"
                      tabIndex={editable && cycle >= 1 ? 0 : undefined}
                      aria-label={label}
                      title={label}
                      style={{ gridColumn: cycle + 2 }}
                      onKeyDown={
                        editable && cycle >= 1
                          ? (event) => {
                              const pointTarget =
                                drawnTarget ?? realized ?? 50_000;
                              if (
                                event.key === "Enter" ||
                                event.key === " " ||
                                event.key === "ArrowUp" ||
                                event.key === "ArrowDown"
                              ) {
                                event.preventDefault();
                                const delta = event.shiftKey ? 100 : 1_000;
                                const nextTarget =
                                  event.key === "ArrowUp"
                                    ? pointTarget + delta
                                    : event.key === "ArrowDown"
                                      ? pointTarget - delta
                                      : pointTarget;
                                applyPropertyCurves(
                                  upsertPropertyCurvePoint(
                                    propertyCurves,
                                    lane.property,
                                    cycle,
                                    nextTarget
                                  )
                                );
                              } else if (
                                drawnPointHere &&
                                (event.key === "ArrowLeft" ||
                                  event.key === "ArrowRight")
                              ) {
                                event.preventDefault();
                                const nextCycle = Math.min(
                                  extent,
                                  Math.max(
                                    1,
                                    cycle +
                                      (event.key === "ArrowLeft" ? -1 : 1)
                                  )
                                );
                                const without = removePropertyCurvePoint(
                                  propertyCurves,
                                  lane.property,
                                  cycle
                                );
                                applyPropertyCurves(
                                  upsertPropertyCurvePoint(
                                    without,
                                    lane.property,
                                    nextCycle,
                                    pointTarget
                                  )
                                );
                              } else if (
                                drawnPointHere &&
                                (event.key === "Delete" ||
                                  event.key === "Backspace")
                              ) {
                                event.preventDefault();
                                applyPropertyCurves(
                                  removePropertyCurvePoint(
                                    propertyCurves,
                                    lane.property,
                                    cycle
                                  )
                                );
                              }
                            }
                          : undefined
                      }
                      onPointerDown={
                        editable && cycle >= 1
                          ? (event) => {
                              if (event.button !== 0) return;
                              if (event.shiftKey) {
                                if (drawnPointHere) {
                                  applyPropertyCurves(
                                    removePropertyCurvePoint(
                                      propertyCurves,
                                      lane.property,
                                      cycle
                                    )
                                  );
                                }
                                return;
                              }
                              // Begin a freehand automation draw: capture the
                              // pointer so a drag across cells keeps routing
                              // here, and seed the accumulating draft.
                              const bounds =
                                event.currentTarget.getBoundingClientRect();
                              event.currentTarget.setPointerCapture?.(
                                event.pointerId
                              );
                              const fraction =
                                bounds.height <= 0
                                  ? 0
                                  : Math.min(
                                      1,
                                      Math.max(
                                        0,
                                        (bounds.bottom - event.clientY) /
                                          bounds.height
                                      )
                                    );
                              const draft = upsertPropertyCurvePoint(
                                propertyCurves,
                                lane.property,
                                cycle,
                                Math.round(fraction * 100_000)
                              );
                              if (applyPropertyCurves(draft)) {
                                propertyDrawRef.current = {
                                  property: lane.property,
                                  pointerId: event.pointerId,
                                  bottom: bounds.bottom,
                                  height: bounds.height,
                                  draft,
                                };
                              }
                            }
                          : undefined
                      }
                      onPointerMove={
                        editable
                          ? (event) => {
                              const draw = propertyDrawRef.current;
                              if (
                                !draw ||
                                draw.pointerId !== event.pointerId ||
                                draw.property !== lane.property ||
                                !scrollerRef.current
                              ) {
                                return;
                              }
                              // Follow the drag: the cycle comes from the
                              // cursor's X across the lane, the level from its Y
                              // in the captured row.
                              const moveCycle = Math.min(
                                extent,
                                cycleFromPointer(
                                  event,
                                  scrollerRef.current,
                                  cellWidth
                                )
                              );
                              const fraction =
                                draw.height <= 0
                                  ? 0
                                  : Math.min(
                                      1,
                                      Math.max(
                                        0,
                                        (draw.bottom - event.clientY) /
                                          draw.height
                                      )
                                    );
                              const next = upsertPropertyCurvePoint(
                                draw.draft,
                                lane.property,
                                moveCycle,
                                Math.round(fraction * 100_000)
                              );
                              if (applyPropertyCurves(next)) {
                                draw.draft = next;
                              }
                            }
                          : undefined
                      }
                      onPointerUp={
                        editable
                          ? (event) => {
                              if (
                                propertyDrawRef.current?.pointerId ===
                                event.pointerId
                              ) {
                                propertyDrawRef.current = null;
                              }
                            }
                          : undefined
                      }
                      onLostPointerCapture={
                        editable
                          ? (event) => {
                              if (
                                propertyDrawRef.current?.pointerId ===
                                event.pointerId
                              ) {
                                propertyDrawRef.current = null;
                              }
                            }
                          : undefined
                      }
                    >
                      {hasBand ? (
                        <i
                          className="evolve-plan-property-band"
                          aria-hidden="true"
                          style={{
                            bottom: `${bandFloor! / 1_000}%`,
                            height: `${Math.max(
                              1,
                              (bandCeil! - bandFloor!) / 1_000
                            )}%`,
                          }}
                        />
                      ) : null}
                      {drawnTarget !== null && drawnTargetPrev !== null ? (
                        <svg
                          className="evolve-plan-property-line"
                          viewBox="0 0 200 100"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          <line
                            x1="50"
                            y1={100 - drawnTargetPrev / 1_000}
                            x2="150"
                            y2={100 - drawnTarget / 1_000}
                          />
                        </svg>
                      ) : null}
                      {drawnPointHere && drawnTarget !== null ? (
                        <button
                          type="button"
                          className="evolve-plan-property-handle"
                          aria-label={`Move or remove ${ariaName} point at cycle ${cycle}`}
                          style={{ bottom: `${drawnTarget / 1_000}%` }}
                          disabled={!editable}
                          onPointerDown={(event) => {
                            // Grab the point. stopPropagation keeps the lane
                            // beneath from starting a fresh draw; the drag below
                            // moves this point, a release-in-place deletes it.
                            event.stopPropagation();
                            if (event.button !== 0 || !editable) return;
                            const cellRect = (
                              event.currentTarget.parentElement as HTMLElement | null
                            )?.getBoundingClientRect();
                            if (!cellRect) return;
                            event.currentTarget.setPointerCapture?.(
                              event.pointerId
                            );
                            handleDragRef.current = {
                              property: lane.property,
                              cycle,
                              pointerId: event.pointerId,
                              bottom: cellRect.bottom,
                              height: cellRect.height,
                              startX: event.clientX,
                              startY: event.clientY,
                              moved: false,
                              draft: propertyCurves,
                            };
                          }}
                          onPointerMove={(event) => {
                            const drag = handleDragRef.current;
                            if (!drag || drag.pointerId !== event.pointerId) {
                              return;
                            }
                            // Ignore sub-threshold jitter so a plain click still
                            // reads as a click, not a tiny move.
                            if (
                              !drag.moved &&
                              Math.abs(event.clientX - drag.startX) < 4 &&
                              Math.abs(event.clientY - drag.startY) < 4
                            ) {
                              return;
                            }
                            drag.moved = true;
                            const fraction =
                              drag.height <= 0
                                ? 0
                                : Math.min(
                                    1,
                                    Math.max(
                                      0,
                                      (drag.bottom - event.clientY) /
                                        drag.height
                                    )
                                  );
                            const next = upsertPropertyCurvePoint(
                              drag.draft,
                              drag.property,
                              drag.cycle,
                              Math.round(fraction * 100_000)
                            );
                            if (applyPropertyCurves(next)) {
                              drag.draft = next;
                            }
                          }}
                          onPointerUp={(event) => {
                            const drag = handleDragRef.current;
                            if (!drag || drag.pointerId !== event.pointerId) {
                              return;
                            }
                            handleDragRef.current = null;
                            // A release without a drag is a click: delete.
                            if (!drag.moved) {
                              applyPropertyCurves(
                                removePropertyCurvePoint(
                                  propertyCurves,
                                  drag.property,
                                  drag.cycle
                                )
                              );
                            }
                          }}
                          onLostPointerCapture={(event) => {
                            if (
                              handleDragRef.current?.pointerId ===
                              event.pointerId
                            ) {
                              handleDragRef.current = null;
                            }
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (!editable) return;
                            if (
                              event.key === "ArrowUp" ||
                              event.key === "ArrowDown"
                            ) {
                              event.preventDefault();
                              const delta = event.shiftKey ? 100 : 1_000;
                              applyPropertyCurves(
                                upsertPropertyCurvePoint(
                                  propertyCurves,
                                  lane.property,
                                  cycle,
                                  drawnTarget +
                                    (event.key === "ArrowUp" ? delta : -delta)
                                )
                              );
                            } else if (
                              event.key === "ArrowLeft" ||
                              event.key === "ArrowRight"
                            ) {
                              event.preventDefault();
                              const nextCycle = Math.min(
                                extent,
                                Math.max(
                                  1,
                                  cycle +
                                    (event.key === "ArrowLeft" ? -1 : 1)
                                )
                              );
                              const without = removePropertyCurvePoint(
                                propertyCurves,
                                lane.property,
                                cycle
                              );
                              applyPropertyCurves(
                                upsertPropertyCurvePoint(
                                  without,
                                  lane.property,
                                  nextCycle,
                                  drawnTarget
                                )
                              );
                            } else if (
                              event.key === "Delete" ||
                              event.key === "Backspace"
                            ) {
                              event.preventDefault();
                              applyPropertyCurves(
                                removePropertyCurvePoint(
                                  propertyCurves,
                                  lane.property,
                                  cycle
                                )
                              );
                            } else if (
                              event.key === "Enter" ||
                              event.key === " "
                            ) {
                              event.preventDefault();
                            }
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            // Mouse deletion is handled on pointerup; keyboard
                            // movement and deletion are explicit above.
                            if (event.detail === 0 && editable) {
                              applyPropertyCurves(
                                removePropertyCurvePoint(
                                  propertyCurves,
                                  lane.property,
                                  cycle
                                )
                              );
                            }
                          }}
                        />
                      ) : null}
                      {realized !== null ? (
                        <i
                          className={`evolve-plan-property-mark${
                            missReason ? " is-miss" : ""
                          }`}
                          aria-hidden="true"
                          style={{ bottom: `${realized / 1_000}%` }}
                        />
                      ) : null}
                    </span>
                  );
                })}
              </div>
            );
          })}

          <div className="evolve-plan-events" aria-label="Events">
            <span className="evolve-plan-lane-name">Events</span>
            {cycles.map((cycle) => {
              const cycleTrace = traceByCycle.get(cycle) ?? [];
              return (
                <span
                  key={cycle}
                  className="evolve-plan-events-cell"
                  style={{ gridColumn: cycle + 2 }}
                  aria-hidden={cycleTrace.length === 0 ? true : undefined}
                >
                  {cycleTrace.length > 0 ? (
                    <span className="evolve-plan-trace-stack">
                      {cycleTrace.map((entry, index) => {
                        const label = traceEntryLabel(
                          entry,
                          directiveById.get(entry.directiveId)
                        );
                        const traceState = [
                          entry.applied > 0 ? "is-applied" : "",
                          entry.applied === 0 && entry.skipped !== "none"
                            ? "is-skipped"
                            : "",
                          entry.applied > 0 && entry.skipped !== "none"
                            ? "is-partial"
                            : "",
                          entry.corridorClamp ? "is-corridor-clamped" : "",
                          entry.complexityCorridorClamp
                            ? "is-complexity-clamped"
                            : "",
                        ]
                          .filter(Boolean)
                          .map((state) => ` ${state}`)
                          .join("");
                        return (
                          <i
                            key={`${entry.directiveId}-${entry.family}-${index}`}
                            className={`evolve-plan-trace${traceState}`}
                            role="img"
                            tabIndex={0}
                            aria-label={label}
                            title={label}
                          />
                        );
                      })}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>

          {families.length === 0 ? (
            <div className="evolve-plan-empty">
              No used lanes. Show all lanes to add a pin.
            </div>
          ) : null}

          {families.map((family) => (
            <div
              className={`evolve-plan-lane is-${family}`}
              key={family}
              aria-label={`${DIRECTIVE_FAMILY_LABELS[family]} lane`}
            >
              <span className="evolve-plan-lane-name">
                {DIRECTIVE_FAMILY_LABELS[family]}
              </span>
              <span
                className="evolve-plan-seed-lock"
                title="Cycle 0 is the locked seed"
              >
                lock
              </span>
              <button
                type="button"
                className="evolve-plan-lane-add"
                aria-label={`Add ${DIRECTIVE_FAMILY_LABELS[family]} pin`}
                disabled={disabled || planAtCapacity}
                onPointerDown={(event) => {
                  if (!scrollerRef.current) return;
                  const cycle = Math.min(
                    extent,
                    cycleFromPointer(event, scrollerRef.current, cellWidth)
                  );
                  add(family, cycle);
                }}
                onClick={(event) => {
                  if (event.detail === 0) {
                    add(family, firstAvailableCycle(plan, family, extent));
                  }
                }}
              />
              {plan
                .filter(
                  (row) =>
                    row.family === family &&
                    row.fromCycle <= extent &&
                    row.toCycle >= 1
                )
                .map((row) => {
                  const visibleFrom = Math.max(1, row.fromCycle);
                  const visibleTo = Math.min(extent, row.toCycle);
                  const width = (visibleTo - visibleFrom + 1) * cellWidth;
                  const pin = row.fromCycle === row.toCycle;
                  return (
                    <button
                      type="button"
                      key={row.id}
                      className={`evolve-plan-directive${pin ? " is-pin" : " is-range"} is-pacing-${row.pacing}${row.enabled ? "" : " is-disabled"}${selectedId === row.id ? " is-selected" : ""}`}
                      style={{
                        left: LANE_LABEL_WIDTH + visibleFrom * cellWidth,
                        width,
                      }}
                      aria-label={directiveTitle(row)}
                      aria-pressed={selectedId === row.id}
                      disabled={disabled}
                      title={`${directiveTitle(row)}. Drag to move; drag the handles to resize.`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (event.detail === 0) select(row);
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        beginDrag(event, row, "move");
                      }}
                      onPointerUp={endDrag}
                      onPointerCancel={() => setDrag(null)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowLeft" ||
                          event.key === "ArrowRight"
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          nudgeDirective(
                            row,
                            event.key === "ArrowLeft" ? -1 : 1,
                            event.shiftKey
                          );
                        } else if (
                          event.key === "Delete" ||
                          event.key === "Backspace"
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          removeById(row.id);
                        }
                      }}
                    >
                      <i
                        className="evolve-plan-resize is-start"
                        aria-hidden="true"
                        onPointerDown={(event) =>
                          beginDrag(
                            event as unknown as PointerEvent<HTMLButtonElement>,
                            row,
                            "resize-start"
                          )
                        }
                      />
                      <b>
                        {row.magnitude?.mode === "perceptual"
                          ? formatPerceptualScore(row.magnitude.targetMilli)
                          : `${row.intensity}%`}
                      </b>
                      <ScopeGlyph row={row} totalBeats={totalBeats} />
                      <i
                        className="evolve-plan-resize is-end"
                        aria-hidden="true"
                        onPointerDown={(event) =>
                          beginDrag(
                            event as unknown as PointerEvent<HTMLButtonElement>,
                            row,
                            "resize-end"
                          )
                        }
                      />
                    </button>
                  );
                })}
            </div>
          ))}
        </div>

        <aside className="evolve-plan-inspector" aria-label="Directive inspector">
          <section
            className="evolve-plan-property-card"
            aria-label="Property curve settings"
          >
            <div className="evolve-plan-curve-head">
              <strong>Property curves</strong>
              <label className="evolve-plan-curve-enable">
                <input
                  type="checkbox"
                  aria-label={`${selectedPropertyLabel} curve enabled`}
                  checked={selectedPropertyCurve?.enabled ?? false}
                  disabled={disabled || !onPropertyCurvesChange}
                  onChange={(event) =>
                    applyPropertyCurves(
                      setPropertyCurveSettings(
                        propertyCurves,
                        selectedProperty,
                        { enabled: event.currentTarget.checked }
                      )
                    )
                  }
                />
                <span>Enabled</span>
              </label>
            </div>
            <label className="rb-tool-field">
              <span>Property</span>
              <select
                aria-label="Property curve"
                value={selectedProperty}
                disabled={disabled}
                onChange={(event) =>
                  setSelectedProperty(event.currentTarget.value as CurveProperty)
                }
              >
                {PROPERTY_LANES.map((lane) => (
                  <option key={lane.property} value={lane.property}>
                    {lane.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="evolve-plan-curve-fields">
              <label className="rb-tool-field">
                <span>Tolerance</span>
                <NumericField
                  aria-label={`${selectedPropertyLabel} curve tolerance`}
                  min={0}
                  max={100}
                  step={0.1}
                  value={(selectedPropertyCurve?.toleranceMilli ?? 5_000) / 1_000}
                  disabled={disabled || !onPropertyCurvesChange}
                  onValueCommit={(value) =>
                    applyPropertyCurves(
                      setPropertyCurveSettings(
                        propertyCurves,
                        selectedProperty,
                        { toleranceMilli: Math.round(value * 1_000) }
                      )
                    )
                  }
                />
              </label>
              <label className="rb-tool-field">
                <span>Weight</span>
                <NumericField
                  aria-label={`${selectedPropertyLabel} curve weight`}
                  min={1}
                  max={100}
                  step={1}
                  value={selectedPropertyCurve?.weight ?? 50}
                  disabled={disabled || !onPropertyCurvesChange}
                  onValueCommit={(value) =>
                    applyPropertyCurves(
                      setPropertyCurveSettings(
                        propertyCurves,
                        selectedProperty,
                        { weight: value }
                      )
                    )
                  }
                />
              </label>
            </div>
            <p className="evolve-plan-curve-help">
              {selectedPropertyLabel} · {selectedPropertyCurve?.points.length ?? 0}
              {selectedPropertyCurve?.points.length === 1 ? " point" : " points"}.
              Focus a lane cell and press Enter to create, arrows to adjust or
              move, and Delete to remove.
            </p>
            {propertyCurveError ? (
              <p className="evolve-plan-curve-error" role="alert">
                {propertyCurveError}
              </p>
            ) : null}
          </section>
          <section className="evolve-plan-curve-card" aria-label="Evolution curve">
            <div className="evolve-plan-curve-head">
              <strong>Evolution curve</strong>
              <label className="evolve-plan-curve-enable">
                <input
                  type="checkbox"
                  aria-label="Curve enabled"
                  checked={curve.enabled}
                  disabled={disabled || !onCurveChange}
                  onChange={(event) =>
                    applyCurve(
                      setCurveSettings(plan, curve, {
                        enabled: event.currentTarget.checked,
                      })
                    )
                  }
                />
                <span>Enabled</span>
              </label>
            </div>
            <p className="evolve-plan-curve-help">
              One step-size target per cycle for the whole piece, interpolated
              between points; the family weights choose what kind of change.
              Directive cycles override it; outside its points the piece
              repeats. Click the Pacing lane to place points; shift-click
              removes.
            </p>
            <div className="evolve-plan-curve-fields">
              <label className="rb-tool-field">
                <span>tolerance</span>
                <NumericField
                  aria-label="Curve tolerance"
                  min={0}
                  max={100}
                  step={0.1}
                  value={curve.toleranceMilli / 1000}
                  disabled={disabled || !onCurveChange}
                  onValueCommit={(value) =>
                    applyCurve(
                      setCurveSettings(plan, curve, {
                        toleranceMilli: Math.round(value * 1000),
                      })
                    )
                  }
                />
              </label>
              <label className="rb-tool-field">
                <span>max ops</span>
                <NumericField
                  aria-label="Curve max operations"
                  min={1}
                  max={MAX_CURVE_OPERATIONS}
                  step={1}
                  value={curve.maxOperations}
                  disabled={disabled || !onCurveChange}
                  onValueCommit={(value) =>
                    applyCurve(
                      setCurveSettings(plan, curve, { maxOperations: value })
                    )
                  }
                />
              </label>
            </div>
            {curve.points.length > 0 ? (
              <ul className="evolve-plan-curve-points" aria-label="Curve points">
                {curve.points.map((point) => (
                  <li key={point.cycle}>
                    <span>
                      cycle {point.cycle} · {formatPerceptualScore(point.targetMilli)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove curve point at cycle ${point.cycle}`}
                      disabled={disabled || !onCurveChange}
                      onClick={() =>
                        applyCurve(removeCurvePoint(plan, curve, point.cycle))
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="evolve-plan-curve-empty">
                No points yet — enable the curve and click the Pacing lane.
              </p>
            )}
            {curveError ? (
              <p className="evolve-plan-curve-error" role="alert">
                {curveError}
              </p>
            ) : null}
          </section>
          {selected ? (
            <>
              <div className="evolve-plan-inspector-head">
                <div>
                  <span>{DIRECTIVE_FAMILY_LABELS[selected.family]}</span>
                  <strong>Directive {selected.order + 1}</strong>
                </div>
                <div className="evolve-plan-inspector-actions">
                  <button
                    type="button"
                    disabled={disabled || planAtCapacity}
                    onClick={duplicateSelected}
                  >
                    Duplicate
                  </button>
                  <button type="button" disabled={disabled} onClick={removeSelected}>
                    Delete
                  </button>
                </div>
              </div>

              <label className="evolve-plan-enable">
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  disabled={disabled}
                  onChange={() => commit(toggleEnabled(plan, selected.id), selected.id)}
                />
                <span>Enabled</span>
              </label>

              <div className="evolve-plan-field-grid">
                {perceptualMagnitude === null ? (
                  <label>
                    <span>Intensity</span>
                    <NumericField
                      aria-label="Directive intensity"
                      value={selected.intensity}
                      min={0}
                      max={100}
                      step={1}
                      size="compact"
                      disabled={disabled}
                      onValueCommit={(value) => commit(setIntensity(plan, selected.id, value), selected.id)}
                    />
                  </label>
                ) : null}
                <label>
                  <span>Order</span>
                  <NumericField
                    aria-label="Directive order"
                    value={selected.order + 1}
                    min={1}
                    max={plan.length}
                    step={1}
                    size="compact"
                    disabled={disabled}
                    onValueCommit={(value) => commit(reorder(plan, selected.id, value - 1), selected.id)}
                  />
                </label>
                <label>
                  <span>From cycle</span>
                  <NumericField
                    aria-label="From cycle"
                    value={selected.fromCycle}
                    min={1}
                    max={MAX_STOPPED_PREVIEW_CYCLE}
                    step={1}
                    size="compact"
                    disabled={disabled}
                    onValueCommit={(value) => {
                      const result = resizeRange(
                        plan,
                        selected.id,
                        value,
                        selected.toCycle
                      );
                      if (commit(result, selected.id) && result.ok) {
                        const resized = result.plan.find(
                          (row) => row.id === selected.id
                        );
                        if (resized) previewAt(resized.fromCycle);
                      }
                    }}
                  />
                </label>
                <label>
                  <span>To cycle</span>
                  <NumericField
                    aria-label="To cycle"
                    value={selected.toCycle}
                    min={selected.fromCycle}
                    max={MAX_STOPPED_PREVIEW_CYCLE}
                    step={1}
                    size="compact"
                    disabled={disabled}
                    onValueCommit={(value) => {
                      const result = resizeRange(
                        plan,
                        selected.id,
                        selected.fromCycle,
                        value
                      );
                      if (commit(result, selected.id) && result.ok) {
                        previewAt(selected.fromCycle);
                      }
                    }}
                  />
                </label>
              </div>

              <fieldset className="evolve-plan-magnitude">
                <legend>Step size</legend>
                <label>
                  <span>Mode</span>
                  <select
                    aria-label="Step size mode"
                    value={perceptualMagnitude ? "perceptual" : "operationQuota"}
                    disabled={disabled || selected.family === "stochastic"}
                    onChange={(event) =>
                      commit(
                        setMagnitude(
                          plan,
                          selected.id,
                          event.currentTarget.value === "perceptual"
                            ? { ...DEFAULT_PERCEPTUAL_MAGNITUDE }
                            : undefined
                        ),
                        selected.id
                      )
                    }
                  >
                    <option value="operationQuota">Operation quota</option>
                    {selected.family !== "stochastic" ? (
                      <option value="perceptual">Perceptual target</option>
                    ) : null}
                  </select>
                </label>
                {selected.family === "stochastic" ? (
                  <p>Stochastic directives use operation quota.</p>
                ) : perceptualMagnitude ? (
                  <>
                    <div className="evolve-plan-perceptual-fields">
                      <label>
                        <span>Target magnitude</span>
                        <NumericField
                          aria-label="Target magnitude"
                          value={perceptualMagnitude.targetMilli / 1_000}
                          min={0}
                          max={100}
                          step={0.1}
                          numericMode="decimal"
                          size="compact"
                          disabled={disabled}
                          onValueCommit={(value) =>
                            updateSelected((row) =>
                              setMagnitude(plan, row.id, {
                                ...perceptualMagnitude,
                                targetMilli: Math.round(value * 1_000),
                              })
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>Tolerance</span>
                        <NumericField
                          aria-label="Perceptual tolerance"
                          value={perceptualMagnitude.toleranceMilli / 1_000}
                          min={0}
                          max={100}
                          step={0.1}
                          numericMode="decimal"
                          size="compact"
                          disabled={disabled}
                          onValueCommit={(value) =>
                            updateSelected((row) =>
                              setMagnitude(plan, row.id, {
                                ...perceptualMagnitude,
                                toleranceMilli: Math.round(value * 1_000),
                              })
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>Max operations</span>
                        <NumericField
                          aria-label="Maximum operations"
                          value={perceptualMagnitude.maxOperations}
                          min={1}
                          max={MAX_PERCEPTUAL_OPERATIONS}
                          step={1}
                          size="compact"
                          disabled={disabled}
                          onValueCommit={(value) =>
                            updateSelected((row) =>
                              setMagnitude(plan, row.id, {
                                ...perceptualMagnitude,
                                maxOperations: value,
                              })
                            )
                          }
                        />
                      </label>
                    </div>
                    <p>
                      Scores use 0.0–100.0. Calibrates this directive&apos;s
                      incremental rhythm change on each active cycle, not an
                      audio crossfade. Active rows compose, so the final
                      whole-cycle distance can be larger. Max operations limits
                      each search. Model v1.
                    </p>
                    <p
                      className="evolve-plan-perceptual-budget"
                      aria-label={`${perceptualWorkUsed.toLocaleString("en-US")} of ${MAX_PERCEPTUAL_SCORING_WORK.toLocaleString("en-US")} lifetime scores used; ${perceptualWorkRemaining.toLocaleString("en-US")} remaining`}
                    >
                      Score budget: {perceptualWorkUsed.toLocaleString("en-US")} /{" "}
                      {MAX_PERCEPTUAL_SCORING_WORK.toLocaleString("en-US")} used
                      · {perceptualWorkRemaining.toLocaleString("en-US")} left
                    </p>
                    {selectedPerceptualTrace ? (
                      <div
                        className="evolve-plan-perceptual-result"
                        role="status"
                        aria-label={`Cycle ${previewCycle} directive change: realized ${formatPerceptualScore(selectedPerceptualTrace.actualMilli)}, target ${formatPerceptualScore(selectedPerceptualTrace.targetMilli)} plus or minus ${formatPerceptualScore(selectedPerceptualTrace.toleranceMilli)}, ${selectedPerceptualTrace.reached ? "within tolerance" : selectedPerceptualTrace.exhausted ? "nearest legal step" : "closest result"}`}
                      >
                        <span>Cycle {previewCycle}</span>
                        <strong>
                          {formatPerceptualScore(selectedPerceptualTrace.actualMilli)}
                        </strong>
                        <span>Target</span>
                        <strong>
                          {formatPerceptualScore(selectedPerceptualTrace.targetMilli)} ±
                          {formatPerceptualScore(selectedPerceptualTrace.toleranceMilli)}
                        </strong>
                        <em>
                          {selectedPerceptualTrace.reached
                            ? "Within tolerance"
                            : selectedPerceptualTrace.exhausted
                              ? "Nearest legal step"
                              : "Closest result"}
                        </em>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p>Intensity sets the operation quota for each active cycle.</p>
                )}
              </fieldset>

              {selected.family !== "stochastic" &&
              perceptualMagnitude === null &&
              selected.fromCycle === selected.toCycle ? (
                <button
                  type="button"
                  className="evolve-plan-smooth"
                  disabled={disabled}
                  onClick={smoothSelected}
                >
                  Smooth across 4 cycles
                </button>
              ) : null}

              {selected.family !== "stochastic" &&
              perceptualMagnitude === null &&
              selected.fromCycle < selected.toCycle ? (
                <div className="evolve-plan-transition">
                  <label>
                    <span>Transition</span>
                    <select
                      ref={transitionSelectRef}
                      aria-label="Directive transition"
                      value={selected.pacing}
                      disabled={disabled}
                      onChange={(event) =>
                        updateSelected((row) =>
                          setPacing(
                            plan,
                            row.id,
                            event.currentTarget.value as DirectivePacing
                          )
                        )
                      }
                    >
                      <option value="perCycle">Repeat each cycle</option>
                      <option value="linear">Linear transition</option>
                      <option value="easeInOut">Gentle transition</option>
                    </select>
                  </label>
                  <p>{transitionHelp(selected)}</p>
                </div>
              ) : null}

              <fieldset className="evolve-plan-scope-picker">
                <legend>Beat scope</legend>
                <button
                  type="button"
                  className={selected.scope === null ? "is-active" : undefined}
                  disabled={disabled}
                  onClick={() => commit(setScope(plan, selected.id, null), selected.id)}
                >
                  Whole cycle
                </button>
                <div>
                  {Array.from({ length: Math.max(0, totalBeats) }, (_, beat) => {
                    const covered = selected.scope !== null && beat >= selected.scope.startBeat && beat < selected.scope.startBeat + selected.scope.lenBeats;
                    return (
                      <button
                        type="button"
                        key={beat}
                        className={covered ? "is-active" : undefined}
                        aria-label={`Scope beat ${beat + 1}`}
                        aria-pressed={covered}
                        disabled={disabled}
                        onClick={(event) => commit(setScope(plan, selected.id, scopeRunFromBeat(selected, beat, event.shiftKey)), selected.id)}
                      >
                        {beat + 1}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="evolve-plan-options evolve-plan-corridor-options">
                <legend>Density corridor</legend>
                <label className="evolve-plan-enable">
                  <input
                    type="checkbox"
                    aria-label="Override density corridor"
                    checked={
                      selected.options.densityFloor !== null &&
                      selected.options.densityCeiling !== null
                    }
                    disabled={disabled}
                    onChange={(event) =>
                      updateSelected((row) =>
                        setDensityCorridor(
                          plan,
                          row.id,
                          event.currentTarget.checked
                            ? {
                                floor: inheritedOptions.densityFloor ?? densityFloor,
                                ceiling:
                                  inheritedOptions.densityCeiling ?? densityCeiling,
                              }
                            : null
                        )
                      )
                    }
                  />
                  <span>
                    {selected.options.densityFloor === null
                      ? `Inherit global · ${densityFloor}–${densityCeiling}%`
                      : "Override corridor"}
                  </span>
                </label>
                {selected.options.densityFloor !== null &&
                selected.options.densityCeiling !== null ? (
                  <div className="evolve-plan-field-grid">
                    <label>
                      <span>Floor</span>
                      <NumericField
                        aria-label="Directive density floor"
                        value={selected.options.densityFloor}
                        min={0}
                        max={selected.options.densityCeiling}
                        step={1}
                        size="compact"
                        disabled={disabled}
                        onValueCommit={(value) =>
                          updateSelected((row) =>
                            setDensityCorridor(plan, row.id, {
                              floor: Math.min(
                                Math.max(0, Math.round(value)),
                                row.options.densityCeiling ?? densityCeiling
                              ),
                              ceiling:
                                row.options.densityCeiling ?? densityCeiling,
                            })
                          )
                        }
                      />
                    </label>
                    <label>
                      <span>Ceiling</span>
                      <NumericField
                        aria-label="Directive density ceiling"
                        value={selected.options.densityCeiling}
                        min={selected.options.densityFloor}
                        max={100}
                        step={1}
                        size="compact"
                        disabled={disabled}
                        onValueCommit={(value) =>
                          updateSelected((row) =>
                            setDensityCorridor(plan, row.id, {
                              floor: row.options.densityFloor ?? densityFloor,
                              ceiling: Math.max(
                                row.options.densityFloor ?? densityFloor,
                                Math.min(100, Math.round(value))
                              ),
                            })
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="evolve-plan-options evolve-plan-corridor-options">
                <legend>Complexity corridor</legend>
                <label className="evolve-plan-enable">
                  <input
                    type="checkbox"
                    aria-label="Override complexity corridor"
                    checked={
                      selected.options.complexityFloor !== null &&
                      selected.options.complexityCeiling !== null
                    }
                    disabled={disabled}
                    onChange={(event) =>
                      updateSelected((row) =>
                        setComplexityCorridor(
                          plan,
                          row.id,
                          event.currentTarget.checked
                            ? {
                                floor:
                                  inheritedOptions.complexityFloor ??
                                  complexityFloor,
                                ceiling:
                                  inheritedOptions.complexityCeiling ??
                                  complexityCeiling,
                              }
                            : null
                        )
                      )
                    }
                  />
                  <span>
                    {selected.options.complexityFloor === null
                      ? `Inherit global · ${formatPerceptualScore(complexityFloor)}–${formatPerceptualScore(complexityCeiling)}`
                      : "Override corridor"}
                  </span>
                </label>
                {selected.options.complexityFloor !== null &&
                selected.options.complexityCeiling !== null ? (
                  <div className="evolve-plan-field-grid">
                    <label>
                      <span>Floor</span>
                      <NumericField
                        aria-label="Directive complexity floor"
                        value={selected.options.complexityFloor / 1_000}
                        min={0}
                        max={selected.options.complexityCeiling / 1_000}
                        step={0.1}
                        numericMode="decimal"
                        size="compact"
                        disabled={disabled}
                        onValueCommit={(value) =>
                          updateSelected((row) =>
                            setComplexityCorridor(plan, row.id, {
                              floor: Math.min(
                                Math.max(0, Math.round(value * 1_000)),
                                row.options.complexityCeiling ?? complexityCeiling
                              ),
                              ceiling:
                                row.options.complexityCeiling ?? complexityCeiling,
                            })
                          )
                        }
                      />
                    </label>
                    <label>
                      <span>Ceiling</span>
                      <NumericField
                        aria-label="Directive complexity ceiling"
                        value={selected.options.complexityCeiling / 1_000}
                        min={selected.options.complexityFloor / 1_000}
                        max={100}
                        step={0.1}
                        numericMode="decimal"
                        size="compact"
                        disabled={disabled}
                        onValueCommit={(value) =>
                          updateSelected((row) =>
                            setComplexityCorridor(plan, row.id, {
                              floor:
                                row.options.complexityFloor ?? complexityFloor,
                              ceiling: Math.max(
                                row.options.complexityFloor ?? complexityFloor,
                                Math.min(100_000, Math.round(value * 1_000))
                              ),
                            })
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}
              </fieldset>

              {selectedOptionFields.length > 0 ? (
                <fieldset className="evolve-plan-options">
                  <legend>Family options</legend>
                  {selectedOptionFields.includes("barlowTemperature") ? (
                    <NullableOptionField label="Barlow temperature" value={selected.options.barlowTemperature} inheritedValue={inheritedOptions.barlowTemperature as number | null | undefined} min={0} max={100} disabled={disabled} onChange={(value) => updateSelected((row) => setOptions(plan, row.id, { barlowTemperature: value }))} />
                  ) : null}
                  {selectedOptionFields.includes("fillComplexity") ? (
                    <NullableOptionField label="Fill complexity" value={selected.options.fillComplexity} inheritedValue={inheritedOptions.fillComplexity as number | null | undefined} min={0} max={100} disabled={disabled} onChange={(value) => updateSelected((row) => setOptions(plan, row.id, { fillComplexity: value }))} />
                  ) : null}
                  {selectedOptionFields.includes("placementBias") ? (
                    <NullableOptionField label="Placement bias" value={selected.options.placementBias} inheritedValue={inheritedOptions.placementBias as number | null | undefined} min={0} max={100} disabled={disabled} onChange={(value) => updateSelected((row) => setOptions(plan, row.id, { placementBias: value }))} />
                  ) : null}
                  {selectedOptionFields.includes("subdivisionLevel") ? (
                    <label>
                      <span>Subdivision level</span>
                      <select
                        aria-label="Subdivision level"
                        value={selected.options.subdivisionLevel ?? "inherit"}
                        disabled={disabled}
                        onChange={(event) =>
                          updateSelected((row) =>
                            setOptions(plan, row.id, {
                              subdivisionLevel:
                                event.currentTarget.value === "inherit"
                                  ? null
                                  : Number(event.currentTarget.value),
                            })
                          )
                        }
                      >
                        <option value="inherit">
                          Any level
                          {inheritedOptions.subdivisionLevel !== null &&
                          inheritedOptions.subdivisionLevel !== undefined
                            ? ` · inherited prime ${inheritedOptions.subdivisionLevel}`
                            : ""}
                        </option>
                        {subdivisionLevels.map((level) => (
                          <option key={level.prime} value={level.prime}>
                            {subdivisionLevelLabel(level)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {selectedOptionFields.includes("euclidMaxRun") ? (
                    <NullableOptionField label="Euclid max run" value={selected.options.euclidMaxRun} inheritedValue={inheritedOptions.euclidMaxRun as number | null | undefined} min={1} max={8} disabled={disabled} onChange={(value) => updateSelected((row) => setOptions(plan, row.id, { euclidMaxRun: value }))} />
                  ) : null}
                  {selectedOptionFields.includes("euclidInvert") ? (
                    <NullableOptionField label="Euclid invert" value={selected.options.euclidInvert} inheritedValue={inheritedOptions.euclidInvert as number | null | undefined} min={0} max={100} disabled={disabled} onChange={(value) => updateSelected((row) => setOptions(plan, row.id, { euclidInvert: value }))} />
                  ) : null}
                  {selectedOptionFields.includes("rotateDirection") ? (
                    <label>
                      <span>Direction</span>
                      <select aria-label="Rotate direction" value={selected.options.rotateDirection} disabled={disabled} onChange={(event) => updateSelected((row) => setOptions(plan, row.id, { rotateDirection: event.currentTarget.value as DirectiveOptions["rotateDirection"] }))}>
                        <option value="earlier">Earlier</option>
                        <option value="later">Later</option>
                      </select>
                    </label>
                  ) : null}
                  {selectedOptionFields.includes("euclidRestPolicy") ? (
                    <label>
                      <span>Rest policy</span>
                      <select aria-label="Euclid rest policy" value={selected.options.euclidRestPolicy ?? "inherit"} disabled={disabled} onChange={(event) => updateSelected((row) => setOptions(plan, row.id, { euclidRestPolicy: event.currentTarget.value === "inherit" ? null : event.currentTarget.value as "silent" | "tied" }))}>
                        <option value="inherit">Inherit global{inheritedOptions.euclidRestPolicy ? ` · ${inheritedOptions.euclidRestPolicy}` : ""}</option>
                        <option value="tied">Tied</option>
                        <option value="silent">Silent</option>
                      </select>
                    </label>
                  ) : null}
                  {selectedOptionFields.includes("morphTarget") ? (
                    <div className="evolve-plan-morph-target">
                      <label>
                        <span>Target pattern</span>
                        <textarea
                          aria-label="Morph target pattern"
                          rows={4}
                          spellCheck={false}
                          value={selected.options.morphTarget ?? ""}
                          disabled={disabled}
                          onChange={(event) =>
                            updateSelected((row) =>
                              setOptions(plan, row.id, {
                                morphTarget: event.currentTarget.value,
                              })
                            )
                          }
                        />
                      </label>
                      {selectedMorphStatus?.ok ? (
                        <>
                          <p className="is-valid" role="status">
                            {selectedMorphStatus.summary}
                          </p>
                          <RhythmBuilderMiniBlock
                            pattern={selected.options.morphTarget ?? ""}
                            label={`Morph target blocks for directive ${selected.id}`}
                          />
                        </>
                      ) : (
                        <p role="alert">
                          {selectedMorphStatus?.message ??
                            "Enter a target pattern."}
                        </p>
                      )}
                      <small>
                        Morph transports attacks toward this exact lattice
                        target. Transition or perceptual Step size still sets
                        the cycle-to-cycle rate.
                      </small>
                    </div>
                  ) : null}
                </fieldset>
              ) : null}

              <div className="evolve-plan-audition" role="group" aria-label="Compare previews">
                {(["before", "after"] as const).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    className={comparison === mode ? "is-active" : undefined}
                    aria-pressed={comparison === mode}
                    aria-label={`${mode === "before" ? "Before" : "After"} preview`}
                    disabled={disabled}
                    onClick={() => {
                      const cycle = mode === "before" ? selected.fromCycle - 1 : selected.fromCycle;
                      previewAt(cycle, mode);
                    }}
                  >
                    {mode === "before" ? "Before" : "After"}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="evolve-plan-inspector-empty">
              <strong>Select a directive</strong>
              <span>Click a lane to add a pin, then edit its range and scope here.</span>
            </div>
          )}
        </aside>
      </div>

      {error ?? currentSubdivisionLevelError ? (
        <p className="evolve-plan-error" role="alert">
          {error ?? currentSubdivisionLevelError}
        </p>
      ) : null}
      <p className="evolve-plan-key-hint">
        Arrow keys move. Shift + arrow resizes. Alt + drag duplicates. Wheel
        pans; Control or Command + wheel zooms.
      </p>
    </section>
  );
}
