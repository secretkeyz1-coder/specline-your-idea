import type { DesignSystemSpec, DsPalette } from "@sdd/contracts";
import { mix, textOn } from "./color.js";
import { cssComment, cssFontStack } from "./escape.js";
import { findLibrary } from "./libraries.js";

/**
 * Everything the design system draws: the token stylesheet, the small `ds-*`
 * component kit the AI uses in styled UI-reference screens, and the preview
 * page. All output is self-contained CSS/HTML — no fonts, scripts or images
 * from elsewhere — so it renders inside the sandboxed, CSP-locked preview.
 */

export const DENSITY = {
  compact: { control: 32, padX: 10, gap: 8, cardPad: 14, text: 14 },
  comfortable: { control: 38, padX: 12, gap: 12, cardPad: 20, text: 15 },
  spacious: { control: 44, padX: 16, gap: 16, cardPad: 28, text: 16 },
} as const;

function shadows(spec: DesignSystemSpec, p: DsPalette) {
  switch (spec.depth) {
    case "flat":
      return { card: "none", raised: `0 0 0 1px ${p.border}` };
    case "hairline":
      return { card: "none", raised: "0 8px 24px rgba(0,0,0,.12)" };
    case "soft":
      return { card: "0 1px 2px rgba(0,0,0,.06), 0 2px 8px rgba(0,0,0,.05)", raised: "0 12px 32px rgba(0,0,0,.14)" };
    case "hard":
      return { card: `4px 4px 0 ${p.fg}`, raised: `6px 6px 0 ${p.fg}` };
  }
}

/** Custom properties for one palette. */
export function paletteVars(spec: DesignSystemSpec, p: DsPalette): string[] {
  const s = shadows(spec, p);
  const tint = (c: string) => mix(c, p.bg, 0.86);
  return [
    `--ds-bg: ${p.bg};`,
    `--ds-surface: ${p.surface};`,
    `--ds-surface-2: ${p.surface2};`,
    `--ds-fg: ${p.fg};`,
    `--ds-fg-muted: ${p.fgMuted};`,
    `--ds-border: ${p.border};`,
    `--ds-border-strong: ${p.borderStrong};`,
    `--ds-accent: ${p.accent};`,
    `--ds-accent-fg: ${p.accentFg};`,
    `--ds-accent-soft: ${tint(p.accent)};`,
    ...(["success", "warn", "danger", "info"] as const).flatMap((k) => [
      `--ds-${k}: ${p[k]};`,
      `--ds-${k}-fg: ${textOn(p[k])};`,
      `--ds-${k}-soft: ${tint(p[k])};`,
    ]),
    `--ds-shadow: ${s.card};`,
    `--ds-shadow-raised: ${s.raised};`,
  ];
}

export function scaleVars(spec: DesignSystemSpec): string[] {
  const d = DENSITY[spec.density];
  return [
    `--ds-font-display: ${cssFontStack(spec.fonts.display)};`,
    `--ds-font-body: ${cssFontStack(spec.fonts.body)};`,
    `--ds-font-mono: ${cssFontStack(spec.fonts.mono)};`,
    `--ds-text: ${d.text}px;`,
    `--ds-radius: ${spec.radius}px;`,
    `--ds-radius-card: ${Math.round(spec.radius * 1.5)}px;`,
    `--ds-border-width: ${spec.border_width}px;`,
    `--ds-control-h: ${d.control}px;`,
    `--ds-pad-x: ${d.padX}px;`,
    `--ds-gap: ${d.gap}px;`,
    `--ds-card-pad: ${d.cardPad}px;`,
  ];
}

const indent = (lines: string[]) => lines.map((l) => `  ${l}`).join("\n");

/**
 * Token stylesheet. Light values on :root; dark under [data-theme="dark"],
 * and under prefers-color-scheme unless a page pins data-theme="light".
 */
export function tokensCss(spec: DesignSystemSpec, opts: { forcedMode?: "light" | "dark" } = {}): string {
  const scale = indent(scaleVars(spec));
  const light = indent(paletteVars(spec, spec.light));
  const dark = indent(paletteVars(spec, spec.dark));
  if (opts.forcedMode) {
    return `:root {\n${scale}\n${opts.forcedMode === "dark" ? dark : light}\n  color-scheme: ${opts.forcedMode};\n}`;
  }
  return [
    `/* ${cssComment(spec.name)} — design tokens. Light on :root, dark on [data-theme="dark"] or the system setting. */`,
    `:root {\n${scale}\n${light}\n  color-scheme: light;\n}`,
    `[data-theme="dark"] {\n${dark}\n  color-scheme: dark;\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${indent(paletteVars(spec, spec.dark)).replace(/^/gm, "  ")}\n    color-scheme: dark;\n  }\n}`,
  ].join("\n\n");
}

/** The `ds-*` kit: the vocabulary every UI-reference screen is drawn with (neutral and styled). */
export function kitCss(spec: DesignSystemSpec): string {
  const lib = findLibrary(spec.component_library);
  const bw = "var(--ds-border-width)";
  const b = `${bw} solid var(--ds-border)`;
  return [
    /* Base: product UI ("Operate" mode) — a fixed, tight type scale, not display type. */
    `*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%}`,
    `body,.ds-page{margin:0;background:var(--ds-bg);color:var(--ds-fg);font-family:var(--ds-font-body);font-size:var(--ds-text);line-height:1.5;-webkit-font-smoothing:antialiased}`,
    `h1,h2,h3,h4{font-family:var(--ds-font-display);line-height:1.25;margin:0 0 .4em;color:var(--ds-fg);font-weight:650;letter-spacing:-.01em}`,
    `h1{font-size:1.6em}h2{font-size:1.25em}h3{font-size:1.08em}h4{font-size:1em}p{margin:0 0 .75em}`,
    `a{color:var(--ds-accent);text-underline-offset:2px}code,kbd,pre{font-family:var(--ds-font-mono);font-size:.9em}img,svg,video{max-width:100%;height:auto}`,
    // Secondary text sizes are relative (em) but floored: nested (ds-help in ds-pagination) they multiplied below 11px.
    `.ds-muted{color:var(--ds-fg-muted)}.ds-small{font-size:max(.86em,12px)}.ds-mono{font-family:var(--ds-font-mono)}.ds-num{font-variant-numeric:tabular-nums}`,
    `.ds-truncate{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.ds-break{overflow-wrap:anywhere}.ds-nowrap{white-space:nowrap}`,

    /* App shell — built by the platform, never by the model: the shadcn/ui
       application pattern. Sidebar from 768px (workspace, icon navigation,
       signed-in user); a header over the page (sidebar trigger, breadcrumb,
       search, notifications). Below 768px the header's menu opens a left sheet
       (details/summary: no JS). */
    `.ds-icon{width:16px;height:16px;flex:none;display:inline-block;vertical-align:-3px;stroke-width:2}`,
    `.ds-app{--ds-sidebar-bg:color-mix(in srgb,var(--ds-surface-2) 45%,var(--ds-surface));display:grid;grid-template-columns:minmax(0,1fr);min-height:100dvh}`,
    `@media(min-width:768px){.ds-app{grid-template-columns:var(--ds-sidebar-w,16rem) minmax(0,1fr)}}`,
    `.ds-sidebar{display:none;flex-direction:column;background:var(--ds-sidebar-bg);border-right:${b};font-size:.93em}`,
    `@media(min-width:768px){.ds-sidebar{display:flex;position:sticky;top:0;height:100dvh;overflow-y:auto;overscroll-behavior:contain}}`,
    `.ds-sidebar-head{padding:8px}`,
    `.ds-team{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:var(--ds-radius);color:var(--ds-fg);text-decoration:none}`,
    `.ds-team-text{display:flex;flex-direction:column;min-width:0;flex:1;line-height:1.25}.ds-team-sub{font-size:.8em;color:var(--ds-fg-muted)}`,
    `.ds-team .ds-brand{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ds-team-caret{color:var(--ds-fg-muted);margin-left:auto}`,
    `.ds-brand{font-family:var(--ds-font-display);font-weight:600;color:var(--ds-fg);text-decoration:none;min-width:0;line-height:1.25}`,
    `.ds-brand-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:var(--ds-radius);background:var(--ds-accent);color:var(--ds-accent-fg);font-weight:700;font-size:12px}`,
    `.ds-sidebar-body{flex:1;display:flex;flex-direction:column;padding:4px 8px}`,
    `.ds-side-label{padding:10px 8px 4px;font-size:.8em;font-weight:500;color:var(--ds-fg-muted)}`,
    `.ds-side-nav{display:flex;flex-direction:column;gap:2px}.ds-side-nav-secondary{margin-top:auto;padding-top:12px}`,
    `.ds-side-nav a{display:flex;align-items:center;gap:8px;min-height:32px;padding:0 8px;border-radius:calc(var(--ds-radius) - 1px);color:var(--ds-fg);text-decoration:none;line-height:1.3}`,
    `.ds-side-nav a>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ds-side-nav a .ds-icon{color:var(--ds-fg-muted)}`,
    `.ds-side-nav a[aria-current]{background:var(--ds-surface-2);font-weight:600}.ds-side-nav a[aria-current] .ds-icon{color:var(--ds-fg)}`,
    `.ds-sidebar-foot{display:flex;align-items:center;gap:10px;margin:8px;padding:8px;border-radius:var(--ds-radius)}`,
    `.ds-user{display:flex;flex-direction:column;min-width:0;flex:1;line-height:1.25}.ds-user-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ds-user-sub{font-size:.8em;color:var(--ds-fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    `.ds-inset{min-width:0;display:flex;flex-direction:column;background:var(--ds-bg)}`,
    `.ds-app-header{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:8px;min-height:56px;padding:0 12px;background:var(--ds-bg);border-bottom:${b}}`,
    `@media(min-width:768px){.ds-app-header{padding:0 20px 0 16px}}`,
    `.ds-header-sep{width:1px;height:16px;background:var(--ds-border);margin:0 4px}`,
    `.ds-header-crumb{display:flex;align-items:center;gap:6px;min-width:0;font-size:.93em;color:var(--ds-fg-muted)}.ds-header-crumb>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    `.ds-header-crumb [aria-current]{color:var(--ds-fg);font-weight:500}.ds-header-brand{max-width:16rem}`,
    `.ds-header-search{display:none;align-items:center;gap:8px;width:16rem;min-height:34px;padding:0 6px 0 10px;border:${b};border-radius:var(--ds-radius);background:var(--ds-surface);color:var(--ds-fg-muted);font-size:.9em}`,
    `.ds-header-search>span{flex:1}.ds-header-search kbd,.ds-kbd{padding:1px 6px;border:${b};border-radius:4px;background:var(--ds-surface-2);font-family:var(--ds-font-body);font-size:.78em;color:var(--ds-fg-muted)}`,
    `.ds-header-bell{position:relative}.ds-dot{position:absolute;top:7px;right:7px;width:7px;height:7px;border-radius:999px;background:var(--ds-danger);box-shadow:0 0 0 2px var(--ds-bg)}`,
    `.ds-app-header .ds-header-trigger,.ds-header-sep{display:none}`,
    `@media(min-width:768px){.ds-app-header .ds-header-trigger{display:inline-flex}.ds-header-sep{display:block}.ds-mobile-menu{display:none}}`,
    `@media(min-width:640px){.ds-header-search{display:flex}}@media(max-width:639px){.ds-header-brand,.ds-header-crumb>.ds-icon{display:none}}`,
    `.ds-mobile-menu>summary{list-style:none;cursor:pointer}.ds-mobile-menu>summary::-webkit-details-marker{display:none}`,
    `.ds-mobile-menu[open]::before{content:"";position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:40}`,
    `.ds-mobile-sheet{position:fixed;top:0;left:0;bottom:0;z-index:50;width:min(18rem,85vw);padding:8px;background:var(--ds-sidebar-bg);box-shadow:var(--ds-shadow-raised);overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:4px}`,
    `.ds-main{min-width:0;width:100%;max-width:1440px;margin:0 auto;padding:20px 16px 48px}@media(min-width:768px){.ds-main{padding:24px 32px 56px}}`,
    /* Shell layouts the plan can choose (aturan.md §4): a top navigation for a few main
       destinations, or a minimal bar for one focused job. Both keep the header's menu sheet
       or no navigation at all; the side navigation above stays the default. */
    `@media(min-width:768px){.ds-app.ds-app-top,.ds-app.ds-app-minimal{grid-template-columns:minmax(0,1fr)}}`,
    `.ds-app-top .ds-team,.ds-app-minimal .ds-team{padding:4px 6px;flex:none;max-width:16rem}.ds-app-top .ds-team-sub,.ds-app-top .ds-team-caret,.ds-app-minimal .ds-team-sub,.ds-app-minimal .ds-team-caret{display:none}`,
    `.ds-top-nav{display:none;align-items:center;gap:2px;min-width:0;overflow-x:auto;margin-left:8px}`,
    `.ds-top-nav a{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 10px;border-radius:var(--ds-radius);color:var(--ds-fg-muted);text-decoration:none;white-space:nowrap;font-size:.93em}`,
    `.ds-top-nav a[aria-current]{color:var(--ds-fg);font-weight:600;background:var(--ds-surface-2)}`,
    `@media(min-width:768px){.ds-top-nav{display:flex}.ds-app-minimal .ds-header-sep{display:block}}`,
    `.ds-header-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--ds-fg)}`,
    `.ds-header-avatar{flex:none}`,
    /* Type by role (aturan.md §4): display for the one figure or line a screen leads with,
       title, body, label and figure (big numbers). Sizes scale with the viewport and stay
       readable on a phone; headings keep their own scale. */
    `.ds-text-display{display:block;font-family:var(--ds-font-display);font-size:clamp(1.75rem,1.2rem + 2.4vw,3rem);line-height:1.1;font-weight:700;letter-spacing:-.02em;color:var(--ds-fg)}`,
    `.ds-text-title{display:block;font-family:var(--ds-font-display);font-size:clamp(1.15rem,1rem + .6vw,1.5rem);line-height:1.25;font-weight:650;color:var(--ds-fg)}`,
    `.ds-text-body{font-size:1em;line-height:1.55}`,
    `.ds-text-label{font-size:max(.8em,12px);line-height:1.3;font-weight:600;color:var(--ds-fg-muted)}`,
    `.ds-text-figure{display:block;font-family:var(--ds-font-display);font-size:clamp(1.5rem,1.1rem + 1.6vw,2.4rem);line-height:1.1;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ds-fg)}`,
    /* A media placeholder: names its subject at the declared ratio, plainly a stand-in, never a final photo. */
    `.ds-media-ph{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;margin:0;width:100%;aspect-ratio:4/3;padding:12px;border:${bw} dashed var(--ds-border-strong);border-radius:var(--ds-radius-card);background:var(--ds-surface-2);color:var(--ds-fg-muted);text-align:center;overflow:hidden}`,
    `.ds-media-ph[data-ratio="1:1"]{aspect-ratio:1}.ds-media-ph[data-ratio="3:2"]{aspect-ratio:3/2}.ds-media-ph[data-ratio="16:9"]{aspect-ratio:16/9}.ds-media-ph[data-ratio="3:4"]{aspect-ratio:3/4}`,
    `.ds-media-ph::before{content:"";width:28px;height:28px;flex:none;border:2px solid currentColor;border-radius:6px;opacity:.7}`,
    `.ds-media-ph>figcaption{font-size:max(.82em,12px);line-height:1.3;max-width:100%;overflow-wrap:anywhere}`,
    /* Native Android chrome (Material 3), drawn by the platform for native mobile references:
       status bar, top app bar, bottom navigation below 600px, a navigation rail from 600px. */
    `.ds-native{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;min-height:100dvh;background:var(--ds-bg)}`,
    `.ds-status-bar{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;height:24px;padding:0 16px;font-size:12px;font-weight:500;color:var(--ds-fg);background:var(--ds-surface)}`,
    `.ds-status-icons{display:inline-flex;align-items:center;gap:4px}.ds-status-icons .ds-icon{width:14px;height:14px}`,
    `.ds-native>.ds-inset{grid-row:2;grid-column:1}`,
    `.ds-top-app-bar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:4px;min-height:64px;padding:0 4px;background:var(--ds-surface)}`,
    `.ds-top-app-bar-title{flex:1;min-width:0;padding:0 8px;font-family:var(--ds-font-display);font-size:22px;line-height:28px;color:var(--ds-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    `.ds-top-app-bar .ds-btn-icon{width:48px;height:48px;border-radius:999px}`,
    `.ds-bottom-nav{grid-row:3;grid-column:1/-1;position:sticky;bottom:0;z-index:30;display:flex;height:80px;background:var(--ds-surface-2)}`,
    `.ds-bottom-nav a,.ds-bottom-nav span.ds-nav-more{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:12px;font-size:12px;font-weight:500;color:var(--ds-fg-muted);text-decoration:none}`,
    `.ds-nav-pill{display:inline-flex;align-items:center;justify-content:center;width:64px;height:32px;border-radius:16px}`,
    `.ds-bottom-nav a>span:last-child,.ds-nav-rail a>span:last-child{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px}`,
    `.ds-bottom-nav a[aria-current],.ds-nav-rail a[aria-current]{color:var(--ds-fg);font-weight:600}.ds-bottom-nav a[aria-current] .ds-nav-pill,.ds-nav-rail a[aria-current] .ds-nav-pill{background:var(--ds-accent-soft)}`,
    `.ds-nav-rail{display:none}`,
    `@media(min-width:600px){.ds-native{grid-template-columns:80px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.ds-native>.ds-inset{grid-column:2}.ds-bottom-nav{display:none}`
      + `.ds-nav-rail{grid-row:2;grid-column:1;display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px 0;background:var(--ds-surface);position:sticky;top:0;align-self:start;height:calc(100dvh - 24px);overflow-y:auto}`
      + `.ds-nav-rail a{display:flex;flex-direction:column;align-items:center;gap:4px;width:80px;font-size:12px;font-weight:500;color:var(--ds-fg-muted);text-decoration:none}.ds-nav-rail .ds-nav-pill{width:56px}}`,
    `.ds-native .ds-main{padding:16px 16px 96px}@media(min-width:600px){.ds-native .ds-main{padding:24px 24px 48px}}`,
    /* The app bar names the screen: the page header's h1 stays for structure, out of sight. */
    `.ds-native .ds-page-header h1{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`,
    // A page header holding only that (hidden) title leaves no gap under the app bar.
    `.ds-native .ds-page-header:not(:has(>:not(h1))){margin:0}`,
    /* A Material floating action button: the screen's primary action, above the bottom navigation. */
    `.ds-fab{position:sticky;bottom:16px;z-index:20;display:flex;align-items:center;gap:12px;width:max-content;min-height:56px;margin:16px 0 0 auto;padding:0 20px;border-radius:16px;box-shadow:var(--ds-shadow-raised)}`,
    `.ds-main :where(.ds-row,.ds-grid,.ds-grid-2,.ds-grid-3,.ds-grid-4,.ds-stack,.ds-split,.ds-toolbar,.ds-page-header,.ds-card-header)>*{min-width:0}`,
    // Blocks directly in the page keep a gap between them (zero specificity: a block's own margin wins).
    `:where(.ds-main)>:where(:not(style,.ds-page-header,.ds-overlays))+:where(:not(style,.ds-overlays)){margin-top:var(--ds-gap)}`,

    /* Page structure: header (wayfinding + actions), sections, layout helpers. */
    `.ds-breadcrumb{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 6px;font-size:max(.86em,12px);color:var(--ds-fg-muted)}.ds-breadcrumb a{color:inherit;text-decoration:none}.ds-breadcrumb [aria-current]{color:var(--ds-fg)}`,
    `.ds-page-header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px 24px;margin-bottom:24px}`,
    `.ds-page-header h1{margin:0}.ds-page-desc{margin:4px 0 0;color:var(--ds-fg-muted);max-width:70ch}`,
    `.ds-page-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}`,
    `.ds-section{margin-top:28px}.ds-section-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;margin-bottom:12px}.ds-section-head h2{margin:0}`,
    `.ds-container{max-width:1120px;margin:0 auto;padding:24px 16px}@media(min-width:768px){.ds-container{padding:32px 32px}}`,
    `.ds-stack{display:flex;flex-direction:column;gap:var(--ds-gap)}.ds-row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--ds-gap)}.ds-spacer{flex:1}`,
    `.ds-grid{display:grid;gap:var(--ds-gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}`,
    `.ds-grid-2,.ds-grid-3,.ds-grid-4{display:grid;gap:var(--ds-gap);grid-template-columns:minmax(0,1fr)}.ds-grid-4{grid-template-columns:repeat(2,minmax(0,1fr))}`,
    `@media(min-width:640px){.ds-grid-2,.ds-grid-3,.ds-grid-4{grid-template-columns:repeat(2,minmax(0,1fr))}}`,
    `@media(min-width:1024px){.ds-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.ds-grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}}`,
    `.ds-split{display:grid;gap:var(--ds-gap);grid-template-columns:minmax(0,1fr)}@media(min-width:1024px){.ds-split{grid-template-columns:minmax(0,1fr) minmax(0,22rem)}}`,

    /* Filters: one row, bottom-aligned, equal control heights. */
    `.ds-toolbar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 12px;margin-bottom:12px}`,
    `.ds-toolbar .ds-field{flex:1 1 11rem;max-width:16rem}.ds-toolbar .ds-field-grow{flex:2 1 14rem;max-width:26rem}.ds-toolbar-end{margin-left:auto;display:flex;flex-wrap:wrap;gap:8px}`,
    `@media(max-width:639px){.ds-toolbar .ds-field,.ds-toolbar .ds-field-grow{flex-basis:100%;max-width:none}}`,

    /* Legacy top navigation, still used by the design-system preview. */
    `.ds-topbar{display:flex;align-items:center;gap:16px;padding:0 16px;min-height:56px;background:var(--ds-surface);border-bottom:${b}}`,
    `.ds-nav{display:flex;flex-wrap:wrap;gap:4px}.ds-nav a{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:var(--ds-radius);color:var(--ds-fg-muted);text-decoration:none}`,
    `.ds-nav a[aria-current]{color:var(--ds-fg);background:var(--ds-surface-2);font-weight:600}`,
    `.ds-shell{display:grid;grid-template-columns:minmax(0,1fr);min-height:100vh}@media(min-width:900px){.ds-shell{grid-template-columns:232px minmax(0,1fr)}}`,

    /* Surfaces */
    `.ds-card{background:var(--ds-surface);border:${b};border-radius:var(--ds-radius-card);padding:var(--ds-card-pad);box-shadow:var(--ds-shadow);min-width:0}`,
    `.ds-card-header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px 12px;margin-bottom:14px}.ds-card-title{margin:0;font-size:1em;font-weight:650}.ds-card-desc{margin:2px 0 0;color:var(--ds-fg-muted);font-size:max(.9em,12px)}`,
    `.ds-card-footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:16px}`,
    `.ds-card.ds-card-flush{padding:0;overflow:hidden}.ds-card-flush>.ds-card-header{padding:var(--ds-card-pad) var(--ds-card-pad) 0}.ds-card-flush>.ds-table-wrap{border-top:${b}}`,
    `.ds-card .ds-card{box-shadow:none}`,
    `.ds-divider{border:0;border-top:${b};margin:var(--ds-gap) 0}`,
    `.ds-stat{display:flex;flex-direction:column;gap:2px}.ds-stat-label{color:var(--ds-fg-muted);font-size:max(.86em,12px)}.ds-stat-value{font-family:var(--ds-font-display);font-size:1.75em;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.2}.ds-stat-meta{color:var(--ds-fg-muted);font-size:max(.86em,12px)}`,

    /* Actions */
    `.ds-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:var(--ds-control-h);padding:0 calc(var(--ds-pad-x) + 4px);border-radius:var(--ds-radius);border:${bw} solid var(--ds-border-strong);background:var(--ds-surface);color:var(--ds-fg);font:inherit;font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap}`,
    `.ds-btn-primary{background:var(--ds-accent);border-color:var(--ds-accent);color:var(--ds-accent-fg)}`,
    `.ds-btn-ghost{background:transparent;border-color:transparent;color:var(--ds-fg)}`,
    `.ds-btn-danger{background:var(--ds-danger);border-color:var(--ds-danger);color:var(--ds-danger-fg)}`,
    `.ds-btn-sm{min-height:calc(var(--ds-control-h) - 8px);padding:0 var(--ds-pad-x);font-size:.9em}.ds-btn-icon{width:var(--ds-control-h);padding:0}.ds-btn-icon.ds-btn-sm{width:calc(var(--ds-control-h) - 8px)}`,
    `.ds-btn:focus-visible,.ds-input:focus-visible,.ds-select:focus-visible,.ds-textarea:focus-visible{outline:2px solid var(--ds-accent);outline-offset:2px}`,
    `.ds-dropdown{position:relative;display:inline-block}.ds-dropdown>summary{list-style:none}.ds-dropdown>summary::-webkit-details-marker{display:none}`,
    `.ds-dropdown>.ds-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:20}`,
    `.ds-menu{min-width:12rem;padding:4px;background:var(--ds-surface);border:${b};border-radius:var(--ds-radius);box-shadow:var(--ds-shadow-raised);display:flex;flex-direction:column}`,
    `.ds-menu-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:calc(var(--ds-radius) - 2px);color:var(--ds-fg);text-decoration:none;background:none;border:0;font:inherit;text-align:left}.ds-menu-item-danger{color:var(--ds-danger)}.ds-menu-sep{height:1px;margin:4px 0;background:var(--ds-border)}`,

    /* Forms */
    `.ds-form{display:flex;flex-direction:column;gap:14px}.ds-form-row{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}@media(min-width:640px){.ds-form-row{grid-template-columns:repeat(2,minmax(0,1fr))}}`,
    `.ds-field{display:flex;flex-direction:column;gap:6px;min-width:0}.ds-label{font-weight:600;font-size:.93em}.ds-help{color:var(--ds-fg-muted);font-size:max(.86em,12px)}.ds-error{color:var(--ds-danger);font-size:max(.86em,12px)}`,
    `.ds-input,.ds-select,.ds-textarea{width:100%;min-width:0;min-height:var(--ds-control-h);padding:6px var(--ds-pad-x);border:${bw} solid var(--ds-border-strong);border-radius:var(--ds-radius);background:var(--ds-surface);color:var(--ds-fg);font:inherit}`,
    `@media(max-width:767px){.ds-input,.ds-select,.ds-textarea{font-size:16px}}`,
    `.ds-textarea{min-height:96px}.ds-input[aria-invalid="true"],.ds-select[aria-invalid="true"],.ds-textarea[aria-invalid="true"]{border-color:var(--ds-danger)}`,
    `.ds-checkbox{display:flex;align-items:center;gap:8px}.ds-checkbox input{width:18px;height:18px;accent-color:var(--ds-accent)}`,
    `.ds-dropzone{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:120px;padding:16px;border:1px dashed var(--ds-border-strong);border-radius:var(--ds-radius);color:var(--ds-fg-muted);text-align:center}`,

    /* Data */
    // A shadow at the edge that still has columns to scroll to (the "local"
    // covers hide it at either end) — a clipped table otherwise reads as broken.
    `.ds-table-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;background:`
      + `linear-gradient(to right,var(--ds-surface) 30%,transparent) left center/28px 100% no-repeat local,`
      + `linear-gradient(to left,var(--ds-surface) 30%,transparent) right center/28px 100% no-repeat local,`
      + `radial-gradient(farthest-side at 0 50%,rgba(0,0,0,.18),transparent) left center/12px 100% no-repeat scroll,`
      + `radial-gradient(farthest-side at 100% 50%,rgba(0,0,0,.18),transparent) right center/12px 100% no-repeat scroll}`,
    `.ds-table{width:100%;border-collapse:collapse;font-size:.93em}`,
    `.ds-table th{height:40px;padding:0 12px;text-align:left;font-weight:600;color:var(--ds-fg-muted);white-space:nowrap;border-bottom:1px solid var(--ds-border);background:var(--ds-surface-2)}`,
    `.ds-table td{padding:10px 12px;vertical-align:middle;border-bottom:1px solid var(--ds-border)}.ds-table tbody tr:last-child td{border-bottom:0}`,
    `.ds-table .ds-num,.ds-table td.ds-num,.ds-table th.ds-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.ds-table .ds-actions{text-align:right;white-space:nowrap}`,
    `.ds-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:max(.8em,11px);font-weight:600;line-height:1.5;white-space:nowrap;background:var(--ds-surface-2);color:var(--ds-fg)}`,
    ...(["success", "warn", "danger", "info"] as const).map((k) => `.ds-badge-${k}{background:var(--ds-${k}-soft);color:var(--ds-fg);box-shadow:inset 0 0 0 1px var(--ds-${k})}`),
    `.ds-badge-accent{background:var(--ds-accent);color:var(--ds-accent-fg)}.ds-badge-outline{background:transparent;box-shadow:inset 0 0 0 1px var(--ds-border-strong)}`,
    `.ds-progress{height:8px;width:100%;background:var(--ds-surface-2);border-radius:999px;overflow:hidden}.ds-progress>span{display:block;height:100%;background:var(--ds-accent);border-radius:inherit}`,
    `.ds-tabs{display:flex;gap:4px;border-bottom:${b};overflow-x:auto;max-width:100%}.ds-tab{padding:8px 12px;border:0;background:none;color:var(--ds-fg-muted);font:inherit;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:calc(-1 * ${bw})}`,
    `.ds-tab[aria-selected="true"]{color:var(--ds-fg);border-bottom-color:var(--ds-accent);font-weight:600}`,
    // Tabs standing on their own in the page (a status switcher) keep a gap to the blocks around them.
    `.ds-main>.ds-tabs,.ds-section>.ds-tabs{margin:16px 0 12px}`,
    `.ds-pagination{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:12px 0 0;font-size:.9em;color:var(--ds-fg-muted)}.ds-card-flush .ds-pagination{padding:12px var(--ds-card-pad)}`,
    `.ds-avatar{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:999px;background:var(--ds-accent-soft);color:var(--ds-fg);font-weight:700;font-size:.8em}`,
    `.ds-list{list-style:none;margin:0;padding:0}.ds-list>li{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--ds-border)}.ds-list>li:last-child{border-bottom:0}`,

    `.ds-btn .ds-icon{margin:0 -2px}.ds-btn-icon .ds-icon{margin:0}.ds-menu-item .ds-icon{color:var(--ds-fg-muted)}`,
    `.ds-input-icon{position:relative;display:flex;align-items:center;min-width:0}.ds-input-icon>.ds-icon{position:absolute;left:10px;color:var(--ds-fg-muted);pointer-events:none}.ds-input-icon>.ds-input{padding-left:34px}`,
    `.ds-badge-dot::before{content:"";width:6px;height:6px;border-radius:999px;background:var(--ds-fg-muted)}`,
    ...(["success", "warn", "danger", "info"] as const).map((k) => `.ds-badge-${k}.ds-badge-dot::before{background:var(--ds-${k})}`),
    `.ds-media{display:flex;align-items:center;gap:10px;min-width:0}.ds-media-body{display:flex;flex-direction:column;min-width:0;line-height:1.3}.ds-media-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ds-media-sub{font-size:max(.86em,12px);color:var(--ds-fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    `.ds-avatar-sm{width:28px;height:28px;font-size:.72em}.ds-avatar-group{display:flex}.ds-avatar-group>.ds-avatar{box-shadow:0 0 0 2px var(--ds-surface)}.ds-avatar-group>.ds-avatar+.ds-avatar{margin-left:-8px}`,
    `.ds-stat-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.ds-stat-head .ds-icon{color:var(--ds-fg-muted)}`,
    // In a table a record's name wraps: kept on one line it set its column's minimum width and pushed the table past the page.
    `.ds-table :is(.ds-media-title,.ds-media-sub){white-space:normal}`,
    `.ds-table tbody tr:hover{background:color-mix(in srgb,var(--ds-surface-2) 55%,transparent)}.ds-table .ds-check{width:40px}.ds-table .ds-check input{width:16px;height:16px;accent-color:var(--ds-accent)}`,
    `.ds-chart{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}.ds-chart>svg{display:block;width:100%;height:auto}`,
    `.ds-empty>.ds-icon{width:40px;height:40px;padding:9px;border-radius:calc(var(--ds-radius) + 2px);background:var(--ds-surface-2);color:var(--ds-fg)}`,
    `.ds-alert:has(>.ds-icon){display:flex;gap:10px;align-items:flex-start}.ds-alert>.ds-icon{margin-top:3px}`,

    /* Structure beyond cards and tables: facts, activity, steps, hierarchy,
       trends, boards, bulk actions, filter chips, master-detail. */
    `.ds-dl{display:grid;grid-template-columns:minmax(0,1fr);gap:12px 24px;margin:0}@media(min-width:640px){.ds-dl{grid-template-columns:repeat(2,minmax(0,1fr))}}`,
    `.ds-dl>div{display:flex;flex-direction:column;gap:2px;min-width:0}.ds-dl dt{font-size:max(.86em,12px);color:var(--ds-fg-muted)}.ds-dl dd{margin:0;font-weight:500;overflow-wrap:anywhere}`,
    `.ds-dl.ds-dl-rows{grid-template-columns:minmax(0,1fr);gap:0}.ds-dl-rows>div{flex-direction:row;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid var(--ds-border)}.ds-dl-rows>div:last-child{border-bottom:0}.ds-dl-rows dd{text-align:right}`,
    `.ds-timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}`,
    `.ds-timeline>li{position:relative;display:grid;grid-template-columns:24px minmax(0,1fr);gap:0 12px;padding-bottom:18px}.ds-timeline>li:last-child{padding-bottom:0}`,
    `.ds-timeline>li::before{content:"";position:absolute;left:11px;top:26px;bottom:2px;width:2px;background:var(--ds-border)}.ds-timeline>li:last-child::before{display:none}`,
    `.ds-timeline-dot{width:24px;height:24px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:var(--ds-surface-2);color:var(--ds-fg-muted)}.ds-timeline-dot .ds-icon{width:14px;height:14px}`,
    ...(["success", "warn", "danger", "info"] as const).map((k) => `.ds-timeline-dot-${k}{background:var(--ds-${k}-soft);color:var(--ds-${k})}`),
    `.ds-timeline-dot-accent{background:var(--ds-accent);color:var(--ds-accent-fg)}.ds-timeline-title{font-weight:600;line-height:1.4}.ds-timeline-meta{font-size:max(.86em,12px);color:var(--ds-fg-muted)}.ds-timeline-body{margin-top:4px}`,
    `.ds-steps{list-style:none;margin:0;padding:0;display:flex;gap:8px;counter-reset:ds-step;overflow-x:auto}`,
    `.ds-steps>li{flex:1 1 0;min-width:9rem;display:flex;align-items:center;gap:8px;color:var(--ds-fg-muted);counter-increment:ds-step;white-space:nowrap}`,
    `.ds-steps>li::before{content:counter(ds-step);flex:none;width:26px;height:26px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;border:1.5px solid var(--ds-border-strong);font-size:12px;font-weight:600}`,
    `.ds-steps>li:not(:last-child)::after{content:"";flex:1;min-width:12px;height:1.5px;background:var(--ds-border)}`,
    `.ds-steps>li.ds-step-done{color:var(--ds-fg)}.ds-steps>li.ds-step-done::before{content:"✓";background:var(--ds-accent);border-color:var(--ds-accent);color:var(--ds-accent-fg)}.ds-steps>li.ds-step-done::after{background:var(--ds-accent)}`,
    `.ds-steps>li[aria-current]{color:var(--ds-fg);font-weight:600}.ds-steps>li[aria-current]::before{border-color:var(--ds-accent);color:var(--ds-accent)}`,
    `.ds-tree,.ds-tree ul{list-style:none;margin:0;padding:0}.ds-tree ul{margin-left:11px;padding-left:12px;border-left:1px solid var(--ds-border)}`,
    `.ds-tree-row{display:flex;align-items:center;gap:8px;min-height:36px;padding:4px 8px;border-radius:var(--ds-radius)}.ds-tree-row[aria-current],.ds-tree-row.is-selected{background:var(--ds-accent-soft)}`,
    `.ds-tree-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:4px;background:none;color:var(--ds-fg-muted)}.ds-tree-leaf{flex:none;width:22px}`,
    `.ds-tree-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ds-tree-meta{margin-left:auto;display:flex;align-items:center;gap:10px;color:var(--ds-fg-muted);font-size:max(.86em,12px);white-space:nowrap}`,
    `@media(max-width:639px){.ds-tree ul{margin-left:6px;padding-left:8px}.ds-tree-meta{display:none}}`,
    `.ds-spark{display:block;width:100%;height:36px;margin-top:8px;overflow:visible}.ds-spark :is(polyline,path,line){fill:none;stroke:var(--ds-accent);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.ds-spark .ds-spark-area{fill:var(--ds-accent-soft);stroke:none}`,
    `.ds-trend{display:inline-flex;align-items:center;gap:2px;font-weight:600;font-size:max(.86em,12px)}.ds-trend .ds-icon{width:14px;height:14px}.ds-trend-up{color:var(--ds-success)}.ds-trend-down{color:var(--ds-danger)}.ds-trend-flat{color:var(--ds-fg-muted)}`,
    `.ds-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(14rem,1fr);gap:var(--ds-gap);overflow-x:auto;padding-bottom:4px;align-items:start}@media(max-width:639px){.ds-board{grid-auto-columns:85%}}`,
    `.ds-board-col{display:flex;flex-direction:column;gap:8px;min-width:0;padding:10px;border-radius:var(--ds-radius-card);background:var(--ds-surface-2)}`,
    `.ds-board-col-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 4px 4px;font-weight:600}`,
    `.ds-board-card{display:flex;flex-direction:column;gap:6px;min-width:0;padding:12px;border:1px solid var(--ds-border);border-radius:var(--ds-radius);background:var(--ds-surface);box-shadow:var(--ds-shadow)}`,
    // Badges and trends in a column keep their own width.
    `:is(.ds-board-card,.ds-stat,.ds-master-item,.ds-timeline-body)>:is(.ds-badge,.ds-trend){align-self:flex-start}`,
    `.ds-bulkbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:8px 12px;border-radius:var(--ds-radius);background:var(--ds-accent-soft);font-size:.93em}.ds-card-flush>.ds-bulkbar{border-radius:0;border-bottom:1px solid var(--ds-border)}`,
    // Direct children only: a search inside a labelled ds-field is a column, where a flex-basis would become its height.
    `.ds-table-toolbar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 12px;padding:12px var(--ds-card-pad);border-bottom:1px solid var(--ds-border)}.ds-table-toolbar>.ds-input-icon{flex:1 1 14rem;max-width:22rem}.ds-table-toolbar>.ds-select{width:auto}`,
    `.ds-table-toolbar>.ds-field{flex:1 1 11rem;max-width:16rem}.ds-table-toolbar>.ds-field-grow{flex:2 1 14rem;max-width:26rem}.ds-table-toolbar>.ds-toolbar-end{margin-left:auto;display:flex;flex-wrap:wrap;gap:8px}`,
    `.ds-table tr.is-selected td,.ds-table tr[aria-selected="true"] td{background:var(--ds-accent-soft)}`,
    `.ds-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.ds-chip{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 10px;border:1px dashed var(--ds-border-strong);border-radius:999px;background:var(--ds-surface);color:var(--ds-fg);font:inherit;font-size:max(.86em,12px);font-weight:500;white-space:nowrap}`,
    `.ds-chip .ds-icon{width:14px;height:14px;color:var(--ds-fg-muted)}.ds-chip-active{border-style:solid;border-color:var(--ds-accent);background:var(--ds-accent-soft)}`,
    `.ds-master-detail{display:grid;gap:var(--ds-gap);grid-template-columns:minmax(0,1fr)}@media(min-width:1024px){.ds-master-detail{grid-template-columns:minmax(18rem,24rem) minmax(0,1fr);align-items:start}}`,
    `.ds-master-list{display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--ds-border);border-radius:var(--ds-radius-card);background:var(--ds-surface)}`,
    `.ds-master-item{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-bottom:1px solid var(--ds-border);color:inherit;text-decoration:none}.ds-master-item:last-child{border-bottom:0}.ds-master-item[aria-current]{background:var(--ds-accent-soft);box-shadow:inset 2px 0 0 var(--ds-accent)}`,

    /* Feedback and states */
    `.ds-alert{padding:12px 14px;border-radius:var(--ds-radius);border:1px solid var(--ds-border);background:var(--ds-surface-2);color:var(--ds-fg)}`,
    ...(["success", "warn", "danger", "info"] as const).map((k) => `.ds-alert-${k}{background:var(--ds-${k}-soft);border-color:var(--ds-${k})}`),
    `.ds-toast{display:inline-flex;gap:8px;align-items:center;padding:10px 14px;border-radius:var(--ds-radius);background:var(--ds-fg);color:var(--ds-bg);box-shadow:var(--ds-shadow-raised)}`,
    `.ds-empty{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:40px 16px;color:var(--ds-fg-muted);border:1px dashed var(--ds-border-strong);border-radius:var(--ds-radius-card)}.ds-empty h3{color:var(--ds-fg);margin:0}`,
    `.ds-skeleton{display:block;height:12px;border-radius:var(--ds-radius);background:var(--ds-surface-2)}`,
    `.ds-placeholder{display:flex;align-items:center;justify-content:center;min-height:140px;padding:12px;background:var(--ds-surface-2);color:var(--ds-fg-muted);border-radius:var(--ds-radius-card);font-size:.86em;text-align:center}`,

    /* Overlays: drawn after the main view as frames — a dimmed stage with the
       dialog, sheet or confirmation open on it — so the page itself stays clean. */
    `.ds-overlays{margin-top:48px;padding-top:24px;border-top:1px dashed var(--ds-border-strong)}.ds-overlays>h2{font-size:1em;color:var(--ds-fg-muted)}`,
    `.ds-frame{margin:16px 0 0}.ds-frame>figcaption{margin-bottom:8px;font-size:.86em;color:var(--ds-fg-muted)}`,
    `.ds-stage{position:relative;display:flex;align-items:center;justify-content:center;min-height:320px;padding:24px 16px;border:${b};border-radius:var(--ds-radius-card);background:var(--ds-bg);overflow:hidden}`,
    `.ds-stage::before{content:"";position:absolute;inset:0;background:rgba(0,0,0,.45)}.ds-stage>*{position:relative}`,
    `.ds-stage-sheet{justify-content:flex-end;align-items:stretch;padding:0;min-height:420px}`,
    `.ds-modal,.ds-alert-dialog,.ds-dialog{width:100%;max-width:32rem;display:flex;flex-direction:column;gap:16px;padding:24px;background:var(--ds-surface);border:${b};border-radius:var(--ds-radius-card);box-shadow:var(--ds-shadow-raised)}`,
    `.ds-alert-dialog{max-width:26rem}.ds-modal-header h2,.ds-modal-header h3{margin:0}.ds-modal-desc{margin:4px 0 0;color:var(--ds-fg-muted)}`,
    `.ds-modal-footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}@media(max-width:639px){.ds-modal-footer{flex-direction:column-reverse}.ds-modal-footer .ds-btn{width:100%}}`,
    `.ds-sheet{width:min(26rem,92%);display:flex;flex-direction:column;gap:16px;padding:24px;background:var(--ds-surface);border-left:${b};box-shadow:var(--ds-shadow-raised);overflow-y:auto}`,
    lib?.mockupCss ?? "",
    /* Phones (<640px), after the library skin so they win over its desktop
       sizes. A table marked ds-table-cards becomes one compact card per row:
       the first cell is the card's title, the rest a two-column grid of
       label-over-value facts, icon-only row actions in the corner; ds-hide-sm
       drops what a phone can do without. Wide charts scroll instead of
       shrinking their text to nothing. */
    `@media(max-width:639px){`
      + `.ds-card{padding:16px}.ds-card.ds-card-flush{padding:0}.ds-card-flush>.ds-card-header{padding:16px 16px 0}.ds-stat-value{font-size:1.5em}`
      + `.ds-page-actions{width:100%}.ds-page-actions>.ds-btn:not(.ds-btn-icon){flex:1 1 auto}`
      + `:is(.ds-toolbar,.ds-table-toolbar)>.ds-field{flex:1 1 calc(50% - 6px);max-width:none}:is(.ds-toolbar,.ds-table-toolbar)>.ds-field-grow{flex-basis:100%}.ds-table-toolbar>.ds-input-icon{flex-basis:100%;max-width:none}.ds-table-toolbar>.ds-toolbar-end{margin-left:0;width:100%}.ds-toolbar-end{margin-left:0;width:100%}.ds-toolbar-end>.ds-btn:not(.ds-btn-icon){flex:1 1 auto}`
      + `.ds-list>li{flex-wrap:wrap}.ds-list>li>div{flex:1 1 12rem;min-width:0}.ds-tab{min-height:36px}.ds-hide-sm{display:none !important}`
      + `.ds-chart>svg{min-width:560px}.ds-btn-sm{min-height:32px}.ds-btn-icon.ds-btn-sm{width:32px}.ds-chip{min-height:32px}.ds-tree-toggle{width:32px;height:32px}.ds-tree-leaf{width:32px}`
      + `.ds-table-cards thead{display:none}.ds-table-cards,.ds-table-cards tbody{display:block;width:100%}`
      + `.ds-table-cards tr{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;padding:14px 16px;border-bottom:1px solid var(--ds-border)}.ds-table-cards tbody tr:last-child{border-bottom:0}`
      + `.ds-table-cards td,.ds-table-cards td.ds-num{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;height:auto;padding:0;border:0;text-align:left;white-space:normal}`
      + `.ds-table-cards td::before{content:attr(data-label);font-size:max(.78em,11px);font-weight:500;color:var(--ds-fg-muted)}.ds-table-cards td>*{max-width:100%;min-width:0}.ds-table-cards td>.ds-media{width:100%}.ds-table-cards .ds-media-title,.ds-table-cards .ds-media-sub{white-space:normal}`
      + `.ds-table-cards td.ds-check{display:none}`
      + `.ds-table-cards td:first-child:not(.ds-check),.ds-table-cards td.ds-check+td{grid-column:1/-1;padding-right:40px;font-weight:600}`
      + `.ds-table-cards td:first-child::before,.ds-table-cards td.ds-check+td::before,.ds-table-cards td.ds-actions::before{content:none}`
      + `.ds-table-cards td.ds-actions{grid-column:1/-1;flex-direction:row;flex-wrap:wrap;justify-content:flex-end;gap:8px}`
      + `.ds-table-cards td.ds-actions:has(>.ds-btn-icon:only-child),.ds-table-cards td.ds-actions:has(>.ds-dropdown:only-child){position:absolute;top:8px;right:8px}`
      + `.ds-table-cards td .ds-progress{width:100%;margin-top:4px}`
      /* data-phone="scroll": the table stays a table and scrolls in its wrapper, the first column held in place;
         data-phone="expand": the kept first column shows that the row opens for the rest. */
      + `.ds-table-scroll th:first-child,.ds-table-scroll td:first-child{position:sticky;left:0;z-index:1;background:var(--ds-surface)}`
      + `.ds-table-expand tbody td:first-child::after{content:"›";margin-left:8px;color:var(--ds-fg-muted)}`
      + `}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The style block injected into every styled UI-reference screen. */
export function screenStyleBlock(spec: DesignSystemSpec): string {
  return `<style data-design-system="${esc(spec.name)}">\n${tokensCss(spec)}\n${kitCss(spec)}\n</style>`;
}

/** Inject the design-system styles as the first thing in <head> (or the document). */
export function injectDesignSystem(html: string, spec: DesignSystemSpec): string {
  const block = screenStyleBlock(spec);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}\n${block}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${block}</head>`);
  return `${block}\n${html}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A one-page kit: swatches, type, controls and a small app shell. */
export function previewHtml(spec: DesignSystemSpec, mode: "light" | "dark"): string {
  const lib = findLibrary(spec.component_library);
  const p = spec[mode];
  const swatches = (Object.keys(p) as Array<keyof DsPalette>)
    .map((k) => `<div class="sw"><span style="background:${p[k]}"></span><b>${k}</b><code>${p[k]}</code></div>`)
    .join("");
  return `<!doctype html>
<html lang="en" data-theme="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.name)} — preview</title>
<style>
${tokensCss(spec, { forcedMode: mode })}
${kitCss(spec)}
.sw{display:flex;flex-direction:column;gap:4px;font-size:12px}.sw span{height:44px;border-radius:var(--ds-radius);border:1px solid var(--ds-border)}.sw code{color:var(--ds-fg-muted)}
.swatches{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(96px,1fr))}
section{margin-bottom:32px}.label{font-size:12px;color:var(--ds-fg-muted);margin:0 0 8px}
</style>
</head>
<body>
<div class="ds-topbar"><a class="ds-brand" href="#">${esc(spec.name)}</a><nav class="ds-nav" aria-label="Main"><a href="#" aria-current="page">Overview</a><a href="#">Projects</a><a href="#">Settings</a></nav><span class="ds-spacer"></span><span class="ds-muted ds-small">${esc(lib?.name ?? spec.component_library)} · ${mode}</span><span class="ds-avatar">AR</span></div>
<main class="ds-container">
<section><h1>${esc(spec.name)}</h1><p class="ds-muted">${esc(spec.summary)}</p></section>
<section><p class="label">Colour</p><div class="swatches">${swatches}</div></section>
<section><p class="label">Type</p><h1>Display heading</h1><h2>Section heading</h2><h3>Card title</h3><p>Body text sets the reading rhythm of every screen. <a href="#">A link looks like this.</a></p><p class="ds-muted ds-small">Secondary text for hints and metadata.</p><p><code>npm run test</code></p></section>
<section><p class="label">Actions</p><div class="ds-row"><button class="ds-btn ds-btn-primary" type="button">Save changes</button><button class="ds-btn" type="button">Cancel</button><button class="ds-btn ds-btn-ghost" type="button">More</button><button class="ds-btn ds-btn-danger" type="button">Delete</button><button class="ds-btn ds-btn-sm" type="button">Small</button></div></section>
<section class="ds-grid">
<div class="ds-card ds-stack"><h3>Create a project</h3>
<div class="ds-field"><label class="ds-label" for="n">Project name</label><input class="ds-input" id="n" value="Lunch poll"><span class="ds-help">Shown to everyone on the team.</span></div>
<div class="ds-field"><label class="ds-label" for="v">Visibility</label><select class="ds-select" id="v"><option>Team only</option></select></div>
<div class="ds-field"><label class="ds-label" for="e">Owner email</label><input class="ds-input" id="e" aria-invalid="true" value="alex@"><span class="ds-error">Enter a full email address.</span></div>
<label class="ds-checkbox"><input type="checkbox" checked> Notify the team</label>
<div class="ds-row"><button class="ds-btn ds-btn-primary" type="button">Create project</button></div></div>
<div class="ds-stack">
<div class="ds-grid"><div class="ds-card ds-stat"><span class="ds-stat-label">Open tasks</span><span class="ds-stat-value">24</span><span class="ds-small ds-muted">+3 this week</span></div><div class="ds-card ds-stat"><span class="ds-stat-label">Done</span><span class="ds-stat-value">118</span><span class="ds-small ds-muted">82% of plan</span></div></div>
<div class="ds-alert ds-alert-success">Project saved. The team can see it now.</div>
<div class="ds-alert ds-alert-warn">Two tasks are waiting for review.</div>
<div class="ds-alert ds-alert-danger">The last build failed. Check the test output.</div>
<div class="ds-alert ds-alert-info">A new version of the design is available.</div>
</div>
</section>
<section class="ds-card"><div class="ds-tabs" role="tablist"><button class="ds-tab" role="tab" aria-selected="true" type="button">Tasks</button><button class="ds-tab" role="tab" aria-selected="false" type="button">Members</button><button class="ds-tab" role="tab" aria-selected="false" type="button">Activity</button></div>
<table class="ds-table"><thead><tr><th>Task</th><th>Owner</th><th>Status</th></tr></thead><tbody>
<tr><td>Set up the database</td><td>Alex</td><td><span class="ds-badge ds-badge-success">Done</span></td></tr>
<tr><td>Voting screen</td><td>Sam</td><td><span class="ds-badge ds-badge-info">In progress</span></td></tr>
<tr><td>Close poll action</td><td>Kim</td><td><span class="ds-badge ds-badge-warn">Review</span></td></tr>
<tr><td>Email reminders</td><td>—</td><td><span class="ds-badge">Draft</span></td></tr>
</tbody></table></section>
<section class="ds-row" style="align-items:flex-start"><div class="ds-dialog ds-stack"><h3>Delete this poll?</h3><p class="ds-muted">Votes are removed for everyone. This cannot be undone.</p><div class="ds-row"><span class="ds-spacer"></span><button class="ds-btn" type="button">Keep it</button><button class="ds-btn ds-btn-danger" type="button">Delete poll</button></div></div><div class="ds-toast">Link copied to the clipboard</div></section>
<section><div class="ds-empty">No polls yet. Create one to get started.</div></section>
</main>
</body>
</html>`;
}
