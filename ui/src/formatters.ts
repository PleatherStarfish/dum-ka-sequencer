/**
 * Small numeric display formatters shared across panels. Extracted verbatim
 * from App.tsx (carve-up round 3b). Pure.
 */
import { clamp } from "./patchIo";

export function formatMultiplier(value: number): string {
  return `x${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
}

export function formatPercent(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

export function formatShortNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatVelocityOffset(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "source";
  return rounded > 0 ? `source +${rounded}` : `source ${rounded}`;
}

export function gcdNumber(a: number, b: number): number {
  let x = Math.max(1, Math.round(Math.abs(a)));
  let y = Math.max(1, Math.round(Math.abs(b)));
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}
