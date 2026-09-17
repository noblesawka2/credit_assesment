CREATE TABLE credit_applications (
  id uuid PRIMARY KEY,
  reference text UNIQUE CHECK (reference ~ '^NBL-CR-[0-9]{6}-[A-Z0-9]{6}$'),
  external_member_id text NOT NULL,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  assigned_user_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','SUBMITTED','PRELIMINARY_CHECK','RETURNED_FOR_INFORMATION','ASSIGNED','DESK_REVIEW',
    'FIELD_VERIFICATION_PENDING','FIELD_VERIFIED','ASSESSMENT_COMPLETED','CHECKER_REVIEW',
    'RETURNED_TO_CREDIT_OFFICER','PENDING_APPROVAL','CONDITIONALLY_APPROVED','APPROVED',
    'MEMBER_ACCEPTED','DISBURSEMENT_READY','DISBURSED','DEFERRED','DECLINED','WITHDRAWN',
    'DEFAULT_OUTCOME_RECORDED','CLOSED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  reported_ciphertext text NOT NULL,
  requested_amount_kobo numeric(24,0) NOT NULL CHECK (requested_amount_kobo >= 0),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_audit_logs (
  id uuid PRIMARY KEY,
  entity_id uuid NOT NULL REFERENCES credit_applications(id),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  old_revision integer,
  new_revision integer NOT NULL,
  reason text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_idempotency (
  actor_id uuid NOT NULL,
  key uuid NOT NULL,
  request_hash text NOT NULL,
  application_id uuid NOT NULL REFERENCES credit_applications(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, key)
);
CREATE TABLE credit_verified_revisions (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES credit_applications(id),
  revision integer NOT NULL CHECK (revision > 0),
  ciphertext text NOT NULL,
  evidence_document_id uuid NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(application_id, revision)
);
CREATE TABLE credit_policy_versions (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('PRODUCT','SCORE','AUTHORITY','ELIGIBILITY')),
  code text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','REJECTED')),
  payload jsonb NOT NULL,
  unresolved jsonb NOT NULL DEFAULT '[]',
  maker_id uuid NOT NULL,
  checker_id uuid,
  effective_at timestamptz NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'PUBLISHED' OR (checker_id IS NOT NULL AND checker_id <> maker_id AND published_at IS NOT NULL AND unresolved = '[]'::jsonb)),
  UNIQUE(kind, code, version)
);
CREATE TABLE credit_assessment_snapshots (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES credit_applications(id),
  application_reference text NOT NULL REFERENCES credit_applications(reference),
  product_version_id uuid NOT NULL REFERENCES credit_policy_versions(id),
  score_version_id uuid NOT NULL REFERENCES credit_policy_versions(id),
  engine_version text NOT NULL,
  ciphertext text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_repayment_outcomes (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES credit_assessment_snapshots(id),
  payload jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION credit_deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_CREDIT_RECORD';
END;
$$;
CREATE TRIGGER credit_audit_immutable BEFORE UPDATE OR DELETE ON credit_audit_logs FOR EACH ROW EXECUTE FUNCTION credit_deny_mutation();
CREATE TRIGGER credit_verified_immutable BEFORE UPDATE OR DELETE ON credit_verified_revisions FOR EACH ROW EXECUTE FUNCTION credit_deny_mutation();
CREATE TRIGGER credit_snapshot_immutable BEFORE UPDATE OR DELETE ON credit_assessment_snapshots FOR EACH ROW EXECUTE FUNCTION credit_deny_mutation();
CREATE TRIGGER credit_outcome_immutable BEFORE UPDATE OR DELETE ON credit_repayment_outcomes FOR EACH ROW EXECUTE FUNCTION credit_deny_mutation();
CREATE TRIGGER credit_application_no_delete BEFORE DELETE ON credit_applications FOR EACH ROW EXECUTE FUNCTION credit_deny_mutation();
CREATE TRIGGER credit_policy_no_delete BEFORE DELETE ON credit_policy_versions FOR EACH ROW EXECUTE FUNCTION credit_deny_mutation();
CREATE FUNCTION credit_protect_originals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL AND (NEW.reported_ciphertext IS DISTINCT FROM OLD.reported_ciphertext OR NEW.requested_amount_kobo IS DISTINCT FROM OLD.requested_amount_kobo OR NEW.external_member_id IS DISTINCT FROM OLD.external_member_id OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at) THEN
    RAISE EXCEPTION 'ORIGINAL_ANSWERS_IMMUTABLE';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'REVISION_REQUIRED'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER credit_originals_guard BEFORE UPDATE ON credit_applications FOR EACH ROW EXECUTE FUNCTION credit_protect_originals();
CREATE FUNCTION credit_protect_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'PUBLISHED_POLICY_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER credit_policy_guard BEFORE UPDATE ON credit_policy_versions FOR EACH ROW EXECUTE FUNCTION credit_protect_policy();
ALTER TABLE credit_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_assigned_access ON credit_applications USING (
  created_by::text = current_setting('nobles.actor_id', true)
  OR current_setting('nobles.actor_id', true) = ANY(assigned_user_ids::text[])
) WITH CHECK (
  created_by::text = current_setting('nobles.actor_id', true)
  OR current_setting('nobles.actor_id', true) = ANY(assigned_user_ids::text[])
);
ALTER TABLE credit_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_audit_access ON credit_audit_logs USING (
  EXISTS (SELECT 1 FROM credit_applications WHERE id = entity_id)
) WITH CHECK (actor_id::text = current_setting('nobles.actor_id', true) AND EXISTS (SELECT 1 FROM credit_applications WHERE id = entity_id));
ALTER TABLE credit_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_idempotency_access ON credit_idempotency USING (actor_id::text = current_setting('nobles.actor_id', true)) WITH CHECK (actor_id::text = current_setting('nobles.actor_id', true));
ALTER TABLE credit_verified_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_verified_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE credit_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE credit_assessment_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_assessment_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE credit_repayment_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_repayment_outcomes FORCE ROW LEVEL SECURITY;
