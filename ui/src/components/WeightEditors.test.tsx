// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoundaryRail } from "./WeightEditors";
import type { BoundaryPoint } from "../patchIo";

afterEach(cleanup);

function boundary(afterBeat: number): BoundaryPoint {
  return {
    id: `b-${afterBeat}`,
    afterBeat,
    changeProbability: 1,
    weights: [{ subdivision: 4, weight: 1 }],
    jathiWeights: [],
    customSubdivision: null,
  };
}

function mockRailRect(rail: HTMLElement) {
  const rect = vi.fn(() => ({
    left: 0,
    top: 0,
    width: 400,
    height: 100,
    right: 400,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));
  Object.defineProperty(rail, "getBoundingClientRect", { value: rect });
  return rect;
}

describe("BoundaryRail", () => {
  it("coalesces drag moves locally and commits one fixed boundary", () => {
    const onBoundaryEdit = vi.fn();
    render(
      <BoundaryRail
        cycleBeats={8}
        boundaries={[]}
        resolvedSections={[]}
        onBoundaryEdit={onBoundaryEdit}
      />
    );
    const rail = screen.getByLabelText("Section boundaries");
    const rect = mockRailRect(rail);

    fireEvent.pointerDown(rail, {
      button: 0,
      buttons: 1,
      clientX: 100,
      pointerId: 3,
    });
    for (let index = 0; index < 100; index += 1) {
      fireEvent.pointerMove(rail, {
        buttons: 1,
        clientX: 300,
        pointerId: 3,
      });
    }

    expect(onBoundaryEdit).not.toHaveBeenCalled();
    expect(rect).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(rail, { pointerId: 3 });

    expect(onBoundaryEdit).toHaveBeenCalledTimes(1);
    expect(onBoundaryEdit).toHaveBeenCalledWith({
      afterBeat: 6,
      remove: false,
    });
  });

  it("cancels without committing and ignores the following lost capture", () => {
    const onBoundaryEdit = vi.fn();
    render(
      <BoundaryRail
        cycleBeats={8}
        boundaries={[]}
        resolvedSections={[]}
        onBoundaryEdit={onBoundaryEdit}
      />
    );
    const rail = screen.getByLabelText("Section boundaries");
    mockRailRect(rail);

    fireEvent.pointerDown(rail, {
      button: 0,
      buttons: 1,
      clientX: 100,
      pointerId: 5,
    });
    fireEvent.pointerMove(rail, {
      buttons: 1,
      clientX: 250,
      pointerId: 5,
    });
    fireEvent.pointerCancel(rail, { pointerId: 5 });
    fireEvent.lostPointerCapture(rail, { pointerId: 5 });

    expect(onBoundaryEdit).not.toHaveBeenCalled();
  });

  it("dedupes an edit on an existing boundary", () => {
    const onBoundaryEdit = vi.fn();
    render(
      <BoundaryRail
        cycleBeats={8}
        boundaries={[boundary(2)]}
        resolvedSections={[]}
        onBoundaryEdit={onBoundaryEdit}
      />
    );
    const rail = screen.getByLabelText("Section boundaries");
    mockRailRect(rail);

    fireEvent.pointerDown(rail, {
      button: 0,
      buttons: 1,
      clientX: 100,
      pointerId: 8,
    });
    fireEvent.lostPointerCapture(rail, { pointerId: 8 });

    expect(onBoundaryEdit).not.toHaveBeenCalled();
  });
});
