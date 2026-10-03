import { decodeDesignContent, type DesignArtifact } from "@sdd/contracts";

export type Coverage = DesignArtifact["requirement_coverage"][number];
export type DeliveryCheck = NonNullable<DesignArtifact["delivery_checks"]>[number];

export function designEditorInitial(content: unknown): Partial<DesignArtifact> {
  const decoded = decodeDesignContent(content);
  return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded as Partial<DesignArtifact> : {};
}

export function initialCoverage(initial: Partial<DesignArtifact>, keys: string[]): Coverage[] {
  return keys.map(key => ({ ...(initial.requirement_coverage?.find(c => c.requirement_key === key)
    ?? { requirement_key: key, design_section: "", status: "NO_PATH" as const }) }));
}

/** Keep explicitly authored metadata; never infer PATH_DEFINED from prose. */
export function designEditorPayload(sections: Omit<DesignArtifact, "requirement_coverage" | "delivery_checks">, coverage: Coverage[], checks: DeliveryCheck[]): DesignArtifact {
  return { ...sections, requirement_coverage: coverage.map(c => ({ ...c, design_section: c.design_section.trim() })),
    delivery_checks: checks.map(c => ({ ...c, command: c.command.trim(), outcome: c.outcome.trim(), expected_paths: c.expected_paths.map(p => p.trim()).filter(Boolean) })) };
}

export function approvalErrorIssues(details: unknown): string[] {
  if (!details || typeof details !== "object" || !("issues" in details) || !Array.isArray(details.issues)) return [];
  return details.issues.filter((i): i is string => typeof i === "string");
}
