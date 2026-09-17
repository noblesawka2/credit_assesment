import type { CoreSystemAdapter } from "./core-contract.ts";
const pending = async () => ({ status: "PENDING_MANUAL_VERIFICATION" as const });
export const coreAdapter: CoreSystemAdapter = {
  matchMember: pending, getMembershipAndKycStatus: pending, getSavingsSummary: pending,
  getCreditExposure: pending, checkDuplicateApplication: pending, recordApprovedCaseReference: pending
};
