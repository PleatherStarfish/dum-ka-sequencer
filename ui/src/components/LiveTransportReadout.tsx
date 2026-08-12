import {
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";

import type { LivePositionSample } from "../bridge";
import { PLAYHEAD_LATENCY_COMPENSATION_MS } from "./transportConstants";
import { liveTimelinePosition } from "./TimelineLanes";

export function liveTransportReadoutText(
  live: LivePositionSample,
  activeTrackId: string | null,
  now: number
): string | null {
  if (!live.position.isPlaying) return null;
  const position = liveTimelinePosition(live.position, activeTrackId);
  if (position.ticksPerCycle <= 0) return null;
  const elapsedMs =
    now - live.receivedAt + PLAYHEAD_LATENCY_COMPENSATION_MS;
  const rawTick = position.tick + Math.max(0, elapsedMs) * position.ticksPerMs;
  const cycleAdvance = Math.floor(rawTick / position.ticksPerCycle);
  const tickInCycle =
    ((rawTick % position.ticksPerCycle) + position.ticksPerCycle) %
    position.ticksPerCycle;
  return `Cycle ${position.cycle + cycleAdvance} · tick ${Math.floor(
    tickInCycle
  )}/${position.ticksPerCycle}`;
}

/**
 * The timeline playhead is intentionally imperative so it does not render the
 * App tree every frame. Keep the footer clock on the same independent path:
 * update only this text node, and only when its integer readout changes.
 */
export function LiveTransportReadout({
  playing,
  livePositionRef,
  activeTrackId,
  fallbackCycle,
  fallbackTick,
  fallbackTicksPerCycle,
}: {
  playing: boolean;
  livePositionRef: MutableRefObject<LivePositionSample | null>;
  activeTrackId: string | null;
  fallbackCycle: number;
  fallbackTick: number;
  fallbackTicksPerCycle: number;
}) {
  const nodeRef = useRef<HTMLSpanElement | null>(null);
  const fallback = `Cycle ${fallbackCycle} · tick ${Math.floor(
    fallbackTick
  )}/${fallbackTicksPerCycle}`;

  useEffect(() => {
    if (!playing) return;
    let animationFrame = 0;
    let previous = "";
    const update = () => {
      const live = livePositionRef.current;
      const next = live
        ? liveTransportReadoutText(live, activeTrackId, performance.now())
        : null;
      if (next && next !== previous && nodeRef.current) {
        previous = next;
        nodeRef.current.textContent = next;
      }
      animationFrame = window.requestAnimationFrame(update);
    };
    animationFrame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeTrackId, livePositionRef, playing]);

  return <span ref={nodeRef}>{fallback}</span>;
}
