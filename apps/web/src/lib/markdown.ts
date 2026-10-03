import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/** Escape text destined for raw HTML embedding (error fallbacks). */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Renders Markdown content into safe, styled HTML for documentation views.
 * Artifact/task content is multi-user input — the rendered HTML is sanitized
 * (allowlist) before it reaches `{@html}` so embedded scripts, event handlers,
 * and javascript: URLs can never execute (docs/13 §3).
 */
export function renderMarkdown(content: string | null | undefined, opts: { nested?: boolean } = {}): string {
  if (!content) return "";
  const html = renderSafe(content);
  // A document shown inside a page sits under that page's <h1>: every heading
  // moves down one level (h1 → h2 …) and keeps its look through a class, so
  // the page has exactly one h1.
  if (!opts.nested) return html;
  return html.replace(/<(\/?)h([1-5])(\s[^>]*)?>/g, (_m, close: string, level: string, rest = "") =>
    close ? `</h${Number(level) + 1}>` : `<h${Number(level) + 1} class="doc-h${level}"${rest}>`,
  );
}

function renderSafe(content: string): string {
  let raw: string;
  try {
    raw = marked.parse(content, {
      async: false,
      gfm: true,
      breaks: true,
    }) as string;
  } catch {
    return `<pre class="font-mono text-xs whitespace-pre-wrap">${escapeHtml(content)}</pre>`;
  }
  return sanitizeHtml(raw, {
    ...sanitizeHtml.defaults,
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
    },
    // Only syntax-highlighting hints survive. A blanket `class` allowlist let
    // document content apply the app's own utility classes (e.g. `fixed
    // inset-0 z-50`) and overlay the whole UI with fake content and links.
    // Images stay dropped on purpose: CSP blocks remote images anyway and
    // fetching them would leak the viewer's IP to arbitrary hosts.
    allowedClasses: {
      code: ["language-*"],
      pre: ["language-*"],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  });
}

/**
 * Folds every requirement section of a nested-rendered document ("### FR-001 —
 * …" → `<h4 class="doc-h3">`) into a closed `<details id="req-FR-001">` whose
 * summary is that heading, so a long spec reads as its list of requirements
 * first. A section runs until the next heading of its level or higher. Runs
 * on already-sanitized HTML; the id is built from the key's [A-Z0-9-] only.
 */
export function foldRequirementSections(html: string): string {
  const heading = /<h4 class="doc-h3">((?:[A-Z]+-\d+)[\s\S]*?)<\/h4>/g;
  const starts: Array<{ index: number; end: number; key: string; inner: string }> = [];
  for (const m of html.matchAll(heading)) {
    const key = /^([A-Z]+-\d+)/.exec(m[1]!.replace(/<[^>]+>/g, ""))?.[1];
    if (key) starts.push({ index: m.index!, end: m.index! + m[0].length, key, inner: m[1]! });
  }
  if (starts.length === 0) return html;
  let out = "";
  let cursor = 0;
  for (const s of starts) {
    out += html.slice(cursor, s.index);
    // The body ends at the next h2–h4 (next requirement, or the next section).
    const rest = html.slice(s.end);
    const next = rest.search(/<h[234][\s>]/);
    const body = next === -1 ? rest : rest.slice(0, next);
    // "[P0]" in the heading becomes a monospace badge: in the text face its 0 reads as an O.
    const inner = s.inner.replace(/\s*\[(P\d)\]\s*$/, ' <span class="doc-prio">$1</span>');
    out += `<details class="doc-fold" id="req-${s.key}"><summary><h4 class="doc-h3">${inner}</h4></summary>${body}</details>`;
    cursor = s.end + body.length;
  }
  return out + html.slice(cursor);
}


/**
 * Turns requirement keys mentioned in a rendered document ("… covers FR-001")
 * into links to that requirement, but only keys in `keys` (so AC-/NFR-/task
 * keys and unknown ids stay text) and only in text nodes outside links, code
 * and headings. Runs on sanitized HTML; keys are [A-Z0-9-] only, so they need
 * no escaping inside the href.
 */
export function linkRequirementKeys(html: string, keys: Iterable<string>, hrefFor: (key: string) => string): string {
  const known = new Set(keys);
  if (known.size === 0 || !html) return html;
  const skip = { a: 0, code: 0, pre: 0, h: 0 };
  return html
    .split(/(<[^>]+>)/)
    .map((part) => {
      const tag = /^<(\/?)(a|code|pre|h[1-6])[\s>]/i.exec(part);
      if (tag) {
        const name = tag[2]!.toLowerCase();
        const k = name.startsWith("h") ? "h" : (name as "a" | "code" | "pre");
        skip[k] = Math.max(0, skip[k] + (tag[1] ? -1 : 1));
        return part;
      }
      if (part.startsWith("<") || skip.a || skip.code || skip.pre || skip.h) return part;
      return part.replace(/\b([A-Z]+-\d+)\b/g, (m, key: string) => (known.has(key) ? `<a href="${hrefFor(key)}">${key}</a>` : m));
    })
    .join("");
}

export type SectionRef = { key: string | null; title: string };
export type SectionChanges = { added: SectionRef[]; removed: SectionRef[]; changed: SectionRef[] };

type Section = { id: string; ref: SectionRef; body: string };

/** Headings and what follows each, outside fenced code. A heading led by a requirement key is identified by that key. */
function sections(markdown: string | null | undefined): Section[] {
  const out: Section[] = [];
  const seen = new Map<string, number>();
  let current: Section | null = null;
  let fenced = false;
  for (const line of (markdown ?? "").split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const h = fenced ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!h) {
      if (current) current.body += `${line}\n`;
      continue;
    }
    // The document's own title opens its introduction: renaming the document is not a changed section.
    if (h[1] === "#") {
      current = { id: "#intro", ref: { key: null, title: "Introduction" }, body: "" };
      out.push(current);
      continue;
    }
    const title = h[2]!.replace(/[*_`]/g, "").trim();
    const key = /^([A-Z]+-\d+)\b/.exec(title)?.[1] ?? null;
    // Renumbering ("3. Data" → "4. Data") is not a change; a key's title and priority are.
    const base = key ?? title.toLowerCase().replace(/^\d+(\.\d+)*\.?\s+/, "").replace(/\s+/g, " ");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    current = { id: n > 1 ? `${base}#${n}` : base, ref: { key, title: key ? title.replace(/^[A-Z]+-\d+\s*[—–:-]?\s*/, "").replace(/\s*\[P\d\]\s*$/, "") || key : title }, body: key ? `${title}\n` : "" };
    out.push(current);
  }
  return out;
}

/**
 * What changed between two versions of a Markdown document, section by
 * section (a requirement's section is keyed by its FR key): sections added,
 * removed, and whose text changed. Whitespace-only edits don't count.
 */
export function sectionChanges(before: string | null | undefined, after: string | null | undefined): SectionChanges {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const old = new Map(sections(before).map((s) => [s.id, s]));
  const next = sections(after);
  const nextIds = new Set(next.map((s) => s.id));
  const changes: SectionChanges = { added: [], removed: [], changed: [] };
  for (const s of next) {
    const was = old.get(s.id);
    if (!was) changes.added.push(s.ref);
    else if (norm(was.body) !== norm(s.body)) changes.changed.push(s.ref);
  }
  for (const [id, s] of old) if (!nextIds.has(id)) changes.removed.push(s.ref);
  return changes;
}
