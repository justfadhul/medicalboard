import { describe, expect, it } from "vitest";
import { detectPage, warpPage, orderCorners } from "@/lib/scan/detect";

type P = [number, number];
const inside = (p: P, q: P[]) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = q[i]!, [xj, yj] = q[j]!; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };

/** A white page (with dark text lines) on a saturated, noisy background, like paper on a pink folder or patterned cloth. */
function scene(w: number, h: number, page: P[], bg: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; let c: [number, number, number];
    if (inside([x, y], page)) { const text = y % 14 < 2 && (x * 7 + y) % 40 < 28; c = text ? [40, 40, 45] : [236, 234, 228]; }
    else c = bg(x, y);
    const n = (rnd() - 0.5) * 18;
    data[o] = c[0] + n; data[o + 1] = c[1] + n; data[o + 2] = c[2] + n; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}
const near = (a: P[], b: P[], tol: number) => a.every((p, i) => Math.hypot(p[0] - b[i]![0], p[1] - b[i]![1]) < tol);

describe("page detection (isolates the document from the background)", () => {
  it("finds a tilted page on a pink folder", () => {
    const page: P[] = [[180, 90], [560, 140], [520, 650], [130, 600]];
    const img = scene(720, 760, page, () => [214, 96, 140]);
    const d = detectPage(img)!;
    expect(d).not.toBeNull();
    expect(near(d.corners, page, 720 * 0.035)).toBe(true);
  });
  it("finds a page on patterned beige cloth", () => {
    const page: P[] = [[100, 120], [500, 100], [520, 700], [90, 690]];
    const img = scene(640, 800, page, (x, y) => (((x >> 4) + (y >> 4)) % 2 ? [190, 160, 120] : [150, 115, 80]));
    const d = detectPage(img)!;
    expect(d).not.toBeNull();
    expect(near(d.corners, page, 640 * 0.035)).toBe(true);
  });
  it("returns null when there is no page", () => {
    expect(detectPage(scene(400, 300, [[0, 0], [1, 0], [1, 1], [0, 1]], () => [120, 60, 70]))).toBeNull();
  });
  it("orders corners top-left first, clockwise", () => {
    expect(orderCorners([[10, 90], [90, 10], [10, 10], [90, 90]])).toEqual([[10, 10], [90, 10], [90, 90], [10, 90]]);
  });
  it("warp crops the page out: the result is paper, not background", () => {
    const page: P[] = [[180, 90], [560, 140], [520, 650], [130, 600]];
    const img = scene(720, 760, page, () => [214, 96, 140]);
    const out = warpPage(img, detectPage(img)!.corners);
    expect(out.height).toBeGreaterThan(out.width);
    let pink = 0;
    for (let i = 0; i < out.data.length; i += 4) if (out.data[i]! - out.data[i + 1]! > 70) pink++;
    expect(pink / (out.data.length / 4)).toBeLessThan(0.03);
  });
});
