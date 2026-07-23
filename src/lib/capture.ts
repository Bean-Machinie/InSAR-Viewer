/**
 * Screenshot + screen-recording for the map views.
 *
 * Two capture strategies share one hook:
 *
 *  • "composite" (3D / deck.gl): the scene is a WebGL canvas with HTML overlays
 *    floating on top (scale panel, legend, time-series window, date slider). We
 *    draw the live WebGL canvas first, then rasterise the overlays with
 *    html2canvas — ignoring the control panel (`.map-ctl`) and the WebGL canvas
 *    itself — and paint them on top. luma.gl v9 requests the context with
 *    `preserveDrawingBuffer: true`, so the terrain canvas is readable, and our
 *    map tiles are CORS-clean, so it is never tainted.
 *
 *    IMPORTANT: the map container (`.deck-wrap`) has an OPAQUE dark background.
 *    html2canvas would happily rasterise that background and paint it over the
 *    terrain we just drew — leaving a black rectangle with only the panels on
 *    top. So during the clone we force the map containers transparent; the
 *    WebGL terrain then shows through everywhere the overlays don't cover.
 *
 *  • "dom" (2D / Leaflet): the whole scene is DOM — <img> tiles plus a 2D
 *    <canvas> data layer plus the same floating panels. html2canvas can raster
 *    all of that directly, so there is no separate WebGL layer to composite:
 *    one html2canvas pass captures everything (tiles included).
 *
 * The control panel (`.map-ctl`) is never included in either mode.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import html2canvas from "html2canvas";

/** Theme background, used as the base for 2D captures so gaps stay on-brand. */
const SCENE_BG = "#0c0c0f";

export type CaptureMode = "composite" | "dom";

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** The capture root (map column) and, in composite mode, the WebGL canvas. */
function targets(wrap: HTMLElement) {
  // The time-series window is a sibling of the view, so capture the whole map
  // column (`.main`) — that includes it — but never the sidebar.
  const root = (wrap.closest(".main") as HTMLElement) ?? wrap;
  const glCanvas = wrap.querySelector("canvas") as HTMLCanvasElement | null;
  return { root, glCanvas };
}

/**
 * Rasterise the scene DOM.
 *
 * In composite mode the WebGL canvas is excluded (drawn separately) and the
 * opaque map-container backgrounds are neutralised in the clone so the terrain
 * underneath is not hidden. In dom mode everything is rendered, tiles included,
 * on the theme background.
 */
function grabScene(
  root: HTMLElement,
  scale: number,
  mode: CaptureMode,
): Promise<HTMLCanvasElement> {
  return html2canvas(root, {
    // composite: transparent so the WebGL terrain shows through.
    // dom: opaque theme colour as the base layer beneath the tiles.
    backgroundColor: mode === "composite" ? null : SCENE_BG,
    scale,
    logging: false,
    useCORS: true,
    ignoreElements: (el) => {
      // The control box is never part of a capture.
      if (el.classList != null && el.classList.contains("map-ctl")) return true;
      // In composite mode the WebGL canvas is composited separately; skip it
      // here. In dom mode the 2D data canvas MUST be rasterised, so keep it.
      if (mode === "composite" && el.tagName === "CANVAS") return true;
      return false;
    },
    onclone: (doc) => {
      if (mode !== "composite") return;
      // Force the map containers transparent in the clone only — the live UI
      // is untouched — so their opaque background can't cover the terrain.
      doc.querySelectorAll<HTMLElement>(".deck-wrap, .map-wrap, .map").forEach(
        (el) => {
          el.style.background = "transparent";
          el.style.backgroundColor = "transparent";
        },
      );
    },
  });
}

export interface SceneCapture {
  recording: boolean;
  busy: boolean;
  saveImage: () => void;
  toggleRecording: () => void;
}

export function useSceneCapture(
  wrapRef: RefObject<HTMLElement | null>,
  mode: CaptureMode = "composite",
): SceneCapture {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const saveImage = useCallback(async () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const { root, glCanvas } = targets(wrap);
    // Composite mode needs the WebGL canvas; dom mode captures pure DOM.
    if (mode === "composite" && !glCanvas) return;
    setBusy(true);
    try {
      const dpr = window.devicePixelRatio || 1;

      if (mode === "dom") {
        // One pass rasterises tiles + data canvas + panels.
        const shot = await grabScene(root, dpr, mode);
        await new Promise<void>((resolve) =>
          shot.toBlob((b) => {
            if (b) downloadBlob(b, `insar-2d-${stamp()}.png`);
            resolve();
          }, "image/png"),
        );
        return;
      }

      // Composite: WebGL terrain first, overlays on top.
      const overlay = await grabScene(root, dpr, mode);
      const out = document.createElement("canvas");
      out.width = Math.round(root.clientWidth * dpr);
      out.height = Math.round(root.clientHeight * dpr);
      const ctx = out.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(glCanvas!, 0, 0, out.width, out.height);
      ctx.drawImage(overlay, 0, 0, out.width, out.height);
      await new Promise<void>((resolve) =>
        out.toBlob((b) => {
          if (b) downloadBlob(b, `insar-3d-${stamp()}.png`);
          resolve();
        }, "image/png"),
      );
    } finally {
      setBusy(false);
    }
  }, [wrapRef, mode]);

  const startRecording = useCallback(async () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const { root, glCanvas } = targets(wrap);
    if (mode === "composite" && !glCanvas) return;
    if (typeof MediaRecorder === "undefined") return;

    // CSS-pixel resolution keeps the per-frame overlay rasterisation fast.
    const W = root.clientWidth;
    const H = root.clientHeight;
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    let alive = true;
    // In composite mode `snapshot` holds just the overlays; in dom mode it is
    // the whole scene (tiles + data + panels).
    let snapshot: HTMLCanvasElement | null = null;
    let grabbing = false;
    const refresh = async () => {
      if (!alive || grabbing) return; // never overlap html2canvas passes
      grabbing = true;
      try {
        snapshot = await grabScene(root, 1, mode);
      } catch {
        /* keep the previous snapshot */
      } finally {
        grabbing = false;
      }
    };
    await refresh();

    // Refresh periodically so panels (and, in 2D, the animated data layer)
    // track the date. dom mode redraws the whole frame, so refresh a touch
    // faster for smoother playback of the date animation.
    const interval = mode === "dom" ? 250 : 350;
    const timer = window.setInterval(refresh, interval);

    let raf = 0;
    const draw = () => {
      if (!alive) return;
      if (mode === "composite") {
        ctx.drawImage(glCanvas!, 0, 0, W, H);
        if (snapshot) ctx.drawImage(snapshot, 0, 0, W, H);
      } else if (snapshot) {
        ctx.drawImage(snapshot, 0, 0, W, H);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    const stream = out.captureStream(30);
    const mime =
      ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
        (m) => MediaRecorder.isTypeSupported(m),
      ) ?? "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    const suffix = mode === "dom" ? "2d" : "3d";
    rec.onstop = () =>
      downloadBlob(new Blob(chunks, { type: mime }), `insar-${suffix}-${stamp()}.webm`);
    rec.start();

    stopRef.current = () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      if (rec.state !== "inactive") rec.stop();
      stream.getTracks().forEach((t) => t.stop());
    };
    setRecording(true);
  }, [wrapRef, mode]);

  const stopRecording = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (recording) stopRecording();
    else startRecording();
  }, [recording, startRecording, stopRecording]);

  useEffect(() => () => stopRef.current?.(), []);

  return { recording, busy, saveImage, toggleRecording };
}
