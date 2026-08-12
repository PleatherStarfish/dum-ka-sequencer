/**
 * Velocity accent range math and controls: center/margin conversion,
 * combined ranges, the accent control, and the routing guide. Extracted
 * verbatim from App.tsx (carve-up round 8).
 */
import {
  NumericField,
} from "../NumericField";
import {
  SliderField,
} from "../SliderField";
import {
  clamp,
  cleanAccentRange,
} from "../patchIo";
import {
  ReactNode,
} from "react";
export function accentRangeCenter(min: number, max: number): number {
  const range = cleanAccentRange(min, max);
  return clamp(Math.round((range.min + range.max) / 2), 0, 127);
}

export function accentRangeMargin(min: number, max: number): number {
  const range = cleanAccentRange(min, max);
  return clamp(Math.ceil((range.max - range.min) / 2), 0, 64);
}

export function accentRangeFromCenterMargin(
  center: number,
  margin: number
): { min: number; max: number } {
  const cleanCenter = clamp(Math.round(center || 0), 0, 127);
  const cleanMargin = clamp(Math.round(margin || 0), 0, 64);
  const width = Math.min(127, cleanMargin * 2);
  const start = clamp(
    Math.round(cleanCenter - width / 2),
    0,
    127 - width
  );
  return cleanAccentRange(start, start + width);
}

export function absoluteVelocityRange(
  baseVelocity: number,
  minAccent: number,
  maxAccent: number
): { min: number; max: number } {
  const range = cleanAccentRange(minAccent, maxAccent);
  return {
    min: clamp(Math.round(baseVelocity + range.min), 1, 127),
    max: clamp(Math.round(baseVelocity + range.max), 1, 127),
  };
}

export function combinedVelocityRange(
  baseVelocity: number,
  ranges: Array<{ min: number; max: number }>
): { min: number; max: number } {
  return ranges.reduce(
    (acc, range) => ({
      min: clamp(acc.min + Math.min(range.min, range.max), 1, 127),
      max: clamp(acc.max + Math.max(range.min, range.max), 1, 127),
    }),
    { min: clamp(Math.round(baseVelocity), 1, 127), max: clamp(Math.round(baseVelocity), 1, 127) }
  );
}

export function velocityRangeLabel(range: { min: number; max: number }): string {
  return range.min === range.max ? String(range.min) : `${range.min}-${range.max}`;
}

export function VelocityAccentControl({
  label,
  min,
  max,
  minAutomationTarget,
  maxAutomationTarget,
  automationFocusButton,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  minAutomationTarget?: string;
  maxAutomationTarget?: string;
  automationFocusButton?: ReactNode;
  onChange: (next: { min: number; max: number }) => void;
}) {
  const range = cleanAccentRange(min, max);
  const center = accentRangeCenter(min, max);
  const margin = accentRangeMargin(min, max);
  const centerMin = margin >= 64 ? 64 : margin;
  const centerMax = margin >= 64 ? 64 : 127 - margin;
  const left = (range.min / 127) * 100;
  const width = ((range.max - range.min) / 127) * 100;
  const centerLeft = (center / 127) * 100;

  return (
    <div className="velocity-accent-control">
      <div className="velocity-accent-head">
        <strong>{label}</strong>
        {automationFocusButton}
        <em>
          +{range.min}..+{range.max}
        </em>
      </div>
      <div className="velocity-accent-rail">
        <span
          className="velocity-accent-fill"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        <span
          className="velocity-accent-center"
          style={{ left: `${centerLeft}%` }}
        />
        <SliderField
          min={centerMin}
          max={centerMax}
          value={center}
          aria-label={`${label} accent center`}
          data-automation-target={minAutomationTarget}
          visualMode="native-overlay"
          onChange={(e) =>
            onChange(
              accentRangeFromCenterMargin(parseInt(e.target.value, 10), margin)
            )
          }
        />
      </div>
      <label className="velocity-margin-field">
        <NumericField
          min={0}
          max={64}
          value={margin}
          aria-label={`${label} random margin`}
          data-automation-target={maxAutomationTarget}
          onValueCommit={(value) =>
            onChange(
              accentRangeFromCenterMargin(
                center,
                clamp(value, 0, 64)
              )
            )
          }
        />
      </label>
    </div>
  );
}

export function AccentRoutingVelocityGuide({
  baseVelocity,
  sectionAccentMin,
  sectionAccentMax,
  beatAccentMin,
  beatAccentMax,
  jathiAccentMin,
  jathiAccentMax,
  jathiAccentMode,
  onEditBaseVelocity,
  onEditAccentRanges,
}: {
  baseVelocity: number;
  sectionAccentMin: number;
  sectionAccentMax: number;
  beatAccentMin: number;
  beatAccentMax: number;
  jathiAccentMin: number;
  jathiAccentMax: number;
  jathiAccentMode: "overrideGati" | "layered";
  onEditBaseVelocity: () => void;
  onEditAccentRanges: () => void;
}) {
  const sectionRange = cleanAccentRange(sectionAccentMin, sectionAccentMax);
  const beatRange = cleanAccentRange(beatAccentMin, beatAccentMax);
  const jathiRange = cleanAccentRange(jathiAccentMin, jathiAccentMax);
  const baseBand = { min: baseVelocity, max: baseVelocity };
  const gatiBand = absoluteVelocityRange(baseVelocity, beatRange.min, beatRange.max);
  const jathiBand = absoluteVelocityRange(baseVelocity, jathiRange.min, jathiRange.max);
  const sectionGatiBand = combinedVelocityRange(baseVelocity, [
    sectionRange,
    beatRange,
  ]);
  const sectionJathiBand = combinedVelocityRange(
    baseVelocity,
    jathiAccentMode === "layered"
      ? [sectionRange, beatRange, jathiRange]
      : [sectionRange, jathiRange]
  );
  const jathiModeLabel =
    jathiAccentMode === "layered"
      ? "layers with subdivision"
      : "overrides subdivision";

  return (
    <section className="channel-accent-reference" aria-label="Accent routing velocity guide">
      <div className="channel-accent-reference-head">
        <div>
          <strong>Routing velocity bands</strong>
          <span>
            Read-only guide. The rules below match final MIDI velocity after the
            score and accent settings are applied.
          </span>
        </div>
        <div className="channel-accent-reference-actions">
          <button className="tiny-button" type="button" onClick={onEditBaseVelocity}>
            edit base
          </button>
          <button className="tiny-button" type="button" onClick={onEditAccentRanges}>
            edit accents
          </button>
        </div>
      </div>

      <div className="channel-accent-band-strip" aria-label="Current accent velocity bands">
        <span>
          <em>Base note</em>
          <b>{velocityRangeLabel(baseBand)}</b>
          <small>Cycle velocity</small>
        </span>
        <span>
          <em>Subdivision starts</em>
          <b>{velocityRangeLabel(gatiBand)}</b>
          <small>Base + subdivision accent</small>
        </span>
        <span>
          <em>Grouping starts</em>
          <b>{velocityRangeLabel(jathiBand)}</b>
          <small>Base + grouping accent; {jathiModeLabel}</small>
        </span>
        <span>
          <em>Section + subdivision</em>
          <b>{velocityRangeLabel(sectionGatiBand)}</b>
          <small>Base + section extra + subdivision</small>
        </span>
        <span>
          <em>Section + grouping</em>
          <b>{velocityRangeLabel(sectionJathiBand)}</b>
          <small>
            {jathiAccentMode === "layered"
              ? "Base + section extra + subdivision + grouping"
              : "Base + section extra + grouping"}
          </small>
        </span>
      </div>
    </section>
  );
}
