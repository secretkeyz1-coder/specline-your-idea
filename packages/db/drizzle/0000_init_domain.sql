CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_operator" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'MEMBER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"priority" text DEFAULT 'P1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_counters" (
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"high_level_idea" text NOT NULL,
	"constraints" text[] DEFAULT '{}' NOT NULL,
	"lifecycle_status" text DEFAULT 'IDEA_DRAFT' NOT NULL,
	"active_requirements_revision_id" uuid,
	"active_stack_revision_id" uuid,
	"active_design_revision_id" uuid,
	"project_rules" text[] DEFAULT '{}' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"answered_by" uuid,
	"answer" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_assumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"description" text NOT NULL,
	"impact" text DEFAULT '' NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"description" text NOT NULL,
	"related_keys" text[] DEFAULT '{}' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"fact_key" text NOT NULL,
	"value" text NOT NULL,
	"source_type" text DEFAULT 'DERIVED' NOT NULL,
	"source_ref" uuid,
	"confidence" text DEFAULT 'HIGH' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"topic" text NOT NULL,
	"question_text" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"answer_type" text DEFAULT 'TEXT' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"impact" text DEFAULT 'high' NOT NULL,
	"blocking" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"readiness" text DEFAULT 'INCOMPLETE' NOT NULL,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"understanding" text DEFAULT '' NOT NULL,
	"started_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "acceptance_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" uuid NOT NULL,
	"key" text NOT NULL,
	"statement" text NOT NULL,
	"verification_type" text DEFAULT 'TEST' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_format" text DEFAULT 'json' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"structured_content" jsonb,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"derived_from" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_generation_run_id" uuid,
	"checksum" text NOT NULL,
	"created_by_actor_type" text DEFAULT 'AI' NOT NULL,
	"created_by_actor_id" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text DEFAULT '' NOT NULL,
	CONSTRAINT "artifact_revisions_approved_has_actor" CHECK ("artifact_revisions"."status" <> 'APPROVED' OR "artifact_revisions"."approved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"feature_id" uuid,
	"artifact_type" text NOT NULL,
	"title" text NOT NULL,
	"current_draft_revision_id" uuid,
	"approved_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"feature_id" uuid,
	"artifact_revision_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" text DEFAULT 'FUNCTIONAL' NOT NULL,
	"title" text NOT NULL,
	"statement" text NOT NULL,
	"priority" text DEFAULT 'P1' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stack_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"stack_revision_id" uuid NOT NULL,
	"category" text NOT NULL,
	"technology" text NOT NULL,
	"version_constraint" text,
	"selection_source" text DEFAULT 'USER_SELECTED' NOT NULL,
	"locked_by_user" boolean DEFAULT false NOT NULL,
	"rationale" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	"dependency_type" text DEFAULT 'FINISH_TO_START' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id"),
	CONSTRAINT "task_dependencies_no_self" CHECK ("task_dependencies"."task_id" <> "task_dependencies"."depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"task_id" uuid NOT NULL,
	"run_id" uuid,
	"client_sequence" bigint,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"executor_id" text NOT NULL,
	"executor_type" text DEFAULT 'LOCAL_AGENT' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_requirement_links" (
	"task_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"acceptance_criterion_id" uuid,
	CONSTRAINT "task_requirement_links_task_id_requirement_id_acceptance_criterion_id_pk" PRIMARY KEY("task_id","requirement_id","acceptance_criterion_id")
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"executor_type" text DEFAULT 'LOCAL_AGENT' NOT NULL,
	"executor_id" text NOT NULL,
	"execution_agent_profile_id" uuid,
	"machine_id" uuid,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"exit_code" integer,
	"summary" text,
	"commit_sha" text,
	"files_changed" text[] DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"feature_id" uuid,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"task_type" text DEFAULT 'code' NOT NULL,
	"workflow_status" text DEFAULT 'DRAFT' NOT NULL,
	"execution_result" text DEFAULT 'NONE' NOT NULL,
	"attention_status" text DEFAULT 'NONE' NOT NULL,
	"priority" text DEFAULT 'P1' NOT NULL,
	"hardness" smallint DEFAULT 1 NOT NULL,
	"risk_level" text DEFAULT 'LOW' NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"contract" jsonb NOT NULL,
	"risk_factors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parallel_safe" boolean DEFAULT false NOT NULL,
	"created_from_revision_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"readiness_status" text DEFAULT 'NOT_READY' NOT NULL,
	"readiness_report" jsonb DEFAULT '{"ok":false,"checks":[]}'::jsonb NOT NULL,
	"review_policy" text DEFAULT 'HUMAN_OR_APPROVED_REVIEWER' NOT NULL,
	"lint_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"superseded_by_id" uuid,
	"split_from_id" uuid,
	"merged_from_ids" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_no_self_supersede" CHECK ("tasks"."superseded_by_id" IS NULL OR "tasks"."superseded_by_id" <> "tasks"."id")
);
--> statement-breakpoint
CREATE TABLE "test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"command" text NOT NULL,
	"suite" text,
	"status" text NOT NULL,
	"exit_code" integer,
	"duration_ms" bigint,
	"summary" text,
	"artifact_ref" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid,
	"reviewer_type" text DEFAULT 'USER' NOT NULL,
	"reviewer_id" text NOT NULL,
	"decision" text NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_links" (
	"bug_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	CONSTRAINT "bug_links_bug_id_entity_type_entity_id_pk" PRIMARY KEY("bug_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "bugs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"feature_id" uuid,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'REPORTED' NOT NULL,
	"severity" text DEFAULT 'MAJOR' NOT NULL,
	"current_behavior" text NOT NULL,
	"expected_behavior" text NOT NULL,
	"unchanged_behavior" text DEFAULT '' NOT NULL,
	"reproduction" text NOT NULL,
	"fix_task_id" uuid,
	"blocked_convergence" text[] DEFAULT '{}' NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_actor_type" text DEFAULT 'USER' NOT NULL,
	"created_by_actor_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convergence_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"convergence_run_id" uuid NOT NULL,
	"finding_type" text NOT NULL,
	"severity" text NOT NULL,
	"source_ref" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"requirement_key" text,
	"acceptance_criterion_key" text,
	"resolution_status" text DEFAULT 'OPEN' NOT NULL,
	"generated_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convergence_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_id" uuid NOT NULL,
	"requirements_revision_id" uuid NOT NULL,
	"design_revision_id" uuid,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"completion_recommended" text DEFAULT 'NO' NOT NULL,
	"ai_generation_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "execution_agent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"adapter_type" text DEFAULT 'generic_shell' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fingerprint" text NOT NULL,
	"platform" text DEFAULT '' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'OFFLINE' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"repo_fingerprint" text NOT NULL,
	"display_path" text NOT NULL,
	"default_branch" text,
	"permission_mode" text DEFAULT 'MANUAL' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"artifact_id" uuid,
	"role" text NOT NULL,
	"ai_profile_id" uuid,
	"provider_connection_id" uuid,
	"model_id" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"latency_ms" bigint,
	"input_units" bigint,
	"output_units" bigint,
	"error_code" text,
	"trace_id" text,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text DEFAULT 'WORKSPACE' NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"required_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text DEFAULT 'WORKSPACE' NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"provider_type" text NOT NULL,
	"base_url" text,
	"encrypted_credential_ref" text,
	"credential_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"public_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_secret_headers_ref" text,
	"timeout_ms" integer DEFAULT 120000 NOT NULL,
	"capabilities" jsonb DEFAULT '{"structured_output":true,"tool_calling":false,"vision":false,"streaming":false}'::jsonb NOT NULL,
	"custom_http_mapping" jsonb,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"last_test_status" text,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_connections_scope_workspace" CHECK ("ai_provider_connections"."scope_type" <> 'WORKSPACE' OR "ai_provider_connections"."workspace_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ai_role_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text DEFAULT 'WORKSPACE' NOT NULL,
	"workspace_id" uuid,
	"project_id" uuid,
	"role" text NOT NULL,
	"ai_profile_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"recipient_user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"read_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"workspace_id" uuid,
	"project_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cli_auth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"user_id" uuid,
	"api_token_id" uuid,
	"pending_token" text,
	"client_name" text DEFAULT 'sddctl' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_counters" ADD CONSTRAINT "project_counters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_answers" ADD CONSTRAINT "discovery_answers_question_id_discovery_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."discovery_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_answers" ADD CONSTRAINT "discovery_answers_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_assumptions" ADD CONSTRAINT "discovery_assumptions_session_id_discovery_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."discovery_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_assumptions" ADD CONSTRAINT "discovery_assumptions_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_contradictions" ADD CONSTRAINT "discovery_contradictions_session_id_discovery_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."discovery_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_facts" ADD CONSTRAINT "discovery_facts_session_id_discovery_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."discovery_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_questions" ADD CONSTRAINT "discovery_questions_session_id_discovery_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."discovery_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_sessions" ADD CONSTRAINT "discovery_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_sessions" ADD CONSTRAINT "discovery_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_artifact_revision_id_artifact_revisions_id_fk" FOREIGN KEY ("artifact_revision_id") REFERENCES "public"."artifact_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_components" ADD CONSTRAINT "stack_components_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_components" ADD CONSTRAINT "stack_components_stack_revision_id_artifact_revisions_id_fk" FOREIGN KEY ("stack_revision_id") REFERENCES "public"."artifact_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_leases" ADD CONSTRAINT "task_leases_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requirement_links" ADD CONSTRAINT "task_requirement_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requirement_links" ADD CONSTRAINT "task_requirement_links_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requirement_links" ADD CONSTRAINT "task_requirement_links_acceptance_criterion_id_acceptance_criteria_id_fk" FOREIGN KEY ("acceptance_criterion_id") REFERENCES "public"."acceptance_criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_machine_id_local_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."local_machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."task_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_links" ADD CONSTRAINT "bug_links_bug_id_bugs_id_fk" FOREIGN KEY ("bug_id") REFERENCES "public"."bugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convergence_findings" ADD CONSTRAINT "convergence_findings_convergence_run_id_convergence_runs_id_fk" FOREIGN KEY ("convergence_run_id") REFERENCES "public"."convergence_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convergence_findings" ADD CONSTRAINT "convergence_findings_generated_task_id_tasks_id_fk" FOREIGN KEY ("generated_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convergence_runs" ADD CONSTRAINT "convergence_runs_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convergence_runs" ADD CONSTRAINT "convergence_runs_requirements_revision_id_artifact_revisions_id_fk" FOREIGN KEY ("requirements_revision_id") REFERENCES "public"."artifact_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convergence_runs" ADD CONSTRAINT "convergence_runs_design_revision_id_artifact_revisions_id_fk" FOREIGN KEY ("design_revision_id") REFERENCES "public"."artifact_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_agent_profiles" ADD CONSTRAINT "execution_agent_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_machines" ADD CONSTRAINT "local_machines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_links" ADD CONSTRAINT "repository_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_links" ADD CONSTRAINT "repository_links_machine_id_local_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."local_machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_ai_profile_id_ai_profiles_id_fk" FOREIGN KEY ("ai_profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_provider_connection_id_ai_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."ai_provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_profiles" ADD CONSTRAINT "ai_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_profiles" ADD CONSTRAINT "ai_profiles_provider_connection_id_ai_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."ai_provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_connections" ADD CONSTRAINT "ai_provider_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_role_bindings" ADD CONSTRAINT "ai_role_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_role_bindings" ADD CONSTRAINT "ai_role_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_role_bindings" ADD CONSTRAINT "ai_role_bindings_ai_profile_id_ai_profiles_id_fk" FOREIGN KEY ("ai_profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_role_bindings" ADD CONSTRAINT "ai_role_bindings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_auth_codes" ADD CONSTRAINT "cli_auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_auth_codes" ADD CONSTRAINT "cli_auth_codes_api_token_id_api_tokens_id_fk" FOREIGN KEY ("api_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_unique" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_unique" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "features_project_key_unique" ON "features" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_counters_unique" ON "project_counters" USING btree ("project_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_key_unique" ON "projects" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "discovery_answers_question_idx" ON "discovery_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "discovery_assumptions_session_idx" ON "discovery_assumptions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "discovery_contradictions_session_idx" ON "discovery_contradictions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "discovery_facts_session_idx" ON "discovery_facts" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_facts_session_key_unique" ON "discovery_facts" USING btree ("session_id","fact_key");--> statement-breakpoint
CREATE INDEX "discovery_questions_session_idx" ON "discovery_questions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_questions_session_key_unique" ON "discovery_questions" USING btree ("session_id","question_key");--> statement-breakpoint
CREATE INDEX "discovery_sessions_project_idx" ON "discovery_sessions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acceptance_criteria_requirement_key_unique" ON "acceptance_criteria" USING btree ("requirement_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_revisions_version_unique" ON "artifact_revisions" USING btree ("artifact_id","version");--> statement-breakpoint
CREATE INDEX "artifact_revisions_artifact_idx" ON "artifact_revisions" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_project_type_unique" ON "artifacts" USING btree ("project_id","artifact_type");--> statement-breakpoint
CREATE UNIQUE INDEX "requirements_revision_key_unique" ON "requirements" USING btree ("artifact_revision_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "stack_components_revision_category_unique" ON "stack_components" USING btree ("stack_revision_id","category");--> statement-breakpoint
CREATE INDEX "task_dependencies_dep_idx" ON "task_dependencies" USING btree ("depends_on_task_id");--> statement-breakpoint
CREATE INDEX "task_events_task_idx" ON "task_events" USING btree ("task_id","id");--> statement-breakpoint
CREATE INDEX "task_events_run_idx" ON "task_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_events_idempotency_unique" ON "task_events" USING btree ("idempotency_key") WHERE "task_events"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_events_client_sequence_unique" ON "task_events" USING btree ("run_id","client_sequence") WHERE "task_events"."run_id" IS NOT NULL AND "task_events"."client_sequence" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "task_leases_task_idx" ON "task_leases" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_leases_one_active_unique" ON "task_leases" USING btree ("task_id") WHERE "task_leases"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "task_requirement_links_req_idx" ON "task_requirement_links" USING btree ("requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_runs_attempt_unique" ON "task_runs" USING btree ("task_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_key_unique" ON "tasks" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "tasks" USING btree ("project_id","workflow_status");--> statement-breakpoint
CREATE INDEX "tasks_feature_idx" ON "tasks" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "test_results_run_idx" ON "test_results" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_idempotency_unique" ON "test_results" USING btree ("idempotency_key") WHERE "test_results"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reviews_task_idx" ON "reviews" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "bug_links_entity_idx" ON "bug_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bugs_project_key_unique" ON "bugs" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "bugs_project_status_idx" ON "bugs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "convergence_findings_run_idx" ON "convergence_findings" USING btree ("convergence_run_id");--> statement-breakpoint
CREATE INDEX "convergence_runs_feature_idx" ON "convergence_runs" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "execution_agent_profiles_owner_idx" ON "execution_agent_profiles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "local_machines_user_fingerprint_unique" ON "local_machines" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "local_machines_user_idx" ON "local_machines" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_links_project_machine_unique" ON "repository_links" USING btree ("project_id","machine_id");--> statement-breakpoint
CREATE INDEX "repository_links_machine_idx" ON "repository_links" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "ai_generation_runs_workspace_idx" ON "ai_generation_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ai_generation_runs_project_idx" ON "ai_generation_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_profiles_workspace_idx" ON "ai_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ai_provider_connections_workspace_idx" ON "ai_provider_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_role_bindings_scope_role_unique" ON "ai_role_bindings" USING btree ("scope_type","workspace_id","project_id","role");--> statement-breakpoint
CREATE INDEX "ai_role_bindings_project_idx" ON "ai_role_bindings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_events_workspace_time_idx" ON "audit_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_project_idx" ON "audit_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_unique" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_auth_codes_device_hash_unique" ON "cli_auth_codes" USING btree ("device_code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_auth_codes_user_code_unique" ON "cli_auth_codes" USING btree ("user_code");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");