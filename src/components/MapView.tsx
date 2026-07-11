import { useEffect } from "react";
import {
  CircleMarker,
  ImageOverlay,
  LayersControl,
  MapContainer,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { Bounds, ColorBy, RasterResponse } from "../api/types";
import type { Domain } from "../lib/stats";
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

function ClickCatcher({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

interface Props {
  bounds: Bounds | null;
  raster: RasterResponse | null;
  colorBy: ColorBy;
  domain: Domain;
  selected: { lat: number; lon: number } | null;
  onMapClick: (lat: number, lon: number) => void;
  overlayMessage: string | null;
  rasterLoading: boolean;
}

export default function MapView({
  bounds,
  raster,
  colorBy,
  domain,
  selected,
  onMapClick,
  overlayMessage,
  rasterLoading,
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
        <ClickCatcher onClick={onMapClick} />
        {raster && (
          <ImageOverlay
            url={`data:image/png;base64,${raster.image_base64}`}
            bounds={[
              [raster.bounds.lat_min, raster.bounds.lon_min],
              [raster.bounds.lat_max, raster.bounds.lon_max],
            ]}
            opacity={0.9}
            className="raster-overlay"
          />
        )}
        {selected && (
          <CircleMarker
            center={[selected.lat, selected.lon]}
            radius={8}
            pathOptions={{ color: "#ffffff", weight: 2, fillOpacity: 0 }}
          />
        )}
      </MapContainer>
      {raster && raster.count > 0 && <Legend colorBy={colorBy} domain={domain} />}
      {rasterLoading && <div className="map-loading">Rendering layer…</div>}
      {overlayMessage && (
        <div className="map-overlay-message">{overlayMessage}</div>
      )}
    </div>
  );
}
