import { getMe } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { MentionsView } from "./MentionsView";

export default async function Mentions() {
  const me = await getMe();
  const sb = await supabaseServer();
  let q = sb.from("notes").select("id,body,created_at,tag_role,case_id,author:profiles!notes_created_by_fkey(full_name,email,role),case:cases(name,case_no),mention_reads(user_id)")
    .order("created_at", { ascending: false }).limit(100);
  q = me.role === "admin" ? q.or(`tag_user.eq.${me.id},tag_role.not.is.null`) : q.or(`tag_user.eq.${me.id},tag_role.eq.${me.role}`);
  const { data } = await q;
  return <MentionsView me={me.id} rows={(data ?? []) as never} />;
}
