import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { MANUAL_CHECKS, manualVerificationInput, assertManualEvidenceCurrent } from "../src/domain/manual-verification.ts";
import { ManualVerificationRepository } from "../src/server/manual-verification.ts";
import { PayloadCipher } from "../src/server/encryption.ts";
import type { Actor } from "../src/domain/access.ts";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", roles: ["CREDIT_OFFICER"], active: true, capabilities: [] };
const id = "22222222-2222-4222-8222-222222222222";
const now = Date.parse("2026-09-23T12:00:00.000Z");
function input() {
  return { expectedRevision: 2, idempotencyKey: "33333333-3333-4333-8333-333333333333", reason: "Reviewed approved Nobles records",
    findings: MANUAL_CHECKS.map(check => ({ check, outcome: "CONFIRMED", source: "Approved synthetic registry", evidenceReference: "SYNTHETIC-EVIDENCE-001",
      observedAt: "2026-09-23T10:00:00.000Z", expiresAt: "2026-09-24T10:00:00.000Z", note: "Checked source record and retained reference" })) };
}
function fixture(options: { unassigned?: boolean; auditFailure?: boolean; status?: string } = {}) {
  const cipher = new PayloadCipher(randomBytes(32).toString("hex"));
  const calls: { sql: string; values: unknown[] }[] = [];
  let record: Record<string, unknown> | undefined;
  const row = { id, status: options.status ?? "DRAFT", revision: 2, assigned_user_ids: [actor.id], reported_ciphertext: cipher.seal({ original: true }, "application:" + id) };
  const client = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT * FROM credit_applications")) {
        assert.match(sql, /\$2=ANY\(assigned_user_ids\)/); assert.equal(values[1], actor.id);
        return { rowCount: options.unassigned ? 0 : 1, rows: options.unassigned ? [] : [row] };
      }
      if (sql.includes("FROM credit_manual_verifications WHERE created_by")) return { rowCount: record ? 1 : 0, rows: record ? [record] : [] };
      if (sql.includes("FROM credit_manual_verifications WHERE application_id")) return { rowCount: record ? 1 : 0, rows: record ? [record] : [] };
      if (sql.includes("clock_timestamp() AS now")) return { rowCount: 1, rows: [{ now: new Date(now) }] };
      if (sql.startsWith("UPDATE credit_applications")) row.revision = values[1] as number;
      if (sql.startsWith("INSERT INTO credit_manual_verifications")) record = { id: values[0], application_id: values[1], case_revision: values[2], ciphertext: values[3], created_by: values[4], request_hash: values[6], expires_at: values[7] };
      if (sql.startsWith("INSERT INTO credit_audit_logs") && options.auditFailure) throw new Error("synthetic audit failure");
      return { rowCount: 0, rows: [] };
    }, release() {}
  };
  return { repository: new ManualVerificationRepository({ connect: async () => client } as unknown as Pool, cipher), cipher, calls, row, stored: () => record };
}

test("manual evidence requires all checks, exact outcomes, reasons, sources and valid timestamps", () => {
  assert.equal(manualVerificationInput(input()).findings.length, 5);
  assert.throws(() => manualVerificationInput({ ...input(), findings: [] }), /ALL_MANUAL_CHECKS_REQUIRED/);
  for (const change of [{ source: "" }, { evidenceReference: "" }, { note: "" }, { observedAt: "not-a-date" }, { outcome: ["CONFIRMED"] }]) {
    const body = input(); Object.assign(body.findings[0], change);
    assert.throws(() => manualVerificationInput(body));
  }
  const duplicated = input(); duplicated.findings[1] = duplicated.findings[0];
  assert.throws(() => manualVerificationInput(duplicated), /DUPLICATE_MANUAL_CHECK/);
  assertManualEvidenceCurrent(manualVerificationInput(input()), now);
  assert.throws(() => assertManualEvidenceCurrent(manualVerificationInput(input()), now + 86400000), /EXPIRED_OR_FUTURE/);
  assert.throws(() => assertManualEvidenceCurrent(manualVerificationInput(input()), now - 86400000), /EXPIRED_OR_FUTURE/);
});

test("manual verification preserves originals, encrypts evidence and commits audit atomically", async () => {
  const setup = fixture(); const original = setup.row.reported_ciphertext;
  const receipt = await setup.repository.record(actor, id, input());
  assert.equal(receipt.status, "MANUAL_RECORDED"); assert.equal(receipt.revision, 3);
  assert.equal(setup.row.reported_ciphertext, original); assert.equal(setup.row.status, "DRAFT");
  const stored = setup.stored()!;
  assert.ok(!String(stored.ciphertext).includes("SYNTHETIC-EVIDENCE"));
  const decrypted = setup.cipher.open(String(stored.ciphertext), "manual-verification:" + stored.id) as { findings: unknown[] };
  assert.equal(decrypted.findings.length, 5);
  assert.equal(setup.calls.at(-1)?.sql, "COMMIT");
  const updates = setup.calls.filter(call => call.sql.startsWith("UPDATE"));
  assert.equal(updates.length, 1); assert.ok(!updates[0].sql.includes("reported_ciphertext"));
  const audit = setup.calls.find(call => call.sql.startsWith("INSERT INTO credit_audit_logs"))!;
  assert.equal(audit.values[3], "MANUAL_VERIFICATION_RECORDED");
  assert.ok(!JSON.stringify(audit.values).includes("SYNTHETIC-EVIDENCE"));
});

test("manual verification retries return the original receipt and reject changed payloads", async () => {
  const setup = fixture(); const body = input();
  const first = await setup.repository.record(actor, id, body);
  assert.deepEqual(await setup.repository.record(actor, id, body), first);
  assert.equal(setup.calls.filter(call => call.sql.startsWith("INSERT INTO credit_manual_verifications")).length, 1);
  await assert.rejects(setup.repository.record(actor, id, { ...body, reason: "A different source rationale" }), /IDEMPOTENCY_PAYLOAD_CONFLICT/);
});

test("verification denies non-officers, unassigned cases, stale revisions and prohibited stages", async () => {
  const setup = fixture();
  await assert.rejects(setup.repository.record({ ...actor, roles: ["ASSISTED_INTAKE"] }, id, input()), /FORBIDDEN/);
  assert.equal(setup.calls.length, 0);
  await assert.rejects(fixture({ unassigned: true }).repository.record(actor, id, input()), /CASE_NOT_FOUND/);
  await assert.rejects(fixture().repository.record(actor, id, { ...input(), expectedRevision: 1 }), /REVISION_CONFLICT/);
  await assert.rejects(fixture({ status: "APPROVED" }).repository.record(actor, id, input()), /VERIFICATION_STAGE_PROHIBITED/);
});

test("verification read is audited and audit failures roll back writes and reads", async () => {
  const setup = fixture(); await setup.repository.record(actor, id, input());
  const result = await setup.repository.read(actor, id);
  assert.equal(result.approvalEnabled, false); assert.deepEqual(result.answers, { original: true });
  assert.equal(result.verifications[0].current, true);
  assert.equal(setup.calls.at(-1)?.sql, "COMMIT");
  const failing = fixture({ auditFailure: true });
  await assert.rejects(failing.repository.record(actor, id, input()));
  assert.equal(failing.calls.at(-1)?.sql, "ROLLBACK");
  await assert.rejects(failing.repository.read(actor, id));
  assert.equal(failing.calls.at(-1)?.sql, "ROLLBACK");
});
