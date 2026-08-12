// Pure timeline-epoch gating for the telemetry position stream.
//
// Positions (~60Hz) and timeline snapshots arrive on separate Tauri event
// channels whose cross-channel delivery order is not guaranteed. The gate keeps
// the playhead anchored to the grid currently in React state:
//
//   - a position from an OLDER grid (timelineEpoch < promoted) is dropped, so a
//     stale position can never move the playhead over a newly promoted grid;
//   - a position from the SAME grid is applied;
//   - a position from a NEWER grid (its timeline snapshot hasn't promoted yet)
//     is buffered (latest-wins) and applied the instant the matching timeline
//     snapshot promotes — so the playhead doesn't move before its grid exists.
//
// Kept pure and separate from App.tsx so the ordering rules are unit-tested.

import type { LivePositionSample, TransportPosition } from "./bridge";

export type PositionGateState = {
  /** Timeline epoch of the grid currently promoted into React state. */
  promotedTimelineEpoch: number;
  /** The anchor the playhead reads. */
  live: LivePositionSample | null;
  /** A too-new position waiting for its timeline snapshot to promote. */
  pending: LivePositionSample | null;
  /** `performance.now()` when `pending` was first set, for the stall watchdog. */
  pendingSince: number;
};

export function initialGateState(): PositionGateState {
  return { promotedTimelineEpoch: 0, live: null, pending: null, pendingSince: 0 };
}

/** Apply an incoming position under the timeline-epoch gate. */
export function gatePosition(
  state: PositionGateState,
  position: TransportPosition,
  receivedAt: number
): PositionGateState {
  if (position.timelineEpoch < state.promotedTimelineEpoch) {
    // Stale: belongs to a grid we've already moved past.
    return state;
  }
  if (position.timelineEpoch === state.promotedTimelineEpoch) {
    return {
      ...state,
      live: { position, receivedAt },
      pending: null,
      pendingSince: 0,
    };
  }
  // Newer than the promoted grid: buffer the latest, keep the existing anchor.
  return {
    ...state,
    pending: { position, receivedAt },
    pendingSince: state.pendingSince === 0 ? receivedAt : state.pendingSince,
  };
}

/**
 * Promote a timeline grid. Re-anchors the playhead to a buffered position if it
 * matches the new epoch (it's fresher than the snapshot's own clock), otherwise
 * to the snapshot-derived anchor. Clears any pending buffer.
 */
export function promoteTimeline(
  state: PositionGateState,
  timelineEpoch: number,
  derived: LivePositionSample
): PositionGateState {
  const live =
    state.pending && state.pending.position.timelineEpoch === timelineEpoch
      ? state.pending
      : derived;
  return {
    promotedTimelineEpoch: timelineEpoch,
    live,
    pending: null,
    pendingSince: 0,
  };
}
