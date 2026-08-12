import { useMemo, useState } from "react";

import {
  RHYTHM_PLAYBACK_AUTOMATION_TARGET,
  TEMPO_AUTOMATION_TARGET,
  automationSetWithoutTargets,
} from "../automationTargets";
import type {
  AccentSettings,
  AutomationSet,
  GeneratorConfig,
  GeneratorPreview,
  CustomSubdivision,
  JathiWeight,
  ResolvedRhythmSpan,
  SubdivisionInflection,
  SubdivisionSwitchPreview,
  SubdivisionWeight,
  SwitchCountWeight,
  TransportSnapshot,
} from "../bridge";
import {
  type BoundaryPoint,
  type ParallelProjectPatch,
  type SeedModeName,
  cleanAccentRange,
  customSubdivisionForRequest,
  normalizeBoundaries,
} from "../patchIo";
import {
  type BuildResult,
  cleanJathiWeights,
  parallelProjectRuntimeWouldEngage,
} from "../playbackRequests";
import {
  canonicalizeGatiWeights,
  canonicalizeSwitchCountWeights,
} from "../sectionsSubdivisionsLogic";
import {
  selectActiveParallelTrackPosition,
  selectEffectivePreviewCycle,
  selectRealizedRhythmBySpanId,
  selectTimelineRenderLayers,
} from "../timelineModel";
import { EMPTY_CHANNEL_HOCKET_EVENTS } from "../playbackLayers";
import {
  type CachedCycleValue,
  cachedCycleValueForPlayback,
  exactCycleValue,
} from "./timelineRenderModel";
import { parseSeeds } from "./SeedControls";

export interface SequencerPreviewStateParams {
  automationSet: AutomationSet;
  beatAccentMax: number;
  beatAccentMin: number;
  boundaries: BoundaryPoint[];
  cycleBeats: number;
  generatorConfig: GeneratorConfig;
  generatorEnabled: boolean;
  historySeedsInput: string;
  historyWeight: number;
  initialCustomSubdivision: CustomSubdivision | null;
  initialJathiWeights: JathiWeight[];
  initialWeights: SubdivisionWeight[];
  jathiAccentMax: number;
  jathiAccentMin: number;
  jathiAccentMode: "overrideGati" | "layered";
  maxHistory: number;
  name: string;
  newSeedWeight: number;
  parallelProject: ParallelProjectPatch | null;
  parallelRuntimeActive: boolean;
  pitch: number;
  preview: SubdivisionSwitchPreview | null;
  previewCache: Map<number, CachedCycleValue<SubdivisionSwitchPreview>>;
  previewRequestKey: string;
  sectionAccentMax: number;
  sectionAccentMin: number;
  sectionCountWeights: SwitchCountWeight[];
  seed: number;
  seedMode: SeedModeName;
  snapshot: TransportSnapshot | null;
  tempoBpmForAutomation: number;
  transportIsPlaying: boolean;
  userPreviewCycle: number;
  velocity: number;
  visualTransport: { currentCycle: number };
}

export function buildGeneratorPreviewRequestKey(
  switchRequestKey: string,
  generatorConfig: GeneratorConfig,
  enabled: boolean,
  trackId: string | null
): string {
  const semanticGeneratorConfig: Record<string, unknown> = {
    ...generatorConfig,
  };
  if (generatorConfig.kind === "dumka") {
    // The plan canvas extent is persisted with Dum-Ka, but it cannot change a
    // generated cycle. Keep view-only edits from invalidating musical previews.
    delete semanticGeneratorConfig.planLengthCycles;
  }
  return JSON.stringify({
    switchRequestKey,
    generatorConfig: semanticGeneratorConfig,
    enabled,
    trackId,
  });
}

export function selectGeneratorPreviewTrackId(
  project: ParallelProjectPatch | null,
  parallelRuntimeActive: boolean,
  transportIsPlaying: boolean
): string | null {
  if (
    project === null ||
    (transportIsPlaying
      ? !parallelRuntimeActive
      : !parallelProjectRuntimeWouldEngage(project))
  ) {
    return null;
  }
  return (
    project.tracks.find((track) => track.id === project.activeTrackId)?.id ??
    project.tracks[0]?.id ??
    null
  );
}

export function useSequencerPreviewState({
  automationSet,
  beatAccentMax,
  beatAccentMin,
  boundaries,
  cycleBeats,
  generatorConfig,
  generatorEnabled,
  historySeedsInput,
  historyWeight,
  initialCustomSubdivision,
  initialJathiWeights,
  initialWeights,
  jathiAccentMax,
  jathiAccentMin,
  jathiAccentMode,
  maxHistory,
  name,
  newSeedWeight,
  parallelProject,
  parallelRuntimeActive,
  pitch,
  preview,
  previewCache,
  previewRequestKey,
  sectionAccentMax,
  sectionAccentMin,
  sectionCountWeights,
  seed,
  seedMode,
  snapshot,
  tempoBpmForAutomation,
  transportIsPlaying,
  userPreviewCycle,
  velocity,
  visualTransport,
}: SequencerPreviewStateParams) {
  const [generatorResult, setGeneratorResult] = useState<GeneratorPreview | null>(null);
  const [generatorResultCycle, setGeneratorResultCycle] = useState<number | null>(null);
  const [generatorResultRequestKey, setGeneratorResultRequestKey] = useState("");
  const [generatorResultCache, setGeneratorResultCache] = useState<
    Map<number, CachedCycleValue<GeneratorPreview>>
  >(() => new Map());

  const activeProjectTrackForAutomation =
    parallelProject?.tracks.find(
      (track) => track.id === parallelProject.activeTrackId
    ) ?? parallelProject?.tracks[0];
  const generatorTrackId = selectGeneratorPreviewTrackId(
    parallelProject,
    parallelRuntimeActive,
    transportIsPlaying
  );
  const activeTempoAutomationApplies =
    !parallelProject ||
    parallelProject.tracks.length <= 1 ||
    activeProjectTrackForAutomation?.tempoMode === "custom";
  const activeAutomationSet = useMemo<AutomationSet | null>(() => {
    const removedTargets = [RHYTHM_PLAYBACK_AUTOMATION_TARGET];
    if (!activeTempoAutomationApplies) removedTargets.push(TEMPO_AUTOMATION_TARGET);
    const normalized = automationSetWithoutTargets(automationSet, removedTargets);
    return normalized.tracks.length > 0 ? normalized : null;
  }, [activeTempoAutomationApplies, automationSet]);

  const switchRequest = useMemo<BuildResult>(() => {
    if (cycleBeats < 1 || cycleBeats > 64) {
      return { ok: false, error: "Cycle beats must be 1-64." };
    }
    if (pitch < 0 || pitch > 127) {
      return { ok: false, error: "Pitch must be 0-127." };
    }
    if (velocity < 1 || velocity > 127) {
      return { ok: false, error: "Velocity must be 1-127." };
    }

    const cleanedInitial = canonicalizeGatiWeights(initialWeights);
    const cleanedInitialJathi = cleanJathiWeights(initialJathiWeights);
    const cleanedInitialCustom = customSubdivisionForRequest(initialCustomSubdivision);
    if (
      (!cleanedInitialCustom || cleanedInitialCustom.perBeatWeight > 0) &&
      !cleanedInitial.some((weight) => weight.weight > 0)
    ) {
      return { ok: false, error: "The start section needs a positive subdivision." };
    }

    const normalized = normalizeBoundaries(boundaries, cycleBeats);
    const inflections: SubdivisionInflection[] = [];
    for (const boundary of normalized) {
      const subdivisionWeights = canonicalizeGatiWeights(boundary.weights);
      const customSubdivision = customSubdivisionForRequest(boundary.customSubdivision);
      if (
        (!customSubdivision || customSubdivision.perBeatWeight > 0) &&
        !subdivisionWeights.some((weight) => weight.weight > 0)
      ) {
        return {
          ok: false,
          error: `Boundary after beat ${boundary.afterBeat} needs a positive subdivision.`,
        };
      }
      inflections.push({
        id: boundary.id,
        position: boundary.afterBeat / cycleBeats,
        changeProbability: 1,
        subdivisionWeights,
        customSubdivision,
        jathiWeights: cleanJathiWeights(boundary.jathiWeights),
        jathiBhedam: null,
      });
    }

    const accent: AccentSettings = {
      beatStart: cleanAccentRange(beatAccentMin, beatAccentMax),
      sectionStartExtra: cleanAccentRange(sectionAccentMin, sectionAccentMax),
      jathiStart: cleanAccentRange(jathiAccentMin, jathiAccentMax),
      jathiMode: jathiAccentMode,
    };
    return {
      ok: true,
      data: {
        name: name.trim() || "untitled",
        cycleBeats,
        initialWeights: cleanedInitial,
        initialJathiWeights: cleanedInitialJathi,
        initialJathiBhedam: null,
        initialCustomSubdivision: cleanedInitialCustom,
        speedSubdivision: null,
        automation: activeAutomationSet,
        inflections,
        switchCountWeights: canonicalizeSwitchCountWeights(
          sectionCountWeights,
          normalized.length
        ),
        seedMode:
          seedMode === "drift" || seedMode === "morph" ? "perCycle" : seedMode,
        seed,
        historySeeds: parseSeeds(historySeedsInput),
        historyWeight,
        newSeedWeight,
        maxHistory,
        newSeedChance: 0,
        holdChance: 0,
        blendCycles: 0,
        singleParameterRhythmicModulation: false,
        accent,
        pitch,
        velocity,
      },
    };
  }, [
    activeAutomationSet,
    beatAccentMax,
    beatAccentMin,
    boundaries,
    cycleBeats,
    historySeedsInput,
    historyWeight,
    initialCustomSubdivision,
    initialJathiWeights,
    initialWeights,
    jathiAccentMax,
    jathiAccentMin,
    jathiAccentMode,
    maxHistory,
    name,
    newSeedWeight,
    pitch,
    sectionAccentMax,
    sectionAccentMin,
    sectionCountWeights,
    seed,
    seedMode,
    velocity,
  ]);

  const switchRequestKey = useMemo(
    () =>
      switchRequest.ok
        ? JSON.stringify(switchRequest.data)
        : `invalid:${switchRequest.error}`,
    [switchRequest]
  );
  const previewUsesTempoForAutomation = Boolean(
    activeAutomationSet?.tracks.some(
      (track) => track.enabled !== false && track.target === TEMPO_AUTOMATION_TARGET
    )
  );
  const previewRequestCacheKey = previewUsesTempoForAutomation
    ? `${switchRequestKey}:tempo:${tempoBpmForAutomation.toFixed(3)}`
    : switchRequestKey;

  const effectivePreviewCycle = selectEffectivePreviewCycle(
    snapshot,
    visualTransport.currentCycle,
    userPreviewCycle
  );
  const liveParallelTrackPosition =
    snapshot?.isPlaying && parallelProject?.activeTrackId
      ? selectActiveParallelTrackPosition(
          snapshot.parallelTrackPositions,
          parallelProject.activeTrackId
        )
      : null;
  const displayedCycle = snapshot?.isPlaying
    ? liveParallelTrackPosition?.cycle ?? visualTransport.currentCycle
    : snapshot?.currentCycle ?? visualTransport.currentCycle;
  const timelineRenderLayers = useMemo(
    () => selectTimelineRenderLayers(snapshot, displayedCycle, EMPTY_CHANNEL_HOCKET_EVENTS),
    [displayedCycle, snapshot]
  );
  const timelineLayoutCycle = transportIsPlaying
    ? timelineRenderLayers.cycleIndex
    : effectivePreviewCycle;
  const exactTimelinePreview = useMemo(() => {
    return exactCycleValue(
      preview,
      preview?.cycle ?? null,
      previewRequestKey,
      previewCache,
      timelineLayoutCycle,
      previewRequestCacheKey
    );
  }, [
    preview,
    previewCache,
    previewRequestCacheKey,
    previewRequestKey,
    timelineLayoutCycle,
  ]);
  // A playing timeline may retain the last truthful scheduler-aligned rows
  // while an exact authored preview is pending. Generator requests, failure
  // provenance, and authoring tools must never consume that fallback: it can
  // describe a different structure/request identity.
  const timelinePreview =
    exactTimelinePreview ??
    (transportIsPlaying
      ? cachedCycleValueForPlayback(previewCache, timelineLayoutCycle)
      : null);

  const generatorPreviewRequestKey = useMemo(
    () =>
      buildGeneratorPreviewRequestKey(
        previewRequestCacheKey,
        generatorConfig,
        generatorEnabled,
        generatorTrackId
      ),
    [generatorConfig, generatorEnabled, generatorTrackId, previewRequestCacheKey]
  );
  const exactTimelineGeneratorResult = useMemo(() => {
    return exactCycleValue(
      generatorResult,
      generatorResultCycle,
      generatorResultRequestKey,
      generatorResultCache,
      timelineLayoutCycle,
      generatorPreviewRequestKey
    );
  }, [
    generatorPreviewRequestKey,
    generatorResult,
    generatorResultCache,
    generatorResultCycle,
    generatorResultRequestKey,
    timelineLayoutCycle,
  ]);
  const timelineGeneratorResult =
    exactTimelineGeneratorResult ??
    (transportIsPlaying
      ? cachedCycleValueForPlayback(generatorResultCache, timelineLayoutCycle)
      : null);
  const generatorBySpanId = useMemo(() => {
    if (snapshot?.isPlaying) {
      return selectRealizedRhythmBySpanId(
        snapshot,
        displayedCycle,
        parallelProject?.activeTrackId ?? null
      );
    }
    const map = new Map<number, ResolvedRhythmSpan>();
    for (const span of timelineGeneratorResult?.spans ?? []) map.set(span.spanId, span);
    return map;
  }, [displayedCycle, parallelProject?.activeTrackId, snapshot, timelineGeneratorResult]);

  return {
    activeAutomationSet,
    activeProjectTrackForAutomation,
    displayedCycle,
    effectivePreviewCycle,
    generatorBySpanId,
    generatorPreviewRequestKey,
    generatorTrackId,
    generatorResultCache,
    generatorResult: timelineGeneratorResult,
    liveParallelTrackPosition,
    previewRequestCacheKey,
    setGeneratorResult,
    setGeneratorResultCache,
    setGeneratorResultCycle,
    setGeneratorResultRequestKey,
    switchRequest,
    switchRequestKey,
    exactTimelineGeneratorResult,
    exactTimelinePreview,
    timelineLayoutCycle,
    timelinePreview,
    timelineRenderLayers,
  };
}
