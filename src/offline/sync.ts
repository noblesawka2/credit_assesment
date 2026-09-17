import { requireControl } from "../domain/validation.ts";
export interface SyncPayload {
  localId: string; deviceId: string; revision: number; policyVersion: string;
  answers: unknown; attachments: { id: string; checksum: string; bytes: number }[];
  auditEvents: { id: string; clientTime: string; action: string }[];
}
export interface SyncAcknowledgement {
  applicationReference: string; revision: number; receivedAttachmentIds: string[];
  receivedAuditEventIds: string[]; serverTime: string; recalculated: boolean;
  consentRequired: boolean; warnings: string[];
}
export interface SyncTransport {
  refreshAndValidateDevice(deviceId: string): Promise<void>;
  send(payload: SyncPayload): Promise<SyncAcknowledgement>;
}
export async function syncOne(payload: SyncPayload, transport: SyncTransport) {
  requireControl(payload.localId.startsWith("LOCAL-" + payload.deviceId + "-"), "INVALID_LOCAL_ID");
  await transport.refreshAndValidateDevice(payload.deviceId);
  const acknowledgement = await transport.send(structuredClone(payload));
  requireControl(/^NBL-CR-\d{6}-[A-Z0-9]{6}$/.test(acknowledgement.applicationReference), "INVALID_SERVER_REFERENCE");
  requireControl(acknowledgement.recalculated && Number.isFinite(Date.parse(acknowledgement.serverTime)), "SERVER_RECALCULATION_REQUIRED");
  const attachmentsComplete = payload.attachments.every(item => acknowledgement.receivedAttachmentIds.includes(item.id));
  const auditComplete = payload.auditEvents.every(item => acknowledgement.receivedAuditEventIds.includes(item.id));
  return {
    state: attachmentsComplete && auditComplete && !acknowledgement.consentRequired ? "SYNCED" : "SYNC_ERROR",
    acknowledgement, attachmentsComplete, auditComplete
  };
}
export async function checksum(bytes: Uint8Array<ArrayBuffer>) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
}
export async function verifyChunks(chunks: Uint8Array<ArrayBuffer>[], expectedBytes: number, expectedChecksum: string) {
  requireControl(chunks.reduce((sum, chunk) => sum + chunk.length, 0) === expectedBytes, "ATTACHMENT_INCOMPLETE");
  const bytes = new Uint8Array(expectedBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  requireControl(await checksum(bytes) === expectedChecksum, "ATTACHMENT_CHECKSUM_MISMATCH");
  return bytes;
}
