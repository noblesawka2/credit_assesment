import { requireControl } from "../domain/validation.ts";

function setting(env: NodeJS.ProcessEnv, name: string, minimum: number, maximum: number, fallback?: number) {
  const value = env[name];
  requireControl(value === undefined ? fallback !== undefined : /^\d+$/.test(value), "INVALID_" + name);
  const result = value === undefined ? fallback! : Number(value);
  requireControl(Number.isSafeInteger(result) && result >= minimum && result <= maximum, "INVALID_" + name);
  return result;
}

export function runtimePoolSettings(env: NodeJS.ProcessEnv = process.env) {
  const max = setting(env, "DATABASE_POOL_MAX", 1, 10, 2);
  if (env.VERCEL === "1" && env.VERCEL_ENV !== "development") {
    const budget = setting(env, "DATABASE_CONNECTION_BUDGET", 1, 100000);
    const reserve = setting(env, "DATABASE_RESERVED_CONNECTIONS", 0, 100000);
    const staffInstances = setting(env, "DATABASE_STAFF_MAX_INSTANCES", 1, 10000);
    const adminInstances = setting(env, "DATABASE_ADMIN_MAX_INSTANCES", 1, 10000);
    requireControl(max * (staffInstances + adminInstances) + reserve <= budget, "DATABASE_COMBINED_BUDGET_EXCEEDED");
  }
  return { max, min: 0, idleTimeoutMillis: 5000, maxLifetimeSeconds: 60, allowExitOnIdle: true, keepAlive: true };
}
