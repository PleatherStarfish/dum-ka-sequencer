# Test Coverage Plan 2 — closing the post-May gap

**Status:** Phases 0–4 implemented 2026-07-06/07 (4.3's blocking flip deferred pending soak; see notes) ·
**Created:** 2026-07-06 · **Supersedes nothing** — extends
`docs/TEST_COVERAGE_PLAN.md` (2026-05-30, implemented) after five feature waves
shipped without the fuzz/E2E layers keeping pace.

> **Phase 0 implementation notes (2026-07-06):**
> 0.1 invariant fuzzer in rust.yml (64 cases) + nightly 4096-case deep sweep in
> fuzz.yml — this required fixing `invariants.rs` itself: `proptest_config`
> hardcoded `cases: CASES`, which discarded proptest's `PROPTEST_CASES` env
> handling, so the documented deep-sweep invocation had been silently running
> 64 cases (now honored via `proptest_cases()`; verified 2 cases → 0.03s,
> 512 → 3.76s). 0.2 `fuzz-check` job added to rust.yml but `continue-on-error`
> — KNOWN-RED (13 drift errors) until Phase 1.1 fixes the targets, then flip it
> blocking. 0.3 `cargo +nightly install cargo-fuzz` (root rust-toolchain.toml
> pin was hijacking the install; nightly satisfies cargo-fuzz's ≥1.91 MSRV) —
> note the unmasked nightly smoke will now fail on the 4 broken targets until
> Phase 1.1, with the new failure-issue notification making that loud instead
> of silent. 0.4 Playwright projects (chromium/fuzz/chaos/tools) replace the
> package.json file list; stable lane now auto-collects new specs (16 files /
> 84 tests, up from 12 files; the 4 orphaned specs restored). 0.5 push trigger
> on e2e.yml + concurrency group. 0.6 notification job landed; the stale
> empty-input crash-artifact triage is DEFERRED to Phase 1.1 (transport_queue
> must compile before the input can be replayed).
>
> **Post-review fixes (same day, from an adversarial review against live CI
> runs):** (a) `libasound2-dev` added to all four new/reactivated Rust jobs —
> cseq-transport → cseq-midi → midir → alsa-sys needs ALSA headers, and only
> the main test job was getting them transitively via the WebKit deps; the
> first `fuzz-check` run died in alsa-sys before reaching the drift errors.
> (b) A THIRD silent-rot instance found and fixed: `ui/pnpm-lock.yaml` was
> regenerated as lockfileVersion 9.0 on 2026-06-12 while `packageManager` and
> all workflows pinned pnpm 7.33.7 — every ui.yml/e2e.yml run since had died
> at `pnpm install` in ~19s. Pins bumped to 9.15.4 (the locally-installed
> generator); frozen-lockfile install verified locally. (c) `issues: write`
> scoped to the notify job only. (d) Garbage `PROPTEST_CASES` now panics
> instead of silently running the 64-case default. (e) Known for Phase 1.3:
> at HEAD the chromium E2E lane fails suite-wide at app boot
> (`waitForTimelineReady` hangs; suspected mockTauri preview-payload drift
> from the 2026-07-06 restructure) — broader than §1.c's 11-spec estimate, so
> the repair starts at the harness/mock, not the individual specs. Also noted
> for Phase 1.1: `fuzz/Cargo.lock` must be regenerated on workspace dep bumps
> or the (then-blocking) `fuzz-check --locked` job fails on the lockfile
> rather than on drift.

Audit method: six parallel layer audits (cargo-fuzz, invariant fuzzer, E2E,
frontend unit, CI/risk tooling, engine seams) + four live verification runs,
2026-07-06 at commit `9b0c057`. Every "verified" claim below was reproduced by
running the command or reading the cited line, not inferred from docs.

---

## 1 · State of the harness (verified 2026-07-06)

### Green
- **Rust workspace: 816 tests pass** (cseq-transport 298 + invariants 9,
  cseq-rhythm 150, cseq-transforms 96, cseq-trigger 95, cseq-jathi-bhedam 49,
  cseq-model 60, cseq-app 37, cseq-realize 15, cseq-persist 4, cseq-midi 2).
- **Invariant fuzzer: 9 properties green** (`PROPTEST_CASES=25`, live tree):
  `bhedam_tiles_section_exactly`, `participant_cap_is_enforced`,
  `ratchet_preview_equals_finalized_midi`, `disabled_feature_is_inert`,
  `realization_is_structurally_wellformed`,
  `seed_path_replay_reproduces_ledger`,
  `single_track_realization_is_deterministic`,
  `parallel_realization_is_deterministic`,
  `parallel_reapply_is_bit_identical_to_fresh`.
  The matrix includes beat_locks and shape_groups (added 2026-07-06). This
  layer **was** kept up — but see 1.b: it gates nothing.
- **Frontend vitest suite green**; DTO contract fixtures (Rust→TS typed
  literals + TS→Rust snapshots) operational.
- Playwright **collects** 96 tests / 21 files (collection ≠ passing; see 1.c).

### Broken or silently disconnected

**a. cargo-fuzz layer is inert — 4 of 7 targets no longer compile** (13 errors,
verified via `cargo check --manifest-path fuzz/Cargo.toml`):

| Target | Breakage | Field landed |
|---|---|---|
| `structured_score_pipeline` | `SubdivisionSwitchSpec.initial_jathi_bhedam`, `SubdivisionInflection.jathi_bhedam` | 2026-06-02 |
| `structured_rhythm_layers` | `RhythmSpanInput.start_matra`; `resolve_rhythm_articulation` gained 4th param `Option<&LockOverlay>` | 2026-07-06 |
| `structured_pitch_channel` | `PitchShaperSpec.collection`; `ChannelHocketSpec.position_rules` | 2026-05-29 / 2026-07-03 |
| `transport_queue` | `RhythmPlaybackConfig.{beat_locks_enabled,beat_locks,shape_groups_enabled,shape_groups}`; `SeedPathPlaybackEntry.track_id` (+ inherited drift) | 2026-07-06 |

The three JSON-input targets (`persist_load_score`, `score_pipeline`,
`rhythm_specs`) still compile. Corpora frozen: last local fuzz run 2026-05-27
(corpus-local mtimes); checked-in corpus 1–3 seeds per target from 2026-05-16;
`fuzz/dictionaries/cseq-json.dict` (64 tokens) has **no** vocabulary for
jathiBhedam, beatLocks, shapeGroups, automation, positionRules, collection, or
entryWeights. One untriaged zero-byte crash artifact sits in
`fuzz/artifacts/transport_queue/` from 2026-05-16.

**b. `fuzz.yml` has failed 60/60 runs since 2026-05-17** — it currently dies in
~40s at `cargo install cargo-fuzz --locked` (`cargo-platform@0.3.3` needs rustc
1.91; pinned toolchain is 1.88), so the compile drift above produced **zero CI
signal**. Worse: the **invariant fuzzer never runs in CI at all** — the test
target is gated `required-features = ["fuzzing"]`
(`crates/cseq-transport/Cargo.toml:38`) and `rust.yml:68` runs
`cargo llvm-cov --workspace --locked` with no feature flags, so cargo silently
skips it. Every determinism / parity / replay / feature-off property we rely on
gates nothing. (Three independent audit passes converged on this.)

**c. E2E suite is red-on-arrival after the 2026-07-06 restructure.** Commit
`780cc6f` retired the `score` main-editor id (deleted `ScoreSetupPanel`, merged
Cycle into Sections, added `shape`) and touched zero files under `ui/tests/`.
`appHarness.ts:116-131` still maps `score` → `#score-setup-panel` /
`main-editor-launcher-score`, which no longer renders; 11 specs route through
it. The harness's `MainEditorId` union has no `shape`, so **no spec can even
open the Shape Groups editor**. Last local run evidence predates the
restructure (`ui/test-results/` empty, mtime Jul 1; root
`test-results/.last-run.json` = `{"status":"failed"}` from Jun 18).

**d. Four functional specs are orphaned from every CI lane.** `ui/package.json:15`
defines `test:e2e` as an explicit 12-file list (last updated 2026-06-17);
`track-flow.spec.ts`, `channel-shaper.spec.ts`, `pitch-shaper-restructure.spec.ts`,
`control-chrome.spec.ts` are on disk but in no script and no workflow. The
track-flow spec is the *only* check that drag-to-assign routes a track into
`trackFlowBoxes` in the playback request. Additionally `e2e.yml` has **no
`push` trigger** and is non-blocking by design — with a direct-to-main commit
workflow, E2E runs at most nightly and its redness alerts no one.

**e. Coverage program stalled at "measure".** FE lcov artifact is from
2026-05-30 (16.3% lines, `all:true`); no thresholds/ratchet anywhere
(`vitest.config.ts` has none; `rust.yml` comments "no hard threshold yet").
Perf benches (cseq-bench, `ui/src/perf.bench.ts`) are wired into no workflow —
perf regressions ship silently.

---

## 2 · Gap matrix — feature × layer

✓ solid · ◐ partial/fixed-point · ✗ absent · **bold** = new-feature gap.
"Inv" = invariant fuzzer matrix; "Fuzz" = cargo-fuzz reach (as-written, i.e.
once compile is fixed); "E2E" counts only specs actually wired into CI.

| Feature | Rust unit | Inv | Fuzz | FE unit | E2E |
|---|---|---|---|---|---|
| 1 Sections/subdivisions | ✓ | ✓ | ◐ (no custom subdiv/section counts) | ✓ | ◐ |
| 2 Jathi Bhedam | ✓ (49) | ✓ tiling | **✗ (never generated; dict empty)** | ✓ | ◐ (1 spec) |
| 3 Rhythm chains | ✓ | ◐ degenerate (1 state, no entry/fallback variation) | ◐ (entry weights never generated) | ✓ | ◐ persistence-only |
| 4 Arbitrary subdivision | ✓ | ✗ (hardwired off) | ✓ spec surface | ✓ | ✗ |
| 5 Articulation layers | ✓ | ✗ (`articulation: None`) | ◐ (cells only; position/neighbor/blend defaulted) | ✓ | ◐ persistence-only |
| 6 Ratchet | ✓ | ✓ (parity lane) | ✓ extensive | ✓ | ◐ persistence-only |
| 7 Ornaments | ✓ | ◐ **delay hardwired off** | ✓ | ◐ (no dedicated module) | ◐ persistence-only |
| 8 Pitch shaper | ✓ | ◐ (boundary policies/transposition defaulted) | ✓ (needs `collection` fix) | ✓ | **✗ orphaned spec** |
| 9 Channel hocket | ✓ | ◐ | ✓ (needs `position_rules` fix) | ✓ | **✗ orphaned spec; positions tab (07-03) uncovered anywhere in E2E** |
| 10 Multi-track | ✓ | ◐ (tempo fixed 120, mute never true) | **✗ no parallel target** | ✓ | ◐ (mute/solo never clicked) |
| 11 Channel logic (17 policies) | ✓ | **✗ AllowAll only, empty matrix/priority** | **✗** | ✓ | ✗ |
| 12 Track Flow | ✓ | ◐ (`spec: None` uniform chain only) | **✗** | ✓ | **✗ spec orphaned; matrix modal/chain editor/box seed untouched** |
| 13 Triggered tracks | ✓ (95) | ◐ one fixed shape (no when-trees/quantize/gate/startSelect) | **✗** | ✓ | ◐ (defaults only; no validation/maxRepeats) |
| 14 Beat Locks | ✓ | ✓ | **✗ (predates feature)** | ✓ (no deep-eq round-trip) | **✗ zero** |
| 15 Shape Groups | ✓ | ◐ (no And/Not/SetVelocity; chance ✓) | **✗ (predates feature)** | ✓ (no deep-eq round-trip) | **✗ zero; harness can't open editor** |
| 16 Automation | ✓ | **✗ always None** | **✗ always None** | ✓ | ◐ (replace+linear/hold only) |
| 17 Cycle tempo flux | ✓ | ✓ | ✓ | ✓ | ◐ persistence-only |
| 18 Seed system | ✓ | ◐ (replay ✓ single-track; **wildcards always empty**) | ◐ (wildcards never fuzzed) | ◐ | ◐ presence-only |
| 19 Patch persistence | ◐ (**persist: 4 tests; v2→v3 migration missing, `SCHEMA_VERSION=3`**) | ✗ round-trip property | ✓ load fuzz | ✓ | ✓ (19 tests) |
| 20 Timeline parity | ✓ ledger tests | ◐ ratchet lane only | ✗ | ✓ coordinate contract | ◐ |
| 21 Transport/MIDI | ◐ (**cseq-midi: 2 tests; scheduler_loop untestable**) | ◐ queue-level | ✓ queue-level | n/a | ◐ (real-backend, self-skips w/o MIDI) |

---

## 3 · High-risk services (risk-ranked)

Corroborated by a live `scripts/fault-risk-surfaces.py` run (top files with
"weak nearby test signal": `useRhythmShaperState.tsx` #3,
`useChannelShaperState.tsx` #8, `SectionBoundariesPanel.tsx` #11,
`TriggerInspector.tsx` #12, `SeedSetupDialog.tsx` #13, `TimelinePanel.tsx` #17).

1. **The CI seam itself.** The two strongest layers we own (invariant fuzzer,
   cargo-fuzz) gate nothing; the E2E lane is non-blocking, nightly-only, and
   currently red. Until Phase 0 lands, every other investment is unprotected.
2. **Preview↔transport parity at the *real* entry point.** The T8 parity tests
   mirror the preview pipeline inside cseq-transport
   (`lib.rs:22330-22374`) instead of calling `rhythm_preview`
   (`src-tauri/src/main.rs:2315`). main.rs-only derivations (cycle_beats from
   FE-supplied `beats`) are uncovered. Known hole: the **JB-H NotesPerCell fill
   runs transport-side after the shared seam** (`lib.rs:8839+`), preview has no
   notes_per_cell handling, and `PulseSpanDto` drops it (`main.rs:2642-2645`) —
   no test covers the stopped-preview rendering of a NotesPerCell cell.
   Writing this test may expose a live parity divergence.
3. **Live scheduler dispatch thread.** `scheduler_loop` (`lib.rs:13788`) takes
   a concrete CoreMIDI `MidiOutput`; no sink trait/fake exists, so the actual
   dispatch path (SetTempo mid-play continuity, hung-note sweep, all-notes-off
   on drop) has zero automated coverage. Hung-note blast radius.
4. **Persistence schema drift.** `SCHEMA_VERSION = 3`
   (`cseq-model/src/lib.rs:1360`) but `migrate()` only implements v1→v2
   (`cseq-persist/src/lib.rs:75-80`, "Future:" comment). No v2 fixture test, no
   v1→3 chain, no idempotence property, no save/load/realize-equivalence
   property. cseq-persist has 4 tests total.
5. **Channel conflict logic.** 17 policies + matrix + priority resolve
   cross-track MIDI ownership; the invariant matrix pins `AllowAll` with empty
   matrix/priority, and `assert_parallel_queue` checks only window bounds +
   byte shape — **no note-on/off pairing or sort invariant on the parallel
   queue**.
6. **Seed replay beyond one track.** Full-realize replay tests are all
   single-track; track-scoped entries, composite Track-Flow ids, and wildcard ×
   history-mode interactions are tested only at lookup level. Replay is a
   headline product feature (TENOR paper reproducibility).
7. **MIDI byte/output layer.** cseq-midi: 2 tests (host_time only); one 13-line
   golden in the whole workspace; examples/scores enforced only as
   serialization round-trips, never realized into pinned event ledgers.

---

## 4 · The plan

### Phase 0 — Reconnect the safety nets (S, ~1 day, do first)

Everything here is config/CI; no production code.

- **0.1 Run the invariant fuzzer in CI.** Add to `rust.yml`:
  `cargo test -p cseq-transport --features fuzzing --test invariants` with
  `PROPTEST_CASES=64` on PR/push; add a nightly deep sweep (≥1024 cases) to
  `fuzz.yml`. This is the single highest-leverage line in this plan.
- **0.2 Gate fuzz-target compile on every push.** Add
  `cargo check --manifest-path fuzz/Cargo.toml` to `rust.yml` (stable, cheap).
  Compile drift becomes a red PR instead of a 6-week silent rot.
- **0.3 Fix `fuzz.yml` install.** Replace `cargo install cargo-fuzz --locked`
  with a pinned binary install (`taiki-e/install-action@cargo-fuzz` or pin a
  cargo-fuzz version compatible with rustc 1.88) — or bump the toolchain pin.
  Add a failure-notification step; it has been red for 7 weeks unnoticed.
- **0.4 De-enumerate `test:e2e`.** Switch `ui/package.json` to a default
  `playwright test` run with explicit *excludes* for fuzz/chaos/soak, so a new
  spec can never silently fall out of CI again. Restores track-flow,
  channel-shaper, pitch-shaper-restructure, control-chrome.
- **0.5 Add `push: branches [main]` to `e2e.yml`** (repo commits direct to
  main; PR-only means it effectively never runs pre-nightly). Keep
  non-blocking for now; revisit in Phase 4.
- **0.6 Scheduled-workflow hygiene.** GitHub disables cron workflows after 60
  days of inactivity; add a keepalive or monitor. Triage/delete the stale
  empty-input crash artifact in `fuzz/artifacts/transport_queue/` (verify empty
  input no longer crashes; add the regression seed if it does).

**Acceptance:** a PR that breaks an invariant property, a fuzz-target build, or
any on-disk e2e spec fails a visible check within one push.

> **Phase 1 implementation notes (2026-07-07):**
> **1.1** All 13 compile errors fixed as generated dimensions, not
> default-fill: Jathi Bhedam selections + custom subdivisions
> (`structured_score_pipeline`, `transport_queue` scores), pitch collections +
> channel position rules + entry weights (`structured_pitch_channel`,
> `transport_queue`), contiguous `start_matra` geometry + the full
> `resolve_rhythm_overlays` seam with generated Beat Lock/Shape Group specs in
> transport order (`structured_rhythm_layers`), Beat Locks + Shape Groups
> (selection algebra incl. and/not, chance gate 0/interior/100, trigger + 
> pitch-math ops) + per-track seed-path `track_id` in `transport_queue`.
> Shared generators live in `fuzz/fuzz_targets/common.rs`. Verified:
> `cargo check --locked` clean, `cargo +nightly fuzz build` clean, 3000-run
> smoke clean on all 7 targets. `rust.yml`'s `fuzz-check` job flipped to
> BLOCKING. **1.2** Dictionary grew 64→~140 tokens (JB, custom-subdivision,
> collection, position-rule, entry-weight, automation vocabulary); 5 learned
> corpus entries promoted per target (checked-in seeds 1→6). The stale
> empty-input `transport_queue` artifact replayed clean and was deleted
> (logged in FUZZING.md). **1.3** Boot hang root-caused: the hand-written mock
> preview/snapshot cell builders lacked the `locked`/`lockPinnedTie`/`shaped`
> fields the regenerated DTO fixtures carry, so the strict shape check threw
> and `waitForTimelineReady` starved (both builders fixed). Harness re-pointed
> score→shape; 12 spec files rewired (cycle-setup flows → the boundaries
> editor; tile lists → shape). Second-order fixes: `getByRole` "New track"
> substring-collided with the new "New Track Flow box" button (exact: true);
> neutral cycle default is now 4 beats (spec expectations updated); "Global
> Cycle"→"Project cycle" label; automation lane toggle + trigger NOT-toggle
> migrated to the react-aria Switch. **Two REAL app defects found by the
> revived suite and fixed:** (a) the live-apply dedup was reset to "" at Play
> and keyed on order-sensitive JSON, so a UI-only shown-track switch re-pushed
> `parallel_set_playback` to the running transport (App.tsx seeds the key at
> Play; key is order-insensitive via `parallelPushDedupKey`); (b) the parallel
> request emitted each track's stored ratchet spec verbatim, whose
> `internalRhythm.chains` was a capture-time snapshot of the then-active
> track's derived chains — now re-derived per track in
> `rhythmPlaybackRequestFromParallelTrack`, making the request a pure function
> of project content. **1.4** `ui/src/e2eHarnessContract.test.ts` binds the
> harness editor-id map to `MainEditorChrome`'s union + panel DOM ids in the
> vitest fast lane. TESTING.md's "neutral patch is a 1-beat cycle" note is
> stale (now 4 beats) — fold into the Phase 4.4 doc refresh.

### Phase 1 — Repair the two broken layers (M)

- **1.1 Fix the 13 cargo-fuzz compile errors — as fuzzed dimensions, not
  default-fill.** While touching each initializer, generate the new fields:
  `jathi_bhedam`/`initial_jathi_bhedam` (ops, phrasing, NotesPerCell),
  `collection`, `position_rules`, `start_matra`, the `LockOverlay` param, and
  `beat_locks`/`shape_groups` + `SeedPathPlaybackEntry.track_id` in
  `transport_queue`. Default-filling would compile but preserve the coverage
  gap.
- **1.2 Refresh dictionary + corpora.** Add tokens: `jathiBhedam`,
  `notesPerCell`, `beatLocks`, `shapeGroups`, `chancePercent`,
  `respectCooldown`, `triggerRatchet`, `triggerOrnament`, `positionRules`,
  `collection`, `entryWeights`, automation vocabulary (`markers`, `anchorId`,
  `combine`, `graphRange`). Re-run a local campaign
  (`scripts/fuzz-campaign.sh`) to rebuild corpus-local; promote a handful of
  interesting inputs into the checked-in corpus (FUZZING.md "Next Steps" item 1,
  open since May).
- **1.3 Repair the E2E harness + 11 broken specs.** Update
  `appHarness.ts` for the retired `score` id and merged Sections editor; add
  `shape` to the `MainEditorId` union. Run the full suite locally to green
  before touching CI gating.
- **1.4 Prevent recurrence with a contract test.** A vitest spec that imports
  the harness's editor-id → testid map and asserts every id resolves against
  `App.tsx`'s launcher testids (source-scan, same pattern as
  `timelineModel.test.ts`'s raw-conversion ban). A future restructure then
  fails in the fast lane, not silently in a nightly.

**Acceptance:** `cargo fuzz build` clean; smoke run (10k execs/target) clean;
`pnpm --dir ui test:e2e` green locally and in the nightly.

> **Phase 2 implementation notes (2026-07-07):**
> **2.1** The invariant matrix grew from 9 to 11 properties and from 7 to 10
> single-track feature axes (arbitrary subdivision ON, ornament delay ON,
> articulation layers, shape-group And/Not/SetVelocity), and the parallel
> properties moved onto a generated `ParallelParams` case covering all 18
> channel-logic policies + matrix rows + priority (with note-pairing and
> sort-order invariants on the parallel queue), five trigger variants
> (legacy condition, WHEN-trees, gates with seeds, weighted STARTs,
> quantize + Repeats/Queue/FixedBeats), authored first/second-order Track
> Flow chains, per-track tempo jitter, mute, and per-track lock/shape
> shapers. Two NEW properties: multi-track seed-path replay (via a new
> fuzzing-only `fuzz_realize_parallel_cycles_traced` engine hook — the
> parallel hooks previously discarded seed traces) and two-sided wildcard
> scoping (non-matching wildcards preserve replay; wildcarding every domain
> against an unchanged config reproduces the original). Deep sweeps green.
> **A FAMILY OF REAL ENGINE FINDINGS — the parallel path strands note-offs
> (on survives, off never lands) in at least three shapes, pinned as ignored
> repros with a documented carve-out in `assert_parallel_queue`:**
> (a) trigger restart truncation at cycle granularity strands the offs of
> tied notes in the superseded launch
> (`trigger_restart_truncation_strands_note_offs`); (b) conflict suppression
> over tempo-warped shaper overlaps drops offs whose ons survive
> (`conflict_suppression_strands_note_offs`); (c) even AllowAll with no
> trigger and no suppression — three plain tracks carrying lock/shape/ratchet
> shapers — strands offs (`multitrack_shapers_strand_note_offs`), while the
> single-track path holds balance for identical configs, so this is
> parallel-path bookkeeping (likely cross-cycle lock/shape ties whose offs
> belong to cycles the parallel window never realizes). Nothing in normal
> playback releases a stranded on (`orphaned_active_notes` runs only on
> config swaps) — hung-note class, exactly what §3 item 3 predicted. One
> engine investigation should cover the family; when it lands, un-ignore the
> repros and delete the carve-outs (invariants + parallel_transport_queue).
> Balance IS fully enforced (and green at 1024+ cases) for every
> policy/matrix/priority combination over plain tracks, so conflict-pass pair
> atomicity for simple notes is proven.
> **UPDATE 2026-07-07 (later same day): the family is FIXED** — all three
> shapes shared one root: the conflict pass's same-pitch note-off dedup
> *dropped* strictly-spanned offs. It now *defers* them to the overlap
> chain's end (`defer_premature_same_pitch_note_offs`); a scheduler-side
> `stuck_note_residue` sweep contains any future regression to ~one realize
> window; the three repros run un-ignored as regression pins; the
> `allow_known_orphans` carve-outs are deleted from both harnesses; balance
> is unconditional (4096-case parallel sweep green). See
> docs/CHANNEL_LOGIC.md §3.6-3.7 and docs/CHANNEL_LOGIC_PLAN.md A1. **2.2** New `parallel_transport_queue` cargo-fuzz target wired
> to the previously-unused parallel hooks (3000-run smoke clean; added to
> fuzz-smoke.sh + corpus). The planned transport_queue automation dimension
> remains deferred with the invariant fuzzer's documented automation
> deferral (divisibility-fallback noise). **2.4** cseq-persist: the missing
> v2→v3 migration turned out to mask a REAL defect — migrated v1 docs
> re-saved as v2 (persistent downgrade) because migration stamped 2 and
> save() writes the struct's field; `migrate_v2_to_v3` now restamps to the
> current schema (all v3 field additions are serde-default-covered), with
> v2-fixture, v1→v3-chain, and idempotence tests. New
> `crates/cseq-persist/tests/roundtrip.rs` proptest suite:
> `save(load(x)) == x` value identity + double-round-trip idempotence across
> generated scores (persist was the only engine crate without a
> property-based adversary). patchIo round-trip now strict-deep-equal
> asserts the beatLocks/shapeGroups sections against the authored active
> track AND flat↔project consistency. **DTO fixtures** now populated both
> directions: the Rust→TS rhythm-preview fixture carries a firing
> BeatLockSpec + ShapeGroupSet (cells show locked/lockPinnedTie/shaped true,
> with in-generator asserts so it can't regress to trivial), and a new
> TS→Rust `rhythm_preview_request.json` seam deserializes through
> `RhythmPreviewRequestDto` and asserts realize-equality — pinning
> `chancePercent`/`respectCooldown`/`cellArticulations` through real serde
> (`validate_patch_document` is shallow, so the request seam is where those
> names are actually proven). **2.3** Four new Playwright specs
> (beat-locks, shape-groups, track-flow-matrix, channel-positions): lock
> authoring incl. perBeat expansion to derived per-beat engine locks + full
> patch save/delete/recall round-trip; shape-group selection algebra with a
> negated condition + chance 60 asserted in both the ShapeSelectionMatrix
> viz and the request tree; Track Flow matrix-modal chain/seed authoring
> asserted in the box lane's request (members, seed, re-indexed chain);
> channel position rules normalized into the request and dropped when
> disabled. Stable suite now 88 tests / 20 files, all green. Noted E2E
> gaps: shape trigger-ops path, box fallback weights (no UI affordance),
> customWeighted reset grid.

### Phase 2 — Cover the new features at the layers that matter (M–L)

Priority within the phase: invariant matrix first (cheapest per unit of
confidence), then fuzz targets, then E2E, then persistence properties.

- **2.1 Invariant-matrix extensions** (`invariants.rs`):
  - **Channel logic axis**: generate policy (all 17 kinds), matrix entries, and
    priority orderings; extend `assert_parallel_queue` with **note-on/off
    pairing and sort-order invariants** (currently window+bytes only).
  - **Trigger axis**: generate when-predicate trees, launch quantize grids,
    lifetimes (incl. `Repeats`), gate probability/seed, weighted startSelect.
  - **Track Flow axis**: `spec: Some` with weighted + second-order chains and
    entry/fallback weights; follower tracks that carry shapers (rhythm +
    pitch + hocket), not `rhythm: None`.
  - **Parallel seed-path replay property**: record a multi-track trace (incl. a
    box lane and a triggered follower), replay, assert ledger equality — the
    single-track version already exists as invariant 1b.
  - **Wildcard axis**: non-empty wildcard rules × seed modes (esp. History),
    `track_id: None` vs scoped.
  - Un-pin the deferred dimensions: arbitrary subdivision ON, ornament delay
    ON, articulation `Some` (position rules / neighbor / blend), shape-group
    `And`/`Not`/`SetVelocity`, per-track tempo/cycle variation, `silent: true`.
  - Fix the header ("Four invariant families" → current nine) and record a
    fresh deep sweep (≥4000 cases) for the extended matrix.
- **2.2 New cargo-fuzz target `parallel_transport_queue`** calling the
  purpose-built but never-wired `fuzz_realize_parallel_cycles`
  (`cseq-transport/src/lib.rs:740`) — multi-track + triggers + Track Flow +
  conflict pass under libFuzzer. Extend `transport_queue` with beat-lock /
  shape-group / automation dimensions.
- **2.3 E2E for the July features** (after 1.3):
  - Beat Locks: author a lock through the editor (span + perBeat, pattern
    pool, per-cell overrides) → assert the `beatLockSpec` in the playback
    request + patch round-trip.
  - Shape Groups: build a composed selection (and/or/not + euclidean) with
    chance < 100 and a TriggerRatchet op → assert request payload, selection
    matrix renders, patch round-trip.
  - Track Flow: DnD matrix modal, chain editor, box seed
    (`track-flow-matrix-modal`, `track-flow-chain-editor`,
    `track-flow-box-seed` testids exist and are untouched by any spec).
  - Channel position rules tab (shipped 07-03, zero E2E anywhere).
  - Smaller: mute/solo clicks, trigger validation rejections, custom
    subdivision authoring.
- **2.4 Persistence hardening**:
  - Decide and implement (or explicitly retire) the **v2→v3 migration**; tests:
    v2 fixture load, v1→3 chain, migration idempotence.
  - Property tests in cseq-persist: `save(load(x)) == x` and
    realize-equivalence after round-trip across generated scores (proptest —
    the only engine crate without it).
  - `patchIo.test.ts`: strict deep-equality round-trip assertions for
    `beatLocks` and `shapeGroups` sections (currently idempotence-only).
  - Regenerate DTO contract fixtures with **populated** beat locks + shape
    groups so `chancePercent`/`respectCooldown` serde names are byte-pinned
    (fixtures currently contain only empty containers; camelCase renames are
    enforced by nothing).

> **Phase 3 implementation notes (2026-07-07):**
> **3.1** The JB-H NotesPerCell preview divergence is FIXED, not just tested:
> the fill is now ONE shared implementation
> (`cseq_rhythm::apply_notes_per_cell_fill`, lock/shape guard included) used
> by both the transport realize path and the REAL `rhythm_preview` command;
> `RhythmSpanInput`/`PulseSpanDto` carry `notesPerCell` end-to-end (FE echoes
> it in preview requests), so the STOPPED timeline finally depicts what
> playback plays. Pinned by `rhythm_preview_voices_notes_per_cell_like_transport`
> in src-tauri (through the real entry point, empty-`beats` derivation and
> lock-wins-over-fill included) and fuzzed as a dimension in
> `structured_rhythm_layers`. **3.2** New `cseq_midi::MidiSink` trait (real
> `MidiOutput` implements it; `scheduler_loop`, `release_orphan_notes`, and
> `send_all_notes_off_logged` are generic over it) + a recording fake driving
> the orphan-release and blanket-all-notes-off tests off-hardware. Full
> clock-driven loop simulation remains future work (needs a clock trait).
> **3.3** Pure byte builders (`note_on_bytes`/`note_off_bytes`/
> `all_notes_off_bytes`) with masking table tests, and golden MIDI event
> ledgers for all six `examples/scores` fixtures realized through the real
> transport (committed under `crates/cseq-transport/tests/goldens/`,
> regenerate with `UPDATE_GOLDEN_LEDGERS=1`; wired into rust.yml). **3.4**
> `max_repeats` turned out to be a per-run pass clamp, not a launch budget —
> the transport-level test (`max_repeats_clamps_run_passes_at_transport_level`,
> gate-forced single run) pins the real semantics. **3.5** Report-only perf
> gates: `scripts/perf-check.py` + committed `scripts/perf-baseline.json`
> (18 benches, backend medians + FE means), nightly `perf` job in fuzz.yml
> with warnings/annotations/step-summary and baseline artifact; `--strict`
> ready for the enforcement flip. **3.6** `real-backend-macos` job
> (nightly/manual, macOS minutes are ~10×): native CoreMIDI cargo tests
> (`-p cseq-midi -p cseq-transport --features fuzzing`) + the real-backend
> Playwright suite; the MIDI-parity self-skip is now LOUD on both Linux and
> macOS jobs (skip-vs-ran report in the step summary).

### Phase 3 — High-risk seam hardening (L)

- **3.1 True preview parity.** Factor `rhythm_preview`'s core out of the Tauri
  command into a lib-callable function (or drive it via `tauri::test` IPC like
  the e2e harness) and assert preview == transport ledger through the *real*
  entry point, including empty-`beats` cycle_beats derivation. Add the
  **JB-H NotesPerCell stopped-preview test first** — expected to surface a real
  divergence; resolve or document the intended behavior.
- **3.2 `MidiSink` trait + fake.** Abstract `MidiOutput` behind a trait so
  `scheduler_loop` runs in tests. Then: SetTempo mid-play fractional-tick
  continuity, hung-note sweep on stop/underrun, all-notes-off on drop,
  timestamped send ordering.
- **3.3 MIDI golden ledger corpus.** Realize each `examples/scores` fixture
  through the transport with locked seeds and pin the event ledger (insta or
  JSON goldens). This converts the 6 existing fixtures from schema anchors into
  output regressions — the cheapest broad-spectrum audio-correctness net we can
  own. cseq-midi byte-encoding table tests (note on/off masking, synth
  programs) alongside.
- **3.4 Trigger runtime depth**: transport-level `maxRepeats` exhaustion (goes
  silent, no re-arm — currently unverifiable at transport level),
  follower-with-shaper, `CenterInRest` alignment.
- **3.5 Perf gates.** Nightly job running `scripts/bench.sh` + `pnpm bench`
  against a stored baseline JSON with a % regression threshold (report-only for
  two weeks, then alerting). The FE hot path (`buildAutomationTargetDefs`) and
  transport realize are the two guarded numbers.
- **3.6 macOS lane.** The product is a macOS Tauri app; all four workflows run
  ubuntu-only, so CoreMIDI/host-time code never executes in CI and the
  real-backend MIDI parity job silently self-skips when ALSA is absent. Add a
  `macos-latest` job: `cargo test -p cseq-midi -p cseq-transport` + the
  real-backend Playwright job (CoreMIDI virtual ports work on macOS runners).
  Make the MIDI-parity self-skip loud (report skipped-vs-ran in the job
  summary).

> **Phase 4 implementation notes (2026-07-07):**
> **4.1** Diff-coverage on new/changed lines is LIVE in both fast lanes,
> report-only: `cargo llvm-cov report --cobertura` + `diff-cover` in rust.yml,
> vitest cobertura + `diff-cover` in ui.yml (invocation validated locally —
> 91% diff coverage over the recent commits; the FE line baseline is now
> ~80%, vs the stale 16.3% May artifact). Flip `--fail-under` to enforce
> once soaked. **4.2** `componentCoverage.test.ts` closes the `.tsx`
> guardrail hole: every ≥400-line component needs a colocated test or an
> entry in the shrink-only 2026-07 debt register (seeded honestly with the
> 16 current violators, incl. the three shaper-state hooks the risk tool
> ranked #3/#8). Extraction of hook logic stays the working norm — not
> bulk-done here because the App.tsx carve-up is actively in flight
> upstream. **4.3** DEFERRED BY DESIGN: the plan's own criterion is two
> weeks of green post-repair; the suite has been green for ~a day. The flip
> checklist (branch-protection UI path + gh api command) is in TESTING.md;
> fuzz/chaos/soak/macOS stay non-required permanently. **4.4** TESTING.md
> layer table + CI section + coverage policy rewritten;
> INVARIANT_FUZZER_2026-07-01.md gained a dated update section (11
> properties, parallel axes, finding family, 4096-case sweep recorded
> green); FUZZING.md safety-net section rewritten (per-push compile gate +
> nightly lanes + notification); the stale 1-beat-neutral note corrected
> (4-beat since mid-2026). **4.5** Mutation pilot: `scripts/mutants.sh`
> (report-only, scoped to the rhythm overlay seam ~96 mutants +
> transport `layers.rs`; `MUTANTS_LIST=1` to enumerate) + a nightly
> `mutants` job in fuzz.yml with step-summary + artifact; first local run's
> missed-mutant list is the initial assertion-strength review queue.

### Phase 4 — Ratchet + guardrails (S–M, ongoing)

- **4.1 Land the deferred coverage ratchet** (TEST_COVERAGE_PLAN Phase 3.3,
  never enforced): refresh baselines, then diff-coverage on new/changed lines
  in both lanes.
- **4.2 Close the guardrail hole for `.tsx` logic.**
  `modelCoverage.test.ts` globs only top-level `./*.ts`, exempting the three
  shaper-state hooks (5.6k lines, zero tests, ranked #3/#8 by the risk tool).
  Extend the glob or add a size-based heuristic; start extracting pure logic
  from `useRhythmShaperState` / `useChannelShaperState` / `usePitchShaperState`
  under the existing extraction norm.
- **4.3 Promote E2E to blocking** once two weeks green post-repair (stable
  suite only; fuzz/chaos stay nightly).
- **4.4 Doc refresh:** FUZZING.md (CI reality, new targets), the invariant
  fuzzer doc (nine properties, beat_locks/shape_groups/S2), TESTING.md layer
  table, invariants.rs header. Record fresh deep-sweep results.
- **4.5 Mutation-testing pilot** (`cargo-mutants` on cseq-rhythm overlay seam +
  cseq-transport queue modules, nightly, report-only) to measure assertion
  strength — line coverage is currently the only quality signal and it is
  known-weak (16.3% FE baseline was dominated by intentionally-untested
  App.tsx).

---

## 5 · Sequencing

```
Phase 0 (CI reconnect, ~1 day)
   ├─► Phase 1 (repair fuzz + E2E)  ──► Phase 2 (new-feature coverage)
   │        1.4 contract test guards restructures from here on
   └─► Phase 3.5/3.6 (perf + macOS lanes — independent, can start anytime)
Phase 3.1–3.4 after Phase 2.1 (matrix extensions inform seam tests)
Phase 4 rides on everything and never "finishes"
```

## 6 · Honest edges

- The "E2E red-on-arrival" claim is verified statically (deleted testids,
  zero e2e-file changes in `780cc6f`), not by executing the suite — Phase 1.3's
  first step is running it to get the true failure list.
- Rhythm **passage import** has no FE test that we could locate; the
  parse/apply logic may live in App.tsx or engine-side. Resolve the locus
  before assuming coverage.
- `maxRepeats` transport-level exhaustion is "couldn't find", not
  confirmed-absent — the semantics may be fully owned by cseq-trigger's
  compiler tests.
- The uncommitted working-tree changes (shape-group chance/trigger work) were
  verified green both dirty (invariants) and at `HEAD` (full workspace, clean
  worktree).
