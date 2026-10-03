import type { StackPackage, StackVerification } from "@sdd/contracts";

/**
 * Live release checks for stack technologies (npm, PyPI, crates.io, GitHub).
 *
 * The model's idea of "the current stable version" is as old as its training
 * data, so every recommended or chosen layer is checked against its registry:
 * latest version, when it was released, and whether it is deprecated or
 * archived. Provider-agnostic and deterministic — no web search.
 *
 * Only fixed public registry hosts are called, with the package name encoded
 * into the path, so there is no user-controlled URL (no SSRF surface). A
 * lookup never throws: a timeout or an unknown package is status "unknown".
 * Set SDD_STACK_REGISTRY=off to skip network lookups entirely (air-gapped
 * installs); every layer then reads "unknown".
 */

export type Registry = StackPackage["registry"];

/** No release for this long counts as stale (18 months). */
export const STALE_AFTER_DAYS = 548;
const DAY_MS = 86_400_000;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** What a registry answered, before the status rules are applied. */
export interface RegistryFacts {
  latest_version: string | null;
  released_at: string | null;
  deprecated: boolean;
  source_url: string | null;
  note?: string | null;
}

/** current · stale · deprecated · unknown, from what the registry said and today's date. */
export function statusOf(facts: RegistryFacts | null, now: Date): StackVerification["status"] {
  if (!facts) return "unknown";
  if (facts.deprecated) return "deprecated";
  if (facts.released_at) {
    const at = Date.parse(facts.released_at);
    if (Number.isFinite(at) && now.getTime() - at > STALE_AFTER_DAYS * DAY_MS) return "stale";
    return "current";
  }
  return facts.latest_version ? "current" : "unknown";
}

/** The first whole number in a version or constraint ("^5", ">=16", "v4.2.0", "5.x") — its major. */
export function majorOf(version: string | null | undefined): number | null {
  const m = /(\d+)/.exec(version ?? "");
  return m ? Number(m[1]) : null;
}

/** True when a constraint pins an older major than the latest release ("^4" while 5.1.0 is out). */
export function behindLatestMajor(constraint: string | null | undefined, latest: string | null | undefined): boolean {
  const want = majorOf(constraint);
  const have = majorOf(latest);
  return want !== null && have !== null && want < have;
}

/** Package names the registries accept; anything else is refused before a request is made. */
const NAME_RULES: Record<Registry, RegExp> = {
  npm: /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i,
  pypi: /^[a-z0-9][a-z0-9._-]*$/i,
  crates: /^[a-z0-9][a-z0-9_-]*$/i,
  github: /^[a-z0-9][a-z0-9-]*\/[a-z0-9._-]+$/i,
};
export const isValidPackage = (ref: StackPackage) => NAME_RULES[ref.registry]?.test(ref.name) ?? false;

/** Human link for a package, shown next to its verification. */
export function packageUrl(ref: StackPackage): string {
  switch (ref.registry) {
    case "npm":
      return `https://www.npmjs.com/package/${ref.name}`;
    case "pypi":
      return `https://pypi.org/project/${ref.name}/`;
    case "crates":
      return `https://crates.io/crates/${ref.name}`;
    case "github":
      return `https://github.com/${ref.name}`;
  }
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/* ── Registry parsers: pure, tested with recorded shapes ── */

/** A pre-release version ("8.0.0-rc.19"): never offered as the version to use. */
export const isPrerelease = (version: string) => /^\d+\.\d+\.\d+-/.test(version.trim());

/** Highest stable version among npm dist-tag values ("prev": "7.10.0"), or null. */
export function stableFromDistTags(tags: Json | null): string | null {
  const parts = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10));
  const stable = Object.values(tags ?? {}).filter((v): v is string => typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v));
  stable.sort((a, b) => {
    const [x, y] = [parts(a), parts(b)];
    return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
  });
  return stable.at(-1) ?? null;
}

/**
 * npm: /<name>/latest (version, deprecated) + the search index (date of the
 * latest publish). Some packages point "latest" at a release candidate
 * (prisma did, with 8.0.0-rc.19): then the highest stable dist-tag stands in,
 * so a recommendation is never pushed onto a pre-release.
 */
export function parseNpm(latest: Json | null, search: Json | null, name: string, distTags: Json | null = null): RegistryFacts | null {
  if (!latest && !search) return null;
  const hit = Array.isArray(search?.objects)
    ? (search.objects as Array<{ package?: Json }>).find((o) => o.package?.name === name)?.package
    : undefined;
  const tagged = str(latest?.version) ?? str(hit?.version);
  if (!tagged) return null;
  const stable = isPrerelease(tagged) ? stableFromDistTags(distTags) : null;
  const version = stable ?? tagged;
  const deprecation = str(latest?.deprecated);
  return {
    latest_version: version,
    // The search index dates its own version; only trust it for the same one.
    released_at: hit && str(hit.version) === version ? str(hit.date) : null,
    deprecated: Boolean(deprecation),
    source_url: `https://www.npmjs.com/package/${name}`,
    note: deprecation ?? (isPrerelease(tagged) ? `npm's "latest" tag points at the pre-release ${tagged}.` : null),
  };
}

/** PyPI: /pypi/<name>/json — info.version, the latest files' upload time, "Inactive" classifier. */
export function parsePypi(doc: Json | null, name: string): RegistryFacts | null {
  const info = doc?.info as Json | undefined;
  const version = str(info?.version);
  if (!info || !version) return null;
  const files = Array.isArray(doc?.urls) ? (doc!.urls as Json[]) : [];
  const uploaded = files.map((f) => str(f.upload_time_iso_8601) ?? str(f.upload_time)).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
  const classifiers = Array.isArray(info.classifiers) ? (info.classifiers as string[]) : [];
  return {
    latest_version: version,
    released_at: uploaded,
    deprecated: classifiers.some((c) => /Development Status :: 7 - Inactive/.test(c)),
    source_url: str(info.project_url) ?? `https://pypi.org/project/${name}/`,
  };
}

/** crates.io: /api/v1/crates/<name> — max stable version and its creation date. */
export function parseCrates(doc: Json | null, name: string): RegistryFacts | null {
  const crate = doc?.crate as Json | undefined;
  const version = str(crate?.max_stable_version) ?? str(crate?.newest_version) ?? str(crate?.max_version);
  if (!crate || !version) return null;
  const versions = Array.isArray(doc?.versions) ? (doc!.versions as Json[]) : [];
  const own = versions.find((v) => v.num === version);
  return {
    latest_version: version,
    released_at: str(own?.created_at) ?? str(crate.updated_at),
    deprecated: Boolean(own?.yanked),
    source_url: `https://crates.io/crates/${name}`,
  };
}

/** Six months: a GitHub release this much older than the repository's last push no longer stands for its current version. */
const RELEASE_BEHIND_PUSH_MS = 183 * 86_400_000;

/**
 * GitHub: the repository (archived, last push) and its latest release, when it
 * publishes releases. A release is trusted only when it is a real version and
 * roughly current: flutter's `releases/latest` was an old 3.19 pre-release while
 * the project shipped from tags every month. Otherwise the project is judged by
 * its last push, with no version.
 */
export function parseGithub(repo: Json | null, release: Json | null, name: string): RegistryFacts | null {
  if (!repo) return null;
  const raw = str(release?.tag_name);
  // The version inside the tag: "bun-v1.3.0" → 1.3.0, "v18.1" → 18.1, "3.19.0-0.1.pre" → 3.19.0 + a pre-release suffix.
  const m = raw ? /(\d+(?:\.\d+)+)(-[0-9A-Za-z.-]+)?/.exec(raw) : null;
  const tag = m ? m[1]! : (raw?.replace(/^(release-|v)/i, "") ?? null);
  const pre = release?.prerelease === true || Boolean(m?.[2]) || /pre|rc|beta|alpha/i.test(raw ?? "");
  const published = str(release?.published_at);
  const pushed = str(repo.pushed_at);
  const behind = Boolean(published && pushed && Date.parse(pushed) - Date.parse(published) > RELEASE_BEHIND_PUSH_MS);
  const trusted = tag && !pre && !behind ? tag : null;
  return {
    latest_version: trusted,
    // Projects that tag without (current) GitHub releases (PostgreSQL, Go, Flutter) are judged by their last push.
    released_at: trusted ? published : (pushed ?? published),
    deprecated: repo.archived === true,
    source_url: str(repo.html_url) ?? `https://github.com/${name}`,
    note: repo.archived === true ? "The repository is archived." : null,
  };
}

/* ── Client with timeout, cache and in-flight de-duplication ── */

export interface RegistryClientOptions {
  fetch?: Fetcher;
  now?: () => Date;
  timeoutMs?: number;
  ttlMs?: number;
  githubToken?: string | null;
  enabled?: boolean;
  /** Most lookups run at once. */
  concurrency?: number;
}

export function createRegistryClient(opts: RegistryClientOptions = {}) {
  const fetcher: Fetcher = opts.fetch ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? (() => new Date());
  const timeoutMs = opts.timeoutMs ?? 4000;
  const ttlMs = opts.ttlMs ?? 12 * 3_600_000;
  const enabled = opts.enabled ?? true;
  const concurrency = Math.max(1, opts.concurrency ?? 12);
  const cache = new Map<string, { at: number; value: StackVerification }>();
  const inflight = new Map<string, Promise<StackVerification>>();
  let running = 0;
  const queue: Array<() => void> = [];

  const slot = async <T>(job: () => Promise<T>): Promise<T> => {
    if (running >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    running++;
    try {
      return await job();
    } finally {
      running--;
      queue.shift()?.();
    }
  };

  async function getJson(url: string, headers: Record<string, string> = {}): Promise<Json | null> {
    try {
      const res = await fetcher(url, { headers: { accept: "application/json", "user-agent": "sdd-control-plane (stack check)", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      return (await res.json()) as Json;
    } catch {
      return null;
    }
  }

  async function facts(ref: StackPackage): Promise<RegistryFacts | null> {
    const name = ref.name;
    switch (ref.registry) {
      case "npm": {
        const path = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
        const [latest, search] = await Promise.all([
          getJson(`https://registry.npmjs.org/${path}/latest`),
          getJson(`https://registry.npmjs.org/-/v1/search?size=5&text=${encodeURIComponent(name)}`),
        ]);
        // Only when "latest" is a pre-release: the small dist-tags document names the stable ones.
        const version = str(latest?.version);
        const distTags = version && isPrerelease(version) ? await getJson(`https://registry.npmjs.org/-/package/${path}/dist-tags`) : null;
        return parseNpm(latest, search, name, distTags);
      }
      case "pypi":
        return parsePypi(await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`), name);
      case "crates":
        return parseCrates(await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`), name);
      case "github": {
        const [owner, repo] = name.split("/").map(encodeURIComponent);
        const headers: Record<string, string> = { accept: "application/vnd.github+json", ...(opts.githubToken ? { authorization: `Bearer ${opts.githubToken}` } : {}) };
        const [repoDoc, release] = await Promise.all([
          getJson(`https://api.github.com/repos/${owner}/${repo}`, headers),
          getJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, headers),
        ]);
        return parseGithub(repoDoc, release, name);
      }
    }
  }

  const unknown = (ref: StackPackage | null, note: string): StackVerification => ({
    status: "unknown",
    latest_version: null,
    released_at: null,
    checked_at: now().toISOString(),
    source_url: ref && isValidPackage(ref) ? packageUrl(ref) : null,
    note,
  });

  /** One package's verification; cached for `ttlMs` (failures for 5 minutes). Never throws. */
  function lookup(ref: StackPackage): Promise<StackVerification> {
    if (!enabled) return Promise.resolve(unknown(ref, "Registry checks are turned off on this server."));
    if (!isValidPackage(ref)) return Promise.resolve(unknown(null, "Not a valid package name for its registry."));
    const key = `${ref.registry}:${ref.name.toLowerCase()}`;
    const hit = cache.get(key);
    const age = hit ? now().getTime() - hit.at : Infinity;
    if (hit && age < (hit.value.status === "unknown" ? 300_000 : ttlMs)) return Promise.resolve(hit.value);
    const pending = inflight.get(key);
    if (pending) return pending;
    const job = slot(async () => {
      const found = await facts(ref).catch(() => null);
      const value: StackVerification = found
        ? {
            status: statusOf(found, now()),
            latest_version: found.latest_version,
            released_at: found.released_at,
            checked_at: now().toISOString(),
            source_url: found.source_url,
            note: found.note ?? null,
          }
        : unknown(ref, "The registry did not answer, or has no such package.");
      cache.set(key, { at: now().getTime(), value });
      inflight.delete(key);
      return value;
    });
    inflight.set(key, job);
    return job;
  }

  /**
   * Verifications for many packages. With `deadlineMs`, answers what finished
   * in time and leaves the rest running into the cache (their entries read
   * "unknown" for now) — a page never waits on a slow registry.
   */
  async function lookupMany(refs: StackPackage[], deadlineMs?: number): Promise<Map<string, StackVerification>> {
    const out = new Map<string, StackVerification>();
    const unique = [...new Map(refs.map((r) => [`${r.registry}:${r.name.toLowerCase()}`, r])).entries()];
    const all = Promise.all(unique.map(async ([key, ref]) => out.set(key, await lookup(ref))));
    if (deadlineMs === undefined) await all;
    else await Promise.race([all, new Promise((resolve) => setTimeout(resolve, deadlineMs))]);
    return out;
  }

  return { lookup, lookupMany, clear: () => cache.clear() };
}

export const refKey = (ref: StackPackage) => `${ref.registry}:${ref.name.toLowerCase()}`;

/** The server's shared client. */
export const stackRegistry = createRegistryClient({
  githubToken: process.env.GITHUB_TOKEN || null,
  enabled: (process.env.SDD_STACK_REGISTRY ?? "on").toLowerCase() !== "off",
});
