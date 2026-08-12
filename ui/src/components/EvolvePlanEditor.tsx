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

import type { GeneratorPreview } from "../bridge";
import {
  DIRECTIVE_FAMILIES,
  DIRECTIVE_FAMILY_LABELS,
  DIRECTIVE_PACING_LABELS,
  MAX_EVOLUTION_DIRECTIVES,
  addPin,
  duplicateDirective,
  moveDirective,
  removeDirective,
  reorder,
  resizeRange,
  setIntensity,
  setDensityCorridor,
  setOptions,
  setPacing,
  setScope,
  smoothDirectiveOverFourCycles,
  toggleEnabled,
  type DirectiveFamily,
  type DirectiveOptions,
  type DirectivePacing,
  type DirectiveTraceEntry,
  type EvolutionDirective,
  type PlanEditResult,
} from "../dumkaEvolvePlan";
import { NumericField } from "../NumericField";
import { MAX_STOPPED_PREVIEW_CYCLE } from "../timelineModel";

const CELL_WIDTH = 54;
const MIN_CELL_WIDTH = 30;
const MAX_CELL_WIDTH = 104;
const LANE_LABEL_WIDTH = 112;
const MIN_VIEW_CYCLES = 16;
const TRAILING_CYCLES = 4;
const VIEWPORT_OVERSCAN = 3;

export interface EvolutionCachedPreview {
  cycle: number;
  preview: Pick<GeneratorPreview, "spans">;
}

export type EvolutionInheritedOptions = Partial<
  Pick<
    DirectiveOptions,
    | "barlowTemperature"
    | "fillComplexity"
    | "densityFloor"
    | "densityCeiling"
    | "euclidMaxRun"
    | "euclidInvert"
    | "euclidRestPolicy"
  >
>;

export interface EvolvePlanEditorProps {
  plan: readonly EvolutionDirective[];
  planLengthCycles: number;
  totalBeats: number;
  disabled?: boolean;
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
  barlowRemove: ["barlowTemperature"],
  barlowAdd: ["barlowTemperature"],
  fragment: ["fillComplexity"],
  euclid: ["euclidMaxRun", "euclidInvert", "euclidRestPolicy"],
  rotate: ["rotateDirection"],
};

function directiveTitle(row: EvolutionDirective): string {
  if (row.fromCycle === row.toCycle) {
    return `${DIRECTIVE_FAMILY_LABELS[row.family]}, cycle ${row.fromCycle}, ${row.intensity}%`;
  }
  return `${DIRECTIVE_FAMILY_LABELS[row.family]}, cycles ${row.fromCycle} through ${row.toCycle}, ${row.intensity}%, ${DIRECTIVE_PACING_LABELS[row.pacing].toLowerCase()}`;
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
  const result = `${DIRECTIVE_FAMILY_LABELS[entry.family]}: ${entry.applied}/${entry.requested}${corridor}${entry.skipped === "none" ? "" : `, ${entry.skipped}`}`;
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
  disabled = false,
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
}: EvolvePlanEditorProps) {
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId);
  const [usedOnly, setUsedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<"before" | "after">("after");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [cellWidth, setCellWidth] = useState(CELL_WIDTH);
  const [visibleRange, setVisibleRange] = useState<VisibleCycleRange>({
    fromCycle: 0,
    toCycle: MIN_VIEW_CYCLES,
  });
  const [rulerPanning, setRulerPanning] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rulerPanRef = useRef<RulerPanState | null>(null);
  const pendingZoomScrollLeftRef = useRef<number | null>(null);
  const pendingTransitionFocusIdRef = useRef<number | null>(null);
  const transitionSelectRef = useRef<HTMLSelectElement | null>(null);
  const visibleRangeCallbackRef = useRef(onVisibleCycleRangeChange);

  const selected = plan.find((row) => row.id === selectedId) ?? null;
  const planAtCapacity = plan.length >= MAX_EVOLUTION_DIRECTIVES;
  const lastPreviewableCycle = plan.reduce(
    (max, row) => Math.max(max, Math.min(MAX_STOPPED_PREVIEW_CYCLE, row.toCycle)),
    0
  );
  const requestedExtent = Math.max(
    MIN_VIEW_CYCLES,
    Math.round(planLengthCycles),
    Math.min(
      MAX_STOPPED_PREVIEW_CYCLE,
      lastPreviewableCycle + TRAILING_CYCLES
    )
  );
  const extent = Math.min(MAX_STOPPED_PREVIEW_CYCLE, requestedExtent);
  const outOfWindowDirectiveCount = plan.filter(
    (row) => row.fromCycle > extent || row.toCycle > extent
  ).length;
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
    () => new Map(cachedPreviews.map((entry) => [entry.cycle, previewMetrics(entry)])),
    [cachedPreviews]
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
  const maxVisibleOnsets = useMemo(
    () => {
      let max = 1;
      for (const [cycle, metrics] of previewByCycle) {
        if (
          cycle >= visibleRange.fromCycle &&
          cycle <= visibleRange.toCycle
        ) {
          max = Math.max(max, metrics.onsets);
        }
      }
      return max;
    },
    [previewByCycle, visibleRange.fromCycle, visibleRange.toCycle]
  );

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
    onPlanChange(result.plan);
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
    const result = addPin(plan, family, cycle);
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

          {families.length === 0 ? (
            <div className="evolve-plan-empty">No used lanes. Show all lanes to add a pin.</div>
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
              <span className="evolve-plan-seed-lock" title="Cycle 0 is the locked seed">
                lock
              </span>
              <button
                type="button"
                className="evolve-plan-lane-add"
                aria-label={`Add ${DIRECTIVE_FAMILY_LABELS[family]} pin`}
                disabled={disabled || planAtCapacity}
                onPointerDown={(event) => {
                  if (!scrollerRef.current) return;
                  const cycle = cycleFromPointer(
                    event,
                    scrollerRef.current,
                    cellWidth
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
                        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                          event.preventDefault();
                          event.stopPropagation();
                          nudgeDirective(row, event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
                        } else if (event.key === "Delete" || event.key === "Backspace") {
                          event.preventDefault();
                          event.stopPropagation();
                          removeById(row.id);
                        }
                      }}
                    >
                      <i
                        className="evolve-plan-resize is-start"
                        aria-hidden="true"
                        onPointerDown={(event) => beginDrag(event as unknown as PointerEvent<HTMLButtonElement>, row, "resize-start")}
                      />
                      <b>{row.intensity}%</b>
                      <ScopeGlyph row={row} totalBeats={totalBeats} />
                      <i
                        className="evolve-plan-resize is-end"
                        aria-hidden="true"
                        onPointerDown={(event) => beginDrag(event as unknown as PointerEvent<HTMLButtonElement>, row, "resize-end")}
                      />
                    </button>
                  );
                })}
            </div>
          ))}

          <div className="evolve-plan-composition" aria-label="Composition strip">
            <span className="evolve-plan-lane-name">Composition</span>
            {cycles.map((cycle) => {
              const metrics = previewByCycle.get(cycle);
              const cycleTrace = traceByCycle.get(cycle) ?? [];
              const traceTitle = cycleTrace
                .map((entry) => traceEntryLabel(entry, directiveById.get(entry.directiveId)))
                .join("; ");
              const densityPercent = Math.round((metrics?.density ?? 0) * 100);
              const compositionLabel = metrics
                ? `Cycle ${cycle} composition: ${metrics.onsets} ${metrics.onsets === 1 ? "onset" : "onsets"}, ${densityPercent}% density; corridor ${densityFloor}% through ${densityCeiling}%${traceTitle ? `. ${traceTitle}` : ""}`
                : `Cycle ${cycle} composition not cached${traceTitle ? `. ${traceTitle}` : ""}`;
              return (
                <span
                  key={cycle}
                  className="evolve-plan-composition-cell"
                  role="group"
                  aria-label={compositionLabel}
                  style={{
                    gridColumn: cycle + 2,
                    "--density-percent": `${densityPercent}%`,
                    "--corridor-floor": `${densityFloor}%`,
                    "--corridor-height": `${Math.max(0, densityCeiling - densityFloor)}%`,
                  } as CSSProperties}
                  title={traceTitle || (metrics ? `${metrics.onsets} onsets` : `Cycle ${cycle} not cached`)}
                >
                  <i className="evolve-plan-corridor-band" aria-hidden="true" />
                  {metrics ? (
                    <i
                      className="evolve-plan-density-mark"
                      aria-hidden="true"
                      style={{ bottom: `${densityPercent}%` }}
                    />
                  ) : null}
                  {metrics ? (
                    <i
                      className="evolve-plan-onset-bar"
                      title={`${metrics.onsets} onsets`}
                      style={{
                        height: `${Math.round(
                          Math.min(1, metrics.onsets / maxVisibleOnsets) * 100
                        )}%`,
                      }}
                    />
                  ) : null}
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
        </div>

        <aside className="evolve-plan-inspector" aria-label="Directive inspector">
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

              {selected.family !== "stochastic" && selected.fromCycle === selected.toCycle ? (
                <button
                  type="button"
                  className="evolve-plan-smooth"
                  disabled={disabled}
                  onClick={smoothSelected}
                >
                  Smooth across 4 cycles
                </button>
              ) : null}

              {selected.family !== "stochastic" && selected.fromCycle < selected.toCycle ? (
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

              {selectedOptionFields.length > 0 ? (
                <fieldset className="evolve-plan-options">
                  <legend>Family options</legend>
                  {selectedOptionFields.includes("barlowTemperature") ? (
                    <NullableOptionField label="Barlow temperature" value={selected.options.barlowTemperature} inheritedValue={inheritedOptions.barlowTemperature as number | null | undefined} min={0} max={100} disabled={disabled} onChange={(value) => updateSelected((row) => setOptions(plan, row.id, { barlowTemperature: value }))} />
                  ) : null}
                  {selectedOptionFields.includes("fillComplexity") ? (
                    <NullableOptionField label="Fill complexity" value={selected.options.fillComplexity} inheritedValue={inheritedOptions.fillComplexity as number | null | undefined} min={0} max={100} disabled={disabled} onChange={(value) => updateSelected((row) => setOptions(plan, row.id, { fillComplexity: value }))} />
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

      {error ? <p className="evolve-plan-error" role="alert">{error}</p> : null}
      <p className="evolve-plan-key-hint">
        Arrow keys move. Shift + arrow resizes. Alt + drag duplicates. Wheel
        pans; Control or Command + wheel zooms.
      </p>
    </section>
  );
}
