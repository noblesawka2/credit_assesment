# Runtime and migration credential separation

## Secret boundaries

| Process | Local file | Credentials and CA | Purpose |
| --- | --- | --- | --- |
| Web server / local readiness | `.env` | `DATABASE_URL`, `DATABASE_SSL_CA_FILE`, `DATABASE_RUNTIME_ROLE`, `DATABASE_CONNECTION_METHOD` | Restricted application SQL only |
| Migration job | `.env.migrate` | `DATABASE_ADMIN_URL`, `DATABASE_ADMIN_SSL_CA_FILE`, `DATABASE_ADMIN_ROLE`, `DATABASE_ADMIN_CONNECTION_METHOD` | Separately approved schema operations |
| Read-only diagnostic | `.env` | `DATABASE_URL`, `DATABASE_SSL_CA_FILE` | Inspect the supplied connection without certifying it as runtime-safe |

Neither credential set falls back to the other. The application rejects admin URL/CA configuration in its environment. Do not mount `.env.migrate` or inject migration secrets into the web deployment. Shell environment variables still take precedence over Node env files: use separate job environments, not shared inherited secret sets. Existing `.env` was not modified and no `.env.migrate` containing credentials was created. Both secret file patterns are ignored; example templates contain no secrets.

`nobles_app` in the example is a suggested PostgreSQL login name, NOT an additional staff role, and has not been created. A DBA must provision a reviewed restricted runtime login with no superuser, BYPASSRLS, CREATEROLE, CREATEDB, replication, owner membership, schema CREATE or destructive grants. Startup checks inherited privileged roles, relevant ownership/schema creation, destructive table privileges and forced credit-table RLS. These are defense-in-depth checks, not a replacement for a reviewed full effective-privilege audit: unsafe SECURITY DEFINER functions, triggers, default grants and Supabase Data API exposure still need review. RLS actor context is trusted application-supplied transaction-local context, not a cryptographically verified end-user claim inside PostgreSQL.

The existing Supabase Auth adapter still uses `SUPABASE_SERVICE_ROLE_KEY` to check account status through the Auth admin API. Database password separation does NOT isolate that elevated API credential. Moving the admin lookup into a separately deployed narrow authentication component remains an explicit security task; no imaginary internal service endpoint has been configured.

## Target bindings and TLS

Runtime startup/readiness and migration apply require `DEPLOYMENT_ENV=local|staging|production`, `SUPABASE_PROJECT_REF`, an explicit connection method and exact expected database role. `NODE_ENV` remains the build/runtime setting; `APP_ORIGIN` continues to distinguish local loopback from deployed HTTPS. No future production hostname is probed. A deployment label alone does not prove the project is staging: verify the project reference with the dashboard/approved environment inventory before setting it.

Supported methods are `direct` and `session_pooler`, both port 5432 and database `postgres`. Direct username is the configured role, host `db.<project-ref>.supabase.co`. Shared session-pooler username is `<role>.<project-ref>`; copy its actual host from the Connect dialog. Transaction port 6543, project/role mismatch and unexpected hosts fail closed. If `SUPABASE_URL` is present it must match the pinned project. These formats follow [Supabase's connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres); pooler hosts must not be guessed from a region.

Both purposes use the same CA parsing, validity checks, TLS 1.2 minimum, `rejectUnauthorized: true` and standard hostname verification. No system-wide TLS exception or permissive connection-string override is allowed. Mount the CA for the actual target project; do not copy a production certificate path into staging without checking it.

The read-only diagnostic deliberately still accepts an administrative connection to report its unsafe role properties. It does not launch the web server, imply that RLS is effective or grant permission to write. Client TLS is measured from the actual authorized TLS socket; `backend_tls_active` is a separate PostgreSQL backend observation.

## Migration safety

`npm.cmd run migrate -- --plan` remains an offline preview. The runner currently plans only the unchanged foundation migration. Apply now requires the reviewed checksum AND explicit target confirmations:

```text
npm.cmd run migrate -- --apply --expected-sha256 <reviewed-checksum> --expected-project <approved-project-ref> --expected-environment <approved-environment>
```

This is command documentation, not approval to execute. `DATABASE_ADMIN_URL` and its own CA/method/role must be supplied via the separate migration environment; runtime credentials are not used. Production apply is still prohibited until the user separately approves the exact SQL and target after staging, privilege, backup and restore evidence. Proposals outside the manifest do not run. A future Minerva worker gets its own least-privilege credentials only after an approved integration exists; none were created.
