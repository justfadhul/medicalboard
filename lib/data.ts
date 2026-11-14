import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import type { Role } from "@/lib/domain";

export type Me = { id: string; email: string; full_name: string; role: Role };

export async function getMe(): Promise<Me> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: needsMfa } = await sb.rpc("needs_mfa");
  if (needsMfa) redirect("/mfa");
  const { data } = await sb.from("profiles").select("id,email,full_name,role,active").eq("id", user.id).single();
  if (!data?.role || !data.active) redirect("/no-access");
  return data as Me;
}

/** Throws a redirect unless the user holds one of the roles (admin always passes). */
export async function requireRole(...roles: Role[]): Promise<Me> {
  const me = await getMe();
  if (me.role !== "admin" && !roles.includes(me.role)) redirect("/pipeline");
  return me;
}

export async function getSettings(): Promise<Record<string, { value: unknown; label: string; to_confirm: boolean }>> {
  const sb = await supabaseServer();
  const { data } = await sb.from("settings").select("key,value,label,to_confirm");
  return Object.fromEntries((data ?? []).map((s) => [s.key, s]));
}

export async function nextSitting() {
  const sb = await supabaseServer();
  const { data } = await sb.from("sittings").select("*").eq("held", false).gte("sitting_date", new Date().toISOString().slice(0, 10))
    .order("sitting_date").limit(1).maybeSingle();
  return data as { id: string; sitting_date: string; venue: string; cutoff_date: string; held: boolean } | null;
}
