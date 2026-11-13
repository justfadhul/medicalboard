"use client";
import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { CADRE_LABEL, longDate, type Cadre } from "@/lib/domain";
import type { Me } from "@/lib/data";
import type { CaseBundle, CaseDoc } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { typeLabel } from "@/lib/labels";
import { Field, Modal, Pill, Table } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { usePrompt } from "@/components/Prompt";
import { ScanDialog } from "@/components/scan/ScanDialog";
import { Viewer } from "@/components/Viewer";

const COLS = "minmax(220px,2.4fr) 130px 120px minmax(240px,2fr)";

export function DocumentsTab({ b, me }: { b: CaseBundle; me: Me }) {
  const { c, docs } = b;
  const { run } = useToast();
  const [ask, promptNode] = usePrompt();
  const editable = (c.stage === "intake" && ["registry", "secretariat", "admin"].includes(me.role)) || (c.stage === "review" && ["registry", "secretariat", "admin"].includes(me.role));
  const canScan = editable && me.role !== "commissioner";
  const [scan, setScan] = useState<{ doc: CaseDoc | null; batch: boolean } | null>(null);
  const [preview, setPreview] = useState<CaseDoc | null>(null);
  const [slip, setSlip] = useState(false);
  const [cover, setCover] = useState(false);
  const [add, setAdd] = useState({ name: "", scope: "" as Cadre | "" });

  const received = docs.filter((d) => d.status === "received");
  const scanned = received.filter((d) => d.document_pages.length > 0).length;
  const missing = docs.filter((d) => d.status === "not_brought");

  async function toggle(d: CaseDoc) {
    if (d.status === "received") {
      const reason = await ask({ title: `Mark “${d.name}” not brought`, label: "Reason not brought", placeholder: "e.g. to be presented at the sitting", confirm: "Mark not brought" });
      if (reason) await run("set_document_status", { p_doc: d.id, p_status: "not_brought", p_reason: reason }, "Marked not brought");
    } else await run("set_document_status", { p_doc: d.id, p_status: "received" }, "Marked received. Scan it next.");
  }
  async function addDoc() {
    if (!add.name.trim()) return;
    const ok = await run("add_document", { p_case: c.id, p_name: add.name, p_scope: add.scope || null }, add.scope ? `Added, and mapped to ${CADRE_LABEL[add.scope as Cadre].toLowerCase()}` : "Document added to the checklist");
    if (ok) setAdd({ name: "", scope: "" });
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="muted t12">{scanned} of {received.length} received documents scanned{missing.length ? ` · ${missing.length} not brought` : ""}.</p>
        <div className="row" style={{ gap: 6 }}>
          {missing.length > 0 && <button className="btn sm" onClick={() => setSlip(true)}>Missing-documents slip</button>}
          <button className="btn sm" onClick={() => setCover(true)}>Cover sheet</button>
          {canScan && <button className="btn sm primary" onClick={() => setScan({ doc: null, batch: true })}>Batch scan</button>}
        </div>
      </div>
      <Table cols={COLS} head={["Document", "Receipt", "Scan", "Actions"]} minWidth={720}>
        {docs.map((d) => {
          const failed = d.document_pages.filter((p) => p.quality && p.quality.ok === false).length;
          return (
            <div key={d.id} className="tr" style={{ gridTemplateColumns: COLS }} role="row">
              <span className="stack" style={{ gap: 2 }}>
                <span style={{ fontWeight: 500 }}>{d.name}</span>
                <span className="row" style={{ gap: 4 }}>
                  {d.source === "transplant" && <span className="pill p-purple">Transplant</span>}
                  {d.source === "cadre" && <span className="pill p-grey">Cadre</span>}
                  {d.source === "finding" && <span className="pill p-amber">Requested in review</span>}
                  {d.rule_id && b.rules[d.rule_id] && b.rules[d.rule_id] !== "confirmed" && <span className="pill p-grey" title="Only confirmed rules block a case">Advisory · {d.rule_id}</span>}
                </span>
                {d.reason && d.status !== "received" && <span className="muted t12">Reason: {d.reason}</span>}
              </span>
              <span>{d.status === "received" ? <Pill tone="green">Received</Pill> : d.status === "not_brought" ? <Pill tone="amber">Not brought</Pill> : <Pill>Not applicable</Pill>}</span>
              <span className="stack" style={{ gap: 2 }}>
                {d.status !== "received" ? <span className="muted t12">—</span> : d.document_pages.length
                  ? <Pill tone="green">{d.document_pages.length} page{d.document_pages.length === 1 ? "" : "s"}</Pill> : <Pill tone="red">Not scanned</Pill>}
                {failed > 0 && <span className="t12" style={{ color: "#8A5300" }}>{failed} kept with a quality note</span>}
              </span>
              <span className="row" style={{ gap: 4 }}>
                {d.document_pages.length > 0 && <button className="btn sm" onClick={() => setPreview(d)}>Preview</button>}
                {canScan && d.status !== "not_applicable" && <button className="btn sm" onClick={() => setScan({ doc: d, batch: false })}>{d.document_pages.length ? "Add pages" : "Scan"}</button>}
                {editable && d.status !== "not_applicable" && <button className="btn sm" onClick={() => toggle(d)}>{d.status === "received" ? "Not brought" : "Received"}</button>}
                {editable && d.can_na && d.status !== "not_applicable" && d.document_pages.length === 0 && (
                  <button className="btn sm ghost" onClick={() => run("set_document_status", { p_doc: d.id, p_status: "not_applicable", p_reason: "Not applicable" }, "Marked not applicable")}>N/A</button>
                )}
                {editable && !["standard", "transplant"].includes(d.source) && d.document_pages.length === 0 && (
                  <button className="btn sm ghost" onClick={() => run("remove_document", { p_doc: d.id }, "Removed from the checklist")}>Remove</button>
                )}
              </span>
            </div>
          );
        })}
      </Table>
      {editable && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Request another document" style={{ flex: "1 1 260px" }}>
            <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="e.g. Letter from the employer" />
          </Field>
          {c.type === "retirement" && (
            <Field label="Applies to" style={{ flex: "0 1 220px" }}>
              <select value={add.scope} onChange={(e) => setAdd({ ...add, scope: e.target.value as Cadre })}>
                <option value="">This case only</option>{(Object.keys(CADRE_LABEL) as Cadre[]).map((k) => <option key={k} value={k}>{CADRE_LABEL[k]}</option>)}
              </select>
            </Field>
          )}
          <button className="btn" onClick={addDoc}>Add document</button>
        </div>
      )}
      {scan && (
        <ScanDialog open onClose={() => setScan(null)} caseId={c.id} caseNo={c.case_no} caseName={c.name} doc={scan.doc} batch={scan.batch}
          docs={docs.map((d) => ({ id: d.id, name: d.name, status: d.status }))} />
      )}
      {preview && <PreviewDialog doc={preview} caseName={c.name} onClose={() => setPreview(null)} canEdit={editable} />}
      {slip && <SlipDialog b={b} onClose={() => setSlip(false)} />}
      {cover && <CoverDialog b={b} onClose={() => setCover(false)} />}
      {promptNode}
    </div>
  );
}

function PreviewDialog({ doc, caseName, onClose, canEdit }: { doc: CaseDoc; caseName: string; onClose: () => void; canEdit: boolean }) {
  const [page, setPage] = useState(1);
  const { run } = useToast();
  async function pdf() {
    const r = await fetch("/api/scan/assemble", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: doc.id, url: true }) });
    const j = await r.json(); if (j.url) window.open(j.url, "_blank", "noopener");
  }
  const cur = doc.document_pages[page - 1];
  return (
    <Modal open onClose={onClose} title={doc.name} sub={`${caseName} · ${doc.document_pages.length} page(s)`} width={900}
      footer={<>
        {canEdit && cur && <button className="btn danger" onClick={async () => { if (await run("delete_page", { p_page: cur.id }, "Page deleted")) onClose(); }}>Delete this page</button>}
        <button className="btn" onClick={pdf}>Open combined PDF</button>
      </>}>
      <Viewer title={doc.name} pages={doc.document_pages} page={page} onPage={setPage} canRotate={canEdit} height={600} />
      {cur?.keep_reason && <p className="warnbox t12">Kept despite a quality warning ({cur.quality?.issues?.join("; ")}): {cur.keep_reason}</p>}
    </Modal>
  );
}

function SlipDialog({ b, onClose }: { b: CaseBundle; onClose: () => void }) {
  const { run } = useToast();
  const [d, setD] = useState<{ items: string[]; sitting_date: string; cutoff_date: string; phone: string | null } | null>(null);
  useEffect(() => { supabaseBrowser().rpc("missing_slip", { p_case: b.c.id, p_send: false }).then(({ data }) => setD(data)); }, [b.c.id]);
  return (
    <Modal open onClose={onClose} title="Missing-documents slip" width={540}
      footer={<><button className="btn" onClick={() => window.print()}>Print slip</button>
        <button className="btn primary" disabled={!b.c.sms_consent || !b.c.phone} title={!b.c.sms_consent ? "No consent to SMS" : undefined}
          onClick={() => run("missing_slip", { p_case: b.c.id, p_send: true }, "Slip sent by SMS")}>Send by SMS</button></>}>
      <div className="stack" style={{ gap: 8, border: "1px solid #E9E9EC", borderRadius: 8, padding: 16 }}>
        <b>Ministry of Health · Uganda Medical Board Registry</b>
        <span>{b.c.name} · {b.c.case_no}</span>
        <span>Please bring these documents to the Registry:</span>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{(d?.items ?? []).map((x) => <li key={x}>{x}</li>)}</ul>
        {d && <p>Your case goes before the Board only once these are received. The next sitting is on {longDate(d.sitting_date)}; bring them by {longDate(d.cutoff_date)}.</p>}
      </div>
      <p className="muted t12">{b.c.sms_consent && b.c.phone ? `The SMS goes to ${b.c.phone}.` : "No SMS: the applicant did not consent, or there is no phone on file."}</p>
    </Modal>
  );
}

function CoverDialog({ b, onClose }: { b: CaseBundle; onClose: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => { if (svg.current) JsBarcode(svg.current, b.c.case_no, { format: "CODE128", width: 2, height: 60, displayValue: true, margin: 8 }); }, [b.c.case_no]);
  const order = b.docs.filter((d) => d.status !== "not_applicable");
  return (
    <Modal open onClose={onClose} title="Batch-scan cover sheet" width={560} footer={<button className="btn primary" onClick={() => window.print()}>Print cover sheet</button>}>
      <div className="stack" style={{ gap: 10, border: "1px solid #E9E9EC", borderRadius: 8, padding: 20 }}>
        <b>Uganda Medical Board · scan cover sheet</b>
        <svg ref={svg} role="img" aria-label={`Case barcode ${b.c.case_no}`} />
        <span style={{ fontSize: 18, fontWeight: 700 }}>{b.c.case_no}</span>
        <span>{b.c.name} · {typeLabel(b.c.type)}</span>
        <span className="label">Scan order (place this sheet on top)</span>
        <ol style={{ margin: 0, paddingLeft: 20 }}>{order.map((d) => <li key={d.id}>{d.name}</li>)}</ol>
      </div>
    </Modal>
  );
}
