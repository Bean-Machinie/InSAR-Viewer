/**
 * Screenshot + screen-recording for the 3D scene.
 *
 * The scene is a WebGL canvas (deck.gl) with HTML overlays floating on top
 * (scale panel, legend, time-series window, date slider). To capture the whole
 * composition we rasterise the overlays with html2canvas — telling it to IGNORE
 * the control panel (`.map-ctl`) and the WebGL canvas — then draw the live
 * terrain underneath. The same compositor feeds a PNG (still) and a
 * MediaRecorder canvas stream (video). The control panel is never included.
 *
 * deck.gl v9 keeps `preserveDrawingBuffer` on by default, so the terrain canvas
 * is readable; our map tiles are CORS-clean, so the canvas is never tainted.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import html2canvas from "html2canvas";

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

/** Everything to composite: the capture root (map area) and the terrain canvas. */
function targets(wrap: HTMLElement) {
  // The time-series window is a sibling of the view, so capture the whole map
  // column (`.main`) — that includes it — but never the sidebar.
  const root = (wrap.closest(".main") as HTMLElement) ?? wrap;
  const deckCanvas = wrap.querySelector("canvas") as HTMLCanvasElement | null;
  return { root, deckCanvas };
}

function grabOverlays(root: HTMLElement, scale: number): Promise<HTMLCanvasElement> {
  return html2canvas(root, {
    backgroundColor: null, // transparent — terrain shows through
    scale,
    logging: false,
    useCORS: true,
    // Exclude the control panel and the WebGL canvas (composited separately).
    ignoreElements: (el) =>
      el.tagName === "CANVAS" ||
      (el.classList != null && el.classList.contains("map-ctl")),
  });
}

export interface SceneCapture {
  recording: boolean;
  busy: boolean;
  saveImage: () => void;
  toggleRecording: () => void;
}

export function useSceneCapture(wrapRef: RefObject<HTMLElement | null>): SceneCapture {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const saveImage = useCallback(async () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const { root, deckCanvas } = targets(wrap);
    if (!deckCanvas) return;
    setBusy(true);
    try {
      const dpr = window.devicePixelRatio || 1;
      const overlay = await grabOverlays(root, dpr);
      const out = document.createElement("canvas");
      out.width = Math.round(root.clientWidth * dpr);
      out.height = Math.round(root.clientHeight * dpr);
      const ctx = out.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(deckCanvas, 0, 0, out.width, out.height);
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
  }, [wrapRef]);

  const startRecording = useCallback(async () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const { root, deckCanvas } = targets(wrap);
    if (!deckCanvas || typeof MediaRecorder === "undefined") return;

    // CSS-pixel resolution keeps the per-frame overlay rasterisation fast.
    const W = root.clientWidth;
    const H = root.clientHeight;
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    let alive = true;
    let overlay: HTMLCanvasElement | null = null;
    try {
      overlay = await grabOverlays(root, 1);
    } catch {
      /* overlays optional */
    }
    // Refresh the overlays periodically so the scale panel tracks the date.
    const timer = window.setInterval(async () => {
      if (!alive) return;
      try {
        overlay = await grabOverlays(root, 1);
      } catch {
        /* keep previous */
      }
    }, 350);

    let raf = 0;
    const draw = () => {
      if (!alive) return;
      ctx.drawImage(deckCanvas, 0, 0, W, H);
      if (overlay) ctx.drawImage(overlay, 0, 0, W, H);
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
    rec.onstop = () => downloadBlob(new Blob(chunks, { type: mime }), `insar-3d-${stamp()}.webm`);
    rec.start();

    stopRef.current = () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      if (rec.state !== "inactive") rec.stop();
      stream.getTracks().forEach((t) => t.stop());
    };
    setRecording(true);
  }, [wrapRef]);

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
