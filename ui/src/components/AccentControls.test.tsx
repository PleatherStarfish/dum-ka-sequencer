// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  VelocityAccentControl,
  accentRangeFromCenterMargin,
  accentRangeMargin,
} from "./AccentControls";

afterEach(cleanup);

describe("velocity accent range conversion", () => {
  it("preserves committed margin near the low edge by shifting the range inward", () => {
    const range = accentRangeFromCenterMargin(0, 10);

    expect(range).toEqual({ min: 0, max: 20 });
    expect(accentRangeMargin(range.min, range.max)).toBe(10);
  });

  it("preserves committed margin near the high edge by shifting the range inward", () => {
    const range = accentRangeFromCenterMargin(127, 10);

    expect(range).toEqual({ min: 107, max: 127 });
    expect(accentRangeMargin(range.min, range.max)).toBe(10);
  });

  it("preserves the maximum UI margin over the full MIDI velocity domain", () => {
    const range = accentRangeFromCenterMargin(64, 64);

    expect(range).toEqual({ min: 0, max: 127 });
    expect(accentRangeMargin(range.min, range.max)).toBe(64);
  });
});

describe("VelocityAccentControl", () => {
  function Harness() {
    const [range, setRange] = useState({ min: 0, max: 0 });

    return (
      <VelocityAccentControl
        label="Beat"
        min={range.min}
        max={range.max}
        minAutomationTarget="sequencer.accent.beatStart.min"
        maxAutomationTarget="sequencer.accent.beatStart.max"
        onChange={setRange}
      />
    );
  }

  it("never marks a sub-control as a single-endpoint automation target (UC-29)", () => {
    // The center slider and margin field each rewrite BOTH endpoints, so
    // neither may advertise ownership of one `…min`/`…max` lane; the
    // pair-aware focus button is the only automation picker path.
    const { container } = render(<Harness />);
    expect(container.querySelector("[data-automation-target]")).toBeNull();
  });

  it("keeps a typed margin after blur when the current center is at the edge", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("spinbutton", {
      name: "Beat random margin",
    }) as HTMLInputElement;
    await user.click(input);
    await user.clear(input);
    await user.keyboard("10");
    await user.tab();

    expect(input.value).toBe("10");
    expect(screen.getByText("+0..+20")).toBeTruthy();
  });
});
