# Runbook

## Daily and weekly

| When | Who | What |
|---|---|---|
| Daily | Registry | Intake: every received document scanned, missing documents have reasons, cases sent. Collection: record collections, send reminders for overdue receipts (red). |
| Daily | Secretariat | Review queue; Mentions; Out for signature (mark signed / returned). |
| Before the cut-off (default 7 days before the sitting) | Secretariat | Cases that should make the sitting are marked ready; the sitting page shows how many are at risk. |
| Second Thursday | Secretariat | Board sitting → **Sitting held** → enter decisions (Approve / Defer / Not approved) → **Draft minutes**. |
| After the sitting | Secretariat | Drafting → **Draft all letters** → check → **Send all for signature**; batch memo for retirement letters; **Print signing pack**. |
| Weekly | Admin | Settings → SMS provider badge, AI reading log; Audit log export if required. |

## Common tasks

- **Invite a user / change a role / deactivate:** Users and roles. Deactivation is immediate (the role check fails on the next request).
- **Lost authenticator phone:** Supabase dashboard → Authentication → Users → the user → delete the MFA factor. They enrol a new one at next sign-in. Record it as a note in the audit log export.
- **Undo a mistaken action after 10 seconds:** not possible by design. Decision: there is no re-decision function; record a note and contact the admin to correct with a migration-reviewed SQL statement (audit row stays). Letters: "Came back with a correction" on a signed letter is not allowed; draft a corrected letter by changing particulars before signature.
- **Return for correction:** Out for signature → "Came back with a correction" with the note → the case returns to Drafting with the note on the letter → edit particulars → Redraft → Send for signature.
- **Collection without SMS consent:** the dialog asks for a reason (e.g. national ID checked) instead of a code; it is logged.
- **Change sitting venue/attendance:** Board sitting → Venue / Attendance → Save (attendance feeds the minutes).
- **Open questions** (agenda cut-off, retention, report due period, retirement and OPM addressees): Settings; "Save and mark confirmed" removes the badge.

## Operations

- **SMS not arriving:** Settings shows the provider; `mock` never delivers. Check `sms_outbox` (status `failed`, `last_error`) in the SQL editor; queued rows retry up to 5 times with backoff. Re-queue: `update sms_outbox set status='queued', attempts=0, next_attempt_at=now() where id='…';`. Manual dispatch: `curl -H "Authorization: Bearer $CRON_SECRET" https://<ref>.supabase.co/functions/v1/sms-dispatch` (or `/api/cron/sms` on the app).
- **Uploads stuck:** pages wait in the browser's IndexedDB queue and retry automatically when back online; the scan dialog shows the queue and **Retry failed uploads**. Do not clear browser data on a scanning computer while the queue is non-empty.
- **Scan bridge:** see `scan-bridge/README.md`. Check `http://localhost:7317/health` (needs the token header, so a 401/403 in a plain browser means it is running).
- **Templates:** a broken uploaded template makes letter downloads fail; remove it in Lists and templates to fall back to the placeholder, fix, re-upload.
- **Backups:** Supabase daily backups (enable PITR on the paid plan). Monthly: restore the latest backup into a scratch project and open three cases, one letter and one scan. Storage objects are not in database backups: copy buckets monthly (`supabase storage cp -r ss:///scans ./backup/scans --experimental`).
- **Retention:** `flag_retention()` runs daily (`pg_cron`). Review flagged cases: `select case_no, name, updated_at from cases where retention_flagged_at is not null;`.
- **Migrations:** add a new file in `supabase/migrations`, run `npm run test:sql`, push the branch (CI runs SQL, unit and E2E tests), then `supabase db push` (or the Deploy workflow). Never edit the schema in the dashboard.
- **Smoke test after deploy:** `bash scripts/smoke.sh https://<app>`.

## Incidents

1. Suspected data breach: deactivate affected accounts, rotate `SUPABASE_SERVICE_ROLE_KEY` (Supabase → API) and update Vercel, export the audit log, inform the DPO; the DPPA requires notifying the PDPO without delay.
2. App down: check Vercel status and the deployment logs; roll back to the previous deployment in Vercel.
3. Database down: Supabase status page; the app shows errors but no data is lost (uploads stay queued in browsers).
