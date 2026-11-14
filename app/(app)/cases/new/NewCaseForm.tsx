"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ageText, CADRE_LABEL, FUNDING_LABEL, stageMeta, type Cadre, type CaseType, type Funding, type Stage } from "@/lib/domain";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cls, errMsg } from "@/lib/util";
import { Field, PageHead } from "@/components/ui";

type Doc = { key: string; catalog_key: string | null; name: string; can_na: boolean; tag: string | null; status: "received" | "not_brought" | "not_applicable"; reason: string; custom?: Cadre | "case" };
const EMPTY = { type: "retirement" as CaseType, name: "", gender: "Female", dob: "", stated_age: "", phone: "", sms_consent: false, employer_id: "", station: "",
  funding: "family" as Funding, funding_body: "", procedure: "", procedure_other: "", country: "", country_other: "", diagnosis: "", referring_doctor: "",
  receiving_doctor: "", receiving_centre: "", earlier_referral: false };

export function NewCaseForm({ employers, procedures, countries }: { employers: { id: number; name: string; cadre: Cadre | null }[]; procedures: string[]; countries: string[] }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [d, setD] = useState(EMPTY);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [custom, setCustom] = useState({ name: "", scope: "case" as Cadre | "case" });
  const [dups, setDups] = useState<{ id: string; case_no: string; name: string; stage: Stage }[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setD((x) => ({ ...x, [k]: v }));
  const procedure = d.procedure === "__other" ? d.procedure_other : d.procedure;

  useEffect(() => {
    (async () => {
      const { data } = await sb.rpc("checklist_for", { p_type: d.type, p_procedure: procedure || null, p_employer: d.employer_id ? Number(d.employer_id) : null });
      setDocs((prev) => {
        const kept = prev.filter((x) => x.custom);
        const fresh = ((data ?? []) as { catalog_key: string | null; name: string; can_na: boolean; tag: string | null }[]).map((r) => {
          const old = prev.find((p) => p.name === r.name && !p.custom);
          return { key: r.catalog_key ?? r.name, catalog_key: r.catalog_key, name: r.name, can_na: r.can_na, tag: r.tag,
            status: old?.status ?? (r.catalog_key === "earlier_report" && !d.earlier_referral ? "not_applicable" : "received"), reason: old?.reason ?? "" } as Doc;
        });
        return [...fresh, ...kept.filter((k) => !fresh.some((f) => f.name.toLowerCase() === k.name.toLowerCase()))];
      });
    })();
  }, [d.type, procedure, d.employer_id, d.earlier_referral]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!d.name.trim() || !d.dob) { setDups([]); return; }
    const t = setTimeout(async () => {
      const { data } = await sb.rpc("find_duplicates", { p_name: d.name, p_dob: d.dob });
      setDups((data ?? []) as never);
    }, 300);
    return () => clearTimeout(t);
  }, [d.name, d.dob]); // eslint-disable-line react-hooks/exhaustive-deps

  const updDoc = (i: number, p: Partial<Doc>) => setDocs((x) => x.map((y, k) => (k === i ? { ...y, ...p } : y)));
  function addCustom() {
    if (!custom.name.trim()) return;
    if (docs.some((x) => x.name.toLowerCase() === custom.name.trim().toLowerCase())) { setErr("That document is already on the list."); return; }
    setDocs((x) => [...x, { key: custom.name, catalog_key: null, name: custom.name.trim(), can_na: false, status: "received", reason: "",
      tag: custom.scope === "case" ? "This case only" : "Required for " + CADRE_LABEL[custom.scope].replace("All ", "all "), custom: custom.scope }]);
    setCustom({ name: "", scope: "case" });
  }

  async function create() {
    setErr("");
    if (!d.name.trim() || !d.dob) return setErr("Enter the full name and date of birth.");
    if (d.type === "retirement" && !d.employer_id) return setErr("Choose the employer.");
    if (d.type === "referral" && (!procedure || !(d.country === "__other" ? d.country_other : d.country))) return setErr("Choose the procedure and country.");
    const bad = docs.find((x) => x.status === "not_brought" && !x.reason.trim());
    if (bad) return setErr(`Give a reason "${bad.name}" was not brought.`);
    if (d.sms_consent && !d.phone.trim()) return setErr("Enter the phone number for SMS updates, or untick consent.");
    setBusy(true);
    const p = {
      ...d, procedure, country: d.country === "__other" ? d.country_other : d.country, stated_age: d.stated_age || null,
      docs: docs.filter((x) => !x.custom).map((x) => ({ catalog_key: x.catalog_key, name: x.name, status: x.status, reason: x.reason })),
      custom: docs.filter((x) => x.custom).map((x) => ({ name: x.name, scope: x.custom, status: x.status, reason: x.reason })),
    };
    const { data, error } = await sb.rpc("create_case", { p });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    router.push(`/cases/${data}?tab=documents&created=1`);
  }

  const age = d.dob ? ageText(d.dob) : null;
  return (
    <div className="stack" style={{ gap: 14, maxWidth: 920 }}>
      <PageHead title="New case" sub="Record the applicant and confirm which documents were handed in. You scan them on the next screen." />
      <div className="panel stack" style={{ gap: 14 }}>
        <div className="row" role="group" aria-label="Case type">
          <span className="label">Case type</span>
          {(["retirement", "referral"] as const).map((t) => (
            <button key={t} className={cls("btn", d.type === t && "sel")} aria-pressed={d.type === t} onClick={() => set("type", t)}>
              {t === "retirement" ? "Retirement on medical grounds" : "Referral abroad"}</button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <Field label="Full name"><input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="As on the ID card" autoComplete="off" /></Field>
          <Field label="Gender"><select value={d.gender} onChange={(e) => set("gender", e.target.value)}><option>Female</option><option>Male</option></select></Field>
          <Field label="Date of birth"><input type="date" value={d.dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("dob", e.target.value)} /></Field>
          <div className="stack" style={{ gap: 6 }}><span className="label">Age from date of birth</span><span style={{ fontWeight: 600, lineHeight: "36px" }}>{age ?? "—"}</span></div>
          <Field label="Age stated on the form (optional)"><input inputMode="numeric" value={d.stated_age} onChange={(e) => set("stated_age", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Phone for SMS updates"><input value={d.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Patient or next of kin, e.g. 07XX XXX XXX" inputMode="tel" /></Field>
        </div>
        <label className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap" }}>
          <input type="checkbox" style={{ width: 16, height: 16, marginTop: 2 }} checked={d.sms_consent} onChange={(e) => set("sms_consent", e.target.checked)} />
          <span>The applicant agrees to receive SMS updates about this case at this number. <span className="muted">No SMS is sent without consent.</span></span>
        </label>
        {dups.map((x) => (
          <div key={x.id} className="warnbox row" role="alert" style={{ justifyContent: "space-between" }}>
            <span>Possible duplicate: {x.name} ({x.case_no}, {stageMeta(x.stage).label}) has the same name and date of birth. Check it before creating a new case.</span>
            <Link className="btn sm" href={`/cases/${x.id}`}>Open existing case</Link>
          </div>
        ))}
        {d.type === "retirement" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="Employer"><select value={d.employer_id} onChange={(e) => set("employer_id", e.target.value)}>
              <option value="">Select the employer</option>{employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
            <Field label="Place of work"><input value={d.station} onChange={(e) => set("station", e.target.value)} placeholder="Station or facility" /></Field>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="Who pays"><select value={d.funding} onChange={(e) => set("funding", e.target.value as Funding)}>
              {(Object.keys(FUNDING_LABEL) as Funding[]).map((f) => <option key={f} value={f}>{FUNDING_LABEL[f]}</option>)}</select></Field>
            {d.funding === "government" && <Field label="Funding ministry or agency"><input value={d.funding_body} onChange={(e) => set("funding_body", e.target.value)} /></Field>}
            <Field label="Procedure"><select value={d.procedure} onChange={(e) => set("procedure", e.target.value)}>
              <option value="">Select a procedure</option>{procedures.map((p) => <option key={p} value={p}>{p}</option>)}<option value="__other">Other</option></select></Field>
            {d.procedure === "__other" && <Field label="Procedure (other)"><input value={d.procedure_other} onChange={(e) => set("procedure_other", e.target.value)} /></Field>}
            <Field label="Country"><select value={d.country} onChange={(e) => set("country", e.target.value)}>
              <option value="">Select a country</option>{countries.map((p) => <option key={p} value={p}>{p}</option>)}<option value="__other">Other</option></select></Field>
            {d.country === "__other" && <Field label="Country (other)"><input value={d.country_other} onChange={(e) => set("country_other", e.target.value)} /></Field>}
            <Field label="Receiving doctor"><input value={d.receiving_doctor} onChange={(e) => set("receiving_doctor", e.target.value)} placeholder="As on the acceptance letter" /></Field>
            <Field label="Receiving centre"><input value={d.receiving_centre} onChange={(e) => set("receiving_centre", e.target.value)} /></Field>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 16, height: 16 }} checked={d.earlier_referral} onChange={(e) => set("earlier_referral", e.target.checked)} />Referred abroad before</label>
          </div>
        )}
      </div>

      <section className="panel stack" style={{ gap: 10 }} aria-labelledby="docs-h">
        <h2 id="docs-h" className="h2">Documents handed in</h2>
        {docs.map((x, i) => (
          <div key={x.key} className="stack" style={{ gap: 8, padding: "10px 0", borderTop: i ? "1px solid #F1F1F3" : undefined }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="row" style={{ gap: 8 }}><span style={{ fontWeight: 500 }}>{x.name}</span>{x.tag && <span className="pill p-grey">{x.tag}</span>}</span>
              <span className="row" style={{ gap: 4 }} role="group" aria-label={`Receipt of ${x.name}`}>
                {(["received", "not_brought", ...(x.can_na ? ["not_applicable"] : [])] as Doc["status"][]).map((s) => (
                  <button key={s} className={cls("btn sm", x.status === s && "sel")} aria-pressed={x.status === s} onClick={() => updDoc(i, { status: s })}>
                    {s === "received" ? "Received" : s === "not_brought" ? "Not brought" : "Not applicable"}</button>
                ))}
                {x.custom && <button className="btn sm ghost" onClick={() => setDocs((y) => y.filter((_, k) => k !== i))}>Remove</button>}
              </span>
            </div>
            {x.status === "not_brought" && (
              <Field label="Reason not brought" style={{ maxWidth: 420 }}><input value={x.reason} onChange={(e) => updDoc(i, { reason: e.target.value })} placeholder="e.g. to be presented at the sitting" /></Field>
            )}
          </div>
        ))}
        <div className="row" style={{ alignItems: "flex-end", gap: 8, borderTop: "1px solid #F1F1F3", paddingTop: 12 }}>
          <Field label="Add a document this case needs" style={{ flex: "1 1 220px" }}>
            <input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="e.g. Letter from the employer" /></Field>
          <Field label="Applies to" style={{ flex: "1 1 190px" }}>
            <select value={custom.scope} onChange={(e) => setCustom({ ...custom, scope: e.target.value as Cadre | "case" })}>
              <option value="case">This case only</option>
              {d.type === "retirement" && (Object.keys(CADRE_LABEL) as Cadre[]).map((c) => <option key={c} value={c}>{CADRE_LABEL[c]}</option>)}
            </select></Field>
          <button className="btn" onClick={addCustom}>Add document</button>
        </div>
      </section>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row">
        <button className="btn primary" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create case and start scanning"}</button>
        <button className="btn" onClick={() => { setD(EMPTY); setDocs([]); setErr(""); }}>Clear form</button>
      </div>
    </div>
  );
}
