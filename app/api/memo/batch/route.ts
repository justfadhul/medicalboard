import { NextResponse } from "next/server";
import { DOCX, fileResponse, guard, officers } from "@/lib/api";
import { batchMemo } from "@/lib/letters/content";
import { memoDocx } from "@/lib/letters/render";

// One batch cover memo for the retirement letters of a sitting: "RE: REQUEST FOR SIGNATURE".
export async function GET(req: Request) {
  const g = await guard("secretariat");
  if ("error" in g) return g.error;
  const sitting = new URL(req.url).searchParams.get("sitting");
  let q = g.sb.from("cases").select("name,station,minute_no,employer:employers(name),letters!inner(status,kind)").eq("type", "retirement").in("stage", ["decided", "signature"]).eq("letters.kind", "retire");
  if (sitting) q = q.eq("sitting_id", sitting);
  const { data } = await q;
  if (!data?.length) return NextResponse.json({ error: "No retirement letters" }, { status: 404 });
  const memo = batchMemo(data.map((c) => ({ name: c.name, station: c.station, employer: (c.employer as unknown as { name: string } | null)?.name ?? null, minute: c.minute_no })), await officers());
  return fileResponse(await memoDocx(g.sb, memo), "Batch memo - retirement letters.docx", DOCX);
}
