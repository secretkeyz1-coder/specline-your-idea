import { parseVerificationCommand, type DesignArtifact, type RequirementsArtifact } from "@sdd/contracts";

/** Keep product decisions that normalized FR rows cannot represent in every downstream context. */
export function productContext(data: RequirementsArtifact | null | undefined): string[] {
  if (!data) return [];
  return ["APPROVED PRODUCT CONTEXT:", JSON.stringify({ summary: data.summary, actors: data.actors, workflows: data.workflows, assumptions: data.assumptions, exclusions: data.exclusions, open_questions: data.open_questions })];
}

export function designPathExists(design: DesignArtifact, section: string): boolean {
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

/** Conservative explicit reversal check; paraphrases are assessed against source outcomes by the reviewer. */
export function contradictsOutcome(source: string, candidate: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\b(cannot|can't|must not|may not|not allowed to|tidak boleh|dilarang)\b/g, " NOT ").replace(/\b(can|may|must|allowed to|boleh|dapat)\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const a = normalize(source), b = normalize(candidate);
  return /\bNOT\b/.test(a) !== /\bNOT\b/.test(b) && a.replace(/\bNOT\b/g, "").replace(/\s+/g, " ").trim() === b.replace(/\bNOT\b/g, "").replace(/\s+/g, " ").trim();
}
