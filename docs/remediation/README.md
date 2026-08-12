# Remediation Designs

Design documents for systemic issues found by the 2026-07-01/02 docs-vs-code
audit. Start with the summaries; each design is self-contained.

- [AUDIT_SUMMARY_2026-07-01.md](AUDIT_SUMMARY_2026-07-01.md) — findings 1-22:
  what was fixed same-day, what needs design work, what was checked and found
  healthy.
- [AUDIT_SUMMARY_2026-07-02.md](AUDIT_SUMMARY_2026-07-02.md) — findings 23-27
  from the completion pass (the clusters the first pass left residual); root
  cause: documentation currency has no guardrails.
- [DOC_CURRENCY_GUARDRAILS.md](DOC_CURRENCY_GUARDRAILS.md) — capability
  register + doc-coverage test + manual render pipeline.
- The source product's copy-paste Claude/Codex fix prompts were removed during
  Seqstart extraction.
- [AUTOMATION_EVALUATION_COMPLETION.md](AUTOMATION_EVALUATION_COMPLETION.md) —
  close the gap between the automation model and the evaluator (cycle-start
  freezing, markers, sample rates, text values, combine semantics, legacy
  lanes).
- [TIMELINE_PARITY_STRUCTURAL_AXIS.md](TIMELINE_PARITY_STRUCTURAL_AXIS.md) —
  realized-geometry layer + structural-axis parity tests (parity plan Phase 2).
- [MIDI_TIMESTAMPED_SCHEDULING.md](MIDI_TIMESTAMPED_SCHEDULING.md) —
  CoreMIDI-timestamped output to retire the tight-loop dispatch ceiling.
- [UI_CRASH_RESILIENCE.md](UI_CRASH_RESILIENCE.md) — error-boundary phases
  (root boundary landed 2026-07-01; panel isolation + diagnostics proposed).
- The source-only Jathi Bhedam/speed remediation was removed with that feature.
- The proposed Subdivision-to-gati naming migration is superseded by Seqstart's
  neutral UI vocabulary; inherited code names remain for upstream diffability.
