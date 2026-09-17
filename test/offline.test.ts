import test from "node:test";
import assert from "node:assert/strict";
import { OfflineVault, assertOfflineGrant, localTransition, type EncryptedStore, type SealedRecord, type OfflineGrant } from "../src/offline/vault.ts";
import { checksum, verifyChunks, syncOne, type SyncPayload } from "../src/offline/sync.ts";
import { actor } from "./fixtures.ts";
const staff = { ...actor("CREDIT_OFFICER", "officer"), capabilities: ["OFFLINE_CAPTURE"] };
const grant: OfflineGrant = { userId: "officer", deviceId: "device", issuedAt: 1000, expiresAt: 10000000, revoked: false, registered: true, minimumAgentLevel: 1, failedUnlocks: 0 };
function memoryStore() {
  const records = new Map<string, SealedRecord>();
  const store: EncryptedStore = { async put(id, record) { records.set(id, structuredClone(record)); }, async get(id) { return structuredClone(records.get(id)); }, async delete(id) { records.delete(id); } };
  return { records, store };
}
test("offline rejects members, unregistered devices, revoked grants and locked users", () => {
  assert.throws(() => assertOfflineGrant(actor("MEMBER"), grant, 2000), /OFFLINE_FORBIDDEN/);
  assert.throws(() => assertOfflineGrant(staff, { ...grant, registered: false }, 2000), /DEVICE_OR_GRANT_INVALID/);
  assert.throws(() => assertOfflineGrant(staff, { ...grant, revoked: true }, 2000));
  assert.throws(() => assertOfflineGrant(staff, { ...grant, failedUnlocks: 5 }, 2000), /UNLOCK_LOCKED/);
  assert.throws(() => assertOfflineGrant(staff, grant, grant.expiresAt), /EXPIRED/);
});
test("encrypted draft resumes without persisting plaintext or an extractable key", async () => {
  const { records, store } = memoryStore();
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const vault = new OfflineVault(staff, grant, store, { assurance: "APPROVED_DEVICE_BOUND", async unlock() { return key; } }, () => 2000);
  await vault.unlock();
  const bytes = new TextEncoder().encode("SYNTHETIC PRIVATE TEST DRAFT");
  await vault.save("LOCAL-device-1", bytes);
  assert.ok(!JSON.stringify([...records]).includes("SYNTHETIC"));
  vault.lock(); await assert.rejects(vault.open("LOCAL-device-1"), /LOCKED/);
  await vault.unlock(); assert.deepEqual(await vault.open("LOCAL-device-1"), bytes);
  const sealed = records.get("LOCAL-device-1")!; sealed.ciphertext[0] ^= 1;
  await assert.rejects(vault.open("LOCAL-device-1"));
});
test("expiry and inactivity block access but preserve encrypted records", async () => {
  const { records, store } = memoryStore(); let clock = 2000;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const vault = new OfflineVault(staff, grant, store, { assurance: "APPROVED_DEVICE_BOUND", async unlock() { return key; } }, () => clock);
  await vault.unlock(); await vault.save("LOCAL-device-1", new Uint8Array([1, 2]));
  clock += 300001; await assert.rejects(vault.open("LOCAL-device-1"), /LOCKED/);
  await vault.unlock(); clock = grant.expiresAt; await assert.rejects(vault.open("LOCAL-device-1"), /EXPIRED/);
  assert.equal(records.size, 1);
});
test("sync cleanup requires all acknowledgements and recovery window", async () => {
  const { records, store } = memoryStore();
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const vault = new OfflineVault(staff, grant, store, { assurance: "APPROVED_DEVICE_BOUND", async unlock() { return key; } }, () => 2000);
  await vault.unlock(); await vault.save("LOCAL-device-1", new Uint8Array([1]));
  await assert.rejects(vault.clearConfirmed("LOCAL-device-1", { confirmed: true, allAttachments: false, allAuditEvents: true }, 1000), /NOT_CONFIRMED/);
  await assert.rejects(vault.clearConfirmed("LOCAL-device-1", { confirmed: true, allAttachments: true, allAuditEvents: true }, 3000), /RECOVERY/);
  await vault.clearConfirmed("LOCAL-device-1", { confirmed: true, allAttachments: true, allAuditEvents: true }, 1000);
  assert.equal(records.size, 0);
});
test("local state machine disallows skipping synchronization", () => {
  assert.throws(() => localTransition("LOCAL_DRAFT", "SYNCED"));
  assert.equal(localTransition("SYNC_ERROR", "SYNCING"), "SYNCING");
});
test("attachment chunks require complete size and checksum", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]); const hash = await checksum(bytes);
  await assert.rejects(verifyChunks([bytes.slice(0, 2)], 4, hash), /INCOMPLETE/);
  await assert.rejects(verifyChunks([new Uint8Array([1, 2, 3, 5])], 4, hash), /CHECKSUM/);
  assert.deepEqual(await verifyChunks([bytes.slice(0, 2), bytes.slice(2)], 4, hash), bytes);
});
test("client requires fresh device checks, recalculation and complete acknowledgements", async () => {
  const payload: SyncPayload = { localId: "LOCAL-device-1", deviceId: "device", revision: 1, policyVersion: "draft-policy", answers: {}, attachments: [{ id: "document", checksum: "hash", bytes: 4 }], auditEvents: [{ id: "event", clientTime: "2026-09-08T10:00:00Z", action: "CAPTURE" }] };
  let refreshed = false;
  const receipt = { applicationReference: "NBL-CR-202609-ABC123", revision: 1, receivedAttachmentIds: ["document"], receivedAuditEventIds: ["event"], serverTime: "2026-09-08T11:00:00Z", recalculated: true, consentRequired: false, warnings: [] };
  const transport = { async refreshAndValidateDevice() { refreshed = true; }, async send() { assert.equal(refreshed, true); return receipt; } };
  assert.equal((await syncOne(payload, transport)).state, "SYNCED");
  assert.equal((await syncOne(payload, { ...transport, async send() { return { ...receipt, receivedAttachmentIds: [] }; } })).state, "SYNC_ERROR");
  assert.equal((await syncOne(payload, { ...transport, async send() { return { ...receipt, consentRequired: true }; } })).state, "SYNC_ERROR");
  await assert.rejects(syncOne(payload, { ...transport, async send() { return { ...receipt, recalculated: false }; } }), /RECALCULATION/);
});
