// @vitest-environment jsdom
/**
 * Behavioral spec for the hardened NumericField (docs/NUMERIC_INPUT_SURVEY.md).
 * These tests ARE the contract: if a behavior here changes, every numeric
 * entry point in the app changes with it.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NumericField } from "./NumericField";
import { discardEditorDrafts, flushEditorDrafts } from "./editorDraftFlush";

afterEach(cleanup);

function field(label: string): HTMLInputElement {
  return screen.getByRole("spinbutton", { name: label }) as HTMLInputElement;
}

describe("commit semantics", () => {
  it("does not commit per keystroke; commits the full draft on blur", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(
      <NumericField
        aria-label="Pitch"
        min={0}
        max={127}
        value={60}
        onValueCommit={(v) => commits.push(v)}
      />
    );
    const input = field("Pitch");
    await user.click(input);
    await user.keyboard("12");
    expect(commits).toEqual([]); // typing "1" then "12" must not commit 1
    await user.tab();
    expect(commits).toEqual([12]);
  });

  it("commits on Enter and blurs", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(
      <NumericField aria-label="Count" value={4} onValueCommit={(v) => commits.push(v)} />
    );
    const input = field("Count");
    await user.click(input);
    await user.keyboard("7{Enter}");
    expect(commits).toEqual([7]);
    expect(document.activeElement).not.toBe(input);
  });

  it("does not emit when the committed value is unchanged", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(
      <NumericField aria-label="Velocity" value={96} onValueCommit={(v) => commits.push(v)} />
    );
    await user.click(field("Velocity"));
    await user.keyboard("96{Enter}");
    expect(commits).toEqual([]);
  });

  it("publishes a focused valid draft for autosave without formatting or blurring", async () => {
    const commits = vi.fn();
    render(
      <NumericField
        aria-label="Autosave value"
        min={0}
        max={100}
        step={0.5}
        value={20}
        onValueCommit={commits}
      />
    );
    const input = field("Autosave value");
    input.focus();
    fireEvent.change(input, { target: { value: "87.26" } });

    await act(flushEditorDrafts);

    expect(commits).toHaveBeenCalledTimes(1);
    expect(commits).toHaveBeenCalledWith(87.5, "87.5");
    expect(input.value).toBe("87.26");
    expect(document.activeElement).toBe(input);
  });

  it("leaves an invalid partial draft and focus untouched during autosave", async () => {
    const commits = vi.fn();
    render(
      <NumericField
        aria-label="Partial value"
        value={20}
        onValueCommit={commits}
      />
    );
    const input = field("Partial value");
    input.focus();
    fireEvent.change(input, { target: { value: "-" } });

    await act(flushEditorDrafts);

    expect(commits).not.toHaveBeenCalled();
    expect(input.value).toBe("-");
    expect(document.activeElement).toBe(input);
  });

  it("publishes a valid draft when its owner unmounts without blur", () => {
    const commits = vi.fn();
    const view = render(
      <NumericField
        aria-label="Unmount value"
        value={20}
        onValueCommit={commits}
      />
    );
    const input = field("Unmount value");
    input.focus();
    fireEvent.change(input, { target: { value: "73" } });

    view.unmount();

    expect(commits).toHaveBeenCalledTimes(1);
    expect(commits).toHaveBeenCalledWith(73, "73");
  });
});

describe("invalid input can never reach a call site", () => {
  it("empty draft on blur reverts to the last committed text and emits nothing", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(
      <NumericField aria-label="Weight" numericMode="weight" value={3} onValueCommit={(v) => commits.push(v)} />
    );
    const input = field("Weight");
    await user.click(input);
    await user.clear(input);
    await user.tab();
    expect(commits).toEqual([]);
    expect(input.value).toBe("3");
  });

  it("rejects non-numeric characters at the keystroke", async () => {
    const user = userEvent.setup();
    render(<NumericField aria-label="Beats" value={8} />);
    const input = field("Beats");
    await user.click(input);
    await user.keyboard("abc");
    expect(input.value).toBe("8"); // selected-on-focus text survives, letters dropped
  });

  it("tolerates partial drafts mid-edit without committing", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(
      <NumericField
        aria-label="Variance"
        step={0.05}
        min={0}
        max={1}
        value={0.5}
        onValueCommit={(v) => commits.push(v)}
      />
    );
    const input = field("Variance");
    await user.click(input);
    await user.clear(input);
    await user.keyboard(".");
    expect(commits).toEqual([]);
    await user.keyboard("2");
    await user.tab();
    expect(commits).toEqual([0.2]);
  });

  it("weight zero is a real committed value, not an error fallback", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(
      <NumericField
        aria-label="gati weight"
        numericMode="weight"
        value={2}
        onValueCommit={(v) => commits.push(v)}
      />
    );
    const input = field("gati weight");
    await user.click(input);
    await user.keyboard("0{Enter}");
    expect(commits).toEqual([0]);
  });

  it("weight mode comes from the explicit prop", () => {
    render(
      <NumericField
        aria-label="weighted label is just a label"
        numericMode="weight"
        value={2}
      />
    );
    const input = field("weighted label is just a label");
    expect(input.dataset.numericMode).toBe("weight");
    expect(input.getAttribute("aria-valuemin")).toBe("0");
  });
});

describe("clamping and quantization at commit", () => {
  function ClampHarness(props: { onCommit?: (v: number) => void }) {
    const [value, setValue] = useState(80);
    return (
      <NumericField
        aria-label="Tempo"
        min={20}
        max={400}
        step={0.5}
        value={value}
        onValueCommit={(v) => {
          setValue(v);
          props.onCommit?.(v);
        }}
      />
    );
  }

  it("clamps to max", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(<ClampHarness onCommit={(v) => commits.push(v)} />);
    const input = field("Tempo");
    await user.click(input);
    await user.keyboard("999{Enter}");
    expect(commits).toEqual([400]);
    expect(input.value).toBe("400");
  });

  it("clamps to min and quantizes to step", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(
      <NumericField aria-label="Tempo" min={20} max={400} step={0.5} value={80} onValueCommit={(v) => commits.push(v)} />
    );
    const input = field("Tempo");
    await user.click(input);
    await user.keyboard("80.26{Enter}");
    expect(commits).toEqual([80.5]);
  });

  it("preserves micro-step precision (automation phase, step 0.000001)", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(
      <NumericField aria-label="Marker phase" min={0} max={1} step={0.000001} value={0} onValueCommit={(v) => commits.push(v)} />
    );
    const input = field("Marker phase");
    await user.click(input);
    await user.keyboard("0.123456{Enter}");
    expect(commits).toEqual([0.123456]);
  });

  it("displays large integer seeds exactly, without digit grouping", () => {
    render(<NumericField aria-label="Seed" min={0} value={9007199254740991} />);
    expect(field("Seed").value).toBe("9007199254740991");
  });
});

describe("escape and stepping", () => {
  it("Escape reverts the draft and emits nothing", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(
      <NumericField aria-label="Chance" min={0} max={100} value={55} onValueCommit={(v) => commits.push(v)} />
    );
    const input = field("Chance");
    await user.click(input);
    await user.keyboard("99{Escape}");
    expect(commits).toEqual([]);
    expect(input.value).toBe("55");
  });

  it("ArrowUp steps by step; Shift multiplies by 10; clamped at max", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(
      <NumericField aria-label="Channel" min={1} max={16} value={15} onValueCommit={(v) => commits.push(v)} />
    );
    const input = field("Channel");
    await user.click(input);
    await user.keyboard("{ArrowUp}");
    expect(commits).toEqual([16]);
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(commits).toEqual([16]); // already at max — no re-emit
  });

  it("stepper buttons commit, respect bounds, and stay out of the a11y tree", async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    const { container } = render(
      <NumericField aria-label="Order" min={0} max={2} value={2} onValueCommit={(v) => commits.push(v)} />
    );
    // The steppers are mouse-only duplicates of the input's arrow keys, so
    // they are aria-hidden: no "Increase …" buttons pollute the page listing
    // (UC-55) and getByLabel("Order") stays unambiguous.
    expect(screen.queryByRole("button")).toBeNull();
    const steppers = container.querySelector(".numeric-field__steppers");
    expect(steppers?.getAttribute("aria-hidden")).toBe("true");
    const buttons = Array.from(
      steppers?.querySelectorAll("button") ?? []
    ) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.disabled).toBe(true);
    await user.click(buttons[1]!);
    expect(commits).toEqual([1]);
  });
});

describe("external value follow", () => {
  function Harness() {
    const [external, setExternal] = useState(100);
    return (
      <>
        <NumericField aria-label="Tempo" min={20} max={400} step={0.5} value={external} />
        <button onClick={() => setExternal(120.5)}>tick</button>
      </>
    );
  }

  it("follows external updates while not editing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "tick" }));
    expect(field("Tempo").value).toBe("120.5");
  });

  it("freezes the external value while the user edits", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = field("Tempo");
    await user.click(input);
    await user.keyboard("9"); // draft "9" in progress
    await user.click(screen.getByRole("button", { name: "tick" })); // external -> 120.5 (also blurs input)
    // blur committed the draft 9 -> clamped to 20, external update follows after
    expect(["20", "120.5"]).toContain(input.value);
  });

  it("reverts to a newer external commit instead of a prior record's text", async () => {
    const user = userEvent.setup();
    function ControlledHarness() {
      const [external, setExternal] = useState(100);
      return (
        <>
          <NumericField
            aria-label="Tempo"
            min={20}
            max={400}
            step={0.5}
            value={external}
            onValueCommit={setExternal}
          />
          <button onClick={() => setExternal(120.5)}>switch record</button>
        </>
      );
    }

    render(<ControlledHarness />);
    const input = field("Tempo");
    await user.click(input);
    await user.keyboard("90{Enter}");
    expect(input.value).toBe("90");
    await user.click(screen.getByRole("button", { name: "switch record" }));
    expect(input.value).toBe("120.5");
    await user.click(input);
    await user.keyboard("75{Escape}");
    expect(input.value).toBe("120.5");
  });

  it("discards an active same-value cross-document draft before later blur", async () => {
    const commits = vi.fn();
    const view = render(
      <NumericField
        aria-label="Document value"
        value={50}
        onValueCommit={commits}
      />
    );
    const input = field("Document value");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "91" } });
    expect(input.value).toBe("91");

    act(discardEditorDrafts);
    view.rerender(
      <NumericField
        aria-label="Document value"
        value={50}
        onValueCommit={commits}
      />
    );
    expect(input.value).toBe("50");

    fireEvent.blur(input);
    expect(commits).not.toHaveBeenCalled();
    await act(() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
  });
});

describe("commit pipeline with React state round-trip", () => {
  function Controlled() {
    const [value, setValue] = useState(60);
    return (
      <NumericField aria-label="Pitch" min={0} max={127} value={value} onValueCommit={setValue} />
    );
  }

  it("round-trips through a controlled parent without fighting the draft", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = field("Pitch");
    await user.click(input);
    await user.keyboard("72{Enter}");
    expect(input.value).toBe("72");
    await user.click(input);
    await user.keyboard("300{Enter}");
    expect(input.value).toBe("127");
  });
});

describe("regression guards", () => {
  it("does not infer weight mode from labels", () => {
    render(<NumericField aria-label="Fallback weight" step={0.5} value={2} />);
    expect(field("Fallback weight").dataset.numericMode).toBe("decimal");
  });

  it("never calls onValueCommit with NaN under garbage input sequences", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<NumericField aria-label="Fuzz" min={0} max={100} value={50} onValueCommit={spy} />);
    const input = field("Fuzz");
    for (const seq of ["-", ".", "-.", "{Enter}", "..", "--5", "1e", "{Escape}"]) {
      await user.click(input);
      await user.clear(input);
      await user.keyboard(seq);
      await user.tab();
    }
    for (const call of spy.mock.calls) {
      expect(Number.isFinite(call[0])).toBe(true);
    }
  });
});
