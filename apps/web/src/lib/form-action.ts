import { deserialize } from "$app/forms";

/**
 * POST a SvelteKit form action from script and read its result. A dropped
 * connection, a proxy's HTML error page or a redirect (signed out) all end
 * here as an error message instead of an exception that would leave a
 * spinner running.
 */
export async function postFormAction<T extends Record<string, unknown> = Record<string, unknown>>(
  action: string,
  body: FormData,
): Promise<{ ok: boolean; data: T & { message?: string }; message: string | null }> {
  type Payload = { type: string; data?: T & { message?: string }; error?: { message?: string } };
  try {
    const res = await fetch(action, { method: "POST", headers: { accept: "application/json" }, body });
    const payload = deserialize(await res.text()) as Payload;
    if (payload.type === "success") return { ok: true, data: payload.data ?? ({} as T), message: null };
    if (payload.type === "redirect") return { ok: false, data: {} as T, message: "Your session ended — reload the page and sign in again." };
    const message = payload.data?.message ?? payload.error?.message ?? null;
    return { ok: false, data: {} as T, message: message ?? `The request failed (${res.status}). Try again.` };
  } catch {
    return { ok: false, data: {} as T, message: "Could not reach the server. Check your connection and try again." };
  }
}
