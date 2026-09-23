# Formal staff workflow — 18 September 2026

Source: supplied specification sections 3–5, 7, 12–17; approved `PERMISSIONS_REVIEW.md`. No additional statuses or roles are invented. This is the complete required graph, not a claim that transactional workflow routes exist.

## Common transition gates

Every permitted transition needs an authenticated active identity, approved role/scope/assignment, online operation, expected revision, stable idempotency key, reason, correlation ID, actor/time, assignment and SLA. Persist change and immutable audit in one transaction. Reject stale revisions; retry returns the same receipt. No silent last-write-wins.

- A: definitive member match, active membership, KYC, current savings/exposure/arrears and duplicate controls, valid published policy/consents, no hard stop or compliance hold for forward progression.
- B: complete questionnaire/evidence, separately verified financial revisions and variance reasons, deterministic server calculations, immutable product/score/authority/input snapshots. Never overwrite submitted originals; returned information is supplemental.
- C: recommendation and independent checker; approver is neither creator, recommender nor checker; amount within configured authority, request and ceiling. A higher request needs new member consent, an exception needs explicit exception authority and its own audit. Conditional-to-final approval requires satisfied conditions.
- D: accepted exact terms, satisfied conditions, authoritative core transaction confirmation and unique core reference; never infer disbursement from HTTP success or a locally created reference.

## All statuses and edges

`Pending` means the requirements declare the edge but role authority was not explicit; the user approved keeping it denied. `src/domain/workflow.ts` rejects these targets rather than choosing a role. All other edges still need a persistent service; none are live HTTP decision endpoints.

| From | Every destination in required graph | Actor and additional gates |
| --- | --- | --- |
| DRAFT | SUBMITTED; WITHDRAWN | Member own / assisted intake with consent: SUBMITTED (A+B intake subset). Withdrawal: Pending. Certified agents queue only, not formal submission. |
| SUBMITTED | PRELIMINARY_CHECK; RETURNED_FOR_INFORMATION; WITHDRAWN | Pending triage/return/withdrawal authority. Preserve originals. |
| PRELIMINARY_CHECK | ASSIGNED; RETURNED_FOR_INFORMATION; DEFERRED; DECLINED | Assignment/return Pending. Approver defer/decline with assigned scope/reason, not automatic hard-stop rejection. |
| RETURNED_FOR_INFORMATION | SUBMITTED; WITHDRAWN | Member own / assisted intake with consent: SUBMITTED (A, supplemental evidence/consent). Withdrawal Pending. |
| ASSIGNED | DESK_REVIEW | Assigned credit officer; A. |
| DESK_REVIEW | FIELD_VERIFICATION_PENDING; ASSESSMENT_COMPLETED; RETURNED_FOR_INFORMATION | Assigned credit officer; A, B for completion. Information return Pending. |
| FIELD_VERIFICATION_PENDING | FIELD_VERIFIED; RETURNED_FOR_INFORMATION; DEFERRED | Credit officer: FIELD_VERIFIED with evidence and A. Approver: DEFERRED with reason. Information return Pending. |
| FIELD_VERIFIED | ASSESSMENT_COMPLETED | Assigned credit officer; A+B. |
| ASSESSMENT_COMPLETED | CHECKER_REVIEW | Credit officer: A+B, full recommended terms, risks, mitigants and ceiling-variance reason. |
| CHECKER_REVIEW | RETURNED_TO_CREDIT_OFFICER; PENDING_APPROVAL | Operations checker, independent of recommender. A+B and complete formula/input review for pass. |
| RETURNED_TO_CREDIT_OFFICER | ASSESSMENT_COMPLETED | Assigned credit officer: A+B, controlled corrective revision. |
| PENDING_APPROVAL | CONDITIONALLY_APPROVED; APPROVED; DEFERRED; DECLINED; RETURNED_TO_CREDIT_OFFICER | Credit approver: A+B+C for approval; reason for every decision/return. |
| CONDITIONALLY_APPROVED | APPROVED; DEFERRED; DECLINED | Credit approver: A+B+C and conditions for approval; reason otherwise. |
| APPROVED | MEMBER_ACCEPTED; WITHDRAWN | Same member accepts exact approved terms with consent, A. Withdrawal Pending. |
| MEMBER_ACCEPTED | DISBURSEMENT_READY | Finance: A, accepted terms and conditions; no appraisal/terms modification. |
| DISBURSEMENT_READY | DISBURSED | Finance: A+D. |
| DISBURSED | CLOSED; DEFAULT_OUTCOME_RECORDED | Pending outcome/closure authority. Authoritative repayment evidence and immutable snapshot linkage required. |
| DEFERRED | RETURNED_FOR_INFORMATION; ASSIGNED; CLOSED | Pending return/assignment/closure authority. A on future assignment. |
| DECLINED | CLOSED | Pending closure authority. |
| WITHDRAWN | CLOSED | Pending closure authority. |
| DEFAULT_OUTCOME_RECORDED | CLOSED | Pending closure authority. |
| CLOSED | None | Terminal. Reopening and deletion prohibited. |

Every absent edge, skipped checker/approval, offline transition, self-approval, unauthorized exception, unverified disbursement and submitted-original overwrite is prohibited. Unity additionally requires each individual to pass controls, group threshold/exposure and all consents. A role alone never authorizes offline capture.

## Server-authorized reports, not fabricated dashboards

Reports remain blocked until correct persistent records, role/RLS scopes and audited exports exist. Only control-report export for COMPLIANCE_CONTROL is explicitly approved; other PDF/management export recipients remain denied.

| Requested report | Authoritative source / definition needed |
| --- | --- |
| Assessments created | Application created_at, exclude retried idempotent creates; server-scope before aggregate |
| Pending review | Explicit status buckets (desk/field/checker/approval), no double counting; display pending stage |
| Approved / declined | Immutable decision events; distinguish conditionally approved and latest status from decision history |
| Turnaround | Submitted timestamp to first final decision; stage durations from events, exclude/identify open cases; timezone Africa/Lagos |
| Officer / product category | Historical assignment and immutable product version at decision, not editable display labels |
| Exceptions | Authorized override events, requested/system/officer/approved amounts and reasons |
| Audit activity | Authorized audit scope, fixed event categories, server time and offline client time distinctly labelled |

Also required by sections 18–20: appraisal PDF with financial/verification/decision/version details; requested/need/supported/recommended/approved variance; approval rate by market/product/officer; outside-policy/override registers; missing evidence and reported-vs-verified variance; affordability/DSCR and score distributions; decline/defer reasons; recommendation-vs-decision; concentration; new/repeat performance; original-score repayment/PAR1/PAR7/PAR30/default/recovery/loss/model-version analysis; authorized inclusion reporting. Filter by date/product/branch/market/officer/channel/score/status/decision only after server authorization. Mask identifiers, apply scope before aggregation and download, audit every export, expire download access, and never put reports in the service-worker cache.
