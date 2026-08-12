/**
 * Focused automation quick-edit modal for a single target.
 * Extracted from App.tsx (carve-up round 21) along the panel seam — all
 * state stays in App and arrives via props with their original names (types
 * compiler-generated via scripts/carve/typegen.cjs); the JSX body is
 * unchanged.
 */
import {
  AutomationFocusPanel,
  AutomationTargetDef,
  automationKindLabel,
} from "../automationTargets";
import {
  ModalFrame,
  ModalHeader,
} from "./ModalChrome";

export interface AutomationFocusModalProps {
  automatedTargetIds: Set<string>;
  automationFocusPanel: AutomationFocusPanel | null;
  openAutomationTarget: (target: string) => void;
  playbackStructureLocked: boolean;
  selectedAutomationFocusTargets: AutomationTargetDef[];
  setAutomationFocusPanel: React.Dispatch<React.SetStateAction<AutomationFocusPanel | null>>;
}

export function AutomationFocusModal({
  automatedTargetIds,
  automationFocusPanel,
  openAutomationTarget,
  playbackStructureLocked,
  selectedAutomationFocusTargets,
  setAutomationFocusPanel,
}: AutomationFocusModalProps) {
  return (
      <ModalFrame
        open={Boolean(automationFocusPanel)}
        onClose={() => setAutomationFocusPanel(null)}
        ariaLabelledby="automation-focus-title"
        className="automation-focus-backdrop"
        dataAutomationPickControl
        layer="top"
        placement="top"
        size="compact"
        surfaceClassName="automation-focus-modal"
      >
        {({ close }) =>
          automationFocusPanel ? (
            <>
              <ModalHeader
                className="automation-focus-modal-head"
                title={automationFocusPanel.title}
                titleId="automation-focus-title"
                eyebrow={`${selectedAutomationFocusTargets.length} automation lane${
                  selectedAutomationFocusTargets.length === 1 ? "" : "s"
                }`}
                closeLabel="Close automation lane shortlist"
                onClose={close}
              />
            <div className="automation-focus-target-list">
              {selectedAutomationFocusTargets.map((def) => {
                const active = automatedTargetIds.has(def.target);
                return (
                  <button
                    className={`automation-focus-target${active ? " is-active" : ""}`}
                    key={def.target}
                    type="button"
                    disabled={playbackStructureLocked}
                    onClick={() => {
                      openAutomationTarget(def.target);
                      close();
                    }}
                  >
                    <span>
                      <strong>{def.label}</strong>
                      <em>
                        {def.group} · {automationKindLabel(def.valueKind)}
                      </em>
                    </span>
                    <b>{active ? "open" : "add"}</b>
                  </button>
                );
              })}
            </div>
            </>
          ) : null
        }
      </ModalFrame>
  );
}
