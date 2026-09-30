import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("release artifact includes the existing backend without environment files or certificates", async () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/build.ts", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 0, "Release packaging must succeed");
  const root = new URL("../dist/", import.meta.url);
  const paths = await readdir(root, { recursive: true });
  assert.ok(paths.includes("package.json"));
  const normalized = paths.map(entry => entry.replaceAll("\\", "/"));
  for (const file of ["src/server/start.ts", "src/server/database.ts", "src/server/app.ts", "public/verification.html", "public/auth.html"]) {
    assert.ok(normalized.includes(file), file + " is required for deployment");
    assert.deepEqual(await readFile(new URL(file, root)), await readFile(new URL("../" + file, import.meta.url)));
  }
  assert.ok(normalized.every(file => !/(^|\/)(\.env[^/]*|certs|node_modules|test|db)(\/|$)/.test(file)));
  assert.ok(normalized.every(file => !/\.(pem|crt|key)$/i.test(file)));
});
