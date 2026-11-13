"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { supabaseBrowser } from "@/lib/supabase/client";
import { enqueue, onQueue, retryFailed } from "@/lib/scan/queue";
import { cls, errMsg } from "@/lib/util";
import { Modal } from "@/components/ui";
import { CameraCapture, PagesStrip, pageFromBlob, pagesBlocking, type CapturedPage } from "./capture";

export type ScanDoc = { id: string; name: string; status: string };
type Source = "camera" | "phone" | "scanner";

export function ScanDialog({ open, onClose, caseId, caseNo, caseName, doc, docs, batch }: {
  open: boolean; onClose: () => void; caseId: string; caseNo: string; caseName: string; doc?: ScanDoc | null; docs: ScanDoc[]; batch?: boolean;
}) {
  const router = useRouter();
  const [source, setSource] = useState<Source>("camera");
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [retake, setRetake] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [assign, setAssign] = useState<Record<string, string>>({}); // page id -> document id (batch)
  const [cover, setCover] = useState<"unread" | "ok" | "mismatch" | "none">("unread");
  const [q, setQ] = useState({ pending: 0, uploading: null as string | null, done: 0, failed: 0, lastError: undefined as string | undefined });

  useEffect(() => onQueue((s) => setQ({ ...s, lastError: s.lastError })), []);
  useEffect(() => { if (!open) { pages.forEach((p) => URL.revokeObjectURL(p.url)); setPages([]); setAssign({}); setCover("unread"); setErr(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = docs.filter((d) => d.status !== "not_applicable");
  function addPage(p: CapturedPage) {
    setPages((cur) => {
      if (retake) { const i = cur.findIndex((x) => x.id === retake); if (i >= 0) { const n = [...cur]; URL.revokeObjectURL(n[i]!.url); n[i] = p; setRetake(null); return n; } }
      return [...cur, p];
    });
  }

  // Batch: read the cover sheet barcode (Code 128) with ZXing, then split pages across documents in checklist order.
  async function readCover() {
    if (!pages.length) return;
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const res = await new BrowserMultiFormatReader().decodeFromImageUrl(pages[0]!.url);
      const text = res.getText().trim();
      if (text !== caseNo) { setCover("mismatch"); setErr(`The cover sheet is for ${text}, not ${caseNo}. Check the pile.`); return; }
      const rest = pages.slice(1);
      URL.revokeObjectURL(pages[0]!.url);
      setPages(rest); setCover("ok"); setErr("");
      distribute(rest);
    } catch { setCover("none"); setErr("No barcode found on the first page. Scan the cover sheet first, or assign pages by hand below."); distribute(pages); }
  }
  function distribute(list: CapturedPage[]) {
    const targets = order.filter((d) => d.status === "received").length ? order.filter((d) => d.status === "received") : order;
    const a: Record<string, string> = {};
    list.forEach((p, i) => (a[p.id] = targets[Math.min(i, targets.length - 1)]!.id));
    setAssign(a);
  }

  async function save() {
    setErr("");
    const bad = pagesBlocking(pages);
    if (bad.length) return setErr(`Retake ${bad.length === 1 ? "the marked page" : bad.length + " marked pages"}, or give a reason to keep ${bad.length === 1 ? "it" : "them"}.`);
    if (!pages.length) return setErr("Capture at least one page.");
    if (batch && pages.some((p) => !assign[p.id])) return setErr("Assign every page to a document.");
    setSaving(true);
    try {
      await enqueue(pages.map((p) => ({
        caseId, documentId: batch ? assign[p.id]! : doc!.id, blob: p.blob, width: p.width, height: p.height, score: p.quality.score,
        quality: { ...p.quality }, keepReason: p.keepReason || null, ext: p.blob.type === "image/webp" ? "webp" : "jpg",
      })));
      setPages([]); setAssign({});
      router.refresh();
      onClose();
    } catch (e) { setErr(errMsg(e)); } finally { setSaving(false); }
  }

  const title = batch ? "Batch scan" : `Scan: ${doc?.name ?? ""}`;
  return (
    <Modal open={open} onClose={onClose} title={title} sub={`${caseName} · ${caseNo}`} width={860}
      footer={<>
        {q.pending > 0 && <span className="muted t12" role="status" style={{ marginRight: "auto" }}>Uploading: {q.pending} page(s) in the queue{q.lastError ? ` · retrying (${q.lastError})` : ""}</span>}
        {q.failed > 0 && <button className="btn sm" onClick={() => retryFailed()}>Retry failed uploads</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving || source === "phone"}>{saving ? "Saving…" : `Save ${pages.length || ""} page${pages.length === 1 ? "" : "s"}`}</button>
      </>}>
      <div className="row" role="group" aria-label="Source" style={{ gap: 6 }}>
        <span className="label">Source</span>
        {(["camera", "phone", "scanner"] as Source[]).map((s) => (
          <button key={s} className={cls("btn sm", source === s && "sel")} aria-pressed={source === s} onClick={() => setSource(s)}>
            {s === "camera" ? "Camera" : s === "phone" ? "Scan with phone" : "Scanner"}</button>
        ))}
      </div>
      {batch && <p className="muted t12">Scan the whole pile behind its cover sheet. The barcode on the sheet files the pages under this case, one document after another.</p>}
      {source === "camera" && <CameraCapture onPage={addPage} hint={retake ? "Retaking the selected page" : batch ? `Page ${pages.length + 1} of the pile` : `Page ${pages.length + 1} of ${doc?.name}`} />}
      {source === "phone" && <PhonePair caseId={caseId} doc={doc} batch={!!batch} />}
      {source === "scanner" && <BridgeSource onPages={(ps) => ps.forEach(addPage)} />}
      {source !== "phone" && (
        <>
          <PagesStrip pages={pages} setPages={setPages} retake={retake} onRetake={setRetake} />
          {batch && pages.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row">
                <button className="btn sm" onClick={readCover}>Read cover sheet and split</button>
                {cover === "ok" && <span className="pill p-green"><span className="dot" />Cover sheet matches {caseNo}</span>}
                {cover === "none" && <button className="btn sm" onClick={() => distribute(pages)}>Split in checklist order</button>}
              </div>
              {Object.keys(assign).length > 0 && <BatchBuckets pages={pages} docs={order} assign={assign} setAssign={setAssign} />}
            </div>
          )}
        </>
      )}
      {err && <p className="err" role="alert">{err}</p>}
    </Modal>
  );
}

function BatchBuckets({ pages, docs, assign, setAssign }: { pages: CapturedPage[]; docs: ScanDoc[]; assign: Record<string, string>; setAssign: (a: Record<string, string>) => void }) {
  const drag = useRef<string | null>(null);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
      {docs.map((d) => (
        <section key={d.id} aria-label={d.name} className="kcol" style={{ flex: "none" }} onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (drag.current) setAssign({ ...assign, [drag.current]: d.id }); drag.current = null; }}>
          <b className="t12">{d.name}</b>
          <div className="row" style={{ gap: 4 }}>
            {pages.filter((p) => assign[p.id] === d.id).map((p) => (
              <span key={p.id} draggable onDragStart={() => (drag.current = p.id)} className="stack" style={{ gap: 2, width: 64 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Page ${pages.indexOf(p) + 1}`} style={{ width: 64, height: 80, objectFit: "cover", borderRadius: 3, border: "1px solid #E2E2E6" }} />
                <select aria-label={`Move page ${pages.indexOf(p) + 1} to`} value={d.id} onChange={(e) => setAssign({ ...assign, [p.id]: e.target.value })} style={{ height: 24, fontSize: 11, padding: "0 2px" }}>
                  {docs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </span>
            ))}
          </div>
          {!pages.some((p) => assign[p.id] === d.id) && <span className="muted t12">No pages</span>}
        </section>
      ))}
    </div>
  );
}

/** Desktop shows a QR with a 10-minute, single-use token; pages captured on the phone appear here live. */
function PhonePair({ caseId, doc, batch }: { caseId: string; doc?: ScanDoc | null; batch: boolean }) {
  const [qr, setQr] = useState(""); const [link, setLink] = useState(""); const [err, setErr] = useState("");
  const [left, setLeft] = useState(600); const [arrived, setArrived] = useState<{ id: string; page_no: number; document_id: string }[]>([]);
  const router = useRouter();
  async function create() {
    setErr(""); setArrived([]);
    const { data, error } = await supabaseBrowser().rpc("create_scan_pairing", { p_case: caseId, p_doc: batch ? null : doc?.id ?? null, p_batch: batch });
    if (error) return setErr(errMsg(error));
    const url = `${window.location.origin}/scan/pair/${data}`;
    setLink(url); setQr(await QRCode.toDataURL(url, { width: 220, margin: 1 })); setLeft(600);
  }
  useEffect(() => { void create(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel(`pages-${caseId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "document_pages", filter: `case_id=eq.${caseId}` },
      (p) => { setArrived((a) => [...a, p.new as never]); router.refresh(); }).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [caseId, router]);
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr ? <img src={qr} alt="QR code to open the scanner on your phone" width={220} height={220} style={{ opacity: left ? 1 : 0.2 }} /> : <div style={{ width: 220, height: 220 }} />}
      <div className="stack" style={{ gap: 8, flex: "1 1 260px" }}>
        <p>Open the camera on a phone that is <b>already signed in</b> to this system and scan the code. The phone opens the same capture screen for {batch ? "a batch scan of this case" : <b>{doc?.name}</b>}.</p>
        <p className="muted t12">{left ? `The code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} and works once.` : "The code has expired."}</p>
        {link && <p className="muted t12" style={{ wordBreak: "break-all" }}>{link}</p>}
        <button className="btn sm" onClick={create} style={{ alignSelf: "flex-start" }}>New code</button>
        <div role="status" aria-live="polite" className={arrived.length ? "okbox" : "infobox"}>{arrived.length ? `${arrived.length} page(s) received from the phone.` : "Waiting for pages from the phone…"}</div>
        {err && <p className="err" role="alert">{err}</p>}
      </div>
    </div>
  );
}

/** Flatbed / sheet-feed scanners through the local scan-bridge companion: network (eSCL/AirScan) scanners and a drop folder. */
function BridgeSource({ onPages }: { onPages: (p: CapturedPage[]) => void }) {
  const base = process.env.NEXT_PUBLIC_SCAN_BRIDGE_URL || "http://localhost:7317";
  const [token, setToken] = useState(() => { try { return localStorage.getItem("umb-bridge-token") ?? ""; } catch { return ""; } });
  const [state, setState] = useState<"checking" | "offline" | "ready">("checking");
  const [scanners, setScanners] = useState<{ id: string; name: string }[]>([]);
  const [scanner, setScanner] = useState(""); const [feeder, setFeeder] = useState(false);
  const [files, setFiles] = useState<{ name: string; size: number; mtime: string }[]>([]);
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const h = { "X-Bridge-Token": token };
  async function check() {
    setState("checking"); setErr("");
    try {
      const r = await fetch(`${base}/health`, { headers: h }); if (!r.ok) throw new Error(r.status === 401 ? "The bridge token is wrong" : "Bridge error");
      setState("ready");
      const [s, f] = await Promise.all([fetch(`${base}/scanners`, { headers: h }).then((x) => x.json()), fetch(`${base}/drop`, { headers: h }).then((x) => x.json())]);
      setScanners(s.scanners ?? []); setScanner((s.scanners ?? [])[0]?.id ?? ""); setFiles(f.files ?? []);
    } catch (e) { setState("offline"); setErr((e as Error).message); }
  }
  useEffect(() => { void check(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  async function scan() {
    setBusy("Scanning…"); setErr("");
    try {
      const r = await fetch(`${base}/scan`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ scanner, source: feeder ? "Feeder" : "Platen" }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Scan failed");
      const pages = await Promise.all((j.pages as string[]).map(async (d) => pageFromBlob(await (await fetch(d)).blob())));
      onPages(pages);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  async function take(name: string) {
    setBusy("Loading " + name); setErr("");
    try {
      const r = await fetch(`${base}/drop/${encodeURIComponent(name)}`, { headers: h }); if (!r.ok) throw new Error("Could not read the file");
      onPages([await pageFromBlob(await r.blob())]);
      await fetch(`${base}/drop/${encodeURIComponent(name)}/done`, { method: "POST", headers: h });
      setFiles((f) => f.filter((x) => x.name !== name));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      {state !== "ready" ? (
        <div className="stack" style={{ gap: 8 }}>
          <p className="infobox">Flatbed and sheet-feed scanners work through the UMB scan bridge, a small program installed once on this computer (see the README, “Scan bridge”). {state === "checking" ? "Checking for it…" : "It is not running or the token is not set."}</p>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="fieldlabel" style={{ flex: "1 1 260px" }}>Bridge token (shown by the bridge when it starts)
              <input value={token} onChange={(e) => { setToken(e.target.value); try { localStorage.setItem("umb-bridge-token", e.target.value); } catch { /* private mode */ } }} /></label>
            <button className="btn" onClick={check}>Connect</button>
          </div>
        </div>
      ) : (
        <>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="fieldlabel" style={{ flex: "1 1 240px" }}>Network scanner
              <select value={scanner} onChange={(e) => setScanner(e.target.value)}>{scanners.length ? scanners.map((s) => <option key={s.id} value={s.id}>{s.name}</option>) : <option value="">No network scanners found</option>}</select></label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" style={{ width: 16, height: 16 }} checked={feeder} onChange={(e) => setFeeder(e.target.checked)} />Sheet feeder</label>
            <button className="btn primary" onClick={scan} disabled={!scanner || !!busy}>Scan pages</button>
            <button className="btn" onClick={check}>Refresh</button>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">Drop folder (the scanner&apos;s “scan to folder”)</span>
            {files.length ? files.map((f) => (
              <div key={f.name} className="row" style={{ justifyContent: "space-between", border: "1px solid #E9E9EC", borderRadius: 8, padding: "6px 10px" }}>
                <span>{f.name} <span className="muted t12">{Math.round(f.size / 1024)} KB · {new Date(f.mtime).toLocaleTimeString("en-GB")}</span></span>
                <button className="btn sm" onClick={() => take(f.name)} disabled={!!busy}>Add to this document</button>
              </div>
            )) : <p className="muted t12">No new files in the drop folder.</p>}
          </div>
        </>
      )}
      {busy && <p className="muted" role="status">{busy}</p>}
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}
