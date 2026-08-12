/**
 * Frontend descriptor table for the transport's playback metadata layers.
 *
 * The Rust side declares every layer once in
 * `crates/cseq-transport/src/layers.rs` (`PlaybackLayers`); this module is
 * its frontend mirror. Per-layer UI boilerplate that is not actual rendering
 * — stable empty-array identities, snapshot render-key derivation — iterates
 * this table instead of being hand-listed per layer, so adding a layer here
 * is one row (plus the renderer, which is irreducibly per-layer).
 *
 * Agreement with the backend is tested, not promised:
 * - compile time: every key must be an event-array field of
 *   `TransportSnapshot` (see the assertion type below), so a renamed DTO
 *   field fails `pnpm typecheck`;
 * - runtime: `playbackLayers.test.ts` checks the table against the
 *   Rust-generated golden snapshot fixture in both directions, so a layer
 *   added in Rust without a descriptor row fails vitest.
 */
import type {
  ChannelHocketPlaybackEvent,
  TransportSnapshot,
} from "./bridge";

/** Stable empty-array identities for memoized layer selections. */
export const EMPTY_CHANNEL_HOCKET_EVENTS: ChannelHocketPlaybackEvent[] = [];

/**
 * How a layer contributes to the snapshot render key:
 * - `sequenced`: rolling logs keyed by their tail entry's sequence/cycle —
 *   cheap monotonic cursor.
 * - `playbackLayer`: cycle-window overlays keyed by every event's geometry
 *   (events within the window can be replaced wholesale on re-realize).
 */
export type LayerRenderKeyKind = "sequenced" | "playbackLayer";

export interface TransportEventLayerDescriptor {
  key: TransportEventLayerKey;
  renderKey: LayerRenderKeyKind;
}

export type TransportEventLayerKey =
  | "midiDebugEvents"
  | "automationEvents"
  | "channelHocketEvents"
  | "seedTraceEvents"
  | "parallelConflictEvents"
  | "triggerDecisionEvents"
  | "realizedRhythmEvents"
  | "trackFlowEvents";

// Compile-time agreement with bridge.ts: every layer key must exist on
// TransportSnapshot and hold an array. A renamed or removed DTO field makes
// this constant fail to typecheck.
type LayerKeysAreSnapshotArrays =
  TransportSnapshot[TransportEventLayerKey] extends readonly unknown[]
    ? true
    : never;
const LAYER_KEYS_ARE_SNAPSHOT_ARRAYS: LayerKeysAreSnapshotArrays = true;
void LAYER_KEYS_ARE_SNAPSHOT_ARRAYS;

/**
 * One row per layer, in the (stable) order the snapshot render key has
 * always used. Mirrors `PlaybackLayers` in `cseq-transport`.
 */
export const TRANSPORT_EVENT_LAYERS: readonly TransportEventLayerDescriptor[] = [
  { key: "midiDebugEvents", renderKey: "sequenced" },
  { key: "automationEvents", renderKey: "sequenced" },
  { key: "channelHocketEvents", renderKey: "playbackLayer" },
  { key: "seedTraceEvents", renderKey: "sequenced" },
  { key: "parallelConflictEvents", renderKey: "sequenced" },
  { key: "triggerDecisionEvents", renderKey: "sequenced" },
  // Cycle-window overlay (Rust `Retention::CycleWindow`): the realized rhythm
  // spans that source the live timeline rhythm row, so the row re-keys with the
  // audio it was realized from.
  { key: "realizedRhythmEvents", renderKey: "playbackLayer" },
  // Cycle-window overlay: per-box Track Flow lane selections (the "Box → Track"
  // readout). Grouped by `laneId` in the UI.
  { key: "trackFlowEvents", renderKey: "playbackLayer" },
];
