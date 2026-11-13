"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthShell } from "@/components/AuthShell";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) { setState("error"); setMsg(error.message); } else setState("sent");
  }
  return (
    <AuthShell title="Sign in" sub="Enter your work email. We will send you a sign-in link. Accounts are created by the system administrator.">
      {state === "sent" ? (
        <p className="okbox" role="status">Check your email for the sign-in link. It expires in one hour.</p>
      ) : (
        <form onSubmit={submit} className="stack" style={{ gap: 12 }}>
          <label className="fieldlabel">Work email
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {state === "error" && <p className="err" role="alert">{msg}</p>}
          <button className="btn primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send sign-in link"}</button>
        </form>
      )}
    </AuthShell>
  );
}
