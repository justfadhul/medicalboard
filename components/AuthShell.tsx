export function AuthShell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#FAFAFB" }}>
      <div className="panel stack" style={{ width: "100%", maxWidth: 420, gap: 16, padding: 24 }}>
        <div className="row" style={{ gap: 9 }}>
          <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, background: "#1D1E20", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700 }}>UMB</span>
          <div className="stack" style={{ lineHeight: 1.25 }}>
            <span style={{ fontWeight: 600 }}>Uganda Medical Board</span>
            <span className="muted t12">Ministry of Health · Case system</span>
          </div>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="h1">{title}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}
