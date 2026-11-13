"use client";
import Script from "next/script";
import { useState } from "react";

declare global { interface Window { turnstile?: { reset: () => void } } }

export function ConfirmForm({ code, siteKey }: { code: string; siteKey: string }) {
  const [v, setV] = useState({ name: "", designation: "" });
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(""); setState("busy");
    const token = new FormData(e.currentTarget).get("cf-turnstile-response");
    const r = await fetch("/api/verify/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, ...v, token }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setState("done"); else { setErr(j.error ?? "Could not confirm"); setState("idle"); window.turnstile?.reset(); }
  }
  if (state === "done") return <p className="okbox" role="status">Receipt confirmed. Thank you. The Uganda Medical Board has been notified.</p>;
  return (
    <form onSubmit={submit} className="stack" style={{ gap: 10 }}>
      {siteKey && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />}
      <label className="fieldlabel">Received by (name)<input required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Full name" autoComplete="name" /></label>
      <label className="fieldlabel">Designation and office<input required value={v.designation} onChange={(e) => setV({ ...v, designation: e.target.value })} placeholder="e.g. Records Officer" /></label>
      {siteKey && <div className="cf-turnstile" data-sitekey={siteKey} />}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn primary" disabled={state === "busy"}>{state === "busy" ? "Confirming…" : "Confirm receipt"}</button>
      <p className="muted t12">This page shows no patient information. Your name and designation are recorded with the receipt.</p>
    </form>
  );
}
