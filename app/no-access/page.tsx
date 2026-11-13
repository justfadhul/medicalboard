import { AuthShell } from "@/components/AuthShell";

export default function NoAccess() {
  return (
    <AuthShell title="No access yet" sub="Your account has no role, or it has been deactivated. Ask the system administrator to assign your role.">
      <form action="/auth/signout" method="post"><button className="btn">Sign out</button></form>
    </AuthShell>
  );
}
