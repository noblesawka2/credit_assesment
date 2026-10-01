import pg from "pg";
import { attachDatabasePool } from "@vercel/functions/db-connections";
import { createRequestHandler } from "./app.ts";
import { PayloadCipher } from "./encryption.ts";
import { DraftRepository } from "./repository.ts";
import { deploymentDatabaseConfig, databaseErrorCode } from "./database.ts";
import { assertRuntimeDatabase } from "./database-guards.ts";
import { applicationEnvironment } from "./environment.ts";
import { SupabaseStaffAuth } from "./supabase-auth.ts";
import { PostgresSecurityStore } from "./security-store.ts";
import { StaffAuthentication } from "./staff-auth.ts";
import { requireControl } from "../domain/validation.ts";
import { ManualVerificationRepository } from "./manual-verification.ts";
import { StaffAdministration } from "./administration.ts";
import { ReadinessRepository } from "./readiness.ts";
import { PublicReadinessRepository } from "./public-readiness.ts";
import { clientAddressResolver } from "./proxy.ts";
import { backendHealth } from "./health.ts";

export async function createRuntime(env: NodeJS.ProcessEnv = process.env, poolFactory: (config: pg.PoolConfig) => pg.Pool = config => new pg.Pool(config)) {
  const environment = applicationEnvironment(env);
  const { origin, production, surface, authEnabled } = environment;
  requireControl(!production || (authEnabled && Boolean(env.DATABASE_URL)), "PRODUCTION_AUTH_REQUIRED");
  let pool: pg.Pool | undefined;
  try {
    let repository: DraftRepository | undefined;
    let staffAuth: StaffAuthentication | undefined;
    let verification: ManualVerificationRepository | undefined;
    let administration: StaffAdministration | undefined;
    let readiness: ReadinessRepository | undefined;
    let publicReadiness: PublicReadinessRepository | undefined;
    if (env.DATABASE_URL) {
      pool = poolFactory(await deploymentDatabaseConfig(env));
      if (env.VERCEL === "1" && env.VERCEL_ENV !== "development") attachDatabasePool(pool);
      pool.on("error", error => process.stderr.write(JSON.stringify({ database: "UNAVAILABLE", code: databaseErrorCode(error) }) + "\n"));
      await assertRuntimeDatabase(pool);
      const cipher = new PayloadCipher(env.DATA_ENCRYPTION_KEY ?? "");
      repository = new DraftRepository(pool, cipher);
      const present = await pool.query("SELECT to_regclass('public.credit_manual_verifications') IS NOT NULL AND to_regclass('public.credit_readiness_results') IS NOT NULL AND to_regclass('nobles_security.staff_admin_audit') IS NOT NULL AS ready");
      requireControl(present.rows[0]?.ready, "APPLICATION_SCHEMA_REQUIRED");
      verification = new ManualVerificationRepository(pool, cipher);
      readiness = new ReadinessRepository(pool, cipher);
      if (surface !== "administration") publicReadiness = new PublicReadinessRepository(pool);
    }
    if (authEnabled) {
      requireControl(pool, "AUTH_DATABASE_REQUIRED");
      const present = await pool.query("SELECT to_regclass('nobles_security.sessions') IS NOT NULL AND to_regclass('nobles_security.events') IS NOT NULL AND to_regclass('nobles_security.rate_limits') IS NOT NULL AND to_regclass('nobles_security.revocations') IS NOT NULL AS ready");
      requireControl(present.rows[0]?.ready, "AUTH_SCHEMA_REQUIRED");
      const provider = new SupabaseStaffAuth(env);
      const cipher = new PayloadCipher(env.DATA_ENCRYPTION_KEY!);
      staffAuth = new StaffAuthentication(provider, new PostgresSecurityStore(pool), cipher, origin, env.DATA_ENCRYPTION_KEY!, surface, clientAddressResolver(env));
      if (surface !== "staff") administration = new StaffAdministration(pool, provider, cipher, env);
    }
    const database = pool;
    const healthQuery: pg.QueryConfig & { query_timeout: number } = { text: "SELECT 1", query_timeout: 2000 };
    const healthCheck = database && staffAuth ? backendHealth(() => database.query(healthQuery)) : async () => false;
    return {
      environment,
      handler: createRequestHandler({ origin, surface, repository, staffAuth, verification, administration, readiness, publicReadiness, healthCheck, releaseCommit: env.VERCEL_GIT_COMMIT_SHA }),
      close: async () => { await database?.end(); }
    };
  } catch (error) {
    await pool?.end().catch(() => {});
    throw error;
  }
}
