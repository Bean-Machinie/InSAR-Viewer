/** Percentile of an array (linear interpolation). p in [0, 100]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface Domain {
  min: number;
  max: number;
}

/**
 * Color-scale domain for a set of values.
 * - symmetric: clip to ±(clip percentile of |v|), centred on 0 (velocity)
 * - otherwise: [lowPct, highPct] percentiles (coherence, RMSE)
 */
export function computeDomain(
  values: number[],
  symmetric: boolean,
  clipPct: number,
): Domain {
  if (values.length === 0) return { min: -1, max: 1 };
  if (symmetric) {
    const lo = percentile(values, 100 - clipPct);
    const hi = percentile(values, clipPct);
    const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-6);
    return { min: -m, max: m };
  }
  const min = percentile(values, 100 - clipPct);
  const max = percentile(values, clipPct);
  return max > min ? { min, max } : { min, max: min + 1e-6 };
}
