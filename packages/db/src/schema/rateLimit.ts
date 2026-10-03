import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/* Shared fixed-window rate-limit buckets (T199).
 *
 * These live in PostgreSQL rather than process memory so the limit holds across
 * every API replica: an in-memory Map only rate-limits the instance that happens
 * to receive the request, which makes auth brute-force protection ineffective
 * behind a load balancer. */

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    /** `${scope}:${key}` — e.g. `AUTH:login:ip:203.0.113.4`. */
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Supports the periodic sweep of expired buckets.
    index("rate_limit_buckets_reset_idx").on(t.resetAt),
  ],
);
