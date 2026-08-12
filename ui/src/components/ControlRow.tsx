import {
  useId,
  type CSSProperties,
  type ReactNode,
} from "react";

export type ControlRowDensity = "compact" | "standard" | "precision";

export type ControlRowProps = {
  label: ReactNode;
  automation?: ReactNode;
  control: ReactNode;
  value?: ReactNode;
  range?: ReactNode;
  helper?: ReactNode;
  className?: string;
  density?: ControlRowDensity;
  labelId?: string;
  controlMinWidth?: number;
  controlIdealWidth?: number;
  controlMaxWidth?: number;
};

function controlWidthStyle({
  controlIdealWidth,
  controlMaxWidth,
  controlMinWidth,
}: Pick<
  ControlRowProps,
  "controlIdealWidth" | "controlMaxWidth" | "controlMinWidth"
>): CSSProperties | undefined {
  const style: CSSProperties & Record<string, string> = {};
  if (controlMinWidth !== undefined) {
    style["--control-row-control-min"] = `${controlMinWidth}px`;
  }
  if (controlIdealWidth !== undefined) {
    style["--control-row-control-ideal"] = `${controlIdealWidth}px`;
  }
  if (controlMaxWidth !== undefined) {
    style["--control-row-control-max"] = `${controlMaxWidth}px`;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

export function ControlRow({
  automation,
  className,
  control,
  controlIdealWidth,
  controlMaxWidth,
  controlMinWidth,
  density = "standard",
  helper,
  label,
  labelId,
  range,
  value,
}: ControlRowProps) {
  const generatedLabelId = useId();
  const resolvedLabelId = labelId ?? generatedLabelId;
  const rootClassName = [
    "control-row",
    `control-row--${density}`,
    value ? "has-value" : "",
    range ? "has-range" : "",
    helper ? "has-helper" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClassName}
      data-control-row="true"
      style={controlWidthStyle({
        controlIdealWidth,
        controlMaxWidth,
        controlMinWidth,
      })}
    >
      <span className="control-row__label" id={resolvedLabelId}>
        <span className="control-row__label-text">{label}</span>
        {automation && (
          <span className="control-row__automation">{automation}</span>
        )}
      </span>
      <span className="control-row__control">{control}</span>
      {value && <span className="control-row__value">{value}</span>}
      {range && <span className="control-row__range">{range}</span>}
      {helper && <span className="control-row__helper">{helper}</span>}
    </div>
  );
}
