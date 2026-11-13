import { NextResponse } from "next/server";
import { guard } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ROLES = ["registry", "secretariat", "commissioner", "admin"];
// Admin invites a user by email and assigns the role (stored in profiles.role, never in user-editable metadata).
export async function POST(req: Request) {
  const g = await guard("admin");
  if ("error" in g) return g.error;
  const { email, name, role } = await req.json();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? "") || !ROLES.includes(role)) return NextResponse.json({ error: "Enter a valid email and role" }, { status: 400 });
  const admin = supabaseAdmin();
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), { data: { full_name: name ?? "" }, redirectTo: `${origin}/auth/callback` });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await admin.from("profiles").upsert({ id: data.user.id, email: data.user.email, full_name: name ?? "" }, { onConflict: "id" });
  const { error: e2 } = await g.sb.rpc("set_user_role", { p_user: data.user.id, p_role: role, p_active: true, p_name: name ?? null });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
