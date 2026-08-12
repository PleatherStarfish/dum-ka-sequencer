/**
 * Presentation-only playback readiness.
 *
 * App.tsx owns the actual Play gate. This module deliberately consumes that
 * boolean instead of recomputing it, so explaining a blocked start cannot
 * change when playback is allowed.
 */

export const PLAYBACK_READY_TITLE = "Play";
export const PLAYBACK_PENDING_TITLE =
  "Waiting for the timeline render to match the current patch";

/** A settled generator-preview failure, tagged with the intent that produced it. */
export interface GeneratorPreviewFailure {
  requestKey: string;
  cycle: number;
  message: string;
}

export interface CurrentGeneratorPreviewFailureInput {
  failure: GeneratorPreviewFailure | null;
  currentRequestKey: string;
  currentCycle: number;
  generatorEnabled: boolean;
}

/**
 * Return a failure only while it still describes the enabled generator's
 * current request and cycle. An edit, track switch, enable-state change, or
 * cycle change therefore turns an old rejection back into a pending render
 * instead of presenting stale error copy.
 */
export function selectCurrentGeneratorPreviewFailure({
  failure,
  currentRequestKey,
  currentCycle,
  generatorEnabled,
}: CurrentGeneratorPreviewFailureInput): GeneratorPreviewFailure | null {
  if (!generatorEnabled || failure === null) {
    return null;
  }
  return failure.requestKey === currentRequestKey && failure.cycle === currentCycle
    ? failure
    : null;
}

export type PlaybackAvailabilityPresentation =
  | {
      kind: "ready";
      title: typeof PLAYBACK_READY_TITLE;
      message: null;
    }
  | {
      kind: "pending";
      title: typeof PLAYBACK_PENDING_TITLE;
      message: null;
    }
  | {
      kind: "rejected";
      title: string;
      message: string;
    };

export interface PlaybackAvailabilityInput
  extends CurrentGeneratorPreviewFailureInput {
  /** Existing App-owned gate; this selector must never broaden or narrow it. */
  canStartPlayback: boolean;
}

/** Select honest Play copy without changing the App-owned playback gate. */
export function selectPlaybackAvailability({
  canStartPlayback,
  ...failureInput
}: PlaybackAvailabilityInput): PlaybackAvailabilityPresentation {
  if (canStartPlayback) {
    return {
      kind: "ready",
      title: PLAYBACK_READY_TITLE,
      message: null,
    };
  }

  const failure = selectCurrentGeneratorPreviewFailure(failureInput);
  if (failure !== null) {
    return {
      kind: "rejected",
      title: `Playback blocked: ${failure.message}`,
      message: failure.message,
    };
  }

  return {
    kind: "pending",
    title: PLAYBACK_PENDING_TITLE,
    message: null,
  };
}
