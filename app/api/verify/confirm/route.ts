import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Public receipt confirmation: captcha (Cloudflare Turnstile) + rate limit, then a narrow security definer function.
export async function POST(req: Request) {
  const { code, name, designation, token } = await req.json().catch(() => ({}));
  if (typeof code !== "string" || !/^[0-9a-f]{24}$/.test(code)) return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "unknown";
  const ipHash = createHash("sha256").update(ip + (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")).digest("hex");
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await sb.from("verify_hits").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", since);
  if ((count ?? 0) >= 10) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  await sb.from("verify_hits").insert({ ip_hash: ipHash });

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret) {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret, response: String(token ?? ""), remoteip: ip }) });
    if (!(await r.json()).success) return NextResponse.json({ error: "Please complete the check and try again." }, { status: 400 });
  } else if (process.env.NODE_ENV === "production" && process.env.VERIFY_CAPTCHA_OPTIONAL !== "true") {
    return NextResponse.json({ error: "Receipt confirmation is not configured yet." }, { status: 503 });
  }
  const { data, error } = await sb.rpc("confirm_receipt_public", { p_code: code, p_name: String(name ?? "").slice(0, 120), p_designation: String(designation ?? "").slice(0, 160) });
  if (error) return NextResponse.json({ error: error.message.replace(/^.*ERROR:\s*/, "") }, { status: 400 });
  if (!data) return NextResponse.json({ error: "This letter cannot be confirmed." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
