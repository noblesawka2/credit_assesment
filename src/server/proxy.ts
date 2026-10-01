import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { requireControl } from "../domain/validation.ts";

export type ClientAddress = (request: IncomingMessage) => string;

function normalize(address: string) {
  requireControl(isIP(address) !== 0, "INVALID_CLIENT_ADDRESS");
  return isIP(address) === 6 ? new URL("http://[" + address + "]").hostname.toLowerCase() : address;
}

export function clientAddressResolver(env: NodeJS.ProcessEnv = process.env): ClientAddress {
  const hosted = env.VERCEL === "1" && env.VERCEL_ENV !== "development";
  const mode = env.TRUSTED_PROXY ?? (hosted ? "vercel" : "none");
  requireControl(mode === "none" || mode === "vercel", "INVALID_TRUSTED_PROXY");
  if (hosted) requireControl(mode === "vercel", "VERCEL_PROXY_REQUIRED");
  if (mode === "vercel") {
    requireControl(hosted && env.NODE_ENV === "production" && ["production", "preview"].includes(env.VERCEL_ENV ?? ""), "VERCEL_PROXY_RUNTIME_REQUIRED");
    return request => {
      const address = request.headers["x-vercel-forwarded-for"];
      const copies = request.rawHeaders?.filter((value, index) => index % 2 === 0 && value.toLowerCase() === "x-vercel-forwarded-for").length ?? 0;
      requireControl(typeof address === "string" && copies <= 1 && isIP(address) !== 0, "INVALID_PROXY_ADDRESS");
      return normalize(address);
    };
  }
  return request => normalize(request.socket.remoteAddress ?? "");
}
