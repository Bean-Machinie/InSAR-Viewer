import type { ColorBy } from "../api/types";
import type { Domain } from "./stats";

export type RGB = [number, number, number];

export interface Colormap {
  label: string;
  /** Evenly spaced RGB stops, low → high. */
  stops: RGB[];
  /** Diverging maps read best centred on 0 (velocity-style data). */
  diverging?: boolean;
}

/**
 * Colormap registry. Adding a colormap = adding one entry here;
 * the picker UI, legend gradient, and rendering all pick it up.
 */
export const COLORMAPS: Record<string, Colormap> = {
  buwhrd: {
    label: "Blue–White–Red",
    diverging: true,
    stops: [
      [33, 102, 172],
      [67, 147, 195],
      [146, 197, 222],
      [247, 247, 247],
      [244, 165, 130],
      [214, 96, 77],
      [178, 24, 43],
    ],
  },
  brbg: {
    label: "Brown–Teal",
    diverging: true,
    stops: [
      [140, 81, 10],
      [216, 179, 101],
      [246, 232, 195],
      [245, 245, 245],
      [199, 234, 229],
      [90, 180, 172],
      [1, 102, 94],
    ],
  },
  viridis: {
    label: "Viridis",
    stops: [
      [68, 1, 84],
      [59, 82, 139],
      [33, 145, 140],
      [94, 201, 98],
      [253, 231, 37],
    ],
  },
  inferno: {
    label: "Inferno",
    stops: [
      [0, 0, 4],
      [87, 16, 110],
      [188, 55, 84],
      [249, 142, 9],
      [252, 255, 164],
    ],
  },
  magma: {
    label: "Magma",
    stops: [
      [0, 0, 4],
      [81, 18, 124],
      [183, 55, 121],
      [252, 137, 97],
      [252, 253, 191],
    ],
  },
  plasma: {
    label: "Plasma",
    stops: [
      [13, 8, 135],
      [126, 3, 168],
      [204, 71, 120],
      [248, 149, 64],
      [240, 249, 33],
    ],
  },
  cividis: {
    label: "Cividis",
    stops: [
      [0, 32, 76],
      [64, 80, 112],
      [124, 123, 120],
      [196, 173, 119],
      [255, 234, 70],
    ],
  },
  turbo: {
    label: "Turbo",
    stops: [
      [48, 18, 59],
      [70, 134, 251],
      [27, 229, 181],
      [164, 252, 60],
      [249, 186, 56],
      [233, 74, 20],
      [122, 4, 3],
    ],
  },
};

/** Default colormap per layer. */
export const DEFAULT_COLORMAP: Record<ColorBy, string> = {
  vel: "buwhrd",
  coh: "viridis",
  rmse: "inferno",
};

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

function stopsOf(cmapId: string): RGB[] {
  return (COLORMAPS[cmapId] ?? COLORMAPS.viridis).stops;
}

export function colorFor(value: number, domain: Domain, cmapId: string): string {
  const t = (value - domain.min) / (domain.max - domain.min);
  return ramp(stopsOf(cmapId), t);
}

/** CSS gradient string for legend bars and picker swatches. */
export function legendGradient(cmapId: string): string {
  const stops = stopsOf(cmapId);
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
