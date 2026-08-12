import type { Page } from "@playwright/test";

/**
 * Real-backend e2e driver.
 *
 * Installs the same `window.__CAESURA_E2E_DRIVER__` seam that `mockTauri.ts`
 * uses, but instead of answering commands from a TS re-implementation of the
 * backend, every `invoke()` is forwarded over local HTTP to the real Rust
 * binary running in harness mode (`CAESURA_E2E_HARNESS_PORT`, see
 * `src-tauri/src/e2e_harness.rs`). The UI under test therefore exercises the
 * real serde DTOs, the real resolver, and the real transport — the parity
 * seam the mock cannot cover.
 *
 * Tauri events are not pushed by the harness; the app's transport telemetry
 * subscriptions (`transport_timeline_snapshot`, `transport_log_snapshot`,
 * `transport_position`, plus the legacy `transport_snapshot`) are satisfied
 * by polling the real `transport_get_snapshot` command and emitting the full
 * snapshot — which carries the real backend epochs — to all listeners.
 *
 * Dialogs stay local queue-based stubs (same semantics as the mock driver):
 * file dialogs are native UI, not backend behavior.
 */

export interface RealTauriOptions {
  /** Port the Rust e2e harness listens on. */
  harnessPort: number;
  /** Milliseconds between transport_snapshot polls (default 80). */
  snapshotPollMs?: number;
  saveDialogResponses?: Array<string | null>;
  openDialogResponses?: Array<string | null>;
  askDialogResponses?: boolean[];
  autosaveEnabledPreference?: boolean;
  previousSessionInterrupted?: boolean;
  setupPreferences?: Record<string, unknown>;
  globalSeedStartupLock?: { locked: boolean; seed: number };
}

export interface RealDriverState {
  calls: Array<{ sequence: number; command: string; args: unknown }>;
  dialogHistory: Array<{
    sequence: number;
    kind: "ask" | "open" | "save";
    options: unknown;
    result: unknown;
  }>;
  lastScoreCreateRequest: Record<string, unknown> | null;
  lastPreviewRequest: { request: Record<string, unknown>; cycle: number } | null;
  lastPreview: Record<string, unknown> | null;
  lastGeneratorPreviewRequest:
    | (Record<string, unknown> & { cycle?: number; spans?: unknown[] })
    | null;
  lastGeneratorPreview: Record<string, unknown> | null;
  lastTrackPlaybackRequest:
    | (Record<string, unknown> & {
        enabled?: boolean;
        automation?: unknown;
      })
    | null;
  lastParallelPlaybackRequest: Record<string, unknown> | null;
  lastPatchSave: { path: string; patch: Record<string, unknown> } | null;
  lastPatchLoadPath: string | null;
  lastAutosavePatch: unknown | null;
  lastSnapshot: Record<string, unknown> | null;
  invokeErrors: Array<{ command: string; error: string }>;
}

export async function installRealTauri(
  page: Page,
  options: RealTauriOptions
): Promise<void> {
  await page.addInitScript((driverOptions: RealTauriOptions) => {
    window.__CAESURA_E2E__ = true;

    if (driverOptions.autosaveEnabledPreference !== undefined) {
      window.localStorage.setItem(
        "caesura.autosaveEnabled.v1",
        driverOptions.autosaveEnabledPreference ? "true" : "false"
      );
    }
    if (driverOptions.previousSessionInterrupted !== undefined) {
      window.localStorage.setItem(
        "caesura.sessionState.v1",
        driverOptions.previousSessionInterrupted ? "active" : "clean"
      );
    }
    if (driverOptions.setupPreferences) {
      window.localStorage.setItem(
        "caesura.setupPreferences.v1",
        JSON.stringify(driverOptions.setupPreferences)
      );
    }
    if (driverOptions.globalSeedStartupLock) {
      window.localStorage.setItem(
        "caesura.globalSeedStartupLock.v1",
        JSON.stringify(driverOptions.globalSeedStartupLock)
      );
    }

    const baseUrl = `http://127.0.0.1:${driverOptions.harnessPort}`;
    const snapshotPollMs = Math.max(30, driverOptions.snapshotPollMs ?? 80);
    const clone = <T,>(value: T): T =>
      value === undefined ? value : JSON.parse(JSON.stringify(value));

    const calls: Array<{ sequence: number; command: string; args: unknown }> = [];
    const invokeErrors: Array<{ command: string; error: string }> = [];
    const dialogHistory: Array<{
      sequence: number;
      kind: "ask" | "open" | "save";
      options: unknown;
      result: unknown;
    }> = [];
    const saveDialogResponses = [...(driverOptions.saveDialogResponses ?? [])];
    const openDialogResponses = [...(driverOptions.openDialogResponses ?? [])];
    const askDialogResponses = [...(driverOptions.askDialogResponses ?? [])];
    let sequence = 0;
    let lastScoreCreateRequest: unknown = null;
    let lastPreviewRequest: unknown = null;
    let lastPreview: unknown = null;
    let lastGeneratorPreviewRequest: unknown = null;
    let lastGeneratorPreview: unknown = null;
    let lastTrackPlaybackRequest: unknown = null;
    let lastParallelPlaybackRequest: unknown = null;
    let lastPatchSave: unknown = null;
    let lastPatchLoadPath: string | null = null;
    let lastAutosavePatch: unknown = null;
    let lastSnapshot: unknown = null;

    async function rawInvoke<T>(command: string, args?: unknown): Promise<T> {
      const response = await fetch(`${baseUrl}/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cmd: command, args: args ?? {} }),
      });
      const text = await response.text();
      const value = text.length > 0 ? JSON.parse(text) : null;
      if (!response.ok) {
        const error =
          value && typeof value === "object" && "error" in value
            ? (value as { error: unknown }).error
            : value;
        throw new Error(typeof error === "string" ? error : JSON.stringify(error));
      }
      return value as T;
    }

    const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
    let snapshotPollTimer: number | null = null;

    function emit(eventName: string, payload: unknown): void {
      const handlers = listeners.get(eventName);
      if (!handlers) return;
      for (const handler of handlers) {
        handler({ payload: clone(payload) });
      }
    }

    // The real Tauri event stream is ordered; overlapping HTTP polls are
    // not (a stale isPlaying=false response can land after a fresh
    // isPlaying=true one and make the app reconcile wrongly). Never start
    // a poll while one is in flight so emissions stay strictly ordered.
    let snapshotPollInFlight = false;
    function ensureSnapshotPolling(): void {
      if (snapshotPollTimer !== null) return;
      snapshotPollTimer = window.setInterval(() => {
        if (snapshotPollInFlight) return;
        snapshotPollInFlight = true;
        void (async () => {
          try {
            const snapshot = await rawInvoke<Record<string, unknown>>(
              "transport_get_snapshot"
            );
            lastSnapshot = snapshot;
            // The app listens to the split telemetry events; the full
            // snapshot is a superset of each payload and carries the real
            // backend epochs. Timeline is emitted first so a promotion can
            // never trail the matching position (same ordering as the mock).
            emit("transport_timeline_snapshot", snapshot);
            emit("transport_log_snapshot", {
              ...snapshot,
              // This fallback harness polls the legacy full snapshot rather
              // than the native split emitter, so its log payload is full.
              logInterest: "full",
            });
            emit("transport_position", snapshot);
            emit("transport_snapshot", snapshot);
          } catch {
            // Harness shutting down between requests is expected at test end.
          } finally {
            snapshotPollInFlight = false;
          }
        })();
      }, snapshotPollMs);
    }

    const driver = {
      async invoke<T>(command: string, args?: unknown): Promise<T> {
        calls.push({ sequence: ++sequence, command, args: clone(args ?? null) });
        if (command === "score_create_subdivision_switch") {
          lastScoreCreateRequest = clone(
            (args as { request?: unknown } | undefined)?.request ?? null
          );
        } else if (command === "generator_preview") {
          lastGeneratorPreviewRequest = clone(
            (args as { request?: unknown } | undefined)?.request ?? null
          );
        } else if (command === "track_set_playback") {
          lastTrackPlaybackRequest = clone(
            (args as { request?: unknown } | undefined)?.request ?? null
          );
        } else if (command === "parallel_set_playback") {
          lastParallelPlaybackRequest = clone(
            (args as { request?: unknown } | undefined)?.request ?? null
          );
        } else if (command === "patch_save_to_path") {
          const payload = args as
            | { path?: unknown; patch?: Record<string, unknown> }
            | undefined;
          lastPatchSave =
            typeof payload?.path === "string"
              ? { path: payload.path, patch: clone(payload.patch ?? {}) }
              : null;
        } else if (command === "patch_load_from_path") {
          const payload = args as { path?: unknown } | undefined;
          lastPatchLoadPath = typeof payload?.path === "string" ? payload.path : null;
        } else if (command === "patch_autosave") {
          lastAutosavePatch = clone(
            (args as { patch?: unknown } | undefined)?.patch ?? null
          );
        }
        try {
          const result = await rawInvoke<T>(command, args);
          if (command === "score_preview_subdivision_switch") {
            const payload = args as
              | { request?: Record<string, unknown>; cycle?: unknown }
              | undefined;
            lastPreviewRequest = {
              request: clone(payload?.request ?? {}),
              cycle: Number(payload?.cycle) || 0,
            };
            lastPreview = clone(result);
          } else if (command === "generator_preview") {
            lastGeneratorPreview = clone(result);
          }
          return result;
        } catch (error) {
          invokeErrors.push({
            command,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
      async listen(
        eventName: string,
        handler: (event: { payload: unknown }) => void
      ) {
        const handlers = listeners.get(eventName) ?? new Set();
        handlers.add(handler);
        listeners.set(eventName, handlers);
        if (
          eventName === "transport_snapshot" ||
          eventName === "transport_timeline_snapshot" ||
          eventName === "transport_log_snapshot" ||
          eventName === "transport_position"
        ) {
          ensureSnapshotPolling();
        }
        return () => handlers.delete(handler);
      },
      async dialog(kind: "ask" | "open" | "save", options?: unknown) {
        let result: unknown = null;
        if (kind === "ask") {
          result = askDialogResponses.length > 0 ? askDialogResponses.shift() : false;
        } else if (kind === "open") {
          result = openDialogResponses.length > 0 ? openDialogResponses.shift() : null;
        } else if (kind === "save") {
          result = saveDialogResponses.length > 0 ? saveDialogResponses.shift() : null;
        }
        dialogHistory.push({
          sequence: ++sequence,
          kind,
          options: clone(options),
          result: clone(result),
        });
        return clone(result);
      },
      emitNativeMenuAction(action: string) {
        emit("native_menu_action", action);
      },
      enqueueDialogResponse(kind: "ask" | "open" | "save", value: unknown) {
        if (kind === "ask") {
          askDialogResponses.push(Boolean(value));
        } else if (kind === "open") {
          openDialogResponses.push(typeof value === "string" ? value : null);
        } else {
          saveDialogResponses.push(typeof value === "string" ? value : null);
        }
      },
      getState() {
        return clone({
          calls,
          dialogHistory,
          lastScoreCreateRequest,
          lastPreviewRequest,
          lastPreview,
          lastGeneratorPreviewRequest,
          lastGeneratorPreview,
          lastTrackPlaybackRequest,
          lastParallelPlaybackRequest,
          lastPatchSave,
          lastPatchLoadPath,
          lastAutosavePatch,
          lastSnapshot,
          invokeErrors,
        });
      },
    };

    window.__CAESURA_E2E_DRIVER__ = driver as unknown as typeof window.__CAESURA_E2E_DRIVER__;
  }, options);
}

export async function readRealDriverState(page: Page): Promise<RealDriverState> {
  return await page.evaluate(
    () =>
      (
        window.__CAESURA_E2E_DRIVER__ as unknown as {
          getState(): RealDriverState;
        }
      ).getState() as RealDriverState
  );
}
