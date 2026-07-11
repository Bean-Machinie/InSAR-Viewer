# InSAR Viewer

A local web app for viewing satellite InSAR (SBAS) ground-motion results on an
interactive map. Loads results folders produced by the SBAS screening pipeline
(PyGMTSAR) — velocity, coherence, RMSE grids and displacement time series — and
renders them over satellite imagery with quality filtering and
click-to-timeseries.

## Features

- Load any results folder from disk via the "Load results folder…" button
  (native folder picker) or by pasting a path — open several projects from
  different analyses side by side
- Project browser: also scans a results root directory and lists valid results
  folders, with run metadata (date range, orbit, preset, resolution)
- True pixel-footprint rendering: every data cell is drawn as an exact
  projected rectangle between its real NetCDF cell edges, recomputed on each
  pan/zoom — cells never smear, elongate, or drift, at any zoom level.
  Diverging red–white–blue for velocity symmetric around 0
  (red = subsidence-like, blue = uplift-like), sequential colormaps for
  coherence/RMSE, percentile clip control, legend, auto-fit to data bounds
- Quality filtering: min-coherence and max-RMSE sliders with live pixel count
  — instant, filtering happens client-side on the loaded grid
- Click any cell → that exact pixel gets a rectangle highlight and its
  displacement time series opens, with linear trend overlay and
  `velocity ± RMSE mm/yr` in the header; clicks on NaN/filtered cells are
  ignored; NaN epochs handled
- Close any project with the ✕ on its card

## Prerequisites

- Node.js ≥ 18
- Python ≥ 3.10

## Setup

```bash
# 1. JavaScript dependencies
npm install

# 2. Python dependencies (a venv is recommended)
python -m venv .venv
.venv\Scripts\activate          # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r backend/requirements.txt
```

## Run

```bash
npm run dev
```

This starts both servers (via `concurrently`):

- FastAPI backend on http://127.0.0.1:8000 (`python -m uvicorn backend.main:app`)
- Vite dev server on http://127.0.0.1:5173, proxying `/api/*` to the backend

Open http://127.0.0.1:5173. If you used a venv, activate it in the terminal
where you run `npm run dev` so `python -m uvicorn` resolves.

## Loading your results

**In the app (recommended):** click **"Load results folder…"** in the side
panel — a native folder picker opens; select any folder containing
`velocity_mm_yr.nc` + `run_metadata.json`. Or paste an absolute path into the
input below the button. Load as many folders as you like, from anywhere on
disk — each shows up as a project in the list. (Folders loaded this way are
kept for the lifetime of the backend process; reload them after a restart.)

**Via a data root (optional):** the backend also auto-scans a root directory
for valid results subfolders. Default: `./data`. Override with the
`INSAR_DATA_ROOT` environment variable:

```bash
# Windows (PowerShell)
$env:INSAR_DATA_ROOT = "D:\insar\results"; npm run dev

# macOS / Linux
INSAR_DATA_ROOT=/path/to/results npm run dev
```

Each results folder must follow the SBAS screening data contract:
`velocity_mm_yr.nc`, `rmse_mm.nc`, `coherence_mean.nc` (2D lat/lon grids),
`displacement_mm.nc` (date × lat × lon cube) and `run_metadata.json`.
`preview_*.png` and other extra files are ignored. NaN means no data; lat may
be ascending or descending — both are handled.

For development without real data, `scripts/make_sample_data.py` can generate
a synthetic test fixture (clearly named `results_sample_copenhagen`); nothing
is generated automatically.

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Backend status + resolved data root |
| `GET /api/projects` | All known projects (scanned + loaded via UI) with metadata summary |
| `POST /api/projects/open` | Register any results folder by absolute path (`{"path": "..."}`) |
| `POST /api/projects/open-dialog` | Open a native folder picker and register the chosen folder |
| `GET /api/projects/{id}` | Full summary, grid info, bounds, validation warnings |
| `DELETE /api/projects/{id}` | Close a project (unregister UI-loaded / hide scanned) |
| `GET /api/projects/{id}/grid` | All valid cells (columnar `i/j/vel/coh/rmse`) + coordinate axes — what the UI renders |
| `GET /api/projects/{id}/raster?layer=&coh_min=&rmse_max=&vmin=&vmax=&clip_pct=` | Filtered grid as base64 PNG + half-cell-padded bounds (kept for export/embedding) |
| `GET /api/projects/{id}/points?coh_min=&rmse_max=` | Filtered non-NaN pixels as JSON points (legacy) |
| `GET /api/projects/{id}/timeseries?lat=&lon=` | Nearest-neighbour displacement series + linear trend + pixel stats |
| `GET /api/projects/{id}/metadata` | Raw `run_metadata.json` |

## Project structure

```
backend/
  main.py             FastAPI app: folder scanning, NetCDF loading (xarray +
                      h5netcdf), points & timeseries endpoints, validation
  requirements.txt
scripts/
  make_sample_data.py Synthetic results-folder generator for testing
src/
  api/                API client + shared types
  components/         MapView, PointsLayer (canvas renderer), Legend,
                      SidePanel, TimeSeriesPanel
  lib/                colormaps, percentile/domain helpers
  App.tsx             state + data flow
```

## Notes

- The data layer is a canvas that draws each cell as a rectangle between its
  projected cell-edge coordinates (midpoints between NetCDF cell centres,
  ends extrapolated by half a step). Edges are computed once per redraw and
  shared between neighbouring cells, so cell borders are always consistent —
  no CSS image scaling, no nearest-neighbour aliasing. Ascending and
  descending lat both handled.
- The grid is fetched once per project; sliders, colormap switches, and the
  percentile clip are all applied client-side and update instantly.
- Clicks resolve directly to a cell index from the coordinate axes, so the
  highlighted pixel, the time-series lookup, and the rendered rectangle always
  refer to the same cell.
- 2D layers are loaded eagerly and cached in memory per project; the
  displacement cube is opened lazily and only sliced per clicked pixel.
- Out of scope for this draft: authentication, uploads, multi-project
  comparison, raster tiles, vector export.
