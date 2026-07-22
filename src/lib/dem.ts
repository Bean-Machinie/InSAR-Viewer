/**
 * Digital Elevation Model sampling for the 3D view.
 *
 * The InSAR products carry no elevation, so terrain height comes from the
 * public AWS "Terrarium" terrain tiles (Mapzen encoding, hosted on AWS Open
 * Data — no API key, global coverage, CORS-enabled):
 *
 *   height_m = (R * 256 + G + B / 256) - 32768
 *
 * We fetch just the handful of tiles covering a project's bounding box at a
 * zoom picked to keep the tile count small, stitch them into one heightmap,
 * and expose a bilinear sampler `elevation(lat, lon) → metres`. Everything is
 * done client-side; if the fetch fails (offline / CORS), the caller falls
 * back to a flat base.
 */
import type { Bounds } from "../api/types";

const TERRARIUM_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TILE = 256;
const MAX_TILES = 16; // cap the fetch; zoom is chosen to fit under this

export interface DEM {
  /** Elevation in metres at a geographic coordinate (bilinear, edge-clamped). */
  elevation: (lat: number, lon: number) => number;
  /** True if real terrain was loaded; false means a flat (0 m) fallback. */
  ok: boolean;
  min: number;
  max: number;
  zoom: number;
  tiles: number;
}

// --- Web-Mercator projection ---
/** Normalised Web-Mercator X in [0, 1] (0 = 180°W, 1 = 180°E). */
export function webMercX(lon: number): number {
  return (lon + 180) / 360;
}
/** Normalised Web-Mercator Y in [0, 1] (0 = north edge, 1 = south edge). */
export function webMercY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
// Global pixel coords at a given zoom.
function lonToPx(lon: number, z: number): number {
  return webMercX(lon) * TILE * 2 ** z;
}
function latToPx(lat: number, z: number): number {
  return webMercY(lat) * TILE * 2 ** z;
}

function tileRange(bounds: Bounds, z: number) {
  const x0 = Math.floor(lonToPx(bounds.lon_min, z) / TILE);
  const x1 = Math.floor(lonToPx(bounds.lon_max, z) / TILE);
  // lat_max is the northern edge → the smaller pixel-Y / tile-Y
  const y0 = Math.floor(latToPx(bounds.lat_max, z) / TILE);
  const y1 = Math.floor(latToPx(bounds.lat_min, z) / TILE);
  const tx0 = Math.min(x0, x1);
  const tx1 = Math.max(x0, x1);
  const ty0 = Math.min(y0, y1);
  const ty1 = Math.max(y0, y1);
  return { tx0, tx1, ty0, ty1, nx: tx1 - tx0 + 1, ny: ty1 - ty0 + 1 };
}

/** Highest zoom whose tile count over the bounds stays under MAX_TILES. */
function chooseZoom(bounds: Bounds): number {
  for (let z = 14; z >= 6; z--) {
    const { nx, ny } = tileRange(bounds, z);
    if (nx * ny <= MAX_TILES) return z;
  }
  return 6;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // required to read pixels back from canvas
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile failed: ${url}`));
    img.src = url;
  });
}

const flatDEM: DEM = {
  elevation: () => 0,
  ok: false,
  min: 0,
  max: 0,
  zoom: 0,
  tiles: 0,
};

/**
 * Fetch + stitch the terrain tiles covering `bounds` and return a sampler.
 * Never rejects — on any failure it resolves to a flat (0 m) DEM so the 3D
 * view still renders (just without real relief).
 */
export async function loadDEM(bounds: Bounds): Promise<DEM> {
  try {
    const z = chooseZoom(bounds);
    const { tx0, ty0, nx, ny } = tileRange(bounds, z);
    const n = 2 ** z;

    const canvas = document.createElement("canvas");
    canvas.width = nx * TILE;
    canvas.height = ny * TILE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return flatDEM;

    await Promise.all(
      Array.from({ length: nx * ny }, (_, k) => {
        const dx = k % nx;
        const dy = Math.floor(k / nx);
        const tx = ((tx0 + dx) % n + n) % n; // wrap longitude
        const ty = ty0 + dy;
        if (ty < 0 || ty >= n) return Promise.resolve(); // above/below world
        const url = TERRARIUM_URL.replace("{z}", String(z))
          .replace("{x}", String(tx))
          .replace("{y}", String(ty));
        return loadImage(url).then((img) =>
          ctx.drawImage(img, dx * TILE, dy * TILE),
        );
      }),
    );

    const W = canvas.width;
    const H = canvas.height;
    const px = ctx.getImageData(0, 0, W, H).data;
    const height = new Float32Array(W * H);
    let min = Infinity;
    let max = -Infinity;
    for (let p = 0; p < W * H; p++) {
      const o = p * 4;
      const h = px[o] * 256 + px[o + 1] + px[o + 2] / 256 - 32768;
      height[p] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }

    const originX = tx0 * TILE;
    const originY = ty0 * TILE;

    const elevation = (lat: number, lon: number): number => {
      const gx = lonToPx(lon, z) - originX;
      const gy = latToPx(lat, z) - originY;
      const x = gx < 0 ? 0 : gx > W - 1 ? W - 1 : gx;
      const y = gy < 0 ? 0 : gy > H - 1 ? H - 1 : gy;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(x0 + 1, W - 1);
      const y1 = Math.min(y0 + 1, H - 1);
      const fx = x - x0;
      const fy = y - y0;
      const h00 = height[y0 * W + x0];
      const h10 = height[y0 * W + x1];
      const h01 = height[y1 * W + x0];
      const h11 = height[y1 * W + x1];
      const top = h00 + (h10 - h00) * fx;
      const bot = h01 + (h11 - h01) * fx;
      return top + (bot - top) * fy;
    };

    return {
      elevation,
      ok: true,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
      zoom: z,
      tiles: nx * ny,
    };
  } catch {
    return flatDEM;
  }
}
