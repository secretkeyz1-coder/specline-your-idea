import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom } from "$lib/server/api.js";

/**
 * `sddctl login` shows a code like "ABCD-2345" (packages/auth createUserCode)
 * and opens this page with it. Typed codes are normalised the same way: upper
 * case, spaces dropped, the dash added back if it was left out.
 */
function normalizeCode(raw: FormDataEntryValue | string | null | undefined): string {
  if (typeof raw !== "string") return "";
  const compact = raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  return /^[A-Z0-9]{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

const CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export const load: PageServerLoad = async ({ cookies, url }) => {
  const session = sessionFrom(cookies);
  return { code: normalizeCode(url.searchParams.get("code")), authenticated: Boolean(session.token) };
};

export const actions: Actions = {
  approve: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    if (!session.token) return fail(401, { message: "Sign in first" });
    const form = await request.formData();
    const code = normalizeCode(form.get("code"));
    if (!CODE_PATTERN.test(code)) return fail(400, { message: "Enter the code shown in your terminal, like ABCD-2345.", code });
    try {
      await api(fetch, session, "POST", "/api/v1/auth/cli/approve", { body: { user_code: code } });
      return { ok: true, notice: "CLI authorized — return to your terminal." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message, code });
      return fail(500, { message: "Approval failed — the code may have expired.", code });
    }
  },

  deny: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    if (!session.token) return fail(401, { message: "Sign in first" });
    const form = await request.formData();
    const code = normalizeCode(form.get("code"));
    if (!CODE_PATTERN.test(code)) return fail(400, { message: "Enter the code shown in your terminal, like ABCD-2345.", code });
    try {
      await api(fetch, session, "POST", "/api/v1/auth/cli/deny", { body: { user_code: code } });
    } catch (error) {
      rethrowKitError(error);
      // Never claim "Denied" when the request did not go through.
      if (error instanceof ApiError) return fail(error.status, { message: error.message, code });
      return fail(500, { message: "Could not deny the request — try again.", code });
    }
    return { ok: true, notice: "Denied. You can close this page." };
  },
};
