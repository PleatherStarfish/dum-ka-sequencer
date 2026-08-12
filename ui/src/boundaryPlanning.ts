/**
 * Deterministic boundary authoring helpers.
 */
import {
  BoundaryPoint,
} from "./patchIo";
export function firstOpenBoundaryAfterBeat(
  boundaries: BoundaryPoint[],
  cycleBeats: number
): number {
  const used = new Set(boundaries.map((boundary) => boundary.afterBeat));
  return (
    Array.from({ length: Math.max(0, cycleBeats - 1) }, (_, i) => i + 1).find(
      (afterBeat) => !used.has(afterBeat)
    ) ?? Math.max(1, cycleBeats - 1)
  );
}

export function makeBoundaryPoint(afterBeat: number, id = newStableId("boundary")): BoundaryPoint {
  return {
    id,
    afterBeat,
    changeProbability: 1,
    weights: [{ subdivision: 4, weight: 1 }],
    jathiWeights: [],
    customSubdivision: null,
  };
}

export function newStableId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
