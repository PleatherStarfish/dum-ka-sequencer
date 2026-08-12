/**
 * Track-role helpers (prototype for the unified role UI — see
 * `docs/TRACK_ROLE_UI_PROPOSAL.md`).
 *
 * A track is in exactly one of three mutually exclusive roles. The role is
 * *derived* from the two underlying sources of truth — Track Flow box membership
 * and `track.trigger` — never stored separately, so it can't drift from them:
 *
 * - `continuous`  — free parallel track, plays every cycle on its own.
 * - `triggered`   — free parallel follower; fires on a condition against a
 *                   continuous *source* track. Cannot itself be a source.
 * - `trackFlow`   — member of a Track Flow box; the box's chain picks one member
 *                   to sound per cycle. Cannot trigger or be triggered.
 *
 * These functions are pure: they compute the current role, who may be a trigger
 * source, which roles are selectable (with a reason when not), the *intent* of a
 * role change, and the atomic membership+trigger that intent implies
 * (`applyRoleIntent`). The caller applies that as **one** patch via a single new
 * `applyTrackRole` handler — not the existing per-axis handlers (see §3.1/§6 of
 * the proposal). These helpers make no side effects and touch no engine path, so
 * the trigger/Track-Flow invariants are untouched.
 */
import type { TriggerConfig } from "./bridge";
import {
  TRACK_FLOW_DEFAULT_BOX_ID,
  TRACK_FLOW_DEFAULT_BOX_NAME,
  TRACK_FLOW_DEFAULT_SEED,
  type TrackFlowBox,
  boxForTrack,
  boxedTrackIdSet,
  defaultTrackFlowChain,
} from "./trackFlowBoxes";
import { defaultTriggerConfig } from "./triggerUi";

export type TrackRole = "continuous" | "triggered" | "trackFlow";

export const TRACK_ROLES: readonly TrackRole[] = [
  "continuous",
  "triggered",
  "trackFlow",
] as const;

/** Plain-language label + one-line blurb per role (kept here so the copy is
 *  consistent and unit-testable, not buried in JSX). */
export const ROLE_META: Record<TrackRole, { label: string; blurb: string }> = {
  continuous: {
    label: "Continuous",
    blurb: "Plays every cycle on its own.",
  },
  triggered: {
    label: "Triggered",
    blurb: "Plays when another track does something (e.g. rests on beat 3).",
  },
  trackFlow: {
    label: "Track Flow",
    blurb: "Takes turns with a group — one member sounds per cycle.",
  },
};

/** Minimal track shape these helpers need. `ParallelTrackPatch` is assignable. */
export interface RoleTrack {
  id: string;
  name: string;
  trigger: TriggerConfig | null;
}

/** The track's current role, derived from box membership then trigger. */
export function trackRole(
  track: Pick<RoleTrack, "id" | "trigger">,
  boxes: TrackFlowBox[]
): TrackRole {
  if (boxForTrack(boxes, track.id)) return "trackFlow";
  if (track.trigger) return "triggered";
  return "continuous";
}

/**
 * Tracks that may serve as a trigger *source* for `activeTrackId`: a different,
 * continuous (untriggered), unboxed track. Mirrors the inline filter in
 * `App.tsx` and the backend one-level rule (a follower's source must be
 * continuous; a boxed track can be neither source nor follower).
 */
export function eligibleTriggerSources(
  activeTrackId: string,
  tracks: RoleTrack[],
  boxes: TrackFlowBox[]
): RoleTrack[] {
  const boxed = boxedTrackIdSet(boxes);
  return tracks.filter(
    (track) =>
      track.id !== activeTrackId && !track.trigger && !boxed.has(track.id)
  );
}

export interface RoleOption {
  role: TrackRole;
  /** The track's current role is always `true`; the others depend on context. */
  current: boolean;
  /** Whether the user can select this role right now. */
  enabled: boolean;
  /** Why it is disabled (shown as visible inline text + `aria-describedby`),
   *  when `enabled` is false. */
  reason?: string;
}

const NO_SOURCE_REASON =
  "Add another continuous, unboxed track to use as a trigger source.";
const NO_GROUP_REASON = "Add another track to take turns with in a group.";

/**
 * Selectability of each role for `activeTrack`. The current role is always
 * selectable. `triggered` needs at least one eligible source; `trackFlow` needs
 * at least one other track to form a group (so a single-track project offers only
 * `continuous`). A disabled role carries a `reason` for its tooltip.
 */
export function roleOptions(
  activeTrack: RoleTrack,
  tracks: RoleTrack[],
  boxes: TrackFlowBox[]
): RoleOption[] {
  const current = trackRole(activeTrack, boxes);
  const hasSource =
    eligibleTriggerSources(activeTrack.id, tracks, boxes).length > 0;
  const hasOtherTrack = tracks.some((track) => track.id !== activeTrack.id);

  return TRACK_ROLES.map((role) => {
    const isCurrent = role === current;
    if (role === "continuous" || isCurrent) {
      return { role, current: isCurrent, enabled: true };
    }
    if (role === "triggered") {
      return hasSource
        ? { role, current: false, enabled: true }
        : { role, current: false, enabled: false, reason: NO_SOURCE_REASON };
    }
    // trackFlow
    return hasOtherTrack
      ? { role, current: false, enabled: true }
      : { role, current: false, enabled: false, reason: NO_GROUP_REASON };
  });
}

/**
 * The change a role switch implies, as data — turned into one atomic patch by
 * `applyRoleIntent` (no side effects here):
 *
 * - `continuous`  → un-box the track and clear the trigger.
 * - `triggered`   → un-box, then set a default trigger against `sourceId`.
 * - `trackFlow`   → assign to `boxTarget` (a box id, or `"__new__"` to create
 *                   one) and clear the trigger.
 *
 * Returns `null` for a no-op (already in `targetRole`) or when the target is not
 * available (e.g. `triggered` with no eligible source).
 */
export type RoleIntent =
  | { kind: "continuous" }
  | { kind: "triggered"; sourceId: string }
  | { kind: "trackFlow"; boxTarget: string };

export function roleTransition(
  targetRole: TrackRole,
  activeTrack: RoleTrack,
  tracks: RoleTrack[],
  boxes: TrackFlowBox[]
): RoleIntent | null {
  if (trackRole(activeTrack, boxes) === targetRole) return null;

  switch (targetRole) {
    case "continuous":
      return { kind: "continuous" };
    case "triggered": {
      const source = eligibleTriggerSources(activeTrack.id, tracks, boxes)[0];
      return source ? { kind: "triggered", sourceId: source.id } : null;
    }
    case "trackFlow": {
      if (!tracks.some((track) => track.id !== activeTrack.id)) return null;
      // Join the first existing box, else create a new one; the role detail's box
      // selector can re-assign afterwards.
      const boxTarget = boxes[0]?.id ?? "__new__";
      return { kind: "trackFlow", boxTarget };
    }
  }
}

function newBox(id: string, name: string, trackId: string): TrackFlowBox {
  return {
    id,
    name,
    memberTrackIds: [trackId],
    chain: defaultTrackFlowChain(),
    seed: TRACK_FLOW_DEFAULT_SEED,
    collapsed: false,
  };
}

/**
 * Pure box-membership reassignment, mirroring `App.tsx`'s `handleAssignTrackToBox`
 * so drag, the move-menu, and the Role picker share one tested mutation: remove
 * the track from every box, then add it to `target` — a box id, `"__new__"` (mint
 * `box-N`), or `""` (just un-box). The *source* box is dropped only if this move
 * emptied it; other empty drafts survive. A no-op (already in `target`) returns the
 * input unchanged. This does not touch triggers — see `applyRoleIntent`.
 */
export function assignTrackToBoxes(
  boxes: TrackFlowBox[],
  trackId: string,
  target: string
): TrackFlowBox[] {
  const fromBox = boxForTrack(boxes, trackId);
  if ((fromBox?.id ?? "") === target) return boxes;

  let next = boxes.map((box) => ({
    ...box,
    memberTrackIds: box.memberTrackIds.filter((id) => id !== trackId),
  }));

  if (target === "__new__") {
    const used = new Set(next.map((box) => box.id));
    let n = next.length + 1;
    let id = `box-${n}`;
    while (used.has(id)) {
      n += 1;
      id = `box-${n}`;
    }
    next = [...next, newBox(id, `Box ${n}`, trackId)];
  } else if (target) {
    let matched = false;
    next = next.map((box) => {
      if (box.id !== target) return box;
      matched = true;
      return { ...box, memberTrackIds: [...box.memberTrackIds, trackId] };
    });
    if (!matched) {
      next = [
        ...next,
        newBox(TRACK_FLOW_DEFAULT_BOX_ID, TRACK_FLOW_DEFAULT_BOX_NAME, trackId),
      ];
    }
  }

  return next.filter(
    (box) => box.memberTrackIds.length > 0 || box.id !== fromBox?.id
  );
}

/** The membership + trigger a `RoleIntent` implies, computed *together* so one
 *  patch write applies both atomically (no chained async handlers, no race). The
 *  trigger is set explicitly here — `trackFlow` and `continuous` null it,
 *  `triggered` sets a default against the (already boxed-source-filtered) source —
 *  so the result is self-consistent without depending on downstream normalization
 *  order. This is the pure core of the new `applyTrackRole` handler (§6). */
export interface RoleChange {
  boxes: TrackFlowBox[];
  trigger: TriggerConfig | null;
}

export function applyRoleIntent(
  intent: RoleIntent,
  trackId: string,
  boxes: TrackFlowBox[]
): RoleChange {
  switch (intent.kind) {
    case "continuous":
      return { boxes: assignTrackToBoxes(boxes, trackId, ""), trigger: null };
    case "triggered":
      return {
        boxes: assignTrackToBoxes(boxes, trackId, ""),
        trigger: defaultTriggerConfig(intent.sourceId),
      };
    case "trackFlow":
      return {
        boxes: assignTrackToBoxes(boxes, trackId, intent.boxTarget),
        trigger: null,
      };
  }
}
