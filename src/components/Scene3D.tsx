import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import DeckGL from "@deck.gl/react";
import { TerrainLayer } from "@deck.gl/geo-layers";
import { PointCloudLayer } from "@deck.gl/layers";
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
import { buildLut, lutBin } from "../lib/colormaps";
import { loadDEM, type DEM } from "../lib/dem";
import { useSettings } from "../state/settings";
import Legend from "./Legend";
import DateSlider from "./DateSlider";
import {
  ColorByPicker,
  DeformExagSlider,
  PointSizeSlider,
  ShowDataToggle,
  TerrainExagSlider,
  ViewModePicker,
} from "./controls";

const TERRARIUM_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const ESRI_TEXTURE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const OSM_TEXTURE = "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Small lift (scene metres) so on-surface points aren't buried by the mesh. */
const SURFACE_LIFT = 4;

interface Props {
  bounds: Bounds | null;
  grid: GridResponse | null;
  visibleIdx: number[];
  /** Active-layer value per cell (mm for displacement); null → transparent. */
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

/** Oblique camera framing the project's bounds. */
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
    return {
      longitude,
      latitude,
      zoom: Math.min(zoom, 16),
      pitch: 55,
      bearing: -20,
    };
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

/** Collapsible top-right control panel for the 3D scene. */
function Scene3DControls({ hasData }: { hasData: boolean }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <div className="map-ctl">
        <button
          className="map-ctl-btn"
          title="3D display options"
          onClick={() => setOpen(true)}
        >
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
          <button
            className="map-ctl-close"
            aria-label="Collapse"
            onClick={() => setOpen(false)}
          >
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
            <div className="map-ctl-title">3D</div>
            <TerrainExagSlider />
            <DeformExagSlider />
            <PointSizeSlider />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 3D terrain scene (deck.gl). Real topography comes from AWS Terrarium DEM
 * tiles with satellite imagery draped over it; the deformation is a coloured
 * point cloud sitting on that terrain. In the Displacement layer the date
 * slider drives each point's vertical position, so playing time makes the
 * ground visibly sink (subsidence) or rise (uplift) — the same slider that
 * recolours the 2D map here deforms the 3D landscape.
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
  const { colorBy, deformExag, terrainExag, pointSize3d, opacity, showData } = settings;
  const cmapId = settings.colormap[colorBy];
  const deformActive = colorBy === "disp";
  const baseMapTexture = settings.baseMap === "osm" ? OSM_TEXTURE : ESRI_TEXTURE;

  // --- DEM: fetched once per project bounds -------------------------------
  const boundsKey = bounds
    ? `${bounds.lat_min},${bounds.lat_max},${bounds.lon_min},${bounds.lon_max}`
    : "none";
  const [dem, setDem] = useState<DEM | null>(null);
  const [demLoading, setDemLoading] = useState(false);

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

  // Per-cell base terrain elevation (raw metres), aligned to grid.cells.
  const elev = useMemo(() => {
    if (!grid) return new Float32Array(0);
    const { i, j } = grid.cells;
    const out = new Float32Array(i.length);
    const sample = dem?.elevation;
    if (sample) {
      for (let k = 0; k < i.length; k++) out[k] = sample(grid.lat[i[k]], grid.lon[j[k]]);
    }
    return out;
  }, [grid, dem]);

  const lut = useMemo(() => buildLut(cmapId, domain), [cmapId, domain]);

  // A single key that changes whenever any point attribute would change, so
  // deck.gl recomputes the cloud only when it must (data/DEM/date/exag/style).
  const geomKey = `${boundsKey}|${grid?.count ?? 0}|${dem?.zoom ?? "flat"}|${dem?.ok}`;
  const alpha = Math.round(opacity * 255);

  const layers = useMemo(() => {
    if (!bounds) return [];

    const terrain = new TerrainLayer({
      id: "terrain",
      minZoom: 0,
      maxZoom: 15,
      // Terrarium decode, pre-multiplied by the relief exaggeration:
      //   h = (R*256 + G + B/256) - 32768, scaled by terrainExag.
      elevationDecoder: {
        rScaler: 256 * terrainExag,
        gScaler: terrainExag,
        bScaler: terrainExag / 256,
        offset: -32768 * terrainExag,
      },
      elevationData: TERRARIUM_URL,
      texture: baseMapTexture,
      color: [255, 255, 255],
      loadOptions: { image: { type: "imagebitmap" } },
    });

    const result: Layer[] = [terrain];

    if (showData && grid && visibleIdx.length > 0) {
      const { i, j } = grid.cells;
      const getZ = (k: number): number => {
        const base = elev[k] * terrainExag + SURFACE_LIFT;
        if (!deformActive) return base;
        const v = valueOf(k); // mm at the current epoch
        return v == null ? base : base + (v / 1000) * deformExag;
      };

      result.push(
        new PointCloudLayer<number>({
          id: "deform",
          data: visibleIdx,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getPosition: (k: number) => [grid.lon[j[k]], grid.lat[i[k]], getZ(k)],
          getColor: (k: number): [number, number, number, number] => {
            const v = valueOf(k);
            if (v == null) return [0, 0, 0, 0];
            const b = lutBin(lut, v);
            return [lut.r[b], lut.g[b], lut.b[b], alpha];
          },
          pointSize: pointSize3d,
          sizeUnits: "pixels",
          pickable: true,
          material: false,
          updateTriggers: {
            getPosition: [geomKey, dateIdx, deformExag, terrainExag, deformActive],
            getColor: [geomKey, dateIdx, cmapId, domain.min, domain.max, alpha, colorBy],
          },
        }),
      );

      if (selected) {
        const sk = grid.cells.i.findIndex(
          (ii, k) => ii === selected.i && grid.cells.j[k] === selected.j,
        );
        if (sk >= 0) {
          result.push(
            new PointCloudLayer<number>({
              id: "deform-selected",
              data: [sk],
              coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
              getPosition: (k: number) => [grid.lon[j[k]], grid.lat[i[k]], getZ(k) + 2],
              getColor: [255, 255, 255, 255],
              pointSize: pointSize3d + 5,
              sizeUnits: "pixels",
              material: false,
              updateTriggers: {
                getPosition: [geomKey, dateIdx, deformExag, terrainExag, deformActive, selected.i, selected.j],
              },
            }),
          );
        }
      }
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bounds,
    geomKey,
    grid,
    visibleIdx,
    showData,
    elev,
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
    baseMapTexture,
    selected,
    valueOf,
  ]);

  const initialViewState = useMemo(
    () => (bounds ? fitView(bounds) : { longitude: 12.45, latitude: 55.68, zoom: 9, pitch: 55, bearing: -20 }),
    [boundsKey],
  );

  const showTimeline = deformActive && disp !== null && disp.dates.length > 0;

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
          if (info.layer?.id === "deform" && typeof info.object === "number") {
            onPickCell(info.object);
          }
        }}
      />

      <Scene3DControls hasData={grid !== null} />

      {showData && grid !== null && visibleIdx.length > 0 && <Legend domain={domain} />}

      {(demLoading || (deformActive && dispLoading)) && (
        <div className="map-loading">
          {demLoading ? "Loading terrain…" : "Loading displacement…"}
        </div>
      )}

      {dem && !dem.ok && (
        <div className="deck-hint">
          Terrain tiles unavailable — showing deformation on a flat base.
        </div>
      )}

      {overlayMessage && <div className="map-overlay-message">{overlayMessage}</div>}

      {showTimeline && (
        <DateSlider dates={disp.dates} idx={dateIdx} onIdx={onDateIdx} />
      )}
    </div>
  );
}
