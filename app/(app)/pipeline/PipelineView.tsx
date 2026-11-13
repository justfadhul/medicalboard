"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { STAGES, daysIn, daysLabel, daysTone, initials, shortDate, type Stage } from "@/lib/domain";
import { payerLabel, typeLabel } from "@/lib/labels";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cls } from "@/lib/util";
import { Avatar, PageHead, Pill, Table } from "@/components/ui";
import { useToast } from "@/components/Toast";
import type { CaseRow } from "@/lib/cases";

type Filters = { type?: string; stage?: string; cadre?: string; stuck?: boolean; hold?: boolean; q?: string; showClosed?: boolean };
const BUILTIN: { key: string; label: string; f: Filters }[] = [
  { key: "all", label: "All", f: {} },
  { key: "police", label: "Retirement · police", f: { type: "retirement", cadre: "police" } },
  { key: "referral", label: "Referral abroad", f: { type: "referral" } },
  { key: "stuck", label: "Stuck over 7 days", f: { stuck: true } },
  { key: "hold", label: "On hold", f: { hold: true } },
];

export function PipelineView({ cases, th, saved }: { cases: CaseRow[]; th: { amber: number; red: number }; saved: { id: string; name: string; filters: Filters }[] }) {
  const [view, setView] = useState("all");
  const [f, setF] = useState<Filters>({});
  const [mode, setMode] = useState<"board" | "table">("board");
  const router = useRouter();
  const { toast } = useToast();

  const rows = useMemo(() => cases.filter((c) => {
    const d = daysIn(c.stage_entered_at);
    if (!f.showClosed && c.stage === "closed" && !f.stage) return false;
    if (f.type && c.type !== f.type) return false;
    if (f.stage && c.stage !== f.stage) return false;
    if (f.cadre && c.employer?.cadre !== f.cadre) return false;
    if (f.stuck && (d <= 7 || c.stage === "closed")) return false;
    if (f.hold && !c.hold) return false;
    if (f.q) { const q = f.q.toLowerCase(); if (!c.name.toLowerCase().includes(q) && !c.case_no.toLowerCase().includes(q)) return false; }
    return true;
  }), [cases, f]);

  const open = cases.filter((c) => c.stage !== "closed");
  const stats = [
    { label: "Open cases", value: open.length, note: `${open.filter((c) => c.type === "retirement").length} retirement · ${open.filter((c) => c.type === "referral").length} referral` },
    { label: "In review", value: open.filter((c) => c.stage === "review").length, note: `${open.filter((c) => c.hold).length} on hold` },
    { label: "Ready for the Board", value: open.filter((c) => c.stage === "ready").length, note: "On the next agenda" },
    { label: "Stuck over 7 days", value: open.filter((c) => daysIn(c.stage_entered_at) > 7).length, note: "Across all stages" },
  ];

  const pick = (key: string, filters: Filters) => { setView(key); setF(filters); };
  async function saveView() {
    const name = window.prompt("Name this view");
    if (!name) return;
    const { error } = await supabaseBrowser().from("saved_views").insert({ name, filters: f });
    if (error) toast(error.message, { tone: "error" }); else { toast("View saved"); router.refresh(); }
  }
  async function deleteView(id: string) {
    await supabaseBrowser().from("saved_views").delete().eq("id", id);
    pick("all", {}); router.refresh();
  }

  const card = (c: CaseRow) => {
    const d = daysIn(c.stage_entered_at);
    return (
      <Link key={c.id} href={`/cases/${c.id}`} className="kcard" style={{ textDecoration: "none" }}>
        <div className="stack" style={{ gap: 1 }}>
          <span style={{ fontWeight: 600 }}>{c.name}</span>
          <span className="muted t12">{c.case_no} · {typeLabel(c.type)}</span>
        </div>
        <span className="t12">{c.stage === "ready" && c.sitting ? `Sitting ${shortDate(c.sitting.sitting_date)} · S/N ${c.agenda_serial}` : payerLabel(c)}</span>
        <div className="row" style={{ gap: 6 }}>
          <Avatar ini={initials(c.name)} />
          <Pill tone={daysTone(d, th.amber, th.red)}>{daysLabel(d)}</Pill>
          {c.hold && <Pill tone="red" style={{ marginLeft: "auto" }}>On hold</Pill>}
        </div>
      </Link>
    );
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Pipeline" sub="Every case by stage. Each column shows who acts next."
        actions={<div role="group" aria-label="Layout" className="row" style={{ gap: 4 }}>
          <button className={cls("btn sm", mode === "board" && "sel")} aria-pressed={mode === "board"} onClick={() => setMode("board")}>Board</button>
          <button className={cls("btn sm", mode === "table" && "sel")} aria-pressed={mode === "table"} onClick={() => setMode("table")}>Table</button>
        </div>} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {stats.map((s) => (
          <div key={s.label} className="stat">
            <span className="label">{s.label}</span>
            <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>{s.value}</span>
            <span className="muted t12">{s.note}</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }} role="group" aria-label="Saved views">
        <span className="label" style={{ marginRight: 4 }}>Views</span>
        {BUILTIN.map((v) => <button key={v.key} className={cls("btn sm", view === v.key && "sel")} aria-pressed={view === v.key} onClick={() => pick(v.key, v.f)}>{v.label}</button>)}
        {saved.map((v) => (
          <span key={v.id} className="row" style={{ gap: 2 }}>
            <button className={cls("btn sm", view === v.id && "sel")} aria-pressed={view === v.id} onClick={() => pick(v.id, v.filters)}>{v.name}</button>
            {view === v.id && <button className="btn sm ghost" aria-label={`Delete view ${v.name}`} onClick={() => deleteView(v.id)}>×</button>}
          </span>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input type="search" placeholder="Filter by name or case number" aria-label="Filter cases" value={f.q ?? ""} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ maxWidth: 260 }} />
        <select aria-label="Case type" value={f.type ?? ""} onChange={(e) => setF({ ...f, type: e.target.value || undefined })} style={{ maxWidth: 170 }}>
          <option value="">All types</option><option value="retirement">Retirement</option><option value="referral">Referral abroad</option>
        </select>
        <select aria-label="Stage" value={f.stage ?? ""} onChange={(e) => setF({ ...f, stage: e.target.value || undefined })} style={{ maxWidth: 170 }}>
          <option value="">All stages</option>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <label className="row t12" style={{ gap: 6 }}><input type="checkbox" style={{ width: 16, height: 16 }} checked={!!f.showClosed} onChange={(e) => setF({ ...f, showClosed: e.target.checked })} />Show closed</label>
        <button className="btn sm" onClick={saveView}>Save as view</button>
      </div>
      {mode === "board" ? (
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, alignItems: "flex-start" }}>
          {STAGES.filter((s) => s.key !== "closed" || f.showClosed || f.stage === "closed").map((s) => {
            const list = rows.filter((c) => c.stage === s.key);
            return (
              <section key={s.key} className="kcol" aria-label={`${s.label}: ${list.length} cases`}>
                <div className="row" style={{ gap: 8, padding: "2px 4px", flexWrap: "nowrap" }}>
                  <Pill tone={s.tone}>{s.label}</Pill>
                  <span className="muted t12">{list.length}</span>
                  <span className="muted t12" style={{ marginLeft: "auto" }}>{s.owner}</span>
                </div>
                {list.map(card)}
                {!list.length && <p className="muted t12" style={{ padding: "8px 6px" }}>No cases</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <Table cols="minmax(200px,2fr) minmax(120px,1fr) minmax(160px,1.4fr) 140px 130px" head={["Case", "Type", "Employer or funding", "Stage", "In stage"]} empty={!rows.length && "No cases match."}>
          {rows.map((c) => {
            const d = daysIn(c.stage_entered_at); const m = STAGES.find((s) => s.key === c.stage)!;
            return (
              <Link key={c.id} href={`/cases/${c.id}`} className="tr" style={{ gridTemplateColumns: "minmax(200px,2fr) minmax(120px,1fr) minmax(160px,1.4fr) 140px 130px", textDecoration: "none" }}>
                <span className="stack"><span style={{ fontWeight: 600 }}>{c.name}</span><span className="muted t12">{c.case_no}</span></span>
                <span>{typeLabel(c.type)}</span><span>{payerLabel(c)}</span>
                <span className="row" style={{ gap: 4 }}><Pill tone={m.tone}>{m.label}</Pill>{c.hold && <Pill tone="red">Hold</Pill>}</span>
                <Pill tone={daysTone(d, th.amber, th.red)}>{daysLabel(d)}</Pill>
              </Link>
            );
          })}
        </Table>
      )}
    </div>
  );
}
