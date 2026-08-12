//! The `ResolvedCycle` view and the adapter that builds it.
//!
//! ## Why this exists (critique #1)
//!
//! The structural preview path (`preview_frames_from_root` /
//! `apply_pipeline_for_cycle_mut` → `PulseSpan`s) describes beats, gati,
//! section starts and jathi pulses, but it is **NOT rest-aware**: rest-vs-
//! sounding is decided by the rhythm-articulation overlay during realization,
//! not by the structural pipeline. The trigger evaluator needs both. This
//! adapter *combines* the resolved structural pulse spans with the realized
//! audible note groups so that, per beat, the evaluator can read:
//!
//! - gati (per beat, never per section),
//! - section-start,
//! - jathi pulse onsets,
//! - **rest vs sounding**, and
//! - note-group boundaries.
//!
//! Ticks here are *cycle-local* (0-based within the cycle). The transport maps
//! a whole `ResolvedCycle` onto the shared reference timeline with
//! [`ResolvedCycle::remap_to_reference`], which is the single artifact both the
//! evaluator/compiler and (via the snapshot) the timeline consume — there is no
//! independent re-derivation of follower notes anywhere (critique #2).

use cseq_model::{PulseSpan, PulseSpanKind, Rational};

/// One audible note group (a held note from onset to release), in whatever tick
/// space the surrounding [`ResolvedCycle`] uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NoteGroup {
    pub start_tick: u64,
    pub end_tick: u64,
}

/// A single resolved beat with everything the v1 conditions observe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedBeat {
    pub beat: u32,
    pub gati: u32,
    pub section_index: u32,
    pub section_start: bool,
    pub jathi: Option<u32>,
    pub start_tick: u64,
    pub end_tick: u64,
    /// True when at least one audible note group begins within this beat.
    pub sounding: bool,
    /// Per-matra sounding within this beat (`len == gati`): `matra_sounding[m]`
    /// is true when an audible note group begins in matra `m` of the beat. This
    /// is the matra rest map the sub-beat WHEN predicates read (Phase B).
    pub matra_sounding: Vec<bool>,
    /// Cycle-local tick of each grouping-pulse onset within this beat. Gates
    /// the `HasJathiPulse` predicate.
    pub jathi_pulse_start_ticks: Vec<u64>,
}

/// A fully resolved source cycle: structure + audibility, ready for the
/// evaluator. Built by [`resolve_cycle_from_spans`] in local ticks, then mapped
/// to reference ticks by [`ResolvedCycle::remap_to_reference`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedCycle {
    /// The source's own (stable) local cycle index that produced this cycle.
    pub cycle_index: u64,
    /// Cycle start tick (0 in local space; the reference base after remap).
    pub start_tick: u64,
    /// Cycle end tick (`local_ticks_per_cycle` in local space).
    pub end_tick: u64,
    pub beats: Vec<ResolvedBeat>,
    /// Audible note groups in this cycle, sorted by start tick.
    pub note_groups: Vec<NoteGroup>,
}

impl ResolvedCycle {
    /// Look up a beat by index.
    pub fn beat(&self, beat: u32) -> Option<&ResolvedBeat> {
        self.beats.iter().find(|b| b.beat == beat)
    }

    /// Map every tick field through `map` and rebase to `reference_start_tick`.
    ///
    /// `map` converts a *cycle-local* tick (0-based) to a cycle-local reference
    /// offset; the reference base is then added. This is how the transport
    /// projects a source cycle onto the shared reference timeline using the
    /// same per-cycle tempo map that produced the merged MIDI queue, so the
    /// trigger evaluator sees exactly the ticks that were scheduled.
    pub fn remap_to_reference(
        &self,
        reference_start_tick: u64,
        map: impl Fn(u64) -> u64,
    ) -> ResolvedCycle {
        let to_ref = |local: u64| reference_start_tick.saturating_add(map(local));
        ResolvedCycle {
            cycle_index: self.cycle_index,
            start_tick: to_ref(self.start_tick),
            end_tick: to_ref(self.end_tick),
            beats: self
                .beats
                .iter()
                .map(|b| ResolvedBeat {
                    beat: b.beat,
                    gati: b.gati,
                    section_index: b.section_index,
                    section_start: b.section_start,
                    jathi: b.jathi,
                    start_tick: to_ref(b.start_tick),
                    end_tick: to_ref(b.end_tick),
                    sounding: b.sounding,
                    // Per-matra sounding is position-relative (within the beat),
                    // so the reference remap leaves it unchanged.
                    matra_sounding: b.matra_sounding.clone(),
                    jathi_pulse_start_ticks: b
                        .jathi_pulse_start_ticks
                        .iter()
                        .map(|t| to_ref(*t))
                        .collect(),
                })
                .collect(),
            note_groups: self
                .note_groups
                .iter()
                .map(|g| NoteGroup {
                    start_tick: to_ref(g.start_tick),
                    end_tick: to_ref(g.end_tick),
                })
                .collect(),
        }
    }
}

/// Convert a cycle-relative beat position (in beats, `Rational`) to a local
/// tick using a ticks-per-beat resolution.
fn position_to_local_tick(position: Rational, ticks_per_beat: u64) -> u64 {
    let scaled = position * Rational::from_integer(ticks_per_beat as i64);
    let numer = i128::from(*scaled.numer());
    let denom = i128::from(*scaled.denom());
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

/// Build a [`ResolvedCycle`] (in cycle-local ticks) from resolved pulse spans
/// and the realized audible note groups.
///
/// - `pulse_spans`: the resolved structural spans (`Section`, `GatiBeat`,
///   `JathiPulse`) for this cycle (`PulseSpan.start`/`duration` are in beats).
/// - `note_groups`: audible note groups in **cycle-local ticks** (0-based),
///   one per held sounding group; these carry the rest-vs-sounding information
///   the structural spans lack.
/// - `cycle_beats`: number of reference/source beats in the cycle.
/// - `ticks_per_beat`: local tick resolution (PPQN at the call site).
///
/// A beat with no `GatiBeat` span is synthesized as a single unit-length beat so
/// the evaluator always has a complete `0..cycle_beats` set to address.
pub fn resolve_cycle_from_spans(
    pulse_spans: &[PulseSpan],
    note_groups: &[NoteGroup],
    cycle_beats: u32,
    cycle_index: u64,
    ticks_per_beat: u64,
) -> ResolvedCycle {
    let local_ticks_per_cycle = ticks_per_beat.saturating_mul(u64::from(cycle_beats));

    // First beat (lowest position) per section → section-start beats.
    let mut section_first_beat: std::collections::HashMap<u32, u32> =
        std::collections::HashMap::new();
    for span in pulse_spans {
        if let PulseSpanKind::GatiBeat {
            section_index,
            beat,
            ..
        } = span.kind
        {
            section_first_beat
                .entry(section_index)
                .and_modify(|b| *b = (*b).min(beat))
                .or_insert(beat);
        }
    }

    // Per-section resolved jathi (if any JathiPulse spans exist there).
    let mut section_jathi: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    for span in pulse_spans {
        if let PulseSpanKind::JathiPulse {
            section_index,
            jathi,
            ..
        } = span.kind
        {
            section_jathi.entry(section_index).or_insert(jathi);
        }
    }

    let sorted_groups = {
        let mut g = note_groups.to_vec();
        g.sort_by_key(|group| (group.start_tick, group.end_tick));
        g
    };

    let mut beats: Vec<ResolvedBeat> = Vec::with_capacity(cycle_beats as usize);
    for beat in 0..cycle_beats {
        // Prefer a real GatiBeat span; otherwise synthesize a unit beat.
        let gati_span = pulse_spans
            .iter()
            .find(|span| matches!(span.kind, PulseSpanKind::GatiBeat { beat: b, .. } if b == beat));

        let (gati, section_index, start_pos, end_pos) = match gati_span {
            Some(span) => {
                let (section_index, gati) = match span.kind {
                    PulseSpanKind::GatiBeat {
                        section_index,
                        gati,
                        ..
                    } => (section_index, gati),
                    _ => unreachable!("filtered to GatiBeat"),
                };
                (gati, section_index, span.start, span.start + span.duration)
            }
            None => {
                let start = Rational::from_integer(i64::from(beat));
                (1, 0, start, start + Rational::from_integer(1))
            }
        };

        let start_tick = position_to_local_tick(start_pos, ticks_per_beat);
        let end_tick = position_to_local_tick(end_pos, ticks_per_beat);
        let section_start = section_first_beat
            .get(&section_index)
            .map(|first| *first == beat)
            .unwrap_or(false);
        let jathi = section_jathi.get(&section_index).copied();

        // Grouping-pulse onsets that begin within this beat feed the
        // `HasJathiPulse` predicate.
        let mut jathi_pulse_start_ticks: Vec<u64> = pulse_spans
            .iter()
            .filter_map(|span| match span.kind {
                PulseSpanKind::JathiPulse { .. } => {
                    let pulse_start = position_to_local_tick(span.start, ticks_per_beat);
                    (pulse_start >= start_tick && pulse_start < end_tick).then_some(pulse_start)
                }
                _ => None,
            })
            .collect();
        jathi_pulse_start_ticks.sort_unstable();
        jathi_pulse_start_ticks.dedup();

        let sounding = sorted_groups
            .iter()
            .any(|group| group.start_tick >= start_tick && group.start_tick < end_tick);

        // Per-matra sounding: split the beat into `gati` equal matras (by tick),
        // and mark a matra sounding if any audible note group begins in it.
        let matra_count = gati.max(1) as usize;
        let beat_ticks = end_tick.saturating_sub(start_tick);
        let mut matra_sounding = vec![false; matra_count];
        if beat_ticks > 0 {
            for group in &sorted_groups {
                if group.start_tick < start_tick || group.start_tick >= end_tick {
                    continue;
                }
                let offset = group.start_tick - start_tick;
                // matra index = floor(offset / (beat_ticks / matra_count)), guarded.
                let matra = ((offset as u128 * matra_count as u128) / beat_ticks as u128) as usize;
                if let Some(slot) = matra_sounding.get_mut(matra.min(matra_count - 1)) {
                    *slot = true;
                }
            }
        }

        beats.push(ResolvedBeat {
            beat,
            gati,
            section_index,
            section_start,
            jathi,
            start_tick,
            end_tick,
            sounding,
            matra_sounding,
            jathi_pulse_start_ticks,
        });
    }

    ResolvedCycle {
        cycle_index,
        start_tick: 0,
        end_tick: local_ticks_per_cycle,
        beats,
        note_groups: sorted_groups,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TPB: u64 = 960;

    fn gati_beat(id: u64, section: u32, beat: u32, gati: u32) -> PulseSpan {
        PulseSpan {
            id,
            kind: PulseSpanKind::GatiBeat {
                section_index: section,
                beat,
                gati,
            },
            start: Rational::from_integer(i64::from(beat)),
            duration: Rational::from_integer(1),
            start_matra: 0,
            matra_len: gati,
            tags: vec![],
        }
    }

    fn section(id: u64, index: u32, start_beat: i64, beats: i64) -> PulseSpan {
        PulseSpan {
            id,
            kind: PulseSpanKind::Section { index },
            start: Rational::from_integer(start_beat),
            duration: Rational::from_integer(beats),
            start_matra: 0,
            matra_len: 0,
            tags: vec![],
        }
    }

    fn jathi_pulse(id: u64, section: u32, jathi: u32, index: u32, start_beat: i64) -> PulseSpan {
        PulseSpan {
            id,
            kind: PulseSpanKind::JathiPulse {
                section_index: section,
                jathi,
                index,
            },
            start: Rational::from_integer(start_beat),
            duration: Rational::from_integer(1),
            start_matra: 0,
            matra_len: jathi,
            tags: vec![],
        }
    }

    fn group(start: u64, end: u64) -> NoteGroup {
        NoteGroup {
            start_tick: start,
            end_tick: end,
        }
    }

    #[test]
    fn beat_three_rest_is_legible() {
        // 4-beat cycle, beats 0,1,2,3. Audible onsets on beats 0,1,2 but NOT 3.
        let spans = vec![
            gati_beat(1, 0, 0, 4),
            gati_beat(2, 0, 1, 4),
            gati_beat(3, 0, 2, 4),
            gati_beat(4, 0, 3, 4),
        ];
        let groups = vec![
            group(0, 240),
            group(TPB, TPB + 240),
            group(2 * TPB, 2 * TPB + 240),
            // beat 3 (3*TPB..4*TPB) intentionally silent
        ];
        let cycle = resolve_cycle_from_spans(&spans, &groups, 4, 7, TPB);
        assert_eq!(cycle.beats.len(), 4);
        assert!(cycle.beat(0).unwrap().sounding);
        assert!(cycle.beat(2).unwrap().sounding);
        assert!(!cycle.beat(3).unwrap().sounding, "beat 3 must read as rest");
        assert_eq!(cycle.cycle_index, 7);
    }

    #[test]
    fn gati_is_per_beat() {
        // Two sections: beats 0-1 gati 4, beats 2-3 gati 5.
        let spans = vec![
            gati_beat(1, 0, 0, 4),
            gati_beat(2, 0, 1, 4),
            gati_beat(3, 1, 2, 5),
            gati_beat(4, 1, 3, 5),
        ];
        let cycle = resolve_cycle_from_spans(&spans, &[], 4, 0, TPB);
        assert_eq!(cycle.beat(0).unwrap().gati, 4);
        assert_eq!(cycle.beat(1).unwrap().gati, 4);
        assert_eq!(cycle.beat(2).unwrap().gati, 5);
        assert_eq!(cycle.beat(3).unwrap().gati, 5);
    }

    #[test]
    fn section_start_flags_first_beat_of_each_section() {
        let spans = vec![
            section(10, 0, 0, 2),
            section(11, 1, 2, 2),
            gati_beat(1, 0, 0, 4),
            gati_beat(2, 0, 1, 4),
            gati_beat(3, 1, 2, 4),
            gati_beat(4, 1, 3, 4),
        ];
        let cycle = resolve_cycle_from_spans(&spans, &[], 4, 0, TPB);
        assert!(cycle.beat(0).unwrap().section_start);
        assert!(!cycle.beat(1).unwrap().section_start);
        assert!(cycle.beat(2).unwrap().section_start);
        assert!(!cycle.beat(3).unwrap().section_start);
        assert_eq!(cycle.beat(2).unwrap().section_index, 1);
    }

    #[test]
    fn jathi_pulse_onsets_attach_to_their_beat() {
        // Section with jathi 3 across a 3-beat cycle: pulses at beats 0,1,2.
        let spans = vec![
            gati_beat(1, 0, 0, 6),
            gati_beat(2, 0, 1, 6),
            gati_beat(3, 0, 2, 6),
            jathi_pulse(20, 0, 3, 0, 0),
            jathi_pulse(21, 0, 3, 1, 1),
            jathi_pulse(22, 0, 3, 2, 2),
        ];
        let cycle = resolve_cycle_from_spans(&spans, &[], 3, 0, TPB);
        for beat in 0..3 {
            let b = cycle.beat(beat).unwrap();
            assert_eq!(b.jathi, Some(3));
            assert_eq!(b.jathi_pulse_start_ticks, vec![u64::from(beat) * TPB]);
        }
    }

    #[test]
    fn no_accent_layer_does_not_fire_has_jathi_pulse() {
        use crate::config::{BeatSelector, ConditionNode, WhenPredicate, WhenSpec};
        use crate::evaluator::evaluate_cycle;

        // A subdivision-only section with no grouping emits no
        // accent-pulse onsets, so HasJathiPulse never fires (no false positives).
        let spans = vec![gati_beat(1, 0, 0, 4), gati_beat(2, 0, 1, 4)];
        let cycle = resolve_cycle_from_spans(&spans, &[], 2, 0, TPB);
        for beat in 0..2 {
            assert!(cycle.beat(beat).unwrap().jathi_pulse_start_ticks.is_empty());
            let when = WhenSpec {
                beats: BeatSelector::At { beat },
                tree: ConditionNode::leaf(WhenPredicate::HasJathiPulse),
            };
            assert!(evaluate_cycle(&when, &cycle).is_empty());
        }
    }

    #[test]
    fn note_group_boundaries_preserved_and_sorted() {
        let spans = vec![gati_beat(1, 0, 0, 4)];
        let groups = vec![group(500, 700), group(0, 480), group(480, 500)];
        let cycle = resolve_cycle_from_spans(&spans, &groups, 1, 0, TPB);
        assert_eq!(
            cycle.note_groups,
            vec![group(0, 480), group(480, 500), group(500, 700)]
        );
    }

    #[test]
    fn missing_gati_beat_is_synthesized() {
        // Only beat 0 has a span; beats 1..4 are synthesized unit beats.
        let spans = vec![gati_beat(1, 0, 0, 4)];
        let cycle = resolve_cycle_from_spans(&spans, &[], 4, 0, TPB);
        assert_eq!(cycle.beats.len(), 4);
        assert_eq!(cycle.beat(3).unwrap().start_tick, 3 * TPB);
        assert_eq!(cycle.beat(3).unwrap().end_tick, 4 * TPB);
    }

    #[test]
    fn remap_to_reference_offsets_all_ticks() {
        let spans = vec![gati_beat(1, 0, 0, 4), gati_beat(2, 0, 1, 4)];
        let groups = vec![group(0, 240)];
        let local = resolve_cycle_from_spans(&spans, &groups, 2, 5, TPB);
        // Linear map at half speed, based at reference tick 10_000.
        let mapped = local.remap_to_reference(10_000, |t| t * 2);
        assert_eq!(mapped.start_tick, 10_000);
        assert_eq!(mapped.beat(1).unwrap().start_tick, 10_000 + TPB * 2);
        assert_eq!(mapped.note_groups[0].end_tick, 10_000 + 240 * 2);
        // Structure (non-tick) fields are untouched.
        assert_eq!(mapped.beat(0).unwrap().gati, 4);
        assert!(mapped.beat(0).unwrap().sounding);
    }
}
