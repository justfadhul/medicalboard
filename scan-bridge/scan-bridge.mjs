#!/usr/bin/env node
// UMB scan bridge: lets the web app use office network scanners (eSCL/AirScan) and a scan-to-folder drop folder.
// Zero dependencies (Node 18+). Listens on 127.0.0.1 only; every request needs the token and an allowed Origin.
import http from "node:http";
import dgram from "node:dgram";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CONFIG = path.join(DIR, "config.json");
const defaults = {
  port: 7317,
  token: crypto.randomBytes(16).toString("hex"),
  allowedOrigins: ["http://localhost:3000"],
  dropFolder: path.join(os.homedir(), "UMB-Scans"),
  scanners: [], // optional manual list: [{ "name": "Registry MFP", "url": "http://192.168.1.50/eSCL" }]
  resolution: 300,
};
let cfg = defaults;
if (fs.existsSync(CONFIG)) cfg = { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG, "utf8")) };
else fs.writeFileSync(CONFIG, JSON.stringify(defaults, null, 2));
fs.mkdirSync(path.join(cfg.dropFolder, "processed"), { recursive: true });

// ---------- mDNS discovery of eSCL scanners (_uscan._tcp / _uscans._tcp) ----------
function encodeName(n) { return Buffer.concat([...n.split(".").map((p) => Buffer.concat([Buffer.from([p.length]), Buffer.from(p)])), Buffer.from([0])]); }
function readName(buf, off) {
  const labels = []; let jumped = false, end = off;
  for (let i = 0; i < 50; i++) {
    const len = buf[off];
    if (len === 0) { off++; break; }
    if ((len & 0xc0) === 0xc0) { if (!jumped) end = off + 2; off = ((len & 0x3f) << 8) | buf[off + 1]; jumped = true; continue; }
    labels.push(buf.slice(off + 1, off + 1 + len).toString()); off += len + 1;
  }
  return { name: labels.join("."), next: jumped ? end : off };
}
function discover(timeout = 2500) {
  return new Promise((resolve) => {
    const found = new Map(); const srv = {}; const a = {}; const txt = {};
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.on("message", (buf) => {
      try {
        const qd = buf.readUInt16BE(4), an = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
        let off = 12;
        for (let i = 0; i < qd; i++) off = readName(buf, off).next + 4;
        for (let i = 0; i < an; i++) {
          const n = readName(buf, off); off = n.next;
          const type = buf.readUInt16BE(off), len = buf.readUInt16BE(off + 8); const data = off + 10;
          if (type === 12) found.set(readName(buf, data).name, true);
          if (type === 33) srv[n.name] = { port: buf.readUInt16BE(data + 4), target: readName(buf, data + 6).name };
          if (type === 1) a[n.name] = [...buf.slice(data, data + 4)].join(".");
          if (type === 16) { let p = data; const t = {}; while (p < data + len) { const l = buf[p]; const kv = buf.slice(p + 1, p + 1 + l).toString(); const [k, ...v] = kv.split("="); t[k] = v.join("="); p += l + 1; } txt[n.name] = t; }
          off = data + len;
        }
      } catch { /* ignore malformed packets */ }
    });
    sock.bind(0, () => {
      for (const svc of ["_uscan._tcp.local", "_uscans._tcp.local"]) {
        const q = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]), encodeName(svc), Buffer.from([0, 12, 0, 1])]);
        sock.send(q, 5353, "224.0.0.251");
      }
    });
    setTimeout(() => {
      sock.close();
      const out = [];
      for (const inst of found.keys()) {
        const s = srv[inst]; if (!s) continue;
        const ip = a[s.target]; if (!ip) continue;
        const rs = (txt[inst]?.rs ?? "eSCL").replace(/^\//, "");
        const scheme = inst.includes("_uscans") ? "https" : "http";
        out.push({ id: `${ip}:${s.port}`, name: txt[inst]?.ty || inst.split("._")[0], url: `${scheme}://${ip}:${s.port}/${rs}` });
      }
      resolve(out);
    }, timeout);
  });
}
let cache = { at: 0, list: [] };
async function scanners() {
  if (Date.now() - cache.at > 60_000) cache = { at: Date.now(), list: await discover().catch(() => []) };
  return [...cfg.scanners.map((s) => ({ id: s.url, ...s })), ...cache.list.filter((d) => !cfg.scanners.some((s) => s.url === d.url))];
}

// ---------- eSCL scan ----------
async function escl(url, source) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.0</pwg:Version>
  <pwg:ScanRegions><pwg:ScanRegion><pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
    <pwg:XOffset>0</pwg:XOffset><pwg:YOffset>0</pwg:YOffset><pwg:Width>2480</pwg:Width><pwg:Height>3508</pwg:Height></pwg:ScanRegion></pwg:ScanRegions>
  <pwg:InputSource>${source === "Feeder" ? "Feeder" : "Platen"}</pwg:InputSource>
  <scan:ColorMode>RGB24</scan:ColorMode>
  <scan:XResolution>${cfg.resolution}</scan:XResolution><scan:YResolution>${cfg.resolution}</scan:YResolution>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat><scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
</scan:ScanSettings>`;
  const r = await fetch(`${url}/ScanJobs`, { method: "POST", headers: { "content-type": "text/xml" }, body });
  if (r.status !== 201) throw new Error(`Scanner refused the job (HTTP ${r.status}). Is it busy, or is the feeder empty?`);
  let job = r.headers.get("location"); if (!job) throw new Error("Scanner did not return a job");
  if (!/^https?:/.test(job)) job = new URL(job, url).toString();
  const pages = [];
  for (let i = 0; i < 200; i++) {
    const p = await fetch(`${job.replace(/\/$/, "")}/NextDocument`);
    if (p.status === 404) break;
    if (p.status === 503) { await new Promise((res) => setTimeout(res, 800)); i--; continue; }
    if (!p.ok) throw new Error(`Scanner error (HTTP ${p.status})`);
    pages.push(`data:image/jpeg;base64,${Buffer.from(await p.arrayBuffer()).toString("base64")}`);
    if (source !== "Feeder") break;
  }
  return pages;
}

// ---------- HTTP ----------
const IMG = /\.(jpe?g|png)$/i;
const send = (res, status, body, origin) => {
  res.writeHead(status, { "content-type": "application/json", ...cors(origin) });
  res.end(JSON.stringify(body));
};
function cors(origin) {
  return cfg.allowedOrigins.includes(origin) ? { "access-control-allow-origin": origin, "access-control-allow-headers": "x-bridge-token, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-private-network": "true", vary: "Origin" } : {};
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? "";
  if (req.method === "OPTIONS") { res.writeHead(cfg.allowedOrigins.includes(origin) ? 204 : 403, cors(origin)); return res.end(); }
  if (!cfg.allowedOrigins.includes(origin)) return send(res, 403, { error: "Origin not allowed" }, origin);
  const tok = String(req.headers["x-bridge-token"] ?? "");
  if (tok.length !== cfg.token.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(cfg.token))) return send(res, 401, { error: "Bad token" }, origin);
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/health") return send(res, 200, { ok: true, version: "1.0.0" }, origin);
    if (url.pathname === "/scanners") return send(res, 200, { scanners: (await scanners()).map(({ id, name }) => ({ id, name })) }, origin);
    if (url.pathname === "/scan" && req.method === "POST") {
      const body = JSON.parse(await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d || "{}")); }));
      const s = (await scanners()).find((x) => x.id === body.scanner); if (!s) return send(res, 404, { error: "Scanner not found" }, origin);
      return send(res, 200, { pages: await escl(s.url.replace(/\/$/, ""), body.source) }, origin);
    }
    if (url.pathname === "/drop") {
      const files = fs.readdirSync(cfg.dropFolder).filter((f) => IMG.test(f)).map((f) => { const st = fs.statSync(path.join(cfg.dropFolder, f)); return { name: f, size: st.size, mtime: st.mtime.toISOString() }; });
      return send(res, 200, { files: files.sort((a, b) => a.mtime.localeCompare(b.mtime)) }, origin);
    }
    const m = url.pathname.match(/^\/drop\/([^/]+?)(\/done)?$/);
    if (m) {
      const name = path.basename(decodeURIComponent(m[1])); const file = path.join(cfg.dropFolder, name);
      if (!IMG.test(name) || !fs.existsSync(file)) return send(res, 404, { error: "Not found" }, origin);
      if (m[2] && req.method === "POST") { fs.renameSync(file, path.join(cfg.dropFolder, "processed", `${Date.now()}-${name}`)); return send(res, 200, { ok: true }, origin); }
      res.writeHead(200, { "content-type": /png$/i.test(name) ? "image/png" : "image/jpeg", ...cors(origin) });
      return fs.createReadStream(file).pipe(res);
    }
    send(res, 404, { error: "Unknown path" }, origin);
  } catch (e) { send(res, 500, { error: String(e.message ?? e) }, origin); }
});
server.listen(cfg.port, "127.0.0.1", () => {
  console.log(`UMB scan bridge on http://localhost:${cfg.port}`);
  console.log(`Token (paste into the app's Scanner tab once): ${cfg.token}`);
  console.log(`Allowed app origins: ${cfg.allowedOrigins.join(", ")}`);
  console.log(`Drop folder: ${cfg.dropFolder}`);
});
