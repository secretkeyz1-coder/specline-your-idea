import { desc, eq, inArray } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { AgentContextPackSchema, type AgentContextPack, type DesignArtifact } from "@sdd/contracts";
import type { PromptMode } from "@sdd/contracts";
import { dependenciesOf, getTask, traceabilityOf, type TaskRow } from "../task/repo.js";
import { getApprovedRevision } from "../artifact/service.js";
import { getProject } from "../project/service.js";
import { audit } from "../audit/service.js";
import { approvedDesignSystem, designSystemBrief } from "../design-system/service.js";
import { approvedUxReference, uxFilePath } from "../ux/ux.js";
import { appShellLine, renderCheckLine, screenBehaviourLines, designContextLines } from "../task/generation.js";
import { approvedStackLayers, lineageNotes, relevantScreens, specStates, specStatusNote, stackLayerLines, taskLineage, UI_TASK_TYPES, type SpecKind } from "./spec-context.js";

/**
 * Context packs + work-order prompts (Phase 9, T097–T101, C10/C13).
 * Minimal context only: linked requirements/ACs, relevant design sections,
 * the approved stack, design system and the UI-reference screens the task
 * builds, project rules. Approved revisions only — anything skipped, stale or
 * unapproved is named in spec_notes instead. Never secrets (C13).
 */

export async function buildContextPack(db: DbExecutor, task: TaskRow): Promise<AgentContextPack> {
  const project = await getProject(db, task.projectId);
  const links = await traceabilityOf(db, task.id);
  const deps = await dependenciesOf(db, task.id);

  const requirementIds = [...new Set(links.map((l) => l.requirement.id))].filter(Boolean);
  let requirements: AgentContextPack["requirements"] = [];
  if (requirementIds.length > 0) {
    const rows = await db.select().from(schema.requirements).where(inArray(schema.requirements.id, requirementIds));
    const acs = rows.length
      ? await db.select().from(schema.acceptanceCriteria).where(inArray(schema.acceptanceCriteria.requirementId, rows.map((r) => r.id)))
      : [];
    requirements = rows.map((r) => ({
      key: r.key,
      title: r.title,
      statement: r.statement,
      acceptance_criteria: acs
        .filter((ac) => ac.requirementId === r.id)
        .map((ac) => ({ key: ac.key, statement: ac.statement })),
    }));
  }

  // Relevant design excerpts: the sections of the approved design revision (C10).
  const designSections: AgentContextPack["design_sections"] = [];
  const approvedDesign = await getApprovedRevision(db, task.projectId, "design");
  if (approvedDesign) {
    const d = approvedDesign.revision.structuredContent as DesignArtifact | null;
    designSections.push({ title: "Approved technical design", content: designContextLines(d).join("\n") });
  }

  const [lastReview] = await db.select().from(schema.reviews).where(eq(schema.reviews.taskId, task.id)).orderBy(desc(schema.reviews.createdAt)).limit(1);
  if (lastReview?.decision === "CHANGES_REQUESTED") designSections.push({ title: "Required review corrections", content: `${lastReview.summary}\n${lastReview.findings.map(f => `[${f.severity}] ${f.message}`).join("\n")}` });

  // The rest of the approved spec, and plain notes on whatever is not approved.
  const states = await specStates(db, task.projectId);
  const stack = await approvedStackLayers(db, task.projectId);
  const ds = await approvedDesignSystem(db, task.projectId);
  const ux = await approvedUxReference(db, task.projectId);
  const uxVersion = ux && states.ux.state === "approved" ? states.ux.version : null;
  const screens = ux
    ? relevantScreens(ux.screens, { taskType: task.taskType, requirementKeys: requirements.map((r) => r.key), contract: task.contract, objective: task.objective })
    : [];
  const kinds: SpecKind[] = ["requirements", "stack", "design", "ux", "design_system"];
  const specNotes = [
    ...kinds.map((k) => specStatusNote(k, states[k])).filter((n): n is string => n !== null),
    ...lineageNotes(await taskLineage(db, task.projectId, [task]), { single: true }),
  ];

  const dependencyOutputs: Record<string, string[]> = {};
  for (const dep of deps) {
    const declared = task.contract.dependency_outputs?.[dep.task.key];
    dependencyOutputs[dep.task.key] = declared ?? [];
  }

  return AgentContextPackSchema.parse({
    schema_version: 1,
    task: {
      id: task.id,
      key: task.key,
      title: task.title,
      objective: task.objective,
      status: task.workflowStatus,
      task_type: task.taskType,
      contract: task.contract,
      dependencies: deps.map((d) => ({ key: d.task.key, title: d.task.title, status: d.task.workflowStatus })),
    },
    project: { id: project.id, key: project.key, name: project.name },
    requirements,
    design_sections: designSections,
    project_rules: project.projectRules,
    repository_instructions: null,
    dependency_outputs: dependencyOutputs,
    stack,
    design_system: ds ? { version: ds.version, name: ds.spec.name, brief: designSystemBrief(ds.spec) } : null,
    ui_reference:
      ux && uxVersion !== null
        ? {
            version: uxVersion,
            fidelity: ux.fidelity ?? "neutral",
            screens: screens.map((s) => ({
              key: s.key,
              name: s.name,
              file: uxFilePath(s.key),
              purpose: s.purpose,
              requirement_keys: s.requirement_keys,
              key_elements: s.key_elements,
              behaviour: screenBehaviourLines(s),
            })),
            render_check: screens.length ? renderCheckLine(ux) : null,
          }
        : null,
    // The shell reaches every UI task, not only the decomposer: without it a
    // screen task builds a standalone page (docs/28 R4).
    app_shell: ux && uxVersion !== null && (screens.length > 0 || UI_TASK_TYPES.has(task.taskType)) ? appShellLine(ux) : null,
    spec_notes: specNotes,
  });
}

/* ── Prompt rendering (T098–T100) ── */

function fmtList(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

/** Notes on skipped, stale or unapproved specs, as a section; empty when there are none. */
export function specStatusSection(pack: AgentContextPack): string {
  const notes = pack.spec_notes ?? [];
  return notes.length ? `## Spec status (read first)\n${fmtList(notes)}\n\n` : "";
}

/** The approved stack, design system and this task's UI-reference screens, as prompt sections. */
export function specSections(pack: AgentContextPack): string {
  const out: string[] = [];
  if (pack.stack) {
    out.push(`## Tech stack (locked, v${pack.stack.version})\nUse exactly these; do not swap or add frameworks, databases or libraries.\n${stackLayerLines(pack.stack.layers).join("\n")}`);
  }
  if (pack.design_system) {
    out.push(`## Design system (v${pack.design_system.version})\n${pack.design_system.brief}`);
  }
  const ui = pack.ui_reference;
  if (ui) {
    const rule =
      ui.fidelity === "styled"
        ? "Layout, elements, flow and look of these mockups are binding (they are drawn with the design system)."
        : `Layout, elements and flow of these mockups are binding; colours, fonts and component styling follow ${pack.design_system ? "the design system" : "the stack"}.`;
    out.push(
      ui.screens.length
        ? `## UI reference screens for this task (v${ui.version})\n${rule} The mockup files are in docs/ui-reference/ (\`sddctl ui pull\`).\n` +
            ui.screens
              .map(
                (sc) =>
                  `- \`${sc.file}\` — ${sc.name}: ${sc.purpose}\n  key elements: ${sc.key_elements.join("; ") || "-"}` +
                  (sc.behaviour.length ? `\n  behaviour to build and test: ${sc.behaviour.join("; ")}` : ""),
              )
              .join("\n")
        : `## UI reference (v${ui.version})\nNo screen of the approved UI reference belongs to this task.`,
    );
    if (ui.screens.length && ui.render_check) out.push(`## Render check\n${ui.render_check}`);
  }
  if (pack.app_shell) {
    out.push(`## Application shell\n${pack.app_shell}\nOnly in-app screens render inside it: no full-screen wrapper or navigation of their own. Screens listed outside remain focused, without application navigation or signed-in utilities.`);
  }
  return out.length ? `${out.join("\n\n")}\n\n` : "";
}

/** Spec notes for the connected prompts, which otherwise only point at the pack. */
function connectedNotes(pack: AgentContextPack): string {
  const notes = pack.spec_notes ?? [];
  return notes.length ? `\nSpec status (read first):\n${fmtList(notes)}\n` : "";
}

export function renderStandalonePrompt(pack: AgentContextPack): string {
  const c = pack.task.contract!;
  return `# Work Order ${pack.task.key} — ${pack.task.title}

You are implementing one bounded task in an existing repository.

## Objective
${pack.task.objective}

${specStatusSection(pack)}## Source requirements
${pack.requirements.length ? pack.requirements.map((r) => `### ${r.key} — ${r.title}\n${r.statement}\n${r.acceptance_criteria.map((ac) => `- ${ac.key}: ${ac.statement}`).join("\n")}`).join("\n\n") : "(none linked)"}

## Acceptance criteria
${fmtList(c.acceptance_criteria)}

## Relevant design
${pack.design_sections.map((s) => `### ${s.title}\n${s.content}`).join("\n\n") || "(none)"}

${specSections(pack)}## Scope
Expected paths:
${fmtList(c.scope.expected_paths)}
${c.scope.forbidden_paths.length ? `Forbidden paths (do not modify):\n${fmtList(c.scope.forbidden_paths)}` : ""}

## Constraints
${c.constraints.length ? fmtList(c.constraints) : "(none)"}

## Dependencies
${pack.task.dependencies.length ? pack.task.dependencies.map((d) => `- ${d.key} (${d.status}): ${d.title}`).join("\n") : "(none)"}

## Required verification
${c.verification.required.map((v) => `- [${v.type}] ${v.command}`).join("\n")}

## Deliverables
${fmtList(c.deliverables)}

## Stop conditions
${fmtList(c.stop_conditions)}

## Execution rules

1. Inspect the repository before editing.
2. Do not modify unrelated code.
3. Follow applicable repository \`AGENTS.md\` instructions and approved project constraints.
4. If the work order conflicts with an applicable \`AGENTS.md\`, approved requirement, or architecture constraint, stop and report the conflict instead of guessing.
5. Do not change approved architecture or add dependencies unless explicitly allowed by the approved task/design.
6. Run required verification.
7. Never claim a test passed if it was not run.
8. If a stop condition occurs, stop and explain the blocker.
9. At the end, report:
   - what changed;
   - files/components changed;
   - tests run;
   - test results;
   - remaining risks/limitations.

Task ID must remain ${pack.task.key} in your final summary.`;
}

export function renderConnectedCliPrompt(pack: AgentContextPack): string {
  return `You are assigned ${pack.task.key}.

This repository is connected to the SDD control plane.

Before implementation run:

  sddctl task context ${pack.task.key} --format agent

Read the returned task contract completely. It also carries the approved tech stack,
design system and the UI-reference screens this task builds: follow them.
${connectedNotes(pack)}
Then claim/start:

  sddctl task claim ${pack.task.key}
  sddctl task start ${pack.task.key}

During execution, report meaningful progress when useful:

  sddctl run progress --message "..."

Report required tests with sddctl:

  sddctl run test --command "<command>" --status passed

If blocked:

  sddctl task block ${pack.task.key} --reason "<reason>"

When implementation and required verification are complete:

  sddctl task submit ${pack.task.key} --summary "<implementation summary>"

Do not self-approve the task.
Do not alter unrelated scope.`;
}

export function renderConnectedMcpPrompt(pack: AgentContextPack): string {
  return `You are assigned ${pack.task.key}.

Use the configured SDD MCP server.

1. Call task_get for ${pack.task.key}.
2. Read the returned task contract, and the approved tech stack, design system and
   UI-reference screens that come with it: follow them.
${connectedNotes(pack)}
3. Call task_claim.
4. Call task_start.
5. Execute only the authorized scope.
6. Report meaningful progress/test evidence through task_report_progress and task_report_test.
7. If blocked, call task_block with a clear reason.
8. When implementation and required verification finish, call task_request_review.

Do not claim acceptance yourself.`;
}

export function renderPrompt(pack: AgentContextPack, mode: PromptMode): string {
  switch (mode) {
    case "STANDALONE":
      return renderStandalonePrompt(pack);
    case "CONNECTED_CLI":
      return renderConnectedCliPrompt(pack);
    case "CONNECTED_MCP":
      return renderConnectedMcpPrompt(pack);
  }
}

/** Prompt generation with audit metadata (T101). */
export async function generateTaskPrompt(
  db: DbExecutor,
  input: { taskId: string; userId: string; source: "WEB" | "CLI" | "MCP"; mode: PromptMode },
) {
  const task = await getTask(db, input.taskId);
  const pack = await buildContextPack(db, task);
  const prompt = renderPrompt(pack, input.mode);
  await audit(db, {
    workspaceId: (await db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).limit(1))[0]!.workspaceId,
    projectId: task.projectId,
    actorType: "USER",
    actorId: input.userId,
    source: input.source,
    action: "task.prompt_generated",
    entityType: "TASK",
    entityId: task.id,
    metadata: { mode: input.mode, prompt_chars: prompt.length },
  });
  return { prompt, mode: input.mode, pack };
}
