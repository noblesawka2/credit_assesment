import type { ProductMathConfig, CashFlowInput } from "../src/domain/money.ts";
import type { Actor, Role } from "../src/domain/access.ts";
import type { OnlineControls, WorkflowCase } from "../src/domain/workflow.ts";
export const product: ProductMathConfig = {
  code: "TEST_ONLY", minimumPrincipalKobo: 100n, maximumPrincipalKobo: 100000000n,
  principalIncrementKobo: 100n, numberOfRepaymentPeriods: 16, periodsPerMonthMilli: 4330,
  spreadCycleInterestBps: 4000, spreadPercentageChargesBps: 0, spreadFixedChargesKobo: 0n,
  compulsorySavingsCycleBps: 1000, fixedPeriodicObligationKobo: 0n,
  deductedFromProceedsBps: 300, deductedFromProceedsFixedKobo: 50000n
};
export const cashFlow: CashFlowInput = {
  verifiedMonthlySalesKobo: 100000000n, verifiedMonthlyCogsKobo: 60000000n,
  verifiedMonthlyOperatingExpensesKobo: 5000000n, verifiedOtherStableIncomeKobo: 10000000n,
  verifiedHouseholdOutflowKobo: 10000000n, mandatoryNonDebtCommitmentsKobo: 2000000n,
  existingMonthlyDebtServiceKobo: 5000000n, minimumTotalDscrMilli: 1250,
  salesStressBps: 1000, otherIncomeStressBps: 2000
};
export function actor(role: Role, id = "actor"): Actor { return { id, roles: [role], active: true, capabilities: [] }; }
export const creditCase: WorkflowCase = {
  id: "case", externalMemberId: "external-1", createdBy: "maker", assignedUserIds: ["maker", "checker", "approver", "officer"],
  status: "PENDING_APPROVAL", revision: 3, requestedAmountKobo: 30000000n,
  recommendationBy: "maker", checkedBy: "checker", hardStops: [], complianceHold: false
};
export const controls: OnlineControls = {
  online: true, memberVerified: true, kycVerified: true, exposureVerified: true,
  duplicateChecked: true, policyCurrent: true, consentCurrent: true,
  assessmentComplete: true, verificationComplete: true, conditionsMet: true,
  coreDisbursementConfirmed: true, authorityLimitKobo: 30000000n, recommendedCeilingKobo: 18000000n
};
export const change = { reason: "Evidence reviewed and confirmed", expectedRevision: 3, amountKobo: 18000000n, correlationId: "request", slaDueAt: "2026-09-09T10:00:00Z" };
export const now = "2026-09-08T10:00:00Z";
