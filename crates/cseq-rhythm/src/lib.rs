//! Markov rhythm engine for filling protected accent spans.
//!
//! Gati and jathi create protected pulse spans. This crate does not decide
//! those spans; it chooses a rhythmic grouping pattern that tiles each span
//! exactly, with explicit paired ties when a sounding event crosses a seam.

use std::collections::HashMap;

use cseq_model::PulseSpanId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod generators;
pub use generators::dumka::reshape::EuclidRestPolicy;
pub use generators::{
    evolution_state, perceptual_distance, resolve_generator_cycle,
    resolve_generator_cycle_with_trace, resolve_generator_seed, resolve_generator_seed_at_cycle,
    BeatRange, CycleGenerator, DensityCorridorRange, DirectiveFamily, DirectiveMagnitude,
    DirectiveOptions, DirectivePacing, DirectiveSkip, DirectiveTraceEntry, DumkaGeneratorParams,
    EvolutionDirective, EvolutionState, EvolvedOnset, ExampleGeneratorParams, GeneratedCell,
    GeneratedSpan, GeneratorConfig, GeneratorCycleContext, GeneratorCycleResolution,
    GeneratorError, GeneratorSeedMode, GeneratorSeedResolution, GeneratorSeedSource,
    GeneratorSpanInput, PerceptualBreakdown, PerceptualContext, PerceptualDistance,
    PerceptualError, PerceptualModel, PerceptualModelVersion, PerceptualPacingTrace,
    PerceptualWeights, RotateDirection, DEFAULT_DUMKA_PATTERN, LEGACY_EVOLUTION_TRACE_ID,
    MAX_EVOLUTION_DIRECTIVES, MAX_PERCEPTUAL_DISTANCE_MILLI, MAX_PERCEPTUAL_OPERATIONS,
    MAX_PERCEPTUAL_SCORING_WORK, PERCEPTUAL_DISTANCE_MAX_MILLI,
};

const fn one_u32() -> u32 {
    1
}

const fn one_f32() -> f32 {
    1.0
}

const fn true_bool() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MarkovOrder {
    First,
    Second,
}

impl MarkovOrder {
    fn context_len(self) -> usize {
        match self {
            Self::First => 1,
            Self::Second => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTransition {
    /// Previous MIDI channels in user-facing 1-16 form. First-order chains use
    /// one previous channel; second-order chains use two.
    pub from: Vec<u8>,
    /// Destination MIDI channel in user-facing 1-16 form.
    pub to: u8,
    /// Relative integer weight. Zero means impossible.
    pub weight: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelFallbackWeight {
    /// Fallback MIDI channel in user-facing 1-16 form.
    pub channel: u8,
    /// Relative integer weight used only when the chain falls back.
    pub weight: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEntryWeight {
    /// Ordered startup channel tuple in user-facing 1-16 form. First-order
    /// chains use one channel; second-order chains use two.
    pub channels: Vec<u8>,
    /// Relative integer weight used only when a new chain context starts.
    pub weight: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelAccentRoutingMode {
    /// Assign the audible MIDI event to the accent channel without changing the
    /// Markov chain's remembered state.
    RenderOnly,
    /// Assign the event to the accent channel and make the Markov chain continue
    /// as though that channel was chosen by the chain.
    DriveChain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAccentWeight {
    /// Favored MIDI channel in user-facing 1-16 form.
    pub channel: u8,
    /// Relative integer weight. Zero means impossible.
    pub weight: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAccentRule {
    /// Inclusive MIDI velocity range that identifies this accent band.
    pub min_velocity: u8,
    pub max_velocity: u8,
    #[serde(default = "one_f32")]
    pub probability: f32,
    pub mode: ChannelAccentRoutingMode,
    #[serde(default)]
    pub weights: Vec<ChannelAccentWeight>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelPositionScope {
    Beat,
    Section,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelPositionAction {
    /// Leave the channel Markov chain completely unmodulated for this note.
    NormalMarkov,
    /// Advance the chain normally, then replace only the rendered MIDI channel.
    RenderOnly,
    /// Replace the channel Markov history with the selected reset channel.
    ResetMarkov,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelPositionResetMode {
    StaticFallback,
    WeightedFallback,
    CustomWeighted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPositionActionWeights {
    pub normal_markov: u32,
    pub render_only: u32,
    pub reset_markov: u32,
}

impl Default for ChannelPositionActionWeights {
    fn default() -> Self {
        Self {
            normal_markov: 0,
            render_only: 1,
            reset_markov: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPositionResetSpec {
    pub mode: ChannelPositionResetMode,
    #[serde(default)]
    pub weights: Vec<ChannelAccentWeight>,
}

impl Default for ChannelPositionResetSpec {
    fn default() -> Self {
        Self {
            mode: ChannelPositionResetMode::StaticFallback,
            weights: vec![],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPositionRule {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default = "true_bool")]
    pub enabled: bool,
    pub scope: ChannelPositionScope,
    #[serde(default = "one_u32")]
    pub nth: u32,
    #[serde(default)]
    pub action_weights: ChannelPositionActionWeights,
    #[serde(default)]
    pub render_weights: Vec<ChannelAccentWeight>,
    #[serde(default)]
    pub reset: ChannelPositionResetSpec,
}

/// Which engine drives per-note channel choices. `Markov` walks the
/// transition matrix; `Euclid` reads a deterministic Bjorklund pattern and
/// leaves the matrix fields dormant (they stay authored and validated so
/// switching strategies never invalidates a spec).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelAssignMode {
    #[default]
    Markov,
    Euclid,
}

/// How Euclid layers share the timeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EuclidPlacement {
    /// Layers claim slots of one shared length-`steps` cycle by iterated
    /// Bjorklund over the slots earlier layers left behind — exact per-layer
    /// quotas, remainder slots fall to the static fallback channel.
    #[default]
    Partition,
    /// Every layer runs its own mask of its own length (polymeter); the
    /// first layer in priority order whose mask is on wins, otherwise the
    /// slot falls back. Quotas are approximate (higher layers shadow).
    Stack,
}

/// When the Euclid step index re-anchors to slot zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EuclidResetScope {
    /// Re-anchor at each tala-cycle start; the pattern runs freely across
    /// section boundaries ("no reset per section").
    #[default]
    Cycle,
    /// Re-anchor at every section boundary.
    Section,
    /// Re-anchor at every beat.
    Beat,
    /// Re-anchor at every grouping frame or beat in subdivision-only sections:
    /// each span replays the pattern head.
    AccentSpan,
}

/// Whether the note starting each accent span participates in the Euclid
/// structure. In multi-channel hocketing the channel is the timbre, and
/// accent is often perceived as a timbral change — so span accents can be
/// claimed by the pattern or deliberately kept outside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EuclidSpanAccentMode {
    /// Span accents are ordinary pattern steps.
    #[default]
    Woven,
    /// Span accents render the anchor channel, consume no step, and the
    /// pattern compacts across them (the interior weave is accent-invariant).
    Bypass,
}

/// One priority-ordered voice of the Euclid channel strategy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EuclidChannelLayer {
    /// Output MIDI channel in user-facing 1-16 form. Must be an enabled
    /// palette channel and unique across layers.
    pub channel: u8,
    /// Onset count `k` of this layer's Bjorklund pattern. Zero = inert.
    pub pulses: u32,
    /// Rotates this layer's final mask later within its domain.
    #[serde(default)]
    pub rotation: u32,
    /// Maximum burst run length (moinsound 2022). 1 = classic Euclid.
    #[serde(default = "default_euclid_max_run")]
    pub max_run: u32,
    /// Stack placement only: this layer's own pattern length `n`. Partition
    /// placement uses the spec-level `steps` instead.
    #[serde(default = "default_euclid_steps")]
    pub steps: u32,
    /// Stack placement only: flip the mask (claim the rests).
    #[serde(default)]
    pub invert: bool,
}

fn default_euclid_max_run() -> u32 {
    1
}

fn default_euclid_steps() -> u32 {
    16
}

/// Deterministic multi-state Bjorklund channel assignment (the Euclid arm of
/// `ChannelAssignMode`). See `EuclidAssigner` for the runtime semantics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EuclidChannelSpec {
    #[serde(default)]
    pub placement: EuclidPlacement,
    /// Partition placement: the shared pattern length `n`, 1..=64.
    #[serde(default = "default_euclid_steps")]
    pub steps: u32,
    /// Priority-ordered layers; first is highest priority.
    #[serde(default)]
    pub layers: Vec<EuclidChannelLayer>,
    #[serde(default)]
    pub reset: EuclidResetScope,
    #[serde(default)]
    pub span_accent_mode: EuclidSpanAccentMode,
    /// Bypass anchor channel in user-facing 1-16 form; `None` uses the
    /// spec-level static `fallback`.
    #[serde(default)]
    pub span_accent_channel: Option<u8>,
}

impl Default for EuclidChannelSpec {
    fn default() -> Self {
        Self {
            placement: EuclidPlacement::Partition,
            steps: default_euclid_steps(),
            layers: Vec::new(),
            reset: EuclidResetScope::Cycle,
            span_accent_mode: EuclidSpanAccentMode::Woven,
            span_accent_channel: None,
        }
    }
}

pub const EUCLID_MAX_STEPS: u32 = 64;
pub const EUCLID_MAX_LAYERS: usize = 16;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelHocketSpec {
    pub order: MarkovOrder,
    /// Enabled MIDI channels in user-facing 1-16 form.
    pub channels: Vec<u8>,
    #[serde(default)]
    pub transitions: Vec<ChannelTransition>,
    /// Static fallback MIDI channel in user-facing 1-16 form.
    pub fallback: u8,
    #[serde(default)]
    pub fallback_weights: Vec<ChannelFallbackWeight>,
    #[serde(default)]
    pub entry_weights: Vec<ChannelEntryWeight>,
    pub seed_mode: RhythmSeedMode,
    pub global_seed: u64,
    #[serde(default)]
    pub accent_rules: Vec<ChannelAccentRule>,
    #[serde(default)]
    pub position_rules: Vec<ChannelPositionRule>,
    /// Which assignment strategy is active. Additive: specs serialized
    /// before this field existed deserialize as `Markov`.
    #[serde(default)]
    pub assign_mode: ChannelAssignMode,
    /// Euclid strategy configuration. Required when `assign_mode` is
    /// `Euclid`; dormant otherwise.
    #[serde(default)]
    pub euclid: Option<EuclidChannelSpec>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedChannelChoice {
    pub index: u32,
    /// MIDI channel in user-facing 1-16 form.
    pub channel: u8,
    pub source: RhythmChoiceSource,
    pub fallback_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelHocketResolution {
    pub seed: RhythmSeedResolution,
    pub choices: Vec<ResolvedChannelChoice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRhythmCell {
    pub index: u32,
    pub start: u32,
    pub len: u32,
    pub rest: bool,
    pub tied_from_previous: bool,
    pub tied_to_next: bool,
    /// Authored-leaf velocity behind this cell (beat/section/grouping accents
    /// included), inherited from the leaf at/before the cell start exactly the
    /// way transport realization does. Generators must leave this `None` and
    /// never read it: it is display metadata backfilled by the realization and
    /// preview seams, not generation identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub velocity: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RhythmSeedMode {
    /// Use the seed already resolved by the global gati/jathi layer.
    FollowGlobal,
    /// Same rhythm seed every cycle, independent from gati/jathi seed mode.
    Locked { seed: u64 },
    /// Mix a rhythm-local seed with the cycle number.
    PerCycle { seed: u64 },
    /// Choose an old rhythm seed or generate and remember a new one.
    History {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RhythmSeedSource {
    FollowGlobal,
    Locked,
    PerCycle,
    History,
    New,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RhythmSeedResolution {
    #[serde(with = "cseq_model::lossless_u64_serde")]
    pub seed: u64,
    pub source: RhythmSeedSource,
    #[serde(with = "cseq_model::lossless_u64_vec_serde")]
    pub history: Vec<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RhythmChoiceSource {
    Initial,
    Transition,
    Fallback,
    Accent,
    Position,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRhythmSpan {
    pub span_id: PulseSpanId,
    pub span_len: u32,
    #[serde(default)]
    pub cells: Vec<ResolvedRhythmCell>,
}

#[derive(Debug, Error)]
pub enum RhythmError {
    #[error("rhythm seed history mode has no positive history or new seed weight")]
    EmptySeedWeights,
}

#[derive(Debug, Error)]
pub enum ChannelHocketError {
    #[error("channel hocket spec must enable at least one MIDI channel")]
    EmptyChannels,

    #[error("channel hocket spec contains duplicate MIDI channel {0}")]
    DuplicateChannel(u8),

    #[error("MIDI channel {0} is outside the user-facing 1-16 range")]
    ChannelOutOfRange(u8),

    #[error("MIDI channel {0} is not enabled in the channel hocket spec")]
    ChannelNotEnabled(u8),

    #[error(
        "channel hocket transition context length {actual} does not match expected {expected}"
    )]
    InvalidContextLength { actual: usize, expected: usize },

    #[error("channel hocket entry selector length {actual} does not match expected {expected}")]
    InvalidEntryLength { actual: usize, expected: usize },

    #[error("channel hocket entry selector references invalid channel {0}")]
    InvalidEntryChannel(u8),

    #[error("channel hocket probability {0} must be between 0 and 1")]
    InvalidProbability(f32),

    #[error("channel accent velocity range {min}..{max} is invalid")]
    InvalidAccentVelocityRange { min: u8, max: u8 },

    #[error("channel position nth must be greater than zero")]
    InvalidPositionNth,

    #[error("euclid assignment mode requires a euclid spec")]
    MissingEuclidSpec,

    #[error("euclid steps {0} is outside the 1-{max} range", max = EUCLID_MAX_STEPS)]
    InvalidEuclidSteps(u32),

    #[error("euclid layer count {0} exceeds the {max}-layer maximum", max = EUCLID_MAX_LAYERS)]
    TooManyEuclidLayers(usize),

    #[error("euclid layers repeat MIDI channel {0}")]
    DuplicateEuclidLayerChannel(u8),

    #[error("euclid partition pulses total {total} exceeds steps {steps}")]
    EuclidPulsesExceedSteps { total: u32, steps: u32 },

    #[error("euclid layer max run must be at least 1")]
    InvalidEuclidMaxRun,

    #[error("seed resolution failed: {0}")]
    Seed(#[from] RhythmError),
}

/// E(pulses, steps) in the canonical head-anchored form (`(i·k) mod n < k`),
/// matching the ER-102 manual's published vectors — E(3,8) = 10010010,
/// E(5,12) = 100101001010. `rotate` shifts the mask later; `invert` flips
/// membership.
pub fn euclidean_mask(pulses: u32, steps: u32, rotate: u32, invert: bool) -> Vec<bool> {
    if steps == 0 {
        return Vec::new();
    }
    let k = u64::from(pulses.min(steps));
    let n = u64::from(steps);
    let mut mask: Vec<bool> = (0..n).map(|i| (i * k) % n < k).collect();
    let rot = (rotate as usize) % (steps as usize);
    mask.rotate_right(rot);
    if invert {
        for bit in &mut mask {
            *bit = !*bit;
        }
    }
    mask
}

/// True Bjorklund bucket recursion (SNS-NOTE-CNTRL-99): distribute `pulses`
/// onsets among `steps` slots by repeatedly folding the remainder buckets,
/// concatenating exactly as Toussaint's E(k, n) worked examples do. Differs
/// from `euclidean_mask` by a rotation for some (k, n) — E(5,13) is
/// `1001010010100` here — and a property test pins that rotation
/// equivalence. `pulses` = 0 -> all rests; `pulses` >= `steps` -> all onsets.
pub fn bjorklund_mask(pulses: u32, steps: u32) -> Vec<bool> {
    if steps == 0 {
        return Vec::new();
    }
    let n = steps as usize;
    let k = pulses.min(steps) as usize;
    if k == 0 {
        return vec![false; n];
    }
    if k == n {
        return vec![true; n];
    }
    let mut lead: Vec<Vec<bool>> = vec![vec![true]; k];
    let mut tail: Vec<Vec<bool>> = vec![vec![false]; n - k];
    while tail.len() > 1 {
        let take = lead.len().min(tail.len());
        let folded: Vec<Vec<bool>> = lead
            .drain(..take)
            .zip(tail.drain(..take))
            .map(|(mut head, rest)| {
                head.extend(rest);
                head
            })
            .collect();
        let leftover = if lead.is_empty() {
            std::mem::take(&mut tail)
        } else {
            std::mem::take(&mut lead)
        };
        lead = folded;
        tail = leftover;
    }
    lead.into_iter().chain(tail).flatten().collect()
}

/// Bjorklund with a maximum burst run length (moinsound 2022, CC-BY):
/// cluster the `pulses` onsets into ceil(k/L) bursts — full-length first,
/// one shorter remainder burst last — then distribute the bursts among the
/// rests with `bjorklund_mask(bursts, bursts + rests)` and expand each
/// scaffold onset back into its burst. `max_run` = 1 reduces to
/// `bjorklund_mask` exactly; (5, 13, 3) -> `1110000110000`. Note the
/// whitepaper's construction needs at least as many rests as bursts
/// (`steps - pulses >= ceil(pulses / max_run)`) to keep every run at or
/// under `max_run`; with fewer rests adjacent bursts merge, which is the
/// only behavior the geometry admits.
pub fn bjorklund_burst_mask(pulses: u32, steps: u32, max_run: u32) -> Vec<bool> {
    if steps == 0 {
        return Vec::new();
    }
    let n = steps as usize;
    let k = pulses.min(steps) as usize;
    let run = (max_run.max(1) as usize).min(n);
    if k == 0 || run == 1 {
        return bjorklund_mask(pulses, steps);
    }
    let full_bursts = k / run;
    let remainder = k % run;
    let bursts = full_bursts + usize::from(remainder > 0);
    let rests = n - k;
    let scaffold = bjorklund_mask(bursts as u32, (bursts + rests) as u32);
    let mut out = Vec::with_capacity(n);
    let mut emitted = 0usize;
    for slot in scaffold {
        if slot {
            let size = if emitted < full_bursts {
                run
            } else {
                remainder
            };
            out.extend(std::iter::repeat(true).take(size));
            emitted += 1;
        } else {
            out.push(false);
        }
    }
    out
}

/// Rotates a mask later by `rotation` slots, matching `euclidean_mask`'s
/// rotation convention.
fn rotate_euclid_mask(mask: &mut [bool], rotation: u32) {
    let len = mask.len();
    if len > 0 {
        mask.rotate_right((rotation as usize) % len);
    }
}

/// One resolved slot of a Euclid channel pattern.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EuclidSlot {
    /// MIDI channel in user-facing 1-16 form.
    pub channel: u8,
    /// True when no layer claimed the slot and it fell to the static
    /// fallback channel.
    pub is_fallback: bool,
}

/// Resolves a Partition-placement table of length `spec.steps`: layers claim
/// slots by iterated Bjorklund over the slots earlier layers left behind
/// (the complement of a Euclidean rhythm is itself Euclidean — Demaine et
/// al. 2009 — so every level stays maximally even relative to what
/// remains); unclaimed slots belong to `fallback`.
pub fn euclid_partition_table(spec: &EuclidChannelSpec, fallback: u8) -> Vec<EuclidSlot> {
    let n = spec.steps.max(1) as usize;
    let mut table = vec![
        EuclidSlot {
            channel: fallback,
            is_fallback: true,
        };
        n
    ];
    let mut remaining: Vec<usize> = (0..n).collect();
    for layer in &spec.layers {
        if remaining.is_empty() {
            break;
        }
        let domain = remaining.len() as u32;
        let pulses = layer.pulses.min(domain);
        if pulses == 0 {
            continue;
        }
        let mut mask = bjorklund_burst_mask(pulses, domain, layer.max_run);
        rotate_euclid_mask(&mut mask, layer.rotation);
        let mut kept = Vec::with_capacity(remaining.len() - pulses as usize);
        for (slot, on) in remaining.iter().zip(&mask) {
            if *on {
                table[*slot] = EuclidSlot {
                    channel: layer.channel,
                    is_fallback: false,
                };
            } else {
                kept.push(*slot);
            }
        }
        remaining = kept;
    }
    table
}

/// A Stack-placement layer's fully resolved mask (rotation and inversion
/// applied), paired with its output channel.
fn euclid_stack_masks(spec: &EuclidChannelSpec) -> Vec<(u8, Vec<bool>)> {
    spec.layers
        .iter()
        .map(|layer| {
            let steps = layer.steps.clamp(1, EUCLID_MAX_STEPS);
            let mut mask = bjorklund_burst_mask(layer.pulses.min(steps), steps, layer.max_run);
            rotate_euclid_mask(&mut mask, layer.rotation);
            if layer.invert {
                for bit in &mut mask {
                    *bit = !*bit;
                }
            }
            (layer.channel, mask)
        })
        .collect()
}

pub fn validate_channel_hocket_spec(spec: &ChannelHocketSpec) -> Result<(), ChannelHocketError> {
    if spec.channels.is_empty() {
        return Err(ChannelHocketError::EmptyChannels);
    }
    let mut seen_channels = Vec::with_capacity(spec.channels.len());
    for channel in &spec.channels {
        validate_midi_channel(*channel)?;
        if seen_channels.contains(channel) {
            return Err(ChannelHocketError::DuplicateChannel(*channel));
        }
        seen_channels.push(*channel);
    }
    validate_enabled_channel(spec, spec.fallback)?;
    for fallback in &spec.fallback_weights {
        validate_enabled_channel(spec, fallback.channel)?;
    }
    let context_len = spec.order.context_len();
    for entry in &spec.entry_weights {
        if entry.channels.len() != context_len {
            return Err(ChannelHocketError::InvalidEntryLength {
                actual: entry.channels.len(),
                expected: context_len,
            });
        }
        for channel in &entry.channels {
            validate_enabled_channel(spec, *channel)
                .map_err(|_| ChannelHocketError::InvalidEntryChannel(*channel))?;
        }
    }
    for rule in &spec.accent_rules {
        if rule.min_velocity > rule.max_velocity {
            return Err(ChannelHocketError::InvalidAccentVelocityRange {
                min: rule.min_velocity,
                max: rule.max_velocity,
            });
        }
        validate_probability(rule.probability)?;
        for weight in &rule.weights {
            validate_enabled_channel(spec, weight.channel)?;
        }
    }
    for rule in &spec.position_rules {
        if rule.nth == 0 {
            return Err(ChannelHocketError::InvalidPositionNth);
        }
        for weight in &rule.render_weights {
            validate_enabled_channel(spec, weight.channel)?;
        }
        for weight in &rule.reset.weights {
            validate_enabled_channel(spec, weight.channel)?;
        }
    }

    for transition in &spec.transitions {
        if transition.from.len() != context_len {
            return Err(ChannelHocketError::InvalidContextLength {
                actual: transition.from.len(),
                expected: context_len,
            });
        }
        for channel in &transition.from {
            validate_enabled_channel(spec, *channel)?;
        }
        validate_enabled_channel(spec, transition.to)?;
    }

    if spec.assign_mode == ChannelAssignMode::Euclid {
        let euclid = spec
            .euclid
            .as_ref()
            .ok_or(ChannelHocketError::MissingEuclidSpec)?;
        validate_euclid_channel_spec(spec, euclid)?;
    }

    Ok(())
}

/// Euclid-arm validation. Runs per note group like the rest of
/// `validate_channel_hocket_spec`, so it stays O(layers) and allocation-free.
fn validate_euclid_channel_spec(
    spec: &ChannelHocketSpec,
    euclid: &EuclidChannelSpec,
) -> Result<(), ChannelHocketError> {
    if euclid.steps == 0 || euclid.steps > EUCLID_MAX_STEPS {
        return Err(ChannelHocketError::InvalidEuclidSteps(euclid.steps));
    }
    if euclid.layers.len() > EUCLID_MAX_LAYERS {
        return Err(ChannelHocketError::TooManyEuclidLayers(euclid.layers.len()));
    }
    // Layer channels are palette members (1..=16 by construction), so a
    // fixed seen-array keeps the uniqueness check allocation-free.
    let mut seen = [false; 17];
    let mut pulse_total = 0u32;
    for layer in &euclid.layers {
        validate_enabled_channel(spec, layer.channel)?;
        if seen[layer.channel as usize] {
            return Err(ChannelHocketError::DuplicateEuclidLayerChannel(
                layer.channel,
            ));
        }
        seen[layer.channel as usize] = true;
        if layer.max_run == 0 {
            return Err(ChannelHocketError::InvalidEuclidMaxRun);
        }
        if euclid.placement == EuclidPlacement::Stack
            && (layer.steps == 0 || layer.steps > EUCLID_MAX_STEPS)
        {
            return Err(ChannelHocketError::InvalidEuclidSteps(layer.steps));
        }
        pulse_total = pulse_total.saturating_add(layer.pulses);
    }
    if euclid.placement == EuclidPlacement::Partition && pulse_total > euclid.steps {
        return Err(ChannelHocketError::EuclidPulsesExceedSteps {
            total: pulse_total,
            steps: euclid.steps,
        });
    }
    if let Some(anchor) = euclid.span_accent_channel {
        validate_enabled_channel(spec, anchor)?;
    }
    Ok(())
}

pub fn resolve_channel_hocket(
    spec: &ChannelHocketSpec,
    count: usize,
    seed: u64,
) -> Result<Vec<ResolvedChannelChoice>, ChannelHocketError> {
    let mut resolver = ChannelHocketResolver::new(spec, seed)?;
    let mut choices = Vec::with_capacity(count);

    for _ in 0..count {
        choices.push(resolver.next_choice());
    }

    Ok(choices)
}

pub struct ChannelHocketResolver<'a> {
    spec: &'a ChannelHocketSpec,
    transition_index: ChannelTransitionIndex<'a>,
    rng: SplitMix64,
    history: Vec<u8>,
    pending_entry: Vec<u8>,
    index: u32,
}

impl<'a> ChannelHocketResolver<'a> {
    pub fn new(spec: &'a ChannelHocketSpec, seed: u64) -> Result<Self, ChannelHocketError> {
        validate_channel_hocket_spec(spec)?;
        Ok(Self {
            spec,
            transition_index: channel_transition_index(spec),
            rng: SplitMix64::new(seed),
            history: Vec::new(),
            pending_entry: Vec::new(),
            index: 0,
        })
    }

    pub fn next_choice(&mut self) -> ResolvedChannelChoice {
        let choice = resolve_next_channel_choice(
            self.spec,
            &self.transition_index,
            &mut self.history,
            &mut self.pending_entry,
            &mut self.rng,
        );
        self.resolve(choice)
    }

    pub fn next_choice_with_spec(
        &mut self,
        spec: &ChannelHocketSpec,
    ) -> Result<ResolvedChannelChoice, ChannelHocketError> {
        validate_channel_hocket_spec(spec)?;
        let transition_index = channel_transition_index(spec);
        let choice = resolve_next_channel_choice(
            spec,
            &transition_index,
            &mut self.history,
            &mut self.pending_entry,
            &mut self.rng,
        );
        Ok(self.resolve(choice))
    }

    pub fn force_channel(
        &mut self,
        channel: u8,
    ) -> Result<ResolvedChannelChoice, ChannelHocketError> {
        validate_enabled_channel(self.spec, channel)?;
        self.history.push(channel);
        Ok(self.resolve(ChannelChoice {
            channel,
            source: RhythmChoiceSource::Accent,
            fallback_reason: Some("accent channel routing".to_string()),
        }))
    }

    pub fn force_channel_with_spec(
        &mut self,
        spec: &ChannelHocketSpec,
        channel: u8,
    ) -> Result<ResolvedChannelChoice, ChannelHocketError> {
        validate_enabled_channel(spec, channel)?;
        self.history.push(channel);
        Ok(self.resolve(ChannelChoice {
            channel,
            source: RhythmChoiceSource::Accent,
            fallback_reason: Some("accent channel routing".to_string()),
        }))
    }

    pub fn reset_channel_with_spec(
        &mut self,
        spec: &ChannelHocketSpec,
        channel: u8,
    ) -> Result<ResolvedChannelChoice, ChannelHocketError> {
        validate_enabled_channel(spec, channel)?;
        self.pending_entry.clear();
        self.history.clear();
        self.history.resize(spec.order.context_len(), channel);
        Ok(self.resolve(ChannelChoice {
            channel,
            source: RhythmChoiceSource::Position,
            fallback_reason: Some("positional channel reset".to_string()),
        }))
    }

    fn resolve(&mut self, choice: ChannelChoice) -> ResolvedChannelChoice {
        let index = self.index;
        self.index = self.index.saturating_add(1);
        ResolvedChannelChoice {
            index,
            channel: choice.channel,
            source: choice.source,
            fallback_reason: choice.fallback_reason,
        }
    }
}

/// Runtime peer of `ChannelHocketResolver` for `ChannelAssignMode::Euclid`.
///
/// The step index advances exactly once per method call, so call counts and
/// note-group semantics stay identical across strategies. `enter_region`
/// re-anchors the index whenever the transport hands over a new reset-region
/// key (cycle / section / beat / accent span, per `EuclidResetScope`).
pub struct EuclidAssigner {
    tables: Option<EuclidAssignerTables>,
    region_key: Option<u64>,
    /// Steps consumed within the current reset region.
    index: u64,
    /// Trace ordinal across the whole cycle (mirrors the resolver's index).
    trace_index: u32,
}

struct EuclidAssignerTables {
    euclid: EuclidChannelSpec,
    fallback: u8,
    kind: EuclidTableKind,
}

enum EuclidTableKind {
    Partition(Vec<EuclidSlot>),
    Stack {
        masks: Vec<(u8, Vec<bool>)>,
        /// Exact lcm of the layer lengths. With the validated 64-step limit,
        /// the lcm of every possible layer length fits comfortably in u128.
        period: u128,
    },
}

impl EuclidAssignerTables {
    fn slot_at(&self, index: u64) -> EuclidSlot {
        match &self.kind {
            EuclidTableKind::Partition(table) => {
                let len = table.len().max(1) as u64;
                table[(index % len) as usize]
            }
            EuclidTableKind::Stack { masks, .. } => {
                for (channel, mask) in masks {
                    if mask.is_empty() {
                        continue;
                    }
                    if mask[(index % mask.len() as u64) as usize] {
                        return EuclidSlot {
                            channel: *channel,
                            is_fallback: false,
                        };
                    }
                }
                EuclidSlot {
                    channel: self.fallback,
                    is_fallback: true,
                }
            }
        }
    }

    fn next_index_for_channel(&self, start: u64, channel: u8) -> Option<u64> {
        match &self.kind {
            EuclidTableKind::Partition(table) => {
                let bound = table.len().max(1) as u64;
                (0..bound).find_map(|distance| {
                    let index = start.checked_add(distance)?;
                    (self.slot_at(index).channel == channel).then_some(index)
                })
            }
            EuclidTableKind::Stack { masks, period } => {
                // Most magnets resolve within a handful of steps. Keep that
                // path cheap, then use modular constraints instead of either
                // truncating the true period or linearly scanning a huge LCM.
                const FAST_SCAN_BOUND: u128 = 4096;
                let bound = (*period).min(FAST_SCAN_BOUND) as u64;
                if let Some(index) = (0..bound).find_map(|distance| {
                    let index = start.checked_add(distance)?;
                    (self.slot_at(index).channel == channel).then_some(index)
                }) {
                    return Some(index);
                }
                if *period <= FAST_SCAN_BOUND {
                    return None;
                }
                next_stack_index_for_channel(masks, self.fallback, start, channel)
            }
        }
    }
}

fn euclid_gcd(mut a: u128, mut b: u128) -> u128 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a.max(1)
}

fn euclid_stack_period(masks: &[(u8, Vec<bool>)]) -> u128 {
    let mut period = 1u128;
    for (_, mask) in masks {
        let len = mask.len() as u128;
        if len == 0 {
            continue;
        }
        period = (period / euclid_gcd(period, len)) * len;
    }
    period.max(1)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct EuclidCongruence {
    residue: u128,
    modulus: u128,
}

struct EuclidResidueConstraint {
    modulus: u128,
    residues: Vec<u128>,
}

fn first_congruent_at_or_after(congruence: EuclidCongruence, start: u128) -> u128 {
    if start <= congruence.residue {
        return congruence.residue;
    }
    let delta = start - congruence.residue;
    let repeats = delta.div_ceil(congruence.modulus);
    congruence.residue + repeats * congruence.modulus
}

/// Merge `x = current.residue (mod current.modulus)` with
/// `x = residue (mod modulus)`. Constraint moduli are at most 64, so finding
/// the generalized-CRT offset by at most `modulus / gcd` trials is bounded.
fn merge_euclid_congruence(
    current: EuclidCongruence,
    residue: u128,
    modulus: u128,
) -> Option<EuclidCongruence> {
    let residue = residue % modulus;
    let gcd = euclid_gcd(current.modulus, modulus);
    if current.residue % gcd != residue % gcd {
        return None;
    }
    let trials = modulus / gcd;
    let merged_modulus = current.modulus * trials;
    let mut candidate = current.residue;
    for _ in 0..trials {
        if candidate % modulus == residue {
            return Some(EuclidCongruence {
                residue: candidate % merged_modulus,
                modulus: merged_modulus,
            });
        }
        candidate += current.modulus;
    }
    None
}

fn search_euclid_constraints(
    constraints: &[EuclidResidueConstraint],
    constraint_index: usize,
    current: EuclidCongruence,
    start: u128,
    best: &mut Option<u128>,
) {
    let earliest = first_congruent_at_or_after(current, start);
    if best.is_some_and(|best| earliest >= best) {
        return;
    }
    let Some(constraint) = constraints.get(constraint_index) else {
        *best = Some(earliest);
        return;
    };

    let mut merged = constraint
        .residues
        .iter()
        .filter_map(|residue| merge_euclid_congruence(current, *residue, constraint.modulus))
        .map(|congruence| (first_congruent_at_or_after(congruence, start), congruence))
        .collect::<Vec<_>>();
    merged.sort_unstable_by_key(|(next, _)| *next);
    let mut seen = std::collections::HashSet::new();
    for (next, congruence) in merged {
        if best.is_some_and(|best| next >= best) {
            break;
        }
        if seen.insert(congruence) {
            search_euclid_constraints(constraints, constraint_index + 1, congruence, start, best);
        }
    }
}

fn next_index_matching_stack_constraints(
    masks: &[(u8, Vec<bool>)],
    requirements: &[(usize, bool)],
    start: u64,
) -> Option<u64> {
    let mut constraints = requirements
        .iter()
        .filter_map(|(mask_index, required_value)| {
            let mask = &masks[*mask_index].1;
            let residues = mask
                .iter()
                .enumerate()
                .filter_map(|(residue, value)| {
                    (*value == *required_value).then_some(residue as u128)
                })
                .collect::<Vec<_>>();
            (!residues.is_empty() && residues.len() != mask.len()).then_some(
                EuclidResidueConstraint {
                    modulus: mask.len() as u128,
                    residues,
                },
            )
        })
        .collect::<Vec<_>>();
    if requirements
        .iter()
        .any(|(mask_index, required_value)| !masks[*mask_index].1.contains(required_value))
    {
        return None;
    }
    constraints.sort_unstable_by_key(|constraint| constraint.residues.len());

    let mut best = None;
    search_euclid_constraints(
        &constraints,
        0,
        EuclidCongruence {
            residue: 0,
            modulus: 1,
        },
        u128::from(start),
        &mut best,
    );
    best.and_then(|index| u64::try_from(index).ok())
}

fn next_stack_index_for_channel(
    masks: &[(u8, Vec<bool>)],
    fallback: u8,
    start: u64,
    channel: u8,
) -> Option<u64> {
    let mut best = None;

    // A layer wins only where its mask is on and every higher-priority layer
    // is off. Layer channels are unique after validation.
    for (layer_index, (layer_channel, _)) in masks.iter().enumerate() {
        if *layer_channel != channel {
            continue;
        }
        let mut requirements = (0..layer_index)
            .map(|index| (index, false))
            .collect::<Vec<_>>();
        requirements.push((layer_index, true));
        if let Some(index) = next_index_matching_stack_constraints(masks, &requirements, start) {
            best = Some(best.map_or(index, |current: u64| current.min(index)));
        }
    }

    // The fallback wins exactly where every layer mask is off. It can share a
    // channel number with a layer, in which case either route is a valid hit.
    if channel == fallback {
        let requirements = (0..masks.len())
            .map(|index| (index, false))
            .collect::<Vec<_>>();
        if let Some(index) = next_index_matching_stack_constraints(masks, &requirements, start) {
            best = Some(best.map_or(index, |current| current.min(index)));
        }
    }

    best
}

impl EuclidAssigner {
    pub fn new() -> Self {
        Self {
            tables: None,
            region_key: None,
            index: 0,
            trace_index: 0,
        }
    }

    /// Re-anchors the step index when the note group enters a new reset
    /// region. Keys only need to be distinct between adjacent regions.
    pub fn enter_region(&mut self, key: u64) {
        if self.region_key != Some(key) {
            self.region_key = Some(key);
            self.index = 0;
        }
    }

    /// The pattern channel at the current step; advances one step.
    pub fn next_choice_with_spec(
        &mut self,
        spec: &ChannelHocketSpec,
    ) -> Result<ResolvedChannelChoice, ChannelHocketError> {
        self.ensure_tables(spec)?;
        let tables = self.tables.as_ref().expect("tables ensured above");
        let slot = tables.slot_at(self.index);
        self.index = self.index.saturating_add(1);
        let (source, fallback_reason) = if slot.is_fallback {
            (
                RhythmChoiceSource::Fallback,
                Some("no euclid layer claims this step".to_string()),
            )
        } else {
            (RhythmChoiceSource::Transition, None)
        };
        Ok(self.resolve(ChannelChoice {
            channel: slot.channel,
            source,
            fallback_reason,
        }))
    }

    /// Phase magnet — the `DriveChain` analogue: jump forward to the next
    /// slot that plays `channel` and continue from just past it, so the
    /// pattern proceeds as though it had chosen the forced channel. If no slot
    /// in the exact repeating pattern plays it (the accent palette is wider
    /// than the layer set), render the channel and advance one step in place.
    pub fn force_channel_with_spec(
        &mut self,
        spec: &ChannelHocketSpec,
        channel: u8,
    ) -> Result<ResolvedChannelChoice, ChannelHocketError> {
        validate_enabled_channel(spec, channel)?;
        self.ensure_tables(spec)?;
        let tables = self.tables.as_ref().expect("tables ensured above");
        let next_index = tables.next_index_for_channel(self.index, channel);
        self.index = match next_index {
            Some(index) => index.saturating_add(1),
            None => self.index.saturating_add(1),
        };
        Ok(self.resolve(ChannelChoice {
            channel,
            source: RhythmChoiceSource::Accent,
            fallback_reason: Some("accent channel routing".to_string()),
        }))
    }

    /// Re-anchor — the `ResetMarkov` analogue: render the rule's chosen
    /// channel for this note and rewind so the next step reads slot zero.
    pub fn reset_channel_with_spec(
        &mut self,
        spec: &ChannelHocketSpec,
        channel: u8,
    ) -> Result<ResolvedChannelChoice, ChannelHocketError> {
        validate_enabled_channel(spec, channel)?;
        self.index = 0;
        Ok(self.resolve(ChannelChoice {
            channel,
            source: RhythmChoiceSource::Position,
            fallback_reason: Some("positional channel re-anchor".to_string()),
        }))
    }

    fn ensure_tables(&mut self, spec: &ChannelHocketSpec) -> Result<(), ChannelHocketError> {
        validate_channel_hocket_spec(spec)?;
        let euclid = spec
            .euclid
            .as_ref()
            .ok_or(ChannelHocketError::MissingEuclidSpec)?;
        let fresh = match &self.tables {
            Some(tables) => tables.euclid != *euclid || tables.fallback != spec.fallback,
            None => true,
        };
        if fresh {
            let kind = match euclid.placement {
                EuclidPlacement::Partition => {
                    EuclidTableKind::Partition(euclid_partition_table(euclid, spec.fallback))
                }
                EuclidPlacement::Stack => {
                    let masks = euclid_stack_masks(euclid);
                    let period = euclid_stack_period(&masks);
                    EuclidTableKind::Stack { masks, period }
                }
            };
            self.tables = Some(EuclidAssignerTables {
                euclid: euclid.clone(),
                fallback: spec.fallback,
                kind,
            });
        }
        Ok(())
    }

    fn resolve(&mut self, choice: ChannelChoice) -> ResolvedChannelChoice {
        let index = self.trace_index;
        self.trace_index = self.trace_index.saturating_add(1);
        ResolvedChannelChoice {
            index,
            channel: choice.channel,
            source: choice.source,
            fallback_reason: choice.fallback_reason,
        }
    }
}

impl Default for EuclidAssigner {
    fn default() -> Self {
        Self::new()
    }
}

pub fn resolve_channel_hocket_with_seed_mode(
    spec: &ChannelHocketSpec,
    count: usize,
    seed_mode: &mut RhythmSeedMode,
    cycle: u64,
    global_seed: u64,
) -> Result<ChannelHocketResolution, ChannelHocketError> {
    let seed = resolve_seed(seed_mode, cycle, global_seed)?;
    let choices = resolve_channel_hocket(spec, count, seed.seed)?;
    Ok(ChannelHocketResolution { seed, choices })
}

pub fn resolve_seed(
    seed_mode: &mut RhythmSeedMode,
    cycle: u64,
    global_seed: u64,
) -> Result<RhythmSeedResolution, RhythmError> {
    match seed_mode {
        RhythmSeedMode::FollowGlobal => Ok(RhythmSeedResolution {
            seed: global_seed,
            source: RhythmSeedSource::FollowGlobal,
            history: vec![],
        }),
        RhythmSeedMode::Locked { seed } => Ok(RhythmSeedResolution {
            seed: *seed,
            source: RhythmSeedSource::Locked,
            history: vec![],
        }),
        RhythmSeedMode::PerCycle { seed } => Ok(RhythmSeedResolution {
            seed: mix_seed(*seed, cycle),
            source: RhythmSeedSource::PerCycle,
            history: vec![],
        }),
        RhythmSeedMode::History {
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
                return Err(RhythmError::EmptySeedWeights);
            }

            let mut rng = SplitMix64::new(mix_seed(*seed, cycle));
            let total = u64::from(if can_use_history { *history_weight } else { 0 })
                + u64::from(if can_make_new { *new_seed_weight } else { 0 });
            let pick = rng.next_below(total);
            let history_band = u64::from(if can_use_history { *history_weight } else { 0 });

            if can_use_history && pick < history_band {
                let index = rng.next_below(history.len() as u64) as usize;
                Ok(RhythmSeedResolution {
                    seed: history[index],
                    source: RhythmSeedSource::History,
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
                Ok(RhythmSeedResolution {
                    seed: next_seed,
                    source: RhythmSeedSource::New,
                    history: history.clone(),
                })
            }
        }
    }
}

pub fn mix_seed(seed: u64, cycle: u64) -> u64 {
    let mut rng = SplitMix64::new(seed ^ 0xA81F_3D2C_91B4_EE77);
    rng.state = rng.state.wrapping_add(cycle);
    rng.next_u64()
}

type ChannelTransitionIndex<'a> = HashMap<Vec<u8>, Vec<&'a ChannelTransition>>;

fn channel_transition_index(spec: &ChannelHocketSpec) -> ChannelTransitionIndex<'_> {
    let mut index = HashMap::<Vec<u8>, Vec<&ChannelTransition>>::new();
    for transition in &spec.transitions {
        if transition.weight > 0 {
            index
                .entry(transition.from.clone())
                .or_default()
                .push(transition);
        }
    }
    index
}

struct ChannelChoice {
    channel: u8,
    source: RhythmChoiceSource,
    fallback_reason: Option<String>,
}

fn validate_midi_channel(channel: u8) -> Result<(), ChannelHocketError> {
    if (1..=16).contains(&channel) {
        Ok(())
    } else {
        Err(ChannelHocketError::ChannelOutOfRange(channel))
    }
}

fn validate_probability(probability: f32) -> Result<(), ChannelHocketError> {
    if (0.0..=1.0).contains(&probability) {
        Ok(())
    } else {
        Err(ChannelHocketError::InvalidProbability(probability))
    }
}

fn validate_enabled_channel(
    spec: &ChannelHocketSpec,
    channel: u8,
) -> Result<(), ChannelHocketError> {
    validate_midi_channel(channel)?;
    if spec.channels.contains(&channel) {
        Ok(())
    } else {
        Err(ChannelHocketError::ChannelNotEnabled(channel))
    }
}

fn resolve_next_channel_choice(
    spec: &ChannelHocketSpec,
    transition_index: &ChannelTransitionIndex<'_>,
    history: &mut Vec<u8>,
    pending_entry: &mut Vec<u8>,
    rng: &mut SplitMix64,
) -> ChannelChoice {
    let context_len = spec.order.context_len();
    let choice = if history.len() < context_len {
        if pending_entry.is_empty() {
            *pending_entry = choose_channel_entry(spec, rng);
            let already_filled = history.len().min(pending_entry.len());
            pending_entry.drain(0..already_filled);
        }
        ChannelChoice {
            channel: pending_entry.first().copied().unwrap_or(spec.fallback),
            source: RhythmChoiceSource::Initial,
            fallback_reason: Some("entry selector".to_string()),
        }
    } else {
        let context = &history[history.len() - context_len..];
        choose_channel_transition(transition_index, context, rng).unwrap_or_else(|| ChannelChoice {
            channel: choose_channel_fallback(spec, rng),
            source: RhythmChoiceSource::Fallback,
            fallback_reason: Some("no positive outgoing transition".to_string()),
        })
    };

    if choice.source == RhythmChoiceSource::Initial && !pending_entry.is_empty() {
        pending_entry.remove(0);
    }
    history.push(choice.channel);
    choice
}

fn choose_channel_entry(spec: &ChannelHocketSpec, rng: &mut SplitMix64) -> Vec<u8> {
    let context_len = spec.order.context_len();
    let candidates = spec
        .entry_weights
        .iter()
        .filter(|entry| {
            entry.weight > 0
                && entry.channels.len() == context_len
                && entry
                    .channels
                    .iter()
                    .all(|channel| spec.channels.contains(channel))
        })
        .collect::<Vec<_>>();
    let total = candidates
        .iter()
        .map(|entry| entry.weight as u64)
        .sum::<u64>();
    if total == 0 {
        return vec![spec.fallback; context_len];
    }

    let mut pick = rng.next_below(total);
    for entry in candidates {
        let weight = entry.weight as u64;
        if pick < weight {
            return entry.channels.clone();
        }
        pick -= weight;
    }
    vec![spec.fallback; context_len]
}

fn choose_channel_fallback(spec: &ChannelHocketSpec, rng: &mut SplitMix64) -> u8 {
    let candidates = spec
        .fallback_weights
        .iter()
        .filter(|fallback| fallback.weight > 0 && spec.channels.contains(&fallback.channel))
        .collect::<Vec<_>>();
    let total = candidates
        .iter()
        .map(|fallback| fallback.weight as u64)
        .sum::<u64>();
    if total == 0 {
        return spec.fallback;
    }

    let mut pick = rng.next_below(total);
    for fallback in candidates {
        let weight = fallback.weight as u64;
        if pick < weight {
            return fallback.channel;
        }
        pick -= weight;
    }
    spec.fallback
}

fn choose_channel_transition(
    transition_index: &ChannelTransitionIndex<'_>,
    context: &[u8],
    rng: &mut SplitMix64,
) -> Option<ChannelChoice> {
    let candidates = transition_index.get(context)?;
    let total = candidates
        .iter()
        .map(|transition| transition.weight as u64)
        .sum::<u64>();
    if total == 0 {
        return None;
    }

    let mut pick = rng.next_below(total);
    for transition in candidates {
        let weight = transition.weight as u64;
        if pick < weight {
            return Some(ChannelChoice {
                channel: transition.to,
                source: RhythmChoiceSource::Transition,
                fallback_reason: None,
            });
        }
        pick -= weight;
    }
    None
}

/// The engine's deterministic stream generator.
#[derive(Clone)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub(crate) fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub(crate) fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    pub(crate) fn next_below(&mut self, upper_exclusive: u64) -> u64 {
        if upper_exclusive == 0 {
            return 0;
        }
        self.next_u64() % upper_exclusive
    }

    /// Uniform in [0, 1). Public for the transport's shape-op draws.
    pub fn next_f32(&mut self) -> f32 {
        let value = self.next_u64() >> 40;
        value as f32 / (1u64 << 24) as f32
    }
}
