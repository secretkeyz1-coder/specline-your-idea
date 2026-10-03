ALTER TABLE "projects" ADD COLUMN "delivery_lock_token" uuid;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "delivery_lock_expires_at" timestamp with time zone;
--> statement-breakpoint
INSERT INTO "acceptance_criteria" ("requirement_id", "key", "statement", "verification_type")
SELECT r."id", 'AC-' || r."key" || '-1', r."statement", 'METRIC'
FROM "requirements" r
WHERE r."type" = 'NON_FUNCTIONAL'
AND NOT EXISTS (SELECT 1 FROM "acceptance_criteria" ac WHERE ac."requirement_id" = r."id");
