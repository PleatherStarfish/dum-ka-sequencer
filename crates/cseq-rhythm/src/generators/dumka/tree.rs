//! Compile a parsed seed tree into exact rational events, derive the
//! structure the pattern requires, and project events onto generator span
//! grids.
//!
//! Time never leaves exact rational form until the final projection onto a
//! span's integer matra grid, and that projection is exact by construction:
//! the required Subdivision is the least common multiple of every boundary
//! denominator, so any authored Subdivision it divides holds every event
//! without quantization. Mismatches are structured errors, never rounding.

use cseq_model::Rational;
use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{ToPrimitive, Zero};
use thiserror::Error;

use super::dsl::{Node, NodeKind, PatternError, SeedTree};
use crate::generators::GeneratorSpanInput;
use crate::{ResolvedRhythmCell, ResolvedRhythmSpan};

/// Most beats a pattern may span (the transport caps cycles well above this;
/// keeping the pattern cap low keeps grids and editors sane).
pub const MAX_TOTAL_BEATS: u32 = 128;
/// Largest per-beat Subdivision a pattern may require. Matches the
/// platform's authored-structure validation (gati choices are 1-64 in
/// cseq-transforms), so every representable pattern is also authorable.
pub const MAX_SUBDIVISION: u32 = 64;

const EXACT_RATIONAL_LIMIT_MESSAGE: &str =
    "pattern's proportional nesting exceeds the exact-rational limit; simplify the tuplet here";

fn gcd_bigint(mut a: BigInt, mut b: BigInt) -> BigInt {
    while !b.is_zero() {
        let remainder = &a % &b;
        a = b;
        b = remainder;
    }
    a
}

fn big_integer(value: u32) -> BigRational {
    BigRational::from_integer(BigInt::from(value))
}

fn model_rational(value: &BigRational, line: u32, col: u32) -> Result<Rational, PatternError> {
    let numer = value.numer().to_i64();
    let denom = value.denom().to_i64();
    match (numer, denom) {
        (Some(numer), Some(denom)) => Ok(Rational::new(numer, denom)),
        _ => Err(PatternError {
            line,
            col,
            message: EXACT_RATIONAL_LIMIT_MESSAGE.to_string(),
        }),
    }
}

/// One sounding event on the cycle's rational timeline. Rhythm only: the
/// notation's identifier spellings are discarded at parse, so an event is
/// fully described by where it starts and how long it sounds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedEvent {
    /// Onset in beats from the cycle start.
    pub start: Rational,
    /// Duration in beats (holds already merged).
    pub dur: Rational,
}

/// A compiled pattern: exact events plus the structure they require.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledSeed {
    pub total_beats: u32,
    /// Minimal per-beat Subdivision that holds every boundary exactly.
    pub required_subdivision: u32,
    pub events: Vec<SeedEvent>,
}

impl CompiledSeed {
    /// The authored structure this pattern needs: one section of
    /// `total_beats` with per-beat Subdivision `required_subdivision` (or a
    /// multiple). Sounding events may cross beat or Grouping span boundaries;
    /// projection represents those crossings as paired tie handshakes.
    pub fn required_structure(&self) -> RequiredStructure {
        RequiredStructure {
            cycle_beats: self.total_beats,
            subdivision: self.required_subdivision,
            working_subdivision: self.required_subdivision,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RequiredStructure {
    pub cycle_beats: u32,
    /// Minimal grid required by the seed notation itself.
    pub subdivision: u32,
    /// Fold grid after applying a Dum-Ka subdivision palette. At the pure
    /// compiled-seed boundary this equals `subdivision`; generator params
    /// replace it with their validated working lattice.
    pub working_subdivision: u32,
}

/// Why compiled events cannot be projected onto the provided span layout.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum StructureError {
    #[error("pattern spans {needed} beats but the cycle has {actual}")]
    BeatsMismatch { needed: u32, actual: u32 },
    #[error(
        "spans carry {total_matras} steps over {cycle_beats} beats; a uniform per-beat Subdivision is required"
    )]
    NonUniformStructure { total_matras: u64, cycle_beats: u32 },
    #[error("pattern needs Subdivision {needed} (or a multiple); the section has {actual}")]
    SubdivisionIncompatible { needed: u32, actual: u32 },
}

/// Compile a parsed tree to rational events and the structure they need.
pub fn compile(tree: &SeedTree) -> Result<CompiledSeed, PatternError> {
    let mut total_beats: u32 = 0;
    for node in &tree.nodes {
        total_beats = total_beats.saturating_add(node.weight);
    }
    if total_beats > MAX_TOTAL_BEATS {
        let first = &tree.nodes[0];
        return Err(PatternError {
            line: first.line,
            col: first.col,
            message: format!("pattern spans {total_beats} beats; the maximum is {MAX_TOTAL_BEATS}"),
        });
    }

    #[derive(Debug)]
    struct Element {
        start: BigRational,
        dur: BigRational,
        sounding: bool,
        line: u32,
        col: u32,
    }

    fn walk(
        nodes: &[Node],
        start: BigRational,
        span: BigRational,
        elements: &mut Vec<Element>,
    ) -> Result<(), PatternError> {
        let weight_sum: u32 = nodes.iter().map(|n| n.weight).sum();
        let unit = span / big_integer(weight_sum);
        let mut cursor = start;
        for node in nodes {
            let dur = &unit * big_integer(node.weight);
            match &node.kind {
                NodeKind::Onset => elements.push(Element {
                    start: cursor.clone(),
                    dur: dur.clone(),
                    sounding: true,
                    line: node.line,
                    col: node.col,
                }),
                NodeKind::Rest => elements.push(Element {
                    start: cursor.clone(),
                    dur: dur.clone(),
                    sounding: false,
                    line: node.line,
                    col: node.col,
                }),
                NodeKind::Hold => match elements.last_mut() {
                    Some(last) => {
                        last.dur += &dur;
                    }
                    None => {
                        return Err(PatternError {
                            line: node.line,
                            col: node.col,
                            message: "'_' has nothing to extend; start with a note or rest"
                                .to_string(),
                        });
                    }
                },
                NodeKind::Group(children) => {
                    walk(children, cursor.clone(), dur.clone(), elements)?;
                }
            }
            cursor += dur;
        }
        Ok(())
    }

    let mut elements = Vec::new();
    walk(
        &tree.nodes,
        BigRational::zero(),
        big_integer(total_beats),
        &mut elements,
    )?;

    let mut subdivision = BigInt::from(1u32);
    for element in &elements {
        let denom = element.start.denom();
        let next = (&subdivision / gcd_bigint(subdivision.clone(), denom.clone())) * denom;
        if next > BigInt::from(MAX_SUBDIVISION) {
            return Err(PatternError {
                line: element.line,
                col: element.col,
                message: format!(
                    "pattern needs a per-beat Subdivision of {next}, above the maximum {MAX_SUBDIVISION}; simplify the tuplet here"
                ),
            });
        }
        subdivision = next;
    }

    let mut events = Vec::new();
    for element in elements {
        if element.sounding {
            events.push(SeedEvent {
                start: model_rational(&element.start, element.line, element.col)?,
                dur: model_rational(&element.dur, element.line, element.col)?,
            });
        }
    }

    Ok(CompiledSeed {
        total_beats,
        required_subdivision: subdivision
            .to_u32()
            .expect("subdivision was checked against the u32 maximum"),
        events,
    })
}

/// Project compiled events onto the provided span layout.
///
/// `cycle_beats` is the transport's cycle length; spans are the generator's
/// inputs in temporal order and must tile the cycle on a uniform per-beat
/// grid that the required Subdivision divides. Output spans tile exactly.
/// A sounding event crossing one or more span boundaries is split into a tied
/// chain: each exited span ends with `tied_to_next`, and each entered span
/// begins with `tied_from_previous`. The cycle edges remain absolute fences.
pub fn resolve_seed_cells(
    seed: &CompiledSeed,
    cycle_beats: u32,
    spans: &[GeneratorSpanInput],
) -> Result<Vec<ResolvedRhythmSpan>, StructureError> {
    if cycle_beats != seed.total_beats {
        return Err(StructureError::BeatsMismatch {
            needed: seed.total_beats,
            actual: cycle_beats,
        });
    }
    let total_matras_exact: u64 = spans.iter().map(|span| u64::from(span.span_len)).sum();
    let actual_subdivision = spans.first().and_then(|span| span.subdivision);
    let uniform_subdivision = actual_subdivision.is_some_and(|subdivision| {
        subdivision > 0
            && spans
                .iter()
                .all(|span| span.span_len > 0 && span.subdivision == Some(subdivision))
            && total_matras_exact == u64::from(cycle_beats) * u64::from(subdivision)
    });
    if cycle_beats == 0 || total_matras_exact == 0 || !uniform_subdivision {
        return Err(StructureError::NonUniformStructure {
            total_matras: total_matras_exact,
            cycle_beats,
        });
    }
    let actual_subdivision = actual_subdivision.expect("uniform layout has a subdivision");
    if actual_subdivision % seed.required_subdivision != 0 {
        return Err(StructureError::SubdivisionIncompatible {
            needed: seed.required_subdivision,
            actual: actual_subdivision,
        });
    }

    // Sounding intervals on the global matra grid, in temporal order.
    let scale = Rational::from_integer(i64::from(actual_subdivision));
    let intervals: Vec<(u64, u64)> = seed
        .events
        .iter()
        .map(|event| {
            let start = event.start * scale;
            let end = (event.start + event.dur) * scale;
            debug_assert!(start.is_integer() && end.is_integer());
            (
                u64::try_from(start.to_integer()).expect("non-negative"),
                u64::try_from(end.to_integer()).expect("non-negative"),
            )
        })
        .collect();

    let mut spans_out = Vec::with_capacity(spans.len());
    let mut span_start: u64 = 0;
    let mut event_index = 0usize;
    for span in spans {
        let span_end = span_start + u64::from(span.span_len);
        let mut cells: Vec<ResolvedRhythmCell> = Vec::new();
        let mut cursor = span_start;
        while cursor < span_end {
            // Skip events that ended before the cursor (safety; intervals
            // are ordered and disjoint).
            while event_index < intervals.len() && intervals[event_index].1 <= cursor {
                event_index += 1;
            }
            let next = intervals.get(event_index).copied();
            match next {
                Some((start, end)) if start <= cursor => {
                    let cell_end = end.min(span_end);
                    push_cell(
                        &mut cells,
                        span_start,
                        cursor,
                        cell_end,
                        false,
                        start < cursor,
                        end > cell_end,
                    );
                    cursor = cell_end;
                    if cursor == end {
                        event_index += 1;
                    }
                }
                Some((start, _)) if start < span_end => {
                    push_cell(&mut cells, span_start, cursor, start, true, false, false);
                    cursor = start;
                }
                _ => {
                    push_cell(&mut cells, span_start, cursor, span_end, true, false, false);
                    cursor = span_end;
                }
            }
        }
        spans_out.push(ResolvedRhythmSpan {
            span_id: span.span_id,
            span_len: span.span_len,
            cells,
        });
        span_start = span_end;
    }
    Ok(spans_out)
}

fn push_cell(
    cells: &mut Vec<ResolvedRhythmCell>,
    span_start: u64,
    from: u64,
    to: u64,
    rest: bool,
    tied_from_previous: bool,
    tied_to_next: bool,
) {
    debug_assert!(to > from);
    debug_assert!(!rest || (!tied_from_previous && !tied_to_next));
    let index = u32::try_from(cells.len()).expect("cell count fits u32");
    cells.push(ResolvedRhythmCell {
        index,
        start: u32::try_from(from - span_start).expect("span-local"),
        len: u32::try_from(to - from).expect("span-local"),
        rest,
        tied_from_previous,
        tied_to_next,
        velocity: None,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generators::dumka::dsl::parse;
    use proptest::prelude::*;

    fn rational(n: i64, d: i64) -> Rational {
        Rational::new(n, d)
    }

    fn compiled(text: &str) -> CompiledSeed {
        compile(&parse(text).unwrap()).unwrap()
    }

    fn span(id: u64, len: u32, subdivision: u32) -> GeneratorSpanInput {
        GeneratorSpanInput {
            span_id: id,
            span_len: len,
            label: None,
            section_index: Some(1),
            subdivision: Some(subdivision),
        }
    }

    #[test]
    fn readme_example_compiles_to_exact_rationals() {
        let seed = compiled("[dum@3 ka] [. ka] [dum ka dum ka dum]@2");
        assert_eq!(seed.total_beats, 4);
        assert_eq!(seed.required_subdivision, 20);
        let onsets: Vec<(Rational, Rational)> =
            seed.events.iter().map(|e| (e.start, e.dur)).collect();
        assert_eq!(
            onsets,
            vec![
                (rational(0, 1), rational(3, 4)),
                (rational(3, 4), rational(1, 4)),
                (rational(3, 2), rational(1, 2)),
                (rational(2, 1), rational(2, 5)),
                (rational(12, 5), rational(2, 5)),
                (rational(14, 5), rational(2, 5)),
                (rational(16, 5), rational(2, 5)),
                (rational(18, 5), rational(2, 5)),
            ]
        );
    }

    #[test]
    fn quintuplet_spanning_two_beats_lands_mid_tree() {
        // Tuplet starting inside a beat: x, then five in the time of a
        // quarter beat, then a half-beat tail.
        let seed = compiled("[x [x x x x x]@1 x@2]");
        assert_eq!(seed.total_beats, 1);
        assert_eq!(seed.required_subdivision, 20);
        assert_eq!(seed.events.len(), 7);
        assert_eq!(seed.events[1].start, rational(1, 4));
        assert_eq!(seed.events[1].dur, rational(1, 20));
    }

    #[test]
    fn nested_triplet_inside_quintuplet_multiplies_denominators() {
        let seed = compiled("[x x [x x x] x x]");
        assert_eq!(seed.required_subdivision, 15);
    }

    #[test]
    fn holds_merge_on_the_rational_timeline() {
        let seed = compiled("x _ _ .");
        assert_eq!(seed.total_beats, 4);
        assert_eq!(seed.events.len(), 1);
        assert_eq!(seed.events[0].dur, rational(3, 1));

        let across_groups = compiled("[x x] [_ x]");
        assert_eq!(across_groups.events.len(), 3);
        assert_eq!(across_groups.events[1].start, rational(1, 2));
        assert_eq!(across_groups.events[1].dur, rational(1, 1));

        let rest_extended = compiled(". _ x _");
        assert_eq!(rest_extended.events.len(), 1);
        assert_eq!(rest_extended.events[0].start, rational(2, 1));
        assert_eq!(rest_extended.events[0].dur, rational(2, 1));
    }

    #[test]
    fn leading_hold_is_a_compile_error_with_position() {
        let err = compile(&parse("_ x").unwrap()).unwrap_err();
        assert_eq!((err.line, err.col), (1, 1));
        assert!(err.message.contains("nothing to extend"));
    }

    #[test]
    fn oversized_tuplets_are_rejected_with_a_position() {
        let text = format!("[{}]", "x ".repeat(97));
        let err = compile(&parse(&text).unwrap()).unwrap_err();
        assert!(err.message.contains("Subdivision"), "{}", err.message);
        assert!(err.message.contains("97"), "{}", err.message);
    }

    #[test]
    fn adversarial_nesting_is_exact_and_total() {
        // Mirrored in ui/src/dumkaPattern.test.ts. This denominator exceeds
        // u32 but must be a structured grid diagnostic, never a conversion
        // panic or a rounded result.
        let unplayable = "[[[[x .@512] .@512] .@512] .@512]";
        let err = compile(&parse(unplayable).unwrap()).unwrap_err();
        assert_eq!((err.line, err.col), (1, 7));
        assert_eq!(
            err.message,
            "pattern needs a per-beat Subdivision of 69257922561, above the maximum 64; simplify the tuplet here"
        );

        // Huge internal denominators can cancel through holds. Arbitrary-
        // precision compilation preserves that legal one-beat result.
        let mut cancelled = "x".to_string();
        for _ in 0..super::super::dsl::MAX_DEPTH {
            cancelled = format!("[{cancelled} _@512]");
        }
        let seed = compile(&parse(&cancelled).unwrap()).unwrap();
        assert_eq!(seed.total_beats, 1);
        assert_eq!(seed.required_subdivision, 1);
        assert_eq!(seed.events.len(), 1);
        assert_eq!(seed.events[0].start, rational(0, 1));
        assert_eq!(seed.events[0].dur, rational(1, 1));
    }

    #[test]
    fn rust_parser_contract_fixture_matches() {
        fn outcome(text: &str) -> serde_json::Value {
            match parse(text).and_then(|tree| compile(&tree)) {
                Ok(seed) => serde_json::json!({
                    "ok": true,
                    "compiled": {
                        "totalBeats": seed.total_beats,
                        "requiredSubdivision": seed.required_subdivision,
                        "events": seed.events.iter().map(|event| serde_json::json!({
                            "start": { "num": event.start.numer(), "den": event.start.denom() },
                            "dur": { "num": event.dur.numer(), "den": event.dur.denom() },
                        })).collect::<Vec<_>>(),
                    }
                }),
                Err(error) => serde_json::json!({
                    "ok": false,
                    "issue": {
                        "line": error.line,
                        "col": error.col,
                        "message": error.message,
                    }
                }),
            }
        }

        fn projection_case(
            text: &str,
            cycle_beats: u32,
            spans: Vec<GeneratorSpanInput>,
        ) -> serde_json::Value {
            let seed = parse(text)
                .and_then(|tree| compile(&tree))
                .expect("projection contract pattern compiles");
            let resolved = resolve_seed_cells(&seed, cycle_beats, &spans)
                .expect("projection contract structure resolves");
            let span_inputs = spans
                .iter()
                .map(|span| {
                    serde_json::json!({
                        "spanId": span.span_id,
                        "spanLen": span.span_len,
                        "subdivision": span.subdivision,
                    })
                })
                .collect::<Vec<_>>();
            serde_json::json!({
                "pattern": text,
                "outcome": outcome(text),
                "projection": {
                    "cycleBeats": cycle_beats,
                    "spans": span_inputs,
                    "outcome": {
                        "ok": true,
                        "spans": resolved,
                    },
                },
            })
        }

        let mut cancelled = "x".to_string();
        for _ in 0..super::super::dsl::MAX_DEPTH {
            cancelled = format!("[{cancelled} _@512]");
        }
        let patterns = vec![
            "x . x .".to_string(),
            "[dum@3 ka] [. ka] [dum ka dum ka dum]@2".to_string(),
            "E(3,8,3)@2 [x .]*2 | _ # comment\nka".to_string(),
            "x\u{85}x".to_string(),
            cancelled,
            "[[[[x .@512] .@512] .@512] .@512]".to_string(),
            "x .\n[x ka@0]".to_string(),
            "[x x".to_string(),
            "x ]".to_string(),
            String::new(),
            "[]".to_string(),
            "E(9,8)".to_string(),
            "dum(3,8)".to_string(),
            "_ x".to_string(),
            "x 😀".to_string(),
            "x\u{feff}x".to_string(),
        ];
        let mut cases = patterns
            .into_iter()
            .map(|pattern| {
                let result = outcome(&pattern);
                serde_json::json!({ "pattern": pattern, "outcome": result })
            })
            .collect::<Vec<_>>();
        cases.push(projection_case(
            "[x x x x x]@2",
            2,
            vec![span(10, 5, 5), span(11, 5, 5)],
        ));
        cases.push(projection_case(
            "x _ _ .",
            4,
            vec![
                span(20, 1, 1),
                span(21, 1, 1),
                span(22, 1, 1),
                span(23, 1, 1),
            ],
        ));
        let rendered = format!(
            "{}\n",
            serde_json::to_string_pretty(&cases).expect("serialize parser contract")
        );
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../ui/src/__fixtures__/dumka_parser_contract.json");
        if std::env::var("UPDATE_DTO_FIXTURES").is_ok() {
            std::fs::write(&path, &rendered).expect("update Dum-Ka parser contract fixture");
        } else {
            let checked_in = std::fs::read_to_string(&path).unwrap_or_else(|_| {
                panic!(
                    "missing {}; regenerate with UPDATE_DTO_FIXTURES=1 cargo test -p cseq-rhythm rust_parser_contract_fixture_matches",
                    path.display()
                )
            });
            assert_eq!(
                checked_in, rendered,
                "Rust parser contract changed; regenerate intentionally with UPDATE_DTO_FIXTURES=1"
            );
        }
    }

    #[test]
    fn beat_cap_is_enforced() {
        let err = compile(&parse("x@129").unwrap()).unwrap_err();
        assert!(err.message.contains("129 beats"));
    }

    #[test]
    fn required_structure_names_beats_and_subdivision() {
        let seed = compiled("[dum@3 ka] [. ka] [dum ka dum ka dum]@2");
        let structure = seed.required_structure();
        assert_eq!(structure.cycle_beats, 4);
        assert_eq!(structure.subdivision, 20);
        assert_eq!(structure.working_subdivision, 20);
    }

    #[test]
    fn single_span_projection_is_exact() {
        let seed = compiled("[dum@3 ka] [. ka] [dum ka dum ka dum]@2");
        let spans = vec![span(7, 80, 20)];
        let resolved = resolve_seed_cells(&seed, 4, &spans).unwrap();
        assert_eq!(resolved.len(), 1);
        let cells = &resolved[0].cells;
        let picture: Vec<(u32, u32, bool)> =
            cells.iter().map(|c| (c.start, c.len, c.rest)).collect();
        assert_eq!(
            picture,
            vec![
                (0, 15, false),
                (15, 5, false),
                (20, 10, true),
                (30, 10, false),
                (40, 8, false),
                (48, 8, false),
                (56, 8, false),
                (64, 8, false),
                (72, 8, false),
            ]
        );
        let mut cursor = 0;
        for (i, cell) in cells.iter().enumerate() {
            assert_eq!(cell.index, i as u32);
            assert_eq!(cell.start, cursor);
            assert!(!cell.tied_from_previous && !cell.tied_to_next);
            cursor += cell.len;
        }
        assert_eq!(cursor, 80);
    }

    #[test]
    fn coarser_multiple_subdivisions_are_accepted() {
        let seed = compiled("x . x .");
        assert_eq!(seed.required_subdivision, 1);
        let resolved = resolve_seed_cells(&seed, 4, &[span(1, 16, 4)]).unwrap();
        let cells = &resolved[0].cells;
        assert_eq!(cells.len(), 4);
        assert!(cells.iter().all(|c| c.len == 4));
    }

    #[test]
    fn per_beat_spans_emit_paired_ties_when_a_note_crosses() {
        let seed = compiled("x . x .");
        let spans: Vec<GeneratorSpanInput> = (0..4).map(|i| span(i, 4, 4)).collect();
        let resolved = resolve_seed_cells(&seed, 4, &spans).unwrap();
        assert_eq!(resolved.len(), 4);
        assert!(!resolved[0].cells[0].rest);
        assert!(resolved[1].cells[0].rest);

        let sustained = compiled("x _ x .");
        let resolved = resolve_seed_cells(&sustained, 4, &spans).unwrap();
        assert_eq!(resolved[0].cells.len(), 1);
        assert!(!resolved[0].cells[0].rest);
        assert!(!resolved[0].cells[0].tied_from_previous);
        assert!(resolved[0].cells[0].tied_to_next);
        assert_eq!(resolved[1].cells.len(), 1);
        assert!(!resolved[1].cells[0].rest);
        assert!(resolved[1].cells[0].tied_from_previous);
        assert!(!resolved[1].cells[0].tied_to_next);

        let quintuplet = compiled("[x x] [x x x x x]@2 x");
        let resolved = resolve_seed_cells(
            &quintuplet,
            4,
            &(0..4).map(|i| span(i, 20, 20)).collect::<Vec<_>>(),
        )
        .unwrap();
        assert!(resolved[1].cells.last().unwrap().tied_to_next);
        assert!(resolved[2].cells.first().unwrap().tied_from_previous);
    }

    #[test]
    fn one_sustain_can_cross_multiple_adjacent_spans_without_cycle_wrap() {
        let spans = (0..4).map(|i| span(i, 4, 4)).collect::<Vec<_>>();
        let resolved = resolve_seed_cells(&compiled("x _ _ _"), 4, &spans).unwrap();

        let flags = resolved
            .iter()
            .map(|span| {
                assert_eq!(span.cells.len(), 1);
                let cell = &span.cells[0];
                assert!(!cell.rest);
                (cell.tied_from_previous, cell.tied_to_next)
            })
            .collect::<Vec<_>>();
        assert_eq!(
            flags,
            vec![(false, true), (true, true), (true, true), (true, false)]
        );
    }

    #[test]
    fn two_beat_quintuplet_sustains_through_the_beat_boundary() {
        let resolved = resolve_seed_cells(
            &compiled("[x x x x x]@2"),
            2,
            &[span(10, 5, 5), span(11, 5, 5)],
        )
        .unwrap();

        let left = &resolved[0].cells;
        let right = &resolved[1].cells;
        assert_eq!(
            left.iter()
                .map(|cell| (
                    cell.start,
                    cell.len,
                    cell.rest,
                    cell.tied_from_previous,
                    cell.tied_to_next,
                ))
                .collect::<Vec<_>>(),
            vec![
                (0, 2, false, false, false),
                (2, 2, false, false, false),
                (4, 1, false, false, true),
            ]
        );
        assert_eq!(
            right
                .iter()
                .map(|cell| (
                    cell.start,
                    cell.len,
                    cell.rest,
                    cell.tied_from_previous,
                    cell.tied_to_next,
                ))
                .collect::<Vec<_>>(),
            vec![
                (0, 1, false, true, false),
                (1, 2, false, false, false),
                (3, 2, false, false, false),
            ]
        );
    }

    fn assert_tie_projection_contract(spans: &[ResolvedRhythmSpan]) -> Result<(), TestCaseError> {
        prop_assert!(!spans.is_empty());
        prop_assert!(!spans[0].cells[0].tied_from_previous);
        prop_assert!(!spans.last().unwrap().cells.last().unwrap().tied_to_next);

        for span in spans {
            let mut cursor = 0;
            for (index, cell) in span.cells.iter().enumerate() {
                prop_assert_eq!(cell.index, index as u32);
                prop_assert_eq!(cell.start, cursor);
                prop_assert!(cell.len > 0);
                prop_assert!(!cell.rest || (!cell.tied_from_previous && !cell.tied_to_next));
                if cell.tied_from_previous {
                    prop_assert_eq!(index, 0);
                }
                if cell.tied_to_next {
                    prop_assert_eq!(index + 1, span.cells.len());
                }
                cursor += cell.len;
            }
            prop_assert_eq!(cursor, span.span_len);
        }

        for boundary in spans.windows(2) {
            let left = boundary[0].cells.last().unwrap();
            let right = boundary[1].cells.first().unwrap();
            prop_assert_eq!(left.tied_to_next, right.tied_from_previous);
            if left.tied_to_next {
                prop_assert!(!left.rest && !right.rest);
            }
        }
        Ok(())
    }

    proptest! {
        #[test]
        fn random_sustains_form_complete_tie_chains_on_beat_and_grouping_spans(
            beats in 1u32..=16,
            raw_start in any::<u32>(),
            raw_duration in any::<u32>(),
        ) {
            let start = raw_start % beats;
            let duration = 1 + raw_duration % (beats - start);
            let pattern = (0..beats)
                .map(|beat| {
                    if beat == start {
                        "x"
                    } else if beat > start && beat < start + duration {
                        "_"
                    } else {
                        "."
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            let seed = compiled(&pattern);

            // Subdivision 6 supports both one span per beat and Grouping-3
            // tiles (two structural spans per beat) without changing the grid.
            for span_len in [6, 3] {
                let span_count = beats * 6 / span_len;
                let inputs = (0..span_count)
                    .map(|index| span(u64::from(index), span_len, 6))
                    .collect::<Vec<_>>();
                let resolved = resolve_seed_cells(&seed, beats, &inputs).unwrap();
                assert_tie_projection_contract(&resolved)?;
                let sounding_len = resolved
                    .iter()
                    .flat_map(|span| &span.cells)
                    .filter(|cell| !cell.rest)
                    .map(|cell| cell.len)
                    .sum::<u32>();
                prop_assert_eq!(sounding_len, duration * 6);
            }
        }
    }

    #[test]
    fn structure_mismatches_are_specific() {
        let seed = compiled("[x x x x x]@2 x x");
        assert_eq!(seed.total_beats, 4);
        assert_eq!(seed.required_subdivision, 5);

        assert_eq!(
            resolve_seed_cells(&seed, 3, &[span(1, 60, 20)]).unwrap_err(),
            StructureError::BeatsMismatch {
                needed: 4,
                actual: 3
            }
        );
        assert_eq!(
            resolve_seed_cells(&seed, 4, &[span(1, 16, 4)]).unwrap_err(),
            StructureError::SubdivisionIncompatible {
                needed: 5,
                actual: 4
            }
        );
        assert_eq!(
            resolve_seed_cells(&seed, 4, &[span(1, 30, 10), span(2, 20, 5)]).unwrap_err(),
            StructureError::NonUniformStructure {
                total_matras: 50,
                cycle_beats: 4
            }
        );
    }

    #[test]
    fn subdivision_metadata_distinguishes_grouping_from_grid_changes() {
        // Same Subdivision 4 in both sections, but different Grouping span
        // lengths. This is a valid uniform grid and must remain playable.
        let mut grouped = [3u32, 3, 3, 3, 4, 4, 4]
            .into_iter()
            .enumerate()
            .map(|(index, len)| span(index as u64 + 1, len, 4))
            .collect::<Vec<_>>();
        for item in &mut grouped[4..] {
            item.section_index = Some(2);
        }
        assert!(resolve_seed_cells(&compiled(". . . . . ."), 6, &grouped).is_ok());

        // This old false acceptance averages S4 and S6 to S5 because Grouping
        // makes the span count differ from the beat count. Exact per-span
        // metadata exposes the real section switch.
        let mut switched = [3u32, 3, 3, 3]
            .into_iter()
            .enumerate()
            .map(|(index, len)| span(index as u64 + 1, len, 4))
            .collect::<Vec<_>>();
        switched.extend([6u32, 6, 6].into_iter().enumerate().map(|(index, len)| {
            let mut item = span(index as u64 + 5, len, 6);
            item.section_index = Some(2);
            item
        }));
        let averaged = compiled("[x . . . .] . [x . . . .] . [x . . . .] .");
        assert_eq!(averaged.required_subdivision, 5);
        assert_eq!(
            resolve_seed_cells(&averaged, 6, &switched).unwrap_err(),
            StructureError::NonUniformStructure {
                total_matras: 30,
                cycle_beats: 6,
            }
        );

        // Missing proof also fails closed instead of reviving the averaging
        // heuristic for an older or hand-authored preview request.
        grouped[0].subdivision = None;
        assert!(matches!(
            resolve_seed_cells(&compiled(". . . . . ."), 6, &grouped),
            Err(StructureError::NonUniformStructure { .. })
        ));

        let zero_length = [span(1, 0, 4), span(2, 24, 4)];
        assert!(matches!(
            resolve_seed_cells(&compiled(". . . . . ."), 6, &zero_length),
            Err(StructureError::NonUniformStructure { .. })
        ));

        assert_eq!(
            resolve_seed_cells(
                &compiled(". ."),
                2,
                &[span(1, u32::MAX, 1), span(2, u32::MAX, 1)],
            )
            .unwrap_err(),
            StructureError::NonUniformStructure {
                total_matras: 8_589_934_590,
                cycle_beats: 2,
            }
        );
    }

    #[test]
    fn all_rest_patterns_are_legal_silence() {
        let seed = compiled(". . . .");
        assert!(seed.events.is_empty());
        let resolved = resolve_seed_cells(&seed, 4, &[span(1, 4, 1)]).unwrap();
        assert_eq!(resolved[0].cells.len(), 1);
        assert!(resolved[0].cells[0].rest);
        assert_eq!(resolved[0].cells[0].len, 4);
    }

    #[test]
    fn euclid_sugar_projects_like_its_spelled_form() {
        let sugar = compiled("E(3,8)@4");
        let spelled = compiled("[x . . x . . x .]@4");
        assert_eq!(sugar.events, spelled.events);
        assert_eq!(sugar.required_subdivision, 2);
    }
}
