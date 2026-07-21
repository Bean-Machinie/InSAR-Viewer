"""InSAR Screening Results Viewer — FastAPI backend.

Reads SBAS results folders (NetCDF + JSON) and serves JSON to the frontend.

Data root resolution order:
  1. env var INSAR_DATA_ROOT
  2. default ./data (relative to the process working directory)
"""
from __future__ import annotations

import base64
import json
import math
import os
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

import numpy as np
import xarray as xr
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

DATA_ROOT = Path(os.environ.get("INSAR_DATA_ROOT", "./data")).expanduser()

MAX_POINTS_CAP = 50_000

# Fallback filenames if run_metadata.json lacks a `product` index.
DEFAULT_PRODUCTS = {
    "velocity": ("velocity_mm_yr.nc", "velocity_mm_yr"),
    "rmse": ("rmse_mm.nc", "rmse_mm"),
    "coherence": ("coherence_mean.nc", "coherence_mean"),
    "displacement": ("displacement_mm.nc", "displacement_mm"),
}


# ---------------------------------------------------------------------------
# Project loading
# ---------------------------------------------------------------------------

@dataclass
class Project:
    id: str
    path: Path
    meta: dict
    lat: np.ndarray = field(default=None, repr=False)  # type: ignore[assignment]
    lon: np.ndarray = field(default=None, repr=False)  # type: ignore[assignment]
    vel: np.ndarray = field(default=None, repr=False)  # type: ignore[assignment]
    rmse: np.ndarray = field(default=None, repr=False)  # type: ignore[assignment]
    coh: np.ndarray = field(default=None, repr=False)  # type: ignore[assignment]
    disp: xr.DataArray = field(default=None, repr=False)  # type: ignore[assignment]
    warnings: list[str] = field(default_factory=list)


def _product_file(meta: dict, key: str) -> tuple[str, str]:
    """Resolve (filename, variable name) for a layer, preferring metadata."""
    default_file, default_var = DEFAULT_PRODUCTS[key]
    product = meta.get("product") or {}
    for entry in product.values() if isinstance(product, dict) else []:
        if isinstance(entry, dict) and entry.get("file") == default_file:
            return entry.get("file", default_file), entry.get("var", default_var)
    # Also accept product keyed by layer name
    entry = product.get(key) if isinstance(product, dict) else None
    if isinstance(entry, dict) and "file" in entry:
        return entry["file"], entry.get("var", default_var)
    return default_file, default_var


def _open_2d(folder: Path, meta: dict, key: str) -> xr.DataArray:
    fname, var = _product_file(meta, key)
    ds = xr.open_dataset(folder / fname, engine="h5netcdf")
    da = ds[var] if var in ds else ds[list(ds.data_vars)[0]]
    return da.load()


def load_project(folder: Path) -> Project:
    meta = json.loads((folder / "run_metadata.json").read_text())
    proj = Project(id=folder.name, path=folder, meta=meta)

    vel_da = _open_2d(folder, meta, "velocity")
    rmse_da = _open_2d(folder, meta, "rmse")
    coh_da = _open_2d(folder, meta, "coherence")

    lat = np.asarray(vel_da["lat"].values, dtype=np.float64)
    lon = np.asarray(vel_da["lon"].values, dtype=np.float64)

    # Validation: identical axes across layers (assert, don't assume)
    for name, da in (("rmse", rmse_da), ("coherence", coh_da)):
        if not (np.array_equal(np.asarray(da["lat"].values), lat)
                and np.array_equal(np.asarray(da["lon"].values), lon)):
            raise ValueError(f"{name} grid axes do not match velocity grid")

    # Ensure dims are (lat, lon)
    def grid(da: xr.DataArray) -> np.ndarray:
        return np.asarray(da.transpose("lat", "lon").values, dtype=np.float32)

    proj.lat, proj.lon = lat, lon
    proj.vel, proj.rmse, proj.coh = grid(vel_da), grid(rmse_da), grid(coh_da)

    # Sanity checks — flag, don't crash
    finite_coh = proj.coh[np.isfinite(proj.coh)]
    if finite_coh.size and (finite_coh.min() < -0.01 or finite_coh.max() > 1.01):
        proj.warnings.append("coherence values outside [0, 1]")
    finite_vel = proj.vel[np.isfinite(proj.vel)]
    if finite_vel.size and np.abs(finite_vel).max() > 100:
        proj.warnings.append(
            f"velocity magnitudes up to {float(np.abs(finite_vel).max()):.0f} mm/yr "
            "(> 100) — possible unwrapping errors")

    # Displacement cube: open lazily
    disp_file, disp_var = _product_file(meta, "displacement")
    disp_path = folder / disp_file
    if disp_path.exists():
        ds = xr.open_dataset(disp_path, engine="h5netcdf", chunks="auto")
        proj.disp = ds[disp_var] if disp_var in ds else ds[list(ds.data_vars)[0]]
        if proj.disp.sizes.get("date", 0) < 2:
            proj.warnings.append("displacement cube has fewer than 2 dates")
    else:
        proj.warnings.append("displacement_mm.nc missing — time series unavailable")

    return proj


class ProjectStore:
    def __init__(self, root: Path):
        self.root = root
        self._cache: dict[str, Project] = {}
        # Folders opened via the UI ("Load results folder") — any path on disk
        self._extra: dict[str, Path] = {}
        # Root-scanned folders the user closed in the UI
        self._hidden: set[str] = set()
        self._lock = threading.Lock()

    @staticmethod
    def is_results_folder(p: Path) -> bool:
        return (
            p.is_dir()
            and (p / "velocity_mm_yr.nc").exists()
            and (p / "run_metadata.json").exists()
        )

    def scan(self) -> list[Path]:
        if not self.root.is_dir():
            return []
        return sorted(p for p in self.root.iterdir() if self.is_results_folder(p))

    def register(self, folder: Path) -> str:
        """Register an arbitrary results folder; returns its project id."""
        folder = folder.expanduser().resolve()
        if not folder.is_dir():
            raise HTTPException(404, f"Not a folder: {folder}")
        if not self.is_results_folder(folder):
            raise HTTPException(
                422,
                f"'{folder}' is not a valid results folder — it must contain "
                "velocity_mm_yr.nc and run_metadata.json",
            )
        with self._lock:
            for pid, p in self._extra.items():
                if p == folder:
                    return pid
            taken = {f.name for f in self.scan()} | set(self._extra)
            pid, k = folder.name, 2
            while pid in taken:
                pid = f"{folder.name}_{k}"
                k += 1
            self._extra[pid] = folder
        return pid

    def entries(self) -> list[tuple[str, Path]]:
        """All known projects: scanned root folders + UI-registered ones."""
        scanned = [
            (p.name, p.resolve()) for p in self.scan() if p.name not in self._hidden
        ]
        with self._lock:
            extra = list(self._extra.items())
        seen = {p for _, p in scanned}
        return scanned + [(pid, p) for pid, p in extra if p not in seen]

    def folder_for(self, project_id: str) -> Optional[Path]:
        with self._lock:
            if project_id in self._hidden:
                return None
            if project_id in self._extra:
                return self._extra[project_id]
        p = self.root / project_id
        return p if self.is_results_folder(p) else None

    def remove(self, project_id: str) -> bool:
        """Close a project: unregister UI-loaded folders, hide scanned ones."""
        with self._lock:
            self._cache.pop(project_id, None)
            if project_id in self._extra:
                del self._extra[project_id]
                return True
        if self.is_results_folder(self.root / project_id):
            with self._lock:
                self._hidden.add(project_id)
            return True
        return False

    def get(self, project_id: str) -> Project:
        with self._lock:
            if project_id in self._cache:
                return self._cache[project_id]
        folder = self.folder_for(project_id)
        if folder is None:
            raise HTTPException(404, f"Unknown project: {project_id}")
        try:
            proj = load_project(folder)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(422, f"Failed to load project '{project_id}': {exc}")
        proj.id = project_id
        with self._lock:
            self._cache[project_id] = proj
        return proj


store = ProjectStore(DATA_ROOT)

app = FastAPI(title="InSAR Viewer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _meta_summary(meta: dict, warnings: list[str]) -> dict:
    acq = meta.get("acquisition") or {}
    proc = meta.get("processing") or {}
    dates = acq.get("dates") or []
    return {
        "project": meta.get("project"),
        "method": meta.get("method"),
        "orbit": acq.get("orbit"),
        "polarization": acq.get("polarization"),
        "n_dates": len(dates),
        "date_start": dates[0] if dates else None,
        "date_end": dates[-1] if dates else None,
        "reference_date": acq.get("reference_date"),
        "preset": proc.get("preset"),
        "resolution_m": proc.get("resolution_m"),
        "software": proc.get("software"),
        "n_pairs_final": proc.get("n_pairs_final"),
        "warnings": warnings,
    }


def _round(x: float, nd: int) -> float:
    return float(round(x, nd))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "data_root": str(DATA_ROOT.resolve())}


def _project_entry(pid: str, folder: Path) -> dict:
    try:
        meta = json.loads((folder / "run_metadata.json").read_text())
        summary = _meta_summary(meta, [])
    except Exception as exc:  # noqa: BLE001
        summary = {"error": f"unreadable metadata: {exc}"}
    return {"id": pid, "path": str(folder), **summary}


@app.get("/api/projects")
def list_projects() -> dict:
    projects = [_project_entry(pid, folder) for pid, folder in store.entries()]
    return {"data_root": str(DATA_ROOT.resolve()), "projects": projects}


class OpenFolderRequest(BaseModel):
    path: str


@app.post("/api/projects/open")
def open_folder(req: OpenFolderRequest) -> dict:
    """Register any results folder on disk by path and return its entry."""
    pid = store.register(Path(req.path))
    folder = store.folder_for(pid)
    assert folder is not None
    return _project_entry(pid, folder)


# Runs in a separate process: tkinter must own its own main thread/loop,
# and this keeps the API worker clean.
_DIALOG_SCRIPT = """
import tkinter as tk
from tkinter import filedialog
root = tk.Tk()
root.withdraw()
root.attributes("-topmost", True)
path = filedialog.askdirectory(title="Select an SBAS results folder")
print(path or "")
"""


@app.post("/api/projects/open-dialog")
def open_folder_dialog() -> dict:
    """Open a native folder picker on the machine running the backend."""
    try:
        proc = subprocess.run(
            [sys.executable, "-c", _DIALOG_SCRIPT],
            capture_output=True, text=True, timeout=300,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(408, "Folder dialog timed out")
    if proc.returncode != 0:
        raise HTTPException(
            501,
            "Native folder dialog unavailable (tkinter missing?) — "
            "paste the folder path instead",
        )
    path = proc.stdout.strip()
    if not path:
        raise HTTPException(400, "No folder selected")
    return open_folder(OpenFolderRequest(path=path))


@app.delete("/api/projects/{project_id}")
def remove_project(project_id: str) -> dict:
    if not store.remove(project_id):
        raise HTTPException(404, f"Unknown project: {project_id}")
    return {"removed": project_id}


# Colormap stops — kept identical to the frontend legend gradients.
_STOPS = {
    "vel": np.array(  # diverging red–white–blue (red = negative/subsidence)
        [[178, 24, 43], [214, 96, 77], [244, 165, 130], [247, 247, 247],
         [146, 197, 222], [67, 147, 195], [33, 102, 172]], dtype=np.float64),
    "coh": np.array(  # viridis-like
        [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98],
         [253, 231, 37]], dtype=np.float64),
    "rmse": np.array(  # inferno-like
        [[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9],
         [252, 255, 164]], dtype=np.float64),
}


def _apply_ramp(t: np.ndarray, stops: np.ndarray) -> np.ndarray:
    """Map t in [0,1] (H, W) through piecewise-linear RGB stops → (H, W, 3)."""
    n = len(stops)
    x = np.clip(np.nan_to_num(t, nan=0.0), 0.0, 1.0) * (n - 1)
    i = np.clip(np.floor(x).astype(np.int64), 0, n - 2)
    f = (x - i)[..., None]
    rgb = stops[i] * (1.0 - f) + stops[i + 1] * f
    return rgb.astype(np.uint8)


@app.get("/api/projects/{project_id}/raster")
def raster(
    project_id: str,
    layer: str = Query("vel"),
    coh_min: float = Query(0.0, ge=0.0, le=1.0),
    rmse_max: float = Query(1e9, ge=0.0),
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
    clip_pct: float = Query(98.0, ge=50.0, le=100.0),
) -> dict:
    """Render the filtered grid as a PNG at its true pixel footprint.

    Transparent where NaN or filtered out. Bounds are the coordinate extent
    padded by half a cell (cells are centred on their coordinates), so a
    Leaflet ImageOverlay places every data pixel on its ground footprint.
    """
    proj = store.get(project_id)
    grids = {"vel": proj.vel, "coh": proj.coh, "rmse": proj.rmse}
    if layer not in grids:
        raise HTTPException(400, "layer must be one of: vel, coh, rmse")
    data = grids[layer].astype(np.float64)

    mask = (
        np.isfinite(proj.vel) & np.isfinite(proj.coh) & np.isfinite(proj.rmse)
        & (proj.coh >= coh_min) & (proj.rmse <= rmse_max)
    )
    count = int(mask.sum())

    # Color scale: explicit vmin/vmax, else percentile clip of visible values
    # (symmetric around 0 for velocity)
    if vmin is None or vmax is None:
        vals = data[mask]
        if vals.size:
            lo = float(np.percentile(vals, 100.0 - clip_pct))
            hi = float(np.percentile(vals, clip_pct))
        else:
            lo, hi = -1.0, 1.0
        if layer == "vel":
            m = max(abs(lo), abs(hi), 1e-6)
            lo, hi = -m, m
        if vmin is None:
            vmin = lo
        if vmax is None:
            vmax = hi
    if vmax <= vmin:
        vmax = vmin + 1e-6

    t = (data - vmin) / (vmax - vmin)
    rgb = _apply_ramp(np.where(mask, t, np.nan), _STOPS[layer])
    alpha = np.where(mask, 255, 0).astype(np.uint8)
    rgba = np.dstack([rgb, alpha])

    lat, lon = proj.lat, proj.lon
    # North-up image: row 0 must be the northernmost cell
    if lat.size >= 2 and lat[0] < lat[-1]:
        rgba = rgba[::-1, :, :]
    dlat = float(abs(lat[1] - lat[0])) if lat.size >= 2 else 1e-4
    dlon = float(abs(lon[1] - lon[0])) if lon.size >= 2 else 1e-4

    buf = BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)

    return {
        "image_base64": base64.b64encode(buf.getvalue()).decode("ascii"),
        "bounds": {
            "lat_min": float(lat.min()) - dlat / 2,
            "lat_max": float(lat.max()) + dlat / 2,
            "lon_min": float(lon.min()) - dlon / 2,
            "lon_max": float(lon.max()) + dlon / 2,
        },
        "vmin": float(vmin),
        "vmax": float(vmax),
        "count": count,
        "width": int(lon.size),
        "height": int(lat.size),
    }


@app.get("/api/projects/{project_id}/grid")
def grid(project_id: str) -> dict:
    """All valid (non-NaN) cells, columnar, plus the coordinate axes.

    The frontend renders each cell as an exact projected rectangle and
    filters/colors client-side, so this is fetched once per project.
    """
    proj = store.get(project_id)
    mask = np.isfinite(proj.vel) & np.isfinite(proj.coh) & np.isfinite(proj.rmse)
    ii, jj = np.nonzero(mask)
    return {
        "lat": np.round(proj.lat, 8).tolist(),
        "lon": np.round(proj.lon, 8).tolist(),
        "count": int(ii.size),
        "cells": {
            "i": ii.tolist(),
            "j": jj.tolist(),
            "vel": np.round(proj.vel[ii, jj].astype(np.float64), 2).tolist(),
            "coh": np.round(proj.coh[ii, jj].astype(np.float64), 3).tolist(),
            "rmse": np.round(proj.rmse[ii, jj].astype(np.float64), 2).tolist(),
        },
    }


@app.get("/api/projects/{project_id}/displacement")
def displacement(project_id: str) -> dict:
    """Full displacement cube for every valid cell, columnar per date.

    Cells are emitted in the *same order* as ``/grid`` (identical validity
    mask + ``np.nonzero``), so the frontend can index the displacement of
    cell ``k`` at date ``t`` as ``disp[t][k]`` and reuse the grid geometry
    and coherence filter unchanged. NaN epochs become ``null``. Rounded to
    0.1 mm to keep the payload compact.
    """
    proj = store.get(project_id)
    if proj.disp is None:
        raise HTTPException(422, "This project has no displacement cube")

    da = proj.disp.transpose("date", "lat", "lon")
    if da.sizes.get("lat") != proj.lat.size or da.sizes.get("lon") != proj.lon.size:
        raise HTTPException(422, "displacement grid axes do not match velocity grid")

    # Same mask/order as /grid so cell index k lines up across both responses.
    mask = np.isfinite(proj.vel) & np.isfinite(proj.coh) & np.isfinite(proj.rmse)
    ii, jj = np.nonzero(mask)

    cube = np.asarray(da.values, dtype=np.float64)  # (n_dates, n_lat, n_lon)
    vals = np.round(cube[:, ii, jj], 1)             # (n_dates, n_cells)

    # NaN -> None, vectorised (avoids a per-element Python loop over the cube).
    obj = vals.astype(object)
    obj[~np.isfinite(vals)] = None

    dates = [
        str(d)[:10]
        for d in np.asarray(da["date"].values, dtype="datetime64[D]")
    ]
    acq = proj.meta.get("acquisition") or {}
    return {
        "dates": dates,
        "count": int(ii.size),
        "reference_date": acq.get("reference_date"),
        "cells": {"disp": obj.tolist()},
    }


@app.get("/api/projects/{project_id}")
def project_detail(project_id: str) -> dict:
    proj = store.get(project_id)
    lat, lon = proj.lat, proj.lon
    valid = np.isfinite(proj.vel)
    return {
        "id": proj.id,
        **_meta_summary(proj.meta, proj.warnings),
        "grid": {
            "n_lat": int(lat.size),
            "n_lon": int(lon.size),
            "n_valid": int(valid.sum()),
        },
        "bounds": {
            "lat_min": float(lat.min()),
            "lat_max": float(lat.max()),
            "lon_min": float(lon.min()),
            "lon_max": float(lon.max()),
        },
    }


@app.get("/api/projects/{project_id}/points")
def points(
    project_id: str,
    coh_min: float = Query(0.0, ge=0.0, le=1.0),
    rmse_max: float = Query(1e9, ge=0.0),
    max_points: int = Query(MAX_POINTS_CAP, ge=1, le=MAX_POINTS_CAP),
) -> dict:
    proj = store.get(project_id)
    vel, coh, rmse = proj.vel, proj.coh, proj.rmse

    mask = np.isfinite(vel) & np.isfinite(coh) & np.isfinite(rmse)
    mask &= (coh >= coh_min) & (rmse <= rmse_max)
    ii, jj = np.nonzero(mask)
    total = int(ii.size)

    subsampled = total > max_points
    if subsampled:
        keep = np.random.default_rng(42).choice(total, size=max_points, replace=False)
        keep.sort()
        ii, jj = ii[keep], jj[keep]

    lats = proj.lat[ii]
    lons = proj.lon[jj]
    v, c, r = vel[ii, jj], coh[ii, jj], rmse[ii, jj]

    pts = [
        {
            "lat": _round(la, 6),
            "lon": _round(lo, 6),
            "vel": _round(float(vv), 2),
            "coh": _round(float(cc), 3),
            "rmse": _round(float(rr), 2),
        }
        for la, lo, vv, cc, rr in zip(lats, lons, v, c, r)
    ]
    return {
        "count": len(pts),
        "count_total": total,
        "subsampled": subsampled,
        "points": pts,
    }


@app.get("/api/projects/{project_id}/timeseries")
def timeseries(project_id: str, lat: float, lon: float) -> dict:
    proj = store.get(project_id)
    if proj.disp is None:
        raise HTTPException(422, "This project has no displacement cube")

    # Nearest-neighbour — works for ascending or descending axes
    i = int(np.argmin(np.abs(proj.lat - lat)))
    j = int(np.argmin(np.abs(proj.lon - lon)))

    series = proj.disp.transpose("date", "lat", "lon").isel(lat=i, lon=j).compute()
    values = np.asarray(series.values, dtype=np.float64)
    dates = [str(d)[:10] for d in np.asarray(series["date"].values, dtype="datetime64[D]")]

    disp_out: list[Optional[float]] = [
        _round(x, 2) if math.isfinite(x) else None for x in values
    ]

    # Linear trend over valid epochs (days since first date)
    t_days = (
        np.asarray(series["date"].values, dtype="datetime64[D]")
        - np.asarray(series["date"].values[0], dtype="datetime64[D]")
    ).astype(float)
    ok = np.isfinite(values)
    trend_out: list[Optional[float]] = [None] * len(values)
    if ok.sum() >= 2:
        slope, intercept = np.polyfit(t_days[ok], values[ok], 1)
        fitted = slope * t_days + intercept
        trend_out = [_round(x, 2) for x in fitted]

    def pixel(arr: np.ndarray) -> Optional[float]:
        x = float(arr[i, j])
        return _round(x, 3) if math.isfinite(x) else None

    return {
        "lat": _round(float(proj.lat[i]), 6),
        "lon": _round(float(proj.lon[j]), 6),
        "dates": dates,
        "displacement_mm": disp_out,
        "trend_mm": trend_out,
        "velocity": pixel(proj.vel),
        "rmse": pixel(proj.rmse),
        "coherence": pixel(proj.coh),
        "n_valid_epochs": int(ok.sum()),
    }


def _serialize_meta(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _serialize_meta(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize_meta(v) for v in obj]
    return obj


@app.get("/api/projects/{project_id}/metadata")
def full_metadata(project_id: str) -> dict:
    proj = store.get(project_id)
    return _serialize_meta(proj.meta)
