// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FixedSectionControls } from "./FixedSectionControls";

afterEach(cleanup);

describe("FixedSectionControls", () => {
  it("authors one subdivision and an optional valid grouping", () => {
    const onSubdivisionChange = vi.fn();
    const onGroupingChange = vi.fn();
    render(
      <FixedSectionControls
        subdivision={4}
        grouping={null}
        totalMatras={15}
        timingGrid={4}
        onSubdivisionChange={onSubdivisionChange}
        onGroupingChange={onGroupingChange}
      />
    );

    fireEvent.change(screen.getByLabelText("Subdivision"), {
      target: { value: "5" },
    });
    fireEvent.blur(screen.getByLabelText("Subdivision"));
    fireEvent.change(screen.getByLabelText("Grouping"), {
      target: { value: "3" },
    });

    expect(onSubdivisionChange).toHaveBeenCalledWith(5);
    expect(onGroupingChange).toHaveBeenCalledWith(3);
    expect(screen.queryByRole("option", { name: "4" })).toBeNull();
  });

  it("clears grouping explicitly", () => {
    const onGroupingChange = vi.fn();
    render(
      <FixedSectionControls
        subdivision={4}
        grouping={5}
        onSubdivisionChange={vi.fn()}
        onGroupingChange={onGroupingChange}
      />
    );

    fireEvent.change(screen.getByLabelText("Grouping"), {
      target: { value: "" },
    });
    expect(onGroupingChange).toHaveBeenCalledWith(null);
  });
});
