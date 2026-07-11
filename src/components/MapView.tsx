import { useEffect } from "react";
import { LayersControl, MapContainer, TileLayer, useMap } from "react-leaflet";
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

interface Props {
  bounds: Bounds | null;
  grid: GridResponse | null;
  visibleIdx: number[];
  colorOf: (cellIdx: number) => string;
  colorBy: ColorBy;
  domain: Domain;
  selected: { i: number; j: number } | null;
  onPickCell: (cellIdx: number) => void;
  overlayMessage: string | null;
  gridLoading: boolean;
}

export default function MapView({
  bounds,
  grid,
  visibleIdx,
  colorOf,
  colorBy,
  domain,
  selected,
  onPickCell,
  overlayMessage,
  gridLoading,
}: Props) {
  return (
    <div className="map-wrap">
      <MapContainer center={[55.68, 12.45]} zoom={11} className="map" zoomControl>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Esri Satellite">
            <TileLayer url={ESRI_URL} attribution={ESRI_ATTR} maxZoom={19} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenStreetMap">
            <TileLayer url={OSM_URL} attribution={OSM_ATTR} maxZoom={19} />
          </LayersControl.BaseLayer>
        </LayersControl>
        <FitBounds bounds={bounds} />
        <GridLayer
          grid={grid}
          visibleIdx={visibleIdx}
          colorOf={colorOf}
          selected={selected}
          onPickCell={onPickCell}
        />
      </MapContainer>
      {grid !== null && visibleIdx.length > 0 && (
        <Legend colorBy={colorBy} domain={domain} />
      )}
      {gridLoading && <div className="map-loading">Loading grid…</div>}
      {overlayMessage && (
        <div className="map-overlay-message">{overlayMessage}</div>
      )}
    </div>
  );
}
