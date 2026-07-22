/**
 * Percentiles here feed the colour-scale domain, which is recomputed on
 * every tick of the coherence / clip sliders. Two things keep that cheap:
 *  - one sort per call (both ends of the domain read from the same sorted
 *    copy — previously the full array was sorted twice per tick), using a
 *    Float64Array, whose numeric sort is several times faster than
 *    Array.prototype.sort with a comparator;
 *  - a sample cap: above MAX_SAMPLE values we stride-sample. Percentiles of
 *    a 65k evenly-strided sample are visually identical to the exact ones,
 *    and the sort cost stops growing with grid size.
 */
const MAX_SAMPLE = 65536;

function sortedSample(values: ArrayLike<number>): Float64Array {
  const n = values.length;
  let arr: Float64Array;
  if (n > MAX_SAMPLE) {
    const stride = n / MAX_SAMPLE;
    arr = new Float64Array(MAX_SAMPLE);
    for (let k = 0; k < MAX_SAMPLE; k++) arr[k] = values[Math.floor(k * stride)];
  } else {
    arr = new Float64Array(n);
    for (let k = 0; k < n; k++) arr[k] = values[k];
  }
  arr.sort();
  return arr;
}

/** Percentile of a pre-sorted array (linear interpolation). p in [0, 100]. */
function percentileSorted(sorted: Float64Array, p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Percentile of an array (linear interpolation). p in [0, 100]. */
export function percentile(values: ArrayLike<number>, p: number): number {
  if (values.length === 0) return 0;
  return percentileSorted(sortedSample(values), p);
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
  values: ArrayLike<number>,
  symmetric: boolean,
  clipPct: number,
): Domain {
  if (values.length === 0) return { min: -1, max: 1 };
  const sorted = sortedSample(values);
  const lo = percentileSorted(sorted, 100 - clipPct);
  const hi = percentileSorted(sorted, clipPct);
  if (symmetric) {
    const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-6);
    return { min: -m, max: m };
  }
  return hi > lo ? { min: lo, max: hi } : { min: lo, max: lo + 1e-6 };
}
