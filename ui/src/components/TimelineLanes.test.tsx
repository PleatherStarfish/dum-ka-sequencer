// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GatiMatraLane,
  RhythmLayerLane,
  buildCrossSectionRhythmTieChains,
} from "./TimelineLanes";
import type { ResolvedBeatView, ResolvedSectionRun } from "../resolvedSections";
import type { ResolvedRhythmCell, ResolvedRhythmSpan } from "../bridge";

function beatView(beat: number, gati: number): ResolvedBeatView {
  return {
    beat,
    gati,
    effectiveGati: gati,
    startAkshara: beat - 1,
    endAkshara: beat,
    divisionIndex: null,
    divisionCount: null,
    sectionIndex: 0,
    jathi: null,
    sectionStart: beat === 1,
    accentVelocity: 96,
    pitch: 45,
    baseVelocity: 96,
    automationPhase: null,
    automationValues: [],
  };
}

function sectionRun(beats: number, gati: number): ResolvedSectionRun {
  return {
    sectionIndex: 0,
    startBeat: 1,
    endBeat: beats,
    gati,
    effectiveGati: gati,
    timingMatras: beats * gati,
    gatiTimingFrameMatras: beats * gati,
    gatiTimingFrameBeats: beats,
    jathi: null,
    customSubdivision: false,
    divisionCount: 0,
    beats: Array.from({ length: beats }, (_, i) => beatView(i + 1, gati)),
    pulseSpans: [],
  };
}

describe("GatiMatraLane ruler anchors", () => {
  afterEach(cleanup);

  it("keeps every label at ordinary densities", () => {
    const { getAllByTestId } = render(
      <GatiMatraLane section={sectionRun(4, 4)} playheadAkshara={null} />
    );
    const cells = getAllByTestId("gati-matra-cell");
    expect(cells.length).toBe(16);
    expect(cells.every((cell) => cell.textContent !== "")).toBe(true);
  });

  it("labels the beat's principal divisions on a dense grid", () => {
    const { getAllByTestId } = render(
      <GatiMatraLane section={sectionRun(4, 20)} playheadAkshara={null} />
    );
    const cells = getAllByTestId("gati-matra-cell");
    expect(cells.length).toBe(80);
    // anchorStride(20, 4) = 5: quarter-beat anchors 1/6/11/16, per beat.
    const firstBeat = cells.slice(0, 20);
    const labels = firstBeat
      .map((cell, index) => (cell.textContent !== "" ? index + 1 : null))
      .filter((value): value is number => value !== null);
    expect(labels).toEqual([1, 6, 11, 16]);
    expect(
      firstBeat
        .filter((cell) => cell.textContent !== "")
        .every((cell) => cell.classList.contains("is-ruler-anchor"))
    ).toBe(true);
    expect(cells.filter((cell) => cell.textContent !== "").length).toBe(16);
  });

  it("labels only beat starts on a prime grid", () => {
    const { getAllByTestId } = render(
      <GatiMatraLane section={sectionRun(4, 7)} playheadAkshara={null} />
    );
    const cells = getAllByTestId("gati-matra-cell");
    // anchorStride(7, 4) = 7: a prime pulse count has no useful interior
    // division, so only the beat start carries a number.
    const labeled = cells.filter((cell) => cell.textContent !== "");
    expect(labeled.length).toBe(4);
    expect(labeled.every((cell) => cell.textContent === "1")).toBe(true);
  });

  it("falls back to beat starts when a long section blows the label budget", () => {
    const { getAllByTestId } = render(
      <GatiMatraLane section={sectionRun(4, 35)} playheadAkshara={null} />
    );
    const cells = getAllByTestId("gati-matra-cell");
    expect(cells.length).toBe(140);
    const labeled = cells.filter((cell) => cell.textContent !== "");
    expect(labeled.length).toBe(4);
    expect(
      cells
        .filter((cell) => cell.classList.contains("is-beat-start"))
        .every((cell) => cell.textContent === "1")
    ).toBe(true);
  });
});

describe("RhythmLayerLane generator cells", () => {
  afterEach(cleanup);

  const laneSection = (): ResolvedSectionRun => ({
    ...sectionRun(1, 4),
    pulseSpans: [
      {
        id: 9,
        kind: "gatiBeat",
        sectionIndex: 0,
        beat: 1,
        gati: 4,
        jathi: null,
        index: 0,
        start: 0,
        duration: 1,
        startMatra: 0,
        matraLen: 4,
        subdivision: 4,
        protectedCuts: [],
        tags: [],
        matraVelocities: [125, 96, 96, 96],
      },
    ],
  });
  const laneCell = (cell: Partial<ResolvedRhythmCell>): ResolvedRhythmCell => ({
    index: 0,
    start: 0,
    len: 1,
    rest: false,
    tiedFromPrevious: false,
    tiedToNext: false,
    ...cell,
  });

  it("shades sounding cells by inherited velocity and titles the value", () => {
    const rhythmBySpanId = new Map<number, ResolvedRhythmSpan>([
      [
        9,
        {
          spanId: 9,
          spanLen: 4,
          cells: [
            laneCell({ index: 0, start: 0, len: 1, velocity: 125 }),
            laneCell({ index: 1, start: 1, len: 2, velocity: 96 }),
            laneCell({ index: 2, start: 3, len: 1, rest: true, velocity: 96 }),
          ],
        },
      ],
    ]);
    const { container } = render(
      <RhythmLayerLane
        section={laneSection()}
        rhythmBySpanId={rhythmBySpanId}
        playheadAkshara={null}
      />
    );

    const cells = Array.from(container.querySelectorAll(".rhythm-layer-span i"));
    expect(cells.length).toBe(3);
    // 125/127 ≈ 94% lane color; 96/127 ≈ 72% (the legacy default look).
    expect((cells[0] as HTMLElement).style.getPropertyValue("--velocity-mix")).toBe("94%");
    expect(cells[0]!.getAttribute("title")).toContain("velocity 125");
    expect((cells[1] as HTMLElement).style.getPropertyValue("--velocity-mix")).toBe("72%");
    expect(cells[1]!.getAttribute("title")).toContain("velocity 96");
    // Rest cells never shade or advertise a velocity, even when stamped.
    expect((cells[2] as HTMLElement).style.getPropertyValue("--velocity-mix")).toBe("");
    expect(cells[2]!.getAttribute("title")).not.toContain("velocity");
    // ...and carry no badge: the gap reads itself.
    expect(cells[2]!.textContent).toBe("");
  });

  it("keeps the legacy look for velocity-less cells", () => {
    const rhythmBySpanId = new Map<number, ResolvedRhythmSpan>([
      [9, { spanId: 9, spanLen: 4, cells: [laneCell({ len: 4 })] }],
    ]);
    const { container } = render(
      <RhythmLayerLane
        section={laneSection()}
        rhythmBySpanId={rhythmBySpanId}
        playheadAkshara={null}
      />
    );

    const cell = container.querySelector(".rhythm-layer-span i") as HTMLElement;
    expect(cell.style.getPropertyValue("--velocity-mix")).toBe("");
    expect(cell.getAttribute("title")).not.toContain("velocity");
  });

  it("renders a cross-span tied chain as one visual note and one matra badge", () => {
    const section = sectionRun(2, 5);
    const pulseSpan = (id: number, beat: number) => ({
      id,
      kind: "gatiBeat" as const,
      sectionIndex: 0,
      beat,
      gati: 5,
      jathi: null,
      index: beat - 1,
      start: beat - 1,
      duration: 1,
      startMatra: (beat - 1) * 5,
      matraLen: 5,
      subdivision: 5,
      protectedCuts: [],
      tags: [],
      matraVelocities: [111, 96, 96, 96, 96],
    });
    section.pulseSpans = [pulseSpan(9, 1), pulseSpan(10, 2)];
    const rhythmBySpanId = new Map<number, ResolvedRhythmSpan>([
      [
        9,
        {
          spanId: 9,
          spanLen: 5,
          cells: [
            laneCell({ index: 0, start: 0, len: 2, velocity: 111 }),
            laneCell({ index: 1, start: 2, len: 2, velocity: 96 }),
            laneCell({
              index: 2,
              start: 4,
              len: 1,
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
            laneCell({
              index: 0,
              start: 0,
              len: 1,
              tiedFromPrevious: true,
              velocity: 80,
            }),
            laneCell({ index: 1, start: 1, len: 2, velocity: 96 }),
            laneCell({ index: 2, start: 3, len: 2, velocity: 96 }),
          ],
        },
      ],
    ]);
    const { container, getAllByTestId, getByRole } = render(
      <RhythmLayerLane
        section={section}
        rhythmBySpanId={rhythmBySpanId}
        playheadAkshara={null}
      />
    );

    // Six raw cells describe five audible notes. The paired boundary chunks
    // share one DOM element and therefore cannot draw an inner stroke/cap.
    expect(getAllByTestId("rhythm-layer-cell")).toHaveLength(5);
    const joined = getByRole("img", {
      name: "note for 2 pulses (2/5 beat) across 2 spans, velocity 96",
    });
    // Exact class list: the chain class and nothing else — pins both the
    // joined rendering and the absence of any legacy per-side tie styling.
    expect(joined.className).toBe("is-tied-chain");
    expect(joined.getAttribute("data-source-cells")).toBe("2");
    expect(joined.getAttribute("data-source-spans")).toBe("2");
    // Badges speak in beats: 2 pulses on the 5-pulse grid is 2/5.
    expect(joined.textContent).toBe("2/5");
    expect((joined as HTMLElement).style.left).toContain("80%");
    expect((joined as HTMLElement).style.width).toContain("40%");
    expect(joined.closest(".rhythm-layer-span")!.classList).toContain(
      "has-cross-span-chain"
    );
    expect(
      container.querySelectorAll(".rhythm-layer-span")[1]!.querySelectorAll("i")
    ).toHaveLength(2);
  });

  it("gives a tied note crossing an authored section seam one accessible owner", () => {
    const firstSection = sectionRun(1, 5);
    const secondSection: ResolvedSectionRun = {
      ...sectionRun(1, 5),
      sectionIndex: 1,
      startBeat: 2,
      endBeat: 2,
      beats: [
        {
          ...beatView(2, 5),
          sectionIndex: 1,
          sectionStart: true,
        },
      ],
    };
    const pulseSpan = (id: number, sectionIndex: number, beat: number) => ({
      id,
      kind: "gatiBeat" as const,
      sectionIndex,
      beat,
      gati: 5,
      jathi: null,
      index: 0,
      start: beat - 1,
      duration: 1,
      startMatra: (beat - 1) * 5,
      matraLen: 5,
      subdivision: 5,
      protectedCuts: [],
      tags: [],
      matraVelocities: [111, 96, 96, 96, 96],
    });
    firstSection.pulseSpans = [pulseSpan(9, 0, 1)];
    secondSection.pulseSpans = [pulseSpan(10, 1, 2)];
    const rhythmBySpanId = new Map<number, ResolvedRhythmSpan>([
      [
        9,
        {
          spanId: 9,
          spanLen: 5,
          cells: [
            laneCell({ index: 0, start: 0, len: 4, velocity: 111 }),
            laneCell({
              index: 1,
              start: 4,
              len: 1,
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
            laneCell({
              index: 0,
              start: 0,
              len: 1,
              tiedFromPrevious: true,
              velocity: 40,
            }),
            laneCell({ index: 1, start: 1, len: 4, velocity: 111 }),
          ],
        },
      ],
    ]);
    const crossSectionTieChains = buildCrossSectionRhythmTieChains(
      [firstSection, secondSection],
      rhythmBySpanId
    );
    const { getAllByRole, getAllByTestId, getByRole } = render(
      <>
        <RhythmLayerLane
          section={firstSection}
          rhythmBySpanId={rhythmBySpanId}
          playheadAkshara={null}
          crossSectionTieChains={crossSectionTieChains}
        />
        <RhythmLayerLane
          section={secondSection}
          rhythmBySpanId={rhythmBySpanId}
          playheadAkshara={null}
          crossSectionTieChains={crossSectionTieChains}
        />
      </>
    );

    // The two section-local fragments preserve each section's geometry, but
    // only the opener is exposed as a note. Its duration and accent velocity
    // match the one realized MIDI note group.
    expect(getAllByTestId("rhythm-layer-cell")).toHaveLength(4);
    expect(getAllByRole("img")).toHaveLength(3);
    const owner = getByRole("img", {
      name: "note for 2 pulses (2/5 beat) across 2 spans and 2 sections, velocity 96",
    });
    expect(owner.getAttribute("data-tie-chain-owner")).toBe("true");
    expect(owner.textContent).toBe("2/5");
    expect(owner.getAttribute("data-open-section-right")).toBe("true");
    expect((owner as HTMLElement).style.right).toBe("-1px");
    expect((owner as HTMLElement).style.getPropertyValue("--velocity-mix")).toBe(
      "72%"
    );
    const continuation = getAllByTestId("rhythm-layer-cell").find(
      (cell) => cell.getAttribute("data-tie-chain-owner") === "false"
    );
    expect(continuation?.getAttribute("aria-hidden")).toBe("true");
    expect(continuation?.textContent).toBe("");
    expect(continuation?.getAttribute("data-open-section-left")).toBe("true");
    expect((continuation as HTMLElement).style.left).toBe("-1px");
    expect(
      (continuation as HTMLElement).style.getPropertyValue("--velocity-mix")
    ).toBe("72%");
  });
});


import type { AutomationCurve } from "../bridge";
import type { AutomationTargetDef } from "../automationTargets";
import { discardEditorDrafts } from "../editorDraftFlush";
import { AutomationGraphEditor } from "./TimelineLanes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const curve: AutomationCurve = {
  id: "curve-1",
  enabled: true,
  interpolation: "linear",
  points: [
    {
      id: "point-a",
      time: { numer: 0, denom: 1 },
      value: { type: "number", value: 0.25 },
      anchorId: null,
    },
    {
      id: "point-b",
      time: { numer: 1, denom: 1 },
      value: { type: "number", value: 0.75 },
      anchorId: null,
    },
  ],
};

const def: AutomationTargetDef = {
  target: "test.target",
  label: "Test target",
  group: "Test",
  valueKind: "float",
  min: 0,
  max: 1,
  step: 0.01,
  sampleRate: "beat",
  fallback: 0,
};

const rect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 760,
  bottom: 260,
  width: 760,
  height: 260,
  toJSON: () => ({}),
} as DOMRect;

describe("AutomationGraphEditor drag ownership", () => {
  it("selects an offset point click without moving or mutating it", () => {
    const onAddPoint = vi.fn();
    const onPointChange = vi.fn();
    const onPointSelect = vi.fn();
    const { container } = render(
      <AutomationGraphEditor
        curve={curve}
        def={def}
        axisRange={{ min: 0, max: 1 }}
        markers={[]}
        selectedPointId="point-a"
        selectedSegmentPointId="point-a"
        disabled={false}
        onAddPoint={onAddPoint}
        onPointChange={onPointChange}
        onPointSelect={onPointSelect}
        onSegmentSelect={vi.fn()}
      />
    );
    const svg = container.querySelector("svg")!;
    const point = container.querySelector<SVGCircleElement>(
      ".automation-graph-point"
    )!;
    const getRect = vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(rect);
    const centerX = Number(point.getAttribute("cx"));
    const centerY = Number(point.getAttribute("cy"));

    fireEvent.pointerDown(point, {
      button: 0,
      clientX: centerX + 4,
      clientY: centerY - 3,
      pointerId: 3,
    });
    fireEvent.pointerUp(svg, {
      clientX: centerX + 4,
      clientY: centerY - 3,
      pointerId: 3,
    });

    expect(onPointSelect).toHaveBeenCalledWith("point-a");
    expect(onPointChange).not.toHaveBeenCalled();
    expect(onAddPoint).not.toHaveBeenCalled();
    expect(getRect).toHaveBeenCalledTimes(1);
  });

  it("keeps pointer motion local, caches geometry, and commits once on release", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 17));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const onPointChange = vi.fn();
    const { container } = render(
      <AutomationGraphEditor
        curve={curve}
        def={def}
        axisRange={{ min: 0, max: 1 }}
        markers={[]}
        selectedPointId="point-a"
        selectedSegmentPointId="point-a"
        disabled={false}
        onAddPoint={vi.fn()}
        onPointChange={onPointChange}
        onPointSelect={vi.fn()}
        onSegmentSelect={vi.fn()}
      />
    );
    const svg = container.querySelector("svg")!;
    const point = container.querySelector<SVGCircleElement>(
      ".automation-graph-point"
    )!;
    const getRect = vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(rect);

    fireEvent.pointerDown(point, {
      button: 0,
      clientX: 34,
      clientY: 200,
      pointerId: 4,
    });
    fireEvent.pointerMove(svg, {
      buttons: 1,
      clientX: 300,
      clientY: 120,
      pointerId: 4,
    });
    fireEvent.pointerMove(svg, {
      buttons: 1,
      clientX: 500,
      clientY: 80,
      pointerId: 4,
    });

    expect(onPointChange).not.toHaveBeenCalled();
    expect(getRect).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(svg, {
      clientX: 500,
      clientY: 80,
      pointerId: 4,
    });

    expect(onPointChange).toHaveBeenCalledTimes(1);
    expect(onPointChange).toHaveBeenCalledWith(
      "point-a",
      expect.objectContaining({ anchorId: null })
    );
    expect(getRect).toHaveBeenCalledTimes(1);
  });

  it("discards a cancelled drag", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 18));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const onPointChange = vi.fn();
    const { container } = render(
      <AutomationGraphEditor
        curve={curve}
        def={def}
        axisRange={{ min: 0, max: 1 }}
        markers={[]}
        selectedPointId="point-a"
        selectedSegmentPointId="point-a"
        disabled={false}
        onAddPoint={vi.fn()}
        onPointChange={onPointChange}
        onPointSelect={vi.fn()}
        onSegmentSelect={vi.fn()}
      />
    );
    const svg = container.querySelector("svg")!;
    const point = container.querySelector<SVGCircleElement>(
      ".automation-graph-point"
    )!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(rect);

    fireEvent.pointerDown(point, { button: 0, pointerId: 5 });
    fireEvent.pointerMove(svg, {
      buttons: 1,
      clientX: 400,
      clientY: 100,
      pointerId: 5,
    });
    fireEvent.pointerCancel(svg, { pointerId: 5 });

    expect(onPointChange).not.toHaveBeenCalled();
  });

  it("discards an active point drag before trailing release or lost capture", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 19));
    const cancelFrame = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const onPointChange = vi.fn();
    const { container } = render(
      <AutomationGraphEditor
        curve={curve}
        def={def}
        axisRange={{ min: 0, max: 1 }}
        markers={[]}
        selectedPointId="point-a"
        selectedSegmentPointId="point-a"
        disabled={false}
        onAddPoint={vi.fn()}
        onPointChange={onPointChange}
        onPointSelect={vi.fn()}
        onSegmentSelect={vi.fn()}
      />
    );
    const svg = container.querySelector("svg")!;
    const point = container.querySelector<SVGCircleElement>(
      ".automation-graph-point"
    )!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(rect);
    fireEvent.pointerDown(point, {
      button: 0,
      clientX: 34,
      clientY: 200,
      pointerId: 6,
    });
    fireEvent.pointerMove(svg, {
      buttons: 1,
      clientX: 500,
      clientY: 80,
      pointerId: 6,
    });

    act(discardEditorDrafts);
    expect(cancelFrame).toHaveBeenCalledWith(19);
    fireEvent.pointerUp(svg, {
      clientX: 500,
      clientY: 80,
      pointerId: 6,
    });
    fireEvent.lostPointerCapture(svg, { pointerId: 6 });

    expect(onPointChange).not.toHaveBeenCalled();
  });
});
