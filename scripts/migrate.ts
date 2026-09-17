import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(782344200)");
  await client.query("CREATE TABLE IF NOT EXISTS nobles_credit_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const name = "001_credit_foundation.sql";
  const sql = await readFile(new URL("../db/migrations/" + name, import.meta.url), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const previous = await client.query("SELECT checksum FROM nobles_credit_migrations WHERE name=$1", [name]);
  if (previous.rowCount) {
    if (previous.rows[0].checksum !== checksum) throw new Error("MIGRATION_CHECKSUM_MISMATCH");
    process.stdout.write("Migration already applied.\n");
  } else {
    await client.query(sql);
    await client.query("INSERT INTO nobles_credit_migrations(name,checksum) VALUES($1,$2)", [name, checksum]);
    process.stdout.write("Applied " + name + "\n");
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write("Migration failed; transaction rolled back.\n");
  process.exitCode = 1;
} finally { client.release(); await pool.end(); }
