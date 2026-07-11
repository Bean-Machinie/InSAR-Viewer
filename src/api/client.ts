import type {
  ColorBy,
  GridResponse,
  ProjectDetail,
  ProjectSummary,
  RasterResponse,
  TimeseriesResponse,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(
      "Cannot reach the backend. Is the API server running? (npm run dev starts both)",
    );
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const getJSON = <T,>(url: string) => request<T>(url);

const postJSON = <T,>(url: string, body: unknown) =>
  request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const api = {
  listProjects: () =>
    getJSON<{ data_root: string; projects: ProjectSummary[] }>("/api/projects"),

  projectDetail: (id: string) =>
    getJSON<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`),

  /** All valid cells (columnar) + axes; fetched once, filtered client-side. */
  grid: (id: string) =>
    getJSON<GridResponse>(`/api/projects/${encodeURIComponent(id)}/grid`),

  /** Filtered grid rendered server-side as a georeferenced PNG. */
  raster: (
    id: string,
    layer: ColorBy,
    cohMin: number,
    rmseMax: number,
    clipPct: number,
  ) =>
    getJSON<RasterResponse>(
      `/api/projects/${encodeURIComponent(id)}/raster?layer=${layer}&coh_min=${cohMin}&rmse_max=${rmseMax}&clip_pct=${clipPct}`,
    ),

  timeseries: (id: string, lat: number, lon: number) =>
    getJSON<TimeseriesResponse>(
      `/api/projects/${encodeURIComponent(id)}/timeseries?lat=${lat}&lon=${lon}`,
    ),

  /** Open a native folder picker on the backend machine and register it. */
  openFolderDialog: () =>
    postJSON<ProjectSummary>("/api/projects/open-dialog", {}),

  /** Register a results folder by absolute path. */
  openFolderPath: (path: string) =>
    postJSON<ProjectSummary>("/api/projects/open", { path }),

  /** Close a project (unregister loaded folder / hide scanned one). */
  removeProject: (id: string) =>
    request<{ removed: string }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};
