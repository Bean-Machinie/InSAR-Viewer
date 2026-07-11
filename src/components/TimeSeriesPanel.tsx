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

export default function TimeSeriesPanel({ data, loading, error, onClose }: Props) {
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
    <div className="ts-panel">
      <div className="ts-header">
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
        <ResponsiveContainer width="100%" height={200}>
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
      )}
    </div>
  );
}
