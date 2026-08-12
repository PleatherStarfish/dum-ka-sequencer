import { useState } from "react";

import { AutomationFocusPanel } from "../automationTargets";
import {
  AutomationSet,
  ChannelAssignMode,
  MarkovOrder,
} from "../bridge";
import {
  DEFAULT_AUTOMATION_SET,
  DEFAULT_BLEND_CYCLES,
  DEFAULT_HOLD_CHANCE,
  DEFAULT_NEW_SEED_CHANCE,
  NEUTRAL_VELOCITY,
  PatchChannelAccentRule,
  PatchChannelPositionRule,
  RhythmSeedBehaviorName,
  cloneAutomationSet,
  defaultEuclidChannelState,
  type PatchEuclidChannelState,
} from "../patchIo";
import { ChannelHocketTabId } from "./MainEditorChrome";

export function useChannelShaperKeptState() {
  const [velocity, setVelocity] = useState(NEUTRAL_VELOCITY);
  const [beatAccentMin, setBeatAccentMin] = useState(0);
  const [beatAccentMax, setBeatAccentMax] = useState(0);
  const [sectionAccentMin, setSectionAccentMin] = useState(0);
  const [sectionAccentMax, setSectionAccentMax] = useState(0);
  const [jathiAccentMin, setJathiAccentMin] = useState(0);
  const [jathiAccentMax, setJathiAccentMax] = useState(0);
  const [jathiAccentMode, setJathiAccentMode] =
    useState<"overrideGati" | "layered">("overrideGati");
  const [automationPickMode, setAutomationPickMode] = useState(false);
  const [automationFocusPanel, setAutomationFocusPanel] =
    useState<AutomationFocusPanel | null>(null);
  const [automationSet, setAutomationSet] = useState<AutomationSet>(() =>
    cloneAutomationSet(DEFAULT_AUTOMATION_SET)
  );
  const [channelHocketOpen, setChannelHocketOpen] = useState(false);
  const [channelHocketTab, setChannelHocketTab] =
    useState<ChannelHocketTabId>("matrix");
  const [channelHocketEnabled, setChannelHocketEnabled] = useState(false);
  const [midiOutputChannel, setMidiOutputChannel] = useState(1);
  const [channelHocketOrder, setChannelHocketOrder] =
    useState<MarkovOrder>("first");
  const [channelHocketAssignMode, setChannelHocketAssignMode] =
    useState<ChannelAssignMode>("markov");
  const [channelHocketEuclid, setChannelHocketEuclid] =
    useState<PatchEuclidChannelState>(() => defaultEuclidChannelState());
  const [channelHocketChannels, setChannelHocketChannels] = useState<number[]>(
    []
  );
  const [channelHocketFallback, setChannelHocketFallback] = useState(1);
  const [channelHocketWeights, setChannelHocketWeights] = useState<
    Record<string, number>
  >({});
  const [channelHocketFallbackWeights, setChannelHocketFallbackWeights] =
    useState<Record<string, number>>({});
  const [channelHocketEntryWeights, setChannelHocketEntryWeights] =
    useState<Record<string, number>>({});
  const [channelHocketSeed, setChannelHocketSeed] = useState(0);
  const [channelHocketSeedBehavior, setChannelHocketSeedBehavior] =
    useState<RhythmSeedBehaviorName>("followGlobal");
  const [channelHocketHistorySeedsInput, setChannelHocketHistorySeedsInput] =
    useState("");
  const [channelHocketHistoryWeight, setChannelHocketHistoryWeight] = useState(1);
  const [channelHocketNewSeedWeight, setChannelHocketNewSeedWeight] = useState(1);
  const [channelHocketMaxHistory, setChannelHocketMaxHistory] = useState(8);
  const [channelHocketNewSeedChance, setChannelHocketNewSeedChance] = useState(
    DEFAULT_NEW_SEED_CHANCE
  );
  const [channelHocketHoldChance, setChannelHocketHoldChance] = useState(
    DEFAULT_HOLD_CHANCE
  );
  const [channelHocketBlendCycles, setChannelHocketBlendCycles] = useState(
    DEFAULT_BLEND_CYCLES
  );
  const [channelAccentRules, setChannelAccentRules] = useState<
    PatchChannelAccentRule[]
  >([]);
  const [channelPositionRules, setChannelPositionRules] = useState<
    PatchChannelPositionRule[]
  >([]);

  return {
    velocity,
    setVelocity,
    beatAccentMin,
    setBeatAccentMin,
    beatAccentMax,
    setBeatAccentMax,
    sectionAccentMin,
    setSectionAccentMin,
    sectionAccentMax,
    setSectionAccentMax,
    jathiAccentMin,
    setJathiAccentMin,
    jathiAccentMax,
    setJathiAccentMax,
    jathiAccentMode,
    setJathiAccentMode,
    automationPickMode,
    setAutomationPickMode,
    automationFocusPanel,
    setAutomationFocusPanel,
    automationSet,
    setAutomationSet,
    channelHocketOpen,
    setChannelHocketOpen,
    channelHocketTab,
    setChannelHocketTab,
    channelHocketEnabled,
    setChannelHocketEnabled,
    midiOutputChannel,
    setMidiOutputChannel,
    channelHocketOrder,
    setChannelHocketOrder,
    channelHocketAssignMode,
    setChannelHocketAssignMode,
    channelHocketEuclid,
    setChannelHocketEuclid,
    channelHocketChannels,
    setChannelHocketChannels,
    channelHocketFallback,
    setChannelHocketFallback,
    channelHocketWeights,
    setChannelHocketWeights,
    channelHocketFallbackWeights,
    setChannelHocketFallbackWeights,
    channelHocketEntryWeights,
    setChannelHocketEntryWeights,
    channelHocketSeed,
    setChannelHocketSeed,
    channelHocketSeedBehavior,
    setChannelHocketSeedBehavior,
    channelHocketHistorySeedsInput,
    setChannelHocketHistorySeedsInput,
    channelHocketHistoryWeight,
    setChannelHocketHistoryWeight,
    channelHocketNewSeedWeight,
    setChannelHocketNewSeedWeight,
    channelHocketMaxHistory,
    setChannelHocketMaxHistory,
    channelHocketNewSeedChance,
    setChannelHocketNewSeedChance,
    channelHocketHoldChance,
    setChannelHocketHoldChance,
    channelHocketBlendCycles,
    setChannelHocketBlendCycles,
    channelAccentRules,
    setChannelAccentRules,
    channelPositionRules,
    setChannelPositionRules,
  };
}
