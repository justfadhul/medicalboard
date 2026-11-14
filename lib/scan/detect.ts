// Page detection without OpenCV: finds the sheet of paper in a frame and straightens it.
// Paper is bright and nearly colourless; backgrounds (desks, folders, cloth, hands) are darker or coloured.
// Steps: paper-likeness score -> blur -> Otsu threshold -> close holes (text) -> largest region ->
// convex hull of its outline -> reduce to 4 corners -> validate. Then a perspective warp crops the page out.
import type { Corners } from "./quality";

type Img = { width: number; height: number; data: Uint8ClampedArray };

/** Scale an RGBA image down (nearest) so its width is at most maxW. */
function downscale(img: Img, maxW: number): { w: number; h: number; s: number; rgb: Uint8ClampedArray } {
  const s = Math.min(1, maxW / img.width);
  const w = Math.max(8, Math.round(img.width * s)), h = Math.max(8, Math.round(img.height * s));
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / s));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / s)), i = (sy * img.width + sx) * 4, o = (y * w + x) * 3;
      rgb[o] = img.data[i]!; rgb[o + 1] = img.data[i + 1]!; rgb[o + 2] = img.data[i + 2]!;
    }
  }
  return { w, h, s: w / img.width, rgb };
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) { let row = 0; for (let x = 1; x <= w; x++) { row += src[(y - 1) * w + x - 1]!; I[y * (w + 1) + x] = I[(y - 1) * (w + 1) + x]! + row; } }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
    out[y * w + x] = (I[y1 * (w + 1) + x1]! - I[y0 * (w + 1) + x1]! - I[y1 * (w + 1) + x0]! + I[y0 * (w + 1) + x0]!) / ((x1 - x0) * (y1 - y0));
  }
  return out;
}

function otsu(v: Float32Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const x of v) hist[Math.max(0, Math.min(255, Math.round(x)))]!++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]!; if (!wB) continue;
    const wF = v.length - wB; if (!wF) break;
    sumB += i * hist[i]!;
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

function morph(m: Uint8Array, w: number, h: number, dilate: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      const p = yy < 0 || yy >= h || xx < 0 || xx >= w ? 0 : m[yy * w + xx]!;
      if (dilate ? p : !p) { v = dilate ? 1 : 0; }
    }
    out[y * w + x] = v;
  }
  return out;
}

/** Largest 4-connected region of 1s. Returns its pixel count and a per-pixel label mask. */
function largestRegion(m: Uint8Array, w: number, h: number): { mask: Uint8Array; area: number } {
  const label = new Int32Array(w * h), stack = new Int32Array(w * h);
  let best = 0, bestLabel = 0, next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || label[i]) continue;
    next++; let sp = 0, area = 0; stack[sp++] = i; label[i] = next;
    while (sp) {
      const p = stack[--sp]!; area++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && m[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && m[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && m[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && m[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
    }
    if (area > best) { best = area; bestLabel = next; }
  }
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (label[i] === bestLabel) mask[i] = 1;
  return { mask, area: best };
}

type P = [number, number];
const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function hull(pts: P[]): P[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lo: P[] = [], up: P[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const polyArea = (q: P[]) => Math.abs(q.reduce((s, a, i) => { const b = q[(i + 1) % q.length]!; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

/** Reduce a convex polygon to 4 vertices, each time dropping the vertex whose removal loses the least area. */
function toQuad(poly: P[]): P[] {
  const q = [...poly];
  while (q.length > 4) {
    let bi = 0, ba = Infinity;
    for (let i = 0; i < q.length; i++) {
      const a = q[(i - 1 + q.length) % q.length]!, b = q[i]!, c = q[(i + 1) % q.length]!;
      const area = Math.abs(cross(a, b, c)) / 2;
      if (area < ba) { ba = area; bi = i; }
    }
    q.splice(bi, 1);
  }
  return q;
}

/** Order corners top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(q: P[]): Corners {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const byAngle = [...q].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // start from the corner nearest the top-left
  let start = 0, best = Infinity;
  byAngle.forEach((p, i) => { const d = p[0] + p[1]; if (d < best) { best = d; start = i; } });
  return [0, 1, 2, 3].map((k) => byAngle[(start + k) % 4]!) as Corners;
}

export type Detection = { corners: Corners; fill: number; areaRatio: number };

/** Finds the page in a frame. Returns corners in the input image's pixel coordinates, or null. */
export function detectPage(img: Img, workWidth = 400): Detection | null {
  const { w, h, s, rgb } = downscale(img, workWidth);
  const score = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3]!, g = rgb[i * 3 + 1]!, b = rgb[i * 3 + 2]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    score[i] = Math.max(0, Math.min(255, luma - 1.1 * (max - min)));
  }
  const blurred = boxBlur(score, w, h, Math.max(1, Math.round(w / 160)));
  const t = otsu(blurred);
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = blurred[i]! > t && blurred[i]! > 70 ? 1 : 0;
  // close small holes (text, stamps) then open thin bridges to the background
  for (let k = 0; k < 2; k++) mask = morph(mask, w, h, true);
  for (let k = 0; k < 3; k++) mask = morph(mask, w, h, false);
  mask = morph(mask, w, h, true);
  const { mask: region, area } = largestRegion(mask, w, h);
  const areaRatio = area / (w * h);
  if (areaRatio < 0.08 || areaRatio > 0.97) return null;
  // outline: leftmost and rightmost pixel of each row, topmost and bottommost of each column
  const pts: P[] = [];
  for (let y = 0; y < h; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < w; x++) if (region[y * w + x]) { if (l < 0) l = x; r = x; }
    if (l >= 0) pts.push([l, y], [r + 1, y]);
  }
  for (let x = 0; x < w; x++) {
    let tp = -1, bt = -1;
    for (let y = 0; y < h; y++) if (region[y * w + x]) { if (tp < 0) tp = y; bt = y; }
    if (tp >= 0) pts.push([x, tp], [x, bt + 1]);
  }
  const hl = hull(pts);
  if (hl.length < 4) return null;
  const quad = toQuad(hl);
  const qa = polyArea(quad);
  const fill = area / qa;
  if (fill < 0.82 || qa / (w * h) < 0.08) return null;
  // reject very sharp or very flat corners
  const c = orderCorners(quad);
  for (let i = 0; i < 4; i++) {
    const a = c[(i + 3) % 4]!, b = c[i]!, d = c[(i + 1) % 4]!;
    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [d[0] - b[0], d[1] - b[1]];
    const cos = (v1[0]! * v2[0]! + v1[1]! * v2[1]!) / (Math.hypot(v1[0]!, v1[1]!) * Math.hypot(v2[0]!, v2[1]!));
    if (Math.abs(cos) > 0.6) return null; // outside roughly 53°–127°
  }
  return { corners: c.map(([x, y]) => [x / s, y / s]) as Corners, fill, areaRatio };
}

/** Homography mapping the unit rectangle (0,0)-(W,H) onto the quad. */
function homography(W: number, H: number, q: Corners): number[] {
  const src: P[] = [[0, 0], [W, 0], [W, H], [0, H]];
  const A: number[][] = [], bv: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]!, [u, v] = q[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bv.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bv.push(v);
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < 8; c++) {
    let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!]; [bv[c], bv[piv]] = [bv[piv]!, bv[c]!];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < 8; k++) A[r]![k]! -= f * A[c]![k]!;
      bv[r]! -= f * bv[c]!;
    }
  }
  return [...bv.map((x, i) => x / A[i]![i]!), 1];
}

/** Crops the page out of the frame and straightens it (bilinear sampling). */
export function warpPage(img: Img, corners: Corners, maxSide = 2200): { width: number; height: number; data: Uint8ClampedArray } {
  const d = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let W = Math.max(d(corners[0], corners[1]), d(corners[3], corners[2]));
  let H = Math.max(d(corners[0], corners[3]), d(corners[1], corners[2]));
  const k = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(8, Math.round(W * k)); H = Math.max(8, Math.round(H * k));
  const m = homography(W, H, corners);
  const out = new Uint8ClampedArray(W * H * 4);
  const iw = img.width, ih = img.height, src = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const z = m[6]! * x + m[7]! * y + 1;
    const u = (m[0]! * x + m[1]! * y + m[2]!) / z, v = (m[3]! * x + m[4]! * y + m[5]!) / z;
    const x0 = Math.max(0, Math.min(iw - 2, Math.floor(u))), y0 = Math.max(0, Math.min(ih - 2, Math.floor(v)));
    const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
    const i00 = (y0 * iw + x0) * 4, i10 = i00 + 4, i01 = i00 + iw * 4, i11 = i01 + 4, o = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      out[o + c] = (src[i00 + c]! * (1 - fx) + src[i10 + c]! * fx) * (1 - fy) + (src[i01 + c]! * (1 - fx) + src[i11 + c]! * fx) * fy;
    }
    out[o + 3] = 255;
  }
  return { width: W, height: H, data: out };
}

/** Gentle auto-levels so faint paper scans read clearly (stretches the 2nd–98th luminance percentiles). */
export function autoLevels(img: { width: number; height: number; data: Uint8ClampedArray }) {
  const hist = new Array<number>(256).fill(0), d = img.data, n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) hist[Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!)]!++;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]!; if (acc > n * 0.02) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]!; if (acc > n * 0.02) { hi = i; break; } }
  if (hi - lo < 40) return img;
  const f = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = (d[i + c]! - lo) * f;
  return img;
}
