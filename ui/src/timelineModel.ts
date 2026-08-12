import type { U64SeedDecimal } from "./bridge";

export interface TimelinePlaybackState {
  isPlaying: boolean;
}

export interface TimelinePlaybackEvent {
  cycle: number;
}

export interface TimelineSnapshotRenderLayers<
  ChannelEvent extends TimelinePlaybackEvent,
> extends TimelinePlaybackState {
  channelHocketEvents: readonly ChannelEvent[];
}

export interface TimelineRenderLayerSelection<
  ChannelEvent extends TimelinePlaybackEvent,
> {
  cycleIndex: number;
  showTransportRenderLayers: boolean;
  activeChannelHocketEvents: readonly ChannelEvent[];
}

export interface TimelineTransportLayerVisibilityInput {
  showTransportRenderLayers: boolean;
  previewCoherent: boolean;
  rhythmCoherent: boolean;
}

export interface TimelineTransportLayerVisibility {
  showChannelHocketTransportRenderLayers: boolean;
  showFullyCoherentTransportRenderLayers: boolean;
}

export interface TimelineAutomationTrackLike {
  target: string;
  enabled: boolean;
}

export interface TimelineParallelTrackPositionLike {
  trackId: string;
}

export interface TimelineParallelTrackEventLike {
  parallelTrackId?: string | null;
}

export interface TimelineCoherenceInput {
  isPlaying: boolean;
  cycleIndex: number;
  previewCycle: number | null | undefined;
  rhythmCycle: number | null | undefined;
  rhythmEnabled: boolean;
}

export interface StableTimelineRenderModelInput<Model> {
  isPlaying: boolean;
  currentModel: Model;
  currentCoherent: boolean;
  lastCoherentModel: Model | null;
}

export interface StableTimelineRenderModel<Model> {
  model: Model;
  usingLastCoherentModel: boolean;
}

export interface SeedTraceLike {
  cycle: number;
  domain: string;
  seed: U64SeedDecimal;
  source: string;
  historyBefore: readonly U64SeedDecimal[];
}

export interface SeedRecurrenceStreamInput {
  domain: string;
  label: string;
  enabled: boolean;
  inheritedFrom?: string | null;
}

export type SeedRecurrenceCellState = "repeat" | "hold" | "new" | "other" | "empty";

export interface SeedRecurrenceCell {
  cycle: number;
  state: SeedRecurrenceCellState;
  seed: U64SeedDecimal | null;
  historyIndex: number | null;
}

export interface SeedRecurrenceRow {
  domain: string;
  label: string;
  enabled: boolean;
  inheritedFrom: string | null;
  cells: SeedRecurrenceCell[];
  repeatCount: number;
  /** Drift cycles that kept the previous cycle's seed. */
  holdCount: number;
  newCount: number;
  observedCount: number;
  paceLabel: string;
  latestSeed: U64SeedDecimal | null;
}

// One stable color per MIDI channel (1..16), used as chip/marker backgrounds
// with dark-navy `--base03` text on top (see .channel-event-marker /
// .channel-chip in styles.css) in BOTH themes — so every entry must stay light
// enough to keep that bold text legible. Channels 1-8 are the Solarized Astral
// accent palette; 9-16 are a lighter companion ring that walks the hue wheel
// through the gaps, chosen so all 16 are distinct (min ΔE2000 ≈ 13.8, matching
// the accent ring's own internal spread) and saturated enough (HSV S ≥ 0.4) to
// clear the light-theme dark-container-leak guard in theme-contrast.spec.ts.
export const TIMELINE_CHANNEL_COLORS = [
  "#bb8800", // yellow
  "#008cde", // blue
  "#56a070", // green
  "#ca5021", // orange
  "#8263d4", // violet
  "#e12f43", // red
  "#00a39f", // cyan
  "#e11984", // magenta
  "#f4ad67", // gold
  "#d3ca1b", // lime
  "#60b02d", // grass
  "#5fddc1", // spring
  "#1eb5e0", // sky
  "#92aaff", // indigo
  "#b956c8", // orchid
  "#ea728d", // coral
] as const;

/**
 * Random-access stopped previews recompute cumulative generators from cycle 0.
 * Keep that user-authored inspection window bounded; live playback cycles are
 * intentionally not clamped by this value.
 */
export const MAX_STOPPED_PREVIEW_CYCLE = 10_000;

export function timelineCycleIndex(cycle: number): number {
  return Math.max(0, Math.floor(Number.isFinite(cycle) ? cycle : 0));
}

export function stoppedPreviewCycleIndex(cycle: number): number {
  return Math.min(MAX_STOPPED_PREVIEW_CYCLE, timelineCycleIndex(cycle));
}

export function timelineChannelColor(channel: number): string {
  const channelNumber = Number.isFinite(channel) ? Math.trunc(channel) : 1;
  const index = Math.max(
    0,
    Math.min(TIMELINE_CHANNEL_COLORS.length - 1, channelNumber - 1)
  );
  return TIMELINE_CHANNEL_COLORS[index] ?? TIMELINE_CHANNEL_COLORS[0];
}

export function pruneTimelineAutomationTargetIds<
  Track extends TimelineAutomationTrackLike,
>(selectedTargetIds: readonly string[], tracks: readonly Track[]): string[] {
  const enabledTargets = new Set(
    tracks.filter((track) => track.enabled).map((track) => track.target)
  );
  const seenTargets = new Set<string>();
  return selectedTargetIds.filter((target) => {
    if (seenTargets.has(target) || !enabledTargets.has(target)) {
      return false;
    }
    seenTargets.add(target);
    return true;
  });
}

export function selectTimelineAutomationTracks<
  Track extends TimelineAutomationTrackLike,
>(tracks: readonly Track[], selectedTargetIds: readonly string[]): Track[] {
  const visibleTargets = new Set(
    pruneTimelineAutomationTargetIds(selectedTargetIds, tracks)
  );
  return tracks.filter((track) => track.enabled && visibleTargets.has(track.target));
}

export function selectActiveParallelTrackPosition<
  Position extends TimelineParallelTrackPositionLike,
>(
  positions: readonly Position[],
  activeTrackId: string | null | undefined
): Position | null {
  if (!activeTrackId) {
    return null;
  }
  return positions.find((position) => position.trackId === activeTrackId) ?? null;
}

export function timelineEventBelongsToActiveTrack(
  event: TimelineParallelTrackEventLike,
  activeTrackId: string | null | undefined
): boolean {
  return !activeTrackId || !event.parallelTrackId || event.parallelTrackId === activeTrackId;
}

// ---------------------------------------------------------------------------
// Seed-path track scoping
//
// Seed-path replay must be per-track in parallel mode. A decision is recorded
// against its source track; on replay an entry/wildcard applies to a track only
// when the track ids match by this rule. Mirrored exactly in Rust
// (`seed_path_track_matches`) so the record and replay sides cannot drift.
// ---------------------------------------------------------------------------

export interface SeedPathTrackScopedLike {
  trackId?: string | null;
}

/**
 * A `null` recorded id (legacy/single-track) matches any track; a `null`
 * restricting track (single-track playback) accepts any recorded item; two
 * concrete ids must be equal. This keeps single-track and legacy replay
 * byte-identical while making multi-track replay track-precise.
 */
export function seedPathTrackMatches(
  recorded: string | null | undefined,
  restrictTo: string | null | undefined
): boolean {
  if (recorded == null || restrictTo == null) return true;
  return recorded === restrictTo;
}

/** Keep only the seed-path items (entries or wildcards) that apply to a track. */
export function filterSeedPathItemsForTrack<Item extends SeedPathTrackScopedLike>(
  items: readonly Item[],
  trackId: string | null | undefined
): Item[] {
  return items.filter((item) => seedPathTrackMatches(item.trackId ?? null, trackId));
}

export interface SeedTraceDedupeKeyLike {
  trackId?: string | null;
  cycle: number;
  domain: string;
  label: string;
}

/**
 * Dedupe key for recorded seed-trace points. Includes the source track so
 * multi-track decisions sharing a domain/cycle are not collapsed into one.
 * `?? ""` keeps single-track/legacy keys stable across versions.
 */
export function seedTraceDedupeKey(point: SeedTraceDedupeKeyLike): string {
  return `${point.trackId ?? ""}:${point.cycle}:${point.domain}:${point.label}`;
}

export function selectEffectivePreviewCycle(
  snapshot: TimelinePlaybackState | null,
  visualCycle: number,
  userPreviewCycle: number
): number {
  return snapshot?.isPlaying
    ? timelineCycleIndex(visualCycle)
    : stoppedPreviewCycleIndex(userPreviewCycle);
}

export function selectTimelineRenderLayers<
  ChannelEvent extends TimelinePlaybackEvent,
>(
  snapshot: TimelineSnapshotRenderLayers<ChannelEvent> | null,
  displayedCycle: number,
  emptyChannelHocketEvents: readonly ChannelEvent[]
): TimelineRenderLayerSelection<ChannelEvent> {
  const cycleIndex = timelineCycleIndex(displayedCycle);
  if (!snapshot?.isPlaying) {
    return {
      cycleIndex,
      showTransportRenderLayers: false,
      activeChannelHocketEvents: emptyChannelHocketEvents,
    };
  }

  return {
    cycleIndex,
    showTransportRenderLayers: true,
    activeChannelHocketEvents: snapshot.channelHocketEvents.filter(
      (event) => event.cycle === cycleIndex
    ),
  };
}

export interface ActiveTrackTimelineLayersInput<
  ChannelEvent extends TimelineParallelTrackEventLike,
> {
  activeTrackId: string | null | undefined;
  showChannelHocketTransportRenderLayers: boolean;
  // Cycle-filtered events from selectTimelineRenderLayers (already scoped to
  // the displayed local cycle).
  activeChannelHocketEvents: readonly ChannelEvent[];
  emptyChannelHocketEvents: readonly ChannelEvent[];
}

export interface ActiveTrackTimelineLayers<
  ChannelEvent extends TimelineParallelTrackEventLike,
> {
  visibleChannelHocketEvents: readonly ChannelEvent[];
}

/**
 * Compose the full timeline-vs-MIDI parity contract for playback-only layers:
 * an event is visible only when its layer is coherent (visibility flag true)
 * AND it belongs to the active track. The cycle filter is applied upstream by
 * `selectTimelineRenderLayers`, so the resulting layers are scoped to the
 * active track's local cycle and the active track id together. This guarantees
 * the active-track timeline never shows another track's notes/rhythms, even
 * when a custom-tempo track sits on a different local cycle than its peers.
 *
 */
export function selectActiveTrackTimelineLayers<
  ChannelEvent extends TimelineParallelTrackEventLike,
>(
  input: ActiveTrackTimelineLayersInput<ChannelEvent>
): ActiveTrackTimelineLayers<ChannelEvent> {
  const {
    activeTrackId,
    showChannelHocketTransportRenderLayers,
  } = input;
  return {
    visibleChannelHocketEvents: showChannelHocketTransportRenderLayers
      ? input.activeChannelHocketEvents.filter((event) =>
          timelineEventBelongsToActiveTrack(event, activeTrackId)
        )
      : input.emptyChannelHocketEvents,
  };
}

// ---------------------------------------------------------------------------
// Realized rhythm row source (timeline/playback parity, Phase 1).
//
// The rhythm row is the last timeline lane that historically re-derived its data
// through a *preview* path while ratchet/grace/audio came from transport-realized
// metadata — so in history seed mode the row could disagree with what played.
// During playback the row must be sourced from the realized snapshot (same data
// that drove the audio), scoped to the visible cycle and active track. When
// stopped, callers fall back to preview for arbitrary-cycle inspection.
// ---------------------------------------------------------------------------

export interface TimelineRealizedRhythmEvent<Span> extends TimelineParallelTrackEventLike {
  cycle: number;
  span: Span;
}

export interface TimelineRealizedRhythmSnapshot<Span> extends TimelinePlaybackState {
  realizedRhythmEvents: readonly TimelineRealizedRhythmEvent<Span>[];
}

/**
 * Build the rhythm row's span map from transport-realized rhythm events for the
 * visible cycle + active track. Empty when stopped (caller uses preview then).
 * This is the single realized source for the live rhythm row — keep it the only
 * playback-time path so the row can never diverge from the audio again.
 */
export function selectRealizedRhythmBySpanId<Span extends { spanId: number }>(
  snapshot: TimelineRealizedRhythmSnapshot<Span> | null,
  displayedCycle: number,
  activeTrackId: string | null | undefined
): Map<number, Span> {
  const map = new Map<number, Span>();
  if (!snapshot?.isPlaying) return map;
  const cycleIndex = timelineCycleIndex(displayedCycle);
  for (const event of snapshot.realizedRhythmEvents) {
    if (event.cycle !== cycleIndex) continue;
    if (!timelineEventBelongsToActiveTrack(event, activeTrackId)) continue;
    map.set(event.span.spanId, event.span);
  }
  return map;
}

/**
 * Lane-source guardrail registry (Phase 1, runtime — not a type-level redesign).
 * Every timeline lane that depicts a *realized stochastic outcome* must be
 * `"realized-snapshot"` during playback, never `"preview"` re-resolved. A test
 * asserts this whole table is realized-sourced; adding a preview-sourced playback
 * lane here (or omitting a new realized lane) fails that test, so the rhythm-row
 * parity regression cannot silently come back via another feature.
 */
export type TimelineLaneSource = "realized-snapshot" | "preview-only-when-stopped";

export const TIMELINE_PLAYBACK_LANE_SOURCES = {
  rhythm: "realized-snapshot",
  channelHocket: "realized-snapshot",
} as const satisfies Record<string, TimelineLaneSource>;

/**
 * Coordinate-space contract for each playback lane (companion to
 * `TIMELINE_PLAYBACK_LANE_SOURCES`). It declares how a lane turns finalized
 * transport data into horizontal timeline position:
 *
 * - `"akshara-native"` — drawn directly from musical akshara spans (rhythm row);
 *   no tick→position conversion happens, so there is nothing to warp.
 * - `"tick-via-identity-helper"` — markers come from finalized transport ticks and
 *   convert through `timelineTickToMusicalAkshara`.
 *
 * Keying off
 * `TIMELINE_PLAYBACK_LANE_SOURCES` means a new playback lane cannot be added to
 * one registry without declaring its tick space in the other.
 */
export type TimelineLaneTickSpace = "akshara-native" | "tick-via-identity-helper";

export const TIMELINE_PLAYBACK_LANE_TICK_SPACE = {
  rhythm: "akshara-native",
  channelHocket: "tick-via-identity-helper",
} as const satisfies Record<
  keyof typeof TIMELINE_PLAYBACK_LANE_SOURCES,
  TimelineLaneTickSpace
>;

export function selectTimelineTransportLayerVisibility({
  showTransportRenderLayers,
  previewCoherent,
  rhythmCoherent,
}: TimelineTransportLayerVisibilityInput): TimelineTransportLayerVisibility {
  const showLayoutAlignedTransportLayers = showTransportRenderLayers && previewCoherent;
  const showFullyCoherentTransportRenderLayers =
    showLayoutAlignedTransportLayers && rhythmCoherent;
  return {
    showChannelHocketTransportRenderLayers: showFullyCoherentTransportRenderLayers,
    showFullyCoherentTransportRenderLayers,
  };
}

export function timelineSourcesAreCoherent({
  isPlaying,
  cycleIndex,
  previewCycle,
  rhythmCycle,
  rhythmEnabled,
}: TimelineCoherenceInput): boolean {
  if (!isPlaying) {
    return true;
  }
  if (previewCycle !== cycleIndex) {
    return false;
  }
  if (rhythmEnabled && rhythmCycle !== cycleIndex) {
    return false;
  }
  return true;
}

export function selectStableTimelineRenderModel<Model>({
  isPlaying,
  currentModel,
  currentCoherent,
  lastCoherentModel,
}: StableTimelineRenderModelInput<Model>): StableTimelineRenderModel<Model> {
  if (isPlaying && !currentCoherent && lastCoherentModel !== null) {
    return {
      model: lastCoherentModel,
      usingLastCoherentModel: true,
    };
  }
  return {
    model: currentModel,
    usingLastCoherentModel: false,
  };
}

function seedTraceCycle(event: SeedTraceLike): number {
  return timelineCycleIndex(event.cycle);
}

function eventCellForCycle(
  cycle: number,
  events: readonly SeedTraceLike[]
): SeedRecurrenceCell {
  const repeatEvent = events.find((event) => event.source === "history");
  const holdEvent = events.find(
    (event) => event.source === "drift" || event.source === "morph"
  );
  const newEvent = events.find((event) => event.source === "new");
  const selected = repeatEvent ?? holdEvent ?? newEvent ?? events.at(-1) ?? null;
  if (!selected) {
    return {
      cycle,
      state: "empty",
      seed: null,
      historyIndex: null,
    };
  }

  const historyIndex =
    selected.source === "history"
      ? selected.historyBefore.findIndex((seed) => seed === selected.seed)
      : -1;

  return {
    cycle,
    state:
      selected.source === "history"
        ? "repeat"
        : selected.source === "drift" || selected.source === "morph"
          ? "hold"
          : selected.source === "new"
            ? "new"
            : "other",
    seed: selected.seed,
    historyIndex: historyIndex >= 0 ? historyIndex : null,
  };
}

function seedRepeatPaceLabel(cells: readonly SeedRecurrenceCell[]): string {
  const repeatCycles = cells
    .filter((cell) => cell.state === "repeat")
    .map((cell) => cell.cycle);
  if (repeatCycles.length >= 2) {
    const first = repeatCycles[0] ?? 0;
    const last = repeatCycles[repeatCycles.length - 1] ?? first;
    const span = last - first;
    const pace = span / (repeatCycles.length - 1);
    return `every ${pace.toFixed(pace < 10 ? 1 : 0)}c`;
  }
  if (repeatCycles.length === 1) return "1 repeat";
  if (cells.some((cell) => cell.state === "hold")) {
    const freshCycles = cells
      .filter((cell) => cell.state === "new")
      .map((cell) => cell.cycle);
    if (freshCycles.length >= 2) {
      const first = freshCycles[0] ?? 0;
      const last = freshCycles[freshCycles.length - 1] ?? first;
      const span = last - first;
      const pace = span / (freshCycles.length - 1);
      return `fresh every ${pace.toFixed(pace < 10 ? 1 : 0)}c`;
    }
    return "holding";
  }
  if (cells.some((cell) => cell.state === "new")) return "learning";
  if (cells.some((cell) => cell.state === "other")) return "seeded";
  return "idle";
}

export function selectSeedRecurrenceRows(
  events: readonly SeedTraceLike[],
  streams: readonly SeedRecurrenceStreamInput[],
  windowSize = 16
): SeedRecurrenceRow[] {
  const size = Math.max(1, Math.min(32, Math.floor(windowSize)));
  const domains = new Set(streams.map((stream) => stream.domain));
  const relevantEvents = events.filter((event) => domains.has(event.domain));
  const maxCycle = relevantEvents.length
    ? Math.max(...relevantEvents.map(seedTraceCycle))
    : 0;
  const firstCycle = Math.max(0, maxCycle - size + 1);
  const cycles = Array.from({ length: size }, (_, index) => firstCycle + index);

  return streams.map((stream) => {
    const eventsByCycle = new Map<number, SeedTraceLike[]>();
    for (const event of relevantEvents) {
      if (event.domain !== stream.domain) continue;
      const cycle = seedTraceCycle(event);
      const current = eventsByCycle.get(cycle) ?? [];
      current.push(event);
      eventsByCycle.set(cycle, current);
    }

    const cells = cycles.map((cycle) =>
      eventCellForCycle(cycle, eventsByCycle.get(cycle) ?? [])
    );
    const repeatCount = cells.filter((cell) => cell.state === "repeat").length;
    const holdCount = cells.filter((cell) => cell.state === "hold").length;
    const newCount = cells.filter((cell) => cell.state === "new").length;
    const observedCount = cells.filter((cell) => cell.state !== "empty").length;
    const latestEvent = [...relevantEvents]
      .filter((event) => event.domain === stream.domain)
      .sort((a, b) => seedTraceCycle(a) - seedTraceCycle(b))
      .at(-1);

    return {
      domain: stream.domain,
      label: stream.label,
      enabled: stream.enabled,
      inheritedFrom: stream.inheritedFrom ?? null,
      cells,
      repeatCount,
      holdCount,
      newCount,
      observedCount,
      paceLabel: seedRepeatPaceLabel(cells),
      latestSeed: latestEvent?.seed ?? null,
    };
  });
}

// --- Triggered-track overlay (Phase E) -------------------------------------

/** Minimal shape of a `TriggerDecisionEvent` the overlay/log read. */
export interface TriggerOverlayDecisionLike {
  sourceCycleIndex: number;
  matchedBeat: number;
  eventTick: number;
  candidateTick: number;
  outcome: string;
  suppressReason: string | null;
  startKind: string;
  rollValue: number | null;
  rollThreshold: number | null;
}

/** One placed overlay mark on a single-cycle phase axis (0..1). A pure render of
 * one engine decision — never re-derived, so the overlay cannot drift from the
 * audio. */
export interface TriggerOverlayMark {
  key: string;
  sourceCycleIndex: number;
  matchedBeat: number;
  outcome: string;
  suppressReason: string | null;
  startKind: string;
  /** Phase (0..1) of the matched WHEN onset within its reference cycle. */
  eventFraction: number;
  /** Phase (0..1) of the resolved launch placement within its reference cycle. */
  placementFraction: number;
  rollValue: number | null;
  rollThreshold: number | null;
}

export interface TriggerOverlayInput {
  /** Reference ticks per cycle (the uniform reference grid). `0` ⇒ no marks. */
  referenceCycleTicks: number;
  /** Include suppressed (rejected / cooldown / ignored) candidates. */
  showRejected: boolean;
  /** Keep only the most recent `maxMarks` (bounded render). */
  maxMarks?: number;
}

const TRIGGER_OVERLAY_DEFAULT_MAX_MARKS = 32;

function triggerCyclePhase(tick: number, referenceCycleTicks: number): number {
  if (referenceCycleTicks <= 0) return 0;
  const phase = ((tick % referenceCycleTicks) + referenceCycleTicks) % referenceCycleTicks;
  return phase / referenceCycleTicks;
}

/** Build bounded, phase-positioned overlay marks from the engine decision trace.
 * Filters by `showRejected`, keeps the last `maxMarks`, and positions each mark
 * by its reference-tick phase within the cycle. Pure + order-preserving, so the
 * overlay is a faithful render of what the compiler decided. */
export function selectTriggerOverlayMarks(
  events: readonly TriggerOverlayDecisionLike[],
  {
    referenceCycleTicks,
    showRejected,
    maxMarks = TRIGGER_OVERLAY_DEFAULT_MAX_MARKS,
  }: TriggerOverlayInput
): TriggerOverlayMark[] {
  if (referenceCycleTicks <= 0) return [];
  const limit = Number.isFinite(maxMarks)
    ? Math.max(0, Math.floor(maxMarks))
    : TRIGGER_OVERLAY_DEFAULT_MAX_MARKS;
  if (limit <= 0) return [];
  const kept = events.filter((event) => showRejected || event.outcome !== "suppressed");
  const tail = kept.slice(-limit);
  return tail.map((event, index) => ({
    key: `${event.sourceCycleIndex}-${event.matchedBeat}-${index}`,
    sourceCycleIndex: event.sourceCycleIndex,
    matchedBeat: event.matchedBeat,
    outcome: event.outcome,
    suppressReason: event.suppressReason,
    startKind: event.startKind,
    eventFraction: triggerCyclePhase(event.eventTick, referenceCycleTicks),
    placementFraction: triggerCyclePhase(event.candidateTick, referenceCycleTicks),
    rollValue: event.rollValue,
    rollThreshold: event.rollThreshold,
  }));
}

/** Outcome filter shared by the trigger overlay strip and the event log. */
export type TriggerLogFilter = "all" | "launched" | "queued" | "suppressed";

/** Keep only decisions matching `filter` (pure; `all` is a copy). */
export function filterTriggerDecisions<Event extends { outcome: string }>(
  events: readonly Event[],
  filter: TriggerLogFilter
): Event[] {
  if (filter === "all") return events.slice();
  return events.filter((event) => event.outcome === filter);
}
