import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import type {
  DisplacementResponse,
  GridResponse,
  ProjectDetail,
  ProjectSummary,
  TimeseriesResponse,
} from "./api/types";
import { colorFor } from "./lib/colormaps";
import { computeDomain, percentile } from "./lib/stats";
import { useSettings } from "./state/settings";
import MapView from "./components/MapView";
import SidePanel from "./components/SidePanel";
import TimeSeriesPanel from "./components/TimeSeriesPanel";

export default function App() {
  // Display settings (colorBy, colormap, clip, shape, …) live in context
  const { settings } = useSettings();
  const { colorBy, clipPct, showData } = settings;
  const cmapId = settings.colormap[colorBy];

  // Projects
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [dataRoot, setDataRoot] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // Grid data (fetched once per project; filtered/colored client-side)
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState<string | null>(null);
  const [cohMin, setCohMin] = useState(0.3);

  // Displacement cube (date × cell) — fetched lazily, only when the
  // Displacement layer is selected. `dateIdx` is which epoch is on screen.
  const [disp, setDisp] = useState<DisplacementResponse | null>(null);
  const [dispLoading, setDispLoading] = useState(false);
  const [dispError, setDispError] = useState<string | null>(null);
  const [dateIdx, setDateIdx] = useState(0);
  const dispReqRef = useRef<string | null>(null);

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
      setGrid(null);
      setGridError(null);
      setGridLoading(true);
      setDisp(null);
      setDispError(null);
      dispReqRef.current = null;
      clearSelection();
      api
        .projectDetail(id)
        .then(setDetail)
        .catch((e: Error) => setGridError(e.message));
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

  // Load a results folder from disk via the native picker
  const openFolder = useCallback(
    () => {
      setOpenBusy(true);
      setOpenError(null);
      api
        .openFolderDialog()
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

  // The displacement cube (date × cell) is much larger than the grid, so it
  // is fetched lazily — only the first time the Displacement layer is chosen
  // for a project. The ref dedupes concurrent fetches and ignores responses
  // that arrive after the user switched projects.
  useEffect(() => {
    if (colorBy !== "disp" || !selectedId || disp) return;
    if (dispReqRef.current === selectedId) return; // already fetching this one
    dispReqRef.current = selectedId;
    setDispLoading(true);
    setDispError(null);
    api
      .displacement(selectedId)
      .then((d) => {
        if (dispReqRef.current !== selectedId) return; // project changed
        setDisp(d);
        // Default to the final epoch (full accumulated deformation) rather
        // than the all-white reference date.
        setDateIdx(d.dates.length > 0 ? d.dates.length - 1 : 0);
      })
      .catch((e: Error) => {
        if (dispReqRef.current === selectedId) setDispError(e.message);
      })
      .finally(() => {
        if (dispReqRef.current === selectedId) setDispLoading(false);
      });
  }, [colorBy, selectedId, disp]);

  // Client-side filtering: instant sliders, no re-fetch
  const visibleIdx = useMemo(() => {
    if (!grid) return [];
    const { coh } = grid.cells;
    const out: number[] = [];
    for (let k = 0; k < coh.length; k++) {
      if (coh[k] >= cohMin) out.push(k);
    }
    return out;
  }, [grid, cohMin]);

  const domain = useMemo(() => {
    if (!grid) return { min: -1, max: 1 };

    // Displacement: pin the colour scale to the FINAL epoch's spread so it
    // never shifts as you slide the date. At the reference date values are
    // ~0 (white, the centre of the diverging map); later epochs fill in
    // toward that fixed range.
    if (colorBy === "disp") {
      const nDates = disp?.dates.length ?? 0;
      const finalRow = nDates > 0 ? disp!.cells.disp[nDates - 1] : null;
      if (!finalRow) return { min: -1, max: 1 };
      const values: number[] = [];
      for (const k of visibleIdx) {
        const v = finalRow[k];
        if (v != null) values.push(v);
      }
      return computeDomain(values, true, clipPct); // symmetric around 0
    }

    // Guard: colorBy can reference a layer this grid doesn't have (stale
    // persisted settings / older backend) — don't crash the whole app.
    const vals = grid.cells[colorBy];
    if (!vals) return { min: -1, max: 1 };
    const values = visibleIdx.map((k) => vals[k]);
    // Coherence: anchor the scale at 0 (a 0.30 pixel shouldn't look pitch
    // black) but let the clip slider set the upper end from the data.
    if (colorBy === "coh") {
      const max = percentile(values, clipPct);
      return { min: 0, max: max > 0 ? max : 1 };
    }
    return computeDomain(values, colorBy === "vel", clipPct);
  }, [grid, visibleIdx, colorBy, clipPct, disp]);

  const colorOf = useMemo(() => {
    if (!grid) return () => "#000";
    // Displacement at the currently-selected epoch; null pixels (NaN that
    // date) draw transparent. Domain stays pinned to the final epoch above.
    if (colorBy === "disp") {
      const row = disp?.cells.disp[dateIdx];
      if (!row) return () => "rgba(0,0,0,0)";
      return (k: number) => {
        const v = row[k];
        return v == null ? "rgba(0,0,0,0)" : colorFor(v, domain, cmapId);
      };
    }
    const vals = grid.cells[colorBy];
    if (!vals) return () => "#000";
    return (k: number) => colorFor(vals[k], domain, cmapId);
  }, [grid, colorBy, cmapId, domain, disp, dateIdx]);

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
      : colorBy === "disp" && dispError
        ? `Could not load displacement: ${dispError}`
      : !showData
        ? null
        : !gridLoading && grid !== null && grid.count === 0
          ? "This project has no valid (non-NaN) pixels"
          : !gridLoading && grid !== null && visibleIdx.length === 0
            ? "No pixels pass the current filter — lower min coherence"
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
        cohMin={cohMin}
        onCohMin={setCohMin}
        pixelCount={grid ? visibleIdx.length : null}
        gridLoading={gridLoading}
      />
      <main className="main">
        <MapView
          bounds={detail?.bounds ?? null}
          grid={grid}
          visibleIdx={visibleIdx}
          colorOf={colorOf}
          domain={domain}
          selected={selectedCell}
          onPickCell={onPickCell}
          overlayMessage={overlayMessage}
          gridLoading={gridLoading}
          dispDates={disp?.dates ?? null}
          dateIdx={dateIdx}
          onDateIdx={setDateIdx}
          dispLoading={colorBy === "disp" && dispLoading}
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
