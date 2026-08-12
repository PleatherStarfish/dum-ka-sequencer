# Docs-vs-Code Audit — 2026-07-01

Method: every document in `docs/` was grouped into 17 clusters
(rhythm core, sections, jathi bhedam, triggers, automation, track flow, pitch,
timeline parity, transport, persistence, UI interaction, architecture
contract, vision, testing infra, seeds, MIDI/channels, user manual) and
compared against the implementation. Findings were adversarially verified
against the code before being accepted. Baseline before changes: Rust
workspace green (21 suites); UI 627/628 (one pre-existing failure, finding 7).
After fixes: Rust green, UI 639/639, `tsc` clean.

Legend: **FIXED** = landed today · **DESIGN** = architecture written in this
folder · **DOC** = documentation corrected.

## A. Bugs fixed today

| # | Finding | Severity | Where | Status |
|---|---------|----------|-------|--------|
| 1 | Failed strict-same-cardinality pitch transfer still Apply-able; Apply wiped weights/entry/fallback to `{}`/0 with no undo — contradicts the architecture doc's "recoverable until Apply" | high | `ui/src/pitchMatrixTransfer.ts`, `PitchMatrixTransferModal.tsx` | FIXED: `failed` flag on result + `canApply` gate + 3 tests |
| 2 | Scale transfer silently deleted the **inactive Markov order's** transition + entry weights (only active-order keys were remapped; Apply replaces the whole record) — permanent data loss; dual-order records are a supported state | high | `ui/src/pitchMatrixTransfer.ts` | FIXED: keys parse their own order; both orders remap; test with mixed-order snapshot |
| 3 | `tonicHints` used spread-argument `Math.min(...)` over the uncapped import pitch list → RangeError on ~100k+ note MIDI imports | medium | `ui/src/pitchCollectionDetect.ts:188` | FIXED: single-pass loop (matches `detectRegister`'s existing safe pattern) |
| 4 | `PitchContour` had the same spread crash **and** rendered one SVG node per note (UI freeze long before the crash threshold) | medium | `ui/src/components/PitchImportModal.tsx` | FIXED: loop min/max + stride downsampling capped at 2000 points |
| 5 | Import modal pending overrides (collection/tonic/register) survive Cancel and leak into the next session — doc promises discard-on-Cancel + prefill-on-open | low | `ui/src/components/PitchImportModal.tsx` | FIXED: reseed-on-open effect |
| 6 | `pendingOrder` seeded once at mount and never resynced — Apply could learn/write a **stale Markov order** | medium | `ui/src/components/PitchImportModal.tsx` | FIXED: same reseed effect resyncs order |
| 7 | Pre-existing failing test: JB mode-chip assertion ambiguous after the Phrasing `<option>` gained identical text (masked the suite's signal) | low | `ui/src/JathiBhedamEditor.behavior.test.tsx:60` | FIXED: query scoped to `.jb-mode-chip` |
| 8 | **No error boundary anywhere in `ui/src`** — any render exception blanked the entire app (finding 3/4 was a live instance of the class) | high | `ui/src/main.tsx` | FIXED: root `ErrorBoundary` + tests; phased plan in [UI_CRASH_RESILIENCE.md](UI_CRASH_RESILIENCE.md) |
| 9 | Dead `nextGati` export could return out-of-palette gati (8) — contradicts SECTIONS spec §9.2, invited regression to pre-palette behavior | low | `ui/src/components/WeightEditors.tsx` | FIXED: removed (fully dead) |
| 10 | AUTOMATION_AUDIT F1 still marked "live" though the synth targets were removed from the registry; dead `synthEnabled`/`synthPrograms` plumbing remains | low | `docs/AUTOMATION_AUDIT.md`, `ui/src/automationTargets.ts` | DOC: F1 status corrected; plumbing decision deferred to design doc |

## B. Verified-live systemic gaps → design docs

| # | Finding | Evidence | Design |
|---|---------|----------|--------|
| 11 | Pitch / channel-hocket / matrix-weight post-score automation frozen at cycle start; intra-cycle curves ignored (ratchet+ornament were fixed; these were not) | `cseq-transport/src/lib.rs:3556` vs the F3 pattern at `:5998`,`:6012` | [AUTOMATION_EVALUATION_COMPLETION.md](AUTOMATION_EVALUATION_COMPLETION.md) Phase A |
| 12 | Relational marker anchors: stored, editable, persisted — never evaluated by the engine | no marker evaluation in `cseq-transport`; FE-only logic at `automationTargets.ts:1539` | same, Phase C |
| 13 | Automation sample rates modeled but the backend has no `sample_rate` handling at all | zero matches in `cseq-transport`; admitted `AUTOMATION.md:632` | same, Phase B |
| 14 | Text automation values modeled but never consumed | `AUTOMATION.md:144` | same, Phase B/E |
| 15 | Replace-mode combine across multiple tracks is last-writer-wins while curves within a track average — inconsistent semantics | `cseq-transport/src/lib.rs:3126` | same, Phase D |
| 16 | `lengthCycles` curve endpoint `1/1` is never an audible beat; new lanes seed their end point there ("last beat didn't reach the end value") | `cseq-model/src/lib.rs:192-197`; AUTOMATION_AUDIT F7 | same, Phase E |
| 17 | Legacy patches with removed synth-automation targets load as unlabeled inert "Custom" lanes | `automationTargets.ts:317` fallback | same, Phase E |
| 18 | Jathi Bhedam cells are the only pulse-span kind excluded from the speed layer (multiplier returns `None`) | `cseq-transport/src/lib.rs:7967` | Source-only remediation document removed during Seqstart extraction. |
| 19 | Timeline↔MIDI parity has **no coverage on the structural axis** (subdivision-switch history/new-seed + rhythm followGlobal ⇒ pulse-span skeleton diverges per cycle); prerequisite data-model decision was deferred | parity plan §2.3 + "Open prerequisites"; Phase 1 covered cells-only | [TIMELINE_PARITY_STRUCTURAL_AXIS.md](TIMELINE_PARITY_STRUCTURAL_AXIS.md) |
| 20 | Live timeline skeleton for structurally-divergent cycles is preview-re-resolved, not realized-sourced (the §2.3 "live-row requirement") | same doc; no realized-geometry layer exists in `layers.rs` | same |
| 21 | Scheduler dispatches MIDI immediately from a tight loop — no device timestamping; timing accuracy ceiling on exactly the dense material the product targets | KNOWN_RISKS "Scheduler Timing"; `cseq-midi/src/host_time.rs` exists but unused for sends | [MIDI_TIMESTAMPED_SCHEDULING.md](MIDI_TIMESTAMPED_SCHEDULING.md) |
| 22 | `SubdivisionSwitch`/`WeightedSubdivisionChoice` naming still means "gati" — standing source of semantic regressions the docs must actively fight | KNOWN_RISKS "Naming Debt"; AGENTS.md dedicates a warning to it | Superseded by Seqstart's neutral UI vocabulary; inherited code names remain deliberately. |

## C. Checked and found healthy (no finding)

For the record, these documented claims were verified as true today: every
named guard test in KNOWN_RISKS exists (`channel_hocket_ignores…`,
`realizing_future_cycles…`, layer-store tests, `seed_path_track_matches` both
sides, real-backend parity spec); `PlaybackLayers` destructures carry no `..`;
sections spec §9 (palette + canon-on-load + canon-in-request) fully landed;
pitch-shaper patch persistence covers all fields; TESTING.md's commands,
scripts, fixtures, and CI workflows all exist; JB gaps H0'/H/K landed as the
status doc says; fallback source/reason is exposed as promised.

## Notes

The multi-agent audit was cut short by account limits after the pitch cluster
(findings 1-6 verified there); the remaining clusters were audited directly.
Coverage of rhythm-core internals, trigger evaluator edge cases, track-flow
phases 2-5 reachability, and the user manual was breadth-first — a follow-up
deep pass on those four clusters is the main residual risk.
