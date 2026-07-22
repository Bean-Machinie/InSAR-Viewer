import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import {
  COORDINATE_SYSTEM,
  Layer,
  MapView as DeckMapView,
  WebMercatorViewport,
  type MapViewState,
  type PickingInfo,
} from "@deck.gl/core";
import type { Bounds, DisplacementResponse, GridResponse } from "../api/types";
import type { Domain } from "../lib/stats";
import { buildLut, lutBin, COLOR_LABELS } from "../lib/colormaps";
import { loadDEM, type DEM } from "../lib/dem";
import { loadImagery, type Imagery } from "../lib/imagery";
import {
  buildFrame,
  buildTerrainBase,
  buildTerrainMesh,
  scatterNodeValues,
  type SurfaceStats,
  type TexExtent,
} from "../lib/surface";
import { useSettings } from "../state/settings";
import Legend from "./Legend";
import DateSlider from "./DateSlider";
import {
  ColorByPicker,
  DeformExagSlider,
  MapTexturePicker,
  PointsToggle,
  PointSizeSlider,
  ShowDataToggle,
  TerrainExagSlider,
  ViewModePicker,
} from "./controls";

const ONE = [0];

interface Props {
  bounds: Bounds | null;
  grid: GridResponse | null;
  visibleIdx: number[];
  valueOf: (cellIdx: number) => number | null;
  domain: Domain;
  disp: DisplacementResponse | null;
  dateIdx: number;
  onDateIdx: Dispatch<SetStateAction<number>>;
  dispLoading: boolean;
  selected: { i: number; j: number } | null;
  onPickCell: (cellIdx: number) => void;
  overlayMessage: string | null;
}

function fitView(bounds: Bounds): MapViewState {
  const width = Math.max(window.innerWidth - 320, 400);
  const height = Math.max(window.innerHeight, 400);
  try {
    const vp = new WebMercatorViewport({ width, height });
    const { longitude, latitude, zoom } = vp.fitBounds(
      [
        [bounds.lon_min, bounds.lat_min],
        [bounds.lon_max, bounds.lat_max],
      ],
      { padding: 60 },
    );
    return { longitude, latitude, zoom: Math.min(zoom, 16), pitch: 55, bearing: -20 };
  } catch {
    return {
      longitude: (bounds.lon_min + bounds.lon_max) / 2,
      latitude: (bounds.lat_min + bounds.lat_max) / 2,
      zoom: 11,
      pitch: 55,
      bearing: -20,
    };
  }
}

function fmt(x: number, nd = 1): string {
  if (!Number.isFinite(x)) return "—";
  const ax = Math.abs(x);
  if (ax >= 1000) return x.toFixed(0);
  if (ax >= 10) return x.toFixed(nd);
  return x.toFixed(nd + 1);
}

function Scene3DControls({ hasData }: { hasData: boolean }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <div className="map-ctl">
        <button className="map-ctl-btn" title="3D display options" onClick={() => setOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" />
            <path d="M3 7l9 5 9-5" />
            <path d="M12 12v10" />
          </svg>
        </button>
      </div>
    );
  }
  return (
    <div className="map-ctl">
      <div className="map-ctl-panel">
        <div className="map-ctl-head">
          <span className="map-ctl-title">View</span>
          <button className="map-ctl-close" aria-label="Collapse" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <div className="map-ctl-seg-wrap">
          <ViewModePicker />
        </div>
        {hasData && (
          <>
            <div className="map-ctl-sep" />
            <div className="map-ctl-title">Dataset</div>
            <ShowDataToggle />
            <div className="map-ctl-seg-wrap">
              <ColorByPicker />
            </div>
            <div className="map-ctl-sep" />
            <div className="map-ctl-title">Terrain surface</div>
            <div className="map-ctl-seg-wrap">
              <MapTexturePicker />
            </div>
            <PointsToggle />
            <div className="map-ctl-sep" />
            <div className="map-ctl-title">Vertical exaggeration</div>
            <TerrainExagSlider />
            <DeformExagSlider />
            <PointSizeSlider />
          </>
        )}
      </div>
    </div>
  );
}

function ScalePanel({
  colorBy,
  terrainExag,
  deformExag,
  elevMin,
  elevMax,
  stats,
  widthKm,
  heightKm,
  dem,
  imagery,
  useSat,
  refDate,
  curDate,
}: {
  colorBy: string;
  terrainExag: number;
  deformExag: number;
  elevMin: number;
  elevMax: number;
  stats: SurfaceStats | null;
  widthKm: number;
  heightKm: number;
  dem: DEM | null;
  imagery: Imagery | null;
  useSat: boolean;
  refDate: string | null;
  curDate: string | null;
}) {
  const isDisp = colorBy === "disp";
  const label = COLOR_LABELS[colorBy as keyof typeof COLOR_LABELS];
  const mPerMm = deformExag / 1000;
  const peakScreen = stats ? (stats.defPeakAbs / 1000) * deformExag : 0;
  return (
    <div className="scale-panel">
      <div className="scale-title">Physical scale</div>

      <div className="scale-row">
        <span>Terrain VE</span>
        <b>×{terrainExag.toFixed(1)}</b>
      </div>
      {isDisp && (
        <div className="scale-row">
          <span>Deformation VE</span>
          <b>×{deformExag.toLocaleString()}</b>
        </div>
      )}
      {isDisp && deformExag > 0 && (
        <div className="scale-sub">1 mm motion → {fmt(mPerMm)} m on screen</div>
      )}

      <div className="scale-sep" />

      <div className="scale-row">
        <span>Terrain relief (real)</span>
        <b>
          {fmt(elevMin, 0)}–{fmt(elevMax, 0)} m
        </b>
      </div>

      {isDisp ? (
        <>
          <div className="scale-row">
            <span>Displacement this date</span>
            <b>{stats ? `${fmt(stats.defMin)} … ${fmt(stats.defMax)}` : "—"} mm</b>
          </div>
          <div className="scale-row">
            <span>Peak |motion|</span>
            <b>{stats ? fmt(stats.defPeakAbs) : "—"} mm</b>
          </div>
          <div className="scale-sub">peak shown as {fmt(peakScreen)} m of vertical relief</div>
        </>
      ) : (
        label && (
          <div className="scale-sub">
            {label.title}
            {label.units ? ` (${label.units})` : ""} — colour only, ground stays
            flat (no time dimension)
          </div>
        )
      )}

      <div className="scale-sep" />

      <div className="scale-row">
        <span>Area extent</span>
        <b>
          {fmt(widthKm)} × {fmt(heightKm)} km
        </b>
      </div>
      <div className="scale-sub">
        DEM:{" "}
        {dem ? (dem.ok ? `Terrarium · z${dem.zoom} · ${dem.tiles} tiles` : "flat (unavailable)") : "loading…"}
      </div>
      <div className="scale-sub">
        Imagery:{" "}
        {useSat
          ? imagery
            ? imagery.ok
              ? `satellite · z${imagery.zoom} · ${imagery.tiles} tiles`
              : "unavailable → deformation colour"
            : "loading…"
          : "deformation colour"}
      </div>
      {isDisp && curDate && (
        <div className="scale-sub">
          {refDate ? `ref ${refDate} → ` : ""}
          {curDate}
        </div>
      )}
      <div className="scale-note">
        Vertical is exaggerated; terrain and deformation use different factors.
        Horizontal is true scale.
      </div>
    </div>
  );
}

/**
 * 3D terrain scene (deck.gl). The terrain is a single mesh built from the grid:
 * every vertex sits at DEM·terrainVE + displacement(date)/1000·deformVE and is
 * draped with satellite imagery (or coloured by deformation). Sliding the date
 * moves the actual ground — subsidence sinks it, uplift raises it — and the
 * points ride on the same surface. The scale panel reports the real numbers.
 */
export default function Scene3D({
  bounds,
  grid,
  visibleIdx,
  valueOf,
  domain,
  disp,
  dateIdx,
  onDateIdx,
  dispLoading,
  selected,
  onPickCell,
  overlayMessage,
}: Props) {
  const { settings } = useSettings();
  const {
    colorBy,
    deformExag,
    terrainExag,
    pointSize3d,
    opacity,
    showData,
    showPoints,
    mapTexture,
    baseMap,
  } = settings;
  const cmapId = settings.colormap[colorBy];
  const deformActive = colorBy === "disp";

  const boundsKey = bounds
    ? `${bounds.lat_min},${bounds.lat_max},${bounds.lon_min},${bounds.lon_max}`
    : "none";

  // --- DEM + imagery, fetched per project bounds --------------------------
  const [dem, setDem] = useState<DEM | null>(null);
  const [demLoading, setDemLoading] = useState(false);
  const [imagery, setImagery] = useState<Imagery | null>(null);
  const [imgLoading, setImgLoading] = useState(false);

  useEffect(() => {
    if (!bounds) {
      setDem(null);
      return;
    }
    let cancelled = false;
    setDem(null);
    setDemLoading(true);
    loadDEM(bounds).then((d) => {
      if (!cancelled) {
        setDem(d);
        setDemLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [boundsKey]);

  useEffect(() => {
    if (!bounds) {
      setImagery(null);
      return;
    }
    let cancelled = false;
    setImagery(null);
    setImgLoading(true);
    loadImagery(bounds, baseMap).then((im) => {
      if (!cancelled) {
        setImagery(im);
        setImgLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [boundsKey, baseMap]);

  const frame = useMemo(() => (grid ? buildFrame(grid.lat, grid.lon) : null), [grid]);

  // Texture extent: imagery's tile-aligned box, or the grid extent as a
  // placeholder when imagery isn't loaded (UVs are unused in colour mode).
  const texExtent = useMemo<TexExtent | null>(() => {
    if (imagery && imagery.ok) {
      return { west: imagery.west, east: imagery.east, north: imagery.north, south: imagery.south };
    }
    if (!grid) return null;
    const lat = grid.lat;
    const lon = grid.lon;
    return {
      west: Math.min(lon[0], lon[lon.length - 1]),
      east: Math.max(lon[0], lon[lon.length - 1]),
      north: Math.max(lat[0], lat[lat.length - 1]),
      south: Math.min(lat[0], lat[lat.length - 1]),
    };
  }, [imagery, grid]);

  // Static terrain scaffolding (positions, elevation, UVs, indices).
  const base = useMemo(() => {
    if (!grid || visibleIdx.length === 0 || !texExtent) return null;
    const sample = dem?.elevation ?? (() => 0);
    return buildTerrainBase(grid, visibleIdx, sample, texExtent);
  }, [grid, visibleIdx, dem, texExtent]);

  // Current-epoch value per grid cell.
  const nodeVal = useMemo(() => {
    if (!grid) return null;
    return scatterNodeValues(grid, visibleIdx, valueOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, visibleIdx, valueOf, dateIdx]);

  const lut = useMemo(() => buildLut(cmapId, domain), [cmapId, domain]);

  // Per-date terrain geometry + physical stats.
  const terrain = useMemo(() => {
    if (!base || !nodeVal) return null;
    return buildTerrainMesh(base, nodeVal, lut, terrainExag, deformExag, deformActive);
  }, [base, nodeVal, lut, terrainExag, deformExag, deformActive]);

  const useSat = mapTexture === "satellite";
  const texture = useSat && imagery && imagery.ok ? imagery.canvas : undefined;
  const geomKey = `${boundsKey}|${grid?.count ?? 0}|${dem?.zoom ?? "flat"}|${dem?.ok}`;
  const alpha = Math.round(opacity * 255);

  const layers = useMemo(() => {
    const result: Layer[] = [];
    if (!showData || !bounds || !frame || !base || !terrain) return result;

    // The terrain IS the map: one mesh, DEM + deformation, satellite-draped.
    result.push(
      new SimpleMeshLayer({
        id: "terrain",
        data: ONE,
        mesh: terrain.mesh,
        texture,
        getPosition: () => [frame.centerLon, frame.centerLat, 0],
        getColor: [255, 255, 255, 255],
        material: false,
        opacity,
        pickable: false,
      }),
    );

    // Clickable data points, riding on the same surface heights.
    if (showPoints && visibleIdx.length > 0) {
      const { i, j } = grid!.cells;
      const origin: [number, number, number] = [frame.centerLon, frame.centerLat, 0];
      const zOf = (k: number): number => {
        const e = base.elevByCell[k];
        const baseZ = (Number.isFinite(e) ? e : 0) * terrainExag;
        if (!deformActive) return baseZ;
        const v = valueOf(k);
        return v == null ? baseZ : baseZ + (v / 1000) * deformExag;
      };

      // Flat billboarded discs (face the camera, constant on-screen size).
      result.push(
        new ScatterplotLayer<number>({
          id: "points",
          data: visibleIdx,
          coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
          coordinateOrigin: origin,
          billboard: true,
          getPosition: (k: number) => [frame.east[j[k]], frame.north[i[k]], zOf(k) + 1],
          getFillColor: (k: number): [number, number, number, number] => {
            const v = valueOf(k);
            if (v == null) return [0, 0, 0, 0];
            const b = lutBin(lut, v);
            return [lut.r[b], lut.g[b], lut.b[b], alpha];
          },
          // Hairline dark edge so discs stay legible over any terrain colour.
          stroked: true,
          getLineColor: [12, 14, 18, Math.round(alpha * 0.5)],
          lineWidthUnits: "pixels",
          getLineWidth: 0.5,
          lineWidthMinPixels: 0.5,
          radiusUnits: "pixels",
          getRadius: pointSize3d,
          radiusMinPixels: 1.5,
          radiusMaxPixels: 32,
          pickable: true,
          updateTriggers: {
            getPosition: [geomKey, dateIdx, deformExag, terrainExag, deformActive],
            getFillColor: [geomKey, dateIdx, cmapId, domain.min, domain.max, alpha, colorBy],
            getLineColor: [alpha],
          },
        }),
      );

      if (selected) {
        const sk = grid!.cells.i.findIndex(
          (ii, k) => ii === selected.i && grid!.cells.j[k] === selected.j,
        );
        if (sk >= 0) {
          const selPos = (k: number): [number, number, number] => [
            frame.east[j[k]],
            frame.north[i[k]],
            zOf(k) + 1,
          ];
          const ringTrigger = [geomKey, dateIdx, deformExag, terrainExag, deformActive, selected.i, selected.j];
          const ring = (id: string, color: [number, number, number, number], width: number) =>
            new ScatterplotLayer<number>({
              id,
              data: [sk],
              coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
              coordinateOrigin: origin,
              billboard: true,
              getPosition: selPos,
              filled: false,
              stroked: true,
              getLineColor: color,
              lineWidthUnits: "pixels",
              getLineWidth: width,
              lineWidthMinPixels: width,
              radiusUnits: "pixels",
              getRadius: pointSize3d + 2.5,
              radiusMinPixels: 3,
              radiusMaxPixels: 34,
              updateTriggers: { getPosition: ringTrigger },
            });
          // Subtle outline: dark halo under a thin white ring, same footprint.
          result.push(ring("points-sel-halo", [0, 0, 0, 170], 3));
          result.push(ring("points-sel-ring", [255, 255, 255, 235], 1.5));
        }
      }
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showData,
    bounds,
    frame,
    base,
    terrain,
    texture,
    opacity,
    geomKey,
    grid,
    showPoints,
    visibleIdx,
    lut,
    deformActive,
    dateIdx,
    deformExag,
    terrainExag,
    pointSize3d,
    alpha,
    cmapId,
    domain.min,
    domain.max,
    colorBy,
    selected,
    valueOf,
  ]);

  const initialViewState = useMemo(
    () =>
      bounds
        ? fitView(bounds)
        : { longitude: 12.45, latitude: 55.68, zoom: 9, pitch: 55, bearing: -20 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boundsKey],
  );

  const showTimeline = deformActive && disp !== null && disp.dates.length > 0;
  const curDate = showTimeline
    ? disp!.dates[Math.min(Math.max(dateIdx, 0), disp!.dates.length - 1)]
    : null;
  const satFailed = useSat && imagery !== null && !imagery.ok;

  return (
    <div className="deck-wrap">
      <DeckGL
        key={boundsKey}
        views={new DeckMapView({ repeat: true })}
        initialViewState={initialViewState}
        controller={{ dragRotate: true, touchRotate: true }}
        layers={layers}
        getCursor={({ isDragging, isHovering }) =>
          isDragging ? "grabbing" : isHovering ? "pointer" : "grab"
        }
        onClick={(info: PickingInfo) => {
          if (info.layer?.id === "points" && typeof info.object === "number") {
            onPickCell(info.object);
          }
        }}
      />

      <Scene3DControls hasData={grid !== null} />

      {showData && grid !== null && visibleIdx.length > 0 && <Legend domain={domain} />}

      {showData && grid !== null && visibleIdx.length > 0 && frame && (
        <ScalePanel
          colorBy={colorBy}
          terrainExag={terrainExag}
          deformExag={deformExag}
          elevMin={base?.elevMin ?? 0}
          elevMax={base?.elevMax ?? 0}
          stats={terrain?.stats ?? null}
          widthKm={frame.widthM / 1000}
          heightKm={frame.heightM / 1000}
          dem={dem}
          imagery={imagery}
          useSat={useSat}
          refDate={disp?.reference_date ?? null}
          curDate={curDate}
        />
      )}

      {(demLoading || imgLoading || (deformActive && dispLoading)) && (
        <div className="map-loading">
          {deformActive && dispLoading
            ? "Loading displacement…"
            : demLoading
              ? "Loading terrain…"
              : "Loading imagery…"}
        </div>
      )}

      {satFailed && (
        <div className="deck-hint">
          Satellite imagery unavailable here — terrain is coloured by deformation instead.
        </div>
      )}

      {overlayMessage && <div className="map-overlay-message">{overlayMessage}</div>}

      {showTimeline && <DateSlider dates={disp!.dates} idx={dateIdx} onIdx={onDateIdx} />}
    </div>
  );
}
