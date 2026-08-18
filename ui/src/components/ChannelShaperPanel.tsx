/**
 * The Channel shaper main-editor panel: static MIDI output channel vs channel
 * hocket (Markov matrix, entry weights, accent rules, ratchet/ornament
 * gesture routing). Extracted from App.tsx (carve-up round 13) along the
 * panel seam — all state stays in App and arrives via props with their
 * original names, so the JSX body is unchanged.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { SliderField } from "../SliderField";
import { ControlRow } from "./ControlRow";
import {
  channelAccentAutomationTarget,
  channelEntryAutomationTarget,
  channelFallbackAutomationTarget,
  channelPositionActionAutomationTarget,
  channelPositionEnabledAutomationTarget,
  channelPositionNthAutomationTarget,
  channelPositionRenderAutomationTarget,
  channelPositionResetAutomationTarget,
  channelTransitionAutomationTarget,
} from "../automationTargets";
import { channelWeightShare, channelWeightValue } from "../markovWeights";
import { formatPct } from "./format";
import {
  transitionHeatBackground,
  transitionHeatShadow,
} from "./transitionHeat";
import { AccentRoutingVelocityGuide } from "./AccentControls";
import type {
  ChannelAssignMode,
  MarkovOrder,
} from "../bridge";
import {
  clamp,
  cloneChannelAccentRules,
  normalizeChannelAccentMode,
  DEFAULT_CHANNEL_ACCENT_RULES,
  EUCLID_CHANNEL_MAX_LAYERS,
  EUCLID_CHANNEL_MAX_STEPS,
  MIDI_CHANNELS,
  type PatchChannelAccentRule,
  type PatchChannelPositionRule,
  type PatchEuclidChannelLayer,
  type PatchEuclidChannelState,
  type SeedDialogTab,
  type SeedLogScope,
} from "../patchIo";
import {
  bjorklundMask,
  euclidLayerMask,
  euclidPartitionLayerDomains,
  euclidPartitionTable,
  euclidStackPeriod,
  euclidStackTable,
  intervalVector,
  isEuclideanString,
  isReverseEuclideanString,
  seedEuclidLayersFromChannels,
} from "../euclidChannels";
import { NumericField } from "../NumericField";
import { PanelHeader, type ChannelHocketTabId } from "./MainEditorChrome";
import type { PanelStatusEntry } from "./WeightEditors";
import type { SeedTone } from "./SeedControls";

import { Switch } from "../Switch";
import { useEditorDraftLifecycle } from "../editorDraftFlush";

const CHANNEL_POSITION_ACTION_CONTROLS: Array<{
  key: keyof PatchChannelPositionRule["actionWeights"];
  label: string;
}> = [
  { key: "normalMarkov", label: "Normal" },
  { key: "renderOnly", label: "Render" },
  { key: "resetMarkov", label: "Reset" },
];

const CHANNEL_POSITION_RESET_LABELS: Record<
  PatchChannelPositionRule["resetMode"],
  string
> = {
  staticFallback: "Static fallback",
  weightedFallback: "Weighted fallback",
  customWeighted: "Custom weights",
};

function ChannelPositionRuleLabelField({
  ruleIndex,
  label,
  onCommit,
}: {
  ruleIndex: number;
  label: string;
  onCommit: (label: string) => void;
}) {
  const [draft, setDraft] = useState(label);
  const cancelCommitRef = useRef(false);
  useEditorDraftLifecycle({
    flush: () => {
      if (cancelCommitRef.current) {
        cancelCommitRef.current = false;
        setDraft(label);
      } else if (draft !== label) {
        onCommit(draft);
      }
    },
    discard: () => {
      cancelCommitRef.current = false;
      setDraft(label);
    },
  });

  useEffect(() => {
    setDraft(label);
  }, [label]);

  return (
    <input
      className="channel-rule-label-field"
      aria-label={`Position rule ${ruleIndex + 1} label`}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={(event) => {
        if (cancelCommitRef.current) {
          cancelCommitRef.current = false;
          setDraft(label);
          return;
        }
        const next = event.currentTarget.value;
        if (next !== label) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          cancelCommitRef.current = true;
          setDraft(label);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export interface ChannelShaperPanelProps {
  channelHocketOpen: boolean;
  setChannelHocketOpen: Dispatch<SetStateAction<boolean>>;
  channelStatusItems: PanelStatusEntry[];
  channelHocketEnabled: boolean;
  setChannelHocketEnabled: Dispatch<SetStateAction<boolean>>;
  midiOutputChannel: number;
  setMidiOutputChannel: Dispatch<SetStateAction<number>>;
  channelHocketTab: ChannelHocketTabId;
  setChannelHocketTab: Dispatch<SetStateAction<ChannelHocketTabId>>;
  channelHocketTabs: Array<{ id: ChannelHocketTabId; label: string; summary: string }>;
  activeChannelHocketTab: { id: ChannelHocketTabId; label: string; summary: string };
  channelHocketOrder: MarkovOrder;
  setChannelHocketOrder: Dispatch<SetStateAction<MarkovOrder>>;
  channelHocketAssignMode: ChannelAssignMode;
  setChannelHocketAssignMode: Dispatch<SetStateAction<ChannelAssignMode>>;
  channelHocketEuclid: PatchEuclidChannelState;
  setChannelHocketEuclid: Dispatch<SetStateAction<PatchEuclidChannelState>>;
  channelHocketChannels: number[];
  setChannelHocketChannels: Dispatch<SetStateAction<number[]>>;
  toggleChannelHocketChannel: (channel: number) => void;
  setChannelHocketAxisCount: (count: number) => void;
  channelHocketFallback: number;
  setChannelHocketFallback: Dispatch<SetStateAction<number>>;
  channelHocketWeights: Record<string, number>;
  updateChannelHocketWeight: (from: number[], to: number, value: number) => void;
  updateChannelHocketFallbackWeight: (channel: number, value: number) => void;
  updateChannelHocketEntryWeight: (entry: number[], value: number) => void;
  channelEntryWeight: (entry: number[]) => number;
  channelFallbackWeight: (channel: number) => number;
  channelHocketVisibleContexts: number[][];
  channelHocketMatrixChannels: number[];
  channelHocketSeedTone: SeedTone;
  channelHocketSeedSummary: string;
  channelHocketSeedHeaderLabel: string;
  channelHocketTransitionSummary: string;
  channelHocketEventSummary: string;
  channelAccentRules: PatchChannelAccentRule[];
  setChannelAccentRules: Dispatch<SetStateAction<PatchChannelAccentRule[]>>;
  updateChannelAccentRule: (index: number, patch: Partial<PatchChannelAccentRule>) => void;
  updateChannelAccentWeight: (ruleIndex: number, channel: number, value: number) => void;
  resetChannelAccentRulesToVelocityBands: () => void;
  activeChannelAccentRuleCount: number;
  channelPositionRules: PatchChannelPositionRule[];
  setChannelPositionRules: Dispatch<SetStateAction<PatchChannelPositionRule[]>>;
  addChannelPositionRule: () => void;
  updateChannelPositionRule: (
    index: number,
    patch: Partial<PatchChannelPositionRule>
  ) => void;
  removeChannelPositionRule: (index: number) => void;
  updateChannelPositionActionWeight: (
    ruleIndex: number,
    key: keyof PatchChannelPositionRule["actionWeights"],
    value: number
  ) => void;
  updateChannelPositionRenderWeight: (
    ruleIndex: number,
    channel: number,
    value: number
  ) => void;
  updateChannelPositionResetWeight: (
    ruleIndex: number,
    channel: number,
    value: number
  ) => void;
  activeChannelPositionRuleCount: number;
  beatAccentMin: number;
  beatAccentMax: number;
  sectionAccentMin: number;
  sectionAccentMax: number;
  jathiAccentMin: number;
  jathiAccentMax: number;
  jathiAccentMode: "overrideGati" | "layered";
  velocity: number;
  otherTrackChannelUsage: Array<{
    channel: number;
    tracks: Array<{ label: string; name: string }>;
  }>;
  otherTrackChannelUsageSummary: string[];
  openSeedSetup: (tab?: SeedDialogTab, scope?: SeedLogScope) => void;
  openProbabilityForAccentRanges: () => void;
  openScoreSetupForVelocity: () => void;
  renderAutomationControlLabel: (
    label: ReactNode,
    title: string,
    targetIds: Array<string | null | undefined>
  ) => ReactNode;
  renderAutomationFocusButton: (
    title: string,
    targetIds: Array<string | null | undefined>
  ) => ReactNode;
}

export function ChannelShaperPanel({
  channelHocketOpen,
  setChannelHocketOpen,
  channelHocketEnabled,
  setChannelHocketEnabled,
  midiOutputChannel,
  setMidiOutputChannel,
  setChannelHocketTab,
  channelHocketTabs,
  activeChannelHocketTab,
  channelHocketOrder,
  setChannelHocketOrder,
  channelHocketAssignMode,
  setChannelHocketAssignMode,
  channelHocketEuclid,
  setChannelHocketEuclid,
  channelHocketChannels,
  setChannelHocketChannels,
  toggleChannelHocketChannel,
  setChannelHocketAxisCount,
  channelHocketFallback,
  setChannelHocketFallback,
  channelHocketWeights,
  updateChannelHocketWeight,
  updateChannelHocketFallbackWeight,
  updateChannelHocketEntryWeight,
  channelEntryWeight,
  channelFallbackWeight,
  channelHocketVisibleContexts,
  channelHocketMatrixChannels,
  channelHocketSeedHeaderLabel,
  channelHocketTransitionSummary,
  channelHocketEventSummary,
  channelAccentRules,
  setChannelAccentRules,
  updateChannelAccentRule,
  updateChannelAccentWeight,
  resetChannelAccentRulesToVelocityBands,
  activeChannelAccentRuleCount,
  channelPositionRules,
  setChannelPositionRules,
  addChannelPositionRule,
  updateChannelPositionRule,
  removeChannelPositionRule,
  updateChannelPositionActionWeight,
  updateChannelPositionRenderWeight,
  updateChannelPositionResetWeight,
  activeChannelPositionRuleCount,
  beatAccentMin,
  beatAccentMax,
  sectionAccentMin,
  sectionAccentMax,
  jathiAccentMin,
  jathiAccentMax,
  jathiAccentMode,
  velocity,
  otherTrackChannelUsage,
  otherTrackChannelUsageSummary,
  openProbabilityForAccentRanges,
  openScoreSetupForVelocity,
  renderAutomationControlLabel,
  renderAutomationFocusButton,
}: ChannelShaperPanelProps) {
  // UC-42: the raw `channelHocketTab` state can name a tab the current
  // strategy does not offer (e.g. "matrix" right after loading a
  // Euclid-authored patch). The bar and the body must both render from the
  // clamped active tab, or the body shows one subpanel under another tab's
  // highlight.
  const activeChannelHocketTabId = activeChannelHocketTab.id;
  return (
        <details
          id="channel-shaper-panel"
          className={`modal-surface modal-surface--full main-editor-surface editor-panel shaper-panel panel-state channel-hocket-panel${
            channelHocketEnabled ? " is-enabled" : ""
          }`}
          role="dialog"
          aria-label="Channel shaper editor"
          aria-modal={channelHocketOpen}
          open={channelHocketOpen}
          onToggle={(e) => setChannelHocketOpen(e.currentTarget.open)}
        >
          <summary
            className="editor-panel-summary"
            data-automation-target="channelHocket.enabled"
          >
            <PanelHeader
              icon="channel"
              title="Channel Shaper"
              subtitle={channelHocketEventSummary}
              strip={[
                { label: "seed", value: channelHocketSeedHeaderLabel },
                { label: "hocket", value: channelHocketEnabled ? "on" : "off" },
                { label: "accents", value: String(activeChannelAccentRuleCount) },
              ]}
            />
          </summary>
          {channelHocketOpen ? (
          <div className="shaper-body channel-hocket-body">
            <div className="channel-console-header">
              <label
                className={`channel-power-card${channelHocketEnabled ? " is-on" : ""}`}
              >
                <input
                  type="checkbox"
                  aria-label="Hocket enabled"
                  checked={channelHocketEnabled}
                  data-automation-target="channelHocket.enabled"
                  onChange={(e) => {
                    const enabled = e.currentTarget.checked;
                    if (enabled && channelHocketChannels.length === 0) {
                      const firstChannel = clamp(midiOutputChannel, 1, 16);
                      const secondChannel = firstChannel === 16 ? 15 : firstChannel + 1;
                      setChannelHocketChannels([firstChannel, secondChannel]);
                      setChannelHocketFallback(firstChannel);
                    }
                    setChannelHocketEnabled(enabled);
                  }}
                />
                <span aria-hidden="true" />
                <b>Hocket</b>
                <em>
                  {channelHocketEnabled
                    ? `${channelHocketMatrixChannels.length} channels`
                    : `Static Ch ${midiOutputChannel}`}
                </em>
              </label>
              <span className="channel-header-automation">
                {renderAutomationFocusButton("Hocket", [
                  "channelHocket.enabled",
                  "channelHocket.outputChannel",
                  "channelHocket.fallback.staticChannel",
                ])}
              </span>
              <label className="channel-header-field">
                Output
                <select
                  aria-label="Static output channel"
                  value={midiOutputChannel}
                  data-automation-target="channelHocket.outputChannel"
                  onChange={(e) =>
                    setMidiOutputChannel(
                      clamp(parseInt(e.target.value, 10) || 1, 1, 16)
                    )
                  }
                >
                  {MIDI_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      Ch {channel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="channel-header-field">
                Assignment
                <select
                  aria-label="Channel assignment strategy"
                  value={channelHocketAssignMode}
                  onChange={(e) => {
                    const mode = e.target.value as ChannelAssignMode;
                    setChannelHocketAssignMode(mode);
                    setChannelHocketTab(mode === "euclid" ? "pattern" : "matrix");
                    if (
                      mode === "euclid" &&
                      channelHocketEuclid.layers.length === 0 &&
                      channelHocketMatrixChannels.length > 0
                    ) {
                      // First switch on a populated track: seed one layer per
                      // enabled channel, pulses spread by largest remainder.
                      setChannelHocketEuclid((previous) => ({
                        ...previous,
                        layers: seedEuclidLayersFromChannels(
                          channelHocketMatrixChannels,
                          previous.steps
                        ),
                      }));
                    }
                  }}
                >
                  <option value="markov">Markov chain</option>
                  <option value="euclid">Euclidean (Bjorklund)</option>
                </select>
              </label>
              {channelHocketAssignMode === "markov" && (
                <>
                  <label className="channel-header-field">
                    Order
                    <select
                      aria-label="Markov order"
                      value={channelHocketOrder}
                      onChange={(e) => setChannelHocketOrder(e.target.value as MarkovOrder)}
                    >
                      <option value="first">First</option>
                      <option value="second">Second</option>
                    </select>
                  </label>
                  <label className="channel-header-field">
                    Axis
                    <select
                      aria-label="Channel axis count"
                      value={channelHocketMatrixChannels.length}
                      onChange={(e) =>
                        setChannelHocketAxisCount(parseInt(e.target.value, 10))
                      }
                    >
                      {MIDI_CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>
                          {channel}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="channel-header-field">
                Fallback
                <select
                  aria-label="Fallback channel"
                  value={channelHocketFallback}
                  data-automation-target="channelHocket.fallback.staticChannel"
                  onChange={(e) => setChannelHocketFallback(parseInt(e.target.value, 10))}
                >
                  {channelHocketMatrixChannels.map((channel) => (
                    <option key={channel} value={channel}>
                      Ch {channel}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <section className="channel-axis-strip" aria-label="MIDI channels">
              <div className="channel-axis-head">
                <div>
                  <strong>Channel Set</strong>
                  <span>{channelHocketMatrixChannels.length} selected for this track</span>
                </div>
                <p className="channel-usage-summary">
                  <b>Other tracks</b>
                  <span>
                    {otherTrackChannelUsageSummary.length
                      ? otherTrackChannelUsageSummary.slice(0, 5).join(" · ")
                      : "none"}
                    {otherTrackChannelUsageSummary.length > 5 ? " · +" : ""}
                  </span>
                </p>
              </div>
              <div className="channel-chip-grid">
                {MIDI_CHANNELS.map((channel) => {
                  const otherUsage =
                    otherTrackChannelUsage.find((entry) => entry.channel === channel)
                      ?.tracks ?? [];
                  const usedByOther = otherUsage.length > 0;
                  const title = usedByOther
                    ? `Ch ${channel} also used by ${otherUsage
                        .map((track) => `${track.label} ${track.name}`)
                        .join(", ")}`
                    : `Ch ${channel}`;
                  return (
                    <button
                      className={`channel-chip${
                        channelHocketMatrixChannels.includes(channel)
                          ? " is-selected"
                          : ""
                      }${usedByOther ? " is-used-by-other" : ""}`}
                      key={channel}
                      type="button"
                      title={title}
                      onClick={() => toggleChannelHocketChannel(channel)}
                      aria-pressed={channelHocketMatrixChannels.includes(channel)}
                    >
                      <span className="channel-chip-number">{channel}</span>
                      {usedByOther ? (
                        <span className="channel-chip-usage" aria-hidden="true">
                          {otherUsage.length === 1 ? otherUsage[0]!.label : `${otherUsage[0]!.label}+`}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="channel-workbench-shell">
              <nav className="ds-tab-bar" aria-label="Channel Shaper views">
                {channelHocketTabs.map((tab) => (
                  <button
                    className={activeChannelHocketTabId === tab.id ? "is-active" : ""}
                    key={tab.id}
                    type="button"
                    aria-pressed={activeChannelHocketTabId === tab.id}
                    onClick={() => setChannelHocketTab(tab.id)}
                  >
                    <strong>{tab.label}</strong>
                  </button>
                ))}
              </nav>
              <p className="ds-tab-summary">{activeChannelHocketTab.summary}</p>

              <section
                className={`channel-workbench-panel is-${activeChannelHocketTab.id}`}
                aria-label={`${activeChannelHocketTab.label} settings`}
              >
                {activeChannelHocketTabId === "pattern" &&
                  (() => {
                    const euclid = channelHocketEuclid;
                    const partition = euclid.placement === "partition";
                    const updateEuclid = (
                      patch: Partial<PatchEuclidChannelState>
                    ) =>
                      setChannelHocketEuclid((previous) => ({
                        ...previous,
                        ...patch,
                      }));
                    const updateLayer = (
                      index: number,
                      patch: Partial<PatchEuclidChannelLayer>
                    ) =>
                      setChannelHocketEuclid((previous) => ({
                        ...previous,
                        layers: previous.layers.map((layer, i) =>
                          i === index ? { ...layer, ...patch } : layer
                        ),
                      }));
                    const moveLayer = (index: number, delta: number) =>
                      setChannelHocketEuclid((previous) => {
                        const target = index + delta;
                        if (target < 0 || target >= previous.layers.length) {
                          return previous;
                        }
                        const layers = [...previous.layers];
                        const [moved] = layers.splice(index, 1);
                        layers.splice(target, 0, moved!);
                        return { ...previous, layers };
                      });
                    const removeLayer = (index: number) =>
                      setChannelHocketEuclid((previous) => ({
                        ...previous,
                        layers: previous.layers.filter((_, i) => i !== index),
                      }));
                    const usedChannels = new Set(
                      euclid.layers.map((layer) => layer.channel)
                    );
                    const nextChannel = channelHocketMatrixChannels.find(
                      (channel) => !usedChannels.has(channel)
                    );
                    const addLayer = () =>
                      setChannelHocketEuclid((previous) => ({
                        ...previous,
                        layers: [
                          ...previous.layers,
                          {
                            channel: nextChannel ?? channelHocketFallback,
                            pulses: 1,
                            rotation: 0,
                            maxRun: 1,
                            steps: 16,
                            invert: false,
                          },
                        ],
                      }));
                    const displaySteps = partition
                      ? euclid.steps
                      : euclidStackPeriod(euclid.layers, 64);
                    const table = partition
                      ? euclidPartitionTable(
                          euclid.steps,
                          euclid.layers,
                          channelHocketFallback
                        )
                      : euclidStackTable(
                          euclid.layers,
                          channelHocketFallback,
                          displaySteps
                        );
                    const maskString = (bits: boolean[]) =>
                      bits.map((bit) => (bit ? "1" : "0")).join("");
                    // UC-51/UC-52: in partition mode each layer's Bjorklund
                    // runs over the slots earlier layers left behind, with
                    // pulses clamped to that remaining budget — the readout
                    // and the Pulses ceiling must describe that domain, not
                    // the full shared cycle.
                    const partitionDomains = partition
                      ? euclidPartitionLayerDomains(euclid.steps, euclid.layers)
                      : null;
                    return (
                      <>
                        <div className="channel-workbench-head">
                          <div>
                            <strong>Euclidean Pattern</strong>
                            <span>
                              {partition
                                ? "Layers claim slots of one shared cycle; leftover slots fall back."
                                : "Each layer runs its own length; earlier layers win collisions."}
                            </span>
                          </div>
                          <b>{activeChannelHocketTab.summary}</b>
                        </div>
                        {channelHocketMatrixChannels.length === 0 ? (
                          <div className="channel-empty-state">
                            Turn on hocket or choose at least one MIDI channel.
                          </div>
                        ) : (
                          <div className="channel-euclid-editor">
                            <div className="channel-euclid-controls">
                              <label className="channel-header-field">
                                Placement
                                <select
                                  aria-label="Euclid placement"
                                  value={euclid.placement}
                                  onChange={(e) =>
                                    updateEuclid({
                                      placement:
                                        e.target.value === "stack"
                                          ? "stack"
                                          : "partition",
                                    })
                                  }
                                >
                                  <option value="partition">Partition</option>
                                  <option value="stack">Stack</option>
                                </select>
                              </label>
                              {partition && (
                                <label className="channel-header-field">
                                  Steps
                                  <NumericField
                                    aria-label="Euclid steps"
                                    min={1}
                                    max={EUCLID_CHANNEL_MAX_STEPS}
                                    value={euclid.steps}
                                    size="compact"
                                    showSteppers={false}
                                    onValueCommit={(steps) =>
                                      updateEuclid({
                                        steps,
                                      })
                                    }
                                  />
                                </label>
                              )}
                              <label className="channel-header-field">
                                Reset
                                <select
                                  aria-label="Euclid reset scope"
                                  value={euclid.reset}
                                  onChange={(e) =>
                                    updateEuclid({
                                      reset: e.target
                                        .value as PatchEuclidChannelState["reset"],
                                    })
                                  }
                                >
                                  <option value="cycle">Every cycle</option>
                                  <option value="section">Every section</option>
                                  <option value="beat">Every beat</option>
                                  <option value="accentSpan">
                                    Every accent span
                                  </option>
                                </select>
                              </label>
                              <label className="channel-header-field">
                                Span accents
                                <select
                                  aria-label="Euclid span accents"
                                  value={euclid.spanAccentMode}
                                  onChange={(e) =>
                                    updateEuclid({
                                      spanAccentMode:
                                        e.target.value === "bypass"
                                          ? "bypass"
                                          : "woven",
                                    })
                                  }
                                >
                                  <option value="woven">Woven into pattern</option>
                                  <option value="bypass">Pinned to channel</option>
                                </select>
                              </label>
                              {euclid.spanAccentMode === "bypass" && (
                                <label className="channel-header-field">
                                  Anchor
                                  <select
                                    aria-label="Euclid span accent channel"
                                    value={euclid.spanAccentChannel ?? "fallback"}
                                    onChange={(e) =>
                                      updateEuclid({
                                        spanAccentChannel:
                                          e.target.value === "fallback"
                                            ? null
                                            : clamp(
                                                parseInt(e.target.value, 10) || 1,
                                                1,
                                                16
                                              ),
                                      })
                                    }
                                  >
                                    <option value="fallback">Fallback</option>
                                    {channelHocketMatrixChannels.map((channel) => (
                                      <option key={channel} value={channel}>
                                        Ch {channel}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                            </div>
                            <p className="channel-euclid-hint">
                              {euclid.spanAccentMode === "bypass"
                                ? "Pinned accents keep one timbre and don't consume pattern steps — the weave compacts across them."
                                : "Accent-span starts take whatever step the pattern is on. Reset per accent span to pin them to the pattern head instead."}
                            </p>
                            <div
                              className="channel-euclid-layers"
                              role="list"
                              aria-label="Euclid layers"
                            >
                              {euclid.layers.length === 0 && (
                                <div className="channel-empty-state">
                                  Add a layer to start weaving channels.
                                </div>
                              )}
                              {euclid.layers.map((layer, index) => {
                                const layerBits = partition
                                  ? table.map(
                                      (slot) =>
                                        slot.channel === layer.channel &&
                                        !slot.isFallback
                                    )
                                  : euclidLayerMask(layer, layer.steps, true);
                                const layerDomain =
                                  partitionDomains?.[index] ?? null;
                                const necklacePulses = layerDomain
                                  ? layerDomain.pulses
                                  : layer.pulses;
                                const necklaceSteps = layerDomain
                                  ? layerDomain.domain
                                  : layer.steps;
                                const necklace = bjorklundMask(
                                  necklacePulses,
                                  necklaceSteps
                                );
                                const intervals = intervalVector(necklace);
                                const badge =
                                  layer.maxRun === 1 && !layer.invert
                                    ? isEuclideanString(intervals)
                                      ? "Euclidean string"
                                      : isReverseEuclideanString(intervals)
                                        ? "reverse Euclidean string"
                                        : null
                                    : null;
                                return (
                                  <div
                                    className="channel-euclid-layer"
                                    role="listitem"
                                    key={`${layer.channel}-${index}`}
                                  >
                                    <div className="channel-euclid-layer-fields">
                                      <label className="channel-header-field">
                                        Channel
                                        <select
                                          aria-label={`Euclid layer ${index + 1} channel`}
                                          value={layer.channel}
                                          onChange={(e) =>
                                            updateLayer(index, {
                                              channel: clamp(
                                                parseInt(e.target.value, 10) || 1,
                                                1,
                                                16
                                              ),
                                            })
                                          }
                                        >
                                          {channelHocketMatrixChannels
                                            .filter(
                                              (channel) =>
                                                channel === layer.channel ||
                                                !usedChannels.has(channel)
                                            )
                                            .map((channel) => (
                                              <option key={channel} value={channel}>
                                                Ch {channel}
                                              </option>
                                            ))}
                                        </select>
                                      </label>
                                      <label className="channel-header-field">
                                        Pulses
                                        <NumericField
                                          aria-label={`Euclid layer ${index + 1} pulses`}
                                          min={0}
                                          max={
                                            layerDomain
                                              ? layerDomain.domain
                                              : EUCLID_CHANNEL_MAX_STEPS
                                          }
                                          value={layer.pulses}
                                          size="compact"
                                          showSteppers={false}
                                          onValueCommit={(pulses) =>
                                            updateLayer(index, {
                                              pulses,
                                            })
                                          }
                                        />
                                      </label>
                                      <label className="channel-header-field">
                                        Rotate
                                        <NumericField
                                          aria-label={`Euclid layer ${index + 1} rotation`}
                                          min={0}
                                          max={EUCLID_CHANNEL_MAX_STEPS - 1}
                                          value={layer.rotation}
                                          size="compact"
                                          showSteppers={false}
                                          onValueCommit={(rotation) =>
                                            updateLayer(index, {
                                              rotation,
                                            })
                                          }
                                        />
                                      </label>
                                      <label className="channel-header-field">
                                        Max run
                                        <NumericField
                                          aria-label={`Euclid layer ${index + 1} max run`}
                                          min={1}
                                          max={EUCLID_CHANNEL_MAX_STEPS}
                                          value={layer.maxRun}
                                          size="compact"
                                          showSteppers={false}
                                          onValueCommit={(maxRun) =>
                                            updateLayer(index, {
                                              maxRun,
                                            })
                                          }
                                        />
                                      </label>
                                      {!partition && (
                                        <>
                                          <label className="channel-header-field">
                                            Length
                                            <NumericField
                                              aria-label={`Euclid layer ${index + 1} steps`}
                                              min={1}
                                              max={EUCLID_CHANNEL_MAX_STEPS}
                                              value={layer.steps}
                                              size="compact"
                                              showSteppers={false}
                                              onValueCommit={(steps) =>
                                                updateLayer(index, {
                                                  steps,
                                                })
                                              }
                                            />
                                          </label>
                                          <label className="channel-euclid-invert">
                                            <input
                                              type="checkbox"
                                              aria-label={`Euclid layer ${index + 1} invert`}
                                              checked={layer.invert}
                                              onChange={(e) =>
                                                updateLayer(index, {
                                                  invert: e.currentTarget.checked,
                                                })
                                              }
                                            />
                                            Invert
                                          </label>
                                        </>
                                      )}
                                      <span className="channel-euclid-layer-actions">
                                        <button
                                          type="button"
                                          aria-label={`Move euclid layer ${index + 1} up`}
                                          disabled={index === 0}
                                          onClick={() => moveLayer(index, -1)}
                                        >
                                          ↑
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={`Move euclid layer ${index + 1} down`}
                                          disabled={index === euclid.layers.length - 1}
                                          onClick={() => moveLayer(index, 1)}
                                        >
                                          ↓
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={`Remove euclid layer ${index + 1}`}
                                          onClick={() => removeLayer(index)}
                                        >
                                          ✕
                                        </button>
                                      </span>
                                    </div>
                                    <span
                                      className="rhythm-shapegroup-mask"
                                      role="img"
                                      aria-label={`Euclid layer ${index + 1} channel ${layer.channel} mask ${maskString(layerBits)}`}
                                    >
                                      {layerBits.map((bit, bitIndex) => (
                                        <i
                                          key={bitIndex}
                                          className={bit ? "is-on" : undefined}
                                        />
                                      ))}
                                    </span>
                                    <span className="channel-euclid-readout">
                                      E({necklacePulses},
                                      {necklaceSteps}) = (
                                      {intervals.join("")})
                                      {badge ? (
                                        <em className="channel-euclid-badge">
                                          {badge}
                                        </em>
                                      ) : null}
                                    </span>
                                    {layerDomain &&
                                    layer.pulses > layerDomain.domain ? (
                                      <p className="channel-euclid-hint channel-euclid-overbudget" role="alert">
                                        Only {layerDomain.domain}{" "}
                                        {layerDomain.domain === 1
                                          ? "slot remains"
                                          : "slots remain"}{" "}
                                        for this layer — {layerDomain.pulses} of
                                        its {layer.pulses} pulses will play.
                                      </p>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="channel-euclid-footer">
                              <button
                                type="button"
                                className="ds-button"
                                disabled={
                                  euclid.layers.length >= EUCLID_CHANNEL_MAX_LAYERS ||
                                  nextChannel === undefined
                                }
                                onClick={addLayer}
                              >
                                Add layer
                              </button>
                              <span
                                className="channel-euclid-combined"
                                role="img"
                                aria-label={`Euclid resolved channels ${table
                                  .map((slot) => slot.channel)
                                  .join(" ")}`}
                              >
                                {table.map((slot, slotIndex) => (
                                  <i
                                    key={slotIndex}
                                    className={
                                      slot.isFallback ? "is-fallback" : undefined
                                    }
                                  >
                                    {slot.channel}
                                  </i>
                                ))}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                {activeChannelHocketTabId === "matrix" && (
                  <>
                    <div className="channel-workbench-head">
                      <div>
                        <strong>Transition Matrix</strong>
                        <span>
                          {channelHocketOrder === "first"
                            ? "Rows read the previous channel."
                            : "Rows read the previous two channels."}
                        </span>
                      </div>
                      <b>{channelHocketTransitionSummary}</b>
                    </div>
                    {channelHocketMatrixChannels.length === 0 ? (
                      <div className="channel-empty-state">
                        Turn on hocket or choose at least one MIDI channel.
                      </div>
                    ) : (
                      <div className="rhythm-matrix-wrap channel-matrix-wrap">
                        <table className="rhythm-matrix channel-matrix">
                          <thead>
                            <tr>
                              <th>
                                {channelHocketOrder === "first" ? "from" : "from pair"}
                              </th>
                              {channelHocketMatrixChannels.map((channel) => (
                                <th key={`channel-to-${channel}`}>Ch {channel}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {channelHocketVisibleContexts.map((from) => (
                              <tr key={from.join("-")}>
                                <th>{from.map((channel) => `Ch ${channel}`).join(" → ")}</th>
                                {channelHocketMatrixChannels.map((to) => {
                                  const fromLabel = from
                                    .map((channel) => `Ch ${channel}`)
                                    .join(" to ");
                                  const toLabel = `Ch ${to}`;
                                  const targetId = channelTransitionAutomationTarget(
                                    channelHocketOrder,
                                    from,
                                    to
                                  );
                                  const share = channelWeightShare(
                                    channelHocketWeights,
                                    channelHocketMatrixChannels,
                                    channelHocketOrder,
                                    from,
                                    to
                                  );
                                  return (
                                    <td
                                      className="rhythm-heat-cell"
                                      data-hot={share > 0}
                                      key={`${from.join("-")}-${to}`}
                                      style={
                                        {
                                          background: transitionHeatBackground(share),
                                          boxShadow: transitionHeatShadow(share),
                                        } as CSSProperties
                                      }
                                      title={`${formatPct(share)} row share`}
                                    >
                                      <span className="matrix-weight-field">
                                        {renderAutomationFocusButton(
                                          `Channel weight ${fromLabel} to ${toLabel}`,
                                          [targetId]
                                        )}
                                        <NumericField
                                          aria-label={`channel weight ${from.join(" to ")} to ${to}`}
                                          min={0}
                                          max={999}
                                          numericMode="weight"
                                          data-automation-target={targetId}
                                          value={channelWeightValue(
                                            channelHocketWeights,
                                            channelHocketMatrixChannels,
                                            channelHocketOrder,
                                            from,
                                            to
                                          )}
                                          onValueCommit={(value) =>
                                            updateChannelHocketWeight(
                                              from,
                                              to,
                                              value
                                            )
                                          }
                                        />
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}

                {activeChannelHocketTabId === "entry" && (
                  <div className="channel-entry-stack">
                    <div className="rhythm-fallback-panel channel-entry-panel">
                      <div>
                        <strong>
                          Entry selector
                          {renderAutomationFocusButton(
                            "Channel entry selector",
                            channelHocketVisibleContexts.map((entry) =>
                              channelEntryAutomationTarget(channelHocketOrder, entry)
                            )
                          )}
                        </strong>
                        <span>First Markov context for a fresh channel chain.</span>
                      </div>
                      <div className="rhythm-fallback-weight-grid">
                        {channelHocketVisibleContexts.map((entry) => {
                          const label = entry
                            .map((channel) => `Ch ${channel}`)
                            .join(" -> ");
                          const targetId = channelEntryAutomationTarget(
                            channelHocketOrder,
                            entry
                          );
                          return (
                            <label key={entry.join("-")}>
                              {renderAutomationControlLabel(
                                label,
                                `Channel entry ${label}`,
                                [targetId]
                              )}
                              <NumericField
                                min={0}
                                max={999}
                                numericMode="weight"
                                step={1}
                                value={channelEntryWeight(entry)}
                                data-automation-target={targetId}
                                onValueCommit={(value) =>
                                  updateChannelHocketEntryWeight(
                                    entry,
                                    value
                                  )
                                }
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rhythm-fallback-panel channel-fallback-panel">
                      <div>
                        <strong>Weighted fallback pool</strong>
                        <span>Empty transition rows use the static fallback channel.</span>
                      </div>
                      <div className="rhythm-fallback-weight-grid">
                        {channelHocketMatrixChannels.map((channel) => (
                          <label key={channel}>
                            {renderAutomationControlLabel(
                              `Ch ${channel}`,
                              `Channel fallback ${channel}`,
                              [channelFallbackAutomationTarget(channel)]
                            )}
                            <NumericField
                              min={0}
                              max={999}
                              numericMode="weight"
                              step={1}
                              value={channelFallbackWeight(channel)}
                              data-automation-target={channelFallbackAutomationTarget(
                                channel
                              )}
                              onValueCommit={(value) =>
                                updateChannelHocketFallbackWeight(
                                  channel,
                                  value
                                )
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeChannelHocketTabId === "accents" && (
                  <div className="channel-accent-panel">
                    <div className="channel-accent-head">
                      <strong>Accent routing</strong>
                      <span>{activeChannelAccentRuleCount} active</span>
                      <button
                        className="tiny-button"
                        type="button"
                        onClick={resetChannelAccentRulesToVelocityBands}
                      >
                        velocity preset
                      </button>
                      <button
                        className="tiny-button"
                        type="button"
                        onClick={() =>
                          setChannelAccentRules(
                            cloneChannelAccentRules(DEFAULT_CHANNEL_ACCENT_RULES)
                          )
                        }
                      >
                        clear
                      </button>
                    </div>
                    <AccentRoutingVelocityGuide
                      baseVelocity={velocity}
                      sectionAccentMin={sectionAccentMin}
                      sectionAccentMax={sectionAccentMax}
                      beatAccentMin={beatAccentMin}
                      beatAccentMax={beatAccentMax}
                      jathiAccentMin={jathiAccentMin}
                      jathiAccentMax={jathiAccentMax}
                      jathiAccentMode={jathiAccentMode}
                      onEditBaseVelocity={openScoreSetupForVelocity}
                      onEditAccentRanges={openProbabilityForAccentRanges}
                    />
                    <div className="channel-accent-rules">
                      {channelAccentRules.map((rule, ruleIndex) => (
                        <section
                          className={`channel-accent-rule${
                            rule.enabled ? " is-enabled" : ""
                          }`}
                          key={`${rule.label}-${ruleIndex}`}
                        >
                          <div className="channel-accent-rule-head">
                            <Switch
                              size="sm"
                              isSelected={rule.enabled}
                              onChange={(value) =>
                                  updateChannelAccentRule(ruleIndex, {
                                    enabled: value,
                                  })}
                              data-automation-target={`channelHocket.accentRule.${ruleIndex}.enabled`}
                            >
                              {renderAutomationControlLabel(
                                `${rule.label} enabled`,
                                `${rule.label} enabled`,
                                [`channelHocket.accentRule.${ruleIndex}.enabled`]
                              )}
                            </Switch>
                            <label className="field-inline">
                              Mode
                              <select
                                value={rule.mode}
                                onChange={(e) =>
                                  updateChannelAccentRule(ruleIndex, {
                                    mode: normalizeChannelAccentMode(e.target.value),
                                  })
                                }
                              >
                                <option value="renderOnly">Render only</option>
                                <option value="driveChain">Drive chain</option>
                              </select>
                            </label>
                          </div>
                          <div className="channel-accent-rule-main">
                            <div className="channel-accent-range-pair">
                              <label className="field-inline">
                                {renderAutomationControlLabel(
                                  "Min velocity",
                                  `${rule.label} minimum velocity`,
                                  [`channelHocket.accentRule.${ruleIndex}.minVelocity`]
                                )}
                                <NumericField
                                  min={1}
                                  max={127}
                                  value={rule.minVelocity}
                                  data-automation-target={`channelHocket.accentRule.${ruleIndex}.minVelocity`}
                                  onValueCommit={(value) =>
                                    updateChannelAccentRule(ruleIndex, {
                                      minVelocity: value,
                                    })
                                  }
                                />
                              </label>
                              <label className="field-inline">
                                {renderAutomationControlLabel(
                                  "Max velocity",
                                  `${rule.label} maximum velocity`,
                                  [`channelHocket.accentRule.${ruleIndex}.maxVelocity`]
                                )}
                                <NumericField
                                  min={1}
                                  max={127}
                                  value={rule.maxVelocity}
                                  data-automation-target={`channelHocket.accentRule.${ruleIndex}.maxVelocity`}
                                  onValueCommit={(value) =>
                                    updateChannelAccentRule(ruleIndex, {
                                      maxVelocity: value,
                                    })
                                  }
                                />
                              </label>
                            </div>
                            <ControlRow
                              className="ratchet-slider channel-accent-chance"
                              label={renderAutomationControlLabel(
                                "Accent chance",
                                `${rule.label} accent chance`,
                                [
                                  `channelHocket.accentRule.${ruleIndex}.probabilityPercent`,
                                ]
                              )}
                              control={<SliderField
                                aria-label={`${rule.label} accent chance`}
                                min={0}
                                max={100}
                                value={rule.probabilityPercent}
                                data-automation-target={`channelHocket.accentRule.${ruleIndex}.probabilityPercent`}
                                onChange={(e) =>
                                  updateChannelAccentRule(ruleIndex, {
                                    probabilityPercent:
                                      parseInt(e.target.value, 10) || 0,
                                  })
                                }
                              />}
                              value={<output>{rule.probabilityPercent}%</output>}
                              range="0-100%"
                            />
                          </div>
                          <div className="channel-accent-weight-grid">
                            {channelHocketMatrixChannels.map((channel) => (
                              <label key={`${rule.label}-${channel}`}>
                                {renderAutomationControlLabel(
                                  `Ch ${channel}`,
                                  `${rule.label} channel ${channel} weight`,
                                  [channelAccentAutomationTarget(ruleIndex, channel)]
                                )}
                            <NumericField
                              min={0}
                              max={999}
                              numericMode="weight"
                              value={Math.round(rule.weights[String(channel)] ?? 0)}
                              data-automation-target={channelAccentAutomationTarget(
                                    ruleIndex,
                                    channel
                                  )}
                                  onValueCommit={(value) =>
                                    updateChannelAccentWeight(
                                      ruleIndex,
                                      channel,
                                      value
                                    )
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                )}

                {activeChannelHocketTabId === "positions" && (
                  <div className="channel-position-panel">
                    <div className="channel-position-head">
                      <strong>Position routing</strong>
                      <span>{activeChannelPositionRuleCount} active</span>
                      <button
                        className="tiny-button"
                        type="button"
                        onClick={addChannelPositionRule}
                      >
                        add
                      </button>
                      <button
                        className="tiny-button"
                        type="button"
                        onClick={() => setChannelPositionRules([])}
                      >
                        clear
                      </button>
                    </div>
                    {channelPositionRules.length === 0 ? (
                      <div className="channel-empty-state">No position rules.</div>
                    ) : (
                      <div className="channel-position-rules">
                        {channelPositionRules.map((rule, ruleIndex) => {
                          const enabledTarget = channelPositionEnabledAutomationTarget(
                            rule.id
                          );
                          const nthTarget = channelPositionNthAutomationTarget(rule.id);
                          return (
                            <section
                              className={`channel-position-rule${
                                rule.enabled ? " is-enabled" : ""
                              }`}
                              key={rule.id || ruleIndex}
                            >
                              <div className="channel-position-rule-head">
                                <Switch
                                  size="sm"
                                  isSelected={rule.enabled}
                                  onChange={(value) =>
                                    updateChannelPositionRule(ruleIndex, {
                                      enabled: value,
                                    })}
                                  data-automation-target={enabledTarget}
                                >
                                  {renderAutomationControlLabel(
                                    "enabled",
                                    `${rule.label} enabled`,
                                    [enabledTarget]
                                  )}
                                </Switch>
                                <ChannelPositionRuleLabelField
                                  ruleIndex={ruleIndex}
                                  label={rule.label}
                                  onCommit={(label) =>
                                    updateChannelPositionRule(ruleIndex, {
                                      label,
                                    })
                                  }
                                />
                                <button
                                  className="tiny-button"
                                  type="button"
                                  onClick={() => removeChannelPositionRule(ruleIndex)}
                                >
                                  remove
                                </button>
                              </div>
                              <div className="channel-position-rule-main">
                                <label className="field-inline">
                                  Scope
                                  <select
                                    value={rule.scope}
                                    onChange={(e) =>
                                      updateChannelPositionRule(ruleIndex, {
                                        scope:
                                          e.currentTarget
                                            .value as PatchChannelPositionRule["scope"],
                                      })
                                    }
                                  >
                                    <option value="beat">Beat</option>
                                    <option value="section">Section</option>
                                  </select>
                                </label>
                                <label className="field-inline">
                                  {renderAutomationControlLabel(
                                    "Nth note",
                                    `${rule.label} nth note`,
                                    [nthTarget]
                                  )}
                                  <NumericField
                                    min={1}
                                    max={999}
                                    value={rule.nth}
                                    data-automation-target={nthTarget}
                                    onValueCommit={(value) =>
                                      updateChannelPositionRule(ruleIndex, {
                                        nth: value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="field-inline">
                                  Reset
                                  <select
                                    value={rule.resetMode}
                                    onChange={(e) =>
                                      updateChannelPositionRule(ruleIndex, {
                                        resetMode:
                                          e.currentTarget
                                            .value as PatchChannelPositionRule["resetMode"],
                                      })
                                    }
                                  >
                                    <option value="staticFallback">Static fallback</option>
                                    <option value="weightedFallback">Weighted fallback</option>
                                    <option value="customWeighted">Custom weights</option>
                                  </select>
                                </label>
                              </div>
                              <div className="channel-position-action-grid">
                                {CHANNEL_POSITION_ACTION_CONTROLS.map((action) => {
                                  const targetId = channelPositionActionAutomationTarget(
                                    rule.id,
                                    action.key
                                  );
                                  return (
                                    <label key={action.key}>
                                      {renderAutomationControlLabel(
                                        action.label,
                                        `${rule.label} ${action.label} action weight`,
                                        [targetId]
                                      )}
                                      <NumericField
                                        min={0}
                                        max={999}
                                        numericMode="weight"
                                        value={rule.actionWeights[action.key]}
                                        data-automation-target={targetId}
                                        onValueCommit={(value) =>
                                          updateChannelPositionActionWeight(
                                            ruleIndex,
                                            action.key,
                                            value
                                          )
                                        }
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                              <div className="channel-position-weight-block">
                                <strong>Render channels</strong>
                                <div className="channel-position-weight-grid">
                                  {channelHocketMatrixChannels.map((channel) => {
                                    const targetId = channelPositionRenderAutomationTarget(
                                      rule.id,
                                      channel
                                    );
                                    return (
                                      <label key={`render-${rule.id}-${channel}`}>
                                        {renderAutomationControlLabel(
                                          `Ch ${channel}`,
                                          `${rule.label} render channel ${channel}`,
                                          [targetId]
                                        )}
                                        <NumericField
                                          min={0}
                                          max={999}
                                          numericMode="weight"
                                          value={Math.round(
                                            rule.renderWeights[String(channel)] ?? 0
                                          )}
                                          data-automation-target={targetId}
                                          onValueCommit={(value) =>
                                            updateChannelPositionRenderWeight(
                                              ruleIndex,
                                              channel,
                                              value
                                            )
                                          }
                                        />
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="channel-position-weight-block">
                                <strong>Reset channels</strong>
                                {rule.resetMode === "customWeighted" ? (
                                  <div className="channel-position-weight-grid">
                                    {channelHocketMatrixChannels.map((channel) => {
                                      const targetId = channelPositionResetAutomationTarget(
                                        rule.id,
                                        channel
                                      );
                                      return (
                                        <label key={`reset-${rule.id}-${channel}`}>
                                          {renderAutomationControlLabel(
                                            `Ch ${channel}`,
                                            `${rule.label} reset channel ${channel}`,
                                            [targetId]
                                          )}
                                          <NumericField
                                            min={0}
                                            max={999}
                                            numericMode="weight"
                                            value={Math.round(
                                              rule.resetWeights[String(channel)] ?? 0
                                            )}
                                            data-automation-target={targetId}
                                            onValueCommit={(value) =>
                                              updateChannelPositionResetWeight(
                                                ruleIndex,
                                                channel,
                                                value
                                              )
                                            }
                                          />
                                        </label>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="channel-position-reset-readout">
                                    {CHANNEL_POSITION_RESET_LABELS[rule.resetMode]}
                                  </span>
                                )}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

              </section>
            </div>
          </div>
          ) : null}
        </details>
  );
}
