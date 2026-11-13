import { getSettings, requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { CollectionView } from "./CollectionView";

export default async function Collection() {
  await requireRole("registry");
  const sb = await supabaseServer();
  const [ready, out, settings] = await Promise.all([
    sb.from("cases").select("id,case_no,name,type,sms_consent,phone,letters(id,title,addressee)").eq("stage", "signed").order("stage_entered_at"),
    sb.from("letters").select("id,title,addressee,verify_code,receipt_confirmed,receipt_method,receipt_by,receipt_at,last_reminder_at,office_contact,case_id,case:cases!inner(id,name,case_no,stage,stage_entered_at,collections(collector_name,relationship,collected_at,reversed))")
      .eq("receipt_needed", true).eq("case.stage", "collected").order("case_id"),
    getSettings(),
  ]);
  return <CollectionView ready={(ready.data ?? []) as never} out={(out.data ?? []) as never} overdueDays={Number(settings.receipt_overdue_days?.value ?? 7)} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} />;
}
