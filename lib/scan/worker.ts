"use client";
import type { Corners } from "./quality";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }; // eslint-disable-line @typescript-eslint/no-explicit-any
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
let available: boolean | null = null;

function get(): Worker {
  if (worker) return worker;
  worker = new Worker("/scan-worker.js");
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id); if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data);
  };
  return worker;
}
function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => { pending.set(id, { resolve, reject }); get().postMessage({ ...msg, id }, transfer); });
}

/** Loads OpenCV lazily. Resolves false when it cannot load (scanning still works without auto-crop). */
export async function edgeDetectionReady(): Promise<boolean> {
  if (available !== null) return available;
  try { await call({ op: "load" }); available = true; } catch { available = false; }
  return available;
}
export async function detectCorners(img: ImageData): Promise<Corners | null> {
  if (!(await edgeDetectionReady())) return null;
  try { return (await call<{ corners: Corners | null }>({ op: "detect", img })).corners; } catch { return null; }
}
export async function warpPage(img: ImageData, corners: Corners): Promise<ImageData> {
  return (await call<{ img: ImageData }>({ op: "warp", img, corners })).img;
}
