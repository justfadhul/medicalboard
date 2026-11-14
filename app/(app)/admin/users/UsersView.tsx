"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABEL, shortDate, type Role } from "@/lib/domain";
import { Field, PageHead, Pill, Table } from "@/components/ui";
import { useToast } from "@/components/Toast";

type U = { id: string; email: string; full_name: string; role: Role | null; active: boolean; created_at: string; password_set: boolean };
const COLS = "minmax(220px,2fr) minmax(200px,1.4fr) 110px 150px 100px 230px";
const ROLES = Object.keys(ROLE_LABEL) as Role[];

export function UsersView({ users, me }: { users: U[]; me: string }) {
  const { run, toast } = useToast();
  const router = useRouter();
  const [inv, setInv] = useState({ email: "", name: "", role: "registry" as Role });
  const [busy, setBusy] = useState(false);
  async function invite(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const r = await fetch("/api/admin/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(inv) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) return toast(j.error ?? "Could not add the user", { tone: "error" });
    toast(`${inv.email} added. They open the login page, choose “First time? Create your password”, and sign in. No email is sent.`); setInv({ email: "", name: "", role: "registry" }); router.refresh();
  }
  async function resetPw(u: U) {
    if (!window.confirm(`Reset the password for ${u.email}? Their current password stops working; they create a new one on the login page.`)) return;
    const r = await fetch("/api/admin/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: u.id }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) toast(j.error ?? "Reset failed", { tone: "error" }); else { toast(`Password reset. Ask ${u.email} to choose “First time? Create your password” on the login page now.`); router.refresh(); }
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Users and roles" sub="Add colleagues and assign their role. No email is sent: each person opens the login page, chooses “First time? Create your password”, and then signs in with their email and password. Until someone has created their password, anyone who knows their email could create it first, so ask new users to do it straight away." />
      <form onSubmit={invite} className="panel row" style={{ alignItems: "flex-end" }}>
        <Field label="Work email" style={{ flex: "1 1 220px" }}><input type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
        <Field label="Full name" style={{ flex: "1 1 200px" }}><input required value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></Field>
        <Field label="Role" style={{ flex: "0 1 220px" }}><select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
        <button className="btn primary" disabled={busy}>{busy ? "Adding…" : "Add user"}</button>
      </form>
      <Table cols={COLS} head={["Person", "Role", "Status", "Password", "Since", ""]} minWidth={980}>
        {users.map((u) => (
          <div key={u.id} className="tr" style={{ gridTemplateColumns: COLS }} role="row">
            <span className="stack"><b>{u.full_name || "—"}</b><span className="muted t12">{u.email}</span></span>
            <select aria-label={`Role of ${u.email}`} value={u.role ?? ""} disabled={u.id === me}
              onChange={(e) => run("set_user_role", { p_user: u.id, p_role: e.target.value, p_active: u.active }, "Role updated")}>
              {!u.role && <option value="">No role</option>}{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            {u.active ? <Pill tone="green">Active</Pill> : <Pill tone="red">Deactivated</Pill>}
            {u.password_set ? <Pill tone="green">Created</Pill> : <Pill tone="amber">Not yet created</Pill>}
            <span className="t12">{shortDate(u.created_at)}</span>
            <span className="row" style={{ gap: 4 }}>
              {u.id !== me && u.role ? <button className="btn sm" onClick={() => run("set_user_role", { p_user: u.id, p_role: u.role, p_active: !u.active }, u.active ? "User deactivated" : "User reactivated")}>{u.active ? "Deactivate" : "Reactivate"}</button> : null}
              {u.password_set && <button className="btn sm" onClick={() => resetPw(u)}>Reset password</button>}
            </span>
          </div>
        ))}
      </Table>
    </div>
  );
}
