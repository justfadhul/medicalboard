import { requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { ListsView } from "./ListsView";

export default async function Lists() {
  await requireRole("admin");
  const sb = await supabaseServer();
  const [e, p, c, t] = await Promise.all([
    sb.from("employers").select("*").order("sort"), sb.from("procedures").select("*").order("sort"), sb.from("countries").select("*").order("sort"),
    sb.storage.from("templates").list("", { limit: 100 }),
  ]);
  return <ListsView employers={(e.data ?? []) as never} procedures={(p.data ?? []) as never} countries={(c.data ?? []) as never} templates={(t.data ?? []).map((f) => ({ name: f.name, updated: f.updated_at ?? "" }))} />;
}
