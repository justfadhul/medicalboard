// Sends the SMS outbox with retries. Schedule every minute (see docs/RUNBOOK.md) or call with the CRON secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import { dispatchOutbox } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Forbidden", { status: 403 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const result = await dispatchOutbox(db, Deno.env.toObject());
  return Response.json(result);
});
