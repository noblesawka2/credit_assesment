import { readFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import type { PoolConfig } from "pg";
import { DomainError, requireControl } from "../domain/validation.ts";

export async function databaseConfig(env: NodeJS.ProcessEnv = process.env, purpose: "runtime" | "admin" = "runtime"): Promise<PoolConfig> {
  requireControl(env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "TLS_VERIFICATION_BYPASS_FORBIDDEN");
  const url = purpose === "admin" ? env.DATABASE_ADMIN_URL : env.DATABASE_URL;
  const caFile = purpose === "admin" ? env.DATABASE_ADMIN_SSL_CA_FILE : env.DATABASE_SSL_CA_FILE;
  requireControl(Boolean(url), purpose === "admin" ? "DATABASE_ADMIN_URL_REQUIRED" : "DATABASE_URL_REQUIRED");
  let target: URL;
  try { target = new URL(url!); }
  catch { throw new DomainError("INVALID_DATABASE_URL"); }
  requireControl(["postgres:", "postgresql:"].includes(target.protocol) && target.hostname && target.pathname.length > 1 && !target.hash, "INVALID_DATABASE_URL");
  for (const name of target.searchParams.keys()) {
    requireControl(name === "sslmode" || name === "application_name", "DATABASE_URL_OPTION_NOT_ALLOWED");
  }
  const modes = target.searchParams.getAll("sslmode");
  requireControl(modes.length <= 1 && modes.every(mode => mode === "verify-full"), "DATABASE_REQUIRES_VERIFY_FULL");
  target.searchParams.delete("sslmode");
  requireControl(Boolean(caFile), purpose === "admin" ? "DATABASE_ADMIN_SSL_CA_FILE_REQUIRED" : "DATABASE_SSL_CA_FILE_REQUIRED");
  let certificate: string;
  try { certificate = await readFile(caFile!, "utf8"); }
  catch { throw new DomainError("DATABASE_CA_UNREADABLE"); }
  requireControl(!certificate.includes("PRIVATE KEY"), "DATABASE_CA_MUST_NOT_CONTAIN_PRIVATE_KEY");
  const blocks = certificate.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  requireControl(blocks && blocks.length > 0, "DATABASE_CA_INVALID");
  for (const block of blocks) {
    let parsed: X509Certificate;
    try { parsed = new X509Certificate(block); }
    catch { throw new DomainError("DATABASE_CA_INVALID"); }
    requireControl(parsed.ca && Date.parse(parsed.validFrom) <= Date.now() && Date.parse(parsed.validTo) > Date.now(), "DATABASE_CA_INVALID_OR_EXPIRED");
  }
  return {
    connectionString: target.toString(),
    ssl: { ca: certificate, rejectUnauthorized: true, minVersion: "TLSv1.2", servername: target.hostname, checkServerIdentity },
    max: 10, connectionTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 12000,
    application_name: purpose === "admin" ? "nobles-credit-migration" : "nobles-credit-engine"
  };
}

export async function deploymentDatabaseConfig(env: NodeJS.ProcessEnv = process.env, purpose: "runtime" | "admin" = "runtime") {
  const config = await databaseConfig(env, purpose);
  requireControl(["local", "staging", "production"].includes(env.DEPLOYMENT_ENV ?? ""), "DEPLOYMENT_ENV_REQUIRED");
  requireControl(/^[a-z0-9]{20}$/.test(env.SUPABASE_PROJECT_REF ?? ""), "SUPABASE_PROJECT_REF_REQUIRED");
  const target = new URL(config.connectionString!);
  const project = env.SUPABASE_PROJECT_REF!;
  const method = purpose === "admin" ? env.DATABASE_ADMIN_CONNECTION_METHOD : env.DATABASE_CONNECTION_METHOD;
  requireControl(method === "direct" || method === "session_pooler", "DATABASE_CONNECTION_METHOD_REQUIRED");
  requireControl((target.port || "5432") === "5432" && target.pathname === "/postgres", "DATABASE_CONNECTION_TARGET_MISMATCH");
  let username: string;
  try { username = decodeURIComponent(target.username); }
  catch { throw new DomainError("INVALID_DATABASE_USERNAME"); }
  const role = purpose === "admin" ? env.DATABASE_ADMIN_ROLE : env.DATABASE_RUNTIME_ROLE;
  requireControl(/^[a-z][a-z0-9_]{0,62}$/.test(role ?? ""), "DATABASE_ROLE_REQUIRED");
  if (purpose === "runtime") requireControl(!["postgres", "service_role", "supabase_admin", "authenticator", "anon", "authenticated"].includes(role!), "DATABASE_RUNTIME_ROLE_FORBIDDEN");
  requireControl(username === (method === "direct" ? role : role + "." + project), "DATABASE_USERNAME_TARGET_MISMATCH");
  requireControl(method === "direct" ? target.hostname === "db." + project + ".supabase.co" : /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(target.hostname), "DATABASE_HOST_TARGET_MISMATCH");
  if (env.SUPABASE_URL) requireControl(env.SUPABASE_URL === "https://" + project + ".supabase.co", "AUTH_DATABASE_PROJECT_MISMATCH");
  if (purpose === "runtime") requireControl(!env.DATABASE_ADMIN_URL && !env.DATABASE_ADMIN_SSL_CA_FILE, "ADMIN_CREDENTIALS_IN_RUNTIME_FORBIDDEN");
  return config;
}

export function databaseErrorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{2,64}$/.test(code) ? code : "DATABASE_OPERATION_FAILED";
}
