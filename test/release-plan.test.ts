import test from "node:test";
import assert from "node:assert/strict";
import { releasePlan, releaseMode } from "../scripts/release-plan.ts";

test("release manifest is explicit, ordered and checksum bound", async () => {
  const plan = await releasePlan();
  assert.deepEqual(plan.migrations.map(migration => migration.name), ["001_credit_foundation.sql", "002_staff_security.sql", "003_standalone_intake.sql", "004_manual_verification.sql", "005_runtime_hardening.sql", "006_readiness_and_administration.sql"]);
  assert.equal(plan.migrations[0].checksum, "5723908376b09188e9889242058db1d6604f6c5a85e4188e9351563d0e5b34b2");
  assert.match(plan.checksum, /^[a-f0-9]{64}$/);
  assert.equal(releaseMode([], plan.checksum, {}), "plan");
  assert.equal(releaseMode(["--plan"], plan.checksum, {}), "plan");
  const env = { SUPABASE_PROJECT_REF: "a".repeat(20), DEPLOYMENT_ENV: "production", DATABASE_RUNTIME_ROLE: "nobles_app" };
  const args = ["--apply", "--expected-sha256", plan.checksum, "--expected-project", env.SUPABASE_PROJECT_REF, "--expected-environment", "production", "--expected-runtime-role", "nobles_app"];
  assert.equal(releaseMode(args, plan.checksum, env), "apply");
  assert.equal(releaseMode(["--rehearse", ...args.slice(1)], plan.checksum, env), "rehearse");
  assert.throws(() => releaseMode(["--apply"], plan.checksum, env));
  assert.throws(() => releaseMode(args, "b".repeat(64), env));
  assert.throws(() => releaseMode(args, plan.checksum, { ...env, DATABASE_RUNTIME_ROLE: "another_role" }));
  assert.throws(() => releaseMode(args, plan.checksum, { ...env, SUPABASE_PROJECT_REF: "b".repeat(20) }));
  assert.throws(() => releaseMode(args, plan.checksum, { ...env, DEPLOYMENT_ENV: "staging" }));
});
