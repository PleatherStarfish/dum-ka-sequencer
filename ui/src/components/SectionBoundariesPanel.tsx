/**
 * Deterministic Sections & Subdivisions editor: cycle map, fixed section
 * inspector, and velocity-accent controls.
 */
import {
  NumericField,
} from "../NumericField";
import { JathiWeight, SubdivisionWeight } from "../bridge";
import {
  BoundaryPoint,
  clamp,
} from "../patchIo";
import {
  ResolvedSectionRun,
} from "../resolvedSections";
import {
  VelocityAccentControl,
} from "./AccentControls";
import {
  PanelHeader,
  type PanelStatusStripEntry,
} from "./MainEditorChrome";
import {
  SectionInspectorEntry,
} from "./PitchNotation";
import {
  fixedGroupingFromWeights,
  fixedSubdivisionFromWeights,
} from "../sectionsSubdivisionsLogic";
import { useEffect, useRef, useState } from "react";
import { useEditorDraftLifecycle } from "../editorDraftFlush";

export interface SectionBoundariesPanelProps {
  /** Cycle core (merged from the former Cycle editor). */
  name: string;
  onNameChange: (name: string) => void;
  onCycleBeatsChange: (beats: number) => void;
  pitch: number;
  onPitchChange: (pitch: number) => void;
  velocity: number;
  onVelocityChange: (velocity: number) => void;
  renderAutomationControlLabel: (
    label: string,
    title: string,
    targets: string[]
  ) => React.ReactNode;
  activeSectionInspectorEntry: SectionInspectorEntry;
  addBoundary: () => void;
  beatAccentMax: number;
  beatAccentMin: number;
  boundariesOpen: boolean;
  boundaryStatusStrip: PanelStatusStripEntry[];
  cycleBeats: number;
  initialJathiWeights: JathiWeight[];
  initialWeights: SubdivisionWeight[];
  jathiAccentMax: number;
  jathiAccentMin: number;
  jathiAccentMode: "overrideGati" | "layered";
  normalizedBoundaries: BoundaryPoint[];
  playbackStructureLocked: boolean;
  renderAutomationFocusButton: (title: string, targetIds: Array<string | null | undefined>) => JSX.Element | null;
  renderSectionInspector: (entry: SectionInspectorEntry) => JSX.Element;
  resolvedSections: ResolvedSectionRun[];
  sectionAccentMax: number;
  sectionAccentMin: number;
  sectionInspectorEntries: SectionInspectorEntry[];
  setBeatAccentMax: React.Dispatch<React.SetStateAction<number>>;
  setBeatAccentMin: React.Dispatch<React.SetStateAction<number>>;
  setBoundariesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setJathiAccentMax: React.Dispatch<React.SetStateAction<number>>;
  setJathiAccentMin: React.Dispatch<React.SetStateAction<number>>;
  setJathiAccentMode: React.Dispatch<React.SetStateAction<"overrideGati" | "layered">>;
  setSectionAccentMax: React.Dispatch<React.SetStateAction<number>>;
  setSectionAccentMin: React.Dispatch<React.SetStateAction<number>>;
  setSectionInspectorKey: React.Dispatch<React.SetStateAction<string>>;
}

export function SectionBoundariesPanel({
  name,
  onNameChange,
  onCycleBeatsChange,
  pitch,
  onPitchChange,
  velocity,
  onVelocityChange,
  renderAutomationControlLabel,
  activeSectionInspectorEntry,
  addBoundary,
  beatAccentMax,
  beatAccentMin,
  boundariesOpen,
  boundaryStatusStrip,
  cycleBeats,
  initialJathiWeights,
  initialWeights,
  jathiAccentMax,
  jathiAccentMin,
  jathiAccentMode,
  normalizedBoundaries,
  playbackStructureLocked,
  renderAutomationFocusButton,
  renderSectionInspector,
  resolvedSections,
  sectionAccentMax,
  sectionAccentMin,
  sectionInspectorEntries,
  setBeatAccentMax,
  setBeatAccentMin,
  setBoundariesOpen,
  setJathiAccentMax,
  setJathiAccentMin,
  setJathiAccentMode,
  setSectionAccentMax,
  setSectionAccentMin,
  setSectionInspectorKey,
}: SectionBoundariesPanelProps) {
  const [nameDraft, setNameDraft] = useState(name);
  const cancelNameCommitRef = useRef(false);
  useEditorDraftLifecycle({
    flush: () => {
      if (cancelNameCommitRef.current) {
        cancelNameCommitRef.current = false;
        setNameDraft(name);
      } else if (nameDraft !== name) {
        onNameChange(nameDraft);
      }
    },
    discard: () => {
      cancelNameCommitRef.current = false;
      setNameDraft(name);
    },
  });

  useEffect(() => {
    setNameDraft(name);
  }, [name]);

  return (
        <details
          id="section-boundaries-panel"
          className="modal-surface modal-surface--full main-editor-surface editor-panel panel-state panel-state-boundaries"
          role="dialog"
          aria-label="Sections and subdivisions editor"
          aria-modal={boundariesOpen}
          open={boundariesOpen}
          onToggle={(event) => setBoundariesOpen(event.currentTarget.open)}
        >
          <summary className="editor-panel-summary">
            <PanelHeader
              icon="boundaries"
              title="Sections and Subdivisions"
              subtitle={
                <>
                  {normalizedBoundaries.length} boundaries · {resolvedSections.length}{" "}
                  sections
                </>
              }
              strip={boundaryStatusStrip}
            />
          </summary>
          {boundariesOpen ? (
          <div className="editor-panel-body">
            {/* Cycle core — merged from the former Cycle editor: identity and
                the base note in one row, tempo flux beside it. */}
            <div className="cycle-core-bar" aria-label="Cycle setup">
              <div className="cycle-core-grid">
                <label className="cycle-name-control">
                  Cycle name
                  <input
                    type="text"
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={(event) => {
                      if (cancelNameCommitRef.current) {
                        cancelNameCommitRef.current = false;
                        setNameDraft(name);
                        return;
                      }
                      const nextName = event.currentTarget.value;
                      if (nextName !== name) {
                        onNameChange(nextName);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      } else if (event.key === "Escape") {
                        cancelNameCommitRef.current = true;
                        setNameDraft(name);
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </label>
                <label className="cycle-number-control">
                  <span>Beats/cycle</span>
                  <NumericField
                    min={1}
                    max={64}
                    value={cycleBeats}
                    disabled={playbackStructureLocked}
                    onValueCommit={(value) => onCycleBeatsChange(value)}
                  />
                </label>
                <label className="cycle-number-control">
                  {renderAutomationControlLabel("Base pitch", "Base pitch", [
                    "sequencer.pitch",
                  ])}
                  <NumericField
                    min={0}
                    max={127}
                    value={pitch}
                    data-automation-target="sequencer.pitch"
                    onValueCommit={(value) => onPitchChange(clamp(value, 0, 127))}
                  />
                </label>
                <label className="cycle-number-control">
                  {renderAutomationControlLabel("Velocity", "Velocity", [
                    "sequencer.velocity",
                  ])}
                  <NumericField
                    min={1}
                    max={127}
                    value={velocity}
                    data-automation-target="sequencer.velocity"
                    onValueCommit={(value) =>
                      onVelocityChange(clamp(value, 1, 127))
                    }
                  />
                </label>
              </div>
            </div>
            <div className="section-accent-bar" aria-label="Section accents">
              <div className="section-accent-logic">
                <span className="section-accent-label">Accent mode</span>
                <div className="section-logic-controls">
                <label className="section-jathi-mode">
                  Grouping
                  <select
                    aria-label="Grouping mode"
                    value={jathiAccentMode}
                    onChange={(e) =>
                      setJathiAccentMode(e.target.value as "overrideGati" | "layered")
                    }
                  >
                    <option value="overrideGati">Override subdivision</option>
                    <option value="layered">Layer accents</option>
                  </select>
                </label>
                </div>
              </div>
              <div className="section-accent-strip" aria-label="Velocity accents">
                <span className="section-accent-label">Velocity accents</span>
                <div className="section-accent-controls">
                <VelocityAccentControl
                  label="Section"
                  min={sectionAccentMin}
                  max={sectionAccentMax}
                  minAutomationTarget="sequencer.accent.sectionStartExtra.min"
                  maxAutomationTarget="sequencer.accent.sectionStartExtra.max"
                  automationFocusButton={renderAutomationFocusButton(
                    "Section extra accent",
                    [
                      "sequencer.accent.sectionStartExtra.min",
                      "sequencer.accent.sectionStartExtra.max",
                    ]
                  )}
                  onChange={(next) => {
                    setSectionAccentMin(next.min);
                    setSectionAccentMax(next.max);
                  }}
                />
                <VelocityAccentControl
                  label="Subdivision"
                  min={beatAccentMin}
                  max={beatAccentMax}
                  minAutomationTarget="sequencer.accent.beatStart.min"
                  maxAutomationTarget="sequencer.accent.beatStart.max"
                  automationFocusButton={renderAutomationFocusButton("Subdivision accent", [
                    "sequencer.accent.beatStart.min",
                    "sequencer.accent.beatStart.max",
                  ])}
                  onChange={(next) => {
                    setBeatAccentMin(next.min);
                    setBeatAccentMax(next.max);
                  }}
                />
                <VelocityAccentControl
                  label="Grouping"
                  min={jathiAccentMin}
                  max={jathiAccentMax}
                  minAutomationTarget="sequencer.accent.jathiStart.min"
                  maxAutomationTarget="sequencer.accent.jathiStart.max"
                  automationFocusButton={renderAutomationFocusButton("Grouping accent", [
                    "sequencer.accent.jathiStart.min",
                    "sequencer.accent.jathiStart.max",
                  ])}
                  onChange={(next) => {
                    setJathiAccentMin(next.min);
                    setJathiAccentMax(next.max);
                  }}
                />
                </div>
              </div>
            </div>
            <div className="section-workbench">
              <aside className="section-map" aria-label="Section map">
                <div className="section-map-head">
                  <span>Cycle map</span>
                  <em>
                    {normalizedBoundaries.length} boundaries ·{" "}
                    {resolvedSections.length} sections
                  </em>
                </div>
                <div className="section-map-list">
                  {sectionInspectorEntries.map((entry) => {
                    const isActive =
                      entry.key === activeSectionInspectorEntry.key;
                    const subdivision = fixedSubdivisionFromWeights(
                      entry.kind === "boundary"
                        ? entry.boundary.weights
                        : initialWeights,
                      entry.resolvedSection?.gati
                    );
                    const grouping = fixedGroupingFromWeights(
                      entry.kind === "boundary"
                        ? entry.boundary.jathiWeights
                        : initialJathiWeights,
                      entry.resolvedSection?.timingMatras,
                      entry.resolvedSection?.gatiTimingFrameMatras
                    );
                    return (
                      <button
                        className={`section-map-row${
                          isActive ? " is-active" : ""
                        }${entry.resolvedSection ? " is-resolved" : ""}`}
                        key={entry.key}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => setSectionInspectorKey(entry.key)}
                      >
                        <span className="section-map-row-main">
                          <strong>{entry.label}</strong>
                          <em>{entry.detail}</em>
                        </span>
                        <span className="section-map-chips">
                          <b>subdivision {subdivision}</b>
                          <b>grouping {grouping ?? "none"}</b>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  className="section-map-add"
                  type="button"
                  disabled={
                    playbackStructureLocked ||
                    normalizedBoundaries.length >= Math.max(0, cycleBeats - 1)
                  }
                  onClick={addBoundary}
                >
                  + boundary
                </button>
              </aside>

              <section
                className={`section-card section-inspector${
                  activeSectionInspectorEntry.resolvedSection ? " is-resolved" : ""
                }`}
                aria-label={`${activeSectionInspectorEntry.label} inspector`}
              >
                <div className="section-inspector-head">
                  <div>
                    <span>
                      {activeSectionInspectorEntry.kind === "initial"
                        ? "Initial section"
                        : "Section boundary"}
                    </span>
                    <strong>{activeSectionInspectorEntry.label}</strong>
                    <em>{activeSectionInspectorEntry.detail}</em>
                  </div>
                  <b>fixed</b>
                </div>
                <div className="section-inspector-body">
                  {renderSectionInspector(activeSectionInspectorEntry)}
                </div>
              </section>
            </div>
          </div>
          ) : null}
        </details>
  );
}
