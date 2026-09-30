import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { requireControl } from "../src/domain/validation.ts";
import { assertMigrationArguments } from "./migration-plan.ts";

export const RELEASE_SOURCES = [
  "migrations/001_credit_foundation.sql",
  "proposals/002_staff_security.sql",
  "proposals/003_standalone_intake.sql",
  "proposals/004_manual_verification.sql",
  "migrations/005_runtime_hardening.sql",
  "migrations/006_readiness_and_administration.sql"
] as const;
export async function releasePlan() {
  const migrations = await Promise.all(RELEASE_SOURCES.map(async source => {
    const sql = await readFile(new URL("../db/" + source, import.meta.url), "utf8");
    return { name: source.split("/").at(-1)!, source, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
  const checksum = createHash("sha256").update(JSON.stringify(migrations.map(({ name, checksum }) => ({ name, checksum })))).digest("hex");
  return { migrations, checksum };
}
export function releaseMode(args: string[], checksum: string, env: NodeJS.ProcessEnv) {
  if (!args.length || (args.length === 1 && args[0] === "--plan")) return "plan";
  requireControl(args.length === 9 && ["--apply", "--rehearse"].includes(args[0]), "RELEASE_EXPLICIT_MODE_REQUIRED");
  assertMigrationArguments(["--apply", ...args.slice(1, 7)], checksum, env);
  requireControl(args[7] === "--expected-runtime-role" && args[8] === env.DATABASE_RUNTIME_ROLE && /^[a-z][a-z0-9_]{0,62}$/.test(args[8]), "RELEASE_RUNTIME_ROLE_CONFIRMATION_REQUIRED");
  return args[0] === "--apply" ? "apply" : "rehearse";
}
