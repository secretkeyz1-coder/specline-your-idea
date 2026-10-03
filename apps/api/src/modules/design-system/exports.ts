import type { DesignSystemFile, DesignSystemSpec, DsPackage, DsPalette } from "@sdd/contracts";
import { DS_COLOR_TOKENS } from "@sdd/contracts";
import { checkPalette, mix, rgbTriple, textOn } from "./color.js";
import { COMPONENT_ROLES, MOCKUP_CLASS, findLibrary } from "./libraries.js";
import { cssComment, cssFontStack, firstFamily, jsString, lineComment } from "./escape.js";
import { previewHtml } from "./render.js";
import { craftFor, DEFAULT_CRAFT } from "./craft.js";
import { designMarkdownOd, odPromptBlocks, usageMarkdown } from "./od-package.js";
import { odTokensCss } from "./od-tokens.js";

/**
 * Files written into the repository under docs/design-system/ (`sddctl ui
 * pull`): the tokens in neutral formats, a guide for the agent, previews, and
 * a theme file in the chosen component library's own format. Every spec
 * string is escaped for where it lands (./escape.ts): JS literals via JSON,
 * CSS comments and line comments stripped of what closes them, font stacks
 * re-quoted as CSS strings.
 *
 * Library syntax checked against the libraries' docs in September 2026
 * (shadcn/ui Tailwind v4, daisyUI 5, Bootstrap 5.3, MUI v9, Material 3,
 * Ant Design v6, Flowbite v4, Pico v2).
 */

export const DESIGN_SYSTEM_DIR = "docs/design-system";

const hover = (c: string, mode: "light" | "dark") => mix(c, mode === "light" ? "#000000" : "#ffffff", 0.15);
const px = (n: number) => `${n}px`;
const rem = (n: number) => `${Math.round((n / 16) * 1000) / 1000}rem`;

function dtcg(spec: DesignSystemSpec): string {
  const colors = (p: DsPalette) => Object.fromEntries(DS_COLOR_TOKENS.map((k) => [k, { $type: "color", $value: p[k] }]));
  return JSON.stringify(
    {
      $description: `${spec.name} design tokens (W3C Design Tokens format). Light and dark are separate groups.`,
      color: { light: colors(spec.light), dark: colors(spec.dark) },
      font: {
        display: { $type: "fontFamily", $value: spec.fonts.display },
        body: { $type: "fontFamily", $value: spec.fonts.body },
        mono: { $type: "fontFamily", $value: spec.fonts.mono },
      },
      radius: {
        control: { $type: "dimension", $value: { value: spec.radius, unit: "px" } },
        card: { $type: "dimension", $value: { value: Math.round(spec.radius * 1.5), unit: "px" } },
      },
      border: { width: { $type: "dimension", $value: { value: spec.border_width, unit: "px" } } },
      $extensions: { "sdd.design-system": { density: spec.density, depth: spec.depth, component_library: spec.component_library, preset: spec.preset_id } },
    },
    null,
    2,
  );
}

function tailwindTheme(spec: DesignSystemSpec): string {
  return [
    `/* ${cssComment(spec.name)} — Tailwind CSS v4 theme. Import after tokens.css:`,
    ` *   @import "tailwindcss"; @import "./tokens.css"; @import "./tailwind-theme.css";`,
    ` * Utilities then follow the tokens and switch with dark mode: bg-bg, bg-surface, text-fg,`,
    ` * text-fg-muted, border-border, bg-accent text-accent-fg, text-danger, rounded-control … */`,
    `@theme inline {`,
    ...DS_COLOR_TOKENS.map((k) => `  --color-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: var(--ds-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace("surface2", "surface-2")});`),
    `  --font-sans: var(--ds-font-body);`,
    `  --font-display: var(--ds-font-display);`,
    `  --font-mono: var(--ds-font-mono);`,
    `  --radius-control: var(--ds-radius);`,
    `  --radius-card: var(--ds-radius-card);`,
    `}`,
  ].join("\n");
}

function shadcnTheme(spec: DesignSystemSpec): string {
  const block = (p: DsPalette) => [
    `--background: ${p.bg};`,
    `--foreground: ${p.fg};`,
    `--card: ${p.surface};`,
    `--card-foreground: ${p.fg};`,
    `--popover: ${p.surface};`,
    `--popover-foreground: ${p.fg};`,
    `--primary: ${p.accent};`,
    `--primary-foreground: ${p.accentFg};`,
    `--secondary: ${p.surface2};`,
    `--secondary-foreground: ${p.fg};`,
    `--muted: ${p.surface2};`,
    `--muted-foreground: ${p.fgMuted};`,
    `--accent: ${p.surface2}; /* shadcn "accent" is the hover surface, not the brand colour */`,
    `--accent-foreground: ${p.fg};`,
    `--destructive: ${p.danger};`,
    `--border: ${p.border};`,
    `--input: ${p.borderStrong};`,
    `--ring: ${p.accent};`,
    `--chart-1: ${p.accent};`,
    `--chart-2: ${p.info};`,
    `--chart-3: ${p.success};`,
    `--chart-4: ${p.warn};`,
    `--chart-5: ${p.danger};`,
    `--sidebar: ${p.surface};`,
    `--sidebar-foreground: ${p.fg};`,
    `--sidebar-primary: ${p.accent};`,
    `--sidebar-primary-foreground: ${p.accentFg};`,
    `--sidebar-accent: ${p.surface2};`,
    `--sidebar-accent-foreground: ${p.fg};`,
    `--sidebar-border: ${p.border};`,
    `--sidebar-ring: ${p.accent};`,
    ...(["success", "warn", "info"] as const).flatMap((k) => {
      const name = k === "warn" ? "warning" : k;
      return [`--${name}: ${p[k]};`, `--${name}-foreground: ${textOn(p[k])};`];
    }),
  ];
  const ind = (l: string[]) => l.map((x) => `  ${x}`).join("\n");
  return [
    `/* ${cssComment(spec.name)} — shadcn/ui theme (Tailwind v4). Merge into the CSS file \`shadcn init\` created`,
    ` * (app/globals.css, src/index.css, src/routes/layout.css or src/style.css): replace its :root and`,
    ` * .dark blocks with these, and add the extra lines to its @theme inline block. */`,
    `:root {\n  --radius: ${rem(spec.radius)};\n${ind(block(spec.light))}\n}`,
    `.dark {\n${ind(block(spec.dark))}\n}`,
    `@theme inline {`,
    `  /* status colours and fonts are additions; keep the generated --color-* mappings */`,
    `  --color-success: var(--success);`,
    `  --color-success-foreground: var(--success-foreground);`,
    `  --color-warning: var(--warning);`,
    `  --color-warning-foreground: var(--warning-foreground);`,
    `  --color-info: var(--info);`,
    `  --color-info-foreground: var(--info-foreground);`,
    `  --font-sans: ${cssFontStack(spec.fonts.body)};`,
    `  --font-display: ${cssFontStack(spec.fonts.display)};`,
    `  --font-mono: ${cssFontStack(spec.fonts.mono)};`,
    `}`,
    `@layer base {\n  h1, h2, h3 { font-family: var(--font-display); }\n}`,
  ].join("\n\n");
}

function daisyTheme(spec: DesignSystemSpec): string {
  const theme = (p: DsPalette, mode: "light" | "dark") => [
    `@plugin "daisyui/theme" {`,
    `  name: "app-${mode}";`,
    `  default: ${mode === "light"};`,
    `  prefersdark: ${mode === "dark"};`,
    `  color-scheme: ${mode};`,
    `  --color-base-100: ${p.surface};`,
    `  --color-base-200: ${p.bg};`,
    `  --color-base-300: ${p.border};`,
    `  --color-base-content: ${p.fg};`,
    `  --color-primary: ${p.accent};`,
    `  --color-primary-content: ${p.accentFg};`,
    `  --color-secondary: ${p.fgMuted};`,
    `  --color-secondary-content: ${textOn(p.fgMuted)};`,
    `  --color-accent: ${p.info};`,
    `  --color-accent-content: ${textOn(p.info)};`,
    `  --color-neutral: ${p.fg};`,
    `  --color-neutral-content: ${p.bg};`,
    ...(["info", "success", "warn", "danger"] as const).flatMap((k) => {
      const name = k === "warn" ? "warning" : k === "danger" ? "error" : k;
      return [`  --color-${name}: ${p[k]};`, `  --color-${name}-content: ${textOn(p[k])};`];
    }),
    `  --radius-selector: ${rem(Math.min(spec.radius, 8))};`,
    `  --radius-field: ${rem(spec.radius)};`,
    `  --radius-box: ${rem(Math.round(spec.radius * 1.5))};`,
    `  --size-selector: 0.25rem;`,
    `  --size-field: ${spec.density === "compact" ? "0.21875rem" : spec.density === "spacious" ? "0.28125rem" : "0.25rem"};`,
    `  --border: ${px(spec.border_width)};`,
    `  --depth: ${spec.depth === "soft" || spec.depth === "hard" ? 1 : 0};`,
    `  --noise: 0;`,
    `}`,
  ].join("\n");
  return [
    `/* ${cssComment(spec.name)} — daisyUI 5 themes. Add to your main Tailwind CSS file, after:`,
    ` *   @import "tailwindcss";`,
    ` *   @plugin "daisyui" { themes: false; }`,
    ` * Switch with <html data-theme="app-dark">; the dark theme also follows the system setting. */`,
    `@theme {\n  --font-sans: ${cssFontStack(spec.fonts.body)};\n  --font-display: ${cssFontStack(spec.fonts.display)};\n  --font-mono: ${cssFontStack(spec.fonts.mono)};\n}`,
    theme(spec.light, "light"),
    theme(spec.dark, "dark"),
  ].join("\n\n");
}

function bootstrapTheme(spec: DesignSystemSpec): string {
  const vars = (p: DsPalette, mode: "light" | "dark") => [
    `--bs-body-bg: ${p.bg}; --bs-body-bg-rgb: ${rgbTriple(p.bg)};`,
    `--bs-body-color: ${p.fg}; --bs-body-color-rgb: ${rgbTriple(p.fg)};`,
    `--bs-emphasis-color: ${p.fg};`,
    `--bs-secondary-color: ${p.fgMuted};`,
    `--bs-secondary-bg: ${p.surface2};`,
    `--bs-tertiary-bg: ${p.surface2};`,
    `--bs-border-color: ${p.border};`,
    `--bs-link-color: ${p.accent}; --bs-link-color-rgb: ${rgbTriple(p.accent)};`,
    `--bs-link-hover-color: ${hover(p.accent, mode)}; --bs-link-hover-color-rgb: ${rgbTriple(hover(p.accent, mode))};`,
    `--bs-primary: ${p.accent}; --bs-primary-rgb: ${rgbTriple(p.accent)};`,
    `--bs-success: ${p.success}; --bs-success-rgb: ${rgbTriple(p.success)};`,
    `--bs-warning: ${p.warn}; --bs-warning-rgb: ${rgbTriple(p.warn)};`,
    `--bs-danger: ${p.danger}; --bs-danger-rgb: ${rgbTriple(p.danger)};`,
    `--bs-info: ${p.info}; --bs-info-rgb: ${rgbTriple(p.info)};`,
    `--bs-focus-ring-color: rgba(${rgbTriple(p.accent)}, .35);`,
    `--app-surface: ${p.surface}; --app-accent-fg: ${p.accentFg}; --app-control-border: ${p.borderStrong};`,
  ];
  const ind = (l: string[]) => l.map((x) => `  ${x}`).join("\n");
  return [
    `/* ${cssComment(spec.name)} — Bootstrap 5.3 theme. Load after bootstrap.min.css. Dark: <html data-bs-theme="dark">.`,
    ` * Bootstrap compiles button and focus colours from Sass, so they are re-pointed at the variables below. */`,
    `:root, [data-bs-theme=light] {\n  --bs-border-radius: ${rem(spec.radius)};\n  --bs-border-radius-sm: ${rem(Math.max(0, spec.radius - 2))};\n  --bs-border-radius-lg: ${rem(Math.round(spec.radius * 1.5))};\n  --bs-border-width: ${px(spec.border_width)};\n  --bs-font-sans-serif: ${cssFontStack(spec.fonts.body)};\n  --bs-font-monospace: ${cssFontStack(spec.fonts.mono)};\n  --bs-body-font-family: var(--bs-font-sans-serif);\n${ind(vars(spec.light, "light"))}\n}`,
    `[data-bs-theme=dark] {\n  color-scheme: dark;\n${ind(vars(spec.dark, "dark"))}\n}`,
    `:root, [data-bs-theme=light], [data-bs-theme=dark] {\n${(["primary", "success", "warning", "danger", "info"] as const)
      .map((k) => `  --bs-${k}-bg-subtle: color-mix(in srgb, var(--bs-${k}) 14%, var(--bs-body-bg));\n  --bs-${k}-border-subtle: color-mix(in srgb, var(--bs-${k}) 35%, var(--bs-body-bg));\n  --bs-${k}-text-emphasis: color-mix(in srgb, var(--bs-${k}) 70%, var(--bs-body-color));`)
      .join("\n")}\n  --bs-form-valid-color: var(--bs-success); --bs-form-valid-border-color: var(--bs-success);\n  --bs-form-invalid-color: var(--bs-danger); --bs-form-invalid-border-color: var(--bs-danger);\n}`,
    `.btn-primary {\n  --bs-btn-color: var(--app-accent-fg);\n  --bs-btn-bg: var(--bs-primary);\n  --bs-btn-border-color: var(--bs-primary);\n  --bs-btn-hover-color: var(--app-accent-fg);\n  --bs-btn-hover-bg: color-mix(in srgb, var(--bs-primary) 85%, #000);\n  --bs-btn-hover-border-color: color-mix(in srgb, var(--bs-primary) 85%, #000);\n  --bs-btn-focus-shadow-rgb: var(--bs-primary-rgb);\n  --bs-btn-active-color: var(--app-accent-fg);\n  --bs-btn-active-bg: color-mix(in srgb, var(--bs-primary) 75%, #000);\n  --bs-btn-active-border-color: color-mix(in srgb, var(--bs-primary) 75%, #000);\n  --bs-btn-disabled-color: var(--app-accent-fg);\n  --bs-btn-disabled-bg: var(--bs-primary);\n  --bs-btn-disabled-border-color: var(--bs-primary);\n}`,
    `.btn-outline-primary {\n  --bs-btn-color: var(--bs-primary); --bs-btn-border-color: var(--bs-primary);\n  --bs-btn-hover-color: var(--app-accent-fg); --bs-btn-hover-bg: var(--bs-primary); --bs-btn-hover-border-color: var(--bs-primary);\n  --bs-btn-active-color: var(--app-accent-fg); --bs-btn-active-bg: var(--bs-primary); --bs-btn-active-border-color: var(--bs-primary);\n  --bs-btn-focus-shadow-rgb: var(--bs-primary-rgb);\n}`,
    `.form-control, .form-select { border-color: var(--app-control-border); }\n.form-control:focus, .form-select:focus, .form-check-input:focus { border-color: var(--bs-primary); box-shadow: 0 0 0 .25rem var(--bs-focus-ring-color); }\n.form-check-input:checked { background-color: var(--bs-primary); border-color: var(--bs-primary); }`,
    `.card { --bs-card-bg: var(--app-surface); }\n.modal { --bs-modal-bg: var(--app-surface); }\n.dropdown-menu { --bs-dropdown-bg: var(--app-surface); --bs-dropdown-link-active-bg: var(--bs-primary); --bs-dropdown-link-active-color: var(--app-accent-fg); }\n.nav-pills { --bs-nav-pills-link-active-bg: var(--bs-primary); --bs-nav-pills-link-active-color: var(--app-accent-fg); }`,
    `h1, h2, h3, h4, h5, h6, .h1, .h2, .h3, .h4, .h5, .h6 { font-family: ${cssFontStack(spec.fonts.display)}; }`,
  ].join("\n\n");
}

function muiTheme(spec: DesignSystemSpec): string {
  const s = jsString;
  const palette = (p: DsPalette) => `{
        primary: { main: ${s(p.accent)}, contrastText: ${s(p.accentFg)} },
        secondary: { main: ${s(p.fgMuted)}, contrastText: ${s(textOn(p.fgMuted))} },
        error: { main: ${s(p.danger)} },
        warning: { main: ${s(p.warn)} },
        info: { main: ${s(p.info)} },
        success: { main: ${s(p.success)} },
        background: { default: ${s(p.bg)}, paper: ${s(p.surface)} },
        text: { primary: ${s(p.fg)}, secondary: ${s(p.fgMuted)} },
        divider: ${s(p.border)},
      }`;
  const display = jsString(spec.fonts.display);
  return `// ${lineComment(spec.name)} — MUI (Material UI v9) theme. Use with <ThemeProvider theme={theme}><CssBaseline />…
// Toggle light/dark with useColorScheme() from '@mui/material/styles'.
import { createTheme } from '@mui/material/styles';

const display = { fontFamily: ${display} };

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: ${palette(spec.light)},
    },
    dark: {
      palette: ${palette(spec.dark)},
    },
  },
  shape: { borderRadius: ${spec.radius} },
  typography: {
    fontFamily: ${JSON.stringify(spec.fonts.body)},
    h1: display, h2: display, h3: display, h4: display, h5: display, h6: display,
  },
});
`;
}

function materialTokens(spec: DesignSystemSpec): string {
  const block = (p: DsPalette, mode: "light" | "dark") => {
    const container = (c: string) => mix(c, p.bg, mode === "light" ? 0.82 : 0.7);
    return [
      `--md-sys-color-primary: ${p.accent};`,
      `--md-sys-color-on-primary: ${p.accentFg};`,
      `--md-sys-color-primary-container: ${container(p.accent)};`,
      `--md-sys-color-on-primary-container: ${p.fg};`,
      `--md-sys-color-secondary: ${p.fgMuted};`,
      `--md-sys-color-on-secondary: ${textOn(p.fgMuted)};`,
      `--md-sys-color-secondary-container: ${p.surface2};`,
      `--md-sys-color-on-secondary-container: ${p.fg};`,
      `--md-sys-color-tertiary: ${p.info};`,
      `--md-sys-color-on-tertiary: ${textOn(p.info)};`,
      `--md-sys-color-tertiary-container: ${container(p.info)};`,
      `--md-sys-color-on-tertiary-container: ${p.fg};`,
      `--md-sys-color-error: ${p.danger};`,
      `--md-sys-color-on-error: ${textOn(p.danger)};`,
      `--md-sys-color-error-container: ${container(p.danger)};`,
      `--md-sys-color-on-error-container: ${p.fg};`,
      `--md-sys-color-background: ${p.bg};`,
      `--md-sys-color-on-background: ${p.fg};`,
      `--md-sys-color-surface: ${p.bg};`,
      `--md-sys-color-surface-container-lowest: ${mode === "light" ? p.surface : mix(p.bg, "#000000", 0.3)};`,
      `--md-sys-color-surface-container-low: ${p.surface};`,
      `--md-sys-color-surface-container: ${p.surface2};`,
      `--md-sys-color-surface-container-high: ${mix(p.surface2, p.border, 0.5)};`,
      `--md-sys-color-surface-container-highest: ${p.border};`,
      `--md-sys-color-on-surface: ${p.fg};`,
      `--md-sys-color-on-surface-variant: ${p.fgMuted};`,
      `--md-sys-color-outline: ${p.borderStrong};`,
      `--md-sys-color-outline-variant: ${p.border};`,
      `--app-color-success: ${p.success}; --app-color-warning: ${p.warn}; --app-color-info: ${p.info};`,
    ];
  };
  const ind = (l: string[]) => l.map((x) => `  ${x}`).join("\n");
  const r = spec.radius;
  return [
    `/* ${cssComment(spec.name)} — Material 3 system tokens (for @material/web, Angular Material or hand-built Material UI).`,
    ` * Material 3 has no success/warning/info roles: those are the --app-color-* additions. */`,
    `:root, .light {\n  color-scheme: light;\n${ind(block(spec.light, "light"))}\n}`,
    `.dark {\n  color-scheme: dark;\n${ind(block(spec.dark, "dark"))}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not(.light) {\n${ind(block(spec.dark, "dark")).replace(/^/gm, "  ")}\n  }\n}`,
    `:root {\n  --md-ref-typeface-brand: ${cssFontStack(spec.fonts.display)};\n  --md-ref-typeface-plain: ${cssFontStack(spec.fonts.body)};\n  --app-font-mono: ${cssFontStack(spec.fonts.mono)};\n  --md-sys-shape-corner-none: 0px;\n  --md-sys-shape-corner-extra-small: ${px(Math.round(r / 2))};\n  --md-sys-shape-corner-small: ${px(r)};\n  --md-sys-shape-corner-medium: ${px(Math.round(r * 1.5))};\n  --md-sys-shape-corner-large: ${px(r * 2)};\n  --md-sys-shape-corner-extra-large: ${px(Math.round(r * 3.5))};\n  --md-sys-shape-corner-full: 9999px;\n}`,
  ].join("\n\n");
}

function antdTheme(spec: DesignSystemSpec): string {
  const s = jsString;
  const token = (p: DsPalette) => `{
    ...shared,
    colorPrimary: ${s(p.accent)}, colorLink: ${s(p.accent)},
    colorSuccess: ${s(p.success)}, colorWarning: ${s(p.warn)}, colorError: ${s(p.danger)}, colorInfo: ${s(p.info)},
    colorBgBase: ${s(p.bg)}, colorTextBase: ${s(p.fg)},
    colorBgLayout: ${s(p.bg)},
    colorBgContainer: ${s(p.surface)},
    colorFillTertiary: ${s(p.surface2)},
    colorBorder: ${s(p.borderStrong)},
    colorBorderSecondary: ${s(p.border)},
    colorTextSecondary: ${s(p.fgMuted)},
    controlOutline: ${s(`rgba(${rgbTriple(p.accent)}, 0.35)`)},
  }`;
  return `// ${lineComment(spec.name)} — Ant Design v6 theme. <ConfigProvider theme={isDark ? darkTheme : lightTheme}><App>…</App></ConfigProvider>
// Ant Design has no display-font token: headings get ${lineComment(firstFamily(spec.fonts.display))} through CSS.
import { theme, type ThemeConfig } from 'antd';

const shared = {
  borderRadius: ${spec.radius},
  fontFamily: ${JSON.stringify(spec.fonts.body)},
  fontFamilyCode: ${JSON.stringify(spec.fonts.mono)},
};

export const lightTheme: ThemeConfig = {
  algorithm: ${spec.density === "compact" ? "[theme.defaultAlgorithm, theme.compactAlgorithm]" : "theme.defaultAlgorithm"},
  token: ${token(spec.light)},
};

export const darkTheme: ThemeConfig = {
  algorithm: ${spec.density === "compact" ? "[theme.darkAlgorithm, theme.compactAlgorithm]" : "theme.darkAlgorithm"},
  token: ${token(spec.dark)},
};
`;
}

function flowbiteTheme(spec: DesignSystemSpec): string {
  const vars = (p: DsPalette, mode: "light" | "dark") => {
    const soft = (c: string, a: number) => mix(c, p.bg, a);
    return [
      `--color-heading: ${p.fg};`,
      `--color-body: ${p.fgMuted};`,
      `--color-body-subtle: ${p.fgMuted};`,
      `--color-neutral-primary: ${p.bg};`,
      `--color-neutral-primary-soft: ${p.surface};`,
      `--color-neutral-primary-medium: ${p.surface};`,
      `--color-neutral-secondary-medium: ${p.surface2};`,
      `--color-neutral-tertiary: ${p.surface2};`,
      `--color-neutral-tertiary-medium: ${p.border};`,
      `--color-default: ${p.border};`,
      `--color-default-medium: ${p.border};`,
      `--color-default-strong: ${p.borderStrong};`,
      `--color-brand: ${p.accent};`,
      `--color-brand-strong: ${hover(p.accent, mode)};`,
      `--color-brand-medium: ${soft(p.accent, 0.6)};`,
      `--color-brand-soft: ${soft(p.accent, 0.82)};`,
      `--color-brand-softer: ${soft(p.accent, 0.9)};`,
      `--color-brand-subtle: ${soft(p.accent, 0.6)};`,
      `--color-fg-brand: ${p.accent};`,
      `--color-fg-brand-strong: ${hover(p.accent, mode)};`,
      ...(["success", "warn", "danger"] as const).flatMap((k) => {
        const name = k === "warn" ? "warning" : k;
        return [`--color-${name}: ${p[k]};`, `--color-${name}-strong: ${hover(p[k], mode)};`, `--color-${name}-soft: ${soft(p[k], 0.88)};`, `--color-fg-${name}: ${p[k]};`];
      }),
      `--color-info: ${p.info}; /* addition: Flowbite has no info role */`,
      `--color-fg-info: ${p.info};`,
    ];
  };
  const ind = (l: string[]) => l.map((x) => `  ${x}`).join("\n");
  return [
    `/* ${cssComment(spec.name)} — Flowbite (Tailwind v4) theme. In your main CSS file:`,
    ` *   @import "tailwindcss"; @import "flowbite/src/themes/default"; @plugin "flowbite/plugin";`,
    ` *   @source "../node_modules/flowbite"; @custom-variant dark (&:where(.dark, .dark *));`,
    ` * then paste the blocks below. Text on brand buttons is text-white in Flowbite's markup —`,
    ` * use text-[var(--app-brand-fg)] where the accent is light. */`,
    `@theme {\n  --font-sans: ${cssFontStack(spec.fonts.body)};\n  --font-body: ${cssFontStack(spec.fonts.body)};\n  --font-mono: ${cssFontStack(spec.fonts.mono)};\n  --font-display: ${cssFontStack(spec.fonts.display)};\n  --radius: ${px(spec.radius)};\n  --radius-base: ${px(spec.radius)};\n  --app-brand-fg: ${spec.light.accentFg};\n${ind(vars(spec.light, "light"))}\n}`,
    `.dark {\n  --app-brand-fg: ${spec.dark.accentFg};\n${ind(vars(spec.dark, "dark"))}\n}`,
  ].join("\n\n");
}

function picoTheme(spec: DesignSystemSpec): string {
  const vars = (p: DsPalette, mode: "light" | "dark") => [
    `--pico-background-color: ${p.bg};`,
    `--pico-color: ${p.fg};`,
    `--pico-h1-color: ${p.fg}; --pico-h2-color: ${p.fg}; --pico-h3-color: ${p.fg};`,
    `--pico-muted-color: ${p.fgMuted};`,
    `--pico-muted-border-color: ${p.border};`,
    `--pico-primary: ${p.accent};`,
    `--pico-primary-background: ${p.accent};`,
    `--pico-primary-border: var(--pico-primary-background);`,
    `--pico-primary-underline: rgba(${rgbTriple(p.accent)}, 0.5);`,
    `--pico-primary-hover: ${hover(p.accent, mode)};`,
    `--pico-primary-hover-background: ${hover(p.accent, mode)};`,
    `--pico-primary-hover-border: var(--pico-primary-hover-background);`,
    `--pico-primary-focus: rgba(${rgbTriple(p.accent)}, 0.4);`,
    `--pico-primary-inverse: ${p.accentFg};`,
    `--pico-card-background-color: ${p.surface};`,
    `--pico-card-border-color: ${p.border};`,
    `--pico-card-sectioning-background-color: ${p.surface2};`,
    `--pico-code-background-color: ${p.surface2};`,
    `--pico-form-element-background-color: ${p.surface};`,
    `--pico-form-element-border-color: ${p.borderStrong};`,
    `--pico-form-element-focus-color: var(--pico-primary-border);`,
    `--pico-form-element-valid-border-color: ${p.success};`,
    `--pico-form-element-invalid-border-color: ${p.danger};`,
    `--pico-ins-color: ${p.success};`,
    `--pico-del-color: ${p.danger};`,
    `--pico-table-border-color: var(--pico-muted-border-color);`,
    `--pico-dropdown-background-color: ${p.surface};`,
  ];
  const ind = (l: string[], n = 2) => l.map((x) => `${" ".repeat(n)}${x}`).join("\n");
  return [
    `/* ${cssComment(spec.name)} — Pico CSS v2 theme. Load after pico.min.css. Dark: data-theme="dark" or the system setting.`,
    ` * Pico has no warning/info colours, badges, alerts or tabs: style those from docs/design-system/tokens.css. */`,
    `:root {\n  --pico-font-family-sans-serif: ${cssFontStack(spec.fonts.body)}, var(--pico-font-family-emoji);\n  --pico-font-family-monospace: ${cssFontStack(spec.fonts.mono)}, var(--pico-font-family-emoji);\n  --pico-font-family: var(--pico-font-family-sans-serif);\n  --pico-border-radius: ${rem(spec.radius)};\n}`,
    `h1, h2, h3, h4, h5, h6 { --pico-font-family: ${cssFontStack(spec.fonts.display)}; }`,
    `[data-theme=light],\n:root:not([data-theme=dark]),\n:host(:not([data-theme=dark])) {\n${ind(vars(spec.light, "light"))}\n}`,
    `@media only screen and (prefers-color-scheme: dark) {\n  :root:not([data-theme]),\n  :host(:not([data-theme])) {\n${ind(vars(spec.dark, "dark"), 4)}\n  }\n}`,
    `[data-theme=dark] {\n${ind(vars(spec.dark, "dark"))}\n}`,
  ].join("\n\n");
}

/**
 * React Native Paper: an MD3 theme per mode. Roles map as in materialTokens;
 * Paper multiplies roundness per component, so the spec's radius becomes its
 * unit. The body font is the first family of the stack (load it with
 * expo-font or link it natively).
 */
function reactNativePaperTheme(spec: DesignSystemSpec): string {
  const s = (v: string) => JSON.stringify(v);
  const colors = (p: DsPalette, mode: "light" | "dark") => {
    const container = (c: string) => mix(c, p.bg, mode === "light" ? 0.82 : 0.7);
    return `{
    ...MD3${mode === "light" ? "Light" : "Dark"}Theme.colors,
    primary: ${s(p.accent)},
    onPrimary: ${s(p.accentFg)},
    primaryContainer: ${s(container(p.accent))},
    onPrimaryContainer: ${s(textOn(container(p.accent)))},
    secondary: ${s(p.fgMuted)},
    onSecondary: ${s(textOn(p.fgMuted))},
    secondaryContainer: ${s(container(p.accent))},
    onSecondaryContainer: ${s(textOn(container(p.accent)))},
    background: ${s(p.bg)},
    onBackground: ${s(p.fg)},
    surface: ${s(p.surface)},
    onSurface: ${s(p.fg)},
    surfaceVariant: ${s(p.surface2)},
    onSurfaceVariant: ${s(p.fgMuted)},
    outline: ${s(p.borderStrong)},
    outlineVariant: ${s(p.border)},
    error: ${s(p.danger)},
    onError: ${s(textOn(p.danger))},
    errorContainer: ${s(container(p.danger))},
    onErrorContainer: ${s(textOn(container(p.danger)))},
  }`;
  };
  const body = firstFamily(spec.fonts.body);
  return `// ${lineComment(spec.name)} — React Native Paper (Material 3) themes.
// <PaperProvider theme={colorScheme === 'dark' ? darkTheme : lightTheme}> … </PaperProvider>
import { MD3DarkTheme, MD3LightTheme, configureFonts, type MD3Theme } from 'react-native-paper';

const fonts = configureFonts({ config: { fontFamily: ${s(body)} } });

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: ${Math.max(1, Math.round(spec.radius / 3))},
  fonts,
  colors: ${colors(spec.light, "light")},
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  roundness: ${Math.max(1, Math.round(spec.radius / 3))},
  fonts,
  colors: ${colors(spec.dark, "dark")},
};
`;
}

/** Header comments are built line by line; keep them in one block. */
const tidy = (files: DesignSystemFile[]) => files.map((f) => ({ ...f, content: f.content.replace(/\n\n( \*)/g, "\n$1") }));

/** The library's own theme file(s). */
export function libraryThemeFiles(spec: DesignSystemSpec): DesignSystemFile[] {
  return tidy(themeFiles(spec));
}

function themeFiles(spec: DesignSystemSpec): DesignSystemFile[] {
  const d = DESIGN_SYSTEM_DIR;
  switch (spec.component_library) {
    case "shadcn":
      return [{ path: `${d}/shadcn-theme.css`, content: shadcnTheme(spec), description: "shadcn/ui variables (:root, .dark) — merge into the CSS file shadcn init created" }];
    case "daisyui":
      return [{ path: `${d}/daisyui-theme.css`, content: daisyTheme(spec), description: "daisyUI 5 light and dark themes" }];
    case "bootstrap":
      return [{ path: `${d}/bootstrap-theme.css`, content: bootstrapTheme(spec), description: "Bootstrap 5.3 overrides — load after bootstrap.min.css" }];
    case "material":
      return [
        { path: `${d}/mui-theme.ts`, content: muiTheme(spec), description: "MUI v9 createTheme (React)" },
        { path: `${d}/material-tokens.css`, content: materialTokens(spec), description: "Material 3 system tokens (non-React stacks)" },
      ];
    case "react-native-paper":
      return [{ path: `${d}/react-native-paper-theme.ts`, content: reactNativePaperTheme(spec), description: "React Native Paper MD3 light and dark themes" }];
    case "antd":
      return [{ path: `${d}/antd-theme.ts`, content: antdTheme(spec), description: "Ant Design v6 light and dark ThemeConfig" }];
    case "flowbite":
      return [{ path: `${d}/flowbite-theme.css`, content: flowbiteTheme(spec), description: "Flowbite (Tailwind v4) theme variables" }];
    case "pico":
      return [{ path: `${d}/pico-theme.css`, content: picoTheme(spec), description: "Pico CSS v2 variables — load after pico.min.css" }];
    default:
      return [];
  }
}

/** DESIGN.md: the guide a coding agent reads before building any screen (open-design structure). */
export function designMarkdown(spec: DesignSystemSpec, version?: number): string {
  return designMarkdownOd(spec, { version, themeFiles: libraryThemeFiles(spec) });
}

type PackageFile = DsPackage["files"][number] & { description: string };

/**
 * The open-design package — USAGE.md, DESIGN.md, tokens.css (the 56-token
 * contract), design-tokens.json and the craft references — exactly as
 * written to the repository and shown as "what the agent gets".
 */
function packageFiles(spec: DesignSystemSpec, version?: number, craft: readonly string[] = DEFAULT_CRAFT): PackageFile[] {
  const d = DESIGN_SYSTEM_DIR;
  const themeFiles = libraryThemeFiles(spec);
  const crafts = craftFor(craft);
  return [
    { path: `${d}/USAGE.md`, role: "usage", content: usageMarkdown(spec, { themeFiles, craft: crafts.map((c) => c.slug) }), description: "Read first: the order to read the package in, highlights, do and avoid" },
    { path: `${d}/DESIGN.md`, role: "design", content: designMarkdown(spec, version), description: "Guide for the coding agent: theme, colour roles, type, components, layout, do and don't, prompt guide" },
    { path: `${d}/tokens.css`, role: "tokens", content: `${odTokensCss(spec)}\n`, description: "The token contract (56 tokens + extensions), light and dark" },
    { path: `${d}/design-tokens.json`, role: "design-tokens", content: `${dtcg(spec)}\n`, description: "W3C Design Tokens (DTCG) JSON" },
    ...crafts.map((c) => ({ path: `${d}/craft/${c.slug}.md`, role: "craft" as const, content: c.content, description: `Craft rules: ${c.slug} (open-design, Apache-2.0)` })),
  ];
}

/** The package for the "what the agent gets" view and the UI-reference generator. */
export function designSystemPackage(spec: DesignSystemSpec, version?: number): DsPackage {
  return { files: packageFiles(spec, version).map(({ path, role, content }) => ({ path, role, content })) };
}

/** The package as open-design prompt blocks (USAGE, DESIGN.md, tokens to paste, craft) — for the UI-reference generator. */
export function designSystemPromptBlocks(spec: DesignSystemSpec, craft: readonly string[] = DEFAULT_CRAFT): string {
  const files = packageFiles(spec, undefined, []);
  const pick = (role: string) => files.find((f) => f.role === role)!.content;
  return odPromptBlocks(spec, { usage: pick("usage"), design: pick("design"), tokens: pick("tokens") }, [...craft]);
}

/** Every file for the approved design system. */
export function designSystemFiles(spec: DesignSystemSpec, version?: number): DesignSystemFile[] {
  const d = DESIGN_SYSTEM_DIR;
  return [
    ...packageFiles(spec, version).map(({ path, content, description }) => ({ path, content, description })),
    { path: `${d}/tailwind-theme.css`, content: `${tailwindTheme(spec)}\n`, description: "Tailwind CSS v4 @theme mapping" },
    ...libraryThemeFiles(spec),
    { path: `${d}/preview-light.html`, content: previewHtml(spec, "light"), description: "Component preview, light" },
    { path: `${d}/preview-dark.html`, content: previewHtml(spec, "dark"), description: "Component preview, dark" },
  ];
}
