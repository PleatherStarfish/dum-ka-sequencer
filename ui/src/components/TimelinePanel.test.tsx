// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_STOPPED_PREVIEW_CYCLE } from "../timelineModel";
import type { ResolvedRhythmCell, ResolvedRhythmSpan } from "../bridge";
import type { ResolvedBeatView, ResolvedSectionRun } from "../resolvedSections";
import {
  StoppedPreviewCycleSelector,
  TimelinePanel,
  type TimelinePanelProps,
} from "./TimelinePanel";

afterEach(cleanup);

describe("StoppedPreviewCycleSelector", () => {
  it("caps the displayed cycle and disables advancing at the stopped limit", () => {
    const setUserPreviewCycle = vi.fn();
    render(
      <StoppedPreviewCycleSelector
        displayedCycle={0}
        isPlaying={false}
        setUserPreviewCycle={setUserPreviewCycle}
        userPreviewCycle={Number.MAX_SAFE_INTEGER}
      />
    );

    expect(screen.getByText(String(MAX_STOPPED_PREVIEW_CYCLE))).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "Inspect next stopped cycle",
      }) as HTMLButtonElement).disabled
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect previous stopped cycle" })
    );
    const update = setUserPreviewCycle.mock.calls[0]?.[0] as (
      cycle: number
    ) => number;
    expect(update(Number.MAX_SAFE_INTEGER)).toBe(
      MAX_STOPPED_PREVIEW_CYCLE - 1
    );
  });

  it("clamps the next-cycle state update at the stopped limit", () => {
    const setUserPreviewCycle = vi.fn();
    render(
      <StoppedPreviewCycleSelector
        displayedCycle={0}
        isPlaying={false}
        setUserPreviewCycle={setUserPreviewCycle}
        userPreviewCycle={MAX_STOPPED_PREVIEW_CYCLE - 1}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect next stopped cycle" })
    );
    const update = setUserPreviewCycle.mock.calls[0]?.[0] as (
      cycle: number
    ) => number;
    expect(update(MAX_STOPPED_PREVIEW_CYCLE - 1)).toBe(
      MAX_STOPPED_PREVIEW_CYCLE
    );
    expect(update(MAX_STOPPED_PREVIEW_CYCLE)).toBe(MAX_STOPPED_PREVIEW_CYCLE);
  });
});

describe("TimelinePanel cross-section ties", () => {
  const beatView = (
    beat: number,
    sectionIndex: number,
    gati: number
  ): ResolvedBeatView => ({
    beat,
    gati,
    effectiveGati: gati,
    startAkshara: beat - 1,
    endAkshara: beat,
    divisionIndex: null,
    divisionCount: null,
    sectionIndex,
    jathi: null,
    sectionStart: true,
    accentVelocity: 111,
    pitch: 45,
    baseVelocity: 96,
    automationPhase: null,
    automationValues: [],
  });

  const section = (
    sectionIndex: number,
    beat: number,
    spanId: number,
    gati: number
  ): ResolvedSectionRun => ({
    sectionIndex,
    startBeat: beat,
    endBeat: beat,
    gati,
    effectiveGati: gati,
    timingMatras: gati,
    gatiTimingFrameMatras: gati,
    gatiTimingFrameBeats: 1,
    jathi: null,
    customSubdivision: false,
    divisionCount: 0,
    beats: [beatView(beat, sectionIndex, gati)],
    pulseSpans: [
      {
        id: spanId,
        kind: "gatiBeat",
        sectionIndex,
        beat,
        gati,
        jathi: null,
        index: 0,
        start: beat - 1,
        duration: 1,
        startMatra: beat === 1 ? 0 : 4,
        matraLen: gati,
        subdivision: gati,
        protectedCuts: [],
        tags: [],
        matraVelocities: Array.from({ length: gati }, (_, index) =>
          index === 0 ? 111 : 96
        ),
      },
    ],
  });

  const cell = (
    overrides: Partial<ResolvedRhythmCell>
  ): ResolvedRhythmCell => ({
    index: 0,
    start: 0,
    len: 1,
    rest: false,
    tiedFromPrevious: false,
    tiedToNext: false,
    ...overrides,
  });

  it("renders one label rail whose rows mirror the section lane stack", () => {
    // The rail lives OUTSIDE the sections grid (playhead geometry depends
    // on it), so nothing structural ties it to the per-section rows. This
    // parity pin is the drift fence: same count, same order, same height
    // classes, and the track rows keep their accessible names.
    const sections = [section(0, 1, 9, 4), section(1, 2, 10, 5)];
    const rhythmBySpanId = new Map<number, ResolvedRhythmSpan>([
      [9, { spanId: 9, spanLen: 4, cells: [cell({ len: 4 })] }],
      [10, { spanId: 10, spanLen: 5, cells: [cell({ len: 5 })] }],
    ]);
    const props: TimelinePanelProps = {
      activeParallelTrack: {
        id: "track-1",
        name: "Track 1",
        color: "#2aa198",
        muted: false,
        soloed: false,
        tempoMode: "global",
        customTempoBpm: 120,
        tempoBadge: null,
        cycleLengthMode: "global",
        customCycleBeats: 2,
        midiChannels: [1],
        inspectableMidiChannels: [1],
        channelHocketEnabled: false,
        triggered: false,
      },
      activeParallelTrackCustomName: "",
      activeParallelTrackHasCustomName: false,
      activeParallelTrackLabel: "Track 1",
      activeTimelineTrackId: "track-1",
      automationTargetDefs: [],
      channelHocketEnabled: false,
      cycleBeats: 2,
      displayedCycle: 0,
      editBoundaryFromRail: vi.fn(),
      livePositionRef: { current: null },
      normalizedBoundaries: [],
      openBoundaryDetail: vi.fn(),
      playbackStructureLocked: false,
      playheadAkshara: null,
      removeBoundaryAfterBeat: vi.fn(),
      renderedActiveTrackSuppressedNoteGroups: 0,
      renderedResolvedSections: sections,
      renderedTimelineLayerModel: {
        layoutCycle: 0,
        ticksPerCycle: 960,
        showCoherentRhythmLayer: true,
        showChannelHocketTransportRenderLayers: false,
        rhythmBySpanId,
        visibleChannelHocketEvents: [],
      },
      renderedTimelineLayoutCycle: 0,
      renderedTimelinePreview: null,
      rhythmPlaybackEnabled: true,
      setTimelineAutomationPickerOpen: vi.fn(),
      setTimelineAutomationTargetIds: vi.fn(),
      setUserPreviewCycle: vi.fn(),
      snapshot: null,
      synthVoiceLabels: {},
      timelineAutomationPickerOpen: false,
      timelineAutomationPickerRef: { current: null },
      timelineAutomationTrackOptions: [],
      timelineLayoutCycle: 0,
      timelineRenderSyncing: false,
      toggleTimelineAutomationTarget: vi.fn(),
      transportIsPlaying: false,
      userPreviewCycle: 0,
      visibleTimelineAutomationTargetIds: new Set(),
      visibleTimelineAutomationTracks: [],
    };

    render(<TimelinePanel {...props} />);

    const railCells = screen.getAllByTestId("timeline-lane-label");
    const firstSection = screen.getAllByTestId("resolved-section")[0]!;
    const rows = Array.from(
      firstSection.querySelectorAll(".aligned-timeline-row")
    );
    expect(railCells.length).toBe(rows.length);
    railCells.forEach((railCell, index) => {
      const modifier = Array.from(railCell.classList).find((token) =>
        token.startsWith("is-")
      );
      expect(modifier).toBeTruthy();
      expect(rows[index]!.classList.contains(modifier!)).toBe(true);
    });
    expect(railCells.map((node) => node.textContent)).toEqual([
      "beats",
      "subdivision 4",
      "grouping none",
      "gen · subdivision",
    ]);
    // Track rows keep their names for assistive tech.
    expect(rows[0]!.getAttribute("aria-label")).toBe("beats");
  });

  it("keeps different-subdivision section grids but does not add their local pulse units", () => {
    const sections = [section(0, 1, 9, 4), section(1, 2, 10, 5)];
    const rhythmBySpanId = new Map<number, ResolvedRhythmSpan>([
      [
        9,
        {
          spanId: 9,
          spanLen: 4,
          cells: [
            cell({ index: 0, start: 0, len: 3, velocity: 111 }),
            cell({
              index: 1,
              start: 3,
              tiedToNext: true,
              velocity: 96,
            }),
          ],
        },
      ],
      [
        10,
        {
          spanId: 10,
          spanLen: 5,
          cells: [
            cell({ tiedFromPrevious: true, velocity: 40 }),
            cell({ index: 1, start: 1, len: 4, velocity: 111 }),
          ],
        },
      ],
    ]);
    const props: TimelinePanelProps = {
      activeParallelTrack: {
        id: "track-1",
        name: "Track 1",
        color: "#2aa198",
        muted: false,
        soloed: false,
        tempoMode: "global",
        customTempoBpm: 120,
        tempoBadge: null,
        cycleLengthMode: "global",
        customCycleBeats: 2,
        midiChannels: [1],
        inspectableMidiChannels: [1],
        channelHocketEnabled: false,
        triggered: false,
      },
      activeParallelTrackCustomName: "",
      activeParallelTrackHasCustomName: false,
      activeParallelTrackLabel: "Track 1",
      activeTimelineTrackId: "track-1",
      automationTargetDefs: [],
      channelHocketEnabled: false,
      cycleBeats: 2,
      displayedCycle: 0,
      editBoundaryFromRail: vi.fn(),
      livePositionRef: { current: null },
      normalizedBoundaries: [],
      openBoundaryDetail: vi.fn(),
      playbackStructureLocked: false,
      playheadAkshara: null,
      removeBoundaryAfterBeat: vi.fn(),
      renderedActiveTrackSuppressedNoteGroups: 0,
      renderedResolvedSections: sections,
      renderedTimelineLayerModel: {
        layoutCycle: 0,
        ticksPerCycle: 960,
        showCoherentRhythmLayer: true,
        showChannelHocketTransportRenderLayers: false,
        rhythmBySpanId,
        visibleChannelHocketEvents: [],
      },
      renderedTimelineLayoutCycle: 0,
      renderedTimelinePreview: null,
      rhythmPlaybackEnabled: true,
      setTimelineAutomationPickerOpen: vi.fn(),
      setTimelineAutomationTargetIds: vi.fn(),
      setUserPreviewCycle: vi.fn(),
      snapshot: null,
      synthVoiceLabels: {},
      timelineAutomationPickerOpen: false,
      timelineAutomationPickerRef: { current: null },
      timelineAutomationTrackOptions: [],
      timelineLayoutCycle: 0,
      timelineRenderSyncing: false,
      toggleTimelineAutomationTarget: vi.fn(),
      transportIsPlaying: false,
      userPreviewCycle: 0,
      visibleTimelineAutomationTargetIds: new Set(),
      visibleTimelineAutomationTracks: [],
    };

    render(<TimelinePanel {...props} />);

    const renderedSections = screen.getAllByTestId("resolved-section");
    expect(renderedSections).toHaveLength(2);
    expect(
      renderedSections.map(
        (node) => node.querySelector(".resolved-section-header span")?.textContent
      )
    ).toEqual(["beats 1", "beats 2"]);
    expect(
      screen.getByRole("img", {
        name: "note sustaining across 2 spans and 2 sections, velocity 96",
      })
    ).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(3);
    const fragments = screen.getAllByTestId("rhythm-layer-cell");
    expect(fragments).toHaveLength(4);
    expect(
      fragments.filter((node) => node.getAttribute("aria-hidden") === "true")
    ).toHaveLength(1);
    const owner = fragments.find(
      (node) => node.getAttribute("data-tie-chain-owner") === "true"
    );
    expect(owner?.getAttribute("data-pulse-unit")).toBe("mixed");
    expect(owner?.textContent).toBe("↔");
    expect(owner?.getAttribute("aria-label")).not.toContain("pulse");
    expect(owner?.getAttribute("data-open-section-right")).toBe("true");
    expect((owner as HTMLElement).style.right).toBe("-1px");
    const continuation = fragments.find(
      (node) => node.getAttribute("data-tie-chain-owner") === "false"
    );
    expect(continuation?.getAttribute("data-open-section-left")).toBe("true");
    expect((continuation as HTMLElement).style.left).toBe("-1px");
  });
});
