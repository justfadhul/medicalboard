/* Page edge detection and perspective correction with OpenCV.js, loaded lazily in this worker. */
/* global cv, importScripts */
const OPENCV = "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js";
let ready = null;
function load() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    try {
      self.Module = { onRuntimeInitialized: () => resolve(true) };
      importScripts(OPENCV);
      if (typeof cv !== "undefined") {
        if (cv.Mat) resolve(true);
        else if (cv.then) cv.then((m) => { self.cv = m; resolve(true); });
        else cv.onRuntimeInitialized = () => resolve(true);
      }
    } catch (e) { reject(e); }
    setTimeout(() => reject(new Error("OpenCV load timeout")), 30000);
  });
  return ready;
}

function order(pts) {
  const s = pts.map((p) => p[0] + p[1]), d = pts.map((p) => p[1] - p[0]);
  return [pts[s.indexOf(Math.min(...s))], pts[d.indexOf(Math.min(...d))], pts[s.indexOf(Math.max(...s))], pts[d.indexOf(Math.max(...d))]];
}

function detect(img) {
  const src = cv.matFromImageData(img), gray = new cv.Mat(), edges = new cv.Mat(), contours = new cv.MatVector(), hier = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 50, 150);
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, k); k.delete();
    cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    let best = null, bestArea = img.width * img.height * 0.18;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i), peri = cv.arcLength(c, true), approx = new cv.Mat();
      cv.approxPolyDP(c, approx, 0.02 * peri, true);
      const area = Math.abs(cv.contourArea(approx));
      if (approx.rows === 4 && area > bestArea && cv.isContourConvex(approx)) {
        bestArea = area; best = [];
        for (let j = 0; j < 4; j++) best.push([approx.data32S[j * 2], approx.data32S[j * 2 + 1]]);
      }
      approx.delete(); c.delete();
    }
    return best ? order(best) : null;
  } finally { src.delete(); gray.delete(); edges.delete(); contours.delete(); hier.delete(); }
}

function warp(img, c) {
  const src = cv.matFromImageData(img), dst = new cv.Mat();
  try {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const w = Math.round(Math.max(d(c[0], c[1]), d(c[3], c[2]))), h = Math.round(Math.max(d(c[0], c[3]), d(c[1], c[2])));
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, c.flat());
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    const M = cv.getPerspectiveTransform(from, to);
    cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    from.delete(); to.delete(); M.delete();
    return new ImageData(new Uint8ClampedArray(dst.data), w, h);
  } finally { src.delete(); dst.delete(); }
}

self.onmessage = async (e) => {
  const { id, op, img, corners } = e.data;
  try {
    await load();
    if (op === "load") return self.postMessage({ id, ok: true });
    if (op === "detect") return self.postMessage({ id, corners: detect(img) });
    if (op === "warp") { const out = warp(img, corners); return self.postMessage({ id, img: out }, [out.data.buffer]); }
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
