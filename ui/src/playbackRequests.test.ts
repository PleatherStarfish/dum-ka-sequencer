import { describe, expect, it } from "vitest";

import type { PulseSpan, RhythmSeedResolution, SubdivisionSwitchPreview } from "./bridge";
import {
  createNeutralPatchDocument,
  normalizePatchGeneratorConfig,
  readPatchDocument,
} from "./patchIo";
import {
  defaultTrackFlowChain,
  trackFlowTransitionKey,
  type TrackFlowBox,
} from "./trackFlowBoxes";
import { defaultTriggerConfig } from "./triggerUi";
import {
  buildParallelPlaybackRequest,
  channelHocketSpecFromPatch,
  clonePatchJson,
  defaultParallelTrackName,
  generatorSpanInputsFromPulseSpans,
  generatorSpanVelocitiesFromPulseSpans,
  generatorSeedModeFromGlobalSettings,
  nextParallelTrackColor,
  seedModeRequestFromPatch,
  switchRequestFromParallelTrack,
  uniqueParallelTrackId,
  parallelPushDedupKey,
  patchContentFingerprint,
  transportReferenceTempoForPatch,
} from "./playbackRequests";

// A fixed neutral patch so the golden snapshots below are deterministic.
const goldenDoc = createNeutralPatchDocument({
  seed: 1234,
  tempoBpm: 90,
  cycleBeats: 8,
  savedAt: "2026-01-01T00:00:00.000Z",
});

it("carries exact pulse-span subdivision into generator requests", () => {
  const span: PulseSpan = {
    id: 9,
    kind: "jathiPulse",
    sectionIndex: 2,
    beat: null,
    gati: null,
    jathi: 3,
    index: 0,
    start: 0,
    duration: 3 / 7,
    startMatra: 0,
    matraLen: 3,
    subdivision: 7,
    protectedCuts: [],
    tags: [],
    matraVelocities: [104, 96, 96],
  };
  expect(generatorSpanInputsFromPulseSpans([span], () => "grouping")).toEqual([
    {
      spanId: 9,
      spanLen: 3,
      label: "grouping",
      sectionIndex: 2,
      subdivision: 7,
    },
  ]);
  // The authored accent velocities ride beside the span inputs, and spans
  // without them (legacy payloads) simply contribute no entry.
  expect(
    generatorSpanVelocitiesFromPulseSpans([span, { ...span, id: 10, matraVelocities: [] }])
  ).toEqual([{ spanId: 9, velocities: [104, 96, 96] }]);
});

describe("seedModeRequestFromPatch — retired modes", () => {
  const sequencer = (seedMode: "drift" | "morph") => {
    const doc = clonePatchJson(goldenDoc);
    doc.sequencer.seedMode = seedMode;
    doc.sequencer.seed = 777;
    doc.sequencer.newSeedChance = 40;
    doc.sequencer.holdChance = 60;
    doc.sequencer.blendCycles = 24;
    return doc.sequencer;
  };

  it("projects a legacy global drift mode onto per-cycle", () => {
    expect(
      seedModeRequestFromPatch(
        "followGlobal",
        5,
        [],
        1,
        1,
        8,
        15,
        50,
        16,
        sequencer("drift")
      )
    ).toEqual({ type: "perCycle", seed: 777 });
  });

  it("projects a legacy local drift mode onto per-cycle", () => {
    expect(
      seedModeRequestFromPatch("drift", 5, [], 1, 1, 8, 250, 50, 16, sequencer("drift"))
    ).toEqual({ type: "perCycle", seed: 5 });
  });

  it("projects a legacy global morph mode onto per-cycle", () => {
    expect(
      seedModeRequestFromPatch(
        "followGlobal",
        5,
        [],
        1,
        1,
        8,
        15,
        50,
        16,
        sequencer("morph")
      )
    ).toEqual({ type: "perCycle", seed: 777 });
  });

  it("projects a legacy local morph mode onto per-cycle", () => {
    expect(
      seedModeRequestFromPatch("morph", 5, [], 1, 1, 8, 35, 250, 0, sequencer("morph"))
    ).toEqual({ type: "perCycle", seed: 5 });
  });
});

describe("lossless preview history persistence", () => {
  it("preserves preview u64 histories through patch JSON and request assembly", () => {
    const previewHistory: SubdivisionSwitchPreview["historySeeds"] = [
      "9007199254740993",
      "18446744073709551615",
    ];
    const resolvedSeed: RhythmSeedResolution = {
      seed: "9007199254740993",
      source: "history",
      history: ["18446744073709551615", "9007199254740993"],
    };
    const document = clonePatchJson(goldenDoc);
    const activeTrack = document.project!.tracks[0]!;
    for (const sequencer of [document.sequencer, activeTrack.sequencer]) {
      sequencer.seedMode = "history";
      sequencer.historySeeds = [...previewHistory];
    }
    for (const rhythm of [document.rhythm, activeTrack.rhythm]) {
      rhythm.rhythmSeedBehavior = "history";
      rhythm.historySeeds = [...resolvedSeed.history];
      rhythm.resolvedSeed = { ...resolvedSeed, history: [...resolvedSeed.history] };
    }
    for (const channel of [document.channelHocket, activeTrack.channelHocket]) {
      channel.seedBehavior = "history";
      channel.historySeeds = [...resolvedSeed.history];
    }

    const loaded = readPatchDocument(JSON.parse(JSON.stringify(document)));
    expect(loaded.sequencer.historySeeds).toEqual(previewHistory);
    expect(loaded.rhythm.resolvedSeed).toEqual(resolvedSeed);

    const loadedTrack = loaded.project!.tracks[0]!;
    const switchResult = switchRequestFromParallelTrack(
      loadedTrack,
      loaded.project!.global
    );
    if (!switchResult.ok) throw new Error(switchResult.error);
    expect(switchResult.data.historySeeds).toEqual(previewHistory);

    expect(
      seedModeRequestFromPatch(
        "history",
        loadedTrack.rhythm.rhythmSeed,
        loadedTrack.rhythm.historySeeds,
        loadedTrack.rhythm.historyWeight,
        loadedTrack.rhythm.newSeedWeight,
        loadedTrack.rhythm.maxHistory,
        loadedTrack.rhythm.newSeedChance,
        loadedTrack.rhythm.holdChance,
        loadedTrack.rhythm.blendCycles,
        loadedTrack.sequencer
      )
    ).toMatchObject({
      type: "history",
      history: resolvedSeed.history,
    });

    expect(
      channelHocketSpecFromPatch(
        {
          ...loadedTrack.channelHocket,
          enabled: true,
          channels: [1, 2],
        },
        loadedTrack.sequencer
      )?.seedMode
    ).toMatchObject({ type: "history", history: resolvedSeed.history });
  });
});

describe("generatorSeedModeFromGlobalSettings", () => {
  it("inherits the authoritative global pool and weights without coercing u64 seeds", () => {
    const history = ["9007199254740993", "18446744073709551615"];
    expect(
      generatorSeedModeFromGlobalSettings(
        "history",
        77,
        history,
        4.4,
        2.6,
        12.2
      )
    ).toEqual({
      type: "history",
      seed: 77,
      history,
      historyWeight: 4,
      newSeedWeight: 3,
      maxHistory: 12,
    });
  });

  it("keeps non-history modes independent of the global pool", () => {
    expect(
      generatorSeedModeFromGlobalSettings("perCycle", 91, ["7"], 4, 2, 8)
    ).toEqual({ type: "perCycle", seed: 91 });
  });
});

describe("clonePatchJson", () => {
  it("deep-clones without sharing references", () => {
    const source = { a: [1, 2], b: { c: 3 } };
    const clone = clonePatchJson(source);
    expect(clone).toEqual(source);
    expect(clone).not.toBe(source);
    expect(clone.a).not.toBe(source.a);
  });
});

describe("patchContentFingerprint", () => {
  it("keeps the async patch build and authored-state projections symmetric", () => {
    const authoredState = clonePatchJson(goldenDoc);
    const asyncBuild = clonePatchJson(goldenDoc);
    authoredState.scoreSnapshot = null;
    authoredState.project.tracks[0]!.scoreSnapshot = null;
    asyncBuild.scoreSnapshot = { cycle: 11, generatedAt: "async" };
    asyncBuild.project.tracks[0]!.scoreSnapshot = {
      notes: [60, 64, 67],
      generatedAt: "async",
    };

    const authoredFingerprint = patchContentFingerprint(authoredState);
    expect(patchContentFingerprint(asyncBuild)).toBe(authoredFingerprint);
  });

  it("ignores derived score snapshots but detects authored edits", () => {
    const first = clonePatchJson(goldenDoc);
    const second = clonePatchJson(goldenDoc);
    first.scoreSnapshot = { cycle: 1 };
    second.scoreSnapshot = { cycle: 2 };
    first.project.tracks[0]!.scoreSnapshot = { notes: [60] };
    second.project.tracks[0]!.scoreSnapshot = { notes: [67] };

    expect(patchContentFingerprint(first)).toBe(patchContentFingerprint(second));

    second.sequencer.name = "Authored edit";
    expect(patchContentFingerprint(first)).not.toBe(
      patchContentFingerprint(second)
    );
  });

  it("ignores machine-only setup values while retaining setup view state", () => {
    const machineAtThreeSeconds = clonePatchJson(goldenDoc);
    const recalledAtSixtySeconds = clonePatchJson(goldenDoc);
    machineAtThreeSeconds.setup.autosaveEnabled = true;
    machineAtThreeSeconds.setup.autosaveIntervalMs = 3_000;
    machineAtThreeSeconds.setup.autoloadRecentSession = true;
    recalledAtSixtySeconds.setup.autosaveEnabled = false;
    recalledAtSixtySeconds.setup.autosaveIntervalMs = 60_000;
    recalledAtSixtySeconds.setup.autoloadRecentSession = false;

    expect(patchContentFingerprint(machineAtThreeSeconds)).toBe(
      patchContentFingerprint(recalledAtSixtySeconds)
    );

    recalledAtSixtySeconds.setup.tab = "files";
    expect(patchContentFingerprint(machineAtThreeSeconds)).not.toBe(
      patchContentFingerprint(recalledAtSixtySeconds)
    );
  });
});

describe("transportReferenceTempoForPatch", () => {
  it("keeps the global reference when a multi-track project collapses to one custom track", () => {
    const patch = clonePatchJson(goldenDoc);
    const active = patch.project.tracks[0]!;
    active.tempoMode = "custom";
    active.customTempoBpm = 132;
    patch.transport.tempoBpm = 132;
    patch.project.global.tempoBpm = 80;
    patch.project.tracks.push({
      ...clonePatchJson(active),
      id: "muted-track",
      name: "Muted track",
      muted: true,
    });

    expect(transportReferenceTempoForPatch(patch)).toBe(80);
    patch.project.tracks[1]!.muted = false;
    expect(transportReferenceTempoForPatch(patch)).toBe(80);
  });
});

describe("parallel track id / name / color", () => {
  it("derives a unique track id and suffixes on collision", () => {
    const id = uniqueParallelTrackId("lead", []);
    expect(id).toBeTruthy();
    expect(uniqueParallelTrackId("lead", [{ id }])).not.toBe(id);
  });

  it("names the next free Track N", () => {
    expect(defaultParallelTrackName([])).toBe("Track 1");
    expect(defaultParallelTrackName([{ name: "Track 1" }])).toBe("Track 2");
  });

  it("cycles colours deterministically", () => {
    expect(typeof nextParallelTrackColor(0)).toBe("string");
    expect(nextParallelTrackColor(0)).toBe(nextParallelTrackColor(0));
  });
});

describe("spec builders (golden snapshots from a neutral patch)", () => {
  it("channelHocketSpecFromPatch assembles transitions for enabled channels", () => {
    const spec = channelHocketSpecFromPatch(
      { ...goldenDoc.channelHocket, enabled: true, channels: [1, 2] },
      goldenDoc.sequencer
    );
    expect(spec).not.toBeNull();
    expect(spec).toMatchSnapshot();
  });

  it("channelHocketSpecFromPatch uses the canonical Euclid layer set", () => {
    const baseEuclid = goldenDoc.channelHocket.euclid;
    const baseLayer = {
      channel: 1,
      pulses: 1,
      rotation: 0,
      maxRun: 1,
      steps: 16,
      invert: false,
    };
    const spec = channelHocketSpecFromPatch(
      {
        ...goldenDoc.channelHocket,
        enabled: true,
        channels: [1, 2, 3],
        assignMode: "euclid",
        euclid: {
          ...baseEuclid,
          placement: "partition",
          steps: 4,
          spanAccentChannel: 9,
          layers: [
            { ...baseLayer, channel: 2, pulses: 3 },
            { ...baseLayer, channel: 2, pulses: 1 },
            { ...baseLayer, channel: 9, pulses: 1 },
            { ...baseLayer, channel: 3, pulses: 3 },
          ],
        },
      },
      goldenDoc.sequencer
    );

    expect(spec?.euclid?.layers).toEqual([
      { ...baseLayer, channel: 2, pulses: 3 },
      { ...baseLayer, channel: 3, pulses: 1 },
    ]);
    expect(spec?.euclid?.spanAccentChannel).toBeNull();
  });

  it("channelHocketSpecFromPatch maps position rules and drops impossible actions", () => {
    const spec = channelHocketSpecFromPatch(
      {
        ...goldenDoc.channelHocket,
        enabled: true,
        channels: [1, 2, 3],
        positionRules: [
          {
            id: "beat two",
            label: "Beat Two",
            enabled: true,
            scope: "beat",
            nth: 2,
            actionWeights: { normalMarkov: 0, renderOnly: 5, resetMarkov: 7 },
            renderWeights: { "3": 9, "9": 999 },
            resetMode: "customWeighted",
            resetWeights: { "2": 11, "9": 999 },
          },
          {
            id: "impossible",
            label: "Impossible",
            enabled: true,
            scope: "section",
            nth: 1,
            actionWeights: { normalMarkov: 0, renderOnly: 5, resetMarkov: 0 },
            renderWeights: {},
            resetMode: "customWeighted",
            resetWeights: {},
          },
        ],
      },
      goldenDoc.sequencer
    );

    expect(spec?.positionRules).toEqual([
      {
        id: "beat two",
        label: "Beat Two",
        enabled: true,
        scope: "beat",
        nth: 2,
        actionWeights: { normalMarkov: 0, renderOnly: 5, resetMarkov: 7 },
        renderWeights: [{ channel: 3, weight: 9 }],
        reset: {
          mode: "customWeighted",
          weights: [{ channel: 2, weight: 11 }],
        },
      },
    ]);
  });

});

describe("buildParallelPlaybackRequest — Track Flow boxes", () => {
  const baseTrack = goldenDoc.project.tracks[0]!;
  const mkTrack = (id: string, overrides: Partial<typeof baseTrack> = {}) => ({
    ...baseTrack,
    id,
    name: id.toUpperCase(),
    mode: "parallel" as const,
    muted: false,
    soloed: false,
    ...overrides,
  });
  const mkBox = (
    id: string,
    memberTrackIds: string[],
    overrides: Partial<TrackFlowBox> = {}
  ): TrackFlowBox => ({
    id,
    name: id.toUpperCase(),
    memberTrackIds,
    chain: defaultTrackFlowChain(),
    seed: 0,
    collapsed: false,
    ...overrides,
  });
  const projectWith = (
    tracks: typeof baseTrack[],
    trackFlowBoxes: TrackFlowBox[] = []
  ) => {
    const boxedIds = new Set(trackFlowBoxes.flatMap((box) => box.memberTrackIds));
    return {
      ...goldenDoc.project,
      activeTrackId: tracks[0]!.id,
      global: {
        ...goldenDoc.project.global,
        conflictPriority: tracks
          .filter((track) => !boxedIds.has(track.id))
          .map((track) => track.id),
        trackFlowBoxes,
      },
      // The normalizer derives `mode` from membership; mirror it here.
      tracks: tracks.map((track) => ({
        ...track,
        mode: boxedIds.has(track.id) ? ("trackFlow" as const) : ("parallel" as const),
      })),
    };
  };

  it("routes boxed tracks into their box lane, not the parallel participant list", () => {
    const result = buildParallelPlaybackRequest(
      projectWith([mkTrack("p0"), mkTrack("s0")], [mkBox("main", ["s0"])]),
      null
    );
    expect(result).not.toBeNull();
    if (result === null || "error" in result) throw new Error("expected a request");
    expect(result.tracks.map((track) => track.id)).toEqual(["p0"]);
    expect(result.trackFlowBoxes).toHaveLength(1);
    const box = result.trackFlowBoxes[0]!;
    expect(box.id).toBe("main");
    expect(box.sources.map((track) => track.id)).toEqual(["s0"]);
    expect(box.seed).toBe(0);
    // No authored chain ⇒ the backend builds the uniform default.
    expect(box.spec).toBeNull();
    // Box sources are never triggered.
    expect(box.sources.every((track) => track.trigger == null)).toBe(true);
    // Conflict priority lists the parallel track plus the box lane id.
    expect(result.conflictPriority).toEqual(["p0", "track-flow-main"]);
  });

  it("maps each track onto the example generator seam", () => {
    const track = mkTrack("p0", {
      rhythm: {
        ...baseTrack.rhythm,
        articulation: {
          ...baseTrack.rhythm.articulation,
          seedPolicy: { seed: 8128, followRhythmChance: 35 },
        },
      },
    });
    const result = buildParallelPlaybackRequest(
      projectWith([track, mkTrack("p1")]),
      null
    );
    if (result === null || "error" in result) throw new Error("expected a request");
    expect(result.tracks[0]!.playback.generator).toMatchObject({
      kind: "example",
      densityPercent: 100,
    });
    expect(result.tracks[0]!.playback).not.toHaveProperty("articulation");
  });

  it("preserves the authored Dum-Ka evolution plan in playback requests", () => {
    const generator = normalizePatchGeneratorConfig({
      kind: "dumka",
      pattern: "[dum . ka .]",
      planLengthCycles: 24,
      plan: [
        {
          id: 41,
          order: 0,
          enabled: true,
          fromCycle: 13,
          toCycle: 13,
          family: "barlowRemove",
          pacing: "easeInOut",
          intensity: 15,
        },
      ],
    });
    const result = buildParallelPlaybackRequest(
      projectWith([mkTrack("p0", { generator }), mkTrack("p1")]),
      null
    );
    if (result === null || "error" in result) throw new Error("expected a request");
    expect(result.tracks[0]!.playback.generator).toMatchObject({
      kind: "dumka",
      planLengthCycles: 24,
      plan: [
        {
          id: 41,
          fromCycle: 13,
          family: "barlowRemove",
          pacing: "easeInOut",
        },
      ],
    });
  });

  it("emits one TrackFlowBoxRequest per box, each playing in parallel", () => {
    const result = buildParallelPlaybackRequest(
      projectWith(
        [mkTrack("a0"), mkTrack("a1"), mkTrack("b0"), mkTrack("b1")],
        [mkBox("a", ["a0", "a1"]), mkBox("b", ["b0", "b1"])]
      ),
      null
    );
    if (result === null || "error" in result) throw new Error("expected a request");
    expect(result.tracks).toEqual([]);
    expect(result.trackFlowBoxes.map((box) => box.id)).toEqual(["a", "b"]);
    expect(result.trackFlowBoxes[0]!.sources.map((t) => t.id)).toEqual(["a0", "a1"]);
    expect(result.trackFlowBoxes[1]!.sources.map((t) => t.id)).toEqual(["b0", "b1"]);
    // Both box lane ids are appended to conflict priority.
    expect(result.conflictPriority).toEqual(["track-flow-a", "track-flow-b"]);
  });

  it("prunes muted members from a box and re-indexes the chain to the audible set", () => {
    // Authored chain: from a1 -> a2. Muting a1 removes it from the source list,
    // so the transition referencing it is dropped and indices shift to [a0, a2].
    const chain = {
      ...defaultTrackFlowChain(),
      weights: { [trackFlowTransitionKey(["a1"], "a2")]: 5 },
      entryWeights: { a0: 3 },
    };
    const result = buildParallelPlaybackRequest(
      projectWith(
        [mkTrack("a0"), mkTrack("a1", { muted: true }), mkTrack("a2"), mkTrack("p0")],
        [mkBox("a", ["a0", "a1", "a2"], { chain })]
      ),
      null
    );
    if (result === null || "error" in result) throw new Error("expected a request");
    const box = result.trackFlowBoxes[0]!;
    // a1 is pruned; sources are the audible members in order.
    expect(box.sources.map((t) => t.id)).toEqual(["a0", "a2"]);
    expect(box.spec).not.toBeNull();
    expect(box.spec!.stateCount).toBe(2);
    // The a1->a2 transition referenced a removed member ⇒ dropped.
    expect(box.spec!.transitions).toEqual([]);
    // The entry on a0 survives, re-indexed to position 0.
    expect(box.spec!.entryWeights).toEqual([{ states: [0], weight: 3 }]);
  });

  it("omits a box with no audible members", () => {
    const result = buildParallelPlaybackRequest(
      projectWith(
        [mkTrack("p0"), mkTrack("p1"), mkTrack("s0", { muted: true })],
        [mkBox("main", ["s0"])]
      ),
      null
    );
    if (result === null || "error" in result) throw new Error("expected a request");
    expect(result.trackFlowBoxes).toEqual([]);
    expect(result.tracks.map((t) => t.id)).toEqual(["p0", "p1"]);
  });

  it("drops channel-logic rules for muted tracks absent from the request", () => {
    const project = projectWith([mkTrack("p0"), mkTrack("p1"), mkTrack("muted", { muted: true })]);
    project.global.channelConflictPolicy = "allowAll";
    project.global.channelLogicMatrix = [
      { trackAId: "p0", trackBId: "muted", outputChannel: null, policy: "xor" },
      { trackAId: "p0", trackBId: "p1", outputChannel: null, policy: "xor" },
    ];
    project.global.conflictPriority = ["muted", "p1", "p0"];
    const result = buildParallelPlaybackRequest(project, null);
    if (result === null || "error" in result) throw new Error("expected a request");
    expect(result.tracks.map((track) => track.id)).toEqual(["p0", "p1"]);
    expect(result.channelLogicMatrix).toEqual([
      { trackAId: "p0", trackBId: "p1", outputChannel: null, policy: "forceOff" },
    ]);
    expect(result.conflictPriority).toEqual(["p1", "p0"]);
  });

  it("engages the runtime for a box-only project (no parallel tracks)", () => {
    const result = buildParallelPlaybackRequest(
      projectWith([mkTrack("s0"), mkTrack("s1")], [mkBox("main", ["s0", "s1"])]),
      null
    );
    if (result === null || "error" in result) throw new Error("expected a request");
    expect(result.tracks).toEqual([]);
    expect(result.trackFlowBoxes[0]!.sources.map((t) => t.id)).toEqual(["s0", "s1"]);
    // Only the box lane is a participant.
    expect(result.conflictPriority).toEqual(["track-flow-main"]);
  });

  it("omits the lane and stays on the single-track path for a lone parallel track", () => {
    expect(
      buildParallelPlaybackRequest(projectWith([mkTrack("p0")]), null)
    ).toBeNull();
  });

  it("keeps one audible custom-tempo track on the parallel reference clock", () => {
    const result = buildParallelPlaybackRequest(
      projectWith([
        mkTrack("custom", { tempoMode: "custom", customTempoBpm: 123 }),
        mkTrack("muted", { muted: true }),
      ]),
      null
    );
    if (result === null || "error" in result) throw new Error("expected a request");
    expect(result.referenceTempoBpm).toBe(goldenDoc.project.global.tempoBpm);
    expect(result.tracks).toMatchObject([{ id: "custom", tempoBpm: 123 }]);
  });
});

describe("buildParallelPlaybackRequest — triggered & silent sources", () => {
  const baseTrack = goldenDoc.project.tracks[0]!;
  const mkTrack = (id: string, overrides: Partial<typeof baseTrack> = {}) => ({
    ...baseTrack,
    id,
    name: id.toUpperCase(),
    mode: "parallel" as const,
    muted: false,
    soloed: false,
    ...overrides,
  });
  const projectWith = (tracks: (typeof baseTrack)[]) => ({
    ...goldenDoc.project,
    activeTrackId: tracks[0]!.id,
    global: {
      ...goldenDoc.project.global,
      conflictPriority: tracks.map((track) => track.id),
      trackFlowBoxes: [],
    },
    tracks,
  });
  const build = (tracks: (typeof baseTrack)[]) => {
    const result = buildParallelPlaybackRequest(projectWith(tracks), null);
    if (result === null || "error" in result) {
      throw new Error(`expected a request, got ${JSON.stringify(result)}`);
    }
    return result;
  };

  it("realizes a muted trigger source as a silent continuous clock", () => {
    const request = build([
      mkTrack("lead", { muted: true }),
      mkTrack("follow", { trigger: defaultTriggerConfig("lead") }),
    ]);
    // Engage threshold: one audible follower + one silent source = 2 tracks.
    expect(request.tracks.map((track) => [track.id, track.silent])).toEqual([
      ["follow", false],
      ["lead", true],
    ]);
    const lead = request.tracks.find((track) => track.id === "lead")!;
    const follow = request.tracks.find((track) => track.id === "follow")!;
    // The silent clock never forwards its own trigger config; the follower does.
    expect(lead.trigger).toBeNull();
    expect(follow.trigger?.sourceTrackId).toBe("lead");
  });

  it("a muted follower disengages: no silent source, single-track path", () => {
    const request = buildParallelPlaybackRequest(
      projectWith([
        mkTrack("lead"),
        mkTrack("follow", { muted: true, trigger: defaultTriggerConfig("lead") }),
      ]),
      null
    );
    // Only the lead is audible and nothing needs the muted follower's source
    // silently — the single-track path handles it (request is null).
    expect(request).toBeNull();
  });

  it("solo on the follower keeps its hidden source as a silent clock", () => {
    const request = build([
      mkTrack("lead"),
      mkTrack("bystander"),
      mkTrack("follow", { soloed: true, trigger: defaultTriggerConfig("lead") }),
    ]);
    expect(request.tracks.map((track) => [track.id, track.silent])).toEqual([
      ["follow", false],
      ["lead", true],
    ]);
    // The solo-hidden bystander is simply absent.
    expect(request.tracks.some((track) => track.id === "bystander")).toBe(false);
  });

  it("two audible tracks with a trigger engage with both audible", () => {
    const request = build([
      mkTrack("lead"),
      mkTrack("follow", { trigger: defaultTriggerConfig("lead") }),
    ]);
    expect(request.tracks).toHaveLength(2);
    expect(request.tracks.every((track) => !track.silent)).toBe(true);
  });
});

describe("parallelPushDedupKey", () => {
  const request = (trackIds: string[], tempo = 120) =>
    ({
      referenceTempoBpm: tempo,
      referenceCycleBeats: 4,
      channelConflictPolicy: "allowAll",
      channelLogicMatrix: [],
      conflictPriority: [],
      trackFlowBoxes: [],
      tracks: trackIds.map((id) => ({ id, name: id.toUpperCase() })),
    }) as unknown as Parameters<typeof parallelPushDedupKey>[0];

  it("ignores track order (active-first reordering is not an edit)", () => {
    expect(parallelPushDedupKey(request(["t2", "t1"]))).toBe(
      parallelPushDedupKey(request(["t1", "t2"]))
    );
  });

  it("still distinguishes genuine parameter edits", () => {
    expect(parallelPushDedupKey(request(["t1", "t2"], 120))).not.toBe(
      parallelPushDedupKey(request(["t1", "t2"], 121))
    );
  });
});
