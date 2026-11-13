"use client";
import { useState } from "react";
import { PageHead, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";

type S = { key: string; value: unknown; label: string; to_confirm: boolean };
export function SettingsView({ settings, aiEnv, smsProvider, aiCalls }: { settings: S[]; aiEnv: boolean; smsProvider: string; aiCalls: { id: string; model: string; status: string; created_at: string; pages: number[] }[] }) {
  const { run } = useToast();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(settings.map((s) => [s.key, typeof s.value === "string" ? s.value : JSON.stringify(s.value)])));
  async function save(s: S, confirmFlag?: boolean) {
    let v: unknown = vals[s.key];
    if (typeof s.value !== "string") { try { v = JSON.parse(vals[s.key]!); } catch { v = vals[s.key]; } }
    await run("update_setting", { p_key: s.key, p_value: v, p_to_confirm: confirmFlag ?? null }, "Setting saved");
  }
  const ai = settings.find((s) => s.key === "ai_reading_acknowledged");
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Settings" sub={'Values marked "to confirm" are open questions for the Ministry. Change them here once agreed, then clear the badge.'} />
      <div className="row" style={{ gap: 6 }}>
        <Pill tone={smsProvider === "mock" ? "amber" : "green"}>SMS provider: {smsProvider === "mock" ? "mock (console only; no SMS is delivered)" : smsProvider}</Pill>
        <Pill tone={aiEnv ? "amber" : "grey"}>AI reading: {aiEnv ? "enabled on the server" : "off"}</Pill>
      </div>
      <div className="warnbox stack" style={{ gap: 6 }}>
        <b>AI reading of scans sends page images to an external processor (Anthropic).</b>
        <span>Health data is special personal data under the Data Protection and Privacy Act, 2019. Do not enable this until the Ministry has approved the processor: registration with the Personal Data Protection Office, the data protection officer&apos;s review, and hosting approval (see docs/DATA_PROTECTION.md). It also needs AI_READING_ENABLED=true on the server.</span>
        {ai && <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 16, height: 16 }} checked={ai.value === true}
          onChange={(e) => run("update_setting", { p_key: ai.key, p_value: e.target.checked, p_to_confirm: !e.target.checked }, e.target.checked ? "Approval recorded" : "Approval withdrawn")} />
          The Ministry has approved sending scans to this processor (recorded in the audit log)</label>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {settings.filter((s) => s.key !== "ai_reading_acknowledged").map((s) => (
          <div key={s.key} className="panel row" style={{ alignItems: "flex-end", padding: 12 }}>
            <label className="fieldlabel" style={{ flex: "1 1 320px" }}>
              <span className="row" style={{ gap: 6 }}>{s.label}{s.to_confirm && <Pill tone="amber">To confirm</Pill>}</span>
              <input value={vals[s.key]} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} />
            </label>
            <button className="btn" onClick={() => save(s)}>Save</button>
            {s.to_confirm && <button className="btn" onClick={() => save(s, false)}>Save and mark confirmed</button>}
          </div>
        ))}
      </div>
      {aiCalls.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h2 className="h2">AI reading log</h2>
          {aiCalls.map((c) => <span key={c.id} className="t12">{new Date(c.created_at).toLocaleString("en-GB")} · {c.model} · pages {c.pages.join(", ")} · {c.status}</span>)}
        </div>
      )}
    </div>
  );
}
