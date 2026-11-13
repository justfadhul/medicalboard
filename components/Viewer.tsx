"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type ViewerPage = { id: string; path: string; page_no: number; rotation: number; width: number | null; height: number | null };
export type Box = { x: number; y: number; w: number; h: number };

const urlCache = new Map<string, { url: string; exp: number }>();
async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now(); const need = paths.filter((p) => !((urlCache.get(p)?.exp ?? 0) > now));
  if (need.length) {
    const { data } = await supabaseBrowser().storage.from("scans").createSignedUrls(need, 300);
    for (const d of data ?? []) if (d.signedUrl && d.path) urlCache.set(d.path, { url: d.signedUrl, exp: now + 240_000 });
  }
  return Object.fromEntries(paths.map((p) => [p, urlCache.get(p)?.url ?? ""]));
}

/** Scan viewer: thumbnails, previous/next, zoom, rotate, full screen, and the region a field was read from. */
export function Viewer({ title, pages, page, onPage, highlight, canRotate, height = 560, empty }: {
  title: string; pages: ViewerPage[]; page: number; onPage: (n: number) => void; highlight?: Box | null; canRotate?: boolean; height?: number;
  empty?: React.ReactNode;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState<Record<string, number>>({});
  const box = useRef<HTMLDivElement>(null);
  const cur = pages[page - 1];
  useEffect(() => { if (pages.length) signedUrls(pages.map((p) => p.path)).then(setUrls); }, [pages]);
  useEffect(() => setZoom(1), [title]);
  if (!pages.length || !cur) return <div className="page stack" style={{ height, alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center", gap: 8 }}>{empty}</div>;
  const r = rot[cur.id] ?? cur.rotation ?? 0;
  async function rotate() {
    const n = (r + 90) % 360; setRot({ ...rot, [cur!.id]: n });
    if (canRotate) await supabaseBrowser().rpc("set_page_rotation", { p_page: cur!.id, p_rotation: n });
  }
  const full = () => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen?.());
  return (
    <div ref={box} className="stack" style={{ gap: 8, background: "#fff" }}
      onKeyDown={(e) => { if (e.key === "ArrowRight") onPage(Math.min(pages.length, page + 1)); if (e.key === "ArrowLeft") onPage(Math.max(1, page - 1)); }}>
      <div className="row" style={{ gap: 6 }}>
        <b style={{ marginRight: "auto" }}>{title}</b>
        <button className="btn sm" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Previous page">Prev</button>
        <span className="t12" aria-live="polite">Page {page} of {pages.length}</span>
        <button className="btn sm" onClick={() => onPage(Math.min(pages.length, page + 1))} disabled={page >= pages.length} aria-label="Next page">Next</button>
        <button className="btn sm" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out">−</button>
        <span className="t12" style={{ minWidth: 38, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button className="btn sm" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} aria-label="Zoom in">+</button>
        <button className="btn sm" onClick={rotate} aria-label="Rotate page">Rotate</button>
        <button className="btn sm ghost" onClick={full}>Full screen</button>
      </div>
      <div className="row" style={{ alignItems: "flex-start", gap: 8, flexWrap: "nowrap" }}>
        {pages.length > 1 && (
          <div className="stack" style={{ gap: 6, maxHeight: height, overflowY: "auto", flex: "none" }} aria-label="Page thumbnails">
            {pages.map((p, i) => (
              <button key={p.id} onClick={() => onPage(i + 1)} aria-label={`Page ${i + 1}`} aria-current={i + 1 === page}
                style={{ width: 52, height: 70, padding: 0, border: i + 1 === page ? "2px solid #266DF0" : "1px solid #E2E2E6", borderRadius: 3, background: "#F3F3F5", cursor: "pointer", overflow: "hidden" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {urls[p.path] && <img src={urls[p.path]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", transform: `rotate(${rot[p.id] ?? p.rotation}deg)` }} />}
              </button>
            ))}
          </div>
        )}
        <div className="page" style={{ flex: 1, height, overflow: "auto", borderRadius: 8 }} tabIndex={0} aria-label={`${title}, page ${page}`}>
          <div style={{ position: "relative", width: `${zoom * 100}%`, margin: "0 auto", transform: `rotate(${r}deg)`, transformOrigin: "center", transition: "transform .15s" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {urls[cur.path] ? <img src={urls[cur.path]} alt={`Scanned ${title}, page ${page}`} style={{ width: "100%", display: "block" }} /> : <div style={{ height }} />}
            {highlight && <div className="hl" aria-label="Where this field was read" style={{ left: `${highlight.x * 100}%`, top: `${highlight.y * 100}%`, width: `${highlight.w * 100}%`, height: `${highlight.h * 100}%` }} />}
          </div>
        </div>
      </div>
    </div>
  );
}
