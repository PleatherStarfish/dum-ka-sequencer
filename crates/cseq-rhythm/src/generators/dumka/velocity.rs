//! Metric velocity (M4 metric dynamics): the strong/weak hierarchy that
//! already drives placement finally reaches loudness.
//!
//! Every sounding generated onset is classified into one of three tiers —
//! Strong, Medium, Weak — and draws its MIDI velocity uniformly from that
//! tier's authored range. The tier source is either **auto** (thresholds
//! over the same Barlow indispensability permutation every operator uses)
//! or **manual** (an authored tier per seed-grid slot; slots the depth
//! palette refines *between* seed slots are Weak by definition — they are
//! sub-grid). The draw is identity-seeded per (seed, cycle, slot), so
//! replay stays byte-identical and no draw-order coupling exists between
//! onsets. `Off` (the serde default) stamps nothing and preserves the
//! historical authored-accent inheritance byte-for-byte.

use serde::{Deserialize, Serialize};

use crate::generators::GeneratedSpan;
use crate::{mix_seed, SplitMix64};

/// Identity salt for the per-onset velocity draw. Pinned like every other
/// decision-domain salt (see evolve.rs); the e2e mock mirrors it bit-exactly.
pub const SALT_METRIC_VELOCITY: u64 = 0xD0A1_5EED_0012_0012;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MetricVelocityMode {
    /// Feature off: cells carry no generated velocity and realization keeps
    /// the authored-leaf inheritance. The byte-compatibility anchor.
    #[default]
    Off,
    /// Tiers derived from the Barlow indispensability permutation via the
    /// authored percent thresholds.
    Auto,
    /// Tiers authored per seed-grid slot in `manual_tiers`.
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MetricTier {
    Strong,
    Medium,
    Weak,
}

/// Inclusive MIDI velocity range for one tier (1-127, min ≤ max; a single
/// value is expressed as min == max).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VelocityRange {
    pub min: u8,
    pub max: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricVelocity {
    #[serde(default)]
    pub mode: MetricVelocityMode,
    #[serde(default = "default_strong_range")]
    pub strong: VelocityRange,
    #[serde(default = "default_medium_range")]
    pub medium: VelocityRange,
    #[serde(default = "default_weak_range")]
    pub weak: VelocityRange,
    /// Auto mode: the strongest `autoStrongPercent`% of working-grid slots
    /// (by indispensability) are Strong.
    #[serde(default = "default_auto_strong_percent")]
    pub auto_strong_percent: u32,
    /// Auto mode: the next `autoMediumPercent`% are Medium; the rest Weak.
    #[serde(default = "default_auto_medium_percent")]
    pub auto_medium_percent: u32,
    /// Manual mode: one tier per seed-grid slot
    /// (`cycle beats × seed Subdivision` entries).
    #[serde(default)]
    pub manual_tiers: Vec<MetricTier>,
}

impl Default for MetricVelocity {
    fn default() -> Self {
        Self {
            mode: MetricVelocityMode::Off,
            strong: default_strong_range(),
            medium: default_medium_range(),
            weak: default_weak_range(),
            auto_strong_percent: default_auto_strong_percent(),
            auto_medium_percent: default_auto_medium_percent(),
            manual_tiers: Vec::new(),
        }
    }
}

const fn default_strong_range() -> VelocityRange {
    VelocityRange { min: 100, max: 116 }
}

const fn default_medium_range() -> VelocityRange {
    VelocityRange { min: 76, max: 92 }
}

const fn default_weak_range() -> VelocityRange {
    VelocityRange { min: 52, max: 68 }
}

const fn default_auto_strong_percent() -> u32 {
    25
}

const fn default_auto_medium_percent() -> u32 {
    35
}

impl MetricVelocity {
    pub fn is_active(&self) -> bool {
        self.mode != MetricVelocityMode::Off
    }

    pub fn range(&self, tier: MetricTier) -> VelocityRange {
        match tier {
            MetricTier::Strong => self.strong,
            MetricTier::Medium => self.medium,
            MetricTier::Weak => self.weak,
        }
    }
}

/// Pinned integer weights of the auto-mode composite strength. Base is the
/// working-grid Barlow rank; run is the onset's position inside its
/// equal-spacing run scored by that run-length's own Barlow ordering (the
/// quintuplet profile for 5, the septuplet profile for 7, …); context is the
/// underlying beat strength linearly interpolated at the onset's temporal
/// position — the accent the meter would give this moment if the beats were
/// not being spanned. On beat-aligned material all three agree; on a
/// beat-spanning tuplet, base alone is constant across the run (every
/// mid-tuplet slot sits in the deepest stratum) and the other two supply the
/// shifting, metrically-aware profile.
const COMPOSITE_BASE_WEIGHT: u64 = 40;
const COMPOSITE_RUN_WEIGHT: u64 = 30;
const COMPOSITE_CONTEXT_WEIGHT: u64 = 30;

/// Minimum equal-spacing run length that carries its own accent profile.
const MIN_RUN_LENGTH: usize = 3;

fn normalized_milli(rank: u32, count: usize) -> u64 {
    if count <= 1 {
        return 100_000;
    }
    u64::from(rank) * 100_000 / (count as u64 - 1)
}

/// The internal accent ordering of a k-note group: Barlow indispensability
/// of k top-level beats when k stratifies over the published primes, else a
/// first-note-strongest descending fallback.
fn run_profile(k: usize) -> Vec<u32> {
    use super::barlow::{indispensability, stratification};
    let k32 = u32::try_from(k).unwrap_or(u32::MAX);
    stratification(k32, 1)
        .map(|strata| indispensability(&strata))
        .unwrap_or_else(|| (0..k).map(|i| (k - 1 - i) as u32).collect())
}

/// Composite auto strengths for one cycle's sorted onset slots, in milli
/// (0..=100_000), parallel to `onset_slots`.
pub fn composite_strengths(
    onset_slots: &[u32],
    ranks: &[u32],
    total_beats: u32,
    working_subdivision: u32,
) -> Vec<u64> {
    let slot_count = ranks.len();
    let base = |slot: u32| normalized_milli(ranks[slot as usize], slot_count);
    let beat_norm = |beat: u32| -> u64 {
        let beat_slot = (beat % total_beats.max(1)) * working_subdivision;
        base(beat_slot)
    };

    // Maximal equal-spacing runs (constant inter-onset gap, length ≥ 3):
    // run_component[i] = the onset's position scored by the run-length
    // profile; onsets outside any run keep their base as the neutral value.
    let mut run_component: Vec<Option<u64>> = vec![None; onset_slots.len()];
    let mut start = 0;
    while start + 1 < onset_slots.len() {
        let gap = onset_slots[start + 1] - onset_slots[start];
        let mut end = start + 1;
        while end + 1 < onset_slots.len() && onset_slots[end + 1] - onset_slots[end] == gap {
            end += 1;
        }
        let length = end - start + 1;
        if gap > 0 && length >= MIN_RUN_LENGTH {
            let profile = run_profile(length);
            for (position, component) in run_component[start..=end].iter_mut().enumerate() {
                *component = Some(normalized_milli(profile[position], length));
            }
            start = end;
        } else {
            start += 1;
        }
    }

    onset_slots
        .iter()
        .zip(run_component)
        .map(|(&slot, run)| {
            let base_milli = base(slot);
            let run_milli = run.unwrap_or(base_milli);
            let beat = slot / working_subdivision.max(1);
            let offset = u64::from(slot % working_subdivision.max(1));
            let width = u64::from(working_subdivision.max(1));
            let context_milli =
                (beat_norm(beat) * (width - offset) + beat_norm(beat + 1) * offset) / width;
            (COMPOSITE_BASE_WEIGHT * base_milli
                + COMPOSITE_RUN_WEIGHT * run_milli
                + COMPOSITE_CONTEXT_WEIGHT * context_milli)
                / 100
        })
        .collect()
}

/// Auto tiers for one cycle's sorted onset slots: the strongest
/// `strong_percent`% of the cycle's NOTES (by composite strength, ties to
/// the earlier slot) are Strong, the next `medium_percent`% Medium, the
/// rest Weak.
pub fn auto_tiers(
    onset_slots: &[u32],
    ranks: &[u32],
    total_beats: u32,
    working_subdivision: u32,
    strong_percent: u32,
    medium_percent: u32,
) -> Vec<MetricTier> {
    let strengths = composite_strengths(onset_slots, ranks, total_beats, working_subdivision);
    let count = onset_slots.len();
    let mut order: Vec<usize> = (0..count).collect();
    order.sort_by_key(|&index| (std::cmp::Reverse(strengths[index]), onset_slots[index]));
    let strong_count = (u64::from(strong_percent) * count as u64).div_ceil(100) as usize;
    let medium_count = (u64::from(medium_percent) * count as u64).div_ceil(100) as usize;
    let mut tiers = vec![MetricTier::Weak; count];
    for (position, &index) in order.iter().enumerate() {
        tiers[index] = if position < strong_count {
            MetricTier::Strong
        } else if position < strong_count + medium_count {
            MetricTier::Medium
        } else {
            MetricTier::Weak
        };
    }
    tiers
}

/// Tier of one working-grid slot under an authored per-seed-slot map.
/// Working slots that coincide with a seed slot take its authored tier;
/// palette-refined slots strictly between seed slots are Weak (sub-grid by
/// definition).
pub fn manual_tier(manual_tiers: &[MetricTier], slot: u32, refine: u32) -> MetricTier {
    if refine == 0 || slot % refine != 0 {
        return MetricTier::Weak;
    }
    manual_tiers
        .get((slot / refine) as usize)
        .copied()
        .unwrap_or(MetricTier::Weak)
}

/// The identity-seeded velocity for one onset slot: uniform in the tier's
/// inclusive range, keyed by (seed, cycle, slot) — never by draw order.
pub fn velocity_draw(seed_value: u64, cycle: u64, slot: u32, range: VelocityRange) -> u8 {
    let width = u64::from(range.max.saturating_sub(range.min));
    let mut rng = SplitMix64::new(mix_seed(
        seed_value ^ SALT_METRIC_VELOCITY ^ u64::from(slot),
        cycle,
    ));
    range.min.saturating_add(rng.next_below(width + 1) as u8)
}

/// Stamp `generated_velocity` onto every sounding chain-start cell. Tied
/// continuations and rests stay `None`: only note-ons carry a velocity.
///
/// Cells live on the structural span grid, which may be an integer multiple
/// of the generator's working grid (Apply-structure allows a multiplied
/// Subdivision). Onsets always land on working-grid boundaries, so the span
/// position converts exactly; anything off the working grid is left alone
/// defensively.
#[allow(clippy::too_many_arguments)] // resolver seam context, same as evolve
pub fn stamp_metric_velocities(
    spans: &mut [GeneratedSpan],
    config: &MetricVelocity,
    seed_value: u64,
    cycle: u64,
    total_beats: u32,
    working_subdivision: u32,
    seed_subdivision: u32,
    ranks: Option<&[u32]>,
) {
    if !config.is_active() {
        return;
    }
    let working_slots = total_beats.saturating_mul(working_subdivision);
    let span_slots: u32 = spans.iter().map(|span| span.span_len).sum();
    if working_slots == 0 || span_slots == 0 || span_slots % working_slots != 0 {
        return;
    }
    let multiplier = (span_slots / working_slots).max(1);
    let refine = if seed_subdivision == 0 {
        1
    } else {
        working_subdivision / seed_subdivision.max(1)
    };

    // Pass 1: the cycle's stampable note-ons in temporal order.
    let mut onsets: Vec<(usize, usize, u32)> = Vec::new();
    let mut base = 0u32;
    for (span_index, span) in spans.iter().enumerate() {
        for (cell_index, cell) in span.cells.iter().enumerate() {
            if cell.rest || cell.tied_from_previous {
                continue;
            }
            let span_position = base + cell.start;
            if span_position % multiplier != 0 {
                continue;
            }
            let slot = span_position / multiplier;
            if ranks.is_some_and(|ranks| slot as usize >= ranks.len()) {
                continue;
            }
            onsets.push((span_index, cell_index, slot));
        }
        base += span.span_len;
    }
    if onsets.is_empty() {
        return;
    }

    // Pass 2: tiers. Auto scores each note by the composite strength (base
    // grid rank × its run's internal profile × underlying beat context) and
    // takes percentiles over the cycle's notes; Manual reads the authored
    // seed-grid map directly.
    let tiers: Vec<MetricTier> = match config.mode {
        MetricVelocityMode::Off => unreachable!("guarded by is_active"),
        MetricVelocityMode::Auto => {
            let Some(ranks) = ranks else {
                // Unsupported Barlow grid is rejected by validation before
                // resolution; never stamp half a cycle.
                return;
            };
            let slots: Vec<u32> = onsets.iter().map(|&(_, _, slot)| slot).collect();
            auto_tiers(
                &slots,
                ranks,
                total_beats,
                working_subdivision,
                config.auto_strong_percent,
                config.auto_medium_percent,
            )
        }
        MetricVelocityMode::Manual => onsets
            .iter()
            .map(|&(_, _, slot)| manual_tier(&config.manual_tiers, slot, refine))
            .collect(),
    };

    // Pass 3: stamp the identity-seeded draw per note.
    for (&(span_index, cell_index, slot), &tier) in onsets.iter().zip(tiers.iter()) {
        spans[span_index].cells[cell_index].generated_velocity =
            Some(velocity_draw(seed_value, cycle, slot, config.range(tier)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generators::dumka::barlow::{indispensability, stratification};

    fn ranks_for(beats: u32, subdivision: u32) -> Vec<u32> {
        indispensability(&stratification(beats, subdivision).expect("supported grid"))
    }

    #[test]
    fn auto_tiers_partition_the_cycle_notes_by_composite_strength() {
        // 4 beats × subdivision 1, all four beats sounding: on beat-aligned
        // material the composite reduces to the Barlow hierarchy. Strong 25%
        // of 4 notes = 1, medium 35% = 2.
        let ranks = ranks_for(4, 1);
        let tiers = auto_tiers(&[0, 1, 2, 3], &ranks, 4, 1, 25, 35);
        let strong = tiers.iter().filter(|&&t| t == MetricTier::Strong).count();
        let medium = tiers.iter().filter(|&&t| t == MetricTier::Medium).count();
        assert_eq!(strong, 1);
        assert_eq!(medium, 2);
        assert_eq!(tiers[0], MetricTier::Strong);
    }

    #[test]
    fn beat_spanning_quintuplet_gets_a_shifting_non_flat_profile() {
        // The reported case: five equal notes across two beats
        // ("[x x x x x]@2"): working grid 2 beats × 5, onsets every 2 slots.
        // Pure grid ranks make every mid-tuplet note identical (all sit in
        // the deepest stratum) — the composite must differentiate them
        // through the quintuplet's own profile and the underlying beat
        // context (note 4 leans on beat 2's accent, notes 2/5 trail).
        let ranks = ranks_for(2, 5);
        let onsets = [0u32, 2, 4, 6, 8];
        let strengths = composite_strengths(&onsets, &ranks, 2, 5);
        // Non-flat beyond the downbeat: the four mid-tuplet notes must not
        // all share one strength.
        let mid: std::collections::BTreeSet<u64> = strengths[1..].iter().copied().collect();
        assert!(
            mid.len() >= 3,
            "mid-tuplet notes collapsed to {mid:?} — the flat-velocity bug"
        );
        // The downbeat stays the strongest single note.
        assert!(strengths[0] > *strengths[1..].iter().max().unwrap());
        // Pinned composite vector: the mock and TS mirrors reproduce these
        // exact values.
        assert_eq!(strengths, vec![100_000, 55_332, 67_610, 39_277, 56_999]);
        // With defaults (25/35) the five notes split 2 strong / 2 medium /
        // 1 weak — a real profile, not one downbeat over a flat floor.
        let tiers = auto_tiers(&onsets, &ranks, 2, 5, 25, 35);
        assert_eq!(
            tiers,
            vec![
                MetricTier::Strong,
                MetricTier::Medium,
                MetricTier::Strong,
                MetricTier::Weak,
                MetricTier::Medium,
            ]
        );
    }

    #[test]
    fn manual_tiers_cover_seed_slots_and_refined_slots_are_weak() {
        let tiers = [
            MetricTier::Strong,
            MetricTier::Weak,
            MetricTier::Medium,
            MetricTier::Weak,
        ];
        // Working 12 over seed subdivision 4-beat×1 → refine 3: slots 0,3,6,9
        // take authored tiers; everything between is Weak.
        assert_eq!(manual_tier(&tiers, 0, 3), MetricTier::Strong);
        assert_eq!(manual_tier(&tiers, 3, 3), MetricTier::Weak);
        assert_eq!(manual_tier(&tiers, 6, 3), MetricTier::Medium);
        assert_eq!(manual_tier(&tiers, 1, 3), MetricTier::Weak);
        assert_eq!(manual_tier(&tiers, 7, 3), MetricTier::Weak);
    }

    #[test]
    fn velocity_draws_are_slot_keyed_in_range_and_pinned() {
        let range = VelocityRange { min: 100, max: 116 };
        for slot in 0..16u32 {
            let v = velocity_draw(20_260_818, 3, slot, range);
            assert!((100..=116).contains(&v), "slot {slot} drew {v}");
            // Slot-keyed: identical inputs replay identically.
            assert_eq!(v, velocity_draw(20_260_818, 3, slot, range));
        }
        // Pinned vectors: the e2e mock mirrors these exact bytes.
        let pinned: Vec<u8> = (0..4u32)
            .map(|slot| velocity_draw(20_260_818, 3, slot, range))
            .collect();
        assert_eq!(pinned, vec![110, 102, 112, 101]);
        // A degenerate range is a constant.
        let constant = VelocityRange { min: 96, max: 96 };
        assert_eq!(velocity_draw(1, 1, 0, constant), 96);
    }
}
