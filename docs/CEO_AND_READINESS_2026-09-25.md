# CEO onboarding and readiness rollout - 25 September 2026

Historical snapshot: current deployment evidence and manual setup instructions are in `PRODUCTION_READINESS_2026-09-28.md`. Both HTTPS roots now respond, but auth/health routes return 404. The findings below describe 25 September, not current hosted verification.

## Approved scope

The user explicitly authorized an application `SUPERUSER` role for `chinelo.nnazor@gmail.com`, staff ID `UCHE0001`, and officer-led credit-readiness assessments. This amends the earlier deny-by-default role matrix; it does not authorize PostgreSQL SUPERUSER/BYPASSRLS or bypass of immutable audits, maker/checker, lending policy or daily limits.

| Account/role | Authorized application work | Not implied |
| --- | --- | --- |
| UCHE0001 / SUPERUSER | Staff directory, inviting staff into existing approved roles, aggregate assessment overview | Database administration, granting more SUPERUSER accounts, self-approval, policy self-publication, unrestricted exports or financial overrides |
| UCHE0001 / CREDIT_APPROVER | Existing independent assigned-case decision role, once the approval service and published authority are ready | Unrestricted lending authority; live approvals remain disabled |
| CREDIT_OFFICER | Capture customer information, evaluate assigned saved drafts, record manual verification | Approval, staff administration or bypass of missing policies |
| info@mynoblescooperative.com / OPERATIONS_CHECKER | Previously approved checker role and nominated assignment/triage responsibility | CEO powers or loan approval; assignment/triage implementation is still outstanding |

UCHE0001's approved ceiling is **NGN 1,000,000 combined per Africa/Lagos calendar day**, not per loan. Bootstrap metadata records this as pending authority-policy publication, with an empty product allowlist. Product scope and transactional daily-budget enforcement are not complete; there is no live approval endpoint to bypass them.

## Separate portal deployments

- Officer portal: `https://portal.mynoblescooperative.com`.
- CEO portal: `https://checker.portal.mynoblescooperative.com`.
- These are nominated deployment targets, **not confirmed live deployments**. No future-hostname TLS probe was performed, and local `APP_ORIGIN` remains local.
- Deploy the same backend in two isolated configurations. Use `APP_SURFACE=staff` and the officer origin on the staff deployment; `APP_SURFACE=administration` and the CEO origin on the administration deployment.
- Both configurations set `NODE_ENV=production`, `AUTH_ENABLED=true`, `STAFF_APP_ORIGIN=https://portal.mynoblescooperative.com` and `ADMIN_APP_ORIGIN=https://checker.portal.mynoblescooperative.com`. Set each deployment's `APP_ORIGIN` to its own origin.
- Never set a parent-domain cookie. Existing Secure/HttpOnly `__Host-` cookies have no Domain attribute; server session validation rejects CEO sessions on the staff surface and non-CEO sessions on the administration surface.
- Mount the correct database root CA privately and keep certificate/hostname verification enabled. Do not upload development `.env`, `.env.migrate`, certificates or migration/admin database credentials as public assets.
- The connected Vercel account lists an existing `credit-readiness` project (`prj_KY2IwBklDCsfmy08Or3JfwplSV0F`) in `noblesawka2-8845s-projects`. Its production deployment points to the older Git commit `db3f9200d9bc99332339a31563099c33ce710023`, not these uncommitted implementation changes. Vercel's `READY` build state does not establish application readiness.
- Project-scoped connector requests return 403 and require reauthentication to the owning scope. The local CLI identifies a different account (`twentytwoparts-9330`); no local project is linked. Reauthenticate the connector/CLI to the owning team before linking or changing project settings. No token values were requested or displayed.
- Read-only requests to the existing deployment's `/`, `/credit/auth` and `/api/health` each returned HTTP 302. Redirects were not followed, so backend health and staff sign-in remain unverified. No deployment protection was disabled and neither future custom hostname was probed.
- A staging project, the separate administration deployment, DNS/certificates, platform routing, proxy trust and connection budgets remain unverified. Supabase Management API access is not configured locally. `.vercelignore` excludes local environment files, CA/key files and generated artifacts from CLI source uploads; `.gitignore` excludes local `.vercel` linkage/environment files. These exclusions do not configure hosted environment variables.

## One-time CEO invitation

**No invitation has been sent and no CEO account was created.** The read-only Supabase lookup found neither nominated account. A desired hostname alone is insufficient to deliver a working password-setup flow.

1. Deploy and validate both HTTPS surfaces. Add the exact `/credit/auth` URLs for both hosts to Supabase Auth's redirect allowlist; use the appropriate configured Site URL.
2. Disable public signup. Configure and verify custom SMTP delivery to non-project-team recipients.
3. In Supabase's **Invite user** email template, install `config/supabase-invite.html`. Its link uses `{{ .RedirectTo }}#nobles_invite={{ .TokenHash }}`: the token stays out of HTTP query/access logs. Do not substitute the default implicit-token template; this application deliberately consumes an invite hash on the password-setup POST.
4. Confirm invitation expiration and email-scanner behavior using a separate staging account. Page loading does not consume the token; the user submits a new password before server-side `type=invite` verification. Reused/expired tokens fail. Passwords must be at least 12 characters; no shared default password is generated.
5. Only after those checks, set `STAFF_INVITATIONS_ENABLED=true` in the approved server-only deployment/bootstrap environment.
6. Preview without connections: `node scripts/bootstrap-ceo.ts --plan`.
7. From a securely configured environment with the production administration surface, restricted runtime DB credentials and server-only Supabase key, run `node scripts/bootstrap-ceo.ts --apply --expected-project <approved-project-ref> --expected-origin https://checker.portal.mynoblescooperative.com`.
8. The bootstrap creates an unconfirmed Supabase account with controlled app metadata, then asks Supabase to send the invitation. An existing email/staff-ID match is a hard stop, never a silent privilege upgrade. Bootstrap and authenticated staff provisioning are distinguished in immutable encrypted administrative audit records.
9. A provider-accepted invitation is not proof of mailbox delivery. Verify receipt without sharing the link or password. Completion revokes provider/local sessions and requires a fresh sign-in.
10. If a request fails after account creation or token consumption, do not blindly retry, delete the account, set email_confirm=true or issue a default password. The custodian must reconcile the Supabase account, immutable audit and delivery status, then issue a reviewed replacement invitation without modifying approved role metadata.

The CEO uses `/credit/admin` to see totals/status counts and invite staff. Staff creation cannot grant SUPERUSER or MEMBER, edit an existing account's authority, or circumvent the separate approval service. Provider administration keys still need deployment isolation; the web process currently holds an Auth service key.

These invitation APIs and template variables follow [Supabase invitation documentation](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail) and [Supabase email-template documentation](https://supabase.com/docs/guides/auth/auth-email-templates). Hosted template/redirect/SMTP settings require dashboard or Management API access; a project service key does not configure those platform settings.

## Policy-based readiness

Officers save a customer draft, then open `/credit/readiness`. The server checks the current session, officer role, assignment, revision, allowable stage and shared rate limits; it loads policies from PostgreSQL rather than accepting thresholds from the browser. Results preserve originals and are encrypted, append-only, revision/policy-bound and audited transactionally. Retries reuse the same payload-bound idempotency key.

The result contains the existing policy score out of 100, readable limiting reasons, an estimated eligible amount, the score breakdown and underlying calculations. It uses the existing affordability, stress, exposure, need, fee/savings and product-ceiling formulas. Inputs are explicitly **officer-reported and unverified**; a favorable result means ready for review, not member/KYC clearance, repayment probability or loan approval. Negative capacity/below-minimum/weak-band hard stops return a zero preliminary amount with reasons.

For each selected product code, publish independently approved, effective `PRODUCT`, `SCORE` and `ELIGIBILITY` policy versions with no unresolved items:
- PRODUCT payload: the existing `ProductMathConfig` contract; monetary fields are decimal integer-kobo strings. All product charges, periods, increments and limits must be approved.
- SCORE payload: all existing factor rubrics plus the approved new-to-credit neutral points. The server binds the score to the published database policy ID. Do not publish the synthetic test rubrics.
- ELIGIBILITY payload: `contract="READINESS_V1"`, approved `minimumTotalDscrMilli`, `salesStressBps`, `otherIncomeStressBps`, optional `maximumTotalDebtServiceRatioBps`, and integer-kobo `memberOrCycleLimitKobo`/`maximumExposureKobo`. This config supplies preliminary affordability controls, not proof of membership or source verification.

**Current production policy count is zero.** The screen/API therefore returns `POLICY_CONFIGURATION_REQUIRED` with null percentage and amount, never fabricated eligibility. Policy publication UI/service and the remaining underwriting configuration are still incomplete. The imported descriptive product seeds are not executable published policy.

## GO-LIVE BLOCKERS

| Blocker | Exact reference |
| --- | --- |
| CEO account/invitation not provisioned; hosting, verified redirects/template/SMTP and delivery acceptance are absent | `scripts/bootstrap-ceo.ts:12`; `src/server/administration.ts:35`; `config/supabase-invite.html:1` |
| Existing Vercel deployment contains an older commit; owning-team project access, backend routing and both portal deployments are unverified | `docs/CEO_AND_READINESS_2026-09-25.md:16`; `src/server/start.ts:1`; `scripts/build.ts:1` |
| No published scoring/product/eligibility policies; no real numeric readiness result can be issued | `src/server/readiness.ts:61`; `src/domain/score.ts:15`; `docs/IMPLEMENTATION_STATUS.md:46` |
| Daily financial authority/product scope and persisted approval workflow remain incomplete | `src/server/administration.ts:63`; `src/domain/workflow.ts:33` |
| Privileged Auth key isolation and hosting-specific proxy/rate-limit/deployment controls remain unresolved | `src/server/supabase-auth.ts:42`; `src/server/staff-auth.ts:39`; `docs/OPERATIONS.md:1` |
| Full reporting/export, approved-device offline sync, assignment/triage, private evidence custody and recovery acceptance remain unfinished | `docs/STAFF_WORKFLOW.md:1`; `docs/OFFLINE_SECURITY_DESIGN.md:17`; `docs/RECOVERY_RUNBOOK.md:1` |
| Real-provider, staging database concurrency/RLS, mobile and end-to-end acceptance remain outstanding | `test/administration.test.ts:1`; `test/readiness.test.ts:1` |

## Validation and migration evidence

Migration 006 was displayed, rehearsed with ROLLBACK, then committed under the user's migration authorization. Its SHA-256 is `67e82ccb4a84b290f022da435485de814dcbe4e771d784738afeec0b45207760`; the six-file bundle hash is `0989838be98aca54d1684944369c9b0012414211eb0fd2bedba6e2a98041b8d3`. Existing applied SQL 001-005 was not changed. Only new schema/policies/permissions and the expanded security-event check were applied; no customer data, user account, lending policy or loan decision was changed.

Read-only verification confirms all six receipts, forced credit RLS, least-privilege runtime guards and verified TLS: connected yes, encrypted yes, certificate authorized yes, hostname verified yes; superuser/BYPASSRLS both false. All 122 tests passed before the additional HTTP portal regression, which also passed separately. TypeScript, build and environment/encryption checks passed. The branded sign-in screen was visually inspected from a local headless-browser capture.

Continuation checks passed: the complete automated test command, JavaScript syntax check for the final readiness UI edit, TypeScript/production packaging and environment/encryption validation. The existing read-only database check again confirmed verified TLS, safe runtime privileges and all six matching migration receipts. No migrations or production data writes were performed in this continuation.

The supplied logo is used unchanged with purple/gold accents and pure-white page surfaces. No new Git push or hosting deployment is claimed. The application remains **NOT PRODUCTION READY**.
