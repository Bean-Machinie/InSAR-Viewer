import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Bottom-centred timeline for the Displacement layer. Slide (or play) across
 * epochs to watch deformation accumulate. Shared by the 2D map and the 3D
 * terrain scene — in 2D it drives pixel colour, in 3D it drives both colour
 * and the vertical displacement of the ground, so the same control literally
 * sinks/lifts the landscape.
 *
 * Rendered as a plain overlay (not a Leaflet/deck control), so dragging it
 * never pans or rotates the view underneath.
 */
export default function DateSlider({
  dates,
  idx,
  onIdx,
}: {
  dates: string[];
  idx: number;
  onIdx: Dispatch<SetStateAction<number>>;
}) {
  const [playing, setPlaying] = useState(false);
  const last = dates.length - 1;
  const clamped = Math.min(Math.max(idx, 0), last);

  useEffect(() => {
    if (!playing || dates.length < 2) return;
    const id = window.setInterval(() => {
      onIdx((prev) => (prev >= last ? 0 : prev + 1));
    }, 650);
    return () => window.clearInterval(id);
  }, [playing, last, dates.length, onIdx]);

  return (
    <div className="date-slider" onDoubleClick={(e) => e.stopPropagation()}>
      <button
        className="date-play"
        onClick={() => setPlaying((p) => !p)}
        title={playing ? "Pause" : "Play through dates"}
        disabled={dates.length < 2}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="date-slider-main">
        <div className="date-current">
          <span className="date-value">{dates[clamped]}</span>
          <span className="date-count">
            {clamped + 1} / {dates.length}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={clamped}
          onChange={(e) => {
            setPlaying(false);
            onIdx(Number(e.target.value));
          }}
        />
        <div className="date-ends">
          <span>{dates[0]}</span>
          <span>{dates[last]}</span>
        </div>
      </div>
    </div>
  );
}
