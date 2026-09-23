import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { authorize, type Actor } from "../domain/access.ts";
import { manualVerificationInput, assertManualEvidenceCurrent, type ManualFinding } from "../domain/manual-verification.ts";
import { requireControl } from "../domain/validation.ts";
import type { PayloadCipher } from "./encryption.ts";

export class ManualVerificationRepository {
  private readonly pool: Pool;
  private readonly cipher: PayloadCipher;
  constructor(pool: Pool, cipher: PayloadCipher) { this.pool = pool; this.cipher = cipher; }
  private async transaction<Result>(actor: Actor, operation: (client: PoolClient) => Promise<Result>) {
    authorize(actor, "VERIFY");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('nobles.actor_id',$1,true), set_config('nobles.can_verify','true',true)", [actor.id]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  private async audit(client: PoolClient, actor: Actor, id: string, revision: number, action: string, correlationId: string, newRevision = revision) {
    await client.query("INSERT INTO credit_audit_logs (id,entity_id,actor_id,action,old_revision,new_revision,reason,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [randomUUID(), id, actor.id, action, revision, newRevision, "Assigned officer manual verification; evidence and reasons retained in encrypted revision", correlationId]);
  }
  async list(actor: Actor) {
    return this.transaction(actor, async client => {
      const result = await client.query("SELECT id,reference,status,revision,updated_at FROM credit_applications WHERE $1=ANY(assigned_user_ids) ORDER BY updated_at DESC LIMIT 100", [actor.id]);
      const correlationId = randomUUID();
      for (const row of result.rows) await this.audit(client, actor, row.id, row.revision, "SENSITIVE_ACCESS", correlationId);
      return result.rows;
    });
  }
  async read(actor: Actor, id: string) {
    return this.transaction(actor, async client => {
      const result = await client.query("SELECT * FROM credit_applications WHERE id=$1 AND $2=ANY(assigned_user_ids) FOR SHARE", [id, actor.id]);
      requireControl(result.rowCount === 1, "CASE_NOT_FOUND");
      const row = result.rows[0];
      const records = await client.query("SELECT id,case_revision,ciphertext,created_by,created_at,expires_at FROM credit_manual_verifications WHERE application_id=$1 ORDER BY case_revision DESC LIMIT 100", [id]);
      const time = await client.query("SELECT clock_timestamp() AS now");
      const now = new Date(time.rows[0].now).getTime();
      const verifications = records.rows.map(record => ({ id: record.id, caseRevision: record.case_revision,
        recordedBy: record.created_by, recordedAt: record.created_at,
        current: record.case_revision === row.revision && new Date(record.expires_at).getTime() > now,
        evidence: this.cipher.open(record.ciphertext, "manual-verification:" + record.id) }));
      const answers = this.cipher.open(row.reported_ciphertext, "application:" + id);
      await this.audit(client, actor, id, row.revision, "SENSITIVE_ACCESS", randomUUID());
      return { id, status: row.status, revision: row.revision, answers, verifications, approvalEnabled: false };
    });
  }
  async record(actor: Actor, id: string, body: Record<string, unknown>) {
    authorize(actor, "VERIFY");
    const input = manualVerificationInput(body);
    const hash = createHash("sha256").update(JSON.stringify({ id, ...input })).digest("hex");
    return this.transaction(actor, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,2))", [actor.id + input.idempotencyKey]);
      const current = await client.query("SELECT * FROM credit_applications WHERE id=$1 AND $2=ANY(assigned_user_ids) FOR UPDATE", [id, actor.id]);
      requireControl(current.rowCount === 1, "CASE_NOT_FOUND");
      const row = current.rows[0];
      const previous = await client.query("SELECT id,application_id,case_revision,request_hash FROM credit_manual_verifications WHERE created_by=$1 AND idempotency_key=$2", [actor.id, input.idempotencyKey]);
      if (previous.rowCount) {
        const receipt = previous.rows[0];
        requireControl(receipt.application_id === id && receipt.request_hash === hash, "IDEMPOTENCY_PAYLOAD_CONFLICT");
        return { id: receipt.id, applicationId: id, revision: receipt.case_revision, status: "MANUAL_RECORDED" };
      }
      requireControl(["DRAFT", "DESK_REVIEW", "FIELD_VERIFICATION_PENDING", "RETURNED_TO_CREDIT_OFFICER"].includes(row.status), "VERIFICATION_STAGE_PROHIBITED");
      requireControl(row.revision === input.expectedRevision, "REVISION_CONFLICT");
      const time = await client.query("SELECT clock_timestamp() AS now");
      assertManualEvidenceCurrent(input, new Date(time.rows[0].now).getTime());
      const verificationId = randomUUID();
      const revision = row.revision + 1;
      const expiresAt = new Date(Math.min(...input.findings.map((finding: ManualFinding) => Date.parse(finding.expiresAt))));
      const ciphertext = this.cipher.seal({ source: "MANUAL", reason: input.reason, findings: input.findings }, "manual-verification:" + verificationId);
      await client.query("UPDATE credit_applications SET revision=$2,updated_by=$3,updated_at=clock_timestamp() WHERE id=$1", [id, revision, actor.id]);
      await client.query("INSERT INTO credit_manual_verifications (id,application_id,case_revision,ciphertext,created_by,idempotency_key,request_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [verificationId, id, revision, ciphertext, actor.id, input.idempotencyKey, hash, expiresAt]);
      await this.audit(client, actor, id, row.revision, "MANUAL_VERIFICATION_RECORDED", input.idempotencyKey, revision);
      return { id: verificationId, applicationId: id, revision, status: "MANUAL_RECORDED" };
    });
  }
}
