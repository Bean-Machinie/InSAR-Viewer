import { useState } from "react";
import type { ColorBy, ProjectDetail, ProjectSummary } from "../api/types";

interface Props {
  projects: ProjectSummary[];
  projectsError: string | null;
  projectsLoading: boolean;
  dataRoot: string | null;
  selectedId: string | null;
  onSelectProject: (id: string) => void;
  onRemoveProject: (id: string) => void;
  onOpenFolder: (path?: string) => void;
  openBusy: boolean;
  openError: string | null;
  detail: ProjectDetail | null;
  detailLoading: boolean;
  cohMin: number;
  rmseMax: number;
  onCohMin: (v: number) => void;
  onRmseMax: (v: number) => void;
  colorBy: ColorBy;
  onColorBy: (v: ColorBy) => void;
  clipPct: number;
  onClipPct: (v: number) => void;
  pixelCount: number | null;
  rasterLoading: boolean;
}

function orbitLabel(o?: string | null): string {
  if (o === "A") return "Ascending";
  if (o === "D") return "Descending";
  return o ?? "—";
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const s = d.replace(/-/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : d;
}

const COLOR_OPTIONS: { key: ColorBy; label: string }[] = [
  { key: "vel", label: "Velocity" },
  { key: "coh", label: "Coherence" },
  { key: "rmse", label: "RMSE" },
];

export default function SidePanel(p: Props) {
  const [pathInput, setPathInput] = useState("");
  return (
    <aside className="side-panel">
      <header className="panel-header">
        <h1>InSAR Viewer</h1>
        <div className="subtitle">SBAS screening results</div>
      </header>

      <section className="panel-section">
        <h2>Projects</h2>
        <button
          className="open-btn"
          onClick={() => p.onOpenFolder()}
          disabled={p.openBusy}
        >
          {p.openBusy ? "Waiting for folder…" : "Load results folder…"}
        </button>
        <form
          className="path-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (pathInput.trim()) {
              p.onOpenFolder(pathInput);
              setPathInput("");
            }
          }}
        >
          <input
            type="text"
            placeholder="…or paste a folder path"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            disabled={p.openBusy}
            spellCheck={false}
          />
          <button type="submit" disabled={p.openBusy || !pathInput.trim()}>
            Add
          </button>
        </form>
        {p.openError && <div className="error-box open-error">{p.openError}</div>}
        {p.projectsLoading && <div className="muted">Scanning results folders…</div>}
        {p.projectsError && (
          <div className="error-box">
            {p.projectsError}
          </div>
        )}
        {!p.projectsLoading && !p.projectsError && p.projects.length === 0 && (
          <div className="muted">
            No projects loaded yet. Click “Load results folder…” and pick any
            folder containing velocity_mm_yr.nc + run_metadata.json.
            {p.dataRoot ? ` Folders inside ${p.dataRoot} are listed automatically.` : ""}
          </div>
        )}
        <ul className="project-list">
          {p.projects.map((proj) => (
            <li key={proj.id} className="project-item">
              <button
                className={proj.id === p.selectedId ? "project-btn active" : "project-btn"}
                onClick={() => p.onSelectProject(proj.id)}
                disabled={!!proj.error}
                title={proj.error ?? proj.path ?? undefined}
              >
                <span className="project-name">{proj.id}</span>
                {proj.error ? (
                  <span className="project-sub">metadata unreadable</span>
                ) : (
                  <span className="project-sub">
                    {fmtDate(proj.date_start)} → {fmtDate(proj.date_end)} ·{" "}
                    {proj.n_dates ?? "?"} dates
                  </span>
                )}
              </button>
              <button
                className="remove-btn"
                title={`Close ${proj.id}`}
                aria-label={`Close ${proj.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onRemoveProject(proj.id);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      {p.selectedId && (
        <section className="panel-section">
          <h2>Metadata</h2>
          {p.detailLoading && <div className="muted">Loading project…</div>}
          {p.detail && (
            <dl className="meta-grid">
              <dt>Date range</dt>
              <dd>
                {fmtDate(p.detail.date_start)} → {fmtDate(p.detail.date_end)}
              </dd>
              <dt>Epochs</dt>
              <dd>{p.detail.n_dates ?? "—"}</dd>
              <dt>Orbit</dt>
              <dd>{orbitLabel(p.detail.orbit)}</dd>
              <dt>Preset</dt>
              <dd>{p.detail.preset ?? "—"}</dd>
              <dt>Resolution</dt>
              <dd>{p.detail.resolution_m ? `${p.detail.resolution_m} m` : "—"}</dd>
              <dt>Pairs</dt>
              <dd>{p.detail.n_pairs_final ?? "—"}</dd>
              <dt>Software</dt>
              <dd>{p.detail.software ?? "—"}</dd>
              <dt>Grid</dt>
              <dd>
                {p.detail.grid.n_lat} × {p.detail.grid.n_lon} (
                {p.detail.grid.n_valid.toLocaleString()} valid px)
              </dd>
            </dl>
          )}
          {p.detail?.warnings && p.detail.warnings.length > 0 && (
            <div className="warn-box">
              {p.detail.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
        </section>
      )}

      {p.selectedId && (
        <section className="panel-section">
          <h2>Quality filters</h2>
          <label className="slider-row">
            <span className="slider-label">
              Min coherence <b>{p.cohMin.toFixed(2)}</b>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={p.cohMin}
              onChange={(e) => p.onCohMin(Number(e.target.value))}
            />
          </label>
          <label className="slider-row">
            <span className="slider-label">
              Max RMSE <b>{p.rmseMax.toFixed(1)} mm</b>
            </span>
            <input
              type="range"
              min={0}
              max={30}
              step={0.5}
              value={p.rmseMax}
              onChange={(e) => p.onRmseMax(Number(e.target.value))}
            />
          </label>
          <div className="count-row">
            {p.rasterLoading ? (
              "Rendering…"
            ) : p.pixelCount !== null ? (
              <>
                <b>{p.pixelCount.toLocaleString()}</b> pixels shown
              </>
            ) : (
              "—"
            )}
          </div>
        </section>
      )}

      {p.selectedId && (
        <section className="panel-section">
          <h2>Display</h2>
          <div className="segmented">
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
        </section>
      )}
    </aside>
  );
}
