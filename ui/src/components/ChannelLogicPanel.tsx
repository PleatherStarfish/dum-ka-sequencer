/**
 * Channel Logic panel (B0/B1). Reads top-to-bottom as the resolver runs: a
 * sentence naming the default, an overlap pictogram, the per-pair rule list
 * (subject → scope → verb), the priority order when any mode uses it, and a
 * per-channel "effective policy" footer. Pure/presentational — all state and
 * mutation live in App via the callback props. Vocabulary comes from
 * `POLICY_METADATA` (one label per policy). No Play-blocking: conflicting rules
 * are made unrepresentable upstream (D4).
 */
import type { CSSProperties } from "react";

import type { ChannelConflictPolicy } from "../patchIo";
import {
  CHANNEL_LOGIC_DEFAULT_OPTIONS,
  CHANNEL_LOGIC_HELP_MODES,
  CHANNEL_LOGIC_RULE_OPTIONS,
  channelConflictPolicyLabel,
  type ChannelLogicOverrideRow,
  type EffectiveChannelSummary,
  type ParallelPriorityRow,
} from "../channelLogic";

export type ChannelLogicTrackOption = { id: string; label: string };

export type ChannelLogicPanelProps = {
  defaultPolicy: ChannelConflictPolicy;
  overrideRows: ChannelLogicOverrideRow[];
  effectiveSummaries: EffectiveChannelSummary[];
  trackOptions: ChannelLogicTrackOption[];
  priorityRows: ParallelPriorityRow[];
  showPriority: boolean;
  priorityUsedBy: string;
  helpOpen: boolean;
  hasAvailablePair: boolean;
  addDisabledReason: string;
  onSetDefaultPolicy: (policy: ChannelConflictPolicy) => void;
  onSetGroupPolicy: (
    row: ChannelLogicOverrideRow,
    nextPolicy: ChannelConflictPolicy
  ) => void;
  onToggleChannel: (
    row: ChannelLogicOverrideRow,
    channel: number,
    selected: boolean
  ) => void;
  onSetGroupTrack: (
    row: ChannelLogicOverrideRow,
    side: "a" | "b",
    trackId: string
  ) => void;
  onAddPair: () => void;
  onRemoveGroup: (row: ChannelLogicOverrideRow) => void;
  onToggleHelp: () => void;
  onMovePriority: (trackId: string, direction: -1 | 1) => void;
};

/** Flat two-lane pictogram: two spans crossing (a collision) vs. adjacent. */
function OverlapPictogram() {
  return (
    <svg
      className="channel-logic-pictogram"
      viewBox="0 0 120 26"
      role="img"
      aria-label="Overlap means two sustained note spans cross on the same channel, not that they merely share a start."
      focusable="false"
    >
      {/* colliding pair (highlighted) */}
      <rect className="clp-bar clp-bar-hit" x="4" y="3" width="44" height="7" rx="2" />
      <rect className="clp-bar clp-bar-hit" x="28" y="15" width="44" height="7" rx="2" />
      {/* adjacent (touching, not colliding) */}
      <rect className="clp-bar" x="80" y="9" width="16" height="7" rx="2" />
      <rect className="clp-bar" x="98" y="9" width="16" height="7" rx="2" />
    </svg>
  );
}

export function ChannelLogicPanel(props: ChannelLogicPanelProps) {
  const {
    defaultPolicy,
    overrideRows,
    effectiveSummaries,
    trackOptions,
    priorityRows,
    showPriority,
    priorityUsedBy,
    helpOpen,
    hasAvailablePair,
    addDisabledReason,
  } = props;

  return (
    <section
      className="parallel-logic-panel global-channel-logic-panel"
      aria-label="Project channel logic"
    >
      <div className="parallel-logic-head channel-logic-head">
        <div className="channel-logic-sentence">
          <div className="parallel-logic-title-row">
            <strong>Channel logic</strong>
            <button
              className="help-icon-button parallel-logic-help-button"
              type="button"
              aria-label={
                helpOpen
                  ? "Hide channel logic mode reference"
                  : "Show channel logic mode reference"
              }
              aria-expanded={helpOpen}
              aria-controls="channel-logic-help"
              title="Show channel logic mode reference"
              onClick={props.onToggleHelp}
            >
              i
            </button>
          </div>
          <label className="channel-logic-default-line">
            <span>When notes overlap on the same MIDI channel:</span>
            <select
              aria-label="Default channel logic"
              value={defaultPolicy}
              onChange={(event) =>
                props.onSetDefaultPolicy(event.target.value as ChannelConflictPolicy)
              }
            >
              {CHANNEL_LOGIC_DEFAULT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="channel-logic-overlap-note">
            <OverlapPictogram />
            <small>overlap = sustained spans crossing, not shared starts</small>
          </div>
        </div>
      </div>

      {helpOpen ? (
        <div
          id="channel-logic-help"
          className="parallel-logic-help-card"
          role="region"
          aria-label="Channel logic mode reference"
        >
          <section className="parallel-logic-help-primer">
            <strong>How channel logic is evaluated</strong>
            <ul>
              <li>
                A collision is two or more final notes overlapping in sustain on
                one MIDI channel — notes that only touch at an end point are
                adjacent, not colliding.
              </li>
              <li>
                The default mode governs every collision; a pair rule overrides
                the default for its two tracks on its channels.
              </li>
              <li>
                Winners derive from the collision&rsquo;s position, so a locked
                seed replays identically.
              </li>
            </ul>
          </section>
          <div className="parallel-logic-help-modes">
            {CHANNEL_LOGIC_HELP_MODES.map((mode) => (
              <article key={mode.policy}>
                <h4>
                  {mode.label}
                  {mode.technicalName.toLowerCase() !== mode.label.toLowerCase() ? (
                    <span className="clp-technical"> ({mode.technicalName})</span>
                  ) : null}
                </h4>
                <strong>{mode.summary}</strong>
                <p>{mode.detail}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="channel-logic-rules-head">
        <span>Pair rules (override the default for a pair)</span>
        <button
          className="parallel-logic-add"
          type="button"
          onClick={props.onAddPair}
          disabled={!hasAvailablePair}
          title={hasAvailablePair ? "Add a pair rule" : addDisabledReason}
        >
          + Add rule
        </button>
      </div>

      {overrideRows.length > 0 ? (
        <div className="parallel-logic-rules" aria-label="Channel logic rules">
          {overrideRows.map((row, index) => {
            const isDefault = row.policy === defaultPolicy;
            return (
              <div
                className={`parallel-logic-rule${
                  row.sharedChannels.length ? "" : " is-disjoint"
                }`}
                key={row.id}
                title={row.channelTitle}
              >
                <select
                  aria-label={`Channel logic rule ${index + 1} first track`}
                  value={row.trackAId}
                  onChange={(event) =>
                    props.onSetGroupTrack(row, "a", event.target.value)
                  }
                >
                  {trackOptions.map((track) => (
                    <option
                      key={track.id}
                      value={track.id}
                      disabled={track.id === row.trackBId}
                    >
                      {track.label}
                    </option>
                  ))}
                </select>
                <span className="parallel-logic-link" aria-hidden="true">
                  ↔
                </span>
                <select
                  aria-label={`Channel logic rule ${index + 1} second track`}
                  value={row.trackBId}
                  onChange={(event) =>
                    props.onSetGroupTrack(row, "b", event.target.value)
                  }
                >
                  {trackOptions.map((track) => (
                    <option
                      key={track.id}
                      value={track.id}
                      disabled={track.id === row.trackAId}
                    >
                      {track.label}
                    </option>
                  ))}
                </select>
                <span className="channel-logic-rule-on" aria-hidden="true">
                  on
                </span>
                <div
                  className="parallel-logic-channel-picker"
                  aria-label={`Channel logic rule ${index + 1} channels`}
                  role="group"
                >
                  {row.includesAllShared ? (
                    <span
                      className="parallel-logic-channel-chip is-selected"
                      title="Applies to all currently shared MIDI channels"
                    >
                      All shared
                    </span>
                  ) : null}
                  {row.channelOptions.map((option) => (
                    <button
                      key={option.channel}
                      className={`parallel-logic-channel-chip${
                        option.selected ? " is-selected" : ""
                      }${option.active ? "" : " is-idle"}`}
                      type="button"
                      disabled={row.includesAllShared || option.disabled}
                      aria-pressed={option.selected}
                      aria-label={`Channel logic rule ${index + 1} Ch ${
                        option.channel
                      }${option.selected ? " selected" : ""}${
                        option.active ? "" : ` inactive: ${option.reason}`
                      }`}
                      title={
                        option.active ? `Ch ${option.channel} can overlap now` : option.reason
                      }
                      onClick={() =>
                        props.onToggleChannel(row, option.channel, option.selected)
                      }
                    >
                      <span>Ch {option.channel}</span>
                      {option.active ? null : <em>idle</em>}
                    </button>
                  ))}
                  <small className="channel-logic-scope-summary">
                    {row.selectedLabel}
                  </small>
                </div>
                <span className="channel-logic-rule-arrow" aria-hidden="true">
                  →
                </span>
                <select
                  aria-label={`Channel logic rule ${index + 1} operator`}
                  value={row.policy}
                  onChange={(event) =>
                    props.onSetGroupPolicy(
                      row,
                      event.target.value as ChannelConflictPolicy
                    )
                  }
                >
                  {CHANNEL_LOGIC_RULE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {isDefault ? (
                  <span
                    className="channel-logic-default-tag"
                    title="This rule matches the project default."
                  >
                    = default
                  </span>
                ) : null}
                <button
                  className="parallel-logic-remove"
                  type="button"
                  aria-label={`Remove channel logic rule ${index + 1}`}
                  title={`Remove ${row.titleA} to ${row.titleB} rule`}
                  onClick={() => props.onRemoveGroup(row)}
                >
                  −
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="channel-logic-empty">
          {hasAvailablePair
            ? "No pair rules — every shared channel uses the default."
            : addDisabledReason}
        </p>
      )}

      {showPriority && priorityRows.length > 1 ? (
        <div
          className="parallel-priority-field channel-logic-priority"
          aria-label="Priority order"
        >
          <span>Priority order · used by {priorityUsedBy}</span>
          <ol>
            {priorityRows.map((track) => (
              <li
                key={track.id}
                style={{ "--track-color": track.color } as CSSProperties}
                data-testid={`parallel-priority-${track.id}`}
              >
                <b>{track.priorityIndex + 1}</b>
                <em
                  title={`${track.label}${
                    track.customName ? ` · ${track.customName}` : ""
                  }`}
                >
                  {track.label}
                  {track.customName ? <small>{track.customName}</small> : null}
                </em>
                <button
                  className="parallel-priority-step"
                  type="button"
                  aria-label={`Raise ${track.label} priority`}
                  title="Raise priority"
                  disabled={track.priorityIndex === 0}
                  data-testid={`parallel-priority-${track.id}-up`}
                  onClick={() => props.onMovePriority(track.id, -1)}
                >
                  up
                </button>
                <button
                  className="parallel-priority-step"
                  type="button"
                  aria-label={`Lower ${track.label} priority`}
                  title="Lower priority"
                  disabled={track.priorityIndex === priorityRows.length - 1}
                  data-testid={`parallel-priority-${track.id}-down`}
                  onClick={() => props.onMovePriority(track.id, 1)}
                >
                  down
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {effectiveSummaries.length > 0 ? (
        <div
          className="channel-logic-effective"
          aria-label="Effective channel logic by MIDI channel"
        >
          {effectiveSummaries.map((summary) => (
            <div className="channel-logic-effective-row" key={summary.channel}>
              <b>Ch {summary.channel}</b>
              {summary.ruleParts.length > 0 ? (
                <span>
                  {summary.ruleParts
                    .map(
                      (part) =>
                        `${part.label} ${channelConflictPolicyLabel(part.policy)}`
                    )
                    .join(" · ")}
                  {" · else "}
                  {channelConflictPolicyLabel(summary.defaultPolicy)}
                </span>
              ) : (
                <span>{channelConflictPolicyLabel(summary.defaultPolicy)}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
