"use client";
import { useState } from "react";
import type { CaseFull, LetterFull } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errMsg } from "@/lib/util";
import { Field, Modal } from "@/components/ui";
import { useToast } from "@/components/Toast";

export function CollectionDialog({ c, letters, onClose }: { c: Pick<CaseFull, "id" | "name" | "sms_consent" | "phone">; letters: Pick<LetterFull, "id">[]; onClose: () => void }) {
  const { run } = useToast();
  const [sent, setSent] = useState<{ sent: boolean; phone?: string; reason?: string } | null>(null);
  const [v, setV] = useState({ name: "", relation: "", phone: "", code: "", id: false, override: "" });
  const [err, setErr] = useState("");
  async function send() {
    setErr("");
    const { data, error } = await supabaseBrowser().rpc("issue_collection_code", { p_case: c.id });
    if (error) return setErr(errMsg(error));
    setSent(data);
  }
  async function confirm() {
    setErr("");
    if (!v.id) return setErr("Check the collector's ID first.");
    const ok = await run("record_collection", { p_case: c.id, p_code: sent?.sent ? v.code.trim() : null, p_name: v.name, p_relationship: v.relation, p_phone: v.phone || null,
      p_id_checked: v.id, p_override_reason: sent?.sent ? null : v.override }, "Collection recorded", { undo: true });
    if (ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title="Record collection" sub={`${c.name} · ${letters.length} letter(s)`} width={480}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={confirm} disabled={!sent}>Confirm collection</button></>}>
      <Field label="Collected by"><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Full name" /></Field>
      <Field label="Relationship to the patient"><input value={v.relation} onChange={(e) => setV({ ...v, relation: e.target.value })} placeholder="e.g. Husband" /></Field>
      <Field label="Collector's phone number"><input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="07XX XXX XXX" inputMode="tel" /></Field>
      {!sent ? (
        <button className="btn" onClick={send}>Send one-time code by SMS</button>
      ) : sent.sent ? (
        <>
          <p className="infobox t12">A six-digit code was sent by SMS to {sent.phone}, the phone on file. Ask the collector to read it out. It expires in 15 minutes; 5 attempts.</p>
          <Field label="Collection code"><input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" autoComplete="one-time-code" placeholder="Six-digit code" /></Field>
          <button className="btn sm ghost" onClick={send} style={{ alignSelf: "flex-start" }}>Send a new code</button>
        </>
      ) : (
        <>
          <p className="warnbox t12">{sent.reason}</p>
          <Field label="Why the letters are released without a code"><input value={v.override} onChange={(e) => setV({ ...v, override: e.target.value })} placeholder="e.g. No SMS consent; national ID checked against the file" /></Field>
        </>
      )}
      <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 16, height: 16 }} checked={v.id} onChange={(e) => setV({ ...v, id: e.target.checked })} />I checked the collector&apos;s ID</label>
      {err && <p className="err" role="alert">{err}</p>}
    </Modal>
  );
}
