"use client";
import * as D from "@radix-ui/react-dialog";
import { STAGES, stageMeta, type Stage, type Tone } from "@/lib/domain";
import { cls } from "@/lib/util";

export function Pill({ tone = "grey", children, title, style }: { tone?: Tone; children: React.ReactNode; title?: string; style?: React.CSSProperties }) {
  return <span className={`pill p-${tone}`} title={title} style={style}><span className="dot" aria-hidden />{children}</span>;
}

export function StagePill({ stage }: { stage: Stage }) {
  const m = stageMeta(stage);
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

export function StageProgress({ stage }: { stage: Stage }) {
  const i = STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }} aria-label={`Case progress: stage ${i + 1} of ${STAGES.length}, ${STAGES[i]!.label}`} role="img">
        {STAGES.map((s, k) => (
          <div key={s.key} style={{ flex: "1 1 60px", display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="bar" style={{ background: k < i ? "#266DF0" : k === i ? "#1D1E20" : "#E4E4E8" }} />
            <span className="t12" style={{ color: k === i ? "#1D1E20" : "#5F6167", fontWeight: k === i ? 600 : 400 }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="h1">{title}</h1>
        {sub && <p className="muted" style={{ maxWidth: 760 }}>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Table({ cols, head, children, empty, minWidth }: { cols: string; head: string[]; children: React.ReactNode; empty?: string | false; minWidth?: number }) {
  return (
    <div className="tblwrap">
      <div className="tbl" style={{ minWidth: minWidth ?? 640 }} role="table">
        <div className="th" style={{ gridTemplateColumns: cols }} role="row">{head.map((h) => <span key={h} role="columnheader">{h}</span>)}</div>
        {children}
        {empty && <p className="muted" style={{ padding: 14 }}>{empty}</p>}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, sub, width = 520, children, footer }: {
  open: boolean; onClose: () => void; title: string; sub?: string; width?: number; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="overlay" />
        <D.Content className="dialog" style={{ maxWidth: width, position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 51, width: "calc(100% - 32px)" }}
          aria-describedby={undefined}>
          <div className="row" style={{ padding: "14px 16px", borderBottom: "1px solid #ECECEE", justifyContent: "space-between" }}>
            <div className="stack">
              <D.Title style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</D.Title>
              {sub && <span className="muted t12">{sub}</span>}
            </div>
            <D.Close className="btn sm ghost">Close</D.Close>
          </div>
          <div className="stack" style={{ padding: 16, gap: 12 }}>{children}</div>
          {footer && <div className="row noprint" style={{ padding: "12px 16px", borderTop: "1px solid #ECECEE", justifyContent: "flex-end" }}>{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { key: T; label: string; count?: number | string }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} style={{ borderBottom: "1px solid #ECECEE", display: "flex", flexWrap: "wrap" }}
      onKeyDown={(e) => {
        const i = tabs.findIndex((t) => t.key === value);
        if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length]!.key);
        if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length]!.key);
      }}>
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={t.key === value} tabIndex={t.key === value ? 0 : -1} className={cls("tab", t.key === value && "on")} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && t.count !== "" ? <span className="muted"> {t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ ini }: { ini: string }) {
  return <span className="av" aria-hidden>{ini}</span>;
}

export function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return <label className="fieldlabel" style={style}>{label}{children}</label>;
}
