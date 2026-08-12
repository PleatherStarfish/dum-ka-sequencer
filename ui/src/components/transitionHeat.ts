import { clamp } from "../patchIo";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const HEAT_DARK: Rgb = { r: 20, g: 36, b: 76 };
export const HEAT_STOPS: Array<{ t: number; color: Rgb }> = [
  { t: 0, color: { r: 41, g: 45, b: 85 } },
  { t: 0.18, color: { r: 0, g: 140, b: 222 } },
  { t: 0.36, color: { r: 0, g: 163, b: 159 } },
  { t: 0.54, color: { r: 86, g: 160, b: 112 } },
  { t: 0.7, color: { r: 187, g: 136, b: 0 } },
  { t: 0.86, color: { r: 202, g: 80, b: 33 } },
  { t: 1, color: { r: 225, g: 47, b: 67 } },
];

export function heatIntensity(share: number): number {
  // Human perception does not read probability linearly. This curve makes
  // dominance appear quickly while still keeping low probabilities cool.
  return Math.pow(clamp(share, 0, 1), 0.64);
}

export function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp(amount, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

export function heatRamp(intensity: number): Rgb {
  const t = clamp(intensity, 0, 1);
  const upper = HEAT_STOPS.find((stop) => stop.t >= t) ?? HEAT_STOPS[HEAT_STOPS.length - 1]!;
  const lowerIndex = Math.max(0, HEAT_STOPS.indexOf(upper) - 1);
  const lower = HEAT_STOPS[lowerIndex]!;
  if (upper.t === lower.t) {
    return upper.color;
  }
  return mixRgb(lower.color, upper.color, (t - lower.t) / (upper.t - lower.t));
}

export function transitionHeatBackground(share: number): string {
  if (share <= 0) {
    return "var(--matrix-heat-base, #14244c)";
  }
  const intensity = heatIntensity(share);
  const ramp = heatRamp(intensity);
  const opacity = 0.22 + intensity * 0.78;
  const top = mixRgb({ r: 255, g: 255, b: 255 }, ramp, 0.82);
  const bottom = mixRgb(HEAT_DARK, ramp, 0.76);
  return `linear-gradient(180deg, rgb(${top.r} ${top.g} ${top.b} / ${opacity}), rgb(${bottom.r} ${bottom.g} ${bottom.b} / ${Math.max(0.14, opacity - 0.18)})), var(--matrix-heat-base, #14244c)`;
}

export function transitionHeatShadow(share: number): string {
  if (share <= 0) {
    return "none";
  }
  const intensity = heatIntensity(share);
  const ramp = heatRamp(intensity);
  const edge = mixRgb({ r: 255, g: 255, b: 255 }, ramp, 0.72);
  return `inset 0 0 0 1px rgb(${edge.r} ${edge.g} ${edge.b} / ${0.14 + intensity * 0.62}), inset 0 0 ${6 + intensity * 22}px rgb(${ramp.r} ${ramp.g} ${ramp.b} / ${0.08 + intensity * 0.34})`;
}
