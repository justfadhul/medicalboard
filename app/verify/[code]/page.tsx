import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { AuthShell } from "@/components/AuthShell";
import { ConfirmForm } from "./ConfirmForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify a letter — Ministry of Health, Uganda Medical Board", robots: { index: false } };

// Public: reads only through the narrow security definer function verify_lookup (title, addressee office, date).
export default async function Verify({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let v: { title: string; addressee: string; date: string; signed: boolean; receipt_confirmed: boolean; receipt_needed: boolean } | null = null;
  let limited = false;
  if (/^[0-9a-f]{24}$/.test(code)) {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const ip = ((await headers()).get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "unknown";
      const ipHash = createHash("sha256").update(ip + process.env.SUPABASE_SERVICE_ROLE_KEY).digest("hex");
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const { count } = await admin.from("verify_hits").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", new Date(Date.now() - 10 * 60_000).toISOString());
      limited = (count ?? 0) >= 30;
      if (!limited) await admin.from("verify_hits").insert({ ip_hash: ipHash });
    }
    if (!limited) {
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const { data } = await anon.rpc("verify_lookup", { p_code: code });
      v = data;
    }
  }
  return (
    <AuthShell title="Confirm receipt of a letter" sub="Ministry of Health · Uganda Medical Board">
      {limited ? <p className="err">Too many requests. Try again in a few minutes.</p> : !v ? (
        <p className="err" role="alert">This verification number does not match any letter issued by the Uganda Medical Board. Check the number, or contact the Ministry of Health.</p>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className={v.signed ? "okbox" : "warnbox"}>{v.signed ? "Genuine letter issued by the Ministry of Health." : "This letter has not been signed yet."}</div>
          <dl className="stack" style={{ gap: 6, margin: 0 }}>
            <div><dt className="label">Letter</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v.title}</dd></div>
            <div><dt className="label">Addressed to</dt><dd style={{ margin: 0 }}>{v.addressee}</dd></div>
            <div><dt className="label">Date</dt><dd style={{ margin: 0 }}>{v.date}</dd></div>
            <div><dt className="label">Verification no.</dt><dd style={{ margin: 0 }}>{code}</dd></div>
          </dl>
          {v.receipt_confirmed ? <p className="okbox">Receipt has already been confirmed. Thank you.</p>
            : v.signed && v.receipt_needed ? <ConfirmForm code={code} siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} /> : null}
        </div>
      )}
    </AuthShell>
  );
}
