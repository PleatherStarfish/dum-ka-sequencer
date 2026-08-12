/**
 * SliderField — the portable one-thumb slider used by ordinary app controls.
 *
 * Like NumericField, this keeps the call-site contract local and explicit:
 * callers may keep using native range-style props and `onChange(event)`, while
 * React Aria/Stately provide the slider state, keyboard behavior, track
 * dragging, and accessible range input.
 */
import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useSlider, useSliderThumb } from "@react-aria/slider";
import { useSliderState } from "@react-stately/slider";
import { useDiscardEditorDraft } from "./editorDraftFlush";

type NativeRangeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type">;

export type SliderRailSize = "compact" | "standard" | "precision" | "full";
export type SliderVisualMode = "basic" | "native-overlay";

export type SliderFieldProps = NativeRangeProps & {
  railSize?: SliderRailSize;
  visualMode?: SliderVisualMode;
  /**
   * Pointer gestures draft locally and call `onChange` once on release by
   * default. Opt into the old pointer-rate callback behavior only for controls
   * whose consumer is intentionally cheap and needs continuous updates.
   */
  changeMode?: "commit" | "continuous";
  showRange?: boolean;
  showValue?: boolean;
  rangeLabel?: string;
  valueLabel?: string;
  onChangeEnd?: (value: number) => void;
  /** Called with the gesture origin when a pointer draft is cancelled. */
  onChangeCancel?: (originValue: number) => void;
};

type SliderFieldBehavior = {
  minValue: number;
  maxValue: number;
  stepValue: number;
  valueNumber: number | undefined;
  defaultValueNumber: number | undefined;
  fractionDigits: number;
};

const FIELD_LOCALE = "en-US";

const RAIL_LENGTHS: Record<
  SliderRailSize,
  { min: number; ideal: number; max: number }
> = {
  compact: { min: 120, ideal: 144, max: 160 },
  standard: { min: 180, ideal: 220, max: 260 },
  precision: { min: 240, ideal: 300, max: 360 },
  full: { min: 180, ideal: 320, max: 420 },
};

function finiteAttributeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stepDecimalPlaces(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const exponentMatch = text.match(/e-(\d+)$/i);
  if (exponentMatch) return Number(exponentMatch[1]);
  const decimal = text.split(".")[1];
  return decimal ? decimal.length : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function preventWrappingLabelActivation(event: MouseEvent<HTMLSpanElement>) {
  event.preventDefault();
}

export function resolveSliderFieldBehavior({
  min,
  max,
  step,
  value,
  defaultValue,
}: Pick<SliderFieldProps, "defaultValue" | "max" | "min" | "step" | "value">): SliderFieldBehavior {
  const parsedMin = finiteAttributeNumber(min);
  const parsedMax = finiteAttributeNumber(max);
  const minValue = parsedMin ?? 0;
  const maxValue = parsedMax !== null && parsedMax >= minValue ? parsedMax : 100;
  const parsedStep = step === "any" ? null : finiteAttributeNumber(step);
  const stepValue = parsedStep !== null && parsedStep > 0 ? parsedStep : 1;
  const valueNumber = finiteAttributeNumber(value);
  const defaultValueNumber = finiteAttributeNumber(defaultValue);

  return {
    minValue,
    maxValue,
    stepValue,
    valueNumber:
      valueNumber === null ? undefined : clamp(valueNumber, minValue, maxValue),
    defaultValueNumber:
      defaultValueNumber === null
        ? undefined
        : clamp(defaultValueNumber, minValue, maxValue),
    fractionDigits: stepDecimalPlaces(stepValue),
  };
}

function sliderChangeEvent(value: number): ChangeEvent<HTMLInputElement> {
  const target = {
    value: String(value),
    valueAsNumber: value,
  } as HTMLInputElement;
  return {
    target,
    currentTarget: target,
  } as ChangeEvent<HTMLInputElement>;
}

function sliderInputEvent(value: number): FormEvent<HTMLInputElement> {
  return sliderChangeEvent(value) as unknown as FormEvent<HTMLInputElement>;
}

function finiteSliderEventValue(
  event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>
): number | null {
  const value = event.currentTarget.valueAsNumber;
  if (Number.isFinite(value)) return value;
  const parsed = Number(event.currentTarget.value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function SliderField({
  visualMode = "basic",
  ...props
}: SliderFieldProps) {
  if (visualMode === "native-overlay") {
    return <NativeOverlaySliderField {...props} visualMode={visualMode} />;
  }
  return <ReactAriaSliderField {...props} visualMode={visualMode} />;
}

function NativeOverlaySliderField({
  className,
  railSize = "standard",
  visualMode: _visualMode,
  changeMode = "commit",
  showRange: _showRange,
  showValue: _showValue,
  rangeLabel: _rangeLabel,
  valueLabel: _valueLabel,
  onChange,
  onChangeEnd,
  onChangeCancel,
  onInput,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onBlur,
  value,
  defaultValue,
  min,
  max,
  step,
  style,
  title,
  disabled,
  ...inputProps
}: SliderFieldProps) {
  const {
    minValue,
    maxValue,
    valueNumber,
    defaultValueNumber,
  } = resolveSliderFieldBehavior({ defaultValue, max, min, step, value });
  const controlled = valueNumber !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValueNumber ?? minValue
  );
  const [draftValue, setDraftValue] = useState<number | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const discardedPointerRef = useRef<number | null>(null);
  const originValueRef = useRef(valueNumber ?? uncontrolledValue);
  const latestValueRef = useRef(valueNumber ?? uncontrolledValue);
  const lastEmittedValueRef = useRef<number | null>(null);
  const committedValue = valueNumber ?? uncontrolledValue;
  const displayedValue = draftValue ?? committedValue;

  const emitChange = (next: number) => {
    if (lastEmittedValueRef.current === next) return;
    lastEmittedValueRef.current = next;
    onChange?.(sliderChangeEvent(next));
    onInput?.(sliderInputEvent(next));
  };

  const stageValue = (next: number) => {
    const normalized = clamp(next, minValue, maxValue);
    if (latestValueRef.current !== normalized || draftValue === null) {
      latestValueRef.current = normalized;
      setDraftValue(normalized);
    }
    if (
      changeMode === "continuous" &&
      lastEmittedValueRef.current !== normalized
    ) {
      lastEmittedValueRef.current = normalized;
      onChange?.(sliderChangeEvent(normalized));
    }
  };

  const finishPointer = (pointerId: number, commit: boolean) => {
    if (discardedPointerRef.current === pointerId) {
      discardedPointerRef.current = null;
      setDraftValue(null);
      lastEmittedValueRef.current = null;
      return;
    }
    if (activePointerRef.current !== pointerId) return;
    activePointerRef.current = null;
    const origin = originValueRef.current;
    const final = latestValueRef.current;
    if (commit && final !== origin) {
      if (changeMode === "commit") emitChange(final);
      if (!controlled) setUncontrolledValue(final);
      onChangeEnd?.(final);
    } else if (!commit) {
      onChangeCancel?.(origin);
    }
    setDraftValue(null);
    lastEmittedValueRef.current = null;
  };

  const handleNativeChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (discardedPointerRef.current !== null) return;
    const next = finiteSliderEventValue(event);
    if (next === null) return;
    if (activePointerRef.current !== null) {
      stageValue(next);
      return;
    }
    const normalized = clamp(next, minValue, maxValue);
    if (!controlled) setUncontrolledValue(normalized);
    onChange?.(event);
    if (changeMode === "commit") onInput?.(sliderInputEvent(normalized));
    onChangeEnd?.(normalized);
  };

  useDiscardEditorDraft(() => {
    const pointerId = activePointerRef.current;
    if (pointerId === null) return;
    const origin = originValueRef.current;
    discardedPointerRef.current = pointerId;
    activePointerRef.current = null;
    originValueRef.current = committedValue;
    latestValueRef.current = committedValue;
    lastEmittedValueRef.current = null;
    setDraftValue(null);
    onChangeCancel?.(origin);
  });

  const rail = RAIL_LENGTHS[railSize];
  const rootStyle = {
    "--slider-rail-min": `${rail.min}px`,
    "--slider-rail-ideal": `${rail.ideal}px`,
    "--slider-rail-max": `${rail.max}px`,
    ...style,
  } as CSSProperties;
  const rootClassName = [
    "slider-field",
    "slider-field--native-overlay",
    `slider-field--${railSize}`,
    disabled ? "is-disabled" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={rootClassName}
      data-automation-pick-control="true"
      style={rootStyle}
      title={title}
    >
      <input
        {...inputProps}
        className="slider-field__native-range"
        data-slider-rail-size={railSize}
        disabled={disabled}
        min={minValue}
        max={maxValue}
        step={step}
        type="range"
        value={displayedValue}
        onChange={handleNativeChange}
        onInput={(event) => {
          if (
            changeMode === "continuous" &&
            discardedPointerRef.current === null
          ) {
            onInput?.(event);
          }
        }}
        onPointerDown={(event: PointerEvent<HTMLInputElement>) => {
          onPointerDown?.(event);
          if (disabled || event.defaultPrevented || event.button !== 0) return;
          discardedPointerRef.current = null;
          activePointerRef.current = event.pointerId;
          originValueRef.current = committedValue;
          latestValueRef.current = committedValue;
          lastEmittedValueRef.current = null;
          setDraftValue(committedValue);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerUp={(event: PointerEvent<HTMLInputElement>) => {
          onPointerUp?.(event);
          finishPointer(event.pointerId, true);
        }}
        onPointerCancel={(event: PointerEvent<HTMLInputElement>) => {
          onPointerCancel?.(event);
          finishPointer(event.pointerId, false);
        }}
        onLostPointerCapture={(event: PointerEvent<HTMLInputElement>) => {
          onLostPointerCapture?.(event);
          finishPointer(event.pointerId, true);
        }}
        onBlur={(event: FocusEvent<HTMLInputElement>) => {
          if (discardedPointerRef.current !== null) {
            discardedPointerRef.current = null;
            setDraftValue(null);
            lastEmittedValueRef.current = null;
          } else if (activePointerRef.current !== null) {
            finishPointer(activePointerRef.current, true);
          }
          onBlur?.(event);
        }}
      />
    </span>
  );
}

function ReactAriaSliderField({
  className,
  railSize = "standard",
  visualMode: _visualMode,
  changeMode = "commit",
  showRange = false,
  showValue = false,
  rangeLabel,
  valueLabel,
  min,
  max,
  step,
  value,
  defaultValue,
  disabled,
  onChange,
  onChangeEnd,
  onChangeCancel,
  onInput,
  onBlur,
  onFocus,
  onKeyDown,
  style,
  title,
  id,
  name,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...inputProps
}: SliderFieldProps) {
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const {
    minValue,
    maxValue,
    stepValue,
    valueNumber,
    defaultValueNumber,
    fractionDigits,
  } = resolveSliderFieldBehavior({ defaultValue, max, min, step, value });
  const controlled = valueNumber !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValueNumber ?? minValue
  );
  const [draftValue, setDraftValue] = useState<number | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const discardedPointerRef = useRef<number | null>(null);
  const originValueRef = useRef(valueNumber ?? uncontrolledValue);
  const latestValueRef = useRef(valueNumber ?? uncontrolledValue);
  const lastEmittedValueRef = useRef<number | null>(null);
  const committedValue = valueNumber ?? uncontrolledValue;
  const displayedValue = draftValue ?? committedValue;
  const rail = RAIL_LENGTHS[railSize];
  const hasExplicitAriaLabel = Boolean(ariaLabel || ariaLabelledBy);
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(FIELD_LOCALE, {
        maximumFractionDigits: Math.min(Math.max(fractionDigits, 0), 12),
        useGrouping: false,
      }),
    [fractionDigits]
  );

  const sliderProps = {
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    isDisabled: disabled,
    label: hasExplicitAriaLabel ? undefined : "Slider",
    maxValue,
    minValue,
    step: stepValue,
    value: displayedValue,
    onChange: (nextValue: number | number[]) => {
      if (discardedPointerRef.current !== null) return;
      const next = Array.isArray(nextValue) ? nextValue[0] : nextValue;
      if (typeof next === "number" && Number.isFinite(next)) {
        const normalized = clamp(next, minValue, maxValue);
        latestValueRef.current = normalized;
        if (activePointerRef.current !== null) {
          setDraftValue(normalized);
          if (
            changeMode === "continuous" &&
            lastEmittedValueRef.current !== normalized
          ) {
            lastEmittedValueRef.current = normalized;
            onChange?.(sliderChangeEvent(normalized));
            onInput?.(sliderInputEvent(normalized));
          }
          return;
        }
        if (!controlled) setUncontrolledValue(normalized);
        onChange?.(sliderChangeEvent(normalized));
        onInput?.(sliderInputEvent(normalized));
        onChangeEnd?.(normalized);
      }
    },
  };
  const state = useSliderState({
    ...sliderProps,
    numberFormatter: formatter,
  });
  const { groupProps, trackProps } = useSlider(sliderProps, state, trackRef);
  const {
    inputProps: thumbInputProps,
    isDragging,
    isFocused,
    thumbProps,
  } = useSliderThumb(
    {
      id,
      index: 0,
      inputRef,
      isDisabled: disabled,
      name,
      trackRef,
    },
    state
  );
  const percent = clamp(state.getThumbPercent(0), 0, 1);
  const hasReadout = showValue || showRange;
  const readoutValue = valueLabel ?? state.getThumbValueLabel(0);
  const readoutRange =
    rangeLabel ?? `${formatter.format(minValue)}-${formatter.format(maxValue)}`;
  const thumbAriaLabelledBy = hasExplicitAriaLabel
    ? thumbInputProps["aria-labelledby"]
    : undefined;
  const rootStyle = {
    "--slider-rail-min": `${rail.min}px`,
    "--slider-rail-ideal": `${rail.ideal}px`,
    "--slider-rail-max": `${rail.max}px`,
    ...style,
  } as CSSProperties;
  const rootClassName = [
    "slider-field",
    `slider-field--${railSize}`,
    disabled ? "is-disabled" : "",
    isDragging ? "is-dragging" : "",
    isFocused ? "is-focused" : "",
    hasReadout ? "has-readout" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const finishPointer = (pointerId: number, commit: boolean) => {
    if (discardedPointerRef.current === pointerId) {
      discardedPointerRef.current = null;
      setDraftValue(null);
      lastEmittedValueRef.current = null;
      return;
    }
    if (activePointerRef.current !== pointerId) return;
    activePointerRef.current = null;
    const origin = originValueRef.current;
    const final = latestValueRef.current;
    if (commit && final !== origin) {
      if (changeMode === "commit") {
        onChange?.(sliderChangeEvent(final));
        onInput?.(sliderInputEvent(final));
      }
      if (!controlled) setUncontrolledValue(final);
      onChangeEnd?.(final);
    } else if (!commit) {
      onChangeCancel?.(origin);
    }
    setDraftValue(null);
    lastEmittedValueRef.current = null;
  };

  useDiscardEditorDraft(() => {
    const pointerId = activePointerRef.current;
    if (pointerId === null) return;
    const origin = originValueRef.current;
    discardedPointerRef.current = pointerId;
    activePointerRef.current = null;
    originValueRef.current = committedValue;
    latestValueRef.current = committedValue;
    lastEmittedValueRef.current = null;
    setDraftValue(null);
    onChangeCancel?.(origin);
  });

  return (
    <span
      {...groupProps}
      className={rootClassName}
      data-automation-pick-control="true"
      onClick={preventWrappingLabelActivation}
      onPointerDownCapture={(event: PointerEvent<HTMLSpanElement>) => {
        if (disabled || event.button !== 0) return;
        discardedPointerRef.current = null;
        activePointerRef.current = event.pointerId;
        originValueRef.current = committedValue;
        latestValueRef.current = committedValue;
        lastEmittedValueRef.current = null;
        setDraftValue(committedValue);
      }}
      onPointerUp={(event: PointerEvent<HTMLSpanElement>) =>
        finishPointer(event.pointerId, true)
      }
      onPointerCancel={(event: PointerEvent<HTMLSpanElement>) =>
        finishPointer(event.pointerId, false)
      }
      onLostPointerCapture={(event: PointerEvent<HTMLSpanElement>) =>
        finishPointer(event.pointerId, true)
      }
      style={rootStyle}
      title={title}
    >
      <span
        {...trackProps}
        ref={trackRef}
        className="slider-field__track"
      >
        <span
          aria-hidden="true"
          className="slider-field__fill"
          style={{ width: `${percent * 100}%` }}
        />
        <span
          {...thumbProps}
          className="slider-field__thumb"
          style={{ left: `${percent * 100}%` }}
        >
          <input
            {...inputProps}
            {...thumbInputProps}
            ref={inputRef}
            className="slider-field__range"
            aria-labelledby={thumbAriaLabelledBy}
            data-slider-rail-size={railSize}
            disabled={disabled}
            onBlur={(event: FocusEvent<HTMLInputElement>) => {
              thumbInputProps.onBlur?.(event);
              if (discardedPointerRef.current !== null) {
                discardedPointerRef.current = null;
                setDraftValue(null);
                lastEmittedValueRef.current = null;
              } else if (activePointerRef.current !== null) {
                finishPointer(activePointerRef.current, true);
              }
              onBlur?.(event);
            }}
            onFocus={(event: FocusEvent<HTMLInputElement>) => {
              thumbInputProps.onFocus?.(event);
              onFocus?.(event);
            }}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              thumbInputProps.onKeyDown?.(event);
              onKeyDown?.(event);
            }}
          />
        </span>
      </span>
      {hasReadout && (
        <span className="slider-field__readout" aria-hidden="true">
          {showValue && (
            <output className="slider-field__value">{readoutValue}</output>
          )}
          {showRange && (
            <span className="slider-field__range-label">{readoutRange}</span>
          )}
        </span>
      )}
    </span>
  );
}
