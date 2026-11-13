import { requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { NewCaseForm } from "./NewCaseForm";

export default async function NewCase() {
  await requireRole("registry");
  const sb = await supabaseServer();
  const [e, p, c] = await Promise.all([
    sb.from("employers").select("id,name,cadre").eq("active", true).order("sort"),
    sb.from("procedures").select("name").eq("active", true).order("sort"),
    sb.from("countries").select("name").eq("active", true).order("sort"),
  ]);
  return <NewCaseForm employers={e.data ?? []} procedures={(p.data ?? []).map((x) => x.name)} countries={(c.data ?? []).map((x) => x.name)} />;
}
