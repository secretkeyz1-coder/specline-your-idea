import type { DbExecutor } from "@sdd/db";
import type { TaskContract, UxReference } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { renderCheckCommand, screenFilesOf, SHELL_TITLE } from "./lint.js";
import { RENDER_SHOT_DIR, RENDER_TEST_DIR } from "./generation.js";
import { getTask, type TaskRow } from "./repo.js";
import { updateDraftTask } from "./drafts.js";
import { computeTaskReadiness } from "./readiness.js";
import { uxFilePath } from "../ux/ux.js";
import { isAuthScreen } from "../ux/ux-od-seeds.js";

/**
 * What a person checks before approving a task that builds a screen (docs/28
 * R7). FiberOptik's screen tasks were approved by policy on jsdom tests alone,
 * and the five a person reviewed had nothing to compare them with — so nobody
 * ever looked at a screen.
 */
export interface ScreenReview {
  screens: Array<{ file: string; name: string; key_elements: string[]; inside_shell: boolean }>;
  /** Web screens need a render check; native ones have no browser route to open. */
  render_check: { required: boolean; command: string | null };
  /** Where the render check leaves its screenshots, next to the mockups. */
  screenshots_dir: string | null;
}

export function screenReviewOf(contract: Pick<TaskContract, "constraints" | "verification"> & Partial<Pick<TaskContract, "title" | "ui_screen_keys">> | null | undefined, ux: UxReference | null): ScreenReview | null {
  const files = screenFilesOf(contract);
  if (!files.length && contract?.title && SHELL_TITLE.test(contract.title) && ux) {
    const representative = ux.screens.find(s => !isAuthScreen(s));
    if (representative) files.push(uxFilePath(representative.key));
  }
  if (!files.length || !ux) return null;
  const byFile = new Map(ux.screens.map((s) => [uxFilePath(s.key), s]));
  const web = ux.platform?.kind !== "native-mobile";
  return {
    screens: files.map((file) => {
      const s = byFile.get(file);
      return { file, name: s?.name ?? file, key_elements: s?.key_elements ?? [], inside_shell: s ? !isAuthScreen(s) : true };
    }),
    render_check: { required: web, command: renderCheckCommand(contract) },
    screenshots_dir: web ? RENDER_SHOT_DIR : null,
  };
}

/** The package runner the task's other checks already use, so the render check runs the same way. */
function runnerOf(contract: Pick<TaskContract, "verification">): string {
  const commands = (contract.verification?.required ?? []).filter((r) => r.type !== "manual").map((r) => r.command.trim());
  if (commands.some((c) => /^(bun|bunx)\b/.test(c))) return "bunx";
  if (commands.some((c) => /^pnpm\b/.test(c))) return "pnpm exec";
  if (commands.some((c) => /^yarn\b/.test(c))) return "yarn";
  return "npx";
}

/**
 * The contract with the standard render check added: one Playwright command
 * for the task's screens, and automated_tests among its deliverables. Null
 * when the task builds no screen or already has one. A task whose six checks
 * are all taken cannot take another — the person edits it instead.
 */
export function withRenderCheck(contract: TaskContract): Pick<TaskContract, "verification" | "deliverables"> | null {
  const files = screenFilesOf(contract);
  if (!files.length || renderCheckCommand(contract)) return null;
  const required = contract.verification?.required ?? [];
  if (required.length >= 6) {
    throw errors.conflict("TASK_CHECKS_FULL", "This task already has six checks; remove one before adding the render check");
  }
  const specs = files.map((f) => `${RENDER_TEST_DIR}/${f.replace(/^.*\//, "").replace(/\.html$/, "")}.spec.ts`);
  const deliverables = contract.deliverables.includes("automated_tests") ? contract.deliverables : [...contract.deliverables, "automated_tests" as const].slice(0, 6);
  return {
    verification: { ...contract.verification, required: [...required, { type: "command", command: `${runnerOf(contract)} playwright test ${specs.join(" ")}` }] },
    deliverables,
  };
}

/**
 * Add the render check to a DRAFT screen task, then re-check its readiness.
 * Lint keeps a screen task without one out of READY, and the draft editor
 * only edits the title and objective — without this, such a task was stuck.
 */
export async function addRenderCheck(db: DbExecutor, input: { taskId: string; userId: string }): Promise<TaskRow> {
  const task = await getTask(db, input.taskId);
  if (!screenFilesOf(task.contract).length) {
    throw errors.conflict("NOT_A_SCREEN_TASK", "This task builds no screen of the UI reference, so it needs no render check");
  }
  const patch = withRenderCheck(task.contract);
  const updated = patch ? await updateDraftTask(db, { taskId: task.id, userId: input.userId, patch }) : task;
  return computeTaskReadiness(db, updated);
}

/**
 * Why the review policy must not approve a submission on its own: a web
 * screen with no render check has passed nothing that shows the screen. Null
 * when the policy may approve. Submitting already requires every required
 * check to pass, so a screen task WITH a render check has passed it.
 */
export function autoApproveWithheld(contract: Pick<TaskContract, "constraints" | "verification"> | null | undefined, ux: UxReference | null): string | null {
  const review = screenReviewOf(contract, ux);
  if (review?.render_check.required && !review.render_check.command) {
    return "this task builds a screen but has no render check, so a person has to look at it";
  }
  return null;
}
