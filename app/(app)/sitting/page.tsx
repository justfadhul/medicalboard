import { requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { SittingView } from "./SittingView";

export default async function Sitting({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireRole("secretariat");
  const { id } = await searchParams;
  const sb = await supabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const { data: all } = await sb.from("sittings").select("*").order("sitting_date");
  const sittings = all ?? [];
  // Default: the earliest sitting with undecided cases on its agenda, else the next one.
  const { data: pendingCase } = await sb.from("cases").select("sitting_id, sitting:sittings(sitting_date)").eq("stage", "ready").order("sitting_id").limit(50);
  const pendingIds = new Set((pendingCase ?? []).map((x) => x.sitting_id));
  const s = sittings.find((x) => x.id === id) ?? sittings.find((x) => pendingIds.has(x.id)) ?? sittings.find((x) => x.sitting_date >= today) ?? sittings.at(-1);
  if (!s) return <p className="muted">No sittings scheduled.</p>;
  const [{ data: cases }, { data: atRisk }] = await Promise.all([
    sb.from("cases").select("id,case_no,name,type,funding,stage,decision,minute_no,agenda_serial,employer:employers(name)").eq("sitting_id", s.id).order("agenda_serial"),
    sb.from("cases").select("id", { count: "exact" }).in("stage", ["intake", "review"]),
  ]);
  return <SittingView sitting={s} sittings={sittings.filter((x) => x.sitting_date >= today || pendingIds.has(x.id) || x.id === s.id).slice(0, 8)} cases={(cases ?? []) as never} atRisk={atRisk?.length ?? 0} />;
}
