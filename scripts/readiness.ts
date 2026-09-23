import { applicationEnvironment } from "../src/server/environment.ts";
import { PayloadCipher } from "../src/server/encryption.ts";
import { deploymentDatabaseConfig } from "../src/server/database.ts";
import { DomainError } from "../src/domain/validation.ts";
import { SupabaseStaffAuth } from "../src/server/supabase-auth.ts";

const checks = [
  { name: "environment", file: "src/server/environment.ts:4", run: () => applicationEnvironment() },
  { name: "database_configuration", file: "src/server/database.ts:46", run: () => deploymentDatabaseConfig() },
  { name: "authentication_configuration", file: "src/server/supabase-auth.ts:33", run: () => new SupabaseStaffAuth(process.env) },
  { name: "authentication_activation", file: "src/server/start.ts:24", run: () => {
    if (process.env.AUTH_ENABLED !== "true") throw new DomainError("AUTHENTICATION_NOT_ENABLED");
  } },
  { name: "encryption_round_trip", file: "src/server/encryption.ts:6", run: () => {
    const cipher = new PayloadCipher(process.env.DATA_ENCRYPTION_KEY ?? "");
    const sealed = cipher.seal({ readiness: true }, "readiness-probe");
    if (JSON.stringify(cipher.open(sealed, "readiness-probe")) !== '{"readiness":true}') throw new DomainError("ROUND_TRIP_FAILED");
    let rejected = false;
    try { cipher.open(sealed, "wrong-context"); } catch { rejected = true; }
    if (!rejected) throw new DomainError("CONTEXT_AUTHENTICATION_FAILED");
  } }
];
for (const check of checks) {
  try { await check.run(); }
  catch (error) {
    process.stderr.write(JSON.stringify({ check: check.name, file: check.file, code: error instanceof DomainError ? error.code : "CHECK_FAILED" }) + "\n");
    process.exitCode = 1;
  }
}
