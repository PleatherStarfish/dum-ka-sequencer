/**
 * The automation debug panel: collapsible table of recent beat-quantized
 * automation states. Extracted from App.tsx (carve-up round 11) along the
 * panel seam — state stays in App and arrives via props.
 */
import type { AutomationPlaybackEvent } from "../bridge";
import {
  normalizeAutomationDebugLimit,
  AUTOMATION_DEBUG_LIMIT_OPTIONS,
} from "../patchIo";
import { automationTargetDef, type AutomationTargetDef } from "../automationTargets";
import {
  automationPlaybackPhaseLabel,
  formatAutomationPlaybackValue,
} from "./TimelineLanes";
import { PanelStatusChips } from "./MainEditorChrome";
import type { PanelStatusEntry } from "./WeightEditors";

export interface AutomationDebugPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limit: number;
  onLimitChange: (limit: number) => void;
  statusItems: PanelStatusEntry[];
  events: AutomationPlaybackEvent[];
  targetDefs: AutomationTargetDef[];
}

export function AutomationDebugPanel({
  open,
  onOpenChange,
  limit,
  onLimitChange,
  statusItems,
  events,
  targetDefs,
}: AutomationDebugPanelProps) {
  // A closed native <details> still leaves its React subtree mounted. Avoid
  // slicing, reversing, and mapping the potentially large telemetry buffer
  // until the user actually opens the inspector.
  const visibleCount = Math.min(limit, events.length);
  const visibleEvents = open ? events.slice(-limit).reverse() : [];
  return (
      <section
        className="midi-debug-panel automation-debug-panel"
        aria-label="Automation playback debug"
      >
        <details
          className="panel-state panel-state-automation"
          open={open}
          onToggle={(event) => onOpenChange(event.currentTarget.open)}
        >
          <summary>
            <span className="summary-copy">Automation playback</span>
            <em>
              showing {visibleCount} of{" "}
              {events.length} beat states
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
                      onLimitChange(
                        normalizeAutomationDebugLimit(Number(event.target.value))
                      )
                    }
                  >
                    {AUTOMATION_DEBUG_LIMIT_OPTIONS.map((limit) => (
                      <option key={limit} value={limit}>
                        {limit}
                      </option>
                    ))}
                  </select>
                </label>
                <span>records one row per played beat with active automation</span>
              </div>
              {visibleEvents.length ? (
                <div className="midi-debug-table-wrap automation-debug-table-wrap">
                  <table className="midi-debug-table automation-debug-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>cycle</th>
                    <th>beat</th>
                    <th>tick</th>
                    <th>phase</th>
                    <th>states</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map((event) => (
                    <tr key={event.sequence}>
                      <td>{event.sequence}</td>
                      <td>{event.cycle}</td>
                      <td>{event.beatIndex + 1}</td>
                      <td>{event.tickInCycle}</td>
                      <td>{automationPlaybackPhaseLabel(event)}</td>
                      <td>
                        <div className="automation-debug-states">
                          {event.values.map((state) => {
                            const def = automationTargetDef(
                              state.target,
                              targetDefs
                            );
                            return (
                              <span
                                className="automation-debug-state"
                                key={`${event.sequence}-${state.target}`}
                                title={state.target}
                              >
                                <strong>{def.label}</strong>
                                <em>
                                  {formatAutomationPlaybackValue(
                                    state.target,
                                    state.value,
                                    targetDefs
                                  )}
                                </em>
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                  </table>
                </div>
              ) : (
                <p>No automation states have been sampled during playback yet.</p>
              )}
            </>
          ) : null}
        </details>
      </section>
  );
}
