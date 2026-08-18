/**
 * Automation target machinery: target definitions, the full target-def
 * builder for every automatable control, value/graph coercion, curve
 * sampling, and track construction. Extracted verbatim from App.tsx
 * (carve-up round 3). Pure — no React, no App state.
 */
import type {
  AutomationInterpolation,
  AutomationSampleRate,
  AutomationSegmentCurve,
  AutomationSegmentCurveKind,
  AutomationSet,
  AutomationValueKind,
  MarkovOrder,
} from "./bridge";
import {
  clamp,
  cloneAutomationSet,
  MIDI_CHANNELS,
  type AutomationGraphRangeData,
  type AutomationTrackData,
  type ParallelTrackPatch,
  type PatchChannelAccentRule,
  type PatchChannelPositionRule,
  type PatchEuclidChannelState,
} from "./patchIo";
import {
  channelContexts,
  channelWeightKey,
  defaultChannelWeight,
} from "./markovWeights";
import { formatPercent, formatShortNumber, gcdNumber } from "./formatters";

export function sanitizeTargetIdPart(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "target";
}

export type AutomationTargetDef = {
  target: string;
  label: string;
  group: string;
  valueKind: AutomationValueKind;
  min: number;
  max: number;
  step: number;
  unit?: string;
  sampleRate: AutomationSampleRate;
  fallback: number;
};
export type AutomationCurveData = AutomationTrackData["curves"][number];
export type AutomationPointData = AutomationCurveData["points"][number];
export type AutomationMarkerData = AutomationSet["markers"][number];
export type AutomationFocusPanel = {
  title: string;
  targetIds: string[];
};

export const TEMPO_AUTOMATION_TARGET = "transport.tempoBpm";
export const GENERATOR_DENSITY_AUTOMATION_TARGET = "generator.example.density";
export const DUMKA_EVOLUTION_RATE_AUTOMATION_TARGET =
  "generator.dumka.evolutionRate";
export const DUMKA_DRIFT_LEASH_AUTOMATION_TARGET = "generator.dumka.driftLeash";
export const DUMKA_DENSITY_FLOOR_AUTOMATION_TARGET =
  "generator.dumka.densityFloor";
export const DUMKA_DENSITY_CEILING_AUTOMATION_TARGET =
  "generator.dumka.densityCeiling";
export const DUMKA_COMPLEXITY_FLOOR_AUTOMATION_TARGET =
  "generator.dumka.complexityFloor";
export const DUMKA_COMPLEXITY_CEILING_AUTOMATION_TARGET =
  "generator.dumka.complexityCeiling";
export const DUMKA_PLACEMENT_BIAS_AUTOMATION_TARGET =
  "generator.dumka.placementBias";
export const DUMKA_FILL_COMPLEXITY_AUTOMATION_TARGET =
  "generator.dumka.fillComplexity";
export const DUMKA_BARLOW_TEMPERATURE_AUTOMATION_TARGET =
  "generator.dumka.barlowTemperature";
export const RHYTHM_PLAYBACK_AUTOMATION_TARGET = "transport.rhythmPlaybackEnabled";
export const EMPTY_AUTOMATION_TRACKS: AutomationSet["tracks"] = [];

export const BASE_AUTOMATION_TARGETS: AutomationTargetDef[] = [
  {
    target: TEMPO_AUTOMATION_TARGET,
    label: "Tempo",
    group: "Transport",
    valueKind: "float",
    min: 20,
    max: 400,
    step: 0.5,
    unit: "bpm",
    sampleRate: "beat",
    fallback: 80,
  },
  {
    target: "sequencer.pitch",
    label: "Pitch",
    group: "Cycle",
    valueKind: "integer",
    min: 0,
    max: 127,
    step: 1,
    sampleRate: "beat",
    fallback: 60,
  },
  {
    target: "sequencer.velocity",
    label: "Velocity",
    group: "Cycle",
    valueKind: "integer",
    min: 1,
    max: 127,
    step: 1,
    sampleRate: "beat",
    fallback: 96,
  },
  {
    target: "sequencer.accent.beatStart.min",
    label: "Beat accent min",
    group: "Accent",
    valueKind: "integer",
    min: 0,
    max: 127,
    step: 1,
    sampleRate: "beat",
    fallback: 12,
  },
  {
    target: "sequencer.accent.beatStart.max",
    label: "Beat accent max",
    group: "Accent",
    valueKind: "integer",
    min: 0,
    max: 127,
    step: 1,
    sampleRate: "beat",
    fallback: 20,
  },
  {
    target: "sequencer.accent.sectionStartExtra.min",
    label: "Section accent min",
    group: "Accent",
    valueKind: "integer",
    min: 0,
    max: 127,
    step: 1,
    sampleRate: "beat",
    fallback: 8,
  },
  {
    target: "sequencer.accent.sectionStartExtra.max",
    label: "Section accent max",
    group: "Accent",
    valueKind: "integer",
    min: 0,
    max: 127,
    step: 1,
    sampleRate: "beat",
    fallback: 14,
  },
  {
    target: "sequencer.accent.jathiStart.min",
    label: "Grouping accent min",
    group: "Accent",
    valueKind: "integer",
    min: 0,
    max: 127,
    step: 1,
    sampleRate: "beat",
    fallback: 24,
  },
  {
    target: "sequencer.accent.jathiStart.max",
    label: "Grouping accent max",
    group: "Accent",
    valueKind: "integer",
    min: 0,
    max: 127,
    step: 1,
    sampleRate: "beat",
    fallback: 36,
  },
];
export const AUTOMATION_TIME_DENOMINATOR = 1_000_000_000;

export function automationSetWithoutTargets(
  automation: AutomationSet,
  targets: string[]
): AutomationSet {
  const normalized = cloneAutomationSet(automation);
  const removedTargets = new Set(targets);
  return {
    ...normalized,
    tracks: normalized.tracks.filter((track) => !removedTargets.has(track.target)),
  };
}

export function playbackAutomationForTrack(track: ParallelTrackPatch): AutomationSet | null {
  const removedTargets = [RHYTHM_PLAYBACK_AUTOMATION_TARGET];
  if (track.tempoMode !== "custom") {
    removedTargets.push(TEMPO_AUTOMATION_TARGET);
  }
  const automation = automationSetWithoutTargets(track.automation, removedTargets);
  return automation.tracks.length > 0 ? automation : null;
}

export function enabledAutomationTargetPointValues(
  automation: AutomationSet,
  target: string,
  fallback: number
): number[] {
  const values: number[] = [];
  for (const track of automation.tracks) {
    if (!track.enabled || track.target !== target) continue;
    for (const curve of track.curves) {
      if (!curve.enabled) continue;
      for (const point of curve.points) {
        values.push(automationValueNumber(point.value, fallback));
      }
    }
  }
  return values;
}

export function parallelTrackTempoBadge(
  track: Pick<ParallelTrackPatch, "tempoMode" | "customTempoBpm" | "automation">,
  globalTempoBpm: number
): string | null {
  if (track.tempoMode !== "custom") return null;
  const baseBpm = track.tempoMode === "custom" ? track.customTempoBpm : globalTempoBpm;
  const tempoValues = enabledAutomationTargetPointValues(
    track.automation,
    TEMPO_AUTOMATION_TARGET,
    baseBpm
  );
  if (tempoValues.length > 0) {
    const minBpm = Math.round(Math.min(...tempoValues) * 10) / 10;
    const maxBpm = Math.round(Math.max(...tempoValues) * 10) / 10;
    const tempoText =
      minBpm === maxBpm
        ? `${formatShortNumber(minBpm)} BPM`
        : `${formatShortNumber(minBpm)}-${formatShortNumber(maxBpm)} BPM`;
    return `${tempoText} auto`;
  }
  return `${formatShortNumber(Math.round(baseBpm * 10) / 10)} BPM`;
}

export function automationTargetDef(
  target: string,
  targets: AutomationTargetDef[] = BASE_AUTOMATION_TARGETS
): AutomationTargetDef {
  return (
    targets.find((item) => item.target === target) ??
    BASE_AUTOMATION_TARGETS.find((item) => item.target === target) ?? {
      target,
      label: target,
      group: "Custom",
      valueKind: "float",
      min: 0,
      max: 127,
      step: 1,
      sampleRate: "beat",
      fallback: 0,
    }
  );
}

// Reused across the whole sort instead of `String.prototype.localeCompare`,
// which allocates a fresh collator on every call (hot: the def list is ~1000
// entries, so the final sort makes tens of thousands of comparisons).
const AUTOMATION_TARGET_COLLATOR = new Intl.Collator();

export function automationTargetSort(a: AutomationTargetDef, b: AutomationTargetDef): number {
  return (
    AUTOMATION_TARGET_COLLATOR.compare(a.group, b.group) ||
    AUTOMATION_TARGET_COLLATOR.compare(a.label, b.label) ||
    AUTOMATION_TARGET_COLLATOR.compare(a.target, b.target)
  );
}

/**
 * The group-filter options for the automation target picker: a leading "all"
 * sentinel followed by every distinct group in first-seen order.
 */
export function automationTargetGroups(defs: AutomationTargetDef[]): string[] {
  return ["all", ...Array.from(new Set(defs.map((def) => def.group)))];
}

/**
 * The targets offered in the "add automation" picker: every def that is not
 * already an active track, narrowed by the group/kind filters and a
 * case-insensitive substring search over group + label + target id. An empty
 * (or whitespace) query matches everything.
 */
export function filterAvailableAutomationTargets(
  defs: AutomationTargetDef[],
  activeTracks: ReadonlyArray<{ target: string }>,
  groupFilter: string,
  kindFilter: AutomationValueKind | "all",
  search: string
): AutomationTargetDef[] {
  const activeTargets = new Set(activeTracks.map((track) => track.target));
  const query = search.trim().toLowerCase();
  return defs.filter((def) => {
    if (activeTargets.has(def.target)) return false;
    if (groupFilter !== "all" && def.group !== groupFilter) return false;
    if (kindFilter !== "all" && def.valueKind !== kindFilter) return false;
    if (!query) return true;
    return `${def.group} ${def.label} ${def.target}`.toLowerCase().includes(query);
  });
}

export function makeWeightTarget(
  target: string,
  label: string,
  group: string,
  fallback: number
): AutomationTargetDef {
  return {
    target,
    label,
    group,
    valueKind: "weight",
    min: 0,
    max: 999,
    step: 0.1,
    sampleRate: "beat",
    fallback,
  };
}

export function makeBooleanTarget(
  target: string,
  label: string,
  group: string,
  fallback: boolean,
  sampleRate: AutomationSampleRate = "cycleStart"
): AutomationTargetDef {
  return {
    target,
    label,
    group,
    valueKind: "boolean",
    min: 0,
    max: 1,
    step: 1,
    sampleRate,
    fallback: fallback ? 1 : 0,
  };
}

export function makeIntegerTarget(
  target: string,
  label: string,
  group: string,
  fallback: number,
  min: number,
  max: number,
  sampleRate: AutomationSampleRate = "beat",
  unit?: string
): AutomationTargetDef {
  return {
    target,
    label,
    group,
    valueKind: "integer",
    min,
    max,
    step: 1,
    unit,
    sampleRate,
    fallback: Math.round(fallback),
  };
}

export function makeFloatTarget(
  target: string,
  label: string,
  group: string,
  fallback: number,
  min: number,
  max: number,
  step = 0.01,
  sampleRate: AutomationSampleRate = "beat",
  unit?: string
): AutomationTargetDef {
  return {
    target,
    label,
    group,
    valueKind: "float",
    min,
    max,
    step,
    unit,
    sampleRate,
    fallback,
  };
}

export function makePercentTarget(
  target: string,
  label: string,
  group: string,
  fallback: number,
  sampleRate: AutomationSampleRate = "beat",
  max = 100
): AutomationTargetDef {
  return makeFloatTarget(
    target,
    label,
    group,
    fallback,
    0,
    max,
    1,
    sampleRate,
    "%"
  );
}

export function makeChanceTarget(
  target: string,
  label: string,
  group: string,
  fallback: number,
  sampleRate: AutomationSampleRate = "beat"
): AutomationTargetDef {
  return makeFloatTarget(
    target,
    label,
    group,
    fallback,
    0,
    1,
    0.01,
    sampleRate,
    "chance"
  );
}

export function scopedAutomationPart(value: string | number): string {
  return sanitizeTargetIdPart(String(value));
}

export function channelTransitionAutomationTarget(
  order: MarkovOrder,
  from: number[],
  to: number
): string {
  return `channelHocket.matrix.${order}.${from.join(".")}.to.${to}.weight`;
}

export function channelFallbackAutomationTarget(channel: number): string {
  return `channelHocket.fallback.channel.${channel}.weight`;
}

export function channelEntryAutomationTarget(order: MarkovOrder, channels: number[]): string {
  return `channelHocket.entry.${order}.${channels.join(".")}.weight`;
}

export function channelAccentAutomationTarget(
  ruleIndex: number,
  channel: number
): string {
  return `channelHocket.accentRule.${ruleIndex}.channel.${channel}.weight`;
}

export function channelEuclidStepsAutomationTarget(): string {
  return "channelHocket.euclid.steps";
}

export function channelEuclidLayerAutomationTarget(
  layerIndex: number,
  field: "pulses" | "rotation" | "maxRun" | "steps"
): string {
  return `channelHocket.euclid.layer.${layerIndex}.${field}`;
}

export function channelPositionEnabledAutomationTarget(ruleId: string): string {
  return `channelHocket.positionRule.${scopedAutomationPart(ruleId)}.enabled`;
}

export function channelPositionNthAutomationTarget(ruleId: string): string {
  return `channelHocket.positionRule.${scopedAutomationPart(ruleId)}.nth`;
}

export function channelPositionActionAutomationTarget(
  ruleId: string,
  action: "normalMarkov" | "renderOnly" | "resetMarkov"
): string {
  return `channelHocket.positionRule.${scopedAutomationPart(ruleId)}.action.${action}.weight`;
}

export function channelPositionRenderAutomationTarget(
  ruleId: string,
  channel: number
): string {
  return `channelHocket.positionRule.${scopedAutomationPart(ruleId)}.render.channel.${channel}.weight`;
}

export function channelPositionResetAutomationTarget(
  ruleId: string,
  channel: number
): string {
  return `channelHocket.positionRule.${scopedAutomationPart(ruleId)}.reset.channel.${channel}.weight`;
}

export type AutomationTargetBuildInput = {
  tempoBpm: number;
  generatorDensityPercent: number;
  dumkaEvolutionRate: number;
  dumkaBarlowTemperature: number;
  dumkaFillComplexity: number;
  dumkaDriftLeash: number;
  dumkaDensityFloor: number;
  dumkaDensityCeiling: number;
  dumkaComplexityFloor: number;
  dumkaComplexityCeiling: number;
  dumkaPlacementBias: number;
  midiOutputChannel: number;
  scorePitch: number;
  scoreVelocity: number;
  beatAccentMin: number;
  beatAccentMax: number;
  sectionAccentMin: number;
  sectionAccentMax: number;
  jathiAccentMin: number;
  jathiAccentMax: number;
  channelHocketEnabled: boolean;
  channelHocketOrder: MarkovOrder;
  channelHocketChannels: number[];
  channelHocketFallback: number;
  channelHocketWeights: Record<string, number>;
  channelHocketFallbackWeights: Record<string, number>;
  channelHocketEntryWeights: Record<string, number>;
  channelHocketHistoryWeight: number;
  channelHocketNewSeedWeight: number;
  channelHocketMaxHistory: number;
  channelAccentRules: PatchChannelAccentRule[];
  channelPositionRules: PatchChannelPositionRule[];
  channelHocketEuclid: PatchEuclidChannelState;
};

export function buildAutomationTargetDefs(
  input: AutomationTargetBuildInput
): AutomationTargetDef[] {
  const defs = new Map(BASE_AUTOMATION_TARGETS.map((def) => [def.target, def]));
  const add = (def: AutomationTargetDef) => {
    defs.set(def.target, def);
  };
  const fallbackOverrides: Record<string, number> = {
    [TEMPO_AUTOMATION_TARGET]: input.tempoBpm,
    "sequencer.pitch": input.scorePitch,
    "sequencer.velocity": input.scoreVelocity,
    "sequencer.accent.beatStart.min": input.beatAccentMin,
    "sequencer.accent.beatStart.max": input.beatAccentMax,
    "sequencer.accent.sectionStartExtra.min": input.sectionAccentMin,
    "sequencer.accent.sectionStartExtra.max": input.sectionAccentMax,
    "sequencer.accent.jathiStart.min": input.jathiAccentMin,
    "sequencer.accent.jathiStart.max": input.jathiAccentMax,
  };
  for (const [target, fallback] of Object.entries(fallbackOverrides)) {
    const def = defs.get(target);
    if (def) defs.set(target, { ...def, fallback });
  }

  add(
    makePercentTarget(
      GENERATOR_DENSITY_AUTOMATION_TARGET,
      "Density",
      "Generator",
      input.generatorDensityPercent,
      "cycleStart"
    )
  );

  add(
    makePercentTarget(
      DUMKA_EVOLUTION_RATE_AUTOMATION_TARGET,
      "Evolution rate",
      "Generator",
      input.dumkaEvolutionRate,
      "cycleStart"
    )
  );

  add(
    makePercentTarget(
      DUMKA_DRIFT_LEASH_AUTOMATION_TARGET,
      "Drift leash",
      "Generator",
      input.dumkaDriftLeash,
      "cycleStart"
    )
  );

  add(
    makePercentTarget(
      DUMKA_DENSITY_FLOOR_AUTOMATION_TARGET,
      "Density floor",
      "Generator",
      input.dumkaDensityFloor,
      "cycleStart"
    )
  );

  add(
    makePercentTarget(
      DUMKA_DENSITY_CEILING_AUTOMATION_TARGET,
      "Density ceiling",
      "Generator",
      input.dumkaDensityCeiling,
      "cycleStart"
    )
  );

  add(
    makeIntegerTarget(
      DUMKA_COMPLEXITY_FLOOR_AUTOMATION_TARGET,
      "Complexity floor",
      "Generator",
      input.dumkaComplexityFloor,
      0,
      100_000,
      "cycleStart",
      "milli"
    )
  );

  add(
    makeIntegerTarget(
      DUMKA_COMPLEXITY_CEILING_AUTOMATION_TARGET,
      "Complexity ceiling",
      "Generator",
      input.dumkaComplexityCeiling,
      0,
      100_000,
      "cycleStart",
      "milli"
    )
  );

  add(
    makePercentTarget(
      DUMKA_PLACEMENT_BIAS_AUTOMATION_TARGET,
      "Placement bias",
      "Generator",
      input.dumkaPlacementBias,
      "cycleStart"
    )
  );

  add(
    makePercentTarget(
      DUMKA_BARLOW_TEMPERATURE_AUTOMATION_TARGET,
      "Barlow temperature",
      "Generator",
      input.dumkaBarlowTemperature,
      "cycleStart"
    )
  );

  add(
    makePercentTarget(
      DUMKA_FILL_COMPLEXITY_AUTOMATION_TARGET,
      "Fill complexity",
      "Generator",
      input.dumkaFillComplexity,
      "cycleStart"
    )
  );

  add(
    makeIntegerTarget(
      "transport.midiOutputChannel",
      "MIDI output channel",
      "Transport",
      input.midiOutputChannel,
      1,
      16,
      "cycleStart"
    )
  );

  const channels = input.channelHocketChannels.filter((channel) =>
    MIDI_CHANNELS.includes(channel)
  );
  const channelCtx = channelContexts(channels, input.channelHocketOrder);
  add(
    makeBooleanTarget(
      "channelHocket.enabled",
      "Channel hocket enabled",
      "Channel Hocket",
      input.channelHocketEnabled
    )
  );
  add(
    makeIntegerTarget(
      "channelHocket.outputChannel",
      "Static output channel",
      "Channel Hocket",
      input.midiOutputChannel,
      1,
      16,
      "cycleStart"
    )
  );
  add(
    makeIntegerTarget(
      "channelHocket.fallback.staticChannel",
      "Channel static fallback",
      "Channel Hocket",
      input.channelHocketFallback,
      1,
      16,
      "cycleStart"
    )
  );
  // `channelHocket.entry.*` targets are deliberately NOT emitted (UC-47): the
  // engine never samples that family, so offering the lanes in the picker
  // authored automation that could never play. Re-emit only once engine
  // sampling exists (deferred follow-up in docs/UI_CONTROL_AUDIT.md).
  channels.forEach((channel) => {
    add(
      makeWeightTarget(
        channelFallbackAutomationTarget(channel),
        `Channel fallback ${channel}`,
        "Channel Fallback",
        input.channelHocketFallbackWeights[String(channel)] ?? 0
      )
    );
  });
  add(
    makeWeightTarget(
      "channelHocket.seed.historyWeight",
      "Channel history seed weight",
      "Channel Seeds",
      input.channelHocketHistoryWeight
    )
  );
  add(
    makeWeightTarget(
      "channelHocket.seed.newSeedWeight",
      "Channel new seed weight",
      "Channel Seeds",
      input.channelHocketNewSeedWeight
    )
  );
  add(
    makeIntegerTarget(
      "channelHocket.seed.maxHistory",
      "Channel max seed history",
      "Channel Seeds",
      input.channelHocketMaxHistory,
      0,
      64,
      "cycleStart"
    )
  );
  for (const from of channelCtx) {
    channels.forEach((channel) => {
      const key = channelWeightKey(input.channelHocketOrder, from, channel);
      add(
        makeWeightTarget(
          channelTransitionAutomationTarget(
            input.channelHocketOrder,
            from,
            channel
          ),
          `Channel weight ${from
            .map((item) => `Ch ${item}`)
            .join(" to ")} to Ch ${channel}`,
          "Channel Matrix",
          input.channelHocketWeights[key] ??
            defaultChannelWeight(channels, from, channel)
        )
      );
    });
  }
  add(
    makeIntegerTarget(
      channelEuclidStepsAutomationTarget(),
      "Channel euclid steps",
      "Channel Euclid",
      input.channelHocketEuclid.steps,
      1,
      64
    )
  );
  input.channelHocketEuclid.layers.forEach((layer, layerIndex) => {
    for (const [field, label, fallback, min, max] of [
      ["pulses", "pulses", layer.pulses, 0, 64],
      ["rotation", "rotation", layer.rotation, 0, 63],
      ["maxRun", "max run", layer.maxRun, 1, 64],
      ["steps", "length", layer.steps, 1, 64],
    ] as const) {
      add(
        makeIntegerTarget(
          channelEuclidLayerAutomationTarget(layerIndex, field),
          `Euclid layer ${layerIndex + 1} ${label}`,
          "Channel Euclid",
          fallback,
          min,
          max
        )
      );
    }
  });
  input.channelAccentRules.forEach((rule, ruleIndex) => {
    const group = "Channel Accents";
    add(
      makeBooleanTarget(
        `channelHocket.accentRule.${ruleIndex}.enabled`,
        `${rule.label} enabled`,
        group,
        rule.enabled
      )
    );
    add(
      makeIntegerTarget(
        `channelHocket.accentRule.${ruleIndex}.minVelocity`,
        `${rule.label} minimum velocity`,
        group,
        rule.minVelocity,
        1,
        127
      )
    );
    add(
      makeIntegerTarget(
        `channelHocket.accentRule.${ruleIndex}.maxVelocity`,
        `${rule.label} maximum velocity`,
        group,
        rule.maxVelocity,
        1,
        127
      )
    );
    add(
      makePercentTarget(
        `channelHocket.accentRule.${ruleIndex}.probabilityPercent`,
        `${rule.label} accent chance`,
        group,
        rule.probabilityPercent
      )
    );
    channels.forEach((channel) => {
      add(
        makeWeightTarget(
          channelAccentAutomationTarget(ruleIndex, channel),
          `${rule.label} channel ${channel} weight`,
          group,
          rule.weights[String(channel)] ?? 0
        )
      );
    });
  });
  input.channelPositionRules.forEach((rule) => {
    const group = "Channel Positions";
    add(
      makeBooleanTarget(
        channelPositionEnabledAutomationTarget(rule.id),
        `${rule.label} enabled`,
        group,
        rule.enabled
      )
    );
    add(
      makeIntegerTarget(
        channelPositionNthAutomationTarget(rule.id),
        `${rule.label} nth note`,
        group,
        rule.nth,
        1,
        999,
        "noteGroup"
      )
    );
    for (const action of [
      "normalMarkov",
      "renderOnly",
      "resetMarkov",
    ] as const) {
      add(
        makeWeightTarget(
          channelPositionActionAutomationTarget(rule.id, action),
          `${rule.label} ${action} weight`,
          group,
          rule.actionWeights[action]
        )
      );
    }
    channels.forEach((channel) => {
      add(
        makeWeightTarget(
          channelPositionRenderAutomationTarget(rule.id, channel),
          `${rule.label} render Ch ${channel} weight`,
          group,
          rule.renderWeights[String(channel)] ?? 0
        )
      );
      add(
        makeWeightTarget(
          channelPositionResetAutomationTarget(rule.id, channel),
          `${rule.label} reset Ch ${channel} weight`,
          group,
          rule.resetWeights[String(channel)] ?? 0
        )
      );
    });
  });
  return Array.from(defs.values()).sort(automationTargetSort);
}

export function automationValueNumber(
  value: AutomationSet["tracks"][number]["curves"][number]["points"][number]["value"],
  fallback: number
): number {
  if (value.type === "number") return value.value;
  if (value.type === "bool") return value.value ? 1 : 0;
  return fallback;
}

export function coerceAutomationPointNumber(
  value: number,
  def: AutomationTargetDef
): number {
  const clamped = clamp(value, def.min, def.max);
  if (def.valueKind === "boolean") {
    return clamped >= 0.5 ? 1 : 0;
  }
  if (def.valueKind === "integer") {
    return Math.round(clamped);
  }
  return clamped;
}

export function automationGraphMinimumSpan(def: AutomationTargetDef): number {
  return Math.max(Math.abs(def.step || 0), 0.000001);
}

export function coerceAutomationGraphRange(
  range: AutomationGraphRangeData | null | undefined,
  def: AutomationTargetDef
): AutomationGraphRangeData | null {
  if (!range) return null;
  const min = Number(range.min);
  const max = Number(range.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const minimumSpan = automationGraphMinimumSpan(def);
  const lowerLimit = Math.min(def.min, def.max - minimumSpan);
  const upperLimit = Math.max(def.max, def.min + minimumSpan);
  const coercedMin = clamp(Math.min(min, max - minimumSpan), lowerLimit, def.max);
  const coercedMax = clamp(Math.max(max, coercedMin + minimumSpan), def.min, upperLimit);
  if (coercedMax <= coercedMin) return null;
  return { min: coercedMin, max: coercedMax };
}

export function defaultAutomationWeightGraphRange(
  track: AutomationTrackData,
  def: AutomationTargetDef
): AutomationGraphRangeData {
  const pointValues = track.curves.flatMap((curve) =>
    curve.points.map((point) => automationValueNumber(point.value, def.fallback))
  );
  const values = [def.fallback, ...pointValues].filter(Number.isFinite);
  const highestValue = Math.max(1, ...values.map((value) => Math.abs(value)));
  const fallbackHeadroom = Math.max(5, Math.ceil(Math.max(def.fallback, 1) * 2));
  const max = clamp(
    Math.max(fallbackHeadroom, Math.ceil(highestValue)),
    def.min + automationGraphMinimumSpan(def),
    def.max
  );
  return { min: def.min, max };
}

export function automationGraphAxisRange(
  track: AutomationTrackData,
  def: AutomationTargetDef
): AutomationGraphRangeData {
  if (def.valueKind !== "weight") {
    return { min: def.min, max: def.max };
  }
  return (
    coerceAutomationGraphRange(track.graphRange, def) ??
    defaultAutomationWeightGraphRange(track, def)
  );
}

export function coerceAutomationPointNumberForAxis(
  value: number,
  def: AutomationTargetDef,
  axisRange: AutomationGraphRangeData
): number {
  const axisValue = clamp(value, axisRange.min, axisRange.max);
  return coerceAutomationPointNumber(axisValue, def);
}

export function automationTimeToUnit(time: { numer: number; denom: number }): number {
  return time.denom > 0 ? clamp(time.numer / time.denom, 0, 1) : 0;
}

export function automationTimeFromUnit(unit: number): { numer: number; denom: number } {
  const denom = AUTOMATION_TIME_DENOMINATOR;
  const numer = clamp(Math.round(clamp(unit, 0, 1) * denom), 0, denom);
  const divisor = gcdNumber(numer, denom);
  return { numer: numer / divisor, denom: denom / divisor };
}

export function sortAutomationPoints(
  points: AutomationSet["tracks"][number]["curves"][number]["points"]
) {
  return [...points].sort(
    (a, b) => automationTimeToUnit(a.time) - automationTimeToUnit(b.time)
  );
}

export function sortAutomationMarkers(markers: AutomationMarkerData[]) {
  return [...markers].sort(
    (a, b) => automationTimeToUnit(a.time) - automationTimeToUnit(b.time)
  );
}

export function snapAutomationUnitToMarker(
  unit: number,
  markers: AutomationMarkerData[]
): { unit: number; anchorId: string | null } {
  const clamped = clamp(unit, 0, 1);
  const nearest = markers.reduce<AutomationMarkerData | null>((best, marker) => {
    if (!best) return marker;
    return Math.abs(automationTimeToUnit(marker.time) - clamped) <
      Math.abs(automationTimeToUnit(best.time) - clamped)
      ? marker
      : best;
  }, null);
  if (nearest && Math.abs(automationTimeToUnit(nearest.time) - clamped) <= 0.0125) {
    return { unit: automationTimeToUnit(nearest.time), anchorId: nearest.id };
  }
  return { unit: clamped, anchorId: null };
}

export function automationSegmentCurveLabel(kind: AutomationSegmentCurveKind): string {
  switch (kind) {
    case "hold":
      return "Step";
    case "smooth":
      return "Smooth";
    case "easeIn":
      return "Ease in";
    case "easeOut":
      return "Ease out";
    case "easeInOut":
      return "Ease S";
    case "exponential":
      return "Expo";
    default:
      return "Line";
  }
}

export function defaultAutomationSegmentCurve(): AutomationSegmentCurve {
  return { kind: "linear", amount: 1 };
}

/**
 * The segment curve leaving a point. When the point has no explicit `outCurve`,
 * the CURVE-level `interpolation` is the fallback — exactly as the backend
 * sampler resolves it (`warp_automation_t`'s fallback arm). Rendering with a
 * plain linear default here would draw a different shape than playback for
 * hold/smooth curves carried by patches or imports.
 */
export function automationSegmentCurveForPoint(
  point: AutomationPointData,
  fallbackInterpolation: AutomationInterpolation = "linear"
): AutomationSegmentCurve {
  if (point.outCurve) return point.outCurve;
  const kind: AutomationSegmentCurveKind =
    fallbackInterpolation === "hold"
      ? "hold"
      : fallbackInterpolation === "smooth"
        ? "smooth"
        : "linear";
  return { kind, amount: 1 };
}

/**
 * A point's sampling-time position: the anchored marker's time when `anchorId`
 * resolves, else the stored time. Mirror of the backend's
 * `automation_point_effective_time` — every FE surface that draws or orders
 * points must use this, or moving a marker changes playback without changing
 * the picture.
 */
export function automationPointEffectiveTime(
  point: AutomationPointData,
  markers: AutomationMarkerData[]
): { numer: number; denom: number } {
  if (!point.anchorId) return point.time;
  const marker = markers.find((entry) => entry.id === point.anchorId);
  return marker ? marker.time : point.time;
}

export function automationPointEffectiveUnit(
  point: AutomationPointData,
  markers: AutomationMarkerData[]
): number {
  return automationTimeToUnit(automationPointEffectiveTime(point, markers));
}

/** Sort points by their effective (marker-aware) time, as the sampler does. */
export function sortAutomationPointsByEffectiveTime(
  points: AutomationSet["tracks"][number]["curves"][number]["points"],
  markers: AutomationMarkerData[]
) {
  return [...points].sort(
    (a, b) =>
      automationPointEffectiveUnit(a, markers) - automationPointEffectiveUnit(b, markers)
  );
}

export function warpAutomationUnit(t: number, curve: AutomationSegmentCurve): number {
  const amount = clamp(curve.amount, 0, 1);
  const unit = clamp(t, 0, 1);
  switch (curve.kind) {
    case "hold":
      return 0;
    case "smooth": {
      const smooth = unit * unit * (3 - 2 * unit);
      return unit + (smooth - unit) * amount;
    }
    case "easeIn":
      return Math.pow(unit, 1 + amount * 5);
    case "easeOut":
      return 1 - Math.pow(1 - unit, 1 + amount * 5);
    case "easeInOut": {
      const exponent = 1 + amount * 5;
      return unit < 0.5
        ? 0.5 * Math.pow(unit * 2, exponent)
        : 1 - 0.5 * Math.pow((1 - unit) * 2, exponent);
    }
    case "exponential": {
      if (amount <= Number.EPSILON) return unit;
      const bend = 1 + amount * 8;
      return clamp((Math.pow(bend, unit) - 1) / (bend - 1), 0, 1);
    }
    default:
      return unit;
  }
}

export function automationGraphSampleValue(
  left: AutomationPointData,
  right: AutomationPointData,
  t: number,
  def: AutomationTargetDef,
  fallbackInterpolation: AutomationInterpolation = "linear"
): number {
  const leftValue = automationValueNumber(left.value, def.fallback);
  const rightValue = automationValueNumber(right.value, def.fallback);
  const warped = warpAutomationUnit(
    t,
    automationSegmentCurveForPoint(left, fallbackInterpolation)
  );
  return leftValue + (rightValue - leftValue) * warped;
}

export function makeAutomationCurve(
  def: AutomationTargetDef,
  curveId: string
): AutomationSet["tracks"][number]["curves"][number] {
  return {
    id: curveId,
    enabled: true,
    interpolation: "linear",
    points: [
      // No anchorId: anchors mean "follow this marker" since the backend
      // started evaluating them — a sentinel id that matches no marker is
      // dangling data, not a label. (Legacy sentinel anchors are stripped by
      // normalizeAutomationSet on load.)
      {
        id: `${curveId}-start`,
        time: { numer: 0, denom: 1 },
        value: { type: "number", value: def.fallback },
        anchorId: null,
        outCurve: defaultAutomationSegmentCurve(),
      },
      {
        id: `${curveId}-end`,
        time: { numer: 1, denom: 1 },
        value: { type: "number", value: def.fallback },
        anchorId: null,
        outCurve: null,
      },
    ],
  };
}

export function makeAutomationTrack(def: AutomationTargetDef): AutomationSet["tracks"][number] {
  const safeId = sanitizeTargetIdPart(def.target);
  const track: AutomationSet["tracks"][number] = {
    id: `automation-${safeId}`,
    target: def.target,
    enabled: true,
    combine: "replace",
    curves: [makeAutomationCurve(def, `automation-${safeId}-curve`)],
  };
  return {
    ...track,
    graphRange:
      def.valueKind === "weight" ? defaultAutomationWeightGraphRange(track, def) : null,
  };
}

export function automationKindLabel(kind: AutomationValueKind): string {
  switch (kind) {
    case "boolean":
      return "bool";
    case "integer":
      return "int";
    case "weight":
      return "weight";
    default:
      return "float";
  }
}

export function automationSampleRateLabel(rate: AutomationSampleRate): string {
  switch (rate) {
    case "cycleStart":
      return "cycle";
    case "sectionStart":
      return "section";
    case "rhythmSpan":
      return "span";
    case "noteGroup":
      return "group";
    default:
      return "beat";
  }
}

export function formatAutomationEditorValue(def: AutomationTargetDef, value: number): string {
  if (def.valueKind === "boolean") return value >= 0.5 ? "1" : "0";
  if (def.unit === "chance") return formatPercent(value);
  if (def.valueKind === "integer" || def.step >= 1) return `${Math.round(value)}`;
  return Number.isInteger(value) ? `${value}` : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
