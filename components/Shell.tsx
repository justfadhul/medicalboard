"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ROLE_LABEL, initials, longDate, stageMeta, type Role, type Stage } from "@/lib/domain";
import { cls } from "@/lib/util";
import { ToastProvider } from "./Toast";
import { Avatar, Pill } from "./ui";

export type NavCounts = Partial<Record<string, number>>;
type Item = { href: string; label: string; count?: string; icon?: React.ReactNode };
type Group = { head: string; roles: Role[]; items: Item[] };

const I = {
  pipe: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><rect x="2" y="2.5" width="3.4" height="11" rx="1" /><rect x="6.3" y="2.5" width="3.4" height="7.5" rx="1" /><rect x="10.6" y="2.5" width="3.4" height="5" rx="1" /></svg>,
  at: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><circle cx="8" cy="8" r="2.5" /><path d="M10.5 8v1a1.8 1.8 0 0 0 3.5 0V8a6 6 0 1 0-2.4 4.8" /></svg>,
  doc: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M4 2h5.5L12 4.5V14H4z" /><path d="M9.5 2v2.5H12" /></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M8 3v10M3 8h10" /></svg>,
  box: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M2.5 5.5 8 2.5l5.5 3v6L8 14.5l-5.5-3z" /><path d="M2.5 5.5 8 8.5l5.5-3M8 8.5v6" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M3 8.5 6.5 12 13 4.5" /></svg>,
  cal: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>,
  pen: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M10.5 2.5 13.5 5.5 6 13H3v-3z" /></svg>,
  sign: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M2 12.5c2-3 3.5-6 5-6s-1 5 1 5 2.5-3 4-3 1 2 2 2" /></svg>,
  clock: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg>,
  book: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M3 3h4a1.5 1.5 0 0 1 1.5 1.5V13A1.5 1.5 0 0 0 7 11.5H3zM13 3H9.5A1.5 1.5 0 0 0 8 4.5V13a1.5 1.5 0 0 1 1.5-1.5H13z" /></svg>,
  user: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.8-2.5 2.7-3.5 5-3.5s4.2 1 5 3.5" /></svg>,
  gear: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></svg>,
  list: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5" /></svg>,
};

function groups(c: NavCounts): Group[] {
  const n = (k: string) => (c[k] ? String(c[k]) : "");
  return [
    { head: "Overview", roles: ["registry", "secretariat", "commissioner", "admin"], items: [
      { href: "/pipeline", label: "Pipeline", count: n("all"), icon: I.pipe },
      { href: "/mentions", label: "Mentions", count: n("mentions"), icon: I.at },
    ] },
    { head: "Registry workspace", roles: ["registry", "admin"], items: [
      { href: "/intake", label: "Intake", count: n("intake"), icon: I.doc },
      { href: "/cases/new", label: "New case", icon: I.plus },
      { href: "/collection", label: "Collection and receipts", count: n("collection"), icon: I.box },
    ] },
    { head: "Secretariat workspace", roles: ["secretariat", "admin"], items: [
      { href: "/review", label: "Review queue", count: n("review"), icon: I.check },
      { href: "/sitting", label: "Board sitting", count: n("sitting"), icon: I.cal },
      { href: "/drafting", label: "Drafting", count: n("drafting"), icon: I.pen },
      { href: "/signatures", label: "Out for signature", count: n("signatures"), icon: I.sign },
      { href: "/followups", label: "Follow-ups", count: n("followups"), icon: I.clock },
      { href: "/rulebook", label: "Rulebook", icon: I.book },
    ] },
    { head: "Administration", roles: ["admin"], items: [
      { href: "/admin/users", label: "Users and roles", icon: I.user },
      { href: "/admin/settings", label: "Settings", icon: I.gear },
      { href: "/admin/lists", label: "Lists and templates", icon: I.list },
      { href: "/admin/audit", label: "Audit log", icon: I.book },
    ] },
  ];
}

export function Shell({ me, counts, sitting, children }: {
  me: { id: string; full_name: string; email: string; role: Role };
  counts: NavCounts; sitting: { sitting_date: string; venue: string } | null; children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [jump, setJump] = useState(false);
  const [mentions, setMentions] = useState(counts.mentions ?? 0);

  useEffect(() => setMentions(counts.mentions ?? 0), [counts.mentions]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setJump(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Realtime mentions badge
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel("notes-badge").on("postgres_changes", { event: "INSERT", schema: "public", table: "notes" }, (p) => {
      const n = p.new as { tag_role: Role | null; tag_user: string | null; created_by: string };
      if (n.created_by !== me.id && (n.tag_user === me.id || n.tag_role === me.role || (me.role === "admin" && n.tag_role))) {
        setMentions((x) => x + 1);
        router.refresh();
      }
    }).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [me.id, me.role, router]);

  const all = groups({ ...counts, mentions });
  const title = all.flatMap((g) => g.items).find((i) => path.startsWith(i.href))?.label ?? (path.startsWith("/cases/") ? "Case" : "");

  return (
    <ToastProvider>
      <a href="#main" className="skip">Skip to content</a>
      <div className="app">
        <aside className={cls("side", open && "open")} aria-label="Workspace navigation">
          <div className="row" style={{ gap: 9, padding: "4px 6px", flexWrap: "nowrap" }}>
            <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, background: "#1D1E20", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, flex: "none" }}>UMB</span>
            <div className="stack" style={{ lineHeight: 1.25 }}>
              <span style={{ fontWeight: 600 }}>Uganda Medical Board</span>
              <span className="muted t12">Case system</span>
            </div>
          </div>
          <div className="stack" style={{ gap: 3, padding: "0 4px" }}>
            <span className="label">Working as</span>
            <span style={{ fontWeight: 500 }}>{ROLE_LABEL[me.role]}</span>
          </div>
          {all.filter((g) => g.roles.includes(me.role)).map((g) => (
            <nav key={g.head} className="stack" style={{ gap: 2 }} aria-label={g.head}>
              <span className="navhead">{g.head}</span>
              {g.items.map((it) => {
                const on = path === it.href || (it.href !== "/cases/new" && path.startsWith(it.href + "/"));
                return (
                  <Link key={it.href} href={it.href} className={cls("nav", on && "on")} aria-current={on ? "page" : undefined} style={{ textDecoration: "none" }}>
                    {it.icon}<span>{it.label}</span>{it.count ? <span className="count" aria-label={`${it.count} items`}>{it.count}</span> : null}
                  </Link>
                );
              })}
            </nav>
          ))}
          <div style={{ marginTop: "auto", border: "1px solid #E9E9EC", borderRadius: 10, background: "#fff", padding: 12 }} className="stack">
            <span className="label">Next Board sitting</span>
            <span style={{ fontWeight: 600 }}>{sitting ? longDate(sitting.sitting_date) : "Not scheduled"}</span>
            <span className="muted t12">{sitting ? sitting.venue : ""} · every second Thursday</span>
          </div>
          <form action="/auth/signout" method="post" className="row" style={{ padding: "0 4px", justifyContent: "space-between" }}>
            <span className="muted t12" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{me.email}</span>
            <button className="btn sm ghost">Sign out</button>
          </form>
        </aside>
        {open && <div className="overlay noprint" style={{ zIndex: 55 }} onClick={() => setOpen(false)} aria-hidden />}
        <div className="content">
          <header className="row topbar" style={{ gap: 10, padding: "10px 20px", borderBottom: "1px solid #ECECEE", minHeight: 56, flexWrap: "wrap" }}>
            <button className="btn sm menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation">Menu</button>
            <Avatar ini={initials(me.full_name || me.email)} />
            <span className="muted t12">{me.full_name || ROLE_LABEL[me.role]}</span>
            <span className="muted t12" aria-hidden>/</span>
            <span style={{ fontWeight: 600 }}>{title}</span>
            <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setJump(true)} aria-keyshortcuts="Control+K Meta+K">
              Jump to case <span className="muted t12">Ctrl K</span>
            </button>
          </header>
          <main id="main" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>{children}</main>
        </div>
      </div>
      {jump && <JumpPalette onClose={() => setJump(false)} />}
    </ToastProvider>
  );
}

type Hit = { id: string; case_no: string; name: string; type: string; stage: Stage };
function JumpPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(async () => {
      const s = q.trim().replace(/[%,()]/g, "");
      let query = supabaseBrowser().from("cases").select("id,case_no,name,type,stage").order("updated_at", { ascending: false }).limit(8);
      if (s) query = query.or(`name.ilike.%${s}%,case_no.ilike.%${s}%`);
      const { data } = await query;
      setHits((data as Hit[]) ?? []); setSel(0);
    }, 120);
    return () => clearTimeout(t);
  }, [q]);
  const open = (h: Hit) => { onClose(); router.push(`/cases/${h.id}`); };
  return (
    <div className="overlay" style={{ alignItems: "flex-start", paddingTop: "12vh" }} onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Jump to case" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === "Enter" && hits[sel]) open(hits[sel]!);
        }}>
        <div className="row" style={{ padding: 12, borderBottom: "1px solid #ECECEE", flexWrap: "nowrap" }}>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or case number" aria-label="Find a case"
            role="combobox" aria-expanded aria-controls="jump-list" aria-activedescendant={hits[sel] ? `jump-${hits[sel]!.id}` : undefined} />
          <button className="btn sm ghost" onClick={onClose}>Close</button>
        </div>
        <div id="jump-list" role="listbox" aria-label="Cases">
          {hits.map((h, i) => (
            <button key={h.id} id={`jump-${h.id}`} role="option" aria-selected={i === sel} className="tr" onClick={() => open(h)}
              style={{ gridTemplateColumns: "1fr auto", background: i === sel ? "#F4F8FF" : undefined }}>
              <span className="stack"><span style={{ fontWeight: 600 }}>{h.name}</span><span className="muted t12">{h.case_no} · {h.type === "retirement" ? "Retirement" : "Referral abroad"}</span></span>
              <Pill tone={stageMeta(h.stage).tone}>{stageMeta(h.stage).label}</Pill>
            </button>
          ))}
          {!hits.length && <p className="muted t12" style={{ padding: 14 }}>No matching cases.</p>}
        </div>
      </div>
    </div>
  );
}
