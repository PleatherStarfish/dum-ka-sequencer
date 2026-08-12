/** Deterministic boundary rail plus shared panel-status entry types. */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { BoundaryPoint, clamp } from "../patchIo";
import { ResolvedSectionRun } from "../resolvedSections";

type BoundaryRailEdit = {
  afterBeat: number;
  remove: boolean;
};

type BoundaryRailGesture = {
  pointerId: number;
  rect: DOMRect;
  latest: BoundaryRailEdit;
};

function sameBoundaryRailEdit(
  left: BoundaryRailEdit | null,
  right: BoundaryRailEdit | null
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.afterBeat === right.afterBeat &&
      left.remove === right.remove)
  );
}

export function BoundaryRail({
  cycleBeats,
  boundaries,
  resolvedSections,
  disabled = false,
  onBoundaryEdit,
  onBoundaryOpen,
  onBoundaryRemove,
}: {
  cycleBeats: number;
  boundaries: BoundaryPoint[];
  resolvedSections: ResolvedSectionRun[];
  disabled?: boolean;
  onBoundaryEdit?: (edit: BoundaryRailEdit) => void;
  onBoundaryOpen?: (afterBeat: number) => void;
  onBoundaryRemove?: (afterBeat: number) => void;
}) {
  const [draftEdit, setDraftEdit] = useState<BoundaryRailEdit | null>(null);
  const gestureRef = useRef<BoundaryRailGesture | null>(null);
  const firedStarts = new Set(
    resolvedSections
      .filter((section) => section.startBeat > 1)
      .map((section) => section.startBeat)
  );
  const boundaryBeats = new Set(boundaries.map((boundary) => boundary.afterBeat));

  const railEditFromPoint = (
    rect: DOMRect,
    clientX: number,
    removeRequested: boolean
  ): BoundaryRailEdit | null => {
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = clamp((clientX - rect.left) / rect.width, 0, 1);
    const afterBeat = clamp(Math.round(x * cycleBeats), 1, cycleBeats - 1);
    return {
      afterBeat,
      remove: removeRequested && boundaryBeats.has(afterBeat),
    };
  };

  const stageRailEdit = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const next = railEditFromPoint(gesture.rect, event.clientX, false);
    if (!next || sameBoundaryRailEdit(gesture.latest, next)) return;
    gesture.latest = next;
    setDraftEdit(next);
  };

  const editChangesBoundaries = (edit: BoundaryRailEdit): boolean => {
    const existing = boundaries.some(
      (boundary) => boundary.afterBeat === edit.afterBeat
    );
    return edit.remove ? existing : !existing;
  };

  const endRailGesture = (pointerId: number, commit: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== pointerId) return;
    gestureRef.current = null;
    setDraftEdit(null);
    if (commit && editChangesBoundaries(gesture.latest)) {
      onBoundaryEdit?.(gesture.latest);
    }
  };

  const displayedBoundaries = draftEdit
    ? draftEdit.remove
      ? boundaries.filter(
          (boundary) => boundary.afterBeat !== draftEdit.afterBeat
        )
      : [
          ...boundaries.filter(
            (boundary) => boundary.afterBeat !== draftEdit.afterBeat
          ),
          {
            ...(boundaries.find(
              (boundary) => boundary.afterBeat === draftEdit.afterBeat
            ) ?? {
              id: `boundary-rail-draft-${draftEdit.afterBeat}`,
              weights: [],
              jathiWeights: [],
              customSubdivision: null,
              jathiBhedam: null,
            }),
            afterBeat: draftEdit.afterBeat,
            changeProbability: 1,
          } as BoundaryPoint,
        ]
    : boundaries;

  return (
    <div
      className={`boundary-rail${
        onBoundaryEdit && !disabled ? " is-editable" : ""
      }${disabled ? " is-disabled" : ""}`}
      style={{
        gridTemplateColumns: `repeat(${cycleBeats}, minmax(72px, 1fr))`,
        minWidth: `${cycleBeats * 72}px`,
      }}
      aria-label="Section boundaries"
      title={
        disabled
          ? "Stop playback before changing section boundaries"
          : "Click or drag to add a boundary. Double-click, Option-click, or Command-click to remove one."
      }
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          !onBoundaryEdit ||
          disabled ||
          cycleBeats < 2
        ) {
          return;
        }
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const initial = railEditFromPoint(
          rect,
          event.clientX,
          event.altKey || event.metaKey
        );
        if (!initial) return;
        gestureRef.current = {
          pointerId: event.pointerId,
          rect,
          latest: initial,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDraftEdit(initial);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 1 || event.altKey || event.metaKey) return;
        stageRailEdit(event);
      }}
      onPointerUp={(event) => endRailGesture(event.pointerId, true)}
      onPointerCancel={(event) => endRailGesture(event.pointerId, false)}
      onLostPointerCapture={(event) => endRailGesture(event.pointerId, true)}
      onDoubleClick={(event) => {
        event.preventDefault();
        const edit = railEditFromPoint(
          event.currentTarget.getBoundingClientRect(),
          event.clientX,
          true
        );
        if (edit && editChangesBoundaries(edit)) onBoundaryEdit?.(edit);
      }}
    >
      <div className="boundary-rail-caption">section boundaries</div>
      {Array.from({ length: cycleBeats }, (_, index) => (
        <span className="boundary-rail-beat" key={index}>
          {index + 1}
        </span>
      ))}
      {displayedBoundaries.map((boundary) => {
        const fired = firedStarts.has(boundary.afterBeat + 1);
        return (
          <span
            className={`boundary-rail-marker${fired ? " is-fired" : ""}`}
            key={boundary.afterBeat}
            style={{ left: `${(boundary.afterBeat / cycleBeats) * 100}%` }}
            title={`Section boundary after beat ${boundary.afterBeat}${
              fired ? " · active in this cycle" : ""
            }`}
          >
            <i />
            <em>after {boundary.afterBeat}</em>
            <span
              className="boundary-rail-actions"
              aria-label={`Boundary after beat ${boundary.afterBeat} actions`}
            >
              <button
                className="boundary-marker-action"
                type="button"
                disabled={disabled || !onBoundaryOpen}
                title={`Edit boundary after beat ${boundary.afterBeat}`}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onBoundaryOpen?.(boundary.afterBeat);
                }}
              >
                edit
              </button>
              <button
                className="boundary-marker-action is-delete"
                type="button"
                disabled={disabled || !onBoundaryRemove}
                title={`Delete boundary after beat ${boundary.afterBeat}`}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onBoundaryRemove?.(boundary.afterBeat);
                }}
              >
                del
              </button>
            </span>
          </span>
        );
      })}
    </div>
  );
}

export type PanelStatusTone = "open" | "on" | "off" | "data" | "warn";

export interface PanelStatusItem {
  label: string;
  tone?: PanelStatusTone;
}

export type PanelStatusEntry = PanelStatusItem | null | false;
