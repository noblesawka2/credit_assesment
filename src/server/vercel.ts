import type { IncomingMessage, ServerResponse } from "node:http";
import { createRuntime } from "./runtime.ts";
import { securityHeaders } from "./app.ts";
import { requireControl } from "../domain/validation.ts";

type Runtime = Awaited<ReturnType<typeof createRuntime>>;

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
        process.stderr.write('{"startup":"UNAVAILABLE"}\n');
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
