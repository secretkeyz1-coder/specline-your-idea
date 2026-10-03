import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDb>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbExecutor = Database | Transaction;
export type { ProviderCapabilities, CustomHttpMapping } from "./schema/ai.js";

export { schema };

/**
 * Bun SQL + Drizzle (docs/07 §4). One SQL pool per process; close() on shutdown.
 */
export function createDb(url: string) {
  const client = new SQL(url, { max: 20, idleTimeout: 30 });
  const db = drizzle({ client, schema, casing: "snake_case" });
  return Object.assign(db, {
    /** Close underlying pool (shutdown/tests). */
    async close() {
      await client.close();
    },
    /** Liveness probe distinct from process liveness (T207). */
    async ping(): Promise<boolean> {
      const result = await client`SELECT 1 AS ok`;
      return Array.isArray(result) && result.length === 1;
    },
    /** Readiness includes schema presence, not merely a live connection. */
    async schemaReady(): Promise<boolean> {
      // Probe a table from the first AND the latest migrations: `users` alone
      // reported "ready" on a database that missed later migrations, which then
      // surfaced as 500s (e.g. rate_limit_buckets on every auth route).
      const result = await client`SELECT (
        to_regclass('public.users') IS NOT NULL
        AND to_regclass('public.rate_limit_buckets') IS NOT NULL
        AND to_regclass('public.pairing_code_uses') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'convergence_runs' AND column_name = 'coverage')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'convergence_findings' AND column_name = 'suggested_task')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'delivery_lock_token')
      ) AS ok`;
      return Boolean((result as Array<{ ok: boolean }>)[0]?.ok);
    },
  });
}

export type SddDatabase = ReturnType<typeof createDb>;
