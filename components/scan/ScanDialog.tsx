"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { supabaseBrowser } from "@/lib/supabase/client";
import { enqueue, onQueue, retryFailed } from "@/lib/scan/queue";
import { cls, errMsg } from "@/lib/util";
import { Modal } from "@/components/ui";
import { CameraCapture, PagesStrip, pageFromBlob, pagesBlocking, type CapturedPage } from "./capture";

export type ScanDoc = { id: string; name: string; status: string };
type Source = "camera" | "phone" | "scanner";

/** Reads a Code 128 case barcode from a captured page (the batch cover sheet). */
export async function readCoverBarcode(url: string): Promise<string | null> {
  try {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    return (await new BrowserMultiFormatReader().decodeFromImageUrl(url)).getText().trim();
  } catch { return null; }
}

export function ScanDialog({ open, onClose, caseId, caseNo, caseName, doc, docs, batch }: {
  open: boolean; onClose: () => void; caseId: string; caseNo: string; caseName: string; doc?: ScanDoc | null; docs: ScanDoc[]; batch?: boolean;
}) {
  const router = useRouter();
  const order = docs.filter((d) => d.status !== "not_applicable");
  const [source, setSource] = useState<Source>("camera");
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [retake, setRetake] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // Batch: the document being scanned now. Every captured page is tagged with it; pages can be moved afterwards.
  const [current, setCurrent] = useState(order.find((d) => d.status === "received")?.id ?? order[0]?.id ?? "");
  const [cover, setCover] = useState<"waiting" | "ok" | "skipped">("waiting");
  const [q, setQ] = useState({ pending: 0, uploading: null as string | null, done: 0, failed: 0, lastError: undefined as string | undefined });

  useEffect(() => onQueue((s) => setQ({ ...s, lastError: s.lastError })), []);
  useEffect(() => { if (!open) { pages.forEach((p) => URL.revokeObjectURL(p.url)); setPages([]); setCover("waiting"); setErr(""); setNote(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const docName = (id?: string) => order.find((d) => d.id === id)?.name ?? "";
  const currentIndex = order.findIndex((d) => d.id === current);

  async function addPage(p: CapturedPage) {
    // Batch: the first page may be the cover sheet. Its barcode files the pile under this case; it is not saved.
    if (batch && cover === "waiting" && pages.length === 0) {
      const code = await readCoverBarcode(p.url);
      if (code) {
        URL.revokeObjectURL(p.url);
        if (code === caseNo) { setCover("ok"); setNote(`Cover sheet recognised: ${caseNo}. Now scan ${docName(current)}.`); setErr(""); }
        else setErr(`That cover sheet is for ${code}, not ${caseNo}. Check the pile.`);
        return;
      }
      setCover("skipped");
    }
    const tagged = { ...p, docId: batch ? current : doc?.id };
    setPages((cur) => {
      if (retake) {
        const i = cur.findIndex((x) => x.id === retake);
        if (i >= 0) { const n = [...cur]; URL.revokeObjectURL(n[i]!.url); n[i] = { ...tagged, docId: n[i]!.docId }; setRetake(null); return n; }
      }
      return [...cur, tagged];
    });
  }

  async function save() {
    setErr("");
    const bad = pagesBlocking(pages);
    if (bad.length) return setErr(`Retake ${bad.length === 1 ? "the marked page" : bad.length + " marked pages"}, or give a reason to keep ${bad.length === 1 ? "it" : "them"}.`);
    if (!pages.length) return setErr("Capture at least one page.");
    if (pages.some((p) => !p.docId)) return setErr("Choose the document for every page.");
    setSaving(true);
    try {
      await enqueue(pages.map((p) => ({
        caseId, documentId: p.docId!, blob: p.blob, width: p.width, height: p.height, score: p.quality.score,
        quality: { ...p.quality }, keepReason: p.keepReason || null, ext: "jpg",
      })));
      setPages([]);
      router.refresh();
      onClose();
    } catch (e) { setErr(errMsg(e)); } finally { setSaving(false); }
  }

  const counts = order.map((d) => ({ d, n: pages.filter((p) => p.docId === d.id).length })).filter((x) => x.n);
  const docPicker = batch && (
    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <label className="sr-only" htmlFor="batch-current">Document being scanned</label>
      <select id="batch-current" value={current} onChange={(e) => setCurrent(e.target.value)} style={{ height: 34, minWidth: 0, flex: 1 }}>
        {order.map((d, i) => <option key={d.id} value={d.id}>{i + 1}. {d.name} ({pages.filter((p) => p.docId === d.id).length})</option>)}
      </select>
      <button className="btn sm" disabled={currentIndex >= order.length - 1} onClick={() => setCurrent(order[currentIndex + 1]!.id)}>Next document →</button>
    </div>
  );

  const title = batch ? "Batch scan" : `Scan: ${doc?.name ?? ""}`;
  return (
    <Modal open={open} onClose={onClose} title={title} sub={`${caseName} · ${caseNo}`} width={980}
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
      {batch && source !== "phone" && (
        <div className="stack" style={{ gap: 6 }}>
          <p className="muted t12">Scan the pile document by document. Choose the document you are scanning (or press <b>Next document</b> when you move on); every page is filed under the document chosen when it was captured. If the first page is the cover sheet, its barcode is checked and it is not saved.</p>
          {docPicker}
        </div>
      )}
      {source === "camera" && (
        <CameraCapture onPage={addPage} pages={pages} header={docPicker || <b>{doc?.name}</b>}
          hint={retake ? "Retaking the selected page" : batch ? `${docName(current)} · page ${pages.filter((p) => p.docId === current).length + 1}` : `Page ${pages.length + 1} of ${doc?.name}`} />
      )}
      {source === "phone" && <PhonePair caseId={caseId} doc={doc} batch={!!batch} />}
      {source === "scanner" && <BridgeSource onPages={(ps) => ps.forEach((p) => void addPage(p))} />}
      {note && <p className="okbox t12" role="status">{note}</p>}
      {source !== "phone" && (
        <>
          {batch && counts.length > 0 && <p className="t12">{counts.map((x) => `${x.d.name}: ${x.n} page${x.n === 1 ? "" : "s"}`).join(" · ")}</p>}
          <PagesStrip pages={pages} setPages={setPages} retake={retake} onRetake={setRetake} docs={batch ? order : undefined} />
        </>
      )}
      {err && <p className="err" role="alert">{err}</p>}
    </Modal>
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
    } catch (e) {
      setState("offline");
      setErr(e instanceof TypeError ? `The scan bridge is not running on this computer (${base}). Start it, then press Connect.` : (e as Error).message);
    }
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
