# Docs-vs-Code Audit, Part 2 — 2026-07-02

Completes the [2026-07-01 audit](AUDIT_SUMMARY_2026-07-01.md), whose multi-agent
pass was cut short by account limits. This pass covered every cluster the first
summary listed as residual — rhythm-core internals, trigger evaluator edge
cases, track-flow reachability, the user manual — plus midi-channels, seeds/
randomize, architecture contract, vision/roadmap, design language, and e2e
coverage. Numbering continues from finding 22.

Baseline at start of pass: Rust 21/21 suites green, UI 639/639 green,
including a concurrent in-flight implementation of FIX_PROMPTS 1 and 3
(automation per-note-group sampling + marker anchors) in
`crates/cseq-{model,rhythm,transport}` and `src-tauri` — those areas were
deliberately not re-audited (moving target).

## New findings

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 23 | The "complete user manual" (`docs/manual/CAESURA_USER_MANUAL.md`, source updated Jun 5) has **zero** coverage of Track Flow, pitch import, and scale transfer, and only trace mentions of Jathi Bhedam and triggers; the rendered HTML/PDF artifacts are additionally 3 weeks older than the source, violating docs/README.md's render-on-change rule | medium (user-facing) | DESIGN → [DOC_CURRENCY_GUARDRAILS.md](DOC_CURRENCY_GUARDRAILS.md); content backfill prompt added to FIX_PROMPTS |
| 24 | Root `README.md` — the designated home for user workflows — was missing the two most recently shipped features (pitch import modal, scale transfer modal) | low | **FIXED 2026-07-02**: two workflow bullets added to the Pitch Shaper section |
| 25 | `EDITABLE_VALUE_INVENTORY.md` — "the canonical checklist of editable values" whose stated job is "add a row when you add a control" — has zero rows for four whole control surfaces (JB editor, track-flow boxes, pitch import modal, scale transfer modal); the rule has no enforcement mechanism (`modelCoverage.test.ts` guards module tests, nothing guards inventory rows) | medium (automation/test work depends on it) | DESIGN → guardrail test in [DOC_CURRENCY_GUARDRAILS.md](DOC_CURRENCY_GUARDRAILS.md) |
| 26 | `ARCHITECTURE.md`'s command list was missing 13 of 30 actual Tauri commands, including load-bearing ones (`parallel_set_playback`, `track_save_to_path`/`track_load_from_path`, `transport_resync`, `pitch_import_passage`) | low | **FIXED 2026-07-02**: list completed with one-line descriptions |
| 27 | `ROADMAP.md` still declares "Current Milestone: Trustworthy **Single-Channel** Instrument" and `PRODUCT_VISION.md`'s "Current Product Shape" says "a single-channel sequencer" — both predate parallel tracks, triggered tracks, track flow, Jathi Bhedam, and automation by ~2 months; anyone (human or agent) prioritizing from them gets a stale picture | medium (planning risk) | DESIGN → capability register in [DOC_CURRENCY_GUARDRAILS.md](DOC_CURRENCY_GUARDRAILS.md); milestone rewrite flagged as owner decision |

Root cause shared by 23–27: capability lists are hand-copied across ≥5 docs
with no canonical source and no freshness check. The design doc proposes a
`CAPABILITIES.md` register + a `docCoverage.test.ts` guardrail (same pattern
as the repo's existing `modelCoverage.test.ts`) + a manual render script.

## Verified healthy this pass (no finding)

- **Rhythm core**: `split_pattern_at_protected_cuts` handles unsorted/dup/
  out-of-range cuts; `validate_chain` rejects every documented invalid shape;
  every source rhythm-engine "Tests To Preserve" claim spot-checked maps to a real
  named test (`rhythm_playback_does_not_bridge_jathi_boundaries`,
  `rhythm_playback_rest_cells_are_not_ratcheted`,
  `parallel_allow_all_overlapping_same_pitch_removes_premature_note_offs`, …).
  `enumerate_patterns` is unbounded but only tests/bench call it.
- **Triggers**: self-trigger and dangling-source rejection landed
  (`TriggerRejectReason` in `cseq-trigger/src/config.rs`); one-level-only
  graph enforced; `max_repeats` ceiling present; `onlyWhenSourceAudible` is
  absent but explicitly listed as deferred in the plan's shipped-vs-deferred
  section — honest.
- **Track Flow**: multi-box model is fully implemented end-to-end (backend
  boxes in `trackflow.rs`, `track-flow-add-box` UI, `trackFlowBoxes`
  persistence) — the 2026-06-24 "phases 2-5 remaining" status is obsolete.
- **Channel hocket**: the source rhythm-engine hocket contract matched code down to
  the exact UI operator label subset; accent-rule render-only vs drive-chain
  and the premature-note-off guard all present and tested.
- **Seeds/randomize**: structural randomize domains are playback-locked in the
  UI exactly as `STRUCTURAL_RANDOMIZE_DOMAINS` requires.
- **Bridge surface**: all 30 backend commands are invoked from `bridge.ts` —
  no dead commands.
- **E2E**: 18+ Playwright specs including JB, track-flow, parity, chaos,
  persistence — the launch plan is being executed.

## Cumulative

27 findings across both passes: 12 fixed same-day (10 + findings 24/26), 8
remediation design docs, and the rest tracked in one-shot prompts that were
removed during Seqstart extraction.
