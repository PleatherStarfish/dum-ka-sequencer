/**
 * TS mirror of `crates/cseq-rhythm/src/generators/dumka/velocity.rs` (M4
 * metric dynamics): tier classification and the identity-seeded per-onset
 * velocity draw. The e2e mock stamps cycle-0 previews through these exact
 * functions, and `dumkaVelocity.test.ts` pins them against the Rust
 * vectors, so mock and engine can never drift silently.
 */

import type { MetricTier, MetricVelocity } from "./bridge";

const MASK64 = (1n << 64n) - 1n;

/** Pinned decision-domain salt; mirrors SALT_METRIC_VELOCITY exactly. */
export const SALT_METRIC_VELOCITY = 0xd0a1_5eed_0012_0012n;

const MIX_CONST = 0xa81f_3d2c_91b4_ee77n;

function splitMix64Next(state: bigint): { state: bigint; value: bigint } {
  const next = (state + 0x9e37_79b9_7f4a_7c15n) & MASK64;
  let z = next;
  z = ((z ^ (z >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d0_49bb_1331_11ebn) & MASK64;
  z = z ^ (z >> 31n);
  return { state: next, value: z };
}

/** Rust `mix_seed`: SplitMix64 seeded by `seed ^ K`, state advanced by the
 * cycle before the first draw. */
function mixSeed(seed: bigint, cycle: bigint): bigint {
  const state = ((seed ^ MIX_CONST) + cycle) & MASK64;
  return splitMix64Next(state).value;
}

/** Rust `velocity_draw`: uniform in the inclusive range, keyed by
 * (seed, cycle, slot) — never by draw order. */
export function velocityDraw(
  seed: bigint,
  cycle: number,
  slot: number,
  range: { min: number; max: number }
): number {
  const width = BigInt(Math.max(0, range.max - range.min));
  const state = mixSeed(
    (seed ^ SALT_METRIC_VELOCITY ^ BigInt(slot)) & MASK64,
    BigInt(cycle)
  );
  const drawn = splitMix64Next(state).value % (width + 1n);
  return range.min + Number(drawn);
}

/** Pinned composite weights; mirror velocity.rs exactly. */
const COMPOSITE_BASE_WEIGHT = 40;
const COMPOSITE_RUN_WEIGHT = 30;
const COMPOSITE_CONTEXT_WEIGHT = 30;
const MIN_RUN_LENGTH = 3;

function normalizedMilli(rank: number, count: number): number {
  if (count <= 1) return 100_000;
  return Math.floor((rank * 100_000) / (count - 1));
}

/** Rust `composite_strengths`: base grid rank × equal-spacing-run profile ×
 * underlying beat context, integer milli. `runProfile(k)` must supply the
 * Barlow ordering of k top-level beats (or the descending fallback). */
export function compositeStrengths(
  onsetSlots: readonly number[],
  ranks: readonly number[],
  totalBeats: number,
  workingSubdivision: number,
  runProfile: (k: number) => readonly number[]
): number[] {
  const slotCount = ranks.length;
  const base = (slot: number) => normalizedMilli(ranks[slot] ?? 0, slotCount);
  const beatNorm = (beat: number) =>
    base((beat % Math.max(1, totalBeats)) * workingSubdivision);

  const runComponent: Array<number | null> = onsetSlots.map(() => null);
  let start = 0;
  while (start + 1 < onsetSlots.length) {
    const gap = (onsetSlots[start + 1] ?? 0) - (onsetSlots[start] ?? 0);
    let end = start + 1;
    while (
      end + 1 < onsetSlots.length &&
      (onsetSlots[end + 1] ?? 0) - (onsetSlots[end] ?? 0) === gap
    ) {
      end += 1;
    }
    const length = end - start + 1;
    if (gap > 0 && length >= MIN_RUN_LENGTH) {
      const profile = runProfile(length);
      for (let position = 0; position < length; position += 1) {
        runComponent[start + position] = normalizedMilli(
          profile[position] ?? 0,
          length
        );
      }
      start = end;
    } else {
      start += 1;
    }
  }

  return onsetSlots.map((slot, index) => {
    const baseMilli = base(slot);
    const runMilli = runComponent[index] ?? baseMilli;
    const width = Math.max(1, workingSubdivision);
    const beat = Math.floor(slot / width);
    const offset = slot % width;
    const contextMilli = Math.floor(
      (beatNorm(beat) * (width - offset) + beatNorm(beat + 1) * offset) / width
    );
    return Math.floor(
      (COMPOSITE_BASE_WEIGHT * baseMilli +
        COMPOSITE_RUN_WEIGHT * runMilli +
        COMPOSITE_CONTEXT_WEIGHT * contextMilli) /
        100
    );
  });
}

/** Rust `auto_tiers`: percentiles of the cycle's notes by composite
 * strength, ties to the earlier slot. */
export function autoTiers(
  onsetSlots: readonly number[],
  ranks: readonly number[],
  totalBeats: number,
  workingSubdivision: number,
  strongPercent: number,
  mediumPercent: number,
  runProfile: (k: number) => readonly number[]
): MetricTier[] {
  const strengths = compositeStrengths(
    onsetSlots,
    ranks,
    totalBeats,
    workingSubdivision,
    runProfile
  );
  const count = onsetSlots.length;
  const order = onsetSlots.map((_, index) => index);
  order.sort(
    (left, right) =>
      (strengths[right] ?? 0) - (strengths[left] ?? 0) ||
      (onsetSlots[left] ?? 0) - (onsetSlots[right] ?? 0)
  );
  const strongCount = Math.ceil((strongPercent * count) / 100);
  const mediumCount = Math.ceil((mediumPercent * count) / 100);
  const tiers: MetricTier[] = onsetSlots.map(() => "weak");
  order.forEach((index, position) => {
    tiers[index] =
      position < strongCount
        ? "strong"
        : position < strongCount + mediumCount
          ? "medium"
          : "weak";
  });
  return tiers;
}

/** Rust `run_profile` fallback for run lengths outside the published Barlow
 * strata: first note strongest, descending. */
export function fallbackRunProfile(k: number): number[] {
  return Array.from({ length: k }, (_, index) => k - 1 - index);
}

/** Rust `manual_tier`: seed-grid tiers; refined slots between them are weak. */
export function manualTier(
  manualTiers: readonly MetricTier[],
  slot: number,
  refine: number
): MetricTier {
  if (refine === 0 || slot % refine !== 0) return "weak";
  return manualTiers[slot / refine] ?? "weak";
}

export function tierRange(
  config: MetricVelocity,
  tier: MetricTier
): { min: number; max: number } {
  return tier === "strong"
    ? config.strong
    : tier === "medium"
      ? config.medium
      : config.weak;
}
