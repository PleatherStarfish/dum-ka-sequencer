// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DirectiveTraceEntry, EvolutionDirective } from "../bridge";
import {
  DEFAULT_DIRECTIVE_OPTIONS,
  DEFAULT_PERCEPTUAL_MAGNITUDE,
  MAX_EVOLUTION_DIRECTIVES,
} from "../dumkaEvolvePlan";
import { MAX_STOPPED_PREVIEW_CYCLE } from "../timelineModel";
import { EvolvePlanEditor } from "./EvolvePlanEditor";

afterEach(cleanup);

function directive(
  overrides: Partial<EvolutionDirective> = {}
): EvolutionDirective {
  return {
    id: 1,
    order: 0,
    enabled: true,
    fromCycle: 5,
    toCycle: 9,
    family: "syncopate",
    intensity: 32,
    pacing: "perCycle",
    scope: null,
    options: { ...DEFAULT_DIRECTIVE_OPTIONS },
    ...overrides,
  };
}

describe("EvolvePlanEditor", () => {
  it("renders locked cycle 0 and the fixed family lanes", () => {
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={12}
        totalBeats={4}
        onPlanChange={vi.fn()}
      />
    );

    expect(screen.getByText("0 seed")).toBeTruthy();
    expect(screen.getByLabelText("Remove lane")).toBeTruthy();
    expect(screen.getByLabelText("Morph lane")).toBeTruthy();
    expect(screen.getByLabelText("Stochastic lane")).toBeTruthy();
    expect(screen.getAllByTitle("Cycle 0 is the locked seed")).toHaveLength(10);
  });

  it("adds a pin through a lane's keyboard-accessible add control", () => {
    const onPlanChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={12}
        totalBeats={4}
        onPlanChange={onPlanChange}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Add Fragment pin" }), {
      clientX: 112 + 7 * 54,
    });
    expect(onPlanChange).toHaveBeenCalledTimes(1);
    expect(onPlanChange.mock.calls[0]?.[0]?.[0]).toMatchObject({
      family: "fragment",
      fromCycle: 7,
      toCycle: 7,
      intensity: 25,
    });
  });

  it("adds at the first open cycle when the lane control is keyboard-activated", () => {
    const onPlanChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[directive({ family: "fragment", fromCycle: 1, toCycle: 2 })]}
        planLengthCycles={12}
        totalBeats={4}
        onPlanChange={onPlanChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Fragment pin" }), {
      detail: 0,
    });
    expect(onPlanChange).toHaveBeenCalledWith([
      expect.objectContaining({ fromCycle: 1, toCycle: 2 }),
      expect.objectContaining({ family: "fragment", fromCycle: 3, toCycle: 3 }),
    ]);
  });

  it("selects a range, scrubs after, and authors inspector fields", () => {
    const onPlanChange = vi.fn();
    const onPreviewCycleChange = vi.fn();
    const onAuditionCycle = vi.fn();
    const plan = [directive()];
    render(
      <EvolvePlanEditor
        plan={plan}
        planLengthCycles={12}
        totalBeats={4}
        onPlanChange={onPlanChange}
        onPreviewCycleChange={onPreviewCycleChange}
        onAuditionCycle={onAuditionCycle}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Syncopate, cycles 5 through 9, 32%, repeat each cycle",
      })
    );
    expect(onPreviewCycleChange).toHaveBeenCalledWith(5);
    expect(onAuditionCycle).toHaveBeenCalledWith(5, "after");

    fireEvent.change(screen.getByLabelText("Directive intensity"), {
      target: { value: "47" },
    });
    fireEvent.blur(screen.getByLabelText("Directive intensity"));
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ intensity: 47 }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Scope beat 3" }));
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ scope: { startBeat: 2, lenBeats: 1 } }),
    ]);
  });

  it("makes a contiguous beat run with shift-click and clears to whole cycle", () => {
    const onPlanChange = vi.fn();
    const plan = [directive({ scope: { startBeat: 1, lenBeats: 1 } })];
    render(
      <EvolvePlanEditor
        plan={plan}
        planLengthCycles={12}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Scope beat 4" }), {
      shiftKey: true,
    });
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ scope: { startBeat: 1, lenBeats: 3 } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Whole cycle" }));
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ scope: null }),
    ]);
  });

  it("shows the actual inherited global and starts an override from it", () => {
    const onPlanChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[
          directive({
            family: "fragment",
            options: {
              ...DEFAULT_DIRECTIVE_OPTIONS,
              fillComplexity: null,
            },
          }),
        ]}
        planLengthCycles={12}
        totalBeats={4}
        initialSelectedId={1}
        inheritedOptions={{ fillComplexity: 67 }}
        onPlanChange={onPlanChange}
      />
    );

    expect(screen.getByText("Inherit global · 67")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Override Fill complexity"));
    expect(onPlanChange).toHaveBeenCalledWith([
      expect.objectContaining({
        options: expect.objectContaining({ fillComplexity: 67 }),
      }),
    ]);
  });

  it("shows the corridor band, authors a paired override, and labels clamps", () => {
    const onPlanChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[directive({ family: "fragment" })]}
        planLengthCycles={8}
        totalBeats={4}
        densityFloor={20}
        densityCeiling={60}
        inheritedOptions={{ densityFloor: 20, densityCeiling: 60 }}
        initialSelectedId={1}
        trace={[
          {
            cycle: 5,
            directiveId: 1,
            family: "fragment",
            requested: 2,
            applied: 1,
            skipped: "none",
            corridorClamp: { limit: "ceiling", densityPercent: 60 },
          },
        ]}
        cachedPreviews={[
          {
            cycle: 5,
            preview: {
              densityCorridor: { floor: 30, ceiling: 55 },
              spans: [
                {
                  spanId: 1,
                  spanLen: 4,
                  cells: [
                    { index: 0, start: 0, len: 2, rest: false, tiedFromPrevious: false, tiedToNext: false },
                    { index: 1, start: 2, len: 2, rest: true, tiedFromPrevious: false, tiedToNext: false },
                  ],
                },
              ],
            },
          },
        ]}
        onPlanChange={onPlanChange}
      />
    );

    expect(
      screen.getByRole("group", {
        name: /Cycle 5 density 25%, 1 onset, corridor 30% through 55%/,
      })
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Fragment: 1/2, ceiling corridor 60%")
    ).toBeTruthy();
    expect(screen.getByText("Inherit global · 20–60%")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Override density corridor"));
    expect(onPlanChange).toHaveBeenCalledWith([
      expect.objectContaining({
        options: expect.objectContaining({
          densityFloor: 20,
          densityCeiling: 60,
        }),
      }),
    ]);
  });

  it("authors the evolution curve from the card and the step-size lane", () => {
    const onCurveChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={16}
        totalBeats={4}
        curve={{
          enabled: true,
          modelVersion: "v1",
          toleranceMilli: 500,
          maxOperations: 4,
          points: [
            { cycle: 2, targetMilli: 2000 },
            { cycle: 10, targetMilli: 6000 },
          ],
        }}
        onCurveChange={onCurveChange}
        onPlanChange={vi.fn()}
      />
    );

    // The card lists points and the lane bands cover the interpolated span.
    expect(screen.getByLabelText("Curve points").textContent).toContain(
      "cycle 2 · 2.0"
    );
    expect(
      screen.getByRole("group", {
        name: "Cycle 6 step size not cached",
      })
    ).toBeTruthy();

    // Removing a point through the card.
    fireEvent.click(
      screen.getByLabelText("Remove curve point at cycle 10")
    );
    expect(onCurveChange).toHaveBeenCalledWith(
      expect.objectContaining({
        points: [{ cycle: 2, targetMilli: 2000 }],
      })
    );

    // A primary-button lane click upserts a point at that cycle; other
    // buttons must not author (the audit's pointer-guard lesson).
    const cell = screen.getByRole("group", {
      name: /Cycle 6 step size/,
    });
    fireEvent.pointerDown(cell, { button: 2, clientY: 0 });
    fireEvent.pointerDown(cell, { button: 0, clientY: 0 });
    const upserted = onCurveChange.mock.calls.at(-1)?.[0] as {
      points: Array<{ cycle: number }>;
    };
    expect(upserted.points.some((point) => point.cycle === 6)).toBe(true);
    // Exactly two authored changes: the removal and the single left click.
    expect(onCurveChange).toHaveBeenCalledTimes(2);
  });

  it("fit view scales the whole plan into the viewport as a dense surface", () => {
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={100}
        totalBeats={4}
        onPlanChange={vi.fn()}
      />
    );
    const scroller = screen.getByLabelText("Evolution score timeline");
    expect(scroller.getAttribute("style")).toContain("--evolve-cycle-width: 54px");
    expect(scroller.className).not.toContain("is-dense");

    const toggle = screen.getByRole("button", { name: "Fit view" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    // 100 cycles fit the (fallback) viewport: 9px cells, dense chrome on.
    expect(scroller.getAttribute("style")).toContain("--evolve-cycle-width: 9px");
    expect(scroller.className).toContain("is-dense");

    // Toggling back restores the manual zoom width.
    fireEvent.click(toggle);
    expect(scroller.getAttribute("style")).toContain("--evolve-cycle-width: 54px");
    expect(scroller.className).not.toContain("is-dense");
  });

  it("draws a property curve by clicking a lane and clears points with shift-click", () => {
    const onPropertyCurvesChange = vi.fn();
    const { rerender } = render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={16}
        totalBeats={4}
        propertyCurves={[]}
        onPropertyCurvesChange={onPropertyCurvesChange}
        onPlanChange={vi.fn()}
      />
    );
    const cell = screen.getByRole("group", { name: /Cycle 6 syncopation/ });
    // Non-primary buttons must not author (the audit's pointer-guard lesson).
    fireEvent.pointerDown(cell, { button: 2, clientY: 0 });
    expect(onPropertyCurvesChange).not.toHaveBeenCalled();
    // A primary click creates the syncopation curve with a point at cycle 6.
    // The press only previews a local draft; the commit lands on release so
    // in-progress drawing never rotates the app's preview request key.
    fireEvent.pointerDown(cell, { button: 0, clientY: 0 });
    expect(onPropertyCurvesChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(cell, {});
    expect(onPropertyCurvesChange).toHaveBeenCalledTimes(1);
    const created = onPropertyCurvesChange.mock.calls.at(-1)?.[0] as Array<{
      property: string;
      enabled: boolean;
      points: Array<{ cycle: number; targetMilli: number }>;
    }>;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      property: "syncopation",
      enabled: true,
      points: [{ cycle: 6, targetMilli: 0 }],
    });

    // With the curve present, shift-clicking its only point clears the curve.
    rerender(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={16}
        totalBeats={4}
        propertyCurves={created as never}
        onPropertyCurvesChange={onPropertyCurvesChange}
        onPlanChange={vi.fn()}
      />
    );
    const drawnCell = screen.getByRole("group", { name: /Cycle 6 syncopation/ });
    fireEvent.pointerDown(drawnCell, { button: 0, clientY: 0, shiftKey: true });
    expect(onPropertyCurvesChange).toHaveBeenLastCalledWith([]);
  });

  it("draws a freehand automation line by dragging across a lane", () => {
    const onPropertyCurvesChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={16}
        totalBeats={4}
        propertyCurves={[]}
        onPropertyCurvesChange={onPropertyCurvesChange}
        onPlanChange={vi.fn()}
      />
    );
    // Press on the Density lane at cycle 2, then drag right across cycles 3-4.
    // The cursor's X selects the cycle (LANE_LABEL_WIDTH 112 + cellWidth 54).
    const cell = screen.getByRole("group", { name: /Cycle 2 density/ });
    fireEvent.pointerDown(cell, {
      button: 0,
      pointerId: 1,
      clientX: 112 + 2.5 * 54,
      clientY: 0,
    });
    fireEvent.pointerMove(cell, {
      pointerId: 1,
      clientX: 112 + 3.5 * 54,
      clientY: 0,
    });
    fireEvent.pointerMove(cell, {
      pointerId: 1,
      clientX: 112 + 4.5 * 54,
      clientY: 0,
    });
    fireEvent.pointerUp(cell, { pointerId: 1 });
    // The whole freehand stroke lands as ONE commit on release. Per-move
    // commits pushed a new generator config into the app on every mouse
    // movement, invalidating and refetching the entire cached preview strip
    // mid-drag (the Evolve "constant twitching" bug).
    expect(onPropertyCurvesChange).toHaveBeenCalledTimes(1);
    const drawn = onPropertyCurvesChange.mock.calls.at(-1)?.[0] as Array<{
      property: string;
      points: Array<{ cycle: number }>;
    }>;
    const density = drawn.find((curve) => curve.property === "density");
    // One drag laid a connected line of points across every crossed cycle.
    expect(density?.points.map((point) => point.cycle)).toEqual([2, 3, 4]);
  });

  it("deletes a point by clicking its handle", () => {
    const onPropertyCurvesChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={16}
        totalBeats={4}
        propertyCurves={[
          {
            property: "density",
            enabled: true,
            toleranceMilli: 5_000,
            weight: 50,
            points: [
              { cycle: 3, targetMilli: 40_000 },
              { cycle: 8, targetMilli: 70_000 },
            ],
          },
        ]}
        onPropertyCurvesChange={onPropertyCurvesChange}
        onPlanChange={vi.fn()}
      />
    );
    // Each authored point is a labelled handle; a plain click (no drag) removes
    // just that point and leaves the rest of the line.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Move or remove density point at cycle 3",
      })
    );
    const next = onPropertyCurvesChange.mock.calls.at(-1)?.[0] as Array<{
      property: string;
      points: Array<{ cycle: number }>;
    }>;
    expect(next[0]?.points.map((point) => point.cycle)).toEqual([8]);
  });

  it("authors, adjusts, moves, and deletes property points from the keyboard", () => {
    const onPropertyCurvesChange = vi.fn();
    const { rerender } = render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={16}
        totalBeats={4}
        propertyCurves={[]}
        onPropertyCurvesChange={onPropertyCurvesChange}
        onPlanChange={vi.fn()}
      />
    );
    fireEvent.keyDown(
      screen.getByRole("group", { name: "Cycle 3 syncopation not cached" }),
      { key: "Enter" }
    );
    expect(onPropertyCurvesChange.mock.calls.at(-1)?.[0]).toMatchObject([
      {
        property: "syncopation",
        points: [{ cycle: 3, targetMilli: 50_000 }],
      },
    ]);

    const authored = onPropertyCurvesChange.mock.calls.at(-1)?.[0];
    rerender(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={16}
        totalBeats={4}
        propertyCurves={authored}
        onPropertyCurvesChange={onPropertyCurvesChange}
        onPlanChange={vi.fn()}
      />
    );
    const handle = screen.getByRole("button", {
      name: "Move or remove syncopation point at cycle 3",
    });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(
      onPropertyCurvesChange.mock.calls.at(-1)?.[0][0].points[0]
    ).toEqual({ cycle: 3, targetMilli: 51_000 });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(
      onPropertyCurvesChange.mock.calls.at(-1)?.[0][0].points[0]
    ).toEqual({ cycle: 4, targetMilli: 50_000 });
    fireEvent.keyDown(handle, { key: "Delete" });
    expect(onPropertyCurvesChange.mock.calls.at(-1)?.[0]).toEqual([]);
  });

  it("exposes settings for disabled imported property curves", () => {
    const onPropertyCurvesChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={16}
        totalBeats={4}
        propertyCurves={[
          {
            property: "density",
            enabled: false,
            toleranceMilli: 12_000,
            weight: 80,
            points: [{ cycle: 3, targetMilli: 40_000 }],
          },
        ]}
        onPropertyCurvesChange={onPropertyCurvesChange}
        onPlanChange={vi.fn()}
      />
    );
    expect(
      (screen.getByLabelText("Density curve tolerance") as HTMLInputElement)
        .value
    ).toBe("12");
    expect(
      (screen.getByLabelText("Density curve weight") as HTMLInputElement).value
    ).toBe("80");
    fireEvent.click(screen.getByLabelText("Density curve enabled"));
    expect(onPropertyCurvesChange.mock.calls.at(-1)?.[0][0].enabled).toBe(true);
  });

  it("marks drawn bands as directive-overridden only for a valid active scope", () => {
    const propertyCurves = [
      {
        property: "density" as const,
        enabled: true,
        toleranceMilli: 1_000,
        weight: 50,
        points: [{ cycle: 5, targetMilli: 90_000 }],
      },
    ];
    const cachedPreviews = [
      {
        cycle: 5,
        preview: {
          spans: [],
          densityCorridor: { floor: 0, ceiling: 100 },
          cycleDistance: null,
          workingSubdivision: 4,
          stateComplexityMilli: null,
          stateDepthDiversityMilli: null,
          complexityCorridor: null,
          propertyProfile: {
            densityMilli: 20_000,
            complexityMilli: 0,
            syncopationMilli: 0,
            evennessMilli: 0,
            occupancyMilli: 0,
            diversityMilli: 0,
          },
          curveMisses: [
            {
              property: "density" as const,
              gapMilli: 69_000,
              reason: "noReducingCandidate" as const,
            },
          ],
        },
      },
    ];
    const { rerender } = render(
      <EvolvePlanEditor
        plan={[directive({ fromCycle: 5, toCycle: 5, scope: null })]}
        planLengthCycles={8}
        totalBeats={4}
        propertyCurves={propertyCurves}
        cachedPreviews={cachedPreviews}
        onPlanChange={vi.fn()}
      />
    );
    const overridden = screen.getByRole("group", {
      name: /Cycle 5 density 20\.0, target band overridden by directive/,
    });
    expect(overridden.classList.contains("is-overridden")).toBe(true);
    expect(overridden.querySelector(".is-miss")).toBeNull();

    rerender(
      <EvolvePlanEditor
        plan={[
          directive({
            fromCycle: 5,
            toCycle: 5,
            scope: { startBeat: 4, lenBeats: 1 },
          }),
        ]}
        planLengthCycles={8}
        totalBeats={4}
        propertyCurves={propertyCurves}
        cachedPreviews={cachedPreviews}
        onPlanChange={vi.fn()}
      />
    );
    const miss = screen.getByRole("group", {
      name: /Cycle 5 density 20\.0, target 90\.0 band/,
    });
    expect(miss.classList.contains("is-overridden")).toBe(false);
    expect(miss.querySelector(".is-miss")).not.toBeNull();
  });

  it("intersects the drawn band with the corridor rail and flags an empty intersection (UC-40)", () => {
    const propertyCurves = [
      {
        property: "density" as const,
        enabled: true,
        toleranceMilli: 1_000,
        weight: 50,
        points: [{ cycle: 5, targetMilli: 90_000 }],
      },
    ];
    const previewAt = (corridor: { floor: number; ceiling: number }) => [
      {
        cycle: 5,
        preview: {
          spans: [],
          densityCorridor: corridor,
          cycleDistance: null,
          workingSubdivision: 4,
          stateComplexityMilli: null,
          stateDepthDiversityMilli: null,
          complexityCorridor: null,
          propertyProfile: {
            densityMilli: 88_000,
            complexityMilli: 0,
            syncopationMilli: 0,
            evennessMilli: 0,
            occupancyMilli: 0,
            diversityMilli: 0,
          },
          curveMisses: [],
        },
      },
    ];
    // Rail 0–89%: the drawn 89–91% band intersects it only at 89–89%. The
    // realized 88.0 sits inside the drawn band but OUTSIDE the intersection,
    // and the verdict follows the engine's intersected band.
    const { rerender } = render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={8}
        totalBeats={4}
        propertyCurves={propertyCurves}
        cachedPreviews={previewAt({ floor: 0, ceiling: 89 })}
        onPlanChange={vi.fn()}
      />
    );
    const clipped = screen.getByRole("group", {
      name: /Cycle 5 density 88\.0, target 90\.0 band 89\.0 through 91\.0, outside band/,
    });
    expect(clipped.querySelector(".evolve-plan-property-band.is-conflict")).toBeNull();
    expect(clipped.querySelector(".evolve-plan-property-band")).not.toBeNull();

    // Rail 0–55%: no overlap with the drawn 89–91% band at all — the cell
    // renders a conflict marker instead of a fabricated positive band.
    rerender(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={8}
        totalBeats={4}
        propertyCurves={propertyCurves}
        cachedPreviews={previewAt({ floor: 0, ceiling: 55 })}
        onPlanChange={vi.fn()}
      />
    );
    const conflicted = screen.getByRole("group", {
      name: /Cycle 5 density 88\.0, target 90\.0 band 89\.0 through 91\.0, outside band/,
    });
    expect(
      conflicted.querySelector(".evolve-plan-property-band.is-conflict")
    ).not.toBeNull();
  });

  it("keeps DOM focus order aligned with the visible calibration-first layout", () => {
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={8}
        totalBeats={4}
        onPlanChange={vi.fn()}
      />
    );
    const timeline = screen.getByLabelText("Evolution score timeline");
    const pacing = screen.getByLabelText("Pacing lane");
    const density = screen.getByLabelText("Density lane");
    const events = screen.getByLabelText("Events");
    const remove = screen.getByLabelText("Remove lane");
    const children = [...timeline.children];
    expect(children.indexOf(pacing)).toBeLessThan(children.indexOf(density));
    expect(children.indexOf(density)).toBeLessThan(children.indexOf(events));
    expect(children.indexOf(events)).toBeLessThan(children.indexOf(remove));
  });

  it("moves a point by dragging its handle instead of deleting it", () => {
    const onPropertyCurvesChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={16}
        totalBeats={4}
        propertyCurves={[
          {
            property: "density",
            enabled: true,
            toleranceMilli: 5_000,
            weight: 50,
            points: [
              { cycle: 3, targetMilli: 40_000 },
              { cycle: 8, targetMilli: 70_000 },
            ],
          },
        ]}
        onPropertyCurvesChange={onPropertyCurvesChange}
        onPlanChange={vi.fn()}
      />
    );
    const handle = screen.getByRole("button", {
      name: "Move or remove density point at cycle 3",
    });
    // A press-and-drag past the click threshold repositions the point; a
    // release after moving must NOT be read as a delete. The X stays inside
    // cycle 3's column (LANE_LABEL_WIDTH 112 + cellWidth 54).
    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 5,
      clientX: 112 + 3.5 * 54,
      clientY: 100,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 5,
      clientX: 112 + 3.5 * 54,
      clientY: 132,
    });
    fireEvent.pointerUp(handle, { pointerId: 5 });
    const next = onPropertyCurvesChange.mock.calls.at(-1)?.[0] as Array<{
      property: string;
      points: Array<{ cycle: number }>;
    }>;
    // Both points survive — the dragged one moved, it was not removed.
    expect(next[0]?.points.map((point) => point.cycle)).toEqual([3, 8]);
  });

  it("moves a point's cycle when its handle is dragged horizontally", () => {
    const onPropertyCurvesChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={16}
        totalBeats={4}
        propertyCurves={[
          {
            property: "density",
            enabled: true,
            toleranceMilli: 5_000,
            weight: 50,
            points: [
              { cycle: 3, targetMilli: 40_000 },
              { cycle: 8, targetMilli: 70_000 },
            ],
          },
        ]}
        onPropertyCurvesChange={onPropertyCurvesChange}
        onPlanChange={vi.fn()}
      />
    );
    const handle = screen.getByRole("button", {
      name: "Move or remove density point at cycle 3",
    });
    // Grab the cycle-3 point and drag right into cycle 5's column. The point
    // must follow the pointer — removed at 3, upserted at 5 — matching the
    // Left/Right arrow behavior (UC-37). Moving the drafted point re-renders
    // its handle into cycle 5's cell, so the drag listens on the window; the
    // move and release are dispatched there, as a real pointer would.
    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 6,
      clientX: 112 + 3.5 * 54,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 6,
      clientX: 112 + 5.5 * 54,
      clientY: 100,
    });
    fireEvent.pointerUp(window, { pointerId: 6 });
    // Exactly one commit: the drag previewed locally and committed on release.
    expect(onPropertyCurvesChange).toHaveBeenCalledTimes(1);
    const next = onPropertyCurvesChange.mock.calls.at(-1)?.[0] as Array<{
      property: string;
      points: Array<{ cycle: number }>;
    }>;
    // The grabbed point now lives at cycle 5; the other point is untouched.
    expect(next[0]?.points.map((point) => point.cycle)).toEqual([5, 8]);
  });

  it("plots the step-size lane with target bands and tolerance verdicts", () => {
    const preview = (distanceMilli: number) => ({
      densityCorridor: null,
      cycleDistance: { modelVersion: "v1" as const, distanceMilli },
      spans: [
        {
          spanId: 1,
          spanLen: 4,
          cells: [
            {
              index: 0,
              start: 0,
              len: 4,
              rest: false,
              tiedFromPrevious: false,
              tiedToNext: false,
            },
          ],
        },
      ],
    });
    render(
      <EvolvePlanEditor
        plan={[
          directive({
            family: "barlowRemove",
            fromCycle: 13,
            toCycle: 13,
            magnitude: {
              mode: "perceptual",
              modelVersion: "v1",
              targetMilli: 5000,
              toleranceMilli: 1500,
              maxOperations: 16,
            },
          }),
        ]}
        planLengthCycles={16}
        totalBeats={4}
        cachedPreviews={[
          { cycle: 12, preview: preview(0) },
          { cycle: 13, preview: preview(6200) },
          { cycle: 14, preview: preview(9000) },
        ]}
        onPlanChange={vi.fn()}
      />
    );

    // Realized inside target ± tolerance reads as within. The cycle is owned
    // by an enabled directive, and the cell says so (UC-39).
    const within = screen.getByRole("group", {
      name: "Cycle 13 step size 6.2, target 5.0 ±1.5, within tolerance, overridden by directive",
    });
    expect(within.classList.contains("is-within-target")).toBe(true);
    expect(within.classList.contains("is-directive-owned")).toBe(true);
    // No perceptual row at cycle 14: a plain realized readout, no verdict,
    // and no directive-owned state.
    const plain = screen.getByRole("group", {
      name: "Cycle 14 step size 9.0",
    });
    expect(plain.classList.contains("is-within-target")).toBe(false);
    expect(plain.classList.contains("is-outside-target")).toBe(false);
    expect(plain.classList.contains("is-directive-owned")).toBe(false);
    // The verbatim cycle before the pin reads an honest zero.
    expect(
      screen.getByRole("group", { name: "Cycle 12 step size 0.0" })
    ).toBeTruthy();
    // Cycles without a cached preview say so.
    expect(
      screen.getByRole("group", { name: "Cycle 3 step size not cached" })
    ).toBeTruthy();
  });

  it("marks a realized step outside its target band", () => {
    render(
      <EvolvePlanEditor
        plan={[
          directive({
            family: "barlowRemove",
            fromCycle: 7,
            toCycle: 7,
            magnitude: {
              mode: "perceptual",
              modelVersion: "v1",
              targetMilli: 5000,
              toleranceMilli: 500,
              maxOperations: 16,
            },
          }),
        ]}
        planLengthCycles={8}
        totalBeats={4}
        cachedPreviews={[
          {
            cycle: 7,
            preview: {
              densityCorridor: null,
              cycleDistance: { modelVersion: "v1" as const, distanceMilli: 800 },
              spans: [],
            },
          },
        ]}
        onPlanChange={vi.fn()}
      />
    );
    const outside = screen.getByRole("group", {
      name: "Cycle 7 step size 0.8, target 5.0 ±0.5, outside tolerance, overridden by directive",
    });
    expect(outside.classList.contains("is-outside-target")).toBe(true);
  });

  it("plots backend complexity inside its rail and labels an independent clamp", () => {
    render(
      <EvolvePlanEditor
        plan={[directive({ family: "barlowAdd", fromCycle: 5, toCycle: 5 })]}
        planLengthCycles={8}
        totalBeats={4}
        previewCycle={5}
        trace={[
          {
            cycle: 5,
            directiveId: 1,
            family: "barlowAdd",
            requested: 2,
            applied: 1,
            skipped: "exhausted",
            complexityCorridorClamp: {
              limit: "ceiling",
              complexityMilli: 42_000,
            },
          },
        ]}
        cachedPreviews={[
          {
            cycle: 5,
            preview: {
              spans: [],
              densityCorridor: null,
              cycleDistance: null,
              workingSubdivision: 12,
              stateComplexityMilli: 37_500,
              stateDepthDiversityMilli: 75_000,
              complexityCorridor: { floor: 20_000, ceiling: 42_000 },
            },
          },
        ]}
        onPlanChange={vi.fn()}
      />
    );
    const cell = screen.getByRole("group", {
      name: "Cycle 5 complexity 37.5, corridor 20.0 through 42.0, inside corridor",
    });
    expect(cell.classList.contains("is-within-corridor")).toBe(true);
    expect(
      screen.getByLabelText("Cycle 5 depth diversity 75.0")
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Add: 1/2, ceiling complexity corridor 42.0, exhausted"
      )
    ).toBeTruthy();
  });

  it("authors and validates a Morph target without bypassing transition pacing", () => {
    const onPlanChange = vi.fn();
    const row = directive({
      family: "morph",
      fromCycle: 5,
      toCycle: 20,
      pacing: "easeInOut",
      options: {
        ...DEFAULT_DIRECTIVE_OPTIONS,
        morphTarget: "x x x x",
      },
    });
    const view = render(
      <EvolvePlanEditor
        plan={[row]}
        planLengthCycles={24}
        totalBeats={4}
        workingSubdivision={6}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
      />
    );
    expect(
      (screen.getByLabelText("Directive transition") as HTMLSelectElement)
        .value
    ).toBe("easeInOut");
    expect(
      screen.getByText("4 beats · Subdivision 1 · exact on working 6")
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Morph target blocks for directive 1")
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Morph target pattern"), {
      target: { value: "[x x x x x] x x x" },
    });
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        family: "morph",
        pacing: "easeInOut",
        options: expect.objectContaining({ morphTarget: "[x x x x x] x x x" }),
      }),
    ]);
    view.rerender(
      <EvolvePlanEditor
        plan={[
          {
            ...row,
            options: {
              ...row.options,
              morphTarget: "[x x x x x] x x x",
            },
          },
        ]}
        planLengthCycles={24}
        totalBeats={4}
        workingSubdivision={6}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
      />
    );
    expect(
      screen.getByText(
        "dumka plan invalid: directive 1 morph target needs Subdivision 5 which does not divide working Subdivision 6"
      )
    ).toBeTruthy();
  });

  it("offers the enabled palette primes as subdivision-level filters", () => {
    const onPlanChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[directive()]}
        planLengthCycles={12}
        totalBeats={4}
        workingSubdivision={12}
        subdivisionPalette={[2, 3]}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
      />
    );

    const select = screen.getByLabelText(
      "Subdivision level"
    ) as HTMLSelectElement;
    expect(
      Array.from(select.options).map((option) => option.textContent)
    ).toEqual([
      "Any level",
      "Prime 2 · 1/2-family positions",
      "Prime 3 · 1/3-family positions",
    ]);

    fireEvent.change(select, { target: { value: "3" } });
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        options: expect.objectContaining({ subdivisionLevel: 3 }),
      }),
    ]);
  });

  it("validates Morph beats against the seed while score structure is stale", () => {
    render(
      <EvolvePlanEditor
        plan={[
          directive({
            family: "morph",
            options: {
              ...DEFAULT_DIRECTIVE_OPTIONS,
              morphTarget: "x x",
            },
          }),
        ]}
        planLengthCycles={8}
        totalBeats={4}
        seedTotalBeats={2}
        workingSubdivision={1}
        initialSelectedId={1}
        onPlanChange={vi.fn()}
      />
    );
    expect(
      screen.getByText("2 beats · Subdivision 1 · exact on working 1")
    ).toBeTruthy();
  });

  it("toggles before and after audition around the selected directive", () => {
    const onPreviewCycleChange = vi.fn();
    const onAuditionCycle = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[directive({ fromCycle: 13, toCycle: 13 })]}
        planLengthCycles={16}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={vi.fn()}
        onPreviewCycleChange={onPreviewCycleChange}
        onAuditionCycle={onAuditionCycle}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Before preview" }));
    expect(onPreviewCycleChange).toHaveBeenLastCalledWith(12);
    expect(onAuditionCycle).toHaveBeenLastCalledWith(12, "before");
    fireEvent.click(screen.getByRole("button", { name: "After preview" }));
    expect(onPreviewCycleChange).toHaveBeenLastCalledWith(13);
    expect(onAuditionCycle).toHaveBeenLastCalledWith(13, "after");
  });

  it("smooths a pin across four cycles and exposes compact range transitions", () => {
    const onPlanChange = vi.fn();
    const view = render(
      <EvolvePlanEditor
        plan={[directive({ fromCycle: 5, toCycle: 5 })]}
        planLengthCycles={12}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
      />
    );

    expect(screen.queryByLabelText("Directive transition")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Smooth across 4 cycles" }));
    expect(onPlanChange).toHaveBeenCalledWith([
      expect.objectContaining({
        fromCycle: 5,
        toCycle: 8,
        pacing: "easeInOut",
      }),
    ]);

    view.rerender(
      <EvolvePlanEditor
        plan={[directive({ toCycle: 8, pacing: "easeInOut" })]}
        planLengthCycles={12}
        totalBeats={4}
        trace={[
          {
            cycle: 5,
            directiveId: 1,
            family: "syncopate",
            requested: 0,
            applied: 0,
            skipped: "none",
          },
        ]}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
      />
    );
    const transition = screen.getByLabelText("Directive transition");
    expect(document.activeElement).toBe(transition);
    expect((transition as HTMLSelectElement).value).toBe("easeInOut");
    expect(
      screen.getByRole("button", {
        name: "Syncopate, cycles 5 through 8, 32%, gentle transition",
      })
    ).toBeTruthy();
    expect(
      screen.getByText("One 32% target, with smaller steps near the start and finish.")
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Syncopate: 0/0 this cycle · Gentle transition · step 1 of 4"
      )
    ).toBeTruthy();
    fireEvent.change(transition, { target: { value: "linear" } });
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ pacing: "linear" }),
    ]);
  });

  it("authors a perceptual step target and reports the backend directive result", () => {
    const onPlanChange = vi.fn();
    const view = render(
      <EvolvePlanEditor
        plan={[directive({ pacing: "linear" })]}
        planLengthCycles={12}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
      />
    );

    const mode = screen.getByLabelText("Step size mode") as HTMLSelectElement;
    expect(mode.value).toBe("operationQuota");
    expect(screen.getByLabelText("Directive intensity")).toBeTruthy();
    fireEvent.change(mode, { target: { value: "perceptual" } });
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        intensity: 32,
        pacing: "perCycle",
        magnitude: DEFAULT_PERCEPTUAL_MAGNITUDE,
      }),
    ]);

    view.rerender(
      <EvolvePlanEditor
        plan={[
          directive({
            pacing: "perCycle",
            magnitude: { ...DEFAULT_PERCEPTUAL_MAGNITUDE },
          }),
        ]}
        planLengthCycles={12}
        totalBeats={4}
        previewCycle={5}
        initialSelectedId={1}
        trace={[
          {
            cycle: 5,
            directiveId: 1,
            family: "syncopate",
            requested: 4,
            applied: 3,
            skipped: "none",
            perceptual: {
              modelVersion: "v1",
              actualMilli: 4_800,
              targetMilli: 5_000,
              toleranceMilli: 500,
              reached: true,
              exhausted: false,
            },
          },
        ]}
        onPlanChange={onPlanChange}
      />
    );

    expect(screen.queryByLabelText("Directive intensity")).toBeNull();
    expect(screen.queryByLabelText("Directive transition")).toBeNull();
    expect(
      screen.getByText(/Calibrates this directive's incremental rhythm change/)
    ).toBeTruthy();
    expect(
      screen.getByText(/final whole-cycle distance can be larger/)
    ).toBeTruthy();
    expect(
      screen.getByRole("status", {
        name: /Cycle 5 directive change: realized 4\.8, target 5\.0 plus or minus 0\.5, within tolerance/,
      })
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Syncopate: 3/4, realized 4.8 vs target 5.0 ±0.5, within tolerance"
      )
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Target magnitude"), {
      target: { value: "7.2" },
    });
    fireEvent.blur(screen.getByLabelText("Target magnitude"));
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        magnitude: expect.objectContaining({ targetMilli: 7_200 }),
      }),
    ]);

    fireEvent.change(screen.getByLabelText("Step size mode"), {
      target: { value: "operationQuota" },
    });
    const lastPlan = onPlanChange.mock.calls.at(-1)?.[0] as EvolutionDirective[];
    expect(lastPlan[0]).not.toHaveProperty("magnitude");
    expect(lastPlan[0]!.intensity).toBe(32);
  });

  it("shows lifetime scoring work and rejects an edit beyond the engine budget", () => {
    const onPlanChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[
          directive({
            fromCycle: 1,
            toCycle: 16,
            pacing: "perCycle",
            magnitude: { ...DEFAULT_PERCEPTUAL_MAGNITUDE },
          }),
        ]}
        planLengthCycles={16}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
      />
    );

    expect(
      screen.getByLabelText(
        "272 of 4,096 lifetime scores used; 3,824 remaining"
      )
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Maximum operations"), {
      target: { value: "256" },
    });
    fireEvent.blur(screen.getByLabelText("Maximum operations"));

    expect(onPlanChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "dumka perceptual plan reserves 4112 scoring operations, exceeding the limit of 4096"
    );
  });

  it("reports the selected directive trace for the displayed cycle", () => {
    const plan = [
      directive({
        pacing: "perCycle",
        magnitude: { ...DEFAULT_PERCEPTUAL_MAGNITUDE },
      }),
    ];
    const trace: DirectiveTraceEntry[] = [
      {
        cycle: 5,
        directiveId: 1,
        family: "syncopate",
        requested: 4,
        applied: 3,
        skipped: "none",
        perceptual: {
          modelVersion: "v1",
          actualMilli: 4_800,
          targetMilli: 5_000,
          toleranceMilli: 500,
          reached: true,
          exhausted: false,
        },
      },
      {
        cycle: 9,
        directiveId: 1,
        family: "syncopate",
        requested: 8,
        applied: 7,
        skipped: "none",
        perceptual: {
          modelVersion: "v1",
          actualMilli: 12_300,
          targetMilli: 5_000,
          toleranceMilli: 500,
          reached: false,
          exhausted: true,
        },
      },
    ];
    const view = render(
      <EvolvePlanEditor
        plan={plan}
        planLengthCycles={12}
        totalBeats={4}
        previewCycle={5}
        initialSelectedId={1}
        trace={trace}
        onPlanChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole("status", {
        name: /Cycle 5 directive change: realized 4\.8/,
      })
    ).toBeTruthy();
    expect(screen.queryByText("12.3")).toBeNull();

    view.rerender(
      <EvolvePlanEditor
        plan={plan}
        planLengthCycles={12}
        totalBeats={4}
        previewCycle={9}
        initialSelectedId={1}
        trace={trace}
        onPlanChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole("status", {
        name: /Cycle 9 directive change: realized 12\.3/,
      })
    ).toBeTruthy();
    expect(screen.queryByText("4.8")).toBeNull();
  });

  it("keeps Stochastic ranges on their per-cycle probability semantics", () => {
    const view = render(
      <EvolvePlanEditor
        plan={[
          directive({
            family: "stochastic",
            fromCycle: 5,
            toCycle: 5,
            pacing: "perCycle",
          }),
        ]}
        planLengthCycles={12}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={vi.fn()}
      />
    );
    expect((screen.getByLabelText("Step size mode") as HTMLSelectElement).value).toBe(
      "operationQuota"
    );
    expect((screen.getByLabelText("Step size mode") as HTMLSelectElement).disabled).toBe(
      true
    );
    expect(screen.getByText("Stochastic directives use operation quota.")).toBeTruthy();
    expect(screen.queryByLabelText("Directive transition")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Smooth across 4 cycles" })
    ).toBeNull();
    view.rerender(
      <EvolvePlanEditor
        plan={[
          directive({
            family: "stochastic",
            fromCycle: 5,
            toCycle: 9,
            pacing: "perCycle",
          }),
        ]}
        planLengthCycles={12}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("Directive transition")).toBeNull();
  });

  it("supports arrow movement, shift-arrow resize, and Delete", () => {
    const onPlanChange = vi.fn();
    const view = render(
      <EvolvePlanEditor
        plan={[directive()]}
        planLengthCycles={12}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
      />
    );
    const editor = screen.getByLabelText("Evolution score");

    fireEvent.keyDown(editor, { key: "ArrowRight" });
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ fromCycle: 6, toCycle: 10 }),
    ]);

    view.rerender(
      <EvolvePlanEditor
        plan={[directive()]}
        planLengthCycles={12}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
      />
    );
    fireEvent.keyDown(editor, { key: "ArrowRight", shiftKey: true });
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ fromCycle: 5, toCycle: 10 }),
    ]);
    fireEvent.keyDown(editor, { key: "Delete" });
    expect(onPlanChange).toHaveBeenLastCalledWith([]);
  });

  it("renders structural-slot density and one accessible tick per mixed trace entry", () => {
    const trace: DirectiveTraceEntry[] = [
      {
        cycle: 5,
        directiveId: 1,
        family: "syncopate",
        requested: 2,
        applied: 1,
        skipped: "projection",
      },
      {
        cycle: 5,
        directiveId: 2,
        family: "fragment",
        requested: 1,
        applied: 0,
        skipped: "projection",
      },
      {
        cycle: 5,
        directiveId: 0,
        family: "stochastic",
        requested: 0,
        applied: 0,
        skipped: "none",
        corridorClamp: { limit: "floor", densityPercent: 40 },
      },
    ];
    render(
      <EvolvePlanEditor
        plan={[directive()]}
        planLengthCycles={8}
        totalBeats={4}
        trace={trace}
        cachedPreviews={[
          {
            cycle: 5,
            preview: {
              spans: [
                {
                  spanId: 0,
                  spanLen: 4,
                  cells: [
                    { index: 0, start: 0, len: 1, rest: false, tiedFromPrevious: false, tiedToNext: false },
                    { index: 1, start: 1, len: 1, rest: true, tiedFromPrevious: false, tiedToNext: false },
                  ],
                },
              ],
            },
          },
          {
            cycle: 6,
            preview: {
              spans: [
                {
                  spanId: 0,
                  spanLen: 4,
                  cells: Array.from({ length: 4 }, (_, index) => ({
                    index,
                    start: index,
                    len: 1,
                    rest: false,
                    tiedFromPrevious: false,
                    tiedToNext: false,
                  })),
                },
              ],
            },
          },
        ]}
        onPlanChange={vi.fn()}
      />
    );

    const partial = screen.getByLabelText("Syncopate: 1/2, projection");
    expect(partial.className).toContain("is-applied");
    expect(partial.className).toContain("is-partial");
    expect(
      screen.getByLabelText("Fragment: 0/1, projection").className
    ).toContain("is-skipped");
    expect(
      screen.getByLabelText("Stochastic: 0/0, floor corridor 40%")
    ).toBeTruthy();
    const densityCell = screen.getByRole("group", {
      name: /Cycle 5 density 25%, 1 onset/,
    });
    expect(
      (densityCell.querySelector(".evolve-plan-property-mark") as HTMLElement)
        .style.bottom
    ).toBe("25%");
    const fullDensityCell = screen.getByRole("group", {
      name: /Cycle 6 density 100%, 4 onsets/,
    });
    expect(
      (fullDensityCell.querySelector(
        ".evolve-plan-property-mark"
      ) as HTMLElement).style.bottom
    ).toBe("100%");
    expect(document.querySelectorAll(".evolve-plan-trace")).toHaveLength(3);
  });

  it("caps and virtualizes extreme extents without dropping authored directives", () => {
    const onVisibleCycleRangeChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[
          directive({
            fromCycle: MAX_STOPPED_PREVIEW_CYCLE + 20,
            toCycle: MAX_STOPPED_PREVIEW_CYCLE + 30,
          }),
        ]}
        planLengthCycles={Number.MAX_SAFE_INTEGER}
        totalBeats={4}
        onPlanChange={vi.fn()}
        onVisibleCycleRangeChange={onVisibleCycleRangeChange}
      />
    );

    expect((screen.getByLabelText("Plan view cycles") as HTMLInputElement).value).toBe(
      String(MAX_STOPPED_PREVIEW_CYCLE)
    );
    expect(screen.getByRole("note").textContent).toContain("1 directive");
    expect(screen.getByRole("note").textContent).toContain("10,000");
    expect(
      document.querySelectorAll(".evolve-plan-ruler > span").length
    ).toBeLessThan(100);
    expect(
      screen.queryByRole("button", {
        name: `Syncopate, cycles ${MAX_STOPPED_PREVIEW_CYCLE + 20} through ${MAX_STOPPED_PREVIEW_CYCLE + 30}, 32%`,
      })
    ).toBeNull();
    expect(onVisibleCycleRangeChange).toHaveBeenCalledWith(0, expect.any(Number));
  });

  it("pans horizontally and anchor-zooms while reporting the visible cycle range", () => {
    const onVisibleCycleRangeChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[]}
        planLengthCycles={120}
        totalBeats={4}
        onPlanChange={vi.fn()}
        onVisibleCycleRangeChange={onVisibleCycleRangeChange}
      />
    );

    const scroller = screen.getByLabelText("Evolution score timeline") as HTMLDivElement;
    Object.defineProperty(scroller, "clientWidth", {
      configurable: true,
      value: 600,
    });
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 600,
      height: 420,
      top: 0,
      right: 600,
      bottom: 420,
      left: 0,
      toJSON: () => ({}),
    });
    scroller.scrollLeft = 500;

    fireEvent.wheel(scroller, {
      ctrlKey: true,
      clientX: 250,
      deltaY: -120,
    });
    expect(
      Number.parseInt(scroller.style.getPropertyValue("--evolve-cycle-width"), 10)
    ).toBeGreaterThan(54);
    expect(scroller.scrollLeft).toBeGreaterThan(500);

    const afterZoom = scroller.scrollLeft;
    fireEvent.wheel(scroller, { deltaY: 80 });
    expect(scroller.scrollLeft).toBe(afterZoom + 80);

    const ruler = screen.getByLabelText("Cycle ruler; drag to pan");
    const beforeDrag = scroller.scrollLeft;
    fireEvent.pointerDown(ruler, {
      button: 0,
      pointerId: 8,
      clientX: 240,
    });
    fireEvent.pointerMove(ruler, { pointerId: 8, clientX: 190 });
    fireEvent.pointerUp(ruler, { pointerId: 8, clientX: 190 });
    expect(scroller.scrollLeft).toBe(beforeDrag + 50);
    expect(onVisibleCycleRangeChange).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number)
    );
    expect(
      document.querySelectorAll(".evolve-plan-ruler > span").length
    ).toBeLessThan(100);
  });

  it("previews cycle 0 for Before on a cycle-1 directive", () => {
    const onPreviewCycleChange = vi.fn();
    const onAuditionCycle = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[directive({ fromCycle: 1, toCycle: 1 })]}
        planLengthCycles={8}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={vi.fn()}
        onPreviewCycleChange={onPreviewCycleChange}
        onAuditionCycle={onAuditionCycle}
      />
    );

    const before = screen.getByRole("button", { name: "Before preview" });
    expect((before as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(before);
    expect(onPreviewCycleChange).toHaveBeenLastCalledWith(0);
    expect(onAuditionCycle).toHaveBeenLastCalledWith(0, "before");
  });

  it("does not preview twice for a pointer selection and rescrubs after a move", () => {
    const onPlanChange = vi.fn();
    const onPreviewCycleChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[directive()]}
        planLengthCycles={16}
        totalBeats={4}
        onPlanChange={onPlanChange}
        onPreviewCycleChange={onPreviewCycleChange}
      />
    );
    const mark = screen.getByRole("button", {
      name: "Syncopate, cycles 5 through 9, 32%, repeat each cycle",
    });

    fireEvent.pointerDown(mark, { pointerId: 2, clientX: 100 });
    fireEvent.pointerUp(mark, { pointerId: 2, clientX: 154 });
    fireEvent.click(mark, { detail: 1 });

    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ fromCycle: 6, toCycle: 10 }),
    ]);
    expect(onPreviewCycleChange.mock.calls).toEqual([[5], [6]]);
  });

  it("exposes pin edge handles, resizes by pointer, and supports Alt-drag duplication", () => {
    const onPlanChange = vi.fn();
    const onPreviewCycleChange = vi.fn();
    const view = render(
      <EvolvePlanEditor
        plan={[directive({ fromCycle: 5, toCycle: 5 })]}
        planLengthCycles={16}
        totalBeats={4}
        onPlanChange={onPlanChange}
        onPreviewCycleChange={onPreviewCycleChange}
      />
    );
    let mark = screen.getByRole("button", {
      name: "Syncopate, cycle 5, 32%",
    });
    expect(mark.querySelectorAll(".evolve-plan-resize")).toHaveLength(2);
    const endHandle = mark.querySelector(".evolve-plan-resize.is-end")!;
    fireEvent.pointerDown(endHandle, { pointerId: 3, clientX: 100 });
    fireEvent.pointerUp(endHandle, { pointerId: 3, clientX: 154 });
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ fromCycle: 5, toCycle: 6 }),
    ]);
    expect(onPreviewCycleChange).toHaveBeenLastCalledWith(5);

    view.rerender(
      <EvolvePlanEditor
        plan={[directive({ fromCycle: 5, toCycle: 5 })]}
        planLengthCycles={16}
        totalBeats={4}
        onPlanChange={onPlanChange}
        onPreviewCycleChange={onPreviewCycleChange}
      />
    );
    mark = screen.getByRole("button", { name: "Syncopate, cycle 5, 32%" });
    fireEvent.pointerDown(mark, {
      altKey: true,
      pointerId: 4,
      clientX: 100,
    });
    fireEvent.pointerUp(mark, { pointerId: 4, clientX: 154 });
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ fromCycle: 5, toCycle: 5 }),
      expect.objectContaining({ fromCycle: 6, toCycle: 6 }),
    ]);
    expect(onPreviewCycleChange).toHaveBeenLastCalledWith(6);
  });

  it("duplicates the selected directive from the keyboard-accessible inspector action", () => {
    const onPlanChange = vi.fn();
    const onPreviewCycleChange = vi.fn();
    render(
      <EvolvePlanEditor
        plan={[directive()]}
        planLengthCycles={20}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={onPlanChange}
        onPreviewCycleChange={onPreviewCycleChange}
      />
    );

    const duplicate = screen.getByRole("button", { name: "Duplicate" });
    duplicate.focus();
    fireEvent.keyDown(duplicate, { key: "Enter" });
    fireEvent.click(duplicate, { detail: 0 });
    expect(onPlanChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ fromCycle: 5, toCycle: 9 }),
      expect.objectContaining({ fromCycle: 10, toCycle: 14 }),
    ]);
    expect(onPreviewCycleChange).toHaveBeenLastCalledWith(10);
  });

  it("keeps directives hollow and controls locked when disabled", () => {
    render(
      <EvolvePlanEditor
        plan={[directive({ enabled: false })]}
        planLengthCycles={12}
        totalBeats={4}
        disabled
        initialSelectedId={1}
        onPlanChange={vi.fn()}
      />
    );
    const mark = screen.getByRole("button", {
      name: "Syncopate, cycles 5 through 9, 32%, repeat each cycle",
    });
    expect(mark.className).toContain("is-disabled");
    expect((mark as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Directive intensity") as HTMLInputElement).disabled).toBe(true);
  });

  it("disables creation while preserving edits at the 256-directive limit", () => {
    const plan = Array.from(
      { length: MAX_EVOLUTION_DIRECTIVES },
      (_, index) =>
        directive({
          id: index + 1,
          order: index,
          family: "fragment",
          fromCycle: index + 1,
          toCycle: index + 1,
        })
    );
    render(
      <EvolvePlanEditor
        plan={plan}
        planLengthCycles={MAX_EVOLUTION_DIRECTIVES}
        totalBeats={4}
        initialSelectedId={1}
        onPlanChange={vi.fn()}
      />
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Plan limit reached · 256 directives"
    );
    expect(
      (screen.getByRole("button", { name: "Add Euclid pin" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Duplicate" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });
});
