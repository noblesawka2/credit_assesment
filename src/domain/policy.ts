import { authorize, type Actor } from "./access.ts";
import { validateProduct } from "./diagnostic.ts";
import type { ProductMathConfig } from "./money.ts";
import { reason, requireControl } from "./validation.ts";
export interface PolicyVersion<T> {
  id: string; version: number; status: "DRAFT" | "PUBLISHED" | "REJECTED";
  effectiveAt: string; makerId: string; checkerId?: string; publishedAt?: string;
  payload: T; unresolved: string[]; reason: string;
}
export function draftPolicy<T>(actor: Actor, input: PolicyVersion<T>) {
  authorize(actor, "POLICY_DRAFT");
  reason(input.reason);
  requireControl(input.status === "DRAFT" && input.makerId === actor.id && Number.isSafeInteger(input.version) && input.version > 0, "INVALID_POLICY_DRAFT");
  return structuredClone(input);
}
export function publishProduct(actor: Actor, draft: PolicyVersion<ProductMathConfig>, now: string) {
  authorize(actor, "POLICY_PUBLISH");
  requireControl(draft.status === "DRAFT" && draft.makerId !== actor.id, "POLICY_MAKER_CHECKER_REQUIRED");
  requireControl(draft.unresolved.length === 0, "INCOMPLETE_POLICY");
  requireControl(Number.isFinite(Date.parse(draft.effectiveAt)) && Date.parse(draft.effectiveAt) >= Date.parse(now), "INVALID_EFFECTIVE_DATE");
  validateProduct(draft.payload);
  return { ...structuredClone(draft), status: "PUBLISHED" as const, checkerId: actor.id, publishedAt: now };
}
export function activePolicy<T>(versions: PolicyVersion<T>[], now: string): PolicyVersion<T> {
  const candidates = versions.filter(version => version.status === "PUBLISHED" && Date.parse(version.effectiveAt) <= Date.parse(now)).sort((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt));
  requireControl(candidates.length > 0, "NO_ACTIVE_POLICY");
  return structuredClone(candidates[0]);
}
