import { describe, expect, test } from "bun:test";
import { DesignSystemSpecSchema, type DesignSystemSpec, type UxLintFinding, type UxReference, type UxSampleData, type UxScreen } from "@sdd/contracts";
import { UX_OD_CHARTER } from "@sdd/ai";
import { DESIGN_SYSTEM_PRESETS } from "../src/modules/design-system/presets.js";
import { odTokensCss } from "../src/modules/design-system/od-tokens.js";
import { acceptScreenRepair, lintOptionsFor, lintRepairInstruction, lintScreenHtml } from "../src/modules/ux/ux-lint.js";
import { assembleOdScreen, cleanOdCss, extractOdBody, isOdDocument, partialOdBody, refreshNav } from "../src/modules/ux/ux-od.js";
import { lintOdScreen } from "../src/modules/ux/ux-od-lint.js";
import { odElementSystemPrompt, odScreenPrompt, odSeedOf } from "../src/modules/ux/ux-od-prompt.js";
import { navMarkup, selectSeed } from "../src/modules/ux/ux-od-seeds.js";
import { referenceFromPlan } from "../src/modules/ux/ux-plan.js";
import { UX_RULES, isBlocking } from "../src/modules/ux/ux-rules.js";
import { NEUTRAL_SPEC, assembleScreen, isFramed, screenContent, withNodeIds } from "../src/modules/ux/ux-shell.js";
import { applyStatusTones } from "../src/modules/ux/ux-status.js";

function specFrom(id: string): DesignSystemSpec {
  const { id: _id, tags: _tags, ...preset } = DESIGN_SYSTEM_PRESETS.find((p) => p.id === id)!;
  return DesignSystemSpecSchema.parse({ ...preset, preset_id: id, component_library: "none" });
}

const STYLED = specFrom("modern-saas");

const sample: UxSampleData = {
  records: [
    { kind: "order", name: "Order #1042", facts: "Table 7, Rp 185.000, 3 items" },
    { kind: "order", name: "Order #1043", facts: "Takeaway, Rp 92.000" },
  ],
  people: [{ name: "Mei Lin", role: "cashier" }],
  notes: "",
  statuses: [{ label: "Paid", tone: "success" }],
  aggregates: [{ label: "Sales today", value: "Rp 277.000", basis: "both orders" }],
} as UxSampleData;

function screen(key: string, extra: Partial<UxScreen> = {}): UxScreen {
  return {
    key,
    name: key[0]!.toUpperCase() + key.slice(1),
    purpose: `Work with ${key}`,
    requirement_keys: ["FR-1"],
    key_elements: ["Open orders list", "Order total"],
    screen_type: "list",
    overlays: [{ kind: "dialog", name: "New order", purpose: "", result: "" }],
    html: null,
    ...extra,
  } as UxScreen;
}

function reference(extra: Partial<UxReference> = {}): UxReference {
  return {
    rules_version: 2,
    generator: "od",
    applicable: true,
    reason: "",
    recommended_count: 3,
    count_rationale: "",
    requested_count: null,
    fidelity: "styled",
    design_system_version: 1,
    guidance: "",
    shell: { search: false, notifications: false, account: false, reason: "" },
    sample_data: sample,
    screens: [screen("orders"), screen("menu"), screen("reports", { screen_type: "analytics" })],
    ...extra,
  } as UxReference;
}

/** A body the od charter asks for: app root, nav slot, main with markers, overlays with a frame. */
const GOOD_BODY = `<style data-screen>.x-total{gap:var(--space-2)}</style>
<div class="app app-side" data-sdd-app>
  <aside class="sidebar">
    <div class="brand" data-sdd-brand>KR</div>
    <nav class="side-nav" data-sdd-nav="side" aria-label="Main"><a class="nav-item" href="./orders.html">Orders</a></nav>
  </aside>
  <div class="workspace">
    <main class="main" data-screen-content>
      <header class="page-head"><h1>Open orders</h1><button class="btn btn-primary"><i data-icon="plus"></i>New order</button></header>
      <section class="section" data-od-id="orders" data-key-element="1">
        <ul class="list"><li class="list-row">Order #1042 <span class="badge">Paid</span></li><li class="list-row">Order #1043</li></ul>
      </section>
      <section class="section" data-od-id="total" data-key-element="2">
        <div class="stat"><span class="stat-label">Sales today</span><span class="stat-num">Rp 277.000</span></div>
        <a class="btn" href="./menu.html">Menu</a>
      </section>
    </main>
  </div>
</div>
<section class="overlays" data-sdd-overlays aria-label="Overlays and states">
  <figure class="frame" data-sdd-frame data-kind="dialog">
    <figcaption>Dialog: New order</figcaption>
    <div class="stage" data-sdd-stage><div class="dialog" role="dialog"><h2>New order</h2><div class="field"><label for="t">Table</label><input class="input" id="t"></div></div></div>
  </figure>
</section>`;

const opts = (ref = reference(), key = "orders", spec: DesignSystemSpec | null = STYLED) =>
  lintOptionsFor(ref, ref.screens.find((s) => s.key === key), spec);
const rules = (findings: UxLintFinding[]) => findings.map((f) => f.rule);

describe("od seed selection", () => {
  test("dashboard and analytics screens on the web use the dashboard seed; other web screens the web-app seed", () => {
    expect(selectSeed({ screenType: "dashboard", neutral: false }).id).toBe("dashboard");
    expect(selectSeed({ screenType: "analytics", neutral: false }).id).toBe("dashboard");
    expect(selectSeed({ screenType: "list", neutral: false }).id).toBe("web-app");
    expect(selectSeed({ screenType: "form", neutral: false, layout: "topnav" }).structure).toBe("web-topnav");
    expect(selectSeed({ screenType: "form", neutral: false, layout: "minimal" }).structure).toBe("web-minimal");
  });

  test("a native app uses the android-app seed (Material 3 chrome, rail at 600px)", () => {
    const seed = selectSeed({ platform: { kind: "native-mobile", devices: ["phone"] } as never, screenType: "dashboard", neutral: false });
    expect(seed.id).toBe("android-app");
    expect(seed.structure).toBe("android");
    expect(seed.css).toContain(".bottom-nav");
    expect(seed.css).toContain("@media(min-width:600px)");
    expect(seed.skeleton).toContain('data-sdd-nav="rail"');
    expect(seed.skeleton).toContain('data-sdd-nav="bottom"');
  });

  test("neutral fidelity always uses the wireframe seed, on the platform's structure", () => {
    expect(selectSeed({ screenType: "dashboard", neutral: true }).id).toBe("wireframe");
    expect(selectSeed({ platform: { kind: "native-mobile", devices: ["phone"] } as never, neutral: true }).structure).toBe("android");
  });

  test("seed CSS uses only the token contract — no raw colours", () => {
    for (const seed of [selectSeed({ neutral: false }), selectSeed({ screenType: "dashboard", neutral: false }), selectSeed({ platform: { kind: "native-mobile", devices: ["phone"] } as never, neutral: true })]) {
      expect(seed.css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
      expect(seed.skeleton).toContain("data-sdd-app");
      expect(seed.skeleton).toContain("data-screen-content");
      expect(seed.skeleton).toContain("data-sdd-overlays");
      expect(seed.skeleton).toContain("[REPLACE");
      expect(seed.craft.length).toBeGreaterThan(0);
      expect(seed.p0.length).toBeGreaterThan(0);
    }
  });
});

describe("od prompt", () => {
  const ref = reference();
  const s = ref.screens[0]!;

  test("system prompt follows open-design's layer order: charter → design system → craft → seed", () => {
    const { system, seed } = odScreenPrompt({ ref, screen: s, spec: STYLED, projectText: "PROJECT: Kasir", sample });
    expect(seed.id).toBe("web-app");
    const at = (needle: string) => system.indexOf(needle);
    expect(system.startsWith(UX_OD_CHARTER)).toBe(true);
    expect(at("## Active design system")).toBeGreaterThan(0);
    expect(at("## Active craft references")).toBeGreaterThan(at("## Active design system"));
    expect(at("## Active seed template — web-app")).toBeGreaterThan(at("## Active craft references"));
    // The platform injects the tokens; the model is never told to paste them.
    expect(system).not.toContain("Paste the unscoped");
    expect(system).toContain("<style data-tokens>");
    for (const craft of ["state-coverage", "laws-of-ux", "form-validation", "anti-ai-slop"]) expect(system).toContain(craft);
  });

  test("user message: brief and platform → project → other screens with the exact nav markup → sample data → screen plan → output contract", () => {
    const { user, seed } = odScreenPrompt({ ref: { ...ref, brief: { users: "Cashiers at a busy counter", devices: "", direction: "", hierarchy: "", references: "", assumptions: [], source: "user" } as never }, screen: s, spec: STYLED, projectText: "PROJECT: Kasir", sample });
    const order = ["PRODUCT BRIEF", "PLATFORM:", "PROJECT: Kasir", "OTHER SCREENS", "NAVIGATION —", "SHARED EXAMPLE DATA", "SCREEN TO PRODUCE", "KEY ELEMENTS", "OVERLAYS", "OUTPUT:"];
    const positions = order.map((n) => user.indexOf(n));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(user).toContain(navMarkup(seed.structure, ref.screens, s.key));
    expect(user).toContain('<a class="nav-item" href="./orders.html" aria-current="page">');
    expect(user).toContain("./menu.html");
    expect(user).toContain('data-sdd-frame data-kind="dialog|sheet|confirm"');
    // Badge tones in the seed's class names.
    expect(user).toContain("Paid = badge-success");
    expect(user).not.toContain("ds-badge");
  });

  test("neutral fidelity: a wireframe note instead of design-system blocks, the wireframe seed", () => {
    const { system, seed } = odScreenPrompt({ ref: reference({ fidelity: "neutral" }), screen: s, spec: null, projectText: "P", sample });
    expect(seed.id).toBe("wireframe");
    expect(system).toContain("Fidelity — neutral wireframe");
    expect(system).not.toContain("## Active design system");
    expect(system).toContain("## Active craft references");
  });

  test("a minimal shell has no navigation slot to copy", () => {
    const { user } = odScreenPrompt({ ref: reference({ shell: { search: false, notifications: false, account: false, reason: "", layout: "minimal" } as never }), screen: s, spec: STYLED, projectText: "P" });
    expect(user).toContain("NAVIGATION: this screen has no persistent navigation");
  });

  test("the element-edit system prompt carries the seed's classes and the design system", () => {
    const prompt = odElementSystemPrompt(odSeedOf(ref, s, STYLED), STYLED);
    expect(prompt).toContain("Class vocabulary");
    expect(prompt).toContain("## Active design system");
    expect(prompt).not.toContain("Paste the unscoped");
  });
});

describe("od assembly", () => {
  const ref = reference();
  const assemble = (content: string, spec = STYLED, key = "orders") =>
    assembleScreen({ content, spec, brand: "Kasir Restoran", screens: ref.screens, currentKey: key, shell: ref.shell, platform: ref.platform, generator: "od" });

  test("the document: CSP, then the tokens, then the seed CSS, then the body with its markers", () => {
    const doc = assemble(GOOD_BODY);
    const csp = doc.indexOf("Content-Security-Policy");
    const tokens = doc.indexOf("<style data-tokens>");
    const seed = doc.indexOf('<style data-seed="web-app">');
    const body = doc.indexOf('<body data-sdd-generator="od" data-sdd-seed="web-app">');
    expect(csp).toBeGreaterThan(0);
    expect(tokens).toBeGreaterThan(csp);
    expect(seed).toBeGreaterThan(tokens);
    expect(body).toBeGreaterThan(seed);
    expect(doc).toContain(odTokensCss(STYLED));
    expect(isOdDocument(doc)).toBe(true);
    expect(isFramed(doc)).toBe(true);
    // Icons drawn, brand and navigation from the platform.
    expect(doc).toContain('<svg class="ds-icon" data-icon="plus"');
    expect(doc).toContain('<span class="brand-name">Kasir Restoran</span>');
    expect(doc).toContain('href="./reports.html"');
    expect(doc).toContain('<a class="nav-item" href="./orders.html" aria-current="page">');
  });

  test("tokens and seed CSS from the model or the client are dropped; the screen style is cleaned", () => {
    const hostile = `<style data-tokens>:root{--accent:red}</style><style data-seed="x">.btn{color:red}</style>
<style data-screen>@import url(https://evil.example/x.css); @font-face{font-family:X;src:url(https://evil.example/f.woff)}
.x-a{background:url(https://evil.example/p.png);gap:var(--space-2)} .x-b{--accent:#ff0000;padding:var(--space-3)}</style>${GOOD_BODY}`;
    const doc = assemble(hostile);
    expect(doc.match(/<style data-tokens>/g)?.length).toBe(1);
    expect(doc).not.toContain("--accent:red");
    expect(doc).not.toContain('data-seed="x"');
    expect(doc).not.toContain("evil.example");
    expect(doc).not.toContain("@import");
    expect(doc).not.toContain("@font-face");
    expect(doc).not.toContain("#ff0000");
    expect(doc).toContain("gap:var(--space-2)");
    // One screen style, first in the body.
    expect(screenContent(doc).startsWith("<style data-screen>")).toBe(true);
    expect(screenContent(doc).match(/<style\b/g)?.length).toBe(1);
  });

  test("cleanOdCss keeps layout declarations and drops fetches and token redefinitions", () => {
    expect(cleanOdCss(".x{gap:4px;background-image:image-set(a.png 1x);--fg:#000;--x-gap:2px}")).toBe(".x{gap:4px;--x-gap:2px}");
  });

  test("screenContent of an od document is its body; re-framing is stable, with ids", () => {
    const doc = withNodeIds(assemble(GOOD_BODY));
    const body = screenContent(doc);
    expect(body).toContain("data-sdd-app");
    expect(body).not.toContain("<head>");
    const again = assemble(body);
    expect(again).toBe(doc);
  });

  test("the navigation follows the reference's screen list; the bottom bar holds five with More", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((k) => ({ key: k, name: k.toUpperCase() }));
    const nav = refreshNav('<nav class="bottom-nav" data-sdd-nav="bottom"><a href="./zzz.html">Old</a></nav>', many, "f");
    expect(nav).not.toContain("zzz");
    expect(nav).toContain('href="./f.html" aria-current="page"');
    expect(nav).toContain(">More<");
    expect(nav).toContain("--tabs:5");
    expect((nav.match(/class="bottom-item"/g) ?? []).length).toBe(5);
  });

  test("neutral screens get the wireframe tokens with a dark variant and the wireframe seed", () => {
    const doc = assemble(GOOD_BODY, NEUTRAL_SPEC);
    expect(doc).toContain('<style data-seed="wireframe">');
    expect(doc).toContain('[data-theme="dark"]');
    expect(doc).toContain(odTokensCss(NEUTRAL_SPEC));
  });

  test("an Android reference is framed with the android-app seed", () => {
    const doc = assembleScreen({ content: GOOD_BODY, spec: STYLED, brand: "K", screens: ref.screens, currentKey: "orders", platform: { kind: "native-mobile", devices: ["phone", "tablet"] } as never, generator: "od" });
    expect(doc).toContain('data-sdd-seed="android-app"');
  });

  test("the body is read from whatever the model wrapped around it; a stream shows the body so far", () => {
    const text = "```html\n<!doctype html><html><head><title>x</title><style data-tokens>:root{}</style></head><body class=\"x\">" + GOOD_BODY + "</body></html>\n```";
    const body = extractOdBody(text);
    expect(body.startsWith("<style data-screen>")).toBe(true);
    expect(body).not.toContain("data-tokens");
    expect(body).not.toContain("<title>");
    expect(partialOdBody("<!doctype html><html><head><style>")).toBe("");
    expect(partialOdBody('<div class="app" data-sdd-app><main data-screen-content><h1>Ord')).toBe('<div class="app" data-sdd-app><main data-screen-content><h1>Ord');
    expect(partialOdBody('<div class="app" data-sdd-app><a href="./x.ht')).toBe('<div class="app" data-sdd-app>');
  });
});

describe("od lint", () => {
  const ref = reference();

  test("a complete screen has no blocking findings", () => {
    const findings = lintScreenHtml(GOOD_BODY, "styled", opts());
    expect(findings.filter(isBlocking)).toEqual([]);
    expect(rules(findings)).not.toContain("nav-missing");
    expect(rules(findings)).not.toContain("missing-marker");
  });

  test("the approval rules hold, read through the markers", () => {
    const broken = GOOD_BODY.replace(' data-key-element="2"', "")
      .replace(/<section class="overlays"[\s\S]*<\/section>$/, '<section data-sdd-overlays><figure data-sdd-frame data-kind="state"><figcaption>State: Empty</figcaption></figure></section>')
      .replace('<label for="t">Table</label>', "")
      .replace("Rp 277.000", "Rp 9.999.000")
      .replace(".x-total{gap:var(--space-2)}", ".x-total{color:#ff0000}");
    const found = rules(lintScreenHtml(broken, "styled", opts()));
    for (const r of ["missing-key-element", "missing-overlay", "raw-colour", "unsourced-metric"]) expect(found).toContain(r);
    // The dialog (and its field) left with the overlay: an unlabelled field elsewhere still blocks.
    expect(rules(lintScreenHtml(GOOD_BODY.replace('<label for="t">Table</label>', ""), "styled", opts()))).toContain("unlabelled-field");
  });

  test("navigation and links between screens", () => {
    const noNav = GOOD_BODY.replace(/<nav[\s\S]*?<\/nav>/, "").replace('href="./menu.html"', 'href="./kitchen.html"');
    const found = rules(lintScreenHtml(noNav, "styled", opts()));
    expect(found).toContain("nav-missing");
    expect(found).toContain("broken-link");
    const minimal = reference({ shell: { search: false, notifications: false, account: false, reason: "", layout: "minimal" } as never });
    expect(rules(lintScreenHtml(noNav, "styled", opts(minimal)))).not.toContain("nav-missing");
  });

  test("open-design's rules are warnings", () => {
    const sloppy = GOOD_BODY.replace(
      ".x-total{gap:var(--space-2)}",
      `.x-hero{background:linear-gradient(90deg,#3b82f6,#8b5cf6)}.x-band{background:linear-gradient(#7c3aed,#a855f7)}
.x-card{border-left:4px solid var(--accent)}.x-h{font-family:Inter, sans-serif}.x-cap{text-transform:uppercase}
.x-1{color:var(--accent)}.x-2{color:var(--accent)}.x-3{color:var(--accent)}.x-4{color:var(--accent)}.x-5{color:var(--accent)}.x-6{color:var(--accent)}`,
    )
      .replace("<h1>Open orders</h1>", "<h1>Open orders</h1><p>99.9% uptime, lorem ipsum dolor sit amet</p><img alt=\"Dish\"><button class=\"btn\">🗑️</button>")
      .replace('<section class="section" data-od-id="total"', '<section class="section"')
      .replace("</main>", `<svg viewBox="0 0 10 10">${Array.from({ length: 13 }, (_, i) => `<rect fill="#10${String(i).padStart(2, "0")}aa" width="1" height="1"></rect>`).join("")}</svg></main>`);
    const findings = lintOdScreen(sloppy, opts());
    const found = rules(findings);
    for (const r of [
      "trust-gradient",
      "ai-default-indigo",
      "left-accent-card",
      "sans-display",
      "all-caps-no-tracking",
      "invented-metric",
      "filler-copy",
      "external-image",
      "emoji-icon",
      "raw-hex",
      "accent-overuse",
      "missing-section-anchor",
    ]) {
      expect(found).toContain(r);
      expect(findings.find((f) => f.rule === r)!.action).toBe("warn");
    }
    expect(rules(lintOdScreen(GOOD_BODY.replace(".x-total{gap:var(--space-2)}", ".x-band{background:linear-gradient(#7c3aed,#a855f7)}"), opts()))).toContain("purple-gradient");
  });

  test("ai-default-indigo is token-aware: an indigo brand accent is not the AI default", () => {
    const body = GOOD_BODY.replace(".x-total{gap:var(--space-2)}", ".x-total{outline-color:#6366f1}");
    expect(rules(lintOdScreen(body, opts()))).toContain("ai-default-indigo");
    const indigoBrand = { ...STYLED, light: { ...STYLED.light, accent: "#6366F1" } };
    expect(rules(lintOdScreen(body, opts(ref, "orders", indigoBrand)))).not.toContain("ai-default-indigo");
  });

  test("every od rule is in the catalogue", () => {
    for (const r of ["missing-marker", "nav-missing", "broken-link", "purple-gradient", "trust-gradient", "ai-default-indigo", "sans-display", "invented-metric", "all-caps-no-tracking", "external-image", "raw-hex", "accent-overuse", "missing-section-anchor"]) {
      expect(UX_RULES[r]).toBeDefined();
    }
  });

  test("lint options of an od reference", () => {
    const o = opts();
    expect(o.generator).toBe("od");
    expect(o.screenKeys).toEqual(["orders", "menu", "reports"]);
    expect(o.navExpected).toBe(true);
    expect(o.accent).toBe(STYLED.light.accent);
  });

  test("a repair that drops an overlay frame is refused; the od repair asks for the body", () => {
    const before = { content: GOOD_BODY, findings: [{ rule: "filler-copy", category: "guidance", action: "warn", repair: true, message: "" }] as UxLintFinding[] };
    const dropped = GOOD_BODY.replace(/<figure[\s\S]*<\/figure>/, "");
    expect(acceptScreenRepair(before, { content: dropped, findings: [] })).toBe(false);
    expect(acceptScreenRepair(before, { content: GOOD_BODY, findings: [] })).toBe(true);
    expect(lintRepairInstruction(before.findings, "od")).toContain("inner HTML of <body>");
  });

  test("status tones use the seed's badge classes", () => {
    const out = applyStatusTones('<span class="badge">Paid</span><span class="badge badge-danger">Paid</span>', [{ label: "Paid", tone: "success" }], "od");
    expect(out.html).toBe('<span class="badge badge-success">Paid</span><span class="badge badge-success">Paid</span>');
  });
});

describe("generator choice and the legacy kit path", () => {
  test("new plans are drawn in open-design style", () => {
    const plan = { applicable: true, reason: "", recommended_count: 1, count_rationale: "", screens: [{ key: "orders", name: "Orders", purpose: "p", requirement_keys: ["FR-1"], key_elements: ["a"], screen_type: "list", overlays: [] }] };
    expect(referenceFromPlan(plan as never, { screenCount: null, guidance: "" }).generator).toBe("od");
  });

  test("a reference without a generator keeps the kit shell, kit content and kit lint", () => {
    const ref = reference({ generator: undefined });
    const content = '<div class="ds-page-header"><h1>Orders</h1></div><section class="ds-overlays"><div class="ds-frame"><div class="ds-modal"><h2>New</h2></div></div></section>';
    const doc = assembleScreen({ content, spec: STYLED, brand: "K", screens: ref.screens, currentKey: "orders", shell: ref.shell, platform: ref.platform, generator: ref.generator });
    expect(doc).toContain('class="ds-app"');
    expect(doc).not.toContain("data-sdd-generator");
    expect(isOdDocument(doc)).toBe(false);
    expect(screenContent(doc)).toBe(content);
    const o = lintOptionsFor(ref, ref.screens[0], STYLED);
    expect(o.generator).toBeUndefined();
    // The kit lint counts ds-frame overlays; the od markers mean nothing to it.
    expect(rules(lintScreenHtml(content, "styled", o))).not.toContain("missing-overlay");
    expect(rules(lintScreenHtml(GOOD_BODY, "styled", o))).toContain("missing-overlay");
  });
});

describe("leftover skeleton slots", () => {
  test("an unfilled seed slot is a repairable finding; filled content is not", () => {
    const left = lintOdScreen(`<div data-sdd-app><header class="top-app-bar"><h1 class="top-app-bar-title">[REPLACE screen title]</h1><div>[icon buttons]</div></header><main data-screen-content><p>Order</p></main></div>`);
    const f = left.find((x) => x.rule === "leftover-placeholder");
    expect(f).toBeDefined();
    expect(f!.message).toContain("[REPLACE screen title]");
    expect(f!.message).toContain("[icon buttons]");
    const filled = lintOdScreen(`<div data-sdd-app><header><h1>Kasir</h1></header><main data-screen-content><p>Total [2 items]</p></main></div>`);
    expect(filled.some((x) => x.rule === "leftover-placeholder")).toBe(false);
  });
});
