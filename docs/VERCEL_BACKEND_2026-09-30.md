# Vercel backend: local verification and deployment gates

## Scope and status

NOT PRODUCTION READY. Baseline `7c14c3f` contains the shared backend entry/router and isolated staff/administration surfaces. This follow-up adds pool-suspension handling, stronger proxy/health failure tests, isolated packaged-function verification and the Nobles website design system. All services used by HTTP and browser checks are synthetic. No production database connection, migration, policy publication, account/invitation, flag change, role change or explicit Vercel deployment is performed. The user authorised commit and push on 1 October 2026; a Git-integrated Vercel build may start after push, but that is not proof of a successful or launch-ready deployment.

## Entry, routes and private packaging

- `vercel.json:1` selects the repository's `npm run build:vercel` command and the Build Output API directory. Use the same repository root and Node 24 for both projects; do not override the command with a static-only build.
- `scripts/build-vercel.ts:1` emits Build Output API v3 in `.vercel/output`, a single private `functions/index.func` Node 24 function, and a catch-all route to `/index`. The launcher imports `src/server/vercel.js`; it does not start a listening server. There is no public `static` tree, SPA fallback, or route serving backend files.
- `src/server/vercel.ts:8` lazily initializes one runtime per function instance, shares concurrent startup, returns safe 503 responses on failure and imposes a five-second retry delay. `src/server/runtime.ts:18` uses the existing repositories, Supabase Auth, database security guards and router. No parallel identity system or production mock is added.
- Existing `/credit/auth`, `/credit/staff`, `/credit/readiness`, `/credit/verification`, `/credit/apply/*` and API paths pass through `src/server/app.ts:54`. `/` and `/credit/staff` select the appropriate surface shell; `/credit/admin` is unavailable on staff. HTML shells contain no customer data; protected APIs validate the current session and server permissions.
- The build compiles application TypeScript to JavaScript and includes locked production dependencies and public assets privately within the function. It excludes environment files, certificates/private keys, tests, migrations and development dependencies. Import/build requires no runtime secrets and never connects to a database.
- Standalone Node operation remains `npm start`; its separate `dist` artifact is NOT a Vercel static site. Do not publish `dist` or `.vercel/output/functions` as public files.

## Per-project runtime settings

| Setting | Staff project | Administration project |
| --- | --- | --- |
| Project | credit-readiness | credit-readiness-admin |
| APP_SURFACE | staff | administration |
| APP_ORIGIN | https://portal.mynoblescooperative.com | https://checker.portal.mynoblescooperative.com |
| STAFF_APP_ORIGIN | https://portal.mynoblescooperative.com | same |
| ADMIN_APP_ORIGIN | https://checker.portal.mynoblescooperative.com | same |
| NODE_ENV / DEPLOYMENT_ENV / AUTH_ENABLED | production / production / true | same |
| STAFF_INVITATIONS_ENABLED | false | false |
| DATABASE_POOL_MAX / CONNECTION_BUDGET / RESERVED_CONNECTIONS | 2 / 15 / 7 | same |
| DATABASE_STAFF_MAX_INSTANCES / DATABASE_ADMIN_MAX_INSTANCES | 2 / 2 | same planning values |

## Build/runtime and Preview scope

- The Vercel build reads no application secret and makes no network/database connection. `scripts/build-vercel.ts` only compiles source, copies allowlisted public assets and locked production dependencies, and writes Build Output API metadata. No application variable is build-time only.
- Production runtime only: `DATABASE_URL`, `DATABASE_SSL_CA_BASE64`, `DATABASE_RUNTIME_ROLE`, `SUPABASE_PROJECT_REF`, `DATA_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` and especially `SUPABASE_SERVICE_ROLE_KEY`. Set these to Production scope only unless a separately approved staging Supabase project, restricted role, CA and encryption key are provisioned for Preview. Never expose production database/Auth/encryption credentials to Preview.
- Production runtime configuration: `APP_SURFACE`, `APP_ORIGIN`, `STAFF_APP_ORIGIN`, `ADMIN_APP_ORIGIN`, `NODE_ENV`, `DEPLOYMENT_ENV`, `AUTH_ENABLED`, `STAFF_INVITATIONS_ENABLED`, `DATABASE_CONNECTION_METHOD`, `DATABASE_POOL_MAX`, `DATABASE_CONNECTION_BUDGET`, `DATABASE_RESERVED_CONNECTIONS`, `DATABASE_STAFF_MAX_INSTANCES` and `DATABASE_ADMIN_MAX_INSTANCES`. These non-secret values may be repeated in Preview only with Preview-appropriate origins/environment labels and separately approved resources.
- `DATABASE_SSL_CA_FILE` is for a readable local or mounted runtime file. Vercel Production uses only `DATABASE_SSL_CA_BASE64`; do not define both. `HOST` and `PORT` are standalone-server settings and need no custom Vercel value. `TRUSTED_PROXY` may remain omitted because verified Vercel runtime metadata selects the platform-bound resolver.

Vercel supplies `VERCEL=1`, `VERCEL_ENV`, `VERCEL_URL` and `VERCEL_REGION`. Enable system environment exposure; do not spoof these in an externally reachable standalone server. `TRUSTED_PROXY` may be omitted (platform-bound default); explicit `vercel` is valid only in the hosted production/preview runtime. Preview traffic must use separate approved staging configuration and budget, not silently share production resources.

`src/server/proxy.ts:12` uses only the platform's single validated `x-vercel-forwarded-for` address. Duplicate, malformed, missing or chained values fail closed. Arbitrary `X-Forwarded-For`, `X-Real-IP` and `X-Vercel-ID` do not establish trust. Standalone execution uses the socket peer and rejects a missing address. External reverse proxies are not supported by this trust policy without a separate review. Validate actual ingress and rate-limit behavior on the platform before launch.

Session cookies remain Secure, HttpOnly, SameSite=Strict, Path=/, `__Host-`, without a Domain attribute. The application origin is configuration-bound, never inferred from forwarded host/protocol headers. Ordinary staff sessions are rejected by administration; SUPERUSER sessions are rejected by staff, including a copied opaque cookie. Exact-origin mutation checks and server role checks remain in force.

## Verified TLS and private CA delivery

`src/server/database.ts:9` supports exactly one runtime CA source: a private readable `DATABASE_SSL_CA_FILE` OR canonical `DATABASE_SSL_CA_BASE64`. For Vercel's packaged function use the latter, configured privately by the operator from the existing approved Supabase CA. A local Windows path is not a hosted file. This task does not read out, encode for display, upload, rotate or replace any actual certificate or secret.

The encoded CA is decoded only in runtime memory; no CA is written to disk, bundled or exposed through HTTP. The parser rejects ambiguous sources, malformed encoding, private-key material, non-certificate text and expired/non-CA certificates. TLS retains `rejectUnauthorized: true`, the target hostname, Node hostname verification and TLS >=1.2. URL options cannot override this; only optional `sslmode=verify-full` is accepted and normalized. Runtime project/method/role binding and database privilege/RLS checks remain mandatory. Migration credentials are forbidden in runtime configuration.

## Combined connection budget and lifecycle

`src/server/pool-config.ts:11` defaults to two connections per process, min zero, five-second idle timeout and 60-second maximum connection lifetime. Connection establishment is bounded at three seconds; normal statement/query waits at ten/twelve seconds. Do not increase limits to hide failed connectivity.

Both hosted projects use the approved low-volume Session Pooler planning envelope: `DATABASE_POOL_MAX=2`, `DATABASE_CONNECTION_BUDGET=15`, `DATABASE_RESERVED_CONNECTIONS=7`, `DATABASE_STAFF_MAX_INSTANCES=2` and `DATABASE_ADMIN_MAX_INSTANCES=2`. The arithmetic is `2 × (2 + 2) + 7 = 15`, equal to the confirmed Session Pool Size and below the database `max_connections=60` figure.

Startup requires `POOL_MAX * (STAFF_MAX_INSTANCES + ADMIN_MAX_INSTANCES) + RESERVED_CONNECTIONS <= CONNECTION_BUDGET`. Missing, empty, non-integer or inconsistent settings fail closed before creating the pool. The staff/admin instance values are capacity-planning assumptions only: ordinary Vercel Functions do not enforce these environment variables as runtime instance ceilings, and the application does not implement a distributed connection semaphore. Treat unexpected scaling, overlapping deployments or Preview access to production as an operational risk. Keep Preview away from production credentials, use one production region unless separately reviewed, monitor Supabase connections, and pause/roll back a deployment before the Session Pool approaches the 15-connection envelope. Transaction pooling is a later evaluation, not this release.

`src/server/runtime.ts:31` attaches the pinned official `@vercel/functions` pool lifecycle helper only in the hosted runtime. It registers the release hook before startup queries and keeps the invocation alive long enough for idle connections to expire before suspension. One shared pool is reused; clients remain released by existing repository transactions. Standalone execution keeps its normal signal-driven shutdown. Actual platform suspension, egress and peak-load acceptance are not proven by synthetic tests.

## Public health contract

GET `/api/health` returns 200 with `status: AVAILABLE` only after runtime initialization/security/schema checks and a successful bounded read-only database probe (`SELECT 1`). It returns 503 `UNAVAILABLE` on missing readiness, startup failure, probe failure or timeout. Concurrent probes coalesce and are cached for five seconds per instance; timed-out work cannot create an unbounded probe queue. HTTP responses always use `no-store` and security headers.

The response exposes only service label, surface, availability and disabled-capability indicators. It never includes credentials, endpoints, roles, schema details, raw errors or CA material. `productionReady`, submission and offline capture remain false. A 200 is backend availability, NOT evidence of approved policies, working SMTP, full authentication acceptance, completed workflows or launch readiness.

## Local validation

Run `npm test`, `npm run typecheck`, `npm run build`, `npm run build:vercel`, `npm run readiness` and `npm audit`. Readiness validates configuration/encryption without connecting. Tests build/copy the private function into an isolated temporary directory, import its compiled JavaScript with its own production dependencies, and exercise both surfaces over loopback HTTP with synthetic storage/providers. They verify startup reuse, security headers, denial of private-file paths, CA/hostname configuration, cookies, authorization/CSRF, health redaction and pool lifecycle registration. This is not a Vercel deployment or real Supabase/browser acceptance test.

### Results on 1 October 2026

- Full suite: 139 passed, zero failed/skipped; includes both packaged surfaces, security tests, the self-hosted font route and the exact invitation-token template.
- TypeScript, standalone production build and isolated staff/administration Vercel package builds: passed.
- Existing `.env` readiness validation: passed environment, database configuration without connecting, authentication activation checks and encryption round-trip/context rejection. Hosted bindings remain unverified from the running deployments.
- Full and production-only dependency audits against `https://registry.npmjs.org`: zero vulnerabilities.
- Tracked-file scan against actual local database, CA, encryption and Supabase key values: zero matches. No real `.env` file is tracked and `.env.migrate` has no commit history. This bounded scan is not a guarantee against every possible secret format.
- Git whitespace check passed. Existing local npm configuration emits a malformed user-config warning; no global workaround was applied.
- Browser inspection passed for desktop staff/readiness/admin and mobile auth/readiness. Computed fonts are `DM Sans` and `Playfair Display`; bundled font loading succeeded and the mobile readiness viewport has no horizontal overflow. The current stylised N asset is unchanged.

## GO-LIVE BLOCKERS retained

| Blocker | Exact repository reference / evidence |
| --- | --- |
| Verify the pushed commit is the commit actually built by both Vercel projects, then smoke-test each production root, `/credit/auth`, `/api/health` and correct/incorrect-surface routes | `vercel.json:1`, `src/server/vercel.ts:8`; local packaging is not hosted acceptance |
| Hosted CA/environment, TLS/egress, actual Vercel proxy/rate-limit behavior and suspension/load acceptance | `src/server/database.ts:9`, `src/server/proxy.ts:12`, `src/server/runtime.ts:31`; the 15/7/2/2 envelope is accepted planning, not enforced autoscaling |
| Real Supabase invitation/reset/expiry/disabled-account/browser acceptance remains untested; invitations must stay disabled | `docs/AUTHENTICATION.md:25`, `config/supabase-invite.html:1`, `.env.example:22` |
| Privileged Supabase Auth administration-key isolation needs resolution | `src/server/supabase-auth.ts:42`; no credentials or identity architecture changed here |
| Approved executable policies and controlled publication absent from last read-only evidence; do not fabricate results | `src/server/readiness.ts:61`, `src/domain/policy.ts:18`; preserve POLICY_CONFIGURATION_REQUIRED |
| Persisted full workflow, approved authority/daily budgets, reports/export/evidence and full audit coverage unfinished | `docs/STAFF_WORKFLOW.md:46`, `docs/IMPLEMENTATION_STATUS.md:1`, `docs/AUTHENTICATION.md:43` |
| Approved-device offline capture/sync remains disabled and incomplete | `docs/OFFLINE_SECURITY_DESIGN.md:17`, `src/offline/sync.ts:1` |
| Named recovery operators, backup/key custody and witnessed restore/rollback/RPO/RTO acceptance outstanding | `docs/RECOVERY_RUNBOOK.md:1` |

Minerva remains optional/deferred. Do not enable invitations, bootstrap accounts, publish policies, run migrations, change data/roles/authority, or weaken any security gate to make a health check pass. Production data or configuration actions require explicit approval. The 28 September audit remains the source for dated live/database evidence, not a current deployment certification.

## Official platform references

- [Build Output API primitives](https://vercel.com/docs/build-output-api/primitives) and [configuration](https://vercel.com/docs/build-output-api/configuration): private Node function and catch-all routing contract.
- [Connection pooling with Vercel Functions](https://vercel.com/kb/guide/connection-pooling-with-functions): shared pools and suspension-safe idle cleanup.
- [Vercel request headers](https://vercel.com/docs/headers/request-headers): platform ingress addressing.
