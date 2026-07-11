import type { ColorBy } from "../api/types";
import type { Domain } from "./stats";

type RGB = [number, number, number];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Piecewise-linear ramp over evenly spaced RGB stops. t in [0, 1]. */
function ramp(stops: RGB[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const [r1, g1, b1] = stops[i];
  const [r2, g2, b2] = stops[i + 1];
  return `rgb(${Math.round(lerp(r1, r2, f))},${Math.round(lerp(g1, g2, f))},${Math.round(lerp(b1, b2, f))})`;
}

/** Diverging red–white–blue. Red = negative (subsidence), blue = positive (uplift). */
const RD_WH_BU: RGB[] = [
  [178, 24, 43],
  [214, 96, 77],
  [244, 165, 130],
  [247, 247, 247],
  [146, 197, 222],
  [67, 147, 195],
  [33, 102, 172],
];

/** Sequential (viridis-like) for coherence: low = dark, high = bright. */
const VIRIDIS: RGB[] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

/** Sequential (inferno-like) for RMSE: low = dark, high = bright/hot. */
const INFERNO: RGB[] = [
  [0, 0, 4],
  [87, 16, 110],
  [188, 55, 84],
  [249, 142, 9],
  [252, 255, 164],
];

export function colorFor(value: number, domain: Domain, colorBy: ColorBy): string {
  const t = (value - domain.min) / (domain.max - domain.min);
  switch (colorBy) {
    case "vel":
      return ramp(RD_WH_BU, t);
    case "coh":
      return ramp(VIRIDIS, t);
    case "rmse":
      return ramp(INFERNO, t);
  }
}

/** CSS gradient string for the legend bar. */
export function legendGradient(colorBy: ColorBy): string {
  const stops = colorBy === "vel" ? RD_WH_BU : colorBy === "coh" ? VIRIDIS : INFERNO;
  const parts = stops.map(
    ([r, g, b], i) =>
      `rgb(${r},${g},${b}) ${((i / (stops.length - 1)) * 100).toFixed(0)}%`,
  );
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

export const COLOR_LABELS: Record<ColorBy, { title: string; units: string }> = {
  vel: { title: "LOS velocity", units: "mm/yr" },
  coh: { title: "Mean coherence", units: "" },
  rmse: { title: "RMSE", units: "mm" },
};
