/** First-public-package exclusions; local vendor copies remain untouched. */
export const EXCLUDED_UI_TEMPLATE_SOURCES = new Set(["preline", "tabler", "tailadmin"]);
export function isExcludedUiTemplatePath(file: string): boolean {
  return file.replace(/\\/g, "/").split("/").some((part) => EXCLUDED_UI_TEMPLATE_SOURCES.has(part.toLowerCase()));
}

/** Curated entry pages, not every component/demo in the reference collection. */
export const UI_TEMPLATES = [
  { id: "adminlte-dashboard", name: "AdminLTE", category: "Dashboard", file: "adminlte/index.html", description: "Dense metrics, tables and sidebar navigation." },
  { id: "coreui-dashboard", name: "CoreUI", category: "Dashboard", file: "coreui/index.html", description: "Structured admin dashboard with widgets." },
  { id: "sneat-dashboard", name: "Sneat", category: "Dashboard", file: "sneat/html/index.html", description: "Light admin panels with spacious cards." },
  { id: "materio-dashboard", name: "Materio", category: "Dashboard", file: "materio/html/index.html", description: "Material-style cards and analytics." },
  { id: "kwd-dashboard", name: "KWD Dashboard", category: "Dashboard", file: "kwd-dashboard/index.html", description: "Compact Tailwind admin workspace." },
  { id: "cooladmin-dashboard", name: "CoolAdmin", category: "Dashboard", file: "cooladmin/index.html", description: "Classic admin analytics and tables." },
  { id: "staradmin-dashboard", name: "Star Admin", category: "Dashboard", file: "staradmin/src/index.html", description: "Business dashboard with charts and activity." },
  { id: "bootstrap-admin", name: "SB Admin 2", category: "Dashboard", file: "startbootstrap/sb-admin-2/index.html", description: "Familiar Bootstrap admin layout." },
  { id: "bulma-admin", name: "Bulma Admin", category: "Dashboard", file: "bulma/templates/admin.html", description: "Simple admin navigation and content panels." },
  { id: "toolbox-admin", name: "Tailwind Toolbox Admin", category: "Dashboard", file: "tailwindtoolbox/admin/index.html", description: "Tailwind metrics and admin navigation." },
  { id: "sneat-login", name: "Sneat Login", category: "Login", file: "sneat/html/auth-login-basic.html", description: "Focused sign-in card without an app sidebar." },
  { id: "materio-login", name: "Materio Login", category: "Login", file: "materio/html/auth-login-basic.html", description: "Compact branded authentication form." },
  { id: "bootstrap-login", name: "SB Admin Login", category: "Login", file: "startbootstrap/sb-admin-2/login.html", description: "Centered authentication with an image panel." },
  { id: "landwind", name: "Landwind", category: "Landing page", file: "landwind/index.html", description: "Product hero, features, pricing and FAQ." },
  { id: "bootstrap-agency", name: "Agency", category: "Landing page", file: "startbootstrap/agency/index.html", description: "Agency services and portfolio sections." },
  { id: "material-kit", name: "Material Kit", category: "Landing page", file: "material-kit/presentation.html", description: "Material presentation and feature sections." },
  { id: "tailgrids-play", name: "TailGrids Play", category: "Landing page", file: "tailgrids-play/index.html", description: "Startup hero and marketing sections." },
  { id: "tailwind-landing", name: "Tailwind Landing", category: "Landing page", file: "tailwind-landing-page/index.html", description: "Simple product landing page." },
  { id: "tailwind-impulse", name: "Impulse", category: "Landing page", file: "tailwindcss-templates/layouts/impulse.html", description: "Image-led editorial landing page." },
  { id: "nordic-store", name: "Nordic Store", category: "Store", file: "tailwindtoolbox/nordic-store/index.html", description: "Minimal retail catalogue with product grids." },
] as const;

export type UiTemplateCategory = (typeof UI_TEMPLATES)[number]["category"] | "Workspace" | "Other";
export interface UiTemplate {
  id: string;
  name: string;
  category: UiTemplateCategory;
  file: string;
  description: string;
  hasPreview?: boolean;
  previewVersion?: number;
}
export const UI_TEMPLATE_CATEGORIES = [...new Set(UI_TEMPLATES.map((t) => t.category))];
