-- Older duplicates from before the project row lock: the app reads the newest
-- ACTIVE session (getActiveSession), so the others are abandoned first.
UPDATE "discovery_sessions" AS s SET "status" = 'ABANDONED'
WHERE s."status" = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "discovery_sessions" AS n
    WHERE n."project_id" = s."project_id" AND n."status" = 'ACTIVE'
      AND (n."created_at", n."id") > (s."created_at", s."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_sessions_one_active" ON "discovery_sessions" USING btree ("project_id") WHERE "discovery_sessions"."status" = 'ACTIVE';
