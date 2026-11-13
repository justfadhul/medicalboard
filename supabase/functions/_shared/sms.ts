// SMS provider adapter. Plain fetch only, so it runs in Supabase Edge Functions (Deno) and in Node (lib/sms).
export type SmsResult = { ok: true; ref?: string } | { ok: false; error: string; retry: boolean };
export interface SmsProvider { name: string; send(to: string, body: string): Promise<SmsResult> }
type Env = Record<string, string | undefined>;

/** Uganda numbers to E.164: 0772 123456 -> +256772123456 */
export function toE164(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("256")) return "+" + d;
  if (d.startsWith("0")) return "+256" + d.slice(1);
  return "+256" + d;
}

export const mockProvider: SmsProvider = {
  name: "mock",
  async send(to, body) { console.log(`[sms:mock] to=${to} body=${body}`); return { ok: true, ref: "mock-" + Date.now() }; },
};

export function africasTalking(env: Env): SmsProvider {
  const user = env.AT_USERNAME, key = env.AT_API_KEY;
  const host = user === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
  return {
    name: "africastalking",
    async send(to, body) {
      if (!user || !key) return { ok: false, error: "Africa's Talking credentials are not set", retry: false };
      const form = new URLSearchParams({ username: user, to: toE164(to), message: body });
      if (env.AT_SENDER_ID) form.set("from", env.AT_SENDER_ID);
      try {
        const r = await fetch(`${host}/version1/messaging`, { method: "POST", headers: { apiKey: key, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: form });
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, retry: r.status >= 500 || r.status === 429 };
        const j = await r.json();
        const rec = j?.SMSMessageData?.Recipients?.[0];
        if (!rec || !["Success", "Sent", "Submitted", "Queued"].includes(rec.status)) return { ok: false, error: rec?.status ?? j?.SMSMessageData?.Message ?? "Rejected", retry: false };
        return { ok: true, ref: rec.messageId };
      } catch (e) { return { ok: false, error: String((e as Error).message ?? e), retry: true }; }
    },
  };
}

export function smsProvider(env: Env): SmsProvider {
  return (env.SMS_PROVIDER ?? "mock") === "africastalking" ? africasTalking(env) : mockProvider;
}

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };
const MAX_ATTEMPTS = 5;

/** Sends queued messages with retries and exponential backoff. */
export async function dispatchOutbox(db: Db, env: Env, limit = 50) {
  const provider = smsProvider(env);
  const { data: rows } = await db.from("sms_outbox").select("id,to_phone,body,attempts").eq("status", "queued").lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(limit);
  let sent = 0, failed = 0;
  for (const m of rows ?? []) {
    const { data: claimed } = await db.from("sms_outbox").update({ status: "sending" }).eq("id", m.id).eq("status", "queued").select("id");
    if (!claimed?.length) continue;
    const r = await provider.send(m.to_phone, m.body);
    const attempts = m.attempts + 1;
    if (r.ok) { sent++; await db.from("sms_outbox").update({ status: "sent", attempts, sent_at: new Date().toISOString(), provider: provider.name, provider_ref: r.ref ?? null, last_error: null }).eq("id", m.id); }
    else {
      const final = !r.retry || attempts >= MAX_ATTEMPTS;
      if (final) failed++;
      await db.from("sms_outbox").update({ status: final ? "failed" : "queued", attempts, last_error: r.error, provider: provider.name,
        next_attempt_at: new Date(Date.now() + 60_000 * 2 ** attempts).toISOString() }).eq("id", m.id);
    }
  }
  return { provider: provider.name, processed: rows?.length ?? 0, sent, failed };
}
