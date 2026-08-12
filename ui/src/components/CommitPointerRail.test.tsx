// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { discardEditorDrafts } from "../editorDraftFlush";
import { CommitPointerRail, railValueFromClientX } from "./CommitPointerRail";

afterEach(cleanup);

describe("CommitPointerRail", () => {
  it("quantizes and clamps cached-geometry coordinates", () => {
    const rect = { left: 10, width: 200 } as DOMRect;
    expect(railValueFromClientX(9, rect, 100, 5)).toBe(0);
    expect(railValueFromClientX(113, rect, 100, 5)).toBe(50);
    expect(railValueFromClientX(250, rect, 100, 5)).toBe(100);
  });

  it("keeps one hundred moves local and commits once on release", () => {
    const onValueCommit = vi.fn();
    render(
      <CommitPointerRail
        aria-label="Rest chance"
        value={20}
        onValueCommit={onValueCommit}
      >
        {(value) => <output>{value}%</output>}
      </CommitPointerRail>
    );
    const rail = screen.getByRole("button", { name: "Rest chance" });
    Object.defineProperty(rail, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100 } as DOMRect),
    });

    fireEvent.pointerDown(rail, { button: 0, pointerId: 4, clientX: 20 });
    for (let x = 1; x <= 100; x += 1) {
      fireEvent.pointerMove(rail, { pointerId: 4, clientX: x });
    }
    expect(onValueCommit).not.toHaveBeenCalled();
    expect(screen.getByText("100%")).toBeTruthy();

    fireEvent.pointerUp(rail, { pointerId: 4, clientX: 100 });
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledWith(100);
  });

  it("reverts on cancel and commits the latest draft on lost capture", () => {
    const onValueCommit = vi.fn();
    render(
      <CommitPointerRail
        aria-label="Tie chance"
        value={25}
        onValueCommit={onValueCommit}
      >
        {(value) => <output>{value}%</output>}
      </CommitPointerRail>
    );
    const rail = screen.getByRole("button", { name: "Tie chance" });
    Object.defineProperty(rail, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100 } as DOMRect),
    });

    fireEvent.pointerDown(rail, { button: 0, pointerId: 5, clientX: 25 });
    fireEvent.pointerMove(rail, { pointerId: 5, clientX: 60 });
    fireEvent.pointerCancel(rail, { pointerId: 5 });
    expect(onValueCommit).not.toHaveBeenCalled();
    expect(screen.getByText("25%")).toBeTruthy();

    fireEvent.pointerDown(rail, { button: 0, pointerId: 6, clientX: 25 });
    fireEvent.pointerMove(rail, { pointerId: 6, clientX: 70 });
    fireEvent.lostPointerCapture(rail, { pointerId: 6 });
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledWith(70);
  });

  it("discards an active draft so trailing release cannot commit document B", () => {
    const onValueCommit = vi.fn();
    render(
      <CommitPointerRail
        aria-label="Document rail"
        value={25}
        onValueCommit={onValueCommit}
      >
        {(value) => <output>{value}%</output>}
      </CommitPointerRail>
    );
    const rail = screen.getByRole("button", { name: "Document rail" });
    Object.defineProperty(rail, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100 } as DOMRect),
    });
    fireEvent.pointerDown(rail, { button: 0, pointerId: 17, clientX: 25 });
    fireEvent.pointerMove(rail, { pointerId: 17, clientX: 80 });
    expect(screen.getByText("80%")).toBeTruthy();

    act(discardEditorDrafts);
    expect(screen.getByText("25%")).toBeTruthy();
    fireEvent.pointerUp(rail, { pointerId: 17, clientX: 80 });
    fireEvent.lostPointerCapture(rail, { pointerId: 17 });

    expect(onValueCommit).not.toHaveBeenCalled();
  });

  it("commits discrete keyboard steps", () => {
    const onValueCommit = vi.fn();
    render(
      <CommitPointerRail
        aria-label="Multiplier"
        value={100}
        max={200}
        onValueCommit={onValueCommit}
      >
        {(value) => <output>{value}%</output>}
      </CommitPointerRail>
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Multiplier" }), {
      key: "ArrowUp",
    });
    expect(onValueCommit).toHaveBeenCalledWith(105);
  });
});
