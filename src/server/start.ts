import { createServer } from "node:http";
import { createRuntime } from "./runtime.ts";
import { DomainError } from "../domain/validation.ts";

try {
  const runtime = await createRuntime();
  const server = createServer(runtime.handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 50;
  server.listen(runtime.environment.port, runtime.environment.host, () => process.stdout.write("Nobles backend listening; live lending workflows remain disabled.\n"));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => { void runtime.close(); }));
} catch (error) {
  process.stderr.write(JSON.stringify({ startup: "FAILED", code: error instanceof DomainError ? error.code : "STARTUP_FAILED" }) + "\n");
  process.exit(1);
}
