import { describe, expect, it, vi } from "vitest";

import {
  asyncAuthoringIntentIsCurrent,
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
  telemetryLogsRequested,
  transportTempoFollowMode,
  updateCurrentValue,
  visualTransportNeedsPublish,
} from "./appInteractionPerformance";

describe("App interaction performance guards", () => {
  it("does not publish an unchanged stopped visual transport every frame", () => {
    const position = { currentTick: 120, currentCycle: 3 };
    expect(visualTransportNeedsPublish(position, { ...position }, false)).toBe(false);
    expect(
      visualTransportNeedsPublish(position, { currentTick: 121, currentCycle: 3 }, false)
    ).toBe(true);
    expect(
      visualTransportNeedsPublish(position, { currentTick: 121, currentCycle: 3 }, true)
    ).toBe(false);
    expect(
      visualTransportNeedsPublish(position, { currentTick: 0, currentCycle: 4 }, true)
    ).toBe(true);
  });

  it("does not let a stale transport snapshot replace newer tempo intent", () => {
    expect(
      transportTempoFollowMode({
        isPlaying: false,
        transitionKind: "starting",
        applyingPatch: false,
        tempoWritePending: false,
        followsTransport: true,
      })
    ).toBe("ignore");
    expect(
      transportTempoFollowMode({
        isPlaying: false,
        transitionKind: "idle",
        applyingPatch: true,
        tempoWritePending: false,
        followsTransport: true,
      })
    ).toBe("ignore");
    expect(
      transportTempoFollowMode({
        isPlaying: false,
        transitionKind: "idle",
        applyingPatch: false,
        tempoWritePending: true,
        followsTransport: true,
      })
    ).toBe("ignore");
    expect(
      transportTempoFollowMode({
        isPlaying: false,
        transitionKind: "idle",
        applyingPatch: false,
        tempoWritePending: false,
        followsTransport: true,
      })
    ).toBe("adopt");
    expect(
      transportTempoFollowMode({
        isPlaying: true,
        transitionKind: "idle",
        applyingPatch: false,
        tempoWritePending: false,
        followsTransport: true,
      })
    ).toBe("display");
    expect(
      transportTempoFollowMode({
        isPlaying: false,
        transitionKind: "idle",
        applyingPatch: false,
        tempoWritePending: false,
        followsTransport: false,
      })
    ).toBe("ignore");
  });

  it("requests log telemetry only for visible or recording consumers", () => {
    const closed = {
      midiDebugOpen: false,
      automationDebugOpen: false,
      parallelConflictDebugOpen: false,
      seedPathRecording: false,
      triggerInspectorVisible: false,
    };
    expect(telemetryLogsRequested(closed)).toBe(false);
    expect(
      telemetryLogsRequested({ ...closed, parallelConflictDebugOpen: true })
    ).toBe(true);
    expect(telemetryLogsRequested({ ...closed, triggerInspectorVisible: true })).toBe(true);
    expect(telemetryLogInterestRequested(closed)).toBe("none");
    expect(
      telemetryLogInterestRequested({ ...closed, seedPathRecording: true })
    ).toBe("seedTrace");
    expect(
      telemetryLogInterestRequested({ ...closed, triggerInspectorVisible: true })
    ).toBe("trigger");
    expect(
      telemetryLogInterestRequested({
        ...closed,
        seedPathRecording: true,
        triggerInspectorVisible: true,
      })
    ).toBe("seedTraceAndTrigger");
    expect(
      telemetryLogInterestRequested({
        ...closed,
        seedPathRecording: true,
        midiDebugOpen: true,
      })
    ).toBe("full");

    expect(telemetryLogLayersForInterest("trigger")).toEqual({
      fullDiagnostics: false,
      seedTrace: false,
      triggerDecision: true,
    });
    expect(telemetryLogLayersForInterest("seedTraceAndTrigger")).toEqual({
      fullDiagnostics: false,
      seedTrace: true,
      triggerDecision: true,
    });
    expect(telemetryLogLayersForInterest("full")).toEqual({
      fullDiagnostics: true,
      seedTrace: true,
      triggerDecision: true,
    });
  });

  it("does no debug row allocation while an inspector is closed", () => {
    const events = [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }];
    expect(debugTailWhenOpen(events, false, 2)).toEqual([]);
    expect(debugTailWhenOpen(events, true, 2)).toEqual([
      { sequence: 3 },
      { sequence: 2 },
    ]);
  });

  it("rejects autosave work before patch construction when unavailable", () => {
    expect(
      shouldStartAutosaveCheck({
        enabled: false,
        applyingPatch: false,
        buildInFlight: false,
        saveInFlight: false,
        manualSaveInFlight: false,
      })
    ).toBe(false);
    expect(
      shouldStartAutosaveCheck({
        enabled: true,
        applyingPatch: false,
        buildInFlight: true,
        saveInFlight: false,
        manualSaveInFlight: false,
      })
    ).toBe(false);
    expect(
      shouldStartAutosaveCheck({
        enabled: true,
        applyingPatch: false,
        buildInFlight: false,
        saveInFlight: false,
        manualSaveInFlight: false,
      })
    ).toBe(true);
    expect(
      shouldStartAutosaveCheck({
        enabled: true,
        applyingPatch: false,
        buildInFlight: false,
        saveInFlight: false,
        manualSaveInFlight: true,
      })
    ).toBe(false);
  });

  it("discards a patch built across an autosave generation change", () => {
    expect(
      autosaveBuildIsCurrent({
        enabled: true,
        startedGeneration: 3,
        currentGeneration: 4,
      })
    ).toBe(false);
    expect(
      autosaveBuildIsCurrent({
        enabled: true,
        startedGeneration: 4,
        currentGeneration: 4,
      })
    ).toBe(true);
  });

  it("abandons delayed startup restore after user interaction or a newer document", () => {
    expect(
      startupRestoreIsCurrent({
        documentIntent: 1,
        currentDocumentIntent: 1,
        userInteracted: false,
      })
    ).toBe(true);
    expect(
      startupRestoreIsCurrent({
        documentIntent: 1,
        currentDocumentIntent: 1,
        userInteracted: true,
      })
    ).toBe(false);
    expect(
      startupRestoreIsCurrent({
        documentIntent: 1,
        currentDocumentIntent: 2,
        userInteracted: false,
      })
    ).toBe(false);
  });

  it("rejects async authoring after either a newer request or a manual edit", () => {
    const current = {
      requestGeneration: 4,
      currentRequestGeneration: 4,
      authoringGeneration: 9,
      currentAuthoringGeneration: 9,
    };
    expect(asyncAuthoringIntentIsCurrent(current)).toBe(true);
    expect(
      asyncAuthoringIntentIsCurrent({
        ...current,
        currentRequestGeneration: 5,
      })
    ).toBe(false);
    expect(
      asyncAuthoringIntentIsCurrent({
        ...current,
        currentAuthoringGeneration: 10,
      })
    ).toBe(false);
  });

  it("returns backend ownership to the staged single-track editor after Stop", () => {
    expect(
      singleTrackBackendOwnerAvailable({
        suppressed: false,
        runningParallel: true,
        transitionKind: "stopping",
      })
    ).toBe(false);
    expect(
      singleTrackBackendOwnerAvailable({
        suppressed: false,
        runningParallel: false,
        transitionKind: "idle",
      })
    ).toBe(true);
    expect(
      singleTrackBackendOwnerAvailable({
        suppressed: true,
        runningParallel: false,
        transitionKind: "idle",
      })
    ).toBe(false);
  });

  it("blocks structural track actions throughout a Play transition", () => {
    const idle = {
      isPlaying: false,
      playbackSessionActive: false,
      transitionKind: "idle" as const,
      startedTransitionGeneration: 4,
      currentTransitionGeneration: 4,
    };
    expect(structuralTrackActionIsCurrent(idle)).toBe(true);
    expect(
      structuralTrackActionIsCurrent({
        ...idle,
        transitionKind: "starting",
        currentTransitionGeneration: 5,
      })
    ).toBe(false);
    // Even after the transition returns to idle, an action that began before
    // it must not apply its stale patch build to the now-running session.
    expect(
      structuralTrackActionIsCurrent({
        ...idle,
        playbackSessionActive: true,
        currentTransitionGeneration: 5,
      })
    ).toBe(false);
  });

  it("does not let background cleanup supersede Play's direct score apply", async () => {
    const queue = createLatestWinsQueue<void>();
    let resolvePlay!: () => void;
    const playApply = enqueueLatestWins(queue, {
      key: "play-score",
      run: () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    });

    if (backgroundQueueCleanupAllowed("starting")) {
      setLatestWinsDesired(queue, null);
    }
    resolvePlay();

    await expect(playApply).resolves.toEqual({
      status: "applied",
      value: undefined,
    });
    expect(backgroundQueueCleanupAllowed("idle")).toBe(true);
  });

  it("keeps the last coherent preview until the replacement is ready", () => {
    const previous = { cycle: 2 };
    expect(renderedPreviewWhilePending(null, false, previous)).toEqual({
      preview: previous,
      stale: true,
    });
    const current = { cycle: 3 };
    expect(renderedPreviewWhilePending(current, true, previous)).toEqual({
      preview: current,
      stale: false,
    });
  });

  it("coalesces concurrent work by request key and clears after settlement", async () => {
    const requests = new Map<string, Promise<number>>();
    let resolve!: (value: number) => void;
    const start = vi.fn(
      () =>
        new Promise<number>((nextResolve) => {
          resolve = nextResolve;
        })
    );

    const first = coalesceInFlightRequest(requests, "same", start);
    const second = coalesceInFlightRequest(requests, "same", start);
    expect(second).toBe(first);
    expect(start).toHaveBeenCalledTimes(1);
    resolve(7);
    await expect(first).resolves.toBe(7);
    await Promise.resolve();

    await expect(
      coalesceInFlightRequest(requests, "same", async () => 8)
    ).resolves.toBe(8);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("serializes score writes and replaces the single pending task with the latest", async () => {
    const queue = createLatestWinsQueue<void>();
    const starts: string[] = [];
    let resolveFirst!: () => void;
    let resolveLatest!: () => void;

    const first = enqueueLatestWins(queue, {
      key: "A",
      run: () =>
        new Promise<void>((resolve) => {
          starts.push("A");
          resolveFirst = resolve;
        }),
    });
    const dropped = enqueueLatestWins(queue, {
      key: "B",
      run: async () => {
        starts.push("B");
      },
    });
    const latest = enqueueLatestWins(queue, {
      key: "C",
      run: () =>
        new Promise<void>((resolve) => {
          starts.push("C");
          resolveLatest = resolve;
        }),
    });

    expect(starts).toEqual(["A"]);
    expect(queue.pending?.key).toBe("C");
    await expect(dropped).resolves.toEqual({ status: "superseded" });
    resolveFirst();
    await expect(first).resolves.toEqual({ status: "superseded" });
    expect(starts).toEqual(["A", "C"]);

    resolveLatest();
    await expect(latest).resolves.toEqual({
      status: "applied",
      value: undefined,
    });
    expect(queue.inFlightKey).toBeNull();
  });

  it("lets an immediate same-key apply await the command already in flight", async () => {
    const queue = createLatestWinsQueue<void>();
    let resolveFirst!: () => void;
    const duplicateRun = vi.fn(async () => undefined);

    const automatic = enqueueLatestWins(queue, {
      key: "current",
      run: () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    });
    const immediate = enqueueLatestWins(queue, {
      key: "current",
      run: duplicateRun,
    });

    expect(immediate).toBe(automatic);
    expect(duplicateRun).not.toHaveBeenCalled();
    resolveFirst();
    await expect(immediate).resolves.toEqual({
      status: "applied",
      value: undefined,
    });
    expect(duplicateRun).not.toHaveBeenCalled();
  });

  it("supersedes a pending immediate apply when a newer edit wins", async () => {
    const queue = createLatestWinsQueue<void>();
    let resolveFirst!: () => void;
    const pendingPlayRun = vi.fn(async () => undefined);

    enqueueLatestWins(queue, {
      key: "A",
      run: () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    });
    const pendingPlay = enqueueLatestWins(queue, {
      key: "B",
      run: pendingPlayRun,
    });
    const newest = enqueueLatestWins(queue, {
      key: "C",
      run: async () => undefined,
    });

    await expect(pendingPlay).resolves.toEqual({ status: "superseded" });
    expect(pendingPlayRun).not.toHaveBeenCalled();
    resolveFirst();
    await expect(newest).resolves.toEqual({
      status: "applied",
      value: undefined,
    });
  });

  it("suppresses stale errors and restores a desired key behind a competing write", async () => {
    const queue = createLatestWinsQueue<void>();
    let rejectFirst!: (error: unknown) => void;

    const stale = enqueueLatestWins(queue, {
      key: "A",
      run: () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    });
    setLatestWinsDesired(queue, "B");

    expect(latestWinsNeedsEnqueue(queue, "B", "B")).toBe(true);
    const desired = enqueueLatestWins(queue, {
      key: "B",
      run: async () => undefined,
    });
    rejectFirst(new Error("stale"));
    await expect(stale).resolves.toEqual({ status: "superseded" });
    await expect(desired).resolves.toEqual({
      status: "applied",
      value: undefined,
    });

    expect(queue.desiredKey).toBe("B");
    expect(queue.inFlightKey).toBeNull();
  });

  it("reports a backend error when its key is still desired", async () => {
    const queue = createLatestWinsQueue<void>();
    const failure = new Error("current failure");

    await expect(
      enqueueLatestWins(queue, {
        key: "current",
        run: async () => {
          throw failure;
        },
      })
    ).resolves.toEqual({ status: "error", error: failure });
  });

  it("deduplicates an already-current write and retries after a failure", async () => {
    const queue = createLatestWinsQueue<void>();
    const lastApplied = { current: "current" };
    const run = vi.fn(async () => undefined);

    await expect(
      ensureLatestWins(queue, lastApplied, { key: "current", run })
    ).resolves.toEqual({ status: "current" });
    expect(run).not.toHaveBeenCalled();

    const failure = new Error("temporary failure");
    await expect(
      ensureLatestWins(queue, lastApplied, {
        key: "new",
        run: async () => {
          throw failure;
        },
      })
    ).resolves.toEqual({ status: "error", error: failure });
    expect(lastApplied.current).toBe("current");

    await expect(
      ensureLatestWins(queue, lastApplied, { key: "new", run })
    ).resolves.toEqual({ status: "applied", value: undefined });
    expect(run).toHaveBeenCalledTimes(1);
    expect(lastApplied.current).toBe("new");
  });

  it("can force an already-current command while still joining the same key in flight", async () => {
    const queue = createLatestWinsQueue<void>();
    const lastApplied = { current: "current" };
    let resolve!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((nextResolve) => {
          resolve = nextResolve;
        })
    );

    const forced = ensureLatestWins(
      queue,
      lastApplied,
      { key: "current", run },
      { force: true }
    );
    const joined = ensureLatestWins(
      queue,
      lastApplied,
      { key: "current", run },
      { force: true }
    );

    expect(run).toHaveBeenCalledTimes(1);
    resolve();
    await expect(forced).resolves.toEqual({ status: "applied", value: undefined });
    await expect(joined).resolves.toEqual({ status: "applied", value: undefined });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("joins a same-key write and restores the last key behind a competing write", async () => {
    const queue = createLatestWinsQueue<void>();
    const lastApplied = { current: "A" };
    let resolveB!: () => void;
    const restoreA = vi.fn(async () => undefined);

    const firstB = ensureLatestWins(queue, lastApplied, {
      key: "B",
      run: () =>
        new Promise<void>((resolve) => {
          resolveB = resolve;
        }),
    });
    const joinedB = ensureLatestWins(queue, lastApplied, {
      key: "B",
      run: vi.fn(async () => undefined),
    });
    const restored = ensureLatestWins(queue, lastApplied, {
      key: "A",
      run: restoreA,
    });

    resolveB();
    await expect(firstB).resolves.toEqual({ status: "superseded" });
    await expect(joinedB).resolves.toEqual({ status: "superseded" });
    await expect(restored).resolves.toEqual({ status: "applied", value: undefined });
    expect(restoreA).toHaveBeenCalledTimes(1);
    expect(lastApplied.current).toBe("A");
  });

  it("does not deduplicate against stale history after a superseded write succeeds", async () => {
    const queue = createLatestWinsQueue<void>();
    const lastApplied = { current: "A" };
    let resolveB!: () => void;

    const staleB = ensureLatestWins(queue, lastApplied, {
      key: "B",
      run: () =>
        new Promise<void>((resolve) => {
          resolveB = resolve;
        }),
    });
    // Model an async request build for the replacement: intent is known, but
    // its concrete task cannot be enqueued until after B has settled.
    setLatestWinsDesired(queue, "building-A");
    resolveB();
    await expect(staleB).resolves.toEqual({ status: "superseded" });
    expect(lastApplied.current).toBe("B");

    const restoreA = vi.fn(async () => undefined);
    await expect(
      ensureLatestWins(queue, lastApplied, { key: "A", run: restoreA })
    ).resolves.toEqual({ status: "applied", value: undefined });
    expect(restoreA).toHaveBeenCalledTimes(1);
    expect(lastApplied.current).toBe("A");
  });

  it("rechecks execution guards before draining a pending task", async () => {
    const queue = createLatestWinsQueue<void>();
    let resolveFirst!: () => void;
    const guardedRun = vi.fn(async () => undefined);

    const first = enqueueLatestWins(queue, {
      key: "A",
      run: () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    });
    const guarded = enqueueLatestWins(queue, {
      key: "B",
      shouldRun: () => false,
      run: guardedRun,
    });

    resolveFirst();
    await expect(first).resolves.toEqual({ status: "superseded" });
    await expect(guarded).resolves.toEqual({ status: "skipped" });

    expect(guardedRun).not.toHaveBeenCalled();
    expect(queue.inFlightKey).toBeNull();
  });

  it("lets explicit Play replace a same-key guarded automatic task", async () => {
    const queue = createLatestWinsQueue<void>();
    let resolveFirst!: () => void;
    const automaticRun = vi.fn(async () => undefined);
    const explicitRun = vi.fn(async () => undefined);

    const first = enqueueLatestWins(queue, {
      key: "A",
      run: () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    });
    const automatic = enqueueLatestWins(queue, {
      key: "B",
      shouldRun: () => false,
      run: automaticRun,
    });

    expect(queue.pending?.key).toBe("B");
    discardLatestWinsPending(queue);
    const explicit = enqueueLatestWins(queue, {
      key: "B",
      run: explicitRun,
    });

    await expect(automatic).resolves.toEqual({ status: "skipped" });
    resolveFirst();
    await expect(first).resolves.toEqual({ status: "superseded" });
    await expect(explicit).resolves.toEqual({
      status: "applied",
      value: undefined,
    });
    expect(automaticRun).not.toHaveBeenCalled();
    expect(explicitRun).toHaveBeenCalledTimes(1);
  });

  it("does not let a slower older save build enqueue after a newer one", async () => {
    const queue = createLatestWinsQueue<void>();
    const generation = { current: 0 };
    const writes: string[] = [];
    let resolveOlder!: (payload: string) => void;
    let resolveNewer!: (payload: string) => void;

    const save = async (build: Promise<string>) => {
      const intent = beginLatestWinsBuildIntent(queue, generation, "save");
      const payload = await build;
      if (!latestWinsBuildIntentIsCurrent(queue, generation, intent)) {
        return "superseded" as const;
      }
      const outcome = await enqueueLatestWins(queue, {
        key: `save:${intent.generation}:${payload}`,
        run: async () => {
          writes.push(payload);
        },
      });
      return outcome.status;
    };

    const older = save(
      new Promise<string>((resolve) => {
        resolveOlder = resolve;
      })
    );
    const newer = save(
      new Promise<string>((resolve) => {
        resolveNewer = resolve;
      })
    );

    resolveNewer("newer");
    await expect(newer).resolves.toBe("applied");
    resolveOlder("older");
    await expect(older).resolves.toBe("superseded");
    expect(writes).toEqual(["newer"]);
  });

  it("composes rapid synchronous project updates from the latest value", () => {
    const holder = { current: { muted: false, edits: 0 } };
    const clone = (value: { muted: boolean; edits: number }) => ({ ...value });
    const toggle = (value: { muted: boolean; edits: number }) => ({
      muted: !value.muted,
      edits: value.edits + 1,
    });

    updateCurrentValue(holder, clone, toggle);
    updateCurrentValue(holder, clone, toggle);
    expect(holder.current).toEqual({ muted: false, edits: 2 });
  });
});
