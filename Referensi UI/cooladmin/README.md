# CoolAdmin - Modern Bootstrap 5 Admin Dashboard Template

![CoolAdmin Dashboard](screenshots/cooladmin-bootstrap-dashboard-2.png)

[![Version](https://img.shields.io/badge/version-3.4.0-4272d7?style=flat-square)](CHANGELOG.md)
[![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3.8-7952b3?style=flat-square&logo=bootstrap)](https://getbootstrap.com/)
[![Chart.js](https://img.shields.io/badge/Chart.js-4.5.1-ff6384?style=flat-square&logo=chart.js)](https://www.chartjs.org/)
[![FontAwesome](https://img.shields.io/badge/FontAwesome-7.3.1-339af0?style=flat-square&logo=fontawesome)](https://fontawesome.com/)
[![FullCalendar](https://img.shields.io/badge/FullCalendar-7.0.2-2c3e50?style=flat-square)](https://fullcalendar.io/)
[![Vanilla JS](https://img.shields.io/badge/JavaScript-Vanilla-f7df1e?style=flat-square&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](https://opensource.org/licenses/MIT)

**CoolAdmin** is a modern, responsive, and feature-rich admin dashboard template built with **Bootstrap 5.3.8** and **vanilla JavaScript** — no jQuery, and no build step required to use it. 35 pages ship as ready-to-open HTML, with a Pug + SCSS + Vite source pipeline available for contributors who want to edit shared partials once instead of 35 times.

Every dependency is on its current release with zero outstanding security advisories. See [what's new in v3.4.0](#whats-new-in-v340-august-2026) below, or [CHANGELOG.md](CHANGELOG.md) for the full history.

## What's New in v3.4.0 (August 2026)

### Dependency refresh — everything on latest, zero security alerts

Every npm and vendored dependency is now on its current release, and `npm audit` reports **0 vulnerabilities**.

- **All 8 open security advisories resolved** — `shell-quote` (critical), `immutable` ×2, `postcss`, `vite` (high), `launch-editor` (moderate), `esbuild` (low). Every one lived in a build-time `devDependency`, so no shipped template file was ever affected. `launch-editor` and `esbuild` left the dependency tree entirely when Vite 8 swapped esbuild for Rolldown.
- **Build toolchain:** Vite 7 → **8.2.0**, concurrently 9 → **10.0.4**, chokidar 4 → **5.0.0**, sass → **1.102.0**. Three majors, no config changes required. Sass output is byte-identical to the previous build.
- **FullCalendar 6.1.20 → 7.0.2** — a real migration, not a bump. v7 generates hashed internal class names, so the old `.fc-*` overrides were replaced with the theme's public `--fc-classic-*` custom properties mapped to CoolAdmin's design tokens. The calendar now follows the accent-preset switcher automatically, and dark-mode tokens come included. No `temporal-polyfill` needed — the global bundle ships its own Temporal shim.
- **Font Awesome 7.2.0 → 7.3.1**, **css-hamburgers → 1.2.1**. Bootstrap 5.3.8, Chart.js 4.5.1, and Leaflet 1.9.4 were already current.

### Fixed

- **A blank icon on `card.html`** — `fa-presentation-screen` is a Font Awesome *Pro* icon that was never in the Free package, so it had been rendering as an empty glyph. Now `fa-display`.
- **Dangling sourcemap references** in three vendored minified files pointed at `.map` files that were never shipped, producing 404s in browser devtools.
- **A leftover `console.log`** in the calendar's event-click handler, replaced with a toast so the interaction is actually visible.

All 35 pages were verified in headless Chromium with 0 console errors and 0 failed requests; the calendar was additionally exercised across month, week, day, and list views.

## Previous releases

Full detail for every release is in **[CHANGELOG.md](CHANGELOG.md)**.

- **v3.3.0** (May 2026) — Renamed the year-flavoured `theme-2026` overlay to `app` (`css/app.css`, `body.app`) so the convention doesn't age. No visual change.
- **v3.2.0** (May 2026) — Introduced the **Pug + SCSS + Vite source pipeline**. The sidebar nav lives in one file (`src/pug/partials/_nav-data.pug`) and propagates to every page; SCSS is split into 56 partials. All 35 pages are now generated from Pug source, while built HTML and CSS still ship in the repo root so end users need no toolchain. Addresses [issue #35](https://github.com/puikinsh/CoolAdmin/issues/35).
- **v3.1.0** (May 2026) — The modern application shell: design overlay, Cmd+K command palette, 6-preset theme switcher, toast system, loading skeletons, interactive inbox, and 11 new pages (kanban, profile, pricing, invoice, data table, wizard, docs, notifications, 404/500/maintenance).
- **v3.0.0** (May 2026) — Audit pass. Cut ~260 KB of JS per page by dropping unused libraries, consolidated to a single icon font, added accessibility landmarks and per-page SEO metadata, introduced design tokens, and swept 718 obsolete vendor prefixes.

## Live Demo

**[preview.colorlib.com/theme/cooladmin/](https://preview.colorlib.com/theme/cooladmin/)** — full template hosted on Cloudflare R2.

Direct links to each dashboard variant:

- [Dashboard 1 — Overview](https://preview.colorlib.com/theme/cooladmin/index.html)
- [Dashboard 2 — Sales pipeline](https://preview.colorlib.com/theme/cooladmin/index2.html)
- [Dashboard 3 — Marketing analytics](https://preview.colorlib.com/theme/cooladmin/index3.html)
- [Dashboard 4 — Projects](https://preview.colorlib.com/theme/cooladmin/index4.html)

## Preview

### Dashboard Variations

Each thumbnail links to its live demo on Cloudflare R2.

| [Dashboard 1 — Overview](https://preview.colorlib.com/theme/cooladmin/index.html) | [Dashboard 2 — Sales pipeline](https://preview.colorlib.com/theme/cooladmin/index2.html) | [Dashboard 3 — Marketing analytics](https://preview.colorlib.com/theme/cooladmin/index3.html) | [Dashboard 4 — Projects](https://preview.colorlib.com/theme/cooladmin/index4.html) |
|---|---|---|---|
| [![Dashboard 1 — Overview](screenshots/cooladmin-bootstrap-dashboard-1.png)](https://preview.colorlib.com/theme/cooladmin/index.html) | [![Dashboard 2 — Sales pipeline](screenshots/cooladmin-bootstrap-dashboard-2.png)](https://preview.colorlib.com/theme/cooladmin/index2.html) | [![Dashboard 3 — Marketing analytics](screenshots/cooladmin-bootstrap-dashboard-3.png)](https://preview.colorlib.com/theme/cooladmin/index3.html) | [![Dashboard 4 — Projects](screenshots/cooladmin-bootstrap-dashboard-4.png)](https://preview.colorlib.com/theme/cooladmin/index4.html) |

### UI Components & Pages
- **Interactive Charts** - Line, Bar, Doughnut, and Real-time charts
- **Data Tables** - Responsive tables with horizontal scroll indicators
- **Modern Forms** - Bootstrap 5 native form components
- **Advanced Calendar** - FullCalendar v6+ integration
- **UI Elements** - Cards, Modals, Buttons, Alerts, Progress bars
- **Mobile Optimized** - Perfect experience on all devices

## Key Features

### Modern Architecture
- **Bootstrap 5.3.8** with the latest utilities and components
- **Vanilla JavaScript** - No jQuery dependency for better performance
- **ES6+ Code** - Modern JavaScript patterns and best practices
- **Modular Design** - Easy to customize and extend
- **SEO Optimized** - Clean markup and semantic HTML5

### Advanced Data Visualization
- **Chart.js 4.5.1** - Latest version with enhanced performance
- **6 Pre-built Chart Types** - Line, Bar, Doughnut, Area, and more
- **Responsive Charts** - Perfect display on all screen sizes
- **Real-time Updates** - Dynamic data visualization capabilities
- **Modern Animations** - Smooth transitions and interactions

### Mobile-First Design
- **Responsive Grid System** - Bootstrap 5's improved grid
- **Touch-Friendly Navigation** - Optimized sidebar and menus
- **Mobile Tables** - Horizontal scroll with visual indicators
- **Gesture Support** - Swipe navigation for mobile devices
- **Optimized Performance** - Fast loading on mobile networks

### Beautiful UI Components
- **35 HTML Pages** - Dashboards, apps, components, auth, and error pages
- **50+ UI Elements** - Cards, buttons, forms, tables, modals
- **Modern Design System** - Consistent colors, typography, and spacing
- **Thin Custom Scrollbars** - Subtle 8px scrollbars for better UX
- **Clean Typography** - Readable fonts and proper hierarchy

## Upgrade to a Premium Dashboard

Need advanced features, dedicated support, and production-ready code? Explore our handpicked collection of professional admin templates on [DashboardPack](https://dashboardpack.com/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin).

<table>
  <tr>
    <td align="center" width="50%">
      <a href="https://dashboardpack.com/theme-details/apex-dashboard-nextjs/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin">
        <img src="screenshots/apex.png" alt="Apex Dashboard — Next.js 16 admin template with shadcn/ui" width="100%">
      </a>
      <br>
      <a href="https://dashboardpack.com/theme-details/apex-dashboard-nextjs/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin"><strong>Apex Dashboard</strong></a>
      <br>
      <sub>Next.js 16 + React 19 + Tailwind CSS v4 + shadcn/ui. 5 dashboard variants, 20+ app pages, 125+ routes, full CRUD.</sub>
    </td>
    <td align="center" width="50%">
      <a href="https://dashboardpack.com/theme-details/zenith-shadcn/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin">
        <img src="screenshots/zenith.png" alt="Zenith — ultra-minimal Next.js admin dashboard with shadcn/ui" width="100%">
      </a>
      <br>
      <a href="https://dashboardpack.com/theme-details/zenith-shadcn/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin"><strong>Zenith Dashboard</strong></a>
      <br>
      <sub>Next.js 16 + React 19 + Tailwind CSS v4 + shadcn/ui. Achromatic design, 50+ pages, 6 dashboards, live theme customizer.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <a href="https://dashboardpack.com/theme-details/haze-dashboard-nuxt/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin">
        <img src="screenshots/haze.png" alt="Haze — Nuxt 4 admin dashboard with 92+ pages and 5 dashboards" width="100%">
      </a>
      <br>
      <a href="https://dashboardpack.com/theme-details/haze-dashboard-nuxt/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin"><strong>Haze</strong></a>
      <br>
      <sub>Nuxt 4 + Nuxt UI v4 + Tailwind CSS v4. 92+ pages, 7 layouts, 5 dashboards, RTL, i18n, mock API layer.</sub>
    </td>
    <td align="center" width="50%">
      <a href="https://dashboardpack.com/theme-details/tailpanel/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin">
        <img src="screenshots/tailpanel.png" alt="TailPanel — modern React and Tailwind CSS admin panel" width="100%">
      </a>
      <br>
      <a href="https://dashboardpack.com/theme-details/tailpanel/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin"><strong>TailPanel</strong></a>
      <br>
      <sub>React + TypeScript + Tailwind CSS + Vite. 9 dashboard designs, dark and light themes.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <a href="https://dashboardpack.com/theme-details/admindek-html/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin">
        <img src="screenshots/admindek.png" alt="Admindek — feature-rich Bootstrap 5 dashboard with dark mode" width="100%">
      </a>
      <br>
      <a href="https://dashboardpack.com/theme-details/admindek-html/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin"><strong>Admindek</strong></a>
      <br>
      <sub>Bootstrap 5 + vanilla JS. 100+ components, dark/light modes, RTL support, 10 color presets.</sub>
    </td>
    <td align="center" width="50%">
      <a href="https://dashboardpack.com/theme-details/svelteforge-premium/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin">
        <img src="screenshots/svelteforge.png" alt="SvelteForge Premium — SvelteKit admin dashboard with multi-tenant support" width="100%">
      </a>
      <br>
      <a href="https://dashboardpack.com/theme-details/svelteforge-premium/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin"><strong>SvelteForge Premium</strong></a>
      <br>
      <sub>SvelteKit + Tailwind CSS v4. 30+ wired-up modules, multi-tenant from row zero, dark/light/system mode.</sub>
    </td>
  </tr>
</table>

<p align="center">
  <a href="https://dashboardpack.com/?utm_source=github&utm_medium=readme&utm_campaign=cooladmin"><strong>View All Premium Templates →</strong></a>
</p>

## Technical Specifications

### **Core Technologies**
```json
{
  "version": "3.4.0",
  "bootstrap": "5.3.8",
  "chart.js": "4.5.1",
  "fontawesome": "7.3.1",
  "fullcalendar": "7.0.2",
  "leaflet": "1.9.4",
  "javascript": "ES6+ Vanilla",
  "css": "CSS3 + Custom Properties (authored in SCSS)",
  "html": "HTML5 Semantic Markup (authored in Pug)",
  "build": "Vite 8 + Sass + Pug (optional — built artifacts ship in repo)"
}
```

### **Browser Support**
| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 88+ | Fully Supported |
| Firefox | 78+ | Fully Supported |
| Safari | 14+ | Fully Supported |
| Edge | 88+ | Fully Supported |
| Mobile Safari | iOS 14+ | Fully Supported |
| Chrome Mobile | Android 8+ | Fully Supported |

### Performance Metrics
- **Bundle Size**: 2.4MB (25% reduction from v1.0)
- **Load Time**: ~30% faster than jQuery-based version
- **Mobile Performance**: Optimized for 3G/4G networks
- **Dependencies**: Only 8 core dependencies (reduced from 15+)

## File Structure

```
CoolAdmin/
├── css/                          # Built CSS (regenerated by sass from src/scss/)
│   ├── theme.css                 # Legacy stylesheet (~14k lines, ~207 KB)
│   ├── app.css                # App theme overlay (~7k lines, scoped to body.app)
│   └── font-face.css             # Poppins font-face declarations
├── js/
│   ├── vanilla-utils.js          # jQuery replacement utilities ($, $$, on, addClass, ready…)
│   ├── bootstrap5-init.js        # Initializes tooltips + popovers only
│   ├── main-vanilla.js           # Chart.js configs + sidebar/dropdown UI behaviors
│   └── modern-plugins.js         # Counters, modern progress bars, lightbox
├── vendor/
│   ├── bootstrap-5.3.8.min.css   # Bootstrap 5.3.8
│   ├── bootstrap-5.3.8.bundle.min.js
│   ├── fontawesome-7.3.1/        # Font Awesome 7.3.1 (single icon font)
│   ├── chartjs/                  # Chart.js 4.5.1 UMD bundle
│   ├── fullcalendar-7.0.2/      # FullCalendar 7.0.2
│   └── css-hamburgers/           # Animated hamburger menu icons
├── src/                          # Pug + SCSS sources (contributors only)
│   ├── pug/                      # Layouts, partials, pages — see "Source layout" above
│   └── scss/                     # 56 SCSS partials + two entry files
├── scripts/
│   └── build-pug.js              # Renders src/pug/pages/*.pug → root *.html
├── images/                       # Avatars, logos, UI graphics
├── fonts/poppins/                # Self-hosted Poppins
├── screenshots/                  # README assets
├── *.html (24 pages)             # Built HTML at repo root — clone-and-open ready
│   ├── index.html, index2.html, index3.html, index4.html   # 4 dashboard variants
│   ├── chart.html, table.html, data-table.html             # Data + analytics
│   ├── calendar.html, map.html, kanban.html, inbox.html    # Apps
│   ├── form.html, wizard.html                              # Forms
│   ├── card.html, button.html, modal.html, tab.html,       # UI components
│   │   alert.html, progress-bar.html, badge.html,
│   │   switch.html, grid.html, typo.html, fontawesome.html
│   ├── profile.html, pricing.html, invoice.html,           # Account / commerce
│   │   docs.html, notifications.html
│   ├── login.html, register.html, forget-pass.html         # Auth
│   └── 404.html, 500.html, maintenance.html                # Error / status
├── package.json                  # npm scripts: dev, build, build:pug, build:sass
├── vite.config.js                # Vite dev server config (MPA mode, port 3000)
├── CHANGELOG.md                  # Per-release history
└── README.md                     # This file
```

## Quick Start

CoolAdmin ships **two ways to run it**, depending on whether you want to edit shared partials or just preview the built template.

### As an end user — no Node required

Built HTML and CSS live in the repo root. Clone, serve statically, open in a browser:

```bash
git clone https://github.com/puikinsh/CoolAdmin.git
cd CoolAdmin
python3 -m http.server 8000      # or:  npx serve .
```

Then open `http://localhost:8000/index.html`. Every page (35 in total) works without a toolchain.

### As a contributor — Pug + SCSS + Vite

To edit shared layouts, sidebar nav, or SCSS partials, run the source pipeline:

```bash
npm install                      # one-time
npm run dev                      # starts pug-watch + sass-watch + Vite dev server at :3000
```

`npm run dev` runs three watchers concurrently:

- **Pug** — `node scripts/build-pug.js --watch` recompiles root `*.html` when anything in `src/pug/` changes.
- **Sass** — `sass --watch src/scss/*.scss:css/*.css` recompiles `css/theme.css` and `css/app.css` from `src/scss/` sources.
- **Vite** — dev server with HMR at `http://localhost:3000`, auto-opens `index.html`.

Edit `src/pug/partials/_nav-data.pug` to change the sidebar — the change appears on every page automatically.

For a production rebuild without watchers:

```bash
npm run build                    # one-shot pug + sass build
```

### Source layout

```
src/
├── pug/
│   ├── layouts/
│   │   ├── _default.pug         # sidebar + topbar + main content
│   │   └── _auth.pug            # centered single-column (login, register)
│   ├── partials/
│   │   ├── _head.pug            # +head(meta) mixin — emits <head> from { title, description, noindex }
│   │   ├── _nav-data.pug        # SINGLE SOURCE OF TRUTH for menu items
│   │   ├── sidebar.pug          # desktop sidebar — uses _nav-data
│   │   ├── header-mobile.pug    # mobile header + nav — uses _nav-data
│   │   ├── header-desktop.pug   # topbar (search, dropdowns, account menu)
│   │   ├── footer-scripts.pug   # common <script> stack
│   │   └── content/             # per-page inner HTML, included by page Pug files
│   └── pages/
│       ├── index.pug            # extends _default, sets activePage, blocks
│       ├── login.pug            # extends _auth
│       └── table.pug            # extends _default
├── scss/
│   ├── theme.scss               # entry — @use's 20 legacy partials
│   ├── app.scss              # entry — @use's 36 overlay partials
│   ├── _variables.scss          # design tokens (legacy)
│   ├── _generic.scss            # normalize, scrollbars, typography
│   ├── _elements.scss           # title, links
│   ├── _objects.scss            # section, page-wrapper
│   ├── _utilities.scss          # padding/margin spacing utilities
│   ├── _modern-additions.scss   # lightbox, modern progress, skip-link
│   ├── components/              # _buttons, _form, _header, _sidebar, _cards…
│   └── 2026/                    # 36 partials for the modern overlay
└── scripts/
    └── build-pug.js             # Node script: src/pug/pages/*.pug → root *.html
```

### Adding a new page (Pug workflow)

1. Add the nav entry to `src/pug/partials/_nav-data.pug`.
2. Drop your page content (everything that would go inside `.container-fluid`) into `src/pug/partials/content/your-page.html`.
3. Create `src/pug/pages/your-page.pug`:

   ```pug
   extends ../layouts/_default

   block variables
     - var pageMeta = { title: 'Your page', description: 'Short description' }
     - var activePage = 'your-page.html'

   block content
     include ../partials/content/your-page.html
   ```

4. Run `npm run build:pug` (or leave `npm run dev` running).

## Dashboard Pages

### **Main Dashboards**
1. **index.html** - Primary dashboard with Chart.js v4 widgets
2. **index2.html** - Alternative layout with task management
3. **index3.html** - Third variation with different metrics
4. **index4.html** - Fourth layout with enhanced charts

### **Data & Analytics**
- **table.html** - Responsive data tables with scroll indicators
- **chart.html** - Comprehensive Chart.js v4 showcase
- **calendar.html** - FullCalendar v6+ with modern event handling

### **UI Components**
- **form.html** - Bootstrap 5 form components and validation
- **card.html** - Modern card designs and layouts
- **button.html** - Button variations and states
- **modal.html** - Modal dialogs and overlays
- **tab.html** - Tab navigation and content switching
- **alert.html** - Alert messages and notifications

### **Utilities & Examples**
- **grid.html** - Bootstrap 5 grid system demonstration
- **typo.html** - Typography hierarchy and styles
- **fontawesome.html** - FontAwesome 7.0.1 icon showcase
- **progress-bar.html** - Progress indicators and animations

## Customization Guide

### **Colors & Theming**
The template uses CSS custom properties for easy theming:

```css
:root {
  /* Primary Colors */
  --primary-color: #4272d7;
  --secondary-color: #6c757d;
  --success-color: #28a745;
  --warning-color: #ffc107;
  --danger-color: #dc3545;
  --info-color: #17a2b8;
  
  /* Background Colors */
  --body-bg: #f8f9fa;
  --card-bg: #ffffff;
  --sidebar-bg: #2c3e50;
  
  /* Text Colors */
  --text-primary: #212529;
  --text-secondary: #6c757d;
  --text-muted: #868e96;
}
```

### **Chart Customization**
Charts use Chart.js v4 configuration format:

```javascript
const chartConfig = {
  type: 'line', // line, bar, doughnut, etc.
  data: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [{
      label: 'Revenue',
      data: [12, 19, 3, 5, 2, 3],
      borderColor: '#4272d7',
      backgroundColor: 'rgba(66, 114, 215, 0.1)'
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true },
      tooltip: { enabled: true }
    },
    scales: {
      x: { display: true },
      y: { display: true }
    }
  }
};
```

### **Adding New Components**
The vanilla JavaScript utilities make it easy to add new components:

```javascript
// Using the custom vanilla-utils.js
const element = $('.my-selector');           // querySelector
const elements = $$('.my-selector');         // querySelectorAll
on(element, 'click', handler);               // addEventListener
addClass(element, 'active');                // classList.add
removeClass(element, 'active');             // classList.remove
toggleClass(element, 'active');             // classList.toggle
```

## Mobile Optimization

### **Responsive Features**
- **Mobile-First Grid** - Bootstrap 5's improved responsive grid system
- **Touch Navigation** - Swipe-friendly sidebar and menu interactions
- **Responsive Tables** - Horizontal scroll with visual scroll indicators
- **Optimized Charts** - Touch-friendly Chart.js configurations
- **Mobile Forms** - Native form controls optimized for mobile input

### **Performance Optimizations**
- **Lazy Loading** - Charts and heavy components load when needed
- **Optimized Images** - Compressed assets for faster mobile loading
- **Minimal JavaScript** - Vanilla JS eliminates jQuery overhead
- **Efficient CSS** - Reduced bundle size with modern CSS features

## Modern JavaScript Features

### **Vanilla JavaScript Utilities**
Replace jQuery with modern JavaScript patterns:

```javascript
// Old jQuery way
$('.element').addClass('active').on('click', handler);

// New vanilla way
const element = $('.element');
addClass(element, 'active');
on(element, 'click', handler);

// Modern ES6+ patterns
document.querySelectorAll('.elements').forEach(el => {
  el.addEventListener('click', (e) => {
    e.target.classList.toggle('active');
  });
});
```

### **Chart.js v4 Integration**
Modern chart configuration with improved performance:

```javascript
// Automatic chart initialization
document.addEventListener('DOMContentLoaded', () => {
  const charts = document.querySelectorAll('[data-chart]');
  charts.forEach(canvas => {
    const type = canvas.dataset.chart;
    const config = getChartConfig(type);
    new Chart(canvas, config);
  });
});
```

## Use Cases

### Perfect For
- 📊 **Business Dashboards** - Analytics, KPIs, and reporting
- 🏢 **Admin Panels** - Content management and system administration  
- 📈 **Analytics Platforms** - Data visualization and insights
- 🛍️ **E-commerce Backends** - Order management and inventory
- 💼 **SaaS Applications** - Multi-tenant dashboard interfaces
- 🏥 **Healthcare Systems** - Patient management and medical records
- 🎓 **Educational Platforms** - Learning management systems
- 💰 **Financial Applications** - Trading platforms and portfolio management

### **Industries**
- **Technology & Software** - Tech startups and software companies
- **E-commerce & Retail** - Online stores and marketplace platforms
- **Healthcare** - Medical practices and healthcare technology
- **Finance** - Fintech applications and investment platforms
- **Education** - EdTech platforms and educational institutions
- **Marketing** - Digital agencies and marketing automation tools

## Security Features

### **Modern Security Standards**
- **CSP Ready** - Content Security Policy compatible
- **XSS Protection** - Input sanitization and output encoding
- **HTTPS Friendly** - Secure asset loading and external links
- **Modern Authentication** - Ready for OAuth, JWT, and 2FA integration

### **Best Practices**
- **Secure External Links** - `rel="nofollow" target="_blank"` on external links
- **Form Validation** - Client-side and server-side validation patterns
- **Clean URLs** - SEO-friendly and secure URL structures
- **Error Handling** - Proper error messages without information leakage

## Performance Benefits

### **Before vs After (v1.0 → v2.0)**
| Metric | v1.0 (Bootstrap 4 + jQuery) | v2.0 (Bootstrap 5 + Vanilla) | Improvement |
|--------|------------------------------|------------------------------|-------------|
| Bundle Size | ~3.2MB | ~2.4MB | **25% smaller** |
| Dependencies | 15+ libraries | 8 core libraries | **47% fewer deps** |
| Load Time | ~2.1s | ~1.5s | **30% faster** |
| Mobile Performance | Good | Excellent | **40% better** |
| JavaScript Execution | jQuery overhead | Native performance | **50% faster** |

### Core Web Vitals
- **LCP (Largest Contentful Paint)** - < 2.5s
- **FID (First Input Delay)** - < 100ms  
- **CLS (Cumulative Layout Shift)** - < 0.1

## Migration from v1.0

### **Breaking Changes**
If you're upgrading from the original CoolAdmin template:

1. **Bootstrap Classes** - Update Bootstrap 4 classes to Bootstrap 5
2. **jQuery Code** - Convert to vanilla JavaScript using provided utilities
3. **Chart.js Syntax** - Update to Chart.js v4 configuration format
4. **Form Components** - Update to Bootstrap 5 form classes
5. **Data Attributes** - Change `data-toggle` to `data-bs-toggle`

### **Migration Helper**
```javascript
// jQuery → Vanilla JavaScript conversion examples
// OLD: $('.element').addClass('active');
// NEW: addClass($('.element'), 'active');

// OLD: $(document).ready(function() { ... });
// NEW: ready(() => { ... });

// OLD: $.ajax({ ... });
// NEW: fetch('/api/endpoint').then(response => response.json());
```

## Support & Community

### **Documentation**
- 📚 **Comprehensive README** - This detailed guide
- 📝 **Inline Comments** - Well-documented code throughout
- 🔄 **Migration Guide** - Easy upgrade from older versions
- 📋 **Changelog** - Detailed version history and updates

### **Professional Support**
- 🌐 **Colorlib.com** - Original template creators and support
- 🛠️ **DashboardPack.com** - Premium dashboard templates and themes
- 💬 **Community Forums** - Get help from other developers
- 📧 **Email Support** - Direct support for customization questions

### **Contributing**
We welcome contributions! Please:
1. Fork the repository  
2. Create a feature branch
3. Make your changes
4. Submit a pull request
5. Follow our coding standards

## License

This project is licensed under the **MIT License** - see the [LICENSE.md](LICENSE.md) file for details.

### Commercial Use
- **Allowed** - Use in commercial projects  
- **Modification** - Customize and extend as needed  
- **Distribution** - Include in your applications  
- **Private Use** - Use in proprietary software  

## What's Next?

### Roadmap 2025-2026
- 🌙 **Dark Mode** - Built-in dark theme support
- 🌐 **RTL Support** - Right-to-left language support
- 🎨 **Theme Builder** - Visual theme customization tool
- 📱 **PWA Ready** - Progressive Web App capabilities
- 🔧 **Build Tools** - Webpack/Vite integration for optimization
- 🧪 **TypeScript** - Optional TypeScript definitions
- 🎭 **Component Library** - Standalone component package

### Community Requests
- 📊 **More Chart Types** - Heatmaps, Sankey diagrams, TreeMaps
- 🗃️ **Advanced Tables** - Sorting, filtering, pagination
- 🔔 **Notification System** - Toast notifications and alerts
- 📁 **File Manager** - Drag-and-drop file handling
- 🎯 **Dashboard Builder** - Drag-and-drop dashboard creation

---

## Awards & Recognition

- ⭐ **Most Popular** - Bootstrap admin template on Colorlib.com
- 🚀 **Performance Leader** - Fastest loading admin template in category
- 📱 **Mobile Excellence** - Best mobile experience award 2025
- 🔧 **Developer Choice** - Most developer-friendly admin template

---

## Get in Touch

- 🌐 **Website**: [colorlib.com](https://colorlib.com)
- 🛒 **Marketplace**: [DashboardPack.com](https://dashboardpack.com)
- 🐦 **Twitter**: [@colorlib](https://twitter.com/colorlib)

---

<div align="center">

**Made with ❤️ by [Colorlib](https://colorlib.com)**

v3.4.0 · August 2026 · Bootstrap 5.3.8 · Font Awesome 7.3.1 · Chart.js 4.5.1 · FullCalendar 7.0.2 · Vanilla JavaScript · Pug + SCSS + Vite source pipeline

[⬆ Back to Top](#cooladmin---modern-bootstrap-5-admin-dashboard-template)

</div>
