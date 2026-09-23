import { ROLES, type Actor, type Role } from "../domain/access.ts";
import { DomainError, requireControl } from "../domain/validation.ts";

export interface ProviderSession { accessToken: string; expiresAt: number; actor: Actor }
export interface StaffAuthProvider {
  signIn(email: string, password: string): Promise<ProviderSession>;
  validate(accessToken: string): Promise<Actor>;
  forgotPassword(email: string): Promise<void>;
  recover(email: string, token: string): Promise<ProviderSession>;
  resetPassword(accessToken: string, password: string): Promise<void>;
  signOut(accessToken: string, global: boolean): Promise<void>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function staffActor(user: Record<string, unknown>, now = Date.now()): Actor {
  const metadata = user.app_metadata as { nobles?: { active?: boolean; staff?: boolean; roles?: unknown } } | undefined;
  const roles = metadata?.nobles?.roles;
  requireControl(typeof user.id === "string" && uuid.test(user.id) && !user.deleted_at && !user.is_anonymous, "AUTHENTICATION_FAILED");
  requireControl(!user.banned_until || (typeof user.banned_until === "string" && Date.parse(user.banned_until) <= now), "AUTHENTICATION_FAILED");
  requireControl(Boolean(user.email_confirmed_at) && metadata?.nobles?.active === true && metadata.nobles.staff === true, "AUTHENTICATION_FAILED");
  requireControl(Array.isArray(roles) && roles.length > 0 && roles.every(role => typeof role === "string" && role !== "MEMBER" && ROLES.includes(role as Role)), "AUTHENTICATION_FAILED");
  return { id: user.id, active: true, roles: [...new Set(roles)] as Role[], capabilities: [] };
}

export class SupabaseStaffAuth implements StaffAuthProvider {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly adminKey: string;
  private readonly transport: typeof fetch;
  constructor(env: NodeJS.ProcessEnv, transport: typeof fetch = fetch) {
    requireControl(env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "TLS_VERIFICATION_BYPASS_FORBIDDEN");
    let url: URL;
    try { url = new URL(env.SUPABASE_URL ?? ""); } catch { throw new DomainError("SUPABASE_CONFIGURATION_REQUIRED"); }
    requireControl(url.protocol === "https:" && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname) && url.pathname === "/" && !url.port && !url.username && !url.password && !url.search && !url.hash, "SUPABASE_CONFIGURATION_REQUIRED");
    requireControl(Boolean(env.SUPABASE_ANON_KEY) && Boolean(env.SUPABASE_SERVICE_ROLE_KEY), "SUPABASE_CONFIGURATION_REQUIRED");
    this.base = url.origin + "/auth/v1";
    this.apiKey = env.SUPABASE_ANON_KEY!;
    this.adminKey = env.SUPABASE_SERVICE_ROLE_KEY!;
    this.transport = transport;
  }
  private async call(path: string, method: string, body?: unknown, token?: string, admin = false): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.transport(this.base + path, {
        method, redirect: "error", signal: AbortSignal.timeout(8000),
        headers: { apikey: admin ? this.adminKey : this.apiKey, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { throw new DomainError("AUTH_SERVICE_UNAVAILABLE"); }
    if (response.status >= 500 || response.status === 429) throw new DomainError("AUTH_SERVICE_UNAVAILABLE");
    requireControl(response.ok, "AUTHENTICATION_FAILED");
    if (response.status === 204) return {};
    try { return await response.json() as Record<string, unknown>; } catch { throw new DomainError("AUTH_SERVICE_UNAVAILABLE"); }
  }
  async validate(accessToken: string) {
    const user = await this.call("/user", "GET", undefined, accessToken);
    requireControl(typeof user.id === "string" && uuid.test(user.id), "AUTHENTICATION_FAILED");
    const current = await this.call("/admin/users/" + user.id, "GET", undefined, this.adminKey, true);
    requireControl(current.id === user.id, "AUTHENTICATION_FAILED");
    return staffActor(current);
  }
  private async session(result: Record<string, unknown>): Promise<ProviderSession> {
    requireControl(typeof result.access_token === "string" && typeof result.expires_in === "number" && Number.isFinite(result.expires_in) && result.expires_in > 0, "AUTHENTICATION_FAILED");
    return { accessToken: result.access_token, expiresAt: Date.now() + Math.min(result.expires_in, 3600) * 1000, actor: await this.validate(result.access_token) };
  }
  async signIn(email: string, password: string) { return this.session(await this.call("/token?grant_type=password", "POST", { email, password })); }
  async forgotPassword(email: string) {
    try { await this.call("/recover", "POST", { email }); }
    catch (error) { if (!(error instanceof DomainError) || error.code !== "AUTHENTICATION_FAILED") throw error; }
  }
  async recover(email: string, token: string) { return this.session(await this.call("/verify", "POST", { email, token, type: "recovery" })); }
  async resetPassword(accessToken: string, password: string) { await this.call("/user", "PUT", { password }, accessToken); }
  async signOut(accessToken: string, global: boolean) { await this.call("/logout?scope=" + (global ? "global" : "local"), "POST", undefined, accessToken); }
}
