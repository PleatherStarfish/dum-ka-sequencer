# Provenance

Seqstart is a fresh-history extraction of the platform portions of
`carnatic-seq`. This file records the immutable source identity and the target
history used to produce `/Users/danielmiller/dev/projects/sequencer-quickstart`.

## Dum-Ka copy note (2026-08-10)

`/Users/danielmiller/dev/projects/dum-ka-sequencer` is a full filesystem copy
(including `.git`) of `sequencer-quickstart` at commit `d318a21` plus its then
in-flight managed-launch change, taken to build the Dum-Ka evolving-rhythm
sequencer on the Seqstart platform. The product identity (name, bundle
identifier, window title, virtual MIDI port, file extensions, UI package name)
was renamed to Dum-Ka in this repository's own history immediately after the
copy. Everything below this section is the quickstart's historical record and
deliberately retains Seqstart-era naming and paths; per `DEFER.md`, `cseq-*`
crate names and `CAESURA_*` environment variables are retained for upstream
diffability.

## Source snapshot

| Field | Value |
|---|---|
| Source repository | `carnatic-seq` |
| Source remote | [PleatherStarfish/caesura-sequencer](https://github.com/PleatherStarfish/caesura-sequencer.git) |
| Source ref at extraction | `main` |
| Source commit | `be8b1b8ea65e85104fa32efacdd7a7a1a8fcbe8a` |
| Source tree | `b29bc48829530ea1be8be63fb01f3136ab8223a3` |
| Imported target commit | `a9e62f8229a5a36a5fac522897248280f9c6c192` |
| Imported target tree | `b29bc48829530ea1be8be63fb01f3136ab8223a3` |
| Target source tag | annotated tag `source-be8b1b8` |

The equal tree IDs prove that the initial target commit contains the exact
tracked source snapshot. The extraction subsequently removes or rewrites
features in the target only; target commits are not upstream ancestry.

## Extraction method

The target was initialized with a new root commit rather than cloned or forked
with source history:

```bash
git -C /Users/danielmiller/dev/projects/carnatic-seq archive be8b1b8 \
  | tar -x -C /Users/danielmiller/dev/projects/sequencer-quickstart
git -C /Users/danielmiller/dev/projects/sequencer-quickstart init -b main
```

The root commit is `a9e62f8` (`chore: import carnatic-seq source snapshot`) and
contains the trailer `Source: carnatic-seq @ be8b1b8`. It has no parent. The
annotated `source-be8b1b8` tag points to that target root, not to an object in a
shared source object database. The source repository was treated as read-only.

Verify the source identity independently:

```bash
git -C /Users/danielmiller/dev/projects/carnatic-seq status --short
git -C /Users/danielmiller/dev/projects/carnatic-seq rev-parse HEAD
git -C /Users/danielmiller/dev/projects/carnatic-seq remote get-url origin
```

Expected: no status output, full SHA
`be8b1b8ea65e85104fa32efacdd7a7a1a8fcbe8a`, and the remote recorded above.

## Annotated extraction tags

These tag targets are the phase rollback and audit points present at the start
of P9:

| Tag | Peeled target | Meaning |
|---|---|---|
| `source-be8b1b8` | `a9e62f8229a5a36a5fac522897248280f9c6c192` | Exact imported source tree |
| `phase-0-green` | `23ef450d0a9db71c969e0e1b88d62a0ea2c28b9e` | Baseline and full gate ledger |
| `phase-1-green` | `0226dcd1baed206a0c5e26fb90b8a3a428dc7bcd` | Seqstart identity |
| `phase-2-green` | `94a5bb96e67473e0344db7ef8412be5a7086296b` | Mechanical UI pre-splits |
| `phase-3-green` | `61c4609caae6728927e17fef2e811cb1e7c1614a` | Stripped UI feature surface |
| `phase-4-green` | `b24190951ad66b441a0caecab4b7b20084f072af` | Generator seam and engine strip |
| `phase-5-green` | `0eb1db3035ecc50104b42b355a1278d805feaa7a` | Deterministic section/generator authoring |
| `phase-6-green` | `3c7472b9ad42e0e436cdaf39ec4fd44da2854d7f` | Pure transport split |
| `phase-7-green` | `ce96cef9855316ca73e52f02b6411c60f0aac6d8` | Fork-owned persistence schemas v1 |
| `phase-8-green` | `145b0403e3fb2ad4e99362b17106f9baf669c6ee` | Import, amended regressions, and fail-closed v1 persistence |

P9 adds the annotated release tag `v0.1.0` only after the final local matrix and
release acceptance checks pass.

## License metadata

The imported root `Cargo.toml` and the current workspace metadata declare:

```toml
[workspace.package]
version = "0.1.0"
license = "MIT"
authors = ["Daniel"]
```

`ui/package.json` marks the frontend package `private`. The imported source tree
contains no standalone `LICENSE`, `COPYING`, or `NOTICE` file; the Cargo
metadata above is the license declaration available in the pinned snapshot.
This provenance record is not a replacement for license text.

## Audit ledgers

- [`docs/EXTRACTION_PLAN.md`](docs/EXTRACTION_PLAN.md) is the controlling plan,
  including phase gates and acceptance criteria.
- [`BASELINE.md`](BASELINE.md) records the P0 dress-run and phase-by-phase
  expected-failure accounting.
- [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) records the complete v0.1.0 §12
  release checklist and distinguishes executed gates from hosted/manual items.
- [`docs/EXTRACTION_DEVIATIONS.md`](docs/EXTRACTION_DEVIATIONS.md) records every
  known place where source code contradicted the plan and how intent was
  preserved.
- [`docs/UPSTREAM_FINDINGS.md`](docs/UPSTREAM_FINDINGS.md) records bugs and
  shortcomings observed in `carnatic-seq`; none were backported to the source
  repository during extraction.
- [`DEFER.md`](DEFER.md) records intentionally excluded work.

Tags preserve the ledger state at each phase. Later documentation corrections
do not rewrite an earlier green tag or imply that a finding was fixed upstream.
