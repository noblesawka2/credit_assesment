ALTER TABLE nobles_security.events DROP CONSTRAINT events_action_check;
ALTER TABLE nobles_security.events ADD CONSTRAINT events_action_check CHECK (action IN (
  'LOGIN_SUCCESS','LOGIN_FAILURE','SIGN_OUT','SESSION_REJECTED','PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_DELIVERY_FAILED','PASSWORD_RESET_STARTED','PASSWORD_RESET_SUCCESS','PASSWORD_RESET_FAILURE',
  'AUTHORIZATION_DENIED','RATE_LIMITED','SENSITIVE_ACCESS',
  'INVITATION_ACCEPTANCE_STARTED','INVITATION_ACCEPTED','INVITATION_ACCEPTANCE_FAILED','OVERVIEW_READ'
));
CREATE TABLE nobles_security.staff_admin_audit (
  id uuid PRIMARY KEY,
  actor_id uuid,
  source text NOT NULL CHECK (source IN ('AUTHENTICATED_SUPERUSER','AUTHORIZED_LOCAL_BOOTSTRAP')),
  action text NOT NULL CHECK (action IN ('STAFF_INVITE_REQUESTED','STAFF_INVITE_SENT','STAFF_INVITE_FAILED','STAFF_DIRECTORY_READ')),
  correlation_id uuid NOT NULL,
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER staff_admin_immutable BEFORE UPDATE OR DELETE ON nobles_security.staff_admin_audit
  FOR EACH ROW EXECUTE FUNCTION nobles_security.deny_event_mutation();
CREATE TRIGGER staff_admin_no_truncate BEFORE TRUNCATE ON nobles_security.staff_admin_audit
  FOR EACH STATEMENT EXECUTE FUNCTION nobles_security.deny_event_mutation();
REVOKE ALL ON nobles_security.staff_admin_audit FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY credit_ceo_overview ON public.credit_applications FOR SELECT
  USING (current_setting('nobles.can_overview',true)='true');
CREATE POLICY credit_readiness_policy ON public.credit_policy_versions FOR SELECT USING (
  current_setting('nobles.can_readiness',true)='true' AND status='PUBLISHED'
  AND unresolved='[]'::jsonb AND effective_at <= now()
);
CREATE TABLE public.credit_readiness_results (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.credit_applications(id),
  case_revision integer NOT NULL CHECK (case_revision>0),
  created_by uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(created_by,idempotency_key)
);
ALTER TABLE public.credit_readiness_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_readiness_results FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_readiness_read ON public.credit_readiness_results FOR SELECT USING (
  EXISTS(SELECT 1 FROM public.credit_applications WHERE id=application_id)
);
CREATE POLICY credit_readiness_insert ON public.credit_readiness_results FOR INSERT WITH CHECK (
  current_setting('nobles.can_readiness',true)='true' AND created_by::text=current_setting('nobles.actor_id',true)
  AND EXISTS(SELECT 1 FROM public.credit_applications WHERE id=application_id AND revision=case_revision
    AND current_setting('nobles.actor_id',true)=ANY(assigned_user_ids::text[]))
);
CREATE TRIGGER readiness_immutable BEFORE UPDATE OR DELETE ON public.credit_readiness_results
  FOR EACH ROW EXECUTE FUNCTION public.credit_deny_mutation();
CREATE TRIGGER readiness_no_truncate BEFORE TRUNCATE ON public.credit_readiness_results
  FOR EACH STATEMENT EXECUTE FUNCTION public.credit_deny_mutation();
REVOKE ALL ON public.credit_readiness_results FROM PUBLIC, anon, authenticated, service_role;
DO $migration$
DECLARE runtime_role text := current_setting('nobles.runtime_role');
BEGIN
  IF runtime_role !~ '^[a-z][a-z0-9_]{0,62}$' OR runtime_role=current_user THEN RAISE EXCEPTION 'INVALID_RUNTIME_ROLE'; END IF;
  EXECUTE format('GRANT INSERT ON nobles_security.staff_admin_audit TO %I',runtime_role);
  EXECUTE format('GRANT SELECT ON public.credit_policy_versions TO %I',runtime_role);
  EXECUTE format('GRANT SELECT,INSERT ON public.credit_readiness_results TO %I',runtime_role);
END;
$migration$;
