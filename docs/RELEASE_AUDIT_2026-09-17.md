# Release audit - 17 September 2026

## Verdict: NO-GO

This application is not production ready. Passing unit tests and a static build do not complete the missing application workflows. Staff workflows, reports, server synchronisation and approved-device offline capture remain unfinished.

The initial audit was read-only. After the user confirmed that DATABASE_URL targets production and supplied the project CA, changes were limited to strict database TLS configuration, read-only database diagnostics, guarded migration previews, associated tests and documentation. No production migration was applied. No certificate-verification bypass was introduced. No application feature gates were lifted.

## Verification results

| Requested check | Result | Evidence / limitation |
| --- | --- | --- |
| All automated tests | PASS: 76/76 | Original 71 plus five TLS/migration-safety tests. No skipped tests. Database, mobile and full application end-to-end coverage is still missing. |
| TypeScript | PASS | npm.cmd run typecheck exits 0. |
| Production build command | PASS, limited artifact | npm.cmd run build exits 0. scripts/build.ts:2 only copies public assets; there is no complete deployable release package. |
| JavaScript syntax | PASS | node --check for public/app.js and public/sw.js. |
| Production dependency advisories | PASS at audit time | npm audit --omit=dev against the official registry reports zero known advisories. This is not a general security certification. |
| Database migrations | NOT APPLIED | Exact SQL and runner effects are in PRODUCTION_MIGRATION_REVIEW.md. The SQL file was not changed. |
| Environment validation | BLOCKED | DATA_ENCRYPTION_KEY remains a placeholder/invalid format. No complete production environment schema exists. |
| Hard-coded secrets | No real secret found in the scanned tracked source | Initial heuristic scan covered 43 tracked files. Test-only keys/credentials are synthetic. .env is ignored and not tracked. Values were not printed. Not an exhaustive historical/entropy scan. |
| Authentication | MISSING | src/server/identity.ts:6 always returns null; production bootstrap does not supply a real adapter. |
| Authorization / roles | PARTIAL | src/domain/access.ts:13 has role checks; spoofed role headers returned 401. Persistent assignment and real identity mapping remain unverified. |
| Maker/checker controls | DOMAIN TESTS PASS, integration missing | src/domain/workflow.ts:63 enforces separation in pure functions; no persisted workflow API exists. |
| Audit logs | INCOMPLETE | src/server/repository.ts:56 persists draft revision metadata only, not the complete old/new values and all required actions. |
| Encryption | PARTIAL | AES-GCM tests pass. Database TLS is now verified; production payload key, rotation and recovery remain unresolved. |
| Database connectivity | AUTHENTICATION FAILED | With the supplied CA, PostgreSQL returns SQLSTATE 28P01. No read-only SQL could execute after the rejected login. |
| Rate limits | MISSING | No middleware/configuration; 25 local unauthenticated session requests all returned 401 with no throttling. Edge rate limits were not verified. |
| Security headers | PARTIAL | CSP, nosniff, no-referrer, restrictive Permissions-Policy and no-store present. HSTS absent locally; deployed endpoint certificate prevents remote verification. |
| CORS / cross-site requests | PASS for local same-origin model | Untrusted Origin POST and OPTIONS returned 403; no permissive Access-Control-Allow-Origin. Cross-origin deployment/SSO is not configured. |
| Production error handling | PARTIAL | Injected internal failure returned sanitized 503 without the synthetic secret. Missing correlation IDs, error monitoring and comprehensive startup/pool lifecycle handling. |
| Supabase integration | PARTIAL, unusable | PostgreSQL client trusts project CA; credentials are rejected. No Supabase Auth/Storage integration or verified runtime-role grants. |
| Minerva integration | STUB | src/integration/core.ts:2 returns PENDING_MANUAL_VERIFICATION for every method. |
| Email flows | MISSING | No email transport, templates, delivery/error handling or configuration. |
| Password reset | MISSING | No identity-provider reset integration, routes or tests. Synthetic authenticated reset-route probe returned NOT_IMPLEMENTED. |
| Staff workflows | MISSING | public/app.js:77 renders only a locked informational card. |
| Reports | MISSING | No appraisal PDF, protected reporting endpoints, management reports or export audit. |
| Server synchronisation | MISSING | src/offline/sync.ts:12 is a client transport contract, not a server sync implementation. |
| Approved-device offline capture | MISSING / unsafe to enable | Provider/grant interfaces only; no enrolled-device service or implemented key provider. The unlock counter gap was reproduced. |
| Recovery | INCOMPLETE | No tested restoration/re-authentication flow or verified cryptographic erasure process. |
| Backups | UNVERIFIED | No schedule, retention/RPO/RTO, key backup or restoration drill evidence. Provider backup status could not be queried. |
| Documentation | PARTIAL, updated for TLS | Local instructions exist; approved production deployment/backup/recovery runbooks and ownership still missing. |

## GO-LIVE BLOCKERS

### B01 - Production database login is rejected

With certs/supabase-prod-ca.crt configured, certificate/hostname verification proceeds far enough to receive PostgreSQL error 28P01 (invalid password). Credentials must be corrected locally, including any necessary percent-encoding. Do not put passwords in chat or turn off verification. Schema state, applied migrations, role privileges and RLS behaviour are not verified.

References: src/server/database.ts:6; scripts/db-check.ts:7; scripts/migrate.ts:17.

### B02 - Production payload encryption key is invalid

The configured DATA_ENCRYPTION_KEY is a placeholder and does not satisfy the 64-hex-character requirement. Do not blindly replace a key if any existing encrypted data depends on it. Provision and escrow a proper key through an approved secrets process, and define versioned rotation/recovery.

References: src/server/encryption.ts:5; src/server/encryption.ts:14; src/server/start.ts:13.

### B03 - No real authentication, password reset or identity mapping

The only authentication implementation rejects all users. Session verification, expiry, revocation, MFA/OTP requirements, reset delivery and mapping from provider identities to internal actor UUIDs are absent. This is safely closed, not a working release.

References: src/server/identity.ts:6; src/server/app.ts:54; src/server/start.ts:19.

### B04 - Staff workflow is not an implemented application

The staff route is an informational placeholder. Submission, case assignment, verification, recommendation, checker review, decision, conditions, acceptance and core-confirmed disbursement do not have operational endpoints/screens. Library transitions are not transactionally persisted or resolved against authoritative policy.

References: public/app.js:77; public/app.js:91; src/server/app.ts:82; src/domain/workflow.ts:46.

### B05 - Maker/checker and role controls are not enforced through a complete persistent service

Unit functions check self-approval, authority, assignment and online controls. Missing services must derive controls from trusted database/core state, not request booleans. The SQL status column only validates enum membership, not permitted state transitions. Production RLS and inherited privileges require independent verification.

References: src/domain/workflow.ts:31; src/domain/workflow.ts:63; db/migrations/001_credit_foundation.sql:8; db/migrations/001_credit_foundation.sql:115.

### B06 - Required audit history is incomplete

Draft audit rows contain revisions and a generic reason, not historical old/new answer payloads, roles or device metadata. Draft ciphertext is overwritten. Workflow and verification event objects are returned but not durably stored. Policy changes, overrides, approvals, exports, security events and offline audit reconciliation have no complete audit service.

References: src/server/repository.ts:51; src/server/repository.ts:56; db/migrations/001_credit_foundation.sql:21; src/domain/workflow.ts:84; src/domain/verification.ts:22.

### B07 - Appraisal and management reports do not exist

No real report endpoint, PDF generator, protected exports, management filters, portfolio learning dashboard or export-audit implementation was found. The REPORT permission alone does not implement reporting.

References: src/domain/access.ts:20; src/server/app.ts:82; docs/IMPLEMENTATION_STATUS.md:20.

### B08 - Server synchronisation is absent and draft retry can duplicate a create

There is no server sync ledger, transactional UUID idempotency, structured reconciliation, conflict preservation, policy-change consent handling or resumable evidence upload. The online client generates a new idempotency key on every save: a create committed on the server with a lost response may be recreated by the next retry. The server repository supports a key only if the client reuses it.

References: src/offline/sync.ts:12; public/app.js:58; src/server/repository.ts:32; src/server/app.ts:82.

### B09 - Approved-device offline assurance has not been implemented

A string label and a non-extractable CryptoKey are not proof of approved-device or hardware-backed storage. No provider implements enrolment, biometric/PIN unlock, signed grants, revocation refresh or protected key recovery. The supplied grant is cloned in memory. Offline UI/capture is deliberately disabled.

References: src/offline/vault.ts:22; src/offline/vault.ts:47; src/offline/vault.ts:61; public/app.js:82.

### B10 - Offline failed-unlock limit is not maintained

The library checks the initial failedUnlocks field but never increments/persists it when unlock fails. A synthetic provider was invoked six times despite the advertised five-attempt limit. Inactivity is checked on operations rather than actively locking a displayed screen. Keep offline capture disabled until these controls are integrated and tested.

References: src/offline/vault.ts:31; src/offline/vault.ts:51; src/offline/vault.ts:61.

### B11 - Minerva and authoritative credit controls are not connected

Every core adapter method returns pending status. Registered-member matching, KYC, membership, savings, arrears, exposure, duplicate checks and core references are not actually confirmed. No production data or successful response was fabricated.

References: src/integration/core.ts:2; src/server/app.ts:71.

### B12 - Policy configuration is incomplete/unpublished

Seed data explicitly leaves charges, insurance, savings/purse rules and limits unresolved. Approved effective-dated score rubrics, authority matrices and eligibility policies are not persisted/published through complete services. Final authoritative calculation/snapshot creation is not wired into the server.

References: config/product-seeds.json:17; config/product-seeds.json:47; config/product-seeds.json:64; src/domain/policy.ts:16; src/domain/score.ts:16.

### B13 - No application throttling or operational security monitoring

Request size/header/time limits exist, but they are not rate limits. No authentication/privileged-action throttling, suspicious-activity logging, request correlation or alerting exists. The health response is static rather than a dependency readiness probe.

References: src/server/app.ts:20; src/server/app.ts:46; src/server/app.ts:97; src/server/app.ts:103.

### B14 - Deployed HTTPS endpoint cannot be verified

An unauthenticated GET to the configured APP_ORIGIN health endpoint failed with ERR_TLS_CERT_ALTNAME_INVALID. No bypass was used. Fix the domain/certificate association and rerun live TLS, HSTS, proxy and security-header checks. The Supabase database CA does not fix the web application's certificate.

References: src/server/start.ts:18; src/server/app.ts:39; src/server/app.ts:43.

### B15 - Migration and database privileges have not been proven safe in production

The migration is additive but unexecuted. Four entity tables intentionally have RLS enabled without service policies; implementing their endpoints would still fail or require an unsafe privileged role if this is ignored. The migration ledger has no explicit RLS/grant protection. Default Supabase grants, object collisions, schema ownership, TRUNCATE privileges and RLS-bypass inheritance remain unverified. Do not use a privileged migration credential as the app credential.

References: db/migrations/001_credit_foundation.sql:130; scripts/migrate.ts:23; src/server/start.ts:12; docs/OPERATIONS.md:32.

### B16 - Evidence, privacy and recovery paths are incomplete

No private document store, file-type/size validation, malware scanning, signed downloads or evidence checks exist. Offline cleanup accepts booleans supplied by its caller and only deletes IndexedDB records; this does not prove physical erasure or backup removal. The browser keeps unsaved answers in memory and has no before-unload loss warning or recoverable draft reload UI.

References: public/app.js:16; public/app.js:85; src/offline/vault.ts:85; src/offline/indexed-store.ts:28.

### B17 - Email and password recovery flows are not implemented

No email delivery adapter or provider-auth recovery flow exists. No sending was attempted. These must be tested for enumeration safety, rate limits, token expiration, replay prevention and delivery failures before release.

References: src/server/identity.ts:3; src/server/app.ts:82; package.json:18.

### B18 - No verified backup/restore procedure or deployable release artifact

The runbook describes intentions rather than a tested backup and recovery sequence. No verified backup, restore rehearsal, protected key escrow, RPO/RTO, retention or owner exists. The build copies assets, while the runtime still serves source/public; it is not a self-contained production deployment.

References: docs/OPERATIONS.md:40; docs/OPERATIONS.md:47; scripts/build.ts:2; src/server/app.ts:88; package.json:11.

## Search findings

- No literal TODO/FIXME markers or temporary authentication bypass were found in the audited application source. Their absence does not imply completeness.
- Actual stubs/disabled paths: src/server/identity.ts:6; src/integration/core.ts:2; src/server/app.ts:47; src/server/app.ts:82; public/app.js:77; public/app.js:91.
- Localhost URLs remain in src/server/start.ts:17, .env.example:1, .env.example:5, README.md:17 and test/http.test.ts:7. Test/development references are not automatically vulnerabilities; production must supply the correct origin and verified HTTPS.
- Offline/HTTP tests use synthetic keys, actors and transports. They are not working production identity, hardware-backed encryption or synchronisation integrations.
- Negative TLS test inputs deliberately verify that insecure SSL flags are rejected; none are used to connect.
- .env remains ignored. The CA certificate supplied by the user is public trust material, not a private key. It was not altered.

## Database and migration evidence

1. Before configuring the supplied CA: SELF_SIGNED_CERT_IN_CHAIN; a system-trust retry also encountered EAI_AGAIN.
2. After strict CA configuration: PostgreSQL authentication error 28P01. This is not a successful database session.
3. The configured web origin separately fails certificate hostname validation.
4. No production schema change, role grant, policy publication, seed insert or loan-data write occurred.
5. Default migration invocation now prints a plan without connecting. Explicit application also requires the exact reviewed SHA-256.
6. The user requested review before production migration; approval to apply has not been given after this review.

Supabase recommends supplying the project's root certificate and enabling full verification; node-postgres warns that SSL connection-string options can replace an explicit SSL object. The implementation rejects conflicting options and preserves both CA and hostname verification. Sources: [Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres), [node-postgres SSL documentation](https://node-postgres.com/features/ssl).

A provider backup feature is not evidence that this production project has a usable backup. Confirm configuration and rehearse restoration, including encrypted data keys and separate evidence storage. See [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

## Changes made after initial inspection and user direction

- Added src/server/database.ts: mandatory approved CA, certificate/hostname verification, TLS 1.2 minimum, blocked TLS overrides, bounded connection/query timeouts and sanitized diagnostics.
- Updated src/server/start.ts to use shared strict TLS configuration.
- Added scripts/db-check.ts for read-only catalog/role/migration checks.
- Added scripts/migration-plan.ts and updated scripts/migrate.ts: preview by default, checksum-bound explicit apply, bounded lock waiting, public schema selection and safe error cleanup.
- Added DATABASE_SSL_CA_FILE to .env.example and the ignored local .env without changing credentials or encryption keys.
- Added npm db:check and five focused tests in test/database.test.ts.
- Updated README.md, docs/OPERATIONS.md and the historical status pointer.
- Added this report and PRODUCTION_MIGRATION_REVIEW.md.
- Did not change db/migrations/001_credit_foundation.sql, product terms, credit decisions, authentication gates or the user-supplied CA.

## Required next actions

1. Correct DATABASE_URL credentials locally and rerun npm.cmd run db:check; verify a least-privilege runtime identity separately.
2. Review the exact production migration and its operational effects; obtain a verified backup and staging rehearsal before explicit approval to apply.
3. Provision the payload encryption key without risking any existing encrypted data.
4. Approve identity, Minerva, private-evidence, email and secure-device integrations and complete the missing staff/report/sync/offline implementation.
5. Close the blockers, execute database-backed and real mobile end-to-end tests, rehearse recovery, and rerun the release audit.

Do not release this application on the strength of the 76 passing tests.
