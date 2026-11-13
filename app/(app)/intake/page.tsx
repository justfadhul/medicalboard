import Link from "next/link";
import { daysIn, daysLabel, daysTone } from "@/lib/domain";
import { requireRole } from "@/lib/data";
import { stageThresholds } from "@/lib/cases";
import { typeLabel } from "@/lib/labels";
import { supabaseServer } from "@/lib/supabase/server";
import { PageHead, Pill, Table } from "@/components/ui";

const COLS = "minmax(200px,2fr) minmax(120px,1fr) minmax(220px,2fr) 130px";
export default async function Intake() {
  await requireRole("registry");
  const sb = await supabaseServer();
  const [{ data }, th] = await Promise.all([
    sb.from("cases").select("id,case_no,name,type,stage_entered_at,case_documents(status,document_pages(count))").eq("stage", "intake").order("stage_entered_at"),
    stageThresholds(),
  ]);
  type R = { id: string; case_no: string; name: string; type: "retirement" | "referral"; stage_entered_at: string;
    case_documents: { status: string; document_pages: { count: number }[] }[] };
  const rows = (data ?? []) as R[];
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Intake" sub="Cases being received. Confirm each document, scan it here, then send the case to the Secretariat."
        actions={<Link className="btn primary" href="/cases/new">New case</Link>} />
      <Table cols={COLS} head={["Case", "Type", "Documents", "In stage"]} empty={!rows.length && "No cases in intake."}>
        {rows.map((r) => {
          const rec = r.case_documents.filter((d) => d.status === "received");
          const scanned = rec.filter((d) => (d.document_pages[0]?.count ?? 0) > 0).length;
          const missing = r.case_documents.filter((d) => d.status === "not_brought").length;
          const days = daysIn(r.stage_entered_at);
          return (
            <Link key={r.id} href={`/cases/${r.id}`} className="tr" style={{ gridTemplateColumns: COLS, textDecoration: "none" }}>
              <span className="stack"><span style={{ fontWeight: 600 }}>{r.name}</span><span className="muted t12">{r.case_no}</span></span>
              <span>{typeLabel(r.type)}</span>
              <span className="row" style={{ gap: 6 }}>
                <Pill tone={scanned === rec.length ? "green" : "blue"}>{scanned} of {rec.length} scanned</Pill>
                {missing > 0 && <Pill tone="amber">{missing} not brought</Pill>}
              </span>
              <Pill tone={daysTone(days, th.amber, th.red)}>{daysLabel(days)}</Pill>
            </Link>
          );
        })}
      </Table>
    </div>
  );
}
