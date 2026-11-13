import { NextResponse } from "next/server";
import { appUrl, fileResponse, guard, LETTER_CASE_COLS, officers } from "@/lib/api";
import { coverMemo, letterView } from "@/lib/letters/content";
import { signingPackPdf } from "@/lib/letters/render";

// Every letter out for signature, with its cover memo, in order, as one PDF. ?signer=dghs|minister narrows it.
export async function GET(req: Request) {
  const g = await guard("secretariat");
  if ("error" in g) return g.error;
  const signer = new URL(req.url).searchParams.get("signer");
  let q = g.sb.from("letters").select(`*, case:cases(${LETTER_CASE_COLS})`).eq("status", "awaiting").neq("kind", "extract").order("signer").order("sent_at");
  if (signer) q = q.eq("signer", signer);
  const { data } = await q;
  if (!data?.length) return NextResponse.json({ error: "No letters out for signature" }, { status: 404 });
  const o = await officers(), url = appUrl(req);
  const items = data.map((l) => ({ memo: coverMemo(l, l.case, o), letter: letterView(l.case, l, o, url) }));
  return fileResponse(await signingPackPdf(items), `Signing pack ${new Date().toISOString().slice(0, 10)}.pdf`, "application/pdf");
}
