import { useEffect, useRef, type KeyboardEvent } from "react";

import type { DirectiveTraceEntry, EvolutionDirective } from "../bridge";
import {
  EvolvePlanEditor,
  type EvolutionCachedPreview,
  type EvolutionInheritedOptions,
} from "./EvolvePlanEditor";
import { PanelHeader } from "./MainEditorChrome";

export interface EvolvePlanPanelProps {
  open: boolean;
  generatorKind: "example" | "dumka";
  plan: readonly EvolutionDirective[];
  planLengthCycles: number;
  cycleBeats: number;
  playbackStructureLocked: boolean;
  cachedPreviews?: readonly EvolutionCachedPreview[];
  trace?: readonly DirectiveTraceEntry[];
  inheritedOptions?: EvolutionInheritedOptions;
  onOpenChange: (open: boolean) => void;
  onPlanChange: (plan: EvolutionDirective[]) => void;
  onPlanLengthCyclesChange: (cycles: number) => void;
  onPreviewCycleChange: (cycle: number) => void;
  onAuditionCycle?: (cycle: number, comparison: "before" | "after") => void;
  onVisibleCycleRangeChange?: (fromCycle: number, toCycle: number) => void;
  densityFloor?: number;
  densityCeiling?: number;
}

const DIALOG_FOCUSABLE =
  'summary, button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Full-window shell for the pure evolution-score editor. */
export function EvolvePlanPanel({
  open,
  generatorKind,
  plan,
  planLengthCycles,
  cycleBeats,
  playbackStructureLocked,
  cachedPreviews = [],
  trace = [],
  inheritedOptions,
  onOpenChange,
  onPlanChange,
  onPlanLengthCyclesChange,
  onPreviewCycleChange,
  onAuditionCycle,
  onVisibleCycleRangeChange,
  densityFloor = 0,
  densityCeiling = 100,
}: EvolvePlanPanelProps) {
  const disabled = playbackStructureLocked || generatorKind !== "dumka";
  const dialogRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const priorFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (priorFocus?.isConnected) priorFocus.focus();
    };
  }, [open]);

  const trapFocus = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (!open || !dialogRef.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)
    ).filter((element) => !element.hidden && element.offsetParent !== null);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <details
      ref={dialogRef}
      id="evolve-plan-editor"
      className="modal-surface modal-surface--full editor-panel panel-state panel-state-evolve main-editor-surface"
      role="dialog"
      aria-label="Evolution score editor"
      aria-modal={open}
      tabIndex={-1}
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      onKeyDown={trapFocus}
    >
      <summary
        className="editor-panel-summary"
        role="button"
        aria-label="Evolution score editor"
      >
        <PanelHeader
          icon="evolve"
          title="Evolve"
          subtitle={
            generatorKind === "dumka"
              ? `${plan.length} directive${plan.length === 1 ? "" : "s"} · deterministic cycle score`
              : "Choose the Dum-Ka generator to author a plan"
          }
          strip={[
            { label: "directives", value: String(plan.length) },
            { label: "cycles", value: String(planLengthCycles || "auto") },
          ]}
        />
      </summary>
      {open ? <div className="editor-panel-body">
        {generatorKind !== "dumka" ? (
          <p className="evolve-plan-kind-notice">
            The evolution score belongs to the Dum-Ka generator. Choose Dum-Ka in
            Generator to add pins and ranges.
          </p>
        ) : null}
        <EvolvePlanEditor
          plan={plan}
          planLengthCycles={planLengthCycles}
          totalBeats={cycleBeats}
          disabled={disabled}
          cachedPreviews={cachedPreviews}
          trace={trace}
          inheritedOptions={inheritedOptions}
          onPlanChange={onPlanChange}
          onPlanLengthCyclesChange={onPlanLengthCyclesChange}
          onPreviewCycleChange={onPreviewCycleChange}
          onAuditionCycle={onAuditionCycle}
          onVisibleCycleRangeChange={onVisibleCycleRangeChange}
          densityFloor={densityFloor}
          densityCeiling={densityCeiling}
        />
      </div> : null}
    </details>
  );
}
