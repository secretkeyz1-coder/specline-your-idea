import { env } from "$env/dynamic/private";
import type { Cookies } from "@sveltejs/kit";

export const SESSION_COOKIE = "sdd_session";

export function setSessionCookie(cookies: Cookies, token: string): void {
  cookies.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    // TLS-terminated deployments: the browser only ever sees the https origin.
    secure: env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.set(SESSION_COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
}
