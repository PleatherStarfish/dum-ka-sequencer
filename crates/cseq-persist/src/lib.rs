//! JSON persistence for the Dum-Ka score schema.
//!
//! Scores are saved as pretty-printed JSON. The fork starts at schema v1 and
//! intentionally carries no CarnaticSeq migration chain.

use std::path::Path;

use cseq_model::{Score, SCHEMA_VERSION};
use serde_json::Value;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum PersistError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("unsupported schema version {found}, latest is {latest}")]
    UnsupportedVersion { found: u32, latest: u32 },

    #[error("missing schema_version field")]
    MissingVersion,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Save a Score to a JSON file.
pub fn save(score: &Score, path: &Path) -> Result<(), PersistError> {
    let json = serde_json::to_string_pretty(score)?;
    std::fs::write(path, json)?;
    Ok(())
}

/// Load a Score from a JSON file.
pub fn load(path: &Path) -> Result<Score, PersistError> {
    let contents = std::fs::read_to_string(path)?;
    load_from_str(&contents)
}

/// Load from a JSON string, accepting only the current fork schema.
pub fn load_from_str(json: &str) -> Result<Score, PersistError> {
    let value: Value = serde_json::from_str(json)?;

    let version = value
        .get("schema_version")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .ok_or(PersistError::MissingVersion)?;

    if version != SCHEMA_VERSION {
        return Err(PersistError::UnsupportedVersion {
            found: version,
            latest: SCHEMA_VERSION,
        });
    }

    let score: Score = serde_json::from_value(value)?;
    Ok(score)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use cseq_model::Score;

    #[test]
    fn save_load_roundtrip() {
        let score = Score::single_pulse("roundtrip-test", 60, 100);
        let dir = std::env::temp_dir().join("cseq-persist-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("roundtrip.json");

        save(&score, &path).unwrap();
        let loaded = load(&path).unwrap();

        assert_eq!(loaded.id, score.id);
        assert_eq!(loaded.name, score.name);
        assert_eq!(loaded.schema_version, SCHEMA_VERSION);
        assert_eq!(loaded.pipeline.len(), 0);
        assert_eq!(loaded.next_transform_id, 0);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_load_is_idempotent() {
        let score = Score::single_pulse("idempotent", 64, 90);
        let once = load_from_str(&serde_json::to_string(&score).unwrap()).unwrap();
        let twice = load_from_str(&serde_json::to_string(&once).unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(&once).unwrap(),
            serde_json::to_value(&twice).unwrap()
        );
    }

    #[test]
    fn non_v1_version_rejected() {
        let score = Score::single_pulse("old", 62, 96);
        let mut value = serde_json::to_value(score).unwrap();
        value["schema_version"] = Value::from(2u64);
        let result = load_from_str(&serde_json::to_string(&value).unwrap());
        assert!(matches!(
            result.unwrap_err(),
            PersistError::UnsupportedVersion {
                found: 2,
                latest: SCHEMA_VERSION,
            }
        ));
    }

    #[test]
    fn future_version_rejected() {
        let json = r#"{"schema_version": 99}"#;
        let result = load_from_str(json);
        assert!(matches!(
            result.unwrap_err(),
            PersistError::UnsupportedVersion {
                found: 99,
                latest: SCHEMA_VERSION,
            }
        ));
    }

    #[test]
    fn missing_version_rejected() {
        let json = r#"{"id": "test"}"#;
        let result = load_from_str(json);
        assert!(matches!(result.unwrap_err(), PersistError::MissingVersion));
    }
}
