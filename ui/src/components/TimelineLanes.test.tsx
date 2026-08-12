// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GatiMatraLane, RhythmLayerLane } from "./TimelineLanes";
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

describe("GatiMatraLane label thinning", () => {
  afterEach(cleanup);

  it("keeps every label at ordinary densities", () => {
    const { getAllByTestId } = render(
      <GatiMatraLane section={sectionRun(4, 4)} playheadAkshara={null} />
    );
    const cells = getAllByTestId("gati-matra-cell");
    expect(cells.length).toBe(16);
    expect(cells.every((cell) => cell.textContent !== "")).toBe(true);
  });

  it("thins labels above the density budget but renders every cell", () => {
    const { getAllByTestId } = render(
      <GatiMatraLane section={sectionRun(4, 35)} playheadAkshara={null} />
    );
    const cells = getAllByTestId("gati-matra-cell");
    expect(cells.length).toBe(140);
    const labeled = cells.filter((cell) => cell.textContent !== "");
    // stride ⌈140/96⌉ = 2: pulses 1,3,5,…,35 per beat, beat starts included.
    expect(labeled.length).toBe(4 * 18);
    expect(cells[0]!.textContent).toBe("1");
    expect(cells[1]!.textContent).toBe("");
    expect(
      cells
        .filter((cell) => cell.classList.contains("is-beat-start"))
        .every((cell) => cell.textContent === "1")
    ).toBe(true);
  });
});

describe("RhythmLayerLane accent shading", () => {
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
