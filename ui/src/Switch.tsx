/**
 * Switch — the single on/off toggle control for the app.
 *
 * One accessible, portable switch replacing the app's previously inconsistent
 * toggle idioms (native checkboxes sized as pills, status-dot buttons, and a
 * handful of bespoke `*-inline-switch` styles). It is a real sliding track +
 * thumb, themed with Astral tokens, with a keyboard- and screen-reader-correct
 * `role="switch"` provided by React Aria.
 *
 * Contract:
 * - Controlled via `isSelected` + `onChange(next: boolean)`, or uncontrolled
 *   via `defaultSelected`. The callback always receives the resulting boolean.
 * - `isDisabled` blocks interaction; `isReadOnly` shows state without toggling.
 * - A label is required for accessibility: pass `children` (rendered beside the
 *   track) or an `aria-label` for an icon-only/standalone switch.
 * - Space/Enter and click toggle; focus shows a visible ring.
 * - `size` (`sm` | `md`) and `tone` (`on` accent color when selected:
 *   `live` green default, or `accent` cyan) control density and hue.
 *
 * Engine: React Aria `useSwitch` + `useToggleState` (a11y/keyboard/focus);
 * the visual track/thumb and class hooks are ours. Tested in `Switch.test.tsx`.
 */
import { useRef, type ReactNode } from "react";
import { useSwitch, type AriaSwitchProps } from "@react-aria/switch";
import { useToggleState } from "@react-stately/toggle";
import { useFocusRing } from "@react-aria/focus";

export type SwitchTone = "live" | "accent";
export type SwitchSize = "sm" | "md";

export interface SwitchProps extends AriaSwitchProps {
  /** Visible label rendered beside the track. Use `aria-label` instead for an
   *  icon-only switch. */
  children?: ReactNode;
  className?: string;
  size?: SwitchSize;
  /** Color of the "on" state. `live` (green) is the app default for
   *  enabled/active; `accent` (cyan) for neutral feature toggles. */
  tone?: SwitchTone;
  /** Place the label before the track instead of after. */
  labelPosition?: "before" | "after";
  /** Forwarded to the underlying input (e.g. the automation system locates
   *  controls by this). */
  "data-automation-target"?: string;
  /** Forwarded to the underlying input (e2e hooks). */
  "data-testid"?: string;
  /** Native tooltip, forwarded to the control label. */
  title?: string;
}

export function Switch({
  children,
  className,
  size = "md",
  tone = "live",
  labelPosition = "after",
  title,
  ...rest
}: SwitchProps) {
  // Split DOM passthrough (data-*) from the Aria switch props so it can land
  // on the input while everything else drives useSwitch.
  const dataProps: Record<string, unknown> = {};
  const ariaProps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key.startsWith("data-")) dataProps[key] = value;
    else ariaProps[key] = value;
  }
  const switchProps = ariaProps as AriaSwitchProps;
  const state = useToggleState(switchProps);
  const ref = useRef<HTMLInputElement | null>(null);
  const { inputProps, isSelected, isDisabled } = useSwitch(
    { ...switchProps, children },
    state,
    ref
  );
  const { isFocusVisible, focusProps } = useFocusRing();

  const rootClassName = [
    "switch",
    `switch--${size}`,
    `switch--${tone}`,
    `switch--label-${labelPosition}`,
    isSelected ? "is-on" : "is-off",
    isDisabled ? "is-disabled" : "",
    isFocusVisible ? "is-focus-visible" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const track = (
    <span className="switch__track" aria-hidden="true">
      <span className="switch__thumb" />
    </span>
  );

  return (
    <label className={rootClassName} title={title}>
      {/* Transparent full-size input is the real role=switch control: the whole
          switch is clickable, and it stays a present, actionable element for
          assistive tech and tests (unlike a clipped visually-hidden input). */}
      <input
        className="switch__input"
        {...inputProps}
        {...focusProps}
        {...dataProps}
        ref={ref}
      />
      {children != null && labelPosition === "before" && (
        <span className="switch__label">{children}</span>
      )}
      {track}
      {children != null && labelPosition === "after" && (
        <span className="switch__label">{children}</span>
      )}
    </label>
  );
}
