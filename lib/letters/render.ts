// Turns cases/letters into template data and renders .docx or PDF.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ageShort, FUNDING_LABEL, letterDate, type Funding } from "@/lib/domain";
import { defaultLetterTemplate, defaultMemoTemplate, defaultMinutesTemplate, renderDocx } from "./docx";
import type { LetterView, Memo } from "./content";

export async function loadTemplate(sb: SupabaseClient, names: string[], fallback: () => Uint8Array): Promise<Uint8Array> {
  for (const n of names) {
    const { data } = await sb.storage.from("templates").download(n);
    if (data) return new Uint8Array(await data.arrayBuffer());
  }
  return fallback();
}

export function letterData(v: LetterView) {
  return { ...v, to: v.to.map((line) => ({ line })), paras: v.paras.map((text) => ({ text })), cc: v.cc.map((line) => ({ line })),
    hasBold: !!v.bold, hasClose: !!v.close, hasCc: v.cc.length > 0, single: v.signers2.length === 0, signers2: v.signers2 };
}
export function memoData(m: Memo) {
  return { ...m, hasList: m.list.length > 0, intro: m.paras[1] ?? "", list: m.list.map((line) => ({ line })) };
}

export async function letterDocx(sb: SupabaseClient, kind: string, v: LetterView) {
  const t = await loadTemplate(sb, [`letter-${kind}.docx`, "letter.docx"], defaultLetterTemplate);
  return renderDocx(t, letterData(v), v.isLetter ? v.verifyUrl : undefined);
}
export async function memoDocx(sb: SupabaseClient, m: Memo) {
  return renderDocx(await loadTemplate(sb, ["memo.docx"], defaultMemoTemplate), memoData(m));
}

export type MinutesCase = { name: string; dob: string; gender: string; type: "retirement" | "referral"; minute_no: string | null; agenda_serial: number | null;
  decision: string | null; diagnosis: string | null; procedure: string | null; referring_doctor: string | null; receiving_doctor: string | null;
  receiving_centre: string | null; country: string | null; cost_figures: string | null; funding: Funding | null; duration: string | null; accompanying: string | null;
  station: string | null; employer: { name: string } | null };

export function minutesData(s: { sitting_date: string; venue: string; attendance: string | null }, cases: MinutesCase[], chair: string, sec: string) {
  const d = new Date(s.sitting_date + "T00:00:00Z");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0"), yyyy = d.getUTCFullYear();
  const dec = (x: string | null) => (x === "approved" ? "Approved" : x === "deferred" ? "Deferred" : x === "not_approved" ? "Not approved" : "Pending");
  const sorted = [...cases].sort((a, b) => (a.agenda_serial ?? 0) - (b.agenda_serial ?? 0));
  const weekday = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][d.getUTCDay()];
  return {
    heading: `UGANDA MEDICAL BOARD MINUTES OF THE MEETING HELD ON ${weekday} ${letterDate(s.sitting_date).toUpperCase().replace(/(\d+)(ST|ND|RD|TH)/, "$1$2")} AT ${s.venue.toUpperCase()}`,
    agenda: ["1. Opening prayer.", "2. Welcome remarks.", "3. Review of previous minutes.", "4. Presentation of cases.", "5. Reactions and closure."].map((line) => ({ line })),
    attendance: (s.attendance?.trim() ? s.attendance.split(/\n+/) : ["[From the sitting attendance register]"]).map((line) => ({ line })),
    casesMinute: `MB/${mm}/${yyyy}/Min04`,
    hasReferrals: sorted.some((c) => c.type === "referral"), hasRetire: sorted.some((c) => c.type === "retirement"),
    referrals: sorted.filter((c) => c.type === "referral").map((c) => ({
      minute: c.minute_no ?? "", name: c.name, age: ageShort(c.dob, d), gender: c.gender, diagnosis: c.diagnosis ?? "", procedure: c.procedure ?? "",
      referring: c.referring_doctor ?? "", receiving: [c.receiving_doctor, c.receiving_centre].filter(Boolean).join(", "), country: c.country ?? "",
      cost: c.cost_figures ?? "", funding: c.funding ? FUNDING_LABEL[c.funding] : "", duration: c.duration ?? "", accompanying: c.accompanying ?? "", decision: dec(c.decision) })),
    retire: sorted.filter((c) => c.type === "retirement").map((c) => ({ serial: c.agenda_serial ?? "", minute: c.minute_no ?? "", name: c.name,
      employer: c.employer?.name ?? "", station: c.station ?? "", age: ageShort(c.dob, d), decision: dec(c.decision) })),
    chairName: chair, secName: sec,
  };
}
export async function minutesDocx(sb: SupabaseClient, data: ReturnType<typeof minutesData>) {
  return renderDocx(await loadTemplate(sb, ["minutes.docx"], defaultMinutesTemplate), data);
}

// ---- PDF (signing pack). Bookman is not embeddable here; Times keeps the serif house look for the paper pack.
class Writer {
  page!: PDFPage; y = 0; readonly m = 56; readonly w = 595.28; readonly h = 841.89;
  constructor(private doc: PDFDocument, private f: PDFFont, private fb: PDFFont) { this.newPage(); }
  newPage() { this.page = this.doc.addPage([this.w, this.h]); this.y = this.h - this.m; }
  ensure(h: number) { if (this.y - h < this.m) this.newPage(); }
  text(t: string, o: { b?: boolean; size?: number; align?: "left" | "center" | "right"; gap?: number; u?: boolean; indent?: number } = {}) {
    const size = o.size ?? 11, font = o.b ? this.fb : this.f, maxW = this.w - 2 * this.m - (o.indent ?? 0);
    const words = t.split(/\s+/); let line = "";
    const flush = (l: string) => {
      this.ensure(size * 1.4);
      const tw = font.widthOfTextAtSize(l, size);
      const x = o.align === "center" ? (this.w - tw) / 2 : o.align === "right" ? this.w - this.m - tw : this.m + (o.indent ?? 0);
      this.page.drawText(l, { x, y: this.y - size, size, font, color: rgb(0.11, 0.12, 0.13) });
      if (o.u) this.page.drawLine({ start: { x, y: this.y - size - 2 }, end: { x: x + tw, y: this.y - size - 2 }, thickness: 0.6 });
      this.y -= size * 1.4;
    };
    for (const w of words) { const next = line ? line + " " + w : w; if (this.f.widthOfTextAtSize(next, size) > maxW && line) { flush(line); line = w; } else line = next; }
    if (line) flush(line);
    this.y -= o.gap ?? 6;
  }
  letterhead(ref?: string) {
    const left = ["Telephone: General Lines: 340874/231563/9", "Permanent Secretary's Office: 340872", "Fax: 231584", "E-mail: ps@health.go.ug"];
    const right = ["Ministry of Health", "P. O. Box 7272", "Plot 6 Lourdel Road, Wandegeya", "KAMPALA"];
    const top = this.y;
    left.forEach((t, i) => this.page.drawText(t, { x: this.m, y: top - 8 - i * 10, size: 7, font: this.f }));
    right.forEach((t, i) => this.page.drawText(t, { x: this.w - this.m - this.f.widthOfTextAtSize(t, 7), y: top - 8 - i * 10, size: 7, font: this.f }));
    this.page.drawRectangle({ x: this.w / 2 - 22, y: top - 46, width: 44, height: 44, borderWidth: 0.6, borderColor: rgb(0.6, 0.6, 0.63), borderDashArray: [2, 2] });
    this.page.drawText("Coat of Arms", { x: this.w / 2 - this.f.widthOfTextAtSize("Coat of Arms", 6) / 2, y: top - 26, size: 6, font: this.f });
    this.y = top - 50;
    this.text("THE REPUBLIC OF UGANDA", { b: true, size: 9, align: "center", gap: 2 });
    this.text("MINISTRY OF HEALTH", { b: true, size: 11, align: "center", gap: 6 });
    if (ref) this.text(`IN ANY CORRESPONDENCE ON THIS SUBJECT PLEASE QUOTE NO. ${ref}`, { size: 8 });
  }
}

export async function signingPackPdf(items: { memo: Memo; letter: LetterView }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Signing pack"); doc.setLanguage("en-GB");
  const f = await doc.embedFont(StandardFonts.TimesRoman), fb = await doc.embedFont(StandardFonts.TimesRomanBold);
  for (const { memo, letter } of items) {
    const w = new Writer(doc, f, fb);
    w.letterhead();
    w.text("INTERNAL MEMO", { b: true, u: true, align: "center", gap: 10 });
    for (const [k, v] of [["To:", memo.to], ["Thru:", memo.thru], ["From:", memo.from], ["Date:", memo.date]]) { w.text(`${k} ${v}`, { gap: 1 }); }
    w.y -= 8; w.text(`RE: ${memo.re}`, { b: true, u: true, gap: 8 });
    w.text(memo.paras[0]!);
    if (memo.list.length) { w.text(memo.paras[1]!); memo.list.forEach((l) => w.text(l, { gap: 1, indent: 14 })); w.y -= 6; }
    memo.paras.slice(memo.list.length ? 2 : 1).forEach((p) => w.text(p));
    w.y -= 30; w.text(memo.from, { b: true });

    w.newPage(); w.letterhead(letter.ref);
    w.text(letter.date, { align: "right", gap: 8 });
    letter.to.forEach((t) => w.text(t, { gap: 0 })); w.y -= 10;
    w.text(`RE: ${letter.re}`, { b: true, u: true, gap: 8 });
    letter.paras.forEach((p) => w.text(p, { gap: 8 }));
    if (letter.bold) w.text(letter.bold, { b: true, gap: 8 });
    if (letter.close) w.text(letter.close, { gap: 8 });
    w.y -= 34;
    if (letter.signers2.length) letter.signers2.forEach((s) => w.text(`…………………………  ${s.name}, ${s.title}`, { gap: 18 }));
    else { w.text("…………………………", { gap: 1 }); if (letter.signer) w.text(letter.signer, { b: true, gap: 1 }); w.text(letter.signTitle, { b: true }); }
    if (letter.cc.length) { w.text("CC.", { b: true, gap: 1 }); letter.cc.forEach((c) => w.text(c, { indent: 24, gap: 0 })); }
    if (letter.isLetter) {
      w.ensure(70); w.y -= 10;
      const png = await doc.embedPng(await QRCode.toBuffer(letter.verifyUrl, { width: 240, margin: 1 }));
      w.page.drawImage(png, { x: w.m, y: w.y - 54, width: 54, height: 54 });
      const keep = w.y; w.y -= 8;
      w.text(`Verification no. ${letter.code}. Scan the code or visit ${letter.verifyUrl} to confirm this letter is genuine and record receipt.`, { size: 8, indent: 64 });
      w.y = Math.min(w.y, keep - 60);
    }
  }
  return doc.save();
}
