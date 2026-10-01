import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostingEnvironment, hostingPool } from "./hosting-fixtures.ts";

test("Vercel artifact runs both isolated surfaces without repository files or build-time secrets", async context => {
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(vercel.installCommand, "npm ci --include=dev");
  const canary = "SYNTHETIC_BUILD_ENV_MUST_NOT_BE_PACKAGED_97fc5e";
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/build-vercel.ts", import.meta.url))], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: canary, DATA_ENCRYPTION_KEY: canary, DATABASE_SSL_CA_BASE64: canary }
  });
  assert.equal(result.status, 0, "Vercel packaging must succeed without reading runtime configuration");
  const output = new URL("../.vercel/output/", import.meta.url);
  const config = JSON.parse(await readFile(new URL("config.json", output), "utf8"));
  assert.deepEqual(config, { version: 3, routes: [{ src: "/(.*)", dest: "/index" }] });
  assert.deepEqual((await readdir(output)).sort(), ["config.json", "functions"]);
  const bundled = new URL("functions/index.func/", output);
  const launcher = JSON.parse(await readFile(new URL(".vc-config.json", bundled), "utf8"));
  assert.equal(launcher.runtime, "nodejs24.x");
  assert.equal(launcher.handler, "src/server/vercel.js");
  assert.equal(launcher.launcherType, "Nodejs");
  assert.equal(launcher.shouldAddHelpers, false);
  const files = await readdir(bundled, { recursive: true, withFileTypes: true });
  const names = files.map(entry => path.relative(fileURLToPath(bundled), path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
  for (const required of [launcher.handler, "src/server/runtime.js", "public/auth.html", "public/check.html", "public/check.js", "public/administration.html", "node_modules/pg/package.json", "node_modules/@vercel/functions/db-connections/index.js"]) assert.ok(names.includes(required), required);
  assert.ok(!names.some(name => /(^|\/)(\.env[^/]*|certs|test|tests|db|typescript|\.git)(\/|$)|\.(pem|crt|key)$/i.test(name)));
  for (const entry of files.filter(entry => entry.isFile())) {
    const bytes = await readFile(path.join(entry.parentPath, entry.name));
    assert.equal(bytes.includes(Buffer.from(canary)), false, "Build environment must not be embedded in " + entry.name);
  }
  const temporaryRoot = await realpath(tmpdir());
  const isolated = await mkdtemp(path.join(temporaryRoot, "nobles-vercel-test-"));
  assert.equal(path.dirname(isolated), temporaryRoot);
  try {
    await cp(bundled, isolated, { recursive: true });
    const entry = await import(pathToFileURL(path.join(isolated, launcher.handler)).href) as typeof import("../src/server/vercel.ts");
    const runtimeModule = await import(pathToFileURL(path.join(isolated, "src/server/runtime.js")).href) as typeof import("../src/server/runtime.ts");
    const appModule = await import(pathToFileURL(path.join(isolated, "src/server/app.js")).href) as typeof import("../src/server/app.ts");
    const databaseModule = await import(pathToFileURL(path.join(isolated, "src/server/database.js")).href) as typeof import("../src/server/database.ts");
    assert.equal(typeof entry.default, "function");
    for (const surface of ["staff", "administration"] as const) await context.test(surface + " packaged routes, TLS configuration and failure boundaries", async () => {
      const env = hostingEnvironment(surface);
      const { pool, state } = hostingPool();
      const tls = (await databaseModule.deploymentDatabaseConfig(env)).ssl;
      assert.ok(tls && typeof tls === "object");
      assert.equal(tls.rejectUnauthorized, true);
      assert.equal(typeof tls.checkServerIdentity, "function");
      assert.equal(tls.servername, new URL(env.DATABASE_URL!).hostname);
      let runtime: Awaited<ReturnType<typeof runtimeModule.createRuntime>> | undefined;
      let initializations = 0;
      const handler = entry.createVercelHandler(async () => {
        initializations++;
        runtime = await runtimeModule.createRuntime(env, () => pool);
        return runtime;
      }, env);
      const server = createServer(handler);
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
      const headers = { "x-vercel-forwarded-for": "192.0.2.15" };
      const get = (pathname: string) => fetch(origin + pathname, { headers });
      try {
        const responses = await Promise.all([get("/credit/auth"), get("/api/health")]);
        assert.ok(responses.every(response => response.status === 200));
        assert.equal(initializations, 1);
        assert.equal(state.listeners.filter(event => event === "release").length, 1);
        assert.match(await responses[0].text(), /auth.js/);
        assert.deepEqual(await responses[1].json(), { service: "Nobles Cooperative", status: "AVAILABLE", surface, productionReady: false, offlineCaptureEnabled: false, submissionEnabled: false, releaseCommit: null });
        assert.equal(responses[1].headers.get("cache-control"), "no-store");
        const root = await fetch(origin + "/", { headers, redirect: "manual" });
        assert.equal(root.status, 302); assert.equal(root.headers.get("location"), surface === "administration" ? "/credit/admin" : "/check");
        const check = await get("/check"); assert.equal(check.status, surface === "staff" ? 200 : 404);
        if (surface === "staff") assert.match(await check.text(), /No identity details/);
        for (const pathname of ["/auth.js", "/branding.css", "/nobles-logo.png"]) assert.equal((await get(pathname)).status, 200, pathname);
        for (const pathname of ["/credit/staff", "/credit/readiness", "/credit/verification"]) {
          const protectedPage = await fetch(origin + pathname, { headers, redirect: "manual" });
          assert.equal(protectedPage.status, surface === "administration" ? 404 : 302, pathname);
        }
        assert.equal((await fetch(origin + "/credit/admin", { headers, redirect: "manual" })).status, surface === "staff" ? 404 : 302);
        assert.ok(state.queries.every(query => query.startsWith("SELECT") || query.startsWith("INSERT INTO nobles_security.events")));
        for (const pathname of ["/.env", "/.env.migrate", "/.vc-config.json", "/certs/test.crt", "/src/server/vercel.js", "/node_modules/pg/package.json", "/config/supabase-invite.html"]) assert.equal((await get(pathname)).status, 404, pathname);
        for (const pathname of ["/api/session", "/api/admin/overview", "/api/drafts", "/api/readiness/config"]) {
          const response = await get(pathname);
          assert.equal(response.status, 401, pathname);
          assert.match(response.headers.get("set-cookie")!, /^__Host-nobles-session=.*; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0; Secure$/);
          assert.doesNotMatch(response.headers.get("set-cookie")!, /Domain=/i);
        }
        const rejected = await fetch(origin + "/api/auth/sign-in", { method: "POST", headers: { ...headers, Origin: surface === "staff" ? env.ADMIN_APP_ORIGIN! : env.STAFF_APP_ORIGIN! } });
        assert.equal(rejected.status, 403);
        assert.equal(rejected.headers.get("access-control-allow-origin"), null);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await runtime?.close();
      }
      assert.equal(state.closes, 1);
    });
    await context.test("packaged health failures are 503, non-cached and redact internal errors", async () => {
      const failures = [() => { throw new Error("SYNTHETIC_INTERNAL_SECRET"); }, async () => { throw new Error("SYNTHETIC_INTERNAL_SECRET"); }];
      for (const healthCheck of failures) {
        const server = createServer(appModule.createRequestHandler({ origin: "https://staff.example.test", surface: "staff", healthCheck }));
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        try {
          const response = await fetch("http://127.0.0.1:" + (server.address() as AddressInfo).port + "/api/health");
          assert.equal(response.status, 503);
          assert.equal(response.headers.get("cache-control"), "no-store");
          assert.match(response.headers.get("strict-transport-security")!, /max-age=/);
          assert.deepEqual(await response.json(), { service: "Nobles Cooperative", status: "UNAVAILABLE", surface: "staff", productionReady: false, offlineCaptureEnabled: false, submissionEnabled: false, releaseCommit: null });
        } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
      }
    });
  } finally {
    assert.equal(path.dirname(isolated), temporaryRoot);
    assert.ok(path.basename(isolated).startsWith("nobles-vercel-test-"));
    await rm(isolated, { recursive: true, force: true });
  }
});
