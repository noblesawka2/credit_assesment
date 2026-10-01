import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import type pg from "pg";

export function hostingEnvironment(surface: "staff" | "administration"): NodeJS.ProcessEnv {
  const certificate = rootCertificates.find(value => {
    const parsed = new X509Certificate(value);
    return parsed.ca && Date.parse(parsed.validFrom) <= Date.now() && Date.parse(parsed.validTo) > Date.now();
  })!;
  return {
    NODE_ENV: "production", AUTH_ENABLED: "true", VERCEL: "1", VERCEL_ENV: "production", DEPLOYMENT_ENV: "production",
    APP_SURFACE: surface, APP_ORIGIN: surface === "staff" ? "https://staff.example.test" : "https://checker.example.test",
    STAFF_APP_ORIGIN: "https://staff.example.test", ADMIN_APP_ORIGIN: "https://checker.example.test",
    DATABASE_URL: "postgresql://nobles_app.aaaaaaaaaaaaaaaaaaaa:synthetic@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    DATABASE_SSL_CA_BASE64: Buffer.from(certificate).toString("base64"), DATABASE_RUNTIME_ROLE: "nobles_app", DATABASE_CONNECTION_METHOD: "session_pooler",
    DATABASE_POOL_MAX: "2", DATABASE_CONNECTION_BUDGET: "10", DATABASE_RESERVED_CONNECTIONS: "4", DATABASE_STAFF_MAX_INSTANCES: "2", DATABASE_ADMIN_MAX_INSTANCES: "1",
    SUPABASE_PROJECT_REF: "a".repeat(20), SUPABASE_URL: "https://" + "a".repeat(20) + ".supabase.co",
    SUPABASE_ANON_KEY: "SYNTHETIC_ANON_KEY", SUPABASE_SERVICE_ROLE_KEY: "SYNTHETIC_SERVICE_KEY", DATA_ENCRYPTION_KEY: "12".repeat(32), STAFF_INVITATIONS_ENABLED: "false"
  };
}

export function hostingPool() {
  const state = { queries: [] as string[], listeners: [] as string[], closes: 0, available: true, schemaReady: true, unsafe: false };
  const pool = {
    options: { idleTimeoutMillis: 5000 },
    on(event: string) { state.listeners.push(event); },
    async end() { state.closes++; },
    async query(input: string | { text: string }) {
      const sql = typeof input === "string" ? input : input.text;
      state.queries.push(sql);
      if (sql === "SELECT 1" && !state.available) throw new Error("SYNTHETIC_PRIVATE_DATABASE_ERROR");
      if (sql.includes("pg_roles")) return { rows: [{ privileged_role: state.unsafe, schema_control: false, unsafe_table_privileges: false, missing_rls: false }] };
      return { rows: [{ ready: state.schemaReady, hits: 1 }] };
    }
  } as unknown as pg.Pool;
  return { pool, state };
}
