/**
 * Pure helpers for the Triggered Tracks inspector UI (`docs/TRIGGER_UI_PLAN.md`):
 * select↔config mappings, the WHEN-tree editor model, and preset builders.
 *
 * The inspector drives the engine config (`TriggerConfig`) with instrument terms:
 * trigger condition, gate, start of phrase, snap to grid, phrase length, and
 * retrigger behavior. Presets only ever produce engine-expressible configs.
 *
 * Keep this module free of React and Tauri imports.
 */
import type {
  TriggerBeatSelector,
  TriggerConditionNode,
  TriggerConfig,
  TriggerCountOp,
  TriggerDecisionEvent,
  TriggerGateSpec,
  TriggerLaunchAlignment,
  TriggerLaunchQuantize,
  TriggerLength,
  TriggerQuantizeDirection,
  TriggerReTrigger,
  TriggerStartSelect,
  TriggerWhenPredicate,
  TriggerWhenSpec,
} from "./bridge";

/** A fresh weighted START seeded from the current fixed alignment (Phase D).
 * One option ⇒ behaves like the fixed alignment until the user adds more. */
export function defaultStartSelect(alignment: TriggerLaunchAlignment): TriggerStartSelect {
  return { options: [{ alignment, weight: 1 }], seed: 0 };
}

/** Per-mille ⇄ percent helpers for the GATE band (engine stores per-mille).
 * Display is exact (655‰ ⇒ 65.5%), not rounded to whole percent, so a
 * per-mille value round-trips unchanged through the 0.1%-step fields. */
export const GATE_PROBABILITY_MAX_PER_MILLE = 1000;

export function perMilleToPercent(perMille: number): number {
  return perMille / 10;
}

export function percentToPerMille(percent: number): number {
  return Math.round(Math.min(100, Math.max(0, percent)) * 10);
}

/** A neutral, always-accept gate (probability 1000, no cooldown/boost). */
export function defaultGateSpec(): TriggerGateSpec {
  return {
    probabilityPerMille: GATE_PROBABILITY_MAX_PER_MILLE,
    cooldownCycles: 0,
    missBoostPerMille: 0,
    seed: 0,
  };
}

const REFERENCE_BEAT_TICKS = 960;

// --- select-value ↔ config mappings (used by the inspector) ----------------

// --- WHEN-tree editor model (Phase B) ---------------------------------------
//
// The inspector edits a *flat* tree: a single ALL/ANY combinator over rows,
// where each row is a predicate with an optional per-row NOT. That covers every
// shape the UI can build. A tree that nests deeper than one level (e.g. an ANY
// inside an ALL) is "custom": still valid for the engine, but the flat editor
// can't represent it, so the inspector shows it read-only rather than lying.

export type WhenCombinator = "all" | "any";

export interface WhenRow {
  negated: boolean;
  predicate: TriggerWhenPredicate;
}

export type WhenEditorModel =
  | { kind: "flat"; combinator: WhenCombinator; beats: TriggerBeatSelector; rows: WhenRow[] }
  | { kind: "custom"; beats: TriggerBeatSelector; tree: TriggerConditionNode };

/** A selectable WHEN subject + the extra value control it needs (if any). */
export interface WhenSubject {
  type: TriggerWhenPredicate["type"];
  label: string;
  value: "none" | "gati" | "matra" | "count";
}

/** Catalog for the per-row subject select. Every entry maps to a real engine
 * predicate (`cseq_trigger::WhenPredicate`), so all are enabled. */
export const TRIGGER_WHEN_SUBJECTS: readonly WhenSubject[] = [
  { type: "isRest", label: "beat is rest", value: "none" },
  { type: "isSounding", label: "beat is sounding", value: "none" },
  { type: "isSectionStart", label: "section start", value: "none" },
  { type: "hasJathiPulse", label: "grouping pulse", value: "none" },
  { type: "gatiIs", label: "subdivision is", value: "gati" },
  { type: "matraIsRest", label: "pulse is rest", value: "matra" },
  { type: "matraIsSounding", label: "pulse is sounding", value: "matra" },
  { type: "restCountInCycle", label: "rest count", value: "count" },
  { type: "soundingCountInCycle", label: "sounding count", value: "count" },
] as const;

/**
 * Build a fresh predicate of `type`, carrying over compatible numeric fields
 * from `prev` so switching subjects does not silently lose a typed value.
 */
export function triggerWhenPredicateOfType(
  type: string,
  prev?: TriggerWhenPredicate
): TriggerWhenPredicate {
  const gati = prev?.type === "gatiIs" ? prev.gati : 4;
  const matra =
    prev?.type === "matraIsRest" || prev?.type === "matraIsSounding" ? prev.matra : 0;
  const op =
    prev?.type === "restCountInCycle" || prev?.type === "soundingCountInCycle"
      ? prev.op
      : "atLeast";
  const count =
    prev?.type === "restCountInCycle" || prev?.type === "soundingCountInCycle" ? prev.count : 1;
  switch (type) {
    case "isSounding":
      return { type: "isSounding" };
    case "isSectionStart":
      return { type: "isSectionStart" };
    case "hasJathiPulse":
      return { type: "hasJathiPulse" };
    case "gatiIs":
      return { type: "gatiIs", gati };
    case "matraIsRest":
      return { type: "matraIsRest", matra };
    case "matraIsSounding":
      return { type: "matraIsSounding", matra };
    case "restCountInCycle":
      return { type: "restCountInCycle", op, count };
    case "soundingCountInCycle":
      return { type: "soundingCountInCycle", op, count };
    default:
      return { type: "isRest" };
  }
}

function leafToRow(node: TriggerConditionNode): WhenRow | null {
  if (node.type === "leaf") return { negated: false, predicate: node.predicate };
  if (node.type === "not" && node.node.type === "leaf") {
    return { negated: true, predicate: node.node.predicate };
  }
  return null;
}

/** Decode a `WhenSpec` into the flat editor model, or `custom` when its tree
 * nests beyond one ALL/ANY-of-(maybe-NOT)-leaves level. */
export function whenSpecToEditor(when: TriggerWhenSpec): WhenEditorModel {
  const { beats, tree } = when;
  const single = leafToRow(tree);
  if (single) return { kind: "flat", combinator: "all", beats, rows: [single] };
  if (tree.type === "all" || tree.type === "any") {
    const rows: WhenRow[] = [];
    for (const child of tree.nodes) {
      const row = leafToRow(child);
      if (!row) return { kind: "custom", beats, tree };
      rows.push(row);
    }
    if (rows.length === 0) {
      return {
        kind: "flat",
        combinator: tree.type,
        beats,
        rows: [{ negated: false, predicate: { type: "isRest" } }],
      };
    }
    return { kind: "flat", combinator: tree.type, beats, rows };
  }
  return { kind: "custom", beats, tree };
}

/** Encode a flat editor model back into a canonical `WhenSpec`. Always wraps in
 * the chosen combinator (so ALL/ANY survives a round-trip even with one row);
 * an empty model floors to a single `isRest` leaf. */
export function editorToWhenSpec(model: Extract<WhenEditorModel, { kind: "flat" }>): TriggerWhenSpec {
  const nodes: TriggerConditionNode[] = model.rows.map((row) =>
    row.negated
      ? { type: "not", node: { type: "leaf", predicate: row.predicate } }
      : { type: "leaf", predicate: row.predicate }
  );
  if (nodes.length === 0) {
    return { beats: model.beats, tree: { type: "leaf", predicate: { type: "isRest" } } };
  }
  return { beats: model.beats, tree: { type: model.combinator, nodes } };
}

export function triggerLaunchAlignmentOfType(type: string): TriggerLaunchAlignment {
  switch (type) {
    case "atSourceCycleStart":
      return { type: "atSourceCycleStart" };
    case "atNextReferenceBeat":
      return { type: "atNextReferenceBeat" };
    case "afterEventTicks":
      return { type: "afterEventTicks", ticks: 0 };
    case "centerInRest":
      return { type: "centerInRest" };
    case "atSourceReturn":
      return { type: "atSourceReturn" };
    default:
      return { type: "atEvent" };
  }
}

/** The START "Beat 0" placement options. Every entry maps to a real engine
 * `LaunchAlignment` variant (Phase D adds the resolved-context ones). */
export const TRIGGER_START_ALIGNMENTS: readonly { type: string; label: string }[] = [
  { type: "atEvent", label: "trigger event" },
  { type: "atSourceCycleStart", label: "source cycle start" },
  { type: "atNextReferenceBeat", label: "next reference beat" },
  { type: "afterEventTicks", label: "tick offset after trigger" },
  { type: "centerInRest", label: "center of matched beat" },
  { type: "atSourceReturn", label: "source return" },
] as const;

/** The "Snap" select value for a quantize config ("off" when none). */
export function triggerQuantizeSelectValue(
  quantize: TriggerLaunchQuantize | null | undefined
): string {
  if (!quantize) return "off";
  switch (quantize.grid.type) {
    case "referenceBeatMultiple":
      return "multiple";
    case "sourceGatiMatra":
      return "gati";
    default:
      return "fraction";
  }
}

/** Build a quantize config from the "Snap" select value, preserving direction. */
export function triggerQuantizeOfSelect(
  value: string,
  direction: TriggerQuantizeDirection
): TriggerLaunchQuantize | null {
  switch (value) {
    case "fraction":
      return { grid: { type: "referenceBeatFraction", divisions: 4 }, direction };
    case "multiple":
      return { grid: { type: "referenceBeatMultiple", beats: 2 }, direction };
    case "gati":
      return { grid: { type: "sourceGatiMatra" }, direction };
    default:
      return null;
  }
}

// --- presets ----------------------------------------------------------------

export interface TriggerPreset {
  id: string;
  label: string;
  /** Whether this preset is expressible by the v1 engine (Phase A). */
  available: boolean;
  /** Why it is disabled (shown as a tooltip) when `available` is false. */
  hint?: string;
}

/** Catalog shown as preset buttons. Disabled entries advertise the roadmap. */
export const TRIGGER_PRESETS: readonly TriggerPreset[] = [
  { id: "fillRest", label: "Fill a rest", available: true },
  { id: "answerNextBeat", label: "Launch next beat", available: true },
  { id: "phaseLockedShadow", label: "Phase-locked shadow", available: true },
  { id: "quantizedFill", label: "Quantized fill", available: true },
  {
    id: "answerNextCycle",
    label: "Launch next cycle",
    available: false,
    hint: "Needs a next-source-cycle start alignment (later phase).",
  },
  { id: "probabilisticFill", label: "Probabilistic fill", available: true },
  {
    id: "cadenceIntoReturn",
    label: "Cadence into return",
    available: false,
    hint: "Needs an end-phrase-at-source-return start (later phase).",
  },
] as const;

/** A `WhenSpec` that fires when `predicate` holds at a single `beat`. */
function whenLeaf(beat: number, predicate: TriggerWhenPredicate): TriggerWhenSpec {
  return { beats: { type: "at", beat }, tree: { type: "leaf", predicate } };
}

/** The default config for a freshly-triggered track (the "Fill a rest" preset). */
export function defaultTriggerConfig(sourceTrackId: string): TriggerConfig {
  return {
    sourceTrackId,
    when: whenLeaf(3, { type: "isRest" }),
    launchAlignment: { type: "atEvent" },
    launchQuantize: null,
    lifetime: { type: "onePass" },
    reTrigger: "restart",
    length: { type: "scoreCycle" },
    maxRepeats: 64,
  };
}

/**
 * Build a preset config. Only `available` presets have bespoke shapes; anything
 * else (defensively) falls back to the default "Fill a rest" config. Presets are
 * pure: they just populate the bands, no hidden mode.
 */
export function buildTriggerPreset(id: string, sourceTrackId: string): TriggerConfig {
  const base = defaultTriggerConfig(sourceTrackId);
  switch (id) {
    case "answerNextBeat":
      return {
        ...base,
        when: whenLeaf(0, { type: "isSounding" }),
        launchAlignment: { type: "afterEventTicks", ticks: REFERENCE_BEAT_TICKS },
      };
    case "phaseLockedShadow":
      return {
        ...base,
        when: whenLeaf(0, { type: "isSounding" }),
        launchAlignment: { type: "atSourceCycleStart" },
      };
    case "quantizedFill":
      return {
        ...base,
        launchQuantize: {
          grid: { type: "referenceBeatFraction", divisions: 2 },
          direction: "next",
        },
      };
    case "probabilisticFill":
      // Fill a rest, but only ~60% of the time — with a miss-boost so a long dry
      // spell becomes progressively likelier to answer (an engine-real gate).
      return {
        ...base,
        gate: {
          probabilityPerMille: 600,
          cooldownCycles: 0,
          missBoostPerMille: 200,
          seed: 0,
        },
      };
    case "fillRest":
    default:
      return base;
  }
}

// --- Plain-language descriptions (design rebuild) --------------------------
//
// These turn a (normalized) `TriggerConfig` and the engine decision trace into
// readable sentences. They are the centerpiece of the redesign: a musician reads
// what a trigger *does* without parsing every band. Pure + unit-tested, and they
// read the same config the engine compiles, so the summary can never lie.

const COUNT_OP_WORD: Record<TriggerCountOp, string> = {
  atLeast: "at least",
  atMost: "at most",
  exactly: "exactly",
  moreThan: "more than",
  lessThan: "fewer than",
};

const DESCRIBE_DEFAULT_WHEN: TriggerWhenSpec = {
  beats: { type: "at", beat: 0 },
  tree: { type: "leaf", predicate: { type: "isRest" } },
};

/** A WHEN predicate as a verb phrase whose implied subject is the source track. */
function describePredicate(p: TriggerWhenPredicate): string {
  switch (p.type) {
    case "isRest":
      return "rests";
    case "isSounding":
      return "plays";
    case "isSectionStart":
      return "starts a section";
    case "hasJathiPulse":
      return "has a grouping pulse";
    case "gatiIs":
      return `uses subdivision ${p.gati}`;
    case "matraIsRest":
      return `rests on pulse ${p.matra}`;
    case "matraIsSounding":
      return `plays on pulse ${p.matra}`;
    case "restCountInCycle":
      return `has ${COUNT_OP_WORD[p.op]} ${p.count} rest${p.count === 1 ? "" : "s"} in the cycle`;
    case "soundingCountInCycle":
      return `has ${COUNT_OP_WORD[p.op]} ${p.count} sounding beat${p.count === 1 ? "" : "s"}`;
  }
}

/** A condition tree as a readable clause; deep nesting collapses to "a custom
 * condition" (matching the editor's read-only "Custom" state). */
export function describeConditionNode(node: TriggerConditionNode, depth = 0): string {
  if (depth > 3) return "a custom condition";
  switch (node.type) {
    case "leaf":
      return describePredicate(node.predicate);
    case "not":
      return `not (${describeConditionNode(node.node, depth + 1)})`;
    case "all":
      return node.nodes.length === 0
        ? "a custom condition"
        : node.nodes.map((n) => describeConditionNode(n, depth + 1)).join(" and ");
    case "any":
      return node.nodes.length === 0
        ? "a custom condition"
        : node.nodes.map((n) => describeConditionNode(n, depth + 1)).join(" or ");
  }
}

function describeBeatSelector(beats: TriggerBeatSelector): string {
  return beats.type === "anyBeat" ? "on any beat" : `on beat index ${beats.beat}`;
}

/** "{source} rests on beat 3" — the WHEN clause. */
export function describeWhen(when: TriggerWhenSpec, sourceName: string): string {
  return `${sourceName} ${describeConditionNode(when.tree)} ${describeBeatSelector(when.beats)}`;
}

/** The GATE as an acceptance clause, or "" when there's no gate (always fires). */
export function describeGate(gate: TriggerGateSpec | null | undefined): string {
  if (!gate) return "";
  const parts: string[] = [];
  const pct = perMilleToPercent(gate.probabilityPerMille);
  if (pct < 100) parts.push(`${pct}% probability`);
  if (gate.missBoostPerMille > 0) parts.push(`+${perMilleToPercent(gate.missBoostPerMille)}% per miss`);
  if (gate.cooldownCycles > 0) {
    parts.push(
      `minimum gap ${gate.cooldownCycles} source cycle${gate.cooldownCycles === 1 ? "" : "s"}`
    );
  }
  return parts.join(", ");
}

function describeAlignment(a: TriggerLaunchAlignment): string {
  switch (a.type) {
    case "atEvent":
      return "the trigger event";
    case "atSourceCycleStart":
      return "the source cycle start";
    case "atNextReferenceBeat":
      return "the next reference beat";
    case "afterEventTicks":
      return `a ${a.ticks}-tick offset after the trigger`;
    case "centerInRest":
      return "the center of the matched beat";
    case "atSourceReturn":
      return "source return";
  }
}

/** The START placement clause (weighted START collapses to a summary phrase). */
export function describeStart(config: TriggerConfig): string {
  if (config.startSelect && config.startSelect.options.length > 0) {
    return "a weighted start placement";
  }
  const base = describeAlignment(config.launchAlignment);
  return config.launchQuantize ? `${base}, snapped to grid` : base;
}

function describeLength(length: TriggerLength): string {
  return length.type === "fixedBeats"
    ? `${length.beats} beat${length.beats === 1 ? "" : "s"}`
    : "one cycle";
}

/** The RUN duration clause, e.g. "one cycle" or "2 beats ×3". */
export function describeRun(config: TriggerConfig): string {
  const length = describeLength(config.length);
  const repeats = config.lifetime.type === "repeats" ? ` ×${config.lifetime.passes}` : "";
  return `${length}${repeats}`;
}

function describeReTrigger(reTrigger: TriggerReTrigger): string {
  switch (reTrigger) {
    case "restart":
      return "Retrigger: restart.";
    case "ignore":
      return "Retrigger: ignore while running.";
    case "queue":
      return "Retrigger: queue one launch.";
  }
}

/**
 * One or two plain-language sentences describing what a trigger does, e.g.
 * "When Lead rests on beat index 3, launch one cycle from the trigger event.
 * Retrigger: restart." Reads the normalized config the engine compiles, so it stays
 * truthful.
 */
export function describeTrigger(config: TriggerConfig, sourceName: string): string {
  const when = config.when ?? DESCRIBE_DEFAULT_WHEN;
  const source = sourceName || config.sourceTrackId || "the source";
  let sentence = `When ${describeWhen(when, source)}, launch ${describeRun(config)} from ${describeStart(
    config
  )}`;
  const gate = describeGate(config.gate);
  if (gate) sentence += `. Gate: ${gate}`;
  return `${sentence}. ${describeReTrigger(config.reTrigger)}`;
}

/** The resolved START placement of a decision, in a few plain words. */
export function describeStartKind(kind: string): string {
  switch (kind) {
    case "atSourceCycleStart":
      return "source cycle start";
    case "atNextReferenceBeat":
      return "next reference beat";
    case "afterEventTicks":
      return "tick offset";
    case "centerInRest":
      return "matched-beat center";
    case "atSourceReturn":
      return "source return";
    default:
      return "trigger event";
  }
}

/**
 * Humanize one GATE/START decision for the event log, e.g. "launched · start
 * matched-beat center" or "suppressed (probability)". A pure render of the
 * engine trace.
 */
export function describeDecisionLine(event: TriggerDecisionEvent): string {
  let verdict: string;
  if (event.outcome === "launched") {
    verdict = "launched";
  } else if (event.outcome === "queued") {
    verdict = "queued";
  } else if (event.suppressReason === "gateCooldown") {
    verdict = "suppressed (minimum gap)";
  } else if (event.suppressReason === "reTriggerIgnore") {
    verdict = "suppressed (retrigger ignore)";
  } else if (event.suppressReason === "reTriggerQueueFull") {
    verdict = "suppressed (queue full)";
  } else {
    verdict = "suppressed (probability)";
  }
  if (event.outcome === "launched" || event.outcome === "queued") {
    return `${verdict} · start ${describeStartKind(event.startKind)}`;
  }
  return verdict;
}
