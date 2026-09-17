export type ConfidenceGrade = "A" | "B" | "C" | "D";

export interface ReportedVerifiedMoney {
  metricKey: string;
  reportedAmountKobo: bigint;
  reportedFrequency: "DAILY" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "QUARTERLY" | "TERMLY" | "ANNUAL";
  reportedMonthlyKobo: bigint;
  verifiedAmountKobo: bigint | null;
  verifiedFrequency: ReportedVerifiedMoney["reportedFrequency"] | null;
  verifiedMonthlyKobo: bigint | null;
  verificationSource: string | null;
  evidenceDocumentId: string | null;
  confidenceGrade: ConfidenceGrade | null;
  varianceBps: number | null;
  verificationNote: string | null;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  checkerStatus: "PENDING" | "CONFIRMED" | "RETURNED";
}

export interface UseOfFundsLine {
  id: string;
  description: string;
  memberQuantity: number;
  memberUnitCostKobo: bigint;
  memberTotalKobo: bigint;
  verifiedQuantity: number | null;
  verifiedUnitCostKobo: bigint | null;
  verifiedTotalKobo: bigint | null;
  eligible: boolean | null;
  supplier: string | null;
  evidenceDocumentId: string | null;
  verificationSource: string | null;
  verificationNote: string | null;
}

export interface ThreeAmountDiagnostic {
  requestedAmountKobo: bigint;
  verifiedEligibleUseOfFundsKobo: bigint;
  verifiedMemberContributionKobo: bigint;
  confirmedOtherFundingKobo: bigint;
  demonstratedNetNeedKobo: bigint;
  grossPrincipalRequiredForNeedKobo: bigint;
  repaymentSupportedAmountKobo: bigint;
  productLimitKobo: bigint;
  memberOrCycleLimitKobo: bigint;
  remainingExposureLimitKobo: bigint;
  securityOrGuaranteeLimitKobo: bigint | null;
  systemRecommendedCeilingKobo: bigint;
  officerRecommendedAmountKobo: bigint | null;
  approvedAmountKobo: bigint | null;
  limitingFactorCodes: string[];
}
