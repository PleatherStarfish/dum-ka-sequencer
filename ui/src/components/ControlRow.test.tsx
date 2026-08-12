// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SliderField } from "../SliderField";
import { ControlRow } from "./ControlRow";

afterEach(cleanup);

describe("ControlRow", () => {
  it("renders label, control, value, and range as separate slots", () => {
    const { container } = render(
      <ControlRow
        label="Minimum ratchet rate"
        control={<SliderField aria-label="Minimum ratchet rate" value={12} />}
        value={<output>12 Hz</output>}
        range="0-48 Hz"
      />
    );

    expect(screen.getByText("Minimum ratchet rate")).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Minimum ratchet rate" })).toBeTruthy();
    expect(screen.getByText("12 Hz")).toBeTruthy();
    expect(screen.getByText("0-48 Hz")).toBeTruthy();
    expect(container.querySelector("label")).toBeNull();
  });

  it("keeps automation controls out of the native label activation path", () => {
    const { container } = render(
      <ControlRow
        label="Ratchet chance"
        automation={
          <button data-automation-pick-control="true" type="button">
            ~
          </button>
        }
        control={
          <SliderField
            aria-label="Ratchet chance"
            data-automation-target="ratchet.probabilityPercent"
            value={50}
          />
        }
        value={<output>50%</output>}
      />
    );

    const button = screen.getByRole("button", { name: "~" });
    const slider = screen.getByRole("slider", { name: "Ratchet chance" });
    const row = slider.closest("[data-control-row='true']");

    expect(button.getAttribute("data-automation-pick-control")).toBe("true");
    expect(row?.getAttribute("data-automation-target")).toBeNull();
    expect(container.querySelector("label button")).toBeNull();
  });

  it("applies portable control width overrides through row-owned variables", () => {
    const { container } = render(
      <ControlRow
        label="Chance"
        control={<SliderField aria-label="Chance" value={25} />}
        controlMinWidth={140}
        controlIdealWidth={180}
        controlMaxWidth={220}
      />
    );

    const row = container.querySelector(".control-row") as HTMLElement;

    expect(row.style.getPropertyValue("--control-row-control-min")).toBe("140px");
    expect(row.style.getPropertyValue("--control-row-control-ideal")).toBe("180px");
    expect(row.style.getPropertyValue("--control-row-control-max")).toBe("220px");
  });
});
