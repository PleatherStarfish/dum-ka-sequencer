// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MidiDestination } from "../bridge";
import { SetupDialog, type SetupDialogProps } from "./SetupDialog";

afterEach(cleanup);

const iac: MidiDestination = { id: "-673416519", name: "IAC Driver Bus 1" };
const synth: MidiDestination = { id: "12345", name: "Hardware Synth" };

function props(overrides: Partial<SetupDialogProps> = {}): SetupDialogProps {
  return {
    autoloadRecentSession: true,
    autosaveEnabled: true,
    autosaveIntervalMs: 3000,
    channelHocketEnabled: false,
    channelHocketMatrixChannels: [],
    currentPatchFingerprintRef: createRef<string>() as never,
    currentPatchPath: null,
    handleExportScore: vi.fn(async () => {}),
    handleMidiDestinationPick: vi.fn(async () => {}),
    handleMidiRescan: vi.fn(async () => {}),
    handlePanic: vi.fn(async () => {}),
    handleSavePatchAs: vi.fn(async () => {}),
    handleSynthToggle: vi.fn(async () => {}),
    lastAutosaveAt: null,
    lastAutosavedFingerprintRef: createRef<string>() as never,
    markPersistenceForFingerprint: vi.fn(),
    midiDebugOpen: false,
    midiDestinations: [iac, synth],
    midiOutputChannel: 1,
    midiRouteStatus: { desired: null, connected: false, lastError: null },
    patchPersistenceState: "saved",
    setAutoloadRecentSession: vi.fn(),
    setAutosaveIntervalMs: vi.fn(),
    setError: vi.fn(),
    setLastAutosaveAt: vi.fn(),
    setMainEditorOpen: vi.fn(),
    setMidiDebugOpen: vi.fn(),
    setMidiOutputChannel: vi.fn(),
    setSetupOpen: vi.fn(),
    setSetupTab: vi.fn(),
    setSynthPropertiesOpen: vi.fn(),
    setupOpen: true,
    setupTab: "midi",
    synthEnabled: false,
    synthMelodicCount: 0,
    synthPending: false,
    synthPercussionCount: 0,
    updateAutosaveEnabled: vi.fn(),
    ...overrides,
  };
}

describe("SetupDialog MIDI tab", () => {
  it("lists virtual-only plus every present destination", () => {
    render(<SetupDialog {...props()} />);
    const select = screen.getByLabelText("MIDI destination") as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toEqual(["", iac.id, synth.id]);
    expect(select.value).toBe("");
    // The port readout uses the real virtual-source name.
    expect(screen.getByText("Dum-Ka MIDI")).toBeTruthy();
  });

  it("injects a selectable missing entry and shows the not-found status", () => {
    render(
      <SetupDialog
        {...props({
          midiDestinations: [synth],
          midiRouteStatus: { desired: iac, connected: false, lastError: null },
        })}
      />
    );
    const select = screen.getByLabelText("MIDI destination") as HTMLSelectElement;
    expect(
      Array.from(select.options).map((option) => option.textContent)
    ).toContain("IAC Driver Bus 1 (not found)");
    expect(select.value).toBe(iac.id);
    expect(
      screen.getByText(/IAC Driver Bus 1 not found — virtual port only/)
    ).toBeTruthy();
  });

  it("routes a pick to the handler, not local state", () => {
    const handleMidiDestinationPick = vi.fn(async () => {});
    render(<SetupDialog {...props({ handleMidiDestinationPick })} />);
    fireEvent.change(screen.getByLabelText("MIDI destination"), {
      target: { value: iac.id },
    });
    expect(handleMidiDestinationPick).toHaveBeenCalledWith(iac.id);
  });

  it("wires rescan and MIDI panic to their handlers", () => {
    const handleMidiRescan = vi.fn(async () => {});
    const handlePanic = vi.fn(async () => {});
    render(<SetupDialog {...props({ handleMidiRescan, handlePanic })} />);
    fireEvent.click(screen.getByRole("button", { name: "rescan" }));
    expect(handleMidiRescan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "MIDI panic" }));
    expect(handlePanic).toHaveBeenCalledTimes(1);
  });

  it("shows the connected status when a destination is live", () => {
    render(
      <SetupDialog
        {...props({
          midiRouteStatus: { desired: synth, connected: true, lastError: null },
        })}
      />
    );
    expect(screen.getByText("Also sending to Hardware Synth.")).toBeTruthy();
  });
});
