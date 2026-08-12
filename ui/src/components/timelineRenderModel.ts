import {
  ChannelHocketPlaybackEvent,
  PulseSpan,
  ResolvedRhythmSpan,
  TransportSnapshot,
} from "../bridge";
import { TRANSPORT_EVENT_LAYERS } from "../playbackLayers";

export type CachedCycleValue<T> = {
  requestKey: string;
  value: T;
};

export interface TimelineLayerRenderModel {
  layoutCycle: number;
  ticksPerCycle: number;
  showCoherentRhythmLayer: boolean;
  showChannelHocketTransportRenderLayers: boolean;
  rhythmBySpanId: Map<number, ResolvedRhythmSpan>;
  visibleChannelHocketEvents: readonly ChannelHocketPlaybackEvent[];
}

export function cachedCycleValue<T>(
  cache: Map<number, CachedCycleValue<T>>,
  cycle: number,
  requestKey: string
): T | null {
  const cached = cache.get(cycle);
  return cached?.requestKey === requestKey ? cached.value : null;
}

export function cachedCycleValueForPlayback<T>(
  cache: Map<number, CachedCycleValue<T>>,
  cycle: number
): T | null {
  return cache.get(cycle)?.value ?? null;
}

/**
 * Select authoring/request truth for one cycle. The live slot wins only when
 * both pieces of its provenance match; otherwise only an identically keyed
 * cache entry is eligible. Playback-only fallback belongs at the display
 * boundary and must not feed generator requests or repair tools.
 */
export function exactCycleValue<T>(
  current: T | null,
  currentCycle: number | null,
  currentRequestKey: string,
  cache: Map<number, CachedCycleValue<T>>,
  cycle: number,
  requestKey: string
): T | null {
  if (currentCycle === cycle && currentRequestKey === requestKey) {
    return current;
  }
  return cachedCycleValue(cache, cycle, requestKey);
}

export function rememberCachedCycleValue<T>(
  current: Map<number, CachedCycleValue<T>>,
  cycle: number,
  requestKey: string,
  value: T,
  maxEntries = 12
): Map<number, CachedCycleValue<T>> {
  const next = new Map(current);
  // Refresh insertion order as well as value so the oldest entry, rather
  // than a frequently reused visible cycle, is the one evicted.
  next.delete(cycle);
  next.set(cycle, { requestKey, value });
  while (next.size > maxEntries) {
    const firstKey = next.keys().next().value;
    if (firstKey === undefined) {
      break;
    }
    next.delete(firstKey);
  }
  return next;
}

export function rhythmAccentSpans(pulseSpans: PulseSpan[]): PulseSpan[] {
  // A section's grouping layer suppresses its subdivision-beat accents.
  const sectionsWithAccentLayer = new Set(
    pulseSpans
      .filter((span) => span.kind === "jathiPulse" && span.sectionIndex !== null)
      .map((span) => span.sectionIndex as number)
  );

  return pulseSpans.filter((span) => {
    if (span.kind === "jathiPulse") {
      return true;
    }
    if (span.kind === "gatiBeat" && span.sectionIndex !== null) {
      return !sectionsWithAccentLayer.has(span.sectionIndex);
    }
    return false;
  });
}

export function transportSnapshotRenderKey(snapshot: TransportSnapshot): string {
  return [
    snapshot.isPlaying ? "play" : "stop",
    snapshot.currentCycle,
    snapshot.ticksPerCycle,
    snapshot.tempoBpm.toFixed(4),
    snapshot.currentScoreId ?? "",
    snapshotParallelPositionsKey(snapshot.parallelTrackPositions),
    // One entry per playback layer, driven by the shared descriptor table —
    // a layer missing here can no longer go silently stale in the timeline.
    ...TRANSPORT_EVENT_LAYERS.map((layer) =>
      layer.renderKey === "sequenced"
        ? snapshotSequencedEventsKey(snapshot[layer.key])
        : snapshotPlaybackLayerKey(snapshot[layer.key])
    ),
  ].join(";");
}

export function snapshotParallelPositionsKey(
  positions: TransportSnapshot["parallelTrackPositions"]
): string {
  return positions
    .map((position) =>
      [
        position.trackId,
        position.cycle,
        position.ticksPerCycle,
        position.referenceStartTick,
        position.referenceEndTick,
      ].join(":")
    )
    .join("|");
}

export function snapshotPlaybackLayerKey(events: readonly unknown[]): string {
  const first = events[0];
  const last = events.at(-1);
  const eventKey = (event: unknown): string =>
    [
      snapshotEventNumber(event, "cycle") ?? "",
      snapshotEventNumber(event, "startTick") ?? "",
      snapshotEventNumber(event, "endTick") ?? "",
      snapshotEventNumber(event, "count") ?? "",
      snapshotEventNumber(event, "pitch") ?? "",
      snapshotEventNumber(event, "channel") ?? "",
    ].join(".");
  return `${events.length}:${eventKey(first)}:${eventKey(last)}`;
}

export function snapshotSequencedEventsKey(events: readonly unknown[]): string {
  const last = events.at(-1);
  const lastSequence = snapshotEventNumber(last, "sequence");
  const lastCycle = snapshotEventNumber(last, "cycle");
  const lastTick =
    snapshotEventNumber(last, "tickInCycle") ??
    snapshotEventNumber(last, "startTick") ??
    snapshotEventNumber(last, "eventTick");
  return `${events.length}:${lastSequence ?? ""}:${lastCycle ?? ""}:${lastTick ?? ""}`;
}

export function snapshotEventNumber(event: unknown, key: string): number | null {
  if (!event || typeof event !== "object") {
    return null;
  }
  const value = (event as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
