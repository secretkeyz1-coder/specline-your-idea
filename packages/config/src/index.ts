import { z } from "zod";

/**
 * Typed, validated instance configuration (T007).
 * Secrets are read here but never printed: the logger redacts objects and
 * `describeConfig()` intentionally exposes only non-secret fields.
 */
const envSchema = z.object({
  // Ambient environments sometimes export NODE_ENV as an empty string; treat
  // it as unset so the default applies instead of failing validation.
  NODE_ENV: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["development", "test", "production"]).default("development"),
  ),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (postgres://user:pass@host:5432/db)"),

  /** 32-byte base64 key used for AES-256-GCM credential encryption. */
  SDD_MASTER_KEY: z
    .string()
    .min(1, "SDD_MASTER_KEY is required (base64 of 32 random bytes)"),
  SDD_SESSION_SECRET: z.string().min(16, "SDD_SESSION_SECRET must be at least 16 chars"),

  API_PORT: z.coerce.number().int().positive().default(4000),
  /**
   * Interface the API listens on. Unset: 127.0.0.1 in development (only this
   * machine can reach it — not everyone on the café Wi-Fi) and 0.0.0.0 in
   * production, where it sits inside a container network behind the proxy.
   * Set 0.0.0.0 in development to let an agent on another LAN machine connect.
   */
  API_HOST: z.string().optional(),
  API_PUBLIC_URL: z.url().default("http://localhost:4000"),
  WEB_PUBLIC_URL: z.url().default("http://localhost:5173"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /** Trust the LAST x-forwarded-for hop (set by the closest reverse proxy) as
   * the client IP. Enable only when deployed behind a proxy you control
   * (e.g. the reference Caddy deployment); otherwise the socket peer is used. */
  SDD_TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  /**
   * Egress policy for custom AI endpoints (docs/13_SECURITY.md §17).
   * Hosted posture (default) refuses loopback/private/metadata targets.
   */
  ALLOW_PRIVATE_AI_EGRESS: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  /**
   * Let AI provider connections of type LOCAL_CLI run a coding-agent CLI
   * (Claude Code, Codex) ON THIS SERVER, under the API's OS user and that
   * user's CLI login. Off by default; machine-run CLIs (sdd-agent) do not
   * need it.
   */
  SDD_ENABLE_LOCAL_CLI: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  /** Max bytes accepted from any AI provider response body. */
  AI_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(2_000_000),
  /** Default provider timeout when a connection does not override it. */
  AI_DEFAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  BOOTSTRAP_WORKSPACE: z.string().default("Default"),

  /** Simple in-memory rate limits (requests per window) — configurable, observable. */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_AI_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MCP_MAX: z.coerce.number().int().positive().default(120),

  /**
   * Who may create an account with POST /auth/register. Unset: open in
   * development, closed in production — a server on a public domain should not
   * hand accounts to anyone on the internet.
   */
  ALLOW_SELF_REGISTRATION: z.string().optional(),
  /**
   * Emails or @domains that may still register while self-registration is
   * closed, comma-separated: "ani@example.com,@example.com". How a team joins a
   * private server.
   */
  REGISTRATION_ALLOWLIST: z.string().default(""),
});

export type AppConfig = z.infer<typeof envSchema> & {
  masterKey: Uint8Array<ArrayBuffer>;
  isProduction: boolean;
  isHostedEgress: boolean;
  apiHost: string;
  selfRegistration: boolean;
  registrationAllowlist: string[];
};

const truthy = (v: string) => ["true", "1", "yes", "on"].includes(v.trim().toLowerCase());

/** Whether an email may self-register under the configured policy. */
export function mayRegister(config: Pick<AppConfig, "selfRegistration" | "registrationAllowlist">, email: string): boolean {
  if (config.selfRegistration) return true;
  const e = email.trim().toLowerCase();
  return config.registrationAllowlist.some((entry) => (entry.startsWith("@") ? e.endsWith(entry) : e === entry));
}

let cached: AppConfig | null = null;

/** Load the nearest .env walking up from cwd (monorepo-friendly); existing env wins. */
function loadDotEnv(): void {
  let dir = process.cwd().replace(/\\/g, "/");
  for (let i = 0; i < 8; i++) {
    const candidate = `${dir}/.env`;
    try {
      const file = Bun.file(candidate);
      if (file.size > 0) {
        const text = require("fs").readFileSync(candidate, "utf8") as string;
        for (const line of text.split("\n")) {
          const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
          if (!m) continue;
          const key = m[1]!;
          let value = m[2]!.replace(/^["']|["']$/g, "");
          if (process.env[key] === undefined) process.env[key] = value;
        }
        return;
      }
    } catch {
      /* keep walking */
    }
    const parent = dir.split("/").slice(0, -1).join("/");
    if (parent === dir) return;
    dir = parent;
  }
}

export function loadConfig(overrides?: Partial<Record<string, string>>): AppConfig {
  if (overrides) {
    return buildConfig(overrides);
  }
  if (cached) return cached;
  cached = buildConfig({});
  return cached;
}

function buildConfig(overrides: Partial<Record<string, string>>): AppConfig {
  loadDotEnv();
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid configuration — ${issues}`);
  }
  const env = parsed.data;
  // SDD_SESSION_SECRET signs pairing codes: shipping the .env.example
  // placeholder to production would make them forgeable by anyone who has
  // read the repository.
  if (env.NODE_ENV === "production" && /^change-?me/i.test(env.SDD_SESSION_SECRET)) {
    throw new Error("Invalid configuration — SDD_SESSION_SECRET still has the .env.example placeholder. Generate: openssl rand -base64 32");
  }
  const masterKey = decodeMasterKey(env.SDD_MASTER_KEY) as Uint8Array<ArrayBuffer>;
  const isProduction = env.NODE_ENV === "production";
  cached = {
    ...env,
    masterKey,
    isProduction,
    isHostedEgress: !env.ALLOW_PRIVATE_AI_EGRESS,
    apiHost: env.API_HOST?.trim() || (isProduction ? "0.0.0.0" : "127.0.0.1"),
    selfRegistration: env.ALLOW_SELF_REGISTRATION === undefined || env.ALLOW_SELF_REGISTRATION.trim() === ""
      ? !isProduction
      : truthy(env.ALLOW_SELF_REGISTRATION),
    registrationAllowlist: env.REGISTRATION_ALLOWLIST.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
  return cached;
}

/** Test helper: drop the cached config so overrides take effect. */
export function resetConfigCache(): void {
  cached = null;
}

function decodeMasterKey(raw: string): Uint8Array {
  let key: Uint8Array;
  try {
    const decoded = Buffer.from(raw, "base64");
    key = new Uint8Array(decoded);
  } catch {
    throw new Error("SDD_MASTER_KEY must be base64");
  }
  if (key.byteLength !== 32) {
    throw new Error(
      `SDD_MASTER_KEY must decode to 32 bytes (got ${key.byteLength}). Generate: openssl rand -base64 32`,
    );
  }
  return key;
}

/** Safe subset for startup logs — never includes secrets. */
export function describeConfig(config: AppConfig) {
  return {
    nodeEnv: config.NODE_ENV,
    apiPort: config.API_PORT,
    apiPublicUrl: config.API_PUBLIC_URL,
    webPublicUrl: config.WEB_PUBLIC_URL,
    logLevel: config.LOG_LEVEL,
    hostedEgress: config.isHostedEgress,
    localCli: config.SDD_ENABLE_LOCAL_CLI,
    aiMaxResponseBytes: config.AI_MAX_RESPONSE_BYTES,
    database: redactDatabaseUrl(config.DATABASE_URL),
  };
}

function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username && u.username !== "sdd") u.username = "***";
    return u.toString();
  } catch {
    return "***";
  }
}
