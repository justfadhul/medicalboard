"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { enqueue, onQueue } from "@/lib/scan/queue";
import { errMsg } from "@/lib/util";
import { CameraCapture, PagesStrip, pagesBlocking, type CapturedPage } from "@/components/scan/capture";

type Claim = { case_id: string; document_id: string | null; batch: boolean };
type Doc = { id: string; name: string };

/** Phone side of "Scan with phone": start, full-screen camera with page guides, review, send. */
export function PhoneScanner({ token }: { token: string }) {
  const sb = supabaseBrowser();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [kase, setKase] = useState<{ name: string; case_no: string } | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docId, setDocId] = useState("");
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [retake, setRetake] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(0);
  const [pending, setPending] = useState(0);
  useEffect(() => onQueue((s) => setPending(s.pending)), []);

  useEffect(() => {
    (async () => {
      const key = "umb-pair-" + token.slice(0, 12);
      let c: Claim | null = null;
      try { c = JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { c = null; }
      if (!c) {
        const { data, error } = await sb.rpc("claim_scan_pairing", { p_token: token });
        if (error) return setErr(errMsg(error));
        c = data as Claim; try { sessionStorage.setItem(key, JSON.stringify(c)); } catch { /* private mode */ }
      }
      setClaim(c);
      const [k, d] = await Promise.all([
        sb.from("cases").select("name,case_no").eq("id", c.case_id).single(),
        sb.from("case_documents").select("id,name").eq("case_id", c.case_id).neq("status", "not_applicable").order("sort"),
      ]);
      setKase(k.data); setDocs(d.data ?? []); setDocId(c.document_id ?? d.data?.[0]?.id ?? "");
    })();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const fixed = !!claim && !claim.batch && !!claim.document_id;
  const docName = (id?: string) => docs.find((d) => d.id === id)?.name ?? "";
  const idx = docs.findIndex((d) => d.id === docId);

  function add(p: CapturedPage) {
    setPages((cur) => {
      if (retake) { const i = cur.findIndex((x) => x.id === retake); if (i >= 0) { const n = [...cur]; n[i] = { ...p, docId: n[i]!.docId }; setRetake(null); return n; } }
      return [...cur, { ...p, docId }]; // filed under the document chosen at the moment of capture
    });
  }
  async function send() {
    setErr("");
    if (pagesBlocking(pages).length) return setErr("Retake the pages marked “Check”, or give a reason to keep them.");
    if (!pages.length || !claim) return;
    await enqueue(pages.map((p) => ({ caseId: claim.case_id, documentId: p.docId || docId, blob: p.blob, width: p.width, height: p.height, score: p.quality.score,
      quality: { ...p.quality }, keepReason: p.keepReason || null, ext: "jpg" })));
    setSent((s) => s + pages.length); setPages([]);
  }

  if (err && !claim) return <div className="stack" style={{ gap: 12 }}><h1 className="h1">Scan with phone</h1><p className="err" role="alert">{err}</p></div>;
  if (!claim) return <p className="muted">Connecting…</p>;

  const picker = (dark: boolean) => (
    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <label className="sr-only" htmlFor="phone-doc">Document</label>
      <select id="phone-doc" value={docId} onChange={(e) => setDocId(e.target.value)} disabled={fixed}
        style={{ height: 40, fontSize: 15, flex: 1, minWidth: 0, ...(dark ? { background: "rgba(255,255,255,0.12)", color: "#fff", borderColor: "transparent" } : {}) }}>
        {docs.map((d) => <option key={d.id} value={d.id} style={{ color: "#1D1E20" }}>{d.name}</option>)}
      </select>
      {!fixed && idx < docs.length - 1 && (
        <button className="btn" onClick={() => setDocId(docs[idx + 1]!.id)} style={dark ? { height: 40, background: "rgba(255,255,255,0.12)", color: "#fff", borderColor: "transparent" } : { height: 40 }}>Next →</button>
      )}
    </div>
  );

  if (camera) {
    return <CameraCapture lockFullscreen onPage={add} pages={pages} header={picker(true)} onDone={() => setCamera(false)} onReview={() => setCamera(false)}
      hint={`${docName(docId)} · page ${pages.filter((p) => p.docId === docId).length + 1}`} />;
  }

  const counts = docs.map((d) => ({ d, n: pages.filter((p) => p.docId === d.id).length })).filter((x) => x.n);
  return (
    <div className="stack" style={{ gap: 14, maxWidth: 640, margin: "0 auto", width: "100%" }}>
      <div className="stack" style={{ gap: 2 }}>
        <h1 className="h1">Scan with phone</h1>
        <span className="muted">{kase?.name} · {kase?.case_no}</span>
      </div>
      <div className="panel stack" style={{ gap: 10 }}>
        <span className="label">Document</span>
        {picker(false)}
        <ul className="t12 muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Lay the page flat on a darker surface, with good light.</li>
          <li>Fit the whole page in the frame. The outline turns green when the page is found and steady; it captures by itself.</li>
          <li>The background is cropped away and the page straightened automatically.</li>
        </ul>
        <button className="btn primary" style={{ height: 52, fontSize: 16 }} onClick={() => setCamera(true)}>{pages.length ? "Scan more pages" : "Start scanning"}</button>
      </div>
      {pages.length > 0 && (
        <div className="panel stack" style={{ gap: 10 }}>
          <b>Review {pages.length} page{pages.length === 1 ? "" : "s"}</b>
          {counts.length > 0 && <span className="t12">{counts.map((x) => `${x.d.name}: ${x.n}`).join(" · ")}</span>}
          <PagesStrip pages={pages} setPages={setPages} retake={retake} onRetake={(id) => { setRetake(id); if (id) setCamera(true); }} docs={fixed ? undefined : docs} />
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn primary" style={{ height: 52, fontSize: 16 }} onClick={send}>Send {pages.length} page{pages.length === 1 ? "" : "s"} to the desktop</button>
        </div>
      )}
      <p className={sent ? "okbox" : "muted t12"} role="status">{sent ? `${sent} page(s) sent${pending ? `, ${pending} still uploading` : ""}. They appear on the desktop as soon as they upload.` : "Pages you send appear on the desktop straight away."}</p>
    </div>
  );
}
