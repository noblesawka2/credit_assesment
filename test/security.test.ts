import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, authorize, memberView, assertCaseAccess } from "../src/domain/access.ts";
import { WORKFLOW, UNAPPROVED_TARGETS, transition, type Status } from "../src/domain/workflow.ts";
import { draftPolicy, publishProduct, activePolicy } from "../src/domain/policy.ts";
import { FACTORS, calculateScore, groupReliability, type Factor, type ScoreModel } from "../src/domain/score.ts";
import { verifyMoney } from "../src/domain/verification.ts";
import type { ReportedVerifiedMoney } from "../src/domain/contracts.ts";
import { PayloadCipher } from "../src/server/encryption.ts";
import { coreAdapter } from "../src/integration/core.ts";
import { actor, creditCase, controls, change, now, product } from "./fixtures.ts";

for (const role of ROLES.filter(role => role !== "CREDIT_APPROVER")) test(role + " cannot decide cases", () => assert.throws(() => authorize(actor(role), "DECIDE")));
for (const role of ["ASSISTED_INTAKE", "CERTIFIED_FIELD_AGENT"] as const) test(role + " cannot verify, recommend or approve", () => {
  for (const action of ["VERIFY", "RECOMMEND", "DECIDE"] as const) assert.throws(() => authorize(actor(role), action));
});
test("inactive and unassigned actors cannot access a case", () => {
  assert.throws(() => assertCaseAccess(actor("CREDIT_OFFICER", "unassigned"), creditCase));
  assert.throws(() => authorize({ ...actor("CREDIT_APPROVER"), active: false }, "DECIDE"));
});
test("approved matrix denies unresolved officer intake and uncertified agent capture", () => {
  assert.throws(() => authorize(actor("CREDIT_OFFICER"), "CAPTURE"), /FORBIDDEN/);
  assert.throws(() => authorize(actor("CERTIFIED_FIELD_AGENT"), "CAPTURE"), /FORBIDDEN/);
  for (const role of ROLES.filter(role => role !== "COMPLIANCE_CONTROL")) assert.throws(() => authorize(actor(role), "REPORT"), /FORBIDDEN|MEMBER_ROLE_CONFLICT/);
});
test("members see only their answers and public case fields", () => {
  const view = memberView({ id: "case", reference: null, status: "DRAFT", reported: {}, requestedAmountKobo: "100" });
  assert.deepEqual(Object.keys(view), ["id", "reference", "status", "reported", "requestedAmountKobo"]);
  assert.throws(() => assertCaseAccess({ ...actor("MEMBER"), externalMemberId: "other" }, creditCase));
  assert.throws(() => authorize({ ...actor("MEMBER"), roles: ["MEMBER", "CREDIT_APPROVER"] }, "DECIDE"));
});
test("valid independent approval emits a separate auditable transition", () => {
  const result = transition(creditCase, "APPROVED", actor("CREDIT_APPROVER", "approver"), controls, change, now);
  assert.equal(result.next.status, "APPROVED");
  assert.equal(result.next.revision, 4);
  assert.equal(creditCase.status, "PENDING_APPROVAL");
  assert.equal(result.event.oldStatus, "PENDING_APPROVAL");
  assert.equal(result.event.reason, change.reason);
});
test("credit officer cannot approve own recommendation even with approver role", () => {
  assert.throws(() => transition(creditCase, "APPROVED", { ...actor("CREDIT_OFFICER", "maker"), roles: ["CREDIT_OFFICER", "CREDIT_APPROVER"] }, controls, change, now), /SELF_APPROVAL/);
});
test("checker cannot approve their own review", () => assert.throws(() => transition(creditCase, "APPROVED", actor("CREDIT_APPROVER", "checker"), controls, change, now), /SELF_APPROVAL/));
test("approval authority, consent and ceiling boundaries", () => {
  const approver = actor("CREDIT_APPROVER", "approver");
  assert.throws(() => transition(creditCase, "APPROVED", approver, { ...controls, authorityLimitKobo: 10000000n }, change, now), /AUTHORITY_EXCEEDED/);
  assert.throws(() => transition(creditCase, "APPROVED", approver, { ...controls, authorityLimitKobo: 99999999n }, { ...change, amountKobo: 31000000n }, now), /AMENDED_MEMBER_CONSENT/);
  assert.throws(() => transition(creditCase, "APPROVED", approver, controls, { ...change, amountKobo: 20000000n }, now), /EXCEPTION_WORKFLOW/);
});
test("revision and reason are required for transitions", () => {
  assert.throws(() => transition(creditCase, "APPROVED", actor("CREDIT_APPROVER", "approver"), controls, { ...change, expectedRevision: 2 }, now), /REVISION_CONFLICT/);
  assert.throws(() => transition(creditCase, "APPROVED", actor("CREDIT_APPROVER", "approver"), controls, { ...change, reason: "" }, now), /REASON_REQUIRED/);
});
for (const control of ["online", "memberVerified", "kycVerified", "exposureVerified", "duplicateChecked", "policyCurrent", "consentCurrent", "assessmentComplete", "verificationComplete"] as const) test("missing " + control + " blocks approval", () => {
  assert.throws(() => transition(creditCase, "APPROVED", actor("CREDIT_APPROVER", "approver"), { ...controls, [control]: false }, change, now));
});
test("hard stops and compliance holds block forward progression", () => {
  assert.throws(() => transition({ ...creditCase, hardStops: ["KYC_FAILED"] }, "APPROVED", actor("CREDIT_APPROVER", "approver"), controls, change, now), /HARD_STOP/);
  assert.throws(() => transition({ ...creditCase, complianceHold: true }, "APPROVED", actor("CREDIT_APPROVER", "approver"), controls, change, now), /COMPLIANCE_HOLD/);
});
test("every undeclared workflow edge is rejected", () => {
  for (const [source, targets] of Object.entries(WORKFLOW)) for (const target of Object.keys(WORKFLOW)) {
    if ((targets as readonly string[]).includes(target)) continue;
    assert.throws(() => transition({ ...creditCase, status: source as Status }, target as Status, actor("CREDIT_APPROVER", "approver"), controls, change, now), /INVALID_TRANSITION/);
  }
});
test("every declared workflow edge works only with its required actor and controls", () => {
  for (const [source, targets] of Object.entries(WORKFLOW)) for (const target of targets) {
    if (UNAPPROVED_TARGETS.includes(target)) {
      assert.throws(() => transition({ ...creditCase, status: source as Status }, target, actor("CREDIT_APPROVER", "approver"), controls, change, now), /TRANSITION_AUTHORITY_NOT_APPROVED/);
      continue;
    }
    let chosen = actor("CREDIT_OFFICER", "officer");
    if (["SUBMITTED", "WITHDRAWN"].includes(target)) chosen = actor("ASSISTED_INTAKE", "officer");
    else if (target === "MEMBER_ACCEPTED") chosen = { ...actor("MEMBER", "member"), externalMemberId: creditCase.externalMemberId };
    else if (["APPROVED", "CONDITIONALLY_APPROVED", "DECLINED", "DEFERRED"].includes(target) || source === "PENDING_APPROVAL") chosen = actor("CREDIT_APPROVER", "approver");
    else if (source === "CHECKER_REVIEW" || ["ASSIGNED", "PRELIMINARY_CHECK"].includes(target)) chosen = actor("OPERATIONS_CHECKER", "checker");
    else if (["DISBURSEMENT_READY", "DISBURSED", "CLOSED", "DEFAULT_OUTCOME_RECORDED"].includes(target)) chosen = actor("FINANCE_DISBURSEMENT", "officer");
    const original = { ...creditCase, status: source as Status };
    const result = transition(original, target as Status, chosen, controls, change, now);
    assert.equal(result.next.status, target, source + " -> " + target);
    assert.equal(result.event.actorId, chosen.id);
    assert.throws(() => transition(original, target as Status, chosen, { ...controls, online: false }, change, now), /ONLINE_ONLY/);
  }
});
test("disbursement requires authorised core-system confirmation", () => {
  const ready = { ...creditCase, status: "DISBURSEMENT_READY" as const };
  assert.throws(() => transition(ready, "DISBURSED", actor("FINANCE_DISBURSEMENT", "officer"), { ...controls, coreDisbursementConfirmed: false }, change, now), /CORE_CONFIRMATION/);
  assert.equal(transition(ready, "DISBURSED", actor("FINANCE_DISBURSEMENT", "officer"), controls, change, now).next.status, "DISBURSED");
});
test("policy publication is independent and does not mutate previous versions", () => {
  const draft = draftPolicy(actor("POLICY_ADMIN_MAKER", "maker"), { id: "policy", version: 1, status: "DRAFT", effectiveAt: "2026-09-09T00:00:00Z", makerId: "maker", payload: product, unresolved: [], reason: "Approved example policy for tests" });
  assert.throws(() => publishProduct(actor("POLICY_ADMIN_CHECKER", "maker"), draft, now), /MAKER_CHECKER/);
  assert.throws(() => publishProduct(actor("POLICY_ADMIN_CHECKER", "checker"), { ...draft, unresolved: ["INSURANCE"] }, now), /INCOMPLETE_POLICY/);
  const published = publishProduct(actor("POLICY_ADMIN_CHECKER", "checker"), draft, now);
  assert.equal(draft.status, "DRAFT");
  assert.throws(() => activePolicy([published], now), /NO_ACTIVE_POLICY/);
  const read = activePolicy([published], "2026-09-10T00:00:00Z");
  read.payload.minimumPrincipalKobo = 1n;
  assert.equal(published.payload.minimumPrincipalKobo, 100n);
});
test("score is deterministic, bounded to 100 and preserves its model version", () => {
  assert.equal(Object.values(FACTORS).reduce((total, points) => total + points, 0), 100);
  const inputs = Object.fromEntries(Object.keys(FACTORS).map(key => [key, "TEST_EVIDENCE"])) as Record<Factor, string>;
  const rules = Object.fromEntries(Object.entries(FACTORS).map(([key, points]) => [key, [{ equals: "TEST_EVIDENCE", points }]])) as ScoreModel["rules"];
  const model: ScoreModel = { version: "TEST_ONLY", status: "PUBLISHED", rules, neutralNewToCreditPoints: 3 };
  const result = calculateScore(inputs, model, false, now);
  assert.equal(result.total, 100); assert.equal(result.riskBand, "STRONG_GREEN");
  assert.deepEqual(calculateScore(inputs, model, false, now), result);
  assert.equal(calculateScore(inputs, model, true, now).total, 97);
  model.version = "TEST_NEXT";
  assert.equal(result.modelVersion, "TEST_ONLY");
  assert.throws(() => calculateScore(inputs, { ...model, status: "DRAFT" }, false, now), /NOT_PUBLISHED/);
  assert.throws(() => calculateScore(inputs, { ...model, rules: { ...rules, tenure: [] } }, false, now), /RUBRIC_INCOMPLETE/);
});
test("Unity requires individual controls and group threshold", () => {
  assert.equal(groupReliability([5, 5, 5, 3, 2], [{ individualControlsPassed: false, consent: true }], 15, 100n, 200n).canProceed, false);
  assert.equal(groupReliability([1, 1, 1, 1, 1], [{ individualControlsPassed: true, consent: true }], 15, 100n, 200n).canProceed, false);
  assert.equal(groupReliability([5, 5, 5, 3, 2], [{ individualControlsPassed: true, consent: true }], 15, 100n, 200n).canProceed, true);
});
test("reported values stay unchanged and verification requires evidence and reason", () => {
  const original: ReportedVerifiedMoney = { metricKey: "sales", reportedAmountKobo: 10000n, reportedFrequency: "MONTHLY", reportedMonthlyKobo: 10000n, verifiedAmountKobo: null, verifiedFrequency: null, verifiedMonthlyKobo: null, verificationSource: null, evidenceDocumentId: null, confidenceGrade: null, varianceBps: null, verificationNote: null, verifiedByUserId: null, verifiedAt: null, checkerStatus: "PENDING" };
  const input = { amountKobo: 5000n, frequency: "MONTHLY" as const, evidenceDocumentId: "document", source: "Verified ledger", reason: "Stock ledger confirms lower sales", confidence: "B" as const };
  const result = verifyMoney(original, input, actor("CREDIT_OFFICER"), 2000, now);
  assert.equal(result.verified.reportedMonthlyKobo, 10000n); assert.equal(original.verifiedMonthlyKobo, null); assert.equal(result.materialVariance, true);
  assert.throws(() => verifyMoney(original, { ...input, reason: "" }, actor("CREDIT_OFFICER"), 2000, now));
  assert.throws(() => verifyMoney(original, input, actor("ASSISTED_INTAKE"), 2000, now));
});
test("server encryption authenticates record context and rejects wrong keys", () => {
  const cipher = new PayloadCipher("ab".repeat(32));
  const sealed = cipher.seal({ name: "SYNTHETIC_TEST_MEMBER" }, "case:1");
  assert.ok(!sealed.includes("SYNTHETIC_TEST_MEMBER"));
  assert.deepEqual(cipher.open(sealed, "case:1"), { name: "SYNTHETIC_TEST_MEMBER" });
  assert.throws(() => cipher.open(sealed, "case:2"));
  assert.throws(() => new PayloadCipher("cd".repeat(32)).open(sealed, "case:1"));
  assert.throws(() => new PayloadCipher(""));
});
test("unconfigured core integration never claims a verified member", async () => {
  assert.equal((await coreAdapter.matchMember({ fullNameClaim: "Synthetic" })).status, "PENDING_MANUAL_VERIFICATION");
  assert.equal((await coreAdapter.getCreditExposure("external-1")).status, "PENDING_MANUAL_VERIFICATION");
});
