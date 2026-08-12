# Invariant Fuzzer — Property-Based Transport Invariants (2026-07-01)

A proptest-based invariant fuzzer that generates random *valid* Scores + playback
configs across the feature matrix and asserts the transport realize path upholds
four hard invariants on every one. It automates, across the Cartesian product of
source-product features, the seam-at-a-time checking that exposed interaction
bugs. Feature-specific audit documents were removed during Seqstart extraction.

- **Test:** `crates/cseq-transport/tests/invariants.rs`
- **Run:** `cargo test -p cseq-transport --features fuzzing --test invariants`
- **Deep sweep:** `PROPTEST_CASES=5000 cargo test -p cseq-transport --features fuzzing --test invariants`
- **Result (2026-07-01):** GREEN. No invariant violations across 4000+ cases/property.
  Existing suites unchanged: `cargo test --workspace` green (transport 256, transforms 96,
  jathi-bhedam 49, rhythm 109, trigger 93, model 51, realize 15, …); `cargo clippy
  --workspace --all-targets` and `cargo clippy -p cseq-transport --features fuzzing
  --tests` both clean.

---

## Why a `fuzzing`-gated test target

Integration tests in `tests/` see only the **public** API. The single-track realize
loop (`realize_and_enqueue`), the parallel path (`realize_parallel_until`,
`ParallelRuntimeConfig`), the `QueuedEvent` queue, and the private parity oracle
(`finalized_cycle_ledger`, `LedgerNoteGroup`, `metadata_*`) are all crate-private —
invisible to `tests/`. The only public, deterministic, port-less realize hook is
`fuzz_realize_transport_cycles`, gated behind `feature = "fuzzing"` (a live
`Transport` needs a real MIDI port and a real-time thread, so it is not a
synchronous ledger source).

Two changes support the fuzzer, both **behind `feature = "fuzzing"` (zero production
surface):**

1. **New public wrapper** `fuzz_realize_parallel_cycles(config, cycle_count)` in
   `crates/cseq-transport/src/lib.rs` — the parallel/Track-Flow analogue of the
   existing single-track wrapper. It validates the config, builds the runtime, and
   realizes N reference cycles in one `realize_parallel_until` pass (rayon PASS A +
   triggered followers + Track Flow lanes + the conflict pass), projecting the queue
   to the public `TransportFuzzQueuedEvent`. Without it there is **no** public way to
   exercise Track Flow or triggers from a test.
2. **Cargo wiring** (`crates/cseq-transport/Cargo.toml`): a dev-dependency on
   `cseq-jathi-bhedam` (for the JB tiling primitive) and a `[[test]] name =
   "invariants"` with `required-features = ["fuzzing"]`, so the target is skipped by
   a plain `cargo test` and runs only when the feature is on.

The private parity oracle is not exported, so the fuzzer re-implements note-on/off
FIFO pairing against the public event stream (`finalized_ledger`), matching
`finalized_cycle_ledger`'s windowing and pairing.

---

## The generator

Native proptest strategies (semantic shrinking) over the combination space, with
fixed-but-valid "heavy" specs for the rhythm features (the invariants don't depend
on spec internals, only on the feature firing in varied combinations).

- **Score** — `Score::subdivision_switch` with fuzzed `cycle_beats` (1–6), initial
  gati weights (subdivisions 1–8), initial jathi weights (from `[3,4,5,6,7,9,11]`),
  an arbitrary subset of interior-beat inflections (each with its own gati/jathi
  weights and optional JB selection), and a fuzzed `SwitchSeedMode`
  (Locked/PerCycle/History). All `subdivision_switch` panicking preconditions
  (positions strictly in (0,1), beat-aligned, distinct; non-empty initial weights;
  switch counts ≤ inflections) are satisfied by construction.
- **Jathi Bhedam** — attached at the cycle-initial slot and/or per inflection.
  Fuzzes `gati` (1–8), `beats_per_cycle` (1–8), `cycles` (1–4), `seed_numbers`
  (1–12 values in 1–8), **`phrasing` = `Accent` | `NotesPerCell{1..=8}`**, schedule
  (`ops_per_generation` 0–3 over a fixed op menu), `mukthay_policy`, base weight,
  and seed. A `JbState` knob attaches the selection as Absent / Enabled / Disabled.
- **Rhythm shaper** — a Markov chain per span length 1–16 (one note per span), plus
  representative ON specs for **ratchet** (`probability` 1.0, multi-matra), **grace
  ornament**, **pitch shaper**, **channel hocket**, and **cycle-tempo flux**. Each
  is an `X_enabled: bool` + `X: Option<Spec>` pair so "present-but-disabled" is
  distinct from "absent".
- **Parallel / Track Flow / triggers** — 1–3 parallel tracks, an optional Track Flow
  box (2 sources, uniform chain), and an optional trigger (a follower firing on a
  source's beat-0 onset), fed through `fuzz_realize_parallel_cycles`.

**Teeth check** (throwaway diagnostic, 400 samples): ratchet fired in 400/400 cases;
an *enabled* JB changed the transport ledger vs *absent* in 258/400; the direct JB
tiling call produced non-empty spans in 400/400. So none of the invariants are
vacuously satisfied.

---

## The four invariants

1. **Determinism** (`single_track_realization_is_deterministic`,
   `parallel_realization_is_deterministic`) — realizing identical locked-seed inputs
   twice yields a byte-identical `Vec<TransportFuzzQueuedEvent>` ledger (single-track
   *and* the rayon parallel/Track-Flow path). `seed_path_replay_reproduces_ledger`
   additionally captures the seed trace from one run and replays it to the same
   ledger (reproducibility across the persistence boundary).
2. **Feature-off byte-identity** (`disabled_feature_is_inert`) — for each of ratchet
   / ornament / pitch / hocket / flux / Jathi Bhedam, a config with the feature
   *present but disabled* produces a ledger byte-identical to one that never carried
   it. This is the audit's hard-invariant #1, now checked across the whole space:
   a switched-off feature must leave no RNG or output residue.
3. **preview == finalized MIDI** (`ratchet_preview_equals_finalized_midi`) — the
   ratchet preview lane (`result.ratchet`, suppressed events excluded) reconciles
   exactly, per cycle, with the finalized MIDI note ledger's ratchet-tagged notes
   `(onset, end, velocity)`. Mirrors the crate-private
   `assert_metadata_families_match_ledger` ratchet arm.
4. **Structural** (`realization_is_structurally_wellformed`,
   `bhedam_tiles_section_exactly`, `participant_cap_is_enforced`) — the queue is
   tick+dispatch sorted, MIDI bytes are well-formed, `user_channel == wire + 1`,
   notes stay within the realized window, and every note-on pairs with a note-off;
   preview lanes are internally consistent (hits ordered and bounded). Jathi Bhedam
   accent cells **tile a section exactly and the final cell resolves on the section
   sam** (audit hard-invariant #5), checked directly against
   `cseq_jathi_bhedam::realize_section_accents`. And the 16 conflict-participant cap
   is enforced (16 accepted, 17 rejected).

Shrinking + regression seeds are proptest-native: a failing case shrinks to a
minimal reproducer and its seed is written to
`crates/cseq-transport/proptest-regressions/invariants.txt` (commit that file when a
real failure lands). Verified end-to-end with a **negative control**: temporarily
turning a "disabled" ratchet back on made `disabled_feature_is_inert` fail and shrink
to `feat = Ratchet, cycles = 1` with empty inflections and seed 0; reverting restored
green.

---

## Bugs found

**None.** All four invariant families held across 4000+ cases per property. This is
the expected outcome for the recently-audited Jathi Bhedam path and the mature
transport core; the value is the *standing* adversary — the fuzzer re-checks the
whole matrix every time a feature changes, and the negative control proves it will
fail loudly when an invariant breaks.

The fuzzer + wrapper were themselves adversarially reviewed (3 independent skeptics
looking for vacuous/false-positive-prone properties and wrapper mismatches). The
parallel wrapper came back **SOUND**; review-driven tightenings were applied:
stronger grace-ornament hit checks, a `prop_assume` enforcing the JB oversized-cap
coupling in-code, and a reliably-built triggered follower (previously a no-op when a
case generated a single track). No correctness defects were found in the fuzzer.

---

## Known scope / follow-ups

- **Speed automation not fuzzed.** Neither `speed_subdivision` nor the tempo
  `AutomationSet` is exercised: their divisibility-driven *silent fallback* (audit
  C4) and "speed skips bhedam" (audit C3) make byte-identity/preview reconciliation
  noisy, so they were deferred as a lower-value, higher-noise v1 target. Determinism
  for them is partially implied by the seed-path replay path but not asserted here.
- **Parallel invariants are determinism + structural + caps**, not note-balance or
  preview reconciliation: the conflict pass can suppress note groups, so a naive
  balance/parity check would false-positive. The parallel ledger's conflict/track
  metadata is dropped by the `TransportFuzzQueuedEvent` projection.
- **Arbitrary subdivision** (`arbitrary_subdivision_*`) is off; adding a valid ON
  spec would extend the feature-off + determinism coverage.
- **preview==MIDI covers the ratchet lane.** Pitch and channel-hocket lane
  reconciliation require the feature to fire on every note (fragile under random
  configs); they remain covered by the crate's inline parity tests. Extending the
  fuzzer to those lanes (with a firing guarantee) is a natural follow-up.

---

## 2026-07-07 update (Test Coverage Plan 2, Phases 0–3)

The suite has grown well past the four-invariant v1 this document describes;
this section supersedes the counts above (the design rationale still holds).

**Now 11 properties + 1 deterministic boundary test + 3 pinned engine-finding
repros** (`#[ignore]`d until the engine fix lands):

- Single-track axes grew to **ten**: ratchet, ornament grace, ornament DELAY,
  pitch shaper, channel hocket, cycle tempo flux, Beat Locks, Shape Groups
  (incl. And/Not combinators, SetVelocity, the chance gate, and the
  ratchet/ornament trigger ops), arbitrary subdivision, and the stochastic
  articulation layers. `OffFeature` covers Delay and ArbitrarySubdivision too.
- The parallel properties sweep a generated **ParallelParams** case: all 18
  channel-conflict policies, channel-logic matrix rows (channel-specific +
  legacy all-channel), conflict priority (incl. box lanes), five trigger
  variants (legacy condition, WHEN-trees, seeded gates, weighted STARTs,
  quantize + Repeats/Queue/FixedBeats), authored first/second-order Track
  Flow chains, per-track tempo jitter, mute, and per-track shapers.
- New properties: **multi-track seed-path replay**
  (`parallel_seed_path_replay_reproduces_ledger`, via the
  `fuzz_realize_parallel_cycles_traced` hook) and **two-sided wildcard
  scoping** (`seed_path_wildcards_scope_replay`).
- `assert_parallel_queue` now enforces sort order and note-on/off pairing.
  Pairing found a REAL finding family — the parallel path strands note-offs
  under triggered followers or per-track shapers (three repros:
  `trigger_restart_truncation_strands_note_offs`,
  `conflict_suppression_strands_note_offs`,
  `multitrack_shapers_strand_note_offs`). Balance is enforced (and green)
  for every policy over plain tracks; the carve-out and repros come out
  together with the engine fix.
- `max_repeats` semantics are pinned at transport level (per-run pass clamp,
  not a launch budget): `max_repeats_clamps_run_passes_at_transport_level`.
- Golden score ledgers live alongside in `tests/golden_ledgers.rs`.
- **CI**: rust.yml runs the suite at 64 cases on every push/PR; fuzz.yml runs
  a nightly 4096-case deep sweep. (`PROPTEST_CASES` is honored since
  2026-07-06 — the original `proptest_config` hardcoded `cases` and silently
  ignored the env var this doc recommends.)

**Deep-sweep record:** 2026-07-07, `PROPTEST_CASES=4096`, full matrix as
above: **11/11 properties green** (3 repros ignored), no new findings beyond
the pinned family.
