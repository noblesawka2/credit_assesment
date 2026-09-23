import pg from "pg";
import { TLSSocket, checkServerIdentity } from "node:tls";
import { databaseConfig, databaseErrorCode } from "../src/server/database.ts";
import { migrationPlan } from "./migration-plan.ts";
import { requireControl } from "../src/domain/validation.ts";

let client: pg.Client | undefined;
const transport = { database_connected: false, tls_active: false, certificate_authorized: false, hostname_verification: false };
try {
  const config = await databaseConfig();
  client = new pg.Client({ ...config, options: "-c default_transaction_read_only=on", application_name: "nobles-release-audit-readonly" });
  await client.connect();
  transport.database_connected = true;
  const socket = (client as pg.Client & { connection?: { stream?: unknown } }).connection?.stream;
  transport.tls_active = socket instanceof TLSSocket && socket.encrypted === true;
  if (socket instanceof TLSSocket) {
    transport.certificate_authorized = socket.authorized === true;
    transport.hostname_verification = checkServerIdentity(new URL(config.connectionString!).hostname, socket.getPeerCertificate()) === undefined;
  }
  requireControl(transport.tls_active && transport.certificate_authorized && transport.hostname_verification, "DATABASE_VERIFIED_TLS_REQUIRED");
  await client.query("BEGIN READ ONLY");
  const result = await client.query("SELECT current_setting('server_version') AS server_version, current_setting('transaction_read_only') AS read_only, rolsuper AS superuser, rolbypassrls AS bypass_rls, (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS backend_tls_active, to_regclass('public.nobles_credit_migrations') IS NOT NULL AS migration_ledger_exists FROM pg_roles WHERE rolname=current_user");
  process.stdout.write(JSON.stringify({ connection: "VERIFIED_TLS", ...transport, ...result.rows[0] }) + "\n");
  const tables = await client.query("SELECT relname AS name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND (relname LIKE 'credit_%' OR relname='nobles_credit_migrations') ORDER BY relname");
  process.stdout.write(JSON.stringify({ creditTables: tables.rows }) + "\n");
  if (result.rows[0].migration_ledger_exists) {
    const { name, checksum } = await migrationPlan();
    const applied = await client.query("SELECT name,checksum,applied_at FROM public.nobles_credit_migrations WHERE name=$1", [name]);
    process.stdout.write(JSON.stringify({ migration: name, applied: applied.rowCount === 1, checksumMatches: applied.rowCount === 1 && applied.rows[0].checksum === checksum }) + "\n");
  }
  const functions = await client.query("SELECT proname AS name FROM pg_proc JOIN pg_namespace ON pg_namespace.oid=pronamespace WHERE nspname='public' AND proname IN ('credit_deny_mutation','credit_protect_originals','credit_protect_policy') ORDER BY proname");
  process.stdout.write(JSON.stringify({ migrationFunctionNameCollisions: functions.rows }) + "\n");
  await client.query("ROLLBACK");
} catch (error) {
  process.stderr.write(JSON.stringify({ connection: "FAILED", ...transport, code: databaseErrorCode(error), writesAttempted: false }) + "\n");
  process.exitCode = 1;
} finally { await client?.end().catch(() => {}); }
