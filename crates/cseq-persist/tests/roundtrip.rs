//! Property tests for the persistence boundary: `save(load(x)) == x` at the
//! JSON-value level across generated scores (the retained constructor shapes,
//! custom subdivisions, and a transform), plus
//! double-round-trip idempotence. serde_json's shortest-repr float encoding
//! round-trips every finite f32/f64, so value identity is exact.
//! Added by docs/TEST_COVERAGE_PLAN_2026-07.md Phase 2.4 — cseq-persist was
//! the only engine crate without a property-based adversary.

use cseq_model as model;
use cseq_persist::load_from_str;
use proptest::prelude::*;

fn custom_subdivision(seed: u64) -> model::CustomSubdivisionSpec {
    model::CustomSubdivisionSpec {
        per_beat_weight: (seed % 3) as f32,
        equal_parts_weight: 1.0 + (seed % 2) as f32,
        part_count_weights: vec![model::WeightedCustomPartCount {
            count: 2 + (seed % 10) as u32,
            weight: 1.0,
        }],
        part_gati_weights: vec![model::WeightedSubdivisionChoice {
            subdivision: 1 + (seed % 8) as u32,
            weight: 1.0,
        }],
        divisions: vec![],
        jathi_weights: vec![],
    }
}

fn score_strategy() -> impl Strategy<Value = model::Score> {
    (0u8..3, any::<u64>(), 1u32..=6, any::<bool>()).prop_map(
        |(shape, seed, cycle_beats, with_custom)| {
            let pitch = 36 + (seed % 60) as u8;
            let mut score = match shape {
                0 => model::Score::single_pulse("prop-single", pitch, 96),
                1 => model::Score::subdivided(
                    "prop-subdivided",
                    &[pitch, pitch + 3, pitch + 7],
                    90,
                    model::SubdivisionPolicy::Equal,
                ),
                _ => model::Score::subdivision_switch(
                    "prop-switch",
                    model::SubdivisionSwitchSpec {
                        cycle_beats,
                        initial_weights: vec![model::WeightedSubdivisionChoice {
                            subdivision: 1 + (seed % 8) as u32,
                            weight: 1.0,
                        }],
                        initial_jathi_weights: vec![],
                        initial_custom_subdivision: with_custom.then(|| custom_subdivision(seed)),
                        automation: None,
                        inflections: vec![],
                        switch_count_weights: vec![],
                        seed_mode: match seed % 3 {
                            0 => model::SwitchSeedMode::Locked { seed },
                            1 => model::SwitchSeedMode::PerCycle { seed },
                            _ => model::SwitchSeedMode::History {
                                seed,
                                history: vec![seed ^ 1],
                                history_weight: 1.0,
                                new_seed_weight: 1.0,
                                max_history: 4,
                            },
                        },
                        accent: model::GatiAccentSpec::default(),
                        pitch,
                        velocity: 96,
                    },
                ),
            };
            if seed % 2 == 0 {
                score.add_transform(
                    model::TransformKind::SetVelocity {
                        velocity: model::ValueSpec::fixed(64 + (seed % 60) as u8),
                    },
                    model::NodeSelector::Root,
                    Some("prop velocity".to_string()),
                );
            }
            score
        },
    )
}

proptest! {
    /// save → load is value-identity: nothing is dropped, defaulted
    /// differently, or re-encoded lossily across the persistence boundary.
    #[test]
    fn save_load_is_value_identity(score in score_strategy()) {
        let json = serde_json::to_string(&score).unwrap();
        let loaded = load_from_str(&json).unwrap();
        prop_assert_eq!(
            serde_json::to_value(&score).unwrap(),
            serde_json::to_value(&loaded).unwrap()
        );
    }

    /// Double round-trip is idempotent (no per-pass churn).
    #[test]
    fn round_trip_is_idempotent(score in score_strategy()) {
        let once = load_from_str(&serde_json::to_string(&score).unwrap()).unwrap();
        let twice = load_from_str(&serde_json::to_string(&once).unwrap()).unwrap();
        prop_assert_eq!(
            serde_json::to_value(&once).unwrap(),
            serde_json::to_value(&twice).unwrap()
        );
    }
}
