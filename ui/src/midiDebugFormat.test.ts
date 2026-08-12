import { describe, expect, it } from "vitest";

import type { MidiDebugEvent, ParallelConflictDebugEvent } from "./bridge";
import {
  fallbackParallelTrackLabel,
  isAllNotesOffEvent,
  midiByteHex,
  midiDataSummary,
  midiMessageLabel,
  midiMonitorSummary,
  midiParallelConflictSummary,
  midiParallelTrackSummary,
  parallelConflictPeerSummary,
  parallelConflictTrackSummary,
} from "./midiDebugFormat";

function event(partial: Partial<MidiDebugEvent>): MidiDebugEvent {
  return {
    sequence: 0,
    absoluteTick: 0,
    cycle: 0,
    tickInCycle: 0,
    channel: 0,
    messageType: "noteOn",
    data1: null,
    data2: null,
    bytes: [],
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
    ...partial,
  };
}

describe("midiByteHex", () => {
  it("formats bytes as two-digit uppercase hex", () => {
    expect(midiByteHex(0)).toBe("00");
    expect(midiByteHex(144)).toBe("90");
    expect(midiByteHex(255)).toBe("FF");
  });
});

describe("isAllNotesOffEvent / midiMessageLabel", () => {
  it("detects the all-notes-off control change", () => {
    expect(
      isAllNotesOffEvent(
        event({ messageType: "controlChange", data1: 123, data2: 0 })
      )
    ).toBe(true);
    expect(isAllNotesOffEvent(event({ messageType: "noteOn" }))).toBe(false);
  });

  it("labels message types, including all-notes-off and unknowns", () => {
    expect(midiMessageLabel(event({ messageType: "noteOn" }))).toBe("note on");
    expect(midiMessageLabel(event({ messageType: "noteOff" }))).toBe("note off");
    expect(midiMessageLabel(event({ messageType: "controlChange" }))).toBe("cc");
    expect(midiMessageLabel(event({ messageType: "programChange" }))).toBe(
      "program"
    );
    expect(midiMessageLabel(event({ messageType: "pitchBend" }))).toBe("bend");
    expect(
      midiMessageLabel(
        event({ messageType: "controlChange", data1: 123, data2: 0 })
      )
    ).toBe("all notes off");
    expect(midiMessageLabel(event({ messageType: "sysex" }))).toBe("sysex");
  });
});

describe("midiDataSummary", () => {
  it("summarizes per message type", () => {
    expect(
      midiDataSummary(event({ messageType: "noteOn", data1: 60, data2: 96 }))
    ).toBe("note 60 · vel 96");
    expect(
      midiDataSummary(event({ messageType: "controlChange", data1: 7, data2: 100 }))
    ).toBe("cc 7 · value 100");
    expect(
      midiDataSummary(event({ messageType: "programChange", data1: 5, data2: null }))
    ).toBe("5");
    expect(
      midiDataSummary(event({ messageType: "controlChange", data1: 123, data2: 0 }))
    ).toBe("transport cleanup · not hocket");
  });
});

describe("midiMonitorSummary", () => {
  it("handles the empty and reset cases", () => {
    expect(midiMonitorSummary(event({}))).toBe("-");
    expect(
      midiMonitorSummary(
        event({ messageType: "controlChange", data1: 123, data2: 0 })
      )
    ).toBe("external reset");
  });

  it("describes a monitored voice with its channel", () => {
    const summary = midiMonitorSummary(
      event({ monitorMode: "melodic", monitorUserChannel: 1, monitorProgram: 0 })
    );
    expect(summary).toContain("Ch 1 ·");
  });
});

describe("parallel track / conflict summaries", () => {
  it("labels parallel track presence", () => {
    expect(fallbackParallelTrackLabel("  ")).toBe("-");
    expect(fallbackParallelTrackLabel("alpha")).toBe("alpha");
    expect(midiParallelTrackSummary(event({}))).toBe("-");
    expect(
      midiParallelTrackSummary(
        event({ parallelTrackId: "a1", parallelTrackName: "Alpha" })
      )
    ).toBe("Alpha · a1");
    expect(
      midiParallelTrackSummary(event({ parallelTrackId: "a1" }))
    ).toBe("a1");
  });

  it("labels conflict policy/action", () => {
    expect(midiParallelConflictSummary(event({}))).toBe("-");
    expect(
      midiParallelConflictSummary(
        event({ parallelConflictPolicy: "xor", parallelConflictAction: "drop" })
      )
    ).toBe("xor · drop");
  });

  it("summarizes a conflict debug event", () => {
    const conflict: ParallelConflictDebugEvent = {
      sequence: 1,
      absoluteTick: 0,
      cycle: 0,
      tickInCycle: 0,
      outputChannel: 1,
      pitch: 60,
      startTick: 0,
      endTick: 1,
      trackId: "beta",
      trackName: "Beta",
      trackIndex: 1,
      conflictPolicy: "xor",
      conflictAction: "suppress",
      conflictGroupId: "g1",
      collidingTrackIds: ["alpha", "gamma"],
      activeTrackCount: 3,
      passed: false,
    };
    expect(parallelConflictTrackSummary(conflict)).toBe("Beta · beta");
    expect(parallelConflictPeerSummary(conflict)).toBe("alpha · gamma");
    expect(
      parallelConflictPeerSummary({ ...conflict, collidingTrackIds: [] })
    ).toBe("3 active");
  });
});
