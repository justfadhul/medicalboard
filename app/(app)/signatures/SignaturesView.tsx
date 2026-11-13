"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SIGNER_LABEL, shortDate, type Signatory } from "@/lib/domain";
import { coverMemo, letterView, type LetterCase, type Officers } from "@/lib/letters/content";
import type { LetterFull } from "@/lib/types";
import { cls } from "@/lib/util";
import { PageHead, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { usePrompt } from "@/components/Prompt";
import { LetterPaper, MemoPaper } from "@/components/letters/LetterPaper";
import { LetterScanDialog } from "@/components/scan/LetterScanDialog";
import { openStored } from "../cases/[id]/LettersTab";

type L = LetterFull & { case_id: string; case: LetterCase & { id: string } };
type S = { id: string; title: string; signed_at: string; signed_scan_path: string | null; case_id: string; case: { name: string; case_no: string } };

export function SignaturesView({ awaiting, signed, officers, appUrl }: { awaiting: L[]; signed: S[]; officers: Officers; appUrl: string }) {
  const { run } = useToast();
  const [ask, promptNode] = usePrompt();
  const [sel, setSel] = useState<string | null>(awaiting[0]?.id ?? null);
  const [scan, setScan] = useState<S | null>(null);
  const url = appUrl || (typeof window !== "undefined" ? window.location.origin : "");
  useEffect(() => { if (!awaiting.some((l) => l.id === sel)) setSel(awaiting[0]?.id ?? null); }, [awaiting, sel]);
  const cur = awaiting.find((l) => l.id === sel);
  const next = () => { const i = awaiting.findIndex((l) => l.id === sel); setSel(awaiting[i + 1]?.id ?? awaiting[i - 1]?.id ?? null); };
  const groups = (["minister", "dghs"] as Signatory[]).map((s) => ({ s, list: awaiting.filter((l) => l.signer === s) })).filter((g) => g.list.length);

  async function sign() {
    if (!cur) return;
    const ok = await run("mark_letter_signed", { p_letter: cur.id }, `Signed: ${cur.title} (${cur.case.name}). Scan the signed copy from “Signed and back”.`, { undo: true });
    if (ok) next();
  }
  async function back() {
    if (!cur) return;
    const note = await ask({ title: "Return for correction", sub: `${cur.title} · ${cur.case.name}`, label: "What needs correcting",
      placeholder: "e.g. Spell the receiving doctor's name as on the acceptance letter", confirm: "Save and move to Drafting" });
    if (note && (await run("return_letter", { p_letter: cur.id, p_note: note }, "Returned for correction: the note shows in Drafting"))) next();
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Out for signature" sub="Letters with the DGHS or the Minister for signature. When a letter comes back signed, mark it signed; if it comes back with a correction, record the note. The next letter opens as soon as you mark one."
        actions={<>{groups.map((g) => <a key={g.s} className="btn" href={`/api/signing-pack?signer=${g.s}`}>Signing pack: {g.s === "dghs" ? "DGHS" : "Minister"}</a>)}
          <a className={cls("btn primary")} href="/api/signing-pack" aria-disabled={!awaiting.length}>Print signing pack</a></>} />
      {!awaiting.length ? <p className="muted">No letters out for signature.</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr)", gap: 14 }} className="review3">
          <div className="stack" style={{ gap: 12 }}>
            {groups.map((g) => (
              <div key={g.s} className="stack" style={{ gap: 6 }}>
                <span className="label">{SIGNER_LABEL[g.s]} · {g.list.length}</span>
                {g.list.map((l) => (
                  <button key={l.id} className={cls("sig", l.id === sel && "on")} onClick={() => setSel(l.id)} aria-current={l.id === sel}>
                    <b>{l.title}</b><span>{l.case.name}</span><span className="muted t12">To: {l.addressee}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          {cur && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{cur.title} · {cur.case.name}</b>
                <span className="row"><button className="btn" onClick={back}>Came back with a correction</button><button className="btn primary" onClick={sign}>Mark signed</button></span>
              </div>
              <MemoPaper m={coverMemo(cur, cur.case, officers)} />
              <LetterPaper v={letterView(cur.case, cur, officers, url)} />
            </div>
          )}
        </div>
      )}
      <h2 className="h2">Signed and back</h2>
      {signed.length ? signed.map((g) => (
        <div key={g.id} className="row panel" style={{ justifyContent: "space-between", padding: 12 }}>
          <span className="stack"><b>{g.title}</b><Link href={`/cases/${g.case_id}?tab=letters`} className="t12">{g.case.name} · {g.case.case_no}</Link></span>
          <span className="row"><Pill tone="green">Signed {shortDate(g.signed_at)}</Pill>
            {g.signed_scan_path ? <button className="btn sm" onClick={() => openStored("letters", g.signed_scan_path!)}>Signed copy</button>
              : <button className="btn sm" onClick={() => setScan(g)}>Scan signed copy</button>}</span>
        </div>
      )) : <p className="muted t12">Nothing signed in the last two weeks.</p>}
      {scan && <LetterScanDialog title="Scan signed copy" sub={`${scan.title} · ${scan.case.name}`} caseId={scan.case_id} letterId={scan.id} kind="signed" onClose={() => setScan(null)}
        onSaved={(path) => run("attach_signed_scan", { p_letter: scan.id, p_path: path }, "Signed copy saved to the letter record")} />}
      {promptNode}
    </div>
  );
}
