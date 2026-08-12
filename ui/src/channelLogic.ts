/**
 * Channel-logic and channel-hocket reasoning: which MIDI channels a track can
 * emit on, conflict-policy labels and help copy, rule-group matching, and the
 * project-wide conflict validation messages shown before playback. Extracted
 * verbatim from App.tsx (carve-up round 5). Pure.
 */
import type {
  ChannelConflictPolicy,
  ChannelLogicMatrixEntry,
} from "./bridge";
import {
  channelLogicPairKey,
  channelLogicRuleKey,
  clamp,
  musicalChannelLogicDefaultPolicy,
  musicalChannelLogicRulePolicy,
  normalizeChannelLogicMatrix,
  normalizeChannelLogicOutputChannel,
  normalizedConflictPriority,
  normalizeMidiChannels,
  numberValue,
  MIDI_CHANNELS,
  type ParallelProjectPatch,
  type ParallelTrackPatch,
  type PatchChannelHocketState,
} from "./patchIo";
import { channelContexts, channelWeightValue } from "./markovWeights";
import { channelEntryWeightKey } from "./patchIo";
export function channelLogicGroupKey(
  trackAId: string,
  trackBId: string,
  policy: ChannelConflictPolicy
): string {
  return `${channelLogicPairKey(trackAId, trackBId)}\u0000${policy}`;
}

export function channelLogicGroupMatchesEntry(
  entry: ChannelLogicMatrixEntry,
  trackAId: string,
  trackBId: string,
  policy: ChannelConflictPolicy,
  outputChannels: number[],
  includesAllShared: boolean
): boolean {
  const entryKey = channelLogicPairKey(entry.trackAId, entry.trackBId);
  if (
    entryKey !== channelLogicPairKey(trackAId, trackBId) ||
    entry.policy !== policy
  ) {
    return false;
  }
  const outputChannel = normalizeChannelLogicOutputChannel(entry.outputChannel);
  return outputChannel === null
    ? includesAllShared
    : outputChannels.includes(outputChannel);
}

export type ChannelHocketOutputSource = Pick<
  PatchChannelHocketState,
  | "enabled"
  | "outputChannel"
  | "order"
  | "channels"
  | "weights"
  | "fallback"
  | "fallbackWeights"
  | "entryWeights"
  | "accentRules"
  | "positionRules"
  | "assignMode"
  | "euclid"
>;

export function channelHocketPossibleMidiChannels(
  channelHocket: ChannelHocketOutputSource
): number[] {
  if (!channelHocket.enabled) {
    return [
      clamp(Math.round(numberValue(channelHocket.outputChannel, 1)), 1, 16),
    ];
  }
  const channels = normalizeMidiChannels(channelHocket.channels).filter((channel) =>
    MIDI_CHANNELS.includes(channel)
  );
  if (channels.length === 0) {
    return [
      clamp(Math.round(numberValue(channelHocket.outputChannel, 1)), 1, 16),
    ];
  }
  const enabledChannels = new Set(channels);
  const possible = new Set<number>();
  const staticFallback = clamp(
    Math.round(numberValue(channelHocket.fallback, channels[0] ?? 1)),
    1,
    16
  );
  possible.add(enabledChannels.has(staticFallback) ? staticFallback : channels[0]!);
  if (channelHocket.assignMode === "euclid") {
    // Euclid strategy: reachable channels are the enabled layer channels
    // with pulses (plus the fallback, already added — it takes remainder or
    // stack-miss slots and the Bypass span-accent anchor default). The
    // matrix/entry/fallback-weight pools are dormant in this mode. Accent
    // and position rules still fire and are unioned below.
    for (const layer of channelHocket.euclid.layers) {
      if (layer.pulses > 0 && enabledChannels.has(layer.channel)) {
        possible.add(layer.channel);
      }
      // Inverted stack layers claim the rests, which exist whenever the
      // layer is not all-pulses.
      if (
        channelHocket.euclid.placement === "stack" &&
        layer.invert &&
        enabledChannels.has(layer.channel)
      ) {
        possible.add(layer.channel);
      }
    }
    const anchor = channelHocket.euclid.spanAccentChannel;
    if (
      channelHocket.euclid.spanAccentMode === "bypass" &&
      anchor !== null &&
      enabledChannels.has(anchor)
    ) {
      possible.add(anchor);
    }
  } else {
    for (const [channelKey, weightValue] of Object.entries(
      channelHocket.fallbackWeights
    )) {
      const channel = parseInt(channelKey, 10);
      const weight = clamp(Math.round(numberValue(weightValue, 0)), 0, 999);
      if (enabledChannels.has(channel) && weight > 0) {
        possible.add(channel);
      }
    }
    for (const entry of channelContexts(channels, channelHocket.order)) {
      const weight = clamp(
        Math.round(
          numberValue(
            channelHocket.entryWeights[
              channelEntryWeightKey(channelHocket.order, entry)
            ],
            0
          )
        ),
        0,
        999
      );
      if (weight > 0) {
        entry.forEach((channel) => possible.add(channel));
      }
    }
    for (const from of channelContexts(channels, channelHocket.order)) {
      for (const to of channels) {
        const weight = channelWeightValue(
          channelHocket.weights,
          channels,
          channelHocket.order,
          from,
          to
        );
        if (weight > 0) {
          possible.add(to);
        }
      }
    }
  }
  for (const rule of channelHocket.accentRules) {
    if (!rule.enabled || rule.probabilityPercent <= 0) continue;
    for (const [channelKey, weightValue] of Object.entries(rule.weights)) {
      const channel = parseInt(channelKey, 10);
      const weight = clamp(Math.round(numberValue(weightValue, 0)), 0, 999);
      if (enabledChannels.has(channel) && weight > 0) {
        possible.add(channel);
      }
    }
  }
  for (const rule of channelHocket.positionRules) {
    if (!rule.enabled || rule.nth <= 0) continue;
    if (rule.actionWeights.renderOnly > 0) {
      for (const [channelKey, weightValue] of Object.entries(rule.renderWeights)) {
        const channel = parseInt(channelKey, 10);
        const weight = clamp(Math.round(numberValue(weightValue, 0)), 0, 999);
        if (enabledChannels.has(channel) && weight > 0) {
          possible.add(channel);
        }
      }
    }
    if (rule.actionWeights.resetMarkov > 0) {
      if (rule.resetMode === "customWeighted") {
        for (const [channelKey, weightValue] of Object.entries(rule.resetWeights)) {
          const channel = parseInt(channelKey, 10);
          const weight = clamp(Math.round(numberValue(weightValue, 0)), 0, 999);
          if (enabledChannels.has(channel) && weight > 0) {
            possible.add(channel);
          }
        }
      } else {
        possible.add(enabledChannels.has(staticFallback) ? staticFallback : channels[0]!);
        if (rule.resetMode === "weightedFallback") {
          for (const [channelKey, weightValue] of Object.entries(
            channelHocket.fallbackWeights
          )) {
            const channel = parseInt(channelKey, 10);
            const weight = clamp(Math.round(numberValue(weightValue, 0)), 0, 999);
            if (enabledChannels.has(channel) && weight > 0) {
              possible.add(channel);
            }
          }
        }
      }
    }
  }
  return [...possible].sort((a, b) => a - b);
}

export function channelHocketInspectableMidiChannels(
  channelHocket: ChannelHocketOutputSource
): number[] {
  const possible = new Set(channelHocketPossibleMidiChannels(channelHocket));
  for (const channel of normalizeMidiChannels(channelHocket.channels)) {
    if (MIDI_CHANNELS.includes(channel)) {
      possible.add(channel);
    }
  }
  const fallback = clamp(
    Math.round(numberValue(channelHocket.fallback, 1)),
    1,
    16
  );
  possible.add(fallback);
  for (const [channelKey, weightValue] of Object.entries(
    channelHocket.fallbackWeights
  )) {
    const channel = parseInt(channelKey, 10);
    const weight = clamp(Math.round(numberValue(weightValue, 0)), 0, 999);
    if (MIDI_CHANNELS.includes(channel) && weight > 0) {
      possible.add(channel);
    }
  }
  return [...possible].sort((a, b) => a - b);
}

export function trackOutputMidiChannels(
  track: Pick<ParallelTrackPatch, "channelHocket">
): number[] {
  return channelHocketPossibleMidiChannels(track.channelHocket);
}

export function trackInspectableMidiChannels(
  track: Pick<ParallelTrackPatch, "channelHocket">
): number[] {
  return channelHocketInspectableMidiChannels(track.channelHocket);
}

export function intersectMidiChannels(left: number[], right: number[]): number[] {
  const rightSet = new Set(right);
  return left.filter((channel) => rightSet.has(channel));
}

export function unionMidiChannels(...groups: number[][]): number[] {
  return [...new Set(groups.flat())]
    .filter((channel) => MIDI_CHANNELS.includes(channel))
    .sort((a, b) => a - b);
}

export function formatMidiChannelList(channels: number[]): string {
  const sorted = [...new Set(channels)]
    .filter((channel) => MIDI_CHANNELS.includes(channel))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return "No MIDI Ch";
  const ranges: string[] = [];
  let start = sorted[0]!;
  let end = sorted[0]!;
  for (const channel of sorted.slice(1)) {
    if (channel === end + 1) {
      end = channel;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    start = channel;
    end = channel;
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return `Ch ${ranges.join(", ")}`;
}

export function formatTrackOptionLabel(track: Pick<ParallelTrackPatch, "name">, index: number): string {
  const label = `Track ${index + 1}`;
  const custom = track.name.trim();
  return custom && custom !== label ? `${label} · ${custom}` : label;
}

/**
 * The single source of truth for how each channel-logic policy is named and
 * described in the UI (B0.2). Every user-facing surface — the default select,
 * the rule select, the help card, the conflict debug table's policy column —
 * renders from this table, so a policy never shows two different labels and the
 * three historical vocabularies ("Layer all" / "XOR" / raw `xor`) collapse to
 * one. `technicalName` is the boolean-logic name, shown only parenthetically in
 * help detail for users cross-referencing the engine.
 *
 * `availableAs`:
 *   - `default` — offered only as the project default operator.
 *   - `rule`    — offered only as a per-pair override.
 *   - `both`    — offered in both selects.
 *   - `legacy`  — a still-supported wire/engine policy that the UI never offers
 *                 or persists; loaded patches are projected off it (see
 *                 `musicalChannelLogicDefaultPolicy` / `...RulePolicy`).
 */
export type ChannelLogicPolicyMetadata = {
  label: string;
  summary: string;
  detail: string;
  availableAs: "default" | "rule" | "both" | "legacy";
  technicalName: string;
};

export const POLICY_METADATA: Record<
  ChannelConflictPolicy,
  ChannelLogicPolicyMetadata
> = {
  allowAll: {
    label: "Layer all",
    summary: "Pass every emitting track in the overlap.",
    detail:
      "The safest merge. If several tracks overlap on the same MIDI channel, all surviving note groups are sent, with note-off pairing protected. As a pair rule it rescues that pair even when the default would suppress it.",
    availableAs: "both",
    technicalName: "Allow all / OR",
  },
  forceOff: {
    label: "Mute overlap",
    summary: "Suppress both tracks of a pair when they overlap.",
    detail:
      "A pair rule for two tracks that should never sound together on the selected MIDI channel. It vetoes both, on top of whatever the default decided.",
    availableAs: "rule",
    technicalName: "Off",
  },
  randomOne: {
    label: "Random one",
    summary: "Keep one track from a collision.",
    detail:
      "Single tracks pass. Collisions pick one winner deterministically from the collision tick, MIDI channel, and tracks, so a locked seed replays identically.",
    availableAs: "both",
    technicalName: "Random one",
  },
  alternate: {
    label: "Alternate",
    summary: "Rotate the winner across successive collisions.",
    detail:
      "Single tracks pass. Each successive collision on a MIDI channel advances to the next track, restarting every cycle, so a locked seed replays identically.",
    availableAs: "both",
    technicalName: "Alternate",
  },
  priorityOrder: {
    label: "Priority",
    summary: "Keep the highest-priority track.",
    detail:
      "The priority order (edited below the modes) decides the winner; lower-priority colliding tracks are suppressed.",
    availableAs: "both",
    technicalName: "Priority",
  },
  xor: {
    label: "One only",
    summary: "Pass exactly one track; suppress overlaps.",
    detail:
      "A single track on that MIDI channel passes. Two or more overlapping tracks suppress the group, making room for non-overlapping hocket lines.",
    availableAs: "default",
    technicalName: "XOR",
  },
  xnor: {
    label: "Overlap only",
    summary: "Pass overlaps; suppress isolated tracks.",
    detail:
      "Two or more tracks overlapping on the same MIDI channel pass. A single track by itself is suppressed, so the overlap becomes the musical material.",
    availableAs: "default",
    technicalName: "XNOR",
  },
  and: {
    label: "All tracks",
    summary: "Pass only when every audible track joins.",
    detail:
      "A consensus gate: output appears only when every audible track (after mute/solo) is part of the same-channel overlap.",
    availableAs: "default",
    technicalName: "AND",
  },
  majority: {
    label: "Majority",
    summary: "Pass when more than half the tracks join.",
    detail:
      "A density gate whose denominator is the current audible track count. Useful for thinning larger parallel patches.",
    availableAs: "default",
    technicalName: "Majority",
  },
  minority: {
    label: "Minority",
    summary: "Pass when fewer than half the tracks join.",
    detail:
      "Sparse moments pass and denser moments suppress — it can thin busy material without choosing a single winner.",
    availableAs: "default",
    technicalName: "Minority",
  },
  // Legacy policies: supported on the wire/engine and projected onto the modes
  // above when a patch is loaded, but never offered or persisted by the UI.
  forceOn: {
    label: "Layer all",
    summary: "",
    detail: "",
    availableAs: "legacy",
    technicalName: "On",
  },
  or: {
    label: "Layer all",
    summary: "",
    detail: "",
    availableAs: "legacy",
    technicalName: "OR",
  },
  nand: {
    label: "Overlap only",
    summary: "",
    detail: "",
    availableAs: "legacy",
    technicalName: "NAND",
  },
  nor: {
    label: "Overlap only",
    summary: "",
    detail: "",
    availableAs: "legacy",
    technicalName: "NOR",
  },
  even: {
    label: "Majority",
    summary: "",
    detail: "",
    availableAs: "legacy",
    technicalName: "Even",
  },
  odd: {
    label: "Majority",
    summary: "",
    detail: "",
    availableAs: "legacy",
    technicalName: "Odd",
  },
  oneHigh: {
    label: "One only",
    summary: "",
    detail: "",
    availableAs: "legacy",
    technicalName: "1 High",
  },
  oneLow: {
    label: "Overlap only",
    summary: "",
    detail: "",
    availableAs: "legacy",
    technicalName: "1 Low",
  },
};

/** The one user-facing label for a policy — used on every surface. */
export function channelConflictPolicyLabel(policy: ChannelConflictPolicy): string {
  return POLICY_METADATA[policy]?.label ?? policy;
}

const DEFAULT_OPTION_ORDER: ChannelConflictPolicy[] = [
  "allowAll",
  "randomOne",
  "alternate",
  "priorityOrder",
  "xor",
  "xnor",
  "and",
  "majority",
  "minority",
];

const RULE_OPTION_ORDER: ChannelConflictPolicy[] = [
  "allowAll",
  "forceOff",
  "randomOne",
  "alternate",
  "priorityOrder",
];

export const CHANNEL_LOGIC_DEFAULT_OPTIONS: Array<{
  value: ChannelConflictPolicy;
  label: string;
}> = DEFAULT_OPTION_ORDER.map((value) => ({
  value,
  label: POLICY_METADATA[value].label,
}));

export const CHANNEL_LOGIC_RULE_OPTIONS: Array<{
  value: ChannelConflictPolicy;
  label: string;
}> = RULE_OPTION_ORDER.map((value) => ({
  value,
  label: POLICY_METADATA[value].label,
}));

/** Help-card entries (summary + detail), one per user-facing mode. */
export const CHANNEL_LOGIC_HELP_MODES: Array<{
  policy: ChannelConflictPolicy;
  label: string;
  summary: string;
  detail: string;
  technicalName: string;
}> = [
  "allowAll",
  "forceOff",
  "randomOne",
  "alternate",
  "priorityOrder",
  "xor",
  "xnor",
  "and",
  "majority",
  "minority",
].map((policy) => {
  const meta = POLICY_METADATA[policy as ChannelConflictPolicy];
  return {
    policy: policy as ChannelConflictPolicy,
    label: meta.label,
    summary: meta.summary,
    detail: meta.detail,
    technicalName: meta.technicalName,
  };
});

export const CHANNEL_LOGIC_NEW_RULE_POLICY_ORDER: ChannelConflictPolicy[] = [
  "randomOne",
  "forceOff",
  "allowAll",
  "alternate",
  "priorityOrder",
];

export function nextChannelLogicRulePolicy(
  defaultPolicy: ChannelConflictPolicy,
  usedPolicies: Set<ChannelConflictPolicy>
): ChannelConflictPolicy {
  return (
    CHANNEL_LOGIC_NEW_RULE_POLICY_ORDER.find(
      (policy) => policy !== defaultPolicy && !usedPolicies.has(policy)
    ) ??
    CHANNEL_LOGIC_NEW_RULE_POLICY_ORDER.find((policy) => policy !== defaultPolicy) ??
    "randomOne"
  );
}

export function channelLogicConflictMessagesForProject(
  project: ParallelProjectPatch | null | undefined
): string[] {
  if (!project) return [];
  const entries = normalizeChannelLogicMatrix(
    project.global.channelLogicMatrix,
    project.tracks,
    project.global.channelConflictPolicy
  );
  const trackLabels = new Map(
    project.tracks.map((track, index) => [
      track.id,
      formatTrackOptionLabel(track, index),
    ])
  );
  const tracksById = new Map(project.tracks.map((track) => [track.id, track]));
  const addPolicyForChannel = (
    policiesByChannel: Map<number, Set<ChannelConflictPolicy>>,
    channel: number,
    policy: ChannelConflictPolicy
  ) => {
    const policies =
      policiesByChannel.get(channel) ?? new Set<ChannelConflictPolicy>();
    policies.add(policy);
    policiesByChannel.set(channel, policies);
  };
  const pairs = new Map<
    string,
    {
      trackAId: string;
      trackBId: string;
      allPolicies: Set<ChannelConflictPolicy>;
      channelPolicies: Map<number, Set<ChannelConflictPolicy>>;
    }
  >();
  for (const entry of entries) {
    const pairKey = channelLogicPairKey(entry.trackAId, entry.trackBId);
    const pair =
      pairs.get(pairKey) ??
      {
        trackAId: entry.trackAId,
        trackBId: entry.trackBId,
        allPolicies: new Set<ChannelConflictPolicy>(),
        channelPolicies: new Map<number, Set<ChannelConflictPolicy>>(),
      };
    const outputChannel = normalizeChannelLogicOutputChannel(entry.outputChannel);
    if (outputChannel === null) {
      pair.allPolicies.add(entry.policy);
      const trackA = tracksById.get(entry.trackAId);
      const trackB = tracksById.get(entry.trackBId);
      const sharedChannels =
        trackA && trackB
          ? intersectMidiChannels(
              trackOutputMidiChannels(trackA),
              trackOutputMidiChannels(trackB)
            )
          : [];
      for (const channel of sharedChannels) {
        addPolicyForChannel(pair.channelPolicies, channel, entry.policy);
      }
    } else {
      addPolicyForChannel(pair.channelPolicies, outputChannel, entry.policy);
    }
    pairs.set(pairKey, pair);
  }
  const messages: string[] = [];
  for (const pair of pairs.values()) {
    const pairLabel = `${trackLabels.get(pair.trackAId) ?? pair.trackAId} + ${
      trackLabels.get(pair.trackBId) ?? pair.trackBId
    }`;
    if (pair.allPolicies.size > 1) {
      messages.push(
        `${pairLabel}: all shared channels have ${[...pair.allPolicies]
          .map(channelConflictPolicyLabel)
          .join(" + ")}`
      );
    }
    for (const [channel, policies] of pair.channelPolicies.entries()) {
      if (policies.size <= 1) continue;
      messages.push(
        `${pairLabel}: Ch ${channel} has ${[...policies]
          .map(channelConflictPolicyLabel)
          .join(" + ")}`
      );
    }
  }
  return messages.sort();
}

/** The minimal per-track view the override-row builder needs. */
export type ChannelLogicTrackTab = {
  id: string;
  name: string;
  midiChannels: number[];
  inspectableMidiChannels: number[];
  channelHocketEnabled: boolean;
};

export type ChannelLogicChannelOption = {
  channel: number;
  active: boolean;
  selected: boolean;
  disabled: boolean;
  reason: string;
  label: string;
};

export type ChannelLogicOverrideRow = {
  id: string;
  trackAId: string;
  trackBId: string;
  outputChannels: number[];
  includesAllShared: boolean;
  policy: ChannelConflictPolicy;
  labelA: string;
  labelB: string;
  channelsA: number[];
  channelsB: number[];
  sharedChannels: number[];
  inspectableSharedChannels: number[];
  channelOptions: ChannelLogicChannelOption[];
  selectedLabel: string;
  titleA: string;
  titleB: string;
  channelTitle: string;
};

/**
 * Collapse the normalized channel-logic matrix into the override rows the UI
 * renders: one row per (trackA, trackB, policy) group, with the union of its
 * output channels and a per-channel option list annotated with why inactive
 * channels are unavailable. Entries whose tracks are no longer present are
 * dropped. Pure — `entries` should already be normalized by the caller.
 */
export function buildChannelLogicOverrideRows(
  entries: ChannelLogicMatrixEntry[],
  trackTabs: ChannelLogicTrackTab[]
): ChannelLogicOverrideRow[] {
  const tabById = new Map(
    trackTabs.map((track, index) => [track.id, { ...track, index }])
  );
  const grouped = new Map<
    string,
    {
      trackAId: string;
      trackBId: string;
      policy: ChannelConflictPolicy;
      outputChannels: Set<number>;
      includesAllShared: boolean;
    }
  >();
  for (const entry of entries) {
    const key = channelLogicGroupKey(entry.trackAId, entry.trackBId, entry.policy);
    const group =
      grouped.get(key) ??
      {
        trackAId: entry.trackAId,
        trackBId: entry.trackBId,
        policy: entry.policy,
        outputChannels: new Set<number>(),
        includesAllShared: false,
      };
    const outputChannel = normalizeChannelLogicOutputChannel(entry.outputChannel);
    if (outputChannel === null) {
      group.includesAllShared = true;
    } else {
      group.outputChannels.add(outputChannel);
    }
    grouped.set(key, group);
  }
  return Array.from(grouped.values()).flatMap((group) => {
    const trackA = tabById.get(group.trackAId);
    const trackB = tabById.get(group.trackBId);
    if (!trackA || !trackB) return [];
    const labelA = `Track ${trackA.index + 1}`;
    const labelB = `Track ${trackB.index + 1}`;
    const customA = trackA.name.trim();
    const customB = trackB.name.trim();
    const sharedChannels = intersectMidiChannels(
      trackA.midiChannels,
      trackB.midiChannels
    );
    const inspectableSharedChannels = intersectMidiChannels(
      trackA.inspectableMidiChannels,
      trackB.inspectableMidiChannels
    );
    const outputChannels = [...group.outputChannels].sort((a, b) => a - b);
    const inactiveReasonForChannel = (channel: number): string => {
      const reasons = [
        [trackA, labelA] as const,
        [trackB, labelB] as const,
      ].flatMap(([track, label]) => {
        if (track.midiChannels.includes(channel)) return [];
        if (!track.inspectableMidiChannels.includes(channel)) {
          return [`${label} has no route`];
        }
        return [
          track.channelHocketEnabled
            ? `${label} not routed now`
            : `${label} hocket off`,
        ];
      });
      return reasons.join(", ") || "inactive now";
    };
    const channelOptions = unionMidiChannels(
      sharedChannels,
      inspectableSharedChannels,
      outputChannels
    ).map((channel) => {
      const active = sharedChannels.includes(channel);
      const selected = outputChannels.includes(channel);
      const reason = active ? "" : inactiveReasonForChannel(channel);
      return {
        channel,
        active,
        selected,
        disabled: !selected && !active,
        reason,
        label: active ? `Ch ${channel}` : `Ch ${channel} (${reason})`,
      };
    });
    const selectedLabel = group.includesAllShared
      ? "all shared channels"
      : outputChannels.length
        ? formatMidiChannelList(outputChannels)
        : "no channels";
    return [
      {
        id: channelLogicGroupKey(group.trackAId, group.trackBId, group.policy),
        trackAId: group.trackAId,
        trackBId: group.trackBId,
        outputChannels,
        includesAllShared: group.includesAllShared,
        policy: group.policy,
        labelA,
        labelB,
        channelsA: trackA.midiChannels,
        channelsB: trackB.midiChannels,
        sharedChannels,
        inspectableSharedChannels,
        channelOptions,
        selectedLabel,
        titleA: customA && customA !== labelA ? `${labelA} · ${customA}` : labelA,
        titleB: customB && customB !== labelB ? `${labelB} · ${customB}` : labelB,
        channelTitle: sharedChannels.length
          ? `${labelA} and ${labelB} can overlap on ${formatMidiChannelList(
              sharedChannels
            )}`
          : inspectableSharedChannels.length
            ? `${labelA} and ${labelB} have configured inactive channels: ${formatMidiChannelList(
                inspectableSharedChannels
              )}`
            : `${labelA} and ${labelB} currently have no shared MIDI output channels`,
      },
    ];
  });
}

/**
 * Resolve the effective policy the engine would apply to one (pair, channel),
 * mirroring the backend precedence exactly (spec §5): an exact
 * `(pair, channel)` rule wins, else a legacy all-channel `(pair, null)` rule,
 * else the project default. `source` says which won, so the UI can mark a
 * channel as rule-governed vs. default. `entries` should be normalized.
 */
export function resolveChannelLogicPolicy(
  entries: ChannelLogicMatrixEntry[],
  defaultPolicy: ChannelConflictPolicy,
  trackAId: string,
  trackBId: string,
  channel: number
): {
  policy: ChannelConflictPolicy;
  source: "channel-rule" | "pair-rule" | "default";
} {
  const pairKey = channelLogicPairKey(trackAId, trackBId);
  let exact: ChannelConflictPolicy | null = null;
  let legacyPair: ChannelConflictPolicy | null = null;
  for (const entry of entries) {
    if (channelLogicPairKey(entry.trackAId, entry.trackBId) !== pairKey) continue;
    const outputChannel = normalizeChannelLogicOutputChannel(entry.outputChannel);
    if (outputChannel === channel) {
      exact = entry.policy;
    } else if (outputChannel === null) {
      legacyPair = entry.policy;
    }
  }
  if (exact !== null) return { policy: exact, source: "channel-rule" };
  if (legacyPair !== null) return { policy: legacyPair, source: "pair-rule" };
  return { policy: defaultPolicy, source: "default" };
}

export type EffectiveChannelSummary = {
  channel: number;
  /** Explicit pair rules governing this channel (empty ⇒ default only). */
  ruleParts: Array<{ label: string; policy: ChannelConflictPolicy }>;
  defaultPolicy: ChannelConflictPolicy;
};

/**
 * The channel-centric read the pair-centric rule list can't give: for every
 * MIDI channel two or more tracks can share, list the explicit pair rules on it
 * (and the default that governs the rest). Purely derived from the normalized
 * matrix + each track's currently routed channels; mirrors engine precedence
 * via [`resolveChannelLogicPolicy`]. Pure.
 */
export function buildEffectiveChannelSummaries(
  entries: ChannelLogicMatrixEntry[],
  defaultPolicy: ChannelConflictPolicy,
  trackTabs: ChannelLogicTrackTab[]
): EffectiveChannelSummary[] {
  const byChannel = new Map<number, EffectiveChannelSummary>();
  const ensure = (channel: number): EffectiveChannelSummary => {
    let summary = byChannel.get(channel);
    if (!summary) {
      summary = { channel, ruleParts: [], defaultPolicy };
      byChannel.set(channel, summary);
    }
    return summary;
  };
  for (let left = 0; left < trackTabs.length; left += 1) {
    for (let right = left + 1; right < trackTabs.length; right += 1) {
      const trackA = trackTabs[left]!;
      const trackB = trackTabs[right]!;
      const shared = intersectMidiChannels(trackA.midiChannels, trackB.midiChannels);
      if (shared.length === 0) continue;
      const pairLabel = `Track ${left + 1}↔Track ${right + 1}`;
      for (const channel of shared) {
        const summary = ensure(channel);
        const { policy, source } = resolveChannelLogicPolicy(
          entries,
          defaultPolicy,
          trackA.id,
          trackB.id,
          channel
        );
        if (source !== "default") {
          summary.ruleParts.push({ label: pairLabel, policy });
        }
      }
    }
  }
  return [...byChannel.values()].sort((a, b) => a.channel - b.channel);
}

/** The minimal per-track view the priority-row builder needs. */
export type ParallelPriorityTrackTab = {
  id: string;
  name: string;
  color: string;
};

export type ParallelPriorityRow = {
  id: string;
  label: string;
  customName: string;
  color: string;
  priorityIndex: number;
};

/**
 * Map an ordered list of track ids (already resolved by the caller via
 * `normalizedConflictPriority`) into the priority-list rows the UI renders,
 * carrying each track's position. Returns nothing for a single track (no
 * conflict order to show), and drops ids without a matching tab. Pure.
 */
export function buildParallelPriorityRows(
  priorityOrder: string[],
  trackTabs: ParallelPriorityTrackTab[]
): ParallelPriorityRow[] {
  if (trackTabs.length <= 1) return [];
  const tabById = new Map(
    trackTabs.map((track, index) => [track.id, { ...track, index }])
  );
  return priorityOrder.flatMap((trackId, priorityIndex) => {
    const track = tabById.get(trackId);
    if (!track) return [];
    const label = `Track ${track.index + 1}`;
    const customName = track.name.trim();
    return [
      {
        id: track.id,
        label,
        customName: customName && customName !== label ? customName : "",
        color: track.color,
        priorityIndex,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Write-side reducers: pure (matrix, tracks, defaultPolicy, …) -> next matrix
// transforms extracted from App.tsx's channel-logic mutation handlers. Each
// normalizes the input matrix, applies the edit, and re-normalizes the result.
// ---------------------------------------------------------------------------

/** Identifies one override group the UI acts on (the row's current policy). */
export type ChannelLogicGroupRef = {
  trackAId: string;
  trackBId: string;
  outputChannels: number[];
  includesAllShared: boolean;
  policy: ChannelConflictPolicy;
};

/** New global default policy + the matrix re-normalized against it. */
export function channelLogicGlobalsForDefaultPolicy(
  matrix: ChannelLogicMatrixEntry[],
  tracks: ParallelTrackPatch[],
  policy: ChannelConflictPolicy
): {
  channelConflictPolicy: ChannelConflictPolicy;
  channelLogicMatrix: ChannelLogicMatrixEntry[];
} {
  const defaultPolicy = musicalChannelLogicDefaultPolicy(policy);
  return {
    channelConflictPolicy: defaultPolicy,
    channelLogicMatrix: normalizeChannelLogicMatrix(matrix, tracks, defaultPolicy),
  };
}

/** Re-point one override group to a new policy, dropping it if that equals the default. */
export function nextChannelLogicMatrixForGroupPolicy(
  matrix: ChannelLogicMatrixEntry[],
  tracks: ParallelTrackPatch[],
  defaultPolicy: ChannelConflictPolicy,
  group: ChannelLogicGroupRef,
  nextPolicy: ChannelConflictPolicy
): ChannelLogicMatrixEntry[] {
  const entries = normalizeChannelLogicMatrix(matrix, tracks, defaultPolicy);
  const nextEntries = entries.flatMap((entry) => {
    if (
      !channelLogicGroupMatchesEntry(
        entry,
        group.trackAId,
        group.trackBId,
        group.policy,
        group.outputChannels,
        group.includesAllShared
      )
    ) {
      return [entry];
    }
    // D3: repointing a rule to the default keeps it (shown "= default"),
    // instead of deleting it.
    const musicalNextPolicy = musicalChannelLogicRulePolicy(nextPolicy);
    return [{ ...entry, policy: musicalNextPolicy }];
  });
  return normalizeChannelLogicMatrix(nextEntries, tracks, defaultPolicy);
}

/**
 * Add a rule for the first track pair that shares an output channel and has no
 * rule yet, picking a policy distinct from the default. Returns null when no
 * such pair exists (the caller should leave the project unchanged).
 */
export function nextChannelLogicMatrixForAddedPair(
  matrix: ChannelLogicMatrixEntry[],
  tracks: ParallelTrackPatch[],
  defaultPolicy: ChannelConflictPolicy
): ChannelLogicMatrixEntry[] | null {
  const entries = normalizeChannelLogicMatrix(matrix, tracks, defaultPolicy);
  const existingPolicies = new Map<string, Set<ChannelConflictPolicy>>();
  for (const entry of entries) {
    const outputChannel = normalizeChannelLogicOutputChannel(entry.outputChannel);
    if (outputChannel === null) continue;
    const key = channelLogicRuleKey(entry.trackAId, entry.trackBId, outputChannel);
    const policies = existingPolicies.get(key) ?? new Set<ChannelConflictPolicy>();
    policies.add(entry.policy);
    existingPolicies.set(key, policies);
  }
  let nextRule: [string, string, number, ChannelConflictPolicy] | null = null;
  for (let left = 0; left < tracks.length; left += 1) {
    for (let right = left + 1; right < tracks.length; right += 1) {
      const trackA = tracks[left];
      const trackB = tracks[right];
      if (!trackA || !trackB) continue;
      const sharedChannels = intersectMidiChannels(
        trackOutputMidiChannels(trackA),
        trackOutputMidiChannels(trackB)
      );
      for (const channel of sharedChannels) {
        const key = channelLogicRuleKey(trackA.id, trackB.id, channel);
        nextRule = [
          trackA.id,
          trackB.id,
          channel,
          nextChannelLogicRulePolicy(
            defaultPolicy,
            existingPolicies.get(key) ?? new Set<ChannelConflictPolicy>()
          ),
        ];
        break;
      }
      if (nextRule) break;
    }
    if (nextRule) break;
  }
  if (!nextRule) return null;
  return normalizeChannelLogicMatrix(
    [
      ...entries,
      {
        trackAId: nextRule[0],
        trackBId: nextRule[1],
        outputChannel: nextRule[2],
        policy: nextRule[3],
      },
    ],
    tracks,
    defaultPolicy
  );
}

/** Add or remove a single (trackA, trackB, channel, policy) rule. */
export function nextChannelLogicMatrixForToggledChannel(
  matrix: ChannelLogicMatrixEntry[],
  tracks: ParallelTrackPatch[],
  defaultPolicy: ChannelConflictPolicy,
  trackAId: string,
  trackBId: string,
  policy: ChannelConflictPolicy,
  outputChannel: number,
  selected: boolean
): ChannelLogicMatrixEntry[] {
  const entries = normalizeChannelLogicMatrix(matrix, tracks, defaultPolicy);
  const [a, b] = trackAId < trackBId ? [trackAId, trackBId] : [trackBId, trackAId];
  const key = channelLogicRuleKey(a, b, outputChannel);
  // D4: a (pair, channel) can be owned by at most one rule, so toggling a
  // channel MOVES its ownership — drop it from every existing rule (any policy)
  // before re-adding, instead of the old same-policy-only filter that let two
  // policies co-own the key and then blocked playback.
  const retained = entries.filter(
    (entry) =>
      channelLogicRuleKey(
        entry.trackAId,
        entry.trackBId,
        normalizeChannelLogicOutputChannel(entry.outputChannel)
      ) !== key
  );
  // D3: a rule equal to the default is still added (shown "= default").
  const nextEntries = selected
    ? retained
    : [...retained, { trackAId: a, trackBId: b, outputChannel, policy }];
  return normalizeChannelLogicMatrix(nextEntries, tracks, defaultPolicy);
}

/** Remove every rule belonging to one override group. */
export function nextChannelLogicMatrixForRemovedGroup(
  matrix: ChannelLogicMatrixEntry[],
  tracks: ParallelTrackPatch[],
  defaultPolicy: ChannelConflictPolicy,
  group: ChannelLogicGroupRef
): ChannelLogicMatrixEntry[] {
  const entries = normalizeChannelLogicMatrix(matrix, tracks, defaultPolicy);
  return normalizeChannelLogicMatrix(
    entries.filter(
      (entry) =>
        !channelLogicGroupMatchesEntry(
          entry,
          group.trackAId,
          group.trackBId,
          group.policy,
          group.outputChannels,
          group.includesAllShared
        )
    ),
    tracks,
    defaultPolicy
  );
}

/**
 * Re-assign one side of an override group to a different track, rebuilding the
 * group's rules under the new (ordered) pair. Returns null when the edit would
 * pair a track with itself (caller leaves the project unchanged).
 */
export function nextChannelLogicMatrixForGroupTrack(
  matrix: ChannelLogicMatrixEntry[],
  tracks: ParallelTrackPatch[],
  defaultPolicy: ChannelConflictPolicy,
  group: ChannelLogicGroupRef,
  side: "a" | "b",
  nextTrackId: string
): ChannelLogicMatrixEntry[] | null {
  const entries = normalizeChannelLogicMatrix(matrix, tracks, defaultPolicy);
  const nextA = side === "a" ? nextTrackId : group.trackAId;
  const nextB = side === "b" ? nextTrackId : group.trackBId;
  if (nextA === nextB) return null;
  const [a, b] = nextA < nextB ? [nextA, nextB] : [nextB, nextA];
  return normalizeChannelLogicMatrix(
    [
      ...entries.filter(
        (entry) =>
          !channelLogicGroupMatchesEntry(
            entry,
            group.trackAId,
            group.trackBId,
            group.policy,
            group.outputChannels,
            group.includesAllShared
          )
      ),
      ...(group.includesAllShared
        ? [{ trackAId: a, trackBId: b, outputChannel: null, policy: group.policy }]
        : []),
      ...group.outputChannels.map((outputChannel) => ({
        trackAId: a,
        trackBId: b,
        outputChannel,
        policy: group.policy,
      })),
    ],
    tracks,
    defaultPolicy
  );
}

/**
 * Swap a track one step up/down the conflict-priority order. Returns null when
 * the move would fall off either end (or the track is absent).
 */
export function nextConflictPriorityForMove(
  conflictPriority: unknown,
  // Runtime conflict participants by id — authored parallel tracks **plus** Track
  // Flow box lane ids. Box lane entries must survive a reorder of authored tracks
  // even though this UI only moves authored-track rows (see product decision #2).
  endpointTracks: Pick<ParallelTrackPatch, "id">[],
  trackId: string,
  direction: -1 | 1
): string[] | null {
  const priority = normalizedConflictPriority(conflictPriority, endpointTracks);
  const index = priority.indexOf(trackId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= priority.length) return null;
  const nextPriority = [...priority];
  const moving = nextPriority[index]!;
  nextPriority[index] = nextPriority[nextIndex]!;
  nextPriority[nextIndex] = moving;
  return nextPriority;
}
