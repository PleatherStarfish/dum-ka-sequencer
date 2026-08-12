export type CaesuraE2eState = {
  transportIsPlaying: boolean;
  playbackStructureLocked: boolean;
  canStartPlayback: boolean;
  activeSeedPathId: string | null;
  activeSeedTraceCount: number;
  queuedSeedPathId: string | null;
  latestSeedTraceCycle: number | null;
  timelineLayoutCycle: number;
  timelinePreviewReady: boolean;
  timelineRhythmReady: boolean;
  timelineLayerSourcesCoherent: boolean;
  timelineRenderSyncing: boolean;
  timelinePreviewCycle: number | null;
  renderedTimelineLayoutCycle: number;
  renderedSectionCount: number;
  rhythmSpanCount: number;
  transportEventCounts: {
    channelHocket: number;
  };
  visibleTransportEventCounts: {
    channelHocket: number;
  };
  transportLayerVisibility: {
    channelHocket: boolean;
  };
  switchRequest:
    | {
        ok: true;
        cycleBeats: number;
        inflectionCount: number;
        seedMode: string;
      }
    | { ok: false; error: string };
  sections: Array<{
    sectionIndex: number;
    startBeat: number;
    endBeat: number;
    gati: number;
    effectiveGati: number;
    jathi: number | null;
    timingMatras: number;
    beats: Array<{
      beat: number;
      gati: number;
      effectiveGati: number;
      sectionStart: boolean;
      accentVelocity: number;
      pitch: number;
      automationTargets: string[];
    }>;
  }>;
  preview: {
    cycle: number;
    beatCount: number;
    pulseSpanCount: number;
    sectionStartBeats: number[];
    beatGatis: number[];
  } | null;
};

declare global {
  interface Window {
    __CAESURA_E2E__?: boolean;
    __CAESURA_E2E_STATE__?: CaesuraE2eState;
  }
}

export function publishCaesuraE2eState(state: CaesuraE2eState): void {
  if (typeof window !== "undefined" && window.__CAESURA_E2E__) {
    window.__CAESURA_E2E_STATE__ = state;
  }
}
