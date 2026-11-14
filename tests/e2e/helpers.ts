import { expect, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as used by Supabase Auth MFA. */
function totp(secret: string, t = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac("sha1", key).update(counter).digest(); const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
export const authenticator = { generate: totp };

export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const secrets = new Map<string, string>();
const lastCode = new Map<string, string>();

export async function ensureUser(email: string, role: string, name: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 500 });
  let id = data.users.find((u) => u.email === email)?.id;
  if (!id) {
    const r = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
    if (r.error) throw r.error;
    id = r.data.user.id;
  }
  await admin.from("profiles").upsert({ id, email, full_name: name, role, active: true });
  // fresh MFA factor each run
  const f = await admin.auth.admin.mfa.listFactors({ userId: id });
  for (const x of f.data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ userId: id, id: x.id });
  secrets.delete(email);
  return id;
}

/** Signs in with a magic link (token_hash) and completes TOTP enrolment/verification. */
export async function login(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ["camera"] });
  const page = await ctx.newPage();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`);
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/"));
  if (!page.url().includes("/mfa")) return page; // two-step verification switched off
  const logs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  const keyEl = page.locator("code");
  // Either the enrolment key appears (first sign-in) or the verify form for an existing factor.
  await expect(keyEl.or(page.getByText("Enter the six-digit code from your authenticator app.", { exact: true }))).toBeVisible({ timeout: 20_000 })
    .catch(async () => { throw new Error(`MFA screen did not load. Page: ${(await page.locator("body").innerText()).slice(0, 400)} | console: ${logs.join(" | ").slice(0, 600)}`); });
  if (await keyEl.isVisible()) secrets.set(email, (await keyEl.textContent())!.trim());
  const secret = secrets.get(email);
  if (!secret) throw new Error(`No TOTP secret for ${email}. Page: ${(await page.locator("body").innerText()).slice(0, 400)}`);
  // never reuse a code from the same 30-second window
  let code = authenticator.generate(secret);
  while (code === lastCode.get(email)) { await page.waitForTimeout(2000); code = authenticator.generate(secret); }
  lastCode.set(email, code);
  await page.getByLabel("Six-digit code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/mfa"));
  return page;
}

export async function caseIdFromUrl(page: Page) { return page.url().match(/cases\/([0-9a-f-]{36})/)![1]!; }

/** Scan every received document with the fake camera, keeping any page that fails the quality check. */
export async function scanAllDocuments(page: Page) {
  const scanButtons = page.getByRole("button", { name: "Scan", exact: true });
  const n = await scanButtons.count();
  for (let i = n; i > 0; i--) {
    await scanButtons.first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Live camera view")).toBeVisible();
    await page.waitForFunction(() => ((document.querySelector("video") as HTMLVideoElement | null)?.videoWidth ?? 0) > 0);
    await dialog.getByRole("button", { name: "Capture page" }).click();
    await expect(dialog.getByAltText("Page 1")).toBeVisible();
    await page.waitForTimeout(500); // auto-capture may have added pages from the fake stream
    for (const keep of await dialog.getByLabel(/^Reason to keep page \d+$/).all()) await keep.fill("Test pattern from the fake camera");
    await dialog.getByRole("button", { name: /^Save \d+ pages?$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(scanButtons).toHaveCount(i - 1, { timeout: 60_000 });
  }
}

export async function latestSms(caseId: string, kind: string) {
  const { data } = await admin.from("sms_outbox").select("body").eq("case_id", caseId).eq("kind", kind).order("created_at", { ascending: false }).limit(1).single();
  return data!.body as string;
}
export async function stageOf(caseId: string) {
  const { data } = await admin.from("cases").select("stage").eq("id", caseId).single();
  return data!.stage as string;
}
