import { sha256Hex, newOpaqueToken, newUuid } from "@sdd/shared";
import type { TokenScope } from "@sdd/contracts";

/** Opaque browser session token; only the hash is stored. */
export function createSessionToken(): { token: string; tokenHash: string } {
  const token = newOpaqueToken("sddsess");
  return { token, tokenHash: sha256Hex(token) };
}

/** Scoped personal access token for CLI/MCP (docs/13 §4–5). */
export function createApiToken(): { token: string; tokenHash: string; prefix: string } {
  const token = newOpaqueToken("sddpat");
  return { token, tokenHash: sha256Hex(token), prefix: token.slice(0, 16) };
}

export function hashDeviceCode(deviceCode: string): string {
  return sha256Hex(deviceCode);
}

/** Human-approvable code shown in the browser during CLI login (docs/10 §11). */
export function createUserCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length]!;
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function newDeviceCode(): string {
  return newUuid();
}

export function hasScope(granted: string[], required: TokenScope | TokenScope[]): boolean {
  const needed = Array.isArray(required) ? required : [required];
  return needed.every((scope) => granted.includes(scope));
}
