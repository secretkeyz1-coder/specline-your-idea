import { describe, expect, test } from "bun:test";
import { UxPlatformSchema, type UxPlatform, type UxReference } from "@sdd/contracts";
import { UX_NATIVE_ANDROID_RULES } from "@sdd/ai";
import { DomainError } from "@sdd/shared";
import { NEUTRAL_SPEC, assembleScreen, isFramed, reframeScreens, screenContent } from "../src/modules/ux/ux-shell.js";
import { WEB_PLATFORM, detectPlatform, nativeFramework, platformLines, platformOf, renderSizes, samePlatform } from "../src/modules/ux/ux-platform.js";
import { restyledReference } from "../src/modules/ux/ux-plan.js";
import { lintOptionsFor, lintScreenHtml } from "../src/modules/ux/ux-lint.js";
import { screenConstraint } from "../src/modules/task/service.js";
import { kitCss } from "../src/modules/design-system/render.js";
import { libraryThemeFiles } from "../src/modules/design-system/exports.js";

const RN = [{ category: "Frontend", technology: "React Native (Expo)" }, { category: "Database", technology: "SQLite" }];
const ANDROID: UxPlatform = { kind: "native-mobile", os: "android", devices: ["tablet-landscape", "phone"], source: "detected", reason: "" };

describe("detectPlatform", () => {
  test("React Native and an Indonesian cashier tablet: an Android app, tablet landscape first", () => {
    const p = detectPlatform(RN, "Aplikasi kasir restoran di tablet Android, pesanan dikirim ke KDS dapur.");
    expect(p).toMatchObject({ kind: "native-mobile", os: "android", source: "detected" });
    expect(p.devices[0]).toBe("tablet-landscape");
    expect(p.reason).toContain("React Native");
    expect(p.reason).toContain("kasir");
    expect(UxPlatformSchema.safeParse(p).success).toBe(true);
  });
  test("a web stack is a web app, whatever the requirements say about phones", () => {
    const p = detectPlatform([{ category: "Frontend", technology: "Next.js" }], "Works on a phone and a tablet.");
    expect(p.kind).toBe("web");
    expect(p.devices).toEqual(["desktop", "phone"]);
  });
  test("Flutter for a phone app; both signals put the tablet first; no signal means a phone", () => {
    expect(detectPlatform([{ category: "Frontend", technology: "Flutter" }], "Aplikasi mobile untuk HP pelanggan").devices).toEqual(["phone"]);
    expect(detectPlatform(RN, "POS on a tablet, and a phone app for the owner").devices).toEqual(["tablet-landscape", "phone"]);
    expect(detectPlatform([{ category: "Frontend", technology: "Kotlin + Jetpack Compose" }], "Track deliveries").devices).toEqual(["phone"]);
    expect(detectPlatform(RN, "A kiosk tablet in portrait").devices).toEqual(["tablet-portrait", "tablet-landscape"]);
  });
  test("the native framework a stack names", () => {
    expect(nativeFramework(RN)).toBe("React Native");
    expect(nativeFramework([{ technology: "SvelteKit" }])).toBeNull();
  });
});

describe("native Android shell", () => {
  const screens = ["Orders", "Menu", "Kitchen", "Tables", "Reports", "Staff", "Settings"].map((name) => ({
    key: name.toLowerCase(),
    name,
    screen_type: name === "Settings" ? "settings" : "list",
  }));
  const frame = (currentKey: string, platform: UxPlatform | null = ANDROID) =>
    assembleScreen({ content: "<h1>Orders</h1><p>x</p>", spec: NEUTRAL_SPEC, brand: "Hokky POS", screens, currentKey, platform });
  const bottomLinks = (html: string) => (/<nav class="ds-bottom-nav"[\s\S]*?<\/nav>/.exec(html)?.[0].match(/<a /g) ?? []).length;

  test("app chrome instead of the web sidebar, around the same content slot", () => {
    const html = frame("orders");
    expect(html).toContain('class="ds-app ds-native"');
    expect(html).toContain("ds-status-bar");
    expect(html).toContain('class="ds-top-app-bar"');
    expect(html).toContain("ds-nav-rail");
    expect(html).not.toContain('class="ds-sidebar"');
    expect(html).not.toContain('class="ds-header-crumb"');
    expect(isFramed(html)).toBe(true);
    expect(screenContent(html)).toBe("<h1>Orders</h1><p>x</p>");
    expect(html).toContain('href="./menu.html"');
  });
  test("the bottom bar holds four destinations and More; the current screen always shows", () => {
    expect(bottomLinks(frame("orders"))).toBe(4);
    expect(frame("orders")).toContain("ds-nav-more");
    const staff = frame("staff");
    expect(bottomLinks(staff)).toBe(4);
    expect(/<nav class="ds-bottom-nav"[\s\S]*?<\/nav>/.exec(staff)?.[0]).toContain('href="./staff.html" aria-current="page"');
    // The rail lists every screen.
    expect((/<nav class="ds-nav-rail"[\s\S]*?<\/nav>/.exec(staff)?.[0].match(/<a /g) ?? []).length).toBe(7);
  });
  test("a phone gets the bottom bar and a tablet the rail, from one stylesheet", () => {
    const css = kitCss(NEUTRAL_SPEC);
    expect(css).toContain("@media(min-width:600px){.ds-native{");
    expect(css).toContain(".ds-bottom-nav{display:none}");
  });
  test("web references keep the web shell", () => {
    expect(frame("orders", null)).toContain('class="ds-sidebar"');
    expect(frame("orders", WEB_PLATFORM)).toContain('class="ds-sidebar"');
  });
  test("re-framing keeps the reference's platform", () => {
    const ref = { applicable: true, reason: "", platform: ANDROID, screens: [{ key: "orders", name: "Orders", purpose: "", requirement_keys: [], key_elements: [], html: frame("orders") }] } as unknown as UxReference;
    expect(reframeScreens(ref, NEUTRAL_SPEC, "Hokky POS").screens[0]!.html).toContain("ds-native");
  });
});

describe("prompts, render sizes and lint follow the platform", () => {
  test("the draw request gets the Android block only for a native reference", () => {
    expect(platformLines(WEB_PLATFORM, UX_NATIVE_ANDROID_RULES)).toEqual([]);
    const lines = platformLines(ANDROID, UX_NATIVE_ANDROID_RULES).join("\n");
    expect(lines).toContain("PLATFORM: an Android app (Material 3)");
    expect(lines).toContain("tablet landscape (1280×800), phone (412×915)");
    expect(UX_NATIVE_ANDROID_RULES).toContain("bottom navigation");
    expect(UX_NATIVE_ANDROID_RULES).toContain("48dp");
  });
  test("the render check measures at the target devices", () => {
    expect(renderSizes(WEB_PLATFORM)).toMatchObject({ narrow: { width: 360, height: 800 }, wide: { width: 1280, height: 800 }, minTarget: 32 });
    expect(renderSizes(ANDROID)).toMatchObject({ narrow: { width: 412, height: 915 }, wide: { width: 1280, height: 800 }, minTarget: 44 });
  });
  test("a web table on an Android phone is flagged; cards are fine", () => {
    const ref = { applicable: true, reason: "", platform: ANDROID, screens: [] } as unknown as UxReference;
    const opts = lintOptionsFor(ref, undefined);
    expect(opts.nativePhone).toBe(true);
    const rules = (html: string) => lintScreenHtml(html, "neutral", opts).map((f) => f.rule);
    expect(rules('<table class="ds-table"><tr><td>a</td></tr></table>')).toContain("web-table-on-phone");
    expect(rules('<table class="ds-table" data-phone="card"><tr><td>a</td></tr></table>')).not.toContain("web-table-on-phone");
    expect(lintOptionsFor({ ...ref, platform: undefined }, undefined).nativePhone).toBeUndefined();
  });
});

describe("change look with a platform", () => {
  const web = {
    applicable: true,
    reason: "",
    fidelity: "neutral",
    design_system_version: null,
    screens: [{ key: "orders", name: "Orders", purpose: "", requirement_keys: [], key_elements: [], html: "<main>x</main>", history: [] }],
  } as unknown as UxReference;

  test("the same look is refused, but drawing it as an Android app is a change", () => {
    expect(() => restyledReference(web, { stale: false, fidelity: "neutral", designSystemVersion: null })).toThrow(DomainError);
    const next = restyledReference(web, { stale: false, fidelity: "neutral", designSystemVersion: null, platform: ANDROID });
    expect(next.platform).toEqual(ANDROID);
    expect(next.screens[0]!.html).toBeNull();
    expect(platformOf(next).kind).toBe("native-mobile");
  });
  test("a reference made before platforms stays without one unless one is chosen", () => {
    expect(restyledReference(web, { stale: true, fidelity: "neutral", designSystemVersion: null }).platform).toBeUndefined();
    expect(samePlatform(WEB_PLATFORM, { ...WEB_PLATFORM, reason: "other words", source: "user" })).toBe(true);
  });
});

describe("tasks build native screens natively", () => {
  test("the screen constraint names the framework and calls the mockup a picture", () => {
    const sentence = screenConstraint(false, true, "React Native");
    expect(sentence).toContain("build them as React Native screens (Android, Material 3)");
    expect(sentence).toContain("not code");
    expect(sentence).toContain("DESIGN.md");
    expect(screenConstraint(false, false)).toBe(
      "Layout, elements and flow follow <file>; visual styling follows the stack; it renders inside the app shell, no full-screen wrapper or navigation of its own (unless listed outside the shell)",
    );
  });
  test("React Native Paper exports MD3 light and dark themes", () => {
    const [file] = libraryThemeFiles({ ...NEUTRAL_SPEC, component_library: "react-native-paper" });
    expect(file!.path).toContain("react-native-paper-theme.ts");
    expect(file!.content).toContain("MD3LightTheme");
    expect(file!.content).toContain("export const darkTheme: MD3Theme");
  });
});
