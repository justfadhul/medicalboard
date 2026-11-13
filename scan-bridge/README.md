# UMB scan bridge

A small, optional program for Registry computers. It lets the web app use **office network scanners** (eSCL / AirScan, which most current HP, Canon, Epson, Brother, Kyocera and Ricoh multifunction printers support) and a **drop folder** for scanners that can only "scan to folder". The officer never leaves the app: pages appear in the scan dialog under **Source → Scanner**.

- No dependencies: one file, Node.js 18 or later.
- Listens on `127.0.0.1:7317` only (not reachable from the network).
- Every request needs the bridge **token** and must come from an **allowed app origin** (CORS locked). Chrome's Private Network Access preflight is answered.
- Scanned pages go straight to the browser; the app runs the same quality checks and resilient upload as camera scans. Nothing is stored by the bridge except files in the drop folder.

## Install on Windows (once per computer)

1. Install **Node.js LTS** from https://nodejs.org (Windows Installer, default options).
2. Copy the `scan-bridge` folder to `C:\UMB\scan-bridge`.
3. Open **Command Prompt** and run:
   ```bat
   cd C:\UMB\scan-bridge
   node scan-bridge.mjs
   ```
   The first run creates `config.json` and prints the **token**. Stop it with Ctrl+C.
4. Edit `config.json` in Notepad:
   - `allowedOrigins`: the app address, e.g. `["https://umb.example.go.ug"]`.
   - `dropFolder`: where the scanner saves files, e.g. `"C:\\UMB\\Scans"` (use JPEG or PNG output on the scanner).
   - `scanners` (optional): add scanners that are not discovered automatically, e.g. `[{"name": "Registry MFP", "url": "http://192.168.1.50/eSCL"}]`.
5. Start it automatically at sign-in: open **Task Scheduler → Create Task**; *Triggers*: At log on; *Actions*: Start a program `node` with arguments `C:\UMB\scan-bridge\scan-bridge.mjs` and *Start in* `C:\UMB\scan-bridge`; tick *Run whether user is logged on or not* only if the drop folder is local. (Alternatively install it as a service with NSSM: `nssm install UMBScanBridge "C:\Program Files\nodejs\node.exe" C:\UMB\scan-bridge\scan-bridge.mjs`.)
6. Allow it through **Windows Defender Firewall** if prompted (private networks only; discovery uses multicast DNS on UDP 5353).
7. In the app, open any document → **Scan** → **Scanner**, paste the token and press **Connect**. The token is remembered in that browser.

## API (for reference)

All requests: header `X-Bridge-Token: <token>` and an allowed `Origin`.

| Method | Path | Result |
|---|---|---|
| GET | `/health` | `{ ok: true }` |
| GET | `/scanners` | `{ scanners: [{ id, name }] }` (mDNS `_uscan._tcp` / `_uscans._tcp` plus `config.json`) |
| POST | `/scan` `{ scanner, source: "Platen" \| "Feeder" }` | `{ pages: ["data:image/jpeg;base64,…"] }` |
| GET | `/drop` | `{ files: [{ name, size, mtime }] }` (JPEG/PNG) |
| GET | `/drop/<name>` | the image |
| POST | `/drop/<name>/done` | moves the file to `processed/` |

## Limits

- USB-only scanners without network scanning or "scan to folder" are not supported (browsers cannot reach TWAIN/WIA). Use the drop folder with the vendor's scan utility, or the camera / phone sources.
- Scanners that only save PDF to a folder: set them to JPEG; PDF files are not listed.
- eSCL over HTTPS with a self-signed certificate (`_uscans`) needs `NODE_TLS_REJECT_UNAUTHORIZED=0` for the bridge process only; prefer the plain `_uscan` endpoint on the office LAN.
