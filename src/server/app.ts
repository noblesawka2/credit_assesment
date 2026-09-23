import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { authorize } from "../domain/access.ts";
import { DomainError, integer, requireControl } from "../domain/validation.ts";
import type { CoreSystemAdapter } from "../integration/core-contract.ts";
import { unavailableIdentity, type IdentityAdapter } from "./identity.ts";
import type { DraftRepository } from "./repository.ts";
import type { StaffAuthentication } from "./staff-auth.ts";
import type { Actor } from "../domain/access.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const assets: Record<string, [string, string]> = {
  "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
  "/sw.js": ["sw.js", "text/javascript"], "/icon.svg": ["icon.svg", "image/svg+xml"],
  "/auth.js": ["auth.js", "text/javascript"]
};
function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  requireControl(request.headers["content-type"]?.split(";")[0] === "application/json", "JSON_REQUIRED");
  let size = 0;
  const buffers: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    requireControl(size <= 128 * 1024, "PAYLOAD_TOO_LARGE");
    buffers.push(chunk);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(buffers).toString("utf8")); }
  catch { throw new DomainError("INVALID_JSON"); }
  requireControl(body !== null && typeof body === "object" && !Array.isArray(body), "INVALID_BODY");
  return body as Record<string, unknown>;
}
export function createApp(options: { origin: string; identity?: IdentityAdapter; staffAuth?: StaffAuthentication; core?: CoreSystemAdapter; repository?: DraftRepository }) {
  const identity = options.staffAuth ?? options.identity ?? unavailableIdentity;
  const core = options.core;
  const server = createServer(async (request, response) => {
    let actor: Actor | null = null;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (options.origin.startsWith("https://")) response.setHeader("Strict-Transport-Security", "max-age=31536000");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    try {
      const pathname = new URL(request.url ?? "/", options.origin).pathname;
      if (pathname === "/api/health" && request.method === "GET") return send(response, 200, {
        service: "Nobles Cooperative", status: "FOUNDATION_ONLY", productionReady: false,
        identityConfigured: identity !== unavailableIdentity, databaseConfigured: Boolean(options.repository),
        coreConfigured: Boolean(core), verificationMode: core ? "EXTERNAL" : "STANDALONE",
        offlineCaptureEnabled: false, submissionEnabled: false
      });
      if (pathname.startsWith("/api/")) {
        requireControl(request.headers["sec-fetch-site"] !== "cross-site", "FORBIDDEN");
        if (request.method !== "GET") requireControl(request.headers.origin === options.origin, "ORIGIN_REJECTED");
        if (options.staffAuth) await options.staffAuth.rateLimit(request, "api");
        if (pathname.startsWith("/api/auth/")) {
          requireControl(options.staffAuth, "AUTH_SERVICE_UNAVAILABLE");
          const action = pathname.slice("/api/auth/".length);
          if (!["sign-in", "sign-out", "forgot-password", "reset-password"].includes(action)) return send(response, 404, { error: "NOT_FOUND" });
          if (request.method !== "POST") return send(response, 405, { error: "METHOD_NOT_ALLOWED" });
          return send(response, 200, await options.staffAuth.handle(action, await bodyOf(request), request, response));
        }
        actor = await identity.authenticate(request);
        if (!actor) {
          await options.staffAuth?.audit("AUTHORIZATION_DENIED");
          options.staffAuth?.clearCookie(response);
          return send(response, 401, { error: "APPROVED_IDENTITY_REQUIRED" });
        }
        requireControl(actor.active && uuid.test(actor.id), "FORBIDDEN");
        if (pathname === "/api/session" && request.method === "GET") {
          let canCapture = true;
          try { authorize(actor, "CAPTURE"); } catch { canCapture = false; }
          return send(response, 200, { roles: actor.roles, userId: actor.id, canCapture, offlineCaptureEnabled: false });
        }
        if (pathname.startsWith("/api/drafts/")) {
          authorize(actor, "CAPTURE");
          requireControl(options.repository, "DATABASE_NOT_CONFIGURED");
          const id = pathname.slice("/api/drafts/".length);
          requireControl(uuid.test(id), "INVALID_CASE_ID");
          if (request.method !== "GET") return send(response, 405, { error: "METHOD_NOT_ALLOWED" });
          return send(response, 200, await options.repository.read(actor, id));
        }
        if (pathname === "/api/drafts") {
          authorize(actor, "CAPTURE");
          requireControl(options.repository, "DATABASE_NOT_CONFIGURED");
          if (request.method === "GET") {
            await options.staffAuth?.audit("SENSITIVE_ACCESS", actor);
            return send(response, 200, await options.repository.list(actor));
          }
          if (request.method === "POST") {
            const body = await bodyOf(request);
            requireControl(typeof body.idempotencyKey === "string" && uuid.test(body.idempotencyKey), "INVALID_IDEMPOTENCY_KEY");
            requireControl(body.id === undefined || (typeof body.id === "string" && uuid.test(body.id)), "INVALID_CASE_ID");
            if (body.id !== undefined) integer(body.revision, 1, 2147483646);
            requireControl(typeof body.requestedAmountKobo === "string", "INVALID_MONEY");
            requireControl(typeof body.memberNumber === "string" && body.memberNumber.length > 0 && body.memberNumber.length <= 100, "MEMBER_NUMBER_REQUIRED");
            requireControl(typeof body.fullNameClaim === "string" && body.fullNameClaim.length > 0 && body.fullNameClaim.length <= 200, "NAME_REQUIRED");
            requireControl(body.answers !== null && typeof body.answers === "object" && !Array.isArray(body.answers), "ANSWERS_REQUIRED");
            let externalMemberId: string | null = null;
            if (core) {
              const match = await core.matchMember({ memberNumber: body.memberNumber, fullNameClaim: body.fullNameClaim });
              requireControl(match.status === "VERIFIED" && match.externalMemberId, "MEMBER_VERIFICATION_PENDING");
              const membership = await core.getMembershipAndKycStatus(match.externalMemberId);
              requireControl(membership.status === "VERIFIED" && membership.active && membership.restrictions?.length === 0, "MEMBER_VERIFICATION_PENDING");
              externalMemberId = match.externalMemberId;
            }
            requireControl(externalMemberId !== null || !actor.roles.includes("MEMBER"), "FORBIDDEN");
            return send(response, 200, await options.repository.save(actor, externalMemberId, {
              id: body.id as string | undefined, revision: body.revision as number | undefined,
              answers: { ...body.answers, memberNumber: body.memberNumber, fullNameClaim: body.fullNameClaim },
              requestedAmountKobo: body.requestedAmountKobo, idempotencyKey: body.idempotencyKey
            }));
          }
          return send(response, 405, { error: "METHOD_NOT_ALLOWED" });
        }
        return send(response, 404, { error: "NOT_IMPLEMENTED" });
      }
      if (request.method !== "GET") return send(response, 405, { error: "METHOD_NOT_ALLOWED" });
      if (pathname === "/credit/auth") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(await readFile(new URL("../../public/auth.html", import.meta.url)));
        return;
      }
      const asset = assets[pathname];
      if (asset) {
        response.setHeader("Content-Type", asset[1] + "; charset=utf-8");
        response.end(await readFile(new URL("../../public/" + asset[0], import.meta.url)));
        return;
      }
      if (pathname === "/" || pathname === "/credit/staff" || /^\/credit\/apply\/(start|request|income-route|business|sales|business-costs|household|debts|use-of-funds|salary|unity-group|evidence|review)$/.test(pathname)) {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(await readFile(new URL("../../public/index.html", import.meta.url)));
        return;
      }
      send(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const code = error instanceof DomainError ? error.code : "SERVICE_UNAVAILABLE";
      if (["FORBIDDEN", "ORIGIN_REJECTED", "MEMBER_ROLE_CONFLICT"].includes(code)) {
        try { await options.staffAuth?.audit("AUTHORIZATION_DENIED", actor ?? undefined); }
        catch { return send(response, 503, { error: "SERVICE_UNAVAILABLE" }); }
      }
      if (code === "RATE_LIMITED") response.setHeader("Retry-After", "900");
      const status = code === "RATE_LIMITED" ? 429 : code === "AUTHENTICATION_FAILED" ? 401 : code === "FORBIDDEN" || code === "ORIGIN_REJECTED" ? 403 : code.includes("CONFLICT") || code.includes("IMMUTABLE") || code === "MEMBER_VERIFICATION_PENDING" ? 409 : code === "PAYLOAD_TOO_LARGE" ? 413 : ["DATABASE_NOT_CONFIGURED", "SERVICE_UNAVAILABLE", "AUTH_SERVICE_UNAVAILABLE"].includes(code) ? 503 : 400;
      send(response, status, { error: code });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 50;
  return server;
}
