/** Fixed position, subdivision, and grouping editor for a timeline boundary. */
import { BoundaryPoint } from "../patchIo";
import { ResolvedSectionRun } from "../resolvedSections";
import {
  fixedGroupingFromWeights,
  fixedGroupingWeights,
  fixedSubdivisionFromWeights,
  fixedSubdivisionWeights,
} from "../sectionsSubdivisionsLogic";
import { BoundaryAfterBeatSelect } from "./BoundaryAfterBeatSelect";
import { FixedSectionControls } from "./FixedSectionControls";
import { FloatingWindowCloseButton, ModalFrame } from "./ModalChrome";

export interface BoundaryDetailDialogProps {
  cycleBeats: number;
  playbackStructureLocked: boolean;
  removeBoundaryAfterBeat: (afterBeat: number) => void;
  normalizedBoundaries: BoundaryPoint[];
  selectedBoundary: BoundaryPoint | null | undefined;
  selectedBoundaryIndex: number;
  selectedBoundaryResolvedSection: ResolvedSectionRun | undefined;
  setSelectedBoundaryAfterBeat: React.Dispatch<React.SetStateAction<number | null>>;
  updateBoundary: (index: number, patch: Partial<BoundaryPoint>) => void;
}

export function BoundaryDetailDialog({
  cycleBeats,
  playbackStructureLocked,
  removeBoundaryAfterBeat,
  normalizedBoundaries,
  selectedBoundary,
  selectedBoundaryIndex,
  selectedBoundaryResolvedSection,
  setSelectedBoundaryAfterBeat,
  updateBoundary,
}: BoundaryDetailDialogProps) {
  return (
    <ModalFrame
      open={Boolean(selectedBoundary && selectedBoundaryIndex >= 0)}
      onClose={() => setSelectedBoundaryAfterBeat(null)}
      ariaLabelledby="boundary-detail-title"
      className="setup-backdrop boundary-detail-backdrop"
      layer="nested"
      size="wide"
      surfaceClassName="setup-dialog boundary-detail-dialog"
    >
      {({ close }) =>
        selectedBoundary && selectedBoundaryIndex >= 0 ? (
          <>
            <div className="modal-head setup-head">
              <div>
                <h3 id="boundary-detail-title">
                  Boundary after beat {selectedBoundary.afterBeat}
                </h3>
                <span>Starts section at beat {selectedBoundary.afterBeat + 1}</span>
              </div>
              <div className="boundary-detail-actions">
                <button
                  className="tiny-button is-destructive"
                  type="button"
                  disabled={playbackStructureLocked}
                  onClick={() => removeBoundaryAfterBeat(selectedBoundary.afterBeat)}
                >
                  Delete
                </button>
                <FloatingWindowCloseButton
                  label="Close boundary details"
                  onClick={close}
                />
              </div>
            </div>

            <div className="boundary-detail-body">
              <div className="boundary-controls boundary-detail-controls">
                <label>
                  After beat
                  <BoundaryAfterBeatSelect
                    cycleBeats={cycleBeats}
                    boundaries={normalizedBoundaries}
                    value={selectedBoundary.afterBeat}
                    disabled={playbackStructureLocked}
                    onChange={(afterBeat) => {
                      setSelectedBoundaryAfterBeat(afterBeat);
                      updateBoundary(selectedBoundaryIndex, { afterBeat });
                    }}
                  />
                </label>
                <span className="mini-readout">
                  {playbackStructureLocked
                    ? "Stop playback before editing"
                    : "Every authored boundary starts a section"}
                </span>
              </div>

              <FixedSectionControls
                subdivision={fixedSubdivisionFromWeights(
                  selectedBoundary.weights,
                  selectedBoundaryResolvedSection?.gati
                )}
                grouping={fixedGroupingFromWeights(
                  selectedBoundary.jathiWeights,
                  selectedBoundaryResolvedSection?.timingMatras,
                  selectedBoundaryResolvedSection?.gatiTimingFrameMatras
                )}
                totalMatras={selectedBoundaryResolvedSection?.timingMatras}
                timingGrid={selectedBoundaryResolvedSection?.gatiTimingFrameMatras}
                disabled={playbackStructureLocked}
                onSubdivisionChange={(subdivision) =>
                  updateBoundary(selectedBoundaryIndex, {
                    weights: fixedSubdivisionWeights(subdivision),
                    customSubdivision: null,
                  })
                }
                onGroupingChange={(grouping) =>
                  updateBoundary(selectedBoundaryIndex, {
                    jathiWeights: fixedGroupingWeights(grouping),
                  })
                }
              />
            </div>
          </>
        ) : null
      }
    </ModalFrame>
  );
}
