import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity, rootCertificates, type ConnectionOptions } from "node:tls";
import pg from "pg";
import { databaseConfig, databaseErrorCode, deploymentDatabaseConfig } from "../src/server/database.ts";
import { assertRuntimeDatabase } from "../src/server/database-guards.ts";
import { migrationPlan, assertMigrationArguments } from "../scripts/migration-plan.ts";

async function withCertificate(run: (env: NodeJS.ProcessEnv) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "nobles-tls-test-"));
  const certificate = rootCertificates.find(value => {
    const parsed = new X509Certificate(value);
    return parsed.ca && Date.parse(parsed.validFrom) <= Date.now() && Date.parse(parsed.validTo) > Date.now();
  });
  assert.ok(certificate);
  const file = path.join(directory, "test-ca.crt");
  await writeFile(file, certificate);
  try { await run({ DATABASE_URL: "postgresql://test:test@database.invalid/test?sslmode=verify-full", DATABASE_SSL_CA_FILE: file }); }
  finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("nobles-tls-test-"));
    await rm(directory, { recursive: true, force: true });
  }
}

test("database TLS retains CA, certificate verification and default hostname verification", async () => {
  await withCertificate(async env => {
    const config = await databaseConfig(env);
    const ssl = config.ssl as ConnectionOptions;
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.checkServerIdentity, checkServerIdentity);
    assert.equal(ssl.servername, "database.invalid");
    assert.equal(ssl.minVersion, "TLSv1.2");
    assert.match(String(ssl.ca), /BEGIN CERTIFICATE/);
    assert.equal(new URL(config.connectionString!).searchParams.has("sslmode"), false);
    const client = new pg.Client(config) as unknown as { connectionParameters: { ssl: ConnectionOptions } };
    assert.equal(client.connectionParameters.ssl.ca, ssl.ca);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
    assert.equal(client.connectionParameters.ssl.checkServerIdentity, checkServerIdentity);
  });
});

test("connection-string options cannot overwrite the verified TLS object", async () => {
  await withCertificate(async env => {
    for (const query of ["sslmode=no-verify", "sslmode=disable", "sslmode=require", "sslmode=verify-ca", "ssl=false", "sslrootcert=wrong.crt", "sslcert=wrong.crt", "sslkey=wrong.key", "host=other.invalid", "sslmode=verify-full&sslmode=no-verify"]) {
      await assert.rejects(databaseConfig({ ...env, DATABASE_URL: "postgresql://test:test@database.invalid/test?" + query }));
    }
    await assert.rejects(databaseConfig({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: "0" }), /TLS_VERIFICATION_BYPASS_FORBIDDEN/);
  });
});

test("missing or invalid CA fails before a database connection is attempted", async () => {
  await withCertificate(async env => {
    await assert.rejects(databaseConfig({ ...env, DATABASE_SSL_CA_FILE: "" }), /DATABASE_SSL_CA_FILE_REQUIRED/);
    await assert.rejects(databaseConfig({ ...env, DATABASE_SSL_CA_FILE: path.join(path.dirname(env.DATABASE_SSL_CA_FILE!), "missing.crt") }), /DATABASE_CA_UNREADABLE/);
    await writeFile(env.DATABASE_SSL_CA_FILE!, "not a certificate");
    await assert.rejects(databaseConfig(env), /DATABASE_CA_INVALID/);
    await writeFile(env.DATABASE_SSL_CA_FILE!, "-----BEGIN PRIVATE KEY-----");
    await assert.rejects(databaseConfig(env), /DATABASE_CA_MUST_NOT_CONTAIN_PRIVATE_KEY/);
  });
});

test("database configuration rejects missing URLs and sanitizes error details", async () => {
  await assert.rejects(databaseConfig({}), /DATABASE_URL_REQUIRED/);
  await assert.rejects(databaseConfig({ DATABASE_URL: "not a URL" }), /INVALID_DATABASE_URL/);
  assert.equal(databaseErrorCode({ code: "SELF_SIGNED_CERT_IN_CHAIN", message: "SECRET" }), "SELF_SIGNED_CERT_IN_CHAIN");
  assert.equal(databaseErrorCode(new Error("postgresql://test:SECRET@database.invalid/test")), "DATABASE_OPERATION_FAILED");
});

test("migration defaults to preview and requires the exact reviewed checksum to apply", async () => {
  const plan = await migrationPlan();
  assert.equal(plan.name, "001_credit_foundation.sql");
  assert.match(plan.checksum, /^[0-9a-f]{64}$/);
  assert.equal(assertMigrationArguments([], plan.checksum), false);
  assert.equal(assertMigrationArguments(["--plan"], plan.checksum), false);
  assert.throws(() => assertMigrationArguments(["--apply"], plan.checksum));
  assert.throws(() => assertMigrationArguments(["--apply", "--expected-sha256", "wrong"], plan.checksum));
  const env = { SUPABASE_PROJECT_REF: "a".repeat(20), DEPLOYMENT_ENV: "staging" };
  const args = ["--apply", "--expected-sha256", plan.checksum, "--expected-project", env.SUPABASE_PROJECT_REF, "--expected-environment", "staging"];
  assert.throws(() => assertMigrationArguments(args.slice(0, 3), plan.checksum, env));
  assert.throws(() => assertMigrationArguments(args, plan.checksum, { ...env, DEPLOYMENT_ENV: "production" }), /MIGRATION_TARGET_CONFIRMATION_REQUIRED/);
  assert.throws(() => assertMigrationArguments(args, plan.checksum, { ...env, SUPABASE_PROJECT_REF: "b".repeat(20) }), /MIGRATION_TARGET_CONFIRMATION_REQUIRED/);
  assert.equal(assertMigrationArguments(args, plan.checksum, env), true);
});

test("admin credentials and CA never fall back to runtime configuration", async () => {
  await withCertificate(async env => {
    await assert.rejects(databaseConfig(env, "admin"), /DATABASE_ADMIN_URL_REQUIRED/);
    await assert.rejects(databaseConfig({ ...env, DATABASE_ADMIN_URL: env.DATABASE_URL }, "admin"), /DATABASE_ADMIN_SSL_CA_FILE_REQUIRED/);
    const config = await databaseConfig({ DATABASE_ADMIN_URL: env.DATABASE_URL, DATABASE_ADMIN_SSL_CA_FILE: env.DATABASE_SSL_CA_FILE }, "admin");
    assert.equal(config.application_name, "nobles-credit-migration");
    assert.equal((config.ssl as ConnectionOptions).rejectUnauthorized, true);
  });
});

test("deployment configuration pins project, connection method, username and role", async () => {
  await withCertificate(async certificateEnv => {
    const project = "a".repeat(20);
    const env: NodeJS.ProcessEnv = { ...certificateEnv, DEPLOYMENT_ENV: "staging", SUPABASE_PROJECT_REF: project,
      DATABASE_CONNECTION_METHOD: "session_pooler", DATABASE_RUNTIME_ROLE: "nobles_app",
      DATABASE_URL: `postgresql://nobles_app.${project}:test@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full` };
    await deploymentDatabaseConfig(env);
    await deploymentDatabaseConfig({ ...env, DATABASE_CONNECTION_METHOD: "direct", DATABASE_URL: `postgresql://nobles_app:test@db.${project}.supabase.co:5432/postgres` });
    await assert.rejects(deploymentDatabaseConfig({ ...env, SUPABASE_PROJECT_REF: "b".repeat(20) }), /DATABASE_USERNAME_TARGET_MISMATCH/);
    await assert.rejects(deploymentDatabaseConfig({ ...env, DATABASE_RUNTIME_ROLE: "postgres" }), /DATABASE_RUNTIME_ROLE_FORBIDDEN/);
    await assert.rejects(deploymentDatabaseConfig({ ...env, DATABASE_URL: env.DATABASE_URL!.replace(":5432", ":6543") }), /DATABASE_CONNECTION_TARGET_MISMATCH/);
    await assert.rejects(deploymentDatabaseConfig({ ...env, DATABASE_URL: env.DATABASE_URL!.replace("/postgres?", "/other?") }), /DATABASE_CONNECTION_TARGET_MISMATCH/);
    await assert.rejects(deploymentDatabaseConfig({ ...env, DATABASE_URL: env.DATABASE_URL!.replace("aws-0-eu-west-1.pooler.supabase.com", "attacker.invalid") }), /DATABASE_HOST_TARGET_MISMATCH/);
    await assert.rejects(deploymentDatabaseConfig({ ...env, SUPABASE_URL: "https://" + "b".repeat(20) + ".supabase.co" }), /AUTH_DATABASE_PROJECT_MISMATCH/);
    await assert.rejects(deploymentDatabaseConfig({ ...env, DATABASE_ADMIN_URL: "must-not-be-present" }), /ADMIN_CREDENTIALS_IN_RUNTIME_FORBIDDEN/);
    await assert.rejects(deploymentDatabaseConfig({ ...env, DEPLOYMENT_ENV: "" }), /DEPLOYMENT_ENV_REQUIRED/);
    await deploymentDatabaseConfig({ ...env, DATABASE_ADMIN_URL: env.DATABASE_URL!.replace("nobles_app.", "postgres."), DATABASE_ADMIN_SSL_CA_FILE: env.DATABASE_SSL_CA_FILE, DATABASE_ADMIN_ROLE: "postgres", DATABASE_ADMIN_CONNECTION_METHOD: "session_pooler" }, "admin");
  });
});

test("runtime guard rejects inherited privilege, schema control, destructive grants and missing RLS/schema", async () => {
  const safe = { privileged_role: false, schema_control: false, unsafe_table_privileges: false, missing_rls: false };
  const pool = (row: typeof safe, ready = true) => ({ query: async (sql: string) => ({ rows: [sql.includes("pg_roles") ? row : { ready }] }) }) as unknown as pg.Pool;
  await assertRuntimeDatabase(pool(safe));
  for (const field of Object.keys(safe)) await assert.rejects(assertRuntimeDatabase(pool({ ...safe, [field]: true })));
  await assert.rejects(assertRuntimeDatabase(pool(safe, false)), /STANDALONE_INTAKE_SCHEMA_REQUIRED/);
});
