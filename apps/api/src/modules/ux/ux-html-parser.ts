import { parseDocument, DomUtils } from "htmlparser2";

/** Read style raw-text through the HTML parser, including unclosed style elements. */
export function separateStyles(html: string, remove: (attrs: Record<string, string>) => boolean = () => true): { html: string; css: string } {
  const doc = parseDocument(html, { lowerCaseTags: false, lowerCaseAttributeNames: false });
  const styles = DomUtils.findAll(node => node.name.toLowerCase() === "style", doc.children);
  const css: string[] = [];
  for (const style of styles) {
    const attrs = Object.fromEntries(Object.entries(style.attribs).map(([name, value]) => [name.toLowerCase(), value]));
    if (!remove(attrs)) continue;
    css.push(DomUtils.textContent(style));
    DomUtils.removeElement(style);
  }
  return { html: DomUtils.getOuterHTML(doc), css: css.join("\n") };
}

export function transformTables(html: string, update: (table: string) => string): string {
  const doc = parseDocument(html, { lowerCaseTags: false, lowerCaseAttributeNames: false });
  const tables = DomUtils.findAll(node => node.name.toLowerCase() === "table", doc.children);
  let changed = false;
  for (const table of tables.reverse()) {
    const serialized = DomUtils.getOuterHTML(table);
    const updated = update(serialized);
    if (updated === serialized) continue;
    const replacement = parseDocument(updated, { lowerCaseTags: false, lowerCaseAttributeNames: false }).children[0];
    if (replacement) { DomUtils.replaceElement(table, replacement); changed = true; }
  }
  return changed ? DomUtils.getOuterHTML(doc) : html;
}

/** Decode and serialize a start tag instead of splicing values into quoted attributes. */
export function transformStartTag(tag: string, update: (attrs: Record<string, string>) => void): string {
  const doc = parseDocument(tag);
  const element = DomUtils.findOne(() => true, doc.children);
  if (!element) return tag;
  update(element.attribs);
  const serialized = DomUtils.getOuterHTML(element);
  // The serializer adds a closing tag for this isolated element; return its start tag only.
  const closing = `</${element.name}>`;
  return serialized.endsWith(closing) ? serialized.slice(0, -closing.length) : serialized;
}
