//! Sioros–Guedes syncopation transformations.
//!
//! Primary source: Georgios Sioros, *Syncopation as Transformation*, PhD
//! dissertation, University of Porto, 2015, chapter 4 (advisor Carlos
//! Guedes; condensed in the Springer LNCS chapter of the same title, CMMR
//! 2013 post-proceedings). The operators here follow its pseudocode
//! (§4.2.1, §4.2.2) with one documented correction: the printed vector line
//! `type = Template[pos] − Template[precedingOn]` has its operands
//! transposed relative to every worked example in the chapter (Figs 4-7,
//! 4-19), so this module computes `type = level(source) − level(target)`,
//! which is nonnegative.
//!
//! Model summary:
//! - The **metrical template** assigns each pulse the index of the slowest
//!   stratification level containing it (0 = cycle start; higher = faster),
//!   the Longuet-Higgins & Lee structure kin.rhythmicator also uses.
//! - **De-syncopation** shifts an onset FORWARD onto the following silent
//!   stronger pulse where its syncopation is felt (LHL/Huron: syncopation
//!   lives in the silent strong pulse preceded by a weaker onset).
//! - **Syncopation** anticipates an onset BACKWARD from a strong pulse onto
//!   a silent preceding pulse `type` levels faster.
//! - Each step is the **transformation vector** `{pulse, type}` attributed
//!   to the strong pulse, making the pair exactly inverse; compound moves
//!   are ordered vector arrays inverted by reversing order.
//! - **Blocking**: onsets never hop over other onsets and never land on an
//!   occupied pulse (both would break the 1-1 correspondence); a type-0
//!   (same-level) shift is only reachable inside a ternary stratum and is
//!   forbidden at or above the beat level.
//!
//! Patterns here are cyclic: the scan wraps, so the canonical anacrusis —
//! an onset just before the cycle start syncopating against the downbeat —
//! is expressible, matching the dissertation's beat window that "ends ON
//! the beat and includes all preceding pulses".

use super::plan::SlotRange;

/// The metrical level of every pulse on the grid described by `strata`
/// (outermost first, as produced by [`super::barlow::stratification`]).
/// Level 0 is the cycle start; each deeper stratum adds one level.
pub fn metrical_levels(strata: &[u32]) -> Vec<u32> {
    let n: u32 = strata.iter().product::<u32>().max(1);
    // The finest pulses sit on the deepest level (= strata count); each
    // stratum d creates the level d+1 pulses at multiples of its period,
    // and the cycle start alone is level 0.
    let mut levels = vec![strata.len() as u32; n as usize];
    let mut period = n;
    for (depth, &q) in strata.iter().enumerate() {
        period /= q;
        let level = depth as u32 + 1;
        for slot in (0..n).step_by(period.max(1) as usize) {
            let entry = &mut levels[slot as usize];
            *entry = (*entry).min(level);
        }
    }
    levels[0] = 0;
    levels
}

/// One reversible transformation step: `pulse` is always the STRONG pulse
/// (the syncopation's origin / the felt silent pulse), `kind` is the
/// metrical-level difference to the faster pulse ("type" in the paper).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SiorosVector {
    pub pulse: u32,
    pub kind: u32,
}

fn is_onset(onsets: &[u32], slot: u32) -> bool {
    onsets.binary_search(&slot).is_ok()
}

fn wrap_back(slot: u32, n: u32) -> u32 {
    (slot + n - 1) % n
}

/// `Find_Preceding_Onset` (§4.2.2), tightened so the inverse is exact: from
/// the silent strong pulse at `pulse`, walk back across silent, strictly
/// weaker pulses to the nearest onset; the grab is legal only when the
/// source is strictly deeper than every silent pulse crossed. (The
/// dissertation's transcribed walk admits a grab across a silent pulse of
/// the source's own level — e.g. onset 1, silent 2, felt pulse 3 in 6/8 —
/// whose reversal then lands on the crossed pulse instead of the source,
/// contradicting the chapter's 1-1 reversibility guarantee; the strict rule
/// restores it, and the crossed configuration remains reachable as the
/// compound type-0-then-type-1 chain the worked example Fig 4-19 shows.)
fn find_preceding_onset(onsets: &[u32], template: &[u32], pulse: u32) -> Option<u32> {
    let n = template.len() as u32;
    let lmin = template[pulse as usize];
    let mut p = wrap_back(pulse, n);
    let mut min_silent_level = u32::MAX;
    let mut steps = 1;
    while template[p as usize] > lmin && !is_onset(onsets, p) && steps < n {
        min_silent_level = min_silent_level.min(template[p as usize]);
        p = wrap_back(p, n);
        steps += 1;
    }
    (is_onset(onsets, p) && template[p as usize] > lmin && template[p as usize] < min_silent_level)
        .then_some(p)
}

/// `Find_Preceding_Pulse` (§4.2.1): from the onset's strong pulse, walk back
/// across silent, strictly weaker, non-target pulses to the first silent
/// pulse of exactly the target level.
fn find_preceding_pulse(
    onsets: &[u32],
    template: &[u32],
    pulse: u32,
    target_level: u32,
) -> Option<u32> {
    let n = template.len() as u32;
    let lmin = template[pulse as usize];
    let mut p = wrap_back(pulse, n);
    let mut steps = 1;
    while template[p as usize] > lmin
        && !is_onset(onsets, p)
        && template[p as usize] != target_level
        && steps < n
    {
        p = wrap_back(p, n);
        steps += 1;
    }
    (!is_onset(onsets, p) && template[p as usize] == target_level).then_some(p)
}

/// De-syncopate the syncopation felt at the silent strong `pulse`: move the
/// qualifying preceding onset forward onto it. Returns the moved-from slot
/// and the vector `{pulse, level(source) − level(pulse)}` whose
/// [`syncopation_target`] application restores the input exactly. The
/// type-0 branch mirrors syncopation's ternary rule: a same-level immediate
/// predecessor may step forward inside a ternary stratum (never at or above
/// the beat level), which is how the worked example's `{4,0}` vectors arise.
pub fn desyncopate_at(
    onsets: &[u32],
    template: &[u32],
    pulse: u32,
    beat_level: u32,
) -> Option<(u32, SiorosVector)> {
    if pulse as usize >= template.len() || is_onset(onsets, pulse) {
        return None;
    }
    let n = template.len() as u32;
    let level = template[pulse as usize];
    let predecessor = wrap_back(pulse, n);
    if level > beat_level
        && template[predecessor as usize] == level
        && is_onset(onsets, predecessor)
    {
        return Some((predecessor, SiorosVector { pulse, kind: 0 }));
    }
    let source = find_preceding_onset(onsets, template, pulse)?;
    Some((
        source,
        SiorosVector {
            pulse,
            kind: template[source as usize] - template[pulse as usize],
        },
    ))
}

/// Syncopate the onset at `vector.pulse` backward onto the silent preceding
/// pulse `vector.kind` levels faster. `beat_level` is the template level
/// whose period is one platform beat; type-0 shifts are forbidden at or
/// above it (the dissertation allows them only inside ternary subdivisions,
/// never at the beat level — the walk itself enforces the ternary
/// reachability). Returns the landing slot.
pub fn syncopation_target(
    onsets: &[u32],
    template: &[u32],
    vector: SiorosVector,
    beat_level: u32,
) -> Option<u32> {
    if vector.pulse as usize >= template.len() || !is_onset(onsets, vector.pulse) {
        return None;
    }
    let origin_level = template[vector.pulse as usize];
    if vector.kind == 0 && origin_level <= beat_level {
        return None;
    }
    let target_level = origin_level + vector.kind;
    if target_level > template.iter().copied().max().unwrap_or(0) {
        return None;
    }
    find_preceding_pulse(onsets, template, vector.pulse, target_level)
}

/// Every silent strong pulse whose de-syncopation is legal right now, in
/// ascending pulse order (deterministic for identity-seeded selection).
pub fn legal_desyncopations(
    onsets: &[u32],
    template: &[u32],
    beat_level: u32,
    window: Option<SlotRange>,
) -> Vec<u32> {
    (0..template.len() as u32)
        .filter(|&pulse| {
            desyncopate_at(onsets, template, pulse, beat_level).is_some_and(|(source, _)| {
                window.map_or(true, |window| {
                    window.contains_slot(source) && window.contains_slot(pulse)
                })
            })
        })
        .collect()
}

/// Every legal syncopation vector for the current pattern, ordered by
/// (pulse, kind) for deterministic identity-seeded selection.
pub fn legal_syncopations(
    onsets: &[u32],
    template: &[u32],
    beat_level: u32,
    window: Option<SlotRange>,
) -> Vec<SiorosVector> {
    let max_level = template.iter().copied().max().unwrap_or(0);
    let mut vectors = Vec::new();
    for &pulse in onsets {
        let origin_level = template[pulse as usize];
        for kind in 0..=(max_level - origin_level.min(max_level)) {
            let vector = SiorosVector { pulse, kind };
            if syncopation_target(onsets, template, vector, beat_level).is_some_and(|landing| {
                window.map_or(true, |window| {
                    window.contains_slot(vector.pulse) && window.contains_slot(landing)
                })
            }) {
                vectors.push(vector);
            }
        }
    }
    vectors
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply_move(onsets: &[u32], from: u32, to: u32) -> Vec<u32> {
        let mut next: Vec<u32> = onsets.iter().copied().filter(|&s| s != from).collect();
        let at = next.partition_point(|&s| s < to);
        next.insert(at, to);
        next
    }

    #[test]
    fn templates_match_longuet_higgins_lee_structures() {
        // 3/4 (strata [3,2]) and 6/8 ([2,3]) — the dissertation's Figure 2-4
        // structures; 2×2×2 is the straight 8-pulse duple ladder.
        assert_eq!(metrical_levels(&[3, 2]), vec![0, 2, 1, 2, 1, 2]);
        assert_eq!(metrical_levels(&[2, 3]), vec![0, 2, 2, 1, 2, 2]);
        assert_eq!(metrical_levels(&[2, 2, 2]), vec![0, 3, 2, 3, 1, 3, 2, 3]);
        assert_eq!(metrical_levels(&[]), vec![0]);
    }

    #[test]
    fn desyncopation_moves_the_offbeat_onto_the_felt_pulse() {
        // Classic 16th-note anticipation on the 8-grid: onset at pulse 3
        // syncopates against silent pulse 4 (level 1).
        let template = metrical_levels(&[2, 2, 2]);
        let onsets = vec![3];
        let (source, vector) = desyncopate_at(&onsets, &template, 4, 1).expect("legal");
        assert_eq!(source, 3);
        assert_eq!(vector, SiorosVector { pulse: 4, kind: 2 });

        // The inverse restores the input exactly.
        let desynced = apply_move(&onsets, 3, 4);
        let landing = syncopation_target(&desynced, &template, vector, 1).expect("reversible");
        assert_eq!(landing, 3);
        assert_eq!(apply_move(&desynced, 4, landing), onsets);
    }

    #[test]
    fn scoped_vectors_keep_source_and_landing_inside() {
        let template = metrical_levels(&[2, 2, 2]);
        let onsets = vec![3, 4];
        let first_half = SlotRange { start: 0, end: 4 };
        for vector in legal_syncopations(&onsets, &template, 1, Some(first_half)) {
            let landing = syncopation_target(&onsets, &template, vector, 1).unwrap();
            assert!(first_half.contains_slot(vector.pulse));
            assert!(first_half.contains_slot(landing));
        }

        let syncopated = vec![3];
        assert!(legal_desyncopations(&syncopated, &template, 1, Some(first_half)).is_empty());
        let including_landing = SlotRange { start: 3, end: 5 };
        assert_eq!(
            legal_desyncopations(&syncopated, &template, 1, Some(including_landing)),
            vec![4]
        );
    }

    #[test]
    fn anacrusis_wraps_across_the_cycle_start() {
        // An onset on the last 16th syncopates against the downbeat.
        let template = metrical_levels(&[2, 2, 2]);
        let onsets = vec![7];
        let (source, vector) = desyncopate_at(&onsets, &template, 0, 1).expect("legal");
        assert_eq!(source, 7);
        assert_eq!(vector, SiorosVector { pulse: 0, kind: 3 });
    }

    #[test]
    fn onsets_never_hop_over_onsets_or_land_on_them() {
        let template = metrical_levels(&[2, 2, 2]);
        // The walk grabs the NEAREST onset; earlier onsets are never hopped.
        let (source, _) = desyncopate_at(&[1, 3], &template, 4, 1).expect("legal");
        assert_eq!(
            source, 3,
            "the onset at 1 is behind the grabbed one, not crossed"
        );
        // Occupied felt pulse: nothing to de-syncopate there.
        assert!(desyncopate_at(&[3, 4], &template, 4, 1).is_none());
        // Syncopating pulse 4 with an onset on 3 blocked (occupied target).
        assert_eq!(
            syncopation_target(&[3, 4], &template, SiorosVector { pulse: 4, kind: 2 }, 1),
            None
        );
    }

    #[test]
    fn a_stronger_silent_pulse_between_blocks_the_grab() {
        // Onset at 1; silent strong pulses at 2 (level 2) and 4 (level 1).
        // De-syncopating at 4 must NOT reach past the stronger silent 2:
        // the felt syncopation is at 2, so only that grab is legal.
        let template = metrical_levels(&[2, 2, 2]);
        assert!(desyncopate_at(&[1], &template, 4, 1).is_none());
        let (source, vector) = desyncopate_at(&[1], &template, 2, 1).expect("legal at 2");
        assert_eq!(source, 1);
        assert_eq!(vector, SiorosVector { pulse: 2, kind: 1 });
    }

    #[test]
    fn type_zero_is_ternary_only_and_never_at_the_beat_level() {
        // 6/8: beat level 1 at pulse 3; inside the ternary subdivision the
        // same-level backward shift is reachable, at the beat level it is
        // forbidden even though a same-level silent predecessor exists.
        let template = metrical_levels(&[2, 3]);
        // Onset on pulse 2 (level 2, ternary interior), silent pulse 1
        // (level 2): type-0 legal (beat_level = 1).
        assert_eq!(
            syncopation_target(&[2], &template, SiorosVector { pulse: 2, kind: 0 }, 1),
            Some(1)
        );
        // Onset on beat pulse 3 (level 1 == beat level): type-0 forbidden.
        assert_eq!(
            syncopation_target(&[3], &template, SiorosVector { pulse: 3, kind: 0 }, 1),
            None
        );
        // Binary grids self-block type-0 through the walk: on [2,2,2] the
        // same-level predecessor of pulse 3 sits behind the stronger pulse
        // 2, so the scan stops first.
        let duple = metrical_levels(&[2, 2, 2]);
        assert_eq!(
            syncopation_target(&[3], &duple, SiorosVector { pulse: 3, kind: 0 }, 1),
            None
        );
        // De-syncopation mirrors the ternary type-0 rule: the same-level
        // immediate predecessor steps forward inside the subdivision (the
        // worked example's {4,0}-shaped vectors), never at the beat level.
        assert_eq!(
            desyncopate_at(&[1], &template, 2, 1),
            Some((1, SiorosVector { pulse: 2, kind: 0 }))
        );
        assert_eq!(
            desyncopate_at(&[2], &template, 3, 1).expect("beat grab is type 1"),
            (2, SiorosVector { pulse: 3, kind: 1 })
        );
    }

    #[test]
    fn every_legal_pair_round_trips_exactly() {
        // Exhaustive reversibility over all patterns of ≤4 onsets on three
        // templates: syncopate(desyncopate(P)) == P with the same vector,
        // and desyncopate(syncopate(P)) == P at the vector's pulse.
        for strata in [vec![2u32, 2, 2], vec![2, 3], vec![3, 2, 2]] {
            let template = metrical_levels(&strata);
            let n = template.len() as u32;
            let beat_level = 1u32;
            for mask in 1u32..(1 << n.min(12)) {
                if mask.count_ones() > 4 {
                    continue;
                }
                let onsets: Vec<u32> = (0..n).filter(|&s| mask & (1 << s) != 0).collect();

                for pulse in 0..n {
                    if let Some((source, vector)) =
                        desyncopate_at(&onsets, &template, pulse, beat_level)
                    {
                        let forward = apply_move(&onsets, source, pulse);
                        let landing = syncopation_target(&forward, &template, vector, beat_level)
                            .unwrap_or_else(|| {
                                panic!(
                                    "vector {vector:?} irreversible for {onsets:?} on {strata:?}"
                                )
                            });
                        assert_eq!(landing, source, "round trip lands where it started");
                        assert_eq!(apply_move(&forward, pulse, landing), onsets);
                    }
                }

                for vector in legal_syncopations(&onsets, &template, beat_level, None) {
                    let landing =
                        syncopation_target(&onsets, &template, vector, beat_level).unwrap();
                    let back = apply_move(&onsets, vector.pulse, landing);
                    let (source, inverse) =
                        desyncopate_at(&back, &template, vector.pulse, beat_level).unwrap_or_else(
                            || {
                                panic!(
                                    "desync missing for {back:?} at {} on {strata:?}",
                                    vector.pulse
                                )
                            },
                        );
                    assert_eq!(source, landing);
                    assert_eq!(inverse, vector, "vector attribution is symmetric");
                    assert_eq!(apply_move(&back, source, vector.pulse), onsets);
                }
            }
        }
    }
}
