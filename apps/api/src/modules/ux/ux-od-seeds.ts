/*
 * Seed templates for UI-reference screens in open-design style.
 *
 * Portions adapted from OpenDesign, Copyright the nexu-io/open-design authors,
 * licensed under the Apache License, Version 2.0
 * (http://www.apache.org/licenses/LICENSE-2.0). Modified: rewritten for
 * product UI and bound to this platform's token contract; see
 * THIRD_PARTY_NOTICES.md.
 *
 * Adapted from nexu-io/open-design (Apache-2.0): the web-prototype seed
 * (design-templates/web-prototype/assets/template.html — its class system and
 * the rule "DO NOT invent new global classes"), the layout primitives of OD
 * Next (task-profiles/prototype/layout.css), the mobile-app and Android
 * handheld shells, the dashboard skill and the wireframe-greybox skill. The
 * class names and CSS here are rewritten for product UI and bound to the
 * open-design token contract (the 56 tokens our design-system package emits).
 *
 * A seed is the platform's half of a screen: its base CSS is injected into
 * every screen document (never written by the model), its skeleton and class
 * vocabulary go into the prompt, and its navigation is rendered by the
 * platform into the `data-sdd-nav` slot so every screen shares one.
 */
import type { UxPlatform, UxScreenType, UxShellLayout } from "@sdd/contracts";
import { navIcon } from "./ux-icons.js";

export type OdSeedId = "web-app" | "dashboard" | "android-app" | "wireframe";
/** The structure a screen is built on: which shell and navigation it has. */
export type OdStructure = "web-sidebar" | "web-topnav" | "web-minimal" | "android";

export interface OdSeed {
  id: OdSeedId;
  structure: OdStructure;
  /** CSS the platform injects after the tokens; uses only the token contract. */
  css: string;
  /** The body skeleton the model starts from (markers, nav slot, overlays section). */
  skeleton: string;
  /** The class vocabulary and layout skeletons the model may use. */
  classDoc: string;
  /** Hard rules of this seed. */
  p0: string[];
  /** Craft references this seed asks for (craft/*.md slugs). */
  craft: string[];
}

/* ─────────────────────────── base class system ─────────────────────────── */

const BASE_CSS = String.raw`
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-body);font-size:var(--text-base);line-height:var(--leading-body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img,svg{display:block;max-width:100%}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;cursor:pointer}
p{margin:0;text-wrap:pretty}
ul,ol{margin:0}
h1,h2,h3,h4{margin:0;text-wrap:balance;line-height:var(--leading-tight)}
h1,.h1{font-family:var(--font-display);font-size:var(--text-2xl);font-weight:650;letter-spacing:var(--tracking-display)}
h2,.h2{font-family:var(--font-display);font-size:var(--text-xl);font-weight:620}
h3,.h3{font-size:var(--text-lg);font-weight:600}
h4,.h4{font-size:var(--text-base);font-weight:600}
.display{font-family:var(--font-display);font-size:var(--text-3xl);font-weight:650;line-height:var(--leading-tight);letter-spacing:var(--tracking-display)}
.lead{font-size:var(--text-lg);color:var(--fg-2);max-width:65ch}
.muted{color:var(--muted)}
.meta{font-size:var(--text-sm);color:var(--meta)}
.label{font-size:var(--text-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.num{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.figure{font-size:var(--text-2xl);font-weight:650;line-height:1.1;letter-spacing:var(--tracking-display);font-variant-numeric:tabular-nums}
.ds-icon{width:1.15em;height:1.15em;flex:none}
:where(.stack,.row,.row-top,.row-between,.cluster,.grid,.split,.split-wide)>:where(*){min-width:0}
.stack{display:flex;flex-direction:column;gap:var(--gap,var(--space-4))}
.stack-sm{--gap:var(--space-2)}
.stack-lg{--gap:var(--space-8)}
.row{display:flex;align-items:center;gap:var(--gap,var(--space-3))}
.row-top{display:flex;align-items:flex-start;gap:var(--gap,var(--space-3))}
.row-between{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap}
.cluster{display:flex;flex-wrap:wrap;align-items:center;gap:var(--gap,var(--space-2))}
.grid{display:grid;gap:var(--gap,var(--space-4));grid-template-columns:repeat(var(--cols,3),minmax(0,1fr))}
.split{display:grid;gap:var(--space-6);grid-template-columns:minmax(0,1fr) minmax(0,22rem);align-items:start}
.split-wide{display:grid;gap:var(--space-6);grid-template-columns:minmax(0,3fr) minmax(0,2fr);align-items:start}
.fill{flex:1 1 0;min-width:0}
.end{margin-left:auto}
.truncate{display:block;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.clamp-2{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.nowrap{white-space:nowrap}
@media(max-width:920px){.grid{grid-template-columns:repeat(min(var(--cols,3),2),minmax(0,1fr))}.split,.split-wide{grid-template-columns:minmax(0,1fr)}}
@media(max-width:560px){.grid{grid-template-columns:minmax(0,1fr)}}
.section{display:flex;flex-direction:column;gap:var(--space-4)}
.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap}
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--space-4);flex-wrap:wrap}
.divider{border:0;border-top:var(--border-width) solid var(--border);margin:0}
.card{background:var(--surface);border:var(--border-width) solid var(--border);border-radius:var(--radius-md);padding:var(--space-5);box-shadow:var(--elev-flat)}
.card-raised{box-shadow:var(--elev-raised)}
.card-flush{padding:0;overflow:hidden}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-3)}
.panel{background:var(--surface-warm);border-radius:var(--radius-md);padding:var(--space-4)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);min-height:40px;padding:0 var(--space-4);border-radius:var(--radius-sm);border:var(--border-width) solid var(--border-strong);background:var(--surface);color:var(--fg);font-size:var(--text-sm);font-weight:550;white-space:nowrap;transition:background var(--motion-fast) var(--ease-standard),border-color var(--motion-fast) var(--ease-standard)}
.btn-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-on)}
.btn-primary:hover{background:var(--accent-hover)}
.btn-ghost{background:transparent;border-color:transparent}
.btn-danger{background:var(--surface);border-color:var(--danger);color:var(--danger)}
.btn-sm{min-height:32px;padding:0 var(--space-3);font-size:var(--text-xs)}
.btn-lg{min-height:48px;padding:0 var(--space-6);font-size:var(--text-base)}
.btn-block{width:100%}
.icon-btn{display:inline-grid;place-items:center;width:40px;height:40px;flex:none;border-radius:var(--radius-pill);border:0;background:transparent;color:var(--fg-2)}
.btn:focus-visible,.icon-btn:focus-visible,.input:focus-visible,.select:focus-visible,.textarea:focus-visible,.chip:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.form{display:flex;flex-direction:column;gap:var(--space-4)}
.form-row{display:grid;gap:var(--space-4);grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:560px){.form-row{grid-template-columns:minmax(0,1fr)}}
.field{display:flex;flex-direction:column;gap:var(--space-1)}
.field>label,.field-label{font-size:var(--text-sm);font-weight:550;color:var(--fg-2)}
.input,.select,.textarea{width:100%;min-height:40px;padding:var(--space-2) var(--space-3);border:var(--border-width) solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--fg);font:inherit;font-size:var(--text-sm)}
.textarea{min-height:96px;resize:vertical}
.help{font-size:var(--text-xs);color:var(--muted)}
.error{font-size:var(--text-xs);color:var(--danger)}
.check{display:inline-flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm)}
.toolbar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--space-3)}
.chips{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.chip{display:inline-flex;align-items:center;gap:var(--space-1);min-height:32px;padding:0 var(--space-3);border-radius:var(--radius-pill);border:var(--border-width) solid var(--border);background:var(--surface);color:var(--fg-2);font-size:var(--text-sm);white-space:nowrap}
.chip[aria-pressed=true],.chip.is-active{background:var(--fg);border-color:var(--fg);color:var(--bg)}
.ds-table-wrap{overflow-x:auto;border:var(--border-width) solid var(--border);border-radius:var(--radius-md);background:var(--surface)}
.table{width:100%;border-collapse:collapse;font-size:var(--text-sm)}
.table th,.table td{padding:var(--space-3) var(--space-4);text-align:left;vertical-align:middle;border-bottom:var(--border-width) solid var(--border-soft)}
.table th{font-size:var(--text-xs);font-weight:600;color:var(--muted);background:var(--surface-warm);white-space:nowrap}
.table tr:last-child td{border-bottom:0}
.table .num-col{text-align:right;font-variant-numeric:tabular-nums}
.table tr.is-selected td{background:var(--surface-warm)}
@media(max-width:560px){.table-cards thead{display:none}.table-cards tr{display:grid;gap:var(--space-1);padding:var(--space-3) var(--space-4);border-bottom:var(--border-width) solid var(--border-soft)}.table-cards td{padding:0;border:0}.table-cards td[data-label]::before{content:attr(data-label) " · ";color:var(--muted);font-size:var(--text-xs)}}
.list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.list-row{display:flex;align-items:center;gap:var(--space-3);min-height:56px;padding:var(--space-3) 0;border-bottom:var(--border-width) solid var(--border-soft)}
.list-row:last-child{border-bottom:0}
.list-row.is-selected{background:var(--surface-warm);border-radius:var(--radius-sm);padding-inline:var(--space-3)}
.avatar{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:var(--radius-pill);background:var(--surface-warm);color:var(--fg-2);font-size:var(--text-xs);font-weight:600;flex:none}
.badge{display:inline-flex;align-items:center;gap:var(--space-1);padding:2px var(--space-2);border-radius:var(--radius-pill);background:var(--surface-warm);color:var(--fg-2);font-size:var(--text-xs);font-weight:600;white-space:nowrap}
.badge-success{background:color-mix(in oklab,var(--success) 16%,var(--surface));color:color-mix(in oklab,var(--success) 62%,var(--fg))}
.badge-warn{background:color-mix(in oklab,var(--warn) 22%,var(--surface));color:color-mix(in oklab,var(--warn) 45%,var(--fg))}
.badge-danger{background:color-mix(in oklab,var(--danger) 14%,var(--surface));color:color-mix(in oklab,var(--danger) 70%,var(--fg))}
.badge-info{background:color-mix(in oklab,var(--info) 14%,var(--surface));color:color-mix(in oklab,var(--info) 65%,var(--fg))}
.badge-accent{background:color-mix(in oklab,var(--accent) 14%,var(--surface));color:color-mix(in oklab,var(--accent) 70%,var(--fg))}
.tag{display:inline-flex;align-items:center;padding:2px var(--space-2);border-radius:var(--radius-pill);border:var(--border-width) solid var(--border);color:var(--muted);font-size:var(--text-xs)}
.stat{display:grid;gap:var(--space-1)}
.stat-label{font-size:var(--text-sm);color:var(--muted)}
.stat-num{font-size:var(--text-2xl);font-weight:650;line-height:1.1;letter-spacing:var(--tracking-display);font-variant-numeric:tabular-nums}
.stat-meta{font-size:var(--text-xs);color:var(--meta)}
.progress{height:8px;border-radius:var(--radius-pill);background:var(--surface-warm);overflow:hidden}
.progress>span{display:block;height:100%;border-radius:inherit;background:var(--accent)}
.tabs{display:flex;gap:var(--space-1);overflow-x:auto;border-bottom:var(--border-width) solid var(--border)}
.tab{padding:var(--space-2) var(--space-3);border-bottom:2px solid transparent;color:var(--muted);font-size:var(--text-sm);white-space:nowrap}
.tab[aria-selected=true],.tab.is-active{color:var(--fg);border-bottom-color:var(--accent);font-weight:600}
.dl{display:grid;grid-template-columns:minmax(0,10rem) minmax(0,1fr);gap:var(--space-2) var(--space-4);margin:0}
.dl dt{color:var(--muted);font-size:var(--text-sm)}
.dl dd{margin:0}
.timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-4);border-left:var(--border-width) solid var(--border);padding-left:var(--space-4)}
.timeline>li{position:relative}
.timeline>li::before{content:"";position:absolute;left:calc(-1 * var(--space-4) - 4px);top:.45em;width:8px;height:8px;border-radius:var(--radius-pill);background:var(--border-strong)}
.steps{display:flex;gap:var(--space-2);list-style:none;margin:0;padding:0;font-size:var(--text-sm);color:var(--muted)}
.steps>li{flex:1;padding-top:var(--space-2);border-top:3px solid var(--border)}
.steps>li.is-done,.steps>li[aria-current=step]{border-top-color:var(--accent);color:var(--fg)}
.empty{display:grid;justify-items:center;gap:var(--space-2);padding:var(--space-8) var(--space-4);text-align:center;color:var(--muted)}
.alert{display:flex;gap:var(--space-3);padding:var(--space-3) var(--space-4);border:var(--border-width) solid var(--border);border-radius:var(--radius-md);background:var(--surface-warm)}
.alert-danger{border-color:var(--danger)}
.alert-warn{border-color:var(--warn)}
.alert-success{border-color:var(--success)}
.skeleton{min-height:1em;border-radius:var(--radius-sm);background:var(--surface-warm)}
.toast{display:inline-flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);background:var(--fg);color:var(--bg);box-shadow:var(--elev-raised);font-size:var(--text-sm)}
.ph-img{display:grid;place-items:center;aspect-ratio:var(--ratio,4/3);padding:var(--space-2);border:var(--border-width) dashed var(--border-strong);border-radius:var(--radius-md);background:var(--surface-warm);color:var(--muted);font-size:var(--text-xs);text-align:center}
.ph-img[data-ratio="1:1"]{--ratio:1/1}
.ph-img[data-ratio="3:2"]{--ratio:3/2}
.ph-img[data-ratio="16:9"]{--ratio:16/9}
.ph-img[data-ratio="3:4"]{--ratio:3/4}
.chart{display:block;width:100%}
.chart svg{width:100%;height:auto;overflow:visible}
.chart .chart-grid{stroke:var(--border-soft);stroke-width:1}
.chart .chart-axis{fill:var(--muted);font-size:11px}
.chart .chart-line{fill:none;stroke:var(--accent);stroke-width:2}
.chart .chart-area{fill:color-mix(in oklab,var(--accent) 14%,transparent)}
.chart .chart-bar{fill:var(--accent)}
.chart .chart-bar-muted{fill:var(--border-strong)}
.kbd{font-family:var(--font-mono);font-size:var(--text-xs);padding:1px 6px;border:var(--border-width) solid var(--border);border-radius:var(--radius-sm)}
.overlays{display:grid;gap:var(--space-8);margin-top:var(--space-12);padding:var(--space-6) var(--container-gutter-desktop);border-top:1px dashed var(--border-strong)}
.overlays-title{font-size:var(--text-sm);font-weight:600;color:var(--muted)}
.frame{display:grid;gap:var(--space-2);margin:0}
.frame>figcaption{font-size:var(--text-xs);font-weight:600;color:var(--muted)}
.stage{display:grid;place-items:center;min-height:440px;padding:var(--space-6);border-radius:var(--radius-md);background:color-mix(in oklab,var(--fg) 46%,transparent)}
.stage-end{place-items:stretch end;padding:0}
.stage-bottom{place-items:end stretch;padding:0}
.dialog{display:flex;flex-direction:column;gap:var(--space-4);width:min(100%,32rem);padding:var(--space-6);border-radius:var(--radius-lg);background:var(--surface);box-shadow:var(--elev-raised)}
.dialog-footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--space-2)}
.sheet{display:flex;flex-direction:column;gap:var(--space-4);width:min(100%,26rem);padding:var(--space-6);background:var(--surface);box-shadow:var(--elev-raised)}
.sheet-bottom{width:100%;border-radius:var(--radius-lg) var(--radius-lg) 0 0}
.state{padding:var(--space-6);border:var(--border-width) dashed var(--border);border-radius:var(--radius-md);background:var(--bg)}
.brand{display:flex;align-items:center;gap:var(--space-2);min-width:0;font-family:var(--font-display);font-weight:650}
.brand-mark{display:inline-grid;place-items:center;width:28px;height:28px;flex:none;border-radius:var(--radius-sm);background:var(--accent);color:var(--accent-on);font-size:var(--text-xs);font-weight:700}
.main{display:flex;flex-direction:column;gap:var(--space-6);width:100%;max-width:var(--container-max);margin-inline:auto;padding:var(--space-6) var(--container-gutter-desktop) var(--space-12)}
@media(max-width:920px){.main{padding:var(--space-5) var(--container-gutter-tablet) var(--space-12)}}
@media(max-width:560px){.main{padding:var(--space-4) var(--container-gutter-phone) var(--space-12)}}
`;

/* ─────────────────────────── shells ─────────────────────────── */

const WEB_SIDEBAR_CSS = String.raw`
.app{min-height:100dvh;background:var(--bg)}
.app-side{display:grid;grid-template-columns:minmax(0,1fr)}
.sidebar{display:flex;flex-direction:column;gap:var(--space-4);padding:var(--space-4);background:var(--surface);border-bottom:var(--border-width) solid var(--border)}
.side-nav{display:flex;gap:var(--space-1);overflow-x:auto}
.nav-item{display:flex;align-items:center;gap:var(--space-2);min-height:36px;padding:0 var(--space-3);border-radius:var(--radius-sm);color:var(--fg-2);font-size:var(--text-sm);white-space:nowrap}
.nav-item[aria-current=page]{background:var(--surface-warm);color:var(--fg);font-weight:600}
.sidebar-foot{margin-top:auto;display:flex;flex-direction:column;gap:var(--space-2)}
.workspace{display:flex;flex-direction:column;min-width:0}
.appbar{display:flex;align-items:center;gap:var(--space-3);min-height:56px;padding:0 var(--container-gutter-desktop);border-bottom:var(--border-width) solid var(--border);background:var(--bg)}
@media(min-width:900px){.app-side{grid-template-columns:15rem minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100dvh;border-bottom:0;border-right:var(--border-width) solid var(--border)}.side-nav{flex-direction:column;overflow:visible}}
`;

const WEB_TOPNAV_CSS = String.raw`
.app{min-height:100dvh;background:var(--bg)}
.app-top{display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:var(--space-4);min-height:60px;padding:0 var(--container-gutter-desktop);background:var(--surface);border-bottom:var(--border-width) solid var(--border)}
.top-nav{display:flex;gap:var(--space-1);min-width:0;overflow-x:auto}
.top-nav-item{display:flex;align-items:center;min-height:36px;padding:0 var(--space-3);border-radius:var(--radius-sm);color:var(--fg-2);font-size:var(--text-sm);white-space:nowrap}
.top-nav-item[aria-current=page]{background:var(--surface-warm);color:var(--fg);font-weight:600}
.topbar-end{margin-left:auto;display:flex;align-items:center;gap:var(--space-2)}
@media(max-width:720px){.topbar{flex-wrap:wrap;padding-block:var(--space-2)}.top-nav{order:3;width:100%}}
`;

const WEB_MINIMAL_CSS = String.raw`
.app{min-height:100dvh;background:var(--bg)}
.app-min{display:flex;flex-direction:column}
.topbar{display:flex;align-items:center;gap:var(--space-3);min-height:56px;padding:0 var(--container-gutter-desktop);border-bottom:var(--border-width) solid var(--border);background:var(--surface)}
.topbar-title{color:var(--muted);font-size:var(--text-sm)}
.topbar-end{margin-left:auto;display:flex;align-items:center;gap:var(--space-2)}
`;

const DASHBOARD_CSS = String.raw`
.kpis{display:grid;gap:var(--space-4);grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))}
.kpi{display:grid;gap:var(--space-1);padding:var(--space-4);border:var(--border-width) solid var(--border);border-radius:var(--radius-md);background:var(--surface)}
.kpi-label{font-size:var(--text-sm);color:var(--muted)}
.kpi-num{font-size:var(--text-2xl);font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:var(--tracking-display)}
.delta{font-size:var(--text-xs);font-weight:600;color:var(--muted)}
.delta-up{color:color-mix(in oklab,var(--success) 62%,var(--fg))}
.delta-down{color:color-mix(in oklab,var(--danger) 70%,var(--fg))}
.chart-card{display:flex;flex-direction:column;gap:var(--space-3)}
.queue{display:flex;flex-direction:column}
.queue-item{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) 0;border-bottom:var(--border-width) solid var(--border-soft)}
`;

const ANDROID_CSS = String.raw`
.app{background:var(--bg)}
.app-android{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;min-height:100dvh}
.status-bar{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;height:28px;padding:0 var(--space-5);font-size:12px;font-weight:600;color:var(--fg)}
.status-icons{display:flex;align-items:center;gap:4px}
.nav-rail{display:none}
.screen{display:flex;flex-direction:column;min-width:0;min-height:0}
.top-app-bar{display:flex;align-items:center;gap:var(--space-2);min-height:64px;padding:0 var(--space-2)}
.top-app-bar-title{flex:1;min-width:0;font-family:var(--font-body);font-size:22px;font-weight:500;letter-spacing:0}
.top-app-bar-actions{display:flex;gap:var(--space-1)}
.app-android .main{max-width:none;gap:var(--space-4);padding:var(--space-2) var(--space-4) 112px}
.app-android .btn{min-height:48px;border-radius:var(--radius-pill)}
.app-android .input,.app-android .select{min-height:52px}
.bottom-nav{position:sticky;bottom:0;display:grid;grid-template-columns:repeat(var(--tabs,4),minmax(0,1fr));min-height:80px;background:var(--surface-warm);border-top:var(--border-width) solid var(--border-soft)}
.bottom-item,.rail-item{display:grid;justify-items:center;align-content:center;gap:4px;font-size:12px;font-weight:500;color:var(--fg-2)}
.pill-icon{display:inline-grid;place-items:center;width:64px;height:32px;border-radius:var(--radius-pill)}
.bottom-item[aria-current=page],.rail-item[aria-current=page]{color:var(--fg);font-weight:700}
.bottom-item[aria-current=page] .pill-icon,.rail-item[aria-current=page] .pill-icon{background:color-mix(in oklab,var(--accent) 20%,var(--surface))}
.fab{position:fixed;right:var(--space-4);bottom:96px;z-index:5;display:inline-flex;align-items:center;gap:var(--space-2);min-height:56px;padding:0 var(--space-5);border:0;border-radius:var(--radius-lg);background:color-mix(in oklab,var(--accent) 22%,var(--surface));color:var(--fg);box-shadow:var(--elev-raised);font-weight:600}
@media(min-width:600px){.app-android{grid-template-columns:88px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.nav-rail{grid-row:2;display:flex;flex-direction:column;align-items:center;gap:var(--space-4);padding:var(--space-5) 0;background:var(--surface)}.screen{grid-row:2;grid-column:2}.bottom-nav{display:none}.pill-icon{width:56px}.fab{bottom:var(--space-6)}.app-android .main{padding-bottom:var(--space-12)}}
`;

/** The greybox skin of open-design's wireframe-greybox skill: structure, not brand. */
const WIREFRAME_CSS = String.raw`
.btn-primary{background:var(--fg);border-color:var(--fg);color:var(--bg)}
.btn-primary:hover{background:var(--fg-2)}
.card,.kpi{box-shadow:none}
.brand-mark{background:var(--fg);color:var(--bg)}
.note{font-family:var(--font-mono);font-size:var(--text-xs);color:var(--danger);border-left:2px solid var(--danger);padding-left:var(--space-2)}
`;

/* ─────────────────────────── skeletons ─────────────────────────── */

const OVERLAYS_SKELETON = `<section class="overlays" data-sdd-overlays aria-label="Overlays and states">
  <h2 class="overlays-title">Overlays and states</h2>
  <figure class="frame" data-sdd-frame data-kind="dialog">
    <figcaption>Dialog: [REPLACE name]</figcaption>
    <div class="stage" data-sdd-stage>
      <div class="dialog" role="dialog" aria-labelledby="[id]"><h2 id="[id]">[REPLACE]</h2> … <div class="dialog-footer"><button class="btn">Cancel</button><button class="btn btn-primary">[Verb + object]</button></div></div>
    </div>
  </figure>
  <!-- a sheet: <div class="stage stage-end" data-sdd-stage><div class="sheet">…</div></div>; a confirm: a small .dialog with a .btn-danger; a state: <figure data-sdd-frame data-kind="state"><figcaption>State: …</figcaption><div class="state">…</div></figure> -->
</section>`;

const SKELETONS: Record<OdStructure, string> = {
  "web-sidebar": `<div class="app app-side" data-sdd-app>
  <aside class="sidebar">
    <div class="brand" data-sdd-brand><span class="brand-mark">[INITIALS]</span><span>[BRAND]</span></div>
    <nav class="side-nav" data-sdd-nav="side" aria-label="Main">[NAVIGATION — copy the markup you are given]</nav>
  </aside>
  <div class="workspace">
    <main class="main" data-screen-content>
      <header class="page-head"><h1>[REPLACE screen title]</h1> [optional actions]</header>
      <section class="section" data-od-id="[slug]">[REPLACE]</section>
    </main>
  </div>
</div>
${OVERLAYS_SKELETON}`,
  "web-topnav": `<div class="app app-top" data-sdd-app>
  <header class="topbar">
    <div class="brand" data-sdd-brand><span class="brand-mark">[INITIALS]</span><span>[BRAND]</span></div>
    <nav class="top-nav" data-sdd-nav="top" aria-label="Main">[NAVIGATION — copy the markup you are given]</nav>
    <div class="topbar-end">[utilities only when the plan's shell asks for them]</div>
  </header>
  <main class="main" data-screen-content>
    <header class="page-head"><h1>[REPLACE screen title]</h1></header>
    <section class="section" data-od-id="[slug]">[REPLACE]</section>
  </main>
</div>
${OVERLAYS_SKELETON}`,
  "web-minimal": `<div class="app app-min" data-sdd-app>
  <header class="topbar">
    <div class="brand" data-sdd-brand><span class="brand-mark">[INITIALS]</span><span>[BRAND]</span></div>
    <span class="topbar-title">[screen name]</span>
    <div class="topbar-end">[utilities only when the plan's shell asks for them]</div>
  </header>
  <main class="main" data-screen-content>
    <h1>[REPLACE screen title]</h1>
    <section class="section" data-od-id="[slug]">[REPLACE]</section>
  </main>
</div>
${OVERLAYS_SKELETON}`,
  android: `<div class="app app-android" data-sdd-app>
  <div class="status-bar" aria-hidden="true"><span>9:41</span><span class="status-icons"><i data-icon="signal"></i><i data-icon="wifi"></i><i data-icon="battery-full"></i></span></div>
  <nav class="nav-rail" data-sdd-nav="rail" aria-label="Main">[NAVIGATION — rail]</nav>
  <div class="screen">
    <header class="top-app-bar"><button class="icon-btn" aria-label="Open menu"><i data-icon="menu"></i></button><h1 class="top-app-bar-title">[REPLACE screen title]</h1><div class="top-app-bar-actions">[icon buttons]</div></header>
    <main class="main" data-screen-content>
      <section class="section" data-od-id="[slug]">[REPLACE]</section>
      [optional FAB for the primary action: <button class="fab"><i data-icon="plus"></i>Verb</button>]
    </main>
  </div>
  <nav class="bottom-nav" data-sdd-nav="bottom" aria-label="Main">[NAVIGATION — bottom]</nav>
</div>
${OVERLAYS_SKELETON.replace('class="stage stage-end"', 'class="stage stage-bottom"').replace('<div class="sheet">', '<div class="sheet sheet-bottom">')}`,
};

/* ─────────────────────────── class vocabulary ─────────────────────────── */

const BASE_DOC = `Class vocabulary (defined by the platform — use these, add nothing global):
- Type: h1–h4 (one h1 per screen), .display (a hero number or headline, only when the brief calls for it), .lead, .muted, .meta, .label (small caps label, already tracked), .num (tabular figures), .figure (a big number).
- Layout: .stack (+ .stack-sm / .stack-lg), .row, .row-top, .row-between, .cluster, .grid (set style="--cols:4" for its columns; collapses on small screens), .split (content + 22rem side), .split-wide (3:2), .fill, .end, .truncate, .clamp-2, .nowrap, .section, .section-head, .page-head, .divider.
- Surfaces: .card (+ .card-raised, .card-flush, .card-head), .panel (a quiet well).
- Actions: .btn, .btn-primary (one per area), .btn-ghost, .btn-danger, .btn-sm, .btn-lg, .btn-block, .icon-btn (needs aria-label), .chips > .chip (.is-active / aria-pressed), .toolbar.
- Forms: .form, .form-row, .field > label + .input / .select / .textarea, .help, .error, .check.
- Data: <table class="table"> (the platform wraps it; add class "table-cards" when a phone should read rows as cards; .num-col for numbers; tr.is-selected), .list > .list-row (.is-selected), .avatar, .badge (+ -success / -warn / -danger / -info / -accent), .tag, .stat > .stat-label + .stat-num + .stat-meta, .progress > span (style="width:62%"), .tabs > .tab (.is-active), .dl (dt/dd), .timeline > li, .steps > li (.is-done, aria-current="step").
- Feedback: .empty, .alert (+ -danger / -warn / -success), .skeleton, .toast.
- Media: .ph-img with data-ratio="1:1|4:3|3:2|16:9|3:4", role="img" and an aria-label naming the subject.
- Charts: <figure class="chart"><svg viewBox="…">…</svg></figure> with classes .chart-grid, .chart-axis, .chart-line, .chart-area, .chart-bar, .chart-bar-muted on the SVG shapes (no fill/stroke colours of your own).
- Overlays: section[data-sdd-overlays] > figure.frame[data-sdd-frame][data-kind] > figcaption + .stage[data-sdd-stage] > .dialog (.dialog-footer) or .sheet; a state frame holds .state.
- Icons: <i data-icon="lucide-name"></i>.

Layout skeletons to compose from (not templates — choose by the person's job):
- Scan and act on records: .page-head → .toolbar (filters as .chips or .field) → table or .list → per-row actions.
- One record: .split → the record (facts in .dl, history in .timeline, related data in .tabs) + a side .card with its status and actions.
- Point of sale / build an order: .split-wide → catalogue (.grid of .card items with .ph-img, name, price) + the open order (.card with .list rows, totals as .figure, one .btn-primary .btn-block).
- Queue / operations: the items needing action first (.list or table with .badge statuses), counts as .stat only when the data holds them.
- Long entry: .form sections with .form-row pairs, .steps when the process is truly staged, actions at the end.`;

const DASHBOARD_DOC = `Dashboard additions: .kpis > .kpi > .kpi-label + .kpi-num + .delta (.delta-up / .delta-down) — only figures the example data holds; .chart-card for a chart with its title; .queue > .queue-item for what needs attention. Lead with the decision or the work waiting, not with a row of numbers.`;

const ANDROID_DOC = `Android (Material 3) additions — the platform draws the status bar, the top app bar shell and the navigation (bottom bar on phones, rail on tablets): .top-app-bar-title holds the screen title (it is the h1), .top-app-bar-actions holds .icon-btn actions, .fab is the screen's one floating primary action (last inside <main>), lists use .list > .list-row (56px+ rows), sheets slide up from the bottom (.stage-bottom > .sheet.sheet-bottom). On a tablet use .split / .split-wide for list–detail or catalogue + order.`;

const WIREFRAME_DOC = `Wireframe fidelity (open-design wireframe-greybox): greys only — the platform's tokens are a greybox palette. Judge layout, hierarchy and flow, not brand. Use .note for a short annotation of behaviour (it renders as a redline) — at most three per screen. Real copy still; no lorem bars.`;

const BASE_P0 = [
  "Use only the seed's classes and the design tokens; no raw colours, url(), fonts or animation; no new global classes (extra rules go in one <style data-screen> with x- classes).",
  "Keep every marker: data-sdd-app, data-screen-content, data-sdd-nav (copied exactly), data-sdd-overlays, data-sdd-frame + data-kind, data-key-element, data-od-id on top-level sections.",
  "One h1 per screen; one .btn-primary per area; labels on every field; aria-label on every .icon-btn.",
  "Numbers only from the shared example data; images only as .ph-img placeholders naming their subject and ratio.",
];

/* ─────────────────────────── selection ─────────────────────────── */

const STRUCTURE_CSS: Record<OdStructure, string> = {
  "web-sidebar": WEB_SIDEBAR_CSS,
  "web-topnav": WEB_TOPNAV_CSS,
  "web-minimal": WEB_MINIMAL_CSS,
  android: ANDROID_CSS,
};

const ANALYTIC: ReadonlySet<UxScreenType> = new Set(["dashboard", "analytics"]);

/** The structure a reference's screens are built on: Android chrome, or the web shell its plan chose. */
export function structureOf(platform: UxPlatform | null | undefined, layout: UxShellLayout | null | undefined): OdStructure {
  if (platform?.kind === "native-mobile") return "android";
  if (layout === "topnav") return "web-topnav";
  if (layout === "minimal") return "web-minimal";
  return "web-sidebar";
}

/**
 * The seed a screen is drawn from: neutral fidelity → the wireframe skin (on
 * the platform's structure), a native app → android-app, a dashboard or
 * analytics screen on the web → dashboard, any other web screen → web-app.
 */
export function selectSeed(input: { platform?: UxPlatform | null; layout?: UxShellLayout | null; screenType?: UxScreenType | null; neutral: boolean }): OdSeed {
  const structure = structureOf(input.platform, input.layout);
  const android = structure === "android";
  const dashboard = !android && ANALYTIC.has((input.screenType ?? "list") as UxScreenType);
  const id: OdSeedId = input.neutral ? "wireframe" : android ? "android-app" : dashboard ? "dashboard" : "web-app";
  const css = [BASE_CSS, STRUCTURE_CSS[structure], dashboard ? DASHBOARD_CSS : "", input.neutral ? WIREFRAME_CSS : ""].join("\n").trim();
  const classDoc = [BASE_DOC, dashboard ? DASHBOARD_DOC : "", android ? ANDROID_DOC : "", input.neutral ? WIREFRAME_DOC : ""].filter(Boolean).join("\n\n");
  const p0 = [
    ...BASE_P0,
    ...(android ? ["Touch targets at least 48dp; no hover-only affordances, keyboard shortcuts or right-click menus; no breadcrumbs.", "Phones read lists and cards, not wide tables (a table needs class table-cards)."] : []),
    ...(dashboard ? ["KPIs only when the data holds them and they help a decision; charts as inline SVG with the chart classes."] : []),
    ...(input.neutral ? ["Greys only: the wireframe judges structure; status is said in words as well as tone."] : []),
  ];
  const craft = input.neutral ? ["laws-of-ux", "state-coverage"] : android ? ["state-coverage", "laws-of-ux"] : dashboard ? ["state-coverage", "laws-of-ux"] : ["state-coverage", "laws-of-ux", "form-validation"];
  return { id, structure, css, skeleton: SKELETONS[structure], classDoc, p0, craft };
}

/* ─────────────────────────── navigation ─────────────────────────── */

type NavScreen = { key: string; name: string; screen_type?: string | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const current = (key: string, currentKey: string) => (key === currentKey ? ' aria-current="page"' : "");
const icon = (s: NavScreen) => `<i data-icon="${navIcon({ name: s.name, key: s.key, screen_type: s.screen_type ?? null })}"></i>`;

/** Bottom navigation holds at most five slots: four destinations and "More" when there are more screens, the current one always among them. */
function bottomSlots(screens: NavScreen[], currentKey: string): { items: NavScreen[]; more: boolean } {
  if (screens.length <= 5) return { items: screens, more: false };
  const first = screens.slice(0, 4);
  if (first.some((s) => s.key === currentKey)) return { items: first, more: true };
  const here = screens.find((s) => s.key === currentKey);
  return { items: here ? [...screens.slice(0, 3), here] : first, more: true };
}

/**
 * The items of one navigation slot (data-sdd-nav="side|top|rail|bottom"),
 * rendered by the platform from the reference's screens so every screen
 * shares one navigation and its links stay valid.
 */
/**
 * Sign-in, sign-up and password screens sit outside the app: they are never a
 * navigation destination and are drawn without the shell's navigation.
 */
export function isAuthScreen(s: { key: string; name: string; shell_mode?: "app" | "auth" | "standalone" }): boolean {
  if (s.shell_mode) return s.shell_mode !== "app";
  return (
    /(^|-)(login|log-in|signin|sign-in|signup|sign-up|register|forgot-password|reset-password|masuk|daftar|lupa-sandi)(-|$)/i.test(s.key) ||
    /^(masuk( sistem| akun)?|login|log in|sign in|sign up|daftar( akun)?|register|lupa (kata )?sandi|reset (kata )?sandi|forgot password)\b/i.test(s.name.trim())
  );
}

export function navItems(variant: string, allScreens: NavScreen[], currentKey: string): string {
  const screens = allScreens.filter((s) => !isAuthScreen(s));
  switch (variant) {
    case "top":
      return screens.map((s) => `<a class="top-nav-item" href="./${s.key}.html"${current(s.key, currentKey)}>${esc(s.name)}</a>`).join("");
    case "rail":
      return screens
        .map((s) => `<a class="rail-item" href="./${s.key}.html"${current(s.key, currentKey)}><span class="pill-icon">${icon(s)}</span><span>${esc(s.name)}</span></a>`)
        .join("");
    case "bottom": {
      const { items, more } = bottomSlots(screens, currentKey);
      const links = items.map((s) => `<a class="bottom-item" href="./${s.key}.html"${current(s.key, currentKey)}><span class="pill-icon">${icon(s)}</span><span>${esc(s.name)}</span></a>`);
      if (more) links.push(`<a class="bottom-item" href="#more"><span class="pill-icon"><i data-icon="ellipsis"></i></span><span>More</span></a>`);
      return links.join("");
    }
    default:
      return screens.map((s) => `<a class="nav-item" href="./${s.key}.html"${current(s.key, currentKey)}>${icon(s)}<span>${esc(s.name)}</span></a>`).join("");
  }
}

/** The navigation markup the model is told to copy for a structure (each slot with its items). */
export function navMarkup(structure: OdStructure, screens: NavScreen[], currentKey: string): string {
  switch (structure) {
    case "web-sidebar":
      return `<nav class="side-nav" data-sdd-nav="side" aria-label="Main">${navItems("side", screens, currentKey)}</nav>`;
    case "web-topnav":
      return `<nav class="top-nav" data-sdd-nav="top" aria-label="Main">${navItems("top", screens, currentKey)}</nav>`;
    case "android": {
      const tabs = Math.min(5, screens.filter((s) => !isAuthScreen(s)).length);
      return [
        `<nav class="nav-rail" data-sdd-nav="rail" aria-label="Main">${navItems("rail", screens, currentKey)}</nav>`,
        `<nav class="bottom-nav" data-sdd-nav="bottom" aria-label="Main" style="--tabs:${tabs}">${navItems("bottom", screens, currentKey)}</nav>`,
      ].join("\n");
    }
    default:
      return "";
  }
}
