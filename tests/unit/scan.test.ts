import { describe, expect, it } from "vitest";
import { laplacianVariance, meanStd, touchesFrame, cornerShift } from "@/lib/scan/quality";
import { dispatchOutbox, toE164 } from "@/lib/sms";

function img(w: number, h: number, f: (x: number, y: number) => number) {
  const g = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = f(x, y); return g;
}
describe("scan quality checks", () => {
  it("sharp text scores higher than a blurred page", () => {
    const sharp = img(200, 200, (x, y) => ((x >> 2) + (y >> 3)) % 2 ? 20 : 235);
    const flat = img(200, 200, (x) => 120 + x * 0.1);
    expect(laplacianVariance(sharp, 200, 200)).toBeGreaterThan(1000);
    expect(laplacianVariance(flat, 200, 200)).toBeLessThan(5);
  });
  it("brightness", () => { expect(meanStd(img(10, 10, () => 30)).mean).toBe(30); });
  it("page cut off when corners touch the frame", () => {
    expect(touchesFrame([[0, 10], [500, 10], [500, 700], [10, 700]], 1000, 800)).toBe(true);
    expect(touchesFrame([[100, 100], [900, 100], [900, 700], [100, 700]], 1000, 800)).toBe(false);
  });
  it("steadiness", () => {
    const a: [number, number][] = [[100, 100], [900, 100], [900, 700], [100, 700]];
    expect(cornerShift(a, a.map(([x, y]) => [x + 2, y] as [number, number]), 1000)).toBeLessThan(0.01);
    expect(cornerShift(null, a, 1000)).toBe(Infinity);
  });
});

describe("SMS", () => {
  it("normalises Ugandan numbers", () => {
    expect(toE164("0772 123 456")).toBe("+256772123456");
    expect(toE164("256772123456")).toBe("+256772123456");
    expect(toE164("+256 772 123456")).toBe("+256772123456");
  });
  it("mock provider sends the queue and marks rows sent", async () => {
    const rows = [{ id: "1", to_phone: "0700000000", body: "hi", attempts: 0, status: "queued" }];
    const updates: Record<string, unknown>[] = [];
    const chain = (result: unknown) => { const c: Record<string, unknown> = {}; for (const m of ["select", "eq", "lte", "order", "limit"]) c[m] = () => c; (c as { then: unknown }).then = (r: (v: unknown) => void) => r(result); return c; };
    const db = { from: () => ({
      select: () => chain({ data: rows }),
      update: (v: Record<string, unknown>) => { updates.push(v); return chain({ data: [{ id: "1" }] }); },
    }) };
    const r = await dispatchOutbox(db as never, { SMS_PROVIDER: "mock" });
    expect(r).toMatchObject({ provider: "mock", sent: 1, failed: 0 });
    expect(updates.at(-1)).toMatchObject({ status: "sent", attempts: 1 });
  });
});
