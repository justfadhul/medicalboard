import { requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { FollowupsView } from "./FollowupsView";

export default async function Followups() {
  await requireRole("secretariat");
  const sb = await supabaseServer();
  const [held, returned] = await Promise.all([
    sb.from("cases").select("id,case_no,name,type,hold_reason,stage_entered_at").eq("hold", true).order("stage_entered_at"),
    sb.from("cases").select("id,case_no,name,country,procedure,stage,returned_on,report_due,report_received_at").eq("type", "referral").eq("decision", "approved").in("stage", ["collected", "closed"]).is("report_received_at", null).order("report_due", { nullsFirst: false }),
  ]);
  return <FollowupsView held={(held.data ?? []) as never} reports={(returned.data ?? []) as never} />;
}
