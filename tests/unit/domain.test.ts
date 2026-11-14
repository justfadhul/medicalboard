import { describe, expect, it } from "vitest";
import { ageFrom, cadreMatches, criteria, daysTone, isTransplant, letterDate, minuteNumber, numberToWords, planLetters, secondThursday } from "@/lib/domain";

describe("age from date of birth", () => {
  it("counts whole years", () => {
    expect(ageFrom("1972-03-14", new Date("2026-11-13T12:00:00"))).toBe(54);
    expect(ageFrom("1972-11-14", new Date("2026-11-13T12:00:00"))).toBe(53);
    expect(ageFrom("1972-11-13", new Date("2026-11-13T12:00:00"))).toBe(54);
    expect(ageFrom("2000-02-29", new Date("2026-02-28T12:00:00"))).toBe(25);
  });
});

describe("sittings and minute numbers", () => {
  it("second Thursday of each month", () => {
    expect(secondThursday(2026, 12).toISOString().slice(0, 10)).toBe("2026-12-10");
    expect(secondThursday(2026, 11).toISOString().slice(0, 10)).toBe("2026-11-12");
    expect(secondThursday(2027, 1).toISOString().slice(0, 10)).toBe("2027-01-14");
    expect(secondThursday(2026, 10).toISOString().slice(0, 10)).toBe("2026-10-08");
  });
  it("MB/MM/YYYY/Min04(n)", () => {
    expect(minuteNumber("2026-12-10", 3)).toBe("MB/12/2026/Min04(3)");
    expect(minuteNumber("2027-01-14", 12)).toBe("MB/01/2027/Min04(12)");
  });
  it("letter dates", () => {
    expect(letterDate("2026-11-13")).toBe("13th November, 2026");
    expect(letterDate("2026-12-01")).toBe("1st December, 2026");
    expect(letterDate("2026-12-22")).toBe("22nd December, 2026");
    expect(letterDate("2026-12-11")).toBe("11th December, 2026");
  });
});

describe("letter routing", () => {
  it("police retirement goes to the IGP, signed by the DGHS", () => {
    const [l, ...rest] = planLetters({ type: "retirement", employerCadre: "police", employerName: "Uganda Police Force" });
    expect(rest).toHaveLength(0);
    expect(l).toMatchObject({ kind: "retire", addressee: "The Inspector General of Police", signer: "dghs", ref: "ADM 85/265/01", toConfirm: false });
  });
  it("non-police retirement addressee is a setting to confirm", () => {
    const [l] = planLetters({ type: "retirement", employerCadre: "teachers", employerName: "Ministry of Education and Sports" }, { retirementAddressee: "The Permanent Secretary, {employer}" });
    expect(l!.addressee).toBe("The Permanent Secretary, Ministry of Education and Sports");
    expect(l!.toConfirm).toBe(true);
  });
  it("family-funded referral: one introduction letter", () => {
    const ls = planLetters({ type: "referral", funding: "family", receivingDoctor: "Dr R. Rao" });
    expect(ls.map((l) => [l.kind, l.addressee, l.signer, l.ref])).toEqual([["intro", "Dr R. Rao", "dghs", "ADM 85/265/01"]]);
  });
  it("government-funded referral: Minister's letter to OPM, minutes extract, introduction", () => {
    const ls = planLetters({ type: "referral", funding: "government", receivingDoctor: "Dr K", minuteNo: "MB/12/2026/Min04(2)" });
    expect(ls.map((l) => l.kind)).toEqual(["funder", "extract", "intro"]);
    expect(ls[0]).toMatchObject({ signer: "minister", ref: "ADM 85/124/01", toConfirm: true });
    expect(ls[0]!.addressee).toMatch(/Prime Minister/);
    expect(ls[1]).toMatchObject({ signer: "board", receiptNeeded: false, ref: "Minute MB/12/2026/Min04(2)" });
  });
  it("Judiciary and Parliament exceptions", () => {
    expect(planLetters({ type: "referral", funding: "judiciary" })[0]!.addressee).toBe("The Chief Justice");
    expect(planLetters({ type: "referral", funding: "parliament" })[0]!.addressee).toBe("The Clerk to Parliament");
  });
});

describe("criteria", () => {
  const base = { fields: [{ confirmed: true }], openFlags: 0, openBlockingFindings: 0, hold: false };
  it("all pass", () => {
    expect(criteria({ ...base, docs: [{ name: "A", status: "received", pages: 2, ruleStatus: "confirmed" }] }).every((c) => c.ok)).toBe(true);
  });
  it("only confirmed rules block; others are advisory", () => {
    const c = criteria({ ...base, docs: [{ name: "Cost estimate", status: "not_brought", pages: 0, ruleStatus: "seen_in_past" }] });
    expect(c.find((x) => x.key === "docs")!.ok).toBe(true);
    expect(c.find((x) => x.key === "docs")!.note).toMatch(/Advisory/);
    const d = criteria({ ...base, docs: [{ name: "Donor details", status: "not_brought", pages: 0, ruleStatus: "confirmed" }] });
    expect(d.find((x) => x.key === "docs")!.ok).toBe(false);
  });
  it("custom documents (no rule) block", () => {
    expect(criteria({ ...base, docs: [{ name: "Employer letter", status: "not_brought", pages: 0, ruleStatus: null }] })[0]!.ok).toBe(false);
  });
  it("unscanned, unconfirmed, flags, findings and hold each fail", () => {
    const c = criteria({ docs: [{ name: "A", status: "received", pages: 0 }], fields: [{ confirmed: false }], openFlags: 1, openBlockingFindings: 2, hold: true, holdReason: "Funding" });
    expect(c.map((x) => x.ok)).toEqual([true, false, false, false, false, false]);
  });
  it("no fields read yet fails", () => {
    expect(criteria({ ...base, fields: [], docs: [] }).find((x) => x.key === "fields")!.ok).toBe(false);
  });
});

describe("cadre mapping and transplants", () => {
  it("maps by employer cadre", () => {
    expect(cadreMatches("police", "police")).toBe(true);
    expect(cadreMatches("police", "teachers")).toBe(false);
    expect(cadreMatches("all", null)).toBe(true);
    expect(cadreMatches("health", null)).toBe(false);
  });
  it("any transplant", () => {
    for (const p of ["Kidney transplant", "Liver transplant", "Bone marrow (stem cell) transplant"]) expect(isTransplant(p)).toBe(true);
    expect(isTransplant("Cochlear implant")).toBe(false);
  });
});

describe("misc", () => {
  it("days thresholds", () => { expect(daysTone(7)).toBe("grey"); expect(daysTone(8)).toBe("amber"); expect(daysTone(15)).toBe("red"); });
  it("numbers to words", () => {
    expect(numberToWords(18000)).toBe("eighteen thousand");
    expect(numberToWords(12500)).toBe("twelve thousand five hundred");
    expect(numberToWords(45250)).toBe("forty-five thousand two hundred and fifty");
  });
});

describe("age in years, months, weeks and days", () => {
  const on = new Date("2026-11-14T12:00:00");
  it("breaks the age down", async () => {
    const { ageParts, ageText, ageShort, ageAdjective } = await import("@/lib/domain");
    expect(ageParts("1985-02-11", on)).toMatchObject({ years: 41, months: 9, weeks: 0, days: 3 });
    expect(ageText("2026-05-06", on)).toBe("6 months, 1 week, 1 day");
    expect(ageText("2026-10-24", on)).toBe("3 weeks");
    expect(ageText("2026-11-10", on)).toBe("4 days");
    expect(ageText("2026-11-14", on)).toBe("newborn");
    expect(ageText("2025-08-14", on)).toBe("1 year, 3 months");
    expect(ageShort("1972-03-14", on)).toBe("54 years");
    expect(ageShort("2025-08-01", on)).toBe("1 year, 3 months, 1 week, 6 days");
    expect(ageAdjective("1972-03-14", on)).toBe("54-year-old");
    expect(ageAdjective("2026-05-06", on)).toBe("6-month-old");
    expect(ageAdjective("2026-10-24", on)).toBe("3-week-old");
    expect(ageAdjective("2026-11-10", on)).toBe("4-day-old");
  });
  it("handles month ends and leap years", async () => {
    const { ageParts } = await import("@/lib/domain");
    expect(ageParts("2026-01-31", new Date("2026-02-28T12:00:00"))).toMatchObject({ years: 0, months: 1, weeks: 0, days: 0 });
    expect(ageParts("2024-02-29", new Date("2026-02-28T12:00:00"))).toMatchObject({ years: 2, months: 0, days: 0 });
  });
});
