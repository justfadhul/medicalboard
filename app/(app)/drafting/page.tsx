import { getSettings, requireRole } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { officersFrom } from "@/lib/letters/content";
import { LETTER_CASE_COLS } from "@/lib/api";
import { DraftingView } from "./DraftingView";

export default async function Drafting() {
  await requireRole("secretariat");
  const sb = await supabaseServer();
  const [{ data }, settings] = await Promise.all([
    sb.from("cases").select(`${LETTER_CASE_COLS},employer_id,employer2:employers(name,cadre),letters(*)`).eq("stage", "decided").eq("decision", "approved").order("decided_at"),
    getSettings(),
  ]);
  return <DraftingView cases={(data ?? []) as never} officers={officersFrom(settings)} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
    addr={{ retirementAddressee: settings.retirement_addressee?.value as string, opmAddressee: settings.opm_addressee?.value as string }} />;
}
