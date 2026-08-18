/**
 * Shared modal chrome: frame, header, dismiss backdrop, and the floating
 * close button. Extracted verbatim from App.tsx (carve-up round 1) — every
 * dialog in the app renders inside these.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type FloatingWindowCloseButtonProps = {
  label: string;
  onClick: () => void;
};

export function FloatingWindowCloseButton({
  label,
  onClick,
}: FloatingWindowCloseButtonProps) {
  return (
    <button
      className="floating-window-close"
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}

export const MODAL_TRANSITION_MS = 160;

export type ModalLayer = "main" | "utility" | "nested" | "top";
export type ModalPlacement = "center" | "top";
export type ModalSize = "compact" | "standard" | "wide" | "full";

export type ModalFrameControls = {
  close: () => void;
};

type ModalFrameProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode | ((controls: ModalFrameControls) => ReactNode);
  ariaLabel?: string;
  ariaLabelledby?: string;
  className?: string;
  dataAutomationPickControl?: boolean;
  layer?: ModalLayer;
  placement?: ModalPlacement;
  size?: ModalSize;
  surfaceClassName?: string;
};

export function ModalFrame({
  open,
  onClose,
  children,
  ariaLabel,
  ariaLabelledby,
  className = "",
  dataAutomationPickControl = false,
  layer = "utility",
  placement = "center",
  size = "standard",
  surfaceClassName = "",
}: ModalFrameProps) {
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setClosing(false);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    }
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setClosing(false);
      onClose();
    }, MODAL_TRANSITION_MS);
  }, [closing, onClose]);

  // Escape closes the dialog (the shared utility-dialog contract). A field
  // that consumed Escape to cancel its draft calls preventDefault first, so
  // one press cancels the draft and the next closes the dialog; with stacked
  // modals only the topmost open frame responds, unwinding one at a time.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const frames = document.querySelectorAll(".modal-backdrop.is-open");
      if (frames.length === 0) return;
      if (frames[frames.length - 1] !== backdropRef.current) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  if (!open && !closing) return null;

  return (
    <div
      ref={backdropRef}
      className={`modal-backdrop modal-backdrop--${layer} modal-backdrop--${placement}${
        closing ? " is-closing" : " is-open"
      }${className ? ` ${className}` : ""}`}
      data-automation-pick-control={dataAutomationPickControl ? "true" : undefined}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <section
        className={`modal-surface modal-surface--${size}${
          closing ? " is-closing" : " is-open"
        }${surfaceClassName ? ` ${surfaceClassName}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {typeof children === "function" ? children({ close }) : children}
      </section>
    </div>
  );
}

type ModalHeaderProps = {
  title: ReactNode;
  closeLabel: string;
  onClose: () => void;
  className?: string;
  eyebrow?: ReactNode;
  titleId?: string;
};

export function ModalHeader({
  title,
  closeLabel,
  onClose,
  className = "",
  eyebrow,
  titleId,
}: ModalHeaderProps) {
  return (
    <div className={`modal-head${className ? ` ${className}` : ""}`}>
      <div>
        <h3 id={titleId}>{title}</h3>
        {eyebrow && <span>{eyebrow}</span>}
      </div>
      <FloatingWindowCloseButton label={closeLabel} onClick={onClose} />
    </div>
  );
}

type ModalDismissBackdropProps = {
  label: string;
  onClose: () => void;
  className?: string;
  layer?: ModalLayer;
};

export function ModalDismissBackdrop({
  label,
  onClose,
  className = "",
  layer = "main",
}: ModalDismissBackdropProps) {
  return (
    <button
      className={`modal-backdrop modal-backdrop-button modal-backdrop--${layer}${
        className ? ` ${className}` : ""
      }`}
      type="button"
      aria-label={label}
      onClick={onClose}
    />
  );
}
