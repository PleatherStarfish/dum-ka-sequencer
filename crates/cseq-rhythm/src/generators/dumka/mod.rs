//! The Dum-Ka generator: a seed pattern authored in the Dum-Ka notation,
//! developed cycle by cycle by the evolution fold.
//!
//! Cycle 0 renders the seed verbatim. Authored `evolutionRate` 0 does the
//! same when no enabled rate-automation source exists; an active lane is
//! sampled at every historical cycle start so a later 0 freezes, rather
//! than erases, the completed prefix. Beyond that, [`evolve`] folds
//! identity-seeded Barlow add/remove and beat-rotation operators over
//! `ctx.cycle` starting from the seed: a Locked seed is one deterministic
//! trajectory, byte-identical on replay; PerCycle/History re-base the fold.
//! The per-cycle drift leash bounds add/remove distance from the seed, and
//! every candidate op and leash contraction is trial-projected so evolution
//! can never make the pattern unplayable.
//!
//! Dum-Ka is positional: spans are consumed in the temporal order the
//! platform supplies them, because the pattern describes the whole cycle
//! rather than independent per-span decisions.

pub mod barlow;
pub mod dsl;
pub mod euclid;
pub mod evolve;
pub mod figures;
pub mod lattice;
pub mod perceptual;
pub mod plan;
pub mod reshape;
pub mod sioros;
pub mod tree;

use serde::{Deserialize, Serialize};

use super::{
    CycleGenerator, GeneratedSpan, GeneratorCycleContext, GeneratorError, GeneratorSeedMode,
};
use evolve::EvolutionInputs;
use tree::CompiledSeed;

pub use evolve::{evolution_state, EvolutionState, EvolvedOnset};

pub use perceptual::{
    perceptual_distance, PerceptualBreakdown, PerceptualContext, PerceptualCycleDistance,
    PerceptualDistance,
    PerceptualError, PerceptualModel, PerceptualModelVersion, PerceptualWeights,
    PERCEPTUAL_DISTANCE_MAX_MILLI,
};
pub use plan::{
    BeatRange, DensityCorridorClamp, DensityCorridorLimit, DirectiveFamily, DirectiveMagnitude,
    DirectiveOptions, DirectivePacing, DirectiveSkip, DirectiveTraceEntry, EvolutionDirective,
    PerceptualPacingTrace, RotateDirection, LEGACY_EVOLUTION_TRACE_ID, MAX_EVOLUTION_DIRECTIVES,
    MAX_PERCEPTUAL_DISTANCE_MILLI, MAX_PERCEPTUAL_OPERATIONS, MAX_PERCEPTUAL_SCORING_WORK,
};

/// Automation target sampled at each folded cycle's start by both callers.
pub const DUMKA_EVOLUTION_RATE_TARGET: &str = "generator.dumka.evolutionRate";
/// Automation target sampled at each folded cycle's start by both callers.
pub const DUMKA_DRIFT_LEASH_TARGET: &str = "generator.dumka.driftLeash";
/// Automation target sampled at each folded cycle's start by both callers.
pub const DUMKA_BARLOW_TEMPERATURE_TARGET: &str = "generator.dumka.barlowTemperature";
/// Automation target sampled at each folded cycle's start by both callers.
pub const DUMKA_FILL_COMPLEXITY_TARGET: &str = "generator.dumka.fillComplexity";
/// Automation target sampled at each folded cycle's start by both callers.
pub const DUMKA_DENSITY_FLOOR_TARGET: &str = "generator.dumka.densityFloor";
/// Automation target sampled at each folded cycle's start by both callers.
pub const DUMKA_DENSITY_CEILING_TARGET: &str = "generator.dumka.densityCeiling";

/// The pattern a fresh Dum-Ka config carries: four beats at Subdivision 4,
/// so it plays on a fresh project's default structure without edits.
pub const DEFAULT_DUMKA_PATTERN: &str = "[dum . . ka] [. . ka .] [dum . ka .] [x x . x]";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumkaGeneratorParams {
    /// Seed notation text, persisted verbatim; parsing happens here.
    #[serde(default = "default_pattern")]
    pub pattern: String,
    /// Authored percent chance per cycle that one evolution operator fires
    /// (0 = seed verbatim when no rate automation is active; the M1 behavior
    /// and the serde default).
    #[serde(default)]
    pub evolution_rate: u32,
    /// Maximum add/remove drift from the seed, as a percent of the seed's
    /// onset count.
    #[serde(default = "default_drift_leash")]
    pub drift_leash: u32,
    /// Minimum onset density, as a percent of the seed grid. Together with
    /// `density_ceiling`, the 0/100 defaults leave evolution unchanged.
    #[serde(default)]
    pub density_floor: u32,
    /// Maximum onset density, as a percent of the seed grid.
    #[serde(default = "default_density_ceiling")]
    pub density_ceiling: u32,
    /// Barlow candidate-pool temperature: 0 keeps the strict
    /// most/least-indispensable choice; 100 draws uniformly over all
    /// candidates (deterministic integer pool widening, see evolve.rs).
    #[serde(default)]
    pub barlow_temperature: u32,
    /// Per-family operator weights (authored only). The defaults reproduce
    /// the historical Remove 3 / Add 3 / Rotate 2 draw exactly; the Sioros
    /// displacement pair is opt-in at weight 0.
    #[serde(default = "default_weight_barlow_remove")]
    pub weight_barlow_remove: u32,
    #[serde(default = "default_weight_barlow_add")]
    pub weight_barlow_add: u32,
    #[serde(default = "default_weight_rotate")]
    pub weight_rotate: u32,
    #[serde(default)]
    pub weight_syncopate: u32,
    #[serde(default)]
    pub weight_desyncopate: u32,
    /// The figure pair (Mongeau–Sankoff fragmentation/consolidation) ships
    /// opt-in at weight 0, like the displacement pair before it.
    #[serde(default)]
    pub weight_fragment: u32,
    #[serde(default)]
    pub weight_consolidate: u32,
    /// Figure-size bias for Fragment: 0 always picks the simplest true
    /// tuplet, 100 draws over every legal size (integer pool widening over
    /// the divisors-first order, see figures.rs).
    #[serde(default)]
    pub fill_complexity: u32,
    /// Euclidean reshape family weight (opt-in at 0): redistributes one
    /// window's onsets onto a maximally even necklace (see reshape.rs).
    #[serde(default)]
    pub weight_euclid: u32,
    /// Burst run cap for reshape: 1 = plain Bjorklund, 2-8 clusters onsets
    /// into runs of at most this length (Caesura's burst masks).
    #[serde(default = "default_euclid_max_run")]
    pub euclid_max_run: u32,
    /// Percent chance a fired reshape complements its mask (Caesura's
    /// invert): the window's k onsets become n−k.
    #[serde(default)]
    pub euclid_invert: u32,
    /// Whether reshaped onsets sustain to the next onset (tied, the
    /// default) or hit for one slot (silent) — Caesura's rest policy.
    #[serde(default)]
    pub euclid_rest_policy: reshape::EuclidRestPolicy,
    /// Authored evolution score. An empty plan preserves the legacy fold
    /// byte-for-byte.
    #[serde(default)]
    pub plan: Vec<EvolutionDirective>,
    /// UI canvas extent only. The engine deliberately never reads it.
    #[serde(default)]
    pub plan_length_cycles: u32,
    #[serde(default)]
    pub seed_mode: GeneratorSeedMode,
}

fn default_pattern() -> String {
    DEFAULT_DUMKA_PATTERN.to_string()
}

const fn default_drift_leash() -> u32 {
    25
}

const fn default_density_ceiling() -> u32 {
    100
}

const fn default_weight_barlow_remove() -> u32 {
    3
}

const fn default_weight_barlow_add() -> u32 {
    3
}

const fn default_weight_rotate() -> u32 {
    2
}

const fn default_euclid_max_run() -> u32 {
    1
}

impl Default for DumkaGeneratorParams {
    fn default() -> Self {
        Self {
            pattern: default_pattern(),
            evolution_rate: 0,
            drift_leash: default_drift_leash(),
            density_floor: 0,
            density_ceiling: default_density_ceiling(),
            barlow_temperature: 0,
            weight_barlow_remove: default_weight_barlow_remove(),
            weight_barlow_add: default_weight_barlow_add(),
            weight_rotate: default_weight_rotate(),
            weight_syncopate: 0,
            weight_desyncopate: 0,
            weight_fragment: 0,
            weight_consolidate: 0,
            fill_complexity: 0,
            weight_euclid: 0,
            euclid_max_run: default_euclid_max_run(),
            euclid_invert: 0,
            euclid_rest_policy: reshape::EuclidRestPolicy::default(),
            plan: Vec::new(),
            plan_length_cycles: 0,
            seed_mode: GeneratorSeedMode::default(),
        }
    }
}

impl DumkaGeneratorParams {
    pub(super) fn validate(&self) -> Result<(), GeneratorError> {
        for (name, value) in [
            ("evolutionRate", self.evolution_rate),
            ("driftLeash", self.drift_leash),
            ("densityFloor", self.density_floor),
            ("densityCeiling", self.density_ceiling),
            ("barlowTemperature", self.barlow_temperature),
            ("weightBarlowRemove", self.weight_barlow_remove),
            ("weightBarlowAdd", self.weight_barlow_add),
            ("weightRotate", self.weight_rotate),
            ("weightSyncopate", self.weight_syncopate),
            ("weightDesyncopate", self.weight_desyncopate),
            ("weightFragment", self.weight_fragment),
            ("weightConsolidate", self.weight_consolidate),
            ("fillComplexity", self.fill_complexity),
            ("weightEuclid", self.weight_euclid),
            ("euclidInvert", self.euclid_invert),
        ] {
            if value > 100 {
                return Err(GeneratorError::DumkaRange { name, value });
            }
        }
        if self.density_floor > self.density_ceiling {
            return Err(GeneratorError::DumkaPlanInvalid {
                message: format!(
                    "densityFloor must be at most densityCeiling, got {} > {}",
                    self.density_floor, self.density_ceiling
                ),
            });
        }
        if self.euclid_max_run == 0 || self.euclid_max_run > 8 {
            return Err(GeneratorError::DumkaMaxRun {
                value: self.euclid_max_run,
            });
        }
        plan::validate_plan(&self.plan)?;
        let seed = self.compile()?;
        if barlow::stratification(seed.total_beats, seed.required_subdivision).is_none() {
            if let Some(directive) = self.plan.iter().find(|directive| {
                directive.enabled
                    && matches!(directive.magnitude, DirectiveMagnitude::Perceptual { .. })
            }) {
                return Err(unsupported_perceptual_grid(directive.id));
            }
        }
        Ok(())
    }

    fn op_weights(&self) -> evolve::OpWeights {
        evolve::OpWeights {
            barlow_remove: self.weight_barlow_remove,
            barlow_add: self.weight_barlow_add,
            rotate: self.weight_rotate,
            syncopate: self.weight_syncopate,
            desyncopate: self.weight_desyncopate,
            fragment: self.weight_fragment,
            consolidate: self.weight_consolidate,
            euclid: self.weight_euclid,
        }
    }

    fn compile(&self) -> Result<CompiledSeed, GeneratorError> {
        let parsed = dsl::parse(&self.pattern).map_err(pattern_error)?;
        tree::compile(&parsed).map_err(pattern_error)
    }
}

fn pattern_error(error: dsl::PatternError) -> GeneratorError {
    GeneratorError::DumkaPattern {
        line: error.line,
        col: error.col,
        message: error.message,
    }
}

fn unsupported_perceptual_grid(directive_id: u64) -> GeneratorError {
    GeneratorError::DumkaPlanInvalid {
        message: format!(
            "directive {directive_id} perceptual magnitude requires a Barlow-supported beat/subdivision grid"
        ),
    }
}

impl CycleGenerator for DumkaGeneratorParams {
    fn generate(
        &self,
        context: &GeneratorCycleContext<'_>,
    ) -> Result<Vec<GeneratedSpan>, GeneratorError> {
        self.generate_with_trace(context).map(|(spans, _, _, _)| spans)
    }
}

impl DumkaGeneratorParams {
    pub(crate) fn generate_with_trace(
        &self,
        context: &GeneratorCycleContext<'_>,
    ) -> Result<
        (
            Vec<GeneratedSpan>,
            Vec<DirectiveTraceEntry>,
            super::DensityCorridorRange,
            Option<super::PerceptualCycleDistance>,
        ),
        GeneratorError,
    > {
        // `validate_plan` rejects over-budget authored ranges up front. Keep
        // this request-relative check at the expensive seam as defense in
        // depth for any future internal caller that bypasses config validation.
        plan::validate_perceptual_scoring_work_through(&self.plan, context.cycle)?;
        let seed = self.compile()?;
        let inputs = EvolutionInputs {
            seed_value: context.seed,
            cycle: context.cycle,
            evolution_rate: self.evolution_rate,
            drift_leash: self.drift_leash,
            density_floor: self.density_floor,
            density_ceiling: self.density_ceiling,
            barlow_temperature: self.barlow_temperature,
            fill_complexity: self.fill_complexity,
            euclid_max_run: self.euclid_max_run,
            euclid_invert: self.euclid_invert,
            euclid_rest_policy: self.euclid_rest_policy,
            plan: &self.plan,
            op_weights: self.op_weights(),
            automation: context.automation,
            spans: context.spans,
            cycle_beats: context.cycle_beats,
        };
        if barlow::stratification(seed.total_beats, seed.required_subdivision).is_none() {
            if let Some(directive) = self.plan.iter().find(|directive| {
                directive.enabled
                    && directive.from_cycle <= context.cycle
                    && matches!(directive.magnitude, DirectiveMagnitude::Perceptual { .. })
            }) {
                return Err(unsupported_perceptual_grid(directive.id));
            }
        }
        let resolved = evolve::evolved_seed_with_trace(&seed, &inputs);
        let (evolved, trace, density_corridor, cycle_distance) = match resolved {
            Some(resolved) => (
                resolved.seed,
                resolved.trace,
                resolved.density_corridor,
                resolved.cycle_distance,
            ),
            None => (
                seed,
                Vec::new(),
                // `None` is reserved for unsupported Barlow grids with no
                // active global, automated, or historical plan corridor.
                super::DensityCorridorRange {
                    floor: 0,
                    ceiling: 100,
                },
                None,
            ),
        };
        let spans = tree::resolve_seed_cells(&evolved, context.cycle_beats, context.spans)
            .map_err(|error| GeneratorError::DumkaStructure {
                message: error.to_string(),
            })?;
        Ok((spans, trace, density_corridor, cycle_distance))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generators::{
        resolve_generator_cycle, resolve_generator_cycle_with_trace, GeneratorConfig,
        GeneratorSpanInput,
    };

    fn params(pattern: &str) -> DumkaGeneratorParams {
        DumkaGeneratorParams {
            pattern: pattern.to_string(),
            seed_mode: GeneratorSeedMode::Locked { seed: 7 },
            ..Default::default()
        }
    }

    fn context<'a>(
        spans: &'a [GeneratorSpanInput],
        cycle: u64,
        cycle_beats: u32,
        seed: u64,
        automation: &'a super::super::GeneratorAutomationSampler<'a>,
    ) -> GeneratorCycleContext<'a> {
        GeneratorCycleContext {
            track_id: None,
            cycle,
            cycle_beats,
            spans,
            seed,
            automation,
        }
    }

    fn per_beat_spans(beats: u64, subdivision: u32) -> Vec<GeneratorSpanInput> {
        (0..beats)
            .map(|i| GeneratorSpanInput {
                span_id: i + 1,
                span_len: subdivision,
                label: None,
                section_index: Some(1),
                subdivision: Some(subdivision),
            })
            .collect()
    }

    fn resolve(
        pattern: &str,
        spans: &[GeneratorSpanInput],
        cycle: u64,
        cycle_beats: u32,
        seed: u64,
    ) -> Result<Vec<GeneratedSpan>, GeneratorError> {
        let sampler: &super::super::GeneratorAutomationSampler<'_> = &|_, _, _| None;
        resolve_generator_cycle(
            &GeneratorConfig::Dumka(params(pattern)),
            &context(spans, cycle, cycle_beats, seed, sampler),
        )
    }

    #[test]
    fn default_pattern_plays_on_a_fresh_project_structure() {
        let spans = per_beat_spans(4, 4);
        let resolved = resolve(DEFAULT_DUMKA_PATTERN, &spans, 0, 4, 7).unwrap();
        assert_eq!(resolved.len(), 4);
        let sounding: usize = resolved
            .iter()
            .flat_map(|span| span.cells.iter())
            .filter(|cell| !cell.rest)
            .count();
        assert_eq!(sounding, 8);
        for span in &resolved {
            let total: u32 = span.cells.iter().map(|cell| cell.len).sum();
            assert_eq!(total, span.span_len);
        }
    }

    #[test]
    fn every_cycle_and_seed_resolves_byte_identically_in_m1() {
        let spans = per_beat_spans(4, 4);
        let base = resolve(DEFAULT_DUMKA_PATTERN, &spans, 0, 4, 7).unwrap();
        assert_eq!(
            base,
            resolve(DEFAULT_DUMKA_PATTERN, &spans, 9, 4, 7).unwrap()
        );
        assert_eq!(
            base,
            resolve(DEFAULT_DUMKA_PATTERN, &spans, 0, 4, u64::MAX).unwrap()
        );
    }

    #[test]
    fn parse_errors_use_the_pinned_display_format() {
        let error = resolve("x .\n[x ka@0]", &per_beat_spans(4, 4), 0, 4, 7).unwrap_err();
        assert_eq!(
            error.to_string(),
            "dumka pattern parse error at line 2, column 7: weight must be 1-512"
        );
    }

    #[test]
    fn structure_mismatches_use_the_pinned_display_format() {
        let error = resolve("x . x .", &per_beat_spans(3, 4), 0, 3, 7).unwrap_err();
        assert_eq!(
            error.to_string(),
            "dumka structure mismatch: pattern spans 4 beats but the cycle has 3"
        );

        let error = resolve("[x x x x x]@2 x x", &per_beat_spans(4, 4), 0, 4, 7).unwrap_err();
        assert_eq!(
            error.to_string(),
            "dumka structure mismatch: pattern needs Subdivision 5 (or a multiple); the section has 4"
        );
    }

    #[test]
    fn sustains_across_per_beat_spans_emit_a_paired_tie() {
        let resolved = resolve("x _ x .", &per_beat_spans(4, 4), 0, 4, 7).unwrap();
        assert!(resolved[0].cells.last().unwrap().tied_to_next);
        assert!(resolved[1].cells.first().unwrap().tied_from_previous);
    }

    #[test]
    fn whole_cycle_span_holds_sustains_and_tuplets() {
        let spans = vec![GeneratorSpanInput {
            span_id: 42,
            span_len: 80,
            label: None,
            section_index: Some(1),
            subdivision: Some(20),
        }];
        let resolved = resolve("[dum@3 ka] [. ka] [dum ka dum ka dum]@2", &spans, 0, 4, 7).unwrap();
        assert_eq!(resolved[0].cells.len(), 9);
        assert!(resolved[0]
            .cells
            .iter()
            .all(|cell| !cell.tied_from_previous && !cell.tied_to_next));
    }

    #[test]
    fn evolution_rate_automation_drives_the_fold_at_cycle_start() {
        let spans = per_beat_spans(4, 4);
        let automated: &super::super::GeneratorAutomationSampler<'_> = &|target, _, _| {
            if target == DUMKA_EVOLUTION_RATE_TARGET {
                Some(100.0)
            } else {
                None
            }
        };
        // Authored rate stays 0; the sampled target drives the fold.
        let with_automation = resolve_generator_cycle(
            &GeneratorConfig::Dumka(params(DEFAULT_DUMKA_PATTERN)),
            &context(&spans, 12, 4, 7, automated),
        )
        .unwrap();
        let without = resolve(DEFAULT_DUMKA_PATTERN, &spans, 12, 4, 7).unwrap();
        assert_ne!(with_automation, without, "automation moved the walk");
        assert_eq!(
            without,
            resolve(DEFAULT_DUMKA_PATTERN, &spans, 0, 4, 7).unwrap(),
            "authored rate 0 keeps the seed verbatim at any cycle"
        );
    }

    #[test]
    fn cycle_varying_rate_preserves_the_completed_fold_prefix() {
        let spans = per_beat_spans(4, 4);
        let varying: &super::super::GeneratorAutomationSampler<'_> = &|target, cycle, _| {
            (target == DUMKA_EVOLUTION_RATE_TARGET).then_some(if cycle == 1 { 100.0 } else { 0.0 })
        };
        let config = GeneratorConfig::Dumka(params(DEFAULT_DUMKA_PATTERN));
        let cycle_one =
            resolve_generator_cycle(&config, &context(&spans, 1, 4, 7, varying)).unwrap();
        let cycle_two =
            resolve_generator_cycle(&config, &context(&spans, 2, 4, 7, varying)).unwrap();
        let seed = resolve(DEFAULT_DUMKA_PATTERN, &spans, 0, 4, 7).unwrap();

        assert_ne!(cycle_one, seed, "seed 7 adds an onset in cycle one");
        assert_eq!(
            cycle_two, cycle_one,
            "cycle-two rate zero freezes, rather than erases, cycle one's step"
        );
    }

    #[test]
    fn barlow_add_chooses_a_silent_slot_outside_authored_sustains() {
        // Subdivision 1 with Grouping 3 produces authored-valid [3, 1]
        // spans. Seed 7 chooses Add in cycle one; slot 2 has the strongest
        // empty-onset rank but is covered by x's 0..3 sustain, so the actual
        // one-slot hit must use the only silent slot at 3.
        let spans = vec![
            GeneratorSpanInput {
                span_id: 1,
                span_len: 3,
                label: None,
                section_index: Some(1),
                subdivision: Some(1),
            },
            GeneratorSpanInput {
                span_id: 2,
                span_len: 1,
                label: None,
                section_index: Some(1),
                subdivision: Some(1),
            },
        ];
        let mut evolving = params("x@3 .");
        evolving.evolution_rate = 100;
        evolving.drift_leash = 100;
        let no_automation: &super::super::GeneratorAutomationSampler<'_> = &|_, _, _| None;
        let resolved = resolve_generator_cycle(
            &GeneratorConfig::Dumka(evolving),
            &context(&spans, 1, 4, 7, no_automation),
        )
        .unwrap();

        assert_eq!(resolved[0].cells.len(), 1);
        assert!(!resolved[0].cells[0].rest);
        assert_eq!(resolved[0].cells[0].len, 3);
        assert_eq!(resolved[1].cells.len(), 1);
        assert!(!resolved[1].cells[0].rest, "Add must sound at slot 3");
    }

    #[test]
    fn rotated_tied_reshape_cannot_leave_a_dangling_cycle_edge_tie() {
        // Minimized from the parallel transport invariant. Cycle one can
        // create duration-covering Euclidean onsets; cycle two can then draw
        // a global beat rotation. Rotating only the onset would move the
        // final sustain past the absolute cycle fence, so that candidate must
        // be rejected during evolution rather than reaching span validation.
        let spans = per_beat_spans(4, 1);
        let evolving = DumkaGeneratorParams {
            pattern: "x . x .".to_string(),
            evolution_rate: 69,
            drift_leash: 51,
            density_floor: 0,
            density_ceiling: 50,
            barlow_temperature: 0,
            weight_barlow_remove: 37,
            weight_barlow_add: 67,
            weight_rotate: 24,
            weight_syncopate: 71,
            weight_desyncopate: 17,
            weight_fragment: 84,
            weight_consolidate: 23,
            fill_complexity: 50,
            weight_euclid: 90,
            euclid_max_run: 2,
            euclid_invert: 0,
            euclid_rest_policy: reshape::EuclidRestPolicy::Tied,
            plan: Vec::new(),
            plan_length_cycles: 0,
            seed_mode: GeneratorSeedMode::History {
                seed: 9_792_447_587_191_451_430,
                history: vec![9_603_363_527_571_367_637],
                history_weight: 70,
                new_seed_weight: 5,
                max_history: 8,
            },
        };
        let no_automation: &super::super::GeneratorAutomationSampler<'_> = &|_, _, _| None;
        let resolved = resolve_generator_cycle(
            &GeneratorConfig::Dumka(evolving),
            &context(&spans, 2, 4, 9_603_363_527_571_367_637, no_automation),
        )
        .expect("cycle-edge sustain is rejected before span validation");

        assert!(!resolved[0].cells[0].tied_from_previous);
        assert!(!resolved[3].cells.last().unwrap().tied_to_next);
    }

    #[test]
    fn out_of_range_knobs_are_rejected_not_clamped() {
        let mut over = params(DEFAULT_DUMKA_PATTERN);
        over.evolution_rate = 101;
        assert_eq!(
            GeneratorConfig::Dumka(over)
                .validate()
                .unwrap_err()
                .to_string(),
            "dumka evolutionRate must be 0-100, got 101"
        );
        let mut leash = params(DEFAULT_DUMKA_PATTERN);
        leash.drift_leash = 250;
        assert_eq!(
            GeneratorConfig::Dumka(leash)
                .validate()
                .unwrap_err()
                .to_string(),
            "dumka driftLeash must be 0-100, got 250"
        );

        let mut crossed = params(DEFAULT_DUMKA_PATTERN);
        crossed.density_floor = 61;
        crossed.density_ceiling = 60;
        assert_eq!(
            GeneratorConfig::Dumka(crossed)
                .validate()
                .unwrap_err()
                .to_string(),
            "dumka plan invalid: densityFloor must be at most densityCeiling, got 61 > 60"
        );
    }

    #[test]
    fn density_corridor_serde_defaults_are_behavior_off() {
        let decoded: DumkaGeneratorParams = serde_json::from_value(serde_json::json!({
            "pattern": DEFAULT_DUMKA_PATTERN
        }))
        .unwrap();
        assert_eq!(decoded.density_floor, 0);
        assert_eq!(decoded.density_ceiling, 100);
        assert_eq!(
            decoded,
            DumkaGeneratorParams {
                pattern: DEFAULT_DUMKA_PATTERN.to_string(),
                ..Default::default()
            }
        );
    }

    #[test]
    fn perceptual_magnitude_fails_closed_on_an_unsupported_metric_grid() {
        let spans = vec![GeneratorSpanInput {
            span_id: 1,
            span_len: 11,
            label: None,
            section_index: Some(1),
            subdivision: Some(11),
        }];
        let context = GeneratorCycleContext {
            track_id: None,
            cycle: 1,
            cycle_beats: 1,
            spans: &spans,
            seed: 7,
            automation: &|_, _, _| None,
        };
        let mut config = params("[x . . . . . . . . . .]");
        config.plan.push(EvolutionDirective {
            id: 9,
            order: 0,
            enabled: true,
            from_cycle: 1,
            to_cycle: 1,
            family: DirectiveFamily::BarlowAdd,
            pacing: DirectivePacing::PerCycle,
            magnitude: DirectiveMagnitude::Perceptual {
                model_version: PerceptualModelVersion::V1,
                target_milli: 5_000,
                tolerance_milli: 500,
                max_operations: 4,
            },
            intensity: 25,
            scope: None,
            options: DirectiveOptions::default(),
        });
        assert_eq!(
            config.generate_with_trace(&context).unwrap_err(),
            GeneratorError::DumkaPlanInvalid {
                message: "directive 9 perceptual magnitude requires a Barlow-supported beat/subdivision grid".to_string(),
            }
        );

        config.plan[0].from_cycle = 9;
        config.plan[0].to_cycle = 9;
        assert_eq!(
            GeneratorConfig::Dumka(config.clone())
                .validate()
                .unwrap_err(),
            GeneratorError::DumkaPlanInvalid {
                message: "directive 9 perceptual magnitude requires a Barlow-supported beat/subdivision grid".to_string(),
            },
            "future model-incompatible rows must fail authoring validation before playback reaches them"
        );

        config.plan[0].enabled = false;
        GeneratorConfig::Dumka(config.clone()).validate().unwrap();
        assert!(config.generate_with_trace(&context).is_ok());
    }

    #[test]
    fn preview_reports_the_cycle_effective_automated_and_directive_corridor() {
        let spans = per_beat_spans(4, 4);
        let automated: &super::super::GeneratorAutomationSampler<'_> = &|target, _, _| match target
        {
            DUMKA_DENSITY_FLOOR_TARGET => Some(70.0),
            DUMKA_DENSITY_CEILING_TARGET => Some(55.0),
            _ => None,
        };
        let mut config = params(DEFAULT_DUMKA_PATTERN);
        let context = context(&spans, 2, 4, 7, automated);
        let resolved =
            resolve_generator_cycle_with_trace(&GeneratorConfig::Dumka(config.clone()), &context)
                .unwrap();
        assert_eq!(
            resolved.density_corridor,
            Some(super::super::DensityCorridorRange {
                floor: 55,
                ceiling: 55,
            }),
            "crossed automation gives the ceiling precedence"
        );

        config.plan = vec![EvolutionDirective {
            id: 1,
            order: 0,
            enabled: true,
            from_cycle: 2,
            to_cycle: 2,
            family: DirectiveFamily::Fragment,
            pacing: DirectivePacing::PerCycle,
            magnitude: DirectiveMagnitude::OperationQuota,
            intensity: 25,
            scope: None,
            options: DirectiveOptions {
                density_floor: Some(20),
                density_ceiling: Some(60),
                ..Default::default()
            },
        }];
        assert_eq!(
            resolve_generator_cycle_with_trace(&GeneratorConfig::Dumka(config.clone()), &context,)
                .unwrap()
                .density_corridor,
            Some(super::super::DensityCorridorRange {
                floor: 20,
                ceiling: 60,
            })
        );

        config.plan.push(EvolutionDirective {
            id: 2,
            order: 1,
            enabled: true,
            from_cycle: 2,
            to_cycle: 2,
            family: DirectiveFamily::Rotate,
            pacing: DirectivePacing::PerCycle,
            magnitude: DirectiveMagnitude::OperationQuota,
            intensity: 25,
            scope: None,
            options: DirectiveOptions::default(),
        });
        assert_eq!(
            resolve_generator_cycle_with_trace(&GeneratorConfig::Dumka(config), &context)
                .unwrap()
                .density_corridor,
            Some(super::super::DensityCorridorRange {
                floor: 55,
                ceiling: 55,
            }),
            "a later inheriting directive restores the sampled global rail"
        );
    }

    #[test]
    fn invalid_patterns_fail_validation_before_generation() {
        let config = GeneratorConfig::Dumka(params("[x"));
        assert!(matches!(
            config.validate(),
            Err(GeneratorError::DumkaPattern { .. })
        ));
    }
}
