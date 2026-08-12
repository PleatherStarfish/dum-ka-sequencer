import { type PointerEvent } from "react";
/**
 * Timeline lane components: grid lines, aligned rows, playhead overlay,
 * beat ruler, automation lanes, subdivision/grouping, generator, hocket, and
 * playhead lanes.
 * Extracted verbatim from App.tsx (carve-up round 9).
 */
import {
} from "../bridge";
import {
  AutomationCurveData,
  AutomationMarkerData,
  AutomationPointData,
  AutomationTargetDef,
  automationGraphAxisRange,
  automationGraphSampleValue,
  automationSegmentCurveForPoint,
  automationTargetDef,
  automationTimeFromUnit,
  automationTimeToUnit,
  automationValueNumber,
  coerceAutomationPointNumberForAxis,
  formatAutomationEditorValue,
  snapAutomationUnitToMarker,
  automationPointEffectiveUnit,
  sortAutomationMarkers,
  sortAutomationPointsByEffectiveTime,
} from "../automationTargets";
import {
  AutomationPlaybackEvent,
  AutomationSet,
  ChannelHocketPlaybackEvent,
  PulseSpan,
  ResolvedRhythmCell,
  ResolvedRhythmSpan,
  LivePositionSample,
  TransportPosition,
} from "../bridge";
import {
  PLAYHEAD_LATENCY_COMPENSATION_MS,
  TRANSPORT_PPQN,
} from "../components/transportConstants";
import {
  formatPercent,
  formatShortNumber,
} from "../formatters";
import { useDiscardEditorDraft } from "../editorDraftFlush";
import {
  AutomationGraphRangeData,
  clamp,
} from "../patchIo";
import { timelineTickToMusicalAkshara } from "../timelineTickSpace";
import {
  ResolvedBeatView,
  ResolvedSectionRun,
  pulseSpanLabel,
} from "../resolvedSections";
import {
  formatBeatFraction,
  selectActiveParallelTrackPosition,
  timelineChannelColor,
} from "../timelineModel";
import {
  CSSProperties,
  Dispatch,
  MutableRefObject,
  ReactNode,
  SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
export function TimelineGridLines({ beatCount }: { beatCount: number }) {
  return (
    <>
      {Array.from({ length: beatCount + 1 }, (_, index) => (
        <i
          className={`timeline-grid-line${
            index === 0 || index === beatCount ? " is-edge" : ""
          }`}
          key={index}
          style={{ left: `${(index / beatCount) * 100}%` }}
        />
      ))}
    </>
  );
}

export function AlignedTimelineRow({
  label,
  beatCount,
  className = "",
  children,
}: {
  label: ReactNode;
  beatCount: number;
  className?: string;
  children: ReactNode;
}) {
  // Rows are pure track geometry: the panel-level labels column
  // (TimelineLaneLabelsColumn) carries the visible names, so beat widths
  // stay uniform across sections and the playhead's fraction × width math
  // holds. String labels survive here as the row's accessible name.
  return (
    <div
      className={`aligned-timeline-row ${className}`}
      aria-label={typeof label === "string" ? label : undefined}
    >
      <div className="aligned-timeline-track">
        <TimelineGridLines beatCount={beatCount} />
        {children}
      </div>
    </div>
  );
}

export interface TimelineLaneLabelEntry {
  key: string;
  /** The row's height-modifier class (is-beat-ruler, is-gati-matras, …) so
   * the label cell mirrors the exact track height and borders. */
  className: string;
  label: string;
}

/**
 * The one visible label rail for the whole timeline: rendered OUTSIDE the
 * sections grid so section tracks keep uniform beat widths and the
 * playhead's parent measures pure track width. The entry list must mirror
 * the section lane stack; TimelinePanel builds both from the same flags
 * and a parity test pins row count and classes against a rendered section.
 */
export function TimelineLaneLabelsColumn({
  entries,
}: {
  entries: TimelineLaneLabelEntry[];
}) {
  return (
    <div className="timeline-lane-labels" data-testid="timeline-lane-labels">
      <span className="timeline-lane-labels-spacer" aria-hidden="true" />
      {entries.map((entry) => (
        <span
          className={`timeline-lane-label-cell ${entry.className}`}
          data-testid="timeline-lane-label"
          key={entry.key}
        >
          <b>{entry.label}</b>
        </span>
      ))}
    </div>
  );
}

export function liveTimelinePosition(
  position: TransportPosition,
  activeTrackId: string | null
): {
  tick: number;
  cycle: number;
  ticksPerCycle: number;
  ticksPerMs: number;
} {
  const referenceTicksPerMs =
    ((position.tempoBpm / 60) * TRANSPORT_PPQN) / 1000;
  const parallelPosition = activeTrackId
    ? selectActiveParallelTrackPosition(position.parallelTrackPositions, activeTrackId)
    : null;
  if (parallelPosition) {
    const referenceSpan = Math.max(
      1,
      parallelPosition.referenceEndTick - parallelPosition.referenceStartTick
    );
    return {
      tick: parallelPosition.tickInCycle,
      cycle: parallelPosition.cycle,
      ticksPerCycle: parallelPosition.ticksPerCycle,
      ticksPerMs:
        referenceTicksPerMs * (parallelPosition.ticksPerCycle / referenceSpan),
    };
  }
  return {
    tick: position.currentTick,
    cycle: position.currentCycle,
    ticksPerCycle: position.ticksPerCycle,
    ticksPerMs: referenceTicksPerMs,
  };
}

export function TimelinePlayheadOverlay({
  playing,
  livePositionRef,
  activeTrackId,
  cycleBeats,
  onActiveBeatChange,
}: {
  playing: boolean;
  livePositionRef: MutableRefObject<LivePositionSample | null>;
  activeTrackId: string | null;
  cycleBeats: number;
  onActiveBeatChange: Dispatch<SetStateAction<number>>;
}) {
  const playheadRef = useRef<HTMLSpanElement | null>(null);
  const activeBeatRef = useRef(-1);
  // Cache the track width via ResizeObserver so the rAF loop never reads layout
  // (which would force a synchronous reflow every frame).
  const trackWidthRef = useRef(0);

  useLayoutEffect(() => {
    const parent = playheadRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([entry]) => {
      trackWidthRef.current = entry?.contentRect.width ?? parent.clientWidth;
    });
    observer.observe(parent);
    trackWidthRef.current = parent.clientWidth;
    return () => observer.disconnect();
  }, [playing]);

  useEffect(() => {
    if (!playing) {
      activeBeatRef.current = -1;
      onActiveBeatChange(-1);
      return;
    }

    let animationFrame = 0;

    const updatePlayhead = () => {
      const node = playheadRef.current;
      const live = livePositionRef.current;
      if (node && live?.position.isPlaying && cycleBeats > 0) {
        const position = liveTimelinePosition(live.position, activeTrackId);
        if (position.ticksPerCycle > 0) {
          const elapsedMs =
            performance.now() -
            live.receivedAt +
            PLAYHEAD_LATENCY_COMPENSATION_MS;
          const rawTick =
            position.tick + Math.max(0, elapsedMs) * position.ticksPerMs;
          const tickInCycle =
            ((rawTick % position.ticksPerCycle) + position.ticksPerCycle) %
            position.ticksPerCycle;
          const tickFraction = clamp(
            tickInCycle / position.ticksPerCycle,
            0,
            0.999999
          );
          const musicalFraction = tickFraction;
          const parentWidth = trackWidthRef.current;
          node.style.transform = `translate3d(${musicalFraction * parentWidth}px, 0, 0)`;
          node.style.opacity = "1";
          const nextActiveBeat = clamp(
            Math.floor(musicalFraction * cycleBeats),
            0,
            cycleBeats - 1
          );
          if (nextActiveBeat !== activeBeatRef.current) {
            activeBeatRef.current = nextActiveBeat;
            onActiveBeatChange(nextActiveBeat);
          }
        }
      }
      animationFrame = requestAnimationFrame(updatePlayhead);
    };

    animationFrame = requestAnimationFrame(updatePlayhead);

    return () => cancelAnimationFrame(animationFrame);
  }, [
    activeTrackId,
    cycleBeats,
    onActiveBeatChange,
    playing,
    livePositionRef,
  ]);

  if (!playing) {
    return null;
  }

  return (
    <span
      className="timeline-playhead"
      data-testid="timeline-playhead"
      aria-hidden="true"
      ref={playheadRef}
    />
  );
}

export function BeatRulerLane({
  section,
  activeBeat,
}: {
  section: ResolvedSectionRun;
  activeBeat: number;
}) {
  const beatCount = section.endBeat - section.startBeat + 1;
  return (
    <AlignedTimelineRow label="beats" beatCount={beatCount} className="is-beat-ruler">
      {Array.from({ length: beatCount }, (_, index) => {
        const beatNumber = section.startBeat + index;
        const beat = section.beats.find(
          (item) =>
            item.startAkshara <= beatNumber - 1 &&
            item.endAkshara > beatNumber - 1
        );
        const left = (index / beatCount) * 100;
        const width = (1 / beatCount) * 100;
        return (
          <span
            className={`beat-ruler-cell${
              activeBeat + 1 === beatNumber ? " is-active" : ""
            }${index === 0 ? " is-section-start" : ""}`}
            key={beatNumber}
            style={{ left: `${left}%`, width: `${width}%` }}
            title={`beat ${beatNumber}${
              beat
                ? ` · subdivision ${beat.gati} · velocity ${beat.accentVelocity}`
                : ""
            }`}
          >
            {beatNumber}
          </span>
        );
      })}
    </AlignedTimelineRow>
  );
}

export function automationValueForBeat(beat: ResolvedBeatView, target: string): number | null {
  const sample = beat.automationValues.find((value) => value.target === target);
  return Number.isFinite(sample?.value) ? sample!.value : null;
}

export function automationPhaseLabel(beat: ResolvedBeatView): string {
  if (!beat.automationPhase) {
    return "pending";
  }
  return `${beat.automationPhase.numer}/${beat.automationPhase.denom}`;
}

export function formatAutomationTimelineValue(def: AutomationTargetDef, value: number): string {
  return def.step >= 1 ? `${Math.round(value)}` : formatShortNumber(value);
}

export function automationPlaybackPhaseLabel(event: AutomationPlaybackEvent): string {
  return `${event.automationPhase.numer}/${event.automationPhase.denom}`;
}

export function formatAutomationPlaybackValue(
  target: string,
  value: number,
  targetDefs: AutomationTargetDef[]
): string {
  const def = automationTargetDef(target, targetDefs);
  if (def.valueKind === "boolean") return value >= 0.5 ? "1" : "0";
  if (def.unit === "chance") return formatPercent(value);
  return formatAutomationTimelineValue(def, value);
}

export function AutomationTimelineLanes({
  section,
  tracks,
  targetDefs,
}: {
  section: ResolvedSectionRun;
  tracks: AutomationSet["tracks"];
  targetDefs: AutomationTargetDef[];
}) {
  return (
    <>
      {tracks
        .filter((track) => track.enabled)
        .map((track) => (
          <AutomationTimelineLane
            section={section}
            track={track}
            targetDefs={targetDefs}
            key={track.id}
          />
        ))}
    </>
  );
}

export function AutomationTimelineLane({
  section,
  track,
  targetDefs,
}: {
  section: ResolvedSectionRun;
  track: AutomationSet["tracks"][number];
  targetDefs: AutomationTargetDef[];
}) {
  const beatCount = section.endBeat - section.startBeat + 1;
  const sectionStartAkshara = section.startBeat - 1;
  const def = automationTargetDef(track.target, targetDefs);
  const axisRange = automationGraphAxisRange(track, def);
  const range = Math.max(1e-9, axisRange.max - axisRange.min);
  return (
    <AlignedTimelineRow
      label={`auto ${def.label}`}
      beatCount={beatCount}
      className="is-automation-layer"
    >
      {section.beats.map((beat) => {
        const value = automationValueForBeat(beat, track.target);
        const left = ((beat.startAkshara - sectionStartAkshara) / beatCount) * 100;
        const width = ((beat.endAkshara - beat.startAkshara) / beatCount) * 100;
        const fill =
          value === null
            ? 0
            : clamp(((value - axisRange.min) / range) * 100, 0, 100);
        return (
          <span
            className={`automation-layer-cell${value === null ? " is-pending" : ""}`}
            key={`${track.id}-${beat.startAkshara}-${beat.endAkshara}`}
            style={
              {
                left: `${left}%`,
                width: `${width}%`,
                "--automation-fill": `${fill}%`,
              } as CSSProperties
            }
            title={
              value === null
                ? `beat ${beat.beat} · ${def.label} automation pending`
                : `beat ${beat.beat} · ${def.label} ${formatAutomationTimelineValue(
                    def,
                    value
                  )} · phase ${automationPhaseLabel(beat)}`
            }
          >
            {value === null ? "..." : formatAutomationTimelineValue(def, value)}
          </span>
        );
      })}
    </AlignedTimelineRow>
  );
}

export const AUTOMATION_GRAPH_WIDTH = 760;
export const AUTOMATION_GRAPH_HEIGHT = 260;
export const AUTOMATION_GRAPH_PAD_X = 34;
export const AUTOMATION_GRAPH_PAD_Y = 18;

type AutomationGraphDragDraft = {
  pointId: string;
  pointerId: number;
  unit: number;
  value: number;
  anchorId: string | null;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

export function AutomationGraphEditor({
  curve,
  def,
  axisRange,
  markers,
  selectedPointId,
  selectedSegmentPointId,
  disabled,
  onAddPoint,
  onPointChange,
  onPointSelect,
  onSegmentSelect,
}: {
  curve: AutomationCurveData;
  def: AutomationTargetDef;
  axisRange: AutomationGraphRangeData;
  markers: AutomationMarkerData[];
  selectedPointId: string | null;
  selectedSegmentPointId: string | null;
  disabled: boolean;
  onAddPoint: (unit: number, value: number, anchorId: string | null) => void;
  onPointChange: (
    pointId: string,
    patch: { unit?: number; value?: number; anchorId?: string | null }
  ) => void;
  onPointSelect: (pointId: string) => void;
  onSegmentSelect: (pointId: string) => void;
}) {
  const [dragDraft, setDragDraft] = useState<AutomationGraphDragDraft | null>(null);
  const dragDraftRef = useRef<AutomationGraphDragDraft | null>(null);
  const graphRectRef = useRef<DOMRect | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragDraftRef = useRef<AutomationGraphDragDraft | null>(null);

  useEffect(
    () => () => {
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    },
    []
  );

  // Draw at the SAMPLING position: anchored points sit at their marker's time
  // and the segment order follows effective time, exactly as the backend
  // resolves the curve. Stored times are what dragging/typing edits; effective
  // times are what plays — the graph must show the latter.
  const draftPoints = dragDraft
    ? curve.points.map((point) =>
        point.id === dragDraft.pointId
          ? {
              ...point,
              time: automationTimeFromUnit(dragDraft.unit),
              value: { type: "number" as const, value: dragDraft.value },
              anchorId: dragDraft.anchorId,
            }
          : point
      )
    : curve.points;
  const points = sortAutomationPointsByEffectiveTime(draftPoints, markers);
  const markersSorted = sortAutomationMarkers(markers);
  const effectiveUnit = (point: AutomationPointData) =>
    automationPointEffectiveUnit(point, markers);
  const graphLeft = AUTOMATION_GRAPH_PAD_X;
  const graphTop = AUTOMATION_GRAPH_PAD_Y;
  const graphWidth = AUTOMATION_GRAPH_WIDTH - AUTOMATION_GRAPH_PAD_X * 2;
  const graphHeight = AUTOMATION_GRAPH_HEIGHT - AUTOMATION_GRAPH_PAD_Y * 2;
  const range = Math.max(1e-9, axisRange.max - axisRange.min);
  const xForUnit = (unit: number) => graphLeft + clamp(unit, 0, 1) * graphWidth;
  const yForValue = (value: number) =>
    graphTop + (1 - clamp((value - axisRange.min) / range, 0, 1)) * graphHeight;
  const valueForY = (y: number) =>
    coerceAutomationPointNumberForAxis(
      axisRange.min + (1 - clamp((y - graphTop) / graphHeight, 0, 1)) * range,
      def,
      axisRange
    );

  const graphCoordinateFromPoint = (clientX: number, clientY: number, rect: DOMRect) => {
    const viewAspect = AUTOMATION_GRAPH_WIDTH / AUTOMATION_GRAPH_HEIGHT;
    const elementAspect = rect.width / Math.max(rect.height, 1);
    let renderedWidth = rect.width;
    let renderedHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;
    if (elementAspect > viewAspect) {
      renderedWidth = rect.height * viewAspect;
      offsetX = (rect.width - renderedWidth) / 2;
    } else {
      renderedHeight = rect.width / viewAspect;
      offsetY = (rect.height - renderedHeight) / 2;
    }
    return {
      x:
        ((clientX - rect.left - offsetX) / Math.max(renderedWidth, 1)) *
        AUTOMATION_GRAPH_WIDTH,
      y:
        ((clientY - rect.top - offsetY) / Math.max(renderedHeight, 1)) *
        AUTOMATION_GRAPH_HEIGHT,
    };
  };

  const pointFromCoordinates = (clientX: number, clientY: number, rect: DOMRect) => {
    const { x, y } = graphCoordinateFromPoint(clientX, clientY, rect);
    const unit = clamp((x - graphLeft) / graphWidth, 0, 1);
    const snapped = snapAutomationUnitToMarker(unit, markers);
    return {
      unit: snapped.unit,
      anchorId: snapped.anchorId,
      value: valueForY(y),
    };
  };

  const segmentPath = (left: AutomationPointData, right: AutomationPointData) => {
    const leftUnit = effectiveUnit(left);
    const rightUnit = effectiveUnit(right);
    const leftValue = automationValueNumber(left.value, def.fallback);
    const rightValue = automationValueNumber(right.value, def.fallback);
    const curveSpec = automationSegmentCurveForPoint(left, curve.interpolation);
    const startX = xForUnit(leftUnit);
    const startY = yForValue(leftValue);
    const endX = xForUnit(rightUnit);
    const endY = yForValue(rightValue);
    if (curveSpec.kind === "hold") {
      return `M ${startX} ${startY} L ${endX} ${startY} L ${endX} ${endY}`;
    }
    const samples = Array.from({ length: 18 }, (_, index) => index / 17);
    return samples
      .map((sample, index) => {
        const unit = leftUnit + (rightUnit - leftUnit) * sample;
        const value = automationGraphSampleValue(
          left,
          right,
          sample,
          def,
          curve.interpolation
        );
        const command = index === 0 ? "M" : "L";
        return `${command} ${xForUnit(unit)} ${yForValue(value)}`;
      })
      .join(" ");
  };

  const handleGraphPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || event.button !== 0) return;
    const next = pointFromCoordinates(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect()
    );
    onAddPoint(next.unit, next.value, next.anchorId);
  };

  const handlePointPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = dragDraftRef.current;
    const rect = graphRectRef.current;
    if (!current || current.pointerId !== event.pointerId || !rect || disabled) return;
    const moved =
      current.moved ||
      Math.hypot(
        event.clientX - current.startClientX,
        event.clientY - current.startClientY
      ) >= 3;
    if (!moved) return;
    const next = pointFromCoordinates(event.clientX, event.clientY, rect);
    const draft = { ...current, ...next, moved: true };
    dragDraftRef.current = draft;
    pendingDragDraftRef.current = draft;
    if (dragFrameRef.current === null) {
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const pending = pendingDragDraftRef.current;
        pendingDragDraftRef.current = null;
        if (pending) setDragDraft(pending);
      });
    }
  };

  const clearPointDrag = () => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    pendingDragDraftRef.current = null;
    dragDraftRef.current = null;
    graphRectRef.current = null;
    setDragDraft(null);
  };

  useDiscardEditorDraft(clearPointDrag);

  const handlePointPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const current = dragDraftRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved) {
      clearPointDrag();
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      return;
    }
    const rect = graphRectRef.current ?? event.currentTarget.getBoundingClientRect();
    const next = pointFromCoordinates(event.clientX, event.clientY, rect);
    clearPointDrag();
    onPointChange(current.pointId, next);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handlePointPointerCancel = (event: PointerEvent<SVGSVGElement>) => {
    if (dragDraftRef.current?.pointerId !== event.pointerId) return;
    clearPointDrag();
  };

  const handleLostPointerCapture = (event: PointerEvent<SVGSVGElement>) => {
    const current = dragDraftRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    clearPointDrag();
    if (current.moved) {
      onPointChange(current.pointId, {
        unit: current.unit,
        value: current.value,
        anchorId: current.anchorId,
      });
    }
  };

  return (
    <svg
      className="automation-graph"
      viewBox={`0 0 ${AUTOMATION_GRAPH_WIDTH} ${AUTOMATION_GRAPH_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${def.label} automation graph`}
      onPointerDown={handleGraphPointerDown}
      onPointerMove={handlePointPointerMove}
      onPointerUp={handlePointPointerUp}
      onPointerCancel={handlePointPointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    >
      <rect
        className="automation-graph-frame"
        x={graphLeft}
        y={graphTop}
        width={graphWidth}
        height={graphHeight}
      />
      {[0, 0.25, 0.5, 0.75, 1].map((unit) => (
        <line
          className="automation-graph-grid"
          key={`x-${unit}`}
          x1={xForUnit(unit)}
          x2={xForUnit(unit)}
          y1={graphTop}
          y2={graphTop + graphHeight}
        />
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((unit) => (
        <line
          className="automation-graph-grid"
          key={`y-${unit}`}
          x1={graphLeft}
          x2={graphLeft + graphWidth}
          y1={graphTop + graphHeight * unit}
          y2={graphTop + graphHeight * unit}
        />
      ))}
      <text
        className="automation-graph-axis-label"
        x={graphLeft - 6}
        y={graphTop + 11}
        textAnchor="end"
      >
        {formatAutomationEditorValue(def, axisRange.max)}
      </text>
      <text
        className="automation-graph-axis-label"
        x={graphLeft - 6}
        y={graphTop + graphHeight - 3}
        textAnchor="end"
      >
        {formatAutomationEditorValue(def, axisRange.min)}
      </text>
      {markersSorted.map((marker) => {
        const unit = automationTimeToUnit(marker.time);
        const x = xForUnit(unit);
        return (
          <g className="automation-graph-marker" key={marker.id}>
            <line x1={x} x2={x} y1={graphTop} y2={graphTop + graphHeight} />
            <text x={x + 4} y={graphTop + 12}>
              {marker.label || `${Math.round(unit * 100)}%`}
            </text>
          </g>
        );
      })}
      {points.slice(0, -1).map((point, index) => {
        const next = points[index + 1]!;
        const selected = selectedSegmentPointId === point.id;
        return (
          <path
            className={`automation-graph-segment${selected ? " is-selected" : ""}`}
            key={`segment-${point.id ?? index}`}
            d={segmentPath(point, next)}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (point.id) onSegmentSelect(point.id);
            }}
          />
        );
      })}
      {points.map((point, index) => {
        const pointId = point.id ?? `point-${index}`;
        const unit = effectiveUnit(point);
        const anchored =
          !!point.anchorId && markers.some((marker) => marker.id === point.anchorId);
        const value = automationValueNumber(point.value, def.fallback);
        const selected = selectedPointId === point.id;
        return (
          <circle
            className={`automation-graph-point${selected ? " is-selected" : ""}${
              anchored ? " is-anchored" : ""
            }`}
            key={pointId}
            cx={xForUnit(unit)}
            cy={yForValue(value)}
            r={selected ? 6 : 5}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (disabled || !point.id || event.button !== 0) return;
              event.preventDefault();
              onPointSelect(point.id);
              const svg = event.currentTarget.ownerSVGElement;
              if (!svg) return;
              const nextDraft = {
                pointId: point.id,
                pointerId: event.pointerId,
                unit,
                value,
                anchorId: anchored ? point.anchorId ?? null : null,
                startClientX: event.clientX,
                startClientY: event.clientY,
                moved: false,
              };
              graphRectRef.current = svg.getBoundingClientRect();
              dragDraftRef.current = nextDraft;
              setDragDraft(nextDraft);
              svg.setPointerCapture?.(event.pointerId);
            }}
          >
            <title>{`${Number((unit * 100).toFixed(6))}%${
              anchored ? " (marker)" : ""
            } · ${formatAutomationEditorValue(def, value)}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

export function GatiMatraLane({
  section,
  playheadAkshara,
}: {
  section: ResolvedSectionRun;
  playheadAkshara: number | null;
}) {
  const beatCount = section.endBeat - section.startBeat + 1;
  // Ruler anchors: numbering every pulse smears into digit soup on dense
  // grids (20/beat over four beats in the reported case), and thinning by
  // a flat budget still labels musically arbitrary pulses. Instead label
  // only ANCHORS — the beat start plus its principal divisions: the
  // smallest divisor stride of the pulse count that yields at most four
  // labels per beat (20 → stride 5 → pulses 1/6/11/16, the beat's
  // quarters; a prime count labels only the beat start). Unlabeled pulses
  // stay as unnumbered ticks. A global ~96-label budget still guards very
  // long sections by escalating to beat starts only.
  const anchorStride = (pulses: number, maxLabels: number): number => {
    for (let stride = 1; stride <= pulses; stride += 1) {
      if (pulses % stride === 0 && pulses / stride <= maxLabels) {
        return stride;
      }
    }
    return pulses;
  };
  const matraLabel = (matraIndex: number, stride: number): string =>
    matraIndex % stride === 0 ? String(matraIndex + 1) : "";
  const customDivisionSpans = section.pulseSpans.filter(
    (span) => span.kind === "gatiBeat" && span.tags.includes("custom-division")
  );
  const sectionStartAkshara = section.startBeat - 1;
  if (customDivisionSpans.length > 0) {
    const customCells = customDivisionSpans.reduce(
      (sum, span) => sum + Math.max(0, span.matraLen),
      0
    );
    const customBudgetExceeded = customCells > 96;
    return (
      <AlignedTimelineRow
        label="custom subdivision"
        beatCount={beatCount}
        className="is-gati-matras is-custom-subdivision"
      >
        {customDivisionSpans.flatMap((span, divisionIndex) =>
          Array.from({ length: Math.max(0, span.matraLen) }, (_, matraIndex) => {
            const start =
              span.start + (span.duration * matraIndex) / Math.max(1, span.matraLen);
            const end =
              span.start +
              (span.duration * (matraIndex + 1)) / Math.max(1, span.matraLen);
            const left = ((start - sectionStartAkshara) / beatCount) * 100;
            const width = ((end - start) / beatCount) * 100;
            const active =
              playheadAkshara !== null &&
              playheadAkshara >= start &&
              playheadAkshara < end;
            const isDivisionStart = matraIndex === 0;
            const isSectionStart = divisionIndex === 0 && matraIndex === 0;
            return (
              <span
                className={`gati-matra-cell${active ? " is-active" : ""}${
                  isDivisionStart ? " is-beat-start" : ""
                }${isSectionStart ? " is-section-start" : ""}`}
                data-testid="gati-matra-cell"
                data-beat={span.beat ?? divisionIndex + 1}
                data-gati={span.gati ?? ""}
                data-section-start={isSectionStart ? "true" : "false"}
                key={`${span.id}-${matraIndex}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`part ${divisionIndex + 1} pulse ${matraIndex + 1} · subdivision ${
                  span.gati ?? "?"
                } · ${formatShortNumber(span.duration)} beats`}
              >
                {matraLabel(
                  matraIndex,
                  anchorStride(
                    Math.max(1, span.matraLen),
                    customBudgetExceeded ? 1 : 4
                  )
                )}
              </span>
            );
          })
        )}
      </AlignedTimelineRow>
    );
  }
  const gatiCells = section.beats.reduce((sum, beat) => sum + beat.gati, 0);
  const gatiBudgetExceeded = gatiCells > 96;
  return (
    <AlignedTimelineRow
      label={`subdivision ${section.gati}`}
      beatCount={beatCount}
      className="is-gati-matras"
    >
      {section.beats.flatMap((beat) =>
        Array.from({ length: beat.gati }, (_, matraIndex) => {
          const start = beat.beat - 1 + matraIndex / beat.gati;
          const end = beat.beat - 1 + (matraIndex + 1) / beat.gati;
          const left = ((start - (section.startBeat - 1)) / beatCount) * 100;
          const width = ((end - start) / beatCount) * 100;
          const active =
            playheadAkshara !== null &&
            playheadAkshara >= start &&
            playheadAkshara < end;
          const isBeatStart = matraIndex === 0;
          const isSectionStart = beat.sectionStart && isBeatStart;
          return (
            <span
              className={`gati-matra-cell${active ? " is-active" : ""}${
                isBeatStart ? " is-beat-start" : ""
              }${isSectionStart ? " is-section-start" : ""}${
                matraIndex %
                  anchorStride(beat.gati, gatiBudgetExceeded ? 1 : 4) ===
                0
                  ? " is-ruler-anchor"
                  : ""
              }`}
              data-testid="gati-matra-cell"
              data-beat={beat.beat}
              data-gati={beat.gati}
              data-section-start={isSectionStart ? "true" : "false"}
              key={`${beat.beat}-${matraIndex}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`beat ${beat.beat} pulse ${matraIndex + 1} · subdivision ${beat.gati} · v${beat.accentVelocity}`}
            >
              {matraLabel(
                matraIndex,
                anchorStride(beat.gati, gatiBudgetExceeded ? 1 : 4)
              )}
            </span>
          );
        })
      )}
    </AlignedTimelineRow>
  );
}

export function JathiPulseLane({ section }: { section: ResolvedSectionRun }) {
  const activeSpans = section.pulseSpans.filter((span) => span.kind === "jathiPulse");
  const beatSpan = section.endBeat - section.startBeat + 1;
  const sectionStartAkshara = section.startBeat - 1;

  return (
    <AlignedTimelineRow
      label={
        section.jathi ? `grouping ${section.jathi}` : "grouping none"
      }
      beatCount={beatSpan}
      className="is-jathi-pulses"
    >
      {activeSpans.map((span) => {
        const left = ((span.start - sectionStartAkshara) / beatSpan) * 100;
        const width = (span.duration / beatSpan) * 100;
        return (
          <span
            className="jathi-pulse-cell"
            data-testid="jathi-pulse-cell"
            data-section-index={span.sectionIndex ?? ""}
            data-jathi={span.jathi ?? ""}
            data-pulse-index={span.index ?? ""}
            data-start={span.start}
            data-duration={span.duration}
            key={`${span.sectionIndex}-${span.index}-${span.start}`}
            style={{
              left: `${clamp(left, 0, 100)}%`,
              width: `${clamp(width, 0.2, 100)}%`,
            }}
            title={`grouping ${span.jathi ?? "?"} pulse ${span.index ?? "?"}`}
          >
            {span.index}
          </span>
        );
      })}
    </AlignedTimelineRow>
  );
}

export function ChannelHocketTimelineLane({
  section,
  channelEvents,
  channelVoiceLabels,
  ticksPerCycle,
  cycleBeats,
}: {
  section: ResolvedSectionRun;
  channelEvents: readonly ChannelHocketPlaybackEvent[];
  channelVoiceLabels: Readonly<Record<number, string>>;
  ticksPerCycle: number;
  cycleBeats: number;
}) {
  const beatSpan = section.endBeat - section.startBeat + 1;
  const sectionStartAkshara = section.startBeat - 1;
  const sectionEndAkshara = sectionStartAkshara + beatSpan;
  const toAkshara = (tick: number) =>
    timelineTickToMusicalAkshara(tick, ticksPerCycle, cycleBeats);
  const markers =
    ticksPerCycle > 0
      ? channelEvents.flatMap((event, index) => {
          if (event.endTick <= event.startTick) return [];
          const startAkshara = toAkshara(event.startTick);
          const endAkshara = toAkshara(event.endTick);
          const clippedStart = clamp(
            startAkshara,
            sectionStartAkshara,
            sectionEndAkshara
          );
          const clippedEnd = clamp(endAkshara, sectionStartAkshara, sectionEndAkshara);
          if (clippedEnd <= clippedStart) return [];
          return [
            {
              event,
              key: `${event.cycle}-${event.startTick}-${event.endTick}-${index}`,
              left: ((clippedStart - sectionStartAkshara) / beatSpan) * 100,
              width: ((clippedEnd - clippedStart) / beatSpan) * 100,
            },
          ];
        })
      : [];

  return (
    <AlignedTimelineRow label="channel" beatCount={beatSpan} className="is-channel-layer">
      {markers.map((marker) => {
        const positionTitle =
          marker.event.positionAction !== null
            ? ` · ${marker.event.positionRuleLabel ?? "position rule"} · ${
                marker.event.positionScope ?? "position"
              } ${marker.event.positionNth ?? ""} · ${marker.event.positionAction}`
            : "";
        return (
          <span
            className={`channel-event-marker${
              marker.event.fallback ? " is-fallback" : ""
            }${marker.event.source === "accent" ? " is-accent" : ""}${
              marker.event.source === "position" ? " is-position" : ""
            }${marker.event.suppressed ? " is-suppressed" : ""}`}
            key={marker.key}
            data-suppressed={marker.event.suppressed ? "true" : undefined}
            style={{
              backgroundColor: timelineChannelColor(marker.event.channel),
              left: `${clamp(marker.left, 0, 100)}%`,
              width: `${clamp(marker.width, 0.35, 100)}%`,
            }}
            title={`MIDI channel ${marker.event.channel} · ${
              channelVoiceLabels[marker.event.channel] ?? "voice unavailable"
            } · ${marker.event.source}${positionTitle}${
              marker.event.suppressed ? " · suppressed by another track (not sent)" : ""
            }`}
          >
            {marker.event.channel}
          </span>
        );
      })}
    </AlignedTimelineRow>
  );
}

export type AccentLaneKind = "jathiPulse" | "gatiBeat";
export interface AccentLaneChoice {
  kind: AccentLaneKind;
  label: string;
}

/**
 * Pick the authored accent lane for a section, falling back to its subdivision
 * row when no grouping is active.
 */
export function accentLaneChoice(pulseSpans: PulseSpan[]): AccentLaneChoice {
  if (pulseSpans.some((span) => span.kind === "jathiPulse")) {
    return { kind: "jathiPulse", label: "gen · grouping" };
  }
  return { kind: "gatiBeat", label: "gen · subdivision" };
}

type TimelineRhythmRawCell = {
  key: string;
  sectionKey: string;
  span: PulseSpan;
  cell: ResolvedRhythmCell;
  startAkshara: number;
  endAkshara: number;
};

export type CrossSectionRhythmTieChain = {
  ownerKey: string;
  /** Additive only when every source cell uses the same pulse duration. */
  pulseLen: number | null;
  sourceCells: number;
  sourceSpans: number;
  sourceSections: number;
  velocity: number | null;
};

export type CrossSectionRhythmTieChains = ReadonlyMap<
  string,
  CrossSectionRhythmTieChain
>;

function rhythmRawCellKey(
  span: PulseSpan,
  cell: ResolvedRhythmCell,
  fallbackIndex: number
): string {
  return `${span.id}-${fallbackIndex}-${cell.index}-${cell.start}-${cell.len}`;
}

function rhythmRawCellsForSection(
  section: ResolvedSectionRun,
  kind: PulseSpan["kind"],
  rhythmBySpanId: Map<number, ResolvedRhythmSpan>
): TimelineRhythmRawCell[] {
  const sectionKey = `${section.sectionIndex}:${section.startBeat}:${section.endBeat}`;
  return section.pulseSpans
    .filter((span) => span.kind === kind)
    .flatMap((span) => {
      const resolved = rhythmBySpanId.get(span.id);
      const renderSpanLen = resolved?.spanLen ?? span.matraLen;
      const renderCells = resolved?.cells?.length
        ? resolved.cells
        : [
            {
              index: 0,
              start: 0,
              len: span.matraLen,
              rest: false,
              tiedFromPrevious: false,
              tiedToNext: false,
            },
          ];
      return renderCells.map((cell, index) => ({
        key: rhythmRawCellKey(span, cell, index),
        sectionKey,
        span,
        cell,
        startAkshara:
          span.start + span.duration * (cell.start / renderSpanLen),
        endAkshara:
          span.start +
          span.duration * ((cell.start + cell.len) / renderSpanLen),
      }));
    });
}

/**
 * Join only validated, sounding tie handshakes that cross an authored section
 * seam. Each section keeps its own grid and visual fragment, while the opener
 * owns the chain's single accessible note. No first/last-cycle wrap is
 * considered here.
 */
export function buildCrossSectionRhythmTieChains(
  sections: readonly ResolvedSectionRun[],
  rhythmBySpanId: Map<number, ResolvedRhythmSpan>
): CrossSectionRhythmTieChains {
  const rawCells = [...sections]
    .sort(
      (left, right) =>
        left.startBeat - right.startBeat || left.sectionIndex - right.sectionIndex
    )
    .flatMap((section) => {
      const lane = accentLaneChoice(section.pulseSpans);
      return rhythmRawCellsForSection(section, lane.kind, rhythmBySpanId).sort(
        (left, right) =>
          left.startAkshara - right.startAkshara ||
          left.span.id - right.span.id ||
          left.cell.start - right.cell.start
      );
    });
  const result = new Map<string, CrossSectionRhythmTieChain>();
  let chain: TimelineRhythmRawCell[] = [];

  const finishChain = () => {
    if (chain.length < 2) {
      chain = [];
      return;
    }
    const sectionCount = new Set(chain.map((raw) => raw.sectionKey)).size;
    if (sectionCount > 1) {
      const pulseDurations = chain.map(
        (raw) =>
          (raw.endAkshara - raw.startAkshara) / raw.cell.len
      );
      const firstPulseDuration = pulseDurations[0]!;
      const hasSharedPulseUnit = pulseDurations.every(
        (duration) => Math.abs(duration - firstPulseDuration) < 1e-9
      );
      const metadata: CrossSectionRhythmTieChain = {
        ownerKey: chain[0]!.key,
        pulseLen: hasSharedPulseUnit
          ? chain.reduce((sum, raw) => sum + raw.cell.len, 0)
          : null,
        sourceCells: chain.length,
        sourceSpans: new Set(chain.map((raw) => raw.span.id)).size,
        sourceSections: sectionCount,
        velocity: chain[0]!.cell.velocity ?? null,
      };
      for (const raw of chain) {
        result.set(raw.key, metadata);
      }
    }
    chain = [];
  };

  for (let index = 0; index < rawCells.length; index += 1) {
    const current = rawCells[index]!;
    const next = rawCells[index + 1];
    const joinsNext =
      next !== undefined &&
      current.cell.tiedToNext &&
      next.cell.tiedFromPrevious &&
      !current.cell.rest &&
      !next.cell.rest &&
      Math.abs(current.endAkshara - next.startAkshara) < 1e-9;
    if (joinsNext) {
      if (chain.length === 0) chain.push(current);
      if (chain.at(-1)?.key !== next.key) chain.push(next);
    } else if (chain.length > 0) {
      finishChain();
    }
  }
  finishChain();
  return result;
}

export function RhythmLayerLane({
  section,
  rhythmBySpanId,
  playheadAkshara,
  crossSectionTieChains,
}: {
  section: ResolvedSectionRun;
  rhythmBySpanId: Map<number, ResolvedRhythmSpan>;
  playheadAkshara: number | null;
  crossSectionTieChains?: CrossSectionRhythmTieChains;
}) {
  const beatSpan = section.endBeat - section.startBeat + 1;
  const sectionStartAkshara = section.startBeat - 1;
  const sectionEndAkshara = sectionStartAkshara + beatSpan;

  const renderRow = (kind: PulseSpan["kind"], label: ReactNode) => {
    const spans = section.pulseSpans.filter((span) => span.kind === kind);
    type VisualCell = {
      key: string;
      hostSpanId: number;
      startAkshara: number;
      endAkshara: number;
      matraLen: number;
      rest: boolean;
      velocity: number | null;
      sourceCells: number;
      sourceSpans: number;
      startsFromPrevious: boolean;
      continues: boolean;
      crossSectionChain: CrossSectionRhythmTieChain | null;
    };
    const rawCells = rhythmRawCellsForSection(
      section,
      kind,
      rhythmBySpanId
    );
    const visualCells: VisualCell[] = [];
    let previousRaw: TimelineRhythmRawCell | null = null;
    for (const raw of rawCells) {
      const previousVisual = visualCells.at(-1);
      const joinsPrevious =
        raw.cell.tiedFromPrevious &&
        !raw.cell.rest &&
        previousRaw?.cell.tiedToNext === true &&
        previousVisual !== undefined &&
        !previousVisual.rest &&
        Math.abs(previousVisual.endAkshara - raw.startAkshara) < 1e-9;
      if (joinsPrevious) {
        previousVisual.endAkshara = raw.endAkshara;
        previousVisual.matraLen += raw.cell.len;
        previousVisual.sourceCells += 1;
        if (previousRaw!.span.id !== raw.span.id) {
          previousVisual.sourceSpans += 1;
        }
        previousVisual.continues = raw.cell.tiedToNext;
      } else {
        visualCells.push({
          key: raw.key,
          hostSpanId: raw.span.id,
          startAkshara: raw.startAkshara,
          endAkshara: raw.endAkshara,
          matraLen: raw.cell.len,
          rest: raw.cell.rest,
          velocity: raw.cell.rest ? null : raw.cell.velocity ?? null,
          sourceCells: 1,
          sourceSpans: 1,
          startsFromPrevious: raw.cell.tiedFromPrevious,
          continues: raw.cell.tiedToNext,
          crossSectionChain: crossSectionTieChains?.get(raw.key) ?? null,
        });
      }
      previousRaw = raw;
    }
    const visualCellsByHostSpan = new Map<number, VisualCell[]>();
    for (const cell of visualCells) {
      const hosted = visualCellsByHostSpan.get(cell.hostSpanId);
      if (hosted) hosted.push(cell);
      else visualCellsByHostSpan.set(cell.hostSpanId, [cell]);
    }

    return (
      <AlignedTimelineRow label={label} beatCount={beatSpan} className="is-rhythm-layer">
        {spans.map((span) => {
          const left = ((span.start - sectionStartAkshara) / beatSpan) * 100;
          const width = (span.duration / beatSpan) * 100;
          const hostedVisualCells = visualCellsByHostSpan.get(span.id) ?? [];
          const hostsCrossSpanChain = hostedVisualCells.some(
            (cell) => cell.sourceSpans > 1 || cell.crossSectionChain !== null
          );

          return (
            <span
              className={`rhythm-layer-span is-${span.kind}${
                hostsCrossSpanChain ? " has-cross-span-chain" : ""
              }`}
              key={`${span.kind}-${span.id}`}
              style={{
                left: `${clamp(left, 0, 100)}%`,
                width: `${clamp(width, 0.2, 100)}%`,
              }}
              title={pulseSpanLabel(span)}
            >
              {hostedVisualCells.map((cell) => {
                const chain = cell.crossSectionChain;
                const isCrossSectionContinuation =
                  chain !== null && chain.ownerKey !== cell.key;
                const usesMixedPulseUnits = chain?.pulseLen === null;
                const renderedPulseLen = chain?.pulseLen ?? cell.matraLen;
                const renderedSourceCells = chain?.sourceCells ?? cell.sourceCells;
                const renderedSourceSpans = chain?.sourceSpans ?? cell.sourceSpans;
                const renderedVelocity = chain?.velocity ?? cell.velocity;
                const active =
                  playheadAkshara !== null &&
                  playheadAkshara >= cell.startAkshara &&
                  playheadAkshara < cell.endAkshara;
                const cellClasses = [
                  active ? "is-active" : "",
                  cell.rest ? "is-rest" : "",
                  renderedSourceCells > 1 ||
                  cell.startsFromPrevious ||
                  cell.continues
                    ? "is-tied-chain"
                    : "",
                  cell.startsFromPrevious ? "is-chain-open-left" : "",
                  cell.continues ? "is-chain-open-right" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                // Badges speak in beats, not raw matra counts: 8 pulses
                // on a Subdivision-20 grid is "2/5" of a beat. Rests carry
                // no badge (the gap reads itself); cells narrower than 3%
                // of the row hide theirs (the title keeps exact pulses).
                const rowSharePercent =
                  ((cell.endAkshara - cell.startAkshara) / beatSpan) * 100;
                const cellLabel = cell.rest
                  ? ""
                  : isCrossSectionContinuation || cell.startsFromPrevious
                    ? ""
                    : usesMixedPulseUnits
                      ? "↔"
                      : rowSharePercent < 3
                        ? ""
                        : formatBeatFraction(renderedPulseLen, section.gati);
                const tieTitle =
                  renderedSourceCells > 1
                    ? ` · across ${renderedSourceSpans} span${
                        renderedSourceSpans === 1 ? "" : "s"
                      }${
                        chain !== null
                          ? ` and ${chain.sourceSections} section${
                              chain.sourceSections === 1 ? "" : "s"
                            }`
                          : ""
                      }`
                    : cell.startsFromPrevious && cell.continues
                      ? " · sustain continues through this row"
                      : cell.startsFromPrevious
                        ? " · sustain ends in this row"
                        : cell.continues
                          ? " · sustain continues beyond this row"
                          : "";
                // Accent shading: sounding cells tint by their inherited
                // authored velocity (the same value realized MIDI gets).
                // Velocity-less cells (legacy payloads) keep the default look.
                const velocityStyle =
                  renderedVelocity !== null
                    ? ({
                        "--velocity-mix": `${Math.round((renderedVelocity / 127) * 95)}%`,
                      } as CSSProperties)
                    : undefined;
                const velocityTitle =
                  renderedVelocity !== null ? ` · velocity ${renderedVelocity}` : "";
                const cellLeft =
                  ((cell.startAkshara - span.start) / span.duration) * 100;
                const cellWidth =
                  ((cell.endAkshara - cell.startAkshara) / span.duration) * 100;
                const opensAtSectionStart =
                  chain !== null &&
                  cell.startsFromPrevious &&
                  Math.abs(cell.startAkshara - sectionStartAkshara) < 1e-9;
                const opensAtSectionEnd =
                  chain !== null &&
                  cell.continues &&
                  Math.abs(cell.endAkshara - sectionEndAkshara) < 1e-9;
                // Ordinary cells keep 1.5px breathing room on both sides.
                // Cross-section fragments instead cover the source span's
                // 1px border and meet the clipped section edge exactly, so
                // adjacent section-local tracks read as one sustained note.
                const horizontalCellStyle: CSSProperties = opensAtSectionStart
                  ? opensAtSectionEnd
                    ? { left: "-1px", right: "-1px" }
                    : {
                        left: "-1px",
                        width: `calc(${cellWidth}% - 0.5px)`,
                      }
                  : opensAtSectionEnd
                    ? {
                        left: `calc(${cellLeft}% + 1.5px)`,
                        right: "-1px",
                      }
                    : {
                        left: `calc(${cellLeft}% + 1.5px)`,
                        width: `calc(${cellWidth}% - 3px)`,
                      };
                const pulseNoun = renderedPulseLen === 1 ? "pulse" : "pulses";
                const beatPhrase = usesMixedPulseUnits
                  ? ""
                  : ` (${formatBeatFraction(renderedPulseLen, section.gati)} beat${
                      renderedPulseLen > section.gati ? "s" : ""
                    })`;
                const accessibleLabel = cell.rest
                  ? `rest for ${renderedPulseLen} ${pulseNoun}`
                  : usesMixedPulseUnits
                    ? `note sustaining across ${renderedSourceSpans} spans and ${
                        chain!.sourceSections
                      } sections${
                        renderedVelocity !== null
                          ? `, velocity ${renderedVelocity}`
                          : ""
                      }`
                  : `${
                      cell.startsFromPrevious ? "sustain continuation" : "note"
                    } for ${renderedPulseLen} ${pulseNoun}${beatPhrase}${
                      renderedSourceSpans > 1
                        ? ` across ${renderedSourceSpans} spans`
                        : ""
                    }${
                      chain !== null
                        ? ` and ${chain.sourceSections} sections`
                        : ""
                    }${
                      renderedVelocity !== null ? `, velocity ${renderedVelocity}` : ""
                    }`;

                return (
                  <i
                    className={cellClasses || undefined}
                    data-testid="rhythm-layer-cell"
                    data-source-cells={renderedSourceCells}
                    data-source-spans={renderedSourceSpans}
                    data-source-sections={chain?.sourceSections}
                    data-pulse-unit={usesMixedPulseUnits ? "mixed" : undefined}
                    data-open-section-left={
                      opensAtSectionStart ? "true" : undefined
                    }
                    data-open-section-right={
                      opensAtSectionEnd ? "true" : undefined
                    }
                    data-tie-chain-owner={
                      chain === null
                        ? undefined
                        : isCrossSectionContinuation
                          ? "false"
                          : "true"
                    }
                    key={cell.key}
                    role={isCrossSectionContinuation ? undefined : "img"}
                    aria-label={
                      isCrossSectionContinuation ? undefined : accessibleLabel
                    }
                    aria-hidden={isCrossSectionContinuation || undefined}
                    style={{
                      ...horizontalCellStyle,
                      ...velocityStyle,
                    }}
                    title={`${
                      usesMixedPulseUnits
                        ? "one sustain"
                        : `${renderedPulseLen} ${pulseNoun}`
                    }${
                      cell.rest ? " · rest" : ""
                    }${tieTitle}${velocityTitle}`}
                  >
                    <b>{cellLabel}</b>
                  </i>
                );
              })}
            </span>
          );
        })}
      </AlignedTimelineRow>
    );
  };
  const lane = accentLaneChoice(section.pulseSpans);

  return <>{renderRow(lane.kind, lane.label)}</>;
}
