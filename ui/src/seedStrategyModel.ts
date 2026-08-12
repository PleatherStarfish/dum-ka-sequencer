import type { RhythmSeedMode, U64SeedDecimal } from "./bridge";
import type { RhythmSeedBehaviorName, SeedModeName } from "./patchIo";

export const SEED_LOOP_MONITOR_MODES: readonly RhythmSeedBehaviorName[] = [
  "history",
];

export interface SeedSource {
  seed: number;
  history: U64SeedDecimal[];
  historyWeight: number;
  newSeedWeight: number;
  maxHistory: number;
}

function retainedSeedMode(
  mode: SeedModeName | RhythmSeedBehaviorName,
  source: SeedSource
): RhythmSeedMode {
  if (mode === "history") {
    return {
      type: "history",
      seed: source.seed,
      history: source.history,
      historyWeight: Math.round(Math.max(0, source.historyWeight)),
      newSeedWeight: Math.round(Math.max(0, source.newSeedWeight)),
      maxHistory: source.maxHistory,
    };
  }
  if (mode === "locked") return { type: "locked", seed: source.seed };
  return { type: "perCycle", seed: source.seed };
}

/** Resolve the retained Locked/PerCycle/History modes for a child stream. */
export function childStreamSeedModeRequest(
  behavior: RhythmSeedBehaviorName,
  global: { mode: SeedModeName } & SeedSource,
  own: SeedSource
): RhythmSeedMode {
  return behavior === "followGlobal"
    ? retainedSeedMode(global.mode, global)
    : retainedSeedMode(behavior, own);
}
