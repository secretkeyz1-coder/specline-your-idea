ALTER TABLE "convergence_runs" ADD COLUMN "coverage" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "convergence_findings" ADD COLUMN "suggested_task" jsonb;
