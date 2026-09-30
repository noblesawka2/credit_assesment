import { PayloadCipher } from "./encryption.ts";
import { DomainError, requireControl } from "../domain/validation.ts";
import { clientAddressResolver } from "./proxy.ts";

export function applicationEnvironment(env: NodeJS.ProcessEnv = process.env) {
  requireControl(env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "TLS_VERIFICATION_BYPASS_FORBIDDEN");
  const port = Number(env.PORT ?? 3100);
  requireControl(Number.isSafeInteger(port) && port > 0 && port <= 65535, "INVALID_PORT");
  const production = env.NODE_ENV === "production";
  clientAddressResolver(env);
  const surface = env.APP_SURFACE ?? (production ? "staff" : "local");
  requireControl(["staff", "administration", "local"].includes(surface) && (!production || surface !== "local"), "INVALID_APP_SURFACE");
  const origin = env.APP_ORIGIN ?? (production ? "" : "http://127.0.0.1:" + port);
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new DomainError("INVALID_APP_ORIGIN"); }
  requireControl(parsed.origin === origin && !parsed.username && !parsed.password, "INVALID_APP_ORIGIN");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  requireControl(production ? parsed.protocol === "https:" && !loopback : loopback && ["http:", "https:"].includes(parsed.protocol), "APP_ORIGIN_ENVIRONMENT_MISMATCH");
  if (production) requireControl(origin === (surface === "administration" ? env.ADMIN_APP_ORIGIN : env.STAFF_APP_ORIGIN), "PORTAL_ORIGIN_MISMATCH");
  if (production) requireControl(env.STAFF_APP_ORIGIN !== env.ADMIN_APP_ORIGIN, "PORTAL_ORIGINS_MUST_DIFFER");
  requireControl(env.AUTH_ENABLED === undefined || ["true", "false"].includes(env.AUTH_ENABLED), "INVALID_AUTH_ENABLED");
  if (env.DATABASE_URL || env.AUTH_ENABLED === "true") new PayloadCipher(env.DATA_ENCRYPTION_KEY ?? "");
  return { port, host: env.HOST ?? "127.0.0.1", origin, production, surface: surface as "staff" | "administration" | "local", authEnabled: env.AUTH_ENABLED === "true" };
}
