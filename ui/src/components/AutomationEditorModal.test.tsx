// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AutomationMarkerLabelField } from "./AutomationEditorModal";

afterEach(cleanup);

describe("AutomationMarkerLabelField", () => {
  it("keeps typing local and commits once on blur", () => {
    const onCommit = vi.fn();
    render(
      <AutomationMarkerLabelField
        label="Verse"
        disabled={false}
        onCommit={onCommit}
      />
    );
    const input = screen.getByRole("textbox", { name: "Marker label" });

    fireEvent.change(input, { target: { value: "Verse ending" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Verse ending");
  });

  it("commits Enter once and reverts Escape", () => {
    const onCommit = vi.fn();
    render(
      <AutomationMarkerLabelField
        label="Chorus"
        disabled={false}
        onCommit={onCommit}
      />
    );
    const input = screen.getByRole("textbox", { name: "Marker label" });

    fireEvent.change(input, { target: { value: "Bridge" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("Chorus");
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Final chorus" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Final chorus");
  });
});
