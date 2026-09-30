import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { authorize, ROLES, type Actor, type Role } from "../domain/access.ts";
import { requireControl } from "../domain/validation.ts";
import type { PayloadCipher } from "./encryption.ts";
import type { SupabaseStaffAuth } from "./supabase-auth.ts";

export const INVITABLE_ROLES: readonly Role[] = ROLES.filter(role => role !== "SUPERUSER" && role !== "MEMBER");
export class StaffAdministration {
  private readonly pool: Pool;
  private readonly provider: SupabaseStaffAuth;
  private readonly cipher: PayloadCipher;
  private readonly env: NodeJS.ProcessEnv;
  constructor(pool: Pool, provider: SupabaseStaffAuth, cipher: PayloadCipher, env: NodeJS.ProcessEnv) {
    this.pool = pool; this.provider = provider; this.cipher = cipher; this.env = env;
  }
  private async audit(action: string, correlationId: string, details: unknown, actor?: Actor) {
    const id = randomUUID();
    await this.pool.query("INSERT INTO nobles_security.staff_admin_audit(id,actor_id,source,action,correlation_id,ciphertext) VALUES($1,$2,$3,$4,$5,$6)",
      [id, actor?.id ?? null, actor ? "AUTHENTICATED_SUPERUSER" : "AUTHORIZED_LOCAL_BOOTSTRAP", action, correlationId, this.cipher.seal(details, "staff-admin:" + id)]);
  }
  async directory(actor: Actor) {
    authorize(actor, "STAFF_ADMIN");
    const users = await this.provider.directory();
    const result = users.filter(user => (user.app_metadata as { nobles?: { staff?: boolean } })?.nobles?.staff === true).map(user => {
      const profile = (user.app_metadata as { nobles: Record<string, unknown> }).nobles;
      return { id: user.id, email: user.email, staffId: profile.staffId ?? null,
        roles: Array.isArray(profile.roles) ? profile.roles.filter(role => ROLES.includes(role as Role)) : [],
        active: profile.active === true && !user.deleted_at && (!user.banned_until || Date.parse(String(user.banned_until)) <= Date.now()),
        invitationPending: profile.invitationPending === true, emailConfirmed: Boolean(user.email_confirmed_at) };
    });
    await this.audit("STAFF_DIRECTORY_READ", randomUUID(), { count: result.length }, actor);
    return result;
  }
  private callback(superuser: boolean) {
    requireControl(this.env.STAFF_INVITATIONS_ENABLED === "true", "INVITATIONS_NOT_CONFIGURED");
    const origin = superuser ? this.env.ADMIN_APP_ORIGIN : this.env.STAFF_APP_ORIGIN;
    let parsed: URL;
    try { parsed = new URL(origin ?? ""); } catch { throw new Error("INVITATIONS_NOT_CONFIGURED"); }
    requireControl(parsed.origin === origin && parsed.protocol === "https:" && !["localhost","127.0.0.1","[::1]"].includes(parsed.hostname), "INVITATIONS_NOT_CONFIGURED");
    return origin + "/credit/auth";
  }
  async invite(actor: Actor, body: Record<string, unknown>) {
    authorize(actor, "STAFF_ADMIN");
    requireControl(typeof body.role === "string" && INVITABLE_ROLES.includes(body.role as Role), "FORBIDDEN");
    return this.provision(body.email, body.staffId, [body.role as Role], actor);
  }
  async bootstrapCeo() {
    return this.provision("chinelo.nnazor@gmail.com", "UCHE0001", ["SUPERUSER", "CREDIT_APPROVER"]);
  }
  private async provision(emailValue: unknown, staffIdValue: unknown, roles: Role[], actor?: Actor) {
    requireControl(typeof emailValue === "string" && emailValue.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue), "INVALID_STAFF_EMAIL");
    requireControl(typeof staffIdValue === "string" && /^[A-Z0-9_-]{3,40}$/.test(staffIdValue), "INVALID_STAFF_ID");
    const email = emailValue.toLowerCase();
    const callback = this.callback(roles.includes("SUPERUSER"));
    const users = await this.provider.directory();
    requireControl(!users.some(user => String(user.email).toLowerCase() === email || (user.app_metadata as { nobles?: { staffId?: unknown } })?.nobles?.staffId === staffIdValue), "STAFF_ALREADY_EXISTS_REVIEW_REQUIRED");
    const correlationId = randomUUID();
    const details = { email, staffId: staffIdValue, roles };
    await this.audit("STAFF_INVITE_REQUESTED", correlationId, details, actor);
    try {
      const metadata = { active: true, staff: true, staffId: staffIdValue, roles, invitationPending: true,
        ...(roles.includes("SUPERUSER") ? { approvalAuthority: { dailyLimitKobo: "100000000", timeZone: "Africa/Lagos", productCodes: [], status: "PENDING_POLICY_PUBLICATION" } } : {}) };
      const userId = await this.provider.prepareStaff(email, metadata);
      await this.provider.sendInvitation(email, callback);
      await this.audit("STAFF_INVITE_SENT", correlationId, { ...details, userId }, actor);
      return { message: "Invitation submitted to the email provider. Delivery is not yet confirmed.", userId };
    } catch {
      await this.audit("STAFF_INVITE_FAILED", correlationId, details, actor);
      throw new Error("STAFF_INVITATION_RECONCILIATION_REQUIRED");
    }
  }
  async overview(actor: Actor) {
    authorize(actor, "OVERVIEW");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('nobles.actor_id',$1,true),set_config('nobles.can_overview','true',true)", [actor.id]);
      const result = await client.query("SELECT status,count(*)::integer AS count FROM public.credit_applications GROUP BY status ORDER BY status");
      await client.query("INSERT INTO nobles_security.events(id,action,actor_id,correlation_id) VALUES($1,'OVERVIEW_READ',$2,$3)", [randomUUID(),actor.id,randomUUID()]);
      await client.query("COMMIT");
      return { statuses: result.rows, total: result.rows.reduce((total: number, row: { count: number }) => total + row.count, 0), approvalEnabled: false, dailyApprovalLimitNaira: "1000000", dailyLimitStatus: "PENDING_POLICY_PUBLICATION" };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
