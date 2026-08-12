/**
 * Machine-local preferences logic (mirrors `src-tauri/src/machine.rs`): the
 * settings that belong to THIS machine — MIDI destination, autosave behavior
 * — and must never be overwritten by loading a patch document. Pure module so
 * normalization and the one-shot localStorage migration are unit-testable
 * without React (docs/COMPONENT_LOGIC_EXTRACTION_PLAN.md).
 */
import type { MachinePrefs, MachinePrefsSnapshot, MidiDestination } from "./bridge";
import {
  DEFAULT_AUTOSAVE_INTERVAL_MS,
  boolValue,
  isRecord,
  normalizeAutosaveIntervalMs,
} from "./patchIo";

export const MACHINE_PREFS_VERSION = 1;

/** The pre-slice localStorage homes of these settings. The migration reads
 * them once, writes the machine-prefs file, and removes them. The literals
 * live here (not sessionPrefs) because sessionPrefs no longer knows about
 * setup preferences at all. */
export const LEGACY_SETUP_PREFERENCES_KEY = "caesura.setupPreferences.v1";
export const LEGACY_AUTOSAVE_ENABLED_KEY = "caesura.autosaveEnabled.v1";

export function defaultMachinePrefs(): MachinePrefs {
  return {
    prefsVersion: MACHINE_PREFS_VERSION,
    midiDestination: null,
    autosaveEnabled: true,
    autosaveIntervalMs: DEFAULT_AUTOSAVE_INTERVAL_MS,
    autoloadRecentSession: true,
  };
}

function normalizeDestination(value: unknown): MidiDestination | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    return null;
  }
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
  };
}

/** Tolerant normalization of anything claiming to be machine prefs. */
export function normalizeMachinePrefs(value: unknown): MachinePrefs {
  const defaults = defaultMachinePrefs();
  if (!isRecord(value)) {
    return defaults;
  }
  return {
    prefsVersion: MACHINE_PREFS_VERSION,
    midiDestination: normalizeDestination(value.midiDestination),
    autosaveEnabled: boolValue(value.autosaveEnabled, defaults.autosaveEnabled),
    autosaveIntervalMs: normalizeAutosaveIntervalMs(value.autosaveIntervalMs),
    autoloadRecentSession: boolValue(
      value.autoloadRecentSession,
      defaults.autoloadRecentSession
    ),
  };
}

export interface SetupPrefsMigrationPlan {
  /** Write the migrated prefs to the machine-prefs file. Only when the file
   * did not exist yet AND a legacy key held something. */
  shouldMigrate: boolean;
  /** The prefs to apply to app state (migrated values or the snapshot's). */
  prefs: MachinePrefs;
  /** Legacy localStorage keys to delete (present ones, migrated or stale). */
  keysToRemove: string[];
}

/**
 * Legacy values are the only durable copy until a required migration write
 * succeeds. When a machine-prefs file already exists, any legacy keys are
 * stale and can be removed without another write.
 */
export function removableLegacySetupKeys(
  plan: SetupPrefsMigrationPlan,
  migrationWriteSucceeded: boolean
): string[] {
  return !plan.shouldMigrate || migrationWriteSucceeded
    ? plan.keysToRemove
    : [];
}

function legacyAutosaveEnabledValue(value: string | null): boolean {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return true;
}

/**
 * The one-shot migration decision. Pure: localStorage access is injected as
 * a reader so tests drive it with plain objects. A successful migration makes
 * the next boot's snapshot source "file"; a failed write retains the legacy
 * keys so a later boot can retry without losing data.
 */
export function planSetupPrefsMigration(
  snapshot: MachinePrefsSnapshot,
  readLocal: (key: string) => string | null
): SetupPrefsMigrationPlan {
  const legacySetupRaw = readLocal(LEGACY_SETUP_PREFERENCES_KEY);
  const legacyEnabledRaw = readLocal(LEGACY_AUTOSAVE_ENABLED_KEY);
  const keysToRemove = [
    ...(legacySetupRaw !== null ? [LEGACY_SETUP_PREFERENCES_KEY] : []),
    ...(legacyEnabledRaw !== null ? [LEGACY_AUTOSAVE_ENABLED_KEY] : []),
  ];

  if (snapshot.source === "file" || keysToRemove.length === 0) {
    return {
      shouldMigrate: false,
      prefs: normalizeMachinePrefs(snapshot.prefs),
      keysToRemove,
    };
  }

  let legacySetup: Record<string, unknown> = {};
  try {
    const parsed: unknown = legacySetupRaw ? JSON.parse(legacySetupRaw) : {};
    if (isRecord(parsed)) {
      legacySetup = parsed;
    }
  } catch {
    // Unparsable legacy blob: fall through to the standalone flag/defaults.
  }

  const legacyEnabledFallback = legacyAutosaveEnabledValue(legacyEnabledRaw);
  const migrated: MachinePrefs = {
    ...normalizeMachinePrefs(snapshot.prefs),
    autosaveEnabled: boolValue(
      legacySetup.autosaveEnabled,
      boolValue(legacySetup.restoreAutosaveOnLaunch, legacyEnabledFallback)
    ),
    autosaveIntervalMs: normalizeAutosaveIntervalMs(
      legacySetup.autosaveIntervalMs
    ),
    autoloadRecentSession: boolValue(legacySetup.autoloadRecentSession, true),
  };

  return { shouldMigrate: true, prefs: migrated, keysToRemove };
}
