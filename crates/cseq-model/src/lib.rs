//! Core data model: Score, DurationTree, AccentTree, ValueSpec.
//!
//! This crate has no internal dependencies. Pure data types.
//! All timing math uses `Rational` (`num_rational::Rational64`).

use std::collections::{HashMap, HashSet};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Re-export and alias
// ---------------------------------------------------------------------------

pub type Rational = num_rational::Rational64;

// ---------------------------------------------------------------------------
// ID types
// ---------------------------------------------------------------------------

pub type NodeId = u64;
pub type AccentNodeId = u64;
pub type ScoreId = String;
pub type TransformId = u64;
pub type ChannelId = u64;
pub type PulseSpanId = u64;

/// Serde's JSON representation for engine-generated or remembered `u64`
/// seeds. JavaScript numbers cannot represent every `u64`, so canonical output
/// is an unsigned decimal string; legacy non-negative JSON integers remain
/// accepted on input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LosslessU64(u64);

impl Serialize for LosslessU64 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for LosslessU64 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct LosslessU64Visitor;

        impl<'de> serde::de::Visitor<'de> for LosslessU64Visitor {
            type Value = LosslessU64;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("an unsigned 64-bit integer or its decimal string")
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(LosslessU64(value))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                u64::try_from(value)
                    .map(LosslessU64)
                    .map_err(|_| E::custom("seed must not be negative"))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                value
                    .parse::<u64>()
                    .map(LosslessU64)
                    .map_err(|_| E::custom("seed string must be a decimal u64"))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                self.visit_str(&value)
            }
        }

        deserializer.deserialize_any(LosslessU64Visitor)
    }
}

/// Lossless serde adapter for one generated/remembered `u64` seed.
pub mod lossless_u64_serde {
    use super::{Deserialize, LosslessU64, Serialize};

    pub fn serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        LosslessU64(*value).serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        LosslessU64::deserialize(deserializer).map(|value| value.0)
    }
}

/// Lossless serde adapter for a generated/remembered seed history.
pub mod lossless_u64_vec_serde {
    use super::{Deserialize, LosslessU64};

    pub fn serialize<S>(values: &[u64], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.collect_seq(values.iter().copied().map(LosslessU64))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u64>, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Vec::<LosslessU64>::deserialize(deserializer)
            .map(|values| values.into_iter().map(|value| value.0).collect())
    }
}

pub const ALLOWED_JATHIS: [u32; 7] = [3, 4, 5, 6, 7, 9, 11];

pub fn is_allowed_jathi(value: u32) -> bool {
    ALLOWED_JATHIS.contains(&value)
}

// ---------------------------------------------------------------------------
// ValueSpec<T> — every potentially-probabilistic value
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ValueSpecInner<T> {
    Fixed { value: T },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValueSpec<T> {
    pub spec: ValueSpecInner<T>,
}

impl<T: Clone + Serialize + DeserializeOwned> ValueSpec<T> {
    pub fn fixed(v: T) -> Self {
        Self {
            spec: ValueSpecInner::Fixed { value: v },
        }
    }

    /// Returns the fixed value if this is `Fixed`, otherwise `None`.
    pub fn as_fixed(&self) -> Option<&T> {
        match &self.spec {
            ValueSpecInner::Fixed { value } => Some(value),
        }
    }
}

impl<T: Clone + Serialize + DeserializeOwned> From<T> for ValueSpec<T> {
    fn from(v: T) -> Self {
        Self::fixed(v)
    }
}

// ---------------------------------------------------------------------------
// Beat-quantized automation
// ---------------------------------------------------------------------------

pub const AUTOMATION_TARGET_PITCH: &str = "sequencer.pitch";
pub const AUTOMATION_TARGET_VELOCITY: &str = "sequencer.velocity";
pub const AUTOMATION_TARGET_TEMPO_BPM: &str = "transport.tempoBpm";
pub const AUTOMATION_TARGET_BEAT_ACCENT_MIN: &str = "sequencer.accent.beatStart.min";
pub const AUTOMATION_TARGET_BEAT_ACCENT_MAX: &str = "sequencer.accent.beatStart.max";
pub const AUTOMATION_TARGET_SECTION_ACCENT_MIN: &str = "sequencer.accent.sectionStartExtra.min";
pub const AUTOMATION_TARGET_SECTION_ACCENT_MAX: &str = "sequencer.accent.sectionStartExtra.max";
pub const AUTOMATION_TARGET_JATHI_ACCENT_MIN: &str = "sequencer.accent.jathiStart.min";
pub const AUTOMATION_TARGET_JATHI_ACCENT_MAX: &str = "sequencer.accent.jathiStart.max";

pub fn automation_target_boundary_probability(boundary_id: &str) -> String {
    format!("sequencer.boundary.{boundary_id}.probability")
}

pub fn automation_target_boundary_gati_weight(boundary_id: &str, subdivision: u32) -> String {
    format!("sequencer.boundary.{boundary_id}.gati.{subdivision}.weight")
}

pub fn automation_target_boundary_jathi_weight(boundary_id: &str, jathi: u32) -> String {
    format!("sequencer.boundary.{boundary_id}.jathi.{jathi}.weight")
}

pub fn automation_target_initial_gati_weight(subdivision: u32) -> String {
    format!("sequencer.initial.gati.{subdivision}.weight")
}

pub fn automation_target_initial_jathi_weight(jathi: u32) -> String {
    format!("sequencer.initial.jathi.{jathi}.weight")
}

pub fn automation_target_section_count_weight(count: u32) -> String {
    format!("sequencer.sectionCount.{count}.weight")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutomationValueKind {
    Boolean,
    Integer,
    Float,
    Weight,
}

impl AutomationValueKind {
    pub fn coerce(self, value: f64, min: f64, max: f64) -> f64 {
        let clamped = value.clamp(min, max);
        match self {
            AutomationValueKind::Boolean => {
                if clamped >= 0.5 {
                    1.0
                } else {
                    0.0
                }
            }
            AutomationValueKind::Integer => clamped.round(),
            AutomationValueKind::Float | AutomationValueKind::Weight => clamped,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutomationSampleRate {
    Beat,
    SectionStart,
    CycleStart,
    RhythmSpan,
    NoteGroup,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTargetDefinition {
    pub id: String,
    pub label: String,
    pub group: String,
    pub value_kind: AutomationValueKind,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub unit: Option<String>,
    pub sample_rate: AutomationSampleRate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTime {
    pub numer: u64,
    pub denom: u64,
}

impl AutomationTime {
    pub fn new(numer: u64, denom: u64) -> Option<Self> {
        if denom == 0 {
            return None;
        }
        let numer = numer.min(denom);
        let divisor = gcd_u64(numer, denom).max(1);
        Some(Self {
            numer: numer / divisor,
            denom: denom / divisor,
        })
    }

    pub fn zero() -> Self {
        Self { numer: 0, denom: 1 }
    }

    pub fn one() -> Self {
        Self { numer: 1, denom: 1 }
    }

    pub fn from_beat(cycle: u64, beat_index: u32, cycle_beats: u32, length_cycles: u32) -> Self {
        let length_cycles = u64::from(length_cycles.max(1));
        let cycle_beats = u64::from(cycle_beats.max(1));
        let beat_index = u64::from(beat_index).min(cycle_beats.saturating_sub(1));
        let total_beats = length_cycles.saturating_mul(cycle_beats).max(1);
        let cycle_in_range = cycle % length_cycles;
        let beat = cycle_in_range
            .saturating_mul(cycle_beats)
            .saturating_add(beat_index)
            .min(total_beats.saturating_sub(1));
        Self::new(beat, total_beats).unwrap_or_else(Self::zero)
    }

    pub fn cmp_exact(&self, other: &Self) -> std::cmp::Ordering {
        ((self.numer as u128) * (other.denom as u128))
            .cmp(&((other.numer as u128) * (self.denom as u128)))
    }

    pub fn to_unit_f64(self) -> f64 {
        if self.denom == 0 {
            return 0.0;
        }
        (self.numer as f64 / self.denom as f64).clamp(0.0, 1.0)
    }
}

pub fn automation_time_for_cycle_tick(
    cycle: u64,
    tick_in_cycle: u64,
    ticks_per_cycle: u64,
    length_cycles: u32,
) -> AutomationTime {
    if ticks_per_cycle == 0 {
        return AutomationTime::zero();
    }
    let length_cycles = u64::from(length_cycles.max(1));
    let cycle_in_range = cycle % length_cycles;
    let tick_in_cycle = tick_in_cycle.min(ticks_per_cycle);
    AutomationTime::new(
        cycle_in_range
            .saturating_mul(ticks_per_cycle)
            .saturating_add(tick_in_cycle),
        length_cycles.saturating_mul(ticks_per_cycle).max(1),
    )
    .unwrap_or_else(AutomationTime::zero)
}

fn gcd_u64(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let next = a % b;
        a = b;
        b = next;
    }
    a
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AutomationValue {
    Number { value: f64 },
    Bool { value: bool },
    Text { value: String },
}

impl AutomationValue {
    pub fn as_number(&self) -> Option<f64> {
        match self {
            AutomationValue::Number { value } if value.is_finite() => Some(*value),
            AutomationValue::Bool { value } => Some(if *value { 1.0 } else { 0.0 }),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutomationInterpolation {
    Hold,
    #[default]
    Linear,
    Smooth,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutomationSegmentCurveKind {
    Hold,
    #[default]
    Linear,
    Smooth,
    EaseIn,
    EaseOut,
    EaseInOut,
    Exponential,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSegmentCurve {
    #[serde(default)]
    pub kind: AutomationSegmentCurveKind,
    #[serde(default)]
    pub amount: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutomationCombineMode {
    #[default]
    Replace,
    Add,
    Multiply,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationPoint {
    pub id: Option<String>,
    pub time: AutomationTime,
    pub value: AutomationValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out_curve: Option<AutomationSegmentCurve>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationCurve {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub interpolation: AutomationInterpolation,
    #[serde(default)]
    pub points: Vec<AutomationPoint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationGraphRange {
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTrack {
    pub id: String,
    pub target: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub combine: AutomationCombineMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graph_range: Option<AutomationGraphRange>,
    #[serde(default)]
    pub curves: Vec<AutomationCurve>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationMarker {
    pub id: String,
    pub time: AutomationTime,
    #[serde(default)]
    pub label: String,
}

fn default_automation_length_cycles() -> u32 {
    1
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSet {
    #[serde(default = "default_automation_length_cycles")]
    pub length_cycles: u32,
    #[serde(default)]
    pub markers: Vec<AutomationMarker>,
    #[serde(default)]
    pub tracks: Vec<AutomationTrack>,
}

impl Default for AutomationSet {
    fn default() -> Self {
        Self {
            length_cycles: default_automation_length_cycles(),
            markers: Vec::new(),
            tracks: Vec::new(),
        }
    }
}

impl AutomationSet {
    pub fn is_empty(&self) -> bool {
        self.tracks.is_empty()
    }

    pub fn sample_number(
        &self,
        target: &str,
        cycle: u64,
        beat_index: u32,
        cycle_beats: u32,
        base: f64,
    ) -> Option<f64> {
        self.sample_typed_number(
            target,
            cycle,
            beat_index,
            cycle_beats,
            base,
            AutomationValueKind::Float,
            f64::NEG_INFINITY,
            f64::INFINITY,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn sample_typed_number(
        &self,
        target: &str,
        cycle: u64,
        beat_index: u32,
        cycle_beats: u32,
        base: f64,
        value_kind: AutomationValueKind,
        min: f64,
        max: f64,
    ) -> Option<f64> {
        if min.is_nan() || max.is_nan() || min > max || !base.is_finite() {
            return None;
        }
        let phase =
            AutomationTime::from_beat(cycle, beat_index, cycle_beats, self.length_cycles.max(1));
        self.sample_typed_number_at_phase(target, phase, base, value_kind, min, max)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn sample_typed_number_at_phase(
        &self,
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

        for track in self
            .tracks
            .iter()
            .filter(|track| track.enabled && track.target == target)
        {
            let samples = track
                .curves
                .iter()
                .filter(|curve| curve.enabled)
                .filter_map(|curve| curve.sample_number_with_markers(phase, &self.markers))
                .collect::<Vec<_>>();
            if samples.is_empty() {
                continue;
            }

            match track.combine {
                AutomationCombineMode::Replace => {
                    replace_samples.extend(samples);
                }
                AutomationCombineMode::Add => {
                    add_sum += samples.iter().sum::<f64>();
                }
                AutomationCombineMode::Multiply => {
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

    pub fn sample_bool(
        &self,
        target: &str,
        cycle: u64,
        beat_index: u32,
        cycle_beats: u32,
        base: bool,
    ) -> Option<bool> {
        self.sample_typed_number(
            target,
            cycle,
            beat_index,
            cycle_beats,
            if base { 1.0 } else { 0.0 },
            AutomationValueKind::Boolean,
            0.0,
            1.0,
        )
        .map(|value| value >= 1.0)
    }

    /// Sample a target's raw numeric value at a beat without applying any
    /// target domain clamp or type coercion. Intended for preview/inspection
    /// (e.g. timeline lanes that scale with their own UI-side range), where the
    /// backend does not know the post-score target's value kind or domain. The
    /// phase math is identical to `sample_number`, so it cannot drift from the
    /// beat sampling used by playback. Returns `None` when no enabled matching
    /// track produces a sample.
    pub fn sample_raw_number(
        &self,
        target: &str,
        cycle: u64,
        beat_index: u32,
        cycle_beats: u32,
    ) -> Option<f64> {
        self.sample_typed_number(
            target,
            cycle,
            beat_index,
            cycle_beats,
            0.0,
            AutomationValueKind::Float,
            f64::NEG_INFINITY,
            f64::INFINITY,
        )
    }

    pub fn sample_raw_number_at_phase(&self, target: &str, phase: AutomationTime) -> Option<f64> {
        self.sample_typed_number_at_phase(
            target,
            phase,
            0.0,
            AutomationValueKind::Float,
            f64::NEG_INFINITY,
            f64::INFINITY,
        )
    }
}

/// Post-score automation targets the playback engine re-samples **per note group
/// / per beat** (F3), as opposed to once at cycle start (beat 0).
///
/// This is the single source of truth shared by playback and the stopped-timeline
/// preview so the two cannot drift: a target listed here is sampled at the
/// visible beat/group phase in both places; everything else (seed mode and
/// post-score scalars not yet wired for per-group resampling) is sampled at beat
/// 0 in both. As more processors are wired for per-group resampling in
/// `cseq-transport`, add their target ids here in the same change so the preview
/// keeps "what you see is what plays" exact.
///
/// Score targets (pitch/velocity/accent ranges/etc., realized in
/// `SubdivisionSwitch`) are always per-beat and are handled by their own typed
/// preview path — they are intentionally not listed here.
pub fn automation_target_is_per_beat_post_score(target: &str) -> bool {
    target.starts_with("channelHocket.fallback.")
        || target.starts_with("channelHocket.matrix.")
        || target.starts_with("channelHocket.accentRule.")
        || target.starts_with("channelHocket.positionRule.")
}

impl AutomationCurve {
    pub fn sample_number(&self, phase: AutomationTime) -> Option<f64> {
        self.sample_number_with_markers(phase, &[])
    }

    pub fn sample_number_with_markers(
        &self,
        phase: AutomationTime,
        markers: &[AutomationMarker],
    ) -> Option<f64> {
        let mut points = self
            .points
            .iter()
            .filter_map(|point| {
                let value = point.value.as_number()?;
                Some((
                    automation_point_effective_time(point, markers),
                    value,
                    point.out_curve,
                ))
            })
            .collect::<Vec<_>>();
        if points.is_empty() {
            return None;
        }
        points.sort_by(|a, b| a.0.cmp_exact(&b.0));

        let first = points[0];
        if phase.cmp_exact(&first.0) != std::cmp::Ordering::Greater {
            return Some(first.1);
        }

        let last = points[points.len() - 1];
        if phase.cmp_exact(&last.0) != std::cmp::Ordering::Less {
            return Some(last.1);
        }

        for window in points.windows(2) {
            let left = window[0];
            let right = window[1];
            if phase.cmp_exact(&left.0) == std::cmp::Ordering::Less
                || phase.cmp_exact(&right.0) == std::cmp::Ordering::Greater
            {
                continue;
            }
            if phase == left.0 {
                return Some(left.1);
            }
            if phase == right.0 {
                return Some(right.1);
            }

            return Some(interpolate_number(
                left.0,
                left.1,
                right.0,
                right.1,
                phase,
                left.2,
                self.interpolation,
            ));
        }

        Some(last.1)
    }
}

fn automation_point_effective_time(
    point: &AutomationPoint,
    markers: &[AutomationMarker],
) -> AutomationTime {
    point
        .anchor_id
        .as_deref()
        .and_then(|anchor_id| {
            markers
                .iter()
                .find(|marker| marker.id == anchor_id)
                .map(|marker| marker.time)
        })
        .unwrap_or(point.time)
}

fn interpolate_number(
    left_time: AutomationTime,
    left_value: f64,
    right_time: AutomationTime,
    right_value: f64,
    phase: AutomationTime,
    segment_curve: Option<AutomationSegmentCurve>,
    fallback: AutomationInterpolation,
) -> f64 {
    let left = left_time.to_unit_f64();
    let right = right_time.to_unit_f64();
    let span = right - left;
    if span.abs() <= f64::EPSILON {
        return right_value;
    }
    let mut t = ((phase.to_unit_f64() - left) / span).clamp(0.0, 1.0);
    t = warp_automation_t(t, segment_curve, fallback);
    left_value + (right_value - left_value) * t
}

fn warp_automation_t(
    t: f64,
    segment_curve: Option<AutomationSegmentCurve>,
    fallback: AutomationInterpolation,
) -> f64 {
    let curve = segment_curve.unwrap_or(AutomationSegmentCurve {
        kind: match fallback {
            AutomationInterpolation::Hold => AutomationSegmentCurveKind::Hold,
            AutomationInterpolation::Linear => AutomationSegmentCurveKind::Linear,
            AutomationInterpolation::Smooth => AutomationSegmentCurveKind::Smooth,
        },
        amount: 1.0,
    });
    let amount = curve.amount.clamp(0.0, 1.0);
    match curve.kind {
        AutomationSegmentCurveKind::Hold => 0.0,
        AutomationSegmentCurveKind::Linear => t,
        AutomationSegmentCurveKind::Smooth => {
            let smooth = t * t * (3.0 - 2.0 * t);
            lerp(t, smooth, amount)
        }
        AutomationSegmentCurveKind::EaseIn => {
            let exponent = 1.0 + amount * 5.0;
            t.powf(exponent)
        }
        AutomationSegmentCurveKind::EaseOut => {
            let exponent = 1.0 + amount * 5.0;
            1.0 - (1.0 - t).powf(exponent)
        }
        AutomationSegmentCurveKind::EaseInOut => {
            let exponent = 1.0 + amount * 5.0;
            if t < 0.5 {
                0.5 * (2.0 * t).powf(exponent)
            } else {
                1.0 - 0.5 * (2.0 * (1.0 - t)).powf(exponent)
            }
        }
        AutomationSegmentCurveKind::Exponential => {
            if amount <= f64::EPSILON {
                return t;
            }
            let bend = 1.0 + amount * 8.0;
            ((bend.powf(t) - 1.0) / (bend - 1.0)).clamp(0.0, 1.0)
        }
    }
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn default_true() -> bool {
    true
}

// ---------------------------------------------------------------------------
// AccentTree
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccentStrength {
    Scalar(f32),
    Named(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AccentKind {
    Group {
        children: Vec<AccentNodeId>,
        strength: AccentStrength,
    },
    Accent {
        strength: AccentStrength,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccentNode {
    pub id: AccentNodeId,
    pub parent: Option<AccentNodeId>,
    pub kind: AccentKind,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccentTree {
    pub root: AccentNodeId,
    pub nodes: HashMap<AccentNodeId, AccentNode>,
}

impl AccentTree {
    /// Look up a node by ID.
    pub fn get(&self, id: AccentNodeId) -> Option<&AccentNode> {
        self.nodes.get(&id)
    }

    /// Walk up from a node to the root, collecting scalar strengths.
    /// Returns the product of all scalar strengths encountered.
    /// Named strengths are treated as 1.0 (resolve via a strength map externally).
    pub fn resolve_strength(&self, start: AccentNodeId) -> f32 {
        let mut strength = 1.0f32;
        let mut current = Some(start);
        while let Some(id) = current {
            if let Some(node) = self.nodes.get(&id) {
                let s = match &node.kind {
                    AccentKind::Group {
                        strength: st,
                        children: _,
                    } => st,
                    AccentKind::Accent { strength: st } => st,
                };
                match s {
                    AccentStrength::Scalar(v) => strength *= v,
                    AccentStrength::Named(_) => {} // treated as 1.0
                }
                current = node.parent;
            } else {
                break;
            }
        }
        strength
    }

    /// Create a minimal accent tree with a single root accent node.
    pub fn single_accent(strength: f32) -> Self {
        let root_id = 0;
        let mut nodes = HashMap::new();
        nodes.insert(
            root_id,
            AccentNode {
                id: root_id,
                parent: None,
                kind: AccentKind::Accent {
                    strength: AccentStrength::Scalar(strength),
                },
                label: None,
            },
        );
        Self {
            root: root_id,
            nodes,
        }
    }
}

// ---------------------------------------------------------------------------
// DurationTree
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubdivisionPolicy {
    Explicit,
    Equal,
    Weighted(Vec<u32>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PulseEvent {
    Note {
        pitch: ValueSpec<u8>,
        #[serde(with = "rational_serde")]
        duration_frac: Rational,
    },
    Rest,
    Cc {
        controller: u8,
        value: ValueSpec<u8>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PulseData {
    pub event: PulseEvent,
    pub velocity: ValueSpec<u8>,
}

pub type ScoreRef = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TriggerMode {
    Reset,
    Continue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DurationKind {
    Pulse(PulseData),
    Subdivided {
        children: Vec<NodeId>,
        policy: SubdivisionPolicy,
    },
    Tied {
        children: Vec<NodeId>,
    },
    Trigger {
        target_score: ScoreRef,
        target_channel: ChannelId,
        mode: TriggerMode,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PulseSpanKind {
    Section {
        index: u32,
    },
    GatiBeat {
        section_index: u32,
        beat: u32,
        gati: u32,
    },
    JathiPulse {
        section_index: u32,
        jathi: u32,
        index: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PulseSpan {
    pub id: PulseSpanId,
    pub kind: PulseSpanKind,
    #[serde(with = "rational_serde")]
    pub start: Rational,
    #[serde(with = "rational_serde")]
    pub duration: Rational,
    pub start_matra: u32,
    pub matra_len: u32,
    #[serde(default)]
    pub tags: Vec<String>,
}

pub fn pulse_span_section_index(span: &PulseSpan) -> Option<u32> {
    match span.kind {
        PulseSpanKind::Section { index }
        | PulseSpanKind::GatiBeat {
            section_index: index,
            ..
        }
        | PulseSpanKind::JathiPulse {
            section_index: index,
            ..
        } => Some(index),
    }
}

/// Return required internal matra cut points for `span`, derived from every
/// overlapping protected pulse span in the same section.
///
/// These cut points are the bridge between the structural accent model and the
/// rhythm engine: rhythm may add more grouping boundaries, but it must never
/// remove one of these.
pub fn protected_cuts_for_span(span: &PulseSpan, all_spans: &[PulseSpan]) -> Vec<u32> {
    let Some(section_index) = pulse_span_section_index(span) else {
        return vec![];
    };
    if matches!(span.kind, PulseSpanKind::Section { .. })
        || span.duration == Rational::new(0, 1)
        || span.matra_len == 0
    {
        return vec![];
    }

    let span_end = span.start + span.duration;
    let mut cuts = Vec::new();
    for other in all_spans {
        if other.id == span.id || pulse_span_section_index(other) != Some(section_index) {
            continue;
        }
        if matches!(other.kind, PulseSpanKind::Section { .. }) {
            continue;
        }

        for boundary in [other.start, other.start + other.duration] {
            if boundary <= span.start || boundary >= span_end {
                continue;
            }

            let relative = (boundary - span.start) * Rational::from_integer(span.matra_len as i64)
                / span.duration;
            if *relative.denom() != 1 {
                continue;
            }
            let cut = *relative.numer();
            if cut > 0 && cut < span.matra_len as i64 {
                cuts.push(cut as u32);
            }
        }
    }

    cuts.sort_unstable();
    cuts.dedup();
    cuts
}

/// Return the protected accent spans that the rhythm engine should fill.
///
/// Jathi, when present, is the active accent pulse for its section: rhythm
/// should partition the space from one jathi accent to the next. If a section
/// has no resolved jathi, rhythm falls back to the gati beat spans.
pub fn rhythm_accent_spans(all_spans: &[PulseSpan]) -> Vec<&PulseSpan> {
    let sections_with_jathi = all_spans
        .iter()
        .filter_map(|span| match span.kind {
            PulseSpanKind::JathiPulse { section_index, .. } => Some(section_index),
            _ => None,
        })
        .collect::<HashSet<_>>();

    all_spans
        .iter()
        .filter(|span| match span.kind {
            PulseSpanKind::JathiPulse { .. } => true,
            PulseSpanKind::GatiBeat { section_index, .. } => {
                !sections_with_jathi.contains(&section_index)
            }
            PulseSpanKind::Section { .. } => false,
        })
        .collect()
}

/// Return required cut points for rhythm resolution inside an active accent
/// span.
///
/// This deliberately differs from `protected_cuts_for_span`: inactive accent
/// layers are not allowed to split the current rhythmic span. In a jathi
/// section, for example, gati beat starts remain visible/accentable, but the
/// rhythm pattern partitions the jathi pulse itself.
pub fn rhythm_protected_cuts_for_span(span: &PulseSpan, all_spans: &[PulseSpan]) -> Vec<u32> {
    let active_ids = rhythm_accent_spans(all_spans)
        .iter()
        .map(|active| active.id)
        .collect::<HashSet<_>>();
    if !active_ids.contains(&span.id) {
        return vec![];
    }

    let active_spans = all_spans
        .iter()
        .filter(|candidate| active_ids.contains(&candidate.id))
        .cloned()
        .collect::<Vec<_>>();
    protected_cuts_for_span(span, &active_spans)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NodeMetadata {
    pub label: Option<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DurationNode {
    pub id: NodeId,
    pub parent: Option<NodeId>,
    #[serde(with = "rational_serde")]
    pub duration: Rational,
    pub accent_ref: Option<AccentNodeId>,
    pub kind: DurationKind,
    pub metadata: NodeMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DurationTree {
    pub root: NodeId,
    pub nodes: HashMap<NodeId, DurationNode>,
    pub next_id: NodeId,
    #[serde(default)]
    pub pulse_spans: Vec<PulseSpan>,
    #[serde(default)]
    pub next_pulse_span_id: PulseSpanId,
}

impl DurationTree {
    /// Allocate the next unique node ID. IDs are never reused.
    pub fn next_id(&mut self) -> NodeId {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Allocate the next unique pulse span ID. IDs are never reused inside
    /// a realized tree.
    pub fn next_pulse_span_id(&mut self) -> PulseSpanId {
        let id = self.next_pulse_span_id;
        self.next_pulse_span_id += 1;
        id
    }

    /// Add a first-class accent/rhythm target span to the realized tree.
    pub fn push_pulse_span(
        &mut self,
        kind: PulseSpanKind,
        start: Rational,
        duration: Rational,
        start_matra: u32,
        matra_len: u32,
        tags: Vec<String>,
    ) -> PulseSpanId {
        let id = self.next_pulse_span_id();
        self.pulse_spans.push(PulseSpan {
            id,
            kind,
            start,
            duration,
            start_matra,
            matra_len,
            tags,
        });
        id
    }

    /// Look up a node by ID.
    pub fn get(&self, id: NodeId) -> Option<&DurationNode> {
        self.nodes.get(&id)
    }

    /// A tree with a single Pulse root playing a note.
    pub fn single_pulse(duration: Rational) -> Self {
        let root_id = 0;
        let mut nodes = HashMap::new();
        nodes.insert(
            root_id,
            DurationNode {
                id: root_id,
                parent: None,
                duration,
                accent_ref: Some(0), // assumes accent tree root is 0
                kind: DurationKind::Pulse(PulseData {
                    event: PulseEvent::Note {
                        pitch: ValueSpec::fixed(60),
                        duration_frac: Rational::new(1, 1),
                    },
                    velocity: ValueSpec::fixed(100),
                }),
                metadata: NodeMetadata::default(),
            },
        );
        Self {
            root: root_id,
            nodes,
            next_id: 1,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        }
    }

    /// A tree with a single Rest root (empty cycle).
    pub fn empty_cycle(duration: Rational) -> Self {
        let root_id = 0;
        let mut nodes = HashMap::new();
        nodes.insert(
            root_id,
            DurationNode {
                id: root_id,
                parent: None,
                duration,
                accent_ref: None,
                kind: DurationKind::Pulse(PulseData {
                    event: PulseEvent::Rest,
                    velocity: ValueSpec::fixed(0),
                }),
                metadata: NodeMetadata::default(),
            },
        );
        Self {
            root: root_id,
            nodes,
            next_id: 1,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        }
    }

    /// Depth-first walk of the tree. The visitor receives each node and the
    /// path of NodeIds from the root to that node (inclusive).
    pub fn walk(&self, mut visitor: impl FnMut(&DurationNode, &[NodeId])) {
        let mut stack: Vec<(NodeId, Vec<NodeId>)> = vec![(self.root, vec![self.root])];
        while let Some((id, path)) = stack.pop() {
            if let Some(node) = self.nodes.get(&id) {
                visitor(node, &path);
                // Push children in reverse order so left-to-right DFS.
                let children: Vec<NodeId> = match &node.kind {
                    DurationKind::Subdivided { children, .. } => children.clone(),
                    DurationKind::Tied { children } => children.clone(),
                    _ => vec![],
                };
                for &child_id in children.iter().rev() {
                    let mut child_path = path.clone();
                    child_path.push(child_id);
                    stack.push((child_id, child_path));
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NodeSelector {
    Root,
    ById { id: NodeId },
    ByPath { path: Vec<usize> },
    ByTag { tag: String },
    ByAccentRef { accent_id: AccentNodeId },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TiePattern {
    All,
    Pairs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TransformKind {
    Subdivide {
        policy: SubdivisionPolicy,
        count: u32,
    },
    SubdivisionSwitch {
        initial_weights: Vec<WeightedSubdivisionChoice>,
        #[serde(default)]
        initial_jathi_weights: Vec<WeightedJathiChoice>,
        /// Custom subdivision for the first section (cycle start). `None` keeps
        /// the uniform-gati behavior. Boxed to keep the enum variant small.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        initial_custom_subdivision: Option<Box<CustomSubdivisionSpec>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        automation: Option<Box<AutomationSet>>,
        inflections: Vec<SubdivisionInflection>,
        switch_count_weights: Vec<WeightedSwitchCount>,
        seed_mode: SwitchSeedMode,
        pitch: ValueSpec<u8>,
        velocity: ValueSpec<u8>,
        #[serde(default)]
        accent: GatiAccentSpec,
    },
    SetVelocity {
        velocity: ValueSpec<u8>,
    },
    Tie {
        pattern: TiePattern,
    },
    RemoveNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transform {
    pub id: TransformId,
    pub kind: TransformKind,
    pub target: NodeSelector,
    pub enabled: bool,
    pub label: Option<String>,
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScoreMetadata {
    pub description: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightedSubdivisionChoice {
    pub subdivision: u32,
    pub weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightedSwitchCount {
    pub count: u32,
    pub weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightedJathiChoice {
    pub jathi: u32,
    pub weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightedCustomPartCount {
    pub count: u32,
    pub weight: f32,
}

/// Legacy custom-subdivision row. Current custom grids choose one grid-wide
/// gati; when loading an older fixed-row spec, the first row supplies that gati.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomDivision {
    pub gati_weights: Vec<WeightedSubdivisionChoice>,
}

fn default_equal_parts_weight() -> f32 {
    1.0
}

/// Optional custom equal-parts grid for a section. When present on the section's
/// originating boundary, the section first samples whether to use the regular
/// per-beat grid or the equal-parts grid. The equal-parts grid then selects a
/// part count and one subdivision for the whole grid. Grouping tiles the
/// section's total matras exactly as it does for a normal section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomSubdivisionSpec {
    /// Weight for keeping the section on the regular per-beat gati path.
    #[serde(default)]
    pub per_beat_weight: f32,
    /// Weight for using the equal-parts grid.
    #[serde(default = "default_equal_parts_weight")]
    pub equal_parts_weight: f32,
    /// Weighted random choices for how many equal notes fill the section.
    #[serde(default)]
    pub part_count_weights: Vec<WeightedCustomPartCount>,
    /// Weighted random choices for the one gati used by all equal notes in the
    /// chosen custom grid.
    #[serde(default)]
    pub part_gati_weights: Vec<WeightedSubdivisionChoice>,
    /// Legacy fixed equal-parts rows. When the new fields are empty, these rows
    /// provide `count = divisions.len()` and the first row's gati weights.
    #[serde(default)]
    pub divisions: Vec<CustomDivision>,
    /// Legacy custom jathi weights. Current equal-parts sections use the same
    /// regular section-level jathi weights as uniform sections; this field is
    /// retained only so in-progress/older custom specs round-trip.
    #[serde(default)]
    pub jathi_weights: Vec<WeightedJathiChoice>,
}

impl CustomSubdivisionSpec {
    /// Validate structural well-formedness. Gati/jathi *divisibility* depends on
    /// the per-cycle sampled gatis and is resolved at realize time, so this only
    /// checks that the authored weights can ever produce a choice.
    pub fn validate(&self) -> Result<(), String> {
        if !self.per_beat_weight.is_finite() || self.per_beat_weight < 0.0 {
            return Err(
                "custom subdivision per-beat weight must be a finite value >= 0".to_string(),
            );
        }
        if !self.equal_parts_weight.is_finite() || self.equal_parts_weight < 0.0 {
            return Err(
                "custom subdivision equal-parts weight must be a finite value >= 0".to_string(),
            );
        }
        if self.per_beat_weight <= 0.0 && self.equal_parts_weight <= 0.0 {
            return Err(
                "custom subdivision needs a positive per-beat or equal-parts weight".to_string(),
            );
        }

        if self.equal_parts_weight > 0.0 {
            let mut has_part_count = false;
            let mut seen_part_counts = std::collections::BTreeSet::new();
            for choice in &self.part_count_weights {
                if choice.count == 0 || choice.count > 64 {
                    return Err("custom subdivision part counts must be 1-64".to_string());
                }
                if !seen_part_counts.insert(choice.count) {
                    return Err("custom subdivision part counts must be unique".to_string());
                }
                if !choice.weight.is_finite() || choice.weight < 0.0 {
                    return Err(
                        "custom subdivision part-count weights must be finite values >= 0"
                            .to_string(),
                    );
                }
                if choice.weight > 0.0 {
                    has_part_count = true;
                }
            }
            if !has_part_count && self.divisions.is_empty() {
                return Err("custom subdivision needs a positive part-count weight".to_string());
            }

            if self.part_gati_weights.is_empty() {
                let Some(first_division) = self.divisions.first() else {
                    return Err("custom subdivision needs positive grid gati weights".to_string());
                };
                validate_custom_gati_weights(
                    "custom subdivision legacy grid gati choices",
                    &first_division.gati_weights,
                )?;
            } else {
                validate_custom_gati_weights(
                    "custom subdivision grid gati choices",
                    &self.part_gati_weights,
                )?;
            }
        }
        for (index, division) in self.divisions.iter().enumerate() {
            validate_custom_gati_weights(
                &format!("custom subdivision division {}", index + 1),
                &division.gati_weights,
            )?;
        }
        Ok(())
    }
}

fn validate_custom_gati_weights(
    label: &str,
    weights: &[WeightedSubdivisionChoice],
) -> Result<(), String> {
    for choice in weights {
        if choice.subdivision == 0 || choice.subdivision > 64 {
            return Err(format!("{label} gati choices must be 1-64"));
        }
        if !choice.weight.is_finite() || choice.weight < 0.0 {
            return Err(format!("{label} weights must be finite values >= 0"));
        }
    }
    if !weights.iter().any(|choice| choice.weight > 0.0) {
        return Err(format!("{label} needs a positive gati weight"));
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VelocityAccentRange {
    pub min: u8,
    pub max: u8,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JathiAccentMode {
    /// A jathi accent replaces the beat-start gati accent when both land
    /// on the same matra. Section-start extra accent still applies.
    #[default]
    OverrideGati,
    /// Jathi and gati accents are independently sampled and summed.
    Layered,
}

fn default_jathi_start_accent() -> VelocityAccentRange {
    VelocityAccentRange { min: 24, max: 36 }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatiAccentSpec {
    /// Additive velocity boost for the first matra of each beat.
    #[serde(default)]
    pub beat_start: VelocityAccentRange,
    /// Extra additive velocity boost when a beat starts a resolved section.
    #[serde(default)]
    pub section_start_extra: VelocityAccentRange,
    /// Additive velocity boost for resolved jathi pulse starts.
    #[serde(default = "default_jathi_start_accent")]
    pub jathi_start: VelocityAccentRange,
    /// Whether jathi replaces or layers with the gati beat-start accent.
    #[serde(default)]
    pub jathi_mode: JathiAccentMode,
}

impl Default for GatiAccentSpec {
    fn default() -> Self {
        Self {
            beat_start: VelocityAccentRange { min: 12, max: 20 },
            section_start_extra: VelocityAccentRange { min: 8, max: 14 },
            jathi_start: default_jathi_start_accent(),
            jathi_mode: JathiAccentMode::OverrideGati,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubdivisionInflection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(with = "rational_serde")]
    pub position: Rational,
    pub change_probability: f32,
    pub subdivision_weights: Vec<WeightedSubdivisionChoice>,
    #[serde(default)]
    pub jathi_weights: Vec<WeightedJathiChoice>,
    /// When present, the section this boundary starts may use an equal-parts
    /// grid: first choose regular per-beat vs equal-parts, then choose the part
    /// count and one grid-wide gati. `None` => today's uniform-gati behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_subdivision: Option<CustomSubdivisionSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SwitchSeedMode {
    /// Same selection every cycle.
    Locked { seed: u64 },
    /// Re-sample every cycle using `seed` mixed with the cycle number.
    PerCycle { seed: u64 },
    /// Pick from remembered seeds or create and remember a new seed.
    History {
        seed: u64,
        #[serde(deserialize_with = "lossless_u64_vec_serde::deserialize")]
        history: Vec<u64>,
        history_weight: f32,
        new_seed_weight: f32,
        max_history: usize,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubdivisionSwitchSpec {
    pub cycle_beats: u32,
    pub initial_weights: Vec<WeightedSubdivisionChoice>,
    pub initial_jathi_weights: Vec<WeightedJathiChoice>,
    /// When present, the first section (cycle start) may use an equal-parts
    /// grid: first choose regular per-beat vs equal-parts, then choose the part
    /// count and one grid-wide gati. `None` => uniform-gati behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_custom_subdivision: Option<CustomSubdivisionSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub automation: Option<AutomationSet>,
    pub inflections: Vec<SubdivisionInflection>,
    pub switch_count_weights: Vec<WeightedSwitchCount>,
    pub seed_mode: SwitchSeedMode,
    pub accent: GatiAccentSpec,
    pub pitch: u8,
    pub velocity: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Score {
    pub id: ScoreId,
    pub name: String,
    pub duration_tree: DurationTree,
    pub accent_tree: AccentTree,
    #[serde(with = "rational_serde")]
    pub cycle_length: Rational,
    pub default_gati: u32,
    pub default_jathi: u32,
    pub pipeline: Vec<Transform>,
    pub next_transform_id: TransformId,
    pub metadata: ScoreMetadata,
    pub schema_version: u32,
}

impl Score {
    /// Create a minimal score with a single pulse.
    pub fn single_pulse(name: &str, pitch: u8, velocity: u8) -> Self {
        let accent_tree = AccentTree::single_accent(1.0);
        let cycle_length = Rational::new(1, 1);
        let mut duration_tree = DurationTree::single_pulse(cycle_length);
        // Override pitch and velocity.
        if let Some(root) = duration_tree.nodes.get_mut(&duration_tree.root) {
            root.kind = DurationKind::Pulse(PulseData {
                event: PulseEvent::Note {
                    pitch: ValueSpec::fixed(pitch),
                    duration_frac: Rational::new(1, 1),
                },
                velocity: ValueSpec::fixed(velocity),
            });
        }
        Self {
            id: name.to_string(),
            name: name.to_string(),
            duration_tree,
            accent_tree,
            cycle_length,
            default_gati: 4,
            default_jathi: 4,
            pipeline: vec![],
            next_transform_id: 0,
            metadata: ScoreMetadata::default(),
            schema_version: SCHEMA_VERSION,
        }
    }

    /// Create a score with a subdivided root containing one pulse per pitch.
    ///
    /// `pitches` must be non-empty. Each pitch becomes a child pulse node.
    /// The `policy` controls how duration is distributed among children
    /// (Equal or Weighted).
    pub fn subdivided(name: &str, pitches: &[u8], velocity: u8, policy: SubdivisionPolicy) -> Self {
        assert!(!pitches.is_empty(), "pitches must be non-empty");

        let cycle = Rational::new(1, 1);
        let accent_tree = AccentTree::single_accent(1.0);
        let mut nodes = HashMap::new();
        let mut children = Vec::new();

        for (i, &pitch) in pitches.iter().enumerate() {
            let id = (i + 1) as NodeId;
            children.push(id);
            nodes.insert(
                id,
                DurationNode {
                    id,
                    parent: Some(0),
                    duration: Rational::new(1, pitches.len() as i64),
                    accent_ref: Some(0),
                    kind: DurationKind::Pulse(PulseData {
                        event: PulseEvent::Note {
                            pitch: ValueSpec::fixed(pitch),
                            duration_frac: Rational::new(1, 1),
                        },
                        velocity: ValueSpec::fixed(velocity),
                    }),
                    metadata: NodeMetadata::default(),
                },
            );
        }

        nodes.insert(
            0,
            DurationNode {
                id: 0,
                parent: None,
                duration: cycle,
                accent_ref: None,
                kind: DurationKind::Subdivided { children, policy },
                metadata: NodeMetadata::default(),
            },
        );

        let duration_tree = DurationTree {
            root: 0,
            nodes,
            next_id: (pitches.len() + 1) as NodeId,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };

        Self {
            id: name.to_string(),
            name: name.to_string(),
            duration_tree,
            accent_tree,
            cycle_length: cycle,
            default_gati: 4,
            default_jathi: 4,
            pipeline: vec![],
            next_transform_id: 0,
            metadata: ScoreMetadata::default(),
            schema_version: SCHEMA_VERSION,
        }
    }

    pub fn subdivision_switch(name: &str, spec: SubdivisionSwitchSpec) -> Self {
        let SubdivisionSwitchSpec {
            cycle_beats,
            initial_weights,
            initial_jathi_weights,
            initial_custom_subdivision,
            automation,
            inflections,
            switch_count_weights,
            seed_mode,
            accent,
            pitch,
            velocity,
        } = spec;

        assert!(cycle_beats > 0, "cycle_beats must be > 0");
        let initial_may_use_per_beat = initial_custom_subdivision
            .as_ref()
            .map(|custom| custom.per_beat_weight > 0.0)
            .unwrap_or(true);
        assert!(
            !initial_may_use_per_beat || !initial_weights.is_empty(),
            "initial_weights must be non-empty when the initial section can use per-beat gati"
        );
        if let Some(custom) = &initial_custom_subdivision {
            if let Err(err) = custom.validate() {
                panic!("invalid initial custom subdivision: {err}");
            }
        }
        for (index, inflection) in inflections.iter().enumerate() {
            if let Some(custom) = &inflection.custom_subdivision {
                if let Err(err) = custom.validate() {
                    panic!(
                        "invalid custom subdivision on inflection {}: {err}",
                        index + 1
                    );
                }
            }
        }

        let zero = Rational::new(0, 1);
        let one = Rational::new(1, 1);
        let mut sorted_positions: Vec<Rational> =
            inflections.iter().map(|inf| inf.position).collect();
        sorted_positions.sort();
        for window in sorted_positions.windows(2) {
            assert!(
                window[0] < window[1],
                "inflection positions must be strictly distinct"
            );
        }
        for pos in &sorted_positions {
            assert!(
                *pos > zero && *pos < one,
                "inflection positions must lie strictly in (0, 1)"
            );
            let scaled = *pos * Rational::from_integer(cycle_beats as i64);
            assert!(
                *scaled.denom() == 1,
                "inflection positions must align to whole beat boundaries"
            );
        }
        for count in &switch_count_weights {
            assert!(
                count.count as usize <= inflections.len(),
                "switch counts cannot exceed inflection count"
            );
            assert!(count.weight >= 0.0, "switch count weights must be >= 0");
        }
        if !switch_count_weights.is_empty() {
            assert!(
                switch_count_weights.iter().any(|count| count.weight > 0.0),
                "switch count weights need at least one positive weight"
            );
        }

        let initial_default = initial_weights
            .iter()
            .max_by(|a, b| a.weight.total_cmp(&b.weight))
            .map(|c| c.subdivision)
            .unwrap_or(4);

        let mut score = Self::single_pulse(name, pitch, velocity);
        score.default_gati = initial_default;
        score.default_jathi = inflections.len() as u32 + 1;
        score.cycle_length = Rational::from_integer(cycle_beats as i64);
        if let Some(root) = score.duration_tree.nodes.get_mut(&score.duration_tree.root) {
            root.duration = Rational::new(1, 1);
        }
        score.add_transform(
            TransformKind::SubdivisionSwitch {
                initial_weights,
                initial_jathi_weights,
                initial_custom_subdivision: initial_custom_subdivision.map(Box::new),
                automation: automation.map(Box::new),
                inflections,
                switch_count_weights,
                seed_mode,
                pitch: ValueSpec::fixed(pitch),
                velocity: ValueSpec::fixed(velocity),
                accent,
            },
            NodeSelector::Root,
            Some("probabilistic gati sections".to_string()),
        );
        score
    }

    /// Add a transform to the pipeline. Returns the assigned TransformId.
    pub fn add_transform(
        &mut self,
        kind: TransformKind,
        target: NodeSelector,
        label: Option<String>,
    ) -> TransformId {
        let id = self.next_transform_id;
        self.next_transform_id += 1;
        self.pipeline.push(Transform {
            id,
            kind,
            target,
            enabled: true,
            label,
        });
        id
    }

    /// Remove a transform by ID. Returns true if found and removed.
    pub fn remove_transform(&mut self, id: TransformId) -> bool {
        let len = self.pipeline.len();
        self.pipeline.retain(|t| t.id != id);
        self.pipeline.len() < len
    }
}

// ---------------------------------------------------------------------------
// Rational serde helper
// ---------------------------------------------------------------------------

/// Serializes Rational64 as {"numer": i64, "denom": i64} for readable JSON.
/// num-rational's serde impl uses a tuple [n, d] which is less clear.
mod rational_serde {
    use super::Rational;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    #[derive(Serialize, Deserialize)]
    struct RationalRepr {
        numer: i64,
        denom: i64,
    }

    pub fn serialize<S: Serializer>(r: &Rational, s: S) -> Result<S::Ok, S::Error> {
        RationalRepr {
            numer: *r.numer(),
            denom: *r.denom(),
        }
        .serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Rational, D::Error> {
        let repr = RationalRepr::deserialize(d)?;
        if repr.denom == 0 {
            return Err(serde::de::Error::custom("denominator cannot be zero"));
        }
        Ok(Rational::new(repr.numer, repr.denom))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switch_seed_history_accepts_lossless_strings_and_preserves_v3_numeric_output() {
        const ABOVE_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_993;
        let mode = SwitchSeedMode::History {
            seed: 7,
            history: vec![ABOVE_JS_SAFE_INTEGER, u64::MAX],
            history_weight: 2.0,
            new_seed_weight: 1.0,
            max_history: 8,
        };

        let wire = serde_json::to_value(&mode).expect("history mode must serialize");
        assert_eq!(wire["seed"], serde_json::json!(7));
        assert_eq!(
            wire["history"],
            serde_json::json!([9_007_199_254_740_993_u64, u64::MAX])
        );

        let canonical: SwitchSeedMode = serde_json::from_str(
            r#"{
                "type": "history",
                "seed": 7,
                "history": ["9007199254740993", "18446744073709551615"],
                "history_weight": 2.0,
                "new_seed_weight": 1.0,
                "max_history": 8
            }"#,
        )
        .expect("string history must deserialize");
        let legacy: SwitchSeedMode = serde_json::from_str(
            r#"{
                "type": "history",
                "seed": 7,
                "history": [9007199254740993, 18446744073709551615],
                "history_weight": 2.0,
                "new_seed_weight": 1.0,
                "max_history": 8
            }"#,
        )
        .expect("legacy integer history must deserialize");

        for decoded in [canonical, legacy] {
            match decoded {
                SwitchSeedMode::History { seed, history, .. } => {
                    assert_eq!(seed, 7);
                    assert_eq!(history, vec![ABOVE_JS_SAFE_INTEGER, u64::MAX]);
                }
                other => panic!("expected history mode, got {other:?}"),
            }
        }
    }

    fn automation_curve(
        target: &str,
        interpolation: AutomationInterpolation,
        points: &[(u64, u64, f64)],
    ) -> AutomationSet {
        AutomationSet {
            length_cycles: 1,
            markers: Vec::new(),
            tracks: vec![AutomationTrack {
                id: format!("{target}-track"),
                target: target.to_string(),
                enabled: true,
                combine: AutomationCombineMode::Replace,
                graph_range: None,
                curves: vec![AutomationCurve {
                    id: format!("{target}-curve"),
                    enabled: true,
                    interpolation,
                    points: points
                        .iter()
                        .map(|(numer, denom, value)| AutomationPoint {
                            id: None,
                            time: AutomationTime::new(*numer, *denom).unwrap(),
                            value: AutomationValue::Number { value: *value },
                            anchor_id: None,
                            out_curve: None,
                        })
                        .collect(),
                }],
            }],
        }
    }

    fn marker_anchor_curve_set(marker_time: Option<AutomationTime>) -> AutomationSet {
        let markers = match marker_time {
            Some(time) => vec![AutomationMarker {
                id: "arrival".to_string(),
                time,
                label: "Arrival".to_string(),
            }],
            None => Vec::new(),
        };

        AutomationSet {
            length_cycles: 1,
            markers,
            tracks: vec![AutomationTrack {
                id: "anchor-track".to_string(),
                target: "sequencer.pitch".to_string(),
                enabled: true,
                combine: AutomationCombineMode::Replace,
                graph_range: None,
                curves: vec![AutomationCurve {
                    id: "anchor-curve".to_string(),
                    enabled: true,
                    interpolation: AutomationInterpolation::Linear,
                    points: vec![
                        AutomationPoint {
                            id: Some("start".to_string()),
                            time: AutomationTime::zero(),
                            value: AutomationValue::Number { value: 0.0 },
                            anchor_id: None,
                            out_curve: None,
                        },
                        AutomationPoint {
                            id: Some("arrival-point".to_string()),
                            time: AutomationTime::new(1, 4).unwrap(),
                            value: AutomationValue::Number { value: 100.0 },
                            anchor_id: Some("arrival".to_string()),
                            out_curve: None,
                        },
                    ],
                }],
            }],
        }
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-6,
            "expected {actual} to be within 1e-6 of {expected}"
        );
    }

    /// GOLDEN SEGMENT-CURVE TABLE — shared with the frontend.
    ///
    /// The same (kind, amount, t) → value rows are asserted against the editor's
    /// `warpAutomationUnit` in `ui/src/automationTargets.test.ts` ("golden
    /// parity"). The drawn curve and the played curve must warp identically; if
    /// you change one implementation, change the other and BOTH tables.
    #[test]
    fn automation_warp_matches_the_golden_parity_table() {
        use AutomationSegmentCurveKind as K;
        let table: [(K, f64, f64, f64); 12] = [
            (K::Linear, 1.0, 0.25, 0.25),
            (K::Hold, 1.0, 0.7, 0.0),
            (K::Smooth, 1.0, 0.25, 0.15625),
            (K::Smooth, 0.5, 0.25, 0.203125),
            (K::EaseIn, 1.0, 0.25, 0.000244140625),
            (K::EaseIn, 0.0, 0.25, 0.25),
            (K::EaseOut, 1.0, 0.25, 0.822021484375),
            (K::EaseInOut, 1.0, 0.25, 0.0078125),
            (K::EaseInOut, 1.0, 0.75, 0.9921875),
            // (9^0.5 - 1) / 8 — exactly 0.25.
            (K::Exponential, 1.0, 0.5, 0.25),
            // (9^0.25 - 1) / 8 = (sqrt(3) - 1) / 8.
            (K::Exponential, 1.0, 0.25, (3.0_f64.sqrt() - 1.0) / 8.0),
            (K::Exponential, 0.0, 0.3, 0.3),
        ];
        for (kind, amount, t, expected) in table {
            let warped = warp_automation_t(
                t,
                Some(AutomationSegmentCurve { kind, amount }),
                AutomationInterpolation::Linear,
            );
            assert!(
                (warped - expected).abs() < 1e-12,
                "{kind:?} amount={amount} t={t}: {warped} != {expected}"
            );
        }
    }

    #[test]
    fn automation_marker_anchor_reorders_points_for_sampling() {
        // Stored order: free(0.3)=30 then anchored(0.5)=100, but the anchor's
        // marker sits at 0.1 — effectively FIRST. Sampling must follow the
        // effective order (0.1 → 0.3), not the stored order.
        let mut set = automation_curve("sequencer.pitch", AutomationInterpolation::Linear, &[]);
        set.markers = vec![AutomationMarker {
            id: "early".to_string(),
            time: AutomationTime::new(1, 10).unwrap(),
            label: String::new(),
        }];
        set.tracks[0].curves[0].points = vec![
            AutomationPoint {
                id: Some("free".to_string()),
                time: AutomationTime::new(3, 10).unwrap(),
                value: AutomationValue::Number { value: 30.0 },
                anchor_id: None,
                out_curve: None,
            },
            AutomationPoint {
                id: Some("anchored".to_string()),
                time: AutomationTime::new(1, 2).unwrap(),
                value: AutomationValue::Number { value: 100.0 },
                anchor_id: Some("early".to_string()),
                out_curve: None,
            },
        ];
        // Phase 0.2 lies halfway between effective 0.1 (100) and 0.3 (30).
        let mid = set
            .sample_raw_number_at_phase("sequencer.pitch", AutomationTime::new(1, 5).unwrap())
            .unwrap();
        assert_close(mid, 65.0);
        // Before the first effective point, sampling clamps to it.
        let head = set
            .sample_raw_number_at_phase("sequencer.pitch", AutomationTime::new(1, 20).unwrap())
            .unwrap();
        assert_close(head, 100.0);
    }

    #[test]
    fn automation_time_for_cycle_tick_wraps_and_clamps() {
        // Cycle wrap: cycle 3 in a 2-cycle span is the second cycle again.
        assert_eq!(
            automation_time_for_cycle_tick(3, 0, 960, 2),
            AutomationTime::new(960, 1920).unwrap()
        );
        // A tick at/past the cycle end clamps to the cycle boundary.
        assert_eq!(
            automation_time_for_cycle_tick(0, 5000, 960, 2),
            AutomationTime::new(960, 1920).unwrap()
        );
        // Guards: zero ticks-per-cycle collapses safely to phase zero, and a
        // zero span length behaves as a one-cycle span.
        assert_eq!(
            automation_time_for_cycle_tick(5, 3, 0, 2),
            AutomationTime::zero()
        );
        assert_eq!(
            automation_time_for_cycle_tick(7, 480, 960, 0),
            AutomationTime::new(480, 960).unwrap()
        );
    }

    #[test]
    fn automation_combine_precedence_is_replace_then_add_then_multiply() {
        // Two Replace tracks (3, 5) average to 4; Add (+2); Multiply (×2):
        // (avg(3,5) + 2) * 2 = 12, regardless of track order.
        let mut set = automation_curve(
            "sequencer.pitch",
            AutomationInterpolation::Linear,
            &[(0, 1, 3.0), (1, 1, 3.0)],
        );
        let constant_track =
            |id: &str, combine: AutomationCombineMode, value: f64| AutomationTrack {
                id: id.to_string(),
                target: "sequencer.pitch".to_string(),
                enabled: true,
                combine,
                graph_range: None,
                curves: vec![AutomationCurve {
                    id: format!("{id}-curve"),
                    enabled: true,
                    interpolation: AutomationInterpolation::Linear,
                    points: vec![
                        AutomationPoint {
                            id: None,
                            time: AutomationTime::zero(),
                            value: AutomationValue::Number { value },
                            anchor_id: None,
                            out_curve: None,
                        },
                        AutomationPoint {
                            id: None,
                            time: AutomationTime::new(1, 1).unwrap(),
                            value: AutomationValue::Number { value },
                            anchor_id: None,
                            out_curve: None,
                        },
                    ],
                }],
            };
        set.tracks
            .push(constant_track("mul", AutomationCombineMode::Multiply, 2.0));
        set.tracks.push(constant_track(
            "replace-2",
            AutomationCombineMode::Replace,
            5.0,
        ));
        set.tracks
            .push(constant_track("add", AutomationCombineMode::Add, 2.0));
        let sampled = set
            .sample_typed_number(
                "sequencer.pitch",
                0,
                0,
                4,
                999.0, // base is ignored once Replace samples exist
                AutomationValueKind::Float,
                f64::NEG_INFINITY,
                f64::INFINITY,
            )
            .unwrap();
        assert_close(sampled, 12.0);
    }

    #[test]
    fn automation_bool_threshold_matches_the_editor_at_one_half() {
        // Boolean coercion rounds at 0.5 (the editor displays the same split),
        // so a raw 0.5 plays true and 0.49 plays false.
        let on = automation_curve(
            "transport.rhythmPlaybackEnabled",
            AutomationInterpolation::Linear,
            &[(0, 1, 0.5), (1, 1, 0.5)],
        );
        assert_eq!(
            on.sample_bool("transport.rhythmPlaybackEnabled", 0, 0, 4, false),
            Some(true)
        );
        let off = automation_curve(
            "transport.rhythmPlaybackEnabled",
            AutomationInterpolation::Linear,
            &[(0, 1, 0.49), (1, 1, 0.49)],
        );
        assert_eq!(
            off.sample_bool("transport.rhythmPlaybackEnabled", 0, 0, 4, true),
            Some(false)
        );
    }

    #[test]
    fn automation_time_normalizes_without_float_storage() {
        assert_eq!(
            AutomationTime::new(500, 1_000),
            Some(AutomationTime { numer: 1, denom: 2 })
        );
        assert_eq!(AutomationTime::new(1, 0), None);
        assert_eq!(
            AutomationTime::from_beat(3, 2, 8, 4),
            AutomationTime {
                numer: 13,
                denom: 16
            }
        );
    }

    #[test]
    fn automation_linear_samples_beat_quantized_phase() {
        let set = automation_curve(
            "sequencer.pitch",
            AutomationInterpolation::Linear,
            &[(0, 1, 60.0), (1, 1, 72.0)],
        );

        let samples = (0..4)
            .map(|beat| {
                set.sample_number("sequencer.pitch", 0, beat, 4, 60.0)
                    .unwrap()
            })
            .collect::<Vec<_>>();
        assert_eq!(samples, vec![60.0, 63.0, 66.0, 69.0]);
    }

    #[test]
    fn sample_raw_number_returns_unclamped_per_beat_value() {
        // A post-score-style target ramping 0 -> 100 over the span. Raw sampling
        // must return the per-beat value with no domain clamp (the UI lane scales
        // it with its own range) and must match the typed Float sampler's phase.
        let set = automation_curve(
            "channelHocket.accentRule.0.probabilityPercent",
            AutomationInterpolation::Linear,
            &[(0, 1, 0.0), (1, 1, 100.0)],
        );
        let samples = (0..4)
            .map(|beat| {
                set.sample_raw_number("channelHocket.accentRule.0.probabilityPercent", 0, beat, 4)
            })
            .collect::<Vec<_>>();
        assert_eq!(samples, vec![Some(0.0), Some(25.0), Some(50.0), Some(75.0)]);
    }

    #[test]
    fn sample_raw_number_none_without_matching_track() {
        let set = automation_curve(
            "channelHocket.accentRule.0.probabilityPercent",
            AutomationInterpolation::Linear,
            &[(0, 1, 0.0), (1, 1, 100.0)],
        );
        assert_eq!(
            set.sample_raw_number("channelHocket.matrix.0.weight", 0, 0, 4),
            None
        );
    }

    #[test]
    fn per_beat_post_score_predicate_lists_only_wired_targets() {
        // Channel hocket targets are wired through per-group playback sampling.
        assert!(automation_target_is_per_beat_post_score(
            "channelHocket.accentRule.0.probabilityPercent"
        ));
        assert!(automation_target_is_per_beat_post_score(
            "channelHocket.positionRule.pos.render.channel.3.weight"
        ));
        assert!(!automation_target_is_per_beat_post_score(
            "generator.seed.maxHistory"
        ));
        assert!(!automation_target_is_per_beat_post_score(
            "channelHocket.seed.maxHistory"
        ));
        // Score targets are handled by the typed preview path, not this predicate.
        assert!(!automation_target_is_per_beat_post_score("sequencer.pitch"));
    }

    #[test]
    fn automation_segment_curve_overrides_curve_interpolation() {
        let mut set = automation_curve(
            "sequencer.pitch",
            AutomationInterpolation::Linear,
            &[(0, 1, 0.0), (1, 1, 100.0)],
        );
        set.tracks[0].curves[0].points[0].out_curve = Some(AutomationSegmentCurve {
            kind: AutomationSegmentCurveKind::EaseIn,
            amount: 1.0,
        });

        let sampled = set.sample_number("sequencer.pitch", 0, 2, 4, 0.0).unwrap();
        assert!(sampled < 50.0);
    }

    #[test]
    fn automation_markers_roundtrip_with_exact_time() {
        let set = AutomationSet {
            length_cycles: 1,
            markers: vec![AutomationMarker {
                id: "arrival".to_string(),
                time: AutomationTime::new(73, 100).unwrap(),
                label: "Arrival".to_string(),
            }],
            tracks: Vec::new(),
        };

        let json = serde_json::to_string(&set).unwrap();
        let back: AutomationSet = serde_json::from_str(&json).unwrap();
        assert_eq!(back.markers, set.markers);
    }

    #[test]
    fn automation_marker_anchor_moves_curve_point_when_marker_moves() {
        let mut set = marker_anchor_curve_set(Some(AutomationTime::new(1, 2).unwrap()));

        assert_close(
            set.sample_raw_number_at_phase("sequencer.pitch", AutomationTime::new(1, 4).unwrap())
                .unwrap(),
            50.0,
        );
        assert_eq!(
            set.sample_raw_number_at_phase("sequencer.pitch", AutomationTime::new(1, 2).unwrap()),
            Some(100.0)
        );

        set.markers[0].time = AutomationTime::new(3, 4).unwrap();

        assert_close(
            set.sample_raw_number_at_phase("sequencer.pitch", AutomationTime::new(1, 2).unwrap())
                .unwrap(),
            200.0 / 3.0,
        );
        assert_eq!(
            set.sample_raw_number_at_phase("sequencer.pitch", AutomationTime::new(3, 4).unwrap()),
            Some(100.0)
        );
    }

    #[test]
    fn automation_marker_anchor_missing_falls_back_to_stored_time() {
        let set = marker_anchor_curve_set(None);

        assert_close(
            set.sample_raw_number_at_phase("sequencer.pitch", AutomationTime::new(1, 8).unwrap())
                .unwrap(),
            50.0,
        );
        assert_eq!(
            set.sample_raw_number_at_phase("sequencer.pitch", AutomationTime::new(1, 4).unwrap()),
            Some(100.0)
        );
    }

    #[test]
    fn automation_marker_anchor_roundtrips_and_evaluates_after_load() {
        let set = marker_anchor_curve_set(Some(AutomationTime::new(1, 2).unwrap()));

        let json = serde_json::to_string(&set).unwrap();
        let back: AutomationSet = serde_json::from_str(&json).unwrap();

        assert_eq!(back, set);
        assert_close(
            back.sample_raw_number_at_phase("sequencer.pitch", AutomationTime::new(1, 4).unwrap())
                .unwrap(),
            50.0,
        );
    }

    #[test]
    fn automation_track_graph_range_roundtrips() {
        let set = AutomationSet {
            length_cycles: 1,
            markers: Vec::new(),
            tracks: vec![AutomationTrack {
                id: "weight".to_string(),
                target: automation_target_initial_gati_weight(5),
                enabled: true,
                combine: AutomationCombineMode::Replace,
                graph_range: Some(AutomationGraphRange {
                    min: 1.0,
                    max: 20.0,
                }),
                curves: Vec::new(),
            }],
        };

        let json = serde_json::to_string(&set).unwrap();
        let back: AutomationSet = serde_json::from_str(&json).unwrap();
        assert_eq!(back.tracks[0].graph_range, set.tracks[0].graph_range);
    }

    #[test]
    fn automation_hold_samples_previous_point() {
        let set = automation_curve(
            "sequencer.velocity",
            AutomationInterpolation::Hold,
            &[(0, 1, 30.0), (1, 2, 90.0), (1, 1, 120.0)],
        );

        assert_eq!(
            set.sample_number("sequencer.velocity", 0, 1, 4, 96.0),
            Some(30.0)
        );
        assert_eq!(
            set.sample_number("sequencer.velocity", 0, 2, 4, 96.0),
            Some(90.0)
        );
    }

    #[test]
    fn automation_length_stretches_existing_points_exactly() {
        let mut set = automation_curve(
            "sequencer.pitch",
            AutomationInterpolation::Linear,
            &[(0, 1, 0.0), (1, 2, 100.0), (1, 1, 200.0)],
        );
        set.length_cycles = 2;

        assert_eq!(
            set.sample_number("sequencer.pitch", 1, 0, 4, 0.0),
            Some(100.0)
        );
    }

    #[test]
    fn automation_multiple_curves_replace_with_average() {
        let set = AutomationSet {
            length_cycles: 1,
            markers: Vec::new(),
            tracks: vec![AutomationTrack {
                id: "velocity".to_string(),
                target: "sequencer.velocity".to_string(),
                enabled: true,
                combine: AutomationCombineMode::Replace,
                graph_range: None,
                curves: vec![
                    AutomationCurve {
                        id: "a".to_string(),
                        enabled: true,
                        interpolation: AutomationInterpolation::Linear,
                        points: vec![AutomationPoint {
                            id: None,
                            time: AutomationTime::zero(),
                            value: AutomationValue::Number { value: 40.0 },
                            anchor_id: Some("shared-start".to_string()),
                            out_curve: None,
                        }],
                    },
                    AutomationCurve {
                        id: "b".to_string(),
                        enabled: true,
                        interpolation: AutomationInterpolation::Linear,
                        points: vec![AutomationPoint {
                            id: None,
                            time: AutomationTime::zero(),
                            value: AutomationValue::Number { value: 80.0 },
                            anchor_id: Some("shared-start".to_string()),
                            out_curve: None,
                        }],
                    },
                ],
            }],
        };

        assert_eq!(
            set.sample_number("sequencer.velocity", 0, 0, 8, 96.0),
            Some(60.0)
        );
    }

    #[test]
    fn automation_multiple_replace_tracks_average_across_tracks() {
        let mut set = automation_curve(
            "sequencer.velocity",
            AutomationInterpolation::Hold,
            &[(0, 1, 0.2)],
        );
        let mut second = automation_curve(
            "sequencer.velocity",
            AutomationInterpolation::Hold,
            &[(0, 1, 0.8)],
        )
        .tracks
        .remove(0);
        second.id = "second-velocity-track".to_string();
        set.tracks.push(second);

        assert_eq!(
            set.sample_number("sequencer.velocity", 0, 0, 8, 0.0),
            Some(0.5)
        );
    }

    #[test]
    fn automation_typed_sampling_quantizes_integer_targets() {
        let int_set = automation_curve(
            AUTOMATION_TARGET_PITCH,
            AutomationInterpolation::Linear,
            &[(0, 1, 60.2), (1, 1, 61.8)],
        );

        assert_eq!(
            int_set.sample_typed_number(
                AUTOMATION_TARGET_PITCH,
                0,
                1,
                4,
                60.0,
                AutomationValueKind::Integer,
                0.0,
                127.0
            ),
            Some(61.0)
        );
    }

    #[test]
    fn automation_sampling_drops_non_finite_combined_values() {
        let set = AutomationSet {
            length_cycles: 1,
            markers: Vec::new(),
            tracks: vec![AutomationTrack {
                id: "overflowing-track".to_string(),
                target: AUTOMATION_TARGET_VELOCITY.to_string(),
                enabled: true,
                combine: AutomationCombineMode::Replace,
                graph_range: None,
                curves: vec![
                    AutomationCurve {
                        id: "overflowing-curve".to_string(),
                        enabled: true,
                        interpolation: AutomationInterpolation::Hold,
                        points: vec![AutomationPoint {
                            id: Some("a".to_string()),
                            time: AutomationTime::zero(),
                            value: AutomationValue::Number { value: 1.0e308 },
                            anchor_id: None,
                            out_curve: None,
                        }],
                    },
                    AutomationCurve {
                        id: "also-overflowing-curve".to_string(),
                        enabled: true,
                        interpolation: AutomationInterpolation::Hold,
                        points: vec![AutomationPoint {
                            id: Some("b".to_string()),
                            time: AutomationTime::zero(),
                            value: AutomationValue::Number { value: 1.0e308 },
                            anchor_id: None,
                            out_curve: None,
                        }],
                    },
                ],
            }],
        };

        assert_eq!(
            set.sample_typed_number(
                AUTOMATION_TARGET_VELOCITY,
                0,
                0,
                4,
                96.0,
                AutomationValueKind::Integer,
                1.0,
                127.0,
            ),
            None
        );
    }

    /// Helper: build a test score with a subdivided root containing N equal children.
    fn make_subdivided_score(n: usize, pitches: &[u8]) -> Score {
        let cycle = Rational::new(1, 1);
        let accent_tree = AccentTree::single_accent(1.0);

        let mut nodes = HashMap::new();
        let mut children = Vec::new();
        let child_dur = Rational::new(1, n as i64);

        for (i, &pitch) in pitches.iter().enumerate() {
            let id = (i + 1) as NodeId;
            children.push(id);
            nodes.insert(
                id,
                DurationNode {
                    id,
                    parent: Some(0),
                    duration: child_dur,
                    accent_ref: Some(0),
                    kind: DurationKind::Pulse(PulseData {
                        event: PulseEvent::Note {
                            pitch: ValueSpec::fixed(pitch),
                            duration_frac: Rational::new(1, 1),
                        },
                        velocity: ValueSpec::fixed(100),
                    }),
                    metadata: NodeMetadata::default(),
                },
            );
        }

        nodes.insert(
            0,
            DurationNode {
                id: 0,
                parent: None,
                duration: cycle,
                accent_ref: None,
                kind: DurationKind::Subdivided {
                    children,
                    policy: SubdivisionPolicy::Equal,
                },
                metadata: NodeMetadata::default(),
            },
        );

        let duration_tree = DurationTree {
            root: 0,
            nodes,
            next_id: (pitches.len() + 1) as NodeId,
            pulse_spans: vec![],
            next_pulse_span_id: 0,
        };

        Score {
            id: "test".to_string(),
            name: "test".to_string(),
            duration_tree,
            accent_tree,
            cycle_length: cycle,
            default_gati: 4,
            default_jathi: 4,
            pipeline: vec![],
            next_transform_id: 0,
            metadata: ScoreMetadata::default(),
            schema_version: SCHEMA_VERSION,
        }
    }

    #[test]
    fn roundtrip_nested_tree() {
        let score = make_subdivided_score(4, &[60, 62, 64, 65]);
        let json = serde_json::to_string_pretty(&score).unwrap();
        let deserialized: Score = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.duration_tree.root, score.duration_tree.root);
        assert_eq!(
            deserialized.duration_tree.nodes.len(),
            score.duration_tree.nodes.len()
        );
        assert_eq!(deserialized.schema_version, SCHEMA_VERSION);

        // Verify a child node survived roundtrip.
        let child = deserialized.duration_tree.get(1).unwrap();
        assert_eq!(child.parent, Some(0));
        if let DurationKind::Pulse(pd) = &child.kind {
            assert_eq!(pd.velocity.as_fixed(), Some(&100));
        } else {
            panic!("expected Pulse");
        }
    }

    #[test]
    fn id_uniqueness() {
        let mut tree = DurationTree::single_pulse(Rational::new(1, 1));
        let mut ids = std::collections::HashSet::new();
        // The tree starts with next_id=1, root is id=0.
        ids.insert(0u64);
        for _ in 0..1000 {
            let id = tree.next_id();
            assert!(ids.insert(id), "duplicate ID: {id}");
        }
        assert_eq!(ids.len(), 1001);
    }

    #[test]
    fn walk_order_dfs() {
        // Tree:  0 (root, subdivided)
        //       / \
        //      1   2  (pulses)
        let score = make_subdivided_score(2, &[60, 62]);
        let mut visited = Vec::new();
        score.duration_tree.walk(|node, path| {
            visited.push((node.id, path.to_vec()));
        });
        assert_eq!(visited.len(), 3);
        assert_eq!(visited[0].0, 0); // root first
        assert_eq!(visited[0].1, vec![0]);
        assert_eq!(visited[1].0, 1); // left child
        assert_eq!(visited[1].1, vec![0, 1]);
        assert_eq!(visited[2].0, 2); // right child
        assert_eq!(visited[2].1, vec![0, 2]);
    }

    #[test]
    fn accent_ref_survives_removal() {
        let mut accent_tree = AccentTree::single_accent(0.8);
        // Add a second accent node.
        let child_id = 1;
        accent_tree.nodes.insert(
            child_id,
            AccentNode {
                id: child_id,
                parent: Some(0),
                kind: AccentKind::Accent {
                    strength: AccentStrength::Scalar(0.5),
                },
                label: None,
            },
        );

        // Duration node refs the child accent.
        let dur_node = DurationNode {
            id: 0,
            parent: None,
            duration: Rational::new(1, 1),
            accent_ref: Some(child_id),
            kind: DurationKind::Pulse(PulseData {
                event: PulseEvent::Note {
                    pitch: ValueSpec::fixed(60),
                    duration_frac: Rational::new(1, 1),
                },
                velocity: ValueSpec::fixed(100),
            }),
            metadata: NodeMetadata::default(),
        };

        // Remove the accent node.
        accent_tree.nodes.remove(&child_id);

        // accent_ref still holds the old ID, but lookup returns None.
        assert_eq!(dur_node.accent_ref, Some(child_id));
        assert!(accent_tree.get(child_id).is_none());
        // The duration node is otherwise intact.
        assert_eq!(dur_node.id, 0);
    }

    #[test]
    fn accent_strength_resolution() {
        // Root (0.8) -> Child (0.5) = 0.4
        let mut accent_tree = AccentTree::single_accent(0.8);
        let child_id = 1;
        accent_tree.nodes.insert(
            child_id,
            AccentNode {
                id: child_id,
                parent: Some(0),
                kind: AccentKind::Accent {
                    strength: AccentStrength::Scalar(0.5),
                },
                label: None,
            },
        );
        let strength = accent_tree.resolve_strength(child_id);
        assert!((strength - 0.4).abs() < 1e-6);
    }

    #[test]
    fn single_pulse_constructor() {
        let tree = DurationTree::single_pulse(Rational::new(1, 1));
        assert_eq!(tree.nodes.len(), 1);
        let root = tree.get(tree.root).unwrap();
        assert!(root.parent.is_none());
        assert_eq!(root.duration, Rational::new(1, 1));
    }

    #[test]
    fn empty_cycle_constructor() {
        let tree = DurationTree::empty_cycle(Rational::new(1, 1));
        let root = tree.get(tree.root).unwrap();
        if let DurationKind::Pulse(pd) = &root.kind {
            assert!(matches!(pd.event, PulseEvent::Rest));
        } else {
            panic!("expected Pulse(Rest)");
        }
    }

    #[test]
    fn valuespec_from_impl() {
        let vs: ValueSpec<u8> = 42u8.into();
        assert_eq!(vs.as_fixed(), Some(&42));
    }

    #[test]
    fn subdivided_constructor() {
        let score = Score::subdivided("test", &[60, 62, 64], 100, SubdivisionPolicy::Equal);
        assert_eq!(score.duration_tree.nodes.len(), 4); // root + 3 children
        assert_eq!(score.duration_tree.next_id, 4);

        // Root is subdivided.
        let root = score.duration_tree.get(0).unwrap();
        assert!(matches!(
            &root.kind,
            DurationKind::Subdivided {
                children,
                policy: SubdivisionPolicy::Equal,
            } if children.len() == 3
        ));

        // Children have correct pitches.
        for (i, expected_pitch) in [60u8, 62, 64].iter().enumerate() {
            let child = score.duration_tree.get((i + 1) as NodeId).unwrap();
            if let DurationKind::Pulse(pd) = &child.kind {
                assert_eq!(pd.velocity.as_fixed(), Some(&100));
                if let PulseEvent::Note { pitch, .. } = &pd.event {
                    assert_eq!(pitch.as_fixed(), Some(expected_pitch));
                } else {
                    panic!("expected Note");
                }
            } else {
                panic!("expected Pulse");
            }
        }
    }

    #[test]
    fn subdivided_constructor_weighted() {
        let score = Score::subdivided(
            "test",
            &[60, 62, 64],
            90,
            SubdivisionPolicy::Weighted(vec![2, 1, 2]),
        );
        let root = score.duration_tree.get(0).unwrap();
        assert!(matches!(
            &root.kind,
            DurationKind::Subdivided {
                policy: SubdivisionPolicy::Weighted(w),
                ..
            } if w == &vec![2, 1, 2]
        ));
    }

    #[test]
    fn subdivision_switch_constructor_captures_inflections() {
        let score = Score::subdivision_switch(
            "switch",
            SubdivisionSwitchSpec {
                cycle_beats: 3,
                initial_weights: vec![WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![
                    SubdivisionInflection {
                        id: None,
                        position: Rational::new(1, 3),
                        change_probability: 0.5,
                        subdivision_weights: vec![
                            WeightedSubdivisionChoice {
                                subdivision: 3,
                                weight: 1.0,
                            },
                            WeightedSubdivisionChoice {
                                subdivision: 5,
                                weight: 1.0,
                            },
                        ],
                        jathi_weights: vec![],
                        custom_subdivision: None,
                    },
                    SubdivisionInflection {
                        id: None,
                        position: Rational::new(2, 3),
                        change_probability: 1.0,
                        subdivision_weights: vec![WeightedSubdivisionChoice {
                            subdivision: 7,
                            weight: 1.0,
                        }],
                        jathi_weights: vec![],
                        custom_subdivision: None,
                    },
                ],
                switch_count_weights: vec![WeightedSwitchCount {
                    count: 1,
                    weight: 1.0,
                }],
                seed_mode: SwitchSeedMode::Locked { seed: 42 },
                accent: GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );

        assert_eq!(score.cycle_length, Rational::new(3, 1));
        assert_eq!(score.default_gati, 4);
        assert_eq!(score.default_jathi, 3);
        assert_eq!(score.pipeline.len(), 1);
        assert!(matches!(
            &score.pipeline[0].kind,
            TransformKind::SubdivisionSwitch {
                initial_weights,
                inflections,
                ..
            } if inflections.len() == 2 && initial_weights.len() == 1
        ));
    }

    #[test]
    #[should_panic(expected = "inflection positions must align to whole beat boundaries")]
    fn subdivision_switch_constructor_rejects_off_beat_boundary() {
        let _ = Score::subdivision_switch(
            "switch",
            SubdivisionSwitchSpec {
                cycle_beats: 4,
                initial_weights: vec![WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![SubdivisionInflection {
                    id: None,
                    position: Rational::new(1, 3),
                    change_probability: 1.0,
                    subdivision_weights: vec![WeightedSubdivisionChoice {
                        subdivision: 5,
                        weight: 1.0,
                    }],
                    jathi_weights: vec![],
                    custom_subdivision: None,
                }],
                switch_count_weights: vec![],
                seed_mode: SwitchSeedMode::Locked { seed: 42 },
                accent: GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );
    }

    #[test]
    #[should_panic(expected = "switch count weights need at least one positive weight")]
    fn subdivision_switch_constructor_rejects_zero_weight_cap() {
        let _ = Score::subdivision_switch(
            "switch",
            SubdivisionSwitchSpec {
                cycle_beats: 4,
                initial_weights: vec![WeightedSubdivisionChoice {
                    subdivision: 4,
                    weight: 1.0,
                }],
                initial_jathi_weights: vec![],
                initial_custom_subdivision: None,
                automation: None,
                inflections: vec![SubdivisionInflection {
                    id: None,
                    position: Rational::new(1, 2),
                    change_probability: 1.0,
                    subdivision_weights: vec![WeightedSubdivisionChoice {
                        subdivision: 5,
                        weight: 1.0,
                    }],
                    jathi_weights: vec![],
                    custom_subdivision: None,
                }],
                switch_count_weights: vec![WeightedSwitchCount {
                    count: 1,
                    weight: 0.0,
                }],
                seed_mode: SwitchSeedMode::Locked { seed: 42 },
                accent: GatiAccentSpec::default(),
                pitch: 60,
                velocity: 100,
            },
        );
    }

    fn custom_subdivision_example() -> CustomSubdivisionSpec {
        CustomSubdivisionSpec {
            per_beat_weight: 0.0,
            equal_parts_weight: 1.0,
            part_count_weights: vec![],
            part_gati_weights: vec![],
            divisions: vec![
                CustomDivision {
                    gati_weights: vec![WeightedSubdivisionChoice {
                        subdivision: 3,
                        weight: 1.0,
                    }],
                },
                CustomDivision {
                    gati_weights: vec![
                        WeightedSubdivisionChoice {
                            subdivision: 2,
                            weight: 1.0,
                        },
                        WeightedSubdivisionChoice {
                            subdivision: 5,
                            weight: 2.0,
                        },
                    ],
                },
            ],
            jathi_weights: vec![WeightedJathiChoice {
                jathi: 5,
                weight: 1.0,
            }],
        }
    }

    #[test]
    fn custom_subdivision_spec_roundtrips_through_serde() {
        let spec = custom_subdivision_example();
        let json = serde_json::to_string(&spec).expect("serialize");
        let back: CustomSubdivisionSpec = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.divisions.len(), 2);
        assert_eq!(back.divisions[0].gati_weights[0].subdivision, 3);
        assert_eq!(back.divisions[1].gati_weights.len(), 2);
        assert_eq!(back.jathi_weights[0].jathi, 5);
    }

    #[test]
    fn inflection_without_custom_subdivision_deserializes_to_none() {
        // A legacy inflection JSON (no `custom_subdivision` key) must load with
        // the field defaulting to None — back-compat for existing patches.
        let json = r#"{
            "position": { "numer": 1, "denom": 2 },
            "change_probability": 1.0,
            "subdivision_weights": [{ "subdivision": 4, "weight": 1.0 }]
        }"#;
        let inflection: SubdivisionInflection = serde_json::from_str(json).expect("deserialize");
        assert!(inflection.custom_subdivision.is_none());
        assert!(inflection.jathi_weights.is_empty());
    }

    #[test]
    fn inflection_with_custom_subdivision_roundtrips() {
        let inflection = SubdivisionInflection {
            id: Some("b1".to_string()),
            position: Rational::new(1, 2),
            change_probability: 1.0,
            subdivision_weights: vec![WeightedSubdivisionChoice {
                subdivision: 4,
                weight: 1.0,
            }],
            jathi_weights: vec![],
            custom_subdivision: Some(custom_subdivision_example()),
        };
        let json = serde_json::to_string(&inflection).expect("serialize");
        assert!(json.contains("custom_subdivision"));
        let back: SubdivisionInflection = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.custom_subdivision.expect("present").divisions.len(), 2);
    }

    #[test]
    fn custom_subdivision_validation_accepts_well_formed() {
        assert!(custom_subdivision_example().validate().is_ok());
    }

    #[test]
    fn custom_subdivision_validation_rejects_no_divisions() {
        let spec = CustomSubdivisionSpec {
            per_beat_weight: 0.0,
            equal_parts_weight: 1.0,
            part_count_weights: vec![],
            part_gati_weights: vec![],
            divisions: vec![],
            jathi_weights: vec![],
        };
        assert!(spec.validate().is_err());
    }

    #[test]
    fn custom_subdivision_validation_rejects_division_without_positive_gati() {
        let spec = CustomSubdivisionSpec {
            per_beat_weight: 0.0,
            equal_parts_weight: 1.0,
            part_count_weights: vec![],
            part_gati_weights: vec![],
            divisions: vec![CustomDivision {
                gati_weights: vec![WeightedSubdivisionChoice {
                    subdivision: 3,
                    weight: 0.0,
                }],
            }],
            jathi_weights: vec![],
        };
        assert!(spec.validate().is_err());
    }

    #[test]
    fn custom_subdivision_validation_ignores_legacy_jathi_weights() {
        let spec = CustomSubdivisionSpec {
            per_beat_weight: 0.0,
            equal_parts_weight: 1.0,
            part_count_weights: vec![],
            part_gati_weights: vec![],
            divisions: vec![CustomDivision {
                gati_weights: vec![WeightedSubdivisionChoice {
                    subdivision: 3,
                    weight: 1.0,
                }],
            }],
            // Legacy field is inert; regular section jathi weights are the
            // source of truth for both uniform and equal-parts sections.
            jathi_weights: vec![WeightedJathiChoice {
                jathi: 8,
                weight: 1.0,
            }],
        };
        assert!(spec.validate().is_ok());
    }

    #[test]
    fn custom_subdivision_validation_rejects_duplicate_part_counts() {
        let spec = CustomSubdivisionSpec {
            per_beat_weight: 0.0,
            equal_parts_weight: 1.0,
            part_count_weights: vec![
                WeightedCustomPartCount {
                    count: 5,
                    weight: 1.0,
                },
                WeightedCustomPartCount {
                    count: 5,
                    weight: 2.0,
                },
            ],
            part_gati_weights: vec![WeightedSubdivisionChoice {
                subdivision: 3,
                weight: 1.0,
            }],
            divisions: vec![],
            jathi_weights: vec![],
        };
        assert!(spec.validate().is_err());
    }

    #[test]
    fn protected_cuts_capture_regular_jathi_boundaries_inside_gati_beats() {
        let spans = vec![
            PulseSpan {
                id: 0,
                kind: PulseSpanKind::Section { index: 1 },
                start: Rational::new(0, 1),
                duration: Rational::new(3, 1),
                start_matra: 0,
                matra_len: 12,
                tags: vec![],
            },
            PulseSpan {
                id: 1,
                kind: PulseSpanKind::GatiBeat {
                    section_index: 1,
                    beat: 1,
                    gati: 4,
                },
                start: Rational::new(0, 1),
                duration: Rational::new(1, 1),
                start_matra: 0,
                matra_len: 4,
                tags: vec![],
            },
            PulseSpan {
                id: 2,
                kind: PulseSpanKind::GatiBeat {
                    section_index: 1,
                    beat: 2,
                    gati: 4,
                },
                start: Rational::new(1, 1),
                duration: Rational::new(1, 1),
                start_matra: 4,
                matra_len: 4,
                tags: vec![],
            },
            PulseSpan {
                id: 3,
                kind: PulseSpanKind::GatiBeat {
                    section_index: 1,
                    beat: 3,
                    gati: 4,
                },
                start: Rational::new(2, 1),
                duration: Rational::new(1, 1),
                start_matra: 8,
                matra_len: 4,
                tags: vec![],
            },
            PulseSpan {
                id: 4,
                kind: PulseSpanKind::JathiPulse {
                    section_index: 1,
                    jathi: 3,
                    index: 1,
                },
                start: Rational::new(0, 1),
                duration: Rational::new(3, 4),
                start_matra: 0,
                matra_len: 3,
                tags: vec![],
            },
            PulseSpan {
                id: 5,
                kind: PulseSpanKind::JathiPulse {
                    section_index: 1,
                    jathi: 3,
                    index: 2,
                },
                start: Rational::new(3, 4),
                duration: Rational::new(3, 4),
                start_matra: 3,
                matra_len: 3,
                tags: vec![],
            },
            PulseSpan {
                id: 6,
                kind: PulseSpanKind::JathiPulse {
                    section_index: 1,
                    jathi: 3,
                    index: 3,
                },
                start: Rational::new(3, 2),
                duration: Rational::new(3, 4),
                start_matra: 6,
                matra_len: 3,
                tags: vec![],
            },
            PulseSpan {
                id: 7,
                kind: PulseSpanKind::JathiPulse {
                    section_index: 1,
                    jathi: 3,
                    index: 4,
                },
                start: Rational::new(9, 4),
                duration: Rational::new(3, 4),
                start_matra: 9,
                matra_len: 3,
                tags: vec![],
            },
        ];

        assert_eq!(protected_cuts_for_span(&spans[1], &spans), vec![3]);
        assert_eq!(protected_cuts_for_span(&spans[2], &spans), vec![2]);
        assert_eq!(protected_cuts_for_span(&spans[3], &spans), vec![1]);
        assert_eq!(
            protected_cuts_for_span(&spans[4], &spans),
            Vec::<u32>::new()
        );
    }

    #[test]
    fn rhythm_accent_spans_prefer_jathi_with_gati_fallback_per_section() {
        let spans = vec![
            PulseSpan {
                id: 0,
                kind: PulseSpanKind::Section { index: 1 },
                start: Rational::new(0, 1),
                duration: Rational::new(2, 1),
                start_matra: 0,
                matra_len: 8,
                tags: vec![],
            },
            PulseSpan {
                id: 1,
                kind: PulseSpanKind::GatiBeat {
                    section_index: 1,
                    beat: 1,
                    gati: 4,
                },
                start: Rational::new(0, 1),
                duration: Rational::new(1, 1),
                start_matra: 0,
                matra_len: 4,
                tags: vec![],
            },
            PulseSpan {
                id: 2,
                kind: PulseSpanKind::GatiBeat {
                    section_index: 1,
                    beat: 2,
                    gati: 4,
                },
                start: Rational::new(1, 1),
                duration: Rational::new(1, 1),
                start_matra: 4,
                matra_len: 4,
                tags: vec![],
            },
            PulseSpan {
                id: 3,
                kind: PulseSpanKind::JathiPulse {
                    section_index: 1,
                    jathi: 4,
                    index: 1,
                },
                start: Rational::new(0, 1),
                duration: Rational::new(1, 1),
                start_matra: 0,
                matra_len: 4,
                tags: vec![],
            },
            PulseSpan {
                id: 4,
                kind: PulseSpanKind::JathiPulse {
                    section_index: 1,
                    jathi: 4,
                    index: 2,
                },
                start: Rational::new(1, 1),
                duration: Rational::new(1, 1),
                start_matra: 4,
                matra_len: 4,
                tags: vec![],
            },
            PulseSpan {
                id: 5,
                kind: PulseSpanKind::Section { index: 2 },
                start: Rational::new(2, 1),
                duration: Rational::new(1, 1),
                start_matra: 0,
                matra_len: 5,
                tags: vec![],
            },
            PulseSpan {
                id: 6,
                kind: PulseSpanKind::GatiBeat {
                    section_index: 2,
                    beat: 3,
                    gati: 5,
                },
                start: Rational::new(2, 1),
                duration: Rational::new(1, 1),
                start_matra: 0,
                matra_len: 5,
                tags: vec![],
            },
        ];

        let active_ids = rhythm_accent_spans(&spans)
            .iter()
            .map(|span| span.id)
            .collect::<Vec<_>>();

        assert_eq!(active_ids, vec![3, 4, 6]);
    }

    #[test]
    fn rhythm_protected_cuts_ignore_inactive_gati_boundaries_inside_jathi_spans() {
        let spans = vec![
            PulseSpan {
                id: 1,
                kind: PulseSpanKind::GatiBeat {
                    section_index: 1,
                    beat: 1,
                    gati: 4,
                },
                start: Rational::new(0, 1),
                duration: Rational::new(1, 1),
                start_matra: 0,
                matra_len: 4,
                tags: vec![],
            },
            PulseSpan {
                id: 2,
                kind: PulseSpanKind::GatiBeat {
                    section_index: 1,
                    beat: 2,
                    gati: 4,
                },
                start: Rational::new(1, 1),
                duration: Rational::new(1, 1),
                start_matra: 4,
                matra_len: 4,
                tags: vec![],
            },
            PulseSpan {
                id: 3,
                kind: PulseSpanKind::JathiPulse {
                    section_index: 1,
                    jathi: 3,
                    index: 2,
                },
                start: Rational::new(3, 4),
                duration: Rational::new(3, 4),
                start_matra: 3,
                matra_len: 3,
                tags: vec![],
            },
        ];

        assert_eq!(protected_cuts_for_span(&spans[2], &spans), vec![1]);
        assert_eq!(
            rhythm_protected_cuts_for_span(&spans[2], &spans),
            Vec::<u32>::new()
        );
    }

    #[test]
    fn rational_serde_roundtrip() {
        let r = Rational::new(3, 8);
        // Test via a DurationNode that uses rational_serde.
        let node = DurationNode {
            id: 0,
            parent: None,
            duration: r,
            accent_ref: None,
            kind: DurationKind::Pulse(PulseData {
                event: PulseEvent::Rest,
                velocity: ValueSpec::fixed(0),
            }),
            metadata: NodeMetadata::default(),
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("\"numer\":3"));
        assert!(json.contains("\"denom\":8"));
        let back: DurationNode = serde_json::from_str(&json).unwrap();
        assert_eq!(back.duration, r);
    }

    #[test]
    fn add_transform_increments_id() {
        let mut score = Score::single_pulse("test", 60, 100);
        let id0 = score.add_transform(TransformKind::RemoveNode, NodeSelector::Root, None);
        let id1 = score.add_transform(TransformKind::RemoveNode, NodeSelector::Root, None);
        assert_eq!(id0, 0);
        assert_eq!(id1, 1);
        assert_eq!(score.next_transform_id, 2);
    }

    #[test]
    fn remove_transform() {
        let mut score = Score::single_pulse("test", 60, 100);
        let id = score.add_transform(TransformKind::RemoveNode, NodeSelector::Root, None);
        assert_eq!(score.pipeline.len(), 1);
        assert!(score.remove_transform(id));
        assert!(score.pipeline.is_empty());
        assert!(!score.remove_transform(id)); // already removed
    }

    mod prop_tests {
        use super::*;
        use proptest::prelude::*;
        use proptest::test_runner::TestCaseResult;
        use std::cmp::Ordering;

        const CASES: u32 = 128;

        #[derive(Debug, Clone)]
        struct PulseSpanCase {
            beats: u32,
            gati: u32,
            jathi: Option<u32>,
        }

        proptest! {
            #![proptest_config(ProptestConfig {
                cases: CASES,
                max_shrink_iters: 2048,
                ..ProptestConfig::default()
            })]

            #[test]
            fn automation_time_normalizes_and_compares_exactly(
                numer in 0_u64..=1_000_000,
                denom in 1_u64..=1_000_000,
            ) {
                let time = AutomationTime::new(numer, denom).expect("non-zero denominator");

                prop_assert!(time.denom > 0);
                prop_assert!(time.numer <= time.denom);
                prop_assert_eq!(gcd_u64(time.numer, time.denom), 1);
                prop_assert!((0.0..=1.0).contains(&time.to_unit_f64()));

                let capped = numer.min(denom);
                let divisor = gcd_u64(capped, denom).max(1);
                prop_assert_eq!(time.numer, capped / divisor);
                prop_assert_eq!(time.denom, denom / divisor);
            }

            #[test]
            fn automation_time_cmp_exact_matches_cross_multiplication(
                left_numer in 0_u64..=1_000_000,
                left_denom in 1_u64..=1_000_000,
                right_numer in 0_u64..=1_000_000,
                right_denom in 1_u64..=1_000_000,
            ) {
                let left = AutomationTime::new(left_numer, left_denom).unwrap();
                let right = AutomationTime::new(right_numer, right_denom).unwrap();
                let expected = ((left.numer as u128) * (right.denom as u128))
                    .cmp(&((right.numer as u128) * (left.denom as u128)));

                prop_assert_eq!(left.cmp_exact(&right), expected);
                prop_assert_eq!(right.cmp_exact(&left), expected.reverse());
                if expected == Ordering::Equal {
                    prop_assert_eq!(left.to_unit_f64(), right.to_unit_f64());
                }
            }

            #[test]
            fn automation_time_from_valid_beat_is_exact_phase(
                cycle in 0_u64..=64,
                length_cycles in 1_u32..=16,
                cycle_beats in 1_u32..=32,
                beat_seed in any::<u32>(),
            ) {
                let beat_index = beat_seed % cycle_beats;
                let time = AutomationTime::from_beat(cycle, beat_index, cycle_beats, length_cycles);
                let total_beats = u64::from(length_cycles) * u64::from(cycle_beats);
                let expected_beat = (cycle % u64::from(length_cycles)) * u64::from(cycle_beats)
                    + u64::from(beat_index);
                let expected = AutomationTime::new(expected_beat, total_beats).unwrap();

                prop_assert_eq!(time, expected);
            }

            #[test]
            fn active_rhythm_spans_and_protected_cuts_track_accent_layer(case in pulse_span_case()) {
                let spans = case.spans();
                let active = rhythm_accent_spans(&spans);

                if let Some(jathi) = case.jathi {
                    let expected_count = (case.beats * case.gati) / jathi;
                    prop_assert_eq!(active.len(), expected_count as usize);
                    let all_jathi = active
                        .iter()
                        .all(|span| matches!(span.kind, PulseSpanKind::JathiPulse { .. }));
                    prop_assert!(all_jathi);
                } else {
                    prop_assert_eq!(active.len(), case.beats as usize);
                    let all_gati = active
                        .iter()
                        .all(|span| matches!(span.kind, PulseSpanKind::GatiBeat { .. }));
                    prop_assert!(all_gati);
                }

                for span in &active {
                    let cuts = rhythm_protected_cuts_for_span(span, &spans);
                    assert_sorted_unique_cuts(&cuts, span.matra_len)?;
                    if case.jathi.is_some() {
                        prop_assert!(
                            cuts.is_empty(),
                            "inactive gati boundaries must not split active jathi spans"
                        );
                    }
                }

                if let Some(jathi) = case.jathi {
                    for span in spans.iter().filter(|span| matches!(span.kind, PulseSpanKind::GatiBeat { .. })) {
                        let cuts = protected_cuts_for_span(span, &spans);
                        let expected = expected_jathi_cuts_inside_gati_span(span.start_matra, span.matra_len, jathi);
                        prop_assert_eq!(cuts, expected);
                    }
                }
            }
        }

        fn pulse_span_case() -> impl Strategy<Value = PulseSpanCase> {
            (
                1_u32..=8,
                prop_oneof![
                    Just(3_u32),
                    Just(4_u32),
                    Just(5_u32),
                    Just(7_u32),
                    Just(8_u32),
                    Just(9_u32),
                    Just(11_u32),
                    Just(16_u32),
                ],
                any::<bool>(),
                any::<usize>(),
            )
                .prop_map(|(beats, gati, with_jathi, jathi_seed)| {
                    let total_matras = beats * gati;
                    let divisors = (1..=total_matras)
                        .filter(|candidate| total_matras % *candidate == 0)
                        .collect::<Vec<_>>();
                    let jathi = with_jathi.then(|| divisors[jathi_seed % divisors.len()]);
                    PulseSpanCase { beats, gati, jathi }
                })
        }

        impl PulseSpanCase {
            fn spans(&self) -> Vec<PulseSpan> {
                let mut spans = vec![PulseSpan {
                    id: 1,
                    kind: PulseSpanKind::Section { index: 1 },
                    start: Rational::new(0, 1),
                    duration: Rational::from_integer(self.beats as i64),
                    start_matra: 0,
                    matra_len: self.beats * self.gati,
                    tags: vec![],
                }];
                let mut next_id = 2;
                for beat in 0..self.beats {
                    spans.push(PulseSpan {
                        id: next_id,
                        kind: PulseSpanKind::GatiBeat {
                            section_index: 1,
                            beat: beat + 1,
                            gati: self.gati,
                        },
                        start: Rational::from_integer(beat as i64),
                        duration: Rational::new(1, 1),
                        start_matra: beat * self.gati,
                        matra_len: self.gati,
                        tags: vec![],
                    });
                    next_id += 1;
                }
                if let Some(jathi) = self.jathi {
                    let total_matras = self.beats * self.gati;
                    for (index, start_matra) in
                        (0..total_matras).step_by(jathi as usize).enumerate()
                    {
                        spans.push(PulseSpan {
                            id: next_id,
                            kind: PulseSpanKind::JathiPulse {
                                section_index: 1,
                                jathi,
                                index: index as u32,
                            },
                            start: Rational::new(start_matra as i64, self.gati as i64),
                            duration: Rational::new(jathi as i64, self.gati as i64),
                            start_matra,
                            matra_len: jathi,
                            tags: vec![],
                        });
                        next_id += 1;
                    }
                }
                spans
            }
        }

        fn expected_jathi_cuts_inside_gati_span(
            span_start_matra: u32,
            span_matra_len: u32,
            jathi: u32,
        ) -> Vec<u32> {
            (1..span_matra_len)
                .filter(|relative_cut| (span_start_matra + *relative_cut) % jathi == 0)
                .collect()
        }

        fn assert_sorted_unique_cuts(cuts: &[u32], span_len: u32) -> TestCaseResult {
            for cut in cuts {
                prop_assert!((1..span_len).contains(cut));
            }
            for window in cuts.windows(2) {
                prop_assert!(window[0] < window[1]);
            }
            Ok(())
        }
    }
}
