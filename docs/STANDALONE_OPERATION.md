# Standalone intake and database separation - 18 September 2026

Minerva is deferred to the external integration team. It is not a prerequisite for staff authentication or online draft capture. This change does not enable live assessment decisions or certify the application for production.

## Available without Minerva

- Authorized intake staff can create, update, list and resume encrypted online drafts after the authentication, schema and restricted-runtime-role gates are satisfied. Existing approved roles are unchanged; an officer or approver is not implicitly granted intake permission.
- No adapter is injected by startup. Claims are saved with a null external member identifier and explicitly marked `PENDING_MANUAL_VERIFICATION`; no fake member, KYC result, savings, exposure or permanent credit reference is created.
- Claimed member number and name are normalized from the validated request into the encrypted answers. They are not an authoritative member registry or a second identity system. Supabase Auth remains the staff identity provider.
- Draft resume reads through transaction-local actor RLS and writes a sensitive-access audit before returning decrypted answers. Audit failure rolls back and returns no data. Save retries retain their idempotency key and exact payload in browser memory until confirmed; a browser restart still loses unconfirmed changes. Offline capture remains disabled.
- `/credit/staff` lists authorized drafts for approved intake users. It is not an appraisal, checker, approval or reporting workspace. Staff sign-in configuration and database schema are still required.

## Verification and future integration

Controlled manual membership/KYC/savings/exposure/duplicate verification must use approved Nobles records, assigned authorized staff, evidence, reasons, timestamps and immutable revision-bound audit. There is no manual verification service or evidence store yet. Do not let a browser checkbox or an intake claim satisfy these gates. The choice of manual operation versus draft-only operation was asked separately; this change safely implements draft-only operation pending that clarification.

An authoritative Nobles registry identifier is not necessarily a Minerva identifier. A future manual verification service must document identifier provenance rather than invent an external ID. Existing verification, maker/checker and workflow gates remain intact. Formal submission, approval and disbursement are disabled; no permissive fallback was introduced.

The external team can later implement `CoreSystemAdapter` and explicitly inject it into `createApp`. An explicitly configured adapter that fails or returns pending does NOT silently fall back to standalone save. Migration of existing unlinked drafts to verified registry identities needs a separately audited reconciliation service, not a bulk invented mapping. Endpoint authentication, retries, remote idempotency and reconciliation remain in `MINERVA_GAPS.md`; no undocumented Minerva endpoints or credentials were added.

## Exact additional schema proposal - NOT APPLIED

`db/proposals/003_standalone_intake.sql` contains only:

```sql
ALTER TABLE public.credit_applications ALTER COLUMN external_member_id DROP NOT NULL;
ALTER TABLE public.credit_applications ADD CONSTRAINT credit_unlinked_draft_only
  CHECK (external_member_id IS NOT NULL OR (status = 'DRAFT' AND submitted_at IS NULL AND reference IS NULL));
```

There is no data DELETE, UPDATE, TRUNCATE or dropped column/table. It changes constraints, acquires an ALTER TABLE lock and validates existing rows; it is not risk-free. Unlinked claims must remain drafts without a submission timestamp or formal reference. The startup guard requires this reviewed schema; it will not silently serve against the old mandatory-member schema.

The original foundation migration and its checksum are unchanged. The runner still contains ONLY `001_credit_foundation.sql`; neither security proposal 002 nor standalone proposal 003 is discovered or applied automatically. A reviewed ordered manifest, checksums, minimal grants, staging rehearsal and separate production approval are required before these proposals can be deployed. Do not execute them directly to bypass that review. No database connection, schema change or production write occurred during this implementation.

## GO-LIVE BLOCKERS

| Blocker | Exact reference |
| --- | --- |
| Current supplied production login is administrative; restricted runtime login, minimal grants and deployment/project bindings are not provisioned | `src/server/database.ts:43`; `src/server/database-guards.ts:4` |
| Foundation, private auth schema and standalone proposal remain unapplied; actual PostgreSQL RLS/grant/rollback tests are absent | `db/migrations/001_credit_foundation.sql:1`; `db/proposals/002_staff_security.sql:1`; `db/proposals/003_standalone_intake.sql:1` |
| Supabase Auth configuration, email and lifecycle acceptance remain outstanding; service-role key isolation is not implemented | `src/server/supabase-auth.ts:30`; `docs/AUTHENTICATION.md:1` |
| Manual verification/evidence, persistent approved workflows and authorized reports are incomplete; Minerva itself is deferred, not required | `src/server/app.ts:120`; `docs/STAFF_WORKFLOW.md:1`; `docs/IMPLEMENTATION_STATUS.md:12` |
| Device approval/synchronization, recovery drills and deployment controls remain incomplete | `docs/OFFLINE_SECURITY_DESIGN.md:1`; `docs/RECOVERY_RUNBOOK.md:1` |

Validation: 99 local automated tests passed, TypeScript and build passed, browser JavaScript syntax passed. Repository/privilege tests use synthetic local clients, not a live PostgreSQL instance; they do not prove SQL policies or permissions. No real-provider, browser end-to-end or production acceptance is claimed.
