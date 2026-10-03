import { icons } from "lucide";

/**
 * Icons in UI-reference screens. The model writes a placeholder,
 * `<i data-icon="plus"></i>`, with a Lucide name (the icon set shadcn/ui and
 * most product UIs use); the platform draws it as inline SVG, so the mockup
 * stays self-contained under its CSP. The SVG keeps `data-icon`, so a screen
 * sent back to the model is collapsed to placeholders again.
 */

type IconNode = Array<[string, Record<string, string | number>]>;
const ICONS = icons as unknown as Record<string, IconNode>;

/** What an unknown name is drawn as — visibly a stand-in, not a guess. */
const FALLBACK = "circle-dashed";

const pascal = (name: string) =>
  name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");

const attrEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Whether Lucide has an icon of this (kebab-case) name. */
export function isKnownIcon(name: string): boolean {
  return Boolean(ICONS[pascal(name)]);
}

/** One icon as inline SVG; `extra` is a string of attributes to carry (class, data-nid, …). */
export function iconSvg(name: string, extra: { class?: string; attrs?: string } = {}): string {
  const clean = name.trim().toLowerCase();
  const node = ICONS[pascal(clean)] ?? ICONS[pascal(FALLBACK)]!;
  const body = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${attrEsc(String(v))}"`).join(" ")}/>`)
    .join("");
  const cls = ["ds-icon", ...(extra.class ?? "").split(/\s+/).filter((c) => c && c !== "ds-icon")].join(" ");
  return (
    `<svg class="${attrEsc(cls)}" data-icon="${attrEsc(clean)}"${extra.attrs ? ` ${extra.attrs.trim()}` : ""} xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
  );
}

const ICON_TAG = /<i\b([^>]*?)\sdata-icon\s*=\s*["']([^"']*)["']([^>]*?)\/?>(?:\s*<\/i\s*>)?/gi;

/** Split an attribute string into the class and everything else (minus aria-hidden). */
function splitAttrs(attrs: string): { cls: string; rest: string } {
  const cls = /\sclass\s*=\s*"([^"]*)"/i.exec(` ${attrs}`)?.[1] ?? "";
  const rest = ` ${attrs}`
    .replace(/\sclass\s*=\s*"[^"]*"/i, "")
    .replace(/\saria-hidden\s*=\s*"[^"]*"/i, "")
    .replace(/\s*\/$/, "")
    .trim();
  return { cls, rest };
}

/** Draw every `<i data-icon>` placeholder as its SVG; SVGs already drawn are left alone. */
export function expandIcons(html: string): string {
  return html.replace(ICON_TAG, (_m, before: string, name: string, after: string) => {
    const { cls, rest } = splitAttrs(`${before} ${after}`);
    return iconSvg(name, { class: cls, attrs: rest });
  });
}

/** Back to placeholders, for content shown to the model (short, and what it wrote). */
export function collapseIcons(html: string): string {
  return html.replace(/<svg\b([^>]*)\sdata-icon="([^"]*)"([^>]*)>[\s\S]*?<\/svg\s*>/gi, (_m, before: string, name: string, after: string) => {
    const attrs = `${before} ${after}`;
    const cls = (/\sclass="([^"]*)"/i.exec(` ${attrs}`)?.[1] ?? "").split(/\s+/).filter((c) => c && c !== "ds-icon").join(" ");
    const nid = /\sdata-nid="([^"]*)"/i.exec(` ${attrs}`)?.[1];
    return `<i data-icon="${name}"${cls ? ` class="${cls}"` : ""}${nid ? ` data-nid="${nid}"` : ""}></i>`;
  });
}

/** The icon names a screen's content uses that Lucide does not have. */
export function unknownIcons(html: string): string[] {
  return [...new Set([...html.matchAll(/\sdata-icon\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]!.trim().toLowerCase()))].filter((n) => !isKnownIcon(n));
}

/**
 * The icon for a screen in the platform's navigation: by the words of its
 * name (English and Indonesian), else by its type.
 */
const NAV_WORDS: Array<[RegExp, string]> = [
  [/dashboard|dasbor|overview|ringkasan|beranda|home/, "layout-dashboard"],
  [/gantt|timeline|linimasa|roadmap/, "chart-gantt"],
  [/kanban|board|papan/, "kanban"],
  [/calendar|kalender|jadwal|schedule|agenda/, "calendar"],
  [/sprint|milestone|tonggak/, "flag"],
  [/report|laporan|analytic|analitik|insight|statistic|statistik/, "chart-column"],
  [/task|tugas|todo|to-do|issue|backlog/, "list-checks"],
  [/project|proyek|projek/, "folder-kanban"],
  [/team|tim\b|member|anggota|people|user|pengguna|staff|karyawan|employee/, "users"],
  [/client|klien|customer|pelanggan|contact|kontak/, "contact"],
  [/invoice|faktur|tagihan|billing|payment|pembayaran/, "receipt"],
  [/budget|anggaran|finance|keuangan|expense|biaya|wallet/, "wallet"],
  [/order|pesanan|cart|keranjang/, "shopping-cart"],
  [/product|produk|inventory|inventaris|stock|stok/, "package"],
  [/message|pesan|chat|inbox|diskusi|discussion|comment|komentar/, "messages-square"],
  [/notification|notifikasi|alert/, "bell"],
  [/document|dokumen|file|berkas|attachment|lampiran/, "file-text"],
  [/time|waktu|timesheet|log jam|jam kerja/, "clock"],
  [/activity|aktivitas|audit|history|riwayat/, "history"],
  [/approval|persetujuan|review/, "shield-check"],
  [/profile|profil|account|akun/, "circle-user"],
  [/setting|pengaturan|preference|konfigurasi|configuration/, "settings"],
];
const NAV_TYPES: Record<string, string> = {
  dashboard: "layout-dashboard",
  list: "list",
  detail: "file-text",
  form: "square-pen",
  settings: "settings",
  board: "kanban",
  analytics: "chart-column",
};

export function navIcon(screen: { name: string; key: string; screen_type?: string | null }): string {
  const words = `${screen.name} ${screen.key.replace(/-/g, " ")}`.toLowerCase();
  for (const [re, icon] of NAV_WORDS) if (re.test(words)) return icon;
  return NAV_TYPES[screen.screen_type ?? ""] ?? "file";
}
