/**
 * MIDI debug table formatting: byte/message/monitor/track summaries for
 * debug log rows. Extracted verbatim from App.tsx (carve-up round 8). Pure.
 */
import {
  MidiDebugEvent,
  ParallelConflictDebugEvent,
} from "./bridge";
import {
  synthDrumLabel,
  synthProgramLabel,
} from "./synthVoices";
export function midiByteHex(byte: number): string {
  return byte.toString(16).padStart(2, "0").toUpperCase();
}

export function isAllNotesOffEvent(event: MidiDebugEvent): boolean {
  return (
    event.messageType === "controlChange" &&
    event.data1 === 123 &&
    event.data2 === 0
  );
}

export function midiMessageLabel(event: MidiDebugEvent): string {
  if (isAllNotesOffEvent(event)) {
    return "all notes off";
  }
  switch (event.messageType) {
    case "noteOn":
      return "note on";
    case "noteOff":
      return "note off";
    case "controlChange":
      return "cc";
    case "programChange":
      return "program";
    case "channelPressure":
      return "pressure";
    case "polyPressure":
      return "poly pressure";
    case "pitchBend":
      return "bend";
    default:
      return event.messageType;
  }
}

export function midiDataSummary(event: MidiDebugEvent): string {
  if (isAllNotesOffEvent(event)) {
    return "transport cleanup · not hocket";
  }
  if (event.messageType === "noteOn" || event.messageType === "noteOff") {
    return `note ${event.data1 ?? "-"} · vel ${event.data2 ?? "-"}`;
  }
  if (event.messageType === "controlChange") {
    return `cc ${event.data1 ?? "-"} · value ${event.data2 ?? "-"}`;
  }
  return [event.data1, event.data2]
    .filter((value): value is number => value !== null)
    .map((value) => String(value))
    .join(" · ");
}

export function midiMonitorSummary(event: MidiDebugEvent): string {
  if (isAllNotesOffEvent(event)) {
    return "external reset";
  }
  if (!event.monitorMode || event.monitorUserChannel == null) {
    return "-";
  }

  const voice =
    event.monitorMode === "percussion"
      ? `Ch ${event.monitorUserChannel} · ${synthDrumLabel(event.monitorDrumNote ?? 36)}`
      : `Ch ${event.monitorUserChannel} · ${synthProgramLabel(event.monitorProgram ?? 0)}`;
  const bus =
    event.monitorBus?.startsWith("userChannel")
      ? `bus ch ${event.monitorBus.slice("userChannel".length)}`
      : event.monitorBus;
  return bus ? `${voice} · ${bus}` : voice;
}

export function fallbackParallelTrackLabel(trackId: string | null | undefined): string {
  return trackId?.trim() || "-";
}

export function midiParallelTrackSummary(event: MidiDebugEvent): string {
  if (!event.parallelTrackId && !event.parallelTrackName) {
    return "-";
  }
  const trackId = event.parallelTrackId ?? "";
  const trackName = event.parallelTrackName?.trim();
  return trackName ? `${trackName} · ${trackId}` : fallbackParallelTrackLabel(trackId);
}

export function midiParallelConflictSummary(event: MidiDebugEvent): string {
  if (!event.parallelConflictPolicy && !event.parallelConflictAction) {
    return "-";
  }
  return [event.parallelConflictPolicy, event.parallelConflictAction]
    .filter(Boolean)
    .join(" · ");
}

export function parallelConflictTrackSummary(event: ParallelConflictDebugEvent): string {
  const trackName = event.trackName.trim();
  return trackName ? `${trackName} · ${event.trackId}` : event.trackId;
}

export function parallelConflictPeerSummary(event: ParallelConflictDebugEvent): string {
  return event.collidingTrackIds.length
    ? event.collidingTrackIds.join(" · ")
    : `${event.activeTrackCount} active`;
}
