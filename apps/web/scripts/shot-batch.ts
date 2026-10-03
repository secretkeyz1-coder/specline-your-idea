import { chromium } from "playwright";

/**
 * Capture the discovery batch state for one project.
 * Credentials come from the environment — never commit a real account:
 *   SDD_QA_EMAIL / SDD_QA_PASSWORD / SDD_PROJECT_ID
 */

const BASE = process.env.SDD_QA_BASE ?? "http://localhost:5173";
const EMAIL = process.env.SDD_QA_EMAIL ?? "";
const PASSWORD = process.env.SDD_QA_PASSWORD ?? "";
const PID = process.env.SDD_PROJECT_ID ?? "";

if (!EMAIL || !PASSWORD || !PID) {
  console.error("Set SDD_QA_EMAIL, SDD_QA_PASSWORD and SDD_PROJECT_ID before running this capture.");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/login`);
await page.fill("input[type=email]", EMAIL);
await page.fill("input[type=password]", PASSWORD);
await page.click("button.btn-primary[type=submit]");
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/projects/${PID}/discovery`);
await page.waitForTimeout(1200);
await page.screenshot({ path: "../../.impeccable/review/discovery-batch.png" });
console.log("captured");
await browser.close();
