import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, API_URL, ApiError, rethrowKitError, sessionFrom } from "$lib/server/api.js";
import { setSessionCookie } from "$lib/server/session.js";

/**
 * Where to go after signing in. Only same-origin relative paths are honoured
 * ("/machines", "/cli/authorize?code=…"); anything that could leave the site —
 * "//evil.com", backslashes, "https://…", control characters — falls back to "/".
 */
function safeNext(value: FormDataEntryValue | string | null | undefined): string {
  if (typeof value !== "string") return "/";
  const next = value.trim();
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  // Never bounce back to the sign-in page itself.
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return "/";
  return next;
}

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
  const session = sessionFrom(cookies);
  const next = safeNext(url.searchParams.get("next"));
  try {
    const status = await api<{ needs_bootstrap: boolean; authenticated: boolean }>(fetch, session, "GET", "/api/v1/auth/status");
    if (status.authenticated) redirect(303, next);
    return { needsBootstrap: status.needs_bootstrap, next };
  } catch (error) {
    rethrowKitError(error); // the "already signed in" redirect above
    return { needsBootstrap: false, next };
  }
};

/**
 * The API rate-limits auth per client IP. Every browser login reaches it from
 * this server's address, so without the real client IP all users would share
 * one bucket and a single attacker could lock everybody out. The API only
 * honours this header when SDD_TRUST_PROXY=true (production compose), and
 * adapter-node resolves getClientAddress() from ADDRESS_HEADER/XFF_DEPTH.
 */
function forwardedFor(getClientAddress: () => string): Record<string, string> {
  try {
    return { "x-forwarded-for": getClientAddress() };
  } catch {
    return {};
  }
}

export const actions: Actions = {
  bootstrap: async ({ request, fetch, cookies, getClientAddress }) => {
    const form = await request.formData();
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const workspace = String(form.get("workspace") ?? "");
    const next = safeNext(form.get("next"));
    try {
      // Create the operator + workspace, then establish a real session.
      await api<{ user: { id: string } }>(fetch, sessionFrom(cookies), "POST", "/api/v1/auth/bootstrap", {
        body: { email, password, workspace_name: workspace || undefined },
        headers: forwardedFor(getClientAddress),
      });
      const login = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", ...forwardedFor(getClientAddress) },
        body: JSON.stringify({ email, password }),
      });
      const setCookie = login.headers.get("set-cookie") ?? "";
      const token = login.ok ? /sdd_session=([^;]+)/.exec(setCookie)?.[1] : undefined;
      // The account exists now, but without a session the redirect would only
      // bounce back here with no explanation: say so, and offer plain sign-in.
      if (!token) {
        return fail(502, {
          message: "Your account was created, but signing in failed. Sign in with the same email and password.",
          mode: "login",
        });
      }
      setSessionCookie(cookies, decodeURIComponent(token));
      redirect(303, next);
    } catch (error) {
      rethrowKitError(error); // redirect
      if (error instanceof ApiError) return fail(error.status, { message: error.message, mode: "bootstrap" });
      return fail(500, { message: "Bootstrap failed — is the API running?", mode: "bootstrap" });
    }
  },

  login: async ({ request, fetch, cookies, getClientAddress }) => {
    const form = await request.formData();
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const next = safeNext(form.get("next"));
    try {
      const login = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", ...forwardedFor(getClientAddress) },
        body: JSON.stringify({ email, password }),
      });
      if (!login.ok) {
        const payload = (await login.json()) as { error?: { message?: string } };
        return fail(login.status, { message: payload.error?.message ?? "Login failed", mode: "login" });
      }
      const setCookie = login.headers.get("set-cookie") ?? "";
      const token = /sdd_session=([^;]+)/.exec(setCookie)?.[1];
      if (!token) return fail(500, { message: "No session returned", mode: "login" });
      setSessionCookie(cookies, decodeURIComponent(token));
      redirect(303, next);
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message, mode: "login" });
      return fail(500, { message: "Login failed — is the API running?", mode: "login" });
    }
  },
};
