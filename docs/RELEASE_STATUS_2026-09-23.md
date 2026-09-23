# Release status - 23 September 2026

Target source repository: `https://github.com/noblesawka2/credit_assesment`.
Publishing source is not a production deployment or a readiness certification. No production migrations or data writes were executed. Existing environment files and CA certificate remain local; only empty configuration examples belong in Git.

## GO-LIVE BLOCKERS

| Current failure or incomplete control | Exact reference | Required resolution |
| --- | --- | --- |
| Updated runtime configuration fails `DATABASE_USERNAME_TARGET_MISMATCH` | `src/server/database.ts:57` | Match the configured restricted role and project to the exact direct/session-pooler username. Do not change the expected role to an administrative role merely to pass validation. |
| Read-only connection still fails with PostgreSQL `28P01` | `scripts/db-check.ts:12` | Correct the selected role's credentials. No password or URL was printed; no authentication or TLS bypass was introduced. TLS booleans on a failed connection are not evidence of an unencrypted established session. |
| `AUTHENTICATION_NOT_ENABLED` | `scripts/readiness.ts:11` | Auth configuration syntax now validates, but activation must wait for reviewed security schema, runtime grants and provider lifecycle tests. |
| Foundation/security/standalone schema and restricted grants lack current deployment and database-backed acceptance evidence | `db/migrations/001_credit_foundation.sql:1`; `db/proposals/002_staff_security.sql:1`; `db/proposals/003_standalone_intake.sql:1` | Review exact SQL, rehearse on staging, verify backup/restore, then separately approve production apply. |
| Controlled manual verification is approved but not connected to HTTP/UI/startup | `src/server/manual-verification.ts:8`; `src/domain/manual-verification.ts:1`; `db/proposals/004_manual_verification.sql:1` | Complete authenticated route/UI integration, approved case assignment and database-backed permission tests before enabling it. The new proposal is not part of the migration runner. |
| Persistent full workflow, server-authorized reports, device approval and sync remain incomplete | `docs/STAFF_WORKFLOW.md:1`; `docs/OFFLINE_SECURITY_DESIGN.md:1` | Complete these without inventing unresolved roles/transitions or enabling unverified approvals. |
| Hosting/staging targets, privileged Auth key isolation and recovery acceptance remain outstanding | `src/server/supabase-auth.ts:38`; `docs/RECOVERY_RUNBOOK.md:1` | Supply the deployment inventory and witnessed restore evidence; a GitHub repository is not a hosting target. |

## Manual-verification work in progress

The user approved controlled manual checks by assigned credit officers while Minerva is deferred. The new library/repository records all five check categories with source, evidence reference, outcome, observation/expiry times and reasons. It binds records to a case revision, preserves originals and workflow status, encrypts evidence details, rejects stale revisions/unauthorized scope, and commits the audit alongside each write. Retries are payload-bound and return the original receipt. Reads are audited before decrypted evidence is returned.

These are staff attestations referencing approved Nobles records, not automatic proof of the source or a verified numerical affordability pipeline. `MANUAL_RECORDED` is not approval, member admission or a formal workflow transition. Expiry/revision freshness does not turn a concern or unresolved finding into a successful check. Evidence custody, source access, policy freshness limits, manual financial verification and checker integration still need implementation/acceptance. The additive SQL proposal creates one immutable, forced-RLS table and policies; it is unapplied and grants no runtime permissions.

Minerva remains optional. Existing safe local-origin and encryption validation pass. The project remains NOT production ready while any blocker above remains.
