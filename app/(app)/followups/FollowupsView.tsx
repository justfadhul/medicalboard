"use client";
import Link from "next/link";
import { daysIn, shortDate } from "@/lib/domain";
import { typeLabel } from "@/lib/labels";
import { PageHead, Pill, Table } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { usePrompt } from "@/components/Prompt";

type H = { id: string; case_no: string; name: string; type: "retirement" | "referral"; hold_reason: string; stage_entered_at: string };
type R = { id: string; case_no: string; name: string; country: string; procedure: string; returned_on: string | null; report_due: string | null };
const RC = "minmax(200px,2fr) 130px 130px 130px minmax(220px,1.4fr)";

export function FollowupsView({ held, reports }: { held: H[]; reports: R[] }) {
  const { run } = useToast();
  const [ask, node] = usePrompt();
  async function returned(r: R) {
    const d = await ask({ title: "Record return from treatment", label: "Date the patient returned (YYYY-MM-DD)", initial: new Date().toISOString().slice(0, 10), confirm: "Save" });
    if (d) await run("set_treatment_return", { p_case: r.id, p_returned: d }, "Return recorded; the treatment report is now due");
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Follow-ups" sub="Cases waiting on something outside the Board, and treatment reports due from patients who have returned." />
      <h2 className="h2">On hold ({held.length})</h2>
      <Table cols="minmax(200px,2fr) minmax(240px,2fr) 110px 200px" head={["Case", "Reason", "Held for", ""]} empty={!held.length && "No cases on hold."}>
        {held.map((c) => (
          <div key={c.id} className="tr" style={{ gridTemplateColumns: "minmax(200px,2fr) minmax(240px,2fr) 110px 200px" }} role="row">
            <span className="stack"><b>{c.name}</b><span className="muted t12">{c.case_no} · {typeLabel(c.type)}</span></span>
            <span>{c.hold_reason}</span>
            <Pill tone={daysIn(c.stage_entered_at) > 14 ? "red" : "amber"}>{daysIn(c.stage_entered_at)} days</Pill>
            <span className="row" style={{ gap: 4 }}><Link className="btn sm" href={`/cases/${c.id}`}>Open</Link>
              <button className="btn sm" onClick={() => run("set_hold", { p_case: c.id, p_hold: false }, "Hold released")}>Release hold</button></span>
          </div>
        ))}
      </Table>
      <h2 className="h2">Treatment reports due</h2>
      <Table cols={RC} head={["Patient", "Returned", "Report due", "Status", ""]} empty={!reports.length && "No treatment reports outstanding."} minWidth={760}>
        {reports.map((r) => {
          const overdue = r.report_due && r.report_due < new Date().toISOString().slice(0, 10);
          return (
            <div key={r.id} className="tr" style={{ gridTemplateColumns: RC }} role="row">
              <span className="stack"><b>{r.name}</b><span className="muted t12">{r.procedure} · {r.country}</span></span>
              <span>{r.returned_on ? shortDate(r.returned_on) : "Not yet"}</span>
              <span>{r.report_due ? shortDate(r.report_due) : "—"}</span>
              {r.returned_on ? <Pill tone={overdue ? "red" : "amber"}>{overdue ? "Overdue" : "Due"}</Pill> : <Pill>Abroad</Pill>}
              <span className="row" style={{ gap: 4 }}>
                {!r.returned_on && <button className="btn sm" onClick={() => returned(r)}>Record return</button>}
                <button className="btn sm" onClick={() => run("set_treatment_return", { p_case: r.id, p_returned: r.returned_on, p_report_received: true }, "Treatment report marked received")}>Mark received</button>
              </span>
            </div>
          );
        })}
      </Table>
      {node}
    </div>
  );
}
