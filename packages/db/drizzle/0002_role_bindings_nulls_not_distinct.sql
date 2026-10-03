-- Collapse duplicates first: the previous NULLS DISTINCT index never conflicted
-- when workspace_id/project_id was NULL, so SYSTEM/WORKSPACE bindings could
-- duplicate. Keep the most recently updated row per scope+role.
DELETE FROM "ai_role_bindings" AS "kept"
WHERE EXISTS (
  SELECT 1 FROM "ai_role_bindings" AS "newer"
  WHERE ("newer"."scope_type", "newer"."workspace_id", "newer"."project_id", "newer"."role")
    IS NOT DISTINCT FROM ("kept"."scope_type", "kept"."workspace_id", "kept"."project_id", "kept"."role")
    AND ("newer"."updated_at", "newer"."id") > ("kept"."updated_at", "kept"."id")
);--> statement-breakpoint
DROP INDEX "ai_role_bindings_scope_role_unique";--> statement-breakpoint
ALTER TABLE "ai_role_bindings" ADD CONSTRAINT "ai_role_bindings_scope_role_unique" UNIQUE NULLS NOT DISTINCT("scope_type","workspace_id","project_id","role");
