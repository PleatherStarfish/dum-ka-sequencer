/**
 * App-state cluster for ChannelShaperPanel, extracted as a hook (carve-up hooks sweep).
 * Owns the panel's state, derived values, and callbacks; returns the panel's
 * props (spread into <ChannelShaperPanel> at the call site). Cross-domain inputs arrive
 * as params, typed via scripts/carve/typegen.cjs.
 */
import {
  buildAutomationTargetDefs,
  parallelTrackTempoBadge,
} from "../automationTargets";
import {
  CustomSubdivision,
  JathiBhedamSelection,
  JathiWeight,
  SubdivisionWeight,
  SwitchCountWeight,
  SynthChannelProgram,
  TransportSnapshot,
} from "../bridge";
import {
  channelHocketInspectableMidiChannels,
  channelHocketPossibleMidiChannels,
  trackInspectableMidiChannels,
  trackOutputMidiChannels,
} from "../channelLogic";
import {
  channelContexts,
  channelWeightKey,
} from "../markovWeights";
import { canonicalEuclidLayersForChannels } from "../euclidChannels";
import {
  BoundaryPoint,
  DEFAULT_PARALLEL_TRACK_COLOR,
  DEFAULT_PARALLEL_TRACK_ID,
  MIDI_CHANNELS,
  ParallelProjectPatch,
  PatchChannelAccentRule,
  PatchChannelPositionRule,
  SeedDialogTab,
  SeedLogScope,
  SeedModeName,
  TrackCycleLengthMode,
  TrackTempoMode,
  channelEntryWeightKey,
  clamp,
  cloneChannelPositionRules,
  normalizeChannelAccentRules,
  normalizeChannelPositionRules,
  normalizeSeedMode,
  numberValue,
} from "../patchIo";
import {
  channelAccentRulesToRequest,
} from "../playbackRequests";
import { ChannelHocketTabId, MainEditorId } from "./MainEditorChrome";
import {
  parseSeeds,
  seedBehaviorShortLabel,
  seedBehaviorSummary,
  seedStrategySummary,
  seedToneForBehavior,
} from "./SeedControls";
import {
  PanelStatusEntry,
} from "./WeightEditors";
import {
  ReactNode,
} from "react";
import { useEffect, useMemo } from "react";
import { useChannelShaperKeptState } from "./useChannelShaperKeptState";

export interface UseChannelShaperStateParams {
  boundaries: BoundaryPoint[];
  cycleBeats: number;
  generatorDensityPercent: number;
  dumkaEvolutionRate: number;
  dumkaBarlowTemperature: number;
  dumkaFillComplexity: number;
  dumkaDriftLeash: number;
  dumkaDensityFloor: number;
  dumkaDensityCeiling: number;
  dumkaComplexityFloor: number;
  dumkaComplexityCeiling: number;
  dumkaPlacementBias: number;
  historySeedsInput: string;
  historyWeight: number;
  initialJathiWeights: JathiWeight[];
  initialWeights: SubdivisionWeight[];
  blendCycles: number;
  holdChance: number;
  maxHistory: number;
  newSeedChance: number;
  newSeedWeight: number;
  parallelProject: ParallelProjectPatch | null;
  pitch: number;
  sectionCountWeights: SwitchCountWeight[];
  seed: number;
  seedMode: SeedModeName;
  setBoundaries: React.Dispatch<React.SetStateAction<BoundaryPoint[]>>;
  setBoundariesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGeneratorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setInitialCustomSubdivision: React.Dispatch<React.SetStateAction<CustomSubdivision | null>>;
  setInitialJathiBhedam: React.Dispatch<React.SetStateAction<JathiBhedamSelection | null>>;
  setInitialJathiWeights: React.Dispatch<React.SetStateAction<JathiWeight[]>>;
  setInitialWeights: React.Dispatch<React.SetStateAction<SubdivisionWeight[]>>;
  setPatchStatus: React.Dispatch<React.SetStateAction<string | null>>;
  setProbabilityOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSectionCountWeights: React.Dispatch<React.SetStateAction<SwitchCountWeight[]>>;
  setSeedLogScope: React.Dispatch<React.SetStateAction<SeedLogScope>>;
  setSeedSetupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSeedSetupTab: React.Dispatch<React.SetStateAction<SeedDialogTab>>;
  singleParameterRhythmicModulation: boolean;
  snapshot: TransportSnapshot | null;
  synthEnabled: boolean;
  synthPrograms: SynthChannelProgram[];
  tempoInput: string;
  transportTransitionActive: boolean;
}

export function useChannelShaperState({
  cycleBeats,
  generatorDensityPercent,
  dumkaEvolutionRate,
  dumkaBarlowTemperature,
  dumkaFillComplexity,
  dumkaDriftLeash,
  dumkaDensityFloor,
  dumkaDensityCeiling,
  dumkaComplexityFloor,
  dumkaComplexityCeiling,
  dumkaPlacementBias,
  historySeedsInput,
  historyWeight,
  blendCycles,
  holdChance,
  maxHistory,
  newSeedChance,
  newSeedWeight,
  parallelProject,
  pitch,
  seed,
  seedMode,
  setBoundariesOpen,
  setGeneratorOpen,
  setPatchStatus,
  setProbabilityOpen,
  setSeedLogScope,
  setSeedSetupOpen,
  setSeedSetupTab,
  snapshot,
  tempoInput,
  transportTransitionActive,
}: UseChannelShaperStateParams) {
  const {
    velocity, setVelocity,
    beatAccentMin, setBeatAccentMin,
    beatAccentMax, setBeatAccentMax,
    sectionAccentMin, setSectionAccentMin,
    sectionAccentMax, setSectionAccentMax,
    jathiAccentMin, setJathiAccentMin,
    jathiAccentMax, setJathiAccentMax,
    jathiAccentMode, setJathiAccentMode,
    automationPickMode, setAutomationPickMode,
    automationFocusPanel, setAutomationFocusPanel,
    automationSet, setAutomationSet,
    channelHocketOpen, setChannelHocketOpen,
    channelHocketTab, setChannelHocketTab,
    channelHocketEnabled, setChannelHocketEnabled,
    midiOutputChannel, setMidiOutputChannel,
    channelHocketOrder, setChannelHocketOrder,
    channelHocketAssignMode, setChannelHocketAssignMode,
    channelHocketEuclid, setChannelHocketEuclid,
    channelHocketChannels, setChannelHocketChannels,
    channelHocketFallback, setChannelHocketFallback,
    channelHocketWeights, setChannelHocketWeights,
    channelHocketFallbackWeights, setChannelHocketFallbackWeights,
    channelHocketEntryWeights, setChannelHocketEntryWeights,
    channelHocketSeed, setChannelHocketSeed,
    channelHocketSeedBehavior, setChannelHocketSeedBehavior,
    channelHocketHistorySeedsInput, setChannelHocketHistorySeedsInput,
    channelHocketHistoryWeight, setChannelHocketHistoryWeight,
    channelHocketNewSeedWeight, setChannelHocketNewSeedWeight,
    channelHocketMaxHistory, setChannelHocketMaxHistory,
    channelHocketNewSeedChance, setChannelHocketNewSeedChance,
    channelHocketHoldChance, setChannelHocketHoldChance,
    channelHocketBlendCycles, setChannelHocketBlendCycles,
    channelAccentRules, setChannelAccentRules,
    channelPositionRules, setChannelPositionRules,
  } = useChannelShaperKeptState();
  useEffect(() => {
    setChannelHocketEuclid((previous) => {
      const layers = canonicalEuclidLayersForChannels(
        previous.layers,
        channelHocketChannels
      );
      const spanAccentChannel =
        previous.spanAccentChannel !== null &&
        channelHocketChannels.includes(previous.spanAccentChannel)
          ? previous.spanAccentChannel
          : null;
      const layersUnchanged =
        layers.length === previous.layers.length &&
        layers.every((layer, index) => layer === previous.layers[index]);
      if (layersUnchanged && spanAccentChannel === previous.spanAccentChannel) {
        return previous;
      }
      return { ...previous, layers, spanAccentChannel };
    });
  }, [
    channelHocketChannels,
    channelHocketEuclid.layers,
    channelHocketEuclid.spanAccentChannel,
    setChannelHocketEuclid,
  ]);
  const transportIsPlaying = snapshot?.isPlaying ?? false;
  const playbackStructureLocked =
    transportIsPlaying || transportTransitionActive;
  const tempoBpmForAutomation = clamp(
    numberValue(parseFloat(tempoInput), snapshot?.tempoBpm ?? 80),
    20,
    400
  );
  const automationTargetDefs = useMemo(
    () =>
      buildAutomationTargetDefs({
        tempoBpm: tempoBpmForAutomation,
        generatorDensityPercent,
        dumkaEvolutionRate,
        dumkaBarlowTemperature,
        dumkaFillComplexity,
        dumkaDriftLeash,
        dumkaDensityFloor,
        dumkaDensityCeiling,
        dumkaComplexityFloor,
        dumkaComplexityCeiling,
        dumkaPlacementBias,
        midiOutputChannel,
        scorePitch: pitch,
        scoreVelocity: velocity,
        beatAccentMin,
        beatAccentMax,
        sectionAccentMin,
        sectionAccentMax,
        jathiAccentMin,
        jathiAccentMax,
        channelHocketEnabled,
        channelHocketOrder,
        channelHocketChannels,
        channelHocketFallback,
        channelHocketWeights,
        channelHocketFallbackWeights,
        channelHocketEntryWeights,
        channelHocketHistoryWeight,
        channelHocketNewSeedWeight,
        channelHocketMaxHistory,
        channelAccentRules,
        channelPositionRules,
        channelHocketEuclid,
      }),
    [
      beatAccentMax,
      beatAccentMin,
      generatorDensityPercent,
      dumkaEvolutionRate,
      dumkaBarlowTemperature,
      dumkaFillComplexity,
      dumkaDriftLeash,
      dumkaDensityFloor,
      dumkaDensityCeiling,
      dumkaComplexityFloor,
      dumkaComplexityCeiling,
      dumkaPlacementBias,
      channelAccentRules,
      channelPositionRules,
      channelHocketChannels,
      channelHocketEnabled,
      channelHocketEntryWeights,
      channelHocketEuclid,
      channelHocketFallback,
      channelHocketFallbackWeights,
      channelHocketHistoryWeight,
      channelHocketMaxHistory,
      channelHocketNewSeedWeight,
      channelHocketOrder,
      channelHocketWeights,
      jathiAccentMax,
      jathiAccentMin,
      midiOutputChannel,
      pitch,
      sectionAccentMax,
      sectionAccentMin,
      tempoBpmForAutomation,
      velocity,
    ]
  );
  const automatedTargetIds = useMemo(
    () => new Set(automationSet.tracks.map((track) => track.target)),
    [automationSet.tracks]
  );
  const knownAutomationTargetIds = useMemo(
    () => new Set(automationTargetDefs.map((def) => def.target)),
    [automationTargetDefs]
  );
  const normalizeAutomationFocusTargets = (targetIds: Array<string | null | undefined>) =>
    Array.from(new Set(targetIds.filter((target): target is string => Boolean(target))))
      .filter((target) => knownAutomationTargetIds.has(target))
      .sort();

  const openAutomationFocusPanel = (
    title: string,
    targetIds: Array<string | null | undefined>
  ) => {
    if (playbackStructureLocked) {
      setPatchStatus("Stop playback before editing automation");
      return;
    }
    const normalizedTargets = normalizeAutomationFocusTargets(targetIds);
    if (!normalizedTargets.length) {
      setPatchStatus("No automation lanes are attached to that section");
      return;
    }
    setAutomationPickMode(false);
    setAutomationFocusPanel({ title, targetIds: normalizedTargets });
  };

  const renderAutomationFocusButton = (
    title: string,
    targetIds: Array<string | null | undefined>
  ) => {
    const normalizedTargets = normalizeAutomationFocusTargets(targetIds);
    if (!normalizedTargets.length) return null;
    const activeCount = normalizedTargets.filter((target) =>
      automatedTargetIds.has(target)
    ).length;
    return (
      <button
        className={`automation-inline-button${activeCount ? " is-active" : ""}`}
        type="button"
        disabled={playbackStructureLocked}
        data-automation-pick-control="true"
        aria-label={`Show automation lanes for ${title}`}
        title={
          playbackStructureLocked
            ? "Stop playback before editing automation"
            : `Automation lanes for ${title}`
        }
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openAutomationFocusPanel(title, normalizedTargets);
        }}
      >
        <span aria-hidden="true">∿</span>
        {activeCount > 0 && <b>{activeCount}</b>}
      </button>
    );
  };

  const renderAutomationControlLabel = (
    label: ReactNode,
    title: string,
    targetIds: Array<string | null | undefined>
  ) => (
    <span className="label-with-automation">
      <span>{label}</span>
      {renderAutomationFocusButton(title, targetIds)}
    </span>
  );

  const channelHocketHistorySeeds = useMemo(
    () => parseSeeds(channelHocketHistorySeedsInput),
    [channelHocketHistorySeedsInput]
  );
  const globalHistorySeeds = useMemo(
    () => parseSeeds(historySeedsInput),
    [historySeedsInput]
  );
  const globalSeedMode = normalizeSeedMode(seedMode);
  const channelHocketSeedTone = seedToneForBehavior(channelHocketSeedBehavior);
  const globalSeedSummary = seedStrategySummary(
    globalSeedMode,
    seed,
    globalHistorySeeds,
    historyWeight,
    newSeedWeight,
    maxHistory,
    newSeedChance,
    holdChance,
    blendCycles
  );
  const channelHocketSeedSummary = seedBehaviorSummary(
    channelHocketSeedBehavior,
    channelHocketSeed,
    channelHocketHistorySeeds,
    channelHocketHistoryWeight,
    channelHocketNewSeedWeight,
    channelHocketMaxHistory,
    channelHocketNewSeedChance,
    channelHocketHoldChance,
    channelHocketBlendCycles,
    globalSeedSummary
  );
  const channelHocketSeedHeaderLabel = seedBehaviorShortLabel(
    channelHocketSeedBehavior
  );
  const currentTempoBpm = clamp(
    numberValue(parseFloat(tempoInput), snapshot?.tempoBpm ?? 80),
    20,
    400
  );
  const activeEditorMidiChannels = useMemo(
    () =>
      channelHocketPossibleMidiChannels({
        enabled: channelHocketEnabled,
        outputChannel: midiOutputChannel,
        order: channelHocketOrder,
        channels: channelHocketChannels,
        weights: channelHocketWeights,
        fallback: channelHocketFallback,
        fallbackWeights: channelHocketFallbackWeights,
        entryWeights: channelHocketEntryWeights,
        accentRules: channelAccentRules,
        positionRules: channelPositionRules,
        assignMode: channelHocketAssignMode,
        euclid: channelHocketEuclid,
      }),
    [
      channelAccentRules,
      channelHocketAssignMode,
      channelHocketChannels,
      channelHocketEnabled,
      channelHocketEntryWeights,
      channelHocketEuclid,
      channelHocketFallback,
      channelHocketFallbackWeights,
      channelHocketOrder,
      channelHocketWeights,
      channelPositionRules,
      midiOutputChannel,
    ]
  );
  const activeEditorInspectableMidiChannels = useMemo(
    () =>
      channelHocketInspectableMidiChannels({
        enabled: channelHocketEnabled,
        outputChannel: midiOutputChannel,
        order: channelHocketOrder,
        channels: channelHocketChannels,
        weights: channelHocketWeights,
        fallback: channelHocketFallback,
        fallbackWeights: channelHocketFallbackWeights,
        entryWeights: channelHocketEntryWeights,
        accentRules: channelAccentRules,
        positionRules: channelPositionRules,
        assignMode: channelHocketAssignMode,
        euclid: channelHocketEuclid,
      }),
    [
      channelAccentRules,
      channelHocketAssignMode,
      channelHocketChannels,
      channelHocketEnabled,
      channelHocketEntryWeights,
      channelHocketEuclid,
      channelHocketFallback,
      channelHocketFallbackWeights,
      channelHocketOrder,
      channelHocketWeights,
      channelPositionRules,
      midiOutputChannel,
    ]
  );
  const parallelTrackTabs = useMemo(
    () =>
      parallelProject?.tracks.length
        ? parallelProject.tracks.map((track) => ({
            id: track.id,
            name: track.name,
            color: track.color,
            muted: track.muted,
            soloed: track.soloed,
            tempoMode: track.tempoMode,
            customTempoBpm: track.customTempoBpm,
            tempoBadge: parallelTrackTempoBadge(track, parallelProject.global.tempoBpm),
            cycleLengthMode: track.cycleLengthMode,
            customCycleBeats: track.customCycleBeats,
            midiChannels:
              track.id === parallelProject.activeTrackId
                ? activeEditorMidiChannels
                : trackOutputMidiChannels(track),
            inspectableMidiChannels:
              track.id === parallelProject.activeTrackId
                ? activeEditorInspectableMidiChannels
                : trackInspectableMidiChannels(track),
            channelHocketEnabled:
              track.id === parallelProject.activeTrackId
                ? channelHocketEnabled
                : track.channelHocket.enabled,
            triggered: track.trigger != null,
          }))
        : [
            {
              id: DEFAULT_PARALLEL_TRACK_ID,
              name: "Track 1",
              color: DEFAULT_PARALLEL_TRACK_COLOR,
              muted: false,
              soloed: false,
              tempoMode: "global" as TrackTempoMode,
              customTempoBpm: currentTempoBpm,
              tempoBadge: null,
              cycleLengthMode: "global" as TrackCycleLengthMode,
              customCycleBeats: cycleBeats,
              midiChannels: [midiOutputChannel],
              inspectableMidiChannels: [midiOutputChannel],
              channelHocketEnabled: channelHocketEnabled,
              triggered: false,
            },
          ],
    [
      activeEditorMidiChannels,
      activeEditorInspectableMidiChannels,
      channelHocketEnabled,
      cycleBeats,
      currentTempoBpm,
      midiOutputChannel,
      parallelProject,
    ]
  );
  const activeParallelTrackId =
    parallelProject?.activeTrackId ?? DEFAULT_PARALLEL_TRACK_ID;
  const otherTrackChannelUsage = useMemo(
    () =>
      MIDI_CHANNELS.map((channel) => {
        const tracks = parallelTrackTabs.flatMap((track, index) => {
          if (track.id === activeParallelTrackId) return [];
          if (!track.midiChannels.includes(channel)) return [];
          const fallbackLabel = `T${index + 1}`;
          const trackName = track.name.trim();
          return [
            {
              id: track.id,
              label: fallbackLabel,
              name: trackName || `Track ${index + 1}`,
              color: track.color,
              muted: track.muted,
              soloed: track.soloed,
              hocket: track.channelHocketEnabled,
            },
          ];
        });
        return { channel, tracks };
      }),
    [activeParallelTrackId, parallelTrackTabs]
  );
  const otherTrackChannelUsageSummary = otherTrackChannelUsage
    .filter((entry) => entry.tracks.length > 0)
    .map(
      (entry) =>
        `Ch ${entry.channel} ${entry.tracks
          .slice(0, 2)
          .map((track) => track.label)
          .join("/")}${entry.tracks.length > 2 ? "+" : ""}`
    );
  const channelHocketMatrixChannels = channelHocketChannels.filter((channel) =>
    MIDI_CHANNELS.includes(channel)
  );
  const channelHocketContexts = channelContexts(
    channelHocketMatrixChannels,
    channelHocketOrder
  );
  const channelHocketVisibleContexts =
    channelHocketOrder === "second"
      ? channelHocketContexts.slice(0, 64)
      : channelHocketContexts;
  const channelFallbackWeight = (channel: number): number =>
    Math.round(channelHocketFallbackWeights[String(channel)] ?? 0);
  const channelEntryWeight = (entry: number[]): number =>
    Math.round(
      channelHocketEntryWeights[
        channelEntryWeightKey(channelHocketOrder, entry)
      ] ?? 0
    );
  const activeChannelAccentRuleCount = channelAccentRulesToRequest(
    channelAccentRules,
    channelHocketMatrixChannels
  ).length;
  const activeChannelPositionRuleCount = channelPositionRules.filter(
    (rule) => rule.enabled
  ).length;
  const channelHocketTransitionSummary =
    channelHocketMatrixChannels.length > 0
      ? `${channelHocketOrder} order · ${channelHocketVisibleContexts.length} contexts`
      : "choose channels";
  const channelHocketEntrySummary =
    channelHocketVisibleContexts.length > 0
      ? `${channelHocketVisibleContexts.length} entries · fallback Ch ${channelHocketFallback}`
      : `fallback Ch ${channelHocketFallback}`;
  const euclidVoiceCount = channelHocketEuclid.layers.filter(
    (layer) => layer.pulses > 0
  ).length;
  const euclidPatternSummary =
    channelHocketEuclid.placement === "partition"
      ? `E(${channelHocketEuclid.layers.reduce(
          (total, layer) => total + layer.pulses,
          0
        )},${channelHocketEuclid.steps}) · ${euclidVoiceCount} ${
          euclidVoiceCount === 1 ? "voice" : "voices"
        }`
      : `stack · ${euclidVoiceCount} ${
          euclidVoiceCount === 1 ? "voice" : "voices"
        }`;
  const channelHocketTabs: Array<{
    id: ChannelHocketTabId;
    label: string;
    summary: string;
  }> = [
    // Strategy-specific tabs first: the matrix + entry pair belongs to the
    // Markov chain; the pattern tab is the Euclid strategy's whole surface.
    ...(channelHocketAssignMode === "markov"
      ? ([
          {
            id: "matrix",
            label: "Matrix",
            summary: channelHocketTransitionSummary,
          },
          {
            id: "entry",
            label: "Entry & Fallback",
            summary: channelHocketEntrySummary,
          },
        ] as Array<{ id: ChannelHocketTabId; label: string; summary: string }>)
      : [
          {
            id: "pattern" as ChannelHocketTabId,
            label: "Pattern",
            summary: euclidPatternSummary,
          },
        ]),
    {
      id: "accents",
      label: "Accents",
      summary: activeChannelAccentRuleCount
        ? `${activeChannelAccentRuleCount} active`
        : "routing off",
    },
    {
      id: "positions",
      label: "Positions",
      summary: activeChannelPositionRuleCount
        ? `${activeChannelPositionRuleCount} active`
        : "position rules off",
    },
  ];
  const activeChannelHocketTab =
    channelHocketTabs.find((tab) => tab.id === channelHocketTab) ??
    channelHocketTabs[0]!;
  const channelStatusItems: PanelStatusEntry[] = [
    channelHocketEnabled && { label: "hocket on", tone: "on" },
    activeChannelAccentRuleCount > 0 && {
      label: `accent ${activeChannelAccentRuleCount}`,
      tone: "on",
    },
    activeChannelPositionRuleCount > 0 && {
      label: `position ${activeChannelPositionRuleCount}`,
      tone: "on",
    },
  ];
  const setMainEditorOpen = (id: MainEditorId | null) => {
    setProbabilityOpen(false);
    setBoundariesOpen(id === "boundaries");
    setGeneratorOpen(id === "generator");
    setChannelHocketOpen(id === "channel");
  };

  const updateChannelHocketWeight = (from: number[], to: number, value: number) => {
    const key = channelWeightKey(channelHocketOrder, from, to);
    setChannelHocketWeights((current) => ({
      ...current,
      [key]: clamp(Math.round(value || 0), 0, 999),
    }));
  };

  const updateChannelHocketFallbackWeight = (channel: number, value: number) => {
    setChannelHocketFallbackWeights((current) => ({
      ...current,
      [String(channel)]: clamp(Math.round(value || 0), 0, 999),
    }));
  };

  const updateChannelHocketEntryWeight = (entry: number[], value: number) => {
    const key = channelEntryWeightKey(channelHocketOrder, entry);
    setChannelHocketEntryWeights((current) => ({
      ...current,
      [key]: clamp(Math.round(value || 0), 0, 999),
    }));
  };

  const updateChannelAccentRule = (
    index: number,
    patch: Partial<PatchChannelAccentRule>
  ) => {
    setChannelAccentRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index
          ? normalizeChannelAccentRules([{ ...rule, ...patch }])[0] ?? rule
          : rule
      )
    );
  };

  const updateChannelAccentWeight = (
    ruleIndex: number,
    channel: number,
    value: number
  ) => {
    setChannelAccentRules((current) =>
      current.map((rule, index) =>
        index === ruleIndex
          ? {
              ...rule,
              weights: {
                ...rule.weights,
                [String(channel)]: clamp(Math.round(value || 0), 0, 999),
              },
            }
          : rule
      )
    );
  };

  const addChannelPositionRule = () => {
    const nextIndex = channelPositionRules.length + 1;
    const fallbackChannel = channelHocketMatrixChannels[0] ?? midiOutputChannel;
    const renderChannel =
      channelHocketMatrixChannels.find((channel) => channel !== fallbackChannel) ??
      fallbackChannel;
    setChannelPositionRules((current) =>
      normalizeChannelPositionRules([
        ...cloneChannelPositionRules(current),
        {
          id: `channel-position-${Date.now().toString(36)}-${nextIndex}`,
          label: `Position ${nextIndex}`,
          enabled: true,
          scope: "beat",
          nth: 1,
          actionWeights: {
            normalMarkov: 0,
            renderOnly: 1,
            resetMarkov: 0,
          },
          renderWeights: { [String(renderChannel)]: 1 },
          resetMode: "staticFallback",
          resetWeights: {},
        },
      ])
    );
  };

  const updateChannelPositionRule = (
    index: number,
    patch: Partial<PatchChannelPositionRule>
  ) => {
    setChannelPositionRules((current) =>
      normalizeChannelPositionRules(
        current.map((rule, ruleIndex) =>
          ruleIndex === index
            ? {
                ...rule,
                ...patch,
                actionWeights: {
                  ...rule.actionWeights,
                  ...(patch.actionWeights ?? {}),
                },
                renderWeights: patch.renderWeights ?? rule.renderWeights,
                resetWeights: patch.resetWeights ?? rule.resetWeights,
              }
            : rule
        )
      )
    );
  };

  const removeChannelPositionRule = (index: number) => {
    setChannelPositionRules((current) =>
      current.filter((_, ruleIndex) => ruleIndex !== index)
    );
  };

  const updateChannelPositionActionWeight = (
    ruleIndex: number,
    key: keyof PatchChannelPositionRule["actionWeights"],
    value: number
  ) => {
    setChannelPositionRules((current) =>
      current.map((rule, index) =>
        index === ruleIndex
          ? {
              ...rule,
              actionWeights: {
                ...rule.actionWeights,
                [key]: clamp(Math.round(value || 0), 0, 999),
              },
            }
          : rule
      )
    );
  };

  const updateChannelPositionRenderWeight = (
    ruleIndex: number,
    channel: number,
    value: number
  ) => {
    setChannelPositionRules((current) =>
      current.map((rule, index) =>
        index === ruleIndex
          ? {
              ...rule,
              renderWeights: {
                ...rule.renderWeights,
                [String(channel)]: clamp(Math.round(value || 0), 0, 999),
              },
            }
          : rule
      )
    );
  };

  const updateChannelPositionResetWeight = (
    ruleIndex: number,
    channel: number,
    value: number
  ) => {
    setChannelPositionRules((current) =>
      current.map((rule, index) =>
        index === ruleIndex
          ? {
              ...rule,
              resetWeights: {
                ...rule.resetWeights,
                [String(channel)]: clamp(Math.round(value || 0), 0, 999),
              },
            }
          : rule
      )
    );
  };

  const resetChannelAccentRulesToVelocityBands = () => {
    const beatMin = clamp(velocity + Math.min(beatAccentMin, beatAccentMax), 1, 127);
    const beatMax = clamp(velocity + Math.max(beatAccentMin, beatAccentMax), 1, 127);
    const strongMin = clamp(
      velocity +
        Math.min(beatAccentMin, beatAccentMax) +
        Math.min(sectionAccentMin, sectionAccentMax),
      1,
      127
    );
    const strongMax = clamp(
      velocity +
        Math.max(beatAccentMin, beatAccentMax) +
        Math.max(sectionAccentMin, sectionAccentMax, jathiAccentMax),
      1,
      127
    );
    setChannelAccentRules([
      {
        label: "Beat accents",
        enabled: true,
        minVelocity: Math.min(beatMin, beatMax),
        maxVelocity: Math.max(beatMin, beatMax),
        probabilityPercent: 75,
        mode: "renderOnly",
        weights: { "2": 1, "3": 1 },
      },
      {
        label: "Strong accents",
        enabled: true,
        minVelocity: Math.min(strongMin, strongMax),
        maxVelocity: Math.max(strongMin, strongMax),
        probabilityPercent: 100,
        mode: "driveChain",
        weights: { "4": 1 },
      },
    ]);
  };

  const openEditorPanel = (panelId: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(panelId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const openScoreSetupForVelocity = () => {
    // The Cycle editor merged into Sections and Subdivisions; the base
    // velocity control lives in its cycle core bar.
    setMainEditorOpen("boundaries");
    openEditorPanel("section-boundaries-panel");
  };

  const openProbabilityForAccentRanges = () => {
    setMainEditorOpen("boundaries");
    openEditorPanel("section-boundaries-panel");
  };

  const toggleChannelHocketChannel = (channel: number) => {
    setChannelHocketChannels((current) => {
      const next = current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel].sort((a, b) => a - b);
      if (next.length === 0) {
        return current;
      }
      if (!next.includes(channelHocketFallback)) {
        setChannelHocketFallback(next[0] ?? 1);
      }
      return next;
    });
  };

  const setChannelHocketAxisCount = (count: number) => {
    const nextCount = clamp(Math.round(count || 1), 1, MIDI_CHANNELS.length);
    const nextChannels = MIDI_CHANNELS.slice(0, nextCount);
    setChannelHocketChannels(nextChannels);
    if (!nextChannels.includes(channelHocketFallback)) {
      setChannelHocketFallback(nextChannels[0] ?? 1);
    }
  };

  const openSeedSetup = (tab: SeedDialogTab = "global", scope: SeedLogScope = "all") => {
    if (tab === "log") {
      setSeedLogScope(scope);
    }
    setSeedSetupTab(tab);
    setSeedSetupOpen(true);
  };

  return {
    activeChannelAccentRuleCount,
    activeChannelHocketTab,
    activeChannelPositionRuleCount,
    activeParallelTrackId,
    automatedTargetIds,
    automationFocusPanel,
    automationPickMode,
    automationSet,
    automationTargetDefs,
    beatAccentMax,
    beatAccentMin,
    channelAccentRules,
    channelEntryWeight,
    channelFallbackWeight,
    channelHocketAssignMode,
    channelHocketBlendCycles,
    channelHocketChannels,
    channelHocketEnabled,
    channelHocketEntryWeights,
    channelHocketEuclid,
    channelHocketFallback,
    channelHocketFallbackWeights,
    channelHocketHistorySeeds,
    channelHocketHistorySeedsInput,
    channelHocketHistoryWeight,
    channelHocketHoldChance,
    channelHocketMatrixChannels,
    channelHocketMaxHistory,
    channelHocketNewSeedChance,
    channelHocketNewSeedWeight,
    channelHocketOpen,
    channelHocketOrder,
    channelHocketSeed,
    channelHocketSeedBehavior,
    channelHocketSeedHeaderLabel,
    channelHocketSeedSummary,
    channelHocketSeedTone,
    channelHocketTab,
    channelHocketTabs,
    channelHocketTransitionSummary,
    channelHocketVisibleContexts,
    channelHocketWeights,
    channelPositionRules,
    channelStatusItems,
    currentTempoBpm,
    globalHistorySeeds,
    globalSeedMode,
    globalSeedSummary,
    jathiAccentMax,
    jathiAccentMin,
    jathiAccentMode,
    midiOutputChannel,
    otherTrackChannelUsage,
    otherTrackChannelUsageSummary,
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
    setChannelHocketAssignMode,
    setChannelHocketAxisCount,
    setChannelHocketChannels,
    setChannelHocketEnabled,
    setChannelHocketEntryWeights,
    setChannelHocketEuclid,
    setChannelHocketFallback,
    setChannelHocketFallbackWeights,
    setChannelHocketHistorySeedsInput,
    setChannelHocketHistoryWeight,
    setChannelHocketBlendCycles,
    setChannelHocketHoldChance,
    setChannelHocketMaxHistory,
    setChannelHocketNewSeedChance,
    setChannelHocketNewSeedWeight,
    setChannelHocketOpen,
    setChannelHocketOrder,
    setChannelHocketSeed,
    setChannelHocketSeedBehavior,
    setChannelHocketTab,
    setChannelHocketWeights,
    setChannelPositionRules,
    setJathiAccentMax,
    setJathiAccentMin,
    setJathiAccentMode,
    setMainEditorOpen,
    setMidiOutputChannel,
    setSectionAccentMax,
    setSectionAccentMin,
    setVelocity,
    tempoBpmForAutomation,
    toggleChannelHocketChannel,
    transportIsPlaying,
    updateChannelAccentRule,
    updateChannelAccentWeight,
    updateChannelHocketEntryWeight,
    updateChannelHocketFallbackWeight,
    updateChannelHocketWeight,
    updateChannelPositionActionWeight,
    updateChannelPositionRenderWeight,
    updateChannelPositionResetWeight,
    updateChannelPositionRule,
    velocity,
    addChannelPositionRule,
    openProbabilityForAccentRanges,
    openScoreSetupForVelocity,
    openSeedSetup,
    removeChannelPositionRule,
    resetChannelAccentRulesToVelocityBands,
  };
}
