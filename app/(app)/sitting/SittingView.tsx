"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { daysIn, longDate, minuteNumber } from "@/lib/domain";
import { payerLabel, typeLabel } from "@/lib/labels";
import { Field, PageHead, Pill, Table } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useState } from "react";

type S = { id: string; sitting_date: string; venue: string; cutoff_date: string; held: boolean; attendance: string | null };
type C = { id: string; case_no: string; name: string; type: "retirement" | "referral"; funding: null; stage: string; decision: string | null; minute_no: string | null; agenda_serial: number | null; employer: { name: string } | null };
const COLS = "50px minmax(200px,2fr) minmax(170px,1fr) minmax(240px,1.6fr)";

export function SittingView({ sitting: s, sittings, cases, atRisk }: { sitting: S; sittings: S[]; cases: C[]; atRisk: number }) {
  const { run } = useToast();
  const router = useRouter();
  const [venue, setVenue] = useState(s.venue);
  const [att, setAtt] = useState(s.attendance ?? "");
  const agenda = cases.filter((c) => c.stage === "ready");
  const decided = cases.filter((c) => c.decision);
  const daysLeft = -daysIn(s.cutoff_date + "T00:00:00");
  const decide = (c: C, d: string, label: string) => run("enter_decision", { p_case: c.id, p_decision: d }, `${c.name}: ${label} (${minuteNumber(s.sitting_date, c.agenda_serial ?? 0)})`, { undo: true });
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title={`Board sitting · ${longDate(s.sitting_date)}`} sub="The Board sits every second Thursday. After the sitting, the Secretariat enters the Board's decision on each case."
        actions={<>
          <select aria-label="Choose a sitting" value={s.id} onChange={(e) => router.push(`/sitting?id=${e.target.value}`)} style={{ maxWidth: 230 }}>
            {sittings.map((x) => <option key={x.id} value={x.id}>{longDate(x.sitting_date)}{x.held ? " (held)" : ""}</option>)}
          </select>
          {s.held ? <button className="btn" onClick={() => run("set_sitting_held", { p_sitting: s.id, p_held: false }, "Sitting reopened")}>Reopen sitting</button>
            : <button className="btn primary" onClick={() => run("set_sitting_held", { p_sitting: s.id, p_held: true }, "Sitting held: decisions are open")}>Sitting held: enter decisions</button>}
        </>} />
      <div className="row" style={{ gap: 8 }}>
        {s.held ? <Pill tone="green">Sitting held · decisions open</Pill> : <Pill tone={daysLeft < 0 ? "red" : daysLeft <= 3 ? "amber" : "blue"}>Agenda closes {longDate(s.cutoff_date)} · {daysLeft < 0 ? "closed" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}</Pill>}
        {!s.held && atRisk > 0 && <span className="muted t12">{atRisk} case(s) still in intake or review must meet every criterion by the cut-off to make this sitting. The cut-off is a setting (default 7 days; to be agreed).</span>}
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <Field label="Venue" style={{ flex: "1 1 320px" }}><input value={venue} onChange={(e) => setVenue(e.target.value)} /></Field>
        <Field label="Attendance (from the register, one per line)" style={{ flex: "1 1 320px" }}><textarea rows={2} value={att} onChange={(e) => setAtt(e.target.value)} /></Field>
        <button className="btn" onClick={() => run("update_sitting", { p_sitting: s.id, p_venue: venue, p_attendance: att }, "Sitting details saved")}>Save</button>
      </div>
      <h2 className="h2">Agenda ({agenda.length})</h2>
      <Table cols={COLS} head={["S/N", "Case", "Minute", "Board decision"]} empty={!agenda.length && "No cases on the agenda yet."}>
        {agenda.map((c) => (
          <div key={c.id} className="tr" style={{ gridTemplateColumns: COLS }} role="row">
            <b>{c.agenda_serial}</b>
            <span className="stack"><Link href={`/cases/${c.id}`} style={{ fontWeight: 600, textDecoration: "none" }}>{c.name}</Link><span className="muted t12">{typeLabel(c.type)} · {payerLabel(c)}</span></span>
            <span className="t12">{minuteNumber(s.sitting_date, c.agenda_serial ?? 0)}</span>
            {s.held ? (
              <span className="row" style={{ gap: 4 }}>
                <button className="btn sm" onClick={() => decide(c, "approved", "approved")}>Approve</button>
                <button className="btn sm" onClick={() => decide(c, "deferred", "deferred, back to review")}>Defer</button>
                <button className="btn sm" onClick={() => decide(c, "not_approved", "not approved, closed")}>Not approved</button>
              </span>
            ) : <span className="muted t12">Opens after the sitting</span>}
          </div>
        ))}
      </Table>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="h2">Decided at this sitting ({decided.length})</h2>
        {cases.length > 0 && <a className="btn sm primary" href={`/api/minutes/${s.id}`}>Draft minutes (.docx)</a>}
      </div>
      <Table cols="minmax(200px,2fr) minmax(160px,1fr) minmax(140px,1fr)" head={["Case", "Minute", "Decision"]} empty={!decided.length && "No decisions entered yet."}>
        {decided.map((c) => (
          <Link key={c.id} href={`/cases/${c.id}`} className="tr" style={{ gridTemplateColumns: "minmax(200px,2fr) minmax(160px,1fr) minmax(140px,1fr)", textDecoration: "none" }}>
            <span style={{ fontWeight: 600 }}>{c.name}</span><span className="t12">{c.minute_no}</span>
            <Pill tone={c.decision === "approved" ? "green" : c.decision === "deferred" ? "amber" : "red"}>{c.decision === "approved" ? "Approved" : c.decision === "deferred" ? "Deferred" : "Not approved"}</Pill>
          </Link>
        ))}
      </Table>
    </div>
  );
}
