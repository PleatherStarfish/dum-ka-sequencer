# Design: Close the Structural-Divergence Parity Gap (Parity Phase 2)

Status: proposed (2026-07-01 docs-vs-code audit)
Owner docs: [TIMELINE_PARITY_TESTING_PLAN.md](../TIMELINE_PARITY_TESTING_PLAN.md) §2.3,
[TIMELINE_AUDIO_PARITY_POSTMORTEM.md](../TIMELINE_AUDIO_PARITY_POSTMORTEM.md),
[KNOWN_RISKS.md](../KNOWN_RISKS.md) "Preview And MIDI Drift"

## Problem

"Displayed timeline data and scheduled MIDI data must come from the same score
request" is the app's highest-stakes invariant (AGENTS.md High-Risk
Invariants). Phase 1 of the parity plan landed the realized-rhythm-row parity
(cells-only axis: span ids/start/duration fixed before the rhythm seed). The
**structural axis is still untested**: with subdivision-switch `seed_mode` in
history / new-seed mode plus rhythm `followGlobal`, the pulse-span skeleton
itself diverges cycle to cycle, and no automated test asserts that the
timeline's skeleton, the realized snapshot, and the queued MIDI agree for
those cycles.

Consequence: exactly the class of bug the postmortem documents (sound follows
final MIDI, timeline follows stale metadata) can regress silently, but now at
the *structure* level — wrong section boundaries, wrong span counts — which is
more musically visible than a wrong cell.

## Blocking decision (make first)

The plan names one real data-model decision; everything else is test-writing.
Two options from §2.3:

1. **Queue-derived geometry oracle (no data-model change).** Derive
   onsets/spans for a cycle from the queued events (C) and compare the
   timeline/snapshot (B) against that. Cheap, but requires a normalizer that
   reconstructs span boundaries from note events — lossy when spans contain
   rests at span edges (a span whose last cells are rests has no terminal
   onset, so bounds are ambiguous).
2. **Realized geometry in the snapshot (recommended).** Extend the realized
   snapshot each cycle with the realized pulse-span geometry: per span,
   absolute tick bounds + span id + section index. `PlaybackLayers` is the
   right home: add a `realized_geometry` layer in
   `crates/cseq-transport/src/layers.rs` declared in
   `PlaybackLayers::default`'s policy table. The no-`..`-rest-pattern
   destructuring guarantees every lifecycle site (clear_realized,
   retain_window, record_cycle) handles it at compile time — this is exactly
   the drift-proofing that layer store was built for.

Option 2 is recommended because the "Live-row requirement" in §2.3 needs the
data anyway: while playing in structural-divergence mode, the visible cycle's
section/pulse-span skeleton must be realized-sourced, not a preview
re-resolve. A queue-derived normalizer can power tests but cannot power the
live UI row. Building the snapshot extension serves both.

## Work plan

1. **Rust: `RealizedGeometry` layer.**
   - Type: `{ cycle: u64, spans: Vec<RealizedSpanGeom { span_id, section_index, start_tick, end_tick, kind }> }`.
   - Record inside `record_cycle_playback_events` (single record entry point —
     KNOWN_RISKS forbids per-layer scheduler calls).
   - Retention: same cycle-window policy as other realized layers.
2. **DTO + bridge.** Mirror the layer in the snapshot DTO
   (`src-tauri/src/main.rs`), regenerate DTO fixtures
   (`UPDATE_DTO_FIXTURES=1 cargo test -p cseq-app dto_fixture` +
   `pnpm vitest run -u src/dtoContract.generate.test.ts`), add the descriptor
   row in `ui/src/playbackLayers.ts` (its bidirectional test fails until you
   do — by design).
3. **Timeline live row.** In `ui/src/timelineModel.ts`, when a cycle has
   realized geometry, build the section/pulse-span skeleton for that cycle
   from it; fall back to preview re-resolve only for unrealized future cycles.
   Visual affordance can stay identical; this is a data-source swap.
4. **Structural-axis tests (Rust, `cseq-transport`).**
   - Corpus fixtures with `seed_mode` history/new-seed + rhythm `followGlobal`
     over ≥4 cycles.
   - Oracle: A (request) == B (snapshot incl. realized geometry) == C (queue):
     for each realized cycle, span tick-bounds from B must exactly tile the
     cycle and every queued event must fall inside its span (Exact Tiling at
     the structural level).
   - Transport-boundary relations from §2.2.4 (stop/play/resync preserve
     history; forward queue rebuilt) re-asserted on the structural corpus.
5. **FE parity test.** Extend `ui/src/timelineModel.test.ts` with a fixture
   snapshot carrying divergent per-cycle geometry; assert the rendered
   skeleton matches the fixture's realized geometry, not a re-resolution.

## Risks / notes

- Snapshot size: geometry is O(spans/cycle), bounded by the existing cycle
  window — negligible next to note events.
- Determinism unaffected: geometry is recorded, never re-derived.
- Do not attempt the queue-derived normalizer as a "temporary" oracle first —
  it becomes load-bearing and then the live-row requirement forces the layer
  anyway; build the layer once.
