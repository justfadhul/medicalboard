"use client";
import { useMemo, useState } from "react";
import type { Me } from "@/lib/data";
import type { CaseBundle, FieldRow, FindingRow } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { copyText, cls, errMsg } from "@/lib/util";
import { Field, Pill, Tabs } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { Viewer, type Box } from "@/components/Viewer";

const TYPE_LABEL: Record<FindingRow["type"], string> = { missing_document: "Missing document", missing_information: "Missing information", mismatch: "Mismatch between documents", other: "Other" };
const FIELD_KEYS: [string, string][] = [["name", "Name on documents"], ["dob", "Date of birth (YYYY-MM-DD)"], ["stated_age", "Stated age"], ["diagnosis", "Diagnosis"],
  ["referring_doctor", "Referring doctor"], ["receiving_doctor", "Receiving doctor"], ["cost_figures", "Cost in figures"], ["cost_words", "Cost in words"],
  ["quote_amount", "Amount on the quote"], ["funding_source", "Funding source (commitment letter)"], ["report_date", "Report date (YYYY-MM-DD)"], ["other", "Other"]];

export function findingText(f: FindingRow, docName?: string) {
  return `${TYPE_LABEL[f.type]}${docName ? ` (${docName})` : ""}: ${f.what}${f.reasoning ? `. Reasoning: ${f.reasoning}` : ""}. Effect: ${f.effect === "block" ? "blocks the Board" : "for the record"}${f.resolved ? " [resolved]" : ""}.`;
}

export function ReviewTab({ b, me }: { b: CaseBundle; me: Me }) {
  const { c, docs, fields, flags, findings, criteria } = b;
  const { run, toast } = useToast();
  const canAct = (me.role === "secretariat" || me.role === "admin") && ["review", "ready"].includes(c.stage);
  const [docId, setDocId] = useState(docs.find((d) => d.document_pages.length)?.id ?? docs[0]?.id ?? "");
  const [page, setPage] = useState(1);
  const [hl, setHl] = useState<Box | null>(null);
  const [pane, setPane] = useState<"findings" | "fields" | "flags">("findings");
  const [f, setF] = useState({ type: "missing_information" as FindingRow["type"], what: "", why: "", effect: "block" as "block" | "record" });
  const [nf, setNf] = useState({ key: "name", label: "", value: "" });
  const [aiBusy, setAiBusy] = useState(false);
  const doc = docs.find((d) => d.id === docId);
  const docName = (id: string | null) => docs.find((d) => d.id === id)?.name;
  const openFindings = useMemo(() => Object.fromEntries(docs.map((d) => [d.id, findings.filter((x) => x.document_id === d.id && !x.resolved).length])), [docs, findings]);

  function show(id: string, p = 1, box: Box | null = null) { setDocId(id); setPage(p); setHl(box); }
  async function saveFinding() {
    if (!f.what.trim()) return toast("Say what is missing or wrong", { tone: "error" });
    const ok = await run("add_finding", { p_case: c.id, p_doc: docId || null, p_type: f.type, p_what: f.what, p_reasoning: f.why, p_effect: f.effect },
      f.type === "missing_document" ? "Finding saved. The document joined the checklist and the Registry was tagged." : "Finding saved");
    if (ok) setF({ ...f, what: "", why: "" });
  }
  async function copyAll() {
    const lines = findings.map((x, i) => `${i + 1}. ${findingText(x, docName(x.document_id))}`);
    const ok = await copyText(`Review findings: ${c.name} (${c.case_no})\n\n${lines.join("\n") || "No findings."}`);
    toast(ok ? `Copied ${findings.length} finding(s)` : "Could not copy", { tone: ok ? "info" : "error" });
  }
  async function addField() {
    if (!nf.value.trim()) return;
    const label = nf.key === "other" ? nf.label || "Other" : FIELD_KEYS.find((k) => k[0] === nf.key)![1].replace(/ \(YYYY-MM-DD\)/, "");
    const ok = await run("upsert_field", { p_case: c.id, p_key: nf.key === "other" ? (nf.label || "other").toLowerCase().replace(/\W+/g, "_") : nf.key, p_label: label,
      p_value: nf.value, p_doc: docId || null, p_page: doc?.document_pages.length ? page : null }, "Field added from the page in view. Confirm it against the scan.");
    if (ok) setNf({ key: nf.key, label: "", value: "" });
  }
  async function readAi() {
    if (!doc) return;
    setAiBusy(true);
    const { error } = await supabaseBrowser().functions.invoke("ai-read", { body: { case_id: c.id, document_id: doc.id } });
    setAiBusy(false);
    if (error) toast(errMsg(error), { tone: "error" }); else { toast("Fields read. Each one must be confirmed against the scan."); location.reload(); }
  }

  const emptyNote = !doc ? null : doc.status === "not_brought" ? `Not brought. Reason: ${doc.reason ?? "none given"}.` : doc.status === "not_applicable" ? "Marked not applicable." : "Received but not scanned yet.";
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 6 }} aria-label="Criteria for the Board">
        <span className="label">Criteria</span>
        {criteria.map((k) => <Pill key={k.key} tone={k.ok ? "green" : "red"} title={k.note}>{k.label}</Pill>)}
      </div>
      {criteria.filter((k) => !k.ok).length > 0 && <p className="muted t12">{criteria.filter((k) => !k.ok).map((k) => `${k.label}: ${k.note}`).join(" · ")}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0,1fr) 320px", gap: 12 }} className="review3">
        <nav className="stack" style={{ gap: 4 }} aria-label="Documents">
          <span className="label">Documents</span>
          {docs.map((d) => (
            <button key={d.id} onClick={() => show(d.id)} className={cls("sig", d.id === docId && "on")} aria-current={d.id === docId}>
              <span style={{ fontWeight: 500 }}>{d.name}</span>
              <span className="row t12" style={{ gap: 4 }}>
                <span className="muted">{d.status === "received" ? `${d.document_pages.length} page(s)` : d.status === "not_brought" ? "Not brought" : "N/A"}</span>
                {openFindings[d.id] ? <span className="pill p-amber">{openFindings[d.id]} finding(s)</span> : null}
              </span>
            </button>
          ))}
        </nav>
        <div className="stack" style={{ gap: 8, minWidth: 0 }}>
          <Viewer title={doc?.name ?? ""} pages={doc?.document_pages ?? []} page={page} onPage={(n) => { setPage(n); setHl(null); }} highlight={hl} height={620}
            empty={doc && <>
              <b>{doc.name}</b><span className="muted">{emptyNote}</span>
              {canAct && <button className="btn sm" onClick={() => { setPane("findings"); setF({ ...f, type: doc.status === "not_brought" ? "missing_document" : "missing_information", what: doc.name, why: emptyNote ?? "" }); }}>Note it as a finding</button>}
            </>} />
          {b.aiEnabled && canAct && doc?.document_pages.length ? (
            <div className="row"><button className="btn sm" onClick={readAi} disabled={aiBusy}>{aiBusy ? "Reading…" : "Read this document with AI"}</button>
              <span className="muted t12">Sends only this document&apos;s pages. Results arrive unconfirmed.</span></div>
          ) : null}
        </div>
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <Tabs label="Review panes" value={pane} onChange={setPane} tabs={[
            { key: "findings", label: "Findings", count: findings.filter((x) => !x.resolved).length || "" },
            { key: "fields", label: "Fields", count: fields.filter((x) => !x.confirmed).length || "" },
            { key: "flags", label: "Flags", count: flags.filter((x) => !x.resolved).length || "" }]} />
          {pane === "findings" && (
            <div className="stack" style={{ gap: 10 }}>
              {canAct && (
                <div className="panel stack" style={{ gap: 8, padding: 12 }}>
                  <b className="t12">New finding · {doc?.name ?? "case"}</b>
                  <select aria-label="Type of finding" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as FindingRow["type"] })}>
                    {(Object.keys(TYPE_LABEL) as FindingRow["type"][]).map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}
                  </select>
                  <input aria-label="What is missing or wrong" placeholder={f.type === "missing_document" ? "Name of the missing document" : "What is missing or wrong"} value={f.what} onChange={(e) => setF({ ...f, what: e.target.value })} />
                  <textarea aria-label="Reasoning" rows={3} placeholder="Your reasoning: why this matters for the Board's decision" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} />
                  <div className="row">
                    <select aria-label="Effect" value={f.effect} onChange={(e) => setF({ ...f, effect: e.target.value as "block" | "record" })} style={{ flex: "1 1 150px" }}>
                      <option value="block">Blocks the Board</option><option value="record">For the record</option></select>
                    <button className="btn primary" onClick={saveFinding}>Save finding</button>
                  </div>
                  <span className="muted t12">A missing document joins the checklist and the Registry is tagged to obtain it.</span>
                </div>
              )}
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted t12">{findings.length} finding(s)</span>
                <button className="btn sm" onClick={copyAll}>Copy all findings</button>
              </div>
              {findings.map((x) => (
                <div key={x.id} className="panel stack" style={{ gap: 4, padding: 12, opacity: x.resolved ? 0.7 : 1 }}>
                  <span className="row" style={{ gap: 4 }}>
                    <b className="t12">{TYPE_LABEL[x.type]}</b>
                    <Pill tone={x.effect === "block" ? "red" : "grey"}>{x.effect === "block" ? "Blocks the Board" : "For the record"}</Pill>
                    {x.resolved && <Pill tone="green">Resolved</Pill>}
                  </span>
                  <span style={{ fontWeight: 500 }}>{x.what}</span>
                  {x.reasoning && <span className="t12">{x.reasoning}</span>}
                  <span className="t12 muted">
                    {x.document_id && <button className="btn sm ghost" style={{ padding: 0, height: "auto", color: "#1F5BCC" }} onClick={() => show(x.document_id!)}>{docName(x.document_id)}</button>}
                    {" · "}{x.author?.full_name || x.author?.email} · {new Date(x.created_at).toLocaleDateString("en-GB")}
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    <button className="btn sm" onClick={async () => toast((await copyText(findingText(x, docName(x.document_id)))) ? "Finding copied" : "Could not copy")}>Copy</button>
                    {canAct && <button className="btn sm" onClick={() => run("set_finding_resolved", { p_finding: x.id, p_resolved: !x.resolved }, x.resolved ? "Finding reopened" : "Finding resolved")}>{x.resolved ? "Reopen" : "Resolve"}</button>}
                  </span>
                </div>
              ))}
              {!findings.length && <p className="muted t12">No findings yet. Note anything missing or unclear as you read, with your reasoning.</p>}
            </div>
          )}
          {pane === "fields" && (
            <div className="stack" style={{ gap: 8 }}>
              {!fields.length && <p className="muted t12">No fields have been read from the scans yet. Add them from the page in view.</p>}
              {fields.map((x: FieldRow) => (
                <div key={x.id} className="panel stack" style={{ gap: 4, padding: 12 }}>
                  <span className="row" style={{ justifyContent: "space-between" }}>
                    <span className="label">{x.label}</span>
                    {x.confirmed ? <Pill tone="green">Confirmed</Pill> : <Pill tone="amber">To confirm</Pill>}
                  </span>
                  <b>{x.value}</b>
                  <span className="muted t12">Source: {docName(x.document_id) ?? "not linked"}{x.page_no ? `, page ${x.page_no}` : ""}{x.origin === "ai" ? " · read by AI" : ""}</span>
                  <span className="row" style={{ gap: 4 }}>
                    {x.document_id && <button className="btn sm" onClick={() => show(x.document_id!, x.page_no ?? 1, x.bbox)}>Show source</button>}
                    {canAct && (x.confirmed
                      ? <button className="btn sm" onClick={() => run("confirm_field", { p_field: x.id, p_confirmed: false }, "Unconfirmed")}>Unconfirm</button>
                      : <button className="btn sm primary" onClick={() => run("confirm_field", { p_field: x.id }, "Confirmed against the scan")}>Confirm</button>)}
                  </span>
                </div>
              ))}
              {canAct && (
                <div className="panel stack" style={{ gap: 8, padding: 12 }}>
                  <b className="t12">Add a field from {doc?.name ?? "this document"}{doc?.document_pages.length ? `, page ${page}` : ""}</b>
                  <select aria-label="Field" value={nf.key} onChange={(e) => setNf({ ...nf, key: e.target.value })}>{FIELD_KEYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  {nf.key === "other" && <input aria-label="Field name" placeholder="Field name" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} />}
                  <Field label="Value as written on the page"><input value={nf.value} onChange={(e) => setNf({ ...nf, value: e.target.value })} /></Field>
                  <button className="btn" onClick={addField}>Add field</button>
                </div>
              )}
            </div>
          )}
          {pane === "flags" && (
            <div className="stack" style={{ gap: 8 }}>
              {!flags.length && <p className="muted t12">No mismatches found by the checks.</p>}
              {flags.map((x) => (
                <div key={x.id} className="panel stack" style={{ gap: 6, padding: 12 }}>
                  <span>{x.text}</span>
                  <span className="row" style={{ justifyContent: "space-between" }}>
                    {x.resolved ? <Pill tone="green">Resolved</Pill> : <Pill tone="red">Open</Pill>}
                    {canAct && <button className="btn sm" onClick={() => run("resolve_flag", { p_flag: x.id, p_resolved: !x.resolved }, x.resolved ? "Flag reopened" : "Flag resolved")}>{x.resolved ? "Reopen" : "Mark resolved"}</button>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
