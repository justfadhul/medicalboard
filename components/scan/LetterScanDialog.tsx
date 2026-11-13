"use client";
import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errMsg } from "@/lib/util";
import { Modal } from "@/components/ui";
import { CameraCapture, PagesStrip, pagesBlocking, type CapturedPage } from "./capture";

/** Scan a signed copy or a stamped copy into the letter record (one PDF in the private letters bucket). */
export function LetterScanDialog({ title, sub, caseId, letterId, kind, onSaved, onClose, extra }: {
  title: string; sub: string; caseId: string; letterId: string; kind: "signed" | "stamped";
  onSaved: (path: string, extra: string) => Promise<unknown>; onClose: () => void; extra?: { label: string; placeholder: string };
}) {
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [retake, setRetake] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    setErr("");
    if (!pages.length) return setErr("Capture the page first.");
    if (pagesBlocking(pages).length) return setErr("Retake the marked page or give a reason to keep it.");
    setBusy(true);
    try {
      const pdf = await PDFDocument.create();
      for (const p of pages) {
        const c = document.createElement("canvas"); const bmp = await createImageBitmap(p.blob);
        c.width = bmp.width; c.height = bmp.height; c.getContext("2d")!.drawImage(bmp, 0, 0);
        const jpg = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.85));
        const img = await pdf.embedJpg(await jpg.arrayBuffer());
        const pg = pdf.addPage([595.28, 841.89]); const s = Math.min(595.28 / img.width, 841.89 / img.height);
        pg.drawImage(img, { x: (595.28 - img.width * s) / 2, y: (841.89 - img.height * s) / 2, width: img.width * s, height: img.height * s });
      }
      const path = `${caseId}/${letterId}/${kind}-${crypto.randomUUID()}.pdf`;
      const { error } = await supabaseBrowser().storage.from("letters").upload(path, new Blob([await pdf.save() as BlobPart], { type: "application/pdf" }));
      if (error) throw error;
      await onSaved(path, note);
      onClose();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={title} sub={sub} width={820}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save scan"}</button></>}>
      <CameraCapture onPage={(p) => setPages((cur) => (retake ? cur.map((x) => (x.id === retake ? p : x)) : [...cur, p]))} />
      <PagesStrip pages={pages} setPages={setPages} retake={retake} onRetake={setRetake} />
      {extra && <label className="fieldlabel">{extra.label}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={extra.placeholder} /></label>}
      {err && <p className="err" role="alert">{err}</p>}
    </Modal>
  );
}
