import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("Git ignores real environment files and certificates but permits empty templates", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nobles-ignore-test-"));
  try {
    const initialized = spawnSync("git", ["init", "--quiet", directory], { encoding: "utf8" });
    assert.equal(initialized.status, 0, "Temporary Git repository must initialize");
    await writeFile(path.join(directory, ".gitignore"), await readFile(new URL("../.gitignore", import.meta.url)));
    for (const file of [".env", ".env.migrate", ".env.production", ".env.migrate.backup", "nested/.env.migrate", "certs/supabase-prod-ca.crt"]) {
      const result = spawnSync("git", ["check-ignore", "--no-index", "--quiet", "--", file], { cwd: directory, encoding: "utf8" });
      assert.equal(result.status, 0, file + " must stay ignored");
    }
    for (const file of [".env.example", ".env.migrate.example"]) {
      const result = spawnSync("git", ["check-ignore", "--no-index", "--quiet", "--", file], { cwd: directory, encoding: "utf8" });
      assert.equal(result.status, 1, file + " must remain publishable");
    }
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("nobles-ignore-test-"));
    await rm(directory, { recursive: true, force: true });
  }
});
