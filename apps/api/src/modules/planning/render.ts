import type { RequirementsArtifact, StackDecision, DesignArtifact } from "@sdd/contracts";
import { qualityCriteria } from "@sdd/contracts";

/** Markdown renderers for artifact revisions (viewer + export). */

export function renderRequirementsMarkdown(r: RequirementsArtifact): string {
  const out: string[] = [];
  out.push(`# Requirements`);
  out.push(`\n## Summary\n\n${r.summary}`);
  if (r.actors.length) {
    out.push(`\n## Actors\n`);
    for (const a of r.actors) out.push(`- **${a.name}** — ${a.description}`);
  }
  if (r.workflows.length) {
    out.push(`\n## Core workflows\n`);
    for (const w of r.workflows) {
      out.push(`\n### ${w.name}${w.primary_actor ? ` (${w.primary_actor})` : ""}\n`);
      w.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
    }
  }
  out.push(`\n## Functional requirements\n`);
  for (const fr of r.functional_requirements) {
    out.push(`\n### ${fr.key} — ${fr.title} [${fr.priority}]\n\n${fr.statement}\n`);
    for (const ac of fr.acceptance_criteria) out.push(`- **${ac.key}**: ${ac.statement} _(verify: ${ac.verification_type})_`);
  }
  if (r.non_functional.length) {
    out.push(`\n## Non-functional requirements\n`);
    for (const nfr of r.non_functional) {
      out.push(`- **${nfr.key}** [${nfr.priority ?? "P1"}]: ${nfr.statement}`);
      for (const ac of qualityCriteria(nfr)) out.push(`  - **${ac.key}**: ${ac.statement} _(verify: ${ac.verification_type ?? "METRIC"})_`);
    }
  }
  if (r.assumptions.length) {
    out.push(`\n## Assumptions\n`);
    for (const a of r.assumptions) out.push(`- ${a.description}`);
  }
  if (r.exclusions.length) {
    out.push(`\n## Exclusions\n`);
    for (const e of r.exclusions) out.push(`- ${e.description}`);
  }
  if (r.open_questions.length) {
    out.push(`\n## Open questions\n`);
    for (const q of r.open_questions) out.push(`- ${q.description}`);
  }
  return out.join("\n");
}

export function renderStackMarkdown(s: StackDecision): string {
  const out: string[] = [];
  out.push(`# Technology stack`);
  out.push(`\nMode: **${s.mode}**`);
  s.candidates.forEach((c, i) => {
    const isRecommended = s.recommendation_index === i;
    out.push(`\n## ${c.name}${isRecommended ? " ⭐ recommended" : ""}\n`);
    out.push(`| Layer | Technology | Version | Rationale |`);
    out.push(`|---|---|---|---|`);
    for (const l of c.layers) out.push(`| ${l.category} | ${l.technology} | ${l.version_constraint ?? "—"} | ${l.rationale} |`);
    if (c.tradeoffs.length) {
      out.push(`\n**Tradeoffs:**`);
      for (const t of c.tradeoffs) out.push(`- ${t.dimension}: ${t.assessment}`);
    }
    if (c.fit_assessment) out.push(`\n${c.fit_assessment}`);
  });
  if (s.rationale) out.push(`\n## Recommendation rationale\n\n${s.rationale}`);
  if (s.conflicts.length) {
    out.push(`\n## Compatibility findings\n`);
    for (const c of s.conflicts) out.push(`- [${c.severity}] ${c.category}: ${c.finding}`);
  }
  return out.join("\n");
}

export function renderDesignMarkdown(d: DesignArtifact): string {
  const out: string[] = [];
  out.push(`# Technical design`);
  out.push(`\n## Overview\n\n${d.overview}`);
  out.push(`\n## Architecture\n\n${d.architecture.summary}`);
  if (d.architecture.diagram_text) out.push(`\n\`\`\`\n${d.architecture.diagram_text}\n\`\`\``);
  if (d.components.length) {
    out.push(`\n## Components\n`);
    for (const c of d.components) out.push(`\n### ${c.name}\n\n${c.responsibility}${c.interfaces ? `\n\nInterfaces: ${c.interfaces}` : ""}`);
  }
  out.push(`\n## Data model\n\n${d.data_model}`);
  out.push(`\n## API contracts\n\n${d.api_contracts}`);
  out.push(`\n## State machines & workflows\n\n${d.state_machines}`);
  if (d.requirement_coverage.length) {
    out.push(`\n## Requirement coverage\n`);
    for (const c of d.requirement_coverage) out.push(`- **${c.requirement_key}** → ${c.design_section} (${c.status})`);
  }
  out.push(`\n## Testing strategy\n\n${d.testing_strategy}`);
  out.push(`\n## Security\n\n${d.security}`);
  out.push(`\n## Deployment\n\n${d.deployment}`);
  if (d.delivery_checks?.length) {
    out.push(`\n## Delivery verification\n`);
    for (const check of d.delivery_checks) out.push(`- **${check.purpose}**: \`${check.command}\` — ${check.outcome}\n  Outputs: ${check.expected_paths.join(", ") || "runtime evidence"}`);
  }
  if (d.unresolved_decisions.length) {
    out.push(`\n## Unresolved decisions\n`);
    for (const u of d.unresolved_decisions) out.push(`- ${u.blocking ? "**BLOCKING**" : "Non-blocking"}: ${u.description}`);
  }
  return out.join("\n");
}
