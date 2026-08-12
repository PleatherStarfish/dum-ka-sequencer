# Fuzzing

Dum-Ka retains four bounded Rust libFuzzer targets. The manifest,
`scripts/fuzz-targets.sh`, launcher scripts, and committed corpus directories
must name the same set.

| Target | Max input | Purpose |
| --- | ---: | --- |
| `persist_load_score` | 65,536 bytes | Feed UTF-8 JSON to strict score-v1 loading; malformed input must not panic. |
| `score_pipeline` | 65,536 bytes | Load bounded score JSON and apply the transform pipeline across several cycles. |
| `structured_score_pipeline` | 4,096 bytes | Construct bounded valid-ish scores, round-trip/pipeline/realize them, and check tree/seed invariants. |
| `parallel_transport_queue` | 8,192 bytes | Build parallel generator tracks with triggers, Track Flow, hocket, and Channel Logic; prove queue invariants, determinism, and reset/reapply identity. |
| `dumka_dsl_parse` | 4,096 bytes | Feed arbitrary text through the Dum-Ka notation parser, arbitrary-precision compiler, print/parse round trip, and span projector; every input must produce a result or a structured diagnostic, never a panic or hang. |

Inherited model names and compatibility inputs in the score targets are not a
list of current UI features. The fuzzer still exercises the serialization and
transform shapes the retained engine accepts.

## Compile gate

```bash
. "$HOME/.cargo/env"
cargo check --manifest-path fuzz/Cargo.toml --locked
```

This is part of the normal Rust gate and does not require nightly or
`cargo-fuzz`.

## Install and smoke

```bash
. "$HOME/.cargo/env"
scripts/fuzz-setup.sh
FUZZ_RUNS=10000 scripts/fuzz-smoke.sh
```

The smoke launcher validates target/corpus inventory before it runs. Local
findings go under `fuzz/corpus-local/`; committed seed corpora stay under
`fuzz/corpus/`.

Useful controls:

- `FUZZ_RUNS` — run count per target (default 10,000).
- `FUZZ_TIMEOUT` — per-input timeout seconds (default 5).
- `FUZZ_CORPUS_ROOT` — writable local corpus root.
- `FUZZ_VALIDATE_ONLY=1` — check inventory without invoking libFuzzer.

Longer campaigns use `scripts/fuzz-campaign.sh`. Preserve the target list in
`scripts/fuzz-targets.sh` as the single script-side source of truth.

## Reproducing a finding

```bash
. "$HOME/.cargo/env"
cargo +nightly fuzz run <target> <artifact-path>
```

Minimize and commit a small regression input only after adding an ordinary
unit/property regression that names the violated contract. Never weaken a
queue, determinism, or note-balance assertion merely to accept a fuzz finding.

## Related property tests

The invariant suite covers the same risk families with reproducible proptest
cases:

```bash
. "$HOME/.cargo/env"
PROPTEST_CASES=4096 cargo test -p cseq-transport --features fuzzing --test invariants --locked
```

LibFuzzer explores byte/state space; invariant tests supply fast named
regressions. Both are required.
