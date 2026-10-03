import { describe, expect, test } from "bun:test";
import { TASK_DECOMPOSITION_SYSTEM_PROMPT } from "@sdd/ai";
import {
  appShellLine,
  hasShellTask,
  planGaps,
  RENDER_SHOT_DIR,
  renderCheckLine,
  repairInstruction,
  screenConstraint,
  SHELL_REPAIR_INSTRUCTION,
  templateAppearanceLines,
} from "../src/modules/task/generation.js";
import { LayoutReferenceSchema, type UxReference } from "@sdd/contracts";
import { NEUTRAL_SPEC } from "../src/modules/ux/ux-shell.js";
import { hasRenderCheck, lintTask, screenFilesOf } from "../src/modules/task/lint.js";
import { autoApproveWithheld, screenReviewOf, withRenderCheck } from "../src/modules/task/screen-review.js";

const screens = [
  { key: "dashboard", name: "Dasbor", screen_type: "dashboard" },
  { key: "pengaturan", name: "Pengaturan", screen_type: "settings" },
  { key: "inventory-stock", name: "Stok Inventaris", screen_type: "list" },
] as never;

test("task and build context retain global and screen-specific template visual overrides", () => {
  const template = LayoutReferenceSchema.parse({ name: "Blue", digest: "blue", analysed_at: new Date().toISOString(), source_chars: 80, mode: "adapt", brief: { archetype: "Dashboard" }, design_system: { ...NEUTRAL_SPEC, light: { ...NEUTRAL_SPEC.light, accent: "#465fff" } } });
  const ref: UxReference = { applicable: true, fidelity: "styled", layout_reference: template, screens: [{ key: "dashboard", name: "Dashboard", purpose: "Stock", requirement_keys: [], key_elements: [] }, { key: "login", name: "Login", purpose: "Sign in", requirement_keys: [], key_elements: [], layout_reference: { ...template, name: "Auth", design_system: { ...NEUTRAL_SPEC, fonts: { ...NEUTRAL_SPEC.fonts, body: 'Georgia, serif' } } } }] };
  const lines = templateAppearanceLines(ref).join("\n");
  expect(lines).toContain("Do not revert"); expect(lines).toContain("#465fff"); expect(lines).toContain("template Auth"); expect(lines).toContain("Georgia");
  expect(templateAppearanceLines({ ...ref, fidelity: "neutral" })).toEqual([]);
  expect(templateAppearanceLines({ ...ref, layout_reference: { ...template, mode: "layout" }, screens: [ref.screens[0]!] })).toEqual([]);
});

describe("application shell in task generation", () => {
  test("the APP SHELL line names the navigation form, destinations in order (settings last) and utilities", () => {
    const line = appShellLine({ screens, shell: { layout: "sidebar", search: false, notifications: true, account: true, reason: "" } } as never);
    expect(line).toContain("side navigation (sidebar)");
    expect(line.indexOf("Dasbor")).toBeLessThan(line.indexOf("Stok Inventaris"));
    expect(line.indexOf("Stok Inventaris")).toBeLessThan(line.indexOf("Pengaturan"));
    expect(line).toContain("notifications");
    expect(line).not.toContain("global search");
    expect(appShellLine({ screens, shell: { layout: "topnav", search: false, notifications: false, account: false, reason: "" } } as never)).toContain("top navigation bar");
    expect(appShellLine({ screens, platform: { kind: "native-mobile", os: "android", devices: ["phone"], source: "detected", reason: "" } } as never)).toContain("bottom navigation bar");
  });

  test("the FiberOptik plan (23 tasks, no shell) is caught; a plan with a shell task passes", () => {
    const fiber = [
      "Inisialisasi Project Skeleton, Konfigurasi Vitest, Drizzle, dan Better Auth",
      "Inisialisasi Design System shadcn/ui dan Theme Tokens",
      "Halaman Login Pengguna Berbasis Peran",
      "Layar Manajemen Gudang dan Katalog Stok Inventaris FO",
      "Layar Dasbor Utama Gudang dan Monitoring Mutasi",
    ].map((title) => ({ title, task_type: "frontend" }));
    expect(hasShellTask({ tasks: fiber })).toBe(false);
    expect(hasShellTask({ tasks: [...fiber, { title: "Shell aplikasi: sidebar navigasi dan header", task_type: "frontend" }] })).toBe(true);
    expect(hasShellTask({ tasks: [{ title: "Application shell and navigation layout", task_type: "frontend" }] })).toBe(true);
  });

  test("the decomposition prompt and the repair instruction require the shell task", () => {
    expect(TASK_DECOMPOSITION_SYSTEM_PROMPT).toContain("APPLICATION SHELL");
    expect(TASK_DECOMPOSITION_SYSTEM_PROMPT).toContain("owns the root layout");
    expect(SHELL_REPAIR_INSTRUCTION).toContain("depend on it");
  });

  test("a shell is named in the title, builds no screen, and screen tasks depend on it", () => {
    const screenTask = (ref: string, deps: string[] = []) => ({
      ref,
      title: `Screen ${ref}`,
      task_type: "frontend",
      constraints: [`${screenConstraint(false, true).replace("<file>", `docs/ui-reference/${ref}.html`)}`],
      depends_on_refs: deps,
    });
    // An objective that mentions a responsive layout is not a shell task.
    expect(hasShellTask({ tasks: [{ title: "Dashboard widgets", objective: "Tata letak responsif untuk dasbor", task_type: "frontend" }] })).toBe(false);
    // The design-system setup owns the root layout; that does not make it the shell.
    expect(hasShellTask({ tasks: [{ ref: "ds", title: "Design system setup and root layout", task_type: "frontend" }] })).toBe(false);
    const shell = { ref: "shell", title: "Application shell: sidebar navigation", task_type: "frontend" };
    expect(hasShellTask({ tasks: [shell, screenTask("dashboard", ["shell"])] })).toBe(true);
    expect(hasShellTask({ tasks: [{ ...shell, task_type: "ui" }, screenTask("dashboard", ["shell"])] })).toBe(true);
    // A shell no screen renders inside is not the shell the screens use.
    expect(hasShellTask({ tasks: [shell, screenTask("dashboard", ["ds"])] })).toBe(false);
    // A screen task whose title says "navigation" is still a screen task.
    expect(hasShellTask({ tasks: [{ ...screenTask("nav"), title: "Navigation drawer screen" }] })).toBe(false);
  });
});

describe("screen tasks carry the shell and a render check (docs/28 R1, R4)", () => {
  const webUx = {
    applicable: true,
    screens: [
      { key: "login", name: "Masuk", screen_type: "form", key_elements: [] },
      { key: "dashboard", name: "Dasbor", screen_type: "dashboard", key_elements: ["kartu ringkasan stok", "tabel mutasi terbaru"] },
      { key: "gudang", name: "Gudang", screen_type: "list", key_elements: [] },
    ],
  } as never;
  const nativeUx = { ...(webUx as object), platform: { kind: "native-mobile", os: "android", devices: ["phone"], source: "detected", reason: "" } } as never;
  const sentence = (file: string) => screenConstraint(false, true).replace("<file>", file);
  const plan = (tasks: unknown[]) => ({ features: [], tasks }) as never;
  const task = (ref: string, commands: Array<{ type?: string; command: string }>, constraints = [sentence(`docs/ui-reference/${ref}.html`)]) => ({
    ref,
    title: `Screen ${ref}`,
    task_type: "frontend",
    constraints,
    depends_on_refs: ["shell"],
    verification: { required: commands },
  });

  test("every screen constraint sentence says it renders inside the shell and fits the 400-character contract limit", () => {
    const file = "docs/ui-reference/laporan-stok-opname-bulanan-per-gudang.html";
    for (const styled of [true, false]) {
      for (const ds of [true, false]) {
        for (const native of [null, "React Native"]) {
          const s = screenConstraint(styled, ds, native).replace("<file>", file);
          expect(s).toContain("inside the app shell");
          expect(s.length).toBeLessThanOrEqual(400);
        }
      }
    }
  });

  test("a screen task is found by its constraint sentence; citing a mockup elsewhere is not building it", () => {
    expect(screenFilesOf({ constraints: [sentence("docs/ui-reference/dashboard.html")] })).toEqual(["docs/ui-reference/dashboard.html"]);
    expect(screenFilesOf({ title: "Application shell", constraints: ["Navigation matches the sidebar in docs/ui-reference/dashboard.html"] })).toEqual([]);
  });

  test("a reworded screen sentence still names a screen task; the shell task citing mockups does not", () => {
    expect(screenFilesOf({ title: "Gudang list", constraints: ["Follows the mockup at docs/ui-reference/gudang.html exactly"] })).toEqual(["docs/ui-reference/gudang.html"]);
    expect(screenFilesOf({ title: "App shell and sidebar", constraints: ["Navigation matches docs/ui-reference/dashboard.html"] })).toEqual([]);
    // The strict sentence wins when present: other mockups it cites are context, not screens it builds.
    expect(screenFilesOf({ title: "Dashboard", constraints: [sentence("docs/ui-reference/dashboard.html"), "Links to docs/ui-reference/gudang.html"] })).toEqual(["docs/ui-reference/dashboard.html"]);
  });

  test("the render check covers sign-in, data and the browser install", () => {
    const line = renderCheckLine(webUx)!;
    expect(line).toContain("signs in first");
    expect(line).toContain("seeds or stubs the data");
    expect(TASK_DECOMPOSITION_SYSTEM_PROMPT).toContain("playwright install chromium");
    expect(TASK_DECOMPOSITION_SYSTEM_PROMPT).toContain("sign-in fixture");
  });

  test("a stuck draft screen task gets the standard render check, run the way its other checks run", () => {
    const contract = (commands: Array<{ type: "command" | "manual"; command: string }>, deliverables = ["implementation"]) => ({
      title: "Gudang",
      constraints: [sentence("docs/ui-reference/gudang.html")],
      verification: { required: commands, evidence: ["test_result"] },
      deliverables,
    }) as never;
    const added = withRenderCheck(contract([{ type: "command", command: "bun test src/gudang" }]))!;
    expect(added.verification.required.at(-1)).toEqual({ type: "command", command: "bunx playwright test e2e/render/gudang.spec.ts" });
    expect(added.deliverables).toContain("automated_tests");
    expect(withRenderCheck(contract([{ type: "command", command: "pnpm vitest run" }]))!.verification.required.at(-1)!.command).toStartWith("pnpm exec playwright");
    expect(withRenderCheck(contract([]))!.verification.required[0]!.command).toStartWith("npx playwright");
    // Already checked, or no screen at all: nothing to add.
    expect(withRenderCheck(contract([{ type: "command", command: "npx playwright test e2e/render/gudang.spec.ts" }]))).toBeNull();
    expect(withRenderCheck({ title: "Api", constraints: [], verification: { required: [], evidence: [] }, deliverables: ["implementation"] } as never)).toBeNull();
    // Six checks is the contract's limit: say so instead of dropping one.
    const six = Array.from({ length: 6 }, (_, i) => ({ type: "command" as const, command: `npm test -- ${i}` }));
    expect(() => withRenderCheck(contract(six))).toThrow("six checks");
  });

  test("only a Playwright command is a render check — jsdom, unit and manual checks are not", () => {
    expect(hasRenderCheck({ verification: { required: [{ type: "command", command: "npx playwright test e2e/render/dashboard.spec.ts" }] } })).toBe(true);
    expect(hasRenderCheck({ verification: { required: [{ type: "command", command: "npx vitest run src/app/dashboard/page.test.tsx" }] } })).toBe(false);
    expect(hasRenderCheck({ verification: { required: [{ type: "manual", command: "Open the page in Playwright and look" }] } })).toBe(false);
  });

  test("the RENDER CHECK line names both widths and where screenshots go; native references have none", () => {
    const line = renderCheckLine(webUx)!;
    expect(line).toContain("1280×800");
    expect(line).toContain("360×800");
    expect(line).toContain(`${RENDER_SHOT_DIR}/<screen key>-1280.png`);
    expect(line).toContain("e2e/render/dashboard.spec.ts"); // the example skips the login screen
    expect(renderCheckLine(nativeUx)).toBeNull();
    expect(TASK_DECOMPOSITION_SYSTEM_PROMPT).toContain("RENDER CHECK line");
  });

  test("one repair turn asks for the shell and the missing render checks together", () => {
    const vitest = [{ type: "command", command: "npx vitest run" }];
    const playwright = [{ type: "command", command: "bunx playwright test e2e/render/gudang.spec.ts" }];
    const p = plan([task("dashboard", vitest), task("gudang", playwright)]);
    const gaps = planGaps(p, webUx);
    expect(gaps).toEqual({ shell: true, unchecked: ["dashboard"] });
    const ask = repairInstruction(gaps)!;
    expect(ask).toContain("APPLICATION SHELL");
    expect(ask).toContain("no RENDER CHECK: dashboard");
    expect(ask.endsWith("Return the complete TaskPlan.")).toBe(true);
    // Native screens have no render check to ask for; a complete plan needs no repair.
    expect(planGaps(p, nativeUx).unchecked).toEqual([]);
    const shell = { ref: "shell", title: "App shell and navigation", task_type: "frontend", constraints: [], verification: { required: vitest } };
    expect(repairInstruction(planGaps(plan([shell, task("dashboard", playwright)]), webUx))).toBeNull();
  });

  test("the policy never approves a web screen task without a render check; the reviewer gets the screen's rubric", () => {
    const contract = (commands: Array<{ type: string; command: string }>, file = "docs/ui-reference/dashboard.html") => ({
      constraints: [sentence(file)],
      verification: { required: commands, evidence: [] },
    }) as never;
    const vitest = [{ type: "command", command: "npx vitest run" }];
    const playwright = [{ type: "command", command: "npx playwright test e2e/render/dashboard.spec.ts" }];
    expect(autoApproveWithheld(contract(vitest), webUx)).toContain("no render check");
    expect(autoApproveWithheld(contract(playwright), webUx)).toBeNull();
    // Native screens, tasks that build no screen, and projects without an approved reference are left to the usual policy.
    expect(autoApproveWithheld(contract(vitest), nativeUx)).toBeNull();
    expect(autoApproveWithheld({ constraints: [], verification: { required: vitest, evidence: [] } } as never, webUx)).toBeNull();
    expect(autoApproveWithheld(contract(vitest), null)).toBeNull();

    const review = screenReviewOf(contract(playwright), webUx)!;
    expect(review.screens).toEqual([{ file: "docs/ui-reference/dashboard.html", name: "Dasbor", key_elements: ["kartu ringkasan stok", "tabel mutasi terbaru"], inside_shell: true }]);
    expect(review.render_check).toEqual({ required: true, command: "npx playwright test e2e/render/dashboard.spec.ts" });
    expect(review.screenshots_dir).toBe(RENDER_SHOT_DIR);
    expect(screenReviewOf(contract(vitest, "docs/ui-reference/login.html"), webUx)!.screens[0]!.inside_shell).toBe(false);
    expect(screenReviewOf(contract(vitest), nativeUx)!.render_check.required).toBe(false);
  });

  test("lint blocks a web screen task without a render check and flags key elements missing from its criteria", () => {
    const base = { hasTraceability: true, dependenciesExist: true, graphAcyclic: true, artifactsCurrent: true, duplicateTitles: 1, reviewPolicyResolved: true };
    const keyElements = { "docs/ui-reference/dashboard.html": ["kartu ringkasan stok", "tabel mutasi terbaru"] };
    const row = (commands: Array<{ type: "command" | "manual"; command: string }>, criteria: string[]) => ({
      key: "TASK-005",
      title: "Dashboard screen",
      objective: "Build the warehouse dashboard screen as the mockup shows",
      workflowStatus: "DRAFT",
      contract: {
        title: "Dashboard screen",
        task_type: "frontend",
        objective: "Build the warehouse dashboard screen as the mockup shows",
        scope: { expected_paths: ["src/app/(app)/dashboard"], forbidden_paths: [] },
        constraints: [sentence("docs/ui-reference/dashboard.html")],
        acceptance_criteria: criteria,
        verification: { required: commands, evidence: ["test_result"] },
        deliverables: ["implementation", "automated_tests"],
        stop_conditions: ["The API contract is missing"],
        risk_factors: { ambiguity: 1, blast_radius: 1, cross_module: 1, concurrency: 0, database_impact: 0, security: 0, integration: 1, verification: 1, context_size: 1 },
        parallel_safe: false,
        priority: "P1",
        dependency_outputs: {},
      },
    }) as never;
    const jsdomOnly = lintTask(row([{ type: "command", command: "npx vitest run" }], ["Shows the stock summary cards"]), { ...base, ui: { renderChecks: true, keyElements } });
    expect(jsdomOnly.ok).toBe(false);
    expect(jsdomOnly.findings.map((f) => f.id)).toContain("no_render_check");
    const missing = jsdomOnly.findings.find((f) => f.id === "key_elements_missing");
    expect(missing?.severity).toBe("BLOCKING");
    expect(missing?.message).toContain("kartu ringkasan stok");
    expect(missing?.message).toContain("tabel mutasi terbaru");

    const good = lintTask(
      row([{ type: "command", command: "npx playwright test e2e/render/dashboard.spec.ts" }], ["Menampilkan kartu ringkasan stok per gudang", "Tabel mutasi terbaru berisi 10 baris"]),
      { ...base, ui: { renderChecks: true, keyElements } },
    );
    expect(good.findings.map((f) => f.id)).not.toContain("no_render_check");
    expect(good.findings.map((f) => f.id)).not.toContain("key_elements_missing");
    // A native reference has no browser to load: no render check is required.
    expect(lintTask(row([{ type: "command", command: "npx jest" }], ["x"]), { ...base, ui: { renderChecks: false, keyElements: {} } }).findings.map((f) => f.id)).not.toContain("no_render_check");
    // Without an approved UI reference the screen checks do not run.
    expect(lintTask(row([{ type: "command", command: "npx jest" }], ["x"]), base).findings.map((f) => f.id)).not.toContain("no_render_check");
  });
});

describe("sign-in screens sit outside the app shell", () => {
  test("login screens are recognised by key or name; app screens are not", async () => {
    const { isAuthScreen } = await import("../src/modules/ux/ux-od-seeds.js");
    expect(isAuthScreen({ key: "login", name: "Masuk Sistem" })).toBe(true);
    expect(isAuthScreen({ key: "masuk-sistem", name: "Masuk" })).toBe(true);
    expect(isAuthScreen({ key: "sign-in", name: "Sign in" })).toBe(true);
    expect(isAuthScreen({ key: "inbound-goods", name: "Barang Masuk" })).toBe(false);
    expect(isAuthScreen({ key: "dashboard", name: "Dasbor Gudang" })).toBe(false);
  });
  test("navigation never lists the login screen, and the APP SHELL line puts it outside", async () => {
    const { navItems } = await import("../src/modules/ux/ux-od-seeds.js");
    const screens = [
      { key: "login", name: "Masuk Sistem", screen_type: "form" },
      { key: "dashboard", name: "Dasbor Gudang", screen_type: "dashboard" },
      { key: "inbound-goods", name: "Barang Masuk", screen_type: "form" },
    ];
    const nav = navItems("side", screens as never, "dashboard");
    expect(nav).not.toContain("Masuk Sistem");
    expect(nav).toContain("Barang Masuk");
    const line = appShellLine({ screens, shell: { layout: "sidebar", search: false, notifications: false, account: true, reason: "" } } as never);
    expect(line.split("\n")[1]).not.toContain("Masuk Sistem");
    expect(line).toContain("outside the shell");
  });
});
