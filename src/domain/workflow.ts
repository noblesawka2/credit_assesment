import { authorize, assertCaseAccess, type Actor, type Action } from "./access.ts";
import { nonnegative, reason, requireControl } from "./validation.ts";
export const WORKFLOW = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["PRELIMINARY_CHECK", "RETURNED_FOR_INFORMATION", "WITHDRAWN"],
  PRELIMINARY_CHECK: ["ASSIGNED", "RETURNED_FOR_INFORMATION", "DEFERRED", "DECLINED"],
  RETURNED_FOR_INFORMATION: ["SUBMITTED", "WITHDRAWN"],
  ASSIGNED: ["DESK_REVIEW"],
  DESK_REVIEW: ["FIELD_VERIFICATION_PENDING", "ASSESSMENT_COMPLETED", "RETURNED_FOR_INFORMATION"],
  FIELD_VERIFICATION_PENDING: ["FIELD_VERIFIED", "RETURNED_FOR_INFORMATION", "DEFERRED"],
  FIELD_VERIFIED: ["ASSESSMENT_COMPLETED"],
  ASSESSMENT_COMPLETED: ["CHECKER_REVIEW"],
  CHECKER_REVIEW: ["RETURNED_TO_CREDIT_OFFICER", "PENDING_APPROVAL"],
  RETURNED_TO_CREDIT_OFFICER: ["ASSESSMENT_COMPLETED"],
  PENDING_APPROVAL: ["CONDITIONALLY_APPROVED", "APPROVED", "DEFERRED", "DECLINED", "RETURNED_TO_CREDIT_OFFICER"],
  CONDITIONALLY_APPROVED: ["APPROVED", "DEFERRED", "DECLINED"],
  APPROVED: ["MEMBER_ACCEPTED", "WITHDRAWN"],
  MEMBER_ACCEPTED: ["DISBURSEMENT_READY"],
  DISBURSEMENT_READY: ["DISBURSED"],
  DISBURSED: ["CLOSED", "DEFAULT_OUTCOME_RECORDED"],
  DEFERRED: ["RETURNED_FOR_INFORMATION", "ASSIGNED", "CLOSED"],
  DECLINED: ["CLOSED"], WITHDRAWN: ["CLOSED"], DEFAULT_OUTCOME_RECORDED: ["CLOSED"], CLOSED: []
} as const;
export type Status = keyof typeof WORKFLOW;
export const UNAPPROVED_TARGETS: readonly Status[] = ["WITHDRAWN", "PRELIMINARY_CHECK", "ASSIGNED", "RETURNED_FOR_INFORMATION", "CLOSED", "DEFAULT_OUTCOME_RECORDED"];
export interface WorkflowCase {
  id: string; externalMemberId: string; createdBy: string; assignedUserIds: string[];
  status: Status; revision: number; requestedAmountKobo: bigint;
  recommendationBy?: string; checkedBy?: string; approvedAmountKobo?: bigint;
  hardStops: string[]; complianceHold: boolean;
}
export interface OnlineControls {
  online: boolean; memberVerified: boolean; kycVerified: boolean; exposureVerified: boolean;
  duplicateChecked: boolean; policyCurrent: boolean; consentCurrent: boolean;
  assessmentComplete: boolean; verificationComplete: boolean;
  conditionsMet: boolean; coreDisbursementConfirmed: boolean;
  authorityLimitKobo: bigint; recommendedCeilingKobo: bigint;
}
function actionFor(from: Status, to: Status): Action {
  if (["SUBMITTED", "WITHDRAWN", "MEMBER_ACCEPTED"].includes(to)) return "CAPTURE";
  if (["APPROVED", "CONDITIONALLY_APPROVED", "DECLINED", "DEFERRED"].includes(to) || from === "PENDING_APPROVAL") return "DECIDE";
  if (from === "CHECKER_REVIEW" || to === "ASSIGNED" || to === "PRELIMINARY_CHECK") return "CHECK";
  if (["DISBURSEMENT_READY", "DISBURSED", "CLOSED", "DEFAULT_OUTCOME_RECORDED"].includes(to)) return "DISBURSE";
  if (to === "CHECKER_REVIEW") return "RECOMMEND";
  return "VERIFY";
}
export function transition(creditCase: WorkflowCase, target: Status, actor: Actor, controls: OnlineControls, change: { reason: string; expectedRevision: number; amountKobo?: bigint; correlationId: string; slaDueAt: string }, now: string) {
  assertCaseAccess(actor, creditCase);
  requireControl(controls.online, "ONLINE_ONLY");
  requireControl((WORKFLOW[creditCase.status] as readonly string[]).includes(target), "INVALID_TRANSITION");
  requireControl(!UNAPPROVED_TARGETS.includes(target), "TRANSITION_AUTHORITY_NOT_APPROVED");
  if (target === "SUBMITTED") requireControl(!actor.roles.includes("CERTIFIED_FIELD_AGENT"), "AGENT_SUBMISSION_NOT_APPROVED");
  requireControl(change.expectedRevision === creditCase.revision, "REVISION_CONFLICT");
  reason(change.reason);
  requireControl(Boolean(change.correlationId) && Number.isFinite(Date.parse(change.slaDueAt)), "TRANSITION_METADATA_REQUIRED");
  authorize(actor, actionFor(creditCase.status, target));
  const forward = !["WITHDRAWN", "DECLINED", "DEFERRED", "RETURNED_FOR_INFORMATION", "RETURNED_TO_CREDIT_OFFICER", "CLOSED", "DEFAULT_OUTCOME_RECORDED"].includes(target);
  if (forward) {
    requireControl(!creditCase.complianceHold, "COMPLIANCE_HOLD");
    requireControl(creditCase.hardStops.length === 0, "HARD_STOP");
    requireControl(controls.memberVerified && controls.kycVerified && controls.exposureVerified && controls.duplicateChecked && controls.policyCurrent && controls.consentCurrent, "ONLINE_CONTROLS_PENDING");
  }
  if (["ASSESSMENT_COMPLETED", "CHECKER_REVIEW", "PENDING_APPROVAL", "APPROVED", "CONDITIONALLY_APPROVED"].includes(target)) {
    requireControl(controls.assessmentComplete && controls.verificationComplete, "ASSESSMENT_INCOMPLETE");
  }
  if (target === "PENDING_APPROVAL") requireControl(creditCase.recommendationBy && creditCase.recommendationBy !== actor.id, "MAKER_CHECKER_REQUIRED");
  if (target === "APPROVED" || target === "CONDITIONALLY_APPROVED") {
    requireControl(creditCase.recommendationBy && creditCase.checkedBy, "CHECKER_REQUIRED");
    requireControl(actor.id !== creditCase.recommendationBy && actor.id !== creditCase.checkedBy && actor.id !== creditCase.createdBy, "SELF_APPROVAL_FORBIDDEN");
    requireControl(change.amountKobo !== undefined, "APPROVED_AMOUNT_REQUIRED");
    nonnegative(change.amountKobo);
    nonnegative(controls.authorityLimitKobo);
    nonnegative(controls.recommendedCeilingKobo);
    requireControl(change.amountKobo > 0n && change.amountKobo <= controls.authorityLimitKobo, "AUTHORITY_EXCEEDED");
    requireControl(change.amountKobo <= creditCase.requestedAmountKobo, "AMENDED_MEMBER_CONSENT_REQUIRED");
    requireControl(change.amountKobo <= controls.recommendedCeilingKobo, "EXCEPTION_WORKFLOW_REQUIRED");
    if (creditCase.status === "CONDITIONALLY_APPROVED") requireControl(controls.conditionsMet, "CONDITIONS_PENDING");
  }
  if (target === "MEMBER_ACCEPTED") requireControl(actor.roles.includes("MEMBER") && actor.externalMemberId === creditCase.externalMemberId, "MEMBER_ACCEPTANCE_REQUIRED");
  if (target === "DISBURSEMENT_READY" || target === "DISBURSED") requireControl(controls.conditionsMet, "CONDITIONS_PENDING");
  if (target === "DISBURSED") requireControl(controls.coreDisbursementConfirmed, "CORE_CONFIRMATION_REQUIRED");
  const next = { ...creditCase, status: target, revision: creditCase.revision + 1,
    ...(target === "CHECKER_REVIEW" ? { recommendationBy: actor.id } : {}),
    ...(target === "PENDING_APPROVAL" ? { checkedBy: actor.id } : {}),
    ...(["APPROVED", "CONDITIONALLY_APPROVED"].includes(target) ? { approvedAmountKobo: change.amountKobo } : {})
  };
  return { next, event: { actorId: actor.id, roles: actor.roles, action: "TRANSITION", entityId: creditCase.id, oldStatus: creditCase.status, newStatus: target, reason: change.reason, timestamp: now, correlationId: change.correlationId, assignedUserIds: creditCase.assignedUserIds, slaDueAt: change.slaDueAt } };
}
