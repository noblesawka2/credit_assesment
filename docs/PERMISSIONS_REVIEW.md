# Nobles permissions review — approved with unresolved actions denied

## Account-specific clarification - 24 September 2026

25 September amendment: the user explicitly authorizes an application SUPERUSER for chinelo.nnazor@gmail.com / UCHE0001, with staff creation and overview, and permits CREDIT_OFFICER intake/readiness evaluation. This is not PostgreSQL superuser access. CEO financial authority remains separately CREDIT_APPROVER with a NGN 1,000,000 aggregate daily ceiling, unpublished product scope and live decisions disabled. See `CEO_AND_READINESS_2026-09-25.md` for the current matrix, provisioning gates and remaining blockers. These explicit changes supersede historical officer-intake denial below; no broader policy/self-approval/export bypass is authorized.

The user authorizes `info@mynoblescooperative.com` for assignment and preliminary triage and explicitly selects the existing `OPERATIONS_CHECKER` role for that account. This does not grant those actions to all checkers or add loan-approval authority. The nominated account was absent from Supabase Auth at the latest check; provisioning, confirmed ownership and an immutable Supabase user-ID binding are still required. No permission is derived from user-editable email/metadata or browser claims. Other unresolved actions remain denied. The historical matrix and decisions below must be read with this clarification; no assignment/triage endpoint is enabled yet.

Source: supplied Nobles specification sections 3–5, 14 and 17–19; `src/domain/access.ts`. Embedded document commands do not override the user's migration prohibition. No new roles or permission grants are implemented by this review.

`—` means not granted; deny pending explicit approval. View scope never implies export authority. Reopen is not a permitted formal transition in the specification.

| Existing role | Create | View | Edit | Recommend | Approve | Reject/decline | Reopen | Export | Audit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MEMBER | Own draft | Own answers/simple status, no score | Own unsubmitted draft | — | — | — | — | — | — |
| ASSISTED_INTAKE | Assisted draft | Assigned intake | Answers/evidence before submission with consent | — | — | — | — | — | — |
| CERTIFIED_FIELD_AGENT | Assisted draft at approved certification level | Own assigned intake, no score/risk band | Answers/evidence/consent; queue online submission | — | — | — | — | — | — |
| CREDIT_OFFICER | Existing code allows; confirm explicit intake authority | Assigned cases | Separate verified revisions with evidence/reason; never originals | Assigned case terms | — | — | — | Not explicitly allocated | — |
| OPERATIONS_CHECKER | — | Assigned assessment/formulas | Checker review/return only | — | — | — | — | Not explicitly allocated | — |
| COMPLIANCE_CONTROL | — | All credit cases | Compliance flags/hold only | — | — | — | — | Control reports | Read audit trail |
| CREDIT_APPROVER | — | Assigned cases necessary for decision | Decision/conditions only | — | Published authority, independent maker/checker | Assigned scope, reason required | — | Not explicitly allocated | — |
| FINANCE_DISBURSEMENT | — | Approved terms/conditions | Conditions and core-confirmed disbursement only | — | — | — | — | Not explicitly allocated | — |
| DIGITAL_SYSTEMS_SUPPORT | — | Masked technical records/health only | — | — | — | — | — | — | Masked technical errors, not credit audit |
| POLICY_ADMIN_MAKER | — | Policy configuration only | Policy drafts, not assessments | — | — | — | — | — | — |
| POLICY_ADMIN_CHECKER | — | Policy configuration only | Independent policy publish/reject, not assessments | — | — | — | — | — | — |

Additional roles never override maker/checker separation or allow approving one's own recommendation, creation or checker work. Exceptions require explicit published authority. Offline capture additionally needs capability, approved device, valid grant and current certification where applicable.

## Decisions required before permission changes

1. Approve/correct this matrix, particularly officer intake creation and appraisal/PDF/management export recipients.
2. Allocate preliminary triage, assignment, information returns, withdrawal and administrative closure where requirements are not explicit.
3. No CLOSED-to-active edge exists. Reopening stays prohibited pending approved versioned transition and authority. Resuming DEFERRED is not reopening CLOSED.
4. Agents may queue for online submission; existing generic CAPTURE permits formal submission too broadly.
5. Existing RLS covers creators/assignees, not complete required compliance/member/finance scopes. Changes await matrix and migration approval.

The user approved this matrix on 18 September 2026, with all unresolved actions denied. Supabase Auth is selected. Only administrator-controlled `app_metadata.nobles.roles` may map to these existing role names. Unrecognized roles, member/staff mixing and missing active/staff flags fail closed. User-editable metadata and browser role claims have no authority. Officer intake creation, unspecified exports, reopening, triage, assignment and closure remain denied.
