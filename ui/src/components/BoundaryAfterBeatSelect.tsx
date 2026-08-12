import {
  boundaryPositionOptions,
} from "../sectionsSubdivisionsLogic";

export function BoundaryAfterBeatSelect({
  cycleBeats,
  boundaries,
  value,
  disabled = false,
  ariaLabel = "Boundary after beat",
  onChange,
}: {
  cycleBeats: number;
  boundaries: Array<{ afterBeat: number }>;
  value: number;
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (afterBeat: number) => void;
}) {
  const roundedValue = Math.round(value);
  const options = boundaryPositionOptions(cycleBeats, boundaries, roundedValue);
  const selectOptions = options.includes(roundedValue)
    ? options
    : [roundedValue, ...options].sort((a, b) => a - b);

  return (
    <select
      className="boundary-after-beat-select"
      aria-label={ariaLabel}
      disabled={disabled || selectOptions.length <= 1}
      value={roundedValue}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {selectOptions.map((afterBeat) => (
        <option key={afterBeat} value={afterBeat}>
          {afterBeat}
        </option>
      ))}
    </select>
  );
}
