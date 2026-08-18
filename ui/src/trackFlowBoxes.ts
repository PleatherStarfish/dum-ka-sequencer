/**
 * Track Flow boxes — pure model + conversion helpers.
 *
 * A Track Flow box is the project's unit of *sequential* playback: an ordered
 * set of member tracks that alternate (one per cycle, never simultaneously),
 * driven by the box's own Markov chain, and surfaced to the backend as a single
 * synthetic conflict participant `track-flow-<boxId>`. A project may hold any
 * number of boxes, each playing in parallel with ordinary parallel tracks and
 * with every other box. The v1 single Track Flow lane is the box with id `main`.
 *
 * Membership lives at project scope as ordered `memberTrackIds` (binding decision
 * #2: not a per-track `boxId`), because the order indexes the chain matrix and a
 * "track in ≤1 box" rule is a normalizer invariant rather than a cross-field
 * burden. The chain is authored *by member track id* (stable across reordering)
 * and converted to the backend's *index-based* `TrackFlowSpec` — restricted to
 * the audible members — at request-build time, exactly like the rhythm/channel
 * -hocket matrices.
 */
import type {
  MarkovOrder,
  TrackFlowEntryWeight,
  TrackFlowFallbackWeight,
  TrackFlowSpec,
  TrackFlowTransition,
} from "./bridge";

/** The reserved Track Flow id family prefix (mirrors the backend). */
export const TRACK_FLOW_PREFIX = "track-flow-";

/** v1 default seed for the migrated `main` box — must match the backend's v1
 * `TRACK_FLOW_LANE_DEFAULT_SEED = 0` so migrated projects walk identically. */
export const TRACK_FLOW_DEFAULT_SEED = 0;

/** The migrated v1 box's identity (binding decision #4 / migration section). */
export const TRACK_FLOW_DEFAULT_BOX_ID = "main";
export const TRACK_FLOW_DEFAULT_BOX_NAME = "Track Flow";

/** True if `id` falls in the reserved `track-flow-` family (a box lane id or a
 * composite seed-path id). Authored track/member ids must avoid it. */
export function isReservedTrackFlowId(id: string): boolean {
  return id.startsWith(TRACK_FLOW_PREFIX);
}

/** The conflict-lane participant id for a box: `track-flow-<boxId>`. */
export function trackFlowLaneId(boxId: string): string {
  return `${TRACK_FLOW_PREFIX}${boxId}`;
}

/** Composite seed-path id for a box member: `track-flow-<boxId>:<sourceId>`. */
export function trackFlowSeedPathId(boxId: string, sourceTrackId: string): string {
  return `${trackFlowLaneId(boxId)}:${sourceTrackId}`;
}

/**
 * A box's Markov chain, authored by member *track id* (stable across reordering
 * and membership edits). Keyed maps mirror the channel-hocket editor's storage;
 * the request builder re-indexes/prunes them to the audible members.
 *
 * Key formats (member track ids never contain `,` or `>`, see
 * `normalizeTrackId`): a transition key is `from.join(",")>to`; an entry key is
 * `states.join(",")`; a fallback-weight key is the member track id.
 */
export interface TrackFlowChainState {
  order: MarkovOrder;
  /** Transition weights, keyed `${from.join(",")}>${to}`. */
  weights: Record<string, number>;
  /** Entry weights, keyed `${states.join(",")}`. */
  entryWeights: Record<string, number>;
  /** Fallback weights, keyed by member track id. */
  fallbackWeights: Record<string, number>;
  /** Fallback member track id (`""` ⇒ default to the first audible member). */
  fallback: string;
}

export interface TrackFlowBox {
  /** Authored box id; lane id derives as `track-flow-<id>`. Non-empty,
   *  colon-free, unique, and outside the reserved family. */
  id: string;
  /** Display label (e.g. "Box A"). */
  name: string;
  /** Ordered member track ids; defines chain state indices `0..n-1`. */
  memberTrackIds: string[];
  /** Per-box Markov chain (authored by member id). */
  chain: TrackFlowChainState;
  /** Per-box chain RNG seed. */
  seed: number;
  /** Lane-UI state: true ⇒ the box shows as a single collapsed super-tab; false
   *  ⇒ its member tabs are shown inline. Persisted per box ("remember per box").
   *  Display-only — never sent to the backend. */
  collapsed: boolean;
}

export function defaultTrackFlowChain(): TrackFlowChainState {
  return {
    order: "first",
    weights: {},
    entryWeights: {},
    fallbackWeights: {},
    fallback: "",
  };
}

export function trackFlowTransitionKey(from: string[], to: string): string {
  return `${from.join(",")}>${to}`;
}

export function trackFlowEntryKey(states: string[]): string {
  return states.join(",");
}

function parseTransitionKey(key: string): { from: string[]; to: string } | null {
  const sep = key.lastIndexOf(">");
  if (sep < 0) return null;
  const fromPart = key.slice(0, sep);
  const to = key.slice(sep + 1);
  if (!to) return null;
  const from = fromPart.length ? fromPart.split(",") : [];
  return { from, to };
}

function parseEntryKey(key: string): string[] {
  return key.length ? key.split(",") : [];
}

const contextLength = (order: MarkovOrder): number => (order === "second" ? 2 : 1);

/** The set of all track ids that belong to some box. */
export function boxedTrackIdSet(boxes: TrackFlowBox[]): Set<string> {
  const ids = new Set<string>();
  for (const box of boxes) {
    for (const id of box.memberTrackIds) ids.add(id);
  }
  return ids;
}

/** The box that owns `trackId`, or null. */
export function boxForTrack(
  boxes: TrackFlowBox[],
  trackId: string
): TrackFlowBox | null {
  return boxes.find((box) => box.memberTrackIds.includes(trackId)) ?? null;
}

/**
 * Build the backend's index-based `TrackFlowSpec` for a box, **restricted to the
 * audible member ids** (in `sources` order). Returns `null` when the box has no
 * authored chain (⇒ the backend uses its uniform first-order default) or has no
 * audible members. Transitions/entries that reference a removed (muted/absent)
 * member are dropped; the fallback is remapped to a surviving member. When no
 * fallback pool survives (and no fallback member is authored), a uniform pool
 * (weight 1 per member) is emitted so zero-weight rows walk uniformly instead
 * of deterministically routing to state 0.
 * This mirrors how the rhythm/channel-hocket request builders emit indexed
 * transitions and keeps the generated spec valid against the box's source count.
 */
export function trackFlowSpecFromChain(
  chain: TrackFlowChainState,
  audibleMemberIds: string[]
): TrackFlowSpec | null {
  const stateCount = audibleMemberIds.length;
  if (stateCount === 0) return null;
  const hasAuthored =
    Object.keys(chain.weights).length > 0 ||
    Object.keys(chain.entryWeights).length > 0 ||
    Object.keys(chain.fallbackWeights).length > 0;
  if (!hasAuthored) return null; // uniform default

  const index = new Map<string, number>();
  audibleMemberIds.forEach((id, i) => index.set(id, i));
  const ctxLen = contextLength(chain.order);

  const transitions: TrackFlowTransition[] = [];
  for (const [key, weight] of Object.entries(chain.weights)) {
    if (!(weight > 0)) continue;
    const parsed = parseTransitionKey(key);
    if (!parsed || parsed.from.length !== ctxLen) continue;
    const fromIdx = parsed.from.map((id) => index.get(id));
    const toIdx = index.get(parsed.to);
    if (toIdx === undefined || fromIdx.some((i) => i === undefined)) continue;
    transitions.push({ from: fromIdx as number[], to: toIdx, weight });
  }

  const entryWeights: TrackFlowEntryWeight[] = [];
  for (const [key, weight] of Object.entries(chain.entryWeights)) {
    if (!(weight > 0)) continue;
    const states = parseEntryKey(key);
    if (states.length !== ctxLen) continue;
    const idxs = states.map((id) => index.get(id));
    if (idxs.some((i) => i === undefined)) continue;
    entryWeights.push({ states: idxs as number[], weight });
  }

  const fallbackWeights: TrackFlowFallbackWeight[] = [];
  for (const [id, weight] of Object.entries(chain.fallbackWeights)) {
    if (!(weight > 0)) continue;
    const i = index.get(id);
    if (i === undefined) continue;
    fallbackWeights.push({ state: i, weight });
  }

  const fallback =
    chain.fallback && index.has(chain.fallback) ? index.get(chain.fallback)! : 0;

  // An authored chain with no surviving fallback pool and no authored fallback
  // member must not deterministically route zero-weight rows to state 0 (the
  // implied `fallback: 0`). Emit a uniform pool over every audible member so a
  // zero row genuinely walks uniformly — the behavior the reference doc and
  // the in-app hint promise.
  if (
    fallbackWeights.length === 0 &&
    !(chain.fallback && index.has(chain.fallback))
  ) {
    for (let state = 0; state < stateCount; state += 1) {
      fallbackWeights.push({ state, weight: 1 });
    }
  }

  return {
    order: chain.order,
    stateCount,
    transitions,
    fallback,
    fallbackWeights,
    entryWeights,
  };
}
