import pg from "pg";
import { deploymentDatabaseConfig, databaseErrorCode } from "../src/server/database.ts";
import { assertRuntimeDatabase } from "../src/server/database-guards.ts";
import { requireControl } from "../src/domain/validation.ts";
import { releasePlan, releaseMode } from "./release-plan.ts";

let stage = "plan";
let rollbackConfirmed = false;
async function main() {
  const plan = await releasePlan();
  const mode = releaseMode(process.argv.slice(2), plan.checksum, process.env);
  if (mode === "plan") {
    process.stdout.write(JSON.stringify({ mode: "PLAN_ONLY_NO_CONNECTION", sha256: plan.checksum, migrations: plan.migrations.map(({ name, checksum, source }) => ({ name, checksum, source })) }) + "\n");
    process.stdout.write("Runner: BEGIN; SET LOCAL search_path TO public; SET LOCAL lock_timeout='5s'; SELECT pg_advisory_xact_lock(782344200); bind nobles.runtime_role; create/restrict migration ledger if absent; compare each stored checksum; apply missing migrations in the exact order below; insert receipts; check the confirmed runtime role using PostgreSQL privilege catalogs without assuming that role; COMMIT for --apply or ROLLBACK for --rehearse. No business-data DELETE, TRUNCATE or UPDATE.\n");
    for (const migration of plan.migrations) process.stdout.write("\n-- " + migration.name + " sha256=" + migration.checksum + "\n" + migration.sql + "\n");
    return;
  }
  stage = "admin-configuration";
  const config = await deploymentDatabaseConfig(process.env, "admin");
  const client = new pg.Client({ ...config, statement_timeout: 60000, query_timeout: 65000 });
  let connectionFailed = false;
  client.on("error", () => { connectionFailed = true; });
  let transaction = false;
  const applied: string[] = [];
  try {
    stage = "admin-connect";
    await client.connect();
    await client.query("BEGIN"); transaction = true;
    await client.query("SET LOCAL search_path TO public");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock(782344200)");
    await client.query("SELECT set_config('nobles.runtime_role',$1,true)", [process.env.DATABASE_RUNTIME_ROLE]);
    stage = "migration-ledger";
    await client.query("CREATE TABLE IF NOT EXISTS public.nobles_credit_migrations (name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
    await client.query("REVOKE ALL ON public.nobles_credit_migrations FROM PUBLIC,anon,authenticated,service_role");
    for (const migration of plan.migrations) {
      stage = migration.name;
      const previous = await client.query("SELECT checksum FROM public.nobles_credit_migrations WHERE name=$1", [migration.name]);
      if (previous.rowCount) requireControl(previous.rows[0].checksum === migration.checksum, "MIGRATION_CHECKSUM_MISMATCH");
      else {
        await client.query(migration.sql);
        await client.query("INSERT INTO public.nobles_credit_migrations(name,checksum) VALUES($1,$2)", [migration.name, migration.checksum]);
        applied.push(migration.name);
      }
    }
    stage = "runtime-safety-checks";
    await assertRuntimeDatabase(client, process.env.DATABASE_RUNTIME_ROLE);
    requireControl(!connectionFailed, "DATABASE_CONNECTION_LOST");
    stage = mode === "apply" ? "commit" : "rollback";
    await client.query(mode === "apply" ? "COMMIT" : "ROLLBACK"); transaction = false;
    process.stdout.write(JSON.stringify({ mode, result: mode === "apply" ? "COMMITTED" : "ROLLED_BACK", sha256: plan.checksum, migrations: applied }) + "\n");
  } finally {
    if (transaction) {
      try { await client.query("ROLLBACK"); rollbackConfirmed = true; } catch {}
    }
    await client.end().catch(() => {});
  }
}
await main().catch(error => { process.stderr.write(JSON.stringify({ releaseMigration: "FAILED", stage, code: databaseErrorCode(error), commitConfirmed: false, rollbackConfirmed }) + "\n"); process.exitCode = 1; });
