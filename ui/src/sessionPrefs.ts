/**
 * Local-shell session preferences: recent patches, last patch path, autosave
 * session markers, and the global-seed startup lock — all
 * localStorage-backed, all best-effort. Extracted verbatim from App.tsx
 * (carve-up round 4). Setup preferences (autosave behavior, autoload) moved
 * to the machine-prefs file — see `machinePrefs.ts` for the one-shot
 * migration off the legacy localStorage keys.
 */
import { normalizeSeedValue } from "./patchIo";
import { boolValue, isRecord, FALLBACK_GLOBAL_SEED } from "./patchIo";
import { fileNameFromPath } from "./filenames";
import { MAX_PARALLEL_TRACKS, type ParallelTrackPatch } from "./patchIo";

export function datetimeSeed(now = new Date()): number {
  return normalizeSeedValue(now.getTime(), FALLBACK_GLOBAL_SEED);
}

export function datetimeSeedForNewParallelTrack(
  tracks: Pick<ParallelTrackPatch, "sequencer">[],
  now = new Date()
): number {
  const usedSeeds = new Set(
    tracks.map((track) => normalizeSeedValue(track.sequencer.seed, FALLBACK_GLOBAL_SEED))
  );
  const baseTime = now.getTime();
  for (let offset = 0; offset <= MAX_PARALLEL_TRACKS; offset += 1) {
    const candidate = normalizeSeedValue(baseTime + offset, FALLBACK_GLOBAL_SEED);
    if (!usedSeeds.has(candidate)) {
      return candidate;
    }
  }
  return normalizeSeedValue(baseTime + tracks.length + 1, FALLBACK_GLOBAL_SEED);
}

export const RECENT_PATCHES_STORAGE_KEY = "caesura.recentPatches.v1";
export const LAST_PATCH_PATH_STORAGE_KEY = "caesura.lastPatchPath.v1";
export const AUTOSAVE_SESSION_STATE_STORAGE_KEY = "caesura.sessionState.v1";
export const AUTOSAVE_SESSION_ACTIVE = "active";
export const AUTOSAVE_SESSION_CLEAN = "clean";
export const GLOBAL_SEED_STARTUP_LOCK_STORAGE_KEY = "caesura.globalSeedStartupLock.v1";
export const RECENT_PATCH_LIMIT = 10;

export interface RecentPatchEntry {
  path: string;
  name: string;
  savedAt: string;
}

export interface GlobalSeedStartupLock {
  locked: boolean;
  seed: number;
}

export function readRecentPatches(): RecentPatchEntry[] {
  try {
    const raw = window.localStorage.getItem(RECENT_PATCHES_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((item) => {
      if (!isRecord(item) || typeof item.path !== "string") {
        return [];
      }
      return [
        {
          path: item.path,
          name:
            typeof item.name === "string" && item.name.trim()
              ? item.name
              : fileNameFromPath(item.path),
          savedAt:
            typeof item.savedAt === "string"
              ? item.savedAt
              : new Date().toISOString(),
        },
      ];
    });
  } catch {
    return [];
  }
}

export function writeRecentPatches(entries: RecentPatchEntry[]) {
  try {
    window.localStorage.setItem(
      RECENT_PATCHES_STORAGE_KEY,
      JSON.stringify(entries.slice(0, RECENT_PATCH_LIMIT))
    );
  } catch {
    // Best-effort shell state; patch files remain the source of truth.
  }
}

export function rememberPatchPath(path: string, savedAt = new Date().toISOString()) {
  try {
    window.localStorage.setItem(LAST_PATCH_PATH_STORAGE_KEY, path);
  } catch {
    // Best effort only.
  }
  const entry = { path, name: fileNameFromPath(path), savedAt };
  const next = [
    entry,
    ...readRecentPatches().filter((recent) => recent.path !== path),
  ].slice(0, RECENT_PATCH_LIMIT);
  writeRecentPatches(next);
  return next;
}

export function forgetLastPatchPath() {
  try {
    window.localStorage.removeItem(LAST_PATCH_PATH_STORAGE_KEY);
  } catch {
    // Best effort only.
  }
}

export function readLastPatchPath(): string | null {
  try {
    return window.localStorage.getItem(LAST_PATCH_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readGlobalSeedStartupLock(): GlobalSeedStartupLock {
  try {
    const raw = window.localStorage.getItem(GLOBAL_SEED_STARTUP_LOCK_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (isRecord(parsed) && boolValue(parsed.locked, false)) {
      return {
        locked: true,
        seed: normalizeSeedValue(parsed.seed, FALLBACK_GLOBAL_SEED),
      };
    }
  } catch {
    // New-session seed preferences are best effort.
  }
  return {
    locked: false,
    seed: datetimeSeed(),
  };
}

export function writeGlobalSeedStartupLock(locked: boolean, seed: number) {
  try {
    if (!locked) {
      window.localStorage.removeItem(GLOBAL_SEED_STARTUP_LOCK_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      GLOBAL_SEED_STARTUP_LOCK_STORAGE_KEY,
      JSON.stringify({
        locked: true,
        seed: normalizeSeedValue(seed, FALLBACK_GLOBAL_SEED),
      })
    );
  } catch {
    // Best effort only.
  }
}

export function readPreviousSessionInterrupted(): boolean {
  try {
    return (
      window.localStorage.getItem(AUTOSAVE_SESSION_STATE_STORAGE_KEY) ===
      AUTOSAVE_SESSION_ACTIVE
    );
  } catch {
    return false;
  }
}

export function markAutosaveSessionActive() {
  try {
    window.localStorage.setItem(
      AUTOSAVE_SESSION_STATE_STORAGE_KEY,
      AUTOSAVE_SESSION_ACTIVE
    );
  } catch {
    // Best effort only.
  }
}

export function markAutosaveSessionClean() {
  try {
    window.localStorage.setItem(
      AUTOSAVE_SESSION_STATE_STORAGE_KEY,
      AUTOSAVE_SESSION_CLEAN
    );
  } catch {
    // Best effort only.
  }
}
