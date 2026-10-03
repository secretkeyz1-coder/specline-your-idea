import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { api, ApiError, sessionFrom } from "$lib/server/api.js";
import type { UxVisualBrief } from "$lib/types.js";

/**
 * The product brief, as JSON (the canvas stays on the page): the person's
 * rewrite of the plan's brief, stored on the draft. The next draws, redraws
 * and AI edits use it; drawings already made are not redrawn.
 */
type BriefBody = { brief: Omit<UxVisualBrief, "source">; base?: string };

const FIELDS = ["users", "devices", "direction", "hierarchy", "references"] as const;

export const PUT: RequestHandler = async ({ request, fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  if (!session.token) return json({ message: "Sign in again to continue." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as BriefBody | null;
  if (!body?.brief || typeof body.brief !== "object") return json({ message: "Nothing to save." }, { status: 400 });
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const brief = {
    ...Object.fromEntries(FIELDS.map((k) => [k, text(body.brief[k])])),
    assumptions: Array.isArray(body.brief.assumptions) ? body.brief.assumptions.map(text).filter(Boolean).slice(0, 8) : [],
    source: "user" as const,
  };
  try {
    return json(
      await api(fetch, session, "PUT", `/api/v1/projects/${params.projectId}/ux/brief`, {
        body: { brief, ...(body.base ? { base: body.base } : {}) },
      }),
    );
  } catch (e) {
    if (e instanceof ApiError) return json({ message: e.message, code: e.code }, { status: e.status });
    return json({ message: "The brief could not be saved. Try again." }, { status: 500 });
  }
};
