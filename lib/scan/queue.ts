"use client";
// Resilient upload queue: pages are written to IndexedDB first, then uploaded with retries,
// so a weak connection never loses a scan. Survives page reloads.
import { supabaseBrowser } from "@/lib/supabase/client";

export type QueuedPage = {
  id: string; caseId: string; documentId: string; blob: Blob; width: number; height: number;
  score: number; quality: Record<string, unknown>; keepReason?: string | null; attempts: number; error?: string; ext: string; added: number;
};
type Listener = (s: { pending: number; uploading: string | null; done: number; failed: number; lastError?: string }) => void;

const DB = "umb-scan-queue", STORE = "pages";
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode); const req = fn(t.objectStore(STORE));
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}
const all = () => tx<QueuedPage[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedPage[]>);
const put = (p: QueuedPage) => tx("readwrite", (s) => s.put(p));
const del = (id: string) => tx("readwrite", (s) => s.delete(id));

const listeners = new Set<Listener>();
let running = false, done = 0, failed = 0, uploading: string | null = null, lastError: string | undefined;
const finishedDocs = new Set<string>();

async function emit() {
  const pending = (await all()).length;
  listeners.forEach((l) => l({ pending, uploading, done, failed, lastError }));
}
export function onQueue(l: Listener) { listeners.add(l); emit(); return () => { listeners.delete(l); }; }

export async function enqueue(pages: Omit<QueuedPage, "attempts" | "added" | "id">[]) {
  const base = Date.now();
  for (const [i, p] of pages.entries()) await put({ ...p, id: crypto.randomUUID(), attempts: 0, added: base + i });
  await emit();
  void drain();
}

/** Upload everything in order of capture; retry with backoff. */
export async function drain(): Promise<void> {
  if (running || typeof indexedDB === "undefined") return;
  running = true;
  try {
    for (;;) {
      const queue = (await all()).sort((a, b) => a.added - b.added);
      const next = queue.find((p) => p.attempts < 8);
      if (!next) break;
      if (typeof navigator !== "undefined" && !navigator.onLine) { await sleep(3000); continue; }
      uploading = next.id; await emit();
      try {
        await uploadOne(next);
        await del(next.id); done++; lastError = undefined;
        finishedDocs.add(next.documentId);
        if (!(await all()).some((p) => p.documentId === next.documentId)) void assemble(next.documentId);
      } catch (e) {
        next.attempts++; next.error = (e as Error).message; lastError = next.error;
        if (next.attempts >= 8) failed++;
        await put(next);
        await sleep(Math.min(30_000, 1000 * 2 ** next.attempts));
      }
      uploading = null; await emit();
    }
  } finally { running = false; uploading = null; await emit(); }
}

async function uploadOne(p: QueuedPage) {
  const sb = supabaseBrowser();
  const path = `${p.caseId}/${p.documentId}/${p.id}.${p.ext}`;
  const up = await sb.storage.from("scans").upload(path, p.blob, { contentType: p.blob.type, upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(up.error.message);
  const { error } = await sb.rpc("add_page", { p_doc: p.documentId, p_path: path, p_width: p.width, p_height: p.height, p_score: p.score,
    p_quality: p.quality, p_keep_reason: p.keepReason ?? null });
  if (error) throw new Error(error.message);
}

/** Rebuild the combined PDF for a document (server side, pdf-lib). */
export async function assemble(documentId: string) {
  try { await fetch("/api/scan/assemble", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId }) }); } catch { /* retried on next save */ }
}

export async function retryFailed() {
  for (const p of await all()) if (p.attempts >= 8) await put({ ...p, attempts: 0 });
  failed = 0; void drain();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void drain());
  setTimeout(() => void drain(), 1500);
}
