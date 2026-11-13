import { Shell } from "@/components/Shell";
import { getMe, nextSitting } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const sb = await supabaseServer();
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const c = (stage: string | string[]) => {
    const q = sb.from("cases").select("id", { count: "exact", head: true });
    return count(Array.isArray(stage) ? q.in("stage", stage) : q.eq("stage", stage));
  };
  let mq = sb.from("notes").select("id, mention_reads(user_id)", { count: "exact" }).neq("created_by", me.id).limit(200);
  mq = me.role === "admin" ? mq.or(`tag_user.eq.${me.id},tag_role.not.is.null`) : mq.or(`tag_user.eq.${me.id},tag_role.eq.${me.role}`);
  const [all, intake, collection, review, sitting, drafting, signatures, held, reports, notes, next] = await Promise.all([
    count(sb.from("cases").select("id", { count: "exact", head: true }).neq("stage", "closed")),
    c("intake"), c(["signed", "collected"]), c("review"), c("ready"), c("decided"),
    count(sb.from("letters").select("id", { count: "exact", head: true }).eq("status", "awaiting")),
    count(sb.from("cases").select("id", { count: "exact", head: true }).eq("hold", true)),
    count(sb.from("cases").select("id", { count: "exact", head: true }).not("report_due", "is", null).is("report_received_at", null)),
    mq, nextSitting(),
  ]);
  const unread = ((notes.data ?? []) as { mention_reads: { user_id: string }[] }[]).filter((n) => !n.mention_reads.some((r) => r.user_id === me.id)).length;
  return (
    <Shell me={me} sitting={next} counts={{ all, intake, collection, review, sitting, drafting, signatures, followups: held + reports, mentions: unread }}>
      {children}
    </Shell>
  );
}
