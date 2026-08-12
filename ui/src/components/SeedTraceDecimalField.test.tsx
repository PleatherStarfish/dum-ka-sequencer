// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeedTraceDecimalField } from "./SeedControls";

afterEach(cleanup);

describe("SeedTraceDecimalField", () => {
  it("renders and blurs a full-width u64 without rounding or committing", () => {
    const onValueCommit = vi.fn();
    render(
      <SeedTraceDecimalField
        ariaLabel="Replay seed"
        value="16602156551234156693"
        onValueCommit={onValueCommit}
      />
    );

    const input = screen.getByRole("textbox", { name: "Replay seed" });
    expect(input).toHaveProperty("value", "16602156551234156693");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onValueCommit).not.toHaveBeenCalled();
    expect(input).toHaveProperty("value", "16602156551234156693");
  });

  it("canonicalizes an explicit safe-number edit on commit", () => {
    const onValueCommit = vi.fn();
    render(
      <SeedTraceDecimalField
        ariaLabel="Replay seed"
        value="16602156551234156693"
        onValueCommit={onValueCommit}
      />
    );

    const input = screen.getByRole("textbox", { name: "Replay seed" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "00042" } });
    fireEvent.blur(input);

    expect(onValueCommit).toHaveBeenCalledOnce();
    expect(onValueCommit).toHaveBeenCalledWith("42");
    expect(input).toHaveProperty("value", "42");
  });
});
