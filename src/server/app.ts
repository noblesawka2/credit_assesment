import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { authorize } from "../domain/access.ts";
import { DomainError, integer, requireControl } from "../domain/validation.ts";
import type { CoreSystemAdapter } from "../integration/core-contract.ts";
import { unavailableIdentity, type IdentityAdapter } from "./identity.ts";
import type { DraftRepository } from "./repository.ts";
import type { StaffAuthentication } from "./staff-auth.ts";
import type { Actor } from "../domain/access.ts";
import type { ManualVerificationRepository } from "./manual-verification.ts";
import { INVITABLE_ROLES, type StaffAdministration } from "./administration.ts";
import type { ReadinessRepository } from "./readiness.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const assets: Record<string, [string, string]> = {
  '/fonts/dm-sans-latin.woff2': ['fonts/dm-sans-latin.woff2', 'font/woff2'],
  '/fonts/playfair-display-latin.woff2': ['fonts/playfair-display-latin.woff2', 'font/woff2'],
  '/fonts/space-mono-latin-regular.woff2': ['fonts/space-mono-latin-regular.woff2', 'font/woff2'],
  '/fonts/space-mono-latin-bold.woff2': ['fonts/space-mono-latin-bold.woff2', 'font/woff2'],
  "/branding.css": ["branding.css", "text/css"], "/nobles-logo.png": ["nobles-logo.png", "image/png"],
  "/administration.js": ["administration.js", "text/javascript"], "/readiness.js": ["readiness.js", "text/javascript"],
  "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
  "/sw.js": ["sw.js", "text/javascript"], "/icon.svg": ["icon.svg", "image/svg+xml"],
  "/auth.js": ["auth.js", "text/javascript"], "/verification.js": ["verification.js", "text/javascript"]
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
export function securityHeaders(response: ServerResponse, secure: boolean) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (secure) response.setHeader("Strict-Transport-Security", "max-age=31536000");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
}

export interface AppOptions { origin: string; surface?: "staff" | "administration" | "local"; identity?: IdentityAdapter; staffAuth?: StaffAuthentication; core?: CoreSystemAdapter; repository?: DraftRepository; verification?: ManualVerificationRepository; administration?: StaffAdministration; readiness?: ReadinessRepository; healthCheck?: () => Promise<boolean> }

export function createRequestHandler(options: AppOptions) {
  const identity = options.staffAuth ?? options.identity ?? unavailableIdentity;
  const core = options.core;
  return async (request: IncomingMessage, response: ServerResponse) => {
    let actor: Actor | null = null;
    securityHeaders(response, options.origin.startsWith("https://"));
    try {
      const pathname = new URL(request.url ?? "/", options.origin).pathname;
      if (pathname === "/api/health" && request.method === "GET") {
        const available = await Promise.resolve().then(() => options.healthCheck?.() ?? false).catch(() => false);
        return send(response, available ? 200 : 503, {
          service: "Nobles Cooperative", status: available ? "AVAILABLE" : "UNAVAILABLE", surface: options.surface ?? "local",
          productionReady: false, offlineCaptureEnabled: false, submissionEnabled: false
        });
      }
      if (pathname.startsWith("/api/")) {
        requireControl(request.headers["sec-fetch-site"] !== "cross-site", "FORBIDDEN");
        if (request.method !== "GET") requireControl(request.headers.origin === options.origin, "ORIGIN_REJECTED");
        if (options.staffAuth) await options.staffAuth.rateLimit(request, "api");
        if (pathname.startsWith("/api/auth/")) {
          requireControl(options.staffAuth, "AUTH_SERVICE_UNAVAILABLE");
          const action = pathname.slice("/api/auth/".length);
          if (!["sign-in", "sign-out", "forgot-password", "reset-password", "accept-invite"].includes(action)) return send(response, 404, { error: "NOT_FOUND" });
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
          let canVerify = Boolean(options.verification);
          let canAdminister = Boolean(options.administration) && options.surface !== "staff";
          let canAssessReadiness = Boolean(options.readiness);
          try { authorize(actor, "CAPTURE"); } catch { canCapture = false; }
          try { authorize(actor, "VERIFY"); } catch { canVerify = false; }
          try { authorize(actor, "STAFF_ADMIN"); } catch { canAdminister = false; }
          try { authorize(actor, "READINESS"); } catch { canAssessReadiness = false; }
          return send(response, 200, { roles: actor.roles, userId: actor.id, staffId: actor.staffId, canCapture, canVerify, canAdminister, canAssessReadiness, offlineCaptureEnabled: false });
        }
        if (pathname.startsWith("/api/admin/")) {
          requireControl(options.surface !== "staff", "FORBIDDEN");
          authorize(actor, "STAFF_ADMIN");
          requireControl(options.administration, "SERVICE_UNAVAILABLE");
          await options.staffAuth?.rateLimit(request, "administration");
          if (pathname === "/api/admin/overview" && request.method === "GET") return send(response, 200, await options.administration.overview(actor));
          if (pathname === "/api/admin/staff" && request.method === "GET") return send(response, 200, { staff: await options.administration.directory(actor), roles: INVITABLE_ROLES });
          if (pathname === "/api/admin/staff" && request.method === "POST") return send(response, 200, await options.administration.invite(actor, await bodyOf(request)));
          return send(response, 404, { error: "NOT_FOUND" });
        }
        if (pathname.startsWith("/api/readiness/")) {
          authorize(actor, "READINESS");
          requireControl(options.readiness, "SERVICE_UNAVAILABLE");
          await options.staffAuth?.rateLimit(request, "readiness");
          if (pathname === "/api/readiness/config" && request.method === "GET") return send(response, 200, await options.readiness.configuration(actor, new URL(request.url!, options.origin).searchParams.get("product") ?? ""));
          const id = pathname.slice("/api/readiness/".length);
          requireControl(uuid.test(id), "INVALID_CASE_ID");
          if (request.method === "POST") return send(response, 200, await options.readiness.evaluate(actor,id,await bodyOf(request)));
          return send(response, 405, { error: "METHOD_NOT_ALLOWED" });
        }
        if (pathname === "/api/verifications" || pathname.startsWith("/api/verifications/")) {
          authorize(actor, "VERIFY");
          requireControl(options.verification, "DATABASE_NOT_CONFIGURED");
          if (options.staffAuth) await options.staffAuth.rateLimit(request, "verification");
          if (pathname === "/api/verifications") {
            if (request.method !== "GET") return send(response, 405, { error: "METHOD_NOT_ALLOWED" });
            return send(response, 200, await options.verification.list(actor));
          }
          const id = pathname.slice("/api/verifications/".length);
          requireControl(uuid.test(id), "INVALID_CASE_ID");
          if (request.method === "GET") return send(response, 200, await options.verification.read(actor, id));
          if (request.method === "POST") return send(response, 200, await options.verification.record(actor, id, await bodyOf(request)));
          return send(response, 405, { error: "METHOD_NOT_ALLOWED" });
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
      if (pathname === "/credit/admin" || pathname === "/credit/readiness") {
        if (pathname === "/credit/admin" && options.surface === "staff") return send(response, 404, { error: "NOT_FOUND" });
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(await readFile(new URL("../../public/" + (pathname === "/credit/admin" ? "administration.html" : "readiness.html"), import.meta.url)));
        return;
      }
      if (pathname === "/credit/auth") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(await readFile(new URL("../../public/auth.html", import.meta.url)));
        return;
      }
      if (pathname === "/credit/verification") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(await readFile(new URL("../../public/verification.html", import.meta.url)));
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
        const page = options.surface === "administration" && ["/", "/credit/staff"].includes(pathname) ? "administration.html" : "index.html";
        response.end(await readFile(new URL("../../public/" + page, import.meta.url)));
        return;
      }
      send(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const code = error instanceof DomainError ? error.code : "SERVICE_UNAVAILABLE";
      if (["FORBIDDEN", "ORIGIN_REJECTED", "MEMBER_ROLE_CONFLICT", "CASE_NOT_FOUND"].includes(code)) {
        try { await options.staffAuth?.audit("AUTHORIZATION_DENIED", actor ?? undefined); }
        catch { return send(response, 503, { error: "SERVICE_UNAVAILABLE" }); }
      }
      if (code === "RATE_LIMITED") response.setHeader("Retry-After", "900");
      const status = code === "CASE_NOT_FOUND" ? 404 : code === "RATE_LIMITED" ? 429 : code === "AUTHENTICATION_FAILED" ? 401 : code === "FORBIDDEN" || code === "ORIGIN_REJECTED" ? 403 : code.includes("CONFLICT") || code.includes("IMMUTABLE") || code === "MEMBER_VERIFICATION_PENDING" ? 409 : code === "PAYLOAD_TOO_LARGE" ? 413 : ["DATABASE_NOT_CONFIGURED", "SERVICE_UNAVAILABLE", "AUTH_SERVICE_UNAVAILABLE"].includes(code) ? 503 : 400;
      send(response, status, { error: code });
    }
  };
}

export function createApp(options: AppOptions) {
  const server = createServer(createRequestHandler(options));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 50;
  return server;
}
