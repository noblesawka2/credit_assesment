import * as math from "./money.ts";
import { integer, nonnegative, requireControl } from "./validation.ts";
export const ENGINE_VERSION = "0.1.0";
export const PRELIMINARY_NOTICE = "Preliminary - pending online member, KYC, exposure, policy and server verification. This is not a loan approval or promise.";

export function validateProduct(product: math.ProductMathConfig): void {
  requireControl(typeof product.code === "string" && product.code.length > 0, "PRODUCT_CODE_REQUIRED");
  for (const key of ["minimumPrincipalKobo", "maximumPrincipalKobo", "principalIncrementKobo", "spreadFixedChargesKobo", "fixedPeriodicObligationKobo", "deductedFromProceedsFixedKobo"] as const) nonnegative(product[key]);
  requireControl(product.principalIncrementKobo > 0n && product.minimumPrincipalKobo > 0n && product.maximumPrincipalKobo >= product.minimumPrincipalKobo, "INVALID_PRODUCT_LIMITS");
  integer(product.numberOfRepaymentPeriods, 1, 1200);
  integer(product.periodsPerMonthMilli, 1, 31000);
  for (const key of ["spreadCycleInterestBps", "spreadPercentageChargesBps", "compulsorySavingsCycleBps"] as const) integer(product[key], 0, 100000);
  integer(product.deductedFromProceedsBps, 0, 9999);
}
export function validateCashFlow(input: math.CashFlowInput): void {
  for (const key of ["verifiedMonthlySalesKobo", "verifiedMonthlyCogsKobo", "verifiedMonthlyOperatingExpensesKobo", "verifiedOtherStableIncomeKobo", "verifiedHouseholdOutflowKobo", "mandatoryNonDebtCommitmentsKobo", "existingMonthlyDebtServiceKobo"] as const) nonnegative(input[key]);
  integer(input.minimumTotalDscrMilli, 1, 100000);
  integer(input.salesStressBps, 0, 10000);
  integer(input.otherIncomeStressBps, 0, 10000);
  if (input.maximumTotalDebtServiceRatioBps != null) integer(input.maximumTotalDebtServiceRatioBps, 0, 10000);
}
export function demonstratedNeed(lines: { eligible: boolean | null; verifiedTotalKobo: bigint | null }[], contribution: bigint, funding: bigint) {
  nonnegative(contribution);
  nonnegative(funding);
  let eligibleCosts = 0n;
  for (const line of lines) {
    if (line.eligible === true) {
      requireControl(line.verifiedTotalKobo !== null, "ELIGIBLE_LINE_UNVERIFIED");
      nonnegative(line.verifiedTotalKobo);
      eligibleCosts += line.verifiedTotalKobo;
    }
  }
  return { verifiedEligibleUseOfFundsKobo: eligibleCosts, demonstratedNetNeedKobo: math.max0(eligibleCosts - contribution - funding) };
}
export function repaymentSchedule(principal: bigint, product: math.ProductMathConfig) {
  validateProduct(product);
  nonnegative(principal);
  const cycle = principal + math.mulBpsDown(principal, product.spreadCycleInterestBps + product.spreadPercentageChargesBps + product.compulsorySavingsCycleBps) + product.spreadFixedChargesKobo;
  const periods = BigInt(product.numberOfRepaymentPeriods);
  const base = cycle / periods;
  const remainder = cycle % periods;
  return Array.from({ length: product.numberOfRepaymentPeriods }, (_, index) => ({
    period: index + 1,
    collectionKobo: base + (BigInt(index) < remainder ? 1n : 0n) + product.fixedPeriodicObligationKobo
  }));
}
export function diagnostic(input: {
  cashFlow: math.CashFlowInput;
  product: math.ProductMathConfig;
  requestedAmountKobo: bigint;
  demonstratedNetNeedKobo: bigint;
  memberOrCycleLimitKobo: bigint;
  remainingExposureLimitKobo: bigint;
  securityOrGuaranteeLimitKobo?: bigint;
  officerRecommendedAmountKobo?: bigint;
  approvedAmountKobo?: bigint;
}) {
  validateCashFlow(input.cashFlow);
  validateProduct(input.product);
  for (const key of ["requestedAmountKobo", "demonstratedNetNeedKobo", "memberOrCycleLimitKobo", "remainingExposureLimitKobo", "securityOrGuaranteeLimitKobo", "officerRecommendedAmountKobo", "approvedAmountKobo"] as const) if (input[key] !== undefined) nonnegative(input[key]);
  const cashFlow = math.calculateCashFlow(input.cashFlow);
  const periodicCapacity = math.monthlyCapacityToPeriod(cashFlow.finalMonthlyNewLoanCapacityKobo, input.product.periodsPerMonthMilli);
  const supported = math.repaymentSupportedPrincipal(periodicCapacity, input.product);
  const grossNeed = input.demonstratedNetNeedKobo === 0n ? 0n : math.grossPrincipalRequiredForNeed(input.demonstratedNetNeedKobo, input.product);
  const limits = {
    REQUESTED: input.requestedAmountKobo, DEMONSTRATED_NEED: grossNeed, CAPACITY: supported,
    PRODUCT: input.product.maximumPrincipalKobo, MEMBER_CYCLE: input.memberOrCycleLimitKobo,
    EXPOSURE: input.remainingExposureLimitKobo,
    ...(input.securityOrGuaranteeLimitKobo !== undefined ? { SECURITY: input.securityOrGuaranteeLimitKobo } : {})
  };
  const ceiling = math.roundDownTo(math.minMoney(...Object.values(limits)), input.product.principalIncrementKobo);
  const amounts = { REQUESTED: input.requestedAmountKobo, SUPPORTED: supported, OFFICER_RECOMMENDED: input.officerRecommendedAmountKobo, APPROVED: input.approvedAmountKobo };
  const simulations = Object.entries(amounts).filter((entry): entry is [string, bigint] => entry[1] !== undefined).map(([stage, principal]) => {
    const schedule = repaymentSchedule(principal, input.product);
    const peakCollection = schedule.reduce((peak, item) => item.collectionKobo > peak ? item.collectionKobo : peak, 0n);
    const monthly = (peakCollection * BigInt(input.product.periodsPerMonthMilli) + 999n) / 1000n;
    return {
      stage, principalKobo: principal, schedule, monthlyDebtServiceKobo: monthly,
      netUsableProceedsKobo: math.netUsableProceeds(principal, input.product),
      totalCollectionKobo: schedule.reduce((total, item) => total + item.collectionKobo, 0n),
      baseDscrMilli: math.calculateDscrMilli(cashFlow.cashAvailableForAllDebtKobo, input.cashFlow.existingMonthlyDebtServiceKobo, monthly),
      stressedDscrMilli: math.calculateDscrMilli(cashFlow.stressedCashAvailableKobo, input.cashFlow.existingMonthlyDebtServiceKobo, monthly)
    };
  });
  const hardStops = [];
  if (cashFlow.finalMonthlyNewLoanCapacityKobo <= 0n) hardStops.push("NEGATIVE_REPAYMENT_CAPACITY");
  if (ceiling < input.product.minimumPrincipalKobo) hardStops.push("SUPPORTED_AMOUNT_BELOW_PRODUCT_MINIMUM");
  return {
    calculationEngineVersion: ENGINE_VERSION, cashFlow,
    requestedAmountKobo: input.requestedAmountKobo, demonstratedNetNeedKobo: input.demonstratedNetNeedKobo,
    grossPrincipalRequiredForNeedKobo: grossNeed, repaymentSupportedAmountKobo: supported,
    systemRecommendedCeilingKobo: ceiling,
    limitingFactorCodes: Object.entries(limits).filter(([, value]) => value === math.minMoney(...Object.values(limits))).map(([key]) => key),
    simulations, hardStops,
    warningFlags: [
      ...(cashFlow.grossProfitKobo < 0n ? ["NEGATIVE_GROSS_MARGIN"] : []),
      ...(input.requestedAmountKobo > grossNeed ? ["REQUEST_EXCEEDS_DEMONSTRATED_NEED"] : []),
      ...(input.requestedAmountKobo > supported ? ["REQUEST_EXCEEDS_REPAYMENT_CAPACITY"] : [])
    ]
  };
}
export function varianceBps(reported: bigint, verified: bigint): number | null {
  nonnegative(reported); nonnegative(verified);
  if (reported === 0n) return verified === 0n ? 0 : null;
  const delta = verified > reported ? verified - reported : reported - verified;
  return Number(delta * 10000n / reported);
}
