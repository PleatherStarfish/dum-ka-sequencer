# Sections and Subdivisions logic

This is the current authoring contract for
`SectionBoundariesPanel`, `BoundaryDetailDialog`, and the deterministic Rust
section resolver.

## Structure

- A cycle contains `cycleBeats` integer beats.
- The first section always starts at beat 1.
- An authored boundary after beat `K` starts a section at beat `K + 1`.
- Valid boundary positions are `1..cycleBeats - 1`.
- At most one boundary may occupy a position.
- Boundaries are canonicalized in ascending beat order.
- Every authored boundary is active. There is no boundary probability or
  weighted section-count cap in Dum-Ka.

Structural edits are disabled from the beginning of a Play/Stop transition
until transport reports a stable stopped state.

## Fixed Subdivision

Each section owns one integer Subdivision in `1..64`. It is the number of steps
inside **each beat**, not inside the whole section. A four-beat section at
Subdivision 7 therefore contains 28 steps.

The inherited DTO represents a subdivision as a weighted list. Dum-Ka's
compatibility projection is deliberately deterministic:

- authoring emits exactly `[{ subdivision, weight: 1 }]`;
- loading selects the largest positive valid weight;
- authored order breaks equal-weight ties;
- if no valid positive row exists, the fallback is 4;
- the selected value is clamped to `1..64`.

Do not add a second UI row or interpret the compatibility array as current
probability behavior.

## Optional Grouping

Grouping is an optional accent cycle selected from `3, 4, 5, 6, 7, 9, 11`.
It is available only when it tiles the section's resolved step count. A value
that merely duplicates the active timing grid is omitted as non-trivial
grouping.

The inherited DTO likewise uses a weighted list. Current authoring emits either
an empty list (`None`) or one `{ jathi, weight: 1 }` row. Loading uses the
largest valid positive row with authored-order tie breaking.

## Identity and movement

Boundary IDs are stable project identity. Moving a boundary changes
`afterBeat`, not its ID. Adding chooses the first unoccupied position; deleting
removes only the selected boundary. Changing cycle length must normalize or
remove positions no longer inside `1..cycleBeats - 1`.

The active detail dialog is keyed by boundary position for UI selection but
must update the stable-ID row in project state.

## Preview and playback

Both preview and score creation receive the same normalized boundary rows.
The Rust transform emits Section, Subdivision-beat, and optional Grouping pulse
spans. Those spans feed the same generator resolver used by transport.

The timeline may retain inherited internal fields such as `gati`, `jathi`,
`changeProbability`, or `weights`; these are compatibility names, not a license
to reintroduce stochastic section resolution.

## Regression coverage

- `ui/src/sectionsSubdivisionsLogic.test.ts`
- `ui/src/boundaryPlanning.test.ts`
- `ui/src/components/FixedSectionControls.test.tsx`
- `ui/src/components/BoundaryAfterBeatSelect.test.tsx`
- `ui/src/components/SectionBoundariesPanel.behavior.test.tsx`
- `ui/tests/e2e/boundary-authoring.spec.ts`
- deterministic section tests in `cseq-transforms` and `cseq-transport`
