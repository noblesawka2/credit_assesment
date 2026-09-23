# Implementation status - 8 September 2026

Latest scope update: Minerva is deferred, with standalone encrypted draft capture/list/resume implemented behind the existing approved intake roles. See `STANDALONE_OPERATION.md` and `DATABASE_CREDENTIALS.md`. The original historical acceptance table below is not a new release certification. Manual verification, full workflows, reports and offline synchronization remain incomplete; no production migrations were executed.

The sections below are historical. Current 18 September changes and remaining failures are in `BACKEND_READINESS_2026-09-18.md`, `AUTHENTICATION.md` and `PERMISSIONS_REVIEW.md`. Supabase Auth is selected and implemented but not configured/activated; the matrix was approved with unresolved actions denied. Database authentication now succeeds, but runtime role/schema gates remain blocked. No production write or migration occurred.

Historical implementation snapshot. The 17 September 2026 audit and subsequent TLS-only remediation are documented in `RELEASE_AUDIT_2026-09-17.md`; production database authentication remains blocked and the full application remains incomplete.

The supplied specification is the target, not a statement of completed functionality. Its embedded commands do not authorise production access. The test file was deleted as requested. The original package name was preserved.

## Acceptance coverage

| Specification area | Implemented | Remaining / not verified |
| --- | --- | --- |
| Member/staff intake | Mobile shell, thirteen routes, readiness gating, online draft client | Full field contract, repeatable structured debts/expenses/items, route branching, client/server schema parity, full validation, autosave recovery, consent versions, submission |
| Original vs verified values | Domain contract, verification function, SQL immutable-original guard | Authenticated verification UI/API, document lookup, persistence/auditing of verification service |
| Financial formulas | Integer-kobo reference formulas, validations, stress, need, inverse, ceiling, schedules | Complete authoritative input pipeline, separately-paid upfront affordability, all edge-case review and approved product calendars |
| Products and policies | Draft source seeds, domain publication checks, SQL version records | Policy UI/API, DB publication permissions, publication audit, resolved product configurations, approved effective dates |
| Diagnostic score | 100-point factor model, deterministic rule evaluator, bands, stored result shape | Approved rubrics for underspecified factors, neutral-history value, published rule seeds, policy persistence and server calculation integration |
| Eligibility/hard stops | Workflow hard-stop/compliance-hold guards | Published eligibility evaluation, complete hard-stop evaluator, controlled manual confirmation |
| Maker-checker workflow | Declared graph, role/assignment checks, amount authority guards, event objects | Transactional persistent transition service, authority policy resolution, reviewer assignment, case-locking and all valid-edge integration tests |
| Audit | Immutable SQL records, transactional draft audit, domain event objects | Audit persistence for every verification, policy change, override, review and decision; privileged-DB threat review |
| Staff workspace | Locked informational route | Queue, appraisal, original/verified comparison, recommendation, checker, conditions and exception interfaces |
| Reports | None | Appraisal PDF, management reports, override reports, offline/device reports and protected downloads |
| Assessment/outcome linkage | SQL immutable snapshot and outcome tables | Snapshot creation, core-confirmed disbursement linkage, repayment ingestion, PAR dashboard, de-identified reporting |
| Offline capture | AES-GCM vault library, encrypted IndexedDB adapter, grant and inactivity checks | Approved device-bound key provider, signed/server-issued grants, device registry APIs, offline UI, photograph/document capture, PIN/biometric flow, revocation integration and recovery |
| Synchronisation | Client transport interface, local states, checksum assembly, acknowledgement guard | Server sync ledger, idempotent sync create/update, resumable upload endpoints, conflict review, stale-policy acknowledgement and per-record member resolution |
| Core integration | Typed adapter, pending-only default | Approved Minerva interface and credentials, verified member/identity/exposure/duplicate responses, core disbursement confirmation |
| Database | Migration file and checksum-protected migration runner | Execution against PostgreSQL, RLS and transaction integration tests, backup/restore rehearsal |
| Tests | Formula, permission, all declared/undeclared domain transition edges, encryption and HTTP tests | Database-backed transitions, full sync retries/conflicts, real supported mobile offline-online testing and end-to-end journeys |

No real loan product is enabled. No UI score or library output should be represented as a final appraisal or approval.

## Exact offline behaviour

Available in the shipped browser: previously cached non-sensitive navigation and instructions only. All entry fields are disabled when offline. There are no offline calculations displayed in this shell and no local PII persistence.

Available as unconnected, tested libraries: seal/open encrypted payloads with a supplied non-extractable AES key; inactivity locking; grant/device checks; ciphertext retention after expiry; local state transitions; attachment checksum verification; sync receipt checks; acknowledged local removal. Test key providers are synthetic and do not demonstrate hardware key binding. IndexedDB removal does not prove physical erasure from browser or operating-system backups.

Deliberately blocked: member offline self-service, real staff offline capture without an approved key provider, offline member/KYC/exposure confirmation, final scoring, recommendations/decisions, approval and disbursement. Role membership alone is insufficient for an offline grant. The client sync interface is not an implemented synchronisation service.

## Identity and roles

Roles are defined explicitly in `src/domain/access.ts`: MEMBER, ASSISTED_INTAKE, CERTIFIED_FIELD_AGENT, CREDIT_OFFICER, OPERATIONS_CHECKER, COMPLIANCE_CONTROL, CREDIT_APPROVER, FINANCE_DISBURSEMENT, DIGITAL_SYSTEMS_SUPPORT, POLICY_ADMIN_MAKER, POLICY_ADMIN_CHECKER.

There were no existing roles to map. Startup uses a default-deny identity adapter. No second login system was created. An approved identity provider must supply active status, actor UUID, role mapping, external member identifier and explicit capabilities through the server-side adapter. Browser payloads cannot supply these controls.

## Product discrepancies and management decisions

- No pre-existing published configuration was found or overwritten. `config/product-seeds.json` retains the supplied product descriptions, not the normalized executable math configuration.
- MarketLift: confirm deducted-from-proceeds versus separately-paid upfront interest/charges, working-day calendar and periods-per-month convention.
- MarketPower: confirm booklet applicability/treatment, approved cycle limits and handling of the supplied NGN 300,000 to NGN 301,000 boundary.
- EasyPay: insurance amount/basis and principal limits are unspecified. Salary verification and total-debt-service enforcement need the authoritative input integration.
- Unity: savings, group purse amount/scope, principal limits, individual/group authority and independently verified guarantee rules are unresolved.
- All products need approved principal increments, calendars, effective dates, maker/checker identities, exposure controls and authority versions.
- Approve remaining scoring rubrics, new-to-credit neutral points, evidence-confidence controls, material variance thresholds, stress parameters and minimum DSCR.
- Approve eligibility/geography rules through policy publication; gender is not an unexplained score component.
- Approve identity provider, certified-agent permissions, device/key platform, offline TTL, retention/recovery, private evidence storage, malware scanning and audit access.

## Validation interpretation

Final local validation: **71 tests passed**, `npm.cmd run typecheck` passed, and `npm.cmd run build` passed. The server started successfully on localhost. A headless desktop screenshot was generated, but image inspection was blocked by the host sandbox; visual review and real mobile testing remain outstanding.

Dependency installation completed with exact official archive references for TypeScript 5.9.3, Node 24.3.0 type definitions, and pg 8.15.5 type definitions after full metadata downloads stalled. `package-lock.json` records integrity hashes. No security-audit success is claimed.

Passing unit tests validate the functions they exercise, not the whole specification. SQL files and repository methods have not been executed against a real database. Domain transitions are pure functions, not yet transactional production endpoints. No migration success, production readiness, hardware encryption assurance or complete offline sync is claimed.
