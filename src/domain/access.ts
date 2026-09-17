import { requireControl } from "./validation.ts";
export const ROLES = ["MEMBER", "ASSISTED_INTAKE", "CERTIFIED_FIELD_AGENT", "CREDIT_OFFICER", "OPERATIONS_CHECKER", "COMPLIANCE_CONTROL", "CREDIT_APPROVER", "FINANCE_DISBURSEMENT", "DIGITAL_SYSTEMS_SUPPORT", "POLICY_ADMIN_MAKER", "POLICY_ADMIN_CHECKER"] as const;
export type Role = typeof ROLES[number];
export interface Actor {
  id: string;
  roles: Role[];
  active: boolean;
  externalMemberId?: string;
  capabilities: string[];
  certifiedAgentLevel?: number;
}
export type Action = "CAPTURE" | "VERIFY" | "RECOMMEND" | "CHECK" | "DECIDE" | "COMPLIANCE" | "DISBURSE" | "POLICY_DRAFT" | "POLICY_PUBLISH" | "INTERNAL_VIEW" | "REPORT";
const permissions: Record<Action, readonly Role[]> = {
  CAPTURE: ["MEMBER", "ASSISTED_INTAKE", "CERTIFIED_FIELD_AGENT", "CREDIT_OFFICER"],
  VERIFY: ["CREDIT_OFFICER"], RECOMMEND: ["CREDIT_OFFICER"],
  CHECK: ["OPERATIONS_CHECKER"], DECIDE: ["CREDIT_APPROVER"],
  COMPLIANCE: ["COMPLIANCE_CONTROL"], DISBURSE: ["FINANCE_DISBURSEMENT"],
  POLICY_DRAFT: ["POLICY_ADMIN_MAKER"], POLICY_PUBLISH: ["POLICY_ADMIN_CHECKER"],
  INTERNAL_VIEW: ["CREDIT_OFFICER", "OPERATIONS_CHECKER", "COMPLIANCE_CONTROL", "CREDIT_APPROVER"],
  REPORT: ["COMPLIANCE_CONTROL"]
};
export function authorize(actor: Actor, action: Action) {
  requireControl(actor.active && actor.roles.some(role => permissions[action].includes(role)), "FORBIDDEN");
  if (actor.roles.includes("MEMBER")) requireControl(action === "CAPTURE", "MEMBER_ROLE_CONFLICT");
}
export function assertCaseAccess(actor: Actor, creditCase: { externalMemberId: string; assignedUserIds: string[]; createdBy: string }) {
  requireControl(actor.active, "FORBIDDEN");
  if (actor.roles.includes("MEMBER")) {
    requireControl(actor.externalMemberId === creditCase.externalMemberId, "FORBIDDEN");
    return;
  }
  requireControl(!actor.roles.includes("DIGITAL_SYSTEMS_SUPPORT"), "FORBIDDEN");
  requireControl(actor.roles.includes("COMPLIANCE_CONTROL") || creditCase.assignedUserIds.includes(actor.id), "FORBIDDEN");
}
export function memberView(creditCase: { id: string; reference: string | null; status: string; reported: unknown; requestedAmountKobo: string }) {
  return { id: creditCase.id, reference: creditCase.reference, status: creditCase.status, reported: creditCase.reported, requestedAmountKobo: creditCase.requestedAmountKobo };
}
