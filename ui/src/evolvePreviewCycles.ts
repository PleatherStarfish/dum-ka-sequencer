import type { EvolutionDirective } from "./bridge";

export const EVOLVE_PREVIEW_CACHE_FLOOR = 128;
export const EVOLVE_PREVIEW_CACHE_CEILING = 512;

export interface EvolutionPreviewCycleSelection {
  cycles: number[];
  cacheLimit: number;
}

const boundedCycle = (cycle: number, maxCycle: number): number =>
  Math.min(maxCycle, Math.max(0, Math.round(Number.isFinite(cycle) ? cycle : 0)));

/**
 * Keep every visible composition cell cacheable, then spend the remaining
 * bounded cache budget on nearby directive edges. Bounding the requested set
 * to the same limit as the LRU prevents an open editor from endlessly
 * refetching entries it just evicted when a large plan has many endpoints.
 */
export function selectEvolutionPreviewCycles(
  plan: readonly Pick<EvolutionDirective, "order" | "fromCycle" | "toCycle">[],
  visibleFrom: number,
  visibleTo: number,
  maxCycle: number,
  cacheFloor = EVOLVE_PREVIEW_CACHE_FLOOR
): EvolutionPreviewCycleSelection {
  const safeMax = Math.max(0, Math.round(maxCycle));
  const from = boundedCycle(Math.min(visibleFrom, visibleTo), safeMax);
  const to = Math.min(
    boundedCycle(Math.max(visibleFrom, visibleTo), safeMax),
    from + EVOLVE_PREVIEW_CACHE_CEILING - 1
  );
  const visibleCount = to - from + 1;
  const cacheLimit = Math.min(
    EVOLVE_PREVIEW_CACHE_CEILING,
    Math.max(1, Math.round(cacheFloor), visibleCount)
  );
  const requested = new Set<number>();
  for (let cycle = from; cycle <= to; cycle += 1) requested.add(cycle);

  const distanceFromWindow = (cycle: number) =>
    cycle < from ? from - cycle : cycle > to ? cycle - to : 0;
  const endpoints = plan
    .flatMap((directive, sourceIndex) =>
      [
        directive.fromCycle - 1,
        directive.fromCycle,
        directive.toCycle,
        directive.toCycle + 1,
      ].map((cycle, edgeIndex) => ({
        cycle: boundedCycle(cycle, safeMax),
        distance: distanceFromWindow(boundedCycle(cycle, safeMax)),
        order: directive.order,
        sourceIndex,
        edgeIndex,
      }))
    )
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.order - right.order ||
        left.sourceIndex - right.sourceIndex ||
        left.edgeIndex - right.edgeIndex
    );
  for (const endpoint of endpoints) {
    if (requested.size >= cacheLimit) break;
    requested.add(endpoint.cycle);
  }

  return { cycles: [...requested].sort((a, b) => a - b), cacheLimit };
}
