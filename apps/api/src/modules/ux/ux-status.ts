import type { UxStatusTone } from "@sdd/contracts";

/**
 * One status, one badge tone, on every screen. Screens are drawn one at a
 * time, so "Pending Approval" could be amber on one and blue on the next. The
 * tones come from the shared example data's status list; a draft without one
 * takes, per label, the tone most of its badges already use. The platform then
 * sets that tone on every badge that shows the label — no model call.
 */

export interface StatusTone {
  label: string;
  tone: UxStatusTone;
}

const TONES = ["success", "warn", "danger", "info", "accent"] as const;
/** Badge class names: the kit's ds-badge(-tone), or an od seed's badge(-tone). */
export type BadgeClasses = "kit" | "od";
const PREFIX: Record<BadgeClasses, string> = { kit: "ds-", od: "" };
const BADGES: Record<BadgeClasses, RegExp> = {
  kit: /<(span|div|a|button|strong)\b([^>]*\sclass="[^"]*\bds-badge\b[^"]*"[^>]*)>([\s\S]*?)<\/\1\s*>/gi,
  od: /<(span|div|a|button|strong)\b([^>]*\sclass="(?:[^"]*\s)?badge(?=[\s"])[^"]*"[^>]*)>([\s\S]*?)<\/\1\s*>/gi,
};

const textOf = (html: string) =>
  html
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function toneOf(attrs: string, classes: BadgeClasses): UxStatusTone {
  const cls = /\sclass="([^"]*)"/i.exec(` ${attrs}`)?.[1]?.split(/\s+/) ?? [];
  return TONES.find((t) => cls.includes(`${PREFIX[classes]}badge-${t}`)) ?? "neutral";
}

/** Whether a badge's text shows the label: the whole text, or one "·"-separated part of it ("−7,15% · Terlambat"). */
function shows(text: string, label: string): boolean {
  const t = key(text);
  const l = key(label);
  return t === l || t.split(/\s[·•|]\s/).some((part) => part.trim() === l);
}

/** A tone wins a label only with this share of its badges: a near tie can be a deliberate severity split (late vs very late). */
const CLEAR_MAJORITY = 0.7;

/** Per label, the tone most of the draft's badges use (labels seen on two or more badges, with a clear majority). */
export function inferStatusTones(htmls: string[], classes: BadgeClasses = "kit"): StatusTone[] {
  const votes = new Map<string, { label: string; counts: Map<UxStatusTone, number> }>();
  for (const html of htmls) {
    for (const m of html.matchAll(BADGES[classes])) {
      const text = textOf(m[3] ?? "");
      if (!text || text.length > 40 || /\d/.test(text)) continue;
      const entry = votes.get(key(text)) ?? { label: text, counts: new Map() };
      const tone = toneOf(m[2] ?? "", classes);
      entry.counts.set(tone, (entry.counts.get(tone) ?? 0) + 1);
      votes.set(key(text), entry);
    }
  }
  const out: StatusTone[] = [];
  for (const { label, counts } of votes.values()) {
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((n, [, c]) => n + c, 0);
    if (total < 2 || ranked.length < 2 || ranked[0]![1] / total < CLEAR_MAJORITY) continue;
    out.push({ label, tone: ranked[0]![0] });
  }
  return out;
}

/** Every badge showing a listed status gets that status's tone; returns the content and how many badges changed. */
export function applyStatusTones(html: string, statuses: StatusTone[], classes: BadgeClasses = "kit"): { html: string; changed: number } {
  if (!statuses.length) return { html, changed: 0 };
  let changed = 0;
  const base = `${PREFIX[classes]}badge`;
  const out = html.replace(BADGES[classes], (whole, tag: string, attrs: string, inner: string) => {
    const text = textOf(inner);
    const status = statuses.find((s) => shows(text, s.label));
    if (!status || toneOf(attrs, classes) === status.tone) return whole;
    changed += 1;
    const next = attrs.replace(/(\sclass=")([^"]*)(")/i, (_m, pre: string, value: string, post: string) => {
      const kept = value.split(/\s+/).filter((c) => c && !TONES.some((t) => c === `${base}-${t}`));
      return `${pre}${[...kept, ...(status.tone === "neutral" ? [] : [`${base}-${status.tone}`])].join(" ")}${post}`;
    });
    return `<${tag}${next}>${inner}</${tag}>`;
  });
  return { html: out, changed };
}

/** The tones to hold a draft to: its status list, or what most of its badges already say. */
export function draftStatusTones(listed: StatusTone[] | undefined, htmls: string[], classes: BadgeClasses = "kit"): StatusTone[] {
  return listed?.length ? listed : inferStatusTones(htmls, classes);
}
