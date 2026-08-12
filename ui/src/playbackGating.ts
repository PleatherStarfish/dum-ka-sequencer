/**
 * Gating for which playback config a transport edit is allowed to push.
 *
 * The transport has two mutually exclusive runtime shapes: the single-track
 * path (`SetScore` + `SetRhythmPlayback`) and the parallel path
 * (`SetParallelPlayback`). Sending a single-track config while a parallel
 * runtime is live nulls its `parallel_config` and tears it down. Two facts make
 * this subtle, and both are captured here as pure functions so they can be
 * tested in isolation (App.tsx wires them into its reactive push effects):
 *
 * 1. Whether the parallel runtime *would* engage is derived from live mute/solo
 *    state, so it flip-flops: muting a two-track project down to one audible
 *    track flips it false even though a parallel runtime is still playing.
 * 2. The authoritative "is a parallel runtime actually playing" signal is pinned
 *    at Play (a ref in App.tsx), not derived from mute/solo — so the gate stays
 *    stable across a mid-playback mute/solo change (S5 runtime-mode pinning).
 */

export interface AudibilityFlags {
  muted: boolean;
  soloed: boolean;
  tempoMode?: "global" | "custom";
}

/**
 * Whether the parallel runtime would engage for this track set: more than one
 * track survives mute/solo filtering. A single-track project (≤1 track) or a
 * project with ≤1 audible track uses the single-track path. This is the
 * flip-flop-prone, mute/solo-derived value — do not use it alone as the live
 * teardown guard; combine it with the pinned "actually playing" signal.
 */
export function parallelRuntimeWouldEngage(tracks: AudibilityFlags[]): boolean {
  if (tracks.length <= 1) {
    return false;
  }
  const soloActive = tracks.some((track) => track.soloed);
  const audible = tracks.filter(
    (track) => !track.muted && (!soloActive || track.soloed)
  );
  return (
    audible.length > 1 ||
    // A multi-track document must retain its global reference clock even when
    // mute/solo leaves one custom-tempo track audible. The parallel request
    // carries that track's local BPM without ever writing it to the reference
    // transport tempo.
    (audible.length === 1 && audible[0]?.tempoMode === "custom")
  );
}

export interface SingleTrackPushGate {
  /** `parallelRuntimeWouldEngage(...)` for the current (possibly stopped) config. */
  runtimeWouldEngageParallel: boolean;
  /** A parallel runtime is actually playing right now (pinned at Play). */
  parallelRuntimePlaying: boolean;
}

/**
 * Whether a single-track config push (`SetScore` / `SetRhythmPlayback`) may
 * reach the transport. Blocked when a parallel runtime is actually playing
 * (would tear it down) and when the current config would engage the parallel
 * runtime (stopped staging — the single-track config is not the one that will
 * play). Allowed only when neither holds: a genuine single-track project,
 * stopped or playing.
 */
export function shouldPushSingleTrackConfig(gate: SingleTrackPushGate): boolean {
  return !gate.parallelRuntimePlaying && !gate.runtimeWouldEngageParallel;
}
