import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.ts";
import { readFile } from "node:fs/promises";
import type { Actor } from "../src/domain/access.ts";
import type { DraftRepository } from "../src/server/repository.ts";
import { coreAdapter } from "../src/integration/core.ts";
test("HTTP shell exposes no real data and unauthenticated API is blocked", async () => {
  const server = createApp({ origin: "http://127.0.0.1:3100" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  try {
    const shell = await fetch(origin + "/credit/apply/start");
    assert.equal(shell.status, 200); assert.match(await shell.text(), /Nobles Cooperative/);
    assert.equal(shell.headers.get("cache-control"), "no-store");
    assert.match(shell.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    const health = await fetch(origin + "/api/health").then(response => response.json());
    assert.equal(health.productionReady, false); assert.equal(health.offlineCaptureEnabled, false);
    assert.equal((await fetch(origin + "/api/drafts")).status, 401);
    assert.equal((await fetch(origin + "/api/session")).status, 401);
    assert.equal((await fetch(origin + "/api/drafts", { method: "POST", headers: { Origin: "https://other.example" } })).status, 403);
    assert.equal((await fetch(origin + "/.env")).status, 404);
    assert.equal((await fetch(origin + "/src/server/encryption.ts")).status, 404);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("standalone staff drafts never fabricate a member ID and retain authorization gates", async () => {
  const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", roles: ["ASSISTED_INTAKE"], active: true, capabilities: [] };
  const id = "22222222-2222-4222-8222-222222222222";
  let saves = 0;
  const repository = {
    async save(receivedActor: Actor, externalMemberId: string | null, body: { answers: Record<string, unknown> }) {
      saves++; assert.equal(receivedActor.id, actor.id); assert.equal(externalMemberId, null);
      assert.equal(body.answers.memberNumber, "MEMBER-CLAIM");
      return { id, revision: 1, status: "DRAFT", verificationStatus: "PENDING_MANUAL_VERIFICATION" };
    },
    async read(receivedActor: Actor, receivedId: string) { assert.equal(receivedActor.id, actor.id); assert.equal(receivedId, id); return { id, status: "DRAFT" }; }
  } as unknown as DraftRepository;
  const configuredOrigin = "http://127.0.0.1:3100";
  const server = createApp({ origin: configuredOrigin, identity: { async authenticate() { return actor; } }, repository });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const post = () => fetch(origin + "/api/drafts", { method: "POST", headers: { Origin: configuredOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ memberNumber: "MEMBER-CLAIM", fullNameClaim: "Unverified claim", requestedAmountKobo: "10000", answers: { memberNumber: "CONFLICTING-CLAIM" }, idempotencyKey: id }) });
  try {
    const health = await fetch(origin + "/api/health").then(response => response.json());
    assert.equal(health.verificationMode, "STANDALONE"); assert.equal(health.coreConfigured, false); assert.equal(health.submissionEnabled, false);
    let response = await post(); assert.equal(response.status, 200);
    assert.equal((await response.json()).verificationStatus, "PENDING_MANUAL_VERIFICATION");
    assert.equal((await fetch(origin + "/api/drafts/" + id)).status, 200);
    assert.equal((await fetch(origin + "/api/drafts/not-a-uuid")).status, 400);
    actor.roles = ["CREDIT_APPROVER"];
    assert.equal((await fetch(origin + "/api/session").then(result => result.json())).canCapture, false);
    assert.equal((await post()).status, 403);
    assert.equal((await fetch(origin + "/api/drafts/" + id)).status, 403);
    actor.roles = ["MEMBER"]; actor.externalMemberId = "real-member";
    assert.equal((await post()).status, 403);
    actor.roles = ["CERTIFIED_FIELD_AGENT"];
    assert.equal((await post()).status, 403);
    assert.equal(saves, 1);
    assert.equal((await fetch(origin + "/api/approve")).status, 404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("an explicitly configured external adapter never silently falls back on pending verification", async () => {
  const server = createApp({ origin: "http://127.0.0.1:3100", core: coreAdapter,
    identity: { async authenticate() { return { id: "11111111-1111-4111-8111-111111111111", roles: ["ASSISTED_INTAKE"], active: true, capabilities: [] }; } },
    repository: { async save() { assert.fail("must not save after failed external verification"); } } as unknown as DraftRepository });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch("http://127.0.0.1:" + (server.address() as AddressInfo).port + "/api/drafts", { method: "POST", headers: { Origin: "http://127.0.0.1:3100", "Content-Type": "application/json" }, body: JSON.stringify({ memberNumber: "CLAIM", fullNameClaim: "Claim", answers: {}, requestedAmountKobo: "100", idempotencyKey: "22222222-2222-4222-8222-222222222222" }) });
    assert.equal(response.status, 409); assert.equal((await response.json()).error, "MEMBER_VERIFICATION_PENDING");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("offline shell excludes API, query strings and all submitted payloads", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.search/); assert.match(worker, /event\.request\.method !== "GET"/);
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.ok(!/localStorage|sessionStorage|console\.log/.test(app));
});
