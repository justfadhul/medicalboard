"use client";
import { useRouter } from "next/navigation";
import { initials, ROLE_LABEL, shortDate, type Role } from "@/lib/domain";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Avatar, PageHead, Pill, Table } from "@/components/ui";

type Row = { id: string; body: string; created_at: string; tag_role: Role | null; case_id: string;
  author: { full_name: string; email: string; role: Role } | null; case: { name: string; case_no: string } | null; mention_reads: { user_id: string }[] };
const COLS = "30px minmax(220px,3fr) minmax(160px,1fr) 80px";

export function MentionsView({ rows, me }: { rows: Row[]; me: string }) {
  const router = useRouter();
  async function open(r: Row) {
    if (!r.mention_reads.some((x) => x.user_id === me)) await supabaseBrowser().from("mention_reads").insert({ note_id: r.id, user_id: me });
    router.push(`/cases/${r.case_id}?tab=activity`);
  }
  async function markAll() {
    const unread = rows.filter((r) => !r.mention_reads.some((x) => x.user_id === me));
    if (unread.length) await supabaseBrowser().from("mention_reads").insert(unread.map((r) => ({ note_id: r.id, user_id: me })));
    router.refresh();
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Mentions" sub="Notes where a colleague tagged you or your role. Open one to go to the case." actions={<button className="btn sm" onClick={markAll}>Mark all read</button>} />
      <Table cols={COLS} head={["", "Note", "Case", ""]} empty={!rows.length && "No mentions yet. Notes tagged for your role appear here."}>
        {rows.map((r) => {
          const unread = !r.mention_reads.some((x) => x.user_id === me);
          const who = r.author?.full_name || r.author?.email || "System";
          return (
            <button key={r.id} className="tr" style={{ gridTemplateColumns: COLS, background: unread ? "#F4F8FF" : undefined }} onClick={() => open(r)}>
              <Avatar ini={initials(who)} />
              <span className="stack">
                <span className="muted t12">{who} · {shortDate(r.created_at)}{r.tag_role ? ` · for ${ROLE_LABEL[r.tag_role]}` : ""}</span>
                <span style={{ fontWeight: unread ? 600 : 400 }}>{r.body}</span>
              </span>
              <span className="t12">{r.case?.name} · {r.case?.case_no}</span>
              {unread ? <Pill tone="blue">Unread</Pill> : <span />}
            </button>
          );
        })}
      </Table>
    </div>
  );
}
