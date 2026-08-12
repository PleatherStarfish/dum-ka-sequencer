# Back On Track Summary

This file is a short recovery/status note. The fuller user manual is
[README.md](README.md), and the canonical project docs start at
[docs/README.md](docs/README.md).

## Current Working Instrument

The project is now a useful single-channel Carnatic-inspired probabilistic MIDI
sequencer:

- A cycle contains beats.
- Beats are subdivided into matras according to resolved gati.
- Possible section boundaries happen after beats.
- Boundaries roll probabilistically, greedily left to right, with an optional
  weighted max-section cap.
- Each resolved section chooses a gati, and that gati subdivides every beat in
  the section.
- Each section may choose a jathi accent pulse when that jathi tiles the section
  matras and is not a trivial duplicate of gati beat starts.
- Seed modes let users lock, vary, or reuse stochastic realizations.
- Velocity accents shape beat starts, section starts, and jathi starts.
- The Rhythm Shaper can add Markov rhythm grouping, arbitrary virtual
  subdivision, and ratchet playback.
- Timeline preview and MIDI playback are generated from the same request data.
- Patches can save and recall the complete working surface.

## Critical Semantic Correction

Gati is subdivision of each beat into matras. Gati is not subdivision of the
whole section.

If a section spans beats 3-6 and resolves to gati 7, then beats 3, 4, 5, and 6
each have 7 matras.

## Current Cut Line

The current cut line is still a reliable, understandable, single-channel
instrument. New work should be judged by whether it improves:

- Musical correctness.
- Preview/playback trust.
- UI navigability.
- Stochastic reproducibility.
- The ability to produce usable rhythmic material quickly.

## What Changed Since The Original Recovery Sprint

Several items once listed as future work now exist:

- Jathi accent choices and jathi pulse lanes.
- Markov rhythm grouping inside active accent spans.
- Matrix extrapolation and free-passage import.
- Arbitrary virtual subdivision of accent spans.
- Ratchet playback with probability modifiers, BPM-aware speed controls,
  timing contours, humanize, cooldown, and velocity behavior.
- Patch save/recall.
- MIDI dispatch and ratchet event visibility.

## Still Worth Protecting

- Keep the build green.
- Keep preview and MIDI aligned.
- Keep section boundaries explicitly after beats.
- Keep gati per beat.
- Keep rhythm and ratchet inside active protected accent spans.
- Keep seed behavior deterministic under locked seeds.
- Keep docs current when semantics move.
