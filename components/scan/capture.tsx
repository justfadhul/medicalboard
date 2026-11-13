"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { assess, cornerShift, documentFilter, type Corners, type Quality } from "@/lib/scan/quality";
import { detectCorners, edgeDetectionReady, warpPage } from "@/lib/scan/worker";
import { cls } from "@/lib/util";

export type CapturedPage = { id: string; blob: Blob; url: string; width: number; height: number; quality: Quality; keepReason?: string };

const MAX_SIDE = 2200;

// JPEG keeps every page embeddable in the combined PDF (pdf-lib reads JPEG and PNG).
async function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return (await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82)))!;
}

/** Turn a frame or an image into a saved page: optional perspective fix, optional B/W filter, quality check, compression. */
export async function makePage(source: CanvasImageSource, w: number, h: number, opts: { corners?: Corners | null; bw?: boolean; checkCut?: boolean } = {}): Promise<CapturedPage> {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, c.width, c.height);
  let img = ctx.getImageData(0, 0, c.width, c.height);
  const corners = opts.corners?.map(([x, y]) => [x * s, y * s] as [number, number]) ?? null;
  const quality = assess(img, corners, opts.checkCut ? { w: c.width, h: c.height } : undefined);
  if (corners) { try { img = await warpPage(img, corners); } catch { /* keep the uncropped frame */ } }
  if (opts.bw) img = documentFilter(img);
  c.width = img.width; c.height = img.height;
  ctx.putImageData(img, 0, 0);
  const blob = await toBlob(c);
  return { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), width: c.width, height: c.height, quality };
}

export async function pageFromBlob(b: Blob, bw = false): Promise<CapturedPage> {
  const bmp = await createImageBitmap(b);
  return makePage(bmp, bmp.width, bmp.height, { bw });
}

/** Live camera capture with page detection and auto-capture when the page is steady. */
export function CameraCapture({ onPage, hint }: { onPage: (p: CapturedPage) => void; hint?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [err, setErr] = useState("");
  const [crop, setCrop] = useState(true);
  const [bw, setBw] = useState(false);
  const [auto, setAuto] = useState(true);
  const [cv, setCv] = useState<"loading" | "on" | "off">("loading");
  const [status, setStatus] = useState("Starting camera…");
  const [busy, setBusy] = useState(false);
  const corners = useRef<Corners | null>(null);
  const steady = useRef(0);
  const armed = useRef(true);

  useEffect(() => { edgeDetectionReady().then((ok) => setCv(ok ? "on" : "off")); }, []);

  useEffect(() => {
    let stream: MediaStream | null = null, stop = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use the camera. Use Scan with phone or the Scanner source.");
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 3840 }, height: { ideal: 2160 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false,
        });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
        if (video.current) { video.current.srcObject = stream; await video.current.play().catch(() => {}); }
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        setDevices(list); setErr(""); setStatus("Place the page on a dark, flat surface");
      } catch (e) { setErr((e as Error).message || "Camera unavailable"); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [deviceId]);

  const capture = useCallback(async () => {
    const v = video.current; if (!v || !v.videoWidth || busy) return;
    setBusy(true);
    try {
      const page = await makePage(v, v.videoWidth, v.videoHeight, { corners: crop ? corners.current : null, bw, checkCut: crop && !!corners.current });
      onPage(page);
      armed.current = false; steady.current = 0;
      setStatus(page.quality.ok ? "Captured. Place the next page" : "Captured with a quality warning");
    } finally { setBusy(false); }
  }, [bw, crop, onPage, busy]);

  // Detection loop on a small frame
  useEffect(() => {
    if (cv !== "on") return;
    let alive = true;
    const small = document.createElement("canvas");
    const loop = async () => {
      while (alive) {
        const v = video.current, o = overlay.current;
        if (v && o && v.videoWidth) {
          const s = 480 / v.videoWidth;
          small.width = 480; small.height = Math.round(v.videoHeight * s);
          const ctx = small.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(v, 0, 0, small.width, small.height);
          const found = await detectCorners(ctx.getImageData(0, 0, small.width, small.height));
          const full = found?.map(([x, y]) => [x / s, y / s] as [number, number]) ?? null;
          const shift = cornerShift(corners.current, full, v.videoWidth);
          corners.current = full;
          o.width = v.videoWidth; o.height = v.videoHeight;
          const oc = o.getContext("2d")!; oc.clearRect(0, 0, o.width, o.height);
          if (full) {
            oc.strokeStyle = "#266DF0"; oc.lineWidth = Math.max(4, o.width / 200); oc.fillStyle = "rgba(38,109,240,0.12)";
            oc.beginPath(); full.forEach(([x, y], i) => (i ? oc.lineTo(x, y) : oc.moveTo(x, y))); oc.closePath(); oc.fill(); oc.stroke();
            steady.current = shift < 0.012 ? steady.current + 1 : 0;
            if (shift > 0.08) armed.current = true; // a new page was placed
            if (auto && armed.current && steady.current >= 4) { setStatus("Steady: capturing"); await capture(); }
            else if (armed.current) setStatus(steady.current ? "Hold steady…" : "Page found");
          } else { steady.current = 0; armed.current = true; setStatus("Looking for the page edges…"); }
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    };
    void loop();
    return () => { alive = false; };
  }, [cv, auto, capture]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      {err ? <p className="err" role="alert">{err}</p> : (
        <div style={{ position: "relative", background: "#1D1E20", borderRadius: 10, overflow: "hidden", aspectRatio: "4 / 3", maxHeight: "52vh" }}>
          <video ref={video} playsInline muted aria-label="Live camera view" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          <canvas ref={overlay} aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
          <span className="pill p-grey" style={{ position: "absolute", left: 10, top: 10 }} role="status"><span className="dot" />{status}</span>
          {hint && <span className="pill p-blue" style={{ position: "absolute", left: 10, bottom: 10 }}><span className="dot" />{hint}</span>}
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        {devices.length > 1 && (
          <select aria-label="Camera" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={{ maxWidth: 220, height: 30 }}>
            <option value="">Rear camera (default)</option>
            {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
          </select>
        )}
        <button className={cls("btn sm", crop && "sel")} aria-pressed={crop} onClick={() => setCrop(!crop)} disabled={cv !== "on"}>Auto-crop and straighten</button>
        <button className={cls("btn sm", bw && "sel")} aria-pressed={bw} onClick={() => setBw(!bw)}>Black and white</button>
        <button className={cls("btn sm", auto && "sel")} aria-pressed={auto} onClick={() => setAuto(!auto)} disabled={cv !== "on"}>Auto-capture</button>
        <span className="muted t12">{cv === "loading" ? "Loading page detection…" : cv === "off" ? "Page detection unavailable: capture manually" : ""}</span>
        <button className="btn primary" style={{ marginLeft: "auto" }} onClick={capture} disabled={busy || !!err}>Capture page</button>
      </div>
    </div>
  );
}

/** Captured-pages strip: reorder (drag or arrows), delete, retake, keep a failed page with a reason. */
export function PagesStrip({ pages, setPages, retake, onRetake }: {
  pages: CapturedPage[]; setPages: (p: CapturedPage[]) => void; retake?: string | null; onRetake?: (id: string | null) => void;
}) {
  const drag = useRef<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= pages.length) return;
    const next = [...pages]; const [x] = next.splice(from, 1); next.splice(to, 0, x!); setPages(next);
  };
  const upd = (id: string, p: Partial<CapturedPage>) => setPages(pages.map((x) => (x.id === id ? { ...x, ...p } : x)));
  if (!pages.length) return <p className="muted t12">No pages captured yet.</p>;
  return (
    <ol className="row" style={{ gap: 8, overflowX: "auto", alignItems: "flex-start", flexWrap: "nowrap", listStyle: "none", padding: 0, margin: 0 }} aria-label="Captured pages">
      {pages.map((p, i) => (
        <li key={p.id} draggable onDragStart={() => (drag.current = i)} onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (drag.current !== null) move(drag.current, i); drag.current = null; }}
          className="stack" style={{ gap: 4, width: 128, flex: "none", border: `1px solid ${retake === p.id ? "#266DF0" : p.quality.ok || p.keepReason ? "#E9E9EC" : "#F7D4D4"}`, borderRadius: 8, padding: 6, background: "#fff" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={`Page ${i + 1}`} style={{ width: "100%", height: 120, objectFit: "contain", background: "#F3F3F5", borderRadius: 4 }} />
          <span className="row" style={{ gap: 4, justifyContent: "space-between" }}>
            <b className="t12">Page {i + 1}</b>
            {p.quality.ok ? <span className="pill p-green">OK</span> : p.keepReason ? <span className="pill p-amber">Kept</span> : <span className="pill p-red">Check</span>}
          </span>
          {!p.quality.ok && <span className="t12" style={{ color: "#991B1B" }}>{p.quality.issues.join(". ")}</span>}
          {!p.quality.ok && (
            <input aria-label={`Reason to keep page ${i + 1}`} placeholder="Reason to keep" value={p.keepReason ?? ""} style={{ height: 28, fontSize: 12 }}
              onChange={(e) => upd(p.id, { keepReason: e.target.value })} />
          )}
          <span className="row" style={{ gap: 2 }}>
            <button className="btn sm ghost" aria-label={`Move page ${i + 1} left`} onClick={() => move(i, i - 1)} disabled={!i}>←</button>
            <button className="btn sm ghost" aria-label={`Move page ${i + 1} right`} onClick={() => move(i, i + 1)} disabled={i === pages.length - 1}>→</button>
            {onRetake && <button className="btn sm ghost" onClick={() => onRetake(retake === p.id ? null : p.id)} aria-pressed={retake === p.id}>Retake</button>}
            <button className="btn sm ghost" aria-label={`Delete page ${i + 1}`} onClick={() => { URL.revokeObjectURL(p.url); setPages(pages.filter((x) => x.id !== p.id)); }}>Delete</button>
          </span>
        </li>
      ))}
    </ol>
  );
}

export const pagesBlocking = (pages: CapturedPage[]) => pages.filter((p) => !p.quality.ok && !p.keepReason?.trim());
