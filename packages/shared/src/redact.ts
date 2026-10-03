/**
 * Secret redaction utility (T197, NFR-013).
 * Removes/masks credential-bearing values before they reach logs or exports.
 */
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|passwd|secret|credential|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|bearer|private[-_]?key|session)/i;

const MASK = "***REDACTED***";

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** Deeply clones a value, masking any property whose key looks secret-bearing. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1)) as unknown as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof Map) && !(value instanceof Set)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        // Keep presence visible (useful for debugging) but never the value.
        out[key] = val === null || val === undefined ? val : typeof val === "string" ? MASK : { redacted: true };
      } else {
        out[key] = redact(val, depth + 1);
      }
    }
    return out as unknown as T;
  }
  if (typeof value === "string") {
    return redactEmbeddedCredentials(value) as unknown as T;
  }
  return value;
}

/** Masks `Authorization: Bearer xyz` / `api_key=...` patterns inside free text. */
export function redactEmbeddedCredentials(text: string): string {
  return text
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?(\S+)/gi, (_m, p1, _p2) => `${p1}${MASK}`)
    .replace(/((?:api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|secret|password)(?:["']?\s*[:=]\s*["']?))([^\s"',}]+)/gi, (_m, p1) => `${p1}${MASK}`);
}
