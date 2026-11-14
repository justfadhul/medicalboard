import "server-only";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getSettings } from "@/lib/data";
import { officersFrom } from "@/lib/letters/content";
import type { Role } from "@/lib/domain";

/** Route-handler guard: signed in, MFA (aal2) and one of the roles (admin always passes). */
export async function guard(...roles: Role[]) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Sign in" }, { status: 401 }) } as const;
  const { data: role } = await sb.rpc("my_role");
  if (!role) return { error: NextResponse.json({ error: "Role required (or two-step verification)" }, { status: 403 }) } as const;
  if (roles.length && role !== "admin" && !roles.includes(role)) return { error: NextResponse.json({ error: "Not allowed for your role" }, { status: 403 }) } as const;
  return { sb, user, role: role as Role } as const;
}

export const appUrl = (req: Request) => process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
export async function officers() { return officersFrom(await getSettings()); }

export function fileResponse(body: Uint8Array, name: string, type: string) {
  return new NextResponse(Buffer.from(body), { headers: { "content-type": type, "content-disposition": `attachment; filename="${name.replace(/[^\w.\- ]+/g, "_")}"`, "cache-control": "private, no-store" } });
}
export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const LETTER_CASE_COLS = "id,case_no,name,gender,dob,type,station,funding,procedure,country,diagnosis,referring_doctor,receiving_doctor,receiving_centre,cost_figures,cost_words,duration,accompanying,minute_no,employer:employers(name),sitting:sittings(sitting_date)";
