import { readConfig } from "./config.js";

/** API client + deterministic output contract (FR-096/FR-097):
 * JSON on stdout with --json, human text otherwise, non-zero exit on failure. */

export class CliError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus?: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

let jsonMode = false;
export function setJsonMode(value: boolean): void {
  jsonMode = value;
}
export function isJsonMode(): boolean {
  return jsonMode;
}

/** Process-wide server override (e.g. `sdd-agent connect --server`), so REST
 * calls go to the same control plane as the WebSocket. */
let serverOverride: string | null = null;
function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

export function setServerOverride(url: string | null): void {
  serverOverride = url ? trimTrailingSlashes(url) : null;
}

const normalizeServer = (url: string) => trimTrailingSlashes(url.trim()).toLowerCase();

/**
 * Which bearer to send. An explicit `token` wins — including `null`, which
 * means "anonymous" (login, pairing bootstrap); `??` used to turn that null
 * back into the saved token. The saved token only ever goes to the server it
 * was issued by: a `--server` pointing elsewhere gets no credential.
 */
export function resolveRequestToken(
  explicit: string | null | undefined,
  saved: { token: string | null; server_url: string },
  targetBase: string,
): string | null {
  if (explicit !== undefined) return explicit;
  if (!saved.token) return null;
  return normalizeServer(targetBase) === normalizeServer(saved.server_url) ? saved.token : null;
}

export async function api<T = unknown>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    token?: string | null;
    baseUrl?: string;
    /** One key per LOGICAL operation (generated once by the caller, reused on retry). */
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const config = readConfig();
  const base = trimTrailingSlashes(options.baseUrl ?? serverOverride ?? config.server_url);
  const token = resolveRequestToken(options.token, config, base);
  const timeoutMs = method === "POST" && /\/(request-review|orchestrate)$/.test(path) ? 3 * 60 * 60_000 : 30_000;
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        // A fresh random key per HTTP request made retries non-idempotent and
        // overrode keys the body already carried; send one only when asked.
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new CliError("NETWORK", `Request timed out after ${timeoutMs / 1000}s: ${method} ${path}`);
    }
    throw new CliError("NETWORK", `Request failed: ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new CliError(err?.code ?? `HTTP_${response.status}`, err?.message ?? `Request failed (${response.status})`, response.status, err?.details);
  }
  return payload as T;
}

export function output(value: unknown): void {
  if (isJsonMode()) {
    console.log(JSON.stringify(value, null, 2));
  } else if (value !== null && typeof value === "object") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(String(value));
  }
}

/** Human renderer helper for the common record shape. */
export function printTable(rows: Array<Record<string, unknown>>, columns: string[]): void {
  if (isJsonMode()) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(line(columns));
  for (const row of rows) console.log(line(columns.map((c) => String(row[c] ?? ""))));
}

export function fail(error: unknown): never {
  if (error instanceof CliError) {
    if (isJsonMode()) {
      console.log(JSON.stringify({ error: { code: error.code, message: error.message, details: error.details ?? null } }, null, 2));
    } else {
      console.error(`error [${error.code}]: ${error.message}`);
    }
    process.exit(1);
  }
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
