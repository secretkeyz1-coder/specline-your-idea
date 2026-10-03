import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { API_URL, ApiError, assertSafeApiPath, sessionFrom, userFacingMessage } from "$lib/server/api.js";
import { SESSION_COOKIE } from "$lib/server/session.js";

/**
 * Draw one screen with a live preview: the API's server-sent events (the
 * screen's frame, its sanitized content so far, the checking phase, then
 * done or error) are passed through as they come. A refusal before the stream
 * opens (access, rate limit, no provider) answers as JSON with its status.
 */
export const POST: RequestHandler = async ({ request, fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  if (!session.token) return json({ message: "Sign in again to continue." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { instruction?: unknown };
  const instruction = typeof body.instruction === "string" ? body.instruction.slice(0, 2000) : undefined;
  const path = `/api/v1/projects/${params.projectId}/ux/screens/${encodeURIComponent(params.screenKey)}/generate-stream`;
  let upstream: Response;
  try {
    assertSafeApiPath(path);
    upstream = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${session.token}` },
      body: JSON.stringify(instruction ? { instruction } : {}),
      signal: request.signal,
    });
  } catch (e) {
    if (e instanceof ApiError) return json({ message: e.message, code: e.code }, { status: e.status });
    return json({ message: "The connection to the server dropped. Try again." }, { status: 502 });
  }
  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !upstream.body || !type.includes("text/event-stream")) {
    const payload = (await upstream.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const message = payload?.error?.message ? userFacingMessage(payload.error.message) : "The screen could not be generated. Try again.";
    return json({ message, code: payload?.error?.code }, { status: upstream.ok ? 502 : upstream.status });
  }
  return new Response(upstream.body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
  });
};
