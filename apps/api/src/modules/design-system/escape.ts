/**
 * Escaping for everything a design-system spec puts into generated files
 * (theme CSS, TS theme modules, preview HTML). The spec schema already
 * refuses names and fonts that could break out, but approved specs are read
 * back from the database without re-validation, so every emit site escapes
 * as well — a spec can never become code in a repository it is exported to.
 */

/** Characters that never need escaping inside a CSS string. */
const CSS_STRING_SAFE = /[\p{L}\p{N} _.,&+'-]/u;

/** A CSS string literal ("…") holding `value`; anything unusual becomes a `\hex ` escape. */
export function cssString(value: string): string {
  let out = "";
  for (const ch of value) {
    if (CSS_STRING_SAFE.test(ch)) out += ch;
    else out += `\\${ch.codePointAt(0)!.toString(16)} `;
  }
  return `"${out}"`;
}

/** An unquoted family name CSS reads as identifiers: `sans-serif`, `Segoe UI`, `-apple-system`. */
const BARE_FAMILY = /^-?[A-Za-z_][A-Za-z0-9_-]*(?: [A-Za-z0-9_-]+)*$/;

/** Split a font-family list on commas outside quotes. */
function splitFamilies(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((f) => f.trim()).filter(Boolean);
}

/** One family, unquoted: the name itself. */
function familyName(family: string): string {
  const quoted = /^(["'])([\s\S]*)\1$/.exec(family);
  return quoted ? quoted[2]! : family;
}

/**
 * A font-family value safe to write into CSS (a declaration, or a `<style>`
 * element): plain identifiers stay as typed, everything else is re-quoted as
 * an escaped CSS string. A valid stack comes out unchanged.
 */
export function cssFontStack(value: string): string {
  const families = splitFamilies(value).map((family) => {
    if (BARE_FAMILY.test(family)) return family;
    return cssString(familyName(family));
  });
  return families.length ? families.join(", ") : "sans-serif";
}

/** The first family of a stack, for prose ("headings use Inter"). */
export function firstFamily(value: string): string {
  const first = splitFamilies(value)[0];
  return first ? familyName(first) : "";
}

/** Control characters, including the JS/HTML line breaks outside ASCII. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * Text inside a CSS block comment: it cannot close the comment (`*\/`) or,
 * when the CSS sits in a `<style>` element, the element (`</style>`).
 */
export function cssComment(value: string): string {
  return value.replace(CONTROL, " ").replace(/\*\//g, "* /").replace(/[<>]/g, "");
}

/** Text inside a `//` line comment of a JS/TS file: no line break can end it early. */
export function lineComment(value: string): string {
  return value.replace(CONTROL, " ");
}

/** A JS/TS string literal. */
export const jsString = (value: string): string => JSON.stringify(value);
