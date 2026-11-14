import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Counts hits per hashed IP in a window; returns true when over the limit. Uses the service-role client. */
export async function overLimit(sb: SupabaseClient, req: Request, bucket: string, max: number, minutes = 10): Promise<boolean> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "unknown";
  const ipHash = createHash("sha256").update(ip + (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")).digest("hex");
  const { count } = await sb.from("verify_hits").select("id", { count: "exact", head: true })
    .eq("bucket", bucket).eq("ip_hash", ipHash).gte("at", new Date(Date.now() - minutes * 60_000).toISOString());
  if ((count ?? 0) >= max) return true;
  await sb.from("verify_hits").insert({ ip_hash: ipHash, bucket });
  return false;
}
