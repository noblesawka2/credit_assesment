# Local operation, deployment prerequisites and rollback

## Development setup

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dev
```

Bind to `127.0.0.1` for local preview. Do not expose this unfinished application to a public network. This implementation has not been deployed.

## Database migration

Migration: `db/migrations/001_credit_foundation.sql`.

A production Supabase database URL and root CA were supplied during the 17 September audit. The corrected 18 September read-only diagnostic confirmed client TLS, certificate authorization and hostname verification; its latest backend TLS observation was also true. The configured role has BYPASSRLS and the credit schema/ledger are absent. No production writes or migrations were applied. See `BACKEND_READINESS_2026-09-18.md` for current blockers; the previous release audit is historical.

Use a dedicated migration role and a separate non-BYPASSRLS runtime role. Runtime uses `DATABASE_URL` and `DATABASE_SSL_CA_FILE` in `.env`; migrations use `DATABASE_ADMIN_URL` and `DATABASE_ADMIN_SSL_CA_FILE` in a separate `.env.migrate`. Each requires its own role/connection-method settings plus the correct project/deployment binding; see `DATABASE_CREDENTIALS.md`. The previously supplied local CA is `certs/supabase-prod-ca.crt`; mount the approved CA for the actual target, not an assumed shared staging/production CA. Never disable certificate or hostname verification. Connection-string TLS overrides are rejected; `sslmode=verify-full`, if present, is normalized so it cannot replace the configured CA.

Correct database credentials locally; never paste credentials into logs or chat. First run the read-only preflight and review the exact migration plan:

```powershell
npm.cmd run db:check
npm.cmd run migrate -- --plan
```

`npm.cmd run migrate` defaults to a preview and does not connect. Apply requires `--apply --expected-sha256 <reviewed-checksum> --expected-project <approved-project-ref> --expected-environment <approved-environment>` and separate approval after reviewing `PRODUCTION_MIGRATION_REVIEW.md`. The command loads only `.env.migrate`, not `.env`. Do not apply until a recent backup, restoration plan, object-name collision checks, migration-role permissions and staging rehearsal are verified. No destructive down migration is provided.

Only after verifying the migration should an administrator grant a separate non-superuser, non-BYPASSRLS runtime role the minimal per-table SELECT/INSERT/UPDATE permissions needed; audit tables must not receive UPDATE. The runtime must not have schema CREATE, trigger-disable, TRUNCATE, migration-owner membership or privilege to change immutable-record controls. Credit tables do not need DELETE. The server rejects direct/inherited privileged roles, relevant ownership, schema control and destructive grants. Review effective function/default/API privileges separately; startup checks are not a complete privilege proof.

RLS is enabled and forced. Draft/application policies use transaction-local actor context set only by the repository after trusted authentication. Policies on unimplemented verified/policy/snapshot/outcome services intentionally default deny; do not grant permissive policies to make unfinished features appear operational.

## Production activation gates

Supabase Auth configuration/email setup and private session/rate-limit/audit storage are documented in `AUTHENTICATION.md`. The exact additional SQL is a proposal at `db/proposals/002_staff_security.sql`, outside the migration runner; do not apply it without explicit review and approval. Keep the existing local APP_ORIGIN on localhost; set production HTTPS origin separately on the hosting platform after its DNS/certificate exist. Full TLS verification is mandatory in both environments.

Use `RECOVERY_RUNBOOK.md` for the recovery sequence; launch remains blocked until named custodians, actual backup locations, approved RPO/RTO and a witnessed restoration drill are recorded. Offline activation additionally requires `OFFLINE_SECURITY_DESIGN.md` acceptance evidence.

Do not deploy for real applications until the acceptance gaps in `IMPLEMENTATION_STATUS.md` are closed. Minerva is deferred and is not a prerequisite for standalone intake; see `STANDALONE_OPERATION.md` for the unapplied standalone schema proposal and required manual-verification service. Required operational work includes configured identity, HTTPS, secure session/CSRF review, rate limiting, database-backed integration tests, proper key management/rotation, protected evidence storage and scanning, observability without PII, backup/restore, retention, mobile device assurance and penetration testing.

The static build output is not a complete deployable backend. A future release must package source server modules and production dependencies, and define a deployment target. No cloud provider or hosting project has been chosen or created.

## Rollback

- Local preview: stop the foreground server with Ctrl+C. No process restart changes stored records.
- Failed migration: the runner issues ROLLBACK. Fix the new unapplied migration only after reviewing the failure; already-applied files must not be edited.
- After an applied migration: do not drop credit tables, audit logs or submitted applications. Stop writes, restore the previous application release, and leave additive schema in place.
- Before a future production release, take and validate a database backup using the organisation's approved tooling. Restore into a separate reviewed database rather than overwriting live data blindly.
- There is deliberately no destructive down-migration command. If schema repair is necessary, use a reviewed forward migration and preserve immutable records.

## Known environment issue

The host sandbox intermittently failed during this implementation with `apply deny-read ACLs`. Approved commands were used when required. npm also reported an invalid pre-existing user configuration key; no user-wide npm settings were changed.
