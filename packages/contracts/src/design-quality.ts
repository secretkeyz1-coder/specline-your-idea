import { DesignArtifactSchema, decodeDesignContent, type DesignArtifact } from "./ai.js";
import { parseVerificationCommand } from "./verification.js";

export function designPathExists(design: DesignArtifact, section: string): boolean {
  // A qualified component reference must resolve that component, not merely
  // the populated components section (or a different component named in it).
  const reference = section.trim();
  const prefix = /^components?/i.exec(reference)?.[0];
  let separator = prefix?.length ?? 0;
  if (prefix) while (separator < reference.length && /\s/.test(reference[separator]!)) separator++;
  if (prefix && [":", "/", "."].includes(reference[separator] ?? "") && !/[\r\n\u2028\u2029]/.test(reference.slice(separator + 1).trimStart())) {
    const name = reference.slice(separator + 1).trim().toLowerCase();
    return Boolean(name) && design.components.some(c => c.name.trim().toLowerCase() === name && Boolean(c.responsibility.trim()));
  }
  const label = section.toLowerCase().replace(/[ -]+/g, "_");
  const sections = ["overview", "data_model", "api_contracts", "state_machines", "security", "testing_strategy", "deployment"] as const;
  return sections.some(k => label.includes(k) && Boolean(design[k]?.trim()))
    || (label.includes("architecture") && Boolean(design.architecture?.summary.trim()))
    || (label.includes("components") && design.components.some(c => Boolean(c.responsibility.trim())))
    || design.components.some(c => c.name.trim() && section.toLowerCase().includes(c.name.toLowerCase()) && Boolean(c.responsibility.trim()));
}

export function designApprovalIssues(design: DesignArtifact): string[] {
  return [
    ...(["overview", "data_model", "api_contracts", "state_machines", "security", "testing_strategy", "deployment"] as const).filter(k => !design[k]?.trim()).map(k => `Design section ${k} is empty; state explicitly when not applicable`),
    ...(!design.architecture?.summary.trim() ? ["Architecture summary is empty"] : []),
    ...design.unresolved_decisions.filter(d => d.blocking).map(d => `Blocking decision: ${d.description}`),
    ...design.requirement_coverage.filter(c => c.status !== "PATH_DEFINED" || !designPathExists(design, c.design_section)).map(c => `Unproven design path: ${c.requirement_key}`),
    ...(!design.delivery_checks?.length ? ["Define bounded delivery checks for build, startup and a core user journey"] : []),
    ...(design.delivery_checks ?? []).filter(c => !parseVerificationCommand(c.command).ok).map(c => `Delivery check must be a bounded executable invocation: ${c.command}`),
  ];
}

/** Preview the same material gaps as approval, including absent approved requirements. */
export function designReadinessIssues(content: unknown, requirementKeys: string[]): string[] {
  const parsed = DesignArtifactSchema.safeParse(decodeDesignContent(content));
  if (!parsed.success) return parsed.error.issues.map(i => `Design field ${i.path.join(".") || "document"}: ${i.message}`);
  const design = parsed.data;
  return designApprovalIssues({ ...design, requirement_coverage: requirementKeys.flatMap(key => {
    const rows = design.requirement_coverage.filter(c => c.requirement_key === key);
    return rows.length ? rows : [{ requirement_key: key, design_section: "", status: "NO_PATH" as const }];
  }) });
}
