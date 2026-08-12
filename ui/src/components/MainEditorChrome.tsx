/**
 * Main-editor launcher chrome: panel status chips, launcher icons, and the
 * launcher button row. Extracted verbatim from App.tsx (carve-up round 9).
 */
import { type ReactNode } from "react";
import {
  PanelStatusEntry,
  PanelStatusItem,
} from "../components/WeightEditors";
/**
 * Panel header status flags — the shared, repeatable contract for the right
 * side of every editor-panel header. Keep headers minimalist and predictable:
 *
 * - Flags are EXCEPTIONS, not a status mirror. Pass a chip only when a feature
 *   is active or a setting is non-default (e.g. `grouping layered`).
 *   Never the default/"off" counterpart, and never an "open" chip — an open
 *   panel is self-evident. Default state ⇒ no chips ⇒ a calm header.
 * - Counts and identity belong in the panel title/subtitle, never in a chip.
 * - Tone semantics: `on` = an enabled/active feature (accent), `warn` = needs
 *   attention (red), `data` = a neutral value (use sparingly).
 * - The row is bounded: at most MAX_PANEL_STATUS_CHIPS render, with any
 *   remainder collapsed into one "+N" chip, so the space can never sprawl.
 */
const MAX_PANEL_STATUS_CHIPS = 3;

export function PanelStatusChips({ items }: { items: PanelStatusEntry[] }) {
  const visible = items.filter((item): item is PanelStatusItem => Boolean(item));
  if (!visible.length) {
    return null;
  }
  const shown = visible.slice(0, MAX_PANEL_STATUS_CHIPS);
  const overflow = visible.slice(MAX_PANEL_STATUS_CHIPS);

  return (
    <span className="panel-status-chips">
      {shown.map((item) => (
        <b className={`panel-status-chip is-${item.tone ?? "data"}`} key={item.label}>
          {item.label}
        </b>
      ))}
      {overflow.length ? (
        <b
          className="panel-status-chip is-overflow"
          title={overflow.map((item) => item.label).join(", ")}
        >
          +{overflow.length}
        </b>
      ) : null}
    </span>
  );
}

export interface PanelStatusPair {
  label: string;
  /** Omit for a flag (label only); include for a `label value` readout. */
  value?: string;
}

export type PanelStatusStripEntry = PanelStatusPair | null | false;

/**
 * Always-on panel header status strip — a fixed, tidy `label value · …` readout
 * of the panel's current state, the steady counterpart to the exception-only
 * PanelStatusChips. Keep it to a handful of stable facts (modes, key counts);
 * full detail stays in the body controls.
 */
export function PanelStatusStrip({ items }: { items: PanelStatusStripEntry[] }) {
  const visible = items.filter((item): item is PanelStatusPair => Boolean(item));
  if (!visible.length) {
    return null;
  }
  return (
    <span className="panel-status-strip">
      {visible.map((item) => (
        <span className="panel-status-stat" key={item.label}>
          <b>{item.label}</b>
          {item.value != null ? <em>{` ${item.value}`}</em> : null}
        </span>
      ))}
    </span>
  );
}

export type MainEditorId = "boundaries" | "generator" | "evolve" | "channel";

export type ChannelHocketTabId =
  | "matrix"
  | "entry"
  | "pattern"
  | "accents"
  | "positions";

export interface MainEditorLauncherItem {
  id: MainEditorId;
  title: string;
  summary: string;
  icon: MainEditorIcon;
  tone: MainEditorId;
  active: boolean;
}

export type MainEditorIcon = MainEditorId;

export function MainEditorLauncherIcon({ icon }: { icon: MainEditorIcon }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      {/* Sections: one cycle span divided into sections by boundaries. */}
      {icon === "boundaries" ? (
        <>
          <rect {...common} x="3.5" y="8.5" width="17" height="7" rx="2" />
          <path {...common} d="M9.2 8.5v7" />
          <path {...common} d="M14.8 8.5v7" />
        </>
      ) : null}
      {/* Generator: a stream of cells with a controllable density envelope. */}
      {icon === "generator" ? (
        <>
          <path {...common} d="M4 16.5h16" />
          <rect {...common} x="4" y="10" width="3" height="6.5" rx="1" />
          <rect {...common} x="10.5" y="6" width="3" height="10.5" rx="1" />
          <rect {...common} x="17" y="8.5" width="3" height="8" rx="1" />
        </>
      ) : null}
      {/* Evolve: authored events distributed over a cycle score. */}
      {icon === "evolve" ? (
        <>
          <path {...common} d="M4 18.5h16" />
          <path {...common} d="M6 6.5v12M12 6.5v12M18 6.5v12" opacity=".42" />
          <path {...common} d="m6 10 2.4 2.4L6 14.8l-2.4-2.4L6 10Z" />
          <rect {...common} x="10" y="7.8" width="8" height="3.8" rx="1.9" />
        </>
      ) : null}
      {/* Channel: one source fanning out to three destination channels. */}
      {icon === "channel" ? (
        <>
          <circle cx="5" cy="12" r="1.8" fill="currentColor" />
          <path {...common} d="M6.8 12h4" />
          <path {...common} d="M10.8 12c3.2 0 3.2-5.3 6-5.3" />
          <path {...common} d="M10.8 12h6" />
          <path {...common} d="M10.8 12c3.2 0 3.2 5.3 6 5.3" />
          <circle cx="18.3" cy="6.7" r="1.6" fill="currentColor" />
          <circle cx="18.3" cy="12" r="1.6" fill="currentColor" />
          <circle cx="18.3" cy="17.3" r="1.6" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}

/**
 * The standard editor-panel header, shared by every main editor: leading editor
 * icon, title + one readout subtitle, an always-on status strip, and the close
 * glyph. Render as the sole child of each panel's <summary> so every panel's
 * header structure is identical.
 */
export function PanelHeader({
  icon,
  title,
  subtitle,
  strip,
}: {
  icon: MainEditorIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  strip?: PanelStatusStripEntry[];
}) {
  return (
    <>
      <span className="editor-panel-icon" aria-hidden="true">
        <MainEditorLauncherIcon icon={icon} />
      </span>
      <span className="summary-copy">
        <strong>{title}</strong>
        {subtitle != null ? <em>{subtitle}</em> : null}
      </span>
      {strip != null ? <PanelStatusStrip items={strip} /> : null}
      <b className="main-editor-close-copy" aria-hidden="true">
        ×
      </b>
    </>
  );
}

export function MainEditorLauncher({
  items,
  onOpen,
}: {
  items: MainEditorLauncherItem[];
  onOpen: (id: MainEditorId) => void;
}) {
  return (
    <section className="main-editor-launcher-panel" aria-label="Main editors">
      <div className="main-editor-launcher-head">
        <span>
          <strong>Editors</strong>
          <em>Open one focused surface below the timeline</em>
        </span>
      </div>
      <div className="main-editor-launcher-grid">
        {items.map((item) => (
          <button
            className={`main-editor-launcher is-${item.tone}${
              item.active ? " is-active" : ""
            }`}
            key={item.id}
            type="button"
            data-testid={`main-editor-launcher-${item.id}`}
            aria-haspopup="dialog"
            aria-expanded={item.active}
            onClick={() => onOpen(item.id)}
          >
            <span className="main-editor-launcher-icon" aria-hidden="true">
              <MainEditorLauncherIcon icon={item.icon} />
            </span>
            <span className="main-editor-launcher-copy">
              <strong>{item.title}</strong>
              <em>{item.summary}</em>
            </span>
            {item.active ? (
              <span className="main-editor-launcher-state" aria-hidden="true">
                Open
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}
