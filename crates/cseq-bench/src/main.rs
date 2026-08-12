use std::env;
use std::hint::black_box;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use rayon::prelude::*;

use cseq_model::SubdivisionPolicy;
use cseq_rhythm::{
    perceptual_distance, resolve_channel_hocket, ChannelAssignMode, ChannelHocketSpec,
    ChannelTransition, DirectiveFamily, DirectiveMagnitude, DirectiveOptions, DumkaGeneratorParams,
    EvolutionDirective, EvolutionState, EvolvedOnset, ExampleGeneratorParams, GeneratorConfig,
    GeneratorCycleContext, GeneratorSeedMode, GeneratorSpanInput, MarkovOrder, PerceptualContext,
    PerceptualModel, RhythmSeedMode,
};

struct BenchCase {
    name: &'static str,
    description: &'static str,
    run: fn() -> usize,
}

#[derive(Debug)]
struct BenchArgs {
    filter: Option<String>,
    iterations: usize,
    warmup: usize,
    list: bool,
}

fn main() {
    let args = parse_args();
    let cases = bench_cases();
    if args.list {
        for case in &cases {
            println!("{:<48} {}", case.name, case.description);
        }
        return;
    }
    let selected = cases
        .iter()
        .filter(|case| {
            args.filter
                .as_ref()
                .map_or(true, |filter| case.name.contains(filter))
        })
        .collect::<Vec<_>>();
    if selected.is_empty() {
        eprintln!("no benchmark cases matched");
        std::process::exit(2);
    }
    println!(
        "running {} benchmark(s), warmup={}, iterations={}",
        selected.len(),
        args.warmup,
        args.iterations
    );
    println!();
    for case in selected {
        run_case(case, args.warmup, args.iterations);
    }
}

fn parse_args() -> BenchArgs {
    let mut filter = None;
    let mut iterations = env_usize("CSEQ_BENCH_ITERATIONS").unwrap_or(10);
    let mut warmup = env_usize("CSEQ_BENCH_WARMUP").unwrap_or(2);
    let mut list = false;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--filter" | "-f" => filter = args.next(),
            "--iterations" | "-n" => {
                iterations = args
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(iterations);
            }
            "--warmup" | "-w" => {
                warmup = args
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(warmup);
            }
            "--list" | "-l" => list = true,
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            other if filter.is_none() => filter = Some(other.to_string()),
            other => {
                eprintln!("unrecognized argument: {other}");
                std::process::exit(2);
            }
        }
    }
    BenchArgs {
        filter,
        iterations: iterations.max(1),
        warmup,
        list,
    }
}

fn print_help() {
    println!("Usage: cargo run -p cseq-bench --release -- [options] [filter]");
    println!("  -l, --list              list benchmark cases");
    println!("  -f, --filter TEXT       run cases whose names contain TEXT");
    println!("  -n, --iterations N      measured iterations, default 10");
    println!("  -w, --warmup N          warmup iterations, default 2");
}

fn env_usize(name: &str) -> Option<usize> {
    env::var(name).ok()?.parse().ok()
}

fn run_case(case: &BenchCase, warmup: usize, iterations: usize) {
    for _ in 0..warmup {
        black_box((case.run)());
    }
    let mut durations = Vec::with_capacity(iterations);
    let mut checksum = 0usize;
    for _ in 0..iterations {
        let started = Instant::now();
        checksum = checksum.wrapping_add(black_box((case.run)()));
        durations.push(started.elapsed());
    }
    durations.sort_unstable();
    let mean = mean_duration(&durations);
    println!("{}", case.name);
    println!("  {}", case.description);
    println!(
        "  min {:?}  median {:?}  mean {mean:?}  max {:?}  checksum {checksum}",
        durations[0],
        durations[durations.len() / 2],
        durations[durations.len() - 1]
    );
    println!();
}

fn mean_duration(durations: &[Duration]) -> Duration {
    let nanos = durations.iter().map(Duration::as_nanos).sum::<u128>() / durations.len() as u128;
    Duration::from_nanos(nanos.min(u64::MAX as u128) as u64)
}

fn bench_cases() -> Vec<BenchCase> {
    vec![
        BenchCase {
            name: "generator/example-density-72-32768",
            description: "resolve 32768 Example-generator cells with seeded density decisions",
            run: || resolve_example_generator(4_096, 8),
        },
        BenchCase {
            name: "generator/dumka-fold-corridor-cycle-10000",
            description: "fold Dum-Ka to cycle 10000 through a legal 16-directive plan with a 25-60% density corridor",
            run: || resolve_dumka_generator(10_000),
        },
        BenchCase {
            name: "generator/dumka-perceptual-planner-cycle-1",
            description: "select one legal Dum-Ka operator prefix against the pinned perceptual-distance model",
            run: resolve_dumka_perceptual_generator,
        },
        BenchCase {
            name: "generator/dumka-perceptual-distance-dense-8192",
            description: "compare two dense legal-maximum Dum-Ka cycle states with exact circular phase matching",
            run: perceptual_distance_dense_8192,
        },
        BenchCase {
            name: "channel/resolve-dense-second-order-32768",
            description: "resolve 32768 channel choices across 16 channels with dense transitions",
            run: || resolve_dense_channel(32_768),
        },
        BenchCase {
            name: "channel/resolve-euclid-partition-32768",
            description: "resolve 32768 Euclid channel steps across a 16-layer partition",
            run: || resolve_dense_channel_euclid(32_768),
        },
        BenchCase {
            name: "score/realize-tracks-8-sequential",
            description: "realize 8 independent fixed-grid tracks x 32 cycles sequentially",
            run: || realize_tracks(8, 32, false),
        },
        BenchCase {
            name: "score/realize-tracks-8-parallel",
            description: "realize 8 independent fixed-grid tracks x 32 cycles with rayon",
            run: || realize_tracks(8, 32, true),
        },
        BenchCase {
            name: "transport/fast-forward-parallel-4x64",
            description: "build a 4-track parallel runtime and realize 64 reference cycles",
            run: || fast_forward_parallel(4, 64),
        },
        BenchCase {
            name: "transport/fast-forward-parallel-4x256",
            description: "build a 4-track parallel runtime and realize 256 reference cycles",
            run: || fast_forward_parallel(4, 256),
        },
    ]
}

fn representative_score() -> cseq_model::Score {
    cseq_model::Score::subdivided(
        "bench-fixed-grid",
        &[60, 62, 64, 65, 67, 69, 71, 72],
        96,
        SubdivisionPolicy::Equal,
    )
}

fn generator_playback(channel: u8) -> cseq_transport::RhythmPlaybackConfig {
    cseq_transport::RhythmPlaybackConfig {
        generator_enabled: true,
        generator: GeneratorConfig::Example(ExampleGeneratorParams {
            density_percent: 72,
            seed_mode: GeneratorSeedMode::Locked { seed: 42 },
        }),
        midi_output_channel: channel,
        automation: None,
        channel_hocket_enabled: false,
        channel_hocket: None,
        seed_path: None,
    }
}

fn fast_forward_parallel(track_count: usize, cycle_count: u64) -> usize {
    let tracks = (0..track_count)
        .map(|index| cseq_transport::ParallelPlaybackTrackConfig {
            id: format!("t{index}"),
            name: format!("T{index}"),
            score: representative_score(),
            rhythm: Some(generator_playback((index % 16 + 1) as u8)),
            tempo_bpm: 120.0,
            trigger: None,
            silent: false,
        })
        .collect();
    let config = cseq_transport::ParallelPlaybackConfig {
        tracks,
        reference_tempo_bpm: 120.0,
        reference_cycle_beats: 8,
        channel_conflict_policy: cseq_transport::ChannelConflictPolicy::AllowAll,
        channel_logic_matrix: vec![],
        conflict_priority: vec![],
        track_flow_boxes: vec![],
    };
    cseq_transport::fuzz_fast_forward_parallel_cycles(config, cycle_count)
        .expect("parallel fast-forward realizes")
}

fn realize_tracks(track_count: usize, cycles: u64, parallel: bool) -> usize {
    static BASE: OnceLock<cseq_model::Score> = OnceLock::new();
    let base = BASE.get_or_init(representative_score);
    let scores = (0..track_count).map(|_| base.clone()).collect::<Vec<_>>();
    let realize_one = |score: cseq_model::Score| -> usize {
        (0..cycles)
            .map(|cycle| {
                cseq_realize::realize(black_box(&score), cycle, 0)
                    .expect("score realizes")
                    .events
                    .len()
            })
            .sum()
    };
    if parallel {
        scores.into_par_iter().map(realize_one).sum()
    } else {
        scores.into_iter().map(realize_one).sum()
    }
}

fn resolve_dumka_generator(cycle: u64) -> usize {
    static SPANS: OnceLock<Vec<GeneratorSpanInput>> = OnceLock::new();
    let spans = SPANS.get_or_init(|| {
        (0..4)
            .map(|index| GeneratorSpanInput {
                span_id: index as u64 + 1,
                span_len: 4,
                label: None,
                section_index: Some(1),
                subdivision: Some(4),
            })
            .collect()
    });
    let config = GeneratorConfig::Dumka(DumkaGeneratorParams {
        evolution_rate: 0,
        drift_leash: 100,
        density_floor: 25,
        density_ceiling: 60,
        plan: planned_bench_directives(),
        seed_mode: GeneratorSeedMode::Locked { seed: 42 },
        ..Default::default()
    });
    cseq_rhythm::resolve_generator_cycle(
        black_box(&config),
        &GeneratorCycleContext {
            track_id: None,
            cycle: black_box(cycle),
            cycle_beats: 4,
            spans: black_box(spans),
            seed: 42,
            automation: &|_, _, _| None,
        },
    )
    .expect("Dum-Ka generator resolves")
    .iter()
    .map(|span| span.cells.len())
    .sum()
}

fn resolve_dumka_perceptual_generator() -> usize {
    static SPANS: OnceLock<Vec<GeneratorSpanInput>> = OnceLock::new();
    let spans = SPANS.get_or_init(|| {
        (0..4)
            .map(|index| GeneratorSpanInput {
                span_id: index as u64 + 1,
                span_len: 16,
                label: None,
                section_index: Some(1),
                subdivision: Some(16),
            })
            .collect()
    });
    let config = GeneratorConfig::Dumka(DumkaGeneratorParams {
        pattern: "[x . x . x . x . x . x . x . x .] *4".to_string(),
        evolution_rate: 0,
        drift_leash: 100,
        plan: vec![EvolutionDirective {
            id: 1,
            order: 0,
            enabled: true,
            from_cycle: 1,
            to_cycle: 1,
            family: DirectiveFamily::BarlowAdd,
            pacing: cseq_rhythm::DirectivePacing::PerCycle,
            magnitude: DirectiveMagnitude::Perceptual {
                model_version: cseq_rhythm::PerceptualModelVersion::V1,
                target_milli: 12_000,
                tolerance_milli: 250,
                max_operations: 32,
            },
            intensity: 25,
            scope: None,
            options: DirectiveOptions::default(),
        }],
        seed_mode: GeneratorSeedMode::Locked { seed: 42 },
        ..Default::default()
    });
    cseq_rhythm::resolve_generator_cycle_with_trace(
        black_box(&config),
        &GeneratorCycleContext {
            track_id: None,
            cycle: 1,
            cycle_beats: 4,
            spans: black_box(spans),
            seed: 42,
            automation: &|_, _, _| None,
        },
    )
    .expect("perceptually paced Dum-Ka generator resolves")
    .spans
    .iter()
    .map(|span| span.cells.len())
    .sum()
}

fn perceptual_distance_dense_8192() -> usize {
    static CASE: OnceLock<(EvolutionState, EvolutionState, PerceptualContext)> = OnceLock::new();
    let (left, right, context) = CASE.get_or_init(|| {
        let left = EvolutionState {
            onsets: (0..8_192)
                .filter(|slot| (slot % 2 == 0) ^ (slot % 127 == 0))
                .map(|slot| EvolvedOnset {
                    slot,
                    dur: 1,
                    class: "x".to_string(),
                })
                .collect(),
            rotation_beats: 0,
        };
        let right = EvolutionState {
            onsets: left
                .onsets
                .iter()
                .map(|onset| EvolvedOnset {
                    slot: (onset.slot + 173) % 8_192,
                    ..onset.clone()
                })
                .collect(),
            rotation_beats: 0,
        };
        let strata = cseq_rhythm::generators::dumka::barlow::stratification(128, 64)
            .expect("benchmark grid is Barlow-supported");
        let context = PerceptualContext::new(
            128,
            64,
            cseq_rhythm::generators::dumka::barlow::indispensability(&strata),
            cseq_rhythm::generators::dumka::sioros::metrical_levels(&strata),
        )
        .expect("benchmark context is valid");
        (left, right, context)
    });
    perceptual_distance(
        black_box(left),
        black_box(right),
        black_box(context),
        &PerceptualModel::v1(),
    )
    .total_milli as usize
}

fn planned_bench_directives() -> Vec<EvolutionDirective> {
    (0..16_u32)
        .map(|index| {
            let from_cycle = 1 + u64::from(index) * 625;
            let family = match index % 9 {
                0 => DirectiveFamily::BarlowRemove,
                1 => DirectiveFamily::BarlowAdd,
                2 => DirectiveFamily::Rotate,
                3 => DirectiveFamily::Syncopate,
                4 => DirectiveFamily::Desyncopate,
                5 => DirectiveFamily::Fragment,
                6 => DirectiveFamily::Consolidate,
                7 => DirectiveFamily::Euclid,
                _ => DirectiveFamily::Stochastic,
            };
            EvolutionDirective {
                id: u64::from(index) + 1,
                order: index,
                enabled: true,
                from_cycle,
                to_cycle: from_cycle + 624,
                family,
                pacing: if family == DirectiveFamily::Stochastic {
                    cseq_rhythm::DirectivePacing::PerCycle
                } else if index % 2 == 0 {
                    cseq_rhythm::DirectivePacing::Linear
                } else {
                    cseq_rhythm::DirectivePacing::EaseInOut
                },
                magnitude: DirectiveMagnitude::OperationQuota,
                intensity: 32,
                scope: None,
                options: DirectiveOptions::default(),
            }
        })
        .collect()
}

fn resolve_example_generator(span_count: usize, span_len: u32) -> usize {
    static SPANS: OnceLock<Vec<GeneratorSpanInput>> = OnceLock::new();
    let spans = SPANS.get_or_init(|| {
        (0..span_count)
            .map(|index| GeneratorSpanInput {
                span_id: index as u64,
                span_len,
                label: None,
                section_index: Some((index % 8) as u32),
                subdivision: None,
            })
            .collect()
    });
    let config = GeneratorConfig::Example(ExampleGeneratorParams {
        density_percent: 72,
        seed_mode: GeneratorSeedMode::Locked { seed: 42 },
    });
    cseq_rhythm::resolve_generator_cycle(
        black_box(&config),
        &GeneratorCycleContext {
            track_id: None,
            cycle: 0,
            cycle_beats: 8,
            spans: black_box(spans),
            seed: 42,
            automation: &|_, _, _| None,
        },
    )
    .expect("Example generator resolves")
    .iter()
    .map(|span| span.cells.len())
    .sum()
}

fn context_len(order: MarkovOrder) -> usize {
    match order {
        MarkovOrder::First => 1,
        MarkovOrder::Second => 2,
    }
}

fn channel_spec(channels: &[u8], order: MarkovOrder) -> ChannelHocketSpec {
    let contexts = channel_contexts(channels, context_len(order));
    ChannelHocketSpec {
        order,
        channels: channels.to_vec(),
        transitions: contexts
            .iter()
            .flat_map(|context| {
                channels.iter().copied().map(move |to| ChannelTransition {
                    from: context.clone(),
                    to,
                    weight: 1,
                })
            })
            .collect(),
        fallback: channels[0],
        fallback_weights: vec![],
        entry_weights: vec![],
        seed_mode: RhythmSeedMode::Locked { seed: 1 },
        global_seed: 1,
        accent_rules: vec![],
        position_rules: vec![],
        assign_mode: ChannelAssignMode::Markov,
        euclid: None,
    }
}

fn channel_contexts(channels: &[u8], len: usize) -> Vec<Vec<u8>> {
    let mut contexts = vec![Vec::new()];
    for _ in 0..len {
        contexts = contexts
            .iter()
            .flat_map(|context| {
                channels.iter().map(move |channel| {
                    let mut item = context.clone();
                    item.push(*channel);
                    item
                })
            })
            .collect();
    }
    contexts
}

fn resolve_dense_channel(count: usize) -> usize {
    static SPEC: OnceLock<ChannelHocketSpec> = OnceLock::new();
    let spec =
        SPEC.get_or_init(|| channel_spec(&(1..=16).collect::<Vec<_>>(), MarkovOrder::Second));
    resolve_channel_hocket(black_box(spec), count, 42)
        .expect("dense channel resolves")
        .len()
}

fn resolve_dense_channel_euclid(count: usize) -> usize {
    static SPEC: OnceLock<ChannelHocketSpec> = OnceLock::new();
    let spec = SPEC.get_or_init(|| {
        let channels = (1..=16).collect::<Vec<_>>();
        let mut spec = channel_spec(&channels, MarkovOrder::First);
        spec.assign_mode = ChannelAssignMode::Euclid;
        spec.euclid = Some(cseq_rhythm::EuclidChannelSpec {
            placement: cseq_rhythm::EuclidPlacement::Partition,
            steps: 64,
            layers: channels
                .iter()
                .map(|channel| cseq_rhythm::EuclidChannelLayer {
                    channel: *channel,
                    pulses: 4,
                    rotation: u32::from(*channel),
                    max_run: if channel % 4 == 0 { 2 } else { 1 },
                    steps: 16,
                    invert: false,
                })
                .collect(),
            reset: cseq_rhythm::EuclidResetScope::Cycle,
            span_accent_mode: cseq_rhythm::EuclidSpanAccentMode::Woven,
            span_accent_channel: None,
        });
        spec
    });
    let mut assigner = cseq_rhythm::EuclidAssigner::new();
    assigner.enter_region(0);
    (0..count)
        .map(|_| {
            assigner
                .next_choice_with_spec(black_box(spec))
                .expect("dense Euclid channel resolves")
                .channel as usize
        })
        .sum()
}
