import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { clientAddressResolver } from "../src/server/proxy.ts";
import { runtimePoolSettings } from "../src/server/pool-config.ts";
import { backendHealth } from "../src/server/health.ts";
import { createRuntime } from "../src/server/runtime.ts";
import { createVercelHandler } from "../src/server/vercel.ts";
import { applicationEnvironment } from "../src/server/environment.ts";
import { StaffAuthentication } from "../src/server/staff-auth.ts";
import { PayloadCipher } from "../src/server/encryption.ts";
import type { SecurityStore } from "../src/server/security-store.ts";
import type { StaffAuthProvider } from "../src/server/supabase-auth.ts";
import { hostingEnvironment, hostingPool } from "./hosting-fixtures.ts";

const request = (headers: Record<string, string | string[]> = {}, rawHeaders: string[] = []) => ({ headers, rawHeaders, socket: { remoteAddress: "192.0.2.1" } }) as IncomingMessage;

test("proxy identity trusts only validated platform ingress, never arbitrary forwarding chains", () => {
  const local = clientAddressResolver({});
  assert.throws(() => local({ headers: {}, socket: {} } as IncomingMessage), /INVALID_CLIENT_ADDRESS/);
  assert.equal(local(request({ "x-forwarded-for": "203.0.113.1", "x-vercel-forwarded-for": "203.0.113.2", "x-vercel-id": "spoof" })), "192.0.2.1");
  assert.throws(() => clientAddressResolver({ TRUSTED_PROXY: "vercel" }), /VERCEL_PROXY_RUNTIME_REQUIRED/);
  assert.throws(() => clientAddressResolver({ ...hostingEnvironment("staff"), TRUSTED_PROXY: "none" }), /VERCEL_PROXY_REQUIRED/);
  const hosted = clientAddressResolver(hostingEnvironment("staff"));
  assert.equal(hosted(request({ "x-vercel-forwarded-for": "203.0.113.2", "x-forwarded-for": "attacker" })), "203.0.113.2");
  assert.equal(hosted(request({ "x-vercel-forwarded-for": "2001:0db8:0:0:0:0:0:1" })), hosted(request({ "x-vercel-forwarded-for": "2001:db8::1" })));
  for (const invalid of [undefined, "", " 203.0.113.1", "203.0.113.1, 203.0.113.2", "203.0.113.1:80", "not-an-ip", ["203.0.113.1"]]) {
    assert.throws(() => hosted(request(invalid === undefined ? {} : { "x-vercel-forwarded-for": invalid })), /INVALID_PROXY_ADDRESS/);
  }
  assert.throws(() => hosted(request({ "x-vercel-forwarded-for": "203.0.113.1" }, ["X-Vercel-Forwarded-For", "203.0.113.1", "x-vercel-forwarded-for", "203.0.113.1"])), /INVALID_PROXY_ADDRESS/);
});

test("shared rate-limit keys use platform client identity and ignore spoofed ordinary headers", async () => {
  const keys: string[] = [];
  const store = { async limit(key: string) { keys.push(key); return true; } } as unknown as SecurityStore;
  const key = "12".repeat(32);
  const auth = new StaffAuthentication({} as StaffAuthProvider, store, new PayloadCipher(key), "https://staff.example.test", key, "staff", clientAddressResolver(hostingEnvironment("staff")));
  await auth.rateLimit(request({ "x-vercel-forwarded-for": "203.0.113.1", "x-forwarded-for": "first" }), "api");
  await auth.rateLimit(request({ "x-vercel-forwarded-for": "203.0.113.1", "x-forwarded-for": "second" }), "api");
  await auth.rateLimit(request({ "x-vercel-forwarded-for": "203.0.113.2" }), "api");
  assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2]);
  await assert.rejects(auth.rateLimit(request(), "api"), /INVALID_PROXY_ADDRESS/);
  assert.equal(keys.length, 3);
});

test("pool settings bound each instance and validate the combined two-project budget", () => {
  const env = hostingEnvironment("staff");
  assert.equal(runtimePoolSettings(env).max, 2);
  assert.equal(runtimePoolSettings({}).idleTimeoutMillis, 5000);
  for (const name of ["DATABASE_CONNECTION_BUDGET", "DATABASE_RESERVED_CONNECTIONS", "DATABASE_STAFF_MAX_INSTANCES", "DATABASE_ADMIN_MAX_INSTANCES"]) {
    assert.throws(() => runtimePoolSettings({ ...env, [name]: undefined }));
  }
  assert.throws(() => runtimePoolSettings({ ...env, DATABASE_CONNECTION_BUDGET: "9" }), /DATABASE_COMBINED_BUDGET_EXCEEDED/);
  for (const value of ["0", "-1", "11", "NaN", "1.5", "", " 2"]) assert.throws(() => runtimePoolSettings({ ...env, DATABASE_POOL_MAX: value }));
  assert.throws(() => applicationEnvironment({ ...env, ADMIN_APP_ORIGIN: env.STAFF_APP_ORIGIN }), /PORTAL_ORIGINS_MUST_DIFFER/);
});

test("health probes coalesce, cache, recover and never queue unbounded timed-out work", async () => {
  let probes = 0;
  let finish: (() => void) | undefined;
  const check = backendHealth(() => { probes++; return new Promise<void>(resolve => { finish = resolve; }); }, 15, 0);
  assert.deepEqual(await Promise.all([check(), check(), check()]), [false, false, false]);
  assert.equal(await check(), false); assert.equal(probes, 1);
  finish!(); await new Promise(resolve => setTimeout(resolve, 0));
  const recovered = check(); await Promise.resolve(); finish!(); assert.equal(await recovered, true);
  let count = 0;
  const cached = backendHealth(async () => { count++; }, 50, 1000);
  assert.deepEqual(await Promise.all([cached(), cached()]), [true, true]);
  assert.equal(await cached(), true); assert.equal(count, 1);
  assert.equal(await backendHealth(async () => { throw new Error("SYNTHETIC_PRIVATE_ERROR"); })(), false);
});

for (const surface of ["staff", "administration"] as const) test(surface + " Vercel handler serves auth, health and the correct root through the existing runtime", async () => {
  const env = hostingEnvironment(surface);
  const { pool, state } = hostingPool();
  let initializes = 0;
  let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
  const handler = createVercelHandler(async () => { initializes++; runtime = await createRuntime(env, () => pool); return runtime; }, env);
  const server = createServer(handler); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const get = (pathname: string) => fetch(origin + pathname, { headers: { "x-vercel-forwarded-for": "192.0.2.15" } });
  try {
    const responses = await Promise.all([get("/credit/auth"), get("/api/health"), get("/")]);
    assert.ok(responses.every(response => response.status === 200)); assert.equal(initializes, 1);
    assert.equal(state.listeners.filter(event => event === "release").length, 1);
    assert.match(await responses[0].text(), /auth.js/);
    assert.equal(responses[0].headers.get("cache-control"), "no-store");
    assert.match(responses[0].headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    const health = await responses[1].json(); assert.equal(health.status, "AVAILABLE"); assert.equal(health.surface, surface); assert.equal(health.productionReady, false);
    assert.doesNotMatch(JSON.stringify(health), /SYNTHETIC|database|supabase|certificate|key|roles/i);
    assert.match(await responses[2].text(), surface === "administration" ? /CEO administration/ : /app.js/);
    assert.ok(state.queries.every(sql => sql.startsWith("SELECT")));
    assert.equal(state.queries.filter(sql => sql === "SELECT 1").length, 1);
    for (const pathname of ["/.env", "/certs/test.crt", "/src/server/runtime.js", "/node_modules/pg/package.json", "/config/supabase-invite.html"]) assert.equal((await get(pathname)).status, 404);
    assert.equal((await get("/credit/admin")).status, surface === "staff" ? 404 : 200);
    for (const pathname of ["/api/session", "/api/admin/overview", "/api/drafts", "/api/readiness/config"]) assert.equal((await get(pathname)).status, 401);
    assert.equal((await fetch(origin + "/api/auth/sign-in", { method: "POST", headers: { Origin: "https://attacker.invalid" } })).status, 403);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await runtime?.close(); }
  assert.equal(state.closes, 1);
});

test("startup failure closes the pool and the adapter responds safely with bounded retries", async () => {
  const env = hostingEnvironment("staff"); const { pool, state } = hostingPool(); state.unsafe = true;
  await assert.rejects(createRuntime(env, () => pool), /RLS_BYPASS_OR_PRIVILEGED_ROLE_FORBIDDEN/); assert.equal(state.closes, 1);
  let starts = 0; let now = 10000;
  const handler = createVercelHandler(async () => { starts++; throw new Error("SYNTHETIC_SECRET_STARTUP_DIAGNOSTIC"); }, env, () => now);
  const server = createServer(handler); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  try {
    for (let attempt = 0; attempt < 2; attempt++) { const response = await fetch(origin + "/api/health"); assert.equal(response.status, 503); assert.equal(response.headers.get("retry-after"), "5"); assert.doesNotMatch(await response.text(), /SECRET|DIAGNOSTIC/); }
    assert.equal(starts, 1); now += 5000; assert.equal((await fetch(origin + "/credit/auth")).status, 503); assert.equal(starts, 2);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
