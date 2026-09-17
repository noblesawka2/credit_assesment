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

No database URL or PostgreSQL server was supplied. The migration is **not applied or integration-tested**. The runner requires `DATABASE_URL`; it executes under a transaction and advisory lock, stores a checksum, and refuses changed already-applied migrations.

After approval, provision a disposable PostgreSQL development database and a dedicated migration role. Set its connection string in the process environment, then run:

```powershell
npm.cmd run migrate
```

Only after verifying the migration should an administrator grant a separate non-superuser, non-BYPASSRLS runtime role the minimal SELECT/INSERT/UPDATE permissions needed for the draft tables. The runtime must not have schema CREATE, trigger-disable, TRUNCATE, migration-owner membership or privilege to change immutable-record controls. It does not need DELETE. The server refuses superuser and BYPASSRLS runtime roles. Review inherited role privileges separately.

RLS is enabled and forced. Draft/application policies use transaction-local actor context set only by the repository after trusted authentication. Policies on unimplemented verified/policy/snapshot/outcome services intentionally default deny; do not grant permissive policies to make unfinished features appear operational.

## Production activation gates

Do not deploy for real applications until the acceptance gaps in `IMPLEMENTATION_STATUS.md` are closed. Required operational work includes approved identity and core adapters; HTTPS; secure session/CSRF review; rate limiting; database-backed integration tests; proper key management/rotation; protected evidence storage and scanning; observability without PII; backup/restore; retention; mobile device assurance and penetration testing.

The static build output is not a complete deployable backend. A future release must package source server modules and production dependencies, and define a deployment target. No cloud provider or hosting project has been chosen or created.

## Rollback

- Local preview: stop the foreground server with Ctrl+C. No process restart changes stored records.
- Failed migration: the runner issues ROLLBACK. Fix the new unapplied migration only after reviewing the failure; already-applied files must not be edited.
- After an applied migration: do not drop credit tables, audit logs or submitted applications. Stop writes, restore the previous application release, and leave additive schema in place.
- Before a future production release, take and validate a database backup using the organisation's approved tooling. Restore into a separate reviewed database rather than overwriting live data blindly.
- There is deliberately no destructive down-migration command. If schema repair is necessary, use a reviewed forward migration and preserve immutable records.

## Known environment issue

The host sandbox intermittently failed during this implementation with `apply deny-read ACLs`. Approved commands were used when required. npm also reported an invalid pre-existing user configuration key; no user-wide npm settings were changed.
