/**
 * Pure logic behind the Setup dialog's MIDI destination picker and the
 * top-bar missing-destination chip. Extracted so option building and status
 * copy are unit-testable without React
 * (docs/COMPONENT_LOGIC_EXTRACTION_PLAN.md).
 */
import type { MidiDestination, MidiRouteStatus } from "./bridge";

/** The picker value for "Virtual port only" (the default route). */
export const VIRTUAL_ONLY_VALUE = "";

export interface DestinationOption {
  value: string;
  label: string;
  /** True for the injected entry representing a desired destination that is
   * not currently present — selectable so the choice stays visible. */
  missing: boolean;
}

/** Options for the destination `<select>`: virtual-only first, then every
 * present destination, then (when the desired one is absent) an injected
 * "missing" entry so the user's choice never silently disappears. */
export function buildDestinationOptions(
  destinations: MidiDestination[],
  desired: MidiDestination | null
): DestinationOption[] {
  const options: DestinationOption[] = [
    { value: VIRTUAL_ONLY_VALUE, label: "Virtual port only (default)", missing: false },
    ...destinations.map((dest) => ({
      value: dest.id,
      label: dest.name,
      missing: false,
    })),
  ];
  if (desired && !destinations.some((dest) => dest.id === desired.id)) {
    options.push({
      value: desired.id,
      label: `${desired.name} (not found)`,
      missing: true,
    });
  }
  return options;
}

/** Resolve a picked option value back to a destination spec (`null` for
 * virtual-only). Prefers the live list; falls back to the desired spec so a
 * missing destination can be re-picked without losing its name. */
export function destinationForValue(
  value: string,
  destinations: MidiDestination[],
  desired: MidiDestination | null
): MidiDestination | null {
  if (value === VIRTUAL_ONLY_VALUE) {
    return null;
  }
  const present = destinations.find((dest) => dest.id === value);
  if (present) {
    return present;
  }
  if (desired && desired.id === value) {
    return desired;
  }
  return null;
}

/** One-line status under the picker. */
export function routeStatusLine(status: MidiRouteStatus): string {
  if (!status.desired) {
    return "Sending on the virtual port only.";
  }
  if (status.connected) {
    return `Also sending to ${status.desired.name}.`;
  }
  const reason = status.lastError ? ` (${status.lastError})` : "";
  return `${status.desired.name} not found — virtual port only${reason}.`;
}

/** Whether the top-bar chip should warn about the missing destination. */
export function showMissingChip(status: MidiRouteStatus): boolean {
  return status.desired !== null && !status.connected;
}

/** Chip copy: short, names the destination. */
export function missingChipLabel(status: MidiRouteStatus): string {
  return status.desired
    ? `MIDI out missing: ${status.desired.name}`
    : "MIDI out missing";
}
