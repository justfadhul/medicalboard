"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABEL, shortDate, type Role } from "@/lib/domain";
import { Field, PageHead, Pill, Table } from "@/components/ui";
import { useToast } from "@/components/Toast";

type U = { id: string; email: string; full_name: string; role: Role | null; active: boolean; created_at: string };
const COLS = "minmax(220px,2fr) minmax(200px,1.4fr) 110px 100px 120px";
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
    if (!r.ok) return toast(j.error ?? "Invite failed", { tone: "error" });
    toast(`Invitation sent to ${inv.email}. They set up two-step verification on first sign-in.`); setInv({ email: "", name: "", role: "registry" }); router.refresh();
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <PageHead title="Users and roles" sub="Invite colleagues and assign their role. Everyone signs in with an emailed link and an authenticator app (two-step verification is required for every role)." />
      <form onSubmit={invite} className="panel row" style={{ alignItems: "flex-end" }}>
        <Field label="Work email" style={{ flex: "1 1 220px" }}><input type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
        <Field label="Full name" style={{ flex: "1 1 200px" }}><input required value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></Field>
        <Field label="Role" style={{ flex: "0 1 220px" }}><select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
        <button className="btn primary" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</button>
      </form>
      <Table cols={COLS} head={["Person", "Role", "Status", "Since", ""]} minWidth={760}>
        {users.map((u) => (
          <div key={u.id} className="tr" style={{ gridTemplateColumns: COLS }} role="row">
            <span className="stack"><b>{u.full_name || "—"}</b><span className="muted t12">{u.email}</span></span>
            <select aria-label={`Role of ${u.email}`} value={u.role ?? ""} disabled={u.id === me}
              onChange={(e) => run("set_user_role", { p_user: u.id, p_role: e.target.value, p_active: u.active }, "Role updated")}>
              {!u.role && <option value="">No role</option>}{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            {u.active ? <Pill tone="green">Active</Pill> : <Pill tone="red">Deactivated</Pill>}
            <span className="t12">{shortDate(u.created_at)}</span>
            {u.id !== me && u.role ? <button className="btn sm" onClick={() => run("set_user_role", { p_user: u.id, p_role: u.role, p_active: !u.active }, u.active ? "User deactivated" : "User reactivated")}>{u.active ? "Deactivate" : "Reactivate"}</button> : <span />}
          </div>
        ))}
      </Table>
    </div>
  );
}
