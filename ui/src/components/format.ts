import {
  CustomSubdivision,
  JathiBhedamSelection,
  JathiWeight,
  RatchetModifierOperation,
  SubdivisionWeight,
  U64SeedDecimal,
} from "../bridge";
import { formatMultiplier } from "../formatters";
import { ResolvedSectionRun } from "../resolvedSections";

export function formatPct(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value >= 0.995) return "100%";
  if (value < 0.01) return "<1%";
  return `${Math.round(value * 100)}%`;
}

export function formatRatchetModifierAmount(
  value: number,
  operation: RatchetModifierOperation
): string {
  if (operation === "add") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${Math.round(value * 100)}%`;
  }
  return formatMultiplier(value);
}

export function formatSeeds(seeds: U64SeedDecimal[]): string {
  return seeds.join(", ");
}

export function compactWeightSummary<T>({
  weights,
  label,
  value,
  resolved,
}: {
  weights: T[];
  label: (weight: T) => string;
  value: (weight: T) => number;
  resolved?: string | null;
}): string {
  if (resolved) return resolved;
  const active = weights
    .filter((weight) => Math.max(0, value(weight)) > 0)
    .sort((a, b) => Math.max(0, value(b)) - Math.max(0, value(a)));
  if (!active.length) return "off";
  if (active.length === 1) return `${label(active[0]!)} 100%`;
  const total = active.reduce((sum, weight) => sum + Math.max(0, value(weight)), 0);
  return active
    .slice(0, 2)
    .map((weight) => `${label(weight)} ${formatPct(Math.max(0, value(weight)) / total)}`)
    .concat(active.length > 2 ? [`+${active.length - 2}`] : [])
    .join(" · ");
}

export function jathiBhedamSummary(selection: JathiBhedamSelection | null | undefined): string {
  if (!selection) return "off";
  if (!selection.enabled) return "paused";
  const seedSum = selection.spec.seedNumbers.reduce((sum, number) => sum + number, 0);
  const activeOps = selection.spec.schedule.menu.filter((op) => op.weight > 0);
  const opSummary =
    activeOps.length === 1 ? activeOps[0]!.op : `${activeOps.length} ops`;
  return `${seedSum} pulses · ${opSummary}`;
}

export function jathiSummary(
  weights: JathiWeight[],
  resolvedSection?: ResolvedSectionRun
): string {
  return compactWeightSummary({
    weights,
    label: (weight) => `grouping ${weight.jathi}`,
    value: (weight) => weight.weight,
    resolved: resolvedSection?.jathi
      ? `grouping ${resolvedSection.jathi}`
      : null,
  });
}

export function customSubdivisionSummary(
  custom: CustomSubdivision | null | undefined,
  resolvedSection?: ResolvedSectionRun
): string | null {
  if (!custom) return null;
  if (resolvedSection?.customSubdivision) {
    return `${resolvedSection.divisionCount} equal notes`;
  }
  const total =
    Math.max(0, custom.perBeatWeight) + Math.max(0, custom.equalPartsWeight);
  if (total <= 0) return "equal grid off";
  return `${formatPct(Math.max(0, custom.equalPartsWeight) / total)} equal grid`;
}

export function subdivisionSummary(
  weights: SubdivisionWeight[],
  custom: CustomSubdivision | null | undefined,
  resolvedSection?: ResolvedSectionRun,
  resolvedGati?: number
): string {
  const gatiSummary = compactWeightSummary({
    weights,
    label: (weight) => `subdivision ${weight.subdivision}`,
    value: (weight) => weight.weight,
    resolved: resolvedGati ? `subdivision ${resolvedGati}` : null,
  });
  const gridSummary = customSubdivisionSummary(custom, resolvedSection);
  return gridSummary ? `${gatiSummary} · ${gridSummary}` : gatiSummary;
}
