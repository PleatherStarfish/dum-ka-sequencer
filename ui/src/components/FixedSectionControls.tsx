import { NumericField } from "../NumericField";
import { JATHI_VALUES, isValidGroupingChoice } from "../sectionsSubdivisionsLogic";

export interface FixedSectionControlsProps {
  subdivision: number;
  grouping: number | null;
  disabled?: boolean;
  totalMatras?: number;
  timingGrid?: number;
  onSubdivisionChange: (subdivision: number) => void;
  onGroupingChange: (grouping: number | null) => void;
}

export function FixedSectionControls({
  subdivision,
  grouping,
  disabled = false,
  totalMatras,
  timingGrid,
  onSubdivisionChange,
  onGroupingChange,
}: FixedSectionControlsProps) {
  const groupingChoices = JATHI_VALUES.filter((choice) =>
    isValidGroupingChoice(choice, totalMatras, timingGrid)
  );

  return (
    <div className="fixed-section-controls" aria-label="Section subdivision and grouping">
      <label>
        <span>Subdivision</span>
        <NumericField
          aria-label="Subdivision"
          min={1}
          max={64}
          step={1}
          value={subdivision}
          disabled={disabled}
          onValueCommit={(value) => onSubdivisionChange(value)}
        />
        <em>pulses per beat</em>
      </label>
      <label>
        <span>Grouping</span>
        <select
          aria-label="Grouping"
          value={grouping ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onGroupingChange(
              event.currentTarget.value === ""
                ? null
                : Number(event.currentTarget.value)
            )
          }
        >
          <option value="">None</option>
          {groupingChoices.map((choice) => (
            <option value={choice} key={choice}>
              {choice}
            </option>
          ))}
        </select>
        <em>optional accent cycle</em>
      </label>
    </div>
  );
}
