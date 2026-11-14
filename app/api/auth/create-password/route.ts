import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { overLimit } from "@/lib/ratelimit";

const MIN_PASSWORD = 10;
// First-time password: only for an active account an admin has set up, and only while it has no password yet.
export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  const sb = supabaseAdmin();
  if (await overLimit(sb, req, "create-password", 8)) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  if (typeof email !== "string" || typeof password !== "string") return NextResponse.json({ error: "Enter your email and a password" }, { status: 400 });
  if (password.length < MIN_PASSWORD) return NextResponse.json({ error: `Use at least ${MIN_PASSWORD} characters` }, { status: 400 });
  const { data: p } = await sb.from("profiles").select("id,role,active,password_set").eq("email", email.trim().toLowerCase()).maybeSingle();
  // Same message whether or not the account exists, so the form cannot be used to find accounts.
  const refused = NextResponse.json({ error: "This email has no account waiting for a password. If you already created one, sign in; if you forgot it, ask the system administrator to reset it." }, { status: 400 });
  if (!p || !p.role || !p.active || p.password_set) return refused;
  const { error } = await sb.auth.admin.updateUserById(p.id, { password, email_confirm: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await sb.from("profiles").update({ password_set: true, password_set_at: new Date().toISOString() }).eq("id", p.id);
  await sb.from("audit_log").insert({ actor: p.id, actor_label: email.trim().toLowerCase(), action: "password_created", summary: "Password created at first sign-in" });
  return NextResponse.json({ ok: true });
}
