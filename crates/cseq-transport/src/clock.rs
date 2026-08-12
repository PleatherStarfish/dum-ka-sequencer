#[allow(unused_imports)]
use crate::*;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const PPQN: u32 = 960;

pub(crate) const MAX_TRANSPORT_TICKS_PER_CYCLE: u64 = PPQN as u64 * 1024;
pub(crate) const GM_PERCUSSION_CHANNEL_INDEX: u8 = 9;
pub(crate) const DEFAULT_SYNTH_PROGRAMS: [u8; 16] = [
    0, 12, 104, 77, 62, 89, 116, 115, 4, 0, 45, 48, 52, 73, 80, 88,
];
pub(crate) const DEFAULT_SYNTH_DRUM_NOTES: [u8; 16] = [
    36, 38, 42, 46, 45, 50, 64, 60, 75, 77, 54, 53, 35, 37, 39, 81,
];

#[derive(Debug, Clone)]
pub(crate) struct AutomationPlaybackTarget {
    target: String,
    base: f64,
    min: f64,
    max: f64,
    value_kind: AutomationValueKind,
}

pub(crate) struct AutomationPlaybackSource<'a> {
    automation: &'a AutomationSet,
    cycle_beats: u32,
    targets: Vec<AutomationPlaybackTarget>,
}

pub(crate) fn current_automation_log_key(
    score: &Score,
    rhythm: Option<&RhythmPlaybackConfig>,
    cycle: u64,
    tick_in_cycle: u64,
    ticks_per_cycle: u64,
) -> Option<(u64, u32)> {
    let has_score_automation = score_automation_playback_source(score).is_some();
    let has_rhythm_automation = rhythm
        .and_then(|config| config.automation.as_ref())
        .is_some_and(|automation| !automation.tracks.is_empty());
    if !has_score_automation && !has_rhythm_automation {
        return None;
    }
    let cycle_beats = score_cycle_beats(score)?;
    let beat_index = automation_beat_index_for_tick(tick_in_cycle, ticks_per_cycle, cycle_beats);
    Some((cycle, beat_index))
}

pub(crate) fn record_current_automation_state(
    shared: &Arc<Mutex<TransportShared>>,
    score: &Score,
    rhythm: Option<&RhythmPlaybackConfig>,
    cycle: u64,
    beat_index: u32,
    tick_in_cycle: u64,
) -> bool {
    let score_source = score_automation_playback_source(score);
    let rhythm_automation = rhythm.and_then(|config| config.automation.as_ref());
    let cycle_beats = score_source
        .as_ref()
        .map(|source| source.cycle_beats)
        .or_else(|| score_cycle_beats(score))
        .unwrap_or(1)
        .max(1);
    let automation_phase = AutomationTime::from_beat(
        cycle,
        beat_index,
        cycle_beats,
        score_source
            .as_ref()
            .map(|source| source.automation.length_cycles)
            .or_else(|| rhythm_automation.map(|automation| automation.length_cycles))
            .unwrap_or(1)
            .max(1),
    );
    let mut values = Vec::new();
    if let Some(source) = score_source {
        values.extend(source.targets.iter().filter_map(|target| {
            source
                .automation
                .sample_typed_number(
                    &target.target,
                    cycle,
                    beat_index,
                    source.cycle_beats,
                    target.base,
                    target.value_kind,
                    target.min,
                    target.max,
                )
                .map(|value| AutomationPlaybackValue {
                    target: target.target.clone(),
                    value,
                })
        }));
    }
    if let Some(automation) = rhythm_automation {
        values.extend(
            automation
                .tracks
                .iter()
                .filter(|track| track.enabled)
                .filter_map(|track| {
                    automation
                        .sample_typed_number(
                            &track.target,
                            cycle,
                            beat_index,
                            cycle_beats,
                            0.0,
                            AutomationValueKind::Float,
                            f64::NEG_INFINITY,
                            f64::INFINITY,
                        )
                        .map(|value| AutomationPlaybackValue {
                            target: track.target.clone(),
                            value,
                        })
                }),
        );
    }
    if values.is_empty() {
        return false;
    }

    let mut state = shared.lock();
    let event = AutomationPlaybackEvent {
        sequence: state.layers.automation.take_sequence(),
        cycle,
        beat_index,
        tick_in_cycle,
        automation_phase,
        values,
    };
    state.layers.automation.push(event);

    true
}

pub(crate) fn score_automation_playback_source(
    score: &Score,
) -> Option<AutomationPlaybackSource<'_>> {
    let cycle_beats = score_cycle_beats(score)?;
    score
        .pipeline
        .iter()
        .filter(|transform| transform.enabled)
        .find_map(|transform| match &transform.kind {
            TransformKind::SubdivisionSwitch {
                initial_weights,
                initial_jathi_weights,
                automation,
                inflections,
                switch_count_weights,
                pitch,
                velocity,
                accent,
                ..
            } => {
                let automation = automation.as_deref()?;
                if automation.tracks.is_empty() {
                    return None;
                }
                Some(AutomationPlaybackSource {
                    automation,
                    cycle_beats,
                    targets: automation_playback_targets(
                        initial_weights,
                        initial_jathi_weights,
                        inflections,
                        switch_count_weights,
                        pitch,
                        velocity,
                        accent,
                        cycle_beats,
                    ),
                })
            }
            _ => None,
        })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn automation_playback_targets(
    initial_weights: &[cseq_model::WeightedSubdivisionChoice],
    initial_jathi_weights: &[cseq_model::WeightedJathiChoice],
    inflections: &[SubdivisionInflection],
    switch_count_weights: &[cseq_model::WeightedSwitchCount],
    pitch: &ValueSpec<u8>,
    velocity: &ValueSpec<u8>,
    accent: &cseq_model::GatiAccentSpec,
    cycle_beats: u32,
) -> Vec<AutomationPlaybackTarget> {
    let mut targets = vec![
        automation_integer_target(AUTOMATION_TARGET_PITCH, fixed_u8(pitch, 60), 0, 127),
        automation_integer_target(AUTOMATION_TARGET_VELOCITY, fixed_u8(velocity, 96), 1, 127),
        automation_integer_target(
            AUTOMATION_TARGET_BEAT_ACCENT_MIN,
            accent.beat_start.min,
            0,
            127,
        ),
        automation_integer_target(
            AUTOMATION_TARGET_BEAT_ACCENT_MAX,
            accent.beat_start.max,
            0,
            127,
        ),
        automation_integer_target(
            AUTOMATION_TARGET_SECTION_ACCENT_MIN,
            accent.section_start_extra.min,
            0,
            127,
        ),
        automation_integer_target(
            AUTOMATION_TARGET_SECTION_ACCENT_MAX,
            accent.section_start_extra.max,
            0,
            127,
        ),
        automation_integer_target(
            AUTOMATION_TARGET_JATHI_ACCENT_MIN,
            accent.jathi_start.min,
            0,
            127,
        ),
        automation_integer_target(
            AUTOMATION_TARGET_JATHI_ACCENT_MAX,
            accent.jathi_start.max,
            0,
            127,
        ),
    ];

    targets.extend(
        initial_weights
            .iter()
            .map(|choice| AutomationPlaybackTarget {
                target: automation_target_initial_gati_weight(choice.subdivision),
                base: f64::from(choice.weight),
                min: 0.0,
                max: f64::from(f32::MAX),
                value_kind: AutomationValueKind::Weight,
            }),
    );
    targets.extend(
        initial_jathi_weights
            .iter()
            .map(|choice| AutomationPlaybackTarget {
                target: automation_target_initial_jathi_weight(choice.jathi),
                base: f64::from(choice.weight),
                min: 0.0,
                max: f64::from(f32::MAX),
                value_kind: AutomationValueKind::Weight,
            }),
    );
    targets.extend(
        switch_count_weights
            .iter()
            .map(|choice| AutomationPlaybackTarget {
                target: automation_target_section_count_weight(choice.count),
                base: f64::from(choice.weight),
                min: 0.0,
                max: f64::from(f32::MAX),
                value_kind: AutomationValueKind::Weight,
            }),
    );

    for inflection in inflections {
        let after_beat = inflection_after_beat_for_automation(inflection, cycle_beats);
        let id = inflection
            .id
            .clone()
            .unwrap_or_else(|| format!("after-beat-{after_beat}"));
        targets.push(AutomationPlaybackTarget {
            target: automation_target_boundary_probability(&id),
            base: f64::from(inflection.change_probability),
            min: 0.0,
            max: 1.0,
            value_kind: AutomationValueKind::Float,
        });
        targets.extend(inflection.subdivision_weights.iter().map(|choice| {
            AutomationPlaybackTarget {
                target: automation_target_boundary_gati_weight(&id, choice.subdivision),
                base: f64::from(choice.weight),
                min: 0.0,
                max: f64::from(f32::MAX),
                value_kind: AutomationValueKind::Weight,
            }
        }));
        targets.extend(
            inflection
                .jathi_weights
                .iter()
                .map(|choice| AutomationPlaybackTarget {
                    target: automation_target_boundary_jathi_weight(&id, choice.jathi),
                    base: f64::from(choice.weight),
                    min: 0.0,
                    max: f64::from(f32::MAX),
                    value_kind: AutomationValueKind::Weight,
                }),
        );
    }

    targets
}

pub(crate) fn automation_integer_target(
    target: &str,
    base: u8,
    min: u8,
    max: u8,
) -> AutomationPlaybackTarget {
    AutomationPlaybackTarget {
        target: target.to_string(),
        base: f64::from(base),
        min: f64::from(min),
        max: f64::from(max),
        value_kind: AutomationValueKind::Integer,
    }
}

pub(crate) fn fixed_u8(value: &ValueSpec<u8>, fallback: u8) -> u8 {
    value.as_fixed().copied().unwrap_or(fallback)
}

pub(crate) fn score_cycle_beats(score: &Score) -> Option<u32> {
    if *score.cycle_length.denom() != 1 || *score.cycle_length.numer() <= 0 {
        return None;
    }
    u32::try_from(*score.cycle_length.numer()).ok()
}

pub(crate) fn automation_beat_index_for_tick(
    tick_in_cycle: u64,
    ticks_per_cycle: u64,
    cycle_beats: u32,
) -> u32 {
    if ticks_per_cycle == 0 || cycle_beats == 0 {
        return 0;
    }
    let beat = tick_in_cycle
        .saturating_mul(u64::from(cycle_beats))
        .checked_div(ticks_per_cycle)
        .unwrap_or(0);
    beat.min(u64::from(cycle_beats.saturating_sub(1))) as u32
}

pub(crate) fn inflection_after_beat_for_automation(
    inflection: &SubdivisionInflection,
    cycle_beats: u32,
) -> u32 {
    let scaled = inflection.position * Rational::from_integer(cycle_beats as i64);
    if *scaled.denom() == 1 {
        (*scaled.numer()).clamp(0, cycle_beats.saturating_sub(1) as i64) as u32
    } else {
        0
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct AutomationSampleScope {
    pub(crate) cycle: u64,
    pub(crate) beat_index: u32,
    pub(crate) cycle_beats: u32,
    pub(crate) phase: Option<AutomationTime>,
}

impl AutomationSampleScope {
    pub(crate) fn cycle_start(score: &Score, cycle: u64) -> Self {
        Self {
            cycle,
            beat_index: 0,
            cycle_beats: score_cycle_beats(score).unwrap_or(1).max(1),
            phase: None,
        }
    }
}

pub(crate) fn transport_tempo_bpm_for_tick(
    score: &Score,
    rhythm: Option<&RhythmPlaybackConfig>,
    cycle: u64,
    tick_in_cycle: u64,
    ticks_per_cycle: u64,
    base_tempo_bpm: f32,
) -> f32 {
    let cycle_beats = score_cycle_beats(score).unwrap_or(1).max(1);
    let beat_index = automation_beat_index_for_tick(tick_in_cycle, ticks_per_cycle, cycle_beats);
    sample_transport_tempo_bpm(
        score,
        rhythm,
        cycle,
        beat_index,
        cycle_beats,
        base_tempo_bpm,
    )
}

pub(crate) fn transport_tempo_bpm_for_cycle_start(
    score: &Score,
    rhythm: Option<&RhythmPlaybackConfig>,
    cycle: u64,
    base_tempo_bpm: f32,
) -> f32 {
    let cycle_beats = score_cycle_beats(score).unwrap_or(1).max(1);
    sample_transport_tempo_bpm(score, rhythm, cycle, 0, cycle_beats, base_tempo_bpm)
}

pub(crate) fn sample_transport_tempo_bpm(
    score: &Score,
    rhythm: Option<&RhythmPlaybackConfig>,
    cycle: u64,
    beat_index: u32,
    cycle_beats: u32,
    base_tempo_bpm: f32,
) -> f32 {
    let mut tempo_bpm = base_tempo_bpm.clamp(20.0, 400.0);
    if let Some(source) = score_automation_playback_source(score) {
        let scope = AutomationSampleScope {
            cycle,
            beat_index,
            cycle_beats: source.cycle_beats,
            phase: None,
        };
        if let Some(value) = sample_automation_f32(
            source.automation,
            scope,
            AUTOMATION_TARGET_TEMPO_BPM,
            tempo_bpm,
            20.0,
            400.0,
        ) {
            tempo_bpm = value;
        }
    }
    if let Some(automation) = rhythm.and_then(|config| config.automation.as_ref()) {
        let scope = AutomationSampleScope {
            cycle,
            beat_index,
            cycle_beats,
            phase: None,
        };
        if let Some(value) = sample_automation_f32(
            automation,
            scope,
            AUTOMATION_TARGET_TEMPO_BPM,
            tempo_bpm,
            20.0,
            400.0,
        ) {
            tempo_bpm = value;
        }
    }
    tempo_bpm.clamp(20.0, 400.0)
}

pub(crate) fn automation_time_for_cycle_fraction(
    cycle: u64,
    sample_index: usize,
    sample_count: usize,
    length_cycles: u32,
) -> AutomationTime {
    let sample_count = sample_count.max(1) as u64;
    let length_cycles = u64::from(length_cycles.max(1));
    let cycle_in_range = cycle % length_cycles;
    AutomationTime::new(
        cycle_in_range
            .saturating_mul(sample_count)
            .saturating_add(sample_index as u64),
        length_cycles.saturating_mul(sample_count),
    )
    .unwrap_or_else(AutomationTime::zero)
}

pub(crate) fn sample_automation_number_at_phase(
    automation: &AutomationSet,
    target: &str,
    phase: AutomationTime,
    base: f64,
    value_kind: AutomationValueKind,
    min: f64,
    max: f64,
) -> Option<f64> {
    if min.is_nan() || max.is_nan() || min > max || !base.is_finite() {
        return None;
    }
    let mut replace_samples = Vec::new();
    let mut add_sum = 0.0;
    let mut multiply_product = 1.0;
    let mut changed = false;

    for track in automation
        .tracks
        .iter()
        .filter(|track| track.enabled && track.target == target)
    {
        let samples = track
            .curves
            .iter()
            .filter(|curve| curve.enabled)
            .filter_map(|curve| curve.sample_number_with_markers(phase, &automation.markers))
            .collect::<Vec<_>>();
        if samples.is_empty() {
            continue;
        }

        match track.combine {
            cseq_model::AutomationCombineMode::Replace => {
                replace_samples.extend(samples);
            }
            cseq_model::AutomationCombineMode::Add => {
                add_sum += samples.iter().sum::<f64>();
            }
            cseq_model::AutomationCombineMode::Multiply => {
                multiply_product *= samples.iter().product::<f64>();
            }
        }
        changed = true;
    }

    let mut value = if replace_samples.is_empty() {
        base
    } else {
        replace_samples.iter().sum::<f64>() / replace_samples.len() as f64
    };
    value += add_sum;
    value *= multiply_product;
    if !value.is_finite() {
        return None;
    }

    changed.then_some(value_kind.coerce(value, min, max))
}

pub(crate) fn sample_transport_tempo_bpm_at_cycle_fraction(
    score: &Score,
    rhythm: Option<&RhythmPlaybackConfig>,
    cycle: u64,
    sample_index: usize,
    sample_count: usize,
    base_tempo_bpm: f32,
) -> f32 {
    let mut tempo_bpm = base_tempo_bpm.clamp(20.0, 400.0);
    if let Some(source) = score_automation_playback_source(score) {
        let phase = automation_time_for_cycle_fraction(
            cycle,
            sample_index,
            sample_count,
            source.automation.length_cycles,
        );
        if let Some(value) = sample_automation_number_at_phase(
            source.automation,
            AUTOMATION_TARGET_TEMPO_BPM,
            phase,
            tempo_bpm as f64,
            AutomationValueKind::Float,
            20.0,
            400.0,
        ) {
            tempo_bpm = value as f32;
        }
    }
    if let Some(automation) = rhythm.and_then(|config| config.automation.as_ref()) {
        let phase = automation_time_for_cycle_fraction(
            cycle,
            sample_index,
            sample_count,
            automation.length_cycles,
        );
        if let Some(value) = sample_automation_number_at_phase(
            automation,
            AUTOMATION_TARGET_TEMPO_BPM,
            phase,
            tempo_bpm as f64,
            AutomationValueKind::Float,
            20.0,
            400.0,
        ) {
            tempo_bpm = value as f32;
        }
    }
    tempo_bpm.clamp(20.0, 400.0)
}

pub(crate) fn sample_automation_number(
    automation: &AutomationSet,
    scope: AutomationSampleScope,
    target: &str,
    base: f64,
    value_kind: AutomationValueKind,
    min: f64,
    max: f64,
) -> Option<f64> {
    let sampled = if let Some(phase) = scope.phase {
        automation.sample_typed_number_at_phase(target, phase, base, value_kind, min, max)
    } else {
        automation.sample_typed_number(
            target,
            scope.cycle,
            scope.beat_index,
            scope.cycle_beats,
            base,
            value_kind,
            min,
            max,
        )
    };
    if sampled.is_none() && automation_target_has_enabled_source(automation, target) {
        warn!(
            target,
            cycle = scope.cycle,
            beat = scope.beat_index,
            "automation target produced no finite numeric sample; keeping base value"
        );
    }
    sampled
}

/// Whether any enabled automation track with an enabled, non-empty curve
/// addresses `target`. Both generator-sampler callers (transport playback and
/// the Tauri stopped preview) must use this one predicate: the generator seam
/// treats "no enabled source" (`None`) differently from "automated value"
/// (`Some`), so a drifted duplicate would split preview from playback.
pub fn automation_target_has_enabled_source(automation: &AutomationSet, target: &str) -> bool {
    automation.tracks.iter().any(|track| {
        track.enabled
            && track.target == target
            && track
                .curves
                .iter()
                .any(|curve| curve.enabled && !curve.points.is_empty())
    })
}

pub(crate) fn sample_automation_bool(
    automation: &AutomationSet,
    scope: AutomationSampleScope,
    target: &str,
    base: bool,
) -> Option<bool> {
    if let Some(phase) = scope.phase {
        automation
            .sample_typed_number_at_phase(
                target,
                phase,
                if base { 1.0 } else { 0.0 },
                AutomationValueKind::Boolean,
                0.0,
                1.0,
            )
            .map(|value| value >= 1.0)
    } else {
        automation.sample_bool(
            target,
            scope.cycle,
            scope.beat_index,
            scope.cycle_beats,
            base,
        )
    }
}

pub(crate) fn sample_automation_f32(
    automation: &AutomationSet,
    scope: AutomationSampleScope,
    target: &str,
    base: f32,
    min: f32,
    max: f32,
) -> Option<f32> {
    sample_automation_number(
        automation,
        scope,
        target,
        f64::from(base),
        AutomationValueKind::Float,
        f64::from(min),
        f64::from(max),
    )
    .map(|value| value as f32)
}

pub(crate) fn sample_automation_unit_percent(
    automation: &AutomationSet,
    scope: AutomationSampleScope,
    target: &str,
    base: f32,
) -> Option<f32> {
    sample_automation_number(
        automation,
        scope,
        target,
        f64::from(base) * 100.0,
        AutomationValueKind::Float,
        0.0,
        100.0,
    )
    .map(|value| (value / 100.0) as f32)
}

pub(crate) fn sample_automation_u8(
    automation: &AutomationSet,
    scope: AutomationSampleScope,
    target: &str,
    base: u8,
    min: u8,
    max: u8,
) -> Option<u8> {
    sample_automation_number(
        automation,
        scope,
        target,
        f64::from(base),
        AutomationValueKind::Integer,
        f64::from(min),
        f64::from(max),
    )
    .map(|value| value.round() as u8)
}

pub(crate) fn sample_automation_u32(
    automation: &AutomationSet,
    scope: AutomationSampleScope,
    target: &str,
    base: u32,
    min: u32,
    max: u32,
) -> Option<u32> {
    sample_automation_number(
        automation,
        scope,
        target,
        f64::from(base),
        AutomationValueKind::Integer,
        f64::from(min),
        f64::from(max),
    )
    .map(|value| value.round() as u32)
}

pub(crate) fn sample_automation_weight(
    automation: &AutomationSet,
    scope: AutomationSampleScope,
    target: &str,
    base: u32,
) -> Option<u32> {
    sample_automation_number(
        automation,
        scope,
        target,
        f64::from(base),
        AutomationValueKind::Weight,
        0.0,
        999.0,
    )
    .map(|value| value.round() as u32)
}

pub(crate) fn sanitize_target_id_part(value: &str) -> String {
    let mut output = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch);
            last_dash = false;
        } else if !last_dash {
            output.push('-');
            last_dash = true;
        }
    }
    let trimmed = output.trim_matches('-');
    if trimmed.is_empty() {
        "target".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn markov_order_target_part(order: MarkovOrder) -> &'static str {
    match order {
        MarkovOrder::First => "first",
        MarkovOrder::Second => "second",
    }
}

pub(crate) fn channel_contexts(channels: &[u8], order: MarkovOrder) -> Vec<Vec<u8>> {
    let mut contexts = Vec::new();
    match order {
        MarkovOrder::First => {
            for channel in channels {
                contexts.push(vec![*channel]);
            }
        }
        MarkovOrder::Second => {
            for first in channels {
                for second in channels {
                    contexts.push(vec![*first, *second]);
                }
            }
        }
    }
    contexts
}

// ---------------------------------------------------------------------------
// Tick/time conversion helpers
// ---------------------------------------------------------------------------

/// Compute ticks per cycle for a score: cycle_length * PPQN.
pub(crate) fn ticks_per_cycle(score: &Score) -> u64 {
    musical_offset_to_ticks(&score.cycle_length)
}

pub(crate) fn absolute_tick(cycle: u64, ticks_per_cycle: u64, tick_in_cycle: u64) -> u64 {
    cycle
        .saturating_mul(ticks_per_cycle)
        .saturating_add(tick_in_cycle)
}

/// Convert a Rational offset (in aksharas from cycle start) to ticks.
pub(crate) fn offset_to_ticks(offset: &Rational) -> u64 {
    musical_offset_to_ticks(offset)
}

pub(crate) fn musical_offset_to_ticks(offset: &Rational) -> u64 {
    let r = *offset * Rational::from(PPQN as i64);
    let numer = i128::from(*r.numer());
    let denom = i128::from(*r.denom());
    if denom <= 0 || numer <= 0 {
        return 0;
    }
    let quotient = numer / denom;
    let remainder = numer % denom;
    let rounded = if remainder.saturating_mul(2) >= denom {
        quotient.saturating_add(1)
    } else {
        quotient
    };
    u64::try_from(rounded).unwrap_or(u64::MAX)
}

/// Compute the nanoseconds-per-tick for a given tempo.
pub(crate) fn nanos_per_tick(bpm: f32) -> f64 {
    // one beat = 60/bpm seconds = 60/bpm * 1e9 nanos
    // one tick = one beat / PPQN
    (60.0 / bpm as f64) * 1e9 / PPQN as f64
}

pub(crate) const LOCAL_TEMPO_AUTOMATION_SAMPLES: usize = 1024;

#[derive(Debug, Clone)]
pub(crate) struct LocalTempoAutomationMap {
    cumulative_reference_ticks: Vec<f64>,
    local_ticks_per_cycle: u64,
}

impl LocalTempoAutomationMap {
    pub(crate) fn from_cycle(
        score: &Score,
        rhythm: Option<&RhythmPlaybackConfig>,
        cycle: u64,
        local_ticks_per_cycle: u64,
        reference_tempo_bpm: f32,
        base_tempo_bpm: f32,
    ) -> Self {
        Self::from_tempo_sampler(
            local_ticks_per_cycle,
            reference_tempo_bpm,
            |sample_index, sample_count| {
                sample_transport_tempo_bpm_at_cycle_fraction(
                    score,
                    rhythm,
                    cycle,
                    sample_index,
                    sample_count,
                    base_tempo_bpm,
                )
            },
        )
    }

    fn from_tempo_sampler(
        local_ticks_per_cycle: u64,
        reference_tempo_bpm: f32,
        mut local_tempo_at: impl FnMut(usize, usize) -> f32,
    ) -> Self {
        let local_ticks_per_cycle = local_ticks_per_cycle.max(1);
        let reference_tempo_bpm = reference_tempo_bpm.clamp(20.0, 400.0) as f64;
        let mut scales = Vec::with_capacity(LOCAL_TEMPO_AUTOMATION_SAMPLES + 1);
        for index in 0..=LOCAL_TEMPO_AUTOMATION_SAMPLES {
            let local_tempo_bpm =
                local_tempo_at(index, LOCAL_TEMPO_AUTOMATION_SAMPLES).clamp(20.0, 400.0) as f64;
            scales.push(reference_tempo_bpm / local_tempo_bpm);
        }

        let mut cumulative_reference_ticks = Vec::with_capacity(LOCAL_TEMPO_AUTOMATION_SAMPLES + 1);
        cumulative_reference_ticks.push(0.0);
        let local_step = local_ticks_per_cycle as f64 / LOCAL_TEMPO_AUTOMATION_SAMPLES as f64;
        let mut cumulative = 0.0;
        for index in 1..=LOCAL_TEMPO_AUTOMATION_SAMPLES {
            cumulative += (scales[index - 1] + scales[index]) * 0.5 * local_step;
            cumulative_reference_ticks.push(cumulative);
        }

        Self {
            cumulative_reference_ticks,
            local_ticks_per_cycle,
        }
    }

    pub(crate) fn reference_duration_ticks(&self) -> u64 {
        self.cumulative_reference_ticks
            .last()
            .copied()
            .unwrap_or(self.local_ticks_per_cycle as f64)
            .round()
            .max(1.0) as u64
    }

    /// Fractional reference-tick position of a local tick (the un-rounded
    /// value behind `map_local_tick`).
    fn reference_ticks_at(&self, local_tick: u64) -> f64 {
        if local_tick == 0 {
            return 0.0;
        }
        if local_tick >= self.local_ticks_per_cycle {
            return self
                .cumulative_reference_ticks
                .last()
                .copied()
                .unwrap_or(self.local_ticks_per_cycle as f64);
        }
        let position = local_tick as f64 / self.local_ticks_per_cycle as f64
            * LOCAL_TEMPO_AUTOMATION_SAMPLES as f64;
        let left = position.floor() as usize;
        let right = (left + 1).min(LOCAL_TEMPO_AUTOMATION_SAMPLES);
        let blend = position - left as f64;
        let y_left = self.cumulative_reference_ticks[left];
        let y_right = self.cumulative_reference_ticks[right];
        y_left + (y_right - y_left) * blend
    }

    pub(crate) fn map_local_tick(&self, local_tick: u64) -> u64 {
        if local_tick == 0 {
            return 0;
        }
        if local_tick >= self.local_ticks_per_cycle {
            return self.reference_duration_ticks();
        }
        self.reference_ticks_at(local_tick).round().max(0.0) as u64
    }

    pub(crate) fn reference_tick_to_local_tick(&self, reference_tick: u64) -> u64 {
        self.reference_tick_to_local_position(reference_tick)
            .round()
            .clamp(0.0, self.local_ticks_per_cycle as f64) as u64
    }

    /// Fractional inverse for finalized metadata. Strict boundary repair and
    /// cross-track note-off deferral happen on the reference clock; keeping the
    /// fractional inverse avoids inventing a nearby integer local boundary.
    /// Values beyond the timing window extrapolate past the local cycle instead
    /// of being silently clamped to its edge.
    fn reference_tick_to_local_position(&self, reference_tick: u64) -> f64 {
        if reference_tick == 0 {
            return 0.0;
        }
        let reference = reference_tick as f64;
        let duration = self
            .cumulative_reference_ticks
            .last()
            .copied()
            .unwrap_or(self.local_ticks_per_cycle as f64);
        if reference >= duration {
            let scale = self.local_ticks_per_cycle as f64 / duration.max(1.0);
            return self.local_ticks_per_cycle as f64 + (reference - duration) * scale;
        }
        let right = self
            .cumulative_reference_ticks
            .partition_point(|tick| *tick < reference);
        if right == 0 {
            return 0.0;
        }
        let left = right - 1;
        let y_left = self.cumulative_reference_ticks[left];
        let y_right = self.cumulative_reference_ticks[right];
        let blend = if (y_right - y_left).abs() <= f64::EPSILON {
            0.0
        } else {
            (reference - y_left) / (y_right - y_left)
        };
        let sample_position = left as f64 + blend.clamp(0.0, 1.0);
        (sample_position / LOCAL_TEMPO_AUTOMATION_SAMPLES as f64
            * self.local_ticks_per_cycle as f64)
            .max(0.0)
    }
}
