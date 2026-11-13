// Letter wording (house format). Shared by the on-screen preview, the .docx generator and the signing-pack PDF.
import { ageFrom, letterDate, numberToWords, type Funding, type LetterKind, type Signatory } from "@/lib/domain";

export type LetterCase = {
  case_no: string; name: string; gender: string; dob: string; type: "retirement" | "referral"; station: string | null;
  employer: { name: string } | null; funding: Funding | null; procedure: string | null; country: string | null; diagnosis: string | null;
  referring_doctor: string | null; receiving_doctor: string | null; receiving_centre: string | null; cost_figures: string | null; cost_words: string | null;
  duration: string | null; accompanying: string | null; minute_no: string | null; sitting: { sitting_date: string } | null;
};
export type LetterRow = { id: string; kind: LetterKind; title: string; addressee: string; signer: Signatory; ref_no: string; verify_code: string;
  status: string; signed_at: string | null; sent_at: string | null; created_at: string };
export type Officers = { dghs: { name: string; title: string }; chair: { name: string; title: string }; secretary: { name: string; title: string };
  memoFrom: { name: string; thru: string } };

export const DEFAULT_OFFICERS: Officers = {
  dghs: { name: "Prof. Charles Olaro", title: "DIRECTOR GENERAL HEALTH SERVICES" },
  chair: { name: "Dr Hellen T. Aanyu", title: "Chairperson" },
  secretary: { name: "Dr Rony R. Bahatungire", title: "Ag. Commissioner Clinical Services" },
  memoFrom: { name: "Dr Urizihiwe Irene", thru: "Ag. CHS (CS)" },
};

export type LetterView = {
  isLetter: boolean; ref: string; date: string; to: string[]; re: string; paras: string[]; bold: string; close: string;
  signer: string; signTitle: string; signers2: { name: string; title: string }[]; cc: string[]; code: string; verifyUrl: string;
};

const CC = ["Hon. Minister of Health", "Permanent Secretary, Ministry of Health", "Secretary, Uganda Medical Board"];

export function letterView(c: LetterCase, l: LetterRow, o: Officers, appUrl: string): LetterView {
  const female = c.gender === "Female";
  const P = female ? { pos: "her", subj: "She", obj: "her", g: "female" } : { pos: "his", subj: "He", obj: "him", g: "male" };
  const a = ageFrom(c.dob); // always the age from the date of birth
  const sitting = c.sitting ? letterDate(c.sitting.sitting_date) : "[sitting date]";
  const diag = (c.diagnosis || "[diagnosis]").toLowerCase();
  const proc = (c.procedure || "[procedure]").toLowerCase();
  const country = c.country || "[country]";
  const accompanying = (c.accompanying || "[relationship]").toLowerCase();
  const duration = c.duration || "[duration]";
  const receiving = c.receiving_doctor || "[receiving doctor]";
  const referring = c.referring_doctor || "[referring doctor]";
  const costWords = c.cost_words || (() => { const n = Number((c.cost_figures ?? "").replace(/[^0-9.]/g, "")); return n ? numberToWords(n) : "[cost in words]"; })();
  const approval = `The Uganda Medical Board has approved ${P.pos} travel to ${country} for ${proc}. ${P.subj} is expected to furnish the Medical Board with the treatment report upon return.`;
  const base: LetterView = {
    isLetter: true, ref: l.ref_no, date: letterDate(l.sent_at ?? l.created_at), to: [], re: "", paras: [], bold: "", close: "",
    signer: o.dghs.name, signTitle: o.dghs.title, signers2: [], cc: CC, code: l.verify_code, verifyUrl: `${appUrl.replace(/\/$/, "")}/verify/${l.verify_code}`,
  };
  if (l.kind === "retire") {
    // Never state the diagnosis in this letter.
    return { ...base, to: [l.addressee, c.employer?.name ?? "", "KAMPALA"].filter(Boolean), re: `RETIREMENT ON MEDICAL GROUNDS: ${c.name.toUpperCase()}`,
      paras: ["The above subject matter refers.",
        `${c.name}${c.station ? ", " + c.station : ""}, applied for retirement on medical grounds. The Uganda Medical Board sitting of ${sitting} evaluated this application and found it satisfactory (Minute ${c.minute_no ?? "[minute]"}).`,
      ], cc: CC.slice(0, 3) };
  }
  const payer = c.funding === "family" ? "The family has" : c.funding === "parliament" ? "The Parliament of Uganda has"
    : c.funding === "judiciary" ? "The Judiciary has" : "The Government of Uganda has";
  const re = `REFERRAL OF ${c.name} FOR ${proc} IN ${country}`.toUpperCase();
  if (l.kind === "intro") {
    return { ...base, to: [receiving, c.receiving_centre ?? "", country.toUpperCase()].filter(Boolean), re,
      paras: [`This is to introduce to you ${c.name}, a ${a}-year-old ${P.g} diagnosed with ${diag}.`,
        `${referring} has recommended ${P.obj} for ${proc}. ${P.subj} will travel with one attendant, ${P.pos} ${accompanying}, over an estimated stay of ${duration}. ${payer} committed to meet the costs related to ${P.pos} travel, treatment and stay.`],
      bold: approval, close: `Any assistance rendered to ${P.obj} will be highly appreciated.`, cc: [...CC, c.name] };
  }
  if (l.kind === "funder") {
    const office = c.funding === "judiciary" ? "The Judiciary" : c.funding === "parliament" ? "Parliament of Uganda" : "Office of the Prime Minister";
    return { ...base, to: [l.addressee, office, "KAMPALA"], re,
      paras: [`${c.name} is a ${a}-year-old ${P.g} diagnosed with ${diag}. ${referring} has referred ${P.obj} to ${receiving} for ${proc}.`,
        `The estimated cost of treatment is ${c.cost_figures || "[cost in figures]"} (${costWords}). ${P.subj} will travel with one attendant, ${P.pos} ${accompanying}, and both will require return air tickets and per diem over a ${duration} period.`],
      bold: approval, close: `The purpose of this letter, therefore, is to grant ${P.obj} permission to travel and authority to purchase foreign exchange as mentioned above.`,
      signer: "", signTitle: "MINISTER OF HEALTH" };
  }
  return { ...base, isLetter: false, cc: [], re: `EXTRACT OF THE MINUTES OF THE UGANDA MEDICAL BOARD SITTING OF ${sitting.toUpperCase()}`,
    paras: [`Minute ${c.minute_no ?? ""}: Presentation and discussion of cases.`, `Name: ${c.name}. Age: ${a} years. Gender: ${c.gender}.`,
      `Diagnosis: ${c.diagnosis ?? ""}. Reason for referral: ${c.procedure ?? ""}.`, `Referring doctor: ${referring}. Receiving doctor: ${receiving}.`,
      `Cost of treatment: ${c.cost_figures ?? ""}. Source of funding: ${c.funding ?? ""}. Duration of stay: ${duration}. Person accompanying: ${c.accompanying ?? ""}.`],
    bold: `Decision of the Board: ${approval}`, signer: "", signTitle: "", signers2: [o.chair, { name: o.secretary.name, title: "Secretary" }] };
}

export type Memo = { to: string; thru: string; from: string; date: string; re: string; paras: string[]; list: string[] };

export function coverMemo(l: { title: string; signer: Signatory }, c: { name: string }, o: Officers, date = new Date()): Memo {
  return { to: l.signer === "minister" ? "Hon. Minister of Health" : "DGHS", thru: o.memoFrom.thru, from: o.memoFrom.name, date: letterDate(date),
    re: `${l.title} — ${c.name}`.toUpperCase(),
    paras: ["The above subject matter refers.", "The purpose of this memo, therefore, is to request your review and or signature on the attached letter(s).", "Thank you."], list: [] };
}

export function batchMemo(items: { name: string; station: string | null; employer: string | null; minute: string | null }[], o: Officers, date = new Date()): Memo {
  return { to: "DGHS", thru: o.memoFrom.thru, from: o.memoFrom.name, date: letterDate(date), re: "REQUEST FOR SIGNATURE",
    paras: ["The above subject matter refers.",
      "The Uganda Medical Board evaluated the following officers' applications for retirement on medical grounds and found them satisfactory:",
      "The purpose of this memo, therefore, is to request your review and or signature on the attached letter(s).", "Thank you."],
    list: items.map((x, i) => `${i + 1}. ${x.name}${x.station ? ", " + x.station : ""}${x.employer ? " (" + x.employer + ")" : ""}${x.minute ? " — " + x.minute : ""}`) };
}

export function officersFrom(settings: Record<string, { value: unknown }>): Officers {
  const v = <T,>(k: string, d: T) => (settings[k]?.value as T) ?? d;
  return { dghs: v("dghs", DEFAULT_OFFICERS.dghs), chair: v("board_chair", DEFAULT_OFFICERS.chair), secretary: v("board_secretary", DEFAULT_OFFICERS.secretary),
    memoFrom: v("memo_from", DEFAULT_OFFICERS.memoFrom) };
}
