# v0.1.0 acceptance checklist

Recorded 2026-08-03 on macOS with Rust 1.88.0, Node 22.23.1, pnpm
9.15.4, and Playwright 1.42.1 Chromium. A checked item was actually run on
the final P9 runtime/test tree. Unchecked items require infrastructure or human
audible/hardware observation that was not available in this extraction task.

## Automated release matrix

- [x] RUST-GATE:
  `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace --locked && cargo test -p cseq-transport --features fuzzing --test invariants --locked && cargo test -p cseq-transport --features fuzzing --test golden_ledgers --locked && cargo build -p cseq-app --locked`.
  Exit 0; workspace tests, 6 invariants, and 7 golden ledgers passed.
- [x] Acceptance invariants at the prescribed bound:
  `PROPTEST_CASES=64 cargo test -p cseq-transport --features fuzzing --test invariants --locked`.
  Result: 6 passed.
- [x] FUZZ-GATE:
  `cargo check --manifest-path fuzz/Cargo.toml --locked`. Exit 0.
- [x] UI-GATE from `ui/`:
  `pnpm typecheck && pnpm lint && pnpm test && pnpm test:timeline && pnpm build`.
  Result: 65 files / 645 tests and 23 timeline tests passed; lint had 27
  ledgered warnings and no errors; build retained the ledgered chunk warning.
- [x] E2E-MOCK: `pnpm test:e2e`. Result: 93 passed, 0 failed/skipped.
- [x] E2E-REAL: `pnpm test:e2e:real`. Result: 9 passed, 0 failed/skipped.
- [x] E2E-BOOT:
  `pnpm exec playwright test --config playwright.bootcheck.config.ts main-editor-launcher --workers=1`.
  Result: 5 passed.
- [x] FIXTURES update proof, in fixed order:
  `UPDATE_DTO_FIXTURES=1 cargo test -p cseq-app dto_fixture` then
  `pnpm vitest run -u src/dtoContract.generate.test.ts`.
  Both were no-ops; verify-only reruns passed 6 Rust / 2 TypeScript tests.
- [x] LEDGERS update proof:
  `UPDATE_GOLDEN_LEDGERS=1 cargo test -p cseq-transport --features fuzzing --test golden_ledgers --locked`.
  It was a no-op; the verify-only rerun passed 7 tests.
- [x] `BASELINE.md` expected-fail list is empty. Its P0 failures remain only as
  historical evidence; D-020 corrects the stale real-test capture diagnosis.
- [x] Performance baseline was regenerated and verified for all 10 retained
  cases in `0ca4c68`; `scripts/perf-baseline.json` contains only retained
  generator, channel, score, transport, automation, and overlay surfaces.
- [x] Four-workflow static/local audit: 4/4 YAML parsed; six shell scripts passed
  `bash -n`; fuzz manifest/source/corpus exact-set negatives failed closed;
  four retained fuzz targets completed one bounded run each; risk self-test and
  147-file tracked scan passed; mutation selection listed 22 Example and 53
  layer mutants; eight-crate doctest lane passed with zero current doctests.
- [ ] Hosted CI 4/4 green. The target has no Git remote/repository, so no
  workflow could be dispatched. D-018 records this release-environment
  exception; the first publisher must run all four workflows.

The first overlapping mock/real Playwright attempt was discarded because both
processes share `ui/test-results`; every result above is from an isolated final
run. No expected failure or retry was accepted.

## Fresh-launch acceptance

- [ ] Human launch of the packaged Seqstart window and audible deterministic
  default cycle through the built-in synth. Automated bootcheck, real-backend
  boot, default-preview, and real MIDI parity passed, but no listening claim is
  made.
- [ ] Human confirmation that `Seqstart MIDI` is visible in Audio MIDI Setup.
  Identity contracts and the real CoreMIDI-ready lane passed; the OS UI was not
  inspected.
- [ ] Human destination-picker and MIDI-panic smoke. Mock machine-setup e2e,
  Rust MIDI release tests, and real transport/MIDI parity passed; physical
  destination behavior was not observed manually.

## Manual musical smoke

- [ ] Author two sections with different Subdivisions, set Example density 60%
  with Per Cycle seed, and hear the timeline generator lane match audio.
- [ ] Record a seed path and replay it byte-identically while inspecting the
  trace log.
- [ ] Overlap two same-channel tracks and hear Channel Logic `Overlap only`
  gate them.
- [ ] Hear a Track Flow box alternate members.
- [ ] Hear a triggered track launch from a source rest.
- [ ] Hear Euclidean Channel Shaper distribute note groups across channels.
- [ ] Save a patch, quit/relaunch, decline autosave recovery, recall the patch,
  and compare the complete authored state.
- [ ] Export and re-import a track and confirm a fresh track is added.

The corresponding deterministic/mock/real tests all passed, including seed
replay invariants, channel collision and Track Flow engine tests, triggered
real-backend parity, patch save/reload, and both mock and real track import.
Those automated nets do not substitute for the audible/manual wording above.

## Generator recipe and provenance

- [x] [`ADDING_A_GENERATOR.md`](ADDING_A_GENERATOR.md) contains all 12 required
  touch points and cross-references real Example commits: `beb921b`, `e650d56`,
  `0a2cbc9`, `beffb04`, `2b3c401`, `3745df5`, `d35a74c`, `b241909`,
  `ab63e68`, `419a4fb`, `6532c64`, `0589d80`, and `05b0db8`.
- [x] [`PROVENANCE.md`](../PROVENANCE.md) proves equal source/import tree IDs,
  records every P0-P8 annotated tag, and identifies the fresh root commit.
- [x] Source read-only check: status clean, branch `main`, HEAD
  `be8b1b8ea65e85104fa32efacdd7a7a1a8fcbe8a`.
