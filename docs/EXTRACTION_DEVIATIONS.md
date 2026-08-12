# Extraction Deviations

This ledger records places where the source at `be8b1b8` contradicted the extraction plan. The implementation follows the source while preserving the plan's intent.

## D-001 — P0 tracked-junk count

Plan §8 says the cleanup contains four tracked junk files. The source commit actually tracks five: two `_tmp_19_*` files, two `ui/vitest.config.ts.timestamp-*.mjs` files, and `test-results/.last-run.json`. All five were removed in the P0 cleanup. Because the imported `.gitignore` already ignored `_tmp_*`, the two empty files had to be force-added to the source snapshot commit before the cleanup so tag `source-be8b1b8` remained tree-faithful.

## D-002 — P0 gate ordering dependency

The gate table does not state that UI-GATE must precede RUST-GATE on a fresh archive. In source, `tauri::generate_context!()` fails during Clippy when configured `frontendDist` (`ui/dist`) does not exist. P0 therefore ran UI-GATE to produce `ui/dist`, then restarted the exact RUST-GATE from its first command. The initial precondition failure is not an inherited product red.

## D-003 — P1 identity assertion locations

Plan §8 says to fix title/port assertions in e2e and `e2eHarnessContract`, but the source contract test contained no identity assertions, and the virtual port literals live in `src-tauri/src/main.rs` plus `e2e_harness.rs`, not `cseq-midi`. P1 added an explicit identity-contract block that reads the Tauri config, browser HTML, React masthead, production Rust entry point, and e2e harness source. The launch smoke now asserts the browser title and masthead directly.

## D-004 — P3/P4 preview adapter boundary

Plan §6.2 lists `useRhythmShaperState`, `ratchetDisplay`, `ratchetRanges`,
`rhythmShaperModel`, and the drift/morph request conversion for deletion in P3,
while §8 also requires the unchanged engine to remain green until the P4
generator-seam swap. In the source, those non-rendered TypeScript modules build
the exact `rhythm_preview`/`rhythm_set_playback` payload and coherent timeline
model consumed by the old Rust engine. Deleting them in P3 would remove the
only kept-app path to a valid preview and would make the phase red by design.
They are therefore the bounded `stripped-pending-P4` compatibility allowlist:
no editor renders them, and they must be deleted in P4 immediately after the
new generator preview/playback seam is live. The legacy Randomize settings
normalizer is separately retained only until the sanctioned P7 schema reset.

## D-005 — P4 weighted-to-fixed compatibility projection

Plan §8 requires deterministic fixed section subdivision/grouping in P4, but
the fixed-value score schema is not introduced until the P7 schema reset. The
source therefore supplies only weighted choice arrays during P4. The bounded
compatibility rule selects the largest positive weight, preserving authored
order for ties; every authored boundary fires, while boundary probability,
section-count weights, section automation, speed choices, and single-parameter
modulation are ignored. P7 replaces this projection with native fixed fields.

## D-006 — P4 model trim staged around the fixed-section schema

Plan §6 removes the weighted section DTOs in the P4 `cseq-model` trim, while
§8 keeps the source DTO byte-compatible during P4 and introduces native fixed
section fields only at the P7 schema reset. The source has no independent
fixed subdivision/grouping carrier, so deleting the weighted structs in P4
would delete authored section values. P4 therefore removes model variants
whose consumers are already gone (`ValueSpec` stochastic arms, Euclidean and
SetPitch transforms/nodes, Drift/Morph seed modes) but retains the section
compatibility structs until P7. Legacy rhythm/speed/Jathi-Bhedam structs remain
only until the immediately following P4 rhythm-crate and command sweeps, where
their last consumers are removed.

## D-007 — P4 rhythm inventory size and compatibility boundary

Plan §6 inventories `cseq-rhythm` at roughly 9.6k lines, but the source file at
`be8b1b8` is 17,583 lines and contains additional late-added articulation,
generator-output, and playback compatibility DTOs. The P4 carve therefore
retains the generator and channel-hocket implementations plus the minimal
resolved span/cell and articulation-output structures still consumed by the
generator seam. The extra legacy realizers and authoring systems are removed;
remaining compatibility names are internal data carriers, not reachable
features, and are included in the following P4 symbol/command sweep.

## D-008 — P4 command DTO and transport-fixture fan-out

The source contains command DTO adapters, generated-fixture assertions, and
frontend transport-layer registries for the retired playback systems beyond
the command-handler line ranges listed in the plan. Removing the eight command
handlers alone leaves those consumers type-correct but exposes deleted
transport snapshot fields to the UI. P4 therefore prunes the associated Rust
DTO adapters, bridge types, generated fixture cases, timeline-layer registries,
mock aliases, and parity assertions in the same command/symbol sweep. No kept
generator or channel-hocket command is removed.

## D-009 — P4 fuzz target count

Plan §8 describes a nine-to-four fuzz-target reduction, but the source manifest
at `be8b1b8` declares eight targets. P4 keeps the four named targets exactly and
retires the other four, including their dedicated corpora.

## D-010 — P5 sample-score fixture regeneration

Plan §8's FIXTURES shorthand regenerates only the Rust-to-TypeScript DTO
fixtures, but P5 also changes the checked-in `examples/scores` forms. The
source's `cseq-model` fixture test identifies a separate ignored generator,
`cargo test -p cseq-model --test gen_scores -- --ignored`, so P5 ran it in the
same sanctioned fixture window. Its nondeterministic `HashMap` serialization
reordered five semantically unchanged scores; those order-only changes were
discarded, leaving only the intended deterministic `switch_cycle_demo` change
in the atomic `regen:` commit.

## D-011 — P7 initial-section persistence fields

Plan §7 specifies fixed `subdivision`/`grouping` fields for later section
boundaries but omits the retained initial section's matching controls. The P5
UI still authors an independent initial subdivision and grouping, so following
the literal sketch would silently reset kept state on every save/load. Patch v1
therefore adds `sequencer.initialSubdivision` and
`sequencer.initialGrouping`; all later boundaries use the exact planned fixed
shape. The save/load normalizer and idempotence test cover both initial fields.

## D-012 — P7 fixed-order DTO regeneration prerequisite

The plan's FIXTURES order starts with the Rust generator, but the source Rust
test only validates the TypeScript-owned `patch_document.json`; it does not
regenerate it. After the P7 app/schema reset, that first command therefore
rejects the old `CarnaticSeq`/v8 header before the TypeScript generator can run.
P7 seeded only those two new envelope values, restarted FIXTURES from the first
command, and then let the prescribed TypeScript update rewrite the full v1
shape. All generated fixture changes remain in one atomic `regen:` commit.

## D-013 — P8 import failure preceded the planned fingerprint guard

Plan §8 identifies the import regression's likely root as the authored-patch
fingerprint guard. The required status-first regression test showed that the
source handler never reaches that guard on a fresh launch: the rendered
single-track editor is backed by flat state while `parallelProjectRef.current`
remains `null`, so the silent destination-project return wins first. P8 follows
the code-first rule by deriving that missing destination through the same
`capturePatchDocumentState()`/`withProjectState()` projection used by patch
builds. The planned fingerprint symmetry fix remains necessary and is applied
to the import and sibling track-structure snapshot guards.

## D-014 — P8 cannot empty unrelated inherited failures within sanctioned scope

Plan §8 requires P8 to empty the baseline expected-fail list, but P8 sanctions
only the track-import behavior fix. After the mock and real import regressions
turned green, the exact full mock gate retained two P0 failures: global/custom
BPM transport routing and the stale-preview test setup. Both are independently
seeded upstream shortcomings (findings 18 and 20), not consequences of the
import change. Fixing or weakening either would add a seventh behavior change
or an unsanctioned test rewrite. They remain ledgered rather than being hidden,
P8 is not tagged, and P9 has not started.

## D-015 — Amended P8 scope supersedes the D-014 blocker

After adversarial review, Daniel explicitly sanctioned findings 18 and 20 as
behavior changes seven and eight. Finding 18 is resolved by keeping a
multi-track document on the parallel reference clock when mute/solo leaves one
custom-tempo track audible; that track's BPM stays local to its parallel
request. Finding 20 proved to be a test-setup race rather than a product bug:
the strengthened test now polls until the held preview request is pending, then
retains every stale-row assertion. D-014 remains as the historical reason P8
was initially left untagged; this amendment permits its closure.

## D-016 — Review-mandated P8 DTO fixture regeneration

The original phase table sanctions fixture regeneration in P4/P5/P7, but the
P8 adversarial review found that v1 still serialized twelve Drift/Morph vestige
fields and could bypass its hidden `toJSON` projection. The review amendment
explicitly requires those fields removed and the invoke boundary made
fail-closed, so the TypeScript-owned patch fixture necessarily changed before
P9. The update is isolated in the atomic `regen:` commit `075fd61`; it removes
the vestiges only. An immediate update rerun and verify rerun were no-ops, so
P9 can still perform its required no-op determinism proof.

## D-017 — P9 closed generator callers the phase table placed in P4

Plan §4/§8 describes the generator seam as complete in P4 and structurally
identical between stopped preview and playback. The final audit found that both
generic callers still supplied no-op density automation, preview cache identity
omitted enabled/runtime-track state, and Track Flow reused its composite
seed-path id as `GeneratorCycleContext.track_id`. P9 completed the already
sanctioned generator-seam change: both callers sample at cycle start, preview
and running runtime identities stay aligned, Track Flow separates replay and
authored identities, and the mock uses the Rust 64-bit seed vectors. No DTO or
golden shape changed; fixture and ledger regeneration remained no-ops.

## D-018 — Hosted CI cannot run without a target remote

Plan P9 ends with all four GitHub Actions workflows green, but this extracted
repository has no Git remote or GitHub repository to dispatch against. The four
workflows were pruned and syntax-checked, their clean-checkout frontend build
prerequisites were restored, and their available local equivalents were run.
No hosted-workflow result is claimed; this environmental limitation is carried
into the acceptance record for the first publisher to close.

## D-019 — The retained fuzz corpus violated its own builder precondition

P9's pruned fuzz workflow must smoke all four retained targets, but the source's
committed `parallel_transport_queue/seed-0` panicked in `custom_subdivision`
before transport was exercised (upstream finding 27). The P9 CI port therefore
keeps equal-parts builder inputs valid and centralizes the manifest/script
target inventory. This changes only test-input construction, not product
behavior; all four retained targets then completed an actual bounded smoke.

## D-020 — The historical real-backend red was a stale test capture

`BASELINE.md` originally said the P0 gati-7 real-backend failure was closed
before P8, but the full P9 real gate reproduced it. The authored edit already
drove the real preview and timeline to subdivision 7; only the assertion still
read the startup `score_create_subdivision_switch` request. P9 now checks the
current `score_preview_subdivision_switch` request, its matching layout cycle,
and the exact fixed weight list. This strengthens test evidence without a ninth
product behavior change.
