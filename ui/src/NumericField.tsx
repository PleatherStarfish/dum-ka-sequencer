/**
 * NumericField — the single numeric-entry control for the app.
 *
 * Hardened contract (see docs/NUMERIC_INPUT_SURVEY.md for the use-case study
 * this implements):
 *
 * - **Number-only API.** Consumers receive committed numbers via
 *   `onValueCommit(value)`. There is no string change event: call sites never
 *   parse, never clamp, never invent fallbacks.
 * - **Draft while editing.** Keystrokes edit a draft; partial drafts
 *   (`""`, `-`, `.`, `1.`) are legal mid-edit and never commit. Characters
 *   that can't begin a number are rejected at the keystroke (React Aria's
 *   NumberParser validates partials).
 * - **Commit on blur / Enter** (Enter also blurs): parse → clamp to min/max →
 *   quantize to step (when provided) → format → emit only if changed.
 * - **Empty/invalid never emits.** The field reverts to the last committed
 *   text; NaN cannot reach a call site.
 * - **Escape reverts** and blurs. **Arrows step** ±step (Shift ×10, Alt ×0.1);
 *   steppers ditto, disabled at the bounds.
 * - **External value follows while not editing** (controlled), frozen during
 *   an edit so live transport updates can't clobber a draft.
 * - Formatting is locale-stable (`en-US`, no digit grouping, fraction digits
 *   derived from step) so patches, fixtures, and e2e text stay byte-stable.
 *
 * The parsing/formatting/clamping/stepping engine is React Aria's
 * `useNumberFieldState` (@react-stately/numberfield); the event wiring is
 * ours so the app's established semantics (above) are explicit and tested in
 * `NumericField.test.tsx`.
 */
import {
  useRef,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { useNumberFieldState } from "@react-stately/numberfield";
import { useEditorDraftLifecycle } from "./editorDraftFlush";

type NativeNumericInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "defaultValue" | "onChange" | "size" | "type" | "value"
>;

export type NumericFieldProps = NativeNumericInputProps & {
  value?: number | string;
  defaultValue?: number | string;
  /** The only data channel out of the field: committed, clamped numbers. */
  onValueCommit?: (value: number, text: string) => void;
  numericMode?: "integer" | "decimal" | "weight";
  size?: "chip" | "compact" | "field" | "precision";
  selectOnFocus?: boolean;
  showSteppers?: boolean;
};

const FIELD_LOCALE = "en-US";

function finiteAttributeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseDraft(text: string): number | null {
  const trimmed = text.trim();
  if (
    trimmed === "" ||
    trimmed === "+" ||
    trimmed === "-" ||
    trimmed === "." ||
    trimmed === "+." ||
    trimmed === "-."
  ) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function stepDecimalPlaces(step: number | null): number {
  if (!step || !Number.isFinite(step)) return 0;
  const text = String(step);
  const exponentMatch = text.match(/e-(\d+)$/i);
  if (exponentMatch) return Number(exponentMatch[1]);
  const decimal = text.split(".")[1];
  return decimal ? decimal.length : 0;
}

export function normalizeValue(
  value: number,
  min: number | null,
  max: number | null,
  step: number | null,
  stepWasProvided: boolean
): number {
  let next = value;
  if (min !== null) next = Math.max(min, next);
  if (max !== null) next = Math.min(max, next);
  if (stepWasProvided && step && step > 0) {
    const base = min ?? 0;
    const places = stepDecimalPlaces(step);
    const rounded = base + Math.round((next - base) / step) * step;
    next = Number(rounded.toFixed(Math.min(places + 2, 12)));
    if (min !== null) next = Math.max(min, next);
    if (max !== null) next = Math.min(max, next);
  }
  return next;
}

export function formatNumber(
  value: number,
  step: number | null,
  stepWasProvided: boolean
): string {
  if (!Number.isFinite(value)) return "";
  if (!stepWasProvided || !step || step <= 0) return String(value);
  const places = stepDecimalPlaces(step);
  if (places === 0) return String(Math.round(value));
  return value
    .toFixed(places)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

function resolveNumericMode(
  explicitMode: NumericFieldProps["numericMode"],
  step: NumericFieldProps["step"]
): NonNullable<NumericFieldProps["numericMode"]> {
  if (explicitMode) return explicitMode;
  const parsedStep = step === "any" ? null : finiteAttributeNumber(step);
  if (parsedStep !== null && parsedStep > 0 && parsedStep < 1) {
    return "decimal";
  }
  return "integer";
}

export function resolveNumericFieldBehavior({
  numericMode,
  min,
  max,
  step,
}: {
  numericMode?: NumericFieldProps["numericMode"];
  min?: NumericFieldProps["min"];
  max?: NumericFieldProps["max"];
  step?: NumericFieldProps["step"];
}): {
  mode: NonNullable<NumericFieldProps["numericMode"]>;
  minNumber: number | null;
  maxNumber: number | null;
  stepNumber: number | null;
  stepWasProvided: boolean;
  inputMode: "numeric" | "decimal";
} {
  const mode = resolveNumericMode(numericMode, step);
  const minNumber =
    mode === "weight" && finiteAttributeNumber(min) === null
      ? 0
      : finiteAttributeNumber(min);
  const maxNumber = finiteAttributeNumber(max);
  const parsedStep = step === "any" ? null : finiteAttributeNumber(step);
  const stepNumber = mode === "decimal" ? parsedStep : 1;
  const stepWasProvided = mode !== "decimal" || (step !== undefined && step !== "any");
  return {
    mode,
    minNumber,
    maxNumber,
    stepNumber,
    stepWasProvided,
    inputMode: mode === "decimal" ? "decimal" : "numeric",
  };
}

export function NumericField({
  value,
  defaultValue,
  onValueCommit,
  onBlur,
  onFocus,
  onKeyDown,
  className,
  numericMode,
  min,
  max,
  step,
  disabled,
  size = "field",
  selectOnFocus = true,
  showSteppers = true,
  ...inputProps
}: NumericFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editingRef = useRef(false);
  const focusedOnceRef = useRef(false);
  const controlled = value !== undefined;
  const { mode, minNumber, maxNumber, stepNumber, stepWasProvided, inputMode } =
    resolveNumericFieldBehavior({ numericMode, min, max, step });
  const stepAttribute = stepWasProvided && stepNumber !== null ? stepNumber : step;
  const fractionDigits = stepWasProvided
    ? stepDecimalPlaces(stepNumber)
    : mode === "decimal"
      ? 6
      : 0;

  const externalNumber = controlled ? finiteAttributeNumber(value) : null;
  const defaultNumber = finiteAttributeNumber(defaultValue);
  // Freeze the controlled value during an edit so live external updates
  // (e.g. transport tempo while playing) cannot clobber the user's draft.
  const [frozenValue, setFrozenValue] = useState<number | null>(null);
  const effectiveValue = controlled
    ? frozenValue !== null
      ? frozenValue
      : (externalNumber ?? undefined)
    : undefined;

  const committedNumberRef = useRef<number>(
    externalNumber ?? defaultNumber ?? (minNumber ?? 0)
  );
  const committedTextRef = useRef<string>("");
  const suppressEmitRef = useRef(false);
  // Enter/Escape handle the draft themselves and then blur; React state is
  // asynchronous, so the blur handler must not re-commit the stale draft.
  const skipNextBlurCommitRef = useRef(false);

  const state = useNumberFieldState({
    locale: FIELD_LOCALE,
    value: effectiveValue,
    defaultValue: controlled ? undefined : (defaultNumber ?? undefined),
    minValue: minNumber ?? undefined,
    maxValue: maxNumber ?? undefined,
    step: stepWasProvided && stepNumber && stepNumber > 0 ? stepNumber : undefined,
    formatOptions: {
      useGrouping: false,
      maximumFractionDigits: Math.min(Math.max(fractionDigits, 0), 12),
    },
    onChange: (next: number) => {
      if (suppressEmitRef.current) return;
      if (!Number.isFinite(next)) return; // empty/invalid commits never emit
      const normalized = normalizeValue(
        next,
        minNumber,
        maxNumber,
        stepNumber,
        stepWasProvided
      );
      const text = formatNumber(normalized, stepNumber, stepWasProvided);
      if (normalized === committedNumberRef.current && text === committedTextRef.current) {
        return;
      }
      committedNumberRef.current = normalized;
      committedTextRef.current = text;
      onValueCommit?.(normalized, text);
    },
  });

  // Keep the committed refs in sync when the external value drives the field.
  if (!editingRef.current && externalNumber !== null && frozenValue === null) {
    committedNumberRef.current = externalNumber;
    committedTextRef.current = formatNumber(
      externalNumber,
      stepNumber,
      stepWasProvided
    );
  }

  const committedText = () =>
    committedTextRef.current ||
    formatNumber(committedNumberRef.current, stepNumber, stepWasProvided);

  const revertDraft = () => {
    suppressEmitRef.current = true;
    state.setInputValue(committedText());
    suppressEmitRef.current = false;
  };

  const commitDraft = () => {
    if (parseDraft(state.inputValue) === null) {
      // Empty or partial draft: never commit a fabricated value.
      revertDraft();
      return;
    }
    state.commit();
  };

  const publishDraft = () => {
    const parsed = parseDraft(state.inputValue);
    if (parsed === null) return;
    const normalized = normalizeValue(
      parsed,
      minNumber,
      maxNumber,
      stepNumber,
      stepWasProvided
    );
    const text = formatNumber(normalized, stepNumber, stepWasProvided);
    if (
      normalized === committedNumberRef.current &&
      text === committedTextRef.current
    ) {
      return;
    }
    committedNumberRef.current = normalized;
    committedTextRef.current = text;
    onValueCommit?.(normalized, text);
  };

  useEditorDraftLifecycle({
    // Autosave and owner unmount publish authored meaning without formatting,
    // reverting, or blurring the user's in-progress text.
    flush: () => {
      if (editingRef.current) publishDraft();
    },
    discard: () => {
      if (!editingRef.current) return;
      editingRef.current = false;
      focusedOnceRef.current = false;
      // A same-valued replacement document will not trigger a controlled-value
      // update, so revert the text explicitly and suppress the old edit's blur.
      skipNextBlurCommitRef.current = true;
      revertDraft();
      setFrozenValue(null);
    },
  });

  const stepBy = (direction: 1 | -1, multiplier = 1) => {
    if (disabled) return;
    const parsed = parseDraft(state.inputValue);
    const base = parsed ?? committedNumberRef.current;
    const amount = (stepNumber && stepNumber > 0 ? stepNumber : 1) * multiplier;
    const next = normalizeValue(
      base + direction * amount,
      minNumber,
      maxNumber,
      stepNumber,
      stepWasProvided
    );
    const text = formatNumber(next, stepNumber, stepWasProvided);
    suppressEmitRef.current = true;
    state.setInputValue(text);
    suppressEmitRef.current = false;
    if (next !== committedNumberRef.current || text !== committedTextRef.current) {
      committedNumberRef.current = next;
      committedTextRef.current = text;
      onValueCommit?.(next, text);
    }
  };

  const canStepDown =
    !disabled && (minNumber === null || committedNumberRef.current > minNumber);
  const canStepUp =
    !disabled && (maxNumber === null || committedNumberRef.current < maxNumber);
  const rootClassName = [
    "numeric-field",
    `numeric-field--${size}`,
    `numeric-field--${mode}`,
    showSteppers ? "has-steppers" : "is-solo",
    className,
    disabled ? "is-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const inputClassName = ["numeric-field__input", className].filter(Boolean).join(" ");

  return (
    <span className={rootClassName}>
      <input
        {...inputProps}
        ref={inputRef}
        className={inputClassName}
        data-numeric-mode={mode}
        disabled={disabled}
        inputMode={inputMode}
        max={max}
        min={minNumber ?? min}
        role="spinbutton"
        step={stepAttribute}
        type="text"
        value={state.inputValue}
        aria-valuemax={maxNumber ?? undefined}
        aria-valuemin={minNumber ?? undefined}
        aria-valuenow={parseDraft(state.inputValue) ?? committedNumberRef.current}
        onBlur={(event: FocusEvent<HTMLInputElement>) => {
          editingRef.current = false;
          focusedOnceRef.current = false;
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false;
          } else {
            commitDraft();
          }
          setFrozenValue(null);
          onBlur?.(event);
        }}
        onChange={(event) => {
          editingRef.current = true;
          // Typing after a document swap is a new-document edit and should be
          // allowed to commit normally on its eventual blur.
          skipNextBlurCommitRef.current = false;
          const text = event.currentTarget.value;
          // React Aria's NumberParser rejects text that cannot become a
          // number in this locale (letters, doubled signs, ...). Legal
          // partials ("", "-", "1.") pass.
          if (state.validate(text)) {
            state.setInputValue(text);
          }
        }}
        onFocus={(event) => {
          editingRef.current = true;
          if (controlled && externalNumber !== null) {
            setFrozenValue(externalNumber);
          }
          if (selectOnFocus && !focusedOnceRef.current) {
            event.currentTarget.select();
            focusedOnceRef.current = true;
          }
          onFocus?.(event);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            commitDraft();
            skipNextBlurCommitRef.current = true;
            event.currentTarget.blur();
            event.preventDefault();
          } else if (event.key === "Escape") {
            revertDraft();
            skipNextBlurCommitRef.current = true;
            event.currentTarget.blur();
            event.preventDefault();
          } else if (event.key === "ArrowUp") {
            stepBy(1, event.shiftKey ? 10 : event.altKey ? 0.1 : 1);
            event.preventDefault();
          } else if (event.key === "ArrowDown") {
            stepBy(-1, event.shiftKey ? 10 : event.altKey ? 0.1 : 1);
            event.preventDefault();
          }
          onKeyDown?.(event);
        }}
      />
      {showSteppers && (
        <span className="numeric-field__steppers">
          <button
            aria-label="Increase value"
            type="button"
            tabIndex={-1}
            disabled={!canStepUp}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => stepBy(1)}
          >
            ▲
          </button>
          <button
            aria-label="Decrease value"
            type="button"
            tabIndex={-1}
            disabled={!canStepDown}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => stepBy(-1)}
          >
            ▼
          </button>
        </span>
      )}
    </span>
  );
}
