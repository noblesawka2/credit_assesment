import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DomainError } from "../src/domain/validation.ts";

export async function migrationPlan() {
  const name = "001_credit_foundation.sql";
  const sql = await readFile(new URL("../db/migrations/" + name, import.meta.url), "utf8");
  return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
}

export function assertMigrationArguments(args: string[], checksum: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (args.length === 0 || (args.length === 1 && args[0] === "--plan")) return false;
  if (args.length !== 7 || args[0] !== "--apply" || args[1] !== "--expected-sha256" || args[2] !== checksum) {
    throw new DomainError("MIGRATION_REQUIRES_EXPLICIT_APPLY_AND_REVIEWED_CHECKSUM");
  }
  if (!env.SUPABASE_PROJECT_REF || !env.DEPLOYMENT_ENV || args[3] !== "--expected-project" || args[4] !== env.SUPABASE_PROJECT_REF || args[5] !== "--expected-environment" || args[6] !== env.DEPLOYMENT_ENV) {
    throw new DomainError("MIGRATION_TARGET_CONFIRMATION_REQUIRED");
  }
  return true;
}
