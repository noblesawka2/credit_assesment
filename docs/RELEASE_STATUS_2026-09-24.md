# Release status - 24 September 2026

**NOT PRODUCTION READY.** This supersedes earlier connection/schema status reports, not the outstanding functional and operational acceptance requirements. No cloud deployment or new Git push was performed during this update.

## Verified changes

- The user authorized migrations. The exact five-file SQL bundle was displayed before application, rehearsed in a rollback-only production transaction, then committed. Bundle SHA-256: `e453473210130cc92d7f4e21384a3aaf5563fa0402e06d95cd885254bb869b05`.
- An initial rehearsal could not assume the runtime role (`42501`) and rolled back. The preflight now checks the target role's effective catalog privileges without granting membership. An interrupted apply was checked using a separate read-only ledger query; no ledger existed, so it had not committed. The subsequent apply committed and all five stored checksums match.
- Applied sources: `db/migrations/001_credit_foundation.sql`, `db/proposals/002_staff_security.sql`, `db/proposals/003_standalone_intake.sql`, `db/proposals/004_manual_verification.sql`, `db/migrations/005_runtime_hardening.sql`. The explicit release manifest includes the three former proposals; their source paths and applied bytes are preserved.
- This creates/restricts credit and private security objects and records migration receipts. No existing business records were inserted, updated or deleted. No policy publication, loan approval, disbursement or staff-account provisioning occurred. Production rollback rehearsal is NOT an isolated staging or backup-restoration drill.
- Read-only runtime check: connected **yes**, TLS active **yes**, certificate authorized **yes**, hostname verification **yes**, backend TLS **yes**. Runtime superuser and BYPASSRLS are **false**. All eight credit tables have forced RLS. Schema/ownership/destructive privilege checks pass. The migration ledger is ACL-restricted; it is not a credit-data table and does not use RLS.
- Local `AUTH_ENABLED=true`; local `APP_ORIGIN` is unchanged. Existing environment/key validation and authenticated encryption round trip pass. No secret value was printed or changed.
- Controlled manual verification now has protected list/read/record routes and an online-only staff screen. Credit-officer role, assignment scope, revision freshness, complete evidence, encryption, immutable records, atomic audit and payload-bound retries remain enforced. This is evidence recording, not financial approval or member-registry admission.
- Build packaging now includes the existing Node 24 backend, public assets and dependency manifests. It excludes environment files, certificates, migration tools and symlinks. The packaged backend started on loopback with configured identity/database/manual verification; its health response correctly remains `productionReady:false`.
- All 109 tests passed before the packaging addition; the additional packaging test passed separately. TypeScript and build passed. Provider/repository unit fixtures are synthetic, not live end-to-end acceptance.
- Publishable-source scan found no current known credential values. `.env`, `.env.migrate` and `certs/` remain ignored. This is not proof that every possible unknown historical secret is absent; the earlier published-history review remains in `SECRET_EXPOSURE_REVIEW_2026-09-23.md`.

## GO-LIVE BLOCKERS

| Unresolved control | Exact reference | Required resolution |
| --- | --- | --- |
| Supabase settings currently allow public signup; live staff/password-reset/email lifecycle remains unverified | `src/server/supabase-auth.ts:35`; `docs/AUTHENTICATION.md:1` | Disable provider self-registration, configure approved SMTP/recovery OTP delivery, and verify sign-in/reset/expiry/disable/revocation against isolated approved accounts. The application itself exposes no signup endpoint and denies unapproved profiles. |
| Nominated staff account absent; assignment and preliminary triage are not implemented | `docs/PERMISSIONS_REVIEW.md:1`; `src/server/app.ts:137` | Provision `info@mynoblescooperative.com` through Supabase Auth with the approved `OPERATIONS_CHECKER` role. Bind its separately approved assignment/triage authority to the verified immutable user ID, not a browser claim or every checker. Do not grant loan approval. |
| Privileged Supabase Auth service key still resides in the web process | `src/server/supabase-auth.ts:38` | Isolate administrative account validation/provisioning behind a narrowly authorized backend boundary without replacing Supabase identity or losing immediate disabled-account checks. Credit Data API grants were revoked; that does not remove Auth administration power. |
| Full persisted workflow, manual financial appraisal, evidence custody, policy configuration and independent maker/checker decisions are incomplete | `src/server/app.ts:55`; `docs/STAFF_WORKFLOW.md:1`; `docs/IMPLEMENTATION_STATUS.md:54` | Implement server-derived validations, approved policy values and immutable transitions before enabling submission/approval. An attestation alone does not satisfy numeric affordability or source authenticity. |
| Reports/export authorization and complete audit coverage for unimplemented operations remain absent | `docs/STAFF_WORKFLOW.md:46`; `src/server/app.ts:137` | Implement server-scoped reporting, permitted exports and atomic audits for every enabled action. Unspecified exports/reopening/closure remain denied. |
| Approved-device offline capture and server synchronization are disabled/incomplete | `src/server/app.ts:55`; `docs/OFFLINE_SECURITY_DESIGN.md:17` | Complete device approval, durable/rollback-resistant five-attempt limits, expiry, encrypted storage, conflict/idempotency handling and confirmed-sync cleanup with real device tests. |
| Hosting/staging inventory and provider-specific deployment controls are not established | `docs/OPERATIONS.md:1`; `src/server/staff-auth.ts:34` | Vercel was suggested, but no account/project or separate staging Supabase target is configured. Validate Node routing, CA mounting, pool/concurrency budgets, trusted proxy rate-limit addressing, HTTPS, logging and deployment rollback before exposing the app. |
| No verified backup, named recovery operator, approved RPO/RTO, key-recovery inventory or witnessed restore | `docs/RECOVERY_RUNBOOK.md:1` | Obtain and test these operational prerequisites. Migration success is not evidence of recoverability. Do not fabricate backup coverage. |
| Acceptance remains incomplete | `test/auth.test.ts:22`; `test/manual-verification.test.ts:1` | Complete isolated database-backed authorization/immutability/concurrency tests, real-provider lifecycle tests, browser/mobile checks and security review. Unit tests and health checks alone do not certify launch. |

## Search findings and scope

Current source markers: `src/server/app.ts:52` reports FOUNDATION_ONLY; `src/server/app.ts:55` and `src/server/app.ts:80` explicitly disable submission/offline capture; `src/server/app.ts:137` denies unimplemented routes. These are safety gates, not flags to remove to pass an audit. Localhost in `src/server/environment.ts:13` is intentional local/production separation. Test mocks are confined to synthetic tests; they do not establish live acceptance.

Minerva remains deferred and optional. No undocumented endpoint is invented, and no external write is attempted. Standalone drafts and controlled manual evidence recording work without it; standalone submission/decision/disbursement still require the unfinished controls above.

## Authorized account decision

The user explicitly selected `OPERATIONS_CHECKER` for `info@mynoblescooperative.com`, and restricted assignment/preliminary triage to that nominated account. This is an approved provisioning target, not a claim the account exists or can already sign in. Email confirmation, account creation and immutable user-ID binding remain outstanding. No new staff role or broader approval permission is introduced.
