"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { assess, cornerShift, documentFilter, touchesFrame, type Corners, type Quality } from "@/lib/scan/quality";
import { autoLevels, detectPage, warpPage } from "@/lib/scan/detect";
import { cls } from "@/lib/util";

export type CapturedPage = { id: string; blob: Blob; url: string; width: number; height: number; quality: Quality; keepReason?: string; docId?: string };

const MAX_SIDE = 2200;
const STEADY_FRAMES = 5;

async function toJpeg(c: HTMLCanvasElement): Promise<Blob> {
  return (await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85)))!;
}

/** Turns a frame or image into a saved page: find the paper, crop and straighten it, enhance, check quality, compress. */
export async function makePage(source: CanvasImageSource, w: number, h: number, opts: { crop?: boolean; bw?: boolean; enhance?: boolean; hint?: Corners | null } = {}): Promise<CapturedPage> {
  const s = Math.min(1, 3000 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const frame = ctx.getImageData(0, 0, c.width, c.height);
  let corners: Corners | null = null;
  if (opts.crop) corners = detectPage(frame, 640)?.corners ?? opts.hint?.map(([x, y]) => [x * s, y * s] as [number, number]) as Corners ?? null;
  let out: { width: number; height: number; data: Uint8ClampedArray } = corners ? warpPage(frame, corners, MAX_SIDE) : frame;
  if (!corners && Math.max(out.width, out.height) > MAX_SIDE) {
    const k = MAX_SIDE / Math.max(out.width, out.height), t = document.createElement("canvas");
    t.width = Math.round(c.width * k); t.height = Math.round(c.height * k);
    t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
    out = t.getContext("2d")!.getImageData(0, 0, t.width, t.height);
  }
  if (opts.enhance) autoLevels(out);
  let img = new ImageData(new Uint8ClampedArray(out.data), out.width, out.height);
  if (opts.bw) img = documentFilter(img);
  const quality = assess(img);
  if (opts.crop) {
    if (!corners) { quality.issues.push("Page edges not found: the background may be included"); quality.ok = false; }
    else if (touchesFrame(corners, c.width, c.height)) { quality.cutOff = true; quality.issues.push("Page cut off: fit the whole page in the frame"); quality.ok = false; }
  }
  c.width = img.width; c.height = img.height;
  ctx.putImageData(img, 0, 0);
  const blob = await toJpeg(c);
  return { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), width: c.width, height: c.height, quality };
}

export async function pageFromBlob(b: Blob, bw = false): Promise<CapturedPage> {
  const bmp = await createImageBitmap(b);
  return makePage(bmp, bmp.width, bmp.height, { bw, enhance: true });
}

type Guide = { tone: "search" | "adjust" | "steady" | "error"; text: string };

/**
 * Live camera with page-edge guides. Inline inside a dialog, or full screen (phones, or on request).
 * Shows the detected page outline and corner markers, a frame guide when no page is found, plain hints
 * (move closer, fit the page, hold steady, too dark), and a progress ring while auto-capture waits for a steady page.
 */
export function CameraCapture({ onPage, hint, fullscreen: fsInitial = false, lockFullscreen = false, header, pages = [], onDone, onReview }: {
  onPage: (p: CapturedPage) => void; hint?: string; fullscreen?: boolean; lockFullscreen?: boolean; header?: React.ReactNode;
  pages?: CapturedPage[]; onDone?: () => void; onReview?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const [fs, setFs] = useState(fsInitial || lockFullscreen);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [err, setErr] = useState("");
  const [crop, setCrop] = useState(true);
  const [bw, setBw] = useState(false);
  const [enhance, setEnhance] = useState(true);
  const [auto, setAuto] = useState(true);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [guide, setGuide] = useState<Guide>({ tone: "search", text: "Starting camera…" });
  const [progress, setProgress] = useState(0);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const corners = useRef<Corners | null>(null);
  const smooth = useRef<Corners | null>(null);
  const steady = useRef(0);
  const armed = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null, stop = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use the camera here. The camera needs a secure (https) address; use the Scanner source or the live site.");
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 3840 }, height: { ideal: 2160 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false,
        });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
        track.current = stream.getVideoTracks()[0] ?? null;
        const caps = (track.current?.getCapabilities?.() ?? {}) as { torch?: boolean; focusMode?: string[] };
        setTorch(caps.torch ? false : null);
        if (caps.focusMode?.includes("continuous")) track.current?.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
        if (video.current) { video.current.srcObject = stream; await video.current.play().catch(() => {}); }
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"));
        setErr("");
      } catch (e) { setErr((e as Error).message || "Camera unavailable"); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [deviceId]);

  async function toggleTorch() {
    if (torch === null || !track.current) return;
    await track.current.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).catch(() => {});
    setTorch(!torch);
  }

  const capture = useCallback(async () => {
    const v = video.current; if (!v || !v.videoWidth || busyRef.current) return;
    busyRef.current = true; setBusy(true); setFlash(true); setTimeout(() => setFlash(false), 180);
    try { navigator.vibrate?.(25); } catch { /* not supported */ }
    try {
      const page = await makePage(v, v.videoWidth, v.videoHeight, { crop, bw, enhance, hint: corners.current });
      onPage(page);
      armed.current = false; steady.current = 0; setProgress(0);
      setGuide(page.quality.ok ? { tone: "steady", text: "Captured. Place the next page" } : { tone: "error", text: page.quality.issues[0] ?? "Captured with a warning" });
    } finally { busyRef.current = false; setBusy(false); }
  }, [bw, crop, enhance, onPage]);

  // Live detection loop (pure JS, ~4 frames a second on a small copy of the frame)
  useEffect(() => {
    let alive = true;
    const small = document.createElement("canvas");
    (async () => {
      while (alive) {
        const v = video.current, o = overlay.current;
        if (v && o && v.videoWidth && !busyRef.current) {
          const s = 320 / v.videoWidth;
          small.width = 320; small.height = Math.round(v.videoHeight * s);
          const ctx = small.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(v, 0, 0, small.width, small.height);
          const img = ctx.getImageData(0, 0, small.width, small.height);
          let lum = 0; for (let i = 0; i < img.data.length; i += 16) lum += img.data[i]! * 0.3 + img.data[i + 1]! * 0.59 + img.data[i + 2]! * 0.11;
          lum /= img.data.length / 16;
          const d = crop ? detectPage(img, 320) : null;
          const found = d ? (d.corners.map(([x, y]) => [x / s, y / s]) as Corners) : null;
          const shift = cornerShift(corners.current, found, v.videoWidth);
          corners.current = found;
          // smooth the drawn outline to avoid jitter
          smooth.current = found && smooth.current && shift < 0.08
            ? (smooth.current.map((p, i) => [p[0] * 0.5 + found[i]![0] * 0.5, p[1] * 0.5 + found[i]![1] * 0.5]) as Corners) : found;
          if (shift > 0.08) armed.current = true;
          let g: Guide;
          const cut = found && touchesFrame(found, v.videoWidth, v.videoHeight, 0.01);
          if (lum < 55) g = { tone: "error", text: "Too dark: move to the light or turn on the torch" };
          else if (!crop) g = { tone: "steady", text: "Auto-crop is off: the whole frame will be saved" };
          else if (!found) g = { tone: "search", text: "Place the page on a darker surface, inside the frame" };
          else if (cut) g = { tone: "adjust", text: "Move back: the page edge is cut off" };
          else if (d!.areaRatio < 0.22) g = { tone: "adjust", text: "Move closer: fill the frame with the page" };
          else if (shift > 0.015) { steady.current = 0; g = { tone: "adjust", text: "Hold steady…" }; }
          else { steady.current++; g = { tone: "steady", text: auto && armed.current ? "Hold still: capturing" : "Page found: tap the shutter" }; }
          if (!found || cut || (d && d.areaRatio < 0.22)) steady.current = 0;
          setGuide(g);
          setProgress(auto && armed.current ? Math.min(1, steady.current / STEADY_FRAMES) : 0);
          draw(o, v.videoWidth, v.videoHeight, smooth.current, g.tone);
          if (auto && armed.current && steady.current >= STEADY_FRAMES && !cut && found) await capture();
        }
        await new Promise((r) => setTimeout(r, 220));
      }
    })();
    return () => { alive = false; };
  }, [auto, crop, capture]);

  const last = pages[pages.length - 1];
  const toggles = (dark: boolean) => (
    <div className="row" style={{ gap: 6, justifyContent: "center" }}>
      {([["Auto-capture", auto, setAuto], ["Auto-crop", crop, setCrop], ["Enhance", enhance, setEnhance], ["Black and white", bw, setBw]] as const).map(([label, on, set]) => (
        <button key={label} className={cls("btn sm", on && "sel")} aria-pressed={on} onClick={() => set(!on)}
          style={dark ? { background: on ? "#266DF0" : "rgba(255,255,255,0.12)", color: "#fff", borderColor: "transparent" } : undefined}>{label}</button>
      ))}
      {torch !== null && <button className={cls("btn sm", torch && "sel")} aria-pressed={torch} onClick={toggleTorch}
        style={dark ? { background: torch ? "#D97706" : "rgba(255,255,255,0.12)", color: "#fff", borderColor: "transparent" } : undefined}>Torch</button>}
    </div>
  );
  const shutter = (
    <button onClick={capture} disabled={busy || !!err} aria-label="Capture page"
      style={{ width: 78, height: 78, borderRadius: "50%", border: 0, padding: 0, background: "transparent", cursor: "pointer", position: "relative", flex: "none" }}>
      <svg width="78" height="78" viewBox="0 0 78 78" aria-hidden style={{ position: "absolute", inset: 0 }}>
        <circle cx="39" cy="39" r="35" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="5" />
        <circle cx="39" cy="39" r="35" fill="none" stroke="#22C55E" strokeWidth="5" strokeDasharray={`${2 * Math.PI * 35 * progress} 999`} transform="rotate(-90 39 39)" />
        <circle cx="39" cy="39" r="27" fill={busy ? "#9A9BA1" : "#fff"} />
      </svg>
    </button>
  );
  const stage = (
    <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#000", overflow: "hidden", borderRadius: fs ? 0 : 10 }}>
      <video ref={video} playsInline muted aria-label="Live camera view" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
      <canvas ref={overlay} aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
      {flash && <div aria-hidden style={{ position: "absolute", inset: 0, background: "#fff", opacity: 0.7 }} />}
      <div role="status" aria-live="polite" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: 12, maxWidth: "92%", textAlign: "center",
        background: guide.tone === "steady" ? "rgba(22,163,74,0.92)" : guide.tone === "adjust" ? "rgba(217,119,6,0.92)" : guide.tone === "error" ? "rgba(220,38,38,0.92)" : "rgba(29,30,32,0.78)",
        color: "#fff", fontWeight: 600, fontSize: fs ? 15 : 13, padding: "8px 14px", borderRadius: 999 }}>{guide.text}</div>
      {hint && <span style={{ position: "absolute", left: 12, bottom: 12, background: "rgba(29,30,32,0.78)", color: "#fff", fontSize: 12.5, padding: "4px 10px", borderRadius: 999 }}>{hint}</span>}
      {err && <div className="err" role="alert" style={{ position: "absolute", left: 12, right: 12, bottom: 12 }}>{err}</div>}
    </div>
  );

  if (fs) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Camera scanner" style={{ position: "fixed", inset: 0, zIndex: 90, background: "#000", display: "flex", flexDirection: "column", color: "#fff" }}>
        <div className="row" style={{ padding: "max(10px, env(safe-area-inset-top)) 12px 8px", gap: 8, flexWrap: "nowrap" }}>
          {!lockFullscreen && <button className="btn sm" onClick={() => setFs(false)} style={{ background: "rgba(255,255,255,0.12)", color: "#fff", borderColor: "transparent" }}>Exit full screen</button>}
          <div style={{ flex: 1, minWidth: 0 }}>{header}</div>
        </div>
        {stage}
        <div className="stack" style={{ gap: 10, padding: "12px 12px max(14px, env(safe-area-inset-bottom))" }}>
          {toggles(true)}
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <button onClick={onReview} disabled={!pages.length} aria-label={`Review ${pages.length} captured pages`}
              style={{ width: 64, height: 64, borderRadius: 10, border: "2px solid rgba(255,255,255,0.6)", background: "#222", padding: 0, position: "relative", cursor: "pointer", overflow: "visible" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {last && <img src={last.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />}
              <span style={{ position: "absolute", top: -8, right: -8, background: "#266DF0", color: "#fff", borderRadius: 999, minWidth: 24, height: 24, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>{pages.length}</span>
            </button>
            {shutter}
            <button className="btn" onClick={onDone} disabled={!onDone} style={{ minWidth: 64, height: 48, background: "#266DF0", color: "#fff", borderColor: "#266DF0", fontWeight: 600 }}>Done</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ height: "min(62vh, 560px)", display: "flex" }}>{stage}</div>
      <div className="row" style={{ gap: 6 }}>
        {devices.length > 1 && (
          <select aria-label="Camera" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={{ maxWidth: 220, height: 30 }}>
            <option value="">Rear camera (default)</option>
            {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
          </select>
        )}
        {toggles(false)}
        <button className="btn sm" onClick={() => setFs(true)}>Full screen</button>
        <button className="btn primary" style={{ marginLeft: "auto" }} onClick={capture} disabled={busy || !!err}>Capture page</button>
      </div>
    </div>
  );
}

/** Draws the live guides: the page outline with corner markers, or a frame guide when no page is found. */
function draw(o: HTMLCanvasElement, w: number, h: number, c: Corners | null, tone: Guide["tone"]) {
  o.width = w; o.height = h;
  const g = o.getContext("2d")!; g.clearRect(0, 0, w, h);
  const lw = Math.max(4, w / 180);
  if (!c) {
    // A4-shaped frame guide in the middle
    const gh = h * 0.8, gw = Math.min(w * 0.86, gh / 1.414), x = (w - gw) / 2, y = (h - gh) / 2, L = Math.min(gw, gh) * 0.12;
    g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = lw; g.setLineDash([lw * 3, lw * 2.5]);
    g.strokeRect(x, y, gw, gh); g.setLineDash([]);
    g.lineWidth = lw * 1.6;
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + gw, y, -1, 1], [x + gw, y + gh, -1, -1], [x, y + gh, 1, -1]] as const) {
      g.beginPath(); g.moveTo(cx + dx * L, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * L); g.stroke();
    }
    return;
  }
  const col = tone === "steady" ? "#22C55E" : tone === "error" ? "#DC2626" : "#F59E0B";
  // dim everything outside the page
  g.fillStyle = "rgba(0,0,0,0.45)"; g.beginPath(); g.rect(0, 0, w, h);
  g.moveTo(c[0][0], c[0][1]); c.slice(1).forEach(([x, y]) => g.lineTo(x, y)); g.closePath(); g.fill("evenodd");
  g.fillStyle = tone === "steady" ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.10)";
  g.beginPath(); c.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  g.strokeStyle = col; g.lineWidth = lw; g.stroke();
  // corner markers
  g.lineWidth = lw * 2;
  c.forEach((p, i) => {
    const a = c[(i + 3) % 4]!, b = c[(i + 1) % 4]!, L = 0.14;
    g.beginPath(); g.moveTo(p[0] + (a[0] - p[0]) * L, p[1] + (a[1] - p[1]) * L); g.lineTo(p[0], p[1]); g.lineTo(p[0] + (b[0] - p[0]) * L, p[1] + (b[1] - p[1]) * L); g.stroke();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(p[0], p[1], lw * 1.6, 0, Math.PI * 2); g.fill();
  });
}

/** Captured pages: reorder (drag or arrows), delete, retake, keep a failed page with a reason, and (batch) choose its document. */
export function PagesStrip({ pages, setPages, retake, onRetake, docs }: {
  pages: CapturedPage[]; setPages: (p: CapturedPage[]) => void; retake?: string | null; onRetake?: (id: string | null) => void;
  docs?: { id: string; name: string }[];
}) {
  const drag = useRef<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= pages.length) return;
    const next = [...pages]; const [x] = next.splice(from, 1); next.splice(to, 0, x!); setPages(next);
  };
  const upd = (id: string, p: Partial<CapturedPage>) => setPages(pages.map((x) => (x.id === id ? { ...x, ...p } : x)));
  if (!pages.length) return <p className="muted t12">No pages captured yet.</p>;
  return (
    <ol className="row" style={{ gap: 8, overflowX: "auto", alignItems: "flex-start", flexWrap: "nowrap", listStyle: "none", padding: "2px 0 6px", margin: 0 }} aria-label="Captured pages">
      {pages.map((p, i) => (
        <li key={p.id} draggable onDragStart={() => (drag.current = i)} onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (drag.current !== null) move(drag.current, i); drag.current = null; }}
          className="stack" style={{ gap: 4, width: 140, flex: "none", border: `1px solid ${retake === p.id ? "#266DF0" : p.quality.ok || p.keepReason ? "#E9E9EC" : "#F7D4D4"}`, borderRadius: 8, padding: 6, background: "#fff" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={`Page ${i + 1}`} style={{ width: "100%", height: 150, objectFit: "contain", background: "#F3F3F5", borderRadius: 4 }} />
          <span className="row" style={{ gap: 4, justifyContent: "space-between" }}>
            <b className="t12">Page {i + 1}</b>
            {p.quality.ok ? <span className="pill p-green">OK</span> : p.keepReason ? <span className="pill p-amber">Kept</span> : <span className="pill p-red">Check</span>}
          </span>
          {docs && (
            <select aria-label={`Document for page ${i + 1}`} value={p.docId ?? ""} onChange={(e) => upd(p.id, { docId: e.target.value })} style={{ height: 28, fontSize: 12, padding: "0 4px" }}>
              {!p.docId && <option value="">Choose document</option>}
              {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
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
