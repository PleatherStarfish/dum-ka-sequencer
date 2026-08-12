# Design: Documentation Currency Guardrails (capability single-source-of-truth)

Status: proposed (2026-07-02 docs-vs-code audit, part 2)
Owner docs: [docs/README.md](../README.md) "Documentation Maintenance Rules",
[EDITABLE_VALUE_INVENTORY.md](../EDITABLE_VALUE_INVENTORY.md),
[manual/CAESURA_USER_MANUAL.md](../manual/CAESURA_USER_MANUAL.md),
[ROADMAP.md](../ROADMAP.md), [PRODUCT_VISION.md](../PRODUCT_VISION.md)

## Problem

The 2026-07-02 audit pass found that every *code-adjacent* doc (RHYTHM_ENGINE,
KNOWN_RISKS, TESTING, trigger/track-flow plans) is accurate — their claims map
to named tests and real functions. The drift is concentrated entirely in
*capability-list* docs, which are hand-copied in at least five places and age
at different rates:

| Surface | State found (2026-07-02) |
|---|---|
| `docs/manual/CAESURA_USER_MANUAL.md` ("complete user manual") | 0 mentions of Track Flow, pitch import, scale transfer; 3 of Jathi Bhedam; rendered HTML/PDF are 3 weeks older than the .md source |
| Root `README.md` ("mini user manual", designated home of user workflows) | was missing pitch import + scale transfer (fixed 2026-07-02) |
| `docs/EDITABLE_VALUE_INVENTORY.md` ("canonical checklist… add a row when you add a control") | 0 rows for JB editor, track-flow boxes, pitch import modal, scale transfer modal — four whole control surfaces |
| `docs/ROADMAP.md` | "Current Milestone: Trustworthy **Single-Channel** Instrument" — predates parallel tracks, triggers, track flow, JB, automation |
| `docs/PRODUCT_VISION.md` "Current Product Shape" | "a single-channel sequencer" — same staleness |
| `docs/ARCHITECTURE.md` command list | was missing 13 of 30 Tauri commands (fixed 2026-07-02) |

Root cause: the maintenance rules in docs/README.md assign each fact a home,
but nothing *checks* the assignment. Code-adjacent docs stay honest because
tests reference them; capability docs have no equivalent guardrail, and
"current state" prose is duplicated instead of referenced.

## Design

### 1. One capability register, referenced not copied

Add `docs/CAPABILITIES.md`: a flat, dated list of shipped feature ids with a
one-line description each (`jathi-bhedam`, `track-flow-boxes`, `pitch-import`,
`pitch-scale-transfer`, `triggered-tracks`, `automation`, `parallel-tracks`, …).
Each entry lists its landing date and its *documentation surface matrix* — the
docs that must mention it:

```markdown
- id: pitch-scale-transfer   (landed 2026-07-01)
  Rewrite the learned pitch Markov matrix onto a new collection/register.
  surfaces: README.md, manual, EDITABLE_VALUE_INVENTORY.md
```

ROADMAP's "Current capabilities" and PRODUCT_VISION's "Current Product Shape"
shrink to one line each: a link to CAPABILITIES.md. Milestone/priority prose
(the parts only Daniel can write) stays where it is.

### 2. A freshness guardrail test (same pattern as `modelCoverage.test.ts`)

New `ui/src/docCoverage.test.ts` (node-env vitest, reads files via
`import.meta.glob`/raw imports or a small fs read — same approach as the DTO
fixture tests):

- Parses `docs/CAPABILITIES.md` entries and their surface lists.
- For each entry, asserts each named surface file contains the feature id (or
  a `<!-- capability: id -->` marker comment for docs where the natural prose
  wording varies).
- Asserts the rendered manual artifacts are not older than the manual source:
  compare a version stamp line required in both (`Manual version: N`) rather
  than mtimes (mtimes don't survive git). Bump N in the .md when editing; the
  render script writes the same N into the HTML/PDF footer.
- A shrink-only `KNOWN_UNDOCUMENTED` escape hatch, exactly like
  `modelCoverage.test.ts`'s `KNOWN_UNTESTED`, seeded with today's backlog
  (manual: JB/track-flow/pitch-import/scale-transfer; inventory: same four) so
  the test lands green and the backlog burns down visibly.

This makes "shipped a feature without documenting it" a red test — the same
mechanism that already keeps module tests and playback-layer descriptors
honest in this repo.

### 3. Manual render pipeline

There is no script for the documented "render to PDF when changed" rule. Add
`scripts/render-manual.sh` (pandoc → HTML + PDF, checked for availability,
writing the version stamp) and reference it from docs/README.md. Optional CI:
a job that fails when `manual/*.md` changes without the stamp bump.

### 4. Content backfill (owner work, prompts provided)

The guardrail makes gaps visible; filling them is writing work:

1. Manual chapters for JB, track-flow boxes, pitch import, scale transfer,
   triggered tracks (outline from README's sections; the manual's voice).
2. EDITABLE_VALUE_INVENTORY rows for the four missing control surfaces
   (mechanical: walk each panel's controls; the NumericField contract section
   already covers entry semantics).
3. ROADMAP/PRODUCT_VISION current-state refresh → links to CAPABILITIES.md;
   milestone rewrite is a product decision, flagged for Daniel.

## Sequencing

1 (register) + 2 (test with escape hatch) land together in one PR — no content
required, immediately protective. 3 is a small independent script. 4 burns
down the escape hatch list over time.
