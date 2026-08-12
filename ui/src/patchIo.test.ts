import { describe, expect, it } from "vitest";

import type { AutomationSet, CustomSubdivision, SynthChannelProgram } from "./bridge";
import {
  PATCH_APP_ID,
  PATCH_SCHEMA_VERSION,
  DEFAULT_PITCH_RANGE_HIGH,
  DEFAULT_PITCH_RANGE_LOW,
  MAX_PARALLEL_TRACKS,
  MAX_EVOLUTION_DIRECTIVES,
  TRACK_DOCUMENT_KIND,
  buildTrackEnvelope,
  cleanCustomSubdivision,
  cloneJathiBhedam,
  createNeutralPatchDocument,
  flattenProjectPatchForActiveTrack,
  normalizeAutomationSet,
  normalizeCustomSubdivisionFromPatch,
  normalizeCycleTempoFlux,
  normalizeJathiBhedamFromPatch,
  normalizeBeatLocksFromPatch,
  normalizeOrnamentSpec,
  normalizeRatchetSpec,
  normalizeRhythmArticulationSeedPolicy,
  normalizeRhythmTab,
  normalizeSeedPathTracePoint,
  normalizeSeedPathWildcardDomain,
  normalizeU64SeedDecimal,
  normalizeTrackFlowBoxes,
  readPatchDocument,
  readTrackEnvelope,
  spliceImportedTrack,
  withProjectState,
  type ParallelProjectPatch,
  type ParallelTrackPatch,
  type SequencerPatchDocument,
  type SequencerPatchFlatState,
  normalizeShapeGroupsFromPatch,
  normalizePatchGeneratorConfig,
  normalizePatchEvolutionPlan,
  FALLBACK_GLOBAL_SEED,
} from "./patchIo";
import { DEFAULT_DUMKA_PATTERN } from "./dumkaPattern";
import { normalizeEvolutionPlan } from "./dumkaEvolvePlan";
import { MAX_STOPPED_PREVIEW_CYCLE } from "./timelineModel";

describe("beat-lock articulation normalization", () => {
  it("canonicalizes default and per-cell rest/tie into one 100% space", () => {
    const [lock] = normalizeBeatLocksFromPatch([
      {
        id: "probabilities",
        startBeat: 0,
        endBeat: 0,
        restProbabilityPercent: 80,
        tieProbabilityPercent: 80,
        patterns: [
          {
            pulses: [4],
            weight: 1,
            cells: [
              { restProbabilityPercent: 70, tieProbabilityPercent: 90 },
            ],
          },
        ],
      },
    ]);
    expect(lock).toMatchObject({
      restProbabilityPercent: 80,
      tieProbabilityPercent: 20,
    });
    expect(lock!.patterns[0]!.cells[0]).toEqual({
      restProbabilityPercent: 70,
      tieProbabilityPercent: 30,
    });
  });
});

const savedAt = "2026-05-30T19:00:00.000Z";

describe("legacy Ratchet v5 migration", () => {
  const legacySpeed = (
    strategy: string,
    min: number,
    max: number
  ) => ({ strategy, min, max, distribution: "uniform" });

  it("keeps metric speed strategies legacy and migrates fixed audible rates", () => {
    const beat60 = normalizeRatchetSpec(
      { speed: legacySpeed("beatRate", 8, 12) },
      { tempoBpm: 60 }
    );
    const beat180 = normalizeRatchetSpec(
      { speed: legacySpeed("beatRate", 8, 12) },
      { tempoBpm: 180 }
    );
    const matra60 = normalizeRatchetSpec(
      { speed: legacySpeed("pulsesPerMatra", 2, 3) },
      { tempoBpm: 60 }
    );
    const audible = normalizeRatchetSpec(
      { speed: legacySpeed("audibleRate", 8, 12) },
      { tempoBpm: 180 }
    );

    expect(beat60.band).toBeNull();
    expect(beat180.band).toBeNull();
    expect(matra60.band).toBeNull();
    expect(beat60.speed).toMatchObject({ strategy: "beatRate", min: 8, max: 12 });
    expect(beat180.speed).toEqual(beat60.speed);
    expect(matra60.speed).toMatchObject({
      strategy: "pulsesPerMatra",
      min: 2,
      max: 3,
    });
    expect(audible.band).toMatchObject({
      rateSlowRef: 8,
      rateFastRef: 12,
      tracking: 0,
    });
  });

  it("normalizes deprecated percent-of-beat values through BeatRate", () => {
    const migrated = normalizeRatchetSpec(
      { speed: legacySpeed("percentOfBeat", 400, 600) },
      { tempoBpm: 60 }
    );
    expect(migrated.speed).toMatchObject({ strategy: "beatRate", min: 4, max: 6 });
    expect(migrated.band).toBeNull();
  });

  it("keeps the exact legacy probability resolver for non-neutral modifiers", () => {
    const durationGate = normalizeRatchetSpec({
      speed: legacySpeed("audibleRate", 8, 12),
      modifiers: {
        slowNote: {
          enabled: true,
          threshold: 2.5,
          basis: "matras",
          multiplier: 0.25,
          operation: "multiply",
        },
      },
    });
    const cycleCurve = normalizeRatchetSpec({
      speed: legacySpeed("audibleRate", 8, 12),
      automation: {
        enabled: true,
        points: [
          { position: 0, probability: 0.5, speed: 1 },
          { position: 1, probability: 1.5, speed: 1 },
        ],
      },
    });
    const neutral = normalizeRatchetSpec({
      speed: legacySpeed("audibleRate", 8, 12),
    });
    const speedCurve = normalizeRatchetSpec({
      speed: legacySpeed("audibleRate", 8, 12),
      automation: {
        enabled: true,
        points: [
          { position: 0, probability: 1, speed: 0.5 },
          { position: 1, probability: 1, speed: 1.5 },
        ],
      },
    });

    expect(durationGate.placement).toBeNull();
    expect(durationGate.modifiers.slowNote).toMatchObject({
      enabled: true,
      threshold: 2.5,
      basis: "matras",
      multiplier: 0.25,
      operation: "multiply",
    });
    expect(cycleCurve.placement).toBeNull();
    expect(cycleCurve.modifiers.position).toMatchObject({ enabled: true });
    expect(cycleCurve.modifiers.position.points[0]?.probability).toBe(0.5);
    expect(neutral.placement).not.toBeNull();
    expect(speedCurve.band).toBeNull();
    expect(speedCurve.placement).toBeNull();
    expect(speedCurve.modifiers.position.points[0]?.speed).toBe(0.5);
  });

  it("preserves metric speed semantics for every project track", () => {
    const raw = JSON.parse(
      JSON.stringify(createNeutralPatchDocument({ tempoBpm: 60 }))
    );
    raw.schemaVersion = PATCH_SCHEMA_VERSION;
    raw.project.global.tempoBpm = 60;
    const template = raw.project.tracks[0];
    const legacyRatchet = {
      enabled: true,
      spec: { probability: 1, speed: legacySpeed("beatRate", 8, 8) },
    };
    raw.project.activeTrackId = "global";
    raw.project.tracks = [
      {
        ...template,
        id: "global",
        tempoMode: "global",
        rhythm: { ...template.rhythm, ratchet: legacyRatchet },
      },
      {
        ...template,
        id: "custom",
        tempoMode: "custom",
        customTempoBpm: 150,
        rhythm: { ...template.rhythm, ratchet: legacyRatchet },
      },
    ];

    const loaded = readPatchDocument(raw);
    const global = loaded.project.tracks.find((track) => track.id === "global")!;
    const custom = loaded.project.tracks.find((track) => track.id === "custom")!;
    expect(global.rhythm.ratchet.spec.band).toBeNull();
    expect(custom.rhythm.ratchet.spec.band).toBeNull();
    expect(global.rhythm.ratchet.spec.speed).toMatchObject({
      strategy: "beatRate",
      min: 8,
      max: 8,
    });
    expect(custom.rhythm.ratchet.spec.speed).toEqual(
      global.rhythm.ratchet.spec.speed
    );
  });
});

describe("normalizeShapeGroupsFromPatch selector-domain sanitize", () => {
  it("drops cell selectors outside the rhythmCell domain (Codex P2)", () => {
    const groups = normalizeShapeGroupsFromPatch([
      {
        id: "g",
        enabled: true,
        domain: "beat",
        stage: "articulation",
        selection: {
          kind: "and",
          exprs: [
            { kind: "beatRange", startBeat: 0, endBeat: 3 },
            { kind: "cellState", state: "tie" },
          ],
        },
        operations: [{ kind: "restProbability", percent: 10 }],
      },
    ]);
    // The cell selector is gone; the surviving single leaf is unwrapped.
    expect(groups[0]!.selection).toEqual({
      kind: "beatRange",
      startBeat: 0,
      endBeat: 3,
    });
  });

  it("collapses to `all` when nothing legal remains and keeps everyNthMatra", () => {
    const groups = normalizeShapeGroupsFromPatch([
      {
        id: "g",
        enabled: true,
        domain: "noteGroup",
        stage: "playbackFinalize",
        selection: { kind: "cellLenEquals", len: 2 },
        operations: [{ kind: "scaleVelocity", percent: 150 }],
      },
      {
        id: "m",
        enabled: true,
        domain: "noteGroup",
        stage: "playbackFinalize",
        selection: { kind: "everyNthMatra", n: 4, offset: 1 },
        operations: [{ kind: "transposePitch", semitones: 5 }],
      },
    ]);
    expect(groups[0]!.selection).toEqual({ kind: "all" });
    expect(groups[1]!.selection).toEqual({
      kind: "everyNthMatra",
      n: 4,
      offset: 1,
    });
  });

  it("keeps everyNthOnset off the beat axis and defaults countRests", () => {
    const groups = normalizeShapeGroupsFromPatch([
      {
        id: "beaty",
        enabled: true,
        domain: "beat",
        stage: "articulation",
        selection: { kind: "everyNthOnset", n: 2, offset: 0, countRests: true },
        operations: [{ kind: "restProbability", percent: 10 }],
      },
      {
        id: "cellsy",
        enabled: true,
        domain: "rhythmCell",
        stage: "articulation",
        selection: { kind: "everyNthOnset", n: 3, offset: 1 }, // no countRests
        operations: [{ kind: "restProbability", percent: 10 }],
      },
    ]);
    // Beat domain cannot count onsets — sanitized away to `all`.
    expect(groups[0]!.selection).toEqual({ kind: "all" });
    expect(groups[1]!.selection).toEqual({
      kind: "everyNthOnset",
      n: 3,
      offset: 1,
      countRests: false,
    });
  });

  it("normalizes chance and trigger operations (defaults + clamps)", () => {
    const groups = normalizeShapeGroupsFromPatch([
      {
        id: "t",
        enabled: true,
        domain: "noteGroup",
        stage: "playbackFinalize",
        selection: { kind: "all" },
        chancePercent: 45.7, // rounded; out-of-range values clamp to 0..100
        operations: [
          { kind: "triggerRatchet" }, // respectCooldown defaults true
          { kind: "triggerOrnament", respectCooldown: false },
          { kind: "restProbability", percent: 10 }, // wrong stage → dropped
        ],
      },
      {
        id: "legacy",
        enabled: true,
        domain: "beat",
        stage: "articulation",
        selection: { kind: "all" },
        // No chancePercent (pre-chance patch) → always fires.
        operations: [{ kind: "restProbability", percent: 10 }],
      },
    ]);
    expect(groups[0]!.chancePercent).toBe(46);
    expect(groups[0]!.operations).toEqual([
      { kind: "triggerRatchet", respectCooldown: true },
      { kind: "triggerOrnament", respectCooldown: false },
    ]);
    expect(groups[1]!.chancePercent).toBe(100);
  });

  it("normalizes the pitch math family (clamps + defaults)", () => {
    const groups = normalizeShapeGroupsFromPatch([
      {
        id: "p",
        enabled: true,
        domain: "noteGroup",
        stage: "playbackFinalize",
        selection: { kind: "all" },
        operations: [
          { kind: "randomizePitch", rangeSemitones: 99 }, // clamps to 48
          { kind: "randomWalkPitch" }, // defaults step 2
          { kind: "accumulatePitch", semitonesPerCycle: -7, wrapSemitones: 200 },
          { kind: "invertPitch", centerPitch: 200 }, // clamps to 127
          { kind: "stretchIntervals", percent: 999, centerPitch: 60 },
          { kind: "quantizePitchToCollection" },
        ],
      },
    ]);
    expect(groups[0]!.operations).toEqual([
      { kind: "randomizePitch", rangeSemitones: 48 },
      { kind: "randomWalkPitch", stepSemitones: 2 },
      { kind: "accumulatePitch", semitonesPerCycle: -7, wrapSemitones: 96 },
      { kind: "invertPitch", centerPitch: 127 },
      { kind: "stretchIntervals", percent: 400, centerPitch: 60 },
      { kind: "quantizePitchToCollection" },
    ]);
  });
});

function equalPartsCustom(): CustomSubdivision {
  return {
    perBeatWeight: 2,
    equalPartsWeight: 5,
    partCountWeights: [
      { count: 5, weight: 3 },
      { count: 8, weight: 4 },
    ],
    partGatiWeights: [
      { subdivision: 5, weight: 6 },
      { subdivision: 7, weight: 2 },
    ],
    divisions: [],
    jathiWeights: [],
  };
}

function purePerBeatCustom(): CustomSubdivision {
  return {
    perBeatWeight: 1,
    equalPartsWeight: 0,
    partCountWeights: [],
    partGatiWeights: [],
    divisions: [],
    jathiWeights: [],
  };
}

function legacyDivisionsCustom(): CustomSubdivision {
  return {
    perBeatWeight: 0,
    equalPartsWeight: 1,
    partCountWeights: [],
    partGatiWeights: [],
    divisions: [
      { gatiWeights: [{ subdivision: 5, weight: 2 }] },
      { gatiWeights: [{ subdivision: 7, weight: 3 }] },
    ],
    jathiWeights: [],
  };
}

function makeAutomationSet(label: string): AutomationSet {
  return {
    lengthCycles: 4,
    markers: [
      {
        id: `${label}-marker`,
        time: { numer: 3, denom: 8 },
        label: `${label} cue`,
      },
    ],
    tracks: [
      {
        id: `${label}-automation`,
        target: `sequencer.boundary.${label}.probability`,
        enabled: true,
        combine: "multiply",
        graphRange: { min: 0.1, max: 0.9 },
        curves: [
          {
            id: `${label}-curve`,
            enabled: true,
            interpolation: "smooth",
            points: [
              {
                id: `${label}-point-a`,
                time: { numer: 0, denom: 1 },
                value: { type: "number", value: 0.25 },
                anchorId: null,
                outCurve: { kind: "easeInOut", amount: 0.4 },
              },
              {
                id: `${label}-point-b`,
                time: { numer: 7, denom: 8 },
                value: { type: "number", value: 0.75 },
                anchorId: `${label}-marker`,
                outCurve: { kind: "hold", amount: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeSynthPrograms(labelOffset: number): SynthChannelProgram[] {
  return Array.from({ length: 16 }, (_, index) => ({
    channel: index + 1,
    mode: index % 4 === 0 ? "percussion" : "melodic",
    program: (index * 7 + labelOffset) % 128,
    drumNote: 35 + ((index + labelOffset) % 40),
  }));
}

function makeSeedPaths(label: string) {
  return [
    {
      id: `${label}-seed-path`,
      name: `${label} seed path`,
      createdAt: savedAt,
      sourcePathId: null,
      immutable: true as const,
      wildcardRules: [
        { domain: "global" as const, cycle: null, trackId: null },
        { domain: "rhythm" as const, cycle: 2, trackId: `${label}-track` },
      ],
      trace: [
        {
          cycle: 2,
          domain: "rhythm",
          label: `${label} rhythm seed`,
          seed: "424242",
          baseSeed: "111",
          source: "history",
          historyBefore: ["1", "2"],
          historyAfter: ["2", "424242"],
          parallelTrackIndex: 1,
          trackId: `${label}-track`,
          recordedAt: savedAt,
        },
      ],
    },
  ];
}

function makeRatchetSpec(seed: number) {
  return normalizeRatchetSpec({
    seed,
    probability: 0.42,
    modifiers: {
      slowNote: {
        enabled: true,
        threshold: 2,
        basis: "percentOfBeat",
        multiplier: 0.6,
        operation: "multiply",
      },
      fastNote: {
        enabled: true,
        threshold: 1,
        basis: "matras",
        multiplier: 0.15,
        operation: "add",
      },
      position: {
        enabled: true,
        points: [
          { position: 0, probability: 0.8, speed: 0.75 },
          { position: 0.5, probability: 1.4, speed: 1.25 },
          { position: 1, probability: 0.6, speed: 1.75 },
        ],
      },
      accentSpanStart: 0.7,
      accentSpanEnd: 0.9,
      sectionStart: 1.2,
      sectionEnd: 0.8,
      cycleStart: 1.5,
      cycleEnd: 0.5,
      operations: {
        accentSpanStart: "multiply",
        accentSpanEnd: "multiply",
        sectionStart: "multiply",
        sectionEnd: "multiply",
        cycleStart: "multiply",
        cycleEnd: "multiply",
      },
    },
    speed: {
      strategy: "beatRate",
      min: 2,
      max: 6,
      distribution: "favorFast",
    },
    curve: "accelerandoRetardando",
    curveWeights: {
      even: 1,
      accelerando: 2,
      retardando: 3,
      accelerandoRetardando: 4,
      retardandoAccelerando: 5,
    },
    cooldownMatras: 2,
    cooldownBasis: "matras",
    temporalEasing: 0.35,
    temporalEasingShape: "lilt",
    temporalEasingProbability: 0.65,
    temporalEasingWeights: {
      humanize: 1,
      humanizeTight: 2,
      humanizeLoose: 3,
      subtleAccelerando: 4,
      subtleRetardando: 5,
      sway: 6,
      lilt: 7,
    },
    timeCurve: {
      enabled: true,
      points: [
        { x: 0, y: 0.1 },
        { x: 0.4, y: 0.85 },
        { x: 1, y: 0.35 },
      ],
      variance: 0.2,
      interpolate: true,
      interpolationMin: 0.15,
      interpolationMax: 0.75,
      choices: [
        {
          id: "sweep",
          weight: 2,
          points: [
            { x: 0, y: 0.2 },
            { x: 1, y: 0.8 },
          ],
        },
      ],
    },
    velocity: {
      enabled: true,
      mode: "absolute",
      min: 54,
      max: 121,
      center: 88,
      attraction: 0.3,
      sameProbability: 0.2,
    },
    allowMultiMatra: false,
    maxSpanMatras: 9,
    maxSpanMatrasBySubdivision: [
      { subdivision: 3, maxSpanMatras: 4 },
      { subdivision: 4, maxSpanMatras: 5 },
      { subdivision: 5, maxSpanMatras: 6 },
      { subdivision: 6, maxSpanMatras: 7 },
      { subdivision: 7, maxSpanMatras: 8 },
      { subdivision: 9, maxSpanMatras: 9 },
      { subdivision: 11, maxSpanMatras: 10 },
    ],
    internalRhythm: {
      enabled: true,
      minCount: 3,
      maxCount: 6,
    },
  });
}

function makeOrnamentSpec(seed: number) {
  return normalizeOrnamentSpec({
    seed,
    grace: {
      enabled: true,
      placement: "onBeat",
      placementWeights: { beforeBeat: 2, onBeat: 5 },
      countWeights: { single: 2, double: 3, triple: 1 },
      probability: 0.55,
      modifiers: {
        slowNote: { enabled: true, threshold: 2, basis: "matras", multiplier: 0.9 },
        fastNote: { enabled: true, threshold: 1, basis: "matras", multiplier: 1.2 },
        accentSpanStart: 1.1,
        accentSpanEnd: 0.95,
        sectionStart: 1.3,
        sectionEnd: 0.85,
        cycleStart: 1.4,
        cycleEnd: 0.75,
      },
      cooldown: 1,
      cooldownBasis: "beats",
      duration: 32,
      durationBasis: "milliseconds",
      velocity: {
        enabled: true,
        mode: "relative",
        min: -18,
        max: 9,
        center: 0,
        attraction: 0.4,
        sameProbability: 0.1,
      },
      allowRests: true,
    },
    delay: {
      enabled: true,
      probability: 0.31,
      min: 1,
      max: 3,
      basis: "beats",
      quantization: "quantized",
      distribution: "edges",
      tuplets: [
        { tuplet: 3, weight: 2 },
        { tuplet: 5, weight: 1 },
      ],
    },
  });
}

function articulationPosition(offset: number) {
  return {
    single: { enabled: true, restProbabilityPercent: 4 + offset, tieProbabilityPercent: 1 },
    first: { enabled: true, restProbabilityPercent: 5 + offset, tieProbabilityPercent: 2 },
    middle: { enabled: true, restProbabilityPercent: 6 + offset, tieProbabilityPercent: 3 },
    last: { enabled: true, restProbabilityPercent: 7 + offset, tieProbabilityPercent: 4 },
  };
}

function makeFlatState(label: string, offset: number): SequencerPatchFlatState {
  const cycleBeats = 10 + offset;
  const initialCustomSubdivision = offset % 2 === 0 ? equalPartsCustom() : purePerBeatCustom();
  return {
    app: PATCH_APP_ID,
    schemaVersion: PATCH_SCHEMA_VERSION,
    savedAt,
    transport: {
      tempoBpm: 124.5 + offset,
      synthEnabled: offset % 2 === 0,
      synthPrograms: makeSynthPrograms(offset),
      rhythmPlaybackEnabled: true,
      currentScoreId: `${label}-score`,
      cycleTempoFlux: normalizeCycleTempoFlux({
        enabled: true,
        minBpm: 88 + offset,
        maxBpm: 144 + offset,
        seed: 5150 + offset,
        curve: {
          enabled: true,
          points: [
            { x: 0, y: 0.2 },
            { x: 0.5, y: 0.9 },
            { x: 1, y: 0.4 },
          ],
          variance: 0.25,
          interpolate: true,
          interpolationMin: 0.1,
          interpolationMax: 0.8,
          choices: [
            {
              id: `${label}-tempo-curve`,
              weight: 4,
              points: [
                { x: 0, y: 0.15 },
                { x: 1, y: 0.85 },
              ],
            },
          ],
        },
      }),
    },
    sequencer: {
      scoreSetupOpen: true,
      randomize: {
        seed: 1,
        sections: {
          enabled: false,
          complexity: 2,
          recipe: "hub",
          fields: { boundaries: true, count: true },
        },
        subdivisions: {
          enabled: false,
          complexity: 2,
          recipe: "loop",
          fields: { gati: true, jathi: true, equalParts: true },
        },
        rhythm: {
          enabled: true,
          complexity: 2,
          recipe: "loop",
          fields: { cells: true, entryFallback: true },
          advancedMatrix: {
            enabled: false,
            mode: "classic",
            stationaryPreset: "even",
            stationaryStrength: 50,
            diffusionBandwidth: 50,
            diffusionDrift: 0,
            metastableBasins: 2,
            metastableDwell: 60,
            metastableEscape: 30,
            spectralGap: 50,
            spectralOscillation: 0,
            spectralModes: 1,
            sparsity: 0,
            maxWeight: 64,
          },
        },
        ratchet: {
          enabled: false,
          complexity: 2,
          recipe: "loop",
          fields: { chance: true, position: true, cooldown: true },
        },
        ornaments: {
          enabled: false,
          complexity: 2,
          recipe: "loop",
          fields: {
            chance: true,
            clusters: true,
            placement: true,
            duration: true,
            cooldown: true,
            rests: true,
          },
        },
        accents: {
          enabled: false,
          complexity: 2,
          recipe: "hub",
          fields: { beat: true, jathi: true, section: true, mode: true },
        },
        jathiBhedam: {
          enabled: false,
          complexity: 2,
          recipe: "loop",
          fields: {},
        },
        pitch: {
          enabled: true,
          complexity: 2,
          recipe: "drift",
          fields: { mode: true, tonic: true, matrix: true, entryFallback: true, transpose: true },
          advancedMatrix: {
            enabled: false,
            mode: "classic",
            stationaryPreset: "even",
            stationaryStrength: 50,
            diffusionBandwidth: 50,
            diffusionDrift: 0,
            metastableBasins: 2,
            metastableDwell: 60,
            metastableEscape: 30,
            spectralGap: 50,
            spectralOscillation: 0,
            spectralModes: 1,
            sparsity: 0,
            maxWeight: 64,
          },
        },
        channel: {
          enabled: false,
          complexity: 2,
          recipe: "braid",
          fields: { channels: true, entryFallback: true },
          advancedMatrix: {
            enabled: false,
            mode: "classic",
            stationaryPreset: "even",
            stationaryStrength: 50,
            diffusionBandwidth: 50,
            diffusionDrift: 0,
            metastableBasins: 2,
            metastableDwell: 60,
            metastableEscape: 30,
            spectralGap: 50,
            spectralOscillation: 0,
            spectralModes: 1,
            sparsity: 0,
            maxWeight: 64,
          },
        },
      },
      probabilityOpen: true,
      boundariesOpen: true,
      maxSectionsHelpOpen: true,
      name: `${label} sequencer`,
      cycleBeats,
      initialWeights: [
        { subdivision: 3, weight: 2 + offset },
        { subdivision: 7, weight: 5 + offset },
      ],
      initialJathiWeights: [
        { jathi: 5, weight: 4 + offset },
        { jathi: 7, weight: 1 + offset },
      ],
      initialCustomSubdivision,
      boundaries: [
        {
          id: `${label}-boundary-3`,
          afterBeat: 3,
          changeProbability: 0.37,
          weights: [
            { subdivision: 4, weight: 2 },
            { subdivision: 9, weight: 3 },
          ],
          jathiWeights: [
            { jathi: 3, weight: 1 },
            { jathi: 9, weight: 5 },
          ],
          customSubdivision: equalPartsCustom(),
        },
        {
          id: `${label}-boundary-7`,
          afterBeat: 7,
          changeProbability: 0.64,
          weights: [{ subdivision: 5, weight: 8 }],
          jathiWeights: [{ jathi: 11, weight: 2 }],
          customSubdivision: purePerBeatCustom(),
        },
      ],
      selectedBoundaryAfterBeat: 7,
      sectionCountWeights: [
        { count: 1, weight: 2 },
        { count: 3, weight: 6 },
      ],
      seedMode: "history",
      seed: 7000 + offset,
      historySeeds: ["11", "22", String(33 + offset)],
      historyWeight: 4,
      newSeedWeight: 2,
      maxHistory: 12,
      newSeedChance: 21,
      holdChance: 61,
      blendCycles: 11,
      singleParameterRhythmicModulation: true,
      pitch: 62 + offset,
      velocity: 91 + offset,
      accent: {
        beatStart: { min: 11, max: 19 },
        sectionStartExtra: { min: 7, max: 13 },
        jathiStart: { min: 21, max: 34 },
        jathiMode: "layered",
      },
      userPreviewCycle: 5,
    },
    generatorEnabled: true,
    generator: {
      kind: "example",
      densityPercent: 73,
      seedMode: { type: "locked", seed: 9000 + offset },
    },
    automation: makeAutomationSet(label),
    rhythm: {
      rhythmOpen: true,
      rhythmTab: "ratchet",
      rhythmLength: 7,
      rhythmOrder: "second",
      rhythmExtrapolateFrom: 5,
      rhythmExtrapolationStrategy: "densityPreserving",
      rhythmMaterializeMode: "fillEmpty",
      copyTargetMode: "selected",
      copySelectedTargets: [3, 5, 7],
      passageInput: "4 2 1 3 2 5",
      passageStrategy: "matraWindows",
      passageOrder: "second",
      passageFitStrategy: "sparseNearest",
      passageTargetMode: "selected",
      passageSelectedTargets: [4, 9],
      passageHelpOpen: true,
      selectedKeysByLength: {
        5: ["2-3", "1-1-3"],
        7: ["3-4"],
      },
      speedEditorKind: "jathi",
      speedEditorValue: 9,
      rhythmSeed: 1984 + offset,
      rhythmSeedBehavior: "history",
      historySeeds: ["101", "202", String(303 + offset)],
      historyWeight: 5,
      newSeedWeight: 3,
      maxHistory: 14,
      newSeedChance: 32,
      holdChance: 62,
      blendCycles: 12,
      fallback: 1,
      fallbackMode: "weighted",
      fallbackWeightsByLength: {
        5: { "2-3": 4, "1-1-3": 2 },
        7: { "3-4": 6 },
      },
      entryWeightsByLength: {
        5: { "5:second:2-3>1-1-3": 9 },
      },
      weights: {
        "5:second:2-3:1-1-3": 8,
        "7:second:3-4:3-4": 5,
      },
      articulation: {
        open: true,
        seedPolicy: {
          seed: 4_242 + offset,
          followRhythmChance: 37,
        },
        cells: {
          "5:2-3:0": { restProbabilityPercent: 12, tieProbabilityPercent: 8 },
        },
        tieOverAccentProbabilityPercent: 14,
        restOverAccentProbabilityPercent: 9,
        blend: {
          mode: "weighted",
          manualWeight: 2,
          fragmentWeight: 3,
          sectionWeight: 4,
          cycleWeight: 5,
        },
        fragmentPosition: articulationPosition(0),
        sectionPosition: articulationPosition(4),
        cyclePosition: articulationPosition(8),
        neighbor: {
          playAfterPlayMultiplierPercent: 118,
          restAfterRestMultiplierPercent: 82,
          tieAfterTieMultiplierPercent: 141,
        },
      },
      arbitrarySubdivision: {
        probabilityPercent: 28,
        targets: [
          { spanLen: 5, weight: 3 },
          { spanLen: 7, weight: 5 },
        ],
        clumpLengths: [
          { count: 2, weight: 4 },
          { count: 4, weight: 1 },
        ],
        allowTrivialPattern: true,
        patternSource: "weightedPool",
        poolWeightsByLength: {
          5: { "2-3": 3 },
          7: { "3-4": 2 },
        },
        poolEditorLength: 9,
      },
      beatLocks: {
        open: true,
        seed: 4242 + offset,
        locks: [
          {
            id: "lock-fixture",
            enabled: true,
            mode: "perBeat" as const,
            startBeat: 5,
            endBeat: 6,
            patterns: [
              {
                pulses: [4, 4],
                weight: 3,
                cells: [
                  { restProbabilityPercent: 20, tieProbabilityPercent: 10 },
                  { restProbabilityPercent: 0, tieProbabilityPercent: 0 },
                ],
              },
            ],
            unlockedWeight: 1,
            allowTieIn: true,
            allowTieOut: false,
            allowArticulation: true,
            restProbabilityPercent: 15,
            tieProbabilityPercent: 25,
          },
        ],
      },
      shapeGroups: {
        open: true,
        seed: 11 + offset,
        groups: [
          {
            id: "shape-fixture",
            name: "accents",
            enabled: true,
            domain: "beat" as const,
            stage: "articulation" as const,
            chancePercent: 100,
            selection: {
              kind: "and" as const,
              exprs: [
                { kind: "beatRange" as const, startBeat: 1, endBeat: 5 },
                {
                  kind: "euclidean" as const,
                  pulses: 3,
                  steps: 8,
                  rotate: 1,
                  invert: false,
                },
              ],
            },
            operations: [
              { kind: "restProbability" as const, percent: 25 },
              { kind: "tieProbability" as const, percent: 10 },
            ],
          },
        ],
      },
      speedSubdivisionWeights: {
        "gati:5:halfSpeed": 3,
        "gati:7:thirdSpeed": 4,
        "jathi:5:secondSpeed": 5,
      },
      ratchet: {
        enabled: true,
        spec: makeRatchetSpec(9000 + offset),
      },
      ornament: {
        enabled: true,
        tab: "delay",
        spec: makeOrnamentSpec(6000 + offset),
      },
      playbackChains: [
        {
          spanLen: 5,
          order: "second",
          states: [{ pulses: [2, 3] }, { pulses: [1, 1, 3] }],
          transitions: [{ from: [0, 1], to: 0, weight: 7 }],
          fallback: 1,
          fallbackWeights: [{ state: 1, weight: 5 }],
          entryWeights: [{ states: [0, 1], weight: 6 }],
        },
      ],
      resolvedSeed: {
        seed: String(4567 + offset),
        source: "history",
        history: ["12", "34", String(56 + offset)],
      },
    },
    pitchShaper: {
      open: true,
      enabled: true,
      tab: "transpose",
      order: "second",
      collectionId: "major",
      collectionTransposition: 5,
      rangeLow: 43,
      rangeHigh: 88,
      states: [
        { pitch: 60, label: "Sa" },
        { pitch: 64, label: "Ga" },
        { pitch: 67, label: "Pa" },
      ],
      selectedKeys: ["60", "64", "67"],
      weights: { "second:0>1:2": 7 },
      fallback: 2,
      fallbackMode: "weighted",
      fallbackWeights: { "0": 2, "1": 5 },
      entryWeights: { "second:0>1": 3 },
      seed: 3131 + offset,
      seedBehavior: "history",
      historySeeds: ["7", "8", String(9 + offset)],
      historyWeight: 4,
      newSeedWeight: 2,
      maxHistory: 16,
      newSeedChance: 43,
      holdChance: 63,
      blendCycles: 13,
      boundary: { low: 45, high: 84, modulo: 12, policy: "reflect" },
      ratchetMode: "perRatchetHit",
      wholeProbabilityPercent: 73,
      perHitProbabilityPercent: 41,
      preserveFirstHit: false,
      ornamentMode: "perGraceNote",
      ornamentWholeProbabilityPercent: 62,
      ornamentPerGraceProbabilityPercent: 27,
      gracePitchEnabled: true,
      gracePitchProbabilityPercent: 66,
      gracePitchScope: "perGraceNote",
      gracePitchPitches: [
        { pitch: 59, weight: 2 },
        { pitch: 62, weight: 6 },
      ],
      graceTransposeEnabled: true,
      graceTransposeProbabilityPercent: 44,
      graceTransposeScope: "perGraceNote",
      graceTransposeUpWeight: 5,
      graceTransposeDownWeight: 3,
      graceTransposeIntervals: [
        { semitones: 1, weight: 2 },
        { semitones: 2, weight: 4 },
      ],
      transposeEnabled: true,
      transposeProbabilityPercent: 53,
      transposeMode: "stairStep",
      transposeIntervals: "+7 -5 +12",
      transposeDriveChain: true,
    },
    channelHocket: {
      open: true,
      enabled: true,
      outputChannel: 12,
      order: "second",
      channels: [2, 5, 9],
      weights: { "second:2>5:9": 8 },
      fallback: 5,
      fallbackWeights: { "2": 3, "5": 6 },
      entryWeights: { "second:2>5": 4 },
      seed: 8181 + offset,
      seedBehavior: "history",
      historySeeds: ["17", "18", String(19 + offset)],
      historyWeight: 6,
      newSeedWeight: 2,
      maxHistory: 18,
      newSeedChance: 54,
      holdChance: 64,
      blendCycles: 14,
      ratchetMode: "perRatchetHit",
      wholeProbabilityPercent: 37,
      perHitProbabilityPercent: 72,
      preserveFirstHit: false,
      ornamentMode: "perGraceNote",
      ornamentWholeProbabilityPercent: 39,
      ornamentPerGraceProbabilityPercent: 74,
      accentRules: [
        {
          label: `${label} strong`,
          enabled: true,
          minVelocity: 96,
          maxVelocity: 127,
          probabilityPercent: 82,
          mode: "driveChain",
          weights: { "2": 5, "5": 3 },
        },
      ],
      positionRules: [
        {
          id: `${label}-beat-two`,
          label: `${label} beat two`,
          enabled: true,
          scope: "beat",
          nth: 2,
          actionWeights: {
            normalMarkov: 1,
            renderOnly: 4,
            resetMarkov: 2,
          },
          renderWeights: { "2": 6, "5": 3 },
          resetMode: "customWeighted",
          resetWeights: { "5": 8 },
        },
      ],
      assignMode: "euclid",
      euclid: {
        placement: "partition",
        steps: 12,
        layers: [
          { channel: 2, pulses: 5, rotation: 2, maxRun: 2, steps: 16, invert: false },
          { channel: 5, pulses: 3, rotation: 0, maxRun: 1, steps: 6, invert: true },
        ],
        reset: "section",
        spanAccentMode: "bypass",
        spanAccentChannel: 9,
      },
    },
    setup: {
      open: true,
      tab: "files",
      autosaveEnabled: false,
      autosaveIntervalMs: 12_000,
      autoloadRecentSession: false,
    },
    ui: {
      synthPropertiesOpen: true,
      midiDebugOpen: true,
      midiDebugLimit: 250,
      automationDebugOpen: true,
      automationDebugLimit: 500,
      seedSetupOpen: true,
      seedSetupTab: "log",
      seedLogScope: "paths",
      automationOpen: true,
      timelineAutomationTargetIds: [
        "sequencer.velocity",
        `sequencer.boundary.${label}-boundary-3.probability`,
      ],
      channelLogicHelpOpen: true,
    },
    seedPaths: makeSeedPaths(label),
    scoreSnapshot: { currentScoreId: `${label}-score`, rendered: true },
  };
}

function makeTrack(
  id: string,
  flat: SequencerPatchFlatState,
  mode: "global" | "custom"
): ParallelTrackPatch {
  return {
    id,
    name: `${flat.sequencer.name} track`,
    color: id === "track-active" ? "#3f7f9f" : "#9f5f3f",
    muted: id === "track-muted",
    soloed: id === "track-active",
    tempoMode: mode,
    customTempoBpm: flat.transport.tempoBpm,
    cycleLengthMode: mode,
    customCycleBeats: flat.sequencer.cycleBeats,
    sequencer: flat.sequencer,
    generatorEnabled: flat.generatorEnabled,
    generator: flat.generator,
    automation: flat.automation,
    rhythm: flat.rhythm,
    pitchShaper: flat.pitchShaper,
    channelHocket: flat.channelHocket,
    seedPaths: flat.seedPaths,
    scoreSnapshot: flat.scoreSnapshot,
    mode: "parallel",
    trigger: null,
  };
}

function makeProjectFixture(): SequencerPatchDocument {
  const staleFlat = makeFlatState("stale-top-level", 0);
  const activeFlat = makeFlatState("active", 2);
  const inactiveFlat = makeFlatState("inactive", 5);
  const project: ParallelProjectPatch = {
    activeTrackId: "track-active",
    global: {
      tempoBpm: 118,
      cycleBeats: 8,
      channelConflictPolicy: "priorityOrder",
      channelLogicMatrix: [
        {
          trackAId: "track-active",
          trackBId: "track-muted",
          outputChannel: 5,
          policy: "forceOff",
        },
      ],
      conflictPriority: ["track-active", "track-muted"],
      trackFlowBoxes: [],
      synthEnabled: false,
      synthPrograms: makeSynthPrograms(11),
      rhythmPlaybackEnabled: true,
      cycleTempoFlux: activeFlat.transport.cycleTempoFlux,
    },
    tracks: [
      makeTrack("track-muted", inactiveFlat, "global"),
      makeTrack("track-active", activeFlat, "custom"),
    ],
  };
  return {
    ...staleFlat,
    schemaVersion: PATCH_SCHEMA_VERSION,
    project,
  };
}

describe("patchIo", () => {
  it("caps persisted stopped-preview cycles before they can reach IPC", () => {
    const raw = JSON.parse(JSON.stringify(createNeutralPatchDocument()));
    raw.sequencer.userPreviewCycle = Number.MAX_SAFE_INTEGER;
    raw.project.tracks[0].sequencer.userPreviewCycle = Number.MAX_SAFE_INTEGER;

    const loaded = readPatchDocument(raw);

    expect(loaded.sequencer.userPreviewCycle).toBe(MAX_STOPPED_PREVIEW_CYCLE);
    expect(loaded.project.tracks[0]!.sequencer.userPreviewCycle).toBe(
      MAX_STOPPED_PREVIEW_CYCLE
    );
  });

  it("normalizes full v3 project patches idempotently without dropping scoped fields", () => {
    const fixture = makeProjectFixture();
    const once = readPatchDocument(fixture);
    const twice = readPatchDocument(once);

    expect(twice).toEqual(once);
    // Strict deep-equality for the two newest rhythm sections against the
    // AUTHORED fixture values: idempotence alone would pass a normalizer that
    // silently rewrote or dropped lock/shape fields on first read
    // (docs/TEST_COVERAGE_PLAN_2026-07.md Phase 2.4). A v3 document's flat
    // state derives from the ACTIVE project track (the fixture's flat section
    // is deliberately stale), so the authored source of truth is that track's
    // entry — and the derived flat must match it exactly.
    const authoredActive = fixture.project.tracks.find(
      (track) => track.id === fixture.project.activeTrackId
    );
    expect(once.rhythm.beatLocks).toEqual(authoredActive?.rhythm.beatLocks);
    expect(once.rhythm.shapeGroups).toEqual(authoredActive?.rhythm.shapeGroups);
    const normalizedActive = once.project.tracks.find(
      (track) => track.id === once.project.activeTrackId
    );
    expect(normalizedActive?.rhythm.beatLocks).toEqual(once.rhythm.beatLocks);
    expect(normalizedActive?.rhythm.shapeGroups).toEqual(once.rhythm.shapeGroups);
    expect(once.schemaVersion).toBe(PATCH_SCHEMA_VERSION);
    expect(once.sequencer.name).toBe("active sequencer");
    expect(once.transport.tempoBpm).toBe(126.5);
    expect(once.transport.cycleTempoFlux.curve.choices).toHaveLength(1);
    expect(once.sequencer.initialCustomSubdivision?.partCountWeights).toEqual([
      { count: 5, weight: 3 },
      { count: 8, weight: 4 },
    ]);
    expect(once.sequencer.boundaries[0]?.customSubdivision?.partGatiWeights).toEqual([
      { subdivision: 5, weight: 6 },
      { subdivision: 7, weight: 2 },
    ]);
    expect(once.sequencer.accent.jathiMode).toBe("layered");
    expect(once.automation.tracks[0]?.curves[0]?.points[0]?.outCurve).toEqual({
      kind: "easeInOut",
      amount: 0.4,
    });
    expect(once.automation.markers[0]).toEqual({
      id: "active-marker",
      time: { numer: 3, denom: 8 },
      label: "active cue",
    });
    expect(once.automation.tracks[0]?.curves[0]?.points[1]?.anchorId).toBe(
      "active-marker"
    );
    expect(once.rhythm.articulation.blend).toEqual({
      mode: "weighted",
      manualWeight: 2,
      fragmentWeight: 3,
      sectionWeight: 4,
      cycleWeight: 5,
    });
    expect(once.rhythm.articulation.seedPolicy).toEqual({
      seed: 4_244,
      followRhythmChance: 37,
    });
    expect(once.rhythm.arbitrarySubdivision.poolWeightsByLength[7]).toEqual({
      "3-4": 2,
    });
    expect(once.rhythm.speedSubdivisionWeights["gati:7:thirdSpeed"]).toBe(4);
    expect(once.rhythm.ratchet.spec.timeCurve?.choices[0]?.id).toBe("sweep");
    expect(once.rhythm.ornament.spec.delay.enabled).toBe(true);
    expect(once.rhythm.playbackChains[0]?.transitions).toEqual([
      { from: [0, 1], to: 0, weight: 7 },
    ]);
    expect(once.rhythm.resolvedSeed).toEqual({
      seed: "4569",
      source: "history",
      history: ["12", "34", "58"],
    });
    expect(once.pitchShaper.graceTransposeIntervals).toEqual([
      { semitones: 1, weight: 2 },
      { semitones: 2, weight: 4 },
    ]);
    expect(once.channelHocket.accentRules[0]).toEqual({
      label: "active strong",
      enabled: true,
      minVelocity: 96,
      maxVelocity: 127,
      probabilityPercent: 82,
      mode: "driveChain",
      weights: { "2": 5, "5": 3 },
    });
    expect(once.channelHocket.assignMode).toBe("euclid");
    expect(once.channelHocket.euclid).toEqual({
      placement: "partition",
      steps: 12,
      layers: [
        { channel: 2, pulses: 5, rotation: 2, maxRun: 2, steps: 16, invert: false },
        { channel: 5, pulses: 3, rotation: 0, maxRun: 1, steps: 6, invert: true },
      ],
      reset: "section",
      spanAccentMode: "bypass",
      spanAccentChannel: 9,
    });
    expect(once.channelHocket.positionRules[0]).toEqual({
      id: "active-beat-two",
      label: "active beat two",
      enabled: true,
      scope: "beat",
      nth: 2,
      actionWeights: { normalMarkov: 1, renderOnly: 4, resetMarkov: 2 },
      renderWeights: { "2": 6, "5": 3 },
      resetMode: "customWeighted",
      resetWeights: { "5": 8 },
    });
    expect(once.setup.autosaveEnabled).toBe(false);
    expect(once.ui.timelineAutomationTargetIds).toContain("sequencer.velocity");
    expect(once.seedPaths[0]?.trace[0]?.trackId).toBe("active-track");
    expect(once.scoreSnapshot).toEqual({
      currentScoreId: "active-score",
      rendered: true,
    });
  });

  it("flattens active project state and writes it back stably", () => {
    const fixture = makeProjectFixture();
    const flattened = flattenProjectPatchForActiveTrack(
      fixture as unknown as Record<string, unknown>
    );

    expect((flattened.sequencer as { name?: string }).name).toBe("active sequencer");
    expect((flattened.transport as { tempoBpm?: number }).tempoBpm).toBe(126.5);

    const loaded = readPatchDocument(fixture);
    const rewritten = withProjectState(loaded, loaded.project);
    const flattenedAgain = readPatchDocument(rewritten);

    expect(flattenedAgain).toEqual(loaded);
  });

  it("preserves non-active track scoped state through project normalization", () => {
    const loaded = readPatchDocument(makeProjectFixture());
    const inactive = loaded.project.tracks.find((track) => track.id === "track-muted");

    expect(inactive).toBeDefined();
    expect(inactive?.sequencer.name).toBe("inactive sequencer");
    expect(inactive?.rhythm.passageInput).toBe("4 2 1 3 2 5");
    expect(inactive?.rhythm.resolvedSeed?.seed).toBe("4572");
    expect(inactive?.pitchShaper.seed).toBe(3136);
    expect(inactive?.channelHocket.seed).toBe(8186);
    expect(inactive?.automation.tracks[0]?.target).toBe(
      "sequencer.boundary.inactive.probability"
    );
    expect(inactive?.seedPaths[0]?.trace[0]?.trackId).toBe("inactive-track");
    expect(inactive?.scoreSnapshot).toEqual({
      currentScoreId: "inactive-score",
      rendered: true,
    });
  });

  it("accepts only the fork-owned v1 patch schema", () => {
    expect(readPatchDocument(makeProjectFixture()).schemaVersion).toBe(1);
    for (const rejected of [0, 2, 7, 8]) {
      expect(() =>
        readPatchDocument({ ...makeProjectFixture(), schemaVersion: rejected })
      ).toThrow(`Unsupported patch schema: ${rejected}`);
    }
  });

  it("disables an unknown generator kind and returns a load warning", () => {
    const raw = makeProjectFixture() as unknown as Record<string, unknown>;
    const project = raw.project as { tracks: Array<Record<string, unknown>> };
    const target = project.tracks.find((track) => track.id === "track-active")!;
    target.generatorEnabled = true;
    target.generator = { kind: "future-generator", densityPercent: 88 };

    const loaded = readPatchDocument(raw);
    const active = loaded.project.tracks.find(
      (track) => track.id === loaded.project.activeTrackId
    )!;
    expect(active.generatorEnabled).toBe(false);
    expect(active.generator).toMatchObject({ kind: "example", densityPercent: 100 });
    expect(loaded.loadWarnings).toEqual([
      "Unknown generator kind was disabled and reset to Example.",
    ]);
  });

  it("persists a dumka generator verbatim and keeps it enabled", () => {
    const pattern = "[dum@3  ka] | [. ka]  [dum ka dum ka dum]@2  # keep";
    const raw = makeProjectFixture() as unknown as Record<string, unknown>;
    const project = raw.project as { tracks: Array<Record<string, unknown>> };
    const target = project.tracks.find((track) => track.id === "track-active")!;
    target.generatorEnabled = true;
    target.generator = {
      kind: "dumka",
      pattern,
      evolutionRate: 40,
      driftLeash: 60,
      seedMode: { type: "perCycle", seed: 17 },
    };

    const loaded = readPatchDocument(raw);
    const active = loaded.project.tracks.find(
      (track) => track.id === loaded.project.activeTrackId
    )!;
    expect(active.generatorEnabled).toBe(true);
    expect(active.generator).toEqual({
      kind: "dumka",
      pattern,
      evolutionRate: 40,
      driftLeash: 60,
      barlowTemperature: 0,
      weightBarlowRemove: 3,
      weightBarlowAdd: 3,
      weightRotate: 2,
      weightSyncopate: 0,
      weightDesyncopate: 0,
      weightFragment: 0,
      weightConsolidate: 0,
      fillComplexity: 0,
      weightEuclid: 0,
      euclidMaxRun: 1,
      euclidInvert: 0,
      euclidRestPolicy: "tied",
      plan: [],
      planLengthCycles: 0,
      seedMode: { type: "perCycle", seed: 17 },
    });
    expect(loaded.loadWarnings ?? []).toEqual([]);

    const reloaded = readPatchDocument(
      JSON.parse(JSON.stringify(loaded)) as Record<string, unknown>
    );
    const again = reloaded.project.tracks.find(
      (track) => track.id === reloaded.project.activeTrackId
    )!;
    expect(again.generator).toEqual(active.generator);
  });

  it("rounds fractional generator knobs to engine-accepted integers", () => {
    // The engine's serde boundary rejects fractional or negative u32 values
    // outright, so normalization must land on integers the wire accepts.
    expect(
      normalizePatchGeneratorConfig({
        kind: "dumka",
        pattern: "x . x .",
        evolutionRate: 0.5,
        driftLeash: 99.4,
      })
    ).toMatchObject({ evolutionRate: 1, driftLeash: 99 });
    expect(
      normalizePatchGeneratorConfig({
        kind: "dumka",
        pattern: "x . x .",
        evolutionRate: -3,
        driftLeash: 250,
      })
    ).toMatchObject({ evolutionRate: 0, driftLeash: 100 });
    expect(
      normalizePatchGeneratorConfig({ kind: "example", densityPercent: 59.5 })
    ).toMatchObject({ densityPercent: 60 });
    expect(
      normalizePatchGeneratorConfig({ kind: "dumka", planLengthCycles: -3 })
    ).toMatchObject({ planLengthCycles: 0 });
    expect(
      normalizePatchGeneratorConfig({
        kind: "dumka",
        planLengthCycles: Number.MAX_SAFE_INTEGER,
      })
    ).toMatchObject({ planLengthCycles: 0xffffffff });
  });

  it("normalizes evolution plans without changing stable directive identities", () => {
    const normalized = normalizePatchEvolutionPlan([
      {
        id: 41,
        order: 8,
        enabled: true,
        fromCycle: 13,
        toCycle: 13,
        family: "barlowRemove",
        intensity: 15.6,
        scope: null,
        options: { barlowTemperature: 250, rotateDirection: "later" },
      },
      {
        id: 7,
        order: 2,
        enabled: true,
        fromCycle: 5,
        toCycle: 9,
        family: "syncopate",
        intensity: 32,
        scope: { startBeat: 2, lenBeats: 2 },
      },
      {
        id: 7,
        order: 20,
        enabled: false,
        fromCycle: 1,
        toCycle: 1,
        family: "rotate",
        intensity: -5,
      },
    ]);

    expect(normalized).toMatchObject({
      droppedUnknownFamilies: 0,
      droppedOverlaps: 0,
      plan: [
        { id: 7, order: 0, family: "syncopate", intensity: 32 },
        {
          id: 41,
          order: 1,
          family: "barlowRemove",
          intensity: 16,
          options: { barlowTemperature: 100, rotateDirection: "later" },
        },
        { id: 42, order: 2, family: "rotate", enabled: false, intensity: 0 },
      ],
    });
    expect(normalizePatchEvolutionPlan(normalized.plan).plan).toEqual(normalized.plan);
  });

  it("defaults legacy directive pacing and drops invalid or unsmoothable pacing", () => {
    const normalized = normalizePatchEvolutionPlan([
      {
        id: 1,
        order: 0,
        enabled: true,
        fromCycle: 1,
        toCycle: 4,
        family: "barlowRemove",
        intensity: 25,
        // Legacy row: pacing was absent before gradual evolution shipped.
      },
      {
        id: 2,
        order: 1,
        enabled: true,
        fromCycle: 5,
        toCycle: 8,
        family: "barlowAdd",
        pacing: "linear",
        intensity: 25,
      },
      {
        id: 3,
        order: 2,
        enabled: true,
        fromCycle: 9,
        toCycle: 12,
        family: "rotate",
        pacing: "easeInOut",
        intensity: 25,
      },
      {
        id: 4,
        order: 3,
        enabled: true,
        fromCycle: 13,
        toCycle: 16,
        family: "fragment",
        pacing: "futureCurve",
        intensity: 25,
      },
      {
        id: 5,
        order: 4,
        enabled: true,
        fromCycle: 17,
        toCycle: 20,
        family: "stochastic",
        pacing: "linear",
        intensity: 25,
      },
    ]);

    expect(normalized.droppedMalformed).toBe(2);
    expect(normalized.plan.map((directive) => directive.pacing)).toEqual([
      "perCycle",
      "linear",
      "easeInOut",
    ]);
    expect(normalizePatchEvolutionPlan(normalized.plan).plan).toEqual(normalized.plan);
  });

  it("repairs unsafe directive ids without aliasing a valid stable identity", () => {
    const normalized = normalizePatchEvolutionPlan([
      {
        id: Number.MAX_SAFE_INTEGER,
        order: 0,
        enabled: true,
        fromCycle: 1,
        toCycle: 1,
        family: "barlowRemove",
        intensity: 25,
      },
      {
        id: Number.MAX_SAFE_INTEGER + 1,
        order: 1,
        enabled: true,
        fromCycle: 2,
        toCycle: 2,
        family: "barlowAdd",
        intensity: 25,
      },
    ]);

    expect(normalized.plan.map((directive) => directive.id)).toEqual([
      Number.MAX_SAFE_INTEGER,
      1,
    ]);
    expect(normalized.plan.every((directive) => Number.isSafeInteger(directive.id))).toBe(
      true
    );
  });

  it("caps persisted evolution plans at the engine's directive ceiling", () => {
    const rows = Array.from(
      { length: MAX_EVOLUTION_DIRECTIVES + 44 },
      (_, index) => ({
        id: index + 1,
        order: index,
        enabled: true,
        fromCycle: index + 1,
        toCycle: index + 1,
        family: "rotate",
        intensity: 25,
      })
    );
    const normalized = normalizePatchEvolutionPlan(rows);

    expect(normalized.plan).toHaveLength(MAX_EVOLUTION_DIRECTIVES);
    expect(normalized.droppedExcess).toBe(44);
    expect(normalized.plan.at(-1)).toMatchObject({
      id: MAX_EVOLUTION_DIRECTIVES,
      order: MAX_EVOLUTION_DIRECTIVES - 1,
    });

    const persisted = normalizePatchGeneratorConfig({ kind: "dumka", plan: rows });
    expect(persisted.kind).toBe("dumka");
    if (persisted.kind === "dumka") {
      expect(persisted.plan).toHaveLength(MAX_EVOLUTION_DIRECTIVES);
    }
  });

  it("is a fixed point across patch and Evolve editor normalization", () => {
    const persisted = normalizePatchGeneratorConfig({
      kind: "dumka",
      pattern: "x . x .",
      planLengthCycles: 24,
      plan: [
        {
          id: 41,
          order: 8,
          enabled: true,
          fromCycle: 13,
          toCycle: 13,
          family: "barlowRemove",
          intensity: 15,
          options: { barlowTemperature: 0 },
        },
        {
          id: 7,
          order: 2,
          enabled: true,
          fromCycle: 5,
          toCycle: 9,
          family: "syncopate",
          intensity: 32,
          scope: { startBeat: 2, lenBeats: 2 },
        },
      ],
    });
    if (persisted.kind !== "dumka") throw new Error("expected Dum-Ka config");
    const throughEditor = normalizeEvolutionPlan(persisted.plan);
    expect(
      normalizePatchGeneratorConfig({ ...persisted, plan: throughEditor })
    ).toEqual(persisted);
  });

  it("drops unknown families and later same-family overlaps with warnings", () => {
    const raw = makeProjectFixture() as unknown as Record<string, unknown>;
    const project = raw.project as { tracks: Array<Record<string, unknown>> };
    const target = project.tracks.find((track) => track.id === "track-active")!;
    target.generator = {
      kind: "dumka",
      pattern: "x . x .",
      plan: [
        {
          id: 1,
          order: 0,
          enabled: true,
          fromCycle: 3,
          toCycle: 5,
          family: "fragment",
          intensity: 20,
        },
        {
          id: 2,
          order: 1,
          enabled: false,
          fromCycle: 5,
          toCycle: 7,
          family: "fragment",
          intensity: 20,
        },
        {
          id: 3,
          order: 2,
          enabled: true,
          fromCycle: 9,
          toCycle: 9,
          family: "futureFamily",
          intensity: 20,
        },
        {
          id: 4,
          order: 3,
          enabled: true,
          fromCycle: 10,
          toCycle: 12,
          family: "barlowAdd",
          pacing: "futureCurve",
          intensity: 20,
        },
      ],
    };

    const loaded = readPatchDocument(raw);
    const active = loaded.project.tracks.find(
      (track) => track.id === loaded.project.activeTrackId
    )!;
    expect(active.generator).toMatchObject({
      kind: "dumka",
      plan: [{ id: 1, order: 0, family: "fragment" }],
    });
    expect(loaded.loadWarnings).toEqual([
      "Unknown Dum-Ka evolution operator families were dropped.",
      "Overlapping Dum-Ka evolution directives were dropped.",
      "Malformed Dum-Ka evolution directives were dropped.",
    ]);
  });

  it("guards malformed dumka patterns to the default without rewriting valid text", () => {
    expect(
      normalizePatchGeneratorConfig({ kind: "dumka", pattern: "  x .  x . " })
    ).toEqual({
      kind: "dumka",
      pattern: "  x .  x . ",
      evolutionRate: 0,
      driftLeash: 25,
      barlowTemperature: 0,
      weightBarlowRemove: 3,
      weightBarlowAdd: 3,
      weightRotate: 2,
      weightSyncopate: 0,
      weightDesyncopate: 0,
      weightFragment: 0,
      weightConsolidate: 0,
      fillComplexity: 0,
      weightEuclid: 0,
      euclidMaxRun: 1,
      euclidInvert: 0,
      euclidRestPolicy: "tied",
      plan: [],
      planLengthCycles: 0,
      seedMode: { type: "locked", seed: FALLBACK_GLOBAL_SEED },
    });
    expect(
      normalizePatchGeneratorConfig({
        kind: "dumka",
        pattern: "x",
        evolutionRate: 250,
        driftLeash: -5,
      })
    ).toMatchObject({ evolutionRate: 100, driftLeash: 0 });
    for (const bad of [undefined, 7, "", "x".repeat(4097)]) {
      expect(
        normalizePatchGeneratorConfig({ kind: "dumka", pattern: bad })
      ).toMatchObject({ kind: "dumka", pattern: DEFAULT_DUMKA_PATTERN });
    }
  });

  it("writes the fork-owned v1 shape and is save-load-save idempotent", () => {
    const loaded = readPatchDocument(makeProjectFixture());
    const first = JSON.parse(JSON.stringify(loaded));

    expect(first).toMatchObject({
      app: "Dum-Ka",
      schemaVersion: 1,
      sequencer: {
        name: "active sequencer",
        basePitch: loaded.sequencer.pitch,
        initialSubdivision: 7,
      },
      generator: { kind: "example" },
      project: { tracks: expect.any(Array) },
    });
    expect(first.sequencer).not.toHaveProperty("randomize");
    expect(first.sequencer).not.toHaveProperty("generator");
    expect(first.sequencer).not.toHaveProperty("initialJathiBhedam");
    expect(first.sequencer).not.toHaveProperty("newSeedChance");
    expect(first.sequencer).not.toHaveProperty("holdChance");
    expect(first.sequencer).not.toHaveProperty("blendCycles");
    expect(first).not.toHaveProperty("rhythm");
    expect(first).not.toHaveProperty("pitchShaper");
    expect(first).not.toHaveProperty("scoreSnapshot");
    expect(first.channelHocket).not.toHaveProperty("ratchetMode");
    expect(first.channelHocket).not.toHaveProperty("ornamentMode");
    expect(first.channelHocket).not.toHaveProperty("newSeedChance");
    expect(first.channelHocket).not.toHaveProperty("holdChance");
    expect(first.channelHocket).not.toHaveProperty("blendCycles");
    expect(first.project.tracks[0]).not.toHaveProperty("rhythm");
    expect(first.project.tracks[0]).not.toHaveProperty("pitchShaper");
    expect(first.project.tracks[0].sequencer).not.toHaveProperty("newSeedChance");
    expect(first.project.tracks[0].channelHocket).not.toHaveProperty(
      "blendCycles"
    );

    const second = JSON.parse(
      JSON.stringify(readPatchDocument(JSON.parse(JSON.stringify(first))))
    );
    expect(second).toEqual(first);
  });

  it("filters removed drift and morph channel modes from the v1 disk shape", () => {
    const document = readPatchDocument(makeProjectFixture());
    document.channelHocket.seedBehavior = "drift";
    document.project.tracks[0]!.channelHocket.seedBehavior = "morph";

    const persisted = JSON.parse(JSON.stringify(document));
    expect(persisted.channelHocket.seedBehavior).toBe("followGlobal");
    expect(persisted.project.tracks[0].channelHocket.seedBehavior).toBe(
      "followGlobal"
    );
  });

  it("defaults and clamps an absent articulation seed policy", () => {
    const sparse = makeFlatState("articulation-seed-default", 1);
    delete (sparse.rhythm.articulation as unknown as Record<string, unknown>)
      .seedPolicy;

    expect(readPatchDocument(sparse).rhythm.articulation.seedPolicy).toEqual({
      seed: 0,
      followRhythmChance: 100,
    });
    expect(
      normalizeRhythmArticulationSeedPolicy({
        seed: -20,
        followRhythmChance: 160.8,
      })
    ).toEqual({ seed: 0, followRhythmChance: 100 });
    expect(
      normalizeRhythmArticulationSeedPolicy({
        seed: 8.7,
        followRhythmChance: -2,
      })
    ).toEqual({ seed: 9, followRhythmChance: 0 });
    expect(
      normalizeRhythmArticulationSeedPolicy({
        seed: Number.MAX_VALUE,
        followRhythmChance: 50,
      })
    ).toEqual({
      seed: Number.MAX_SAFE_INTEGER,
      followRhythmChance: 50,
    });
  });

  it("accepts articulation as a seed-path wildcard domain", () => {
    expect(normalizeSeedPathWildcardDomain("articulation")).toBe(
      "articulation"
    );
  });

  it("round-trips full-width u64 seed paths as exact decimal strings", () => {
    const fullWidthSeed = "16602156551234156693";
    const flat = makeFlatState("u64-seed-path", 0);
    const trace = flat.seedPaths[0]!.trace[0]!;
    trace.seed = fullWidthSeed;
    trace.baseSeed = fullWidthSeed;
    trace.historyBefore = [fullWidthSeed, "7"];
    trace.historyAfter = ["7", fullWidthSeed];

    const serialized = JSON.stringify({
      ...flat,
      schemaVersion: PATCH_SCHEMA_VERSION,
    });
    const loaded = readPatchDocument(JSON.parse(serialized));
    const loadedTrace = loaded.seedPaths[0]!.trace[0]!;

    expect(loadedTrace).toMatchObject({
      seed: fullWidthSeed,
      baseSeed: fullWidthSeed,
      historyBefore: [fullWidthSeed, "7"],
      historyAfter: ["7", fullWidthSeed],
    });
    expect(JSON.parse(JSON.stringify(loaded)).seedPaths[0].trace[0]).toMatchObject({
      seed: fullWidthSeed,
      baseSeed: fullWidthSeed,
      historyBefore: [fullWidthSeed, "7"],
      historyAfter: ["7", fullWidthSeed],
    });
  });

  it("accepts legacy numeric trace seeds but emits canonical decimal strings", () => {
    expect(normalizeU64SeedDecimal("00042")).toBe("42");
    expect(normalizeU64SeedDecimal("18446744073709551615")).toBe(
      "18446744073709551615"
    );
    expect(normalizeU64SeedDecimal("18446744073709551616")).toBeNull();
    expect(
      normalizeSeedPathTracePoint({
        cycle: 0,
        domain: "rhythm",
        label: "legacy",
        seed: 123,
        baseSeed: 7,
        source: "locked",
        historyBefore: [1, 2],
        historyAfter: [2, 123],
      })
    ).toMatchObject({
      seed: "123",
      baseSeed: "7",
      historyBefore: ["1", "2"],
      historyAfter: ["2", "123"],
    });
  });

  it("canonicalizes legacy numeric history pools and resolved rhythm seeds", () => {
    const legacy = makeFlatState("legacy-history-numbers", 0);
    (legacy.sequencer as unknown as Record<string, unknown>).historySeeds = [7, 8];
    (legacy.rhythm as unknown as Record<string, unknown>).historySeeds = [9, 10];
    (legacy.pitchShaper as unknown as Record<string, unknown>).historySeeds = [11];
    (legacy.channelHocket as unknown as Record<string, unknown>).historySeeds = [12];
    (legacy.rhythm as unknown as Record<string, unknown>).resolvedSeed = {
      seed: 13,
      source: "history",
      history: [7, 13],
    };

    const loaded = readPatchDocument(legacy);
    expect(loaded.sequencer.historySeeds).toEqual(["7", "8"]);
    expect(loaded.rhythm.historySeeds).toEqual(["9", "10"]);
    expect(loaded.pitchShaper.historySeeds).toEqual(["11"]);
    expect(loaded.channelHocket.historySeeds).toEqual(["12"]);
    expect(loaded.rhythm.resolvedSeed).toEqual({
      seed: "13",
      source: "history",
      history: ["7", "13"],
    });
  });

  it("normalizes removed drift mode to PerCycle while tolerating compatibility fields", () => {
    const flat = makeFlatState("drift", 1);
    flat.sequencer.seedMode = "drift";
    flat.sequencer.newSeedChance = 5;
    flat.rhythm.rhythmSeedBehavior = "drift";
    flat.rhythm.newSeedChance = 25;
    flat.pitchShaper.seedBehavior = "drift";
    flat.pitchShaper.newSeedChance = 45;
    flat.channelHocket.seedBehavior = "drift";
    flat.channelHocket.newSeedChance = 65;

    const loaded = readPatchDocument(flat);
    expect(loaded.sequencer.seedMode).toBe("perCycle");
    expect(loaded.sequencer.newSeedChance).toBe(5);
    expect(loaded.rhythm.rhythmSeedBehavior).toBe("drift");
    expect(loaded.rhythm.newSeedChance).toBe(25);
    expect(loaded.pitchShaper.seedBehavior).toBe("drift");
    expect(loaded.pitchShaper.newSeedChance).toBe(45);
    expect(loaded.channelHocket.seedBehavior).toBe("drift");
    expect(loaded.channelHocket.newSeedChance).toBe(65);
  });

  it("defaults an absent drift chance and clamps out-of-range values on load", () => {
    const flat = makeFlatState("drift-normalize", 1);
    delete (flat.sequencer as unknown as Record<string, unknown>).newSeedChance;
    (flat.rhythm as unknown as Record<string, unknown>).newSeedChance = 250;
    (flat.pitchShaper as unknown as Record<string, unknown>).newSeedChance = -30;
    (flat.channelHocket as unknown as Record<string, unknown>).newSeedChance =
      "nonsense";

    const loaded = readPatchDocument(flat);
    expect(loaded.sequencer.newSeedChance).toBe(15);
    expect(loaded.rhythm.newSeedChance).toBe(100);
    expect(loaded.pitchShaper.newSeedChance).toBe(0);
    expect(loaded.channelHocket.newSeedChance).toBe(15);
  });

  it("normalizes removed morph mode to PerCycle while tolerating compatibility fields", () => {
    const flat = makeFlatState("morph", 1);
    flat.sequencer.seedMode = "morph";
    flat.sequencer.holdChance = 55;
    flat.sequencer.blendCycles = 20;
    flat.rhythm.rhythmSeedBehavior = "morph";
    flat.pitchShaper.seedBehavior = "morph";
    flat.channelHocket.seedBehavior = "morph";

    const loaded = readPatchDocument(flat);
    expect(loaded.sequencer.seedMode).toBe("perCycle");
    expect(loaded.sequencer.holdChance).toBe(55);
    expect(loaded.sequencer.blendCycles).toBe(20);
    expect(loaded.rhythm.rhythmSeedBehavior).toBe("morph");
    expect(loaded.pitchShaper.seedBehavior).toBe("morph");
    expect(loaded.channelHocket.seedBehavior).toBe("morph");
  });

  it("defaults absent morph params and clamps blend cycles into 1-64 on load", () => {
    const flat = makeFlatState("morph-normalize", 1);
    delete (flat.sequencer as unknown as Record<string, unknown>).holdChance;
    delete (flat.sequencer as unknown as Record<string, unknown>).blendCycles;
    (flat.rhythm as unknown as Record<string, unknown>).holdChance = 250;
    (flat.rhythm as unknown as Record<string, unknown>).blendCycles = 0;
    (flat.pitchShaper as unknown as Record<string, unknown>).blendCycles = 900;

    const loaded = readPatchDocument(flat);
    expect(loaded.sequencer.holdChance).toBe(50);
    expect(loaded.sequencer.blendCycles).toBe(16);
    expect(loaded.rhythm.holdChance).toBe(100);
    expect(loaded.rhythm.blendCycles).toBe(1);
    expect(loaded.pitchShaper.blendCycles).toBe(64);
  });

  it("normalizes removed rhythm tabs to the default patterns tab", () => {
    expect(normalizeRhythmTab("flux")).toBe("patterns");
  });

  it("keeps custom subdivision save/load drop gates symmetric", () => {
    const purePerBeat = purePerBeatCustom();
    const loadedPure = normalizeCustomSubdivisionFromPatch(purePerBeat);

    expect(cleanCustomSubdivision(purePerBeat)).toEqual(purePerBeat);
    expect(loadedPure).toMatchObject({
      perBeatWeight: 1,
      equalPartsWeight: 0,
      partCountWeights: [],
      partGatiWeights: [],
    });

    const equalParts = equalPartsCustom();
    expect(cleanCustomSubdivision(equalParts)).toMatchObject({
      equalPartsWeight: 5,
      partCountWeights: [
        { count: 5, weight: 3 },
        { count: 8, weight: 4 },
      ],
      partGatiWeights: [
        { subdivision: 5, weight: 6 },
        { subdivision: 7, weight: 2 },
      ],
    });
    expect(normalizeCustomSubdivisionFromPatch(equalParts)).toMatchObject({
      equalPartsWeight: 5,
      partCountWeights: [
        { count: 5, weight: 3 },
        { count: 8, weight: 4 },
      ],
      partGatiWeights: [
        { subdivision: 5, weight: 6 },
        { subdivision: 7, weight: 2 },
      ],
    });

    const invalidEqualParts: CustomSubdivision = {
      perBeatWeight: 0,
      equalPartsWeight: 1,
      partCountWeights: [{ count: 5, weight: 0 }],
      partGatiWeights: [{ subdivision: 5, weight: 3 }],
      divisions: [],
      jathiWeights: [],
    };
    expect(cleanCustomSubdivision(invalidEqualParts)).toBeNull();
    expect(normalizeCustomSubdivisionFromPatch(invalidEqualParts)).toBeNull();

    const legacyRaw = {
      perBeatWeight: 0,
      equalPartsWeight: 1,
      divisions: legacyDivisionsCustom().divisions,
      jathiWeights: [],
    };
    const legacyLoaded = normalizeCustomSubdivisionFromPatch(legacyRaw);
    expect(legacyLoaded).toMatchObject({
      equalPartsWeight: 1,
      partCountWeights: [{ count: 2, weight: 1 }],
      partGatiWeights: [{ subdivision: 5, weight: 2 }],
      divisions: [
        { gatiWeights: [{ subdivision: 5, weight: 2 }] },
        { gatiWeights: [{ subdivision: 7, weight: 3 }] },
      ],
    });
  });
});

describe("jathi bhedam patch normalization", () => {
  it("returns null for absent / non-object input (back-compat)", () => {
    expect(normalizeJathiBhedamFromPatch(undefined)).toBeNull();
    expect(normalizeJathiBhedamFromPatch(null)).toBeNull();
    expect(normalizeJathiBhedamFromPatch(42)).toBeNull();
  });

  it("normalizes + clamps a populated selection and round-trips via clone", () => {
    const sel = normalizeJathiBhedamFromPatch({
      enabled: true,
      baseWeight: 3,
      gatiWeights: [{ gati: 4, weight: 2 }],
      lengthBias: { thresholdBeats: 8, shorterMult: 2, longerMult: 0.5 },
      cyclePositionBias: {
        startFraction: 0.25,
        startMult: 4,
        endFraction: 0.25,
        endMult: 0.25,
      },
      spec: {
        gati: 4,
        beatsPerCycle: 8,
        cycles: 1,
        seedNumbers: [7, 4, 5, 3, 3, 1, 5],
        fragments: [{ start: 0, end: 3 }],
        phrasing: { type: "notesPerCell", notes: 2 },
        schedule: {
          opsPerGeneration: 2,
          menu: [{ op: "split", weight: 2 }],
        },
        mukthayPolicy: "padToSam",
        seed: 99,
      },
    });
    expect(sel).not.toBeNull();
    expect(sel!.enabled).toBe(true);
    expect(sel!.spec.seedNumbers).toEqual([7, 4, 5, 3, 3, 1, 5]);
    expect(sel!.spec.schedule.menu[0]?.op).toBe("split");
    expect(sel!.spec.phrasing).toEqual({ type: "notesPerCell", notes: 2 });
    // Deep clone is structurally equal but independent.
    const cloned = cloneJathiBhedam(sel);
    expect(cloned).toEqual(sel);
    cloned!.spec.seedNumbers.push(9);
    expect(sel!.spec.seedNumbers).toHaveLength(7);
  });

  it("coerces garbage into a valid, bounded shape (never throws)", () => {
    const sel = normalizeJathiBhedamFromPatch({
      enabled: "yes",
      baseWeight: -5,
      gatiWeights: "nope",
      spec: {
        gati: 999,
        seedNumbers: [0, 9, 200, 3],
        schedule: { opsPerGeneration: 99, menu: [{ op: "bogus", weight: 1 }] },
        mukthayPolicy: "weird",
      },
    });
    expect(sel).not.toBeNull();
    expect(sel!.enabled).toBe(false); // only `true` is truthy
    expect(sel!.baseWeight).toBe(0); // clamped non-negative
    expect(sel!.gatiWeights).toEqual([]); // non-array dropped
    expect(sel!.spec.gati).toBeLessThanOrEqual(32);
    // seed numbers clamped into 1..=8
    expect(sel!.spec.seedNumbers.every((n) => n >= 1 && n <= 8)).toBe(true);
    expect(sel!.spec.schedule.opsPerGeneration).toBeLessThanOrEqual(8);
    expect(sel!.spec.schedule.menu).toEqual([]); // invalid op filtered out
    expect(sel!.spec.mukthayPolicy).toBe("padToSam"); // unknown => default
  });

  it("cloneJathiBhedam returns null for null/undefined", () => {
    expect(cloneJathiBhedam(null)).toBeNull();
    expect(cloneJathiBhedam(undefined)).toBeNull();
  });
});

describe("track export/import", () => {
  const destinationGlobal = { tempoBpm: 88, cycleBeats: 6 };

  function activeTrackOf(project: ParallelProjectPatch): ParallelTrackPatch {
    const found = project.tracks.find((track) => track.id === project.activeTrackId);
    if (!found) throw new Error("active track missing");
    return found;
  }

  function trackWithSeedHistory(): ParallelTrackPatch {
    const flat = makeFlatState("export-src", 2);
    const track = makeTrack("track-active", flat, "custom");
    // makeSeedPaths produces non-empty seed paths + a score snapshot stand-in.
    track.seedPaths = makeSeedPaths("export-src");
    track.scoreSnapshot = { fake: "snapshot", notes: [1, 2, 3] };
    return track;
  }

  it("builds an envelope that survives JSON round-trip and re-reads identically", () => {
    const track = trackWithSeedHistory();
    const envelope = buildTrackEnvelope(track, { tempoBpm: 132, cycleBeats: 7 });
    expect(envelope.app).toBe(PATCH_APP_ID);
    expect(envelope.kind).toBe(TRACK_DOCUMENT_KIND);
    expect(envelope.schemaVersion).toBe(PATCH_SCHEMA_VERSION);
    expect(envelope.globalContext).toEqual({ tempoBpm: 132, cycleBeats: 7 });

    const onDisk = JSON.parse(JSON.stringify(envelope));
    const once = readTrackEnvelope(onDisk);
    const twice = readTrackEnvelope(
      JSON.parse(JSON.stringify(buildTrackEnvelope(once.track, once.globalContext!)))
    );
    expect(twice.track).toEqual(once.track);
    expect(twice.globalContext).toEqual(once.globalContext);
    expect(once.loadWarnings).toEqual([]);
    expect(twice.loadWarnings).toEqual([]);
  });

  it("surfaces tolerant evolution-plan repairs on track import", () => {
    const envelope = JSON.parse(
      JSON.stringify(
        buildTrackEnvelope(trackWithSeedHistory(), { tempoBpm: 120, cycleBeats: 4 })
      )
    ) as Record<string, unknown>;
    const track = envelope.track as Record<string, unknown>;
    track.generator = {
      kind: "dumka",
      pattern: "x . x .",
      plan: [
        {
          id: 1,
          order: 0,
          enabled: true,
          fromCycle: 2,
          toCycle: 4,
          family: "rotate",
          intensity: 20,
        },
        {
          id: 2,
          order: 1,
          enabled: false,
          fromCycle: 4,
          toCycle: 5,
          family: "rotate",
          intensity: 20,
        },
        {
          id: 3,
          order: 2,
          enabled: true,
          fromCycle: 9,
          toCycle: 9,
          family: "futureFamily",
          intensity: 20,
        },
      ],
    };

    const imported = readTrackEnvelope(envelope);
    expect(imported.track.generator).toMatchObject({
      kind: "dumka",
      plan: [{ id: 1, family: "rotate" }],
    });
    expect(imported.loadWarnings).toEqual([
      "Unknown Dum-Ka evolution operator families were dropped.",
      "Overlapping Dum-Ka evolution directives were dropped.",
    ]);
  });

  it("rejects Caesura documents so the two sequencers never cross-load", () => {
    // App identity is the FIRST gate: a real Caesura file (app
    // "CarnaticSeq", schema v8) is refused on identity before anything else.
    const caesuraPatch = makeProjectFixture() as unknown as Record<string, unknown>;
    expect(() =>
      readPatchDocument({ ...caesuraPatch, app: "CarnaticSeq", schemaVersion: 8 })
    ).toThrow("Patch file was not saved by Dum-Ka.");
    // And a Caesura-era schema is refused even if the identity matched.
    expect(() =>
      readPatchDocument({ ...caesuraPatch, schemaVersion: 8 })
    ).toThrow("Unsupported patch schema: 8");

    const envelope = JSON.parse(
      JSON.stringify(
        buildTrackEnvelope(trackWithSeedHistory(), { tempoBpm: 120, cycleBeats: 4 })
      )
    ) as Record<string, unknown>;
    expect(() => readTrackEnvelope({ ...envelope, app: "CarnaticSeq" })).toThrow(
      "Track file was not saved by Dum-Ka."
    );
  });

  it("does not mutate the source track when building an envelope", () => {
    const track = trackWithSeedHistory();
    const before = JSON.parse(JSON.stringify(track));
    const envelope = buildTrackEnvelope(track, { tempoBpm: 100, cycleBeats: 8 });
    envelope.track.name = "mutated";
    envelope.track.seedPaths = [];
    expect(track).toEqual(before);
  });

  it("rejects documents that are not Dum-Ka track envelopes", () => {
    const good = buildTrackEnvelope(trackWithSeedHistory(), {
      tempoBpm: 120,
      cycleBeats: 8,
    });
    expect(() => readTrackEnvelope(null)).toThrow();
    expect(() => readTrackEnvelope("not an object")).toThrow();
    expect(() => readTrackEnvelope({ ...good, app: "SomethingElse" })).toThrow(
      /not saved by Dum-Ka/
    );
    expect(() => readTrackEnvelope({ ...good, kind: "patch" })).toThrow(
      /not a Dum-Ka track/
    );
    expect(() =>
      readTrackEnvelope({ ...good, schemaVersion: 2 })
    ).toThrow(/Unsupported track schema/);
    const { track: _omit, ...withoutTrack } = good;
    expect(() => readTrackEnvelope(withoutTrack)).toThrow(/missing track/);
  });

  it("fills defaults for a sparse but valid track", () => {
    const sparse = {
      app: PATCH_APP_ID,
      kind: TRACK_DOCUMENT_KIND,
      schemaVersion: PATCH_SCHEMA_VERSION,
      savedAt,
      track: { id: "anything", name: "Sparse" },
      globalContext: { tempoBpm: 90, cycleBeats: 6 },
    };
    const { track, globalContext } = readTrackEnvelope(sparse);
    expect(track.name).toBe("Sparse");
    expect(track.sequencer).toBeDefined();
    expect(track.rhythm).toBeDefined();
    expect(track.pitchShaper.rangeLow).toBe(DEFAULT_PITCH_RANGE_LOW);
    expect(track.pitchShaper.rangeHigh).toBe(DEFAULT_PITCH_RANGE_HIGH);
    expect(track.automation).toBeDefined();
    expect(globalContext).toEqual({ tempoBpm: 90, cycleBeats: 6 });
  });

  it("treats missing source timing as absent and clamps malformed timing", () => {
    const base = buildTrackEnvelope(trackWithSeedHistory(), {
      tempoBpm: 120,
      cycleBeats: 8,
    });
    const { globalContext: missing } = readTrackEnvelope({
      ...base,
      globalContext: undefined,
    });
    expect(missing).toBeNull();

    const { globalContext: clamped } = readTrackEnvelope({
      ...base,
      globalContext: { tempoBpm: 999, cycleBeats: -3 },
    });
    expect(clamped).toEqual({ tempoBpm: 400, cycleBeats: 1 });
  });

  it("mints a fresh id, never colliding with existing tracks", () => {
    const project = makeProjectFixture().project;
    // Imported track deliberately reuses an existing id to prove it is replaced.
    const imported = readTrackEnvelope(
      buildTrackEnvelope(
        { ...trackWithSeedHistory(), id: "track-active" },
        { tempoBpm: 120, cycleBeats: 8 }
      )
    ).track;
    const next = spliceImportedTrack(project, imported, {
      keepTrackLocalTiming: false,
      importedGlobalContext: { tempoBpm: 120, cycleBeats: 8 },
      destinationGlobal,
    });
    const ids = next.tracks.map((track) => track.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(next.tracks.length).toBe(project.tracks.length + 1);
    const added = activeTrackOf(next);
    expect(project.tracks.some((track) => track.id === added.id)).toBe(false);
  });

  it("de-duplicates the imported track name against existing names", () => {
    const project = makeProjectFixture().project;
    const collidingName = project.tracks[0]!.name;
    const imported = { ...trackWithSeedHistory(), name: collidingName };
    const next = spliceImportedTrack(project, imported, {
      keepTrackLocalTiming: false,
      importedGlobalContext: { tempoBpm: 120, cycleBeats: 8 },
      destinationGlobal,
      preferredName: collidingName,
    });
    const added = activeTrackOf(next);
    expect(added.name).not.toBe(collidingName);
    expect(added.name.startsWith(collidingName)).toBe(true);
  });

  it("drops replay state (seedPaths + scoreSnapshot) on import", () => {
    const project = makeProjectFixture().project;
    const imported = trackWithSeedHistory();
    expect(imported.seedPaths.length).toBeGreaterThan(0);
    expect(imported.scoreSnapshot).not.toBeNull();
    const next = spliceImportedTrack(project, imported, {
      keepTrackLocalTiming: true,
      importedGlobalContext: { tempoBpm: 120, cycleBeats: 8 },
      destinationGlobal,
    });
    const added = activeTrackOf(next);
    expect(added.seedPaths).toEqual([]);
    expect(added.scoreSnapshot).toBeNull();
    expect(added.muted).toBe(false);
    expect(added.soloed).toBe(false);
    expect(added.color).not.toBe(imported.color);
  });

  it("keepTrackLocalTiming pins custom tempo/cycle from the captured context", () => {
    const project = makeProjectFixture().project;
    const imported = {
      ...trackWithSeedHistory(),
      tempoMode: "global" as const,
      cycleLengthMode: "global" as const,
    };
    const next = spliceImportedTrack(project, imported, {
      keepTrackLocalTiming: true,
      importedGlobalContext: { tempoBpm: 137, cycleBeats: 9 },
      destinationGlobal,
    });
    const added = activeTrackOf(next);
    expect(added.tempoMode).toBe("custom");
    expect(added.customTempoBpm).toBe(137);
    expect(added.cycleLengthMode).toBe("custom");
    expect(added.customCycleBeats).toBe(9);
  });

  it("keepTrackLocalTiming preserves existing track-local custom timing", () => {
    const project = makeProjectFixture().project;
    const imported = {
      ...trackWithSeedHistory(),
      tempoMode: "custom" as const,
      customTempoBpm: 111,
      cycleLengthMode: "custom" as const,
      customCycleBeats: 5,
    };
    const next = spliceImportedTrack(project, imported, {
      keepTrackLocalTiming: true,
      importedGlobalContext: { tempoBpm: 137, cycleBeats: 9 },
      destinationGlobal,
    });
    const added = activeTrackOf(next);
    expect(added.tempoMode).toBe("custom");
    expect(added.customTempoBpm).toBe(111);
    expect(added.cycleLengthMode).toBe("custom");
    expect(added.customCycleBeats).toBe(5);
  });

  it("following the destination project clears track-local timing modes", () => {
    const project = makeProjectFixture().project;
    const imported = { ...trackWithSeedHistory(), tempoMode: "custom" as const };
    const next = spliceImportedTrack(project, imported, {
      keepTrackLocalTiming: false,
      importedGlobalContext: { tempoBpm: 137, cycleBeats: 9 },
      destinationGlobal,
    });
    const added = activeTrackOf(next);
    expect(added.tempoMode).toBe("global");
    expect(added.cycleLengthMode).toBe("global");
    expect(added.customTempoBpm).toBe(destinationGlobal.tempoBpm);
    expect(added.customCycleBeats).toBe(destinationGlobal.cycleBeats);
  });

  it("reconciles channel-conflict bookkeeping for the new track", () => {
    const project = makeProjectFixture().project;
    const imported = trackWithSeedHistory();
    const next = spliceImportedTrack(project, imported, {
      keepTrackLocalTiming: false,
      importedGlobalContext: { tempoBpm: 120, cycleBeats: 8 },
      destinationGlobal,
    });
    const added = activeTrackOf(next);
    // Every live track id must appear in conflictPriority...
    for (const track of next.tracks) {
      expect(next.global.conflictPriority).toContain(track.id);
    }
    expect(next.global.conflictPriority).toHaveLength(next.tracks.length);
    expect(new Set(next.global.conflictPriority).size).toBe(next.tracks.length);
    // ...and the new id is included.
    expect(next.global.conflictPriority).toContain(added.id);
    // The pre-existing valid matrix rule between two surviving tracks is kept.
    expect(
      next.global.channelLogicMatrix.some(
        (rule) =>
          rule.trackAId === "track-active" || rule.trackBId === "track-active"
      )
    ).toBe(true);
    // No matrix rule references a track id that is not in the project.
    const liveIds = new Set(next.tracks.map((track) => track.id));
    for (const rule of next.global.channelLogicMatrix) {
      expect(liveIds.has(rule.trackAId)).toBe(true);
      expect(liveIds.has(rule.trackBId)).toBe(true);
    }
  });

  it("does not mutate the input project and throws when full", () => {
    const project = makeProjectFixture().project;
    const before = JSON.parse(JSON.stringify(project));
    const imported = trackWithSeedHistory();
    spliceImportedTrack(project, imported, {
      keepTrackLocalTiming: false,
      importedGlobalContext: { tempoBpm: 120, cycleBeats: 8 },
      destinationGlobal,
    });
    expect(project).toEqual(before);

    // Fill to the maximum, then expect a throw rather than a silent overflow.
    let full = project;
    while (full.tracks.length < MAX_PARALLEL_TRACKS) {
      full = spliceImportedTrack(full, trackWithSeedHistory(), {
        keepTrackLocalTiming: false,
        importedGlobalContext: { tempoBpm: 120, cycleBeats: 8 },
        destinationGlobal,
      });
    }
    expect(full.tracks.length).toBe(MAX_PARALLEL_TRACKS);
    expect(() =>
      spliceImportedTrack(full, trackWithSeedHistory(), {
        keepTrackLocalTiming: false,
        importedGlobalContext: { tempoBpm: 120, cycleBeats: 8 },
        destinationGlobal,
      })
    ).toThrow(/maximum/);
  });

  it("a freshly imported track flattens cleanly through the project reader", () => {
    const project = makeProjectFixture().project;
    const imported = trackWithSeedHistory();
    const next = spliceImportedTrack(project, imported, {
      keepTrackLocalTiming: true,
      importedGlobalContext: { tempoBpm: 120, cycleBeats: 8 },
      destinationGlobal,
    });
    const base = makeProjectFixture();
    const doc = readPatchDocument({ ...base, project: next });
    // The active (imported) track is what gets flattened to top-level state.
    expect(doc.project.activeTrackId).toBe(activeTrackOf(next).id);
    expect(doc.project.tracks.length).toBe(next.tracks.length);
    const added = activeTrackOf(next);
    const rereadAdded = doc.project.tracks.find((track) => track.id === added.id);
    expect(rereadAdded).toMatchObject({
      id: added.id,
      tempoMode: added.tempoMode,
      customTempoBpm: added.customTempoBpm,
      cycleLengthMode: added.cycleLengthMode,
      customCycleBeats: added.customCycleBeats,
      seedPaths: [],
      scoreSnapshot: null,
    });
    expect(doc.project.global.conflictPriority).toHaveLength(doc.project.tracks.length);
  });
});

describe("Track Flow boxes — migration and normalization", () => {
  it("migrates legacy mode:trackFlow tracks into one runtime-equivalent `main` box", () => {
    const fixture = makeProjectFixture();
    // Legacy patch: no boxes key, tracks carry mode: "trackFlow".
    const legacy = {
      ...fixture,
      project: {
        ...fixture.project,
        global: { ...fixture.project.global, trackFlowBoxes: undefined },
        tracks: fixture.project.tracks.map((track) => ({
          ...track,
          mode: "trackFlow" as const,
        })),
      },
    };
    const loaded = readPatchDocument(legacy);
    const boxes = loaded.project.global.trackFlowBoxes;
    expect(boxes).toHaveLength(1);
    // v1 identity preserved: id `main` (⇒ lane `track-flow-main`), name "Track
    // Flow", seed 0, member order matches the authored track order.
    expect(boxes[0]!.id).toBe("main");
    expect(boxes[0]!.name).toBe("Track Flow");
    expect(boxes[0]!.seed).toBe(0);
    expect(boxes[0]!.memberTrackIds).toEqual(["track-muted", "track-active"]);
    // The per-track `mode` shim is derived from membership.
    expect(loaded.project.tracks.every((t) => t.mode === "trackFlow")).toBe(true);
  });

  it("does not re-migrate when a trackFlowBoxes array is already present (even empty)", () => {
    const fixture = makeProjectFixture();
    const migrated = {
      ...fixture,
      project: {
        ...fixture.project,
        global: { ...fixture.project.global, trackFlowBoxes: [] },
        tracks: fixture.project.tracks.map((track) => ({
          ...track,
          mode: "trackFlow" as const,
        })),
      },
    };
    const loaded = readPatchDocument(migrated);
    expect(loaded.project.global.trackFlowBoxes).toEqual([]);
    expect(loaded.project.tracks.every((t) => t.mode === "parallel")).toBe(true);
  });

  it("keeps a track in at most one box (first box wins) and prunes deleted ids", () => {
    const boxes = normalizeTrackFlowBoxes(
      [
        { id: "a", name: "A", memberTrackIds: ["t1", "t2", "ghost"], chain: {}, seed: 0 },
        { id: "b", name: "B", memberTrackIds: ["t2", "t3"], chain: {}, seed: 0 },
      ],
      [],
      ["t1", "t2", "t3"]
    );
    expect(boxes.map((box) => box.memberTrackIds)).toEqual([["t1", "t2"], ["t3"]]);
  });

  it("preserves box-lane conflictPriority and channelLogicMatrix entries on load", () => {
    const fixture = makeProjectFixture();
    const withBoxRules = {
      ...fixture,
      project: {
        ...fixture.project,
        global: {
          ...fixture.project.global,
          // track-muted is boxed; track-active stays parallel; an authored rule
          // and priority entry name the box lane id.
          trackFlowBoxes: [
            { id: "main", name: "Track Flow", memberTrackIds: ["track-muted"], chain: {}, seed: 0 },
          ],
          conflictPriority: ["track-flow-main", "track-active"],
          channelLogicMatrix: [
            { trackAId: "track-active", trackBId: "track-flow-main", outputChannel: null, policy: "xor" },
          ],
        },
      },
    };
    const loaded = readPatchDocument(withBoxRules);
    // The box-lane endpoint survives both normalizations (not dropped as unknown).
    expect(loaded.project.global.conflictPriority).toContain("track-flow-main");
    expect(
      loaded.project.global.channelLogicMatrix.some(
        (entry) =>
          entry.trackBId === "track-flow-main" || entry.trackAId === "track-flow-main"
      )
    ).toBe(true);
  });

  it("repairs reserved-family authored track ids and rewrites references", () => {
    const fixture = makeProjectFixture();
    const trap = {
      ...fixture,
      project: {
        ...fixture.project,
        activeTrackId: "track-flow-legacy",
        tracks: [
          { ...fixture.project.tracks[0]!, id: "track-flow-legacy" },
          fixture.project.tracks[1]!,
        ],
        global: {
          ...fixture.project.global,
          trackFlowBoxes: undefined,
          conflictPriority: ["track-flow-legacy", "track-active"],
          channelLogicMatrix: [
            { trackAId: "track-flow-legacy", trackBId: "track-active", outputChannel: null, policy: "xor" },
          ],
        },
      },
    };
    const loaded = readPatchDocument(trap);
    const ids = loaded.project.tracks.map((t) => t.id);
    // The reserved id is renamed out of the family; nothing remains reserved.
    expect(ids.some((id) => id.startsWith("track-flow-"))).toBe(false);
    expect(ids).toContain("legacy");
    expect(loaded.project.activeTrackId).toBe("legacy");
    // References were rewritten, not dropped.
    expect(loaded.project.global.conflictPriority).toContain("legacy");
    expect(
      loaded.project.global.channelLogicMatrix.some(
        (entry) => entry.trackAId === "legacy" || entry.trackBId === "legacy"
      )
    ).toBe(true);
  });

  it("repairs duplicate authored track ids on load", () => {
    const fixture = makeProjectFixture();
    const duplicateId = fixture.project.tracks[0]!.id;
    const trap = {
      ...fixture,
      project: {
        ...fixture.project,
        tracks: [
          fixture.project.tracks[0]!,
          { ...fixture.project.tracks[1]!, id: duplicateId },
        ],
        global: {
          ...fixture.project.global,
          conflictPriority: [duplicateId],
        },
      },
    };
    const loaded = readPatchDocument(trap);
    const ids = loaded.project.tracks.map((track) => track.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(duplicateId);
    expect(ids.some((id) => id !== duplicateId && id.startsWith(`${duplicateId}-`))).toBe(true);
    expect(loaded.project.global.conflictPriority).toEqual(ids);
  });

  it("sanitizes box ids: empty/reserved/colon/duplicate are repaired", () => {
    const boxes = normalizeTrackFlowBoxes(
      [
        { id: "", memberTrackIds: ["t1"], chain: {}, seed: 0 },
        { id: "track-flow-x", memberTrackIds: ["t2"], chain: {}, seed: 0 },
        { id: "a:b", memberTrackIds: ["t3"], chain: {}, seed: 0 },
        { id: "main", memberTrackIds: ["t4"], chain: {}, seed: 0 },
        { id: "main", memberTrackIds: ["t5"], chain: {}, seed: 0 },
      ],
      [],
      ["t1", "t2", "t3", "t4", "t5"]
    );
    const ids = boxes.map((box) => box.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(ids.every((id) => id.length > 0 && !id.includes(":"))).toBe(true);
    expect(ids.every((id) => !id.startsWith("track-flow-"))).toBe(true);
    // The two "main" boxes are de-duplicated.
    expect(ids.filter((id) => id === "main")).toHaveLength(1);
  });

  it("persists each box's collapsed lane-UI state (defaulting to expanded)", () => {
    const boxes = normalizeTrackFlowBoxes(
      [
        { id: "a", memberTrackIds: ["t1"], chain: {}, seed: 0, collapsed: true },
        { id: "b", memberTrackIds: ["t2"], chain: {}, seed: 0 },
      ],
      [],
      ["t1", "t2"]
    );
    expect(boxes.find((box) => box.id === "a")?.collapsed).toBe(true);
    expect(boxes.find((box) => box.id === "b")?.collapsed).toBe(false);
  });
});

describe("normalizeAutomationSet anchor hygiene", () => {
  it("keeps anchors that name a real marker and strips dangling ones", () => {
    const set = normalizeAutomationSet({
      lengthCycles: 1,
      markers: [{ id: "m-real", time: { numer: 1, denom: 2 }, label: "cue" }],
      tracks: [
        {
          id: "t",
          target: "sequencer.pitch",
          enabled: true,
          combine: "replace",
          graphRange: null,
          curves: [
            {
              id: "c",
              enabled: true,
              interpolation: "linear",
              points: [
                {
                  id: "kept",
                  time: { numer: 0, denom: 1 },
                  value: { type: "number", value: 1 },
                  anchorId: "m-real",
                  outCurve: null,
                },
                {
                  // The legacy default-lane sentinel: no such marker has ever
                  // existed, but the sampler now evaluates anchors, so it must
                  // be healed to null on load rather than persisted forever.
                  id: "sentinel",
                  time: { numer: 1, denom: 1 },
                  value: { type: "number", value: 1 },
                  anchorId: "automation-end",
                  outCurve: null,
                },
                {
                  id: "dangling",
                  time: { numer: 1, denom: 4 },
                  value: { type: "number", value: 1 },
                  anchorId: "deleted-marker",
                  outCurve: null,
                },
              ],
            },
          ],
        },
      ],
    });
    const points = set.tracks[0]!.curves[0]!.points;
    expect(points.find((point) => point.id === "kept")?.anchorId).toBe("m-real");
    expect(points.find((point) => point.id === "sentinel")?.anchorId).toBeNull();
    expect(points.find((point) => point.id === "dangling")?.anchorId).toBeNull();
  });
});
