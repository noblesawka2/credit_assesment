import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.ts";
import { readFile } from "node:fs/promises";
test("HTTP shell exposes no real data and unauthenticated API is blocked", async () => {
  const server = createApp({ origin: "http://127.0.0.1:3100" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  try {
    const shell = await fetch(origin + "/credit/apply/start");
    assert.equal(shell.status, 200); assert.match(await shell.text(), /Nobles Cooperative/);
    assert.equal(shell.headers.get("cache-control"), "no-store");
    assert.match(shell.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    const health = await fetch(origin + "/api/health").then(response => response.json());
    assert.equal(health.productionReady, false); assert.equal(health.offlineCaptureEnabled, false);
    assert.equal((await fetch(origin + "/api/drafts")).status, 401);
    assert.equal((await fetch(origin + "/api/session")).status, 401);
    assert.equal((await fetch(origin + "/api/drafts", { method: "POST", headers: { Origin: "https://other.example" } })).status, 403);
    assert.equal((await fetch(origin + "/.env")).status, 404);
    assert.equal((await fetch(origin + "/src/server/encryption.ts")).status, 404);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test("offline shell excludes API, query strings and all submitted payloads", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.search/); assert.match(worker, /event\.request\.method !== "GET"/);
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.ok(!/localStorage|sessionStorage|console\.log/.test(app));
});
