import { redirect, type Handle } from "@sveltejs/kit";
import { SESSION_COOKIE } from "$lib/server/session.js";

/**
 * Pages anyone may open. Everything else needs a session: without one, a
 * page goes to the sign-in page (and comes back afterwards via ?next=), and a
 * same-origin endpoint under /api answers 401 instead of an HTML redirect.
 * Only the cookie's presence is checked here; an expired or revoked session
 * is still caught by the API's 401 (throwLoadError sends that to /login).
 */
const PUBLIC_PATHS = ["/login", "/cli/authorize", "/healthz", "/logout"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) || pathname.startsWith("/_app/");
}

/** Production security headers (T200, docs/13 §3). The reverse proxy may
 * additionally send HSTS. Pages get their Content-Security-Policy from
 * SvelteKit (kit.csp in svelte.config.js), which adds a per-request nonce for
 * its own hydration script and the theme script in app.html, so script-src no
 * longer needs 'unsafe-inline'. Responses SvelteKit does not render (+server
 * endpoints) get the same policy here. */
const FALLBACK_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const handle: Handle = async ({ event, resolve }) => {
  if (!event.cookies.get(SESSION_COOKIE) && !isPublic(event.url.pathname)) {
    if (event.url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Sign in first." } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    // Thrown (not returned) so SvelteKit answers data and form-action
    // requests with its JSON redirect instead of an HTML 303.
    const back = event.request.method === "GET" && event.url.pathname !== "/" ? event.url.pathname + event.url.search : "";
    redirect(303, back ? `/login?next=${encodeURIComponent(back)}` : "/login");
  }

  const response = await resolve(event);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("x-frame-options", "DENY");
  if (!response.headers.has("content-security-policy")) {
    response.headers.set("content-security-policy", FALLBACK_CSP);
  }
  if (import.meta.env.PROD) {
    response.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return response;
};
