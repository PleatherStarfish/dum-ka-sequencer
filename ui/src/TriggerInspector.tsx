/**
 * Triggered Tracks inspector.
 *
 * A live plain-language **summary** leads; the config is grouped by the
 * two-decision model — **Trigger** (what source event launches the follower)
 * and **Phrase** (where phrase beat 0 lands, how long it runs, retrigger
 * behavior) — with a **Basic / Advanced** disclosure so the common "fill a
 * rest" path is one glance and power features are one click away. The **Trace**
 * group renders the engine's decision trace in plain language.
 *
 * "Nothing lies": every enabled control maps to a real engine capability;
 * deferred capabilities are present but disabled; the summary and log are
 * generated from the same normalized config/trace the engine compiles, so they
 * can never drift from what plays.
 */
import { useState } from "react";
import { NumericField } from "./NumericField";
import { clamp, MAX_START_OPTIONS, MAX_START_WEIGHT } from "./patchIo";
import {
  buildTriggerPreset,
  defaultGateSpec,
  defaultStartSelect,
  describeDecisionLine,
  describeTrigger,
  editorToWhenSpec,
  perMilleToPercent,
  percentToPerMille,
  TRIGGER_PRESETS,
  TRIGGER_START_ALIGNMENTS,
  TRIGGER_WHEN_SUBJECTS,
  triggerLaunchAlignmentOfType,
  triggerQuantizeOfSelect,
  triggerQuantizeSelectValue,
  triggerWhenPredicateOfType,
  whenSpecToEditor,
  type WhenCombinator,
  type WhenEditorModel,
} from "./triggerUi";
import {
  filterTriggerDecisions,
  selectTriggerOverlayMarks,
  type TriggerLogFilter,
} from "./timelineModel";
import type {
  TriggerConfig,
  TriggerCountOp,
  TriggerDecisionEvent,
  TriggerGateSpec,
  TriggerQuantizeDirection,
  TriggerReTrigger,
  TriggerStartSelect,
  TriggerWhenSpec,
} from "./bridge";

import { Switch } from "./Switch";
const DEFAULT_WHEN: TriggerWhenSpec = {
  beats: { type: "at", beat: 0 },
  tree: { type: "leaf", predicate: { type: "isRest" } },
};

/** The two cycle-level count predicates share an op + count value control. */
type WhenCountPredicate =
  | { type: "restCountInCycle"; op: TriggerCountOp; count: number }
  | { type: "soundingCountInCycle"; op: TriggerCountOp; count: number };

export interface TriggerInspectorProps {
  /** The active track's trigger config, or `null` when continuous. */
  trigger: TriggerConfig | null;
  /** Playback lock — trigger config is read-only while playing. */
  isPlaying: boolean;
  /** Live state from the transport snapshot (armed vs running). */
  running: boolean;
  /** Valid source tracks (other, continuous tracks). */
  sourceOptions: { id: string; name: string }[];
  /** GATE decision trace for this track (from the snapshot), oldest→newest.
   * Read-only; renders the engine's own decisions so the log can't drift. */
  decisionEvents?: TriggerDecisionEvent[];
  /** Reference ticks per cycle, for positioning overlay marks by phase. */
  referenceCycleTicks?: number;
  /** Reference cycle beats, for the overlay strip's gridlines. */
  cycleBeats?: number;
  onSetMode: (mode: "continuous" | "triggered") => void;
  onUpdate: (mutate: (trigger: TriggerConfig) => TriggerConfig, status?: string) => void;
  onApplyPreset: (config: TriggerConfig) => void;
}

export function TriggerInspector({
  trigger,
  isPlaying,
  running,
  sourceOptions,
  decisionEvents,
  referenceCycleTicks,
  cycleBeats,
  onSetMode,
  onUpdate,
  onApplyPreset,
}: TriggerInspectorProps) {
  const locked = isPlaying;
  const canEnableTriggered = trigger !== null || sourceOptions.length > 0;

  // View state (read-only over the engine; never changes config).
  const [advanced, setAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [logFilter, setLogFilter] = useState<TriggerLogFilter>("all");
  const [showRejected, setShowRejected] = useState(false);

  // Decode the canonical WHEN tree into the flat editor model (or "custom" when
  // it nests beyond what the flat editor can show). Recomputed from live config.
  const whenModel: WhenEditorModel = whenSpecToEditor(trigger?.when ?? DEFAULT_WHEN);

  /** Mutate the flat WHEN model; a "custom" tree is left untouched. */
  const updateWhen = (
    transform: (model: Extract<WhenEditorModel, { kind: "flat" }>) => Extract<
      WhenEditorModel,
      { kind: "flat" }
    >,
    status?: string
  ) => {
    onUpdate((t) => {
      const model = whenSpecToEditor(t.when ?? DEFAULT_WHEN);
      if (model.kind !== "flat") return t;
      return { ...t, when: editorToWhenSpec(transform(model)) };
    }, status);
  };

  /** Mutate the (present) gate spec; seeds a neutral gate if none yet. */
  const updateGate = (transform: (gate: TriggerGateSpec) => TriggerGateSpec) => {
    onUpdate((t) => ({ ...t, gate: transform(t.gate ?? defaultGateSpec()) }));
  };

  /** Mutate the weighted START select; a no-op when START is in fixed mode. */
  const updateStartSelect = (transform: (select: TriggerStartSelect) => TriggerStartSelect) => {
    onUpdate((t) => (t.startSelect ? { ...t, startSelect: transform(t.startSelect) } : t));
  };

  const sourceName =
    sourceOptions.find((s) => s.id === trigger?.sourceTrackId)?.name ??
    trigger?.sourceTrackId ??
    "the source";

  const decisions = decisionEvents ?? [];
  const overlayMarks = selectTriggerOverlayMarks(decisions, {
    referenceCycleTicks: referenceCycleTicks ?? 0,
    showRejected,
  });
  const filteredDecisions = filterTriggerDecisions(decisions, logFilter);

  // Whether the WHEN config is editable in Basic mode (one plain condition).
  const whenIsSimple =
    whenModel.kind === "flat" &&
    whenModel.rows.length === 1 &&
    whenModel.combinator === "all";

  return (
    <div className="trigger-inspector" aria-label="Track trigger" data-testid="track-trigger-panel">
      {/* Top strip: relationship · state · source · observe · help */}
      <div className="trigger-strip">
        <label className="parallel-track-select-field">
          <span>Mode</span>
          <select
            aria-label="Track mode"
            data-testid="track-trigger-mode"
            value={trigger ? "triggered" : "continuous"}
            disabled={locked}
            onChange={(e) => onSetMode(e.target.value as "continuous" | "triggered")}
          >
            <option value="continuous">continuous</option>
            <option value="triggered" disabled={!canEnableTriggered}>
              triggered
            </option>
          </select>
        </label>
        {!trigger && sourceOptions.length === 0 ? (
          <span className="trigger-lock-note" data-testid="track-trigger-no-source">
            Add another continuous track to enable triggering.
          </span>
        ) : null}
        {trigger ? (
          <>
            <span
              className={`trigger-status${running ? " is-running" : " is-armed"}`}
              data-testid="track-trigger-status"
              title="A triggered track is armed until its trigger fires, then running."
            >
              {running ? "running" : "armed"}
            </span>
            <label className="parallel-track-select-field">
              <span>Source</span>
              <select
                aria-label="Trigger source track"
                data-testid="track-trigger-source"
                value={trigger.sourceTrackId}
                disabled={locked}
                onChange={(e) => onUpdate((t) => ({ ...t, sourceTrackId: e.target.value }))}
              >
                {sourceOptions.every((track) => track.id !== trigger.sourceTrackId) ? (
                  <option value={trigger.sourceTrackId}>
                    {trigger.sourceTrackId} (unavailable)
                  </option>
                ) : null}
                {sourceOptions.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </label>
            <span
              className="trigger-observe-note"
              data-testid="track-trigger-observe"
              title="Triggers observe resolved structure and generator output before channel routing."
            >
              observes structure + generator
            </span>
            <button
              type="button"
              className="trigger-help-toggle"
              data-testid="track-trigger-help"
              aria-label="How triggers work"
              aria-expanded={showHelp}
              title="How triggers work"
              onClick={() => setShowHelp((v) => !v)}
            >
              ?
            </button>
          </>
        ) : null}
      </div>

      {trigger ? (
        <>
          {locked ? (
            <div className="trigger-lock-note" data-testid="track-trigger-locked">
              Trigger setup is locked during playback. Stop transport to edit.
            </div>
          ) : null}
          {showHelp ? (
            <div className="trigger-help" data-testid="track-trigger-help-text">
              A triggered track listens to a source track. When the trigger
              condition passes, the follower launches from the start of phrase.
              <b> Trigger</b> sets the condition and gate; <b>Phrase</b> sets
              placement, length, snap-to-grid, and retrigger behavior.
            </div>
          ) : null}

          {/* SUMMARY — the headline: what this trigger does, in plain language. */}
          <p className="trigger-summary" data-testid="track-trigger-summary">
            {describeTrigger(trigger, sourceName)}
          </p>

          {/* Presets — pure config populators (no hidden mode). */}
          <div className="trigger-presets" aria-label="Trigger presets">
            <span className="trigger-presets-label">Preset</span>
            {TRIGGER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="trigger-preset-button"
                data-testid={`track-trigger-preset-${preset.id}`}
                disabled={locked || !preset.available}
                title={
                  preset.available
                    ? describeTrigger(buildTriggerPreset(preset.id, trigger.sourceTrackId), sourceName)
                    : preset.hint
                }
                onClick={() => {
                  if (locked || !preset.available) return;
                  onApplyPreset(buildTriggerPreset(preset.id, trigger.sourceTrackId));
                }}
              >
                {preset.label}
              </button>
            ))}
            <label className="trigger-detail-toggle" title="Show advanced controls.">
              <span>View</span>
              <select
                aria-label="Detail level"
                data-testid="track-trigger-detail"
                value={advanced ? "advanced" : "simple"}
                onChange={(e) => setAdvanced(e.target.value === "advanced")}
              >
                <option value="simple">Basic</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
          </div>

          {/* ───────── TRIGGER — when it fires ───────── */}
          <div className="trigger-group" data-testid="track-trigger-group-trigger">
            <div className="trigger-group-head">
              <b>Trigger</b>
              <em>source condition</em>
            </div>

            {/* WHEN — the condition tree. */}
            <section className="trigger-band" aria-label="When">
              <div className="trigger-band-head">
                <b>Trigger when</b>
                {advanced && whenModel.kind !== "custom" ? (
                  <label
                    className="trigger-band-match"
                    title="Combine rows with ALL (every row) or ANY (at least one)."
                  >
                    Match
                    <select
                      aria-label="Trigger match mode"
                      data-testid="track-trigger-match"
                      value={whenModel.combinator}
                      disabled={locked}
                      onChange={(e) =>
                        updateWhen((m) => ({ ...m, combinator: e.target.value as WhenCombinator }))
                      }
                    >
                      <option value="all">All</option>
                      <option value="any">Any</option>
                    </select>
                  </label>
                ) : null}
                <label
                  className="parallel-track-select-field"
                  title="Evaluate at one beat, or at every beat (a candidate per matching beat)."
                >
                  <span>Beat</span>
                  <select
                    aria-label="Trigger beat selector"
                    data-testid="track-trigger-when-beats"
                    value={whenModel.beats.type === "anyBeat" ? "anyBeat" : "at"}
                    disabled={locked || whenModel.kind === "custom"}
                    onChange={(e) =>
                      updateWhen((m) => ({
                        ...m,
                        beats:
                          e.target.value === "anyBeat"
                            ? { type: "anyBeat" }
                            : { type: "at", beat: m.beats.type === "at" ? m.beats.beat : 0 },
                      }))
                    }
                  >
                    <option value="at">beat index</option>
                    <option value="anyBeat">any beat</option>
                  </select>
                </label>
                {whenModel.beats.type === "at" ? (
                  <label
                    className="parallel-track-value-field"
                    title="0-based beat index: beat 0 is the first beat of the cycle"
                  >
                    <span>Beat index</span>
                    <NumericField
                      min={0}
                      max={63}
                      step={1}
                      value={whenModel.beats.beat}
                      aria-label="Trigger beat index (0-based)"
                      data-testid="track-trigger-when-beat"
                      disabled={locked || whenModel.kind === "custom"}
                      onValueCommit={(value) => {
                        const beat = clamp(value, 0, 63);
                        updateWhen((m) => ({ ...m, beats: { type: "at", beat } }));
                      }}
                    />
                  </label>
                ) : null}
              </div>

              {whenModel.kind === "custom" ? (
                <div className="trigger-row trigger-row-future" data-testid="track-trigger-when-custom">
                  Advanced nested condition (engine-valid, not editable here).{" "}
                  <button
                    type="button"
                    className="trigger-when-reset"
                    data-testid="track-trigger-when-reset"
                    disabled={locked}
                    onClick={() => onUpdate((t) => ({ ...t, when: DEFAULT_WHEN }))}
                  >
                    Replace with simple condition
                  </button>
                </div>
              ) : !advanced && !whenIsSimple ? (
                <div className="trigger-row trigger-row-future" data-testid="track-trigger-when-complex">
                  Multiple trigger conditions. Switch to Advanced to edit.
                </div>
              ) : (
                <>
                  {(advanced ? whenModel.rows : whenModel.rows.slice(0, 1)).map((row, i) => (
                    <div className="trigger-row" data-testid={`track-trigger-when-row-${i}`} key={i}>
                      {advanced ? (
                        <Switch
                          size="sm"
                          isSelected={row.negated}
                          isDisabled={locked}
                          onChange={(value) => {
                              const negated = value;
                              updateWhen((m) => ({
                                ...m,
                                rows: m.rows.map((r, j) => (j === i ? { ...r, negated } : r)),
                              }));
                            }}
                          aria-label={`Negate condition ${i + 1}`}
                          data-testid={`track-trigger-when-not-${i}`}
                          title="Negate this row (NOT)."
                        >
                          not
                        </Switch>
                      ) : null}
                      <label className="parallel-track-select-field">
                        <span>Condition</span>
                        <select
                          aria-label={`Trigger condition ${i + 1}`}
                          data-testid={`track-trigger-when-subject-${i}`}
                          value={row.predicate.type}
                          disabled={locked}
                          onChange={(e) => {
                            const value = e.target.value;
                            updateWhen((m) => ({
                              ...m,
                              rows: m.rows.map((r, j) =>
                                j === i
                                  ? { ...r, predicate: triggerWhenPredicateOfType(value, r.predicate) }
                                  : r
                              ),
                            }));
                          }}
                        >
                          {TRIGGER_WHEN_SUBJECTS.map((s) => (
                            <option key={s.type} value={s.type}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      {row.predicate.type === "gatiIs" ? (
                        <label className="parallel-track-value-field">
                          <span>Subdivision</span>
                          <NumericField
                            min={1}
                            max={32}
                            step={1}
                            value={row.predicate.gati}
                            aria-label={`Trigger subdivision ${i + 1}`}
                            data-testid={`track-trigger-when-gati-${i}`}
                            disabled={locked}
                            onValueCommit={(value) => {
                              const gati = clamp(value, 1, 32);
                              updateWhen((m) => ({
                                ...m,
                                rows: m.rows.map((r, j) =>
                                  j === i ? { ...r, predicate: { type: "gatiIs", gati } } : r
                                ),
                              }));
                            }}
                          />
                        </label>
                      ) : null}

                      {row.predicate.type === "matraIsRest" ||
                      row.predicate.type === "matraIsSounding" ? (
                        <label
                          className="parallel-track-value-field"
                          title="0-based pulse index within the beat"
                        >
                          <span>Pulse</span>
                          <NumericField
                            min={0}
                            max={63}
                            step={1}
                            value={row.predicate.matra}
                            aria-label={`Trigger pulse ${i + 1}`}
                            data-testid={`track-trigger-when-matra-${i}`}
                            disabled={locked}
                            onValueCommit={(value) => {
                              const matra = clamp(value, 0, 63);
                              const type =
                                row.predicate.type === "matraIsSounding"
                                  ? "matraIsSounding"
                                  : "matraIsRest";
                              updateWhen((m) => ({
                                ...m,
                                rows: m.rows.map((r, j) =>
                                  j === i ? { ...r, predicate: { type, matra } } : r
                                ),
                              }));
                            }}
                          />
                        </label>
                      ) : null}

                      {row.predicate.type === "restCountInCycle" ||
                      row.predicate.type === "soundingCountInCycle"
                        ? ((pred: WhenCountPredicate) => (
                            <>
                              <label className="parallel-track-select-field">
                                <span>Op</span>
                                <select
                                  aria-label={`Count comparison ${i + 1}`}
                                  data-testid={`track-trigger-when-op-${i}`}
                                  value={pred.op}
                                  disabled={locked}
                                  onChange={(e) => {
                                    const op = e.target.value as TriggerCountOp;
                                    const next: WhenCountPredicate = { ...pred, op };
                                    updateWhen((m) => ({
                                      ...m,
                                      rows: m.rows.map((r, j) =>
                                        j === i ? { ...r, predicate: next } : r
                                      ),
                                    }));
                                  }}
                                >
                                  <option value="atLeast">at least</option>
                                  <option value="atMost">at most</option>
                                  <option value="exactly">exactly</option>
                                  <option value="moreThan">more than</option>
                                  <option value="lessThan">less than</option>
                                </select>
                              </label>
                              <label className="parallel-track-value-field">
                                <span>Count</span>
                                <NumericField
                                  min={0}
                                  max={256}
                                  step={1}
                                  value={pred.count}
                                  aria-label={`Count threshold ${i + 1}`}
                                  data-testid={`track-trigger-when-count-${i}`}
                                  disabled={locked}
                                  onValueCommit={(value) => {
                                    const count = clamp(value, 0, 256);
                                    const next: WhenCountPredicate = { ...pred, count };
                                    updateWhen((m) => ({
                                      ...m,
                                      rows: m.rows.map((r, j) =>
                                        j === i ? { ...r, predicate: next } : r
                                      ),
                                    }));
                                  }}
                                />
                              </label>
                            </>
                          ))(row.predicate)
                        : null}

                      {advanced ? (
                        <button
                          type="button"
                          className="trigger-when-remove"
                          aria-label={`Remove condition ${i + 1}`}
                          data-testid={`track-trigger-when-remove-${i}`}
                          disabled={locked || whenModel.rows.length <= 1}
                          onClick={() =>
                            updateWhen((m) =>
                              m.rows.length <= 1
                                ? m
                                : { ...m, rows: m.rows.filter((_, j) => j !== i) }
                            )
                          }
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {advanced ? (
                    <div className="trigger-row">
                      <button
                        type="button"
                        className="trigger-when-add"
                        data-testid="track-trigger-when-add"
                        disabled={locked}
                        onClick={() =>
                          updateWhen((m) => ({
                            ...m,
                            rows: [...m.rows, { negated: false, predicate: { type: "isRest" } }],
                          }))
                        }
                      >
                        + Add trigger condition
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </section>

            {/* GATE — only sometimes (probability · cooldown · miss-boost). Advanced. */}
            {advanced ? (
              <section className="trigger-band" aria-label="Gate" data-testid="track-trigger-gate">
                <div className="trigger-band-head">
                  <b>Gate</b>
                  <em>probability · minimum gap · miss boost</em>
                  <Switch
                    size="sm"
                    isSelected={trigger.gate != null}
                    isDisabled={locked}
                    onChange={(value) =>
                        onUpdate((t) => ({
                          ...t,
                          gate: value ? (t.gate ?? defaultGateSpec()) : null,
                        }))}
                    aria-label="Enable gate"
                    data-testid="track-trigger-gate-enabled"
                    title="Accept or reject a matched candidate before launch. Off ⇒ always accept."
                  >
                    enabled
                  </Switch>
                </div>
                {trigger.gate ? (
                  <div className="trigger-row" data-testid="track-trigger-gate-row">
                    <label
                      className="parallel-track-value-field"
                      title="Chance a matched candidate is accepted (seeded, reproducible)"
                    >
                      <span>Probability</span>
                      <NumericField
                        min={0}
                        max={100}
                        step={1}
                        value={perMilleToPercent(trigger.gate.probabilityPerMille)}
                        aria-label="Gate probability percent"
                        data-testid="track-trigger-gate-probability"
                        disabled={locked}
                        onValueCommit={(value) => {
                          const pct = clamp(value, 0, 100);
                          updateGate((g) => ({ ...g, probabilityPerMille: percentToPerMille(pct) }));
                        }}
                      />
                    </label>
                    <label
                      className="parallel-track-value-field"
                      title="Minimum source cycles between accepts (0 = none)"
                    >
                      <span>Min gap</span>
                      <NumericField
                        min={0}
                        max={64}
                        step={1}
                        value={trigger.gate.cooldownCycles}
                        aria-label="Gate cooldown cycles"
                        data-testid="track-trigger-gate-cooldown"
                        disabled={locked}
                        onValueCommit={(value) => {
                          const c = clamp(value, 0, 64);
                          updateGate((g) => ({ ...g, cooldownCycles: c }));
                        }}
                      />
                    </label>
                    <label
                      className="parallel-track-value-field"
                      title="Added to probability after each consecutive miss"
                    >
                      <span>Miss boost</span>
                      <NumericField
                        min={0}
                        max={100}
                        step={1}
                        value={perMilleToPercent(trigger.gate.missBoostPerMille)}
                        aria-label="Gate miss boost percent"
                        data-testid="track-trigger-gate-miss-boost"
                        disabled={locked}
                        onValueCommit={(value) => {
                          const pct = clamp(value, 0, 100);
                          updateGate((g) => ({ ...g, missBoostPerMille: percentToPerMille(pct) }));
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="trigger-row trigger-row-future" data-testid="track-trigger-gate-off">
                    Gate off. Every matched candidate launches unless retrigger policy suppresses it.
                  </div>
                )}
              </section>
            ) : null}
          </div>

          {/* ───────── PHRASE — placement, duration, retrigger ───────── */}
          <div className="trigger-group" data-testid="track-trigger-group-play">
            <div className="trigger-group-head">
              <b>Phrase</b>
              <em>start · length · retrigger</em>
            </div>

            {/* START — where the follower's beat 0 lands. */}
            <section className="trigger-band" aria-label="Start">
              <div className="trigger-band-head">
                <b>Start of phrase</b>
                {advanced ? (
                  <label
                    className="trigger-band-match"
                    title="One fixed placement, or a seeded weighted choice among placements."
                  >
                    Placement
                    <select
                      aria-label="Start mode"
                      data-testid="track-trigger-start-mode"
                      value={trigger.startSelect ? "weighted" : "fixed"}
                      disabled={locked}
                      onChange={(e) =>
                        onUpdate((t) => ({
                          ...t,
                          startSelect:
                            e.target.value === "weighted"
                              ? (t.startSelect ?? defaultStartSelect(t.launchAlignment))
                              : null,
                        }))
                      }
                    >
                      <option value="fixed">Fixed</option>
                      <option value="weighted">Weighted</option>
                    </select>
                  </label>
                ) : null}
              </div>

              {trigger.startSelect && !advanced ? (
                <div className="trigger-row trigger-row-future" data-testid="track-trigger-start-weighted-note">
                  Weighted start placement. Switch to Advanced to edit.
                </div>
              ) : trigger.startSelect ? (
                ((select: TriggerStartSelect) => (
                  <>
                    {select.options.map((opt, i) => (
                      <div className="trigger-row" data-testid={`track-trigger-start-option-${i}`} key={i}>
                        <label className="parallel-track-select-field">
                          <span>Placement</span>
                          <select
                            aria-label={`Start of phrase placement ${i + 1}`}
                            data-testid={`track-trigger-start-align-${i}`}
                            value={opt.alignment.type}
                            disabled={locked}
                            onChange={(e) => {
                              const value = e.target.value;
                              updateStartSelect((s) => ({
                                ...s,
                                options: s.options.map((o, j) =>
                                  j === i
                                    ? { ...o, alignment: triggerLaunchAlignmentOfType(value) }
                                    : o
                                ),
                              }));
                            }}
                          >
                            {TRIGGER_START_ALIGNMENTS.map((a) => (
                              <option key={a.type} value={a.type}>
                                {a.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="parallel-track-value-field" title="Relative selection weight">
                          <span>Weight</span>
                          <NumericField
                            min={0}
                            max={MAX_START_WEIGHT}
                            numericMode="weight"
                            step={1}
                            value={opt.weight}
                            aria-label={`Start weight ${i + 1}`}
                            data-testid={`track-trigger-start-weight-${i}`}
                            disabled={locked}
                            onValueCommit={(value) => {
                              const w = clamp(value, 0, MAX_START_WEIGHT);
                              updateStartSelect((s) => ({
                                ...s,
                                options: s.options.map((o, j) => (j === i ? { ...o, weight: w } : o)),
                              }));
                            }}
                          />
                        </label>
                        {opt.alignment.type === "afterEventTicks" ? (
                          <label className="parallel-track-value-field">
                            <span>Ticks</span>
                            <NumericField
                              min={0}
                              max={1000000}
                              step={1}
                              value={opt.alignment.ticks}
                              aria-label={`Start offset ticks ${i + 1}`}
                              data-testid={`track-trigger-start-after-ticks-${i}`}
                              disabled={locked}
                              onValueCommit={(value) => {
                                const ticks = clamp(value, 0, 1000000);
                                updateStartSelect((s) => ({
                                  ...s,
                                  options: s.options.map((o, j) =>
                                    j === i && o.alignment.type === "afterEventTicks"
                                      ? { ...o, alignment: { type: "afterEventTicks", ticks } }
                                      : o
                                  ),
                                }));
                              }}
                            />
                          </label>
                        ) : null}
                        <button
                          type="button"
                          className="trigger-when-remove"
                          aria-label={`Remove start option ${i + 1}`}
                          data-testid={`track-trigger-start-remove-${i}`}
                          disabled={locked || select.options.length <= 1}
                          onClick={() =>
                            updateStartSelect((s) =>
                              s.options.length <= 1
                                ? s
                                : { ...s, options: s.options.filter((_, j) => j !== i) }
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <div className="trigger-row">
                      <button
                        type="button"
                        className="trigger-when-add"
                        data-testid="track-trigger-start-add"
                        disabled={locked || select.options.length >= MAX_START_OPTIONS}
                        onClick={() =>
                          updateStartSelect((s) => ({
                            ...s,
                            options:
                              s.options.length >= MAX_START_OPTIONS
                                ? s.options
                                : [...s.options, { alignment: { type: "atEvent" }, weight: 1 }],
                          }))
                        }
                      >
                        + Add weighted placement
                      </button>
                    </div>
                  </>
                ))(trigger.startSelect)
              ) : (
                <div className="trigger-row">
                  <label className="parallel-track-select-field">
                    <span>Placement</span>
                    <select
                      aria-label="Launch alignment"
                      data-testid="track-trigger-align"
                      value={trigger.launchAlignment.type}
                      disabled={locked}
                      onChange={(e) =>
                        onUpdate((t) => ({
                          ...t,
                          launchAlignment: triggerLaunchAlignmentOfType(e.target.value),
                        }))
                      }
                    >
                      {TRIGGER_START_ALIGNMENTS.map((a) => (
                        <option key={a.type} value={a.type}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {trigger.launchAlignment.type === "afterEventTicks" ? (
                    <label className="parallel-track-value-field">
                      <span>Ticks</span>
                      <NumericField
                        min={0}
                        max={1000000}
                        step={1}
                        value={trigger.launchAlignment.ticks}
                        aria-label="Launch offset ticks"
                        data-testid="track-trigger-after-ticks"
                        disabled={locked}
                        onValueCommit={(value) =>
                          onUpdate((t) => ({
                            ...t,
                            launchAlignment: {
                              type: "afterEventTicks",
                              ticks: clamp(value, 0, 1000000),
                            },
                          }))
                        }
                      />
                    </label>
                  ) : null}
                </div>
              )}

              {/* Snap (quantize) — advanced only. */}
              {advanced ? (
                <div className="trigger-row">
                  <label className="parallel-track-select-field">
                    <span>Snap to grid</span>
                    <select
                      aria-label="Launch quantize grid"
                      data-testid="track-trigger-quantize"
                      value={triggerQuantizeSelectValue(trigger.launchQuantize)}
                      disabled={locked}
                      onChange={(e) =>
                        onUpdate((t) => ({
                          ...t,
                          launchQuantize: triggerQuantizeOfSelect(
                            e.target.value,
                            t.launchQuantize?.direction ?? "next"
                          ),
                        }))
                      }
                    >
                      <option value="off">off</option>
                      <option value="fraction">1/N beat</option>
                      <option value="multiple">N beats</option>
                      <option value="gati">source subdivision</option>
                    </select>
                  </label>
                  {trigger.launchQuantize?.grid.type === "referenceBeatFraction" ? (
                    <label className="parallel-track-value-field">
                      <span>1/N</span>
                      <NumericField
                        min={1}
                        max={64}
                        step={1}
                        value={trigger.launchQuantize.grid.divisions}
                        aria-label="Quantize beat divisions"
                        disabled={locked}
                        onValueCommit={(value) =>
                          onUpdate((t) => ({
                            ...t,
                            launchQuantize: {
                              grid: {
                                type: "referenceBeatFraction",
                                divisions: clamp(value, 1, 64),
                              },
                              direction: t.launchQuantize?.direction ?? "next",
                            },
                          }))
                        }
                      />
                    </label>
                  ) : null}
                  {trigger.launchQuantize?.grid.type === "referenceBeatMultiple" ? (
                    <label className="parallel-track-value-field">
                      <span>Beats</span>
                      <NumericField
                        min={1}
                        max={64}
                        step={1}
                        value={trigger.launchQuantize.grid.beats}
                        aria-label="Quantize beat multiple"
                        disabled={locked}
                        onValueCommit={(value) =>
                          onUpdate((t) => ({
                            ...t,
                            launchQuantize: {
                              grid: {
                                type: "referenceBeatMultiple",
                                beats: clamp(value, 1, 64),
                              },
                              direction: t.launchQuantize?.direction ?? "next",
                            },
                          }))
                        }
                      />
                    </label>
                  ) : null}
                  {trigger.launchQuantize ? (
                    <label className="parallel-track-select-field">
                      <span>Round</span>
                      <select
                        aria-label="Quantize direction"
                        data-testid="track-trigger-quantize-dir"
                        value={trigger.launchQuantize.direction}
                        disabled={locked}
                        onChange={(e) =>
                          onUpdate((t) =>
                            t.launchQuantize
                              ? {
                                  ...t,
                                  launchQuantize: {
                                    ...t.launchQuantize,
                                    direction: e.target.value as TriggerQuantizeDirection,
                                  },
                                }
                              : t
                          )
                        }
                      >
                        <option value="next">next</option>
                        <option value="nearest">nearest</option>
                        <option value="previous">previous</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : null}
            </section>

            {/* RUN — phrase length + (advanced) retrigger policy. */}
            <section className="trigger-band" aria-label="Run">
              <div className="trigger-band-head">
                <b>Phrase length</b>
                <em>duration · repeats</em>
              </div>
              <div className="trigger-row">
                <label className="parallel-track-select-field">
                  <span>Length</span>
                  <select
                    aria-label="Trigger length"
                    data-testid="track-trigger-length"
                    value={trigger.length.type}
                    disabled={locked}
                    onChange={(e) =>
                      onUpdate((t) => ({
                        ...t,
                        length:
                          e.target.value === "fixedBeats"
                            ? { type: "fixedBeats", beats: 2 }
                            : { type: "scoreCycle" },
                      }))
                    }
                  >
                    <option value="scoreCycle">score cycle</option>
                    <option value="fixedBeats">fixed beats</option>
                  </select>
                </label>
                {trigger.length.type === "fixedBeats" ? (
                  <label className="parallel-track-value-field">
                    <span>Beats</span>
                    <NumericField
                      min={1}
                      max={64}
                      step={1}
                      value={trigger.length.beats}
                      aria-label="Trigger length beats"
                      disabled={locked}
                      onValueCommit={(value) =>
                        onUpdate((t) => ({
                          ...t,
                          length: {
                            type: "fixedBeats",
                            beats: clamp(value, 1, 64),
                          },
                        }))
                      }
                    />
                  </label>
                ) : null}
                <label className="parallel-track-select-field">
                  <span>Repeat</span>
                  <select
                    aria-label="Trigger lifetime"
                    data-testid="track-trigger-lifetime"
                    value={trigger.lifetime.type}
                    disabled={locked}
                    onChange={(e) =>
                      onUpdate((t) => ({
                        ...t,
                        lifetime:
                          e.target.value === "repeats"
                            ? { type: "repeats", passes: 2 }
                            : { type: "onePass" },
                      }))
                    }
                  >
                    <option value="onePass">once</option>
                    <option value="repeats">repeat</option>
                  </select>
                </label>
                {trigger.lifetime.type === "repeats" ? (
                  <label className="parallel-track-value-field">
                    <span>Passes</span>
                    <NumericField
                      min={1}
                      max={64}
                      step={1}
                      value={trigger.lifetime.passes}
                      aria-label="Trigger passes"
                      disabled={locked}
                      onValueCommit={(value) =>
                        onUpdate((t) => ({
                          ...t,
                          lifetime: {
                            type: "repeats",
                            passes: clamp(value, 1, 64),
                          },
                        }))
                      }
                    />
                  </label>
                ) : null}
                {advanced ? (
                  <label
                    className="parallel-track-select-field"
                    title="What a fresh trigger does while this one is still running."
                  >
                    <span>Retrigger</span>
                    <select
                      aria-label="Retrigger policy"
                      data-testid="track-trigger-retrigger"
                      value={trigger.reTrigger}
                      disabled={locked}
                      onChange={(e) =>
                        onUpdate((t) => ({ ...t, reTrigger: e.target.value as TriggerReTrigger }))
                      }
                    >
                      <option value="restart">restart</option>
                      <option value="ignore">ignore</option>
                      <option value="queue">queue</option>
                    </select>
                  </label>
                ) : null}
              </div>
            </section>
          </div>

          {/* ───────── TRACE — decisions from the engine trace ───────── */}
          {decisions.length > 0 ? (
            <div className="trigger-group" data-testid="track-trigger-group-activity">
              <div className="trigger-group-head">
                <b>Trace</b>
                <em>engine decisions</em>
              </div>

              <section
                className="trigger-band"
                aria-label="Trigger timeline"
                data-testid="track-trigger-timeline"
              >
                <div className="trigger-band-head">
                  <b>Timeline</b>
                  <em>one cycle</em>
                  <span className="trigger-overlay-legend" aria-hidden="true">
                    <i className="trigger-overlay-mark trigger-overlay-launched" /> launched
                    <i className="trigger-overlay-event" /> matched
                  </span>
                  <Switch
                    size="sm"
                    isSelected={showRejected}
                    onChange={(value) => setShowRejected(value)}
                    aria-label="Show suppressed candidates"
                    data-testid="track-trigger-inspect"
                    title="Also show suppressed candidates (faint)."
                  >
                    inspect
                  </Switch>
                </div>
                <div className="trigger-overlay" data-testid="track-trigger-overlay">
                  {cycleBeats && cycleBeats > 0
                    ? Array.from({ length: cycleBeats + 1 }, (_, i) => (
                        <i
                          className="trigger-overlay-grid"
                          key={`grid-${i}`}
                          style={{ left: `${(i / cycleBeats) * 100}%` }}
                        />
                      ))
                    : null}
                  {overlayMarks.length === 0 ? (
                    <span className="trigger-overlay-empty">no candidates this window</span>
                  ) : (
                    overlayMarks.map((m) => {
                      const lo = Math.min(m.eventFraction, m.placementFraction) * 100;
                      const hi = Math.max(m.eventFraction, m.placementFraction) * 100;
                      return (
                        <span
                          key={m.key}
                          className="trigger-overlay-group"
                          data-testid="track-trigger-overlay-mark"
                          data-outcome={m.outcome}
                        >
                          {hi > lo ? (
                            <i
                              className="trigger-overlay-connector"
                              style={{ left: `${lo}%`, width: `${hi - lo}%` }}
                            />
                          ) : null}
                          <i
                            className="trigger-overlay-event"
                            style={{ left: `${m.eventFraction * 100}%` }}
                            title={`matched beat ${m.matchedBeat} · cycle ${m.sourceCycleIndex}`}
                          />
                          <i
                            className={`trigger-overlay-mark trigger-overlay-${m.outcome}`}
                            style={{ left: `${m.placementFraction * 100}%` }}
                            title={`${m.outcome} · start ${m.startKind}${
                              m.rollValue != null ? ` · roll ${m.rollValue}/${m.rollThreshold}` : ""
                            }`}
                          />
                        </span>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="trigger-band" aria-label="Gate log" data-testid="track-trigger-log">
                <div className="trigger-band-head">
                  <b>Log</b>
                  <em>launch decisions</em>
                  <label className="trigger-band-match" title="Filter the log by outcome.">
                    <select
                      aria-label="Log filter"
                      data-testid="track-trigger-log-filter"
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value as TriggerLogFilter)}
                    >
                      <option value="all">all</option>
                      <option value="launched">launched</option>
                      <option value="queued">queued</option>
                      <option value="suppressed">suppressed</option>
                    </select>
                  </label>
                </div>
                {filteredDecisions.length === 0 ? (
                  <div className="trigger-row trigger-row-future" data-testid="track-trigger-log-empty">
                    nothing here yet
                  </div>
                ) : (
                  <ul className="trigger-log">
                    {filteredDecisions
                      .slice(-8)
                      .reverse()
                      .map((d, i) => (
                        <li
                          key={`${d.sourceCycleIndex}-${d.matchedBeat}-${i}`}
                          className={`trigger-log-${d.outcome}`}
                          data-testid="track-trigger-log-line"
                        >
                          cycle {d.sourceCycleIndex}, beat {d.matchedBeat}: {describeDecisionLine(d)}
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}

          {/* Roadmap — what's coming (advanced only, so day-to-day has no dead-ends). */}
          {advanced ? (
            <p className="trigger-roadmap" data-testid="track-trigger-roadmap">
              Coming later: until-stop and end-at-source-return lengths, accent or
              cadence start rotation, post-score and cross-track trigger conditions.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
