// Optional AI reading of scans. OFF unless AI_READING_ENABLED=true (server-only) AND the admin has recorded Ministry approval.
// Sends only the pages of the one document requested; results are stored UNCONFIRMED; every call is logged in ai_calls.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-5-5";
const FIELDS = ["name", "dob", "diagnosis", "referring_doctor", "receiving_doctor", "cost_figures", "cost_words", "report_date"] as const;
const LABEL: Record<string, string> = { name: "Name on documents", dob: "Date of birth", diagnosis: "Diagnosis", referring_doctor: "Referring doctor",
  receiving_doctor: "Receiving doctor", cost_figures: "Cost in figures", cost_words: "Cost in words", report_date: "Report date" };
const cors = { "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) => Response.json(b, { status: s, headers: cors });
  if (Deno.env.get("AI_READING_ENABLED") !== "true") return json({ error: "AI reading is switched off" }, 403);
  const url = Deno.env.get("SUPABASE_URL")!;
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: role } = await user.rpc("my_role");
  if (role !== "secretariat" && role !== "admin") return json({ error: "Not allowed" }, 403);
  const { data: ack } = await admin.from("settings").select("value").eq("key", "ai_reading_acknowledged").single();
  if (ack?.value !== true) return json({ error: "The admin has not recorded the Ministry's approval for an external processor" }, 403);
  const { case_id, document_id } = await req.json();
  const { data: pages } = await user.from("document_pages").select("path,page_no").eq("document_id", document_id).eq("case_id", case_id).order("page_no").limit(10);
  if (!pages?.length) return json({ error: "No pages" }, 400);
  const { data: me } = await user.auth.getUser();
  const log = async (status: string, error?: string) => admin.from("ai_calls").insert({ case_id, document_id, pages: pages.map((p) => p.page_no), model: MODEL, status, error, requested_by: me.user?.id });
  const content: unknown[] = [];
  for (const p of pages) {
    const { data } = await admin.storage.from("scans").download(p.path);
    if (!data) continue;
    const b64 = btoa(String.fromCharCode(...new Uint8Array(await data.arrayBuffer())));
    content.push({ type: "text", text: `Page ${p.page_no}:` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
  }
  content.push({ type: "text", text: `Extract these fields if present: ${FIELDS.join(", ")}. Dates as YYYY-MM-DD. For each, give the page number and a bounding box as fractions of the page (x,y,w,h from the top-left). Use the record_fields tool. Omit fields that are not on these pages. Do not guess.` });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 2000, tool_choice: { type: "tool", name: "record_fields" },
      tools: [{ name: "record_fields", description: "Fields read from the scanned pages", input_schema: { type: "object", properties: { fields: { type: "array", items: { type: "object",
        properties: { key: { type: "string", enum: FIELDS }, value: { type: "string" }, page: { type: "integer" },
          bbox: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } } } }, required: ["key", "value", "page"] } } }, required: ["fields"] } }],
      messages: [{ role: "user", content }],
    }),
  });
  if (!r.ok) { await log("error", `HTTP ${r.status}`); return json({ error: "The reading service failed" }, 502); }
  const out = await r.json();
  const fields = (out.content ?? []).find((c: { type: string }) => c.type === "tool_use")?.input?.fields ?? [];
  for (const f of fields) {
    if (!FIELDS.includes(f.key)) continue;
    await admin.from("case_fields").insert({ case_id, key: f.key, label: LABEL[f.key], value: String(f.value).slice(0, 500), document_id, page_no: f.page, bbox: f.bbox ?? null, origin: "ai", confirmed: false });
  }
  await admin.rpc("refresh_flags", { p_case: case_id });
  await log("ok");
  return json({ count: fields.length });
});
