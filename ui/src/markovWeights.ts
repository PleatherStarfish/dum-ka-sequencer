/**
 * Markov matrix helpers shared by the rhythm, pitch, and channel shapers:
 * context enumeration, weight keys/defaults/values, and normalized shares.
 * Extracted verbatim from App.tsx (carve-up round 3a). Pure.
 */
import type {
  MarkovOrder,
  PitchState,
  PitchTarget,
  PitchTargetKind,
  RhythmPattern,
} from "./bridge";
import { patternKey, pitchName } from "./patchIo";
export function isWholeCellPattern(pattern: RhythmPattern, length: number): boolean {
  return pattern.pulses.length === 1 && pattern.pulses[0] === length;
}

export function rhythmContexts(stateCount: number, order: MarkovOrder): number[][] {
  if (order === "first") {
    return Array.from({ length: stateCount }, (_, state) => [state]);
  }

  const contexts: number[][] = [];
  for (let a = 0; a < stateCount; a += 1) {
    for (let b = 0; b < stateCount; b += 1) {
      contexts.push([a, b]);
    }
  }
  return contexts;
}

export function rhythmWeightKey(
  length: number,
  order: MarkovOrder,
  fromKeys: string[],
  toKey: string
): string {
  return `${length}:${order}:${fromKeys.join(".")}:${toKey}`;
}

export function rhythmWeightPrefix(length: number, order: MarkovOrder): string {
  return `${length}:${order}:`;
}

export function defaultRhythmWeight(from: number[], to: number): number {
  if (from.every((state) => state === 0)) return 1;
  return from[from.length - 1] === to ? 1 : 0;
}

export function rhythmWeightValue(
  weights: Record<string, number>,
  length: number,
  order: MarkovOrder,
  from: number[],
  to: number,
  states: RhythmPattern[]
): number {
  const key = rhythmWeightKey(
    length,
    order,
    from.map((state) => patternKey(states[state]!)),
    patternKey(states[to]!)
  );
  return weights[key] ?? defaultRhythmWeight(from, to);
}

export function rhythmWeightShare(
  weights: Record<string, number>,
  length: number,
  order: MarkovOrder,
  from: number[],
  to: number,
  states: RhythmPattern[]
): number {
  const rowWeights = states.map((_, stateIndex) =>
    rhythmWeightValue(weights, length, order, from, stateIndex, states)
  );
  const total = rowWeights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  return total > 0 ? Math.max(0, rowWeights[to] ?? 0) / total : 0;
}

export function channelContexts(channels: number[], order: MarkovOrder): number[][] {
  if (order === "first") {
    return channels.map((channel) => [channel]);
  }
  const contexts: number[][] = [];
  for (const first of channels) {
    for (const second of channels) {
      contexts.push([first, second]);
    }
  }
  return contexts;
}

export function channelWeightKey(order: MarkovOrder, from: number[], to: number): string {
  return `${order}:${from.join(".")}:${to}`;
}

export function defaultChannelWeight(channels: number[], from: number[], to: number): number {
  const last = from[from.length - 1] ?? channels[0] ?? 1;
  const lastIndex = channels.indexOf(last);
  const next = channels[(lastIndex + 1 + channels.length) % channels.length] ?? last;
  return to === next ? 1 : 0;
}

export function channelWeightValue(
  weights: Record<string, number>,
  channels: number[],
  order: MarkovOrder,
  from: number[],
  to: number
): number {
  return weights[channelWeightKey(order, from, to)] ?? defaultChannelWeight(channels, from, to);
}

export function channelWeightShare(
  weights: Record<string, number>,
  channels: number[],
  order: MarkovOrder,
  from: number[],
  to: number
): number {
  const rowWeights = channels.map((channel) =>
    channelWeightValue(weights, channels, order, from, channel)
  );
  const total = rowWeights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  return total > 0 ? Math.max(0, channelWeightValue(weights, channels, order, from, to)) / total : 0;
}

export function pitchTargetLabel(target: PitchTarget): string {
  if (target.label.trim()) return target.label;
  if (target.kind.type === "absolute") return pitchName(target.kind.pitch);
  if (target.kind.type === "relativeChromatic") {
    return `${target.kind.steps >= 0 ? "+" : ""}${target.kind.steps} semi`;
  }
  return `${target.kind.steps >= 0 ? "+" : ""}${target.kind.steps} step`;
}

export function pitchTargetsForStates(states: PitchState[]): PitchTarget[] {
  return [
    ...states.map((state) => ({
      label: state.label || pitchName(state.pitch),
      kind: { type: "absolute", pitch: state.pitch } as PitchTargetKind,
    })),
    // Relative motion now generates pitches along the scale / chromatically, so
    // these targets are first-class melodic moves, not anchor selectors.
    { label: "+1 step", kind: { type: "relativeCollection", steps: 1 } },
    { label: "-1 step", kind: { type: "relativeCollection", steps: -1 } },
    { label: "+2 step", kind: { type: "relativeCollection", steps: 2 } },
    { label: "-2 step", kind: { type: "relativeCollection", steps: -2 } },
    { label: "+1 semi", kind: { type: "relativeChromatic", steps: 1 } },
    { label: "-1 semi", kind: { type: "relativeChromatic", steps: -1 } },
    { label: "+8va", kind: { type: "relativeChromatic", steps: 12 } },
    { label: "-8va", kind: { type: "relativeChromatic", steps: -12 } },
  ];
}

export function pitchContexts(states: PitchState[], order: MarkovOrder): number[][] {
  const indices = states.map((_, index) => index);
  if (order === "first") return indices.map((index) => [index]);
  const contexts: number[][] = [];
  for (const first of indices) {
    for (const second of indices) {
      contexts.push([first, second]);
    }
  }
  return contexts;
}

export function pitchWeightKey(order: MarkovOrder, from: number[], to: number): string {
  return `${order}:${from.join(".")}:${to}`;
}

export function defaultPitchWeight(states: PitchState[], targets: PitchTarget[], from: number[], to: number): number {
  if (states.length === 0 || targets.length === 0) return 0;
  const last = from[from.length - 1] ?? 0;
  const target = targets[to];
  if (!target) return 0;
  if (target.kind.type === "relativeCollection" && target.kind.steps === 1) return 1;
  const nextState = states[(last + 1 + states.length) % states.length];
  return target.kind.type === "absolute" && nextState?.pitch === target.kind.pitch ? 1 : 0;
}

export function pitchWeightValue(
  weights: Record<string, number>,
  states: PitchState[],
  targets: PitchTarget[],
  order: MarkovOrder,
  from: number[],
  to: number
): number {
  return weights[pitchWeightKey(order, from, to)] ?? defaultPitchWeight(states, targets, from, to);
}

export function pitchWeightShare(
  weights: Record<string, number>,
  states: PitchState[],
  targets: PitchTarget[],
  order: MarkovOrder,
  from: number[],
  to: number
): number {
  const rowWeights = targets.map((_, targetIndex) =>
    pitchWeightValue(weights, states, targets, order, from, targetIndex)
  );
  const total = rowWeights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  return total > 0
    ? Math.max(0, pitchWeightValue(weights, states, targets, order, from, to)) / total
    : 0;
}
