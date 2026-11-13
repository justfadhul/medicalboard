import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchOutbox } from "@/lib/sms";

// Fallback trigger for the SMS outbox (the Supabase Edge Function `sms-dispatch` is the primary sender).
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await dispatchOutbox(supabaseAdmin(), process.env));
}
