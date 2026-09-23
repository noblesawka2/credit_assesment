import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Actor } from "../domain/access.ts";
import { DomainError, requireControl } from "../domain/validation.ts";
import type { IdentityAdapter } from "./identity.ts";
import type { PayloadCipher } from "./encryption.ts";
import type { StaffAuthProvider } from "./supabase-auth.ts";
import type { SecurityStore, SecurityEvent } from "./security-store.ts";

export class StaffAuthentication implements IdentityAdapter {
  private readonly provider: StaffAuthProvider;
  private readonly store: SecurityStore;
  private readonly cipher: PayloadCipher;
  private readonly rateKey: Buffer;
  private readonly secure: boolean;
  constructor(provider: StaffAuthProvider, store: SecurityStore, cipher: PayloadCipher, origin: string, key: string) {
    this.provider = provider; this.store = store; this.cipher = cipher;
    this.secure = new URL(origin).protocol === "https:";
    this.rateKey = createHmac("sha256", Buffer.from(key, "hex")).update("nobles-rate-limit-v1").digest();
  }
  private cookieName() { return this.secure ? "__Host-nobles-session" : "nobles-local-session"; }
  private sessionHash(request: IncomingMessage) {
    const matches = (request.headers.cookie ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(this.cookieName() + "="));
    if (matches.length !== 1) return null;
    const value = matches[0].slice(this.cookieName().length + 1);
    return /^[a-f0-9]{64}$/.test(value) ? createHash("sha256").update(value).digest("hex") : null;
  }
  clearCookie(response: ServerResponse) { this.cookie(response, "", 0); }
  private cookie(response: ServerResponse, value: string, seconds: number) {
    response.setHeader("Set-Cookie", this.cookieName() + "=" + value + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + seconds + (this.secure ? "; Secure" : ""));
  }
  async audit(action: SecurityEvent["action"], actor?: Actor) { await this.store.audit({ action, actorId: actor?.id, correlationId: randomUUID() }); }
  async rateLimit(request: IncomingMessage, category: string, account?: string) {
    const address = request.socket.remoteAddress ?? "unknown";
    const dimensions = [{ value: "ip:" + address, limit: category === "api" ? 120 : 30 }];
    if (account) dimensions.push({ value: "account:" + account.trim().toLowerCase(), limit: category === "sign-in" ? 10 : 5 });
    for (const dimension of dimensions) {
      const key = createHmac("sha256", this.rateKey).update(category + ":" + dimension.value).digest("hex");
      if (!await this.store.limit(key, dimension.limit, category === "api" ? 60 : 900)) {
        await this.audit("RATE_LIMITED");
        throw new DomainError("RATE_LIMITED");
      }
    }
  }
  async authenticate(request: IncomingMessage): Promise<Actor | null> {
    const hash = this.sessionHash(request);
    if (!hash) return null;
    const session = await this.store.session(hash);
    if (!session || session.expiresAt <= Date.now()) { await this.audit("SESSION_REJECTED"); return null; }
    try {
      const value = this.cipher.open(session.ciphertext, "session:" + hash) as { accessToken: string };
      const actor = await this.provider.validate(value.accessToken);
      requireControl(actor.id === session.actorId && actor.active, "AUTHENTICATION_FAILED");
      if (!await this.store.session(hash)) return null;
      return actor;
    } catch (error) {
      if (error instanceof DomainError && error.code === "AUTHENTICATION_FAILED") {
        await this.store.revokeUser(session.actorId); await this.audit("SESSION_REJECTED"); return null;
      }
      throw new DomainError("AUTH_SERVICE_UNAVAILABLE");
    }
  }
  private email(value: unknown) {
    requireControl(typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "AUTHENTICATION_FAILED");
    return value.trim().toLowerCase();
  }
  private password(value: unknown, reset = false) {
    requireControl(typeof value === "string" && value.length >= (reset ? 12 : 1) && value.length <= 1024, "AUTHENTICATION_FAILED");
    return value;
  }
  async handle(path: string, body: Record<string, unknown>, request: IncomingMessage, response: ServerResponse) {
    const correlationId = randomUUID();
    if (path === "sign-out") {
      const hash = this.sessionHash(request);
      this.clearCookie(response);
      if (hash) {
        const session = await this.store.session(hash);
        await this.store.revokeSession(hash, correlationId);
        if (session) {
          const value = this.cipher.open(session.ciphertext, "session:" + hash) as { accessToken: string };
          await this.provider.signOut(value.accessToken, false);
        }
      }
      return { message: "Signed out." };
    }
    if (path === "sign-in") {
      try {
        const email = this.email(body.email);
        await this.rateLimit(request, path, email);
        const startedAt = await this.store.clock();
        const session = await this.provider.signIn(email, this.password(body.password));
        requireControl(session.actor.active && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now(), "AUTHENTICATION_FAILED");
        const value = randomBytes(32).toString("hex");
        const hash = createHash("sha256").update(value).digest("hex");
        const previous = this.sessionHash(request);
        if (previous) await this.store.revokeSession(previous, correlationId);
        await this.store.createSession({ hash, actorId: session.actor.id, expiresAt: session.expiresAt, startedAt, ciphertext: this.cipher.seal({ accessToken: session.accessToken }, "session:" + hash) }, correlationId);
        this.cookie(response, value, Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)));
        return { message: "Signed in.", expiresAt: new Date(session.expiresAt).toISOString() };
      } catch (error) {
        await this.audit("LOGIN_FAILURE");
        if (error instanceof DomainError && ["RATE_LIMITED", "AUTH_SERVICE_UNAVAILABLE"].includes(error.code)) throw error;
        throw new DomainError(error instanceof DomainError && error.code === "AUTHENTICATION_FAILED" ? "AUTHENTICATION_FAILED" : "AUTH_SERVICE_UNAVAILABLE");
      }
    }
    if (path === "forgot-password") {
      const email = this.email(body.email);
      await this.rateLimit(request, path, email);
      await this.audit("PASSWORD_RESET_REQUESTED");
      try { await this.provider.forgotPassword(email); }
      catch { await this.audit("PASSWORD_RESET_DELIVERY_FAILED"); }
      return { message: "If the account is eligible, password reset instructions will be sent." };
    }
    if (path === "reset-password") {
      try {
        const email = this.email(body.email);
        await this.rateLimit(request, path, email);
        const password = this.password(body.password, true);
        requireControl(typeof body.token === "string" && /^[0-9]{6,10}$/.test(body.token), "AUTHENTICATION_FAILED");
        const session = await this.provider.recover(email, body.token);
        await this.audit("PASSWORD_RESET_STARTED", session.actor);
        await this.store.revokeUser(session.actor.id);
        await this.provider.resetPassword(session.accessToken, password);
        await this.provider.signOut(session.accessToken, true);
        await this.store.revokeUser(session.actor.id);
        await this.audit("PASSWORD_RESET_SUCCESS", session.actor);
        this.clearCookie(response);
        return { message: "Password changed. Sign in again." };
      } catch (error) {
        await this.audit("PASSWORD_RESET_FAILURE");
        if (error instanceof DomainError && ["RATE_LIMITED", "AUTH_SERVICE_UNAVAILABLE"].includes(error.code)) throw error;
        throw new DomainError(error instanceof DomainError && error.code === "AUTHENTICATION_FAILED" ? "RESET_INVALID_OR_EXPIRED" : "AUTH_SERVICE_UNAVAILABLE");
      }
    }
    throw new DomainError("AUTH_ROUTE_NOT_FOUND");
  }
}
