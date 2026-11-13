"use client";
import { useCallback, useState } from "react";
import { Modal } from "./ui";

type Ask = { title: string; label: string; sub?: string; placeholder?: string; confirm?: string; multiline?: boolean; required?: boolean; initial?: string };

/** Accessible replacement for window.prompt: `const [ask, node] = usePrompt(); const v = await ask({...})`. */
export function usePrompt(): [(a: Ask) => Promise<string | null>, React.ReactNode] {
  const [state, setState] = useState<(Ask & { resolve: (v: string | null) => void }) | null>(null);
  const [value, setValue] = useState("");
  const ask = useCallback((a: Ask) => new Promise<string | null>((resolve) => { setValue(a.initial ?? ""); setState({ ...a, resolve }); }), []);
  const close = (v: string | null) => { state?.resolve(v); setState(null); };
  const ok = !(state?.required ?? true) || value.trim().length > 0;
  const node = state ? (
    <Modal open onClose={() => close(null)} title={state.title} sub={state.sub} width={480}
      footer={<><button className="btn" onClick={() => close(null)}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => close(value.trim())}>{state.confirm ?? "Save"}</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) close(value.trim()); }}>
        <label className="fieldlabel">{state.label}
          {state.multiline ? <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder={state.placeholder} autoFocus />
            : <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={state.placeholder} autoFocus />}
        </label>
      </form>
    </Modal>
  ) : null;
  return [ask, node];
}
