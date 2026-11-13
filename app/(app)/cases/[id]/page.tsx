import { notFound } from "next/navigation";
import { getMe, getSettings } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { officersFrom } from "@/lib/letters/content";
import type { CaseBundle } from "@/lib/types";
import { CaseView } from "./CaseView";

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params; const { tab } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const me = await getMe();
  const sb = await supabaseServer();
  const [c, docs, fields, flags, findings, letters, notes, audit, crit, users, rules, settings] = await Promise.all([
    sb.from("cases").select("*, employer:employers(name,cadre), sitting:sittings(id,sitting_date,venue,held), collections(collector_name,relationship,collected_at,reversed)").eq("id", id).maybeSingle(),
    sb.from("case_documents").select("*, document_pages(id,path,page_no,rotation,width,height,quality,keep_reason)").eq("case_id", id).order("sort").order("created_at"),
    sb.from("case_fields").select("*").eq("case_id", id).order("created_at"),
    sb.from("flags").select("id,code,text,resolved").eq("case_id", id).order("created_at"),
    sb.from("findings").select("*, author:profiles!findings_created_by_fkey(full_name,email)").eq("case_id", id).order("created_at"),
    sb.from("letters").select("*").eq("case_id", id).order("sort"),
    sb.from("notes").select("id,body,tag_role,tag_user,created_at, author:profiles!notes_created_by_fkey(full_name,email,role)").eq("case_id", id).order("created_at", { ascending: false }),
    sb.from("audit_log").select("id,actor_label,action,summary,created_at,reverses").eq("case_id", id).order("created_at", { ascending: false }).limit(300),
    sb.rpc("case_criteria", { p_case: id }),
    sb.from("profiles").select("id,full_name,email,role").eq("active", true).not("role", "is", null).order("full_name"),
    sb.from("rules").select("id,status"),
    getSettings(),
  ]);
  if (!c.data) notFound();
  for (const d of docs.data ?? []) d.document_pages.sort((a: { page_no: number }, b: { page_no: number }) => a.page_no - b.page_no);
  const bundle: CaseBundle = {
    c: c.data as never, docs: (docs.data ?? []) as never, fields: (fields.data ?? []) as never, flags: (flags.data ?? []) as never,
    findings: (findings.data ?? []) as never, letters: (letters.data ?? []) as never, notes: (notes.data ?? []) as never, audit: (audit.data ?? []) as never,
    criteria: (crit.data ?? []) as never, users: (users.data ?? []) as never, rules: Object.fromEntries((rules.data ?? []).map((r) => [r.id, r.status])),
    aiEnabled: process.env.AI_READING_ENABLED === "true",
  };
  return <CaseView b={bundle} me={me} initialTab={tab} officers={officersFrom(settings)} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
    th={{ amber: Number(settings.stage_amber_days?.value ?? 7), red: Number(settings.stage_red_days?.value ?? 14) }} />;
}
