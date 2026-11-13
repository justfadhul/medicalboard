"use client";
import { useRouter } from "next/navigation";
import { CADRE_LABEL, type Cadre } from "@/lib/domain";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHead, Pill, Table } from "@/components/ui";
import { useToast } from "@/components/Toast";

type Rule = { id: string; text: string; applies_to: string; status: string; limit_days: number | null };
const ST: Record<string, { label: string; tone: "green" | "amber" | "blue" | "grey" }> = {
  confirmed: { label: "Confirmed", tone: "green" }, to_confirm: { label: "To confirm", tone: "amber" }, limit_to_set: { label: "Limit to set", tone: "amber" },
  seen_in_past: { label: "Seen in past cases", tone: "blue" }, applied_in_practice: { label: "Applied in practice", tone: "blue" },
};
const COLS = "70px minmax(240px,3fr) 140px 190px";

export function RulebookView({ rules, maps }: { rules: Rule[]; maps: { id: string; name: string; scope: Cadre }[] }) {
  const { toast } = useToast();
  const router = useRouter();
  async function upd(id: string, patch: Partial<Rule>) {
    const { error } = await supabaseBrowser().from("rules").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast(error.message, { tone: "error" }); else { toast("Rule updated"); router.refresh(); }
  }
  async function remove(id: string) {
    const { error } = await supabaseBrowser().from("cadre_docs").delete().eq("id", id);
    if (error) toast(error.message, { tone: "error" }); else { toast("Mapping removed. Existing cases keep the document."); router.refresh(); }
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Rulebook" sub={'The criteria the review applies. Only confirmed rules block a case automatically; the others are shown as advisory. Rules marked "to confirm" need the Secretary\'s and the Chairperson\'s approval before they are enforced.'} />
      <Table cols={COLS} head={["ID", "Rule", "Applies to", "Status"]} minWidth={700}>
        {rules.map((r) => (
          <div key={r.id} className="tr" style={{ gridTemplateColumns: COLS }} role="row">
            <b>{r.id}</b>
            <span className="stack" style={{ gap: 4 }}>{r.text}
              {r.id === "R-04" && (
                <label className="row t12" style={{ gap: 6 }}>Report must be no older than
                  <input type="number" min={1} style={{ width: 80, height: 28 }} defaultValue={r.limit_days ?? ""} aria-label="Consultant report age limit in days"
                    onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; if (v !== r.limit_days) upd(r.id, { limit_days: v, status: v ? "confirmed" : "limit_to_set" }); }} /> days</label>
              )}
            </span>
            <span>{r.applies_to}</span>
            <span className="row" style={{ gap: 4 }}>
              <Pill tone={ST[r.status]?.tone ?? "grey"}>{ST[r.status]?.label ?? r.status}</Pill>
              <select aria-label={`Status of ${r.id}`} value={r.status} onChange={(e) => upd(r.id, { status: e.target.value })} style={{ height: 28, width: 120, fontSize: 12 }}>
                {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </span>
          </div>
        ))}
      </Table>
      <h2 className="h2">Documents by cadre</h2>
      <p className="muted t12">Added from the new case form with &quot;Applies to&quot; set to a cadre. Each joins the checklist of every new retirement case for that cadre. Cadre comes from the employer.</p>
      <Table cols="minmax(240px,2fr) 220px 100px" head={["Document", "Applies to", ""]} empty={!maps.length && "None added yet."}>
        {maps.map((m) => (
          <div key={m.id} className="tr" style={{ gridTemplateColumns: "minmax(240px,2fr) 220px 100px" }} role="row">
            <span>{m.name}</span><span>{CADRE_LABEL[m.scope]}</span><button className="btn sm" onClick={() => remove(m.id)}>Remove</button>
          </div>
        ))}
      </Table>
    </div>
  );
}
