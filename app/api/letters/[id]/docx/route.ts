import { NextResponse } from "next/server";
import { appUrl, DOCX, fileResponse, guard, LETTER_CASE_COLS, officers } from "@/lib/api";
import { letterView } from "@/lib/letters/content";
import { letterDocx } from "@/lib/letters/render";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("secretariat", "commissioner");
  if ("error" in g) return g.error;
  const { id } = await params;
  const { data: l } = await g.sb.from("letters").select(`*, case:cases(${LETTER_CASE_COLS})`).eq("id", id).maybeSingle();
  if (!l) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const v = letterView(l.case, l, await officers(), appUrl(req));
  return fileResponse(await letterDocx(g.sb, l.kind, v), `${l.case.case_no} ${l.title}.docx`, DOCX);
}
