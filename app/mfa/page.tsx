"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthShell } from "@/components/AuthShell";

type Enroll = { factorId: string; qr: string; secret: string };

export default function Mfa() {
  const sb = supabaseBrowser();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") return go();
      const { data } = await sb.auth.mfa.listFactors();
      const verified = data?.totp?.find((f) => f.status === "verified");
      if (verified) return setFactorId(verified.id);
      for (const f of data?.all ?? []) if (f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data: e, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator " + new Date().toISOString().slice(0, 10) });
      if (error) return setErr(error.message);
      setEnroll({ factorId: e.id, qr: e.totp.qr_code, secret: e.totp.secret });
      setFactorId(e.id);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function go() {
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true); setErr("");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) setErr("That code did not work. Check the time on your phone and try the newest code."); else go();
  }

  return (
    <AuthShell title={enroll ? "Set up two-step verification" : "Two-step verification"}
      sub={enroll ? "Every account uses an authenticator app (Google Authenticator, Microsoft Authenticator or similar). Scan the code, then enter the six digits it shows."
        : "Enter the six-digit code from your authenticator app."}>
      {enroll && (
        <div className="stack" style={{ gap: 8, alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="QR code to add this account to your authenticator app" width={180} height={180} />
          <p className="muted t12">Can&apos;t scan? Enter this key: <code style={{ userSelect: "all" }}>{enroll.secret}</code></p>
        </div>
      )}
      <form onSubmit={verify} className="stack" style={{ gap: 12 }}>
        <label className="fieldlabel">Six-digit code
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy || !factorId}>{busy ? "Checking…" : "Verify"}</button>
      </form>
      <form action="/auth/signout" method="post"><button className="btn ghost sm">Sign out</button></form>
    </AuthShell>
  );
}
