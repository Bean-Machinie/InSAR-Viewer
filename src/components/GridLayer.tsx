import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { GridResponse } from "../api/types";
import { SHAPES, SHAPE_MIN_PX, pointInVerts, type PixelShape } from "../lib/shapes";
import { useSettings } from "../state/settings";

interface Props {
  grid: GridResponse | null;
  /** Indices into grid.cells.* that pass the current filters. */
  visibleIdx: number[];
  colorOf: (cellIdx: number) => string;
  selected: { i: number; j: number } | null;
  onPickCell: (cellIdx: number) => void;
}

/** Cell-edge coordinates: midpoints between centres, ends extrapolated. */
function edges(c: number[]): number[] {
  const n = c.length;
  if (n === 0) return [];
  if (n === 1) return [c[0] - 5e-4, c[0] + 5e-4];
  const e = new Array<number>(n + 1);
  for (let k = 1; k < n; k++) e[k] = (c[k - 1] + c[k]) / 2;
  e[0] = c[0] - (c[1] - c[0]) / 2;
  e[n] = c[n - 1] + (c[n - 1] - c[n - 2]) / 2;
  return e;
}

/**
 * Pixel-strict grid rendering. Every cell is drawn as a rectangle whose
 * corners are the *projected NetCDF cell edges*, recomputed on every
 * pan/zoom and rounded to whole screen pixels. Adjacent cells share the
 * exact same rounded edge, so cells never smear, elongate, or drift the
 * way a CSS-scaled image overlay does.
 */
export default function GridLayer({
  grid,
  visibleIdx,
  colorOf,
  selected,
  onPickCell,
}: Props) {
  const map = useMap();
  const { settings } = useSettings();
  const pixelShape: PixelShape = settings.pixelShape;
  const opacity = settings.opacity;
  const stateRef = useRef({
    grid,
    visibleIdx,
    colorOf,
    selected,
    onPickCell,
    pixelShape,
    opacity,
  });
  stateRef.current = { grid, visibleIdx, colorOf, selected, onPickCell, pixelShape, opacity };
  const redrawRef = useRef<() => void>(() => {});

  // Fast lookups derived once per grid: cell index by (i,j), visibility set
  const cellByIJ = useMemo(() => {
    const m = new Map<number, number>();
    if (grid) {
      const { i, j } = grid.cells;
      const nLon = grid.lon.length;
      for (let k = 0; k < i.length; k++) m.set(i[k] * nLon + j[k], k);
    }
    return m;
  }, [grid]);
  const visibleSet = useMemo(() => new Set(visibleIdx), [visibleIdx]);
  const lookupRef = useRef({ cellByIJ, visibleSet });
  lookupRef.current = { cellByIJ, visibleSet };

  useEffect(() => {
    const canvas = L.DomUtil.create(
      "canvas",
      "grid-canvas leaflet-zoom-hide",
    ) as HTMLCanvasElement;
    canvas.style.pointerEvents = "none";
    map.getPanes().overlayPane.appendChild(canvas);

    const redraw = () => {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size.x, size.y);

      const {
        grid: g,
        visibleIdx: vis,
        colorOf: color,
        selected: sel,
        pixelShape: shape,
        opacity: alpha,
      } = stateRef.current;
      if (!g || g.lat.length === 0 || g.lon.length === 0) return;

      // Project every cell edge once (Web Mercator: X depends only on lon,
      // Y only on lat), then round — shared edges guarantee strict cells.
      const latE = edges(g.lat);
      const lonE = edges(g.lon);
      const refLat = g.lat[0];
      const refLon = g.lon[0];
      const Y = latE.map((v) =>
        Math.round(map.latLngToContainerPoint([v, refLon]).y),
      );
      const X = lonE.map((v) =>
        Math.round(map.latLngToContainerPoint([refLat, v]).x),
      );

      const { i: ci, j: cj } = g.cells;
      // Non-square glyphs are invisible at tiny cell sizes — fall back to
      // plain rects there (also much faster for large grids).
      const cellW = Math.abs(X[1] - X[0]);
      const cellH = Math.abs(Y[1] - Y[0]);
      const shapeDef =
        shape !== "square" && Math.min(cellW, cellH) >= SHAPE_MIN_PX
          ? SHAPES[shape]
          : SHAPES.square;
      ctx.globalAlpha = alpha;
      // rowOffset shapes shift odd rows +w/2, so widen the cull by one cell
      for (const k of vis) {
        const i = ci[k];
        const j = cj[k];
        const x = Math.min(X[j], X[j + 1]);
        const w = Math.abs(X[j + 1] - X[j]);
        const y = Math.min(Y[i], Y[i + 1]);
        const h = Math.abs(Y[i + 1] - Y[i]);
        if (x + 2 * w < 0 || x - w > size.x || y + 2 * h < 0 || y - h > size.y) continue;
        ctx.fillStyle = color(k);
        shapeDef.draw(ctx, x, y, Math.max(w, 1), Math.max(h, 1), i, j);
      }
      ctx.globalAlpha = 1;

      // Selected pixel: outline the exact glyph that was drawn for it
      if (sel && sel.i >= 0 && sel.i < g.lat.length && sel.j >= 0 && sel.j < g.lon.length) {
        const x = Math.min(X[sel.j], X[sel.j + 1]);
        const w = Math.abs(X[sel.j + 1] - X[sel.j]);
        const y = Math.min(Y[sel.i], Y[sel.i + 1]);
        const h = Math.abs(Y[sel.i + 1] - Y[sel.i]);
        shapeDef.trace(ctx, x, y, Math.max(w, 1), Math.max(h, 1), sel.i, sel.j);
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };
    redrawRef.current = redraw;

    const onClick = (e: L.LeafletMouseEvent) => {
      const { grid: g, onPickCell: pick, pixelShape: shape } = stateRef.current;
      const { cellByIJ: byIJ, visibleSet: visSet } = lookupRef.current;
      if (!g || g.lat.length < 2 || g.lon.length < 2) return;
      const dLat = g.lat[1] - g.lat[0];
      const dLon = g.lon[1] - g.lon[0];
      const shapeDef = SHAPES[shape];

      const pickIfVisible = (i: number, j: number) => {
        const k = byIJ.get(i * g.lon.length + j);
        if (k === undefined || !visSet.has(k)) return; // NaN or filtered out
        pick(k);
      };

      // Regular axes → approximate index from the click coordinate
      const i0 = Math.round((e.latlng.lat - g.lat[0]) / dLat);
      const j0 = Math.round((e.latlng.lng - g.lon[0]) / dLon);

      // Glyphs with custom footprints (Cairo pentagons) extend beyond their
      // cells, so hit-test the actual polygons in screen space. Skip when the
      // renderer has fallen back to squares (tiny cells).
      if (shapeDef.verts) {
        const pA = map.latLngToContainerPoint([g.lat[0], g.lon[0]]);
        const pB = map.latLngToContainerPoint([g.lat[0] + dLat, g.lon[0] + dLon]);
        if (Math.min(Math.abs(pB.x - pA.x), Math.abs(pB.y - pA.y)) >= SHAPE_MIN_PX) {
          const pt = e.containerPoint;
          for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
              const i = i0 + di;
              const j = j0 + dj;
              if (i < 0 || i >= g.lat.length || j < 0 || j >= g.lon.length) continue;
              // Cell rect in container px (edges = centre ± half step)
              const c1 = map.latLngToContainerPoint([
                g.lat[i] - dLat / 2,
                g.lon[j] - dLon / 2,
              ]);
              const c2 = map.latLngToContainerPoint([
                g.lat[i] + dLat / 2,
                g.lon[j] + dLon / 2,
              ]);
              const x = Math.min(c1.x, c2.x);
              const y = Math.min(c1.y, c2.y);
              const w = Math.abs(c2.x - c1.x);
              const h = Math.abs(c2.y - c1.y);
              if (w < 1 || h < 1) continue;
              if (
                pointInVerts((pt.x - x) / w, (pt.y - y) / h, shapeDef.verts(i, j))
              ) {
                pickIfVisible(i, j);
                return;
              }
            }
          }
          return;
        }
      }

      // Squares/circles (and tiny-cell fallback): direct cell footprint
      if (i0 < 0 || i0 >= g.lat.length || j0 < 0 || j0 >= g.lon.length) return;
      if (Math.abs(e.latlng.lat - g.lat[i0]) > Math.abs(dLat) / 2) return;
      if (Math.abs(e.latlng.lng - g.lon[j0]) > Math.abs(dLon) / 2) return;
      pickIfVisible(i0, j0);
    };

    map.on("moveend zoomend viewreset resize", redraw);
    map.on("click", onClick);
    redraw();

    return () => {
      map.off("moveend zoomend viewreset resize", redraw);
      map.off("click", onClick);
      canvas.remove();
      redrawRef.current = () => {};
    };
  }, [map]);

  // Redraw when data, filters, colors, selection, or style change
  useEffect(() => {
    redrawRef.current();
  }, [grid, visibleIdx, colorOf, selected, pixelShape, opacity]);

  return null;
}
