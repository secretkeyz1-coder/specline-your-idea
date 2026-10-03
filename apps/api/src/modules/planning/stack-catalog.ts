import type { StackPackage, StackVerification } from "@sdd/contracts";
import { refKey, stackRegistry } from "./stack-registry.js";

/**
 * The per-layer choices offered when the user sets the stack by hand, and
 * the facts handed to the recommender. Only names and registry ids are
 * curated here — never versions: every option's latest release, its date and
 * whether it is stale or deprecated come live from its registry, so the list
 * cannot silently age. Hosted services with nothing to install have no
 * package and read "unknown".
 *
 * Review the list itself (new entrants, renamed projects) now and then and
 * move STACK_CATALOG_REVIEWED_AT; the registry marks what has gone stale.
 */
export const STACK_CATALOG_REVIEWED_AT = "2026-10-01";

export interface CatalogOption {
  id: string;
  name: string;
  package: StackPackage | null;
  note?: string;
}

export interface CatalogLayer {
  category: string;
  /** Core layers are offered by default; the others are added when the product needs them. */
  core: boolean;
  options: CatalogOption[];
}

const npm = (name: string): StackPackage => ({ registry: "npm", name });
const pypi = (name: string): StackPackage => ({ registry: "pypi", name });
const crates = (name: string): StackPackage => ({ registry: "crates", name });
const gh = (name: string): StackPackage => ({ registry: "github", name });
const opt = (id: string, name: string, pkg: StackPackage | null, note?: string): CatalogOption => ({ id, name, package: pkg, ...(note ? { note } : {}) });

export const STACK_CATALOG: CatalogLayer[] = [
  {
    category: "Frontend",
    core: true,
    options: [
      opt("sveltekit", "SvelteKit", npm("@sveltejs/kit")),
      opt("nextjs", "Next.js", npm("next")),
      opt("nuxt", "Nuxt", npm("nuxt")),
      opt("react-router", "React Router (framework mode)", npm("react-router")),
      opt("tanstack-start", "TanStack Start", npm("@tanstack/react-start")),
      opt("astro", "Astro", npm("astro")),
      opt("solidstart", "SolidStart", npm("@solidjs/start")),
      opt("angular", "Angular", npm("@angular/core")),
      opt("react-vite", "React + Vite (SPA)", npm("react")),
      opt("vue-vite", "Vue + Vite (SPA)", npm("vue")),
      opt("flutter-web", "Flutter", gh("flutter/flutter")),
    ],
  },
  {
    category: "Backend / runtime",
    core: true,
    options: [
      opt("node", "Node.js", gh("nodejs/node")),
      opt("bun", "Bun", gh("oven-sh/bun")),
      opt("deno", "Deno", gh("denoland/deno")),
      opt("hono", "Hono", npm("hono")),
      opt("elysia", "Elysia", npm("elysia")),
      opt("fastify", "Fastify", npm("fastify")),
      opt("express", "Express", npm("express")),
      opt("nestjs", "NestJS", npm("@nestjs/core")),
      opt("fastapi", "FastAPI", pypi("fastapi")),
      opt("django", "Django", pypi("django")),
      opt("go", "Go", gh("golang/go")),
      opt("axum", "Axum (Rust)", crates("axum")),
      opt("laravel", "Laravel", gh("laravel/framework")),
      opt("rails", "Ruby on Rails", gh("rails/rails")),
      opt("spring-boot", "Spring Boot", gh("spring-projects/spring-boot")),
      opt("dotnet", "ASP.NET Core", gh("dotnet/aspnetcore")),
    ],
  },
  {
    category: "Data access / ORM",
    core: true,
    options: [
      opt("drizzle", "Drizzle ORM", npm("drizzle-orm")),
      opt("prisma", "Prisma", npm("prisma")),
      opt("kysely", "Kysely", npm("kysely")),
      opt("typeorm", "TypeORM", npm("typeorm")),
      opt("mikro-orm", "MikroORM", npm("@mikro-orm/core")),
      opt("sqlalchemy", "SQLAlchemy", pypi("sqlalchemy")),
      opt("sqlmodel", "SQLModel", pypi("sqlmodel")),
      opt("django-orm", "Django ORM", pypi("django")),
      opt("sqlx", "SQLx (Rust)", crates("sqlx")),
      opt("gorm", "GORM (Go)", gh("go-gorm/gorm")),
      opt("eloquent", "Eloquent (Laravel)", gh("laravel/framework")),
    ],
  },
  {
    category: "Database",
    core: true,
    options: [
      opt("postgresql", "PostgreSQL", gh("postgres/postgres")),
      opt("mysql", "MySQL", gh("mysql/mysql-server")),
      opt("mariadb", "MariaDB", gh("MariaDB/server")),
      opt("sqlite", "SQLite", gh("sqlite/sqlite")),
      opt("libsql", "libSQL / Turso", gh("tursodatabase/libsql")),
      opt("mongodb", "MongoDB", gh("mongodb/mongo")),
      opt("supabase", "Supabase (Postgres)", gh("supabase/supabase")),
      opt("neon", "Neon (serverless Postgres)", gh("neondatabase/neon")),
      opt("firestore", "Cloud Firestore", npm("firebase")),
      opt("valkey", "Valkey (Redis-compatible)", gh("valkey-io/valkey")),
    ],
  },
  {
    category: "Auth",
    core: true,
    options: [
      opt("better-auth", "Better Auth", npm("better-auth")),
      opt("authjs", "Auth.js", npm("@auth/core")),
      opt("clerk", "Clerk", npm("@clerk/backend")),
      opt("supabase-auth", "Supabase Auth", npm("@supabase/auth-js")),
      opt("firebase-auth", "Firebase Authentication", npm("firebase")),
      opt("workos", "WorkOS", npm("@workos-inc/node")),
      opt("keycloak", "Keycloak", gh("keycloak/keycloak")),
      opt("ory-kratos", "Ory Kratos", gh("ory/kratos")),
      opt("django-allauth", "django-allauth", pypi("django-allauth")),
      opt("lucia", "Lucia", npm("lucia")),
    ],
  },
  {
    category: "Testing",
    core: true,
    options: [
      opt("vitest", "Vitest", npm("vitest")),
      opt("playwright", "Playwright", npm("@playwright/test")),
      opt("bun-test", "bun test", gh("oven-sh/bun")),
      opt("jest", "Jest", npm("jest")),
      opt("testing-library", "Testing Library", npm("@testing-library/dom")),
      opt("cypress", "Cypress", npm("cypress")),
      opt("pytest", "pytest", pypi("pytest")),
    ],
  },
  {
    category: "Deployment",
    core: true,
    options: [
      opt("docker", "Docker (any host)", gh("moby/moby")),
      opt("vercel", "Vercel", npm("vercel")),
      opt("netlify", "Netlify", npm("netlify-cli")),
      opt("cloudflare", "Cloudflare Workers / Pages", npm("wrangler")),
      opt("fly", "Fly.io", gh("superfly/flyctl")),
      opt("railway", "Railway", npm("@railway/cli")),
      opt("render", "Render", null, "Hosted platform — nothing to install."),
      opt("coolify", "Coolify (self-hosted)", gh("coollabsio/coolify")),
      opt("aws-cdk", "AWS (CDK)", npm("aws-cdk-lib")),
      opt("kubernetes", "Kubernetes", gh("kubernetes/kubernetes")),
    ],
  },
  {
    category: "Realtime",
    core: false,
    options: [
      opt("socketio", "Socket.IO", npm("socket.io")),
      opt("ws", "ws (WebSockets)", npm("ws")),
      opt("supabase-realtime", "Supabase Realtime", npm("@supabase/realtime-js")),
      opt("liveblocks", "Liveblocks", npm("@liveblocks/client")),
      opt("partykit", "PartyKit", npm("partykit")),
      opt("ably", "Ably", npm("ably")),
      opt("pusher", "Pusher", npm("pusher")),
    ],
  },
  {
    category: "Background jobs",
    core: false,
    options: [
      opt("bullmq", "BullMQ", npm("bullmq")),
      opt("pg-boss", "pg-boss", npm("pg-boss")),
      opt("inngest", "Inngest", npm("inngest")),
      opt("trigger", "Trigger.dev", npm("@trigger.dev/sdk")),
      opt("temporal", "Temporal", npm("@temporalio/client")),
      opt("celery", "Celery", pypi("celery")),
    ],
  },
  {
    category: "Email",
    core: false,
    options: [
      opt("resend", "Resend", npm("resend")),
      opt("react-email", "React Email", npm("@react-email/components")),
      opt("nodemailer", "Nodemailer (SMTP)", npm("nodemailer")),
      opt("postmark", "Postmark", npm("postmark")),
      opt("sendgrid", "SendGrid", npm("@sendgrid/mail")),
    ],
  },
  {
    category: "File storage",
    core: false,
    options: [
      opt("s3", "S3-compatible (AWS S3, Cloudflare R2)", npm("@aws-sdk/client-s3")),
      opt("uploadthing", "UploadThing", npm("uploadthing")),
      opt("supabase-storage", "Supabase Storage", npm("@supabase/storage-js")),
      opt("minio", "MinIO (self-hosted)", gh("minio/minio")),
    ],
  },
  {
    category: "Payments",
    core: false,
    options: [
      opt("stripe", "Stripe", npm("stripe")),
      opt("paddle", "Paddle", npm("@paddle/paddle-node-sdk")),
      opt("lemonsqueezy", "Lemon Squeezy", npm("@lemonsqueezy/lemonsqueezy.js")),
      opt("midtrans", "Midtrans", npm("midtrans-client")),
      opt("xendit", "Xendit", npm("xendit-node")),
    ],
  },
  {
    category: "Search",
    core: false,
    options: [
      opt("meilisearch", "Meilisearch", npm("meilisearch")),
      opt("typesense", "Typesense", npm("typesense")),
      opt("algolia", "Algolia", npm("algoliasearch")),
      opt("elasticsearch", "Elasticsearch", npm("@elastic/elasticsearch")),
      opt("pg-fts", "PostgreSQL full-text search", null, "Built into PostgreSQL."),
    ],
  },
  {
    category: "Mobile",
    core: false,
    options: [
      opt("expo", "Expo (React Native)", npm("expo")),
      opt("react-native", "React Native", npm("react-native")),
      opt("flutter", "Flutter", gh("flutter/flutter")),
      opt("capacitor", "Capacitor", npm("@capacitor/core")),
    ],
  },
];

export type VerifiedOption = CatalogOption & { verified: StackVerification | null };
export type VerifiedLayer = Omit<CatalogLayer, "options"> & { options: VerifiedOption[] };

type Lookup = (refs: StackPackage[], deadlineMs?: number) => Promise<Map<string, StackVerification>>;

/**
 * The catalog with each option's live release facts. Nothing is hidden:
 * stale and deprecated options stay listed and say so. With `deadlineMs`,
 * options whose registry hasn't answered yet carry `verified: null`.
 */
export async function verifiedCatalog(opts: { deadlineMs?: number; lookupMany?: Lookup } = {}): Promise<VerifiedLayer[]> {
  const lookupMany: Lookup = opts.lookupMany ?? stackRegistry.lookupMany;
  const refs = STACK_CATALOG.flatMap((l) => l.options.map((o) => o.package).filter((p): p is StackPackage => p !== null));
  const facts = await lookupMany(refs, opts.deadlineMs);
  return STACK_CATALOG.map((layer) => ({
    ...layer,
    options: layer.options.map((o) => ({ ...o, verified: o.package ? (facts.get(refKey(o.package)) ?? null) : null })),
  }));
}

/** The catalog option a free-text technology names ("PostgreSQL 16" → postgresql), if any. */
export function matchCatalogOption(category: string, technology: string): CatalogOption | null {
  const tech = technology.trim().toLowerCase();
  if (!tech) return null;
  const layer = STACK_CATALOG.find((l) => l.category.toLowerCase() === category.trim().toLowerCase());
  const pools = layer ? [layer, ...STACK_CATALOG.filter((l) => l !== layer)] : STACK_CATALOG;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
  for (const pool of pools) {
    const exact = pool.options.find((o) => norm(o.name) === norm(tech) || o.id === tech || norm(o.name.split(" (")[0]!) === norm(tech));
    if (exact) return exact;
  }
  // "PostgreSQL 16", "Next.js App Router": the option's own name at the start.
  for (const pool of pools) {
    const prefix = pool.options.find((o) => norm(tech).startsWith(norm(o.name.split(" (")[0]!)));
    if (prefix) return prefix;
  }
  return null;
}

/** "Frontend: SvelteKit (npm:@sveltejs/kit) latest 2.1.0, released 2026-09-12 · …" — facts for the recommender. */
export function catalogFactLines(layers: VerifiedLayer[]): string[] {
  const date = (d: string | null | undefined) => (d ? d.slice(0, 10) : "date unknown");
  return layers.map((layer) => {
    const options = layer.options.map((o) => {
      const id = o.package ? ` (${o.package.registry}:${o.package.name})` : " (no package)";
      const v = o.verified;
      if (!o.package) return `${o.name}${id}`;
      if (!v || v.status === "unknown") return `${o.name}${id} — not checked`;
      if (v.status === "deprecated") return `${o.name}${id} — DEPRECATED${v.note ? `: ${v.note.slice(0, 80)}` : ""}`;
      const latest = v.latest_version ? `latest ${v.latest_version}` : "no tagged release";
      return `${o.name}${id} — ${latest}, ${v.status === "stale" ? "STALE, last release" : "released"} ${date(v.released_at)}`;
    });
    return `${layer.category}: ${options.join(" · ")}`;
  });
}

/**
 * Catalog technologies the user named in free text (constraints, project
 * rules): "React Native", "PostgreSQL". Whole words only, so "React Native"
 * never also counts as "React"; a platform phrase ("Native Android", "iOS")
 * names no technology and is ignored. A name inside a longer named one is dropped.
 */
export function namedTechnologies(texts: string[]): CatalogOption[] {
  const plain = (v: string) => v.toLowerCase().replace(/[^a-z0-9+.#]+/g, " ").trim();
  const hay = ` ${plain(texts.join(" "))} `;
  const names = (o: CatalogOption) =>
    [o.name.split(" (")[0]!, ...(/\(([^)]+)\)/.exec(o.name)?.slice(1) ?? [])].map(plain).filter((n) => n.length >= 3);
  // One option per matched name: "Expo (React Native)" and "React Native" both match "react native" — the one named exactly so wins.
  const byName = new Map<string, { option: CatalogOption; exact: boolean }>();
  for (const option of STACK_CATALOG.flatMap((l) => l.options)) {
    const name = names(option).find((n) => hay.includes(` ${n} `));
    if (!name) continue;
    const exact = plain(option.name.split(" (")[0]!) === name;
    const seen = byName.get(name);
    if (!seen || (exact && !seen.exact)) byName.set(name, { option, exact });
  }
  const found = [...byName.keys()];
  return found.filter((n) => !found.some((o) => o !== n && o.includes(n))).map((n) => byName.get(n)!.option);
}

/** Whether a candidate's layers use a catalog technology (by name or registry id). */
export function usesTechnology(layers: Array<{ technology: string; package?: { registry: string; name: string } | null }>, option: CatalogOption): boolean {
  const plain = (v: string) => v.toLowerCase().replace(/[^a-z0-9+.#]+/g, " ").trim();
  const name = plain(option.name.split(" (")[0]!);
  return layers.some(
    (l) =>
      ` ${plain(l.technology)} `.includes(` ${name} `) ||
      Boolean(option.package && l.package && l.package.registry === option.package.registry && l.package.name.toLowerCase() === option.package.name.toLowerCase()),
  );
}
