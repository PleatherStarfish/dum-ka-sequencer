/**
 * The timeline panel: cycle map rows, playhead overlay, automation lanes, per-layer transport overlays, preview cycle controls, and track tabs strip.
 * Extracted from App.tsx (carve-up round 22) along the panel seam — all
 * state stays in App and arrives via props with their original names (types
 * compiler-generated via scripts/carve/typegen.cjs); the JSX body is
 * unchanged.
 */
import {
  automationTargetDef,
  AutomationTargetDef,
} from "../automationTargets";
import {
  AutomationTrack,
  LivePositionSample,
  SubdivisionSwitchPreview,
  TransportSnapshot,
} from "../bridge";
import {
  BoundaryPoint,
  TrackCycleLengthMode,
  TrackTempoMode,
} from "../patchIo";
import {
  ResolvedSectionRun,
} from "../resolvedSections";
import {
  MAX_STOPPED_PREVIEW_CYCLE,
  stoppedPreviewCycleIndex,
} from "../timelineModel";
import {
  TimelineLayerRenderModel,
} from "./timelineRenderModel";
import {
  AutomationTimelineLanes,
  BeatRulerLane,
  ChannelHocketTimelineLane,
  GatiMatraLane,
  JathiPulseLane,
  RhythmLayerLane,
  TimelineLaneLabelsColumn,
  TimelinePlayheadOverlay,
  accentLaneChoice,
  buildCrossSectionRhythmTieChains,
  type TimelineLaneLabelEntry,
} from "./TimelineLanes";
import {
  BoundaryRail,
} from "./WeightEditors";
import { memo, useMemo, useState } from "react";

// The playhead's local active-beat state changes throughout playback, while
// these lanes depend only on resolved score/playback data. Memoized seams keep
// a beat highlight from rebuilding every marker and transition row.
const StableBoundaryRail = memo(BoundaryRail);
const StableAutomationTimelineLanes = memo(AutomationTimelineLanes);
const StableChannelHocketTimelineLane = memo(ChannelHocketTimelineLane);
const StableGatiMatraLane = memo(GatiMatraLane);
const StableJathiPulseLane = memo(JathiPulseLane);
const StableRhythmLayerLane = memo(RhythmLayerLane);
const StableTimelinePlayheadOverlay = memo(TimelinePlayheadOverlay);

export interface TimelinePanelProps {
  activeParallelTrack: { id: string; name: string; color: string; muted: boolean; soloed: boolean; tempoMode: TrackTempoMode; customTempoBpm: number; tempoBadge: string | null; cycleLengthMode: TrackCycleLengthMode; customCycleBeats: number; midiChannels: number[]; inspectableMidiChannels: number[]; channelHocketEnabled: boolean; triggered: boolean; };
  activeParallelTrackCustomName: string;
  activeParallelTrackHasCustomName: boolean;
  activeParallelTrackLabel: string;
  activeTimelineTrackId: string | null;
  automationTargetDefs: AutomationTargetDef[];
  channelHocketEnabled: boolean;
  cycleBeats: number;
  displayedCycle: number;
  editBoundaryFromRail: ({ afterBeat, remove, }: { afterBeat: number; remove: boolean; }) => void;
  livePositionRef: React.MutableRefObject<LivePositionSample | null>;
  normalizedBoundaries: BoundaryPoint[];
  openBoundaryDetail: (afterBeat: number) => void;
  playbackStructureLocked: boolean;
  playheadAkshara: number | null;
  removeBoundaryAfterBeat: (afterBeat: number) => void;
  renderedActiveTrackSuppressedNoteGroups: number;
  renderedResolvedSections: ResolvedSectionRun[];
  renderedTimelineLayerModel: TimelineLayerRenderModel;
  renderedTimelineLayoutCycle: number;
  renderedTimelinePreview: SubdivisionSwitchPreview | null;
  rhythmPlaybackEnabled: boolean;
  setTimelineAutomationPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTimelineAutomationTargetIds: React.Dispatch<React.SetStateAction<string[]>>;
  setUserPreviewCycle: React.Dispatch<React.SetStateAction<number>>;
  snapshot: TransportSnapshot | null;
  synthVoiceLabels: Record<number, string>;
  timelineAutomationPickerOpen: boolean;
  timelineAutomationPickerRef: React.MutableRefObject<HTMLDivElement | null>;
  timelineAutomationTrackOptions: { track: AutomationTrack; def: AutomationTargetDef; }[];
  timelineLayoutCycle: number;
  timelineRenderSyncing: boolean;
  toggleTimelineAutomationTarget: (target: string, shouldShow: boolean) => void;
  transportIsPlaying: boolean;
  userPreviewCycle: number;
  visibleTimelineAutomationTargetIds: Set<string>;
  visibleTimelineAutomationTracks: AutomationTrack[];
}

interface StoppedPreviewCycleSelectorProps {
  displayedCycle: number;
  isPlaying: boolean;
  setUserPreviewCycle: React.Dispatch<React.SetStateAction<number>>;
  userPreviewCycle: number;
}

export function StoppedPreviewCycleSelector({
  displayedCycle,
  isPlaying,
  setUserPreviewCycle,
  userPreviewCycle,
}: StoppedPreviewCycleSelectorProps) {
  const stoppedPreviewCycle = stoppedPreviewCycleIndex(userPreviewCycle);

  return (
    <span className="preview-cycle-selector" aria-label="Stopped cycle selector">
      <button
        type="button"
        aria-label="Inspect previous stopped cycle"
        disabled={isPlaying || stoppedPreviewCycle <= 0}
        onClick={() =>
          setUserPreviewCycle((cycle) =>
            stoppedPreviewCycleIndex(stoppedPreviewCycleIndex(cycle) - 1)
          )
        }
      >
        &lt;
      </button>
      <output aria-live="polite">
        {isPlaying ? Math.floor(displayedCycle) : stoppedPreviewCycle}
      </output>
      <button
        type="button"
        aria-label="Inspect next stopped cycle"
        disabled={isPlaying || stoppedPreviewCycle >= MAX_STOPPED_PREVIEW_CYCLE}
        onClick={() =>
          setUserPreviewCycle((cycle) =>
            stoppedPreviewCycleIndex(stoppedPreviewCycleIndex(cycle) + 1)
          )
        }
      >
        &gt;
      </button>
    </span>
  );
}

export function TimelinePanel({
  activeParallelTrack,
  activeParallelTrackCustomName,
  activeParallelTrackHasCustomName,
  activeParallelTrackLabel,
  activeTimelineTrackId,
  automationTargetDefs,
  channelHocketEnabled,
  cycleBeats,
  displayedCycle,
  editBoundaryFromRail,
  livePositionRef,
  normalizedBoundaries,
  openBoundaryDetail,
  playbackStructureLocked,
  playheadAkshara,
  removeBoundaryAfterBeat,
  renderedActiveTrackSuppressedNoteGroups,
  renderedResolvedSections,
  renderedTimelineLayerModel,
  renderedTimelinePreview,
  rhythmPlaybackEnabled,
  setTimelineAutomationPickerOpen,
  setTimelineAutomationTargetIds,
  setUserPreviewCycle,
  snapshot,
  synthVoiceLabels,
  timelineAutomationPickerOpen,
  timelineAutomationPickerRef,
  timelineAutomationTrackOptions,
  timelineRenderSyncing,
  toggleTimelineAutomationTarget,
  transportIsPlaying,
  userPreviewCycle,
  visibleTimelineAutomationTargetIds,
  visibleTimelineAutomationTracks,
}: TimelinePanelProps) {
  // The playhead updates this once per beat. Keeping it inside the timeline
  // prevents a purely visual highlight from invalidating the entire App tree.
  const [activeBeat, setActiveBeat] = useState(-1);
  const crossSectionRhythmTieChains = useMemo(
    () =>
      buildCrossSectionRhythmTieChains(
        renderedResolvedSections,
        renderedTimelineLayerModel.rhythmBySpanId
      ),
    [
      renderedResolvedSections,
      renderedTimelineLayerModel.rhythmBySpanId,
    ]
  );

  const firstResolvedSection = renderedResolvedSections[0] ?? null;
  // One source for the label rail: these conditions MUST mirror the lane
  // stack rendered inside every section below; the panel test pins the
  // rail's classes against a rendered section's rows so drift fails CI.
  const timelineLaneLabelEntries: TimelineLaneLabelEntry[] = [];
  if (firstResolvedSection) {
    timelineLaneLabelEntries.push({
      key: "beats",
      className: "is-beat-ruler",
      label: "beats",
    });
    timelineLaneLabelEntries.push({
      key: "gati",
      className: "is-gati-matras",
      label: firstResolvedSection.customSubdivision
        ? "custom subdivision"
        : `subdivision ${firstResolvedSection.gati}`,
    });
    timelineLaneLabelEntries.push({
      key: "jathi",
      className: "is-jathi-pulses",
      label: firstResolvedSection.jathi
        ? `grouping ${firstResolvedSection.jathi}`
        : "grouping none",
    });
    for (const track of visibleTimelineAutomationTracks) {
      timelineLaneLabelEntries.push({
        key: `auto-${track.target}`,
        className: "is-automation-layer",
        label: `auto ${automationTargetDef(track.target, automationTargetDefs).label}`,
      });
    }
    if (
      renderedTimelineLayerModel.showCoherentRhythmLayer ||
      (timelineRenderSyncing && rhythmPlaybackEnabled)
    ) {
      timelineLaneLabelEntries.push({
        key: "rhythm",
        className: "is-rhythm-layer",
        label: accentLaneChoice(firstResolvedSection.pulseSpans).label,
      });
    }
    if (
      (renderedTimelineLayerModel.showChannelHocketTransportRenderLayers ||
        timelineRenderSyncing) &&
      (channelHocketEnabled ||
        renderedTimelineLayerModel.visibleChannelHocketEvents.length > 0)
    ) {
      timelineLaneLabelEntries.push({
        key: "channel",
        className: "is-channel-layer",
        label: "channel",
      });
    }
  }

  return (
      <section
        className="timeline-panel"
        aria-label="Resolved timeline"
        data-testid="timeline-panel"
      >
        <div className="readout-row">
          {/* Context first: which track this timeline resolves, and which cycle. */}
          <span
            className="timeline-track-readout"
            data-testid="timeline-track-readout"
            title={`Timeline shown for ${activeParallelTrackLabel}${
              activeParallelTrackHasCustomName
                ? `, ${activeParallelTrackCustomName}`
                : ""
            }`}
          >
            <i
              aria-hidden="true"
              style={{ backgroundColor: activeParallelTrack.color }}
            />
            <b>{activeParallelTrackLabel}</b>
            {activeParallelTrackHasCustomName ? (
              <em>{activeParallelTrackCustomName}</em>
            ) : null}
          </span>
          <div
            className="preview-cycle-pill"
            role="group"
            aria-label="Inspect stopped cycle"
            title={`When stopped, choose a seeded cycle from 0 to ${MAX_STOPPED_PREVIEW_CYCLE.toLocaleString()} to resolve in the timeline. During playback, the timeline follows the live cycle.`}
          >
            <span>{snapshot?.isPlaying ? "Live cycle" : "Cycle"}</span>
            <StoppedPreviewCycleSelector
              displayedCycle={displayedCycle}
              isPlaying={snapshot?.isPlaying ?? false}
              setUserPreviewCycle={setUserPreviewCycle}
              userPreviewCycle={userPreviewCycle}
            />
          </div>
          {/* Quiet at-a-glance counts (kept visible, no longer chunky pills). */}
          <div className="readout-stats">
            <span>{normalizedBoundaries.length} section boundaries</span>
            <span>{renderedResolvedSections.length} realized sections</span>
          </div>
          {timelineRenderSyncing ? (
            <span className="timeline-sync-status">Syncing live render</span>
          ) : null}
          {renderedActiveTrackSuppressedNoteGroups > 0 ? (
            <span
              className="timeline-suppression-alert"
              role="status"
              data-testid="timeline-suppression-alert"
              title="Channel Logic on another track silenced these notes. They appear as ghosts on this track's timeline but are not sent to MIDI."
            >
              ⚠ {renderedActiveTrackSuppressedNoteGroups} ghost note
              {renderedActiveTrackSuppressedNoteGroups === 1 ? "" : "s"} silenced by another track
            </span>
          ) : null}
          {playbackStructureLocked ? (
            <span
              className="timeline-lock-note"
              title="Cycle length and section boundary edits are held while playing to keep MIDI and timeline phase aligned."
            >
              Structure locked while playing
            </span>
          ) : null}
          {/* Tools pushed to the right: automation lanes + a quiet key/info popover. */}
          <div className="readout-tools">
          {timelineAutomationTrackOptions.length > 0 ? (
            <div
              className="timeline-automation-control"
              ref={timelineAutomationPickerRef}
              data-automation-pick-control="true"
            >
              <button
                className={`timeline-automation-toggle${
                  visibleTimelineAutomationTracks.length > 0 ? " is-on" : ""
                }`}
                type="button"
                aria-label={
                  visibleTimelineAutomationTracks.length > 0
                    ? `${visibleTimelineAutomationTracks.length} automation lanes shown in timeline`
                    : "Show automation lanes in timeline"
                }
                aria-expanded={timelineAutomationPickerOpen}
                aria-haspopup="true"
                title="Show automation lanes in timeline"
                onClick={() =>
                  setTimelineAutomationPickerOpen((isOpen) => !isOpen)
                }
              >
                <b className="timeline-lane-label">layers</b>
                {visibleTimelineAutomationTracks.length > 0 ? (
                  <em>{visibleTimelineAutomationTracks.length}</em>
                ) : null}
              </button>
              {timelineAutomationPickerOpen ? (
                <div
                  className="timeline-automation-menu"
                  role="group"
                  aria-label="Timeline automation lanes"
                >
                  <div className="timeline-automation-menu-head">
                    <strong>Automation lanes</strong>
                    {visibleTimelineAutomationTracks.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setTimelineAutomationTargetIds([])}
                      >
                        hide
                      </button>
                    ) : null}
                  </div>
                  <div className="timeline-automation-options">
                    {timelineAutomationTrackOptions.map(({ track, def }) => {
                      const checked = visibleTimelineAutomationTargetIds.has(
                        track.target
                      );
                      return (
                        <label
                          className={`timeline-automation-option${
                            checked ? " is-selected" : ""
                          }`}
                          key={track.id}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              toggleTimelineAutomationTarget(
                                track.target,
                                event.currentTarget.checked
                              )
                            }
                          />
                          <strong title={def.label}>{def.label}</strong>
                          <small>{def.group}</small>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
            <details className="timeline-info">
              <summary
                className="timeline-info-button"
                aria-label="Timeline key and history"
                title="Timeline key & history"
              >
                i
              </summary>
              <div
                className="timeline-info-panel"
                role="group"
                aria-label="Timeline key"
              >
                <div className="timeline-info-legend">
                  <span>
                    <em className="legend-dot is-beat" /> beat
                  </span>
                  <span>
                    <em className="legend-dot is-section" /> section
                  </span>
                </div>
                {renderedTimelinePreview?.historySeeds.length ? (
                  <div className="timeline-info-history">
                    <strong>History seeds</strong>
                    <span>{renderedTimelinePreview.historySeeds.join(", ")}</span>
                  </div>
                ) : null}
              </div>
            </details>
          </div>
        </div>

        <div className="timeline-stack">
          <StableBoundaryRail
            cycleBeats={cycleBeats}
            boundaries={normalizedBoundaries}
            resolvedSections={renderedResolvedSections}
            disabled={playbackStructureLocked}
            onBoundaryEdit={editBoundaryFromRail}
            onBoundaryOpen={openBoundaryDetail}
            onBoundaryRemove={removeBoundaryAfterBeat}
          />
          <div className="timeline-lane-frame">
          <TimelineLaneLabelsColumn entries={timelineLaneLabelEntries} />
          <div
            className={`resolved-lane${timelineRenderSyncing ? " is-syncing" : ""}`}
            style={{
              gridTemplateColumns: `repeat(${cycleBeats}, minmax(72px, 1fr))`,
              minWidth: `${cycleBeats * 72}px`,
            }}
          >
            <StableTimelinePlayheadOverlay
              playing={transportIsPlaying}
              livePositionRef={livePositionRef}
              activeTrackId={activeTimelineTrackId}
              cycleBeats={cycleBeats}
              onActiveBeatChange={setActiveBeat}
            />
            {renderedResolvedSections.map((section, index) => {
              const isActive =
                activeBeat + 1 >= section.startBeat &&
                activeBeat + 1 <= section.endBeat;
              const beatSpan = section.endBeat - section.startBeat + 1;
              return (
                <section
                  className={`resolved-section${isActive ? " is-active" : ""}`}
                  data-testid="resolved-section"
                  data-section-index={section.sectionIndex}
                  data-start-beat={section.startBeat}
                  data-end-beat={section.endBeat}
                  data-gati={section.gati}
                  key={`${section.startBeat}-${section.endBeat}-${section.gati}-${index}`}
                  style={{ gridColumn: `span ${beatSpan}` }}
                >
                  <div className="resolved-section-header">
                    <span>
                      beats {section.startBeat}
                      {section.endBeat !== section.startBeat ? `-${section.endBeat}` : ""}
                    </span>
                    <strong>
                      {section.customSubdivision
                        ? `${section.divisionCount} parts`
                        : `subdivision ${section.gati}`}
                      {section.jathi ? ` · grouping ${section.jathi}` : ""}
                    </strong>
                  </div>
                  <div className="section-timeline-grid">
                    <BeatRulerLane section={section} activeBeat={activeBeat} />
                    <StableGatiMatraLane
                      section={section}
                      playheadAkshara={playheadAkshara}
                    />
                    <StableJathiPulseLane section={section} />
                    {visibleTimelineAutomationTracks.length > 0 && (
                      <StableAutomationTimelineLanes
                        section={section}
                        tracks={visibleTimelineAutomationTracks}
                        targetDefs={automationTargetDefs}
                      />
                    )}
                    {(renderedTimelineLayerModel.showCoherentRhythmLayer ||
                      (timelineRenderSyncing && rhythmPlaybackEnabled)) && (
                      <StableRhythmLayerLane
                        section={section}
                        rhythmBySpanId={renderedTimelineLayerModel.rhythmBySpanId}
                        playheadAkshara={playheadAkshara}
                        crossSectionTieChains={crossSectionRhythmTieChains}
                      />
                    )}
                    {(renderedTimelineLayerModel.showChannelHocketTransportRenderLayers ||
                      timelineRenderSyncing) &&
                      (channelHocketEnabled ||
                        renderedTimelineLayerModel.visibleChannelHocketEvents.length > 0) && (
                        <StableChannelHocketTimelineLane
                          section={section}
                          channelEvents={
                            renderedTimelineLayerModel.visibleChannelHocketEvents
                          }
                          channelVoiceLabels={synthVoiceLabels}
                          ticksPerCycle={renderedTimelineLayerModel.ticksPerCycle}
                          cycleBeats={cycleBeats}
                        />
                      )}
                  </div>
                </section>
              );
            })}
          </div>
          </div>
        </div>
      </section>
  );
}
