// @vitest-environment jsdom
/**
 * Behavioral spec for the extracted Channel Logic panel (B0/B1). Mounts the
 * component directly with fixture props (no App, no Tauri) and asserts the
 * B1 structure: sentence header, rule sentences, "= default" tag, priority
 * relocation, effective-policy footer, one vocabulary, and no Play-block.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildChannelLogicOverrideRows, type ChannelLogicOverrideRow } from "../channelLogic";
import { ChannelLogicPanel, type ChannelLogicPanelProps } from "./ChannelLogicPanel";

afterEach(cleanup);

const trackTabs = [
  {
    id: "track-1",
    name: "",
    midiChannels: [1, 2],
    inspectableMidiChannels: [1, 2],
    channelHocketEnabled: false,
  },
  {
    id: "track-2",
    name: "",
    midiChannels: [1, 2],
    inspectableMidiChannels: [1, 2],
    channelHocketEnabled: false,
  },
];

function rows(entries: Parameters<typeof buildChannelLogicOverrideRows>[0]): ChannelLogicOverrideRow[] {
  return buildChannelLogicOverrideRows(entries, trackTabs);
}

function renderPanel(overrides: Partial<ChannelLogicPanelProps> = {}) {
  const props: ChannelLogicPanelProps = {
    defaultPolicy: "randomOne",
    overrideRows: [],
    effectiveSummaries: [
      { channel: 1, ruleParts: [], defaultPolicy: "randomOne" },
    ],
    trackOptions: [
      { id: "track-1", label: "Track 1" },
      { id: "track-2", label: "Track 2" },
    ],
    priorityRows: [],
    showPriority: false,
    priorityUsedBy: "the default",
    helpOpen: false,
    hasAvailablePair: true,
    addDisabledReason: "",
    onSetDefaultPolicy: vi.fn(),
    onSetGroupPolicy: vi.fn(),
    onToggleChannel: vi.fn(),
    onSetGroupTrack: vi.fn(),
    onAddPair: vi.fn(),
    onRemoveGroup: vi.fn(),
    onToggleHelp: vi.fn(),
    onMovePriority: vi.fn(),
    ...overrides,
  };
  render(<ChannelLogicPanel {...props} />);
  return props;
}

describe("sentence header + default select", () => {
  it("frames the default as a sentence and fires on change", async () => {
    const props = renderPanel();
    expect(screen.getByText(/when notes overlap on the same midi channel/i)).toBeDefined();
    const select = screen.getByLabelText("Default channel logic");
    await userEvent.selectOptions(select, "xor");
    expect(props.onSetDefaultPolicy).toHaveBeenCalledWith("xor");
  });

  it("uses the one vocabulary — no raw ids or boolean-logic names in the option list", () => {
    renderPanel();
    const select = screen.getByLabelText("Default channel logic") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent ?? "");
    expect(labels).toContain("One only");
    expect(labels).not.toContain("XOR");
    expect(labels.join(" ")).not.toMatch(/\ballowAll\b/);
  });
});

describe("rule rows", () => {
  it("renders a rule as subject → scope → verb and tags a default-equal rule", () => {
    renderPanel({
      overrideRows: rows([
        { trackAId: "track-1", trackBId: "track-2", outputChannel: 2, policy: "randomOne" },
      ]),
      defaultPolicy: "randomOne",
    });
    // subject selects
    expect(screen.getByLabelText("Channel logic rule 1 first track")).toBeDefined();
    expect(screen.getByLabelText("Channel logic rule 1 operator")).toBeDefined();
    // the rule's policy equals the default → "= default" tag
    expect(screen.getByText("= default")).toBeDefined();
  });

  it("fires the ownership-move channel toggle with the row and channel", async () => {
    const props = renderPanel({
      overrideRows: rows([
        { trackAId: "track-1", trackBId: "track-2", outputChannel: 2, policy: "forceOff" },
      ]),
    });
    await userEvent.click(
      screen.getByLabelText(/Channel logic rule 1 Ch 1/),
    );
    expect(props.onToggleChannel).toHaveBeenCalledWith(
      expect.objectContaining({ trackAId: "track-1", trackBId: "track-2" }),
      1,
      false,
    );
  });
});

describe("priority relocation (B1.4)", () => {
  it("renders the priority order inside the panel when a mode uses it", () => {
    renderPanel({
      showPriority: true,
      priorityUsedBy: "the default",
      priorityRows: [
        { id: "track-1", label: "Track 1", customName: "", color: "#f00", priorityIndex: 0 },
        { id: "track-2", label: "Track 2", customName: "", color: "#0f0", priorityIndex: 1 },
      ],
    });
    const priority = screen.getByLabelText("Priority order");
    expect(within(priority).getByText(/used by the default/i)).toBeDefined();
    expect(screen.getByTestId("parallel-priority-track-1-down")).toBeDefined();
  });

  it("hides the priority order when no mode uses it", () => {
    renderPanel({ showPriority: false });
    expect(screen.queryByLabelText("Priority order")).toBeNull();
  });
});

describe("effective-policy footer (B1.3)", () => {
  it("shows explicit rules then the default per channel", () => {
    renderPanel({
      effectiveSummaries: [
        { channel: 1, ruleParts: [], defaultPolicy: "randomOne" },
        {
          channel: 2,
          ruleParts: [{ label: "Track 1↔Track 2", policy: "forceOff" }],
          defaultPolicy: "randomOne",
        },
      ],
    });
    const footer = screen.getByLabelText("Effective channel logic by MIDI channel");
    expect(within(footer).getByText(/Track 1↔Track 2 Mute overlap · else Random one/)).toBeDefined();
  });
});

describe("no Play-block (D4)", () => {
  it("renders no conflict/alert banner", () => {
    renderPanel({
      overrideRows: rows([
        { trackAId: "track-1", trackBId: "track-2", outputChannel: 1, policy: "forceOff" },
      ]),
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByLabelText("Channel logic conflicts")).toBeNull();
  });
});
