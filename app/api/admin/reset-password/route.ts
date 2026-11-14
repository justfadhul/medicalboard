import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { guard } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Admin resets a forgotten password: the old one stops working and the user creates a new one on the login page.
export async function POST(req: Request) {
  const g = await guard("admin");
  if ("error" in g) return g.error;
  const { userId } = await req.json();
  const admin = supabaseAdmin();
  const { data: p } = await admin.from("profiles").select("id,email").eq("id", userId).maybeSingle();
  if (!p) return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  const { error } = await admin.auth.admin.updateUserById(p.id, { password: randomBytes(24).toString("base64url") });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await admin.from("profiles").update({ password_set: false, password_set_at: null }).eq("id", p.id);
  const { data: me } = await g.sb.from("profiles").select("email").eq("id", g.user.id).single();
  await admin.from("audit_log").insert({ actor: g.user.id, actor_label: `${me?.email ?? "admin"} (admin)`, action: "password_reset", summary: `Password reset for ${p.email}` });
  return NextResponse.json({ ok: true });
}
