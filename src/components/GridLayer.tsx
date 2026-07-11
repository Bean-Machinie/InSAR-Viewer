import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { GridResponse } from "../api/types";

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
  const stateRef = useRef({ grid, visibleIdx, colorOf, selected, onPickCell });
  stateRef.current = { grid, visibleIdx, colorOf, selected, onPickCell };
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

      const { grid: g, visibleIdx: vis, colorOf: color, selected: sel } =
        stateRef.current;
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
      ctx.globalAlpha = 0.9;
      for (const k of vis) {
        const i = ci[k];
        const j = cj[k];
        const x = Math.min(X[j], X[j + 1]);
        const w = Math.abs(X[j + 1] - X[j]);
        const y = Math.min(Y[i], Y[i + 1]);
        const h = Math.abs(Y[i + 1] - Y[i]);
        if (x + w < 0 || x > size.x || y + h < 0 || y > size.y) continue;
        ctx.fillStyle = color(k);
        ctx.fillRect(x, y, Math.max(w, 1), Math.max(h, 1));
      }
      ctx.globalAlpha = 1;

      // Selected pixel: outline that exact cell
      if (sel && sel.i >= 0 && sel.i < g.lat.length && sel.j >= 0 && sel.j < g.lon.length) {
        const x = Math.min(X[sel.j], X[sel.j + 1]);
        const w = Math.abs(X[sel.j + 1] - X[sel.j]);
        const y = Math.min(Y[sel.i], Y[sel.i + 1]);
        const h = Math.abs(Y[sel.i + 1] - Y[sel.i]);
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 3.5;
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      }
    };
    redrawRef.current = redraw;

    const onClick = (e: L.LeafletMouseEvent) => {
      const { grid: g, onPickCell: pick } = stateRef.current;
      const { cellByIJ: byIJ, visibleSet: visSet } = lookupRef.current;
      if (!g || g.lat.length < 2 || g.lon.length < 2) return;
      // Regular axes → direct index from the click coordinate (exact cell)
      const dLat = g.lat[1] - g.lat[0];
      const dLon = g.lon[1] - g.lon[0];
      const i = Math.round((e.latlng.lat - g.lat[0]) / dLat);
      const j = Math.round((e.latlng.lng - g.lon[0]) / dLon);
      if (i < 0 || i >= g.lat.length || j < 0 || j >= g.lon.length) return;
      // Must actually fall inside the cell footprint
      if (Math.abs(e.latlng.lat - g.lat[i]) > Math.abs(dLat) / 2) return;
      if (Math.abs(e.latlng.lng - g.lon[j]) > Math.abs(dLon) / 2) return;
      const k = byIJ.get(i * g.lon.length + j);
      if (k === undefined || !visSet.has(k)) return; // NaN or filtered out
      pick(k);
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

  // Redraw when data, filters, colors, or selection change
  useEffect(() => {
    redrawRef.current();
  }, [grid, visibleIdx, colorOf, selected]);

  return null;
}
