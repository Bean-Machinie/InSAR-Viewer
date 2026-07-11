import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import type {
  ColorBy,
  ProjectDetail,
  ProjectSummary,
  RasterResponse,
  TimeseriesResponse,
} from "./api/types";
import MapView from "./components/MapView";
import SidePanel from "./components/SidePanel";
import TimeSeriesPanel from "./components/TimeSeriesPanel";

export default function App() {
  // Projects
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [dataRoot, setDataRoot] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // Raster layer + filters
  const [raster, setRaster] = useState<RasterResponse | null>(null);
  const [rasterLoading, setRasterLoading] = useState(false);
  const [rasterError, setRasterError] = useState<string | null>(null);
  const [cohMin, setCohMin] = useState(0.3);
  const [rmseMax, setRmseMax] = useState(10);

  // Display
  const [colorBy, setColorBy] = useState<ColorBy>("vel");
  const [clipPct, setClipPct] = useState(98);

  // Time series
  const [ts, setTs] = useState<TimeseriesResponse | null>(null);
  const [tsLoading, setTsLoading] = useState(false);
  const [tsError, setTsError] = useState<string | null>(null);
  const [tsOpen, setTsOpen] = useState(false);

  const fetchSeq = useRef(0);
  // Latest filters, readable from stable callbacks without re-binding
  const filtersRef = useRef({ cohMin, rmseMax });
  filtersRef.current = { cohMin, rmseMax };

  // Retry for a while on startup: the API server often boots slower than
  // vite, so the first fetch can hit a dead port.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      api
        .listProjects()
        .then((r) => {
          if (cancelled) return;
          setProjects(r.projects);
          setDataRoot(r.data_root);
          setProjectsError(null);
          setProjectsLoading(false);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          tries += 1;
          if (tries < 15) {
            setTimeout(attempt, 2000);
          } else {
            setProjectsError(e.message);
            setProjectsLoading(false);
          }
        });
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectProject = useCallback((id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setRaster(null);
    setRasterError(null);
    setTs(null);
    setTsOpen(false);
    api
      .projectDetail(id)
      .then(setDetail)
      .catch((e: Error) => setRasterError(e.message))
      .finally(() => setDetailLoading(false));
  }, []);

  // Fetch the rendered raster whenever project / filters / display change.
  // Debounced so slider drags don't spam the API; stale responses dropped.
  useEffect(() => {
    if (!selectedId) return;
    const seq = ++fetchSeq.current;
    setRasterLoading(true);
    const t = setTimeout(() => {
      api
        .raster(selectedId, colorBy, cohMin, rmseMax, clipPct)
        .then((r) => {
          if (seq !== fetchSeq.current) return;
          setRaster(r);
          setRasterError(null);
        })
        .catch((e: Error) => {
          if (seq !== fetchSeq.current) return;
          setRasterError(e.message);
          setRaster(null);
        })
        .finally(() => {
          if (seq === fetchSeq.current) setRasterLoading(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [selectedId, colorBy, cohMin, rmseMax, clipPct]);

  // Load any results folder from disk: native picker (no arg) or pasted path
  const openFolder = useCallback(
    (path?: string) => {
      setOpenBusy(true);
      setOpenError(null);
      const req = path?.trim()
        ? api.openFolderPath(path.trim())
        : api.openFolderDialog();
      req
        .then((entry) => {
          setProjects((prev) =>
            prev.some((x) => x.id === entry.id) ? prev : [...prev, entry],
          );
          selectProject(entry.id);
        })
        .catch((e: Error) => {
          if (e.message !== "No folder selected") setOpenError(e.message); // cancel is not an error
        })
        .finally(() => setOpenBusy(false));
    },
    [selectProject],
  );

  const removeProject = useCallback(
    (id: string) => {
      api
        .removeProject(id)
        .then(() => {
          setProjects((prev) => prev.filter((x) => x.id !== id));
          if (selectedId === id) {
            setSelectedId(null);
            setDetail(null);
            setRaster(null);
            setRasterError(null);
            setTs(null);
            setTsOpen(false);
          }
        })
        .catch((e: Error) => setOpenError(e.message));
    },
    [selectedId],
  );

  // Map click → nearest-pixel time series. Ignores clicks outside the data
  // extent and pixels that are NaN or excluded by the current filters.
  const onMapClick = useCallback(
    (lat: number, lon: number) => {
      if (!selectedId || !raster) return;
      const b = raster.bounds;
      if (lat < b.lat_min || lat > b.lat_max || lon < b.lon_min || lon > b.lon_max)
        return;
      setTsLoading(true);
      setTsError(null);
      api
        .timeseries(selectedId, lat, lon)
        .then((r) => {
          const { cohMin: c, rmseMax: m } = filtersRef.current;
          const filteredOut =
            r.velocity === null ||
            r.coherence === null ||
            r.rmse === null ||
            r.coherence < c ||
            r.rmse > m;
          if (filteredOut) {
            setTsLoading(false);
            return; // NaN / filtered pixel — ignore the click
          }
          setTs(r);
          setTsOpen(true);
          setTsLoading(false);
        })
        .catch((e: Error) => {
          setTsError(e.message);
          setTsOpen(true);
          setTsLoading(false);
        });
    },
    [selectedId, raster],
  );

  const overlayMessage = !selectedId
    ? projects.length > 0
      ? "Select a project to load results"
      : null
    : rasterError
      ? `Could not render layer: ${rasterError}`
      : !rasterLoading && raster !== null && raster.count === 0
        ? "No pixels pass the current filters — relax coherence/RMSE"
        : null;

  const domain = raster
    ? { min: raster.vmin, max: raster.vmax }
    : { min: -1, max: 1 };

  const selectedLatLon = ts ? { lat: ts.lat, lon: ts.lon } : null;

  return (
    <div className="app">
      <SidePanel
        projects={projects}
        projectsError={projectsError}
        projectsLoading={projectsLoading}
        dataRoot={dataRoot}
        selectedId={selectedId}
        onSelectProject={selectProject}
        onRemoveProject={removeProject}
        onOpenFolder={openFolder}
        openBusy={openBusy}
        openError={openError}
        detail={detail}
        detailLoading={detailLoading}
        cohMin={cohMin}
        rmseMax={rmseMax}
        onCohMin={setCohMin}
        onRmseMax={setRmseMax}
        colorBy={colorBy}
        onColorBy={setColorBy}
        clipPct={clipPct}
        onClipPct={setClipPct}
        pixelCount={raster ? raster.count : null}
        rasterLoading={rasterLoading}
      />
      <main className="main">
        <MapView
          bounds={detail?.bounds ?? null}
          raster={raster}
          colorBy={colorBy}
          domain={domain}
          selected={selectedLatLon}
          onMapClick={onMapClick}
          overlayMessage={overlayMessage}
          rasterLoading={rasterLoading}
        />
        {tsOpen && (
          <TimeSeriesPanel
            data={ts}
            loading={tsLoading}
            error={tsError}
            onClose={() => {
              setTsOpen(false);
              setTs(null);
            }}
          />
        )}
      </main>
    </div>
  );
}
