import { expect, test, type Page } from "@playwright/test";
import { admin, caseIdFromUrl, ensureUser, latestSms, login, scanAllDocuments, stageOf } from "./helpers";

const RUN = Date.now().toString(36);
const REG = "e2e-registry@umb.test", SEC = "e2e-secretariat@umb.test";

test.beforeAll(async () => {
  await ensureUser(REG, "registry", "E2E Registry");
  await ensureUser(SEC, "secretariat", "E2E Secretariat");
});

async function newCase(page: Page, kind: "retirement" | "referral", name: string) {
  await page.goto("/cases/new");
  await page.getByRole("button", { name: kind === "retirement" ? "Retirement on medical grounds" : "Referral abroad" }).click();
  await page.getByLabel("Full name", { exact: true }).fill(name);
  await page.getByLabel("Date of birth", { exact: true }).fill("1975-04-20");
  await page.getByLabel("Phone for SMS updates").fill("0700123456");
  await page.getByRole("checkbox", { name: /agrees to receive SMS/ }).check();
  if (kind === "retirement") {
    await page.getByLabel("Employer", { exact: true }).selectOption({ label: "Uganda Police Force" });
    await page.getByLabel("Place of work", { exact: true }).fill("Test Station");
  } else {
    await page.getByLabel("Who pays", { exact: true }).selectOption("family");
    await page.getByLabel("Procedure", { exact: true }).selectOption({ label: "Cochlear implant" });
    await page.getByLabel("Country", { exact: true }).selectOption("India");
    await page.getByLabel("Receiving doctor", { exact: true }).fill("Dr E2E Receiver");
    await page.getByRole("group", { name: "Receipt of Treatment report from an earlier referral" }).getByRole("button", { name: "Not applicable" }).click();
  }
  await page.getByRole("button", { name: "Create case and start scanning" }).click();
  await page.waitForURL(/\/cases\/[0-9a-f-]{36}/);
  return caseIdFromUrl(page);
}

async function registryIntake(page: Page, kind: "retirement" | "referral", name: string) {
  const id = await newCase(page, kind, name);
  await scanAllDocuments(page);
  await page.getByRole("button", { name: "Send to Secretariat" }).click();
  await expect.poll(() => stageOf(id)).toBe("review");
  return id;
}

async function secretariatToSigned(page: Page, id: string, name: string) {
  await page.goto(`/cases/${id}?tab=review`);
  await page.getByRole("tab", { name: /^Fields/ }).click();
  await page.getByLabel("Field", { exact: true }).selectOption("name");
  await page.getByLabel("Value as written on the page").fill(name);
  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
  await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
  // a finding, copied, then resolved
  await page.getByRole("tab", { name: /^Findings/ }).click();
  await page.getByLabel("What is missing or wrong").fill("Stamp on the referral is faint");
  await page.getByLabel("Reasoning").fill("Legible enough for the record");
  await page.getByLabel("Effect").selectOption("record");
  await page.getByRole("button", { name: "Save finding" }).click();
  await expect(page.getByText("Stamp on the referral is faint")).toBeVisible();
  // resolve any automatic flags
  await page.getByRole("tab", { name: /^Flags/ }).click();
  for (const b of await page.getByRole("button", { name: "Mark resolved" }).all()) await b.click();
  await page.getByRole("button", { name: "Mark ready for Board" }).click();
  await expect.poll(() => stageOf(id)).toBe("ready");

  const { data: c } = await admin.from("cases").select("sitting_id").eq("id", id).single();
  await page.goto(`/sitting?id=${c!.sitting_id}`);
  if (await page.getByRole("button", { name: "Sitting held: enter decisions" }).isVisible()) await page.getByRole("button", { name: "Sitting held: enter decisions" }).click();
  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(() => stageOf(id)).toBe("decided");
  const { data: m } = await admin.from("cases").select("minute_no").eq("id", id).single();
  expect(m!.minute_no).toMatch(/^MB\/\d{2}\/\d{4}\/Min04\(\d+\)$/);

  await page.goto("/drafting");
  const sec = page.getByRole("region", { name });
  await sec.getByRole("button", { name: "Draft letters" }).click();
  await expect(sec.getByRole("button", { name: "Send for signature" })).toBeVisible();
  const docx = page.waitForEvent("download");
  await sec.getByRole("link", { name: ".docx" }).first().click();
  expect((await docx).suggestedFilename()).toMatch(/\.docx$/);
  await sec.getByRole("button", { name: "Send for signature" }).click();
  await expect.poll(() => stageOf(id)).toBe("signature");

  await page.goto("/signatures");
  const pack = page.waitForEvent("download");
  await page.getByRole("link", { name: "Print signing pack" }).click();
  expect((await pack).suggestedFilename()).toMatch(/\.pdf$/);
  for (let i = 0; i < 3 && (await stageOf(id)) === "signature"; i++) {
    await page.getByRole("button", { name: new RegExp(name.replace(/[()]/g, ".")) }).first().click();
    await page.getByRole("button", { name: "Mark signed" }).click();
    await page.waitForTimeout(800);
  }
  await expect.poll(() => stageOf(id)).toBe("signed");
}

async function collectAndReceive(page: Page, browserPage: Page, id: string, name: string) {
  await page.goto("/collection");
  await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "Record collection" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Collected by").fill("E2E Collector");
  await d.getByLabel("Relationship to the patient").fill("Brother");
  await d.getByRole("button", { name: "Send one-time code by SMS" }).click();
  await expect(d.getByLabel("Collection code")).toBeVisible();
  const code = (await latestSms(id, "collection_code")).match(/is (\d{6})/)![1]!;
  await d.getByLabel("Collection code").fill(code);
  await d.getByRole("checkbox", { name: /checked the collector/ }).check();
  await d.getByRole("button", { name: "Confirm collection" }).click();
  await expect.poll(() => stageOf(id)).toBe("collected");

  // Receiving office confirms via the public page: no sign-in, no health information.
  const { data: letters } = await admin.from("letters").select("verify_code").eq("case_id", id).eq("receipt_needed", true);
  for (const l of letters ?? []) {
    await browserPage.goto(`/verify/${l.verify_code}`);
    await expect(browserPage.getByText("Genuine letter issued by the Ministry of Health.")).toBeVisible();
    await expect(browserPage.locator("body")).not.toContainText(name);
    await browserPage.getByLabel("Received by (name)").fill("E2E Receiver");
    await browserPage.getByLabel("Designation and office").fill("Records Officer");
    await browserPage.getByRole("button", { name: "Confirm receipt" }).click();
    await expect(browserPage.getByText("Receipt confirmed. Thank you.")).toBeVisible();
  }
  await expect.poll(() => stageOf(id)).toBe("closed");
}

test("retirement case: intake to closed", async ({ browser }) => {
  const name = `E2E Retiree ${RUN}`;
  const reg = await login(browser, REG);
  const id = await registryIntake(reg, "retirement", name);
  const sec = await login(browser, SEC);
  await secretariatToSigned(sec, id, name);
  const { data: l } = await admin.from("letters").select("addressee,signer,ref_no").eq("case_id", id);
  expect(l).toEqual([{ addressee: "The Inspector General of Police", signer: "dghs", ref_no: "ADM 85/265/01" }]);
  const anon = await (await browser.newContext()).newPage();
  await collectAndReceive(reg, anon, id, name);
});

test("referral case (family funded): intake to closed", async ({ browser }) => {
  const name = `E2E Patient ${RUN}`;
  const reg = await login(browser, REG);
  const id = await registryIntake(reg, "referral", name);
  const sec = await login(browser, SEC);
  await secretariatToSigned(sec, id, name);
  const { data: l } = await admin.from("letters").select("kind,addressee,signer").eq("case_id", id);
  expect(l).toEqual([{ kind: "intro", addressee: "Dr E2E Receiver", signer: "dghs" }]);
  const anon = await (await browser.newContext()).newPage();
  await collectAndReceive(reg, anon, id, name);
  // SMS went through the mock provider outbox only with consent
  const { count } = await admin.from("sms_outbox").select("id", { count: "exact", head: true }).eq("case_id", id);
  expect(count).toBeGreaterThanOrEqual(5);
});

test("a new user creates their own password, then signs in with it (no email)", async ({ page }) => {
  const email = `e2e-new-${RUN}@umb.test`;
  const { data } = await admin.auth.admin.createUser({ email, email_confirm: true });
  await admin.from("profiles").upsert({ id: data.user!.id, email, role: "commissioner", active: true });
  await page.goto("/login");
  await page.getByRole("button", { name: "First time? Create your password" }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("New password (at least 10 characters)").fill("Kampala-2026-pass");
  await page.getByLabel("Type the password again").fill("Kampala-2026-pass");
  await page.getByRole("button", { name: "Create password and sign in" }).click();
  await page.waitForURL(/\/pipeline/);
  // A second attempt to "create" the password for the same account is refused
  const r = await page.request.post("/api/auth/create-password", { data: { email, password: "Another-pass-123" } });
  expect(r.status()).toBe(400);
});

test("public verify page rejects unknown codes and shows nothing else", async ({ page }) => {
  await page.goto("/verify/000000000000000000000000");
  await expect(page.getByText(/does not match any letter/)).toBeVisible();
});
