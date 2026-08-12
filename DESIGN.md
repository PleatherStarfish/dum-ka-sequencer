---
name: Caesura
description: Compact Solarized Astral interface for a probabilistic rhythm-tree MIDI instrument.
colors:
  base03: "#14244c"
  base02: "#292d55"
  base01: "#6c6880"
  base00: "#76758a"
  base0: "#8e90a0"
  base1: "#9a9ea8"
  base2: "#f4e6db"
  base3: "#fff4e5"
  yellow: "#bb8800"
  orange: "#ca5021"
  red: "#e12f43"
  magenta: "#e11984"
  violet: "#8263d4"
  blue: "#008cde"
  cyan: "#00a39f"
  green: "#56a070"
  bg: "{colors.base03}"
  panel: "color-mix(in srgb, {colors.base02} 35%, {colors.base03})"
  panel-raised: "color-mix(in srgb, {colors.base02} 24%, {colors.base03})"
  panel-recessed: "{colors.base03}"
  surface-0: "{colors.base03}"
  surface-1: "color-mix(in srgb, {colors.base02} 35%, {colors.base03})"
  surface-2: "color-mix(in srgb, {colors.base02} 42%, {colors.base03})"
  surface-3: "color-mix(in srgb, {colors.base02} 58%, {colors.base03})"
  surface-4: "{colors.base02}"
  line: "color-mix(in srgb, {colors.base01} 60%, {colors.base0})"
  line-strong: "{colors.base0}"
  line-hot: "{colors.magenta}"
  text: "{colors.base1}"
  muted: "color-mix(in srgb, {colors.base1} 72%, {colors.base0})"
  faint: "color-mix(in srgb, {colors.base1} 54%, {colors.base0})"
  accent: "{colors.cyan}"
  accent-ink: "{colors.base03}"
  accent-strong: "{colors.magenta}"
  selected-bg: "{colors.base02}"
  rail-rose: "{colors.magenta}"
  rail-cool: "{colors.cyan}"
  rail-violet: "{colors.violet}"
  live-green: "{colors.green}"
  fault-red: "{colors.red}"
  data-blue: "{colors.blue}"
  data-rose: "{colors.magenta}"
  data-violet: "{colors.violet}"
  curve-orange: "{colors.orange}"
  gati-neutral: "{colors.base00}"
  gati-beat: "{colors.yellow}"
typography:
  display:
    fontFamily: "DIN Alternate, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0"
  title:
    fontFamily: "Avenir Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: "Avenir Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0"
  label:
    fontFamily: "Avenir Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "0"
  mono:
    fontFamily: "SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.74rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0"
rounded:
  panel: "4px"
  control: "3px"
  pill: "999px"
  glyph: "2px"
spacing:
  xs: "5px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  app-x: "18px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "5px 10px"
    height: "28px"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "5px 10px"
    height: "28px"
  input-recessed:
    backgroundColor: "{colors.surface-0}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "5px 7px"
    height: "28px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "8px"
  timeline-track:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  ratchet-event:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
---

# Design System: Caesura

## 1. Overview

**Creative North Star: "Solarized Astral Instrument"**

Caesura is a compact musical workbench for dense rhythmic decisions. It should feel like an antique star-chart console built for serious repeated use: indigo/parchment monotones, small equipment labels, hard-edged lanes, and restrained data colors that always mean something.

The system is minimalist, utilitarian, and instrument-like. Visual hierarchy comes from exact geometry, tonal layers, hairline borders, and state color. Decoration is prohibited unless it carries musical information.

It explicitly rejects generic DAW piano rolls, conventional step sequencers, glossy grooveboxes, academic notation editors, marketing dashboards, cute or game-like synth toys, decorative vaporwave aesthetics, and interfaces that make the timeline feel secondary.

**Key Characteristics:**

- Flat, grid-led, and dense.
- Timeline-first, with one shared horizontal musical coordinate frame.
- Cyan for active editing and commit actions.
- Magenta, violet, blue, yellow, orange, red, and green only as data or feature-role colors.
- Small-radius surfaces, recessed controls, stable lane geometry.
- Short labels, no ornamental copy, no spectacle.

## 2. Colors

The palette is Solarized Astral: eight symmetric monotones plus eight shared accents. Dark mode uses `base03` for background and `base1`-anchored text; light mode uses `base3` for background and `base01`-anchored text. The app may use derived monotone mixes for compact UI text when the literal Solarized pair falls below WCAG AA contrast. The accent colors never change between modes.

### Primary

- **Astral Cyan** (`accent`, `cyan`): The primary edit and command color. Use it for selected controls, commit actions, rhythm spans, slider thumbs, and high-probability values.
- **Astral Magenta** (`accent-strong`, `magenta`): The hero emphasis color. Use it for jathi pulses, ornament emphasis, selected/open chrome, and high-attention borders.
- **Astral Ink** (`accent-ink`): Dark text on accent-filled controls and active timeline cells.

### Secondary

- **Blue Function** (`data-blue`): Channel/routing/support data and function-like timeline marks.
- **Violet Signal** (`data-violet`): Pitch shaper surfaces, pitch timeline marks, decorators, and hex-like accents.
- **Yellow Beat** (`gati-beat`): Beat starts, queued launch cues, and type-like marks.

### Tertiary

- **Green Live** (`live-green`): Playing, enabled transport health, active beat playback, and accelerando ratchet direction when the direction matters.
- **Red Fault** (`fault-red`): Errors, destructive or invalid state, missing chain fallbacks, and failed preview states.
- **Orange Boundary** (`curve-orange`): Fired boundaries, retardando ratchet direction, and warm secondary motion states.

### Neutral

- **Astral Surround** (`bg`): App surround only.
- **Astral Console** (`panel`): Primary tool surfaces, editor panels, timeline panel, debug panel, and shaper panels.
- **Raised Astral Surface** (`panel-raised`): Top bar and selected neutral sub-surfaces.
- **Recessed Astral Surface** (`panel-recessed`, `surface-0`): Inputs, timeline tracks, matrix cells, meters, and table bodies.
- **Console Surfaces** (`surface-1` through `surface-4`): Subpanels, repeated rows, hover states, active tabs, and stronger neutral affordances.
- **Instrument Hairlines** (`line`, `line-strong`): Ordinary and major dividers.
- **Warm Text** (`text`, `muted`, `faint`): Primary, secondary, and de-emphasized text.

### Named Rules

**The Color Has a Job Rule.** Every saturated color must identify state, data category, selected structure, or musical role. Empty space stays neutral.

**The Hero Accent Rule.** Cyan is the primary command voice and magenta is the primary emphasis voice. Do not make every control saturated.

**The Symmetric Theme Rule.** Monotones swap roles between dark and light mode; accents are shared unchanged. Do not recolor accents per mode.

**The Whole Edge Rule.** A colored container is either fully bordered or background-tinted. Do not use one colored top or side edge on a box.

## 3. Typography

**Display Font:** DIN Alternate with Helvetica Neue and Arial fallbacks.
**Body Font:** Avenir Next with Helvetica Neue and Arial fallbacks.
**Label/Mono Font:** SF Mono, Menlo, Consolas only for debug and code-like data.

**Character:** Typography should feel like equipment labeling: quiet, crisp, compact, and unromantic. The interface uses one humanist UI family plus a narrow uppercase display voice for panel titles and summaries.

### Hierarchy

- **Display** (700, `1rem`, `1.1`): App title, dialog titles, panel summary titles, and compact instrument headings.
- **Title** (800, `0.9rem`, `1.2`): High-emphasis control labels, selected tabs, and shaper action text.
- **Body** (500, `15px`, `1.35`): General UI text, summaries, compact explanatory copy, and form values.
- **Label** (800, `0.72rem`, `1.1`, uppercase only for short labels): Field labels, matrix headers, timeline lane labels, chips, tabs, and status tags.
- **Mono** (500, `0.74rem`, `1.35`): MIDI/debug tables, byte streams, timing data, and code-like inspection only.

### Named Rules

**The No Hero Type Rule.** Caesura is an instrument surface. Do not use landing-page display sizes inside the app.

**The Zero Tracking Rule.** Letter spacing is `0`. Labels can be uppercase only when they are short and structural.

**The Mono Is Debug Rule.** Monospace is forbidden for ordinary controls. It is only for MIDI, timing, byte, or code-like data.

## 4. Elevation

Caesura is flat by default. Depth comes from tonal layers, hairline borders, recessed controls, grid lines, selected outlines, and occasional inset highlights. Heavy drop shadows are not part of the normal app surface; dialogs may use restrained structural shadow only when they must separate from the workbench.

### Shadow Vocabulary

- **Panel Inset** (`inset 0 1px 0 rgba(255, 255, 255, 0.035)`): Subtle top edge on major panels.
- **Input Recess** (`inset 0 1px 0 rgba(0, 0, 0, 0.28)`): Recessed input and select fields.
- **Dialog Lift** (`0 18px 42px rgba(0, 0, 0, 0.42)`): Legacy dialog separation only. Prefer tonal layering unless the surface must float.
- **Matrix Heat Inset** (`inset 0 0 0 1px ...`): Probability cells where color and inset edge encode weight.

### Named Rules

**The Flat Console Rule.** Surfaces rest flat. Shadows must be structural, state-driven, or dialog-specific.

**The No Glow Rule.** Do not use decorative glow around active timeline events, buttons, panels, headings, or cards.

## 5. Components

Components should feel like parts of one musical instrument: compact, familiar, stable, and consistent across Rhythm, Pitch, Channel, Setup, and Seed surfaces.

### Buttons

- **Shape:** Small rectangular instrument controls (`3px` radius) with stable `28px` height.
- **Primary:** Astral Cyan fill with Astral Ink text. Reserve for commit, apply, materialize, export, or focused local confirmation.
- **Hover / Focus:** Hover raises neutral contrast or cyan/magenta emphasis. Focus uses a visible cyan or magenta outline, not glow.
- **Secondary / Ghost / Tertiary:** Neutral recessed or transparent surfaces with hairline borders. Use for ordinary commands, utility actions, and tabs.

### Chips

- **Style:** Compact data units with neutral surfaces, hairline borders, and small bold labels.
- **State:** Selected chips use cyan, magenta, or the feature role color. Error and fallback chips use Red Fault. Inactive chips stay neutral.

### Cards / Containers

- **Corner Style:** Small panel radius (`4px`). Repeated editable items may use `6px` or `7px` only when the local pattern already does.
- **Background:** Major tools use Astral Console. Controls and nested working areas use recessed monotones and Console Surface steps.
- **Shadow Strategy:** Inset edge only by default. Dialogs may lift. Tool surfaces should not float.
- **Border:** One-pixel hairlines. Use a full border or background tint for colored containers; no lone colored side/top stripes.
- **Internal Padding:** Dense `6px` to `8px`; larger spacing only between tools, not inside control clusters.

### Inputs / Fields

- **Style:** Recessed dark fields with `3px` radius, hairline border, `28px` minimum height, and tabular right-aligned numeric values where exact timing or weights matter.
- **Focus:** Cyan or magenta line or outline. No animated width, glow, or color flood.
- **Error / Disabled:** Error uses subdued red fill or border with concise fix copy. Disabled dims but remains readable.

### Navigation

- **Style, typography, default/hover/active states, mobile treatment.** Top bar, transport strip, tabs, and collapsible panel summaries are compact utility surfaces. Active tabs use neutral raised surface plus a full cyan, magenta, or feature-color border. Small screens should preserve capability through wrapping and horizontal scroll, especially for the timeline and matrices.

### Timeline

The timeline is the signature component. Beat, gati, jathi, rhythm, ratchet, pitch, and channel lanes share the same horizontal coordinate frame. Labels overlay or sit as compact lane headers; they must never change musical geometry.

- **Beat ruler:** Quiet neutral cells with Green Live for active playback.
- **Gati:** Neutral matra cells, ochre beat starts, warm orange section starts.
- **Jathi:** Compact magenta blocks.
- **Rhythm:** Cyan spans, magenta jathi spans, Red Fault fallback states.
- **Ratchet:** Yellow event bars with obvious internal hit marks; Green Live or Orange Boundary only when curve direction matters.
- **Pitch:** Violet data marks.
- **Channel:** Channel color is contained to event marks and chips.

### Markov Matrices

Rhythm, Pitch, and Channel matrices use the same table shell, sticky headers, recessed empty cells, and canonical blue-teal-green-yellow-orange-red heat ramp. The ramp is allowed because it encodes probability weight. It is forbidden in headings, empty decoration, or non-probability chrome.

### Dialogs

Dialogs are supporting tools, not the first design move. Setup and Seed Strategy can be dialogs because they are cross-cutting surfaces. Composition work stays inline in panels. Backdrops dim the app; they do not blur it.

## 6. Do's and Don'ts

### Do:

- **Do** keep the first screen as the working instrument surface.
- **Do** reuse Solarized Astral tokens for app chrome and feature panels.
- **Do** keep the timeline visually sovereign and geometrically exact.
- **Do** use cyan for primary edit focus, selected structures, and commit actions.
- **Do** use magenta, violet, blue, yellow, orange, red, and green only for routing, tension, pitch, beat, boundary, fault, live, or feature-role data.
- **Do** keep panel and control radii small (`4px` panels, `3px` controls).
- **Do** use horizontal scroll for dense musical surfaces instead of hiding capability.
- **Do** keep copy short: labels like `Tempo`, `Order`, `Fallback`, `Boundary`; commands like `Save`, `Recall`, `Apply`, `Reset`.
- **Do** make enabled state visible with subtle tint plus stronger hairline.
- **Do** preserve one controlling switch per playback feature.

### Don't:

- **Don't** build generic DAW piano rolls.
- **Don't** imitate conventional step sequencers.
- **Don't** make Caesura feel like a glossy groovebox.
- **Don't** turn it into an academic notation editor.
- **Don't** use marketing dashboard layouts.
- **Don't** make cute or game-like synth toy surfaces.
- **Don't** use decorative vaporwave aesthetics.
- **Don't** let panels, cards, or spectacle make the timeline feel secondary.
- **Don't** use gradient text, glassmorphism, bokeh, or decorative orbs.
- **Don't** use purple-blue gradients, neon glow, or ornamental color fields.
- **Don't** use thick colored side-stripe borders or lone colored edges on boxes.
- **Don't** put cards inside cards.
- **Don't** use large rounded icon tiles above headings.
- **Don't** use monospace as generic technical flavor.
- **Don't** add duplicate switches, seed inputs, or playback controls in summaries.
