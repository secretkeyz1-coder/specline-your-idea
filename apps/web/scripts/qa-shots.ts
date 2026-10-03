import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/**
 * Batched visual QA capture: desktop + mobile over the key surfaces.
 *
 * Credentials are read from the environment — never commit a real account:
 *   SDD_QA_EMAIL / SDD_QA_PASSWORD
 * Optionally SDD_PROJECT_ID to target a specific project.
 */

const BASE = process.env.SDD_QA_BASE ?? "http://localhost:5173";
const EMAIL = process.env.SDD_QA_EMAIL ?? "";
const PASSWORD = process.env.SDD_QA_PASSWORD ?? "";
const PROJECT = process.env.SDD_PROJECT_ID ?? "";

if (!EMAIL || !PASSWORD) {
  console.error(
    "Missing credentials. Set SDD_QA_EMAIL and SDD_QA_PASSWORD (the operator account) before running the capture.",
  );
  process.exit(1);
}
if (!PROJECT) {
  console.error("Missing SDD_PROJECT_ID — the project whose surfaces should be captured.");
  process.exit(1);
}

const OUT = "../../.impeccable/review";
try { mkdirSync(OUT, { recursive: true }); } catch { /* exists */ }

const browser = await chromium.launch();

/** Sign in once and return the authenticated storage state, so every later
 * context (desktop AND mobile) reuses the same session. */
async function signIn(): Promise<Awaited<ReturnType<Awaited<ReturnType<typeof browser.newContext>>["storageState"]>>> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("input[type=email]", EMAIL);
  await page.fill("input[type=password]", PASSWORD);
  await page.click("button.btn-primary[type=submit]");
  await page.waitForURL(`${BASE}/`);
  const state = await context.storageState();
  await context.close();
  return state;
}

const storageState = await signIn();

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
const page = await context.newPage();

const shots: Array<[string, string, { fullPage?: boolean }?]> = [
  [`desktop-start`, `${BASE}/`, {}],
  [`desktop-plan`, `${BASE}/projects/${PROJECT}`, {}],
  [`desktop-docs`, `${BASE}/projects/${PROJECT}/docs`, {}],
  [`desktop-tasks`, `${BASE}/projects/${PROJECT}/tasks`, {}],
  [`desktop-board`, `${BASE}/projects/${PROJECT}/board`, {}],
  [`desktop-bugs`, `${BASE}/projects/${PROJECT}/bugs`, {}],
  [`desktop-convergence`, `${BASE}/projects/${PROJECT}/convergence`, {}],
  [`desktop-settings-ai`, `${BASE}/settings/ai`, {}],
  [`desktop-machines`, `${BASE}/machines`, {}],
];
for (const [name, url, opts] of shots) {
  await page.goto(url);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts?.fullPage ?? false });
  console.log(`captured ${name}`);
}

// discovery interaction state
await page.goto(`${BASE}/projects/${PROJECT}/discovery`);
await page.waitForTimeout(400);
const ask = page.locator("button.btn-primary", { hasText: /Ask me the next question|Answer/ }).first();
if (await ask.isVisible()) {
  await ask.click();
  await page.waitForTimeout(900);
}
await page.screenshot({ path: `${OUT}/desktop-discovery.png` });
console.log("captured desktop-discovery");

// mobile pass — MUST reuse the authenticated storage state, otherwise every
// capture is just the login redirect and the evidence is worthless.
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState });
const mpage = await mobile.newPage();
for (const [name, url] of [
  ["mobile-start", `${BASE}/`],
  ["mobile-discovery", `${BASE}/projects/${PROJECT}/discovery`],
  ["mobile-tasks", `${BASE}/projects/${PROJECT}/tasks`],
  ["mobile-board", `${BASE}/projects/${PROJECT}/board`],
] as const) {
  await mpage.goto(url);
  await mpage.waitForTimeout(600);
  // Guard: a redirect to /login means the session was not applied.
  if (mpage.url().includes("/login")) {
    console.error(`  ${name}: redirected to /login — session not applied, capture is invalid`);
  }
  await mpage.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`captured ${name} (${mpage.url()})`);
}

await browser.close();
console.log("done");
