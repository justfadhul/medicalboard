// Applies supabase/migrations to a cloud project through the Management API (no database password needed),
// recording each one in supabase_migrations.schema_migrations so `supabase db push` stays in sync.
// Usage: SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/apply-migrations.mjs [extra.sql …]
import fs from "node:fs";
import path from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
if (!token || !ref) { console.error("Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF"); process.exit(1); }
export async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${body}`);
  return JSON.parse(body || "[]");
}
const q = (s) => "'" + s.replace(/'/g, "''") + "'";

await sql(`create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
const done = new Set((await sql("select version from supabase_migrations.schema_migrations")).map((r) => r.version));
const dir = "supabase/migrations";
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
  if (done.has(version)) { console.log("skip", f); continue; }
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  await sql(`begin;\n${text}\n;insert into supabase_migrations.schema_migrations (version, name, statements) values (${q(version)}, ${q(rest.join("_"))}, array[${q(text)}]);\ncommit;`);
  console.log("applied", f);
}
for (const extra of process.argv.slice(2)) { await sql(fs.readFileSync(extra, "utf8")); console.log("ran", extra); }
