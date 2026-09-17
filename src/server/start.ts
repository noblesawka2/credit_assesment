import pg from "pg";
import { createApp } from "./app.ts";
import { PayloadCipher } from "./encryption.ts";
import { DraftRepository } from "./repository.ts";

let repository: DraftRepository | undefined;
let pool: pg.Pool | undefined;
if (process.env.DATABASE_URL) {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  const role = await pool.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user");
  if (role.rows[0].rolsuper || role.rows[0].rolbypassrls) throw new Error("RLS_BYPASS_ROLE_FORBIDDEN");
  repository = new DraftRepository(pool, new PayloadCipher(process.env.DATA_ENCRYPTION_KEY ?? ""));
}
const port = Number(process.env.PORT ?? 3100);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("INVALID_PORT");
const host = process.env.HOST ?? "127.0.0.1";
const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:" + port;
const server = createApp({ origin, repository });
server.listen(port, host, () => process.stdout.write("Nobles foundation listening on " + origin + "; production workflows disabled.\n"));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => { void pool?.end(); }));
