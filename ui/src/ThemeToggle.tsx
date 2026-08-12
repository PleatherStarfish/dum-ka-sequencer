/**
 * ThemeToggle — a cute, accessible day/night switch.
 *
 * Built on the same React Aria `useSwitch` foundation as `Switch.tsx` (so it's
 * a real `role="switch"`, keyboard- and screen-reader-correct), but with a
 * celestial visual: the sliding thumb *is* the sun (light) or the moon (dark),
 * and the track is a little sky. `isSelected` ⇒ light mode.
 */
import { useRef } from "react";
import { useSwitch } from "@react-aria/switch";
import { useToggleState } from "@react-stately/toggle";
import { useFocusRing } from "@react-aria/focus";

import type { ThemeMode } from "./themePrefs";

export interface ThemeToggleProps {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

export function ThemeToggle({ mode, onChange }: ThemeToggleProps) {
  const isLight = mode === "light";
  const next: ThemeMode = isLight ? "dark" : "light";
  const ariaProps = {
    isSelected: isLight,
    onChange: (selected: boolean) => onChange(selected ? "light" : "dark"),
    "aria-label": `${mode} theme. Switch to ${next} mode.`,
  };
  const state = useToggleState(ariaProps);
  const ref = useRef<HTMLInputElement | null>(null);
  const { inputProps } = useSwitch(ariaProps, state, ref);
  const { isFocusVisible, focusProps } = useFocusRing();

  return (
    <label
      className={`theme-switch is-${mode}${isFocusVisible ? " is-focus-visible" : ""}`}
      title={`Switch to ${next} mode`}
    >
      <input
        className="theme-switch__input"
        {...inputProps}
        {...focusProps}
        ref={ref}
      />
      <span className="theme-switch__track" aria-hidden="true">
        <span className="theme-switch__stars" />
        <span className="theme-switch__thumb" />
      </span>
    </label>
  );
}
