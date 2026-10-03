-- Audit hardening (security + workflow review, 2026-09).
--  * pairing_code_uses: single-use ledger for HMAC pairing codes (nonce).
--  * api_tokens.machine_id: machine-bound tokens die with the machine on revoke.
--  * discovery_answers: exactly one answer per question (answers are replaced).
CREATE TABLE "pairing_code_uses" (
	"nonce" text PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"machine_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "discovery_answers_question_idx";--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "machine_id" uuid;--> statement-breakpoint
ALTER TABLE "pairing_code_uses" ADD CONSTRAINT "pairing_code_uses_machine_id_local_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."local_machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_machine_id_local_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."local_machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Keep only the newest answer per question before enforcing uniqueness.
DELETE FROM "discovery_answers" a
USING "discovery_answers" b
WHERE a."question_id" = b."question_id"
  AND (a."created_at" < b."created_at" OR (a."created_at" = b."created_at" AND a."id" < b."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_answers_question_unique" ON "discovery_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "api_tokens_machine_idx" ON "api_tokens" USING btree ("machine_id");