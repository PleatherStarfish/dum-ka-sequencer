/**
 * Per-track "what is playing right now" model for the track strip.
 *
 * Pure: derives each track's live playback state from the transport snapshot
 * (position rows, per-cycle Track Flow lane selections) plus the authored
 * track/box structure. The subtlety this module owns is that a position row
 * does NOT mean "audible": silent trigger sources are excluded by the backend,
 * box members never have their own rows (their synthetic lane does), a
 * triggered follower only has a row while a launched run's window covers the
 * playhead, and single-track playback has no parallel rows at all.
 */
import type { ParallelTrackPosition, TrackFlowPlaybackEvent } from "./bridge";
import {
  parallelSilentSourceIds,
  type ParallelTrackPatch,
} from "./patchIo";
import { trackFlowLaneId, type TrackFlowBox } from "./trackFlowBoxes";

export type TrackPlaybackState =
  /** Transport stopped — show nothing. */
  | "idle"
  /** Audibly playing right now. */
  | "sounding"
  /** Triggered and waiting (no launched run covers the playhead). */
  | "armed"
  /** Muted/solo-hidden but realized silently to drive a triggered follower. */
  | "driving"
  /** Box member not currently selected by its lane's chain. */
  | "waiting"
  /** Muted or solo-hidden; not part of playback. */
  | "silenced";

export type TrackPlaybackStateTrack = Pick<
  ParallelTrackPatch,
  "id" | "muted" | "soloed" | "trigger"
>;

export interface TrackPlaybackStatesInput {
  isPlaying: boolean;
  /** Snapshot position rows (backend already excludes silent sources). */
  positions: ParallelTrackPosition[];
  /** Per-cycle Track Flow lane selections from the snapshot. */
  trackFlowEvents: TrackFlowPlaybackEvent[];
  tracks: TrackPlaybackStateTrack[];
  boxes: Pick<TrackFlowBox, "id" | "memberTrackIds">[];
}

export const TRACK_PLAYBACK_STATE_LABELS: Record<TrackPlaybackState, string> = {
  idle: "",
  sounding: "playing",
  armed: "armed — waiting for its trigger",
  driving: "muted, silently driving its followers",
  waiting: "in the box rotation — not this cycle",
  silenced: "not in playback (muted or solo-hidden)",
};

export function trackPlaybackStates(
  input: TrackPlaybackStatesInput
): Map<string, TrackPlaybackState> {
  const states = new Map<string, TrackPlaybackState>();
  if (!input.isPlaying) {
    for (const track of input.tracks) states.set(track.id, "idle");
    return states;
  }

  const boxIdByTrack = new Map<string, string>();
  for (const box of input.boxes) {
    for (const memberId of box.memberTrackIds) boxIdByTrack.set(memberId, box.id);
  }
  const soloActive = input.tracks.some((track) => track.soloed);
  const audible = (track: TrackPlaybackStateTrack) =>
    !track.muted && (!soloActive || track.soloed);
  const unboxed = input.tracks.filter((track) => !boxIdByTrack.has(track.id));
  const silentSourceIds = parallelSilentSourceIds(unboxed);
  const positionByTrackId = new Map(
    input.positions.map((position) => [position.trackId, position])
  );
  // The parallel runtime is engaged when any position row exists; the
  // single-track path reports none, so the lone audible track is sounding.
  const runtimeEngaged = input.positions.length > 0;

  for (const track of input.tracks) {
    const boxId = boxIdByTrack.get(track.id);
    if (boxId !== undefined) {
      if (!audible(track)) {
        states.set(track.id, "silenced");
        continue;
      }
      const laneRow = positionByTrackId.get(trackFlowLaneId(boxId));
      if (!laneRow) {
        // The lane is not a live participant (e.g. request not engaged yet).
        states.set(track.id, runtimeEngaged ? "waiting" : "silenced");
        continue;
      }
      const selection = input.trackFlowEvents.find(
        (event) => event.laneId === laneRow.trackId && event.cycle === laneRow.cycle
      );
      states.set(
        track.id,
        selection?.sourceTrackId === track.id ? "sounding" : "waiting"
      );
      continue;
    }

    if (!audible(track)) {
      states.set(track.id, silentSourceIds.has(track.id) ? "driving" : "silenced");
      continue;
    }
    const hasRow = positionByTrackId.has(track.id);
    if (track.trigger) {
      // A follower's row exists only while a launched run covers the playhead
      // (the backend suppresses the stale-window fallback for triggered tracks).
      states.set(track.id, hasRow ? "sounding" : "armed");
      continue;
    }
    // Continuous: rowed when the parallel runtime is engaged; on the
    // single-track path there are no rows and the lone audible track sounds.
    states.set(track.id, hasRow || !runtimeEngaged ? "sounding" : "silenced");
  }
  return states;
}
