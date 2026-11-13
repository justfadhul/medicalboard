"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { enqueue, onQueue } from "@/lib/scan/queue";
import { errMsg } from "@/lib/util";
import { CameraCapture, PagesStrip, pagesBlocking, type CapturedPage } from "@/components/scan/capture";

type Claim = { case_id: string; document_id: string | null; batch: boolean };
export function PhoneScanner({ token }: { token: string }) {
  const sb = supabaseBrowser();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [kase, setKase] = useState<{ name: string; case_no: string } | null>(null);
  const [docs, setDocs] = useState<{ id: string; name: string }[]>([]);
  const [docId, setDocId] = useState("");
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [retake, setRetake] = useState<string | null>(null);
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
        c = data as Claim; try { sessionStorage.setItem(key, JSON.stringify(c)); } catch { /* ignore */ }
      }
      setClaim(c);
      const [k, d] = await Promise.all([
        sb.from("cases").select("name,case_no").eq("id", c.case_id).single(),
        sb.from("case_documents").select("id,name,status").eq("case_id", c.case_id).neq("status", "not_applicable").order("sort"),
      ]);
      setKase(k.data); setDocs(d.data ?? []); setDocId(c.document_id ?? d.data?.[0]?.id ?? "");
    })();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  function add(p: CapturedPage) {
    setPages((cur) => {
      if (retake) { const i = cur.findIndex((x) => x.id === retake); if (i >= 0) { const n = [...cur]; n[i] = p; setRetake(null); return n; } }
      return [...cur, p];
    });
  }
  async function send() {
    setErr("");
    if (pagesBlocking(pages).length) return setErr("Retake the marked pages or give a reason to keep them.");
    if (!pages.length || !claim || !docId) return;
    await enqueue(pages.map((p) => ({ caseId: claim.case_id, documentId: docId, blob: p.blob, width: p.width, height: p.height, score: p.quality.score,
      quality: { ...p.quality }, keepReason: p.keepReason || null, ext: "jpg" })));
    setSent((s) => s + pages.length); setPages([]);
  }

  if (err && !claim) return <div className="stack" style={{ gap: 12 }}><h1 className="h1">Scan with phone</h1><p className="err" role="alert">{err}</p></div>;
  if (!claim) return <p className="muted">Connecting…</p>;
  return (
    <div className="stack" style={{ gap: 12, maxWidth: 720 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h1 className="h1">Scan with phone</h1>
        <span className="muted">{kase?.name} · {kase?.case_no}</span>
      </div>
      <label className="fieldlabel">Document
        <select value={docId} onChange={(e) => setDocId(e.target.value)} disabled={!claim.batch && !!claim.document_id}>
          {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <CameraCapture onPage={add} hint={`Page ${pages.length + 1}`} />
      <PagesStrip pages={pages} setPages={setPages} retake={retake} onRetake={setRetake} />
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn primary" onClick={send} disabled={!pages.length}>Send {pages.length || ""} page{pages.length === 1 ? "" : "s"} to the desktop</button>
      <p className="muted t12" role="status">{sent} page(s) sent{pending ? ` · ${pending} uploading` : ""}. They appear on the desktop as soon as they upload.</p>
    </div>
  );
}
