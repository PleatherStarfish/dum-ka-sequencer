# Design: UI Crash Resilience (error boundaries + recovery)

Status: Phase 1 landed 2026-07-01; Phases 2-3 proposed
Owner docs: [UI_AND_INTERACTION.md](../UI_AND_INTERACTION.md), [KNOWN_RISKS.md](../KNOWN_RISKS.md)

## Problem

Until 2026-07-01 there was **no error boundary anywhere in `ui/src`**: any
render/lifecycle exception in any component unmounted the entire React tree —
a blank window mid-performance, with playback state stranded in the backend.
The pitch-import RangeError (fixed the same day) was a live example of a
reachable render crash; the class of risk remains for future code.

## Phase 1 — root boundary (LANDED)

`ui/src/ErrorBoundary.tsx` (+ `ErrorBoundary.test.tsx`) wraps `<App/>` in
`ui/src/main.tsx`. Inline-styled on purpose: the fallback must render even
when the stylesheet/theme is implicated. Shows the error message, promises the
patch on disk is untouched, offers Reload.

## Phase 2 — panel isolation (proposed)

A root fallback still throws away the whole session view for a crash in one
panel. Wrap the major panel islands so a crash degrades to one dead card:

- Candidates (each already a self-contained component with its own props
  seam): `TimelinePanel`, `RhythmShaperPanel`, `PitchShaperPanel`,
  `ChannelShaperPanel`, `SectionBoundariesPanel`, `RandomizePanel`,
  `ScoreSetupPanel`, and every modal body under `ModalFrame`.
- Add a `PanelErrorBoundary` variant: compact fallback (panel title + "this
  panel crashed" + Retry button that remounts by bumping a `key`), styled with
  the normal design language (safe here — the rest of the app is alive).
- Modals: `ModalFrame` should catch, show the fallback inside the dialog, and
  keep Close working (a crashed modal must never trap focus).
- Playback continues: panel crashes must not touch transport state — they
  already don't (backend owns playback), but add an e2e assertion: force a
  panel crash (test-only throw prop) mid-playback, assert MIDI events continue.

## Phase 3 — diagnostics (proposed)

- `componentDidCatch` currently logs to console. Route it through the existing
  telemetry gating (`ui/src/telemetryGating.ts`) to append into the session
  debug log the MidiDebugPanel already surfaces, so a user report can include
  the component stack.
- Include the app/patch schema version and active panel in the logged record.

## Non-goals

- No state-restoring resurrection of a crashed panel beyond remount-by-key —
  panel state lives in App-level hooks and survives the child remount already.
- No global "auto-reload on crash": losing user intent silently is worse than
  a visible fallback.
