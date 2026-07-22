/**
 * The 3D terrain itself — a single continuous mesh over the whole grid that
 * carries BOTH real topography and deformation, so sliding the date makes the
 * actual (satellite-draped) ground move. There is no separate "deformation
 * plane"; this mesh *is* the map.
 *
 *     vertex height z = DEM_elevation · terrainVE + displacement(date)/1000 · deformVE
 *
 * The mesh is draped with satellite imagery via Web-Mercator texture
 * coordinates that follow deck.gl's own terrain convention (image row 0 =
 * north, u = mercX, v = mercY), and also carries per-vertex colours so it can
 * fall back to a deformation-coloured surface when imagery is unavailable.
 */
import type { GridResponse } from "../api/types";
import { lutBin, type ColorLut } from "./colormaps";
import { webMercX, webMercY } from "./dem";

const M_PER_DEG_LAT = 110574;

/** Local east-north-up metre frame centred on the AOI. */
export interface Frame {
  east: Float64Array; // per lon index
  north: Float64Array; // per lat index
  centerLat: number;
  centerLon: number;
  widthM: number;
  heightM: number;
}

export function buildFrame(lat: number[], lon: number[]): Frame {
  const centerLat = (lat[0] + lat[lat.length - 1]) / 2;
  const centerLon = (lon[0] + lon[lon.length - 1]) / 2;
  const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const east = new Float64Array(lon.length);
  for (let j = 0; j < lon.length; j++) east[j] = (lon[j] - centerLon) * mPerDegLon;
  const north = new Float64Array(lat.length);
  for (let i = 0; i < lat.length; i++) north[i] = (lat[i] - centerLat) * M_PER_DEG_LAT;
  return {
    east,
    north,
    centerLat,
    centerLon,
    widthM: Math.abs((lon[lon.length - 1] - lon[0]) * mPerDegLon),
    heightM: Math.abs((lat[lat.length - 1] - lat[0]) * M_PER_DEG_LAT),
  };
}

/** Geographic extent of the stitched texture, for UV mapping. */
export interface TexExtent {
  west: number;
  east: number;
  north: number;
  south: number;
}

/**
 * Static terrain scaffolding (date-independent): the strided node grid, its
 * horizontal metre positions, per-node DEM elevation, satellite texture
 * coordinates, triangle indices, and the mapping from each node to its data
 * cell (for applying deformation per date). Rebuilt only when the grid, DEM,
 * or texture extent changes.
 */
export interface TerrainBase {
  nR: number;
  nC: number;
  rows: Int32Array; // lat index per terrain row
  cols: Int32Array; // lon index per terrain col
  /** metre offsets [east, north] per node (z filled per date). */
  xy: Float32Array;
  /** DEM elevation (raw metres) per node. */
  elev: Float32Array;
  /** texture uv per node. */
  tex: Float32Array;
  /** continuous triangulation over the whole grid (the terrain body). */
  indices: Uint32Array;
  /** triangulation over quads whose 4 corners all have data (the drape). */
  skinIndices: Uint32Array;
  /** grid cell index (i*nLon + j) per node, for deformation lookup. */
  cellId: Int32Array;
  /** real elevation (raw metres) per grid cell k; NaN if not sampled. */
  elevByCell: Float32Array;
  elevMin: number;
  elevMax: number;
}

const MAX_NODES = 240_000; // cap terrain vertices; stride larger grids

function strideFor(nLat: number, nLon: number): number {
  let s = 1;
  while (Math.ceil(nLat / s) * Math.ceil(nLon / s) > MAX_NODES) s++;
  return s;
}

/** Strided index list over [0, n), always including the last index. */
function axis(n: number, stride: number): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < n; i += stride) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return Int32Array.from(out);
}

export function buildTerrainBase(
  grid: GridResponse,
  visibleIdx: number[],
  elevSample: (lat: number, lon: number) => number,
  tex: TexExtent,
): TerrainBase {
  const nLat = grid.lat.length;
  const nLon = grid.lon.length;
  const stride = strideFor(nLat, nLon);
  const rows = axis(nLat, stride);
  const cols = axis(nLon, stride);
  const nR = rows.length;
  const nC = cols.length;

  const xy = new Float32Array(nR * nC * 2);
  const elev = new Float32Array(nR * nC);
  const texUV = new Float32Array(nR * nC * 2);
  const cellId = new Int32Array(nR * nC);
  const validNode = new Uint8Array(nR * nC); // node has data (visible cell)?

  const visibleSet = new Set<number>();
  {
    const { i: ci0, j: cj0 } = grid.cells;
    for (const k of visibleIdx) visibleSet.add(ci0[k] * nLon + cj0[k]);
  }

  const mPerDegLon = 111320 * Math.cos(((grid.lat[0] + grid.lat[nLat - 1]) / 2) * Math.PI / 180);
  const centerLat = (grid.lat[0] + grid.lat[nLat - 1]) / 2;
  const centerLon = (grid.lon[0] + grid.lon[nLon - 1]) / 2;

  const uW = webMercX(tex.west);
  const uE = webMercX(tex.east);
  const vN = webMercY(tex.north);
  const vS = webMercY(tex.south);
  const uSpan = uE - uW || 1e-9;
  const vSpan = vS - vN || 1e-9;

  let elevMin = Infinity;
  let elevMax = -Infinity;
  for (let r = 0; r < nR; r++) {
    const i = rows[r];
    const lat = grid.lat[i];
    for (let c = 0; c < nC; c++) {
      const j = cols[c];
      const lon = grid.lon[j];
      const p = r * nC + c;
      xy[p * 2] = (lon - centerLon) * mPerDegLon;
      xy[p * 2 + 1] = (lat - centerLat) * M_PER_DEG_LAT;
      const e = elevSample(lat, lon);
      elev[p] = e;
      if (e < elevMin) elevMin = e;
      if (e > elevMax) elevMax = e;
      texUV[p * 2] = (webMercX(lon) - uW) / uSpan;
      texUV[p * 2 + 1] = (webMercY(lat) - vN) / vSpan;
      cellId[p] = i * nLon + j;
      validNode[p] = visibleSet.has(i * nLon + j) ? 1 : 0;
    }
  }

  // Two triangulations sharing the same vertices:
  //  - `tris`: continuous, the terrain body (satellite drapes over all of it).
  //  - `skinTris`: only quads whose 4 corners all have data, so the deformation
  //    drape has real holes over no-data cells and the satellite shows through
  //    (a fully-continuous transparent skin renders those cells as black).
  const tris: number[] = [];
  const skinTris: number[] = [];
  for (let r = 0; r < nR - 1; r++) {
    for (let c = 0; c < nC - 1; c++) {
      const a = r * nC + c;
      const b = r * nC + c + 1;
      const d = (r + 1) * nC + c;
      const e = (r + 1) * nC + c + 1;
      tris.push(a, d, b, b, d, e);
      if (validNode[a] && validNode[b] && validNode[d] && validNode[e]) {
        skinTris.push(a, d, b, b, d, e);
      }
    }
  }

  // Per-cell elevation for the point layer.
  const elevByCell = new Float32Array(grid.count).fill(NaN);
  const { i: ci, j: cj } = grid.cells;
  for (const k of visibleIdx) {
    elevByCell[k] = elevSample(grid.lat[ci[k]], grid.lon[cj[k]]);
  }

  return {
    nR,
    nC,
    rows,
    cols,
    xy,
    elev,
    tex: texUV,
    indices: Uint32Array.from(tris),
    skinIndices: Uint32Array.from(skinTris),
    cellId,
    elevByCell,
    elevMin: Number.isFinite(elevMin) ? elevMin : 0,
    elevMax: Number.isFinite(elevMax) ? elevMax : 0,
  };
}

export interface TerrainMesh {
  attributes: {
    POSITION: { value: Float32Array; size: number };
    NORMAL: { value: Float32Array; size: number };
    TEXCOORD_0: { value: Float32Array; size: number };
    COLOR_0: { value: Uint8Array; size: number; normalized: boolean };
  };
  indices: { value: Uint32Array; size: number };
}

export interface SurfaceStats {
  defMin: number;
  defMax: number;
  defPeakAbs: number;
  n: number;
}

// Neutral tint for non-data terrain in deformation-colour mode.
const NEUTRAL: [number, number, number] = [96, 100, 108];

/**
 * Per-date terrain geometry: vertex heights (DEM + deformation) and per-vertex
 * colours. `nodeVal` holds the current-epoch value per grid cell (i*nLon + j),
 * NaN where absent.
 */
export function buildTerrainMesh(
  base: TerrainBase,
  nodeVal: Float32Array,
  lut: ColorLut,
  terrainExag: number,
  deformExag: number,
  deformActive: boolean,
): { mesh: TerrainMesh; skin: TerrainMesh; stats: SurfaceStats } {
  const nNode = base.nR * base.nC;
  const positions = new Float32Array(nNode * 3);
  const normals = new Float32Array(nNode * 3);
  // `colors`: terrain body colour (deformation where data, neutral elsewhere),
  // used when the terrain itself is coloured (deformation texture mode).
  // `skin`: deformation colour where data, TRANSPARENT elsewhere, for the
  // drape that hugs the satellite terrain.
  const colors = new Uint8Array(nNode * 4);
  const skin = new Uint8Array(nNode * 4);

  let defMin = Infinity;
  let defMax = -Infinity;
  let peak = 0;
  let n = 0;

  for (let p = 0; p < nNode; p++) {
    const q = p * 3;
    positions[q] = base.xy[p * 2];
    positions[q + 1] = base.xy[p * 2 + 1];
    let z = base.elev[p] * terrainExag;
    const v = nodeVal[base.cellId[p]];
    const o = p * 4;
    if (Number.isFinite(v)) {
      if (deformActive) z += (v / 1000) * deformExag;
      const b = lutBin(lut, v);
      colors[o] = skin[o] = lut.r[b];
      colors[o + 1] = skin[o + 1] = lut.g[b];
      colors[o + 2] = skin[o + 2] = lut.b[b];
      colors[o + 3] = 255;
      skin[o + 3] = 255;
      if (v < defMin) defMin = v;
      if (v > defMax) defMax = v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      n++;
    } else {
      colors[o] = NEUTRAL[0];
      colors[o + 1] = NEUTRAL[1];
      colors[o + 2] = NEUTRAL[2];
      colors[o + 3] = 255;
      // skin stays 0,0,0,0 → transparent, so the satellite shows through.
    }
    positions[q + 2] = z;
    normals[q + 2] = 1;
  }

  const geom = {
    POSITION: { value: positions, size: 3 },
    NORMAL: { value: normals, size: 3 },
    TEXCOORD_0: { value: base.tex, size: 2 },
  };

  return {
    mesh: {
      attributes: { ...geom, COLOR_0: { value: colors, size: 4, normalized: true } },
      indices: { value: base.indices, size: 1 },
    },
    skin: {
      attributes: { ...geom, COLOR_0: { value: skin, size: 4, normalized: true } },
      // data-only triangulation → real holes where there's no data.
      indices: { value: base.skinIndices, size: 1 },
    },
    stats: {
      defMin: Number.isFinite(defMin) ? defMin : 0,
      defMax: Number.isFinite(defMax) ? defMax : 0,
      defPeakAbs: peak,
      n,
    },
  };
}

/** Scatter the current-epoch value of each visible cell into a full grid array. */
export function scatterNodeValues(
  grid: GridResponse,
  visibleIdx: number[],
  valueAt: (k: number) => number | null,
): Float32Array {
  const arr = new Float32Array(grid.lat.length * grid.lon.length).fill(NaN);
  const { i: ci, j: cj } = grid.cells;
  const nLon = grid.lon.length;
  for (const k of visibleIdx) {
    const v = valueAt(k);
    if (v != null) arr[ci[k] * nLon + cj[k]] = v;
  }
  return arr;
}
