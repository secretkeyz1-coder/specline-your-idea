-- Idempotent repair of legacy top-level string-encoded containers only.
-- Never touch text columns, nested strings, checksums, valid containers or scalars.
-- Each malformed/wrong-shape/depth-exceeded row is isolated and reported by id
-- with RAISE WARNING (no payload/secrets). Operators retain migration logs and
-- investigate these rows explicitly; no destructive fallback is substituted.
DO $$
DECLARE
  spec record; row_value record; decoded jsonb; depth integer;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('artifact_revisions','structured_content','container'),
    ('artifact_revisions','derived_from','array'),
    ('requirements','metadata','object'), ('acceptance_criteria','metadata','object'),
    ('audit_events','metadata','object'), ('bugs','notes','array'),
    ('convergence_runs','coverage','array'), ('convergence_findings','suggested_task','object'),
    ('discovery_sessions','coverage','object'), ('discovery_questions','options','array'),
    ('discovery_answers','answer','object'),
    ('local_machines','capabilities','object'),
    ('execution_agent_profiles','capabilities','object'), ('execution_agent_profiles','default_config','object'),
    ('reviews','findings','array'), ('tasks','contract','object'), ('tasks','risk_factors','object'),
    ('tasks','created_from_revision_ids','array'), ('tasks','readiness_report','object'),
    ('tasks','lint_findings','array'), ('task_runs','metadata','object'), ('task_events','payload','object'),
    ('ai_provider_connections','credential_meta','object'), ('ai_provider_connections','public_headers','object'),
    ('ai_provider_connections','capabilities','object'), ('ai_provider_connections','custom_http_mapping','object'),
    ('ai_profiles','parameters','object'), ('ai_profiles','required_capabilities','array'),
    ('ai_generation_runs','request_metadata','object'), ('ai_generation_runs','response_metadata','object')
  ) AS columns(table_name, column_name, expected_shape)
  LOOP
    FOR row_value IN EXECUTE format('SELECT id, %I AS original FROM public.%I WHERE jsonb_typeof(%I) = ''string'' FOR UPDATE', spec.column_name, spec.table_name, spec.column_name)
    LOOP
      BEGIN
        decoded := row_value.original;
        FOR depth IN 1..4 LOOP
          EXIT WHEN jsonb_typeof(decoded) <> 'string';
          decoded := (decoded #>> '{}')::jsonb;
        END LOOP;
        IF (spec.expected_shape = 'container' AND jsonb_typeof(decoded) IN ('object','array'))
          OR jsonb_typeof(decoded) = spec.expected_shape THEN
          EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2', spec.table_name, spec.column_name) USING decoded, row_value.id;
        ELSE
          RAISE WARNING 'JSONB repair skipped %.% id=%: expected %, decoded shape %', spec.table_name, spec.column_name, row_value.id, spec.expected_shape, jsonb_typeof(decoded);
        END IF;
      EXCEPTION WHEN invalid_text_representation OR untranslatable_character OR numeric_value_out_of_range THEN
        -- Catch conversion errors only (22P02/22P05/22003), never mask schema,
        -- permissions, connection or other operational errors with OTHERS.
        RAISE WARNING 'JSONB repair skipped %.% id=%: invalid encoded JSON (SQLSTATE %)', spec.table_name, spec.column_name, row_value.id, SQLSTATE;
      END;
    END LOOP;
  END LOOP;
END $$;
