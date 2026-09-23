import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.ts";
import { StaffAuthentication } from "../src/server/staff-auth.ts";
import { staffActor, SupabaseStaffAuth, type StaffAuthProvider } from "../src/server/supabase-auth.ts";
import type { SecurityEvent, SecurityStore, StoredSession } from "../src/server/security-store.ts";
import { PayloadCipher } from "../src/server/encryption.ts";
import { applicationEnvironment } from "../src/server/environment.ts";
import { DomainError } from "../src/domain/validation.ts";

const userId = "01900000-0000-7000-8000-000000000001";
const user = { id: userId, email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { nobles: { active: true, staff: true, roles: ["CREDIT_OFFICER"] } } };
const key = "12".repeat(32);
function fixture(origin = "http://localhost:3100") {
  const sessions = new Map<string, StoredSession>();
  const events: SecurityEvent[] = [];
  const counts = new Map<string, number>();
  const revoked = new Map<string, number>();
  let clock = Date.now();
  const state = { disabled: false, expired: false, invalidRecovery: false, validations: 0, resets: 0, unavailable: false, auditUnavailable: false };
  const store: SecurityStore = {
    async clock() { return ++clock; },
    async audit(event) { if (state.auditUnavailable) throw new Error("SYNTHETIC_STORAGE_FAILURE"); events.push(structuredClone(event)); },
    async limit(rateKey, maximum) { const count = (counts.get(rateKey) ?? 0) + 1; counts.set(rateKey, count); return count <= maximum; },
    async createSession(session, correlationId) { if ((revoked.get(session.actorId) ?? 0) >= session.startedAt) throw new DomainError("AUTHENTICATION_FAILED"); await this.audit({ action: "LOGIN_SUCCESS", actorId: session.actorId, correlationId }); sessions.set(session.hash, structuredClone(session)); },
    async session(hash) { const row = sessions.get(hash); return row && row.expiresAt > Date.now() ? structuredClone(row) : null; },
    async revokeSession(hash, correlationId) { sessions.delete(hash); await this.audit({ action: "SIGN_OUT", correlationId }); },
    async revokeUser(actorId) { revoked.set(actorId, ++clock); for (const [hash, row] of sessions) if (row.actorId === actorId) sessions.delete(hash); }
  };
  const provider: StaffAuthProvider = {
    async signIn(_email, password) {
      if (password !== "synthetic-valid-password" || state.disabled) throw new DomainError("AUTHENTICATION_FAILED");
      return { accessToken: "SYNTHETIC_PROVIDER_TOKEN", actor: staffActor(user), expiresAt: Date.now() + (state.expired ? -1 : 60000) };
    },
    async validate() {
      state.validations++;
      if (state.unavailable) throw new DomainError("AUTH_SERVICE_UNAVAILABLE");
      if (state.disabled) throw new DomainError("AUTHENTICATION_FAILED");
      return staffActor(user);
    },
    async forgotPassword() {},
    async recover() { if (state.invalidRecovery) throw new DomainError("AUTHENTICATION_FAILED"); return this.signIn("", "synthetic-valid-password"); },
    async resetPassword() { state.resets++; },
    async signOut() {}
  };
  const auth = new StaffAuthentication(provider, store, new PayloadCipher(key), origin, key);
  const request = (cookie = "") => ({ headers: { cookie }, socket: { remoteAddress: "127.0.0.1" } }) as IncomingMessage;
  let cookie = "";
  const response = { setHeader(_name: string, value: string) { cookie = value; } } as ServerResponse;
  const login = async () => {
    await auth.handle("sign-in", { email: "staff@example.test", password: "synthetic-valid-password" }, request(), response);
    return cookie.split(";")[0];
  };
  return { auth, provider, store, state, events, sessions, request, response, login, cookie: () => cookie };
}

test("staff identity accepts only server-controlled approved existing roles", () => {
  assert.deepEqual(staffActor(user).roles, ["CREDIT_OFFICER"]);
  assert.throws(() => staffActor({ ...user, app_metadata: {}, user_metadata: user.app_metadata }), /AUTHENTICATION_FAILED/);
  for (const roles of [["ADMIN"], ["MEMBER"], ["MEMBER", "CREDIT_OFFICER"], []]) assert.throws(() => staffActor({ ...user, app_metadata: { nobles: { active: true, staff: true, roles } } }), /AUTHENTICATION_FAILED/);
  assert.throws(() => staffActor({ ...user, banned_until: "2099-01-01T00:00:00Z" }), /AUTHENTICATION_FAILED/);
  assert.throws(() => staffActor({ ...user, deleted_at: "2026-01-01" }), /AUTHENTICATION_FAILED/);
  assert.throws(() => staffActor({ ...user, app_metadata: { nobles: { ...user.app_metadata.nobles, active: false } } }), /AUTHENTICATION_FAILED/);
});
test("local and production origins remain separate without TLS bypass", () => {
  assert.equal(applicationEnvironment({ APP_ORIGIN: "http://localhost:3100" }).origin, "http://localhost:3100");
  assert.throws(() => applicationEnvironment({ APP_ORIGIN: "https://future.example" }), /ENVIRONMENT_MISMATCH/);
  assert.throws(() => applicationEnvironment({ NODE_ENV: "production", APP_ORIGIN: "http://localhost:3100" }), /ENVIRONMENT_MISMATCH/);
  assert.throws(() => applicationEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }), /TLS_VERIFICATION/);
  assert.throws(() => applicationEnvironment({ DATABASE_URL: "present", DATA_ENCRYPTION_KEY: "invalid" }), /DATA_ENCRYPTION_KEY/);
});
test("sign-in stores encrypted provider token and hash, never credentials in audit", async () => {
  const setup = fixture("https://credit.example.test");
  const cookie = await setup.login();
  assert.match(setup.cookie(), /__Host-nobles-session=.*HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  assert.ok(!JSON.stringify([...setup.sessions.values()]).includes("SYNTHETIC_PROVIDER_TOKEN"));
  assert.ok(!JSON.stringify(setup.events).includes("password"));
  assert.equal((await setup.auth.authenticate(setup.request(cookie)))?.id, userId);
  await setup.auth.authenticate(setup.request(cookie));
  assert.equal(setup.state.validations, 2);
  assert.equal(await setup.auth.authenticate(setup.request(cookie + "; " + cookie)), null);
});
test("sign-out revokes stored session; copied cookies cannot be replayed", async () => {
  const setup = fixture(); const cookie = await setup.login();
  await setup.auth.handle("sign-out", {}, setup.request(cookie), setup.response);
  assert.match(setup.cookie(), /Max-Age=0/);
  assert.equal(await setup.auth.authenticate(setup.request(cookie)), null);
});
test("expired, disabled and unavailable sessions fail closed on each protected request", async () => {
  const setup = fixture(); const cookie = await setup.login();
  setup.state.unavailable = true;
  await assert.rejects(setup.auth.authenticate(setup.request(cookie)), /AUTH_SERVICE_UNAVAILABLE/);
  setup.state.unavailable = false; setup.state.disabled = true;
  assert.equal(await setup.auth.authenticate(setup.request(cookie)), null);
  assert.equal(setup.sessions.size, 0);
  setup.state.disabled = false;
  const nextCookie = await setup.login();
  for (const row of setup.sessions.values()) row.expiresAt = Date.now() - 1;
  assert.equal(await setup.auth.authenticate(setup.request(nextCookie)), null);
});
test("login failure and unknown account recovery responses do not enumerate users", async () => {
  const setup = fixture();
  for (const email of ["staff@example.test", "unknown@example.test"]) {
    await assert.rejects(setup.auth.handle("sign-in", { email, password: "wrong" }, setup.request(), setup.response), /AUTHENTICATION_FAILED/);
  }
  const existing = await setup.auth.handle("forgot-password", { email: "staff@example.test" }, setup.request(), setup.response);
  const absent = await setup.auth.handle("forgot-password", { email: "unknown@example.test" }, setup.request(), setup.response);
  assert.deepEqual(existing, absent);
  assert.equal(setup.events.filter(event => event.action === "LOGIN_FAILURE").length, 2);
});
test("invalid/expired recovery cannot reset; successful reset revokes every local session", async () => {
  const setup = fixture(); const first = await setup.login(); const second = await setup.login();
  const body = { email: "staff@example.test", token: "123456", password: "new-synthetic-password" };
  setup.state.invalidRecovery = true;
  await assert.rejects(setup.auth.handle("reset-password", body, setup.request(), setup.response), /RESET_INVALID_OR_EXPIRED/);
  assert.equal(setup.state.resets, 0);
  setup.state.invalidRecovery = false;
  await setup.auth.handle("reset-password", body, setup.request(), setup.response);
  assert.equal(setup.state.resets, 1);
  assert.equal(await setup.auth.authenticate(setup.request(first)), null);
  assert.equal(await setup.auth.authenticate(setup.request(second)), null);
  assert.ok(setup.events.some(event => event.action === "PASSWORD_RESET_SUCCESS"));
  assert.ok(!JSON.stringify(setup.events).includes("123456"));
});
test("rate limiting shares storage across instances and audit failure prevents login", async () => {
  const setup = fixture();
  for (let index = 0; index < 10; index++) await setup.auth.rateLimit(setup.request(), "sign-in", "staff@example.test");
  const restarted = new StaffAuthentication(setup.provider, setup.store, new PayloadCipher(key), "http://localhost:3100", key);
  await assert.rejects(restarted.rateLimit(setup.request(), "sign-in", "staff@example.test"), /RATE_LIMITED/);
  setup.state.auditUnavailable = true;
  await assert.rejects(setup.login());
  assert.equal(setup.sessions.size, 0);
});
test("a sign-in already in flight cannot recreate a session after account-wide revocation", async () => {
  const setup = fixture();
  const original = setup.provider.signIn.bind(setup.provider);
  setup.provider.signIn = async (email, password) => {
    const session = await original(email, password);
    await setup.store.revokeUser(session.actor.id);
    return session;
  };
  await assert.rejects(setup.login(), /AUTHENTICATION_FAILED/);
  assert.equal(setup.sessions.size, 0);
});
test("recovery delivery failure remains account-neutral and is audited", async () => {
  const setup = fixture();
  const accepted = await setup.auth.handle("forgot-password", { email: "first@example.test" }, setup.request(), setup.response);
  setup.provider.forgotPassword = async () => { throw new DomainError("AUTH_SERVICE_UNAVAILABLE"); };
  const failed = await setup.auth.handle("forgot-password", { email: "second@example.test" }, setup.request(), setup.response);
  assert.deepEqual(accepted, failed);
  assert.ok(setup.events.some(event => event.action === "PASSWORD_RESET_DELIVERY_FAILED"));
});
test("Supabase uses documented recovery type, verified user and current admin account", async () => {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.protocol, "https:"); assert.equal(init?.redirect, "error");
    calls.push({ path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.pathname.endsWith("/verify") || url.pathname.endsWith("/token")) return Response.json({ access_token: "SYNTHETIC_TOKEN", expires_in: 3600 });
    if (url.pathname.endsWith("/user") || url.pathname.includes("/admin/users/")) return Response.json(user);
    return Response.json({});
  };
  const provider = new SupabaseStaffAuth({ SUPABASE_URL: "https://testproject.supabase.co", SUPABASE_ANON_KEY: "synthetic", SUPABASE_SERVICE_ROLE_KEY: "synthetic-admin" }, transport);
  await provider.recover("staff@example.test", "123456");
  assert.equal(calls[0].body?.type, "recovery");
  assert.equal(calls[1].path, "/auth/v1/user");
  assert.equal(calls[2].path, "/auth/v1/admin/users/" + userId);
  assert.throws(() => new SupabaseStaffAuth({ SUPABASE_URL: "http://testproject.supabase.co" }, transport), /CONFIGURATION/);
});
test("HTTP authentication routes enforce CSRF, safe errors, no registration and server permissions", async () => {
  const setup = fixture();
  const options = { origin: "http://localhost:3100", staffAuth: setup.auth };
  const server = createApp(options);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  options.origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const post = (path: string, body: unknown, origin = options.origin) => fetch(options.origin + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const data = { email: "staff@example.test", password: "synthetic-valid-password", roles: ["CREDIT_APPROVER"] };
    assert.equal((await post("/api/auth/sign-in", data, "https://other.example")).status, 403);
    assert.equal((await post("/api/auth/register", data)).status, 404);
    const response = await post("/api/auth/sign-in", data);
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const session = await fetch(options.origin + "/api/session", { headers: { Cookie: cookie } });
    assert.deepEqual((await session.json()).roles, ["CREDIT_OFFICER"]);
    assert.equal((await fetch(options.origin + "/api/drafts", { headers: { Cookie: cookie } })).status, 403);
    setup.state.disabled = true;
    assert.equal((await fetch(options.origin + "/api/session", { headers: { Cookie: cookie } })).status, 401);
    assert.ok(setup.events.some(event => event.action === "AUTHORIZATION_DENIED"));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
