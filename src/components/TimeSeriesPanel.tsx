import { useCallback, useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeseriesResponse } from "../api/types";

interface Props {
  data: TimeseriesResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STORAGE_KEY = "insar-viewer.ts-window";
const MIN_W = 320;
const MIN_H = 180;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/** Keep the window on-screen: header always reachable, size within viewport. */
function clampRect(r: Rect): Rect {
  const w = clamp(r.w, MIN_W, window.innerWidth - 24);
  const h = clamp(r.h, MIN_H, window.innerHeight - 24);
  return {
    w,
    h,
    x: clamp(r.x, 8, window.innerWidth - w - 8),
    y: clamp(r.y, 8, window.innerHeight - 40),
  };
}

function initialRect(): Rect {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return clampRect(JSON.parse(saved) as Rect);
  } catch {
    /* fall through to default */
  }
  const w = Math.min(620, window.innerWidth - 48);
  const h = 300;
  return clampRect({
    x: window.innerWidth - w - 24,
    y: window.innerHeight - h - 36,
    w,
    h,
  });
}

export default function TimeSeriesPanel({ data, loading, error, onClose }: Props) {
  const [rect, setRect] = useState<Rect>(initialRect);
  const panelRef = useRef<HTMLDivElement>(null);

  // Persist position/size
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rect));
    } catch {
      /* ignore */
    }
  }, [rect]);

  // Sync state when the user resizes via the native CSS resize grip
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const { offsetWidth: w, offsetHeight: h } = el;
      setRect((r) => (r.w === w && r.h === h ? r : { ...r, w, h }));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Keep it on-screen when the app window shrinks
  useEffect(() => {
    const onResize = () => setRect((r) => clampRect(r));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startDrag = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const offX = e.clientX;
    const offY = e.clientY;
    setRect((r0) => {
      const startX = r0.x;
      const startY = r0.y;
      const onMove = (ev: PointerEvent) => {
        setRect((r) =>
          clampRect({ ...r, x: startX + ev.clientX - offX, y: startY + ev.clientY - offY }),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return r0;
    });
  }, []);

  const rows =
    data?.dates.map((d, i) => ({
      date: d,
      disp: data.displacement_mm[i],
      trend: data.trend_mm[i],
    })) ?? [];

  const header = data
    ? `${data.lat.toFixed(5)}°N, ${data.lon.toFixed(5)}°E — ` +
      (data.velocity !== null && data.rmse !== null
        ? `${data.velocity >= 0 ? "+" : ""}${data.velocity.toFixed(1)} ± ${data.rmse.toFixed(1)} mm/yr`
        : "no velocity estimate") +
      (data.coherence !== null ? ` · coh ${data.coherence.toFixed(2)}` : "")
    : "";

  return (
    <div
      ref={panelRef}
      className="ts-panel"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div className="ts-header" onPointerDown={startDrag}>
        <span className="ts-title">
          {loading ? "Loading time series…" : error ? "Time series" : header}
        </span>
        <button className="ts-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      {error && <div className="error-box ts-body">{error}</div>}
      {!error && data && data.n_valid_epochs === 0 && (
        <div className="muted ts-body">All epochs are NaN at this pixel.</div>
      )}
      {!error && data && data.n_valid_epochs > 0 && (
        <div className="ts-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 24, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#2a2a2e" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#9a9aa2", fontSize: 11 }}
                stroke="#3a3a40"
                minTickGap={40}
              />
              <YAxis
                tick={{ fill: "#9a9aa2", fontSize: 11 }}
                stroke="#3a3a40"
                width={52}
                label={{
                  value: "mm",
                  angle: -90,
                  position: "insideLeft",
                  fill: "#9a9aa2",
                  fontSize: 11,
                }}
              />
              <Tooltip
                contentStyle={{
                  background: "#1c1c20",
                  border: "1px solid #3a3a40",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#e6e6ea" }}
                formatter={(value: number | string, name: string) => [
                  typeof value === "number" ? `${value.toFixed(1)} mm` : "—",
                  name === "disp" ? "displacement" : "trend",
                ]}
              />
              <Line
                type="linear"
                dataKey="trend"
                stroke="#8a8a92"
                strokeDasharray="6 4"
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="disp"
                stroke="#5ab4f0"
                strokeWidth={1.5}
                dot={{ r: 2.5, fill: "#5ab4f0", strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
