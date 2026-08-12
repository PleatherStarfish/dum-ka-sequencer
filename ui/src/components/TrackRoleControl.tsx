/**
 * Unified track-role control (compact — see `docs/TRACK_ROLE_UI_PROPOSAL.md`).
 *
 * Replaces the two sibling "Track Flow" + "Trigger" groups with a single role
 * picker: a track is exactly one of Continuous / Triggered / Track Flow. Rendered
 * as a compact segmented control (one row) plus a single live caption line — the
 * caption shows the selected role's one-liner, or the hovered/focused segment's
 * blurb (or its disabled reason), so the explanation costs one line instead of
 * three cards. Only the chosen role's detail shows below.
 *
 * Presentation only. The role and its options are computed by the pure helpers
 * in `trackRole.ts`; `onSelectRole` is wired in `App.tsx` to a single atomic
 * `applyTrackRole` handler (built on `roleTransition` + `applyRoleIntent`), not the
 * existing per-axis handlers. The role-specific detail (the `TriggerInspector`,
 * the box selector) is passed in as a slot, so this component stays decoupled from
 * those internals.
 */
import { useState, type ReactNode } from "react";

import { ROLE_META, type RoleOption, type TrackRole } from "../trackRole";

const DEFAULT_HELP =
  "How this track is activated. Continuous always plays; Triggered and Track " +
  "Flow are two different ways to play only sometimes — Triggered responds to a " +
  "source track's events, Track Flow takes turns inside a group. A Track Flow " +
  "track can neither trigger nor be triggered.";

export interface TrackRoleControlProps {
  /** The active track's current role (from `trackRole(...)`). */
  role: TrackRole;
  /** Per-role selectability (from `roleOptions(...)`). */
  options: RoleOption[];
  /** Select a new role. The caller applies it through the atomic `applyTrackRole`. */
  onSelectRole: (role: TrackRole) => void;
  /** Disable the whole control (e.g. while playback is running). */
  disabled?: boolean;
  /** Radio-group `name`. Pass a unique value if more than one instance can render
   *  at once (the default collides). */
  name?: string;
  /** Override the lead help copy. */
  helpText?: string;
  /** Detail surface shown only under the Triggered role (source picker + inspector). */
  triggeredDetail?: ReactNode;
  /** Detail surface shown only under the Track Flow role (box selector + chain). */
  trackFlowDetail?: ReactNode;
}

export function TrackRoleControl({
  role,
  options,
  onSelectRole,
  disabled = false,
  name = "track-role",
  helpText = DEFAULT_HELP,
  triggeredDetail,
  trackFlowDetail,
}: TrackRoleControlProps) {
  // The caption shows the hovered/focused segment's text when present, else the
  // selected role's blurb — one line instead of a blurb per option.
  const [hint, setHint] = useState<string | null>(null);
  const caption = hint ?? ROLE_META[role].blurb;

  // When roles are unavailable, surface *why* as a single always-visible line (the
  // specific reason for one blocked role, or a combined call-to-action for
  // several) — only rendered in that state, so the common case stays one line.
  const blocked = options.filter((option) => !option.enabled && option.reason);
  const blockedReason =
    blocked.length === 0
      ? null
      : blocked.length === 1
        ? blocked[0]!.reason!
        : `Add another track to enable ${blocked
            .map((option) => ROLE_META[option.role].label)
            .join(" and ")}.`;

  return (
    <fieldset className="track-role" data-testid="track-role">
      <div className="track-role-bar">
        <span className="track-role-legend">
          Role
          <span
            className="track-role-help"
            role="img"
            aria-label={helpText}
            title={helpText}
          >
            ?
          </span>
        </span>
        <div className="track-role-segments" role="radiogroup" aria-label="Track role">
          {options.map((option) => {
            const meta = ROLE_META[option.role];
            const optionDisabled = disabled || !option.enabled;
            const showReason = !option.enabled && Boolean(option.reason);
            const reasonId = `${name}-reason-${option.role}`;
            const tip = showReason ? option.reason! : meta.blurb;
            return (
              <label
                key={option.role}
                className={`track-role-seg${option.current ? " is-current" : ""}${
                  optionDisabled ? " is-disabled" : ""
                }`}
                title={tip}
                onMouseEnter={() => setHint(tip)}
                onMouseLeave={() => setHint(null)}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.role}
                  checked={option.role === role}
                  disabled={optionDisabled}
                  aria-describedby={showReason ? reasonId : undefined}
                  data-testid={`track-role-${option.role}`}
                  onFocus={() => setHint(tip)}
                  onBlur={() => setHint(null)}
                  onChange={() => onSelectRole(option.role)}
                />
                <span className="track-role-seg-label">{meta.label}</span>
                {showReason ? (
                  <span id={reasonId} className="track-role-sr">
                    {option.reason}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      </div>

      <p className="track-role-caption" data-testid="track-role-caption" aria-live="polite">
        {caption}
      </p>
      {blockedReason ? (
        <p className="track-role-reason" data-testid="track-role-reason">
          {blockedReason}
        </p>
      ) : null}

      {role === "triggered" && triggeredDetail ? (
        <div className="track-role-detail" data-testid="track-role-detail-triggered">
          {triggeredDetail}
        </div>
      ) : null}
      {role === "trackFlow" && trackFlowDetail ? (
        <div className="track-role-detail" data-testid="track-role-detail-trackflow">
          {trackFlowDetail}
        </div>
      ) : null}
    </fieldset>
  );
}
