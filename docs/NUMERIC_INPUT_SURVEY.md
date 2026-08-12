# Numeric Input Survey & Hardening Contract

A study of every numeric-entry use case in Caesura, made before rebuilding
`NumericField` on React Aria (2026-06-12). Companion to
`EDITABLE_VALUE_INVENTORY.md` (what the values mean) — this documents how
they are *entered* and what the hardened contract guarantees.

## Call-site census (at study time)

136 `<NumericField>` sites; 0 raw `type="number"` inputs.

| Signal | Count | Meaning |
|---|---|---|
| string `onChange` API | 123 | re-parse `e.target.value` per keystroke |
| `onValueCommit` API | 13 | the target pattern (all in `JathiBhedamEditor`) |
| `\|\| <number>` fallback | 110 | NaN silently converted to a committed value |
| inline `clamp(...)` | 59 | clamping duplicated outside the field |
| `parseInt` / `parseFloat` | 89 / 30 | per-site string parsing |

Files: RhythmShaperPanel 33, SeedSetupDialog 18, TriggerInspector 14,
JathiBhedamEditor 13, PitchShaperPanel 13, App 10, WeightEditors 8, others ≤6.

## Use-case families

| Family | Examples | Range/step | Entry semantics required |
|---|---|---|---|
| A. Clamped integers | MIDI pitch/velocity 0–127, channels 1–16, beats/cycle 1–64, counts | step 1 | clamp at commit; typing `12` must not commit `1` |
| B. Weights | gati/jathi/Markov/section-count weights | min 0, usually no max | **0 is a meaningful value**, never an error fallback; callers declare `numericMode="weight"` explicitly |
| C. Percents | probabilities, chances 0–100 | step 1 or 0.5 | clamp at commit |
| D. Unit floats | blend/variance 0–1 | step 0.05 / 0.1 | step-derived display precision |
| E. Domain decimals | BPM 20–400 step 0.5; automation marker phase step 0.000001 | preserve full step precision; no digit grouping |
| F. Dynamic-step | ratchet cooldown, ornament duration, delay, automation value editor | step is a runtime expression keyed by a basis enum | step/min/max may change between renders without dropping a draft |
| G. Seeds | global/domain seeds | integer 0..Number.MAX_SAFE_INTEGER | exact display (no grouping/rounding) |
| H. Tempo field | App header | dual-mode: single-track follows transport unless editing; multi-track commits to global reference | the one manual-rework case: replaces `tempoInput` string state + `tempoEditingRef`/`tempoInputFollowsTransportRef` + `key=` remount hack |

## The hardened contract (`NumericField`)

Internals: React Aria (`useNumberFieldState` + `useNumberField`,
`@react-aria/*` + `@react-stately/*`) for parsing, formatting, clamping,
stepping, and aria wiring — wrapped to preserve Caesura's proven semantics:

- **Number-only API.** `onValueCommit(value: number)`. The string `onChange`
  and `NumericFieldChangeEvent` are deleted; the compiler enumerates every
  call site.
- **Draft while editing.** Keystrokes never commit. Partial drafts
  (`""`, `-`, `.`, `1.`) are legal mid-edit.
- **Commit on blur / Enter** (Enter also blurs). Commit = parse → clamp to
  min/max → quantize to step (when given) → format → emit *only if changed*.
- **Empty/invalid never emits.** Reverts to the last committed text. NaN can
  not reach a call site; `|| 0` has nothing left to catch.
- **Escape reverts** to last committed and blurs.
- **Arrows step** ±step (Shift ×10, Alt ×0.1), steppers likewise,
  disabled at bounds; clamped.
- **External updates follow** while not editing (controlled value), so
  transport-driven values (tempo) display live without dual state.
- **Locale-stable formatting**: `en-US`, `useGrouping: false`, fraction
  digits derived from step. Patches, e2e selectors, and DTO fixtures see
  identical text before/after.
- **DOM/a11y parity**: `role="spinbutton"`, `aria-valuemin/max/now`,
  `data-numeric-mode`, the existing class names and chip sizes — CSS and
  Playwright selectors unchanged.
- **Round-trip ownership**: the `value` prop must represent the same semantic
  number the field commits. If a control displays a derived number, its
  call-site conversion must satisfy `display(commit(displayed)) === displayed`
  or clamp visibly to a documented bound. Otherwise the field will appear to
  "lose" values on blur even though the parser worked.

Call-site rule after migration: a site passes `min`/`max`/`step`
(or `numericMode`) and a number-typed `onValueCommit`. Weight controls must
declare `numericMode="weight"`; labels, titles, and automation target ids are
accessibility or metadata only, never behavior switches. No parsing, no
fallbacks, no clamping at call sites. Sites needing side effects wrap the
setter (`onValueCommit={(v) => handleCycleBeatsChange(v)}`).
Derived-value controls need their own round-trip tests beside the component
that owns the conversion.
