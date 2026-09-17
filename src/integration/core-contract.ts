export type CoreCheckStatus =
  | "VERIFIED"
  | "NOT_VERIFIED"
  | "PENDING_MANUAL_VERIFICATION"
  | "SOURCE_UNAVAILABLE";

export interface CoreSystemAdapter {
  matchMember(input: {
    memberNumber?: string;
    registeredPhone?: string;
    fullNameClaim: string;
    localApplicationId?: string;
  }): Promise<{
    status: CoreCheckStatus;
    externalMemberId?: string;
    maskedMemberSummary?: Record<string, unknown>;
    reasonCode?: string;
  }>;

  getMembershipAndKycStatus(externalMemberId: string): Promise<{
    status: CoreCheckStatus;
    active?: boolean;
    kycTier?: string;
    restrictions?: string[];
  }>;

  getSavingsSummary(externalMemberId: string): Promise<{
    status: CoreCheckStatus;
    activeSavingsMonths?: number;
    savingsRegularityBps?: number;
    availableBalanceKobo?: bigint;
  }>;

  getCreditExposure(externalMemberId: string): Promise<{
    status: CoreCheckStatus;
    totalOutstandingKobo?: bigint;
    monthlyDebtServiceKobo?: bigint;
    arrearsDays?: number;
    activeFacilities?: number;
  }>;

  checkDuplicateApplication(input: {
    externalMemberId: string;
    localApplicationId: string;
  }): Promise<{
    status: CoreCheckStatus;
    duplicateApplicationReferences?: string[];
  }>;

  recordApprovedCaseReference(input: {
    applicationReference: string;
    externalMemberId: string;
    approvedAmountKobo: bigint;
    productCode: string;
    productVersion: string;
  }): Promise<{
    status: CoreCheckStatus;
    externalCaseReference?: string;
  }>;
}
