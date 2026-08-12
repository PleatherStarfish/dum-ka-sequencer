// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DirectiveTraceEntry, EvolutionDirective } from "../bridge";
import {
  DEFAULT_DIRECTIVE_OPTIONS,
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
    expect(screen.getByLabelText("Stochastic lane")).toBeTruthy();
    expect(screen.getAllByTitle("Cycle 0 is the locked seed")).toHaveLength(9);
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
    const onset = screen.getByTitle("1 onsets");
    expect(onset).toBeTruthy();
    expect(onset.parentElement?.style.getPropertyValue("--density-percent")).toBe(
      "25%"
    );
    expect(onset.style.height).toBe("25%");
    expect(
      screen.getByRole("group", {
        name: /Cycle 5 composition: 1 onset, 25% density/,
      })
    ).toBeTruthy();
    expect(
      screen.getByRole("group", {
        name: "Cycle 6 composition: 4 onsets, 100% density",
      })
    ).toBeTruthy();
    expect(
      (document.querySelector(
        '.evolve-plan-onset-bar[title="4 onsets"]'
      ) as HTMLElement).style.height
    ).toBe("100%");
    expect(document.querySelectorAll(".evolve-plan-trace")).toHaveLength(2);
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
