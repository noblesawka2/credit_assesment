import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { DraftRepository } from "../src/server/repository.ts";
import { PayloadCipher } from "../src/server/encryption.ts";
import type { Actor } from "../src/domain/access.ts";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", active: true, roles: ["ASSISTED_INTAKE"], capabilities: [] };
const id = "22222222-2222-4222-8222-222222222222";
function harness(options: { denyRead?: boolean; failAudit?: boolean } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const cipher = new PayloadCipher(randomBytes(32).toString("hex"));
  const answers = { memberNumber: "UNVERIFIED-CLAIM", fullNameClaim: "Synthetic applicant" };
  let released = false;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO credit_audit_logs") && options.failAudit) throw new Error("audit unavailable");
      if (sql.startsWith("SELECT * FROM credit_applications")) return { rowCount: options.denyRead ? 0 : 1, rows: options.denyRead ? [] : [{ id, reference: null, status: "DRAFT", revision: 1, external_member_id: null, reported_ciphertext: cipher.seal(answers, "application:" + id) }] };
      return { rowCount: 0, rows: [] };
    },
    release() { released = true; }
  };
  const repository = new DraftRepository({ connect: async () => client } as unknown as Pool, cipher);
  return { repository, calls, cipher, answers, released: () => released };
}

test("standalone draft stores null external identity, encrypted claims and transactional audit", async () => {
  const fixture = harness();
  const receipt = await fixture.repository.save(actor, null, { answers: fixture.answers, requestedAmountKobo: "10000", idempotencyKey: id });
  assert.equal(receipt.status, "DRAFT"); assert.equal(receipt.verificationStatus, "PENDING_MANUAL_VERIFICATION");
  const insert = fixture.calls.find(call => call.sql.startsWith("INSERT INTO credit_applications"))!;
  assert.equal(insert.params[1], null);
  assert.ok(!String(insert.params[3]).includes("UNVERIFIED-CLAIM"));
  assert.deepEqual(fixture.cipher.open(String(insert.params[3]), "application:" + receipt.id), fixture.answers);
  const audit = fixture.calls.findIndex(call => call.sql.startsWith("INSERT INTO credit_audit_logs"));
  const commit = fixture.calls.findIndex(call => call.sql === "COMMIT");
  assert.ok(audit > 0 && commit > audit);
  assert.equal(fixture.calls[1].params[0], actor.id); assert.ok(fixture.released());
});

test("draft resume decrypts only an authorized row and audits before returning", async () => {
  const fixture = harness();
  const result = await fixture.repository.read(actor, id);
  assert.deepEqual(result.answers, fixture.answers);
  assert.equal(result.verificationStatus, "PENDING_MANUAL_VERIFICATION");
  assert.ok(fixture.calls.some(call => call.sql.includes("SENSITIVE_ACCESS")));
  assert.equal(fixture.calls.at(-1)?.sql, "COMMIT");
  const denied = harness({ denyRead: true });
  await assert.rejects(denied.repository.read(actor, id), /CASE_NOT_FOUND/);
  assert.equal(denied.calls.at(-1)?.sql, "ROLLBACK");
  assert.ok(denied.released());
});

test("audit failure rolls back standalone create and prevents sensitive resume response", async () => {
  const create = harness({ failAudit: true });
  await assert.rejects(create.repository.save(actor, null, { answers: create.answers, requestedAmountKobo: "10000", idempotencyKey: id }));
  assert.equal(create.calls.at(-1)?.sql, "ROLLBACK");
  const read = harness({ failAudit: true });
  await assert.rejects(read.repository.read(actor, id));
  assert.equal(read.calls.at(-1)?.sql, "ROLLBACK");
});
