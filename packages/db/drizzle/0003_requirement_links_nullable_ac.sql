-- 0001 rebuilt the task_requirement_links primary key around a surrogate id
-- and added a partial unique index for `acceptance_criterion_id IS NULL`, but
-- never dropped the column's NOT NULL — so requirement-only links (no
-- acceptance criterion) violated the constraint at runtime. Align the column
-- with the drizzle schema (nullable).
ALTER TABLE "task_requirement_links" ALTER COLUMN "acceptance_criterion_id" DROP NOT NULL;
