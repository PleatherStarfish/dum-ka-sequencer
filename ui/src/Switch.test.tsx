// @vitest-environment jsdom
/**
 * Behavioral spec for the portable Switch (React Aria). This is the contract
 * every on/off toggle in the app now shares.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Switch } from "./Switch";

afterEach(cleanup);

function sw(name: string): HTMLElement {
  return screen.getByRole("switch", { name });
}

describe("accessibility", () => {
  it("exposes role=switch with an accessible name from aria-label", () => {
    render(<Switch aria-label="Built-in synth" />);
    const el = sw("Built-in synth");
    expect(el).toBeDefined();
    expect((el as HTMLInputElement).checked).toBe(false);
  });

  it("derives the accessible name from children", () => {
    render(<Switch>monitor on</Switch>);
    expect(sw("monitor on").getAttribute("role")).toBe("switch");
  });

  it("reflects selected state in aria-checked", () => {
    render(<Switch aria-label="X" isSelected />);
    expect((sw("X") as HTMLInputElement).checked).toBe(true);
  });
});

describe("toggling", () => {
  it("click toggles and reports the resulting boolean", async () => {
    const user = userEvent.setup();
    const calls: boolean[] = [];
    render(<Switch aria-label="Ratchet" onChange={(v) => calls.push(v)} />);
    await user.click(sw("Ratchet"));
    expect(calls).toEqual([true]);
  });

  it("Space toggles when focused", async () => {
    const user = userEvent.setup();
    const calls: boolean[] = [];
    render(<Switch aria-label="Delay" onChange={(v) => calls.push(v)} />);
    await user.tab();
    expect(document.activeElement).toBe(sw("Delay"));
    await user.keyboard(" ");
    expect(calls).toEqual([true]);
  });

  it("round-trips through a controlled parent", async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [on, setOn] = useState(false);
      return (
        <Switch isSelected={on} onChange={setOn}>
          {on ? "on" : "off"}
        </Switch>
      );
    }
    render(<Controlled />);
    const el = sw("off");
    expect((el as HTMLInputElement).checked).toBe(false);
    await user.click(el);
    expect((sw("on") as HTMLInputElement).checked).toBe(true);
    await user.click(sw("on"));
    expect((sw("off") as HTMLInputElement).checked).toBe(false);
  });
});

describe("disabled / read-only", () => {
  it("isDisabled blocks toggling and emits nothing", async () => {
    const user = userEvent.setup();
    const calls: boolean[] = [];
    render(<Switch aria-label="Off feature" isDisabled onChange={(v) => calls.push(v)} />);
    await user.click(sw("Off feature"));
    expect(calls).toEqual([]);
    expect((sw("Off feature") as HTMLInputElement).checked).toBe(false);
  });

  it("isReadOnly shows state without toggling", async () => {
    const user = userEvent.setup();
    const calls: boolean[] = [];
    render(
      <Switch aria-label="Locked" isSelected isReadOnly onChange={(v) => calls.push(v)} />
    );
    await user.click(sw("Locked"));
    expect(calls).toEqual([]);
    expect((sw("Locked") as HTMLInputElement).checked).toBe(true);
  });
});

describe("uncontrolled", () => {
  it("honors defaultSelected and toggles internally", async () => {
    const user = userEvent.setup();
    const calls: boolean[] = [];
    render(<Switch aria-label="Auto" defaultSelected onChange={(v) => calls.push(v)} />);
    const el = sw("Auto") as HTMLInputElement;
    expect(el.checked).toBe(true);
    await user.click(el);
    expect(calls).toEqual([false]);
    expect((sw("Auto") as HTMLInputElement).checked).toBe(false);
  });
});

describe("style hooks", () => {
  it("applies size and tone class hooks and the on/off state class", () => {
    const { container } = render(
      <Switch aria-label="A" size="sm" tone="accent" isSelected />
    );
    const root = container.querySelector("label.switch")!;
    expect(root.className).toContain("switch--sm");
    expect(root.className).toContain("switch--accent");
    expect(root.className).toContain("is-on");
    expect(container.querySelector(".switch__track")).not.toBeNull();
    expect(container.querySelector(".switch__thumb")).not.toBeNull();
  });
});
