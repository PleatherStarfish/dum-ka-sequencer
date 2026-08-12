# Fault Risk Surface Tool

`scripts/fault-risk-surfaces.py` ranks codebase surfaces by likely fault risk.
It is a practical adaptation of Nath and Domingos' AAAI 2016 Tractable Fault
Localization Model (TFLM), not a full reproduction of the paper.

## Model Shape

The paper's TFLM defines a joint probabilistic model over a program tree,
latent subclasses, attributes, and a per-line `buggy` indicator. It can combine
learned program-context patterns with diagnostic features such as Tarantula
coverage suspiciousness.

This repository tool uses the same modeling idea at a coarser granularity:

```text
repo root
  -> surface
     -> file
        -> attributes
```

Each file gets a posterior risk score from a latent-class mixture:

- `semantic_core`
- `boundary_bridge`
- `volatile_ui_state`
- `matrix_probability`
- `test_or_spec`

Surface scores aggregate file risks with expected-fault mass and a noisy-OR
style summary. The output is meant to focus review and testing effort, not to
prove that a file is faulty.

## Evidence Used

The default model uses only local repository evidence:

- Git churn, recent churn, author count, and bug-fix-like commit messages.
- Static size, branch/async complexity, public API count, imports, and
  dependency fan-in/fan-out.
- Project-specific invariant vocabulary, such as scheduler, MIDI, timeline,
  gati, jathi, exact tiling, seed, Markov, ratchet, hocket, patch, DTO,
  channel-conflict/collision (channel logic), and parser/import/export.
- Nearby or inline test signals.
- Dirty/untracked worktree status.

When failing/passing test coverage exists, pass a diagnostic JSON file so the
model can use a Tarantula-style feature similar to the paper.

## Usage

```bash
python3 scripts/fault-risk-surfaces.py --top 25 --surface-top 12
```

Emit machine-readable output:

```bash
python3 scripts/fault-risk-surfaces.py --json
```

Include tests and fuzz targets in the ranking:

```bash
python3 scripts/fault-risk-surfaces.py --include-tests
```

Run the built-in sanity tests:

```bash
python3 scripts/fault-risk-surfaces.py --self-test
```

## Diagnostic Input

The simplest diagnostic input is a direct map:

```json
{
  "crates/cseq-transport/src/lib.rs": 0.92,
  "ui/src/playbackRequests.ts": 0.67
}
```

For Tarantula-style spectra:

```json
{
  "total_failed": 4,
  "total_passed": 16,
  "components": {
    "crates/cseq-transport/src/lib.rs": { "failed": 3, "passed": 2 },
    "ui/src/App.tsx": { "failed": 1, "passed": 14 }
  }
}
```

Run with:

```bash
python3 scripts/fault-risk-surfaces.py --diagnostic-json spectra.json
```

## Reading The Output

The top surface table answers "which area deserves inspection first?" The top
file table answers "where should the next review/test/fuzz pass start?"

Use high-risk, high-confidence rows for direct inspection. Use high-risk,
low-confidence rows as prompts to gather more evidence: add tests, run a focused
fuzzer, generate spectra, or inspect the recent diff.

## Caveats

- Scores are inspection priors, not calibrated bug probabilities.
- Without a labeled local bug corpus, the latent-class weights are expert
  priors informed by common defect predictors and Caesura's documented risk
  invariants.
- Surface aggregation can make large areas look risky because they contain many
  moderately risky files. The top file list is the sharper follow-up view.
- A diagnostic JSON from actual failing tests should override hunches whenever
  available.
