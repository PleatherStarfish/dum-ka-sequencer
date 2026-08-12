/**
 * The Automation editor modal: target browser, track list, curve graph editor, markers, and per-target range controls.
 * Extracted from App.tsx (carve-up round 18) along the panel seam — all
 * state stays in App and arrives via props with their original names (types
 * compiler-generated via scripts/carve/typegen.cjs); the JSX body is
 * unchanged.
 */
import {
  NumericField,
} from "../NumericField";
import {
  SliderField,
} from "../SliderField";
import {
  ControlRow,
} from "./ControlRow";
import {
  AutomationTargetDef,
  automationKindLabel,
  automationPointEffectiveUnit,
  automationSampleRateLabel,
  automationSegmentCurveLabel,
  automationTargetDef,
  automationTimeToUnit,
  automationValueNumber,
  filterAvailableAutomationTargets,
  sortAutomationMarkers,
} from "../automationTargets";
import {
  AutomationCurve,
  AutomationGraphRange,
  AutomationPoint,
  AutomationSegmentCurve,
  AutomationSegmentCurveKind,
  AutomationSet,
  AutomationTrack,
  AutomationValueKind,
} from "../bridge";
import {
  AutomationGraphRangeData,
  clamp,
} from "../patchIo";
import {
  PanelStatusChips,
} from "./MainEditorChrome";
import {
  FloatingWindowCloseButton,
  ModalFrame,
} from "./ModalChrome";
import {
  AutomationGraphEditor,
} from "./TimelineLanes";

import { Switch } from "../Switch";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useDiscardEditorDraft,
  useEditorDraftLifecycle,
} from "../editorDraftFlush";

export function AutomationMarkerLabelField({
  label,
  disabled,
  onCommit,
}: {
  label: string;
  disabled: boolean;
  onCommit: (label: string) => void;
}) {
  const [draft, setDraft] = useState(label);
  const draftRef = useRef(label);
  const committedRef = useRef(label);

  useEffect(() => {
    draftRef.current = label;
    committedRef.current = label;
    setDraft(label);
  }, [label]);

  const commit = () => {
    const next = draftRef.current;
    if (next === committedRef.current) return;
    committedRef.current = next;
    onCommit(next);
  };

  useEditorDraftLifecycle({
    flush: commit,
    discard: () => {
      draftRef.current = label;
      committedRef.current = label;
      setDraft(label);
    },
  });

  return (
    <input
      aria-label="Marker label"
      type="text"
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        draftRef.current = event.currentTarget.value;
        setDraft(event.currentTarget.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          draftRef.current = label;
          committedRef.current = label;
          setDraft(label);
        }
      }}
    />
  );
}
export interface AutomationEditorModalProps {
  addAutomationMarker: (label: string) => void;
  addAutomationPointAt: (trackId: string, curveId: string, unit: number, value: number, anchorId: string | null) => void;
  addAutomationTarget: (def: AutomationTargetDef) => void;
  automationMarkerPhaseInput: number;
  automationOpen: boolean;
  automationSet: AutomationSet;
  automationTargetDefs: AutomationTargetDef[];
  automationTargetGroupFilter: string;
  automationTargetGroups: string[];
  automationTargetKindFilter: "all" | AutomationValueKind;
  automationTargetKinds: ("all" | AutomationValueKind)[];
  playbackStructureLocked: boolean;
  removeAutomationMarker: (markerId: string) => void;
  removeAutomationPoint: (trackId: string, curveId: string, pointId: string) => void;
  removeAutomationTrack: (trackId: string) => void;
  resetAutomationGraphRange: (trackId: string) => void;
  selectedAutomationAxisRange: AutomationGraphRange | null;
  selectedAutomationCurve: AutomationCurve | null;
  selectedAutomationDef: AutomationTargetDef | null;
  selectedAutomationPointId: string | null;
  selectedAutomationPoints: AutomationPoint[];
  selectedAutomationSegmentCurve: AutomationSegmentCurve | null;
  selectedAutomationSegmentPoint: AutomationPoint | null;
  selectedAutomationSegmentPointId: string | null;
  selectedAutomationTrack: AutomationTrack | null;
  setAutomationMarkerPhaseInput: React.Dispatch<React.SetStateAction<number>>;
  setAutomationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAutomationTargetGroupFilter: React.Dispatch<React.SetStateAction<string>>;
  setAutomationTargetKindFilter: React.Dispatch<React.SetStateAction<"all" | AutomationValueKind>>;
  setSelectedAutomationCurveId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedAutomationPointId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedAutomationSegmentPointId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedAutomationTrackId: React.Dispatch<React.SetStateAction<string | null>>;
  updateAutomationGraphRange: (trackId: string, patch: Partial<AutomationGraphRangeData>) => void;
  updateAutomationMarker: (markerId: string, patch: { unit?: number; label?: string; }) => void;
  updateAutomationPoint: (trackId: string, curveId: string, pointId: string, patch: { unit?: number; value?: number; anchorId?: string | null; }) => void;
  updateAutomationSegmentCurve: (trackId: string, curveId: string, pointId: string, segmentCurve: AutomationSegmentCurve) => void;
  updateAutomationTrack: (trackId: string, updater: (track: AutomationSet["tracks"][number]) => AutomationSet["tracks"][number]) => void;
}

export function AutomationEditorModal({
  addAutomationMarker,
  addAutomationPointAt,
  addAutomationTarget,
  automationMarkerPhaseInput,
  automationOpen,
  automationSet,
  automationTargetDefs,
  automationTargetGroupFilter,
  automationTargetGroups,
  automationTargetKindFilter,
  automationTargetKinds,
  playbackStructureLocked,
  removeAutomationMarker,
  removeAutomationPoint,
  removeAutomationTrack,
  resetAutomationGraphRange,
  selectedAutomationAxisRange,
  selectedAutomationCurve,
  selectedAutomationDef,
  selectedAutomationPointId,
  selectedAutomationPoints,
  selectedAutomationSegmentCurve,
  selectedAutomationSegmentPoint,
  selectedAutomationSegmentPointId,
  selectedAutomationTrack,
  setAutomationMarkerPhaseInput,
  setAutomationOpen,
  setAutomationTargetGroupFilter,
  setAutomationTargetKindFilter,
  setSelectedAutomationCurveId,
  setSelectedAutomationPointId,
  setSelectedAutomationSegmentPointId,
  setSelectedAutomationTrackId,
  updateAutomationGraphRange,
  updateAutomationMarker,
  updateAutomationPoint,
  updateAutomationSegmentCurve,
  updateAutomationTrack,
}: AutomationEditorModalProps) {
  const committedBend = selectedAutomationSegmentCurve?.amount ?? 1;
  const [bendDraft, setBendDraft] = useState(committedBend);
  const [automationTargetSearch, setAutomationTargetSearch] = useState("");
  const [automationMarkerLabelDraft, setAutomationMarkerLabelDraft] =
    useState("");
  useDiscardEditorDraft(() => {
    setBendDraft(committedBend);
    setAutomationTargetSearch("");
    setAutomationMarkerLabelDraft("");
  });

  const availableAutomationTargets = useMemo(
    () =>
      filterAvailableAutomationTargets(
        automationTargetDefs,
        automationSet.tracks,
        automationTargetGroupFilter,
        automationTargetKindFilter,
        automationTargetSearch
      ),
    [
      automationSet.tracks,
      automationTargetDefs,
      automationTargetGroupFilter,
      automationTargetKindFilter,
      automationTargetSearch,
    ]
  );

  useEffect(() => {
    setBendDraft(committedBend);
  }, [committedBend, selectedAutomationSegmentPointId]);

  // Bend is intentionally the one continuously-drafted SliderField: redraw the
  // selected segment locally during the gesture, while the App-owned curve is
  // still committed only once by onChangeEnd.
  const displayedAutomationCurve = useMemo(() => {
    if (
      !selectedAutomationCurve ||
      !selectedAutomationSegmentPointId ||
      !selectedAutomationSegmentCurve ||
      bendDraft === committedBend
    ) {
      return selectedAutomationCurve;
    }
    return {
      ...selectedAutomationCurve,
      points: selectedAutomationCurve.points.map((point) =>
        point.id === selectedAutomationSegmentPointId
          ? {
              ...point,
              outCurve: {
                ...selectedAutomationSegmentCurve,
                amount: bendDraft,
              },
            }
          : point
      ),
    };
  }, [
    bendDraft,
    committedBend,
    selectedAutomationCurve,
    selectedAutomationSegmentCurve,
    selectedAutomationSegmentPointId,
  ]);

  return (
      <ModalFrame
        open={automationOpen}
        onClose={() => setAutomationOpen(false)}
        ariaLabelledby="automation-overview-title"
        className="automation-modal-backdrop"
        dataAutomationPickControl
        layer="utility"
        size="full"
        surfaceClassName={`editor-panel automation-overview${
          playbackStructureLocked ? " is-disabled" : ""
        }`}
      >
        {({ close }) => (
          <>
          <div className="editor-panel-summary">
            <span className="summary-copy">
              <strong id="automation-overview-title">Automation</strong>
              <em>
                {automationSet.lengthCycles} cycles · {automationSet.tracks.length} target
                {automationSet.tracks.length === 1 ? "" : "s"}
              </em>
            </span>
            <PanelStatusChips
              items={[
                automationSet.tracks.length > 0 && {
                  label: `${automationSet.tracks.length} lane${
                    automationSet.tracks.length === 1 ? "" : "s"
                  }`,
                  tone: "on",
                },
              ]}
            />
            <FloatingWindowCloseButton
              label="Close Automation editor"
              onClick={close}
            />
          </div>
          <div className="editor-panel-body">
            <div className="automation-workbench">
              <aside className="automation-browser" aria-label="Automation targets">
                <div className="automation-browser-controls">
                  <label>
                    Find
                    <input
                      type="search"
                      value={automationTargetSearch}
                      disabled={playbackStructureLocked}
                      onChange={(event) => setAutomationTargetSearch(event.target.value)}
                    />
                  </label>
                  <label>
                    Group
                    <select
                      value={automationTargetGroupFilter}
                      disabled={playbackStructureLocked}
                      onChange={(event) => setAutomationTargetGroupFilter(event.target.value)}
                    >
                      {automationTargetGroups.map((group) => (
                        <option key={group} value={group}>
                          {group === "all" ? "All" : group}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Type
                    <select
                      value={automationTargetKindFilter}
                      disabled={playbackStructureLocked}
                      onChange={(event) =>
                        setAutomationTargetKindFilter(
                          event.target.value === "all"
                            ? "all"
                            : (event.target.value as AutomationValueKind)
                        )
                      }
                    >
                      {automationTargetKinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind === "all" ? "All" : automationKindLabel(kind)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="automation-target-meter">
                  <span>{availableAutomationTargets.length} available</span>
                  <span>{automationTargetDefs.length} total</span>
                </div>
                <div className="automation-target-list">
                  {availableAutomationTargets.length === 0 ? (
                    <div className="automation-empty">No targets</div>
                  ) : (
                    availableAutomationTargets.map((def) => (
                      <button
                        className="automation-target-row"
                        type="button"
                        key={def.target}
                        disabled={playbackStructureLocked}
                        onClick={() => addAutomationTarget(def)}
                      >
                        <span className="automation-target-main">
                          <strong>{def.label}</strong>
                          <em>{def.group}</em>
                        </span>
                        <span className="automation-chip-row">
                          <span className="automation-chip">
                            {automationKindLabel(def.valueKind)}
                          </span>
                          <span className="automation-chip">
                            {automationSampleRateLabel(def.sampleRate)}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </aside>

              <div className="automation-graph-board">
                <div className="automation-lane-strip" role="list">
                  {automationSet.tracks.length === 0 ? (
                    <div className="automation-empty">No lanes</div>
                  ) : (
                    automationSet.tracks.map((track) => {
                      const def = automationTargetDef(track.target, automationTargetDefs);
                      const selected = selectedAutomationTrack?.id === track.id;
                      return (
                        <button
                          className={`automation-lane-pill${
                            selected ? " is-selected" : ""
                          }${track.enabled ? " is-enabled" : " is-muted"}`}
                          key={track.id}
                          type="button"
                          onClick={() => {
                            setSelectedAutomationTrackId(track.id);
                            setSelectedAutomationCurveId(track.curves[0]?.id ?? null);
                            setSelectedAutomationPointId(
                              track.curves[0]?.points[0]?.id ?? null
                            );
                            setSelectedAutomationSegmentPointId(
                              track.curves[0]?.points[0]?.id ?? null
                            );
                          }}
                        >
                          <strong>{def.label}</strong>
                          <span>{track.enabled ? "on" : "off"}</span>
                        </button>
                      );
                    })
                  )}
                </div>

                <section className="automation-marker-bar" aria-label="Automation markers">
                  <div className="automation-marker-entry">
                    <label>
                      Marker %
                      <NumericField
                        min={0}
                        max={100}
                        step={0.000001}
                        value={automationMarkerPhaseInput}
                        disabled={playbackStructureLocked}
                        onValueCommit={(value) =>
                          setAutomationMarkerPhaseInput(
                            clamp(value, 0, 100)
                          )
                        }
                      />
                    </label>
                    <label>
                      Label
                      <input
                        type="text"
                        value={automationMarkerLabelDraft}
                        disabled={playbackStructureLocked}
                        onChange={(event) =>
                          setAutomationMarkerLabelDraft(event.target.value)
                        }
                      />
                    </label>
                    <button
                      className="tiny-button"
                      type="button"
                      disabled={playbackStructureLocked}
                      onClick={() => {
                        addAutomationMarker(automationMarkerLabelDraft);
                        setAutomationMarkerLabelDraft("");
                      }}
                    >
                      add marker
                    </button>
                  </div>
                  <div className="automation-marker-list">
                    {automationSet.markers.length === 0 ? (
                      <span>No markers</span>
                    ) : (
                      sortAutomationMarkers(automationSet.markers).map((marker) => {
                        const unit = automationTimeToUnit(marker.time);
                        return (
                          <div className="automation-marker-row" key={marker.id}>
                            <NumericField
                              aria-label="Marker phase percent"
                              min={0}
                              max={100}
                              step={0.000001}
                              value={Number((unit * 100).toFixed(6))}
                              disabled={playbackStructureLocked}
                              onValueCommit={(value) =>
                                updateAutomationMarker(marker.id, {
                                  unit:
                                    clamp(
                                      value,
                                      0,
                                      100
                                    ) / 100,
                                })
                              }
                            />
                            <AutomationMarkerLabelField
                              label={marker.label}
                              disabled={playbackStructureLocked}
                              onCommit={(label) =>
                                updateAutomationMarker(marker.id, {
                                  label,
                                })
                              }
                            />
                            <button
                              className="tiny-button"
                              type="button"
                              disabled={playbackStructureLocked}
                              onClick={() => removeAutomationMarker(marker.id)}
                            >
                              remove
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                {selectedAutomationTrack &&
                selectedAutomationDef &&
                selectedAutomationCurve &&
                selectedAutomationAxisRange ? (
                  <section className="automation-graph-panel" aria-label="Automation graph">
                    <div className="automation-graph-head">
                      <span>
                        <strong>{selectedAutomationDef.label}</strong>
                        <em>
                          {selectedAutomationDef.group} ·{" "}
                          {automationKindLabel(selectedAutomationDef.valueKind)} ·{" "}
                          {automationSampleRateLabel(selectedAutomationDef.sampleRate)}
                        </em>
                      </span>
                      <Switch
                        size="sm"
                        isSelected={selectedAutomationTrack.enabled}
                        isDisabled={playbackStructureLocked}
                        onChange={(value) =>
                            updateAutomationTrack(selectedAutomationTrack.id, (current) => ({
                              ...current,
                              enabled: value,
                            }))}
                      >
                        <span>{selectedAutomationTrack.enabled ? "on" : "off"}</span>
                      </Switch>
                      <button
                        className="tiny-button"
                        type="button"
                        disabled={playbackStructureLocked}
                        onClick={() => removeAutomationTrack(selectedAutomationTrack.id)}
                      >
                        remove lane
                      </button>
                    </div>

                    {selectedAutomationDef.valueKind === "weight" && (
                      <div
                        className="automation-axis-range"
                        aria-label="Weight automation graph range"
                      >
                        <label>
                          Y min
                          <NumericField
                            min={selectedAutomationDef.min}
                            max={selectedAutomationAxisRange.max}
                            step={1}
                            value={selectedAutomationAxisRange.min}
                            disabled={playbackStructureLocked}
                            onValueCommit={(value) => {
                              if (Number.isFinite(value)) {
                                updateAutomationGraphRange(selectedAutomationTrack.id, {
                                  min: value,
                                });
                              }
                            }}
                          />
                        </label>
                        <label>
                          Y max
                          <NumericField
                            min={selectedAutomationAxisRange.min}
                            max={selectedAutomationDef.max}
                            step={1}
                            value={selectedAutomationAxisRange.max}
                            disabled={playbackStructureLocked}
                            onValueCommit={(value) => {
                              if (Number.isFinite(value)) {
                                updateAutomationGraphRange(selectedAutomationTrack.id, {
                                  max: value,
                                });
                              }
                            }}
                          />
                        </label>
                        <button
                          className="tiny-button"
                          type="button"
                          disabled={playbackStructureLocked}
                          onClick={() =>
                            resetAutomationGraphRange(selectedAutomationTrack.id)
                          }
                        >
                          reset axis
                        </button>
                      </div>
                    )}

                    <div className="automation-graph-shell">
                      <AutomationGraphEditor
                        curve={displayedAutomationCurve ?? selectedAutomationCurve}
                        def={selectedAutomationDef}
                        axisRange={selectedAutomationAxisRange}
                        markers={automationSet.markers}
                        selectedPointId={selectedAutomationPointId}
                        selectedSegmentPointId={selectedAutomationSegmentPointId}
                        disabled={playbackStructureLocked}
                        onAddPoint={(unit, value, anchorId) =>
                          addAutomationPointAt(
                            selectedAutomationTrack.id,
                            selectedAutomationCurve.id,
                            unit,
                            value,
                            anchorId
                          )
                        }
                        onPointChange={(pointId, patch) =>
                          updateAutomationPoint(
                            selectedAutomationTrack.id,
                            selectedAutomationCurve.id,
                            pointId,
                            patch
                          )
                        }
                        onPointSelect={(pointId) => {
                          setSelectedAutomationPointId(pointId);
                          const pointIndex = selectedAutomationPoints.findIndex(
                            (point) => point.id === pointId
                          );
                          if (
                            pointIndex >= 0 &&
                            pointIndex < selectedAutomationPoints.length - 1
                          ) {
                            setSelectedAutomationSegmentPointId(pointId);
                          }
                        }}
                        onSegmentSelect={(pointId) => {
                          setSelectedAutomationPointId(pointId);
                          setSelectedAutomationSegmentPointId(pointId);
                        }}
                      />
                    </div>

                    <div className="automation-point-list" aria-label="Automation points">
                      <div className="automation-point-header">
                        <span>Point</span>
                        <span>Phase %</span>
                        <span>Value</span>
                        <span>Snap</span>
                        <span />
                      </div>
                      {selectedAutomationPoints.map((point, pointIndex) => {
                        const pointId = point.id ?? "";
                        const value = automationValueNumber(
                          point.value,
                          selectedAutomationDef.fallback
                        );
                        // Effective (marker-aware) phase — what actually plays.
                        // Committing the field pins the typed phase and clears
                        // the anchor (see onValueCommit below).
                        const unit = automationPointEffectiveUnit(
                          point,
                          automationSet.markers
                        );
                        const selected = selectedAutomationPointId === point.id;
                        const selectPoint = () => {
                          setSelectedAutomationPointId(pointId);
                          const segmentPoint =
                            pointIndex < selectedAutomationPoints.length - 1
                              ? point
                              : selectedAutomationPoints[pointIndex - 1];
                          if (segmentPoint?.id) {
                            setSelectedAutomationSegmentPointId(segmentPoint.id);
                          }
                        };
                        return (
                          <div
                            className={`automation-point-row${
                              selected ? " is-selected" : ""
                            }`}
                            key={pointId || pointIndex}
                          >
                            <button
                              className="tiny-button"
                              type="button"
                              onClick={selectPoint}
                            >
                              {pointIndex + 1}
                            </button>
                            <label>
                              <span className="visually-hidden">Phase percent</span>
                              <NumericField
                                min={0}
                                max={100}
                                step={0.000001}
                                value={Number((unit * 100).toFixed(6))}
                                disabled={playbackStructureLocked}
                                onFocus={selectPoint}
                                onValueCommit={(value) =>
                                  updateAutomationPoint(
                                    selectedAutomationTrack.id,
                                    selectedAutomationCurve.id,
                                    pointId,
                                    {
                                      unit:
                                        clamp(
                                          value,
                                          0,
                                          100
                                        ) / 100,
                                      anchorId: null,
                                    }
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span className="visually-hidden">Value</span>
                              {selectedAutomationDef.valueKind === "boolean" ? (
                                <select
                                  value={value >= 0.5 ? 1 : 0}
                                  disabled={playbackStructureLocked}
                                  onFocus={selectPoint}
                                  onChange={(event) =>
                                    updateAutomationPoint(
                                      selectedAutomationTrack.id,
                                      selectedAutomationCurve.id,
                                      pointId,
                                      { value: parseInt(event.target.value, 10) }
                                    )
                                  }
                                >
                                  <option value={0}>0</option>
                                  <option value={1}>1</option>
                                </select>
                              ) : (
                                <NumericField
                                  min={selectedAutomationAxisRange.min}
                                  max={selectedAutomationAxisRange.max}
                                  step={selectedAutomationDef.step}
                                  value={value}
                                  disabled={playbackStructureLocked}
                                  onFocus={selectPoint}
                                  onValueCommit={(value) =>
                                    updateAutomationPoint(
                                      selectedAutomationTrack.id,
                                      selectedAutomationCurve.id,
                                      pointId,
                                      { value: value }
                                    )
                                  }
                                />
                              )}
                            </label>
                            <label>
                              <span className="visually-hidden">Snap marker</span>
                              <select
                                value={point.anchorId ?? ""}
                                disabled={
                                  playbackStructureLocked ||
                                  automationSet.markers.length === 0
                                }
                                onFocus={selectPoint}
                                onChange={(event) => {
                                  const markerId = event.target.value;
                                  const marker = automationSet.markers.find(
                                    (item) => item.id === markerId
                                  );
                                  updateAutomationPoint(
                                    selectedAutomationTrack.id,
                                    selectedAutomationCurve.id,
                                    pointId,
                                    marker
                                      ? {
                                          unit: automationTimeToUnit(marker.time),
                                          anchorId: marker.id,
                                        }
                                      : { anchorId: null }
                                  );
                                }}
                              >
                                <option value="">Free</option>
                                {sortAutomationMarkers(automationSet.markers).map(
                                  (marker) => {
                                    const markerUnit = automationTimeToUnit(marker.time);
                                    return (
                                      <option key={marker.id} value={marker.id}>
                                        {marker.label ||
                                          `${Number((markerUnit * 100).toFixed(3))}%`}
                                      </option>
                                    );
                                  }
                                )}
                              </select>
                            </label>
                            <button
                              className="tiny-button"
                              type="button"
                              disabled={
                                playbackStructureLocked ||
                                selectedAutomationPoints.length <= 2
                              }
                              onClick={() =>
                                removeAutomationPoint(
                                  selectedAutomationTrack.id,
                                  selectedAutomationCurve.id,
                                  pointId
                                )
                              }
                            >
                              remove
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="automation-graph-controls">
                      <label>
                        Segment
                        <select
                          value={selectedAutomationSegmentPoint?.id ?? ""}
                          disabled={
                            playbackStructureLocked ||
                            selectedAutomationPoints.length <= 1
                          }
                          onChange={(event) =>
                            setSelectedAutomationSegmentPointId(event.target.value)
                          }
                        >
                          {selectedAutomationPoints.slice(0, -1).map((point, index) => {
                            const next = selectedAutomationPoints[index + 1]!;
                            return (
                              <option key={point.id ?? index} value={point.id ?? ""}>
                                {Number(
                                  (
                                    automationPointEffectiveUnit(
                                      point,
                                      automationSet.markers
                                    ) * 100
                                  ).toFixed(3)
                                )}
                                {"% -> "}
                                {Number(
                                  (
                                    automationPointEffectiveUnit(
                                      next,
                                      automationSet.markers
                                    ) * 100
                                  ).toFixed(3)
                                )}
                                {"%"}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <label>
                        Curve
                        <select
                          value={selectedAutomationSegmentCurve?.kind ?? "linear"}
                          disabled={
                            playbackStructureLocked || !selectedAutomationSegmentCurve
                          }
                          onChange={(event) => {
                            if (
                              !selectedAutomationSegmentPoint ||
                              !selectedAutomationSegmentCurve
                            ) {
                              return;
                            }
                            updateAutomationSegmentCurve(
                              selectedAutomationTrack.id,
                              selectedAutomationCurve.id,
                              selectedAutomationSegmentPoint.id ?? "",
                              {
                                ...selectedAutomationSegmentCurve,
                                kind: event.target.value as AutomationSegmentCurveKind,
                              }
                            );
                          }}
                        >
                          {[
                            "linear",
                            "smooth",
                            "easeIn",
                            "easeOut",
                            "easeInOut",
                            "exponential",
                            "hold",
                          ].map((kind) => (
                            <option key={kind} value={kind}>
                              {automationSegmentCurveLabel(
                                kind as AutomationSegmentCurveKind
                              )}
                            </option>
                          ))}
                        </select>
                      </label>
                      <ControlRow
                        label="Bend"
                        control={<SliderField
                          aria-label="Automation curve bend"
                          changeMode="continuous"
                          min={0}
                          max={1}
                          step={0.01}
                          value={bendDraft}
                          showRange
                          showValue
                          disabled={
                            playbackStructureLocked || !selectedAutomationSegmentCurve
                          }
                          onChange={(event) => {
                            setBendDraft(parseFloat(event.target.value));
                          }}
                          onChangeCancel={() => setBendDraft(committedBend)}
                          onChangeEnd={(amount) => {
                            if (
                              !selectedAutomationSegmentPoint ||
                              !selectedAutomationSegmentCurve
                            ) {
                              return;
                            }
                            updateAutomationSegmentCurve(
                              selectedAutomationTrack.id,
                              selectedAutomationCurve.id,
                              selectedAutomationSegmentPoint.id ?? "",
                              {
                                ...selectedAutomationSegmentCurve,
                                amount,
                              }
                            );
                          }}
                        />}
                      />
                    </div>
                  </section>
                ) : (
                  <div className="automation-graph-panel automation-empty">No lane</div>
                )}
              </div>
            </div>
          </div>
          </>
        )}
      </ModalFrame>
  );
}
