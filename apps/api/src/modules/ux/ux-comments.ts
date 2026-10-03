import { randomUUID } from "node:crypto";
import type { DbExecutor } from "@sdd/db";
import type { UxComment } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { assembleScreen, ensureNodeIds, isFramed, screenContent } from "./ux-shell.js";
import { currentDraft, editableScreen, mutateDraft, shellOf } from "./ux-draft.js";

/** Review comments pinned to elements of a draft screen. */

/**
 * Pin a comment to one element. A screen stored before elements had ids gets
 * them now; numbering is deterministic, so they match what the canvas showed.
 */
export async function addUxComment(
  db: DbExecutor,
  input: { projectId: string; screenKey: string; nid: string; anchor: string; text: string; userId: string },
) {
  const { draft } = await currentDraft(db, input.projectId);
  const shell = await shellOf(db, input.projectId);
  const comment: UxComment = {
    id: randomUUID(),
    nid: input.nid,
    anchor: input.anchor.slice(0, 160),
    text: input.text.trim().slice(0, 2000),
    author_id: input.userId,
    created_at: new Date().toISOString(),
    resolved_at: null,
  };
  if (!comment.text) throw errors.validation("A comment needs text");
  const revision = await mutateDraft(db, draft.id, (current) => {
    const screen = editableScreen(current, input.screenKey);
    let html = screen.html!;
    if (isFramed(html) && !html.includes("data-nid=")) {
      html = assembleScreen({ content: ensureNodeIds(screenContent(html)), spec: shell.spec(current, screen.key), brand: shell.brand, screens: current.screens, currentKey: screen.key, shell: current.shell, platform: current.platform, generator: current.generator });
    }
    if (!html.includes(`data-nid="${input.nid}"`)) throw errors.notFound("Element", input.nid);
    return { ...current, screens: current.screens.map((s) => (s.key === screen.key ? { ...s, html, comments: [...(s.comments ?? []), comment] } : s)) };
  });
  return { revision, comment };
}

/** Resolve or reopen a comment, or delete it. */
export async function updateUxComment(
  db: DbExecutor,
  input: { projectId: string; screenKey: string; commentId: string; action: "resolve" | "reopen" | "delete" },
) {
  const { draft } = await currentDraft(db, input.projectId);
  const revision = await mutateDraft(db, draft.id, (current) => {
    const screen = editableScreen(current, input.screenKey);
    if (!(screen.comments ?? []).some((c) => c.id === input.commentId)) throw errors.notFound("Comment", input.commentId);
    const comments = (screen.comments ?? [])
      .filter((c) => input.action !== "delete" || c.id !== input.commentId)
      .map((c) => (c.id === input.commentId ? { ...c, resolved_at: input.action === "resolve" ? new Date().toISOString() : null } : c));
    return { ...current, screens: current.screens.map((s) => (s.key === screen.key ? { ...s, comments } : s)) };
  });
  return { revision };
}
