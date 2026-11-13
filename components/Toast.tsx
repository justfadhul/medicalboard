"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errMsg } from "@/lib/util";

type ToastT = { text: string; tone: "info" | "error"; undoId?: number | null };
type Ctx = {
  toast: (text: string, opts?: { undoId?: number | null; tone?: "info" | "error" }) => void;
  /** Run an RPC, show its outcome, refresh server data. Returns the data or undefined on error. */
  run: <T = unknown>(fn: string, args?: Record<string, unknown>, ok?: string | ((d: T) => string), opts?: { undo?: boolean }) => Promise<T | undefined>;
};
const C = createContext<Ctx>(null as unknown as Ctx);
export const useToast = () => useContext(C);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<ToastT | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();

  const toast = useCallback<Ctx["toast"]>((text, opts) => {
    clearTimeout(timer.current);
    setT({ text, tone: opts?.tone ?? "info", undoId: opts?.undoId });
    timer.current = setTimeout(() => setT((cur) => (cur?.undoId ? { ...cur, undoId: null } : null)), opts?.undoId ? 10_000 : 6_000);
  }, []);

  const run = useCallback<Ctx["run"]>(async (fn, args, ok, opts) => {
    const { data, error } = await supabaseBrowser().rpc(fn, args ?? {});
    if (error) { toast(errMsg(error), { tone: "error" }); return undefined; }
    if (opts?.undo && data === -1) { toast("Wrong code. Ask the collector to read it again.", { tone: "error" }); return undefined; }
    const text = typeof ok === "function" ? ok(data) : ok;
    if (text) toast(text, { undoId: opts?.undo && typeof data === "number" ? data : null });
    router.refresh();
    return data ?? (true as never);
  }, [router, toast]);

  async function undo() {
    if (!t?.undoId) return;
    const { error } = await supabaseBrowser().rpc("undo_event", { p_audit: t.undoId });
    if (error) toast(errMsg(error), { tone: "error" }); else { toast("Undone. Both entries stay in the activity log."); router.refresh(); }
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <C.Provider value={{ toast, run }}>
      {children}
      <div aria-live="polite" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 70, width: "min(560px, calc(100% - 32px))" }}>
        {t && (
          <div role="status" className={t.tone === "error" ? "err" : "infobox"} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", boxShadow: "0 8px 24px rgba(16,24,40,.15)" }}>
            <span style={{ fontWeight: 500 }}>{t.text}</span>
            <span className="row" style={{ gap: 6 }}>
              {t.undoId ? <button className="btn sm" onClick={undo}>Undo</button> : null}
              <button className="btn sm" onClick={() => setT(null)}>Dismiss</button>
            </span>
          </div>
        )}
      </div>
    </C.Provider>
  );
}
