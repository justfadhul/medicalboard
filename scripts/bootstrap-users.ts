// Idempotently creates (or updates) the system's users and roles from a JSON list.
// The real list lives in scripts/users.local.json (git-ignored: it holds staff emails). See scripts/users.example.json.
// Usage: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run bootstrap:users [-- --invite]
// No email is sent: new users open the login page and choose "First time? Create your password".
//   --invite  (optional) emails Supabase invitations instead.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

type U = { email: string; name?: string; role: "registry" | "secretariat" | "commissioner" | "admin" };
const file = process.env.BOOTSTRAP_USERS_FILE ?? "scripts/users.local.json";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const invite = process.argv.includes("--invite");
if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
if (!fs.existsSync(file)) { console.error(`No ${file}. Copy scripts/users.example.json to it and fill in the users.`); process.exit(1); }
const users: U[] = JSON.parse(fs.readFileSync(file, "utf8"));
const ROLES = ["registry", "secretariat", "commissioner", "admin"];
const sb = createClient(url, key, { auth: { persistSession: false } });

const existing = new Map<string, string>();
for (let page = 1; ; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  data.users.forEach((u) => u.email && existing.set(u.email.toLowerCase(), u.id));
  if (data.users.length < 200) break;
}
for (const u of users) {
  const email = u.email.trim().toLowerCase();
  if (!ROLES.includes(u.role)) throw new Error(`Unknown role for ${email}: ${u.role}`);
  let id = existing.get(email), created = false;
  if (!id) {
    const r = invite
      ? await sb.auth.admin.inviteUserByEmail(email, { data: { full_name: u.name ?? "" }, redirectTo: `${site}/auth/callback` })
      : await sb.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: u.name ?? "" } });
    if (r.error) throw r.error;
    id = r.data.user!.id; created = true;
  }
  const { data: before } = await sb.from("profiles").select("role,full_name,active").eq("id", id).maybeSingle();
  const row = { id, email, role: u.role, active: true, ...(u.name ? { full_name: u.name } : {}) };
  const { error } = await sb.from("profiles").upsert(row, { onConflict: "id" });
  if (error) throw error;
  const changed = created || before?.role !== u.role || !before?.active || (u.name && before?.full_name !== u.name);
  if (changed) await sb.from("audit_log").insert({ actor_label: "bootstrap script", action: "user_role", summary: `Bootstrap: ${email} set to ${u.role}` });
  console.log(`${created ? (invite ? "invited " : "created ") : changed ? "updated " : "ok      "} ${u.role.padEnd(12)} ${email}`);
}
