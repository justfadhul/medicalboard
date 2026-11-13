import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { batchMemo, coverMemo, DEFAULT_OFFICERS, letterView, type LetterCase, type LetterRow } from "@/lib/letters/content";
import { defaultLetterTemplate, defaultMemoTemplate, defaultMinutesTemplate, renderDocx } from "@/lib/letters/docx";
import { letterData, memoData, minutesData, signingPackPdf } from "@/lib/letters/render";

const kase: LetterCase = { case_no: "UMB-26-1", name: "Test Person", gender: "Female", dob: "1980-01-15", type: "referral", station: "Kira", employer: { name: "Uganda Police Force" },
  funding: "government", procedure: "Kidney transplant", country: "India", diagnosis: "End-Stage Renal Disease", referring_doctor: "Dr A", receiving_doctor: "Dr R. Rao",
  receiving_centre: "Example Hospital", cost_figures: "USD 20,000", cost_words: "twenty thousand US dollars", duration: "six weeks", accompanying: "Sister",
  minute_no: "MB/12/2026/Min04(3)", sitting: { sitting_date: "2026-12-10" } };
const letter = (kind: LetterRow["kind"], addressee = "X"): LetterRow => ({ id: "1", kind, title: "T", addressee, signer: "dghs", ref_no: "ADM 85/265/01",
  verify_code: "a1b2c3d4e5f6a1b2c3d4e5f6", status: "awaiting", signed_at: null, sent_at: "2026-12-14T09:00:00Z", created_at: "2026-12-14T09:00:00Z" });
const xml = (b: Uint8Array) => new PizZip(b).file("word/document.xml")!.asText();

describe("letter wording", () => {
  it("retirement letter never states the diagnosis and cites the minute", () => {
    const v = letterView({ ...kase, type: "retirement", diagnosis: "Severe osteoarthritis" }, letter("retire", "The Inspector General of Police"), DEFAULT_OFFICERS, "https://app");
    const all = JSON.stringify(v);
    expect(all).not.toMatch(/osteoarthritis/i);
    expect(v.paras.join(" ")).toMatch(/evaluated this application and found it satisfactory \(Minute MB\/12\/2026\/Min04\(3\)\)/);
    expect(v.to[0]).toBe("The Inspector General of Police");
    expect(v.signer).toBe("Prof. Charles Olaro");
  });
  it("introduction letter uses the age from the date of birth and the bold approval", () => {
    const v = letterView(kase, letter("intro", "Dr R. Rao"), DEFAULT_OFFICERS, "https://app");
    expect(v.paras[0]).toMatch(/^This is to introduce to you Test Person, a \d+-year-old female/);
    expect(v.bold).toBe("The Uganda Medical Board has approved her travel to India for kidney transplant. She is expected to furnish the Medical Board with the treatment report upon return.");
    expect(v.cc).toEqual(["Hon. Minister of Health", "Permanent Secretary, Ministry of Health", "Secretary, Uganda Medical Board", "Test Person"]);
    expect(v.verifyUrl).toBe("https://app/verify/a1b2c3d4e5f6a1b2c3d4e5f6");
  });
  it("funder letter: per diem, return tickets, cost in figures and words, forex", () => {
    const v = letterView(kase, letter("funder", "OPM"), DEFAULT_OFFICERS, "https://app");
    const t = v.paras.join(" ") + v.close;
    expect(t).toMatch(/USD 20,000 \(twenty thousand US dollars\)/);
    expect(t).toMatch(/return air tickets and per diem/);
    expect(t).toMatch(/permission to travel and authority to purchase foreign exchange/);
    expect(v.signTitle).toBe("MINISTER OF HEALTH");
  });
  it("cover memo wording", () => {
    const m = coverMemo({ title: "Retirement on medical grounds", signer: "dghs" }, { name: "A B" }, DEFAULT_OFFICERS, new Date("2026-12-14"));
    expect(m).toMatchObject({ to: "DGHS", thru: "Ag. CHS (CS)", from: "Dr Urizihiwe Irene" });
    expect(m.paras).toEqual(["The above subject matter refers.", "The purpose of this memo, therefore, is to request your review and or signature on the attached letter(s).", "Thank you."]);
    expect(batchMemo([], DEFAULT_OFFICERS).re).toBe("REQUEST FOR SIGNATURE");
  });
});

describe(".docx generation", () => {
  it("fills the letter template, Bookman Old Style, en-GB, and swaps the QR image", async () => {
    const v = letterView(kase, letter("intro", "Dr R. Rao"), DEFAULT_OFFICERS, "https://app");
    const out = await renderDocx(defaultLetterTemplate(), letterData(v), v.verifyUrl);
    const x = xml(out);
    expect(x).toContain("This is to introduce to you Test Person");
    expect(x).toContain("ADM 85/265/01");
    expect(x).toContain("a1b2c3d4e5f6a1b2c3d4e5f6");
    expect(x).not.toMatch(/\{[#/]?\w+\}/);
    const zip = new PizZip(out);
    expect(zip.file("word/styles.xml")!.asText()).toMatch(/Bookman Old Style[\s\S]*en-GB/);
    expect(zip.file("word/media/qr.png")!.asUint8Array().length).toBeGreaterThan(300);
  });
  it("memo and minutes render with no leftover tags", async () => {
    const m = await renderDocx(defaultMemoTemplate(), memoData(batchMemo([{ name: "A", station: "S", employer: "E", minute: "M" }], DEFAULT_OFFICERS)));
    expect(xml(m)).toContain("RE: REQUEST FOR SIGNATURE");
    const d = minutesData({ sitting_date: "2026-12-10", venue: "Mulago Specialised Women and Neonatal Hospital, Level 2", attendance: null },
      [{ ...kase, type: "referral", agenda_serial: 1, decision: "approved", minute_no: "MB/12/2026/Min04(1)" } as never,
       { ...kase, name: "Ret One", type: "retirement", agenda_serial: 2, decision: "approved", minute_no: "MB/12/2026/Min04(2)" } as never], "Chair", "Sec");
    const x = xml(await renderDocx(defaultMinutesTemplate(), d));
    expect(x).toContain("MINUTES OF THE MEETING HELD ON THURSDAY 10TH DECEMBER, 2026");
    expect(x).toContain("MB/12/2026/Min04(1)");
    expect(x).toContain("Ret One");
    expect(x).toContain('w:orient="landscape"');
    expect(x).not.toMatch(/\{[#/]?\w+\}/);
  });
  it("signing pack is a PDF with a memo and a letter page per letter", async () => {
    const v = letterView(kase, letter("intro"), DEFAULT_OFFICERS, "https://app");
    const pdf = await signingPackPdf([{ memo: coverMemo(letter("intro"), kase, DEFAULT_OFFICERS), letter: v }]);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(2);
  });
});
