import pg from "pg";
import { deploymentDatabaseConfig, databaseErrorCode } from "../src/server/database.ts";
import { migrationPlan, assertMigrationArguments } from "./migration-plan.ts";

async function main() {
  const { name, sql, checksum } = await migrationPlan();
  if (!assertMigrationArguments(process.argv.slice(2), checksum, process.env)) {
    process.stdout.write(JSON.stringify({ mode: "PLAN_ONLY_NO_CONNECTION", migration: name, sha256: checksum }) + "\n");
    process.stdout.write("Runner: BEGIN; SET LOCAL search_path TO public; SET LOCAL lock_timeout = '5s'; SELECT pg_advisory_xact_lock(782344200); CREATE TABLE IF NOT EXISTS public.nobles_credit_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()); compare stored checksum; run the SQL below only if not applied; INSERT migration receipt; COMMIT.\n");
    process.stdout.write(sql + "\n");
    return;
  }
  const pool = new pg.Pool(await deploymentDatabaseConfig(process.env, "admin"));
  let client: pg.PoolClient | undefined;
  let transaction = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transaction = true;
    await client.query("SET LOCAL search_path TO public");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SELECT pg_advisory_xact_lock(782344200)");
    await client.query("CREATE TABLE IF NOT EXISTS public.nobles_credit_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const previous = await client.query("SELECT checksum FROM public.nobles_credit_migrations WHERE name=$1", [name]);
    if (previous.rowCount) {
      if (previous.rows[0].checksum !== checksum) throw Object.assign(new Error("MIGRATION_CHECKSUM_MISMATCH"), { code: "MIGRATION_CHECKSUM_MISMATCH" });
    } else {
      await client.query(sql);
      await client.query("INSERT INTO public.nobles_credit_migrations(name,checksum) VALUES($1,$2)", [name, checksum]);
    }
    await client.query("COMMIT");
    transaction = false;
    process.stdout.write((previous.rowCount ? "Already applied: " : "Applied: ") + name + "\n");
  } finally {
    if (client) {
      if (transaction) await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    await pool.end();
  }
}
await main().catch(error => { process.stderr.write("Migration stopped: " + databaseErrorCode(error) + ". No successful commit confirmed.\n"); process.exitCode = 1; });
