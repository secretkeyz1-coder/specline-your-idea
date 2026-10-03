import { describe, expect, test } from "bun:test";
import { StackDecisionSchema, type StackVerification } from "@sdd/contracts";
import { STACK_SYSTEM_PROMPT } from "@sdd/ai";
import {
  behindLatestMajor,
  createRegistryClient,
  isValidPackage,
  majorOf,
  parseCrates,
  parseGithub,
  parseNpm,
  isPrerelease,
  stableFromDistTags,
  parsePypi,
  statusOf,
} from "../src/modules/planning/stack-registry.js";
import { STACK_CATALOG, catalogFactLines, matchCatalogOption, namedTechnologies, usesTechnology, verifiedCatalog } from "../src/modules/planning/stack-catalog.js";
import { decisionIssues, honourNamed, layerIssue, namedIssues, stackFactsBlock, stackRepairInstruction, verifyDecision } from "../src/modules/planning/stack.js";

const NOW = new Date("2026-10-01T00:00:00Z");
const monthsAgo = (m: number) => new Date(NOW.getTime() - m * 30 * 86_400_000).toISOString();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const verified = (v: Partial<StackVerification>): StackVerification => ({
  status: "current",
  latest_version: "5.0.0",
  released_at: monthsAgo(1),
  checked_at: NOW.toISOString(),
  source_url: null,
  note: null,
  ...v,
});

describe("registry parsers", () => {
  test("npm: version from /latest, date from the search hit of the same version, deprecation", () => {
    const facts = parseNpm(
      { name: "lucia", version: "3.2.2", deprecated: "This package has been deprecated." },
      { objects: [{ package: { name: "lucia-auth", version: "9.9.9", date: "2020-01-01" } }, { package: { name: "lucia", version: "3.2.2", date: "2024-10-01T00:00:00Z" } }] },
      "lucia",
    );
    expect(facts).toMatchObject({ latest_version: "3.2.2", released_at: "2024-10-01T00:00:00Z", deprecated: true });
    // The search index lagging behind /latest: its date is for another version, so none is trusted.
    expect(parseNpm({ version: "2.0.0" }, { objects: [{ package: { name: "x", version: "1.9.0", date: "2026-01-01" } }] }, "x")?.released_at).toBeNull();
    expect(parseNpm(null, null, "x")).toBeNull();
  });

  test("PyPI: latest file upload time and the Inactive classifier", () => {
    const facts = parsePypi(
      {
        info: { version: "5.2.1", classifiers: ["Framework :: Django", "Development Status :: 7 - Inactive"], project_url: "https://pypi.org/project/django/" },
        urls: [{ upload_time_iso_8601: "2026-09-01T10:00:00Z" }, { upload_time_iso_8601: "2026-09-02T10:00:00Z" }],
      },
      "django",
    );
    expect(facts).toMatchObject({ latest_version: "5.2.1", released_at: "2026-09-02T10:00:00Z", deprecated: true });
  });

  test("crates.io: max stable version and its own creation date", () => {
    const facts = parseCrates(
      { crate: { max_stable_version: "0.8.4", updated_at: "2026-09-20T00:00:00Z" }, versions: [{ num: "0.9.0-rc.1", created_at: "2026-09-20" }, { num: "0.8.4", created_at: "2026-05-01T00:00:00Z", yanked: false }] },
      "axum",
    );
    expect(facts).toMatchObject({ latest_version: "0.8.4", released_at: "2026-05-01T00:00:00Z", deprecated: false });
  });

  test("GitHub: release tag without the v, archived repos, last push when there are no releases", () => {
    expect(parseGithub({ archived: false, pushed_at: "2026-09-30T00:00:00Z", html_url: "https://github.com/oven-sh/bun" }, { tag_name: "bun-v1.3.0", published_at: "2026-09-10T00:00:00Z" }, "oven-sh/bun")).toMatchObject({
      released_at: "2026-09-10T00:00:00Z",
      deprecated: false,
    });
    expect(parseGithub({ archived: false, pushed_at: "2026-09-29T00:00:00Z" }, { tag_name: "v18.1" }, "x/y")?.latest_version).toBe("18.1");
    const noReleases = parseGithub({ archived: false, pushed_at: "2026-09-29T00:00:00Z" }, null, "postgres/postgres");
    expect(noReleases).toMatchObject({ latest_version: null, released_at: "2026-09-29T00:00:00Z" });
    expect(parseGithub({ archived: true, pushed_at: "2022-01-01T00:00:00Z" }, null, "old/repo")?.deprecated).toBe(true);
  });
});

describe("status rules", () => {
  test("deprecated wins, then 18 months without a release is stale", () => {
    expect(statusOf({ latest_version: "1.0.0", released_at: monthsAgo(1), deprecated: true, source_url: null }, NOW)).toBe("deprecated");
    expect(statusOf({ latest_version: "1.0.0", released_at: monthsAgo(19), deprecated: false, source_url: null }, NOW)).toBe("stale");
    expect(statusOf({ latest_version: "1.0.0", released_at: monthsAgo(17), deprecated: false, source_url: null }, NOW)).toBe("current");
    expect(statusOf({ latest_version: "1.0.0", released_at: null, deprecated: false, source_url: null }, NOW)).toBe("current");
    expect(statusOf(null, NOW)).toBe("unknown");
  });

  test("majors and constraints", () => {
    expect(majorOf("^5")).toBe(5);
    expect(majorOf(">=16")).toBe(16);
    expect(majorOf("v4.2.0")).toBe(4);
    expect(behindLatestMajor("^4", "5.1.0")).toBe(true);
    expect(behindLatestMajor("^5", "5.1.0")).toBe(false);
    expect(behindLatestMajor(null, "5.1.0")).toBe(false);
  });

  test("package names are checked before any request", () => {
    expect(isValidPackage({ registry: "npm", name: "@sveltejs/kit" })).toBe(true);
    expect(isValidPackage({ registry: "npm", name: "../../etc" })).toBe(false);
    expect(isValidPackage({ registry: "github", name: "postgres/postgres" })).toBe(true);
    expect(isValidPackage({ registry: "github", name: "no-slash" })).toBe(false);
  });
});

describe("registry client", () => {
  const npmFetch = (calls: string[]) => async (url: string) => {
    calls.push(url);
    if (url.includes("/-/v1/search")) return json({ objects: [{ package: { name: "next", version: "15.5.0", date: monthsAgo(1) } }] });
    if (url.endsWith("/next/latest")) return json({ name: "next", version: "15.5.0" });
    return json({}, 404);
  };

  test("verifies, caches and never throws", async () => {
    const calls: string[] = [];
    const client = createRegistryClient({ fetch: npmFetch(calls), now: () => NOW });
    const first = await client.lookup({ registry: "npm", name: "next" });
    expect(first).toMatchObject({ status: "current", latest_version: "15.5.0" });
    await client.lookup({ registry: "npm", name: "next" });
    expect(calls.length).toBe(2); // /latest + search, once
    const failing = createRegistryClient({ fetch: async () => { throw new Error("offline"); }, now: () => NOW });
    expect((await failing.lookup({ registry: "npm", name: "next" })).status).toBe("unknown");
  });

  test("turned off: no request, status unknown", async () => {
    const calls: string[] = [];
    const client = createRegistryClient({ fetch: npmFetch(calls), now: () => NOW, enabled: false });
    expect((await client.lookup({ registry: "npm", name: "next" })).status).toBe("unknown");
    expect(calls.length).toBe(0);
  });

  test("scoped npm names keep their scope in the path", async () => {
    const calls: string[] = [];
    const client = createRegistryClient({ fetch: async (url) => { calls.push(url); return json({}, 404); }, now: () => NOW });
    await client.lookup({ registry: "npm", name: "@sveltejs/kit" });
    expect(calls.some((u) => u.startsWith("https://registry.npmjs.org/@sveltejs%2Fkit/latest"))).toBe(true);
  });
});

describe("catalog", () => {
  test("core layers cover the categories the prompt names; no versions are hard-coded", () => {
    const core = STACK_CATALOG.filter((l) => l.core).map((l) => l.category);
    expect(core).toEqual(["Frontend", "Backend / runtime", "Data access / ORM", "Database", "Auth", "Testing", "Deployment"]);
    for (const layer of STACK_CATALOG) for (const o of layer.options) {
      if (o.package) expect(isValidPackage(o.package)).toBe(true);
      expect(JSON.stringify(o)).not.toMatch(/"version"/);
    }
  });

  test("enrichment keeps every option and marks what the registry said", async () => {
    const layers = await verifiedCatalog({
      lookupMany: async (refs) =>
        new Map(refs.map((r) => [`${r.registry}:${r.name.toLowerCase()}`, r.name === "lucia" ? verified({ status: "deprecated", note: "Deprecated." }) : verified({})])),
    });
    const auth = layers.find((l) => l.category === "Auth")!;
    expect(auth.options.length).toBe(STACK_CATALOG.find((l) => l.category === "Auth")!.options.length);
    expect(auth.options.find((o) => o.id === "lucia")?.verified?.status).toBe("deprecated");
    const lines = catalogFactLines(layers);
    expect(lines.find((l) => l.startsWith("Auth:"))).toContain("Lucia (npm:lucia) — DEPRECATED");
    expect(lines.find((l) => l.startsWith("Frontend:"))).toContain("latest 5.0.0");
  });

  test("free-text technologies find their option", () => {
    expect(matchCatalogOption("Database", "PostgreSQL 16")?.id).toBe("postgresql");
    expect(matchCatalogOption("Frontend", "Next.js")?.package).toEqual({ registry: "npm", name: "next" });
    expect(matchCatalogOption("Frontend", "Something bespoke")).toBeNull();
  });
});

describe("recommendation grounding", () => {
  test("the prompt no longer prefers old technology and asks for registry ids", () => {
    expect(STACK_SYSTEM_PROMPT).not.toContain("Prefer boring");
    expect(STACK_SYSTEM_PROMPT).toContain("current stable releases of actively maintained technology");
    expect(STACK_SYSTEM_PROMPT).toContain("CURRENT RELEASES");
    expect(STACK_SYSTEM_PROMPT).toContain('"registry"');
  });

  test("the facts block carries today's date", () => {
    const block = stackFactsBlock("2026-10-01", ["Frontend: SvelteKit (npm:@sveltejs/kit) — latest 2.40.0, released 2026-09-20"]);
    expect(block).toStartWith("TODAY: 2026-10-01");
    expect(block).toContain("SvelteKit (npm:@sveltejs/kit)");
  });

  test("verification finds deprecated, stale and behind-major layers; repair names them", async () => {
    const decision = StackDecisionSchema.parse({
      mode: "RECOMMENDED",
      candidates: [
        {
          name: "A",
          layers: [
            { category: "Frontend", technology: "Next.js", version_constraint: "^13", rationale: "" },
            { category: "Auth", technology: "Lucia", version_constraint: "^3", rationale: "" },
            { category: "Database", technology: "PostgreSQL", version_constraint: ">=18", rationale: "" },
            { category: "Deployment", technology: "Render", version_constraint: null, rationale: "" },
          ],
          tradeoffs: [],
        },
      ],
      recommendation_index: 0,
    });
    const out = await verifyDecision(decision, async (refs) =>
      new Map(
        refs.map((r) => [
          `${r.registry}:${r.name.toLowerCase()}`,
          r.name === "lucia" ? verified({ status: "deprecated", latest_version: "3.2.2" }) : r.name === "next" ? verified({ latest_version: "15.5.0" }) : verified({ latest_version: "18.0" }),
        ]),
      ),
    );
    const layers = out.candidates[0]!.layers;
    expect(layers.find((l) => l.category === "Frontend")?.package).toEqual({ registry: "npm", name: "next" });
    expect(layers.find((l) => l.category === "Deployment")?.verified).toBeUndefined(); // a hosted service: nothing to check
    const issues = decisionIssues(out);
    expect(issues.map((i) => [i.category, i.severity])).toEqual([
      ["Frontend", "LOW"],
      ["Auth", "HIGH"],
    ]);
    expect(layerIssue(layers.find((l) => l.category === "Database")!)).toBeNull();
    const repair = stackRepairInstruction("2026-10-01", issues, false);
    expect(repair).toContain("Lucia");
    expect(repair).toContain("15.5.0");
  });
});

describe("npm pre-release latest", () => {
  test("a pre-release 'latest' falls back to the highest stable dist-tag, and says so", () => {
    const facts = parseNpm({ version: "8.0.0-rc.19" }, null, "prisma", { latest: "8.0.0-rc.19", next: "8.0.0-rc.10", prev: "7.10.0", "patch-dev": "7.9.1-dev.1" });
    expect(facts?.latest_version).toBe("7.10.0");
    expect(facts?.note).toContain("8.0.0-rc.19");
    expect(facts?.released_at).toBeNull();
  });
  test("a stable 'latest' is kept as is", () => {
    expect(parseNpm({ version: "16.3.8" }, null, "next", { latest: "16.3.8", canary: "16.4.0-canary.3" })?.latest_version).toBe("16.3.8");
  });
  test("with no stable dist-tag the pre-release stays, flagged", () => {
    const facts = parseNpm({ version: "1.0.0-beta.2" }, null, "x", { latest: "1.0.0-beta.2" });
    expect(facts?.latest_version).toBe("1.0.0-beta.2");
    expect(facts?.note).toContain("pre-release");
  });
  test("stableFromDistTags orders numerically", () => {
    expect(stableFromDistTags({ a: "7.9.0", b: "7.10.0", c: "10.0.0-rc.1" })).toBe("7.10.0");
    expect(isPrerelease("8.0.0-rc.19")).toBe(true);
    expect(isPrerelease("8.0.0")).toBe(false);
  });
});

describe("GitHub releases that no longer stand for the current version", () => {
  test("an old pre-release 'latest' on an active repo gives no version, dated by the last push", () => {
    const facts = parseGithub(
      { archived: false, pushed_at: "2026-09-30T00:00:00Z" },
      { tag_name: "3.19.0-0.1.pre", prerelease: true, published_at: "2024-01-10T00:00:00Z" },
      "flutter/flutter",
    );
    expect(facts).toMatchObject({ latest_version: null, released_at: "2026-09-30T00:00:00Z" });
  });
  test("a stable release far behind the last push is not trusted either", () => {
    expect(parseGithub({ archived: false, pushed_at: "2026-09-30T00:00:00Z" }, { tag_name: "v2.0.0", published_at: "2025-01-01T00:00:00Z" }, "a/b")?.latest_version).toBeNull();
  });
  test("prefixed tags keep their version", () => {
    expect(parseGithub({ archived: false, pushed_at: "2026-09-30T00:00:00Z" }, { tag_name: "bun-v1.3.0", published_at: "2026-09-10T00:00:00Z" }, "oven-sh/bun")?.latest_version).toBe("1.3.0");
  });
});

describe("technologies the user named bind the recommendation", () => {
  const layer = (category: string, technology: string) => ({ category, technology, version_constraint: null, rationale: "x" });
  const kasir = {
    mode: "RECOMMENDED" as const,
    recommendation_index: 0,
    rationale: "Native wins for the printer.",
    conflicts: [],
    candidates: [
      { name: "Native Android (Kotlin)", fit_assessment: "x", tradeoffs: [], layers: [layer("Frontend", "Jetpack Compose"), layer("Database", "SQLite")] },
      { name: "React Native (Bare CLI)", fit_assessment: "x", tradeoffs: [], layers: [layer("Frontend", "React Native"), layer("Database", "SQLite")] },
    ],
  };
  test("'Native Android; React Native' names React Native only (a platform phrase is no technology)", () => {
    expect(namedTechnologies(["Native Android", "React Native"]).map((o) => o.name)).toEqual(["React Native"]);
    expect(namedTechnologies(["Use PostgreSQL and Next.js"]).map((o) => o.name).sort()).toEqual(["Next.js", "PostgreSQL"]);
    expect(namedTechnologies(["offline-first tablet app"])).toEqual([]);
  });
  test("a recommendation that drops a named technology is an issue, and the candidate that uses it is recommended", () => {
    const decision = StackDecisionSchema.parse(kasir);
    const named = namedTechnologies(["Native Android", "React Native"]);
    expect(namedIssues(decision, named)).toHaveLength(1);
    expect(stackRepairInstruction("2026-10-01", namedIssues(decision, named), false)).toContain("binding");
    const fixed = honourNamed(decision, named);
    expect(fixed.recommendation_index).toBe(1);
    expect(fixed.rationale).toContain("React Native");
    expect(namedIssues(fixed, named)).toHaveLength(0);
  });
  test("usesTechnology does not count React for React Native", () => {
    const option = namedTechnologies(["React Native"])[0]!;
    expect(usesTechnology([{ technology: "React + Vite" }], option)).toBe(false);
    expect(usesTechnology([{ technology: "React Native (Expo)" }], option)).toBe(true);
  });
});
