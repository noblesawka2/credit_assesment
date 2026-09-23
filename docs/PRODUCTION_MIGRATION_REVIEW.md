# Production migration review - awaiting approval

**NOT APPLIED.** The target is production. Certificate/hostname verification stays enabled with the user-supplied CA. Update 18 September: the read-only check authenticates; no credit tables, migration ledger or three named foundation-function collisions were found. The configured role has BYPASSRLS and cannot be the application runtime. See `BACKEND_READINESS_2026-09-18.md` for backend TLS observations. The new `db/proposals/002_staff_security.sql` is a separate, unapplied proposal NOT included in the reviewed runner below.

## Exact migration and integrity

Runner update: runtime and migration secrets are separated as documented in `DATABASE_CREDENTIALS.md`. Apply additionally requires explicit project and deployment-environment confirmation. The new `db/proposals/003_standalone_intake.sql` is also outside the runner, unapplied and separately reviewed in `STANDALONE_OPERATION.md`; it does not change the foundation SQL/checksum below. No production apply approval has been given.

- File: `db/migrations/001_credit_foundation.sql:1`.
- File SHA-256: `5723908376b09188e9889242058db1d6604f6c5a85e4188e9351563d0e5b34b2`.
- The SQL file is unchanged from the audited repository.
- Review the complete SQL below. `npm.cmd run migrate -- --plan` prints this source and the runner summary without connecting to any database.
- The supplied CA fingerprint (SHA-256) is `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, valid 28 April 2021 through 26 April 2031.

## Is it destructive?

**No destructive data operation is present. This is an additive schema migration, not a risk-free deployment.**

- Creates seven new credit tables: `credit_applications`, `credit_audit_logs`, `credit_idempotency`, `credit_verified_revisions`, `credit_policy_versions`, `credit_assessment_snapshots`, `credit_repayment_outcomes`.
- The runner creates `public.nobles_credit_migrations` if absent, then records the migration name/checksum.
- Creates three trigger functions and eight triggers enforcing append-only records, immutable originals after submission, revision increments and published-policy immutability.
- Enables and forces row-level security on all seven credit tables. Creates three policies; the four other tables remain default-deny until reviewed service policies exist.
- Performs no DROP, TRUNCATE, data DELETE, data UPDATE, member import, policy activation, loan approval or disbursement.
- Alters only the newly created credit tables to enable/force RLS. Existing same-name objects cause failure rather than being replaced. The transaction is rolled back on failure before a successful commit.
- New objects and a migration-history row remain after a successful COMMIT. Do not remove them with an unreviewed down migration.
- Triggers and RLS deliberately change which future writes are allowed. These behaviours need database integration tests.
- Default grants, inherited roles, schema ownership, migration-ledger access and Supabase Data API exposure still need review; do not assume the ledger is protected by RLS.
- Existing object collisions and provider-side event-trigger behaviour cannot be certified without a successful read-only preflight. There is no verified backup/restore rehearsal yet.

## Runner transaction, in execution order

The runner uses verified TLS, selects `public` as the transaction-local search path, uses a five-second lock timeout, and applies the unchanged SQL only if no matching migration receipt exists.

```sql
BEGIN;
SET LOCAL search_path TO public;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(782344200);
CREATE TABLE IF NOT EXISTS public.nobles_credit_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SELECT checksum
FROM public.nobles_credit_migrations
WHERE name = $1;
```

The SELECT parameter is `001_credit_foundation.sql`. If a receipt exists and its checksum matches, the runner skips the module SQL and commits without inserting a second receipt. A mismatched checksum aborts the transaction. If no receipt exists, it executes the following SQL, inserts the parameterised receipt shown afterward, then commits.

## Complete module SQL

```sql
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

```

## Receipt and commit after successful module SQL

```sql
INSERT INTO public.nobles_credit_migrations(name, checksum)
VALUES ($1, $2);
COMMIT;
```

Parameters: `$1 = 001_credit_foundation.sql`; `$2 = 5723908376b09188e9889242058db1d6604f6c5a85e4188e9351563d0e5b34b2`.

## Preconditions before requesting approval to apply

1. Correct the database credentials locally and pass `npm.cmd run db:check` without weakening TLS.
2. Verify a recent production backup and a rehearsed restore path, including any encrypted data keys.
3. Review current object-name collisions, default privileges and migration-history integrity.
4. Rehearse this exact checksum in staging and test non-privileged RLS, immutable records, rollback and idempotence.
5. Use a migration identity distinct from the restricted runtime identity.
6. Obtain explicit approval for this exact production SQL and checksum after review.

Only after those conditions and approval, the explicit command would be:

```powershell
npm.cmd run migrate -- --apply --expected-sha256 5723908376b09188e9889242058db1d6604f6c5a85e4188e9351563d0e5b34b2
```

**That apply command has not been run.** No production schema or data was changed. The current application remains NO-GO even if this foundation migration is eventually approved and succeeds; the missing workflows and other release blockers remain.
