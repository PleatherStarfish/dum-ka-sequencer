// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SectionBoundariesPanel,
  type SectionBoundariesPanelProps,
} from "./SectionBoundariesPanel";

afterEach(cleanup);

function makeProps(
  overrides: Partial<SectionBoundariesPanelProps> = {}
): SectionBoundariesPanelProps {
  const noop = vi.fn();
  return {
    name: "Adi",
    onNameChange: noop,
    onCycleBeatsChange: noop,
    pitch: 60,
    onPitchChange: noop,
    velocity: 96,
    onVelocityChange: noop,
    renderAutomationControlLabel: (label) => label,
    activeSectionInspectorEntry: {
      key: "initial",
      kind: "initial",
      label: "Initial section",
      detail: "beats 1-8",
      startBeat: 1,
    },
    addBoundary: noop,
    beatAccentMax: 96,
    beatAccentMin: 96,
    boundariesOpen: true,
    boundaryStatusStrip: [],
    cycleBeats: 8,
    initialJathiWeights: [],
    initialWeights: [],
    jathiAccentMax: 108,
    jathiAccentMin: 108,
    jathiAccentMode: "overrideGati",
    normalizedBoundaries: [],
    playbackStructureLocked: false,
    renderAutomationFocusButton: () => null,
    renderSectionInspector: () => <div>section</div>,
    resolvedSections: [],
    sectionAccentMax: 8,
    sectionAccentMin: 8,
    sectionInspectorEntries: [],
    setBeatAccentMax: noop,
    setBeatAccentMin: noop,
    setBoundariesOpen: noop,
    setJathiAccentMax: noop,
    setJathiAccentMin: noop,
    setJathiAccentMode: noop,
    setSectionAccentMax: noop,
    setSectionAccentMin: noop,
    setSectionInspectorKey: noop,
    ...overrides,
  };
}

describe("SectionBoundariesPanel interaction state", () => {
  it("does not mount the editor body while closed", () => {
    render(<SectionBoundariesPanel {...makeProps({ boundariesOpen: false })} />);

    expect(screen.queryByLabelText("Cycle name")).toBeNull();
    expect(document.querySelector(".editor-panel-body")).toBeNull();
  });

  it("keeps cycle-name typing local and commits once on blur", () => {
    const onNameChange = vi.fn();
    render(<SectionBoundariesPanel {...makeProps({ onNameChange })} />);
    const input = screen.getByLabelText("Cycle name");

    fireEvent.change(input, { target: { value: "Long cycle" } });
    expect(onNameChange).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onNameChange).toHaveBeenCalledTimes(1);
    expect(onNameChange).toHaveBeenCalledWith("Long cycle");
  });

  it("cancels an uncommitted cycle-name edit with Escape", () => {
    const onNameChange = vi.fn();
    render(<SectionBoundariesPanel {...makeProps({ onNameChange })} />);
    const input = screen.getByLabelText("Cycle name");

    fireEvent.change(input, { target: { value: "Discard me" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onNameChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("Adi");
  });
});
