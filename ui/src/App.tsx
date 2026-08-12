import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  onTransportPosition,
  onTransportTimelineSnapshot,
  onTransportLogSnapshot,
  onNativeMenuAction,
  parallelSetPlayback,
  patchAutosave,
  patchAskAutosaveRecovery,
  patchClearAutosave,
  patchChooseOpenPath,
  patchChooseSavePath,
  patchLoadAutosave,
  patchLoadFromPath,
  patchSaveToPath,
  generatorPreview,
  trackSetPlayback,
  scoreChooseSavePath,
  scoreCreateSubdivisionSwitch,
  scoreGetCurrent,
  scorePreviewSubdivisionSwitch,
  scoreSaveToPath,
  trackAskKeepTimingOnImport,
  trackChooseOpenPath,
  trackChooseSavePath,
  trackLoadFromPath,
  trackSaveToPath,
  synthSetEnabled,
  synthSetPrograms,
  transportGetSnapshot,
  transportPlay,
  transportResync,
  transportSetTempo,
  transportSetTelemetryInterest,
  transportStop,
  type AutomationSegmentCurve,
  type AutomationSet,
  type AutomationValueKind,
  type ChannelEntryWeight,
  type ChannelFallbackWeight,
  type ChannelHocketSpec,
  type ChannelTransition,
  type CustomSubdivision,
  type JathiBhedamSelection,
  type JathiWeight,
  type NativeMenuAction,
  type ParallelPlaybackRequest,
  type RhythmSeedMode,
  type GeneratorConfig,
  type GeneratorPreview,
  type GeneratorPreviewRequest,
  type EvolutionDirective,
  type TrackPlaybackRequest,
  type SubdivisionSwitchPreview,
  type SubdivisionWeight,
  type SynthChannelMode,
  type SynthChannelProgram,
  type SwitchCountWeight,
  type LivePositionSample,
  type TransportSnapshot,
  type TransportPosition,
  type TransportTimelineSnapshot,
  type TransportLogSnapshot,
  type TriggerConfig,
  type MachinePrefs,
  type MidiDestination,
  type MidiRouteStatus,
  machinePrefsGet,
  machinePrefsSet,
  midiGetRouteStatus,
  midiListDestinations,
  midiSetDestination,
  onMidiRouteStatus,
  transportPanic,
} from "./bridge";
import {
  DEFAULT_AUTOMATION_DEBUG_LIMIT,
  DEFAULT_MIDI_DEBUG_LIMIT,
  DEFAULT_BLEND_CYCLES,
  DEFAULT_HOLD_CHANCE,
  DEFAULT_NEW_SEED_CHANCE,
  MAX_AUTOMATION_LENGTH_CYCLES,
  MAX_PARALLEL_TRACKS,
  MIDI_CHANNELS,
  NEUTRAL_CYCLE_BEATS,
  NEUTRAL_INITIAL_WEIGHTS,
  NEUTRAL_JATHI_WEIGHTS,
  NEUTRAL_SCORE_NAME,
  NEUTRAL_SECTION_COUNTS,
  NEUTRAL_SYNTH_VOICES,
  NEUTRAL_TEMPO_BPM,
  PATCH_APP_ID,
  PATCH_SCHEMA_VERSION,
  channelEntryWeightKey,
  clamp,
  cleanAccentRange,
  cloneAutomationSet,
  cloneChannelAccentRules,
  cloneChannelPositionRules,
  cloneCustomSubdivision,
  cloneJathiBhedam,
  cloneJathiWeights,
  cloneSynthVoices,
  cloneWeights,
  createNeutralPatchDocument,
  customSubdivisionForRequest,
  enforceTriggerGraph,
  musicalChannelLogicDefaultPolicy,
  normalizeAutomationDebugLimit,
  normalizeBoundaries,
  normalizeChannelLogicMatrix,
  normalizeMidiDebugLimit,
  normalizeSeedMode,
  normalizeSynthPrograms,
  normalizedConflictPriority,
  runtimeEndpointTrackIds,
  buildTrackEnvelope,
  readTrackEnvelope,
  spliceImportedTrack,
  readPatchDocument,
  synthProgramsToRequest,
  withProjectState,
  type AutomationGraphRangeData,
  type BoundaryPoint,
  type ChannelConflictPolicy,
  type ParallelProjectPatch,
  type ParallelTrackPatch,
  type SeedDialogTab,
  type SeedLogScope,
  type SeedModeName,
  type SeedPath,
  type SequencerPatchDocument,
  type SequencerPatchFlatState,
  type SetupTab,
  type TrackCycleLengthMode,
  type TrackTempoMode,
  NEUTRAL_PITCH,
} from "./patchIo";
import {
  DEFAULT_DUMKA_OP_WEIGHTS,
  DEFAULT_DUMKA_PATTERN,
  type DumkaOpWeights,
  analyzeDumkaPattern,
  dumkaStructureMatches,
} from "./dumkaPattern";
import {
  boxedTrackIdSet,
  boxForTrack,
  defaultTrackFlowChain,
  trackFlowEntryKey,
  trackFlowLaneId,
  trackFlowTransitionKey,
  TRACK_FLOW_DEFAULT_SEED,
  type TrackFlowBox,
  type TrackFlowChainState,
} from "./trackFlowBoxes";
import { parallelRuntimeWouldEngage } from "./playbackGating";
import {
  TRACK_PLAYBACK_STATE_LABELS,
  trackPlaybackStates,
} from "./trackPlaybackStates";
import { TrackRoleControl } from "./components/TrackRoleControl";
import {
  applyRoleIntent,
  assignTrackToBoxes,
  eligibleTriggerSources,
  roleOptions,
  roleTransition,
  trackRole,
  type TrackRole,
} from "./trackRole";

import {
  defaultPatchFilename,
  defaultScoreFilename,
  defaultTrackFilename,
  fileNameFromPath,
} from "./filenames";


import { NumericField } from "./NumericField";
import { TriggerInspector } from "./TriggerInspector";
import { defaultTriggerConfig } from "./triggerUi";
import {
  MAX_STOPPED_PREVIEW_CYCLE,
  pruneTimelineAutomationTargetIds,
  selectActiveTrackTimelineLayers,
  selectSeedRecurrenceRows,
  selectStableTimelineRenderModel,
  selectTimelineAutomationTracks,
  selectTimelineTransportLayerVisibility,
  timelineSourcesAreCoherent,
} from "./timelineModel";
import {
  synthVoiceLabel,
} from "./synthVoices";
import {
  type AutomationMarkerData,
  type AutomationTargetDef,
  EMPTY_AUTOMATION_TRACKS,
  automationGraphAxisRange,
  automationGraphMinimumSpan,
  automationSegmentCurveForPoint,
  automationTargetDef,
  automationTargetGroups as automationTargetGroupsFor,
  automationTargetSort,
  automationTimeFromUnit,
  coerceAutomationGraphRange,
  coerceAutomationPointNumberForAxis,
  defaultAutomationSegmentCurve,
  defaultAutomationWeightGraphRange,
  makeAutomationCurve,
  makeAutomationTrack,
  sortAutomationMarkers,
  sortAutomationPoints,
  sortAutomationPointsByEffectiveTime,
} from "./automationTargets";
import {
  formatShortNumber,
} from "./formatters";
import { channelContexts, channelWeightValue } from "./markovWeights";
import {
  type GlobalSeedStartupLock,
  datetimeSeed,
  datetimeSeedForNewParallelTrack,
  forgetLastPatchPath,
  markAutosaveSessionActive,
  markAutosaveSessionClean,
  readGlobalSeedStartupLock,
  readLastPatchPath,
  readPreviousSessionInterrupted,
  readRecentPatches,
  rememberPatchPath,
  writeGlobalSeedStartupLock,
} from "./sessionPrefs";
import {
  defaultMachinePrefs,
  planSetupPrefsMigration,
  removableLegacySetupKeys,
} from "./machinePrefs";
import {
  destinationForValue,
  missingChipLabel,
  routeStatusLine,
  showMissingChip,
} from "./midiRouting";
import {
  buildChannelLogicOverrideRows,
  buildEffectiveChannelSummaries,
  buildParallelPriorityRows,
  channelLogicGlobalsForDefaultPolicy,
  nextChannelLogicMatrixForAddedPair,
  nextChannelLogicMatrixForGroupPolicy,
  nextChannelLogicMatrixForGroupTrack,
  nextChannelLogicMatrixForRemovedGroup,
  nextChannelLogicMatrixForToggledChannel,
  nextConflictPriorityForMove,
  channelConflictPolicyLabel,
  formatTrackOptionLabel,
  intersectMidiChannels,
  type ChannelLogicOverrideRow,
} from "./channelLogic";
import { ChannelLogicPanel } from "./components/ChannelLogicPanel";
import {
  SwitchRequestData,
  generatorSpanInputsFromPulseSpans,
  generatorSpanVelocitiesFromPulseSpans,
  buildParallelPlaybackRequest,
  parallelPushDedupKey,
  channelAccentRulesToRequest,
  channelPositionRulesToRequest,
  clonePatchJson,
  euclidChannelSpecToRequest,
  generatorSeedModeFromGlobalSettings,
  defaultParallelTrackName,
  nextParallelTrackColor,
  patchContentFingerprint,
  transportReferenceTempoForPatch,
  uniqueParallelTrackId,
} from "./playbackRequests";
import {
  SEED_LOOP_MONITOR_MODES,
  childStreamSeedModeRequest,
} from "./seedStrategyModel";
import {
  firstOpenBoundaryAfterBeat,
  makeBoundaryPoint,
  newStableId,
} from "./boundaryPlanning";
import {
  applyThemeMode,
  readThemePreference,
  writeThemePreference,
} from "./themePrefs";
import { ThemeToggle } from "./ThemeToggle";
import {
} from "./components/AccentControls";
import {
  SeedHistoryLoopMonitor,
  type SeedPoolLogEntry,
  makeSeedPath,
  parseSeeds,
  seedModeShortLabel,
  seedPathPlaybackConfig,
} from "./components/SeedControls";
import {
  appendSeedRecordingEvents,
  projectWithSeedRecording,
  seedPathsForSelectedTrack,
  upsertSeedPath,
  type SeedRecordingSession,
} from "./seedRecordingSession";
import {
  parallelConflictPeerSummary,
  parallelConflictTrackSummary,
} from "./midiDebugFormat";
import {
  MainEditorId,
  MainEditorLauncher,
  MainEditorLauncherItem,
  PanelStatusChips,
  type PanelStatusStripEntry,
} from "./components/MainEditorChrome";
import {
  PatchPersistenceState,
  SectionInspectorEntry,
} from "./components/PitchNotation";
import { publishCaesuraE2eState } from "./components/e2eState";
import { formatPct, formatSeeds } from "./components/format";
import {
  CachedCycleValue,
  TimelineLayerRenderModel,
  rememberCachedCycleValue,
  rhythmAccentSpans,
} from "./components/timelineRenderModel";
import {
  transitionHeatBackground,
  transitionHeatShadow,
} from "./components/transitionHeat";
import {
  PLAYHEAD_LATENCY_COMPENSATION_MS,
  TRANSPORT_PPQN,
} from "./components/transportConstants";
import { PanelStatusEntry } from "./components/WeightEditors";
import {
  fixedGroupingFromWeights,
  fixedGroupingWeights,
  fixedSubdivisionFromWeights,
  fixedSubdivisionWeights,
} from "./sectionsSubdivisionsLogic";
import {
  buildResolvedBeats,
  groupResolvedSections,
  pulseSpanLabel,
} from "./resolvedSections";
import { AutomationDebugPanel } from "./components/AutomationDebugPanel";
import { ChannelShaperPanel } from "./components/ChannelShaperPanel";
import { MidiDebugPanel } from "./components/MidiDebugPanel";
import {
  buildGeneratorPreviewRequestKey,
  useSequencerPreviewState,
} from "./components/useSequencerPreviewState";
import { useChannelShaperState } from "./components/useChannelShaperState";
import { TimelinePanel } from "./components/TimelinePanel";
import { BoundaryDetailDialog } from "./components/BoundaryDetailDialog";
import { BoundaryAfterBeatSelect } from "./components/BoundaryAfterBeatSelect";
import { DeleteTrackConfirmModal } from "./components/DeleteTrackConfirmModal";
import { AutomationFocusModal } from "./components/AutomationFocusModal";
import { SynthPropertiesModal } from "./components/SynthPropertiesModal";
import { SetupDialog } from "./components/SetupDialog";
import { AutomationEditorModal } from "./components/AutomationEditorModal";
import { LiveTransportReadout } from "./components/LiveTransportReadout";
import { SeedSetupDialog } from "./components/SeedSetupDialog";
import { SectionBoundariesPanel } from "./components/SectionBoundariesPanel";
import { FixedSectionControls } from "./components/FixedSectionControls";
import { GeneratorEditor } from "./components/GeneratorEditor";
import { EvolvePlanPanel } from "./components/EvolvePlanPanel";
import {
  TRANSPORT_WARNING_ID,
  TransportWarning,
} from "./components/TransportWarning";
import {
  ModalDismissBackdrop,
} from "./components/ModalChrome";
import { EMPTY_CHANNEL_HOCKET_EVENTS } from "./playbackLayers";
import {
  selectCurrentGeneratorPreviewFailure,
  selectPlaybackAvailability,
  type GeneratorPreviewFailure,
} from "./playbackAvailability";
import { selectEvolutionPreviewCycles } from "./evolvePreviewCycles";
import {
  gatePosition,
  promoteTimeline,
  type PositionGateState,
} from "./telemetryGating";
import {
  autosaveBuildIsCurrent,
  backgroundQueueCleanupAllowed,
  beginLatestWinsBuildIntent,
  coalesceInFlightRequest,
  createLatestWinsQueue,
  debugTailWhenOpen,
  discardLatestWinsPending,
  enqueueLatestWins,
  ensureLatestWins,
  latestWinsNeedsEnqueue,
  latestWinsBuildIntentIsCurrent,
  renderedPreviewWhilePending,
  setLatestWinsDesired,
  singleTrackBackendOwnerAvailable,
  structuralTrackActionIsCurrent,
  shouldStartAutosaveCheck,
  startupRestoreIsCurrent,
  telemetryLogInterestRequested,
  telemetryLogLayersForInterest,
  transportTempoFollowMode,
  updateCurrentValue,
  visualTransportNeedsPublish,
  type EnsuredLatestWinsOutcome,
  type LatestWinsQueue,
  type TelemetryLogInterest,
} from "./appInteractionPerformance";
import {
  discardEditorDrafts,
  flushEditorDrafts,
  flushFocusedEditorDraft,
  useDiscardEditorDraft,
} from "./editorDraftFlush";

const DIRTY_PATCH_FINGERPRINT = "__caesura_dirty_patch__";
const PATCH_SETUP_COMPATIBILITY_DEFAULTS = defaultMachinePrefs();

function synthProgramsWriteKey(programs: SynthChannelProgram[]): string {
  return `synth:${JSON.stringify(programs)}`;
}

function synthEnabledWriteKey(enabled: boolean): string {
  return `synth-enabled:${enabled ? "on" : "off"}`;
}

function trackPlaybackWriteKey(request: TrackPlaybackRequest): string {
  return `playback:${JSON.stringify(request)}`;
}

function tempoWriteKey(tempoBpm: number): string {
  return `tempo:${tempoBpm}`;
}

function telemetryInterestWriteKey(interest: TelemetryLogInterest): string {
  return `telemetry:${interest}`;
}

function parallelPlaybackWriteKey(
  request: ParallelPlaybackRequest | null
): string {
  // `nextCycle` changes when the mutation lands, not the resulting config.
  // Normalize track order so switching the shown track remains a true no-op.
  return request === null
    ? "parallel:null"
    : `parallel:${parallelPushDedupKey(request)}`;
}

function requireLatestWrite(
  outcome: EnsuredLatestWinsOutcome<void>,
  label: string
): void {
  if (outcome.status === "applied" || outcome.status === "current") {
    return;
  }
  if (outcome.status === "error") {
    throw outcome.error;
  }
  if (outcome.status === "superseded") {
    throw new Error(`${label} changed while the command was pending`);
  }
  throw new Error(`${label} apply was deferred`);
}

function normalizeInteractiveProjectMetadata(
  project: ParallelProjectPatch
): ParallelProjectPatch {
  const boxes = project.global.trackFlowBoxes;
  const boxedIds = boxedTrackIdSet(boxes);
  const tracks = enforceTriggerGraph(
    project.tracks.map((track) =>
      boxedIds.has(track.id)
        ? { ...track, mode: "trackFlow" as const, trigger: null }
        : { ...track, mode: "parallel" as const }
    ),
    boxedIds
  );
  const endpoints = runtimeEndpointTrackIds(tracks, boxes);
  return {
    ...project,
    tracks,
    global: {
      ...project.global,
      conflictPriority: normalizedConflictPriority(
        project.global.conflictPriority,
        endpoints
      ),
      channelLogicMatrix: normalizeChannelLogicMatrix(
        project.global.channelLogicMatrix,
        endpoints,
        project.global.channelConflictPolicy
      ),
    },
  };
}

function createSubdivisionSwitchScore(data: SwitchRequestData): Promise<void> {
  return scoreCreateSubdivisionSwitch(
    data.name,
    data.cycleBeats,
    data.initialWeights,
    data.initialJathiWeights,
    data.initialJathiBhedam ?? null,
    data.initialCustomSubdivision,
    data.speedSubdivision,
    data.automation,
    data.inflections,
    data.switchCountWeights,
    data.seedMode,
    data.seed,
    data.historySeeds,
    data.historyWeight,
    data.newSeedWeight,
    data.maxHistory,
    data.newSeedChance,
    data.holdChance,
    data.blendCycles,
    data.singleParameterRhythmicModulation,
    data.accent,
    data.pitch,
    data.velocity
  );
}

export default function App() {
  const [themeMode, setThemeMode] = useState(() => readThemePreference());
  const [snapshot, setSnapshot] = useState<TransportSnapshot | null>(null);
  const [playbackTransitionKind, setPlaybackTransitionKind] = useState<
    "idle" | "starting" | "stopping"
  >("idle");
  // Bumped when Stop releases a live runtime. Transition state is also an
  // effect dependency: entering `starting` pauses background staging, while
  // returning to `idle` must restage edits that invalidated an in-flight Play.
  const [singleTrackOwnershipEpoch, setSingleTrackOwnershipEpoch] = useState(0);
  const [visualTransport, setVisualTransport] = useState({
    currentTick: 0,
    currentCycle: 0,
  });
  const [tempoInput, setTempoInput] = useState(NEUTRAL_TEMPO_BPM.toFixed(0));
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [patchStatus, setPatchStatus] = useState<string | null>(null);
  const [synthEnabled, setSynthEnabled] = useState(false);
  const [synthPending, setSynthPending] = useState(false);
  const [synthPropertiesOpen, setSynthPropertiesOpen] = useState(false);
  const [synthPrograms, setSynthPrograms] = useState<SynthChannelProgram[]>(() =>
    cloneSynthVoices(NEUTRAL_SYNTH_VOICES)
  );
  // Machine-local defaults until the machine-prefs file hydrates (boot
  // effect below). The hydrated ref gates the persist effect so default
  // state never clobbers the file before the read lands.
  const [initialSetupPreferences] = useState(() => defaultMachinePrefs());
  const machinePrefsHydratedRef = useRef(false);
  const machinePrefsHydrationRef = useRef<Promise<MachinePrefs> | null>(null);
  const machinePrefsHydrationGenerationRef = useRef(0);
  const [midiDestinations, setMidiDestinations] = useState<MidiDestination[]>([]);
  const [midiRouteStatus, setMidiRouteStatus] = useState<MidiRouteStatus>({
    desired: null,
    connected: false,
    lastError: null,
  });
  const midiRouteDesiredRef = useRef<MidiDestination | null>(null);
  // Any picker choice or backend route event invalidates older async boot/
  // rescan responses so stale status cannot overwrite the newest route intent.
  const midiRouteIntentGenerationRef = useRef(0);
  const midiDestinationListGenerationRef = useRef(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<SetupTab>("audio");
  const [seedSetupOpen, setSeedSetupOpen] = useState(false);
  const [seedSetupTab, setSeedSetupTab] = useState<SeedDialogTab>("global");
  const [seedLogScope, setSeedLogScope] = useState<SeedLogScope>("all");
  const [seedPaths, setSeedPaths] = useState<SeedPath[]>([]);
  const [parallelProject, setParallelProject] =
    useState<ParallelProjectPatch | null>(null);
  const parallelProjectRef = useRef<ParallelProjectPatch | null>(parallelProject);
  const parallelProjectRevisionRef = useRef(0);
  parallelProjectRef.current = parallelProject;
  const [renamingParallelTrackId, setRenamingParallelTrackId] = useState<string | null>(
    null
  );
  const [pendingDeleteTrackId, setPendingDeleteTrackId] = useState<string | null>(
    null
  );
  // The Track Flow box whose transition-matrix modal is open, if any.
  const [matrixBoxId, setMatrixBoxId] = useState<string | null>(null);
  // Lane drag-and-drop: the track id being dragged, and the current drop target
  // (a box id, "" for the parallel lane, or null when not over a target).
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const pointerTrackDragRef = useRef<{
    trackId: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const pointerTrackDragCleanupRef = useRef<(() => void) | null>(null);
  const suppressTrackClickRef = useRef<string | null>(null);
  // Inline-rename state for a box header tab.
  const [renamingBoxId, setRenamingBoxId] = useState<string | null>(null);
  const [activeSeedPathId, setActiveSeedPathId] = useState<string | null>(null);
  const [queuedSeedPathId, setQueuedSeedPathId] = useState<string | null>(null);
  const activeSeedPathIdRef = useRef<string | null>(null);
  // Recording belongs to the playback session's launch track, not whichever
  // track the editor happens to show while that session is running.
  const activeSeedRecordingRef = useRef<SeedRecordingSession | null>(null);
  const [autosaveIntervalMs, setAutosaveIntervalMs] = useState(
    initialSetupPreferences.autosaveIntervalMs
  );
  const [autoloadRecentSession, setAutoloadRecentSession] = useState(
    initialSetupPreferences.autoloadRecentSession
  );
  const [pitchImportOpen, setPitchImportOpen] = useState(false);
  const [transferMatrixOpen, setTransferMatrixOpen] = useState(false);
  const [, setProbabilityOpen] = useState(false);
  const [boundariesOpen, setBoundariesOpen] = useState(false);
  const [maxSectionsHelpOpen, setMaxSectionsHelpOpen] = useState(false);
  const [midiDebugOpen, setMidiDebugOpen] = useState(false);
  const [midiDebugLimit, setMidiDebugLimit] = useState(DEFAULT_MIDI_DEBUG_LIMIT);
  // When multiple tracks are audible, optionally restrict the MIDI out debug
  // table to the active track so "what's shown vs sent" can be compared for one
  // track. Rows without a parallel track id (single-track / cleanup) always show.
  const [midiDebugActiveTrackOnly, setMidiDebugActiveTrackOnly] = useState(false);
  const [automationDebugOpen, setAutomationDebugOpen] = useState(false);
  const [parallelConflictDebugOpen, setParallelConflictDebugOpen] = useState(false);
  const [automationDebugLimit, setAutomationDebugLimit] = useState(
    DEFAULT_AUTOMATION_DEBUG_LIMIT
  );
  const [currentPatchPath, setCurrentPatchPath] = useState<string | null>(() =>
    readLastPatchPath()
  );
  const [patchPersistenceState, setPatchPersistenceState] =
    useState<PatchPersistenceState>("checking");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [lastAutosaveAt, setLastAutosaveAt] = useState<string | null>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(() =>
    initialSetupPreferences.autosaveEnabled
  );
  const tempoEditingRef = useRef(false);
  const tempoInputFollowsTransportRef = useRef(true);
  const authoredTempoBpmRef = useRef(NEUTRAL_TEMPO_BPM);
  const newPatchMenuRef = useRef<(() => Promise<void>) | null>(null);
  const savePatchMenuRef = useRef<(() => Promise<void>) | null>(null);
  const savePatchAsMenuRef = useRef<(() => Promise<void>) | null>(null);
  const loadPatchMenuRef = useRef<(() => Promise<void>) | null>(null);
  const loadRecentPatchMenuRef = useRef<(() => Promise<void>) | null>(null);
  const exportScoreMenuRef = useRef<(() => Promise<void>) | null>(null);
  const synthToggleMenuRef = useRef<(() => Promise<void>) | null>(null);
  const resetTransportSyncMenuRef = useRef<(() => Promise<void>) | null>(null);
  const midiPanicMenuRef = useRef<(() => Promise<void>) | null>(null);
  const toggleAutosaveMenuRef = useRef<(() => void) | null>(null);
  const isApplyingPatchRef = useRef(false);
  const skipNextGlobalSeedStartupPersistRef = useRef(false);
  // A view-only track hydration suppresses transport effects until the next
  // real interaction. Clearing these at gesture start gives the first edit
  // after a switch ownership immediately; a blind timeout can drop that edit.
  const suppressScoreApplyRef = useRef(false);
  const suppressPlaybackConfigApplyRef = useRef(false);
  // Async authoring (passage learn/import, extrapolation, Randomize follow-up)
  // captures this token. Direct UI interaction advances it before React's
  // semantic handler, so a backend response cannot overwrite a later edit.
  const authoringInteractionGenerationRef = useRef(0);
  // The runtime kind actually launched at Play, pinned until Stop (S5). Derived
  // from what was sent, not from live mute/solo state — so a playing parallel
  // runtime never receives a `SetScore`/`SetRhythmPlayback` that would tear it
  // down (P0.4). Live parallel editing lands in P1; until then parallel edits
  // apply at the next Play.
  const runningParallelRef = useRef(false);
  // A seed-path replay belongs to the playback session that consumed it. Keep
  // that value pinned until Stop so queueing a different take cannot rewrite a
  // live single- or multi-track runtime.
  const playbackSessionActiveRef = useRef(false);
  const activePlaybackSeedPathRef =
    useRef<ReturnType<typeof seedPathPlaybackConfig>>(null);
  const synthProgramQueueRef = useRef<LatestWinsQueue<void> | null>(null);
  if (synthProgramQueueRef.current === null) {
    synthProgramQueueRef.current = createLatestWinsQueue<void>();
  }
  const lastAppliedSynthProgramsRef = useRef("");
  const synthEnabledQueueRef = useRef<LatestWinsQueue<void> | null>(null);
  if (synthEnabledQueueRef.current === null) {
    synthEnabledQueueRef.current = createLatestWinsQueue<void>();
  }
  const lastAppliedSynthEnabledRef = useRef("");
  const tempoQueueRef = useRef<LatestWinsQueue<void> | null>(null);
  if (tempoQueueRef.current === null) {
    tempoQueueRef.current = createLatestWinsQueue<void>();
  }
  const lastAppliedTempoRef = useRef("");
  const telemetryInterestQueueRef = useRef<LatestWinsQueue<void> | null>(null);
  if (telemetryInterestQueueRef.current === null) {
    telemetryInterestQueueRef.current = createLatestWinsQueue<void>();
  }
  const lastAppliedTelemetryInterestRef = useRef("");
  // Rhythm and parallel commands mutate the same playback-config slot. One
  // shared queue prevents an older single-track write from landing after a
  // newer parallel write (or vice versa).
  const playbackConfigQueueRef = useRef<LatestWinsQueue<void> | null>(null);
  if (playbackConfigQueueRef.current === null) {
    playbackConfigQueueRef.current = createLatestWinsQueue<void>();
  }
  const lastAppliedPlaybackConfigRef = useRef("");
  const parallelBuildGenerationRef = useRef(0);
  const playbackTransitionRef = useRef<{
    generation: number;
    kind: "idle" | "starting" | "stopping";
  }>({ generation: 0, kind: "idle" });
  const synthToggleInFlightRef = useRef(false);

  const trackStructureActionIsCurrent = (startedTransitionGeneration: number) =>
    structuralTrackActionIsCurrent({
      isPlaying: snapshot?.isPlaying ?? false,
      playbackSessionActive: playbackSessionActiveRef.current,
      transitionKind: playbackTransitionRef.current.kind,
      startedTransitionGeneration,
      currentTransitionGeneration: playbackTransitionRef.current.generation,
    });

  const queueSynthPrograms = useCallback(
    (programs: SynthChannelProgram[]) =>
      ensureLatestWins(
        synthProgramQueueRef.current!,
        lastAppliedSynthProgramsRef,
        {
          key: synthProgramsWriteKey(programs),
          run: () => synthSetPrograms(programs),
        }
      ),
    []
  );
  const queueTrackPlayback = useCallback(
    (
      request: TrackPlaybackRequest,
      options: { shouldRun?: () => boolean; force?: boolean } = {}
    ) =>
      ensureLatestWins(
        playbackConfigQueueRef.current!,
        lastAppliedPlaybackConfigRef,
        {
          key: trackPlaybackWriteKey(request),
          run: () => trackSetPlayback(request),
          shouldRun: options.shouldRun,
        },
        { force: options.force }
      ),
    []
  );
  const queueSynthEnabled = useCallback(
    (enabled: boolean) =>
      ensureLatestWins(
        synthEnabledQueueRef.current!,
        lastAppliedSynthEnabledRef,
        {
          key: synthEnabledWriteKey(enabled),
          run: () => synthSetEnabled(enabled),
        },
        { force: true }
      ),
    []
  );
  const queueTempo = useCallback(
    (tempoBpm: number) =>
      ensureLatestWins(
        tempoQueueRef.current!,
        lastAppliedTempoRef,
        {
          key: tempoWriteKey(tempoBpm),
          run: () => transportSetTempo(tempoBpm),
        },
        // An explicit tempo commit intentionally reasserts transport tempo; the
        // live flux engine may have changed it since the prior commit.
        { force: true }
      ),
    []
  );
  const queueTelemetryInterest = useCallback(
    (interest: TelemetryLogInterest) =>
      ensureLatestWins(
        telemetryInterestQueueRef.current!,
        lastAppliedTelemetryInterestRef,
        {
          key: telemetryInterestWriteKey(interest),
          run: () => transportSetTelemetryInterest(interest),
        }
      ),
    []
  );
  const queueParallelPlayback = useCallback(
    (
      request: ParallelPlaybackRequest | null,
      options: { nextCycle?: boolean } = {},
      writeOptions: { shouldRun?: () => boolean; force?: boolean } = {}
    ) =>
      ensureLatestWins(
        playbackConfigQueueRef.current!,
        lastAppliedPlaybackConfigRef,
        {
          key: parallelPlaybackWriteKey(request),
          run: () => parallelSetPlayback(request, options),
          shouldRun: writeOptions.shouldRun,
        },
        { force: writeOptions.force }
      ),
    []
  );
  const invalidatePlaybackConfigIntent = useCallback(() => {
    const queue = playbackConfigQueueRef.current!;
    setLatestWinsDesired(queue, null);
    discardLatestWinsPending(queue);
  }, []);
  const buildPatchDocumentRef = useRef<(() => Promise<SequencerPatchDocument>) | null>(
    null
  );
  const currentAuthoredPatchFingerprintRef = useRef<(() => string) | null>(null);
  const manualPatchSaveQueueRef = useRef<LatestWinsQueue<void> | null>(null);
  if (manualPatchSaveQueueRef.current === null) {
    manualPatchSaveQueueRef.current = createLatestWinsQueue<void>();
  }
  const manualSaveIntentGenerationRef = useRef(0);
  const manualSaveActiveCountRef = useRef(0);
  const patchApplyGenerationRef = useRef(0);
  const patchDocumentIntentGenerationRef = useRef(0);
  const currentPatchFingerprintRef = useRef("");
  const lastSavedFingerprintRef = useRef("");
  const lastAutosavedFingerprintRef = useRef("");
  const autosaveEnabledRef = useRef(autosaveEnabled);
  const autosaveIntervalMsRef = useRef(autosaveIntervalMs);
  const autoloadRecentSessionRef = useRef(autoloadRecentSession);
  const machinePrefsEditGenerationRef = useRef(0);
  const machinePrefsEditedFieldsRef = useRef({
    autosaveEnabled: false,
    autosaveIntervalMs: false,
    autoloadRecentSession: false,
  });
  const autosaveInFlightRef = useRef(false);
  const autosaveBuildInFlightRef = useRef(false);
  const autosaveGenerationRef = useRef(0);
  const hasAttemptedSessionRestoreRef = useRef(false);
  const startupRestoreUserInteractedRef = useRef(false);
  const startupRestoreInteractionCleanupRef = useRef<(() => void) | null>(null);
  const previousSessionInterruptedRef = useRef(readPreviousSessionInterrupted());
  const initialGlobalSeedLockRef = useRef<GlobalSeedStartupLock | null>(null);
  if (initialGlobalSeedLockRef.current === null) {
    initialGlobalSeedLockRef.current = readGlobalSeedStartupLock();
  }
  const markPatchDirty = () => {
    currentPatchFingerprintRef.current = DIRTY_PATCH_FINGERPRINT;
    setPatchPersistenceState("unsaved");
  };

  const [name, setName] = useState(NEUTRAL_SCORE_NAME);
  const [cycleBeats, setCycleBeats] = useState(NEUTRAL_CYCLE_BEATS);
  const [initialWeights, setInitialWeights] = useState<SubdivisionWeight[]>(
    () => cloneWeights(NEUTRAL_INITIAL_WEIGHTS)
  );
  const [initialJathiWeights, setInitialJathiWeights] = useState<JathiWeight[]>(
    () => cloneJathiWeights(NEUTRAL_JATHI_WEIGHTS)
  );
  const [initialJathiBhedam, setInitialJathiBhedam] =
    useState<JathiBhedamSelection | null>(null);
  const [initialCustomSubdivision, setInitialCustomSubdivision] =
    useState<CustomSubdivision | null>(null);
  const [boundaries, setBoundaries] = useState<BoundaryPoint[]>([]);
  const [selectedBoundaryAfterBeat, setSelectedBoundaryAfterBeat] =
    useState<number | null>(null);
  const [sectionInspectorKey, setSectionInspectorKey] =
    useState<SectionInspectorEntry["key"]>("initial");
  const [sectionCountWeights, setSectionCountWeights] =
    useState<SwitchCountWeight[]>(() =>
      NEUTRAL_SECTION_COUNTS.map((w) => ({ ...w }))
    );
  const [seedMode, setSeedMode] = useState<SeedModeName>("perCycle");
  const [globalSeedStartupLocked, setGlobalSeedStartupLocked] = useState(
    () => initialGlobalSeedLockRef.current?.locked ?? false
  );
  const [seed, setSeed] = useState(
    () => initialGlobalSeedLockRef.current?.seed ?? datetimeSeed()
  );
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [evolveOpen, setEvolveOpen] = useState(false);
  const [generatorEnabled, setGeneratorEnabled] = useState(true);
  const [generatorKind, setGeneratorKind] =
    useState<GeneratorConfig["kind"]>("example");
  const [dumkaPattern, setDumkaPattern] = useState(DEFAULT_DUMKA_PATTERN);
  const [dumkaEvolutionRate, setDumkaEvolutionRate] = useState(0);
  const [dumkaDriftLeash, setDumkaDriftLeash] = useState(25);
  const [dumkaDensityFloor, setDumkaDensityFloor] = useState(0);
  const [dumkaDensityCeiling, setDumkaDensityCeiling] = useState(100);
  const [dumkaBarlowTemperature, setDumkaBarlowTemperature] = useState(0);
  const [dumkaFillComplexity, setDumkaFillComplexity] = useState(0);
  const [dumkaEuclidMaxRun, setDumkaEuclidMaxRun] = useState(1);
  const [dumkaEuclidInvert, setDumkaEuclidInvert] = useState(0);
  const [dumkaEuclidRestPolicy, setDumkaEuclidRestPolicy] = useState<
    "silent" | "tied"
  >("tied");
  const [dumkaOpWeights, setDumkaOpWeights] = useState<DumkaOpWeights>(
    () => ({ ...DEFAULT_DUMKA_OP_WEIGHTS })
  );
  const [dumkaPlan, setDumkaPlan] = useState<EvolutionDirective[]>([]);
  const [dumkaPlanLengthCycles, setDumkaPlanLengthCycles] = useState(0);
  const [generatorDensityPercent, setGeneratorDensityPercent] = useState(100);
  const [generatorSeedMode, setGeneratorSeedMode] =
    useState<GeneratorConfig["seedMode"]["type"]>("locked");
  const [generatorSeed, setGeneratorSeed] = useState(seed);
  const [historySeedsInput, setHistorySeedsInput] = useState("");
  const [historyWeight, setHistoryWeight] = useState(1);
  const [newSeedWeight, setNewSeedWeight] = useState(1);
  const [maxHistory, setMaxHistory] = useState(8);
  const [newSeedChance, setNewSeedChance] = useState(DEFAULT_NEW_SEED_CHANCE);
  const [holdChance, setHoldChance] = useState(DEFAULT_HOLD_CHANCE);
  const [blendCycles, setBlendCycles] = useState(DEFAULT_BLEND_CYCLES);
  const [
    singleParameterRhythmicModulation,
    setSingleParameterRhythmicModulation,
  ] = useState(false);
  const [pitch, setPitch] = useState(NEUTRAL_PITCH);
  const useChannelShaperStateResult = useChannelShaperState({
    boundaries,
    cycleBeats,
    generatorDensityPercent,
    dumkaEvolutionRate,
    dumkaDriftLeash,
    dumkaDensityFloor,
    dumkaDensityCeiling,
    dumkaBarlowTemperature,
    dumkaFillComplexity,
    blendCycles,
    historySeedsInput,
    historyWeight,
    holdChance,
    initialJathiWeights,
    initialWeights,
    maxHistory,
    newSeedChance,
    newSeedWeight,
    parallelProject,
    pitch,
    sectionCountWeights,
    seed,
    seedMode,
    setBoundaries,
    setBoundariesOpen,
    setGeneratorOpen,
    setInitialCustomSubdivision,
    setInitialJathiBhedam,
    setInitialJathiWeights,
    setInitialWeights,
    setPatchStatus,
    setProbabilityOpen,
    setSectionCountWeights,
    setSeedLogScope,
    setSeedSetupOpen,
    setSeedSetupTab,
    singleParameterRhythmicModulation,
    snapshot,
    synthEnabled,
    synthPrograms,
    tempoInput,
    transportTransitionActive: playbackTransitionKind !== "idle",
  });
  const {
    activeParallelTrackId,
    automatedTargetIds,
    automationFocusPanel,
    automationPickMode,
    automationSet,
    automationTargetDefs,
    beatAccentMax,
    beatAccentMin,
    channelAccentRules,
    channelPositionRules,
    channelHocketChannels,
    activeChannelAccentRuleCount,
    channelHocketEnabled,
    channelHocketEntryWeights,
    channelHocketFallback,
    channelHocketFallbackWeights,
    channelHocketHistorySeeds,
    channelHocketAssignMode,
    channelHocketEuclid,
    channelHocketHistorySeedsInput,
    channelHocketHistoryWeight,
    channelHocketBlendCycles,
    channelHocketHoldChance,
    channelHocketMatrixChannels,
    channelHocketMaxHistory,
    channelHocketNewSeedChance,
    channelHocketNewSeedWeight,
    channelHocketOpen,
    channelHocketOrder,
    channelHocketSeed,
    channelHocketSeedBehavior,
    channelHocketWeights,
    currentTempoBpm,
    globalHistorySeeds,
    globalSeedMode,
    jathiAccentMax,
    jathiAccentMin,
    jathiAccentMode,
    midiOutputChannel,
    openSeedSetup,
    parallelTrackTabs,
    playbackStructureLocked,
    renderAutomationControlLabel,
    renderAutomationFocusButton,
    sectionAccentMax,
    sectionAccentMin,
    setAutomationFocusPanel,
    setAutomationPickMode,
    setAutomationSet,
    setBeatAccentMax,
    setBeatAccentMin,
    setChannelAccentRules,
    setChannelPositionRules,
    setChannelHocketChannels,
    setChannelHocketEnabled,
    setChannelHocketEntryWeights,
    setChannelHocketFallback,
    setChannelHocketFallbackWeights,
    setChannelHocketHistorySeedsInput,
    setChannelHocketHistoryWeight,
    setChannelHocketAssignMode,
    setChannelHocketEuclid,
    setChannelHocketBlendCycles,
    setChannelHocketHoldChance,
    setChannelHocketMaxHistory,
    setChannelHocketNewSeedChance,
    setChannelHocketNewSeedWeight,
    setChannelHocketOpen,
    setChannelHocketOrder,
    setChannelHocketSeed,
    setChannelHocketSeedBehavior,
    setChannelHocketWeights,
    setJathiAccentMax,
    setJathiAccentMin,
    setJathiAccentMode,
    setMainEditorOpen: setLegacyMainEditorOpen,
    setMidiOutputChannel,
    setSectionAccentMax,
    setSectionAccentMin,
    setVelocity,
    tempoBpmForAutomation,
    transportIsPlaying,
    velocity,
  } = useChannelShaperStateResult;
  const setMainEditorOpen = (id: MainEditorId | null) => {
    setEvolveOpen(id === "evolve");
    setLegacyMainEditorOpen(id === "evolve" ? null : id);
  };
  const rhythmPlaybackEnabled = generatorEnabled;
  const generatorConfigSeedMode = useMemo(
    () =>
      generatorSeedModeFromGlobalSettings(
      generatorSeedMode,
      generatorSeed,
      globalHistorySeeds,
      historyWeight,
      newSeedWeight,
      maxHistory
    ),
    [
      generatorSeedMode,
      generatorSeed,
      globalHistorySeeds,
      historyWeight,
      newSeedWeight,
      maxHistory,
    ]
  );
  const generatorRuntimeConfig = useMemo<GeneratorConfig>(() => {
    return generatorKind === "dumka"
      ? {
          kind: "dumka",
          pattern: dumkaPattern,
          evolutionRate: dumkaEvolutionRate,
          driftLeash: dumkaDriftLeash,
          densityFloor: dumkaDensityFloor,
          densityCeiling: dumkaDensityCeiling,
          barlowTemperature: dumkaBarlowTemperature,
          weightBarlowRemove: dumkaOpWeights.barlowRemove,
          weightBarlowAdd: dumkaOpWeights.barlowAdd,
          weightRotate: dumkaOpWeights.rotate,
          weightSyncopate: dumkaOpWeights.syncopate,
          weightDesyncopate: dumkaOpWeights.desyncopate,
          weightFragment: dumkaOpWeights.fragment,
          weightConsolidate: dumkaOpWeights.consolidate,
          fillComplexity: dumkaFillComplexity,
          weightEuclid: dumkaOpWeights.euclid,
          euclidMaxRun: dumkaEuclidMaxRun,
          euclidInvert: dumkaEuclidInvert,
          euclidRestPolicy: dumkaEuclidRestPolicy,
          plan: dumkaPlan,
          // This is editor canvas state, not an engine input. Runtime requests
          // use a canonical value so resizing the score view cannot wake
          // preview or playback effects.
          planLengthCycles: 0,
          seedMode: generatorConfigSeedMode,
        }
      : {
          kind: "example",
          densityPercent: generatorDensityPercent,
          seedMode: generatorConfigSeedMode,
        };
  }, [
    dumkaBarlowTemperature,
    dumkaDriftLeash,
    dumkaDensityFloor,
    dumkaDensityCeiling,
    dumkaEuclidInvert,
    dumkaEuclidMaxRun,
    dumkaEuclidRestPolicy,
    dumkaFillComplexity,
    dumkaEvolutionRate,
    dumkaOpWeights,
    dumkaPlan,
    dumkaPattern,
    generatorDensityPercent,
    generatorKind,
    generatorConfigSeedMode,
  ]);
  const generatorConfig = useMemo<GeneratorConfig>(
    () =>
      generatorRuntimeConfig.kind === "dumka"
        ? {
            ...generatorRuntimeConfig,
            planLengthCycles: dumkaPlanLengthCycles,
          }
        : generatorRuntimeConfig,
    [dumkaPlanLengthCycles, generatorRuntimeConfig]
  );
  const dumkaAnalysis = useMemo(
    () => analyzeDumkaPattern(dumkaPattern),
    [dumkaPattern]
  );
  const dumkaRequired = dumkaAnalysis.ok ? dumkaAnalysis.required : null;
  const dumkaStructureReady = useMemo(
    () =>
      dumkaRequired !== null &&
      dumkaStructureMatches(dumkaRequired, {
        cycleBeats,
        initialWeights,
        initialJathiWeights,
        boundaryCount: boundaries.length,
        hasCustomSubdivision: initialCustomSubdivision !== null,
      }),
    [
      boundaries.length,
      cycleBeats,
      dumkaRequired,
      initialCustomSubdivision,
      initialJathiWeights,
      initialWeights,
    ]
  );
  const dumkaAuthoredSubdivision =
    initialWeights.length === 1 && boundaries.length === 0
      ? (initialWeights[0]?.subdivision ?? null)
      : null;
  const handleApplyDumkaStructure = useCallback(() => {
    if (!dumkaRequired) {
      return;
    }
    setCycleBeats(dumkaRequired.cycleBeats);
    setInitialWeights([{ subdivision: dumkaRequired.subdivision, weight: 1 }]);
    setInitialJathiWeights([]);
    setInitialCustomSubdivision(null);
    setBoundaries([]);
    setSelectedBoundaryAfterBeat(null);
  }, [dumkaRequired]);
  const [userPreviewCycle, setUserPreviewCycle] = useState(0);
  const [timelineAutomationPickerOpen, setTimelineAutomationPickerOpen] =
    useState(false);
  const [timelineAutomationTargetIds, setTimelineAutomationTargetIds] = useState<
    string[]
  >([]);
  const timelineAutomationPickerRef = useRef<HTMLDivElement | null>(null);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [automationTargetGroupFilter, setAutomationTargetGroupFilter] =
    useState("all");
  const [automationTargetKindFilter, setAutomationTargetKindFilter] =
    useState<AutomationValueKind | "all">("all");
  const [selectedAutomationTrackId, setSelectedAutomationTrackId] = useState<
    string | null
  >(null);
  const [selectedAutomationCurveId, setSelectedAutomationCurveId] = useState<
    string | null
  >(null);
  const [selectedAutomationPointId, setSelectedAutomationPointId] = useState<
    string | null
  >(null);
  const [selectedAutomationSegmentPointId, setSelectedAutomationSegmentPointId] =
    useState<string | null>(null);
  const [automationMarkerPhaseInput, setAutomationMarkerPhaseInput] = useState(50);
  const [preview, setPreview] = useState<SubdivisionSwitchPreview | null>(null);
  const [previewRequestKey, setPreviewRequestKey] = useState("");
  // Preview transport and explicit editor actions have independent ownership.
  // A late preview must never clear or replace an import/extrapolation error.
  const [rhythmPreviewFailure, setRhythmPreviewFailure] =
    useState<GeneratorPreviewFailure | null>(null);
  const [previewCache, setPreviewCache] = useState<
    Map<number, CachedCycleValue<SubdivisionSwitchPreview>>
  >(() => new Map());
  const [evolvePreviewCache, setEvolvePreviewCache] = useState<
    Map<number, CachedCycleValue<GeneratorPreview>>
  >(() => new Map());
  const [evolveVisibleCycleRange, setEvolveVisibleCycleRange] = useState({
    fromCycle: 0,
    toCycle: 16,
  });
  const {
    activeAutomationSet,
    activeProjectTrackForAutomation,
    displayedCycle,
    effectivePreviewCycle,
    generatorBySpanId: rhythmBySpanId,
    generatorPreviewRequestKey: rhythmPreviewRequestKey,
    generatorResultCache: rhythmResultCache,
    generatorResult: timelineRhythmResult,
    exactTimelineGeneratorResult,
    exactTimelinePreview,
    generatorTrackId: activeGeneratorTrackId,
    liveParallelTrackPosition,
    previewRequestCacheKey,
    setGeneratorResult: setRhythmResult,
    setGeneratorResultCache: setRhythmResultCache,
    setGeneratorResultCycle: setRhythmResultCycle,
    setGeneratorResultRequestKey: setRhythmResultRequestKey,
    switchRequest,
    switchRequestKey,
    timelineLayoutCycle,
    timelinePreview,
    timelineRenderLayers,
  } = useSequencerPreviewState({
    automationSet,
    beatAccentMax,
    beatAccentMin,
    boundaries,
    cycleBeats,
    generatorConfig: generatorRuntimeConfig,
    generatorEnabled: rhythmPlaybackEnabled,
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
    parallelRuntimeActive: runningParallelRef.current,
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
  });
  const latestSwitchRequestRef = useRef(switchRequest);
  latestSwitchRequestRef.current = switchRequest;
  const [channelLogicHelpOpen, setChannelLogicHelpOpen] = useState(false);
  const lastAppliedRequestRef = useRef("");
  const scoreApplyQueueRef = useRef<LatestWinsQueue<void> | null>(null);
  if (scoreApplyQueueRef.current === null) {
    scoreApplyQueueRef.current = createLatestWinsQueue<void>();
  }
  const randomizeGenerationRef = useRef(0);
  const trackSelectionGenerationRef = useRef(0);
  // Telemetry position refs. The playhead and visual-transport rAF loops read
  // `livePositionRef` (one atomic {position, receivedAt} object — never split
  // refs). `pendingPositionRef` buffers a position whose `timelineEpoch` is
  // ahead of the promoted timeline grid until the matching timeline snapshot
  // lands. `promotedTimelineEpochRef` is the epoch of the grid currently in
  // React state, used to gate incoming positions.
  const livePositionRef = useRef<LivePositionSample | null>(null);
  const pendingPositionRef = useRef<LivePositionSample | null>(null);
  const pendingPositionSinceRef = useRef(0);
  const timelineResyncInFlightRef = useRef(false);
  const promotedTimelineEpochRef = useRef(0);
  const visualTransportRef = useRef({ currentTick: 0, currentCycle: 0 });
  const subdivisionPreviewRequestsRef = useRef(
    new Map<string, ReturnType<typeof scorePreviewSubdivisionSwitch>>()
  );
  const generatorPreviewRequestsRef = useRef(
    new Map<string, Promise<GeneratorPreview>>()
  );
  const lastReadyTimelinePreviewRef = useRef<SubdivisionSwitchPreview | null>(null);
  const lastCoherentTimelineLayerModelRef =
    useRef<TimelineLayerRenderModel | null>(null);

  const timelinePreviewDebounceMs = transportIsPlaying ? 16 : 120;
  const activeTrackUsesCustomTempo =
    parallelProject !== null && activeProjectTrackForAutomation?.tempoMode === "custom";
  // Keep the snapshot-follow guard synchronous with render. The transport
  // snapshot listener (registered once) reads this ref from an async Tauri
  // event that can fire mid-transition, so deferring the write to an effect
  // leaves a window where a global/reference snapshot tempo overwrites a
  // track-local custom BPM. When the active track owns a custom tempo, the
  // Global/reference BPM in the snapshot must never clobber the track field.
  tempoInputFollowsTransportRef.current = !activeTrackUsesCustomTempo;
  const activeAutomationTracks = activeAutomationSet?.tracks ?? EMPTY_AUTOMATION_TRACKS;

  useEffect(() => {
    // tempoInputFollowsTransportRef is assigned synchronously at render time
    // (see above) so async transport snapshots always observe the current
    // value. Here we only resync the visible track field to the stored custom
    // BPM when the active track owns a custom tempo and the user is not editing.
    if (
      activeTrackUsesCustomTempo &&
      activeProjectTrackForAutomation &&
      !tempoEditingRef.current
    ) {
      setTempoInput(activeProjectTrackForAutomation.customTempoBpm.toFixed(1));
    }
  }, [
    activeProjectTrackForAutomation?.customTempoBpm,
    activeProjectTrackForAutomation?.id,
    activeTrackUsesCustomTempo,
  ]);

  const enabledTimelineAutomationTracks = useMemo(
    () => activeAutomationTracks.filter((track) => track.enabled),
    [activeAutomationTracks]
  );
  const timelineAutomationTrackOptions = useMemo(
    () =>
      enabledTimelineAutomationTracks
        .map((track) => ({
          track,
          def: automationTargetDef(track.target, automationTargetDefs),
        }))
        .sort((a, b) => automationTargetSort(a.def, b.def)),
    [automationTargetDefs, enabledTimelineAutomationTracks]
  );
  const timelineAutomationTargetOrder = useMemo(
    () =>
      new Map(
        timelineAutomationTrackOptions.map(({ track }, index) => [track.target, index])
      ),
    [timelineAutomationTrackOptions]
  );
  const visibleTimelineAutomationTracks = useMemo(
    () =>
      selectTimelineAutomationTracks(
        timelineAutomationTrackOptions.map(({ track }) => track),
        timelineAutomationTargetIds
      ),
    [timelineAutomationTargetIds, timelineAutomationTrackOptions]
  );
  const visibleTimelineAutomationTargetIds = useMemo(
    () => new Set(visibleTimelineAutomationTracks.map((track) => track.target)),
    [visibleTimelineAutomationTracks]
  );
  const automationTargetGroups = useMemo(
    () => automationTargetGroupsFor(automationTargetDefs),
    [automationTargetDefs]
  );
  const automationTargetKinds: Array<AutomationValueKind | "all"> = [
    "all",
    "boolean",
    "integer",
    "float",
    "weight",
  ];
  const toggleTimelineAutomationTarget = (target: string, shouldShow: boolean) => {
    setTimelineAutomationTargetIds((current) => {
      const nextTargets = new Set(current);
      if (shouldShow) {
        nextTargets.add(target);
      } else {
        nextTargets.delete(target);
      }
      const orderedTargets = Array.from(nextTargets).sort(
        (a, b) =>
          (timelineAutomationTargetOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (timelineAutomationTargetOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
      );
      return pruneTimelineAutomationTargetIds(orderedTargets, activeAutomationTracks);
    });
  };

  const selectedAutomationFocusTargets = useMemo(
    () =>
      automationFocusPanel
        ? automationFocusPanel.targetIds.map((target) =>
            automationTargetDef(target, automationTargetDefs)
          )
        : [],
    [automationFocusPanel, automationTargetDefs]
  );

  useEffect(() => {
    setTimelineAutomationTargetIds((current) => {
      const next = pruneTimelineAutomationTargetIds(current, activeAutomationTracks);
      if (
        next.length === current.length &&
        next.every((target, index) => target === current[index])
      ) {
        return current;
      }
      return next;
    });
  }, [activeAutomationTracks]);

  useEffect(() => {
    if (timelineAutomationTrackOptions.length > 0) return;
    setTimelineAutomationPickerOpen(false);
  }, [timelineAutomationTrackOptions.length]);

  useEffect(() => {
    if (!timelineAutomationPickerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTimelineAutomationPickerOpen(false);
      }
    };
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const picker = timelineAutomationPickerRef.current;
      if (picker?.contains(event.target as Node)) return;
      setTimelineAutomationPickerOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [timelineAutomationPickerOpen]);

  useEffect(() => {
    if (!automationFocusPanel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAutomationFocusPanel(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [automationFocusPanel]);

  useEffect(() => {
    if (!automationOpen || automationFocusPanel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAutomationOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [automationFocusPanel, automationOpen]);

  useEffect(() => {
    if (!pitchImportOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPitchImportOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pitchImportOpen]);

  useEffect(() => {
    if (!transferMatrixOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTransferMatrixOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [transferMatrixOpen]);

  useEffect(() => {
    setSelectedAutomationTrackId((current) => {
      if (current && automationSet.tracks.some((track) => track.id === current)) {
        return current;
      }
      return automationSet.tracks[0]?.id ?? null;
    });
  }, [automationSet.tracks]);

  const selectedAutomationTrack =
    automationSet.tracks.find((track) => track.id === selectedAutomationTrackId) ??
    automationSet.tracks[0] ??
    null;
  const selectedAutomationDef = selectedAutomationTrack
    ? automationTargetDef(selectedAutomationTrack.target, automationTargetDefs)
    : null;
  const selectedAutomationAxisRange =
    selectedAutomationTrack && selectedAutomationDef
      ? automationGraphAxisRange(selectedAutomationTrack, selectedAutomationDef)
      : null;

  useEffect(() => {
    setSelectedAutomationCurveId((current) => {
      const track =
        automationSet.tracks.find((item) => item.id === selectedAutomationTrackId) ??
        automationSet.tracks[0] ??
        null;
      if (!track) return null;
      if (current && track.curves.some((curve) => curve.id === current)) {
        return current;
      }
      return track.curves[0]?.id ?? null;
    });
  }, [automationSet.tracks, selectedAutomationTrackId]);

  const selectedAutomationCurve =
    selectedAutomationTrack?.curves.find(
      (curve) => curve.id === selectedAutomationCurveId
    ) ??
    selectedAutomationTrack?.curves[0] ??
    null;
  // Effective (marker-aware) order so the list numbering matches the graph and
  // the backend's sampling order — an anchored point lives where its marker is.
  const selectedAutomationPoints = useMemo(
    () =>
      sortAutomationPointsByEffectiveTime(
        selectedAutomationCurve?.points ?? [],
        automationSet.markers
      ),
    [selectedAutomationCurve, automationSet.markers]
  );

  useEffect(() => {
    setSelectedAutomationPointId((current) => {
      if (current && selectedAutomationPoints.some((point) => point.id === current)) {
        return current;
      }
      return selectedAutomationPoints[0]?.id ?? null;
    });
    setSelectedAutomationSegmentPointId((current) => {
      const selectable = selectedAutomationPoints.slice(0, -1);
      if (current && selectable.some((point) => point.id === current)) {
        return current;
      }
      return selectable[0]?.id ?? null;
    });
  }, [selectedAutomationPoints]);

  const selectedAutomationPoint =
    selectedAutomationPoints.find((point) => point.id === selectedAutomationPointId) ??
    selectedAutomationPoints[0] ??
    null;
  const selectedAutomationSegmentPoint =
    selectedAutomationPoints.find(
      (point) => point.id === selectedAutomationSegmentPointId
    ) ??
    selectedAutomationPoint ??
    null;
  const selectedAutomationSegmentIndex = selectedAutomationSegmentPoint
    ? selectedAutomationPoints.findIndex(
        (point) => point.id === selectedAutomationSegmentPoint.id
      )
    : -1;
  const selectedAutomationSegmentCurve =
    selectedAutomationSegmentIndex >= 0 &&
    selectedAutomationSegmentIndex < selectedAutomationPoints.length - 1 &&
    selectedAutomationSegmentPoint
      ? automationSegmentCurveForPoint(selectedAutomationSegmentPoint)
      : null;

  // Update the visible tempo field from a transport-sourced BPM, respecting the
  // edit guard and the custom-track-tempo follow guard.
  const followTransportTempo = (bpm: number, isPlaying: boolean) => {
    const tempoWritePending =
      tempoQueueRef.current?.inFlightKey !== null ||
      tempoQueueRef.current?.pending !== null;
    const mode = transportTempoFollowMode({
      isPlaying,
      transitionKind: playbackTransitionRef.current.kind,
      applyingPatch: isApplyingPatchRef.current,
      tempoWritePending,
      followsTransport: tempoInputFollowsTransportRef.current,
    });
    if (mode === "ignore") return;
    if (mode === "adopt") {
      authoredTempoBpmRef.current = clamp(bpm, 20, 400);
    }
    if (!tempoEditingRef.current) {
      setTempoInput(bpm.toFixed(1));
    }
  };

  // Merge incoming seed-trace events into the active seed path (recording only).
  const accumulateSeedTraces = (events: TransportSnapshot["seedTraceEvents"]) => {
    const session = activeSeedRecordingRef.current;
    if (!session || events.length === 0) return;
    const next = appendSeedRecordingEvents(
      session,
      events,
      new Date().toISOString()
    );
    if (next === session) return;
    activeSeedRecordingRef.current = next;
    // Update the visible list only when it is the owner's list. While another
    // track is shown, the session ref keeps recording without contaminating
    // that track or rerendering its editor for every seed event.
    setSeedPaths((current) => {
      if (!current.some((path) => path.id === session.path.id)) return current;
      return upsertSeedPath(current, next.path);
    });
  };

  const readGateState = (): PositionGateState => ({
    promotedTimelineEpoch: promotedTimelineEpochRef.current,
    live: livePositionRef.current,
    pending: pendingPositionRef.current,
    pendingSince: pendingPositionSinceRef.current,
  });

  const writeGateState = (next: PositionGateState) => {
    promotedTimelineEpochRef.current = next.promotedTimelineEpoch;
    livePositionRef.current = next.live;
    pendingPositionRef.current = next.pending;
    pendingPositionSinceRef.current = next.pendingSince;
  };

  // Apply a high-frequency position, gated by timeline epoch (see redesign):
  // older grid → drop; same grid → apply; newer grid → buffer until the
  // matching timeline snapshot promotes.
  const applyTransportPosition = (position: TransportPosition, receivedAt: number) => {
    writeGateState(gatePosition(readGateState(), position, receivedAt));
  };

  const positionFromTimeline = (
    s: TransportTimelineSnapshot | TransportSnapshot
  ): TransportPosition => ({
    sampleEpoch: s.sampleEpoch,
    timelineEpoch: s.timelineEpoch,
    tempoBpm: s.tempoBpm,
    isPlaying: s.isPlaying,
    currentTick: s.currentTick,
    currentCycle: s.currentCycle,
    ticksPerCycle: s.ticksPerCycle,
    currentScoreId: s.currentScoreId,
    parallelTrackPositions: s.parallelTrackPositions,
  });

  // Promote a timeline snapshot: it owns the render layers + scalar clock, and
  // re-anchors the playhead. If a buffered position already matches this epoch,
  // apply it immediately so the playhead doesn't wait for the next position.
  const promoteTimelineSnapshot = (
    s: TransportTimelineSnapshot,
    receivedAt: number
  ) => {
    setSnapshot((prev) =>
      prev
        ? {
            ...prev,
            sampleEpoch: s.sampleEpoch,
            timelineEpoch: s.timelineEpoch,
            tempoBpm: s.tempoBpm,
            isPlaying: s.isPlaying,
            currentTick: s.currentTick,
            currentCycle: s.currentCycle,
            ticksPerCycle: s.ticksPerCycle,
            currentScoreId: s.currentScoreId,
            parallelTrackPositions: s.parallelTrackPositions,
            channelHocketEvents: s.channelHocketEvents,
            realizedRhythmEvents: s.realizedRhythmEvents,
            trackFlowEvents: s.trackFlowEvents,
          }
        : prev
    );
    writeGateState(
      promoteTimeline(readGateState(), s.timelineEpoch, {
        position: positionFromTimeline(s),
        receivedAt,
      })
    );
    followTransportTempo(s.tempoBpm, s.isPlaying);
  };

  // Promote a log snapshot: it owns the rolling diagnostic layers + seed
  // traces. It must never touch the playhead or timeline render layers.
  const promoteLogSnapshot = (s: TransportLogSnapshot) => {
    const requested = telemetryLogLayersForInterest(s.logInterest);

    // Trigger inspection needs its decision rows in App state, but must not
    // copy high-rate MIDI/automation logs. The payload carries its own scope so
    // an in-flight narrow snapshot cannot be mistaken for a full one while the
    // frontend changes subscriptions.
    if (
      requested.fullDiagnostics ||
      requested.seedTrace ||
      requested.triggerDecision
    ) {
      setSnapshot((prev) => {
        if (!prev) return prev;
        const promoted = {
          ...prev,
          sampleEpoch: s.sampleEpoch,
          logEpoch: s.logEpoch,
          ...(requested.seedTrace
            ? { seedTraceEvents: s.seedTraceEvents }
            : {}),
          ...(requested.triggerDecision
            ? { triggerDecisionEvents: s.triggerDecisionEvents }
            : {}),
        };
        return requested.fullDiagnostics
          ? {
              ...promoted,
              midiDebugEvents: s.midiDebugEvents,
              automationEvents: s.automationEvents,
              parallelConflictEvents: s.parallelConflictEvents,
            }
          : promoted;
      });
    }
    if (requested.seedTrace) {
      accumulateSeedTraces(s.seedTraceEvents);
    }
  };

  // Initial hydrate (and forced resync): the full snapshot seeds every layer,
  // the promoted timeline epoch, and the playhead anchor in one shot.
  const acceptTransportSnapshot = (full: TransportSnapshot) => {
    const now = performance.now();
    promotedTimelineEpochRef.current = full.timelineEpoch;
    setSnapshot(full);
    livePositionRef.current = { position: positionFromTimeline(full), receivedAt: now };
    pendingPositionRef.current = null;
    pendingPositionSinceRef.current = 0;
    const nextVisualTransport = {
      currentTick: full.currentTick,
      currentCycle: full.currentCycle,
    };
    visualTransportRef.current = nextVisualTransport;
    setVisualTransport(nextVisualTransport);
    accumulateSeedTraces(full.seedTraceEvents);
  };

  useEffect(() => {
    activeSeedPathIdRef.current = activeSeedPathId;
  }, [activeSeedPathId]);

  useEffect(() => {
    let unlistenPosition: (() => void) | undefined;
    let unlistenTimeline: (() => void) | undefined;
    let unlistenLog: (() => void) | undefined;

    (async () => {
      try {
        const initial = await transportGetSnapshot();
        acceptTransportSnapshot(initial);
        followTransportTempo(initial.tempoBpm, initial.isPlaying);
      } catch (e) {
        setError(String(e));
      }

      // Timeline and log listeners are registered before the position listener
      // so a promotion can never be missed by an in-flight position.
      unlistenTimeline = await onTransportTimelineSnapshot((s) => {
        promoteTimelineSnapshot(s, performance.now());
      });
      unlistenLog = await onTransportLogSnapshot((s) => {
        promoteLogSnapshot(s);
      });
      unlistenPosition = await onTransportPosition((p) => {
        applyTransportPosition(p, performance.now());
      });
    })();

    return () => {
      unlistenPosition?.();
      unlistenTimeline?.();
      unlistenLog?.();
    };
  }, []);

  // Declare log-layer interest to the backend so `transport_log_snapshot` is
  // only emitted when a consumer is actually showing it: the MIDI/automation
  // debug panels, active seed-path recording, or any parallel-project trigger/
  // conflict diagnostics. Sparse seed and trigger consumers remain independent;
  // every mode change forces one appropriately scoped hydrating log snapshot.
  const triggerInspectorVisible = Boolean(
    parallelProject?.tracks.find(
      (track) => track.id === parallelProject.activeTrackId
    )?.trigger
  );
  const telemetryLogsInterest = telemetryLogInterestRequested({
    midiDebugOpen,
    automationDebugOpen,
    parallelConflictDebugOpen,
    seedPathRecording: activeSeedPathId !== null,
    triggerInspectorVisible,
  });

  useEffect(() => {
    void queueTelemetryInterest(telemetryLogsInterest).then((outcome) => {
      if (outcome.status === "error") {
        setError(String(outcome.error));
      }
    });
  }, [queueTelemetryInterest, telemetryLogsInterest]);

  useEffect(() => {
    let animationFrame = 0;

    const updateVisualTransport = () => {
      const live = livePositionRef.current;

      if (live && live.position.ticksPerCycle > 0) {
        const pos = live.position;
        let nextTick = pos.currentTick;
        let nextCycle = pos.currentCycle;

        if (pos.isPlaying) {
          const elapsedMs =
            performance.now() - live.receivedAt + PLAYHEAD_LATENCY_COMPENSATION_MS;
          const ticksPerMs = ((pos.tempoBpm / 60) * TRANSPORT_PPQN) / 1000;
          const rawTick = pos.currentTick + Math.max(0, elapsedMs) * ticksPerMs;
          const cycleAdvance = Math.floor(rawTick / pos.ticksPerCycle);
          nextTick = rawTick % pos.ticksPerCycle;
          nextCycle = pos.currentCycle + cycleAdvance;
        }

        const previous = visualTransportRef.current;
        const nextVisualTransport = {
          currentTick: nextTick,
          currentCycle: nextCycle,
        };
        if (
          visualTransportNeedsPublish(
            previous,
            nextVisualTransport,
            pos.isPlaying
          )
        ) {
          visualTransportRef.current = nextVisualTransport;
          setVisualTransport(nextVisualTransport);
        }
      }

      // Recovery: if a too-new position has been buffered for >100ms (a timeline
      // snapshot was dropped or badly delayed), force one resync so the playhead
      // can't stay frozen. Fire at most once per stall.
      const pendingSince = pendingPositionSinceRef.current;
      if (
        pendingSince > 0 &&
        performance.now() - pendingSince > 100 &&
        !timelineResyncInFlightRef.current
      ) {
        timelineResyncInFlightRef.current = true;
        transportGetSnapshot()
          .then((s) => {
            acceptTransportSnapshot(s);
            followTransportTempo(s.tempoBpm, s.isPlaying);
          })
          .catch(() => {})
          .finally(() => {
            timelineResyncInFlightRef.current = false;
          });
      }

      animationFrame = requestAnimationFrame(updateVisualTransport);
    };

    animationFrame = requestAnimationFrame(updateVisualTransport);

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  const requestSubdivisionPreview = (
    data: SwitchRequestData,
    tempoBpm: number,
    cycle: number,
    requestKey: string
  ) =>
    coalesceInFlightRequest(
      subdivisionPreviewRequestsRef.current,
      `${requestKey}:${cycle}`,
      () =>
        scorePreviewSubdivisionSwitch(
          data.name,
          data.cycleBeats,
          data.initialWeights,
          data.initialJathiWeights,
          data.initialJathiBhedam ?? null,
          data.initialCustomSubdivision,
          data.speedSubdivision,
          data.automation,
          data.inflections,
          data.switchCountWeights,
          data.seedMode,
          data.seed,
          data.historySeeds,
          data.historyWeight,
          data.newSeedWeight,
          data.maxHistory,
          data.newSeedChance,
          data.holdChance,
          data.blendCycles,
          data.singleParameterRhythmicModulation,
          data.accent,
          data.pitch,
          data.velocity,
          tempoBpm,
          cycle
        )
    );

  const requestGeneratorPreview = (
    requestKey: string,
    cycle: number,
    request: GeneratorPreviewRequest
  ) =>
    coalesceInFlightRequest(
      generatorPreviewRequestsRef.current,
      `${requestKey}:${cycle}`,
      () => generatorPreview(request)
    );

  useEffect(() => {
    let cancelled = false;
    const requestCycle = effectivePreviewCycle;
    const requestKey = previewRequestCacheKey;
    const timeout = window.setTimeout(async () => {
      if (!switchRequest.ok) {
        setPreview(null);
        setPreviewRequestKey("");
        setPreviewError(switchRequest.error);
        return;
      }

      const data = switchRequest.data;
      try {
        const nextPreview = await requestSubdivisionPreview(
          data,
          tempoBpmForAutomation,
          requestCycle,
          requestKey
        );
        if (!cancelled) {
          setPreview(nextPreview);
          setPreviewRequestKey(requestKey);
          setPreviewCache((current) =>
            rememberCachedCycleValue(current, requestCycle, requestKey, nextPreview)
          );
          setPreviewError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setPreview(null);
          setPreviewRequestKey("");
          setPreviewError(String(e));
        }
      }
    }, timelinePreviewDebounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    effectivePreviewCycle,
    previewRequestCacheKey,
    switchRequest,
    tempoBpmForAutomation,
    timelinePreviewDebounceMs,
  ]);

  useEffect(() => {
    const queue = scoreApplyQueueRef.current!;
    // Direct Play owns this queue while starting. A background effect cleanup
    // must not turn the explicit in-flight apply into a superseded result.
    if (playbackTransitionRef.current.kind === "starting") {
      return;
    }
    if (suppressScoreApplyRef.current) {
      if (switchRequest.ok) {
        const requestKey = JSON.stringify(switchRequest.data);
        setLatestWinsDesired(queue, requestKey);
        discardLatestWinsPending(queue);
        return () => {
          if (
            queue.desiredKey === requestKey &&
            backgroundQueueCleanupAllowed(playbackTransitionRef.current.kind)
          ) {
            setLatestWinsDesired(queue, null);
          }
        };
      }
      setLatestWinsDesired(queue, null);
      return;
    }
    // A live parallel runtime owns per-track scores via its own config; a
    // `SetScore` here would null `parallel_config` and tear the runtime down
    // (P0.4). Defer — `lastAppliedRequestRef` is left stale on purpose so the
    // edited score is applied when playback stops (or rebuilt at the next Play).
    if (
      !singleTrackBackendOwnerAvailable({
        suppressed: false,
        runningParallel: runningParallelRef.current,
        transitionKind: playbackTransitionRef.current.kind,
      })
    ) {
      setLatestWinsDesired(queue, null);
      return;
    }
    if (!switchRequest.ok) {
      setLatestWinsDesired(queue, null);
      return;
    }

    const data = switchRequest.data;
    const requestKey = JSON.stringify(data);
    // Publish intent before the debounce begins. This immediately suppresses
    // callbacks and queued work from an older request, even if that command is
    // already in flight and cannot itself be cancelled.
    setLatestWinsDesired(queue, requestKey);

    let timeout: number | null = null;
    if (
      latestWinsNeedsEnqueue(
        queue,
        requestKey,
        lastAppliedRequestRef.current
      )
    ) {
      timeout = window.setTimeout(() => {
        if (
          queue.desiredKey !== requestKey ||
          !latestWinsNeedsEnqueue(
            queue,
            requestKey,
            lastAppliedRequestRef.current
          )
        ) {
          return;
        }
        void enqueueLatestWins(queue, {
          key: requestKey,
          // A task can sit behind an older backend command longer than the
          // debounce. Re-check the guards at drain time so it cannot tear down
          // a parallel runtime or bypass a patch rehydrate suppression window.
          shouldRun: () =>
            singleTrackBackendOwnerAvailable({
              suppressed: suppressScoreApplyRef.current,
              runningParallel: runningParallelRef.current,
              transitionKind: playbackTransitionRef.current.kind,
            }),
          run: () => createSubdivisionSwitchScore(data),
        }).then((outcome) => {
          // Applied/error outcomes are only produced for the desired key. An
          // older command may still mutate the backend before the newest pending
          // command restores it, but it cannot claim React state.
          if (outcome.status === "applied") {
            lastAppliedRequestRef.current = requestKey;
          } else if (outcome.status === "error") {
            setError(String(outcome.error));
          }
        });
      }, 220);
    }

    return () => {
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
      if (
        queue.desiredKey === requestKey &&
        backgroundQueueCleanupAllowed(playbackTransitionRef.current.kind)
      ) {
        setLatestWinsDesired(queue, null);
      }
    };
  }, [playbackTransitionKind, singleTrackOwnershipEpoch, switchRequest]);

  const displayedTick = snapshot?.isPlaying
    ? liveParallelTrackPosition?.tickInCycle ?? visualTransport.currentTick
    : snapshot?.currentTick ?? visualTransport.currentTick;
  const timelineTicksPerCycle =
    snapshot?.isPlaying && liveParallelTrackPosition
      ? liveParallelTrackPosition.ticksPerCycle
      : snapshot?.ticksPerCycle ?? 0;
  const midiDebugEvents = snapshot?.midiDebugEvents ?? [];
  const automationDebugEvents = snapshot?.automationEvents ?? [];
  const parallelConflictEvents = snapshot?.parallelConflictEvents ?? [];
  const {
    showTransportRenderLayers,
    activeChannelHocketEvents,
  } = timelineRenderLayers;
  const timelinePreviewReady = exactTimelinePreview?.cycle === timelineLayoutCycle;
  const dumkaProjectionSpans = useMemo(
    () =>
      timelinePreviewReady
        ? rhythmAccentSpans(exactTimelinePreview?.pulseSpans ?? []).map((span) => ({
            spanLen: span.matraLen,
            subdivision: span.subdivision,
          }))
        : [],
    [exactTimelinePreview, timelinePreviewReady]
  );
  useEffect(() => {
    if (timelinePreviewReady && timelinePreview) {
      lastReadyTimelinePreviewRef.current = timelinePreview;
    }
  }, [timelinePreview, timelinePreviewReady]);
  const pendingTimelinePreview = renderedPreviewWhilePending(
    timelinePreview,
    timelinePreviewReady,
    lastReadyTimelinePreviewRef.current
  );
  const renderedTimelinePreview = pendingTimelinePreview.preview;
  const renderedTimelinePreviewIsStale = pendingTimelinePreview.stale;
  const renderedTimelineLayoutCycle =
    renderedTimelinePreview?.cycle ?? timelineLayoutCycle;
  const midiDebugActiveTrackId = parallelProject?.activeTrackId ?? null;
  const midiDebugFilteredEvents = useMemo(() => {
    if (!midiDebugOpen) return [];
    return midiDebugActiveTrackOnly && midiDebugActiveTrackId
      ? midiDebugEvents.filter(
          (event) =>
            !event.parallelTrackId || event.parallelTrackId === midiDebugActiveTrackId
        )
      : midiDebugEvents;
  }, [
    midiDebugActiveTrackId,
    midiDebugActiveTrackOnly,
    midiDebugEvents,
    midiDebugOpen,
  ]);
  const visibleMidiDebugEvents = useMemo(
    () => debugTailWhenOpen(midiDebugFilteredEvents, midiDebugOpen, midiDebugLimit),
    [midiDebugFilteredEvents, midiDebugLimit, midiDebugOpen]
  );

  const playheadAkshara: number | null = null;
  const normalizedBoundaries = normalizeBoundaries(boundaries, cycleBeats);
  useEffect(() => {
    if (selectedBoundaryAfterBeat === null) return;
    if (
      !normalizedBoundaries.some(
        (boundary) => boundary.afterBeat === selectedBoundaryAfterBeat
      )
    ) {
      setSelectedBoundaryAfterBeat(null);
    }
  }, [normalizedBoundaries, selectedBoundaryAfterBeat]);

  useEffect(() => {
    if (sectionInspectorKey === "initial") return;
    if (
      !normalizedBoundaries.some(
        (boundary) =>
          `boundary:${boundary.id ?? boundary.afterBeat}` === sectionInspectorKey
      )
    ) {
      setSectionInspectorKey("initial");
    }
  }, [normalizedBoundaries, sectionInspectorKey]);

  const resolvedBeats = buildResolvedBeats({
    preview: timelinePreview,
    cycleBeats,
    initialWeights,
    pitch,
    velocity,
  });
  const renderedResolvedBeats =
    renderedTimelinePreview === timelinePreview
      ? resolvedBeats
      : buildResolvedBeats({
          preview: renderedTimelinePreview,
          cycleBeats,
          initialWeights,
          pitch,
          velocity,
        });
  const resolvedSections = groupResolvedSections(
    resolvedBeats,
    timelinePreview?.pulseSpans ?? []
  );
  const sectionInspectorEntries: SectionInspectorEntry[] = [
    {
      key: "initial",
      kind: "initial",
      label: "Section 1",
      detail: "starts beat 1",
      startBeat: 1,
      resolvedSection: resolvedSections.find((section) => section.startBeat === 1),
    },
    ...normalizedBoundaries.map((boundary, index) => ({
      key: `boundary:${boundary.id ?? boundary.afterBeat}`,
      kind: "boundary" as const,
      label: `After beat ${boundary.afterBeat}`,
      detail: `starts beat ${boundary.afterBeat + 1}`,
      startBeat: boundary.afterBeat + 1,
      index,
      boundary,
      resolvedSection: resolvedSections.find(
        (section) => section.startBeat === boundary.afterBeat + 1
      ),
    })),
  ];
  const activeSectionInspectorEntry =
    sectionInspectorEntries.find((entry) => entry.key === sectionInspectorKey) ??
    sectionInspectorEntries[0]!;
  const renderedResolvedSections =
    renderedTimelinePreview === timelinePreview
      ? resolvedSections
      : groupResolvedSections(
          renderedResolvedBeats,
          renderedTimelinePreview?.pulseSpans ?? []
        );
  const selectedBoundaryIndex =
    selectedBoundaryAfterBeat === null
      ? -1
      : normalizedBoundaries.findIndex(
          (boundary) => boundary.afterBeat === selectedBoundaryAfterBeat
        );
  const selectedBoundary =
    selectedBoundaryIndex >= 0 ? normalizedBoundaries[selectedBoundaryIndex] : null;
  const selectedBoundaryResolvedSection = selectedBoundary
    ? resolvedSections.find(
        (section) => section.startBeat === selectedBoundary.afterBeat + 1
      )
    : undefined;
  const rhythmPlaybackGlobalSeed = seed;
  const channelHocketSeedModeRequest = useMemo<RhythmSeedMode>(
    () =>
      childStreamSeedModeRequest(
        channelHocketSeedBehavior,
        {
          mode: seedMode,
          seed,
          history: globalHistorySeeds,
          historyWeight,
          newSeedWeight,
          maxHistory,
        },
        {
          seed: channelHocketSeed,
          history: channelHocketHistorySeeds,
          historyWeight: channelHocketHistoryWeight,
          newSeedWeight: channelHocketNewSeedWeight,
          maxHistory: channelHocketMaxHistory,
        }
      ),
    [
      channelHocketHistorySeeds,
      channelHocketHistoryWeight,
      channelHocketMaxHistory,
      channelHocketNewSeedWeight,
      channelHocketSeed,
      channelHocketSeedBehavior,
      globalHistorySeeds,
      historyWeight,
      maxHistory,
      newSeedWeight,
      seed,
      seedMode,
    ]
  );

  const channelHocketSpec = useMemo<ChannelHocketSpec | null>(() => {
    const channels = channelHocketChannels.filter((channel) =>
      MIDI_CHANNELS.includes(channel)
    );
    if (channels.length === 0) {
      return null;
    }
    const fallback = channels.includes(channelHocketFallback)
      ? channelHocketFallback
      : channels[0]!;
    const contexts = channelContexts(channels, channelHocketOrder);
    const transitions: ChannelTransition[] = contexts.flatMap((from) =>
      channels.flatMap((to) => {
        const weight = channelWeightValue(
          channelHocketWeights,
          channels,
          channelHocketOrder,
          from,
          to
        );
        return weight > 0 ? [{ from, to, weight: clamp(Math.round(weight), 0, 999) }] : [];
      })
    );
    const fallbackWeights: ChannelFallbackWeight[] = channels.flatMap((channel) => {
      const weight = clamp(
        Math.round(channelHocketFallbackWeights[String(channel)] ?? 0),
        0,
        999
      );
      return weight > 0 ? [{ channel, weight }] : [];
    });
    const entryWeights: ChannelEntryWeight[] = channelContexts(
      channels,
      channelHocketOrder
    ).flatMap((entry) => {
      const weight = clamp(
        Math.round(
          channelHocketEntryWeights[
            channelEntryWeightKey(channelHocketOrder, entry)
          ] ?? 0
        ),
        0,
        999
      );
      return weight > 0 ? [{ channels: entry, weight }] : [];
    });
    return {
      order: channelHocketOrder,
      channels,
      transitions,
      fallback,
      fallbackWeights,
      entryWeights,
      seedMode: channelHocketSeedModeRequest,
      globalSeed: seed,
      accentRules: channelAccentRulesToRequest(channelAccentRules, channels),
      positionRules: channelPositionRulesToRequest(channelPositionRules, channels),
      assignMode: channelHocketAssignMode,
      euclid:
        channelHocketAssignMode === "euclid"
          ? euclidChannelSpecToRequest(channelHocketEuclid, channels)
          : null,
    };
  }, [
    channelAccentRules,
    channelPositionRules,
    channelHocketAssignMode,
    channelHocketChannels,
    channelHocketEuclid,
    channelHocketEnabled,
    channelHocketEntryWeights,
    channelHocketFallback,
    channelHocketFallbackWeights,
    channelHocketOrder,
    channelHocketSeedModeRequest,
    channelHocketWeights,
    seed,
  ]);
  const synthProgramRequest = useMemo(
    () => synthProgramsToRequest(synthPrograms),
    [synthPrograms]
  );
  const synthVoiceLabels = useMemo(
    () =>
      Object.fromEntries(
        synthProgramRequest.map((voice) => [voice.channel, synthVoiceLabel(voice)])
      ) as Record<number, string>,
    [synthProgramRequest]
  );
  useEffect(() => {
    if (!transportIsPlaying || timelinePreviewReady || !switchRequest.ok) {
      return;
    }

    let cancelled = false;
    const requestCycle = timelineLayoutCycle;
    const requestKey = previewRequestCacheKey;
    const rhythmRequestKey = rhythmPreviewRequestKey;
    const timeout = window.setTimeout(async () => {
      const data = switchRequest.data;
      try {
        for (const cycle of [requestCycle, requestCycle + 1]) {
          const nextPreview = await requestSubdivisionPreview(
            data,
            tempoBpmForAutomation,
            cycle,
            requestKey
          );
          if (cancelled) {
            return;
          }
          if (cycle === requestCycle) {
            setPreview(nextPreview);
            setPreviewRequestKey(requestKey);
          }
          setPreviewCache((current) =>
            rememberCachedCycleValue(current, cycle, requestKey, nextPreview)
          );
          setPreviewError(null);

          if (rhythmPlaybackEnabled) {
            const nextRhythmAccentSpans = rhythmAccentSpans(nextPreview.pulseSpans);
            try {
              const nextRhythm = await requestGeneratorPreview(
                rhythmRequestKey,
                cycle,
                {
                  spans: generatorSpanInputsFromPulseSpans(
                    nextRhythmAccentSpans,
                    pulseSpanLabel
                  ),
                  enabled: rhythmPlaybackEnabled,
                  generator: generatorRuntimeConfig,
                  cycle,
                  cycleBeats: data.cycleBeats,
                  automation: activeAutomationSet,
                  trackId: activeGeneratorTrackId,
                  spanVelocities:
                    generatorSpanVelocitiesFromPulseSpans(nextRhythmAccentSpans),
                }
              );
              if (cancelled) return;
              if (cycle === requestCycle) {
                setRhythmResult(nextRhythm);
                setRhythmResultCycle(cycle);
                setRhythmResultRequestKey(rhythmRequestKey);
                setRhythmPreviewFailure(null);
              }
              setRhythmResultCache((current) =>
                rememberCachedCycleValue(current, cycle, rhythmRequestKey, nextRhythm)
              );
            } catch (error) {
              if (cancelled) return;
              if (cycle === requestCycle) {
                setRhythmResult(null);
                setRhythmResultCycle(null);
                setRhythmResultRequestKey("");
                setRhythmPreviewFailure({
                  requestKey: rhythmRequestKey,
                  cycle,
                  message: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }
        }
      } catch (e) {
        if (!cancelled) {
          setPreviewError(String(e));
        }
      }
    }, timelinePreviewDebounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    activeAutomationSet,
    activeGeneratorTrackId,
    previewRequestCacheKey,
    rhythmPlaybackEnabled,
    generatorRuntimeConfig,
    rhythmPreviewRequestKey,
    switchRequest,
    tempoBpmForAutomation,
    timelineLayoutCycle,
    timelinePreviewDebounceMs,
    timelinePreviewReady,
    transportIsPlaying,
  ]);
  const queuedSeedPath = useMemo(
    () => seedPaths.find((path) => path.id === queuedSeedPathId) ?? null,
    [queuedSeedPathId, seedPaths]
  );
  const parallelPlaybackRuntimeEnabled = useMemo(
    () => parallelRuntimeWouldEngage(parallelProject?.tracks ?? []),
    [parallelProject]
  );

  useEffect(() => {
    let cancelled = false;
    const requestCycle = effectivePreviewCycle;
    const requestKey = rhythmPreviewRequestKey;
    const timeout = window.setTimeout(async () => {
      if (!timelinePreviewReady || timelineLayoutCycle !== requestCycle) {
        return;
      }
      try {
        const requestAccentSpans = rhythmAccentSpans(timelinePreview?.pulseSpans ?? []);
        const next = await requestGeneratorPreview(requestKey, requestCycle, {
          spans: generatorSpanInputsFromPulseSpans(requestAccentSpans, pulseSpanLabel),
          enabled: rhythmPlaybackEnabled,
          generator: generatorRuntimeConfig,
          cycle: requestCycle,
          cycleBeats,
          automation: activeAutomationSet,
          trackId: activeGeneratorTrackId,
          spanVelocities: generatorSpanVelocitiesFromPulseSpans(requestAccentSpans),
        });
        if (!cancelled) {
          setRhythmResult(next);
          setRhythmResultCycle(requestCycle);
          setRhythmResultRequestKey(requestKey);
          setRhythmResultCache((current) =>
            rememberCachedCycleValue(current, requestCycle, requestKey, next)
          );
          setRhythmPreviewFailure(null);
        }
      } catch (e) {
        if (!cancelled) {
          setRhythmResult(null);
          setRhythmResultCycle(null);
          setRhythmResultRequestKey("");
          setRhythmPreviewFailure({
            requestKey,
            cycle: requestCycle,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }, timelinePreviewDebounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    activeAutomationSet,
    activeGeneratorTrackId,
    effectivePreviewCycle,
    cycleBeats,
    generatorRuntimeConfig,
    rhythmPlaybackEnabled,
    rhythmPreviewRequestKey,
    timelineLayoutCycle,
    timelinePreview,
    timelinePreviewReady,
    timelinePreviewDebounceMs,
  ]);

  const evolveRhythmPreviewRequestKey = useMemo(
    () =>
      buildGeneratorPreviewRequestKey(
        previewRequestCacheKey,
        generatorRuntimeConfig,
        true,
        activeGeneratorTrackId
      ),
    [
      activeGeneratorTrackId,
      generatorRuntimeConfig,
      previewRequestCacheKey,
    ]
  );

  // The Evolve composition strip is a bounded authoring cache, separate from
  // the timeline's small truth-preserving render cache. It samples the score
  // through the same structural-preview + generator seam and never supplies
  // playback or timeline rows.
  useEffect(() => {
    if (
      !evolveOpen ||
      generatorKind !== "dumka" ||
      !switchRequest.ok
    ) {
      return undefined;
    }
    let cancelled = false;
    const structuralKey = previewRequestCacheKey;
    const rhythmKey = evolveRhythmPreviewRequestKey;
    const visibleFrom = clamp(
      Math.floor(evolveVisibleCycleRange.fromCycle) - 1,
      0,
      MAX_STOPPED_PREVIEW_CYCLE
    );
    const visibleTo = clamp(
      Math.ceil(evolveVisibleCycleRange.toCycle) + 1,
      visibleFrom,
      MAX_STOPPED_PREVIEW_CYCLE
    );
    const { cycles: requestedCycles, cacheLimit } = selectEvolutionPreviewCycles(
      dumkaPlan,
      visibleFrom,
      visibleTo,
      MAX_STOPPED_PREVIEW_CYCLE
    );
    const missing = requestedCycles
      .filter(
        (cycle) =>
          evolvePreviewCache.get(cycle)?.requestKey !== rhythmKey &&
          rhythmResultCache.get(cycle)?.requestKey !== rhythmKey
      )
      .sort((left, right) => left - right);
    if (missing.length === 0) return undefined;

    const timeout = window.setTimeout(async () => {
      const resolved: Array<[number, GeneratorPreview]> = [];
      // Small batches keep the Tauri invoke queue responsive while still
      // filling a normal 16–32-cycle canvas promptly.
      for (let offset = 0; offset < missing.length && !cancelled; offset += 4) {
        const batch = missing.slice(offset, offset + 4);
        const previews = await Promise.all(
          batch.map(async (cycle): Promise<[number, GeneratorPreview] | null> => {
            try {
              const structural = await requestSubdivisionPreview(
                switchRequest.data,
                tempoBpmForAutomation,
                cycle,
                structuralKey
              );
              const accentSpans = rhythmAccentSpans(structural.pulseSpans);
              const rhythm = await requestGeneratorPreview(rhythmKey, cycle, {
                spans: generatorSpanInputsFromPulseSpans(accentSpans, pulseSpanLabel),
                enabled: true,
                generator: generatorRuntimeConfig,
                cycle,
                cycleBeats: switchRequest.data.cycleBeats,
                automation: activeAutomationSet,
                trackId: activeGeneratorTrackId,
                spanVelocities: generatorSpanVelocitiesFromPulseSpans(accentSpans),
              });
              return [cycle, rhythm];
            } catch {
              return null;
            }
          })
        );
        resolved.push(
          ...previews.filter(
            (entry): entry is [number, GeneratorPreview] => entry !== null
          )
        );
      }
      if (cancelled || resolved.length === 0) return;
      setEvolvePreviewCache((current) => {
        let next = current;
        for (const [cycle, preview] of resolved) {
          next = rememberCachedCycleValue(
            next,
            cycle,
            rhythmKey,
            preview,
            cacheLimit
          );
        }
        return next;
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    activeAutomationSet,
    activeGeneratorTrackId,
    dumkaPlan,
    evolveOpen,
    evolvePreviewCache,
    evolveRhythmPreviewRequestKey,
    evolveVisibleCycleRange,
    generatorRuntimeConfig,
    generatorKind,
    previewRequestCacheKey,
    rhythmResultCache,
    switchRequest,
    tempoBpmForAutomation,
  ]);

  const timelineRhythmReady =
    !rhythmPlaybackEnabled || exactTimelineGeneratorResult !== null;
  useEffect(() => {
    if (
      !transportIsPlaying ||
      !rhythmPlaybackEnabled ||
      !timelinePreviewReady ||
      timelineRhythmResult !== null
    ) {
      return;
    }

    let cancelled = false;
    const requestCycle = timelineLayoutCycle;
    const requestKey = rhythmPreviewRequestKey;
    const timeout = window.setTimeout(async () => {
      try {
        const requestAccentSpans = rhythmAccentSpans(timelinePreview?.pulseSpans ?? []);
        const next = await requestGeneratorPreview(requestKey, requestCycle, {
          spans: generatorSpanInputsFromPulseSpans(requestAccentSpans, pulseSpanLabel),
          enabled: rhythmPlaybackEnabled,
          generator: generatorRuntimeConfig,
          cycle: requestCycle,
          cycleBeats,
          automation: activeAutomationSet,
          trackId: activeGeneratorTrackId,
          spanVelocities: generatorSpanVelocitiesFromPulseSpans(requestAccentSpans),
        });
        if (!cancelled) {
          setRhythmResult(next);
          setRhythmResultCycle(requestCycle);
          setRhythmResultRequestKey(requestKey);
          setRhythmResultCache((current) =>
            rememberCachedCycleValue(current, requestCycle, requestKey, next)
          );
          setRhythmPreviewFailure(null);
        }
      } catch (e) {
        if (!cancelled) {
          setRhythmResult(null);
          setRhythmResultCycle(null);
          setRhythmResultRequestKey("");
          setRhythmPreviewFailure({
            requestKey,
            cycle: requestCycle,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }, timelinePreviewDebounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    activeAutomationSet,
    activeGeneratorTrackId,
    cycleBeats,
    rhythmPlaybackEnabled,
    generatorRuntimeConfig,
    rhythmPreviewRequestKey,
    timelineLayoutCycle,
    timelinePreviewDebounceMs,
    timelinePreviewReady,
    timelineRhythmResult,
    timelinePreview,
    transportIsPlaying,
  ]);
  const timelineLayerSourcesCoherent = transportIsPlaying
    ? timelineSourcesAreCoherent({
        isPlaying: true,
        cycleIndex: timelineRenderLayers.cycleIndex,
        previewCycle: timelinePreview?.cycle,
        rhythmCycle: timelineRhythmResult ? timelineLayoutCycle : null,
        rhythmEnabled: rhythmPlaybackEnabled,
      })
    : timelinePreviewReady && timelineRhythmReady;
  const transportLayerVisibility = selectTimelineTransportLayerVisibility({
    showTransportRenderLayers,
    previewCoherent: timelinePreviewReady,
    rhythmCoherent: timelineRhythmReady,
  });
  const { showChannelHocketTransportRenderLayers } = transportLayerVisibility;
  const showCoherentRhythmLayer =
    rhythmPlaybackEnabled && timelinePreviewReady && timelineRhythmReady;
  const activeTimelineTrackId = parallelProject?.activeTrackId ?? null;
  // Compose the parity contract in one tested place: visible playback layers
  // are scoped to the active track's local cycle (already filtered above) AND
  // to the active track id, so a custom-tempo track on a different local cycle
  // can never render another track's notes/rhythms in the active timeline.
  const { visibleChannelHocketEvents } = selectActiveTrackTimelineLayers({
    activeTrackId: activeTimelineTrackId,
    showChannelHocketTransportRenderLayers,
    activeChannelHocketEvents,
    emptyChannelHocketEvents: EMPTY_CHANNEL_HOCKET_EVENTS,
  });
  const channelHocketEventSummary = visibleChannelHocketEvents.length
    ? `${visibleChannelHocketEvents.length} assigned this cycle`
    : channelHocketEnabled
      ? `${channelHocketMatrixChannels.length} channels${
          activeChannelAccentRuleCount ? ` · ${activeChannelAccentRuleCount} accent rules` : ""
        }`
      : `output ch ${midiOutputChannel}`;
  const currentTimelineLayerRenderModel = useMemo<TimelineLayerRenderModel>(
    () => ({
      layoutCycle: timelineLayoutCycle,
      ticksPerCycle: timelineTicksPerCycle,
      showCoherentRhythmLayer,
      showChannelHocketTransportRenderLayers,
      rhythmBySpanId,
      visibleChannelHocketEvents,
    }),
    [
      rhythmBySpanId,
      showChannelHocketTransportRenderLayers,
      showCoherentRhythmLayer,
      timelineLayoutCycle,
      timelineTicksPerCycle,
      visibleChannelHocketEvents,
    ]
  );
  useEffect(() => {
    if (timelineLayerSourcesCoherent) {
      lastCoherentTimelineLayerModelRef.current = currentTimelineLayerRenderModel;
    }
  }, [currentTimelineLayerRenderModel, timelineLayerSourcesCoherent]);
  const stableTimelineLayerRenderModel = selectStableTimelineRenderModel({
    isPlaying: transportIsPlaying,
    currentModel: currentTimelineLayerRenderModel,
    currentCoherent: timelineLayerSourcesCoherent,
    lastCoherentModel: lastCoherentTimelineLayerModelRef.current,
  });
  const renderedTimelineLayerModel = stableTimelineLayerRenderModel.model;
  const timelineRenderUsingStaleLayerModel =
    stableTimelineLayerRenderModel.usingLastCoherentModel;
  const timelineRenderSyncing =
    !timelineLayerSourcesCoherent ||
    renderedTimelinePreviewIsStale ||
    (transportIsPlaying && timelineRenderUsingStaleLayerModel);
  // Count visible ghosted note groups from the rendered model so the alert does
  // not flap while live layer data catches up.
  const renderedActiveTrackSuppressedNoteGroups = useMemo(() => {
    const startTicks = new Set<number>();
    for (const event of renderedTimelineLayerModel.visibleChannelHocketEvents) {
      if (event.suppressed) startTicks.add(event.startTick);
    }
    return startTicks.size;
  }, [renderedTimelineLayerModel]);

  useEffect(() => {
    const key = synthProgramsWriteKey(synthProgramRequest);
    setLatestWinsDesired(synthProgramQueueRef.current!, key);
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const outcome = await queueSynthPrograms(synthProgramRequest);
      if (cancelled || outcome.status === "superseded") return;
      if (outcome.status === "error") {
        setError(String(outcome.error));
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [queueSynthPrograms, synthProgramRequest]);

  const trackPlaybackRequest = useMemo<TrackPlaybackRequest>(
    () => ({
      generatorEnabled: rhythmPlaybackEnabled,
      generator: generatorRuntimeConfig,
      midiOutputChannel,
      automation: activeAutomationSet,
      channelHocketEnabled,
      channelHocket: channelHocketSpec,
      // Queue selection is a Play-time argument. Stopped staging must remain
      // neutral, and a running session gets its pinned value in the effects
      // below, so selecting the next take cannot mutate the current one.
      seedPath: null,
    }),
    [
      activeAutomationSet,
      channelHocketEnabled,
      channelHocketSpec,
      generatorRuntimeConfig,
      midiOutputChannel,
      rhythmPlaybackEnabled,
    ]
  );
  const authoredTempoIntentBpm = clamp(
    authoredTempoBpmRef.current,
    20,
    400
  );
  const playbackConfigIntentKey = useMemo(
    () =>
      JSON.stringify({
        switchRequest,
        // The selected seed path is an argument to Play, not an edit that
        // should invalidate the start it initiates.
        playback: { ...trackPlaybackRequest, seedPath: null },
        project: parallelProject,
        tempoBpm: authoredTempoIntentBpm,
        synthEnabled,
        synthPrograms: synthProgramRequest,
      }),
    [
      parallelProject,
      trackPlaybackRequest,
      switchRequest,
      synthEnabled,
      synthProgramRequest,
      authoredTempoIntentBpm,
    ]
  );
  const playbackConfigIntentKeyRef = useRef(playbackConfigIntentKey);
  playbackConfigIntentKeyRef.current = playbackConfigIntentKey;

  useEffect(() => {
    // Play will write this shared queue explicitly after its score/patch build.
    // Preserve any current intent while that transition is assembling.
    if (playbackTransitionRef.current.kind === "starting") {
      return;
    }
    // A staged single-track write and a parallel write target the same backend
    // slot. Invalidate both the desired key and pending work whenever another
    // owner is active; an already-running command will be followed by the new
    // owner's queued command before Play proceeds.
    if (
      !singleTrackBackendOwnerAvailable({
        suppressed: suppressPlaybackConfigApplyRef.current,
        runningParallel: runningParallelRef.current,
        transitionKind: playbackTransitionRef.current.kind,
      })
    ) {
      invalidatePlaybackConfigIntent();
      return;
    }

    const desiredTrackPlaybackRequest = playbackSessionActiveRef.current
      ? {
          ...trackPlaybackRequest,
          seedPath: activePlaybackSeedPathRef.current,
        }
      : trackPlaybackRequest;
    const key = trackPlaybackWriteKey(desiredTrackPlaybackRequest);
    setLatestWinsDesired(playbackConfigQueueRef.current!, key);
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const outcome = await queueTrackPlayback(
        desiredTrackPlaybackRequest,
        {
          shouldRun: () =>
            singleTrackBackendOwnerAvailable({
              suppressed: suppressPlaybackConfigApplyRef.current,
              runningParallel: runningParallelRef.current,
              transitionKind: playbackTransitionRef.current.kind,
            }),
        }
      );
      if (cancelled || outcome.status === "superseded") return;
      if (outcome.status === "error") {
        setError(String(outcome.error));
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    invalidatePlaybackConfigIntent,
    queueTrackPlayback,
    playbackTransitionKind,
    trackPlaybackRequest,
    singleTrackOwnershipEpoch,
  ]);

  // P1: live-apply edits to a PLAYING parallel runtime. While a parallel runtime
  // is live (`runningParallelRef`, pinned at Play — S5), rebuild the parallel
  // request from current state and push it with `nextCycle` so the transport
  // applies it in place (forward-from-position, no replay, no all-notes-off).
  // The edit lands at the next un-realized cycle. Dedup by payload so identical
  // rebuilds are free. Edits are inert here when stopped or single-track (the
  // existing effects own those paths).
  useEffect(() => {
    if (
      !runningParallelRef.current ||
      playbackTransitionRef.current.kind !== "idle" ||
      suppressPlaybackConfigApplyRef.current
    ) {
      return;
    }
    const generation = parallelBuildGenerationRef.current + 1;
    parallelBuildGenerationRef.current = generation;
    // Invalidate an older pending push before this async patch build begins.
    // The concrete payload key replaces this placeholder once the newest build
    // completes.
    const buildKey = `parallel-build:${generation}`;
    setLatestWinsDesired(playbackConfigQueueRef.current!, buildKey);
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      if (
        cancelled ||
        generation !== parallelBuildGenerationRef.current ||
        playbackConfigQueueRef.current!.desiredKey !== buildKey ||
        !runningParallelRef.current ||
        playbackTransitionRef.current.kind !== "idle"
      ) {
        return;
      }
      try {
        const patch = await buildPatchDocument();
        const request = buildParallelPlaybackRequest(
          patch.project,
          activePlaybackSeedPathRef.current
        );
        if (
          cancelled ||
          generation !== parallelBuildGenerationRef.current ||
          playbackConfigQueueRef.current!.desiredKey !== buildKey ||
          !runningParallelRef.current ||
          playbackTransitionRef.current.kind !== "idle"
        ) {
          return;
        }
        // Null (dropped below the parallel engage threshold) or an error leaves
        // the running runtime untouched until the next Play; a topology change is
        // Tier D (stop-gated) so this path only carries parameter edits.
        if (!request || "error" in request) {
          return;
        }
        const outcome = await queueParallelPlayback(
          request,
          { nextCycle: true },
          {
            shouldRun: () =>
              generation === parallelBuildGenerationRef.current &&
              runningParallelRef.current &&
              playbackTransitionRef.current.kind === "idle" &&
              !suppressPlaybackConfigApplyRef.current,
          }
        );
        if (cancelled || outcome.status === "superseded") return;
        if (outcome.status === "error") {
          setError(String(outcome.error));
        }
      } catch (e) {
        if (
          !cancelled &&
          generation === parallelBuildGenerationRef.current &&
          playbackConfigQueueRef.current!.desiredKey === buildKey
        ) {
          setError(String(e));
        }
      }
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    activeAutomationSet,
    channelHocketEnabled,
    channelHocketSpec,
    generatorRuntimeConfig,
    midiOutputChannel,
    parallelProject,
    queueParallelPlayback,
    rhythmPlaybackGlobalSeed,
    rhythmPlaybackEnabled,
    switchRequest,
  ]);

  const addAutomationTarget = (def: AutomationTargetDef) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before editing automation");
      return;
    }
    const existing = automationSet.tracks.find((track) => track.target === def.target);
    if (existing) {
      const curve = existing.curves[0] ?? null;
      setSelectedAutomationTrackId(existing.id);
      setSelectedAutomationCurveId(curve?.id ?? null);
      setSelectedAutomationPointId(curve?.points[0]?.id ?? null);
      setSelectedAutomationSegmentPointId(curve?.points[0]?.id ?? null);
      setAutomationOpen(true);
      return;
    }
    const track = makeAutomationTrack(def);
    setAutomationSet((current) => {
      const normalized = cloneAutomationSet(current);
      if (normalized.tracks.some((track) => track.target === def.target)) {
        return normalized;
      }
      return {
        ...normalized,
        tracks: [...normalized.tracks, track],
      };
    });
    setSelectedAutomationTrackId(track.id);
    setSelectedAutomationCurveId(track.curves[0]?.id ?? null);
    setSelectedAutomationPointId(track.curves[0]?.points[0]?.id ?? null);
    setSelectedAutomationSegmentPointId(track.curves[0]?.points[0]?.id ?? null);
    setAutomationOpen(true);
  };

  const openAutomationTarget = (target: string) => {
    const def = automationTargetDef(target, automationTargetDefs);
    addAutomationTarget(def);
    if (!playbackStructureLocked) {
      setPatchStatus(`Automation lane ready: ${def.label}`);
    }
  };

  const automationTargetFromElement = (element: Element | null): string | null => {
    if (!element) return null;
    const direct = element.closest<HTMLElement>("[data-automation-target]");
    if (direct?.dataset.automationTarget) {
      return direct.dataset.automationTarget;
    }
    const control =
      element instanceof HTMLElement
        ? element.closest<HTMLElement>("label, button, [role='button'], .value-with-unit")
        : null;
    const nested = control?.querySelector<HTMLElement>("[data-automation-target]");
    return nested?.dataset.automationTarget ?? null;
  };

  const handleAutomationShortcutClick = (event: MouseEvent<HTMLElement>) => {
    const shouldPick = automationPickMode || event.metaKey || event.ctrlKey;
    if (!shouldPick) return;
    if (
      event.target instanceof Element &&
      event.target.closest("[data-automation-pick-control]")
    ) {
      return;
    }
    const target = automationTargetFromElement(
      event.target instanceof Element ? event.target : null
    );
    if (!target) {
      if (automationPickMode) {
        event.preventDefault();
        event.stopPropagation();
        setPatchStatus("No automation lane is attached to that control");
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openAutomationTarget(target);
    setAutomationPickMode(false);
  };

  useEffect(() => {
    if (playbackStructureLocked && automationPickMode) {
      setAutomationPickMode(false);
    }
  }, [automationPickMode, playbackStructureLocked]);

  useEffect(() => {
    if (!automationPickMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAutomationPickMode(false);
        setPatchStatus("Automation target pick cancelled");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [automationPickMode]);

  const updateAutomationTrack = (
    trackId: string,
    updater: (track: AutomationSet["tracks"][number]) => AutomationSet["tracks"][number]
  ) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before editing automation");
      return;
    }
    setAutomationSet((current) => {
      const normalized = cloneAutomationSet(current);
      return {
        ...normalized,
        tracks: normalized.tracks.map((track) =>
          track.id === trackId ? updater(track) : track
        ),
      };
    });
  };

  const updateAutomationGraphRange = (
    trackId: string,
    patch: Partial<AutomationGraphRangeData>
  ) => {
    updateAutomationTrack(trackId, (track) => {
      const def = automationTargetDef(track.target, automationTargetDefs);
      if (def.valueKind !== "weight") return track;
      const current = automationGraphAxisRange(track, def);
      const minimumSpan = automationGraphMinimumSpan(def);
      let min = current.min;
      let max = current.max;
      if (patch.min !== undefined) {
        min = Math.min(patch.min, max - minimumSpan);
      }
      if (patch.max !== undefined) {
        max = Math.max(patch.max, min + minimumSpan);
      }
      const graphRange = coerceAutomationGraphRange({ min, max }, def);
      return {
        ...track,
        graphRange: graphRange ?? current,
      };
    });
  };

  const resetAutomationGraphRange = (trackId: string) => {
    updateAutomationTrack(trackId, (track) => {
      const def = automationTargetDef(track.target, automationTargetDefs);
      if (def.valueKind !== "weight") return track;
      return {
        ...track,
        graphRange: defaultAutomationWeightGraphRange(
          {
            ...track,
            graphRange: null,
          },
          def
        ),
      };
    });
  };

  const updateAutomationCurve = (
    trackId: string,
    curveId: string,
    updater: (
      curve: AutomationSet["tracks"][number]["curves"][number]
    ) => AutomationSet["tracks"][number]["curves"][number]
  ) => {
    updateAutomationTrack(trackId, (track) => ({
      ...track,
      curves: track.curves.map((curve) =>
        curve.id === curveId ? updater(curve) : curve
      ),
    }));
  };

  const updateAutomationPoint = (
    trackId: string,
    curveId: string,
    pointId: string,
    patch: {
      unit?: number;
      value?: number;
      anchorId?: string | null;
    }
  ) => {
    updateAutomationTrack(trackId, (track) => {
      const def = automationTargetDef(track.target, automationTargetDefs);
      const axisRange = automationGraphAxisRange(track, def);
      return {
        ...track,
        curves: track.curves.map((curve, curveIndex) =>
          curve.id === curveId || (!curveId && curveIndex === 0)
            ? {
                ...curve,
                points: sortAutomationPoints(
                  curve.points.map((point) =>
                    point.id === pointId
                      ? {
                          ...point,
                          time:
                            patch.unit === undefined
                              ? point.time
                              : automationTimeFromUnit(patch.unit),
                          value:
                            patch.value === undefined
                              ? point.value
                              : {
                                  type: "number",
                                  value: coerceAutomationPointNumberForAxis(
                                    patch.value,
                                    def,
                                    axisRange
                                  ),
                                },
                          anchorId:
                            patch.anchorId === undefined ? point.anchorId : patch.anchorId,
                        }
                      : point
                  )
                ),
              }
            : curve
        ),
      };
    });
  };

  const addAutomationPointAt = (
    trackId: string,
    curveId: string,
    unit: number,
    value: number,
    anchorId: string | null
  ) => {
    const pointId = newStableId("automation-point");
    updateAutomationTrack(trackId, (track) => {
      const def = automationTargetDef(track.target, automationTargetDefs);
      const axisRange = automationGraphAxisRange(track, def);
      const curves = track.curves.length
        ? track.curves
        : [makeAutomationCurve(def, newStableId("automation-curve"))];
      return {
        ...track,
        curves: curves.map((curve, curveIndex) => {
          if (!(curve.id === curveId || (!curveId && curveIndex === 0))) return curve;
          return {
            ...curve,
            points: sortAutomationPoints([
              ...curve.points,
              {
                id: pointId,
                time: automationTimeFromUnit(unit),
                value: {
                  type: "number",
                  value: coerceAutomationPointNumberForAxis(value, def, axisRange),
                },
                anchorId,
                outCurve: defaultAutomationSegmentCurve(),
              },
            ]),
          };
        }),
      };
    });
    setSelectedAutomationPointId(pointId);
    setSelectedAutomationSegmentPointId(pointId);
  };

  const removeAutomationPoint = (trackId: string, curveId: string, pointId: string) => {
    updateAutomationTrack(trackId, (track) => ({
      ...track,
      curves: track.curves.map((curve, curveIndex) =>
        curve.id === curveId || (!curveId && curveIndex === 0)
          ? {
              ...curve,
              points:
                curve.points.length <= 1
                  ? curve.points
                  : curve.points.filter((point) => point.id !== pointId),
            }
          : curve
      ),
    }));
  };

  const updateAutomationSegmentCurve = (
    trackId: string,
    curveId: string,
    pointId: string,
    segmentCurve: AutomationSegmentCurve
  ) => {
    updateAutomationCurve(trackId, curveId, (curve) => ({
      ...curve,
      points: curve.points.map((point) =>
        point.id === pointId
          ? {
              ...point,
              outCurve: {
                kind: segmentCurve.kind,
                amount: clamp(segmentCurve.amount, 0, 1),
              },
            }
          : point
      ),
    }));
  };

  const removeAutomationTrack = (trackId: string) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before editing automation");
      return;
    }
    setAutomationSet((current) => {
      const normalized = cloneAutomationSet(current);
      return {
        ...normalized,
        tracks: normalized.tracks.filter((track) => track.id !== trackId),
      };
    });
    setSelectedAutomationTrackId((current) => (current === trackId ? null : current));
  };

  const updateAutomationLengthCycles = (value: number) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before editing automation");
      return;
    }
    const lengthCycles = clamp(
      Math.round(value || 1),
      1,
      MAX_AUTOMATION_LENGTH_CYCLES
    );
    setAutomationSet((current) => ({
      ...cloneAutomationSet(current),
      lengthCycles,
    }));
  };

  const addAutomationMarker = (labelInput: string) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before editing automation");
      return;
    }
    const unit = clamp(automationMarkerPhaseInput / 100, 0, 1);
    const marker: AutomationMarkerData = {
      id: newStableId("automation-marker"),
      time: automationTimeFromUnit(unit),
      label: labelInput.trim(),
    };
    setAutomationSet((current) => {
      const normalized = cloneAutomationSet(current);
      return {
        ...normalized,
        markers: sortAutomationMarkers([...normalized.markers, marker]),
      };
    });
  };

  const updateAutomationMarker = (
    markerId: string,
    patch: { unit?: number; label?: string }
  ) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before editing automation");
      return;
    }
    setAutomationSet((current) => {
      const normalized = cloneAutomationSet(current);
      return {
        ...normalized,
        markers: sortAutomationMarkers(
          normalized.markers.map((marker) =>
            marker.id === markerId
              ? {
                  ...marker,
                  time:
                    patch.unit === undefined
                      ? marker.time
                      : automationTimeFromUnit(patch.unit),
                  label: patch.label === undefined ? marker.label : patch.label,
                }
              : marker
          )
        ),
      };
    });
  };

  const removeAutomationMarker = (markerId: string) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before editing automation");
      return;
    }
    setAutomationSet((current) => {
      const normalized = cloneAutomationSet(current);
      return {
        ...normalized,
        markers: normalized.markers.filter((marker) => marker.id !== markerId),
        tracks: normalized.tracks.map((track) => ({
          ...track,
          curves: track.curves.map((curve) => ({
            ...curve,
            points: curve.points.map((point) =>
              point.anchorId === markerId ? { ...point, anchorId: null } : point
            ),
          })),
        })),
      };
    });
  };

  const handleCycleBeatsChange = (value: number) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before changing cycle structure");
      return;
    }
    const next = clamp(Math.round(value || 1), 1, 64);
    setCycleBeats(next);
    setBoundaries((current) => normalizeBoundaries(current, next));
    setSectionCountWeights((current) =>
      current.map((w) => ({ ...w, count: clamp(w.count, 0, Math.max(0, next - 1)) }))
    );
  };

  const updateBoundary = (index: number, patch: Partial<BoundaryPoint>) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before changing section boundaries");
      return;
    }
    setBoundaries((current) =>
      normalizeBoundaries(
        current.map((boundary, i) =>
          i === index ? { ...boundary, ...patch } : boundary
        ),
        cycleBeats
      )
    );
  };

  const addBoundary = () => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before adding section boundaries");
      return;
    }
    const id = newStableId("boundary");
    setBoundaries((current) =>
      normalizeBoundaries(
        [
          ...current,
          makeBoundaryPoint(firstOpenBoundaryAfterBeat(current, cycleBeats), id),
        ],
        cycleBeats
      )
    );
    setSectionInspectorKey(`boundary:${id}`);
  };

  const editBoundaryFromRail = ({
    afterBeat,
    remove,
  }: {
    afterBeat: number;
    remove: boolean;
  }) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before changing section boundaries");
      return;
    }

    if (remove && selectedBoundaryAfterBeat === afterBeat) {
      setSelectedBoundaryAfterBeat(null);
    }

    setBoundaries((current) => {
      const normalized = normalizeBoundaries(current, cycleBeats);
      const existing = normalized.find((boundary) => boundary.afterBeat === afterBeat);

      if (remove) {
        return normalized.filter((boundary) => boundary.afterBeat !== afterBeat);
      }

      if (existing) return normalized;

      return normalizeBoundaries(
        [
          ...normalized,
          makeBoundaryPoint(afterBeat),
        ],
        cycleBeats
      );
    });
  };

  const openBoundaryDetail = (afterBeat: number) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before changing section boundaries");
      return;
    }
    setSelectedBoundaryAfterBeat(afterBeat);
  };

  const removeBoundaryAfterBeat = (afterBeat: number) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before removing section boundaries");
      return;
    }
    setBoundaries((current) =>
      normalizeBoundaries(current, cycleBeats).filter(
        (boundary) => boundary.afterBeat !== afterBeat
      )
    );
    if (selectedBoundaryAfterBeat === afterBeat) {
      setSelectedBoundaryAfterBeat(null);
    }
  };

  const removeBoundary = (index: number) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before removing section boundaries");
      return;
    }
    setBoundaries((current) => current.filter((_, i) => i !== index));
  };

  const applySwitchRequestNow = async (
    data: SwitchRequestData,
    requestKey: string
  ) => {
    const queue = scoreApplyQueueRef.current!;
    // A same-key automatic task may be waiting behind an older score with a
    // `shouldRun` guard that rejects the now-starting transition. Replace that
    // pending task with Play's explicit, unguarded apply instead of joining a
    // promise that is guaranteed to skip.
    if (queue.pending?.key === requestKey) {
      discardLatestWinsPending(queue);
    }
    const outcome = await enqueueLatestWins(queue, {
      key: requestKey,
      run: () => createSubdivisionSwitchScore(data),
    });
    if (outcome.status === "error") {
      throw outcome.error;
    }
    if (outcome.status === "superseded") {
      throw new Error("Score changed while playback was starting; press Play again");
    }
    if (outcome.status === "skipped") {
      throw new Error("Score apply was deferred; press Play again");
    }
    lastAppliedRequestRef.current = requestKey;
  };

  const startPlaybackWithSeedPath = async (sourcePath: SeedPath | null) => {
    if (playbackTransitionRef.current.kind !== "idle") {
      return;
    }
    setError(null);
    if (!switchRequest.ok) {
      setError(switchRequest.error);
      return;
    }
    // D4: channel-logic rules can no longer form a contradictory set (the editor
    // makes it unrepresentable and load-time auto-repair merges legacy patches),
    // so playback is never blocked on channel logic.
    if (!timelineLayerSourcesCoherent) {
      setPatchStatus("Waiting for timeline refresh before playback");
      return;
    }
    const startGeneration = playbackTransitionRef.current.generation + 1;
    playbackTransitionRef.current = {
      generation: startGeneration,
      kind: "starting",
    };
    setPlaybackTransitionKind("starting");
    const startConfigIntentKey = playbackConfigIntentKeyRef.current;
    const startOwnsTransition = () =>
      playbackTransitionRef.current.generation === startGeneration &&
      playbackTransitionRef.current.kind === "starting";
    const startIsCurrent = () =>
      startOwnsTransition() &&
      playbackConfigIntentKeyRef.current === startConfigIntentKey;
    const assertStartIsCurrent = () => {
      if (!startOwnsTransition()) {
        throw new Error("Playback start was cancelled");
      }
      if (playbackConfigIntentKeyRef.current !== startConfigIntentKey) {
        throw new Error(
          "Playback configuration changed while starting; press Play again"
        );
      }
    };
    const seedPathPlayback = seedPathPlaybackConfig(sourcePath);
    activePlaybackSeedPathRef.current = seedPathPlayback;
    const path = makeSeedPath(
      sourcePath
        ? `${sourcePath.name} replay ${new Date().toLocaleString()}`
        : `${name || "Untitled"} ${new Date().toLocaleString()}`,
      sourcePath?.id ?? null
    );
    if (sourcePath) {
      path.wildcardRules = sourcePath.wildcardRules.map((rule) => ({ ...rule }));
    }
    activeSeedRecordingRef.current = {
      ownerTrackId: parallelProjectRef.current?.activeTrackId ?? null,
      path,
    };
    activeSeedPathIdRef.current = path.id;
    setSeedPaths((current) => {
      const withoutNewPaths = current.filter(
        (item) => item.id !== path.id && item.id !== sourcePath?.id
      );
      return [path, ...(sourcePath ? [sourcePath] : []), ...withoutNewPaths].slice(0, 24);
    });
    if (sourcePath) {
      setQueuedSeedPathId(sourcePath.id);
    }
    setActiveSeedPathId(path.id);
    parallelBuildGenerationRef.current += 1;
    let transportPlayIssued = false;
    try {
      await applySwitchRequestNow(switchRequest.data, switchRequestKey);
      assertStartIsCurrent();
      const patch = await buildPatchDocument();
      assertStartIsCurrent();
      const parallelRequest = buildParallelPlaybackRequest(patch.project, seedPathPlayback);
      if (parallelRequest && "error" in parallelRequest) {
        throw new Error(parallelRequest.error);
      }
      if (parallelRequest) {
        runningParallelRef.current = true;
        const outcome = await queueParallelPlayback(
          parallelRequest,
          {},
          { force: true }
        );
        assertStartIsCurrent();
        requireLatestWrite(outcome, "Parallel playback configuration");
      } else {
        runningParallelRef.current = false;
        const tempoOutcome = await queueTempo(patch.transport.tempoBpm);
        assertStartIsCurrent();
        requireLatestWrite(tempoOutcome, "Transport tempo");
        const resetOutcome = await queueParallelPlayback(
          null,
          {},
          { force: true }
        );
        assertStartIsCurrent();
        requireLatestWrite(resetOutcome, "Parallel playback reset");
        const startPlaybackRequest = {
          ...trackPlaybackRequest,
          seedPath: seedPathPlayback,
        };
        const startPlaybackKey = trackPlaybackWriteKey(startPlaybackRequest);
        // As with score apply, do not join a same-key automatic task that is
        // still pending with an idle-only execution guard. Promote Play's
        // explicit unguarded write so it can drain during `starting`.
        if (playbackConfigQueueRef.current!.pending?.key === startPlaybackKey) {
          discardLatestWinsPending(playbackConfigQueueRef.current!);
        }
        const playbackOutcome = await queueTrackPlayback(startPlaybackRequest, {
          force: true,
        });
        assertStartIsCurrent();
        requireLatestWrite(playbackOutcome, "Generator playback configuration");
      }
      assertStartIsCurrent();
      transportPlayIssued = true;
      await transportPlay();
      assertStartIsCurrent();
      playbackSessionActiveRef.current = true;
    } catch (e) {
      const transitionCancelled = !startOwnsTransition();
      const newerStartOwnsTransition =
        playbackTransitionRef.current.kind === "starting" &&
        playbackTransitionRef.current.generation !== startGeneration;
      // Playback did not start; the runtime is not parallel-live.
      if (!newerStartOwnsTransition) {
        runningParallelRef.current = false;
        playbackSessionActiveRef.current = false;
        activePlaybackSeedPathRef.current = null;
        if (activeSeedRecordingRef.current?.path.id === path.id) {
          activeSeedRecordingRef.current = null;
        }
        if (activeSeedPathIdRef.current === path.id) {
          activeSeedPathIdRef.current = null;
        }
        setActiveSeedPathId(null);
      }
      setSeedPaths((current) => current.filter((item) => item.id !== path.id));
      if (
        !startIsCurrent() &&
        transportPlayIssued &&
        !newerStartOwnsTransition
      ) {
        // Stop may have raced the already-issued Play command. Reassert Stop
        // unless a newer start now owns the transition.
        try {
          await transportStop();
        } catch {
          // The user-visible Stop path owns any transport error.
        }
      }
      if (!transitionCancelled) {
        setError(String(e));
      }
    } finally {
      if (startOwnsTransition()) {
        playbackTransitionRef.current = {
          generation: startGeneration,
          kind: "idle",
        };
        setPlaybackTransitionKind("idle");
      }
    }
  };

  const canStartPlayback = switchRequest.ok && timelineLayerSourcesCoherent;
  const currentRhythmPreviewFailure = selectCurrentGeneratorPreviewFailure({
    failure: rhythmPreviewFailure,
    currentRequestKey: rhythmPreviewRequestKey,
    currentCycle: timelineLayoutCycle,
    generatorEnabled: rhythmPlaybackEnabled,
  });
  const evolveCachedPreviews = useMemo(
    () => {
      const byCycle = new Map<number, GeneratorPreview>();
      for (const cache of [evolvePreviewCache, rhythmResultCache]) {
        for (const [cycle, cached] of cache) {
          if (cached.requestKey === evolveRhythmPreviewRequestKey) {
            byCycle.set(cycle, cached.value);
          }
        }
      }
      return [...byCycle]
        .map(([cycle, preview]) => ({ cycle, preview }))
        .sort((left, right) => left.cycle - right.cycle);
    },
    [evolvePreviewCache, evolveRhythmPreviewRequestKey, rhythmResultCache]
  );
  const evolveTrace = useMemo(
    () => evolveCachedPreviews.flatMap(({ preview }) => preview.trace ?? []),
    [evolveCachedPreviews]
  );
  const playbackAvailability = selectPlaybackAvailability({
    canStartPlayback,
    failure: rhythmPreviewFailure,
    currentRequestKey: rhythmPreviewRequestKey,
    currentCycle: timelineLayoutCycle,
    generatorEnabled: rhythmPlaybackEnabled,
  });

  useEffect(() => {
    if (!window.__CAESURA_E2E__) return;
    publishCaesuraE2eState({
      transportIsPlaying,
      playbackStructureLocked,
      canStartPlayback,
      activeSeedPathId,
      activeSeedTraceCount:
        seedPaths.find((path) => path.id === activeSeedPathId)?.trace.length ?? 0,
      queuedSeedPathId,
      latestSeedTraceCycle: snapshot?.seedTraceEvents.at(-1)?.cycle ?? null,
      timelineLayoutCycle,
      timelinePreviewReady,
      timelineRhythmReady,
      timelineLayerSourcesCoherent,
      timelineRenderSyncing,
      timelinePreviewCycle: timelinePreview?.cycle ?? null,
      renderedTimelineLayoutCycle,
      renderedSectionCount: renderedResolvedSections.length,
      rhythmSpanCount: timelineRhythmResult?.spans.length ?? 0,
      transportEventCounts: {
        channelHocket: activeChannelHocketEvents.length,
      },
      visibleTransportEventCounts: {
        channelHocket: visibleChannelHocketEvents.length,
      },
      transportLayerVisibility: {
        channelHocket: showChannelHocketTransportRenderLayers,
      },
      switchRequest: switchRequest.ok
        ? {
            ok: true,
            cycleBeats: switchRequest.data.cycleBeats,
            inflectionCount: switchRequest.data.inflections.length,
            seedMode: switchRequest.data.seedMode,
          }
        : { ok: false, error: switchRequest.error },
      sections: resolvedSections.map((section) => ({
        sectionIndex: section.sectionIndex,
        startBeat: section.startBeat,
        endBeat: section.endBeat,
        gati: section.gati,
        effectiveGati: section.effectiveGati,
        jathi: section.jathi,
        timingMatras: section.timingMatras,
        beats: section.beats.map((beat) => ({
          beat: beat.beat,
          gati: beat.gati,
          effectiveGati: beat.effectiveGati,
          sectionStart: beat.sectionStart,
          accentVelocity: beat.accentVelocity,
          pitch: beat.pitch,
          automationTargets: beat.automationValues.map((value) => value.target),
        })),
      })),
      preview: timelinePreview
        ? {
            cycle: timelinePreview.cycle,
            beatCount: timelinePreview.beats.length,
            pulseSpanCount: timelinePreview.pulseSpans.length,
            sectionStartBeats: timelinePreview.beats
              .filter((beat) => beat.sectionStart)
              .map((beat) => beat.beat),
            beatGatis: timelinePreview.beats.map((beat) => beat.gati),
          }
        : null,
    });
  }, [
    activeChannelHocketEvents.length,
    activeSeedPathId,
    canStartPlayback,
    playbackStructureLocked,
    renderedResolvedSections.length,
    renderedTimelineLayoutCycle,
    resolvedSections,
    queuedSeedPathId,
    seedPaths,
    snapshot?.seedTraceEvents,
    showChannelHocketTransportRenderLayers,
    switchRequest,
    timelineLayerSourcesCoherent,
    timelineLayoutCycle,
    timelinePreview,
    timelinePreviewReady,
    timelineRenderSyncing,
    timelineRhythmReady,
    timelineRhythmResult,
    transportIsPlaying,
    visibleChannelHocketEvents.length,
  ]);

  const handlePlay = async () => {
    await startPlaybackWithSeedPath(queuedSeedPath);
  };

  const handleStop = async () => {
    if (playbackTransitionRef.current.kind === "stopping") {
      return;
    }
    const stopGeneration = playbackTransitionRef.current.generation + 1;
    playbackTransitionRef.current = {
      generation: stopGeneration,
      kind: "stopping",
    };
    setPlaybackTransitionKind("stopping");
    setError(null);
    parallelBuildGenerationRef.current += 1;
    invalidatePlaybackConfigIntent();
    let stopped = false;
    try {
      await transportStop();
      // The parallel runtime is no longer live; staged single-track config edits
      // may flow to the transport again for the next Play.
      runningParallelRef.current = false;
      playbackSessionActiveRef.current = false;
      activePlaybackSeedPathRef.current = null;
      const completedRecording = activeSeedRecordingRef.current;
      if (completedRecording) {
        setSeedPaths((current) =>
          current.some((path) => path.id === completedRecording.path.id)
            ? upsertSeedPath(current, completedRecording.path)
            : current
        );
        const projectWithRecording = projectWithSeedRecording(
          parallelProjectRef.current,
          completedRecording
        );
        if (projectWithRecording !== parallelProjectRef.current) {
          parallelProjectRevisionRef.current += 1;
          parallelProjectRef.current = projectWithRecording;
          setParallelProject(projectWithRecording);
        }
      }
      activeSeedRecordingRef.current = null;
      activeSeedPathIdRef.current = null;
      stopped = true;
      setActiveSeedPathId(null);
      setQueuedSeedPathId(null);
    } catch (e) {
      setError(String(e));
    } finally {
      if (
        playbackTransitionRef.current.generation === stopGeneration &&
        playbackTransitionRef.current.kind === "stopping"
      ) {
        playbackTransitionRef.current = {
          generation: stopGeneration,
          kind: "idle",
        };
        setPlaybackTransitionKind("idle");
        if (stopped) {
          setSingleTrackOwnershipEpoch((current) => current + 1);
        }
      }
    }
  };

  const handleResetTransportSync = async () => {
    setError(null);
    try {
      await transportResync();
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      const nextSnapshot = await transportGetSnapshot();
      acceptTransportSnapshot(nextSnapshot);
      setPatchStatus("Timeline and playback sync reset");
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSynthToggle = async () => {
    if (synthPending || synthToggleInFlightRef.current) {
      return;
    }
    synthToggleInFlightRef.current = true;
    setError(null);
    setSynthPending(true);
    try {
      const next = !synthEnabled;
      if (next) {
        const programsOutcome = await queueSynthPrograms(synthProgramRequest);
        if (
          programsOutcome.status === "superseded" ||
          programsOutcome.status === "skipped"
        ) {
          return;
        }
        if (programsOutcome.status === "error") {
          throw programsOutcome.error;
        }
      }
      const enabledOutcome = await queueSynthEnabled(next);
      if (
        enabledOutcome.status === "superseded" ||
        enabledOutcome.status === "skipped"
      ) {
        return;
      }
      if (enabledOutcome.status === "error") {
        throw enabledOutcome.error;
      }
      setSynthEnabled(next);
    } catch (e) {
      setError(String(e));
    } finally {
      synthToggleInFlightRef.current = false;
      setSynthPending(false);
    }
  };

  const commitTempo = async (value = tempoInput) => {
    tempoEditingRef.current = false;
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed) && parsed >= 20 && parsed <= 400) {
      try {
        const nextTempo = clamp(parsed, 20, 400);
        authoredTempoBpmRef.current = nextTempo;
        const outcome = await queueTempo(nextTempo);
        if (outcome.status === "error") throw outcome.error;
      } catch (e) {
        setError(String(e));
      }
    } else if (snapshot) {
      setTempoInput(snapshot.tempoBpm.toFixed(1));
    }
  };

  const commitActiveTrackTempo = async (value = tempoInput) => {
    tempoEditingRef.current = false;
    const fallbackBpm = activeProjectTrackForAutomation?.customTempoBpm;
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 20 || parsed > 400) {
      if (fallbackBpm !== undefined) {
        setTempoInput(fallbackBpm.toFixed(1));
      }
      setPatchStatus("Track BPM needs a number from 20 to 400");
      return;
    }
    if (!activeTrackUsesCustomTempo || !parallelProject) {
      await commitTempo(value);
      return;
    }
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      if (fallbackBpm !== undefined) {
        setTempoInput(fallbackBpm.toFixed(1));
      }
      setPatchStatus("Stop playback before changing track BPM");
      return;
    }

    const nextBpm = clamp(Math.round(parsed * 10) / 10, 20, 400);
    authoredTempoBpmRef.current = nextBpm;
    setError(null);
    try {
      setTempoInput(nextBpm.toFixed(1));
      await updateParallelProjectMetadata(
        (project) => ({
          ...project,
          tracks: project.tracks.map((track) =>
            track.id === project.activeTrackId
              ? { ...track, customTempoBpm: nextBpm }
              : track
          ),
        }),
        "Updated track BPM"
      );
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed while updating track BPM");
        return;
      }
      if (!parallelPlaybackRuntimeEnabled) {
        const outcome = await queueTempo(nextBpm);
        if (outcome.status === "error") throw outcome.error;
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const capturePatchDocumentState = () => {
    // Capture every React/project field before the backend await. Otherwise an
    // edit made while scoreGetCurrent is pending can produce a patch that mixes
    // an older flat state with a newer project wrapper.
    const recordingSession = activeSeedRecordingRef.current;
    const projectSnapshot = projectWithSeedRecording(
      parallelProjectRef.current === null
        ? null
        : clonePatchJson(parallelProjectRef.current),
      recordingSession
    );
    const capturedSeedPaths = seedPathsForSelectedTrack(
      seedPaths,
      projectSnapshot?.activeTrackId ?? null,
      recordingSession
    );
    const tempoBpm = clamp(authoredTempoBpmRef.current, 20, 400);
    const savedGlobalHistory =
      seedMode === "history" && preview?.historySeeds.length
        ? preview.historySeeds
        : parseSeeds(historySeedsInput);
    const savedChannelHistory = channelHocketHistorySeeds;
    const compatibilityDefaults = createNeutralPatchDocument({
      seed,
      tempoBpm,
      cycleBeats,
      savedAt: new Date().toISOString(),
    });

    const flat: SequencerPatchFlatState = {
      app: PATCH_APP_ID,
      schemaVersion: PATCH_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      transport: {
        tempoBpm,
        synthEnabled,
        synthPrograms: synthProgramRequest,
        rhythmPlaybackEnabled: generatorEnabled,
        currentScoreId: snapshot?.currentScoreId ?? null,
        cycleTempoFlux: compatibilityDefaults.transport.cycleTempoFlux,
      },
      sequencer: {
        // Legacy field: the Cycle editor merged into Sections and Subdivisions.
        scoreSetupOpen: false,
        randomize: compatibilityDefaults.sequencer.randomize,
        probabilityOpen: false,
        boundariesOpen,
        maxSectionsHelpOpen,
        name,
        cycleBeats,
        initialWeights: cloneWeights(initialWeights),
        initialJathiWeights: cloneJathiWeights(initialJathiWeights),
        initialJathiBhedam: cloneJathiBhedam(initialJathiBhedam),
        initialCustomSubdivision: customSubdivisionForRequest(initialCustomSubdivision),
        boundaries: normalizeBoundaries(boundaries, cycleBeats).map((boundary) => ({
          ...boundary,
          weights: cloneWeights(boundary.weights),
          jathiWeights: cloneJathiWeights(boundary.jathiWeights),
          jathiBhedam: cloneJathiBhedam(boundary.jathiBhedam),
          customSubdivision: customSubdivisionForRequest(boundary.customSubdivision),
        })),
        selectedBoundaryAfterBeat,
        sectionCountWeights: sectionCountWeights.map((weight) => ({ ...weight })),
        seedMode: normalizeSeedMode(seedMode),
        seed,
        historySeeds: savedGlobalHistory,
        historyWeight,
        newSeedWeight,
        maxHistory,
        newSeedChance,
        holdChance,
        blendCycles,
        singleParameterRhythmicModulation,
        pitch,
        velocity,
        accent: {
          beatStart: cleanAccentRange(beatAccentMin, beatAccentMax),
          sectionStartExtra: cleanAccentRange(sectionAccentMin, sectionAccentMax),
          jathiStart: cleanAccentRange(jathiAccentMin, jathiAccentMax),
          jathiMode: jathiAccentMode,
        },
        userPreviewCycle,
      },
      generatorEnabled,
      generator: generatorConfig,
      automation: cloneAutomationSet(automationSet),
      rhythm: compatibilityDefaults.rhythm,
      pitchShaper: compatibilityDefaults.pitchShaper,
      channelHocket: {
        ...compatibilityDefaults.channelHocket,
        open: channelHocketOpen,
        enabled: channelHocketEnabled,
        outputChannel: midiOutputChannel,
        order: channelHocketOrder,
        channels: [...channelHocketChannels],
        weights: { ...channelHocketWeights },
        fallback: channelHocketFallback,
        fallbackWeights: { ...channelHocketFallbackWeights },
        entryWeights: { ...channelHocketEntryWeights },
        seed: channelHocketSeed,
        seedBehavior: channelHocketSeedBehavior,
        historySeeds: savedChannelHistory,
        historyWeight: channelHocketHistoryWeight,
        newSeedWeight: channelHocketNewSeedWeight,
        maxHistory: channelHocketMaxHistory,
        newSeedChance: channelHocketNewSeedChance,
        holdChance: channelHocketHoldChance,
        blendCycles: channelHocketBlendCycles,
        accentRules: cloneChannelAccentRules(channelAccentRules),
        positionRules: cloneChannelPositionRules(channelPositionRules),
        assignMode: channelHocketAssignMode,
        euclid: {
          ...channelHocketEuclid,
          layers: channelHocketEuclid.layers.map((layer) => ({ ...layer })),
        },
      },
      setup: {
        open: setupOpen,
        tab: setupTab,
        // Kept in the wire shape for older readers, but always canonical: the
        // live values belong to this machine and must not leak into projects.
        autosaveEnabled: PATCH_SETUP_COMPATIBILITY_DEFAULTS.autosaveEnabled,
        autosaveIntervalMs:
          PATCH_SETUP_COMPATIBILITY_DEFAULTS.autosaveIntervalMs,
        autoloadRecentSession:
          PATCH_SETUP_COMPATIBILITY_DEFAULTS.autoloadRecentSession,
      },
      ui: {
        synthPropertiesOpen,
        midiDebugOpen,
        midiDebugLimit,
        automationDebugOpen,
        automationDebugLimit,
        seedSetupOpen,
        seedSetupTab,
        seedLogScope,
        automationOpen,
        timelineAutomationTargetIds: [...timelineAutomationTargetIds],
        channelLogicHelpOpen,
      },
      seedPaths: capturedSeedPaths,
      scoreSnapshot: null,
    };
    return { flat, projectSnapshot };
  };

  const buildPatchDocument = async (): Promise<SequencerPatchDocument> => {
    const { flat, projectSnapshot } = capturePatchDocumentState();
    const scoreSnapshot = await scoreGetCurrent().catch(() => null);
    return withProjectState({ ...flat, scoreSnapshot }, projectSnapshot);
  };

  buildPatchDocumentRef.current = buildPatchDocument;
  currentAuthoredPatchFingerprintRef.current = () => {
    const { flat, projectSnapshot } = capturePatchDocumentState();
    return patchContentFingerprint(withProjectState(flat, projectSnapshot));
  };

  const currentAuthoredPatchFingerprint = () =>
    currentAuthoredPatchFingerprintRef.current?.() ??
    currentPatchFingerprintRef.current;

  const patchBuildStillMatchesCurrentAuthoring = (
    patch: SequencerPatchDocument,
    startedAuthoringGeneration: number,
    startedAuthoredFingerprint: string
  ) =>
    startedAuthoringGeneration === authoringInteractionGenerationRef.current &&
    patchContentFingerprint(patch) === startedAuthoredFingerprint;

  const applyPatchDocument = async (
    patch: SequencerPatchDocument,
    options: { syncTransport?: boolean; suppressPlaybackApply?: boolean } = {}
  ) => {
    const applicationGeneration = patchApplyGenerationRef.current + 1;
    patchApplyGenerationRef.current = applicationGeneration;
    discardEditorDrafts();
    authoringInteractionGenerationRef.current += 1;
    randomizeGenerationRef.current += 1;
    // Transient overlays and track-flow actions are not patch data. Leaving
    // them alive would let a frozen old-document draft apply after hydration.
    setPitchImportOpen(false);
    setTransferMatrixOpen(false);
    setMatrixBoxId(null);
    setPendingDeleteTrackId(null);
    setRenamingParallelTrackId(null);
    setRenamingBoxId(null);
    setAutomationFocusPanel(null);
    setTimelineAutomationPickerOpen(false);
    pointerTrackDragCleanupRef.current?.();
    pointerTrackDragCleanupRef.current = null;
    pointerTrackDragRef.current = null;
    suppressTrackClickRef.current = null;
    setDraggingTrackId(null);
    setDragOverTarget(null);
    const syncTransport = options.syncTransport ?? true;
    const suppressPlaybackApply = options.suppressPlaybackApply ?? false;
    suppressScoreApplyRef.current = suppressPlaybackApply;
    suppressPlaybackConfigApplyRef.current = suppressPlaybackApply;
    if (suppressPlaybackApply) {
      parallelBuildGenerationRef.current += 1;
      invalidatePlaybackConfigIntent();
    }
    isApplyingPatchRef.current = true;
    // Invalidate recovery work as soon as hydration begins, before any
    // transport await can let the previous document's autosave finish.
    autosaveGenerationRef.current += 1;
    lastAppliedRequestRef.current = "";
    tempoEditingRef.current = false;

    setError(null);
    setPreviewError(null);
    setRhythmPreviewFailure(null);
    setPatchStatus(null);

    // Publish the project wrapper before transport IPC. Metadata edits made
    // while that IPC is pending now compose on this incoming project instead
    // of being overwritten when hydration resumes.
    parallelProjectRevisionRef.current += 1;
    parallelProjectRef.current = patch.project;
    setParallelProject(patch.project);

    const transportReferenceTempo = transportReferenceTempoForPatch(patch);
    authoredTempoBpmRef.current = patch.transport.tempoBpm;
    setTempoInput(patch.transport.tempoBpm.toFixed(1));
    const nextSynthPrograms = synthProgramsToRequest(
      normalizeSynthPrograms(patch.transport.synthPrograms)
    );
    setSynthPrograms(nextSynthPrograms);
    setSynthEnabled(patch.transport.synthEnabled);
    setGeneratorEnabled(patch.generatorEnabled);
    setGeneratorKind(patch.generator.kind);
    if (patch.generator.kind === "example") {
      setGeneratorDensityPercent(patch.generator.densityPercent);
    } else {
      setDumkaPattern(patch.generator.pattern);
      setDumkaEvolutionRate(patch.generator.evolutionRate);
      setDumkaBarlowTemperature(patch.generator.barlowTemperature);
      setDumkaOpWeights({
        barlowRemove: patch.generator.weightBarlowRemove,
        barlowAdd: patch.generator.weightBarlowAdd,
        rotate: patch.generator.weightRotate,
        syncopate: patch.generator.weightSyncopate,
        desyncopate: patch.generator.weightDesyncopate,
        fragment: patch.generator.weightFragment,
        consolidate: patch.generator.weightConsolidate,
        euclid: patch.generator.weightEuclid,
      });
      setDumkaFillComplexity(patch.generator.fillComplexity);
      setDumkaEuclidMaxRun(patch.generator.euclidMaxRun);
      setDumkaEuclidInvert(patch.generator.euclidInvert);
      setDumkaEuclidRestPolicy(patch.generator.euclidRestPolicy);
      setDumkaDriftLeash(patch.generator.driftLeash);
      setDumkaDensityFloor(patch.generator.densityFloor);
      setDumkaDensityCeiling(patch.generator.densityCeiling);
      setDumkaPlan(patch.generator.plan.map((directive) => ({
        ...directive,
        scope: directive.scope ? { ...directive.scope } : null,
        options: { ...directive.options },
      })));
      setDumkaPlanLengthCycles(patch.generator.planLengthCycles);
    }
    setGeneratorSeedMode(patch.generator.seedMode.type);
    setGeneratorSeed(patch.generator.seedMode.seed);
    setSynthPropertiesOpen(patch.ui.synthPropertiesOpen);
    setMidiDebugOpen(patch.ui.midiDebugOpen);
    setMidiDebugLimit(normalizeMidiDebugLimit(patch.ui.midiDebugLimit));
    setAutomationDebugOpen(patch.ui.automationDebugOpen);
    setAutomationDebugLimit(
      normalizeAutomationDebugLimit(patch.ui.automationDebugLimit)
    );
    setSeedSetupOpen(patch.ui.seedSetupOpen);
    setSeedSetupTab(patch.ui.seedSetupTab);
    setSeedLogScope(patch.ui.seedLogScope);
    setAutomationOpen(patch.ui.automationOpen);
    setTimelineAutomationTargetIds(patch.ui.timelineAutomationTargetIds);
    setChannelLogicHelpOpen(patch.ui.channelLogicHelpOpen);
    setAutomationSet(cloneAutomationSet(patch.automation));
    if (suppressPlaybackApply) {
      setSeedPaths(
        seedPathsForSelectedTrack(
          patch.seedPaths,
          patch.project.activeTrackId,
          activeSeedRecordingRef.current
        )
      );
    } else {
      activeSeedRecordingRef.current = null;
      activeSeedPathIdRef.current = null;
      setSeedPaths(patch.seedPaths);
      // A real document replacement owns neither session. A live track switch,
      // however, is only a view change over this same document/runtime; clearing
      // these ids would silently stop seed recording and discard the queued take.
      setActiveSeedPathId(null);
      setQueuedSeedPathId(null);
    }

    setProbabilityOpen(false);
    setBoundariesOpen(
      patch.sequencer.boundariesOpen ||
        patch.sequencer.probabilityOpen ||
        // Legacy: an open Cycle editor now opens the merged Sections editor.
        patch.sequencer.scoreSetupOpen
    );
    setMaxSectionsHelpOpen(patch.sequencer.maxSectionsHelpOpen);
    setName(patch.sequencer.name);
    setCycleBeats(patch.sequencer.cycleBeats);
    setInitialWeights(cloneWeights(patch.sequencer.initialWeights));
    setInitialJathiWeights(cloneJathiWeights(patch.sequencer.initialJathiWeights));
    setInitialJathiBhedam(cloneJathiBhedam(patch.sequencer.initialJathiBhedam ?? null));
    setInitialCustomSubdivision(
      cloneCustomSubdivision(patch.sequencer.initialCustomSubdivision)
    );
    setBoundaries(normalizeBoundaries(patch.sequencer.boundaries, patch.sequencer.cycleBeats));
    setSelectedBoundaryAfterBeat(patch.sequencer.selectedBoundaryAfterBeat);
    setSectionCountWeights(patch.sequencer.sectionCountWeights.map((w) => ({ ...w })));
    if (patch.sequencer.seed !== seed) {
      skipNextGlobalSeedStartupPersistRef.current = true;
    }
    setSeedMode(patch.sequencer.seedMode);
    setSeed(patch.sequencer.seed);
    setHistorySeedsInput(formatSeeds(patch.sequencer.historySeeds));
    setHistoryWeight(patch.sequencer.historyWeight);
    setNewSeedWeight(patch.sequencer.newSeedWeight);
    setMaxHistory(patch.sequencer.maxHistory);
    setNewSeedChance(patch.sequencer.newSeedChance);
    setHoldChance(patch.sequencer.holdChance);
    setBlendCycles(patch.sequencer.blendCycles);
    setSingleParameterRhythmicModulation(
      patch.sequencer.singleParameterRhythmicModulation
    );
    setPitch(patch.sequencer.pitch);
    setVelocity(patch.sequencer.velocity);
    setBeatAccentMin(patch.sequencer.accent.beatStart.min);
    setBeatAccentMax(patch.sequencer.accent.beatStart.max);
    setSectionAccentMin(patch.sequencer.accent.sectionStartExtra.min);
    setSectionAccentMax(patch.sequencer.accent.sectionStartExtra.max);
    setJathiAccentMin(patch.sequencer.accent.jathiStart.min);
    setJathiAccentMax(patch.sequencer.accent.jathiStart.max);
    setJathiAccentMode(patch.sequencer.accent.jathiMode);
    setUserPreviewCycle(patch.sequencer.userPreviewCycle);

    setChannelHocketOpen(patch.channelHocket.open);
    setChannelHocketEnabled(patch.channelHocket.enabled);
    setMidiOutputChannel(patch.channelHocket.outputChannel);
    setChannelHocketOrder(patch.channelHocket.order);
    setChannelHocketChannels(patch.channelHocket.channels);
    setChannelHocketFallback(
      patch.channelHocket.channels.includes(patch.channelHocket.fallback)
        ? patch.channelHocket.fallback
        : patch.channelHocket.channels[0] ?? 1
    );
    setChannelHocketWeights({ ...patch.channelHocket.weights });
    setChannelHocketFallbackWeights({ ...patch.channelHocket.fallbackWeights });
    setChannelHocketEntryWeights({ ...patch.channelHocket.entryWeights });
    setChannelHocketAssignMode(patch.channelHocket.assignMode);
    setChannelHocketEuclid({
      ...patch.channelHocket.euclid,
      layers: patch.channelHocket.euclid.layers.map((layer) => ({ ...layer })),
    });
    setChannelHocketSeed(patch.channelHocket.seed);
    setChannelHocketSeedBehavior(patch.channelHocket.seedBehavior);
    setChannelHocketHistorySeedsInput(formatSeeds(patch.channelHocket.historySeeds));
    setChannelHocketHistoryWeight(patch.channelHocket.historyWeight);
    setChannelHocketNewSeedWeight(patch.channelHocket.newSeedWeight);
    setChannelHocketMaxHistory(patch.channelHocket.maxHistory);
    setChannelHocketNewSeedChance(patch.channelHocket.newSeedChance);
    setChannelHocketHoldChance(patch.channelHocket.holdChance);
    setChannelHocketBlendCycles(patch.channelHocket.blendCycles);
    setChannelAccentRules(cloneChannelAccentRules(patch.channelHocket.accentRules));
    setChannelPositionRules(cloneChannelPositionRules(patch.channelHocket.positionRules));
    setSetupOpen(patch.setup.open);
    setSetupTab(patch.setup.tab);
    // patch.setup's autosave fields are write-only compatibility: they are
    // still serialized (older builds read them) but MACHINE preferences are
    // never applied from a document — loading someone else's patch must not
    // rewrite this machine's autosave behavior. See machinePrefs.ts.

    // Hydrate every React field before the first transport await. A failed or
    // superseded sync can then leave playback needing attention, but it cannot
    // leave the project wrapper and visible active-track editor from different
    // documents. Superseded writes represent a newer user/app intent and are
    // intentionally not surfaced as failures.
    const transportSyncErrors: unknown[] = [];
    const collectTransportSync = async (
      work: Promise<EnsuredLatestWinsOutcome<void>>
    ) => {
      const outcome = await work;
      if (outcome.status === "error") {
        transportSyncErrors.push(outcome.error);
      }
    };
    if (syncTransport) {
      // Claim all three desired keys before yielding. If the user changes one
      // of them while another command is slow, the later user intent then
      // supersedes this hydration write instead of being overwritten by it.
      const transportSyncWrites = [
        queueTempo(transportReferenceTempo),
        queueSynthPrograms(nextSynthPrograms),
        queueSynthEnabled(patch.transport.synthEnabled),
      ];
      await Promise.all(transportSyncWrites.map(collectTransportSync));
    }
    window.setTimeout(() => {
      if (patchApplyGenerationRef.current === applicationGeneration) {
        isApplyingPatchRef.current = false;
      }
    }, 0);
    markPersistenceForFingerprint(currentAuthoredPatchFingerprint());
    if (
      transportSyncErrors.length > 0 &&
      patchApplyGenerationRef.current === applicationGeneration
    ) {
      setError(
        `Patch loaded, but transport sync failed: ${String(
          transportSyncErrors[0]
        )}`
      );
    }
    if (
      patch.loadWarnings?.length &&
      patchApplyGenerationRef.current === applicationGeneration
    ) {
      setPatchStatus(patch.loadWarnings.join(" "));
    }
  };

  const applyParallelProject = async (
    project: ParallelProjectPatch,
    status: string,
    sourcePatch?: SequencerPatchDocument,
    options: { syncTransport?: boolean; suppressPlaybackApply?: boolean } = {}
  ) => {
    const basePatch = sourcePatch ?? (await buildPatchDocument());
    const nextPatch = readPatchDocument({
      ...basePatch,
      schemaVersion: PATCH_SCHEMA_VERSION,
      project,
    });
    await applyPatchDocument(nextPatch, options);
    markPersistenceForFingerprint(currentAuthoredPatchFingerprint());
    setPatchStatus(status);
  };

  const updateParallelProjectMetadata = async (
    updater: (project: ParallelProjectPatch) => ParallelProjectPatch,
    status: string
  ) => {
    const project = updateCurrentValue(
      parallelProjectRef,
      clonePatchJson,
      updater,
      normalizeInteractiveProjectMetadata
    );
    if (!project) return;
    parallelProjectRevisionRef.current += 1;
    setParallelProject(project);
    markPatchDirty();
    if (status) setPatchStatus(status);
  };

  const handleSelectParallelTrack = async (trackId: string) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (playbackTransitionRef.current.kind !== "idle") {
      setPatchStatus("Wait for playback to finish changing before switching tracks");
      return;
    }
    const generation = ++trackSelectionGenerationRef.current;
    const projectRevision = parallelProjectRevisionRef.current;
    // Even selecting the currently shown track invalidates an older selection
    // still waiting on its patch snapshot (A -> B -> A must finish on A).
    if (trackId === parallelProjectRef.current?.activeTrackId) return;
    const authoringGeneration = authoringInteractionGenerationRef.current;
    const viewOnlyWhilePlaying =
      playbackSessionActiveRef.current || (snapshot?.isPlaying ?? false);
    setError(null);
    setRenamingParallelTrackId(null);
    try {
      await flushFocusedEditorDraft();
      if (
        transitionGeneration !== playbackTransitionRef.current.generation ||
        playbackTransitionRef.current.kind !== "idle"
      ) {
        setPatchStatus("Playback changed while switching tracks; try again");
        return;
      }
      if (authoringGeneration !== authoringInteractionGenerationRef.current) {
        setPatchStatus("Editor changed while switching tracks; try again");
        return;
      }
      const authoredFingerprint = currentAuthoredPatchFingerprint();
      const patch = await buildPatchDocument();
      if (
        generation !== trackSelectionGenerationRef.current ||
        projectRevision !== parallelProjectRevisionRef.current ||
        transitionGeneration !== playbackTransitionRef.current.generation ||
        playbackTransitionRef.current.kind !== "idle"
      ) {
        return;
      }
      if (
        !patchBuildStillMatchesCurrentAuthoring(
          patch,
          authoringGeneration,
          authoredFingerprint
        )
      ) {
        setPatchStatus("Track changed while switching; try again");
        return;
      }
      const project = {
        ...clonePatchJson(patch.project),
        activeTrackId: trackId,
      };
      const trackIndex = Math.max(
        0,
        project.tracks.findIndex((track) => track.id === trackId)
      );
      await applyParallelProject(
        project,
        viewOnlyWhilePlaying
          ? `Showing Track ${trackIndex + 1} while playback continues`
          : `Showing Track ${trackIndex + 1}`,
        patch,
        {
          // Selecting a view must not resend unchanged global tempo/synth state.
          syncTransport: false,
          suppressPlaybackApply: viewOnlyWhilePlaying,
        }
      );
      if (
        transitionGeneration !== playbackTransitionRef.current.generation ||
        playbackTransitionRef.current.kind !== "idle"
      ) {
        return;
      }
      if (!viewOnlyWhilePlaying && !parallelRuntimeWouldEngage(project.tracks)) {
        const selectedTrack = project.tracks.find(
          (track) => track.id === project.activeTrackId
        );
        const selectedTempo =
          selectedTrack?.tempoMode === "custom"
            ? selectedTrack.customTempoBpm
            : project.global.tempoBpm;
        const outcome = await queueTempo(selectedTempo);
        if (outcome.status === "error") throw outcome.error;
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleExportTrack = async (trackId: string) => {
    const authoringGeneration = authoringInteractionGenerationRef.current;
    setError(null);
    setPatchStatus(null);
    try {
      // Flush any live editor state into the project before exporting, so the
      // saved track reflects exactly what the user sees.
      await flushFocusedEditorDraft();
      if (authoringGeneration !== authoringInteractionGenerationRef.current) {
        setPatchStatus("Editor changed while preparing export; try again");
        return;
      }
      const authoredFingerprint = currentAuthoredPatchFingerprint();
      const patch = await buildPatchDocument();
      if (
        !patchBuildStillMatchesCurrentAuthoring(
          patch,
          authoringGeneration,
          authoredFingerprint
        )
      ) {
        setPatchStatus("Track changed while preparing export; try again");
        return;
      }
      const track = patch.project.tracks.find((candidate) => candidate.id === trackId);
      if (!track) {
        setPatchStatus("Track not found");
        return;
      }
      const envelope = buildTrackEnvelope(track, {
        tempoBpm: patch.project.global.tempoBpm,
        cycleBeats: patch.project.global.cycleBeats,
      });
      const path = await trackChooseSavePath(defaultTrackFilename(track.name));
      if (!path) return;
      await trackSaveToPath(path, envelope);
      setPatchStatus(`Exported track "${track.name}": ${path}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleImportTrack = async () => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before importing a track");
      return;
    }
    const authoringGeneration = authoringInteractionGenerationRef.current;
    setError(null);
    setPatchStatus(null);
    try {
      await flushFocusedEditorDraft();
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed before choosing an import file; try again");
        return;
      }
      if (authoringGeneration !== authoringInteractionGenerationRef.current) {
        setPatchStatus("Editor changed before choosing an import file; try again");
        return;
      }
      const path = await trackChooseOpenPath();
      if (!path) {
        setPatchStatus("Track import cancelled before reading a file");
        return;
      }
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed after choosing the import file; try again");
        return;
      }
      const raw = await trackLoadFromPath(path);
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed while reading the import file; try again");
        return;
      }
      const {
        track: importedTrack,
        globalContext,
        loadWarnings: trackLoadWarnings,
      } = readTrackEnvelope(raw);
      const projectRevision = parallelProjectRevisionRef.current;
      const capturedDestination = capturePatchDocumentState();
      const destinationProject =
        parallelProjectRef.current ??
        withProjectState(
          capturedDestination.flat,
          capturedDestination.projectSnapshot
        ).project;
      if (destinationProject.tracks.length >= MAX_PARALLEL_TRACKS) {
        setPatchStatus(`Maximum ${MAX_PARALLEL_TRACKS} tracks reached`);
        return;
      }
      const destinationGlobal = {
        tempoBpm: destinationProject.global.tempoBpm,
        cycleBeats: destinationProject.global.cycleBeats,
      };
      const savedTempoBpm =
        importedTrack.tempoMode === "custom"
          ? importedTrack.customTempoBpm
          : globalContext?.tempoBpm ?? destinationGlobal.tempoBpm;
      const savedCycleBeats =
        importedTrack.cycleLengthMode === "custom"
          ? importedTrack.customCycleBeats
          : globalContext?.cycleBeats ?? destinationGlobal.cycleBeats;
      const keepTrackLocalTiming = await trackAskKeepTimingOnImport(
        importedTrack.name,
        savedTempoBpm,
        savedCycleBeats,
        destinationGlobal.tempoBpm,
        destinationGlobal.cycleBeats
      );
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed while choosing imported timing; try again");
        return;
      }
      if (projectRevision !== parallelProjectRevisionRef.current) {
        setPatchStatus("Project changed while choosing imported timing; try again");
        return;
      }
      const authoredFingerprint = currentAuthoredPatchFingerprint();
      const patch = await buildPatchDocument();
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus(
          "Playback changed while snapshotting the import destination; try again"
        );
        return;
      }
      if (projectRevision !== parallelProjectRevisionRef.current) {
        setPatchStatus(
          "Project changed while snapshotting the import destination; try again"
        );
        return;
      }
      if (
        !patchBuildStillMatchesCurrentAuthoring(
          patch,
          authoringGeneration,
          authoredFingerprint
        )
      ) {
        setPatchStatus(
          "Authored track state changed while snapshotting the import destination; try again"
        );
        return;
      }
      const project = spliceImportedTrack(
        clonePatchJson(patch.project),
        importedTrack,
        {
          keepTrackLocalTiming,
          importedGlobalContext: globalContext,
          destinationGlobal,
          preferredName: importedTrack.name,
        }
      );
      const activeTrack = project.tracks.find(
        (candidate) => candidate.id === project.activeTrackId
      );
      await applyParallelProject(
        project,
        `Imported track "${activeTrack?.name ?? importedTrack.name}"${
          trackLoadWarnings.length ? ` · ${trackLoadWarnings.join(" ")}` : ""
        }`,
        patch
      );
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCreateParallelTrack = async (duplicateActive: boolean) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before adding tracks");
      return;
    }
    const authoringGeneration = authoringInteractionGenerationRef.current;
    const projectRevision = parallelProjectRevisionRef.current;
    setError(null);
    try {
      await flushFocusedEditorDraft();
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed while adding the track; try again");
        return;
      }
      if (authoringGeneration !== authoringInteractionGenerationRef.current) {
        setPatchStatus("Editor changed while adding the track; try again");
        return;
      }
      const authoredFingerprint = currentAuthoredPatchFingerprint();
      const patch = await buildPatchDocument();
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed while adding the track; try again");
        return;
      }
      if (projectRevision !== parallelProjectRevisionRef.current) {
        setPatchStatus("Project changed while adding the track; try again");
        return;
      }
      if (
        !patchBuildStillMatchesCurrentAuthoring(
          patch,
          authoringGeneration,
          authoredFingerprint
        )
      ) {
        setPatchStatus("Track changed while adding the track; try again");
        return;
      }
      const project = clonePatchJson(patch.project);
      if (project.tracks.length >= MAX_PARALLEL_TRACKS) {
        setPatchStatus(`Maximum ${MAX_PARALLEL_TRACKS} tracks reached`);
        return;
      }
      const sourceTrack =
        project.tracks.find((track) => track.id === project.activeTrackId) ??
        project.tracks[0];
      if (duplicateActive && !sourceTrack) {
        setPatchStatus("No source track available");
        return;
      }
      const nextIndex = project.tracks.length;
      const nextName = duplicateActive
        ? `${sourceTrack?.name || "Track"} copy`
        : defaultParallelTrackName(project.tracks);
      const nextTrackId = uniqueParallelTrackId(`track-${nextIndex + 1}`, project.tracks);
      const nextTrackColor = nextParallelTrackColor(nextIndex);
      let nextTrack: ParallelTrackPatch;
      if (duplicateActive) {
        nextTrack = clonePatchJson(sourceTrack!);
        nextTrack.id = nextTrackId;
        nextTrack.name = nextName;
        nextTrack.color = nextTrackColor;
        nextTrack.muted = false;
        nextTrack.soloed = false;
      } else {
        const neutralPatch = createNeutralPatchDocument({
          seed: datetimeSeedForNewParallelTrack(project.tracks),
          trackId: nextTrackId,
          trackName: nextName,
          trackColor: nextTrackColor,
          tempoBpm: project.global.tempoBpm,
          cycleBeats: project.global.cycleBeats,
          setupPreferences: {
            autosaveEnabled,
            autosaveIntervalMs,
            autoloadRecentSession,
          },
        });
        const neutralTrack = neutralPatch.project.tracks[0];
        if (!neutralTrack) {
          setPatchStatus("Could not create a neutral track");
          return;
        }
        nextTrack = clonePatchJson(neutralTrack);
        nextTrack.tempoMode = "global";
        nextTrack.customTempoBpm = project.global.tempoBpm;
        nextTrack.cycleLengthMode = "global";
        nextTrack.customCycleBeats = project.global.cycleBeats;
      }
      project.tracks = [...project.tracks, nextTrack];
      project.activeTrackId = nextTrack.id;
      const addEndpoints = runtimeEndpointTrackIds(
        project.tracks,
        project.global.trackFlowBoxes
      );
      project.global.conflictPriority = normalizedConflictPriority(
        [...project.global.conflictPriority, nextTrack.id],
        addEndpoints
      );
      project.global.channelLogicMatrix = normalizeChannelLogicMatrix(
        project.global.channelLogicMatrix,
        addEndpoints,
        project.global.channelConflictPolicy
      );
      await applyParallelProject(
        project,
        duplicateActive ? "Duplicated active track" : "Added track",
        patch
      );
    } catch (e) {
      setError(String(e));
    }
  };

  const requestRemoveParallelTrack = (trackId: string) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before removing tracks");
      return;
    }
    if (parallelTrackTabs.length <= 1) {
      setPatchStatus("Keep at least one track");
      return;
    }
    setError(null);
    setPatchStatus(null);
    setPendingDeleteTrackId(trackId);
  };

  const handleRemoveParallelTrack = async (trackId: string) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before removing tracks");
      return;
    }
    const authoringGeneration = authoringInteractionGenerationRef.current;
    const projectRevision = parallelProjectRevisionRef.current;
    setError(null);
    try {
      await flushFocusedEditorDraft();
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed while removing the track; try again");
        return;
      }
      if (authoringGeneration !== authoringInteractionGenerationRef.current) {
        setPatchStatus("Editor changed while removing the track; try again");
        return;
      }
      const authoredFingerprint = currentAuthoredPatchFingerprint();
      const patch = await buildPatchDocument();
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed while removing the track; try again");
        return;
      }
      if (projectRevision !== parallelProjectRevisionRef.current) {
        setPatchStatus("Project changed while removing the track; try again");
        return;
      }
      if (
        !patchBuildStillMatchesCurrentAuthoring(
          patch,
          authoringGeneration,
          authoredFingerprint
        )
      ) {
        setPatchStatus("Track changed while removing the track; try again");
        return;
      }
      const project = clonePatchJson(patch.project);
      if (project.tracks.length <= 1) {
        setPatchStatus("Keep at least one track");
        return;
      }
      const removedIndex = project.tracks.findIndex((track) => track.id === trackId);
      if (removedIndex < 0) {
        setPendingDeleteTrackId(null);
        setPatchStatus("Track not found");
        return;
      }
      const removedTrack = project.tracks[removedIndex]!;
      const tracks = project.tracks.filter((track) => track.id !== removedTrack?.id);
      project.tracks = tracks;
      // Drop the removed track from any Track Flow box it belonged to (the
      // normalizer would prune it on next load, but keep state consistent now).
      project.global.trackFlowBoxes = project.global.trackFlowBoxes.map((box) => ({
        ...box,
        memberTrackIds: box.memberTrackIds.filter((id) => id !== removedTrack.id),
      }));
      if (!tracks.some((track) => track.id === project.activeTrackId)) {
        const nextActiveTrack =
          tracks[Math.min(removedIndex, tracks.length - 1)] ?? tracks[0];
        if (!nextActiveTrack) return;
        project.activeTrackId = nextActiveTrack.id;
      }
      // Box lanes are runtime participants, so their ids stay in the conflict/
      // matrix endpoint set — deleting an unrelated track must not erase
      // authored box-lane rules.
      const endpoints = runtimeEndpointTrackIds(tracks, project.global.trackFlowBoxes);
      project.global.conflictPriority = normalizedConflictPriority(
        project.global.conflictPriority,
        endpoints
      );
      project.global.channelLogicMatrix = normalizeChannelLogicMatrix(
        project.global.channelLogicMatrix,
        endpoints,
        project.global.channelConflictPolicy
      );
      const removedLabel = removedTrack.name.trim() || `Track ${removedIndex + 1}`;
      await applyParallelProject(project, `Deleted track "${removedLabel}"`, patch);
      setRenamingParallelTrackId((current) =>
        current === removedTrack.id ? null : current
      );
      setPendingDeleteTrackId(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const commitActiveParallelTrackName = (value: string) => {
    const nextName = value.trim();
    setRenamingParallelTrackId(null);
    if (!nextName) return;
    setError(null);
    void updateParallelProjectMetadata((project) => {
      project.tracks = project.tracks.map((track) =>
        track.id === project.activeTrackId ? { ...track, name: nextName } : track
      );
      return project;
    }, "Renamed track").catch((e) => setError(String(e)));
  };

  const toggleParallelTrackMute = (trackId: string) => {
    setError(null);
    void updateParallelProjectMetadata((project) => {
      project.tracks = project.tracks.map((track) =>
        track.id === trackId ? { ...track, muted: !track.muted } : track
      );
      return project;
    }, "Updated track mute").catch((e) => setError(String(e)));
  };

  const toggleParallelTrackSolo = (trackId: string) => {
    setError(null);
    void updateParallelProjectMetadata((project) => {
      project.tracks = project.tracks.map((track) =>
        track.id === trackId ? { ...track, soloed: !track.soloed } : track
      );
      return project;
    }, "Updated track solo").catch((e) => setError(String(e)));
  };

  const commitParallelGlobalTempo = async (value: string) => {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) {
      setPatchStatus("Global BPM needs a number");
      return;
    }
    const nextTempo = clamp(Math.round(parsed * 10) / 10, 20, 400);
    const activeTrack =
      parallelProjectRef.current?.tracks.find(
        (track) => track.id === parallelProjectRef.current?.activeTrackId
      ) ?? parallelProjectRef.current?.tracks[0];
    setError(null);
    try {
      await updateParallelProjectMetadata(
        (project) => ({
          ...project,
          global: { ...project.global, tempoBpm: nextTempo },
        }),
        "Updated global BPM"
      );
      if (activeTrack?.tempoMode !== "custom") {
        authoredTempoBpmRef.current = nextTempo;
        setTempoInput(nextTempo.toFixed(1));
        const outcome = await queueTempo(nextTempo);
        if (outcome.status === "error") throw outcome.error;
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const commitParallelGlobalCycle = async (value: string) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before changing global cycle");
      return;
    }
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      setPatchStatus("Global cycle needs a beat count");
      return;
    }
    const nextCycle = clamp(Math.round(parsed), 1, 64);
    const activeTrack =
      parallelProjectRef.current?.tracks.find(
        (track) => track.id === parallelProjectRef.current?.activeTrackId
      ) ?? parallelProjectRef.current?.tracks[0];
    setError(null);
    try {
      await updateParallelProjectMetadata(
        (project) => ({
          ...project,
          global: { ...project.global, cycleBeats: nextCycle },
        }),
        "Updated global cycle"
      );
      if (activeTrack?.cycleLengthMode !== "custom") {
        handleCycleBeatsChange(nextCycle);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSetActiveTrackTempoMode = async (mode: TrackTempoMode) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before changing track tempo mode");
      return;
    }
    const currentTempo = clamp(
      authoredTempoBpmRef.current,
      20,
      400
    );
    const globalTempo = parallelProjectRef.current?.global.tempoBpm ?? currentTempo;
    setError(null);
    try {
      await updateParallelProjectMetadata(
        (project) => ({
          ...project,
          tracks: project.tracks.map((track) =>
            track.id === project.activeTrackId
              ? {
                  ...track,
                  tempoMode: mode,
                  customTempoBpm:
                    mode === "custom" ? currentTempo : track.customTempoBpm,
                }
              : track
          ),
        }),
        mode === "custom"
          ? "Track tempo set to custom"
          : "Track tempo follows global"
      );
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed while updating track tempo mode");
        return;
      }
      if (mode === "global") {
        authoredTempoBpmRef.current = globalTempo;
        setTempoInput(globalTempo.toFixed(1));
        const outcome = await queueTempo(globalTempo);
        if (outcome.status === "error") throw outcome.error;
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSetActiveTrackCycleLengthMode = async (
    mode: TrackCycleLengthMode
  ) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before changing track cycle mode");
      return;
    }
    const globalCycle = parallelProjectRef.current?.global.cycleBeats ?? cycleBeats;
    setError(null);
    try {
      await updateParallelProjectMetadata(
        (project) => ({
          ...project,
          tracks: project.tracks.map((track) =>
            track.id === project.activeTrackId
              ? {
                  ...track,
                  cycleLengthMode: mode,
                  customCycleBeats:
                    mode === "custom" ? cycleBeats : track.customCycleBeats,
                }
              : track
          ),
        }),
        mode === "custom"
          ? "Track cycle set to custom"
          : "Track cycle follows global"
      );
      if (!trackStructureActionIsCurrent(transitionGeneration)) {
        setPatchStatus("Playback changed while updating track cycle mode");
        return;
      }
      if (mode === "global") {
        handleCycleBeatsChange(globalCycle);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const applyActiveTrackTrigger = async (
    nextTrigger: TriggerConfig | null,
    status: string
  ) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before changing track trigger");
      return;
    }
    setError(null);
    try {
      await updateParallelProjectMetadata(
        (project) => ({
          ...project,
          tracks: project.tracks.map((track) =>
            track.id === project.activeTrackId
              ? { ...track, trigger: nextTrigger }
              : track
          ),
        }),
        status
      );
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSetActiveTrackTriggerMode = (mode: "continuous" | "triggered") => {
    if (mode === "continuous") {
      void applyActiveTrackTrigger(null, "Track set to continuous");
      return;
    }
    if (activeTrackTrigger) {
      return; // already triggered
    }
    const source = eligibleTriggerSources(
      activeParallelTrackId,
      parallelProject?.tracks ?? [],
      parallelProject?.global.trackFlowBoxes ?? []
    )[0];
    if (!source) {
      setPatchStatus("Add another continuous track to use as a trigger source");
      return;
    }
    void applyActiveTrackTrigger(defaultTriggerConfig(source.id), "Track set to triggered");
  };

  const updateActiveTrackTrigger = (
    mutate: (trigger: TriggerConfig) => TriggerConfig,
    status = "Track trigger updated"
  ) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before changing track trigger");
      return;
    }
    setError(null);
    void updateParallelProjectMetadata((project) => ({
      ...project,
      tracks: project.tracks.map((track) =>
        track.id === project.activeTrackId && track.trigger
          ? { ...track, trigger: mutate(track.trigger) }
          : track
      ),
    }), status).catch((e) => setError(String(e)));
  };

  // Move `trackId` into a Track Flow box (`target` = a box id or "__new__") or
  // back to parallel (`target` = ""). Membership is the single source of truth;
  // mode/trigger are derived by the normalizer. Used by lane drag-and-drop and
  // the active-track move control. Empty draft boxes are kept (a freshly created
  // box survives until a track is dropped in); only the *source* box collapses
  // away if this move emptied it.
  const handleAssignTrackToBox = (trackId: string, target: string) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before changing track mode");
      return;
    }
    setError(null);
    const status =
      target === "" ? "Track set to parallel" : "Track added to Track Flow box";
    void updateParallelProjectMetadata(
      (project) => {
        const fromBox = boxForTrack(project.global.trackFlowBoxes ?? [], trackId);
        if ((fromBox?.id ?? "") === target) return project; // no-op
        // Single, unit-tested box-mutation path (shared with the Role picker's
        // applyTrackRole): remove from every box, add to `target`, drop only the
        // emptied source box.
        const boxes = assignTrackToBoxes(
          project.global.trackFlowBoxes ?? [],
          trackId,
          target
        );
        return {
          ...project,
          global: { ...project.global, trackFlowBoxes: boxes },
        };
      },
      status
    ).catch((e) => setError(String(e)));
  };

  // Atomic role change for the unified Role picker: membership + trigger update
  // together against the latest project ref. roleTransition picks the source via
  // eligibleTriggerSources, so a boxed track can never become a trigger source.
  const applyTrackRole = (targetRole: TrackRole) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before changing track mode");
      return;
    }
    setError(null);
    const status =
      targetRole === "continuous"
        ? "Track set to continuous"
        : targetRole === "triggered"
          ? "Track set to triggered"
          : "Track set to Track Flow";
    void updateParallelProjectMetadata(
      (project) => {
        const active = project.tracks.find(
          (track) => track.id === project.activeTrackId
        );
        if (!active) return project;
        const boxes = project.global.trackFlowBoxes ?? [];
        const intent = roleTransition(targetRole, active, project.tracks, boxes);
        if (!intent) return project; // no-op or unavailable target
        const change = applyRoleIntent(intent, project.activeTrackId, boxes);
        return {
          ...project,
          global: { ...project.global, trackFlowBoxes: change.boxes },
          tracks: project.tracks.map((track) =>
            track.id === project.activeTrackId
              ? { ...track, trigger: change.trigger }
              : track
          ),
        };
      },
      status
    ).catch((e) => setError(String(e)));
  };

  // Create a new empty Track Flow box draft (expanded). It is omitted from
  // playback until a track is dropped into it (empty boxes are UI drafts).
  const handleCreateBox = () => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before adding a box");
      return;
    }
    setError(null);
    void updateParallelProjectMetadata((project) => {
      const used = new Set(project.global.trackFlowBoxes.map((box) => box.id));
      let n = project.global.trackFlowBoxes.length + 1;
      let id = `box-${n}`;
      while (used.has(id)) {
        n += 1;
        id = `box-${n}`;
      }
      return {
        ...project,
        global: {
          ...project.global,
          trackFlowBoxes: [
            ...project.global.trackFlowBoxes,
            {
              id,
              name: `Box ${n}`,
              memberTrackIds: [],
              chain: defaultTrackFlowChain(),
              seed: TRACK_FLOW_DEFAULT_SEED,
              collapsed: false,
            },
          ],
        },
      };
    }, "Added Track Flow box");
  };

  // Delete a box: its members fall back to parallel (membership removed).
  const handleDeleteBox = (boxId: string) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before deleting a box");
      return;
    }
    if (matrixBoxId === boxId) setMatrixBoxId(null);
    setError(null);
    void updateParallelProjectMetadata(
      (project) => ({
        ...project,
        global: {
          ...project.global,
          trackFlowBoxes: project.global.trackFlowBoxes.filter(
            (box) => box.id !== boxId
          ),
        },
      }),
      "Deleted Track Flow box"
    );
  };

  // Toggle (and persist) a box's collapsed lane-UI state.
  const handleToggleBoxCollapsed = (boxId: string) => {
    setError(null);
    void updateParallelProjectMetadata(
      (project) => ({
        ...project,
        global: {
          ...project.global,
          trackFlowBoxes: project.global.trackFlowBoxes.map((box) =>
            box.id === boxId ? { ...box, collapsed: !box.collapsed } : box
          ),
        },
      }),
      ""
    );
  };

  const handleRenameBox = (boxId: string, name: string) => {
    setError(null);
    void updateParallelProjectMetadata(
      (project) => ({
        ...project,
        global: {
          ...project.global,
          trackFlowBoxes: project.global.trackFlowBoxes.map((box) =>
            box.id === boxId ? { ...box, name } : box
          ),
        },
      }),
      "Renamed Track Flow box"
    );
  };

  const setBoxSeed = (boxId: string, seed: number) => {
    const transitionGeneration = playbackTransitionRef.current.generation;
    if (!trackStructureActionIsCurrent(transitionGeneration)) {
      setPatchStatus("Stop playback before changing Track Flow seed");
      return;
    }
    setError(null);
    void updateParallelProjectMetadata(
      (project) => ({
        ...project,
        global: {
          ...project.global,
          trackFlowBoxes: project.global.trackFlowBoxes.map((box) =>
            box.id === boxId ? { ...box, seed } : box
          ),
        },
      }),
      "Updated Track Flow seed"
    );
  };

  // Rename the box that owns the active track.
  // Mutate a box's chain by id. Chain edits affect the request like other global
  // matrix settings, so they are applied on the next play (metadata update), not
  // re-applied mid-edit.
  const updateBoxChain = (
    boxId: string,
    mutate: (chain: TrackFlowChainState) => TrackFlowChainState,
    status: string
  ) => {
    if (playbackTransitionRef.current.kind !== "idle") {
      setPatchStatus("Wait for playback to finish changing before editing Track Flow");
      return;
    }
    setError(null);
    void updateParallelProjectMetadata(
      (project) => ({
        ...project,
        global: {
          ...project.global,
          trackFlowBoxes: project.global.trackFlowBoxes.map((box) =>
            box.id === boxId ? { ...box, chain: mutate(box.chain) } : box
          ),
        },
      }),
      status
    );
  };

  const setBoxTransitionWeight = (
    boxId: string,
    fromId: string,
    toId: string,
    weight: number
  ) => {
    updateBoxChain(
      boxId,
      (chain) => {
        const key = trackFlowTransitionKey([fromId], toId);
        const weights = { ...chain.weights };
        if (weight > 0) {
          weights[key] = weight;
        } else {
          delete weights[key];
        }
        return { ...chain, weights };
      },
      "Updated Track Flow chain"
    );
  };

  const setBoxEntryWeight = (boxId: string, id: string, weight: number) => {
    updateBoxChain(
      boxId,
      (chain) => {
        const key = trackFlowEntryKey([id]);
        const entryWeights = { ...chain.entryWeights };
        if (weight > 0) {
          entryWeights[key] = weight;
        } else {
          delete entryWeights[key];
        }
        return { ...chain, entryWeights };
      },
      "Updated Track Flow entry weights"
    );
  };

  const handleSetChannelConflictPolicy = (policy: ChannelConflictPolicy) => {
    setError(null);
    void updateParallelProjectMetadata((project) => ({
      ...project,
      global: {
        ...project.global,
        ...channelLogicGlobalsForDefaultPolicy(
          project.global.channelLogicMatrix,
          project.tracks,
          policy
        ),
      },
    }), "Updated default channel logic").catch((e) => setError(String(e)));
  };

  const handleSetChannelLogicGroupPolicy = (
    trackAId: string,
    trackBId: string,
    outputChannels: number[],
    includesAllShared: boolean,
    currentPolicy: ChannelConflictPolicy,
    nextPolicy: ChannelConflictPolicy
  ) => {
    setError(null);
    void updateParallelProjectMetadata((project) => ({
      ...project,
      global: {
        ...project.global,
        channelLogicMatrix: nextChannelLogicMatrixForGroupPolicy(
          project.global.channelLogicMatrix,
          project.tracks,
          project.global.channelConflictPolicy,
          { trackAId, trackBId, outputChannels, includesAllShared, policy: currentPolicy },
          nextPolicy
        ),
      },
    }), "Updated channel logic override").catch((e) => setError(String(e)));
  };

  const handleAddChannelLogicPair = () => {
    setError(null);
    void updateParallelProjectMetadata((project) => {
      const channelLogicMatrix = nextChannelLogicMatrixForAddedPair(
        project.global.channelLogicMatrix,
        project.tracks,
        project.global.channelConflictPolicy
      );
      if (!channelLogicMatrix) return project;
      return {
        ...project,
        global: { ...project.global, channelLogicMatrix },
      };
    }, "Added channel logic override").catch((e) => setError(String(e)));
  };

  const handleToggleChannelLogicGroupChannel = (
    trackAId: string,
    trackBId: string,
    policy: ChannelConflictPolicy,
    outputChannel: number,
    selected: boolean
  ) => {
    setError(null);
    void updateParallelProjectMetadata((project) => ({
      ...project,
      global: {
        ...project.global,
        channelLogicMatrix: nextChannelLogicMatrixForToggledChannel(
          project.global.channelLogicMatrix,
          project.tracks,
          project.global.channelConflictPolicy,
          trackAId,
          trackBId,
          policy,
          outputChannel,
          selected
        ),
      },
    }), selected ? "Removed channel from logic rule" : "Added channel to logic rule").catch(
      (e) => setError(String(e))
    );
  };

  const handleRemoveChannelLogicGroup = (
    trackAId: string,
    trackBId: string,
    outputChannels: number[],
    includesAllShared: boolean,
    policy: ChannelConflictPolicy
  ) => {
    setError(null);
    void updateParallelProjectMetadata((project) => ({
      ...project,
      global: {
        ...project.global,
        channelLogicMatrix: nextChannelLogicMatrixForRemovedGroup(
          project.global.channelLogicMatrix,
          project.tracks,
          project.global.channelConflictPolicy,
          { trackAId, trackBId, outputChannels, includesAllShared, policy }
        ),
      },
    }), "Removed channel logic override").catch((e) => setError(String(e)));
  };

  const handleSetChannelLogicGroupTrack = (
    trackAId: string,
    trackBId: string,
    outputChannels: number[],
    includesAllShared: boolean,
    policy: ChannelConflictPolicy,
    side: "a" | "b",
    nextTrackId: string
  ) => {
    if (!nextTrackId || nextTrackId === (side === "a" ? trackBId : trackAId)) {
      return;
    }
    setError(null);
    void updateParallelProjectMetadata((project) => {
      const channelLogicMatrix = nextChannelLogicMatrixForGroupTrack(
        project.global.channelLogicMatrix,
        project.tracks,
        project.global.channelConflictPolicy,
        { trackAId, trackBId, outputChannels, includesAllShared, policy },
        side,
        nextTrackId
      );
      if (!channelLogicMatrix) return project;
      return {
        ...project,
        global: { ...project.global, channelLogicMatrix },
      };
    }, "Updated channel logic override").catch((e) => setError(String(e)));
  };

  const moveParallelTrackPriority = (trackId: string, direction: -1 | 1) => {
    setError(null);
    void updateParallelProjectMetadata((project) => {
      const conflictPriority = nextConflictPriorityForMove(
        project.global.conflictPriority,
        runtimeEndpointTrackIds(project.tracks, project.global.trackFlowBoxes),
        trackId,
        direction
      );
      if (!conflictPriority) return project;
      return {
        ...project,
        global: { ...project.global, conflictPriority },
      };
    }, "Updated priority order").catch((e) => setError(String(e)));
  };

  const markPersistenceForFingerprint = (fingerprint: string) => {
    currentPatchFingerprintRef.current = fingerprint;
    if (!fingerprint) {
      setPatchPersistenceState("checking");
    } else if (lastSavedFingerprintRef.current === fingerprint) {
      setPatchPersistenceState("saved");
    } else if (autosaveEnabledRef.current && autosaveInFlightRef.current) {
      setPatchPersistenceState("autosaving");
    } else if (
      autosaveEnabledRef.current &&
      lastAutosavedFingerprintRef.current === fingerprint
    ) {
      setPatchPersistenceState("autosaved");
    } else {
      setPatchPersistenceState("unsaved");
    }
  };

  const persistenceStateWithoutAutosave = (
    fingerprint: string
  ): PatchPersistenceState =>
    !fingerprint
      ? "checking"
      : lastSavedFingerprintRef.current === fingerprint
        ? "saved"
        : "unsaved";

  const savePatchToPath = async (path: string) => {
    if (isApplyingPatchRef.current) {
      setPatchStatus("Wait for patch recall to finish before saving");
      return;
    }
    const queue = manualPatchSaveQueueRef.current!;
    const intent = beginLatestWinsBuildIntent(
      queue,
      manualSaveIntentGenerationRef,
      "patch-save"
    );
    const documentGeneration = patchApplyGenerationRef.current;
    manualSaveActiveCountRef.current += 1;
    // Manual persistence supersedes any older recovery write. Autosave is also
    // blocked for this whole build/write/clear window, so it cannot recreate a
    // recovery file immediately after the explicit save clears it.
    autosaveGenerationRef.current += 1;
    try {
      await flushFocusedEditorDraft();
      if (
        documentGeneration !== patchApplyGenerationRef.current ||
        !latestWinsBuildIntentIsCurrent(
          queue,
          manualSaveIntentGenerationRef,
          intent
        )
      ) {
        return;
      }
      const persistenceAuthoringGeneration =
        authoringInteractionGenerationRef.current;
      // The blur above may have committed a component-local text draft and
      // rendered a new App closure. Always capture through the refreshed ref,
      // never through this Save handler's pre-blur closure.
      const build = buildPatchDocumentRef.current;
      if (!build) return;
      const patch = await build();
      if (
        documentGeneration !== patchApplyGenerationRef.current ||
        !latestWinsBuildIntentIsCurrent(
          queue,
          manualSaveIntentGenerationRef,
          intent
        )
      ) {
        return;
      }
      const authoringChangedBeforeWrite =
        persistenceAuthoringGeneration !==
        authoringInteractionGenerationRef.current;

      const fingerprint = patchContentFingerprint(patch);
      const outcome = await enqueueLatestWins(queue, {
        key: `patch-save:${intent.generation}:${path}:${fingerprint}`,
        shouldRun: () =>
          intent.generation === manualSaveIntentGenerationRef.current &&
          documentGeneration === patchApplyGenerationRef.current,
        run: () => patchSaveToPath(path, patch),
      });
      if (outcome.status === "error") {
        throw outcome.error;
      }
      if (
        outcome.status !== "applied" ||
        intent.generation !== manualSaveIntentGenerationRef.current ||
        documentGeneration !== patchApplyGenerationRef.current
      ) {
        return;
      }

      await patchClearAutosave().catch(() => undefined);
      if (
        intent.generation !== manualSaveIntentGenerationRef.current ||
        documentGeneration !== patchApplyGenerationRef.current
      ) {
        return;
      }
      // Clearing recovery is asynchronous too. Re-read both authored state and
      // the interaction token only after every persistence await has finished.
      const currentFingerprint = currentAuthoredPatchFingerprint();
      const newerAuthoring =
        authoringChangedBeforeWrite ||
        persistenceAuthoringGeneration !==
          authoringInteractionGenerationRef.current;
      setCurrentPatchPath(path);
      rememberPatchPath(path, patch.savedAt);
      lastSavedFingerprintRef.current = fingerprint;
      lastAutosavedFingerprintRef.current = "";
      setLastSavedAt(patch.savedAt);
      setLastAutosaveAt(null);
      if (newerAuthoring) {
        currentPatchFingerprintRef.current = DIRTY_PATCH_FINGERPRINT;
        setPatchPersistenceState("unsaved");
      } else {
        currentPatchFingerprintRef.current = currentFingerprint;
        setPatchPersistenceState(
          currentFingerprint === fingerprint ? "saved" : "unsaved"
        );
      }
      setPatchStatus(
        !newerAuthoring && currentFingerprint === fingerprint
          ? `Saved patch: ${path}`
          : `Saved patch: ${path}. Newer edits remain unsaved.`
      );
    } finally {
      manualSaveActiveCountRef.current = Math.max(
        0,
        manualSaveActiveCountRef.current - 1
      );
    }
  };

  const handleSavePatchAs = async () => {
    setError(null);
    setPatchStatus(null);
    if (isApplyingPatchRef.current) {
      setPatchStatus("Wait for patch recall to finish before saving");
      return;
    }
    try {
      const path = await patchChooseSavePath(defaultPatchFilename(name));
      if (!path) return;
      await savePatchToPath(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSavePatch = async () => {
    setError(null);
    setPatchStatus(null);
    if (isApplyingPatchRef.current) {
      setPatchStatus("Wait for patch recall to finish before saving");
      return;
    }
    try {
      if (currentPatchPath) {
        await savePatchToPath(currentPatchPath);
      } else {
        await handleSavePatchAs();
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleNewPatch = async () => {
    if (
      snapshot?.isPlaying ||
      playbackTransitionRef.current.kind !== "idle"
    ) {
      setPatchStatus("Stop playback before creating a new patch");
      return;
    }
    setError(null);
    setPatchStatus(null);
    const documentIntent = ++patchDocumentIntentGenerationRef.current;
    try {
      const patch = createNeutralPatchDocument({
        seed: globalSeedStartupLocked ? seed : datetimeSeed(),
        setupPreferences: {
          autosaveEnabled,
          autosaveIntervalMs,
          autoloadRecentSession,
        },
      });
      await applyPatchDocument(patch);
      if (documentIntent !== patchDocumentIntentGenerationRef.current) return;
      const currentFingerprint = currentAuthoredPatchFingerprint();
      setCurrentPatchPath(null);
      forgetLastPatchPath();
      currentPatchFingerprintRef.current = currentFingerprint;
      lastSavedFingerprintRef.current = "";
      lastAutosavedFingerprintRef.current = "";
      setPatchPersistenceState("unsaved");
      setLastSavedAt(null);
      await patchClearAutosave().catch(() => undefined);
      setLastAutosaveAt(null);
      setPatchStatus("New patch");
    } catch (e) {
      if (documentIntent === patchDocumentIntentGenerationRef.current) {
        setError(String(e));
      }
    }
  };

  const loadPatchFromPath = async (
    path: string,
    messagePrefix: string,
    documentIntent: number
  ) => {
    const authoringGeneration = authoringInteractionGenerationRef.current;
    const rawPatch = await patchLoadFromPath(path);
    if (documentIntent !== patchDocumentIntentGenerationRef.current) return;
    if (
      authoringGeneration !== authoringInteractionGenerationRef.current
    ) {
      setPatchStatus("Editor changed while recalling; recall cancelled");
      return;
    }
    const patch = readPatchDocument(rawPatch);
    const fingerprint = patchContentFingerprint(patch);
    // Async functions run synchronously to their first await. Capture after
    // apply has discarded the old document and published the incoming React
    // state, but before transport synchronization yields to user input.
    const application = applyPatchDocument(patch);
    const applicationGeneration = patchApplyGenerationRef.current;
    const recalledAuthoringGeneration = authoringInteractionGenerationRef.current;
    await application;
    if (
      documentIntent !== patchDocumentIntentGenerationRef.current ||
      applicationGeneration !== patchApplyGenerationRef.current
    ) {
      return;
    }
    await patchClearAutosave().catch(() => undefined);
    if (
      documentIntent !== patchDocumentIntentGenerationRef.current ||
      applicationGeneration !== patchApplyGenerationRef.current
    ) {
      return;
    }
    const currentFingerprint = currentAuthoredPatchFingerprint();
    const newerAuthoring =
      recalledAuthoringGeneration !== authoringInteractionGenerationRef.current;
    setCurrentPatchPath(path);
    rememberPatchPath(path, patch.savedAt);
    currentPatchFingerprintRef.current = newerAuthoring
      ? DIRTY_PATCH_FINGERPRINT
      : currentFingerprint;
    lastSavedFingerprintRef.current = fingerprint;
    lastAutosavedFingerprintRef.current = "";
    setPatchPersistenceState(
      !newerAuthoring && currentFingerprint === fingerprint ? "saved" : "unsaved"
    );
    setLastSavedAt(patch.savedAt);
    setLastAutosaveAt(null);
    setPatchStatus(
      !newerAuthoring && currentFingerprint === fingerprint
        ? `${messagePrefix}: ${path}`
        : `${messagePrefix}: ${path}. Newer edits remain unsaved.`
    );
  };

  const handleLoadPatch = async () => {
    if (
      snapshot?.isPlaying ||
      playbackTransitionRef.current.kind !== "idle"
    ) {
      setPatchStatus("Stop playback before recalling a patch");
      return;
    }
    setError(null);
    setPatchStatus(null);
    const documentIntent = ++patchDocumentIntentGenerationRef.current;
    try {
      const path = await patchChooseOpenPath();
      if (!path || documentIntent !== patchDocumentIntentGenerationRef.current) return;
      await loadPatchFromPath(path, "Recalled patch", documentIntent);
    } catch (e) {
      if (documentIntent === patchDocumentIntentGenerationRef.current) {
        setError(String(e));
      }
    }
  };

  const handleLoadMostRecentPatch = async () => {
    if (
      snapshot?.isPlaying ||
      playbackTransitionRef.current.kind !== "idle"
    ) {
      setPatchStatus("Stop playback before recalling a patch");
      return;
    }
    setError(null);
    setPatchStatus(null);
    const documentIntent = ++patchDocumentIntentGenerationRef.current;
    try {
      const recent = readRecentPatches()[0];
      if (!recent) {
        setPatchStatus("No recent patches yet.");
        return;
      }
      await loadPatchFromPath(
        recent.path,
        "Recalled recent patch",
        documentIntent
      );
    } catch (e) {
      if (documentIntent === patchDocumentIntentGenerationRef.current) {
        setError(String(e));
      }
    }
  };

  const handleExportScore = async () => {
    setError(null);
    setPatchStatus(null);
    if (
      snapshot?.isPlaying ||
      playbackTransitionRef.current.kind !== "idle"
    ) {
      setPatchStatus("Stop playback before exporting the current cycle");
      return;
    }
    try {
      await flushFocusedEditorDraft();
      const currentSwitchRequest = latestSwitchRequestRef.current;
      if (!currentSwitchRequest.ok) {
        throw new Error(currentSwitchRequest.error);
      }
      const path = await scoreChooseSavePath(
        defaultScoreFilename(currentSwitchRequest.data.name)
      );
      if (!path) return;
      const requestKey = JSON.stringify(currentSwitchRequest.data);
      await applySwitchRequestNow(currentSwitchRequest.data, requestKey);
      await scoreSaveToPath(path);
      setPatchStatus(`Exported cycle JSON: ${path}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const updateAutosaveEnabled = (next: boolean) => {
    machinePrefsEditGenerationRef.current += 1;
    machinePrefsEditedFieldsRef.current.autosaveEnabled = true;
    autosaveGenerationRef.current += 1;
    autosaveEnabledRef.current = next;
    setAutosaveEnabled(next);

    if (!next) {
      lastAutosavedFingerprintRef.current = "";
      setLastAutosaveAt(null);
      void patchClearAutosave().catch(() => undefined);
      const fingerprint = currentPatchFingerprintRef.current;
      setPatchPersistenceState(persistenceStateWithoutAutosave(fingerprint));
      setPatchStatus("Autosave off. Temporary recovery cleared.");
    } else {
      setPatchStatus(
        "Autosave on. Recovery will be offered after an unclean shutdown."
      );
    }
  };

  const updateAutosaveIntervalMs = (next: number) => {
    machinePrefsEditGenerationRef.current += 1;
    machinePrefsEditedFieldsRef.current.autosaveIntervalMs = true;
    autosaveIntervalMsRef.current = next;
    setAutosaveIntervalMs(next);
  };

  const updateAutoloadRecentSession = (next: boolean) => {
    machinePrefsEditGenerationRef.current += 1;
    machinePrefsEditedFieldsRef.current.autoloadRecentSession = true;
    autoloadRecentSessionRef.current = next;
    setAutoloadRecentSession(next);
  };

  const handleToggleAutosave = () => {
    updateAutosaveEnabled(!autosaveEnabledRef.current);
  };

  const restoreAutosaveOrRecentSession = async () => {
    if (hasAttemptedSessionRestoreRef.current) return;
    hasAttemptedSessionRestoreRef.current = true;
    // Machine prefs decide whether recovery/autoload run at all — wait for
    // the file hydrate (milliseconds) before consulting them, so the boot
    // defaults never drive the restore decision.
    const machinePrefs =
      (await machinePrefsHydrationRef.current) ?? defaultMachinePrefs();
    // A user-created/newly loaded document or any direct editor interaction
    // always wins over the delayed startup restore timer.
    if (
      patchDocumentIntentGenerationRef.current !== 0 ||
      startupRestoreUserInteractedRef.current
    ) {
      return;
    }
    const documentIntent = ++patchDocumentIntentGenerationRef.current;
    const restoreIsCurrent = () =>
      startupRestoreIsCurrent({
        documentIntent,
        currentDocumentIntent: patchDocumentIntentGenerationRef.current,
        userInteracted: startupRestoreUserInteractedRef.current,
      });

    const shouldOfferAutosaveRecovery =
      autosaveEnabledRef.current && previousSessionInterruptedRef.current;

    if (shouldOfferAutosaveRecovery) {
      try {
        const rawAutosave = await patchLoadAutosave();
        if (!restoreIsCurrent()) return;
        if (rawAutosave) {
          const patch = readPatchDocument(rawAutosave);
          const shouldRestore = await patchAskAutosaveRecovery(patch.savedAt);
          if (!restoreIsCurrent()) return;
          if (shouldRestore) {
            const fingerprint = patchContentFingerprint(patch);
            await applyPatchDocument(patch);
            if (!restoreIsCurrent()) return;
            const currentFingerprint = currentAuthoredPatchFingerprint();
            currentPatchFingerprintRef.current = currentFingerprint;
            lastAutosavedFingerprintRef.current = fingerprint;
            setPatchPersistenceState(
              currentFingerprint === fingerprint ? "autosaved" : "unsaved"
            );
            setLastSavedAt(null);
            setLastAutosaveAt(patch.savedAt);
            setPatchStatus(
              `Restored autosaved recovery from ${new Date(
                patch.savedAt
              ).toLocaleString()}${
                currentFingerprint === fingerprint
                  ? ""
                  : ". Newer edits remain unsaved."
              }`
            );
            return;
          }
          lastAutosavedFingerprintRef.current = "";
          setLastAutosaveAt(null);
          await patchClearAutosave().catch(() => undefined);
          if (!restoreIsCurrent()) return;
          setPatchStatus("Discarded autosaved recovery.");
        }
      } catch {
        if (!restoreIsCurrent()) return;
        lastAutosavedFingerprintRef.current = "";
        setLastAutosaveAt(null);
        await patchClearAutosave().catch(() => undefined);
        if (!restoreIsCurrent()) return;
        setPatchStatus("Autosaved recovery could not be loaded.");
      }
    } else {
      lastAutosavedFingerprintRef.current = "";
      setLastAutosaveAt(null);
      await patchClearAutosave().catch(() => undefined);
      if (!restoreIsCurrent()) return;
    }

    if (!machinePrefs.autoloadRecentSession) return;

    const lastPath = readLastPatchPath();
    if (!lastPath) return;

    try {
      const rawPatch = await patchLoadFromPath(lastPath);
      if (!restoreIsCurrent()) return;
      const patch = readPatchDocument(rawPatch);
      const fingerprint = patchContentFingerprint(patch);
      await applyPatchDocument(patch);
      if (!restoreIsCurrent()) return;
      const currentFingerprint = currentAuthoredPatchFingerprint();
      setCurrentPatchPath(lastPath);
      rememberPatchPath(lastPath, patch.savedAt);
      currentPatchFingerprintRef.current = currentFingerprint;
      lastSavedFingerprintRef.current = fingerprint;
      lastAutosavedFingerprintRef.current = "";
      setPatchPersistenceState(
        currentFingerprint === fingerprint ? "saved" : "unsaved"
      );
      setLastSavedAt(patch.savedAt);
      setPatchStatus(
        currentFingerprint === fingerprint
          ? `Restored recent session: ${lastPath}`
          : `Restored recent session: ${lastPath}. Newer edits remain unsaved.`
      );
    } catch {
      if (!restoreIsCurrent()) return;
      // Missing moved files are common enough that startup should stay quiet.
    }
  };

  const handlePanic = async () => {
    try {
      await transportPanic();
      setPatchStatus("MIDI panic: silenced all notes; playback continues.");
    } catch (e) {
      setError(String(e));
    }
  };

  const handleMidiDestinationPick = async (value: string) => {
    const dest = destinationForValue(value, midiDestinations, midiRouteStatus.desired);
    const routeIntent = ++midiRouteIntentGenerationRef.current;
    try {
      const status = await midiSetDestination(dest);
      if (routeIntent !== midiRouteIntentGenerationRef.current) return;
      setMidiRouteStatus(status);
      midiRouteDesiredRef.current = status.desired;
    } catch (e) {
      if (routeIntent === midiRouteIntentGenerationRef.current) {
        setError(String(e));
      }
    }
  };

  const handleMidiRescan = async () => {
    const routeIntent = ++midiRouteIntentGenerationRef.current;
    const listIntent = ++midiDestinationListGenerationRef.current;
    try {
      const [status, destinations] = await Promise.all([
        midiGetRouteStatus(),
        midiListDestinations(),
      ]);
      if (routeIntent === midiRouteIntentGenerationRef.current) {
        setMidiRouteStatus(status);
        midiRouteDesiredRef.current = status.desired;
      }
      if (listIntent === midiDestinationListGenerationRef.current) {
        setMidiDestinations(destinations);
      }
    } catch (e) {
      if (routeIntent === midiRouteIntentGenerationRef.current) {
        setError(String(e));
      }
    }
  };

  newPatchMenuRef.current = handleNewPatch;
  savePatchMenuRef.current = handleSavePatch;
  savePatchAsMenuRef.current = handleSavePatchAs;
  loadPatchMenuRef.current = handleLoadPatch;
  loadRecentPatchMenuRef.current = handleLoadMostRecentPatch;
  exportScoreMenuRef.current = handleExportScore;
  synthToggleMenuRef.current = handleSynthToggle;
  resetTransportSyncMenuRef.current = handleResetTransportSync;
  toggleAutosaveMenuRef.current = handleToggleAutosave;
  midiPanicMenuRef.current = handlePanic;

  useEffect(() => {
    const handleNativeMenuAction = (action: NativeMenuAction) => {
      if (action === "newPatch") {
        void newPatchMenuRef.current?.();
      } else if (action === "savePatch") {
        void savePatchMenuRef.current?.();
      } else if (action === "savePatchAs") {
        void savePatchAsMenuRef.current?.();
      } else if (action === "recallPatch") {
        void loadPatchMenuRef.current?.();
      } else if (action === "recallRecentPatch") {
        void loadRecentPatchMenuRef.current?.();
      } else if (action === "exportScore") {
        void exportScoreMenuRef.current?.();
      } else if (action === "toggleAutosave") {
        toggleAutosaveMenuRef.current?.();
      } else if (action === "openSetup") {
        setSetupOpen(true);
      } else if (action === "openSeeds") {
        setSeedSetupTab("global");
        setSeedSetupOpen(true);
      } else if (action === "resetTransportSync") {
        void resetTransportSyncMenuRef.current?.();
      } else if (action === "toggleSynth") {
        void synthToggleMenuRef.current?.();
      } else if (action === "openSynthProperties") {
        setSynthPropertiesOpen(true);
      } else if (action === "midiPanic") {
        void midiPanicMenuRef.current?.();
      }
    };

    let mounted = true;
    let unlisten: (() => void) | null = null;
    void onNativeMenuAction(handleNativeMenuAction)
      .then((nextUnlisten) => {
        if (mounted) {
          unlisten = nextUnlisten;
        } else {
          nextUnlisten();
        }
      })
      .catch((e) => {
        if (mounted) {
          setError(String(e));
        }
      });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    autosaveEnabledRef.current = autosaveEnabled;
    autosaveIntervalMsRef.current = autosaveIntervalMs;
    autoloadRecentSessionRef.current = autoloadRecentSession;
    // Persist machine-local settings to the machine-prefs file — but never
    // before the boot hydrate lands, or default state would clobber it. The
    // MIDI destination is owned by midi_set_destination; the backend keeps
    // it authoritative regardless of what this snapshot carries.
    if (!machinePrefsHydratedRef.current) {
      return;
    }
    const prefs: MachinePrefs = {
      prefsVersion: 1,
      midiDestination: midiRouteDesiredRef.current,
      autosaveEnabled,
      autosaveIntervalMs,
      autoloadRecentSession,
    };
    void machinePrefsSet(prefs).catch(() => {
      // Machine prefs are best-effort; the file write can fail silently.
    });
  }, [autosaveEnabled, autosaveIntervalMs, autoloadRecentSession]);

  useEffect(() => {
    if (skipNextGlobalSeedStartupPersistRef.current) {
      skipNextGlobalSeedStartupPersistRef.current = false;
      return;
    }
    if (isApplyingPatchRef.current) return;
    writeGlobalSeedStartupLock(globalSeedStartupLocked, seed);
  }, [globalSeedStartupLocked, seed]);

  useEffect(() => {
    markAutosaveSessionActive();
    const markClean = () => {
      markAutosaveSessionClean();
    };

    window.addEventListener("beforeunload", markClean);
    window.addEventListener("pagehide", markClean);

    return () => {
      markClean();
      window.removeEventListener("beforeunload", markClean);
      window.removeEventListener("pagehide", markClean);
    };
  }, []);

  useEffect(() => {
    const advanceAuthoringInteraction = () => {
      authoringInteractionGenerationRef.current += 1;
      // View hydration is the only work these guards suppress. Release them
      // before the interaction's semantic handler runs so an immediate edit is
      // observed by the normal score/parallel live-apply effects.
      suppressScoreApplyRef.current = false;
      suppressPlaybackConfigApplyRef.current = false;
    };
    // Invalidate at gesture start, not just commit: a deferred backend response
    // resolving during a long drag must not replace the draft underneath it.
    window.addEventListener("pointerdown", advanceAuthoringInteraction, true);
    window.addEventListener("pointerup", advanceAuthoringInteraction, true);
    window.addEventListener("keydown", advanceAuthoringInteraction, true);
    window.addEventListener("input", advanceAuthoringInteraction, true);
    // Covers keyboard/assistive activation that has no pointer or key event.
    window.addEventListener("click", advanceAuthoringInteraction, true);

    return () => {
      window.removeEventListener("pointerdown", advanceAuthoringInteraction, true);
      window.removeEventListener("pointerup", advanceAuthoringInteraction, true);
      window.removeEventListener("keydown", advanceAuthoringInteraction, true);
      window.removeEventListener("input", advanceAuthoringInteraction, true);
      window.removeEventListener("click", advanceAuthoringInteraction, true);
    };
  }, []);

  useEffect(() => {
    const markUserInteraction = () => {
      startupRestoreUserInteractedRef.current = true;
    };
    const stopWatching = () => {
      window.removeEventListener("pointerdown", markUserInteraction, true);
      window.removeEventListener("keydown", markUserInteraction, true);
      window.removeEventListener("input", markUserInteraction, true);
      window.removeEventListener("click", markUserInteraction, true);
      if (startupRestoreInteractionCleanupRef.current === stopWatching) {
        startupRestoreInteractionCleanupRef.current = null;
      }
    };
    startupRestoreInteractionCleanupRef.current = stopWatching;
    window.addEventListener("pointerdown", markUserInteraction, true);
    window.addEventListener("keydown", markUserInteraction, true);
    window.addEventListener("input", markUserInteraction, true);
    window.addEventListener("click", markUserInteraction, true);

    return stopWatching;
  }, []);

  useEffect(() => {
    // Machine-prefs hydrate + one-shot localStorage migration, and the MIDI
    // route boot (status + destination list + change listener). Runs once;
    // the restore flow awaits the stored promise before deciding anything.
    let mounted = true;
    let unlisten: (() => void) | undefined;
    machinePrefsHydratedRef.current = false;
    const routeIntentAtHydrationStart =
      midiRouteIntentGenerationRef.current;
    const hydrationGeneration =
      ++machinePrefsHydrationGenerationRef.current;
    const hydrationIsCurrent = () =>
      mounted &&
      machinePrefsHydrationGenerationRef.current === hydrationGeneration;
    machinePrefsHydrationRef.current = (async (): Promise<MachinePrefs> => {
      try {
        const snapshot = await machinePrefsGet();
        if (!hydrationIsCurrent()) {
          return snapshot.prefs;
        }
        const plan = planSetupPrefsMigration(snapshot, (key) => {
          try {
            return window.localStorage.getItem(key);
          } catch {
            return null;
          }
        });
        const mergeCurrentUserEdits = (): MachinePrefs => {
          const edited = machinePrefsEditedFieldsRef.current;
          return {
            ...plan.prefs,
            midiDestination:
              routeIntentAtHydrationStart ===
              midiRouteIntentGenerationRef.current
                ? plan.prefs.midiDestination
                : midiRouteDesiredRef.current,
            autosaveEnabled: edited.autosaveEnabled
              ? autosaveEnabledRef.current
              : plan.prefs.autosaveEnabled,
            autosaveIntervalMs: edited.autosaveIntervalMs
              ? autosaveIntervalMsRef.current
              : plan.prefs.autosaveIntervalMs,
            autoloadRecentSession: edited.autoloadRecentSession
              ? autoloadRecentSessionRef.current
              : plan.prefs.autoloadRecentSession,
          };
        };

        let migrationWriteSucceeded = false;
        let hydratedPrefs = mergeCurrentUserEdits();
        const hasPreHydrationUserEdits = Object.values(
          machinePrefsEditedFieldsRef.current
        ).some(Boolean);
        if (plan.shouldMigrate || hasPreHydrationUserEdits) {
          while (hydrationIsCurrent()) {
            const editGeneration = machinePrefsEditGenerationRef.current;
            hydratedPrefs = mergeCurrentUserEdits();
            try {
              await machinePrefsSet(hydratedPrefs);
            } catch {
              // Retain legacy keys when migration did not become durable. The
              // in-memory user intent still wins for this launch.
              break;
            }
            if (!hydrationIsCurrent()) {
              return hydratedPrefs;
            }
            if (editGeneration === machinePrefsEditGenerationRef.current) {
              migrationWriteSucceeded = true;
              break;
            }
            // A control changed during the write. Persist the newest merged
            // snapshot before opening the normal persistence gate.
          }
        }
        if (!hydrationIsCurrent()) {
          return hydratedPrefs;
        }
        hydratedPrefs = mergeCurrentUserEdits();
        for (const key of removableLegacySetupKeys(
          plan,
          migrationWriteSucceeded
        )) {
          try {
            window.localStorage.removeItem(key);
          } catch {
            // Best effort.
          }
        }
        setAutosaveEnabled(hydratedPrefs.autosaveEnabled);
        autosaveEnabledRef.current = hydratedPrefs.autosaveEnabled;
        setAutosaveIntervalMs(hydratedPrefs.autosaveIntervalMs);
        autosaveIntervalMsRef.current = hydratedPrefs.autosaveIntervalMs;
        setAutoloadRecentSession(hydratedPrefs.autoloadRecentSession);
        autoloadRecentSessionRef.current =
          hydratedPrefs.autoloadRecentSession;
        midiRouteDesiredRef.current = hydratedPrefs.midiDestination;
        return hydratedPrefs;
      } catch {
        // MIDI-less or command-less environments boot on defaults.
        if (!hydrationIsCurrent()) {
          return defaultMachinePrefs();
        }
        const defaults = defaultMachinePrefs();
        const mergeFallbackUserEdits = (): MachinePrefs => {
          const edited = machinePrefsEditedFieldsRef.current;
          return {
            ...defaults,
            midiDestination: midiRouteDesiredRef.current,
            autosaveEnabled: edited.autosaveEnabled
              ? autosaveEnabledRef.current
              : defaults.autosaveEnabled,
            autosaveIntervalMs: edited.autosaveIntervalMs
              ? autosaveIntervalMsRef.current
              : defaults.autosaveIntervalMs,
            autoloadRecentSession: edited.autoloadRecentSession
              ? autoloadRecentSessionRef.current
              : defaults.autoloadRecentSession,
          };
        };
        let fallback = mergeFallbackUserEdits();
        if (
          Object.values(machinePrefsEditedFieldsRef.current).some(Boolean)
        ) {
          while (hydrationIsCurrent()) {
            const editGeneration = machinePrefsEditGenerationRef.current;
            fallback = mergeFallbackUserEdits();
            try {
              await machinePrefsSet(fallback);
            } catch {
              break;
            }
            if (!hydrationIsCurrent()) {
              return fallback;
            }
            if (editGeneration === machinePrefsEditGenerationRef.current) {
              break;
            }
            // The fallback write was in flight while another control changed;
            // persist that newest intent before restore consults this promise.
          }
        }
        return fallback;
      } finally {
        if (hydrationIsCurrent()) {
          machinePrefsHydratedRef.current = true;
        }
      }
    })();

    const bootRouteIntent = midiRouteIntentGenerationRef.current;
    const bootListIntent = ++midiDestinationListGenerationRef.current;
    void (async () => {
      try {
        const [status, destinations] = await Promise.all([
          midiGetRouteStatus(),
          midiListDestinations(),
        ]);
        if (mounted) {
          if (bootRouteIntent === midiRouteIntentGenerationRef.current) {
            setMidiRouteStatus(status);
            midiRouteDesiredRef.current = status.desired;
          }
          if (bootListIntent === midiDestinationListGenerationRef.current) {
            setMidiDestinations(destinations);
          }
        }
      } catch {
        // Environments without the MIDI commands stay virtual-only.
      }
    })();
    void onMidiRouteStatus((status) => {
      if (!mounted) return;
      midiRouteIntentGenerationRef.current += 1;
      setMidiRouteStatus(status);
      midiRouteDesiredRef.current = status.desired;
    }).then((stop) => {
      unlisten = stop;
      if (!mounted) {
        stop();
      }
    });

    return () => {
      mounted = false;
      if (
        machinePrefsHydrationGenerationRef.current === hydrationGeneration
      ) {
        machinePrefsHydrationGenerationRef.current += 1;
        machinePrefsHydratedRef.current = false;
      }
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void restoreAutosaveOrRecentSession().finally(() => {
        startupRestoreInteractionCleanupRef.current?.();
      });
    }, 500);

    return () => {
      window.clearTimeout(timer);
      startupRestoreInteractionCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const build = buildPatchDocumentRef.current;
      if (
        !build ||
        !shouldStartAutosaveCheck({
          enabled: autosaveEnabledRef.current,
          applyingPatch: isApplyingPatchRef.current,
          buildInFlight: autosaveBuildInFlightRef.current,
          saveInFlight: autosaveInFlightRef.current,
          manualSaveInFlight: manualSaveActiveCountRef.current > 0,
        })
      ) {
        return;
      }

      // Own the full build/fingerprint phase, not just the final write. Otherwise
      // a slow score snapshot lets later interval ticks duplicate all expensive
      // work before `autosaveInFlightRef` becomes true.
      autosaveBuildInFlightRef.current = true;
      void (async () => {
        let persistenceAuthoringGeneration: number | null = null;
        try {
          const autosaveGeneration = autosaveGenerationRef.current;
          // Publish component-local authored drafts without stealing focus,
          // then read the refreshed builder closure after React has rendered.
          await flushEditorDrafts();
          persistenceAuthoringGeneration =
            authoringInteractionGenerationRef.current;
          const refreshedBuild = buildPatchDocumentRef.current;
          if (!refreshedBuild) return;
          const patch = await refreshedBuild();
          if (!autosaveBuildIsCurrent({
            enabled: autosaveEnabledRef.current,
            startedGeneration: autosaveGeneration,
            currentGeneration: autosaveGenerationRef.current,
          })) {
            return;
          }
          const payload = patchContentFingerprint(patch);
          if (
            persistenceAuthoringGeneration !==
            authoringInteractionGenerationRef.current
          ) {
            // A new component-local draft appeared while the snapshot was
            // building. Its meaning is not necessarily in React state yet.
            markPatchDirty();
            return;
          }
          const currentBeforeWrite = currentAuthoredPatchFingerprint();
          if (payload !== currentBeforeWrite) {
            // An authored edit landed while scoreGetCurrent was pending. Do not
            // let the older coherent snapshot claim current state or become the
            // recovery file; the next interval will build from the new state.
            markPersistenceForFingerprint(currentBeforeWrite);
            return;
          }
          markPersistenceForFingerprint(currentBeforeWrite);

          if (lastSavedFingerprintRef.current === payload) {
            return;
          }
          if (lastAutosavedFingerprintRef.current === payload) {
            return;
          }
          autosaveInFlightRef.current = true;
          setPatchPersistenceState("autosaving");
          await patchAutosave(patch);
          if (
            !autosaveEnabledRef.current ||
            autosaveGenerationRef.current !== autosaveGeneration
          ) {
            lastAutosavedFingerprintRef.current = "";
            setLastAutosaveAt(null);
            await patchClearAutosave().catch(() => undefined);
            const currentFingerprint = currentAuthoredPatchFingerprint();
            currentPatchFingerprintRef.current = currentFingerprint;
            setPatchPersistenceState(
              persistenceStateWithoutAutosave(currentFingerprint)
            );
            return;
          }
          const autosavedAt = new Date().toISOString();
          const newerAuthoring =
            persistenceAuthoringGeneration !==
            authoringInteractionGenerationRef.current;
          const currentAfterWrite = currentAuthoredPatchFingerprint();
          lastAutosavedFingerprintRef.current = payload;
          setLastAutosaveAt(autosavedAt);
          if (newerAuthoring) {
            markPatchDirty();
          } else {
            currentPatchFingerprintRef.current = currentAfterWrite;
            setPatchPersistenceState(
              currentAfterWrite === lastSavedFingerprintRef.current
                ? "saved"
                : currentAfterWrite === payload
                  ? "autosaved"
                  : "unsaved"
            );
          }
        } catch {
          if (
            persistenceAuthoringGeneration !== null &&
            persistenceAuthoringGeneration !==
              authoringInteractionGenerationRef.current
          ) {
            markPatchDirty();
            return;
          }
          const currentFingerprint = currentAuthoredPatchFingerprint();
          currentPatchFingerprintRef.current = currentFingerprint;
          setPatchPersistenceState(
            lastSavedFingerprintRef.current === currentFingerprint
              ? "saved"
              : autosaveEnabledRef.current &&
                  lastAutosavedFingerprintRef.current ===
                    currentFingerprint
                ? "autosaved"
                : "unsaved"
          );
          // Autosave should never interrupt playback or editing.
        } finally {
          autosaveInFlightRef.current = false;
          autosaveBuildInFlightRef.current = false;
        }
      })();
    }, autosaveIntervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [autosaveIntervalMs]);

  const seedHistoryShortcutLabel = `G ${globalHistorySeeds.length} · R G · C ${
    channelHocketSeedBehavior === "followGlobal"
      ? "G"
      : channelHocketHistorySeeds.length
  }`;
  const seedRecurrenceRows = useMemo(
    () =>
      selectSeedRecurrenceRows(
        snapshot?.seedTraceEvents ?? [],
        [
          {
            domain: "global",
            label: "G",
            enabled: SEED_LOOP_MONITOR_MODES.includes(globalSeedMode),
          },
          {
            domain: "generator",
            label: "R",
            enabled: SEED_LOOP_MONITOR_MODES.includes(globalSeedMode),
            inheritedFrom: "G",
          },
          {
            domain: "channel",
            label: "C",
            enabled: SEED_LOOP_MONITOR_MODES.includes(channelHocketSeedBehavior),
            inheritedFrom:
              channelHocketSeedBehavior === "followGlobal" &&
              SEED_LOOP_MONITOR_MODES.includes(globalSeedMode)
                ? "G"
                : null,
          },
        ],
        16
      ),
    [
      channelHocketSeedBehavior,
      globalSeedMode,
      snapshot?.seedTraceEvents,
    ]
  );
  const seedPoolLogEntries: SeedPoolLogEntry[] = [
    {
      scope: "global",
      title: "Global score history",
      mode: seedModeShortLabel(globalSeedMode),
      baseSeed: seed,
      seeds: globalHistorySeeds,
      historyWeight,
      newSeedWeight,
      maxHistory,
      inheritedFrom: null,
    },
    {
      scope: "rhythm",
      title: "Generator history",
      mode: "inherits global",
      baseSeed: seed,
      seeds: globalHistorySeeds,
      historyWeight,
      newSeedWeight,
      maxHistory,
      inheritedFrom: "Global score history",
    },
    {
      scope: "channel",
      title: "Channel shaper history",
      mode:
        channelHocketSeedBehavior === "followGlobal"
          ? "inherits global"
          : seedModeShortLabel(channelHocketSeedBehavior),
      baseSeed: channelHocketSeedBehavior === "followGlobal" ? seed : channelHocketSeed,
      seeds:
        channelHocketSeedBehavior === "followGlobal"
          ? globalHistorySeeds
          : channelHocketHistorySeeds,
      historyWeight:
        channelHocketSeedBehavior === "followGlobal"
          ? historyWeight
          : channelHocketHistoryWeight,
      newSeedWeight:
        channelHocketSeedBehavior === "followGlobal"
          ? newSeedWeight
          : channelHocketNewSeedWeight,
      maxHistory:
        channelHocketSeedBehavior === "followGlobal"
          ? maxHistory
          : channelHocketMaxHistory,
      inheritedFrom:
        channelHocketSeedBehavior === "followGlobal" ? "Global score history" : null,
    },
  ];
  const visibleSeedPoolLogEntries = seedPoolLogEntries.filter(
    (entry) => seedLogScope === "all" || seedLogScope === entry.scope
  );
  const visibleSeedPaths =
    seedLogScope === "all" || seedLogScope === "paths" ? seedPaths : [];
  const activeParallelTrack =
    parallelTrackTabs.find((track) => track.id === activeParallelTrackId) ??
    parallelTrackTabs[0]!;
  const activeParallelTrackIndex = Math.max(
    0,
    parallelTrackTabs.findIndex((track) => track.id === activeParallelTrackId)
  );
  const activeParallelTrackLabel = `Track ${activeParallelTrackIndex + 1}`;
  const activeParallelTrackCustomName = activeParallelTrack.name.trim();
  const activeParallelTrackHasCustomName =
    activeParallelTrackCustomName.length > 0 &&
    activeParallelTrackCustomName !== activeParallelTrackLabel;
  const activeParallelTrackNameSummary = activeParallelTrackHasCustomName
    ? activeParallelTrackCustomName
    : "unnamed";
  const parallelSoloActive = parallelTrackTabs.some((track) => track.soloed);
  const pendingDeleteTrack = pendingDeleteTrackId
    ? parallelTrackTabs.find((track) => track.id === pendingDeleteTrackId) ?? null
    : null;
  const pendingDeleteTrackIndex = pendingDeleteTrack
    ? parallelTrackTabs.findIndex((track) => track.id === pendingDeleteTrack.id)
    : -1;
  const pendingDeleteTrackLabel =
    pendingDeleteTrackIndex >= 0 ? `Track ${pendingDeleteTrackIndex + 1}` : "Track";
  const pendingDeleteTrackName =
    pendingDeleteTrack?.name.trim() || pendingDeleteTrackLabel;
  const activeTrackTempoMode = activeParallelTrack.tempoMode;
  const activeTrackCycleLengthMode = activeParallelTrack.cycleLengthMode;
  const activeParallelTrackPatch =
    parallelProject?.tracks.find((track) => track.id === activeParallelTrackId) ??
    parallelProject?.tracks[0] ??
    null;
  const activeTrackTrigger: TriggerConfig | null =
    activeParallelTrackPatch?.trigger ?? null;
  // Track Flow boxes for the lane UI.
  const trackFlowBoxesList = parallelProject?.global.trackFlowBoxes ?? [];
  // The box (if any) that owns the active track — drives the non-drag "Move to"
  // fallback control (keyboard / flaky-drag accessibility).
  const activeTrackBox = boxForTrack(trackFlowBoxesList, activeParallelTrackId);
  // Unified Role picker: the role is *derived* from box membership + trigger, and
  // which roles are selectable (with a reason when not) from the track list.
  const activeTrackRole = trackRole(
    { id: activeParallelTrackId, trigger: activeTrackTrigger },
    trackFlowBoxesList
  );
  const activeRoleOptions = roleOptions(
    activeParallelTrackPatch ?? {
      id: activeParallelTrackId,
      name: "",
      trigger: activeTrackTrigger,
    },
    parallelProject?.tracks ?? [],
    trackFlowBoxesList
  );
  const trackNameById = new Map(
    (parallelProject?.tracks ?? []).map((track) => [track.id, track.name])
  );
  // Per-box "Box → Track" readout: the latest source each box's lane selected,
  // grouped by lane id (the per-box display the proposal's indicator surfaces).
  const trackFlowNowPlaying = (() => {
    const events = snapshot?.trackFlowEvents ?? [];
    if (events.length === 0) return [] as { boxName: string; sourceName: string }[];
    const latestByLane = new Map<string, { sourceName: string; cycle: number }>();
    for (const event of events) {
      const prev = latestByLane.get(event.laneId);
      if (!prev || event.cycle >= prev.cycle) {
        latestByLane.set(event.laneId, {
          sourceName: event.sourceTrackName,
          cycle: event.cycle,
        });
      }
    }
    return trackFlowBoxesList.flatMap((box) => {
      const sel = latestByLane.get(trackFlowLaneId(box.id));
      return sel ? [{ boxName: box.name, sourceName: sel.sourceName }] : [];
    });
  })();
  // Valid trigger sources: other, continuous, non-boxed tracks. A boxed track is
  // sequential (Track Flow) and can be neither a follower nor a trigger source.
  const boxedTrackIds = boxedTrackIdSet(trackFlowBoxesList);
  const triggerSourceOptions = (parallelProject?.tracks ?? []).filter(
    (track) =>
      track.id !== activeParallelTrackId &&
      !track.trigger &&
      !boxedTrackIds.has(track.id)
  );
  // A triggered track is "running" once it has launched (the backend exposes a
  // timing window for it via parallelTrackPositions); otherwise it is "armed".
  const activeTrackTriggerRunning =
    (snapshot?.isPlaying ?? false) &&
    (snapshot?.parallelTrackPositions ?? []).some(
      (position) => position.trackId === activeParallelTrackId
    );
  const activeTrackTriggerDecisionEvents = useMemo(
    () =>
      activeTrackTrigger
        ? (snapshot?.triggerDecisionEvents ?? []).filter(
            (event) => event.trackId === activeParallelTrackId
          )
        : [],
    [activeParallelTrackId, activeTrackTrigger, snapshot?.triggerDecisionEvents]
  );
  const parallelTrackCount = parallelProject?.tracks.length ?? 1;
  const hasMultipleParallelTracks = parallelTrackCount > 1;
  const parallelGlobalTempoBpm =
    parallelProject?.global.tempoBpm ?? currentTempoBpm;
  const parallelGlobalCycleBeats =
    parallelProject?.global.cycleBeats ?? cycleBeats;
  const globalTempoFieldValue = hasMultipleParallelTracks
    ? formatShortNumber(parallelGlobalTempoBpm)
    : tempoInput;
  const showTrackTempoAutomationFocus =
    !hasMultipleParallelTracks || activeTrackTempoMode === "custom";
  const channelConflictPolicy = musicalChannelLogicDefaultPolicy(
    parallelProject?.global.channelConflictPolicy ?? "allowAll"
  );
  const channelLogicOverrideRows = useMemo(
    () =>
      buildChannelLogicOverrideRows(
        normalizeChannelLogicMatrix(
          parallelProject?.global.channelLogicMatrix,
          parallelProject?.tracks ?? [],
          channelConflictPolicy
        ),
        parallelTrackTabs
      ),
    [channelConflictPolicy, parallelProject, parallelTrackTabs]
  );
  const channelLogicRuleCapacity = useMemo(() => {
    let capacity = 0;
    for (let left = 0; left < parallelTrackTabs.length; left += 1) {
      for (let right = left + 1; right < parallelTrackTabs.length; right += 1) {
        const trackA = parallelTrackTabs[left];
        const trackB = parallelTrackTabs[right];
        if (!trackA || !trackB) continue;
        capacity += intersectMidiChannels(
          trackA.midiChannels,
          trackB.midiChannels
        ).length;
      }
    }
    return capacity;
  }, [parallelTrackTabs]);
  const hasAvailableChannelLogicPair =
    parallelTrackTabs.length > 1 && channelLogicRuleCapacity > 0;
  const parallelPriorityRows = useMemo(() => {
    if (!parallelProject) return [];
    return buildParallelPriorityRows(
      normalizedConflictPriority(
        parallelProject.global.conflictPriority,
        parallelProject.tracks
      ),
      parallelTrackTabs
    );
  }, [parallelProject, parallelTrackTabs]);
  const channelLogicEffectiveSummaries = useMemo(
    () =>
      buildEffectiveChannelSummaries(
        normalizeChannelLogicMatrix(
          parallelProject?.global.channelLogicMatrix,
          parallelProject?.tracks ?? [],
          channelConflictPolicy
        ),
        channelConflictPolicy,
        parallelTrackTabs
      ),
    [channelConflictPolicy, parallelProject, parallelTrackTabs]
  );
  const channelLogicTrackOptions = useMemo(
    () =>
      parallelTrackTabs.map((track, index) => ({
        id: track.id,
        label: formatTrackOptionLabel(track, index),
      })),
    [parallelTrackTabs]
  );
  // B1.4: priority is edited inside the panel whenever ANY effective policy —
  // the default or a pair rule — uses it, not only when the default is Priority.
  const priorityRuleCount = channelLogicOverrideRows.filter(
    (row) => row.policy === "priorityOrder"
  ).length;
  const channelLogicShowPriority =
    channelConflictPolicy === "priorityOrder" || priorityRuleCount > 0;
  const channelLogicPriorityUsedBy =
    channelConflictPolicy === "priorityOrder"
      ? priorityRuleCount > 0
        ? `the default + ${priorityRuleCount} rule${priorityRuleCount === 1 ? "" : "s"}`
        : "the default"
      : `${priorityRuleCount} rule${priorityRuleCount === 1 ? "" : "s"}`;
  const channelLogicAddDisabledReason =
    parallelTrackTabs.length <= 1
      ? "Add a second track to enable channel rules."
      : channelLogicRuleCapacity === 0
        ? "No two tracks share a MIDI channel, so nothing can collide. Shared channels come from each track's routing."
        : "All track pairs with shared channels already have rules.";
  const handleChannelLogicGroupPolicy = (
    row: ChannelLogicOverrideRow,
    nextPolicy: ChannelConflictPolicy
  ) =>
    handleSetChannelLogicGroupPolicy(
      row.trackAId,
      row.trackBId,
      row.outputChannels,
      row.includesAllShared,
      row.policy,
      nextPolicy
    );
  const handleChannelLogicToggleChannel = (
    row: ChannelLogicOverrideRow,
    channel: number,
    selected: boolean
  ) =>
    handleToggleChannelLogicGroupChannel(
      row.trackAId,
      row.trackBId,
      row.policy,
      channel,
      selected
    );
  const handleChannelLogicGroupTrack = (
    row: ChannelLogicOverrideRow,
    side: "a" | "b",
    nextTrackId: string
  ) =>
    handleSetChannelLogicGroupTrack(
      row.trackAId,
      row.trackBId,
      row.outputChannels,
      row.includesAllShared,
      row.policy,
      side,
      nextTrackId
    );
  const handleChannelLogicRemoveGroup = (row: ChannelLogicOverrideRow) =>
    handleRemoveChannelLogicGroup(
      row.trackAId,
      row.trackBId,
      row.outputChannels,
      row.includesAllShared,
      row.policy
    );
  const midiRouteSummary = channelHocketEnabled
    ? `MIDI hocket ${channelHocketMatrixChannels.length} ch`
    : `MIDI out Ch ${midiOutputChannel}`;
  // Header flags follow one rule across every panel (see PanelStatusChips):
  // surface only active/non-default state; identity and counts live in the
  // title + subtitle, so the default state shows no chips at all.
  // The Sections header carries an always-on status strip (label · value) of the
  // panel's current state, rather than exception chips; see PanelStatusStrip.
  const boundaryStatusStrip: PanelStatusStripEntry[] = [
    { label: "boundaries", value: String(normalizedBoundaries.length) },
    {
      label: "grouping",
      value: jathiAccentMode === "layered" ? "layered" : "override",
    },
    { label: "sections", value: String(normalizedBoundaries.length + 1) },
  ];
  const midiDebugStatusItems: PanelStatusEntry[] = [
    { label: `${midiDebugEvents.length} buffered`, tone: "data" },
  ];
  const visibleParallelConflictEvents = useMemo(
    () =>
      debugTailWhenOpen(
        parallelConflictEvents,
        parallelConflictDebugOpen,
        midiDebugLimit
      ),
    [midiDebugLimit, parallelConflictDebugOpen, parallelConflictEvents]
  );
  const parallelConflictVisibleCount = Math.min(
    parallelConflictEvents.length,
    midiDebugLimit
  );
  const parallelConflictStatusItems: PanelStatusEntry[] = [
    { label: `${parallelConflictEvents.length} decisions`, tone: "data" },
    channelLogicOverrideRows.length > 0 && {
      label: `${channelLogicOverrideRows.length} overrides`,
      tone: "on",
    },
    channelConflictPolicy !== "allowAll" && {
      label: channelConflictPolicyLabel(channelConflictPolicy),
      tone: "on",
    },
  ];
  const automationDebugStatusItems: PanelStatusEntry[] = [
    { label: `${automationDebugEvents.length} buffered`, tone: "data" },
  ];
  const activeMainEditorId: MainEditorId | null = boundariesOpen
    ? "boundaries"
    : generatorOpen
      ? "generator"
      : evolveOpen
        ? "evolve"
        : channelHocketOpen
          ? "channel"
          : null;
  const mainEditorLauncherItems: MainEditorLauncherItem[] = [
    {
      id: "boundaries",
      title: "Sections and Subdivisions",
      summary: `${cycleBeats} beats · ${normalizedBoundaries.length + 1} fixed sections`,
      icon: "boundaries",
      tone: "boundaries",
      active: activeMainEditorId === "boundaries",
    },
    {
      id: "generator",
      title: "Generator",
      summary:
        generatorKind === "dumka"
          ? `${generatorEnabled ? "on" : "off"} · Dum-Ka ${
              dumkaRequired
                ? `${dumkaRequired.cycleBeats} beats`
                : "pattern error"
            } · ${generatorSeedMode} seed`
          : `${generatorEnabled ? "on" : "off"} · ${Math.round(
              generatorDensityPercent
            )}% density · ${generatorSeedMode} seed`,
      icon: "generator",
      tone: "generator",
      active: activeMainEditorId === "generator",
    },
    {
      id: "evolve",
      title: "Evolve",
      summary:
        generatorKind === "dumka"
          ? `${dumkaPlan.length} directive${dumkaPlan.length === 1 ? "" : "s"} · ${
              dumkaPlan.length
                ? `through cycle ${Math.max(...dumkaPlan.map((directive) => directive.toCycle))}`
                : "stochastic gaps"
            }`
          : "Choose Dum-Ka first",
      icon: "evolve",
      tone: "evolve",
      active: activeMainEditorId === "evolve",
    },
    {
      id: "channel",
      title: "Channel",
      summary: channelHocketEventSummary,
      icon: "channel",
      tone: "channel",
      active: activeMainEditorId === "channel",
    },
  ];
  const activeMainEditorTitle =
    mainEditorLauncherItems.find((item) => item.id === activeMainEditorId)?.title ??
    "editor";

  useEffect(() => {
    if (!activeMainEditorId) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProbabilityOpen(false);
      setBoundariesOpen(false);
      setGeneratorOpen(false);
      setEvolveOpen(false);
      setChannelHocketOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeMainEditorId]);

  useEffect(() => {
    const openCount = [
      boundariesOpen,
      generatorOpen,
      evolveOpen,
      channelHocketOpen,
    ].filter(Boolean).length;
    if (openCount <= 1) return;
    setProbabilityOpen(false);
    setBoundariesOpen(activeMainEditorId === "boundaries");
    setGeneratorOpen(activeMainEditorId === "generator");
    setEvolveOpen(activeMainEditorId === "evolve");
    setChannelHocketOpen(activeMainEditorId === "channel");
  }, [
    activeMainEditorId,
    boundariesOpen,
    generatorOpen,
    evolveOpen,
    channelHocketOpen,
  ]);

  const synthPercussionCount = synthProgramRequest.filter(
    (voice) => voice.mode === "percussion"
  ).length;
  const synthMelodicCount = synthProgramRequest.length - synthPercussionCount;

  const updateSynthProgram = (channel: number, program: number) => {
    setSynthPrograms((current) =>
      normalizeSynthPrograms(current).map((voice) =>
        voice.channel === channel
          ? { ...voice, program: clamp(Math.round(program), 0, 127) }
          : voice
      )
    );
  };

  const updateSynthMode = (channel: number, mode: SynthChannelMode) => {
    setSynthPrograms((current) =>
      normalizeSynthPrograms(current).map((voice) =>
        voice.channel === channel ? { ...voice, mode } : voice
      )
    );
  };

  const updateSynthDrumNote = (channel: number, drumNote: number) => {
    setSynthPrograms((current) =>
      normalizeSynthPrograms(current).map((voice) =>
        voice.channel === channel
          ? { ...voice, drumNote: clamp(Math.round(drumNote), 0, 127) }
          : voice
      )
    );
  };

  const applySynthPreset = (voices: SynthChannelProgram[]) => {
    setSynthPrograms(synthProgramsToRequest(voices));
  };

  const renderSectionInspector = (entry: SectionInspectorEntry) => {
    const resolvedSection = entry.resolvedSection;
    const weights =
      entry.kind === "boundary" ? entry.boundary.weights : initialWeights;
    const groupingWeights =
      entry.kind === "boundary"
        ? entry.boundary.jathiWeights
        : initialJathiWeights;
    const fixedControls = (
      <FixedSectionControls
        subdivision={fixedSubdivisionFromWeights(
          weights,
          resolvedSection?.gati
        )}
        grouping={fixedGroupingFromWeights(
          groupingWeights,
          resolvedSection?.timingMatras,
          resolvedSection?.gatiTimingFrameMatras
        )}
        totalMatras={resolvedSection?.timingMatras}
        timingGrid={resolvedSection?.gatiTimingFrameMatras}
        disabled={playbackStructureLocked}
        onSubdivisionChange={(subdivision) => {
          const patch = {
            weights: fixedSubdivisionWeights(subdivision),
            customSubdivision: null,
          };
          if (entry.kind === "boundary") {
            updateBoundary(entry.index, patch);
          } else {
            setInitialWeights(patch.weights);
            setInitialCustomSubdivision(null);
          }
        }}
        onGroupingChange={(grouping) => {
          const jathiWeights = fixedGroupingWeights(grouping);
          if (entry.kind === "boundary") {
            updateBoundary(entry.index, { jathiWeights });
          } else {
            setInitialJathiWeights(jathiWeights);
          }
        }}
      />
    );

    if (entry.kind === "initial") return fixedControls;

    return (
      <>
        <div className="boundary-controls section-inspector-boundary-controls">
          <label>
            After beat
            <BoundaryAfterBeatSelect
              cycleBeats={cycleBeats}
              boundaries={normalizedBoundaries}
              value={entry.boundary.afterBeat}
              disabled={playbackStructureLocked}
              onChange={(afterBeat) => updateBoundary(entry.index, { afterBeat })}
            />
          </label>
          <span className="mini-readout">
            Starts section at beat {entry.boundary.afterBeat + 1}
          </span>
          <button
            className="tiny-button"
            type="button"
            disabled={playbackStructureLocked}
            onClick={() => removeBoundary(entry.index)}
          >
            remove
          </button>
        </div>
        {fixedControls}
      </>
    );
  };

  useLayoutEffect(() => {
    applyThemeMode(themeMode);
    writeThemePreference(themeMode);
  }, [themeMode]);

  // ---- Track Flow lane composition ------------------------------------------
  // Walk authored track order; render parallel tracks as ordinary tabs and group
  // each box's members under a collapsible super-tab at the position of the box's
  // earliest-appearing member. Empty box drafts still render so a track can be
  // dropped in. Drag-and-drop moves a track into a box (drop on the box) or back
  // to parallel (drop on the lane).
  const trackIndexById = new Map(
    parallelTrackTabs.map((track, index) => [track.id, index] as const)
  );
  type LaneTrackTab = (typeof parallelTrackTabs)[number];
  type BoxMember = { track: LaneTrackTab; index: number };
  type LaneItem =
    | { kind: "track"; track: LaneTrackTab; index: number }
    | { kind: "box"; box: TrackFlowBox; members: BoxMember[] };
  const laneItems: LaneItem[] = (() => {
    const items: LaneItem[] = [];
    const emitted = new Set<string>();
    const tabById = new Map(parallelTrackTabs.map((t) => [t.id, t] as const));
    parallelTrackTabs.forEach((track, index) => {
      const box = boxForTrack(trackFlowBoxesList, track.id);
      if (!box) {
        items.push({ kind: "track", track, index });
        return;
      }
      if (emitted.has(box.id)) return;
      emitted.add(box.id);
      const members: BoxMember[] = box.memberTrackIds.flatMap((id) => {
        const tab = tabById.get(id);
        return tab ? [{ track: tab, index: trackIndexById.get(id) ?? 0 }] : [];
      });
      items.push({ kind: "box", box, members });
    });
    for (const box of trackFlowBoxesList) {
      if (!emitted.has(box.id)) {
        emitted.add(box.id);
        items.push({ kind: "box", box, members: [] });
      }
    }
    return items;
  })();
  const laneIsPlaying = snapshot?.isPlaying ?? false;
  // Live per-track playback state for the track strip (sounding / armed /
  // driving / waiting / silenced) — one pure derivation shared by every tab,
  // chip, and box readout so they can never disagree about what is playing.
  const trackPlaybackStateById = useMemo(
    () =>
      trackPlaybackStates({
        isPlaying: laneIsPlaying,
        positions: snapshot?.parallelTrackPositions ?? [],
        trackFlowEvents: snapshot?.trackFlowEvents ?? [],
        tracks: parallelProject?.tracks ?? [],
        boxes: parallelProject?.global.trackFlowBoxes ?? [],
      }),
    [laneIsPlaying, snapshot, parallelProject]
  );
  const draggingBoxedTrack =
    draggingTrackId != null && boxedTrackIds.has(draggingTrackId);
  const laneDropTargetFromPoint = (
    clientX: number,
    clientY: number
  ): string | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const target = element?.closest<HTMLElement>("[data-track-flow-drop-target]");
    if (!target) return null;
    const rawTarget = target.dataset.trackFlowDropTarget;
    if (rawTarget === "parallel") return "";
    return rawTarget ?? null;
  };

  const clearPointerTrackDrag = () => {
    pointerTrackDragCleanupRef.current?.();
    pointerTrackDragCleanupRef.current = null;
    pointerTrackDragRef.current = null;
    setDraggingTrackId(null);
    setDragOverTarget(null);
  };
  useDiscardEditorDraft(clearPointerTrackDrag);

  const beginPointerTrackDrag = (
    event: ReactPointerEvent<HTMLElement>,
    trackId: string
  ) => {
    if (playbackStructureLocked || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        ".parallel-track-mini, .tf-box-mini, input, textarea, select, [contenteditable='true']"
      )
    ) {
      return;
    }

    clearPointerTrackDrag();
    pointerTrackDragRef.current = {
      trackId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = pointerTrackDragRef.current;
      if (!drag || drag.pointerId !== moveEvent.pointerId) return;
      const deltaX = moveEvent.clientX - drag.startX;
      const deltaY = moveEvent.clientY - drag.startY;
      if (!drag.active && Math.hypot(deltaX, deltaY) < 5) return;
      if (!drag.active) {
        drag.active = true;
        setDraggingTrackId(drag.trackId);
      }
      moveEvent.preventDefault();
      setDragOverTarget(
        laneDropTargetFromPoint(moveEvent.clientX, moveEvent.clientY)
      );
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const drag = pointerTrackDragRef.current;
      if (!drag || drag.pointerId !== upEvent.pointerId) return;
      const dropTarget = drag.active
        ? laneDropTargetFromPoint(upEvent.clientX, upEvent.clientY)
        : null;
      const draggedTrackId = drag.trackId;
      const wasActive = drag.active;
      clearPointerTrackDrag();
      if (!wasActive) return;
      upEvent.preventDefault();
      // Swallow the synthetic click the browser fires on the source tab right
      // after a drag (so it doesn't re-select the track). A drag usually fires
      // no click at all, so auto-expire the flag on the next tick — otherwise it
      // would linger and silently eat the user's next real click on that tab.
      suppressTrackClickRef.current = draggedTrackId;
      window.setTimeout(() => {
        if (suppressTrackClickRef.current === draggedTrackId) {
          suppressTrackClickRef.current = null;
        }
      }, 0);
      if (dropTarget !== null) {
        handleAssignTrackToBox(draggedTrackId, dropTarget);
      }
    };

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      const drag = pointerTrackDragRef.current;
      if (drag && drag.pointerId === cancelEvent.pointerId) {
        clearPointerTrackDrag();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerCancel);
    pointerTrackDragCleanupRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  };

  useEffect(
    () => () => {
      pointerTrackDragCleanupRef.current?.();
    },
    []
  );

  const boxDropHandlers = (boxId: string) => ({
    onDragOver: (e: ReactDragEvent) => {
      if (!draggingTrackId) return;
      e.preventDefault();
      e.stopPropagation();
      if (dragOverTarget !== boxId) setDragOverTarget(boxId);
    },
    onDragLeave: () => {
      setDragOverTarget((cur) => (cur === boxId ? null : cur));
    },
    onDrop: (e: ReactDragEvent) => {
      if (!draggingTrackId) return;
      e.preventDefault();
      e.stopPropagation();
      handleAssignTrackToBox(draggingTrackId, boxId);
      setDraggingTrackId(null);
      setDragOverTarget(null);
    },
  });

  const renderTrackCell = (
    track: LaneTrackTab,
    index: number,
    boxed: boolean
  ) => {
    const active = track.id === activeParallelTrackId;
    const audible = !track.muted && (!parallelSoloActive || track.soloed);
    const trackLabel = `Track ${index + 1}`;
    const customName = track.name.trim();
    const hasCustomName = customName.length > 0 && customName !== trackLabel;
    const playbackState = trackPlaybackStateById.get(track.id) ?? "idle";
    const triggerRunning = track.triggered && playbackState === "sounding";
    return (
      <div
        className={`parallel-track-cell${active ? " is-active" : ""}${
          track.muted ? " is-muted" : ""
        }${track.soloed ? " is-soloed" : ""}${boxed ? " is-box-member" : ""}${
          draggingTrackId === track.id ? " is-dragging" : ""
        }`}
        key={track.id}
        data-testid={`parallel-track-cell-${track.id}`}
        style={{ "--track-color": track.color } as CSSProperties}
        draggable={false}
        onPointerDown={(e) => beginPointerTrackDrag(e, track.id)}
        onDragStart={(e) => {
          setDraggingTrackId(track.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", track.id);
        }}
        onDragEnd={() => {
          setDraggingTrackId(null);
          setDragOverTarget(null);
        }}
      >
        <button
          id={`parallel-track-tab-${track.id}`}
          className="parallel-track-tab"
          type="button"
          aria-current={active ? "true" : undefined}
          aria-controls="active-track-workspace"
          data-testid={`parallel-track-tab-${track.id}`}
          disabled={playbackTransitionKind !== "idle"}
          onClick={() => {
            if (suppressTrackClickRef.current === track.id) {
              suppressTrackClickRef.current = null;
              return;
            }
            void handleSelectParallelTrack(track.id);
          }}
          title={`${trackLabel}${hasCustomName ? ` · ${customName}` : ""} · ${
            audible ? "audible" : "muted for parallel playback"
          }${track.tempoBadge ? ` · ${track.tempoBadge}` : ""} · ${
            track.tempoMode === "global" ? "global BPM" : "custom BPM"
          } · ${
            track.cycleLengthMode === "global" ? "global cycle" : "custom cycle"
          }${boxed ? " · drag out of the box to make it parallel" : ""}`}
        >
          <i aria-hidden="true" />
          {playbackState !== "idle" ? (
            <span
              className={`parallel-track-live is-${playbackState}`}
              data-testid={`parallel-track-live-${track.id}`}
              data-state={playbackState}
              title={TRACK_PLAYBACK_STATE_LABELS[playbackState]}
              aria-hidden="true"
            />
          ) : null}
          <span>
            <b>{trackLabel}</b>
            {track.triggered ? (
              <span
                className={`parallel-track-trigger-chip${
                  triggerRunning ? " is-running" : ""
                }`}
                data-testid={`parallel-track-trigger-chip-${track.id}`}
                title={
                  triggerRunning
                    ? "Triggered track — running"
                    : "Triggered track — armed"
                }
              >
                {triggerRunning ? "run" : "trig"}
              </span>
            ) : null}
            {hasCustomName || track.tempoBadge ? (
              <span className="parallel-track-tab-meta">
                {hasCustomName ? <em>{customName}</em> : null}
                {track.tempoBadge ? <small>{track.tempoBadge}</small> : null}
              </span>
            ) : null}
          </span>
        </button>
        <button
          className={`parallel-track-mini${track.muted ? " is-on" : ""}`}
          type="button"
          aria-pressed={track.muted}
          aria-label={`Mute ${track.name}`}
          title="Mute track for parallel playback"
          onClick={() => toggleParallelTrackMute(track.id)}
        >
          M
        </button>
        <button
          className={`parallel-track-mini${track.soloed ? " is-on" : ""}`}
          type="button"
          aria-pressed={track.soloed}
          aria-label={`Solo ${track.name}`}
          title="Solo track for parallel playback"
          onClick={() => toggleParallelTrackSolo(track.id)}
        >
          S
        </button>
        <button
          className="parallel-track-mini parallel-track-export"
          type="button"
          aria-label={`Export ${track.name} to a file`}
          title="Export this track to a file"
          onClick={() => void handleExportTrack(track.id)}
        >
          <span aria-hidden="true">↧</span>
        </button>
        <button
          className="parallel-track-mini parallel-track-delete"
          type="button"
          aria-label={`Delete ${hasCustomName ? customName : trackLabel}`}
          title="Delete this track"
          disabled={parallelTrackTabs.length <= 1 || playbackStructureLocked}
          onClick={() => requestRemoveParallelTrack(track.id)}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    );
  };

  const renderBoxNameInput = (box: TrackFlowBox) => (
    <input
      className="tf-box-name-input"
      type="text"
      defaultValue={box.name}
      aria-label="Track Flow box name"
      data-testid={`track-flow-box-name-input-${box.id}`}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        handleRenameBox(box.id, e.target.value.trim() || box.name);
        setRenamingBoxId(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") setRenamingBoxId(null);
      }}
    />
  );

  const renderBox = (box: TrackFlowBox, members: BoxMember[]) => {
    const isDropTarget = dragOverTarget === box.id;
    const renaming = renamingBoxId === box.id;
    const count = members.length;
    // The member the box's lane is sounding this cycle (collapsed boxes hide
    // their member tabs, so the tab itself must say who is playing).
    const nowPlaying = members.find(
      (member) => trackPlaybackStateById.get(member.track.id) === "sounding"
    );
    const summary = `${count} ${count === 1 ? "track" : "tracks"} · alternates`;
    if (box.collapsed) {
      return (
        <div
          className={`parallel-track-cell tf-box tf-box--collapsed${
            isDropTarget ? " is-drop-target" : ""
          }`}
          key={box.id}
          data-testid={`track-flow-box-${box.id}`}
          data-track-flow-drop-target={box.id}
          style={{ "--track-color": "var(--violet)" } as CSSProperties}
          {...boxDropHandlers(box.id)}
        >
          <button
            className="parallel-track-tab tf-box-tab"
            type="button"
            title={`Track Flow box "${box.name}" — ${summary}. Click to expand; drag tracks here to add them.`}
            onClick={() => handleToggleBoxCollapsed(box.id)}
          >
            <i aria-hidden="true" />
            {nowPlaying ? (
              <span
                className="parallel-track-live is-sounding"
                data-testid={`track-flow-box-live-${box.id}`}
                title={`Playing ${nowPlaying.track.name || "a member track"}`}
                aria-hidden="true"
              />
            ) : null}
            <span>
              {renaming ? renderBoxNameInput(box) : <b>{box.name}</b>}
              <span className="parallel-track-tab-meta">
                <small>{summary}</small>
                {nowPlaying ? (
                  <small
                    className="tf-box-now-playing"
                    data-testid={`track-flow-box-now-${box.id}`}
                  >
                    ▸ {nowPlaying.track.name?.trim() || `Track ${nowPlaying.index + 1}`}
                  </small>
                ) : null}
              </span>
            </span>
          </button>
          <button
            className="parallel-track-mini tf-box-matrix"
            type="button"
            aria-label={`Edit ${box.name} transition matrix`}
            title="Box transition matrix"
            disabled={count < 2}
            data-testid={`track-flow-box-matrix-${box.id}`}
            onClick={() => setMatrixBoxId(box.id)}
          >
            <span aria-hidden="true">▦</span>
          </button>
          <button
            className="parallel-track-mini"
            type="button"
            aria-label={`Expand ${box.name}`}
            title="Expand box"
            onClick={() => handleToggleBoxCollapsed(box.id)}
          >
            <span aria-hidden="true">▸</span>
          </button>
          <button
            className="parallel-track-mini parallel-track-delete"
            type="button"
            aria-label={`Delete box ${box.name}`}
            title="Delete box (members become parallel)"
            disabled={playbackStructureLocked}
            onClick={() => handleDeleteBox(box.id)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      );
    }
    return (
      <div
        className={`tf-box-group${isDropTarget ? " is-drop-target" : ""}`}
        key={box.id}
        data-testid={`track-flow-box-${box.id}`}
        data-track-flow-drop-target={box.id}
        style={{ "--track-color": "var(--violet)" } as CSSProperties}
        {...boxDropHandlers(box.id)}
      >
        <div className="tf-box-head">
          <button
            className="tf-box-head-toggle"
            type="button"
            title={`Collapse ${box.name}`}
            aria-label={`Collapse ${box.name}`}
            onClick={() => handleToggleBoxCollapsed(box.id)}
          >
            <span className="tf-box-glyph" aria-hidden="true">
              ▾
            </span>
            {renaming ? (
              renderBoxNameInput(box)
            ) : (
              <b
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenamingBoxId(box.id);
                }}
              >
                {box.name}
              </b>
            )}
            <small>{summary}</small>
          </button>
          <button
            className="tf-box-mini tf-box-matrix"
            type="button"
            aria-label={`Edit ${box.name} transition matrix`}
            title="Box transition matrix"
            disabled={count < 2}
            data-testid={`track-flow-box-matrix-${box.id}`}
            onClick={() => setMatrixBoxId(box.id)}
          >
            <span aria-hidden="true">▦</span>
          </button>
          <button
            className="tf-box-mini"
            type="button"
            aria-label={`Rename ${box.name}`}
            title="Rename box"
            onClick={() => setRenamingBoxId(box.id)}
          >
            <span aria-hidden="true">✎</span>
          </button>
          <button
            className="tf-box-mini parallel-track-delete"
            type="button"
            aria-label={`Delete box ${box.name}`}
            title="Delete box (members become parallel)"
            disabled={playbackStructureLocked}
            onClick={() => handleDeleteBox(box.id)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="tf-box-members">
          {members.length === 0 ? (
            <span className="tf-box-empty">Drag tracks here</span>
          ) : (
            members.map((member, i) => (
              <span className="tf-box-member-wrap" key={member.track.id}>
                {i > 0 ? (
                  <span className="tf-seq" aria-hidden="true">
                    ›
                  </span>
                ) : null}
                {renderTrackCell(member.track, member.index, true)}
              </span>
            ))
          )}
        </div>
      </div>
    );
  };

  const matrixBox = matrixBoxId
    ? trackFlowBoxesList.find((box) => box.id === matrixBoxId) ?? null
    : null;
  const matrixBoxMembers = matrixBox
    ? matrixBox.memberTrackIds.map((id) => ({
        id,
        name: trackNameById.get(id) ?? id,
      }))
    : [];

  return (
    <main
      className={`app-shell${automationPickMode ? " is-automation-picking" : ""}`}
      onClickCapture={handleAutomationShortcutClick}
    >
      <AutomationFocusModal
        automatedTargetIds={automatedTargetIds}
        automationFocusPanel={automationFocusPanel}
        openAutomationTarget={openAutomationTarget}
        playbackStructureLocked={playbackStructureLocked}
        selectedAutomationFocusTargets={selectedAutomationFocusTargets}
        setAutomationFocusPanel={setAutomationFocusPanel}
      />
      <header className="top-bar">
        <div className="masthead">
          <h1>Dum-Ka</h1>
          <p>
            Each section has one subdivision that divides its beats into pulses.
            Authored boundaries start new sections.
          </p>
        </div>
        <div className="status-stack">
          <SeedHistoryLoopMonitor
            rows={seedRecurrenceRows}
            fallbackLabel={seedHistoryShortcutLabel}
            onOpenLog={() => openSeedSetup("log")}
          />
          {showMissingChip(midiRouteStatus) && (
            <button
              className="midi-route-chip"
              type="button"
              title={routeStatusLine(midiRouteStatus)}
              onClick={() => {
                setSetupTab("midi");
                setSetupOpen(true);
              }}
            >
              {missingChipLabel(midiRouteStatus)}
            </button>
          )}
          <span className="score-id" title="Current score">
            <small>Score</small>
            <strong>{snapshot?.currentScoreId ?? "No score"}</strong>
          </span>
          <div className="status-controls">
            <ThemeToggle mode={themeMode} onChange={setThemeMode} />
          </div>
        </div>
      </header>

      {(error || previewError || patchStatus) && (
        <section className="notice-stack">
          {error && <div className="error-banner">{error}</div>}
          {previewError && <div className="preview-banner">{previewError}</div>}
          {patchStatus && <div className="success-banner">{patchStatus}</div>}
        </section>
      )}

      <DeleteTrackConfirmModal
        handleExportTrack={handleExportTrack}
        handleRemoveParallelTrack={handleRemoveParallelTrack}
        pendingDeleteTrack={pendingDeleteTrack}
        pendingDeleteTrackLabel={pendingDeleteTrackLabel}
        pendingDeleteTrackName={pendingDeleteTrackName}
        setPendingDeleteTrackId={setPendingDeleteTrackId}
      />

      <BoundaryDetailDialog
        cycleBeats={cycleBeats}
        playbackStructureLocked={playbackStructureLocked}
        removeBoundaryAfterBeat={removeBoundaryAfterBeat}
        normalizedBoundaries={normalizedBoundaries}
        selectedBoundary={selectedBoundary}
        selectedBoundaryIndex={selectedBoundaryIndex}
        selectedBoundaryResolvedSection={selectedBoundaryResolvedSection}
        setSelectedBoundaryAfterBeat={setSelectedBoundaryAfterBeat}
        updateBoundary={updateBoundary}
      />

      <SetupDialog
        autoloadRecentSession={autoloadRecentSession}
        autosaveEnabled={autosaveEnabled}
        autosaveIntervalMs={autosaveIntervalMs}
        channelHocketEnabled={channelHocketEnabled}
        channelHocketMatrixChannels={channelHocketMatrixChannels}
        currentPatchFingerprintRef={currentPatchFingerprintRef}
        currentPatchPath={currentPatchPath}
        handleExportScore={handleExportScore}
        handleMidiDestinationPick={handleMidiDestinationPick}
        handleMidiRescan={handleMidiRescan}
        handlePanic={handlePanic}
        handleSavePatchAs={handleSavePatchAs}
        handleSynthToggle={handleSynthToggle}
        lastAutosaveAt={lastAutosaveAt}
        lastAutosavedFingerprintRef={lastAutosavedFingerprintRef}
        markPersistenceForFingerprint={markPersistenceForFingerprint}
        midiDebugOpen={midiDebugOpen}
        midiDestinations={midiDestinations}
        midiOutputChannel={midiOutputChannel}
        midiRouteStatus={midiRouteStatus}
        patchPersistenceState={patchPersistenceState}
        setAutoloadRecentSession={updateAutoloadRecentSession}
        setAutosaveIntervalMs={updateAutosaveIntervalMs}
        setError={setError}
        setLastAutosaveAt={setLastAutosaveAt}
        setMainEditorOpen={setMainEditorOpen}
        setMidiDebugOpen={setMidiDebugOpen}
        setMidiOutputChannel={setMidiOutputChannel}
        setSetupOpen={setSetupOpen}
        setSetupTab={setSetupTab}
        setSynthPropertiesOpen={setSynthPropertiesOpen}
        setupOpen={setupOpen}
        setupTab={setupTab}
        synthEnabled={synthEnabled}
        synthMelodicCount={synthMelodicCount}
        synthPending={synthPending}
        synthPercussionCount={synthPercussionCount}
        updateAutosaveEnabled={updateAutosaveEnabled}
      />

      <SeedSetupDialog
        channelHocketHistorySeedsInput={channelHocketHistorySeedsInput}
        channelHocketMaxHistory={channelHocketMaxHistory}
        channelHocketSeed={channelHocketSeed}
        channelHocketSeedBehavior={channelHocketSeedBehavior}
        globalHistorySeeds={globalHistorySeeds}
        globalSeedMode={globalSeedMode}
        globalSeedStartupLocked={globalSeedStartupLocked}
        historySeedsInput={historySeedsInput}
        maxHistory={maxHistory}
        seed={seed}
        seedLogScope={seedLogScope}
        seedPaths={seedPaths}
        seedSetupOpen={seedSetupOpen}
        seedSetupTab={seedSetupTab}
        setChannelHocketHistorySeedsInput={setChannelHocketHistorySeedsInput}
        setChannelHocketMaxHistory={setChannelHocketMaxHistory}
        setChannelHocketSeed={setChannelHocketSeed}
        setChannelHocketSeedBehavior={setChannelHocketSeedBehavior}
        setGlobalSeedStartupLocked={setGlobalSeedStartupLocked}
        setHistorySeedsInput={setHistorySeedsInput}
        setMaxHistory={setMaxHistory}
        setSeed={setSeed}
        setSeedLogScope={setSeedLogScope}
        setSeedMode={setSeedMode}
        setSeedSetupOpen={setSeedSetupOpen}
        setSeedSetupTab={setSeedSetupTab}
        visibleSeedPaths={visibleSeedPaths}
        visibleSeedPoolLogEntries={visibleSeedPoolLogEntries}
      />

      <SynthPropertiesModal
        applySynthPreset={applySynthPreset}
        channelHocketEnabled={channelHocketEnabled}
        channelHocketMatrixChannels={channelHocketMatrixChannels}
        midiOutputChannel={midiOutputChannel}
        setSynthPrograms={setSynthPrograms}
        setSynthPropertiesOpen={setSynthPropertiesOpen}
        synthEnabled={synthEnabled}
        synthMelodicCount={synthMelodicCount}
        synthPercussionCount={synthPercussionCount}
        synthProgramRequest={synthProgramRequest}
        synthPropertiesOpen={synthPropertiesOpen}
        updateSynthDrumNote={updateSynthDrumNote}
        updateSynthMode={updateSynthMode}
        updateSynthProgram={updateSynthProgram}
      />

      <section className="control-bar">
        <div className="transport-cluster" aria-label="Transport">
          <span className={`transport-state${snapshot?.isPlaying ? " is-live" : ""}`}>
            <span />
            {playbackTransitionKind === "starting"
              ? "Starting"
              : playbackTransitionKind === "stopping"
                ? "Stopping"
                : snapshot?.isPlaying
                  ? "Running"
                  : "Idle"}
          </span>
          <button
            className="transport-action"
            data-testid="transport-play"
            onClick={handlePlay}
            disabled={
              (snapshot?.isPlaying ?? false) ||
              playbackTransitionKind !== "idle" ||
              !canStartPlayback
            }
            title={playbackAvailability.title}
            aria-describedby={
              playbackAvailability.kind === "rejected"
                ? TRANSPORT_WARNING_ID
                : undefined
            }
          >
            <span aria-hidden="true">▶</span>
            Play
          </button>
          <button
            className="transport-action"
            data-testid="transport-stop"
            onClick={handleStop}
            disabled={
              playbackTransitionKind === "stopping" ||
              (!(snapshot?.isPlaying ?? false) &&
                playbackTransitionKind !== "starting")
            }
          >
            <span aria-hidden="true">■</span>
            Stop
          </button>
        </div>

        <TransportWarning message={playbackAvailability.message} />

        <div className="synth-cluster" aria-label="Built-in synth">
          <button
            className={`app-toggle synth-toggle${synthEnabled ? " is-on" : ""}`}
            type="button"
            onClick={handleSynthToggle}
            aria-pressed={synthEnabled}
            disabled={synthPending}
            title="Turn the built-in synth audio monitor on or off"
          >
            <span className="toggle-dot" aria-hidden="true" />
            <span>Synth {synthEnabled ? "on" : "off"}</span>
          </button>
          <button
            className="synth-properties-button"
            type="button"
            onClick={() => setSynthPropertiesOpen(true)}
          >
            Properties
          </button>
        </div>

        <label className="tempo-field global-tempo-field">
          <span className="field-label">Global BPM</span>
          <div className="value-with-unit">
            <NumericField
              min={20}
              max={400}
              step={0.5}
              value={hasMultipleParallelTracks ? globalTempoFieldValue : tempoInput}
              aria-label="Tempo"
              onFocus={() => {
                if (!hasMultipleParallelTracks) {
                  tempoEditingRef.current = true;
                }
              }}
              onValueCommit={(_tempo, text) => {
                if (hasMultipleParallelTracks) {
                  void commitParallelGlobalTempo(text);
                } else {
                  setTempoInput(text);
                  void commitTempo(text);
                }
              }}
            />
            <span className="unit">BPM</span>
          </div>
        </label>

        {hasMultipleParallelTracks && (
          <label className="tempo-field global-cycle-field">
            <span className="field-label">Project cycle</span>
            <div className="value-with-unit">
              <NumericField
                min={1}
                max={64}
                step={1}
                value={parallelGlobalCycleBeats}
                onValueCommit={(_cycle, text) =>
                  void commitParallelGlobalCycle(text)
                }
                disabled={playbackStructureLocked}
                aria-label="Project cycle"
                title="Shared default cycle for tracks set to follow global. Custom tracks keep their own."
              />
              <span className="unit">beats</span>
            </div>
          </label>
        )}

        <div className="patch-cluster" aria-label="Patch memory">
          <button className="patch-action" type="button" onClick={handleSavePatch}>
            Save
          </button>
          <button
            className="patch-action"
            type="button"
            onClick={handleLoadPatch}
            disabled={playbackStructureLocked}
          >
            Recall
          </button>
          <button
            className={`patch-action patch-autosave-toggle${
              autosaveEnabled ? " is-on" : ""
            }`}
            type="button"
            onClick={handleToggleAutosave}
            aria-pressed={autosaveEnabled}
            title={
              autosaveEnabled
                ? "Autosave recovery is on. Recovery prompts only appear after an unclean shutdown."
                : "Autosave recovery is off."
            }
          >
            Auto {autosaveEnabled ? "on" : "off"}
          </button>
          <span
            className={`patch-file-readout is-${patchPersistenceState}`}
            title={[
              currentPatchPath ?? "No patch file selected yet",
              lastSavedAt
                ? `Saved ${new Date(lastSavedAt).toLocaleString()}`
                : null,
              autosaveEnabled ? "Autosave recovery on" : "Autosave recovery off",
              lastAutosaveAt
                ? `Autosaved recovery ${new Date(lastAutosaveAt).toLocaleString()}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <b>
              {patchPersistenceState === "saved"
                ? "saved"
                : patchPersistenceState === "autosaved"
                  ? "autosaved"
                  : patchPersistenceState === "autosaving"
                    ? "autosaving"
                    : patchPersistenceState === "checking"
                      ? "checking"
                      : "unsaved"}
            </b>
            <span>
              {currentPatchPath ? fileNameFromPath(currentPatchPath) : "untitled"}
            </span>
            {patchPersistenceState === "autosaved" && lastAutosaveAt ? (
              <em>
                {new Date(lastAutosaveAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </em>
            ) : null}
          </span>
        </div>

      </section>

      {parallelTrackTabs.length > 1 ? (
        <ChannelLogicPanel
          defaultPolicy={channelConflictPolicy}
          overrideRows={channelLogicOverrideRows}
          effectiveSummaries={channelLogicEffectiveSummaries}
          trackOptions={channelLogicTrackOptions}
          priorityRows={parallelPriorityRows}
          showPriority={channelLogicShowPriority}
          priorityUsedBy={channelLogicPriorityUsedBy}
          helpOpen={channelLogicHelpOpen}
          hasAvailablePair={hasAvailableChannelLogicPair}
          addDisabledReason={channelLogicAddDisabledReason}
          onSetDefaultPolicy={handleSetChannelConflictPolicy}
          onSetGroupPolicy={handleChannelLogicGroupPolicy}
          onToggleChannel={handleChannelLogicToggleChannel}
          onSetGroupTrack={handleChannelLogicGroupTrack}
          onAddPair={handleAddChannelLogicPair}
          onRemoveGroup={handleChannelLogicRemoveGroup}
          onToggleHelp={() => setChannelLogicHelpOpen((open) => !open)}
          onMovePriority={moveParallelTrackPriority}
        />
      ) : null}

      <section
        id="active-track-workspace"
        className="active-track-workspace"
        aria-label={`Active track workspace for ${activeParallelTrackLabel}${
          activeParallelTrackHasCustomName
            ? `, ${activeParallelTrackCustomName}`
            : ""
        }`}
        style={{ "--active-track-color": activeParallelTrack.color } as CSSProperties}
      >
      <section className="parallel-track-strip" aria-label="Parallel tracks">
        <div className="parallel-track-list-row">
          <div
            className={`parallel-track-tabs${
              draggingBoxedTrack ? " is-drop-parallel" : ""
            }`}
            role="group"
            aria-label="Tracks"
            data-track-flow-drop-target="parallel"
            onDragOver={(e) => {
              if (draggingTrackId) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!draggingTrackId) return;
              e.preventDefault();
              handleAssignTrackToBox(draggingTrackId, "");
              setDraggingTrackId(null);
              setDragOverTarget(null);
            }}
          >
            {laneItems.map((item) =>
              item.kind === "track"
                ? renderTrackCell(item.track, item.index, false)
                : renderBox(item.box, item.members)
            )}
          </div>
          <div className="parallel-track-actions" aria-label="Track actions">
            <button
              className="parallel-track-action-icon"
              type="button"
              aria-label="New track"
              title="New track"
              disabled={
                parallelTrackTabs.length >= MAX_PARALLEL_TRACKS ||
                playbackStructureLocked
              }
              onClick={() => void handleCreateParallelTrack(false)}
            >
              <span aria-hidden="true">+</span>
            </button>
            <button
              className="parallel-track-action-icon"
              type="button"
              aria-label="Copy active track"
              title="Copy active track"
              disabled={
                parallelTrackTabs.length >= MAX_PARALLEL_TRACKS ||
                playbackStructureLocked
              }
              onClick={() => void handleCreateParallelTrack(true)}
            >
              <span aria-hidden="true">⧉</span>
            </button>
            <button
              className="parallel-track-action-icon"
              type="button"
              aria-label="Import track from a file"
              title="Import a track from a file"
              disabled={
                parallelTrackTabs.length >= MAX_PARALLEL_TRACKS ||
                playbackStructureLocked
              }
              onClick={() => void handleImportTrack()}
            >
              <span aria-hidden="true">↥</span>
            </button>
            <button
              className="parallel-track-action-icon parallel-track-action-box"
              type="button"
              aria-label="New Track Flow box"
              title="New Track Flow box — then drag tracks into it"
              data-testid="track-flow-add-box"
              disabled={playbackStructureLocked}
              onClick={() => handleCreateBox()}
            >
              <span aria-hidden="true">▦+</span>
            </button>
          </div>
        </div>

        <div className="parallel-track-tools" aria-label="Active track settings">
          <div className="active-track-header-line">
            <div className="atk-group">
              <span className="atk-group-cap">Track</span>
              <div className="atk-group-row active-track-identity">
                <span
                  className="active-track-dot"
                  style={{ background: activeParallelTrack.color }}
                  aria-hidden="true"
                />
                <span className="active-track-ordinal">{activeParallelTrackLabel}</span>
                {renamingParallelTrackId === activeParallelTrack.id ? (
                  <input
                    key={activeParallelTrack.id}
                    type="text"
                    defaultValue={activeParallelTrack.name}
                    aria-label="Active track name"
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => commitActiveParallelTrackName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      } else if (e.key === "Escape") {
                        setRenamingParallelTrackId(null);
                      }
                    }}
                  />
                ) : (
                  <strong title={activeParallelTrackCustomName}>
                    {activeParallelTrackNameSummary}
                  </strong>
                )}
                <button
                  className="tiny-button"
                  type="button"
                  aria-label={`Rename ${activeParallelTrackLabel}`}
                  onClick={() => setRenamingParallelTrackId(activeParallelTrack.id)}
                >
                  rename
                </button>
              </div>
            </div>
            <span className="atk-group-divider" aria-hidden="true" />
            <div className="atk-group">
              <span className="atk-group-cap">Timing</span>
              <div className="atk-group-row">
                <span
                  className="parallel-track-value-field active-track-cycle"
                  title="Beats per cycle for this track"
                >
                  <span>Cycle</span>
                  {hasMultipleParallelTracks ? (
                    <>
                      <select
                        aria-label="Track cycle mode"
                        value={activeTrackCycleLengthMode}
                        disabled={playbackStructureLocked}
                        onChange={(e) =>
                          void handleSetActiveTrackCycleLengthMode(
                            e.target.value as TrackCycleLengthMode
                          )
                        }
                      >
                        <option value="global">global</option>
                        <option value="custom">custom</option>
                      </select>
                      <NumericField
                        min={1}
                        max={64}
                        step={1}
                        value={cycleBeats}
                        aria-label="Track custom cycle"
                        disabled={
                          activeTrackCycleLengthMode !== "custom" || playbackStructureLocked
                        }
                        onValueCommit={(value) => handleCycleBeatsChange(value)}
                      />
                    </>
                  ) : (
                    <NumericField
                      min={1}
                      max={64}
                      step={1}
                      value={cycleBeats}
                      aria-label="Track cycle"
                      disabled={playbackStructureLocked}
                      onValueCommit={(value) => handleCycleBeatsChange(value)}
                    />
                  )}
                </span>
                <label className="parallel-track-select-field">
                  <span>BPM</span>
                  <select
                    aria-label="Track BPM mode"
                    value={activeTrackTempoMode}
                    disabled={playbackStructureLocked}
                    onChange={(e) =>
                      void handleSetActiveTrackTempoMode(
                        e.target.value as TrackTempoMode
                      )
                    }
                  >
                    <option value="global">global</option>
                    <option value="custom">custom</option>
                  </select>
                </label>
                <label className="parallel-track-value-field">
                  <span>{activeTrackTempoMode === "custom" ? "Track BPM" : "Inherited"}</span>
                  <NumericField
                    min={20}
                    max={400}
                    step={0.5}
                    value={tempoInput}
                    data-automation-target={
                      activeTrackTempoMode === "custom" ? "transport.tempoBpm" : undefined
                    }
                    aria-label="Track custom BPM"
                    disabled={
                      activeTrackTempoMode !== "custom" || playbackStructureLocked
                    }
                    onFocus={() => {
                      tempoEditingRef.current = true;
                    }}
                    onValueCommit={(_tempo, text) => {
                      setTempoInput(text);
                      void commitActiveTrackTempo(text);
                    }}
                  />
                  {showTrackTempoAutomationFocus
                    ? renderAutomationFocusButton("Track BPM", ["transport.tempoBpm"])
                    : null}
                </label>
              </div>
            </div>
            <span className="atk-group-divider" aria-hidden="true" />
            <div className="atk-group">
              <span className="atk-group-cap">Automation</span>
              <div className="atk-group-row">
                <label className="parallel-track-value-field automation-length-field">
                  <NumericField
                    min={1}
                    max={MAX_AUTOMATION_LENGTH_CYCLES}
                    step={1}
                    value={automationSet.lengthCycles}
                    onValueCommit={(value) =>
                      updateAutomationLengthCycles(value)
                    }
                    disabled={playbackStructureLocked}
                    aria-label="Track automation cycles"
                    title="Active track automation length in cycles. Existing automation points stretch across this range."
                  />
                  <em>cycles</em>
                </label>
                <button
                  className={`app-toggle${automationOpen ? " is-on" : ""}`}
                  type="button"
                  aria-label="Automation"
                  onClick={() => setAutomationOpen((open) => !open)}
                  aria-pressed={automationOpen}
                  data-automation-pick-control="true"
                  title="Show or hide the active track automation editor"
                >
                  <span className="toggle-dot" aria-hidden="true" />
                  <span>Editor</span>
                </button>
              </div>
            </div>
          </div>
          <span className="atk-group-divider" aria-hidden="true" />
          <div className="atk-group atk-group--role">
            <TrackRoleControl
              role={activeTrackRole}
              options={activeRoleOptions}
              onSelectRole={applyTrackRole}
              disabled={playbackStructureLocked}
              triggeredDetail={
                <TriggerInspector
                  trigger={activeTrackTrigger}
                  isPlaying={playbackStructureLocked}
                  running={activeTrackTriggerRunning}
                  sourceOptions={triggerSourceOptions.map((track) => ({
                    id: track.id,
                    name: track.name,
                  }))}
                  decisionEvents={activeTrackTriggerDecisionEvents}
                  referenceCycleTicks={parallelGlobalCycleBeats * TRANSPORT_PPQN}
                  cycleBeats={parallelGlobalCycleBeats}
                  onSetMode={handleSetActiveTrackTriggerMode}
                  onUpdate={updateActiveTrackTrigger}
                  onApplyPreset={(config) =>
                    void applyActiveTrackTrigger(config, "Trigger preset applied")
                  }
                />
              }
              trackFlowDetail={
                <div className="track-flow-detail">
                  <label
                    className="parallel-track-value-field track-flow-move-field"
                    title="The box's chain picks one member to sound per cycle. Pick a different box, create a new one, or drag a track tab onto a box (▦) in the lane to edit membership; a box's ▦ button edits its transition matrix."
                  >
                    <span>Box</span>
                    <select
                      aria-label="Track Flow box for the active track"
                      data-testid="track-mode-select"
                      value={activeTrackBox?.id ?? ""}
                      disabled={playbackStructureLocked}
                      onChange={(e) =>
                        handleAssignTrackToBox(activeParallelTrackId, e.target.value)
                      }
                    >
                      {trackFlowBoxesList.map((box) => (
                        <option key={box.id} value={box.id}>
                          {box.name}
                        </option>
                      ))}
                      <option value="__new__">New Track Flow box…</option>
                    </select>
                  </label>
                  {trackFlowNowPlaying.length > 0 ? (
                    <div
                      className="track-flow-now-playing"
                      data-testid="track-flow-now-playing"
                      title="Which member each Track Flow box is currently sounding."
                    >
                      {trackFlowNowPlaying.map((selection) => (
                        <span
                          key={selection.boxName}
                          className="track-flow-now-playing-item"
                        >
                          {selection.boxName} → {selection.sourceName}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              }
            />
          </div>
          {/* Priority order moved into the Channel Logic panel (B1.4): it renders
              wherever the priority mode is actually used, default or rule. */}
        </div>
      </section>

      <TimelinePanel
        activeParallelTrack={activeParallelTrack}
        activeParallelTrackCustomName={activeParallelTrackCustomName}
        activeParallelTrackHasCustomName={activeParallelTrackHasCustomName}
        activeParallelTrackLabel={activeParallelTrackLabel}
        activeTimelineTrackId={activeTimelineTrackId}
        automationTargetDefs={automationTargetDefs}
        channelHocketEnabled={channelHocketEnabled}
        cycleBeats={cycleBeats}
        displayedCycle={displayedCycle}
        editBoundaryFromRail={editBoundaryFromRail}
        livePositionRef={livePositionRef}
        normalizedBoundaries={normalizedBoundaries}
        openBoundaryDetail={openBoundaryDetail}
        playbackStructureLocked={playbackStructureLocked}
        playheadAkshara={playheadAkshara}
        removeBoundaryAfterBeat={removeBoundaryAfterBeat}
        renderedActiveTrackSuppressedNoteGroups={renderedActiveTrackSuppressedNoteGroups}
        renderedResolvedSections={renderedResolvedSections}
        renderedTimelineLayerModel={renderedTimelineLayerModel}
        renderedTimelineLayoutCycle={renderedTimelineLayoutCycle}
        renderedTimelinePreview={renderedTimelinePreview}
        rhythmPlaybackEnabled={rhythmPlaybackEnabled}
        setTimelineAutomationPickerOpen={setTimelineAutomationPickerOpen}
        setTimelineAutomationTargetIds={setTimelineAutomationTargetIds}
        setUserPreviewCycle={setUserPreviewCycle}
        snapshot={snapshot}
        synthVoiceLabels={synthVoiceLabels}
        timelineAutomationPickerOpen={timelineAutomationPickerOpen}
        timelineAutomationPickerRef={timelineAutomationPickerRef}
        timelineAutomationTrackOptions={timelineAutomationTrackOptions}
        timelineLayoutCycle={timelineLayoutCycle}
        timelineRenderSyncing={timelineRenderSyncing}
        toggleTimelineAutomationTarget={toggleTimelineAutomationTarget}
        transportIsPlaying={transportIsPlaying}
        userPreviewCycle={userPreviewCycle}
        visibleTimelineAutomationTargetIds={visibleTimelineAutomationTargetIds}
        visibleTimelineAutomationTracks={visibleTimelineAutomationTracks}
      />

      <AutomationEditorModal
        addAutomationMarker={addAutomationMarker}
        addAutomationPointAt={addAutomationPointAt}
        addAutomationTarget={addAutomationTarget}
        automationMarkerPhaseInput={automationMarkerPhaseInput}
        automationOpen={automationOpen}
        automationSet={automationSet}
        automationTargetDefs={automationTargetDefs}
        automationTargetGroupFilter={automationTargetGroupFilter}
        automationTargetGroups={automationTargetGroups}
        automationTargetKindFilter={automationTargetKindFilter}
        automationTargetKinds={automationTargetKinds}
        playbackStructureLocked={playbackStructureLocked}
        removeAutomationMarker={removeAutomationMarker}
        removeAutomationPoint={removeAutomationPoint}
        removeAutomationTrack={removeAutomationTrack}
        resetAutomationGraphRange={resetAutomationGraphRange}
        selectedAutomationAxisRange={selectedAutomationAxisRange}
        selectedAutomationCurve={selectedAutomationCurve}
        selectedAutomationDef={selectedAutomationDef}
        selectedAutomationPointId={selectedAutomationPointId}
        selectedAutomationPoints={selectedAutomationPoints}
        selectedAutomationSegmentCurve={selectedAutomationSegmentCurve}
        selectedAutomationSegmentPoint={selectedAutomationSegmentPoint}
        selectedAutomationSegmentPointId={selectedAutomationSegmentPointId}
        selectedAutomationTrack={selectedAutomationTrack}
        setAutomationMarkerPhaseInput={setAutomationMarkerPhaseInput}
        setAutomationOpen={setAutomationOpen}
        setAutomationTargetGroupFilter={setAutomationTargetGroupFilter}
        setAutomationTargetKindFilter={setAutomationTargetKindFilter}
        setSelectedAutomationCurveId={setSelectedAutomationCurveId}
        setSelectedAutomationPointId={setSelectedAutomationPointId}
        setSelectedAutomationSegmentPointId={setSelectedAutomationSegmentPointId}
        setSelectedAutomationTrackId={setSelectedAutomationTrackId}
        updateAutomationGraphRange={updateAutomationGraphRange}
        updateAutomationMarker={updateAutomationMarker}
        updateAutomationPoint={updateAutomationPoint}
        updateAutomationSegmentCurve={updateAutomationSegmentCurve}
        updateAutomationTrack={updateAutomationTrack}
      />

      <MainEditorLauncher items={mainEditorLauncherItems} onOpen={setMainEditorOpen} />

      {activeMainEditorId && (
        <ModalDismissBackdrop
          className="main-editor-backdrop"
          label={`Close ${activeMainEditorTitle} editor`}
          layer="main"
          onClose={() => setMainEditorOpen(null)}
        />
      )}

      <section
        className="sequencer-panels main-editor-modal-stack"
        aria-label="Cycle controls"
      >
        <SectionBoundariesPanel
          name={name}
          onNameChange={setName}
          onCycleBeatsChange={handleCycleBeatsChange}
          pitch={pitch}
          onPitchChange={setPitch}
          velocity={velocity}
          onVelocityChange={setVelocity}
          renderAutomationControlLabel={renderAutomationControlLabel}
          activeSectionInspectorEntry={activeSectionInspectorEntry}
          addBoundary={addBoundary}
          beatAccentMax={beatAccentMax}
          beatAccentMin={beatAccentMin}
          boundariesOpen={boundariesOpen}
          boundaryStatusStrip={boundaryStatusStrip}
          cycleBeats={cycleBeats}
          initialJathiWeights={initialJathiWeights}
          initialWeights={initialWeights}
          jathiAccentMax={jathiAccentMax}
          jathiAccentMin={jathiAccentMin}
          jathiAccentMode={jathiAccentMode}
          normalizedBoundaries={normalizedBoundaries}
          playbackStructureLocked={playbackStructureLocked}
          renderAutomationFocusButton={renderAutomationFocusButton}
          renderSectionInspector={renderSectionInspector}
          resolvedSections={resolvedSections}
          sectionAccentMax={sectionAccentMax}
          sectionAccentMin={sectionAccentMin}
          sectionInspectorEntries={sectionInspectorEntries}
          setBeatAccentMax={setBeatAccentMax}
          setBeatAccentMin={setBeatAccentMin}
          setBoundariesOpen={setBoundariesOpen}
          setJathiAccentMax={setJathiAccentMax}
          setJathiAccentMin={setJathiAccentMin}
          setJathiAccentMode={setJathiAccentMode}
          setSectionAccentMax={setSectionAccentMax}
          setSectionAccentMin={setSectionAccentMin}
          setSectionInspectorKey={setSectionInspectorKey}
        />
      </section>

      <section
        className="generator-panel-stack main-editor-modal-stack"
        aria-label="Generator controls"
      >
        <GeneratorEditor
          open={generatorOpen}
          enabled={generatorEnabled}
          kind={generatorKind}
          densityPercent={generatorDensityPercent}
          dumkaPattern={dumkaPattern}
          dumkaEvolutionRate={dumkaEvolutionRate}
          dumkaDriftLeash={dumkaDriftLeash}
          dumkaDensityFloor={dumkaDensityFloor}
          dumkaDensityCeiling={dumkaDensityCeiling}
          dumkaPreviewError={
            generatorKind === "dumka"
              ? (currentRhythmPreviewFailure?.message ?? null)
              : null
          }
          dumkaRequired={dumkaRequired}
          dumkaStructureReady={dumkaStructureReady}
          dumkaAuthoredSubdivision={dumkaAuthoredSubdivision}
          dumkaProjectionSpans={dumkaProjectionSpans}
          dumkaPlan={dumkaPlan}
          onOpenEvolve={() => setMainEditorOpen("evolve")}
          seedMode={generatorSeedMode}
          seed={generatorSeed}
          playbackStructureLocked={playbackStructureLocked}
          setOpen={setGeneratorOpen}
          setEnabled={setGeneratorEnabled}
          setKind={setGeneratorKind}
          setDensityPercent={setGeneratorDensityPercent}
          onDumkaPatternCommit={setDumkaPattern}
          onApplyDumkaStructure={handleApplyDumkaStructure}
          setDumkaEvolutionRate={setDumkaEvolutionRate}
          setDumkaDriftLeash={setDumkaDriftLeash}
          setDumkaDensityFloor={setDumkaDensityFloor}
          setDumkaDensityCeiling={setDumkaDensityCeiling}
          dumkaBarlowTemperature={dumkaBarlowTemperature}
          dumkaFillComplexity={dumkaFillComplexity}
          setDumkaFillComplexity={setDumkaFillComplexity}
          dumkaEuclidMaxRun={dumkaEuclidMaxRun}
          setDumkaEuclidMaxRun={setDumkaEuclidMaxRun}
          dumkaEuclidInvert={dumkaEuclidInvert}
          setDumkaEuclidInvert={setDumkaEuclidInvert}
          dumkaEuclidRestPolicy={dumkaEuclidRestPolicy}
          setDumkaEuclidRestPolicy={setDumkaEuclidRestPolicy}
          setDumkaBarlowTemperature={setDumkaBarlowTemperature}
          dumkaOpWeights={dumkaOpWeights}
          setDumkaOpWeights={setDumkaOpWeights}
          setSeedMode={setGeneratorSeedMode}
          setSeed={setGeneratorSeed}
        />
      </section>

      <section
        className="evolve-panel-stack main-editor-modal-stack"
        aria-label="Evolution score controls"
      >
        <EvolvePlanPanel
          open={evolveOpen}
          generatorKind={generatorKind}
          plan={dumkaPlan}
          planLengthCycles={dumkaPlanLengthCycles}
          cycleBeats={cycleBeats}
          playbackStructureLocked={playbackStructureLocked}
          previewCycle={userPreviewCycle}
          cachedPreviews={evolveCachedPreviews}
          trace={evolveTrace}
          inheritedOptions={{
            barlowTemperature: dumkaBarlowTemperature,
            fillComplexity: dumkaFillComplexity,
            densityFloor: dumkaDensityFloor,
            densityCeiling: dumkaDensityCeiling,
            euclidMaxRun: dumkaEuclidMaxRun,
            euclidInvert: dumkaEuclidInvert,
            euclidRestPolicy: dumkaEuclidRestPolicy,
          }}
          onOpenChange={(open) => setMainEditorOpen(open ? "evolve" : null)}
          onPlanChange={setDumkaPlan}
          onPlanLengthCyclesChange={(cycles) =>
            setDumkaPlanLengthCycles(clamp(Math.round(cycles), 0, 0xffff_ffff))
          }
          onPreviewCycleChange={setUserPreviewCycle}
          onVisibleCycleRangeChange={(fromCycle, toCycle) =>
            setEvolveVisibleCycleRange({ fromCycle, toCycle })
          }
          densityFloor={dumkaDensityFloor}
          densityCeiling={dumkaDensityCeiling}
        />
      </section>

      <section
        className="playback-shaper-stack main-editor-modal-stack"
        aria-label="Playback shapers"
      >
        <ChannelShaperPanel
  {...useChannelShaperStateResult}
          channelHocketEventSummary={channelHocketEventSummary}

/>
      </section>
      </section>

      <MidiDebugPanel
        open={midiDebugOpen}
        onOpenChange={setMidiDebugOpen}
        limit={midiDebugLimit}
        onLimitChange={setMidiDebugLimit}
        activeTrackOnly={midiDebugActiveTrackOnly}
        onActiveTrackOnlyChange={setMidiDebugActiveTrackOnly}
        showTrackFilter={hasMultipleParallelTracks}
        statusItems={midiDebugStatusItems}
        visibleEvents={visibleMidiDebugEvents}
        filteredCount={
          midiDebugOpen ? midiDebugFilteredEvents.length : midiDebugEvents.length
        }
      />

      <section
        className="midi-debug-panel parallel-conflict-debug-panel"
        aria-label="Parallel conflict debug"
      >
        <details
          className="panel-state panel-state-parallel-conflicts"
          open={parallelConflictDebugOpen}
          onToggle={(event) =>
            setParallelConflictDebugOpen(event.currentTarget.open)
          }
        >
          <summary>
            <span className="summary-copy">Parallel conflicts</span>
            <em>
              showing {parallelConflictVisibleCount} of{" "}
              {parallelConflictEvents.length} decisions
            </em>
            <PanelStatusChips items={parallelConflictStatusItems} />
          </summary>
          {parallelConflictDebugOpen ? (
            <>
              <div className="midi-debug-toolbar">
                <span>
                  Uses the MIDI debug row limit. Rows include passed and suppressed note
                  groups.
                </span>
              </div>
              {visibleParallelConflictEvents.length ? (
                <div className="midi-debug-table-wrap parallel-conflict-debug-table-wrap">
                  <table className="midi-debug-table parallel-conflict-debug-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>cycle</th>
                        <th>tick</th>
                        <th>ch</th>
                        <th>pitch</th>
                        <th>trackId</th>
                        <th>trackName</th>
                        <th>conflictPolicy</th>
                        <th>conflictAction</th>
                        <th>conflictGroupId</th>
                        <th>peers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleParallelConflictEvents.map((event) => (
                        <tr
                          className={
                            event.passed
                              ? "is-conflict-passed"
                              : "is-conflict-suppressed"
                          }
                          key={event.sequence}
                        >
                          <td>{event.sequence}</td>
                          <td>{event.cycle}</td>
                          <td>{event.tickInCycle}</td>
                          <td>{event.outputChannel}</td>
                          <td>{event.pitch}</td>
                          <td>{event.trackId}</td>
                          <td>{event.trackName || parallelConflictTrackSummary(event)}</td>
                          <td>{event.conflictPolicy}</td>
                          <td>{event.conflictAction}</td>
                          <td>{event.conflictGroupId}</td>
                          <td>{parallelConflictPeerSummary(event)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No parallel channel conflict decisions have been recorded yet.</p>
              )}
            </>
          ) : null}
        </details>
      </section>

      <AutomationDebugPanel
        open={automationDebugOpen}
        onOpenChange={setAutomationDebugOpen}
        limit={automationDebugLimit}
        onLimitChange={setAutomationDebugLimit}
        statusItems={automationDebugStatusItems}
        events={automationDebugEvents}
        targetDefs={automationTargetDefs}
      />

      <section className="footer-readout">
        <LiveTransportReadout
          playing={transportIsPlaying}
          livePositionRef={livePositionRef}
          activeTrackId={activeTimelineTrackId}
          fallbackCycle={displayedCycle}
          fallbackTick={displayedTick}
          fallbackTicksPerCycle={timelineTicksPerCycle}
        />{" "}
        · {midiRouteSummary}
      </section>

      {matrixBox ? (
        <div
          className="tf-matrix-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${matrixBox.name} transition matrix`}
          data-testid="track-flow-matrix-modal"
          onClick={() => setMatrixBoxId(null)}
        >
          <div
            className="tf-matrix-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tf-matrix-head">
              <div className="tf-matrix-title">
                <b>{matrixBox.name} — transition matrix</b>
                <small>
                  {trackFlowLaneId(matrixBox.id)} · how the box walks between its
                  members
                </small>
              </div>
              <span className="tf-matrix-seed">
                <span>Seed</span>
                <NumericField
                  min={0}
                  step={1}
                  numericMode="integer"
                  size="compact"
                  aria-label="Box chain seed"
                  data-testid="track-flow-box-seed"
                  value={matrixBox.seed}
                  disabled={playbackStructureLocked}
                  onValueCommit={(value) => setBoxSeed(matrixBox.id, value)}
                />
              </span>
              <button
                className="tf-matrix-close"
                type="button"
                aria-label="Close transition matrix"
                onClick={() => setMatrixBoxId(null)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {matrixBoxMembers.length >= 2 ? (
              <div
                className="track-flow-chain-editor"
                data-testid="track-flow-chain-editor"
              >
                <div className="channel-workbench-head">
                  <div>
                    <strong>Transition matrix</strong>
                    <span>Rows read the previously played track.</span>
                  </div>
                </div>
                <div className="rhythm-entry-matrix-wrap">
                  <table className="rhythm-entry-matrix">
                    <thead>
                      <tr>
                        <th>Start</th>
                        {matrixBoxMembers.map((member) => (
                          <th key={`start-${member.id}`} title={member.name}>
                            {member.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th>weight</th>
                        {matrixBoxMembers.map((member) => (
                          <td key={`start-cell-${member.id}`}>
                            <NumericField
                              aria-label={`Start weight for ${member.name}`}
                              min={0}
                              max={999}
                              numericMode="weight"
                              step={1}
                              value={
                                matrixBox.chain.entryWeights[
                                  trackFlowEntryKey([member.id])
                                ] ?? 0
                              }
                              disabled={playbackTransitionKind !== "idle"}
                              onValueCommit={(value) =>
                                setBoxEntryWeight(matrixBox.id, member.id, value)
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="rhythm-matrix-wrap track-flow-matrix-wrap">
                  <table className="rhythm-matrix track-flow-matrix">
                    <thead>
                      <tr>
                        <th>from</th>
                        {matrixBoxMembers.map((to) => (
                          <th key={`to-${to.id}`} title={to.name}>
                            {to.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrixBoxMembers.map((from) => {
                        const rowTotal = matrixBoxMembers.reduce(
                          (sum, to) =>
                            sum +
                            (matrixBox.chain.weights[
                              trackFlowTransitionKey([from.id], to.id)
                            ] ?? 0),
                          0
                        );
                        return (
                          <tr key={`from-${from.id}`}>
                            <th title={from.name}>{from.name}</th>
                            {matrixBoxMembers.map((to) => {
                              const weight =
                                matrixBox.chain.weights[
                                  trackFlowTransitionKey([from.id], to.id)
                                ] ?? 0;
                              const share = rowTotal > 0 ? weight / rowTotal : 0;
                              return (
                                <td
                                  className="rhythm-heat-cell"
                                  data-hot={share > 0}
                                  key={`cell-${from.id}-${to.id}`}
                                  style={
                                    {
                                      background: transitionHeatBackground(share),
                                      boxShadow: transitionHeatShadow(share),
                                    } as CSSProperties
                                  }
                                  title={`${formatPct(share)} row share`}
                                >
                                  <span className="matrix-weight-field">
                                    <NumericField
                                      aria-label={`Transition weight from ${from.name} to ${to.name}`}
                                      min={0}
                                      max={999}
                                      numericMode="weight"
                                      step={1}
                                      value={weight}
                                      disabled={playbackTransitionKind !== "idle"}
                                      onValueCommit={(value) =>
                                        setBoxTransitionWeight(
                                          matrixBox.id,
                                          from.id,
                                          to.id,
                                          value
                                        )
                                      }
                                    />
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <span className="track-flow-chain-hint">
                  Leave all weights at 0 for a uniform random walk over the box's
                  members.
                </span>
              </div>
            ) : (
              <p className="tf-matrix-empty">
                Add at least two tracks to this box to author a transition matrix.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
