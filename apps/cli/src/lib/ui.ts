import { api } from "./api.js";
import { mkdirSync, writeFileSync } from "node:fs";

type UxScreenPayload = { key: string; name: string; purpose: string; key_elements: string[]; requirement_keys: string[]; html: string | null };

/**
 * A pulled mockup as written into the repository: the no-script, no-network
 * policy the control plane shows it under goes first in the document, so the
 * file stays inert when someone opens it in a browser. Screens framed since
 * the platform stored the policy already carry it; older ones (and legacy
 * whole-document screens) get it here. Put before everything else, it applies
 * to the whole document — a browser moves it into <head>.
 */
const MOCKUP_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;
function inertMockup(html: string): string {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? "";
  return `${doctype}${MOCKUP_CSP}${html.slice(doctype.length)}`;
}

export async function pullApprovedUi(projectId: string, repoRoot: string) {
  const result: Record<string, unknown> = {};

  // ── UI reference
  const state = await api<{
    approved: { version: number; reference: { applicable: boolean; reason: string; fidelity?: string; screens: UxScreenPayload[] } | null } | null;
    draft: { version: number } | null;
  }>("GET", `/api/v1/projects/${projectId}/ux`);
  const ref = state.approved?.reference;
  if (!ref) {
    console.log(
      state.draft
        ? "NO_UI_REFERENCE: a UI reference draft exists but is not approved yet — build without it, or ask the user to approve it."
        : "NO_UI_REFERENCE: this project has no approved UI reference — build from the specs alone.",
    );
  } else if (!ref.applicable) {
    console.log(`NO_UI_REFERENCE: not applicable — ${ref.reason || "the product has no user interface"}.`);
  } else {
    const styled = ref.fidelity === "styled";
    const dir = `${repoRoot}/docs/ui-reference`;
    mkdirSync(dir, { recursive: true });
    for (const s of ref.screens) if (s.html) writeFileSync(`${dir}/${s.key}.html`, inertMockup(s.html));
    writeFileSync(
      `${dir}/README.md`,
      [
        `# UI reference (v${state.approved!.version})`,
        "",
        styled
          ? "Mockups drawn with the project's design system (docs/design-system/), approved in the control plane."
          : "Neutral mid-fidelity mockups approved in the control plane.",
        styled
          ? "Layout, elements, flow and look are binding."
          : "Layout, elements and flow are binding; colours, fonts and component styling follow the design system (docs/design-system/) or the stack.",
        "",
        ...ref.screens.flatMap((s) => [
          `## [${s.name}](./${s.key}.html)`,
          "",
          s.purpose,
          s.requirement_keys.length ? `\nRequirements: ${s.requirement_keys.join(", ")}` : "",
          "",
          ...s.key_elements.map((e) => `- ${e}`),
          "",
        ]),
      ].join("\n"),
    );
    result.ui_reference = { pulled: ref.screens.filter((s) => s.html).length, version: state.approved!.version, path: "docs/ui-reference/" };
  }

  // ── Design system
  const ds = await api<{ version: number | null; dir: string; files: Array<{ path: string; content: string }> }>(
    "GET",
    `/api/v1/projects/${projectId}/design-system/export`,
  );
  if (!ds.version || ds.files.length === 0) {
    console.log("NO_DESIGN_SYSTEM: this project has no approved design system — style the app from the stack's defaults.");
  } else {
    for (const f of ds.files) {
      // Paths come from the control plane; keep them inside the repository anyway.
      if (f.path.includes("..") || f.path.startsWith("/")) continue;
      const full = `${repoRoot}/${f.path}`;
      mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
      writeFileSync(full, f.content);
    }
    result.design_system = { pulled: ds.files.length, version: ds.version, path: `${ds.dir}/` };
  }

  return result;
}
