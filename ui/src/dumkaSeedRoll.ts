/**
 * Seeded Euclidean seed-pattern roller: composes a Dum-Ka pattern out of
 * per-beat Euclidean necklaces, carrying Caesura's extension set — burst
 * clustering (`bjorklund_burst_mask`, moinsound 2022), mask inversion
 * (Toussaint: the complement of a Euclidean rhythm is again Euclidean),
 * and the Silent/Tied rest policy (`EuclideanRestPolicy`).
 *
 * This is an AUTHORING tool: the output is ordinary pattern text committed
 * through the same path as typing, so playback and replay never depend on
 * this module — determinism per (rollSeed, options) exists purely so a
 * roll the user liked can be reproduced by keeping its number. Plain
 * un-rotated-or-rotated rolls emit the readable `E(k,n,r)` sugar; burst
 * and inverted rolls emit their expanded masks, exactly like the builder's
 * E-fill does.
 */
import {
  dumkaEuclid,
  DUMKA_MAX_SUBDIVISION,
  DUMKA_MAX_TOTAL_BEATS,
} from "./dumkaPattern";

export type SeedRollDensity = "sparse" | "medium" | "dense";
export type SeedRollStyle = "plain" | "bursts" | "inverted";

export interface SeedRollOptions {
  /**
   * Minimal compiler-visible slot count for each physical beat. The vector is
   * truncated only to the platform beat cap (128), and each entry is clamped
   * only to the platform Subdivision cap (64). Its length owns cycle length,
   * so a caller cannot pair one beat count with a contradictory grid.
   */
  slotsPerBeat: readonly number[];
  density: SeedRollDensity;
  style: SeedRollStyle;
  restPolicy: "silent" | "tied";
}

const MASK64 = (1n << 64n) - 1n;

/** SplitMix64 over BigInt — self-contained; nothing replays through it. */
function splitMix64(state: bigint): { next: bigint; value: bigint } {
  const next = (state + 0x9e3779b97f4a7c15n) & MASK64;
  let z = next;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  z = z ^ (z >> 31n);
  return { next, value: z };
}

class Roll {
  private state: bigint;

  constructor(seed: number) {
    this.state = BigInt(Math.max(0, Math.floor(seed))) & MASK64;
  }

  below(bound: number): number {
    if (bound <= 1) return 0;
    const drawn = splitMix64(this.state);
    this.state = drawn.next;
    return Number(drawn.value % BigInt(bound));
  }
}

const STROKES = ["dum", "dum", "ka", "ka", "x"] as const;

/** Caesura's burst clustering, mirrored for expanded-mask emission. */
export function burstMask(pulses: number, steps: number, maxRun: number): boolean[] {
  if (steps <= 0) return [];
  const k = Math.min(pulses, steps);
  const run = Math.min(Math.max(1, maxRun), steps);
  if (k <= 0 || run === 1) return dumkaEuclid(k, steps, 0);
  const fullBursts = Math.floor(k / run);
  const remainder = k % run;
  const bursts = fullBursts + (remainder > 0 ? 1 : 0);
  const rests = steps - k;
  const scaffold = dumkaEuclid(bursts, bursts + rests, 0);
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

function densityRange(density: SeedRollDensity, slots: number): [number, number] {
  const quarter = Math.max(1, Math.round(slots / 4));
  const half = Math.max(1, Math.round(slots / 2));
  switch (density) {
    case "sparse":
      return [1, quarter];
    case "medium":
      return [quarter, half];
    case "dense":
      return [half, Math.max(1, slots - 1)];
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/**
 * Compiler-visible local grid of an expanded mask. Silent slots always start
 * rest elements. Under Tied, only leading rests and sounding slots start new
 * elements; later silent slots are holds and can therefore collapse the
 * pattern's required grid even though the printed group still has `n` glyphs.
 */
function expandedMaskSubdivision(
  mask: readonly boolean[],
  restPolicy: "silent" | "tied"
): number {
  if (mask.length <= 1) return 1;
  let subdivision = 1;
  let previousWasRest = false;
  for (let index = 0; index < mask.length; index += 1) {
    const sounds = mask[index]!;
    const startsElement: boolean =
      sounds || restPolicy === "silent" || index === 0 || previousWasRest;
    if (startsElement) {
      const denominator = mask.length / gcd(index, mask.length);
      subdivision = lcm(subdivision, denominator);
    }
    previousWasRest = !sounds && startsElement;
  }
  return subdivision;
}

function rotateRight(mask: readonly boolean[], by: number): boolean[] {
  if (mask.length === 0) return [];
  const split = (mask.length - (by % mask.length)) % mask.length;
  return [...mask.slice(split), ...mask.slice(0, split)];
}

/**
 * A tied expanded mask can hide its own slot boundaries (for example
 * `[x _ _ _ _]` compiles on a one-slot grid). Search the remaining cyclic
 * orientations without consuming another random draw and choose the first
 * one whose exact compiler-visible grid remains `n`. Every non-trivial mask
 * has both a sound and a rest; an orientation beginning on a rest necessarily
 * exposes the `1/n` boundary, so the search is total.
 */
function preserveExpandedGrid(
  mask: boolean[],
  restPolicy: "silent" | "tied"
): boolean[] {
  if (
    restPolicy !== "tied" ||
    expandedMaskSubdivision(mask, restPolicy) === mask.length
  ) {
    return mask;
  }
  for (let offset = 1; offset < mask.length; offset += 1) {
    const candidate = rotateRight(mask, offset);
    if (expandedMaskSubdivision(candidate, restPolicy) === mask.length) {
      return candidate;
    }
  }
  return mask;
}

function expandedBeat(
  mask: boolean[],
  roll: Roll,
  restPolicy: "silent" | "tied"
): string {
  const glyphs: string[] = [];
  for (const sounds of mask) {
    if (sounds) {
      glyphs.push(STROKES[roll.below(STROKES.length)]!);
    } else if (restPolicy === "tied" && glyphs.length > 0 && glyphs[glyphs.length - 1] !== ".") {
      glyphs.push("_");
    } else {
      glyphs.push(".");
    }
  }
  return `[${glyphs.join(" ")}]`;
}

/**
 * Roll one cycle. Deterministic per (rollSeed, options); every beat draws
 * its own k (by density), rotation, and — for expanded styles — stroke
 * classes. The result always parses: plain style emits `E(k,n,r)` sugar,
 * the extension styles emit expanded per-beat groups.
 */
export function rollEuclideanSeed(rollSeed: number, options: SeedRollOptions): string {
  const requestedSlots = options.slotsPerBeat.slice(0, DUMKA_MAX_TOTAL_BEATS);
  const slotsPerBeat = (requestedSlots.length > 0 ? requestedSlots : [1]).map(
    (slots) =>
      Math.min(
        DUMKA_MAX_SUBDIVISION,
        Math.max(1, Number.isFinite(slots) ? Math.floor(slots) : 1)
      )
  );
  const roll = new Roll(rollSeed);
  const parts: string[] = [];
  for (const slots of slotsPerBeat) {
    const [low, high] = densityRange(options.density, slots);
    const k = Math.min(slots, low + roll.below(high - low + 1));
    const rotation = roll.below(slots);
    if (options.style === "plain") {
      parts.push(rotation === 0 ? `E(${k},${slots})` : `E(${k},${slots},${rotation})`);
      continue;
    }
    let mask =
      options.style === "bursts"
        ? burstMask(k, slots, 2 + roll.below(2))
        : dumkaEuclid(k, slots, 0);
    mask = rotateRight(mask, rotation);
    if (options.style === "inverted") {
      mask = mask.map((bit) => !bit);
    }
    mask = preserveExpandedGrid(mask, options.restPolicy);
    parts.push(expandedBeat(mask, roll, options.restPolicy));
  }
  return parts.join(" ");
}
