"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthShell } from "@/components/AuthShell";
import { safeNext } from "@/lib/util";

type Mode = "signin" | "create";

export default function Login() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function signIn() {
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(/invalid/i.test(error.message) ? "Email or password is wrong. First time here? Create your password below." : error.message);
    window.location.href = safeNext(new URLSearchParams(window.location.search).get("next"));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      if (mode === "create") {
        if (password.length < 10) throw new Error("Use at least 10 characters.");
        if (password !== confirm) throw new Error("The two passwords do not match.");
        const r = await fetch("/api/auth/create-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "Could not create the password");
      }
      await signIn();
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  const create = mode === "create";
  return (
    <AuthShell title={create ? "Create your password" : "Sign in"}
      sub={create ? "For your first sign-in. Your account must already have been set up by the system administrator." : "Use your work email and password. Accounts are set up by the system administrator."}>
      <form onSubmit={submit} className="stack" style={{ gap: 12 }}>
        <label className="fieldlabel">Work email
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="fieldlabel">{create ? "New password (at least 10 characters)" : "Password"}
          <input type="password" required minLength={create ? 10 : undefined} autoComplete={create ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {create && (
          <label className="fieldlabel">Type the password again
            <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
        )}
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "Please wait…" : create ? "Create password and sign in" : "Sign in"}</button>
      </form>
      <div className="stack" style={{ gap: 4 }}>
        {create
          ? <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => { setMode("signin"); setErr(""); }}>I already have a password: sign in</button>
          : <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => { setMode("create"); setErr(""); setConfirm(""); }}>First time? Create your password</button>}
        <span className="muted t12">Forgot your password? Ask the system administrator to reset it, then create a new one here.</span>
      </div>
    </AuthShell>
  );
}
