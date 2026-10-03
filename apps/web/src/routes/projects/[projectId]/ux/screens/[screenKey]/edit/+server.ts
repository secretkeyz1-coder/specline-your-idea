import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { api, ApiError, sessionFrom } from "$lib/server/api.js";
import type { UxVisualReview } from "$lib/types.js";

/**
 * Canvas edits of one screen, as JSON: save edited content, undo, restore an earlier version, check again, clear the drawing, change one element with AI, a person's visual review, and comments
 * pinned to elements. The canvas stays on the page while these run, so they
 * are fetch calls rather than form actions.
 *
 * Saves, undo and restore carry `base`, the screen version the canvas edited
 * (screenBase in $lib/ux.ts); a screen changed since answers 409
 * UX_SCREEN_CHANGED, passed through with its code so the canvas reloads.
 */
type EditBody =
  | { op: "content"; content: string; note?: string; base?: string }
  | { op: "undo"; base?: string }
  | { op: "restore"; index?: number; at?: string; base?: string }
  | { op: "check" }
  | { op: "clear"; base?: string }
  | { op: "element"; nid: string; instruction: string }
  | { op: "comment"; nid: string; anchor?: string; text: string }
  | { op: "comment-update"; commentId: string; action: "resolve" | "reopen" | "delete" }
  | { op: "review"; aspects: UxVisualReview["aspects"]; base?: string };

export const POST: RequestHandler = async ({ request, fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  if (!session.token) return json({ message: "Sign in again to continue." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as EditBody | null;
  const base = `/api/v1/projects/${params.projectId}/ux/screens/${encodeURIComponent(params.screenKey)}`;
  try {
    switch (body?.op) {
      case "content":
        return json(await api(fetch, session, "POST", `${base}/content`, { body: { content: body.content, note: body.note, base: body.base } }));
      case "undo":
        return json(await api(fetch, session, "POST", `${base}/undo`, { body: { base: body.base } }));
      case "restore":
        return json(await api(fetch, session, "POST", `${base}/restore`, { body: { index: body.index, at: body.at, base: body.base } }));
      case "check":
        return json(await api(fetch, session, "POST", `${base}/check`));
      case "clear":
        return json(await api(fetch, session, "POST", `${base}/clear`, { body: { base: body.base } }));
      case "element":
        return json(await api(fetch, session, "POST", `${base}/element`, { body: { nid: body.nid, instruction: body.instruction } }));
      case "comment":
        return json(await api(fetch, session, "POST", `${base}/comments`, { body: { nid: body.nid, anchor: body.anchor, text: body.text } }));
      case "comment-update":
        return json(await api(fetch, session, "POST", `${base}/comments/${encodeURIComponent(body.commentId)}`, { body: { action: body.action } }));
      case "review":
        return json(await api(fetch, session, "PUT", `${base}/review`, { body: { aspects: body.aspects, base: body.base } }));
      default:
        return json({ message: "Unknown edit." }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof ApiError) return json({ message: e.message, code: e.code }, { status: e.status });
    return json({ message: "The change could not be saved. Try again." }, { status: 500 });
  }
};
