//! Machine-local configuration: the prefs file (MIDI destination + autosave
//! behavior), its directory resolution, and the MIDI route state shared
//! between commands and the hot-plug watcher.
//!
//! These settings belong to the MACHINE, never to patch documents — loading
//! someone else's patch must not rewrite them (the pre-slice behavior did
//! exactly that through the patch's `setup` block).

use std::path::{Path, PathBuf};

use cseq_transport::MidiDestination;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

pub const MACHINE_PREFS_VERSION: u32 = 1;

fn default_prefs_version() -> u32 {
    MACHINE_PREFS_VERSION
}

fn default_true() -> bool {
    true
}

/// Mirrors `DEFAULT_AUTOSAVE_INTERVAL_MS` in `ui/src/patchIo.ts`.
fn default_autosave_interval_ms() -> u64 {
    3_000
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinePrefs {
    #[serde(default = "default_prefs_version")]
    pub prefs_version: u32,
    #[serde(default)]
    pub midi_destination: Option<MidiDestination>,
    #[serde(default = "default_true")]
    pub autosave_enabled: bool,
    #[serde(default = "default_autosave_interval_ms")]
    pub autosave_interval_ms: u64,
    #[serde(default = "default_true")]
    pub autoload_recent_session: bool,
}

impl Default for MachinePrefs {
    fn default() -> Self {
        Self {
            prefs_version: MACHINE_PREFS_VERSION,
            midi_destination: None,
            autosave_enabled: true,
            autosave_interval_ms: default_autosave_interval_ms(),
            autoload_recent_session: true,
        }
    }
}

/// Where the loaded prefs came from — `Defaults` signals the frontend that a
/// one-shot localStorage migration may still apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MachinePrefsSource {
    File,
    Defaults,
}

/// The route half of machine state: what the user wants connected, whether
/// it currently is, and the last connect error if not.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiRouteState {
    pub desired: Option<MidiDestination>,
    pub connected: bool,
    pub last_error: Option<String>,
}

/// Resolve the machine-local config directory. `CAESURA_MACHINE_DIR` wins
/// (hermetic e2e/dev override), then the app config dir
/// (`~/Library/Application Support/io.github.pleatherstarfish.dumka`), then a temp-dir
/// fallback so the app still functions on a broken install.
pub fn resolve_machine_dir(app_config_dir: Option<PathBuf>) -> PathBuf {
    if let Ok(dir) = std::env::var("CAESURA_MACHINE_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    if let Some(dir) = app_config_dir {
        return dir;
    }
    std::env::temp_dir().join("caesura")
}

pub fn machine_prefs_path(machine_dir: &Path) -> PathBuf {
    machine_dir.join("machine-prefs.json")
}

pub fn autosave_path(machine_dir: &Path) -> PathBuf {
    machine_dir.join("autosave.dumka")
}

/// Where autosaves lived before this slice (OS temp — subject to cleaner
/// purges, and shared across parallel app instances).
pub fn legacy_autosave_path() -> PathBuf {
    std::env::temp_dir()
        .join("caesura")
        .join("autosave.caesura")
}

/// Load prefs tolerantly: a missing or unparsable file yields defaults and
/// reports `Defaults` so the frontend can run its one-shot migration.
pub fn load_machine_prefs(machine_dir: &Path) -> (MachinePrefs, MachinePrefsSource) {
    let path = machine_prefs_path(machine_dir);
    match std::fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<MachinePrefs>(&raw) {
            Ok(prefs) => (prefs, MachinePrefsSource::File),
            Err(error) => {
                warn!(path = %path.display(), %error, "machine prefs unreadable; using defaults");
                (MachinePrefs::default(), MachinePrefsSource::Defaults)
            }
        },
        Err(_) => (MachinePrefs::default(), MachinePrefsSource::Defaults),
    }
}

/// Atomic write (tmp + rename), the same discipline as the autosave writer.
pub fn save_machine_prefs(machine_dir: &Path, prefs: &MachinePrefs) -> Result<(), String> {
    std::fs::create_dir_all(machine_dir)
        .map_err(|e| format!("failed to create machine dir: {e}"))?;
    let path = machine_prefs_path(machine_dir);
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(prefs)
        .map_err(|e| format!("failed to serialize machine prefs: {e}"))?;
    std::fs::write(&tmp, json).map_err(|e| format!("failed to write machine prefs: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("failed to move machine prefs: {e}"))?;
    Ok(())
}

/// One-shot autosave relocation out of the OS temp dir. A no-op when the new
/// file already exists, when there is nothing to migrate, or when the
/// machine dir IS the legacy dir (temp fallback).
pub fn migrate_legacy_autosave(machine_dir: &Path) {
    let new_path = autosave_path(machine_dir);
    let legacy = legacy_autosave_path();
    if new_path == legacy || new_path.exists() || !legacy.exists() {
        return;
    }
    if let Err(error) = std::fs::create_dir_all(machine_dir) {
        warn!(%error, "autosave migration: cannot create machine dir");
        return;
    }
    // A hard-link publish is an atomic, no-clobber move when both paths share
    // a volume. Unlike `rename`, it cannot overwrite an autosave another app
    // instance created after the `exists` check above.
    match std::fs::hard_link(&legacy, &new_path) {
        Ok(()) => {
            let _ = std::fs::remove_file(&legacy);
            info!(from = %legacy.display(), to = %new_path.display(), "autosave migrated");
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => {
            // Cross-volume hard links fail. Copy to a sibling temporary file,
            // then publish that complete inode with the same atomic
            // no-clobber discipline.
            match copy_autosave_atomically(&legacy, &new_path) {
                Ok(true) => {
                    let _ = std::fs::remove_file(&legacy);
                    info!(from = %legacy.display(), to = %new_path.display(), "autosave migrated (copy)");
                }
                Ok(false) => {}
                Err(error) => {
                    warn!(%error, "autosave migration failed; legacy file left in place");
                }
            }
        }
    }
}

/// Returns `true` when this call published `destination`, or `false` when a
/// concurrent writer had already published it. The latter is a no-op and
/// leaves the caller's legacy source untouched.
fn copy_autosave_atomically(source: &Path, destination: &Path) -> Result<bool, std::io::Error> {
    let tmp = destination.with_extension("caesura.migrate.tmp");

    // A prior interrupted attempt may have left this private temporary file.
    // It is never authoritative and is safe to replace.
    match std::fs::remove_file(&tmp) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    if let Err(error) = std::fs::copy(source, &tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }

    // Linking a complete sibling temp into the destination name is atomic and
    // fails rather than replacing an existing file. This closes the
    // exists-then-rename race with another app instance or autosave writer.
    match std::fs::hard_link(&tmp, destination) {
        Ok(()) => {
            let _ = std::fs::remove_file(&tmp);
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let _ = std::fs::remove_file(&tmp);
            Ok(false)
        }
        Err(error) => {
            let _ = std::fs::remove_file(&tmp);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "caesura-machine-test-{label}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn prefs_default_and_round_trip() {
        let dir = scratch_dir("roundtrip");
        let (prefs, source) = load_machine_prefs(&dir);
        assert_eq!(source, MachinePrefsSource::Defaults);
        assert_eq!(prefs, MachinePrefs::default());

        let custom = MachinePrefs {
            prefs_version: MACHINE_PREFS_VERSION,
            midi_destination: Some(MidiDestination {
                id: "-673416519".to_string(),
                name: "IAC Driver Bus 1".to_string(),
            }),
            autosave_enabled: false,
            autosave_interval_ms: 10_000,
            autoload_recent_session: false,
        };
        save_machine_prefs(&dir, &custom).unwrap();
        let (loaded, source) = load_machine_prefs(&dir);
        assert_eq!(source, MachinePrefsSource::File);
        assert_eq!(loaded, custom);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prefs_parse_is_tolerant_of_partial_and_garbage_files() {
        let dir = scratch_dir("tolerant");
        // Partial file: absent fields take defaults.
        std::fs::write(machine_prefs_path(&dir), r#"{ "autosaveEnabled": false }"#).unwrap();
        let (prefs, source) = load_machine_prefs(&dir);
        assert_eq!(source, MachinePrefsSource::File);
        assert!(!prefs.autosave_enabled);
        assert_eq!(prefs.autosave_interval_ms, 3_000);
        assert!(prefs.autoload_recent_session);
        assert_eq!(prefs.midi_destination, None);

        // Garbage: defaults + Defaults source (frontend may migrate).
        std::fs::write(machine_prefs_path(&dir), "not json").unwrap();
        let (prefs, source) = load_machine_prefs(&dir);
        assert_eq!(source, MachinePrefsSource::Defaults);
        assert_eq!(prefs, MachinePrefs::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn machine_dir_resolution_prefers_env_then_config_then_temp() {
        // Note: env var manipulation is process-global; this test runs the
        // pure branches by argument instead of mutating the environment.
        let config = PathBuf::from("/tmp/caesura-config-example");
        if std::env::var("CAESURA_MACHINE_DIR").is_err() {
            assert_eq!(resolve_machine_dir(Some(config.clone())), config);
            assert_eq!(
                resolve_machine_dir(None),
                std::env::temp_dir().join("caesura")
            );
        }
    }

    #[test]
    fn prefs_serde_is_camel_case() {
        let json = serde_json::to_value(MachinePrefs::default()).unwrap();
        assert!(json.get("prefsVersion").is_some());
        assert!(json.get("autosaveEnabled").is_some());
        assert!(json.get("autosaveIntervalMs").is_some());
        assert!(json.get("autoloadRecentSession").is_some());
        assert!(json.get("midiDestination").is_some());
    }

    #[test]
    fn cross_volume_fallback_publishes_only_a_complete_copy() {
        let dir = scratch_dir("copy-migration");
        let source = dir.join("legacy.caesura");
        let destination = dir.join("new").join("autosave.caesura");
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::write(&source, b"complete autosave contents").unwrap();

        // Simulate debris from a process that died during an earlier copy.
        let tmp = destination.with_extension("caesura.migrate.tmp");
        std::fs::write(&tmp, b"partial").unwrap();

        assert!(copy_autosave_atomically(&source, &destination).unwrap());

        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"complete autosave contents"
        );
        assert!(!tmp.exists());
        assert!(source.exists(), "the caller removes the legacy source");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cross_volume_fallback_does_not_replace_an_existing_autosave() {
        let dir = scratch_dir("copy-migration-existing");
        let source = dir.join("legacy.caesura");
        let destination = dir.join("autosave.caesura");
        std::fs::write(&source, b"legacy").unwrap();
        std::fs::write(&destination, b"authoritative").unwrap();

        assert!(!copy_autosave_atomically(&source, &destination).unwrap());

        assert_eq!(std::fs::read(&destination).unwrap(), b"authoritative");
        assert!(source.exists());
        assert!(!destination.with_extension("caesura.migrate.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_cross_volume_copy_cleans_temp_and_is_retryable() {
        let dir = scratch_dir("copy-migration-retry");
        let source = dir.join("missing-legacy.caesura");
        let destination = dir.join("autosave.caesura");
        let tmp = destination.with_extension("caesura.migrate.tmp");
        std::fs::write(&tmp, b"partial").unwrap();

        assert!(copy_autosave_atomically(&source, &destination).is_err());
        assert!(!destination.exists());
        assert!(!tmp.exists());

        std::fs::write(&source, b"retry succeeds").unwrap();
        assert!(copy_autosave_atomically(&source, &destination).unwrap());
        assert_eq!(std::fs::read(&destination).unwrap(), b"retry succeeds");
        assert!(!tmp.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
