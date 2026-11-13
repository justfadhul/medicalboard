import { guard } from "@/lib/api";

const csv = (v: unknown) => { const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function GET() {
  const g = await guard("admin");
  if ("error" in g) return g.error;
  const rows: string[] = ["id,created_at,case_no,actor,action,summary,reverses,detail"];
  for (let from = 0; ; from += 1000) {
    const { data } = await g.sb.from("audit_log").select("id,created_at,actor_label,action,summary,reverses,detail,case:cases(case_no)").order("id").range(from, from + 999);
    for (const r of data ?? []) rows.push([r.id, r.created_at, (r.case as unknown as { case_no: string } | null)?.case_no, r.actor_label, r.action, r.summary, r.reverses, r.detail].map(csv).join(","));
    if (!data || data.length < 1000) break;
  }
  return new Response(rows.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="umb-audit-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
}
