// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));
import type { AutomationPlaybackEvent, MidiDebugEvent } from "../bridge";
import { AutomationDebugPanel } from "./AutomationDebugPanel";
import { MidiDebugPanel } from "./MidiDebugPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const midiEvent = (sequence: number): MidiDebugEvent => ({
  sequence,
  absoluteTick: sequence,
  cycle: 0,
  tickInCycle: sequence,
  channel: 1,
  messageType: "noteOn",
  data1: 60,
  data2: 96,
  bytes: [0x90, 60, 96],
  debugSource: null,
  monitorBus: null,
  monitorUserChannel: null,
  monitorMode: null,
  monitorProgram: null,
  monitorDrumNote: null,
  monitorBytes: null,
  parallelTrackId: null,
  parallelTrackName: null,
  parallelConflictPolicy: null,
  parallelConflictAction: null,
  parallelConflictGroupId: null,
});

const automationEvent = (sequence: number): AutomationPlaybackEvent => ({
  sequence,
  cycle: 0,
  beatIndex: sequence,
  tickInCycle: sequence * 960,
  automationPhase: { numer: sequence, denom: 1 },
  values: [],
});

describe("deferred closed-panel work", () => {
  it("does not construct MIDI debug rows until the inspector opens", () => {
    const props = {
      onOpenChange: vi.fn(),
      limit: 100,
      onLimitChange: vi.fn(),
      activeTrackOnly: false,
      onActiveTrackOnlyChange: vi.fn(),
      showTrackFilter: false,
      statusItems: [],
      visibleEvents: [midiEvent(1)],
      filteredCount: 1,
    };
    const view = render(<MidiDebugPanel {...props} open={false} />);

    expect(screen.getByText("showing 1 of 1 messages")).toBeTruthy();
    expect(screen.queryByText("buffer keeps up to 1000 messages")).toBeNull();
    expect(screen.queryByText("0x90 0x3C 0x60")).toBeNull();

    view.rerender(<MidiDebugPanel {...props} open />);
    expect(screen.getByText("buffer keeps up to 1000 messages")).toBeTruthy();
    expect(screen.getByText("0x90 0x3C 0x60")).toBeTruthy();
  });

  it("keeps the automation count while deferring the reversed row view", () => {
    const props = {
      onOpenChange: vi.fn(),
      limit: 2,
      onLimitChange: vi.fn(),
      statusItems: [],
      events: [automationEvent(1), automationEvent(2), automationEvent(3)],
      targetDefs: [],
    };
    const view = render(<AutomationDebugPanel {...props} open={false} />);

    expect(screen.getByText(/showing 2 of\s+3 beat states/)).toBeTruthy();
    expect(screen.queryByText("records one row per played beat with active automation")).toBeNull();

    view.rerender(<AutomationDebugPanel {...props} open />);
    expect(screen.getByText("records one row per played beat with active automation")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});
