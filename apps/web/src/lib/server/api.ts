import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { env } from "$env/dynamic/private";
import { error, redirect } from "@sveltejs/kit";
import { SESSION_COOKIE } from "./session.js";
import { isSafeApiPath } from "./ids.js";

/** Server-side API bridge. The browser never talks to the API directly; page
 * loads and form actions proxy through here with the session cookie attached. */

/**
 * Canonical env var is `API_PUBLIC_URL`.
 *
 * `PUBLIC_`-prefixed names are deliberately EXCLUDED from `$env/dynamic/private`
 * by SvelteKit's publicPrefix rule (see @sveltejs/kit `filter_env`), so a var
 * literally named `PUBLIC_API_URL` can never be read from `env` here — it would
 * silently fall through to the default. Reading it from `process.env` as a last
 * resort keeps any deployment that set the old (inert) name working.
 */
export const API_URL =
  env.API_PUBLIC_URL ?? process.env.API_PUBLIC_URL ?? process.env.PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details: unknown = null,
  ) {
    super(message);
  }
}

export interface Session {
  token: string | null;
}

export function sessionFrom(cookies: { get(name: string, ...rest: unknown[]): string | undefined }): Session {
  return { token: cookies.get(SESSION_COOKIE) ?? null };
}

/**
 * Route-load helper: re-throw SvelteKit's own `error()`/`redirect()` results
 * (they carry `status` + `location`/`body`) while letting API failures fall
 * through to the caller's own handling.
 *
 * Every `+page.server.ts` previously inlined this identical shape-test, so a
 * change to SvelteKit's error internals had to be applied in ~30 places.
 */
export function isKitControlFlow(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    ("location" in error || "body" in error)
  );
}

/** Re-throw framework control flow; returns normally for genuine API errors. */
export function rethrowKitError(error: unknown): void {
  if (isKitControlFlow(error)) throw error;
}

/**
 * Page-load error mapping. Loads used to collapse every API failure into
 * "Project not found" (404) or a generic 500; instead:
 *  - 401 → back to /login (the session expired or was revoked);
 *  - other API statuses keep their real status and message (404 stays 404);
 *  - transport failures become 502 "API unreachable".
 */
export function throwLoadError(e: unknown): never {
  rethrowKitError(e);
  if (e instanceof ApiError) {
    if (e.status === 401) redirect(303, "/login");
    error(e.status >= 400 && e.status < 600 ? e.status : 502, e.message);
  }
  error(502, "The API is unreachable — try again shortly.");
}

/**
 * API messages carry spec cross-references for developers ("(C7)", "(FR-036)",
 * "docs/12 §4"). They mean nothing to users, so they are stripped before a
 * message reaches the page. The error code itself is kept on ApiError.
 */
export function userFacingMessage(message: string): string {
  const pieces: string[] = [];
  let copied = 0;
  let search = 0;
  while (search < message.length) {
    const open = message.indexOf("(", search);
    if (open < 0) break;
    // A failed reference stops before a nested opening parenthesis. Successful
    // docs/ references consume to the next closing parenthesis exactly once.
    let offset = open + 1;
    let valid = false;
    for (;;) {
      if (message.startsWith("docs/", offset)) {
        const close = message.indexOf(")", offset + 5);
        if (close < 0) { search = message.length; break; }
        offset = close;
        valid = true;
        break;
      }
      const reference = /[A-Z]{1,3}-?\d+[a-z]?/y;
      reference.lastIndex = offset;
      if (!reference.exec(message)) break;
      offset = reference.lastIndex;
      if (message[offset] === ")") { valid = true; break; }
      while (offset < message.length && /\s/.test(message[offset]!)) offset++;
      if (message[offset] !== "/" && message[offset] !== ",") break;
      offset++;
      while (offset < message.length && /\s/.test(message[offset]!)) offset++;
    }
    if (valid) {
      let start = open;
      while (start > copied && /\s/.test(message[start - 1]!)) start--;
      pieces.push(message.slice(copied, start));
      copied = offset + 1;
      search = copied;
    } else {
      search = Math.max(search, offset, open + 1);
    }
  }
  pieces.push(message.slice(copied));
  return pieces.join("").replace(/\s{2,}/g, " ").trim();
}

type Fetch = typeof fetch;

/**
 * AI generation answers in one response that can take several minutes on a
 * slow model. `fetch` (undici on Node, and Bun's) gives up waiting for the
 * response headers after 300s, so these calls go over plain node:http, which
 * waits as long as the API does. The API still bounds them: the provider's
 * idle limit and a total cap (packages/ai `guardedFetch`).
 * Keep in step with AI_GENERATION_PATH in apps/api/src/index.ts.
 */
const AI_GENERATION_PATH =
  /\/(discovery\/next|artifacts\/[a-z_]+\/(generate|refine)|design\/generate|design\/[^/]+\/refine|stack\/(recommend|validate)|tasks\/generate|convergence-runs|generate-fix-tasks|ux\/plan|design-system\/import|ux\/layout-reference\/analyse|ux\/screens\/[^/]+\/generate(?:-stream)?)$/;

function longPost(url: string, headers: Record<string, string>, body: string | undefined): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      target,
      { method: "POST", headers: { ...headers, ...(body !== undefined ? { "content-length": String(Buffer.byteLength(body)) } : {}) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 502, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/**
 * Last line of defence for values interpolated into API paths: route params
 * are percent-decoded by SvelteKit, so "/projects/..%2Fworkspaces" would
 * otherwise reach the API as a dot-segment the URL parser resolves to another
 * endpoint (with the user's session). Form ids are checked where they are read
 * (lib/server/ids.ts); this refuses anything that slipped through.
 */
export function assertSafeApiPath(path: string): void {
  if (!isSafeApiPath(path)) throw new ApiError("BAD_PATH", "That address is not valid.", 400);
}

export async function api<T = unknown>(
  fetch: Fetch,
  session: Session,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  assertSafeApiPath(path);
  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(session.token ? { cookie: `${SESSION_COOKIE}=${session.token}` } : {}),
    ...options.headers,
  };
  const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  let status: number;
  let text: string;
  if (method === "POST" && AI_GENERATION_PATH.test(path)) {
    try {
      ({ status, text } = await longPost(`${API_URL}${path}`, headers, body));
    } catch {
      throw new ApiError("API_UNREACHABLE", "The connection to the server dropped while the AI was working. Try again.", 502);
    }
  } else {
    const response = await fetch(`${API_URL}${path}`, { method, headers, body });
    status = response.status;
    text = await response.text();
  }
  const ok = status >= 200 && status < 300;
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      err?.code ?? `HTTP_${status}`,
      err?.message ? userFacingMessage(err.message) : `The request failed (${status}). Try again.`,
      status,
      err?.details,
    );
  }
  return payload as T;
}

/** Open the upstream project event stream; throws ApiError (with the real
 * status) when the API refuses it, so the proxy can answer with that status. */
export async function openSse(fetch: Fetch, session: Session, projectId: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const path = `/api/v1/projects/${encodeURIComponent(projectId)}/events`;
  assertSafeApiPath(path);
  const response = await fetch(`${API_URL}${path}`, {
    headers: session.token ? { cookie: `${SESSION_COOKIE}=${session.token}` } : {},
    signal,
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new ApiError(`HTTP_${response.status}`, detail.slice(0, 200) || `Event stream failed (${response.status})`, response.status || 502);
  }
  return response.body;
}
