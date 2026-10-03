import { type RequirementsArtifact } from "@sdd/contracts";
export { designPathExists, designApprovalIssues } from "@sdd/contracts";

/** Keep product decisions that normalized FR rows cannot represent in every downstream context. */
export function productContext(data: RequirementsArtifact | null | undefined): string[] {
  if (!data) return [];
  return ["APPROVED PRODUCT CONTEXT:", JSON.stringify({ summary: data.summary, actors: data.actors, workflows: data.workflows, assumptions: data.assumptions, exclusions: data.exclusions, open_questions: data.open_questions })];
}

/** Conservative explicit reversal check; paraphrases are assessed against source outcomes by the reviewer. */
export function contradictsOutcome(source: string, candidate: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\b(cannot|can't|must not|may not|not allowed to|tidak boleh|dilarang)\b/g, " NOT ").replace(/\b(can|may|must|allowed to|boleh|dapat)\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const a = normalize(source), b = normalize(candidate);
  return /\bNOT\b/.test(a) !== /\bNOT\b/.test(b) && a.replace(/\bNOT\b/g, "").replace(/\s+/g, " ").trim() === b.replace(/\bNOT\b/g, "").replace(/\s+/g, " ").trim();
}
