import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { CaseType, Funding, Stage } from "@/lib/domain";

export type CaseRow = {
  id: string; case_no: string; name: string; type: CaseType; stage: Stage; stage_entered_at: string; hold: boolean; hold_reason: string | null;
  funding: Funding | null; procedure: string | null; country: string | null; employer: { name: string; cadre: string | null } | null;
  sitting: { sitting_date: string } | null; decision: string | null; minute_no: string | null; agenda_serial: number | null;
  created_at: string; returned_on: string | null; report_due: string | null; report_received_at: string | null; receiving_doctor: string | null;
};
export const CASE_COLS = "id,case_no,name,type,stage,stage_entered_at,hold,hold_reason,funding,procedure,country,decision,minute_no,agenda_serial,created_at,returned_on,report_due,report_received_at,receiving_doctor,employer:employers(name,cadre),sitting:sittings(sitting_date)";

export async function listCases(filter?: (q: any) => any): Promise<CaseRow[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const sb = await supabaseServer();
  let q = sb.from("cases").select(CASE_COLS).order("stage_entered_at");
  if (filter) q = filter(q);
  const { data, error } = await q;
  if (error) throw error;
  return data as unknown as CaseRow[];
}

export async function stageThresholds() {
  const sb = await supabaseServer();
  const { data } = await sb.from("settings").select("key,value").in("key", ["stage_amber_days", "stage_red_days", "receipt_overdue_days"]);
  const m = Object.fromEntries((data ?? []).map((s) => [s.key, Number(s.value)]));
  return { amber: m.stage_amber_days ?? 7, red: m.stage_red_days ?? 14, overdue: m.receipt_overdue_days ?? 7 };
}
