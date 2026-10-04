import { parseDocument, DomUtils } from "htmlparser2";
import { isTag, hasChildren, type AnyNode } from "domhandler";
import postcss from "postcss";

export function analysisDocument(html: string) {
  const doc = parseDocument(html, { lowerCaseTags: false, lowerCaseAttributeNames: false });
  function visit(nodes: AnyNode[]) {
    for (const node of [...nodes]) {
      if (node.type === "comment") { DomUtils.removeElement(node); continue; }
      if (isTag(node)) {
        const tag = node.name.toLowerCase();
        if (tag === "script") { DomUtils.removeElement(node); continue; }
        if (tag === "svg") { node.children = []; continue; }
      }
      if (hasChildren(node)) visit(node.children);
    }
  }
  visit(doc.children);
  return doc;
}

/** CSS evidence is data. Parse comments and URLs; encode every '<' for style raw-text embedding. */
export function cssEvidenceRules(css: string): Array<{ selector: string; css: string }> {
  try {
    const root = postcss.parse(css, { map: false });
    root.walkComments(comment => { comment.remove(); });
    const out: Array<{ selector: string; css: string }> = [];
    root.walkRules(rule => {
      rule.walkDecls(decl => {
        // Visual evidence must not reference external resources (including escaped CSS URLs).
        if (/\burl\s*\(/i.test(decl.value) || decl.value.includes("\\")) decl.value = "none";
      });
      out.push({ selector: rule.selector, css: rule.toString().replaceAll("<", "\\3c ") });
    });
    return out;
  } catch { return []; }
}
