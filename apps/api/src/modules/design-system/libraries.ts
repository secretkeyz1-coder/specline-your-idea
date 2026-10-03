import type { ComponentLibraryInfo, ComponentLibrarySuggestion } from "@sdd/contracts";

/**
 * Component libraries a project can be built with. The design system's tokens
 * are exported into each library's own theme format (exports.ts); here is what
 * the picker shows, how a library matches the locked stack, the component names
 * an agent should use, and a light CSS flavour so styled mockups resemble it.
 */

/** UI roles every mockup and work order talks about. */
export const COMPONENT_ROLES = [
  "button", "input", "select", "checkbox", "card", "table", "badge", "alert", "tabs",
  "dialog", "sheet", "alert_dialog", "menu", "navigation", "breadcrumb", "pagination", "progress", "skeleton", "empty_state", "toast",
  "description_list", "timeline", "stepper", "tree", "stat", "board", "bulk_actions", "chip", "master_detail",
] as const;
export type ComponentRole = (typeof COMPONENT_ROLES)[number];

/** The `ds-*` class each role is drawn with in styled mockups. */
export const MOCKUP_CLASS: Record<ComponentRole, string> = {
  button: ".ds-btn / .ds-btn-primary",
  input: ".ds-input",
  select: ".ds-select",
  checkbox: ".ds-checkbox",
  card: ".ds-card",
  table: ".ds-table",
  badge: ".ds-badge",
  alert: ".ds-alert",
  tabs: ".ds-tabs / .ds-tab",
  dialog: ".ds-modal (in a .ds-stage frame)",
  sheet: ".ds-sheet (in a .ds-stage.ds-stage-sheet frame)",
  alert_dialog: ".ds-alert-dialog (in a .ds-stage frame)",
  menu: ".ds-dropdown > .ds-menu",
  navigation: "app shell (.ds-sidebar, added by the platform)",
  breadcrumb: ".ds-breadcrumb",
  pagination: ".ds-pagination",
  progress: ".ds-progress",
  skeleton: ".ds-skeleton",
  empty_state: ".ds-empty",
  toast: ".ds-toast",
  description_list: ".ds-dl (.ds-dl-rows)",
  timeline: ".ds-timeline",
  stepper: ".ds-steps",
  tree: ".ds-tree",
  stat: ".ds-stat (+ .ds-spark, .ds-trend)",
  board: ".ds-board > .ds-board-col > .ds-board-card",
  bulk_actions: ".ds-bulkbar / .ds-table-toolbar",
  chip: ".ds-chip",
  master_detail: ".ds-master-detail",
};

export interface ComponentLibrary extends ComponentLibraryInfo {
  /** Stack technologies (lower-case substrings) this library is built for. */
  fits: string[];
  /** Setup per framework, shown in DESIGN.md and the work order. */
  install: Array<{ when: string; command: string }>;
  components: Record<ComponentRole, string>;
  /** Extra mockup CSS so styled screens resemble the library's shapes. */
  mockupCss: string;
}

export const COMPONENT_LIBRARIES: ComponentLibrary[] = [
  {
    id: "shadcn",
    name: "shadcn/ui",
    summary: "Copy-in components on Radix/Bits UI/Reka UI primitives, themed with CSS variables and Tailwind.",
    frameworks: ["React / Next.js", "Svelte / SvelteKit (shadcn-svelte)", "Vue / Nuxt (shadcn-vue)"],
    license: "MIT",
    url: "https://ui.shadcn.com",
    fits: ["react", "next", "svelte", "vue", "nuxt", "tailwind", "remix", "astro", "vite"],
    install: [
      { when: "React / Next.js", command: "npx shadcn@latest init" },
      { when: "Svelte / SvelteKit", command: "npx shadcn-svelte@latest init" },
      { when: "Vue / Nuxt", command: "npx shadcn-vue@latest init" },
    ],
    components: { button: "Button", input: "Input", select: "Select", checkbox: "Checkbox", card: "Card", table: "Table", badge: "Badge", alert: "Alert", tabs: "Tabs", dialog: "Dialog", navigation: "Sidebar / NavigationMenu", toast: "Sonner (toast)", sheet: "Sheet", alert_dialog: "AlertDialog", menu: "DropdownMenu", breadcrumb: "Breadcrumb", pagination: "Pagination", progress: "Progress", skeleton: "Skeleton", empty_state: "Empty", description_list: "custom (dl grid)", timeline: "custom (ol + Separator)", stepper: "custom stepper (ol + Badge)", tree: "Collapsible (nested, custom tree)", stat: "Card + Chart (sparkline)", board: "custom (columns of Card)", bulk_actions: "DataTable toolbar (row selection)", chip: "Badge (outline) / Toggle", master_detail: "ResizablePanelGroup" },
    mockupCss: ".ds-app{--ds-sidebar-w:16rem}body,.ds-page{font-size:14px}h1{font-size:24px;font-weight:600;letter-spacing:-.02em}h2{font-size:18px;font-weight:600}h3{font-size:16px;font-weight:600}.ds-btn{min-height:36px;padding:0 16px;font-size:14px;font-weight:500;border-radius:calc(var(--ds-radius) - 2px);border-color:var(--ds-border);box-shadow:0 1px 2px rgba(0,0,0,.05)}.ds-btn-primary,.ds-btn-danger{box-shadow:none}.ds-btn-ghost{box-shadow:none;border-color:transparent}.ds-btn-sm{min-height:32px;padding:0 12px}.ds-btn-icon{width:36px;padding:0}.ds-input,.ds-select,.ds-textarea{min-height:36px;font-size:14px;border-color:var(--ds-border);border-radius:calc(var(--ds-radius) - 2px);box-shadow:0 1px 2px rgba(0,0,0,.05)}.ds-label{font-weight:500;font-size:14px}.ds-card{border-radius:calc(var(--ds-radius) + 4px);padding:24px;box-shadow:0 1px 2px rgba(0,0,0,.05)}.ds-card-title{font-weight:600;line-height:1.2}.ds-table{font-size:14px}.ds-table th{background:transparent;color:var(--ds-fg);font-weight:500;height:40px;padding:0 8px}.ds-table td{padding:8px}.ds-badge{font-size:12px;font-weight:500;padding:2px 8px}.ds-tabs{display:inline-flex;gap:0;padding:3px;border:0;border-radius:var(--ds-radius);background:var(--ds-surface-2)}.ds-tab{margin:0;border:0;border-radius:calc(var(--ds-radius) - 2px);padding:4px 12px;font-weight:500}.ds-tab[aria-selected=\"true\"]{background:var(--ds-surface);border:0;box-shadow:0 1px 2px rgba(0,0,0,.08)}.ds-modal,.ds-alert-dialog{border-radius:var(--ds-radius);padding:24px}.ds-modal h2,.ds-modal h3,.ds-sheet h2,.ds-sheet h3,.ds-alert-dialog h2,.ds-alert-dialog h3{font-size:18px}.ds-side-nav a{min-height:32px;padding:0 8px;font-size:14px}.ds-side-nav a[aria-current]{font-weight:500}.ds-side-label{font-size:12px}.ds-sidebar{font-size:14px}.ds-team:hover,.ds-side-nav a:hover{background:var(--ds-surface-2)}@media(min-width:768px){.ds-app{background:var(--ds-sidebar-bg)}.ds-sidebar{border-right:0}.ds-inset{margin:8px 8px 8px 0;border-radius:12px;overflow:clip;box-shadow:0 0 0 1px var(--ds-border),0 1px 3px rgba(0,0,0,.06)}}",
  },
  {
    id: "daisyui",
    name: "daisyUI",
    summary: "Pure-CSS component classes for Tailwind CSS with named themes. Works in any template language.",
    frameworks: ["Any stack with Tailwind CSS (Blade, Jinja, Django, Rails, SvelteKit, Nuxt, Next.js)"],
    license: "MIT",
    url: "https://daisyui.com",
    fits: ["tailwind", "laravel", "blade", "jinja", "flask", "django", "rails", "htmx", "svelte", "nuxt", "astro", "php"],
    install: [{ when: "Tailwind CSS v4", command: "npm i -D daisyui@latest   # then in your CSS: @plugin \"daisyui\";" }],
    components: { button: "btn / btn-primary", input: "input", select: "select", checkbox: "checkbox", card: "card", table: "table", badge: "badge", alert: "alert", tabs: "tabs / tab", dialog: "modal", navigation: "navbar / menu / drawer", toast: "toast", sheet: "drawer (drawer-end)", alert_dialog: "modal (confirm)", menu: "dropdown + menu", breadcrumb: "breadcrumbs", pagination: "join (pagination)", progress: "progress", skeleton: "skeleton", empty_state: "card with an action (custom)", description_list: "custom (dl)", timeline: "timeline", stepper: "steps", tree: "menu (nested, collapsible)", stat: "stats / stat", board: "custom (columns of card)", bulk_actions: "custom bar (join)", chip: "badge / filter", master_detail: "custom (grid)" },
    mockupCss: ".ds-btn{font-weight:600;min-height:40px;border-radius:var(--ds-radius)}.ds-btn-sm{min-height:32px}.ds-card{border:0;border-radius:calc(var(--ds-radius) * 1.6)}.ds-badge{border-radius:999px}.ds-table th{background:transparent;font-size:.86em}.ds-table tbody tr:nth-child(even){background:var(--ds-surface-2)}.ds-modal,.ds-alert-dialog{border:0;border-radius:calc(var(--ds-radius) * 1.6)}",
  },
  {
    id: "bootstrap",
    name: "Bootstrap",
    summary: "The classic HTML/CSS toolkit with CSS variables and a built-in dark mode. Great for server-rendered apps.",
    frameworks: ["Any server-rendered stack (Flask, Django, Laravel, Rails, Express views)", "Plain HTML"],
    license: "MIT",
    url: "https://getbootstrap.com",
    fits: ["flask", "jinja", "django", "laravel", "blade", "rails", "erb", "express", "ejs", "handlebars", "php", "asp.net", "razor", "spring", "thymeleaf", "go", "htmx"],
    install: [
      { when: "npm", command: "npm i bootstrap@5" },
      { when: "No build step", command: "Download the Bootstrap 5 dist files into your static folder and link them" },
    ],
    components: { button: ".btn .btn-primary", input: ".form-control", select: ".form-select", checkbox: ".form-check-input", card: ".card", table: ".table", badge: ".badge", alert: ".alert", tabs: ".nav-tabs", dialog: ".modal", navigation: ".navbar / .nav", toast: ".toast", sheet: ".offcanvas", alert_dialog: ".modal (confirm)", menu: ".dropdown-menu", breadcrumb: ".breadcrumb", pagination: ".pagination", progress: ".progress", skeleton: ".placeholder", empty_state: "custom", description_list: "dl.row", timeline: "list-group (custom)", stepper: "custom (progress + list)", tree: "list-group + collapse (custom)", stat: "card (custom)", board: "row of card columns (custom)", bulk_actions: "btn-toolbar", chip: "badge rounded-pill", master_detail: "row / col" },
    mockupCss: ".ds-btn{font-weight:400;min-height:38px;border-radius:.375rem}.ds-btn-sm{min-height:31px}.ds-input,.ds-select,.ds-textarea{border-radius:.375rem}.ds-card{border-radius:.375rem;box-shadow:none}.ds-table th{background:transparent;color:var(--ds-fg);font-weight:700;border-bottom-width:2px}.ds-table tbody tr:nth-child(odd){background:var(--ds-surface-2)}.ds-badge{border-radius:.375rem;font-weight:700}.ds-modal,.ds-alert-dialog{border-radius:.5rem}",
  },
  {
    id: "material",
    name: "Material UI (Material 3)",
    summary: "Google's Material Design: MUI for React, Material 3 system tokens for other stacks.",
    frameworks: ["React (MUI)", "Angular (Angular Material)", "Web Components / any (M3 tokens)"],
    license: "MIT (MUI core) · Apache-2.0 (Material 3 tokens)",
    url: "https://mui.com",
    fits: ["react", "next", "angular", "flutter", "android", "kotlin", "compose"],
    install: [
      { when: "React", command: "npm i @mui/material @emotion/react @emotion/styled" },
      { when: "Angular", command: "ng add @angular/material" },
    ],
    components: { button: "Button", input: "TextField", select: "Select", checkbox: "Checkbox", card: "Card", table: "Table", badge: "Chip", alert: "Alert", tabs: "Tabs", dialog: "Dialog", navigation: "AppBar / Drawer / NavigationBar", toast: "Snackbar", sheet: "Drawer (anchor right) / SwipeableDrawer", alert_dialog: "Dialog (confirm)", menu: "Menu", breadcrumb: "Breadcrumbs", pagination: "Pagination / TablePagination", progress: "LinearProgress", skeleton: "Skeleton", empty_state: "custom", description_list: "List + ListItemText", timeline: "Timeline (@mui/lab)", stepper: "Stepper", tree: "SimpleTreeView (MUI X)", stat: "Card + SparkLineChart (MUI X)", board: "custom (Grid of Card)", bulk_actions: "DataGrid toolbar", chip: "Chip", master_detail: "Grid / Drawer" },
    mockupCss: ".ds-btn{border-radius:999px;font-weight:500;letter-spacing:.01em;min-height:40px;padding:0 24px}.ds-input,.ds-select,.ds-textarea{border-radius:4px;min-height:48px}.ds-card{border:0;border-radius:12px}.ds-table th{background:transparent;color:var(--ds-fg);font-weight:500}.ds-badge{border-radius:8px}.ds-modal,.ds-alert-dialog{border:0;border-radius:28px}.ds-sheet{border-radius:16px 0 0 16px}",
  },
  {
    id: "react-native-paper",
    name: "React Native Paper (Material 3)",
    summary: "Material 3 components for React Native and Expo, themed with an MD3 theme object.",
    frameworks: ["React Native", "Expo"],
    license: "MIT",
    url: "https://callstack.github.io/react-native-paper/",
    fits: ["react native", "expo"],
    install: [
      { when: "Expo", command: "npx expo install react-native-paper react-native-safe-area-context" },
      { when: "React Native CLI", command: "npm i react-native-paper react-native-safe-area-context react-native-vector-icons" },
    ],
    components: { button: "Button", input: "TextInput", select: "Menu + TextInput (anchor)", checkbox: "Checkbox.Item", card: "Card", table: "DataTable (tablet) / List.Item (phone)", badge: "Badge / Chip", alert: "Banner", tabs: "SegmentedButtons", dialog: "Portal + Dialog", navigation: "Appbar.Header + BottomNavigation (phone) / a navigation rail (tablet)", toast: "Snackbar", sheet: "Modal as a bottom sheet (or @gorhom/bottom-sheet)", alert_dialog: "Dialog (confirm)", menu: "Menu", breadcrumb: "— (Android apps go back with the app bar)", pagination: "DataTable.Pagination", progress: "ProgressBar", skeleton: "ActivityIndicator / placeholder Views", empty_state: "custom View", description_list: "List.Item (title + description)", timeline: "List.Section (custom)", stepper: "custom (ProgressBar + List)", tree: "List.Accordion", stat: "Card", board: "horizontal ScrollView of Cards", bulk_actions: "Appbar (contextual)", chip: "Chip", master_detail: "a row of two Views on a tablet" },
    mockupCss: ".ds-btn{border-radius:999px;font-weight:500;letter-spacing:.01em;min-height:40px;padding:0 24px}.ds-input,.ds-select,.ds-textarea{border-radius:4px 4px 0 0;min-height:56px}.ds-card{border:0;border-radius:12px}.ds-badge{border-radius:8px}.ds-modal,.ds-alert-dialog{border:0;border-radius:28px}.ds-sheet{border-radius:28px 28px 0 0}.ds-fab{border-radius:16px}",
  },
  {
    id: "antd",
    name: "Ant Design",
    summary: "An enterprise-grade React library with a token theme system. Strong tables, forms and layouts.",
    frameworks: ["React (antd)", "Vue (ant-design-vue, community)"],
    license: "MIT",
    url: "https://ant.design",
    fits: ["react", "next", "umi", "vue", "admin"],
    install: [
      { when: "React", command: "npm i antd" },
      { when: "Vue", command: "npm i ant-design-vue" },
    ],
    components: { button: "Button", input: "Input", select: "Select", checkbox: "Checkbox", card: "Card", table: "Table", badge: "Tag", alert: "Alert", tabs: "Tabs", dialog: "Modal", navigation: "Layout.Sider + Menu", toast: "message / notification", sheet: "Drawer", alert_dialog: "Modal.confirm / Popconfirm", menu: "Dropdown", breadcrumb: "Breadcrumb", pagination: "Pagination", progress: "Progress", skeleton: "Skeleton", empty_state: "Empty", description_list: "Descriptions", timeline: "Timeline", stepper: "Steps", tree: "Tree", stat: "Statistic (+ Tiny chart)", board: "custom (Row/Col of Card)", bulk_actions: "Table rowSelection + actions", chip: "Tag", master_detail: "Splitter / Layout" },
    mockupCss: "body,.ds-page{font-size:14px}.ds-btn{font-weight:400;min-height:32px;border-radius:6px;padding:0 15px}.ds-btn-sm{min-height:24px}.ds-input,.ds-select,.ds-textarea{min-height:32px;border-radius:6px}.ds-card{border-radius:8px;box-shadow:none}.ds-table th{background:var(--ds-surface-2);color:var(--ds-fg);font-weight:600}.ds-badge{border-radius:4px;font-weight:400;border:1px solid var(--ds-border)}.ds-modal,.ds-alert-dialog{border:0;border-radius:8px}",
  },
  {
    id: "flowbite",
    name: "Flowbite",
    summary: "Tailwind CSS components with plain-HTML markup and ports for React, Vue, Svelte and Angular.",
    frameworks: ["Tailwind + HTML", "React", "Vue", "Svelte", "Angular"],
    license: "MIT (open-source components)",
    url: "https://flowbite.com",
    fits: ["tailwind", "laravel", "blade", "django", "flask", "svelte", "vue", "react", "angular", "astro"],
    install: [
      { when: "Tailwind CSS v4", command: "npm i flowbite   # then in your CSS: @plugin \"flowbite/plugin\"; @source \"../node_modules/flowbite\";" },
      { when: "React / Svelte / Vue", command: "npm i flowbite-react  |  flowbite-svelte  |  flowbite-vue" },
    ],
    components: { button: "Button", input: "Input (TextInput)", select: "Select", checkbox: "Checkbox", card: "Card", table: "Table", badge: "Badge", alert: "Alert", tabs: "Tabs", dialog: "Modal", navigation: "Navbar / Sidebar", toast: "Toast", sheet: "Drawer", alert_dialog: "Modal (popup)", menu: "Dropdown", breadcrumb: "Breadcrumb", pagination: "Pagination", progress: "Progress", skeleton: "Skeleton", empty_state: "custom", description_list: "custom (dl)", timeline: "Timeline", stepper: "Stepper", tree: "custom (nested list + Accordion)", stat: "card (custom)", board: "custom (columns of Card)", bulk_actions: "custom bar", chip: "Badge (dismissible)", master_detail: "custom (grid)" },
    mockupCss: ".ds-btn{font-weight:500;border-radius:8px}.ds-input,.ds-select,.ds-textarea{border-radius:8px;background:var(--ds-surface-2)}.ds-card{border-radius:8px}.ds-table th{background:var(--ds-surface-2);font-size:.86em}.ds-badge{border-radius:6px}",
  },
  {
    id: "pico",
    name: "Pico CSS",
    summary: "Classless CSS: semantic HTML looks good on its own. Ideal for small server-rendered apps.",
    frameworks: ["Any stack that renders HTML"],
    license: "MIT",
    url: "https://picocss.com",
    fits: ["flask", "jinja", "django", "go", "htmx", "express", "php", "static", "hugo", "eleventy"],
    install: [{ when: "npm", command: "npm i @picocss/pico" }],
    components: { button: "<button>", input: "<input>", select: "<select>", checkbox: "<input type=\"checkbox\">", card: "<article>", table: "<table>", badge: "<mark> or a small styled <span>", alert: "<article role=\"alert\"> (custom)", tabs: "<nav> with aria-current (custom)", dialog: "<dialog>", navigation: "<nav>", toast: "custom", sheet: "<dialog> (custom side panel)", alert_dialog: "<dialog>", menu: "<details class=\"dropdown\">", breadcrumb: "<nav aria-label=\"breadcrumb\">", pagination: "custom", progress: "<progress>", skeleton: "custom", empty_state: "custom", description_list: "dl", timeline: "custom (ol)", stepper: "custom (ol)", tree: "details / summary (nested)", stat: "article", board: "custom (grid of article)", bulk_actions: "custom (div role=group)", chip: "custom (button.outline)", master_detail: "grid" },
    mockupCss: "body,.ds-page{font-size:16px}.ds-btn{font-weight:500;min-height:44px}.ds-input,.ds-select,.ds-textarea{min-height:48px}.ds-card{border:0;box-shadow:var(--ds-shadow-raised)}",
  },
  {
    id: "none",
    name: "No library (plain CSS)",
    summary: "Build components by hand from the tokens. Choose this for tiny apps or a custom system.",
    frameworks: ["Any"],
    license: "—",
    url: "",
    fits: [],
    install: [],
    components: { button: "button", input: "input", select: "select", checkbox: "input[type=checkbox]", card: "section/article", table: "table", badge: "span", alert: "div[role=alert]", tabs: "custom", dialog: "dialog", navigation: "nav", toast: "custom", sheet: "dialog (side panel)", alert_dialog: "dialog", menu: "details/menu", breadcrumb: "nav", pagination: "nav", progress: "progress", skeleton: "div", empty_state: "section", description_list: "dl", timeline: "ol", stepper: "ol", tree: "ul / details", stat: "section", board: "section columns", bulk_actions: "div", chip: "span / button", master_detail: "div (grid)" },
    mockupCss: "",
  },
];

export function findLibrary(id: string): ComponentLibrary | undefined {
  return COMPONENT_LIBRARIES.find((l) => l.id === id);
}

export function libraryInfo(l: ComponentLibrary): ComponentLibraryInfo {
  return { id: l.id, name: l.name, summary: l.summary, frameworks: l.frameworks, license: l.license, url: l.url, components: l.components };
}

const has = (tech: string, ...keys: string[]) => keys.some((k) => tech.includes(k));

/**
 * Rank the libraries for a locked stack. Deterministic — no AI call — so the
 * suggestion is instant and explainable. A native mobile stack gets its
 * Material 3 library (React Native Paper, or the Material tokens for Flutter
 * and Jetpack Compose) — never a web library, though "React Native" says "react".
 */
export function suggestLibraries(stack: Array<{ category: string; technology: string }>): ComponentLibrarySuggestion[] {
  const tech = stack.map((s) => `${s.category} ${s.technology}`.toLowerCase()).join(" | ");
  const out: ComponentLibrarySuggestion[] = [];
  const add = (id: string, reason: string) => {
    if (!out.some((s) => s.library_id === id)) out.push({ library_id: id, reason });
  };
  const tailwind = has(tech, "tailwind");
  if (has(tech, "react native", "react-native", "expo")) {
    add("react-native-paper", "A React Native app: React Native Paper gives it Material 3 components and takes the tokens as an MD3 theme.");
    add("none", "Or build the components by hand from the tokens.");
    return out;
  }
  if (has(tech, "flutter", "jetpack", "compose", "kotlin")) {
    add("material", "A native Android stack: apply the Material 3 tokens to your Compose MaterialTheme or Flutter ThemeData.");
    add("none", "Or build the components by hand from the tokens.");
    return out;
  }
  if (has(tech, "svelte")) {
    add("shadcn", "shadcn-svelte is the most complete component set for Svelte and is themed with CSS variables.");
    if (tailwind) add("daisyui", "Your stack uses Tailwind; daisyUI adds components with class names only.");
    add("flowbite", "Flowbite has a Svelte port (flowbite-svelte).");
  }
  if (has(tech, "vue", "nuxt")) {
    add("shadcn", "shadcn-vue gives Vue the same components and theming as shadcn/ui.");
    add("antd", "ant-design-vue suits admin-heavy Vue apps.");
    if (tailwind) add("daisyui", "Your stack uses Tailwind; daisyUI adds components with class names only.");
  }
  if (has(tech, "react", "next")) {
    add("shadcn", "shadcn/ui is the default for React + Tailwind and is themed with CSS variables.");
    add("material", "MUI is a complete, well-documented React library if you prefer Material Design.");
    add("antd", "Ant Design suits data-heavy admin screens in React.");
  }
  if (has(tech, "angular")) {
    add("material", "Angular Material is the standard component library for Angular.");
    add("flowbite", "Flowbite has an Angular port and works with Tailwind.");
  }
  if (has(tech, "flask", "jinja", "django", "laravel", "blade", "rails", "erb", "express", "ejs", "handlebars", "php", "thymeleaf", "razor", "htmx", "go ")) {
    if (tailwind) {
      add("daisyui", "Server-rendered templates with Tailwind: daisyUI components are plain class names.");
      add("flowbite", "Flowbite's Tailwind components work straight in server templates.");
    }
    add("bootstrap", "Server-rendered templates: Bootstrap needs no build step and has a dark mode built in.");
    add("pico", "For a small app, Pico CSS styles semantic HTML with almost no classes.");
  }
  if (tailwind) {
    add("daisyui", "Your stack uses Tailwind; daisyUI adds components with class names only.");
    add("flowbite", "Flowbite's components are built on Tailwind.");
  }
  if (out.length === 0) {
    add("bootstrap", "No front-end framework detected: Bootstrap works with plain HTML.");
    add("pico", "Pico CSS styles semantic HTML with almost no classes.");
  }
  add("none", "Or build components by hand from the tokens.");
  return out;
}
