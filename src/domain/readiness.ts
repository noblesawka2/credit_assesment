import { diagnostic, validateCashFlow, validateProduct } from "./diagnostic.ts";
import { calculateScore, FACTORS, type Factor, type ScoreModel } from "./score.ts";
import { money, requireControl } from "./validation.ts";
import type { CashFlowInput, ProductMathConfig } from "./money.ts";

export const READINESS_MONEY_FIELDS = [
  "monthlySalesKobo","monthlyCostOfGoodsKobo","monthlyOperatingExpensesKobo","otherStableIncomeKobo",
  "householdOutflowKobo","mandatoryCommitmentsKobo","existingMonthlyDebtServiceKobo",
  "netFundingNeedKobo","outstandingExposureKobo"
] as const;
export interface ReadinessPolicy {
  product: ProductMathConfig;
  model: ScoreModel;
  minimumTotalDscrMilli: number;
  salesStressBps: number;
  otherIncomeStressBps: number;
  maximumTotalDebtServiceRatioBps?: number;
  memberOrCycleLimitKobo: bigint;
  maximumExposureKobo: bigint;
}
export function readinessAssessment(body: Record<string, unknown>, requestedAmount: string, policy: ReadinessPolicy, now: string) {
  requireControl(body.facts !== null && typeof body.facts === "object" && !Array.isArray(body.facts), "READINESS_FACTS_REQUIRED");
  const supplied = body.facts as Record<string, unknown>;
  const facts = Object.fromEntries(READINESS_MONEY_FIELDS.map(field => [field, money(supplied[field])])) as Record<typeof READINESS_MONEY_FIELDS[number], bigint>;
  requireControl(body.scoreInputs !== null && typeof body.scoreInputs === "object" && !Array.isArray(body.scoreInputs), "SCORE_INPUT_MISSING");
  const raw = body.scoreInputs as Record<string, unknown>;
  const scoreInputs = Object.fromEntries(Object.keys(FACTORS).map(factor => {
    const value = raw[factor];
    requireControl(typeof value === "string" && value.length <= 200 || typeof value === "number" && Number.isFinite(value) || value === null, "INVALID_SCORE_INPUT");
    return [factor, value];
  })) as Record<Factor, number | string | null>;
  requireControl(typeof body.newToCredit === "boolean", "CREDIT_HISTORY_STATUS_REQUIRED");
  const cashFlow: CashFlowInput = {
    verifiedMonthlySalesKobo: facts.monthlySalesKobo, verifiedMonthlyCogsKobo: facts.monthlyCostOfGoodsKobo,
    verifiedMonthlyOperatingExpensesKobo: facts.monthlyOperatingExpensesKobo, verifiedOtherStableIncomeKobo: facts.otherStableIncomeKobo,
    verifiedHouseholdOutflowKobo: facts.householdOutflowKobo, mandatoryNonDebtCommitmentsKobo: facts.mandatoryCommitmentsKobo,
    existingMonthlyDebtServiceKobo: facts.existingMonthlyDebtServiceKobo, minimumTotalDscrMilli: policy.minimumTotalDscrMilli,
    salesStressBps: policy.salesStressBps, otherIncomeStressBps: policy.otherIncomeStressBps,
    maximumTotalDebtServiceRatioBps: policy.maximumTotalDebtServiceRatioBps
  };
  validateCashFlow(cashFlow); validateProduct(policy.product);
  const headroom = policy.maximumExposureKobo > facts.outstandingExposureKobo ? policy.maximumExposureKobo - facts.outstandingExposureKobo : 0n;
  const calculation = diagnostic({ cashFlow, product: policy.product, requestedAmountKobo: money(requestedAmount),
    demonstratedNetNeedKobo: facts.netFundingNeedKobo, memberOrCycleLimitKobo: policy.memberOrCycleLimitKobo, remainingExposureLimitKobo: headroom });
  const score = calculateScore(scoreInputs, policy.model, body.newToCredit, now);
  const hardStops = [...calculation.hardStops, ...(score.total < 60 ? ["READINESS_SCORE_BELOW_REVIEW_BAND"] : [])];
  return {
    status: hardStops.length ? "NOT_READY" : score.total < 70 ? "MANUAL_REVIEW" : "READY_FOR_REVIEW",
    readinessPercentage: score.total, estimatedEligibleAmountKobo: hardStops.length ? "0" : calculation.systemRecommendedCeilingKobo.toString(),
    percentageMeaning: "Policy-based readiness score out of 100; not a probability of repayment or loan approval.",
    inputBasis: "OFFICER_REPORTED_UNVERIFIED",
    inputSnapshot: { facts: Object.fromEntries(Object.entries(facts).map(([name,value]) => [name,value.toString()])), scoreInputs, newToCredit: body.newToCredit, requestedAmountKobo: requestedAmount },
    notice: "Preliminary estimate only. Independent verification, eligibility checks, current exposure and authorized review are required. No loan is approved.",
    reasons: [...hardStops, ...calculation.warningFlags, ...calculation.limitingFactorCodes.map(code => "AMOUNT_LIMITED_BY_" + code)],
    score, calculation
  };
}
