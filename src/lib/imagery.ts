/**
 * Satellite/base-map imagery for draping onto the deforming 3D terrain.
 *
 * The 3D terrain is a mesh we build ourselves, so (unlike the 2D Leaflet map)
 * we need the imagery as a single texture. We fetch the handful of map tiles
 * covering the AOI and stitch them into one north-up canvas (row 0 = north,
 * matching deck.gl's terrain convention), then hand back the canvas plus its
 * exact tile-aligned geographic extent so texture coordinates line up.
 *
 * Same CORS-clean tile path the DEM loader uses (crossOrigin="anonymous"), so
 * the canvas is usable as a WebGL texture.
 */
import type { Bounds } from "../api/types";

const TILE = 256;
const MAX_TILES = 24;

const ESRI = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const OSM = (z: number, x: number, y: number) =>
  `https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`;

export interface Imagery {
  /** Stitched imagery as an ImageBitmap (deck.gl's supported texture source). */
  image: ImageBitmap;
  /** Tile-aligned geographic extent of the stitched imagery. */
  west: number;
  east: number;
  north: number;
  south: number;
  ok: boolean;
  zoom: number;
  tiles: number;
}

function lon2tileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}
function lat2tileY(lat: number, z: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
}
function tileX2lon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}
function tileY2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function tileRange(b: Bounds, z: number) {
  const x0 = Math.floor(lon2tileX(b.lon_min, z));
  const x1 = Math.floor(lon2tileX(b.lon_max, z));
  const y0 = Math.floor(lat2tileY(b.lat_max, z)); // north → smaller tile y
  const y1 = Math.floor(lat2tileY(b.lat_min, z));
  const tx0 = Math.min(x0, x1);
  const tx1 = Math.max(x0, x1);
  const ty0 = Math.min(y0, y1);
  const ty1 = Math.max(y0, y1);
  return { tx0, tx1, ty0, ty1, nx: tx1 - tx0 + 1, ny: ty1 - ty0 + 1 };
}

/** Highest zoom keeping the tile count under MAX_TILES (finer imagery). */
function chooseZoom(b: Bounds): number {
  for (let z = 18; z >= 6; z--) {
    const { nx, ny } = tileRange(b, z);
    if (nx * ny <= MAX_TILES) return z;
  }
  return 6;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile failed: ${url}`));
    img.src = url;
  });
}

/**
 * Stitch the imagery covering `bounds`. Never rejects — on failure returns
 * `ok: false` (the caller then falls back to the deformation-coloured terrain).
 */
export async function loadImagery(
  bounds: Bounds,
  baseMap: "esri" | "osm",
): Promise<Imagery | null> {
  try {
    const z = chooseZoom(bounds);
    const { tx0, tx1, ty0, ty1, nx, ny } = tileRange(bounds, z);
    const n = 2 ** z;
    const url = baseMap === "osm" ? OSM : ESRI;

    const canvas = document.createElement("canvas");
    canvas.width = nx * TILE;
    canvas.height = ny * TILE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    await Promise.all(
      Array.from({ length: nx * ny }, (_, k) => {
        const dx = k % nx;
        const dy = Math.floor(k / nx);
        const tx = ((tx0 + dx) % n + n) % n;
        const ty = ty0 + dy;
        if (ty < 0 || ty >= n) return Promise.resolve();
        return loadImage(url(z, tx, ty)).then((img) =>
          ctx.drawImage(img, dx * TILE, dy * TILE),
        );
      }),
    );

    // ImageBitmap is the texture source deck.gl/luma handle reliably (a raw
    // canvas trips their createTexture path). Orientation is preserved.
    const image = await createImageBitmap(canvas);

    return {
      image,
      west: tileX2lon(tx0, z),
      east: tileX2lon(tx1 + 1, z),
      north: tileY2lat(ty0, z),
      south: tileY2lat(ty1 + 1, z),
      ok: true,
      zoom: z,
      tiles: nx * ny,
    };
  } catch {
    return null;
  }
}
