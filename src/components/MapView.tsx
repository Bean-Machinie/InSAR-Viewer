import { useEffect, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type { Bounds, ColorBy, GridResponse } from "../api/types";
import type { Domain } from "../lib/stats";
import GridLayer from "./GridLayer";
import Legend from "./Legend";

const ESRI_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTR =
  "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export type BaseMap = "esri" | "osm";

function FitBounds({ bounds }: { bounds: Bounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(
      [
        [bounds.lat_min, bounds.lon_min],
        [bounds.lat_max, bounds.lon_max],
      ],
      { padding: [30, 30] },
    );
  }, [map, bounds]);
  return null;
}

const COLOR_OPTIONS: { key: ColorBy; label: string }[] = [
  { key: "vel", label: "Velocity" },
  { key: "coh", label: "Coherence" },
  { key: "rmse", label: "RMSE" },
];

interface ControlProps {
  baseMap: BaseMap;
  onBaseMap: (v: BaseMap) => void;
  hasData: boolean;
  showData: boolean;
  onShowData: (v: boolean) => void;
  colorBy: ColorBy;
  onColorBy: (v: ColorBy) => void;
  clipPct: number;
  onClipPct: (v: number) => void;
}

/** Top-right map control: base layer picker + display options in one panel. */
function MapControls(p: ControlProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="map-ctl" onDoubleClick={(e) => e.stopPropagation()}>
      {!open ? (
        <button
          className="map-ctl-btn"
          title="Map layers & display"
          onClick={() => setOpen(true)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 3 2.5 8.5 12 14l9.5-5.5L12 3Z" />
            <path d="m4 12-1.5 1L12 18.5 21.5 13 20 12" />
            <path d="m4 16.5-1.5 1L12 23l9.5-5.5-1.5-1" />
          </svg>
        </button>
      ) : (
        <div className="map-ctl-panel">
          <div className="map-ctl-head">
            <span className="map-ctl-title">Base map</span>
            <button
              className="map-ctl-close"
              aria-label="Collapse"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <label className="map-ctl-row">
            <input
              type="radio"
              name="basemap"
              checked={p.baseMap === "esri"}
              onChange={() => p.onBaseMap("esri")}
            />
            <span>Esri Satellite</span>
          </label>
          <label className="map-ctl-row">
            <input
              type="radio"
              name="basemap"
              checked={p.baseMap === "osm"}
              onChange={() => p.onBaseMap("osm")}
            />
            <span>OpenStreetMap</span>
          </label>

          {p.hasData && (
            <>
              <div className="map-ctl-sep" />
              <div className="map-ctl-title">Display</div>
              <label className="map-ctl-row">
                <input
                  type="checkbox"
                  checked={p.showData}
                  onChange={(e) => p.onShowData(e.target.checked)}
                />
                <span>Show dataset</span>
              </label>
              <div className="segmented map-ctl-seg">
                {COLOR_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    className={o.key === p.colorBy ? "seg-btn active" : "seg-btn"}
                    onClick={() => p.onColorBy(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <label className="slider-row">
                <span className="slider-label">
                  Color clip{" "}
                  <b>
                    {(100 - p.clipPct).toFixed(0)}–{p.clipPct.toFixed(0)}%
                  </b>
                </span>
                <input
                  type="range"
                  min={80}
                  max={100}
                  step={0.5}
                  value={p.clipPct}
                  onChange={(e) => p.onClipPct(Number(e.target.value))}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  bounds: Bounds | null;
  baseMap: BaseMap;
  onBaseMap: (v: BaseMap) => void;
  grid: GridResponse | null;
  visibleIdx: number[];
  colorOf: (cellIdx: number) => string;
  colorBy: ColorBy;
  onColorBy: (v: ColorBy) => void;
  clipPct: number;
  onClipPct: (v: number) => void;
  showData: boolean;
  onShowData: (v: boolean) => void;
  domain: Domain;
  selected: { i: number; j: number } | null;
  onPickCell: (cellIdx: number) => void;
  overlayMessage: string | null;
  gridLoading: boolean;
}

export default function MapView({
  bounds,
  baseMap,
  onBaseMap,
  grid,
  visibleIdx,
  colorOf,
  colorBy,
  onColorBy,
  clipPct,
  onClipPct,
  showData,
  onShowData,
  domain,
  selected,
  onPickCell,
  overlayMessage,
  gridLoading,
}: Props) {
  return (
    <div className="map-wrap">
      <MapContainer center={[55.68, 12.45]} zoom={11} className="map" zoomControl>
        {baseMap === "esri" ? (
          <TileLayer key="esri" url={ESRI_URL} attribution={ESRI_ATTR} maxZoom={19} />
        ) : (
          <TileLayer key="osm" url={OSM_URL} attribution={OSM_ATTR} maxZoom={19} />
        )}
        <FitBounds bounds={bounds} />
        {showData && (
          <GridLayer
            grid={grid}
            visibleIdx={visibleIdx}
            colorOf={colorOf}
            selected={selected}
            onPickCell={onPickCell}
          />
        )}
      </MapContainer>
      <MapControls
        baseMap={baseMap}
        onBaseMap={onBaseMap}
        hasData={grid !== null}
        showData={showData}
        onShowData={onShowData}
        colorBy={colorBy}
        onColorBy={onColorBy}
        clipPct={clipPct}
        onClipPct={onClipPct}
      />
      {showData && grid !== null && visibleIdx.length > 0 && (
        <Legend colorBy={colorBy} domain={domain} />
      )}
      {gridLoading && <div className="map-loading">Loading grid…</div>}
      {overlayMessage && (
        <div className="map-overlay-message">{overlayMessage}</div>
      )}
    </div>
  );
}
