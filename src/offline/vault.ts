import type { Actor } from "../domain/access.ts";
import { requireControl } from "../domain/validation.ts";
export const LOCAL_STATES = {
  LOCAL_DRAFT: ["READY_FOR_SYNC", "LOCAL_WITHDRAWN"],
  READY_FOR_SYNC: ["SYNCING", "LOCAL_DRAFT"],
  SYNCING: ["SYNCED", "SYNC_ERROR", "CONFLICT_REVIEW"],
  SYNC_ERROR: ["SYNCING", "LOCAL_DRAFT"],
  CONFLICT_REVIEW: ["SYNCING", "LOCALLY_ARCHIVED"],
  SYNCED: ["LOCALLY_ARCHIVED"], LOCAL_WITHDRAWN: ["LOCALLY_ARCHIVED"], LOCALLY_ARCHIVED: []
} as const;
export type LocalState = keyof typeof LOCAL_STATES;
export interface OfflineGrant {
  userId: string; deviceId: string; issuedAt: number; expiresAt: number; revoked: boolean;
  registered: boolean; minimumAgentLevel: number; failedUnlocks: number;
}
export interface SealedRecord { version: 1; iv: number[]; ciphertext: number[]; localId: string; deviceId: string; userId: string }
export interface EncryptedStore {
  put(id: string, record: SealedRecord): Promise<void>;
  get(id: string): Promise<SealedRecord | undefined>;
  delete(id: string): Promise<void>;
}
export interface DeviceKeyProvider {
  assurance: "APPROVED_DEVICE_BOUND";
  unlock(deviceId: string, userId: string): Promise<CryptoKey>;
}
export interface UnlockAttemptStore {
  reserve(scope: string): Promise<string>;
  succeeded(scope: string, attemptId: string): Promise<void>;
}
export function assertOfflineGrant(actor: Actor, grant: OfflineGrant, now: number) {
  const allowed = ["ASSISTED_INTAKE", "CERTIFIED_FIELD_AGENT", "CREDIT_OFFICER"];
  requireControl(actor.active && !actor.roles.includes("MEMBER") && actor.roles.some(role => allowed.includes(role)) && actor.capabilities.includes("OFFLINE_CAPTURE"), "OFFLINE_FORBIDDEN");
  requireControl(grant.registered && grant.deviceId.length > 0 && grant.userId === actor.id && !grant.revoked, "DEVICE_OR_GRANT_INVALID");
  requireControl(Number.isFinite(now) && now >= grant.issuedAt && now < grant.expiresAt, "OFFLINE_SESSION_EXPIRED");
  requireControl(Number.isFinite(grant.issuedAt) && Number.isFinite(grant.expiresAt) && Number.isInteger(grant.failedUnlocks) && grant.failedUnlocks >= 0 && grant.failedUnlocks < 5, "OFFLINE_UNLOCK_LOCKED");
  if (actor.roles.includes("CERTIFIED_FIELD_AGENT")) requireControl(actor.certifiedAgentLevel !== undefined && actor.certifiedAgentLevel >= grant.minimumAgentLevel, "AGENT_NOT_CERTIFIED");
}
export function localTransition(current: LocalState, next: LocalState) {
  requireControl((LOCAL_STATES[current] as readonly string[]).includes(next), "INVALID_LOCAL_TRANSITION");
  return next;
}
export class OfflineVault {
  private key: CryptoKey | undefined;
  private lastActivity = 0;
  private lastSeen = 0;
  private readonly actor: Actor;
  private readonly grant: OfflineGrant;
  private readonly store: EncryptedStore;
  private readonly provider: DeviceKeyProvider;
  private readonly now: () => number;
  private readonly attempts: UnlockAttemptStore | undefined;
  constructor(actor: Actor, grant: OfflineGrant, store: EncryptedStore, provider: DeviceKeyProvider, now = Date.now, attempts?: UnlockAttemptStore) {
    this.actor = structuredClone(actor); this.grant = structuredClone(grant);
    this.store = store; this.provider = provider; this.now = now;
    this.attempts = attempts;
  }
  private check() {
    const now = this.now();
    assertOfflineGrant(this.actor, this.grant, now);
    requireControl(now >= this.lastSeen, "CLOCK_ROLLBACK");
    this.lastSeen = now;
    if (now - this.lastActivity >= 5 * 60 * 1000) this.lock();
    requireControl(this.key, "VAULT_LOCKED");
    this.lastActivity = now;
    return this.key;
  }
  async unlock() {
    this.lock();
    assertOfflineGrant(this.actor, this.grant, this.now());
    requireControl(this.provider.assurance === "APPROVED_DEVICE_BOUND", "SECURE_WRAPPER_REQUIRED");
    requireControl(this.attempts, "PERSISTENT_UNLOCK_CONTROL_REQUIRED");
    requireControl(this.now() >= this.lastSeen, "CLOCK_ROLLBACK");
    const scope = JSON.stringify([this.grant.deviceId, this.actor.id, this.grant.issuedAt]);
    const attemptId = await this.attempts.reserve(scope);
    const key = await this.provider.unlock(this.grant.deviceId, this.actor.id);
    requireControl(!key.extractable && key.algorithm.name === "AES-GCM" && (key.algorithm as AesKeyAlgorithm).length === 256 && key.usages.includes("encrypt") && key.usages.includes("decrypt"), "INVALID_DEVICE_KEY");
    assertOfflineGrant(this.actor, this.grant, this.now());
    requireControl(this.now() >= this.lastSeen, "CLOCK_ROLLBACK");
    await this.attempts.succeeded(scope, attemptId);
    this.key = key; this.lastActivity = this.now(); this.lastSeen = this.lastActivity;
  }
  lock() { this.key = undefined; }
  private aad(localId: string) {
    return new TextEncoder().encode(JSON.stringify([1, this.grant.deviceId, this.actor.id, localId]));
  }
  async save(localId: string, payload: Uint8Array<ArrayBuffer>) {
    const key = this.check();
    requireControl(localId.startsWith("LOCAL-" + this.grant.deviceId + "-"), "INVALID_LOCAL_ID");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.aad(localId) }, key, payload);
    await this.store.put(localId, { version: 1, iv: [...iv], ciphertext: [...new Uint8Array(ciphertext)], localId, deviceId: this.grant.deviceId, userId: this.actor.id });
  }
  async open(localId: string) {
    const key = this.check();
    const record = await this.store.get(localId);
    requireControl(record && record.localId === localId && record.version === 1 && record.deviceId === this.grant.deviceId && record.userId === this.actor.id, "INVALID_SEALED_RECORD");
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv), additionalData: this.aad(localId) }, key, new Uint8Array(record.ciphertext)));
  }
  async clearConfirmed(localId: string, acknowledgement: { confirmed: boolean; allAttachments: boolean; allAuditEvents: boolean }, recoveryUntil: number, immediate = false) {
    this.check();
    requireControl(acknowledgement.confirmed && acknowledgement.allAttachments && acknowledgement.allAuditEvents, "SYNC_NOT_CONFIRMED");
    requireControl(immediate || this.now() >= recoveryUntil, "RECOVERY_WINDOW_ACTIVE");
    await this.store.delete(localId);
  }
}
