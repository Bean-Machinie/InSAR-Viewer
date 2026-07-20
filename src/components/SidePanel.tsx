import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ProjectDetail, ProjectSummary } from "../api/types";

interface Props {
  projects: ProjectSummary[];
  projectsError: string | null;
  projectsLoading: boolean;
  dataRoot: string | null;
  selectedId: string | null;
  onSelectProject: (id: string) => void;
  onRemoveProject: (id: string) => void;
  onOpenFolder: () => void;
  openBusy: boolean;
  openError: string | null;
  cohMin: number;
  onCohMin: (v: number) => void;
  pixelCount: number | null;
  gridLoading: boolean;
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

interface MenuState {
  x: number;
  y: number;
  id: string;
}

function MetadataModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .projectDetail(id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{id}</div>
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {error && <div className="error-box">{error}</div>}
        {!detail && !error && <div className="muted">Loading metadata…</div>}
        {detail && (
          <dl className="meta-grid">
            <dt>Date range</dt>
            <dd>
              {fmtDate(detail.date_start)} → {fmtDate(detail.date_end)}
            </dd>
            <dt>Epochs</dt>
            <dd>{detail.n_dates ?? "—"}</dd>
            <dt>Orbit</dt>
            <dd>{orbitLabel(detail.orbit)}</dd>
            <dt>Preset</dt>
            <dd>{detail.preset ?? "—"}</dd>
            <dt>Resolution</dt>
            <dd>{detail.resolution_m ? `${detail.resolution_m} m` : "—"}</dd>
            <dt>Pairs</dt>
            <dd>{detail.n_pairs_final ?? "—"}</dd>
            <dt>Software</dt>
            <dd>{detail.software ?? "—"}</dd>
            <dt>Grid</dt>
            <dd>
              {detail.grid.n_lat} × {detail.grid.n_lon} (
              {detail.grid.n_valid.toLocaleString()} valid px)
            </dd>
          </dl>
        )}
        {detail?.warnings && detail.warnings.length > 0 && (
          <div className="warn-box">
            {detail.warnings.map((w, i) => (
              <div key={i}>⚠ {w}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SidePanel(p: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [metaFor, setMetaFor] = useState<string | null>(null);

  // Close the context menu on any click, scroll, or Escape
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

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
          {p.openBusy ? "Waiting for folder…" : "Load Dataset"}
        </button>
        {p.openError && <div className="error-box open-error">{p.openError}</div>}
        {p.projectsLoading && <div className="muted">Scanning results folders…</div>}
        {p.projectsError && (
          <div className="error-box">
            {p.projectsError}
          </div>
        )}
        {!p.projectsLoading && !p.projectsError && p.projects.length === 0 && (
          <div className="muted">
            No datasets loaded yet. Click “Load Dataset” and pick any folder
            containing velocity_mm_yr.nc + run_metadata.json.
            {p.dataRoot ? ` Folders inside ${p.dataRoot} are listed automatically.` : ""}
          </div>
        )}
        <ul className="project-list">
          {p.projects.map((proj) => (
            <li key={proj.id} className="project-item">
              <button
                className={proj.id === p.selectedId ? "project-btn active" : "project-btn"}
                onClick={() => p.onSelectProject(proj.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!proj.error) setMenu({ x: e.clientX, y: e.clientY, id: proj.id });
                }}
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
          <div className="count-row">
            {p.gridLoading ? (
              "Loading…"
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

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              setMetaFor(menu.id);
              setMenu(null);
            }}
          >
            Metadata
          </button>
        </div>
      )}

      {metaFor && <MetadataModal id={metaFor} onClose={() => setMetaFor(null)} />}
    </aside>
  );
}
