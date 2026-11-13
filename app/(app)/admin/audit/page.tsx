import Link from "next/link";
import { requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHead, Table } from "@/components/ui";

const COLS = "170px minmax(160px,1fr) minmax(130px,0.8fr) minmax(280px,2.4fr)";
export default async function Audit() {
  await requireRole("admin");
  const { data } = await (await supabaseServer()).from("audit_log").select("id,created_at,actor_label,action,summary,case_id,case:cases(case_no)").order("id", { ascending: false }).limit(300);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Audit log" sub="Append-only record of every action. Nothing here can be edited or deleted, including undone actions (both entries are kept)."
        actions={<a className="btn primary" href="/api/audit/export">Export full log (CSV)</a>} />
      <Table cols={COLS} head={["When", "Who", "Case", "What"]} minWidth={820}>
        {(data ?? []).map((r) => (
          <div key={r.id} className="tr" style={{ gridTemplateColumns: COLS }} role="row">
            <span className="t12">{new Date(r.created_at).toLocaleString("en-GB")}</span>
            <span className="t12">{r.actor_label}</span>
            <span className="t12">{r.case_id ? <Link href={`/cases/${r.case_id}?tab=activity`}>{(r.case as unknown as { case_no: string } | null)?.case_no}</Link> : "—"}</span>
            <span>{r.summary}</span>
          </div>
        ))}
      </Table>
    </div>
  );
}
