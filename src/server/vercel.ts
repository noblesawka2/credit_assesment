import type { IncomingMessage, ServerResponse } from "node:http";
import { createRuntime } from "./runtime.ts";
import { securityHeaders } from "./app.ts";
import { DomainError, requireControl } from "../domain/validation.ts";
import { databaseErrorCode } from "./database.ts";

type Runtime = Awaited<ReturnType<typeof createRuntime>>;

const databaseCaCodes = new Set(["DATABASE_SSL_CA_FILE_REQUIRED", "DATABASE_CA_SOURCE_AMBIGUOUS", "DATABASE_CA_ENCODING_INVALID", "DATABASE_CA_UNREADABLE", "DATABASE_CA_MUST_NOT_CONTAIN_PRIVATE_KEY", "DATABASE_CA_INVALID", "DATABASE_CA_INVALID_OR_EXPIRED"]);
const databaseConfigCodes = new Set(["DATABASE_URL_REQUIRED", "INVALID_DATABASE_URL", "DATABASE_URL_OPTION_NOT_ALLOWED", "DATABASE_REQUIRES_VERIFY_FULL", "DEPLOYMENT_ENV_REQUIRED", "SUPABASE_PROJECT_REF_REQUIRED", "DATABASE_CONNECTION_METHOD_REQUIRED", "DATABASE_CONNECTION_TARGET_MISMATCH", "INVALID_DATABASE_USERNAME", "DATABASE_ROLE_REQUIRED", "DATABASE_RUNTIME_ROLE_FORBIDDEN", "DATABASE_USERNAME_TARGET_MISMATCH", "DATABASE_HOST_TARGET_MISMATCH", "AUTH_DATABASE_PROJECT_MISMATCH"]);
const databaseConfigVariables: Record<string, string> = {
  DATABASE_URL_REQUIRED: "DATABASE_URL", INVALID_DATABASE_URL: "DATABASE_URL", DATABASE_URL_OPTION_NOT_ALLOWED: "DATABASE_URL", DATABASE_REQUIRES_VERIFY_FULL: "DATABASE_URL",
  DEPLOYMENT_ENV_REQUIRED: "DEPLOYMENT_ENV", SUPABASE_PROJECT_REF_REQUIRED: "SUPABASE_PROJECT_REF", DATABASE_CONNECTION_METHOD_REQUIRED: "DATABASE_CONNECTION_METHOD",
  DATABASE_CONNECTION_TARGET_MISMATCH: "DATABASE_URL", INVALID_DATABASE_USERNAME: "DATABASE_URL", DATABASE_ROLE_REQUIRED: "DATABASE_RUNTIME_ROLE",
  DATABASE_RUNTIME_ROLE_FORBIDDEN: "DATABASE_RUNTIME_ROLE", DATABASE_USERNAME_TARGET_MISMATCH: "DATABASE_URL", DATABASE_HOST_TARGET_MISMATCH: "DATABASE_URL",
  AUTH_DATABASE_PROJECT_MISMATCH: "SUPABASE_URL"
};
const databaseSecurityCodes = new Set(["RLS_BYPASS_OR_PRIVILEGED_ROLE_FORBIDDEN", "RUNTIME_SCHEMA_CONTROL_FORBIDDEN", "RUNTIME_DESTRUCTIVE_PRIVILEGES_FORBIDDEN", "RUNTIME_RLS_REQUIRED", "APPLICATION_SCHEMA_REQUIRED", "AUTH_SCHEMA_REQUIRED"]);

export function startupDiagnostic(error: unknown, env: NodeJS.ProcessEnv) {
  const code = error instanceof DomainError ? error.code : databaseErrorCode(error);
  if (code === "SUPABASE_CONFIGURATION_REQUIRED") {
    const variable = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].find(name => !env[name]);
    return variable ? { startup: "STARTUP_AUTH_CONFIG_MISSING", variable } : { startup: "STARTUP_AUTH_CONFIG_INVALID", variable: "SUPABASE_URL" };
  }
  if (code === "DATA_ENCRYPTION_KEY_REQUIRED") return { startup: "STARTUP_ENCRYPTION_CONFIG_FAILED", variable: "DATA_ENCRYPTION_KEY" };
  if (code === "INVALID_APP_SURFACE") return { startup: "STARTUP_SURFACE_MISMATCH", variable: "APP_SURFACE" };
  if (["INVALID_APP_ORIGIN", "APP_ORIGIN_ENVIRONMENT_MISMATCH", "PORTAL_ORIGIN_MISMATCH", "PORTAL_ORIGINS_MUST_DIFFER"].includes(code)) return { startup: "STARTUP_ORIGIN_MISMATCH", variable: "APP_ORIGIN" };
  if (["INVALID_TRUSTED_PROXY", "VERCEL_PROXY_REQUIRED", "VERCEL_PROXY_RUNTIME_REQUIRED", "VERCEL_RUNTIME_REQUIRED"].includes(code)) return { startup: "STARTUP_RUNTIME_INVALID" };
  if (code === "PRODUCTION_AUTH_REQUIRED" || code === "AUTH_DATABASE_REQUIRED") return { startup: "STARTUP_ENV_MISSING", variable: code === "PRODUCTION_AUTH_REQUIRED" && !env.AUTH_ENABLED ? "AUTH_ENABLED" : "DATABASE_URL" };
  if (databaseCaCodes.has(code)) return { startup: "STARTUP_CA_INVALID", variable: env.DATABASE_SSL_CA_BASE64 ? "DATABASE_SSL_CA_BASE64" : "DATABASE_SSL_CA_FILE" };
  if ((code.startsWith("INVALID_DATABASE_") && code.endsWith("INSTANCES")) || code === "INVALID_DATABASE_POOL_MAX" || code === "INVALID_DATABASE_CONNECTION_BUDGET" || code === "INVALID_DATABASE_RESERVED_CONNECTIONS" || code === "DATABASE_COMBINED_BUDGET_EXCEEDED") return { startup: "STARTUP_CONNECTION_BUDGET_FAILED" };
  if (databaseConfigCodes.has(code)) return { startup: "STARTUP_DATABASE_CONFIG_FAILED", check: code, variable: databaseConfigVariables[code] };
  if (databaseSecurityCodes.has(code)) return { startup: "STARTUP_DATABASE_SECURITY_FAILED" };
  if (["SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code)) return { startup: "STARTUP_DATABASE_TLS_FAILED" };
  if (["28P01", "3D000", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "DATABASE_OPERATION_FAILED"].includes(code)) return { startup: "STARTUP_DATABASE_CONNECT_FAILED" };
  return { startup: "STARTUP_UNKNOWN_FAILED" };
}

export function createVercelHandler(initialize: () => Promise<Runtime> = createRuntime, env: NodeJS.ProcessEnv = process.env, clock = Date.now) {
  let runtime: Promise<Runtime> | undefined;
  let retryAfter = 0;
  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      requireControl(env.VERCEL === "1" && env.NODE_ENV === "production" && ["production", "preview"].includes(env.VERCEL_ENV ?? ""), "VERCEL_RUNTIME_REQUIRED");
      requireControl(clock() >= retryAfter, "STARTUP_RETRY_PENDING");
      runtime ??= Promise.resolve().then(initialize).catch(error => {
        runtime = undefined;
        retryAfter = clock() + 5000;
        const diagnostic = env.APP_SURFACE === "administration" ? startupDiagnostic(error, env) : { startup: "UNAVAILABLE" };
        process.stderr.write(JSON.stringify(diagnostic) + "\n");
        throw error;
      });
      await (await runtime).handler(request, response);
    } catch {
      if (response.headersSent) { response.destroy(); return; }
      securityHeaders(response, true);
      response.setHeader("Retry-After", "5");
      response.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "SERVICE_UNAVAILABLE", status: "UNAVAILABLE", productionReady: false }));
    }
  };
}

export default createVercelHandler();
