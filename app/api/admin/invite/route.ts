import { NextResponse } from "next/server";
import { guard } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ROLES = ["registry", "secretariat", "commissioner", "admin"];
// Admin adds a user and assigns the role (stored in profiles.role, never in user-editable metadata). No email is sent:
// the person creates their password on the login page ("First time? Create your password").
export async function POST(req: Request) {
  const g = await guard("admin");
  if ("error" in g) return g.error;
  const { email, name, role } = await req.json();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? "") || !ROLES.includes(role)) return NextResponse.json({ error: "Enter a valid email and role" }, { status: 400 });
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email: email.trim().toLowerCase(), email_confirm: true, user_metadata: { full_name: name ?? "" } });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await admin.from("profiles").upsert({ id: data.user.id, email: data.user.email, full_name: name ?? "" }, { onConflict: "id" });
  const { error: e2 } = await g.sb.rpc("set_user_role", { p_user: data.user.id, p_role: role, p_active: true, p_name: name ?? null });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
