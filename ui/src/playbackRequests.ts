/**
 * Playback request builders: the pure assembly seam between the patch
 * document (draft state) and the bridge request DTOs — switch requests,
 * rhythm playback requests, the parallel playback request, all per-track
 * spec conversions, and the patch content fingerprint. Extracted verbatim
 * from App.tsx (carve-up round 6).
 */
import {
  ChannelAccentRule,
  ChannelAccentWeight,
  ChannelPositionRule,
} from "./bridge";
import {
  PARALLEL_TRACK_COLORS,
  PatchChannelAccentRule,
  PatchChannelPositionRule,
} from "./patchIo";
import {
  filterSeedPathItemsForTrack,
} from "./timelineModel";
import {
  playbackAutomationForTrack,
} from "./automationTargets";
import {
  canonicalizeGatiWeights,
  canonicalizeJathiWeights,
} from "./sectionsSubdivisionsLogic";
import {
  AccentSettings,
  AutomationSet,
  ChannelEntryWeight,
  ChannelFallbackWeight,
  ChannelHocketSpec,
  ChannelTransition,
  CustomSubdivision,
  EuclidChannelLayer,
  EuclidChannelSpec,
  JathiBhedamSelection,
  JathiWeight,
  ParallelPlaybackRequest,
  PulseSpan,
  RhythmSeedMode,
  GeneratorSeedMode,
  RhythmSpeedSpec,
  SeedPathPlaybackConfig,
  SubdivisionInflection,
  SubdivisionWeight,
  SwitchCountWeight,
  U64SeedDecimal,
} from "./bridge";
import {
  channelContexts,
  channelWeightValue,
} from "./markovWeights";
import { canonicalEuclidLayersForChannels } from "./euclidChannels";
import { parallelRuntimeWouldEngage } from "./playbackGating";
import {
  DEFAULT_PARALLEL_TRACK_ID,
  MAX_PARALLEL_TRACKS,
  MIDI_CHANNELS,
  ParallelProjectPatch,
  ParallelTrackPatch,
  PatchChannelHocketState,
  PatchEuclidChannelState,
  PatchSequencerState,
  RhythmSeedBehaviorName,
  SequencerPatchDocument,
  channelEntryWeightKey,
  clamp,
  cleanAccentRange,
  cloneAutomationSet,
  customSubdivisionForRequest,
  musicalChannelLogicDefaultPolicy,
  normalizeBoundaries,
  normalizeChannelLogicMatrix,
  normalizeU64SeedDecimalList,
  normalizeSeedMode,
  normalizeTrackId,
  normalizedConflictPriority,
  parallelSilentSourceIds,
} from "./patchIo";
import {
  boxedTrackIdSet,
  trackFlowLaneId,
  trackFlowSeedPathId,
  trackFlowSpecFromChain,
} from "./trackFlowBoxes";
export interface SwitchRequestData {
  name: string;
  cycleBeats: number;
  initialWeights: SubdivisionWeight[];
  initialJathiWeights: JathiWeight[];
  initialJathiBhedam?: JathiBhedamSelection | null;
  initialCustomSubdivision: CustomSubdivision | null;
  speedSubdivision: RhythmSpeedSpec | null;
  automation: AutomationSet | null;
  inflections: SubdivisionInflection[];
  switchCountWeights: SwitchCountWeight[];
  seedMode: string;
  seed: number;
  historySeeds: U64SeedDecimal[];
  historyWeight: number;
  newSeedWeight: number;
  maxHistory: number;
  newSeedChance: number;
  holdChance: number;
  blendCycles: number;
  singleParameterRhythmicModulation: boolean;
  accent: AccentSettings;
  pitch: number;
  velocity: number;
}

export type BuildResult =
  | { ok: true; data: SwitchRequestData }
  | { ok: false; error: string };

export function clonePatchJson<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function uniqueParallelTrackId(
  preferred: string,
  tracks: Pick<ParallelTrackPatch, "id">[]
): string {
  const base = normalizeTrackId(preferred, DEFAULT_PARALLEL_TRACK_ID);
  const existing = new Set(tracks.map((track) => track.id));
  if (!existing.has(base)) return base;
  for (let index = 1; index <= MAX_PARALLEL_TRACKS * 4; index += 1) {
    const candidate = `${base}-${index + 1}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function defaultParallelTrackName(
  tracks: Pick<ParallelTrackPatch, "name">[]
): string {
  const existing = new Set(tracks.map((track) => track.name.trim().toLowerCase()));
  for (let index = 1; index <= MAX_PARALLEL_TRACKS * 4; index += 1) {
    const candidate = `Track ${index}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `Track ${tracks.length + 1}`;
}

export function nextParallelTrackColor(index: number): string {
  return PARALLEL_TRACK_COLORS[index % PARALLEL_TRACK_COLORS.length]!;
}

export function transportReferenceTempoForPatch(patch: SequencerPatchDocument): number {
  const activeTrack =
    patch.project.tracks.find((track) => track.id === patch.project.activeTrackId) ??
    patch.project.tracks[0];
  if (
    parallelRuntimeWouldEngage(patch.project.tracks) &&
    activeTrack?.tempoMode === "custom"
  ) {
    return patch.project.global.tempoBpm;
  }
  return patch.transport.tempoBpm;
}

export function switchRequestFromParallelTrack(
  track: ParallelTrackPatch,
  global: ParallelProjectPatch["global"]
): BuildResult {
  const sequencer = track.sequencer;
  const cycleBeats = clamp(
    Math.round(
      track.cycleLengthMode === "custom"
        ? track.customCycleBeats
        : global.cycleBeats
    ),
    1,
    64
  );
  const initialWeights = canonicalizeGatiWeights(sequencer.initialWeights);
  const initialJathiWeights = cleanJathiWeights(sequencer.initialJathiWeights);
  const initialJathiBhedam = null;
  const initialCustomSubdivision = customSubdivisionForRequest(
    sequencer.initialCustomSubdivision
  );
  if (
    (!initialCustomSubdivision || initialCustomSubdivision.perBeatWeight > 0) &&
    !initialWeights.some((weight) => weight.weight > 0)
  ) {
    return {
      ok: false,
      error: `${track.name}: start section needs a positive subdivision.`,
    };
  }
  const boundaries = normalizeBoundaries(sequencer.boundaries, cycleBeats);
  const inflections: SubdivisionInflection[] = [];
  for (const boundary of boundaries) {
    const jathiWeights = cleanJathiWeights(boundary.jathiWeights);
    const customSubdivision = customSubdivisionForRequest(
      boundary.customSubdivision
    );
    const subdivisionWeights = canonicalizeGatiWeights(boundary.weights);
    if (
      boundary.changeProbability > 0 &&
      (!customSubdivision || customSubdivision.perBeatWeight > 0) &&
      !subdivisionWeights.some((weight) => weight.weight > 0)
    ) {
      return {
        ok: false,
        error: `${track.name}: boundary after beat ${boundary.afterBeat} needs a positive subdivision.`,
      };
    }
    inflections.push({
      id: boundary.id,
      position: boundary.afterBeat / cycleBeats,
      changeProbability: 1,
      subdivisionWeights,
      customSubdivision,
      jathiWeights,
      jathiBhedam: null,
    });
  }
  return {
    ok: true,
    data: {
      name: sequencer.name.trim() || track.name || "track",
      cycleBeats,
      initialWeights,
      initialJathiWeights,
      initialJathiBhedam,
      initialCustomSubdivision,
      speedSubdivision: null,
      automation:
        track.automation && track.automation.tracks.length > 0
          ? cloneAutomationSet(track.automation)
          : null,
      inflections,
      switchCountWeights: sequencer.sectionCountWeights.filter(
        (weight) =>
          Number.isFinite(weight.count) &&
          Number.isFinite(weight.weight) &&
          weight.count >= 0 &&
          weight.count <= boundaries.length &&
          weight.weight >= 0
      ),
      seedMode:
        sequencer.seedMode === "drift" || sequencer.seedMode === "morph"
          ? "perCycle"
          : normalizeSeedMode(sequencer.seedMode),
      seed: Math.max(0, Math.round(sequencer.seed)),
      historySeeds: normalizeU64SeedDecimalList(sequencer.historySeeds),
      historyWeight: Math.max(0, sequencer.historyWeight),
      newSeedWeight: Math.max(0, sequencer.newSeedWeight),
      maxHistory: clamp(Math.round(sequencer.maxHistory), 0, 64),
      newSeedChance: 0,
      holdChance: 0,
      blendCycles: 0,
      singleParameterRhythmicModulation: false,
      accent: {
        beatStart: cleanAccentRange(
          sequencer.accent.beatStart.min,
          sequencer.accent.beatStart.max
        ),
        sectionStartExtra: cleanAccentRange(
          sequencer.accent.sectionStartExtra.min,
          sequencer.accent.sectionStartExtra.max
        ),
        jathiStart: cleanAccentRange(
          sequencer.accent.jathiStart.min,
          sequencer.accent.jathiStart.max
        ),
        jathiMode: sequencer.accent.jathiMode,
      },
      pitch: clamp(Math.round(sequencer.pitch), 0, 127),
      velocity: clamp(Math.round(sequencer.velocity), 1, 127),
    },
  };
}

export function seedModeRequestFromPatch(
  behavior: RhythmSeedBehaviorName,
  localSeed: number,
  localHistory: U64SeedDecimal[],
  localHistoryWeight: number,
  localNewSeedWeight: number,
  localMaxHistory: number,
  _localNewSeedChance: number,
  _localHoldChance: number,
  _localBlendCycles: number,
  sequencer: PatchSequencerState
): RhythmSeedMode {
  if (behavior === "followGlobal") {
    switch (sequencer.seedMode) {
      case "perCycle":
        return { type: "perCycle", seed: sequencer.seed };
      case "history":
        return {
          type: "history",
          seed: sequencer.seed,
          history: normalizeU64SeedDecimalList(sequencer.historySeeds),
          historyWeight: Math.round(Math.max(0, sequencer.historyWeight)),
          newSeedWeight: Math.round(Math.max(0, sequencer.newSeedWeight)),
          maxHistory: clamp(Math.round(sequencer.maxHistory), 0, 64),
        };
      case "drift":
      case "morph":
        return { type: "perCycle", seed: sequencer.seed };
      case "locked":
        return { type: "locked", seed: sequencer.seed };
      default: {
        const unhandled: never = sequencer.seedMode;
        throw new Error(`unhandled global seed mode: ${String(unhandled)}`);
      }
    }
  }
  switch (behavior) {
    case "locked":
      return { type: "locked", seed: localSeed };
    case "perCycle":
      return { type: "perCycle", seed: localSeed };
    case "drift":
    case "morph":
      return { type: "perCycle", seed: localSeed };
    case "history":
      return {
        type: "history",
        seed: localSeed,
        history: normalizeU64SeedDecimalList(localHistory),
        historyWeight: Math.round(Math.max(0, localHistoryWeight)),
        newSeedWeight: Math.round(Math.max(0, localNewSeedWeight)),
        maxHistory: clamp(Math.round(localMaxHistory), 0, 64),
      };
    default: {
      const unhandled: never = behavior;
      throw new Error(`unhandled seed behavior: ${String(unhandled)}`);
    }
  }
}

export function generatorSpanInputsFromPulseSpans(
  accentSpans: PulseSpan[],
  labelFor: (span: PulseSpan) => string
): Array<{
  spanId: number;
  spanLen: number;
  label: string;
  sectionIndex: number | null;
  subdivision: number | null;
}> {
  return accentSpans.map((span) => ({
    spanId: span.id,
    spanLen: span.matraLen,
    label: labelFor(span),
    sectionIndex: span.sectionIndex,
    subdivision: span.subdivision,
  }));
}

/**
 * The authored per-matra velocities riding beside the span inputs in a
 * generator preview request. Spans without authored velocities (defensive:
 * a legacy preview payload) contribute no entry, so their cells simply come
 * back without velocities.
 */
export function generatorSpanVelocitiesFromPulseSpans(
  accentSpans: PulseSpan[]
): Array<{ spanId: number; velocities: number[] }> {
  return accentSpans
    .filter((span) => (span.matraVelocities?.length ?? 0) > 0)
    .map((span) => ({ spanId: span.id, velocities: span.matraVelocities }));
}

export function generatorSeedModeFromRhythm(
  mode: RhythmSeedMode,
  fallbackSeed: number
): GeneratorSeedMode {
  switch (mode.type) {
    case "locked":
    case "perCycle":
    case "history":
      return mode;
    case "followGlobal":
      return { type: "locked", seed: fallbackSeed };
    case "drift":
    case "morph":
      return { type: "perCycle", seed: mode.seed };
  }
}

/**
 * Generator History is intentionally the generator child stream of the
 * authored global seed strategy. Keep its independent base seed, but inherit
 * the exact initial pool and blend settings that transport receives. The
 * backend owns sequential history replay for random-access preview.
 */
export function generatorSeedModeFromGlobalSettings(
  type: GeneratorSeedMode["type"],
  seed: number,
  history: readonly U64SeedDecimal[],
  historyWeight: number,
  newSeedWeight: number,
  maxHistory: number
): GeneratorSeedMode {
  if (type !== "history") return { type, seed };
  return {
    type,
    seed,
    history: [...history],
    historyWeight: clamp(Math.round(historyWeight), 0, 999),
    newSeedWeight: clamp(Math.round(newSeedWeight), 0, 999),
    maxHistory: clamp(Math.round(maxHistory), 0, 64),
  };
}

export function channelHocketSpecFromPatch(
  patch: PatchChannelHocketState,
  sequencer: PatchSequencerState
): ChannelHocketSpec | null {
  if (!patch.enabled) return null;
  const channels = patch.channels.filter((channel) => MIDI_CHANNELS.includes(channel));
  if (!channels.length) return null;
  const fallback = channels.includes(patch.fallback) ? patch.fallback : channels[0]!;
  const transitions: ChannelTransition[] = channelContexts(channels, patch.order)
    .flatMap((from) =>
      channels.flatMap((to) => {
        const weight = channelWeightValue(patch.weights, channels, patch.order, from, to);
        return weight > 0 ? [{ from, to, weight: clamp(Math.round(weight), 0, 999) }] : [];
      })
    );
  const fallbackWeights: ChannelFallbackWeight[] = channels.flatMap((channel) => {
    const weight = clamp(Math.round(patch.fallbackWeights[String(channel)] ?? 0), 0, 999);
    return weight > 0 ? [{ channel, weight }] : [];
  });
  const entryWeights: ChannelEntryWeight[] = channelContexts(channels, patch.order).flatMap(
    (entry) => {
      const weight = clamp(
        Math.round(patch.entryWeights[channelEntryWeightKey(patch.order, entry)] ?? 0),
        0,
        999
      );
      return weight > 0 ? [{ channels: entry, weight }] : [];
    }
  );
  return {
    order: patch.order,
    channels,
    transitions,
    fallback,
    fallbackWeights,
    entryWeights,
    seedMode: seedModeRequestFromPatch(
      patch.seedBehavior,
      patch.seed,
      patch.historySeeds,
      patch.historyWeight,
      patch.newSeedWeight,
      patch.maxHistory,
      patch.newSeedChance,
      patch.holdChance,
      patch.blendCycles,
      sequencer
    ),
    globalSeed: sequencer.seed,
    accentRules: channelAccentRulesToRequest(patch.accentRules, channels),
    positionRules: channelPositionRulesToRequest(patch.positionRules, channels),
    assignMode: patch.assignMode,
    euclid:
      patch.assignMode === "euclid"
        ? euclidChannelSpecToRequest(patch.euclid, channels)
        : null,
  };
}

/**
 * Maps the patch euclid block onto the wire spec, dropping layers that are
 * not enabled palette members (or repeat a channel) and clamping Partition
 * pulses into the shared steps budget so the request is validation-clean —
 * mirroring the engine's repair rules rather than relying on them.
 */
export function euclidChannelSpecToRequest(
  euclid: PatchEuclidChannelState,
  channels: number[]
): EuclidChannelSpec {
  let budget =
    euclid.placement === "partition" ? euclid.steps : Number.POSITIVE_INFINITY;
  const layers: EuclidChannelLayer[] = canonicalEuclidLayersForChannels(
    euclid.layers,
    channels
  ).map((layer) => {
    const pulses = Math.min(layer.pulses, budget);
    budget -= pulses;
    return {
      channel: layer.channel,
      pulses,
      rotation: layer.rotation,
      maxRun: layer.maxRun,
      steps: layer.steps,
      invert: layer.invert,
    };
  });
  return {
    placement: euclid.placement,
    steps: euclid.steps,
    layers,
    reset: euclid.reset,
    spanAccentMode: euclid.spanAccentMode,
    spanAccentChannel:
      euclid.spanAccentChannel !== null && channels.includes(euclid.spanAccentChannel)
        ? euclid.spanAccentChannel
        : null,
  };
}

export function trackPlaybackRequestFromParallelTrack(
  track: ParallelTrackPatch,
  _global: ParallelProjectPatch["global"],
  _switchData: SwitchRequestData,
  seedPath: SeedPathPlaybackConfig | null
): ParallelPlaybackRequest["tracks"][number]["playback"] {
  const channelHocket = channelHocketSpecFromPatch(track.channelHocket, track.sequencer);
  const automation = playbackAutomationForTrack(track);
  return {
    generatorEnabled: track.generatorEnabled,
    generator: track.generator,
    midiOutputChannel: clamp(Math.round(track.channelHocket.outputChannel), 1, 16),
    automation,
    channelHocketEnabled: track.channelHocket.enabled,
    channelHocket,
    seedPath,
  };
}

function deriveParallelRuntimeTopology(project: ParallelProjectPatch) {
  const boxes = project.global.trackFlowBoxes;
  const boxedIds = boxedTrackIdSet(boxes);
  const soloActive = project.tracks.some((track) => track.soloed);
  const isAudible = (track: ParallelTrackPatch): boolean =>
    !track.muted && (!soloActive || track.soloed);
  const audibleTracks = project.tracks.filter(isAudible);
  // Boxed tracks are routed to their box's synthetic lane, not the ordinary
  // parallel participant list; everything else free-runs in parallel.
  const parallelAudible = audibleTracks.filter((track) => !boxedIds.has(track.id));
  // A muted/solo-hidden *parallel* track that an audible triggered follower
  // depends on must still be realized silently to drive it. Boxed tracks are
  // never trigger sources, so only parallel tracks are considered.
  const parallelTracks = project.tracks.filter((track) => !boxedIds.has(track.id));
  const silentSourceIds = parallelSilentSourceIds(parallelTracks);
  const silentSources = parallelTracks.filter((track) =>
    silentSourceIds.has(track.id)
  );
  // A track lookup so a box can resolve its (audible, ordered) members.
  const trackById = new Map(project.tracks.map((track) => [track.id, track]));
  // A box contributes a lane only when it has at least one audible member
  // (mute/solo prune members from the lane source list — the v1 audible-source
  // model; a muted member is not visited silently). Members keep box order.
  const audibleBoxes = boxes
    .map((box) => ({
      box,
      audibleMembers: box.memberTrackIds
        .map((id) => trackById.get(id))
        .filter((track): track is ParallelTrackPatch => !!track && isAudible(track)),
    }))
    .filter((entry) => entry.audibleMembers.length > 0);
  // Box lane ids are real runtime conflict participants (matrix endpoints /
  // priority ranks), so the matrix + priority normalizations must see them.
  const boxLaneIds = audibleBoxes.map((entry) => trackFlowLaneId(entry.box.id));
  // Engage the parallel runtime when any box lane exists, when there is more
  // than one participant to realize, or when a multi-track project has one
  // audible custom-tempo track. That last case must keep the project's global
  // tempo as the reference clock while carrying the track-local BPM inside the
  // parallel request; the single-track path would overwrite the reference
  // transport tempo with the custom value.
  const preservesCustomTempoReference =
    project.tracks.length > 1 &&
    parallelAudible.length === 1 &&
    parallelAudible[0]?.tempoMode === "custom";
  return {
    audibleBoxes,
    boxLaneIds,
    parallelAudible,
    silentSources,
    wouldEngage:
      audibleBoxes.length > 0 ||
      parallelAudible.length + silentSources.length > 1 ||
      preservesCustomTempoReference,
  };
}

/**
 * Whether the full project topology selects parallel playback.
 *
 * Unlike the track-only live-push gate, this includes audible Track Flow
 * boxes and hidden trigger sources, matching `buildParallelPlaybackRequest`.
 */
export function parallelProjectRuntimeWouldEngage(
  project: ParallelProjectPatch
): boolean {
  return deriveParallelRuntimeTopology(project).wouldEngage;
}

export function buildParallelPlaybackRequest(
  project: ParallelProjectPatch,
  seedPath: SeedPathPlaybackConfig | null
): ParallelPlaybackRequest | { error: string } | null {
  const channelConflictPolicy = musicalChannelLogicDefaultPolicy(
    project.global.channelConflictPolicy
  );
  const {
    audibleBoxes,
    boxLaneIds,
    parallelAudible,
    silentSources,
    wouldEngage,
  } = deriveParallelRuntimeTopology(project);
  if (!wouldEngage) {
    return null;
  }
  const activeFirst = [
    ...parallelAudible.filter((track) => track.id === project.activeTrackId),
    ...parallelAudible.filter((track) => track.id !== project.activeTrackId),
  ];
  const tracks: ParallelPlaybackRequest["tracks"] = [];
  const buildTrackRequest = (
    track: ParallelTrackPatch,
    silent: boolean,
    // Seed-path identity to record/replay under. Parallel tracks use their bare
    // id; a boxed source uses the composite `track-flow-<boxId>:<sourceId>` so
    // backend replay matches the concrete id PASS C writes (a bare-id lookup
    // would silently no-op).
    seedPathId: string = track.id
  ): ParallelPlaybackRequest["tracks"][number] | { error: string } => {
    const score = switchRequestFromParallelTrack(track, project.global);
    if (!score.ok) {
      return { error: score.error };
    }
    return {
      id: track.id,
      name: track.name,
      score: score.data,
      playback: trackPlaybackRequestFromParallelTrack(
        track,
        project.global,
        score.data,
        seedPathConfigForTrack(seedPath, seedPathId)
      ),
      tempoBpm: clamp(
        Math.round(
          (track.tempoMode === "custom"
            ? track.customTempoBpm
            : project.global.tempoBpm) * 10
        ) / 10,
        20,
        400
      ),
      // A silent source is a continuous clock (trigger forced off); audible
      // tracks forward their config. The backend re-normalizes the graph.
      trigger: silent ? null : track.trigger ?? null,
      silent,
    };
  };
  for (const track of activeFirst) {
    const built = buildTrackRequest(track, false);
    if ("error" in built) {
      return { error: built.error };
    }
    tracks.push(built);
  }
  for (const track of silentSources) {
    const built = buildTrackRequest(track, true);
    if ("error" in built) {
      return { error: built.error };
    }
    tracks.push(built);
  }
  // One box → one `TrackFlowBoxRequest`: its audible ordered members as sources
  // (each looked up under its composite seed-path id), the chain re-indexed to
  // the audible members, and the box's seed.
  const trackFlowBoxesRequest: ParallelPlaybackRequest["trackFlowBoxes"] = [];
  for (const { box, audibleMembers } of audibleBoxes) {
    const sources: ParallelPlaybackRequest["tracks"] = [];
    for (const member of audibleMembers) {
      const built = buildTrackRequest(
        member,
        false,
        trackFlowSeedPathId(box.id, member.id)
      );
      if ("error" in built) {
        return { error: built.error };
      }
      // Members are realized like ordinary tracks but are never triggered — the
      // box's chain drives selection.
      sources.push({ ...built, trigger: null });
    }
    const audibleMemberIds = audibleMembers.map((member) => member.id);
    trackFlowBoxesRequest.push({
      id: box.id,
      name: box.name,
      sources,
      spec: trackFlowSpecFromChain(box.chain, audibleMemberIds),
      seed: box.seed,
    });
  }
  // Box lane ids are runtime participants, so the channel-logic matrix is
  // normalized against parallel track ids **plus** the box lane ids — otherwise
  // every authored `track-flow-<boxId>` endpoint rule would be silently dropped
  // (matching the backend's acceptance of box lanes as matrix endpoints).
  const matrixEndpointTracks: Pick<ParallelTrackPatch, "id">[] = [
    ...tracks.map((track) => ({ id: track.id })),
    ...boxLaneIds.map((id) => ({ id })),
  ];
  return {
    referenceTempoBpm: clamp(Math.round(project.global.tempoBpm * 10) / 10, 20, 400),
    referenceCycleBeats: clamp(Math.round(project.global.cycleBeats), 1, 64),
    tracks,
    channelConflictPolicy,
    channelLogicMatrix: normalizeChannelLogicMatrix(
      project.global.channelLogicMatrix,
      matrixEndpointTracks,
      channelConflictPolicy
    ),
    // Priority is normalized against the parallel runtime participants **plus**
    // the box lane ids (box lanes are participants and take a priority rank).
    // Box source ids are not runtime participants (they live inside the
    // synthetic lanes), so they are excluded; an authored box-lane priority is
    // honored and any box lane without one falls back to its appended rank.
    conflictPriority: normalizedConflictPriority(
      project.global.conflictPriority,
      matrixEndpointTracks
    ),
    trackFlowBoxes: trackFlowBoxesRequest,
  };
}

/**
 * Dedup key for live-applying a parallel request to a RUNNING transport.
 * `buildParallelPlaybackRequest` orders the ACTIVE track first, so merely
 * switching the shown track reorders `tracks` without changing any parameter.
 * The engine keys per-track state by id and compares configs as sets, so a
 * pure ordering change is not an edit — normalize order out of the key so the
 * live-apply effect only re-pushes genuinely changed configs.
 */
export function parallelPushDedupKey(request: ParallelPlaybackRequest): string {
  return JSON.stringify({
    ...request,
    tracks: [...request.tracks].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    ),
  });
}

export function patchContentFingerprint(patch: SequencerPatchDocument): string {
  // Score snapshots are derived inspection artifacts. They can change as the
  // transport advances without any authored edit, so including them makes an
  // idle/playing project look dirty and forces redundant autosaves. Track
  // configuration remains fully fingerprinted; only each derived snapshot is
  // removed.
  const project = {
    ...patch.project,
    tracks: patch.project.tracks.map(({ scoreSnapshot: _snapshot, ...track }) =>
      track
    ),
  };
  return JSON.stringify({
    app: patch.app,
    schemaVersion: patch.schemaVersion,
    transport: patch.transport,
    project,
    sequencer: patch.sequencer,
    rhythm: patch.rhythm,
    pitchShaper: patch.pitchShaper,
    channelHocket: patch.channelHocket,
    // Autosave and recent-session behavior are machine preferences. Patch
    // documents retain those fields only for backward wire compatibility;
    // they are neither authored project state nor part of dirty detection.
    setup: {
      open: patch.setup.open,
      tab: patch.setup.tab,
    },
    ui: patch.ui,
    seedPaths: patch.seedPaths,
  });
}

// Re-exported from patchIo (single source of truth) for backward compat.
export { PARALLEL_TRACK_COLORS };

export function channelAccentRulesToRequest(
  rules: PatchChannelAccentRule[],
  enabledChannels: number[]
): ChannelAccentRule[] {
  const channels = enabledChannels.filter((channel) => MIDI_CHANNELS.includes(channel));
  return rules.flatMap((rule) => {
    if (!rule.enabled || rule.probabilityPercent <= 0 || channels.length === 0) {
      return [];
    }
    const weights: ChannelAccentWeight[] = channels.flatMap((channel) => {
      const weight = clamp(Math.round(rule.weights[String(channel)] ?? 0), 0, 999);
      return weight > 0 ? [{ channel, weight }] : [];
    });
    if (weights.length === 0) {
      return [];
    }
    return [
      {
        minVelocity: clamp(Math.round(rule.minVelocity), 1, 127),
        maxVelocity: clamp(Math.round(rule.maxVelocity), 1, 127),
        probability: clamp(rule.probabilityPercent / 100, 0, 1),
        mode: rule.mode,
        weights,
      },
    ];
  });
}

export function channelPositionRulesToRequest(
  rules: PatchChannelPositionRule[],
  enabledChannels: number[]
): ChannelPositionRule[] {
  const channels = enabledChannels.filter((channel) => MIDI_CHANNELS.includes(channel));
  if (channels.length === 0) return [];
  return rules.flatMap((rule) => {
    if (!rule.enabled || rule.nth <= 0) return [];
    const renderWeights: ChannelAccentWeight[] = channels.flatMap((channel) => {
      const weight = clamp(Math.round(rule.renderWeights[String(channel)] ?? 0), 0, 999);
      return weight > 0 ? [{ channel, weight }] : [];
    });
    const resetWeights: ChannelAccentWeight[] = channels.flatMap((channel) => {
      const weight = clamp(Math.round(rule.resetWeights[String(channel)] ?? 0), 0, 999);
      return weight > 0 ? [{ channel, weight }] : [];
    });
    const actionWeights = {
      normalMarkov: clamp(Math.round(rule.actionWeights.normalMarkov), 0, 999),
      renderOnly: renderWeights.length
        ? clamp(Math.round(rule.actionWeights.renderOnly), 0, 999)
        : 0,
      resetMarkov:
        rule.resetMode === "customWeighted" && resetWeights.length === 0
          ? 0
          : clamp(Math.round(rule.actionWeights.resetMarkov), 0, 999),
    };
    if (
      actionWeights.normalMarkov <= 0 &&
      actionWeights.renderOnly <= 0 &&
      actionWeights.resetMarkov <= 0
    ) {
      return [];
    }
    return [
      {
        id: rule.id,
        label: rule.label,
        enabled: rule.enabled,
        scope: rule.scope,
        nth: clamp(Math.round(rule.nth), 1, 999),
        actionWeights,
        renderWeights,
        reset: {
          mode: rule.resetMode,
          weights: resetWeights,
        },
      },
    ];
  });
}

export function cleanJathiWeights(weights: JathiWeight[]): JathiWeight[] {
  return canonicalizeJathiWeights(weights);
}

export function customSubdivisionGatis(
  custom: CustomSubdivision | null | undefined
): number[] {
  return (
    custom
      ? [
          ...custom.partGatiWeights.map((weight) => weight.subdivision),
          ...custom.divisions.flatMap((division) =>
            division.gatiWeights.map((weight) => weight.subdivision)
          ),
        ]
      : []
  );
}

export function seedPathConfigForTrack(
  config: SeedPathPlaybackConfig | null,
  trackId: string
): SeedPathPlaybackConfig | null {
  if (!config) return null;
  return {
    entries: filterSeedPathItemsForTrack(config.entries, trackId),
    wildcards: filterSeedPathItemsForTrack(config.wildcards, trackId),
  };
}
