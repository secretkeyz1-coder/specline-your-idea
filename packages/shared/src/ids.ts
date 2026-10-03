/** Identifier and trace helpers. */

export function newUuid(): string {
  return crypto.randomUUID();
}

/** Correlation id threaded across web/CLI/MCP/gateway request paths (T190). */
export function newTraceId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Human-readable display key like `TASK-0042` derived from a sequence number. */
export function displayKey(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

export function newOpaqueToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const body = Buffer.from(bytes).toString("base64url");
  return `${prefix}_${body}`;
}

export function sha256Hex(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}
