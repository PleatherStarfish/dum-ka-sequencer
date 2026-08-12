# Design Decisions

This file records decisions that should not be accidentally reversed.

## Rust Plus Tauri Plus React

Decision:

Use Rust for model/transforms/rhythm/realization/transport/MIDI, Tauri for the
macOS app shell, and React/TypeScript for UI.

Why:

- Rust gives strong data modeling and predictable scheduler behavior.
- Tauri gives a smaller native desktop shell than Electron.
- React is effective for a custom timeline and dense control UI.
- The app is not doing audio DSP, but timing, MIDI correctness, and
  deterministic stochasticity still matter.

Tradeoff:

- There is a Rust/TypeScript bridge to maintain.
- DTO drift is a real risk.

Mitigation:

- Keep `ui/src/bridge.ts` as the only direct Tauri API import in the UI.
- Keep Rust DTOs explicit in `src-tauri/src/main.rs`.
- Update docs when bridge types change.

## Rhythm Tree Instead Of Flat Steps

Decision:

Represent rhythm as trees, spans, and transforms rather than as a flat step
array.

Why:

- Carnatic structures need nested spans.
- Gati, jathi, ties, accents, re-subdivision, and ratchet boundaries are easier
  to reason about as span transformations.
- Accent spans need to become first-class compositional objects.

Tradeoff:

- UI and preview must project structured data into timeline views.
- Debugging can be less obvious than a flat grid.

Mitigation:

- Keep preview DTOs simple and explicit.
- Add tests at transform, rhythm, and transport layers.
- Use timeline layers to show the resolved structure rather than hiding it.

## Separate Duration And Accent Trees

Decision:

Keep duration tree and accent tree separate in the model, with duration nodes
holding optional accent references.

Why:

- Duration and accent can vary independently.
- Future jathi and accent-tree operations should not require rewriting the
  duration tree.
- This matches the deeper research direction behind the project.

Current state:

- The model supports separate trees.
- The current UI mostly uses velocity accent ranges and resolved pulse spans.
- A full accent-tree editor remains future work.

## Gati Per Beat

Decision:

Gati is always the subdivision count of a beat.

Why:

- This is the musically correct meaning for the app.
- It keeps gati distinct from arbitrary section subdivision or tuplets.

Implication:

If a section has gati 7 and spans four beats, the generated matra grid has 28
matras total: 7 per beat.

## Sections Are Not Inferred From Gati Changes

Decision:

A fired boundary creates a new section even if it chooses the same gati as the
previous section.

Why:

- Section starts can receive extra accent.
- Future transforms may target section starts.
- Jathi choices and labels may change independently of gati.

Mitigation:

- Backend preview includes `sectionStart` and `sectionIndex`.
- UI grouping uses explicit section metadata rather than gati comparison alone.

## Preview Returns Beats, UI Groups Sections

Decision:

The preview API returns resolved beats, not resolved sections.

Why:

- Gati is per beat.
- Section starts can happen without gati changes.
- The UI needs explicit beat-level accent velocity.

Tradeoff:

- The frontend performs section grouping for display.

Mitigation:

- Keep `groupResolvedSections` small and tied to backend `sectionStart` data.

## Protected Spans Drive Rhythm And Ratchet

Decision:

Markov rhythm and ratchet consume resolved protected pulse spans from the same
effective tree as the timeline preview.

Why:

- Rhythm grouping must not cross jathi or gati accent boundaries.
- Ratchet must not smear across active accent spans.
- Timeline/audio alignment depends on all layers using the same resolved spans.

Implication:

- In a section with jathi, rhythm and ratchet operate inside jathi pulse spans.
- In a section without jathi, they operate inside gati beat spans.
- Inactive gati beat starts do not split jathi rhythm spans.

## Markov Matrices Are Per Span Length

Decision:

Each protected span length has an independent Markov chain.

Why:

- A 3-matra span and an 11-matra span have different pattern spaces.
- Large span lengths need selected state subsets rather than full matrices.

Mitigation:

- Matrix copy/extrapolation and learn-from-passage help generate starting
  points without making matrices secretly linked.

## Matrix Generation Is Materialized

Decision:

Copy, extrapolate, and learn-from-passage operations write ordinary editable
matrix state.

Why:

- Users should be able to inspect and tweak generated matrices.
- Hidden dependencies between span lengths would make behavior harder to reason
  about.

Tradeoff:

- Regenerating a matrix is an explicit action, not a live relationship.

## Ratchet Is Playback-Only

Decision:

Ratchet rewrites queued audible note groups during playback rather than
changing the underlying duration tree or Markov rhythm result.

Why:

- Ratchet is a performance articulation layer.
- Timeline and rhythm semantics remain stable.
- Ratchet can be shown as fired playback metadata rather than as authored
  structure.

Mitigation:

- Transport snapshots include ratchet events for timeline visibility.
- Ratchet tests live in transport because the scheduler owns the rewrite.

## Playback Rewrites Are Cycle-Local

Decision:

The scheduler may realize future cycles ahead of playback, but ratchet, static
MIDI channel routing, and channel hocket run only on the cycle currently being
finalized. Finalized events are then appended to the scheduler queue.

Why:

- Timeline playback metadata must describe the same MIDI bytes that will later
  be dispatched.
- Rewriting the whole scheduler queue can mutate older future events after their
  timeline metadata has already been published.
- The scheduler queue is easier to reason about when it only holds finalized
  events waiting for their due tick.

Mitigation:

- Keep playback rewrite tests in `crates/cseq-transport/src/lib.rs`.
- Read
  [TIMELINE_AUDIO_PARITY_POSTMORTEM.md](TIMELINE_AUDIO_PARITY_POSTMORTEM.md)
  before changing queue ownership or timeline playback metadata.

## Timeline Edits Auto-Apply

Decision:

Timeline edits auto-apply to the transport after a short debounce.

Why:

- The user saw a bug where preview and audio diverged.
- In an instrument-like UI, the visible timeline should be the playing score.

Tradeoff:

- Editing can cause immediate playback changes.

Mitigation:

- Auto-apply every valid score request and surface errors inline.
- Clear queued future events on score/rhythm changes.

## Scheduler Clears Queue On Score Change

Decision:

When a score or rhythm playback config changes during playback, the scheduler
clears queued future events, sends all-notes-off, and re-realizes from the
current playback position.

Why:

- Prevents old gati/rhythm/ratchet events from continuing after visible edits.

Limitation:

- MIDI already sent to the destination cannot be recalled.

Mitigation:

- Realize future cycles ahead of time, but dispatch only due events while MIDI
  output is immediate.
- Consider timestamped CoreMIDI sends later.

## Serde Defaults For Additive Fields

Decision:

Some new model fields use `#[serde(default)]`.

Why:

- Existing example score JSON and old saved data should continue to load when
  fields are additive and have safe defaults.

Tradeoff:

- Defaults can hide migration needs if overused.

Mitigation:

- Use real schema migrations when behavior cannot safely default.
- Keep persistence tests current.
