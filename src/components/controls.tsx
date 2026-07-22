import type { ColorBy } from "../api/types";
import { SHAPE_OPTIONS } from "../lib/shapes";
import { useSettings } from "../state/settings";

/**
 * Small self-contained display-control widgets, all bound to the settings
 * context. Drop any of them into the sidebar, the map panel, or both —
 * placement is a one-line decision.
 */

const COLOR_OPTIONS: { key: ColorBy; label: string }[] = [
  { key: "vel", label: "Velocity" },
  { key: "coh", label: "Coherence" },
  { key: "rmse", label: "RMSE" },
  { key: "disp", label: "Displ." },
];

export function BaseMapPicker() {
  const { settings, set } = useSettings();
  return (
    <>
      <label className="map-ctl-row">
        <input
          type="radio"
          name="basemap"
          checked={settings.baseMap === "esri"}
          onChange={() => set({ baseMap: "esri" })}
        />
        <span>Esri Satellite</span>
      </label>
      <label className="map-ctl-row">
        <input
          type="radio"
          name="basemap"
          checked={settings.baseMap === "osm"}
          onChange={() => set({ baseMap: "osm" })}
        />
        <span>OpenStreetMap</span>
      </label>
    </>
  );
}

export function ShowDataToggle() {
  const { settings, set } = useSettings();
  return (
    <label className="map-ctl-row">
      <input
        type="checkbox"
        checked={settings.showData}
        onChange={(e) => set({ showData: e.target.checked })}
      />
      <span>Show dataset</span>
    </label>
  );
}

export function ColorByPicker() {
  const { settings, set } = useSettings();
  return (
    <div className="segmented">
      {COLOR_OPTIONS.map((o) => (
        <button
          key={o.key}
          className={o.key === settings.colorBy ? "seg-btn active" : "seg-btn"}
          onClick={() => set({ colorBy: o.key })}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ShapePicker() {
  const { settings, set } = useSettings();
  return (
    <div className="segmented">
      {SHAPE_OPTIONS.map((o) => (
        <button
          key={o.key}
          className={o.key === settings.pixelShape ? "seg-btn active" : "seg-btn"}
          onClick={() => set({ pixelShape: o.key })}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ClipSlider() {
  const { settings, set } = useSettings();
  return (
    <label className="slider-row">
      <span className="slider-label">
        Color clip{" "}
        <b>
          {(100 - settings.clipPct).toFixed(0)}–{settings.clipPct.toFixed(0)}%
        </b>
      </span>
      <input
        type="range"
        min={80}
        max={100}
        step={0.5}
        value={settings.clipPct}
        onChange={(e) => set({ clipPct: Number(e.target.value) })}
      />
    </label>
  );
}

export function OpacitySlider() {
  const { settings, set } = useSettings();
  return (
    <label className="slider-row">
      <span className="slider-label">
        Opacity <b>{Math.round(settings.opacity * 100)}%</b>
      </span>
      <input
        type="range"
        min={0.2}
        max={1}
        step={0.05}
        value={settings.opacity}
        onChange={(e) => set({ opacity: Number(e.target.value) })}
      />
    </label>
  );
}

/** 2D map ⇄ 3D terrain scene. */
export function ViewModePicker() {
  const { settings, set } = useSettings();
  return (
    <div className="segmented">
      <button
        className={settings.viewMode === "2d" ? "seg-btn active" : "seg-btn"}
        onClick={() => set({ viewMode: "2d" })}
      >
        2D map
      </button>
      <button
        className={settings.viewMode === "3d" ? "seg-btn active" : "seg-btn"}
        onClick={() => set({ viewMode: "3d" })}
      >
        3D terrain
      </button>
    </div>
  );
}

/** 3D: how strongly deformation displaces the ground vertically. */
export function DeformExagSlider() {
  const { settings, set } = useSettings();
  return (
    <label className="slider-row">
      <span className="slider-label">
        Deformation gain <b>×{settings.deformExag.toLocaleString()}</b>
      </span>
      <input
        type="range"
        min={0}
        max={12000}
        step={100}
        value={settings.deformExag}
        onChange={(e) => set({ deformExag: Number(e.target.value) })}
      />
    </label>
  );
}

/** 3D: relief multiplier on the real DEM. */
export function TerrainExagSlider() {
  const { settings, set } = useSettings();
  return (
    <label className="slider-row">
      <span className="slider-label">
        Terrain relief <b>×{settings.terrainExag.toFixed(1)}</b>
      </span>
      <input
        type="range"
        min={1}
        max={4}
        step={0.1}
        value={settings.terrainExag}
        onChange={(e) => set({ terrainExag: Number(e.target.value) })}
      />
    </label>
  );
}

/** 3D: deformation point radius. */
export function PointSizeSlider() {
  const { settings, set } = useSettings();
  return (
    <label className="slider-row">
      <span className="slider-label">
        Point size <b>{settings.pointSize3d.toFixed(0)}px</b>
      </span>
      <input
        type="range"
        min={1}
        max={8}
        step={0.5}
        value={settings.pointSize3d}
        onChange={(e) => set({ pointSize3d: Number(e.target.value) })}
      />
    </label>
  );
}
