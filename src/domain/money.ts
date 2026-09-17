
import { integer, nonnegative, requireControl } from "./validation.ts";

export type Kobo = bigint;
export type BasisPoints = number;

const BPS = 10_000n;
const ZERO = 0n;

export const max0 = (value: bigint): bigint => (value < ZERO ? ZERO : value);
export const minMoney = (...values: bigint[]): bigint => values.reduce((left, right) => (left < right ? left : right));

export function mulBpsDown(amount: Kobo, rateBps: BasisPoints): Kobo {
  nonnegative(amount);
  integer(rateBps, 0, 1000000);
  return (amount * BigInt(rateBps)) / BPS;
}

export function divRatioDown(amount: Kobo, ratioMilli: number): Kobo {
  nonnegative(amount);
  integer(ratioMilli, 1, 1000000);
  if (ratioMilli <= 0) throw new Error("ratioMilli must be positive");
  return (amount * 1_000n) / BigInt(ratioMilli);
}

export function roundDownTo(amount: Kobo, increment: Kobo): Kobo {
  nonnegative(amount);
  if (increment <= ZERO) throw new Error("increment must be positive");
  return (amount / increment) * increment;
}

export function roundUpTo(amount: Kobo, increment: Kobo): Kobo {
  nonnegative(amount);
  if (increment <= ZERO) throw new Error("increment must be positive");
  return ((amount + increment - 1n) / increment) * increment;
}

export type Frequency =
  | "DAILY"
  | "WEEKLY"
  | "FORTNIGHTLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "TERMLY"
  | "ANNUAL";

export function normalizeToMonthly(
  amount: Kobo,
  frequency: Frequency,
  operatingDaysPerWeek = 0,
): Kobo {
  nonnegative(amount);
  switch (frequency) {
    case "DAILY":
      integer(operatingDaysPerWeek, 1, 7);
      if (operatingDaysPerWeek < 1 || operatingDaysPerWeek > 7) {
        throw new Error("operatingDaysPerWeek must be between 1 and 7");
      }
      return (amount * BigInt(operatingDaysPerWeek) * 433n) / 100n;
    case "WEEKLY":
      return (amount * 433n) / 100n;
    case "FORTNIGHTLY":
      return (amount * 2165n) / 1000n;
    case "MONTHLY":
      return amount;
    case "QUARTERLY":
      return amount / 3n;
    case "TERMLY":
      return (amount * 3n) / 12n; 
    case "ANNUAL":
      return amount / 12n;
    default:
      throw new Error("unsupported frequency");
  }
}

export interface CashFlowInput {
  verifiedMonthlySalesKobo: Kobo;
  verifiedMonthlyCogsKobo: Kobo;
  verifiedMonthlyOperatingExpensesKobo: Kobo;
  verifiedOtherStableIncomeKobo: Kobo;
  verifiedHouseholdOutflowKobo: Kobo;
  mandatoryNonDebtCommitmentsKobo: Kobo;
  existingMonthlyDebtServiceKobo: Kobo;
  minimumTotalDscrMilli: number;       
  maximumTotalDebtServiceRatioBps?: BasisPoints;
  salesStressBps: BasisPoints;         
  otherIncomeStressBps: BasisPoints;   
}

export interface CashFlowResult {
  grossProfitKobo: Kobo;
  grossMarginBps: number;
  netBusinessIncomeKobo: Kobo;
  verifiedTotalNetIncomeKobo: Kobo;
  cashAvailableForAllDebtKobo: Kobo;
  capacityByDscrKobo: Kobo;
  capacityByIncomeRatioKobo: Kobo | null;
  stressedSalesKobo: Kobo;
  stressedGrossProfitKobo: Kobo;
  stressedCashAvailableKobo: Kobo;
  stressedCapacityByDscrKobo: Kobo;
  finalMonthlyNewLoanCapacityKobo: Kobo;
}

export function calculateCashFlow(input: CashFlowInput): CashFlowResult {
  integer(input.minimumTotalDscrMilli, 1, 1000000);
  integer(input.salesStressBps, 0, 10000);
  integer(input.otherIncomeStressBps, 0, 10000);
  if (input.maximumTotalDebtServiceRatioBps !== undefined) integer(input.maximumTotalDebtServiceRatioBps, 0, 10000);
  const values = [
    input.verifiedMonthlySalesKobo,
    input.verifiedMonthlyCogsKobo,
    input.verifiedMonthlyOperatingExpensesKobo,
    input.verifiedOtherStableIncomeKobo,
    input.verifiedHouseholdOutflowKobo,
    input.mandatoryNonDebtCommitmentsKobo,
    input.existingMonthlyDebtServiceKobo,
  ];
  values.forEach(nonnegative);

  const grossProfitKobo = input.verifiedMonthlySalesKobo - input.verifiedMonthlyCogsKobo;
  const grossMarginBps = input.verifiedMonthlySalesKobo === ZERO
    ? 0
    : Number((grossProfitKobo * BPS) / input.verifiedMonthlySalesKobo);
  const netBusinessIncomeKobo = grossProfitKobo - input.verifiedMonthlyOperatingExpensesKobo;
  const verifiedTotalNetIncomeKobo = netBusinessIncomeKobo + input.verifiedOtherStableIncomeKobo;
  const cashAvailableForAllDebtKobo =
    verifiedTotalNetIncomeKobo
    - input.verifiedHouseholdOutflowKobo
    - input.mandatoryNonDebtCommitmentsKobo;

  const capacityByDscrKobo = max0(
    divRatioDown(max0(cashAvailableForAllDebtKobo), input.minimumTotalDscrMilli)
    - input.existingMonthlyDebtServiceKobo,
  );

  const capacityByIncomeRatioKobo = input.maximumTotalDebtServiceRatioBps == null
    ? null
    : max0(
        mulBpsDown(max0(verifiedTotalNetIncomeKobo), input.maximumTotalDebtServiceRatioBps)
        - input.existingMonthlyDebtServiceKobo,
      );

  const stressedSalesKobo =
    input.verifiedMonthlySalesKobo - mulBpsDown(input.verifiedMonthlySalesKobo, input.salesStressBps);
  
  const stressedCogsKobo =
    input.verifiedMonthlyCogsKobo - mulBpsDown(input.verifiedMonthlyCogsKobo, input.salesStressBps);
  const stressedGrossProfitKobo = stressedSalesKobo - stressedCogsKobo;
  const stressedOtherIncomeKobo =
    input.verifiedOtherStableIncomeKobo
    - mulBpsDown(input.verifiedOtherStableIncomeKobo, input.otherIncomeStressBps);
  const stressedCashAvailableKobo =
    stressedGrossProfitKobo
    - input.verifiedMonthlyOperatingExpensesKobo
    + stressedOtherIncomeKobo
    - input.verifiedHouseholdOutflowKobo
    - input.mandatoryNonDebtCommitmentsKobo;
  const stressedCapacityByDscrKobo = max0(
    divRatioDown(max0(stressedCashAvailableKobo), input.minimumTotalDscrMilli)
    - input.existingMonthlyDebtServiceKobo,
  );

  const capacityCandidates = [capacityByDscrKobo, stressedCapacityByDscrKobo];
  if (capacityByIncomeRatioKobo != null) capacityCandidates.push(capacityByIncomeRatioKobo);

  return {
    grossProfitKobo,
    grossMarginBps,
    netBusinessIncomeKobo,
    verifiedTotalNetIncomeKobo,
    cashAvailableForAllDebtKobo,
    capacityByDscrKobo,
    capacityByIncomeRatioKobo,
    stressedSalesKobo,
    stressedGrossProfitKobo,
    stressedCashAvailableKobo,
    stressedCapacityByDscrKobo,
    finalMonthlyNewLoanCapacityKobo: minMoney(...capacityCandidates),
  };
}

export interface ProductMathConfig {
  code: string;
  minimumPrincipalKobo: Kobo;
  maximumPrincipalKobo: Kobo;
  principalIncrementKobo: Kobo;
  numberOfRepaymentPeriods: number;
  periodsPerMonthMilli: number;          
  spreadCycleInterestBps: BasisPoints;
  spreadPercentageChargesBps: BasisPoints;
  spreadFixedChargesKobo: Kobo;
  compulsorySavingsCycleBps: BasisPoints;
  fixedPeriodicObligationKobo: Kobo;
  deductedFromProceedsBps: BasisPoints;
  deductedFromProceedsFixedKobo: Kobo;
}

export function monthlyCapacityToPeriod(
  monthlyCapacityKobo: Kobo,
  periodsPerMonthMilli: number,
): Kobo {
  nonnegative(monthlyCapacityKobo);
  integer(periodsPerMonthMilli, 1, 31000);
  if (periodsPerMonthMilli <= 0) throw new Error("periodsPerMonthMilli must be positive");
  return (monthlyCapacityKobo * 1_000n) / BigInt(periodsPerMonthMilli);
}

export function scheduledCollectionPerPeriod(
  principalKobo: Kobo,
  product: ProductMathConfig,
): Kobo {
  nonnegative(principalKobo);
  integer(product.numberOfRepaymentPeriods, 1, 1200);
  const percentageCycleAmount = mulBpsDown(
    principalKobo,
    product.spreadCycleInterestBps
      + product.spreadPercentageChargesBps
      + product.compulsorySavingsCycleBps,
  );
  const cycleCollection =
    principalKobo + percentageCycleAmount + product.spreadFixedChargesKobo;
  return cycleCollection / BigInt(product.numberOfRepaymentPeriods)
    + product.fixedPeriodicObligationKobo;
}

export function netUsableProceeds(
  principalKobo: Kobo,
  product: ProductMathConfig,
): Kobo {
  nonnegative(principalKobo);
  nonnegative(product.deductedFromProceedsFixedKobo);
  integer(product.deductedFromProceedsBps, 0, 9999);
  return max0(
    principalKobo
    - mulBpsDown(principalKobo, product.deductedFromProceedsBps)
    - product.deductedFromProceedsFixedKobo,
  );
}

export function grossPrincipalRequiredForNeed(
  demonstratedNetNeedKobo: Kobo,
  product: ProductMathConfig,
): Kobo {
  nonnegative(demonstratedNetNeedKobo);
  nonnegative(product.deductedFromProceedsFixedKobo);
  integer(product.deductedFromProceedsBps, 0, 9999);
  requireControl(product.principalIncrementKobo > 0n, "INVALID_PRINCIPAL_INCREMENT");
  if (demonstratedNetNeedKobo === ZERO) return ZERO;
  const denominator = 10_000 - product.deductedFromProceedsBps;
  if (denominator <= 0) throw new Error("invalid deductions: 100% or more");
  const numerator =
    (demonstratedNetNeedKobo + product.deductedFromProceedsFixedKobo) * 10_000n;
  const raw = (numerator + BigInt(denominator) - 1n) / BigInt(denominator);
  return roundUpTo(raw, product.principalIncrementKobo);
}

export function repaymentSupportedPrincipal(
  affordablePeriodicCollectionKobo: Kobo,
  product: ProductMathConfig,
): Kobo {
  nonnegative(affordablePeriodicCollectionKobo);
  nonnegative(product.fixedPeriodicObligationKobo);
  nonnegative(product.spreadFixedChargesKobo);
  integer(product.numberOfRepaymentPeriods, 1, 1200);
  integer(product.spreadCycleInterestBps, 0, 100000);
  integer(product.spreadPercentageChargesBps, 0, 100000);
  integer(product.compulsorySavingsCycleBps, 0, 100000);
  requireControl(product.principalIncrementKobo > 0n, "INVALID_PRINCIPAL_INCREMENT");
  const availableAfterFixed =
    affordablePeriodicCollectionKobo - product.fixedPeriodicObligationKobo;
  if (availableAfterFixed <= ZERO) return ZERO;

  const numerator =
    availableAfterFixed * BigInt(product.numberOfRepaymentPeriods)
    - product.spreadFixedChargesKobo;
  if (numerator <= ZERO) return ZERO;

  const denominatorBps =
    10_000
    + product.spreadCycleInterestBps
    + product.spreadPercentageChargesBps
    + product.compulsorySavingsCycleBps;
  const raw = (numerator * 10_000n) / BigInt(denominatorBps);
  return roundDownTo(raw, product.principalIncrementKobo);
}

export interface CeilingInput {
  requestedAmountKobo: Kobo;
  grossPrincipalRequiredForNeedKobo: Kobo;
  repaymentSupportedAmountKobo: Kobo;
  productLimitKobo: Kobo;
  memberOrCycleLimitKobo: Kobo;
  remainingExposureLimitKobo: Kobo;
  securityOrGuaranteeLimitKobo?: Kobo;
}

export function systemRecommendedCeiling(input: CeilingInput): Kobo {
  const candidates = [
    input.requestedAmountKobo,
    input.grossPrincipalRequiredForNeedKobo,
    input.repaymentSupportedAmountKobo,
    input.productLimitKobo,
    input.memberOrCycleLimitKobo,
    input.remainingExposureLimitKobo,
  ];
  if (input.securityOrGuaranteeLimitKobo != null) {
    candidates.push(input.securityOrGuaranteeLimitKobo);
  }
  candidates.forEach(nonnegative);
  return minMoney(...candidates);
}

export function calculateDscrMilli(
  cashAvailableForAllDebtKobo: Kobo,
  existingMonthlyDebtServiceKobo: Kobo,
  newMonthlyDebtServiceKobo: Kobo,
): number | null {
  nonnegative(existingMonthlyDebtServiceKobo);
  nonnegative(newMonthlyDebtServiceKobo);
  const totalDebt = existingMonthlyDebtServiceKobo + newMonthlyDebtServiceKobo;
  if (totalDebt <= ZERO) return null;
  return Number((max0(cashAvailableForAllDebtKobo) * 1_000n) / totalDebt);
}
