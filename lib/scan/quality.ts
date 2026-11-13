// Page quality checks run in the browser before a page is saved.
export type Corners = [number, number][]; // tl, tr, br, bl in pixel coordinates
export type Quality = { ok: boolean; issues: string[]; blur: number; brightness: number; contrast: number; cutOff: boolean; score: number };

export const THRESHOLDS = { blur: 60, dark: 70, bright: 245, lowContrast: 18, edge: 0.015 };

/** Grayscale copy, downscaled so checks are comparable across cameras. */
export function toGray(img: ImageData, maxW = 800): { g: Float32Array; w: number; h: number } {
  const s = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / s));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / s)), i = (sy * img.width + sx) * 4;
      g[y * w + x] = 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
    }
  }
  return { g, w, h };
}

/** Variance of the Laplacian: low means blurred. */
export function laplacianVariance(g: Float32Array, w: number, h: number): number {
  let sum = 0, sq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const v = g[i - w]! + g[i + w]! + g[i - 1]! + g[i + 1]! - 4 * g[i]!;
    sum += v; sq += v * v; n++;
  }
  if (!n) return 0;
  const m = sum / n;
  return sq / n - m * m;
}

export function meanStd(g: Float32Array): { mean: number; std: number } {
  let s = 0, q = 0;
  for (const v of g) { s += v; q += v * v; }
  const mean = s / g.length;
  return { mean, std: Math.sqrt(Math.max(0, q / g.length - mean * mean)) };
}

/** Corners within `edge` of the frame mean the page is probably cut off. */
export function touchesFrame(corners: Corners | null | undefined, fw: number, fh: number, edge = THRESHOLDS.edge): boolean {
  if (!corners) return false;
  const ex = fw * edge, ey = fh * edge;
  return corners.some(([x, y]) => x <= ex || y <= ey || x >= fw - ex || y >= fh - ey);
}

export function assess(img: ImageData, corners?: Corners | null, frame?: { w: number; h: number }): Quality {
  const { g, w, h } = toGray(img);
  const blur = laplacianVariance(g, w, h);
  const { mean, std } = meanStd(g);
  const cutOff = frame ? touchesFrame(corners, frame.w, frame.h) : false;
  const issues: string[] = [];
  if (blur < THRESHOLDS.blur) issues.push("Blurred: hold the camera steady and in focus");
  if (mean < THRESHOLDS.dark) issues.push("Too dark: add light or move to a brighter spot");
  if (mean > THRESHOLDS.bright && std < THRESHOLDS.lowContrast) issues.push("Too bright: the page is washed out");
  if (cutOff) issues.push("Page cut off: fit the whole page in the frame");
  const score = Math.max(0, Math.min(1, (Math.min(blur, 300) / 300) * 0.6 + (1 - Math.abs(mean - 170) / 170) * 0.4));
  return { ok: issues.length === 0, issues, blur: Math.round(blur), brightness: Math.round(mean), contrast: Math.round(std), cutOff, score: Number(score.toFixed(3)) };
}

/** Black-and-white "document" filter (adaptive-ish threshold around the local mean). */
export function documentFilter(img: ImageData): ImageData {
  const { width: w, height: h, data } = img;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  // integral image for a fast box mean
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) { let row = 0; for (let x = 1; x <= w; x++) { row += gray[(y - 1) * w + x - 1]!; I[y * (w + 1) + x] = I[(y - 1) * (w + 1) + x]! + row; } }
  const r = Math.max(8, Math.round(Math.min(w, h) / 40));
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
    const area = (x1 - x0) * (y1 - y0);
    const s = I[y1 * (w + 1) + x1]! - I[y0 * (w + 1) + x1]! - I[y1 * (w + 1) + x0]! + I[y0 * (w + 1) + x0]!;
    const v = gray[y * w + x]! < (s / area) * 0.9 ? 0 : 255;
    const o = (y * w + x) * 4;
    out.data[o] = out.data[o + 1] = out.data[o + 2] = v; out.data[o + 3] = 255;
  }
  return out;
}

/** Largest corner movement between two detections, as a fraction of frame width. */
export function cornerShift(a: Corners | null, b: Corners | null, fw: number): number {
  if (!a || !b) return Infinity;
  return Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i]![0], p[1] - b[i]![1]))) / fw;
}
