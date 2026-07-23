import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type { Bounds, GridResponse } from "../api/types";
import type { Domain } from "../lib/stats";
import { useSettings } from "../state/settings";
import { useSceneCapture } from "../lib/capture";
import { BaseMapPicker, ColorByPicker, ShowDataToggle, ViewModePicker } from "./controls";
import GridLayer from "./GridLayer";
import Legend from "./Legend";
import DateSlider from "./DateSlider";

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
function MapControls({
  hasData,
  recording,
  busy,
  onSaveImage,
  onToggleRecording,
}: {
  hasData: boolean;
  recording: boolean;
  busy: boolean;
  onSaveImage: () => void;
  onToggleRecording: () => void;
}) {
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
          <div className="map-ctl-sep" />
          <div className="map-ctl-title">Base map</div>
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
          <div className="map-ctl-sep" />
          <div className="map-ctl-title">Capture</div>
          <div className="capture-row">
            <button className="capture-btn" onClick={onSaveImage} disabled={busy}>
              {busy ? "Saving…" : "Save image"}
            </button>
            <button
              className={recording ? "capture-btn rec active" : "capture-btn rec"}
              onClick={onToggleRecording}
            >
              {recording ? "■ Stop" : "● Record"}
            </button>
          </div>
          <div className="capture-note">
            Captures the map and its panels (not this control box).
          </div>
        </div>
      )}
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const capture = useSceneCapture(wrapRef, "dom");
  return (
    <div className="map-wrap" ref={wrapRef}>
      <MapContainer center={[55.68, 12.45]} zoom={11} className="map" zoomControl>
        {settings.baseMap === "esri" ? (
          <TileLayer
            key="esri"
            url={ESRI_URL}
            attribution={ESRI_ATTR}
            maxZoom={19}
            crossOrigin="anonymous"
          />
        ) : (
          <TileLayer
            key="osm"
            url={OSM_URL}
            attribution={OSM_ATTR}
            maxZoom={19}
            crossOrigin="anonymous"
          />
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
      <MapControls
        hasData={grid !== null}
        recording={capture.recording}
        busy={capture.busy}
        onSaveImage={capture.saveImage}
        onToggleRecording={capture.toggleRecording}
      />
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
