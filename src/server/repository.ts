import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Actor } from "../domain/access.ts";
import { authorize } from "../domain/access.ts";
import { money, requireControl } from "../domain/validation.ts";
import type { PayloadCipher } from "./encryption.ts";
export class DraftRepository {
  private readonly pool: Pool;
  private readonly cipher: PayloadCipher;
  constructor(pool: Pool, cipher: PayloadCipher) { this.pool = pool; this.cipher = cipher; }
  async list(actor: Actor) {
    authorize(actor, "CAPTURE");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('nobles.actor_id', $1, true)", [actor.id]);
      const result = await client.query("SELECT id, reference, status, revision, requested_amount_kobo, updated_at FROM credit_applications ORDER BY updated_at DESC LIMIT 100");
      await client.query("COMMIT");
      return result.rows;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async save(actor: Actor, externalMemberId: string, body: { id?: string; revision?: number; answers: unknown; requestedAmountKobo: string; idempotencyKey: string }) {
    authorize(actor, "CAPTURE");
    if (actor.roles.includes("MEMBER")) requireControl(actor.externalMemberId === externalMemberId, "FORBIDDEN");
    money(body.requestedAmountKobo);
    const client = await this.pool.connect();
    const hash = createHash("sha256").update(JSON.stringify({ externalMemberId, ...body })).digest("hex");
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('nobles.actor_id', $1, true)", [actor.id]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [actor.id + body.idempotencyKey]);
      const previous = await client.query("SELECT * FROM credit_idempotency WHERE actor_id = $1 AND key = $2", [actor.id, body.idempotencyKey]);
      if (previous.rowCount) {
        requireControl(previous.rows[0].request_hash === hash, "IDEMPOTENCY_PAYLOAD_CONFLICT");
        const receipt = await client.query("SELECT id, reference, status, revision FROM credit_applications WHERE id = $1", [previous.rows[0].application_id]);
        await client.query("COMMIT");
        return receipt.rows[0];
      }
      const id = body.id ?? randomUUID();
      const ciphertext = this.cipher.seal(body.answers, "application:" + id);
      let oldRevision: number | null = null;
      if (body.id) {
        const current = await client.query("SELECT * FROM credit_applications WHERE id = $1 FOR UPDATE", [id]);
        requireControl(current.rowCount === 1, "CASE_NOT_FOUND");
        const row = current.rows[0];
        requireControl(row.external_member_id === externalMemberId, "MEMBER_MISMATCH");
        requireControl(row.status === "DRAFT" && row.submitted_at === null, "ORIGINAL_ANSWERS_IMMUTABLE");
        requireControl(row.revision === body.revision, "REVISION_CONFLICT");
        oldRevision = row.revision;
        await client.query("UPDATE credit_applications SET reported_ciphertext=$2, requested_amount_kobo=$3, revision=revision+1, updated_by=$4, updated_at=now() WHERE id=$1", [id, ciphertext, body.requestedAmountKobo, actor.id]);
      } else {
        await client.query("INSERT INTO credit_applications (id, external_member_id, created_by, updated_by, assigned_user_ids, reported_ciphertext, requested_amount_kobo) VALUES ($1,$2,$3,$3,ARRAY[$3]::uuid[],$4,$5)", [id, externalMemberId, actor.id, ciphertext, body.requestedAmountKobo]);
      }
      const revision = (oldRevision ?? 0) + 1;
      await client.query("INSERT INTO credit_audit_logs (id,entity_id,actor_id,action,old_revision,new_revision,reason,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), id, actor.id, body.id ? "DRAFT_UPDATED" : "DRAFT_CREATED", oldRevision, revision, "Member or assisted draft capture", body.idempotencyKey]);
      await client.query("INSERT INTO credit_idempotency (actor_id,key,request_hash,application_id) VALUES ($1,$2,$3,$4)", [actor.id, body.idempotencyKey, hash, id]);
      await client.query("COMMIT");
      return { id, reference: null, status: "DRAFT", revision };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
