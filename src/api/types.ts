export interface ProjectSummary {
  id: string;
  path?: string;
  project?: string | null;
  method?: string | null;
  orbit?: string | null;
  polarization?: string | null;
  n_dates?: number;
  date_start?: string | null;
  date_end?: string | null;
  reference_date?: string | null;
  preset?: string | null;
  resolution_m?: number | null;
  software?: string | null;
  n_pairs_final?: number | null;
  warnings?: string[];
  error?: string;
}

export interface Bounds {
  lat_min: number;
  lat_max: number;
  lon_min: number;
  lon_max: number;
}

export interface ProjectDetail extends ProjectSummary {
  grid: { n_lat: number; n_lon: number; n_valid: number };
  bounds: Bounds;
}

export interface GridResponse {
  lat: number[];
  lon: number[];
  count: number;
  cells: {
    i: number[];
    j: number[];
    vel: number[];
    coh: number[];
    rmse: number[];
  };
}

export interface RasterResponse {
  image_base64: string;
  bounds: Bounds;
  vmin: number;
  vmax: number;
  count: number;
  width: number;
  height: number;
}

export interface TimeseriesResponse {
  lat: number;
  lon: number;
  dates: string[];
  displacement_mm: (number | null)[];
  trend_mm: (number | null)[];
  velocity: number | null;
  rmse: number | null;
  coherence: number | null;
  n_valid_epochs: number;
}

export type ColorBy = "vel" | "coh" | "rmse" | "disp";

/**
 * Displacement cube for every valid cell, aligned to GridResponse.cells
 * by index. `cells.disp[dateIdx][k]` is the displacement (mm) of grid cell
 * `k` at date `dates[dateIdx]`; null where that epoch is NaN.
 */
export interface DisplacementResponse {
  dates: string[];
  count: number;
  reference_date?: string | null;
  cells: {
    disp: (number | null)[][];
  };
}
