import { FUNDING_LABEL, type CaseType, type Funding } from "./domain";
export const typeLabel = (t: CaseType) => (t === "retirement" ? "Retirement" : "Referral abroad");
export function payerLabel(c: { type: CaseType; funding: Funding | null; employer: { name: string } | null }) {
  return c.type === "retirement" ? c.employer?.name ?? "Employer not set" : c.funding ? FUNDING_LABEL[c.funding] : "Funding not set";
}
