# UI Control Row Guardrails Plan

This plan documents how to prevent slider, numeric field, automation, and label
collisions across Caesura's dense control panels. It is written as the technical
implementation plan for the next step, not as a completed migration.

## Problem

The recent slider regressions were not just React Aria integration mistakes.
They exposed that many panel rows do not have a shared layout and event contract.
Several old patterns coexist:

- A row may be a wrapping `label` that contains text, an automation button, a
  slider, and a numeric field.
- Some sliders are plain controls, while others are custom visual rails with a
  hidden native input.
- Broad CSS selectors still target `input[type="range"]`.
- Automation selection is discovered by DOM attributes and event delegation.
- Value readouts, range text, and numeric steppers are sometimes separate from
  the slider and sometimes absent.

That combination makes small component changes risky. A slider can inherit old
range styling, a label click can activate the automation button instead of the
slider, and narrow panel widths can force the label, rail, and value box into the
same physical space.

## Goal

Create one shared row architecture for ordinary app controls. The row should
guarantee that:

- The label is readable and not covered by a rail, thumb, value box, or button.
- The value is visible for every slider, either as a numeric field, output, or
  explicit readout.
- Range text can be shown where useful without stealing rail space.
- The rail has a portable minimum, ideal, and maximum width.
- Resizing a panel changes layout mode before controls overlap.
- Automation opens only from an explicit automation button.
- Custom sequencer rails can keep their bespoke visuals without inheriting the
  ordinary slider CSS.

## Target Architecture

### Shared Primitives

Add a small shared control-row layer under `ui/src/components/`:

- `ControlRow`
  - Owns label, automation, control, value, range, and helper slots.
  - Provides the responsive grid/flex contract.
  - Sets CSS custom properties for control width limits.
  - Uses container queries so behavior depends on the panel/card width, not only
    the app viewport.
- `AutomatableLabel`
  - Renders label text and, when present, the automation button.
  - Does not wrap the control in a `label`.
  - Supplies stable `id`/`aria-labelledby` wiring for the control.
- `AutomationButton`
  - The only element that opens the automation focus modal during normal use.
  - Always carries `data-automation-pick-control="true"`.
  - Keeps `data-automation-target` off wrapper rows and off slider root nodes.
- `ControlValue`
  - A fixed-width, tabular readout or numeric-field wrapper.
  - Never overlays the rail.
- `SliderField`
  - Remains the shared slider control.
  - Keeps an explicit visual-mode split:
    - `basic`: React Aria slider with custom app styling.
    - `native-overlay`: native range input used as an invisible hit target over
      bespoke rails.

The important rule is that `ControlRow` composes controls, while `SliderField`
only renders the slider itself.

### Markup Contract

Ordinary rows should use explicit associations:

```tsx
<ControlRow
  label="Minimum ratchet rate"
  automation={automationButton}
  control={<SliderField aria-labelledby={labelId} ... />}
  value={<NumericField aria-label="Minimum ratchet rate value" ... />}
  range="3-48 Hz"
/>
```

Rows should not use a wrapping `label` around multiple interactive children.
That pattern is the direct path to accidental button activation, focus confusion,
and click forwarding bugs.

## Responsive Layout Rules

`ControlRow` should be a container-query component with a stable internal grid.
Recommended breakpoints are based on row container width:

- Wide row:
  - label + automation on the left
  - slider/control in the middle
  - value/readout on the right
  - optional range text beneath or next to the value
- Medium row:
  - label and value share the first line
  - slider/control gets a full second line
  - range text sits under the value or below the rail
- Narrow row:
  - label wraps naturally
  - control takes the next line
  - value/range appears on its own line or aligned to the label line

The rail should use component-owned width limits, for example:

```css
.control-row {
  --control-min-inline-size: 10rem;
  --control-ideal-inline-size: 16rem;
  --control-max-inline-size: 22rem;
}
```

Then `SliderField` consumes those values rather than allowing every panel to
invent rail sizing. Ordinary rows should stack before violating the minimum.

### Resizing Behavior

App and panel resizing should follow these rules:

- Use `container-type: inline-size` on row groups or panels that own control
  rows.
- Prefer container queries over viewport media queries because panels can be
  narrow inside a wide app window.
- Values and steppers should have fixed or bounded inline sizes with tabular
  figures.
- Labels should wrap by default. Truncation is allowed only in known dense
  matrix/table contexts, and those contexts must provide accessible names.
- The slider rail should never grow beyond its portable max width in a row.
- The slider rail should never shrink below its portable min width in an
  ordinary row. Stack instead.
- If a specialized editor needs horizontal scrolling, make that explicit at the
  editor level. Do not allow ordinary rows to create hidden overlap.

## Automation Event Rules

Automation needs a stricter DOM contract:

- `data-automation-target` belongs on the actual input/control element only
  when that element is intentionally targetable.
- `data-automation-target` should not be placed on `ControlRow`, `SliderField`
  root wrappers, or generic value wrappers.
- `data-automation-pick-control="true"` belongs on automation buttons and on
  controls that should suppress delegated pick-mode clicks.
- Normal pointer interaction with sliders, numeric fields, selects, and toggles
  must never open the automation focus modal.
- Clicking the automation button is the only ordinary gesture that opens the
  associated automation focus modal.

In the longer term, automation should move from DOM crawling toward explicit
registration:

```ts
type AutomationControlRegistration = {
  target: AutomationTarget;
  label: string;
  controlId: string;
  focusControl?: () => void;
};
```

The current delegated system can remain during migration, but the new row
primitives should be compatible with explicit registration later.

## CSS Guardrails

The CSS should be organized so primitives cannot be accidentally restyled by old
global selectors.

Recommended direction:

- Introduce scoped classes for new primitives:
  - `.control-row`
  - `.control-row__label`
  - `.control-row__automation`
  - `.control-row__control`
  - `.control-row__value`
  - `.control-row__range`
  - `.slider-field`
  - `.slider-field__track`
  - `.slider-field__thumb`
  - `.slider-field__range`
- Avoid new broad selectors such as `input[type="range"]`.
- Keep legacy broad range selectors quarantined while rows migrate.
- Add a static guard that fails if new broad range selectors are introduced
  outside the slider primitive stylesheet block.
- Add a static guard that fails if a `label` contains a button plus another
  interactive control.

If CSS layers are introduced later, the preferred order is:

1. tokens
2. primitives
3. components
4. screens
5. legacy

The immediate migration can work without layers, but it should still follow the
same ownership model.

## Where To Implement

### New Files

Add the primitives in a small shared area:

- `ui/src/components/ControlRow.tsx`
- `ui/src/components/ControlRow.test.tsx`

If the file grows, split into a folder:

- `ui/src/components/control-row/ControlRow.tsx`
- `ui/src/components/control-row/AutomatableLabel.tsx`
- `ui/src/components/control-row/AutomationButton.tsx`
- `ui/src/components/control-row/ControlValue.tsx`
- `ui/src/components/control-row/index.ts`

Keep styles in `ui/src/styles.css` initially to match the current app. If the
app later moves to component CSS files, these styles can move with the primitive.

### Existing Components To Migrate

Highest priority:

- `ui/src/components/PitchShaperPanel.tsx`
  - Playback tab sliders and probability/rate rows.
  - This is where the first visible collision was reported.
- `ui/src/components/RhythmShaperPanel.tsx`
  - Ratchet rate rows.
  - Ratchet and ornament probability rows.
  - Delay, articulation, and phrase-control slider rows.
- `ui/src/components/ChannelShaperPanel.tsx`
  - Hocket probability and playback-control rows.
- `ui/src/components/RatchetTimeCurveEditor.tsx`
  - Curve blend, jitter, and shaping sliders.
- `ui/src/components/AutomationEditorModal.tsx`
  - Axis sliders and bend controls.

Secondary priority:

- `ui/src/App.tsx`
  - Any remaining settings rows that mix label, automation, numeric fields, or
    sliders.
- `ui/src/components/ScoreSetupPanel.tsx`
- `ui/src/components/BoundaryDetailDialog.tsx`
- `ui/src/components/SectionBoundariesPanel.tsx`
- `ui/src/components/PitchNotation.tsx`
- `ui/src/components/WeightEditors.tsx`
- `ui/src/components/TriggerInspector.tsx`
- `ui/src/components/JathiBhedamEditor.tsx`
- `ui/src/components/SeedSetupDialog.tsx`
- `ui/src/components/SetupDialog.tsx`

The secondary set should be audited before migrating. Some rows may already be
stable or may be dense table cells that should not become `ControlRow`.

### Shared Automation Label Source

The current automation label rendering is supplied through channel-shaper state
helpers and then reused by other panels. Move the reusable pieces into a shared
component or hook near the new row primitives. Panel-specific state should remain
in panel hooks, but rendering an automation button beside a label should not be
owned by one panel domain.

## Exceptions

### Custom Sequencer Rails

Do not force these into the ordinary React Aria slider visual path:

- `ui/src/components/AccentControls.tsx`
  - Velocity/accent rail.
- `ui/src/components/RhythmShaperPanel.tsx`
  - Ornament placement rail.

These can still sit inside `ControlRow`, but their rail visuals remain custom.
They should use `SliderField visualMode="native-overlay"` only for the pointer
and keyboard input surface.

### Matrices And Dense Tables

Markov matrices, weight grids, pitch cells, and timeline-like tables are not
ordinary rows. They can keep direct `NumericField` or matrix-specific controls,
provided they follow local rules:

- no wrapper label around multiple interactive descendants
- no broad range selectors
- accessible names are present
- cell dimensions are stable
- truncation is allowed only when the full label is available to assistive tech

### Timeline And Coordinate Editors

Timeline lanes, beat grids, note previews, and coordinate-based editors should
not use `ControlRow`. Their layout is governed by musical geometry. The shared
guardrail there is different: DOM controls must not change the timeline's
coordinate model or create hidden hit targets over musical content.

### Modal Chrome

Modal shells and focus traps are not control rows. Internal setting rows inside
modals can use `ControlRow`, but modal title bars, close buttons, and tab
switchers should keep their own layout primitives.

### Selects And Toggles

`ControlRow` should support selects, checkboxes, segmented controls, and icon
buttons as controls. The slider-specific min/max rail sizing applies only to the
control slot when a slider asks for it.

## Edge Cases

Handle these explicitly during implementation:

- Long labels such as "Minimum ratchet rate" and localized strings.
- Disabled rows with visible values and disabled automation buttons.
- Sliders with both a numeric stepper and an output readout.
- Sliders with logarithmic or formatted values such as `Hz`, `%`, `ms`, and
  musical ratios.
- Integer sliders, fractional sliders, and very small decimal steps.
- Min and max values that are equal after state normalization.
- Narrow inspector panels inside wide windows.
- Full app zoom or OS text scaling.
- Modal widths that change between desktop and small-window layouts.
- Automation pick mode while a slider is being dragged.
- Pointer down on the slider thumb followed by movement outside the row.
- Keyboard operation of sliders and numeric fields.
- Readonly or preview-only controls.

## Testing Plan

### Unit And Component Tests

Add tests for:

- `ControlRow` renders label, automation, control, value, and range slots.
- `ControlRow` does not create nested interactive `label` structures.
- `SliderField` basic mode renders one visual rail and one thumb.
- `SliderField` native-overlay mode does not show the native browser rail.
- Every `SliderField` configuration has either an output, numeric value slot, or
  explicit value readout.
- Slider pointer/click events do not trigger automation modal callbacks.
- Automation button clicks do trigger automation callbacks.

### Static Guardrails

Add a small script or test that fails on:

- new broad `input[type="range"]` selectors outside approved legacy blocks
- `data-automation-target` on `.control-row` or `.slider-field` wrappers
- JSX labels containing a button plus another interactive control
- `SliderField` call sites without an obvious value display

The last check may need an allowlist during migration because some values are
rendered by sibling components.

### Browser Verification

Use the in-app browser or Playwright against a local dev server. Verify at:

- 360px equivalent narrow panel
- 500px medium panel
- 760px inspector width
- 1024px app width
- 1280px and wider desktop widths

For each width, inspect:

- Pitch Playback tab
- Rhythm Playback/Ratchet sections
- Channel Playback/Hocket sections
- Automation editor modal
- Accent/custom rail controls

Measure bounding boxes for label, rail, thumb, value, and automation button.
The automated check should fail if any boxes overlap in the inline direction
unless the overlap is an intentional native-overlay input over a custom rail.

## Implementation Sequence

1. Add `ControlRow`, `AutomatableLabel`, `AutomationButton`, and `ControlValue`
   with tests and styles.
2. Add static guard tests for the two worst classes of regressions:
   broad range selectors and interactive wrapping labels.
3. Migrate the Pitch Playback tab and Rhythm ratchet rate rows first.
4. Verify those surfaces with browser screenshots and bounding-box checks at
   narrow, medium, and wide widths.
5. Migrate the remaining ordinary slider rows in `RhythmShaperPanel`,
   `PitchShaperPanel`, `ChannelShaperPanel`, `RatchetTimeCurveEditor`, and
   `AutomationEditorModal`.
6. Audit secondary panels and migrate only rows that match the ordinary
   label-control-value pattern.
7. Remove or neutralize legacy row layout classes once no migrated row depends
   on them.
8. Keep custom rails and matrices under explicit exceptions with tests that
   document why they are exceptions.

## Definition Of Done

The migration is complete when:

- Ordinary sliders use the shared row primitive.
- Every ordinary slider visibly exposes its current value.
- Range information is visible where it helps the user understand scale.
- Dragging or clicking sliders never opens automation by accident.
- Automation opens from the automation button only.
- No ordinary control row overlaps at supported panel widths.
- No new broad range CSS selectors are allowed.
- No ordinary row uses a wrapping label around multiple interactive controls.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass in `ui/`.
- Browser verification covers the previously failing Pitch Playback and Rhythm
  ratchet layouts.
