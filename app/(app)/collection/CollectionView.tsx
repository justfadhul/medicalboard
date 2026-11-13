"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { daysIn, shortDate } from "@/lib/domain";
import { typeLabel } from "@/lib/labels";
import { Modal, PageHead, Pill, Table } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { usePrompt } from "@/components/Prompt";
import { LetterScanDialog } from "@/components/scan/LetterScanDialog";
import { CollectionDialog } from "../cases/[id]/CollectionDialog";

type Ready = { id: string; case_no: string; name: string; type: "retirement" | "referral"; sms_consent: boolean; phone: string | null; letters: { id: string; title: string; addressee: string }[] };
type Out = { id: string; title: string; addressee: string; verify_code: string; receipt_confirmed: boolean; receipt_method: string | null; receipt_by: string | null; receipt_at: string | null;
  last_reminder_at: string | null; office_contact: string | null; case_id: string;
  case: { id: string; name: string; case_no: string; stage_entered_at: string; collections: { collector_name: string; relationship: string; collected_at: string; reversed: boolean }[] } };
const OC = "minmax(180px,1.4fr) minmax(220px,2fr) minmax(150px,1fr) minmax(300px,2fr)";

export function CollectionView({ ready, out, overdueDays, appUrl }: { ready: Ready[]; out: Out[]; overdueDays: number; appUrl: string }) {
  const { run } = useToast();
  const [ask, node] = usePrompt();
  const [collect, setCollect] = useState<Ready | null>(null);
  const [qr, setQr] = useState<Out | null>(null);
  const [stamp, setStamp] = useState<Out | null>(null);
  async function remind(l: Out) {
    const contact = await ask({ title: "Send a receipt reminder", sub: `${l.title} · ${l.addressee}`, label: "Office phone (SMS) or email", initial: l.office_contact ?? "", confirm: "Send reminder" });
    if (contact) await run("send_reminder", { p_letter: l.id, p_contact: contact }, "Reminder sent and logged");
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Collection and receipts" sub="Hand signed letters to the patient's team, then confirm that each receiving office got its letter." />
      <h2 className="h2">Ready for collection ({ready.length})</h2>
      <Table cols="minmax(200px,1.4fr) minmax(260px,2fr) 230px" head={["Case", "Letters", ""]} empty={!ready.length && "Nothing waiting for collection."}>
        {ready.map((r) => (
          <div key={r.id} className="tr" style={{ gridTemplateColumns: "minmax(200px,1.4fr) minmax(260px,2fr) 230px" }} role="row">
            <span className="stack"><b>{r.name}</b><span className="muted t12">{r.case_no} · {typeLabel(r.type)}</span></span>
            <span className="t12">{r.letters.map((l) => `${l.title} (to ${l.addressee})`).join("; ")}</span>
            <span className="row" style={{ gap: 4 }}><Link className="btn sm" href={`/cases/${r.id}?tab=letters`}>Open</Link><button className="btn sm primary" onClick={() => setCollect(r)}>Record collection</button></span>
          </div>
        ))}
      </Table>
      <h2 className="h2">Receipt by the receiving office</h2>
      <p className="muted t12">Each letter carries a QR code and verification number. The receiving office scans the code to confirm receipt, or the patient&apos;s team brings back a stamped copy for scanning. Receipts pending more than {overdueDays} days are overdue.</p>
      <Table cols={OC} head={["Case", "Letter and receiving office", "Receipt", "Confirm by"]} empty={!out.length && "No letters out for delivery."} minWidth={900}>
        {out.map((l) => {
          const col = l.case.collections.find((c) => !c.reversed);
          const waited = col ? daysIn(col.collected_at) : 0;
          return (
            <div key={l.id} className="tr" style={{ gridTemplateColumns: OC }} role="row">
              <span className="stack"><Link href={`/cases/${l.case.id}?tab=letters`} style={{ fontWeight: 600, textDecoration: "none" }}>{l.case.name}</Link>
                <span className="muted t12">{col ? `Collected by ${col.collector_name}, ${shortDate(col.collected_at)}` : ""}</span></span>
              <span className="stack"><span>{l.title}</span><span className="muted t12">{l.addressee} · {l.verify_code}</span></span>
              <span className="stack" style={{ gap: 2 }}>
                {l.receipt_confirmed ? <Pill tone="green">Confirmed</Pill> : waited > overdueDays ? <Pill tone="red">Overdue · {waited} days</Pill> : <Pill tone="amber">Pending</Pill>}
                <span className="muted t12">{l.receipt_confirmed ? `${l.receipt_method === "qr" ? "QR" : "Stamped copy"}${l.receipt_by ? `: ${l.receipt_by}` : ""}` : l.last_reminder_at ? `Reminded ${shortDate(l.last_reminder_at)}` : ""}</span>
              </span>
              {!l.receipt_confirmed ? (
                <span className="row" style={{ gap: 4 }}>
                  <button className="btn sm" onClick={() => remind(l)}>Send reminder</button>
                  <button className="btn sm" onClick={() => setQr(l)}>Recipient QR</button>
                  <button className="btn sm" onClick={() => setStamp(l)}>Scan stamped copy</button>
                </span>
              ) : <span />}
            </div>
          );
        })}
      </Table>
      {collect && <CollectionDialog c={collect} letters={collect.letters} onClose={() => setCollect(null)} />}
      {qr && <QrDialog l={qr} appUrl={appUrl} onClose={() => setQr(null)} />}
      {stamp && <LetterScanDialog title="Scan stamped copy" sub={`${stamp.title} · ${stamp.addressee}`} caseId={stamp.case_id} letterId={stamp.id} kind="stamped" onClose={() => setStamp(null)}
        extra={{ label: "Received by (as on the stamp)", placeholder: "e.g. Records Office, OPM" }}
        onSaved={(path, by) => run("confirm_receipt_stamped", { p_letter: stamp.id, p_path: path, p_by: by || null }, "Receipt confirmed by stamped copy", { undo: true })} />}
      {node}
    </div>
  );
}

function QrDialog({ l, appUrl, onClose }: { l: Out; appUrl: string; onClose: () => void }) {
  const url = `${appUrl || window.location.origin}/verify/${l.verify_code}`;
  const [img, setImg] = useState("");
  useEffect(() => { QRCode.toDataURL(url, { width: 240, margin: 1 }).then(setImg); }, [url]);
  return (
    <Modal open onClose={onClose} title="Recipient QR" sub={`${l.title} · ${l.addressee}`} width={420} footer={<button className="btn" onClick={() => window.print()}>Print</button>}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {img && <img src={img} alt="QR code for the receiving office to confirm receipt" width={240} height={240} style={{ alignSelf: "center" }} />}
      <p className="t12" style={{ wordBreak: "break-all" }}>{url}</p>
      <p className="muted t12">The same code is printed on the letter. The page shows only the letter title, the addressee office and the date: no patient health information.</p>
    </Modal>
  );
}
