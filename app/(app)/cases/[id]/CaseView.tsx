"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ageFrom, daysIn, daysLabel, daysTone, FUNDING_LABEL, initials, ROLE_LABEL, shortDate, stageMeta, type Role } from "@/lib/domain";
import type { Me } from "@/lib/data";
import type { Officers } from "@/lib/letters/content";
import type { CaseBundle } from "@/lib/types";
import { typeLabel } from "@/lib/labels";
import { Avatar, Field, Modal, Pill, StageProgress, Tabs } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { usePrompt } from "@/components/Prompt";
import { DocumentsTab } from "./DocumentsTab";
import { ReviewTab } from "./ReviewTab";
import { LettersTab } from "./LettersTab";
import { CollectionDialog } from "./CollectionDialog";

type Tab = "documents" | "review" | "letters" | "activity";

export function CaseView({ b, me, initialTab, officers, appUrl, th }: { b: CaseBundle; me: Me; initialTab?: string; officers: Officers; appUrl: string; th: { amber: number; red: number } }) {
  const { c } = b;
  const router = useRouter();
  const sp = useSearchParams();
  const { run, toast } = useToast();
  const [ask, promptNode] = usePrompt();
  const isReg = me.role === "registry" || me.role === "admin";
  const isSec = me.role === "secretariat" || me.role === "admin";
  const canReview = isSec || me.role === "commissioner";
  const defaultTab: Tab = (initialTab as Tab) || (me.role === "registry" ? "documents" : c.stage === "review" && canReview ? "review" : ["decided", "signature", "signed", "collected", "closed"].includes(c.stage) ? "letters" : "documents");
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [edit, setEdit] = useState(false);
  const [collect, setCollect] = useState(false);
  useEffect(() => { if (sp.get("created")) toast("Case created. Scan each received document, then send the case to the Secretariat."); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const days = daysIn(c.stage_entered_at);
  const allOk = b.criteria.every((k) => k.ok);
  const m = stageMeta(c.stage);
  const payer = c.type === "retirement" ? c.employer?.name ?? "" : c.funding ? FUNDING_LABEL[c.funding] : "";
  const openFindings = b.findings.filter((f) => !f.resolved).length;

  async function hold() {
    if (c.hold) return run("set_hold", { p_case: c.id, p_hold: false }, "Hold released");
    const reason = await ask({ title: "Put the case on hold", label: "Reason", placeholder: "e.g. Awaiting funding confirmation from the ministry", confirm: "Put on hold" });
    if (reason) await run("set_hold", { p_case: c.id, p_hold: true, p_reason: reason }, "Case put on hold");
  }
  async function returnReg() {
    const note = await ask({ title: "Return to Registry", label: "What the Registry needs to do", multiline: true, confirm: "Return to Registry" });
    if (note) { const ok = await run("return_to_registry", { p_case: c.id, p_note: note }, "Returned to the Registry, who have been tagged"); if (ok) router.push("/review"); }
  }

  const actions: React.ReactNode[] = [];
  if (c.stage === "intake" && isReg) actions.push(<button key="s" className="btn primary" onClick={() => run("send_to_secretariat", { p_case: c.id }, "Sent to the Secretariat")}>Send to Secretariat</button>);
  if (c.stage === "review" && isSec) {
    actions.push(<button key="h" className="btn" onClick={hold}>{c.hold ? "Release hold" : "Put on hold"}</button>);
    actions.push(<button key="r" className="btn" onClick={returnReg}>Return to Registry</button>);
    actions.push(<button key="m" className="btn primary" disabled={!allOk} title={allOk ? undefined : "Every criterion must pass first"}
      onClick={() => run<{ sitting_date: string; serial: number }>("mark_ready", { p_case: c.id }, (d) => `Ready for the Board: on the agenda of ${shortDate(d.sitting_date)} as S/N ${d.serial}`)}>Mark ready for Board</button>);
  }
  if (c.stage === "decided" && isSec && c.decision === "approved") actions.push(<Link key="d" className="btn primary" href="/drafting">Go to drafting</Link>);
  if (c.stage === "signed" && isReg) actions.push(<button key="c" className="btn primary" onClick={() => setCollect(true)}>Record collection</button>);

  const tabs: { key: Tab; label: string; count?: number | string }[] = [
    { key: "documents", label: "Documents", count: b.docs.length },
    ...(canReview ? [{ key: "review" as Tab, label: "Review", count: openFindings || "" }] : []),
    { key: "letters", label: "Letters", count: b.letters.length || "" },
    { key: "activity", label: "Activity" },
  ];

  const particulars: [string, string][] = [
    ["Case number", c.case_no], ["Type", typeLabel(c.type)], ["Gender", c.gender],
    ["Date of birth", `${shortDate(c.dob)} (age ${ageFrom(c.dob)})`], ...(c.stated_age != null ? [["Stated age", String(c.stated_age)] as [string, string]] : []),
    ["Phone for SMS", c.phone ? `${c.phone}${c.sms_consent ? "" : " (no SMS consent)"}` : "None"],
    ...(c.type === "retirement" ? [["Employer", c.employer?.name ?? ""], ["Place of work", c.station ?? ""]] as [string, string][] : [
      ["Who pays", payer + (c.funding_body ? ` (${c.funding_body})` : "")], ["Procedure", c.procedure ?? ""], ["Country", c.country ?? ""],
      ...(canReview ? [["Diagnosis", c.diagnosis ?? "—"]] as [string, string][] : []),
      ["Referring doctor", c.referring_doctor ?? "—"], ["Receiving doctor", c.receiving_doctor ?? "—"], ["Receiving centre", c.receiving_centre ?? "—"],
      ["Cost", c.cost_figures ? `${c.cost_figures}${c.cost_words ? ` (${c.cost_words})` : ""}` : "—"], ["Duration of stay", c.duration ?? "—"],
      ["Person accompanying", c.accompanying ?? "—"], ["Referred abroad before", c.earlier_referral ? "Yes" : "No"],
    ] as [string, string][]),
    ...(c.type === "retirement" && canReview ? [["Diagnosis (not stated in letters)", c.diagnosis ?? "—"]] as [string, string][] : []),
    ...(c.sitting ? [["Sitting", `${shortDate(c.sitting.sitting_date)}${c.agenda_serial ? ` · S/N ${c.agenda_serial}` : ""}`]] as [string, string][] : []),
    ...(c.minute_no ? [["Minute", c.minute_no], ["Decision", (c.decision ?? "").replace("_", " ")]] as [string, string][] : []),
  ];
  const canEdit = (c.stage === "intake" && (isReg || isSec)) || (["review", "ready", "decided"].includes(c.stage) && isSec);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row"><button className="btn ghost sm" onClick={() => router.back()}>Back</button></div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "nowrap" }}>
          <span className="av" style={{ width: 40, height: 40, fontSize: 14 }} aria-hidden>{initials(c.name)}</span>
          <div className="stack" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 8 }}>
              <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{c.name}</h1>
              <Pill tone={m.tone}>{m.label}</Pill>
              {c.hold && <Pill tone="red" title={c.hold_reason ?? ""}>On hold</Pill>}
            </div>
            <p className="muted t12">{c.case_no} · {typeLabel(c.type)} · {payer} · <Pill tone={daysTone(days, th.amber, th.red)}>{daysLabel(days)}</Pill></p>
            {c.hold && <p className="t12" style={{ color: "#991B1B" }}>Hold: {c.hold_reason}</p>}
          </div>
        </div>
        <div className="row">{actions}</div>
      </div>
      <StageProgress stage={c.stage} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 16 }} className="review3">
        <div className="stack" style={{ gap: 14, minWidth: 0 }}>
          <Tabs label="Case sections" tabs={tabs} value={tab} onChange={setTab} />
          <div role="tabpanel">
            {tab === "documents" && <DocumentsTab b={b} me={me} />}
            {tab === "review" && canReview && <ReviewTab b={b} me={me} />}
            {tab === "letters" && <LettersTab b={b} me={me} officers={officers} appUrl={appUrl} />}
            {tab === "activity" && <Activity b={b} me={me} />}
          </div>
        </div>
        <aside className="panel stack" style={{ gap: 8, alignSelf: "start" }} aria-label="Particulars">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="h2">Particulars</h2>
            {canEdit && <button className="btn sm" onClick={() => setEdit(true)}>Edit</button>}
          </div>
          {particulars.map(([k, v]) => (
            <div key={k} className="stack" style={{ gap: 1 }}><span className="label">{k}</span><span>{v || "—"}</span></div>
          ))}
          {c.collections.filter((x) => !x.reversed).map((x) => (
            <div key={x.collected_at} className="stack" style={{ gap: 1 }}><span className="label">Collected</span><span>{x.collector_name} ({x.relationship}), {shortDate(x.collected_at)}</span></div>
          ))}
        </aside>
      </div>
      {edit && <EditParticulars b={b} onClose={() => setEdit(false)} showClinical={isSec} />}
      {collect && <CollectionDialog c={c} letters={b.letters} onClose={() => setCollect(false)} />}
      {promptNode}
    </div>
  );
}

function EditParticulars({ b, onClose, showClinical }: { b: CaseBundle; onClose: () => void; showClinical: boolean }) {
  const { c } = b;
  const { run } = useToast();
  const keys: [keyof typeof c, string][] = [["name", "Full name"], ["dob", "Date of birth"], ["stated_age", "Stated age"], ["phone", "Phone for SMS"],
    ...(c.type === "retirement" ? [["station", "Place of work"]] as [keyof typeof c, string][] : [["procedure", "Procedure"], ["country", "Country"],
      ["referring_doctor", "Referring doctor"], ["receiving_doctor", "Receiving doctor"], ["receiving_centre", "Receiving centre"], ["cost_figures", "Cost in figures"],
      ["cost_words", "Cost in words"], ["duration", "Duration of stay"], ["accompanying", "Person accompanying (relationship)"], ["funding_body", "Funding ministry or agency"]] as [keyof typeof c, string][]),
    ...(showClinical ? [["diagnosis", "Diagnosis"]] as [keyof typeof c, string][] : [])];
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(keys.map(([k]) => [k, String(c[k] ?? "")])));
  const [consent, setConsent] = useState(c.sms_consent);
  async function save() {
    const p: Record<string, unknown> = { sms_consent: consent };
    for (const [k] of keys) if ((v[k as string] ?? "") !== String(c[k] ?? "")) p[k as string] = v[k as string];
    if (await run("update_case", { p_case: c.id, p }, "Particulars saved")) onClose();
  }
  return (
    <Modal open onClose={onClose} title="Edit particulars" sub={`${c.name} · ${c.case_no}`} width={640}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {keys.map(([k, label]) => (
          <Field key={k as string} label={label}>
            <input type={k === "dob" ? "date" : "text"} value={v[k as string]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 16, height: 16 }} checked={consent} onChange={(e) => setConsent(e.target.checked)} />Consent to SMS updates</label>
      <p className="muted t12">Letters always use the age calculated from the date of birth.</p>
    </Modal>
  );
}

function Activity({ b, me }: { b: CaseBundle; me: Me }) {
  const { run } = useToast();
  const [text, setText] = useState(""); const [tag, setTag] = useState("");
  const canNote = me.role !== "commissioner"; // read-only
  const items = [
    ...b.notes.map((n) => ({ key: "n" + n.id, at: n.created_at, who: n.author?.full_name || n.author?.email || "System", text: n.body,
      tag: n.tag_role ? `for ${ROLE_LABEL[n.tag_role]}` : n.tag_user ? `for ${b.users.find((u) => u.id === n.tag_user)?.full_name ?? "a colleague"}` : "", note: true })),
    ...b.audit.map((a) => ({ key: "a" + a.id, at: a.created_at, who: a.actor_label ?? "System", text: a.summary, tag: a.reverses ? "undo" : "", note: false })),
  ].sort((x, y) => y.at.localeCompare(x.at));
  async function add() {
    if (!text.trim()) return;
    const [kind, id] = tag.split(":");
    const ok = await run("add_note", { p_case: b.c.id, p_body: text, p_tag_role: kind === "role" ? id : null, p_tag_user: kind === "user" ? id : null }, "Note added");
    if (ok) { setText(""); setTag(""); }
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      {canNote && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Add a note" style={{ flex: "1 1 320px" }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note for the case file" onKeyDown={(e) => e.key === "Enter" && add()} /></Field>
          <Field label="Tag a colleague" style={{ flex: "0 1 240px" }}>
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">No one</option>
              <optgroup label="Role">{(["registry", "secretariat", "commissioner", "admin"] as Role[]).map((r) => <option key={r} value={`role:${r}`}>{ROLE_LABEL[r]}</option>)}</optgroup>
              <optgroup label="Person">{b.users.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={`user:${u.id}`}>{u.full_name || u.email}</option>)}</optgroup>
            </select>
          </Field>
          <button className="btn" onClick={add}>Add note</button>
        </div>
      )}
      <ol className="stack" style={{ gap: 0, listStyle: "none", padding: 0, margin: 0 }} aria-label="Activity timeline">
        {items.map((e) => (
          <li key={e.key} className="row" style={{ gap: 10, padding: "10px 0", borderBottom: "1px solid #F1F1F3", alignItems: "flex-start", flexWrap: "nowrap" }}>
            <Avatar ini={initials(e.who)} />
            <div className="stack" style={{ gap: 2 }}>
              <span className="muted t12">{e.who} · {new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}{e.tag ? ` · ${e.tag}` : ""}</span>
              <span style={{ fontWeight: e.note ? 500 : 400 }}>{e.note ? "Note: " : ""}{e.text}</span>
            </div>
          </li>
        ))}
        {!items.length && <p className="muted">No activity yet.</p>}
      </ol>
    </div>
  );
}
