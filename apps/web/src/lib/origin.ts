/**
 * A saved provider key belongs to the host it was entered for. When a
 * connection's base URL moves to another origin (or to/from the provider's
 * default endpoint, which an empty base URL means), the stored key must not
 * be sent to the new host, so a new key is required. Shared by the edit
 * dialog (to mark the key field required) and the form action (to refuse).
 */
export function originOf(url: string): string | null {
  try {
    return new URL(url.trim()).origin;
  } catch {
    return null;
  }
}

export function baseUrlOriginChanged(before: string | null | undefined, after: string | null | undefined): boolean {
  const a = (before ?? "").trim();
  const b = (after ?? "").trim();
  if (a === b) return false;
  return originOf(a) !== originOf(b);
}
