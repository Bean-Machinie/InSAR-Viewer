import { COLOR_LABELS, legendGradient } from "../lib/colormaps";
import type { Domain } from "../lib/stats";
import { useSettings } from "../state/settings";

interface Props {
  domain: Domain;
}

function fmt(x: number): string {
  const ax = Math.abs(x);
  if (ax >= 100) return x.toFixed(0);
  if (ax >= 10) return x.toFixed(1);
  return x.toFixed(2).replace(/\.?0+$/, "") || "0";
}

export default function Legend({ domain }: Props) {
  const { settings } = useSettings();
  const colorBy = settings.colorBy;
  const cmapId = settings.colormap[colorBy];
  const { title, units } = COLOR_LABELS[colorBy];
  const mid = (domain.min + domain.max) / 2;
  return (
    <div className="legend">
      <div className="legend-title">
        {title}
        {units ? <span className="legend-units"> ({units})</span> : null}
      </div>
      <div className="legend-bar" style={{ background: legendGradient(cmapId) }} />
      <div className="legend-labels">
        <span>{fmt(domain.min)}</span>
        <span>{fmt(mid)}</span>
        <span>{fmt(domain.max)}</span>
      </div>
      {colorBy === "vel" && cmapId === "buwhrd" && (
        <div className="legend-note">blue = away (subsidence) · red = toward satellite</div>
      )}
    </div>
  );
}
