import { integer, requireControl } from "./validation.ts";
export const FACTORS = {
  tenure: 6, location_or_employment_stability: 4, sales_or_salary_consistency: 5, records_or_income_evidence: 5,
  base_dscr: 12, stressed_dscr: 8, existing_debt_burden: 5, evidence_confidence: 5,
  savings_regularity: 6, previous_nobles_repayment: 6, transparency_and_responsiveness: 3,
  internal_and_authorised_external_history: 8, debt_disclosure_consistency: 4, guarantor_group_or_employer_support: 3,
  permitted_productive_purpose: 3, itemised_verified_use_of_funds: 3, request_need_alignment: 2, required_member_contribution: 2,
  business_residence_or_employment_verified: 4, independent_evidence_consistent: 3, supplier_market_group_employer_or_reference_confirmation: 3
} as const;
export type Factor = keyof typeof FACTORS;
export interface ScoreRule { minimum?: number; maximum?: number; equals?: string; points: number; flag?: string }
export interface ScoreModel {
  version: string; status: "DRAFT" | "PUBLISHED";
  rules: Record<Factor, ScoreRule[]>; neutralNewToCreditPoints: number;
}
export function calculateScore(inputs: Record<Factor, number | string | null>, model: ScoreModel, newToCredit: boolean, now: string) {
  requireControl(model.status === "PUBLISHED", "SCORE_MODEL_NOT_PUBLISHED");
  integer(model.neutralNewToCreditPoints, 0, FACTORS.previous_nobles_repayment);
  const components = Object.entries(FACTORS).map(([name, maximumPoints]) => {
    const factor = name as Factor;
    const rawInput = inputs[factor];
    if (newToCredit && factor === "previous_nobles_repayment") return { factor, rawInput, points: model.neutralNewToCreditPoints, rule: "NEW_TO_CREDIT_NEUTRAL", flag: undefined };
    const rules = model.rules[factor];
    requireControl(Array.isArray(rules) && rules.length > 0, "SCORE_RUBRIC_INCOMPLETE");
    for (const rule of rules) integer(rule.points, 0, maximumPoints);
    requireControl(rawInput !== null && rawInput !== undefined, "SCORE_INPUT_MISSING");
    const matched = rules.find(rule => rule.equals !== undefined
      ? rawInput === rule.equals
      : typeof rawInput === "number" && Number.isFinite(rawInput) && (rule.minimum !== undefined || rule.maximum !== undefined) && (rule.minimum === undefined || rawInput >= rule.minimum) && (rule.maximum === undefined || rawInput <= rule.maximum));
    requireControl(matched, "SCORE_RULE_UNMATCHED");
    return { factor, rawInput, points: matched.points, rule: structuredClone(matched), flag: matched.flag };
  });
  const total = components.reduce((sum, component) => sum + component.points, 0);
  return { total, components, modelVersion: model.version, calculatedAt: now, riskBand: total >= 80 ? "STRONG_GREEN" : total >= 70 ? "ACCEPTABLE_GREEN_AMBER" : total >= 60 ? "CAUTION_MANUAL_REVIEW" : "WEAK_DEFER_OR_DECLINE", flags: components.flatMap(component => component.flag ? [component.flag] : []) };
}
export function groupReliability(points: number[], borrowers: { individualControlsPassed: boolean; consent: boolean }[], threshold: number, exposure: bigint, limit: bigint) {
  const maxima = [5, 5, 5, 3, 2];
  requireControl(points.length === maxima.length, "INVALID_GROUP_FACTORS");
  points.forEach((value, index) => integer(value, 0, maxima[index]));
  integer(threshold, 0, 20);
  const total = points.reduce((sum, value) => sum + value, 0);
  return { total, canProceed: borrowers.length > 0 && borrowers.every(borrower => borrower.individualControlsPassed && borrower.consent) && total >= threshold && exposure >= 0n && limit >= exposure };
}
