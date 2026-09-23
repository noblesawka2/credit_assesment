CREATE TABLE public.credit_manual_verifications (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.credit_applications(id),
  case_revision integer NOT NULL CHECK (case_revision > 1),
  ciphertext text NOT NULL,
  created_by uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (application_id, case_revision),
  UNIQUE (created_by, idempotency_key)
);
CREATE TRIGGER credit_manual_immutable BEFORE UPDATE OR DELETE ON public.credit_manual_verifications
  FOR EACH ROW EXECUTE FUNCTION public.credit_deny_mutation();
CREATE TRIGGER credit_manual_no_truncate BEFORE TRUNCATE ON public.credit_manual_verifications
  FOR EACH STATEMENT EXECUTE FUNCTION public.credit_deny_mutation();
ALTER TABLE public.credit_manual_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_manual_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_manual_read ON public.credit_manual_verifications FOR SELECT USING (
  current_setting('nobles.can_verify',true) = 'true' AND EXISTS (
    SELECT 1 FROM public.credit_applications WHERE id=application_id
    AND current_setting('nobles.actor_id',true) = ANY(assigned_user_ids::text[])
  )
);
CREATE POLICY credit_manual_insert ON public.credit_manual_verifications FOR INSERT WITH CHECK (
  current_setting('nobles.can_verify',true) = 'true'
  AND created_by::text = current_setting('nobles.actor_id',true)
  AND EXISTS (SELECT 1 FROM public.credit_applications WHERE id=application_id AND revision=case_revision
    AND current_setting('nobles.actor_id',true) = ANY(assigned_user_ids::text[]))
);
REVOKE ALL ON public.credit_manual_verifications FROM PUBLIC, anon, authenticated, service_role;
