import Link from "next/link";
import { daysIn, daysLabel, daysTone } from "@/lib/domain";
import { requireRole } from "@/lib/data";
import { stageThresholds } from "@/lib/cases";
import { payerLabel, typeLabel } from "@/lib/labels";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHead, Pill, Table } from "@/components/ui";

const COLS = "minmax(190px,1.6fr) minmax(150px,1.2fr) minmax(240px,2.4fr) 120px 130px";
export default async function ReviewQueue() {
  await requireRole("secretariat");
  const sb = await supabaseServer();
  const [{ data }, th] = await Promise.all([
    sb.from("cases").select("id,case_no,name,type,funding,hold,hold_reason,stage_entered_at,employer:employers(name)").eq("stage", "review").order("stage_entered_at"),
    stageThresholds(),
  ]);
  const rows = (data ?? []) as unknown as { id: string; case_no: string; name: string; type: "retirement" | "referral"; funding: null; hold: boolean; hold_reason: string | null; stage_entered_at: string; employer: { name: string } | null }[];
  const crit = await Promise.all(rows.map((r) => sb.rpc("case_criteria", { p_case: r.id }).then((x) => (x.data ?? []) as { label: string; ok: boolean; note: string }[])));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Review queue" sub="Cases sent by the Registry. Check the scans, confirm the fields and clear the flags; when every criterion is met, mark the case ready for the Board." />
      <Table cols={COLS} head={["Case", "Employer or funding", "Next thing to clear", "Criteria", "In stage"]} empty={!rows.length && "Nothing waiting for review."} minWidth={820}>
        {rows.map((r, i) => {
          const c = crit[i]!; const bad = c.filter((k) => !k.ok); const d = daysIn(r.stage_entered_at);
          return (
            <Link key={r.id} href={`/cases/${r.id}?tab=review`} className="tr" style={{ gridTemplateColumns: COLS, textDecoration: "none" }}>
              <span className="stack"><span style={{ fontWeight: 600 }}>{r.name}</span><span className="muted t12">{r.case_no} · {typeLabel(r.type)}</span></span>
              <span>{payerLabel(r)}</span>
              <span className="t12">{r.hold ? `On hold: ${r.hold_reason}` : bad[0] ? `${bad[0].label}: ${bad[0].note}` : "All clear: mark ready for the Board"}</span>
              <Pill tone={bad.length ? (r.hold ? "red" : "amber") : "purple"}>{c.length - bad.length} of {c.length} met</Pill>
              <Pill tone={daysTone(d, th.amber, th.red)}>{daysLabel(d)}</Pill>
            </Link>
          );
        })}
      </Table>
    </div>
  );
}
