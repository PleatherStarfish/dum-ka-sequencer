# Known risks and bug classes

Keep these risks documented even after a regression test exists; they explain
why apparently redundant guards are load-bearing.

## Preview/MIDI drift

Risk: the timeline shows a different generated cycle than the scheduler plays.

Guardrails:

- preview and transport both call `resolve_generator_cycle`;
- request data includes the same sections, generator config, seed/cycle, and
  automation inputs;
- playing lanes select scheduler-recorded snapshots;
- pending or stale preview work retains the last truthful rows;
- late responses are rejected by authored generation/request key;
- real-backend parity tests cover locked-seed replay and preview/MIDI agreement.

Read [TIMELINE_AUDIO_PARITY_POSTMORTEM.md](TIMELINE_AUDIO_PARITY_POSTMORTEM.md)
before changing timeline source selection or queue ownership.

## Future-cycle rewrite

Risk: ahead-of-time realization mutates a cycle whose MIDI and displayed
metadata were already finalized.

Guardrails:

- generate and route one temporary cycle;
- record that cycle's generator/channel metadata;
- append only after cycle-local finalization;
- run parallel Channel Logic once on the merged window;
- preserve tests proving later realization cannot change older queued events.

## Note-on/note-off imbalance

Risk: overlap suppression or same-pitch overlap drops the wrong note-off and
leaves a stuck note.

Guardrails include paired group suppression, premature same-pitch note-off
deferral, scheduler residue sweeps, MIDI panic, and invariant/fuzz note-balance
checks. Do not “fix” duplicates by independently filtering note-offs.

## Async authored-state races

Risk: save/import/new/copy or preview begins for state A, awaits a score/dialog,
then applies after the user authored state B.

Guardrails:

- flush focused drafts first;
- capture authoring generation and current fingerprint before async build;
- capture project revision for structural actions;
- compare the built document to the captured fingerprint, not a new post-await
  snapshot;
- latest-wins queues prevent old status from overwriting a newer action;
- tests mutate authored state during the await and must fail if the guard is
  reverted.

## Structural edits during transition

Risk: the UI sees an old stopped snapshot while Play is starting (or old
playing state while Stop is pending) and changes track/section topology.

Structural controls use the explicit transition generation/kind plus snapshot
state. A command's success is not enough until the scheduler acknowledges the
corresponding state.

## Persistence projection bypass

Risk: an in-memory object is spread/copied and loses a convenience `toJSON`, so
removed fields reach disk.

Guardrails:

- explicit TypeScript v1 projection;
- spread-copy serialization tests;
- strict Rust patch/track validation that rejects removed-feature keys;
- schema/version/app/kind checks at the invoke boundary;
- resilience/idempotence corpus;
- mock and real save/reload/import tests.

Unknown generator variants disable Example and warn. Never silently map an
unknown kind to enabled known behavior.

## Generator nondeterminism

Risk: RNG draw order, iteration order, floats, or hidden global state makes
preview/replay vary.

Generators must be pure, use stable identity-derived streams and pinned salts,
and return exact tiled cells. Locked replay, different-seed, feature-off ledger,
and invariants/fuzz coverage protect this contract.

## Trigger graph/runtime drift

Risk: a follower sources another follower, refers to a removed track, launches
retroactively, or the UI guesses launched notes separately.

Normalize to one continuous source level, compile future windows purely, and
use the compiled launch list for both realization and display. Track deletion,
import, copy, and role changes must re-normalize source references.

## Track Flow identity confusion

A box has three identities: authored member for display, synthetic lane for
conflicts, and box+source identity for seed paths. Reusing one identifier for
all three causes collision, priority, or replay bugs.

## Channel assignment vs collision

Channel Shaper chooses the output channel within a track. Channel Logic applies
project/pair policy after tracks merge. Moving either stage, applying conflict
rules to pre-hocket channels, or re-deriving suppression in the UI breaks
audible/display parity.

## MIDI-less and hot-plug hosts

Real-backend tests skip MIDI-dependent assertions when `midiReady` is false.
The app must still boot with defaults when no destination exists. Hot-plug
reconciliation must not overwrite a newer user route choice; the virtual port
and panic path remain available independently.
