# Nobles Cooperative Credit Diagnostic Engine

**Status: tested implementation foundation, not a completed credit engine or production service.**

Latest verification and go-live blockers: `docs/RELEASE_STATUS_2026-09-23.md`. Source publication to GitHub does not activate authentication, apply migrations or deploy the application. Controlled manual verification is approved; its new repository/library is work in progress, not yet connected to HTTP/UI.

Minerva is optional and deferred to the integration team. Authorized staff draft capture/resume no longer depends on it; claims remain explicitly unverified. Database/Auth configuration and reviewed unapplied schema are still required. See `docs/STANDALONE_OPERATION.md` for exact scope/blockers and `docs/DATABASE_CREDENTIALS.md` for separated runtime/admin credentials. No production data or migrations were changed.

This is a separate TypeScript/Node 24 application with a PostgreSQL migration and explicit integration boundaries. The 18 September 2026 read-only Supabase check now authenticates, but the configured role bypasses RLS and the credit schema is absent. No production writes or migrations were applied. Nobles Vault is not modified. Current failures: `docs/BACKEND_READINESS_2026-09-18.md`.

## Run locally

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dev
```

Open `http://127.0.0.1:3100`. No database or credentials are needed to view the non-sensitive shell. The UI clearly labels itself as an implementation preview and disables personal-data entry without authenticated, configured services. There are no demo users, fake member records or backdoor role headers.

Node 24 runs the TypeScript source directly. The build type-checks the application and copies static assets to `dist/public`; it does not bundle a standalone production server. The development server serves the source `public` directory.

## Implemented

- Integer-kobo reference calculations, validation, cash flow, DSCR, stress, demonstrated need, repayment inversion, ceilings and exact-kobo schedule allocation.
- Separate reported/verified contracts and evidence/reason-required verification functions.
- Role and assignment checks, formal transition guards, independent recommendation/check/approval controls and event objects.
- Draft/publication policy functions, explainable score calculation and separate Unity group checks. Product seeds are source requirements only, not active policies.
- Mobile-responsive assessment **preview**, thirteen question routes, progress navigation, readiness gates and draft autosave client.
- Same-origin HTTP controls, private API responses, explicit static-file allowlist and a default-deny identity adapter.
- Encrypted PostgreSQL draft repository with transaction-scoped RLS context, revision checks, idempotency-key payload binding and transactional draft audit entries.
- Non-destructive migration with immutable audit/verified/snapshot/outcome records and original-answer protection after submission.
- AES-GCM offline vault library, encrypted IndexedDB adapter, local-state guards, acknowledgement checks and attachment checksum assembly.
- A service worker that caches only the non-sensitive shell. API responses, query URLs and request bodies are excluded.

**Library functionality is not the same as an integrated workflow.** See `docs/IMPLEMENTATION_STATUS.md` for unfinished work and unverified controls.

## Routes

- `/credit/apply/start`, `/credit/apply/request`, `/credit/apply/income-route`
- `/credit/apply/business`, `/credit/apply/sales`, `/credit/apply/business-costs`
- `/credit/apply/household`, `/credit/apply/debts`, `/credit/apply/use-of-funds`
- `/credit/apply/salary`, `/credit/apply/unity-group`, `/credit/apply/evidence`, `/credit/apply/review`
- `/credit/staff`: authorized intake draft list/resume; **not an appraisal or approval workspace**.
- `GET /api/health`: readiness metadata only; `productionReady` is always false in this release.
- `/credit/auth`: staff sign-in, sign-out and emailed-code password recovery UI. Supabase Auth uses the existing identity boundary; no public signup.
- `POST /api/auth/sign-in`, `/api/auth/sign-out`, `/api/auth/forgot-password`, `/api/auth/reset-password`: require reviewed security storage and Supabase configuration; disabled until configured.
- `GET /api/session`, `GET /api/drafts`, `GET /api/drafts/:id`, `POST /api/drafts`: require server-validated sessions and approved role scope. Missing identity defaults to denial.

No submission, decision, override, disbursement, evidence-upload, report or server-sync endpoints are exposed.

## Data and integration

Copy `.env.example` only when preparing a new environment; do not overwrite existing credentials. Never commit `.env`. `DATABASE_SSL_CA_FILE` must point to the approved database CA certificate; certificate and hostname verification are mandatory. `npm.cmd run db:check` performs only read-only checks, while `npm.cmd run migrate -- --plan` prints the exact unapplied SQL without connecting. `DATA_ENCRYPTION_KEY` must be a secret, random 32-byte key represented by 64 hexadecimal characters. The local payload cipher is a foundation; production key management and rotation are unfinished.

Supabase Auth is the approved provider through `src/server/identity.ts`; see `docs/AUTHENTICATION.md` for server-only configuration, administrator-controlled role metadata, recovery-email setup and unapplied private security schema. The user-approved matrix is `docs/PERMISSIONS_REVIEW.md`; unresolved authorities remain denied. Use `src/integration/core-contract.ts` for Minerva; its default implementation still returns `PENDING_MANUAL_VERIFICATION` for every check.

`npm.cmd run readiness` performs local environment, TLS configuration and encryption checks without connecting or printing secrets; `npm.cmd run db:check` performs the separate read-only DB check. Keep local APP_ORIGIN on loopback; production origin is configured separately after HTTPS exists. Do not probe the future hostname or disable TLS verification.

See `docs/STAFF_WORKFLOW.md`, `docs/MINERVA_GAPS.md`, `docs/OFFLINE_SECURITY_DESIGN.md` and `docs/RECOVERY_RUNBOOK.md` for workflow/report gates, external integration gaps, approved-device requirements and recovery ownership/verification. Live decisions and offline capture remain disabled.

See `docs/OPERATIONS.md` for migration and rollback procedures. Production activation is prohibited until the remaining requirements and security review are complete.
