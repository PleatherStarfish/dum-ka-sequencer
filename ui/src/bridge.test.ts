/**
 * Bridge invoke-contract tests.
 *
 * `bridge.ts` is the seam between the React app and the Rust/Tauri backend. The
 * value of these tests is catching DRIFT: if a Rust `#[tauri::command]` is
 * renamed, or a parameter key changes on one side but not the other, the app
 * breaks only at runtime. Here we mock the Tauri primitives and assert the
 * exact command name + argument shape each wrapper sends. These strings must
 * stay in lockstep with `src-tauri/src/main.rs` command definitions and their
 * registration list.
 *
 * Pure contract checks — no DOM, no real backend.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// --- Mock the Tauri primitives the bridge imports ------------------------
// Typed as (...args: any[]) so the bridge's varied call signatures spread in
// cleanly; these are test doubles, not the real typed APIs.
const invokeMock = vi.fn((..._args: any[]): Promise<unknown> => Promise.resolve(undefined));
const saveMock = vi.fn((..._args: any[]): Promise<string | null> => Promise.resolve("/tmp/chosen-path"));
const openMock = vi.fn((..._args: any[]): Promise<string | null> => Promise.resolve("/tmp/opened-path"));
const askMock = vi.fn((..._args: any[]): Promise<boolean> => Promise.resolve(true));
const listenMock = vi.fn((..._args: any[]): Promise<() => void> => Promise.resolve(() => undefined));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: any[]) => listenMock(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: any[]) => saveMock(...args),
  open: (...args: any[]) => openMock(...args),
  ask: (...args: any[]) => askMock(...args),
}));

import * as bridge from "./bridge";
import { buildTrackEnvelope, createNeutralPatchDocument } from "./patchIo";

afterEach(() => {
  vi.clearAllMocks();
});

describe("bridge lossless seed DTO normalization", () => {
  it("normalizes generator preview seeds at the invoke boundary", async () => {
    invokeMock.mockResolvedValueOnce({
      seed: {
        seed: "9007199254740993",
        source: "history",
        history: [7, "18446744073709551615"],
      },
      spans: [],
    });

    const preview = await bridge.generatorPreview({} as bridge.GeneratorPreviewRequest);
    expect(preview.seed).toEqual({
      seed: "9007199254740993",
      source: "history",
      history: ["7", "18446744073709551615"],
    });
    expect(preview.trace).toEqual([]);
    expect(preview.densityCorridor).toBeNull();
    expect(preview.workingSubdivision).toBeNull();
    expect(preview.complexityCorridor).toBeNull();
    expect(preview.stateComplexityMilli).toBeNull();
    expect(preview.stateDepthDiversityMilli).toBeNull();
  });

  it("preserves directive trace entries at the invoke boundary", async () => {
    invokeMock.mockResolvedValueOnce({
      seed: { seed: "5", source: "locked", history: [] },
      spans: [],
      trace: [
        {
          cycle: 13,
          directiveId: 41,
          family: "barlowRemove",
          requested: 2,
          applied: 1,
          skipped: "projection",
          complexityCorridorClamp: {
            limit: "ceiling",
            complexityMilli: 42_000,
          },
        },
      ],
      densityCorridor: { floor: 20, ceiling: 60 },
      workingSubdivision: 12,
      complexityCorridor: { floor: 10_000, ceiling: 42_000 },
      stateComplexityMilli: 37_500,
      stateDepthDiversityMilli: 62_500,
    });

    const preview = await bridge.generatorPreview({} as bridge.GeneratorPreviewRequest);
    expect(preview.trace).toEqual([
      expect.objectContaining({ directiveId: 41, applied: 1, skipped: "projection" }),
    ]);
    expect(preview.densityCorridor).toEqual({ floor: 20, ceiling: 60 });
    expect(preview.workingSubdivision).toBe(12);
    expect(preview.complexityCorridor).toEqual({
      floor: 10_000,
      ceiling: 42_000,
    });
    expect(preview.stateComplexityMilli).toBe(37_500);
    expect(preview.stateDepthDiversityMilli).toBe(62_500);
  });

  it("offers only Dum-Ka extensions so pickers never invite Caesura files", () => {
    expect(bridge.PATCH_FILE_FILTERS.flatMap((f) => f.extensions)).toEqual([
      "dumka",
    ]);
    expect(bridge.TRACK_FILE_FILTERS.flatMap((f) => f.extensions)).toEqual([
      "dumka-track",
    ]);
    // Cycle JSON remains a deliberate interchange format, but saves lead
    // with the Dum-Ka name so they can never land on a Caesura .cseq.json.
    expect(bridge.SCORE_FILE_FILTERS[0]!.extensions[0]).toBe("dumka-cycle.json");
  });

  it("sends dumka generator requests through the tagged union verbatim", async () => {
    invokeMock.mockResolvedValueOnce({
      seed: { seed: "5", source: "locked", history: [] },
      spans: [],
    });

    const request: bridge.GeneratorPreviewRequest = {
      spans: [
        { spanId: 1, spanLen: 16, label: null, sectionIndex: 1, subdivision: 4 },
      ],
      enabled: true,
      generator: {
        kind: "dumka",
        pattern: "[dum@3 ka] [. ka] [dum ka dum ka dum]@2",
        evolutionRate: 0,
        driftLeash: 25,
        densityFloor: 0,
        densityCeiling: 100,
        subdivisionPalette: [],
        complexityFloor: 0,
        complexityCeiling: 100_000,
        placementBias: 0,
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
        evolutionCurve: {
        enabled: false,
        modelVersion: "v1",
        toleranceMilli: 500,
        maxOperations: 4,
        points: [],
      },
      propertyCurves: [],
      seedMode: { type: "locked", seed: 5 },
      },
      cycle: 0,
      cycleBeats: 4,
    };
    await bridge.generatorPreview(request);
    expect(invokeMock).toHaveBeenCalledWith("generator_preview", { request });
    const sent = invokeMock.mock.calls[0]![1] as {
      request: bridge.GeneratorPreviewRequest;
    };
    expect(sent.request.generator).toEqual({
      kind: "dumka",
      pattern: "[dum@3 ka] [. ka] [dum ka dum ka dum]@2",
      evolutionRate: 0,
      driftLeash: 25,
      densityFloor: 0,
      densityCeiling: 100,
      subdivisionPalette: [],
      complexityFloor: 0,
      complexityCeiling: 100_000,
      placementBias: 0,
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
      evolutionCurve: {
        enabled: false,
        modelVersion: "v1",
        toleranceMilli: 500,
        maxOperations: 4,
        points: [],
      },
      propertyCurves: [],
      plan: [],
      planLengthCycles: 0,
      seedMode: { type: "locked", seed: 5 },
    });
  });

  it("normalizes subdivision-preview history from legacy numbers", async () => {
    invokeMock.mockResolvedValueOnce({
      cycle: 0,
      beats: [],
      pulseSpans: [],
      historySeeds: [7, "9007199254740993", "18446744073709551615"],
    });

    const preview = await bridge.scorePreviewSubdivisionSwitch(
      "lossless",
      4,
      [],
      [],
      null,
      null,
      null,
      null,
      [],
      [],
      "history",
      0,
      ["9007199254740993"],
      1,
      1,
      8,
      15,
      50,
      16,
      false,
      {
        beatStart: { min: 80, max: 100 },
        sectionStartExtra: { min: 0, max: 0 },
        jathiStart: { min: 0, max: 0 },
        jathiMode: "overrideGati",
      },
      60,
      100,
      80,
      0
    );

    expect(preview.historySeeds).toEqual([
      "7",
      "9007199254740993",
      "18446744073709551615",
    ]);
  });

  it("passes opaque current-score seed strings through without conversion", async () => {
    const score = {
      seed: "9007199254740993",
      historySeeds: ["9007199254740993", "18446744073709551615"],
    };
    invokeMock.mockResolvedValueOnce(score);
    await expect(bridge.scoreGetCurrent()).resolves.toEqual(score);
  });
});

describe("bridge invoke contracts — patch persistence", () => {
  it("patchSaveToPath projects a spread-copied document to the v1 disk shape", async () => {
    const authored = createNeutralPatchDocument({ savedAt: "2026-08-03T00:00:00Z" });
    const spreadCopy = { ...authored };
    expect(Object.prototype.hasOwnProperty.call(spreadCopy, "toJSON")).toBe(false);

    await bridge.patchSaveToPath("/x.dumka", spreadCopy);
    const persisted = invokeMock.mock.calls[0]?.[1]?.patch as Record<string, unknown>;
    expect(invokeMock).toHaveBeenCalledWith("patch_save_to_path", {
      path: "/x.dumka",
      patch: persisted,
    });
    expect(persisted).not.toHaveProperty("rhythm");
    expect(persisted).not.toHaveProperty("pitchShaper");
    expect(persisted).not.toHaveProperty("scoreSnapshot");
    expect(persisted.sequencer).not.toHaveProperty("newSeedChance");
    expect(persisted.channelHocket).not.toHaveProperty("blendCycles");
  });

  it("projects evolution rows through the strict v1 normalizer before save", async () => {
    const authored = createNeutralPatchDocument();
    authored.generator = {
      kind: "dumka",
      pattern: "x . x .",
      plan: [
        {
          id: 41,
          order: 9,
          enabled: true,
          fromCycle: 13,
          toCycle: 13,
          family: "barlowRemove",
          intensity: 15,
          options: { barlowTemperature: 0, unsupportedOption: true },
        },
        {
          id: 42,
          order: 10,
          enabled: true,
          fromCycle: 20,
          toCycle: 20,
          family: "unknownFutureFamily",
          intensity: 50,
        },
      ],
      planLengthCycles: 24,
    } as unknown as typeof authored.generator;

    await bridge.patchSaveToPath("/x.dumka", { ...authored });
    const persisted = invokeMock.mock.calls[0]?.[1]?.patch as {
      generator: Record<string, unknown>;
    };
    expect(persisted.generator).toMatchObject({
      kind: "dumka",
      planLengthCycles: 24,
      plan: [
        {
          id: 41,
          order: 0,
          family: "barlowRemove",
          options: {
            barlowTemperature: 0,
            rotateDirection: "earlier",
          },
        },
      ],
    });
    expect(JSON.stringify(persisted.generator)).not.toContain("unsupportedOption");
    expect(JSON.stringify(persisted.generator)).not.toContain("unknownFutureFamily");
  });

  it("patchLoadFromPath → patch_load_from_path { path }", async () => {
    await bridge.patchLoadFromPath("/x.dumka");
    expect(invokeMock).toHaveBeenCalledWith("patch_load_from_path", {
      path: "/x.dumka",
    });
  });

  it("patchAutosave / patchLoadAutosave / patchClearAutosave command names", async () => {
    const authored = createNeutralPatchDocument();
    await bridge.patchAutosave({ ...authored });
    const persisted = invokeMock.mock.calls[0]?.[1]?.patch as Record<string, unknown>;
    expect(invokeMock).toHaveBeenCalledWith("patch_autosave", { patch: persisted });
    expect(persisted).not.toHaveProperty("cycleTempoFlux");
    await bridge.patchLoadAutosave();
    expect(invokeMock).toHaveBeenCalledWith("patch_load_autosave");
    await bridge.patchClearAutosave();
    expect(invokeMock).toHaveBeenCalledWith("patch_clear_autosave");
  });
});

describe("bridge invoke contracts — single-track export/import", () => {
  it("trackSaveToPath projects a spread-copied envelope to v1", async () => {
    const patch = createNeutralPatchDocument();
    const envelope = buildTrackEnvelope(
      patch.project.tracks[0]!,
      { tempoBpm: 80, cycleBeats: 4 },
      "2026-08-03T00:00:00Z"
    );
    await bridge.trackSaveToPath("/t.dumka-track", { ...envelope });
    const persisted = invokeMock.mock.calls[0]?.[1]?.document as Record<string, unknown>;
    expect(invokeMock).toHaveBeenCalledWith("track_save_to_path", {
      path: "/t.dumka-track",
      document: persisted,
    });
    expect(persisted.track).not.toHaveProperty("rhythm");
    expect(persisted.track).not.toHaveProperty("pitchShaper");
    expect((persisted.track as Record<string, unknown>).sequencer).not.toHaveProperty(
      "holdChance"
    );
  });

  it("trackLoadFromPath → track_load_from_path { path }", async () => {
    await bridge.trackLoadFromPath("/t.dumka-track");
    expect(invokeMock).toHaveBeenCalledWith("track_load_from_path", {
      path: "/t.dumka-track",
    });
  });

  it("the param key is `document` (NOT `patch`/`track`) — guards Rust signature", async () => {
    const patch = createNeutralPatchDocument();
    await bridge.trackSaveToPath(
      "/t",
      buildTrackEnvelope(patch.project.tracks[0]!, {
        tempoBpm: 80,
        cycleBeats: 4,
      })
    );
    const args = invokeMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args)).toEqual(["path", "document"]);
  });
});

describe("bridge invoke contracts — transport / synth", () => {
  it("transport commands use the documented names", async () => {
    await bridge.transportPlay();
    await bridge.transportStop();
    await bridge.transportResync();
    await bridge.transportSetTempo(123);
    const names = invokeMock.mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      "transport_play",
      "transport_stop",
      "transport_resync",
      "transport_set_tempo",
    ]);
    expect(invokeMock).toHaveBeenLastCalledWith("transport_set_tempo", { bpm: 123 });
  });

  it("requests the exact telemetry subset", async () => {
    await bridge.transportSetTelemetryInterest("seedTraceAndTrigger");
    expect(invokeMock).toHaveBeenLastCalledWith(
      "transport_set_telemetry_interest",
      { interest: "seedTraceAndTrigger" }
    );
  });

  it("synthSetEnabled / synthSetPrograms", async () => {
    await bridge.synthSetEnabled(true);
    expect(invokeMock).toHaveBeenCalledWith("synth_set_enabled", { enabled: true });
    await bridge.synthSetPrograms([]);
    expect(invokeMock).toHaveBeenCalledWith("synth_set_programs", { programs: [] });
  });
});

describe("bridge dialog contracts", () => {
  it("trackChooseSavePath passes the track filters and default name", async () => {
    await bridge.trackChooseSavePath("song.dumka-track");
    expect(saveMock).toHaveBeenCalledTimes(1);
    const opts = saveMock.mock.calls[0]?.[0] as {
      defaultPath: string;
      filters: { name: string; extensions: string[] }[];
    };
    expect(opts.defaultPath).toBe("song.dumka-track");
    expect(opts.filters.flatMap((f) => f.extensions)).toContain("dumka-track");
  });

  it("trackChooseOpenPath uses the open dialog with track filters", async () => {
    await bridge.trackChooseOpenPath();
    expect(openMock).toHaveBeenCalledTimes(1);
    const opts = openMock.mock.calls[0]?.[0] as {
      multiple: boolean;
      filters: { extensions: string[] }[];
    };
    expect(opts.multiple).toBe(false);
    expect(opts.filters.flatMap((f) => f.extensions)).toContain("dumka-track");
  });

  it("a cancelled dialog (null) propagates as null", async () => {
    saveMock.mockResolvedValueOnce(null as unknown as string);
    expect(await bridge.trackChooseSavePath()).toBeNull();
    openMock.mockResolvedValueOnce(null as unknown as string);
    expect(await bridge.trackChooseOpenPath()).toBeNull();
  });

  it("trackAskKeepTimingOnImport returns the dialog's boolean answer", async () => {
    askMock.mockResolvedValueOnce(true);
    await expect(
      bridge.trackAskKeepTimingOnImport("My Track", 120, 8, 90, 16)
    ).resolves.toBe(true);
    askMock.mockResolvedValueOnce(false);
    await expect(
      bridge.trackAskKeepTimingOnImport("My Track", 120, 8, 90, 16)
    ).resolves.toBe(false);
    // The prompt should mention both the saved and destination timings.
    const message = askMock.mock.calls[0]?.[0];
    expect(String(message)).toContain("120");
    expect(String(message)).toContain("90");
  });
});

describe("bridge file filters", () => {
  it("track filters are distinct from patch filters and use the right extension", () => {
    expect(bridge.TRACK_FILE_FILTERS.flatMap((f) => f.extensions)).toContain(
      "dumka-track"
    );
    expect(bridge.PATCH_FILE_FILTERS.flatMap((f) => f.extensions)).toContain(
      "dumka"
    );
    // A track file should not be offered the bare patch extension as primary.
    expect(bridge.TRACK_FILE_FILTERS[0]!.extensions[0]).toBe("dumka-track");
  });
});

describe("parallelSetPlayback trigger contract", () => {
  it("forwards parallel_set_playback with the per-track trigger config intact", async () => {
    const request: bridge.ParallelPlaybackRequest = {
      tracks: [
        {
          id: "lead",
          name: "Lead",
          score: {} as bridge.ParallelPlaybackScoreRequest,
          playback: {} as bridge.TrackPlaybackRequest,
          tempoBpm: 80,
          trigger: null,
        },
        {
          id: "follow",
          name: "Follow",
          score: {} as bridge.ParallelPlaybackScoreRequest,
          playback: {} as bridge.TrackPlaybackRequest,
          tempoBpm: 80,
          trigger: {
            sourceTrackId: "lead",
            when: {
              beats: { type: "at", beat: 3 },
              tree: { type: "leaf", predicate: { type: "isRest" } },
            },
            launchAlignment: { type: "atEvent" },
            lifetime: { type: "onePass" },
            reTrigger: "restart",
            length: { type: "scoreCycle" },
            maxRepeats: 64,
          },
        },
      ],
      referenceTempoBpm: 80,
      referenceCycleBeats: 4,
      channelConflictPolicy: "allowAll",
      channelLogicMatrix: [],
      conflictPriority: ["lead", "follow"],
      trackFlowBoxes: [],
    };
    await bridge.parallelSetPlayback(request);
    // Default apply is immediate (nextCycle: false); P1 in-place apply is opt-in.
    expect(invokeMock).toHaveBeenCalledWith("parallel_set_playback", {
      request,
      nextCycle: false,
    });
    // The trigger must survive verbatim under request.tracks[1].trigger.
    const sent = invokeMock.mock.calls[0]![1] as { request: bridge.ParallelPlaybackRequest };
    expect(sent.request.tracks[1]!.trigger!.when).toEqual({
      beats: { type: "at", beat: 3 },
      tree: { type: "leaf", predicate: { type: "isRest" } },
    });
    expect(sent.request.tracks[1]!.trigger!.sourceTrackId).toBe("lead");
  });

  it("forwards nextCycle for the P1 in-place forward apply", async () => {
    await bridge.parallelSetPlayback(null, { nextCycle: true });
    expect(invokeMock).toHaveBeenCalledWith("parallel_set_playback", {
      request: null,
      nextCycle: true,
    });
  });
});
