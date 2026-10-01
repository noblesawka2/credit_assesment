# Local operation, deployment prerequisites and rollback

Local Vercel packaging, runtime configuration and current deployment gates: `VERCEL_BACKEND_2026-09-30.md`. Earlier live checks are dated in `PRODUCTION_READINESS_2026-09-28.md`; the current deployments have not been re-probed in this local task. Keep invitations disabled, do not bootstrap the CEO yet, and never deploy the standalone dist tree as public assets. Local APP_ORIGIN remains local. Earlier hosting assumptions below are historical.

## Development setup

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dev
```

Bind to `127.0.0.1` for local preview. Do not expose this unfinished application to a public network. A push may trigger existing Vercel Git integrations; it is not evidence that the correct backend is deployed or ready.

## Database migration

Current ordered manifest: `scripts/release-plan.ts`. Sources 001-005 were applied together with checksum receipts on 24 September 2026. Do not edit already-applied SQL, including sources retained under `db/proposals/`.

The read-only 24 September diagnostic confirms client TLS, certificate authorization, hostname verification and backend TLS. The restricted runtime has neither superuser nor BYPASSRLS, and all five migration receipts match. See `RELEASE_STATUS_2026-09-24.md` for current blockers; previous dated audits are historical.

Use a dedicated migration role and a separate non-BYPASSRLS runtime role. Runtime uses `DATABASE_URL` and `DATABASE_SSL_CA_FILE` in `.env`; migrations use `DATABASE_ADMIN_URL` and `DATABASE_ADMIN_SSL_CA_FILE` in a separate `.env.migrate`. Each requires its own role/connection-method settings plus the correct project/deployment binding; see `DATABASE_CREDENTIALS.md`. The previously supplied local CA is `certs/supabase-prod-ca.crt`; mount the approved CA for the actual target, not an assumed shared staging/production CA. Never disable certificate or hostname verification. Connection-string TLS overrides are rejected; `sslmode=verify-full`, if present, is normalized so it cannot replace the configured CA.

Correct database credentials locally; never paste credentials into logs or chat. First run the read-only preflight and review the exact migration plan:

```powershell
npm.cmd run db:check
npm.cmd run migrate:release -- --plan
```

`npm.cmd run migrate:release` defaults to a preview and does not connect. Apply requires `--apply --expected-sha256 <reviewed-bundle-checksum> --expected-project <approved-project-ref> --expected-environment <approved-environment> --expected-runtime-role <restricted-role>`. Use `--rehearse` instead of `--apply` to always roll back. The command loads only `.env.migrate`, not `.env`; clear stale shell overrides first. The original `migrate` command covers foundation 001 only, not the release bundle. Future migrations need SQL/impact review, explicit target approval, verified backup/restore and isolated staging rehearsal. No destructive down migration is provided.

Migration 005 grants the separate non-superuser, non-BYPASSRLS runtime minimal table/column permissions for implemented services. Audit tables receive INSERT but no UPDATE/DELETE/TRUNCATE authority. The runtime must not have schema CREATE, trigger-disable, migration-owner membership or privilege to change immutable-record controls. Credit tables do not need DELETE. The server rejects direct/inherited privileged roles, relevant ownership, schema control and destructive grants. Startup checks are not a complete integration or penetration test.

RLS is enabled and forced. Draft/application policies use transaction-local actor context set only by the repository after trusted authentication. Policies on unimplemented verified/policy/snapshot/outcome services intentionally default deny; do not grant permissive policies to make unfinished features appear operational.

## Production activation gates

Supabase Auth configuration/email setup and private session/rate-limit/audit storage are documented in `AUTHENTICATION.md`. Security schema 002 is now applied and local authentication is enabled; provider signup must still be disabled and real lifecycle/email acceptance completed. Keep the existing local APP_ORIGIN on localhost; set production HTTPS origin separately on the hosting platform after its DNS/certificate exist. Full TLS verification is mandatory in both environments.

Use `RECOVERY_RUNBOOK.md` for the recovery sequence; launch remains blocked until named custodians, actual backup locations, approved RPO/RTO and a witnessed restoration drill are recorded. Offline activation additionally requires `OFFLINE_SECURITY_DESIGN.md` acceptance evidence.

Do not deploy for real applications until the acceptance gaps in `IMPLEMENTATION_STATUS.md` are closed. Minerva is deferred and is not a prerequisite for standalone intake; see `STANDALONE_OPERATION.md` for the unapplied standalone schema proposal and required manual-verification service. Required operational work includes configured identity, HTTPS, secure session/CSRF review, rate limiting, database-backed integration tests, proper key management/rotation, protected evidence storage and scanning, observability without PII, backup/restore, retention, mobile device assurance and penetration testing.

`npm.cmd run build` now packages `dist/src`, `dist/public` and dependency manifests. On an approved Node 24 host, install production dependencies inside the artifact with `npm.cmd ci --omit=dev`, inject server-only runtime environment values, mount the approved CA, then run `node src/server/start.ts` from the artifact root. Never upload `.env.migrate`, migration credentials, local certificates or the development `.env` as public/static assets. Production needs `NODE_ENV=production`, `AUTH_ENABLED=true`, a verified HTTPS `APP_ORIGIN` and platform-correct host/port settings. This artifact is not a static-site deployment or a launch approval.

The user suggested Vercel, but no hosting project/account, separate staging database or provider-specific adapter has been configured. Validate routing, trusted proxy client addressing for rate limits, CA availability, connection budgets and deployment rollback before deploying; do not publish only `dist/public` and assume protected APIs exist. No deployment was performed.

## Rollback

- Local preview: stop the foreground server with Ctrl+C. No process restart changes stored records.
- Failed migration: the runner issues ROLLBACK. Fix the new unapplied migration only after reviewing the failure; already-applied files must not be edited.
- After an applied migration: do not drop credit tables, audit logs or submitted applications. Stop writes, restore the previous application release, and leave additive schema in place.
- Before a future production release, take and validate a database backup using the organisation's approved tooling. Restore into a separate reviewed database rather than overwriting live data blindly.
- There is deliberately no destructive down-migration command. If schema repair is necessary, use a reviewed forward migration and preserve immutable records.

## Known environment issue

The host sandbox intermittently failed during this implementation with `apply deny-read ACLs`. Approved commands were used when required. npm also reported an invalid pre-existing user configuration key; no user-wide npm settings were changed.
