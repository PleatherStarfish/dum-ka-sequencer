/**
 * The MIDI out debug panel: collapsible table of recently dispatched MIDI
 * messages with row limit and active-track filtering. Extracted from App.tsx
 * (carve-up round 10) along the panel seam — all state stays in App and
 * arrives via props.
 */
import type { MidiDebugEvent } from "../bridge";
import { normalizeMidiDebugLimit, MIDI_DEBUG_LIMIT_OPTIONS } from "../patchIo";
import {
  isAllNotesOffEvent,
  midiByteHex,
  midiDataSummary,
  midiMessageLabel,
  midiMonitorSummary,
  midiParallelConflictSummary,
  midiParallelTrackSummary,
} from "../midiDebugFormat";
import { PanelStatusChips } from "./MainEditorChrome";
import type { PanelStatusEntry } from "./WeightEditors";

import { Switch } from "../Switch";
export interface MidiDebugPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limit: number;
  onLimitChange: (limit: number) => void;
  activeTrackOnly: boolean;
  onActiveTrackOnlyChange: (value: boolean) => void;
  /** True when more than one track is audible (shows the track filter). */
  showTrackFilter: boolean;
  statusItems: PanelStatusEntry[];
  visibleEvents: MidiDebugEvent[];
  filteredCount: number;
}

export function MidiDebugPanel({
  open,
  onOpenChange,
  limit,
  onLimitChange,
  activeTrackOnly,
  onActiveTrackOnlyChange,
  showTrackFilter,
  statusItems,
  visibleEvents,
  filteredCount,
}: MidiDebugPanelProps) {
  return (
      <section className="midi-debug-panel" aria-label="MIDI out debug">
        <details
          className="panel-state panel-state-midi"
          open={open}
          onToggle={(event) => onOpenChange(event.currentTarget.open)}
        >
          <summary>
            <span className="summary-copy">MIDI out</span>
            <em>
              showing {Math.min(limit, filteredCount)} of {filteredCount} messages
            </em>
            <PanelStatusChips items={statusItems} />
          </summary>
          {open ? (
            <>
              <div className="midi-debug-toolbar">
                <label>
                  <span>Rows</span>
                  <select
                    value={limit}
                    onChange={(event) =>
                      onLimitChange(normalizeMidiDebugLimit(Number(event.target.value)))
                    }
                  >
                    {MIDI_DEBUG_LIMIT_OPTIONS.map((limit) => (
                      <option key={limit} value={limit}>
                        {limit}
                      </option>
                    ))}
                  </select>
                </label>
                {showTrackFilter ? (
                  <Switch
                    size="sm"
                    isSelected={activeTrackOnly}
                    onChange={onActiveTrackOnlyChange}
                    title="Show only MIDI dispatched for the active track (plus untagged rows). Lets you compare the active track's timeline against what it actually sent."
                  >
                    <span>Active track only</span>
                  </Switch>
                ) : null}
                <span>buffer keeps up to 1000 messages</span>
              </div>
              {visibleEvents.length ? (
                <div className="midi-debug-table-wrap">
                  <table className="midi-debug-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>cycle</th>
                    <th>tick</th>
                    <th>ch</th>
                    <th>message</th>
                    <th>track</th>
                    <th>source</th>
                    <th>conflict</th>
                    <th>group</th>
                    <th>data</th>
                    <th>monitor</th>
                    <th>bytes</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map((event) => (
                    <tr
                      className={isAllNotesOffEvent(event) ? "is-midi-cleanup" : undefined}
                      key={event.sequence}
                    >
                      <td>{event.sequence}</td>
                      <td>{event.cycle}</td>
                      <td>{event.tickInCycle}</td>
                      <td>{event.channel ?? "sys"}</td>
                      <td>{midiMessageLabel(event)}</td>
                      <td>{midiParallelTrackSummary(event)}</td>
                      <td>{event.debugSource ?? "-"}</td>
                      <td>{midiParallelConflictSummary(event)}</td>
                      <td>{event.parallelConflictGroupId ?? "-"}</td>
                      <td>{midiDataSummary(event) || "-"}</td>
                      <td>{midiMonitorSummary(event)}</td>
                      <td>
                        {event.bytes.map((byte) => `0x${midiByteHex(byte)}`).join(" ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
                  </table>
                </div>
              ) : (
                <p>No MIDI messages have been sent yet.</p>
              )}
            </>
          ) : null}
        </details>
      </section>
  );
}
