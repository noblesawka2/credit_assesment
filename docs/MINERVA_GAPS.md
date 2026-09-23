# Minerva integration gap analysis

## Scope update - 18 September 2026

Minerva implementation belongs to the external integration team and is deferred by the user. It is no longer a prerequisite for online draft capture or a standalone release dependency. `docs/STANDALONE_OPERATION.md` describes the implemented unverified draft path and remaining manual-verification gates. This gap analysis is a future handoff, not a demand to configure Minerva before using standalone intake. No endpoint has been invented.

## Current implementation and references

`src/integration/core.ts:2` returns PENDING_MANUAL_VERIFICATION for all six methods. This is a deliberate fail-closed stub, not a working Minerva API or a successful production mock. `src/integration/core-contract.ts:7` is the target boundary from specification section 16. `src/server/app.ts` calls member matching and membership/KYC only if an external adapter is explicitly supplied. Startup supplies none; drafts remain unverified with no invented external identity. Savings/exposure/duplicate/reference methods are not integrated into a persistent workflow.

The complete pre-change literal Minerva reference inventory was README.md (integration section), docs/IMPLEMENTATION_STATUS.md (integration status), and docs/RELEASE_AUDIT_2026-09-17.md (stub/blocker/activation sections). No endpoint URLs, credentials, auth client, SDK, webhook route, real payload fixtures or approved API documentation were found. Tests in `test/security.test.ts` verify the stub never reports VERIFIED. New documentation here describes requirements, not a fabricated external interface.

## Payload and identifier contract

These are internal shapes, NOT undocumented external endpoint requests. Transport field mappings need Minerva approval. Amounts must cross JSON as validated integer-kobo decimal strings, not JavaScript bigint or floating-point naira.

| Operation | Internal input | Expected verified result / missing mapping |
| --- | --- | --- |
| matchMember | memberNumber and/or registeredPhone, fullNameClaim, optional localApplicationId | Status, authoritative externalMemberId, masked summary, reasonCode. Ambiguous matches must stop only that record. No fuzzy automatic identity confirmation. |
| getMembershipAndKycStatus | externalMemberId | Status, active, kycTier, restrictions. Need authoritative source/version/verification time and restriction semantics. |
| getSavingsSummary | externalMemberId | Active savings months, regularity basis points, available integer-kobo balance; agree observation date/window and available-vs-ledger definitions. |
| getCreditExposure | externalMemberId | Outstanding kobo, monthly debt-service kobo, arrears days, active facilities; define inclusion of guarantees/group/connected exposures and as-of time. |
| checkDuplicateApplication | externalMemberId, localApplicationId | Status and duplicate permanent application references; define active/closed/withdrawn matching scope. |
| recordApprovedCaseReference | permanent applicationReference, externalMemberId, approvedAmountKobo, productCode, productVersion | Status and externalCaseReference; exact allowed write semantics not approved. This must NOT disburse or mutate balances. |

Additional missing boundary operations: confirmed disbursement lookup/event, repayment schedule/outcomes, PAR/recovery/write-off inputs and reconciliation status. Do not invent them as external endpoints. Keep internal application UUID, device-local UUID, NBL-CR permanent reference, Minerva member ID, external case/facility ID, transaction ID and product/version identifiers distinct.

## Authentication and delivery controls

- Minerva authentication is unspecified. Obtain approved service-account/OAuth/mTLS/API-key contract, scopes, environment base addresses, CA requirements, rotation and network allowlisting. Supabase staff authentication is not Minerva authentication. No direct production-table access.
- All checks are online-only with timeout and schema validation. Timeouts/unavailable source return SOURCE_UNAVAILABLE, never VERIFIED. Manual verification needs approved evidence, reviewer authority, reason, expiry and audit; currently that service does not exist.
- Proposed retries: bounded exponential backoff plus jitter for documented transient reads/429/5xx, honor Retry-After and circuit-break repeated outages. Do not blindly retry validation/authorization failures. Do not retry a possible write until remote idempotency/lookup semantics are documented.
- Persist one stable application/local UUID operation key, payload hash, attempts and response receipt. Bind idempotency to operation/member/version; reject same key with different payload. Use a transactional outbox before any approved outbound write. No distributed atomicity claim.
- Reconcile unknown outcomes by querying the authoritative reference/status, not resending a disbursement. Record as-of/source correlation and payload digest; alert on unmatched/duplicate/different amount/product outcomes. Preserve both versions and require authorized conflict review. Re-run calculations and consent gates after changed data/policy.
- Incoming callbacks would need documented signatures, timestamp/replay windows, event IDs, ordering semantics and a durable inbox. None is currently supplied or implemented.

## Access/documentation blockers

Need API specification and versions, sandbox account and test members, credentials provisioning, least-privilege scopes, allowed operations, sample success/failure/ambiguous responses, identifier/product mapping, integer money format, service availability/rate limits, idempotency retention, webhook signing, reconciliation/report/export access and support/escalation ownership. Obtain explicit approval before reference writes; balance/disbursement writes remain prohibited. No live integration calls were made.
