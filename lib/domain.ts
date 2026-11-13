// Pure domain logic shared by the UI, server routes and unit tests.
// The database functions are the source of truth for transitions; these mirror them for display and documents.

export type Role = "registry" | "secretariat" | "commissioner" | "admin";
export type CaseType = "retirement" | "referral";
export type Stage = "intake" | "review" | "ready" | "decided" | "signature" | "signed" | "collected" | "closed";
export type Funding = "family" | "government" | "judiciary" | "parliament";
export type Cadre = "police" | "teachers" | "health" | "lg" | "all";
export type LetterKind = "retire" | "intro" | "funder" | "extract";
export type Signatory = "dghs" | "minister" | "board";
export type Tone = "grey" | "blue" | "green" | "amber" | "red" | "purple" | "teal";

export const STAGES: { key: Stage; label: string; owner: string; tone: Tone }[] = [
  { key: "intake", label: "Intake", owner: "Registry", tone: "grey" },
  { key: "review", label: "Review", owner: "Secretariat", tone: "blue" },
  { key: "ready", label: "Ready for Board", owner: "Board", tone: "purple" },
  { key: "decided", label: "Decided", owner: "Secretariat", tone: "blue" },
  { key: "signature", label: "Out for signature", owner: "Secretariat", tone: "amber" },
  { key: "signed", label: "Signed", owner: "Registry", tone: "teal" },
  { key: "collected", label: "Collected", owner: "Registry", tone: "teal" },
  { key: "closed", label: "Closed", owner: "—", tone: "green" },
];
export const stageMeta = (s: Stage) => STAGES.find((x) => x.key === s)!;

export const ROLE_LABEL: Record<Role, string> = {
  registry: "Registry officer",
  secretariat: "Secretariat (reviewer)",
  commissioner: "Commissioner (Board Secretary)",
  admin: "System administrator",
};

export const FUNDING_LABEL: Record<Funding, string> = {
  family: "Family or self",
  government: "Government ministry or agency",
  judiciary: "Judiciary",
  parliament: "Parliament",
};

export const CADRE_LABEL: Record<Cadre, string> = {
  police: "All police officers",
  teachers: "All teachers",
  health: "All health workers",
  lg: "All local government staff",
  all: "All retirement cases",
};

export const SIGNER_LABEL: Record<Signatory, string> = {
  dghs: "DGHS (Prof. Charles Olaro)",
  minister: "Minister of Health",
  board: "Chairperson and Secretary (with the minutes)",
};

/** Whole years between date of birth and `on`. Letters always use this, never a stated age. */
export function ageFrom(dob: string | Date, on: Date = new Date()): number {
  const d = typeof dob === "string" ? new Date(dob + (dob.length === 10 ? "T00:00:00" : "")) : dob;
  let a = on.getFullYear() - d.getFullYear();
  const m = on.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < d.getDate())) a--;
  return a;
}

/** The Board sits on the second Thursday of each month. */
export function secondThursday(year: number, month1: number): Date {
  const first = new Date(Date.UTC(year, month1 - 1, 1));
  const offset = (4 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month1 - 1, 1 + offset + 7));
}

/** MB/MM/YYYY/Min04(n) */
export function minuteNumber(sitting: string | Date, serial: number): string {
  const d = typeof sitting === "string" ? new Date(sitting + "T00:00:00Z") : sitting;
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `MB/${mm}/${d.getUTCFullYear()}/Min04(${serial})`;
}

export const isTransplant = (procedure?: string | null) => /transplant/i.test(procedure ?? "");

export function cadreMatches(scope: Cadre, employerCadre: Cadre | null | undefined): boolean {
  return scope === "all" || (!!employerCadre && scope === employerCadre);
}

export interface PlannedLetter {
  kind: LetterKind; title: string; addressee: string; signer: Signatory; ref: string; receiptNeeded: boolean; toConfirm: boolean;
}

/** Which letters a case gets (mirrors public.draft_letters). */
export function planLetters(c: {
  type: CaseType; funding?: Funding | null; employerName?: string | null; employerCadre?: Cadre | null; employerHead?: string | null;
  receivingDoctor?: string | null; minuteNo?: string | null;
}, settings: { retirementAddressee?: string; opmAddressee?: string } = {}): PlannedLetter[] {
  if (c.type === "retirement") {
    const police = c.employerCadre === "police";
    const addressee = police ? "The Inspector General of Police"
      : c.employerHead || (settings.retirementAddressee ?? "The Head, {employer}").replace("{employer}", c.employerName ?? "employer");
    return [{ kind: "retire", title: "Retirement on medical grounds", addressee, signer: "dghs", ref: "ADM 85/265/01", receiptNeeded: true,
      toConfirm: !police && !c.employerHead }];
  }
  const intro: PlannedLetter = { kind: "intro", title: "Letter introducing the patient", addressee: c.receivingDoctor || "The receiving doctor",
    signer: "dghs", ref: "ADM 85/265/01", receiptNeeded: true, toConfirm: false };
  if (!c.funding || c.funding === "family") return [intro];
  const funder = c.funding === "judiciary" ? "The Chief Justice" : c.funding === "parliament" ? "The Clerk to Parliament"
    : settings.opmAddressee ?? "The Permanent Secretary, Office of the Prime Minister";
  return [
    { kind: "funder", title: "Permission to travel and buy foreign exchange", addressee: funder, signer: "minister", ref: "ADM 85/124/01",
      receiptNeeded: true, toConfirm: c.funding === "government" },
    { kind: "extract", title: "Minutes extract", addressee: "Enclosed with the Minister's letter", signer: "board", ref: `Minute ${c.minuteNo ?? ""}`,
      receiptNeeded: false, toConfirm: false },
    intro,
  ];
}

export interface Criterion { key: string; label: string; ok: boolean; note: string }

/** Mirrors public.case_criteria for previews and tests. */
export function criteria(input: {
  docs: { name: string; status: "received" | "not_brought" | "not_applicable"; pages: number; ruleStatus?: string | null }[];
  fields: { confirmed: boolean }[]; openFlags: number; openBlockingFindings: number; hold: boolean; holdReason?: string | null;
}): Criterion[] {
  const blocking = input.docs.filter((d) => d.status === "not_brought" && (d.ruleStatus == null || d.ruleStatus === "confirmed"));
  const advisory = input.docs.filter((d) => d.status === "not_brought" && d.ruleStatus != null && d.ruleStatus !== "confirmed");
  const unscanned = input.docs.filter((d) => d.status === "received" && d.pages === 0);
  const unconfirmed = input.fields.filter((f) => !f.confirmed).length;
  return [
    { key: "docs", label: "Required documents received", ok: blocking.length === 0,
      note: (blocking.length ? "Missing: " + blocking.map((d) => d.name).join(", ") : "All received")
        + (advisory.length ? ". Advisory (rule not yet confirmed): " + advisory.map((d) => d.name).join(", ") : "") },
    { key: "scans", label: "Received documents scanned", ok: unscanned.length === 0,
      note: unscanned.length ? "Not scanned: " + unscanned.map((d) => d.name).join(", ") : "All scanned" },
    { key: "fields", label: "Fields confirmed", ok: input.fields.length > 0 && unconfirmed === 0,
      note: input.fields.length === 0 ? "No fields read from the scans yet" : `${unconfirmed} of ${input.fields.length} still to confirm` },
    { key: "flags", label: "Flags resolved", ok: input.openFlags === 0, note: `${input.openFlags} open` },
    { key: "findings", label: "Blocking findings resolved", ok: input.openBlockingFindings === 0, note: `${input.openBlockingFindings} open` },
    { key: "hold", label: "Not on hold", ok: !input.hold, note: input.hold ? input.holdReason ?? "On hold" : "Not on hold" },
  ];
}

export function daysIn(since: string | Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000));
}
export function daysTone(days: number, amber = 7, red = 14): Tone {
  return days > red ? "red" : days > amber ? "amber" : "grey";
}
export const daysLabel = (d: number) => (d === 0 ? "Today" : d === 1 ? "1 day in stage" : `${d} days in stage`);

const ORD = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const toDate = (d: string | Date) => (typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00Z" : d) : d);
/** 13th November, 2026 (letter style) */
export function letterDate(d: string | Date): string {
  const x = toDate(d);
  return `${x.getUTCDate()}${ORD(x.getUTCDate())} ${MONTHS[x.getUTCMonth()]}, ${x.getUTCFullYear()}`;
}
/** Thursday 10 December 2026 */
export function longDate(d: string | Date): string {
  const x = toDate(d);
  return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}
/** 10 Dec 2026 */
export function shortDate(d: string | Date): string {
  const x = toDate(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()].slice(0, 3)} ${x.getUTCFullYear()}`;
}
export function initials(name?: string | null): string {
  return (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

/** Words for an amount, e.g. 18000 -> "eighteen thousand". Used to fill cost in words. */
export function numberToWords(n: number): string {
  const a = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
    "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const t = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const under1000 = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    const rest = r < 20 ? (r ? a[r] : "") : t[Math.floor(r / 10)] + (r % 10 ? "-" + a[r % 10] : "");
    return [h ? a[h] + " hundred" : "", rest].filter(Boolean).join(" and ");
  };
  if (n === 0) return "zero";
  const parts: string[] = [];
  for (const [v, w] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]] as const) {
    if (n >= v) { parts.push(under1000(Math.floor(n / v)) + " " + w); n %= v; }
  }
  if (n) parts.push(under1000(n));
  return parts.join(" ");
}
