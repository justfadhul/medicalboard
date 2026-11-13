"use client";
import Link from "next/link";
import { useState } from "react";
import { planLetters, SIGNER_LABEL, type Cadre } from "@/lib/domain";
import { coverMemo, letterView, type LetterCase, type Officers } from "@/lib/letters/content";
import type { LetterFull } from "@/lib/types";
import { Modal, PageHead, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { LetterPaper, MemoPaper } from "@/components/letters/LetterPaper";
import { STATUS } from "../cases/[id]/LettersTab";

type C = LetterCase & { id: string; employer2: { name: string; cadre: Cadre | null } | null; letters: LetterFull[] };

export function DraftingView({ cases, officers, appUrl, addr }: { cases: C[]; officers: Officers; appUrl: string; addr: { retirementAddressee?: string; opmAddressee?: string } }) {
  const { run } = useToast();
  const [pv, setPv] = useState<{ c: C; l: LetterFull } | null>(null);
  const url = appUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const undrafted = cases.filter((c) => !c.letters.length);
  const ready = cases.filter((c) => c.letters.length);
  const retire = cases.filter((c) => c.type === "retirement" && c.letters.length);
  async function draftAll() { for (const c of undrafted) await run("draft_letters", { p_case: c.id }); }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Drafting" sub={`Approved cases. Draft the letters from the templates, check them, then send each to its signatory. A cover memo from ${officers.memoFrom.name}, thru ${officers.memoFrom.thru}, goes with each letter.`}
        actions={<>
          <button className="btn" onClick={draftAll} disabled={!undrafted.length}>Draft all letters</button>
          <button className="btn primary" disabled={!ready.length} onClick={() => run("send_for_signature", { p_cases: ready.map((c) => c.id) }, `${ready.length} case(s) sent for signature`, { undo: true })}>Send all for signature</button>
          <a className={`btn${retire.length ? "" : " disabled"}`} aria-disabled={!retire.length} href={retire.length ? "/api/memo/batch" : undefined}>Batch memo for retirement letters ({retire.length})</a>
        </>} />
      {!cases.length && <p className="muted">No approved cases waiting for letters.</p>}
      {cases.map((c) => {
        const plan = planLetters({ type: c.type, funding: c.funding, employerName: c.employer2?.name, employerCadre: c.employer2?.cadre, receivingDoctor: c.receiving_doctor, minuteNo: c.minute_no }, addr);
        return (
          <section key={c.id} className="panel stack" style={{ gap: 10 }} aria-label={c.name}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="stack"><b>{c.name}</b><span className="muted t12">{c.case_no} · Approved · {c.minute_no}</span></span>
              <span className="row" style={{ gap: 6 }}>
                <Link className="btn sm" href={`/cases/${c.id}?tab=letters`}>Open case</Link>
                <button className="btn sm" onClick={() => run("draft_letters", { p_case: c.id }, c.letters.length ? "Letters redrafted" : "Letters drafted")}>{c.letters.length ? "Redraft" : "Draft letters"}</button>
                {c.letters.length > 0 && <button className="btn sm primary" onClick={() => run("send_for_signature", { p_cases: [c.id] }, "Sent for signature", { undo: true })}>Send for signature</button>}
              </span>
            </div>
            {!c.letters.length && <p className="muted t12">Will draft: {plan.map((p) => `${p.title} to ${p.addressee}${p.toConfirm ? " (addressee to confirm)" : ""}`).join("; ")}</p>}
            {c.letters.map((l) => (
              <div key={l.id} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid #F1F1F3", paddingTop: 8 }}>
                <span className="stack" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 500 }}>{l.title}</span>
                  <span className="muted t12">To: {l.addressee}{l.addressee_to_confirm ? " · addressee to confirm" : ""}</span>
                  {l.return_note && <span className="t12" style={{ color: "#991B1B" }}>Correction: {l.return_note}</span>}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <span className="t12 muted">Signs: {SIGNER_LABEL[l.signer]}</span>
                  <Pill tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Pill>
                  <button className="btn sm" onClick={() => setPv({ c, l })}>Preview</button>
                  <a className="btn sm" href={`/api/letters/${l.id}/docx`}>.docx</a>
                </span>
              </div>
            ))}
          </section>
        );
      })}
      {pv && (
        <Modal open onClose={() => setPv(null)} title={pv.l.title} sub={pv.c.name} width={780} footer={<a className="btn primary" href={`/api/letters/${pv.l.id}/docx`}>Export to Word</a>}>
          {pv.l.kind !== "extract" && <MemoPaper m={coverMemo(pv.l, pv.c, officers)} />}
          <LetterPaper v={letterView(pv.c, pv.l, officers, url)} />
        </Modal>
      )}
    </div>
  );
}
