// Pure patch save/load normalization helpers extracted from App.tsx.
// Keep this module free of React and Tauri runtime imports.

import { normalizeDumkaPattern } from "./dumkaPattern";
import {
  normalizeEvolutionCurve,
  MAX_EVOLUTION_DIRECTIVES,
  MAX_PERCEPTUAL_DISTANCE_MILLI,
  MAX_PERCEPTUAL_OPERATIONS,
  MAX_PERCEPTUAL_SCORING_WORK,
  perceptualDirectiveScoringWork,
} from "./dumkaEvolvePlan";
import {
  normalizeLegacyRandomizeSettings,
  type LegacyRandomizeSettings,
} from "./legacyRandomizeSettings";
import {
  normalizeU64SeedDecimal,
  normalizeU64SeedDecimalList,
} from "./u64Seed";
import { stoppedPreviewCycleIndex } from "./timelineModel";
export {
  normalizeU64SeedDecimal,
  normalizeU64SeedDecimalList,
} from "./u64Seed";
export { MAX_EVOLUTION_DIRECTIVES } from "./dumkaEvolvePlan";
import {
  defaultTrackFlowChain,
  isReservedTrackFlowId,
  trackFlowLaneId,
  TRACK_FLOW_DEFAULT_BOX_ID,
  TRACK_FLOW_DEFAULT_BOX_NAME,
  TRACK_FLOW_DEFAULT_SEED,
  type TrackFlowBox,
  type TrackFlowChainState,
} from "./trackFlowBoxes";
import type {
  ArbitrarySubdivisionPatternSource,
  AutomationSegmentCurve,
  AutomationSegmentCurveKind,
  AutomationSet,
  EvolutionCurve,
  ChannelAccentRoutingMode,
  ChannelHocketOrnamentMode,
  ChannelHocketRatchetMode,
  ChannelAssignMode,
  ChannelPositionActionWeights,
  ChannelPositionResetMode,
  ChannelPositionScope,
  EuclidPlacement,
  EuclidResetScope,
  EuclidSpanAccentMode,
  EvolutionDirective,
  CustomPartCountChoice,
  CustomSubdivision,
  DelayOrnamentSpec,
  DelayQuantizationMode,
  DelayTimeDistribution,
  DelayTupletWeight,
  GraceNoteDurationBasis,
  GraceNotePlacement,
  GraceNotePlacementWeights,
  GracePitchScope,
  JathiBhedamOp,
  JathiBhedamPhrasing,
  JathiBhedamSelection,
  JathiWeight,
  MarkovOrder,
  MukthayPolicy,
  OrnamentPlaybackSpec,
  PitchBoundary,
  PitchBoundaryPolicy,
  PitchOrnamentMode,
  PitchRatchetMode,
  PitchState,
  PitchTranspositionMode,
  PlaybackSeedTraceEvent,
  RatchetCooldownBasis,
  RatchetCurve,
  RatchetBandSpec,
  RatchetCurveWeights,
  RatchetDurationModifier,
  RatchetEdgeWeights,
  RatchetFillSpec,
  RatchetLengthWindow,
  RatchetPlacementSpec,
  RatchetVelocityContour,
  RatchetDurationBasis,
  RatchetInternalRhythmSpec,
  RatchetModifierOperation,
  RatchetPlaybackSpec,
  RatchetPositionModifierSpec,
  RatchetProbabilityModifiers,
  RatchetSpanGateLimit,
  RatchetSpeedDistribution,
  RatchetSpeedStrategy,
  RatchetTemporalEasingShape,
  RatchetTemporalEasingWeights,
  RatchetTimeCurveChoice,
  RatchetTimeCurvePoint,
  RatchetTimeCurveSpec,
  RatchetVelocityMode,
  RatchetVelocitySpec,
  RhythmArticulationBlendMode,
  RhythmArticulationSeedPolicy,
  RhythmChainSpec,
  RhythmExtrapolationStrategy,
  RhythmPassageStrategy,
  RhythmPattern,
  ShapeDomain,
  ShapeGroupSpec,
  ShapeOperation,
  ShapeSelection,
  ShapeStage,
  RhythmPreview,
  RhythmSpeedContextKind,
  RhythmSpeedMultiplier,
  SubdivisionWeight,
  SwitchCountWeight,
  SynthChannelMode,
  SynthChannelProgram,
  TriggerBeatSelector,
  TriggerCondition,
  TriggerConditionNode,
  TriggerConfig,
  TriggerCountOp,
  TriggerGateSpec,
  TriggerLaunchAlignment,
  TriggerLaunchQuantize,
  TriggerLength,
  TriggerLifetime,
  TriggerQuantizeDirection,
  TriggerQuantizeGrid,
  TriggerReTrigger,
  TriggerStartSelect,
  U64SeedDecimal,
  TriggerWeightedStart,
  TriggerWhenPredicate,
  TriggerWhenSpec,
  WeightedClumpLength,
  WeightedMidiPitch,
  WeightedPitchInterval,
  WeightedSubdivisionTarget,
} from "./bridge";

import {
  canonicalizeGatiWeights,
  canonicalizeJathiWeights,
  canonicalizePartCountWeights,
  fixedGroupingFromWeights,
  fixedGroupingWeights,
  fixedSubdivisionFromWeights,
  fixedSubdivisionWeights,
} from "./sectionsSubdivisionsLogic";



export const DEFAULT_INITIAL_WEIGHTS: SubdivisionWeight[] = [
  { subdivision: 4, weight: 2 },
  { subdivision: 3, weight: 1 },
  { subdivision: 5, weight: 1 },
];

export const NEUTRAL_INITIAL_WEIGHTS: SubdivisionWeight[] = [
  { subdivision: 4, weight: 1 },
];

export const DEFAULT_CUSTOM_PART_COUNT_WEIGHTS: CustomPartCountChoice[] = [
  { count: 5, weight: 1 },
  { count: 8, weight: 1 },
];

export const DEFAULT_CUSTOM_PART_GATI_WEIGHTS: SubdivisionWeight[] = [
  { subdivision: 5, weight: 1 },
  { subdivision: 7, weight: 1 },
];


export type AutomationTrackData = AutomationSet["tracks"][number];

export type AutomationGraphRangeData = NonNullable<AutomationTrackData["graphRange"]>;


export const DEFAULT_SWITCH_WEIGHTS: SubdivisionWeight[] = [
  { subdivision: 3, weight: 1 },
  { subdivision: 4, weight: 1 },
  { subdivision: 5, weight: 1 },
  { subdivision: 7, weight: 0.6 },
];


export const ALLOWED_JATHIS = [3, 4, 5, 6, 7, 9, 11];


export const DEFAULT_JATHI_WEIGHTS: JathiWeight[] = ALLOWED_JATHIS.map((jathi) => ({
  jathi,
  weight: 1,
}));

export const NEUTRAL_JATHI_WEIGHTS: JathiWeight[] = ALLOWED_JATHIS.map((jathi) => ({
  jathi,
  weight: 0,
}));


export const DEFAULT_SECTION_COUNTS: SwitchCountWeight[] = [
  { count: 0, weight: 1 },
  { count: 1, weight: 2 },
  { count: 2, weight: 3 },
  { count: 3, weight: 1 },
];

export const NEUTRAL_SECTION_COUNTS: SwitchCountWeight[] = [
  { count: 0, weight: 1 },
];


export const RHYTHM_LENGTHS = [3, 4, 5, 6, 7, 9, 11];

export const RHYTHM_PATTERN_ENUMERATION_LIMIT = 14;

export const RHYTHM_STATE_LIMIT = 8;

export const PITCH_MATRIX_STATE_LIMIT = RHYTHM_STATE_LIMIT;

export const PITCH_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

// Pitch collections (scales / modes / ragas / sets). `pitchClasses` is the
// ordered ascending degree set in semitones from the tonic; it is both the
// staff snap mask and the lattice sent to the engine as `PitchCollection`.
// `transpositions` is how many distinct transpositions exist before the set
// repeats (12 for ordinary scales; fewer for Messiaen modes of limited
// transposition) — it bounds the tonic selector.
// `group` drives the grouped picker in the UI.
export interface PitchCollectionPreset {
  id: string;
  label: string;
  pitchClasses: number[];
  transpositions: number;
  group: string;
}

export const BASE_PITCH_COLLECTIONS: PitchCollectionPreset[] = [
  // Western diatonic + common scales.
  { id: "major", label: "Major (Ionian)", pitchClasses: [0, 2, 4, 5, 7, 9, 11], transpositions: 12, group: "Western" },
  { id: "natural-minor", label: "Natural minor (Aeolian)", pitchClasses: [0, 2, 3, 5, 7, 8, 10], transpositions: 12, group: "Western" },
  { id: "harmonic-minor", label: "Harmonic minor", pitchClasses: [0, 2, 3, 5, 7, 8, 11], transpositions: 12, group: "Western" },
  { id: "melodic-minor", label: "Melodic minor (asc)", pitchClasses: [0, 2, 3, 5, 7, 9, 11], transpositions: 12, group: "Western" },
  { id: "dorian", label: "Dorian", pitchClasses: [0, 2, 3, 5, 7, 9, 10], transpositions: 12, group: "Western" },
  { id: "phrygian", label: "Phrygian", pitchClasses: [0, 1, 3, 5, 7, 8, 10], transpositions: 12, group: "Western" },
  { id: "lydian", label: "Lydian", pitchClasses: [0, 2, 4, 6, 7, 9, 11], transpositions: 12, group: "Western" },
  { id: "mixolydian", label: "Mixolydian", pitchClasses: [0, 2, 4, 5, 7, 9, 10], transpositions: 12, group: "Western" },
  { id: "locrian", label: "Locrian", pitchClasses: [0, 1, 3, 5, 6, 8, 10], transpositions: 12, group: "Western" },
  { id: "major-pentatonic", label: "Major pentatonic", pitchClasses: [0, 2, 4, 7, 9], transpositions: 12, group: "Western" },
  { id: "minor-pentatonic", label: "Minor pentatonic", pitchClasses: [0, 3, 5, 7, 10], transpositions: 12, group: "Western" },
  { id: "chromatic", label: "Chromatic", pitchClasses: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], transpositions: 1, group: "Western" },
  // Carnatic melakarta sample (the app's home idiom).
  { id: "raga-mayamalavagowla", label: "Mayamalavagowla", pitchClasses: [0, 1, 4, 5, 7, 8, 11], transpositions: 12, group: "Carnatic" },
  { id: "raga-shankarabharanam", label: "Shankarabharanam", pitchClasses: [0, 2, 4, 5, 7, 9, 11], transpositions: 12, group: "Carnatic" },
  { id: "raga-kharaharapriya", label: "Kharaharapriya", pitchClasses: [0, 2, 3, 5, 7, 9, 10], transpositions: 12, group: "Carnatic" },
  { id: "raga-todi", label: "Todi (Hanumatodi)", pitchClasses: [0, 1, 3, 5, 7, 8, 10], transpositions: 12, group: "Carnatic" },
  { id: "raga-kalyani", label: "Kalyani", pitchClasses: [0, 2, 4, 6, 7, 9, 11], transpositions: 12, group: "Carnatic" },
  // Messiaen modes of limited transposition.
  { id: "messiaen1", label: "Mode 1 · whole tone", pitchClasses: [0, 2, 4, 6, 8, 10], transpositions: 2, group: "Limited" },
  { id: "messiaen2", label: "Mode 2 · octatonic", pitchClasses: [0, 1, 3, 4, 6, 7, 9, 10], transpositions: 3, group: "Limited" },
  { id: "messiaen3", label: "Mode 3", pitchClasses: [0, 2, 3, 4, 6, 7, 8, 10, 11], transpositions: 4, group: "Limited" },
  { id: "messiaen4", label: "Mode 4", pitchClasses: [0, 1, 2, 5, 6, 7, 8, 11], transpositions: 6, group: "Limited" },
  { id: "tritone-cycle", label: "Tritone cycle", pitchClasses: [0, 6], transpositions: 6, group: "Limited" },
];

export const LIMITED_TRANSPOSITION_COLLECTIONS: PitchCollectionPreset[] = [
  ...BASE_PITCH_COLLECTIONS,
];

export const MIDI_CHANNELS = Array.from({ length: 16 }, (_, index) => index + 1);

export const DEFAULT_HOCKET_CHANNELS = [1, 2, 3, 4];

export const DEFAULT_CHANNEL_ACCENT_RULES: PatchChannelAccentRule[] = [
  {
    label: "Beat accents",
    enabled: false,
    minVelocity: 104,
    maxVelocity: 116,
    probabilityPercent: 100,
    mode: "renderOnly",
    weights: { "2": 1 },
  },
  {
    label: "Strong accents",
    enabled: false,
    minVelocity: 117,
    maxVelocity: 127,
    probabilityPercent: 100,
    mode: "driveChain",
    weights: { "4": 1 },
  },
];

export const DEFAULT_SYNTH_PROGRAMS = [
  0, 12, 104, 77, 62, 89, 116, 115, 4, 0, 45, 48, 52, 73, 80, 88,
];

export const DEFAULT_SYNTH_DRUM_NOTES = [
  36, 38, 42, 46, 45, 50, 64, 60, 75, 77, 54, 53, 35, 37, 39, 81,
];

export const DEFAULT_SYNTH_VOICES: SynthChannelProgram[] = MIDI_CHANNELS.map((channel) => ({
  channel,
  mode: "melodic",
  program: DEFAULT_SYNTH_PROGRAMS[channel - 1] ?? 0,
  drumNote: DEFAULT_SYNTH_DRUM_NOTES[channel - 1] ?? 36,
}));

export const NEUTRAL_SYNTH_VOICES: SynthChannelProgram[] = MIDI_CHANNELS.map((channel) => ({
  channel,
  mode: "melodic",
  program: 0,
  drumNote: 36,
}));

export const DEFAULT_ARBITRARY_TARGETS: WeightedSubdivisionTarget[] = RHYTHM_LENGTHS.map(
  (spanLen) => ({ spanLen, weight: spanLen === 7 ? 1 : 0 })
);

export const DEFAULT_ARBITRARY_CLUMPS: WeightedClumpLength[] = [1, 2, 3, 4].map(
  (count) => ({ count, weight: count === 1 ? 1 : 0 })
);

export const RHYTHM_SPEED_CHOICES: Array<{
  id: RhythmSpeedChoiceId;
  label: string;
  detail: string;
  multiplier: RhythmSpeedMultiplier;
}> = [
  {
    id: "oneSeventhSpeed",
    label: "1/7",
    detail: "7-frame pratiloma",
    multiplier: { numerator: 1, denominator: 7 },
  },
  {
    id: "oneSixthSpeed",
    label: "1/6",
    detail: "6-frame pratiloma",
    multiplier: { numerator: 1, denominator: 6 },
  },
  {
    id: "oneFifthSpeed",
    label: "1/5",
    detail: "5-frame pratiloma",
    multiplier: { numerator: 1, denominator: 5 },
  },
  {
    id: "quarterSpeed",
    label: "1/4",
    detail: "4-frame pratiloma",
    multiplier: { numerator: 1, denominator: 4 },
  },
  {
    id: "oneThirdSpeed",
    label: "1/3",
    detail: "3-frame pratiloma",
    multiplier: { numerator: 1, denominator: 3 },
  },
  {
    id: "halfSpeed",
    label: "1/2",
    detail: "2-frame pratiloma",
    multiplier: { numerator: 1, denominator: 2 },
  },
  {
    id: "firstSpeed",
    label: "1st",
    detail: "native note length",
    multiplier: { numerator: 1, denominator: 1 },
  },
  {
    id: "secondSpeed",
    label: "2nd",
    detail: "2nd speed anuloma",
    multiplier: { numerator: 2, denominator: 1 },
  },
  {
    id: "thirdSpeed",
    label: "3rd",
    detail: "3rd speed anuloma",
    multiplier: { numerator: 3, denominator: 1 },
  },
  {
    id: "fourthSpeed",
    label: "4th",
    detail: "4th speed anuloma",
    multiplier: { numerator: 4, denominator: 1 },
  },
];

export const RHYTHM_SPEED_CONTEXT_KINDS: RhythmSpeedContextKind[] = ["gati", "jathi"];

export const DEFAULT_RHYTHM_SPEED_WEIGHTS: Record<string, number> = Object.fromEntries(
  RHYTHM_SPEED_CONTEXT_KINDS.flatMap((contextKind) =>
    RHYTHM_LENGTHS.flatMap((contextValue) =>
      rhythmSpeedChoicesForContext(contextKind).map((choice) => [
        `${contextKind}:${contextValue}:${choice.id}`,
        choice.id === "firstSpeed" ? 1 : 0,
      ])
    )
  )
);

export const PATCH_APP_ID = "Dum-Ka";

/** First fork-owned patch and track schema. No CarnaticSeq migrations exist. */
export const PATCH_SCHEMA_VERSION = 1;

export const AUTOSAVE_PREF_STORAGE_KEY = "caesura.autosaveEnabled.v1";

export const DEFAULT_AUTOSAVE_ENABLED = true;

export const DEFAULT_AUTOSAVE_INTERVAL_MS = 3_000;

export const MIN_AUTOSAVE_INTERVAL_MS = 1_000;

export const MAX_AUTOSAVE_INTERVAL_MS = 60_000;

export const FALLBACK_GLOBAL_SEED = 20260505;

export const MAX_SAFE_SEED = Number.MAX_SAFE_INTEGER;

export const DEFAULT_AUTOMATION_SET: AutomationSet = {
  lengthCycles: 1,
  markers: [],
  tracks: [],
};

export const NEUTRAL_SCORE_NAME = "";

export const NEUTRAL_CYCLE_BEATS = 4;

export const NEUTRAL_TEMPO_BPM = 80;

export const NEUTRAL_PITCH = 60;

export const NEUTRAL_VELOCITY = 96;

export const DEFAULT_PITCH_RANGE_LOW = 48; // C3

export const DEFAULT_PITCH_RANGE_HIGH = 71; // B4

export const MAX_AUTOMATION_LENGTH_CYCLES = 1_000_000;

export const MAX_PARALLEL_TRACKS = 16;

export const DEFAULT_PARALLEL_TRACK_ID = "track-1";

export const DEFAULT_PARALLEL_TRACK_COLOR = "#00a39f";

/**
 * Per-track identity colors (Solarized Astral accents). UI-only — used for
 * track tabs / timeline track distinction, never for playback routing. Single
 * source of truth; `playbackRequests.ts` re-exports this.
 */
export const PARALLEL_TRACK_COLORS = [
  "#00a39f",
  "#e11984",
  "#008cde",
  "#8263d4",
  "#56a070",
  "#ca5021",
  "#bb8800",
  "#e12f43",
] as const;

export const MIDI_DEBUG_LIMIT_OPTIONS = [40, 100, 250, 500, 1000] as const;

export const DEFAULT_MIDI_DEBUG_LIMIT = 250;

export const AUTOMATION_DEBUG_LIMIT_OPTIONS = [20, 50, 100, 250, 500, 1000] as const;

export const DEFAULT_AUTOMATION_DEBUG_LIMIT = 100;


export const DEFAULT_RATCHET_MODIFIERS: RatchetProbabilityModifiers = {
  slowNote: {
    enabled: false,
    threshold: 2,
    basis: "matras",
    multiplier: 1.5,
    operation: "multiply",
  },
  fastNote: {
    enabled: false,
    threshold: 20,
    basis: "percentOfBeat",
    multiplier: 0.6,
    operation: "multiply",
  },
  position: {
    enabled: false,
    points: [
      { position: 0, probability: 1, speed: 1 },
      { position: 0.5, probability: 1, speed: 1 },
      { position: 1, probability: 1, speed: 1 },
    ],
  },
  accentSpanStart: 1,
  accentSpanEnd: 1,
  sectionStart: 1,
  sectionEnd: 1,
  cycleStart: 1,
  cycleEnd: 1,
  operations: {
    accentSpanStart: "multiply",
    accentSpanEnd: "multiply",
    sectionStart: "multiply",
    sectionEnd: "multiply",
    cycleStart: "multiply",
    cycleEnd: "multiply",
  },
};

export const DEFAULT_RATCHET_AUDIBLE_RATE_MIN = 12;

export const DEFAULT_RATCHET_AUDIBLE_RATE_MAX = 22;

export const DEFAULT_RATCHET_BEAT_RATE_MIN = 8;

export const DEFAULT_RATCHET_BEAT_RATE_MAX = 14;

export const DEFAULT_RATCHET_MATRA_RATE_MIN = 2;

export const DEFAULT_RATCHET_MATRA_RATE_MAX = 3;

export const DEFAULT_RATCHET_MAX_SPAN_MATRAS = 4;

export const DEFAULT_RATCHET_INTERNAL_RHYTHM_MIN_COUNT = 3;

export const DEFAULT_RATCHET_INTERNAL_RHYTHM_MAX_COUNT = 11;

export const RATCHET_RELATIVE_VELOCITY_MIN = -64;

export const RATCHET_RELATIVE_VELOCITY_MAX = 64;

export const RATCHET_COOLDOWN_LIMITS: Record<
  RatchetCooldownBasis,
  { max: number; step: number; suffix: string; label: string }
> = {
  matras: { max: 16, step: 1, suffix: "pulses", label: "Pulses" },
  milliseconds: { max: 2000, step: 10, suffix: "ms", label: "Milliseconds" },
  beats: { max: 4, step: 0.125, suffix: "beat", label: "Beat multiple" },
  percentOfBeat: { max: 400, step: 5, suffix: "% beat", label: "% of beat" },
};

export const DEFAULT_RATCHET_VELOCITY: RatchetVelocitySpec = {
  enabled: false,
  mode: "relative",
  min: -24,
  max: 16,
  center: 0,
  attraction: 0.65,
  sameProbability: 0,
  contour: null,
};

export const DEFAULT_RATCHET_BAND: RatchetBandSpec = {
  rateSlowRef: 9,
  rateFastRef: 25,
  tracking: 0.5,
  bias: 0,
  spread: 0,
  sync: false,
};

export const DEFAULT_RATCHET_EDGE_WEIGHTS: RatchetEdgeWeights = {
  accentStart: 1,
  accentEnd: 1,
  sectionStart: 1,
  sectionEnd: 1,
  cycleStart: 1,
  cycleEnd: 1,
};

/** The V2 layer of the ratchet spec as one UI state bundle. */
export interface RatchetV2State {
  band: RatchetBandSpec | null;
  fill: RatchetFillSpec | null;
  placement: RatchetPlacementSpec | null;
  velocityContour: RatchetVelocityContour | null;
}

export function defaultRatchetV2State(): RatchetV2State {
  return {
    band: { ...DEFAULT_RATCHET_BAND },
    fill: null,
    placement: {
      ...DEFAULT_RATCHET_PLACEMENT,
      spanPosition: { ...DEFAULT_RATCHET_PLACEMENT.spanPosition },
      edgeWeights: { ...DEFAULT_RATCHET_PLACEMENT.edgeWeights },
      phraseWeights: [],
    },
    velocityContour: null,
  };
}

export const DEFAULT_RATCHET_PLACEMENT: RatchetPlacementSpec = {
  lengthBias: -0.5,
  lengthWindow: null,
  phraseWeights: [],
  spanPosition: { start: 1, mid: 1, end: 1 },
  edgeWeights: { ...DEFAULT_RATCHET_EDGE_WEIGHTS },
  normalize: true,
};

export const DEFAULT_ORNAMENT_VELOCITY: RatchetVelocitySpec = {
  enabled: false,
  mode: "relative",
  min: -18,
  max: 4,
  center: -8,
  attraction: 0.55,
  sameProbability: 0,
};

export const ORNAMENT_DURATION_LIMITS: Record<
  GraceNoteDurationBasis,
  { max: number; step: number; suffix: string; label: string }
> = {
  milliseconds: { max: 250, step: 1, suffix: "ms", label: "Milliseconds" },
  percentOfBeat: { max: 50, step: 1, suffix: "% beat", label: "% of beat" },
};

export const DELAY_TUPLETS = [3, 4, 5, 6, 7, 9, 11] as const;

export const DEFAULT_RATCHET_CURVE_WEIGHTS: RatchetCurveWeights = {
  even: 0,
  accelerando: 0,
  retardando: 0,
  accelerandoRetardando: 0,
  retardandoAccelerando: 0,
};

export const DEFAULT_RATCHET_EASING_WEIGHTS: RatchetTemporalEasingWeights = {
  humanize: 0,
  humanizeTight: 0,
  humanizeLoose: 0,
  subtleAccelerando: 0,
  subtleRetardando: 0,
  sway: 0,
  lilt: 0,
};

export const DEFAULT_RATCHET_TIME_CURVE_POINTS: RatchetTimeCurvePoint[] = [
  { x: 0, y: 0.5 },
  { x: 0.25, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.75, y: 0.5 },
  { x: 1, y: 0.5 },
];

export const DEFAULT_CYCLE_TEMPO_FLUX_CURVE_POINTS: RatchetTimeCurvePoint[] = [
  { x: 0, y: 0.72 },
  { x: 0.25, y: 0.58 },
  { x: 0.5, y: 0.38 },
  { x: 0.75, y: 0.58 },
  { x: 1, y: 0.72 },
];

export const DEFAULT_CYCLE_TEMPO_FLUX_MIN_BPM = 78;

export const DEFAULT_CYCLE_TEMPO_FLUX_MAX_BPM = 84;


export type RhythmMaterializeMode = "replace" | "fillEmpty";

export type RhythmTab =
  | "patterns"
  | "resubdivision"
  | "ratchet"
  | "ornaments"
  | "seeds";

export type OrnamentTab = "grace" | "delay";

export type PitchTab = "collection" | "matrix" | "gracePitch" | "transpose" | "seeds";

export type RhythmCopyTargetMode = "all" | "selected";

export type RhythmFallbackMode = "static" | "weighted";

export const DEFAULT_GRACE_PITCH_POOL: WeightedMidiPitch[] = [{ pitch: 60, weight: 1 }];

export const DEFAULT_GRACE_TRANSPOSE_INTERVALS: WeightedPitchInterval[] = [
  { semitones: 1, weight: 1 },
  { semitones: 2, weight: 1 },
  { semitones: 7, weight: 1 },
  { semitones: 12, weight: 1 },
];

export type RhythmSpeedChoiceId =
  | "oneSeventhSpeed"
  | "oneSixthSpeed"
  | "oneFifthSpeed"
  | "quarterSpeed"
  | "oneThirdSpeed"
  | "halfSpeed"
  | "firstSpeed"
  | "secondSpeed"
  | "thirdSpeed"
  | "fourthSpeed";

export type SetupTab = "audio" | "midi" | "files";

export type SeedDialogTab = "global" | "rhythm" | "pitch" | "channel" | "ratchet" | "log";

export type SeedLogScope = "all" | "global" | "rhythm" | "pitch" | "channel" | "paths";

export type SeedPathWildcardDomain =
  | "global"
  | "rhythm"
  | "articulation"
  | "pitch"
  | "channel"
  | "ratchet";

export type PatchSchemaVersion = typeof PATCH_SCHEMA_VERSION;

export type TrackTempoMode = "global" | "custom";

export type TrackCycleLengthMode = "global" | "custom";

/**
 * How a parallel-project track participates in playback.
 * - `parallel` (default): free-runs with the ensemble (today's behavior).
 * - `trackFlow`: a candidate the project's sequential Track Flow lane chooses
 *   between; silent unless the lane selects it.
 */
export type TrackPlaybackMode = "parallel" | "trackFlow";

export type ChannelConflictPolicy =
  | "forceOn"
  | "forceOff"
  | "allowAll"
  | "or"
  | "randomOne"
  | "alternate"
  | "priorityOrder"
  | "xor"
  | "xnor"
  | "and"
  | "nand"
  | "nor"
  | "even"
  | "odd"
  | "oneHigh"
  | "oneLow"
  | "majority"
  | "minority";

export interface ChannelLogicMatrixEntry {
  trackAId: string;
  trackBId: string;
  outputChannel?: number | null;
  policy: ChannelConflictPolicy;
}

export type PatchChannelAccentRule = {
  label: string;
  enabled: boolean;
  minVelocity: number;
  maxVelocity: number;
  probabilityPercent: number;
  mode: ChannelAccentRoutingMode;
  weights: Record<string, number>;
};

export type PatchChannelPositionRule = {
  id: string;
  label: string;
  enabled: boolean;
  scope: ChannelPositionScope;
  nth: number;
  actionWeights: ChannelPositionActionWeights;
  renderWeights: Record<string, number>;
  resetMode: ChannelPositionResetMode;
  resetWeights: Record<string, number>;
};


export interface SeedPathTracePoint extends PlaybackSeedTraceEvent {
  recordedAt: string;
}


export interface SeedPathWildcardRule {
  domain: SeedPathWildcardDomain;
  cycle: number | null;
  /** Track this wildcard applies to. `null` applies to all tracks. */
  trackId: string | null;
}


export interface SeedPath {
  id: string;
  name: string;
  createdAt: string;
  sourcePathId: string | null;
  immutable: true;
  wildcardRules: SeedPathWildcardRule[];
  trace: SeedPathTracePoint[];
}


export type SeedModeName = "locked" | "perCycle" | "history" | "drift" | "morph";

export type RhythmSeedBehaviorName =
  | "followGlobal"
  | "locked"
  | "perCycle"
  | "history"
  | "drift"
  | "morph";

/** Default percent chance that a Drift scope re-rolls its seed on a new
 * cycle — an expected hold of ~6-7 cycles. Morph shares the field as its
 * per-cycle chance of starting a new seed layer. */
export const DEFAULT_NEW_SEED_CHANCE = 15;

/** Default percent chance that a Morph scope repeats the previous cycle's
 * pick instead of sampling the current seed mixture. */
export const DEFAULT_HOLD_CHANCE = 50;

/** Default cycles for a new Morph seed layer to fade in fully. */
export const DEFAULT_BLEND_CYCLES = 16;


export interface PatchAccentState {
  beatStart: { min: number; max: number };
  sectionStartExtra: { min: number; max: number };
  jathiStart: { min: number; max: number };
  jathiMode: "overrideGati" | "layered";
}


export interface PatchSequencerState {
  scoreSetupOpen: boolean;
  /** Randomize editor settings (authoring controls, not playback seed policy). */
  randomize: LegacyRandomizeSettings;
  probabilityOpen: boolean;
  boundariesOpen: boolean;
  maxSectionsHelpOpen: boolean;
  name: string;
  cycleBeats: number;
  initialWeights: SubdivisionWeight[];
  initialJathiWeights: JathiWeight[];
  /** Initial (cycle-start) Jathi Bhedam selection. Optional/null => regular. */
  initialJathiBhedam?: JathiBhedamSelection | null;
  initialCustomSubdivision: CustomSubdivision | null;
  boundaries: BoundaryPoint[];
  selectedBoundaryAfterBeat: number | null;
  sectionCountWeights: SwitchCountWeight[];
  seedMode: SeedModeName;
  seed: number;
  historySeeds: U64SeedDecimal[];
  historyWeight: number;
  newSeedWeight: number;
  maxHistory: number;
  newSeedChance: number;
  holdChance: number;
  blendCycles: number;
  singleParameterRhythmicModulation: boolean;
  pitch: number;
  velocity: number;
  accent: PatchAccentState;
  userPreviewCycle: number;
}


export interface PatchBeatLockPatternCell {
  restProbabilityPercent: number;
  tieProbabilityPercent: number;
}

export interface PatchBeatLockPattern {
  pulses: number[];
  weight: number;
  /**
   * Matra-by-matra rest/tie overrides, aligned by index with `pulses`
   * (mirroring the Cell rests & ties manual layer). A positive entry
   * overrides the lock-level rest/tie percents for that cell; all-zero
   * entries defer to them.
   */
  cells: PatchBeatLockPatternCell[];
}

/**
 * How a lock's pattern pool is assigned over its beat range. `span`: one draw
 * covers the whole window (patterns must tile Σ gati over the range).
 * `perBeat`: the pool applies to each covered beat individually — every beat
 * draws its own pattern per cycle (patterns must tile that beat's gati).
 * Realized by expanding a perBeat lock into per-beat engine locks with stable
 * derived ids (`beatLockSpecFromPatch`), so the engine model stays span-only.
 */
export type PatchBeatLockMode = "span" | "perBeat";

export interface PatchBeatLock {
  id: string;
  enabled: boolean;
  mode: PatchBeatLockMode;
  startBeat: number;
  endBeat: number;
  patterns: PatchBeatLockPattern[];
  unlockedWeight: number;
  allowTieIn: boolean;
  allowTieOut: boolean;
  allowArticulation: boolean;
  /** Lock-local stochastic rests & ties on locked cells, integer percent 0..100. */
  restProbabilityPercent: number;
  tieProbabilityPercent: number;
}

export interface PatchRhythmState {
  rhythmOpen: boolean;
  rhythmTab: RhythmTab;
  rhythmLength: number;
  rhythmOrder: MarkovOrder;
  rhythmExtrapolateFrom: number;
  rhythmExtrapolationStrategy: RhythmExtrapolationStrategy;
  rhythmMaterializeMode: RhythmMaterializeMode;
  copyTargetMode: RhythmCopyTargetMode;
  copySelectedTargets: number[];
  passageInput: string;
  passageStrategy: RhythmPassageStrategy;
  passageOrder: MarkovOrder;
  passageFitStrategy: RhythmExtrapolationStrategy;
  passageTargetMode: RhythmCopyTargetMode;
  passageSelectedTargets: number[];
  passageHelpOpen: boolean;
  selectedKeysByLength: Record<number, string[]>;
  speedEditorKind: RhythmSpeedContextKind;
  speedEditorValue: number;
  rhythmSeed: number;
  rhythmSeedBehavior: RhythmSeedBehaviorName;
  historySeeds: U64SeedDecimal[];
  historyWeight: number;
  newSeedWeight: number;
  maxHistory: number;
  newSeedChance: number;
  holdChance: number;
  blendCycles: number;
  fallback: number;
  fallbackMode: RhythmFallbackMode;
  fallbackWeightsByLength: Record<number, Record<string, number>>;
  entryWeightsByLength: Record<number, Record<string, number>>;
  weights: Record<string, number>;
  articulation: PatchRhythmArticulationState;
  arbitrarySubdivision: {
    probabilityPercent: number;
    targets: WeightedSubdivisionTarget[];
    clumpLengths: WeightedClumpLength[];
    allowTrivialPattern: boolean;
    patternSource: ArbitrarySubdivisionPatternSource;
    poolWeightsByLength: Record<number, Record<string, number>>;
    poolEditorLength: number;
  };
  beatLocks: {
    open: boolean;
    seed: number;
    locks: PatchBeatLock[];
  };
  shapeGroups: {
    open: boolean;
    seed: number;
    groups: ShapeGroupSpec[];
  };
  speedSubdivisionWeights: Record<string, number>;
  ratchet: {
    enabled: boolean;
    spec: RatchetPlaybackSpec;
  };
  ornament: {
    enabled: boolean;
    tab: OrnamentTab;
    spec: OrnamentPlaybackSpec;
  };
  playbackChains: RhythmChainSpec[];
  resolvedSeed: RhythmPreview["resolution"]["seed"] | null;
}


export interface PatchEuclidChannelLayer {
  channel: number;
  pulses: number;
  rotation: number;
  maxRun: number;
  /** Stack placement only: this layer's own pattern length. */
  steps: number;
  /** Stack placement only. */
  invert: boolean;
}

export interface PatchEuclidChannelState {
  placement: EuclidPlacement;
  steps: number;
  layers: PatchEuclidChannelLayer[];
  reset: EuclidResetScope;
  spanAccentMode: EuclidSpanAccentMode;
  /** Bypass anchor channel; null follows the static fallback. */
  spanAccentChannel: number | null;
}

export interface PatchChannelHocketState {
  open: boolean;
  enabled: boolean;
  outputChannel: number;
  order: MarkovOrder;
  channels: number[];
  weights: Record<string, number>;
  fallback: number;
  fallbackWeights: Record<string, number>;
  entryWeights: Record<string, number>;
  seed: number;
  seedBehavior: RhythmSeedBehaviorName;
  historySeeds: U64SeedDecimal[];
  historyWeight: number;
  newSeedWeight: number;
  maxHistory: number;
  newSeedChance: number;
  holdChance: number;
  blendCycles: number;
  ratchetMode: ChannelHocketRatchetMode;
  wholeProbabilityPercent: number;
  perHitProbabilityPercent: number;
  preserveFirstHit: boolean;
  ornamentMode: ChannelHocketOrnamentMode;
  ornamentWholeProbabilityPercent: number;
  ornamentPerGraceProbabilityPercent: number;
  accentRules: PatchChannelAccentRule[];
  positionRules: PatchChannelPositionRule[];
  /** Which strategy assigns channels. Pre-v6 documents load as "markov". */
  assignMode: ChannelAssignMode;
  euclid: PatchEuclidChannelState;
}


export interface PatchPitchShaperState {
  open: boolean;
  enabled: boolean;
  tab: PitchTab;
  order: MarkovOrder;
  collectionId: string;
  collectionTransposition: number;
  rangeLow: number;
  rangeHigh: number;
  states: PitchState[];
  selectedKeys: string[];
  weights: Record<string, number>;
  fallback: number;
  fallbackMode: RhythmFallbackMode;
  fallbackWeights: Record<string, number>;
  entryWeights: Record<string, number>;
  seed: number;
  seedBehavior: RhythmSeedBehaviorName;
  historySeeds: U64SeedDecimal[];
  historyWeight: number;
  newSeedWeight: number;
  maxHistory: number;
  newSeedChance: number;
  holdChance: number;
  blendCycles: number;
  boundary: PitchBoundary;
  ratchetMode: PitchRatchetMode;
  wholeProbabilityPercent: number;
  perHitProbabilityPercent: number;
  preserveFirstHit: boolean;
  ornamentMode: PitchOrnamentMode;
  ornamentWholeProbabilityPercent: number;
  ornamentPerGraceProbabilityPercent: number;
  gracePitchEnabled: boolean;
  gracePitchProbabilityPercent: number;
  gracePitchScope: GracePitchScope;
  gracePitchPitches: WeightedMidiPitch[];
  graceTransposeEnabled: boolean;
  graceTransposeProbabilityPercent: number;
  graceTransposeScope: GracePitchScope;
  graceTransposeUpWeight: number;
  graceTransposeDownWeight: number;
  graceTransposeIntervals: WeightedPitchInterval[];
  transposeEnabled: boolean;
  transposeProbabilityPercent: number;
  transposeMode: PitchTranspositionMode;
  transposeIntervals: string;
  transposeDriveChain: boolean;
}


export interface RhythmArticulationCellState {
  restProbabilityPercent: number;
  tieProbabilityPercent: number;
}


export type RhythmArticulationRoleKey = "single" | "first" | "middle" | "last";


export interface RhythmArticulationProbabilityState {
  enabled: boolean;
  restProbabilityPercent: number;
  tieProbabilityPercent: number;
}


export type RhythmPositionArticulationState = Record<
  RhythmArticulationRoleKey,
  RhythmArticulationProbabilityState
>;


export interface RhythmArticulationBlendState {
  mode: RhythmArticulationBlendMode;
  manualWeight: number;
  fragmentWeight: number;
  sectionWeight: number;
  cycleWeight: number;
}


export interface RhythmArticulationNeighborState {
  playAfterPlayMultiplierPercent: number;
  restAfterRestMultiplierPercent: number;
  tieAfterTieMultiplierPercent: number;
}


export interface PatchRhythmArticulationState {
  open: boolean;
  seedPolicy: RhythmArticulationSeedPolicy;
  cells: Record<string, RhythmArticulationCellState>;
  tieOverAccentProbabilityPercent: number;
  restOverAccentProbabilityPercent: number;
  blend: RhythmArticulationBlendState;
  fragmentPosition: RhythmPositionArticulationState;
  sectionPosition: RhythmPositionArticulationState;
  cyclePosition: RhythmPositionArticulationState;
  neighbor: RhythmArticulationNeighborState;
}


export interface PatchSetupState {
  open: boolean;
  tab: SetupTab;
  autosaveEnabled: boolean;
  autosaveIntervalMs: number;
  autoloadRecentSession: boolean;
}


export interface PatchCycleTempoFluxState {
  enabled: boolean;
  minBpm: number;
  maxBpm: number;
  seed: number;
  curve: RatchetTimeCurveSpec;
}

export type PatchGeneratorSeedMode =
  | { type: "locked"; seed: number }
  | { type: "perCycle"; seed: number }
  | {
      type: "history";
      seed: number;
      history: U64SeedDecimal[];
      historyWeight: number;
      newSeedWeight: number;
      maxHistory: number;
    };

export type PatchEvolutionDirective = EvolutionDirective;

export type PatchGeneratorConfig =
  | {
      kind: "example";
      densityPercent: number;
      seedMode: PatchGeneratorSeedMode;
    }
  | {
      kind: "dumka";
      pattern: string;
      evolutionRate: number;
      driftLeash: number;
      densityFloor: number;
      densityCeiling: number;
      barlowTemperature: number;
      weightBarlowRemove: number;
      weightBarlowAdd: number;
      weightRotate: number;
      weightSyncopate: number;
      weightDesyncopate: number;
      weightFragment: number;
      weightConsolidate: number;
      fillComplexity: number;
      weightEuclid: number;
      euclidMaxRun: number;
      euclidInvert: number;
      euclidRestPolicy: "silent" | "tied";
      plan: PatchEvolutionDirective[];
      planLengthCycles: number;
      evolutionCurve: EvolutionCurve;
      seedMode: PatchGeneratorSeedMode;
    };

/**
 * Generator kinds this build persists and loads. An unknown kind must load
 * disabled with a warning, never silently execute as a known variant.
 */
export const KNOWN_GENERATOR_KINDS: readonly string[] = ["example", "dumka"];

export function hasUnknownGeneratorKind(candidate: unknown): boolean {
  return (
    isRecord(candidate) &&
    candidate.kind !== undefined &&
    !KNOWN_GENERATOR_KINDS.includes(String(candidate.kind))
  );
}


export interface ParallelTrackPatch {
  id: string;
  name: string;
  color: string;
  muted: boolean;
  soloed: boolean;
  tempoMode: TrackTempoMode;
  customTempoBpm: number;
  cycleLengthMode: TrackCycleLengthMode;
  customCycleBeats: number;
  sequencer: PatchSequencerState;
  generatorEnabled: boolean;
  generator: PatchGeneratorConfig;
  automation: AutomationSet;
  rhythm: PatchRhythmState;
  pitchShaper: PatchPitchShaperState;
  channelHocket: PatchChannelHocketState;
  seedPaths: SeedPath[];
  scoreSnapshot: unknown | null;
  /**
   * Playback relationship: `parallel` (free-run, default) or `trackFlow`
   * (sequential — a candidate the project Track Flow lane chooses between).
   */
  mode: TrackPlaybackMode;
  /**
   * Triggered Tracks config. `null` ⇒ continuous (default). When set, the track
   * is armed and launches when its trigger fires against `sourceTrackId`. The
   * backend normalizes the trigger graph (self/dangling/non-continuous-source
   * rejection); the frontend normalizer here only coerces malformed config to
   * safe values or to `null`.
   */
  trigger: TriggerConfig | null;
}


export interface ParallelProjectPatch {
  activeTrackId: string;
  global: {
    tempoBpm: number;
    cycleBeats: number;
    channelConflictPolicy: ChannelConflictPolicy;
    channelLogicMatrix: ChannelLogicMatrixEntry[];
    conflictPriority: string[];
    /**
     * The project's Track Flow boxes (binding decision #2: membership is
     * project-scoped, ordered `memberTrackIds`). A track is *boxed* iff it
     * appears in exactly one box's members, *parallel* otherwise. The legacy
     * per-track `mode` is derived from this during normalization.
     */
    trackFlowBoxes: TrackFlowBox[];
    synthEnabled: boolean;
    synthPrograms: SynthChannelProgram[];
    rhythmPlaybackEnabled: boolean;
    cycleTempoFlux: PatchCycleTempoFluxState;
  };
  tracks: ParallelTrackPatch[];
}


export interface SequencerPatchFlatState {
  app: typeof PATCH_APP_ID;
  schemaVersion: PatchSchemaVersion;
  savedAt: string;
  transport: {
    tempoBpm: number;
    synthEnabled: boolean;
    synthPrograms: SynthChannelProgram[];
    rhythmPlaybackEnabled: boolean;
    currentScoreId: string | null;
    cycleTempoFlux: PatchCycleTempoFluxState;
  };
  sequencer: PatchSequencerState;
  generatorEnabled: boolean;
  generator: PatchGeneratorConfig;
  automation: AutomationSet;
  rhythm: PatchRhythmState;
  pitchShaper: PatchPitchShaperState;
  channelHocket: PatchChannelHocketState;
  setup: PatchSetupState;
  ui: {
    synthPropertiesOpen: boolean;
    midiDebugOpen: boolean;
    midiDebugLimit: number;
    automationDebugOpen: boolean;
    automationDebugLimit: number;
    seedSetupOpen: boolean;
    seedSetupTab: SeedDialogTab;
    seedLogScope: SeedLogScope;
    automationOpen: boolean;
    timelineAutomationTargetIds: string[];
    channelLogicHelpOpen: boolean;
  };
  seedPaths: SeedPath[];
  scoreSnapshot: unknown | null;
}


export interface SequencerPatchDocument extends SequencerPatchFlatState {
  schemaVersion: typeof PATCH_SCHEMA_VERSION;
  project: ParallelProjectPatch;
  /** Non-persisted warnings produced during tolerant normalization. */
  loadWarnings?: string[];
}


export interface BoundaryPoint {
  id: string;
  afterBeat: number;
  changeProbability: number;
  weights: SubdivisionWeight[];
  jathiWeights: JathiWeight[];
  customSubdivision: CustomSubdivision | null;
  /** Per-boundary Jathi Bhedam selection. Optional/null => regular behavior. */
  jathiBhedam?: JathiBhedamSelection | null;
}


export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}


export function cloneWeights(weights: SubdivisionWeight[]): SubdivisionWeight[] {
  return canonicalizeGatiWeights(weights);
}


export function cloneJathiWeights(weights: JathiWeight[]): JathiWeight[] {
  return canonicalizeJathiWeights(weights);
}


export function clonePartCountWeights(
  weights: CustomPartCountChoice[] | undefined
): CustomPartCountChoice[] {
  return coalescePartCountWeights(weights ?? []);
}


export function coalescePartCountWeights(
  weights: CustomPartCountChoice[]
): CustomPartCountChoice[] {
  return canonicalizePartCountWeights(weights);
}


export function cloneCustomSubdivision(
  custom: CustomSubdivision | null | undefined
): CustomSubdivision | null {
  if (!custom) {
    return null;
  }
  const legacyDivisions = (custom.divisions ?? []).map((division) => ({
    gatiWeights: cloneWeights(division.gatiWeights),
  }));
  return {
    perBeatWeight: Number.isFinite(custom.perBeatWeight)
      ? Math.max(0, custom.perBeatWeight)
      : 0,
    equalPartsWeight: Number.isFinite(custom.equalPartsWeight)
      ? Math.max(0, custom.equalPartsWeight)
      : 1,
    partCountWeights:
      custom.partCountWeights?.length
        ? clonePartCountWeights(custom.partCountWeights)
        : legacyDivisions.length > 0
          ? [{ count: legacyDivisions.length, weight: 1 }]
          : clonePartCountWeights(DEFAULT_CUSTOM_PART_COUNT_WEIGHTS),
    partGatiWeights:
      custom.partGatiWeights?.length
        ? cloneWeights(custom.partGatiWeights)
        : legacyDivisions[0]?.gatiWeights
          ? cloneWeights(legacyDivisions[0].gatiWeights)
          : cloneWeights(DEFAULT_CUSTOM_PART_GATI_WEIGHTS),
    divisions: legacyDivisions,
    jathiWeights: cloneJathiWeights(custom.jathiWeights),
  };
}


export function cloneArbitraryTargets(
  weights: WeightedSubdivisionTarget[]
): WeightedSubdivisionTarget[] {
  return weights.map((w) => ({ ...w }));
}


export function cloneArbitraryClumps(weights: WeightedClumpLength[]): WeightedClumpLength[] {
  return weights.map((w) => ({ ...w }));
}


export function cloneRhythmSpeedWeights(weights: Record<string, number>): Record<string, number> {
  return { ...weights };
}


export function cloneNestedNumberRecord(
  weights: Record<number, Record<string, number>>
): Record<number, Record<string, number>> {
  const result: Record<number, Record<string, number>> = {};
  for (const [length, values] of Object.entries(weights)) {
    result[Number(length)] = { ...values };
  }
  return result;
}


export function cloneRatchetTimeCurvePoints(
  points: RatchetTimeCurvePoint[]
): RatchetTimeCurvePoint[] {
  return points.map((point) => ({ ...point }));
}


export function defaultRhythmArticulationProbabilityState(): RhythmArticulationProbabilityState {
  return {
    enabled: false,
    restProbabilityPercent: 0,
    tieProbabilityPercent: 0,
  };
}


export function defaultRhythmPositionArticulationState(): RhythmPositionArticulationState {
  return {
    single: defaultRhythmArticulationProbabilityState(),
    first: defaultRhythmArticulationProbabilityState(),
    middle: defaultRhythmArticulationProbabilityState(),
    last: defaultRhythmArticulationProbabilityState(),
  };
}


export function defaultRhythmArticulationBlendState(): RhythmArticulationBlendState {
  return {
    mode: "manualOverrides",
    manualWeight: 1,
    fragmentWeight: 1,
    sectionWeight: 1,
    cycleWeight: 1,
  };
}


export function defaultRhythmArticulationSeedPolicy(): RhythmArticulationSeedPolicy {
  return {
    seed: 0,
    followRhythmChance: 100,
  };
}


export function defaultRhythmArticulationNeighborState(): RhythmArticulationNeighborState {
  return {
    playAfterPlayMultiplierPercent: 100,
    restAfterRestMultiplierPercent: 100,
    tieAfterTieMultiplierPercent: 100,
  };
}


export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


export function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}


export function normalizeSeedValue(value: unknown, fallback = 0): number {
  return clamp(Math.round(numberValue(value, fallback)), 0, MAX_SAFE_SEED);
}

function normalizePatchGeneratorSeedMode(
  value: unknown,
  fallbackSeed: number
): PatchGeneratorSeedMode {
  const seedMode = isRecord(value) ? value : {};
  const seed = normalizeSeedValue(seedMode.seed, fallbackSeed);
  const type =
    seedMode.type === "perCycle" || seedMode.type === "history"
      ? seedMode.type
      : "locked";
  return type === "history"
    ? {
        type,
        seed,
        history: normalizeU64SeedDecimalList(seedMode.history),
        historyWeight: clamp(
          Math.round(numberValue(seedMode.historyWeight, 1)),
          0,
          999
        ),
        newSeedWeight: clamp(
          Math.round(numberValue(seedMode.newSeedWeight, 1)),
          0,
          999
        ),
        maxHistory: clamp(
          Math.round(numberValue(seedMode.maxHistory, 8)),
          1,
          64
        ),
      }
    : { type, seed };
}

export const DIRECTIVE_FAMILIES = [
  "barlowRemove",
  "barlowAdd",
  "rotate",
  "syncopate",
  "desyncopate",
  "fragment",
  "consolidate",
  "euclid",
  "stochastic",
] as const;

export const DIRECTIVE_PACINGS = ["perCycle", "linear", "easeInOut"] as const;

function isDirectiveFamily(value: unknown): value is EvolutionDirective["family"] {
  return DIRECTIVE_FAMILIES.includes(
    value as (typeof DIRECTIVE_FAMILIES)[number]
  );
}

function isDirectivePacing(
  value: unknown
): value is (typeof DIRECTIVE_PACINGS)[number] {
  return DIRECTIVE_PACINGS.includes(
    value as (typeof DIRECTIVE_PACINGS)[number]
  );
}

type NormalizedPatchMagnitude =
  | { ok: true; magnitude?: EvolutionDirective["magnitude"] }
  | { ok: false };

function normalizePatchDirectiveMagnitude(
  value: unknown,
  family: EvolutionDirective["family"],
  pacing: EvolutionDirective["pacing"]
): NormalizedPatchMagnitude {
  // Absence and the explicit default both project to absence. This preserves
  // the byte shape of every pre-perceptual operation-quota row.
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return { ok: false };
  if (value.mode === "operationQuota") return { ok: true };
  if (
    value.mode !== "perceptual" ||
    value.modelVersion !== "v1" ||
    family === "stochastic" ||
    pacing !== "perCycle" ||
    typeof value.targetMilli !== "number" ||
    !Number.isFinite(value.targetMilli) ||
    typeof value.toleranceMilli !== "number" ||
    !Number.isFinite(value.toleranceMilli) ||
    typeof value.maxOperations !== "number" ||
    !Number.isFinite(value.maxOperations)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    magnitude: {
      mode: "perceptual",
      modelVersion: "v1",
      targetMilli: clamp(
        Math.round(value.targetMilli),
        0,
        MAX_PERCEPTUAL_DISTANCE_MILLI
      ),
      toleranceMilli: clamp(
        Math.round(value.toleranceMilli),
        0,
        MAX_PERCEPTUAL_DISTANCE_MILLI
      ),
      maxOperations: clamp(
        Math.round(value.maxOperations),
        1,
        MAX_PERCEPTUAL_OPERATIONS
      ),
    },
  };
}

function nullablePercent(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : clamp(Math.round(numberValue(value, 0)), 0, 100);
}

function normalizeDirectiveOptions(value: unknown): EvolutionDirective["options"] {
  const options = isRecord(value) ? value : {};
  const hasDensityFloor = options.densityFloor !== null && options.densityFloor !== undefined;
  const hasDensityCeiling = options.densityCeiling !== null && options.densityCeiling !== undefined;
  const densityFloor = hasDensityFloor ? nullablePercent(options.densityFloor) : null;
  const densityCeiling = hasDensityCeiling ? nullablePercent(options.densityCeiling) : null;
  return {
    barlowTemperature: nullablePercent(options.barlowTemperature),
    fillComplexity: nullablePercent(options.fillComplexity),
    densityFloor,
    densityCeiling,
    euclidMaxRun:
      options.euclidMaxRun === null || options.euclidMaxRun === undefined
        ? null
        : clamp(Math.round(numberValue(options.euclidMaxRun, 1)), 1, 8),
    euclidInvert: nullablePercent(options.euclidInvert),
    euclidRestPolicy:
      options.euclidRestPolicy === "silent" || options.euclidRestPolicy === "tied"
        ? options.euclidRestPolicy
        : null,
    rotateDirection: options.rotateDirection === "later" ? "later" : "earlier",
  };
}

export interface NormalizeEvolutionPlanResult {
  plan: PatchEvolutionDirective[];
  droppedUnknownFamilies: number;
  droppedOverlaps: number;
  droppedMalformed: number;
  droppedExcess: number;
  disabledOverBudget: number;
}

/**
 * Tolerantly projects hand-edited v1 plan data onto the strict engine shape.
 * Rows are sorted by authored order and assigned dense order values. Stable,
 * unique positive IDs survive; only malformed/duplicate IDs are reallocated.
 * Later overlaps in one family are dropped so enabling an audition toggle
 * cannot turn a loaded patch into an invalid engine request.
 */
export function normalizePatchEvolutionPlan(value: unknown): NormalizeEvolutionPlanResult {
  let droppedUnknownFamilies = 0;
  let droppedOverlaps = 0;
  let droppedMalformed = 0;
  let disabledOverBudget = 0;
  const source = Array.isArray(value) ? value : [];
  const droppedExcess = Math.max(0, source.length - MAX_EVOLUTION_DIRECTIVES);
  const candidates = source
    .slice(0, MAX_EVOLUTION_DIRECTIVES)
    .flatMap((raw, sourceIndex) => {
      if (!isRecord(raw)) {
        droppedMalformed += 1;
        return [];
      }
      if (!isDirectiveFamily(raw.family)) {
        droppedUnknownFamilies += 1;
        return [];
      }
      // Missing pacing is the v1 compatibility path: every pre-smoothing
      // patch keeps the historical per-cycle quota schedule. An explicitly
      // malformed value cannot be guessed safely, so drop the complete row
      // and surface the ordinary malformed-directive warning. Stochastic is
      // a probability gate rather than a target transition and therefore has
      // no linear/eased pacing semantics.
      const pacing = raw.pacing === undefined ? "perCycle" : raw.pacing;
      if (
        !isDirectivePacing(pacing) ||
        (raw.family === "stochastic" && pacing !== "perCycle")
      ) {
        droppedMalformed += 1;
        return [];
      }
      const magnitude = normalizePatchDirectiveMagnitude(
        raw.magnitude,
        raw.family,
        pacing
      );
      if (!magnitude.ok) {
        droppedMalformed += 1;
        return [];
      }
      const rawOptions = isRecord(raw.options) ? raw.options : {};
      const hasDensityFloor =
        rawOptions.densityFloor !== null && rawOptions.densityFloor !== undefined;
      const hasDensityCeiling =
        rawOptions.densityCeiling !== null && rawOptions.densityCeiling !== undefined;
      if (hasDensityFloor !== hasDensityCeiling) {
        droppedMalformed += 1;
        return [];
      }
      if (
        hasDensityFloor &&
        numberValue(rawOptions.densityFloor, 0) >
          numberValue(rawOptions.densityCeiling, 100)
      ) {
        droppedMalformed += 1;
        return [];
      }
      const fromCycle = clamp(
        Math.round(numberValue(raw.fromCycle, 1)),
        1,
        Number.MAX_SAFE_INTEGER
      );
      const toCycle = clamp(
        Math.round(numberValue(raw.toCycle, fromCycle)),
        fromCycle,
        Number.MAX_SAFE_INTEGER
      );
      const scope = isRecord(raw.scope)
        ? {
            startBeat: clamp(
              Math.round(numberValue(raw.scope.startBeat, 0)),
              0,
              0xffffffff
            ),
            lenBeats: clamp(
              Math.round(numberValue(raw.scope.lenBeats, 1)),
              1,
              0xffffffff
            ),
          }
        : null;
      return [
        {
          sourceIndex,
          sourceOrder: clamp(
            Math.round(numberValue(raw.order, sourceIndex)),
            0,
            0xffffffff
          ),
          // IDs salt deterministic draws. Never clamp an unsafe number onto a
          // different valid identity; repair it through fresh-ID allocation.
          sourceId:
            typeof raw.id === "number" &&
            Number.isSafeInteger(raw.id) &&
            raw.id > 0
              ? raw.id
              : 0,
          enabled: boolValue(raw.enabled, true),
          fromCycle,
          toCycle,
          family: raw.family,
          pacing,
          ...(magnitude.magnitude ? { magnitude: magnitude.magnitude } : {}),
          intensity: clamp(Math.round(numberValue(raw.intensity, 25)), 0, 100),
          scope,
          options: normalizeDirectiveOptions(raw.options),
        },
      ];
    })
    .sort((a, b) => a.sourceOrder - b.sourceOrder || a.sourceIndex - b.sourceIndex);

  const accepted: typeof candidates = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some(
      (prior) =>
        prior.family === candidate.family &&
        candidate.fromCycle <= prior.toCycle &&
        prior.fromCycle <= candidate.toCycle
    );
    if (overlaps) {
      droppedOverlaps += 1;
    } else {
      accepted.push(candidate);
    }
  }

  // Keep authored data editable, but admit enabled perceptual rows only while
  // their complete lifetime score reservation fits. Authored order is the
  // deterministic priority; disabled rows reserve no engine work.
  let admittedWork = 0n;
  const budgeted = accepted.map((candidate) => {
    const rowWork = perceptualDirectiveScoringWork(candidate);
    if (
      rowWork > 0n &&
      admittedWork + rowWork > BigInt(MAX_PERCEPTUAL_SCORING_WORK)
    ) {
      disabledOverBudget += 1;
      return { ...candidate, enabled: false };
    }
    admittedWork += rowWork;
    return candidate;
  });

  const validIds = budgeted
    .map((directive) => directive.sourceId)
    .filter((id) => id > 0);
  let nextId = Math.max(0, ...validIds) + 1;
  const usedIds = new Set<number>();
  const allocateId = (): number => {
    if (nextId > Number.MAX_SAFE_INTEGER) nextId = 1;
    while (usedIds.has(nextId)) nextId += 1;
    if (nextId > Number.MAX_SAFE_INTEGER) {
      nextId = 1;
      while (usedIds.has(nextId)) nextId += 1;
    }
    const allocated = nextId;
    nextId += 1;
    return allocated;
  };
  return {
    plan: budgeted.map((directive, order) => {
      let id = directive.sourceId;
      if (id <= 0 || usedIds.has(id)) {
        id = allocateId();
      }
      usedIds.add(id);
      return {
        id,
        order,
        enabled: directive.enabled,
        fromCycle: directive.fromCycle,
        toCycle: directive.toCycle,
        family: directive.family,
        pacing: directive.pacing,
        ...(directive.magnitude ? { magnitude: directive.magnitude } : {}),
        intensity: directive.intensity,
        scope: directive.scope,
        options: directive.options,
      };
    }),
    droppedUnknownFamilies,
    droppedOverlaps,
    droppedMalformed,
    droppedExcess,
    disabledOverBudget,
  };
}

function evolutionPlanLoadWarnings(generatorCandidates: unknown[]): string[] {
  let unknown = false;
  let overlaps = false;
  let malformed = false;
  let excess = false;
  let overBudget = false;
  for (const candidate of generatorCandidates) {
    if (!isRecord(candidate) || candidate.kind !== "dumka") continue;
    const normalized = normalizePatchEvolutionPlan(candidate.plan);
    unknown ||= normalized.droppedUnknownFamilies > 0;
    overlaps ||= normalized.droppedOverlaps > 0;
    malformed ||= normalized.droppedMalformed > 0;
    excess ||= normalized.droppedExcess > 0;
    overBudget ||= normalized.disabledOverBudget > 0;
  }
  const warnings: string[] = [];
  if (unknown) {
    warnings.push("Unknown Dum-Ka evolution operator families were dropped.");
  }
  if (overlaps) {
    warnings.push("Overlapping Dum-Ka evolution directives were dropped.");
  }
  if (malformed) {
    warnings.push("Malformed Dum-Ka evolution directives were dropped.");
  }
  if (excess) {
    warnings.push(
      `Dum-Ka evolution plans were limited to ${MAX_EVOLUTION_DIRECTIVES} directives.`
    );
  }
  if (overBudget) {
    warnings.push("Over-budget Dum-Ka perceptual directives were disabled.");
  }
  return warnings;
}

export function normalizePatchGeneratorConfig(
  value: unknown,
  fallbackSeed = FALLBACK_GLOBAL_SEED
): PatchGeneratorConfig {
  const candidate = isRecord(value) ? value : {};
  if (candidate.kind === "dumka") {
    const normalizedPlan = normalizePatchEvolutionPlan(candidate.plan).plan;
    const normalizedCurve = normalizeEvolutionCurve(candidate.evolutionCurve);
    return {
      kind: "dumka",
      pattern: normalizeDumkaPattern(candidate.pattern),
      // Round before clamping: these cross the wire as Rust u32 fields, and
      // serde rejects fractional or negative numbers outright. A hand-edited
      // patch must load to a value the engine will actually accept.
      evolutionRate: clamp(Math.round(numberValue(candidate.evolutionRate, 0)), 0, 100),
      driftLeash: clamp(Math.round(numberValue(candidate.driftLeash, 25)), 0, 100),
      densityFloor: Math.min(
        clamp(Math.round(numberValue(candidate.densityFloor, 0)), 0, 100),
        clamp(Math.round(numberValue(candidate.densityCeiling, 100)), 0, 100)
      ),
      densityCeiling: clamp(
        Math.round(numberValue(candidate.densityCeiling, 100)),
        0,
        100
      ),
      barlowTemperature: clamp(
        Math.round(numberValue(candidate.barlowTemperature, 0)),
        0,
        100
      ),
      weightBarlowRemove: clamp(
        Math.round(numberValue(candidate.weightBarlowRemove, 3)),
        0,
        100
      ),
      weightBarlowAdd: clamp(
        Math.round(numberValue(candidate.weightBarlowAdd, 3)),
        0,
        100
      ),
      weightRotate: clamp(Math.round(numberValue(candidate.weightRotate, 2)), 0, 100),
      weightSyncopate: clamp(
        Math.round(numberValue(candidate.weightSyncopate, 0)),
        0,
        100
      ),
      weightDesyncopate: clamp(
        Math.round(numberValue(candidate.weightDesyncopate, 0)),
        0,
        100
      ),
      weightFragment: clamp(
        Math.round(numberValue(candidate.weightFragment, 0)),
        0,
        100
      ),
      weightConsolidate: clamp(
        Math.round(numberValue(candidate.weightConsolidate, 0)),
        0,
        100
      ),
      fillComplexity: clamp(
        Math.round(numberValue(candidate.fillComplexity, 0)),
        0,
        100
      ),
      weightEuclid: clamp(Math.round(numberValue(candidate.weightEuclid, 0)), 0, 100),
      euclidMaxRun: clamp(Math.round(numberValue(candidate.euclidMaxRun, 1)), 1, 8),
      euclidInvert: clamp(Math.round(numberValue(candidate.euclidInvert, 0)), 0, 100),
      euclidRestPolicy: candidate.euclidRestPolicy === "silent" ? "silent" : "tied",
      plan: normalizedPlan,
      evolutionCurve: normalizedCurve.curve,
      planLengthCycles: clamp(
        Math.round(numberValue(candidate.planLengthCycles, 0)),
        0,
        0xffffffff
      ),
      seedMode: normalizePatchGeneratorSeedMode(candidate.seedMode, fallbackSeed),
    };
  }
  const raw =
    candidate.kind === undefined || candidate.kind === "example"
      ? candidate
      : {};
  return {
    kind: "example",
    densityPercent: clamp(
      Math.round(numberValue(raw.densityPercent, 100)),
      0,
      100
    ),
    seedMode: normalizePatchGeneratorSeedMode(raw.seedMode, fallbackSeed),
  };
}


export function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}


export function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}


export function boundaryIdForAfterBeat(afterBeat: number): string {
  return `boundary-after-${afterBeat}`;
}


export function normalizeAutomationTime(value: unknown): { numer: number; denom: number } {
  const source = isRecord(value) ? value : {};
  const denom = clamp(
    Math.round(numberValue(source.denom, 1)),
    1,
    Number.MAX_SAFE_INTEGER
  );
  const numer = clamp(
    Math.round(numberValue(source.numer, 0)),
    0,
    denom
  );
  return { numer, denom };
}


export function normalizeAutomationValue(value: unknown): AutomationSet["tracks"][number]["curves"][number]["points"][number]["value"] {
  if (!isRecord(value)) {
    return { type: "number", value: 0 };
  }
  if (value.type === "bool") {
    return { type: "bool", value: boolValue(value.value, false) };
  }
  if (value.type === "text") {
    return { type: "text", value: stringValue(value.value, "") };
  }
  return { type: "number", value: numberValue(value.value, 0) };
}


export function normalizeAutomationSegmentCurve(value: unknown): AutomationSegmentCurve | null {
  if (!isRecord(value)) return null;
  const kind: AutomationSegmentCurveKind =
    value.kind === "hold" ||
    value.kind === "smooth" ||
    value.kind === "easeIn" ||
    value.kind === "easeOut" ||
    value.kind === "easeInOut" ||
    value.kind === "exponential"
      ? value.kind
      : "linear";
  return {
    kind,
    amount: clamp(numberValue(value.amount, 1), 0, 1),
  };
}


export function normalizeAutomationGraphRange(value: unknown): AutomationGraphRangeData | null {
  if (!isRecord(value)) return null;
  const min = Number(value.min);
  const max = Number(value.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max };
}


export function normalizeAutomationSet(value: unknown): AutomationSet {
  if (!isRecord(value)) {
    return cloneAutomationSet(DEFAULT_AUTOMATION_SET);
  }
  const lengthCycles = clamp(
    Math.round(numberValue(value.lengthCycles, 1)),
    1,
    MAX_AUTOMATION_LENGTH_CYCLES
  );
  const markers = Array.isArray(value.markers)
    ? value.markers.flatMap((marker, markerIndex) => {
        if (!isRecord(marker)) return [];
        return [
          {
            id: stringValue(marker.id, `automation-marker-${markerIndex}`),
            time: normalizeAutomationTime(marker.time),
            label: stringValue(marker.label, ""),
          },
        ];
      })
    : [];
  // Anchors mean "this point follows that marker" (the sampler evaluates
  // them), so an anchorId that names no marker is dangling data: strip it to
  // the stored time. This also heals the vestigial `automation-start`/`-end`
  // sentinels that older default lanes carried before anchors were evaluated.
  const markerIds = new Set(markers.map((marker) => marker.id));
  const tracks = Array.isArray(value.tracks)
    ? value.tracks.flatMap((track, trackIndex) => {
        if (!isRecord(track)) return [];
        const target = stringValue(track.target, "").trim();
        if (!target) return [];
        const curves = Array.isArray(track.curves)
          ? track.curves.flatMap((curve, curveIndex) => {
              if (!isRecord(curve)) return [];
              const interpolation: "hold" | "linear" | "smooth" =
                curve.interpolation === "hold" ||
                curve.interpolation === "linear" ||
                curve.interpolation === "smooth"
                  ? curve.interpolation
                  : "linear";
              const points = Array.isArray(curve.points)
                ? curve.points.flatMap((point, pointIndex) => {
                    if (!isRecord(point)) return [];
                    return [
                      {
                        id:
                          typeof point.id === "string"
                            ? point.id
                            : `automation-point-${trackIndex}-${curveIndex}-${pointIndex}`,
                        time: normalizeAutomationTime(point.time),
                        value: normalizeAutomationValue(point.value),
                        anchorId:
                          typeof point.anchorId === "string" &&
                          markerIds.has(point.anchorId)
                            ? point.anchorId
                            : null,
                        outCurve: normalizeAutomationSegmentCurve(point.outCurve),
                      },
                    ];
                  })
                : [];
              return [
                {
                  id: stringValue(
                    curve.id,
                    `automation-curve-${trackIndex}-${curveIndex}`
                  ),
                  enabled: boolValue(curve.enabled, true),
                  interpolation,
                  points,
                },
              ];
            })
          : [];
        const combine: "add" | "multiply" | "replace" =
          track.combine === "add" || track.combine === "multiply"
            ? track.combine
            : "replace";
        return [
          {
            id: stringValue(track.id, `automation-track-${trackIndex}`),
            target,
            enabled: boolValue(track.enabled, true),
            combine,
            graphRange: normalizeAutomationGraphRange(track.graphRange),
            curves,
          },
        ];
      })
    : [];
  return { lengthCycles, markers, tracks };
}


export function cloneAutomationSet(value: AutomationSet): AutomationSet {
  return normalizeAutomationSet(value);
}


export interface NeutralPatchOptions {
  seed?: number;
  savedAt?: string;
  scoreName?: string;
  trackName?: string;
  trackId?: string;
  trackColor?: string;
  tempoBpm?: number;
  cycleBeats?: number;
  setupPreferences?: Partial<Omit<PatchSetupState, "open" | "tab">>;
}


export function createNeutralPatchDocument(
  options: NeutralPatchOptions = {}
): SequencerPatchDocument {
  const savedAt = options.savedAt ?? new Date().toISOString();
  const seed = normalizeSeedValue(options.seed, FALLBACK_GLOBAL_SEED);
  const tempoBpm = clamp(numberValue(options.tempoBpm, NEUTRAL_TEMPO_BPM), 20, 400);
  const cycleBeats = clamp(
    Math.round(numberValue(options.cycleBeats, NEUTRAL_CYCLE_BEATS)),
    1,
    64
  );
  const scoreName = options.scoreName ?? options.trackName ?? NEUTRAL_SCORE_NAME;
  const trackId = normalizeTrackId(options.trackId, DEFAULT_PARALLEL_TRACK_ID);
  const trackName = options.trackName ?? "Track 1";
  const trackColor = stringValue(options.trackColor, DEFAULT_PARALLEL_TRACK_COLOR);
  const synthPrograms = synthProgramsToRequest(normalizeSynthPrograms(NEUTRAL_SYNTH_VOICES));
  const setupPreferences = options.setupPreferences ?? {};
  const cycleTempoFlux = normalizeCycleTempoFlux({
    enabled: false,
    minBpm: tempoBpm,
    maxBpm: tempoBpm,
    seed: 0,
    curve: {
      enabled: true,
      points: cloneRatchetTimeCurvePoints(DEFAULT_RATCHET_TIME_CURVE_POINTS),
      variance: 0,
      interpolate: true,
      interpolationMin: 0,
      interpolationMax: 1,
      choices: [],
    },
  });
  const ratchetSpec = normalizeRatchetSpec({
    seed: 0,
    probability: 0,
    temporalEasingProbability: 0,
    // New sessions start on the V2 model with the designed defaults
    // (tempo-elastic band, short-biased placement).
    band: { ...DEFAULT_RATCHET_BAND },
    placement: {
      ...DEFAULT_RATCHET_PLACEMENT,
      spanPosition: { ...DEFAULT_RATCHET_PLACEMENT.spanPosition },
      edgeWeights: { ...DEFAULT_RATCHET_PLACEMENT.edgeWeights },
      phraseWeights: [],
    },
    fill: null,
    timeCurve: {
      enabled: true,
      points: cloneRatchetTimeCurvePoints(DEFAULT_RATCHET_TIME_CURVE_POINTS),
      variance: 0,
      interpolate: true,
      interpolationMin: 0,
      interpolationMax: 1,
      choices: [],
    },
  });
  const ornamentSpec = normalizeOrnamentSpec({
    seed: 0,
    grace: {
      enabled: false,
      placementWeights: { beforeBeat: 0, onBeat: 0 },
      probability: 0,
      countWeights: { single: 0, double: 0, triple: 0 },
      cooldown: 0,
      duration: 1,
      allowRests: false,
      velocity: { ...DEFAULT_ORNAMENT_VELOCITY, enabled: false },
    },
    delay: {
      enabled: false,
      probability: 0,
      min: 0,
      max: 0,
      tuplets: [],
    },
  });

  const flat: SequencerPatchFlatState = {
    app: PATCH_APP_ID,
    schemaVersion: PATCH_SCHEMA_VERSION,
    savedAt,
    transport: {
      tempoBpm,
      synthEnabled: false,
      synthPrograms,
      rhythmPlaybackEnabled: true,
      currentScoreId: null,
      cycleTempoFlux,
    },
    sequencer: {
      scoreSetupOpen: false,
      randomize: normalizeLegacyRandomizeSettings(undefined),
      probabilityOpen: false,
      boundariesOpen: false,
      maxSectionsHelpOpen: false,
      name: scoreName,
      cycleBeats,
      initialWeights: cloneWeights(NEUTRAL_INITIAL_WEIGHTS),
      initialJathiWeights: cloneJathiWeights(NEUTRAL_JATHI_WEIGHTS),
      initialJathiBhedam: null,
      initialCustomSubdivision: null,
      boundaries: [],
      selectedBoundaryAfterBeat: null,
      sectionCountWeights: NEUTRAL_SECTION_COUNTS.map((weight) => ({ ...weight })),
      seedMode: "perCycle",
      seed,
      historySeeds: [],
      historyWeight: 1,
      newSeedWeight: 1,
      maxHistory: 8,
      newSeedChance: DEFAULT_NEW_SEED_CHANCE,
      holdChance: DEFAULT_HOLD_CHANCE,
      blendCycles: DEFAULT_BLEND_CYCLES,
      singleParameterRhythmicModulation: false,
      pitch: NEUTRAL_PITCH,
      velocity: NEUTRAL_VELOCITY,
      accent: {
        beatStart: { min: 0, max: 0 },
        sectionStartExtra: { min: 0, max: 0 },
        jathiStart: { min: 0, max: 0 },
        jathiMode: "overrideGati",
      },
      userPreviewCycle: 0,
    },
    generatorEnabled: true,
    generator: normalizePatchGeneratorConfig(
      { kind: "example", densityPercent: 100, seedMode: { type: "locked", seed } },
      seed
    ),
    automation: cloneAutomationSet(DEFAULT_AUTOMATION_SET),
    rhythm: {
      rhythmOpen: false,
      rhythmTab: "patterns",
      rhythmLength: 4,
      rhythmOrder: "first",
      rhythmExtrapolateFrom: 4,
      rhythmExtrapolationStrategy: "hybridTransport",
      rhythmMaterializeMode: "replace",
      copyTargetMode: "selected",
      copySelectedTargets: [],
      passageInput: "",
      passageStrategy: "hybridVocabulary",
      passageOrder: "first",
      passageFitStrategy: "hybridTransport",
      passageTargetMode: "selected",
      passageSelectedTargets: [],
      passageHelpOpen: false,
      selectedKeysByLength: {},
      speedEditorKind: "gati",
      speedEditorValue: 4,
      rhythmSeed: 0,
      rhythmSeedBehavior: "followGlobal",
      historySeeds: [],
      historyWeight: 1,
      newSeedWeight: 1,
      maxHistory: 8,
      newSeedChance: DEFAULT_NEW_SEED_CHANCE,
      holdChance: DEFAULT_HOLD_CHANCE,
      blendCycles: DEFAULT_BLEND_CYCLES,
      fallback: 0,
      fallbackMode: "static",
      fallbackWeightsByLength: {},
      entryWeightsByLength: {},
      weights: {},
      articulation: {
        open: false,
        seedPolicy: defaultRhythmArticulationSeedPolicy(),
        cells: {},
        tieOverAccentProbabilityPercent: 0,
        restOverAccentProbabilityPercent: 0,
        blend: defaultRhythmArticulationBlendState(),
        fragmentPosition: defaultRhythmPositionArticulationState(),
        sectionPosition: defaultRhythmPositionArticulationState(),
        cyclePosition: defaultRhythmPositionArticulationState(),
        neighbor: defaultRhythmArticulationNeighborState(),
      },
      arbitrarySubdivision: {
        probabilityPercent: 0,
        targets: [],
        clumpLengths: [],
        allowTrivialPattern: false,
        patternSource: "markov",
        poolWeightsByLength: {},
        poolEditorLength: 4,
      },
      beatLocks: {
        open: false,
        seed: 0,
        locks: [],
      },
      shapeGroups: {
        open: false,
        seed: 0,
        groups: [],
      },
      speedSubdivisionWeights: cloneRhythmSpeedWeights(DEFAULT_RHYTHM_SPEED_WEIGHTS),
      ratchet: {
        enabled: false,
        spec: ratchetSpec,
      },
      ornament: {
        enabled: false,
        tab: "grace",
        spec: ornamentSpec,
      },
      playbackChains: [],
      resolvedSeed: null,
    },
    pitchShaper: {
      open: false,
      enabled: false,
      tab: "collection",
      order: "first",
      collectionId: "chromatic",
      collectionTransposition: 0,
      rangeLow: DEFAULT_PITCH_RANGE_LOW,
      rangeHigh: DEFAULT_PITCH_RANGE_HIGH,
      states: [],
      selectedKeys: [],
      weights: {},
      fallback: 0,
      fallbackMode: "static",
      fallbackWeights: {},
      entryWeights: {},
      seed: 0,
      seedBehavior: "followGlobal",
      historySeeds: [],
      historyWeight: 1,
      newSeedWeight: 1,
      maxHistory: 8,
      newSeedChance: DEFAULT_NEW_SEED_CHANCE,
      holdChance: DEFAULT_HOLD_CHANCE,
      blendCycles: DEFAULT_BLEND_CYCLES,
      boundary: { low: 0, high: 127, modulo: 12, policy: "wrap" },
      ratchetMode: "sourcePitch",
      wholeProbabilityPercent: 0,
      perHitProbabilityPercent: 0,
      preserveFirstHit: true,
      ornamentMode: "sourcePitch",
      ornamentWholeProbabilityPercent: 0,
      ornamentPerGraceProbabilityPercent: 0,
      gracePitchEnabled: false,
      gracePitchProbabilityPercent: 0,
      gracePitchScope: "wholeCluster",
      gracePitchPitches: [],
      graceTransposeEnabled: false,
      graceTransposeProbabilityPercent: 0,
      graceTransposeScope: "wholeCluster",
      graceTransposeUpWeight: 0,
      graceTransposeDownWeight: 0,
      graceTransposeIntervals: [],
      transposeEnabled: false,
      transposeProbabilityPercent: 0,
      transposeMode: "singleNote",
      transposeIntervals: "",
      transposeDriveChain: false,
    },
    channelHocket: {
      open: false,
      enabled: false,
      outputChannel: 1,
      order: "first",
      channels: [],
      weights: {},
      fallback: 1,
      fallbackWeights: {},
      entryWeights: {},
      seed: 0,
      seedBehavior: "followGlobal",
      historySeeds: [],
      historyWeight: 1,
      newSeedWeight: 1,
      maxHistory: 8,
      newSeedChance: DEFAULT_NEW_SEED_CHANCE,
      holdChance: DEFAULT_HOLD_CHANCE,
      blendCycles: DEFAULT_BLEND_CYCLES,
      ratchetMode: "sourceChannel",
      wholeProbabilityPercent: 0,
      perHitProbabilityPercent: 0,
      preserveFirstHit: true,
      ornamentMode: "sourceChannel",
      ornamentWholeProbabilityPercent: 0,
      ornamentPerGraceProbabilityPercent: 0,
      accentRules: [],
      positionRules: [],
      assignMode: "markov",
      euclid: defaultEuclidChannelState(),
    },
    setup: {
      open: false,
      tab: "audio",
      autosaveEnabled: setupPreferences.autosaveEnabled ?? DEFAULT_AUTOSAVE_ENABLED,
      autosaveIntervalMs: normalizeAutosaveIntervalMs(
        setupPreferences.autosaveIntervalMs
      ),
      autoloadRecentSession: setupPreferences.autoloadRecentSession ?? true,
    },
    ui: {
      synthPropertiesOpen: false,
      midiDebugOpen: false,
      midiDebugLimit: DEFAULT_MIDI_DEBUG_LIMIT,
      automationDebugOpen: false,
      automationDebugLimit: DEFAULT_AUTOMATION_DEBUG_LIMIT,
      seedSetupOpen: false,
      seedSetupTab: "global",
      seedLogScope: "all",
      automationOpen: false,
      timelineAutomationTargetIds: [],
      channelLogicHelpOpen: false,
    },
    seedPaths: [],
    scoreSnapshot: null,
  };

  const project: ParallelProjectPatch = {
    activeTrackId: trackId,
    global: {
      tempoBpm,
      cycleBeats,
      channelConflictPolicy: "priorityOrder",
      channelLogicMatrix: [],
      conflictPriority: [trackId],
      trackFlowBoxes: [],
      synthEnabled: false,
      synthPrograms,
      rhythmPlaybackEnabled: true,
      cycleTempoFlux,
    },
    tracks: [
      {
        id: trackId,
        name: trackName,
        color: trackColor,
        muted: false,
        soloed: false,
        tempoMode: "global",
        customTempoBpm: tempoBpm,
        cycleLengthMode: "global",
        customCycleBeats: cycleBeats,
        sequencer: flat.sequencer,
        generatorEnabled: flat.generatorEnabled,
        generator: flat.generator,
        automation: cloneAutomationSet(flat.automation),
        rhythm: flat.rhythm,
        pitchShaper: flat.pitchShaper,
        channelHocket: flat.channelHocket,
        seedPaths: [],
        scoreSnapshot: null,
        mode: "parallel",
        trigger: null,
      },
    ],
  };

  return withProjectState(flat, project);
}


export function rhythmEntryWeightKey(
  length: number,
  order: MarkovOrder,
  stateKeys: string[]
): string {
  return `${length}:${order}:${stateKeys.join(">")}`;
}


export function pitchEntryWeightKey(order: MarkovOrder, states: number[]): string {
  return `${order}:${states.join(">")}`;
}


export function channelEntryWeightKey(order: MarkovOrder, channels: number[]): string {
  return `${order}:${channels.join(">")}`;
}


export function normalizeMidiDebugLimit(value: unknown): number {
  const limit = Math.round(numberValue(value, DEFAULT_MIDI_DEBUG_LIMIT));
  return MIDI_DEBUG_LIMIT_OPTIONS.includes(
    limit as (typeof MIDI_DEBUG_LIMIT_OPTIONS)[number]
  )
    ? limit
    : DEFAULT_MIDI_DEBUG_LIMIT;
}


export function normalizeAutomationDebugLimit(value: unknown): number {
  const limit = Math.round(numberValue(value, DEFAULT_AUTOMATION_DEBUG_LIMIT));
  return AUTOMATION_DEBUG_LIMIT_OPTIONS.includes(
    limit as (typeof AUTOMATION_DEBUG_LIMIT_OPTIONS)[number]
  )
    ? limit
    : DEFAULT_AUTOMATION_DEBUG_LIMIT;
}


export function readAutosaveEnabledPreference(): boolean {
  try {
    const value = window.localStorage.getItem(AUTOSAVE_PREF_STORAGE_KEY);
    if (value === "false" || value === "0") return false;
    if (value === "true" || value === "1") return true;
  } catch {
    // Fall through to the product default.
  }
  return DEFAULT_AUTOSAVE_ENABLED;
}


export function normalizeSetupTab(value: unknown): SetupTab {
  return value === "midi" || value === "files" ? value : "audio";
}


export function normalizeSeedDialogTab(value: unknown): SeedDialogTab {
  return value === "global" ||
    value === "rhythm" ||
    value === "pitch" ||
    value === "channel" ||
    value === "ratchet" ||
    value === "log"
    ? value
    : "global";
}


export function normalizeSeedLogScope(value: unknown): SeedLogScope {
  return value === "global" ||
    value === "rhythm" ||
    value === "pitch" ||
    value === "channel" ||
    value === "paths"
    ? value
    : "all";
}


export function normalizeSeedPathWildcardDomain(value: unknown): SeedPathWildcardDomain | null {
  return value === "global" ||
    value === "rhythm" ||
    value === "articulation" ||
    value === "pitch" ||
    value === "channel" ||
    value === "ratchet"
    ? value
    : null;
}


export function normalizeSeedPathTracePoint(value: unknown): SeedPathTracePoint | null {
  if (!isRecord(value)) return null;
  const cycle = Math.max(0, Math.round(numberValue(value.cycle, 0)));
  const domain = stringValue(value.domain, "unknown").slice(0, 48);
  const label = stringValue(value.label, domain).slice(0, 96);
  return {
    cycle,
    domain,
    label,
    seed: normalizeU64SeedDecimal(value.seed) ?? "0",
    baseSeed:
      value.baseSeed === null || value.baseSeed === undefined
        ? null
        : (normalizeU64SeedDecimal(value.baseSeed) ?? "0"),
    source: stringValue(value.source, "unknown").slice(0, 48),
    historyBefore: normalizeU64SeedDecimalList(value.historyBefore),
    historyAfter: normalizeU64SeedDecimalList(value.historyAfter),
    parallelTrackIndex:
      value.parallelTrackIndex === null || value.parallelTrackIndex === undefined
        ? null
        : Math.max(0, Math.round(numberValue(value.parallelTrackIndex, 0))),
    trackId: typeof value.trackId === "string" ? value.trackId : null,
    recordedAt: stringValue(value.recordedAt, new Date().toISOString()),
  };
}


export function normalizeSeedPaths(value: unknown): SeedPath[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id, `seed-path-${index}`);
    const wildcardRules = Array.isArray(item.wildcardRules)
      ? item.wildcardRules.flatMap((rule): SeedPathWildcardRule[] => {
          if (!isRecord(rule)) return [];
          const domain = normalizeSeedPathWildcardDomain(rule.domain);
          if (!domain) return [];
          const cycle =
            rule.cycle === null || rule.cycle === undefined
              ? null
              : Math.max(0, Math.round(numberValue(rule.cycle, 0)));
          const trackId = typeof rule.trackId === "string" ? rule.trackId : null;
          return [{ domain, cycle, trackId }];
        })
      : [];
    const trace = Array.isArray(item.trace)
      ? item.trace.flatMap((point) => {
          const normalized = normalizeSeedPathTracePoint(point);
          return normalized ? [normalized] : [];
        })
      : [];
    return [
      {
        id,
        name: stringValue(item.name, `Seed path ${index + 1}`),
        createdAt: stringValue(item.createdAt, new Date().toISOString()),
        sourcePathId:
          typeof item.sourcePathId === "string" ? item.sourcePathId : null,
        immutable: true as const,
        wildcardRules,
        trace,
      },
    ];
  });
}


export function normalizeAutosaveIntervalMs(value: unknown): number {
  return clamp(
    Math.round(numberValue(value, DEFAULT_AUTOSAVE_INTERVAL_MS)),
    MIN_AUTOSAVE_INTERVAL_MS,
    MAX_AUTOSAVE_INTERVAL_MS
  );
}


export function normalizeTrackTempoMode(value: unknown): TrackTempoMode {
  return value === "custom" ? "custom" : "global";
}

/** Legacy patches predate Track Flow, so an absent/unknown mode is `parallel`. */
export function normalizeTrackPlaybackMode(value: unknown): TrackPlaybackMode {
  return value === "trackFlow" ? "trackFlow" : "parallel";
}


export function normalizeTrackCycleLengthMode(value: unknown): TrackCycleLengthMode {
  return value === "custom" ? "custom" : "global";
}


export function normalizeChannelConflictPolicy(value: unknown): ChannelConflictPolicy {
  return value === "forceOn" ||
    value === "forceOff" ||
    value === "or" ||
    value === "randomOne" ||
    value === "alternate" ||
    value === "priorityOrder" ||
    value === "xor" ||
    value === "xnor" ||
    value === "and" ||
    value === "nand" ||
    value === "nor" ||
    value === "even" ||
    value === "odd" ||
    value === "oneHigh" ||
    value === "oneLow" ||
    value === "majority" ||
    value === "minority"
    ? value
    : "allowAll";
}


export function channelLogicPairKey(trackAId: string, trackBId: string): string {
  return trackAId < trackBId
    ? `${trackAId}\u0000${trackBId}`
    : `${trackBId}\u0000${trackAId}`;
}


export function normalizeChannelLogicOutputChannel(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "all") {
    return null;
  }
  const channel = Math.round(numberValue(value, 0));
  return MIDI_CHANNELS.includes(channel) ? channel : null;
}


export function channelLogicRuleKey(
  trackAId: string,
  trackBId: string,
  outputChannel: number | null
): string {
  return `${channelLogicPairKey(trackAId, trackBId)}\u0000${
    outputChannel ?? "all"
  }`;
}


/** Valid, ordered channel-logic entries — before the D4 duplicate-key dedup. */
function collectValidChannelLogicEntries(
  value: unknown,
  tracks: Pick<ParallelTrackPatch, "id">[]
): ChannelLogicMatrixEntry[] {
  const trackIds = new Set(tracks.map((track) => track.id));
  const entries: ChannelLogicMatrixEntry[] = [];
  if (!Array.isArray(value)) return [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const trackAId = normalizeTrackId(entry.trackAId, "");
    const trackBId = normalizeTrackId(entry.trackBId, "");
    if (
      !trackAId ||
      !trackBId ||
      trackAId === trackBId ||
      !trackIds.has(trackAId) ||
      !trackIds.has(trackBId)
    ) {
      continue;
    }
    // D3: a rule whose policy equals the current default is NOT dropped — it is
    // kept and shown as "= default", so changing the default never silently
    // erases per-pair intent (spec §8, R5).
    const policy = musicalChannelLogicRulePolicy(
      normalizeChannelConflictPolicy(entry.policy)
    );
    const outputChannel = normalizeChannelLogicOutputChannel(entry.outputChannel);
    const [a, b] =
      trackAId < trackBId ? [trackAId, trackBId] : [trackBId, trackAId];
    entries.push({
      trackAId: a,
      trackBId: b,
      outputChannel,
      policy,
    });
  }
  return entries.sort((left, right) =>
    `${channelLogicRuleKey(
      left.trackAId,
      left.trackBId,
      normalizeChannelLogicOutputChannel(left.outputChannel)
    )}\u0000${left.policy}`.localeCompare(
      `${channelLogicRuleKey(
        right.trackAId,
        right.trackBId,
        normalizeChannelLogicOutputChannel(right.outputChannel)
      )}\u0000${right.policy}`
    )
  );
}


export function normalizeChannelLogicMatrix(
  value: unknown,
  tracks: Pick<ParallelTrackPatch, "id">[],
  // Retained for call-site compatibility; no longer used to cull rules (D3).
  _defaultPolicy: ChannelConflictPolicy
): ChannelLogicMatrixEntry[] {
  // D4: at most one policy per (pair, channel) — an ambiguous set is not
  // representable. The reducers keep it that way; this dedup is the load-time
  // backstop that repairs hand-edited or legacy patches. Keep-first in sort
  // order makes the repair deterministic (spec §6, R6).
  const seen = new Set<string>();
  const deduped: ChannelLogicMatrixEntry[] = [];
  for (const entry of collectValidChannelLogicEntries(value, tracks)) {
    const key = channelLogicRuleKey(
      entry.trackAId,
      entry.trackBId,
      normalizeChannelLogicOutputChannel(entry.outputChannel)
    );
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

/**
 * How many entries the D4 dedup drops as duplicate (pair, channel) keys —
 * surfaced once at load so the user is told conflicting rules were merged.
 */
export function channelLogicMatrixRepairCount(
  value: unknown,
  tracks: Pick<ParallelTrackPatch, "id">[],
  defaultPolicy: ChannelConflictPolicy
): number {
  const valid = collectValidChannelLogicEntries(value, tracks).length;
  const kept = normalizeChannelLogicMatrix(value, tracks, defaultPolicy).length;
  return Math.max(0, valid - kept);
}

export function musicalChannelLogicDefaultPolicy(
  policy: ChannelConflictPolicy
): ChannelConflictPolicy {
  switch (policy) {
    case "forceOn":
    case "or":
      return "allowAll";
    case "oneHigh":
      return "xor";
    case "forceOff":
    case "nor":
    case "nand":
    case "oneLow":
      return "xnor";
    case "even":
    case "odd":
      return "majority";
    default:
      return policy;
  }
}


export function musicalChannelLogicRulePolicy(
  policy: ChannelConflictPolicy
): ChannelConflictPolicy {
  switch (policy) {
    case "forceOn":
    case "or":
    case "and":
    case "xnor":
    case "even":
    case "majority":
      return "allowAll";
    case "xor":
    case "nand":
    case "nor":
    case "odd":
    case "oneHigh":
    case "oneLow":
    case "minority":
      return "forceOff";
    default:
      return policy;
  }
}


export function normalizeTrackId(value: unknown, fallback: string): string {
  const id = stringValue(value, fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || fallback;
}


export function normalizedConflictPriority(
  value: unknown,
  tracks: Pick<ParallelTrackPatch, "id">[]
): string[] {
  const trackIds = new Set(tracks.map((track) => track.id));
  const cleaned = Array.isArray(value)
    ? value
        .map((id) => normalizeTrackId(id, ""))
        .filter((id, index, list) => id && list.indexOf(id) === index && trackIds.has(id))
    : [];
  for (const track of tracks) {
    if (!cleaned.includes(track.id)) {
      cleaned.push(track.id);
    }
  }
  return cleaned;
}


/**
 * The runtime conflict/matrix endpoint ids for **state-path** normalization:
 * authored parallel-track ids plus every Track Flow box's lane id
 * (`track-flow-<boxId>`). Box lanes are real runtime participants, so a
 * `conflictPriority` entry or `channelLogicMatrix` endpoint naming a box lane
 * must survive persistence normalization — otherwise authored lane rules are
 * silently dropped on load/delete/import before the request builder ever runs.
 * (Request-time audibility pruning stays in `buildParallelPlaybackRequest`; here
 * we use *all* boxes so a rule isn't lost just because a member is muted.)
 */
export function runtimeEndpointTrackIds(
  tracks: Pick<ParallelTrackPatch, "id">[],
  boxes: Pick<TrackFlowBox, "id">[]
): { id: string }[] {
  return [
    ...tracks.map((track) => ({ id: track.id })),
    ...boxes.map((box) => ({ id: trackFlowLaneId(box.id) })),
  ];
}


function normalizeTrackFlowWeightRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== "string" || key.length === 0) continue;
    const weight = clamp(Math.round(numberValue(raw, 0)), 0, 999);
    if (weight > 0) out[key] = weight;
  }
  return out;
}


export function normalizeTrackFlowChainState(value: unknown): TrackFlowChainState {
  if (!isRecord(value)) return defaultTrackFlowChain();
  return {
    order: normalizeMarkovOrder(value.order),
    weights: normalizeTrackFlowWeightRecord(value.weights),
    entryWeights: normalizeTrackFlowWeightRecord(value.entryWeights),
    fallbackWeights: normalizeTrackFlowWeightRecord(value.fallbackWeights),
    fallback: stringValue(value.fallback, ""),
  };
}


/**
 * Sanitize an authored box id so the derived lane id `track-flow-<boxId>` is
 * well-formed and unique: strip characters that aren't id-safe (notably `:`,
 * which would break the composite seed-path split), reject the reserved
 * `track-flow-` family, fall back to `box-<n>` when empty, and de-duplicate.
 * Applied *after* the raw value is read so the reservation cannot be bypassed.
 */
function sanitizeTrackFlowBoxId(
  raw: unknown,
  index: number,
  used: Set<string>
): string {
  let id = stringValue(raw, "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id || isReservedTrackFlowId(id)) {
    id = `box-${index + 1}`;
  }
  let candidate = id;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${id}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}


/**
 * Normalize the project's Track Flow boxes, enforcing the invariants the backend
 * DTO cannot see (it only receives audible runtime sources): a track id appears
 * in **at most one box** (first box wins), deleted/reserved track ids are pruned
 * from membership, box ids are unique/non-empty/colon-free/non-reserved, and
 * chains are coerced to a safe shape. When the patch has no `trackFlowBoxes`
 * array at all (a legacy patch), fold its `mode: "trackFlow"` tracks into one
 * `main` box that reproduces v1's lane identity (id `main`, name "Track Flow",
 * seed 0, uniform chain) so existing projects behave identically at runtime.
 */
export function normalizeTrackFlowBoxes(
  value: unknown,
  legacyTrackFlowTrackIds: string[],
  validTrackIds: string[]
): TrackFlowBox[] {
  const valid = new Set(
    validTrackIds.filter((id) => !isReservedTrackFlowId(id))
  );
  const claimed = new Set<string>(); // a track belongs to ≤1 box (first wins)
  const usedBoxIds = new Set<string>();
  const claimMembers = (rawMembers: unknown): string[] => {
    const members: string[] = [];
    if (Array.isArray(rawMembers)) {
      for (const raw of rawMembers) {
        const id = normalizeTrackId(raw, "");
        if (!id || !valid.has(id) || claimed.has(id)) continue;
        claimed.add(id);
        members.push(id);
      }
    }
    return members;
  };

  if (Array.isArray(value)) {
    const boxes: TrackFlowBox[] = [];
    value.forEach((raw, index) => {
      if (!isRecord(raw)) return;
      const id = sanitizeTrackFlowBoxId(raw.id, index, usedBoxIds);
      boxes.push({
        id,
        name: stringValue(raw.name, id),
        memberTrackIds: claimMembers(raw.memberTrackIds),
        chain: normalizeTrackFlowChainState(raw.chain),
        seed: normalizeSeedValue(raw.seed, TRACK_FLOW_DEFAULT_SEED),
        collapsed: boolValue(raw.collapsed, false),
      });
    });
    return boxes;
  }

  // Legacy migration: no boxes key ⇒ fold `mode: "trackFlow"` tracks into one
  // default box runtime-equivalent to v1.
  const migratedMembers = claimMembers(legacyTrackFlowTrackIds);
  if (migratedMembers.length === 0) return [];
  return [
    {
      id: TRACK_FLOW_DEFAULT_BOX_ID,
      name: TRACK_FLOW_DEFAULT_BOX_NAME,
      memberTrackIds: migratedMembers,
      chain: defaultTrackFlowChain(),
      seed: TRACK_FLOW_DEFAULT_SEED,
      collapsed: false,
    },
  ];
}


export function flattenProjectPatchForActiveTrack(
  root: Record<string, unknown>
): Record<string, unknown> {
  const project = isRecord(root.project) ? root.project : null;
  if (!project) return root;

  const tracks = Array.isArray(project.tracks)
    ? project.tracks.filter(isRecord)
    : [];
  const activeTrackId =
    typeof project.activeTrackId === "string" ? project.activeTrackId : "";
  const activeTrack =
    tracks.find((track) => track.id === activeTrackId) ?? tracks[0] ?? null;
  if (!activeTrack) return root;

  const global = isRecord(project.global) ? project.global : {};
  const existingTransport = isRecord(root.transport) ? root.transport : {};
  const existingSequencer = isRecord(root.sequencer) ? root.sequencer : {};
  const trackSequencer = isRecord(activeTrack.sequencer)
    ? { ...activeTrack.sequencer }
    : { ...existingSequencer };

  const tempoMode = normalizeTrackTempoMode(activeTrack.tempoMode);
  const tempoBpm =
    tempoMode === "custom"
      ? numberValue(activeTrack.customTempoBpm, numberValue(global.tempoBpm, 80))
      : numberValue(global.tempoBpm, numberValue(existingTransport.tempoBpm, 80));

  const cycleLengthMode = normalizeTrackCycleLengthMode(
    activeTrack.cycleLengthMode
  );
  const cycleBeats =
    cycleLengthMode === "custom"
      ? numberValue(
          activeTrack.customCycleBeats,
          numberValue(trackSequencer.cycleBeats, numberValue(global.cycleBeats, 8))
        )
      : numberValue(global.cycleBeats, numberValue(trackSequencer.cycleBeats, 8));

  return {
    ...root,
    transport: {
      ...existingTransport,
      tempoBpm,
      synthEnabled:
        global.synthEnabled ?? existingTransport.synthEnabled ?? false,
      synthPrograms:
        global.synthPrograms ?? existingTransport.synthPrograms ?? [],
      rhythmPlaybackEnabled: true,
      cycleTempoFlux:
        global.cycleTempoFlux ?? existingTransport.cycleTempoFlux ?? {},
    },
    sequencer: {
      ...trackSequencer,
      cycleBeats,
    },
    generatorEnabled:
      activeTrack.generatorEnabled ?? root.generatorEnabled ?? true,
    generator: activeTrack.generator ?? root.generator,
    automation: activeTrack.automation ?? root.automation,
    rhythm: activeTrack.rhythm ?? root.rhythm,
    pitchShaper: activeTrack.pitchShaper ?? root.pitchShaper,
    channelHocket: activeTrack.channelHocket ?? root.channelHocket,
    seedPaths: activeTrack.seedPaths ?? root.seedPaths,
    scoreSnapshot: Object.prototype.hasOwnProperty.call(
      activeTrack,
      "scoreSnapshot"
    )
      ? activeTrack.scoreSnapshot ?? null
      : root.scoreSnapshot ?? null,
  };
}


export function patchProjectTrackFromFlat(
  flat: SequencerPatchFlatState,
  previousTrack?: ParallelTrackPatch
): ParallelTrackPatch {
  const id = normalizeTrackId(previousTrack?.id, DEFAULT_PARALLEL_TRACK_ID);
  const tempoMode = normalizeTrackTempoMode(previousTrack?.tempoMode);
  const cycleLengthMode = normalizeTrackCycleLengthMode(
    previousTrack?.cycleLengthMode
  );
  return {
    id,
    name: stringValue(previousTrack?.name, flat.sequencer.name || "Track 1"),
    color: stringValue(previousTrack?.color, DEFAULT_PARALLEL_TRACK_COLOR),
    muted: boolValue(previousTrack?.muted, false),
    soloed: boolValue(previousTrack?.soloed, false),
    tempoMode,
    customTempoBpm:
      tempoMode === "custom"
        ? flat.transport.tempoBpm
        : clamp(numberValue(previousTrack?.customTempoBpm, flat.transport.tempoBpm), 20, 400),
    cycleLengthMode,
    customCycleBeats:
      cycleLengthMode === "custom"
        ? flat.sequencer.cycleBeats
        : clamp(
            Math.round(numberValue(previousTrack?.customCycleBeats, flat.sequencer.cycleBeats)),
            1,
            64
          ),
    sequencer: flat.sequencer,
    generatorEnabled: flat.generatorEnabled,
    generator: normalizePatchGeneratorConfig(
      flat.generator,
      flat.sequencer.seed
    ),
    automation: cloneAutomationSet(flat.automation),
    rhythm: flat.rhythm,
    pitchShaper: flat.pitchShaper,
    channelHocket: flat.channelHocket,
    seedPaths: flat.seedPaths.map((path) => ({
      ...path,
      wildcardRules: path.wildcardRules.map((rule) => ({ ...rule })),
      trace: path.trace.map((point) => ({ ...point })),
    })),
    scoreSnapshot: flat.scoreSnapshot,
    // Playback mode and trigger config are track-strip-level metadata the flat
    // editor does not own, so preserve whatever the previous track carried.
    mode: normalizeTrackPlaybackMode(previousTrack?.mode),
    trigger: previousTrack?.trigger ?? null,
  };
}


export function normalizeParallelTrackScopedState(
  value: Record<string, unknown>,
  fallback: SequencerPatchFlatState,
  schemaVersion: PatchSchemaVersion
): SequencerPatchFlatState {
  return readPatchDocument({
    app: PATCH_APP_ID,
    schemaVersion,
    savedAt: fallback.savedAt,
    transport: fallback.transport,
    sequencer: isRecord(value.sequencer) ? value.sequencer : fallback.sequencer,
    generatorEnabled: value.generatorEnabled ?? fallback.generatorEnabled,
    generator: value.generator ?? fallback.generator,
    automation: value.automation ?? fallback.automation,
    rhythm: isRecord(value.rhythm) ? value.rhythm : fallback.rhythm,
    pitchShaper: isRecord(value.pitchShaper)
      ? value.pitchShaper
      : fallback.pitchShaper,
    channelHocket: isRecord(value.channelHocket)
      ? value.channelHocket
      : fallback.channelHocket,
    setup: fallback.setup,
    ui: fallback.ui,
    seedPaths: value.seedPaths,
    scoreSnapshot: value.scoreSnapshot ?? null,
  });
}


export const DEFAULT_TRIGGER_MAX_REPEATS = 64;
export const TRIGGER_MAX_REPEATS_CAP = 4096;

function normalizeTriggerBeat(value: unknown): number {
  return clamp(Math.round(numberValue(value, 0)), 0, 63);
}

export function normalizeTriggerCondition(value: unknown): TriggerCondition {
  if (isRecord(value)) {
    const beat = normalizeTriggerBeat(value.beat);
    switch (stringValue(value.type, "beatIsRest")) {
      case "beatIsSounding":
        return { type: "beatIsSounding", beat };
      case "sectionStartAtBeat":
        return { type: "sectionStartAtBeat", beat };
      case "gatiIs":
        return { type: "gatiIs", beat, gati: clamp(Math.round(numberValue(value.gati, 4)), 1, 32) };
      case "jathiPulseAtBeat":
        return { type: "jathiPulseAtBeat", beat };
      default:
        return { type: "beatIsRest", beat };
    }
  }
  return { type: "beatIsRest", beat: 0 };
}

// --- Phase B: multi-condition WHEN tree (mirrors cseq_trigger config) -------

/** Mirrors `cseq_trigger::MAX_CONDITION_NODES`. */
export const MAX_CONDITION_NODES = 256;
/** Mirrors `cseq_trigger::MAX_CONDITION_DEPTH`. */
export const MAX_CONDITION_DEPTH = 32;

export function normalizeTriggerCountOp(value: unknown): TriggerCountOp {
  switch (stringValue(value, "atLeast")) {
    case "atMost":
      return "atMost";
    case "exactly":
      return "exactly";
    case "moreThan":
      return "moreThan";
    case "lessThan":
      return "lessThan";
    default:
      return "atLeast";
  }
}

function normalizeMatraIndex(value: unknown): number {
  return clamp(Math.round(numberValue(value, 0)), 0, 63);
}

function normalizeCycleCount(value: unknown): number {
  return clamp(Math.round(numberValue(value, 0)), 0, 256);
}

/** Coerce arbitrary input to a safe `TriggerWhenPredicate` (mirrors the Rust
 * `WhenPredicate::normalized` clamps). Defaults to `isRest`. */
export function normalizeTriggerWhenPredicate(value: unknown): TriggerWhenPredicate {
  if (isRecord(value)) {
    switch (stringValue(value.type, "isRest")) {
      case "isSounding":
        return { type: "isSounding" };
      case "isSectionStart":
        return { type: "isSectionStart" };
      case "hasJathiPulse":
        return { type: "hasJathiPulse" };
      case "gatiIs":
        return { type: "gatiIs", gati: clamp(Math.round(numberValue(value.gati, 4)), 1, 32) };
      case "matraIsRest":
        return { type: "matraIsRest", matra: normalizeMatraIndex(value.matra) };
      case "matraIsSounding":
        return { type: "matraIsSounding", matra: normalizeMatraIndex(value.matra) };
      case "restCountInCycle":
        return {
          type: "restCountInCycle",
          op: normalizeTriggerCountOp(value.op),
          count: normalizeCycleCount(value.count),
        };
      case "soundingCountInCycle":
        return {
          type: "soundingCountInCycle",
          op: normalizeTriggerCountOp(value.op),
          count: normalizeCycleCount(value.count),
        };
      default:
        return { type: "isRest" };
    }
  }
  return { type: "isRest" };
}

function conditionNodeCount(node: TriggerConditionNode): number {
  switch (node.type) {
    case "leaf":
      return 1;
    case "not":
      return 1 + conditionNodeCount(node.node);
    case "all":
    case "any":
      return 1 + node.nodes.reduce((sum, n) => sum + conditionNodeCount(n), 0);
  }
}

/**
 * Coerce arbitrary input to a safe `TriggerConditionNode`. Recursion is bounded
 * by `MAX_CONDITION_DEPTH`: beyond it, the subtree collapses to a safe
 * `isRest` leaf, matching the Rust normalizer/evaluator guard. Empty ALL/ANY
 * nodes also collapse to that safe default so they cannot behave like hidden
 * always/never predicates. Leaf predicates are clamped via
 * `normalizeTriggerWhenPredicate`.
 */
export function normalizeTriggerConditionNode(value: unknown, depth = 0): TriggerConditionNode {
  if (depth >= MAX_CONDITION_DEPTH) {
    return { type: "leaf", predicate: { type: "isRest" } };
  }
  if (isRecord(value)) {
    switch (stringValue(value.type, "leaf")) {
      case "all": {
        const nodes = normalizeConditionNodeList(value.nodes, depth);
        return nodes.length
          ? { type: "all", nodes }
          : { type: "leaf", predicate: { type: "isRest" } };
      }
      case "any": {
        const nodes = normalizeConditionNodeList(value.nodes, depth);
        return nodes.length
          ? { type: "any", nodes }
          : { type: "leaf", predicate: { type: "isRest" } };
      }
      case "not":
        return { type: "not", node: normalizeTriggerConditionNode(value.node, depth + 1) };
      case "leaf":
      default:
        return { type: "leaf", predicate: normalizeTriggerWhenPredicate(value.predicate) };
    }
  }
  return { type: "leaf", predicate: { type: "isRest" } };
}

function normalizeConditionNodeList(value: unknown, depth: number): TriggerConditionNode[] {
  if (!Array.isArray(value)) return [];
  return value.map((n) => normalizeTriggerConditionNode(n, depth + 1));
}

export function normalizeTriggerBeatSelector(value: unknown): TriggerBeatSelector {
  if (isRecord(value) && stringValue(value.type, "at") === "anyBeat") {
    return { type: "anyBeat" };
  }
  const beat = isRecord(value) ? normalizeTriggerBeat(value.beat) : 0;
  return { type: "at", beat };
}

/**
 * Coerce arbitrary input to a safe `TriggerWhenSpec` (mirrors
 * `WhenSpec::normalized`). An over-large tree (> `MAX_CONDITION_NODES`) collapses
 * to a single `isRest` leaf while preserving the beat selector.
 */
export function normalizeWhenSpec(value: unknown): TriggerWhenSpec {
  const beats = normalizeTriggerBeatSelector(isRecord(value) ? value.beats : undefined);
  const tree = normalizeTriggerConditionNode(isRecord(value) ? value.tree : undefined, 0);
  if (conditionNodeCount(tree) > MAX_CONDITION_NODES) {
    return { beats, tree: { type: "leaf", predicate: { type: "isRest" } } };
  }
  return { beats, tree };
}

/** Upcast a legacy single `TriggerCondition` into an equivalent WHEN tree
 * (mirrors `WhenSpec::from_legacy_condition`). */
export function whenSpecFromLegacyCondition(condition: TriggerCondition): TriggerWhenSpec {
  let predicate: TriggerWhenPredicate;
  switch (condition.type) {
    case "beatIsSounding":
      predicate = { type: "isSounding" };
      break;
    case "sectionStartAtBeat":
      predicate = { type: "isSectionStart" };
      break;
    case "gatiIs":
      predicate = { type: "gatiIs", gati: condition.gati };
      break;
    case "jathiPulseAtBeat":
      predicate = { type: "hasJathiPulse" };
      break;
    case "beatIsRest":
    default:
      predicate = { type: "isRest" };
      break;
  }
  return { beats: { type: "at", beat: condition.beat }, tree: { type: "leaf", predicate } };
}

/**
 * Resolve the canonical WHEN tree from a (partial) trigger record: `when` if
 * present, else upcast a legacy `condition`, else a safe default — always
 * normalized. Mirrors `TriggerConfig::effective_when`.
 */
export function effectiveTriggerWhen(value: unknown): TriggerWhenSpec {
  if (isRecord(value)) {
    if (value.when != null) return normalizeWhenSpec(value.when);
    if (value.condition != null) {
      return normalizeWhenSpec(whenSpecFromLegacyCondition(normalizeTriggerCondition(value.condition)));
    }
  }
  // Default spec: at beat 0, a single `isRest` leaf.
  return normalizeWhenSpec(undefined);
}

export function normalizeTriggerLaunchAlignment(value: unknown): TriggerLaunchAlignment {
  if (isRecord(value)) {
    switch (stringValue(value.type, "atEvent")) {
      case "atSourceCycleStart":
        return { type: "atSourceCycleStart" };
      case "atNextReferenceBeat":
        return { type: "atNextReferenceBeat" };
      case "afterEventTicks":
        return {
          type: "afterEventTicks",
          ticks: clamp(Math.round(numberValue(value.ticks, 0)), 0, 1_000_000),
        };
      case "centerInRest":
        return { type: "centerInRest" };
      case "atSourceReturn":
        return { type: "atSourceReturn" };
      default:
        return { type: "atEvent" };
    }
  }
  return { type: "atEvent" };
}

export function normalizeTriggerLifetime(value: unknown): TriggerLifetime {
  if (isRecord(value) && stringValue(value.type, "onePass") === "repeats") {
    return {
      type: "repeats",
      passes: clamp(Math.round(numberValue(value.passes, 1)), 1, TRIGGER_MAX_REPEATS_CAP),
    };
  }
  return { type: "onePass" };
}

export function normalizeTriggerReTrigger(value: unknown): TriggerReTrigger {
  switch (stringValue(value, "restart")) {
    case "ignore":
      return "ignore";
    case "queue":
      return "queue";
    default:
      return "restart";
  }
}

export function normalizeTriggerLength(value: unknown): TriggerLength {
  if (isRecord(value) && stringValue(value.type, "scoreCycle") === "fixedBeats") {
    return { type: "fixedBeats", beats: clamp(Math.round(numberValue(value.beats, 1)), 1, 256) };
  }
  return { type: "scoreCycle" };
}

export const MAX_QUANTIZE_DIVISIONS = 64;

export function normalizeTriggerQuantizeGrid(value: unknown): TriggerQuantizeGrid {
  if (isRecord(value)) {
    switch (stringValue(value.type, "referenceBeatFraction")) {
      case "referenceBeatMultiple":
        return {
          type: "referenceBeatMultiple",
          beats: clamp(Math.round(numberValue(value.beats, 1)), 1, MAX_QUANTIZE_DIVISIONS),
        };
      case "sourceGatiMatra":
        return { type: "sourceGatiMatra" };
      default:
        return {
          type: "referenceBeatFraction",
          divisions: clamp(Math.round(numberValue(value.divisions, 1)), 1, MAX_QUANTIZE_DIVISIONS),
        };
    }
  }
  return { type: "referenceBeatFraction", divisions: 1 };
}

export function normalizeTriggerQuantizeDirection(value: unknown): TriggerQuantizeDirection {
  switch (stringValue(value, "next")) {
    case "nearest":
      return "nearest";
    case "previous":
      return "previous";
    default:
      return "next";
  }
}

/**
 * Coerce arbitrary/partial quantize config to a safe `TriggerLaunchQuantize`, or
 * `null` (no quantize) when not a record. Pure + idempotent; mirrors the Rust
 * `LaunchQuantize::normalized` clamps.
 */
export function normalizeLaunchQuantize(value: unknown): TriggerLaunchQuantize | null {
  if (!isRecord(value)) return null;
  return {
    grid: normalizeTriggerQuantizeGrid(value.grid),
    direction: normalizeTriggerQuantizeDirection(value.direction),
  };
}

/** Mirrors `cseq_trigger::GATE_PROBABILITY_MAX`. */
export const GATE_PROBABILITY_MAX = 1000;
/** Mirrors `cseq_trigger::GATE_COOLDOWN_CYCLES_CAP`. */
export const GATE_COOLDOWN_CYCLES_CAP = 4096;

/**
 * Coerce arbitrary/partial gate config to a safe `TriggerGateSpec`, or `null`
 * (no gate ⇒ always accept) when not a record. Pure + idempotent; mirrors the
 * Rust `GateSpec::normalized` clamps so the UI never ships a gate the engine
 * would clamp differently.
 */
export function normalizeGateSpec(value: unknown): TriggerGateSpec | null {
  if (!isRecord(value)) return null;
  return {
    probabilityPerMille: clamp(
      Math.round(numberValue(value.probabilityPerMille, GATE_PROBABILITY_MAX)),
      0,
      GATE_PROBABILITY_MAX
    ),
    cooldownCycles: clamp(
      Math.round(numberValue(value.cooldownCycles, 0)),
      0,
      GATE_COOLDOWN_CYCLES_CAP
    ),
    missBoostPerMille: clamp(
      Math.round(numberValue(value.missBoostPerMille, 0)),
      0,
      GATE_PROBABILITY_MAX
    ),
    // Seed is a stable u64; keep a finite non-negative integer.
    seed: Math.max(0, Math.round(numberValue(value.seed, 0))),
  };
}

/** Mirrors `cseq_trigger::MAX_START_OPTIONS`. */
export const MAX_START_OPTIONS = 16;
/** Mirrors `cseq_trigger::MAX_START_WEIGHT`. */
export const MAX_START_WEIGHT = 1_000_000;

/**
 * Coerce arbitrary/partial weighted-START config to a safe `TriggerStartSelect`,
 * or `null` (no select ⇒ the single `launchAlignment`) when not a record or when
 * it has no options. Pure + idempotent; mirrors `StartSelect::normalized`
 * (option count capped, each alignment normalized, each weight clamped).
 */
export function normalizeStartSelect(value: unknown): TriggerStartSelect | null {
  if (!isRecord(value) || !Array.isArray(value.options)) return null;
  const options: TriggerWeightedStart[] = value.options
    .slice(0, MAX_START_OPTIONS)
    .map((option) => ({
      alignment: normalizeTriggerLaunchAlignment(isRecord(option) ? option.alignment : undefined),
      weight: clamp(
        Math.round(numberValue(isRecord(option) ? option.weight : 1, 1)),
        0,
        MAX_START_WEIGHT
      ),
    }));
  if (options.length === 0) return null;
  return { options, seed: Math.max(0, Math.round(numberValue(value.seed, 0))) };
}

/**
 * Coerce arbitrary/partial trigger config into a safe `TriggerConfig`, or `null`
 * (continuous) when it is not a record or has no `sourceTrackId`. Pure and
 * idempotent. Graph-level validity (self-trigger, dangling source, one-level
 * rule) is enforced separately in `normalizeParallelProjectPatch` and on the
 * backend; this only guarantees each field is well-formed and bounded.
 */
export function normalizeTriggerConfig(value: unknown): TriggerConfig | null {
  if (!isRecord(value)) return null;
  const sourceTrackId = normalizeTrackId(value.sourceTrackId, "");
  if (!sourceTrackId) return null;
  const rawMax = Math.round(numberValue(value.maxRepeats, DEFAULT_TRIGGER_MAX_REPEATS));
  return {
    sourceTrackId,
    // Canonical Phase-B WHEN tree: prefer `when`, upcast legacy `condition`,
    // else default — then clear the legacy field (mirrors Rust `normalized`).
    when: effectiveTriggerWhen(value),
    launchAlignment: normalizeTriggerLaunchAlignment(value.launchAlignment),
    launchQuantize: normalizeLaunchQuantize(value.launchQuantize),
    lifetime: normalizeTriggerLifetime(value.lifetime),
    reTrigger: normalizeTriggerReTrigger(value.reTrigger),
    length: normalizeTriggerLength(value.length),
    maxRepeats: rawMax <= 0 ? DEFAULT_TRIGGER_MAX_REPEATS : clamp(rawMax, 1, TRIGGER_MAX_REPEATS_CAP),
    gate: normalizeGateSpec(value.gate),
    startSelect: normalizeStartSelect(value.startSelect),
  };
}

export function normalizeParallelTrackPatch(
  value: unknown,
  index: number,
  fallback: SequencerPatchFlatState,
  schemaVersion: PatchSchemaVersion,
  globalTempoBpm = fallback.transport.tempoBpm
): ParallelTrackPatch | null {
  if (!isRecord(value)) return null;
  const id = normalizeTrackId(value.id, `track-${index + 1}`);
  const tempoMode = normalizeTrackTempoMode(value.tempoMode);
  const customTempoBpm = clamp(
    numberValue(value.customTempoBpm, globalTempoBpm),
    20,
    400
  );
  const effectiveTempoBpm =
    tempoMode === "custom"
      ? customTempoBpm
      : clamp(numberValue(globalTempoBpm, fallback.transport.tempoBpm), 20, 400);
  const scoped = normalizeParallelTrackScopedState(
    value,
    {
      ...fallback,
      transport: { ...fallback.transport, tempoBpm: effectiveTempoBpm },
    },
    schemaVersion
  );
  return {
    id,
    name: stringValue(value.name, `Track ${index + 1}`),
    color: stringValue(value.color, DEFAULT_PARALLEL_TRACK_COLOR),
    muted: boolValue(value.muted, false),
    soloed: boolValue(value.soloed, false),
    tempoMode,
    customTempoBpm,
    cycleLengthMode: normalizeTrackCycleLengthMode(value.cycleLengthMode),
    customCycleBeats: clamp(
      Math.round(numberValue(value.customCycleBeats, fallback.sequencer.cycleBeats)),
      1,
      64
    ),
    sequencer: scoped.sequencer,
    generatorEnabled: scoped.generatorEnabled,
    generator: normalizePatchGeneratorConfig(
      value.generator,
      scoped.sequencer.seed
    ),
    automation: scoped.automation,
    rhythm: scoped.rhythm,
    pitchShaper: scoped.pitchShaper,
    channelHocket: scoped.channelHocket,
    seedPaths: scoped.seedPaths,
    scoreSnapshot: scoped.scoreSnapshot,
    mode: normalizeTrackPlaybackMode(value.mode),
    trigger: normalizeTriggerConfig(value.trigger),
  };
}

/**
 * Enforce trigger-graph validity across a set of tracks: a triggered track's
 * `sourceTrackId` must reference a *different, existing, continuous* track (v1
 * one-level rule). Any edge that violates this is dropped to continuous
 * (`trigger = null`), mirroring the backend `normalize_track_modes`. Returns a
 * new array; does not mutate inputs.
 */
/**
 * Track ids that must be realized as **silent sources**: a muted/solo-hidden
 * track that an *audible* triggered follower depends on. Muting a source must
 * not stop it driving followers, so it is still realized (silently) for its
 * resolved structure. Pure; mirrors the audibility rule used to build the
 * parallel playback request. Only existing, non-audible source ids are returned.
 */
export function parallelSilentSourceIds(
  tracks: Pick<ParallelTrackPatch, "id" | "muted" | "soloed" | "trigger">[]
): Set<string> {
  const soloActive = tracks.some((track) => track.soloed);
  const audible = tracks.filter(
    (track) => !track.muted && (!soloActive || track.soloed)
  );
  const audibleIds = new Set(audible.map((track) => track.id));
  const existing = new Set(tracks.map((track) => track.id));
  const potentiallyTriggeredIds = new Set<string>();
  for (const track of tracks) {
    const source = track.trigger?.sourceTrackId;
    if (source && source !== track.id && existing.has(source)) {
      potentiallyTriggeredIds.add(track.id);
    }
  }
  const needed = new Set<string>();
  for (const track of audible) {
    const source = track.trigger?.sourceTrackId;
    if (
      source &&
      !audibleIds.has(source) &&
      existing.has(source) &&
      !potentiallyTriggeredIds.has(source)
    ) {
      needed.add(source);
    }
  }
  return needed;
}

export function enforceTriggerGraph(
  tracks: ParallelTrackPatch[],
  boxedIds: Set<string> = new Set()
): ParallelTrackPatch[] {
  const ids = new Set(tracks.map((track) => track.id));
  const potentiallyTriggeredIds = new Set<string>();
  for (const track of tracks) {
    const trigger = track.trigger;
    if (!trigger) continue;
    if (boxedIds.has(track.id)) continue;
    const source = trigger.sourceTrackId;
    if (source === track.id || !ids.has(source)) continue;
    potentiallyTriggeredIds.add(track.id);
  }
  return tracks.map((track) => {
    const trigger = track.trigger;
    if (!trigger) return track;
    // A boxed track is sequential (Track Flow): it can be neither a triggered
    // follower nor — via the source check below — another track's trigger source.
    if (boxedIds.has(track.id)) return { ...track, trigger: null };
    const source = trigger.sourceTrackId;
    const invalid =
      source === track.id || // self-trigger
      !ids.has(source) || // dangling
      potentiallyTriggeredIds.has(source) || // source must be continuous (one level)
      boxedIds.has(source); // a boxed track cannot be a trigger source
    return invalid ? { ...track, trigger: null } : track;
  });
}


/**
 * Repair authored track ids that fall in the reserved `track-flow-` family.
 * Such ids were legal before multi-box (only `track-flow-main`/`:` were reserved)
 * but now fail backend validation, so a stored/imported patch carrying one would
 * load and display fine yet fail playback. We rename the id out of the reserved
 * family on load and rewrite **every** reference (active track, conflict
 * priority, channel-logic matrix endpoints, box members, trigger sources) so the
 * project stays self-consistent. No-op (returns the input) when no id is
 * reserved, which is the overwhelmingly common case. Operates on the raw value
 * before normalization so all downstream normalizers see the repaired ids.
 */
function repairReservedAuthoredTrackIds(
  value: Record<string, unknown>
): Record<string, unknown> {
  const rawTracks = Array.isArray(value.tracks) ? value.tracks : [];
  const used = new Set<string>();
  for (const track of rawTracks) {
    if (isRecord(track) && typeof track.id === "string") {
      const id = normalizeTrackId(track.id, "");
      if (id) used.add(id);
    }
  }
  const renames = new Map<string, string>();
  for (const track of rawTracks) {
    if (!isRecord(track) || typeof track.id !== "string") continue;
    const id = normalizeTrackId(track.id, "");
    if (!id || !isReservedTrackFlowId(id) || renames.has(id)) continue;
    let repaired = id.replace(/^(?:track-flow-)+/, "").replace(/^-+/, "");
    if (!repaired) repaired = "track";
    let candidate = repaired;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${repaired}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    renames.set(id, candidate);
  }
  if (renames.size === 0) return value;
  const remap = (raw: unknown): unknown =>
    typeof raw === "string" ? renames.get(normalizeTrackId(raw, "")) ?? raw : raw;
  const global = isRecord(value.global) ? value.global : null;
  return {
    ...value,
    activeTrackId: remap(value.activeTrackId),
    tracks: rawTracks.map((track) => {
      if (!isRecord(track)) return track;
      const trigger =
        isRecord(track.trigger) && typeof track.trigger.sourceTrackId === "string"
          ? { ...track.trigger, sourceTrackId: remap(track.trigger.sourceTrackId) }
          : track.trigger;
      return { ...track, id: remap(track.id), trigger };
    }),
    ...(global
      ? {
          global: {
            ...global,
            conflictPriority: Array.isArray(global.conflictPriority)
              ? global.conflictPriority.map(remap)
              : global.conflictPriority,
            channelLogicMatrix: Array.isArray(global.channelLogicMatrix)
              ? global.channelLogicMatrix.map((entry) =>
                  isRecord(entry)
                    ? {
                        ...entry,
                        trackAId: remap(entry.trackAId),
                        trackBId: remap(entry.trackBId),
                      }
                    : entry
                )
              : global.channelLogicMatrix,
            trackFlowBoxes: Array.isArray(global.trackFlowBoxes)
              ? global.trackFlowBoxes.map((box) =>
                  isRecord(box) && Array.isArray(box.memberTrackIds)
                    ? { ...box, memberTrackIds: box.memberTrackIds.map(remap) }
                    : box
                )
              : global.trackFlowBoxes,
          },
        }
      : {}),
  };
}

export function normalizeParallelProjectPatch(
  rawValue: unknown,
  fallback: SequencerPatchFlatState,
  schemaVersion: PatchSchemaVersion
): ParallelProjectPatch | null {
  if (!isRecord(rawValue)) return null;
  // Repair any reserved-family authored track id (and its references) before
  // normalization, so legacy/imported data can't become an unplayable trap.
  const value = repairReservedAuthoredTrackIds(rawValue);
  const global = isRecord(value.global) ? value.global : {};
  const globalTempoBpm = clamp(
    numberValue(global.tempoBpm, fallback.transport.tempoBpm),
    20,
    400
  );
  const normalizedTracks = Array.isArray(value.tracks)
    ? value.tracks
        .flatMap((track, index) => {
          const normalized = normalizeParallelTrackPatch(
            track,
            index,
            fallback,
            schemaVersion,
            globalTempoBpm
          );
          return normalized ? [normalized] : [];
        })
        .slice(0, MAX_PARALLEL_TRACKS)
    : [];
  if (!normalizedTracks.length) return null;
  const uniqueTracks = normalizedTracks.reduce<ParallelTrackPatch[]>((tracks, track, index) => {
    const id = uniqueParallelTrackId(track.id || `track-${index + 1}`, tracks);
    tracks.push(id === track.id ? track : { ...track, id });
    return tracks;
  }, []);
  // Track Flow boxes own membership at project scope. Build them first (migrating
  // legacy per-track `mode: "trackFlow"` into a single `main` box when no boxes
  // are present), then derive the per-track `mode` shim and clear triggers on
  // boxed tracks before enforcing the trigger graph (boxed tracks are sequential:
  // never a follower nor a trigger source).
  const legacyTrackFlowTrackIds = uniqueTracks
    .filter((track) => track.mode === "trackFlow")
    .map((track) => track.id);
  const trackFlowBoxes = normalizeTrackFlowBoxes(
    global.trackFlowBoxes,
    legacyTrackFlowTrackIds,
    uniqueTracks.map((track) => track.id)
  );
  const boxedIds = new Set<string>();
  for (const box of trackFlowBoxes) {
    for (const id of box.memberTrackIds) boxedIds.add(id);
  }
  const tracks = enforceTriggerGraph(
    uniqueTracks.map((track) => ({
      ...track,
      mode: boxedIds.has(track.id) ? "trackFlow" : "parallel",
    })),
    boxedIds
  );
  const firstTrack = tracks[0]!;
  const activeTrackId = normalizeTrackId(value.activeTrackId, firstTrack.id);
  const channelConflictPolicy = musicalChannelLogicDefaultPolicy(
    normalizeChannelConflictPolicy(global.channelConflictPolicy)
  );
  return {
    activeTrackId: tracks.some((track) => track.id === activeTrackId)
      ? activeTrackId
      : firstTrack.id,
    global: {
      tempoBpm: globalTempoBpm,
      cycleBeats: clamp(
        Math.round(numberValue(global.cycleBeats, fallback.sequencer.cycleBeats)),
        1,
        64
      ),
      channelConflictPolicy,
      channelLogicMatrix: normalizeChannelLogicMatrix(
        global.channelLogicMatrix,
        runtimeEndpointTrackIds(tracks, trackFlowBoxes),
        channelConflictPolicy
      ),
      conflictPriority: normalizedConflictPriority(
        global.conflictPriority,
        runtimeEndpointTrackIds(tracks, trackFlowBoxes)
      ),
      trackFlowBoxes,
      synthEnabled: boolValue(global.synthEnabled, fallback.transport.synthEnabled),
      synthPrograms: synthProgramsToRequest(
        normalizeSynthPrograms(global.synthPrograms ?? fallback.transport.synthPrograms)
      ),
      rhythmPlaybackEnabled: true,
      cycleTempoFlux: isRecord(global.cycleTempoFlux)
        ? normalizeCycleTempoFlux(global.cycleTempoFlux)
        : fallback.transport.cycleTempoFlux,
    },
    tracks,
  };
}


export function buildProjectStateFromFlatPatch(
  flat: SequencerPatchFlatState,
  previousProject?: ParallelProjectPatch | null
): ParallelProjectPatch {
  const previousTracks = previousProject?.tracks.slice(0, MAX_PARALLEL_TRACKS) ?? [];
  const fallbackActiveId = previousTracks[0]?.id ?? DEFAULT_PARALLEL_TRACK_ID;
  const activeTrackId = normalizeTrackId(
    previousProject?.activeTrackId,
    fallbackActiveId
  );
  const previousActiveTrack =
    previousTracks.find((track) => track.id === activeTrackId) ??
    previousTracks[0];
  const activeTrack = patchProjectTrackFromFlat(flat, previousActiveTrack);
  const activeTempoMode = normalizeTrackTempoMode(activeTrack.tempoMode);
  const activeCycleLengthMode = normalizeTrackCycleLengthMode(
    activeTrack.cycleLengthMode
  );
  const existingGlobal = previousProject?.global;
  const globalTempoBpm =
    activeTempoMode === "global"
      ? flat.transport.tempoBpm
      : clamp(numberValue(existingGlobal?.tempoBpm, flat.transport.tempoBpm), 20, 400);
  const globalCycleBeats =
    activeCycleLengthMode === "global"
      ? flat.sequencer.cycleBeats
      : clamp(
          Math.round(numberValue(existingGlobal?.cycleBeats, flat.sequencer.cycleBeats)),
          1,
          64
        );
  const mergedTracks = previousTracks.length
    ? previousTracks.map((track) => (track.id === activeTrack.id ? activeTrack : track))
    : [activeTrack];
  const tracks = (mergedTracks.some((track) => track.id === activeTrack.id)
    ? mergedTracks
    : [activeTrack, ...mergedTracks]
  ).slice(0, MAX_PARALLEL_TRACKS);

  const channelConflictPolicy = musicalChannelLogicDefaultPolicy(
    normalizeChannelConflictPolicy(existingGlobal?.channelConflictPolicy)
  );
  // Preserve and re-normalize Track Flow boxes against the merged track set
  // (migrating legacy `mode` when the previous project predates boxes), then
  // derive the per-track `mode`/trigger shim from membership.
  const trackFlowBoxes = normalizeTrackFlowBoxes(
    existingGlobal?.trackFlowBoxes,
    tracks.filter((track) => track.mode === "trackFlow").map((track) => track.id),
    tracks.map((track) => track.id)
  );
  const boxedIds = new Set<string>();
  for (const box of trackFlowBoxes) {
    for (const id of box.memberTrackIds) boxedIds.add(id);
  }
  const derivedTracks = tracks.map((track) =>
    boxedIds.has(track.id)
      ? { ...track, mode: "trackFlow" as const, trigger: null }
      : { ...track, mode: "parallel" as const }
  );
  return {
    activeTrackId: activeTrack.id,
    global: {
      tempoBpm: globalTempoBpm,
      cycleBeats: globalCycleBeats,
      channelConflictPolicy,
      channelLogicMatrix: normalizeChannelLogicMatrix(
        existingGlobal?.channelLogicMatrix,
        runtimeEndpointTrackIds(tracks, trackFlowBoxes),
        channelConflictPolicy
      ),
      conflictPriority: normalizedConflictPriority(
        existingGlobal?.conflictPriority,
        runtimeEndpointTrackIds(tracks, trackFlowBoxes)
      ),
      trackFlowBoxes,
      synthEnabled: flat.transport.synthEnabled,
      synthPrograms: synthProgramsToRequest(
        normalizeSynthPrograms(flat.transport.synthPrograms)
      ),
      rhythmPlaybackEnabled: true,
      cycleTempoFlux: flat.transport.cycleTempoFlux,
    },
    tracks: derivedTracks,
  };
}

function sequencerForPersistence(sequencer: PatchSequencerState) {
  return {
    name: sequencer.name,
    cycleBeats: sequencer.cycleBeats,
    // The retained initial section has the same fixed controls as later
    // sections. The extraction plan omitted these two keys from its v1 sketch;
    // persisting them prevents a kept authoring control from being lost.
    initialSubdivision: fixedSubdivisionFromWeights(sequencer.initialWeights),
    initialGrouping: fixedGroupingFromWeights(sequencer.initialJathiWeights),
    boundaries: sequencer.boundaries.map((boundary) => ({
      id: boundary.id,
      afterBeat: boundary.afterBeat,
      subdivision: fixedSubdivisionFromWeights(boundary.weights),
      grouping: fixedGroupingFromWeights(boundary.jathiWeights),
    })),
    velocity: sequencer.velocity,
    accent: {
      beatStart: sequencer.accent.beatStart,
      sectionStartExtra: sequencer.accent.sectionStartExtra,
      groupingStart: sequencer.accent.jathiStart,
      groupingMode: sequencer.accent.jathiMode,
    },
    basePitch: sequencer.pitch,
    seedMode: normalizePersistedSeedMode(sequencer.seedMode),
    seed: sequencer.seed,
    historySeeds: sequencer.historySeeds,
    historyWeight: sequencer.historyWeight,
    newSeedWeight: sequencer.newSeedWeight,
    maxHistory: sequencer.maxHistory,
    userPreviewCycle: sequencer.userPreviewCycle,
    scoreSetupOpen: sequencer.scoreSetupOpen,
    boundariesOpen: sequencer.boundariesOpen,
    maxSectionsHelpOpen: sequencer.maxSectionsHelpOpen,
    selectedBoundaryAfterBeat: sequencer.selectedBoundaryAfterBeat,
  };
}

function channelHocketForPersistence(channelHocket: PatchChannelHocketState) {
  const {
    ratchetMode: _ratchetMode,
    wholeProbabilityPercent: _wholeProbabilityPercent,
    perHitProbabilityPercent: _perHitProbabilityPercent,
    preserveFirstHit: _preserveFirstHit,
    ornamentMode: _ornamentMode,
    ornamentWholeProbabilityPercent: _ornamentWholeProbabilityPercent,
    ornamentPerGraceProbabilityPercent: _ornamentPerGraceProbabilityPercent,
    newSeedChance: _newSeedChance,
    holdChance: _holdChance,
    blendCycles: _blendCycles,
    seedBehavior: _seedBehavior,
    ...kept
  } = channelHocket;
  return {
    ...kept,
    seedBehavior: normalizePersistedChannelSeedBehavior(channelHocket.seedBehavior),
  };
}

function trackForPersistence(track: ParallelTrackPatch) {
  return {
    id: track.id,
    name: track.name,
    color: track.color,
    muted: track.muted,
    soloed: track.soloed,
    tempoMode: track.tempoMode,
    customTempoBpm: track.customTempoBpm,
    cycleLengthMode: track.cycleLengthMode,
    customCycleBeats: track.customCycleBeats,
    sequencer: sequencerForPersistence(track.sequencer),
    generatorEnabled: track.generatorEnabled,
    generator: normalizePatchGeneratorConfig(track.generator, track.sequencer.seed),
    automation: track.automation,
    channelHocket: channelHocketForPersistence(track.channelHocket),
    seedPaths: track.seedPaths,
    mode: track.mode,
    trigger: track.trigger,
  };
}

export function patchDocumentForPersistence(document: SequencerPatchDocument) {
  return {
    app: PATCH_APP_ID,
    schemaVersion: PATCH_SCHEMA_VERSION,
    savedAt: document.savedAt,
    transport: {
      tempoBpm: document.transport.tempoBpm,
      currentScoreId: document.transport.currentScoreId,
    },
    sequencer: sequencerForPersistence(document.sequencer),
    generatorEnabled: document.generatorEnabled,
    generator: normalizePatchGeneratorConfig(
      document.generator,
      document.sequencer.seed
    ),
    automation: document.automation,
    channelHocket: channelHocketForPersistence(document.channelHocket),
    setup: document.setup,
    ui: document.ui,
    seedPaths: document.seedPaths,
    project: {
      activeTrackId: document.project.activeTrackId,
      global: {
        tempoBpm: document.project.global.tempoBpm,
        cycleBeats: document.project.global.cycleBeats,
        channelConflictPolicy: document.project.global.channelConflictPolicy,
        channelLogicMatrix: document.project.global.channelLogicMatrix,
        conflictPriority: document.project.global.conflictPriority,
        trackFlowBoxes: document.project.global.trackFlowBoxes,
        synthEnabled: document.project.global.synthEnabled,
        synthPrograms: document.project.global.synthPrograms,
      },
      tracks: document.project.tracks.map(trackForPersistence),
    },
  };
}


export function withProjectState(
  flat: SequencerPatchFlatState,
  previousProject?: ParallelProjectPatch | null
): SequencerPatchDocument {
  const document: SequencerPatchDocument = {
    ...flat,
    schemaVersion: PATCH_SCHEMA_VERSION,
    project: buildProjectStateFromFlatPatch(flat, previousProject),
  };
  Object.defineProperty(document, "toJSON", {
    value: () => patchDocumentForPersistence(document),
    enumerable: false,
  });
  return document;
}


export function normalizeSubdivisionWeightsFromPatch(
  value: unknown,
  fallback: SubdivisionWeight[]
): SubdivisionWeight[] {
  const source = Array.isArray(value) ? value : fallback;
  const weights = source.flatMap((item) => {
    if (!isRecord(item)) return [];
    const subdivision = Math.round(numberValue(item.subdivision, 0));
    const weight = numberValue(item.weight, 0);
    if (subdivision <= 0 || subdivision > 64 || weight < 0) return [];
    return [{ subdivision, weight }];
  });
  return weights.length ? canonicalizeGatiWeights(weights) : cloneWeights(fallback);
}


export function normalizeJathiWeightsFromPatch(
  value: unknown,
  fallback: JathiWeight[]
): JathiWeight[] {
  const source = Array.isArray(value) ? value : fallback;
  const weights = source.flatMap((item) => {
    if (!isRecord(item)) return [];
    const jathi = Math.round(numberValue(item.jathi, 0));
    const weight = numberValue(item.weight, 0);
    if (!ALLOWED_JATHIS.includes(jathi) || weight < 0) return [];
    return [{ jathi, weight }];
  });
  return weights.length ? canonicalizeJathiWeights(weights) : cloneJathiWeights(fallback);
}

const JATHI_BHEDAM_OPS: JathiBhedamOp[] = [
  "retrograde",
  "exchangeAdjacent",
  "reorderFragments",
  "repeatFragment",
  "omitFragment",
  "split",
  "merge",
  "insert",
  "extend",
];

/**
 * Upper bound on `NotesPerCell` phrasing notes. Mirrors the Rust cap
 * `JATHI_BHEDAM_MAX_NOTES_PER_CELL` in `crates/cseq-model/src/lib.rs` — keep the
 * two in sync so a loaded selection clamps identically on both sides.
 */
const JB_MAX_NOTES_PER_CELL = 8;

/**
 * Normalize a (possibly mangled / legacy-absent) Jathi Bhedam selection from a
 * patch into a valid, bounded `JathiBhedamSelection`, or `null` when absent.
 * The Rust side re-clamps via `normalized()`, so this only needs to produce a
 * structurally valid, plausible shape (and never throw).
 */
export function normalizeJathiBhedamFromPatch(
  value: unknown
): JathiBhedamSelection | null {
  if (!isRecord(value)) return null;
  const specRaw = isRecord(value.spec) ? value.spec : {};
  const scheduleRaw = isRecord(specRaw.schedule) ? specRaw.schedule : {};
  const phrasingRaw = isRecord(specRaw.phrasing) ? specRaw.phrasing : {};
  const phrasing: JathiBhedamPhrasing =
    phrasingRaw.type === "notesPerCell"
      ? {
          type: "notesPerCell",
          notes: clamp(
            Math.round(numberValue(phrasingRaw.notes, 1)),
            1,
            JB_MAX_NOTES_PER_CELL
          ),
        }
      : { type: "accent" };
  const mukthayPolicy: MukthayPolicy =
    specRaw.mukthayPolicy === "truncateToSam" ? "truncateToSam" : "padToSam";
  const seedNumbers = (Array.isArray(specRaw.seedNumbers) ? specRaw.seedNumbers : [])
    .map((n) => clamp(Math.round(numberValue(n, 1)), 1, 8))
    .slice(0, 512);
  const fragments = (Array.isArray(specRaw.fragments) ? specRaw.fragments : []).flatMap(
    (f) =>
      isRecord(f)
        ? [
            {
              start: Math.max(0, Math.round(numberValue(f.start, 0))),
              end: Math.max(0, Math.round(numberValue(f.end, 0))),
            },
          ]
        : []
  );
  const menu = (Array.isArray(scheduleRaw.menu) ? scheduleRaw.menu : [])
    .flatMap((m) =>
      isRecord(m) && JATHI_BHEDAM_OPS.includes(m.op as JathiBhedamOp)
        ? [
            {
              op: m.op as JathiBhedamOp,
              weight: Math.max(0, Math.round(numberValue(m.weight, 1))),
            },
          ]
        : []
    )
    .slice(0, 32);
  const gatiWeights = (Array.isArray(value.gatiWeights) ? value.gatiWeights : []).flatMap(
    (g) =>
      isRecord(g)
        ? [
            {
              gati: clamp(Math.round(numberValue(g.gati, 4)), 1, 32),
              weight: Math.max(0, numberValue(g.weight, 1)),
            },
          ]
        : []
  );
  const lb = value.lengthBias;
  const lengthBias = isRecord(lb)
    ? {
        thresholdBeats: Math.max(0, Math.round(numberValue(lb.thresholdBeats, 0))),
        shorterMult: Math.max(0, numberValue(lb.shorterMult, 1)),
        longerMult: Math.max(0, numberValue(lb.longerMult, 1)),
      }
    : null;
  const cb = value.cyclePositionBias;
  const cyclePositionBias = isRecord(cb)
    ? {
        startFraction: clamp(numberValue(cb.startFraction, 0), 0, 1),
        startMult: Math.max(0, numberValue(cb.startMult, 1)),
        endFraction: clamp(numberValue(cb.endFraction, 0), 0, 1),
        endMult: Math.max(0, numberValue(cb.endMult, 1)),
      }
    : null;
  return {
    enabled: value.enabled === true,
    baseWeight: Math.max(0, numberValue(value.baseWeight, 0)),
    gatiWeights,
    lengthBias,
    cyclePositionBias,
    spec: {
      gati: clamp(Math.round(numberValue(specRaw.gati, 4)), 1, 32),
      beatsPerCycle: clamp(Math.round(numberValue(specRaw.beatsPerCycle, 8)), 1, 255),
      cycles: clamp(Math.round(numberValue(specRaw.cycles, 1)), 1, 32),
      seedNumbers,
      fragments,
      phrasing,
      schedule: {
        opsPerGeneration: clamp(
          Math.round(numberValue(scheduleRaw.opsPerGeneration, 0)),
          0,
          8
        ),
        menu,
      },
      mukthayPolicy,
      seed: Math.max(0, Math.round(numberValue(specRaw.seed, 0))),
    },
  };
}

export function cloneJathiBhedam(
  sel: JathiBhedamSelection | null | undefined
): JathiBhedamSelection | null {
  if (!sel) return null;
  return {
    enabled: sel.enabled,
    baseWeight: sel.baseWeight,
    gatiWeights: sel.gatiWeights.map((g) => ({ ...g })),
    lengthBias: sel.lengthBias ? { ...sel.lengthBias } : null,
    cyclePositionBias: sel.cyclePositionBias ? { ...sel.cyclePositionBias } : null,
    spec: {
      ...sel.spec,
      seedNumbers: [...sel.spec.seedNumbers],
      fragments: sel.spec.fragments.map((f) => ({ ...f })),
      phrasing: { ...sel.spec.phrasing },
      schedule: {
        opsPerGeneration: sel.spec.schedule.opsPerGeneration,
        menu: sel.spec.schedule.menu.map((m) => ({ ...m })),
      },
    },
  };
}

/** Upper bound on a Jathi Bhedam accent-group number (matches the Rust
 *  `JATHI_BHEDAM_MAX_NUMBER`; 9 is excluded). */
export const JATHI_BHEDAM_MAX_NUMBER = 8;

/**
 * The accent-cell matra lengths a Jathi Bhedam selection can emit, so playback
 * can build a rhythm chain for every bhedam cell (a missing chain would make an
 * `Accent`-phrased cell fall back to a single bare accent instead of being filled
 * by the Rhythm Shaper). Cells are `1..=JATHI_BHEDAM_MAX_NUMBER`.
 *
 * Even a non-evolving generation-0 phrase is fitted to the active section span;
 * that fit can append or truncate to a residual cell length not present in the
 * authored seed numbers. Without section context the safe coverage set for any
 * enabled selection is therefore the full `1..=8` domain. Returns `[]` for a
 * missing/disabled selection.
 */
export function jathiBhedamCellLengths(
  selection: JathiBhedamSelection | null | undefined
): number[] {
  if (!selection || !selection.enabled) return [];
  return Array.from({ length: JATHI_BHEDAM_MAX_NUMBER }, (_, i) => i + 1);
}


export function normalizeSwitchCountsFromPatch(
  value: unknown,
  fallback: SwitchCountWeight[]
): SwitchCountWeight[] {
  const source = Array.isArray(value) ? value : fallback;
  const weights = source.flatMap((item) => {
    if (!isRecord(item)) return [];
    const count = Math.round(numberValue(item.count, 0));
    const weight = numberValue(item.weight, 0);
    if (count < 0 || weight < 0) return [];
    return [{ count, weight }];
  });
  return weights.length ? weights : fallback.map((w) => ({ ...w }));
}


export function normalizePartCountWeightsFromPatch(
  value: unknown,
  fallback: CustomPartCountChoice[]
): CustomPartCountChoice[] {
  const source = Array.isArray(value) ? value : fallback;
  const weights = source.flatMap((item) => {
    if (!isRecord(item)) return [];
    const count = Math.round(numberValue(item.count, 0));
    const weight = numberValue(item.weight, 0);
    if (count <= 0 || count > 64 || weight < 0) return [];
    return [{ count, weight }];
  });
  const coalesced = coalescePartCountWeights(weights);
  return coalesced.length ? coalesced : clonePartCountWeights(fallback);
}

/** Canonical mutually-exclusive rest/tie percentage space. Rest owns the
 * first slice; tie is capped by the remainder, matching Rust sampling. */
export function normalizeRestTiePercentPair(
  restValue: unknown,
  tieValue: unknown
): {
  restProbabilityPercent: number;
  tieProbabilityPercent: number;
} {
  const percent = (raw: unknown) =>
    Math.min(100, Math.max(0, Math.round(numberValue(raw, 0))));
  const restProbabilityPercent = percent(restValue);
  return {
    restProbabilityPercent,
    tieProbabilityPercent: Math.min(
      percent(tieValue),
      100 - restProbabilityPercent
    ),
  };
}


export function normalizeBeatLocksFromPatch(value: unknown): PatchBeatLock[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seenIds = new Set<string>();
  const out: PatchBeatLock[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    let id = typeof item.id === "string" && item.id ? item.id : mintBeatLockId();
    while (seenIds.has(id)) id = mintBeatLockId();
    seenIds.add(id);
    const startBeat = Math.max(0, Math.round(numberValue(item.startBeat, 0)));
    const endBeat = Math.max(startBeat, Math.round(numberValue(item.endBeat, startBeat)));
    const patterns = Array.isArray(item.patterns)
      ? item.patterns.flatMap((p): PatchBeatLockPattern[] => {
          if (!isRecord(p)) return [];
          const pulses = Array.isArray(p.pulses)
            ? p.pulses
                .map((pulse) => Math.round(numberValue(pulse, 0)))
                .filter((pulse) => pulse > 0)
            : [];
          const weight = Math.max(0, Math.round(numberValue(p.weight, 0)));
          if (pulses.length === 0) return [];
          const cells = Array.isArray(p.cells)
            ? p.cells
                .slice(0, pulses.length)
                .map((cell) =>
                  isRecord(cell)
                    ? normalizeRestTiePercentPair(
                        cell.restProbabilityPercent,
                        cell.tieProbabilityPercent
                      )
                    : normalizeRestTiePercentPair(0, 0)
                )
            : [];
          return [{ pulses, weight, cells }];
        })
      : [];
    const defaultArticulation = normalizeRestTiePercentPair(
      item.restProbabilityPercent,
      item.tieProbabilityPercent
    );
    out.push({
      id,
      enabled: boolValue(item.enabled, true),
      mode: item.mode === "perBeat" ? "perBeat" : "span",
      startBeat,
      endBeat,
      patterns,
      unlockedWeight: Math.max(0, Math.round(numberValue(item.unlockedWeight, 0))),
      allowTieIn: boolValue(item.allowTieIn, false),
      allowTieOut: boolValue(item.allowTieOut, false),
      allowArticulation: boolValue(item.allowArticulation, false),
      ...defaultArticulation,
    });
  }
  return out;
}

let beatLockIdCounter = 0;
export function mintBeatLockId(): string {
  beatLockIdCounter += 1;
  return `lock-${beatLockIdCounter.toString(36)}`;
}

let shapeGroupIdCounter = 0;
export function mintShapeGroupId(): string {
  shapeGroupIdCounter += 1;
  return `shape-${shapeGroupIdCounter.toString(36)}`;
}

const SHAPE_DOMAINS: ShapeDomain[] = ["beat", "rhythmCell", "noteGroup"];
const SHAPE_STAGES: ShapeStage[] = ["articulation", "playbackFinalize"];

function normalizeShapeSelection(value: unknown, depth = 0): ShapeSelection {
  const fallback: ShapeSelection = { kind: "all" };
  if (!isRecord(value) || depth > 8) return fallback;
  const clampInt = (raw: unknown, lo: number, hi: number, dflt: number) =>
    Math.min(hi, Math.max(lo, Math.round(numberValue(raw, dflt))));
  switch (value.kind) {
    case "all":
    case "firstBeat":
    case "lastBeat":
    case "sectionStarts":
      return { kind: value.kind };
    case "beats":
      return {
        kind: "beats",
        beats: Array.isArray(value.beats)
          ? value.beats
              .map((beat) => Math.max(0, Math.round(numberValue(beat, 0))))
              .slice(0, 256)
          : [],
      };
    case "beatRange": {
      const startBeat = clampInt(value.startBeat, 0, 4095, 0);
      return {
        kind: "beatRange",
        startBeat,
        endBeat: Math.max(startBeat, clampInt(value.endBeat, 0, 4095, startBeat)),
      };
    }
    case "everyNth":
    case "everyNthMatra":
      return {
        kind: value.kind,
        n: clampInt(value.n, 1, 4096, 2),
        offset: clampInt(value.offset, 0, 4095, 0),
      };
    case "everyNthOnset":
      return {
        kind: "everyNthOnset",
        n: clampInt(value.n, 1, 4096, 2),
        offset: clampInt(value.offset, 0, 4095, 0),
        countRests: value.countRests === true,
      };
    case "gatiEquals":
      return { kind: "gatiEquals", gati: clampInt(value.gati, 1, 64, 4) };
    case "euclidean":
      return {
        kind: "euclidean",
        pulses: clampInt(value.pulses, 0, 4096, 3),
        steps: clampInt(value.steps, 1, 4096, 8),
        rotate: clampInt(value.rotate, 0, 4095, 0),
        invert: boolValue(value.invert, false),
      };
    case "cellIndexInSpan":
      return { kind: "cellIndexInSpan", index: clampInt(value.index, 0, 255, 0) };
    case "cellLenEquals":
      return { kind: "cellLenEquals", len: clampInt(value.len, 1, 64, 1) };
    case "cellState":
      return {
        kind: "cellState",
        state:
          value.state === "rest" || value.state === "tie" ? value.state : "play",
      };
    case "not":
      return { kind: "not", expr: normalizeShapeSelection(value.expr, depth + 1) };
    case "and":
    case "or":
      return {
        kind: value.kind,
        exprs: Array.isArray(value.exprs)
          ? value.exprs
              .slice(0, 8)
              .map((expr) => normalizeShapeSelection(expr, depth + 1))
          : [],
      };
    default:
      return fallback;
  }
}

function normalizeShapeOperation(value: unknown): ShapeOperation | null {
  if (!isRecord(value)) return null;
  const clampInt = (raw: unknown, lo: number, hi: number, dflt: number) =>
    Math.min(hi, Math.max(lo, Math.round(numberValue(raw, dflt))));
  switch (value.kind) {
    case "restProbability":
      return { kind: "restProbability", percent: clampInt(value.percent, 0, 100, 0) };
    case "tieProbability":
      return { kind: "tieProbability", percent: clampInt(value.percent, 0, 100, 0) };
    case "forcePlay":
      return { kind: "forcePlay" };
    case "scaleVelocity":
      return { kind: "scaleVelocity", percent: clampInt(value.percent, 0, 400, 100) };
    case "setVelocity":
      return { kind: "setVelocity", velocity: clampInt(value.velocity, 1, 127, 96) };
    case "transposePitch":
      return {
        kind: "transposePitch",
        semitones: clampInt(value.semitones, -48, 48, 0),
      };
    case "triggerRatchet":
      return {
        kind: "triggerRatchet",
        respectCooldown: value.respectCooldown !== false,
      };
    case "triggerOrnament":
      return {
        kind: "triggerOrnament",
        respectCooldown: value.respectCooldown !== false,
      };
    case "randomizePitch":
      return {
        kind: "randomizePitch",
        rangeSemitones: clampInt(value.rangeSemitones, 1, 48, 3),
      };
    case "randomWalkPitch":
      return {
        kind: "randomWalkPitch",
        stepSemitones: clampInt(value.stepSemitones, 1, 24, 2),
      };
    case "accumulatePitch":
      return {
        kind: "accumulatePitch",
        semitonesPerCycle: clampInt(value.semitonesPerCycle, -48, 48, 7),
        wrapSemitones: clampInt(value.wrapSemitones, 0, 96, 12),
      };
    case "invertPitch":
      return {
        kind: "invertPitch",
        centerPitch: clampInt(value.centerPitch, 0, 127, 60),
      };
    case "stretchIntervals":
      return {
        kind: "stretchIntervals",
        percent: clampInt(value.percent, 0, 400, 150),
        centerPitch: clampInt(value.centerPitch, 0, 127, 60),
      };
    case "quantizePitchToCollection":
      return { kind: "quantizePitchToCollection" };
    default:
      return null;
  }
}

/** Operations legal at a stage (mirrors the engine's stage gating). */
export function shapeOperationStage(operation: ShapeOperation): ShapeStage {
  switch (operation.kind) {
    case "restProbability":
    case "tieProbability":
    case "forcePlay":
      return "articulation";
    case "scaleVelocity":
    case "setVelocity":
    case "transposePitch":
    case "triggerRatchet":
    case "triggerOrnament":
    case "randomizePitch":
    case "randomWalkPitch":
    case "accumulatePitch":
    case "invertPitch":
    case "stretchIntervals":
    case "quantizePitchToCollection":
      return "playbackFinalize";
  }
}

/** Domains that exist at a stage (mirrors the engine's validation). */
export function shapeDomainsForStage(stage: ShapeStage): ShapeDomain[] {
  return stage === "articulation" ? ["beat", "rhythmCell"] : ["beat", "noteGroup"];
}

/**
 * Drop selectors that cannot exist in the domain (cell selectors are
 * rhythmCell-only — mirrors the engine's SelectorDomainMismatch validation).
 * Emptied and/or lists collapse toward `all`.
 */
export function sanitizeShapeSelectionForDomain(
  selection: ShapeSelection,
  domain: ShapeDomain
): ShapeSelection {
  const legal = (expr: ShapeSelection): ShapeSelection | null => {
    switch (expr.kind) {
      case "cellIndexInSpan":
      case "cellLenEquals":
      case "cellState":
        return domain === "rhythmCell" ? expr : null;
      // Onset counting needs note-start structure — never the beat axis.
      case "everyNthOnset":
        return domain === "beat" ? null : expr;
      case "not": {
        const inner = legal(expr.expr);
        return inner === null ? null : { kind: "not", expr: inner };
      }
      case "and":
      case "or": {
        const exprs = expr.exprs
          .map(legal)
          .filter((entry): entry is ShapeSelection => entry !== null);
        if (exprs.length === 0) return null;
        if (exprs.length === 1) return exprs[0]!;
        return { kind: expr.kind, exprs };
      }
      default:
        return expr;
    }
  };
  return legal(selection) ?? { kind: "all" };
}

export function normalizeShapeGroupsFromPatch(value: unknown): ShapeGroupSpec[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const out: ShapeGroupSpec[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    let id = typeof item.id === "string" && item.id ? item.id : mintShapeGroupId();
    while (seenIds.has(id)) id = mintShapeGroupId();
    seenIds.add(id);
    const stage = SHAPE_STAGES.includes(item.stage as ShapeStage)
      ? (item.stage as ShapeStage)
      : "articulation";
    const domainCandidate = SHAPE_DOMAINS.includes(item.domain as ShapeDomain)
      ? (item.domain as ShapeDomain)
      : "beat";
    const domain = shapeDomainsForStage(stage).includes(domainCandidate)
      ? domainCandidate
      : "beat";
    const operations = Array.isArray(item.operations)
      ? item.operations
          .map(normalizeShapeOperation)
          .filter((op): op is ShapeOperation => op !== null)
          .filter((op) => shapeOperationStage(op) === stage)
          .slice(0, 8)
      : [];
    out.push({
      id,
      name: typeof item.name === "string" ? item.name.slice(0, 64) : "",
      enabled: boolValue(item.enabled, true),
      domain,
      stage,
      selection: sanitizeShapeSelectionForDomain(
        normalizeShapeSelection(item.selection),
        domain
      ),
      chancePercent: Math.min(
        100,
        Math.max(0, Math.round(numberValue(item.chancePercent, 100)))
      ),
      operations,
    });
  }
  return out;
}

export function normalizeArbitraryTargetsFromPatch(
  value: unknown,
  fallback: WeightedSubdivisionTarget[]
): WeightedSubdivisionTarget[] {
  const explicit = Array.isArray(value);
  const source = explicit ? value : fallback;
  const weights = source.flatMap((item) => {
    if (!isRecord(item)) return [];
    const spanLen = Math.round(numberValue(item.spanLen, 0));
    const weight = numberValue(item.weight, 0);
    if (!RHYTHM_LENGTHS.includes(spanLen) || weight < 0) return [];
    return [{ spanLen, weight }];
  });
  return weights.length ? weights : explicit ? [] : cloneArbitraryTargets(fallback);
}


export function normalizeArbitraryClumpsFromPatch(
  value: unknown,
  fallback: WeightedClumpLength[]
): WeightedClumpLength[] {
  const explicit = Array.isArray(value);
  const source = explicit ? value : fallback;
  const weights = source.flatMap((item) => {
    if (!isRecord(item)) return [];
    const count = Math.round(numberValue(item.count, 0));
    const weight = numberValue(item.weight, 0);
    if (count <= 0 || weight < 0) return [];
    return [{ count, weight }];
  });
  return weights.length ? weights : explicit ? [] : cloneArbitraryClumps(fallback);
}


export function rhythmSpeedWeightKey(
  contextKind: RhythmSpeedContextKind,
  contextValue: number,
  choiceId: RhythmSpeedChoiceId
): string {
  return `${contextKind}:${contextValue}:${choiceId}`;
}


export function rhythmSpeedChoicesForContext(contextKind: RhythmSpeedContextKind) {
  if (contextKind === "jathi") {
    return RHYTHM_SPEED_CHOICES.filter((choice) => choice.multiplier.denominator === 1);
  }
  return RHYTHM_SPEED_CHOICES;
}


export function normalizeRhythmSpeedWeightsFromPatch(value: unknown): Record<string, number> {
  const next = cloneRhythmSpeedWeights(DEFAULT_RHYTHM_SPEED_WEIGHTS);
  if (!isRecord(value)) {
    return next;
  }
  for (const contextKind of RHYTHM_SPEED_CONTEXT_KINDS) {
    for (const contextValue of RHYTHM_LENGTHS) {
      for (const choice of rhythmSpeedChoicesForContext(contextKind)) {
        const key = rhythmSpeedWeightKey(contextKind, contextValue, choice.id);
        next[key] = Math.max(0, numberValue(value[key], next[key] ?? 0));
      }
    }
  }
  return next;
}


export function normalizeCustomSubdivisionFromPatch(
  value: unknown
): CustomSubdivision | null {
  if (!isRecord(value)) {
    return null;
  }
  const divisionsSource = Array.isArray(value.divisions) ? value.divisions : [];
  const divisions = divisionsSource
    .slice(0, 16)
    .flatMap((division) => {
      if (!isRecord(division)) return [];
      const gatiWeights = normalizeSubdivisionWeightsFromPatch(
        division.gatiWeights,
        [{ subdivision: 4, weight: 1 }]
      );
      return gatiWeights.some((weight) => weight.weight > 0)
        ? [{ gatiWeights }]
        : [];
    });
  const partCountWeights = Array.isArray(value.partCountWeights)
    ? normalizePartCountWeightsFromPatch(value.partCountWeights, [])
    : divisions.length > 0
      ? [{ count: divisions.length, weight: 1 }]
      : [];
  const partGatiWeights = Array.isArray(value.partGatiWeights)
    ? normalizeSubdivisionWeightsFromPatch(value.partGatiWeights, [])
    : divisions[0]?.gatiWeights
      ? cloneWeights(divisions[0].gatiWeights)
      : [];
  const perBeatWeight = Math.max(0, numberValue(value.perBeatWeight, 0));
  const equalPartsWeight = Math.max(0, numberValue(value.equalPartsWeight, 1));
  // A spec with neither mode weight does nothing; drop it entirely.
  if (perBeatWeight <= 0 && equalPartsWeight <= 0) {
    return null;
  }
  // Missing equal-parts inputs are only fatal when equal parts can actually win.
  // This mirrors `cleanCustomSubdivision` (the save path) so a spec the save side
  // keeps (e.g. pure per-beat mode) is not silently dropped on load.
  if (
    equalPartsWeight > 0 &&
    (!partCountWeights.some((weight) => weight.weight > 0) ||
      (!partGatiWeights.some((weight) => weight.weight > 0) &&
        !divisions.length))
  ) {
    return null;
  }
  return {
    perBeatWeight,
    equalPartsWeight,
    partCountWeights,
    partGatiWeights,
    divisions,
    jathiWeights: normalizeJathiWeightsFromPatch(
      value.jathiWeights,
      DEFAULT_JATHI_WEIGHTS
    ),
  };
}


export function cleanCustomSubdivision(
  custom: CustomSubdivision | null | undefined
): CustomSubdivision | null {
  if (!custom) {
    return null;
  }
  const perBeatWeight = Number.isFinite(custom.perBeatWeight)
    ? Math.max(0, custom.perBeatWeight)
    : 0;
  const equalPartsWeight = Number.isFinite(custom.equalPartsWeight)
    ? Math.max(0, custom.equalPartsWeight)
    : 0;
  if (perBeatWeight <= 0 && equalPartsWeight <= 0) {
    return null;
  }
  const partCountWeights = coalescePartCountWeights(
    custom.partCountWeights.slice(0, 16)
  );
  const partGatiWeights = custom.partGatiWeights.filter(
    (weight) => Number.isFinite(weight.subdivision) && Number.isFinite(weight.weight)
  );
  const divisions = custom.divisions
    .slice(0, 16)
    .map((division) => ({
      gatiWeights: canonicalizeGatiWeights(division.gatiWeights),
    }))
    .filter((division) =>
      division.gatiWeights.some((weight) => weight.weight > 0)
    );
  if (
    equalPartsWeight > 0 &&
    (!partCountWeights.some((weight) => weight.weight > 0) ||
      (!partGatiWeights.some((weight) => weight.weight > 0) && !divisions.length))
  ) {
    return null;
  }
  return {
    perBeatWeight,
    equalPartsWeight,
    partCountWeights,
    partGatiWeights: canonicalizeGatiWeights(partGatiWeights),
    divisions,
    jathiWeights: [],
  };
}


export function customSubdivisionForRequest(
  custom: CustomSubdivision | null | undefined
): CustomSubdivision | null {
  const cleaned = cleanCustomSubdivision(custom);
  return cleaned
    ? {
        ...cleaned,
        jathiWeights: [],
      }
    : null;
}


export function normalizeBoundariesFromPatch(
  value: unknown,
  cycleBeats: number
): BoundaryPoint[] {
  const source = Array.isArray(value) ? value : [];
  const boundaries = source.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [
      {
        id: stringValue(
          item.id,
          boundaryIdForAfterBeat(Math.round(numberValue(item.afterBeat, 1)))
        ),
        afterBeat: Math.round(numberValue(item.afterBeat, 1)),
        changeProbability: clamp(numberValue(item.changeProbability, 1), 0, 1),
        weights: normalizeSubdivisionWeightsFromPatch(
          Object.prototype.hasOwnProperty.call(item, "subdivision")
            ? fixedSubdivisionWeights(numberValue(item.subdivision, 4))
            : item.weights,
          NEUTRAL_INITIAL_WEIGHTS
        ),
        jathiWeights: normalizeJathiWeightsFromPatch(
          Object.prototype.hasOwnProperty.call(item, "grouping")
            ? fixedGroupingWeights(
                item.grouping === null ? null : numberValue(item.grouping, 0)
              )
            : item.jathiWeights,
          NEUTRAL_JATHI_WEIGHTS
        ),
        customSubdivision: normalizeCustomSubdivisionFromPatch(
          item.customSubdivision
        ),
        jathiBhedam: normalizeJathiBhedamFromPatch(item.jathiBhedam),
      },
    ];
  });
  return normalizeBoundaries(boundaries, cycleBeats);
}


export function normalizeStringArrayRecord(value: unknown): Record<number, string[]> {
  if (!isRecord(value)) return {};
  const result: Record<number, string[]> = {};
  for (const [key, rawList] of Object.entries(value)) {
    const length = parseInt(key, 10);
    if (!Number.isFinite(length) || length <= 0) continue;
    if (!Array.isArray(rawList)) continue;
    const cleaned = rawList
      .filter((item): item is string => typeof item === "string")
      .filter((item, index, list) => list.indexOf(item) === index);
    if (cleaned.length > 0) {
      result[length] = cleaned;
    }
  }
  return result;
}


export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
}


export function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const next = numberValue(raw, Number.NaN);
    if (Number.isFinite(next) && next >= 0) {
      result[key] = Math.round(next);
    }
  }
  return result;
}


export function normalizeRhythmArticulationSeedPolicy(
  value: unknown
): RhythmArticulationSeedPolicy {
  if (!isRecord(value)) return defaultRhythmArticulationSeedPolicy();
  return {
    seed: normalizeSeedValue(value.seed, 0),
    followRhythmChance: clamp(
      Math.round(numberValue(value.followRhythmChance, 100)),
      0,
      100
    ),
  };
}


export function normalizeRhythmArticulationCell(
  value: unknown
): RhythmArticulationCellState | null {
  if (!isRecord(value)) return null;
  const restProbabilityPercent = clamp(
    Math.round(numberValue(value.restProbabilityPercent, 0)),
    0,
    100
  );
  const tieProbabilityPercent = clamp(
    Math.round(numberValue(value.tieProbabilityPercent, 0)),
    0,
    100 - restProbabilityPercent
  );
  if (restProbabilityPercent <= 0 && tieProbabilityPercent <= 0) {
    return null;
  }
  return { restProbabilityPercent, tieProbabilityPercent };
}


export function normalizeRhythmArticulationCells(
  value: unknown
): Record<string, RhythmArticulationCellState> {
  if (!isRecord(value)) return {};
  const result: Record<string, RhythmArticulationCellState> = {};
  for (const [key, raw] of Object.entries(value)) {
    const cell = normalizeRhythmArticulationCell(raw);
    if (cell) {
      result[key] = cell;
    }
  }
  return result;
}


export function normalizeRhythmArticulationBlendMode(
  value: unknown
): RhythmArticulationBlendMode {
  return value === "average" || value === "weighted" || value === "manualOverrides"
    ? value
    : "manualOverrides";
}


export function normalizeRhythmArticulationBlendState(
  value: unknown
): RhythmArticulationBlendState {
  if (!isRecord(value)) return defaultRhythmArticulationBlendState();
  return {
    mode: normalizeRhythmArticulationBlendMode(value.mode),
    manualWeight: Math.max(0, numberValue(value.manualWeight, 1)),
    fragmentWeight: Math.max(0, numberValue(value.fragmentWeight, 1)),
    sectionWeight: Math.max(0, numberValue(value.sectionWeight, 1)),
    cycleWeight: Math.max(0, numberValue(value.cycleWeight, 1)),
  };
}


export function normalizeRhythmArticulationProbabilityState(
  value: unknown
): RhythmArticulationProbabilityState {
  if (!isRecord(value)) return defaultRhythmArticulationProbabilityState();
  const restProbabilityPercent = clamp(
    Math.round(numberValue(value.restProbabilityPercent, 0)),
    0,
    100
  );
  const tieProbabilityPercent = clamp(
    Math.round(numberValue(value.tieProbabilityPercent, 0)),
    0,
    100 - restProbabilityPercent
  );
  return {
    enabled: boolValue(value.enabled, false),
    restProbabilityPercent,
    tieProbabilityPercent,
  };
}


export function normalizeRhythmPositionArticulationState(
  value: unknown
): RhythmPositionArticulationState {
  if (!isRecord(value)) return defaultRhythmPositionArticulationState();
  return {
    single: normalizeRhythmArticulationProbabilityState(value.single),
    first: normalizeRhythmArticulationProbabilityState(value.first),
    middle: normalizeRhythmArticulationProbabilityState(value.middle),
    last: normalizeRhythmArticulationProbabilityState(value.last),
  };
}


export function normalizeRhythmArticulationNeighborState(
  value: unknown
): RhythmArticulationNeighborState {
  if (!isRecord(value)) return defaultRhythmArticulationNeighborState();
  return {
    playAfterPlayMultiplierPercent: clamp(
      Math.round(numberValue(value.playAfterPlayMultiplierPercent, 100)),
      0,
      200
    ),
    restAfterRestMultiplierPercent: clamp(
      Math.round(numberValue(value.restAfterRestMultiplierPercent, 100)),
      0,
      200
    ),
    tieAfterTieMultiplierPercent: clamp(
      Math.round(numberValue(value.tieAfterTieMultiplierPercent, 100)),
      0,
      200
    ),
  };
}


export function normalizeNestedNumberRecord(value: unknown): Record<number, Record<string, number>> {
  if (!isRecord(value)) return {};
  const result: Record<number, Record<string, number>> = {};
  for (const [key, rawRecord] of Object.entries(value)) {
    const length = parseInt(key, 10);
    if (!Number.isFinite(length) || length <= 0) continue;
    const record = normalizeNumberRecord(rawRecord);
    if (Object.keys(record).length > 0) {
      result[length] = record;
    }
  }
  return result;
}


export function normalizeSeedMode(value: unknown): SeedModeName {
  return value === "locked" ||
    value === "history" ||
    value === "drift" ||
    value === "morph"
    ? value
    : "perCycle";
}

function normalizePersistedSeedMode(value: unknown): SeedModeName {
  return value === "locked" || value === "history" ? value : "perCycle";
}

function normalizePersistedChannelSeedBehavior(
  value: unknown
): RhythmSeedBehaviorName {
  return value === "locked" || value === "perCycle" || value === "history"
    ? value
    : "followGlobal";
}


export function normalizeRhythmSeedBehavior(value: unknown): RhythmSeedBehaviorName {
  return value === "locked" ||
    value === "perCycle" ||
    value === "history" ||
    value === "drift" ||
    value === "morph"
    ? value
    : "followGlobal";
}


/** Clamp a persisted Drift/Morph chance to the 0-100 percent range the
 * engine accepts, defaulting when the field is absent (pre-v7 documents). */
export function normalizeNewSeedChance(value: unknown): number {
  return Math.min(
    100,
    Math.max(0, Math.round(numberValue(value, DEFAULT_NEW_SEED_CHANCE)))
  );
}


/** Clamp a persisted Morph hold chance to 0-100 percent, defaulting when the
 * field is absent (pre-v7 documents). */
export function normalizeHoldChance(value: unknown): number {
  return Math.min(
    100,
    Math.max(0, Math.round(numberValue(value, DEFAULT_HOLD_CHANCE)))
  );
}


/** Clamp persisted Morph blend cycles into the 1-64 range the engine
 * accepts — the lower bound is 1, not maxHistory's 0: a zero blend would
 * feed a division. Defaults when the field is absent (pre-v7 documents). */
export function normalizeBlendCycles(value: unknown): number {
  return Math.min(
    64,
    Math.max(1, Math.round(numberValue(value, DEFAULT_BLEND_CYCLES)))
  );
}


export function normalizeMarkovOrder(value: unknown): MarkovOrder {
  return value === "second" ? "second" : "first";
}


export function normalizeRhythmExtrapolationStrategy(
  value: unknown
): RhythmExtrapolationStrategy {
  return value === "boundaryProjection" ||
    value === "densityPreserving" ||
    value === "shapePreserving" ||
    value === "sparseNearest"
    ? value
    : "hybridTransport";
}


export function normalizeRhythmMaterializeMode(value: unknown): RhythmMaterializeMode {
  return value === "fillEmpty" ? "fillEmpty" : "replace";
}


export function normalizeRhythmFallbackMode(value: unknown): RhythmFallbackMode {
  return value === "weighted" ? "weighted" : "static";
}


export function normalizeRatchetCurve(value: unknown): RatchetCurve {
  return value === "accelerando" ||
    value === "retardando" ||
    value === "accelerandoRetardando" ||
    value === "retardandoAccelerando"
    ? value
    : "even";
}


export function normalizeRatchetTemporalEasingShape(
  value: unknown
): RatchetTemporalEasingShape {
  return value === "humanizeTight" ||
    value === "humanizeLoose" ||
    value === "subtleAccelerando" ||
    value === "subtleRetardando" ||
    value === "sway" ||
    value === "lilt"
    ? value
    : "humanize";
}


export function normalizeRatchetCurveWeights(value: unknown): RatchetCurveWeights {
  const source = isRecord(value) ? value : {};
  return {
    even: Math.max(0, numberValue(source.even, DEFAULT_RATCHET_CURVE_WEIGHTS.even)),
    accelerando: Math.max(
      0,
      numberValue(source.accelerando, DEFAULT_RATCHET_CURVE_WEIGHTS.accelerando)
    ),
    retardando: Math.max(
      0,
      numberValue(source.retardando, DEFAULT_RATCHET_CURVE_WEIGHTS.retardando)
    ),
    accelerandoRetardando: Math.max(
      0,
      numberValue(
        source.accelerandoRetardando,
        DEFAULT_RATCHET_CURVE_WEIGHTS.accelerandoRetardando
      )
    ),
    retardandoAccelerando: Math.max(
      0,
      numberValue(
        source.retardandoAccelerando,
        DEFAULT_RATCHET_CURVE_WEIGHTS.retardandoAccelerando
      )
    ),
  };
}


export function normalizeRatchetTemporalEasingWeights(
  value: unknown
): RatchetTemporalEasingWeights {
  const source = isRecord(value) ? value : {};
  return {
    humanize: Math.max(0, numberValue(source.humanize, DEFAULT_RATCHET_EASING_WEIGHTS.humanize)),
    humanizeTight: Math.max(
      0,
      numberValue(source.humanizeTight, DEFAULT_RATCHET_EASING_WEIGHTS.humanizeTight)
    ),
    humanizeLoose: Math.max(
      0,
      numberValue(source.humanizeLoose, DEFAULT_RATCHET_EASING_WEIGHTS.humanizeLoose)
    ),
    subtleAccelerando: Math.max(
      0,
      numberValue(
        source.subtleAccelerando,
        DEFAULT_RATCHET_EASING_WEIGHTS.subtleAccelerando
      )
    ),
    subtleRetardando: Math.max(
      0,
      numberValue(
        source.subtleRetardando,
        DEFAULT_RATCHET_EASING_WEIGHTS.subtleRetardando
      )
    ),
    sway: Math.max(0, numberValue(source.sway, DEFAULT_RATCHET_EASING_WEIGHTS.sway)),
    lilt: Math.max(0, numberValue(source.lilt, DEFAULT_RATCHET_EASING_WEIGHTS.lilt)),
  };
}


export function normalizeRatchetTimeCurvePoints(value: unknown): RatchetTimeCurvePoint[] {
  if (!Array.isArray(value)) {
    return cloneRatchetTimeCurvePoints(DEFAULT_RATCHET_TIME_CURVE_POINTS);
  }
  const points = value
    .filter(isRecord)
    .map((point) => ({
      x: clamp(numberValue(point.x, 0), 0, 1),
      y: clamp(numberValue(point.y, 0.5), 0, 1),
    }))
    .sort((a, b) => a.x - b.x)
    .filter((point, index, all) => index === 0 || point.x > all[index - 1]!.x + 0.001);
  if (points.length < 2) {
    return cloneRatchetTimeCurvePoints(DEFAULT_RATCHET_TIME_CURVE_POINTS);
  }
  if (points[0]!.x > 0) {
    points.unshift({ x: 0, y: points[0]!.y });
  }
  if (points.at(-1)!.x < 1) {
    points.push({ x: 1, y: points.at(-1)!.y });
  }
  return points;
}


export function normalizeRatchetTimeCurveChoices(value: unknown): RatchetTimeCurveChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).flatMap((choice) => {
    const id = typeof choice.id === "string" ? choice.id : "";
    const weight = Math.max(0, numberValue(choice.weight, 0));
    // Choice geometry is playback-authored data, not editor geometry. Preserve
    // every valid normalized point verbatim (including order and noncanonical
    // preset shapes). Rust rejects out-of-range playback input, so hostile
    // points are discarded here rather than letting one bad recalled choice
    // disable the whole Ratchet config. Validate before normalizing so malformed
    // short choices are actually dropped instead of being replaced by the
    // drawn-curve default.
    const points = Array.isArray(choice.points)
      ? choice.points.filter(isRecord).flatMap((point) =>
          typeof point.x === "number" &&
          Number.isFinite(point.x) &&
          point.x >= 0 &&
          point.x <= 1 &&
          typeof point.y === "number" &&
          Number.isFinite(point.y) &&
          point.y >= 0 &&
          point.y <= 1
            ? [{ x: point.x, y: point.y }]
            : []
        )
      : [];
    // Zero-weight choices are KEPT (schema v4): automation can raise a weight
    // at runtime, and recall must round-trip every authored choice object
    // (2026-07 audit findings 15 & 18). Only malformed geometry is dropped.
    if (id.length === 0 || points.length < 2) {
      return [];
    }
    return [{ id, weight, points }];
  });
}


/** True when the drawn curve is timing-neutral: a constant-y curve samples to
 * uniform segment spacing at any level. */
export function ratchetTimeCurvePointsAreFlat(points: RatchetTimeCurvePoint[]): boolean {
  const first = points[0]?.y;
  if (first === undefined) {
    return true;
  }
  return points.every((point) => Math.abs(point.y - first) < 1e-6);
}


export function normalizeRatchetTimeCurve(
  value: unknown,
  mode: "ratchet" | "cycleFlux" = "ratchet"
): RatchetTimeCurveSpec {
  const source = isRecord(value) ? value : {};
  const points = normalizeRatchetTimeCurvePoints(source.points);
  const choices = normalizeRatchetTimeCurveChoices(source.choices);
  // `enabled` migration (2026-07 audit finding 10, schema v4):
  //  1. An explicit boolean is preserved verbatim on ANY schema — an old
  //     `enabled: false` stays false even with authored points.
  //  2. A missing timeCurve object is disabled.
  //  3. An object without the flag (pre-v4) infers AUTHORSHIP: any positive
  //     choice weight or a non-flat drawn curve. This is an intent heuristic,
  //     not "what sounded" — pre-v4 playback force-enabled the curve, which
  //     silently overrode named curves and temporal easing (the audited bug).
  // Cycle-flux curves keep the legacy always-on default: flux has its own
  // enabled switch and its BPM curve was always meant to apply.
  const enabled =
    typeof source.enabled === "boolean"
      ? source.enabled
      : mode === "cycleFlux"
        ? true
        : isRecord(value) &&
          (choices.some((choice) => choice.weight > 0) ||
            !ratchetTimeCurvePointsAreFlat(points));
  return {
    enabled,
    points,
    variance: clamp(numberValue(source.variance, 0), 0, 1),
    interpolate: boolValue(source.interpolate, true),
    interpolationMin: clamp(numberValue(source.interpolationMin, 0), 0, 1),
    interpolationMax: clamp(numberValue(source.interpolationMax, 1), 0, 1),
    choices,
  };
}


export function normalizeCycleTempoFlux(value: unknown): PatchCycleTempoFluxState {
  const source = isRecord(value) ? value : {};
  return {
    enabled: boolValue(source.enabled, false),
    minBpm: clamp(
      numberValue(source.minBpm, NEUTRAL_TEMPO_BPM),
      20,
      400
    ),
    maxBpm: clamp(
      numberValue(source.maxBpm, NEUTRAL_TEMPO_BPM),
      20,
      400
    ),
    seed: Math.max(0, Math.round(numberValue(source.seed, 0))),
    curve: {
      ...normalizeRatchetTimeCurve(source.curve, "cycleFlux"),
      points: isRecord(source.curve)
        ? normalizeRatchetTimeCurvePoints(source.curve.points)
        : cloneRatchetTimeCurvePoints(DEFAULT_CYCLE_TEMPO_FLUX_CURVE_POINTS),
    },
  };
}


export function normalizeRatchetModifierOperation(value: unknown): RatchetModifierOperation {
  return value === "add" ? "add" : "multiply";
}


export function normalizeRatchetModifierAmount(
  value: unknown,
  fallback: number,
  operation: RatchetModifierOperation
): number {
  const amount = numberValue(value, fallback);
  return operation === "add" ? clamp(amount, -1, 1) : Math.max(0, amount);
}


export function normalizeRatchetSpeedStrategy(value: unknown): RatchetSpeedStrategy {
  return value === "pulsesPerMatra" || value === "beatRate"
    ? value
    : "audibleRate";
}


export function normalizeRatchetSpeedDistribution(value: unknown): RatchetSpeedDistribution {
  return value === "towardMedian" ||
    value === "awayFromMedian" ||
    value === "favorSlow" ||
    value === "favorFast"
    ? value
    : "uniform";
}


export function normalizeRatchetVelocityMode(value: unknown): RatchetVelocityMode {
  return value === "absolute" ? "absolute" : "relative";
}


export function normalizeRatchetDurationBasis(value: unknown): RatchetDurationBasis {
  return value === "percentOfBeat" ? "percentOfBeat" : "matras";
}


export function normalizeRatchetCooldownBasis(value: unknown): RatchetCooldownBasis {
  if (value === "milliseconds" || value === "beats" || value === "percentOfBeat") {
    return value;
  }
  return "matras";
}


export function normalizeGraceNotePlacement(value: unknown): GraceNotePlacement {
  return value === "onBeat" ? "onBeat" : "beforeBeat";
}


export function gracePlacementWeightsFromPlacement(
  placement: GraceNotePlacement
): GraceNotePlacementWeights {
  return placement === "onBeat"
    ? { beforeBeat: 0, onBeat: 100 }
    : { beforeBeat: 100, onBeat: 0 };
}


export function normalizeGraceNotePlacementWeights(
  value: unknown,
  fallbackPlacement: GraceNotePlacement
): GraceNotePlacementWeights {
  const explicit = isRecord(value);
  const source = isRecord(value) ? value : {};
  const beforeBeat = Math.max(0, Math.round(numberValue(source.beforeBeat, 0)));
  const onBeat = Math.max(0, Math.round(numberValue(source.onBeat, 0)));
  if (beforeBeat > 0 || onBeat > 0) {
    return { beforeBeat, onBeat };
  }
  if (explicit) {
    return { beforeBeat: 0, onBeat: 0 };
  }
  return gracePlacementWeightsFromPlacement(fallbackPlacement);
}


export function normalizeGraceNoteDurationBasis(value: unknown): GraceNoteDurationBasis {
  return value === "milliseconds" ? "milliseconds" : "percentOfBeat";
}


export function normalizeDelayQuantization(value: unknown): DelayQuantizationMode {
  return value === "quantized" ? "quantized" : "unquantized";
}


export function normalizeDelayDistribution(value: unknown): DelayTimeDistribution {
  return value === "uniform" ||
    value === "late" ||
    value === "center" ||
    value === "edges"
    ? value
    : "early";
}


export function normalizeRatchetCooldownAmount(
  value: number,
  basis: RatchetCooldownBasis
): number {
  const clamped = clamp(value, 0, RATCHET_COOLDOWN_LIMITS[basis].max);
  return basis === "matras" ? Math.round(clamped) : clamped;
}


export function normalizeGraceNoteDurationAmount(
  value: number,
  basis: GraceNoteDurationBasis
): number {
  return clamp(value, 0, ORNAMENT_DURATION_LIMITS[basis].max);
}


export function normalizeDelayTuplets(value: unknown): DelayTupletWeight[] {
  const entries = Array.isArray(value) ? value : [];
  const byTuplet = new Map<number, number>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const tuplet = Math.max(1, Math.round(numberValue(entry.tuplet, 0)));
    const weight = Math.max(0, Math.round(numberValue(entry.weight, 0)));
    if (DELAY_TUPLETS.includes(tuplet as (typeof DELAY_TUPLETS)[number])) {
      byTuplet.set(tuplet, weight);
    }
  }
  if (byTuplet.size === 0) {
    return [];
  }
  return DELAY_TUPLETS.map((tuplet) => ({
    tuplet,
    weight: byTuplet.get(tuplet) ?? 1,
  }));
}


export function normalizeDelayOrnamentSpec(value: unknown): DelayOrnamentSpec {
  const source = isRecord(value) ? value : {};
  const basis = normalizeRatchetCooldownBasis(source.basis);
  return {
    enabled: boolValue(source.enabled, false),
    probability: clamp(numberValue(source.probability, 0), 0, 1),
    modifiers: normalizeRatchetModifiers(source.modifiers),
    min: normalizeRatchetCooldownAmount(numberValue(source.min, 0), basis),
    max: normalizeRatchetCooldownAmount(numberValue(source.max, 0), basis),
    basis,
    quantization: normalizeDelayQuantization(source.quantization),
    distribution: normalizeDelayDistribution(source.distribution),
    tuplets: normalizeDelayTuplets(source.tuplets),
  };
}


export function normalizeRatchetModifiers(value: unknown): RatchetProbabilityModifiers {
  const source = isRecord(value) ? value : {};
  const slowNote = isRecord(source.slowNote) ? source.slowNote : {};
  const fastNote = isRecord(source.fastNote) ? source.fastNote : {};
  const operations = isRecord(source.operations) ? source.operations : {};
  const slowOperation = normalizeRatchetModifierOperation(slowNote.operation);
  const fastOperation = normalizeRatchetModifierOperation(fastNote.operation);
  const normalizedOperations = {
    accentSpanStart: normalizeRatchetModifierOperation(operations.accentSpanStart),
    accentSpanEnd: normalizeRatchetModifierOperation(operations.accentSpanEnd),
    sectionStart: normalizeRatchetModifierOperation(operations.sectionStart),
    sectionEnd: normalizeRatchetModifierOperation(operations.sectionEnd),
    cycleStart: normalizeRatchetModifierOperation(operations.cycleStart),
    cycleEnd: normalizeRatchetModifierOperation(operations.cycleEnd),
  };
  return {
    slowNote: {
      enabled: boolValue(slowNote.enabled, DEFAULT_RATCHET_MODIFIERS.slowNote.enabled),
      threshold: Math.max(
        0,
        numberValue(slowNote.threshold, DEFAULT_RATCHET_MODIFIERS.slowNote.threshold)
      ),
      basis: normalizeRatchetDurationBasis(slowNote.basis),
      multiplier: normalizeRatchetModifierAmount(
        slowNote.multiplier,
        slowOperation === "add" ? 0 : DEFAULT_RATCHET_MODIFIERS.slowNote.multiplier,
        slowOperation
      ),
      operation: slowOperation,
    },
    fastNote: {
      enabled: boolValue(fastNote.enabled, DEFAULT_RATCHET_MODIFIERS.fastNote.enabled),
      threshold: Math.max(
        0,
        numberValue(fastNote.threshold, DEFAULT_RATCHET_MODIFIERS.fastNote.threshold)
      ),
      basis: normalizeRatchetDurationBasis(fastNote.basis),
      multiplier: normalizeRatchetModifierAmount(
        fastNote.multiplier,
        fastOperation === "add" ? 0 : DEFAULT_RATCHET_MODIFIERS.fastNote.multiplier,
        fastOperation
      ),
      operation: fastOperation,
    },
    position: normalizeRatchetPositionModifier(source.position),
    accentSpanStart: normalizeRatchetModifierAmount(
      source.accentSpanStart,
      normalizedOperations.accentSpanStart === "add"
        ? 0
        : DEFAULT_RATCHET_MODIFIERS.accentSpanStart,
      normalizedOperations.accentSpanStart
    ),
    accentSpanEnd: normalizeRatchetModifierAmount(
      source.accentSpanEnd,
      normalizedOperations.accentSpanEnd === "add"
        ? 0
        : DEFAULT_RATCHET_MODIFIERS.accentSpanEnd,
      normalizedOperations.accentSpanEnd
    ),
    sectionStart: normalizeRatchetModifierAmount(
      source.sectionStart,
      normalizedOperations.sectionStart === "add"
        ? 0
        : DEFAULT_RATCHET_MODIFIERS.sectionStart,
      normalizedOperations.sectionStart
    ),
    sectionEnd: normalizeRatchetModifierAmount(
      source.sectionEnd,
      normalizedOperations.sectionEnd === "add" ? 0 : DEFAULT_RATCHET_MODIFIERS.sectionEnd,
      normalizedOperations.sectionEnd
    ),
    cycleStart: normalizeRatchetModifierAmount(
      source.cycleStart,
      normalizedOperations.cycleStart === "add" ? 0 : DEFAULT_RATCHET_MODIFIERS.cycleStart,
      normalizedOperations.cycleStart
    ),
    cycleEnd: normalizeRatchetModifierAmount(
      source.cycleEnd,
      normalizedOperations.cycleEnd === "add" ? 0 : DEFAULT_RATCHET_MODIFIERS.cycleEnd,
      normalizedOperations.cycleEnd
    ),
    operations: normalizedOperations,
  };
}


export function normalizeRatchetVelocityContour(
  value: unknown
): RatchetVelocityContour | null {
  if (!isRecord(value)) {
    return null;
  }
  const anchor = (raw: unknown) => clamp(numberValue(raw, 0), -1, 1);
  return {
    start: anchor(value.start),
    mid: anchor(value.mid),
    end: anchor(value.end),
  };
}

export function normalizeRatchetVelocity(value: unknown): RatchetVelocitySpec {
  const source = isRecord(value) ? value : {};
  const hasExplicitMode = typeof source.mode === "string";
  const legacyCenter = clamp(
    Math.round(numberValue(source.center, 96)),
    1,
    127
  );
  const mode = hasExplicitMode ? normalizeRatchetVelocityMode(source.mode) : "relative";
  if (!hasExplicitMode && ("min" in source || "max" in source || "center" in source)) {
    const legacyMin = clamp(Math.round(numberValue(source.min, 72)), 1, 127);
    const legacyMax = clamp(Math.round(numberValue(source.max, 112)), 1, 127);
    return {
      enabled: boolValue(source.enabled, DEFAULT_RATCHET_VELOCITY.enabled),
      mode: "relative",
      min: clamp(
        Math.min(legacyMin, legacyMax) - legacyCenter,
        RATCHET_RELATIVE_VELOCITY_MIN,
        RATCHET_RELATIVE_VELOCITY_MAX
      ),
      max: clamp(
        Math.max(legacyMin, legacyMax) - legacyCenter,
        RATCHET_RELATIVE_VELOCITY_MIN,
        RATCHET_RELATIVE_VELOCITY_MAX
      ),
      center: 0,
      attraction: clamp(
        numberValue(source.attraction, DEFAULT_RATCHET_VELOCITY.attraction),
        0,
        1
      ),
      sameProbability: clamp(
        numberValue(source.sameProbability, DEFAULT_RATCHET_VELOCITY.sameProbability),
        0,
        1
      ),
      contour: normalizeRatchetVelocityContour(source.contour),
    };
  }
  const valueMin = mode === "absolute" ? 1 : RATCHET_RELATIVE_VELOCITY_MIN;
  const valueMax = mode === "absolute" ? 127 : RATCHET_RELATIVE_VELOCITY_MAX;
  return {
    enabled: boolValue(source.enabled, DEFAULT_RATCHET_VELOCITY.enabled),
    mode,
    min: clamp(
      Math.round(numberValue(source.min, DEFAULT_RATCHET_VELOCITY.min)),
      valueMin,
      valueMax
    ),
    max: clamp(
      Math.round(numberValue(source.max, DEFAULT_RATCHET_VELOCITY.max)),
      valueMin,
      valueMax
    ),
    center: clamp(
      Math.round(numberValue(source.center, DEFAULT_RATCHET_VELOCITY.center)),
      valueMin,
      valueMax
    ),
    attraction: clamp(
      numberValue(source.attraction, DEFAULT_RATCHET_VELOCITY.attraction),
      0,
      1
    ),
    sameProbability: clamp(
      numberValue(source.sameProbability, DEFAULT_RATCHET_VELOCITY.sameProbability),
      0,
      1
    ),
    contour: normalizeRatchetVelocityContour(source.contour),
  };
}


export function normalizeRatchetSpanGateLimits(
  value: unknown,
  fallbackMaxSpanMatras = DEFAULT_RATCHET_MAX_SPAN_MATRAS
): RatchetSpanGateLimit[] {
  const fallback = clamp(Math.round(fallbackMaxSpanMatras || 1), 1, 64);
  const limitsBySubdivision = new Map(
    RHYTHM_LENGTHS.map((subdivision) => [subdivision, fallback])
  );
  const source = Array.isArray(value) ? value : [];
  source.forEach((item) => {
    if (!isRecord(item)) return;
    const subdivision = Math.round(numberValue(item.subdivision, 0));
    if (!RHYTHM_LENGTHS.includes(subdivision)) return;
    limitsBySubdivision.set(
      subdivision,
      clamp(Math.round(numberValue(item.maxSpanMatras, fallback)), 1, 64)
    );
  });
  return RHYTHM_LENGTHS.map((subdivision) => ({
    subdivision,
    maxSpanMatras: limitsBySubdivision.get(subdivision) ?? fallback,
  }));
}


export function normalizeRatchetPositionModifier(
  value: unknown
): RatchetPositionModifierSpec {
  const source = isRecord(value) ? value : {};
  const rawPoints = Array.isArray(source.points) ? source.points : [];
  const points = rawPoints
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      return [
        {
          position: clamp(numberValue(item.position, 0), 0, 1),
          probability: clamp(numberValue(item.probability, 1), 0, 4),
          speed: clamp(numberValue(item.speed, 1), 0, 4),
        },
      ];
    })
    .sort((a, b) => a.position - b.position);
  return {
    enabled: boolValue(source.enabled, false),
    points:
      points.length > 0
        ? points
        : [
            { position: 0, probability: 1, speed: 1 },
            { position: 0.5, probability: 1, speed: 1 },
            { position: 1, probability: 1, speed: 1 },
          ],
  };
}


export function normalizeRatchetInternalRhythm(
  value: unknown
): RatchetInternalRhythmSpec {
  const source = isRecord(value) ? value : {};
  const firstCount = clamp(
    Math.round(numberValue(source.minCount, DEFAULT_RATCHET_INTERNAL_RHYTHM_MIN_COUNT)),
    1,
    64
  );
  const secondCount = clamp(
    Math.round(numberValue(source.maxCount, DEFAULT_RATCHET_INTERNAL_RHYTHM_MAX_COUNT)),
    1,
    64
  );
  const minCount = Math.min(firstCount, secondCount);
  const maxCount = Math.max(firstCount, secondCount);
  return {
    enabled: boolValue(source.enabled, false),
    minCount,
    maxCount,
    chains: [],
    articulation: null,
  };
}


export function normalizeRatchetBand(value: unknown): RatchetBandSpec | null {
  if (!isRecord(value)) {
    return null;
  }
  const slow = clamp(
    numberValue(value.rateSlowRef, DEFAULT_RATCHET_BAND.rateSlowRef),
    1,
    60
  );
  const fast = clamp(
    numberValue(value.rateFastRef, DEFAULT_RATCHET_BAND.rateFastRef),
    1,
    60
  );
  return {
    rateSlowRef: Math.min(slow, fast),
    rateFastRef: Math.max(slow, fast),
    tracking: clamp(numberValue(value.tracking, DEFAULT_RATCHET_BAND.tracking), 0, 1),
    bias: clamp(numberValue(value.bias, 0), -1, 1),
    spread: clamp(numberValue(value.spread, 0), -1, 1),
    sync: boolValue(value.sync, false),
  };
}

export function normalizeRatchetFill(value: unknown): RatchetFillSpec | null {
  if (!isRecord(value)) {
    return null;
  }
  const mode =
    value.mode === "lead" || value.mode === "trail" ? value.mode : "full";
  return { mode, fraction: clamp(numberValue(value.fraction, 0.5), 0.2, 1) };
}

export function normalizeRatchetEdgeWeights(value: unknown): RatchetEdgeWeights {
  const source = isRecord(value) ? value : {};
  const weight = (raw: unknown) => clamp(numberValue(raw, 1), 0, 2);
  return {
    accentStart: weight(source.accentStart),
    accentEnd: weight(source.accentEnd),
    sectionStart: weight(source.sectionStart),
    sectionEnd: weight(source.sectionEnd),
    cycleStart: weight(source.cycleStart),
    cycleEnd: weight(source.cycleEnd),
  };
}

export function normalizeRatchetPlacement(
  value: unknown
): RatchetPlacementSpec | null {
  if (!isRecord(value)) {
    return null;
  }
  let lengthWindow: RatchetLengthWindow | null = null;
  if (isRecord(value.lengthWindow)) {
    const a = Math.max(0, numberValue(value.lengthWindow.minPulses, 0));
    const b = Math.max(0, numberValue(value.lengthWindow.maxPulses, 64));
    lengthWindow = { minPulses: Math.min(a, b), maxPulses: Math.max(a, b) };
  }
  const spanPosition = isRecord(value.spanPosition) ? value.spanPosition : {};
  const gradient = (raw: unknown) => clamp(numberValue(raw, 1), 0, 2);
  return {
    lengthBias: clamp(numberValue(value.lengthBias, 0), -1, 1),
    lengthWindow,
    phraseWeights: Array.isArray(value.phraseWeights)
      ? value.phraseWeights
          .slice(0, 16)
          .map((weight) => clamp(numberValue(weight, 1), 0, 2))
      : [],
    spanPosition: {
      start: gradient(spanPosition.start),
      mid: gradient(spanPosition.mid),
      end: gradient(spanPosition.end),
    },
    edgeWeights: normalizeRatchetEdgeWeights(value.edgeWeights),
    normalize: boolValue(value.normalize, true),
  };
}

/** Convert a legacy speed window to reference hits/second. The patch loader
 * uses this only for AudibleRate, whose fixed-Hz semantics V2 can preserve;
 * metric strategies remain on the additive legacy resolver because no
 * elastic-band tracking value reproduces them across every future tempo. */
export function migrateLegacyRatchetSpeedToBand(speed: {
  strategy: RatchetSpeedStrategy;
  min: number;
  max: number;
  distribution: RatchetSpeedDistribution;
}, tempoBpm = 120): RatchetBandSpec {
  let bias = 0;
  let spread = 0;
  switch (speed.distribution) {
    case "favorSlow":
      bias = -1;
      break;
    case "favorFast":
      bias = 1;
      break;
    case "towardMedian":
      spread = -1;
      break;
    case "awayFromMedian":
      spread = 1;
      break;
    default:
      break;
  }
  const beatsPerSecond = clamp(numberValue(tempoBpm, 120), 20, 400) / 60;
  const scale =
    speed.strategy === "beatRate"
      ? beatsPerSecond
      : speed.strategy === "pulsesPerMatra"
        ? 4 * beatsPerSecond
        : 1;
  const sync = speed.strategy === "pulsesPerMatra";
  const slow = clamp(speed.min * scale, 1, 60);
  const fast = clamp(speed.max * scale, 1, 60);
  return {
    rateSlowRef: Math.min(slow, fast),
    rateFastRef: Math.max(slow, fast),
    tracking: 0,
    bias,
    spread,
    sync,
  };
}

function ratchetModifierAmountIsNeutral(
  amount: number,
  operation: RatchetModifierOperation
): boolean {
  return operation === "add" ? amount === 0 : amount === 1;
}

/** V2 placement cannot exactly encode thresholded duration gates, stacked
 * boundary operations, or a cycle-position probability curve. Keep the
 * legacy probability resolver active whenever one of those effects matters. */
export function legacyRatchetProbabilityModifiersAreNeutral(
  modifiers: RatchetProbabilityModifiers
): boolean {
  const durationIsNeutral = (modifier: RatchetDurationModifier) =>
    !modifier.enabled ||
    ratchetModifierAmountIsNeutral(modifier.multiplier, modifier.operation);
  const boundaryKeys = [
    "accentSpanStart",
    "accentSpanEnd",
    "sectionStart",
    "sectionEnd",
    "cycleStart",
    "cycleEnd",
  ] as const;
  return (
    durationIsNeutral(modifiers.slowNote) &&
    durationIsNeutral(modifiers.fastNote) &&
    (!modifiers.position.enabled ||
      modifiers.position.points.every(
        (point) => point.probability === 1 && point.speed === 1
      )) &&
    boundaryKeys.every((key) =>
      ratchetModifierAmountIsNeutral(modifiers[key], modifiers.operations[key])
    )
  );
}

function legacyRatchetPositionSpeedIsNeutral(
  modifiers: RatchetProbabilityModifiers
): boolean {
  return (
    !modifiers.position.enabled ||
    modifiers.position.points.every((point) => point.speed === 1)
  );
}

/** Pre-v5 migration for a completely neutral modifier stack. Any active
 * legacy gate/curve stays on the legacy resolver instead of being approximated
 * by placement weights. */
export function migrateLegacyRatchetModifiersToPlacement(
  modifiers: RatchetProbabilityModifiers
): RatchetPlacementSpec {
  const boundaryWeight = (value: number, operation: RatchetModifierOperation) =>
    clamp(operation === "add" ? 1 + value : value, 0, 2);
  const gateBoost = (gate: RatchetDurationModifier) => {
    if (!gate.enabled) {
      return 0;
    }
    return gate.operation === "add" ? gate.multiplier : gate.multiplier - 1;
  };
  const fastBoost = gateBoost(modifiers.fastNote);
  const slowBoost = gateBoost(modifiers.slowNote);
  return {
    // Fast-note emphasis = favor short candidates; slow-note = favor long.
    lengthBias: clamp(slowBoost - fastBoost, -1, 1),
    lengthWindow: null,
    phraseWeights: [],
    spanPosition: { start: 1, mid: 1, end: 1 },
    edgeWeights: {
      accentStart: boundaryWeight(
        modifiers.accentSpanStart,
        modifiers.operations.accentSpanStart
      ),
      accentEnd: boundaryWeight(
        modifiers.accentSpanEnd,
        modifiers.operations.accentSpanEnd
      ),
      sectionStart: boundaryWeight(
        modifiers.sectionStart,
        modifiers.operations.sectionStart
      ),
      sectionEnd: boundaryWeight(
        modifiers.sectionEnd,
        modifiers.operations.sectionEnd
      ),
      cycleStart: boundaryWeight(
        modifiers.cycleStart,
        modifiers.operations.cycleStart
      ),
      cycleEnd: boundaryWeight(modifiers.cycleEnd, modifiers.operations.cycleEnd),
    },
    normalize: true,
  };
}

export function normalizeRatchetSpec(
  value: unknown,
  options: { tempoBpm?: number } = {}
): RatchetPlaybackSpec {
  const source = isRecord(value) ? value : {};
  const speed = isRecord(source.speed) ? source.speed : {};
  const rawStrategy = speed.strategy;
  const strategy =
    rawStrategy === "percentOfBeat"
      ? "beatRate"
      : normalizeRatchetSpeedStrategy(rawStrategy);
  const fallbackMin =
    strategy === "audibleRate"
      ? DEFAULT_RATCHET_AUDIBLE_RATE_MIN
      : strategy === "beatRate"
      ? DEFAULT_RATCHET_BEAT_RATE_MIN
      : DEFAULT_RATCHET_MATRA_RATE_MIN;
  const fallbackMax =
    strategy === "audibleRate"
      ? DEFAULT_RATCHET_AUDIBLE_RATE_MAX
      : strategy === "beatRate"
      ? DEFAULT_RATCHET_BEAT_RATE_MAX
      : DEFAULT_RATCHET_MATRA_RATE_MAX;
  const legacyPercentScale = rawStrategy === "percentOfBeat" ? 0.01 : 1;
  const cooldownBasis = normalizeRatchetCooldownBasis(source.cooldownBasis);
  const maxSpanMatras = clamp(
    Math.round(numberValue(source.maxSpanMatras, DEFAULT_RATCHET_MAX_SPAN_MATRAS)),
    1,
    64
  );
  const spanGateLimitsSource =
    source.maxSpanMatrasBySubdivision ?? source.maxSpanMatrasByGati;
  const modifiers = normalizeRatchetModifiers(source.modifiers);
  if (isRecord(source.automation)) {
    modifiers.position = normalizeRatchetPositionModifier(source.automation);
  }
  const normalizedSpeed = {
    strategy,
    min: Math.max(0, numberValue(speed.min, fallbackMin) * legacyPercentScale),
    max: Math.max(0, numberValue(speed.max, fallbackMax) * legacyPercentScale),
    distribution: normalizeRatchetSpeedDistribution(speed.distribution),
  };
  // Schema v5: absent V2 fields mean a pre-v5 spec — migrate the legacy
  // speed window and modifier stack. Explicit null means the user turned
  // the V2 layer off; keep it off.
  const band =
    source.band === undefined
      ? normalizedSpeed.strategy === "audibleRate" &&
        legacyRatchetPositionSpeedIsNeutral(modifiers)
        ? migrateLegacyRatchetSpeedToBand(normalizedSpeed, options.tempoBpm)
        : null
      : normalizeRatchetBand(source.band);
  const placement =
    source.placement === undefined
      ? legacyRatchetProbabilityModifiersAreNeutral(modifiers)
        ? migrateLegacyRatchetModifiersToPlacement(modifiers)
        : null
      : normalizeRatchetPlacement(source.placement);
  const fill = band ? normalizeRatchetFill(source.fill) : null;
  return {
    seed: Math.max(0, Math.round(numberValue(source.seed, 0))),
    probability: clamp(numberValue(source.probability, 0), 0, 1),
    modifiers,
    speed: normalizedSpeed,
    curve: normalizeRatchetCurve(source.curve),
    curveWeights: normalizeRatchetCurveWeights(source.curveWeights),
    cooldownMatras: normalizeRatchetCooldownAmount(
      numberValue(source.cooldownMatras, 0),
      cooldownBasis
    ),
    cooldownBasis,
    temporalEasing: clamp(numberValue(source.temporalEasing, 0), 0, 1),
    temporalEasingShape: normalizeRatchetTemporalEasingShape(source.temporalEasingShape),
    temporalEasingProbability: clamp(
      numberValue(source.temporalEasingProbability, 1),
      0,
      1
    ),
    temporalEasingWeights: normalizeRatchetTemporalEasingWeights(
      source.temporalEasingWeights
    ),
    timeCurve: normalizeRatchetTimeCurve(source.timeCurve),
    velocity: normalizeRatchetVelocity(source.velocity),
    allowMultiMatra: boolValue(source.allowMultiMatra, true),
    maxSpanMatras,
    maxSpanMatrasBySubdivision: normalizeRatchetSpanGateLimits(
      spanGateLimitsSource,
      maxSpanMatras
    ),
    internalRhythm: normalizeRatchetInternalRhythm(source.internalRhythm),
    band,
    fill,
    placement,
  };
}


export function normalizeOrnamentSpec(value: unknown): OrnamentPlaybackSpec {
  const source = isRecord(value) ? value : {};
  const grace = isRecord(source.grace) ? source.grace : {};
  const countWeights = isRecord(grace.countWeights) ? grace.countWeights : {};
  const durationBasis = normalizeGraceNoteDurationBasis(grace.durationBasis);
  const cooldownBasis = normalizeRatchetCooldownBasis(grace.cooldownBasis);
  const placement = normalizeGraceNotePlacement(grace.placement);
  return {
    seed: Math.max(0, Math.round(numberValue(source.seed, 0))),
    grace: {
      enabled: boolValue(grace.enabled, false),
      placement,
      placementWeights: normalizeGraceNotePlacementWeights(
        grace.placementWeights,
        placement
      ),
      countWeights: {
        single: Math.max(0, Math.round(numberValue(countWeights.single, 0))),
        double: Math.max(0, Math.round(numberValue(countWeights.double, 0))),
        triple: Math.max(0, Math.round(numberValue(countWeights.triple, 0))),
      },
      probability: clamp(numberValue(grace.probability, 0), 0, 1),
      modifiers: normalizeRatchetModifiers(grace.modifiers),
      cooldown: normalizeRatchetCooldownAmount(
        numberValue(grace.cooldown, 0),
        cooldownBasis
      ),
      cooldownBasis,
      duration: normalizeGraceNoteDurationAmount(
        numberValue(grace.duration, 1),
        durationBasis
      ),
      durationBasis,
      velocity: normalizeRatchetVelocity(grace.velocity ?? DEFAULT_ORNAMENT_VELOCITY),
      allowRests: boolValue(grace.allowRests, false),
    },
    delay: normalizeDelayOrnamentSpec(source.delay),
  };
}


export function normalizeJathiAccentMode(value: unknown): "overrideGati" | "layered" {
  return value === "layered" ? "layered" : "overrideGati";
}


export function normalizeBoundarySelection(value: unknown, cycleBeats: number): number | null {
  if (value === null || value === undefined) return null;
  const afterBeat = Math.round(numberValue(value, Number.NaN));
  return Number.isFinite(afterBeat) && afterBeat > 0 && afterBeat < cycleBeats
    ? afterBeat
    : null;
}


export function normalizeRhythmTab(value: unknown): RhythmTab {
  return value === "resubdivision" ||
    value === "ratchet" ||
    value === "ornaments" ||
    value === "seeds"
    ? value
    : "patterns";
}


export function normalizeOrnamentTab(value: unknown): OrnamentTab {
  return value === "delay" ? "delay" : "grace";
}


export function normalizeRhythmSpeedEditorKind(value: unknown): RhythmSpeedContextKind {
  return value === "jathi" ? "jathi" : "gati";
}


export function normalizeRhythmCopyTargetMode(value: unknown): RhythmCopyTargetMode {
  return value === "all" ? "all" : "selected";
}


export function normalizeArbitrarySubdivisionPatternSource(
  value: unknown
): ArbitrarySubdivisionPatternSource {
  return value === "weightedPool" ? "weightedPool" : "markov";
}


export function normalizeRhythmPassageStrategy(value: unknown): RhythmPassageStrategy {
  return value === "metricChunks" ||
    value === "pulseWindows" ||
    value === "matraWindows"
    ? value
    : "hybridVocabulary";
}


export function normalizeRhythmLengthList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((length) => Math.round(numberValue(length, 0)))
    .filter(
      (length, index, list) =>
        length > 0 && length <= 64 && list.indexOf(length) === index
    );
}


export function normalizeRhythmPlaybackChains(value: unknown): RhythmChainSpec[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((chain) => {
    if (!isRecord(chain)) return [];
    const spanLen = clamp(Math.round(numberValue(chain.spanLen, 0)), 1, 64);
    const order = normalizeMarkovOrder(chain.order);
    const states = Array.isArray(chain.states)
      ? chain.states.flatMap((state) => {
          if (!isRecord(state) || !Array.isArray(state.pulses)) return [];
          const pulses = state.pulses
            .map((pulse) => Math.round(numberValue(pulse, 0)))
            .filter((pulse) => pulse > 0 && pulse <= 64);
          return pulses.length ? [{ pulses }] : [];
        })
      : [];
    if (!states.length) return [];

    const fallback = clamp(
      Math.round(numberValue(chain.fallback, 0)),
      0,
      Math.max(0, states.length - 1)
    );
    const transitions = Array.isArray(chain.transitions)
      ? chain.transitions.flatMap((transition) => {
          if (!isRecord(transition) || !Array.isArray(transition.from)) return [];
          const from = transition.from
            .map((state) => Math.round(numberValue(state, -1)))
            .filter((state) => state >= 0 && state < states.length);
          const to = Math.round(numberValue(transition.to, -1));
          const weight = Math.max(0, Math.round(numberValue(transition.weight, 0)));
          if (to < 0 || to >= states.length || weight <= 0) return [];
          return [{ from, to, weight }];
        })
      : [];
    const fallbackWeights = Array.isArray(chain.fallbackWeights)
      ? chain.fallbackWeights.flatMap((weight) => {
          if (!isRecord(weight)) return [];
          const state = Math.round(numberValue(weight.state, -1));
          const amount = Math.max(0, Math.round(numberValue(weight.weight, 0)));
          if (state < 0 || state >= states.length || amount <= 0) return [];
          return [{ state, weight: amount }];
        })
      : [];
    const entryWeights = Array.isArray(chain.entryWeights)
      ? chain.entryWeights.flatMap((weight) => {
          if (!isRecord(weight) || !Array.isArray(weight.states)) return [];
          const statesKey = weight.states
            .map((state) => Math.round(numberValue(state, -1)))
            .filter((state) => state >= 0 && state < states.length);
          const amount = Math.max(0, Math.round(numberValue(weight.weight, 0)));
          if (statesKey.length === 0 || amount <= 0) return [];
          return [{ states: statesKey, weight: amount }];
        })
      : [];
    return [
      {
        spanLen,
        order,
        states,
        transitions,
        fallback,
        fallbackWeights,
        entryWeights,
      },
    ];
  });
}


export function normalizeRhythmResolvedSeed(
  value: unknown
): RhythmPreview["resolution"]["seed"] | null {
  if (!isRecord(value)) {
    return null;
  }
  const source =
    value.source === "followGlobal" ||
    value.source === "locked" ||
    value.source === "perCycle" ||
    value.source === "history" ||
    value.source === "drift" ||
    value.source === "morph" ||
    value.source === "new"
      ? value.source
      : "locked";
  return {
    seed: normalizeU64SeedDecimal(value.seed) ?? "0",
    source,
    history: normalizeU64SeedDecimalList(value.history),
  };
}


export function readPatchDocument(input: unknown): SequencerPatchDocument {
  if (!isRecord(input)) {
    throw new Error("Patch file must contain a JSON object.");
  }
  if (input.app !== PATCH_APP_ID) {
    throw new Error("Patch file was not saved by Dum-Ka.");
  }
  if (input.schemaVersion !== PATCH_SCHEMA_VERSION) {
    throw new Error(`Unsupported patch schema: ${String(input.schemaVersion)}`);
  }
  const generatorCandidates: unknown[] = [input.generator];
  if (isRecord(input.project) && Array.isArray(input.project.tracks)) {
    generatorCandidates.push(
      ...input.project.tracks.flatMap((track) =>
        isRecord(track) ? [track.generator] : []
      )
    );
  }
  const loadWarnings = [
    ...(generatorCandidates.some(hasUnknownGeneratorKind)
      ? ["Unknown generator kind was disabled and reset to Example."]
      : []),
    ...evolutionPlanLoadWarnings(generatorCandidates),
  ];
  const schemaVersion = PATCH_SCHEMA_VERSION;
  const hasProject = isRecord(input.project);
  const source = hasProject ? flattenProjectPatchForActiveTrack(input) : input;
  const value = source;
  if (!isRecord(value.transport) || !isRecord(value.sequencer)) {
    throw new Error("Patch file is missing transport or sequencer state.");
  }

  const emptyRecord: Record<string, unknown> = {};
  const transport = value.transport;
  const sequencer = value.sequencer;
  const rhythm = isRecord(value.rhythm) ? value.rhythm : emptyRecord;
  const pitchShaper = isRecord(value.pitchShaper) ? value.pitchShaper : emptyRecord;
  const channelHocket = isRecord(value.channelHocket) ? value.channelHocket : emptyRecord;
  const setup = isRecord(value.setup) ? value.setup : emptyRecord;
  const ui = isRecord(value.ui) ? value.ui : emptyRecord;
  const accent = isRecord(sequencer.accent) ? sequencer.accent : emptyRecord;
  const arbitrarySubdivision = isRecord(rhythm.arbitrarySubdivision)
    ? rhythm.arbitrarySubdivision
    : emptyRecord;
  const beatLocks = isRecord(rhythm.beatLocks) ? rhythm.beatLocks : emptyRecord;
  const shapeGroups = isRecord(rhythm.shapeGroups) ? rhythm.shapeGroups : emptyRecord;
  const articulation = isRecord(rhythm.articulation)
    ? rhythm.articulation
    : emptyRecord;
  const cycleBeats = clamp(
    Math.round(numberValue(sequencer.cycleBeats, NEUTRAL_CYCLE_BEATS)),
    1,
    64
  );
  const pitchShaperEnabled = boolValue(pitchShaper.enabled, false);
  const normalizedPitchStates = normalizePitchStates(pitchShaper.states);
  const safePitchStates =
    pitchShaperEnabled && normalizedPitchStates.length === 0
      ? [{ pitch: NEUTRAL_PITCH, label: pitchName(NEUTRAL_PITCH) }]
      : normalizedPitchStates;
  const channelHocketEnabled = boolValue(channelHocket.enabled, false);
  const normalizedChannelHocketChannels = normalizeMidiChannels(channelHocket.channels);
  const safeChannelHocketChannels =
    channelHocketEnabled && normalizedChannelHocketChannels.length === 0
      ? [1, 2]
      : normalizedChannelHocketChannels;
  const tempoBpm = clamp(
    numberValue(transport.tempoBpm, NEUTRAL_TEMPO_BPM),
    20,
    400
  );
  const unknownGeneratorKind = hasUnknownGeneratorKind(value.generator);

  const flat: SequencerPatchFlatState = {
    app: PATCH_APP_ID,
    schemaVersion: PATCH_SCHEMA_VERSION,
    savedAt: stringValue(value.savedAt, new Date().toISOString()),
    transport: {
      tempoBpm,
      synthEnabled: boolValue(transport.synthEnabled, false),
      synthPrograms: synthProgramsToRequest(normalizeSynthPrograms(transport.synthPrograms)),
      rhythmPlaybackEnabled: true,
      currentScoreId:
        typeof transport.currentScoreId === "string" ? transport.currentScoreId : null,
      cycleTempoFlux: normalizeCycleTempoFlux(transport.cycleTempoFlux),
    },
    sequencer: {
      scoreSetupOpen: boolValue(sequencer.scoreSetupOpen, false),
      randomize: normalizeLegacyRandomizeSettings(sequencer.randomize),
      probabilityOpen: boolValue(sequencer.probabilityOpen, false),
      boundariesOpen: boolValue(sequencer.boundariesOpen, false),
      maxSectionsHelpOpen: boolValue(sequencer.maxSectionsHelpOpen, false),
      name: stringValue(sequencer.name, NEUTRAL_SCORE_NAME),
      cycleBeats,
      initialWeights: normalizeSubdivisionWeightsFromPatch(
        Object.prototype.hasOwnProperty.call(sequencer, "initialSubdivision")
          ? fixedSubdivisionWeights(numberValue(sequencer.initialSubdivision, 4))
          : sequencer.initialWeights,
        NEUTRAL_INITIAL_WEIGHTS
      ),
      initialJathiWeights: normalizeJathiWeightsFromPatch(
        Object.prototype.hasOwnProperty.call(sequencer, "initialGrouping")
          ? fixedGroupingWeights(
              sequencer.initialGrouping === null
                ? null
                : numberValue(sequencer.initialGrouping, 0)
            )
          : sequencer.initialJathiWeights,
        NEUTRAL_JATHI_WEIGHTS
      ),
      initialJathiBhedam: normalizeJathiBhedamFromPatch(sequencer.initialJathiBhedam),
      initialCustomSubdivision: normalizeCustomSubdivisionFromPatch(
        sequencer.initialCustomSubdivision
      ),
      boundaries: normalizeBoundariesFromPatch(sequencer.boundaries, cycleBeats),
      selectedBoundaryAfterBeat: normalizeBoundarySelection(
        sequencer.selectedBoundaryAfterBeat,
        cycleBeats
      ),
      sectionCountWeights: normalizeSwitchCountsFromPatch(
        sequencer.sectionCountWeights,
        NEUTRAL_SECTION_COUNTS
      ),
      seedMode: normalizePersistedSeedMode(sequencer.seedMode),
      seed: normalizeSeedValue(sequencer.seed, FALLBACK_GLOBAL_SEED),
      historySeeds: normalizeU64SeedDecimalList(sequencer.historySeeds),
      historyWeight: Math.max(0, numberValue(sequencer.historyWeight, 1)),
      newSeedWeight: Math.max(0, numberValue(sequencer.newSeedWeight, 1)),
      maxHistory: clamp(Math.round(numberValue(sequencer.maxHistory, 8)), 0, 64),
      newSeedChance: normalizeNewSeedChance(sequencer.newSeedChance),
      holdChance: normalizeHoldChance(sequencer.holdChance),
      blendCycles: normalizeBlendCycles(sequencer.blendCycles),
      singleParameterRhythmicModulation: boolValue(
        sequencer.singleParameterRhythmicModulation,
        false
      ),
      pitch: clamp(
        Math.round(numberValue(sequencer.basePitch, numberValue(sequencer.pitch, NEUTRAL_PITCH))),
        0,
        127
      ),
      velocity: clamp(Math.round(numberValue(sequencer.velocity, NEUTRAL_VELOCITY)), 1, 127),
      accent: {
        beatStart: cleanAccentRange(
          isRecord(accent.beatStart) ? numberValue(accent.beatStart.min, 0) : 0,
          isRecord(accent.beatStart) ? numberValue(accent.beatStart.max, 0) : 0
        ),
        sectionStartExtra: cleanAccentRange(
          isRecord(accent.sectionStartExtra)
            ? numberValue(accent.sectionStartExtra.min, 0)
            : 0,
          isRecord(accent.sectionStartExtra)
            ? numberValue(accent.sectionStartExtra.max, 0)
            : 0
        ),
        jathiStart: cleanAccentRange(
          isRecord(accent.groupingStart)
            ? numberValue(accent.groupingStart.min, 0)
            : isRecord(accent.jathiStart)
              ? numberValue(accent.jathiStart.min, 0)
              : 0,
          isRecord(accent.groupingStart)
            ? numberValue(accent.groupingStart.max, 0)
            : isRecord(accent.jathiStart)
              ? numberValue(accent.jathiStart.max, 0)
              : 0
        ),
        jathiMode: normalizeJathiAccentMode(accent.groupingMode ?? accent.jathiMode),
      },
      userPreviewCycle: stoppedPreviewCycleIndex(
        Math.round(numberValue(sequencer.userPreviewCycle, 0))
      ),
    },
    generatorEnabled:
      !unknownGeneratorKind &&
      boolValue(
        value.generatorEnabled,
        boolValue(transport.rhythmPlaybackEnabled, true)
      ),
    generator: normalizePatchGeneratorConfig(
      value.generator,
      normalizeSeedValue(sequencer.seed, FALLBACK_GLOBAL_SEED)
    ),
    automation: normalizeAutomationSet(value.automation),
    rhythm: {
      rhythmOpen: boolValue(rhythm.rhythmOpen, false),
      rhythmTab: normalizeRhythmTab(rhythm.rhythmTab),
      rhythmLength: clamp(Math.round(numberValue(rhythm.rhythmLength, 4)), 1, 64),
      rhythmOrder: normalizeMarkovOrder(rhythm.rhythmOrder),
      rhythmExtrapolateFrom: clamp(
        Math.round(numberValue(rhythm.rhythmExtrapolateFrom, 4)),
        1,
        64
      ),
      rhythmExtrapolationStrategy: normalizeRhythmExtrapolationStrategy(
        rhythm.rhythmExtrapolationStrategy
      ),
      rhythmMaterializeMode: normalizeRhythmMaterializeMode(
        rhythm.rhythmMaterializeMode
      ),
      copyTargetMode: normalizeRhythmCopyTargetMode(rhythm.copyTargetMode),
      copySelectedTargets: normalizeRhythmLengthList(rhythm.copySelectedTargets),
      passageInput: stringValue(rhythm.passageInput, ""),
      passageStrategy: normalizeRhythmPassageStrategy(rhythm.passageStrategy),
      passageOrder: normalizeMarkovOrder(rhythm.passageOrder),
      passageFitStrategy: normalizeRhythmExtrapolationStrategy(
        rhythm.passageFitStrategy
      ),
      passageTargetMode: normalizeRhythmCopyTargetMode(rhythm.passageTargetMode),
      passageSelectedTargets: normalizeRhythmLengthList(rhythm.passageSelectedTargets),
      passageHelpOpen: boolValue(rhythm.passageHelpOpen, false),
      selectedKeysByLength: normalizeStringArrayRecord(rhythm.selectedKeysByLength),
      speedEditorKind: normalizeRhythmSpeedEditorKind(rhythm.speedEditorKind),
      speedEditorValue: clamp(
        Math.round(numberValue(rhythm.speedEditorValue, 4)),
        1,
        64
      ),
      rhythmSeed: Math.max(0, Math.round(numberValue(rhythm.rhythmSeed, 0))),
      rhythmSeedBehavior: normalizeRhythmSeedBehavior(rhythm.rhythmSeedBehavior),
      historySeeds: normalizeU64SeedDecimalList(rhythm.historySeeds),
      historyWeight: Math.max(0, numberValue(rhythm.historyWeight, 1)),
      newSeedWeight: Math.max(0, numberValue(rhythm.newSeedWeight, 1)),
      maxHistory: clamp(Math.round(numberValue(rhythm.maxHistory, 8)), 0, 64),
      newSeedChance: normalizeNewSeedChance(rhythm.newSeedChance),
      holdChance: normalizeHoldChance(rhythm.holdChance),
      blendCycles: normalizeBlendCycles(rhythm.blendCycles),
      fallback: Math.max(0, Math.round(numberValue(rhythm.fallback, 0))),
      fallbackMode: normalizeRhythmFallbackMode(rhythm.fallbackMode),
      fallbackWeightsByLength: normalizeNestedNumberRecord(
        rhythm.fallbackWeightsByLength
      ),
      entryWeightsByLength: normalizeNestedNumberRecord(
        rhythm.entryWeightsByLength
      ),
      weights: normalizeNumberRecord(rhythm.weights),
      articulation: {
        open: boolValue(articulation.open, false),
        seedPolicy: normalizeRhythmArticulationSeedPolicy(
          articulation.seedPolicy
        ),
        cells: normalizeRhythmArticulationCells(articulation.cells),
        tieOverAccentProbabilityPercent: clamp(
          Math.round(numberValue(articulation.tieOverAccentProbabilityPercent, 0)),
          0,
          100
        ),
        restOverAccentProbabilityPercent: clamp(
          Math.round(numberValue(articulation.restOverAccentProbabilityPercent, 0)),
          0,
          100
        ),
        blend: normalizeRhythmArticulationBlendState(articulation.blend),
        fragmentPosition: normalizeRhythmPositionArticulationState(
          articulation.fragmentPosition
        ),
        sectionPosition: normalizeRhythmPositionArticulationState(
          articulation.sectionPosition
        ),
        cyclePosition: normalizeRhythmPositionArticulationState(
          articulation.cyclePosition
        ),
        neighbor: normalizeRhythmArticulationNeighborState(articulation.neighbor),
      },
      arbitrarySubdivision: {
        probabilityPercent: clamp(
          numberValue(arbitrarySubdivision.probabilityPercent, 0),
          0,
          100
        ),
        targets: normalizeArbitraryTargetsFromPatch(
          arbitrarySubdivision.targets,
          []
        ),
        clumpLengths: normalizeArbitraryClumpsFromPatch(
          arbitrarySubdivision.clumpLengths,
          []
        ),
        allowTrivialPattern: boolValue(
          arbitrarySubdivision.allowTrivialPattern,
          false
        ),
        patternSource: normalizeArbitrarySubdivisionPatternSource(
          arbitrarySubdivision.patternSource
        ),
        poolWeightsByLength: normalizeNestedNumberRecord(
          arbitrarySubdivision.poolWeightsByLength
        ),
        poolEditorLength: clamp(
          Math.round(numberValue(arbitrarySubdivision.poolEditorLength, 4)),
          1,
          64
        ),
      },
      beatLocks: {
        open: boolValue(beatLocks.open, false),
        seed: Math.max(0, Math.round(numberValue(beatLocks.seed, 0))),
        locks: normalizeBeatLocksFromPatch(beatLocks.locks),
      },
      shapeGroups: {
        open: boolValue(shapeGroups.open, false),
        seed: Math.max(0, Math.round(numberValue(shapeGroups.seed, 0))),
        groups: normalizeShapeGroupsFromPatch(shapeGroups.groups),
      },
      speedSubdivisionWeights: normalizeRhythmSpeedWeightsFromPatch(
        rhythm.speedSubdivisionWeights
      ),
      ratchet: {
        enabled: isRecord(rhythm.ratchet)
          ? boolValue(rhythm.ratchet.enabled, false)
          : false,
        spec: normalizeRatchetSpec(
          isRecord(rhythm.ratchet) ? rhythm.ratchet.spec : undefined,
          { tempoBpm }
        ),
      },
      ornament: {
        enabled: isRecord(rhythm.ornament)
          ? boolValue(rhythm.ornament.enabled, false)
          : false,
        tab: normalizeOrnamentTab(
          isRecord(rhythm.ornament) ? rhythm.ornament.tab : undefined
        ),
        spec: normalizeOrnamentSpec(
          isRecord(rhythm.ornament) ? rhythm.ornament.spec : undefined
        ),
      },
      playbackChains: normalizeRhythmPlaybackChains(rhythm.playbackChains),
      resolvedSeed: normalizeRhythmResolvedSeed(rhythm.resolvedSeed),
    },
    pitchShaper: {
      open: boolValue(pitchShaper.open, false),
      enabled: pitchShaperEnabled,
      tab: normalizePitchTab(pitchShaper.tab),
      order: normalizeMarkovOrder(pitchShaper.order),
      collectionId: stringValue(pitchShaper.collectionId, "chromatic"),
      collectionTransposition: clamp(
        Math.round(numberValue(pitchShaper.collectionTransposition, 0)),
        0,
        11
      ),
      rangeLow: clamp(
        Math.round(numberValue(pitchShaper.rangeLow, DEFAULT_PITCH_RANGE_LOW)),
        0,
        127
      ),
      rangeHigh: clamp(
        Math.round(numberValue(pitchShaper.rangeHigh, DEFAULT_PITCH_RANGE_HIGH)),
        0,
        127
      ),
      states: safePitchStates,
      selectedKeys: normalizePitchSelectedKeys(safePitchStates, pitchShaper.selectedKeys),
      weights: normalizeNumberRecord(pitchShaper.weights),
      fallback: Math.max(0, Math.round(numberValue(pitchShaper.fallback, 0))),
      fallbackMode: normalizeRhythmFallbackMode(pitchShaper.fallbackMode),
      fallbackWeights: normalizeNumberRecord(pitchShaper.fallbackWeights),
      entryWeights: normalizeNumberRecord(pitchShaper.entryWeights),
      seed: Math.max(0, Math.round(numberValue(pitchShaper.seed, 0))),
      seedBehavior: normalizeRhythmSeedBehavior(pitchShaper.seedBehavior),
      historySeeds: normalizeU64SeedDecimalList(pitchShaper.historySeeds),
      historyWeight: Math.max(0, numberValue(pitchShaper.historyWeight, 1)),
      newSeedWeight: Math.max(0, numberValue(pitchShaper.newSeedWeight, 1)),
      maxHistory: clamp(Math.round(numberValue(pitchShaper.maxHistory, 8)), 0, 64),
      newSeedChance: normalizeNewSeedChance(pitchShaper.newSeedChance),
      holdChance: normalizeHoldChance(pitchShaper.holdChance),
      blendCycles: normalizeBlendCycles(pitchShaper.blendCycles),
      boundary: normalizePitchBoundary(pitchShaper.boundary),
      ratchetMode: normalizePitchRatchetMode(pitchShaper.ratchetMode),
      wholeProbabilityPercent: clamp(
        Math.round(numberValue(pitchShaper.wholeProbabilityPercent, 0)),
        0,
        100
      ),
      perHitProbabilityPercent: clamp(
        Math.round(numberValue(pitchShaper.perHitProbabilityPercent, 0)),
        0,
        100
      ),
      preserveFirstHit: boolValue(pitchShaper.preserveFirstHit, true),
      ornamentMode: normalizePitchOrnamentMode(pitchShaper.ornamentMode),
      ornamentWholeProbabilityPercent: clamp(
        Math.round(numberValue(pitchShaper.ornamentWholeProbabilityPercent, 0)),
        0,
        100
      ),
      ornamentPerGraceProbabilityPercent: clamp(
        Math.round(numberValue(pitchShaper.ornamentPerGraceProbabilityPercent, 0)),
        0,
        100
      ),
      gracePitchEnabled: boolValue(pitchShaper.gracePitchEnabled, false),
      gracePitchProbabilityPercent: clamp(
        Math.round(numberValue(pitchShaper.gracePitchProbabilityPercent, 0)),
        0,
        100
      ),
      gracePitchScope: normalizeGracePitchScope(pitchShaper.gracePitchScope),
      gracePitchPitches: normalizeWeightedMidiPitches(pitchShaper.gracePitchPitches),
      graceTransposeEnabled: boolValue(pitchShaper.graceTransposeEnabled, false),
      graceTransposeProbabilityPercent: clamp(
        Math.round(numberValue(pitchShaper.graceTransposeProbabilityPercent, 0)),
        0,
        100
      ),
      graceTransposeScope: normalizeGracePitchScope(pitchShaper.graceTransposeScope),
      graceTransposeUpWeight: clamp(
        Math.round(numberValue(pitchShaper.graceTransposeUpWeight, 0)),
        0,
        999
      ),
      graceTransposeDownWeight: clamp(
        Math.round(numberValue(pitchShaper.graceTransposeDownWeight, 0)),
        0,
        999
      ),
      graceTransposeIntervals: normalizeGraceTransposeIntervals(
        pitchShaper.graceTransposeIntervals
      ),
      transposeEnabled: boolValue(pitchShaper.transposeEnabled, false),
      transposeProbabilityPercent: clamp(
        Math.round(numberValue(pitchShaper.transposeProbabilityPercent, 0)),
        0,
        100
      ),
      transposeMode: normalizePitchTranspositionMode(pitchShaper.transposeMode),
      transposeIntervals: stringValue(pitchShaper.transposeIntervals, ""),
      transposeDriveChain: boolValue(pitchShaper.transposeDriveChain, false),
    },
    channelHocket: {
      open: boolValue(channelHocket.open, false),
      enabled: channelHocketEnabled,
      outputChannel: clamp(
        Math.round(numberValue(channelHocket.outputChannel, 1)),
        1,
        16
      ),
      order: normalizeMarkovOrder(channelHocket.order),
      channels: safeChannelHocketChannels,
      weights: normalizeNumberRecord(channelHocket.weights),
      fallback: clamp(Math.round(numberValue(channelHocket.fallback, 1)), 1, 16),
      fallbackWeights: normalizeNumberRecord(channelHocket.fallbackWeights),
      entryWeights: normalizeNumberRecord(channelHocket.entryWeights),
      seed: Math.max(0, Math.round(numberValue(channelHocket.seed, 0))),
      seedBehavior: normalizeRhythmSeedBehavior(channelHocket.seedBehavior),
      historySeeds: normalizeU64SeedDecimalList(channelHocket.historySeeds),
      historyWeight: Math.max(0, numberValue(channelHocket.historyWeight, 1)),
      newSeedWeight: Math.max(0, numberValue(channelHocket.newSeedWeight, 1)),
      maxHistory: clamp(Math.round(numberValue(channelHocket.maxHistory, 8)), 0, 64),
      newSeedChance: normalizeNewSeedChance(channelHocket.newSeedChance),
      holdChance: normalizeHoldChance(channelHocket.holdChance),
      blendCycles: normalizeBlendCycles(channelHocket.blendCycles),
      ratchetMode: normalizeChannelRatchetMode(channelHocket.ratchetMode),
      wholeProbabilityPercent: clamp(
        Math.round(numberValue(channelHocket.wholeProbabilityPercent, 0)),
        0,
        100
      ),
      perHitProbabilityPercent: clamp(
        Math.round(numberValue(channelHocket.perHitProbabilityPercent, 0)),
        0,
        100
      ),
      preserveFirstHit: boolValue(channelHocket.preserveFirstHit, true),
      ornamentMode: normalizeChannelOrnamentMode(channelHocket.ornamentMode),
      ornamentWholeProbabilityPercent: clamp(
        Math.round(numberValue(channelHocket.ornamentWholeProbabilityPercent, 0)),
        0,
        100
      ),
      ornamentPerGraceProbabilityPercent: clamp(
        Math.round(numberValue(channelHocket.ornamentPerGraceProbabilityPercent, 0)),
        0,
        100
      ),
      accentRules: normalizeChannelAccentRules(channelHocket.accentRules),
      positionRules: normalizeChannelPositionRules(channelHocket.positionRules),
      // Pre-v6 documents carry neither field; plain defaulting (no tri-state)
      // because assignMode alone gates the euclid block's behavior.
      assignMode: channelHocket.assignMode === "euclid" ? "euclid" : "markov",
      euclid: normalizeEuclidChannelFromPatch(channelHocket.euclid),
    },
    setup: {
      open: boolValue(setup.open, false),
      tab: normalizeSetupTab(setup.tab),
      autosaveEnabled: boolValue(
        setup.autosaveEnabled,
        boolValue(setup.restoreAutosaveOnLaunch, readAutosaveEnabledPreference())
      ),
      autosaveIntervalMs: normalizeAutosaveIntervalMs(setup.autosaveIntervalMs),
      autoloadRecentSession: boolValue(setup.autoloadRecentSession, true),
    },
    ui: {
      synthPropertiesOpen: boolValue(ui.synthPropertiesOpen, false),
      midiDebugOpen: boolValue(ui.midiDebugOpen, false),
      midiDebugLimit: normalizeMidiDebugLimit(ui.midiDebugLimit),
      automationDebugOpen: boolValue(ui.automationDebugOpen, false),
      automationDebugLimit: normalizeAutomationDebugLimit(ui.automationDebugLimit),
      seedSetupOpen: boolValue(ui.seedSetupOpen, false),
      seedSetupTab: normalizeSeedDialogTab(ui.seedSetupTab),
      seedLogScope: normalizeSeedLogScope(ui.seedLogScope),
      automationOpen: boolValue(ui.automationOpen, false),
      timelineAutomationTargetIds: normalizeStringList(ui.timelineAutomationTargetIds),
      channelLogicHelpOpen: boolValue(ui.channelLogicHelpOpen, false),
    },
    seedPaths: normalizeSeedPaths(value.seedPaths),
    scoreSnapshot: value.scoreSnapshot ?? null,
  };
  const document = withProjectState(
    flat,
    hasProject
      ? normalizeParallelProjectPatch(input.project, flat, schemaVersion)
      : null
  );
  if (loadWarnings.length > 0) {
    Object.defineProperty(document, "loadWarnings", {
      value: loadWarnings,
      enumerable: false,
    });
  }
  return document;
}


export function makeBoundaries(cycleBeats: number): BoundaryPoint[] {
  return [
    { id: "boundary-after-2", afterBeat: 2, changeProbability: 0.29 },
    { id: "boundary-after-6", afterBeat: 6, changeProbability: 0.4 },
  ]
    .filter((boundary) => boundary.afterBeat < cycleBeats)
    .map((boundary) => ({
      ...boundary,
      id: boundary.id || boundaryIdForAfterBeat(boundary.afterBeat),
      weights: cloneWeights(DEFAULT_SWITCH_WEIGHTS),
      jathiWeights: cloneJathiWeights(DEFAULT_JATHI_WEIGHTS),
      customSubdivision: null,
    }));
}


export function normalizeBoundaries(
  boundaries: BoundaryPoint[],
  cycleBeats: number
): BoundaryPoint[] {
  const seen = new Set<number>();
  return boundaries
    .map((boundary) => ({
      ...boundary,
      id: boundary.id || boundaryIdForAfterBeat(boundary.afterBeat),
      afterBeat: clamp(
        Math.round(boundary.afterBeat || 1),
        1,
        Math.max(1, cycleBeats - 1)
      ),
      changeProbability: clamp(boundary.changeProbability, 0, 1),
      weights: cloneWeights(boundary.weights),
      jathiWeights: cloneJathiWeights(boundary.jathiWeights),
      customSubdivision: cloneCustomSubdivision(boundary.customSubdivision),
      jathiBhedam: cloneJathiBhedam(boundary.jathiBhedam),
    }))
    .filter((boundary) => {
      if (boundary.afterBeat >= cycleBeats || seen.has(boundary.afterBeat)) {
        return false;
      }
      seen.add(boundary.afterBeat);
      return true;
    })
    .sort((a, b) => a.afterBeat - b.afterBeat);
}


export function cleanAccentRange(min: number, max: number): { min: number; max: number } {
  const lo = clamp(Math.round(min || 0), 0, 127);
  const hi = clamp(Math.round(max || 0), 0, 127);
  return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
}


export function patternLabel(pattern: RhythmPattern): string {
  return `[${pattern.pulses.join(", ")}]`;
}


export function patternKey(pattern: RhythmPattern): string {
  return pattern.pulses.join("-");
}


export function enumerateRhythmPatterns(length: number): RhythmPattern[] {
  if (length <= 0 || length > RHYTHM_PATTERN_ENUMERATION_LIMIT) return [];
  const patterns: RhythmPattern[] = [];
  const current: number[] = [];

  const visit = (remaining: number) => {
    if (remaining === 0) {
      patterns.push({ pulses: [...current] });
      return;
    }
    for (let next = 1; next <= remaining; next += 1) {
      current.push(next);
      visit(remaining - next);
      current.pop();
    }
  };

  visit(length);
  return patterns.sort((a, b) => {
    if (a.pulses.length !== b.pulses.length) {
      return a.pulses.length - b.pulses.length;
    }
    return patternLabel(a).localeCompare(patternLabel(b));
  });
}


export function defaultRhythmStates(length: number): RhythmPattern[] {
  if (length > RHYTHM_PATTERN_ENUMERATION_LIMIT) {
    const candidates: RhythmPattern[] = [{ pulses: [length] }];
    const balanced = (count: number) => {
      if (count <= 1 || count > 4 || length < count) return;
      const base = Math.floor(length / count);
      const remainder = length % count;
      const pulses = Array.from({ length: count }, (_, index) =>
        base + (index < remainder ? 1 : 0)
      ).filter((pulse) => pulse > 0);
      if (pulses.length === count) {
        candidates.push({ pulses });
      }
    };
    balanced(2);
    balanced(3);
    balanced(4);
    const seen = new Set<string>();
    return candidates.filter((pattern) => {
      const key = patternKey(pattern);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const seen = new Set<string>();
  const states: RhythmPattern[] = [];
  for (const pattern of enumerateRhythmPatterns(length)) {
    if (pattern.pulses.length > 4) continue;
    const key = patternKey(pattern);
    if (seen.has(key)) continue;
    seen.add(key);
    states.push(pattern);
    if (states.length >= RHYTHM_STATE_LIMIT) break;
  }
  return states;
}


export function normalizeMidiChannels(value: unknown): number[] {
  const source = Array.isArray(value) ? value : [];
  const channels = source
    .map((channel) => clamp(Math.round(numberValue(channel, 0)), 1, 16))
    .filter((channel, index, list) => list.indexOf(channel) === index);
  return channels.length ? channels : [];
}


export function cloneSynthVoices(voices: SynthChannelProgram[]): SynthChannelProgram[] {
  return voices.map((voice) => ({ ...voice }));
}


export function normalizeSynthMode(value: unknown): SynthChannelMode {
  return value === "percussion" ? "percussion" : "melodic";
}


export function normalizeSynthPrograms(value: unknown): SynthChannelProgram[] {
  const voices = cloneSynthVoices(DEFAULT_SYNTH_VOICES);
  if (!Array.isArray(value)) {
    return voices;
  }
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const channel = clamp(Math.round(numberValue(item.channel, 1)), 1, 16);
    voices[channel - 1] = {
      channel,
      mode: normalizeSynthMode(item.mode),
      program: clamp(Math.round(numberValue(item.program, DEFAULT_SYNTH_PROGRAMS[channel - 1] ?? 0)), 0, 127),
      drumNote: clamp(
        Math.round(numberValue(item.drumNote, DEFAULT_SYNTH_DRUM_NOTES[channel - 1] ?? 36)),
        0,
        127
      ),
    };
  }
  return voices;
}


export function synthProgramsToRequest(voices: SynthChannelProgram[]): SynthChannelProgram[] {
  const normalized = normalizeSynthPrograms(voices);
  return MIDI_CHANNELS.map((channel) => {
    const voice = normalized[channel - 1] ?? DEFAULT_SYNTH_VOICES[channel - 1]!;
    return {
      channel,
      mode: voice.mode,
      program: clamp(Math.round(voice.program), 0, 127),
      drumNote: clamp(Math.round(voice.drumNote), 0, 127),
    };
  });
}


export function normalizeChannelRatchetMode(value: unknown): ChannelHocketRatchetMode {
  return value === "wholeRatchet" || value === "perRatchetHit"
    ? value
    : "sourceChannel";
}


export function normalizeChannelOrnamentMode(value: unknown): ChannelHocketOrnamentMode {
  return value === "wholeOrnament" || value === "perGraceNote"
    ? value
    : "sourceChannel";
}


export function normalizeChannelAccentMode(value: unknown): ChannelAccentRoutingMode {
  return value === "driveChain" ? "driveChain" : "renderOnly";
}


export function cloneChannelAccentRules(
  rules: PatchChannelAccentRule[]
): PatchChannelAccentRule[] {
  return rules.map((rule) => ({ ...rule, weights: { ...rule.weights } }));
}

export function normalizeChannelPositionScope(value: unknown): ChannelPositionScope {
  return value === "section" ? "section" : "beat";
}

export function normalizeChannelPositionResetMode(
  value: unknown
): ChannelPositionResetMode {
  if (value === "weightedFallback") return "weightedFallback";
  if (value === "customWeighted") return "customWeighted";
  return "staticFallback";
}

function normalizeChannelPositionActionWeights(
  value: unknown
): ChannelPositionActionWeights {
  const source = isRecord(value) ? value : {};
  return {
    normalMarkov: clamp(
      Math.round(numberValue(source.normalMarkov, 0)),
      0,
      999
    ),
    renderOnly: clamp(Math.round(numberValue(source.renderOnly, 1)), 0, 999),
    resetMarkov: clamp(
      Math.round(numberValue(source.resetMarkov, 0)),
      0,
      999
    ),
  };
}

export function cloneChannelPositionRules(
  rules: PatchChannelPositionRule[]
): PatchChannelPositionRule[] {
  return rules.map((rule) => ({
    ...rule,
    actionWeights: { ...rule.actionWeights },
    renderWeights: { ...rule.renderWeights },
    resetWeights: { ...rule.resetWeights },
  }));
}

export const EUCLID_CHANNEL_MAX_STEPS = 64;

export const EUCLID_CHANNEL_MAX_LAYERS = 16;

export function defaultEuclidChannelState(): PatchEuclidChannelState {
  return {
    placement: "partition",
    steps: 16,
    layers: [],
    reset: "cycle",
    spanAccentMode: "woven",
    spanAccentChannel: null,
  };
}

function normalizeEuclidPlacement(value: unknown): EuclidPlacement {
  return value === "stack" ? "stack" : "partition";
}

function normalizeEuclidResetScope(value: unknown): EuclidResetScope {
  return value === "section" || value === "beat" || value === "accentSpan"
    ? value
    : "cycle";
}

function normalizeEuclidSpanAccentMode(value: unknown): EuclidSpanAccentMode {
  return value === "bypass" ? "bypass" : "woven";
}

export function normalizeEuclidChannelFromPatch(
  value: unknown
): PatchEuclidChannelState {
  const defaults = defaultEuclidChannelState();
  if (!isRecord(value)) return defaults;
  const steps = clamp(
    Math.round(numberValue(value.steps, defaults.steps)),
    1,
    EUCLID_CHANNEL_MAX_STEPS
  );
  const layers = (Array.isArray(value.layers) ? value.layers : [])
    .slice(0, EUCLID_CHANNEL_MAX_LAYERS)
    .map((item): PatchEuclidChannelLayer | null => {
      if (!isRecord(item)) return null;
      return {
        channel: clamp(Math.round(numberValue(item.channel, 1)), 1, 16),
        pulses: clamp(
          Math.round(numberValue(item.pulses, 0)),
          0,
          EUCLID_CHANNEL_MAX_STEPS
        ),
        rotation: clamp(
          Math.round(numberValue(item.rotation, 0)),
          0,
          EUCLID_CHANNEL_MAX_STEPS - 1
        ),
        maxRun: clamp(
          Math.round(numberValue(item.maxRun, 1)),
          1,
          EUCLID_CHANNEL_MAX_STEPS
        ),
        steps: clamp(
          Math.round(numberValue(item.steps, 16)),
          1,
          EUCLID_CHANNEL_MAX_STEPS
        ),
        invert: boolValue(item.invert, false),
      };
    })
    .filter((layer): layer is PatchEuclidChannelLayer => layer !== null);
  const spanAccentChannel =
    value.spanAccentChannel === null || value.spanAccentChannel === undefined
      ? null
      : clamp(Math.round(numberValue(value.spanAccentChannel, 1)), 1, 16);
  return {
    placement: normalizeEuclidPlacement(value.placement),
    steps,
    layers,
    reset: normalizeEuclidResetScope(value.reset),
    spanAccentMode: normalizeEuclidSpanAccentMode(value.spanAccentMode),
    spanAccentChannel,
  };
}

export function normalizeChannelPositionRules(value: unknown): PatchChannelPositionRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const fallbackId = `channel-position-${index + 1}`;
      let id = stringValue(item.id, fallbackId).trim() || fallbackId;
      if (seen.has(id)) {
        id = `${id}-${index + 1}`;
      }
      seen.add(id);
      return {
        id,
        label: stringValue(item.label, `Position ${index + 1}`),
        enabled: boolValue(item.enabled, true),
        scope: normalizeChannelPositionScope(item.scope),
        nth: clamp(Math.round(numberValue(item.nth, 1)), 1, 999),
        actionWeights: normalizeChannelPositionActionWeights(item.actionWeights),
        renderWeights: normalizeNumberRecord(item.renderWeights),
        resetMode: normalizeChannelPositionResetMode(item.resetMode),
        resetWeights: normalizeNumberRecord(item.resetWeights),
      };
    })
    .filter((rule): rule is PatchChannelPositionRule => rule !== null);
}


export function normalizeChannelAccentRules(value: unknown): PatchChannelAccentRule[] {
  const explicit = Array.isArray(value);
  const source = explicit ? value : [];
  const rules = source
    .map((item, index) => {
      if (!isRecord(item)) {
        return null;
      }
      const fallback = DEFAULT_CHANNEL_ACCENT_RULES[index] ?? {
        label: `Accent ${index + 1}`,
        enabled: false,
        minVelocity: 100,
        maxVelocity: 127,
        probabilityPercent: 100,
        mode: "renderOnly" as ChannelAccentRoutingMode,
        weights: {},
      };
      const minVelocity = clamp(
        Math.round(numberValue(item.minVelocity, fallback.minVelocity)),
        1,
        127
      );
      const maxVelocity = clamp(
        Math.round(numberValue(item.maxVelocity, fallback.maxVelocity)),
        1,
        127
      );
      return {
        label: stringValue(item.label, fallback.label),
        enabled: boolValue(item.enabled, fallback.enabled),
        minVelocity: Math.min(minVelocity, maxVelocity),
        maxVelocity: Math.max(minVelocity, maxVelocity),
        probabilityPercent: clamp(
          Math.round(numberValue(item.probabilityPercent, fallback.probabilityPercent)),
          0,
          100
        ),
        mode: normalizeChannelAccentMode(item.mode),
        weights: normalizeNumberRecord(item.weights),
      };
    })
    .filter((rule): rule is PatchChannelAccentRule => rule !== null);
  return rules.length
    ? rules
    : [];
}


export function pitchName(midi: number): string {
  const pitch = clamp(Math.round(midi), 0, 127);
  const name = PITCH_NAMES[pitch % 12] ?? "C";
  const octave = Math.floor(pitch / 12) - 1;
  return `${name}${octave}`;
}


export function limitedTranspositionPreset(id: string) {
  return (
    LIMITED_TRANSPOSITION_COLLECTIONS.find((preset) => preset.id === id) ??
    LIMITED_TRANSPOSITION_COLLECTIONS.find((preset) => preset.id === "major") ??
    LIMITED_TRANSPOSITION_COLLECTIONS[0]!
  );
}


export function pitchStatesForCollection(
  collectionId: string,
  transposition: number,
  low: number,
  high: number
): PitchState[] {
  const preset = limitedTranspositionPreset(collectionId);
  const lo = clamp(Math.round(Math.min(low, high)), 0, 127);
  const hi = clamp(Math.round(Math.max(low, high)), 0, 127);
  const pitchClasses = new Set(
    preset.pitchClasses.map((pc) => ((pc + transposition) % 12 + 12) % 12)
  );
  const states: PitchState[] = [];
  for (let pitch = lo; pitch <= hi; pitch += 1) {
    if (pitchClasses.has(pitch % 12)) {
      states.push({ pitch, label: pitchName(pitch) });
    }
  }
  return states.slice(0, 24);
}


export function pitchStateKey(state: PitchState | number): string {
  const pitch = typeof state === "number" ? state : state.pitch;
  return String(clamp(Math.round(pitch), 0, 127));
}


export function defaultPitchStateKeys(states: PitchState[]): string[] {
  return states.slice(0, PITCH_MATRIX_STATE_LIMIT).map(pitchStateKey);
}


export function pitchStatesFromKeys(states: PitchState[], keys: string[]): PitchState[] {
  const byKey = new Map(states.map((state) => [pitchStateKey(state), state]));
  return keys
    .map((key) => byKey.get(key))
    .filter((state): state is PitchState => state !== undefined);
}


export function normalizePitchSelectedKeys(
  states: PitchState[],
  value: unknown
): string[] {
  const validKeys = new Set(states.map(pitchStateKey));
  const selected = normalizeStringList(value).filter((key) => validKeys.has(key));
  return selected.length > 0 ? selected : defaultPitchStateKeys(states);
}


export function normalizePitchTab(value: unknown): PitchTab {
  if (value === "matrix" || value === "gracePitch" || value === "seeds") {
    return value;
  }
  if (value === "transpose") return "gracePitch";
  return "collection";
}


export function normalizePitchBoundaryPolicy(value: unknown): PitchBoundaryPolicy {
  return value === "clamp" ||
    value === "reflect" ||
    value === "fallback" ||
    value === "nearest"
    ? value
    : "wrap";
}


export function normalizePitchBoundary(value: unknown): PitchBoundary {
  const source = isRecord(value) ? value : {};
  const low = clamp(Math.round(numberValue(source.low, 0)), 0, 127);
  const high = clamp(Math.round(numberValue(source.high, 127)), 0, 127);
  return {
    low: Math.min(low, high),
    high: Math.max(low, high),
    modulo: clamp(Math.round(numberValue(source.modulo, 12)), 1, 48),
    policy: normalizePitchBoundaryPolicy(source.policy),
  };
}


export function normalizePitchRatchetMode(value: unknown): PitchRatchetMode {
  return value === "wholeRatchet" || value === "perRatchetHit"
    ? value
    : "sourcePitch";
}


export function normalizePitchOrnamentMode(value: unknown): PitchOrnamentMode {
  return value === "wholeOrnament" || value === "perGraceNote"
    ? value
    : "sourcePitch";
}


export function normalizeGracePitchScope(value: unknown): GracePitchScope {
  return value === "perGraceNote" ? "perGraceNote" : "wholeCluster";
}


export function normalizePitchTranspositionMode(value: unknown): PitchTranspositionMode {
  return value === "stairStep" ? "stairStep" : "singleNote";
}


export function normalizePitchStates(value: unknown): PitchState[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const states = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const pitch = clamp(Math.round(numberValue(item.pitch, 60)), 0, 127);
    return [
      {
        pitch,
        label: stringValue(item.label, pitchName(pitch)),
      },
    ];
  });
  const deduped: PitchState[] = [];
  const seen = new Set<number>();
  for (const state of states) {
    if (seen.has(state.pitch)) continue;
    seen.add(state.pitch);
    deduped.push(state);
  }
  return deduped.slice(0, 24);
}


export function normalizeWeightedMidiPitches(
  value: unknown,
  fallback: WeightedMidiPitch[] = []
): WeightedMidiPitch[] {
  const explicit = Array.isArray(value);
  const source = explicit ? value : fallback;
  const seen = new Set<number>();
  const pitches = source.flatMap((item) => {
    if (!isRecord(item)) return [];
    const pitch = clamp(Math.round(numberValue(item.pitch, 60)), 0, 127);
    if (seen.has(pitch)) return [];
    seen.add(pitch);
    return [
      {
        pitch,
        weight: clamp(Math.round(numberValue(item.weight, 0)), 0, 999),
      },
    ];
  });
  return pitches.length
    ? pitches.slice(0, 24)
    : explicit
      ? []
    : fallback.map((pitch) => ({
        pitch: clamp(Math.round(pitch.pitch), 0, 127),
        weight: clamp(Math.round(pitch.weight), 0, 999),
      }));
}


export function normalizeGraceTransposeIntervals(
  value: unknown,
  fallback: WeightedPitchInterval[] = []
): WeightedPitchInterval[] {
  const explicit = Array.isArray(value);
  const source = explicit ? value : fallback;
  const seen = new Set<number>();
  const intervals = source.flatMap((item) => {
    if (!isRecord(item)) return [];
    const semitones = clamp(
      Math.abs(Math.round(numberValue(item.semitones, 1))),
      1,
      48
    );
    if (seen.has(semitones)) return [];
    seen.add(semitones);
    return [
      {
        semitones,
        weight: clamp(Math.round(numberValue(item.weight, 0)), 0, 999),
      },
    ];
  });
  return intervals.length
    ? intervals.slice(0, 24)
    : explicit
      ? []
    : fallback.map((interval) => ({
        semitones: clamp(Math.abs(Math.round(interval.semitones)), 1, 48),
        weight: clamp(Math.round(interval.weight), 0, 999),
      }));
}


export function defaultRhythmPatternKeys(length: number): string[] {
  return defaultRhythmStates(length).map(patternKey);
}


export function rhythmPatternsFromKeys(length: number, keys: string[]): RhythmPattern[] {
  const byKey = new Map(enumerateRhythmPatterns(length).map((pattern) => [patternKey(pattern), pattern]));
  return keys
    .map((key) => byKey.get(key) ?? parsePatternKeyForLength(key, length))
    .filter((pattern): pattern is RhythmPattern => pattern !== undefined);
}


export function parsePatternKeyForLength(key: string, length: number): RhythmPattern | undefined {
  const pulses = key
    .split("-")
    .map((part) => Math.round(Number(part)))
    .filter((pulse) => Number.isFinite(pulse) && pulse > 0);
  if (!pulses.length || pulses.reduce((sum, pulse) => sum + pulse, 0) !== length) {
    return undefined;
  }
  return { pulses };
}


// =====================================================================
// Single-track export / import envelope
//
// A track export is a small, self-contained document that wraps exactly
// one `ParallelTrackPatch`. It lets a track authored in one project be
// re-imported as a fresh track in any project. The envelope intentionally
// carries the source project's *reference* timing (tempo + cycle length)
// as `globalContext`, so an importer can choose to keep the track sounding
// as it did at export time (by pinning it to track-local timing) or snap it
// to the destination project's global timing.
//
// Integrity rules that are the *importer's* job (never trusted from the
// file): id uniqueness, name de-duplication, channel-logic / conflict-
// priority reconciliation, and stripping replay state that cannot be
// faithfully reproduced in a new project. Those all live in
// `spliceImportedTrack` below, not in `readTrackEnvelope`.
// =====================================================================

export const TRACK_DOCUMENT_KIND = "track";

export const TRACK_FILE_EXTENSION = "dumka-track";

/** Reference timing captured from the source project at export time. */
export interface TrackGlobalContext {
  tempoBpm: number;
  cycleBeats: number;
}

export interface TrackEnvelope {
  app: typeof PATCH_APP_ID;
  kind: typeof TRACK_DOCUMENT_KIND;
  schemaVersion: typeof PATCH_SCHEMA_VERSION;
  savedAt: string;
  track: ParallelTrackPatch;
  /** The source project's global reference timing, for import-time choice. */
  globalContext: TrackGlobalContext;
}

/** Result of decoding a track file: a normalized track plus its source timing. */
export interface ReadTrackEnvelopeResult {
  track: ParallelTrackPatch;
  globalContext: TrackGlobalContext | null;
  /** Tolerant generator-plan repairs the importer should surface to the user. */
  loadWarnings: string[];
}

export interface SpliceImportedTrackOptions {
  /**
   * When `true`, the imported track keeps the timing it had at export time by
   * pinning it to track-local `custom` tempo/cycle. Global-following fields use
   * the captured `globalContext`; existing custom fields keep their own saved
   * values. When `false`, the track follows the destination project's global
   * timing (`tempoMode`/`cycleLengthMode` set to `"global"`).
   */
  keepTrackLocalTiming: boolean;
  /** Reference timing captured from the source project (from the envelope). */
  importedGlobalContext: TrackGlobalContext | null;
  /** Reference timing for the destination project. */
  destinationGlobal: TrackGlobalContext;
  /** Preferred display name; falls back to a de-duplicated default. */
  preferredName?: string;
}

/**
 * Build a single-track export envelope around a project track. The track is
 * deep-cloned so later edits to the live project do not mutate the file.
 */
export function buildTrackEnvelope(
  track: ParallelTrackPatch,
  globalContext: TrackGlobalContext,
  savedAt: string = new Date().toISOString()
): TrackEnvelope {
  const envelope: TrackEnvelope = {
    app: PATCH_APP_ID,
    kind: TRACK_DOCUMENT_KIND,
    schemaVersion: PATCH_SCHEMA_VERSION,
    savedAt,
    track: clonePatchJsonValue(track),
    globalContext: {
      tempoBpm: clamp(numberValue(globalContext.tempoBpm, 80), 20, 400),
      cycleBeats: clamp(Math.round(numberValue(globalContext.cycleBeats, 8)), 1, 64),
    },
  };
  Object.defineProperty(envelope, "toJSON", {
    value: () => trackEnvelopeForPersistence(envelope),
    enumerable: false,
  });
  return envelope;
}

export function trackEnvelopeForPersistence(envelope: TrackEnvelope) {
  return {
    app: envelope.app,
    kind: envelope.kind,
    schemaVersion: envelope.schemaVersion,
    savedAt: envelope.savedAt,
    track: trackForPersistence(envelope.track),
    globalContext: envelope.globalContext,
  };
}

/**
 * Decode and normalize a single-track export envelope. Rejects documents that
 * were not produced by this app, are not track envelopes, or use an
 * unsupported schema. The returned track is fully normalized through the same
 * path as project tracks, so unknown/partial input cannot poison the project.
 */
export function readTrackEnvelope(input: unknown): ReadTrackEnvelopeResult {
  if (!isRecord(input)) {
    throw new Error("Track file must contain a JSON object.");
  }
  if (input.app !== PATCH_APP_ID) {
    throw new Error("Track file was not saved by Dum-Ka.");
  }
  if (input.kind !== TRACK_DOCUMENT_KIND) {
    throw new Error("File is not a Dum-Ka track export.");
  }
  if (input.schemaVersion !== PATCH_SCHEMA_VERSION) {
    throw new Error(`Unsupported track schema: ${String(input.schemaVersion)}`);
  }
  if (!isRecord(input.track)) {
    throw new Error("Track file is missing track state.");
  }

  // Derive a complete fallback flat-state by running an empty stub through the
  // project reader. This fills every default the track normalizer relies on
  // without duplicating defaults here.
  const fallback = readPatchDocument({
    app: PATCH_APP_ID,
    schemaVersion: PATCH_SCHEMA_VERSION,
    transport: {},
    sequencer: {},
    rhythm: {},
    project: {
      activeTrackId: DEFAULT_PARALLEL_TRACK_ID,
      global: {},
      tracks: [{ id: DEFAULT_PARALLEL_TRACK_ID }],
    },
  });

  const rawGlobalContext = isRecord(input.globalContext)
    ? input.globalContext
    : null;
  const globalContext: TrackGlobalContext | null = rawGlobalContext
    ? {
        tempoBpm: clamp(
          numberValue(rawGlobalContext.tempoBpm, fallback.transport.tempoBpm),
          20,
          400
        ),
        cycleBeats: clamp(
          Math.round(
            numberValue(rawGlobalContext.cycleBeats, fallback.sequencer.cycleBeats)
          ),
          1,
          64
        ),
      }
    : null;

  const track = normalizeParallelTrackPatch(
    input.track,
    0,
    fallback,
    PATCH_SCHEMA_VERSION,
    globalContext?.tempoBpm ?? fallback.transport.tempoBpm
  );
  if (!track) {
    throw new Error("Track file contains an unreadable track.");
  }

  return {
    track,
    globalContext,
    loadWarnings: evolutionPlanLoadWarnings([input.track.generator]),
  };
}

/**
 * Insert an imported track into a project as a brand-new track, returning a new
 * project (the input is not mutated). Caller must guard `MAX_PARALLEL_TRACKS`
 * before calling; this throws if the project is already full so the invariant
 * can never be violated silently.
 */
export function spliceImportedTrack(
  project: ParallelProjectPatch,
  importedTrack: ParallelTrackPatch,
  options: SpliceImportedTrackOptions
): ParallelProjectPatch {
  if (project.tracks.length >= MAX_PARALLEL_TRACKS) {
    throw new Error(
      `Cannot import: project already has the maximum of ${MAX_PARALLEL_TRACKS} tracks.`
    );
  }

  const next = clonePatchJsonValue(project);
  const nextIndex = next.tracks.length;

  const track = clonePatchJsonValue(importedTrack);

  // Never trust the imported id — always mint a fresh unique one so an import
  // can never collide with (or silently overwrite) an existing track.
  track.id = uniqueParallelTrackId(`track-${nextIndex + 1}`, next.tracks);
  track.name = uniqueParallelTrackName(
    options.preferredName ?? track.name,
    next.tracks
  );
  track.color = parallelTrackColor(nextIndex);
  // An imported track is never silent or solo-isolating on arrival.
  track.muted = false;
  track.soloed = false;

  if (options.keepTrackLocalTiming) {
    // Preserve how the track sounded at export time by pinning it to its own
    // tempo/cycle. Track-local custom values are already the saved timing; a
    // global-following field uses the exported source project's reference.
    const savedTempoBpm =
      track.tempoMode === "custom"
        ? track.customTempoBpm
        : options.importedGlobalContext?.tempoBpm ??
          options.destinationGlobal.tempoBpm;
    const savedCycleBeats =
      track.cycleLengthMode === "custom"
        ? track.customCycleBeats
        : options.importedGlobalContext?.cycleBeats ??
          options.destinationGlobal.cycleBeats;
    track.tempoMode = "custom";
    track.customTempoBpm = clamp(
      numberValue(savedTempoBpm, options.destinationGlobal.tempoBpm),
      20,
      400
    );
    track.cycleLengthMode = "custom";
    track.customCycleBeats = clamp(
      Math.round(numberValue(savedCycleBeats, options.destinationGlobal.cycleBeats)),
      1,
      64
    );
  } else {
    // Follow the destination project's global timing.
    track.tempoMode = "global";
    track.customTempoBpm = clamp(
      numberValue(options.destinationGlobal.tempoBpm, track.customTempoBpm),
      20,
      400
    );
    track.cycleLengthMode = "global";
    track.customCycleBeats = clamp(
      Math.round(
        numberValue(options.destinationGlobal.cycleBeats, track.customCycleBeats)
      ),
      1,
      64
    );
  }

  // Replay state is tied to the *source* project's exact pipeline and track
  // ids; it cannot be faithfully reproduced in a new project, and stale track
  // ids inside it would mismatch or collide. Drop it — the track will replay
  // deterministically from its own settings.
  track.seedPaths = [];
  track.scoreSnapshot = null;

  // A trigger's `sourceTrackId` points at a track in the *source* project that
  // does not exist in this one, so the imported edge would be dangling. Drop it
  // — the track lands as continuous and the user can re-point it. (The backend
  // would also reject a dangling source, but failing safe here keeps the patch
  // clean, exactly like the seed-path strip above.)
  track.trigger = null;

  next.tracks = [...next.tracks, track];
  next.activeTrackId = track.id;

  // Channel-conflict bookkeeping is project-level and must be re-derived so the
  // new track participates correctly and no dangling rules survive. Box lane ids
  // are runtime participants, so they stay in the endpoint set (authored box-lane
  // rules must not be dropped by ordinary track import).
  const endpoints = runtimeEndpointTrackIds(next.tracks, next.global.trackFlowBoxes);
  next.global.conflictPriority = normalizedConflictPriority(
    [...next.global.conflictPriority, track.id],
    endpoints
  );
  next.global.channelLogicMatrix = normalizeChannelLogicMatrix(
    next.global.channelLogicMatrix,
    endpoints,
    next.global.channelConflictPolicy
  );

  return next;
}

function clonePatchJsonValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueParallelTrackId(
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

function uniqueParallelTrackName(
  preferred: string,
  tracks: Pick<ParallelTrackPatch, "name">[]
): string {
  const existing = new Set(tracks.map((track) => track.name.trim().toLowerCase()));
  const desired = preferred.trim();
  if (desired && !existing.has(desired.toLowerCase())) return desired;
  const root = desired || "Track";
  for (let index = 2; index <= MAX_PARALLEL_TRACKS * 4 + 1; index += 1) {
    const candidate = `${root} (${index})`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `${root} (${tracks.length + 1})`;
}

function parallelTrackColor(index: number): string {
  return PARALLEL_TRACK_COLORS[index % PARALLEL_TRACK_COLORS.length]!;
}
