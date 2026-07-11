"""Generate a small synthetic SBAS results folder for testing the viewer.

Usage:  python scripts/make_sample_data.py [out_root]

Creates <out_root>/results_sample_copenhagen with the full data contract:
velocity_mm_yr.nc, rmse_mm.nc, coherence_mean.nc, displacement_mm.nc,
run_metadata.json. Default out_root is ./data.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import xarray as xr

out_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("./data")
folder = out_root / "results_sample_copenhagen"
folder.mkdir(parents=True, exist_ok=True)

rng = np.random.default_rng(7)

# Grid around Copenhagen, lat DESCENDING on purpose (spec: never assume order)
n_lat, n_lon = 180, 240
lat = np.linspace(55.75, 55.60, n_lat)
lon = np.linspace(12.30, 12.65, n_lon)
LON, LAT = np.meshgrid(lon, lat)

# Velocity field: background noise + a subsidence bowl + an uplift spot
vel = rng.normal(0, 1.2, (n_lat, n_lon))
vel += -18 * np.exp(-(((LAT - 55.665) / 0.02) ** 2 + ((LON - 12.45) / 0.04) ** 2))
vel += 8 * np.exp(-(((LAT - 55.72) / 0.012) ** 2 + ((LON - 12.58) / 0.02) ** 2))

# Coherence: mostly decent, degraded band; NaN water in the east
coh = np.clip(rng.beta(5, 2, (n_lat, n_lon)), 0, 1)
coh -= 0.35 * np.exp(-(((LON - 12.36) / 0.02) ** 2))
coh = np.clip(coh, 0.02, 0.98)

# RMSE loosely anti-correlated with coherence
rmse = np.clip(rng.gamma(2.0, 2.0, (n_lat, n_lon)) + (1 - coh) * 8, 0.5, 40)

# Water mask (NaN) — eastern strip + random speckle
water = LON > 12.62
speckle = rng.random((n_lat, n_lon)) < 0.15
mask = water | speckle
for a in (vel, coh, rmse):
    a[mask] = np.nan

# Displacement cube: linear trend + seasonal + noise, first epoch = 0
dates = np.array(
    [np.datetime64("2024-01-03") + np.timedelta64(12 * k, "D") for k in range(30)]
)
t_yr = (dates - dates[0]).astype("timedelta64[D]").astype(float) / 365.25
seasonal = 2.0 * np.sin(2 * np.pi * t_yr)
disp = (
    vel[None, :, :] * t_yr[:, None, None]
    + seasonal[:, None, None]
    + rng.normal(0, 1.5, (len(dates), n_lat, n_lon))
)
disp[0] = np.where(mask, np.nan, 0.0)
disp[:, mask] = np.nan
disp[5, rng.random((n_lat, n_lon)) < 0.05] = np.nan  # some NaN epochs

attrs = {"crs": "EPSG:4326"}
coords2d = {"lat": ("lat", lat, {"units": "degrees_north"}),
            "lon": ("lon", lon, {"units": "degrees_east"})}

def save2d(name: str, arr: np.ndarray, units: str) -> None:
    da = xr.DataArray(arr.astype(np.float32), dims=("lat", "lon"), coords=coords2d,
                      name=name, attrs={**attrs, "units": units})
    da.to_netcdf(folder / f"{name}.nc", engine="h5netcdf")

save2d("velocity_mm_yr", vel, "mm/year")
save2d("rmse_mm", rmse, "mm")
save2d("coherence_mean", coh, "1")

xr.DataArray(
    disp.astype(np.float32), dims=("date", "lat", "lon"),
    coords={"date": ("date", dates), **coords2d},
    name="displacement_mm", attrs={**attrs, "units": "mm"},
).to_netcdf(folder / "displacement_mm.nc", engine="h5netcdf")

meta = {
    "project": "sample_copenhagen",
    "aoi_file": "copenhagen.geojson",
    "method": "sbas",
    "run_started_utc": "2026-07-01T08:00:00Z",
    "run_finished_utc": "2026-07-01T11:42:00Z",
    "product": {
        "velocity": {"file": "velocity_mm_yr.nc", "var": "velocity_mm_yr",
                     "units": "mm/year", "dims": ["lat", "lon"]},
        "rmse": {"file": "rmse_mm.nc", "var": "rmse_mm",
                 "units": "mm", "dims": ["lat", "lon"]},
        "coherence": {"file": "coherence_mean.nc", "var": "coherence_mean",
                      "units": "1", "dims": ["lat", "lon"]},
        "displacement": {"file": "displacement_mm.nc", "var": "displacement_mm",
                         "units": "mm", "dims": ["date", "lat", "lon"]},
    },
    "acquisition": {
        "orbit": "D",
        "polarization": "VV",
        "track_bursts": ["T044_092301_IW2"],
        "dates": [str(d).replace("-", "") for d in dates.astype("datetime64[D]")],
        "reference_date": "2024-01-03",
    },
    "processing": {
        "software": "pygmtsar 2025.2.4",
        "preset": "standard",
        "wavelength_m": 400,
        "resolution_m": 90,
        "baseline_days": 60,
        "baseline_meters": 150,
        "n_pairs_final": 84,
    },
}
(folder / "run_metadata.json").write_text(json.dumps(meta, indent=2))
print(f"Sample results written to {folder.resolve()}")
