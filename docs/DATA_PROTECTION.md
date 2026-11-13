# Data protection: Uganda Medical Board case system

Health status and medical records are **special personal data** under Uganda's **Data Protection and Privacy Act, 2019** (DPPA) and the Data Protection and Privacy Regulations, 2021. Section 19 of the Act allows personal data to be processed or stored outside Uganda only where the destination country has adequate measures at least equivalent to the Act, or the data subject has consented.

**Until the sign-offs in §6 are complete, the system holds only fictional demo data.** Never import real case files into a demo or test project.

## 1. Hosting region (checked, not assumed)

| Service | Nearest region offered | Chosen | Why |
|---|---|---|---|
| Supabase (database, auth, file storage, Edge Functions) | No African region is offered (Americas, Europe, Asia Pacific only). Closest by network path from Kampala: Frankfurt `eu-central-1`, London `eu-west-2`, Mumbai `ap-south-1`. | **Frankfurt (`eu-central-1`)** | Shortest typical latency from East Africa over the submarine cables landing in Mombasa; EU GDPR jurisdiction is the strongest argument for "adequate protection" under DPPA s.19. |
| Vercel (web app and server functions) | Cape Town `cpt1` exists, but functions should run next to the database. | **Frankfurt `fra1`** (`vercel.json`) | Every page reads the database; running in `cpt1` would add a Cape Town ↔ Frankfurt round trip to each query. Static assets are served from Vercel's edge everywhere regardless. |

Check the region list again when creating the project (Supabase: *New project → Region*). If Supabase adds an African region, move to it (see §7).

## 2. What leaves Uganda

| Data | Where it goes | Notes |
|---|---|---|
| Everything in the database: case particulars, diagnosis, documents checklist, findings, letters, audit log | Supabase, Frankfurt | Encrypted at rest (AES-256) and in transit (TLS). |
| Scanned pages and signed/stamped letter scans | Supabase Storage (private buckets `scans`, `letters`), Frankfurt | No public buckets; served only through signed URLs valid 2–5 minutes, after RLS checks. |
| Rendered pages (HTML) and generated documents in transit | Vercel `fra1` functions | Not stored by Vercel; logs contain URLs and IDs, not case contents. |
| SMS text and the phone number | SMS provider (Africa's Talking, Nairobi/Kenya) and the Ugandan mobile network | Messages never contain a diagnosis or decision; consent is recorded at intake and checked before every message. Collection codes are stored only as bcrypt hashes. |
| Page images of one document (only if AI reading is switched on) | Anthropic API (USA) | **Off by default.** Requires `AI_READING_ENABLED=true` on the server *and* the admin recording the Ministry's approval in Settings. Sends only the pages of the document requested; results are unconfirmed until a person confirms them; every call is logged (`ai_calls`). |
| Receipt confirmations from receiving offices | Public `/verify/<code>` page | Shows only letter title, addressee office and date. No patient name, diagnosis or case content. Rate limited and protected by Cloudflare Turnstile (Cloudflare sees the visitor's IP). |

## 3. Processors

| Processor | Role | Agreement needed |
|---|---|---|
| Supabase Inc. | Database, auth, storage, functions | Supabase DPA (available in the dashboard); confirm sub-processors (AWS). |
| Vercel Inc. | Web hosting | Vercel DPA. |
| Africa's Talking Ltd | SMS | DPA / data-sharing agreement; confirm retention of message logs. |
| Cloudflare Inc. | Turnstile on the public verify page | Cloudflare DPA. |
| Anthropic PBC (optional) | AI reading of scans | Only after Ministry approval; zero-retention terms should be requested. |

## 4. Controls built in

- Row Level Security on every table; roles enforced in the database (`my_role()` requires an active profile **and** an MFA-verified `aal2` session). The browser is never trusted for role checks.
- Registry sees cases at intake and from signing onwards (collection and receipt), not review findings, extracted fields or flags. The Commissioner is read-only. The public page reads through a narrow `security definer` function.
- TOTP two-step verification required for every role; sign-in by emailed link; accounts only by admin invitation.
- Append-only audit log (no update/delete grants, enforced by trigger even for the service role); exportable as CSV by admins.
- Service-role key only on the server (never `NEXT_PUBLIC_`); secrets live in Vercel and Supabase settings; only `.env.example` is committed.
- Security headers: CSP with `frame-ancestors 'none'`, HSTS, `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, camera limited to this origin.
- Retention: closed cases older than the retention setting (default 10 years, to confirm) are flagged daily for review (`flag_retention()`, scheduled with `pg_cron`). Nothing is deleted automatically.

## 5. Data subject rights

Access and correction requests go to the Secretariat. Particulars can be corrected until letters are signed; every change is in the audit log. Erasure must respect the Ministry's records-retention schedule; record the decision as a note on the case.

## 6. Sign-offs required before real data is loaded

1. **Registration** of the Ministry (as data controller) with the **Personal Data Protection Office (PDPO)**, NITA-U, including this system as a processing activity.
2. **Data protection officer's review** of this document, a data protection impact assessment (special personal data, cross-border transfer), and the processor agreements in §3.
3. **Hosting approval** for storing health data outside Uganda (DPPA s.19), in writing, from the accounting officer, after NITA-U's guidance on government data hosting; or a decision to host in-country (§7).
4. Confirmation of the open settings marked **"to confirm"** in the app (agenda cut-off, retention period, report-due period, letter addressees).
5. Approval (or refusal) of the **SMS processor** and, separately, of the **AI processor** (leave AI reading off until then).
6. A restore test of the backups (see RUNBOOK) and named owners for the admin and DPO roles.

## 7. Moving to in-country hosting

The system uses only standard Supabase components, so it can run on a government server or the National Data Centre (NITA-U):

1. Provision a Linux VM (8 vCPU, 16 GB RAM, 200 GB SSD to start) inside the government network, with Docker.
2. Deploy **self-hosted Supabase** (`supabase/supabase` repository, `docker/` directory): Postgres, GoTrue (auth), PostgREST, Realtime, Storage (use local disk or an S3-compatible store such as MinIO on government storage), Kong, Edge Runtime.
3. Apply the migrations: `supabase db push --db-url postgres://…` (or `psql -f` each file in `supabase/migrations` in order). Do **not** run `seed.sql` in production.
4. Set the auth settings from `supabase/config.toml` (no sign-ups, TOTP MFA on, site URL, email templates from the README) and an SMTP server.
5. Run the Next.js app with `npm run build && npm start` behind Nginx with TLS (or as a Docker container), with the same environment variables pointing at the new Supabase URL.
6. Migrate data: `pg_dump` from the cloud project → `pg_restore`; copy storage buckets with `supabase storage cp -r` or the S3 API; re-issue verification QR links only if the domain changes.
7. Repoint DNS, then delete the cloud projects and record the deletion.
