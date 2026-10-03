/**
 * Ids that come from a form (hidden inputs, selects) are user-controlled: a
 * crafted value like "../../workspaces/x" would otherwise be interpolated
 * straight into an API path. Every record id in the API is a UUID, so a
 * form id is checked against that shape and, like any other value placed in
 * a path, percent-encoded as one segment.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The named form field when it is a UUID, else null (the caller answers 400). */
export function formUuid(form: FormData, name: string): string | null {
  const value = form.get(name);
  return isUuid(value) ? value : null;
}

/** One path segment, encoded — for any value that is not already a checked UUID. */
export function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * False for a path the URL parser would resolve somewhere else: a "." or ".."
 * segment (also as "%2e", which the parser decodes), a backslash (treated as
 * "/"), or control characters. The query string is not checked.
 */
export function isSafeApiPath(path: string): boolean {
  const pathname = (path.split("?")[0] ?? "").replace(/%2e/gi, ".");
  if (pathname.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  return !/(^|\/)\.{1,2}(\/|$)/.test(pathname);
}

/** The planning roles a model can be bound to (the API's AiRole enum). */
export const AI_ROLES = ["DISCOVERY", "SPECIFICATION", "ARCHITECTURE", "TASK_DECOMPOSITION", "REVIEW", "CONVERGENCE"] as const;
export type AiRole = (typeof AI_ROLES)[number];

export function isAiRole(value: unknown): value is AiRole {
  return typeof value === "string" && (AI_ROLES as readonly string[]).includes(value);
}

/** The message for a form whose id field is missing or malformed. */
export const BAD_ID = "That link is out of date — reload the page and try again.";
