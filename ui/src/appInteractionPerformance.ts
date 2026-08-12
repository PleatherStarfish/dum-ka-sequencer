/**
 * Small, framework-light helpers for App interaction hot paths. Keeping these
 * decisions pure makes the render/IPC cadence independently testable without
 * mounting the full sequencer UI.
 */

export interface VisualTransportPoint {
  currentTick: number;
  currentCycle: number;
}

export function visualTransportNeedsPublish(
  previous: VisualTransportPoint,
  next: VisualTransportPoint,
  isPlaying: boolean
): boolean {
  return (
    previous.currentCycle !== next.currentCycle ||
    (!isPlaying && previous.currentTick !== next.currentTick)
  );
}

export type TransportTempoFollowMode = "ignore" | "display" | "adopt";

/**
 * Classifies an incoming transport tempo snapshot. A snapshot sampled before a
 * pending Play, patch recall, or tempo command completes must not overwrite the
 * newer authored intent. Stopped, idle transport state may become the authored
 * value; other current snapshots are display-only.
 */
export function transportTempoFollowMode(options: {
  isPlaying: boolean;
  transitionKind: "idle" | "starting" | "stopping";
  applyingPatch: boolean;
  tempoWritePending: boolean;
  followsTransport: boolean;
}): TransportTempoFollowMode {
  if (
    !options.followsTransport ||
    options.transitionKind === "starting" ||
    options.applyingPatch ||
    options.tempoWritePending
  ) {
    return "ignore";
  }
  return !options.isPlaying && options.transitionKind === "idle"
    ? "adopt"
    : "display";
}

export function telemetryLogsRequested(options: {
  midiDebugOpen: boolean;
  automationDebugOpen: boolean;
  parallelConflictDebugOpen: boolean;
  seedPathRecording: boolean;
  triggerInspectorVisible: boolean;
}): boolean {
  return (
    options.midiDebugOpen ||
    options.automationDebugOpen ||
    options.parallelConflictDebugOpen ||
    options.seedPathRecording ||
    options.triggerInspectorVisible
  );
}

export type TelemetryLogInterest =
  | "none"
  | "seedTrace"
  | "trigger"
  | "seedTraceAndTrigger"
  | "full";

export function telemetryLogLayersForInterest(
  interest: TelemetryLogInterest
): {
  fullDiagnostics: boolean;
  seedTrace: boolean;
  triggerDecision: boolean;
} {
  const fullDiagnostics = interest === "full";
  return {
    fullDiagnostics,
    seedTrace:
      fullDiagnostics ||
      interest === "seedTrace" ||
      interest === "seedTraceAndTrigger",
    triggerDecision:
      fullDiagnostics ||
      interest === "trigger" ||
      interest === "seedTraceAndTrigger",
  };
}

/**
 * Seed recording and trigger inspection each need one sparse rolling layer.
 * Only the MIDI/automation/conflict diagnostics require the full log set.
 */
export function telemetryLogInterestRequested(options: {
  midiDebugOpen: boolean;
  automationDebugOpen: boolean;
  parallelConflictDebugOpen: boolean;
  seedPathRecording: boolean;
  triggerInspectorVisible: boolean;
}): TelemetryLogInterest {
  if (
    options.midiDebugOpen ||
    options.automationDebugOpen ||
    options.parallelConflictDebugOpen
  ) {
    return "full";
  }
  if (options.seedPathRecording && options.triggerInspectorVisible) {
    return "seedTraceAndTrigger";
  }
  if (options.triggerInspectorVisible) return "trigger";
  return options.seedPathRecording ? "seedTrace" : "none";
}

export function debugTailWhenOpen<T>(
  events: readonly T[],
  open: boolean,
  limit: number
): T[] {
  if (!open) return [];
  return events.slice(-Math.max(0, Math.floor(limit))).reverse();
}

export function shouldStartAutosaveCheck(options: {
  enabled: boolean;
  applyingPatch: boolean;
  buildInFlight: boolean;
  saveInFlight: boolean;
  manualSaveInFlight: boolean;
}): boolean {
  return (
    options.enabled &&
    !options.applyingPatch &&
    !options.buildInFlight &&
    !options.saveInFlight &&
    !options.manualSaveInFlight
  );
}

export function autosaveBuildIsCurrent(options: {
  enabled: boolean;
  startedGeneration: number;
  currentGeneration: number;
}): boolean {
  return (
    options.enabled &&
    options.startedGeneration === options.currentGeneration
  );
}

export function startupRestoreIsCurrent(options: {
  documentIntent: number;
  currentDocumentIntent: number;
  userInteracted: boolean;
}): boolean {
  return (
    !options.userInteracted &&
    options.documentIntent === options.currentDocumentIntent
  );
}

export function asyncAuthoringIntentIsCurrent(options: {
  requestGeneration: number;
  currentRequestGeneration: number;
  authoringGeneration: number;
  currentAuthoringGeneration: number;
}): boolean {
  return (
    options.requestGeneration === options.currentRequestGeneration &&
    options.authoringGeneration === options.currentAuthoringGeneration
  );
}

export function singleTrackBackendOwnerAvailable(options: {
  suppressed: boolean;
  runningParallel: boolean;
  transitionKind: "idle" | "starting" | "stopping";
}): boolean {
  return (
    !options.suppressed &&
    !options.runningParallel &&
    options.transitionKind === "idle"
  );
}

export function backgroundQueueCleanupAllowed(
  transitionKind: "idle" | "starting" | "stopping"
): boolean {
  return transitionKind === "idle";
}

/**
 * Stop-gated track topology/timing actions must consult live refs, not a render
 * closure captured before an async chooser or patch build. The session flag
 * closes the short gap after acknowledged Play returns but before the next
 * transport snapshot renders; the generation check also detects a complete
 * start/stop transition that happened entirely while the action was awaiting.
 */
export function structuralTrackActionIsCurrent(options: {
  isPlaying: boolean;
  playbackSessionActive: boolean;
  transitionKind: "idle" | "starting" | "stopping";
  startedTransitionGeneration: number;
  currentTransitionGeneration: number;
}): boolean {
  return (
    !options.isPlaying &&
    !options.playbackSessionActive &&
    options.transitionKind === "idle" &&
    options.startedTransitionGeneration === options.currentTransitionGeneration
  );
}

export function renderedPreviewWhilePending<T>(
  current: T | null,
  currentIsReady: boolean,
  lastCoherent: T | null
): { preview: T | null; stale: boolean } {
  if (currentIsReady) {
    return { preview: current, stale: false };
  }
  const preview = lastCoherent ?? current;
  return {
    preview,
    stale: preview !== null && preview !== current,
  };
}

export function coalesceInFlightRequest<T>(
  requests: Map<string, Promise<T>>,
  key: string,
  start: () => Promise<T>
): Promise<T> {
  const existing = requests.get(key);
  if (existing) return existing;

  let pending: Promise<T>;
  try {
    pending = start();
  } catch (error) {
    return Promise.reject(error);
  }
  requests.set(key, pending);
  const clear = () => {
    if (requests.get(key) === pending) {
      requests.delete(key);
    }
  };
  void pending.then(clear, clear);
  return pending;
}

export interface LatestWinsTask<T> {
  key: string;
  run: () => Promise<T>;
  shouldRun?: () => boolean;
}

export type LatestWinsOutcome<T> =
  | { status: "applied"; value: T }
  | { status: "error"; error: unknown }
  | { status: "superseded" }
  | { status: "skipped" };

export type EnsuredLatestWinsOutcome<T> =
  | LatestWinsOutcome<T>
  | { status: "current" };

export interface LatestWinsQueue<T> {
  desiredKey: string | null;
  inFlightKey: string | null;
  pending: LatestWinsTask<T> | null;
  inFlightResult: Promise<LatestWinsOutcome<T>> | null;
  pendingResult: Promise<LatestWinsOutcome<T>> | null;
  pendingSettle: ((outcome: LatestWinsOutcome<T>) => void) | null;
}

export function createLatestWinsQueue<T>(): LatestWinsQueue<T> {
  return {
    desiredKey: null,
    inFlightKey: null,
    pending: null,
    inFlightResult: null,
    pendingResult: null,
    pendingSettle: null,
  };
}

function createLatestWinsResult<T>(): {
  result: Promise<LatestWinsOutcome<T>>;
  settle: (outcome: LatestWinsOutcome<T>) => void;
} {
  let settle!: (outcome: LatestWinsOutcome<T>) => void;
  const result = new Promise<LatestWinsOutcome<T>>((resolve) => {
    settle = resolve;
  });
  return { result, settle };
}

function settlePendingLatestWinsTask<T>(
  queue: LatestWinsQueue<T>,
  outcome: LatestWinsOutcome<T>
): void {
  queue.pendingSettle?.(outcome);
  queue.pending = null;
  queue.pendingResult = null;
  queue.pendingSettle = null;
}

/**
 * Updates intent immediately, before any debounce expires. A queued task for an
 * older key is discarded so it cannot start while the replacement is waiting.
 * An already-running command cannot be cancelled, but its callbacks are gated
 * against `desiredKey` when it settles.
 */
export function setLatestWinsDesired<T>(
  queue: LatestWinsQueue<T>,
  key: string | null
): void {
  queue.desiredKey = key;
  if (queue.pending?.key !== key) {
    settlePendingLatestWinsTask(queue, { status: "superseded" });
  }
}

export function discardLatestWinsPending<T>(queue: LatestWinsQueue<T>): void {
  settlePendingLatestWinsTask(queue, { status: "skipped" });
}

export interface LatestWinsBuildIntent {
  generation: number;
  key: string;
}

/**
 * Claims latest intent before an asynchronous payload build starts. This is
 * important for persistence and other build-then-write flows: a slower older
 * build must not enqueue after a newer build has already completed.
 */
export function beginLatestWinsBuildIntent<T>(
  queue: LatestWinsQueue<T>,
  generation: { current: number },
  keyPrefix: string
): LatestWinsBuildIntent {
  const nextGeneration = generation.current + 1;
  generation.current = nextGeneration;
  const key = `${keyPrefix}:building:${nextGeneration}`;
  setLatestWinsDesired(queue, key);
  return { generation: nextGeneration, key };
}

export function latestWinsBuildIntentIsCurrent<T>(
  queue: LatestWinsQueue<T>,
  generation: { current: number },
  intent: LatestWinsBuildIntent
): boolean {
  return (
    generation.current === intent.generation && queue.desiredKey === intent.key
  );
}

/**
 * Returning to the last-applied key still needs a write when a different key is
 * already in flight: that older command will mutate the backend even though its
 * React callbacks are ignored.
 */
export function latestWinsNeedsEnqueue<T>(
  queue: LatestWinsQueue<T>,
  key: string,
  lastAppliedKey: string
): boolean {
  if (queue.inFlightKey === key || queue.pending?.key === key) return false;
  return key !== lastAppliedKey || queue.inFlightKey !== null;
}

async function runLatestWinsTask<T>(
  queue: LatestWinsQueue<T>,
  task: LatestWinsTask<T>,
  result: Promise<LatestWinsOutcome<T>>,
  settle: (outcome: LatestWinsOutcome<T>) => void
): Promise<void> {
  if (queue.desiredKey !== task.key) {
    settle({ status: "superseded" });
    return;
  }
  if (task.shouldRun?.() === false) {
    settle({ status: "skipped" });
    return;
  }

  queue.inFlightKey = task.key;
  queue.inFlightResult = result;
  try {
    const value = await task.run();
    if (queue.desiredKey === task.key) {
      settle({ status: "applied", value });
    } else {
      settle({ status: "superseded" });
    }
  } catch (error) {
    if (queue.desiredKey === task.key) {
      settle({ status: "error", error });
    } else {
      settle({ status: "superseded" });
    }
  } finally {
    queue.inFlightKey = null;
    queue.inFlightResult = null;
    const next = queue.pending;
    const nextResult = queue.pendingResult;
    const nextSettle = queue.pendingSettle;
    queue.pending = null;
    queue.pendingResult = null;
    queue.pendingSettle = null;
    if (next && nextResult && nextSettle) {
      void runLatestWinsTask(queue, next, nextResult, nextSettle);
    }
  }
}

/**
 * Starts immediately when idle. While a command is running, exactly one pending
 * task is retained and each newer key replaces it.
 */
export function enqueueLatestWins<T>(
  queue: LatestWinsQueue<T>,
  task: LatestWinsTask<T>
): Promise<LatestWinsOutcome<T>> {
  setLatestWinsDesired(queue, task.key);
  if (queue.inFlightKey !== null) {
    if (queue.inFlightKey === task.key) {
      discardLatestWinsPending(queue);
      return queue.inFlightResult!;
    }
    if (queue.pending?.key === task.key) {
      return queue.pendingResult!;
    }
    settlePendingLatestWinsTask(queue, { status: "superseded" });
    const { result, settle } = createLatestWinsResult<T>();
    queue.pending = task;
    queue.pendingResult = result;
    queue.pendingSettle = settle;
    return result;
  }
  const { result, settle } = createLatestWinsResult<T>();
  void runLatestWinsTask(queue, task, result, settle);
  return result;
}

/**
 * Ensures a keyed backend mutation is the latest applied value without
 * re-sending a value that is already current. Same-key callers join the
 * existing in-flight/pending command, while returning to a previously applied
 * key behind a competing command still queues the required restorative write.
 */
export async function ensureLatestWins<T>(
  queue: LatestWinsQueue<T>,
  lastApplied: { current: string },
  task: LatestWinsTask<T>,
  options: { force?: boolean } = {}
): Promise<EnsuredLatestWinsOutcome<T>> {
  setLatestWinsDesired(queue, task.key);
  const trackedTask: LatestWinsTask<T> = {
    ...task,
    run: async () => {
      const value = await task.run();
      // Commands are serialized, so the most recently completed successful
      // write is the actual backend state even when its React outcome was
      // superseded. Tracking that fact prevents a later return-to-last intent
      // from being incorrectly deduplicated after the stale command settles.
      lastApplied.current = task.key;
      return value;
    },
  };

  let outcome: LatestWinsOutcome<T>;
  if (options.force) {
    // `enqueueLatestWins` still joins a same-key command already in flight.
    // Force only bypasses the idle last-applied dedup, which is useful for
    // commands such as Play that intentionally rebuild runtime state.
    outcome = await enqueueLatestWins(queue, trackedTask);
  } else if (!latestWinsNeedsEnqueue(queue, task.key, lastApplied.current)) {
    if (queue.inFlightKey === task.key && queue.inFlightResult) {
      outcome = await queue.inFlightResult;
    } else if (queue.pending?.key === task.key && queue.pendingResult) {
      outcome = await queue.pendingResult;
    } else {
      return { status: "current" };
    }
  } else {
    outcome = await enqueueLatestWins(queue, trackedTask);
  }
  return outcome;
}

export function updateCurrentValue<T>(
  holder: { current: T | null },
  clone: (current: T) => T,
  update: (current: T) => T,
  normalize: (current: T) => T = (current) => current
): T | null {
  if (holder.current === null) return null;
  const next = normalize(update(clone(holder.current)));
  holder.current = next;
  return next;
}
