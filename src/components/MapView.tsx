import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type { Bounds, GridResponse } from "../api/types";
import type { Domain } from "../lib/stats";
import { useSettings } from "../state/settings";
import { BaseMapPicker, ColorByPicker, ShowDataToggle } from "./controls";
import GridLayer from "./GridLayer";
import Legend from "./Legend";

const ESRI_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTR =
  "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

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

/** Top-right map control: quick view toggles. Styling lives in the sidebar. */
function MapControls({ hasData }: { hasData: boolean }) {
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
          <BaseMapPicker />
          {hasData && (
            <>
              <div className="map-ctl-sep" />
              <div className="map-ctl-title">Dataset</div>
              <ShowDataToggle />
              <div className="map-ctl-seg-wrap">
                <ColorByPicker />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Bottom-centred timeline for the Displacement layer. Slide (or play) across
 * epochs to watch deformation accumulate; the colour scale stays pinned to
 * the final date, so the reference date reads as ~0 (white). Rendered as a
 * sibling overlay (not a Leaflet control), so dragging it never pans the map.
 */
function DateSlider({
  dates,
  idx,
  onIdx,
}: {
  dates: string[];
  idx: number;
  onIdx: Dispatch<SetStateAction<number>>;
}) {
  const [playing, setPlaying] = useState(false);
  const last = dates.length - 1;
  const clamped = Math.min(Math.max(idx, 0), last);

  useEffect(() => {
    if (!playing || dates.length < 2) return;
    const id = window.setInterval(() => {
      onIdx((prev) => (prev >= last ? 0 : prev + 1));
    }, 650);
    return () => window.clearInterval(id);
  }, [playing, last, dates.length, onIdx]);

  return (
    <div className="date-slider" onDoubleClick={(e) => e.stopPropagation()}>
      <button
        className="date-play"
        onClick={() => setPlaying((p) => !p)}
        title={playing ? "Pause" : "Play through dates"}
        disabled={dates.length < 2}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="date-slider-main">
        <div className="date-current">
          <span className="date-value">{dates[clamped]}</span>
          <span className="date-count">
            {clamped + 1} / {dates.length}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={clamped}
          onChange={(e) => {
            setPlaying(false);
            onIdx(Number(e.target.value));
          }}
        />
        <div className="date-ends">
          <span>{dates[0]}</span>
          <span>{dates[last]}</span>
        </div>
      </div>
    </div>
  );
}

interface Props {
  bounds: Bounds | null;
  grid: GridResponse | null;
  visibleIdx: number[];
  /** Raw layer value per cell (null → transparent); colours resolve in GridLayer. */
  valueOf: (cellIdx: number) => number | null;
  domain: Domain;
  selected: { i: number; j: number } | null;
  onPickCell: (cellIdx: number) => void;
  overlayMessage: string | null;
  gridLoading: boolean;
  /** Displacement timeline (null unless the cube is loaded). */
  dispDates: string[] | null;
  dateIdx: number;
  onDateIdx: Dispatch<SetStateAction<number>>;
  dispLoading: boolean;
}

export default function MapView({
  bounds,
  grid,
  visibleIdx,
  valueOf,
  domain,
  selected,
  onPickCell,
  overlayMessage,
  gridLoading,
  dispDates,
  dateIdx,
  onDateIdx,
  dispLoading,
}: Props) {
  const { settings } = useSettings();
  const dispActive = settings.colorBy === "disp";
  return (
    <div className="map-wrap">
      <MapContainer center={[55.68, 12.45]} zoom={11} className="map" zoomControl>
        {settings.baseMap === "esri" ? (
          <TileLayer key="esri" url={ESRI_URL} attribution={ESRI_ATTR} maxZoom={19} />
        ) : (
          <TileLayer key="osm" url={OSM_URL} attribution={OSM_ATTR} maxZoom={19} />
        )}
        <FitBounds bounds={bounds} />
        {settings.showData && (
          <GridLayer
            grid={grid}
            visibleIdx={visibleIdx}
            valueOf={valueOf}
            domain={domain}
            selected={selected}
            onPickCell={onPickCell}
          />
        )}
      </MapContainer>
      <MapControls hasData={grid !== null} />
      {settings.showData && grid !== null && visibleIdx.length > 0 && (
        <Legend domain={domain} />
      )}
      {gridLoading && <div className="map-loading">Loading grid…</div>}
      {overlayMessage && (
        <div className="map-overlay-message">{overlayMessage}</div>
      )}
      {dispActive && dispLoading && (
        <div className="date-slider date-slider-loading">
          Loading displacement…
        </div>
      )}
      {dispActive && !dispLoading && dispDates && dispDates.length > 0 && (
        <DateSlider dates={dispDates} idx={dateIdx} onIdx={onDateIdx} />
      )}
    </div>
  );
}
