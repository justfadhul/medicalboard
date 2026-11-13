import { getSettings, requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { officersFrom } from "@/lib/letters/content";
import { LETTER_CASE_COLS } from "@/lib/api";
import { SignaturesView } from "./SignaturesView";

export default async function Signatures() {
  await requireRole("secretariat");
  const sb = await supabaseServer();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [a, s, settings] = await Promise.all([
    sb.from("letters").select(`*, case:cases(${LETTER_CASE_COLS})`).eq("status", "awaiting").neq("kind", "extract").order("signer").order("sent_at"),
    sb.from("letters").select(`id,title,signed_at,signed_scan_path,case_id,case:cases(name,case_no)`).eq("status", "signed").neq("kind", "extract").gte("signed_at", since).order("signed_at", { ascending: false }).limit(30),
    getSettings(),
  ]);
  return <SignaturesView awaiting={(a.data ?? []) as never} signed={(s.data ?? []) as never} officers={officersFrom(settings)} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} />;
}
