import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, statSync, chmodSync } from "node:fs";
import { homedir, hostname, userInfo, platform } from "node:os";
import { createHash } from "node:crypto";

/** CLI config (T118): ~/.config/sddctl/config.json — holds server + token.
 * The repository link (.sdd/local.json) never stores secrets (FR-092, C13). */

export interface CliConfig {
  server_url: string;
  token: string | null;
  profile: string;
}

export function configPath(): string {
  // SDDCTL_CONFIG points at another config file (a second sign-in, or tests).
  return process.env.SDDCTL_CONFIG || join(homedir(), ".config", "sddctl", "config.json");
}

export function readConfig(): CliConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<CliConfig>;
    return {
      server_url: raw.server_url ?? process.env.SDD_SERVER_URL ?? "http://localhost:4000",
      token: raw.token ?? null,
      profile: raw.profile ?? "default",
    };
  } catch {
    return {
      server_url: process.env.SDD_SERVER_URL ?? "http://localhost:4000",
      token: process.env.SDD_TOKEN ?? null,
      profile: "default",
    };
  }
}

export function writeConfig(config: CliConfig): void {
  const path = configPath();
  const dir = join(path, "..");
  // Create private from the start: writing 0644 and chmod-ing afterwards leaves
  // a window where another local user can read the token.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    chmodSync(dir, 0o700);
    chmodSync(path, 0o600); // existing files keep their old mode otherwise
  } catch {
    // Windows: permission bits are best-effort
  }
}

export function clearToken(): void {
  const config = readConfig();
  writeConfig({ ...config, token: null });
}

/** Stable machine fingerprint for registration (docs/08 §20). */
export function machineFingerprint(): string {
  let user = "user";
  try {
    user = userInfo().username;
  } catch {
    /* fallback */
  }
  return createHash("sha256").update(`${hostname()}:${user}:${platform()}`).digest("hex").slice(0, 32);
}

export function machineName(): string {
  return `${hostname()}-sddctl`;
}

/** Repo root detection (T121): walk up for .git or .sdd. */
export function findRepoRoot(startDir: string = process.cwd()): string | null {
  let dir = startDir.replace(/\\/g, "/");
  for (let i = 0; i < 32; i++) {
    try {
      if (statSync(join(dir, ".git")).isDirectory() || statSync(join(dir, ".sdd")).isDirectory()) return dir;
    } catch {
      /* keep walking */
    }
    const parent = dir.split("/").slice(0, -1).join("/");
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export interface RepoLink {
  project_key: string;
  project_id?: string;
  repository_id?: string;
  server_url?: string;
  /** The registered machine — sent with submissions so AUTO_RUN can apply. */
  machine_id?: string;
  permission_mode?: "MANUAL" | "ASSISTED" | "AUTO_RUN";
}

export function repoLinkPath(repoRoot: string): string {
  return join(repoRoot, ".sdd", "local.json");
}

export function readRepoLink(repoRoot: string): RepoLink | null {
  try {
    return JSON.parse(readFileSync(repoLinkPath(repoRoot), "utf8")) as RepoLink;
  } catch {
    return null;
  }
}

export function writeRepoLink(repoRoot: string, link: RepoLink): void {
  const path = repoLinkPath(repoRoot);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(link, null, 2));
}
