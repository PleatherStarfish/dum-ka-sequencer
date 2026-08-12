import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import {
  patchDocumentForPersistence,
  trackEnvelopeForPersistence,
  type SequencerPatchDocument,
  type TrackEnvelope,
} from "./patchIo";
import {
  normalizeU64SeedDecimal,
  normalizeU64SeedDecimalList,
  type U64SeedDecimal,
} from "./u64Seed";

export type { U64SeedDecimal } from "./u64Seed";

// ---------------------------------------------------------------------
// Types — these mirror the Rust DTOs (camelCase via serde rename_all)
// ---------------------------------------------------------------------

export interface TransportSnapshot {
  /**
   * Telemetry epochs. The streamed `transport_position` /
   * `transport_timeline_snapshot` / `transport_log_snapshot` events and this
   * initial-hydrate snapshot share one monotonic epoch space, so the frontend
   * can gate positions against the currently promoted timeline. The full
   * snapshot is only delivered via `transport_get_snapshot` (initial load);
   * it is never emitted at 60Hz.
   */
  sampleEpoch: number;
  timelineEpoch: number;
  logEpoch: number;
  tempoBpm: number;
  isPlaying: boolean;
  currentTick: number;
  currentCycle: number;
  ticksPerCycle: number;
  currentScoreId: string | null;
  parallelTrackPositions: ParallelTrackPosition[];
  midiDebugEvents: MidiDebugEvent[];
  automationEvents: AutomationPlaybackEvent[];
  channelHocketEvents: ChannelHocketPlaybackEvent[];
  seedTraceEvents: PlaybackSeedTraceEvent[];
  parallelConflictEvents: ParallelConflictDebugEvent[];
  /** GATE acceptance decisions (Phase C). The truthful trigger event log. */
  triggerDecisionEvents: TriggerDecisionEvent[];
  /**
   * Realized rhythm spans per cycle/track — the live timeline rhythm-row source,
   * from the same realization that drives audio. Parity with ratchet/ornament so
   * the depicted rhythm can't disagree with what played (e.g. history seed mode).
   */
  realizedRhythmEvents: RealizedRhythmSpanEvent[];
  /** Per-box Track Flow lane selections (each carries its box's `laneId`). */
  trackFlowEvents: TrackFlowPlaybackEvent[];
}

/**
 * High-frequency playhead clock (mirrors `TransportPositionDto`). Tiny,
 * latest-wins, emitted ~60Hz while playing. `timelineEpoch` identifies which
 * promoted timeline grid this position belongs to.
 */
export interface TransportPosition {
  sampleEpoch: number;
  timelineEpoch: number;
  tempoBpm: number;
  isPlaying: boolean;
  currentTick: number;
  currentCycle: number;
  ticksPerCycle: number;
  currentScoreId: string | null;
  parallelTrackPositions: ParallelTrackPosition[];
}

/**
 * One atomic playhead anchor: a position plus the time it was received. The
 * playhead dead-reckons from these two together, so they must never live in
 * separate refs a second event source could update independently.
 */
export type LivePositionSample = {
  position: TransportPosition;
  receivedAt: number;
};

export type TransportTelemetryInterest =
  | "none"
  | "seedTrace"
  | "trigger"
  | "seedTraceAndTrigger"
  | "full";

/**
 * Render-relevant timeline data (mirrors `TransportTimelineSnapshotDto`).
 * Cycle-coherent overlay layers only — no rolling logs. Emitted only when the
 * backend timeline digest changes (never on bare tick movement).
 */
export interface TransportTimelineSnapshot {
  sampleEpoch: number;
  timelineEpoch: number;
  tempoBpm: number;
  isPlaying: boolean;
  currentTick: number;
  currentCycle: number;
  ticksPerCycle: number;
  currentScoreId: string | null;
  parallelTrackPositions: ParallelTrackPosition[];
  channelHocketEvents: ChannelHocketPlaybackEvent[];
  realizedRhythmEvents: RealizedRhythmSpanEvent[];
  trackFlowEvents: TrackFlowPlaybackEvent[];
}

/**
 * Lower-priority diagnostic/trace data (mirrors `TransportLogSnapshotDto`).
 * Emitted only when a log consumer is interested (see
 * `transportSetTelemetryInterest`) and a log layer changed.
 */
export interface TransportLogSnapshot {
  sampleEpoch: number;
  logEpoch: number;
  timelineEpoch: number;
  logInterest: TransportTelemetryInterest;
  midiDebugEvents: MidiDebugEvent[];
  automationEvents: AutomationPlaybackEvent[];
  seedTraceEvents: PlaybackSeedTraceEvent[];
  parallelConflictEvents: ParallelConflictDebugEvent[];
  triggerDecisionEvents: TriggerDecisionEvent[];
}

/** One realized rhythm span for a cycle (mirrors `cseq_transport::RealizedRhythmSpanEvent`). */
export interface RealizedRhythmSpanEvent {
  cycle: number;
  parallelTrackIndex: number | null;
  parallelTrackId: string | null;
  span: ResolvedRhythmSpan;
}

/**
 * One Track Flow box selection (mirrors `cseq_transport::TrackFlowPlaybackEvent`):
 * which authored source a box's `track-flow-<boxId>` lane sounded for a lane
 * cycle. `laneId` lets the UI group selections per box; `sourceTrackId`/Name are
 * the display identity (the authored member, never the lane slot).
 */
export interface TrackFlowPlaybackEvent {
  cycle: number;
  referenceStartTick: number;
  laneId: string;
  sourceTrackId: string;
  sourceTrackName: string;
}

/**
 * One GATE acceptance decision (mirrors `cseq_transport::TriggerDecisionEvent`).
 * A by-product of the same pure compile that produced the launches, so the log
 * can never disagree with the audio.
 */
export interface TriggerDecisionEvent {
  trackIndex: number;
  trackId: string;
  trackName: string;
  sourceCycleIndex: number;
  matchedBeat: number;
  /** Raw matched-event reference tick (WHEN onset), the connector's start. */
  eventTick: number;
  candidateTick: number;
  /** Resolved START alignment kind (Phase D): "atEvent" | "atSourceCycleStart" |
   * "atNextReferenceBeat" | "afterEventTicks" | "centerInRest" | "atSourceReturn". */
  startKind: string;
  /** "launched" | "queued" | "suppressed". */
  outcome: string;
  /** For "suppressed": "gateProbability" | "gateCooldown" | "reTriggerIgnore" | "reTriggerQueueFull". */
  suppressReason: string | null;
  launchTick: number | null;
  runIndex: number | null;
  /** Probability roll in per-mille (0..=999) + threshold, when a roll was taken. */
  rollValue: number | null;
  rollThreshold: number | null;
  rollPassed: boolean | null;
  consecutiveMisses: number;
  lastAcceptSourceCycle: number | null;
}

export interface ParallelTrackPosition {
  trackIndex: number;
  trackId: string;
  trackName: string;
  cycle: number;
  tickInCycle: number;
  ticksPerCycle: number;
  referenceStartTick: number;
  referenceEndTick: number;
}

export interface MidiDebugEvent {
  sequence: number;
  absoluteTick: number;
  cycle: number;
  tickInCycle: number;
  channel: number | null;
  messageType: string;
  data1: number | null;
  data2: number | null;
  bytes: number[];
  debugSource: string | null;
  monitorBus: string | null;
  monitorUserChannel: number | null;
  monitorMode: SynthChannelMode | null;
  monitorProgram: number | null;
  monitorDrumNote: number | null;
  monitorBytes: number[] | null;
  parallelTrackId: string | null;
  parallelTrackName: string | null;
  parallelConflictPolicy: string | null;
  parallelConflictAction: string | null;
  parallelConflictGroupId: string | null;
}

export interface ParallelConflictDebugEvent {
  sequence: number;
  absoluteTick: number;
  cycle: number;
  tickInCycle: number;
  outputChannel: number;
  pitch: number;
  startTick: number;
  endTick: number;
  trackId: string;
  trackName: string;
  trackIndex: number;
  conflictPolicy: string;
  conflictAction: string;
  conflictGroupId: string;
  collidingTrackIds: string[];
  activeTrackCount: number;
  passed: boolean;
}

export interface AutomationPlaybackValue {
  target: string;
  value: number;
}

export interface AutomationPlaybackEvent {
  sequence: number;
  cycle: number;
  beatIndex: number;
  tickInCycle: number;
  automationPhase: AutomationTime;
  values: AutomationPlaybackValue[];
}

export type GraceNotePlacement = "beforeBeat" | "onBeat";
export type OrnamentPlaybackKind = "graceNote" | "delay";

export interface GraceNotePlacementWeights {
  beforeBeat: number;
  onBeat: number;
}


export type RhythmChoiceSource =
  | "initial"
  | "transition"
  | "fallback"
  | "missingChain"
  | "accent"
  | "position"
  | "pool"
  | "lock";

export type ChannelPositionScope = "beat" | "section";
export type ChannelPositionAction = "normalMarkov" | "renderOnly" | "resetMarkov";
export type ChannelPositionResetMode =
  | "staticFallback"
  | "weightedFallback"
  | "customWeighted";

export interface ChannelHocketPlaybackEvent {
  cycle: number;
  startTick: number;
  endTick: number;
  channel: number;
  source: RhythmChoiceSource;
  fallback: boolean;
  positionRuleId: string | null;
  positionRuleLabel: string | null;
  positionScope: ChannelPositionScope | null;
  positionNth: number | null;
  positionAction: ChannelPositionAction | null;
  parallelTrackIndex: number | null;
  parallelTrackId: string | null;
  parallelTrackName: string | null;
  /** True when parallel conflict resolution removed the corresponding note. */
  suppressed: boolean;
}

export interface PlaybackSeedTraceEvent {
  cycle: number;
  domain: string;
  label: string;
  seed: U64SeedDecimal;
  baseSeed: U64SeedDecimal | null;
  source: string;
  historyBefore: U64SeedDecimal[];
  historyAfter: U64SeedDecimal[];
  /** Source parallel track for this decision. `null` for single-track playback
   * and legacy data; set per track so seed-path replay can be filtered to the
   * track that recorded it. */
  parallelTrackIndex: number | null;
  trackId: string | null;
}

export interface SeedPathPlaybackConfig {
  entries: SeedPathPlaybackEntry[];
  wildcards: SeedPathWildcard[];
}

export interface SeedPathPlaybackEntry extends PlaybackSeedTraceEvent {}

export interface SeedPathWildcard {
  domain: string;
  cycle: number | null;
  /** Track this wildcard applies to. `null` applies to all tracks. */
  trackId: string | null;
}

export interface BeatEuclideanSpec {
  matras: number;
  hits: number;
  rotation: number;
  pitch: number;
  velocity: number;
}

export interface SubdivisionWeight {
  subdivision: number;
  weight: number;
}

export interface JathiWeight {
  jathi: number;
  weight: number;
}

// --- Jathi Bhedam (irregular, evolving accent layout) ---------------------
// An alternative accent layer to regular jathi, selected per section by a
// weighted, context-conditioned choice. Mirrors the `cseq-model` serde shapes.

export type JathiBhedamOp =
  | "retrograde"
  | "exchangeAdjacent"
  | "reorderFragments"
  | "repeatFragment"
  | "omitFragment"
  | "split"
  | "merge"
  | "insert"
  | "extend";

export type MukthayPolicy = "padToSam" | "truncateToSam";

export type JathiBhedamPhrasing =
  | { type: "accent" }
  | { type: "notesPerCell"; notes: number };

export interface FragmentSpan {
  start: number;
  end: number;
}

export interface WeightedJathiBhedamOp {
  op: JathiBhedamOp;
  weight: number;
}

export interface JathiBhedamSchedule {
  opsPerGeneration: number;
  menu: WeightedJathiBhedamOp[];
}

export interface JathiBhedamSpec {
  gati: number;
  beatsPerCycle: number;
  cycles: number;
  seedNumbers: number[];
  fragments: FragmentSpan[];
  phrasing: JathiBhedamPhrasing;
  schedule: JathiBhedamSchedule;
  mukthayPolicy: MukthayPolicy;
  seed: number;
}

export interface GatiBhedamWeight {
  gati: number;
  weight: number;
}

export interface BhedamLengthBias {
  thresholdBeats: number;
  shorterMult: number;
  longerMult: number;
}

export interface BhedamCyclePositionBias {
  startFraction: number;
  startMult: number;
  endFraction: number;
  endMult: number;
}

export interface JathiBhedamSelection {
  enabled: boolean;
  baseWeight: number;
  gatiWeights: GatiBhedamWeight[];
  lengthBias?: BhedamLengthBias | null;
  cyclePositionBias?: BhedamCyclePositionBias | null;
  spec: JathiBhedamSpec;
}

export interface CustomDivision {
  gatiWeights: SubdivisionWeight[];
}

export interface CustomPartCountChoice {
  count: number;
  weight: number;
}

export interface CustomSubdivision {
  perBeatWeight: number;
  equalPartsWeight: number;
  partCountWeights: CustomPartCountChoice[];
  partGatiWeights: SubdivisionWeight[];
  /** Legacy fixed equal-parts rows. New UI uses partCountWeights/partGatiWeights. */
  divisions: CustomDivision[];
  /** Legacy only. Regular section jathiWeights drive jathi in all grid modes. */
  jathiWeights: JathiWeight[];
}

export interface SubdivisionInflection {
  id?: string | null;
  position: number;
  changeProbability: number;
  subdivisionWeights: SubdivisionWeight[];
  jathiWeights: JathiWeight[];
  customSubdivision?: CustomSubdivision | null;
  /** Per-boundary Jathi Bhedam selection. Omitted/null => regular behavior. */
  jathiBhedam?: JathiBhedamSelection | null;
}

export interface SwitchCountWeight {
  count: number;
  weight: number;
}

export interface VelocityAccentRange {
  min: number;
  max: number;
}

export interface AccentSettings {
  beatStart: VelocityAccentRange;
  sectionStartExtra: VelocityAccentRange;
  jathiStart: VelocityAccentRange;
  jathiMode: "overrideGati" | "layered";
}

export interface AutomationTime {
  numer: number;
  denom: number;
}

export type AutomationValue =
  | { type: "number"; value: number }
  | { type: "bool"; value: boolean }
  | { type: "text"; value: string };

export type AutomationInterpolation = "hold" | "linear" | "smooth";
export type AutomationSegmentCurveKind =
  | "hold"
  | "linear"
  | "smooth"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "exponential";
export interface AutomationSegmentCurve {
  kind: AutomationSegmentCurveKind;
  amount: number;
}
export type AutomationCombineMode = "replace" | "add" | "multiply";
export type AutomationValueKind = "boolean" | "integer" | "float" | "weight";
export type AutomationSampleRate =
  | "beat"
  | "sectionStart"
  | "cycleStart"
  | "rhythmSpan"
  | "noteGroup";

export interface AutomationPoint {
  id?: string | null;
  time: AutomationTime;
  value: AutomationValue;
  anchorId?: string | null;
  outCurve?: AutomationSegmentCurve | null;
}

export interface AutomationCurve {
  id: string;
  enabled: boolean;
  interpolation: AutomationInterpolation;
  points: AutomationPoint[];
}

export interface AutomationGraphRange {
  min: number;
  max: number;
}

export interface AutomationTrack {
  id: string;
  target: string;
  enabled: boolean;
  combine: AutomationCombineMode;
  graphRange?: AutomationGraphRange | null;
  curves: AutomationCurve[];
}

export interface AutomationMarker {
  id: string;
  time: AutomationTime;
  label: string;
}

export interface AutomationSet {
  lengthCycles: number;
  markers: AutomationMarker[];
  tracks: AutomationTrack[];
}

export interface AutomationBeatValue {
  target: string;
  value: number;
}

export interface ResolvedBeat {
  beat: number;
  start: number;
  end: number;
  gati: number;
  effectiveGati: number;
  divisionIndex?: number | null;
  divisionCount?: number | null;
  sectionIndex: number;
  jathi: number | null;
  sectionStart: boolean;
  accentVelocity: number;
  pitch: number;
  baseVelocity: number;
  automationPhase: AutomationTime;
  automationValues: AutomationBeatValue[];
}

export interface PulseSpan {
  id: number;
  kind: "section" | "gatiBeat" | "jathiPulse";
  sectionIndex: number | null;
  beat: number | null;
  gati: number | null;
  jathi: number | null;
  index: number | null;
  start: number;
  duration: number;
  startMatra: number;
  matraLen: number;
  /** Exact matras per beat, derived by Rust from rational span geometry. */
  subdivision: number | null;
  protectedCuts: number[];
  tags: string[];
  /**
   * Authored-leaf velocity per span-local matra (beat/section/grouping accents
   * included), computed by the transport's own leaf-inheritance rule. Empty for
   * section spans. Forwarded into `generator_preview` as `spanVelocities` so
   * preview cells carry the same velocities realized playback reports.
   */
  matraVelocities: number[];
}

export interface SubdivisionSwitchPreview {
  cycle: number;
  beats: ResolvedBeat[];
  pulseSpans: PulseSpan[];
  historySeeds: U64SeedDecimal[];
}

export type MarkovOrder = "first" | "second";

export interface RhythmPattern {
  pulses: number[];
}

export interface RhythmTransition {
  from: number[];
  to: number;
  weight: number;
}

export interface ChannelTransition {
  from: number[];
  to: number;
  weight: number;
}

export interface ChannelFallbackWeight {
  channel: number;
  weight: number;
}

export interface ChannelEntryWeight {
  channels: number[];
  weight: number;
}

export type ChannelAccentRoutingMode = "renderOnly" | "driveChain";

export interface ChannelAccentWeight {
  channel: number;
  weight: number;
}

export interface ChannelAccentRule {
  minVelocity: number;
  maxVelocity: number;
  probability: number;
  mode: ChannelAccentRoutingMode;
  weights: ChannelAccentWeight[];
}

export interface ChannelPositionActionWeights {
  normalMarkov: number;
  renderOnly: number;
  resetMarkov: number;
}

export interface ChannelPositionResetSpec {
  mode: ChannelPositionResetMode;
  weights: ChannelAccentWeight[];
}

export interface ChannelPositionRule {
  id: string;
  label: string;
  enabled: boolean;
  scope: ChannelPositionScope;
  nth: number;
  actionWeights: ChannelPositionActionWeights;
  renderWeights: ChannelAccentWeight[];
  reset: ChannelPositionResetSpec;
}

export type ChannelHocketRatchetMode =
  | "sourceChannel"
  | "wholeRatchet"
  | "perRatchetHit";
export type ChannelHocketOrnamentMode =
  | "sourceChannel"
  | "wholeOrnament"
  | "perGraceNote";

export interface ChannelHocketRatchetSpec {
  mode: ChannelHocketRatchetMode;
  wholeProbability: number;
  perHitProbability: number;
  preserveFirstHit: boolean;
}

export interface ChannelHocketOrnamentSpec {
  mode: ChannelHocketOrnamentMode;
  wholeProbability: number;
  perGraceProbability: number;
}

export type ChannelAssignMode = "markov" | "euclid";

export type EuclidPlacement = "partition" | "stack";

export type EuclidResetScope = "cycle" | "section" | "beat" | "accentSpan";

export type EuclidSpanAccentMode = "woven" | "bypass";

export interface EuclidChannelLayer {
  channel: number;
  pulses: number;
  rotation: number;
  maxRun: number;
  steps: number;
  invert: boolean;
}

export interface EuclidChannelSpec {
  placement: EuclidPlacement;
  steps: number;
  layers: EuclidChannelLayer[];
  reset: EuclidResetScope;
  spanAccentMode: EuclidSpanAccentMode;
  spanAccentChannel: number | null;
}

export interface ChannelHocketSpec {
  order: MarkovOrder;
  channels: number[];
  transitions: ChannelTransition[];
  fallback: number;
  fallbackWeights: ChannelFallbackWeight[];
  entryWeights: ChannelEntryWeight[];
  seedMode: RhythmSeedMode;
  globalSeed: number;
  accentRules: ChannelAccentRule[];
  positionRules: ChannelPositionRule[];
  assignMode: ChannelAssignMode;
  euclid: EuclidChannelSpec | null;
}

export interface PitchState {
  pitch: number;
  label: string;
}

/** A first-class scale/collection: relative-collection motion walks this
 * lattice and absolute/chromatic moves snap to it. A chromatic collection
 * (degrees 0..12, period 12) reproduces legacy "flat MIDI anchor" behavior. */
export interface PitchCollection {
  tonicPc: number;
  degreesSemitones: number[];
  periodSemitones: number;
}

export type PitchTargetKind =
  | { type: "absolute"; pitch: number }
  | { type: "relativeChromatic"; steps: number }
  | { type: "relativeCollection"; steps: number };

export interface PitchTarget {
  label: string;
  kind: PitchTargetKind;
}

export interface PitchTransition {
  from: number[];
  to: number;
  weight: number;
}

export interface PitchFallbackWeight {
  state: number;
  weight: number;
}

export interface PitchEntryWeight {
  states: number[];
  weight: number;
}

export type PitchBoundaryPolicy = "wrap" | "clamp" | "reflect" | "fallback" | "nearest";

export interface PitchBoundary {
  low: number;
  high: number;
  modulo: number;
  policy: PitchBoundaryPolicy;
}

export interface WeightedPitchInterval {
  semitones: number;
  weight: number;
}

export interface WeightedMidiPitch {
  pitch: number;
  weight: number;
}

export type PitchTranspositionMode = "singleNote" | "stairStep";

export interface PitchTranspositionRule {
  enabled: boolean;
  probability: number;
  intervals: WeightedPitchInterval[];
  mode: PitchTranspositionMode;
  boundary: PitchBoundary;
  driveChain: boolean;
}

export type PitchRatchetMode = "sourcePitch" | "wholeRatchet" | "perRatchetHit";
export type PitchOrnamentMode = "sourcePitch" | "wholeOrnament" | "perGraceNote";
export type GracePitchScope = "wholeCluster" | "perGraceNote";

export interface GracePitchInjectionSpec {
  enabled: boolean;
  probability: number;
  scope: GracePitchScope;
  pitches: WeightedMidiPitch[];
}

export interface GraceTransposeDirectionWeights {
  up: number;
  down: number;
}

export interface GraceTransposeInjectionSpec {
  enabled: boolean;
  probability: number;
  scope: GracePitchScope;
  directionWeights: GraceTransposeDirectionWeights;
  intervals: WeightedPitchInterval[];
  boundary: PitchBoundary;
}

export interface PitchRatchetSpec {
  mode: PitchRatchetMode;
  wholeProbability: number;
  perHitProbability: number;
  preserveFirstHit: boolean;
}

export interface PitchOrnamentSpec {
  mode: PitchOrnamentMode;
  wholeProbability: number;
  perGraceProbability: number;
  gracePitch: GracePitchInjectionSpec;
  graceTranspose: GraceTransposeInjectionSpec;
}

export interface PitchShaperSpec {
  order: MarkovOrder;
  collection: PitchCollection;
  states: PitchState[];
  targets: PitchTarget[];
  transitions: PitchTransition[];
  fallback: number;
  fallbackWeights: PitchFallbackWeight[];
  entryWeights: PitchEntryWeight[];
  seedMode: RhythmSeedMode;
  globalSeed: number;
  transitionBoundary: PitchBoundary;
  ratchet: PitchRatchetSpec;
  ornament: PitchOrnamentSpec;
  transpositionRules: PitchTranspositionRule[];
}

export type SynthChannelMode = "melodic" | "percussion";

export interface SynthChannelProgram {
  channel: number;
  mode: SynthChannelMode;
  program: number;
  drumNote: number;
}

export interface RhythmFallbackWeight {
  state: number;
  weight: number;
}

export interface RhythmEntryWeight {
  states: number[];
  weight: number;
}

export type RhythmCellIntent = "play" | "rest" | "tie";

export type RhythmAccentConflict =
  | "tieAllowedOverAccent"
  | "tieBrokenAtAccent"
  | "restAllowedOnAccent"
  | "restBrokenByAccent";

export interface RhythmCellArticulation {
  spanLen: number;
  state: number;
  cell: number;
  restProbability: number;
  tieProbability: number;
}

export type RhythmArticulationRole = "single" | "first" | "middle" | "last";

export type RhythmArticulationBlendMode =
  | "manualOverrides"
  | "average"
  | "weighted";

export interface RhythmArticulationProbability {
  enabled: boolean;
  restProbability: number;
  tieProbability: number;
}

export interface RhythmPositionArticulationDefaults {
  single: RhythmArticulationProbability;
  first: RhythmArticulationProbability;
  middle: RhythmArticulationProbability;
  last: RhythmArticulationProbability;
}

export interface RhythmArticulationBlend {
  mode: RhythmArticulationBlendMode;
  manualWeight: number;
  fragmentWeight: number;
  sectionWeight: number;
  cycleWeight: number;
}

export interface RhythmArticulationNeighborRule {
  previous: RhythmCellIntent;
  next: RhythmCellIntent;
  multiplier: number;
}

export interface RhythmArticulationSpec {
  cells: RhythmCellArticulation[];
  tieOverAccentProbability: number;
  restOverAccentProbability: number;
  blend: RhythmArticulationBlend;
  fragmentPosition: RhythmPositionArticulationDefaults;
  sectionPosition: RhythmPositionArticulationDefaults;
  cyclePosition: RhythmPositionArticulationDefaults;
  neighborRules: RhythmArticulationNeighborRule[];
}

export interface RhythmArticulationSeedPolicy {
  seed: number;
  followRhythmChance: number;
}

export type RhythmArticulationSeedSource =
  | "followRhythm"
  | "independentPerCycle";

export interface RhythmArticulationSeedResolution {
  seed: U64SeedDecimal;
  source: RhythmArticulationSeedSource;
}

export interface RhythmChainSpec {
  spanLen: number;
  order: MarkovOrder;
  states: RhythmPattern[];
  transitions: RhythmTransition[];
  fallback: number;
  fallbackWeights: RhythmFallbackWeight[];
  entryWeights: RhythmEntryWeight[];
}

export interface WeightedSubdivisionTarget {
  spanLen: number;
  weight: number;
}

export interface WeightedClumpLength {
  count: number;
  weight: number;
}

export type ArbitrarySubdivisionPatternSource = "markov" | "weightedPool";

export interface WeightedArbitrarySubdivisionCell {
  spanLen: number;
  pattern: RhythmPattern;
  weight: number;
}

export type RhythmSpeedContextKind = "gati" | "jathi";

export interface RhythmSpeedMultiplier {
  numerator: number;
  denominator: number;
}

export interface WeightedRhythmSpeedChoice {
  contextKind: RhythmSpeedContextKind;
  contextValue: number;
  multiplier: RhythmSpeedMultiplier;
  weight: number;
}

export interface RhythmSpeedSpanContext {
  spanId: number;
  sectionIndex: number;
  contextKind: RhythmSpeedContextKind;
  contextValue: number;
}

export interface RhythmSpeedSpec {
  choices: WeightedRhythmSpeedChoice[];
  contexts: RhythmSpeedSpanContext[];
}

export interface ArbitrarySubdivisionSpec {
  probability: number;
  targets: WeightedSubdivisionTarget[];
  clumpLengths: WeightedClumpLength[];
  allowTrivialPattern: boolean;
  patternSource: ArbitrarySubdivisionPatternSource;
  poolWeights: WeightedArbitrarySubdivisionCell[];
}

export type RatchetCurve =
  | "even"
  | "accelerando"
  | "retardando"
  | "accelerandoRetardando"
  | "retardandoAccelerando";
export type RatchetTemporalEasingShape =
  | "humanize"
  | "humanizeTight"
  | "humanizeLoose"
  | "subtleAccelerando"
  | "subtleRetardando"
  | "sway"
  | "lilt";
export type RatchetModifierOperation = "multiply" | "add";
export type RatchetSpeedStrategy = "audibleRate" | "pulsesPerMatra" | "beatRate";
export type RatchetSpeedDistribution =
  | "uniform"
  | "towardMedian"
  | "awayFromMedian"
  | "favorSlow"
  | "favorFast";
export type RatchetDurationBasis = "matras" | "percentOfBeat";
export type RatchetCooldownBasis = "matras" | "milliseconds" | "beats" | "percentOfBeat";
export type RatchetVelocityMode = "relative" | "absolute";

export interface RatchetDurationModifier {
  enabled: boolean;
  threshold: number;
  basis: RatchetDurationBasis;
  multiplier: number;
  operation: RatchetModifierOperation;
}

export interface RatchetPositionModifierPoint {
  position: number;
  probability: number;
  speed: number;
}

export interface RatchetPositionModifierSpec {
  enabled: boolean;
  points: RatchetPositionModifierPoint[];
}

export interface RatchetProbabilityModifierOperations {
  accentSpanStart: RatchetModifierOperation;
  accentSpanEnd: RatchetModifierOperation;
  sectionStart: RatchetModifierOperation;
  sectionEnd: RatchetModifierOperation;
  cycleStart: RatchetModifierOperation;
  cycleEnd: RatchetModifierOperation;
}

export interface RatchetProbabilityModifiers {
  slowNote: RatchetDurationModifier;
  fastNote: RatchetDurationModifier;
  position: RatchetPositionModifierSpec;
  accentSpanStart: number;
  accentSpanEnd: number;
  sectionStart: number;
  sectionEnd: number;
  cycleStart: number;
  cycleEnd: number;
  operations: RatchetProbabilityModifierOperations;
}

export interface RatchetSpeedRange {
  strategy: RatchetSpeedStrategy;
  min: number;
  max: number;
  distribution: RatchetSpeedDistribution;
}

export interface RatchetCurveWeights {
  even: number;
  accelerando: number;
  retardando: number;
  accelerandoRetardando: number;
  retardandoAccelerando: number;
}

export interface RatchetTemporalEasingWeights {
  humanize: number;
  humanizeTight: number;
  humanizeLoose: number;
  subtleAccelerando: number;
  subtleRetardando: number;
  sway: number;
  lilt: number;
}

export interface RatchetTimeCurvePoint {
  x: number;
  y: number;
}

export interface RatchetTimeCurveChoice {
  id: string;
  weight: number;
  points: RatchetTimeCurvePoint[];
}

export interface RatchetTimeCurveSpec {
  enabled: boolean;
  points: RatchetTimeCurvePoint[];
  variance: number;
  interpolate: boolean;
  interpolationMin: number;
  interpolationMax: number;
  choices: RatchetTimeCurveChoice[];
}

export interface CycleTempoFluxSpec {
  enabled: boolean;
  minBpm: number;
  maxBpm: number;
  seed: number;
  curve: RatchetTimeCurveSpec;
}

export interface RatchetVelocitySpec {
  enabled: boolean;
  mode: RatchetVelocityMode;
  min: number;
  max: number;
  center: number;
  attraction: number;
  sameProbability: number;
  /** V2 dynamic gesture: moving attractor center across the burst (-1..1 of
   * the window half-range at start/mid/end). Null = flat. */
  contour?: RatchetVelocityContour | null;
}

export interface RatchetVelocityContour {
  start: number;
  mid: number;
  end: number;
}

export interface RatchetSpanGateLimit {
  subdivision: number;
  maxSpanMatras: number;
}

export interface RatchetInternalRhythmSpec {
  enabled: boolean;
  minCount: number;
  maxCount: number;
  chains: RhythmChainSpec[];
  articulation: RhythmArticulationSpec | null;
}

export interface RatchetPlaybackSpec {
  seed: number;
  probability: number;
  modifiers: RatchetProbabilityModifiers;
  speed: RatchetSpeedRange;
  curve: RatchetCurve;
  curveWeights: RatchetCurveWeights;
  cooldownMatras: number;
  cooldownBasis: RatchetCooldownBasis;
  temporalEasing: number;
  temporalEasingShape: RatchetTemporalEasingShape;
  temporalEasingProbability: number;
  temporalEasingWeights: RatchetTemporalEasingWeights;
  timeCurve: RatchetTimeCurveSpec | null;
  velocity: RatchetVelocitySpec;
  allowMultiMatra: boolean;
  maxSpanMatras: number;
  maxSpanMatrasBySubdivision: RatchetSpanGateLimit[];
  internalRhythm: RatchetInternalRhythmSpec;
  /** V2 tempo-elastic band. Absent/null keeps legacy `speed` semantics. */
  band?: RatchetBandSpec | null;
  /** V2 burst+hold fill; only honored alongside `band`. */
  fill?: RatchetFillSpec | null;
  /** V2 placement weights; replaces the legacy modifier stack when present. */
  placement?: RatchetPlacementSpec | null;
}

export type RatchetFillMode = "full" | "lead" | "trail";

export interface RatchetFillSpec {
  mode: RatchetFillMode;
  /** Burst share of the span for lead/trail (0.2..1). */
  fraction: number;
}

/** Edges in hits/sec at the 120 BPM reference; playback scales them by the
 * effective local beat via `tracking` (0 fixed-ms .. 1 metric) with soft
 * saturation and absolute 18-200 ms rails. */
export interface RatchetBandSpec {
  rateSlowRef: number;
  rateFastRef: number;
  tracking: number;
  /** -1 slow .. +1 fast draw tilt. */
  bias: number;
  /** -1 gathers draws toward the band middle, +1 pushes to the edges. */
  spread: number;
  /** Snap counts to whole hits per local pulse. */
  sync: boolean;
}

export interface RatchetLengthWindow {
  minPulses: number;
  maxPulses: number;
}

export interface RatchetSpanPositionWeights {
  start: number;
  mid: number;
  end: number;
}

export interface RatchetPlacementSpec {
  /** -1 favors the cycle's shortest candidates, +1 the longest. */
  lengthBias: number;
  lengthWindow?: RatchetLengthWindow | null;
  /** Weight per accent-span index (0..2), tiled; empty = flat; max 16. */
  phraseWeights: number[];
  spanPosition: RatchetSpanPositionWeights;
  /** Exact-boundary emphasis (legacy boundary-modifier capability). */
  edgeWeights: RatchetEdgeWeights;
  /** Mean-1 normalization so amount stays a density. */
  normalize: boolean;
}

export interface RatchetEdgeWeights {
  accentStart: number;
  accentEnd: number;
  sectionStart: number;
  sectionEnd: number;
  cycleStart: number;
  cycleEnd: number;
}

export type GraceNoteDurationBasis = "milliseconds" | "percentOfBeat";
export type DelayQuantizationMode = "unquantized" | "quantized";
export type DelayTimeDistribution = "uniform" | "early" | "late" | "center" | "edges";

export interface GraceNoteCountWeights {
  single: number;
  double: number;
  triple: number;
}

export interface GraceNoteSpec {
  enabled: boolean;
  placement: GraceNotePlacement;
  placementWeights: GraceNotePlacementWeights;
  countWeights: GraceNoteCountWeights;
  probability: number;
  modifiers: RatchetProbabilityModifiers;
  cooldown: number;
  cooldownBasis: RatchetCooldownBasis;
  duration: number;
  durationBasis: GraceNoteDurationBasis;
  velocity: RatchetVelocitySpec;
  allowRests: boolean;
}

export interface DelayTupletWeight {
  tuplet: number;
  weight: number;
}

export interface DelayOrnamentSpec {
  enabled: boolean;
  probability: number;
  modifiers: RatchetProbabilityModifiers;
  min: number;
  max: number;
  basis: RatchetCooldownBasis;
  quantization: DelayQuantizationMode;
  distribution: DelayTimeDistribution;
  tuplets: DelayTupletWeight[];
}

export interface OrnamentPlaybackSpec {
  seed: number;
  grace: GraceNoteSpec;
  delay: DelayOrnamentSpec;
}

export interface RhythmSpanInput {
  spanId: number;
  spanLen: number;
  label: string | null;
  chainContext: number | null;
  protectedCuts: number[];
  /** Section-local matra offset; required for beat-lock geometry. */
  startMatra?: number | null;
  /** Span width in the section-local beat-ownership grid. Usually spanLen;
   * differs for a speed-multiplied jathi's virtual rhythm grid. */
  sectionMatraLen?: number | null;
  /** JB-H NotesPerCell phrasing echoed from the pulse span: voice this span
   * as exactly N evenly-spaced onsets. null/absent ⇒ Accent phrasing (the
   * normal chain/Markov resolution stands). */
  notesPerCell?: number | null;
}

export interface LockCellArticulation {
  restProbabilityPercent: number;
  tieProbabilityPercent: number;
}

// --- Shape Groups (select structure, then transform it) ---

export type ShapeDomain = "beat" | "rhythmCell" | "noteGroup";
export type ShapeStage = "articulation" | "playbackFinalize";
export type ShapeCellState = "play" | "rest" | "tie";

export type ShapeSelection =
  | { kind: "all" }
  | { kind: "beats"; beats: number[] }
  | { kind: "beatRange"; startBeat: number; endBeat: number }
  | { kind: "everyNth"; n: number; offset: number }
  | { kind: "everyNthMatra"; n: number; offset: number }
  /** Every Nth ONSET (note start — spanning notes count once, tie
   * continuations never). countRests numbers rests alongside note starts so
   * they can be selected too. rhythmCell/noteGroup domains only. */
  | { kind: "everyNthOnset"; n: number; offset: number; countRests: boolean }
  | { kind: "firstBeat" }
  | { kind: "lastBeat" }
  | { kind: "sectionStarts" }
  | { kind: "gatiEquals"; gati: number }
  | {
      kind: "euclidean";
      pulses: number;
      steps: number;
      rotate: number;
      invert: boolean;
    }
  | { kind: "cellIndexInSpan"; index: number }
  | { kind: "cellLenEquals"; len: number }
  | { kind: "cellState"; state: ShapeCellState }
  | { kind: "not"; expr: ShapeSelection }
  | { kind: "and"; exprs: ShapeSelection[] }
  | { kind: "or"; exprs: ShapeSelection[] };

export type ShapeOperation =
  | { kind: "restProbability"; percent: number }
  | { kind: "tieProbability"; percent: number }
  | { kind: "forcePlay" }
  | { kind: "scaleVelocity"; percent: number }
  | { kind: "setVelocity"; velocity: number }
  | { kind: "transposePitch"; semitones: number }
  /** Force a ratchet on selected onsets — settings come from the ratchet
   * panel; `respectCooldown` = obey + reset the panel cooldown vs bypass it. */
  | { kind: "triggerRatchet"; respectCooldown: boolean }
  /** Force a grace ornament on selected onsets (ornament panel must be on). */
  | { kind: "triggerOrnament"; respectCooldown: boolean }
  /* ER-101/102 pitch math family. These apply to the FINAL pitch: leaf
   * pitches directly when the pitch shaper is off, or the shaper's rendered
   * output when it is on. */
  /** Zero-centered jitter: uniform ± range semitones per selected onset. */
  | { kind: "randomizePitch"; rangeSemitones: number }
  /** Random walk across selected onsets (± step per onset, resets each cycle). */
  | { kind: "randomWalkPitch"; stepSemitones: number }
  /** Transpose per CYCLE; wrap > 0 folds the offset (7/12 = circle of fifths). */
  | { kind: "accumulatePitch"; semitonesPerCycle: number; wrapSemitones: number }
  /** Mirror pitch around a center: p' = 2·center − p. */
  | { kind: "invertPitch"; centerPitch: number }
  /** Stretch/compress intervals around a center by percent. */
  | { kind: "stretchIntervals"; percent: number; centerPitch: number }
  /** Snap to the pitch panel's collection (chromatic default = no-op). */
  | { kind: "quantizePitchToCollection" };

export interface ShapeGroupSpec {
  id: string;
  name: string;
  enabled: boolean;
  domain: ShapeDomain;
  stage: ShapeStage;
  selection: ShapeSelection;
  /** The group's final gate: each selected unit fires with this probability
   * (100 = always). One draw per unit, shared by all operations. */
  chancePercent: number;
  operations: ShapeOperation[];
}

export interface ShapeGroupSet {
  groups: ShapeGroupSpec[];
  seed: number;
}

export interface WeightedLockPattern {
  pattern: RhythmPattern;
  weight: number;
  /** Per-cell rest/tie overrides aligned with pattern.pulses; a positive entry
   * overrides the lock-level percents for that onset. */
  cellArticulations: LockCellArticulation[];
}

export interface BeatLock {
  id: string;
  enabled: boolean;
  startBeat: number;
  endBeat: number;
  patterns: WeightedLockPattern[];
  unlockedWeight: number;
  allowTieIn: boolean;
  allowTieOut: boolean;
  allowArticulation: boolean;
  /** Lock-local stochastic rests & ties on locked onset cells (0..100). */
  restProbabilityPercent: number;
  tieProbabilityPercent: number;
}

export interface BeatLockSpec {
  locks: BeatLock[];
  seed: number;
}

/** Per-cycle-beat geometry for beat-addressed overlays (from resolved GatiBeat spans). */
export interface LockBeatGeometry {
  beat: number;
  sectionIndex: number;
  startMatra: number;
  /** Selector gati: authored identity on standard frames; effective integer
   * beat subdivision on exact custom-section geometry. */
  gati: number;
  /** Actual resolved-grid width of the beat; absent means gati. */
  matraLen?: number | null;
}

export type RhythmSeedSource =
  | "followGlobal"
  | "locked"
  | "perCycle"
  | "history"
  | "drift"
  | "morph"
  | "new";

export type RhythmSeedMode =
  | { type: "followGlobal" }
  | { type: "locked"; seed: number }
  | { type: "perCycle"; seed: number }
  | {
      type: "history";
      seed: number;
      history: U64SeedDecimal[];
      historyWeight: number;
      newSeedWeight: number;
      maxHistory: number;
    }
  | { type: "drift"; seed: number; newSeedChance: number }
  | {
      type: "morph";
      seed: number;
      holdChance: number;
      newSeedChance: number;
      blendCycles: number;
    };

export type GeneratorSeedSource = "locked" | "perCycle" | "history" | "new";

export type GeneratorSeedMode =
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

export interface ExampleGeneratorParams {
  densityPercent: number;
  seedMode: GeneratorSeedMode;
}

export type DirectiveFamily =
  | "barlowRemove"
  | "barlowAdd"
  | "rotate"
  | "syncopate"
  | "desyncopate"
  | "fragment"
  | "consolidate"
  | "euclid"
  | "stochastic";

export type DirectiveRotateDirection = "earlier" | "later";
export type DirectiveEuclidRestPolicy = "silent" | "tied";
export type DirectivePacing = "perCycle" | "linear" | "easeInOut";

/** Optional calibration for one directive's incremental change on each active
 * cycle. Multiple active directives compose, so the final whole-cycle change
 * can exceed any individual row's target. Absence is the legacy
 * operation-quota path and must remain wire-identical. */
export type DirectiveMagnitude =
  | { mode: "operationQuota" }
  | {
      mode: "perceptual";
      /** Pins the perceptual feature model used to interpret this score. */
      modelVersion: "v1";
      /** Perceptual distance score in thousandths, from 0 through 100_000. */
      targetMilli: number;
      /** Accepted distance error in thousandths, from 0 through 100_000. */
      toleranceMilli: number;
      /** Search cap, not a requested operation count. */
      maxOperations: number;
    };

export interface DirectiveBeatRange {
  /** Zero-based beat offset in the unrotated metric frame. */
  startBeat: number;
  lenBeats: number;
}

export interface DirectiveOptions {
  barlowTemperature: number | null;
  fillComplexity: number | null;
  /** Paired per-directive density corridor override. Both are null or set. */
  densityFloor: number | null;
  densityCeiling: number | null;
  euclidMaxRun: number | null;
  euclidInvert: number | null;
  euclidRestPolicy: DirectiveEuclidRestPolicy | null;
  rotateDirection: DirectiveRotateDirection;
}

/** One authored event in the deterministic Dum-Ka evolution score. */
export interface EvolutionDirective {
  id: number;
  order: number;
  enabled: boolean;
  fromCycle: number;
  toCycle: number;
  family: DirectiveFamily;
  /** Operation quota; retained but ignored when magnitude is perceptual. */
  intensity: number;
  /** Operation-quota range pacing. Perceptual rows require perCycle. */
  pacing: DirectivePacing;
  /** Missing means operation quota for legacy patch/request compatibility. */
  magnitude?: DirectiveMagnitude;
  scope: DirectiveBeatRange | null;
  options: DirectiveOptions;
}

export interface DumkaGeneratorParams {
  /** Dum-Ka seed-notation text, sent and persisted verbatim. */
  pattern: string;
  /** Percent chance per cycle that one evolution operator fires. */
  evolutionRate: number;
  /** Max add/remove drift from the seed, percent of its onset count. */
  driftLeash: number;
  /** Minimum onset density as a percent of structural grid slots. */
  densityFloor: number;
  /** Maximum onset density as a percent of structural grid slots. */
  densityCeiling: number;
  /** Barlow candidate-pool temperature: 0 strict rank order, 100 uniform. */
  barlowTemperature: number;
  /** Per-family operator weights; defaults 3/3/2/0/0 keep the historical
   * draw, the Sioros displacement pair is opt-in. */
  weightBarlowRemove: number;
  weightBarlowAdd: number;
  weightRotate: number;
  weightSyncopate: number;
  weightDesyncopate: number;
  /** The figure pair (fragmentation/consolidation), opt-in at 0. */
  weightFragment: number;
  weightConsolidate: number;
  /** Figure-size bias: 0 = simplest true tuplet, 100 = any legal size. */
  fillComplexity: number;
  /** Euclidean reshape family weight, opt-in at 0. */
  weightEuclid: number;
  /** Burst run cap 1-8: 1 = plain Bjorklund, higher clusters onsets. */
  euclidMaxRun: number;
  /** Percent chance a fired reshape complements its mask. */
  euclidInvert: number;
  /** Whether reshaped onsets sustain to the next onset or hit one slot. */
  euclidRestPolicy: "silent" | "tied";
  /** Authored deterministic evolution score. Empty preserves legacy replay. */
  plan: EvolutionDirective[];
  /** Editor canvas extent only. The engine does not use this value. */
  planLengthCycles: number;
  seedMode: GeneratorSeedMode;
}

export type GeneratorConfig =
  | ({ kind: "example" } & ExampleGeneratorParams)
  | ({ kind: "dumka" } & DumkaGeneratorParams);

export interface GeneratorSpanInput {
  spanId: number;
  spanLen: number;
  label: string | null;
  sectionIndex: number | null;
  subdivision: number | null;
}

export interface GeneratorSeedResolution {
  seed: U64SeedDecimal;
  source: GeneratorSeedSource;
  history: U64SeedDecimal[];
}

/** Authored per-matra velocities for one request span, keyed by span id.
 * Kept beside `spans` (not inside `GeneratorSpanInput`) so generator identity
 * never sees display metadata. */
export interface GeneratorSpanVelocities {
  spanId: number;
  velocities: number[];
}

export interface GeneratorPreviewRequest {
  spans: GeneratorSpanInput[];
  enabled: boolean;
  generator: GeneratorConfig;
  cycle: number;
  cycleBeats: number;
  automation?: AutomationSet | null;
  trackId?: string | null;
  /** Optional: legacy requests omit it and get cells without velocities. */
  spanVelocities?: GeneratorSpanVelocities[];
}

export interface GeneratorPreview {
  seed: GeneratorSeedResolution;
  spans: ResolvedRhythmSpan[];
  /** Dum-Ka directive observability; empty for cycle 0 and other generators. */
  trace: DirectiveTraceEntry[];
  /** Backend-owned cycle-effective density rail after automation and active
   * directive overrides. Absent for other generators and legacy responses. */
  densityCorridor?: DensityCorridorRange | null;
}

export interface DensityCorridorRange {
  floor: number;
  ceiling: number;
}

export type DirectiveSkip =
  | "none"
  | "orphanedScope"
  | "projection"
  | "exhausted";

export type DensityCorridorLimit = "floor" | "ceiling";

export interface DensityCorridorClamp {
  limit: DensityCorridorLimit;
  densityPercent: number;
}

export interface DirectiveTraceEntry {
  cycle: number;
  directiveId: number;
  family: DirectiveFamily;
  requested: number;
  applied: number;
  skipped: DirectiveSkip;
  /** Independent of skip: a corridor may clamp work before projection does. */
  corridorClamp?: DensityCorridorClamp | null;
  /** Backend-measured incremental change made by this directive on this cycle,
   * present for perceptual mode. This is not the final whole-cycle distance
   * when multiple rows are active. */
  perceptual?: DirectivePerceptualTrace | null;
}

export interface DirectivePerceptualTrace {
  modelVersion: "v1";
  actualMilli: number;
  targetMilli: number;
  toleranceMilli: number;
  reached: boolean;
  exhausted: boolean;
}

export interface ResolvedRhythmSpan {
  spanId: number;
  spanLen: number;
  cells: ResolvedRhythmCell[];
}

export interface ResolvedRhythmCell {
  index: number;
  start: number;
  len: number;
  rest: boolean;
  tiedFromPrevious: boolean;
  tiedToNext: boolean;
  /**
   * Authored-leaf velocity behind this cell (accents included), inherited the
   * same way transport realization inherits it. Absent on legacy payloads and
   * on spans the request carried no authored velocities for.
   */
  velocity?: number;
}

export interface RhythmSeedResolution {
  seed: U64SeedDecimal;
  source: RhythmSeedSource;
  history: U64SeedDecimal[];
}

export interface RhythmResolution {
  seed: RhythmSeedResolution;
  spans: ResolvedRhythmSpan[];
}

export interface RhythmPreviewRequest {
  spans: RhythmSpanInput[];
  chains: RhythmChainSpec[];
  seedMode: RhythmSeedMode;
  cycle: number;
  globalSeed: number;
  /** Authoritative score length; beat geometry may be intentionally sparse. */
  cycleBeats: number;
  arbitrarySubdivision: ArbitrarySubdivisionSpec | null;
  speedSubdivision: RhythmSpeedSpec | null;
  beatLocks?: BeatLockSpec | null;
  shapeGroups?: ShapeGroupSet | null;
  beats?: LockBeatGeometry[];
  articulation: RhythmArticulationSpec | null;
  articulationSeedPolicy: RhythmArticulationSeedPolicy;
}

export interface RhythmPreview {
  resolution: RhythmResolution;
  articulationSeedResolution: RhythmArticulationSeedResolution | null;
}

export type RhythmExtrapolationStrategy =
  | "boundaryProjection"
  | "densityPreserving"
  | "shapePreserving"
  | "hybridTransport"
  | "sparseNearest";

export type RhythmPassageStrategy =
  | "metricChunks"
  | "pulseWindows"
  | "matraWindows"
  | "hybridVocabulary";

export interface RhythmExtrapolateRequest {
  source: RhythmChainSpec;
  targetSpanLen: number;
  targetStates: RhythmPattern[];
  strategy: RhythmExtrapolationStrategy;
}

export interface RhythmExtrapolate {
  chain: RhythmChainSpec;
}

export interface RhythmImportPassageRequest {
  passage: number[];
  targetSpanLen: number;
  order: MarkovOrder;
  passageStrategy: RhythmPassageStrategy;
  fitStrategy: RhythmExtrapolationStrategy;
  maxStates: number;
}

export interface RhythmImportPassage {
  chain: RhythmChainSpec;
}

export interface PitchImportPassageRequest {
  /** MIDI pitches of the passage notes, in order. */
  passage: number[];
  collection: PitchCollection;
  registerLow: number;
  registerHigh: number;
  order: MarkovOrder;
  maxStates: number;
}

/** A learned pitch chain materialized as ordinary editable pitch-shaper state.
 * `transitions[].to` is a destination state index (absolute targets, one per
 * state, precede relative targets in the matrix). */
export interface PitchPassageImport {
  order: MarkovOrder;
  states: PitchState[];
  transitions: PitchTransition[];
  entryWeights: PitchEntryWeight[];
  fallback: number;
}

export interface PitchImportPassage {
  import: PitchPassageImport;
}

export interface RhythmPlaybackRequest {
  enabled: boolean;
  chains: RhythmChainSpec[];
  seedMode: RhythmSeedMode;
  globalSeed: number;
  midiOutputChannel: number;
  automation: AutomationSet | null;
  arbitrarySubdivisionEnabled: boolean;
  arbitrarySubdivision: ArbitrarySubdivisionSpec | null;
  speedSubdivision: RhythmSpeedSpec | null;
  beatLocksEnabled: boolean;
  beatLocks: BeatLockSpec | null;
  shapeGroupsEnabled: boolean;
  shapeGroups: ShapeGroupSet | null;
  articulation: RhythmArticulationSpec | null;
  articulationSeedPolicy: RhythmArticulationSeedPolicy;
  ratchetEnabled: boolean;
  ratchet: RatchetPlaybackSpec | null;
  ornamentEnabled: boolean;
  delayEnabled: boolean;
  ornament: OrnamentPlaybackSpec | null;
  pitchShaperEnabled: boolean;
  pitchShaper: PitchShaperSpec | null;
  channelHocketEnabled: boolean;
  channelHocket: ChannelHocketSpec | null;
  cycleTempoFluxEnabled: boolean;
  cycleTempoFlux: CycleTempoFluxSpec | null;
  seedPath: SeedPathPlaybackConfig | null;
}

export interface TrackPlaybackRequest {
  generatorEnabled: boolean;
  generator: GeneratorConfig;
  midiOutputChannel: number;
  automation: AutomationSet | null;
  channelHocketEnabled: boolean;
  channelHocket: ChannelHocketSpec | null;
  seedPath: SeedPathPlaybackConfig | null;
}

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

export interface ParallelPlaybackScoreRequest {
  name: string;
  cycleBeats: number;
  initialWeights: SubdivisionWeight[];
  initialJathiWeights: JathiWeight[];
  initialJathiBhedam?: JathiBhedamSelection | null;
  initialCustomSubdivision?: CustomSubdivision | null;
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

/**
 * Triggered Tracks config (mirrors `cseq_trigger::TriggerConfig`). The Rust
 * enums use `#[serde(tag = "type", rename_all = "camelCase")]` (except
 * `reTrigger`, a plain string enum), so these tagged unions match the wire
 * shape exactly. v1 conditions observe pure resolved structure only.
 */
export type TriggerCondition =
  | { type: "beatIsRest"; beat: number }
  | { type: "beatIsSounding"; beat: number }
  | { type: "sectionStartAtBeat"; beat: number }
  | { type: "gatiIs"; beat: number; gati: number }
  | { type: "jathiPulseAtBeat"; beat: number };

/**
 * Phase B multi-condition WHEN (mirrors `cseq_trigger::WhenSpec` and its tree).
 * `when` supersedes the single legacy `condition`; the backend upcasts any
 * legacy `condition` into a one-leaf `when` and normalizes. Predicates observe
 * pure resolved structure only — same v1 capability set, now composable.
 */
export type TriggerCountOp =
  | "atLeast"
  | "atMost"
  | "exactly"
  | "moreThan"
  | "lessThan";

export type TriggerWhenPredicate =
  | { type: "isRest" }
  | { type: "isSounding" }
  | { type: "isSectionStart" }
  | { type: "hasJathiPulse" }
  | { type: "gatiIs"; gati: number }
  | { type: "matraIsRest"; matra: number }
  | { type: "matraIsSounding"; matra: number }
  | { type: "restCountInCycle"; op: TriggerCountOp; count: number }
  | { type: "soundingCountInCycle"; op: TriggerCountOp; count: number };

/** A boolean tree over predicates (mirrors `cseq_trigger::ConditionNode`). */
export type TriggerConditionNode =
  | { type: "all"; nodes: TriggerConditionNode[] }
  | { type: "any"; nodes: TriggerConditionNode[] }
  | { type: "not"; node: TriggerConditionNode }
  | { type: "leaf"; predicate: TriggerWhenPredicate };

/** Which source beat(s) the tree is evaluated against. */
export type TriggerBeatSelector =
  | { type: "at"; beat: number }
  | { type: "anyBeat" };

export interface TriggerWhenSpec {
  /** Defaults to `{ type: "at", beat: 0 }` when omitted on the wire. */
  beats: TriggerBeatSelector;
  tree: TriggerConditionNode;
}

export type TriggerLaunchAlignment =
  | { type: "atEvent" }
  | { type: "atSourceCycleStart" }
  | { type: "atNextReferenceBeat" }
  | { type: "afterEventTicks"; ticks: number }
  // Phase D resolved-context placements.
  | { type: "centerInRest" }
  | { type: "atSourceReturn" };

export type TriggerLifetime =
  | { type: "onePass" }
  | { type: "repeats"; passes: number };

export type TriggerReTrigger = "restart" | "ignore" | "queue";

export type TriggerLength =
  | { type: "scoreCycle" }
  | { type: "fixedBeats"; beats: number };

/** Grid a launch tick snaps to, applied after alignment (mirrors `QuantizeGrid`). */
export type TriggerQuantizeGrid =
  | { type: "referenceBeatFraction"; divisions: number }
  | { type: "referenceBeatMultiple"; beats: number }
  | { type: "sourceGatiMatra" };

export type TriggerQuantizeDirection = "next" | "nearest" | "previous";

export interface TriggerLaunchQuantize {
  grid: TriggerQuantizeGrid;
  direction: TriggerQuantizeDirection;
}

/**
 * The GATE (Phase C, mirrors `cseq_trigger::GateSpec`): a stateful +
 * probabilistic acceptance gate applied to a WHEN candidate before the
 * re-trigger policy. Absent ⇒ always accept. Probabilities are integer per-mille
 * (`0..=1000`) so the roll is exact and RNG-stable.
 */
export interface TriggerGateSpec {
  /** Base accept probability in per-mille, 0..=1000 (1000 = always). */
  probabilityPerMille: number;
  /** Minimum source cycles between accepts; 0 = no cooldown. */
  cooldownCycles: number;
  /** Added to the threshold per consecutive miss, per-mille (capped at 1000). */
  missBoostPerMille: number;
  /** Seed for the identity-seeded probability rolls. */
  seed: number;
}

/** One weighted START placement option (Phase D, mirrors `WeightedStart`). */
export interface TriggerWeightedStart {
  alignment: TriggerLaunchAlignment;
  /** Relative weight; 0 ⇒ never chosen (unless every option is 0). */
  weight: number;
}

/**
 * A weighted, seeded START choice (Phase D, mirrors `StartSelect`): per
 * candidate, one option is chosen by an identity-seeded roll. When present and
 * non-empty it supersedes `launchAlignment`. Reproducible like the GATE.
 */
export interface TriggerStartSelect {
  options: TriggerWeightedStart[];
  seed: number;
}

export interface TriggerConfig {
  sourceTrackId: string;
  /**
   * Canonical Phase-B multi-condition WHEN. The normalized config the backend
   * returns always carries `when` and omits `condition`. Both are optional on
   * the wire (`skip_serializing_if`), so readers must tolerate either.
   */
  when?: TriggerWhenSpec | null;
  /** Legacy single condition; upcast into `when` by the backend. */
  condition?: TriggerCondition | null;
  launchAlignment: TriggerLaunchAlignment;
  /** Optional snap of the aligned launch tick to a musical grid. */
  launchQuantize?: TriggerLaunchQuantize | null;
  lifetime: TriggerLifetime;
  reTrigger: TriggerReTrigger;
  length: TriggerLength;
  maxRepeats: number;
  /** Optional GATE (Phase C). Absent/null ⇒ always accept. */
  gate?: TriggerGateSpec | null;
  /** Optional weighted/seeded START choice (Phase D). Absent/null ⇒ the single
   * `launchAlignment` is used. */
  startSelect?: TriggerStartSelect | null;
}

export interface ParallelPlaybackTrackRequest {
  id: string;
  name: string;
  score: ParallelPlaybackScoreRequest;
  playback: TrackPlaybackRequest;
  tempoBpm: number;
  /** Absent/null ⇒ continuous. The backend normalizes the trigger graph. */
  trigger?: TriggerConfig | null;
  /**
   * Silent source: realize for structure (to drive a follower) but emit no
   * audible MIDI. Set for a muted track that an audible track triggers on, so
   * muting a source still drives its followers. Default false.
   */
  silent?: boolean;
}

/** One transition in a Track Flow chain, over member source-track indices. */
export interface TrackFlowTransition {
  from: number[];
  to: number;
  weight: number;
}

export interface TrackFlowFallbackWeight {
  state: number;
  weight: number;
}

export interface TrackFlowEntryWeight {
  states: number[];
  weight: number;
}

/**
 * A Track Flow box's Markov chain, **indexed** by the box's audible-member
 * position (`0..stateCount-1` in `sources` order). The frontend authors the
 * chain keyed by member track id and converts to this indexed form (restricted
 * to the audible members) at request-build time. Absent ⇒ the backend builds a
 * uniform first-order chain over the sources.
 */
export interface TrackFlowSpec {
  order: MarkovOrder;
  stateCount: number;
  transitions: TrackFlowTransition[];
  fallback: number;
  fallbackWeights: TrackFlowFallbackWeight[];
  entryWeights: TrackFlowEntryWeight[];
}

/**
 * One Track Flow box: a synthetic sequential lane (`track-flow-<id>`) that
 * Markov-chooses among its member source tracks, one per cycle. Carries the
 * **audible** ordered members only (muted/solo-hidden members are pruned and the
 * chain is restricted to the audible set before sending).
 */
export interface TrackFlowBoxRequest {
  id: string;
  name: string;
  sources: ParallelPlaybackTrackRequest[];
  spec?: TrackFlowSpec | null;
  seed: number;
}

export interface ParallelPlaybackRequest {
  tracks: ParallelPlaybackTrackRequest[];
  referenceTempoBpm: number;
  referenceCycleBeats: number;
  channelConflictPolicy: ChannelConflictPolicy;
  channelLogicMatrix: ChannelLogicMatrixEntry[];
  conflictPriority: string[];
  /** Empty ⇒ pure parallel playback (no Track Flow boxes). */
  trackFlowBoxes: TrackFlowBoxRequest[];
}

// Deliberately strict: Dum-Ka documents use only Dum-Ka extensions so the
// pickers never offer (and saves never overwrite) Caesura/Seqstart files
// that share this machine. Content validation stays fail-closed regardless
// (app id "Dum-Ka" + schema v1 on both sides of the invoke boundary).
export const PATCH_FILE_FILTERS = [
  {
    name: "Dum-Ka Project",
    extensions: ["dumka"],
  },
];

export const SCORE_FILE_FILTERS = [
  {
    name: "Dum-Ka Cycle JSON",
    extensions: ["dumka-cycle.json", "json"],
  },
];

export const TRACK_FILE_FILTERS = [
  {
    name: "Dum-Ka Track",
    extensions: ["dumka-track"],
  },
];
const NATIVE_MENU_ACTION_EVENT = "native_menu_action";

export type NativeMenuAction =
  | "newPatch"
  | "savePatch"
  | "savePatchAs"
  | "recallPatch"
  | "recallRecentPatch"
  | "exportScore"
  | "toggleAutosave"
  | "openSetup"
  | "openSeeds"
  | "toggleRhythmShaper"
  | "resetTransportSync"
  | "toggleSynth"
  | "openSynthProperties"
  | "midiPanic";

// ---------------------------------------------------------------------
// Machine-local configuration (mirrors src-tauri/src/machine.rs)
// ---------------------------------------------------------------------

/** A real CoreMIDI destination. `id` is the stable CoreMIDI unique ID (the
 * only matching key); `name` is display-only. */
export interface MidiDestination {
  id: string;
  name: string;
}

export interface MidiRouteStatus {
  desired: MidiDestination | null;
  connected: boolean;
  lastError: string | null;
}

/** Machine-local preferences — never stored in patch documents. */
export interface MachinePrefs {
  prefsVersion: number;
  midiDestination: MidiDestination | null;
  autosaveEnabled: boolean;
  autosaveIntervalMs: number;
  autoloadRecentSession: boolean;
}

/** `source: "defaults"` signals the one-shot localStorage migration may
 * still apply. */
export interface MachinePrefsSnapshot {
  prefs: MachinePrefs;
  source: "file" | "defaults";
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

export async function transportPlay(): Promise<void> {
  await invoke("transport_play");
}

export async function transportStop(): Promise<void> {
  await invoke("transport_stop");
}

export async function transportResync(): Promise<void> {
  await invoke("transport_resync");
}

/** Silence everything (stuck notes included) without stopping playback. */
export async function transportPanic(): Promise<void> {
  await invoke("transport_panic");
}

export async function midiListDestinations(): Promise<MidiDestination[]> {
  return await invoke<MidiDestination[]>("midi_list_destinations");
}

export async function midiSetDestination(
  dest: MidiDestination | null
): Promise<MidiRouteStatus> {
  return await invoke<MidiRouteStatus>("midi_set_destination", { dest });
}

/** Current route status; the backend also re-reconciles (rescan). */
export async function midiGetRouteStatus(): Promise<MidiRouteStatus> {
  return await invoke<MidiRouteStatus>("midi_get_route_status");
}

export async function machinePrefsGet(): Promise<MachinePrefsSnapshot> {
  return await invoke<MachinePrefsSnapshot>("machine_prefs_get");
}

export async function machinePrefsSet(prefs: MachinePrefs): Promise<void> {
  await invoke("machine_prefs_set", { prefs });
}

export async function transportSetTempo(bpm: number): Promise<void> {
  await invoke("transport_set_tempo", { bpm });
}

export async function transportGetSnapshot(): Promise<TransportSnapshot> {
  return await invoke<TransportSnapshot>("transport_get_snapshot");
}

/**
 * Declare the exact rolling-log subset needed by debug panels, seed recording,
 * conflict diagnostics, and trigger inspection. Every mode change forces one
 * scoped `transport_log_snapshot` so newly requested consumers hydrate.
 */
export async function transportSetTelemetryInterest(
  interest: TransportTelemetryInterest
): Promise<void> {
  await invoke("transport_set_telemetry_interest", { interest });
}

export async function scoreLoadFromPath(path: string): Promise<void> {
  await invoke("score_load_from_path", { path });
}

export async function scoreGetCurrent(): Promise<unknown | null> {
  return await invoke<unknown | null>("score_get_current");
}

export async function scoreLoadPreset(preset: string): Promise<void> {
  await invoke("score_load_preset", { preset });
}

export async function scoreCreateSubdivision(
  name: string,
  pitches: number[],
  velocity: number,
  weights?: number[]
): Promise<void> {
  await invoke("score_create_subdivision", {
    name,
    pitches,
    velocity,
    weights: weights ?? null,
  });
}

export async function scoreCreateSubdivisionSwitch(
  name: string,
  cycleBeats: number,
  initialWeights: SubdivisionWeight[],
  initialJathiWeights: JathiWeight[],
  initialJathiBhedam: JathiBhedamSelection | null,
  initialCustomSubdivision: CustomSubdivision | null,
  speedSubdivision: RhythmSpeedSpec | null,
  automation: AutomationSet | null,
  inflections: SubdivisionInflection[],
  switchCountWeights: SwitchCountWeight[],
  seedMode: string,
  seed: number,
  historySeeds: U64SeedDecimal[],
  historyWeight: number,
  newSeedWeight: number,
  maxHistory: number,
  newSeedChance: number,
  holdChance: number,
  blendCycles: number,
  singleParameterRhythmicModulation: boolean,
  accent: AccentSettings,
  pitch: number,
  velocity: number
): Promise<void> {
  await invoke("score_create_subdivision_switch", {
    request: {
      name,
      cycleBeats,
      initialWeights,
      initialJathiWeights,
      initialJathiBhedam,
      initialCustomSubdivision,
      speedSubdivision,
      automation,
      inflections,
      switchCountWeights,
      seedMode,
      seed,
      historySeeds,
      historyWeight,
      newSeedWeight,
      maxHistory,
      newSeedChance,
      holdChance,
      blendCycles,
      singleParameterRhythmicModulation,
      accent,
      pitch,
      velocity,
    },
  });
}

export async function scorePreviewSubdivisionSwitch(
  name: string,
  cycleBeats: number,
  initialWeights: SubdivisionWeight[],
  initialJathiWeights: JathiWeight[],
  initialJathiBhedam: JathiBhedamSelection | null,
  initialCustomSubdivision: CustomSubdivision | null,
  speedSubdivision: RhythmSpeedSpec | null,
  automation: AutomationSet | null,
  inflections: SubdivisionInflection[],
  switchCountWeights: SwitchCountWeight[],
  seedMode: string,
  seed: number,
  historySeeds: U64SeedDecimal[],
  historyWeight: number,
  newSeedWeight: number,
  maxHistory: number,
  newSeedChance: number,
  holdChance: number,
  blendCycles: number,
  singleParameterRhythmicModulation: boolean,
  accent: AccentSettings,
  pitch: number,
  velocity: number,
  tempoBpm: number,
  cycle: number
): Promise<SubdivisionSwitchPreview> {
  const preview = await invoke<SubdivisionSwitchPreview>("score_preview_subdivision_switch", {
    request: {
      name,
      cycleBeats,
      initialWeights,
      initialJathiWeights,
      initialJathiBhedam,
      initialCustomSubdivision,
      speedSubdivision,
      automation,
      inflections,
      switchCountWeights,
      seedMode,
      seed,
      historySeeds,
      historyWeight,
      newSeedWeight,
      maxHistory,
      newSeedChance,
      holdChance,
      blendCycles,
      singleParameterRhythmicModulation,
      accent,
      pitch,
      velocity,
    },
    tempoBpm,
    cycle,
  });
  return {
    ...preview,
    historySeeds: normalizeU64SeedDecimalList(preview.historySeeds),
  };
}

export async function generatorPreview(
  request: GeneratorPreviewRequest
): Promise<GeneratorPreview> {
  const preview = await invoke<GeneratorPreview>("generator_preview", { request });
  return {
    seed: {
      ...preview.seed,
      seed: normalizeU64SeedDecimal(preview.seed.seed) ?? "0",
      history: normalizeU64SeedDecimalList(preview.seed.history),
    },
    spans: preview.spans,
    trace: preview.trace ?? [],
    densityCorridor: preview.densityCorridor ?? null,
  };
}

/** One candidate note group sent to the backend Ratchet Scope preview,
 * cycle-local ticks from the resolved preview structure. */
export interface RatchetPreviewNote {
  id: number;
  startTick: number;
  endTick: number;
  allowCrossAccent?: boolean;
}

/** One accent/section span in cycle-local ticks. The UI converts its
 * beat-based span DTOs before sending — the model's Rational serde shape
 * never round-trips through the frontend. */
export interface RatchetPreviewSpan {
  startTick: number;
  endTick: number;
  matraLen: number;
}

export interface RatchetPreviewRequest {
  ratchet: RatchetPlaybackSpec;
  tempoBpm: number;
  ticksPerCycle: number;
  cycle?: number;
  cycleBeats?: number;
  automation?: AutomationSet | null;
  cycleTempoFlux?: CycleTempoFluxSpec | null;
  /** Present for parallel playback: the fixed reference-clock tempo. */
  parallelReferenceTempoBpm?: number | null;
  accentSpans: RatchetPreviewSpan[];
  sectionSpans?: RatchetPreviewSpan[];
  notes: RatchetPreviewNote[];
  focusId?: number | null;
  sampleSeed?: number;
}

export interface RatchetPreviewCandidate {
  id: number;
  startTick: number;
  endTick: number;
  spanIndex: number | null;
  pulses: number;
  durationMs: number;
  /** Backend-computed fire probability through the real eligibility model. */
  probability: number;
  eligible: boolean;
}

/** Backend-realized sample burst for the Scope lens, ms from note onset. */
export interface RatchetPreviewBurst {
  onsetsMs: number[];
  durationsMs: number[];
  velocities: number[];
  holdIndex: number | null;
  count: number;
  /** True when an IOI sits against a band edge (enforcement clamped). */
  bandLimited: boolean;
}

export interface RatchetBandCurvePoint {
  bpm: number;
  fastMs: number;
  slowMs: number;
}

export interface RatchetPreview {
  spanCount: number;
  candidates: RatchetPreviewCandidate[];
  focusId: number | null;
  burst: RatchetPreviewBurst | null;
  bandFastMs: number | null;
  bandSlowMs: number | null;
  /** Focus-local numerator for exact effective-ms to reference-rate inversion. */
  bandScaleMs: number | null;
  bandCurve: RatchetBandCurvePoint[];
}

export async function trackSetPlayback(
  request: TrackPlaybackRequest
): Promise<void> {
  await invoke("track_set_playback", { request });
}

export async function parallelSetPlayback(
  request: ParallelPlaybackRequest | null,
  options: { nextCycle?: boolean } = {}
): Promise<void> {
  // `nextCycle` requests the P1 in-place forward apply (used for live edits while
  // a parallel runtime is playing); omitted/false rebuilds and reapplies.
  await invoke("parallel_set_playback", {
    request,
    nextCycle: options.nextCycle ?? false,
  });
}

export async function synthSetEnabled(enabled: boolean): Promise<void> {
  await invoke("synth_set_enabled", { enabled });
}

export async function synthSetPrograms(programs: SynthChannelProgram[]): Promise<void> {
  await invoke("synth_set_programs", { programs });
}

export async function patchChooseSavePath(
  defaultPath = "untitled.dumka"
): Promise<string | null> {
  const path = await save({
    defaultPath,
    filters: PATCH_FILE_FILTERS,
  });
  return typeof path === "string" ? path : null;
}

export async function scoreChooseSavePath(
  defaultPath = "untitled.dumka-cycle.json"
): Promise<string | null> {
  const path = await save({
    defaultPath,
    filters: SCORE_FILE_FILTERS,
  });
  return typeof path === "string" ? path : null;
}

export async function patchChooseOpenPath(): Promise<string | null> {
  const path = await open({
    multiple: false,
    filters: PATCH_FILE_FILTERS,
  });
  return typeof path === "string" ? path : null;
}

export async function patchSaveToPath(
  path: string,
  patch: SequencerPatchDocument
): Promise<void> {
  await invoke("patch_save_to_path", {
    path,
    patch: patchDocumentForPersistence(patch),
  });
}

export async function patchLoadFromPath(path: string): Promise<unknown> {
  return await invoke<unknown>("patch_load_from_path", { path });
}

export async function trackChooseSavePath(
  defaultPath = "untitled.dumka-track"
): Promise<string | null> {
  const path = await save({
    defaultPath,
    filters: TRACK_FILE_FILTERS,
  });
  return typeof path === "string" ? path : null;
}

export async function trackChooseOpenPath(): Promise<string | null> {
  const path = await open({
    multiple: false,
    filters: TRACK_FILE_FILTERS,
  });
  return typeof path === "string" ? path : null;
}

export async function trackSaveToPath(
  path: string,
  document: TrackEnvelope
): Promise<void> {
  await invoke("track_save_to_path", {
    path,
    document: trackEnvelopeForPersistence(document),
  });
}

export async function trackLoadFromPath(path: string): Promise<unknown> {
  return await invoke<unknown>("track_load_from_path", { path });
}

export async function patchAutosave(patch: SequencerPatchDocument): Promise<void> {
  await invoke("patch_autosave", {
    patch: patchDocumentForPersistence(patch),
  });
}

export async function patchLoadAutosave(): Promise<unknown | null> {
  return await invoke<unknown | null>("patch_load_autosave");
}

export async function patchClearAutosave(): Promise<void> {
  await invoke("patch_clear_autosave");
}

export async function patchAskAutosaveRecovery(savedAt: string): Promise<boolean> {
  return await ask(
    `Dum-Ka found an autosaved recovery from ${new Date(
      savedAt
    ).toLocaleString()}.\n\nThe previous session did not close cleanly. Restore this autosaved recovery?`,
    {
      title: "Recover Autosaved Session",
      kind: "warning",
      okLabel: "Restore",
      cancelLabel: "Discard",
    }
  );
}

/**
 * Ask, at import time, how the imported track should be timed. Returns `true`
 * to keep the track's saved tempo/cycle (pinned track-local), `false` to make
 * it follow the destination project's global timing.
 */
export async function trackAskKeepTimingOnImport(
  trackName: string,
  savedTempoBpm: number,
  savedCycleBeats: number,
  destinationTempoBpm: number,
  destinationCycleBeats: number
): Promise<boolean> {
  return await ask(
    `Importing "${trackName}".\n\n` +
      `Saved timing: ${savedTempoBpm} BPM, ${savedCycleBeats}-beat cycle.\n` +
      `This project: ${destinationTempoBpm} BPM, ${destinationCycleBeats}-beat cycle.\n\n` +
      `Keep the track's saved timing? Choose No to follow this project's global timing.`,
    {
      title: "Import Track Timing",
      kind: "info",
      okLabel: "Keep saved timing",
      cancelLabel: "Follow this project",
    }
  );
}

export async function scoreSaveToPath(path: string): Promise<void> {
  await invoke("score_save_to_path", { path });
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

export async function onNativeMenuAction(
  handler: (action: NativeMenuAction) => void
): Promise<UnlistenFn> {
  return await listen<NativeMenuAction>(NATIVE_MENU_ACTION_EVENT, (event) => {
    handler(event.payload);
  });
}

export async function onTransportSnapshot(
  handler: (snapshot: TransportSnapshot) => void
): Promise<UnlistenFn> {
  return await listen<TransportSnapshot>("transport_snapshot", (event) => {
    handler(event.payload);
  });
}

export async function onTransportPosition(
  handler: (position: TransportPosition) => void
): Promise<UnlistenFn> {
  return await listen<TransportPosition>("transport_position", (event) => {
    handler(event.payload);
  });
}

export async function onTransportTimelineSnapshot(
  handler: (snapshot: TransportTimelineSnapshot) => void
): Promise<UnlistenFn> {
  return await listen<TransportTimelineSnapshot>(
    "transport_timeline_snapshot",
    (event) => {
      handler(event.payload);
    }
  );
}

export async function onTransportLogSnapshot(
  handler: (snapshot: TransportLogSnapshot) => void
): Promise<UnlistenFn> {
  return await listen<TransportLogSnapshot>("transport_log_snapshot", (event) => {
    handler(event.payload);
  });
}

/** Change-only route updates from the hot-plug watcher and set/rescan
 * commands. */
export async function onMidiRouteStatus(
  handler: (status: MidiRouteStatus) => void
): Promise<UnlistenFn> {
  return await listen<MidiRouteStatus>("midi_route_status", (event) => {
    handler(event.payload);
  });
}
