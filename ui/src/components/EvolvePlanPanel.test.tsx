// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvolvePlanPanel } from "./EvolvePlanPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EvolvePlanPanel", () => {
  it("provides the full-window editor shell and closes through the controlled seam", () => {
    const onOpenChange = vi.fn();
    const onVisibleCycleRangeChange = vi.fn();
    render(
      <EvolvePlanPanel
        open
        generatorKind="dumka"
        plan={[]}
        planLengthCycles={16}
        cycleBeats={4}
        playbackStructureLocked={false}
        onOpenChange={onOpenChange}
        onPlanChange={vi.fn()}
        onPlanLengthCyclesChange={vi.fn()}
        onPreviewCycleChange={vi.fn()}
        onVisibleCycleRangeChange={onVisibleCycleRangeChange}
      />
    );

    const dialog = screen.getByRole("dialog", {
      name: "Evolution score editor",
    });
    expect(dialog.className).toContain("modal-surface--full");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("region", { name: "Evolution score" })).toBeTruthy();
    expect(onVisibleCycleRangeChange).toHaveBeenCalledWith(0, expect.any(Number));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();
    const details = document.querySelector("#evolve-plan-editor");
    expect(details?.hasAttribute("open")).toBe(true);
    details?.removeAttribute("open");
    fireEvent(details!, new Event("toggle"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("explains why authoring is disabled for the Example generator", () => {
    render(
      <EvolvePlanPanel
        open
        generatorKind="example"
        plan={[]}
        planLengthCycles={0}
        cycleBeats={4}
        playbackStructureLocked={false}
        onOpenChange={vi.fn()}
        onPlanChange={vi.fn()}
        onPlanLengthCyclesChange={vi.fn()}
        onPreviewCycleChange={vi.fn()}
      />
    );
    expect(screen.getByText(/belongs to the Dum-Ka generator/i)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Add Fragment pin" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("moves focus into the dialog and restores the launcher on close", () => {
    const launcher = document.createElement("button");
    document.body.append(launcher);
    launcher.focus();
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const common = {
      generatorKind: "dumka" as const,
      plan: [],
      planLengthCycles: 16,
      cycleBeats: 4,
      playbackStructureLocked: false,
      onOpenChange: vi.fn(),
      onPlanChange: vi.fn(),
      onPlanLengthCyclesChange: vi.fn(),
      onPreviewCycleChange: vi.fn(),
    };
    const view = render(<EvolvePlanPanel {...common} open />);
    const dialog = screen.getByRole("dialog", {
      name: "Evolution score editor",
    });
    expect(document.activeElement).toBe(dialog);

    view.rerender(<EvolvePlanPanel {...common} open={false} />);
    expect(document.activeElement).toBe(launcher);

    requestFrame.mockRestore();
    cancelFrame.mockRestore();
    launcher.remove();
  });
});
