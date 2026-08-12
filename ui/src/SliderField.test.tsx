// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSliderFieldBehavior, SliderField } from "./SliderField";
import { discardEditorDrafts } from "./editorDraftFlush";

afterEach(cleanup);

describe("resolveSliderFieldBehavior", () => {
  it("defaults to the ordinary 0-100 range with integer stepping", () => {
    expect(resolveSliderFieldBehavior({})).toMatchObject({
      defaultValueNumber: undefined,
      maxValue: 100,
      minValue: 0,
      stepValue: 1,
      valueNumber: undefined,
    });
  });

  it("clamps controlled and default values to the resolved range", () => {
    expect(
      resolveSliderFieldBehavior({
        defaultValue: -10,
        max: 24,
        min: 4,
        step: 0.25,
        value: 99,
      })
    ).toMatchObject({
      defaultValueNumber: 4,
      fractionDigits: 2,
      maxValue: 24,
      minValue: 4,
      stepValue: 0.25,
      valueNumber: 24,
    });
  });
});

describe("SliderField", () => {
  it("renders an accessible React Aria slider with portable rail sizing", () => {
    render(<SliderField aria-label="Chance" railSize="compact" value={25} />);

    const input = screen.getByRole("slider", { name: "Chance" });
    const root = input.closest(".slider-field") as HTMLElement;

    expect((input as HTMLInputElement).value).toBe("25");
    expect(input.getAttribute("data-slider-rail-size")).toBe("compact");
    expect(root.style.getPropertyValue("--slider-rail-min")).toBe("120px");
    expect(root.style.getPropertyValue("--slider-rail-max")).toBe("160px");
  });

  it("keeps native range-style onChange semantics for existing callers", () => {
    const changes: Array<{ value: string; valueAsNumber: number }> = [];
    render(
      <SliderField
        aria-label="Amount"
        max={100}
        min={0}
        value={20}
        onChange={(event) =>
          changes.push({
            value: event.target.value,
            valueAsNumber: event.target.valueAsNumber,
          })
        }
      />
    );

    fireEvent.change(screen.getByRole("slider", { name: "Amount" }), {
      target: { value: "35" },
    });

    expect(changes).toEqual([{ value: "35", valueAsNumber: 35 }]);
  });

  it("does not let slider drags masquerade as automation button clicks", () => {
    render(
      <SliderField
        aria-label="Chance"
        data-automation-target="ratchet.probabilityPercent"
        value={25}
      />
    );

    const input = screen.getByRole("slider", { name: "Chance" });
    const root = input.closest(".slider-field") as HTMLElement;

    expect(input.getAttribute("data-automation-target")).toBe(
      "ratchet.probabilityPercent"
    );
    expect(root.getAttribute("data-automation-target")).toBeNull();
    expect(root.getAttribute("data-automation-pick-control")).toBe("true");
  });

  it("keeps an outer label usable for existing slider rows", () => {
    render(
      <label>
        Chance
        <SliderField value={50} />
      </label>
    );

    expect(
      (screen.getByRole("slider", { name: "Chance" }) as HTMLInputElement).value
    ).toBe("50");
  });

  it("keeps custom overlay sliders on the native range path", () => {
    const { container } = render(
      <SliderField
        aria-label="Accent center"
        onChange={() => undefined}
        value={64}
        visualMode="native-overlay"
      />
    );

    const input = screen.getByRole("slider", { name: "Accent center" });
    const root = input.closest(".slider-field") as HTMLElement;

    expect(root.classList.contains("slider-field--native-overlay")).toBe(true);
    expect(input.classList.contains("slider-field__native-range")).toBe(true);
    expect(container.querySelector(".slider-field__track")).toBeNull();
    expect(container.querySelector(".slider-field__thumb")).toBeNull();
  });

  it("can render a compact value and range readout for bare slider rows", () => {
    render(
      <SliderField
        aria-label="Curve bend"
        max={1}
        min={0}
        showRange
        showValue
        step={0.01}
        value={0.75}
      />
    );

    expect(screen.getByText("0.75")).toBeTruthy();
    expect(screen.getByText("0-1")).toBeTruthy();
  });

  it("keeps one hundred pointer updates local and commits once on release", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <SliderField
        aria-label="Amount"
        min={0}
        max={100}
        value={20}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />
    );

    const input = screen.getByRole("slider", { name: "Amount" });
    fireEvent.pointerDown(input, { button: 0, buttons: 1, pointerId: 7 });
    for (let value = 1; value <= 100; value += 1) {
      fireEvent.change(input, { target: { value: String(value) } });
    }

    expect((input as HTMLInputElement).value).toBe("100");
    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeEnd).not.toHaveBeenCalled();

    fireEvent.pointerUp(input, { button: 0, pointerId: 7 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].target.valueAsNumber).toBe(100);
    expect(onChangeEnd).toHaveBeenCalledTimes(1);
    expect(onChangeEnd).toHaveBeenCalledWith(100);
  });

  it("cancels a pointer draft and reveals the latest controlled value", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SliderField
        aria-label="Amount"
        value={20}
        onChange={onChange}
      />
    );

    const input = screen.getByRole("slider", { name: "Amount" });
    fireEvent.pointerDown(input, { button: 0, buttons: 1, pointerId: 9 });
    fireEvent.change(input, { target: { value: "65" } });
    rerender(
      <SliderField
        aria-label="Amount"
        value={80}
        onChange={onChange}
      />
    );

    expect((input as HTMLInputElement).value).toBe("65");
    fireEvent.pointerCancel(input, { pointerId: 9 });
    fireEvent.lostPointerCapture(input, { pointerId: 9 });

    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("80");
  });

  it("commits keyboard steps immediately as discrete edits", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <SliderField
        aria-label="Amount"
        min={0}
        max={100}
        step={1}
        value={20}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />
    );

    fireEvent.keyDown(screen.getByRole("slider", { name: "Amount" }), {
      key: "ArrowRight",
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].target.valueAsNumber).toBe(21);
    expect(onChangeEnd).toHaveBeenCalledWith(21);
  });

  it("gives native-overlay sliders the same release and lost-capture contract", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <SliderField
        aria-label="Accent center"
        min={0}
        max={100}
        value={10}
        visualMode="native-overlay"
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />
    );

    const input = screen.getByRole("slider", { name: "Accent center" });
    fireEvent.pointerDown(input, { button: 0, buttons: 1, pointerId: 4 });
    for (let value = 1; value <= 100; value += 1) {
      fireEvent.change(input, { target: { value: String(value) } });
    }
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.lostPointerCapture(input, { pointerId: 4 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].target.valueAsNumber).toBe(100);
    expect(onChangeEnd).toHaveBeenCalledWith(100);
  });

  it("supports an explicit continuous pointer callback mode", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <SliderField
        aria-label="Scrub"
        changeMode="continuous"
        min={0}
        max={100}
        value={10}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />
    );

    const input = screen.getByRole("slider", { name: "Scrub" });
    fireEvent.pointerDown(input, { button: 0, buttons: 1, pointerId: 12 });
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.change(input, { target: { value: "30" } });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChangeEnd).not.toHaveBeenCalled();
    fireEvent.pointerUp(input, { pointerId: 12 });
    expect(onChangeEnd).toHaveBeenCalledTimes(1);
    expect(onChangeEnd).toHaveBeenCalledWith(30);
  });

  it("restores a controlled continuous draft when the gesture is cancelled", () => {
    function Harness() {
      const [draft, setDraft] = useState(10);
      return (
        <SliderField
          aria-label="Bend"
          changeMode="continuous"
          min={0}
          max={100}
          value={draft}
          onChange={(event) => setDraft(event.target.valueAsNumber)}
          onChangeCancel={setDraft}
        />
      );
    }

    render(<Harness />);
    const input = screen.getByRole("slider", { name: "Bend" });
    fireEvent.pointerDown(input, { button: 0, buttons: 1, pointerId: 14 });
    fireEvent.change(input, { target: { value: "70" } });
    expect((input as HTMLInputElement).value).toBe("70");

    fireEvent.pointerCancel(input, { pointerId: 14 });
    expect((input as HTMLInputElement).value).toBe("10");
  });

  it.each(["basic", "native-overlay"] as const)(
    "discards an active same-value cross-document %s draft and trailing pointer events",
    async (visualMode) => {
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      const view = render(
        <SliderField
          aria-label="Document slider"
          min={0}
          max={100}
          value={20}
          visualMode={visualMode}
          onChange={onChange}
          onChangeEnd={onChangeEnd}
        />
      );
      const input = screen.getByRole("slider", { name: "Document slider" });
      fireEvent.pointerDown(input, {
        button: 0,
        buttons: 1,
        pointerId: 41,
      });
      fireEvent.change(input, { target: { value: "75" } });
      expect((input as HTMLInputElement).value).toBe("75");

      act(discardEditorDrafts);
      view.rerender(
        <SliderField
          aria-label="Document slider"
          min={0}
          max={100}
          value={20}
          visualMode={visualMode}
          onChange={onChange}
          onChangeEnd={onChangeEnd}
        />
      );
      expect((input as HTMLInputElement).value).toBe("20");

      // A physical pointer can still send one last move/change before its
      // terminal event. Neither that event nor release may author document B.
      fireEvent.change(input, { target: { value: "90" } });
      fireEvent.pointerUp(input, { pointerId: 41 });
      fireEvent.lostPointerCapture(input, { pointerId: 41 });
      fireEvent.blur(input);

      expect(onChange).not.toHaveBeenCalled();
      expect(onChangeEnd).not.toHaveBeenCalled();
      expect((input as HTMLInputElement).value).toBe("20");

      fireEvent.pointerDown(input, {
        button: 0,
        buttons: 1,
        pointerId: 42,
      });
      fireEvent.change(input, { target: { value: "60" } });
      fireEvent.pointerUp(input, { pointerId: 42 });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]![0].target.valueAsNumber).toBe(60);
      expect(onChangeEnd).toHaveBeenCalledWith(60);
      await act(
        () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      );
    }
  );
});
