import { type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  NumericField,
} from "../NumericField";
import {
  DelayTimeDistribution,
  GraceNotePlacementWeights,
  PitchState,
  RatchetModifierOperation,
  RatchetProbabilityModifiers,
  RatchetSpanGateLimit,
  RhythmArticulationBlendMode,
  RhythmExtrapolationStrategy,
  RhythmPassageStrategy,
  RhythmPattern,
  WeightedMidiPitch,
  WeightedPitchInterval,
} from "../bridge";
import {
  BoundaryPoint,
  DEFAULT_GRACE_PITCH_POOL,
  DEFAULT_GRACE_TRANSPOSE_INTERVALS,
  DEFAULT_RATCHET_MAX_SPAN_MATRAS,
  LIMITED_TRANSPOSITION_COLLECTIONS,
  PITCH_NAMES,
  RHYTHM_LENGTHS,
  RhythmArticulationBlendState,
  RhythmArticulationCellState,
  RhythmArticulationNeighborState,
  RhythmArticulationProbabilityState,
  RhythmFallbackMode,
  RhythmPositionArticulationState,
  SeedDialogTab,
  clamp,
  limitedTranspositionPreset,
  normalizeGraceTransposeIntervals,
  normalizeWeightedMidiPitches,
  patternLabel,
  pitchName,
  pitchStatesForCollection,
} from "../patchIo";
import {
  ResolvedSectionRun,
} from "../resolvedSections";
import {
  CSSProperties,
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export * from "./e2eState";
export * from "./format";
export * from "./timelineRenderModel";
export * from "./transitionHeat";
export * from "./transportConstants";

export const STAFF_PITCH_STEPS = [0, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
export const STAFF_ACCIDENTALS = ["", "♯", "", "♭", "", "", "♯", "", "♭", "", "♭", ""];
export const STAFF_STEP_HEIGHT = 3.35;
export const TREBLE_BOTTOM_LINE_STEP = 30; // E4
export const TREBLE_BOTTOM_LINE_Y = 52;
export const BASS_TOP_LINE_STEP = 26; // A3
export const BASS_TOP_LINE_Y = 82;
export const PITCH_STAFF_TOP = 12;
export const PITCH_STAFF_HEIGHT = 126;
export const PITCH_STAFF_BOTTOM = PITCH_STAFF_HEIGHT - 16;
export const PITCH_STAFF_LEFT = 76;
export const PITCH_STAFF_RIGHT_PAD = 40;
export const PITCH_COLUMN_WIDTH = 46;
export const PITCH_STAFF_MIN_WIDTH = 840;
export const PITCH_PASSAGE_COLUMN_WIDTH = 26;
export const PITCH_PASSAGE_MIN_WIDTH = 360;
/**
 * Pitch notation editor + passage staff and the pitch-collection matching
 * helpers. Extracted verbatim from App.tsx (carve-up round 9).
 */
export function PitchNotationEditor({
  states,
  fallbackIndex,
  collectionId,
  transposition,
  low,
  high,
  fallbackMode,
  fallbackWeights,
  fallbackWeightAutomationTarget,
  showFallbackControls = true,
  renderFallbackWeightAutomationButton,
  onAddPitch,
  onRemovePitch,
  onSetFallback,
  onSetFallbackMode,
  onSetFallbackWeight,
}: {
  states: PitchState[];
  fallbackIndex: number;
  collectionId: string;
  transposition: number;
  low: number;
  high: number;
  fallbackMode: RhythmFallbackMode;
  fallbackWeights: Record<string, number>;
  fallbackWeightAutomationTarget?: (index: number) => string;
  showFallbackControls?: boolean;
  renderFallbackWeightAutomationButton?: (index: number, label: string) => ReactNode;
  onAddPitch: (pitch: number) => void;
  onRemovePitch: (index: number) => void;
  onSetFallback: (index: number) => void;
  onSetFallbackMode: (mode: RhythmFallbackMode) => void;
  onSetFallbackWeight: (index: number, value: number) => void;
}) {
  const [editMode, setEditMode] = useState<
    "notes" | "staticFallback" | "weightedFallback"
  >("notes");
  const [palette, setPalette] = useState<"collection" | "chromatic">("collection");
  const preset = limitedTranspositionPreset(collectionId);
  const lo = clamp(Math.round(Math.min(low, high)), 0, 127);
  const hi = clamp(Math.round(Math.max(low, high)), 0, 127);
  const collectionPitchClasses = new Set(
    preset.pitchClasses.map((pc) => ((pc + transposition) % 12 + 12) % 12)
  );
  const palettePitches =
    palette === "chromatic"
      ? Array.from({ length: hi - lo + 1 }, (_, offset) => lo + offset)
      : Array.from({ length: hi - lo + 1 }, (_, offset) => lo + offset).filter((midi) =>
          collectionPitchClasses.has(midi % 12)
        );
  const visiblePitches = Array.from(
    new Set([...palettePitches, ...states.map((state) => state.pitch)])
  ).sort((a, b) => a - b);
  const stageWidth = Math.max(
    PITCH_STAFF_MIN_WIDTH,
    PITCH_STAFF_LEFT +
      Math.max(visiblePitches.length - 1, 0) * PITCH_COLUMN_WIDTH +
      PITCH_STAFF_RIGHT_PAD
  );
  const staffStart = 54;
  const staffEnd = stageWidth - 24;
  const pitchColumns = visiblePitches.map((midi, index) => {
    const selectedIndex = states.findIndex((state) => state.pitch === midi);
    const selected = selectedIndex >= 0;
    return {
      midi,
      index,
      selectedIndex,
      selected,
      fallback: showFallbackControls && selected && selectedIndex === fallbackIndex,
      outsideCollection: !collectionPitchClasses.has(midi % 12),
      ghost: !selected && palette === "chromatic",
      weight: selected ? Math.round(fallbackWeights[String(selectedIndex)] ?? 0) : 0,
      x: PITCH_STAFF_LEFT + index * PITCH_COLUMN_WIDTH,
      y: clamp(pitchStaffY(midi), PITCH_STAFF_TOP, PITCH_STAFF_BOTTOM),
    };
  });

  const handlePitchAction = (pitch: number) => {
    const selectedIndex = states.findIndex((state) => state.pitch === pitch);
    if (showFallbackControls && editMode === "weightedFallback") {
      if (selectedIndex >= 0) {
        const currentWeight = Math.round(fallbackWeights[String(selectedIndex)] ?? 0);
        onSetFallbackWeight(selectedIndex, currentWeight > 0 ? 0 : 1);
      }
      return;
    }
    if (editMode === "staticFallback") {
      if (selectedIndex >= 0) {
        onSetFallback(selectedIndex);
      }
      return;
    }
    if (selectedIndex >= 0 && states.length > 1) {
      onRemovePitch(selectedIndex);
    } else if (selectedIndex < 0) {
      onAddPitch(pitch);
    }
  };

  const noteActionLabel = (pitch: number, selectedIndex: number) => {
    if (showFallbackControls && editMode === "weightedFallback" && selectedIndex >= 0) {
      const weight = Math.round(fallbackWeights[String(selectedIndex)] ?? 0);
      return `${pitchName(pitch)} fallback weight ${weight}; click to toggle`;
    }
    if (showFallbackControls && editMode === "staticFallback") {
      return selectedIndex >= 0
        ? `set fallback ${pitchName(pitch)}`
        : `${pitchName(pitch)} not in pitch set`;
    }
    if (showFallbackControls && editMode === "weightedFallback") {
      return `${pitchName(pitch)} not in pitch set`;
    }
    if (selectedIndex >= 0) {
      return states.length > 1 ? `remove ${pitchName(pitch)}` : `${pitchName(pitch)} required`;
    }
    return `add ${pitchName(pitch)}`;
  };

  const fallbackState = states[clamp(fallbackIndex, 0, Math.max(0, states.length - 1))];
  const weightedFallbackCount = states.filter(
    (_, index) => Math.round(fallbackWeights[String(index)] ?? 0) > 0
  ).length;

  return (
    <div className="pitch-notation-editor">
      <div className="pitch-notation-toolbar">
        <div className="pitch-notation-segment" role="group" aria-label="Pitch notation tool">
          <button
            className={editMode === "notes" ? "is-active" : ""}
            type="button"
            onClick={() => setEditMode("notes")}
          >
            Notes
          </button>
          {showFallbackControls && (
            <>
              <button
                className={editMode === "staticFallback" ? "is-active" : ""}
                type="button"
                onClick={() => {
                  setEditMode("staticFallback");
                  onSetFallbackMode("static");
                }}
              >
                Static fallback
              </button>
              <button
                className={editMode === "weightedFallback" ? "is-active" : ""}
                type="button"
                onClick={() => {
                  setEditMode("weightedFallback");
                  onSetFallbackMode("weighted");
                }}
              >
                Weighted fallback
              </button>
            </>
          )}
        </div>
        <div className="pitch-notation-segment" role="group" aria-label="Pitch palette">
          <button
            className={palette === "collection" ? "is-active" : ""}
            type="button"
            onClick={() => setPalette("collection")}
          >
            Collection
          </button>
          <button
            className={palette === "chromatic" ? "is-active" : ""}
            type="button"
            onClick={() => setPalette("chromatic")}
          >
            Chromatic
          </button>
        </div>
        <span className="pitch-notation-status">
          {states.length} notes
          {showFallbackControls ? " · " : ""}
          {showFallbackControls && (fallbackMode === "weighted"
            ? `${weightedFallbackCount} weighted fallback`
            : `static fallback ${fallbackState ? pitchName(fallbackState.pitch) : "none"}`)}
        </span>
      </div>
      <div className="pitch-notation-scroll">
        <svg
          className="pitch-notation-svg"
          viewBox={`0 0 ${stageWidth} ${PITCH_STAFF_HEIGHT}`}
          role="group"
          aria-label="Pitch notation editor"
          style={{ width: stageWidth }}
        >
          <rect
            className="pitch-staff-bg"
            x={0}
            y={0}
            width={stageWidth}
            height={PITCH_STAFF_HEIGHT}
            rx={4}
          />
          {[0, 1, 2, 3, 4].map((line) => (
            <line
              className="pitch-staff-line"
              key={`treble-${line}`}
              x1={staffStart}
              x2={staffEnd}
              y1={TREBLE_BOTTOM_LINE_Y - line * STAFF_STEP_HEIGHT * 2}
              y2={TREBLE_BOTTOM_LINE_Y - line * STAFF_STEP_HEIGHT * 2}
            />
          ))}
          {[0, 1, 2, 3, 4].map((line) => (
            <line
              className="pitch-staff-line"
              key={`bass-${line}`}
              x1={staffStart}
              x2={staffEnd}
              y1={BASS_TOP_LINE_Y + line * STAFF_STEP_HEIGHT * 2}
              y2={BASS_TOP_LINE_Y + line * STAFF_STEP_HEIGHT * 2}
            />
          ))}
          <text
            className="pitch-clef-label is-treble"
            x={24}
            y={38}
            aria-label="treble clef"
          >
            𝄞
          </text>
          <text
            className="pitch-clef-label is-bass"
            x={24}
            y={94}
            aria-label="bass clef"
          >
            𝄢
          </text>
          {pitchColumns.map(
            ({
              midi,
              selectedIndex,
              selected,
              fallback,
              outsideCollection,
              ghost,
              x,
              y,
            }) => {
              const accidental = pitchAccidental(midi);
              const inactiveFallbackTarget =
                (editMode === "staticFallback" || editMode === "weightedFallback") &&
                !selected;
              return (
                <g
                  className={`pitch-staff-note${selected ? " is-selected" : ""}${
                    fallback ? " is-fallback" : ""
                  }${outsideCollection ? " is-outside" : ""}${
                    inactiveFallbackTarget ? " is-inactive" : ""
                  }${ghost ? " is-ghost" : ""}`}
                  key={midi}
                  role="button"
                  tabIndex={0}
                  aria-label={noteActionLabel(midi, selectedIndex)}
                  aria-disabled={inactiveFallbackTarget}
                  onClick={() => handlePitchAction(midi)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handlePitchAction(midi);
                    }
                  }}
                >
                  <title>
                    {pitchName(midi)}
                    {selected ? " selected" : " available"}
                    {outsideCollection ? " outside collection" : ""}
                    {fallback ? " fallback" : ""}
                  </title>
                  <circle className="pitch-note-hit-area" cx={x} cy={y} r={11.5} />
                  {pitchStaffLedgerYs(midi).map((ledgerY) => {
                    const clampedLedgerY = clamp(ledgerY, PITCH_STAFF_TOP, PITCH_STAFF_BOTTOM);
                    return (
                      <line
                        className="pitch-ledger-line"
                        key={`${midi}-${ledgerY}`}
                        x1={x - 9}
                        x2={x + 9}
                        y1={clampedLedgerY}
                        y2={clampedLedgerY}
                      />
                    );
                  })}
                  {accidental && (
                    <text className="pitch-accidental" x={x - 15} y={y + 3}>
                      {accidental}
                    </text>
                  )}
                  <ellipse
                    className="pitch-notehead"
                    cx={x}
                    cy={y}
                    rx={6}
                    ry={3.5}
                    transform={`rotate(-18 ${x} ${y})`}
                  />
                </g>
              );
            }
          )}
        </svg>
        {showFallbackControls && fallbackMode === "weighted" && (
          <div
            className="pitch-weight-grid"
            style={
              {
                gridTemplateColumns: `${PITCH_STAFF_LEFT}px repeat(${visiblePitches.length}, ${PITCH_COLUMN_WIDTH}px) ${PITCH_STAFF_RIGHT_PAD}px`,
                width: stageWidth,
              } as CSSProperties
            }
          >
            <span className="pitch-weight-gutter">Weight</span>
            {pitchColumns.map(({ midi, selected, selectedIndex, weight }) =>
              selected ? (
                <label
                  className={`pitch-weight-cell${weight > 0 ? " is-active" : ""}`}
                  key={`weight-${midi}`}
                >
                  <span className="label-with-automation">
                    <span>{pitchName(midi)}</span>
                    {renderFallbackWeightAutomationButton?.(
                      selectedIndex,
                      pitchName(midi)
                    )}
                  </span>
                  <NumericField
                    aria-label={`${pitchName(midi)} fallback weight`}
                    min={0}
                    max={999}
                    numericMode="weight"
                    step={1}
                    value={weight}
                    data-automation-target={fallbackWeightAutomationTarget?.(
                      selectedIndex
                    )}
                    onValueCommit={(value) =>
                      onSetFallbackWeight(
                        selectedIndex,
                        value
                      )
                    }
                  />
                </label>
              ) : (
                <span
                  aria-hidden="true"
                  className="pitch-weight-cell is-empty"
                  key={`weight-${midi}`}
                />
              )
            )}
            <span aria-hidden="true" />
          </div>
        )}
      </div>
      {showFallbackControls && fallbackMode === "weighted" && (
        <div className="pitch-notation-fallback-pool">
          <strong>Weighted fallback pool</strong>
          <span>
            Edit the aligned weight lane below the staff, or use Weighted fallback
            and click selected noteheads to toggle 0/1.
          </span>
        </div>
      )}
    </div>
  );
}

// Staff-notation view of a Learn-from-passage melody: the entered notes are
// drawn left-to-right as noteheads (repeats and order preserved); clicking a
// note removes it. Reuses the same staff geometry as the pitch-set editor.
export function PitchPassageStaff({
  notes,
  onRemoveAt,
}: {
  notes: number[];
  onRemoveAt: (index: number) => void;
}) {
  const columns = notes.map((midi, index) => ({
    midi,
    index,
    x: PITCH_STAFF_LEFT + index * PITCH_PASSAGE_COLUMN_WIDTH,
    y: clamp(pitchStaffY(midi), PITCH_STAFF_TOP, PITCH_STAFF_BOTTOM),
  }));
  const stageWidth = Math.max(
    PITCH_PASSAGE_MIN_WIDTH,
    PITCH_STAFF_LEFT + notes.length * PITCH_PASSAGE_COLUMN_WIDTH + PITCH_STAFF_RIGHT_PAD
  );
  const staffStart = 54;
  const staffEnd = stageWidth - 18;

  return (
    <div className="pitch-passage-scroll">
      <svg
        className="pitch-notation-svg pitch-passage-svg"
        viewBox={`0 0 ${stageWidth} ${PITCH_STAFF_HEIGHT}`}
        role="group"
        aria-label="Passage notation"
        style={{ width: stageWidth }}
      >
        <rect
          className="pitch-staff-bg"
          x={0}
          y={0}
          width={stageWidth}
          height={PITCH_STAFF_HEIGHT}
          rx={4}
        />
        {[0, 1, 2, 3, 4].map((line) => (
          <line
            className="pitch-staff-line"
            key={`p-treble-${line}`}
            x1={staffStart}
            x2={staffEnd}
            y1={TREBLE_BOTTOM_LINE_Y - line * STAFF_STEP_HEIGHT * 2}
            y2={TREBLE_BOTTOM_LINE_Y - line * STAFF_STEP_HEIGHT * 2}
          />
        ))}
        {[0, 1, 2, 3, 4].map((line) => (
          <line
            className="pitch-staff-line"
            key={`p-bass-${line}`}
            x1={staffStart}
            x2={staffEnd}
            y1={BASS_TOP_LINE_Y + line * STAFF_STEP_HEIGHT * 2}
            y2={BASS_TOP_LINE_Y + line * STAFF_STEP_HEIGHT * 2}
          />
        ))}
        <text className="pitch-clef-label is-treble" x={22} y={38} aria-label="treble clef">
          𝄞
        </text>
        <text className="pitch-clef-label is-bass" x={22} y={94} aria-label="bass clef">
          𝄢
        </text>
        {columns.length === 0 ? (
          <text className="pitch-passage-empty" x={staffStart + 8} y={PITCH_STAFF_HEIGHT / 2}>
            Click pitches below or type above to build a passage
          </text>
        ) : (
          columns.map(({ midi, index, x, y }) => {
            const accidental = pitchAccidental(midi);
            return (
              <g
                className="pitch-staff-note is-selected is-passage-note"
                key={`${index}-${midi}`}
                role="button"
                tabIndex={0}
                aria-label={`Remove ${pitchName(midi)} at position ${index + 1}`}
                onClick={() => onRemoveAt(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRemoveAt(index);
                  }
                }}
              >
                <title>
                  {pitchName(midi)} · position {index + 1} · click to remove
                </title>
                <circle className="pitch-note-hit-area" cx={x} cy={y} r={11.5} />
                {pitchStaffLedgerYs(midi).map((ledgerY) => {
                  const clampedLedgerY = clamp(ledgerY, PITCH_STAFF_TOP, PITCH_STAFF_BOTTOM);
                  return (
                    <line
                      className="pitch-ledger-line"
                      key={`${index}-${ledgerY}`}
                      x1={x - 9}
                      x2={x + 9}
                      y1={clampedLedgerY}
                      y2={clampedLedgerY}
                    />
                  );
                })}
                {accidental && (
                  <text className="pitch-accidental" x={x - 15} y={y + 3}>
                    {accidental}
                  </text>
                )}
                <ellipse
                  className="pitch-notehead"
                  cx={x}
                  cy={y}
                  rx={6}
                  ry={3.5}
                  transform={`rotate(-18 ${x} ${y})`}
                />
                <text className="pitch-passage-index" x={x} y={PITCH_STAFF_HEIGHT - 4}>
                  {index + 1}
                </text>
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}

export function pitchStatesMatchCollection(
  states: PitchState[],
  collectionId: string,
  transposition: number,
  low: number,
  high: number
): boolean {
  const collectionStates = pitchStatesForCollection(collectionId, transposition, low, high);
  return (
    states.length === collectionStates.length &&
    states.every((state, index) => state.pitch === collectionStates[index]?.pitch)
  );
}

// Build the engine PitchCollection (degree lattice + tonic) from a collection
// id and tonic offset. This is the single mapping the UI sends to the backend.

export function clonePitchStates(states: PitchState[]): PitchState[] {
  return states.map((state) => ({
    pitch: clamp(Math.round(state.pitch), 0, 127),
    label: state.label || pitchName(state.pitch),
  }));
}


export function cloneWeightedMidiPitches(value: WeightedMidiPitch[]): WeightedMidiPitch[] {
  return normalizeWeightedMidiPitches(value, DEFAULT_GRACE_PITCH_POOL);
}

export function cloneGraceTransposeIntervals(value: WeightedPitchInterval[]): WeightedPitchInterval[] {
  return normalizeGraceTransposeIntervals(value, DEFAULT_GRACE_TRANSPOSE_INTERVALS);
}








// Tighter columns for the left-to-right passage sequence (can be long).





export function pitchAccidental(midi: number): string {
  return STAFF_ACCIDENTALS[clamp(Math.round(midi), 0, 127) % 12] ?? "";
}






export function pitchStaffLedgerYs(midi: number): number[] {
  const step = pitchStaffStep(midi);
  const ys: number[] = [];
  if (midi >= 60) {
    for (let lineStep = 28; lineStep >= step; lineStep -= 2) {
      ys.push(TREBLE_BOTTOM_LINE_Y - (lineStep - TREBLE_BOTTOM_LINE_STEP) * STAFF_STEP_HEIGHT);
    }
    for (let lineStep = 40; lineStep <= step; lineStep += 2) {
      ys.push(TREBLE_BOTTOM_LINE_Y - (lineStep - TREBLE_BOTTOM_LINE_STEP) * STAFF_STEP_HEIGHT);
    }
  } else {
    for (let lineStep = 16; lineStep >= step; lineStep -= 2) {
      ys.push(BASS_TOP_LINE_Y - (lineStep - BASS_TOP_LINE_STEP) * STAFF_STEP_HEIGHT);
    }
    for (let lineStep = 28; lineStep <= step; lineStep += 2) {
      ys.push(BASS_TOP_LINE_Y - (lineStep - BASS_TOP_LINE_STEP) * STAFF_STEP_HEIGHT);
    }
  }
  return ys;
}

export function pitchStaffY(midi: number): number {
  const step = pitchStaffStep(midi);
  if (midi >= 60) {
    return TREBLE_BOTTOM_LINE_Y - (step - TREBLE_BOTTOM_LINE_STEP) * STAFF_STEP_HEIGHT;
  }
  return BASS_TOP_LINE_Y - (step - BASS_TOP_LINE_STEP) * STAFF_STEP_HEIGHT;
}


export const DEFAULT_RATCHET_POSITION_PROBABILITY = 100;

export const DEFAULT_RATCHET_POSITION_SPEED = 100;

export const DEFAULT_RATCHET_SPAN_GATE_LIMITS: RatchetSpanGateLimit[] =
  RHYTHM_LENGTHS.map((subdivision) => ({
    subdivision,
    maxSpanMatras: DEFAULT_RATCHET_MAX_SPAN_MATRAS,
  }));

export const DELAY_DISTRIBUTION_LABELS: Record<DelayTimeDistribution, string> = {
  uniform: "uniform",
  early: "early bias",
  late: "late bias",
  center: "center bias",
  edges: "edge bias",
};

export const PITCH_COLLECTION_GROUPS = Array.from(
  new Set(LIMITED_TRANSPOSITION_COLLECTIONS.map((preset) => preset.group))
);

export const PITCH_STATE_ADD_OCTAVES = Array.from({ length: 11 }, (_, index) => index - 1);

export const PITCH_STATE_DEFAULT_ADD_OCTAVE = 4;

export const PITCH_STATE_LIMIT = 24;
// Stable display order for the grouped collection picker follows preset order.

export type PatchPersistenceState =
  | "checking"
  | "saved"
  | "unsaved"
  | "autosaving"
  | "autosaved";

/** How the results popover is placed to stay inside its scroll/viewport clip. */
export interface PitchCollectionMenuPlacement {
  direction: "down" | "up";
  maxHeight: number;
}

export const PITCH_COLLECTION_MENU_DESIRED_HEIGHT = 330;
export const PITCH_COLLECTION_MENU_MIN_HEIGHT = 132;
export const PITCH_COLLECTION_MENU_GAP = 8;

/**
 * Pure placement math: given the control's vertical bounds and the top/bottom of
 * the nearest clip (scroll ancestor or viewport), decide whether the results
 * popover opens down or up and how tall it may be. Kept side-effect-free so the
 * clip/flip logic is unit-testable without a real layout (jsdom has none).
 */
export function fitPitchCollectionMenu(
  controlTop: number,
  controlBottom: number,
  clipTop: number,
  clipBottom: number
): PitchCollectionMenuPlacement {
  const spaceBelow = clipBottom - controlBottom - PITCH_COLLECTION_MENU_GAP;
  const spaceAbove = controlTop - clipTop - PITCH_COLLECTION_MENU_GAP;
  // Prefer opening downward; flip up only when below is cramped and above is roomier.
  const openUp =
    spaceBelow < PITCH_COLLECTION_MENU_MIN_HEIGHT && spaceAbove > spaceBelow;
  const available = Math.floor(openUp ? spaceAbove : spaceBelow);
  const maxHeight = Math.max(
    PITCH_COLLECTION_MENU_MIN_HEIGHT,
    Math.min(PITCH_COLLECTION_MENU_DESIRED_HEIGHT, available)
  );
  return { direction: openUp ? "up" : "down", maxHeight };
}

/**
 * The results list is `position: absolute` and can render taller than the
 * nearest scrolling/clipping ancestor (e.g. the Pitch Map `.shaper-body`, which
 * is `overflow: hidden auto`). When it does, the ancestor clips the overflow and
 * the lower options become unclickable. Measure the space above/below the
 * control within that clip and cap the popover height (and flip it upward when
 * there is more room above) so every option stays inside the clip and reachable
 * via the popover's own internal scroll.
 */
function computePitchCollectionMenuPlacement(
  control: HTMLElement
): PitchCollectionMenuPlacement {
  const rect = control.getBoundingClientRect();
  let clipTop = 0;
  let clipBottom =
    window.innerHeight || document.documentElement.clientHeight || rect.bottom;
  for (
    let node = control.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const style = window.getComputedStyle(node);
    const clipsY =
      style.overflowY === "auto" ||
      style.overflowY === "scroll" ||
      style.overflowY === "hidden" ||
      style.overflow === "auto" ||
      style.overflow === "scroll" ||
      style.overflow === "hidden";
    if (clipsY) {
      const nodeRect = node.getBoundingClientRect();
      clipTop = Math.max(clipTop, nodeRect.top);
      clipBottom = Math.min(clipBottom, nodeRect.bottom);
    }
  }
  return fitPitchCollectionMenu(rect.top, rect.bottom, clipTop, clipBottom);
}

export function PitchCollectionSearchDropdown({
  value,
  presets,
  groups,
  onChange,
}: {
  value: string;
  presets: readonly PitchCollectionPresetOption[];
  groups: readonly string[];
  onChange: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPlacement, setMenuPlacement] =
    useState<PitchCollectionMenuPlacement>({
      direction: "down",
      maxHeight: PITCH_COLLECTION_MENU_DESIRED_HEIGHT,
    });
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === value) ?? presets[0] ?? null,
    [presets, value]
  );
  const searchablePresets = useMemo(
    () =>
      presets.map((preset) => ({
        preset,
        searchText: pitchCollectionSearchText(preset),
      })),
    [presets]
  );
  const filteredPresets = useMemo(() => {
    const tokens = normalizePitchCollectionSearch(query)
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) {
      return presets;
    }
    return searchablePresets
      .filter(({ searchText }) => tokens.every((token) => searchText.includes(token)))
      .map(({ preset }) => preset);
  }, [presets, query, searchablePresets]);
  const visiblePresets = filteredPresets.slice(
    0,
    PITCH_COLLECTION_SEARCH_RESULT_LIMIT
  );
  const activePreset = open ? visiblePresets[activeIndex] ?? null : null;
  const listboxId = "pitch-collection-search-results";

  useEffect(() => {
    setActiveIndex(0);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: Event) => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Keep the results popover inside the nearest scroll/viewport clip so no option
  // is clipped and unclickable (Pitch Map's `.shaper-body` is `overflow: auto`).
  useLayoutEffect(() => {
    if (!open) return;
    const control = rootRef.current;
    if (!control) return;
    const recompute = () =>
      setMenuPlacement(computePitchCollectionMenuPlacement(control));
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open]);

  const choosePreset = useCallback(
    (preset: PitchCollectionPresetOption) => {
      onChange(preset.id);
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    },
    [onChange]
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setQuery("");
        return;
      }
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(0, visiblePresets.length - 1))
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setQuery("");
        return;
      }
      setActiveIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === "Enter") {
      if (open && activePreset) {
        event.preventDefault();
        choosePreset(activePreset);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  return (
    <div className="field-inline pitch-mode-search-field">
      <span>Collection</span>
      <div
        className={`pitch-mode-combobox${open ? " is-open" : ""}`}
        ref={rootRef}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            rootRef.current?.contains(event.relatedTarget)
          ) {
            return;
          }
          setOpen(false);
          setQuery("");
        }}
      >
        <div className="pitch-mode-combobox-control">
          <input
            ref={inputRef}
            role="combobox"
            aria-label="Collection"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={
              activePreset ? pitchCollectionResultId(activePreset.id) : undefined
            }
            autoComplete="off"
            spellCheck={false}
            value={open ? query : selectedPreset?.label ?? ""}
            placeholder={selectedPreset ? "Search modes" : "No modes available"}
            onFocus={() => {
              setOpen(true);
              setQuery("");
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            aria-label={open ? "Close mode search" : "Open mode search"}
            title={open ? "Close mode search" : "Open mode search"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setOpen((current) => !current);
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <span aria-hidden="true" className="pitch-mode-combobox-caret" />
          </button>
        </div>
        {open && (
          <div
            className={`pitch-mode-results pitch-mode-results--${menuPlacement.direction}`}
            id={listboxId}
            role="listbox"
            aria-label="Pitch collection results"
            style={{ maxHeight: `${menuPlacement.maxHeight}px` }}
          >
            {visiblePresets.length > 0 ? (
              <>
                {groups.map((group) => {
                  const groupPresets = visiblePresets.filter(
                    (preset) => preset.group === group
                  );
                  if (groupPresets.length === 0) return null;
                  return (
                    <div className="pitch-mode-result-group" key={group}>
                      <span className="pitch-mode-result-group-label">{group}</span>
                      {groupPresets.map((preset) => {
                        const visibleIndex = visiblePresets.findIndex(
                          (item) => item.id === preset.id
                        );
                        const active = visibleIndex === activeIndex;
                        const selected = preset.id === value;
                        const pitchClassNames = preset.pitchClasses
                          .map(
                            (pitchClass) =>
                              PITCH_NAMES[((pitchClass % 12) + 12) % 12]
                          )
                          .join(" ");
                        return (
                          <button
                            className={`pitch-mode-result${
                              active ? " is-active" : ""
                            }${selected ? " is-selected" : ""}`}
                            id={pitchCollectionResultId(preset.id)}
                            key={preset.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onMouseEnter={() => setActiveIndex(visibleIndex)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => choosePreset(preset)}
                          >
                            <strong>{preset.label}</strong>
                            <span>
                              {preset.group} · {pitchClassNames}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {filteredPresets.length > visiblePresets.length && (
                  <p className="pitch-mode-result-hint">
                    Showing {visiblePresets.length} of {filteredPresets.length} matches
                  </p>
                )}
              </>
            ) : (
              <p className="pitch-mode-result-empty">No matching modes</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
// The transport sends authoritative snapshots over IPC; the timeline advances
// locally between them so the visual playhead stays aligned with MIDI timing.

export const RATCHET_MAX_SPAN_MATRAS_UI_LIMIT = 16;

export const RATCHET_RATE_PREVIEW_GATIS = [3, 4, 5, 7, 9, 11];

export const RHYTHM_ARTICULATION_BLEND_LABELS: Record<
  RhythmArticulationBlendMode,
  string
> = {
  manualOverrides: "Manual wins",
  average: "Average",
  weighted: "Weighted",
};

export const RHYTHM_EXTRAPOLATION_LABELS: Record<RhythmExtrapolationStrategy, string> = {
  boundaryProjection: "Boundary projection",
  densityPreserving: "Density preserving",
  shapePreserving: "Shape preserving",
  hybridTransport: "Hybrid transport",
  sparseNearest: "Sparse nearest",
};

export const RHYTHM_PASSAGE_STRATEGY_LABELS: Record<RhythmPassageStrategy, string> = {
  metricChunks: "Metric chunks",
  pulseWindows: "Pulse-boundary windows",
  matraWindows: "Dense pulse windows",
  hybridVocabulary: "Hybrid vocabulary",
};

export type RhythmArticulationBlendWeightField =
  | "manualWeight"
  | "fragmentWeight"
  | "sectionWeight"
  | "cycleWeight";

export function RhythmContextGlyph({
  states,
  context,
}: {
  states: RhythmPattern[];
  context: number[];
}) {
  return (
    <span className="pattern-context" aria-label={`context ${context.join(" then ")}`}>
      {context.map((stateIndex, index) => (
        <span className="pattern-context-item" key={`${stateIndex}-${index}`}>
          <RhythmPatternGlyph pattern={states[stateIndex]!} compact />
        </span>
      ))}
    </span>
  );
}

export function RhythmPatternGlyph({
  pattern,
  compact = false,
}: {
  pattern: RhythmPattern;
  compact?: boolean;
}) {
  const total = pattern.pulses.reduce((sum, pulse) => sum + pulse, 0) || 1;
  return (
    <span
      className={`pattern-glyph${compact ? " is-compact" : ""}`}
      title={patternLabel(pattern)}
      aria-label={`rhythm pattern ${patternLabel(pattern)}`}
    >
      {pattern.pulses.map((pulse, index) => (
        <i
          key={`${pulse}-${index}`}
          style={{ flexGrow: pulse, flexBasis: `${(pulse / total) * 100}%` }}
        >
          <b>{pulse}</b>
        </i>
      ))}
    </span>
  );
}

export type RhythmPositionArticulationSetter = Dispatch<
  SetStateAction<RhythmPositionArticulationState>
>;


export type SectionInspectorEntry =
  | {
      key: "initial";
      kind: "initial";
      label: string;
      detail: string;
      startBeat: number;
      resolvedSection?: ResolvedSectionRun;
    }
  | {
      key: string;
      kind: "boundary";
      label: string;
      detail: string;
      startBeat: number;
      index: number;
      boundary: BoundaryPoint;
      resolvedSection?: ResolvedSectionRun;
    };

export type SectionInspectorLayer = "boundary" | "subdivision" | "jathi" | "bhedam";

export type SeedStreamTab = Exclude<SeedDialogTab, "log">;

export function applyRatchetProbabilityModifier(
  probability: number,
  value: number,
  operation: RatchetModifierOperation
): number {
  return operation === "add"
    ? clamp(probability + value, 0, 1)
    : clamp(probability * Math.max(0, value), 0, 1);
}

export function cloneRatchetModifiers(
  modifiers: RatchetProbabilityModifiers
): RatchetProbabilityModifiers {
  return {
    slowNote: { ...modifiers.slowNote },
    fastNote: { ...modifiers.fastNote },
    position: {
      enabled: modifiers.position.enabled,
      points: modifiers.position.points.map((point) => ({ ...point })),
    },
    accentSpanStart: modifiers.accentSpanStart,
    accentSpanEnd: modifiers.accentSpanEnd,
    sectionStart: modifiers.sectionStart,
    sectionEnd: modifiers.sectionEnd,
    cycleStart: modifiers.cycleStart,
    cycleEnd: modifiers.cycleEnd,
    operations: { ...modifiers.operations },
  };
}

export function cloneRatchetSpanGateLimits(
  limits: RatchetSpanGateLimit[]
): RatchetSpanGateLimit[] {
  return limits.map((limit) => ({ ...limit }));
}

export function cloneRhythmArticulationBlendState(
  state: RhythmArticulationBlendState
): RhythmArticulationBlendState {
  return { ...state };
}

export function cloneRhythmArticulationCells(
  cells: Record<string, RhythmArticulationCellState>
): Record<string, RhythmArticulationCellState> {
  return Object.fromEntries(
    Object.entries(cells).map(([key, value]) => [key, { ...value }])
  );
}

export function cloneRhythmArticulationNeighborState(
  state: RhythmArticulationNeighborState
): RhythmArticulationNeighborState {
  return { ...state };
}

export function cloneRhythmPositionArticulationState(
  state: RhythmPositionArticulationState
): RhythmPositionArticulationState {
  return {
    single: cloneRhythmArticulationProbabilityState(state.single),
    first: cloneRhythmArticulationProbabilityState(state.first),
    middle: cloneRhythmArticulationProbabilityState(state.middle),
    last: cloneRhythmArticulationProbabilityState(state.last),
  };
}

// defaultPatchFilename, defaultScoreFilename, defaultTrackFilename, and
// fileNameFromPath now live in ./filenames (pure + unit-tested).

export function gracePlacementBeforePercent(weights: GraceNotePlacementWeights): number {
  const beforeBeat = Math.max(0, weights.beforeBeat);
  const onBeat = Math.max(0, weights.onBeat);
  const total = beforeBeat + onBeat;
  if (total <= 0) return 100;
  return clamp(Math.round((beforeBeat / total) * 100), 0, 100);
}

export function midiPitchInOctave(pitchClass: number, octave: number): number {
  const pc = ((Math.round(pitchClass) % 12) + 12) % 12;
  return clamp((Math.round(octave) + 1) * 12 + pc, 0, 127);
}

export function parsePassagePulses(input: string): number[] {
  return input
    .replace(/[[\]]/g, " ")
    .split(/[\s,]+/)
    .map((part) => parseInt(part.trim(), 10))
    .filter((pulse) => Number.isFinite(pulse));
}

export function parsePitchPassage(input: string, defaultOctave: number): number[] {
  return input
    .split(/[\s,]+/)
    .map((token) => parsePassageNote(token, defaultOctave))
    .filter((midi): midi is number => midi !== null);
}

export function pitchStaffStep(midi: number): number {
  const pitch = clamp(Math.round(midi), 0, 127);
  const octave = Math.floor(pitch / 12) - 1;
  return octave * 7 + (STAFF_PITCH_STEPS[pitch % 12] ?? 0);
}


export function ratchetModifierGraph(
  value: number,
  operation: RatchetModifierOperation
): { fill: { left: string; width: string }; marker: string } {
  if (operation === "add") {
    const amount = clamp(value, -1, 1);
    return {
      fill: {
        left: `${amount < 0 ? 50 + amount * 50 : 50}%`,
        width: `${Math.abs(amount) * 50}%`,
      },
      marker: "50%",
    };
  }
  return {
    fill: {
      left: "0%",
      width: `${clamp(value / 3, 0, 1) * 100}%`,
    },
    marker: `${100 / 3}%`,
  };
}

export function ratchetModifierNeutral(operation: RatchetModifierOperation): number {
  return operation === "add" ? 0 : 1;
}

export const PITCH_COLLECTION_SEARCH_RESULT_LIMIT = 96;

export type PitchCollectionPresetOption =
  (typeof LIMITED_TRANSPOSITION_COLLECTIONS)[number];


export function cloneRhythmArticulationProbabilityState(
  value: RhythmArticulationProbabilityState
): RhythmArticulationProbabilityState {
  return { ...value };
}

export function normalizePitchCollectionSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function parsePassageNote(token: string, defaultOctave: number): number | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (/^-?\d+$/.test(trimmed)) {
    const midi = parseInt(trimmed, 10);
    return Number.isFinite(midi) ? clamp(midi, 0, 127) : null;
  }
  const match = /^([A-Ga-g])([#b♯♭]*)(-?\d+)?$/.exec(trimmed);
  if (!match) return null;
  const base = NOTE_NAME_PITCH_CLASSES[match[1]!.toLowerCase()];
  if (base === undefined) return null;
  let accidental = 0;
  for (const ch of match[2] ?? "") {
    if (ch === "#" || ch === "♯") accidental += 1;
    else if (ch === "b" || ch === "♭") accidental -= 1;
  }
  const octave = match[3] !== undefined ? parseInt(match[3], 10) : defaultOctave;
  return clamp((octave + 1) * 12 + base + accidental, 0, 127);
}

// Parse a whitespace/comma separated pitch passage into MIDI pitches.

export function pitchCollectionResultId(id: string): string {
  return `pitch-collection-option-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function pitchCollectionSearchText(preset: PitchCollectionPresetOption): string {
  const pitchClassNames = preset.pitchClasses
    .map((pitchClass) => PITCH_NAMES[((pitchClass % 12) + 12) % 12])
    .join(" ");
  return normalizePitchCollectionSearch(
    `${preset.id.replace(/-/g, " ")} ${preset.group} ${preset.label} ${
      preset.pitchClasses.join(" ")
    } ${pitchClassNames}`
  );
}

export const NOTE_NAME_PITCH_CLASSES: Record<string, number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};

// Parse one passage token to a MIDI pitch. Accepts note names with optional
// accidental(s) and octave (`C4`, `Eb3`, `F#5`, `Bbb2`), bare note names
// (placed in `defaultOctave`), and plain integers (MIDI note numbers).
// Returns null for tokens that are not pitches.
