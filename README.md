# Uganda Medical Board Case System

Web application for the **Uganda Medical Board Secretariat** (Ministry of Health) handling **referral for medical treatment abroad** and **retirement on medical grounds**: intake with in-app scanning, Secretariat review, Board sittings and minutes, letters from the Ministry's Word templates, signing, collection with an SMS code, and proof of receipt by the receiving office.

- **Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Radix UI · Supabase (Postgres, Auth with TOTP MFA, Storage, RLS, Realtime, Edge Functions) · `docxtemplater` + `pizzip` (Word) · `pdf-lib` (PDF) · built-in page detection (no external library) · ZXing (cover-sheet barcodes).
- **Docs:** [`docs/DATA_PROTECTION.md`](docs/DATA_PROTECTION.md) · [`docs/RUNBOOK.md`](docs/RUNBOOK.md) · [`scan-bridge/README.md`](scan-bridge/README.md)

## Roles

| Role | Workspace |
|---|---|
| `registry` | Intake, New case, scanning, Collection and receipts |
| `secretariat` | Review queue, Board sitting, Drafting, Out for signature, Follow-ups, Rulebook |
| `commissioner` | Read-only: Pipeline, cases, Mentions |
| `admin` | **Every workspace** above plus Users and roles, Settings, Lists and templates, Audit log |

Roles live in `profiles.role` and are enforced in Postgres (`public.my_role()` / `has_role()`, RLS and `security definer` functions).

**Sign-in:** email and password, with no emails sent. An admin adds the person (Users and roles, or `npm run bootstrap:users`); the person opens the login page, chooses **First time? Create your password**, and signs in with it from then on. Only accounts an admin set up, and that have no password yet, can create one (rate limited). Forgotten password: an admin presses **Reset password** and the person creates a new one. Until someone has created their password, anyone who knows their email could create it first, so new users should do it straight away; the Users page shows who has. Two-step verification (TOTP authenticator app) is an admin setting, **Require two-step verification** (`mfa_required`), currently **off**. When on, the database only grants a role to an MFA-verified (`aal2`) session and users are sent to the authenticator screen. Turn it on before real patient data is loaded.

## Workflow

`intake → review → ready → decided → signature → signed → collected → closed`. Every transition is a database function (`send_to_secretariat`, `mark_ready`, `enter_decision`, `draft_letters`, `send_for_signature`, `mark_letter_signed`, `record_collection`, …); clients cannot update `stage`. Criteria, flags, minute numbers (`MB/MM/YYYY/Min04(n)`), letter routing and auto-close are computed in the database. Decision entry, mark signed, receipt confirmation, collection and batch sends have a 10-second **Undo** implemented as a reversing audit event.

## Local development

Requirements: Node 22, Docker (for the Supabase CLI), the Supabase CLI.

```bash
npm install
```

```bash
supabase start
```

```bash
supabase status -o env
```

Copy `.env.example` to `.env.local` and fill `NEXT_PUBLIC_SUPABASE_URL` (API_URL), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ANON_KEY) and `SUPABASE_SERVICE_ROLE_KEY` (SERVICE_ROLE_KEY) from that output. `supabase start` applies `supabase/migrations` and the **fictional** `supabase/seed.sql`.

```bash
BOOTSTRAP_ADMIN_EMAIL=you@example.org BOOTSTRAP_ADMIN_NAME="Your Name" npm run bootstrap:admin
```

```bash
npm run dev
```

Local emails (invites, sign-in links) appear in Inbucket at http://localhost:54324.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Supabase project (public, RLS-protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server only) | Invites, public receipt confirmation, rate limiting. Never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_APP_URL` | Vercel | Base for verification QR links (`/verify/<code>`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Vercel | Cloudflare Turnstile on `/verify`. Without the secret, production refuses public confirmations (set `VERIFY_CAPTCHA_OPTIONAL=true` only for tests) |
| `NEXT_PUBLIC_SCAN_BRIDGE_URL` | Vercel | Scan bridge origin, default `http://localhost:7317` |
| `SMS_PROVIDER` | Vercel + Supabase function secrets | `mock` (default: logs only, no SMS delivered) or `africastalking` |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` | Supabase function secrets (+ Vercel for the fallback) | Africa's Talking |
| `CRON_SECRET` | Supabase function secrets + Vercel | Authorises the SMS dispatcher |
| `AI_READING_ENABLED`, `ANTHROPIC_API_KEY`, `AI_MODEL` | Supabase function secrets (+ `AI_READING_ENABLED` on Vercel to show the button) | Optional AI reading. **Off by default** |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` | Your shell, once | `npm run bootstrap:admin` |

## Supabase project setup (cloud)

1. Create the project in an EU region (the live project is **Ireland, eu-west-1**; see DATA_PROTECTION §1). Enable the `pg_cron` and `pg_net` extensions (Database → Extensions).
2. Push the schema (never edit tables in the dashboard). With the database password use the CLI; with only an access token use `SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/apply-migrations.mjs` (Management API, records the same migration history):
   ```bash
   supabase link --project-ref <ref>
   ```
   ```bash
   supabase db push
   ```
3. **Auth → Providers → Email:** enabled; **Allow new users to sign up: off**. **Auth → Multi-factor:** TOTP enabled. **URL configuration:** Site URL = your app URL; redirect URLs = `https://<app>/auth/callback`.
4. **Auth → Email templates** (links that work on any device):
   - *Invite user*: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
   - *Magic link*: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink`
   - Configure a custom SMTP sender (Auth → SMTP) for production volumes.
5. Edge Functions and secrets:
   ```bash
   supabase functions deploy sms-dispatch --no-verify-jwt
   ```
   ```bash
   supabase functions deploy ai-read
   ```
   ```bash
   supabase secrets set CRON_SECRET=<random> SMS_PROVIDER=mock APP_ORIGIN=https://<app>
   ```
6. Schedule the SMS dispatcher every minute, keeping the secret in Vault (SQL editor; replace the values):
   ```sql
   select vault.create_secret('<CRON_SECRET>', 'umb_cron_secret');
   select cron.schedule('umb-sms', '* * * * *', $$
     select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/sms-dispatch',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'umb_cron_secret')))
   $$);
   ```
   Re-run `supabase db push` after enabling `pg_cron` so the retention and sittings jobs are scheduled (or run the `do $$ … cron.schedule …` block from `20261113000003_rls.sql`).
7. Create the users. Either bootstrap just the first admin (`npm run bootstrap:admin`) and let them invite everyone from **Users and roles**, or create everyone at once from a list:
   ```bash
   cp scripts/users.example.json scripts/users.local.json
   ```
   Edit `scripts/users.local.json` (email, name, role: `registry`, `secretariat`, `commissioner` or `admin`; it is git-ignored because it holds staff emails), then:
   ```bash
   npm run bootstrap:users
   ```
   It is safe to re-run: existing users keep their accounts and get the listed role. No email is sent; each person creates their password on the login page.

## Deploy (Vercel)

Import the GitHub repository in Vercel, set the environment variables above (Production), and deploy; `vercel.json` pins functions to `dub1`, next to the database in Ireland. Or run the **Deploy** GitHub Action (`.github/workflows/deploy.yml`) with secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; it pushes migrations, deploys functions and the app, then runs `scripts/smoke.sh` against the live URL.

## Scanning

All scanning happens in the app (Documents tab → **Scan**, or **Batch scan**):

- **Camera** (`getUserMedia`, rear camera on phones, any webcam or document camera on desktops): live page-edge detection built into the app (no download, works offline): the page is outlined with corner markers, the background is cropped away and the page straightened, with an auto-levels "Enhance" and an optional black-and-white filter. Plain on-screen guidance (move closer, fit the page, hold steady, too dark, torch) and auto-capture with a progress ring when the page is steady; manual capture too. On phones the camera is full screen. Each page is checked for blur (variance of the Laplacian), too dark/too bright, and cut-off edges; a failed page must be retaken or kept with a reason. Pages strip: reorder (drag or arrows), delete, retake.
- **Scan with phone:** a QR with a 10-minute single-use pairing token; the signed-in phone opens the same capture screen; pages appear on the desktop live (Realtime).
- **Scanner:** network scanners (eSCL/AirScan) and a scan-to-folder drop folder through the optional local [scan bridge](scan-bridge/README.md) (Windows install steps there).
- **Batch with cover sheet:** print the cover sheet (Code 128 case barcode and scan order). In Batch scan, choose the document you are scanning (or press **Next document**); every page is filed under the document chosen when it was captured, and can be moved to another document before saving. If the first page is the cover sheet, its barcode (ZXing) is checked against the case and the sheet is not saved.
- Pages are compressed JPEGs, queued in **IndexedDB** and uploaded with retries to the private `scans/{case_id}/{document_id}/` bucket; a combined PDF per document is built with `pdf-lib`.

## Word templates

Admins upload the Ministry's `.docx` files in **Lists and templates** (private `templates` bucket). Until then built-in placeholders are used, with a "Coat of Arms" box on a standard MoH letterhead (Bookman Old Style, justified, en-GB, no flag bars). `npm run templates` writes the placeholders, including `MoH_Headed_letter_template.docx`, to `templates/` for reference.

| File | Used for | Placeholders |
|---|---|---|
| `letter-<kind>.docx` or `letter.docx` | Letters (`retire`, `intro`, `funder`, `extract`) | `{ref}` `{date}` `{#to}{line}{/to}` `{re}` `{#paras}{text}{/paras}` `{#hasBold}{bold}{/hasBold}` `{#hasClose}{close}{/hasClose}` `{#single}{signer} {signTitle}{/single}` `{#signers2}{name} {title}{/signers2}` `{#hasCc}{#cc}{line}{/cc}{/hasCc}` `{#isLetter}{code} {verifyUrl}{/isLetter}`; an image with alt text **QR** is replaced by the verification QR code |
| `memo.docx` | Cover memos and the retirement batch memo | `{to}` `{thru}` `{from}` `{date}` `{re}` `{#hasList}{intro}{#list}{line}{/list}{/hasList}` |
| `minutes.docx` | Draft minutes | `{heading}` `{#agenda}{line}{/agenda}` `{#attendance}{line}{/attendance}` `{casesMinute}` `{#referrals}…{/referrals}` (name, age, gender, diagnosis, procedure, referring, receiving, country, cost, funding, duration, accompanying, decision, minute) `{#retire}…{/retire}` (serial, minute, name, employer, station, age, decision), `{chairName}` `{secName}` |

## Tests

```bash
npm test
```

```bash
PGURL=postgres://postgres:postgres@localhost:5432/postgres npm run test:sql
```

```bash
npm run e2e
```

- **Unit (Vitest):** routing, minute numbering, sittings, age from date of birth, criteria, cadre mapping, letter wording (no diagnosis in retirement letters), `.docx` rendering, signing-pack PDF, quality checks, SMS adapter.
- **SQL:** RLS for anon, no-MFA, no-role, registry, secretariat, commissioner, admin and service role; full workflows (government transplant referral and police retirement) to `closed`, undo, letter routing, collection-code hashing and attempts.
- **E2E (Playwright):** one referral and one retirement case from intake to closed, with Chromium's fake camera stream, the mock SMS provider and magic-link sign-in (TOTP when the setting is on). CI (`.github/workflows/ci.yml`) runs all three against a local Supabase.
