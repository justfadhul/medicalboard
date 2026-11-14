import { requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { UsersView } from "./UsersView";

export default async function Users() {
  const me = await requireRole("admin");
  const { data } = await (await supabaseServer()).from("profiles").select("id,email,full_name,role,active,created_at,password_set").order("created_at");
  return <UsersView users={(data ?? []) as never} me={me.id} />;
}
