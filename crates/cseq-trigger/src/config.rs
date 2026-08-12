//! Trigger configuration types, validation, and graph normalization.
//!
//! Everything here is pure data + pure functions. The serde representation is
//! `camelCase` so the Tauri request DTO in `src-tauri` can embed
//! [`TriggerConfig`] directly (the same pattern `cseq-rhythm` specs use); this
//! crate still does not depend on Tauri.

use serde::de::{IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use std::fmt;

/// Default hard safety cap on how many follower cycles a single launched run
/// may realize. Never unbounded. (Plan §4.4 / §12 open question 2.)
pub const DEFAULT_MAX_REPEATS: u32 = 64;
/// Absolute ceiling for `max_repeats` regardless of the requested value.
pub const MAX_REPEATS_CAP: u32 = 4096;
/// Absolute ceiling for an `afterEventTicks` launch offset. Bounds the retained
/// source-resolution history the transport must keep, and matches the frontend
/// clamp so a non-UI client cannot push it unbounded.
pub const MAX_AFTER_EVENT_TICKS: u64 = 1_000_000;

/// A v1 trigger condition observed against a *resolved* source cycle.
///
/// v1 deliberately ships only conditions that are legible from pure resolved
/// structure (beats, gati, section-start, jathi pulses, rest-vs-sounding).
/// Post-score conditions that observe finalized transport metadata
/// (`ratchetFiredAtBeat`, `ornamentAtBeat`, `channelHocketRoutedTo`) are
/// intentionally *not* present — see the crate docs and the plan for why they
/// are deferred.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TriggerCondition {
    /// Beat `beat` of the source resolves to a rest (no audible onset).
    BeatIsRest { beat: u32 },
    /// Beat `beat` of the source has at least one audible onset.
    BeatIsSounding { beat: u32 },
    /// A resolved section starts at beat `beat`.
    SectionStartAtBeat { beat: u32 },
    /// Beat `beat` resolves to gati `gati` (gati is per beat, not per section).
    GatiIs { beat: u32, gati: u32 },
    /// A grouping accent pulse begins at beat `beat`.
    JathiPulseAtBeat { beat: u32 },
}

impl TriggerCondition {
    /// The source beat this condition observes (all v1 conditions are
    /// beat-anchored). Used by graph/normalize and UI summaries.
    pub fn beat(&self) -> u32 {
        match self {
            TriggerCondition::BeatIsRest { beat }
            | TriggerCondition::BeatIsSounding { beat }
            | TriggerCondition::SectionStartAtBeat { beat }
            | TriggerCondition::GatiIs { beat, .. }
            | TriggerCondition::JathiPulseAtBeat { beat } => *beat,
        }
    }
}

/// Where the follower's beat 0 lands relative to the matched trigger event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LaunchAlignment {
    /// At the matched event's own reference tick (e.g. the rest's onset).
    #[default]
    AtEvent,
    /// At the start of the source cycle that produced the match.
    AtSourceCycleStart,
    /// At the next reference-beat boundary at or after the matched tick.
    AtNextReferenceBeat,
    /// At the matched tick plus a fixed, non-negative tick offset.
    AfterEventTicks { ticks: u64 },
    /// At the midpoint of the matched beat's span (Phase D). Centers a fill in
    /// the rest beat. Intra-beat bounded, so windowing/carry stay bounded.
    CenterInRest,
    /// At the source's next sounding onset after the matched event, within the
    /// matched cycle (Phase D). Falls back to the event tick if the source stays
    /// silent to cycle end. Intra-cycle bounded.
    AtSourceReturn,
}

impl LaunchAlignment {
    /// Clamp the only bounded payload (`AfterEventTicks`). Idempotent.
    pub fn normalized(self) -> LaunchAlignment {
        match self {
            LaunchAlignment::AfterEventTicks { ticks } => LaunchAlignment::AfterEventTicks {
                ticks: ticks.min(MAX_AFTER_EVENT_TICKS),
            },
            other => other,
        }
    }
}

/// Largest grid subdivision/multiple accepted (keeps the snap step bounded and
/// well above PPQN resolution). Frontend clamps to the same ceiling.
pub const MAX_QUANTIZE_DIVISIONS: u32 = 64;

/// The grid that an aligned launch tick snaps to (see [`LaunchQuantize`]). This
/// is applied *after* [`LaunchAlignment`] — alignment chooses the anchor, the
/// grid snaps it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum QuantizeGrid {
    /// `1 / divisions` of a *reference* beat, phased at reference tick 0.
    /// `divisions = 1` → whole beat, `2` → ½ beat, `3` → ⅓ beat (tuplet),
    /// `4` → ¼ beat, … Clamped to `1..=MAX_QUANTIZE_DIVISIONS`.
    ReferenceBeatFraction { divisions: u32 },
    /// Every `beats` *reference* beats, phased at reference tick 0. Clamped to
    /// `1..=MAX_QUANTIZE_DIVISIONS`.
    ReferenceBeatMultiple { beats: u32 },
    /// The matra grid of the *source's* gati at the matched beat, phased at the
    /// matched beat's start. v1 uses an integer-tick `PPQN / gati`
    /// approximation; exact rational matra positions would require carrying
    /// per-matra source ticks with each fire.
    SourceGatiMatra,
}

/// Rounding direction when snapping to a [`QuantizeGrid`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuantizeDirection {
    /// Smallest grid point `>=` the anchor (ceil). The safe default: never moves
    /// a launch earlier, so it can't fall behind the lookahead window.
    #[default]
    Next,
    /// Nearest grid point (ties round up).
    Nearest,
    /// Largest grid point `<=` the anchor (floor). May move a launch earlier
    /// than the matched event — and a launch snapped before the current
    /// lookahead window is dropped (the existing future-only rule).
    Previous,
}

/// Optional post-alignment snap of the launch tick to a musical grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchQuantize {
    pub grid: QuantizeGrid,
    #[serde(default)]
    pub direction: QuantizeDirection,
}

impl LaunchQuantize {
    /// Clamp the grid into bounded, divide-by-zero-safe ranges. Idempotent.
    pub fn normalized(&self) -> LaunchQuantize {
        let grid = match self.grid {
            QuantizeGrid::ReferenceBeatFraction { divisions } => {
                QuantizeGrid::ReferenceBeatFraction {
                    divisions: divisions.clamp(1, MAX_QUANTIZE_DIVISIONS),
                }
            }
            QuantizeGrid::ReferenceBeatMultiple { beats } => QuantizeGrid::ReferenceBeatMultiple {
                beats: beats.clamp(1, MAX_QUANTIZE_DIVISIONS),
            },
            QuantizeGrid::SourceGatiMatra => QuantizeGrid::SourceGatiMatra,
        };
        LaunchQuantize {
            grid,
            direction: self.direction,
        }
    }
}

/// How long a launched run lasts.
///
/// `untilStopCondition` is intentionally absent in v1: a pure compiler over a
/// bounded window cannot express an open-ended stop condition without extra
/// carry/state machinery that we are not shipping yet. See the plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Lifetime {
    /// Run exactly one pass (one follower phrase), then re-arm.
    OnePass,
    /// Run `passes` follower phrases, then re-arm.
    Repeats { passes: u32 },
}

impl Lifetime {
    /// Number of follower phrases this lifetime realizes, pre-clamp.
    pub fn passes(&self) -> u32 {
        match self {
            Lifetime::OnePass => 1,
            Lifetime::Repeats { passes } => *passes,
        }
    }
}

/// What a fresh qualifying trigger does while a run is already active.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReTrigger {
    /// Reset the run to beat 0 at the new trigger tick.
    Restart,
    /// Ignore the trigger until the current run finishes, then re-arm.
    Ignore,
    /// Finish the current run, then launch once more. Capped at depth 1.
    Queue,
}

/// The follower's phrase length model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TriggerLength {
    /// The follower's own authored cycle is the phrase (its natural length).
    ScoreCycle,
    /// A fixed `beats`-beat phrase (need not divide the reference cycle). The
    /// follower realizes on a `beats`-beat cycle for each pass.
    FixedBeats { beats: u32 },
}

/// Largest condition-tree size/depth accepted, to keep evaluation bounded
/// against adversarial nesting from a non-UI client.
pub const MAX_CONDITION_NODES: usize = 256;
pub const MAX_CONDITION_DEPTH: usize = 32;

/// Comparison operator for cycle-level count predicates (Phase B).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CountOp {
    AtLeast,
    AtMost,
    Exactly,
    MoreThan,
    LessThan,
}

impl<'de> Deserialize<'de> for CountOp {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct CountOpVisitor;

        impl Visitor<'_> for CountOpVisitor {
            type Value = CountOp;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a count comparison operator")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
                Ok(match value {
                    "atMost" => CountOp::AtMost,
                    "exactly" => CountOp::Exactly,
                    "moreThan" => CountOp::MoreThan,
                    "lessThan" => CountOp::LessThan,
                    _ => CountOp::AtLeast,
                })
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
                Ok(match value.as_str() {
                    "atMost" => CountOp::AtMost,
                    "exactly" => CountOp::Exactly,
                    "moreThan" => CountOp::MoreThan,
                    "lessThan" => CountOp::LessThan,
                    _ => CountOp::AtLeast,
                })
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(CountOp::AtLeast)
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(CountOp::AtLeast)
            }

            fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
                Ok(CountOp::AtLeast)
            }

            fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E> {
                Ok(CountOp::AtLeast)
            }

            fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E> {
                Ok(CountOp::AtLeast)
            }

            fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E> {
                Ok(CountOp::AtLeast)
            }
        }

        deserializer.deserialize_any(CountOpVisitor)
    }
}

impl CountOp {
    pub fn test(self, actual: u32, threshold: u32) -> bool {
        match self {
            CountOp::AtLeast => actual >= threshold,
            CountOp::AtMost => actual <= threshold,
            CountOp::Exactly => actual == threshold,
            CountOp::MoreThan => actual > threshold,
            CountOp::LessThan => actual < threshold,
        }
    }
}

/// A single WHEN predicate. Beat-relative predicates are evaluated at the
/// candidate (anchor) beat; cycle-level predicates are the same for every beat
/// of the cycle. All are legible from pure resolved structure (Phase B adds no
/// post-score observation).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WhenPredicate {
    /// Anchor beat resolves to a rest (no audible onset).
    IsRest,
    /// Anchor beat has at least one audible onset.
    IsSounding,
    /// A resolved section starts at the anchor beat.
    IsSectionStart,
    /// A grouping accent pulse begins within the anchor beat.
    HasJathiPulse,
    /// Anchor beat resolves to gati `gati` (gati is per beat).
    GatiIs { gati: u32 },
    /// Matra `matra` of the anchor beat is a rest.
    MatraIsRest { matra: u32 },
    /// Matra `matra` of the anchor beat is sounding.
    MatraIsSounding { matra: u32 },
    /// The whole cycle has `op count` rest beats.
    RestCountInCycle { op: CountOp, count: u32 },
    /// The whole cycle has `op count` sounding beats.
    SoundingCountInCycle { op: CountOp, count: u32 },
}

impl<'de> Deserialize<'de> for WhenPredicate {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct WhenPredicateVisitor;

        impl<'de> Visitor<'de> for WhenPredicateVisitor {
            type Value = WhenPredicate;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a WHEN predicate object")
            }

            fn visit_map<M>(self, mut map: M) -> Result<Self::Value, M::Error>
            where
                M: MapAccess<'de>,
            {
                let mut type_name: Option<String> = None;
                let mut gati: Option<u32> = None;
                let mut matra: Option<u32> = None;
                let mut op: Option<CountOp> = None;
                let mut count: Option<u32> = None;

                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "type" => type_name = map.next_value::<LooseString>()?.0,
                        "gati" => gati = map.next_value::<LooseU32>()?.0,
                        "matra" => matra = map.next_value::<LooseU32>()?.0,
                        "op" => op = Some(map.next_value()?),
                        "count" => count = map.next_value::<LooseU32>()?.0,
                        _ => {
                            let _ = map.next_value::<IgnoredAny>()?;
                        }
                    }
                }

                Ok(match type_name.as_deref() {
                    Some("isSounding") => WhenPredicate::IsSounding,
                    Some("isSectionStart") => WhenPredicate::IsSectionStart,
                    Some("hasJathiPulse") => WhenPredicate::HasJathiPulse,
                    Some("gatiIs") => WhenPredicate::GatiIs {
                        gati: gati.unwrap_or(4),
                    },
                    Some("matraIsRest") => WhenPredicate::MatraIsRest {
                        matra: matra.unwrap_or(0),
                    },
                    Some("matraIsSounding") => WhenPredicate::MatraIsSounding {
                        matra: matra.unwrap_or(0),
                    },
                    Some("restCountInCycle") => WhenPredicate::RestCountInCycle {
                        op: op.unwrap_or(CountOp::AtLeast),
                        count: count.unwrap_or(0),
                    },
                    Some("soundingCountInCycle") => WhenPredicate::SoundingCountInCycle {
                        op: op.unwrap_or(CountOp::AtLeast),
                        count: count.unwrap_or(0),
                    },
                    _ => WhenPredicate::IsRest,
                })
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(WhenPredicate::IsRest)
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(WhenPredicate::IsRest)
            }

            fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
                Ok(WhenPredicate::IsRest)
            }

            fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E> {
                Ok(WhenPredicate::IsRest)
            }

            fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E> {
                Ok(WhenPredicate::IsRest)
            }

            fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E> {
                Ok(WhenPredicate::IsRest)
            }

            fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E> {
                Ok(WhenPredicate::IsRest)
            }
        }

        deserializer.deserialize_any(WhenPredicateVisitor)
    }
}

impl WhenPredicate {
    fn normalized(self) -> WhenPredicate {
        match self {
            WhenPredicate::GatiIs { gati } => WhenPredicate::GatiIs {
                gati: gati.clamp(1, 32),
            },
            WhenPredicate::MatraIsRest { matra } => WhenPredicate::MatraIsRest {
                matra: matra.min(63),
            },
            WhenPredicate::MatraIsSounding { matra } => WhenPredicate::MatraIsSounding {
                matra: matra.min(63),
            },
            WhenPredicate::RestCountInCycle { op, count } => WhenPredicate::RestCountInCycle {
                op,
                count: count.min(256),
            },
            WhenPredicate::SoundingCountInCycle { op, count } => {
                WhenPredicate::SoundingCountInCycle {
                    op,
                    count: count.min(256),
                }
            }
            other => other,
        }
    }
}

struct LooseString(Option<String>);

impl<'de> Deserialize<'de> for LooseString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct LooseStringVisitor;

        impl Visitor<'_> for LooseStringVisitor {
            type Value = LooseString;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a string")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
                Ok(LooseString(Some(value.to_string())))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
                Ok(LooseString(Some(value)))
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(LooseString(None))
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(LooseString(None))
            }

            fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
                Ok(LooseString(None))
            }

            fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E> {
                Ok(LooseString(None))
            }

            fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E> {
                Ok(LooseString(None))
            }

            fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E> {
                Ok(LooseString(None))
            }
        }

        deserializer.deserialize_any(LooseStringVisitor)
    }
}

struct LooseU32(Option<u32>);

impl LooseU32 {
    fn from_f64(value: f64) -> LooseU32 {
        if !value.is_finite() {
            return LooseU32(None);
        }
        let rounded = value.round();
        if rounded <= 0.0 {
            LooseU32(Some(0))
        } else if rounded >= f64::from(u32::MAX) {
            LooseU32(Some(u32::MAX))
        } else {
            LooseU32(Some(rounded as u32))
        }
    }
}

impl<'de> Deserialize<'de> for LooseU32 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct LooseU32Visitor;

        impl Visitor<'_> for LooseU32Visitor {
            type Value = LooseU32;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an unsigned integer-ish value")
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
                Ok(LooseU32(Some(value.min(u64::from(u32::MAX)) as u32)))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
                Ok(LooseU32(Some(if value <= 0 {
                    0
                } else {
                    (value as u64).min(u64::from(u32::MAX)) as u32
                })))
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E> {
                Ok(LooseU32::from_f64(value))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
                Ok(value
                    .parse::<f64>()
                    .map(LooseU32::from_f64)
                    .unwrap_or(LooseU32(None)))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
                Ok(value
                    .parse::<f64>()
                    .map(LooseU32::from_f64)
                    .unwrap_or(LooseU32(None)))
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(LooseU32(None))
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(LooseU32(None))
            }

            fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
                Ok(LooseU32(None))
            }
        }

        deserializer.deserialize_any(LooseU32Visitor)
    }
}

/// A boolean tree over [`WhenPredicate`]s. v1's single condition is the
/// degenerate `Leaf` case; ALL/ANY/NOT compose predicates at the anchor beat
/// (and cycle-level predicates).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ConditionNode {
    All { nodes: Vec<ConditionNode> },
    Any { nodes: Vec<ConditionNode> },
    Not { node: Box<ConditionNode> },
    Leaf { predicate: WhenPredicate },
}

impl<'de> Deserialize<'de> for ConditionNode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct ConditionNodeVisitor;

        impl<'de> Visitor<'de> for ConditionNodeVisitor {
            type Value = ConditionNode;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a condition tree node")
            }

            fn visit_map<M>(self, mut map: M) -> Result<Self::Value, M::Error>
            where
                M: MapAccess<'de>,
            {
                let mut type_name: Option<String> = None;
                let mut nodes: Vec<ConditionNode> = Vec::new();
                let mut node: Option<ConditionNode> = None;
                let mut predicate: Option<WhenPredicate> = None;

                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "type" => type_name = map.next_value::<LooseString>()?.0,
                        "nodes" => nodes = map.next_value::<LooseNodes>()?.0,
                        "node" => node = Some(map.next_value()?),
                        "predicate" => predicate = Some(map.next_value()?),
                        _ => {
                            let _ = map.next_value::<IgnoredAny>()?;
                        }
                    }
                }

                Ok(match type_name.as_deref() {
                    Some("all") => ConditionNode::All { nodes },
                    Some("any") => ConditionNode::Any { nodes },
                    Some("not") => ConditionNode::Not {
                        node: Box::new(
                            node.unwrap_or_else(|| ConditionNode::leaf(WhenPredicate::IsRest)),
                        ),
                    },
                    Some("leaf") => ConditionNode::leaf(predicate.unwrap_or(WhenPredicate::IsRest)),
                    _ => ConditionNode::leaf(WhenPredicate::IsRest),
                })
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(ConditionNode::leaf(WhenPredicate::IsRest))
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(ConditionNode::leaf(WhenPredicate::IsRest))
            }

            fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
                Ok(ConditionNode::leaf(WhenPredicate::IsRest))
            }

            fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E> {
                Ok(ConditionNode::leaf(WhenPredicate::IsRest))
            }

            fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E> {
                Ok(ConditionNode::leaf(WhenPredicate::IsRest))
            }

            fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E> {
                Ok(ConditionNode::leaf(WhenPredicate::IsRest))
            }

            fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E> {
                Ok(ConditionNode::leaf(WhenPredicate::IsRest))
            }
        }

        deserializer.deserialize_any(ConditionNodeVisitor)
    }
}

struct LooseNodes(Vec<ConditionNode>);

impl<'de> Deserialize<'de> for LooseNodes {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct LooseNodesVisitor;

        impl<'de> Visitor<'de> for LooseNodesVisitor {
            type Value = LooseNodes;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a list of condition tree nodes")
            }

            fn visit_seq<S>(self, mut seq: S) -> Result<Self::Value, S::Error>
            where
                S: SeqAccess<'de>,
            {
                let mut nodes = Vec::new();
                while let Some(node) = seq.next_element()? {
                    nodes.push(node);
                }
                Ok(LooseNodes(nodes))
            }

            fn visit_map<M>(self, mut map: M) -> Result<Self::Value, M::Error>
            where
                M: MapAccess<'de>,
            {
                while let Some(_key) = map.next_key::<IgnoredAny>()? {
                    let _ = map.next_value::<IgnoredAny>()?;
                }
                Ok(LooseNodes(Vec::new()))
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(LooseNodes(Vec::new()))
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(LooseNodes(Vec::new()))
            }

            fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
                Ok(LooseNodes(Vec::new()))
            }

            fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E> {
                Ok(LooseNodes(Vec::new()))
            }

            fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E> {
                Ok(LooseNodes(Vec::new()))
            }

            fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E> {
                Ok(LooseNodes(Vec::new()))
            }

            fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E> {
                Ok(LooseNodes(Vec::new()))
            }
        }

        deserializer.deserialize_any(LooseNodesVisitor)
    }
}

impl ConditionNode {
    pub fn leaf(predicate: WhenPredicate) -> ConditionNode {
        ConditionNode::Leaf { predicate }
    }

    fn node_count(&self) -> usize {
        match self {
            ConditionNode::Leaf { .. } => 1,
            ConditionNode::Not { node } => 1 + node.node_count(),
            ConditionNode::All { nodes } | ConditionNode::Any { nodes } => {
                1 + nodes.iter().map(ConditionNode::node_count).sum::<usize>()
            }
        }
    }

    fn normalized(&self, depth: usize) -> ConditionNode {
        if depth >= MAX_CONDITION_DEPTH {
            // Keep normalization bounded and mirror the frontend: a subtree
            // beyond the evaluator's depth guard collapses to the safe default.
            return ConditionNode::leaf(WhenPredicate::IsRest);
        }
        match self {
            ConditionNode::Leaf { predicate } => ConditionNode::Leaf {
                predicate: predicate.normalized(),
            },
            ConditionNode::Not { node } => ConditionNode::Not {
                node: Box::new(node.normalized(depth + 1)),
            },
            ConditionNode::All { nodes } => {
                let nodes: Vec<ConditionNode> =
                    nodes.iter().map(|n| n.normalized(depth + 1)).collect();
                if nodes.is_empty() {
                    ConditionNode::leaf(WhenPredicate::IsRest)
                } else {
                    ConditionNode::All { nodes }
                }
            }
            ConditionNode::Any { nodes } => {
                let nodes: Vec<ConditionNode> =
                    nodes.iter().map(|n| n.normalized(depth + 1)).collect();
                if nodes.is_empty() {
                    ConditionNode::leaf(WhenPredicate::IsRest)
                } else {
                    ConditionNode::Any { nodes }
                }
            }
        }
    }
}

/// Which source beat(s) the WHEN tree is evaluated at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BeatSelector {
    /// Evaluate only at beat `beat` (the v1 case): at most one candidate / cycle.
    At { beat: u32 },
    /// Evaluate at every beat; a candidate fires at each matching beat.
    AnyBeat,
}

impl<'de> Deserialize<'de> for BeatSelector {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct BeatSelectorVisitor;

        impl<'de> Visitor<'de> for BeatSelectorVisitor {
            type Value = BeatSelector;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a beat selector")
            }

            fn visit_map<M>(self, mut map: M) -> Result<Self::Value, M::Error>
            where
                M: MapAccess<'de>,
            {
                let mut type_name: Option<String> = None;
                let mut beat: Option<u32> = None;
                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "type" => type_name = map.next_value::<LooseString>()?.0,
                        "beat" => beat = map.next_value::<LooseU32>()?.0,
                        _ => {
                            let _ = map.next_value::<IgnoredAny>()?;
                        }
                    }
                }
                Ok(match type_name.as_deref() {
                    Some("anyBeat") => BeatSelector::AnyBeat,
                    _ => BeatSelector::At {
                        beat: beat.unwrap_or(0),
                    },
                })
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(BeatSelector::default())
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(BeatSelector::default())
            }

            fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
                Ok(BeatSelector::default())
            }

            fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E> {
                Ok(BeatSelector::default())
            }

            fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E> {
                Ok(BeatSelector::default())
            }

            fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E> {
                Ok(BeatSelector::default())
            }

            fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E> {
                Ok(BeatSelector::default())
            }
        }

        deserializer.deserialize_any(BeatSelectorVisitor)
    }
}

impl Default for BeatSelector {
    fn default() -> Self {
        BeatSelector::At { beat: 0 }
    }
}

impl BeatSelector {
    fn normalized(self) -> BeatSelector {
        match self {
            BeatSelector::At { beat } => BeatSelector::At { beat: beat.min(63) },
            BeatSelector::AnyBeat => BeatSelector::AnyBeat,
        }
    }
}

/// The WHEN band: where to look + the boolean condition tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhenSpec {
    #[serde(default)]
    pub beats: BeatSelector,
    #[serde(default = "default_condition_node")]
    pub tree: ConditionNode,
}

fn default_condition_node() -> ConditionNode {
    ConditionNode::leaf(WhenPredicate::IsRest)
}

impl WhenSpec {
    /// Upcast a legacy single [`TriggerCondition`] into an equivalent WHEN tree.
    /// (`jathiPulseAtBeat` now anchors at the beat start; sub-beat pulse onset is
    /// a START/quantize concern under the two-decision model — see the plan.)
    pub fn from_legacy_condition(condition: &TriggerCondition) -> WhenSpec {
        let predicate = match condition {
            TriggerCondition::BeatIsRest { .. } => WhenPredicate::IsRest,
            TriggerCondition::BeatIsSounding { .. } => WhenPredicate::IsSounding,
            TriggerCondition::SectionStartAtBeat { .. } => WhenPredicate::IsSectionStart,
            TriggerCondition::GatiIs { gati, .. } => WhenPredicate::GatiIs { gati: *gati },
            TriggerCondition::JathiPulseAtBeat { .. } => WhenPredicate::HasJathiPulse,
        };
        WhenSpec {
            beats: BeatSelector::At {
                beat: condition.beat(),
            },
            tree: ConditionNode::leaf(predicate),
        }
    }

    fn default_spec() -> WhenSpec {
        WhenSpec {
            beats: BeatSelector::At { beat: 0 },
            tree: ConditionNode::leaf(WhenPredicate::IsRest),
        }
    }

    pub fn normalized(&self) -> WhenSpec {
        // Cap pathological node counts (e.g. from a non-UI client) so evaluation
        // stays bounded; collapse an over-large tree to a safe single leaf.
        let tree = if self.tree.node_count() > MAX_CONDITION_NODES {
            ConditionNode::leaf(WhenPredicate::IsRest)
        } else {
            self.tree.normalized(0)
        };
        WhenSpec {
            beats: self.beats.normalized(),
            tree,
        }
    }
}

/// Maximum accept probability, expressed in integer per-mille so the gate roll
/// stays integer and RNG-stable across serde. `1000` ⇒ always accept.
pub const GATE_PROBABILITY_MAX: u16 = 1000;
/// Absolute ceiling for the cooldown span. Keeps a non-UI client from passing an
/// absurd value; nothing structural depends on the exact bound.
pub const GATE_COOLDOWN_CYCLES_CAP: u32 = 4096;

/// The GATE band (Phase C): a stateful + probabilistic acceptance gate applied
/// to a WHEN candidate *before* the re-trigger policy. Pure + deterministic — the
/// probability roll is seeded by stable candidate identity (source cycle + beat)
/// mixed with [`GateSpec::seed`], so it reproduces exactly on recompile/reapply
/// and is independent of how the compile window is split (windowing stays
/// associative).
///
/// Absent (`TriggerConfig::gate == None`) ⇒ every candidate is accepted, i.e.
/// pre-Phase-C behavior. A neutral gate (probability `1000`, no cooldown, no
/// miss-boost) is behaviorally identical to `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateSpec {
    /// Base acceptance probability in integer per-mille, `0..=1000`
    /// (`1000` = always accept before any cooldown). Clamped.
    #[serde(default = "default_gate_probability")]
    pub probability_per_mille: u16,
    /// Minimum number of source cycles between two accepts. `0` ⇒ no cooldown.
    /// A candidate inside the cooldown of the last accept is rejected with no
    /// probability roll, and does not affect the miss-boost streak.
    #[serde(default)]
    pub cooldown_cycles: u32,
    /// Added to the effective probability per consecutive probability-miss, in
    /// per-mille (the sum is capped at `1000`). `0` ⇒ off. Resets to `0` on any
    /// accept, so a run of misses makes the next fire progressively likelier.
    #[serde(default)]
    pub miss_boost_per_mille: u16,
    /// Seed for the gate's probability rolls. Mixed with each candidate's stable
    /// identity; this config field is the roll seed source of truth.
    #[serde(default)]
    pub seed: u64,
}

fn default_gate_probability() -> u16 {
    GATE_PROBABILITY_MAX
}

impl GateSpec {
    /// Clamp every field into a bounded, divide-safe range. Idempotent.
    pub fn normalized(&self) -> GateSpec {
        GateSpec {
            probability_per_mille: self.probability_per_mille.min(GATE_PROBABILITY_MAX),
            cooldown_cycles: self.cooldown_cycles.min(GATE_COOLDOWN_CYCLES_CAP),
            miss_boost_per_mille: self.miss_boost_per_mille.min(GATE_PROBABILITY_MAX),
            seed: self.seed,
        }
    }

    /// The effective accept threshold (per-mille, capped at `1000`) given the
    /// current consecutive-miss streak. Pure.
    pub fn effective_threshold(&self, consecutive_misses: u32) -> u16 {
        let boost = u32::from(self.miss_boost_per_mille).saturating_mul(consecutive_misses);
        u32::from(self.probability_per_mille)
            .saturating_add(boost)
            .min(u32::from(GATE_PROBABILITY_MAX)) as u16
    }
}

/// Largest number of weighted START options accepted (keeps the choice bounded).
pub const MAX_START_OPTIONS: usize = 16;

/// Largest individual weighted START option weight accepted.
pub const MAX_START_WEIGHT: u32 = 1_000_000;

/// One weighted START placement option (Phase D).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightedStart {
    pub alignment: LaunchAlignment,
    /// Relative selection weight. `0` ⇒ never chosen (unless every option is 0,
    /// in which case the first option is used).
    #[serde(default = "default_start_weight")]
    pub weight: u32,
}

fn default_start_weight() -> u32 {
    1
}

/// A weighted, **seeded** START choice (Phase D): per candidate, exactly one
/// option is chosen by an identity-seeded roll — `(seed, source_cycle, beat)` —
/// so the choice is window-split-independent and reproduces on recompile/reapply
/// (the same determinism mechanism the GATE uses). Supersedes
/// [`TriggerConfig::launch_alignment`] when present and non-empty; an empty
/// option list is ignored (the single `launch_alignment` is used).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSelect {
    pub options: Vec<WeightedStart>,
    #[serde(default)]
    pub seed: u64,
}

impl StartSelect {
    /// Clamp the option count and each option's alignment. Idempotent.
    pub fn normalized(&self) -> StartSelect {
        let options = self
            .options
            .iter()
            .take(MAX_START_OPTIONS)
            .map(|o| WeightedStart {
                alignment: o.alignment.normalized(),
                weight: o.weight.min(MAX_START_WEIGHT),
            })
            .collect();
        StartSelect {
            options,
            seed: self.seed,
        }
    }

    /// Total selection weight across options.
    pub fn total_weight(&self) -> u64 {
        self.options.iter().map(|o| u64::from(o.weight)).sum()
    }
}

/// Full per-track trigger configuration. Present only on triggered tracks; a
/// continuous track carries no trigger config.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerConfig {
    /// The track whose resolved cycles are observed. Must be another,
    /// *continuous* track (v1 one-level dependency rule).
    pub source_track_id: String,
    /// Canonical WHEN tree (Phase B). When absent, `condition` is upcast.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<WhenSpec>,
    /// Legacy single condition (v1). Read for back-compat; `normalized()` folds
    /// it into `when` and clears it, so canonical configs only carry `when`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<TriggerCondition>,
    #[serde(default)]
    pub launch_alignment: LaunchAlignment,
    /// Optional snap of the aligned launch tick to a musical grid. `None` ⇒ the
    /// launch lands exactly at the aligned tick (today's behavior).
    #[serde(default)]
    pub launch_quantize: Option<LaunchQuantize>,
    pub lifetime: Lifetime,
    pub re_trigger: ReTrigger,
    pub length: TriggerLength,
    #[serde(default = "default_max_repeats")]
    pub max_repeats: u32,
    /// Optional GATE (Phase C). `None` ⇒ always accept (pre-Phase-C behavior).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate: Option<GateSpec>,
    /// Optional weighted/seeded START choice (Phase D). When present + non-empty,
    /// it supersedes `launch_alignment` per candidate. `None` ⇒ the single
    /// `launch_alignment` is used (pre-Phase-D behavior).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_select: Option<StartSelect>,
}

fn default_max_repeats() -> u32 {
    DEFAULT_MAX_REPEATS
}

impl TriggerConfig {
    /// Clamp all numeric fields into safe, bounded ranges. Idempotent.
    pub fn normalized(&self) -> TriggerConfig {
        let mut cfg = self.clone();
        cfg.max_repeats = if cfg.max_repeats == 0 {
            DEFAULT_MAX_REPEATS
        } else {
            cfg.max_repeats.min(MAX_REPEATS_CAP)
        };
        cfg.lifetime = match cfg.lifetime {
            Lifetime::OnePass => Lifetime::OnePass,
            // A 0-pass repeat is meaningless; coerce to a single pass.
            Lifetime::Repeats { passes } => Lifetime::Repeats {
                passes: passes.clamp(1, cfg.max_repeats),
            },
        };
        cfg.length = match cfg.length {
            TriggerLength::ScoreCycle => TriggerLength::ScoreCycle,
            // A 0-beat fixed phrase would be a divide-by-zero / no-op; floor at 1.
            TriggerLength::FixedBeats { beats } => TriggerLength::FixedBeats {
                beats: beats.clamp(1, 256),
            },
        };
        // Bound the launch offset so retained source history stays finite even
        // for non-UI clients (the frontend clamps to the same ceiling).
        cfg.launch_alignment = cfg.launch_alignment.normalized();
        cfg.launch_quantize = cfg.launch_quantize.map(|q| q.normalized());
        cfg.gate = cfg.gate.map(|g| g.normalized());
        cfg.start_select = cfg
            .start_select
            .take()
            .map(|s| s.normalized())
            .filter(|s| !s.options.is_empty());
        // Resolve the canonical WHEN tree (upcast legacy `condition`, clamp),
        // and clear the legacy field so canonical configs carry only `when`.
        cfg.when = Some(self.effective_when());
        cfg.condition = None;
        cfg
    }

    /// The resolved WHEN tree: `when` if present, else upcast the legacy
    /// `condition`, else a safe default; always normalized.
    pub fn effective_when(&self) -> WhenSpec {
        self.when
            .clone()
            .or_else(|| self.condition.as_ref().map(WhenSpec::from_legacy_condition))
            .unwrap_or_else(WhenSpec::default_spec)
            .normalized()
    }

    /// Total follower phrases a run realizes, after clamping to `max_repeats`.
    pub fn passes(&self) -> u32 {
        self.lifetime.passes().clamp(1, self.max_repeats.max(1))
    }
}

/// Why a triggered track was demoted to continuous during normalization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TriggerRejectReason {
    /// The track's `sourceTrackId` pointed at itself.
    SelfTrigger,
    /// The `sourceTrackId` does not exist among the project's tracks.
    DanglingSource,
    /// The source is itself a triggered track (v1 allows one level only).
    SourceIsTriggered,
    /// A dependency cycle was detected in the trigger graph.
    CycleDetected,
}

impl TriggerRejectReason {
    pub fn message(&self, track_id: &str, source_id: &str) -> String {
        match self {
            TriggerRejectReason::SelfTrigger => {
                format!("track {track_id} cannot trigger on itself; running continuous")
            }
            TriggerRejectReason::DanglingSource => format!(
                "track {track_id} trigger source {source_id} does not exist; running continuous"
            ),
            TriggerRejectReason::SourceIsTriggered => format!(
                "track {track_id} trigger source {source_id} is itself triggered (one-level only); running continuous"
            ),
            TriggerRejectReason::CycleDetected => format!(
                "track {track_id} trigger via {source_id} forms a dependency cycle; running continuous"
            ),
        }
    }
}

/// A warning surfaced by normalization (a rejected/disabled trigger edge).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerWarning {
    pub track_id: String,
    pub source_id: String,
    pub reason: TriggerRejectReason,
    pub message: String,
}

/// Normalized run mode for a single track.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NormalizedMode {
    Continuous,
    Triggered(TriggerConfig),
}

/// Result of normalizing one track's requested mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedTrack {
    pub id: String,
    pub mode: NormalizedMode,
}

/// Result of normalizing the whole project's trigger graph.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedGraph {
    pub tracks: Vec<NormalizedTrack>,
    pub warnings: Vec<TriggerWarning>,
}

impl NormalizedGraph {
    /// The validated trigger config for a track id, if it is triggered.
    pub fn trigger_for(&self, track_id: &str) -> Option<&TriggerConfig> {
        self.tracks.iter().find_map(|track| {
            if track.id != track_id {
                return None;
            }
            match &track.mode {
                NormalizedMode::Triggered(cfg) => Some(cfg),
                NormalizedMode::Continuous => None,
            }
        })
    }
}

/// Normalize a project's requested per-track modes into a safe, validated
/// trigger graph.
///
/// Safe-default rules (every rejected edge falls back to continuous and emits a
/// warning rather than throwing):
/// 1. Self-trigger is rejected.
/// 2. A dangling `sourceTrackId` (no such track) is rejected.
/// 3. A source that is itself triggered is rejected (v1 is **one level deep**).
/// 4. Any residual dependency cycle is detected and the offending edge is
///    disabled.
///
/// Input is `(track_id, requested_trigger)` in track order; output preserves
/// that order.
pub fn normalize_track_modes(requested: &[(String, Option<TriggerConfig>)]) -> NormalizedGraph {
    let ids: Vec<&str> = requested.iter().map(|(id, _)| id.as_str()).collect();
    let id_set: std::collections::HashSet<&str> = ids.iter().copied().collect();
    let normalized_cfgs: Vec<Option<TriggerConfig>> = requested
        .iter()
        .map(|(_, cfg)| cfg.as_ref().map(TriggerConfig::normalized))
        .collect();
    let mut intrinsic_rejects = Vec::with_capacity(requested.len());
    let mut potentially_triggered_ids = std::collections::HashSet::new();

    for ((id, _), cfg) in requested.iter().zip(normalized_cfgs.iter()) {
        let Some(cfg) = cfg else {
            intrinsic_rejects.push(None);
            continue;
        };
        let source = cfg.source_track_id.as_str();
        let reject = if source == id.as_str() {
            Some(TriggerRejectReason::SelfTrigger)
        } else if !id_set.contains(source) {
            Some(TriggerRejectReason::DanglingSource)
        } else {
            None
        };
        if reject.is_none() {
            potentially_triggered_ids.insert(id.as_str());
        }
        intrinsic_rejects.push(reject);
    }

    let mut tracks = Vec::with_capacity(requested.len());
    let mut warnings = Vec::new();

    for (idx, (id, _)) in requested.iter().enumerate() {
        let Some(cfg) = normalized_cfgs[idx].as_ref() else {
            tracks.push(NormalizedTrack {
                id: id.clone(),
                mode: NormalizedMode::Continuous,
            });
            continue;
        };
        let source = cfg.source_track_id.as_str();

        let reject = if intrinsic_rejects[idx].is_some() {
            intrinsic_rejects[idx]
        } else if potentially_triggered_ids.contains(source) {
            // One-level rule: a follower's source must be continuous. A source
            // that is itself triggered would require DAG ordering we do not
            // implement in v1. Edges that were intrinsically impossible (self
            // or dangling) are already demoted to continuous, so they do not
            // poison otherwise valid dependents.
            Some(TriggerRejectReason::SourceIsTriggered)
        } else {
            None
        };

        match reject {
            Some(reason) => {
                warnings.push(TriggerWarning {
                    track_id: id.clone(),
                    source_id: cfg.source_track_id.clone(),
                    reason,
                    message: reason.message(id, &cfg.source_track_id),
                });
                tracks.push(NormalizedTrack {
                    id: id.clone(),
                    mode: NormalizedMode::Continuous,
                });
            }
            None => tracks.push(NormalizedTrack {
                id: id.clone(),
                mode: NormalizedMode::Triggered(cfg.clone()),
            }),
        }
    }

    NormalizedGraph { tracks, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(source: &str) -> TriggerConfig {
        TriggerConfig {
            source_track_id: source.to_string(),
            when: None,
            condition: Some(TriggerCondition::BeatIsRest { beat: 3 }),
            launch_alignment: LaunchAlignment::AtEvent,
            launch_quantize: None,
            lifetime: Lifetime::OnePass,
            re_trigger: ReTrigger::Restart,
            length: TriggerLength::ScoreCycle,
            max_repeats: DEFAULT_MAX_REPEATS,
            gate: None,
            start_select: None,
        }
    }

    #[test]
    fn normalized_clamps_launch_quantize() {
        let mut c = cfg("a");
        c.launch_quantize = Some(LaunchQuantize {
            grid: QuantizeGrid::ReferenceBeatFraction { divisions: 9999 },
            direction: QuantizeDirection::Nearest,
        });
        let n = c.normalized();
        assert_eq!(
            n.launch_quantize,
            Some(LaunchQuantize {
                grid: QuantizeGrid::ReferenceBeatFraction {
                    divisions: MAX_QUANTIZE_DIVISIONS
                },
                direction: QuantizeDirection::Nearest,
            })
        );
        // 0-beat multiple floors to 1; idempotent.
        c.launch_quantize = Some(LaunchQuantize {
            grid: QuantizeGrid::ReferenceBeatMultiple { beats: 0 },
            direction: QuantizeDirection::Next,
        });
        let n = c.normalized();
        assert_eq!(
            n.launch_quantize.unwrap().grid,
            QuantizeGrid::ReferenceBeatMultiple { beats: 1 }
        );
        assert_eq!(n.normalized(), n);
    }

    #[test]
    fn normalized_clamps_after_event_ticks() {
        let mut c = cfg("a");
        c.launch_alignment = LaunchAlignment::AfterEventTicks { ticks: u64::MAX };
        let n = c.normalized();
        assert_eq!(
            n.launch_alignment,
            LaunchAlignment::AfterEventTicks {
                ticks: MAX_AFTER_EVENT_TICKS
            }
        );
        assert_eq!(n.normalized().launch_alignment, n.launch_alignment);
    }

    #[test]
    fn normalized_drops_empty_start_select() {
        let mut c = cfg("a");
        c.start_select = Some(StartSelect {
            options: vec![],
            seed: 42,
        });
        let n = c.normalized();
        assert_eq!(n.start_select, None);
        assert_eq!(n.launch_alignment, LaunchAlignment::AtEvent);
    }

    #[test]
    fn normalized_clamps_start_select_options_and_weight() {
        let s = StartSelect {
            options: (0..(MAX_START_OPTIONS + 1))
                .map(|_| WeightedStart {
                    alignment: LaunchAlignment::AfterEventTicks {
                        ticks: MAX_AFTER_EVENT_TICKS + 1,
                    },
                    weight: MAX_START_WEIGHT + 1,
                })
                .collect(),
            seed: 9,
        }
        .normalized();
        assert_eq!(s.options.len(), MAX_START_OPTIONS);
        assert_eq!(
            s.options[0].alignment,
            LaunchAlignment::AfterEventTicks {
                ticks: MAX_AFTER_EVENT_TICKS
            }
        );
        assert_eq!(s.options[0].weight, MAX_START_WEIGHT);
    }

    #[test]
    fn normalized_clamps_unsafe_values() {
        let mut c = cfg("a");
        c.max_repeats = 0;
        c.lifetime = Lifetime::Repeats { passes: 0 };
        c.length = TriggerLength::FixedBeats { beats: 0 };
        let n = c.normalized();
        assert_eq!(n.max_repeats, DEFAULT_MAX_REPEATS);
        assert_eq!(n.lifetime, Lifetime::Repeats { passes: 1 });
        assert_eq!(n.length, TriggerLength::FixedBeats { beats: 1 });
        // Idempotent.
        assert_eq!(n.normalized(), n);
    }

    #[test]
    fn max_repeats_capped() {
        let mut c = cfg("a");
        c.max_repeats = 99_999;
        c.lifetime = Lifetime::Repeats { passes: 10_000 };
        let n = c.normalized();
        assert_eq!(n.max_repeats, MAX_REPEATS_CAP);
        assert_eq!(
            n.lifetime,
            Lifetime::Repeats {
                passes: MAX_REPEATS_CAP
            }
        );
        assert_eq!(n.passes(), MAX_REPEATS_CAP);
    }

    #[test]
    fn self_trigger_rejected() {
        let req = vec![("a".to_string(), Some(cfg("a")))];
        let g = normalize_track_modes(&req);
        assert!(matches!(g.tracks[0].mode, NormalizedMode::Continuous));
        assert_eq!(g.warnings.len(), 1);
        assert_eq!(g.warnings[0].reason, TriggerRejectReason::SelfTrigger);
    }

    #[test]
    fn dangling_source_rejected() {
        let req = vec![("a".to_string(), Some(cfg("ghost")))];
        let g = normalize_track_modes(&req);
        assert!(matches!(g.tracks[0].mode, NormalizedMode::Continuous));
        assert_eq!(g.warnings[0].reason, TriggerRejectReason::DanglingSource);
    }

    #[test]
    fn one_level_only_source_must_be_continuous() {
        // a triggered by b, b triggered by c. b's source c is continuous (ok),
        // a's source b is triggered (rejected).
        let req = vec![
            ("a".to_string(), Some(cfg("b"))),
            ("b".to_string(), Some(cfg("c"))),
            ("c".to_string(), None),
        ];
        let g = normalize_track_modes(&req);
        assert!(matches!(g.tracks[0].mode, NormalizedMode::Continuous));
        assert!(matches!(g.tracks[1].mode, NormalizedMode::Triggered(_)));
        assert!(matches!(g.tracks[2].mode, NormalizedMode::Continuous));
        assert_eq!(g.warnings.len(), 1);
        assert_eq!(g.warnings[0].track_id, "a");
        assert_eq!(g.warnings[0].reason, TriggerRejectReason::SourceIsTriggered);
    }

    #[test]
    fn source_demoted_by_dangling_trigger_can_be_used_as_continuous_source() {
        // source's own trigger is impossible, so source runs continuous; follow
        // should still be allowed to trigger from that continuous track.
        let req = vec![
            ("follow".to_string(), Some(cfg("source"))),
            ("source".to_string(), Some(cfg("ghost"))),
        ];
        let g = normalize_track_modes(&req);
        assert!(matches!(g.tracks[0].mode, NormalizedMode::Triggered(_)));
        assert!(matches!(g.tracks[1].mode, NormalizedMode::Continuous));
        assert_eq!(g.warnings.len(), 1);
        assert_eq!(g.warnings[0].track_id, "source");
        assert_eq!(g.warnings[0].reason, TriggerRejectReason::DanglingSource);
    }

    #[test]
    fn mutual_trigger_cycle_is_broken() {
        // a<->b mutual: each sees the other as triggered, so both are demoted.
        let req = vec![
            ("a".to_string(), Some(cfg("b"))),
            ("b".to_string(), Some(cfg("a"))),
        ];
        let g = normalize_track_modes(&req);
        assert!(matches!(g.tracks[0].mode, NormalizedMode::Continuous));
        assert!(matches!(g.tracks[1].mode, NormalizedMode::Continuous));
        assert_eq!(g.warnings.len(), 2);
    }

    #[test]
    fn valid_one_level_trigger_survives() {
        let req = vec![
            ("lead".to_string(), None),
            ("follow".to_string(), Some(cfg("lead"))),
        ];
        let g = normalize_track_modes(&req);
        assert!(g.warnings.is_empty());
        let t = g.trigger_for("follow").expect("triggered");
        assert_eq!(t.source_track_id, "lead");
    }

    #[test]
    fn config_round_trips_through_json() {
        let c = cfg("lead");
        let json = serde_json::to_string(&c).unwrap();
        let back: TriggerConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
        // camelCase on the wire.
        assert!(json.contains("sourceTrackId"));
        assert!(json.contains("launchAlignment"));
    }

    #[test]
    fn launch_alignment_defaults_to_at_event_when_missing() {
        let json = r#"{
            "sourceTrackId": "lead",
            "condition": { "type": "beatIsRest", "beat": 3 },
            "lifetime": { "type": "onePass" },
            "reTrigger": "restart",
            "length": { "type": "scoreCycle" }
        }"#;
        let c: TriggerConfig = serde_json::from_str(json).unwrap();
        assert_eq!(c.launch_alignment, LaunchAlignment::AtEvent);
        assert_eq!(c.max_repeats, DEFAULT_MAX_REPEATS);
    }

    #[test]
    fn legacy_condition_upcasts_to_a_single_leaf_when_tree() {
        // A v1 patch carries only `condition`; effective_when upcasts it.
        let json = r#"{
            "sourceTrackId": "lead",
            "condition": { "type": "gatiIs", "beat": 2, "gati": 5 },
            "lifetime": { "type": "onePass" },
            "reTrigger": "restart",
            "length": { "type": "scoreCycle" }
        }"#;
        let c: TriggerConfig = serde_json::from_str(json).unwrap();
        assert!(c.when.is_none());
        let when = c.effective_when();
        assert_eq!(when.beats, BeatSelector::At { beat: 2 });
        assert_eq!(
            when.tree,
            ConditionNode::leaf(WhenPredicate::GatiIs { gati: 5 })
        );
        // normalized() folds the legacy condition into `when` and clears it, so
        // the canonical config serializes only `when`.
        let n = c.normalized();
        assert_eq!(n.when, Some(when));
        assert!(n.condition.is_none());
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("\"when\""));
        assert!(!json.contains("\"condition\""));
    }

    #[test]
    fn when_tree_round_trips_camelcase() {
        let when = WhenSpec {
            beats: BeatSelector::AnyBeat,
            tree: ConditionNode::All {
                nodes: vec![
                    ConditionNode::leaf(WhenPredicate::IsRest),
                    ConditionNode::Not {
                        node: Box::new(ConditionNode::leaf(WhenPredicate::IsSectionStart)),
                    },
                    ConditionNode::leaf(WhenPredicate::RestCountInCycle {
                        op: CountOp::AtLeast,
                        count: 2,
                    }),
                ],
            },
        };
        let json = serde_json::to_string(&when).unwrap();
        assert!(json.contains("anyBeat"));
        assert!(json.contains("restCountInCycle"));
        assert!(json.contains("atLeast"));
        let back: WhenSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(when, back);
    }

    #[test]
    fn when_normalize_clamps_and_caps() {
        let when = WhenSpec {
            beats: BeatSelector::At { beat: 9999 },
            tree: ConditionNode::leaf(WhenPredicate::GatiIs { gati: 9999 }),
        };
        let n = when.normalized();
        assert_eq!(n.beats, BeatSelector::At { beat: 63 });
        assert_eq!(
            n.tree,
            ConditionNode::leaf(WhenPredicate::GatiIs { gati: 32 })
        );
        // Idempotent.
        assert_eq!(n.normalized(), n);

        // An over-large tree collapses to a safe single leaf.
        let huge = ConditionNode::All {
            nodes: (0..MAX_CONDITION_NODES + 10)
                .map(|_| ConditionNode::leaf(WhenPredicate::IsRest))
                .collect(),
        };
        let capped = WhenSpec {
            beats: BeatSelector::default(),
            tree: huge,
        }
        .normalized();
        assert_eq!(capped.tree, ConditionNode::leaf(WhenPredicate::IsRest));

        // Empty combinators must not become surprising "always" / "never"
        // predicates; they collapse to the same safe default as other invalid
        // trees and preserve the beat selector.
        let empty_all = WhenSpec {
            beats: BeatSelector::AnyBeat,
            tree: ConditionNode::All { nodes: vec![] },
        }
        .normalized();
        assert_eq!(empty_all.beats, BeatSelector::AnyBeat);
        assert_eq!(empty_all.tree, ConditionNode::leaf(WhenPredicate::IsRest));

        let deep = (0..MAX_CONDITION_DEPTH).fold(
            ConditionNode::leaf(WhenPredicate::GatiIs { gati: 9999 }),
            |node, _| ConditionNode::Not {
                node: Box::new(node),
            },
        );
        let bounded = WhenSpec {
            beats: BeatSelector::default(),
            tree: deep,
        }
        .normalized();
        assert_eq!(bounded.normalized(), bounded);
    }

    #[test]
    fn when_deserializes_hostile_tags_to_safe_bounded_values() {
        let json = r#"{
            "beats": { "type": "bogusBeatSelector", "beat": 9999 },
            "tree": {
                "type": "all",
                "nodes": [
                    { "type": "bogusNode" },
                    { "type": "leaf", "predicate": { "type": "gatiIs", "gati": 9999 } },
                    {
                        "type": "not",
                        "node": {
                            "type": "leaf",
                            "predicate": {
                                "type": "restCountInCycle",
                                "op": "notAnOp",
                                "count": 9999
                            }
                        }
                    },
                    { "type": "any", "nodes": "not an array" }
                ]
            }
        }"#;
        let when: WhenSpec = serde_json::from_str(json).unwrap();
        let normalized = when.normalized();
        assert_eq!(normalized.beats, BeatSelector::At { beat: 63 });
        let ConditionNode::All { nodes } = normalized.tree else {
            panic!("expected all tree");
        };
        assert_eq!(nodes[0], ConditionNode::leaf(WhenPredicate::IsRest));
        assert_eq!(
            nodes[1],
            ConditionNode::leaf(WhenPredicate::GatiIs { gati: 32 })
        );
        assert_eq!(
            nodes[2],
            ConditionNode::Not {
                node: Box::new(ConditionNode::leaf(WhenPredicate::RestCountInCycle {
                    op: CountOp::AtLeast,
                    count: 256,
                })),
            }
        );
        assert_eq!(nodes[3], ConditionNode::leaf(WhenPredicate::IsRest));
    }
}
