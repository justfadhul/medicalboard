import { requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { RulebookView } from "./RulebookView";

export default async function Rulebook() {
  await requireRole("secretariat");
  const sb = await supabaseServer();
  const [r, m] = await Promise.all([sb.from("rules").select("*").order("id"), sb.from("cadre_docs").select("id,name,scope,created_at").order("created_at")]);
  return <RulebookView rules={(r.data ?? []) as never} maps={(m.data ?? []) as never} />;
}
