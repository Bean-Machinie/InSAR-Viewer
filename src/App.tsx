import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api/client";
import type {
  ColorBy,
  GridResponse,
  ProjectDetail,
  ProjectSummary,
  TimeseriesResponse,
} from "./api/types";
import { colorFor } from "./lib/colormaps";
import { computeDomain } from "./lib/stats";
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

  // Grid data (fetched once per project; filtered/colored client-side)
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState<string | null>(null);
  const [cohMin, setCohMin] = useState(0.3);
  const [rmseMax, setRmseMax] = useState(10);

  // Display
  const [colorBy, setColorBy] = useState<ColorBy>("vel");
  const [clipPct, setClipPct] = useState(98);

  // Selection + time series
  const [selectedCell, setSelectedCell] = useState<{ i: number; j: number } | null>(
    null,
  );
  const [ts, setTs] = useState<TimeseriesResponse | null>(null);
  const [tsLoading, setTsLoading] = useState(false);
  const [tsError, setTsError] = useState<string | null>(null);
  const [tsOpen, setTsOpen] = useState(false);

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

  const clearSelection = useCallback(() => {
    setSelectedCell(null);
    setTs(null);
    setTsOpen(false);
    setTsError(null);
  }, []);

  const selectProject = useCallback(
    (id: string) => {
      setSelectedId(id);
      setDetail(null);
      setDetailLoading(true);
      setGrid(null);
      setGridError(null);
      setGridLoading(true);
      clearSelection();
      api
        .projectDetail(id)
        .then(setDetail)
        .catch((e: Error) => setGridError(e.message))
        .finally(() => setDetailLoading(false));
      api
        .grid(id)
        .then((g) => {
          setGrid(g);
          setGridError(null);
        })
        .catch((e: Error) => {
          setGridError(e.message);
          setGrid(null);
        })
        .finally(() => setGridLoading(false));
    },
    [clearSelection],
  );

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
            setGrid(null);
            setGridError(null);
            clearSelection();
          }
        })
        .catch((e: Error) => setOpenError(e.message));
    },
    [selectedId, clearSelection],
  );

  // Client-side filtering: instant sliders, no re-fetch
  const visibleIdx = useMemo(() => {
    if (!grid) return [];
    const { coh, rmse } = grid.cells;
    const out: number[] = [];
    for (let k = 0; k < coh.length; k++) {
      if (coh[k] >= cohMin && rmse[k] <= rmseMax) out.push(k);
    }
    return out;
  }, [grid, cohMin, rmseMax]);

  const domain = useMemo(() => {
    if (!grid) return { min: -1, max: 1 };
    const vals = grid.cells[colorBy];
    const values = visibleIdx.map((k) => vals[k]);
    return computeDomain(values, colorBy === "vel", clipPct);
  }, [grid, visibleIdx, colorBy, clipPct]);

  const colorOf = useMemo(() => {
    if (!grid) return () => "#000";
    const vals = grid.cells[colorBy];
    return (k: number) => colorFor(vals[k], domain, colorBy);
  }, [grid, colorBy, domain]);

  // Exact-cell click → time series at that cell's centre coordinates
  const onPickCell = useCallback(
    (k: number) => {
      if (!selectedId || !grid) return;
      const i = grid.cells.i[k];
      const j = grid.cells.j[k];
      setSelectedCell({ i, j });
      setTsLoading(true);
      setTsError(null);
      setTsOpen(true);
      api
        .timeseries(selectedId, grid.lat[i], grid.lon[j])
        .then((r) => {
          setTs(r);
          setTsError(null);
        })
        .catch((e: Error) => setTsError(e.message))
        .finally(() => setTsLoading(false));
    },
    [selectedId, grid],
  );

  const overlayMessage = !selectedId
    ? projects.length > 0
      ? "Select a project to load results"
      : null
    : gridError
      ? `Could not load grid: ${gridError}`
      : !gridLoading && grid !== null && grid.count === 0
        ? "This project has no valid (non-NaN) pixels"
        : !gridLoading && grid !== null && visibleIdx.length === 0
          ? "No pixels pass the current filters — relax coherence/RMSE"
          : null;

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
        pixelCount={grid ? visibleIdx.length : null}
        gridLoading={gridLoading}
      />
      <main className="main">
        <MapView
          bounds={detail?.bounds ?? null}
          grid={grid}
          visibleIdx={visibleIdx}
          colorOf={colorOf}
          colorBy={colorBy}
          domain={domain}
          selected={selectedCell}
          onPickCell={onPickCell}
          overlayMessage={overlayMessage}
          gridLoading={gridLoading}
        />
        {tsOpen && (
          <TimeSeriesPanel
            data={ts}
            loading={tsLoading}
            error={tsError}
            onClose={clearSelection}
          />
        )}
      </main>
    </div>
  );
}
