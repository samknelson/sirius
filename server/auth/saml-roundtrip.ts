import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { storageLogger } from "../logger";
import { getEnvironmentVariable } from "../config/env-registry";

let mountedPath: string | undefined;
export function setSamlCallbackPath(path: string): void {
  mountedPath = path;
}

/** The boot-mounted route is authoritative even if configuration changes live. */
export function getMountedSamlCallbackPath(): string | undefined {
  return mountedPath;
}

/** Deliberately allowlisted: never log bodies, queries, cookies, or session ids. */
export function samlMilestone(
  req: Request,
  operation: string,
  details: { hasResponse?: boolean; authenticated?: boolean; reference?: string } = {},
): void {
  try {
    storageLogger.info(`SAML roundtrip: ${operation}`, {
      module: "auth", operation: `saml_${operation}`,
      description: `SAML roundtrip: ${operation}`,
      method: req.method,
      callbackOrigin: getEnvironmentVariable("PUBLIC_URL"),
      callbackPath: mountedPath ?? getEnvironmentVariable("SAML_CALLBACK_PATH") ?? "/api/auth/saml/callback",
      // Host is untrusted input; URL parsing strips userinfo/path/query.
      receivedOrigin: new URL(`${req.protocol}://${req.get("host")}`).origin,
      ...details,
    });
  } catch {
    // Diagnostics must never change the authentication result.
  }
}

export function samlHandoffFailure(req: Request, res: Parameters<RequestHandler>[1], code: string): void {
  const reference = `SAML-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  samlMilestone(req, code, { reference, authenticated: !!req.isAuthenticated?.() });
  res.redirect(303, `/auth-error?error=${code}&ref=${reference}`);
}

/** Runs before body parsing and session restoration, not just verification. */
export const observeSamlCallback: RequestHandler = (req, _res, next) => {
  const path = mountedPath ?? getEnvironmentVariable("SAML_CALLBACK_PATH") ?? "/api/auth/saml/callback";
  // Match Express's default case-insensitive / optional trailing slash routing.
  const normalized = (value: string) => value.toLowerCase().replace(/\/$/, "");
  if (normalized(req.path) === normalized(path)) samlMilestone(req, "callback_received");
  next();
};

/** Installed after the auth routes; also catches parser/session middleware errors. */
export const samlHandoffError: ErrorRequestHandler = (_error, req, res, next) => {
  if (res.headersSent) return next(_error);
  samlHandoffFailure(req, res, "saml_handoff_failed");
};
