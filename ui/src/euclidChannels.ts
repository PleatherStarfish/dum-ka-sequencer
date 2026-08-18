/**
 * Euclidean (Bjorklund) channel-assignment math — the TypeScript twin of the
 * cseq-rhythm generators (`bjorklund_mask`, `bjorklund_burst_mask`,
 * `euclid_partition_table`, stack masks), pinned to the same literature
 * golden vectors so the Channel Shaper's pattern preview can never disagree
 * with what the engine plays. Also carries the analysis helpers from the
 * Euclidean-rhythm literature: adjacent inter-onset interval vectors and the
 * Euclidean-string / reverse-Euclidean-string tests (Ellis, Ruskey, Sawada &
 * Simpson 2003).
 *
 * E(5,13) is pinned here as 1001010010100 so the editor and engine share the
 * same rotation convention.
 */

export interface EuclidTableSlot {
  /** User-facing MIDI channel, 1-16. */
  channel: number;
  /** True when no layer claimed the slot and it fell to the fallback. */
  isFallback: boolean;
}

export interface EuclidLayerConfig {
  channel: number;
  pulses: number;
  rotation: number;
  maxRun: number;
  /** Stack placement only: the layer's own pattern length. */
  steps: number;
  /** Stack placement only: flip the mask. */
  invert: boolean;
}

/**
 * The canonical editable/playback layer set for an enabled channel palette:
 * preserve authored priority, but drop disabled channels and later duplicate
 * claims. Both the Pattern editor state and request builder use this seam so
 * the preview cannot show layers the engine will silently ignore.
 */
export function canonicalEuclidLayersForChannels<T extends EuclidLayerConfig>(
  layers: T[],
  channels: number[]
): T[] {
  const enabled = new Set(channels);
  const seen = new Set<number>();
  return layers.filter((layer) => {
    if (!enabled.has(layer.channel) || seen.has(layer.channel)) return false;
    seen.add(layer.channel);
    return true;
  });
}

/** True bucket-recursion Bjorklund (SNS-NOTE-CNTRL-99). */
export function bjorklundMask(pulses: number, steps: number): boolean[] {
  const n = Math.max(0, Math.floor(steps));
  if (n === 0) return [];
  const k = Math.min(Math.max(0, Math.floor(pulses)), n);
  if (k === 0) return Array.from({ length: n }, () => false);
  if (k === n) return Array.from({ length: n }, () => true);
  let lead: boolean[][] = Array.from({ length: k }, () => [true]);
  let tail: boolean[][] = Array.from({ length: n - k }, () => [false]);
  while (tail.length > 1) {
    const take = Math.min(lead.length, tail.length);
    const folded = lead
      .slice(0, take)
      .map((head, index) => [...head, ...tail[index]!]);
    const leftover = lead.length > take ? lead.slice(take) : tail.slice(take);
    lead = folded;
    tail = leftover;
  }
  return [...lead, ...tail].flat();
}

/**
 * Bjorklund with a maximum burst run length (moinsound 2022, CC-BY):
 * cluster the pulses into ceil(k/L) bursts (full-length first, one shorter
 * remainder last), Bjorklund-distribute the bursts among the rests, and
 * expand. maxRun = 1 is exactly `bjorklundMask`; (5, 13, 3) is
 * 1110000110000. Needs at least as many rests as bursts to keep every run
 * at or under maxRun — with fewer rests adjacent bursts merge.
 */
export function bjorklundBurstMask(
  pulses: number,
  steps: number,
  maxRun: number
): boolean[] {
  const n = Math.max(0, Math.floor(steps));
  if (n === 0) return [];
  const k = Math.min(Math.max(0, Math.floor(pulses)), n);
  const run = Math.min(Math.max(1, Math.floor(maxRun)), n);
  if (k === 0 || run === 1) return bjorklundMask(pulses, steps);
  const fullBursts = Math.floor(k / run);
  const remainder = k % run;
  const bursts = fullBursts + (remainder > 0 ? 1 : 0);
  const rests = n - k;
  const scaffold = bjorklundMask(bursts, bursts + rests);
  const out: boolean[] = [];
  let emitted = 0;
  for (const slot of scaffold) {
    if (slot) {
      const size = emitted < fullBursts ? run : remainder;
      for (let i = 0; i < size; i += 1) out.push(true);
      emitted += 1;
    } else {
      out.push(false);
    }
  }
  return out;
}

/** Rotates a mask later by `rotation` slots (engine rotation convention). */
export function rotateMaskLater(mask: boolean[], rotation: number): boolean[] {
  const len = mask.length;
  if (len === 0) return [];
  const rot = ((Math.round(rotation) % len) + len) % len;
  return mask.map((_, index) => mask[(index - rot + len) % len]!);
}

/** A layer's fully resolved mask over its domain (rotation, bursts, invert). */
export function euclidLayerMask(
  layer: EuclidLayerConfig,
  domainSteps: number,
  applyInvert: boolean
): boolean[] {
  const rotated = rotateMaskLater(
    bjorklundBurstMask(layer.pulses, domainSteps, layer.maxRun),
    layer.rotation
  );
  return applyInvert && layer.invert ? rotated.map((bit) => !bit) : rotated;
}

/**
 * Partition placement: layers claim slots by iterated Bjorklund over the
 * slots earlier layers left behind (complement theorem: the complement of a
 * Euclidean rhythm is Euclidean, so every level stays maximally even
 * relative to what remains); unclaimed slots fall back. Mirrors the
 * engine's `euclid_partition_table` exactly.
 */
export function euclidPartitionTable(
  steps: number,
  layers: EuclidLayerConfig[],
  fallback: number
): EuclidTableSlot[] {
  const n = Math.max(1, Math.floor(steps));
  const table: EuclidTableSlot[] = Array.from({ length: n }, () => ({
    channel: fallback,
    isFallback: true,
  }));
  let remaining = Array.from({ length: n }, (_, index) => index);
  for (const layer of layers) {
    if (remaining.length === 0) break;
    const pulses = Math.min(Math.max(0, Math.floor(layer.pulses)), remaining.length);
    if (pulses === 0) continue;
    const mask = euclidLayerMask(
      { ...layer, pulses },
      remaining.length,
      false
    );
    const kept: number[] = [];
    remaining.forEach((slot, index) => {
      if (mask[index]) {
        table[slot] = { channel: layer.channel, isFallback: false };
      } else {
        kept.push(slot);
      }
    });
    remaining = kept;
  }
  return table;
}

export interface EuclidPartitionLayerDomain {
  /** Remaining unclaimed slots this layer's Bjorklund distributes over. */
  domain: number;
  /** The layer's pulse count after clamping to the remaining budget. */
  pulses: number;
}

/**
 * The per-layer remaining-slot domains of partition placement — the same
 * shrinking budget walk as [`euclidPartitionTable`], surfaced so the editor's
 * per-layer `E(k,n)` readout and Pulses budget describe the mask the engine
 * actually computes (layer i distributes over the slots layers 0..i-1 left
 * behind, with pulses clamped to that budget), not the full-length necklace.
 */
export function euclidPartitionLayerDomains(
  steps: number,
  layers: EuclidLayerConfig[]
): EuclidPartitionLayerDomain[] {
  const n = Math.max(1, Math.floor(steps));
  let remaining = n;
  return layers.map((layer) => {
    const domain = remaining;
    const pulses = Math.min(Math.max(0, Math.floor(layer.pulses)), remaining);
    remaining -= pulses;
    return { domain, pulses };
  });
}

/**
 * Stack placement, evaluated over `length` steps for display: at each step
 * the first layer (priority order) whose own mask is on wins, else the
 * fallback. Mirrors the engine's lazy stack evaluation.
 */
export function euclidStackTable(
  layers: EuclidLayerConfig[],
  fallback: number,
  length: number
): EuclidTableSlot[] {
  const masks = layers.map((layer) => ({
    channel: layer.channel,
    mask: euclidLayerMask(layer, Math.max(1, Math.floor(layer.steps)), true),
  }));
  return Array.from({ length: Math.max(0, Math.floor(length)) }, (_, step) => {
    for (const { channel, mask } of masks) {
      if (mask.length > 0 && mask[step % mask.length]) {
        return { channel, isFallback: false };
      }
    }
    return { channel: fallback, isFallback: true };
  });
}

/** lcm of the stack layers' lengths, capped for display/scan purposes. */
export function euclidStackPeriod(
  layers: EuclidLayerConfig[],
  cap = 64
): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let period = 1;
  for (const layer of layers) {
    const len = Math.max(1, Math.floor(layer.steps));
    period = Math.min(cap, (period / gcd(period, len)) * len);
  }
  return Math.max(1, period);
}

/**
 * Adjacent inter-onset interval vector: for each onset, the cyclic distance
 * to the next onset — E(5,9) = 101010101 is (2,2,2,2,1). Empty when the
 * mask has no onsets.
 */
export function intervalVector(mask: boolean[]): number[] {
  const n = mask.length;
  const onsets = mask.flatMap((bit, index) => (bit ? [index] : []));
  return onsets.map((onset, index) => {
    const next = onsets[(index + 1) % onsets.length]!;
    const gap = (next - onset + n) % n;
    return gap === 0 ? n : gap;
  });
}

function isRotationOf(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return false;
  const doubled = [...b, ...b];
  return doubled.some((_, start) =>
    start < b.length ? a.every((value, index) => doubled[start + index] === value) : false
  );
}

/**
 * Euclidean-string test (Ellis et al. 2003): bump the first interval up,
 * the last interval down; the result must be a rotation of the original.
 * Single-interval vectors are excluded (the operation is the identity).
 */
export function isEuclideanString(intervals: number[]): boolean {
  if (intervals.length < 2) return false;
  const candidate = [...intervals];
  candidate[0]! += 1;
  candidate[candidate.length - 1]! -= 1;
  if (candidate[candidate.length - 1]! <= 0) return false;
  return isRotationOf(candidate, intervals);
}

/** Reverse Euclidean string: the reversed interval vector is Euclidean. */
export function isReverseEuclideanString(intervals: number[]): boolean {
  return isEuclideanString([...intervals].reverse());
}

/**
 * Seeds one layer per enabled palette channel with the pulses spread by
 * largest remainder over `steps` — the first thing a user sees after
 * switching a populated track to the Euclid strategy.
 */
export function seedEuclidLayersFromChannels(
  channels: number[],
  steps: number
): EuclidLayerConfig[] {
  const count = channels.length;
  if (count === 0) return [];
  const base = Math.floor(steps / count);
  let leftover = steps - base * count;
  return channels.map((channel) => {
    const extra = leftover > 0 ? 1 : 0;
    leftover -= extra;
    return {
      channel,
      pulses: base + extra,
      rotation: 0,
      maxRun: 1,
      steps: 16,
      invert: false,
    };
  });
}
