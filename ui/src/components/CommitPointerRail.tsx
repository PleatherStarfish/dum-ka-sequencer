import {
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useDiscardEditorDraft } from "../editorDraftFlush";

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "children"
  | "onKeyDown"
  | "onLostPointerCapture"
  | "onPointerCancel"
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "style"
  | "type"
>;

export interface CommitPointerRailProps extends NativeButtonProps {
  value: number;
  max?: number;
  step?: number;
  onValueCommit: (value: number) => void;
  children: (displayValue: number) => ReactNode;
  style?: CSSProperties;
}

type ActiveRailGesture = {
  pointerId: number;
  rect: DOMRect;
  origin: number;
  latest: number;
};

export function railValueFromClientX(
  clientX: number,
  rect: Pick<DOMRect, "left" | "width">,
  max: number,
  step: number
): number {
  if (rect.width <= 0 || max <= 0) return 0;
  const raw = ((clientX - rect.left) / rect.width) * max;
  const quantized = Math.round(raw / step) * step;
  return Math.min(Math.max(quantized, 0), max);
}

/**
 * Custom probability rail with slider-like interaction semantics: pointer
 * movement is local, geometry is read once, and semantic state commits once
 * when the gesture ends. It stays a button so existing rail CSS and automation
 * targeting remain intact.
 */
export function CommitPointerRail({
  value,
  max = 100,
  step = 5,
  onValueCommit,
  children,
  style,
  disabled,
  ...buttonProps
}: CommitPointerRailProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const activeRef = useRef<ActiveRailGesture | null>(null);
  const committed = Math.min(Math.max(value, 0), Math.max(0, max));
  const displayed = draft ?? committed;

  const clear = () => {
    activeRef.current = null;
    setDraft(null);
  };

  useDiscardEditorDraft(clear);

  const finish = (pointerId: number, commit: boolean, final?: number) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== pointerId) return;
    const next = final ?? active.latest;
    clear();
    if (commit && next !== active.origin) onValueCommit(next);
  };

  const commitKeyboardValue = (
    event: KeyboardEvent<HTMLButtonElement>,
    next: number
  ) => {
    event.preventDefault();
    const normalized = Math.min(Math.max(next, 0), Math.max(0, max));
    if (normalized !== committed) onValueCommit(normalized);
  };

  return (
    <button
      {...buttonProps}
      type="button"
      disabled={disabled}
      style={
        {
          ...style,
          "--rail-value": `${max > 0 ? (displayed / max) * 100 : 0}%`,
        } as CSSProperties
      }
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const next = railValueFromClientX(event.clientX, rect, max, step);
        activeRef.current = {
          pointerId: event.pointerId,
          rect,
          origin: committed,
          latest: next,
        };
        setDraft(next);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event: PointerEvent<HTMLButtonElement>) => {
        const active = activeRef.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const next = railValueFromClientX(event.clientX, active.rect, max, step);
        if (next === active.latest) return;
        active.latest = next;
        setDraft(next);
      }}
      onPointerUp={(event: PointerEvent<HTMLButtonElement>) => {
        const active = activeRef.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const next = railValueFromClientX(event.clientX, active.rect, max, step);
        finish(event.pointerId, true, next);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={(event: PointerEvent<HTMLButtonElement>) =>
        finish(event.pointerId, false)
      }
      onLostPointerCapture={(event: PointerEvent<HTMLButtonElement>) =>
        finish(event.pointerId, true)
      }
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        const multiplier = event.shiftKey ? 10 : 1;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          commitKeyboardValue(event, committed - step * multiplier);
        } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          commitKeyboardValue(event, committed + step * multiplier);
        } else if (event.key === "Home") {
          commitKeyboardValue(event, 0);
        } else if (event.key === "End") {
          commitKeyboardValue(event, max);
        }
      }}
    >
      {children(displayed)}
    </button>
  );
}
