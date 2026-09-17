import { authorize, type Actor } from "./access.ts";
import type { ReportedVerifiedMoney, ConfidenceGrade } from "./contracts.ts";
import { normalizeToMonthly, type Frequency } from "./money.ts";
import { varianceBps } from "./diagnostic.ts";
import { integer, reason, requireControl } from "./validation.ts";
export function verifyMoney(original: ReportedVerifiedMoney, input: {
  amountKobo: bigint; frequency: Frequency; operatingDaysPerWeek?: number;
  evidenceDocumentId: string; source: string; reason: string; confidence: ConfidenceGrade;
}, actor: Actor, materialThresholdBps: number, now: string) {
  authorize(actor, "VERIFY");
  reason(input.reason);
  integer(materialThresholdBps, 0, 10000);
  requireControl(input.evidenceDocumentId.trim() && input.source.trim(), "VERIFICATION_EVIDENCE_REQUIRED");
  requireControl(["A", "B", "C", "D"].includes(input.confidence), "INVALID_CONFIDENCE");
  const monthly = normalizeToMonthly(input.amountKobo, input.frequency, input.operatingDaysPerWeek);
  const variance = varianceBps(original.reportedMonthlyKobo, monthly);
  const verified = { ...structuredClone(original), verifiedAmountKobo: input.amountKobo, verifiedFrequency: input.frequency,
    verifiedMonthlyKobo: monthly, verificationSource: input.source, evidenceDocumentId: input.evidenceDocumentId,
    confidenceGrade: input.confidence, varianceBps: variance, verificationNote: input.reason,
    verifiedByUserId: actor.id, verifiedAt: now, checkerStatus: "PENDING" as const };
  return { verified, materialVariance: variance === null || variance >= materialThresholdBps,
    event: { actorId: actor.id, action: "MONEY_VERIFIED", metricKey: original.metricKey, reason: input.reason, evidenceDocumentId: input.evidenceDocumentId, timestamp: now } };
}
export function normalizeExpenseGroups(expenses: { id: string; group: "OPERATING" | "HOUSEHOLD" | "DEBT" | "OWNER_DRAWINGS"; amountKobo: bigint; frequency: Frequency; operatingDaysPerWeek?: number }[]) {
  requireControl(new Set(expenses.map(item => item.id)).size === expenses.length, "DUPLICATE_EXPENSE");
  const result = { operatingKobo: 0n, householdKobo: 0n, debtKobo: 0n, ownerDrawingsReconciliationKobo: 0n };
  for (const item of expenses) {
    const monthly = normalizeToMonthly(item.amountKobo, item.frequency, item.operatingDaysPerWeek);
    switch (item.group) {
      case "OPERATING": result.operatingKobo += monthly; break;
      case "HOUSEHOLD": result.householdKobo += monthly; break;
      case "DEBT": result.debtKobo += monthly; break;
      case "OWNER_DRAWINGS": result.ownerDrawingsReconciliationKobo += monthly; break;
      default: throw new Error("INVALID_EXPENSE_GROUP");
    }
  }
  return result;
}
