import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ColorBy } from "../api/types";
import { DEFAULT_COLORMAP, COLORMAPS } from "../lib/colormaps";
import { SHAPES, type PixelShape } from "../lib/shapes";

export type BaseMap = "esri" | "osm";
export type ViewMode = "2d" | "3d";
/** How the 3D deforming terrain is surfaced. */
export type MapTexture = "satellite" | "deformation";

/**
 * All display/view options in one object. To add a new option:
 *  1. add a field here + a default below,
 *  2. add a control widget (components/controls.tsx),
 *  3. read the field where it takes effect.
 * Nothing else — no prop threading.
 */
export interface DisplaySettings {
  baseMap: BaseMap;
  showData: boolean;
  colorBy: ColorBy;
  /** Colormap id per layer, so each layer remembers its own choice. */
  colormap: Record<ColorBy, string>;
  clipPct: number;
  pixelShape: PixelShape;
  /** Data overlay opacity, 0.2–1. */
  opacity: number;
  /** 2D Leaflet map or 3D deck.gl terrain scene. */
  viewMode: ViewMode;
  /** 3D: mm→scene-metre gain for deformation (how far the ground moves). */
  deformExag: number;
  /** 3D: multiplier on real DEM relief so topography reads clearly. */
  terrainExag: number;
  /** 3D: deformation point radius in pixels. */
  pointSize3d: number;
  /** 3D: drape satellite imagery on the deforming terrain, or colour it by deformation. */
  mapTexture: MapTexture;
  /** 3D: draw the discrete (clickable) data points. */
  showPoints: boolean;
}

const DEFAULTS: DisplaySettings = {
  baseMap: "esri",
  showData: true,
  colorBy: "vel",
  colormap: { ...DEFAULT_COLORMAP },
  clipPct: 98,
  pixelShape: "square",
  opacity: 0.9,
  viewMode: "2d",
  deformExag: 3000,
  terrainExag: 1.5,
  pointSize3d: 3,
  mapTexture: "satellite",
  showPoints: false,
};

const COLOR_BYS: readonly ColorBy[] = ["vel", "coh", "rmse", "disp"];

/** Clamp a possibly-corrupt persisted number into [lo, hi], else fall back. */
function num(v: unknown, lo: number, hi: number, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(hi, Math.max(lo, v))
    : dflt;
}

const STORAGE_KEY = "insar-viewer.display";

function load(): DisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
    const s: DisplaySettings = {
      ...DEFAULTS,
      ...parsed,
      colormap: { ...DEFAULTS.colormap, ...(parsed.colormap ?? {}) },
    };
    // Drop colormap ids / shapes / layers that no longer exist in the registries
    for (const key of Object.keys(s.colormap) as ColorBy[]) {
      if (!COLORMAPS[s.colormap[key]]) s.colormap[key] = DEFAULTS.colormap[key];
    }
    if (!SHAPES[s.pixelShape]) s.pixelShape = DEFAULTS.pixelShape;
    if (!COLOR_BYS.includes(s.colorBy)) s.colorBy = DEFAULTS.colorBy;
    if (s.baseMap !== "esri" && s.baseMap !== "osm") s.baseMap = DEFAULTS.baseMap;
    if (s.viewMode !== "2d" && s.viewMode !== "3d") s.viewMode = DEFAULTS.viewMode;
    s.deformExag = num(s.deformExag, 0, 20000, DEFAULTS.deformExag);
    s.terrainExag = num(s.terrainExag, 1, 5, DEFAULTS.terrainExag);
    s.pointSize3d = num(s.pointSize3d, 1, 10, DEFAULTS.pointSize3d);
    if (s.mapTexture !== "satellite" && s.mapTexture !== "deformation")
      s.mapTexture = DEFAULTS.mapTexture;
    if (typeof s.showPoints !== "boolean") s.showPoints = DEFAULTS.showPoints;
    return s;
  } catch {
    return DEFAULTS;
  }
}

interface SettingsCtx {
  settings: DisplaySettings;
  /** Shallow-merge a partial update, e.g. set({ clipPct: 95 }). */
  set: (patch: Partial<DisplaySettings>) => void;
  /** Set the colormap for one layer. */
  setColormap: (layer: ColorBy, id: string) => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DisplaySettings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const set = useCallback((patch: Partial<DisplaySettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const setColormap = useCallback((layer: ColorBy, id: string) => {
    setSettings((s) => ({ ...s, colormap: { ...s.colormap, [layer]: id } }));
  }, []);

  return <Ctx.Provider value={{ settings, set, setColormap }}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
