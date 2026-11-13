import { requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { SettingsView } from "./SettingsView";

export default async function Settings() {
  await requireRole("admin");
  const sb = await supabaseServer();
  const [{ data }, ai] = await Promise.all([sb.from("settings").select("*").order("key"), sb.from("ai_calls").select("id,model,status,created_at,pages").order("created_at", { ascending: false }).limit(20)]);
  return <SettingsView settings={(data ?? []) as never} aiEnv={process.env.AI_READING_ENABLED === "true"} smsProvider={process.env.SMS_PROVIDER ?? "mock"} aiCalls={(ai.data ?? []) as never} />;
}
