import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";

/**
 * One batched capture for design critique/audit: desktop (1440) + mobile (390)
 * over every primary surface, plus a brand-new account's first run.
 *
 *   SDD_QA_EMAIL / SDD_QA_PASSWORD  operator account (never committed)
 *   SDD_PROJECT_ID                  a project that already has a plan + tasks
 */

const BASE = process.env.SDD_QA_BASE ?? "http://localhost:5173";
const API = process.env.SDD_QA_API ?? "http://localhost:4000";
const EMAIL = process.env.SDD_QA_EMAIL ?? "";
const PASSWORD = process.env.SDD_QA_PASSWORD ?? "";
const PROJECT = process.env.SDD_PROJECT_ID ?? "";
if (!EMAIL || !PASSWORD || !PROJECT) {
  console.error("Set SDD_QA_EMAIL, SDD_QA_PASSWORD and SDD_PROJECT_ID.");
  process.exit(1);
}

const OUT = process.env.SDD_QA_OUT ?? "../../.impeccable/review/critique";
try { mkdirSync(OUT, { recursive: true }); } catch { /* exists */ }
const browser = await chromium.launch();

async function signIn(email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", password);
  await page.click("button.btn-primary[type=submit]");
  await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
  const state = await context.storageState();
  await context.close();
  return state;
}

async function shot(page: Page, name: string, url: string, fullPage = true) {
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(500);
  if (page.url().includes("/login") && !url.includes("/login")) console.error(`  ${name}: redirected to /login`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`captured ${name} → ${page.url()}`);
}

// Pick a task for the work-order surface.
const apiLogin = await fetch(`${API}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const cookie = /sdd_session=[^;]+/.exec(apiLogin.headers.get("set-cookie") ?? "")?.[0] ?? "";
const tasks = (await (await fetch(`${API}/api/v1/projects/${PROJECT}/tasks?limit=50`, { headers: { cookie } })).json()) as {
  tasks: Array<{ id: string; workflowStatus: string }>;
};
const task = tasks.tasks.find((t) => t.workflowStatus === "NEEDS_REVIEW") ?? tasks.tasks.find((t) => t.workflowStatus === "READY") ?? tasks.tasks[0];

const operator = await signIn(EMAIL, PASSWORD);
const surfaces: Array<[string, string]> = [
  ["start", `${BASE}/`],
  ["plan", `${BASE}/projects/${PROJECT}`],
  ["docs-requirements", `${BASE}/projects/${PROJECT}/docs?tab=requirements`],
  ["docs-design", `${BASE}/projects/${PROJECT}/docs?tab=design`],
  ["stack", `${BASE}/new/stack/${PROJECT}`],
  ["tasks", `${BASE}/projects/${PROJECT}/tasks`],
  ["task-detail", `${BASE}/projects/${PROJECT}/tasks/${task?.id ?? ""}`],
  ["board", `${BASE}/projects/${PROJECT}/board`],
  ["bugs", `${BASE}/projects/${PROJECT}/bugs`],
  ["convergence", `${BASE}/projects/${PROJECT}/convergence`],
  ["settings-ai", `${BASE}/settings/ai`],
  ["machines", `${BASE}/machines`],
];

for (const [viewport, size] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
] as const) {
  const ctx = await browser.newContext({ viewport: size, storageState: operator });
  const page = await ctx.newPage();
  for (const [name, url] of surfaces) await shot(page, `${viewport}-${name}`, url);
  await ctx.close();

  // Signed-out entry
  const anon = await browser.newContext({ viewport: size });
  const ap = await anon.newPage();
  await shot(ap, `${viewport}-login`, `${BASE}/login`, false);
  await anon.close();
}

// ── First run: a brand-new account with zero projects, then its first idea.
const newEmail = `qa-firstrun-${Date.now()}@example.com`;
const newPassword = "FirstRun1Pass!";
const reg = await fetch(`${API}/api/v1/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: newEmail, password: newPassword, display_name: "First Run" }),
});
console.log(`register first-run account → ${reg.status}`);
if (reg.status < 300) {
  const fresh = await signIn(newEmail, newPassword);
  for (const [viewport, size] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ] as const) {
    const ctx = await browser.newContext({ viewport: size, storageState: fresh });
    const page = await ctx.newPage();
    await shot(page, `${viewport}-firstrun-start`, `${BASE}/`);
    await shot(page, `${viewport}-firstrun-settings-ai`, `${BASE}/settings/ai`);
    await shot(page, `${viewport}-firstrun-machines`, `${BASE}/machines`);
    await ctx.close();
  }
  // Create the first project through the real composer and land in discovery.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: fresh });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // First run without AI: the composer opens behind "Start without AI instead".
  const withoutAi = page.getByRole("button", { name: /Start without AI/ });
  if (await withoutAi.count()) await withoutAi.click();
  const name = page.locator("input[name=name]");
  if (await name.count()) {
    await name.fill("Field Evidence Tracker");
    await page.locator("textarea[name=idea]").fill(
      "A mobile app for site technicians to capture progress photos offline and have project managers approve them.",
    );
    await page.locator("form[action='?/create'] button[type=submit], button:has-text('Start')").first().click();
    await page.waitForURL(/\/new\/discovery\//, { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/desktop-firstrun-discovery.png`, fullPage: true });
    console.log(`captured desktop-firstrun-discovery → ${page.url()}`);
    const discoveryUrl = page.url();
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
    const mp = await m.newPage();
    await shot(mp, "mobile-firstrun-discovery", discoveryUrl);
    await m.close();
  } else {
    console.error("first-run composer not found");
  }
  await ctx.close();
}

await browser.close();
console.log("done");
