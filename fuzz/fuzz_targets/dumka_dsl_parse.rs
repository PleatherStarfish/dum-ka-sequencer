//! Fuzz the Dum-Ka seed-notation pipeline: arbitrary text must never panic,
//! overflow, or hang — every input either compiles to a playable projection
//! or returns a structured diagnostic. Exercises the parser caps (length,
//! depth, nodes, weights), the arbitrary-precision compiler, and the span
//! projector on a few realistic layouts.

#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let text = String::from_utf8_lossy(data);
    let Ok(tree) = cseq_rhythm::generators::dumka::dsl::parse(&text) else {
        return;
    };
    let Ok(seed) = cseq_rhythm::generators::dumka::tree::compile(&tree) else {
        return;
    };
    // Printing a parsed tree must itself reparse (canonical round trip).
    let printed = cseq_rhythm::generators::dumka::dsl::print(&tree);
    let reparsed = cseq_rhythm::generators::dumka::dsl::parse(&printed)
        .expect("canonical print of a valid tree reparses");
    let recompiled = cseq_rhythm::generators::dumka::tree::compile(&reparsed)
        .expect("canonical reparse recompiles");
    assert_eq!(
        seed.events, recompiled.events,
        "print/parse round trip preserves compiled events"
    );

    // Project onto per-beat spans at the required Subdivision and at one
    // coarser multiple; any structured error is acceptable, panics are not.
    for multiplier in [1u32, 2] {
        let subdivision = seed.required_subdivision.saturating_mul(multiplier);
        if subdivision > 64 {
            continue;
        }
        let spans: Vec<cseq_rhythm::GeneratorSpanInput> = (0..seed.total_beats.max(1) as u64)
            .map(|i| cseq_rhythm::GeneratorSpanInput {
                span_id: i + 1,
                span_len: subdivision,
                label: None,
                section_index: Some(1),
                subdivision: Some(subdivision),
            })
            .collect();
        let _ = cseq_rhythm::generators::dumka::tree::resolve_seed_cells(
            &seed,
            seed.total_beats,
            &spans,
        );
    }
});
