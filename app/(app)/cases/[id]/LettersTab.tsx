"use client";
import { useState } from "react";
import { planLetters, SIGNER_LABEL, shortDate } from "@/lib/domain";
import type { Me } from "@/lib/data";
import { letterView, coverMemo, type Officers } from "@/lib/letters/content";
import type { CaseBundle, LetterFull } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Modal, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { usePrompt } from "@/components/Prompt";
import { LetterPaper, MemoPaper } from "@/components/letters/LetterPaper";
import { LetterScanDialog } from "@/components/scan/LetterScanDialog";

export const STATUS: Record<LetterFull["status"], { label: string; tone: "grey" | "amber" | "green" | "red" }> = {
  draft: { label: "Draft", tone: "grey" }, awaiting: { label: "Awaiting signature", tone: "amber" }, signed: { label: "Signed", tone: "green" }, returned: { label: "Returned for correction", tone: "red" },
};

export async function openStored(bucket: "letters" | "scans", path: string) {
  const { data } = await supabaseBrowser().storage.from(bucket).createSignedUrl(path, 120);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

export function LettersTab({ b, me, officers, appUrl }: { b: CaseBundle; me: Me; officers: Officers; appUrl: string }) {
  const { c, letters } = b;
  const { run } = useToast();
  const [ask, promptNode] = usePrompt();
  const [preview, setPreview] = useState<LetterFull | null>(null);
  const [stamp, setStamp] = useState<LetterFull | null>(null);
  const isReg = me.role === "registry" || me.role === "admin";
  const url = appUrl || (typeof window !== "undefined" ? window.location.origin : "");
  if (!letters.length) {
    const plan = planLetters({ type: c.type, funding: c.funding, employerName: c.employer?.name, employerCadre: c.employer?.cadre, receivingDoctor: c.receiving_doctor, minuteNo: c.minute_no });
    return <p className="muted">Letters are drafted by the Secretariat after the Board approves the case. This case will need: {plan.map((p) => `${p.title} to ${p.addressee} (signs: ${SIGNER_LABEL[p.signer]})`).join("; ")}.</p>;
  }
  async function remind(l: LetterFull) {
    const contact = await ask({ title: "Send a receipt reminder", label: "Office phone (SMS) or email", initial: l.office_contact ?? "", confirm: "Send reminder" });
    if (contact) await run("send_reminder", { p_letter: l.id, p_contact: contact }, "Reminder sent and logged");
  }
  const col = c.collections.find((x) => !x.reversed);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {col && <p className="t12">Collected by {col.collector_name} ({col.relationship}) on {shortDate(col.collected_at)}.</p>}
      {letters.map((l) => (
        <div key={l.id} className="panel stack" style={{ gap: 6, padding: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="stack" style={{ gap: 2 }}>
              <b>{l.title}</b>
              <span className="muted t12">To: {l.addressee}{l.addressee_to_confirm && <> <span className="pill p-amber">Addressee to confirm</span></>} · {l.ref_no} · Verification {l.verify_code}</span>
              <span className="t12">Signs: {SIGNER_LABEL[l.signer]}</span>
            </span>
            <Pill tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Pill>
          </div>
          {l.return_note && l.status !== "signed" && <p className="warnbox t12">Correction requested: {l.return_note}</p>}
          {l.receipt_needed && ["collected", "closed"].includes(c.stage) && (
            <span className="row t12" style={{ gap: 6 }}>
              {l.receipt_confirmed ? <Pill tone="green">Receipt confirmed</Pill> : <Pill tone="amber">Receipt pending</Pill>}
              {l.receipt_confirmed && <span className="muted">{l.receipt_method === "qr" ? "By QR code" : "By stamped copy"}{l.receipt_by ? `: ${l.receipt_by}` : ""}{l.receipt_designation ? `, ${l.receipt_designation}` : ""}{l.receipt_at ? ` on ${shortDate(l.receipt_at)}` : ""}</span>}
              {l.last_reminder_at && !l.receipt_confirmed && <span className="muted">Last reminder {shortDate(l.last_reminder_at)}</span>}
            </span>
          )}
          <span className="row" style={{ gap: 4 }}>
            <button className="btn sm" onClick={() => setPreview(l)}>Preview</button>
            {me.role !== "registry" && <a className="btn sm" href={`/api/letters/${l.id}/docx`}>Download .docx</a>}
            {l.signed_scan_path && <button className="btn sm" onClick={() => openStored("letters", l.signed_scan_path!)}>Signed copy</button>}
            {l.stamped_scan_path && <button className="btn sm" onClick={() => openStored("letters", l.stamped_scan_path!)}>Stamped copy</button>}
            {isReg && c.stage === "collected" && l.receipt_needed && !l.receipt_confirmed && <>
              <button className="btn sm" onClick={() => setStamp(l)}>Scan stamped copy</button>
              <button className="btn sm" onClick={() => remind(l)}>Send reminder</button>
            </>}
          </span>
        </div>
      ))}
      {preview && (
        <Modal open onClose={() => setPreview(null)} title={preview.title} sub={`${c.name} · ${STATUS[preview.status].label}`} width={780}
          footer={<><button className="btn" onClick={() => window.print()}>Print</button>{me.role !== "registry" && <a className="btn primary" href={`/api/letters/${preview.id}/docx`}>Export to Word</a>}</>}>
          {preview.kind !== "extract" && <MemoPaper m={coverMemo(preview, c, officers)} />}
          <LetterPaper v={letterView(c, preview, officers, url)} />
        </Modal>
      )}
      {stamp && (
        <LetterScanDialog title="Scan stamped copy" sub={`${stamp.title} · ${stamp.addressee}`} caseId={c.id} letterId={stamp.id} kind="stamped" onClose={() => setStamp(null)}
          extra={{ label: "Received by (as on the stamp)", placeholder: "e.g. Records Office, OPM" }}
          onSaved={(path, by) => run("confirm_receipt_stamped", { p_letter: stamp.id, p_path: path, p_by: by || null }, "Receipt confirmed by stamped copy", { undo: true })} />
      )}
      {promptNode}
    </div>
  );
}
