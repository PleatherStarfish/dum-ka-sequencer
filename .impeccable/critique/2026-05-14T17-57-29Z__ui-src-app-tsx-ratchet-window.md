---
target: the ratchet window
total_score: 23
p0_count: 0
p1_count: 3
timestamp: 2026-05-14T17-57-29Z
slug: ui-src-app-tsx-ratchet-window
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Many meters exist, but the combined final ratchet probability path is not obvious. |
| 2 | Match System / Real World | 3 | Domain language is mostly right, but phrase automation is still framed as position modifiers. |
| 3 | User Control and Freedom | 2 | Lots of controls, few local resets or safe exits by module. |
| 4 | Consistency and Standards | 2 | Component shapes and color usage drift from Dusk Console rules. |
| 5 | Error Prevention | 3 | Values are constrained and disabled states exist. |
| 6 | Recognition Rather Than Recall | 2 | The user must remember how chance, phrase, duration, speed, rhythm, and velocity combine. |
| 7 | Flexibility and Efficiency | 3 | Slider plus numeric input pattern is efficient for experts. |
| 8 | Aesthetic and Minimalist Design | 1 | Too many similarly weighted modules compete at once. |
| 9 | Error Recovery | 2 | Error cases are mostly prevented, but misconfiguration recovery is weak. |
| 10 | Help and Documentation | 1 | Very little contextual explanation at the moments users need it. |
| **Total** | | **23/40** | **Acceptable, but the ratchet window needs structural redesign before it feels trustworthy.** |

## Anti-Patterns Verdict

This does not read as generic AI interface work. It avoids glass, decorative gradients, hero metrics, and marketing layout moves. The failure mode is more specific: an advanced instrument panel grew sideways until every subsystem became equally loud.

Deterministic scan: `npx impeccable detect --json ui/src/App.tsx` returned `[]`. No detector findings.

Visual overlay was not run because browser overlay tooling is not available in this session. A local Chrome screenshot was captured, but the browser-mode app showed Tauri invoke errors and did not reliably expose the expanded ratchet tab, so the critique is grounded primarily in source and CSS.

## Overall Impression

The ratchet window has the right ingredients for a serious instrument: chance, rate, time curve, internal rhythm, velocity, bounds, phrase automation, and duration modifiers. The problem is that the current composition does not tell the user which decision matters first or how the modifiers stack into the final musical result.

## What's Working

- The window uses real musical controls rather than decorative charts. Meters and plots correspond to editable ratchet behavior.
- Slider plus precision-input pairing is good for Caesura's expert audience.
- The implementation already has strong constraint behavior: min/max, disabled fields, and clamped values reduce outright invalid input.

## Priority Issues

### [P1] No Ratchet Command Hierarchy

The top grid shows several high-complexity modules at once, then the lower console adds bounds, velocity, position, and duration systems. Everything feels like a peer.

Why it matters: users cannot build a mental model of "base chance -> speed -> internal rhythm -> modifiers -> final playback." They must inspect the entire surface to understand one change.

Fix: restructure around one visible signal path. Keep Fire Chance, Speed, and Internal Rhythm as primary. Move Velocity, Bounds, Phrase Automation, and Duration Gates into collapsible advanced bands with live summaries.

Suggested command: `impeccable shape the ratchet window`

### [P1] Phrase Automation Is Split Across Two Mental Models

The section is titled "Position Probability Modifiers", but the active switch says "Phrase curve" and the controls mix start/mid/end chance and speed with separate structural modifiers.

Why it matters: this obscures the feature the user explicitly asked for. Phrase automation should feel like a musical phrase-level curve, not a math appendix.

Fix: rename the whole section to "Phrase Automation". Render chance and speed as two aligned phrase lanes over start/mid/end. Put accent/section/cycle modifiers below as optional position gates that visibly modify the phrase curve.

Suggested command: `impeccable craft phrase automation in the ratchet window`

### [P1] Internal Rhythm Does Not Show The Actual Rhythm Inside The Ratchet

The Internal Rhythm panel shows min/max hits and a list of Markov chain state counts. It does not preview the selected or eligible rhythm patterns, exact tiling, ties, or speed applicability.

Why it matters: artists need to see whether the ratchet is straight, grouped, tied, sparse, or syncopated before they trust playback.

Fix: replace "states" rows with tiny rhythm glyph previews, eligibility badges by ratchet speed, and a clear "tiles exactly" indicator. Show skipped chains as unavailable, not as missing data.

Suggested command: `impeccable craft internal ratchet rhythm preview`

### [P2] Visual System Drift In The Ratchet Surface

The ratchet window still uses many hard-coded charcoal/cyan/amber values, 6-7px panel radii, and uppercase tracking. The new `DESIGN.md` says Dusk Console, 4px panels, 3px controls, amber as ratchet role color, and zero tracking.

Why it matters: the ratchet surface feels adjacent to Caesura rather than fully native to it.

Fix: token-consolidate this section: `--surface-*`, `--line`, `--accent`, `--radius`, `--radius-control`, zero tracking, and fewer nested card-like panels.

Suggested command: `impeccable polish the ratchet window`

### [P2] Velocity Range Is Too Verbose For A Submodule

Velocity Range includes reference select, status block, rail, legend, readout, note, and three sliders. It uses more explanatory apparatus than the primary chance/rate behavior.

Why it matters: it steals attention from the core ratchet decision and makes the lower console feel heavier than the primary controls.

Fix: make Velocity Range a compact rail with three direct handles and inline values. Collapse the explanatory "Stacking" note into a tooltip or summary line.

Suggested command: `impeccable distill the ratchet velocity panel`

## Persona Red Flags

**Alex, Power User:** Alex can edit quickly once they know the panel, but must scan too many modules to find the relevant lever. The lack of module-level reset/preset controls makes experimentation expensive.

**Riley, Stress Tester:** Riley sees constrained inputs, which is good, but cannot verify the final combined outcome of phrase, duration, span, and base probability before playback.

**Project Persona, Experimental Rhythm Performer:** This user needs to hear and see cause-effect. The current panel exposes the ingredients but does not preview the actual internal ratchet rhythm or final probability curve clearly enough.

## Minor Observations

- The responsive CSS collapses columns, but the content remains long and serial rather than more focused.
- "Refractory amount" is precise but colder than the surrounding musical language.
- The time curve editor is the best module visually; it has a real instrument affordance and should set the standard for phrase automation.

## Questions To Consider

- What if the ratchet window had one master "final probability trace" visible at all times?
- What if phrase automation were drawn as music first and exposed as six sliders second?
- Does velocity deserve equal visual weight with chance, speed, and rhythm?
