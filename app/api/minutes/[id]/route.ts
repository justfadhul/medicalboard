import { NextResponse } from "next/server";
import { DOCX, fileResponse, guard, officers } from "@/lib/api";
import { minutesData, minutesDocx } from "@/lib/letters/render";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("secretariat", "commissioner");
  if ("error" in g) return g.error;
  const { id } = await params;
  const { data: s } = await g.sb.from("sittings").select("*").eq("id", id).maybeSingle();
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: cases } = await g.sb.from("cases").select("name,dob,gender,type,minute_no,agenda_serial,decision,diagnosis,procedure,referring_doctor,receiving_doctor,receiving_centre,country,cost_figures,funding,duration,accompanying,station,employer:employers(name)").eq("sitting_id", id);
  const o = await officers();
  const data = minutesData(s, (cases ?? []) as never, o.chair.name, o.secretary.name);
  return fileResponse(await minutesDocx(g.sb, data), `UMB minutes ${s.sitting_date}.docx`, DOCX);
}
