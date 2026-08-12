//! Generic cycle-generator seam.
//!
//! Seed resolution is deliberately owned by the caller. Both stopped preview
//! and transport playback resolve a `GeneratorSeedMode`, then call the same
//! exhaustive `resolve_generator_cycle` dispatch.

pub mod dumka;
mod example;

use cseq_model::{pulse_span_section_index, PulseSpan, PulseSpanId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{mix_seed, ResolvedRhythmCell, ResolvedRhythmSpan, SplitMix64};

pub use dumka::{
    BeatRange, DirectiveFamily, DirectiveOptions, DirectivePacing, DirectiveSkip,
    DirectiveTraceEntry, DumkaGeneratorParams, EvolutionDirective, RotateDirection,
    DEFAULT_DUMKA_PATTERN, MAX_EVOLUTION_DIRECTIVES,
};
pub use example::ExampleGeneratorParams;

pub type GeneratedSpan = ResolvedRhythmSpan;
pub type GeneratedCell = ResolvedRhythmCell;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorSpanInput {
    pub span_id: PulseSpanId,
    pub span_len: u32,
    pub label: Option<String>,
    #[serde(default)]
    pub section_index: Option<u32>,
    /// Exact matras per beat for the source span. Dum-Ka requires this to be
    /// present and identical across every span; `span_len` alone cannot
    /// distinguish Grouping geometry from a Subdivision change.
    #[serde(default)]
    pub subdivision: Option<u32>,
}

/// Derive the exact matras-per-beat rate carried by a pulse span.
///
/// Invalid, zero-duration, or fractional rates fail closed instead of being
/// rounded through the floating-point preview DTO.
pub fn pulse_span_subdivision(span: &PulseSpan) -> Option<u32> {
    let duration_numer = i128::from(*span.duration.numer());
    let duration_denom = i128::from(*span.duration.denom());
    if duration_numer <= 0 || duration_denom <= 0 {
        return None;
    }
    let scaled_matras = i128::from(span.matra_len).checked_mul(duration_denom)?;
    if scaled_matras % duration_numer != 0 {
        return None;
    }
    u32::try_from(scaled_matras / duration_numer)
        .ok()
        .filter(|subdivision| *subdivision > 0)
}

impl From<&PulseSpan> for GeneratorSpanInput {
    fn from(span: &PulseSpan) -> Self {
        Self {
            span_id: span.id,
            span_len: span.matra_len,
            label: None,
            section_index: pulse_span_section_index(span),
            subdivision: pulse_span_subdivision(span),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GeneratorConfig {
    Example(ExampleGeneratorParams),
    Dumka(DumkaGeneratorParams),
}

impl Default for GeneratorConfig {
    fn default() -> Self {
        Self::Example(ExampleGeneratorParams::default())
    }
}

impl GeneratorConfig {
    pub fn seed_mode_mut(&mut self) -> &mut GeneratorSeedMode {
        match self {
            Self::Example(params) => &mut params.seed_mode,
            Self::Dumka(params) => &mut params.seed_mode,
        }
    }

    pub fn seed_mode(&self) -> &GeneratorSeedMode {
        match self {
            Self::Example(params) => &params.seed_mode,
            Self::Dumka(params) => &params.seed_mode,
        }
    }

    pub fn validate(&self) -> Result<(), GeneratorError> {
        match self {
            Self::Example(params) => params.validate(),
            Self::Dumka(params) => params.validate(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GeneratorSeedMode {
    Locked {
        #[serde(with = "cseq_model::lossless_u64_serde")]
        seed: u64,
    },
    PerCycle {
        #[serde(with = "cseq_model::lossless_u64_serde")]
        seed: u64,
    },
    History {
        #[serde(with = "cseq_model::lossless_u64_serde")]
        seed: u64,
        #[serde(deserialize_with = "cseq_model::lossless_u64_vec_serde::deserialize")]
        history: Vec<u64>,
        #[serde(rename = "historyWeight", alias = "history_weight")]
        history_weight: u32,
        #[serde(rename = "newSeedWeight", alias = "new_seed_weight")]
        new_seed_weight: u32,
        #[serde(rename = "maxHistory", alias = "max_history")]
        max_history: usize,
    },
}

impl Default for GeneratorSeedMode {
    fn default() -> Self {
        Self::Locked { seed: 0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GeneratorSeedSource {
    Locked,
    PerCycle,
    History,
    New,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorSeedResolution {
    #[serde(with = "cseq_model::lossless_u64_serde")]
    pub seed: u64,
    pub source: GeneratorSeedSource,
    #[serde(with = "cseq_model::lossless_u64_vec_serde")]
    pub history: Vec<u64>,
}

pub fn resolve_generator_seed(
    mode: &mut GeneratorSeedMode,
    cycle: u64,
) -> Result<GeneratorSeedResolution, GeneratorError> {
    match mode {
        GeneratorSeedMode::Locked { seed } => Ok(GeneratorSeedResolution {
            seed: *seed,
            source: GeneratorSeedSource::Locked,
            history: vec![],
        }),
        GeneratorSeedMode::PerCycle { seed } => Ok(GeneratorSeedResolution {
            seed: mix_seed(*seed, cycle),
            source: GeneratorSeedSource::PerCycle,
            history: vec![],
        }),
        GeneratorSeedMode::History {
            seed,
            history,
            history_weight,
            new_seed_weight,
            max_history,
        } => {
            if *max_history == 0 {
                history.clear();
            } else {
                while history.len() > *max_history {
                    history.remove(0);
                }
            }
            let can_use_history = *max_history > 0 && !history.is_empty() && *history_weight > 0;
            let can_make_new = *new_seed_weight > 0;
            if !can_use_history && !can_make_new {
                return Err(GeneratorError::EmptySeedWeights);
            }

            let mut rng = SplitMix64::new(mix_seed(*seed, cycle));
            let history_band = u64::from(if can_use_history { *history_weight } else { 0 });
            let total = history_band + u64::from(if can_make_new { *new_seed_weight } else { 0 });
            if can_use_history && rng.next_below(total) < history_band {
                let index = rng.next_below(history.len() as u64) as usize;
                Ok(GeneratorSeedResolution {
                    seed: history[index],
                    source: GeneratorSeedSource::History,
                    history: history.clone(),
                })
            } else {
                let next_seed = rng.next_u64();
                if *max_history > 0 {
                    history.push(next_seed);
                    while history.len() > *max_history {
                        history.remove(0);
                    }
                }
                Ok(GeneratorSeedResolution {
                    seed: next_seed,
                    source: GeneratorSeedSource::New,
                    history: history.clone(),
                })
            }
        }
    }
}

/// Resolve the seed a sequential transport reaches at `cycle` without
/// mutating the authored mode. History mode replays every cycle start from
/// zero so newly learned seeds, reuse decisions, and pool truncation match
/// transport; stateless modes resolve the requested cycle directly.
pub fn resolve_generator_seed_at_cycle(
    mode: &GeneratorSeedMode,
    cycle: u64,
) -> Result<GeneratorSeedResolution, GeneratorError> {
    let mut replay = mode.clone();
    if !matches!(replay, GeneratorSeedMode::History { .. }) {
        return resolve_generator_seed(&mut replay, cycle);
    }

    let mut resolution = resolve_generator_seed(&mut replay, 0)?;
    for replay_cycle in 1..=cycle {
        resolution = resolve_generator_seed(&mut replay, replay_cycle)?;
    }
    Ok(resolution)
}

/// Sample one generator target at the requested cycle start. `None` means no
/// enabled automation source exists for the target, so the generator must use
/// its authored value. Keeping absence distinct lets cumulative generators
/// retain cheap feature-off paths without mistaking an automated value equal
/// to the authored default for an inactive lane.
pub type GeneratorAutomationSampler<'a> = dyn Fn(&str, u64, f64) -> Option<f64> + 'a;

pub struct GeneratorCycleContext<'a> {
    pub track_id: Option<&'a str>,
    pub cycle: u64,
    pub cycle_beats: u32,
    pub spans: &'a [GeneratorSpanInput],
    pub seed: u64,
    pub automation: &'a GeneratorAutomationSampler<'a>,
}

pub trait CycleGenerator {
    fn generate(
        &self,
        context: &GeneratorCycleContext<'_>,
    ) -> Result<Vec<GeneratedSpan>, GeneratorError>;
}

pub fn resolve_generator_cycle(
    config: &GeneratorConfig,
    context: &GeneratorCycleContext<'_>,
) -> Result<Vec<GeneratedSpan>, GeneratorError> {
    Ok(resolve_generator_cycle_with_trace(config, context)?.spans)
}

/// Generic generator output plus optional authoring trace. Transport keeps
/// calling [`resolve_generator_cycle`] and therefore receives the identical
/// span type; stopped preview may opt into this trace-capable view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratorCycleResolution {
    pub spans: Vec<GeneratedSpan>,
    pub trace: Vec<DirectiveTraceEntry>,
}

pub fn resolve_generator_cycle_with_trace(
    config: &GeneratorConfig,
    context: &GeneratorCycleContext<'_>,
) -> Result<GeneratorCycleResolution, GeneratorError> {
    config.validate()?;
    let (spans, trace) = match config {
        GeneratorConfig::Example(params) => (params.generate(context)?, Vec::new()),
        GeneratorConfig::Dumka(params) => params.generate_with_trace(context)?,
    };
    validate_generated_spans(context.spans, &spans)?;
    Ok(GeneratorCycleResolution { spans, trace })
}

fn validate_generated_spans(
    inputs: &[GeneratorSpanInput],
    spans: &[GeneratedSpan],
) -> Result<(), GeneratorError> {
    if inputs.len() != spans.len() {
        return Err(GeneratorError::SpanCount {
            expected: inputs.len(),
            actual: spans.len(),
        });
    }
    let mut previous_boundary: Option<(PulseSpanId, bool, bool)> = None;
    for (span_index, (input, span)) in inputs.iter().zip(spans).enumerate() {
        if input.span_id != span.span_id || input.span_len != span.span_len {
            return Err(GeneratorError::SpanIdentity {
                span_id: input.span_id,
            });
        }
        let mut cursor = 0;
        for (index, cell) in span.cells.iter().enumerate() {
            if cell.index != index as u32 || cell.start != cursor || cell.len == 0 {
                return Err(GeneratorError::InvalidCells {
                    span_id: input.span_id,
                });
            }
            cursor = cursor.saturating_add(cell.len);
        }
        if cursor != input.span_len {
            return Err(GeneratorError::InvalidCells {
                span_id: input.span_id,
            });
        }

        let Some(first) = span.cells.first() else {
            // Zero-length input spans are not produced by the structure
            // compiler, but preserve the old empty-tiling acceptance while
            // ensuring no tie can jump across one without a handshake.
            if previous_boundary.is_some_and(|(_, tied_to_next, _)| tied_to_next) {
                return Err(GeneratorError::CrossSpanTie {
                    span_id: input.span_id,
                });
            }
            previous_boundary = None;
            continue;
        };

        if span_index == 0 && first.tied_from_previous {
            return Err(GeneratorError::CrossSpanTie {
                span_id: input.span_id,
            });
        }
        if let Some((_, previous_tied_to_next, previous_rest)) = previous_boundary {
            let paired = previous_tied_to_next == first.tied_from_previous;
            let sounding = !previous_rest && !first.rest;
            if !paired || (first.tied_from_previous && !sounding) {
                return Err(GeneratorError::CrossSpanTie {
                    span_id: input.span_id,
                });
            }
        } else if first.tied_from_previous {
            return Err(GeneratorError::CrossSpanTie {
                span_id: input.span_id,
            });
        }

        let last = span
            .cells
            .last()
            .expect("a span with a first cell also has a last cell");
        previous_boundary = Some((input.span_id, last.tied_to_next, last.rest));
    }

    if let Some((span_id, true, _)) = previous_boundary {
        return Err(GeneratorError::CrossSpanTie { span_id });
    }
    Ok(())
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GeneratorError {
    #[error("example density must be 0-100, got {0}")]
    InvalidDensity(u32),
    #[error("dumka pattern parse error at line {line}, column {col}: {message}")]
    DumkaPattern {
        line: u32,
        col: u32,
        message: String,
    },
    #[error("dumka structure mismatch: {message}")]
    DumkaStructure { message: String },
    #[error("dumka {name} must be 0-100, got {value}")]
    DumkaRange { name: &'static str, value: u32 },
    #[error("dumka euclidMaxRun must be 1-8, got {value}")]
    DumkaMaxRun { value: u32 },
    #[error("dumka plan invalid: {message}")]
    DumkaPlanInvalid { message: String },
    #[error(
        "dumka plan overlap: {family} directives {first_id} and {second_id} share cycle {cycle}"
    )]
    DumkaPlanOverlap {
        family: &'static str,
        first_id: u64,
        second_id: u64,
        cycle: u64,
    },
    #[error("generator history mode needs a positive history or new-seed weight")]
    EmptySeedWeights,
    #[error("generator returned {actual} spans, expected {expected}")]
    SpanCount { expected: usize, actual: usize },
    #[error("generator changed span identity {span_id}")]
    SpanIdentity { span_id: PulseSpanId },
    #[error("generator returned invalid cells for span {span_id}")]
    InvalidCells { span_id: PulseSpanId },
    #[error("generator returned an unpaired cross-span tie at span {span_id}")]
    CrossSpanTie { span_id: PulseSpanId },
}

#[cfg(test)]
mod tests {
    use super::*;
    use cseq_model::{PulseSpanKind, Rational};

    fn input(id: u64, len: u32) -> GeneratorSpanInput {
        GeneratorSpanInput {
            span_id: id,
            span_len: len,
            label: None,
            section_index: Some(1),
            subdivision: None,
        }
    }

    fn cell(
        index: u32,
        start: u32,
        len: u32,
        rest: bool,
        tied_from_previous: bool,
        tied_to_next: bool,
    ) -> GeneratedCell {
        GeneratedCell {
            index,
            start,
            len,
            rest,
            tied_from_previous,
            tied_to_next,
            velocity: None,
        }
    }

    fn generated(id: u64, cells: Vec<GeneratedCell>) -> GeneratedSpan {
        GeneratedSpan {
            span_id: id,
            span_len: cells.iter().map(|cell| cell.len).sum(),
            cells,
        }
    }

    #[test]
    fn generated_span_validation_accepts_a_sounding_cross_span_tie_chain() {
        let inputs = vec![input(1, 2), input(2, 2), input(3, 2)];
        let spans = vec![
            generated(1, vec![cell(0, 0, 2, false, false, true)]),
            generated(2, vec![cell(0, 0, 2, false, true, true)]),
            generated(3, vec![cell(0, 0, 2, false, true, false)]),
        ];
        assert_eq!(validate_generated_spans(&inputs, &spans), Ok(()));
    }

    #[test]
    fn generated_span_validation_rejects_every_dangling_or_silent_handshake() {
        let one_input = vec![input(1, 1)];
        for invalid in [
            generated(1, vec![cell(0, 0, 1, false, true, false)]),
            generated(1, vec![cell(0, 0, 1, false, false, true)]),
        ] {
            assert_eq!(
                validate_generated_spans(&one_input, &[invalid]),
                Err(GeneratorError::CrossSpanTie { span_id: 1 })
            );
        }

        let inputs = vec![input(1, 1), input(2, 1)];
        let invalid_boundaries = [
            // The left side promises a continuation that the right refuses.
            vec![
                generated(1, vec![cell(0, 0, 1, false, false, true)]),
                generated(2, vec![cell(0, 0, 1, false, false, false)]),
            ],
            // The right side claims an opener that the left did not provide.
            vec![
                generated(1, vec![cell(0, 0, 1, false, false, false)]),
                generated(2, vec![cell(0, 0, 1, false, true, false)]),
            ],
            // Paired flags cannot turn a rest into a sounding continuation.
            vec![
                generated(1, vec![cell(0, 0, 1, true, false, true)]),
                generated(2, vec![cell(0, 0, 1, false, true, false)]),
            ],
            vec![
                generated(1, vec![cell(0, 0, 1, false, false, true)]),
                generated(2, vec![cell(0, 0, 1, true, true, false)]),
            ],
        ];
        for spans in invalid_boundaries {
            assert_eq!(
                validate_generated_spans(&inputs, &spans),
                Err(GeneratorError::CrossSpanTie { span_id: 2 })
            );
        }
    }

    #[test]
    fn cross_span_tie_error_names_the_right_hand_boundary_span() {
        let error = validate_generated_spans(
            &[input(41, 1), input(42, 1)],
            &[
                generated(41, vec![cell(0, 0, 1, false, false, true)]),
                generated(42, vec![cell(0, 0, 1, false, false, false)]),
            ],
        )
        .unwrap_err();
        assert_eq!(
            error.to_string(),
            "generator returned an unpaired cross-span tie at span 42"
        );
    }

    #[test]
    fn same_span_ties_and_non_crossing_output_keep_the_legacy_contract() {
        let spans = vec![generated(
            1,
            vec![
                cell(0, 0, 1, false, false, true),
                cell(1, 1, 1, false, true, false),
            ],
        )];
        assert_eq!(validate_generated_spans(&[input(1, 2)], &spans), Ok(()));

        let plain = vec![generated(
            7,
            vec![
                cell(0, 0, 1, false, false, false),
                cell(1, 1, 1, true, false, false),
            ],
        )];
        assert_eq!(validate_generated_spans(&[input(7, 2)], &plain), Ok(()));
    }

    #[test]
    fn pulse_span_subdivision_is_derived_exactly() {
        let mut span = PulseSpan {
            id: 7,
            kind: PulseSpanKind::JathiPulse {
                section_index: 2,
                jathi: 3,
                index: 0,
            },
            start: Rational::new(0, 1),
            duration: Rational::new(3, 7),
            start_matra: 0,
            matra_len: 3,
            tags: Vec::new(),
        };
        assert_eq!(GeneratorSpanInput::from(&span).subdivision, Some(7));

        span.duration = Rational::new(2, 3);
        span.matra_len = 1;
        assert_eq!(GeneratorSpanInput::from(&span).subdivision, None);
    }

    #[test]
    fn exhaustive_dispatch_preserves_span_contract() {
        let spans = vec![input(7, 4)];
        let context = GeneratorCycleContext {
            track_id: Some("track-1"),
            cycle: 3,
            cycle_beats: 4,
            spans: &spans,
            seed: 11,
            automation: &|_, _, _| None,
        };
        let output = resolve_generator_cycle(&GeneratorConfig::default(), &context).unwrap();
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].cells.len(), 4);
    }

    #[test]
    fn trace_capable_seam_preserves_generic_span_output() {
        let spans = (0..4)
            .map(|index| GeneratorSpanInput {
                span_id: index + 1,
                span_len: 4,
                label: None,
                section_index: Some(1),
                subdivision: Some(4),
            })
            .collect::<Vec<_>>();
        let context = GeneratorCycleContext {
            track_id: Some("track-1"),
            cycle: 1,
            cycle_beats: 4,
            spans: &spans,
            seed: 7,
            automation: &|_, _, _| None,
        };
        let mut params = DumkaGeneratorParams::default();
        params.plan.push(EvolutionDirective {
            id: 1,
            order: 0,
            enabled: true,
            from_cycle: 1,
            to_cycle: 1,
            family: DirectiveFamily::BarlowRemove,
            pacing: DirectivePacing::PerCycle,
            intensity: 15,
            scope: None,
            options: DirectiveOptions::default(),
        });
        let config = GeneratorConfig::Dumka(params);
        let traced = resolve_generator_cycle_with_trace(&config, &context).unwrap();
        assert_eq!(
            resolve_generator_cycle(&config, &context).unwrap(),
            traced.spans
        );
        assert_eq!(traced.trace.len(), 1);
        assert_eq!(traced.trace[0].directive_id, 1);

        let example = resolve_generator_cycle_with_trace(&GeneratorConfig::default(), &context)
            .expect("non-Dumka dispatch remains trace-free");
        assert!(example.trace.is_empty());
    }

    #[test]
    fn generator_config_deserializes_the_tagged_frontend_contract() {
        let config: GeneratorConfig = serde_json::from_value(serde_json::json!({
            "kind": "example",
            "densityPercent": 75,
            "seedMode": { "type": "perCycle", "seed": 17 }
        }))
        .unwrap();
        assert_eq!(
            config,
            GeneratorConfig::Example(ExampleGeneratorParams {
                density_percent: 75,
                seed_mode: GeneratorSeedMode::PerCycle { seed: 17 },
            })
        );

        let config: GeneratorConfig = serde_json::from_value(serde_json::json!({
            "kind": "dumka",
            "pattern": "x . x .",
            "seedMode": { "type": "locked", "seed": 5 }
        }))
        .unwrap();
        assert_eq!(
            config,
            GeneratorConfig::Dumka(DumkaGeneratorParams {
                pattern: "x . x .".to_string(),
                seed_mode: GeneratorSeedMode::Locked { seed: 5 },
                ..Default::default()
            })
        );

        let defaulted: GeneratorConfig =
            serde_json::from_value(serde_json::json!({ "kind": "dumka" })).unwrap();
        assert_eq!(
            defaulted,
            GeneratorConfig::Dumka(DumkaGeneratorParams::default())
        );
    }

    #[test]
    fn history_seed_replays_and_learns_without_float_math() {
        let mut mode = GeneratorSeedMode::History {
            seed: 9,
            history: vec![17],
            history_weight: 1,
            new_seed_weight: 1,
            max_history: 4,
        };
        let first = resolve_generator_seed(&mut mode, 5).unwrap();
        let mut replay = GeneratorSeedMode::History {
            seed: 9,
            history: vec![17],
            history_weight: 1,
            new_seed_weight: 1,
            max_history: 4,
        };
        assert_eq!(first, resolve_generator_seed(&mut replay, 5).unwrap());
    }

    #[test]
    fn seed_at_cycle_matches_a_transport_style_history_prefix() {
        let authored = GeneratorSeedMode::History {
            seed: 9,
            history: vec![17],
            history_weight: 1,
            new_seed_weight: 1,
            max_history: 4,
        };
        let mut transport = authored.clone();
        let mut reused = false;
        let mut learned = false;
        for cycle in 0..=32 {
            let sequential = resolve_generator_seed(&mut transport, cycle).unwrap();
            reused |= sequential.source == GeneratorSeedSource::History;
            learned |= sequential.source == GeneratorSeedSource::New;
            assert_eq!(
                resolve_generator_seed_at_cycle(&authored, cycle).unwrap(),
                sequential,
                "random access must replay the transport prefix through cycle {cycle}"
            );
        }
        assert!(reused, "fixture exercises a learned-history reuse");
        assert!(learned, "fixture exercises adding a new seed to history");
    }

    #[test]
    fn seed_at_cycle_truncates_the_authored_pool_before_history_reuse() {
        let authored = GeneratorSeedMode::History {
            seed: 73,
            history: vec![10, 20, 30, 40],
            history_weight: 1,
            new_seed_weight: 0,
            max_history: 2,
        };
        let mut transport = authored.clone();
        let mut sequential = None;
        for cycle in 0..=8 {
            sequential = Some(resolve_generator_seed(&mut transport, cycle).unwrap());
        }
        let sequential = sequential.unwrap();
        let random_access = resolve_generator_seed_at_cycle(&authored, 8).unwrap();
        assert_eq!(random_access, sequential);
        assert_eq!(random_access.source, GeneratorSeedSource::History);
        assert_eq!(random_access.history, vec![30, 40]);
        assert!(random_access.history.contains(&random_access.seed));
        assert_eq!(
            authored,
            GeneratorSeedMode::History {
                seed: 73,
                history: vec![10, 20, 30, 40],
                history_weight: 1,
                new_seed_weight: 0,
                max_history: 2,
            },
            "random access is pure and retains the authored initial pool"
        );
    }

    #[test]
    fn seed_at_cycle_fast_paths_stateless_modes() {
        for mode in [
            GeneratorSeedMode::Locked { seed: 42 },
            GeneratorSeedMode::PerCycle { seed: 42 },
        ] {
            let mut direct = mode.clone();
            assert_eq!(
                resolve_generator_seed_at_cycle(&mode, 10_000).unwrap(),
                resolve_generator_seed(&mut direct, 10_000).unwrap()
            );
        }
    }

    #[test]
    fn large_seed_resolution_vectors_are_pinned() {
        let large_seed = 9_007_199_254_740_993;
        let mut per_cycle = GeneratorSeedMode::PerCycle { seed: large_seed };
        assert_eq!(
            resolve_generator_seed(&mut per_cycle, 3).unwrap(),
            GeneratorSeedResolution {
                seed: 14_860_520_765_803_676_662,
                source: GeneratorSeedSource::PerCycle,
                history: vec![],
            }
        );

        let mut history = GeneratorSeedMode::History {
            seed: large_seed,
            history: vec![17, 9_007_199_254_740_995],
            history_weight: 1,
            new_seed_weight: 1,
            max_history: 4,
        };
        assert_eq!(
            resolve_generator_seed(&mut history, 3).unwrap(),
            GeneratorSeedResolution {
                seed: 301_863_032_735_174_168,
                source: GeneratorSeedSource::New,
                history: vec![17, 9_007_199_254_740_995, 301_863_032_735_174_168],
            }
        );
    }
}
