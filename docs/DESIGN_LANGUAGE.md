# Caesura Design Language

Caesura should feel like a compact musical instrument: dense, legible, direct,
and calm. The visual reference is an antique star-chart console using the
Solarized Astral palette: mirrored indigo/parchment monotones with shared
vaporwave accents used only as musical signal. The result should feel synthetic
and archival without becoming glossy, cute, or decorative.

This document is the source of truth for common UI elements. When adding or
changing interface code, reuse these patterns before inventing a new look.

## North Star

- **Instrument first.** The app is a sequencer, not a landing page. The first
  screen is always the working surface.
- **Timeline sovereign.** The resolved timeline is the truth display. Everything
  else should visually support it.
- **Flat signal design.** Depth comes from tone steps, borders, grids, and
  active state. Avoid glass, blur, glow, soft shadow stacks, and ornamental
  gradients.
- **Astral color as signal, not costume.** Use cyan, magenta, violet, blue,
  yellow, orange, red, and green as data colors. Do not use neon-on-dark,
  purple-blue gradient fields, gradient text, or floating decorative shapes.
- **Dense but readable.** The interface can be compact, but controls need clear
  hit areas, readable labels, and stable dimensions.
- **Grid before card.** Alignment, dividers, and shared headers create grouping.
  Bordered containers are for real tools, repeated items, dialogs, and tables.
- **One control, one meaning.** Do not duplicate switches, seed inputs, or
  feature on/off controls in summaries.

## Color System

The fixed palette is **Solarized Astral**. It follows Solarized mechanics:
eight monotones form one lightness ramp, dark mode and light mode mirror each
other, and the eight accents are identical in both modes.

**Contrast contract.** Monotone body and secondary text is intentionally calm
and low-contrast — it sits around 3.7–4.4:1 against its surface, below WCAG AA
(4.5:1) by design. The rule is a **legibility floor of 3:1**, not AA, for
muted text. Contrast is held to AA only where it is load-bearing: dark "ink"
(`--accent-ink` / `--base03`) on a saturated accent fill (cyan/green/yellow
command and timeline marks), and the focus-indicator line as a UI affordance
(≥3:1). This is enforced by `ui/tests/e2e/theme-contrast.spec.ts`, which also
guards against dark panels leaking into light mode.

Monotones:

- `--base03` `#14244c`: dark background.
- `--base02` `#292d55`: dark current-line/UI.
- `--base01` `#6c6880`: comments in dark mode and the anchor for readable
  light-mode UI text.
- `--base00` `#76758a`: light-mode hairlines, compact non-text structure, and
  large/bold secondary marks when contrast allows.
- `--base0` `#8e90a0`: dark-mode secondary text and compact non-text structure.
- `--base1` `#9a9ea8`: the anchor for readable dark-mode UI text and comments
  in light mode.
- `--base2` `#f4e6db`: light current-line/UI.
- `--base3` `#fff4e5`: light background.

Accents, shared unchanged across modes:

- `--yellow` `#bb8800`: gati beat starts, type-like marks, queued launch cues.
- `--orange` `#ca5021`: fired boundaries, retardando, warm secondary motion.
- `--red` `#e12f43`: errors, destructive actions, missing-chain fallbacks.
- `--magenta` `#e11984`: hero accent, jathi pulses, ornament emphasis.
- `--violet` `#8263d4`: pitch data and decorator-like marks.
- `--blue` `#008cde`: functions, channel/routing support data.
- `--cyan` `#00a39f`: hero accent, strings/rhythm spans, primary command voice.
- `--green` `#56a070`: live, healthy, enabled, and accelerando direction.

- `--bg`: app surround. Use for the outer page only.
- `--panel`: primary tool surface. Use for top bar, timeline panel, editor
  panels, shaper panels, and debug panels.
- `--panel-2`: raised neutral surface. Use sparingly for selected sections or
  repeated editable rows.
- `--panel-3` / `--surface-0`: recessed lanes, inputs, matrix cells, and table
  bodies.
- `--surface-1` and `--surface-2`: subpanels and repeated items inside tools.
- `--line`: default hairline.
- `--line-strong`: major dividers, selected outlines, and table sticky edges.
- `--theme-rail`: magenta structural emphasis for selected/open app chrome.
- `--theme-rail-cool`: cyan structural emphasis for routing, transport utility
  groups, and channel shaper surfaces.
- `--theme-rail-violet`: violet structural emphasis for pitch shaper surfaces.
- `--accent`: cyan. Use for primary command voice, active selection, rhythm
  spans, and commit actions.
- `--green`: live, healthy, currently playing, or enabled transport state.
- `--red`: error, destructive action, missing chain, failed fallback, or invalid
  input.
- `--data-blue`: channel/routing/supporting data.
- `--data-rose`: magenta tension, jathi, fallback-adjacent, or ornament nuance.
- `--data-violet`: pitch data. Use as a role color, never as a panel theme.

Rules:

- Color should identify state or data category. It should not decorate empty
  space.
- Common app chrome should use the fixed Solarized Astral palette. Do not
  introduce one-off section palettes.
- Score/timeline and matrix internals are exceptions: they may stay more
  neutral or more data-rich so musical information remains readable.
- Gradients are reserved for slider controllers that need heatmap-style
  intensity cues, and for matrix heatmaps where color encodes probability. App
  chrome, tabs, headings, cards, and decorative backgrounds stay flat.
- Feature panels stay mostly neutral. When a feature is switched on, its panel
  may pick up a very subtle background tint from its role color plus a stronger
  hairline. The tint should read as "armed" rather than "themed."
- Active tabs use neutral fill plus a full role-color border when the role tint
  would reduce text contrast. Inactive tabs stay neutral.
- Heatmaps may use the richer original Rhythm Shaper ramp because the color
  encodes weight. Keep the same ramp for every Markov matrix.
- Never use gray text on colored backgrounds. Text on data color should be dark
  ink or near-white, depending on contrast.
- Small UI text must pass WCAG AA contrast against its rendered background.
  When the literal Solarized monotone pair is too close, use a derived monotone
  mix rather than recoloring an accent. Keep deliberately low-contrast comment
  tones on the `--comment` token, not on functional labels.
- Avoid pure black and pure white. Tint both toward the app neutrals.

## Enabled Surface Tinting

Enabled state should be visible before reading every label, but it should not
compete with the timeline or heatmaps.

- Use a low-opacity background mix, roughly 6-10% of the role color into the
  neutral surface.
- Pair the tint with a slightly stronger full border or with the background
  tint alone. Do not mark a box with a single colored edge.
- Use cyan for generic editing features, violet for pitch, blue/cyan for
  channel/routing, and green only for live transport or healthy running state.
- Tint the smallest meaningful surface: the enabled panel, active tab, enabled
  rule, or on switch. Do not tint the entire app shell.
- Keep disabled/off surfaces neutral. They can be dimmed, but should remain
  readable.
- Never use glow, blur, animated pulse, gradient fills, or saturated neon as an
  enabled-state cue.

## Typography

Typography should feel like equipment labeling: quiet, crisp, and unromantic.

- UI/body face: `--font-ui`.
- Short headings: `--font-display`.
- Monospace is reserved for debug tables, byte streams, and code-like data. Do
  not use it to make ordinary controls feel technical.
- Letter spacing is `0`. Do not widen body text or control labels.
- Uppercase is allowed only for short labels, section names, matrix headers, and
  compact status text.
- Body text should stay at least 14px equivalent. Tiny text is for glyph labels
  only, and only when the label is redundant with visual structure.
- Headings inside panels stay compact. Do not use hero-scale type inside an
  instrument surface.

## Spacing, Radius, And Borders

- Default panel radius: small, around `4px`.
- Default control radius: smaller, around `3px`.
- Pills are exceptional. Use them for transport clusters, true toggles, LEDs,
  meters, and very small status chips. Do not make every button a pill.
- Borders are hairlines. Avoid thick colored borders and side-tab card
  treatment. A colored container is either fully bordered or background-tinted;
  do not use a lone colored top/side edge on a box.
- Group related controls tightly. Separate tools with panel boundaries or
  slightly larger vertical gaps.
- Repeated elements should have stable dimensions so labels, hover states, and
  dynamic values do not shift layout.

## App Frame

The app shell is a workbench.

- Keep the top bar compact.
- Keep transport and project controls in one utility strip.
- Keep the timeline directly below transport.
- Lower-frequency editors live below the timeline in collapsed panels.
- Avoid large empty bands. A blank area should imply available workspace, not a
  decorative section.

## Panels And Tool Surfaces

Use panels for real functional zones:

- Top bar.
- Transport/control bar.
- Timeline.
- Collapsible editor panels.
- Shaper panels.
- Debug panel.
- Dialogs.

Panel rules:

- Panels are neutral by default. Enabled panels may use the subtle tinting rules
  above.
- Panel headers state current summary and expose expand/collapse where needed.
- Open panels should reveal controls in a predictable grid.
- Do not put page sections inside floating cards.
- Do not nest cards inside cards for hierarchy. Use a heading, divider, or
  two-column grid instead.
- A repeated editable item may be card-like, but it should be flat and small.

### Editor Panel Header

Every editor/shaper panel header uses the same three-zone grammar so the space
reads identically everywhere — calm by default, predictable when populated:

- **Identity (left):** the panel `title` plus one `subtitle` readout line that
  holds the panel's key live metric(s) in a fixed format (e.g. `0 possible · max
  1 · 1 realized`). Counts and identity live here — never in a chip.
- **Flags (right):** status chips are *exceptions, not a mirror*. Show a chip
  only when a feature is active or a setting is non-default (`ratchet on`, `jathi
  layered`, `single-param`). Never show the default/"off" counterpart, and never
  an "open" chip — an open panel is self-evident. The default state shows no
  chips. Tones: `on` = active feature (accent), `warn` = needs attention. The row
  is bounded (max three, remainder collapses to a `+N` chip), so it cannot
  sprawl. This is enforced by `PanelStatusChips` (`MainEditorChrome.tsx`).
- **Close (far right):** the dismiss affordance, always last.

A chip therefore always means "you turned this on or changed it from default,"
which is the rule a user can learn once and rely on across every panel.

## Buttons And Commands

Buttons express command hierarchy.

- Primary button: the one action that commits, applies, materializes, or exports
  work in a local context.
- Secondary button: ordinary command.
- Tiny button: utility command inside a panel, such as reset, edit, clear,
  clone, or open.
- Destructive action: neutral by default with red hover/focus or explicit
  confirmation only when the action is irreversible.

Rules:

- Do not make every button primary.
- Do not use large icon tiles.
- Icon buttons are welcome for familiar operations when an icon exists. Add a
  tooltip or accessible label.
- Text buttons should be short verbs: `Save`, `Recall`, `Apply`, `Reset`,
  `Clear`, `Clone`.
- Avoid redundant helper text near buttons. The button label and location should
  do most of the work.

## Inputs, Selects, And Number Fields

Inputs are recessed instrument controls.

- Use dark recessed backgrounds.
- Use right-aligned tabular numbers for numeric fields.
- Pair units as attached segments when the unit is fixed, such as `BPM` or
  `sec`.
- Use sliders when the value is continuous and the exact number is secondary.
- Use steppers or numeric inputs when exact values matter.
- Use selects for closed option sets.
- Labels sit above or beside controls depending on available density. Keep the
  relationship obvious.

Validation:

- Invalid state uses red border or subdued red fill.
- Invalid helper copy should say what to fix, not restate that it is invalid.
- Disabled state should dim, not vanish.

## Toggles And Checkboxes

Toggles control binary feature state.

- Use a switch-like control for major feature on/off state.
- Use a compact checkbox for local preferences or subordinate options.
- On state should use cyan for edit preferences and green only for live/active
  transport-health state.
- Do not create summary toggles that duplicate a real switch elsewhere.
- Toggle labels should name the thing controlled, not describe the UI effect.

## Tabs And Segmented Controls

Tabs organize mutually exclusive views inside one tool.

- Use tabs for Rhythm Shaper, Pitch Shaper, Setup, and Seed Strategy sections.
- Active tabs use neutral raised surface plus a full role-color border, not a full color
  panel.
- Avoid low-opacity role-color background cues when they lower text contrast.
  Prefer the neutral fill plus full role-color border.
- Tab summaries should be short enough to scan. They may show current state, but
  should not become documentation.
- Do not use separate visual themes per tab.

## Chips, Badges, And Pills

Chips are compact editable data units.

- Weight chips show value, role prefix, and share percentage.
- Badges flag exceptional states: fallback, missing chain, invalid jathi,
  arbitrary subdivision.
- Status pills are for compact project/transport state.
- Use cyan or magenta for selected/active chips, red for errors/fallback alerts, and
  neutral for inactive chips.
- Avoid chip grids that all look equally important. Selected or resolved state
  should be obvious.

## Timeline

The timeline is the primary visual instrument.

- Geometry must be exact and shared across lanes.
- Labels are overlays or compact lane headers, not layout columns that shift
  musical geometry.
- Authored possibilities and resolved results stay visually distinct.
- Beat, gati, jathi, rhythm, ratchet, pitch, and channel lanes share the same
  horizontal coordinate frame.
- Active playback state may use green. Resolved/editing state uses cyan, magenta, or data
  colors.
- Timeline colors may be richer than panel colors because they encode musical
  structure.
- Do not add decorative glow around active timeline events. Use solid color,
  outline, or contrast.

Lane guidance:

- Beat ruler: quiet neutral, active beat green.
- Gati pulses: neutral cells, yellow beat starts, orange section starts.
- Jathi pulses: magenta compact blocks.
- Rhythm layer: cyan for gati spans, magenta for jathi spans, red for
  fallback/missing states.
- Ratchet: yellow with curve variants; green/orange only when curve direction
  matters.
- Pitch: muted violet data marks.
- Channel: stable channel colors, but channel colors should remain contained to
  event marks and chips.

## Markov Matrices

All Markov matrices should feel like the same instrument component.

- Rhythm, Pitch, and Channel matrices use the same table shell, sticky headers,
  cell sizing rhythm, input styling, and heatmap ramp.
- The original Rhythm Shaper heatmap ramp is the canonical matrix ramp:
  blue/teal/green through yellow/orange/red. It is allowed because it encodes
  probability weight, not decoration.
- Matrix headers are neutral with role-color row labels. Pitch and Channel should not
  introduce their own header colors.
- Empty cells are recessed charcoal.
- Weighted cells use heat color and an inset edge, not external glow.
- Matrix inputs sit inside the heat cell and remain legible at every intensity.
- Legends must match the actual heat ramp.

Do not:

- Use separate heat palettes per shaper.
- Use gradients in headings or labels.
- Use gradients outside matrix heatmaps and slider rails.
- Use decorative sparklines near matrices unless the data is real and readable.
- Hide matrix behavior on small screens. Allow horizontal scroll instead.

## Notation Editors

Notation can be an editor, but it should not become a crowded control stack.

- Staffs, clefs, noteheads, accidentals, and ledger lines are the notation lane.
- Numeric controls, weights, and secondary labels belong in separate aligned
  lanes below or beside the staff.
- If a notehead is clickable, its click target should be larger than the visible
  notehead, but the visible mark should stay uncluttered.
- Ghost noteheads may show available chromatic pitches, but they must stay
  visually subordinate to selected notes.
- Avoid putting inputs, badges, or tooltips directly over musical glyphs. Use
  shared pitch columns and horizontal scrolling instead.

## Tables And Debug Data

Tables are for dense inspection.

- Use sticky headers when vertical scrolling is expected.
- Use tabular numbers for timing, ticks, MIDI bytes, and weights.
- Use monospace only in MIDI/debug tables.
- Keep borders thin and consistent.
- Cleanup or stale rows may dim, but should remain readable.

## Meters, Sliders, And Graphs

Meters and small charts must carry information.

- Ratchet probability, velocity, and timing visuals are allowed because they show
  editable behavior.
- Tiny decorative charts are not allowed.
- Curves use grid lines and handles, not glow.
- Slider rails may use the limited heat ramp to show low-to-high intensity.
  Other controls should stay flat.
- Filled meter color should match the thing being adjusted.
- Use transforms or opacity for any animation. Do not animate width, height,
  margin, or padding.

## Dialogs

Dialogs are for preference surfaces and focused supporting tools, not reflexive
containers.

- Setup and Seed Strategy can be dialogs because they are cross-cutting app
  surfaces.
- Complex composition work should stay inline in panels.
- Dialog surfaces are neutral, flat, and scrollable when necessary.
- Backdrops dim the app; they do not blur it.
- Dialog headers state the surface and current purpose. Avoid redundant intro
  paragraphs.

### Seed Strategy

- The Seed Strategy overview is a hierarchy diagram, not a card grid.
- Show Global score as the root source.
- Show Rhythm, Pitch, and Channel as child streams with explicit connector
  labels for `inherits` versus `local`.
- Show Ratchet as independent, visually separate from the global fan-out.
- Connector geometry should carry the hierarchy. Avoid floating relationship
  badges that are detached from the branches they describe.

## Notices, Errors, And Empty States

- Error: red-tinted surface, concise explanation, actionable fix if known.
- Preview warning: orange-tinted surface.
- Success/status: green or neutral depending on importance.
- Empty state: one sentence that tells the current state and the next useful
  action. No feature marketing.
- Do not stack multiple banners with generic text if one can summarize the
  actual issue.

## Icons And Symbols

- Use familiar symbols for common commands when available.
- Do not place icons in large rounded tiles above headings.
- Small data glyphs are allowed when they carry state, such as seed strategy,
  play/rest/tie, or channel identity.
- If an icon is not obvious, provide a tooltip or accessible label.

## Motion And Interaction

Caesura should feel responsive, not animated.

- Motion is optional and subtle.
- Use short ease-out transitions for hover/focus when useful.
- No bounce, elastic easing, wiggling, pulsing, or ambient animation.
- Loading state should be textual or structural, not ornamental.
- Hover state may raise contrast but should not move layout.

## Responsive Behavior

Small screens should preserve capability.

- Collapse grids to one column.
- Keep timeline horizontally scrollable rather than amputating lanes.
- Keep critical controls reachable.
- Avoid hiding export/save/edit actions just because the screen is narrow.
- Text must not overflow buttons or chips. Prefer wrapping, truncation with
  title, or smaller stable control groups.

## Copy Voice

The UI should speak like a precise instrument manual.

- Short nouns for labels: `Tempo`, `Order`, `Fallback`, `Boundary`.
- Short verbs for commands: `Save`, `Recall`, `Apply`, `Reset`.
- Summaries can use compact fragments: `4 pulses · first order · fallback [4]`.
- Avoid redundant copy that restates the heading.
- Avoid decorative enthusiasm. No "magic", "delight", or "supercharge" language.
- Use Carnatic terms where they are the real concept. Keep gati and jathi in
  visible copy; use pulse for user-facing matra positions.

## Vaporwave Restraint Checklist

Use:

- Solarized Astral as the fixed app palette.
- Plum-black surfaces.
- Shared cyan, magenta, violet, blue, yellow, orange, red, and green accents.
- Thin cyan/magenta/violet structural rails.
- Hard-edged grids.
- Dark tinted neutrals.
- Thin lines.
- Small instrument labels.
- Heatmaps where color encodes real values.

Avoid:

- One-off palettes per section.
- Purple-blue gradients.
- Neon glow.
- Glassmorphism.
- Bokeh/orbs.
- Gradient text.
- Card stacks.
- Big rounded icon tiles.
- Centered marketing layouts.
- Identical feature-card grids.
- Generic monospace "technical" styling.

## Implementation Checklist

Before shipping UI work:

1. Does it reuse existing tokens and component patterns?
2. Does color encode state or data?
3. Would the UI still read if all decorative color were removed?
4. Are Rhythm, Pitch, and Channel versions of the same tool visually matched?
5. Are text labels short and non-redundant?
6. Are controls stable at narrow widths?
7. Is the timeline still the visual priority?
8. Do enabled features and active tabs have subtle state cues?
9. Did you avoid glass, glow, gradient text, nested cards, and oversized icons?
