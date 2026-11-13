// Idempotently creates the first admin from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_NAME.
// Sends an invite link (never a password). Re-running only re-asserts the admin role.
// Usage: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_NAME=… npm run bootstrap:admin
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase(), name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() ?? "";
const site = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
if (!url || !key || !email) { console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and BOOTSTRAP_ADMIN_EMAIL"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

let userId: string | undefined;
for (let page = 1; !userId; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
  if (data.users.length < 200) break;
}
if (!userId) {
  const { data, error } = await sb.auth.admin.inviteUserByEmail(email, { data: { full_name: name }, redirectTo: `${site}/auth/callback` });
  if (error) throw error;
  userId = data.user.id;
  console.log(`Invitation sent to ${email}.`);
} else console.log(`${email} already exists; making sure it is an active admin.`);

const { error } = await sb.from("profiles").upsert({ id: userId, email, full_name: name, role: "admin", active: true }, { onConflict: "id" });
if (error) throw error;
await sb.from("audit_log").insert({ actor_label: "bootstrap script", action: "user_role", summary: `Bootstrap admin: ${email}` });
console.log("Done. The admin signs in from the emailed link and sets up two-step verification.");
