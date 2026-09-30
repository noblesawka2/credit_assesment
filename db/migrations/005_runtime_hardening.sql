DO $migration$
DECLARE
  runtime_role text := current_setting('nobles.runtime_role');
  table_name text;
BEGIN
  IF runtime_role !~ '^[a-z][a-z0-9_]{0,62}$' OR runtime_role = current_user THEN
    RAISE EXCEPTION 'INVALID_RUNTIME_ROLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=runtime_role AND rolcanlogin) OR EXISTS (
    SELECT 1 FROM pg_roles WHERE pg_has_role(runtime_role, oid, 'MEMBER')
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN RAISE EXCEPTION 'PRIVILEGED_RUNTIME_ROLE_FORBIDDEN'; END IF;
  FOREACH table_name IN ARRAY ARRAY['credit_applications','credit_audit_logs','credit_idempotency',
    'credit_verified_revisions','credit_policy_versions','credit_assessment_snapshots',
    'credit_repayment_outcomes','credit_manual_verifications','nobles_credit_migrations'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role, %I', table_name, runtime_role);
  END LOOP;
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA nobles_security FROM %I', runtime_role);
  EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', runtime_role);
  EXECUTE format('GRANT USAGE ON SCHEMA public, nobles_security TO %I', runtime_role);
  EXECUTE format('GRANT SELECT ON public.credit_applications, public.credit_audit_logs, public.credit_idempotency, public.credit_manual_verifications, public.nobles_credit_migrations TO %I', runtime_role);
  EXECUTE format('GRANT INSERT (id, external_member_id, created_by, updated_by, assigned_user_ids, reported_ciphertext, requested_amount_kobo) ON public.credit_applications TO %I', runtime_role);
  EXECUTE format('GRANT UPDATE (reported_ciphertext, requested_amount_kobo, revision, updated_by, updated_at) ON public.credit_applications TO %I', runtime_role);
  EXECUTE format('GRANT INSERT ON public.credit_audit_logs, public.credit_idempotency, public.credit_manual_verifications TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT ON nobles_security.sessions, nobles_security.revocations, nobles_security.rate_limits TO %I', runtime_role);
  EXECUTE format('GRANT UPDATE (revoked_at) ON nobles_security.sessions, nobles_security.revocations TO %I', runtime_role);
  EXECUTE format('GRANT UPDATE (hits, expires_at) ON nobles_security.rate_limits TO %I', runtime_role);
  EXECUTE format('GRANT INSERT ON nobles_security.events TO %I', runtime_role);
END;
$migration$;
REVOKE ALL ON FUNCTION public.credit_deny_mutation(), public.credit_protect_originals(), public.credit_protect_policy() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER credit_audit_no_truncate BEFORE TRUNCATE ON public.credit_audit_logs FOR EACH STATEMENT EXECUTE FUNCTION public.credit_deny_mutation();
CREATE TRIGGER credit_verified_no_truncate BEFORE TRUNCATE ON public.credit_verified_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.credit_deny_mutation();
CREATE TRIGGER credit_snapshot_no_truncate BEFORE TRUNCATE ON public.credit_assessment_snapshots FOR EACH STATEMENT EXECUTE FUNCTION public.credit_deny_mutation();
CREATE TRIGGER credit_outcome_no_truncate BEFORE TRUNCATE ON public.credit_repayment_outcomes FOR EACH STATEMENT EXECUTE FUNCTION public.credit_deny_mutation();
