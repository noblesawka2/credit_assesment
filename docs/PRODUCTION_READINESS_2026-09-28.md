# Production readiness audit - 28 September 2026

**NOT PRODUCTION READY.** This report supersedes the deployment assumptions in the 24/25 September reports. No application implementation, hosted configuration, account, lending policy, database role or production data was changed during this audit. Only documentation and synthetic local regression tests were updated. No commit, push, deployment, migration, invitation, password reset or email send was performed.

## 1. Repository versus deployment evidence

- Local branch: `main`. Local HEAD and the live GitHub `refs/heads/main` both resolve to `db3f9200d9bc99332339a31563099c33ce710023` (`git ls-remote`, not the stale local remote-tracking reference).
- At audit start, 56 paths were modified/untracked. CEO administration, readiness, branding, invitation template, migration 005/006 source files and their tests are still uncommitted. They are therefore not included in the pushed main commit. The applied migration receipts are verified, but those SQL files still need inclusion in the reviewed release commit without changing their applied bytes.
- Both live landing pages match the committed `public/index.html` byte-for-byte and do not match the working-copy page. This proves stale page content, not an exact deployment SHA.
- The Vercel connector is not callable in this session. Existing CLI authentication could not access the owning scope `noblesawka2-8845s-projects`. Latest deployment IDs/SHAs, project build overrides, function inventory, environment values and protection settings remain independently **unverified**. Failed/empty metadata queries are not evidence that configuration is absent.
- The user reports two production projects and their environment configuration: `credit-readiness` / staff and `credit-readiness-admin` / administration. Public HTTPS availability is verified below; backend execution and hosted configuration validation are not.

## 2. Production URL checks

Credential-free GET requests used normal certificate and hostname verification. The checker followed eligible HTTPS redirects with a finite hop limit; none of these six requests redirected. No authentication token, cookie value or certificate contents were printed.

| Production origin | `/` | `/credit/auth` | `/api/health` |
| --- | --- | --- | --- |
| `https://portal.mynoblescooperative.com` | 200 HTML, old shell | 404 plain text | 404 plain text |
| `https://checker.portal.mynoblescooperative.com` | 200 HTML, old shell | 404 plain text | 404 plain text |

These are real missing-route/backend failures, not expected login redirects. Both origins returned HSTS, but not the application's CSP or `X-Content-Type-Options: nosniff`; responses used public caching rather than the backend's `no-store`. No session cookie was issued. The static root succeeding does not verify authentication, database access, either isolated surface or readiness calculation.

## 3. Vercel compatibility review

| Area | Evidence and remaining work |
| --- | --- |
| Entry/routing | `src/server/start.ts:44` starts the Node server, but the repository has no root `server.ts`, `src/server.ts`, `/api` function entry or Vercel routing configuration. The live auth/health 404s confirm missing effective backend routing. Preserve the existing router; do not build a second authentication system. |
| Build/package | HEAD's `scripts/build.ts:1` copies only the public shell. The uncommitted `scripts/build.ts:6` packages backend source plus public files as a standalone Node artifact, not a demonstrated Vercel function build. Do not serve the entire `dist` tree as public assets: it contains backend source. A passing npm build is not a passing Vercel deployment. |
| Runtime | `package.json:6` requires Node 24. Native PostgreSQL/TLS/fs usage needs the Node runtime, not Edge. The actual deployed runtime and Vercel function output must still be inspected. |
| Environment | `src/server/environment.ts:8` rejects local production surfaces, non-HTTPS/loopback production origins and mismatched surface origins. Local validation and both declared origin configurations pass in memory. This is not verification of the hosted environment. Keep local APP_ORIGIN local. |
| CA provisioning | `src/server/database.ts:22` requires a readable CA file; setting a filename alone does not create it on Vercel. Build/upload exclusions intentionally omit certificates. Establish a private runtime CA provisioning mechanism without making CA/key files public or disabling verification; do not copy a Windows path into a Linux deployment and assume it works. Actual hosted readability is unverified. |
| Database lifecycle | `src/server/start.ts:25` creates one pool per process, checks runtime privileges and handles idle-pool errors safely. Startup failure exits the process; cold starts and failed initialization/recovery still require Vercel-specific testing. Local success does not demonstrate egress/CA/TLS from either hosted function. |
| Pool budget | `src/server/database.ts:38` fixes max=10 per pool and bounds connection/query/statement waits. There is no reviewed shared budget across both projects, concurrent function instances, previews and Supabase reservations. Peak clients can reach `10 * (staff instances + administration instances)` before other consumers. Actual Supabase capacity, instance caps, idle lifecycle and load acceptance are unknown; no capacity values were invented. |
| Proxy/rate limiting | `src/server/staff-auth.ts:39` uses socket.remoteAddress; PostgreSQL counters persist across instances, but Vercel proxy addresses may collapse different clients into one budget. Add a platform-bound, spoof-resistant client-address policy and tests; never blindly trust arbitrary forwarded headers. Hosted enforcement/load tests remain outstanding. |
| Cookies/sessions | `src/server/staff-auth.ts:23` rechecks provider-controlled roles on protected session validation. HTTPS cookies are Secure, HttpOnly, SameSite=Strict, Path=/ and `__Host-`, with no Domain attribute (`:35`). Local tests reject ordinary staff on administration and SUPERUSER on staff, including copied opaque cookies. Live browser/provider validation remains blocked by missing routes. |
| CSRF/CORS/errors | `src/server/app.ts:47` sets private caching and security headers; `:63` requires exact Origin for mutations. No permissive CORS origin is emitted. Exceptions produce controlled error codes (`:196`), not raw provider/DB errors. These controls are not demonstrated on the live static deployment. |

Vercel currently supports captured Node HTTP servers using a recognized `server` entrypoint as well as `/api` functions. `listen()` is not inherently incompatible; the missing recognized entry/build/routing and deployed verification are the issue. See [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js) and [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). Vercel documents its forwarded IP headers in [request headers](https://vercel.com/docs/headers/request-headers); any use must be restricted to trusted platform ingress.

## 4. Validation evidence

- Baseline: 123 automated tests passed, zero failures/skips. After adding two synthetic copied-cookie regression cases, the full suite passed **125 tests, zero failures/skips**, followed by a successful TypeScript check and production standalone build. The new cases verify opposite-surface rejection/revocation and explicit absence of a cookie Domain attribute; no real identities are used.
- TypeScript, production standalone packaging, all public JavaScript syntax checks and environment/encryption validation passed. Both production origin contracts passed with in-memory non-secret overrides; no `.env` file was modified.
- Read-only database check: connected yes; TLS active yes; certificate authorized yes; hostname verification yes. Runtime superuser/BYPASSRLS false; runtime safety guards pass. All six applied migration checksums match; all nine credit tables have forced RLS. No SQL writes or migrations were run.
- Dependency audit against the official npm registry completed with zero reported vulnerabilities (including development dependencies). The initial default-registry attempt was incomplete and was not counted as a pass. This does not substitute for application security review.
- Current-local-secret literal scan: 102 publishable text files examined, no matches; no private env/cert/Vercel files tracked. `.env`, `.env.migrate`, certificate and `.vercel` environment paths are ignored. This check does not prove absence of unknown/historical secrets. No secret values were displayed or changed.
- Source search found no TODO/FIXME/mock/stub labels in src/scripts/public. Missing functionality is still explicit: `src/server/app.ts:165` returns NOT_IMPLEMENTED for missing APIs, `public/app.js:131` disables submission, and health reports productionReady=false/offline disabled. Localhost references are local defaults/test fixtures or rejection guards, not substituted production endpoints. Minerva's unavailable adapter remains intentionally deferred.
- Existing global npm configuration emitted a warning about an invalid user setting. No global npm configuration was changed; it did not prevent the successful checks above.

## 5. Exact Supabase dashboard actions

Only the public Auth settings were read using existing configuration. They returned `disable_signup=false`, email enabled and email auto-confirm disabled. **Public signup is still enabled and must be turned off.** Site URL, redirect allowlist, custom SMTP, templates and expiry settings were not available through that public endpoint and are not claimed verified.

1. **Authentication -> URL Configuration -> Site URL:** set `https://portal.mynoblescooperative.com` as the single primary production fallback. Do not alternate it per project. CEO invitations explicitly supply their own redirect destination.
2. **Redirect URLs:** allow exactly `https://portal.mynoblescooperative.com/credit/auth` and `https://checker.portal.mynoblescooperative.com/credit/auth`. No fragment or token belongs in the allowlist. Avoid broad production wildcards; use a separate staging project for test callback URLs. These settings follow [Supabase redirect documentation](https://supabase.com/docs/guides/auth/redirect-urls).
3. **Authentication -> Sign In / Providers:** turn off **Allow new users to sign up**. Keep email/password authentication and email confirmation enabled; leave anonymous sign-ins disabled. Do not create a public registration path. See [Auth configuration](https://supabase.com/docs/guides/auth/general-configuration).
4. **Authentication -> Email/SMTP settings:** configure an approved custom SMTP provider, verified Nobles sender/domain, TLS and the provider's required DNS authentication. Enter credentials privately in the dashboard, never in chat, code, screenshots or logs. Verify SPF/DKIM/DMARC, delivery/bounces/rate limits and a staging recipient outside the Supabase team. Supabase's default delivery service is not a production substitute; see [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
5. **Email Templates -> Invite user:** install `config/supabase-invite.html:1` unchanged. Its exact href is `{{ .RedirectTo }}#nobles_invite={{ .TokenHash }}`. Do not use ConfirmationURL, access-token query parameters or the default implicit-token invitation flow. Disable email-provider link tracking/rewriting for these messages and verify scanners do not consume invitations. The variables are documented in [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).
6. **Email Templates -> Reset password:** the existing application expects the numeric `{{ .Token }}` code, not an implicit-token link. Include code/expiry instructions and direct users to their own `/credit/auth` portal (both exact URLs above may be labelled in the email). `src/server/supabase-auth.ts:71` requests recovery without a portal-specific redirect, so do not make a staff-only link the CEO's sole recovery option. Set and record approved password requirements and invite/recovery expiry; do not invent an expiry in email copy.

These are required target settings, not a claim that all are presently missing. Signup is the one directly observed unsafe setting. No dashboard setting was changed during this audit.

## 6. Invitation enablement gate

Keep STAFF_INVITATIONS_ENABLED false/unset in both deployments and bootstrap environment. It is disabled in the inspected local environment; hosted flag values are unverified. Do not enable it or invite UCHE0001 during this task.

Before separate authorization to enable invitations:
- Identify and deploy the reviewed commit to both correct projects; verify working auth routes, real health, private security headers and correct surface/environment on each.
- Prove CA/hostname-verified PostgreSQL access, restricted runtime privileges, immutable invitation audit writes and safe budgets from the actual hosted functions.
- Verify signup disabled, exact redirects and actual rendered custom invitation link; establish custom SMTP delivery and recorded expiry settings.
- Use a separately approved staging identity to test password setup once, replay/expired/invalid/wrong-surface tokens, account-disabled handling, sign-in/out, reset, expiry and session revocation. Test scanners and partial provider/DB failures; do not blindly resend after ambiguous outcomes.
- Verify deployed host-only cookies, copied-cookie denial, CSRF, shared limits, administrative-key isolation and no token leakage through browser storage, referrers, access logs or email tracking.
- Confirm auditable provisioning authorization, target staff-ID/email uniqueness, backup/recovery and explicit approval for the production flag/account operation.

`public/auth.js:2` reads the invite fragment into memory and removes it from the address bar before requests. `src/server/supabase-auth.ts:95` verifies with type=invite, and `src/server/staff-auth.ts:113` handles password setup, audit and revocation. The template remains correct for this flow but has not been verified installed in Supabase or usable on the live 404 route.

## 7. CEO bootstrap and lending-policy gates

`node scripts/bootstrap-ceo.ts --plan` succeeded with PLAN_ONLY_NO_CONNECTION. Target: `chinelo.nnazor@gmail.com`, staff ID **UCHE0001**, application **SUPERUSER** plus the separately previously approved CREDIT_APPROVER role. No account lookup/create/invite/modify was performed by the plan. Live approvals remain disabled.

SUPERUSER grants staff administration and aggregate overview only (`src/domain/access.ts:16`); it does not grant DECIDE or POLICY_PUBLISH by itself. The additional approver role does not bypass assigned scope, maker/checker or self-approval guards (`src/domain/workflow.ts:69`). No PostgreSQL role grant occurs. Metadata retains the previously approved NGN 1,000,000 aggregate Africa/Lagos daily ceiling, empty product allowlist and PENDING_POLICY_PUBLICATION (`src/server/administration.ts:63`). Atomic daily-budget enforcement and published authority/product scope are still incomplete. Nothing here changes that authority or permits policy self-publication.

A READ ONLY transaction under the existing readiness SELECT RLS policy found **0 effective, resolved, PUBLISHED PRODUCT; 0 SCORE; 0 ELIGIBILITY** policies. This is the runtime-visible usable-policy count, not a claim about hidden drafts/future versions. No lending policy was inserted or published. Preserve POLICY_CONFIGURATION_REQUIRED with null percentage/amount (`src/server/readiness.ts:61`); never substitute descriptive seeds or synthetic test rubrics.

## 8. GO-LIVE BLOCKERS

| Blocker | Exact reference / evidence | Release gate |
| --- | --- | --- |
| Implementation is uncommitted/unpushed; exact latest deployment SHAs inaccessible | `src/server/administration.ts:1`; `src/server/readiness.ts:1`; section 1 | Review and securely commit source, confirm GitHub SHA and matching deployments for both projects. Do not push the current incomplete hosting configuration blindly. |
| Live auth/backend missing; security headers not applied | `src/server/start.ts:44`; `scripts/build.ts:6`; `src/server/app.ts:47`; section 2 | Recognized Node entry/build/routing, private backend packaging and public asset security headers; actual deployed checks. |
| Hosted CA availability, environment/runtime validation, proxy identity and combined pool budgets unverified | `src/server/database.ts:22`; `src/server/database.ts:38`; `src/server/staff-auth.ts:39` | Test actual function initialization, trusted ingress, aggregate connection capacity and load/failure behavior. |
| Public Supabase signup enabled; real invitation/reset/session/mail lifecycle not accepted | `docs/AUTHENTICATION.md:25`; `config/supabase-invite.html:1`; `src/server/supabase-auth.ts:71` | Dashboard controls, safe rendered templates, SMTP and staging/provider/browser acceptance. No CEO action yet. |
| Privileged Auth administration key isolation unresolved | `src/server/supabase-auth.ts:42`; `src/server/start.ts:38` | Resolve the existing deployment-isolation requirement without replacing identity or weakening immediate disabled-account checks. |
| No usable published readiness policies or completed controlled policy publication | `src/server/readiness.ts:61`; `src/domain/policy.ts:18`; `docs/IMPLEMENTATION_STATUS.md:46` | Approved, effective product/scoring/eligibility values and independent auditable publication; keep null results meanwhile. |
| Persisted staff transitions, nominated assignment/triage, live approval authority/daily-budget enforcement incomplete | `src/server/app.ts:165`; `src/domain/workflow.ts:25`; `src/server/administration.ts:63` | Implement approved actor bindings, transactional validations/locks/audits and independent decisions. Do not grant all checkers the nominated account's authority. |
| Full reports/export, evidence custody and business-event audit coverage incomplete | `docs/STAFF_WORKFLOW.md:46`; `docs/AUTHENTICATION.md:43` | Server-authorized reporting/private downloads, evidence storage/scanning, immutable event coverage for every enabled operation. Unapproved actions stay denied. |
| Approved-device offline capture and server sync incomplete | `docs/OFFLINE_SECURITY_DESIGN.md:17`; `src/offline/sync.ts:1` | Device/key approval, rollback-resistant attempt/time state, integrity/idempotency/conflict receipts and secure cleanup verified on actual devices. Keep disabled. |
| Backup/key recovery, operators, RPO/RTO and restore/rollback acceptance absent from evidence | `docs/RECOVERY_RUNBOOK.md:1` | Named custodians, documented backup/key custody and a witnessed isolated restoration/reconciliation drill. Migration success is not backup evidence. |
| Real provider, isolated DB concurrency/RLS, browser/mobile and operational security acceptance incomplete | `test/auth.test.ts:16`; `test/readiness.test.ts:1`; `test/administration.test.ts:1` | Synthetic tests are necessary, not a replacement for controlled end-to-end acceptance and monitoring. |

Minerva remains optional/deferred by approval, not itself a launch blocker. Controlled manual verification exists locally; independent evidence and complete workflow acceptance are still required. The project split and HTTPS roots are now evidenced progress, but they do not clear backend or operational gates.

## 9. Safe next work and approval boundary

Safe local next work: implement the recognized Vercel Node entry/build with the existing router; test trusted proxy addressing and configurable bounded pooling; add packaging/CA-delivery tests without committing certificates or changing secrets; extend staging acceptance automation. No substantial application/runtime patch was made before presenting the above failures.

Explicit separate approval is required before any production account/invitation or flag enablement, lending-policy publication, lending-authority change, DB role/RLS change, migration/data write, restore/rollback or destructive action. None was performed. Coordinate a reviewed commit/push and deployment because the connected main branch may trigger production releases; first resolve the hosting/security gaps. Reauthenticate the CLI/connector to the owning Vercel team to verify project metadata; do not provide tokens or passwords in chat.
