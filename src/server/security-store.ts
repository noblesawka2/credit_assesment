import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { requireControl } from "../domain/validation.ts";

export const SECURITY_EVENTS = ["LOGIN_SUCCESS", "LOGIN_FAILURE", "SIGN_OUT", "SESSION_REJECTED", "PASSWORD_RESET_REQUESTED", "PASSWORD_RESET_DELIVERY_FAILED", "PASSWORD_RESET_STARTED", "PASSWORD_RESET_SUCCESS", "PASSWORD_RESET_FAILURE", "AUTHORIZATION_DENIED", "RATE_LIMITED", "SENSITIVE_ACCESS"] as const;
export interface SecurityEvent { action: typeof SECURITY_EVENTS[number]; actorId?: string; correlationId: string }
export interface StoredSession { hash: string; actorId: string; ciphertext: string; expiresAt: number; startedAt: number }
export interface SecurityStore {
  clock(): Promise<number>;
  audit(event: SecurityEvent): Promise<void>;
  limit(key: string, maximum: number, seconds: number): Promise<boolean>;
  createSession(session: StoredSession, correlationId: string): Promise<void>;
  session(hash: string): Promise<StoredSession | null>;
  revokeSession(hash: string, correlationId: string): Promise<void>;
  revokeUser(actorId: string): Promise<void>;
}
export class PostgresSecurityStore implements SecurityStore {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async clock() {
    const result = await this.pool.query("SELECT clock_timestamp() AS current_time");
    return new Date(result.rows[0].current_time).getTime();
  }
  private async append(client: Pick<PoolClient, "query">, event: SecurityEvent) {
    requireControl(SECURITY_EVENTS.includes(event.action), "INVALID_AUDIT_EVENT");
    await client.query("INSERT INTO nobles_security.events (id,action,actor_id,correlation_id) VALUES ($1,$2,$3,$4)", [randomUUID(), event.action, event.actorId ?? null, event.correlationId]);
  }
  async audit(event: SecurityEvent) { await this.append(this.pool, event); }
  async limit(key: string, maximum: number, seconds: number) {
    const result = await this.pool.query("INSERT INTO nobles_security.rate_limits (key,hits,expires_at) VALUES ($1,1,clock_timestamp()+($2 * interval '1 second')) ON CONFLICT (key) DO UPDATE SET hits=CASE WHEN nobles_security.rate_limits.expires_at <= clock_timestamp() THEN 1 ELSE LEAST(nobles_security.rate_limits.hits+1,2147483647) END, expires_at=CASE WHEN nobles_security.rate_limits.expires_at <= clock_timestamp() THEN clock_timestamp()+($2 * interval '1 second') ELSE nobles_security.rate_limits.expires_at END RETURNING hits", [key, seconds]);
    return result.rows[0].hits <= maximum;
  }
  async createSession(session: StoredSession, correlationId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [session.actorId]);
      const revoked = await client.query("SELECT 1 FROM nobles_security.revocations WHERE actor_id=$1 AND revoked_at >= $2", [session.actorId, new Date(session.startedAt)]);
      requireControl(revoked.rowCount === 0, "AUTHENTICATION_FAILED");
      await client.query("INSERT INTO nobles_security.sessions (hash,actor_id,ciphertext,expires_at,started_at) VALUES ($1,$2,$3,$4,$5)", [session.hash, session.actorId, session.ciphertext, new Date(session.expiresAt), new Date(session.startedAt)]);
      await this.append(client, { action: "LOGIN_SUCCESS", actorId: session.actorId, correlationId });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async session(hash: string) {
    const result = await this.pool.query("SELECT hash,actor_id,ciphertext,expires_at,started_at FROM nobles_security.sessions WHERE hash=$1 AND revoked_at IS NULL AND expires_at > clock_timestamp()", [hash]);
    const row = result.rows[0];
    return row ? { hash: row.hash, actorId: row.actor_id, ciphertext: row.ciphertext, expiresAt: new Date(row.expires_at).getTime(), startedAt: new Date(row.started_at).getTime() } : null;
  }
  async revokeSession(hash: string, correlationId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("UPDATE nobles_security.sessions SET revoked_at=clock_timestamp() WHERE hash=$1 AND revoked_at IS NULL RETURNING actor_id", [hash]);
      await this.append(client, { action: "SIGN_OUT", actorId: result.rows[0]?.actor_id, correlationId });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async revokeUser(actorId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [actorId]);
      await client.query("INSERT INTO nobles_security.revocations (actor_id,revoked_at) VALUES ($1,clock_timestamp()) ON CONFLICT (actor_id) DO UPDATE SET revoked_at=clock_timestamp()", [actorId]);
      await client.query("UPDATE nobles_security.sessions SET revoked_at=clock_timestamp() WHERE actor_id=$1 AND revoked_at IS NULL", [actorId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
