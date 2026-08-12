use serde::{Deserialize, Serialize};

use super::{
    CycleGenerator, GeneratedSpan, GeneratorCycleContext, GeneratorError, GeneratorSeedMode,
};
use crate::{mix_seed, ResolvedRhythmCell, ResolvedRhythmSpan, SplitMix64};

const EXAMPLE_DENSITY_SALT: u64 = 0xE8A6_0D31_5EED_0001;
const DENSITY_TARGET: &str = "generator.example.density";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExampleGeneratorParams {
    #[serde(default = "default_density_percent")]
    pub density_percent: u32,
    #[serde(default)]
    pub seed_mode: GeneratorSeedMode,
}

const fn default_density_percent() -> u32 {
    100
}

impl Default for ExampleGeneratorParams {
    fn default() -> Self {
        Self {
            density_percent: default_density_percent(),
            seed_mode: GeneratorSeedMode::default(),
        }
    }
}

impl ExampleGeneratorParams {
    pub(super) fn validate(&self) -> Result<(), GeneratorError> {
        if self.density_percent > 100 {
            return Err(GeneratorError::InvalidDensity(self.density_percent));
        }
        Ok(())
    }
}

impl CycleGenerator for ExampleGeneratorParams {
    fn generate(
        &self,
        context: &GeneratorCycleContext<'_>,
    ) -> Result<Vec<GeneratedSpan>, GeneratorError> {
        let density = (context.automation)(
            DENSITY_TARGET,
            context.cycle,
            f64::from(self.density_percent),
        )
        .unwrap_or(f64::from(self.density_percent))
        .round()
        .clamp(0.0, 100.0) as u32;
        Ok(context
            .spans
            .iter()
            .map(|span| {
                let span_stream =
                    context.seed ^ fnv1a64(&span.span_id.to_le_bytes()) ^ EXAMPLE_DENSITY_SALT;
                let cells = (0..span.span_len)
                    .map(|index| {
                        let sounds = if density == 100 {
                            true
                        } else if density == 0 {
                            false
                        } else {
                            let mut rng = SplitMix64::new(mix_seed(span_stream, u64::from(index)));
                            rng.next_below(100) < u64::from(density)
                        };
                        ResolvedRhythmCell {
                            index,
                            start: index,
                            len: 1,
                            rest: !sounds,
                            tied_from_previous: false,
                            tied_to_next: false,
                            velocity: None,
                        }
                    })
                    .collect();
                ResolvedRhythmSpan {
                    span_id: span.span_id,
                    span_len: span.span_len,
                    cells,
                }
            })
            .collect())
    }
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generators::{resolve_generator_cycle, GeneratorConfig, GeneratorSpanInput};

    fn input(span_id: u64, span_len: u32) -> GeneratorSpanInput {
        GeneratorSpanInput {
            span_id,
            span_len,
            label: None,
            section_index: Some(1),
            subdivision: None,
        }
    }

    fn generate_spans(
        density_percent: u32,
        seed: u64,
        inputs: &[GeneratorSpanInput],
    ) -> Vec<GeneratedSpan> {
        ExampleGeneratorParams {
            density_percent,
            seed_mode: GeneratorSeedMode::Locked { seed },
        }
        .generate(&GeneratorCycleContext {
            track_id: None,
            cycle: 0,
            cycle_beats: 4,
            spans: inputs,
            seed,
            automation: &|_, _, _| None,
        })
        .unwrap()
    }

    fn generate(density_percent: u32, seed: u64) -> Vec<GeneratedSpan> {
        generate_spans(density_percent, seed, &[input(4, 16)])
    }

    #[test]
    fn full_density_has_no_random_branch_and_sounds_every_step() {
        assert!(generate(100, 0)[0].cells.iter().all(|cell| !cell.rest));
        assert_eq!(generate(100, 0), generate(100, u64::MAX));
    }

    #[test]
    fn zero_density_keeps_the_grid_but_marks_every_step_rest() {
        assert!(generate(0, 0)[0].cells.iter().all(|cell| cell.rest));
    }

    #[test]
    fn partial_density_is_seeded_and_replayable() {
        assert_eq!(generate(60, 42), generate(60, 42));
        assert_ne!(generate(60, 42), generate(60, 43));
    }

    #[test]
    fn large_seed_density_vector_is_pinned() {
        let [span] = generate_spans(60, 9_007_199_254_740_993, &[input(9, 16)])
            .try_into()
            .expect("one generated span");
        assert_eq!(
            span.cells.iter().map(|cell| cell.rest).collect::<Vec<_>>(),
            vec![
                false, true, false, false, true, false, true, false, false, true, false, true,
                true, true, true, true,
            ]
        );
    }

    #[test]
    fn resolver_rejects_out_of_range_density() {
        let inputs = vec![input(4, 4)];
        let error = resolve_generator_cycle(
            &GeneratorConfig::Example(ExampleGeneratorParams {
                density_percent: 101,
                seed_mode: GeneratorSeedMode::Locked { seed: 7 },
            }),
            &GeneratorCycleContext {
                track_id: None,
                cycle: 0,
                cycle_beats: 4,
                spans: &inputs,
                seed: 7,
                automation: &|_, _, _| None,
            },
        )
        .unwrap_err();

        assert_eq!(error, GeneratorError::InvalidDensity(101));
    }

    #[test]
    fn span_identity_is_stable_across_reorder_and_unrelated_insertions() {
        let original_inputs = vec![input(4, 16), input(9, 12)];
        let reordered_inputs = vec![input(99, 7), input(9, 12), input(4, 16)];
        let original = generate_spans(60, 42, &original_inputs);
        let reordered = generate_spans(60, 42, &reordered_inputs);

        for span_id in [4, 9] {
            assert_eq!(
                original.iter().find(|span| span.span_id == span_id),
                reordered.iter().find(|span| span.span_id == span_id)
            );
        }
    }

    #[test]
    fn cells_tile_each_span_without_cross_span_ties() {
        for span in generate_spans(60, 42, &[input(4, 16), input(9, 12)]) {
            let mut cursor = 0;
            for (index, cell) in span.cells.iter().enumerate() {
                assert_eq!(cell.index, index as u32);
                assert_eq!(cell.start, cursor);
                assert_eq!(cell.len, 1);
                assert!(!cell.tied_from_previous);
                assert!(!cell.tied_to_next);
                cursor += cell.len;
            }
            assert_eq!(cursor, span.span_len);
        }
    }
}
