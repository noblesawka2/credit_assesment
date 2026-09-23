# Backend readiness — GO-LIVE BLOCKERS

Assessment date: 18 September 2026. This report lists failures and missing acceptance evidence, not production readiness. The superseded 28P01/key/origin observations must not be used as current blockers. No SQL write, migration, Supabase Auth login/reset/email delivery, production-origin probe or deployment was performed. `.env` was not changed and secret values were not printed.

## Executed-check failures

| Failure | Exact reference | Required action |
| --- | --- | --- |
| Configured database role has `bypass_rls=true` | `src/server/start.ts:21`; `scripts/db-check.ts:11` | Provision an independently reviewed non-owner, non-superuser, non-BYPASSRLS runtime role with no inherited escape path. Do not weaken the startup guard or change the production role automatically. |
| Credit tables and migration ledger are absent | `db/migrations/001_credit_foundation.sql:1`; `scripts/db-check.ts:13` | Review/apply only after separate production authorization, staging/backup/restore and privilege validation. No approval to migrate was given. |
| Runtime deployment/project/role configuration is incomplete (`DEPLOYMENT_ENV_REQUIRED` in the latest local check) | `src/server/database.ts:43`; `.env.example:5` | Supply reviewed environment bindings and a restricted runtime login. Do not invent staging credentials or repurpose the administrative production login. |
| SUPABASE_CONFIGURATION_REQUIRED | `src/server/supabase-auth.ts:33`; `scripts/readiness.ts:10` | Supply the approved Auth project URL and server-only API/admin credentials through secret configuration; do not copy them into documentation or frontend assets. |
| AUTHENTICATION_NOT_ENABLED | `src/server/start.ts:24`; `scripts/readiness.ts:11` | Keep disabled until provider configuration, private security storage, least-privilege access and staging lifecycle checks are complete. |

The previous `tls_active=false` finding was a diagnostic-label issue: client-to-pooler TLS is now inspected on the actual authorized TLS socket, separately from PostgreSQL `backend_tls_active`. The most recent read-only connection check confirmed connected/TLS/certificate/hostname verification and backend TLS. It was performed before the standalone implementation; this change made no new database connection. The earlier false observation is not a current TLS blocker. Connection-method expectations follow [Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres). No password/full URL is retained in this report.

## Remaining release blockers

| Blocker | Exact reference |
| --- | --- |
| Auth security schema, runtime grants, shared-store concurrency and immutable-trigger behavior have not been deployed/tested | `db/proposals/002_staff_security.sql:1`; `src/server/security-store.ts:17` |
| Staff provisioning/metadata, disabled-account behavior, real reset-code expiry/replay, signup disablement, SMTP delivery and production cookies lack staging evidence | `docs/AUTHENTICATION.md:25`; `src/server/supabase-auth.ts:55` |
| Permission scopes are not fully represented in database RLS; unresolved assignment/triage/closure/reopening/export/certification authority remains denied | `src/domain/workflow.ts:25`; `src/domain/access.ts:22`; `db/migrations/001_credit_foundation.sql:115` |
| Full section-17 immutable business audit coverage and administrative event ingestion are incomplete | `docs/AUTHENTICATION.md:43`; `src/server/security-store.ts:6`; `src/server/repository.ts:27` |
| Staff case queue, complete intake/verification pipeline, persistent transitions, maker/checker decisions, report queries/PDF/download authorization are not implemented | `src/server/app.ts:102`; `docs/STAFF_WORKFLOW.md:45`; `docs/IMPLEMENTATION_STATUS.md:12` |
| Standalone draft schema is unapplied and controlled manual verification/evidence persistence is missing; Minerva is optional/deferred, not a standalone prerequisite | `db/proposals/003_standalone_intake.sql:1`; `docs/STANDALONE_OPERATION.md:1` |
| Supabase Auth admin lookup still holds an elevated service-role key in the web process; runtime SQL credential separation does not isolate it | `src/server/supabase-auth.ts:38`; `docs/DATABASE_CREDENTIALS.md:1` |
| Server synchronization, device registry/signed grants, approved key provider, storage-rollback protection and real device persistence/cleanup evidence are missing | `src/offline/sync.ts:15`; `src/offline/vault.ts:67`; `src/offline/indexed-store.ts:41`; `docs/OFFLINE_SECURITY_DESIGN.md:1` |
| Named recovery ownership, actual independent backup locations, approved RPO/RTO, key recovery/rotation and witnessed restoration drill are missing | `docs/RECOVERY_RUNBOOK.md:5`; `src/server/encryption.ts:6` |
| Private evidence storage/scanning, policy publication/calibration, authority versions and complete domain inputs remain unfinished | `docs/IMPLEMENTATION_STATUS.md:12`; `config/product-seeds.json:1` |
| Hosting packaging, trusted-proxy/rate-limit tuning, provider-admin audit monitoring and deployment/rollback rehearsal remain unverified | `scripts/build.ts:1`; `docs/AUTHENTICATION.md:37`; `docs/RECOVERY_RUNBOOK.md:27` |

HTTPS/subdomain provisioning is deliberately deferred to deployment, not a local-origin failure. Do not point local APP_ORIGIN at the future hostname to satisfy a production test.

## Scan findings and scope limits

The source/documentation scan still finds intentional PENDING_MANUAL_VERIFICATION in `src/integration/core.ts:2`, NOT_IMPLEMENTED in `src/server/app.ts:120`, and disabled workflow/offline paths in `public/app.js:51`. The optional Minerva stub is not itself a standalone blocker; the missing manual verification, persistent decisions and offline service remain real gaps. Synthetic identity/provider/store implementations are confined to tests and do not demonstrate database-backed or live-provider acceptance. Localhost defaults are intentional development configuration, not production endpoint verification. The application rejects TLS bypass configuration; no production path was enabled by removing verification.

The existing environment's npm user configuration warning remains outside this repository and was not changed. Test/build success alone cannot establish authorization, audit, recovery or production readiness. The complete non-destructive validation was run; no successful check is presented as clearance for launch.
