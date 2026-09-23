import { integer, reason, requireControl } from "./validation.ts";

export const MANUAL_CHECKS = ["MEMBERSHIP", "KYC", "SAVINGS", "EXPOSURE", "DUPLICATES"] as const;
export type ManualCheck = typeof MANUAL_CHECKS[number];
export interface ManualFinding {
  check: ManualCheck;
  outcome: "CONFIRMED" | "CONCERN" | "UNRESOLVED";
  source: string;
  evidenceReference: string;
  observedAt: string;
  expiresAt: string;
  note: string;
}
export interface ManualVerificationInput {
  expectedRevision: number;
  idempotencyKey: string;
  reason: string;
  findings: ManualFinding[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function text(value: unknown, maximum: number) {
  requireControl(typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value), "VERIFICATION_EVIDENCE_REQUIRED");
  return value.trim();
}
function timestamp(value: unknown) {
  requireControl(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, "INVALID_VERIFICATION_TIME");
  return value;
}
export function manualVerificationInput(body: Record<string, unknown>): ManualVerificationInput {
  integer(body.expectedRevision, 1, 2147483646);
  requireControl(typeof body.idempotencyKey === "string" && uuid.test(body.idempotencyKey), "INVALID_IDEMPOTENCY_KEY");
  reason(body.reason);
  requireControl(Array.isArray(body.findings) && body.findings.length === MANUAL_CHECKS.length, "ALL_MANUAL_CHECKS_REQUIRED");
  const findings = body.findings.map((value: unknown): ManualFinding => {
    requireControl(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_MANUAL_FINDING");
    const finding = value as Record<string, unknown>;
    requireControl(MANUAL_CHECKS.includes(finding.check as ManualCheck), "INVALID_MANUAL_CHECK");
    requireControl(typeof finding.outcome === "string" && ["CONFIRMED", "CONCERN", "UNRESOLVED"].includes(finding.outcome), "INVALID_VERIFICATION_OUTCOME");
    reason(finding.note);
    return { check: finding.check as ManualCheck, outcome: finding.outcome as ManualFinding["outcome"],
      source: text(finding.source, 200), evidenceReference: text(finding.evidenceReference, 300),
      observedAt: timestamp(finding.observedAt), expiresAt: timestamp(finding.expiresAt), note: finding.note.trim() };
  }).sort((left, right) => MANUAL_CHECKS.indexOf(left.check) - MANUAL_CHECKS.indexOf(right.check));
  requireControl(new Set(findings.map(finding => finding.check)).size === MANUAL_CHECKS.length, "DUPLICATE_MANUAL_CHECK");
  return { expectedRevision: body.expectedRevision, idempotencyKey: body.idempotencyKey, reason: body.reason.trim(), findings };
}
export function assertManualEvidenceCurrent(input: ManualVerificationInput, now: number) {
  requireControl(Number.isFinite(now), "INVALID_VERIFICATION_TIME");
  for (const finding of input.findings) {
    requireControl(Date.parse(finding.observedAt) <= now && Date.parse(finding.expiresAt) > now && Date.parse(finding.expiresAt) > Date.parse(finding.observedAt), "VERIFICATION_EVIDENCE_EXPIRED_OR_FUTURE");
  }
}
