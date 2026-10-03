-- Shared fixed-window rate-limit buckets (T199).
--
-- The limiter previously kept its counters in a per-process Map, so it only
-- throttled whichever replica received the request: behind a load balancer an
-- attacker effectively multiplied the auth brute-force budget by the replica
-- count. Persist the buckets so the window is enforced instance-independently.
CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "rate_limit_buckets_reset_idx" ON "rate_limit_buckets" ("reset_at");
