import { schema } from "@sdd/db";
import type { TaskContract } from "@sdd/contracts";
import { dependenciesOf, listTasks } from "./repo.js";
import { getApprovedRevision } from "../artifact/service.js";
import { approvedUxReference, uxFilePath } from "../ux/ux.js";
import { approvedDesignSystem } from "../design-system/service.js";
import { DESIGN_SYSTEM_DIR } from "../design-system/exports.js";
import { findLibrary } from "../design-system/libraries.js";
import { installCommands } from "../cli/installers.js";
import { appShellLine, RENDER_SHOT_DIR, renderCheckLine, screenBehaviourLines, templateAppearanceLines } from "./generation.js";
import { designSystemEssentials, lineageNotes, specStates, specStatusNote, taskLineage, type SpecKind } from "../prompt/spec-context.js";

/** The master execution prompt: one work order that sets a local agent up and walks it through every task. */

/* ── Execution prompt: 1 master prompt for a local AI agent (audit §Connect) ── */

/* ── Master execution prompt (1 prompt → all tasks) ──
 * The APPROVED revision of each planning artifact, and nothing else: a draft
 * or a stale revision is never handed to an agent as if it were binding (the
 * spec status section names it instead). */
async function approvedRevisionMarkdown(
  db: import("@sdd/db").SddDatabase,
  projectId: string,
  artifactType: "requirements" | "stack" | "design",
): Promise<{ version: number; content: string } | null> {
  const approved = await getApprovedRevision(db, projectId, artifactType);
  const content = approved?.revision.content?.trim();
  return approved && content ? { version: approved.revision.version, content } : null;
}

const REVIEW_NOTE: Record<string, string> = {
  HUMAN_REQUIRED: "needs a human reviewer",
  HUMAN_OR_APPROVED_REVIEWER: "AI reviewed in auto mode; every check and acceptance criterion must pass",
  AUTO_APPROVE_ALLOWED: "AI reviewed in auto mode; every check and acceptance criterion must pass",
};

/**
 * One master prompt for a local coding agent: set the workspace up once, then
 * work through every task with sddctl so the board follows along live.
 */
export async function generateExecutionPrompt(
  db: import("@sdd/db").SddDatabase,
  project: typeof schema.projects.$inferSelect,
  opts: { serverUrl: string; connect?: { code: string; expiresAt: Date; autoApprove: boolean } | null },
): Promise<string> {
  const tasks = await listTasks(db, project.id, { limit: 500 });
  const executable = tasks.filter((t) => t.workflowStatus !== "CANCELLED");
  const lines: string[] = [];

  for (const t of executable) {
    const contract = t.contract as TaskContract;
    const deps = await dependenciesOf(db, t.id);
    const depKeys = deps.map((d) => d.task.key).join(", ");
    const checks = (contract.verification?.required ?? []).map((r) =>
      r.type === "manual" ? `  (manual) ${r.command}` : `  $ ${r.command}`,
    );
    lines.push([
      `### ${t.key} — ${t.title}${t.workflowStatus === "DONE" ? " (already done — skip)" : ""}`,
      `Type: ${t.taskType} · Priority: ${t.priority} · Review: ${REVIEW_NOTE[t.reviewPolicy] ?? t.reviewPolicy}`,
      t.objective ? `Objective: ${t.objective}` : "",
      deps.length > 0 ? `Depends on: ${depKeys}` : "No dependencies",
      checks.length > 0 ? `Checks:\n${checks.join("\n")}` : "",
      (contract.scope?.expected_paths ?? []).length > 0 ? `Expected paths: ${(contract.scope?.expected_paths ?? []).join(", ")}` : "",
      (contract.scope?.forbidden_paths ?? []).length > 0 ? `Forbidden paths: ${(contract.scope?.forbidden_paths ?? []).join(", ")}` : "",
    ].filter(Boolean).join("\n"));
  }

  // Phase 0 inline docs, in reading order: PRD → Tech Stack → Technical Design. Approved only.
  const ux = await approvedUxReference(db, project.id);
  const uxVersion = ux ? (await getApprovedRevision(db, project.id, "ux"))?.revision.version : undefined;
  const ds = await approvedDesignSystem(db, project.id);
  const lib = ds ? findLibrary(ds.spec.component_library) : undefined;
  const prd = await approvedRevisionMarkdown(db, project.id, "requirements");
  const stack = await approvedRevisionMarkdown(db, project.id, "stack");
  const design = await approvedRevisionMarkdown(db, project.id, "design");
  // What is skipped, stale or unapproved, and tasks cut from an older version than the approved one.
  const states = await specStates(db, project.id);
  const kinds: SpecKind[] = ["requirements", "stack", "design", "ux", "design_system"];
  const specNotes = [
    ...kinds.map((k) => specStatusNote(k, states[k])).filter((n): n is string => n !== null),
    ...lineageNotes(await taskLineage(db, project.id, executable.filter((t) => t.workflowStatus !== "DONE"))),
  ];
  const specSections = [
    specNotes.length ? [`## Spec status (read first)`, ``, ...specNotes.map((n) => `- ${n}`), ``] : null,
    prd ? [`## Spec 1 — Product Requirements (approved, v${prd.version})`, ``, prd.content, ``] : null,
    stack ? [`## Spec 2 — Tech Stack (locked, v${stack.version})`, ``, stack.content, ``] : null,
    design ? [`## Spec 3 — Technical Design (approved, v${design.version})`, ``, design.content, ``] : null,
    ux
      ? [
          `## Spec 4 — UI Reference${uxVersion ? ` (v${uxVersion})` : ""}`,
          ``,
          ux.fidelity === "styled"
            ? `Mockups of the key screens drawn with the design system, pulled into \`docs/ui-reference/\` in Phase 1.`
            : `Neutral mid-fidelity mockups of the key screens, pulled into \`docs/ui-reference/\` in Phase 1.`,
          ux.fidelity === "styled"
            ? `Layout, elements, flow and look are binding.`
            : `Layout, elements and flow are binding; colours, fonts and component styling follow ${ds ? "the design system" : "the stack"}.`,
          ``,
          ...ux.screens.map((s) => `- \`${uxFilePath(s.key)}\` — **${s.name}**: ${s.purpose} (key elements: ${s.key_elements.join("; ")})${screenBehaviourLines(s).length ? `; behaviour to build and test: ${screenBehaviourLines(s).join("; ")}` : ""}`),
          ``,
          appShellLine(ux),
          ...templateAppearanceLines(ux),
          ...(renderCheckLine(ux) ? [``, renderCheckLine(ux)!] : []),
          ``,
        ]
      : null,
    ds
      ? [
          `## Spec ${ux ? 5 : 4} — Design system (v${ds.version})`,
          ``,
          `**${ds.spec.name}** built with **${lib?.name ?? ds.spec.component_library}**, pulled into \`${DESIGN_SYSTEM_DIR}/\` in Phase 1.`,
          `Read \`${DESIGN_SYSTEM_DIR}/DESIGN.md\` before any UI work. Set the library up with the theme file there,`,
          `use its components for every UI role, and take every colour, font, radius and shadow from the tokens. Template appearance overrides listed in Spec 4 replace this base palette for those screens; read their effective tokens from the UI Reference HTML.`,
          ...(lib?.install.length ? [``, `Setup: ${lib.install.map((i) => `${i.when}: \`${i.command}\``).join(" · ")}`] : []),
          ``,
          // Inline too, so the agent has the look before (or without) `sddctl ui pull`.
          ...designSystemEssentials(ds.spec, ds.version),
          ``,
        ]
      : null,
  ].filter((s): s is string[] => s !== null).flat();

  const key = project.key;
  const fence = "```";
  const install = installCommands(opts.serverUrl);
  const connect = opts.connect ?? null;
  const expiry = connect ? `${connect.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
  // Sign in + link: one command when the prompt carries a connect code.
  const signInAndLink = connect
    ? [
        `2. Create the project folder and a git repository, unless you are already inside one:`,
        `   ${fence}bash`,
        `   mkdir -p ${key.toLowerCase()} && cd ${key.toLowerCase()} && git init`,
        `   ${fence}`,
        `3. Connect it to the plan — this signs the CLI in and links the repository in one step,`,
        `   and keeps link metadata out of git:`,
        `   ${fence}bash`,
        `   sddctl connect ${connect.code} --server ${opts.serverUrl}`,
        `   echo ".sdd/" >> .gitignore`,
        `   ${fence}`,
        `   The code works once and until ${expiry}. If it is rejected but \`sddctl status\` shows this`,
        `   repository linked to ${key}, you are already connected — carry on. Otherwise stop and ask the`,
        `   user to copy a fresh prompt from the web app.`,
        connect.autoApprove
          ? `   Auto mode is on: submission sends the implementation diff, test logs and screenshots to the orchestrator reviewer. Approval requires proven acceptance coverage.`
          : `   Review follows the saved permission mode for this repository and machine. Reconnecting does not change it. AUTO_RUN automatically reviews eligible work; MANUAL waits for the user. Enable auto-approve on the specific connection in the web app.`,
        `   Tasks marked "needs a human reviewer" always wait for the user.`,
      ]
    : [
        `2. Sign in if needed: \`sddctl whoami\` — if it fails, run \`sddctl login --server ${opts.serverUrl}\``,
        `   and ask the user to approve the code in their browser.`,
        `3. Create the project folder and a git repository, unless you are already inside one:`,
        `   ${fence}bash`,
        `   mkdir -p ${key.toLowerCase()} && cd ${key.toLowerCase()} && git init`,
        `   ${fence}`,
        `4. Link it to the plan, and keep link metadata out of git:`,
        `   ${fence}bash`,
        `   sddctl project link ${key}`,
        `   echo ".sdd/" >> .gitignore`,
        `   ${fence}`,
        `   AI review can approve a task on submit only if a project admin switched`,
        `   auto-approve on for this repository in the web app. Tasks marked "needs a human reviewer"`,
        `   always wait for the user.`,
      ];
  let step = connect ? 4 : 5;
  return [
    `# SDD Execution Protocol — ${project.name} (${key})`,
    ``,
    `You are the coding agent for this project. A control plane (the SDD web app) owns the plan;`,
    `you build it task by task and report every step with the \`sddctl\` CLI, so the project's`,
    `board moves on its own: Ready → In progress → Done (or Review when a human must look).`,
    ``,
    `Work autonomously. Do not stop to ask the user unless a step below tells you to.`,
    ``,
    `## Phase 1 — Set up the workspace (once)`,
    ``,
    // The agent installs the CLI itself from this server: it used to stop and
    // ask the user to `bun link` it from a checkout of the SDD repository.
    `1. Make sure the CLI is available: \`sddctl --version\`. If it is missing, install it from this`,
    `   control plane (it needs Node.js 18+ or Bun):`,
    `   ${fence}bash`,
    `   ${install.sh}        # macOS, Linux, Git Bash`,
    `   ${fence}`,
    `   On Windows PowerShell: \`${install.ps1}\`.`,
    `   If \`sddctl\` is still not found afterwards, call it by the full path the installer printed`,
    `   (for example \`~/.sdd/bin/sddctl\`) in every command below. Stop and tell the user only if the`,
    `   installer says Node.js or Bun is missing.`,
    ...signInAndLink,
    ...(ux || ds
      ? [
          `${step++}. Pull the approved ${[ux ? "UI reference" : "", ds ? "design system" : ""].filter(Boolean).join(" and ")} into the repository and commit ${ux && ds ? "them" : "it"} with the boilerplate:`,
          `   ${fence}bash`,
          `   sddctl ui pull        # writes ${[ux ? "docs/ui-reference/*.html" : "", ds ? `${DESIGN_SYSTEM_DIR}/*` : ""].filter(Boolean).join(" and ")}`,
          `   ${fence}`,
          ...(ux
            ? [
                `   Open each mockup in a browser before building its screen and match its layout, elements and flow;`,
                ux.fidelity === "styled"
                  ? `   the mockups already use the design system, so match their look too.`
                  : `   take colours, fonts and component styles from ${ds ? "the design system" : "the stack"}, not from the grey mockup.`,
              ]
            : []),
          ...(ds ? [`   Set up ${lib?.name ?? "the component library"} with the theme in ${DESIGN_SYSTEM_DIR}/ in the first front-end task.`] : []),
          ...(ux && renderCheckLine(ux)
            ? [`   The render checks need Playwright and its browser: \`npx playwright install chromium\` (or your package runner's equivalent).`]
            : []),
        ]
      : []),
    `${step}. Read the specs below in order before writing code. Use the locked stack exactly —`,
    `   do not swap frameworks, databases or libraries. The first task normally creates the`,
    `   project boilerplate (skeleton, dependency file, test setup) for that stack; if no task`,
    `   does, create that minimal skeleton as part of the first task you claim.`,
    ``,
    ...specSections,
    `## Phase 2 — Work loop (repeat until done)`,
    ``,
    `1. Ask for the next task: \`sddctl task next\`. It prints the next claimable task, or:`,
    `   - \`ALL_DONE\` → go to Phase 3.`,
    `   - \`WAITING_FOR_REVIEW\` → stop and tell the user which tasks need their review in the web app.`,
    `   - \`BLOCKED\` / \`NOTHING_CLAIMABLE\` → stop and report what it says.`,
    `2. Read the contract: \`sddctl task context TASK-XXX\` (objective, acceptance criteria, paths, checks, stop conditions).`,
    `3. Claim and start it: \`sddctl task claim TASK-XXX\` then \`sddctl task start TASK-XXX\`.`,
    `   (The board now shows it In progress.)`,
    `4. Implement it. Stay inside the expected paths; never touch forbidden paths.`,
    `   Report notable progress: \`sddctl run progress --message "..."\`.`,
    `5. Run every check listed for the task. Report each one with its real result:`,
    `   ${fence}bash`,
    `   sddctl run test --command "<the exact check command>" --execute`,
    `   ${fence}`,
    `   If a check fails, fix the code and run it again. Never report a check you did not run.`,
    `   A "(manual)" check: do what it says as far as you can and report it with its outcome.`,
    ...(ux && renderCheckLine(ux)
      ? [
          `   A render check saves screenshots in \`${RENDER_SHOT_DIR}/\`: open each one next to the screen's`,
          `   mockup, fix what differs (missing elements, no shell around it, layout at 360 px), and commit them.`,
        ]
      : []),
    `6. Commit, then submit:`,
    `   ${fence}bash`,
    `   git add -A && git commit -m "TASK-XXX: <title>"`,
    `   sddctl task submit TASK-XXX --summary "<what you built and how the checks prove it>"`,
    `   ${fence}`,
    `   Read the returned status: DONE continues; READY means changes were requested, so fetch a fresh task prompt and fix the review findings; NEEDS_REVIEW requires a human decision.`,
    `7. If a stop condition is met or you are stuck: \`sddctl task block TASK-XXX --reason "..."\`,`,
    `   then continue with \`sddctl task next\`.`,
    `8. Found a defect outside the current task? \`sddctl bug report --title "..." --expected "..." --current "..." --repro "..."\``,
    ``,
    `## Phase 3 — Finish`,
    ``,
    `In AUTO_RUN, \`sddctl task next\` triggers release Convergence when the queue is empty.`,
    `On FIX_TASKS_READY run next again and complete the new tasks. RUNNING means retry shortly.`,
    `HUMAN_ACTION_REQUIRED means stop and report the stated blocker. Up to three repair rounds are allowed.`,
    `Only ALL_DONE after successful release review means the application is complete. Run the full suite and tell the user:`,
    `what was built, how to run it, and the actual release status shown in the`,
    `web app (Convergence).`,
    ``,
    `## Tasks in this plan (dependency order)`,
    ``,
    lines.join("\n\n"),
  ].join("\n");
}
