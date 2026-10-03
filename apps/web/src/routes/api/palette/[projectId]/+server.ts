import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { api, ApiError, sessionFrom, type Session } from "$lib/server/api.js";

/**
 * Compact search index for the command palette: tasks, requirements, bugs and
 * UI reference screens of one project. Each source degrades to an empty list
 * on failure so one broken section never empties the whole palette — but when
 * every source failed (API down, session expired) the answer is an error, not
 * an empty index the palette would keep and show as "nothing matches".
 */

export interface PaletteIndex {
  tasks: Array<{ id: string; key: string; title: string }>;
  requirements: Array<{ key: string; title: string }>;
  bugs: Array<{ id: string; key: string; title: string }>;
  screens: Array<{ key: string; name: string }>;
}

type Fetch = typeof fetch;

async function safe<T>(fetch: Fetch, session: Session, path: string, failures: number[]): Promise<T | null> {
  try {
    return await api<T>(fetch, session, "GET", path);
  } catch (error) {
    failures.push(error instanceof ApiError ? error.status : 502);
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const GET: RequestHandler = async ({ fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  if (!session.token) return json({ error: "Unauthorized" }, { status: 401 });

  const pid = encodeURIComponent(params.projectId);
  const base = `/api/v1/projects/${pid}`;

  const failures: number[] = [];
  const [tasksRes, reqRes, bugsRes, uxRes] = await Promise.all([
    safe<{ tasks?: Array<Record<string, unknown>> }>(fetch, session, `${base}/tasks?limit=500`, failures),
    safe<{ requirements?: Array<Record<string, unknown>> }>(fetch, session, `${base}/requirements`, failures),
    safe<{ bugs?: Array<Record<string, unknown>> }>(fetch, session, `${base}/bugs`, failures),
    safe<{
      approved?: { reference?: { screens?: Array<Record<string, unknown>> } } | null;
      draft?: { reference?: { screens?: Array<Record<string, unknown>> } } | null;
    }>(fetch, session, `${base}/ux`, failures),
  ]);
  if (failures.length === 4) {
    // Keep a real 401/403/404 (the palette just shows no project results);
    // anything else is the API being unreachable or broken.
    const status = failures.find((s) => s === 401 || s === 403 || s === 404) ?? 502;
    return json({ error: "The search index could not be loaded." }, { status, headers: { "cache-control": "private, no-store" } });
  }

  const index: PaletteIndex = {
    tasks: (tasksRes?.tasks ?? [])
      .map((t) => ({ id: str(t.id), key: str(t.key), title: str(t.title) }))
      .filter((t) => t.id && (t.key || t.title)),
    requirements: (reqRes?.requirements ?? [])
      .map((r) => ({ key: str(r.key), title: str(r.title) || str(r.statement) }))
      .filter((r) => r.key || r.title),
    bugs: (bugsRes?.bugs ?? [])
      .map((b) => ({ id: str(b.id), key: str(b.key), title: str(b.title) }))
      .filter((b) => b.id && (b.key || b.title)),
    screens: ((uxRes?.approved ?? uxRes?.draft)?.reference?.screens ?? [])
      .map((s) => ({ key: str(s.key), name: str(s.name) || str(s.key) }))
      .filter((s) => s.name),
  };

  return json(index, { headers: { "cache-control": "private, no-store" } });
};
