import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { api, sessionFrom } from "$lib/server/api.js";
import { clearSessionCookie } from "$lib/server/session.js";

export const POST: RequestHandler = async ({ fetch, cookies }) => {
  const session = sessionFrom(cookies);
  await api(fetch, session, "POST", "/api/v1/auth/logout").catch(() => undefined);
  clearSessionCookie(cookies);
  redirect(303, "/login");
};
