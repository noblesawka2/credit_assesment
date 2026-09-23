import pg from "pg";
import { createApp } from "./app.ts";
import { PayloadCipher } from "./encryption.ts";
import { DraftRepository } from "./repository.ts";
import { deploymentDatabaseConfig } from "./database.ts";
import { assertRuntimeDatabase } from "./database-guards.ts";
import { applicationEnvironment } from "./environment.ts";
import { SupabaseStaffAuth } from "./supabase-auth.ts";
import { PostgresSecurityStore } from "./security-store.ts";
import { StaffAuthentication } from "./staff-auth.ts";
import { DomainError, requireControl } from "../domain/validation.ts";

try {
const { port, host, origin, production, authEnabled } = applicationEnvironment();
requireControl(!production || (authEnabled && Boolean(process.env.DATABASE_URL)), "PRODUCTION_AUTH_REQUIRED");
let repository: DraftRepository | undefined;
let pool: pg.Pool | undefined;
let staffAuth: StaffAuthentication | undefined;
if (process.env.DATABASE_URL) {
  pool = new pg.Pool(await deploymentDatabaseConfig());
  await assertRuntimeDatabase(pool);
  repository = new DraftRepository(pool, new PayloadCipher(process.env.DATA_ENCRYPTION_KEY ?? ""));
}
if (authEnabled) {
  requireControl(pool, "AUTH_DATABASE_REQUIRED");
  const present = await pool.query("SELECT to_regclass('nobles_security.sessions') IS NOT NULL AND to_regclass('nobles_security.events') IS NOT NULL AND to_regclass('nobles_security.rate_limits') IS NOT NULL AND to_regclass('nobles_security.revocations') IS NOT NULL AS ready");
  requireControl(present.rows[0].ready, "AUTH_SCHEMA_REQUIRED");
  staffAuth = new StaffAuthentication(new SupabaseStaffAuth(process.env), new PostgresSecurityStore(pool), new PayloadCipher(process.env.DATA_ENCRYPTION_KEY!), origin, process.env.DATA_ENCRYPTION_KEY!);
}
const server = createApp({ origin, repository, staffAuth });
server.listen(port, host, () => process.stdout.write("Nobles foundation listening on " + origin + "; production workflows disabled.\n"));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => { void pool?.end(); }));
} catch (error) {
  process.stderr.write(JSON.stringify({ startup: "FAILED", code: error instanceof DomainError ? error.code : "STARTUP_FAILED" }) + "\n");
  process.exit(1);
}
