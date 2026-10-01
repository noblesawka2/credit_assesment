import { integer, money, requireControl } from './validation.ts';

export const PUBLIC_READINESS_FIELDS = [
  'productCode',
  'purposeCode',
  'incomeType',
  'monthlyIncomeKobo',
  'monthlyBusinessCostsKobo',
  'monthlyHouseholdExpensesKobo',
  'monthlyOtherCommitmentsKobo',
  'monthlyExistingRepaymentsKobo',
  'requestedAmountKobo'
] as const;

const METRICS = ['DISPOSABLE_INCOME_RATIO_BPS', 'EXISTING_DEBT_RATIO_BPS', 'REQUESTED_TO_ANNUAL_INCOME_BPS'] as const;
const OUTCOMES = ['STRONG', 'ATTENTION', 'BLOCKER'] as const;
type Metric = typeof METRICS[number];
type Outcome = typeof OUTCOMES[number];

interface PublicRule {
  metric: Metric;
  minimumInclusive?: number;
  maximumExclusive?: number;
  points: number;
  outcome: Outcome;
}

export interface PublicReadinessPolicy {
  maximumPoints: number;
  maximumMonthlyAmountKobo: bigint;
  maximumRequestedAmountKobo: bigint;
  readyMinimumPercentage: number;
  reviewMinimumPercentage: number;
  purposeCodes: string[];
  rules: PublicRule[];
}

export interface PublicReadinessInput {
  productCode: string;
  purposeCode: string;
  incomeType: 'SALARY' | 'BUSINESS' | 'MIXED' | 'OTHER';
  monthlyIncomeKobo: bigint;
  monthlyBusinessCostsKobo: bigint;
  monthlyHouseholdExpensesKobo: bigint;
  monthlyOtherCommitmentsKobo: bigint;
  monthlyExistingRepaymentsKobo: bigint;
  requestedAmountKobo: bigint;
}

function enumValue<T extends string>(value: unknown, choices: readonly T[], code: string): T {
  requireControl(typeof value === 'string' && choices.includes(value as T), code);
  return value as T;
}

function policyInteger(value: unknown, minimum: number, maximum: number) {
  integer(value, minimum, maximum);
  return value;
}

export function publicReadinessPolicy(scorePayload: unknown, eligibilityPayload: unknown): PublicReadinessPolicy {
  requireControl(scorePayload !== null && typeof scorePayload === 'object' && !Array.isArray(scorePayload), 'PUBLIC_READINESS_POLICY_REQUIRED');
  requireControl(eligibilityPayload !== null && typeof eligibilityPayload === 'object' && !Array.isArray(eligibilityPayload), 'PUBLIC_READINESS_POLICY_REQUIRED');
  const score = (scorePayload as Record<string, unknown>).publicSelfCheck;
  const eligibility = (eligibilityPayload as Record<string, unknown>).publicSelfCheck;
  requireControl(score !== null && typeof score === 'object' && !Array.isArray(score), 'PUBLIC_READINESS_POLICY_REQUIRED');
  requireControl(eligibility !== null && typeof eligibility === 'object' && !Array.isArray(eligibility), 'PUBLIC_READINESS_POLICY_REQUIRED');
  const scoreConfig = score as Record<string, unknown>;
  const eligibilityConfig = eligibility as Record<string, unknown>;
  requireControl(scoreConfig.contract === 'PUBLIC_SCORE_V1' && eligibilityConfig.contract === 'PUBLIC_READINESS_V1', 'PUBLIC_READINESS_POLICY_REQUIRED');
  const maximumPoints = policyInteger(scoreConfig.maximumPoints, 1, 1000000);
  requireControl(Array.isArray(scoreConfig.rules) && scoreConfig.rules.length > 0 && scoreConfig.rules.length <= 100, 'PUBLIC_READINESS_POLICY_REQUIRED');
  const rules = scoreConfig.rules.map(value => {
    requireControl(value !== null && typeof value === 'object' && !Array.isArray(value), 'PUBLIC_READINESS_POLICY_REQUIRED');
    const rule = value as Record<string, unknown>;
    const minimumInclusive = rule.minimumInclusive === undefined ? undefined : policyInteger(rule.minimumInclusive, -1000000000, 1000000000);
    const maximumExclusive = rule.maximumExclusive === undefined ? undefined : policyInteger(rule.maximumExclusive, -1000000000, 1000000000);
    requireControl(minimumInclusive !== undefined || maximumExclusive !== undefined, 'PUBLIC_READINESS_POLICY_REQUIRED');
    if (minimumInclusive !== undefined && maximumExclusive !== undefined) requireControl(minimumInclusive < maximumExclusive, 'PUBLIC_READINESS_POLICY_REQUIRED');
    return {
      metric: enumValue(rule.metric, METRICS, 'PUBLIC_READINESS_POLICY_REQUIRED'),
      minimumInclusive,
      maximumExclusive,
      points: policyInteger(rule.points, 0, maximumPoints),
      outcome: enumValue(rule.outcome, OUTCOMES, 'PUBLIC_READINESS_POLICY_REQUIRED')
    };
  });
  requireControl(METRICS.every(metric => rules.some(rule => rule.metric === metric)), 'PUBLIC_READINESS_POLICY_REQUIRED');
  requireControl(Array.isArray(eligibilityConfig.purposeCodes) && eligibilityConfig.purposeCodes.length > 0 && eligibilityConfig.purposeCodes.length <= 100, 'PUBLIC_READINESS_POLICY_REQUIRED');
  const purposeCodes = eligibilityConfig.purposeCodes.map(value => {
    requireControl(typeof value === 'string' && /^[A-Z0-9_-]{1,50}$/.test(value), 'PUBLIC_READINESS_POLICY_REQUIRED');
    return value;
  });
  const readyMinimumPercentage = policyInteger(eligibilityConfig.readyMinimumPercentage, 0, 100);
  const reviewMinimumPercentage = policyInteger(eligibilityConfig.reviewMinimumPercentage, 0, 100);
  requireControl(reviewMinimumPercentage <= readyMinimumPercentage, 'PUBLIC_READINESS_POLICY_REQUIRED');
  return {
    maximumPoints,
    maximumMonthlyAmountKobo: money(eligibilityConfig.maximumMonthlyAmountKobo),
    maximumRequestedAmountKobo: money(eligibilityConfig.maximumRequestedAmountKobo),
    readyMinimumPercentage,
    reviewMinimumPercentage,
    purposeCodes,
    rules
  };
}

export function parsePublicReadinessInput(body: Record<string, unknown>, policy: PublicReadinessPolicy): PublicReadinessInput {
  const keys = Object.keys(body);
  requireControl(keys.length === PUBLIC_READINESS_FIELDS.length && keys.every(key => (PUBLIC_READINESS_FIELDS as readonly string[]).includes(key)), 'INVALID_PUBLIC_READINESS_INPUT');
  requireControl(typeof body.productCode === 'string' && /^[A-Z0-9_-]{1,50}$/.test(body.productCode), 'INVALID_PRODUCT_CODE');
  requireControl(typeof body.purposeCode === 'string' && policy.purposeCodes.includes(body.purposeCode), 'INVALID_PURPOSE');
  const input = {
    productCode: body.productCode,
    purposeCode: body.purposeCode,
    incomeType: enumValue(body.incomeType, ['SALARY', 'BUSINESS', 'MIXED', 'OTHER'] as const, 'INVALID_INCOME_TYPE'),
    monthlyIncomeKobo: money(body.monthlyIncomeKobo),
    monthlyBusinessCostsKobo: money(body.monthlyBusinessCostsKobo),
    monthlyHouseholdExpensesKobo: money(body.monthlyHouseholdExpensesKobo),
    monthlyOtherCommitmentsKobo: money(body.monthlyOtherCommitmentsKobo),
    monthlyExistingRepaymentsKobo: money(body.monthlyExistingRepaymentsKobo),
    requestedAmountKobo: money(body.requestedAmountKobo)
  };
  requireControl(input.monthlyIncomeKobo > 0n && input.requestedAmountKobo > 0n, 'INVALID_PUBLIC_READINESS_INPUT');
  for (const value of [input.monthlyIncomeKobo, input.monthlyBusinessCostsKobo, input.monthlyHouseholdExpensesKobo, input.monthlyOtherCommitmentsKobo, input.monthlyExistingRepaymentsKobo]) {
    requireControl(value <= policy.maximumMonthlyAmountKobo, 'PUBLIC_READINESS_INPUT_OUT_OF_RANGE');
  }
  requireControl(input.requestedAmountKobo <= policy.maximumRequestedAmountKobo, 'PUBLIC_READINESS_INPUT_OUT_OF_RANGE');
  requireControl(input.monthlyBusinessCostsKobo <= input.monthlyIncomeKobo, 'INVALID_BUSINESS_COSTS');
  return input;
}

const publicReason: Record<Metric, Record<Outcome, string>> = {
  DISPOSABLE_INCOME_RATIO_BPS: {
    STRONG: 'Your reported monthly cash flow appears to leave room after regular commitments.',
    ATTENTION: 'Your reported monthly cash flow may need closer review before a formal assessment.',
    BLOCKER: 'Your reported commitments currently leave little or no monthly room for new repayments.'
  },
  EXISTING_DEBT_RATIO_BPS: {
    STRONG: 'Your reported existing repayments appear manageable relative to monthly income.',
    ATTENTION: 'Your existing repayments may reduce readiness and should be reviewed with a Nobles officer.',
    BLOCKER: 'Your reported existing repayments currently weigh heavily on monthly income.'
  },
  REQUESTED_TO_ANNUAL_INCOME_BPS: {
    STRONG: 'The amount you entered appears proportionate to the income information supplied.',
    ATTENTION: 'The amount you entered may need adjustment during a formal assessment.',
    BLOCKER: 'The amount you entered appears high relative to the income information supplied.'
  }
};

export function publicReadinessAssessment(input: PublicReadinessInput, policy: PublicReadinessPolicy) {
  const netMonthly = input.monthlyIncomeKobo - input.monthlyBusinessCostsKobo - input.monthlyHouseholdExpensesKobo - input.monthlyOtherCommitmentsKobo - input.monthlyExistingRepaymentsKobo;
  const metrics: Record<Metric, number> = {
    DISPOSABLE_INCOME_RATIO_BPS: Number(netMonthly * 10000n / input.monthlyIncomeKobo),
    EXISTING_DEBT_RATIO_BPS: Number(input.monthlyExistingRepaymentsKobo * 10000n / input.monthlyIncomeKobo),
    REQUESTED_TO_ANNUAL_INCOME_BPS: Number(input.requestedAmountKobo * 10000n / (input.monthlyIncomeKobo * 12n))
  };
  let points = 0;
  const reasons: string[] = [];
  for (const metric of METRICS) {
    const matching = policy.rules.filter(rule => rule.metric === metric && (rule.minimumInclusive === undefined || metrics[metric] >= rule.minimumInclusive) && (rule.maximumExclusive === undefined || metrics[metric] < rule.maximumExclusive));
    requireControl(matching.length === 1, 'PUBLIC_READINESS_POLICY_REQUIRED');
    points += matching[0].points;
    reasons.push(publicReason[metric][matching[0].outcome]);
  }
  requireControl(points <= policy.maximumPoints, 'PUBLIC_READINESS_POLICY_REQUIRED');
  const readinessPercentage = Math.floor(points * 100 / policy.maximumPoints);
  const status = readinessPercentage >= policy.readyMinimumPercentage
    ? 'READY_FOR_FORMAL_REVIEW'
    : readinessPercentage >= policy.reviewMinimumPercentage
      ? 'NEEDS_ATTENTION'
      : 'NOT_CURRENTLY_READY';
  return { status, readinessPercentage, reasons, estimatedEligibleAmountKobo: null };
}
