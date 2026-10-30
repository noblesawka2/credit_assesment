# Controlled launch scope — 1 October 2026

## Exposed surfaces

| Surface | Public routes | Protected routes |
| --- | --- | --- |
| Staff | `/`, `/check`, `/credit/auth`, `/api/health`, `/api/public/readiness/config`, `/api/public/readiness/evaluate` | `/credit/staff`, `/credit/apply/*`, `/credit/verification`, `/credit/readiness`, staff data APIs |
| Administration | `/credit/auth`, `/api/health` | `/credit/admin`, administration APIs |

The staff root redirects to `/check`. The administration root redirects to `/credit/admin`, which redirects an unauthenticated request to `/credit/auth`. A public request cannot render a protected staff or administration shell.

## Public self-check boundary

- The browser sends only product, purpose, income type, approximate monthly income, business costs, household expenses, other commitments, existing repayments and requested amount.
- The endpoint rejects extra fields, including identity fields, validates money on the server, applies the shared API limiter and a dedicated public-readiness limiter, and accepts mutations only from the configured staff origin.
- The calculation runs in a PostgreSQL `READ ONLY` transaction. It does not create an application, result, audit record, cookie or browser persistence entry and does not retain the submitted answers.
- The response contains only a public status, cash-flow percentage, public-safe reasons and a null eligible amount. It does not return member records or staff data.
- The percentage is the share of reported monthly income remaining after reported business costs, household expenses, other commitments and existing repayments. It is not a repayment probability or lending score.
- The page shows a broad educational purpose catalogue and public website product guidance. Those descriptions do not activate a lending threshold, approved amount or credit decision.
- The result includes a plain-language remark and a purpose-based product plan to discuss. The plan remains non-binding and requires officer verification and formal assessment.
- The primary CTA uses `https://mynoblescooperative.com/membership/`; the secondary CTA uses the existing Nobles Member Care WhatsApp route.

## Interim financial guidance

The public check does not require or publish lending policies. It calculates only reported cash-flow headroom and always returns a null eligible amount. Product suggestions come from documented public product descriptions and purpose mappings, not from an approval rule. Formal underwriting, staff decisions and any future lending-policy workflow remain separate and controlled.

## Existing protected workflows

The staff readiness repository remains assigned-case, role, revision, idempotency, encrypted-result and immutable-audit controlled. The administration surface remains `SUPERUSER`-only for approved management functions. Session cookies remain host-only `__Host-` cookies, and authentication continues to reject a session presented to the wrong surface.

## Hosting and capacity

- Vercel installs build tooling with `npm ci --include=dev`; TypeScript remains a development dependency and is not added to the runtime package set.
- Both deployments retain session pooling and the approved capacity plan: pool max `2`, connection budget `15`, reserved `7`, staff planning instances `2`, administration planning instances `2`.
- The maximum-instance values are planning assumptions, not Vercel runtime instance caps. Operational monitoring and low-volume launch controls remain necessary to prevent unexpected session-pool exhaustion.
- TLS verification, CA handling, RLS, database role, domains, invitation switch and maker/checker controls are unchanged.

## Explicitly deferred or disabled

- Staff invitations remain disabled.
- No CEO or staff account is created by this release.
- No migration or production-data write is part of this release.
- No lending policy is created or published by this release.
- Offline synchronization and expanded reports remain outside the exposed launch workflow until completed and separately approved.
